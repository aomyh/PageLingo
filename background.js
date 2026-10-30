import { PROVIDERS, LANGUAGES, getSettings, getProvider, isProviderReady } from './lib/config.js';
import { translateBatch, requestTranslations, validateEndpoint, TranslationError } from './lib/translator.js';
import { cacheStats, clearTranslationCache } from './lib/cache.js';

const sessions = new Map();
const cancelled = new Map();
const waiting = [];
let activeRequests = 0;

function protectStorage() {
  // Keys are never made available to content scripts or injected page code.
  chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {});
}
protectStorage();
chrome.runtime.onInstalled.addListener(({ reason }) => {
  protectStorage();
  if (reason === 'install') chrome.runtime.openOptionsPage();
});

function trustedUI(sender) {
  return sender.id === chrome.runtime.id && typeof sender.url === 'string' && sender.url.startsWith(chrome.runtime.getURL(''));
}
function contentSender(sender) {
  return sender.id === chrome.runtime.id && Number.isInteger(sender.tab?.id) && /^https?:/.test(sender.url || sender.tab?.url || '');
}

async function hasEndpointPermission(baseUrl) {
  const url = validateEndpoint(baseUrl);
  // Chrome match patterns cover every port for this hostname, including local Ollama.
  return chrome.permissions.contains({ origins: [`${url.protocol}//${url.hostname}/*`] });
}

async function withPermit(limit, signal, task) {
  await new Promise((resolve, reject) => {
    const entry = { limit, resolve, reject, signal };
    const abort = () => {
      const index = waiting.indexOf(entry);
      if (index >= 0) waiting.splice(index, 1);
      reject(new TranslationError('翻译已停止。', 'ABORTED'));
    };
    entry.abort = abort;
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    waiting.push(entry);
    drain();
  });
  try {
    if (signal.aborted) throw new TranslationError('翻译已停止。', 'ABORTED');
    return await task();
  } finally { activeRequests--; drain(); }
}
function drain() {
  for (let index = 0; index < waiting.length;) {
    const entry = waiting[index];
    if (activeRequests >= entry.limit) { index++; continue; }
    waiting.splice(index, 1);
    entry.signal.removeEventListener('abort', entry.abort);
    activeRequests++;
    entry.resolve();
  }
}

function sessionKey(sender, message) {
  if (typeof message.sessionId !== 'string' || !/^[\w-]{1,128}$/.test(message.sessionId)) throw new TranslationError('翻译会话无效，请重新开始。');
  return `${sender.tab.id}:${message.sessionId}`;
}

async function handleMessage(message, sender) {
  if (!message || typeof message.type !== 'string') throw new TranslationError('无效请求。');
  const ui = trustedUI(sender);
  const content = contentSender(sender);
  if (!ui && !content) throw new TranslationError('请求来源无效。');

  if (message.type === 'GET_PUBLIC_SETTINGS') {
    const settings = await getSettings();
    const provider = getProvider(settings);
    return { ok: true, settings: {
      targetLanguage: settings.targetLanguage, displayMode: settings.displayMode,
      concurrency: settings.concurrency, batchSize: settings.batchSize,
      cacheEnabled: settings.cacheEnabled, translateDynamic: settings.translateDynamic,
      activeProvider: provider.id, ready: isProviderReady(settings),
      providerName: provider.name, model: settings.providers[provider.id].model,
    } };
  }
  if (message.type === 'TRANSLATE_BATCH') {
    if (!content) throw new TranslationError('请在网页中启动翻译。');
    const key = sessionKey(sender, message);
    for (const [id, time] of cancelled) if (Date.now() - time > 60000) cancelled.delete(id);
    if (cancelled.has(key)) throw new TranslationError('翻译已停止。', 'ABORTED');
    const settings = await getSettings();
    const provider = getProvider(settings);
    const config = settings.providers[provider.id];
    if (!isProviderReady(settings)) throw new TranslationError('请先在配置页填写 API Key 和模型。', 'MISSING_KEY');
    if (!await hasEndpointPermission(config.baseUrl)) throw new TranslationError('尚未授权访问该 AI 服务，请在配置页点击保存并完成授权。', 'NO_PERMISSION');
    const language = message.targetLanguage || settings.targetLanguage;
    if (!LANGUAGES.some(item => item.code === language)) throw new TranslationError('不支持此目标语言。');
    if (cancelled.has(key)) throw new TranslationError('翻译已停止。', 'ABORTED');
    let session = sessions.get(key);
    if (!session) { session = { controller: new AbortController(), count: 0 }; sessions.set(key, session); }
    session.count++;
    try {
      const result = await translateBatch(provider, config, language, message.items, {
        signal: session.controller.signal, scope: key, cacheEnabled: settings.cacheEnabled,
        // Cache hits return immediately even when all remote request slots are busy.
        scheduleRequest: task => withPermit(settings.concurrency, session.controller.signal, task),
      });
      return { ok: true, ...result };
    } finally {
      session.count--;
      if (!session.count) sessions.delete(key);
    }
  }
  if (message.type === 'CANCEL_TRANSLATION') {
    if (!content) throw new TranslationError('请求来源无效。');
    const key = sessionKey(sender, message);
    cancelled.set(key, Date.now());
    sessions.get(key)?.controller.abort();
    return { ok: true };
  }
  if (!ui) throw new TranslationError('此操作仅可在插件配置页执行。');
  if (message.type === 'TEST_CONNECTION') {
    const provider = PROVIDERS.find(item => item.id === message.providerId);
    if (!provider || !message.config) throw new TranslationError('服务商配置无效。');
    const config = message.config;
    if (typeof config.baseUrl !== 'string' || typeof config.model !== 'string' || typeof config.apiKey !== 'string') throw new TranslationError('服务商配置无效。');
    if (!await hasEndpointPermission(config.baseUrl)) throw new TranslationError('尚未授权访问该 AI 服务，请允许配置页的服务商访问请求。', 'NO_PERMISSION');
    const language = message.targetLanguage || 'zh-CN';
    if (!LANGUAGES.some(item => item.code === language)) throw new TranslationError('不支持此目标语言。');
    const sample = message.text || 'Stay curious. The world is yours to explore.';
    if (typeof sample !== 'string' || !sample.trim() || sample.length > 2000) throw new TranslationError('测试文本无效或过长。');
    const started = performance.now();
    const result = await requestTranslations(provider, config, language, [{ id: 'test', text: sample }], { retries: 0 });
    return { ok: true, latency: Math.round(performance.now() - started), preview: result[0].text };
  }
  if (message.type === 'CACHE_STATS') return { ok: true, ...await cacheStats() };
  if (message.type === 'CLEAR_CACHE') { await clearTranslationCache(); return { ok: true }; }
  throw new TranslationError('未知操作。');
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch(error => {
    // Never forward raw network errors or provider response bodies: either may echo credentials.
    sendResponse({ ok: false, error: error instanceof TranslationError ? error.message : '操作失败，请重试。', code: error instanceof TranslationError ? error.code : 'INTERNAL_ERROR' });
  });
  return true;
});

chrome.tabs.onRemoved.addListener(tabId => {
  for (const [key, session] of sessions) if (key.startsWith(`${tabId}:`)) session.controller.abort();
});
