(() => {
  'use strict';
  if (new URLSearchParams(location.search).has('fixture')) return;
  const root = new URL('../', location.href), $ = id => document.getElementById(id);
  const themes = [
    { id: 'sage', name: '草木绿' }, { id: 'ocean', name: '海盐蓝' },
    { id: 'lavender', name: '柔雾紫' }, { id: 'sand', name: '暖纸棕' },
    { id: 'midnight', name: '午夜深色' },
  ];
  const logoUrl = new URL('screenshots/previews/logo-neutral/logo-graphite.svg', root).href;
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

  function installMock(settings) {
    const errors = [];
    window.__logoColorMock = { errors };
    window.addEventListener('error', event => errors.push(event.message));
    window.addEventListener('unhandledrejection', event => errors.push(String(event.reason?.message || event.reason)));
    window.fetch = async () => { throw new Error('Logo 预览不连接 AI 或外部服务'); };
    window.open = () => { throw new Error('Logo 预览不打开页面'); };
    window.close = () => {};
    window.chrome = {
      runtime: {
        id: 'pagelingo-logo-color-preview',
        getURL: path => new URL(path, document.baseURI).href,
        getManifest: () => ({ optional_host_permissions: ['http://*/*', 'https://*/*'] }),
        openOptionsPage: async () => { throw new Error('Logo 预览不打开配置页'); },
        async sendMessage(message) {
          if (message.type === 'GET_USAGE_STATS') return { ok: true, summary: { requests: 42, totalTokens: 29920, requestsWithUsage: 42, requestsWithoutUsage: 0 } };
          throw new Error(`Logo 预览不执行操作：${message.type}`);
        },
      },
      storage: {
        local: { get: async key => ({ [key]: key === 'pagelingo.settings.v1' ? structuredClone(settings) : undefined }), set: async () => { throw new Error('Logo 预览不保存配置'); } },
        onChanged: { addListener: () => {} },
      },
      permissions: { contains: async () => true, request: async () => { throw new Error('Logo 预览不申请权限'); } },
      tabs: {
        query: async () => [{ id: 7, url: 'https://demo.example/article' }],
        sendMessage: async () => ({ ok: true, status: { state: 'idle', completed: 0, total: 0, cachedCount: 0 } }),
        create: async () => { throw new Error('Logo 预览不打开标签页'); },
      },
      scripting: { executeScript: async () => { throw new Error('Logo 预览不注入其他页面'); } },
    };
  }

  async function until(predicate, label) {
    const end = performance.now() + 10000;
    while (performance.now() < end) { if (predicate()) return; await pause(20); }
    throw new Error(`等待超时：${label}`);
  }

  async function loadPopup(theme, html, defaults) {
    const config = structuredClone(defaults);
    config.theme = theme.id;
    config.selectionEnabled = true;
    config.providers.deepseek.apiKey = 'LOGO_PREVIEW_DEMO_KEY_NOT_REAL';
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelector('script[src="popup.js"]').remove();
    const base = doc.createElement('base'); base.href = root.href; doc.head.prepend(base);
    const logo = doc.querySelector('img[src="assets/logo.svg"]'); logo.src = logoUrl;
    for (const sheet of doc.querySelectorAll('link[rel="stylesheet"]')) sheet.href = new URL(`${sheet.getAttribute('href')}?logo-preview=${Date.now()}`, root).href;
    const mock = doc.createElement('script'); mock.textContent = `(${installMock.toString()})(${JSON.stringify(config)});`; doc.head.append(mock);
    const entry = doc.createElement('script'); entry.type = 'module'; entry.src = new URL(`popup.js?logo-preview=${Date.now()}-${theme.id}`, root).href; doc.head.append(entry);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Logo 预览 fixture 导航超时')), 10000);
      theme.frame.addEventListener('load', () => { clearTimeout(timeout); resolve(); }, { once: true });
      theme.frame.src = new URL(`tests/logo-color-preview.html?fixture=1&run=${Date.now()}-${theme.id}`, root).href;
    });
    theme.frame.contentDocument.open(); theme.frame.contentDocument.write('<!doctype html>' + doc.documentElement.outerHTML); theme.frame.contentDocument.close();
    const child = theme.frame.contentWindow, childDoc = theme.frame.contentDocument;
    await until(() => childDoc.documentElement.dataset.theme === theme.id && childDoc.getElementById('provider-name')?.textContent === 'DeepSeek' && childDoc.getElementById('usage-summary')?.textContent.includes('29.9k'), `${theme.name} 正式弹窗`);
    await until(() => [...childDoc.images].every(image => image.complete && image.naturalWidth > 0) && (!childDoc.fonts || childDoc.fonts.status === 'loaded'), `${theme.name} Logo 和字体`);
    if (child.__logoColorMock.errors.length) throw new Error(child.__logoColorMock.errors.join('\n'));
    theme.card.dataset.ready = 'true';
  }

  function geometry() {
    const rect = element => { const bounds = element.getBoundingClientRect(); return { x: bounds.x + scrollX, y: bounds.y + scrollY, width: bounds.width, height: bounds.height }; };
    const data = {
      preview: 'logo-graphite', scale: devicePixelRatio, cssWidth: 1440,
      hero: rect($('hero')), comparison: rect(document.querySelector('.comparison')), grid: rect($('themes')),
      panels: themes.map(theme => ({ id: theme.id, name: theme.name, rect: rect(theme.frame), cardRect: rect(theme.card) })),
    };
    window.__logoColorGeometry = data;
    return data;
  }

  async function run() {
    try {
      const response = await fetch(new URL('popup.html', root), { cache: 'no-store' });
      if (!response.ok) throw new Error(`popup.html：HTTP ${response.status}`);
      const html = await response.text(), { defaultSettings } = await import('../lib/config.js');
      for (const theme of themes) {
        theme.card = document.createElement('article'); theme.card.className = 'theme-card';
        const name = document.createElement('div'); name.className = 'theme-name'; name.append(document.createTextNode(theme.name));
        const tag = document.createElement('span'); tag.textContent = 'GRAPHITE LOGO'; name.append(tag);
        const stage = document.createElement('div'); stage.className = 'frame-stage';
        theme.frame = document.createElement('iframe'); theme.frame.title = `${theme.name} · 石墨灰 Logo 正式弹窗预览`; stage.append(theme.frame);
        theme.card.append(name, stage); $('theme-grid').append(theme.card);
      }
      const note = document.createElement('div'); note.className = 'theme-note';
      const copy = document.createElement('div'), title = document.createElement('strong'); title.textContent = '不挑主题的中性色';
      copy.append(title, document.createTextNode('浅色主题简洁清楚，深色主题沉稳自然。'), document.createElement('br'), document.createTextNode('Logo 图形与界面主题保持原样。')); note.append(copy); $('theme-grid').append(note);
      for (const [index, theme] of themes.entries()) { $('status').textContent = `正在加载 ${index + 1} / 5 · ${theme.name}`; await loadPopup(theme, html, defaultSettings()); }
      await until(() => [...document.images].every(image => image.complete && image.naturalWidth > 0) && (!document.fonts || document.fonts.status === 'loaded'), '对比 Logo 和字体');
      window.scrollTo(0, 0); geometry();
      $('status').textContent = '5 / 5 套主题就绪 · 仅预览配色'; document.documentElement.dataset.preview = 'ready';
      $('download-geometry').focus({ preventScroll: true });
    } catch (error) { $('status').textContent = '预览加载失败'; $('status').classList.add('error'); $('errors').textContent = error.stack || error.message; document.documentElement.dataset.preview = 'error'; }
  }
  $('download-geometry').addEventListener('click', () => {
    const value = geometry(), url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'pagelingo-logo-color-geometry.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  window.addEventListener('resize', () => { if (document.documentElement.dataset.preview === 'ready') geometry(); });
  void run();
})();
