import { LANGUAGES, STORAGE_KEY, getSettings, saveSettings, isProviderReady, getProvider, extensionAvailable } from './lib/config.js';
import { requestSelectionPermission } from './lib/permissions.js';
import { applyTheme } from './lib/theme.js';

const $ = (id) => document.getElementById(id);
let settings;
let tab;
let pageStatus = { state: 'idle', completed: 0, total: 0, cachedCount: 0 };
let busy = false;
let pageSupported = false;
let languageChanged = false;
let polling;
let selectionPending = null;
let selectionErrorMessage = '';
let settingsRefreshEpoch = 0;
const USAGE_STORAGE_KEY = 'pagelingo.usage.v1';
let usageSummary = null;
let usageState = 'loading';
let usageRefreshEpoch = 0;
let usageRefreshQueued = false;

function message(text = '', isError = false) {
  $('status-message').textContent = text;
  $('status-message').classList.toggle('error', isError);
}

function supportedUrl(url = '') {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol)
      && parsed.hostname !== 'chromewebstore.google.com'
      && !(parsed.hostname === 'chrome.google.com' && parsed.pathname.startsWith('/webstore'));
  } catch { return false; }
}

function publicSettings() {
  const provider = getProvider(settings);
  return {
    theme: settings.theme,
    targetLanguage: settings.targetLanguage,
    displayMode: settings.displayMode,
    concurrency: settings.concurrency,
    batchSize: settings.batchSize,
    cacheEnabled: settings.cacheEnabled,
    translateDynamic: settings.translateDynamic,
    selectionEnabled: settings.selectionEnabled,
    activeProvider: settings.activeProvider,
    providerName: provider.name,
    model: settings.providers[provider.id]?.model || provider.model,
    ready: isProviderReady(settings),
  };
}

function renderSettings() {
  applyTheme(document.documentElement, settings.theme);
  const provider = getProvider(settings);
  const ready = isProviderReady(settings);
  $('provider-name').textContent = provider.name;
  $('provider-mark').textContent = provider.abbr || provider.name.slice(0, 1).toUpperCase();
  $('provider-model').textContent = settings.providers[provider.id]?.model || provider.model || '选择一个模型';
  $('connection-state').textContent = ready ? '已配置' : '待配置';
  $('connection-state').classList.toggle('ready', ready);
  $('setup-notice').hidden = ready;
  $('target-language').value = settings.targetLanguage;
  document.querySelectorAll('[data-mode]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.mode === settings.displayMode));
  });
  renderUsage();
  renderSelection();
  renderStatus();
}

function compactCount(value) {
  const count = Number.isFinite(Number(value)) ? Math.max(0, Math.round(Number(value))) : 0;
  if (count >= 1000000) return `${(count / 1000000).toFixed(1).replace(/\.0$/, '')}m`;
  if (count >= 1000) return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(count);
}

function renderUsage() {
  const shortcut = $('open-usage');
  const speed = settings ? `${settings.concurrency} 路并行${settings.cacheEnabled ? ' · 本地缓存' : ''}` : '';
  if (!extensionAvailable) {
    $('usage-summary').textContent = '用量统计';
    shortcut.title = `加载扩展后可查看本机用量。${speed}`;
    return;
  }
  if (!usageSummary) {
    $('usage-summary').textContent = usageState === 'error' ? '用量统计 · 暂不可用' : '今日用量 · 加载中';
    shortcut.title = `点击查看用量统计。${speed}`;
    return;
  }
  const count = name => Number.isFinite(Number(usageSummary[name])) ? Math.max(0, Math.round(Number(usageSummary[name]))) : 0;
  const requests = count('requests'), tokens = count('totalTokens'), missing = count('requestsWithoutUsage');
  const unknown = requests > 0 && count('requestsWithUsage') === 0;
  $('usage-summary').textContent = `今日${missing && !unknown ? '已报' : ' '}${unknown ? '—' : compactCount(tokens)} Token · ${compactCount(requests)}次`;
  const reporting = missing ? `${missing.toLocaleString()} 次请求未返回 Token；合计仅含已报告用量。` : 'Token 为服务商返回的用量，不是费用估算。';
  shortcut.title = `今日 ${requests.toLocaleString()} 次 API 请求，已报告 ${tokens.toLocaleString()} Token。${reporting}${usageState === 'error' ? '暂时无法刷新，显示上次数据。' : ''}${speed}`;
}

