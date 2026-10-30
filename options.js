import { PROVIDERS, LANGUAGES, STORAGE_KEY, getSettings, saveSettings, isProviderReady, getProvider, extensionAvailable, validateEndpoint } from './lib/config.js';
import { requestSelectionPermission } from './lib/permissions.js';
import { THEMES, normalizeTheme, applyTheme } from './lib/theme.js';

const $ = id => document.getElementById(id);
let settings = await getSettings();
applyTheme(document.documentElement, settings.theme);
let selectedProvider = settings.activeProvider;
let selectedMode = settings.displayMode;
let toastTimer;
let testing = false;
const drafts = new Map();
const USAGE_STORAGE_KEY = 'pagelingo.usage.v1';
const usagePeriods = new Set(['today', '7d', '30d', 'all']);
let usagePeriod = 'today';
let usageRequest = 0;
let usageTimer;
let usageChangeTimer;
let usageClearing = false;
let usageHasSnapshot = false;
let themeSaving = false;
let pendingTheme;
let settingsUpdateEpoch = 0;

function notify(message) {
  $('toast-text').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3200);
}
function providerConfig() {
  return { apiKey: $('api-key').value.trim(), model: $('model').value.trim(), baseUrl: $('base-url').value.trim().replace(/\/+$/, '') };
}
function rememberDraft() { drafts.set(selectedProvider, providerConfig()); }
function configured(provider) {
  const c = settings.providers[provider.id];
  return Boolean(c?.model && (c?.apiKey || provider.optionalKey) && c?.baseUrl);
}
function renderOverview() {
  const p = getProvider(settings);
  const text = document.createTextNode(`${p.name} `);
  const status = document.createElement('span');
  status.className = `stat-status${isProviderReady(settings) ? ' ready' : ''}`;
  status.textContent = isProviderReady(settings) ? '使用中' : '待配置';
  $('summary-provider').replaceChildren(text, status);
  const mode = document.createElement('span'); mode.className = 'stat-light';
  mode.textContent = `/ ${settings.displayMode === 'bilingual' ? '双语对照' : '仅显示译文'}`;
  $('summary-language').replaceChildren(document.createTextNode(`${LANGUAGES.find(l => l.code === settings.targetLanguage)?.name} `), mode);
  const cache = document.createElement('span'); cache.className = 'stat-light'; cache.textContent = settings.cacheEnabled ? '+ 智能缓存' : '/ 缓存关闭';
  $('summary-speed').replaceChildren(document.createTextNode(`${settings.concurrency} 路并发 `), cache);
  $('test-target-label').textContent = LANGUAGES.find(l => l.code === settings.targetLanguage)?.name || '简体中文';
}
function renderProviderCards() {
  $('provider-grid').replaceChildren(...PROVIDERS.map(provider => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `provider-card${selectedProvider === provider.id ? ' selected' : ''}`;
    button.setAttribute('aria-pressed', String(selectedProvider === provider.id));
    button.setAttribute('aria-label', `${provider.name}，${configured(provider) ? '已配置' : '尚未配置'}`);
    const icon = document.createElement('span'); icon.className = 'provider-icon'; icon.textContent = provider.abbr; icon.style.color = provider.color;
    const nameContainer = document.createElement('span');
    const name = document.createElement('span'); name.className = 'provider-name'; name.textContent = provider.name;
    const subtitle = document.createElement('span'); subtitle.className = 'provider-subtitle'; subtitle.textContent = provider.subtitle;
    nameContainer.append(name, subtitle); button.append(icon, nameContainer);
    if (configured(provider)) { const dot = document.createElement('span'); dot.className = 'configured-dot'; dot.title = '已配置'; button.append(dot); }
    if (selectedProvider === provider.id) { const tick = document.createElement('span'); tick.className = 'selection-tick'; tick.textContent = '✓'; button.append(tick); }
    button.addEventListener('click', () => {
      if (selectedProvider === provider.id) return;
      rememberDraft(); selectedProvider = provider.id;
      renderProviderCards(); renderProviderForm();
    });
    return button;
  }));
}
function renderProviderForm() {
  const p = PROVIDERS.find(p => p.id === selectedProvider), c = drafts.get(p.id) || settings.providers[p.id];
  $('config-icon').textContent = p.abbr; $('config-icon').style.color = p.color;
  $('config-title').textContent = `${p.name} 配置`;
  $('config-description').textContent = p.description;
  $('config-badge').textContent = configured(p) ? settings.activeProvider === p.id ? '正在使用' : '已配置' : p.optionalKey ? '无需密钥' : '尚未配置';
  $('config-badge').classList.toggle('ready', configured(p));
  $('api-key').value = c.apiKey; $('api-key').type = 'password';
  $('toggle-key').setAttribute('aria-label', '显示 API 密钥'); $('toggle-key').title = '显示 API 密钥';
  $('api-key').placeholder = p.optionalKey ? '本地服务可留空' : '输入你的 API Key';
  $('key-optional').textContent = p.optionalKey ? '可选' : '';
  $('model').value = c.model; $('base-url').value = c.baseUrl;
  $('model-list').replaceChildren(...p.models.map(m => { const option = document.createElement('option'); option.value = m; return option; }));
  $('get-key-link').hidden = !p.keyUrl;
  if (p.keyUrl) { $('get-key-link').href = p.keyUrl; $('get-key-link').textContent = p.optionalKey ? '了解 Ollama ↗' : '获取 API Key ↗'; }
  $('endpoint-details').open = ['custom', 'ollama'].includes(p.id);
  $('provider-error').hidden = true;
  $('connection-status').className = 'connection-status';
  $('connection-status').textContent = '测试会向所选服务商发送这句示例文本。';
  $('test-result').textContent = '译文将在连接成功后显示';
  $('unsaved-label').textContent = drafts.has(p.id) ? '有未保存的修改' : '修改后记得保存';
}
function validatedConfig(requireKey = false) {
  const p = PROVIDERS.find(p => p.id === selectedProvider), config = providerConfig();
  if (requireKey && !config.apiKey && !p.optionalKey) throw new Error('请填写 API 密钥后再继续。');
  if (!config.model) throw new Error('请输入你的翻译模型 ID。');
  const url = validateEndpoint(config.baseUrl);
  if (url.hostname === 'api.example.com') throw new Error('请将示例地址改为你的实际 API 服务地址。');
  return { p, config, url };
}
async function requestAccess(url) {
  if (!extensionAvailable) return true;
  // Called directly in the save/test gesture. Host patterns intentionally omit ports.
  const allowed = await chrome.permissions.request({ origins: [`${url.protocol}//${url.hostname}/*`] });
  if (!allowed) throw new Error('未获得此 AI 服务的访问权限，请再次点击并允许访问。');
  return true;
}
function formError(error) {
  $('provider-error').textContent = error.message || '操作失败，请重试。';
  $('provider-error').hidden = false;
}
$('provider-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const { p, config, url } = validatedConfig();
    if (config.apiKey || p.optionalKey) await requestAccess(url);
    $('save-provider').disabled = true;
    const latest = await getSettings();
    latest.providers[p.id] = config; latest.activeProvider = p.id;
    settings = await saveSettings(latest);
    drafts.delete(p.id);
    renderOverview(); renderProviderCards(); renderProviderForm();
    notify(extensionAvailable ? isProviderReady(settings) ? `已保存，正在使用 ${p.name}` : '配置已保存，填写密钥后即可翻译' : '预览配置已保存 · 安装扩展后可使用');
  } catch (error) { formError(error); }
  finally { $('save-provider').disabled = false; }
});
$('toggle-key').addEventListener('click', () => {
  const visible = $('api-key').type === 'password';
  $('api-key').type = visible ? 'text' : 'password';
  $('toggle-key').setAttribute('aria-label', visible ? '隐藏 API 密钥' : '显示 API 密钥');
  $('toggle-key').title = visible ? '隐藏 API 密钥' : '显示 API 密钥';
});
['api-key', 'model', 'base-url'].forEach(id => $(id).addEventListener('input', () => {
  rememberDraft(); $('unsaved-label').textContent = '有未保存的修改'; $('provider-error').hidden = true;
}));
$('test-connection').addEventListener('click', async () => {
  if (testing) return;
  if (!extensionAvailable) { notify('连接测试需要在已加载的 Chrome 扩展中使用'); return; }
  let testProvider;
  try {
    const { p, config, url } = validatedConfig(true);
    testProvider = p.id;
    await requestAccess(url);
    testing = true; $('test-connection').disabled = true;
    $('test-connection').querySelector('span').textContent = '正在连接…';
    $('connection-status').className = 'connection-status';
    $('connection-status').textContent = '正在等待模型响应…';
    const result = await chrome.runtime.sendMessage({ type: 'TEST_CONNECTION', providerId: p.id, config, targetLanguage: settings.targetLanguage, text: 'Stay curious. The world is yours to explore.' });
    if (!result?.ok) throw new Error(result?.error || '连接测试失败，请重试。');
    if (selectedProvider !== testProvider) { notify(`${p.name} 连接成功`); return; }
    $('test-result').textContent = result.preview;
    $('connection-status').textContent = `连接成功 · 示例耗时 ${(result.latency / 1000).toFixed(2)} 秒`;
    $('connection-status').classList.add('success');
    $('provider-error').hidden = true;
  } catch (error) {
    if (!testProvider || selectedProvider === testProvider) {
      $('connection-status').textContent = error.message || '连接失败，请重试。';
      $('connection-status').className = 'connection-status error';
      formError(error);
    }
  } finally {
    testing = false; $('test-connection').disabled = false;
    $('test-connection').querySelector('span').textContent = '测试连接';
  }
});

