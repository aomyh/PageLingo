(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const root = new URL('../', location.href);
  const frame = $('floating-frame');
  const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  let running = false, results = [];

  function installMock(popoverMode = 'native') {
    const roots = new WeakMap(), attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (options) { const shadow = attach.call(this, options); roots.set(this, shadow); return shadow; };
    const popoverDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'showPopover');
    if (popoverMode === 'unavailable') Object.defineProperty(HTMLElement.prototype, 'showPopover', { configurable: true, writable: true, value: undefined });
    if (popoverMode === 'throws') Object.defineProperty(HTMLElement.prototype, 'showPopover', { configurable: true, writable: true, value() { throw new DOMException('模拟：此浏览器拒绝 popover', 'NotSupportedError'); } });
    const settings = { activeProvider: 'deepseek', providerName: 'DeepSeek', model: 'mock-fast-model', ready: true, targetLanguage: 'zh-CN', selectionEnabled: false, cacheEnabled: true };
    const listeners = [];
    const mock = window.__floatingMock = {
      roots, calls: [], errors: [], pending: [], copied: [], windowOpens: 0, windowCloses: 0,
      secretReads: 0, mode: 'success', answer: '这是模拟译文。', cached: false, clipboardError: false,
      revision: 'mock-config-1', settings: () => structuredClone(settings),
      restorePopover() { if (popoverDescriptor) Object.defineProperty(HTMLElement.prototype, 'showPopover', popoverDescriptor); else delete HTMLElement.prototype.showPopover; },
      complete(index, text = '迟到的模拟译文') {
        const entry = this.pending[index];
        if (!entry) throw new Error(`模拟请求不存在：${index}`);
        entry.resolve({ ok: true, text, cached: false, providerId: settings.activeProvider, model: settings.model, targetLanguage: entry.message.targetLanguage });
      },
      updateSettings(patch = {}) { Object.assign(settings, patch); this.revision = `mock-config-${Date.now()}-${Math.random()}`; },
      broadcast(message) { for (const listener of listeners) listener(message, {}, () => {}); },
    };
    window.open = () => { mock.windowOpens++; throw new Error('手动浮窗不应打开浏览器页面'); };
    window.close = () => { mock.windowCloses++; };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { async writeText(value) { if (mock.clipboardError) throw new Error('模拟：剪贴板不可用'); mock.copied.push(value); } } });
    window.chrome = { runtime: {
      id: 'pagelingo-floating-test',
      onMessage: { addListener: listener => listeners.push(listener) },
      async sendMessage(message) {
        mock.calls.push(structuredClone(message));
        if (message.type === 'GET_MANUAL_SETTINGS') return { ok: true, settings: structuredClone(settings), configurationRevision: mock.revision };
        if (message.type === 'CANCEL_TEXT_TRANSLATION') return { ok: true };
        if (message.type === 'MANUAL_OPEN_OPTIONS') return { ok: true };
        if (message.type !== 'TRANSLATE_TEXT') throw new Error(`不允许的浮窗消息：${message.type}`);
        if (mock.mode === 'error') return { ok: false, error: '模拟：AI 服务暂时不可用', code: 'HTTP_503' };
        if (mock.mode === 'hold') return new Promise(resolve => mock.pending.push({ message: structuredClone(message), resolve }));
        return { ok: true, text: mock.answer, cached: mock.cached, providerId: settings.activeProvider, model: settings.model, targetLanguage: message.targetLanguage };
      },
    }, windows: { create: () => { throw new Error('浮窗不可创建浏览器窗口'); } }, tabs: { create: () => { throw new Error('浮窗不可创建标签页'); } } };
    Object.defineProperty(window.chrome, 'storage', { get() { mock.secretReads++; throw new Error('内容脚本不应读取密钥存储'); } });
    window.addEventListener('error', event => mock.errors.push(event.message));
    window.addEventListener('unhandledrejection', event => mock.errors.push(String(event.reason?.message || event.reason)));
  }
  async function until(predicate, label) {
    const deadline = performance.now() + 6000;
    while (performance.now() < deadline) { if (predicate()) return; await wait(16); }
    throw new Error(`等待超时：${label}`);
  }
  async function settle() { await new Promise(resolve => frame.contentWindow.requestAnimationFrame(() => frame.contentWindow.requestAnimationFrame(resolve))); }
  function check(condition, label) {
    const value = { pass: Boolean(condition), label }; results.push(value);
    const item = document.createElement('li'); item.className = value.pass ? 'pass' : 'fail'; item.textContent = `${value.pass ? 'PASS' : 'FAIL'} · ${label}`; $('results').append(item);
  }
  async function inject() {
    const child = frame.contentWindow, doc = frame.contentDocument;
    const script = doc.createElement('script');
    script.src = new URL(`manual-panel.js?floating-run=${Date.now()}-${Math.random()}`, root).href;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('等待超时：注入 manual-panel.js')), 6000);
      script.addEventListener('load', () => { clearTimeout(timer); resolve(); }, { once: true });
      script.addEventListener('error', () => { clearTimeout(timer); reject(new Error('manual-panel.js 加载失败')); }, { once: true });
      doc.head.append(script);
    });
    await until(() => doc.querySelector('[data-pagelingo="manual"]') && child.__floatingMock.roots.get(doc.querySelector('[data-pagelingo="manual"]'))?.getElementById('manual-provider')?.textContent.includes('DeepSeek'), '正式浮窗初始化');
    await settle();
  }
  async function loadFixture({ popoverMode = 'native' } = {}) {
    const markup = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>可阅读的普通网页 · 浮窗测试</title><style>body{margin:0;background:#edf1e6;font:16px/1.9 Georgia,serif;color:#33432a;padding:32px;min-height:1800px}article{max-width:620px;margin:auto;background:#fff;border:1px solid #dde4d2;border-radius:12px;padding:32px}h1{font-size:28px;line-height:1.3}p{margin:18px 0}body button,body textarea,body select{font-size:56px!important;color:red!important;background:black!important;border:18px solid purple!important}#outside{margin-top:28px;padding:20px;border:1px dashed #a8b697}</style></head><body><article><h1>Stay curious. Keep reading.</h1><p>A translation tool should let you keep your place in the page. This is ordinary webpage content, with its own styles and scrolling.</p><p>下面的浮窗由正式内容脚本注入，不需要打开新标签页。你可以在这里拖动它，也可以复制文字后手动输入。</p><div id="outside" tabindex="0">模拟网页空白区域：点击这里不会关闭翻译浮窗。</div><p>Original content remains in place.</p></article><script>(${installMock.toString()})(${JSON.stringify(popoverMode)});<\/script></body></html>`;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('等待超时：加载模拟网页')), 6000);
      frame.addEventListener('load', () => { clearTimeout(timer); resolve(); }, { once: true }); frame.srcdoc = markup;
    });
    await inject();
  }
  function syntheticDrag(child, handle, start, end) {
    // Synthetic events are not active hardware pointers. Capture is mocked only
    // for this test; the actual layout and pointer handlers remain production.
    handle.setPointerCapture = () => {};
    handle.releasePointerCapture = () => {};
    handle.dispatchEvent(new child.PointerEvent('pointerdown', { bubbles: true, composed: true, button: 0, buttons: 1, pointerId: 71, isPrimary: true, clientX: start.x, clientY: start.y }));
    handle.dispatchEvent(new child.PointerEvent('pointermove', { bubbles: true, composed: true, button: 0, buttons: 1, pointerId: 71, isPrimary: true, clientX: end.x, clientY: end.y }));
    handle.dispatchEvent(new child.PointerEvent('pointerup', { bubbles: true, composed: true, button: 0, buttons: 0, pointerId: 71, isPrimary: true, clientX: end.x, clientY: end.y }));
  }
  async function run() {
    if (running) return;
    running = true; results = []; $('run').disabled = true; $('preview').disabled = true;
    $('summary').textContent = '正在运行…'; $('results').replaceChildren(); $('error').textContent = ''; $('metrics').textContent = '';
    document.documentElement.dataset.testResult = 'running';
    try {
      await loadFixture();
      const child = frame.contentWindow, doc = frame.contentDocument, mock = child.__floatingMock;
      const host = () => doc.querySelector('[data-pagelingo="manual"]');
      const firstHost = host(), shadow = mock.roots.get(firstHost);
      const el = id => shadow.getElementById(id), text = id => el(id).textContent;
      const input = value => { el('manual-input').value = value; el('manual-input').dispatchEvent(new child.Event('input', { bubbles: true, composed: true })); };
      const language = value => { el('manual-language').value = value; el('manual-language').dispatchEvent(new child.Event('change', { bubbles: true, composed: true })); };
      const requests = () => mock.calls.filter(call => call.type === 'TRANSLATE_TEXT');
      const cancellations = () => mock.calls.filter(call => call.type === 'CANCEL_TEXT_TRANSLATION');
      const last = () => requests().at(-1);
      check(doc.querySelectorAll('[data-pagelingo="manual"]').length === 1 && !firstHost.shadowRoot && firstHost.getAttribute('translate') === 'no', '正式脚本在当前网页注入一个 closed Shadow DOM 浮窗，且标记不参与网页翻译');
      check(mock.windowOpens === 0 && mock.windowCloses === 0 && mock.calls.every(call => !['OPEN_TEXT_TRANSLATOR', 'SET_SELECTION_ENABLED'].includes(call.type)), '打开浮窗不创建新标签页或浏览器窗口，也不启用划词');
      check(el('manual-language').value === 'zh-CN' && el('manual-input').value === '' && el('manual-copy').disabled, '首次打开使用已保存的公开语言和模型，输入及结果为空');
      check(child.getComputedStyle(el('manual-input')).color !== 'rgb(255, 0, 0)' && parseFloat(child.getComputedStyle(el('manual-input')).fontSize) < 30, '网页破坏性的全局表单样式不会污染浮窗');
      input('   '); el('manual-translate').click(); await wait(20);
      check(requests().length === 0, '空白输入不请求 AI 服务');
      input('Keep my place in the page.'); language('en'); mock.answer = 'A real-looking mock translation.'; el('manual-translate').click();
      await until(() => text('manual-output') === mock.answer && !el('manual-copy').disabled, '手动翻译完成');
      check(last().text === 'Keep my place in the page.' && last().targetLanguage === 'en' && Object.keys(last()).sort().join(',') === 'requestId,targetLanguage,text,type', '只向后台发送用户输入、目标语言和请求ID，不传 Key 或任意服务配置');
      const beforeRepeat = requests().length; await inject();
      check(host() === firstHost && el('manual-input').value === 'Keep my place in the page.' && text('manual-output') === mock.answer && requests().length === beforeRepeat, '重复点击入口或重新注入复用原浮窗，保留输入和译文且不再次请求 AI');
      el('manual-copy').click(); await until(() => mock.copied.length === 1, '复制结果');
      check(mock.copied[0] === mock.answer, '复制按钮只复制实际译文');
      mock.clipboardError = true; el('manual-copy').click();
      await until(() => text('manual-status').includes('复制'), '复制失败提示'); await wait(20);
      check(text('manual-output') === mock.answer && !el('manual-copy').disabled, '剪贴板不可用时保留译文和手动复制途径'); mock.clipboardError = false;
      input('Changed text');
      check(text('manual-result-note').includes('修改') && el('manual-copy').disabled, '输入修改保留旧结果并明确标记过期');
      mock.answer = '<img src=x onerror="window.__unexpectedScript=1">安全文本'; el('manual-translate').click();
      await until(() => text('manual-output') === mock.answer, '安全文本显示');
      check(!el('manual-output').querySelector('img') && !child.__unexpectedScript, '模型返回的 HTML 仅作为文字显示，不执行代码');
      mock.cached = true; mock.answer = '缓存返回'; el('manual-translate').click();
      await until(() => text('manual-output') === mock.answer, '本地缓存返回');
      check(text('manual-result-note').includes('缓存') || text('manual-status').includes('缓存'), '缓存复用有明确提示'); mock.cached = false;
      mock.mode = 'error'; input('Retry source'); el('manual-translate').click();
      await until(() => text('manual-status').includes('模拟：AI 服务暂时不可用'), '失败响应');
      check(!el('manual-translate').disabled && el('manual-input').value === 'Retry source', '服务失败保留原文并允许重试');
      mock.mode = 'success'; mock.answer = '重试成功'; el('manual-translate').click();
      await until(() => text('manual-output') === '重试成功', '重试恢复');
      check(!text('manual-status').includes('服务暂时不可用'), '成功重试后清除旧错误');
      mock.mode = 'hold'; input('Cancel this request'); el('manual-translate').click();
      await until(() => mock.pending.length === 1, '等待可取消请求');
      const cancelledId = mock.pending[0].message.requestId; el('manual-cancel').click();
      await until(() => cancellations().some(call => call.requestId === cancelledId), '取消消息');
      mock.complete(0, '不应显示的迟到译文'); await wait(30);
      check(text('manual-output') === '重试成功' && !el('manual-translate').disabled, '主动取消后丢弃迟到响应，旧译文与输入仍保留');
      input('Old input pending'); el('manual-translate').click(); await until(() => mock.pending.length === 2, '等待旧输入请求');
      const editedId = mock.pending[1].message.requestId; input('New input');
      await until(() => cancellations().some(call => call.requestId === editedId), '编辑时取消');
      mock.mode = 'success'; mock.answer = '新内容结果'; el('manual-translate').click();
      await until(() => text('manual-output') === mock.answer, '新内容翻译'); mock.complete(1, '旧内容迟到结果'); await wait(30);
      check(text('manual-output') === '新内容结果' && last().text === 'New input', '编辑内容取消旧请求，新译文不会被旧响应覆盖');
      language('ja');
      check(el('manual-copy').disabled && text('manual-result-note').includes('修改'), '改变目标语言使旧译文过期');
      mock.answer = 'ショートカットの翻訳'; const shortcutBefore = requests().length;
      el('manual-input').dispatchEvent(new child.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, composed: true, cancelable: true }));
      await until(() => requests().length > shortcutBefore && text('manual-output') === mock.answer, '快捷键翻译');
      check(last().targetLanguage === 'ja', 'Ctrl+Enter 使用当前目标语言翻译');
      mock.updateSettings(); child.dispatchEvent(new child.Event('focus'));
      await until(() => el('manual-copy').disabled && /更新|配置|服务/.test(text('manual-result-note') + text('manual-status')), '配置版本变化');
      check(text('manual-output') === 'ショートカットの翻訳', '公开配置版本改变时保留旧译文并标记过期，不读取 Key');
      mock.mode = 'hold'; input('Configuration changes pending'); el('manual-translate').click(); await until(() => mock.pending.length === 3, '配置变化中请求');
      const configId = mock.pending[2].message.requestId; mock.updateSettings(); child.dispatchEvent(new child.Event('focus'));
      await until(() => cancellations().some(call => call.requestId === configId), '配置变化取消');
      mock.complete(2, '旧配置迟到响应'); await wait(30);
      check(text('manual-output') !== '旧配置迟到响应' && !el('manual-translate').disabled, '在途请求遇到配置变化会取消，并丢弃旧服务结果');
      mock.mode = 'success'; const oversizedBefore = requests().length; input('😀'.repeat(5001)); el('manual-translate').click(); await wait(20);
      check(requests().length === oversizedBefore && el('manual-translate').disabled, '超过 5,000 Unicode 字符不发请求');
      input('😀'.repeat(5000)); mock.answer = 'Emoji 边界结果'; el('manual-translate').click();
      await until(() => text('manual-output') === mock.answer, 'Emoji 边界翻译');
      check([...last().text].length === 5000 && last().text.length === 10000, '5,000 个 Emoji 按 Unicode 字符正确计数并允许翻译');
      doc.getElementById('outside').click(); child.dispatchEvent(new child.Event('blur'));
      doc.dispatchEvent(new child.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
      child.scrollTo(0, 300); await settle();
      check(host() === firstHost && el('manual-input').value === '😀'.repeat(5000) && text('manual-output') === 'Emoji 边界结果', '点击网页、失焦、Escape 和网页滚动都不会关闭浮窗或清空内容');
      const drag = el('manual-drag-handle'), beforeDrag = firstHost.getBoundingClientRect();
      syntheticDrag(child, drag, { x: beforeDrag.left + 40, y: beforeDrag.top + 15 }, { x: beforeDrag.left - 90, y: beforeDrag.top + 50 }); await settle();
      const afterDrag = firstHost.getBoundingClientRect();
      check(Math.abs(afterDrag.left - beforeDrag.left) > 2 || Math.abs(afterDrag.top - beforeDrag.top) > 2, '标题栏指针拖动会实际改变浮窗位置');
      syntheticDrag(child, drag, { x: afterDrag.left + 40, y: afterDrag.top + 15 }, { x: child.innerWidth * 4, y: child.innerHeight * 4 }); await settle();
      const clamped = firstHost.getBoundingClientRect();
      check(clamped.left >= -1 && clamped.top >= -1 && clamped.right <= child.innerWidth + 1 && clamped.bottom <= child.innerHeight + 1, '拖动到页面边缘会限制在视口中，关闭与输入仍可触达');
      const resize = el('manual-resize-handle');
      syntheticDrag(child, resize, { x: clamped.right - 8, y: clamped.bottom - 8 }, { x: clamped.right - 38, y: clamped.bottom - 38 }); await settle();
      const resized = firstHost.getBoundingClientRect();
      check(resized.width < clamped.width && resized.height < clamped.height && resized.right <= child.innerWidth + 1 && resized.bottom <= child.innerHeight + 1, '右下角拖动可调整浮窗大小，仍受视口边界保护');
      el('manual-clear').click();
      check(!el('manual-input').value && el('manual-copy').disabled && text('manual-output') !== 'Emoji 边界结果', '清空只清除浮窗中的输入与结果');
      check(mock.secretReads === 0 && mock.calls.every(call => !['TEST_CONNECTION', 'CLEAR_CACHE', 'SET_SELECTION_ENABLED'].includes(call.type)) && mock.windowOpens === 0 && mock.windowCloses === 0, '整个流程不读取密钥、不修改配置、不打开或关闭浏览器页面');
      mock.mode = 'hold'; input('Close current panel'); el('manual-translate').click(); await until(() => mock.pending.length === 4, '关闭时活跃请求');
      const closeId = mock.pending.at(-1).message.requestId; el('manual-close').click();
      await until(() => !host() && cancellations().some(call => call.requestId === closeId), '关闭取消请求');
      check(mock.windowCloses === 0, '明确点击关闭只移除当前浮窗，并取消后台请求');
      mock.complete(3, '关闭后迟到结果'); await wait(30);
      check(!host(), '关闭后迟到响应不会重新打开浮窗');
      await inject();
      check(doc.querySelectorAll('[data-pagelingo="manual"]').length === 1 && mock.roots.get(host()).getElementById('manual-input').value === '', '显式关闭后再次打开显示空浮窗');
      const reopenedRoot = mock.roots.get(host()), reopenedInput = reopenedRoot.getElementById('manual-input');
      reopenedInput.value = 'Page navigation cancels work'; reopenedInput.dispatchEvent(new child.Event('input', { bubbles: true }));
      reopenedRoot.getElementById('manual-translate').click(); await until(() => mock.pending.length === 5, '页面离开时的请求');
      const leavingId = mock.pending.at(-1).message.requestId; child.dispatchEvent(new child.PageTransitionEvent('pagehide'));
      await until(() => !host() && cancellations().some(call => call.requestId === leavingId), '页面离开取消请求');
      mock.complete(4, '页面离开后的迟到结果'); await wait(20);
      check(!host() && mock.windowCloses === 0, '离开当前网页时取消在途请求，迟到结果不会创建页面或重新弹出浮窗');
      check(mock.errors.length === 0, '生产脚本无未捕获错误或未处理 Promise 拒绝');
      for (const mode of ['unavailable', 'throws']) {
        await loadFixture({ popoverMode: mode });
        const fallbackDoc = frame.contentDocument, fallbackChild = frame.contentWindow, fallbackMock = fallbackChild.__floatingMock;
        const fallbackHost = fallbackDoc.querySelector('[data-pagelingo="manual"]'), fallbackRoot = fallbackMock.roots.get(fallbackHost);
        const rect = fallbackHost.getBoundingClientRect(), computed = fallbackChild.getComputedStyle(fallbackHost);
        const visible = rect.width > 200 && rect.height > 200 && computed.display !== 'none' && computed.visibility !== 'hidden';
        fallbackRoot.getElementById('manual-close').click();
        check(visible && !fallbackDoc.querySelector('[data-pagelingo="manual"]') && fallbackMock.windowOpens === 0 && fallbackMock.windowCloses === 0 && fallbackMock.errors.length === 0, mode === 'unavailable' ? '浏览器没有 Popover API 时使用可见的固定浮窗，可关闭且不新开页面' : '浏览器拒绝 showPopover 时回退可见浮窗，可关闭且不新开页面');
        fallbackMock.restorePopover();
      }
      $('metrics').textContent = `全部使用模拟接口\n翻译请求：${requests().length} 次\n取消消息：${cancellations().length} 次\n密钥存储读取：${mock.secretReads} 次\n浏览器页面打开：${mock.windowOpens} 次\n浏览器页面关闭：${mock.windowCloses} 次\n脚本错误：${mock.errors.length} 条`;
      if (mock.errors.length) $('error').textContent = mock.errors.join('\n');
    } catch (error) { check(false, '完成全部浮窗集成检查'); $('error').textContent = error.stack || error.message; }
    finally {
      const pass = results.filter(result => result.pass).length;
      $('summary').textContent = `${pass} / ${results.length} 项通过`; document.documentElement.dataset.testResult = pass === results.length ? 'pass' : 'fail';
      window.__manualFloatingResults = { pass, total: results.length, results, error: $('error').textContent };
      running = false; $('run').disabled = false; $('preview').disabled = false;
    }
  }
  $('run').addEventListener('click', run);
  $('preview').addEventListener('click', async () => { if (running) return; try { await loadFixture(); $('summary').textContent = '模拟浮窗已显示，可直接拖动标题栏检查'; } catch (error) { $('error').textContent = error.stack || error.message; } });
})();