async function refreshUsage() {
  if (!extensionAvailable) { renderUsage(); return; }
  const epoch = ++usageRefreshEpoch;
  try {
    const result = await chrome.runtime.sendMessage({ type: 'GET_USAGE_STATS', period: 'today' });
    if (epoch !== usageRefreshEpoch) return;
    if (!result?.ok || !result.summary) throw new Error('用量统计暂不可用');
    usageSummary = result.summary;
    usageState = 'ready';
  } catch {
    if (epoch !== usageRefreshEpoch) return;
    usageState = 'error';
  }
  renderUsage();
}

function queueUsageRefresh() {
  if (usageRefreshQueued) return;
  usageRefreshQueued = true;
  void Promise.resolve().then(() => { usageRefreshQueued = false; return refreshUsage(); });
}

function renderSelection() {
  const enabled = selectionPending ?? Boolean(settings?.selectionEnabled);
  $('selection-enabled').checked = enabled;
  $('selection-enabled').disabled = !settings || selectionPending !== null;
  $('selection-enabled').setAttribute('aria-checked', String(enabled));
  $('selection-state').textContent = selectionPending !== null ? '保存中…' : enabled ? '已开启' : '已关闭';
  $('selection-state').classList.toggle('enabled', enabled);
}

async function toggleSelection(event) {
  if (!settings || selectionPending !== null) { renderSelection(); return; }
  const enabled = event.target.checked;
  selectionPending = enabled;
  renderSelection();
  try {
    if (extensionAvailable) {
      // Keep this permission request in the original checkbox user gesture.
      // The background worker owns persistence, script registration and cancellation.
      if (enabled && !await requestSelectionPermission()) {
        throw new Error('未获得网页访问权限，划词翻译尚未开启。可再次打开开关并允许访问。');
      }
      const result = await chrome.runtime.sendMessage({ type: 'SET_SELECTION_ENABLED', enabled });
      if (!result?.ok) throw new Error(result?.error || '划词翻译设置失败，请重试。');
      settings = await getSettings();
    } else {
      settings = await saveSettings({ ...await getSettings(), selectionEnabled: enabled });
      $('selection-hint').textContent = '预览设置已保存，加载扩展后生效';
    }
    // The switch's existing status supplies success feedback without adding a
    // message box that resizes Chrome's popup and creates a scrollbar.
    if (selectionErrorMessage && $('status-message').textContent === selectionErrorMessage) message();
    selectionErrorMessage = '';
  } catch (error) {
    try { settings = await getSettings(); } catch { /* Retain the last confirmed state if storage is unavailable. */ }
    selectionErrorMessage = error?.message || '划词翻译设置失败，请重试。';
    message(selectionErrorMessage, true);
  } finally {
    selectionPending = null;
    renderSettings();
  }
}

async function refreshStoredSettings() {
  const epoch = ++settingsRefreshEpoch;
  try {
    const latest = await getSettings();
    if (epoch !== settingsRefreshEpoch) return;
    settings = latest;
    renderSettings();
  } catch { /* Keep the current controls usable if a background refresh fails. */ }
}

