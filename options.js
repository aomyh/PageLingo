import { PROVIDERS, LANGUAGES, getSettings, saveSettings, isProviderReady, getProvider, extensionAvailable, validateEndpoint } from './lib/config.js';

const $ = id => document.getElementById(id);
let settings = await getSettings();
let selectedProvider = settings.activeProvider;
let selectedMode = settings.displayMode;
let toastTimer;
let testing = false;
const drafts = new Map();

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
  history.replaceState(null, '', `#${view}`);
}
document.querySelectorAll('[data-view]').forEach(el => el.addEventListener('click', () => showView(el.dataset.view)));
document.querySelectorAll('[data-go]').forEach(el => el.addEventListener('click', () => { showView(el.dataset.go); window.scrollTo({ top: 0, behavior: 'smooth' }); }));

LANGUAGES.forEach(l => { const option = document.createElement('option'); option.value = l.code; option.textContent = l.name; $('target-language').append(option); });
$('target-language').value = settings.targetLanguage;
$('translate-dynamic').checked = settings.translateDynamic;
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

$('preview-banner').hidden = extensionAvailable;
renderOverview(); renderProviderCards(); renderProviderForm(); renderDisplayMode(); showView(location.hash.slice(1) || 'providers');
