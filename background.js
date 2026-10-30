import { PROVIDERS, LANGUAGES, STORAGE_KEY, getSettings, getProvider, isProviderReady, normalizeSettings } from './lib/config.js';
import { translateBatch, requestTranslations, validateEndpoint, TranslationError } from './lib/translator.js';
import { cacheStats, clearTranslationCache } from './lib/cache.js';
import { createSelectionManager, publicSettings, supportsSelection } from './lib/selection.js';
import { recordUsage, getUsageStats, clearUsageStats } from './lib/usage.js';

const sessions = new Map();
const cancelled = new Map();
const manualSessions = new Map();
const manualCancelled = new Map();
const openingManualPanels = new Map();
const waiting = [];
let activeRequests = 0;
const manualRevisionPrefix = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let manualRevisionCounter = 0;

function abortSelectionSessions() {
  for (const [key, session] of sessions) if (session.kind === 'selection') {
    cancelled.set(key, Date.now());
    session.controller.abort();
  }
}
const selectionManager = createSelectionManager({ onDisable: abortSelectionSessions });

function reconcileSelection(options) {
  void selectionManager.reconcile(options).catch(() => {});
}

function protectStorage() {
  // Keys are never made available to content scripts or injected page code.
  chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {});
}
protectStorage();
chrome.runtime.onInstalled.addListener(({ reason }) => {
  protectStorage();
  reconcileSelection({ injectExisting: true });
  if (reason === 'install') chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup?.addListener(() => reconcileSelection({ injectExisting: true }));
chrome.permissions.onRemoved?.addListener(() => reconcileSelection());
chrome.storage.onChanged?.addListener((changes, area) => {
  if (area !== 'local' || !changes[STORAGE_KEY]) return;
  const change = changes[STORAGE_KEY];
  if (manualConfigurationSignature(change.oldValue) !== manualConfigurationSignature(change.newValue)) manualRevisionCounter++;
  if (changes[STORAGE_KEY].newValue?.selectionEnabled !== true) abortSelectionSessions();
  reconcileSelection({ injectExisting: changes[STORAGE_KEY].newValue?.selectionEnabled === true && changes[STORAGE_KEY].oldValue?.selectionEnabled !== true });
});
// A service worker may restart independently of browser startup or extension installation.
reconcileSelection();

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

function manualKey(sender, message) {
  if (typeof message.requestId !== 'string' || !/^[\w-]{1,128}$/.test(message.requestId)) throw new TranslationError('翻译请求无效，请重新开始。', 'INVALID_REQUEST');
  // Document identity survives same-page route changes while keeping frames and
  // tabs isolated. Older callers without it are scoped to their tab/frame.
  const owner = sender.documentId ? `document:${sender.documentId}`
    : Number.isInteger(sender.tab?.id) ? `tab:${sender.tab.id}:frame:${sender.frameId || 0}` : `ui:${sender.url}`;
  return `${owner}:${message.requestId}`;
}
function manualConfigurationSignature(value) {
  const settings = normalizeSettings(value), provider = getProvider(settings), config = settings.providers[provider.id];
  // This private identity is never sent to content scripts; callers receive only
  // an opaque revision. Reading preferences must not cancel a manual request.
  return JSON.stringify([provider.id, config.model, config.baseUrl, config.apiKey]);
}
function pruneManualCancellations() {
  const cutoff = Date.now() - 60000;
  for (const [key, time] of manualCancelled) if (time < cutoff) manualCancelled.delete(key);
  while (manualCancelled.size > 512) manualCancelled.delete(manualCancelled.keys().next().value);
}
function ensureManualActive(key, controller) {
  if (controller.signal.aborted || manualCancelled.has(key)) throw new TranslationError('翻译已停止。', 'ABORTED');
}

function openManualPanel(tabId) {
  if (!Number.isInteger(tabId) || tabId < 0) throw new TranslationError('请在普通网页打开手动翻译，再粘贴需要翻译的内容。', 'UNSUPPORTED_PAGE');
  if (!openingManualPanels.has(tabId)) {
    const opening = (async () => {
      let page;
      try { page = await chrome.tabs.get(tabId); }
      catch { throw new TranslationError('当前网页已关闭，请重新打开手动翻译。', 'UNSUPPORTED_PAGE'); }
      if (!supportsSelection(page.url)) throw new TranslationError('此页面无法显示翻译浮窗，请切换到普通网页后粘贴内容。', 'UNSUPPORTED_PAGE');
      try {
        // The injected script reuses its existing panel and never opens a tab or
        // browser window. activeTab grants this one user-initiated injection.
        await chrome.scripting.executeScript({ target: { tabId }, files: ['manual-panel.js'] });
      } catch {
        throw new TranslationError('此页面无法显示翻译浮窗，请在普通网页打开后粘贴内容。', 'PANEL_UNAVAILABLE');
      }
      return { ok: true, tabId, mode: 'in-page' };
    })().finally(() => openingManualPanels.delete(tabId));
    openingManualPanels.set(tabId, opening);
  }
  return openingManualPanels.get(tabId);
}

async function handleMessage(message, sender) {
  if (!message || typeof message.type !== 'string') throw new TranslationError('无效请求。');
  const ui = trustedUI(sender);
  const content = contentSender(sender);
  if (!ui && !content) throw new TranslationError('请求来源无效。');

  if (message.type === 'GET_PUBLIC_SETTINGS') {
    const settings = await getSettings();
    return { ok: true, settings: publicSettings({ ...settings, selectionEnabled: selectionManager.isEnabled(settings) }) };
  }
  if (message.type === 'GET_MANUAL_SETTINGS') {
    const settings = await getSettings();
    return { ok: true, settings: publicSettings(settings), configurationRevision: `${manualRevisionPrefix}:${manualRevisionCounter}` };
  }
  if (message.type === 'MANUAL_OPEN_OPTIONS') {
    await chrome.runtime.openOptionsPage();
    return { ok: true };
  }
  if (message.type === 'SET_SELECTION_ENABLED') {
    if (!ui) throw new TranslationError('此操作仅可在插件设置中执行。');
    try { return { ok: true, settings: await selectionManager.setEnabled(message.enabled) }; }
    catch (error) { throw new TranslationError(error.message || '划词翻译设置失败，请重试。'); }
  }
  if (message.type === 'TRANSLATE_BATCH' || message.type === 'TRANSLATE_SELECTION') {
    if (!content) throw new TranslationError('请在网页中启动翻译。');
    const isSelection = message.type === 'TRANSLATE_SELECTION';
    const key = sessionKey(sender, message);
    for (const [id, time] of cancelled) if (Date.now() - time > 60000) cancelled.delete(id);
    if (cancelled.has(key)) throw new TranslationError('翻译已停止。', 'ABORTED');
    const settings = await getSettings();
    if (isSelection && !selectionManager.isEnabled(settings)) throw new TranslationError('划词翻译已关闭。', 'SELECTION_DISABLED');
    if (isSelection && (typeof message.text !== 'string' || !message.text.trim() || message.text.length > 5000)) throw new TranslationError('请选择 1–5,000 字符的文本。', 'INVALID_SELECTION');
    const provider = getProvider(settings);
    const config = settings.providers[provider.id];
    if (!isProviderReady(settings)) throw new TranslationError('请先在配置页填写 API Key 和模型。', 'MISSING_KEY');
    if (!await hasEndpointPermission(config.baseUrl)) throw new TranslationError('尚未授权访问该 AI 服务，请在配置页点击保存并完成授权。', 'NO_PERMISSION');
    const language = message.targetLanguage || settings.targetLanguage;
    if (!LANGUAGES.some(item => item.code === language)) throw new TranslationError('不支持此目标语言。');
    if (cancelled.has(key)) throw new TranslationError('翻译已停止。', 'ABORTED');
    // An off-toggle can land while a permission check is awaiting a response.
    if (isSelection && !selectionManager.isEnabled(await getSettings())) throw new TranslationError('划词翻译已关闭。', 'SELECTION_DISABLED');
    let session = sessions.get(key);
    const kind = isSelection ? 'selection' : 'page';
    if (session && session.kind !== kind) throw new TranslationError('翻译会话类型不匹配。');
    if (!session) { session = { controller: new AbortController(), count: 0, kind }; sessions.set(key, session); }
    session.count++;
    try {
      const items = isSelection ? [{ id: 'selection', text: message.text.trim() }] : message.items;
      const result = await translateBatch(provider, config, language, items, {
        signal: session.controller.signal, scope: key, cacheEnabled: settings.cacheEnabled,
        onUsage: recordUsage, kind,
        // Cache hits return immediately even when all remote request slots are busy.
        scheduleRequest: task => withPermit(settings.concurrency, session.controller.signal, task),
      });
      if (isSelection) {
        if (session.controller.signal.aborted || !selectionManager.isEnabled(await getSettings())) throw new TranslationError('划词翻译已关闭。', 'SELECTION_DISABLED');
        return { ok: true, text: result.translations[0].text, cached: result.translations[0].cached };
      }
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
  if (message.type === 'OPEN_TEXT_TRANSLATOR') {
    if (!ui) throw new TranslationError('请从插件弹窗打开手动翻译。');
    return openManualPanel(message.tabId);
  }
  if (message.type === 'CANCEL_TEXT_TRANSLATION') {
    const key = manualKey(sender, message);
    manualCancelled.set(key, Date.now());
    pruneManualCancellations();
    manualSessions.get(key)?.controller.abort();
    return { ok: true };
  }
  if (message.type === 'TRANSLATE_TEXT') {
    const key = manualKey(sender, message);
    if (typeof message.text !== 'string' || !message.text.trim() || [...message.text].length > 5000) throw new TranslationError('请输入 1–5,000 字符的内容。', 'INVALID_TEXT');
    pruneManualCancellations();
    if (manualCancelled.has(key)) throw new TranslationError('翻译已停止。', 'ABORTED');
    if (manualSessions.has(key)) throw new TranslationError('这段内容正在翻译，请稍候。', 'REQUEST_IN_PROGRESS');
    if (manualSessions.size >= 32) throw new TranslationError('正在处理的翻译较多，请稍后重试。', 'TOO_MANY_REQUESTS');
    const controller = new AbortController();
    manualSessions.set(key, { controller, tabId: sender.tab?.id });
    try {
      const settings = await getSettings();
      ensureManualActive(key, controller);
      const provider = getProvider(settings), config = settings.providers[provider.id];
      if (!isProviderReady(settings)) throw new TranslationError('请先在配置页填写 API Key 和模型。', 'MISSING_KEY');
      const language = message.targetLanguage ?? settings.targetLanguage;
      if (!LANGUAGES.some(item => item.code === language)) throw new TranslationError('不支持此目标语言。', 'INVALID_LANGUAGE');
      if (!await hasEndpointPermission(config.baseUrl)) throw new TranslationError('尚未授权访问该 AI 服务，请在配置页点击保存并完成授权。', 'NO_PERMISSION');
      ensureManualActive(key, controller);
      const result = await translateBatch(provider, config, language, [{ id: 'manual', text: message.text.trim() }], {
        signal: controller.signal, scope: `manual:${key}`, cacheEnabled: settings.cacheEnabled,
        onUsage: recordUsage, kind: 'manual',
        scheduleRequest: task => withPermit(settings.concurrency, controller.signal, task),
      });
      ensureManualActive(key, controller);
      return { ok: true, text: result.translations[0].text, cached: result.translations[0].cached,
        providerId: provider.id, model: config.model, targetLanguage: language };
    } finally { manualSessions.delete(key); }
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
    const result = await requestTranslations(provider, config, language, [{ id: 'test', text: sample }], { retries: 0, onUsage: recordUsage, kind: 'test' });
    return { ok: true, latency: Math.round(performance.now() - started), preview: result[0].text };
  }
  if (message.type === 'CACHE_STATS') return { ok: true, ...await cacheStats() };
  if (message.type === 'CLEAR_CACHE') { await clearTranslationCache(); return { ok: true }; }
  if (message.type === 'GET_USAGE_STATS') {
    const period = message.period ?? 'today';
    if (!['today', '7d', '30d', 'all'].includes(period)) throw new TranslationError('统计时间范围无效。');
    return { ok: true, ...await getUsageStats({ period }) };
  }
  if (message.type === 'CLEAR_USAGE_STATS') { await clearUsageStats(); return { ok: true }; }
  throw new TranslationError('未知操作。');
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch(error => {
    // Never forward raw network errors or provider response bodies: either may echo credentials.
    sendResponse({ ok: false, error: error instanceof TranslationError ? error.message : '操作失败，请重试。', code: error instanceof TranslationError ? error.code : 'INTERNAL_ERROR' });
  });
  return true;
});

function cancelManualTabRequests(tabId) {
  for (const [key, session] of manualSessions) if (session.tabId === tabId) {
    manualCancelled.set(key, Date.now());
    session.controller.abort();
  }
  pruneManualCancellations();
}
chrome.tabs.onRemoved.addListener(tabId => {
  for (const [key, session] of sessions) if (key.startsWith(`${tabId}:`)) session.controller.abort();
  cancelManualTabRequests(tabId);
});
chrome.tabs.onUpdated?.addListener((tabId, change) => {
  // Full document navigation destroys the panel. Cancel even if its pagehide
  // message could not reach the worker while the old document was unloading.
  if (change.status === 'loading') cancelManualTabRequests(tabId);
});