function renderStatus() {
  if (!settings) return;
  const running = pageStatus.state === 'translating';
  const hasTranslation = running || pageStatus.completed > 0;
  const ready = isProviderReady(settings);
  $('translate-button').disabled = busy || running || !ready || !pageSupported;
  $('translate-button').classList.toggle('running', running);
  $('translate-label').textContent = busy ? '准备翻译…' : running ? '正在翻译页面…' : languageChanged ? '以新语言翻译' : pageStatus.state === 'error' ? '重试翻译' : '翻译当前页面';
  $('restore-button').disabled = busy || !hasTranslation;
  $('progress-panel').hidden = !(running || pageStatus.state === 'complete' || pageStatus.completed > 0);
  const completed = Math.max(0, Number(pageStatus.completed) || 0);
  const total = Math.max(0, Number(pageStatus.total) || 0);
  const percent = total ? Math.min(100, Math.round(completed / total * 100)) : 0;
  $('progress-text').textContent = running ? '正在逐段翻译' : pageStatus.state === 'error' ? '部分内容未完成' : '翻译完成';
  $('progress-count').textContent = total ? `${completed} / ${total} 段` : '正在识别正文';
  $('progress-fill').style.width = `${percent}%`;
  $('progress-bar').setAttribute('aria-valuenow', String(percent));
  const cached = Math.max(0, Number(pageStatus.cachedCount) || 0);
  $('cache-note').textContent = cached > 0 ? `${cached} 个文本片段读取本地缓存` : running ? '优先处理屏幕内的内容' : '';
  if (pageStatus.error) message(pageStatus.error, true);
}

async function readPageStatus() {
  if (!tab?.id || !pageSupported || busy) return;
  try {
    const result = await chrome.tabs.sendMessage(tab.id, { type: 'PAGELINGO_STATUS' });
    if (result?.ok && result.status) {
      pageStatus = result.status;
      renderStatus();
    }
  } catch { /* A page without the content script has no translation yet. */ }
}

async function persistPreference(patch) {
  try {
    settings = { ...await getSettings(), ...patch };
    await saveSettings(settings);
    renderSettings();
    return true;
  } catch {
    message('设置保存失败，请重新打开插件后重试。', true);
    return false;
  }
}

async function startTranslation() {
  if (!pageSupported || !isProviderReady(settings) || busy) return;
  busy = true;
  message();
  renderStatus();
  try {
    settings = await getSettings();
    let injected = false;
    try {
      const status = await chrome.tabs.sendMessage(tab.id, { type: 'PAGELINGO_STATUS' });
      injected = Boolean(status?.ok);
    } catch { /* Inject only when this page has not been activated. */ }
    if (!injected) await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['lib/themes.js', 'content.js'] });
    const result = await chrome.tabs.sendMessage(tab.id, { type: 'PAGELINGO_START', settings: publicSettings() });
    if (result?.ok === false) throw new Error(result.error || '无法开始翻译，请刷新网页后重试。');
    languageChanged = false;
    pageStatus = result?.status || { state: 'translating', completed: 0, total: 0, cachedCount: 0 };
  } catch (error) {
    const detail = error?.message || '';
    const known = /无法开始|请先|未配置|API|权限|服务商|模型|翻译/.test(detail);
    message(known ? detail : '无法访问此页面。请切换到普通网页，或刷新页面后重试。', true);
    pageStatus = { state: 'idle', completed: 0, total: 0, cachedCount: 0 };
  } finally {
    busy = false;
    renderStatus();
    await readPageStatus();
  }
}

async function restorePage() {
  if (!tab?.id || busy) return;
  busy = true;
  renderStatus();
  try {
    const result = await chrome.tabs.sendMessage(tab.id, { type: 'PAGELINGO_RESTORE' });
    if (result?.ok === false) throw new Error();
    pageStatus = { state: 'idle', completed: 0, total: 0, cachedCount: 0 };
    languageChanged = false;
    message('已恢复原文。');
  } catch { message('页面已更新，请刷新网页后重试。', true); }
  finally { busy = false; renderStatus(); }
}

async function openOptions() {
  if (!extensionAvailable) {
    window.location.href = 'options.html';
    return;
  }
  await chrome.runtime.openOptionsPage();
  window.close();
}