const views = {
  providers: ['AI 服务商', '让语言，不再是边界', '连接你信赖的 AI，让每个网页都像母语一样自然。'],
  preferences: ['翻译偏好', '用你熟悉的方式，阅读世界', '选择一种语言，找到属于你的阅读节奏。'],
  performance: ['速度与缓存', '少一点等待，多一点流畅', '让文本优先抵达，让好奇心持续向前。'],
  appearance: ['外观主题', '让阅读，也有你的风格', '选择一种喜欢的配色，让每个翻译界面都更合心意。'],
  usage: ['用量统计', '每一次翻译，都心中有数', '查看请求、Token 与缓存，了解你的 AI 翻译用量。'],
};
function showView(view) {
  if (!views[view]) return;
  document.querySelectorAll('.view').forEach(el => { el.hidden = el.id !== `view-${view}`; });
  document.querySelectorAll('[data-view]').forEach(el => { el.classList.toggle('active', el.dataset.view === view); el.setAttribute('aria-current', el.dataset.view === view ? 'page' : 'false'); });
  $('breadcrumb-current').textContent = views[view][0];
  const dot = document.createElement('span'); dot.className = 'lime-period'; dot.textContent = '.';
  $('page-title').replaceChildren(document.createTextNode(views[view][1]), dot);
  $('page-description').textContent = views[view][2];
  if (view === 'performance') refreshCacheStats();
  clearInterval(usageTimer);
  if (view === 'usage') {
    refreshUsageStats();
    if (extensionAvailable) usageTimer = setInterval(() => {
      if (!document.hidden && !usageClearing) refreshUsageStats({ quiet: true });
    }, 5000);
  } else {
    ++usageRequest;
    setUsageBusy(false);
    closeUsageReset();
  }
  history.replaceState(null, '', `#${view}`);
}
document.querySelectorAll('[data-view]').forEach(el => el.addEventListener('click', () => showView(el.dataset.view)));
document.querySelectorAll('[data-go]').forEach(el => el.addEventListener('click', () => { showView(el.dataset.go); window.scrollTo({ top: 0, behavior: 'smooth' }); }));

