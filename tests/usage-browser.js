(() => {
  'use strict';
  // The same-origin fixture shell lets document.write retain a real #usage URL.
  // It exits before creating another runner or executing any production module.
  if (new URLSearchParams(location.search).has('fixture')) return;
  const $ = id => document.getElementById(id);
  const root = new URL('../', location.href);
  const frame = $('usage-frame');
  const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  let running = false;
  let results = [];

  function counters(multiplier = 1) {
    return {
      requests: 12 * multiplier, successfulRequests: 10 * multiplier,
      failedRequests: multiplier, cancelledRequests: multiplier, retries: 2 * multiplier,
      inputTokens: 1200 * multiplier, outputTokens: 800 * multiplier, totalTokens: 2000 * multiplier,
      cachedInputTokens: 200 * multiplier, requestsWithUsage: 10 * multiplier,
      requestsWithoutUsage: 2 * multiplier, translatedCharacters: 6000 * multiplier,
      translatedItems: 24 * multiplier, cacheHits: 6 * multiplier, totalItems: 30 * multiplier,
      durationMs: 6000 * multiplier, averageLatencyMs: multiplier ? 500 : 0,
      cacheHitRate: multiplier ? 20 : 0,
    };
  }
  function response(period, multiplier) {
    const summary = counters(multiplier);
    const count = { today: 1, '7d': 7, '30d': 30, all: 90 }[period];
    const days = Array.from({ length: count }, (_, index) => {
      const day = new Date(Date.UTC(2026, 9, 30 - count + index + 1));
      const requests = Math.floor(summary.requests / count) + (index < summary.requests % count ? 1 : 0);
      return { date: day.toISOString().slice(0, 10), requests };
    });
    const first = { ...counters(multiplier), providerId: 'deepseek', model: 'MOCK-deepseek-flash', requests: 8 * multiplier, successfulRequests: 7 * multiplier, failedRequests: multiplier, cancelledRequests: 0, retries: multiplier, durationMs: 4000 * multiplier, requestsWithUsage: 7 * multiplier, requestsWithoutUsage: multiplier, totalTokens: 1500 * multiplier, inputTokens: 900 * multiplier, outputTokens: 600 * multiplier, cachedInputTokens: 150 * multiplier, translatedCharacters: 4000 * multiplier, translatedItems: 16 * multiplier, totalItems: 20 * multiplier, cacheHits: 4 * multiplier };
    const second = { ...counters(multiplier), providerId: 'openai', model: 'MOCK-gpt-nano', requests: 4 * multiplier, successfulRequests: 3 * multiplier, failedRequests: 0, cancelledRequests: multiplier, retries: multiplier, durationMs: 2000 * multiplier, requestsWithUsage: 3 * multiplier, requestsWithoutUsage: multiplier, totalTokens: 500 * multiplier, inputTokens: 300 * multiplier, outputTokens: 200 * multiplier, cachedInputTokens: 50 * multiplier, translatedCharacters: 2000 * multiplier, translatedItems: 8 * multiplier, totalItems: 10 * multiplier, cacheHits: 2 * multiplier };
    return { ok: true, period, summary, days, breakdown: multiplier ? [first, second] : [], timezone: 'Asia/Shanghai', retentionDays: 90, startedAt: multiplier ? '2026-07-01T00:00:00.000Z' : null, updatedAt: multiplier ? '2026-10-30T03:00:00.000Z' : null };
  }
  function fixtures(multiplier = null) {
    return Object.fromEntries(Object.entries({ today: 1, '7d': 3, '30d': 8, all: 24 }).map(([period, value]) => [period, response(period, multiplier ?? value)]));
  }
  function installChromeMock(initialResponses, emptyResponses) {
    // document.open() can reset a child document's URL to the caller's URL.
    // Restore the options deep link before its module reads location.hash.
    history.replaceState(null, '', new URL('options.html#usage', document.baseURI).href);
    const settingsKey = 'pagelingo.settings.v1', usageKey = 'pagelingo.usage.v1';
    const listeners = [];
    let responses = structuredClone(initialResponses);
    let settings = {
      activeProvider: 'deepseek', targetLanguage: 'zh-CN', displayMode: 'bilingual', concurrency: 4,
      batchSize: 2200, cacheEnabled: true, translateDynamic: true, selectionEnabled: false,
      providers: { deepseek: { apiKey: 'MOCK_KEY_NOT_REAL_USAGE_TEST', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com/v1' } },
    };
    const mock = window.__usageMock = {
      calls: [], errors: [], writes: [], readError: '', clearError: '', holdClear: false,
      releaseClear: null, cache: { entries: 77, bytes: 2048 },
      settings: () => structuredClone(settings),
      setResponse(period, value, emit = false) { responses[period] = structuredClone(value); if (emit) this.emitUsage(); },
      emitUsage() { for (const listener of listeners) listener({ [usageKey]: { oldValue: { mock: true }, newValue: { mock: true, changedAt: Date.now() } } }, 'local'); },
    };
    window.addEventListener('error', event => mock.errors.push(event.message));
    window.addEventListener('unhandledrejection', event => mock.errors.push(String(event.reason?.message || event.reason)));
    // Runtime messages are the only simulated backend. Never forward any request.
    window.chrome = {
      runtime: {
        id: 'pagelingo-usage-browser-test',
        getURL: path => new URL(path, document.baseURI).href,
        getManifest: () => ({ optional_host_permissions: ['http://*/*', 'https://*/*'] }),
        async sendMessage(message) {
          mock.calls.push(structuredClone(message));
          if (message.type === 'GET_USAGE_STATS') {
            if (mock.readError) return { ok: false, error: mock.readError };
            return structuredClone(responses[message.period]);
          }
          if (message.type === 'CLEAR_USAGE_STATS') {
            if (mock.clearError) return { ok: false, error: mock.clearError };
            if (mock.holdClear) await new Promise(resolve => { mock.releaseClear = resolve; });
            responses = structuredClone(emptyResponses);
            mock.emitUsage();
            return { ok: true };
          }
          if (message.type === 'CACHE_STATS') return { ok: true, ...mock.cache };
          if (message.type === 'CLEAR_CACHE') { mock.cache = { entries: 0, bytes: 0 }; return { ok: true }; }
          throw new Error(`测试禁止的运行时消息：${message.type}`);
        },
      },
      storage: {
        local: {
          async get() { return { [settingsKey]: structuredClone(settings) }; },
          async set(patch) { mock.writes.push(structuredClone(patch)); if (patch[settingsKey]) settings = structuredClone(patch[settingsKey]); },
        },
        onChanged: { addListener: listener => listeners.push(listener) },
      },
      permissions: { request: async () => { throw new Error('用量面板不应申请网页或 AI 服务权限'); } },
    };
  }
  async function until(predicate, description) {
    const start = performance.now();
    while (performance.now() - start < 6000) { if (predicate()) return; await wait(16); }
    throw new Error(`等待超时：${description}`);
  }
  function check(condition, label) {
    const result = { pass: Boolean(condition), label };
    results.push(result);
    const item = document.createElement('li');
    item.className = result.pass ? 'pass' : 'fail'; item.textContent = `${result.pass ? 'PASS' : 'FAIL'} · ${label}`;
    $('results').append(item);
  }
  async function loadOptions() {
    const query = `usage-run=${Date.now()}`;
    const markup = await fetch(new URL(`options.html?${query}`, root), { cache: 'no-store', signal: AbortSignal.timeout(6000) }).then(result => { if (!result.ok) throw new Error(`options.html HTTP ${result.status}`); return result.text(); });
    const doc = new DOMParser().parseFromString(markup, 'text/html');
    doc.querySelector('script[src="options.js"]').remove();
    const base = doc.createElement('base'); base.href = root.href; doc.head.prepend(base);
    doc.querySelector('link[rel="stylesheet"]').href = new URL(`options.css?${query}`, root).href;
    const install = doc.createElement('script');
    install.textContent = `(${installChromeMock.toString()})(${JSON.stringify(fixtures())},${JSON.stringify(fixtures(0))});`;
    doc.head.append(install);
    const module = doc.createElement('script'); module.type = 'module'; module.src = new URL(`options.js?${query}`, root).href; doc.head.append(module);
    await new Promise((resolve, reject) => {
      const loaded = () => { clearTimeout(timeout); resolve(); };
      const timeout = setTimeout(() => { frame.removeEventListener('load', loaded); reject(new Error('等待超时：同源 fixture 导航完成')); }, 6000);
      frame.addEventListener('load', loaded, { once: true });
      frame.src = new URL(`tests/usage-browser.html?fixture=1&${query}#usage`, root).href;
    });
    frame.contentDocument.open(); frame.contentDocument.write('<!doctype html>' + doc.documentElement.outerHTML); frame.contentDocument.close();
    await until(() => frame.contentWindow.__usageMock && frame.contentDocument.getElementById('usage-requests')?.textContent === '12' && frame.contentDocument.getElementById('usage-content')?.getAttribute('aria-busy') === 'false', '正式用量页面初始化');
    await until(() => !frame.contentDocument.fonts || frame.contentDocument.fonts.status === 'loaded', '正式用量页面字体加载');
  }
  async function run() {
    if (running) return;
    running = true; results = []; $('run').disabled = true; $('summary').textContent = '正在运行…';
    $('results').replaceChildren(); $('error').textContent = ''; $('metrics').textContent = '';
    delete window.__usageBrowserResults; document.documentElement.dataset.testResult = 'running';
    try {
      await loadOptions();
      const doc = frame.contentDocument, child = frame.contentWindow, mock = child.__usageMock;
      const el = id => doc.getElementById(id), text = id => el(id).textContent;
      const number = value => value.toLocaleString('zh-CN');
      const reads = () => mock.calls.filter(call => call.type === 'GET_USAGE_STATS').length;
      const clears = () => mock.calls.filter(call => call.type === 'CLEAR_USAGE_STATS').length;
      const settled = () => el('usage-content').getAttribute('aria-busy') === 'false';
      const baselineSettings = JSON.stringify(mock.settings());
      check(!el('view-usage').hidden && child.location.hash === '#usage' && doc.querySelector('[data-view="usage"]').getAttribute('aria-current') === 'page', '初始 #usage 深链接显示正式用量面板与导航状态');
      check(text('usage-requests') === '12' && text('usage-characters') === '6,000' && text('usage-tokens') === '2,000', '今日请求、成功翻译字符与已报告 Token 使用可信模拟响应');
      check(text('usage-request-detail').includes('成功 10') && text('usage-request-detail').includes('失败 1') && text('usage-request-detail').includes('取消 1') && text('usage-cache-rate') === '20%' && text('usage-latency') === '0.5 秒', '状态、缓存命中率与平均耗时计算正确');
      check(el('usage-breakdown').rows.length === 2 && text('usage-breakdown').includes('DeepSeek') && text('usage-breakdown').includes('MOCK-deepseek-flash') && text('usage-breakdown').includes('OpenAI') && text('usage-breakdown').includes('MOCK-gpt-nano'), '服务商与模型明细来自模拟分组数据');
      check(text('usage-token-note').includes('2 次请求未返回 Token') && el('usage-token-note').classList.contains('incomplete') && text('usage-updated').includes('Asia/Shanghai') && !text('usage-updated').includes('1970'), '缺失 Token、统计时区与 ISO 更新时间明确显示');
      for (const [period, multiplier, bars] of [['7d', 3, 7], ['30d', 8, 30], ['all', 24, 30]]) {
        doc.querySelector(`[data-usage-period="${period}"]`).click();
        await until(() => settled() && text('usage-requests') === number(12 * multiplier), `切换${period}`);
        const active = [...doc.querySelectorAll('[data-usage-period]')].filter(button => button.getAttribute('aria-pressed') === 'true');
        check(mock.calls.filter(call => call.type === 'GET_USAGE_STATS').at(-1).period === period && active.length === 1 && active[0].dataset.usagePeriod === period && text('usage-tokens') === number(2000 * multiplier) && el('usage-chart').children.length === bars, `${period} 时段请求、选中状态、Token 与趋势天数正确`);
      }
      check(text('usage-chart-caption').includes('累计汇总') && el('usage-breakdown').rows.length === 2, '累计指标与最近 30 天趋势及模型明细同时显示');

      const missing = response('all', 0);
      Object.assign(missing.summary, { requests: 3, successfulRequests: 3, requestsWithUsage: 0, requestsWithoutUsage: 3, durationMs: 300, averageLatencyMs: 100 });
      missing.days.at(-1).requests = 3;
      missing.breakdown = [{ providerId: 'deepseek', model: 'MOCK-no-token-usage', ...missing.summary }];
      mock.setResponse('all', missing); el('refresh-usage').click();
      await until(() => settled() && text('usage-requests') === '3', '未返回 Token 的响应');
      check(text('usage-tokens') === '—' && text('usage-token-detail').includes('尚未返回') && text('usage-token-note').includes('3 次请求未返回 Token') && el('usage-breakdown').rows[0].cells[3].firstChild.textContent === '—', '服务商未返回 usage 时总览和模型行显示未知，不伪造零用量');

      const beforeStorageRead = reads();
      mock.setResponse('all', response('all', 25), true);
      await until(() => text('usage-requests') === '300', 'storage 变化刷新统计');
      check(reads() > beforeStorageRead && text('usage-tokens') === '50,000', '打开用量面板时 storage 更新自动读取新统计');
      mock.readError = '模拟：统计读取失败'; el('refresh-usage').click();
      await until(() => settled() && el('usage-status').classList.contains('error'), '刷新错误');
      check(!el('usage-content').hidden && text('usage-requests') === '300' && text('usage-status').includes('上一次成功读取'), '刷新失败保留上次成功数据并显示可恢复错误');
      mock.readError = ''; mock.setResponse('all', response('all', 24)); el('refresh-usage').click();
      await until(() => settled() && el('usage-status').hidden && text('usage-requests') === '288', '刷新错误恢复');
      check(!el('refresh-usage').disabled && !el('usage-status').classList.contains('error'), '再次刷新成功后移除错误并恢复操作');

      doc.querySelector('[data-view="providers"]').click();
      await until(() => el('view-usage').hidden && child.location.hash === '#providers', '切换服务商视图');
      const hiddenReads = reads(); mock.emitUsage(); await wait(250);
      check(reads() === hiddenReads && el('api-key').value === 'MOCK_KEY_NOT_REAL_USAGE_TEST', '离开用量视图后 storage 事件不读取统计，Key 配置保持原值');
      doc.querySelector('[data-view="usage"]').click();
      await until(() => !el('view-usage').hidden && settled() && reads() > hiddenReads, '返回用量视图');
      check(child.location.hash === '#usage' && doc.querySelector('[data-view="usage"]').getAttribute('aria-current') === 'page', '返回用量页更新 hash、导航与统计');
      mock.setResponse('all', response('all', 0), true);
      await until(() => text('usage-requests') === '0', '空统计');
      check(text('usage-characters') === '0' && text('usage-tokens') === '0' && text('usage-cache-rate') === '—' && text('usage-success-rate') === '—' && text('usage-latency') === '—' && !el('usage-chart-empty').hidden && !el('usage-breakdown-empty').hidden && el('usage-breakdown').rows.length === 0, '空统计展示零计数、未知比率和趋势/模型空态');

      mock.setResponse('all', response('all', 24)); el('refresh-usage').click();
      await until(() => settled() && text('usage-requests') === '288', '准备清空测试');
      const beforeClear = clears(); el('reset-usage').click();
      check(!el('usage-reset-confirm').hidden && clears() === beforeClear && text('usage-requests') === '288', '清空第一步只展示确认，不删除任何统计');
      el('cancel-reset-usage').click();
      check(el('usage-reset-confirm').hidden && clears() === beforeClear && text('usage-requests') === '288', '取消清空保留数据且不会发送删除请求');
      el('reset-usage').click(); mock.clearError = '模拟：清空失败'; el('confirm-reset-usage').click();
      await until(() => !el('confirm-reset-usage').disabled && text('usage-status').includes('模拟：清空失败'), '清空失败');
      check(text('usage-requests') === '288' && !el('usage-reset-confirm').hidden && !el('cancel-reset-usage').disabled, '清空失败保留统计并允许再次确认或取消');
      mock.clearError = ''; mock.holdClear = true; el('confirm-reset-usage').click();
      await until(() => typeof mock.releaseClear === 'function', '等待清空响应');
      check(el('confirm-reset-usage').disabled && el('cancel-reset-usage').disabled && el('refresh-usage').disabled && [...doc.querySelectorAll('[data-usage-period]')].every(button => button.disabled), '清空进行时锁定确认、刷新与时段按钮，避免重复提交');
      mock.holdClear = false; mock.releaseClear();
      await until(() => text('usage-requests') === '0' && el('usage-reset-confirm').hidden && !el('confirm-reset-usage').disabled && settled(), '清空后重新读取');
      check(clears() === beforeClear + 2 && text('usage-tokens') === '0' && el('usage-breakdown').rows.length === 0 && !el('refresh-usage').disabled, '第二步确认清空后重新读取当前时段空统计并恢复操作');
      check(JSON.stringify(mock.settings()) === baselineSettings && mock.writes.length === 0 && mock.cache.entries === 77 && !mock.calls.some(call => call.type === 'CLEAR_CACHE' || call.type === 'TEST_CONNECTION') && el('api-key').value === 'MOCK_KEY_NOT_REAL_USAGE_TEST', '全过程不修改配置与 Key、不清翻译缓存、不请求真实 AI');
      check(mock.errors.length === 0, '生产模块运行期间没有浏览器错误或未处理 Promise 拒绝');
      $('metrics').textContent = `全部为模拟数据\n统计读取：${reads()} 次\n清空消息：${clears()} 次（含 1 次模拟失败）\n配置写入：${mock.writes.length} 次\n缓存保留：${mock.cache.entries} 段\n浏览器错误：${mock.errors.length} 条`;
      if (mock.errors.length) $('error').textContent = mock.errors.join('\n');
    } catch (error) { check(false, '运行器完成全部集成场景'); $('error').textContent = error.stack || error.message; }
    finally {
      const pass = results.filter(result => result.pass).length, total = results.length;
      $('summary').textContent = `${pass} / ${total} 项通过`;
      document.documentElement.dataset.testResult = pass === total ? 'pass' : 'fail';
      window.__usageBrowserResults = { pass, total, results, error: $('error').textContent };
      running = false; $('run').disabled = false;
    }
  }
  $('run').addEventListener('click', run);
})();
