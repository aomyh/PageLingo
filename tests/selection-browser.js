(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const listeners = [];
  const calls = [];
  const errors = [];
  const roots = new WeakMap();
  const originalAttachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (options) {
    const root = originalAttachShadow.call(this, options);
    roots.set(this, root);
    return root;
  };
  const settings = { selectionEnabled: false, targetLanguage: 'zh-CN', providerName: '模拟 AI', model: 'mock-model', ready: true };
  const delays = [];
  const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const translations = { 'Stay curious. The world is yours to explore.': '保持好奇，世界等你探索。', 'A new language is a new perspective.': '一种新的语言，一种新的视角。', 'HTML-like selection should be safe.': '<img src=x onerror="alert(1)"> 这段 HTML 必须以文本显示。' };
  window.chrome ||= {};
  window.chrome.runtime = {
    onMessage: { addListener(listener) { listeners.push(listener); } },
    async sendMessage(message) {
      if (message.type === 'GET_PUBLIC_SETTINGS') return { ok: true, settings: { ...settings } };
      if (message.type === 'CANCEL_TRANSLATION') return { ok: true };
      if (message.type !== 'TRANSLATE_SELECTION') return { ok: false, error: '未知模拟消息。' };
      const call = { ...message }; calls.push(call);
      await wait(delays.shift() ?? 60);
      return { ok: true, text: translations[message.text] || `【模拟译文】${message.text}`, cached: calls.length % 2 === 0 };
    },
  };
  function message(type, extra = {}) { let reply; listeners.forEach(listener => listener({ type, ...extra }, {}, value => { reply = value; })); return reply; }
  function setEnabled(enabled) { settings.selectionEnabled = enabled; message('PAGELINGO_SELECTION_SETTINGS', { settings: { ...settings } }); $('switch-state').textContent = `划词翻译：${enabled ? '开启' : '关闭'}`; }
  function host() { return document.querySelector('[data-pagelingo="selection"]'); }
  function status() { return message('PAGELINGO_SELECTION_STATUS'); }
  function select(startElement, endElement = startElement) {
    const range = document.createRange(); range.setStart(startElement.firstChild, 0); range.setEnd(endElement.lastChild, endElement.lastChild.textContent.length);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }
  function release() { document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 })); }
  async function until(predicate, label) { const end = performance.now() + 6000; while (performance.now() < end) { if (predicate()) return; await wait(20); } throw new Error(`等待超时：${label}`); }
  function check(condition, label) { const line = document.createElement('li'); line.className = condition ? 'pass' : 'fail'; line.textContent = label; $('results').append(line); if (!condition) throw new Error(label); }
  let running = false;

  async function run() {
    if (running) return;
    running = true; $('run').disabled = true; $('preview').disabled = true;
    $('summary').textContent = '正在运行…'; $('results').replaceChildren(); $('error-log').textContent = ''; errors.length = 0;
    try {
      setEnabled(false); calls.length = 0; delays.length = 0; window.getSelection().removeAllRanges();
      const originalHTML = $('fixture').innerHTML, link = $('source-link');
      select($('source-one')); release(); await wait(330);
      check(calls.length === 0 && !host(), '默认关闭时，划词不触发网络或翻译卡片');

      setEnabled(true); document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
      select($('source-one')); await wait(380);
      check(calls.length === 0, '鼠标拖动中暂停超过 250 ms，仍等待松开后才翻译');
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 })); release();
      await until(() => status()?.state === 'complete', '首个划词译文');
      check(calls.length === 1 && calls[0].text === $('source-one').textContent, '松开鼠标后只发送一次完整选中文本');
      check(roots.get(host()).textContent.includes('保持好奇，世界等你探索。'), '原生闭合 Shadow DOM 正确显示译文');
      check($('fixture').innerHTML === originalHTML && $('source-link') === link, '原文、链接、HTML 与节点身份均保持不变');
      release(); await wait(330); check(calls.length === 1, '相同选区的重复鼠标事件不会重复计费');

      const privateCount = calls.length;
      select($('private-code')); release(); await wait(330);
      select($('cross-start'), $('cross-end')); release(); await wait(330);
      select($('hidden-start'), $('hidden-end')); release(); await wait(330);
      check(calls.length === privateCount && calls.every(call => !call.text.includes('PRIVATE_')), '拒绝代码选区，以及跨过表单或 CSS 隐藏文本的选区');

      select($('source-two')); // No pointer event: selectionchange is the keyboard path.
      await until(() => status()?.state === 'complete', '键盘选区翻译');
      check(calls.length === privateCount + 1 && roots.get(host()).textContent.includes('一种新的语言，一种新的视角。'), '键盘改变选区后可自动翻译');
      const currentHost = host(), currentRoot = roots.get(currentHost), result = currentRoot.querySelector('.result');
      const cardRange = document.createRange(); cardRange.selectNodeContents(result);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(cardRange); document.dispatchEvent(new Event('selectionchange'));
      result.dispatchEvent(new Event('scroll', { composed: true })); await wait(330);
      check(calls.length === privateCount + 1 && host() === currentHost, '复制卡片译文或在卡片内滚动不会再次翻译或关闭卡片');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      check(!host(), '按 Escape 立即关闭翻译结果');

      delays.push(700, 40); const beforeNew = calls.length;
      select($('source-one')); release(); await until(() => calls.length === beforeNew + 1, '较慢旧请求');
      select($('source-two')); release(); await until(() => calls.length === beforeNew + 2 && status()?.state === 'complete', '较快新请求');
      await wait(470);
      check(roots.get(host()).textContent.includes('一种新的语言，一种新的视角。') && !roots.get(host()).textContent.includes('保持好奇，世界等你探索。'), '较慢旧请求的迟到结果不会覆盖新选区译文');

      delays.push(450); const beforeDisable = calls.length;
      select($('source-one')); release(); await until(() => calls.length === beforeDisable + 1, '待关闭请求');
      setEnabled(false);
      check(!host() && status()?.enabled === false, '快捷关闭同步移除结果，并停止监听划词');
      await wait(520); release(); await wait(330);
      check(!host() && calls.length === beforeDisable + 1, '关闭后的迟到响应不会重新弹出结果，也不再发请求');

      setEnabled(true); select($('html-source')); release(); await until(() => status()?.state === 'complete', '安全文本输出');
      check(!roots.get(host()).querySelector('img') && roots.get(host()).textContent.includes('<img src=x'), '模型 HTML 字符串安全渲染为文本');
      check(errors.length === 0, '没有未捕获的脚本错误');
      const count = $('results').querySelectorAll('.pass').length;
      $('summary').textContent = `${count} / ${count} 项通过`;
      document.documentElement.dataset.testResult = 'pass';
      setEnabled(false); window.getSelection().removeAllRanges();
    } catch (error) {
      $('summary').textContent = '测试失败'; $('error-log').textContent = `${error.stack || error}\n${errors.join('\n')}`;
      document.documentElement.dataset.testResult = 'fail'; setEnabled(false);
    } finally { running = false; $('run').disabled = false; $('preview').disabled = false; }
  }
  $('run').addEventListener('click', run);
  $('disable').addEventListener('click', () => setEnabled(false));
  $('preview').addEventListener('click', () => { if (running) return; setEnabled(true); $('source-one').scrollIntoView({ block: 'center' }); select($('source-one')); release(); });
  window.addEventListener('error', event => errors.push(event.message));
  window.addEventListener('unhandledrejection', event => errors.push(String(event.reason?.message || event.reason)));
})();