LANGUAGES.forEach(l => { const option = document.createElement('option'); option.value = l.code; option.textContent = l.name; $('target-language').append(option); });
$('target-language').value = settings.targetLanguage;
$('translate-dynamic').checked = settings.translateDynamic;
$('selection-enabled').checked = settings.selectionEnabled;
$('selection-setting-status').textContent = settings.selectionEnabled ? '已开启 · 复用当前 AI 服务与目标语言' : '首次开启时，Chrome 会请求网页访问权限。';
$('selection-enabled').addEventListener('change', async event => {
  const control = event.target;
  const enabled = control.checked;
  control.disabled = true;
  try {
    // Request synchronously from the checkbox gesture, before any storage/network work.
    const permission = extensionAvailable && enabled
      ? requestSelectionPermission()
      : Promise.resolve(true);
    if (!await permission) throw new Error('未获得网页访问权限，划词翻译保持关闭。');
    if (extensionAvailable) {
      const result = await chrome.runtime.sendMessage({ type: 'SET_SELECTION_ENABLED', enabled });
      if (!result?.ok) throw new Error(result?.error || '划词翻译设置失败，请重试。');
      settings = await getSettings();
    } else settings = await saveSettings({ ...await getSettings(), selectionEnabled: enabled });
    control.checked = settings.selectionEnabled;
    $('selection-setting-status').textContent = extensionAvailable
      ? settings.selectionEnabled ? '已开启 · 选中文字即可翻译' : '已关闭 · 所有标签页立即生效'
      : '已保存预览设置，加载扩展后可使用划词翻译。';
    notify(extensionAvailable ? settings.selectionEnabled ? '划词翻译已开启' : '划词翻译已关闭' : '划词翻译预览设置已保存');
  } catch (error) {
    try { settings = await getSettings(); } catch { /* Keep the last confirmed preference if storage is unavailable. */ }
    control.checked = settings.selectionEnabled;
    $('selection-setting-status').textContent = error.message || '操作失败，请重试。';
    notify(error.message || '操作失败，请重试');
  } finally { control.disabled = false; }
});
function refreshExternalSettings() {
  const epoch = ++settingsUpdateEpoch;
  getSettings().then(latest => {
    if (epoch !== settingsUpdateEpoch) return;
    settings = latest;
    applyTheme(document.documentElement, latest.theme);
    if (!themeSaving) $('theme-save-status').classList.remove('error');
    renderThemeChoices();
    if (!$('selection-enabled').disabled) {
      $('selection-enabled').checked = latest.selectionEnabled;
      $('selection-setting-status').textContent = latest.selectionEnabled ? '已开启 · 复用当前 AI 服务与目标语言' : '已关闭 · 可在插件弹窗快捷开启';
    }
    renderOverview();
  }).catch(() => {});
}
if (extensionAvailable) chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[STORAGE_KEY]) refreshExternalSettings();
});
else window.addEventListener('storage', event => { if (event.key === STORAGE_KEY) refreshExternalSettings(); });
function renderDisplayMode() {
  document.querySelectorAll('#display-mode [data-mode]').forEach(el => { el.classList.toggle('active', el.dataset.mode === selectedMode); el.setAttribute('aria-pressed', String(el.dataset.mode === selectedMode)); });
  $('reading-original').hidden = selectedMode === 'translated';
}
document.querySelectorAll('#display-mode [data-mode]').forEach(el => el.addEventListener('click', () => { selectedMode = el.dataset.mode; renderDisplayMode(); }));
$('preferences-form').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    settings = await saveSettings({ ...await getSettings(), targetLanguage: $('target-language').value, displayMode: selectedMode, translateDynamic: $('translate-dynamic').checked });
    renderOverview(); notify('翻译偏好已保存');
  } catch { notify('保存失败，请重试'); }
});
$('concurrency').value = settings.concurrency;
$('concurrency-value').textContent = `${settings.concurrency} 路`;
$('concurrency').addEventListener('input', () => { $('concurrency-value').textContent = `${$('concurrency').value} 路`; });
if (!Array.from($('batch-size').options).some(o => Number(o.value) === settings.batchSize)) {
  const option = document.createElement('option'); option.value = settings.batchSize; option.textContent = `自定义 · ${settings.batchSize.toLocaleString()} 字符`; $('batch-size').append(option);
}
$('batch-size').value = settings.batchSize; $('cache-enabled').checked = settings.cacheEnabled;
$('performance-form').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    settings = await saveSettings({ ...await getSettings(), concurrency: Number($('concurrency').value), batchSize: Number($('batch-size').value), cacheEnabled: $('cache-enabled').checked });
    renderOverview(); notify('加速设置已保存');
  } catch { notify('保存失败，请重试'); }
});
async function refreshCacheStats() {
  if (!extensionAvailable) { $('cache-stats').textContent = '加载 Chrome 扩展后，可查看并管理本地缓存。'; $('clear-cache').disabled = true; return; }
  try {
    const result = await chrome.runtime.sendMessage({ type: 'CACHE_STATS' });
    if (!result?.ok) throw new Error();
    const bytes = result.bytes || 0;
    $('cache-stats').textContent = `已缓存 ${result.entries.toLocaleString()} 段译文 · 约 ${bytes < 1048576 ? (bytes / 1024).toFixed(1) + ' KB' : (bytes / 1048576).toFixed(1) + ' MB'}`;
  } catch { $('cache-stats').textContent = '暂时无法读取缓存，请重试。'; }
}
$('clear-cache').addEventListener('click', async () => {
  $('clear-cache').disabled = true;
  try { const result = await chrome.runtime.sendMessage({ type: 'CLEAR_CACHE' }); if (!result?.ok) throw new Error(); await refreshCacheStats(); notify('本地翻译缓存已清空'); }
  catch { notify('缓存清理失败，请重试'); }
  finally { $('clear-cache').disabled = false; }
});

