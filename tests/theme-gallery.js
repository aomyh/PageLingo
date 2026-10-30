(() => {
  'use strict';
  const params = new URLSearchParams(location.search);
  if (params.has('fixture')) return;
  const root = new URL('../', location.href), ids = ['sage', 'ocean', 'lavender', 'sand', 'midnight'];
  const names = { sage: '草木绿', ocean: '海盐蓝', lavender: '柔雾紫', sand: '暖纸棕', midnight: '午夜深色' };
  const theme = ids.includes(params.get('theme')) ? params.get('theme') : 'ocean';
  const layout = params.get('layout') === 'overview' ? 'overview' : 'detail';
  const $ = id => document.getElementById(id), wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const panels = [
    { id: '01-providers', title: 'AI 服务商', kind: 'options', view: 'providers', width: 1440, height: 1200 },
    { id: '02-preferences', title: '翻译偏好', kind: 'options', view: 'preferences', width: 1440, height: 1280 },
    { id: '03-performance', title: '速度与缓存', kind: 'options', view: 'performance', width: 1440, height: 1150 },
    { id: '04-appearance', title: '外观主题', kind: 'options', view: 'appearance', width: 1440, height: 1150 },
    { id: '05-usage', title: '用量统计', kind: 'options', view: 'usage', width: 1440, height: 1450 },
    { id: '06-popup', title: '插件弹窗', note: '370 × 600 · 常用入口', kind: 'popup', width: 370, height: 600 },
    { id: '07-manual', title: '手动翻译浮窗', note: '网页内可拖动 · 演示译文', kind: 'manual', width: 1440, height: 800 },
    { id: '08-selection', title: '划词翻译', note: '原生选区 · 演示译文', kind: 'selection', width: 1440, height: 800 },
    { id: '09-page', title: '整页翻译与工具栏', note: '双语对照 · 演示译文', kind: 'page', width: 1440, height: 900 },
    { id: '10-compatibility', title: '独立手动翻译兼容页', note: '兼容保留页面 · 非常用入口', kind: 'compatibility', width: 1440, height: 1000 },
  ];
  const manualSource = 'Stay curious. The world is yours to explore.\n\nA new language is a new perspective.';
  const manualTranslation = '保持好奇，世界等你探索。\n\n一种新的语言，一种新的视角。';
  let initialSettings;

  function installMock(config, path, kind, usage, translations) {
    if (path) history.replaceState(null, '', new URL(path, document.baseURI).href);
    let settings = config;
    const storageKey = 'pagelingo.settings.v1', storageListeners = [], runtimeListeners = [], roots = new WeakMap();
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (options) { const value = attach.call(this, options); roots.set(this, value); return value; };
    const mock = window.__galleryMock = { roots, calls: [], errors: [], runtimeListeners };
    window.addEventListener('error', event => mock.errors.push(event.message));
    window.addEventListener('unhandledrejection', event => mock.errors.push(String(event.reason?.message || event.reason)));
    window.fetch = async () => { throw new Error('截图演示禁止任何网络请求'); };
    window.open = () => { throw new Error('截图演示不打开新页面'); };
    window.close = () => {};
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => {} } });
    const publicSettings = () => ({ theme: settings.theme, targetLanguage: settings.targetLanguage, displayMode: settings.displayMode, concurrency: settings.concurrency, batchSize: settings.batchSize, cacheEnabled: settings.cacheEnabled, translateDynamic: false, selectionEnabled: true, activeProvider: 'deepseek', providerName: 'DeepSeek', model: settings.providers.deepseek.model, ready: true });
    window.chrome = {
      runtime: {
        id: 'pagelingo-theme-gallery-demo', getURL: path => new URL(path, document.baseURI).href,
        getManifest: () => ({ optional_host_permissions: ['http://*/*', 'https://*/*'] }), openOptionsPage: async () => {},
        onMessage: { addListener: fn => runtimeListeners.push(fn), removeListener: fn => { const i = runtimeListeners.indexOf(fn); if (i >= 0) runtimeListeners.splice(i, 1); } },
        async sendMessage(message) {
          mock.calls.push(structuredClone(message));
          switch (message.type) {
            case 'GET_PUBLIC_SETTINGS': return { ok: true, settings: publicSettings() };
            case 'GET_MANUAL_SETTINGS': return { ok: true, settings: publicSettings(), configurationRevision: 'gallery-demo-config' };
            case 'GET_USAGE_STATS': return { ...structuredClone(usage), period: message.period || 'today' };
            case 'CACHE_STATS': return { ok: true, entries: 128, bytes: 158720 };
            case 'TRANSLATE_TEXT': return { ok: true, text: translations.manual, cached: true, providerId: 'deepseek', model: settings.providers.deepseek.model, targetLanguage: message.targetLanguage };
            case 'TRANSLATE_SELECTION': return { ok: true, text: '一点好奇心，会改变我们阅读世界的方式。', cached: true };
            case 'TRANSLATE_BATCH': return { ok: true, translations: message.items.map((item, index) => ({ id: item.id, text: translations[item.text.trim()] || `【演示译文】${item.text}`, cached: index % 2 === 0 })) };
            case 'CANCEL_TEXT_TRANSLATION': case 'CANCEL_TRANSLATION': case 'MANUAL_OPEN_OPTIONS': return { ok: true };
            default: throw new Error(`截图演示没有执行此操作：${message.type}`);
          }
        },
      },
      storage: {
        local: {
          get: async key => ({ [key]: key === storageKey ? structuredClone(settings) : undefined }),
          async set(patch) {
            if (!patch[storageKey]) throw new Error('截图演示只支持临时设置');
            const previous = settings; settings = structuredClone(patch[storageKey]);
            for (const fn of storageListeners) fn({ [storageKey]: { oldValue: previous, newValue: settings } }, 'local');
            for (const fn of runtimeListeners) fn({ type: 'PAGELINGO_THEME_CHANGED', theme: settings.theme }, {}, () => {});
          },
        }, onChanged: { addListener: fn => storageListeners.push(fn) },
      },
      permissions: { contains: async () => true, request: async () => { throw new Error('截图演示不请求权限'); } },
      tabs: { query: async () => [{ id: 7, url: 'https://demo.example/article' }], sendMessage: async () => ({ ok: true, status: { state: 'idle', completed: 0, total: 0, cachedCount: 0 } }), create: async () => { throw new Error('截图演示不打开标签页'); } },
      scripting: { executeScript: async () => { throw new Error('截图演示不注入其他页面'); } },
    };
    mock.publicSettings = publicSettings;
    mock.dispatch = (type, extra = {}) => { let response; for (const fn of runtimeListeners) fn({ type, ...extra }, {}, value => { response = value; }); return response; };
    if (['manual', 'selection', 'page'].includes(kind)) Object.defineProperty(chrome, 'storage', { get() { throw new Error('网页浮窗不能读取模拟密钥'); } });
  }
  function usageData() {
    const summary = { requests: 42, successfulRequests: 39, failedRequests: 2, cancelledRequests: 1, retries: 3, inputTokens: 18640, outputTokens: 11280, totalTokens: 29920, cachedInputTokens: 3840, requestsWithUsage: 39, requestsWithoutUsage: 3, translatedCharacters: 48260, translatedItems: 186, cacheHits: 54, totalItems: 240, durationMs: 35280, averageLatencyMs: 840, cacheHitRate: 22.5 };
    const days = [4, 5, 8, 7, 6, 8, 4].map((requests, index) => ({ date: `2026-10-${24 + index}`, requests }));
    const breakdown = [
      { ...summary, providerId: 'deepseek', model: 'deepseek-flash', requests: 34, successfulRequests: 32, failedRequests: 1, cancelledRequests: 1, inputTokens: 14200, outputTokens: 8800, totalTokens: 23000, translatedCharacters: 36900, cacheHits: 42, totalItems: 180, cacheHitRate: 23.3, requestsWithUsage: 32, requestsWithoutUsage: 2 },
      { ...summary, providerId: 'openai', model: 'gpt-5.4-nano', requests: 8, successfulRequests: 7, failedRequests: 1, cancelledRequests: 0, inputTokens: 4440, outputTokens: 2480, totalTokens: 6920, translatedCharacters: 11360, cacheHits: 12, totalItems: 60, cacheHitRate: 20, requestsWithUsage: 7, requestsWithoutUsage: 1 },
    ];
    return { ok: true, period: '7d', summary, days, breakdown, timezone: 'Asia/Shanghai', retentionDays: 90, startedAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-30T03:00:00.000Z' };
  }
  function translations() {
    return { manual: manualTranslation, 'FIELD NOTES': '阅读札记', 'READING THE WORLD': '读懂世界', 'A little curiosity changes the way we read.': '一点好奇心，会改变我们阅读世界的方式。', 'A new language is a new perspective.': '一种新的语言，一种新的视角。', 'Stay curious. The world is yours to explore.': '保持好奇，世界等你探索。', 'Good ideas travel beyond language. Read a little further, follow a new thought, and discover another point of view.': '好想法会跨越语言。多读一点，跟随一个新念头，发现另一种看待世界的方式。', 'Translation should feel like part of reading: quiet, immediate, and always close to the words that matter.': '翻译应该成为阅读的一部分：安静、及时，始终陪伴那些重要的文字。', 'Make room for another perspective.': '为另一种视角留一点空间。', 'DEMO ARTICLE · NO REAL WEBSITE DATA': '演示文章 · 不含真实网页数据' };
  }
  async function until(predicate, label) { const end = performance.now() + 9000; while (performance.now() < end) { if (predicate()) return; await wait(20); } throw new Error(`等待超时：${label}`); }
  async function textFile(file) { const result = await fetch(new URL(file, root), { cache: 'no-store', signal: AbortSignal.timeout(9000) }); if (!result.ok) throw new Error(`${file}: HTTP ${result.status}`); return result.text(); }
  function installSource(path, kind) { return `(${installMock.toString()})(${JSON.stringify(initialSettings)},${JSON.stringify(path)},${JSON.stringify(kind)},${JSON.stringify(usageData())},${JSON.stringify(translations())});`; }
  async function navigateShell(frame) {
    await new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(new Error('截图 fixture 导航超时')), 9000); frame.addEventListener('load', () => { clearTimeout(timeout); resolve(); }, { once: true }); frame.src = new URL(`tests/theme-gallery.html?fixture=1&run=${Date.now()}-${Math.random()}`, root).href; });
  }
  async function loadPage(panel) {
    const file = panel.kind === 'options' ? 'options.html' : panel.kind === 'popup' ? 'popup.html' : 'translate.html';
    const doc = new DOMParser().parseFromString(await textFile(file), 'text/html');
    const entry = file.replace('.html', '.js'); doc.querySelector(`script[src="${entry}"]`)?.remove();
    const base = doc.createElement('base'); base.href = root.href; doc.head.prepend(base);
    for (const sheet of doc.querySelectorAll('link[rel="stylesheet"]')) sheet.href = new URL(`${sheet.getAttribute('href')}?gallery=${Date.now()}`, root).href;
    const install = doc.createElement('script'); install.textContent = installSource(file + (panel.view ? `#${panel.view}` : ''), panel.kind); doc.head.append(install);
    const module = doc.createElement('script'); module.type = 'module'; module.src = new URL(`${entry}?gallery=${Date.now()}`, root).href; doc.head.append(module);
    await navigateShell(panel.frame); panel.frame.contentDocument.open(); panel.frame.contentDocument.write('<!doctype html>' + doc.documentElement.outerHTML); panel.frame.contentDocument.close();
    const child = panel.frame.contentWindow, childDoc = panel.frame.contentDocument;
    await until(() => child.__galleryMock && childDoc.documentElement.dataset.theme === theme, `${panel.title}主题`);
    if (panel.kind === 'options') {
      await until(() => childDoc.querySelectorAll('[data-theme-id]').length === child.PageLingoThemes?.THEMES.length && !childDoc.getElementById(`view-${panel.view}`).hidden, panel.title);
      if (panel.view === 'usage') { childDoc.querySelector('[data-usage-period="7d"]').click(); await until(() => childDoc.getElementById('usage-requests').textContent === '42' && childDoc.getElementById('usage-content').getAttribute('aria-busy') === 'false', '演示统计'); }
      await until(() => !childDoc.fonts || childDoc.fonts.status === 'loaded', '字体');
      panel.height = Math.max(900, Math.ceil(childDoc.querySelector('.page-footer').getBoundingClientRect().bottom + 20));
      panel.frame.style.height = `${panel.height}px`;
    } else if (panel.kind === 'compatibility') await translateManual(panel, childDoc);
    else await until(() => childDoc.getElementById('provider-name').textContent === 'DeepSeek', '弹窗');
    await until(() => !childDoc.fonts || childDoc.fonts.status === 'loaded', '字体');
  }
  function article() {
    return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;min-height:100%;background:#f3f1e9;color:#26392d;font:17px/1.8 Georgia,"Times New Roman",serif}*{box-sizing:border-box}header{padding:22px 58px;border-bottom:1px solid #d8ded0;display:flex;align-items:center;justify-content:space-between;font:11px/1.6 -apple-system,BlinkMacSystemFont,sans-serif;letter-spacing:2px;color:#60705d}header strong{font-size:16px;letter-spacing:.5px;color:#344b36}main{padding:58px 66px 40px;max-width:1000px}.eyebrow{font:10px/1.6 -apple-system,BlinkMacSystemFont,sans-serif;letter-spacing:2.2px;color:#84917c}h1{font-size:44px;font-weight:400;letter-spacing:-1.4px;line-height:1.22;margin:18px 0 26px;max-width:790px}p{max-width:790px;margin:22px 0;color:#52624e;font-size:17px}blockquote{border-left:2px solid #a6b990;padding:0 0 0 20px;margin:28px 0;font-size:23px;max-width:700px;color:#506744}footer{font:9px/1.6 -apple-system,BlinkMacSystemFont,sans-serif;letter-spacing:1.2px;color:#91a085;margin-top:35px}.meta{font:11px/1.6 -apple-system,BlinkMacSystemFont,sans-serif;color:#85917d;letter-spacing:.3px}</style></head><body><header translate="no"><strong>FIELD NOTES</strong><span>READ · EXPLORE · DISCOVER</span><span>DEMO / 2026</span></header><main><div class="eyebrow">READING THE WORLD</div><h1 id="selection-source">A little curiosity changes the way we read.</h1><div class="meta" translate="no">Reading notebook · 3 minute read · Demo content</div><p>Good ideas travel beyond language. Read a little further, follow a new thought, and discover another point of view.</p><blockquote>A new language is a new perspective.</blockquote><p>Translation should feel like part of reading: quiet, immediate, and always close to the words that matter.</p><p>Stay curious. The world is yours to explore.</p><footer>DEMO ARTICLE · NO REAL WEBSITE DATA</footer></main></body></html>`;
  }
  async function inject(panel, file) {
    const script = panel.frame.contentDocument.createElement('script'); script.src = new URL(`${file}?gallery=${Date.now()}-${Math.random()}`, root).href;
    await new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(new Error(`${file}加载超时`)), 9000); script.onload = () => { clearTimeout(timeout); resolve(); }; script.onerror = () => { clearTimeout(timeout); reject(new Error(`${file}加载失败`)); }; panel.frame.contentDocument.head.append(script); });
  }
  async function translateManual(panel, scope) {
    const child = panel.frame.contentWindow, get = id => scope.getElementById(id);
    await until(() => get('manual-provider').textContent === 'DeepSeek', '手动服务商');
    get('manual-input').value = manualSource; get('manual-input').dispatchEvent(new child.Event('input', { bubbles: true })); get('manual-translate').click();
    await until(() => get('manual-output').textContent === manualTranslation && !get('manual-copy').disabled, '演示手动翻译');
    get('manual-input').blur();
  }
  async function loadContent(panel) {
    const doc = new DOMParser().parseFromString(article(), 'text/html');
    const base = doc.createElement('base'); base.href = root.href; doc.head.prepend(base);
    const install = doc.createElement('script'); install.textContent = installSource('', panel.kind); doc.head.append(install);
    await new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(new Error('演示网页加载超时')), 9000); panel.frame.addEventListener('load', () => { clearTimeout(timeout); resolve(); }, { once: true }); panel.frame.srcdoc = '<!doctype html>' + doc.documentElement.outerHTML; });
    await inject(panel, 'lib/themes.js');
    const childDoc = panel.frame.contentDocument, child = panel.frame.contentWindow, mock = child.__galleryMock;
    if (panel.kind === 'manual') {
      await inject(panel, 'manual-panel.js');
      await until(() => childDoc.querySelector('[data-pagelingo="manual"]')?.dataset.theme === theme, '手动浮窗主题');
      await translateManual(panel, mock.roots.get(childDoc.querySelector('[data-pagelingo="manual"]')));
    } else if (panel.kind === 'selection') {
      await inject(panel, 'selection.js'); await until(() => mock.calls.some(call => call.type === 'GET_PUBLIC_SETTINGS'), '划词公开设置'); await wait(30);
      const range = childDoc.createRange(); range.selectNodeContents(childDoc.getElementById('selection-source'));
      const selection = child.getSelection(); selection.removeAllRanges(); selection.addRange(range); childDoc.dispatchEvent(new child.Event('selectionchange')); childDoc.dispatchEvent(new child.MouseEvent('mouseup', { bubbles: true, button: 0 }));
      await until(() => childDoc.querySelector('[data-pagelingo="selection"]')?.dataset.state === 'complete', '演示划词结果');
    } else {
      await inject(panel, 'content.js'); mock.dispatch('PAGELINGO_START', { settings: mock.publicSettings() });
      await until(() => mock.dispatch('PAGELINGO_STATUS')?.status?.state === 'complete', '演示整页翻译');
    }
  }
  function layoutPanel(panel) {
    panel.frame.style.width = `${panel.width}px`; panel.frame.style.height = `${panel.height}px`;
    if (layout === 'overview') { const scale = panel.kind === 'popup' ? .8 : .46; panel.stage.style.height = `${Math.ceil(panel.height * scale) + (panel.kind === 'popup' ? 48 : 0)}px`; panel.frame.style.transform = `translateX(-50%) scale(${scale})`; }
    else { panel.stage.style.height = `${panel.height + (panel.kind === 'popup' ? 48 : 0)}px`; panel.frame.style.transform = ''; }
  }
  function geometry() {
    const rect = element => { const value = element.getBoundingClientRect(); return { x: value.x + scrollX, y: value.y + scrollY, width: value.width, height: value.height }; };
    const capture = (panel, frame) => {
      const role = { manual: 'manual', selection: 'selection', page: 'toolbar' }[panel.kind];
      const host = role && panel.frame.contentDocument.querySelector(`[data-pagelingo="${role}"]`);
      if (!host) return frame;
      const bounds = host.getBoundingClientRect(), padding = panel.kind === 'manual' ? { top: 24, left: 24, bottom: 24, right: 24 }
        : panel.kind === 'selection' ? { top: 8, left: 24, bottom: 24, right: 24 } : { top: 160, left: 140, bottom: 24, right: 24 };
      const left = Math.max(0, bounds.left - padding.left), top = Math.max(0, bounds.top - padding.top);
      const right = Math.min(panel.width, bounds.right + padding.right), bottom = Math.min(panel.height, bounds.bottom + padding.bottom);
      const scale = frame.width / panel.width;
      return { x: frame.x + left * scale, y: frame.y + top * scale, width: (right - left) * scale, height: (bottom - top) * scale };
    };
    const data = { theme, themeName: names[theme], layout, cssWidth: 1440, scale: devicePixelRatio, demo: true, panels: panels.map(panel => {
      const frame = rect(panel.frame), section = rect(panel.section);
      return { id: panel.id, title: panel.title, frame, frameRect: frame, rect: frame, captureRect: capture(panel, frame), panel: section, panelRect: section };
    }) };
    window.__themeGalleryGeometry = data; $('geometry').textContent = JSON.stringify(data, null, 2); return data;
  }
  async function run() {
    document.body.classList.toggle('overview', layout === 'overview'); document.documentElement.dataset.gallery = 'loading';
    $('gallery-title').textContent = `${names[theme]} · 全部 10 个界面${layout === 'overview' ? '总览' : '详细预览'}`;
    $('detail-link').href = `?theme=${theme}`; $('overview-link').href = `?theme=${theme}&layout=overview`;
    try {
      const { defaultSettings } = await import('../lib/config.js'); initialSettings = defaultSettings(); initialSettings.theme = theme; initialSettings.selectionEnabled = true;
      for (const id of ['deepseek', 'openai', 'anthropic']) initialSettings.providers[id].apiKey = `DEMO_${id.toUpperCase()}_KEY_NOT_REAL`;
      for (const panel of panels) {
        panel.section = document.createElement('section'); panel.section.className = 'gallery-panel'; panel.section.dataset.id = panel.id;
        const heading = document.createElement('h2'); heading.textContent = `${panel.id.slice(0, 2)} / ${panel.title}`;
        const note = document.createElement('span'); note.textContent = panel.note || '配置工作台 · 演示配置'; heading.append(note);
        panel.stage = document.createElement('div'); panel.stage.className = 'gallery-stage'; panel.frame = document.createElement('iframe'); panel.frame.title = panel.title; panel.stage.append(panel.frame); panel.section.append(heading, panel.stage); $('gallery').append(panel.section); layoutPanel(panel);
      }
      for (const [index, panel] of panels.entries()) {
        $('status').textContent = `正在加载 ${index + 1} / 10 · ${panel.title}`;
        try { if (['options', 'popup', 'compatibility'].includes(panel.kind)) await loadPage(panel); else await loadContent(panel); layoutPanel(panel); panel.section.dataset.ready = 'true'; }
        catch (error) { panel.section.classList.add('error'); throw new Error(`${panel.title}：${error.message}`); }
      }
      await wait(250); window.scrollTo(0, 0); geometry();
      const errors = panels.flatMap(panel => panel.frame.contentWindow.__galleryMock?.errors || []);
      if (errors.length) throw new Error(errors.join('\n'));
      $('status').textContent = '10 / 10 个正式界面就绪 · 全部为演示数据'; document.documentElement.dataset.gallery = 'ready';
      $('download-geometry').focus({ preventScroll: true });
    } catch (error) { $('status').textContent = '加载失败'; $('status').classList.add('error'); $('errors').textContent = error.stack || error.message; document.documentElement.dataset.gallery = 'error'; }
  }
  $('download-geometry').addEventListener('click', () => { const value = geometry(); const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `pagelingo-${theme}-${layout}-geometry.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
  window.addEventListener('resize', () => { if (document.documentElement.dataset.gallery === 'ready') geometry(); });
  void run();
})();
