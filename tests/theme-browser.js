(() => {
  'use strict';
  if (new URLSearchParams(location.search).has('fixture')) return;
  const $ = id => document.getElementById(id);
  const root = new URL('../', location.href);
  const ids = ['sage', 'ocean', 'lavender', 'sand', 'midnight'];
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  let running = false, results = [];

  function installMock(kind, path) {
    const hub = parent.__themeHarnessHub, key = 'pagelingo.settings.v1';
    if (kind !== 'content') history.replaceState(null, '', new URL(path, document.baseURI).href);
    const storageListeners = [], runtimeListeners = [];
    const roots = new WeakMap(), attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (options) { const shadow = attach.call(this, options); roots.set(this, shadow); return shadow; };
    const mock = window.__themeMock = { roots, kind, calls: [], errors: [], copies: [], storageReads: 0, pageOpens: 0, pageCloses: 0 };
    const client = { storageListeners, runtimeListeners };
    hub.clients.add(client);
    window.addEventListener('pagehide', () => hub.clients.delete(client));
    window.addEventListener('error', event => mock.errors.push(event.message));
    window.addEventListener('unhandledrejection', event => mock.errors.push(String(event.reason?.message || event.reason)));
    window.open = () => { mock.pageOpens++; throw new Error('主题切换不应打开页面'); };
    window.close = () => { mock.pageCloses++; };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { async writeText(text) { mock.copies.push(text); } } });
    const publicSettings = () => ({ theme: hub.settings.theme, activeProvider: hub.settings.activeProvider, providerName: 'DeepSeek', model: hub.settings.providers.deepseek.model, targetLanguage: hub.settings.targetLanguage, ready: true, selectionEnabled: true });
    const api = {
      runtime: {
        id: 'pagelingo-theme-browser-test', getURL: value => new URL(value, document.baseURI).href,
        getManifest: () => ({ optional_host_permissions: ['http://*/*', 'https://*/*'] }),
        onMessage: { addListener: callback => runtimeListeners.push(callback), removeListener: callback => { const index = runtimeListeners.indexOf(callback); if (index >= 0) runtimeListeners.splice(index, 1); } },
        async openOptionsPage() { mock.pageOpens++; },
        async sendMessage(message) {
          mock.calls.push(structuredClone(message));
          if (message.type === 'GET_MANUAL_SETTINGS') return { ok: true, settings: publicSettings(), configurationRevision: 'theme-test-config-stable' };
          if (message.type === 'GET_PUBLIC_SETTINGS') return { ok: true, settings: publicSettings() };
          if (message.type === 'TRANSLATE_TEXT') {
            if (hub.holdTranslation) return new Promise(resolve => hub.pending.push({ message: structuredClone(message), resolve }));
            return { ok: true, text: '模拟手动译文', cached: false, providerId: 'deepseek', model: hub.settings.providers.deepseek.model, targetLanguage: message.targetLanguage };
          }
          if (message.type === 'TRANSLATE_SELECTION') return { ok: true, text: '模拟划词译文', cached: false };
          if (['CANCEL_TEXT_TRANSLATION', 'CANCEL_TRANSLATION'].includes(message.type)) return { ok: true };
          if (message.type === 'GET_USAGE_STATS') return { ok: true, summary: { requests: 0, totalTokens: 0, requestsWithUsage: 0, requestsWithoutUsage: 0 } };
          if (message.type === 'CACHE_STATS') return { ok: true, entries: 0, bytes: 0 };
          throw new Error(`主题测试禁止的消息：${message.type}`);
        },
      },
      permissions: { request: async () => { hub.permissions++; throw new Error('切换主题不应申请权限'); } },
      tabs: {
        query: async () => [{ id: 8, url: 'https://theme-fixture.example/article' }],
        create: async () => { mock.pageOpens++; throw new Error('切换主题不应创建标签页'); },
        sendMessage: async () => ({ ok: true, status: { state: 'idle', completed: 0, total: 0, cachedCount: 0 } }),
      }, scripting: { executeScript: async () => { throw new Error('切换主题不应执行注入'); } },
    };
    if (kind === 'content') Object.defineProperty(api, 'storage', { get() { mock.storageReads++; throw new Error('内容脚本不应读取密钥存储'); } });
    else api.storage = {
      local: {
        async get(requested) { mock.storageReads++; return { [requested]: requested === key ? structuredClone(hub.settings) : undefined }; },
        async set(patch) {
          if (!patch[key]) throw new Error('主题只应写入原有设置');
          const before = structuredClone(hub.settings), after = structuredClone(patch[key]);
          hub.writes.push({ before, after }); hub.settings = after; hub.emit(before);
        },
      }, onChanged: { addListener: callback => storageListeners.push(callback) },
    };
    window.chrome = api;
  }

  async function until(predicate, description) {
    const start = performance.now();
    while (performance.now() - start < 7000) { if (predicate()) return; await wait(20); }
    throw new Error(`等待超时：${description}`);
  }
  function check(value, label) {
    const result = { pass: Boolean(value), label }; results.push(result);
    const item = document.createElement('li'); item.className = result.pass ? 'pass' : 'fail'; item.textContent = `${result.pass ? 'PASS' : 'FAIL'} · ${label}`; $('results').append(item);
  }
  async function fetchText(path) {
    const result = await fetch(new URL(path, root), { cache: 'no-store', signal: AbortSignal.timeout(7000) });
    if (!result.ok) throw new Error(`${path} HTTP ${result.status}`);
    return result.text();
  }
  async function loadPage(frame, file, hash = '') {
    const query = `theme-run=${Date.now()}-${Math.random()}`;
    const markup = await fetchText(`${file}?${query}`);
    const doc = new DOMParser().parseFromString(markup, 'text/html');
    const entry = file.replace('.html', '.js'); doc.querySelector(`script[src="${entry}"]`)?.remove();
    const base = doc.createElement('base'); base.href = root.href; doc.head.prepend(base);
    for (const sheet of doc.querySelectorAll('link[rel="stylesheet"]')) sheet.href = new URL(`${sheet.getAttribute('href')}?${query}`, root).href;
    const install = doc.createElement('script'); install.textContent = `(${installMock.toString()})(${JSON.stringify(file.startsWith('popup') ? 'popup' : 'options')},${JSON.stringify(file + hash)});`; doc.head.append(install);
    const module = doc.createElement('script'); module.type = 'module'; module.src = new URL(`${entry}?${query}`, root).href; doc.head.append(module);
    await new Promise((resolve, reject) => {
      const done = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => { frame.removeEventListener('load', done); reject(new Error('等待超时：主题 fixture 导航')); }, 7000);
      frame.addEventListener('load', done, { once: true }); frame.src = new URL(`tests/theme-browser.html?fixture=1&${query}`, root).href;
    });
    frame.contentDocument.open(); frame.contentDocument.write('<!doctype html>' + doc.documentElement.outerHTML); frame.contentDocument.close();
    await until(() => frame.contentWindow.__themeMock && frame.contentDocument.documentElement.dataset.theme, `${file} 主题初始化`);
    await until(() => !frame.contentDocument.fonts || frame.contentDocument.fonts.status === 'loaded', `${file} 字体加载`);
    if (file === 'options.html') await until(() => frame.contentDocument.querySelectorAll('[data-theme-id]').length === ids.length, `${ids.length} 个主题卡片`);
    else await until(() => frame.contentDocument.getElementById('provider-name')?.textContent === 'DeepSeek', '弹窗配置加载');
  }
  async function appendScript(frame, path) {
    const script = frame.contentDocument.createElement('script'); script.src = new URL(`${path}?theme-run=${Date.now()}-${Math.random()}`, root).href;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`等待超时：${path}`)), 7000);
      script.onload = () => { clearTimeout(timer); resolve(); }; script.onerror = () => { clearTimeout(timer); reject(new Error(`${path} 加载失败`)); };
      frame.contentDocument.head.append(script);
    });
  }
  async function loadContent(frame) {
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#edf1e6;color:#33432a;font:16px/1.8 Georgia,serif}body{padding:34px;min-height:1200px}article{max-width:560px;padding:30px;background:#fff;border:1px solid #dfe6d5;border-radius:12px}h1{font-size:27px}p{margin:20px 0}</style></head><body><article><h1>The page keeps its own colors.</h1><p id="selection-source">Keep reading in your own style.</p><p>更换 PageLingo 主题只改变翻译浮窗，不改变当前网页的背景和文字。</p></article><script>(${installMock.toString()})('content','');<\/script></body></html>`;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('等待超时：普通网页 fixture')), 7000);
      frame.addEventListener('load', () => { clearTimeout(timer); resolve(); }, { once: true }); frame.srcdoc = html;
    });
    await appendScript(frame, 'lib/themes.js'); await appendScript(frame, 'manual-panel.js');
    await until(() => frame.contentDocument.querySelector('[data-pagelingo="manual"]')?.dataset.theme, '手动浮窗主题');
  }
  function popupGeometry(frame) {
    const doc = frame.contentDocument, popup = doc.querySelector('.popup'), box = popup.getBoundingClientRect(), button = doc.getElementById('translate-button').getBoundingClientRect();
    return { width: box.width, height: box.height, buttonTop: button.top, scrollWidth: doc.scrollingElement.scrollWidth, clientWidth: doc.scrollingElement.clientWidth, scrollHeight: doc.scrollingElement.scrollHeight, clientHeight: doc.scrollingElement.clientHeight };
  }
  function contrast(text, background) {
    const luminance = color => {
      const values = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
      if (!values || values.length !== 3) throw new Error(`无法解析颜色：${color}`);
      const linear = values.map(value => { const channel = value / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4; });
      return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
    };
    const a = luminance(text), b = luminance(background); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  }
  function backgroundOf(element) {
    let current = element;
    while (current) {
      const color = current.ownerDocument.defaultView.getComputedStyle(current).backgroundColor;
      if (color && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)') return color;
      current = current.parentElement || current.getRootNode?.().host;
    }
    return 'rgb(255, 255, 255)';
  }
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])]));
    return value;
  }

  async function run() {
    if (running) return;
    running = true; results = []; $('run').disabled = true; $('summary').textContent = '正在运行…'; $('results').replaceChildren(); $('metrics').textContent = ''; $('error').textContent = '';
    document.documentElement.dataset.testResult = 'running';
    try {
      const { defaultSettings } = await import('../lib/config.js');
      const initial = defaultSettings(); delete initial.theme; initial.providers.deepseek.apiKey = 'MOCK_THEME_KEY_NOT_REAL';
      const hub = window.__themeHarnessHub = {
        settings: initial, clients: new Set(), writes: [], permissions: 0, pending: [], holdTranslation: false,
        emit(before) {
          for (const client of [...this.clients]) {
            for (const fn of [...client.storageListeners]) fn({ 'pagelingo.settings.v1': { oldValue: structuredClone(before), newValue: structuredClone(this.settings) } }, 'local');
            for (const fn of [...client.runtimeListeners]) fn({ type: 'PAGELINGO_THEME_CHANGED', theme: this.settings.theme }, {}, () => {});
          }
        },
        updateTheme(theme) { const before = structuredClone(this.settings); this.settings = { ...this.settings, theme }; this.emit(before); },
      };
      const optionsFrame = $('options-frame'), popupFrame = $('popup-frame'), contentFrame = $('content-frame');
      await loadPage(optionsFrame, 'options.html', '#appearance');
      await loadPage(popupFrame, 'popup.html');
      await loadContent(contentFrame);
      let optionsDoc = optionsFrame.contentDocument;
      const popupDoc = popupFrame.contentDocument, popupWindow = popupFrame.contentWindow;
      const contentDoc = contentFrame.contentDocument, contentWindow = contentFrame.contentWindow, contentMock = contentWindow.__themeMock;
      const host = contentDoc.querySelector('[data-pagelingo="manual"]'), shadow = contentMock.roots.get(host);
      const el = id => shadow.getElementById(id);
      const originalBackground = contentWindow.getComputedStyle(contentDoc.body).backgroundColor;
      const originalText = contentWindow.getComputedStyle(contentDoc.body).color;
      const baseSettings = { ...structuredClone(hub.settings), theme: undefined };
      const baselinePopup = popupGeometry(popupFrame), colors = [], metrics = [];
      check(!optionsDoc.getElementById('view-appearance').hidden && optionsDoc.querySelectorAll('[data-theme-id]').length === ids.length, '配置页提供 5 套可选择的外观主题');
      check(optionsDoc.documentElement.dataset.theme === 'ocean' && popupDoc.documentElement.dataset.theme === 'ocean' && host.dataset.theme === 'ocean', '未保存主题的配置在配置页、弹窗与浮窗中默认使用海盐蓝');
      optionsDoc.getElementById('api-key').value = 'MOCK_UNSAVED_DRAFT_NOT_REAL';
      optionsDoc.getElementById('api-key').dispatchEvent(new optionsFrame.contentWindow.Event('input', { bubbles: true }));
      for (const theme of ids) {
        const before = hub.writes.length;
        optionsDoc.querySelector(`[data-theme-id="${theme}"]`).click();
        await until(() => hub.settings.theme === theme && optionsDoc.documentElement.dataset.theme === theme && popupDoc.documentElement.dataset.theme === theme && host.dataset.theme === theme && !optionsDoc.querySelector(`[data-theme-id="${theme}"]`).disabled, `${theme} 应用完成`);
        const active = [...optionsDoc.querySelectorAll('[data-theme-id]')].filter(button => button.getAttribute('aria-pressed') === 'true');
        const sameSettings = JSON.stringify(canonical({ ...hub.settings, theme: undefined })) === JSON.stringify(canonical(baseSettings));
        check(active.length === 1 && active[0].dataset.themeId === theme && sameSettings, `${theme} 即选即生效，保留 Key 与全部翻译偏好`);
        check(optionsDoc.getElementById('api-key').value === 'MOCK_UNSAVED_DRAFT_NOT_REAL', `${theme} 不覆盖服务商表单中未保存的内容`);
        const geometry = popupGeometry(popupFrame);
        check(Math.abs(geometry.width - baselinePopup.width) < .5 && Math.abs(geometry.height - baselinePopup.height) < .5 && Math.abs(geometry.buttonTop - baselinePopup.buttonTop) < .5 && geometry.scrollHeight <= geometry.clientHeight && geometry.scrollWidth <= geometry.clientWidth, `${theme} 不改变弹窗尺寸、操作位置或产生滚动条`);
        colors.push(backgroundOf(popupDoc.body));
        metrics.push(`${theme} · popup ${geometry.width.toFixed(1)} × ${geometry.height.toFixed(1)} · 写入 ${hub.writes.length - before} 次`);
      }
      check(new Set(colors).size === ids.length, '5 套主题具有不同的整体背景配色');
      await loadPage(optionsFrame, 'options.html', '#appearance'); optionsDoc = optionsFrame.contentDocument;
      check(optionsDoc.documentElement.dataset.theme === 'midnight' && optionsDoc.querySelector('[data-theme-id="midnight"]').getAttribute('aria-pressed') === 'true', '重新打开配置页后恢复已保存的主题');
      hub.updateTheme('not-a-theme');
      await until(() => optionsDoc.documentElement.dataset.theme === 'ocean' && popupDoc.documentElement.dataset.theme === 'ocean', '无效主题回落');
      check(optionsDoc.querySelector('[data-theme-id="ocean"]').getAttribute('aria-pressed') === 'true', '旧数据或无效主题安全回落为海盐蓝');
      hub.updateTheme('ocean');
      await until(() => optionsDoc.documentElement.dataset.theme === 'ocean' && popupDoc.documentElement.dataset.theme === 'ocean' && host.dataset.theme === 'ocean', '外部设置同步');
      check(contentWindow.getComputedStyle(contentDoc.body).backgroundColor === originalBackground && contentWindow.getComputedStyle(contentDoc.body).color === originalText && !contentDoc.documentElement.dataset.theme, '主题只作用于翻译浮窗，不修改网页本身的颜色或主题标记');

      el('manual-input').value = 'Keep this pending input.'; el('manual-input').dispatchEvent(new contentWindow.Event('input', { bubbles: true, composed: true }));
      hub.holdTranslation = true; el('manual-translate').click();
      await until(() => hub.pending.length === 1, '模拟在途翻译');
      const cancelledBefore = contentMock.calls.filter(call => call.type === 'CANCEL_TEXT_TRANSLATION').length;
      hub.updateTheme('midnight'); await until(() => host.dataset.theme === 'midnight', '在途主题更新');
      check(el('manual-input').value === 'Keep this pending input.' && !el('manual-cancel').hidden && contentMock.calls.filter(call => call.type === 'CANCEL_TEXT_TRANSLATION').length === cancelledBefore, '主题更新保留在途翻译和输入，不取消请求');
      hub.pending[0].resolve({ ok: true, text: '主题切换后原请求正常完成。', cached: false, providerId: 'deepseek', model: hub.settings.providers.deepseek.model, targetLanguage: hub.pending[0].message.targetLanguage });
      await until(() => el('manual-output').textContent === '主题切换后原请求正常完成。' && !el('manual-copy').disabled, '在途请求完成');
      const popupHeading = popupDoc.querySelector('h1');
      const popupContrast = contrast(popupWindow.getComputedStyle(popupHeading).color, backgroundOf(popupHeading));
      const inputContrast = contrast(contentWindow.getComputedStyle(el('manual-input')).color, backgroundOf(el('manual-input')));
      const outputContrast = contrast(contentWindow.getComputedStyle(el('manual-output')).color, backgroundOf(el('manual-output')));
      check(popupContrast >= 4.5 && inputContrast >= 4.5 && outputContrast >= 4.5, '深色主题的标题、输入正文和译文对比度均达到 4.5:1');
      metrics.push(`深色对比度 · 标题 ${popupContrast.toFixed(2)} · 输入 ${inputContrast.toFixed(2)} · 译文 ${outputContrast.toFixed(2)}`);
      const requestsBefore = contentMock.calls.filter(call => call.type === 'TRANSLATE_TEXT').length;
      hub.updateTheme('sand'); await until(() => host.dataset.theme === 'sand', '完成后主题更新');
      check(el('manual-output').textContent === '主题切换后原请求正常完成。' && !el('manual-copy').disabled && !el('manual-result-note').textContent.includes('服务') && contentMock.calls.filter(call => call.type === 'TRANSLATE_TEXT').length === requestsBefore, '已有译文切换主题后继续可复制，不重新计费或误判配置过期');

      await appendScript(contentFrame, 'selection.js');
      const source = contentDoc.getElementById('selection-source'), range = contentDoc.createRange(); range.selectNodeContents(source);
      const selection = contentWindow.getSelection(); selection.removeAllRanges(); selection.addRange(range); contentDoc.dispatchEvent(new contentWindow.Event('selectionchange')); contentDoc.dispatchEvent(new contentWindow.MouseEvent('mouseup', { bubbles: true, button: 0 }));
      await until(() => contentDoc.querySelector('[data-pagelingo="selection"]')?.getAttribute('data-state') === 'complete', '划词结果显示');
      const selectionHost = contentDoc.querySelector('[data-pagelingo="selection"]'), selectionRoot = contentMock.roots.get(selectionHost);
      const selectionRequests = contentMock.calls.filter(call => call.type === 'TRANSLATE_SELECTION').length;
      hub.updateTheme('lavender');
      await until(() => selectionHost.dataset.theme === 'lavender' && host.dataset.theme === 'lavender', '划词与手动框同步');
      check(contentDoc.querySelector('[data-pagelingo="selection"]') === selectionHost && selectionRoot.textContent.includes('模拟划词译文') && contentMock.calls.filter(call => call.type === 'TRANSLATE_SELECTION').length === selectionRequests, '划词结果同步主题但不关闭、不丢译文、不重复请求');
      check(contentMock.storageReads === 0 && hub.permissions === 0, '网页内容脚本只读取公开主题，不读取密钥或申请权限');
      const clients = [optionsFrame.contentWindow.__themeMock, popupFrame.contentWindow.__themeMock, contentMock];
      check(clients.every(mock => !mock.errors.length && !mock.pageOpens && !mock.pageCloses), '主题流程不打开或关闭页面，且没有浏览器脚本错误');
      $('metrics').textContent = `${metrics.join('\n')}\n全部数据均为模拟配置\n主题保存：${hub.writes.length} 次\nAI 请求：${requestsBefore} 次（模拟，非主题切换产生）`;
    } catch (error) { check(false, '运行器完成全部主题场景'); $('error').textContent = error.stack || error.message; }
    finally {
      const pass = results.filter(result => result.pass).length;
      $('summary').textContent = `${pass} / ${results.length} 项通过`;
      document.documentElement.dataset.testResult = pass === results.length ? 'pass' : 'fail';
      window.__themeBrowserResults = { pass, total: results.length, results, error: $('error').textContent };
      running = false; $('run').disabled = false;
    }
  }
  $('run').addEventListener('click', run);
})();