function usageNumber(value) {
  return Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0);
}
function usageCount(value) { return usageNumber(value).toLocaleString('zh-CN'); }
function usageTimestamp(value) {
  if (value == null || value === '') return 0;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
}
function usagePercent(value) {
  return `${Math.min(100, usageNumber(value)).toLocaleString('zh-CN', { maximumFractionDigits: 1 })}%`;
}
function usageStatus(message = '', error = false) {
  $('usage-status').textContent = message;
  $('usage-status').hidden = !message;
  $('usage-status').classList.toggle('error', error);
}
function setUsageBusy(busy) {
  $('usage-content').setAttribute('aria-busy', String(busy));
  $('refresh-usage').disabled = busy || !extensionAvailable || usageClearing;
  $('refresh-usage').querySelector('span').textContent = busy ? '正在刷新…' : '刷新统计';
}
function emptyUsageDays() {
  const length = usagePeriod === '7d' ? 7 : usagePeriod === '30d' || usagePeriod === 'all' ? 30 : 1;
  return Array.from({ length }, (_, index) => {
    const day = new Date();
    day.setDate(day.getDate() - length + index + 1);
    return { date: `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`, requests: 0 };
  });
}
function usageDayLabel(date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date));
  return match ? `${Number(match[2])}/${Number(match[3])}` : String(date || '');
}
function renderUsageChart(days) {
  const visibleDays = (Array.isArray(days) && days.length ? days : emptyUsageDays()).slice(-30);
  const maximum = Math.max(0, ...visibleDays.map(day => usageNumber(day.requests)));
  $('usage-chart-max').textContent = usageCount(maximum);
  $('usage-chart-empty').hidden = maximum > 0;
  $('usage-chart').style.setProperty('--usage-columns', String(visibleDays.length));
  $('usage-chart').replaceChildren(...visibleDays.map((day, index) => {
    const requests = usageNumber(day.requests);
    const bar = document.createElement('div');
    bar.className = 'usage-bar';
    bar.setAttribute('role', 'listitem');
    bar.title = `${day.date} · ${usageCount(requests)} 次 API 请求`;
    bar.setAttribute('aria-label', bar.title);
    const column = document.createElement('div'); column.className = 'usage-bar-column';
    const fill = document.createElement('span'); fill.className = 'usage-bar-fill';
    fill.style.height = `${maximum ? requests / maximum * 100 : 0}%`;
    column.append(fill);
    const label = document.createElement('span'); label.className = 'usage-bar-label';
    label.setAttribute('aria-hidden', 'true');
    const interval = visibleDays.length > 15 ? 5 : visibleDays.length > 10 ? 2 : 1;
    label.textContent = index % interval === 0 || index === visibleDays.length - 1 ? usageDayLabel(day.date) : '';
    bar.append(column, label);
    return bar;
  }));
  const range = visibleDays.length ? `${visibleDays[0].date} — ${visibleDays.at(-1).date}` : '';
  $('usage-chart-caption').textContent = `每日 API 请求次数 · ${range}${usagePeriod === 'all' ? '（上方为累计汇总）' : ''}`;
}
function renderUsageBreakdown(breakdown) {
  const rows = Array.isArray(breakdown) ? breakdown : [];
  $('usage-breakdown-empty').hidden = rows.length > 0;
  $('usage-breakdown').replaceChildren(...rows.map(row => {
    const tr = document.createElement('tr');
    const providerCell = document.createElement('td');
    const name = document.createElement('strong');
    name.textContent = row.providerId === 'other' ? '其他' : PROVIDERS.find(provider => provider.id === row.providerId)?.name || String(row.providerId || '未知服务商');
    const model = document.createElement('span'); model.className = 'usage-model'; model.textContent = String(row.model || '未记录模型');
    providerCell.append(name, model);
    const requests = document.createElement('td'); requests.textContent = usageCount(row.requests);
    const requestDetail = document.createElement('span'); requestDetail.className = 'usage-cell-detail';
    requestDetail.textContent = `成功 ${usageCount(row.successfulRequests)} · 失败 ${usageCount(row.failedRequests)}`;
    requests.append(requestDetail);
    const characters = document.createElement('td'); characters.textContent = usageCount(row.translatedCharacters);
    const tokens = document.createElement('td');
    tokens.textContent = usageNumber(row.requests) && !usageNumber(row.requestsWithUsage) ? '—' : usageCount(row.totalTokens);
    const tokenDetail = document.createElement('span'); tokenDetail.className = 'usage-cell-detail';
    tokenDetail.textContent = usageNumber(row.requestsWithoutUsage)
      ? `${usageCount(row.requestsWithoutUsage)} 次未返回 Token`
      : `输入 ${usageCount(row.inputTokens)} · 输出 ${usageCount(row.outputTokens)}`;
    tokens.append(tokenDetail);
    const cache = document.createElement('td');
    cache.textContent = usageNumber(row.totalItems) ? usagePercent(row.cacheHitRate ?? usageNumber(row.cacheHits) / usageNumber(row.totalItems) * 100) : '—';
    const cacheDetail = document.createElement('span'); cacheDetail.className = 'usage-cell-detail'; cacheDetail.textContent = `${usageCount(row.cacheHits)} 段命中`;
    cache.append(cacheDetail);
    tr.append(providerCell, requests, characters, tokens, cache);
    return tr;
  }));
}
function renderUsageStats(result) {
  const summary = result.summary || {};
  const requests = usageNumber(summary.requests);
  const missing = usageNumber(summary.requestsWithoutUsage);
  const hasTokenUsage = usageNumber(summary.requestsWithUsage) > 0;
  $('usage-requests').textContent = usageCount(requests);
  $('usage-request-detail').textContent = `成功 ${usageCount(summary.successfulRequests)} · 失败 ${usageCount(summary.failedRequests)} · 取消 ${usageCount(summary.cancelledRequests)}`;
  $('usage-characters').textContent = usageCount(summary.translatedCharacters);
  $('usage-character-detail').textContent = usageNumber(summary.translatedItems)
    ? `${usageCount(summary.translatedItems)} 段内容 · 含 ${usageCount(summary.cacheHits)} 段缓存复用`
    : '暂无成功翻译片段';
  $('usage-tokens').textContent = requests && !hasTokenUsage ? '—' : usageCount(summary.totalTokens);
  $('usage-token-detail').textContent = requests && !hasTokenUsage
    ? '服务商尚未返回 Token 用量'
    : `输入 ${usageCount(summary.inputTokens)} · 输出 ${usageCount(summary.outputTokens)}`;
  $('usage-cache-rate').textContent = usageNumber(summary.totalItems)
    ? usagePercent(summary.cacheHitRate ?? usageNumber(summary.cacheHits) / usageNumber(summary.totalItems) * 100) : '—';
  $('usage-cache-detail').textContent = usageNumber(summary.totalItems)
    ? `${usageCount(summary.cacheHits)} / ${usageCount(summary.totalItems)} 段直接复用缓存` : '暂无翻译片段';
  $('usage-success-rate').textContent = requests ? usagePercent(usageNumber(summary.successfulRequests) / requests * 100) : '—';
  $('usage-retry-detail').textContent = requests ? `包含 ${usageCount(summary.retries)} 次自动重试` : '暂无 API 请求';
  $('usage-latency').textContent = requests
    ? `${(usageNumber(summary.averageLatencyMs ?? usageNumber(summary.durationMs) / requests) / 1000).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 秒` : '—';
  $('usage-token-note').classList.toggle('incomplete', missing > 0);
  $('usage-token-note').textContent = `${missing ? `${usageCount(missing)} 次请求未返回 Token，用量合计不完整。` : ''}Token 仅汇总服务商实际返回的数据，不估算用量或费用，也不代表账户账单。${usageNumber(summary.cachedInputTokens) ? `其中缓存输入 ${usageCount(summary.cachedInputTokens)} Token，已计入输入。` : ''}`;
  renderUsageChart(result.days);
  $('usage-chart-empty').textContent = usageNumber(summary.translatedItems) || requests
    ? '图中时段暂无 API 请求。直接复用缓存不会产生新的 API 请求。'
    : '还没有使用记录。开始一次网页或划词翻译，统计会自动出现在这里。';
  renderUsageBreakdown(result.breakdown);
  $('usage-breakdown-note').textContent = result.breakdownCompacted
    ? '为控制本机存储占用，部分模型明细已合并为“其他”；总量保持完整。'
    : '了解每一个翻译引擎的实际使用情况。';
  const updated = usageTimestamp(result.updatedAt);
  const started = usageTimestamp(result.startedAt);
  const dateOptions = { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' };
  if (result.timezone) dateOptions.timeZone = result.timezone;
  try {
    $('usage-updated').textContent = updated > 0
      ? `上次记录 ${new Date(updated).toLocaleString('zh-CN', dateOptions)}${result.timezone ? `（${result.timezone}）` : ''}。${started > 0 ? `自 ${new Date(started).toLocaleDateString('zh-CN', { ...(result.timezone ? { timeZone: result.timezone } : {}) })} 起累计。` : ''}`
      : '从安装此版本后开始累计。';
  } catch { $('usage-updated').textContent = '从安装此版本后开始累计。'; }
}
async function refreshUsageStats({ quiet = false } = {}) {
  if (usageClearing) return;
  const request = ++usageRequest;
  const period = usagePeriod;
  if (!extensionAvailable) {
    renderUsageStats({ summary: {}, days: emptyUsageDays(), breakdown: [] });
    $('usage-content').hidden = false;
    usageStatus('当前为页面预览，无法读取真实用量。加载 Chrome 扩展后，统计会从首次使用开始累计。');
    $('reset-usage').disabled = true;
    setUsageBusy(false);
    return;
  }
  if (!quiet) {
    setUsageBusy(true);
    if (!usageHasSnapshot) {
      $('usage-content').hidden = true;
      $('reset-usage').disabled = true;
      usageStatus('正在读取本地用量统计…');
    }
  }
  try {
    const result = await chrome.runtime.sendMessage({ type: 'GET_USAGE_STATS', period });
    if (request !== usageRequest || $('view-usage').hidden) return;
    if (!result?.ok) throw new Error(result?.error || '无法读取用量统计，请稍后刷新重试。');
    usageHasSnapshot = true;
    renderUsageStats(result);
    $('usage-content').hidden = false;
    $('reset-usage').disabled = false;
    usageStatus();
  } catch (error) {
    if (request !== usageRequest || $('view-usage').hidden) return;
    usageStatus(`${error.message || '无法读取用量统计，请稍后刷新重试。'}${usageHasSnapshot ? ' 当前显示上一次成功读取的数据。' : ''}`, true);
  } finally {
    if (request === usageRequest) setUsageBusy(false);
  }
}
function closeUsageReset() {
  if (usageClearing) return;
  $('usage-reset-confirm').hidden = true;
  $('reset-usage').hidden = false;
}
document.querySelectorAll('[data-usage-period]').forEach(button => button.addEventListener('click', () => {
  if (!usagePeriods.has(button.dataset.usagePeriod) || usageClearing) return;
  usagePeriod = button.dataset.usagePeriod;
  document.querySelectorAll('[data-usage-period]').forEach(control => control.setAttribute('aria-pressed', String(control.dataset.usagePeriod === usagePeriod)));
  closeUsageReset();
  refreshUsageStats();
}));
$('refresh-usage').addEventListener('click', () => refreshUsageStats());
$('reset-usage').addEventListener('click', () => {
  if (!extensionAvailable || usageClearing) return;
  $('usage-reset-confirm').hidden = false;
  $('reset-usage').hidden = true;
  $('cancel-reset-usage').focus();
});
$('cancel-reset-usage').addEventListener('click', () => { closeUsageReset(); $('reset-usage').focus(); });
$('confirm-reset-usage').addEventListener('click', async () => {
  if (!extensionAvailable || usageClearing) return;
  usageClearing = true;
  ++usageRequest;
  $('confirm-reset-usage').disabled = true;
  $('confirm-reset-usage').textContent = '正在清空…';
  $('cancel-reset-usage').disabled = true;
  $('refresh-usage').disabled = true;
  document.querySelectorAll('[data-usage-period]').forEach(control => { control.disabled = true; });
  try {
    const result = await chrome.runtime.sendMessage({ type: 'CLEAR_USAGE_STATS' });
    if (!result?.ok) throw new Error(result?.error || '统计清空失败，请重试。');
    usageClearing = false;
    closeUsageReset();
    usageHasSnapshot = false;
    await refreshUsageStats();
    notify('用量统计已清空，AI 配置与翻译缓存已保留');
  } catch (error) { usageStatus(error.message || '统计清空失败，请重试。', true); }
  finally {
    usageClearing = false;
    $('confirm-reset-usage').disabled = false;
    $('confirm-reset-usage').textContent = '确认清空';
    $('cancel-reset-usage').disabled = false;
    $('refresh-usage').disabled = false;
    document.querySelectorAll('[data-usage-period]').forEach(control => { control.disabled = false; });
  }
});
if (extensionAvailable) chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[USAGE_STORAGE_KEY] || $('view-usage').hidden || document.hidden) return;
  clearTimeout(usageChangeTimer);
  usageChangeTimer = setTimeout(() => refreshUsageStats({ quiet: true }), 180);
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !$('view-usage').hidden) refreshUsageStats({ quiet: true });
});
window.addEventListener('pagehide', () => { clearInterval(usageTimer); clearTimeout(usageChangeTimer); });

