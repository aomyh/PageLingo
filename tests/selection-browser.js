(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const listeners = [];
  const calls = [];
  const cancellations = [];
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
  const translations = { 'Stay curious. The world is yours to explore.': '保持好奇，世界等你探索。', 'A new language is a new perspective.': '一种新的语言，一种新的视角。', greeting: '问候语', 'HTML-like selection should be safe.': '<img src=x onerror="alert(1)"> 这段 HTML 必须以文本显示。' };
  window.chrome ||= {};
  window.chrome.runtime = {
    onMessage: { addListener(listener) { listeners.push(listener); } },
    async sendMessage(message) {
      if (message.type === 'GET_PUBLIC_SETTINGS') return { ok: true, settings: { ...settings } };
      if (message.type === 'CANCEL_TRANSLATION') { cancellations.push({ ...message }); return { ok: true }; }
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
    startElement.scrollIntoView({ block: 'nearest', behavior: 'instant' });
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
      setEnabled(false); calls.length = 0; cancellations.length = 0; delays.length = 0; window.getSelection().removeAllRanges(); window.scrollTo({ top: 0, behavior: 'instant' });
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

      const completedHost = host(), completedResult = roots.get(completedHost).querySelector('.result').textContent;
      const completedRect = completedHost.getBoundingClientRect(), completedCalls = calls.length, completedCancellations = cancellations.length;
      const initialScroll = window.scrollY;
      window.scrollBy({ top: 120, behavior: 'instant' }); await wait(100);
      const scrolledRect = host()?.getBoundingClientRect();
      check(window.scrollY > initialScroll && host() === completedHost && status()?.state === 'complete'
        && roots.get(completedHost).querySelector('.result').textContent === completedResult
        && Math.abs(scrolledRect.left - completedRect.left) < 1 && Math.abs(scrolledRect.top - completedRect.top) < 1
        && calls.length === completedCalls && cancellations.length === completedCancellations,
      '页面实际滚动后保留同一划词译文与屏幕位置，不重复请求或取消');
      window.scrollTo({ top: initialScroll, behavior: 'instant' }); await wait(40);

      const nestedScroll = $('scroll-container'); nestedScroll.scrollTop = 60; await wait(100);
      check(nestedScroll.scrollTop > 0 && host() === completedHost && calls.length === completedCalls && cancellations.length === completedCancellations,
        '嵌套滚动容器的真实滚动不会关闭译文或取消请求');
      nestedScroll.scrollTop = 0; await wait(30);

      completedHost.style.left = `${window.innerWidth + 500}px`; completedHost.style.top = `${window.innerHeight + 500}px`;
      window.dispatchEvent(new Event('resize')); await wait(50);
      const resizedRect = host()?.getBoundingClientRect();
      check(host() === completedHost && status()?.state === 'complete' && resizedRect.left >= 0 && resizedRect.top >= 0
        && resizedRect.right <= window.innerWidth + 1 && resizedRect.bottom <= window.innerHeight + 1
        && calls.length === completedCalls && cancellations.length === completedCancellations,
      '调整视口时仅将划词卡片限制在可视区域，不关闭或重新翻译');

      delays.push(550); const beforeScrollLoading = calls.length;
      select($('source-two')); release();
      await until(() => calls.length === beforeScrollLoading + 1 && status()?.state === 'loading', '滚动前的在途划词请求');
      const loadingHost = host(), loadingCancellations = cancellations.length, loadingScroll = window.scrollY;
      window.scrollBy({ top: 90, behavior: 'instant' }); await wait(80);
      check(window.scrollY > loadingScroll && host() === loadingHost && status()?.state === 'loading' && cancellations.length === loadingCancellations,
        '译文加载期间滚动页面不会收起加载卡片或取消网络请求');
      await until(() => host() === loadingHost && status()?.state === 'complete', '滚动后原请求完成');
      check(roots.get(loadingHost).textContent.includes('一种新的语言，一种新的视角。')
        && calls.length === beforeScrollLoading + 1 && cancellations.length === loadingCancellations,
      '滚动后原请求仍在同一卡片中完成，不产生重复请求');
      window.scrollTo({ top: loadingScroll, behavior: 'instant' }); await wait(40);

      const stoppedSource = $('stopped-release-source');
      let stoppedEvents = 0;
      const stopRelease = event => { stoppedEvents++; event.stopPropagation(); };
      stoppedSource.addEventListener('pointerup', stopRelease);
      stoppedSource.addEventListener('mouseup', stopRelease);
      stoppedSource.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
      select(stoppedSource);
      stoppedSource.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
      stoppedSource.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
      await until(() => status()?.state === 'complete' && calls.at(-1)?.text === stoppedSource.textContent, '页面阻止冒泡后的翻译');
      check(stoppedEvents === 2, '网页阻止鼠标松开事件冒泡时，仍能触发划词翻译');
      stoppedSource.removeEventListener('pointerup', stopRelease);
      stoppedSource.removeEventListener('mouseup', stopRelease);

      select($('contents-source')); release();
      await until(() => status()?.state === 'complete' && calls.at(-1)?.text === $('contents-source').textContent, 'display:contents 可见文字');
      check(getComputedStyle($('contents-source')).display === 'contents' && roots.get(host()).textContent.includes($('contents-source').textContent), '无自身布局框的 display:contents 可见文字可以划词翻译');

      const codeNode = $('public-code'), codeWord = $('code-word'), codeText = codeWord.firstChild, codeHTML = codeNode.innerHTML;
      select(codeWord); release();
      await until(() => status()?.state === 'complete' && calls.at(-1)?.text === 'greeting', '代码块单词翻译');
      check(roots.get(host()).textContent.includes('问候语') && codeNode.innerHTML === codeHTML && codeWord.firstChild === codeText, '显式划选代码块中的单词会显示译文，代码与原有节点保持不变');

      const beforeBlur = calls.length;
      $('source-one').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
      select($('source-one')); await wait(30); window.dispatchEvent(new Event('blur')); await wait(330);
      const blurCanceled = !host() && calls.length === beforeBlur;
      select($('source-two'));
      await until(() => status()?.state === 'complete' && calls.length === beforeBlur + 1, '失焦后恢复键盘选区');
      check(blurCanceled, '拖动中失焦会取消未完成选区，返回后键盘划选仍可翻译');

      const privateCount = calls.length;
      select($('cross-start'), $('cross-end')); release(); await wait(330);
      select($('hidden-start'), $('hidden-end')); release(); await wait(330);
      check(calls.length === privateCount && calls.every(call => !call.text.includes('PRIVATE_')), '拒绝跨过表单或 CSS 隐藏文本的选区');

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
    } finally { running = false; $('run').disabled = false; $('preview').disabled = false; window.scrollTo({ top: 0, behavior: 'instant' }); }
  }
  $('run').addEventListener('click', run);
  $('disable').addEventListener('click', () => setEnabled(false));
  $('preview').addEventListener('click', () => { if (running) return; setEnabled(true); $('source-one').scrollIntoView({ block: 'center' }); select($('source-one')); release(); });
  window.addEventListener('error', event => errors.push(event.message));
  window.addEventListener('unhandledrejection', event => errors.push(String(event.reason?.message || event.reason)));
})();
