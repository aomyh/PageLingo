import { LANGUAGES, STORAGE_KEY, getSettings, getProvider, isProviderReady, extensionAvailable } from './lib/config.js';
import { applyTheme } from './lib/theme.js';

const $ = id => document.getElementById(id);
const LIMIT = 5000;
let settings;
let currentRequest = null;
let requestSequence = 0;
let settingsEpoch = 0;
let settingsRevision = 0;
let languageInitialized = false;
let languageEdited = false;
let result = null;
let copying = false;
let closed = false;

function status(text, error = false) {
  $('manual-status').textContent = text;
  $('manual-status').classList.toggle('error', error);
}
function sourceText() { return $('manual-input').value.trim(); }
function inputLength() { return [...$('manual-input').value].length; }
function configuration() {
  if (!settings) return {};
  const provider = getProvider(settings);
  return { providerId: provider.id, model: settings.providers[provider.id]?.model || provider.model };
}
function activeConfiguration(value) {
  if (!value) return null;
  const provider = getProvider(value), config = value.providers[provider.id];
  return { providerId: provider.id, model: config?.model, baseUrl: config?.baseUrl, apiKey: config?.apiKey };
}
function sameConfiguration(first, second) {
  return first && second && ['providerId', 'model', 'baseUrl', 'apiKey'].every(key => first[key] === second[key]);
}
function staleResult() {
  if (!result) return false;
  const active = configuration();
  return result.source !== sourceText() || result.language !== $('manual-language').value
    || result.providerId !== active.providerId || result.model !== active.model || result.revision !== settingsRevision;
}
function render() {
  const count = inputLength(), ready = settings && isProviderReady(settings);
  const pending = Boolean(currentRequest), stale = staleResult();
  $('manual-count').textContent = `${count.toLocaleString('zh-CN')} / 5,000`;
  $('manual-count').classList.toggle('exceeded', count > LIMIT);
  $('manual-input').setAttribute('aria-invalid', String(count > LIMIT));
  $('manual-clear').disabled = !$('manual-input').value && !result;
  $('manual-translate').disabled = !extensionAvailable || !ready || !sourceText() || count > LIMIT || pending;
  $('manual-translate').classList.toggle('running', pending);
  $('manual-translate').querySelector('span').textContent = pending ? '正在翻译…' : '翻译文本';
  $('manual-cancel').hidden = !pending;
  $('manual-output').setAttribute('aria-busy', String(pending));
  $('manual-copy').disabled = !result || stale || pending || copying;
  $('manual-result-note').textContent = stale ? result.revision !== settingsRevision ? '服务已更新，请重新翻译' : '内容已修改，请重新翻译' : pending ? '正在等待模型' : result?.cached ? '已复用本地缓存' : '';
  $('manual-result-note').classList.toggle('stale', stale);
}
function renderSettings() {
  applyTheme(document.documentElement, settings.theme);
  const provider = getProvider(settings), ready = isProviderReady(settings);
  $('manual-provider').textContent = ready ? provider.name : '先配置 AI 服务';
  $('manual-model').textContent = settings.providers[provider.id]?.model || '请选择翻译模型';
  $('manual-settings').classList.toggle('ready', ready);
  $('manual-settings').title = ready ? `${provider.name} · 配置 AI 服务商` : '填写 API Key 和模型后即可翻译';
  render();
}
function cancelRequest(message = '') {
  const previous = currentRequest;
  currentRequest = null;
  if (previous && extensionAvailable) {
    // Cancellation remains best-effort when the document is being closed. The
    // response identity below also prevents late results replacing current text.
    try { void chrome.runtime.sendMessage({ type: 'CANCEL_TEXT_TRANSLATION', requestId: previous.id }).catch(() => {}); } catch {}
  }
  if (message) status(message);
  render();
}
function contentChanged() {
  const wasPending = Boolean(currentRequest);
  cancelRequest();
  if (inputLength() > LIMIT) status('单次最多翻译 5,000 个字符，请缩短内容后重试。', true);
  else if (wasPending) status('内容已修改，已停止上一条翻译。按翻译按钮继续。');
  else if (staleResult()) status('原文或目标语言已改变，请重新翻译。');
  else status('文字直达当前 AI 服务，输入不会保存为草稿。');
}
function newRequestId() {
  return `manual-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${++requestSequence}`}`;
}
async function translate() {
  if (!extensionAvailable) { status('这是界面预览。请加载 Chrome 扩展后使用手动翻译。'); return; }
  if (!settings || !isProviderReady(settings)) { status('请先在配置页填写 API Key 和模型。', true); return; }
  const source = sourceText();
  if (!source) { status('请输入需要翻译的内容。'); $('manual-input').focus(); return; }
  if (inputLength() > LIMIT) { status('单次最多翻译 5,000 个字符，请缩短内容后重试。', true); return; }
  if (currentRequest) return;
  const request = { id: newRequestId(), source, language: $('manual-language').value, revision: settingsRevision, started: performance.now() };
  currentRequest = request;
  status('正在翻译，可继续阅读其他网页。');
  render();
  try {
    const response = await chrome.runtime.sendMessage({ type: 'TRANSLATE_TEXT', requestId: request.id, text: request.source, targetLanguage: request.language });
    if (currentRequest !== request || closed) return;
    if (!response?.ok) throw new Error(response?.error || '翻译失败，请重试。');
    if (typeof response.text !== 'string' || !response.text.trim()) throw new Error('服务未返回有效译文，请重试。');
    const active = configuration();
    result = { source: request.source, language: request.language, text: response.text, cached: response.cached === true,
      providerId: response.providerId || active.providerId, model: response.model || active.model, revision: request.revision };
    $('manual-output').textContent = result.text;
    $('manual-output').dataset.empty = 'false';
    $('manual-output').scrollTop = 0;
    status(response.cached ? '翻译完成 · 直接复用本地缓存。' : `翻译完成 · 耗时 ${((performance.now() - request.started) / 1000).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} 秒。`);
  } catch (error) {
    if (currentRequest !== request || closed) return;
    status(error?.message || '翻译失败，请重试。', true);
  } finally {
    if (currentRequest === request) { currentRequest = null; render(); }
  }
}
async function copyResult() {
  if (!result || staleResult() || currentRequest || copying) return;
  copying = true; render();
  try {
    await navigator.clipboard.writeText(result.text);
    status('译文已复制。');
  } catch { status('无法自动复制，请选中译文后按 ⌘C 或 Ctrl+C。', true); $('manual-output').focus(); }
  finally { copying = false; render(); }
}
async function refreshSettings() {
  const epoch = ++settingsEpoch;
  try {
    const next = await getSettings();
    if (epoch !== settingsEpoch || closed) return;
    const previous = activeConfiguration(settings);
    const changed = !sameConfiguration(previous, activeConfiguration(next));
    settings = next;
    // Credentials stay only in the current trusted settings object. Results carry
    // a local revision so endpoint/key changes cannot relabel an older response.
    if (changed) {
      settingsRevision++;
      if (previous) cancelRequest('翻译服务已更新，请重新翻译当前内容。');
    }
    if (!languageInitialized) {
      if (!languageEdited) $('manual-language').value = settings.targetLanguage;
      languageInitialized = true;
    }
    renderSettings();
    if (!previous) {
      if (!extensionAvailable) status('界面预览不会发送内容。加载扩展后即可使用。');
      else if (!isProviderReady(settings)) status('请先配置 AI 服务，随后即可在此手动翻译。');
    }
  } catch { if (epoch === settingsEpoch && !closed) status('无法读取插件配置，请稍后重试。', true); }
}

for (const language of LANGUAGES) {
  const option = document.createElement('option'); option.value = language.code; option.textContent = language.name; $('manual-language').append(option);
}
$('manual-input').addEventListener('input', contentChanged);
$('manual-language').addEventListener('change', () => { languageEdited = true; contentChanged(); });
$('manual-input').addEventListener('keydown', event => {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.isComposing) { event.preventDefault(); void translate(); }
});
$('manual-translate').addEventListener('click', translate);
$('manual-cancel').addEventListener('click', () => cancelRequest('已停止翻译。内容已保留，可修改后重试。'));
$('manual-clear').addEventListener('click', () => {
  cancelRequest(); result = null; $('manual-input').value = ''; $('manual-output').textContent = '译文会显示在这里'; $('manual-output').dataset.empty = 'true';
  status('内容已清空。'); render(); $('manual-input').focus();
});
$('manual-copy').addEventListener('click', copyResult);
$('manual-close').addEventListener('click', () => { closed = true; cancelRequest(); window.close(); });
$('manual-settings').addEventListener('click', async () => {
  try {
    if (extensionAvailable) await chrome.runtime.openOptionsPage();
    else window.open('options.html', '_blank');
  } catch { status('无法打开配置页，请从扩展菜单进入配置。', true); }
});
window.addEventListener('pagehide', () => { closed = true; cancelRequest(); });
if (extensionAvailable) chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[STORAGE_KEY]) void refreshSettings();
});
if (!extensionAvailable) window.addEventListener('storage', event => { if (event.key === STORAGE_KEY) void refreshSettings(); });
$('manual-preview').hidden = extensionAvailable;
await refreshSettings();
render();
if (!closed) $('manual-input').focus();