function renderThemeChoices() {
  const selected = normalizeTheme(pendingTheme || settings.theme);
  for (const button of $('theme-grid').querySelectorAll('[data-theme-id]')) {
    const active = button.dataset.themeId === selected;
    button.setAttribute('aria-pressed', String(active));
    button.disabled = themeSaving;
    button.querySelector('.theme-current').textContent = active ? '使用中' : '选择主题';
  }
  if (!themeSaving) $('theme-save-status').textContent = `当前主题：${THEMES.find(theme => theme.id === selected)?.name || selected} · ${extensionAvailable ? '已保存，所有翻译界面同步生效' : '预览主题已保存在此浏览器'}`;
}
async function chooseTheme(id) {
  if (themeSaving || !THEMES.some(theme => theme.id === id) || normalizeTheme(settings.theme) === id) return;
  themeSaving = true;
  pendingTheme = id;
  applyTheme(document.documentElement, id);
  renderThemeChoices();
  $('theme-save-status').textContent = '正在保存主题…';
  $('theme-save-status').classList.remove('error');
  try {
    const latest = await getSettings();
    settings = await saveSettings({ ...latest, theme: id });
    applyTheme(document.documentElement, settings.theme);
  } catch {
    try { settings = await getSettings(); } catch { /* Keep the last saved settings if storage is unavailable. */ }
    applyTheme(document.documentElement, settings.theme);
    $('theme-save-status').classList.add('error');
  } finally {
    const failed = $('theme-save-status').classList.contains('error');
    themeSaving = false;
    pendingTheme = undefined;
    renderThemeChoices();
    if (failed) $('theme-save-status').textContent = '主题保存失败，已恢复原主题，请重试。';
  }
}
function createThemeChoices() {
  $('theme-grid').replaceChildren(...THEMES.map(theme => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'theme-card'; button.dataset.themeId = theme.id;
    button.setAttribute('aria-label', `${theme.name}，${theme.description}`);
    const preview = document.createElement('span'); preview.className = 'theme-preview'; preview.setAttribute('aria-hidden', 'true');
    for (const [key, color] of Object.entries(theme.preview)) preview.style.setProperty(`--preview-${key}`, color);
    const bar = document.createElement('span'); bar.className = 'theme-preview-top';
    for (let index = 0; index < 3; index++) bar.append(document.createElement('i'));
    const layout = document.createElement('span'); layout.className = 'theme-preview-layout';
    const rail = document.createElement('span'); rail.className = 'theme-preview-rail'; rail.append(document.createElement('i'), document.createElement('i'), document.createElement('i'));
    const body = document.createElement('span'); body.className = 'theme-preview-body';
    const heading = document.createElement('span'); heading.className = 'theme-preview-heading';
    const line = document.createElement('span'); line.className = 'theme-preview-line';
    const block = document.createElement('span'); block.className = 'theme-preview-block';
    const action = document.createElement('span'); action.className = 'theme-preview-action';
    body.append(heading, line, block, action); layout.append(rail, body); preview.append(bar, layout);
    const info = document.createElement('span'); info.className = 'theme-info';
    const name = document.createElement('strong'); name.textContent = theme.name;
    const description = document.createElement('span'); description.textContent = theme.description;
    const current = document.createElement('span'); current.className = 'theme-current';
    info.append(name, description, current); button.append(preview, info);
    button.addEventListener('click', () => chooseTheme(theme.id));
    return button;
  }));
  renderThemeChoices();
}
createThemeChoices();

$('preview-banner').hidden = extensionAvailable;
renderOverview(); renderProviderCards(); renderProviderForm(); renderDisplayMode(); showView(location.hash.slice(1) || 'providers');
