(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const controls = { run: $('run'), summary: $('summary'), results: $('results'), metrics: $('metrics'), errors: $('error-log') };
  const runtimeListeners = [];
  const uncaughtErrors = [];
  let calls = [];
  let active = 0;
  let maximumActive = 0;
  let runningTest = false;
  const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const config = { targetLanguage: 'zh-CN', displayMode: 'bilingual', concurrency: 3, batchSize: 1200, cacheEnabled: true, translateDynamic: true, activeProvider: 'mock', providerName: '浏览器测试模型', model: 'mock-translation', ready: true };

  function translate(text) {
    if (text === 'An HTML-like translation should remain plain text.') return '<img src=x onerror="alert(1)"> 此处必须显示为文本';
    return `【模拟译文】${text}`;
  }

  const runtime = {
    onMessage: { addListener(listener) { runtimeListeners.push(listener); } },
    async sendMessage(message) {
      if (message.type === 'GET_PUBLIC_SETTINGS') return { ok: true, settings: config };
      if (message.type === 'CANCEL_TRANSLATION') return { ok: true };
      if (message.type !== 'TRANSLATE_BATCH') return { ok: false, error: '测试中出现未知后台消息。' };
      const index = calls.length;
      const entry = { items: message.items.map(item => ({ ...item })), sessionId: message.sessionId, started: performance.now(), finished: null };
      calls.push(entry);
      active++;
      maximumActive = Math.max(maximumActive, active);
      // Intentionally finish batches out of order. Cancellation also leaves the promise alive,
      // so the production content script must itself reject stale responses.
      await delay(index % 3 === 0 ? 90 : index % 3 === 1 ? 240 : 160);
      active--;
      entry.finished = performance.now();
      return { ok: true, translations: [...message.items].reverse().map((item, itemIndex) => ({ id: item.id, text: translate(item.text), cached: itemIndex % 3 === 0 })), cachedCount: Math.ceil(message.items.length / 3) };
    }
  };
  window.chrome ||= {};
  window.chrome.runtime = runtime;

  function message(type, extra = {}) {
    let response;
    for (const listener of runtimeListeners) listener({ type, ...extra }, {}, result => { response = result; });
    if (!response) throw new Error(`未收到内容脚本响应：${type}`);
    return response;
  }

  async function until(predicate, label, timeout = 10000) {
    const started = performance.now();
    while (performance.now() - started < timeout) {
      if (predicate()) return;
      await delay(20);
    }
    throw new Error(`等待超时：${label}`);
  }

  function check(condition, label) {
    const line = document.createElement('li');
    line.className = condition ? 'pass' : 'fail';
    line.textContent = label;
    controls.results.append(line);
    if (!condition) throw new Error(label);
  }

  const paragraphs = [
    'Translation should feel like part of reading, rather than a separate task. A reader opens an article, keeps the original context, and sees translated paragraphs arrive as soon as they are ready. Existing navigation, typography, and useful links should remain available throughout the experience. ',
    'Several small requests can run at the same time without waiting for a large document to finish. The visible part of the article receives priority. Pages with repeated passages can reuse local translations, while new paragraphs receive their own results as they are loaded by the website. ',
    'A website may update its content after the initial page load. The translation session observes those changes, collects newly added prose, and avoids processing its own translated text a second time. Restoring the source page cancels active work and removes every inserted translation. '
  ];
  for (let index = 0; index < 18; index++) {
    const paragraph = document.createElement('p');
    paragraph.textContent = `Section ${index + 1}. ${paragraphs[index % paragraphs.length]}`;
    $('long-paragraphs').append(paragraph);
  }
  const fixtureHTML = $('fixture').innerHTML;

  function sourceNodes(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) nodes.push({ node, value: node.nodeValue });
    return nodes;
  }

  async function run() {
    if (runningTest) return;
    runningTest = true;
    controls.run.disabled = true;
    controls.results.replaceChildren();
    controls.summary.className = '';
    controls.summary.textContent = '正在运行…';
    controls.metrics.textContent = '';
    controls.errors.textContent = '';
    uncaughtErrors.length = 0;
    try {
      message('PAGELINGO_RESTORE');
      await until(() => active === 0, '清理上次运行');
      $('fixture').innerHTML = fixtureHTML;
      calls = [];
      maximumActive = 0;
      const fixture = $('fixture');
      const originals = sourceNodes(fixture);
      const originalText = fixture.textContent;
      const link = $('inline-link');
      const linkText = link.firstChild;
      const emphasis = $('inline-emphasis');
      const emphasisText = emphasis.firstChild;
      const href = link.getAttribute('href');
      const started = performance.now();
      let incremental = false;
      let firstResult = null;
      const response = message('PAGELINGO_START', { settings: config });
      check(response.ok && response.status.state === 'translating', '启动消息立即返回，无需等待整页翻译');
      await until(() => {
        const current = message('PAGELINGO_STATUS').status;
        if (current.completed > 0 && firstResult === null) firstResult = performance.now() - started;
        if (current.state === 'translating' && current.completed > 0 && current.completed < current.total) incremental = true;
        if (current.state === 'error') throw new Error(current.error || '内容脚本报告翻译失败');
        return current.state === 'complete';
      }, '整页翻译完成');
      const completion = message('PAGELINGO_STATUS').status;
      check(maximumActive <= config.concurrency && maximumActive >= 2, `并发受控：峰值 ${maximumActive} 路，配置 ${config.concurrency} 路`);
      check(incremental, '先完成的批次立即显示，整页完成前可见部分译文');
      check(completion.completed === completion.total && completion.total > 18, `所有正文翻译完成：${completion.completed} / ${completion.total} 段`);
      check(calls[0].items[0].text === $('fixture-heading').firstChild.nodeValue, '屏幕内的文章标题优先进入首批请求');
      check(originals.every(item => item.node.nodeValue === item.value), '双语模式保留每个原始文本节点和空白');
      check(link === $('inline-link') && linkText === link.firstChild && emphasis === $('inline-emphasis') && emphasisText === emphasis.firstChild && href === link.getAttribute('href'), '原有链接、强调标签、属性和节点身份均保持不变');
      const sent = calls.flatMap(call => call.items.map(item => item.text)).join('\n');
      check(!/PRIVATE_|EXCLUDED_|HIDDEN_/.test(sent), '不发送表单、编辑区、代码、translate=no 和隐藏祖先内的文本');
      check(!fixture.querySelector('img') && [...fixture.querySelectorAll('[data-pagelingo="translation"]')].some(node => node.textContent.includes('<img src=x')), '模型返回的 HTML 字符串安全显示为文本');
      check(completion.cachedCount > 0, '缓存命中计数正确显示在页面状态中');

      message('PAGELINGO_MODE', { mode: 'translated' });
      check(linkText.nodeValue === translate('the original link') && link === $('inline-link') && href === link.getAttribute('href') && !fixture.querySelector('[data-pagelingo="translation"]'), '仅译文模式保留可点击链接，移除双语插入节点');
      message('PAGELINGO_MODE', { mode: 'bilingual' });
      check(originals.every(item => item.node.nodeValue === item.value), '切回双语后原始文本准确恢复');

      const dynamicText = 'Dynamically loaded paragraphs should be translated exactly once.';
      const dynamic = document.createElement('p');
      dynamic.textContent = dynamicText;
      fixture.append(dynamic);
      await until(() => calls.some(call => call.items.some(item => item.text === dynamicText)), 'MutationObserver 收集动态内容');
      await until(() => message('PAGELINGO_STATUS').status.state === 'complete' && message('PAGELINGO_STATUS').status.completed > completion.completed, '动态翻译完成');
      await delay(380);
      check(calls.flatMap(call => call.items).filter(item => item.text === dynamicText).length === 1 && dynamic.querySelector('[data-pagelingo="translation"]'), '原生 MutationObserver 翻译新增段落一次，忽略自身生成的译文');
      dynamic.remove();

      message('PAGELINGO_RESTORE');
      check(fixture.textContent === originalText && originals.every(item => item.node.nodeValue === item.value) && !document.querySelector('[data-pagelingo]'), '一键还原精确恢复原始页面，并移除译文与工具栏');
      const oldCalls = calls.length;
      message('PAGELINGO_START', { settings: { ...config, displayMode: 'translated' } });
      await until(() => calls.length > oldCalls, '启动待取消请求');
      message('PAGELINGO_RESTORE');
      await until(() => active === 0, '等待被取消会话的迟到响应');
      await delay(350);
      check(fixture.textContent === originalText && !document.querySelector('[data-pagelingo]') && message('PAGELINGO_STATUS').status.state === 'idle', '取消后迟到响应无法覆盖原文或重新插入译文');
      check(uncaughtErrors.length === 0, '无未捕获的浏览器脚本错误');
      const count = controls.results.querySelectorAll('.pass').length;
      controls.summary.textContent = `${count} / ${count} 项通过`;
      controls.summary.className = 'pass';
      controls.metrics.textContent = `初次翻译：${completion.total} 段 · 首批响应约 ${Math.round(firstResult)} ms（模拟延迟） · 峰值并发 ${maximumActive} · 请求 ${calls.length} 次\n真实 DOM + checkVisibility + MutationObserver · 模拟 API，无网络调用`;
      document.documentElement.dataset.testResult = 'pass';
    } catch (error) {
      const count = controls.results.querySelectorAll('.pass').length;
      controls.summary.textContent = `失败 · 已通过 ${count} 项`;
      controls.summary.className = 'fail';
      controls.errors.textContent = `${error.stack || error}\n${uncaughtErrors.join('\n')}`;
      document.documentElement.dataset.testResult = 'fail';
      try { message('PAGELINGO_RESTORE'); } catch { /* Keep original failure visible. */ }
    } finally {
      controls.run.disabled = false;
      runningTest = false;
    }
  }
  window.addEventListener('error', event => { uncaughtErrors.push(event.message); });
  window.addEventListener('unhandledrejection', event => { uncaughtErrors.push(String(event.reason?.message || event.reason)); });
  controls.run.addEventListener('click', run);
})();