async function openUsage() {
  if (!extensionAvailable) { window.location.href = 'options.html#usage'; return; }
  try {
    await chrome.tabs.create({ url: chrome.runtime.getURL('options.html#usage') });
    window.close();
  } catch { message('无法打开用量统计，请重试。', true); }
}

let manualPreviewLoading;
async function openManualPreview() {
  if (!window.__pageLingoManualPanel) {
    if (!manualPreviewLoading) manualPreviewLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'manual-panel.js';
      script.addEventListener('load', resolve, { once: true });
      script.addEventListener('error', () => { script.remove(); reject(new Error('无法加载手动翻译预览，请刷新后重试。')); }, { once: true });
      document.head.append(script);
    }).finally(() => { manualPreviewLoading = null; });
    await manualPreviewLoading;
  }
  if (!window.__pageLingoManualPanel) throw new Error('无法加载翻译浮窗，请刷新后重试。');
  await window.__pageLingoManualPanel.show();
}

async function openManual() {
  const button = $('open-manual');
  if (button.disabled) return;
  button.disabled = true;
  try {
    if (!extensionAvailable) {
      await openManualPreview();
      return;
    }
    const result = await chrome.runtime.sendMessage({ type: 'OPEN_TEXT_TRANSLATOR', tabId: tab?.id });
    if (!result?.ok) throw new Error(result?.error || '无法显示翻译浮窗，请在普通网页重新打开。');
    window.close();
  } catch (error) { message(error.message || '无法显示翻译浮窗，请重试。', true); }
  finally { button.disabled = false; }
}

async function init() {
  LANGUAGES.forEach(({ code, name }) => {
    const option = document.createElement('option');
    option.value = code;
    option.textContent = name;
    $('target-language').append(option);
  });
  ['open-options', 'provider-settings', 'setup-button'].forEach((id) => $(id).addEventListener('click', openOptions));
  $('open-usage').addEventListener('click', openUsage);
  $('open-manual').addEventListener('click', openManual);
  $('translate-button').addEventListener('click', startTranslation);
  $('restore-button').addEventListener('click', restorePage);
  $('selection-enabled').addEventListener('change', toggleSelection);
  $('target-language').addEventListener('change', async (event) => {
    const saved = await persistPreference({ targetLanguage: event.target.value });
    if (saved && pageStatus.completed > 0) {
      languageChanged = true;
      message('目标语言已更新，点击翻译即可应用到此页。');
      renderStatus();
    }
  });
  document.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', async () => {
    const mode = button.dataset.mode;
    if (!await persistPreference({ displayMode: mode })) return;
    if (tab?.id && pageSupported) {
      try { await chrome.tabs.sendMessage(tab.id, { type: 'PAGELINGO_MODE', mode }); }
      catch { /* Preference also applies to the next translation. */ }
    }
  }));
  try {
    if (!extensionAvailable) {
      settings = await getSettings();
      renderSettings();
      message('这是弹窗界面预览。加载 Chrome 扩展后，即可翻译当前页面。');
      return;
    }
    [settings, [tab]] = await Promise.all([getSettings(), chrome.tabs.query({ active: true, currentWindow: true })]);
    pageSupported = supportedUrl(tab?.url);
    chrome.storage?.onChanged?.addListener((changes, areaName) => {
      if (areaName === 'local' && changes[STORAGE_KEY]) void refreshStoredSettings();
      if (areaName === 'local' && changes[USAGE_STORAGE_KEY]) queueUsageRefresh();
    });
    renderSettings();
    void refreshUsage();
    if (!pageSupported) message('请在普通网页中使用翻译。浏览器内部页面和扩展商店不支持翻译。');
    await readPageStatus();
    polling = setInterval(readPageStatus, 1000);
  } catch { message('无法读取插件配置，请重新打开插件后重试。', true); }
}

if (!extensionAvailable) window.addEventListener('storage', event => { if (event.key === STORAGE_KEY) void refreshStoredSettings(); });
window.addEventListener('pagehide', () => clearInterval(polling));
init();
