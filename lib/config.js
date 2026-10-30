export const STORAGE_KEY = 'pagelingo.settings.v1';

export const PROVIDERS = [
  { id: 'deepseek', name: 'DeepSeek', subtitle: '深度求索', abbr: 'D', color: '#4d6bfe', protocol: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-flash', models: ['deepseek-flash', 'deepseek-v4-pro'], keyUrl: 'https://platform.deepseek.com/api_keys', description: '通用对话模型，兼顾翻译质量与成本。' },
  { id: 'openai', name: 'OpenAI', subtitle: 'GPT', abbr: '◉', color: '#222222', protocol: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5.4-nano', models: ['gpt-5.4-nano', 'gpt-5.4-mini'], keyUrl: 'https://platform.openai.com/api-keys', description: '使用轻量模型，快速处理日常网页文本。' },
  { id: 'anthropic', name: 'Claude', subtitle: 'Anthropic', abbr: '✳', color: '#c77655', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-haiku-4-5', models: ['claude-haiku-4-5', 'claude-sonnet-4-6'], keyUrl: 'https://console.anthropic.com/settings/keys', description: '原生 Messages API，适合自然流畅的文本翻译。' },
  { id: 'gemini', name: 'Gemini', subtitle: 'Google', abbr: '✦', color: '#5584ed', protocol: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-3.5-flash-lite', models: ['gemini-3.5-flash-lite', 'gemini-3.8-flash'], keyUrl: 'https://aistudio.google.com/apikey', description: '原生 Gemini API，优先使用 Flash 轻量模型。' },
  { id: 'qwen', name: '通义千问', subtitle: 'Alibaba Cloud', abbr: 'Q', color: '#7350e6', protocol: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen3.8-flash', models: ['qwen3.8-flash', 'qwen-flash'], keyUrl: 'https://bailian.console.aliyun.com/', description: '阿里云百炼兼容接口，支持自定义区域地址。' },
  { id: 'moonshot', name: 'Kimi', subtitle: 'Moonshot AI', abbr: 'K', color: '#222222', protocol: 'openai', baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k2.6', models: ['kimi-k2.6'], keyUrl: 'https://platform.moonshot.cn/console/api-keys', description: '月之暗面兼容接口，可填入账户可用模型。' },
  { id: 'zhipu', name: '智谱 GLM', subtitle: 'Z.ai', abbr: 'Z', color: '#3658dd', protocol: 'openai', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.7-flash', models: ['glm-4.7-flash'], keyUrl: 'https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys', description: '智谱开放平台，轻量 Flash 模型优先。' },
  { id: 'siliconflow', name: '硅基流动', subtitle: 'SiliconFlow', abbr: 'S', color: '#7b49e5', protocol: 'openai', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-7B-Instruct', models: ['Qwen/Qwen2.5-7B-Instruct', 'deepseek-ai/DeepSeek-V3'], keyUrl: 'https://cloud.siliconflow.cn/account/ak', description: '多模型聚合平台，可按需选择推理模型。' },
  { id: 'ollama', name: 'Ollama', subtitle: '本地模型', abbr: 'O', color: '#4c5057', protocol: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'qwen3:8b', models: ['qwen3:8b', 'gemma3:4b'], optionalKey: true, keyUrl: 'https://ollama.com/', description: '连接本机 Ollama；无需 API Key，速度取决于本机性能。' },
  { id: 'custom', name: '自定义服务', subtitle: 'OpenAI Compatible', abbr: '+', color: '#858b93', protocol: 'openai', baseUrl: 'https://api.example.com/v1', model: '', models: [], keyUrl: null, description: '接入任何兼容 OpenAI Chat Completions 的服务。' },
];

export const LANGUAGES = [
  { code: 'zh-CN', name: '简体中文' }, { code: 'zh-TW', name: '繁體中文' },
  { code: 'en', name: 'English' }, { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' }, { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' }, { code: 'es', name: 'Español' },
  { code: 'ru', name: 'Русский' }, { code: 'pt', name: 'Português' },
  { code: 'it', name: 'Italiano' }, { code: 'ar', name: 'العربية' },
];

export function defaultSettings() {
  return { activeProvider: 'deepseek', targetLanguage: 'zh-CN', displayMode: 'bilingual', concurrency: 4, batchSize: 2200, cacheEnabled: true, translateDynamic: true,
    providers: Object.fromEntries(PROVIDERS.map(p => [p.id, { apiKey: '', model: p.model, baseUrl: p.baseUrl }])) };
}

export function normalizeSettings(value = {}) {
  const defaults = defaultSettings();
  const number = (v, d, min, max) => Number.isFinite(Number(v)) ? Math.max(min, Math.min(max, Math.round(Number(v)))) : d;
  return {
    activeProvider: PROVIDERS.some(p => p.id === value.activeProvider) ? value.activeProvider : defaults.activeProvider,
    targetLanguage: LANGUAGES.some(l => l.code === value.targetLanguage) ? value.targetLanguage : defaults.targetLanguage,
    displayMode: value.displayMode === 'translated' ? 'translated' : 'bilingual',
    concurrency: number(value.concurrency ?? 4, 4, 1, 8), batchSize: number(value.batchSize ?? 2200, 2200, 500, 6000),
    cacheEnabled: value.cacheEnabled !== false, translateDynamic: value.translateDynamic !== false,
    providers: Object.fromEntries(PROVIDERS.map(p => {
      const v = value.providers?.[p.id] || {};
      return [p.id, { apiKey: typeof v.apiKey === 'string' ? v.apiKey.trim() : '', model: typeof v.model === 'string' ? v.model.trim() : p.model, baseUrl: typeof v.baseUrl === 'string' && v.baseUrl.trim() ? v.baseUrl.trim().replace(/\/+$/, '') : p.baseUrl }];
    })),
  };
}

export function getProvider(settings) { return PROVIDERS.find(p => p.id === settings.activeProvider) || PROVIDERS[0]; }
export function isProviderReady(settings) {
  const p = getProvider(settings), c = settings.providers?.[p.id];
  return Boolean(c?.model && c?.baseUrl && (p.optionalKey || c?.apiKey));
}
export const extensionAvailable = Boolean(globalThis.chrome?.runtime?.id && globalThis.chrome?.storage?.local);
export async function getSettings() {
  if (extensionAvailable) return normalizeSettings((await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY]);
  try { return normalizeSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')); } catch { return defaultSettings(); }
}
export async function saveSettings(settings) {
  const normalized = normalizeSettings(settings);
  if (extensionAvailable) await chrome.storage.local.set({ [STORAGE_KEY]: normalized });
  else localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function validateEndpoint(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('请输入有效的 API 地址。'); }
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error('API 地址须使用 HTTPS；本地模型可使用 HTTP。');
  if (url.username || url.password || url.search || url.hash) throw new Error('API 地址不能包含密码、查询参数或锚点。');
  return url;
}
