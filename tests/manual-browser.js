(() => {
  'use strict';
  if (new URLSearchParams(location.search).has('fixture')) return;
  const $ = id => document.getElementById(id);
  const root = new URL('../', location.href);
  const frame = $('manual-frame');
  const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  let running = false, results = [];

  function installChromeMock() {
    history.replaceState(null, '', new URL('translate.html', document.baseURI).href);
    const key = 'pagelingo.settings.v1';
    const listeners = [];
    const settings = {
      activeProvider: 'deepseek', targetLanguage: 'zh-CN', displayMode: 'bilingual', concurrency: 4,
      batchSize: 2200, cacheEnabled: true, translateDynamic: true, selectionEnabled: false,
      providers: { deepseek: { apiKey: 'MOCK_KEY_NOT_REAL_MANUAL_TEST', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com/v1' } },
    };
    const mock = window.__manualMock = {
      calls: [], errors: [], writes: [], pending: [], closeCalls: 0, copied: [],
      mode: 'success', answer: '这是一段模拟译文。', cached: false, clipboardError: false,
      settings: () => structuredClone(settings),
      complete(index, answer = '迟到的模拟译文') {
        const entry = this.pending[index];
        if (!entry) throw new Error(`不存在模拟请求 ${index}`);
        entry.resolve({ ok: true, text: answer, cached: false, providerId: 'deepseek', model: 'deepseek-flash', targetLanguage: entry.message.targetLanguage });
      },
      emitSettings() { for (const listener of listeners) listener({ [key]: { newValue: structuredClone(settings) } }, 'local'); },
      updateProviderConfig(patch) { Object.assign(settings.providers.deepseek, patch); this.emitSettings(); },
    };
    window.close = () => { mock.closeCalls++; };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      async writeText(value) { if (mock.clipboardError) throw new Error('模拟：剪贴板不可用'); mock.copied.push(value); },
    } });
    window.addEventListener('error', event => mock.errors.push(event.message));
    window.addEventListener('unhandledrejection', event => mock.errors.push(String(event.reason?.message || event.reason)));
    window.chrome = {
      runtime: {
        id: 'pagelingo-manual-browser-test', getURL: path => new URL(path, document.baseURI).href,
        async openOptionsPage() { mock.calls.push({ type: 'OPEN_OPTIONS_PAGE' }); },
        async sendMessage(message) {
          mock.calls.push(structuredClone(message));
          if (message.type === 'CANCEL_TEXT_TRANSLATION') return { ok: true };
          if (message.type !== 'TRANSLATE_TEXT') throw new Error(`测试禁止的运行时消息：${message.type}`);
          if (mock.mode === 'error') return { ok: false, error: '模拟：服务暂时不可用，请重试。', code: 'HTTP_503' };
          if (mock.mode === 'hold') return new Promise(resolve => { mock.pending.push({ message: structuredClone(message), resolve }); });
          return { ok: true, text: mock.answer, cached: mock.cached, providerId: 'deepseek', model: 'deepseek-flash', targetLanguage: message.targetLanguage };
        },
      },
      storage: {
        local: { get: async () => ({ [key]: structuredClone(settings) }), set: async patch => { mock.writes.push(structuredClone(patch)); } },
        onChanged: { addListener: listener => listeners.push(listener) },
      },
      permissions: { request: async () => { throw new Error('手动翻译不应申请当前网页访问权限'); } },
    };
  }
  async function until(predicate, description) {
    const started = performance.now();
    while (performance.now() - started < 6000) { if (predicate()) return; await wait(16); }
    throw new Error(`等待超时：${description}`);
  }
  function check(condition, label) {
    const value = { pass: Boolean(condition), label };
    results.push(value);
    const item = document.createElement('li'); item.className = value.pass ? 'pass' : 'fail';
    item.textContent = `${value.pass ? 'PASS' : 'FAIL'} · ${label}`; $('results').append(item);
  }
  async function loadWindow() {
    const query = `manual-run=${Date.now()}`;
    const markup = await fetch(new URL(`translate.html?${query}`, root), { cache: 'no-store', signal: AbortSignal.timeout(6000) }).then(response => { if (!response.ok) throw new Error(`translate.html HTTP ${response.status}`); return response.text(); });
    const doc = new DOMParser().parseFromString(markup, 'text/html');
    doc.querySelector('script[src="translate.js"]').remove();
    const base = doc.createElement('base'); base.href = root.href; doc.head.prepend(base);
    doc.querySelector('link[rel="stylesheet"]').href = new URL(`translate.css?${query}`, root).href;
    const install = doc.createElement('script'); install.textContent = `(${installChromeMock.toString()})();`; doc.head.append(install);
    const module = doc.createElement('script'); module.type = 'module'; module.src = new URL(`translate.js?${query}`, root).href; doc.head.append(module);
    await new Promise((resolve, reject) => {
      const loaded = () => { clearTimeout(timeout); resolve(); };
      const timeout = setTimeout(() => { frame.removeEventListener('load', loaded); reject(new Error('等待超时：同源 fixture 导航')); }, 6000);
      frame.addEventListener('load', loaded, { once: true }); frame.src = new URL(`tests/manual-browser.html?fixture=1&${query}`, root).href;
    });
    frame.contentDocument.open(); frame.contentDocument.write('<!doctype html>' + doc.documentElement.outerHTML); frame.contentDocument.close();
    await until(() => frame.contentWindow.__manualMock && frame.contentDocument.getElementById('manual-provider')?.textContent.includes('DeepSeek') && frame.contentDocument.getElementById('manual-language')?.options.length === 12, '正式手动翻译模块初始化');
    await until(() => !frame.contentDocument.fonts || frame.contentDocument.fonts.status === 'loaded', '字体加载');
  }

  async function run() {
    if (running) return;
    running = true; results = []; $('run').disabled = true; $('summary').textContent = '正在运行…';
    $('results').replaceChildren(); $('error').textContent = ''; $('metrics').textContent = '';
    document.documentElement.dataset.testResult = 'running'; delete window.__manualBrowserResults;
    try {
      await loadWindow();
      const doc = frame.contentDocument, child = frame.contentWindow, mock = child.__manualMock;
      const el = id => doc.getElementById(id), text = id => el(id).textContent;
      const input = value => { el('manual-input').value = value; el('manual-input').dispatchEvent(new child.Event('input', { bubbles: true })); };
      const language = value => { el('manual-language').value = value; el('manual-language').dispatchEvent(new child.Event('change', { bubbles: true })); };
      const requests = () => mock.calls.filter(call => call.type === 'TRANSLATE_TEXT');
      const cancellations = () => mock.calls.filter(call => call.type === 'CANCEL_TEXT_TRANSLATION');
      const lastRequest = () => requests().at(-1);
      const baselineSettings = JSON.stringify(mock.settings());
      check(el('manual-language').value === 'zh-CN' && text('manual-model').includes('deepseek-flash') && !el('manual-input').value && el('manual-copy').disabled, '首次打开使用当前模型与语言，保留空输入且不伪造译文');
      const initialRequests = requests().length;
      input('   '); el('manual-translate').click(); await wait(20);
      check(requests().length === initialRequests, '空白输入不会发起翻译请求');

      input('A useful sentence.'); language('en'); mock.answer = 'A mock translation.'; el('manual-translate').click();
      await until(() => text('manual-output') === mock.answer && !el('manual-copy').disabled, '成功翻译');
      check(lastRequest().text === 'A useful sentence.' && lastRequest().targetLanguage === 'en' && typeof lastRequest().requestId === 'string' && !JSON.stringify(lastRequest()).includes('MOCK_KEY'), '手动输入与目标语言发送给后台，不在消息中传递 Key 或任意服务商配置');
      check(!mock.settings().selectionEnabled && mock.calls.every(call => !['SET_SELECTION_ENABLED', 'TRANSLATE_SELECTION'].includes(call.type)), '划词开关关闭时仍可手动翻译，不改变划词设置');
      el('manual-copy').click(); await until(() => mock.copied.length === 1, '复制译文');
      check(mock.copied[0] === 'A mock translation.', '复制按钮只写入实际译文');
      mock.clipboardError = true; el('manual-copy').click();
      await until(() => text('manual-status').includes('无法自动复制'), '剪贴板失败提示');
      check(text('manual-output') === 'A mock translation.' && !el('manual-copy').disabled, '剪贴板不可用时保留译文并提供手动复制提示');
      mock.clipboardError = false;

      input('Changed source.');
      check(text('manual-output') === 'A mock translation.' && text('manual-result-note').includes('修改'), '编辑原文保留旧译文并标记内容已修改');
      mock.answer = '<img src=x onerror="window.__unexpectedScript=1">安全文本'; el('manual-translate').click();
      await until(() => text('manual-output') === mock.answer, '安全显示模型输出');
      check(!el('manual-output').querySelector('img') && !child.__unexpectedScript, '模型返回 HTML 作为纯文字显示，不执行代码');
      mock.answer = '第一段内容。\n续行内容。\n\n第二段内容。'; el('manual-translate').click();
      await until(() => text('manual-output') === mock.answer && !el('manual-copy').disabled, '多段结果');
      check(el('manual-output').querySelectorAll('.translation-paragraph').length === 3 && text('manual-output') === mock.answer, '每个非空段落有独立标识，空行和原始译文完全保留');
      const paragraphRange = doc.createRange(); paragraphRange.selectNodeContents(el('manual-output'));
      const paragraphSelection = child.getSelection(); paragraphSelection.removeAllRanges(); paragraphSelection.addRange(paragraphRange);
      check(paragraphSelection.toString() === mock.answer, '原生选择只包含原始译文，不包含装饰标识'); paragraphSelection.removeAllRanges();
      const copiedBeforeParagraphs = mock.copied.length; el('manual-copy').click();
      await until(() => mock.copied.length === copiedBeforeParagraphs + 1, '复制多段结果');
      check(mock.copied.at(-1) === mock.answer, '复制多段译文保留换行，不写入标识');

      mock.cached = true; mock.answer = '缓存的模拟译文'; el('manual-translate').click();
      await until(() => text('manual-output') === mock.answer, '缓存返回');
      check(text('manual-result-note').includes('缓存'), '缓存命中有清楚的结果反馈'); mock.cached = false;

      mock.mode = 'error'; input('Retry sample'); el('manual-translate').click();
      await until(() => text('manual-status').includes('模拟：服务暂时不可用'), '模型失败');
      check(!el('manual-translate').disabled && el('manual-input').value === 'Retry sample', '翻译失败后保留输入并允许重试');
      mock.mode = 'success'; mock.answer = '重试成功'; el('manual-translate').click();
      await until(() => text('manual-output') === '重试成功', '失败重试恢复');
      check(!text('manual-status').includes('服务暂时不可用'), '重试成功后不继续显示旧错误');

      mock.mode = 'hold'; input('Cancel this request'); const cancelBefore = cancellations().length;
      el('manual-translate').click(); await until(() => mock.pending.length === 1, '等待取消请求');
      const cancelledId = mock.pending[0].message.requestId; el('manual-cancel').click();
      await until(() => cancellations().some(call => call.requestId === cancelledId), '取消发给后台');
      mock.complete(0, '不应覆盖的迟到译文'); await wait(30);
      check(cancellations().length > cancelBefore && text('manual-output') !== '不应覆盖的迟到译文' && !el('manual-translate').disabled, '主动取消会通知后台，迟到结果不能覆盖已有译文');

      input('Edit while translating'); el('manual-translate').click(); await until(() => mock.pending.length === 2, '等待编辑中请求');
      const replacedId = mock.pending[1].message.requestId;
      input('New source after cancellation');
      await until(() => cancellations().some(call => call.requestId === replacedId), '编辑取消旧请求');
      mock.mode = 'success'; mock.answer = '新内容的译文'; el('manual-translate').click();
      await until(() => text('manual-output') === '新内容的译文', '新内容翻译');
      mock.complete(1, '旧内容迟到的译文'); await wait(30);
      check(text('manual-output') === '新内容的译文' && lastRequest().text === 'New source after cancellation', '修改输入取消旧请求，新请求的结果不被旧响应污染');

      language('ja');
      check(text('manual-output') === '新内容的译文' && text('manual-result-note').includes('修改'), '修改目标语言会将旧译文标为待重新翻译');
      mock.answer = 'ショートカットの翻訳'; const beforeShortcut = requests().length;
      el('manual-input').dispatchEvent(new child.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
      await until(() => requests().length > beforeShortcut && text('manual-output') === mock.answer, 'Ctrl+Enter 快捷翻译');
      check(lastRequest().targetLanguage === 'ja', '键盘快捷键使用当前选择的目标语言');

      const originalProvider = mock.settings().providers.deepseek;
      mock.updateProviderConfig({ apiKey: 'MOCK_REPLACEMENT_KEY_NOT_REAL' });
      await until(() => text('manual-result-note').includes('服务已更新'), '相同模型更换配置');
      check(el('manual-copy').disabled && text('manual-output') === 'ショートカットの翻訳' && el('manual-input').value === 'New source after cancellation' && el('manual-language').value === 'ja', '相同模型更换 Key 后旧译文标为过期，输入和已选语言保持不变');
      mock.mode = 'hold'; input('Endpoint update while translating');
      const updatingIndex = mock.pending.length;
      el('manual-translate').click(); await until(() => mock.pending.length === updatingIndex + 1, '等待服务更新请求');
      const updatedId = mock.pending[updatingIndex].message.requestId;
      mock.updateProviderConfig({ baseUrl: 'https://mock-new-endpoint.invalid/v1' });
      await until(() => cancellations().some(call => call.requestId === updatedId) && text('manual-status').includes('服务已更新'), '服务地址更新取消请求');
      mock.complete(updatingIndex, '不应显示的旧服务译文'); await wait(30);
      check(text('manual-output') === 'ショートカットの翻訳' && el('manual-copy').disabled && !el('manual-translate').disabled && !JSON.stringify(mock.calls).includes('MOCK_REPLACEMENT_KEY_NOT_REAL'), '相同模型更换服务地址会取消在途请求并丢弃迟到结果，消息不包含 Key');
      input('Prepare restored configuration');
      mock.updateProviderConfig(originalProvider);
      await until(() => text('manual-status').includes('服务已更新'), '恢复模拟服务配置');
      mock.mode = 'success';

      const beforeOversize = requests().length; input('😀'.repeat(5001)); el('manual-translate').click(); await wait(20);
      check(requests().length === beforeOversize, '超过 5,000 个 Unicode 字符不会发起请求');
      input('😀'.repeat(5000)); mock.answer = 'Emoji 边界翻译'; el('manual-translate').click();
      await until(() => requests().length > beforeOversize && text('manual-output') === mock.answer, '5,000 个 Emoji 边界');
      check([...lastRequest().text].length === 5000 && lastRequest().text.length === 10000, '5,000 个 Emoji 按 Unicode 字符计数，可正常翻译');

      child.dispatchEvent(new child.Event('blur')); doc.body.click(); child.dispatchEvent(new child.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait(20);
      check(mock.closeCalls === 0 && el('manual-input').value === '😀'.repeat(5000) && text('manual-output') === 'Emoji 边界翻译', '失焦、点击空白与 Escape 不关闭窗口或丢失输入结果');
      el('manual-clear').click();
      check(!el('manual-input').value && el('manual-copy').disabled && text('manual-output') !== 'Emoji 边界翻译', '清空操作清除输入与旧译文并禁用复制');
      check(JSON.stringify(mock.settings()) === baselineSettings && mock.writes.length === 0 && !mock.calls.some(call => call.type === 'TEST_CONNECTION' || call.type === 'CLEAR_CACHE'), '全过程不写入原文、Key 或翻译配置，不清除翻译缓存');
      mock.mode = 'hold'; input('Close while translating'); el('manual-translate').click();
      await until(() => mock.pending.length === updatingIndex + 2, '关闭时进行中的请求');
      const closingId = mock.pending.at(-1).message.requestId;
      el('manual-close').click();
      await until(() => cancellations().some(call => call.requestId === closingId), '关闭取消当前请求');
      check(mock.closeCalls === 1, '只有显式点击关闭按钮才触发窗口关闭，并取消进行中的请求');
      check(mock.errors.length === 0, '正式模块运行没有浏览器错误或未处理 Promise 拒绝');
      $('metrics').textContent = `全部使用模拟接口\n翻译请求：${requests().length} 次\n取消消息：${cancellations().length} 次\n配置写入：${mock.writes.length} 次\n模拟关闭：${mock.closeCalls} 次\n浏览器错误：${mock.errors.length} 条`;
      if (mock.errors.length) $('error').textContent = mock.errors.join('\n');
    } catch (error) { check(false, '运行器完成全部集成场景'); $('error').textContent = error.stack || error.message; }
    finally {
      const pass = results.filter(value => value.pass).length;
      $('summary').textContent = `${pass} / ${results.length} 项通过`;
      document.documentElement.dataset.testResult = pass === results.length ? 'pass' : 'fail';
      window.__manualBrowserResults = { pass, total: results.length, results, error: $('error').textContent };
      running = false; $('run').disabled = false;
    }
  }
  $('run').addEventListener('click', run);
})();
