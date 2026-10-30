(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const root = new URL('../', location.href);
  const frame = $('popup-frame');
  const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  let running = false;

  function installChromeMock(manifest, missingKey) {
    const key = 'pagelingo.settings.v1';
    const listeners = [];
    let stored = {
      activeProvider: 'deepseek', targetLanguage: 'zh-CN', displayMode: 'translated', concurrency: 4,
      batchSize: 2200, cacheEnabled: true, translateDynamic: true, selectionEnabled: false,
      providers: { deepseek: { apiKey: missingKey ? '' : 'layout-test-not-a-real-key', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com/v1' } },
    };
    const mock = window.__popupMock = { holdPermission: false, releasePermission: null, error: '', calls: [], settings: () => structuredClone(stored) };
    const clone = () => structuredClone(stored);
    function emit(previous) { for (const listener of listeners) listener({ [key]: { oldValue: previous, newValue: clone() } }, 'local'); }
    window.chrome ||= {};
    window.chrome.runtime = {
      id: 'pagelingo-layout-test', getManifest: () => manifest, getURL: path => new URL(path, document.baseURI).href, openOptionsPage: async () => {},
      async sendMessage(message) {
        mock.calls.push(structuredClone(message));
        if (message.type === 'GET_USAGE_STATS') return { ok: true, summary: { requests: 0, totalTokens: 0, requestsWithUsage: 0, requestsWithoutUsage: 0 } };
        if (message.type !== 'SET_SELECTION_ENABLED') return { ok: false, error: '未知模拟消息' };
        if (mock.error) return { ok: false, error: mock.error };
        const previous = clone(); stored.selectionEnabled = message.enabled; emit(previous);
        return { ok: true, settings: { selectionEnabled: stored.selectionEnabled } };
      },
    };
    window.chrome.storage = {
      local: { get: async () => ({ [key]: clone() }), set: async patch => { const previous = clone(); stored = structuredClone(patch[key]); emit(previous); } },
      onChanged: { addListener: listener => listeners.push(listener) },
    };
    window.chrome.permissions = { request: () => mock.holdPermission ? new Promise(resolve => { mock.releasePermission = resolve; }) : Promise.resolve(true) };
    window.chrome.tabs = {
      query: async () => [{ id: 7, url: 'https://example.com/article' }],
      create: async options => { mock.opened = options; },
      sendMessage: async (_tabId, message) => message.type === 'PAGELINGO_STATUS'
        ? { ok: true, status: { state: 'idle', completed: 0, total: 0, cachedCount: 0 } } : { ok: true },
    };
    window.chrome.scripting = { executeScript: async () => [] };
  }

  async function until(predicate, description) {
    const started = performance.now();
    while (performance.now() - started < 6000) { if (predicate()) return; await wait(16); }
    throw new Error(`等待超时：${description}`);
  }
  async function settle() {
    await new Promise(resolve => frame.contentWindow.requestAnimationFrame(() => frame.contentWindow.requestAnimationFrame(resolve)));
  }
  function snapshot(label) {
    const doc = frame.contentDocument, scroll = doc.scrollingElement;
    const box = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom }; };
    return {
      label, scrollHeight: scroll.scrollHeight, clientHeight: scroll.clientHeight,
      scrollWidth: scroll.scrollWidth, clientWidth: scroll.clientWidth,
      popup: box(doc.querySelector('.popup')), button: box(doc.getElementById('translate-button')),
      footer: box(doc.querySelector('footer')), status: box(doc.getElementById('status-message')),
      documentScroll: scroll.scrollTop,
    };
  }
  function check(condition, label) { const li = document.createElement('li'); li.className = condition ? 'pass' : 'fail'; li.textContent = `${condition ? '✓' : '✗'} ${label}`; $('results').append(li); }
  function metric(value) {
    $('metrics').textContent += `${value.label}: scroll ${value.scrollWidth}×${value.scrollHeight} / client ${value.clientWidth}×${value.clientHeight}; popup ${value.popup.width.toFixed(1)}×${value.popup.height.toFixed(1)}; buttonY ${value.button.y.toFixed(1)}; footerY ${value.footer.y.toFixed(1)}; statusH ${value.status.height.toFixed(1)}\n`;
  }

  async function loadPopup() {
    const query = `layout-run=${Date.now()}`;
    const [markup, manifest] = await Promise.all([
      fetch(new URL(`popup.html?${query}`, root), { cache: 'no-store' }).then(response => response.text()),
      fetch(new URL(`manifest.json?${query}`, root), { cache: 'no-store' }).then(response => response.json()),
    ]);
    const doc = new DOMParser().parseFromString(markup, 'text/html');
    doc.querySelector('script[src="popup.js"]').remove();
    const base = doc.createElement('base'); base.href = root.href; doc.head.prepend(base);
    doc.querySelector('link[rel="stylesheet"]').href = new URL(`popup.css?${query}`, root).href;
    const script = doc.createElement('script');
    script.textContent = `(${installChromeMock.toString()})(${JSON.stringify(manifest)}, ${JSON.stringify($('missing-key').checked)});`;
    doc.head.append(script);
    const module = doc.createElement('script'); module.type = 'module'; module.src = new URL(`popup.js?${query}`, root).href; doc.head.append(module);
    const loaded = new Promise(resolve => frame.addEventListener('load', resolve, { once: true }));
    frame.srcdoc = '<!doctype html>' + doc.documentElement.outerHTML;
    await loaded;
    await until(() => frame.contentWindow.__popupMock && frame.contentDocument.getElementById('selection-enabled')?.disabled === false, '正式弹窗初始化');
    await frame.contentDocument.fonts.ready;
    await settle();
  }

  async function run() {
    if (running) return;
    running = true; $('run').disabled = true; $('summary').textContent = '正在运行…';
    $('results').replaceChildren(); $('metrics').textContent = ''; $('error').textContent = '';
    try {
      await loadPopup();
      const toggle = frame.contentDocument.getElementById('selection-enabled'), mock = frame.contentWindow.__popupMock;
      const states = [snapshot('初始关闭')]; metric(states[0]);
      mock.holdPermission = true; toggle.click(); await settle();
      states.push(snapshot('等待授权')); metric(states.at(-1));
      check(toggle.disabled && mock.releasePermission, '等待权限时防止重复提交');
      mock.holdPermission = false; mock.releasePermission(true);
      await until(() => !toggle.disabled && toggle.checked && mock.settings().selectionEnabled, '划词开启'); await settle();
      states.push(snapshot('已开启')); metric(states.at(-1));
      toggle.click(); await until(() => !toggle.disabled && !toggle.checked && !mock.settings().selectionEnabled, '划词关闭'); await settle();
      states.push(snapshot('已关闭')); metric(states.at(-1));
      for (let index = 0; index < 4; index++) { toggle.click(); await until(() => !toggle.disabled, '重复切换'); await settle(); }
      states.push(snapshot('重复切换后')); metric(states.at(-1));
      const first = states[0], close = (a, b) => Math.abs(a - b) < .5;
      check(states.every(value => value.scrollHeight <= value.clientHeight), '普通开关状态不出现页面纵向滚动条');
      check(states.every(value => value.scrollWidth <= value.clientWidth), '所有状态不出现页面横向滚动条');
      check(states.every(value => close(value.popup.width, first.popup.width) && close(value.popup.height, first.popup.height)), '弹窗内容宽高在开关前后保持稳定');
      check(states.every(value => close(value.button.y, first.button.y) && close(value.footer.y, first.footer.y)), '主操作与底栏不随开关跳动');
      check(states.every(value => value.documentScroll === first.documentScroll), '切换不会触发页面滚动位置变化');
      check(!toggle.checked && mock.settings().selectionEnabled === false, '重复开关后的状态准确保存');
      const pass = $('results').querySelectorAll('.pass').length, total = $('results').children.length;
      $('summary').textContent = `${pass} / ${total} 项通过`;
      document.documentElement.dataset.testResult = pass === total ? 'pass' : 'fail';
      window.__popupLayoutResults = { states, pass, total };
    } catch (error) { $('summary').textContent = '测试失败'; $('error').textContent = error.stack || error.message; document.documentElement.dataset.testResult = 'fail'; }
    finally { running = false; $('run').disabled = false; }
  }
  $('run').addEventListener('click', run);
})();
