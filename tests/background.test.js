import test from 'node:test';
import assert from 'node:assert/strict';

let listener;
let permission = true;
let openedOptions = false;
let storageProtection;
let changedListener, removedListener, startupListener;
let tabRemovedListener, tabUpdatedListener;
let registeredScripts = [];
const selectionMessages = [];
const selectionInjections = [];
const createdWindows = [], updatedWindows = [], activatedTabs = [];
const tabPages = new Map([[7, { id: 7, url: 'https://news.example.com/article' }]]);
let panelInjectionError = false;
let settings = { activeProvider: 'custom', concurrency: 2, cacheEnabled: false, providers: { custom: { apiKey: 'private-key-do-not-expose', model: 'test-model', baseUrl: 'https://api.example.com/v1' } } };
const settingsKey = 'pagelingo.settings.v1';
const stored = {};
const sessionStored = {};
globalThis.chrome = {
  runtime: {
    id: 'extension-id', getURL: path => `chrome-extension://extension-id/${path}`,
    onMessage: { addListener: fn => { listener = fn; } },
    onInstalled: { addListener: () => {} }, openOptionsPage: () => { openedOptions = true; },
    onStartup: { addListener: fn => { startupListener = fn; } },
  },
  storage: { local: {
    get: async key => ({ [key]: key === settingsKey ? settings : structuredClone(stored[key]) }),
    set: async values => {
      const changes = {};
      for (const [key, value] of Object.entries(values)) {
        const previous = key === settingsKey ? settings : stored[key];
        if (key === settingsKey) settings = value;
        else stored[key] = structuredClone(value);
        changes[key] = { oldValue: previous, newValue: value };
      }
      queueMicrotask(() => changedListener?.(changes, 'local'));
    },
    setAccessLevel: async options => { storageProtection = options; },
  }, session: {
    get: async key => ({ [key]: sessionStored[key] }),
    set: async values => { Object.assign(sessionStored, values); },
  }, onChanged: { addListener: fn => { changedListener = fn; } } },
  permissions: { contains: async () => permission, onRemoved: { addListener: fn => { removedListener = fn; } } },
  tabs: { onRemoved: { addListener: fn => { tabRemovedListener = fn; } }, onUpdated: { addListener: fn => { tabUpdatedListener = fn; } }, get: async id => { if (!tabPages.has(id)) throw new Error('No such tab'); return tabPages.get(id); }, query: async () => [{ id: 7, url: 'https://news.example.com/article' }], sendMessage: async (id, value) => { selectionMessages.push({ id, value }); return { ok: true }; }, update: async (id, options) => { activatedTabs.push({ id, options }); return { id }; } },
  windows: {
    create: async options => { createdWindows.push(options); throw new Error('Manual entry must never open a window'); },
    update: async (id, options) => { updatedWindows.push({ id, options }); return { id }; },
  },
  scripting: {
    getRegisteredContentScripts: async () => registeredScripts,
    registerContentScripts: async scripts => { registeredScripts = scripts; },
    unregisterContentScripts: async () => { registeredScripts = []; },
    executeScript: async value => { if (panelInjectionError && value.files?.includes('manual-panel.js')) throw new Error('Blocked by browser; private error body'); selectionInjections.push(value); },
  },
};
await import('../background.js');

const ui = { id: 'extension-id', url: 'chrome-extension://extension-id/options.html' };
const content = { id: 'extension-id', url: 'https://news.example.com/article', tab: { id: 7, url: 'https://news.example.com/article' } };
const message = (request, sender = ui) => new Promise(resolve => {
  const asyncReply = listener(request, sender, resolve);
  assert.equal(asyncReply, true, 'the service worker must preserve its async reply channel');
});
const batch = (sessionId, text = 'Hello') => ({ type: 'TRANSLATE_BATCH', sessionId, items: [{ id: 'a', text }] });
const manual = (requestId, text = 'Manual input', extra = {}) => ({ type: 'TRANSLATE_TEXT', requestId, text, ...extra });
const translatorUI = { id: 'extension-id', url: 'chrome-extension://extension-id/translate.html', documentId: 'manual-document-1', tab: { id: 22, url: 'chrome-extension://extension-id/translate.html' } };
async function until(predicate) {
  const started = Date.now();
  while (!predicate()) {
    assert.ok(Date.now() - started < 2000, 'background test condition must settle');
    await new Promise(resolve => setImmediate(resolve));
  }
}
function translationResponse(options, text = '你好', usage) {
  const items = JSON.parse(JSON.parse(options.body).messages[1].content);
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(items.map(item => ({ id: item.id, text }))) } }], usage }));
}

test('keys are restricted to trusted extension storage contexts', () => {
  assert.deepEqual(storageProtection, { accessLevel: 'TRUSTED_CONTEXTS' });
  assert.equal(openedOptions, false);
});

test('public configuration includes only nonsecret translation preferences', async () => {
  const result = await message({ type: 'GET_PUBLIC_SETTINGS' }, content);
  assert.equal(result.ok, true); assert.equal(result.settings.ready, true);
  assert.equal(result.settings.model, 'test-model');
  assert.equal(JSON.stringify(result).includes('private-key'), false);
  assert.equal('providers' in result.settings, false);
});

test('other extensions and ordinary origins cannot impersonate trusted UI', async () => {
  const other = await message({ type: 'GET_PUBLIC_SETTINGS' }, { ...ui, id: 'other-extension' });
  assert.equal(other.ok, false);
  const ordinary = await message({ type: 'CLEAR_CACHE' }, { id: 'extension-id', url: 'https://example.com/' });
  assert.equal(ordinary.ok, false);
  const page = await message({ type: 'CLEAR_CACHE' }, content);
  assert.equal(page.ok, false);
  const keyProbe = await message({ type: 'TEST_CONNECTION', providerId: 'custom', config: settings.providers.custom }, content);
  assert.equal(keyProbe.ok, false);
});

test('missing service host permission stops a translation before any fetch', async () => {
  permission = false;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('must not fetch'); };
  const result = await message(batch('no-permission'), content);
  assert.equal(result.ok, false); assert.equal(result.code, 'NO_PERMISSION'); assert.equal(calls, 0);
  permission = true;
});

test('connection tests use requested language and sample but never return API keys', async () => {
  let body;
  globalThis.fetch = async (_url, options) => { body = JSON.parse(options.body); return translationResponse(options, 'Bonjour'); };
  const result = await message({ type: 'TEST_CONNECTION', providerId: 'custom', config: settings.providers.custom, targetLanguage: 'fr', text: 'Stay curious.' });
  assert.equal(result.ok, true); assert.equal(result.preview, 'Bonjour');
  assert.equal(typeof result.latency, 'number');
  assert.equal(body.messages[0].content.includes('to fr.'), true);
  assert.equal(JSON.parse(body.messages[1].content)[0].text, 'Stay curious.');
  assert.equal(JSON.stringify(result).includes('private-key'), false);
  const badLanguage = await message({ type: 'TEST_CONNECTION', providerId: 'custom', config: settings.providers.custom, targetLanguage: 'anything' });
  assert.equal(badLanguage.ok, false);
});

test('worker translates content messages and enforces a shared concurrency limit', async () => {
  let active = 0, peak = 0, calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls++; active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 15));
    active--;
    return translationResponse(options);
  };
  const results = await Promise.all([0, 1, 2, 3].map(index => message(batch(`parallel-${index}`, `Hello ${index}`), content)));
  assert.equal(calls, 4); assert.equal(peak, 2);
  assert.equal(results.every(result => result.ok && result.translations[0].text === '你好'), true);
  assert.equal(results.every(result => result.translations[0].id === 'a'), true);
});

test('session cancellation aborts network work and rejects late batches', async () => {
  let started;
  const fetchStarted = new Promise(resolve => { started = resolve; });
  globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
    started();
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  });
  const active = message(batch('cancel-test', 'Cancellation sample'), content);
  await fetchStarted;
  const cancelled = await message({ type: 'CANCEL_TRANSLATION', sessionId: 'cancel-test' }, content);
  assert.equal(cancelled.ok, true);
  const result = await active;
  assert.equal(result.ok, false); assert.equal(result.code, 'ABORTED');
  const late = await message(batch('cancel-test', 'Late sample'), content);
  assert.equal(late.ok, false); assert.equal(late.code, 'ABORTED');
});

test('cache administration is available to extension UI', async () => {
  const stats = await message({ type: 'CACHE_STATS' });
  assert.equal(stats.ok, true); assert.equal(typeof stats.entries, 'number'); assert.equal(typeof stats.bytes, 'number');
  assert.deepEqual(await message({ type: 'CLEAR_CACHE' }), { ok: true });
});

test('selection toggle is trusted-UI-only and enabling without optional grants cannot persist', async () => {
  const blocked = await message({ type: 'SET_SELECTION_ENABLED', enabled: true }, content);
  assert.equal(blocked.ok, false);
  permission = false;
  const denied = await message({ type: 'SET_SELECTION_ENABLED', enabled: true });
  assert.equal(denied.ok, false);
  assert.notEqual(settings.selectionEnabled, true);
  permission = true;
  const invalid = await message({ type: 'SET_SELECTION_ENABLED', enabled: 'true' });
  assert.equal(invalid.ok, false);
});

test('selection requests are gated off, bounded and cached through the shared translation engine', async () => {
  let calls = 0;
  globalThis.fetch = async (_url, options) => { calls++; return translationResponse(options, '选中文本的译文'); };
  const request = { type: 'TRANSLATE_SELECTION', sessionId: 'selection-first', text: 'Selected source text' };
  const disabled = await message(request, content);
  assert.equal(disabled.ok, false); assert.equal(disabled.code, 'SELECTION_DISABLED'); assert.equal(calls, 0);
  const enable = await message({ type: 'SET_SELECTION_ENABLED', enabled: true });
  assert.equal(enable.ok, true); assert.equal(enable.settings.selectionEnabled, true);
  assert.equal(settings.selectionEnabled, true); assert.equal(registeredScripts[0].id, 'pagelingo-selection');
  assert.equal(selectionInjections.some(value => value.target.tabId === 7), true);
  assert.equal(JSON.stringify(enable).includes('private-key'), false);
  for (const text of ['', '  ', 'x'.repeat(5001)]) {
    const invalid = await message({ ...request, text }, content);
    assert.equal(invalid.ok, false); assert.equal(invalid.code, 'INVALID_SELECTION');
  }
  const uiRequest = await message(request);
  assert.equal(uiRequest.ok, false);
  settings.cacheEnabled = true;
  const first = await message(request, content);
  assert.equal(first.ok, true); assert.equal(first.text, '选中文本的译文'); assert.equal(first.cached, false);
  const second = await message({ ...request, sessionId: 'selection-repeat' }, content);
  assert.equal(second.ok, true); assert.equal(second.cached, true); assert.equal(calls, 1);
  settings.cacheEnabled = false;
});

test('quick disable aborts active selection work without interrupting a page translation', async () => {
  let finishPage, pageSignal, pageStarted, selectionStarted;
  const firstStarted = new Promise(resolve => { pageStarted = resolve; });
  const secondStarted = new Promise(resolve => { selectionStarted = resolve; });
  globalThis.fetch = async (_url, options) => {
    const items = JSON.parse(JSON.parse(options.body).messages[1].content);
    if (items[0].text === 'Page translation stays active') {
      pageSignal = options.signal;
      pageStarted();
      return new Promise(resolve => { finishPage = () => resolve(translationResponse(options, '页面译文')); });
    }
    selectionStarted();
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
  };
  const page = message(batch('page-with-selection', 'Page translation stays active'), content);
  const selectionRequest = { type: 'TRANSLATE_SELECTION', sessionId: 'selection-disable-active', text: 'Selection is cancelled' };
  const selection = message(selectionRequest, content);
  await Promise.all([firstStarted, secondStarted]);
  const off = await message({ type: 'SET_SELECTION_ENABLED', enabled: false });
  assert.equal(off.ok, true); assert.equal(off.settings.selectionEnabled, false);
  assert.equal(pageSignal.aborted, false, 'page translation uses a separate cancellation scope');
  assert.equal(registeredScripts.length, 0);
  assert.equal(selectionMessages.at(-1).value.settings.selectionEnabled, false);
  const cancelled = await selection;
  assert.equal(cancelled.ok, false); assert.ok(['ABORTED', 'SELECTION_DISABLED'].includes(cancelled.code));
  finishPage();
  assert.equal((await page).ok, true);
  const late = await message(selectionRequest, content);
  assert.equal(late.ok, false);
  const newWhileOff = await message({ ...selectionRequest, sessionId: 'selection-new-disabled' }, content);
  assert.equal(newWhileOff.code, 'SELECTION_DISABLED');
});

test('startup restores enabled registration and removed webpage permission turns the feature off', async () => {
  await message({ type: 'SET_SELECTION_ENABLED', enabled: true });
  registeredScripts = [];
  startupListener();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(registeredScripts[0].id, 'pagelingo-selection');
  permission = false;
  removedListener({ origins: ['https://*/*'] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settings.selectionEnabled, false);
  assert.equal(registeredScripts.length, 0);
  assert.equal(selectionMessages.at(-1).value.settings.selectionEnabled, false);
  permission = true;
});

test('usage administration is restricted to extension UI and validates time ranges', async () => {
  for (const type of ['GET_USAGE_STATS', 'CLEAR_USAGE_STATS']) {
    assert.equal((await message({ type }, content)).ok, false);
    assert.equal((await message({ type }, { ...ui, id: 'other-extension' })).ok, false);
  }
  assert.equal((await message({ type: 'GET_USAGE_STATS', period: 'invalid' })).ok, false);
  assert.deepEqual(await message({ type: 'CLEAR_USAGE_STATS' }), { ok: true });
  const result = await message({ type: 'GET_USAGE_STATS' });
  assert.equal(result.ok, true);
  assert.equal(result.summary.requests, 0);
  assert.equal(result.period, 'today');
});

test('worker records paid usage once, cache deliveries separately, and test traffic without source text', async () => {
  await message({ type: 'CLEAR_USAGE_STATS' });
  await message({ type: 'CLEAR_CACHE' });
  await message({ type: 'SET_SELECTION_ENABLED', enabled: true });
  settings.cacheEnabled = true;
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls++;
    return translationResponse(options, '译文', { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_tokens_details: { cached_tokens: 50 } });
  };
  const source = 'Confidential text 😀';
  assert.equal((await message(batch('usage-page', source), content)).ok, true);
  assert.equal((await message({ type: 'TRANSLATE_SELECTION', sessionId: 'usage-selection', text: source }, content)).cached, true);
  assert.equal((await message({ type: 'TEST_CONNECTION', providerId: 'custom', config: settings.providers.custom })).ok, true);
  assert.equal(calls, 2);
  const result = await message({ type: 'GET_USAGE_STATS', period: 'all' });
  assert.equal(result.summary.requests, 2);
  assert.equal(result.summary.totalTokens, 240);
  assert.equal(result.summary.cachedInputTokens, 100);
  assert.equal(result.summary.translatedCharacters, [...source].length * 2);
  assert.equal(result.summary.totalItems, 2);
  assert.equal(result.summary.cacheHits, 1);
  assert.equal(result.summary.cacheHitRate, 50);
  assert.equal(result.kinds.test.requests, 1);
  assert.equal(result.kinds.test.translatedCharacters, 0);
  assert.equal(result.kinds.selection.cacheHits, 1);
  const serialized = JSON.stringify(stored['pagelingo.usage.v1']);
  for (const secret of [source, 'private-key-do-not-expose', 'https://api.example.com', '译文']) assert.equal(serialized.includes(secret), false);
  const before = await message({ type: 'CACHE_STATS' });
  await message({ type: 'CLEAR_USAGE_STATS' });
  assert.equal((await message({ type: 'GET_USAGE_STATS', period: 'all' })).summary.totalTokens, 0);
  assert.equal((await message({ type: 'CACHE_STATS' })).entries, before.entries);
  assert.equal(settings.providers.custom.apiKey, 'private-key-do-not-expose');
  settings.cacheEnabled = false;
});

test('manual entry injects an in-page panel, coalesces clicks and never creates or activates a browser window/tab', async () => {
  assert.equal((await message({ type: 'OPEN_TEXT_TRANSLATOR', tabId: 7 }, content)).ok, false);
  const count = () => selectionInjections.filter(value => value.files?.includes('manual-panel.js')).length;
  const before = count();
  const results = await Promise.all(Array.from({ length: 3 }, () => message({ type: 'OPEN_TEXT_TRANSLATOR', tabId: 7 })));
  assert.ok(results.every(result => result.ok && result.tabId === 7 && result.mode === 'in-page'));
  assert.equal(count(), before + 1);
  assert.deepEqual(selectionInjections.at(-1), { target: { tabId: 7 }, files: ['lib/themes.js', 'manual-panel.js'] });
  assert.deepEqual(await message({ type: 'OPEN_TEXT_TRANSLATOR', tabId: 7 }), { ok: true, tabId: 7, mode: 'in-page' });
  assert.equal(count(), before + 2, 'reinjection asks the isolated script to focus its existing panel');
  assert.equal(createdWindows.length, 0);
  assert.equal(updatedWindows.length, 0);
  assert.equal(activatedTabs.length, 0);
  assert.deepEqual(sessionStored, {}, 'no window session ID is created');
});

test('restricted pages and injection failures report an error without falling back to a new tab', async () => {
  for (const tabId of [undefined, null, -1, '7', 88]) assert.equal((await message({ type: 'OPEN_TEXT_TRANSLATOR', tabId })).code, 'UNSUPPORTED_PAGE');
  for (const url of ['chrome://settings/', 'chrome-extension://extension-id/options.html', 'https://chromewebstore.google.com/detail/test', 'https://chrome.google.com/webstore/detail/test', 'file:///private/example.html']) {
    tabPages.set(8, { id: 8, url });
    assert.equal((await message({ type: 'OPEN_TEXT_TRANSLATOR', tabId: 8 })).code, 'UNSUPPORTED_PAGE');
  }
  panelInjectionError = true;
  const failed = await message({ type: 'OPEN_TEXT_TRANSLATOR', tabId: 7 });
  assert.equal(failed.code, 'PANEL_UNAVAILABLE');
  assert.equal(failed.error.includes('private error body'), false);
  panelInjectionError = false;
  assert.equal((await message({ type: 'OPEN_TEXT_TRANSLATOR', tabId: 7 })).ok, true, 'a failed injection remains retryable');
  assert.equal(createdWindows.length, 0);
});

test('manual settings expose public data and an opaque changing revision to content scripts', async () => {
  const first = await message({ type: 'GET_MANUAL_SETTINGS' }, content);
  assert.equal(first.ok, true);
  assert.equal(first.settings.providerName, '自定义服务');
  assert.equal(first.settings.ready, true);
  assert.equal(typeof first.configurationRevision, 'string');
  assert.equal('providers' in first.settings, false);
  for (const secret of ['private-key-do-not-expose', 'https://api.example.com', 'apiKey', 'baseUrl']) assert.equal(JSON.stringify(first).includes(secret), false);
  changedListener({ [settingsKey]: { oldValue: settings, newValue: { ...settings, selectionEnabled: !settings.selectionEnabled } } }, 'local');
  assert.equal((await message({ type: 'GET_MANUAL_SETTINGS' }, content)).configurationRevision, first.configurationRevision, 'selection preferences cannot invalidate a manual translation');
  const previous = structuredClone(settings), updated = structuredClone(settings);
  updated.providers.custom.apiKey = 'revision-test-fake-key';
  await chrome.storage.local.set({ [settingsKey]: updated });
  const second = await message({ type: 'GET_MANUAL_SETTINGS' }, content);
  assert.notEqual(second.configurationRevision, first.configurationRevision);
  assert.equal(JSON.stringify(second).includes('revision-test-fake-key'), false);
  await chrome.storage.local.set({ [settingsKey]: previous });
  const foreign = { ...content, id: 'other-extension' };
  assert.equal((await message({ type: 'GET_MANUAL_SETTINGS' }, foreign)).ok, false);
  assert.equal((await message({ type: 'MANUAL_OPEN_OPTIONS' }, foreign)).ok, false);
  assert.deepEqual(await message({ type: 'MANUAL_OPEN_OPTIONS' }, content), { ok: true });
  assert.equal(openedOptions, true);
});

test('theme changes broadcast only public colors and preserve a manual revision and active request', { timeout: 5000 }, async () => {
  const previous = structuredClone(settings);
  const theme = previous.theme === 'midnight' ? 'ocean' : 'midnight';
  const first = await message({ type: 'GET_MANUAL_SETTINGS' }, content);
  let calls = 0, signal, finish;
  globalThis.fetch = async (_url, options) => {
    calls++; signal = options.signal;
    return new Promise((resolve, reject) => {
      finish = () => resolve(translationResponse(options, '切换主题后仍正常完成'));
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
  };
  const task = message(manual('theme-preserves-manual', 'Pending manual source across theme changes'), content);
  try {
    await until(() => Boolean(finish));
    const before = selectionMessages.length;
    await chrome.storage.local.set({ [settingsKey]: { ...previous, theme } });
    await until(() => selectionMessages.slice(before).some(entry => entry.value.type === 'PAGELINGO_THEME_CHANGED' && entry.value.theme === theme));
    await until(() => selectionMessages.slice(before).some(entry => entry.value.type === 'PAGELINGO_SELECTION_SETTINGS' && entry.value.settings.theme === theme));
    const broadcasts = selectionMessages.slice(before);
    const themeMessages = broadcasts.filter(entry => entry.value.type === 'PAGELINGO_THEME_CHANGED');
    assert.deepEqual(themeMessages, [{ id: 7, value: { type: 'PAGELINGO_THEME_CHANGED', theme } }]);
    for (const secret of [previous.providers.custom.apiKey, 'apiKey', 'providers', 'baseUrl', 'https://api.example.com', 'Pending manual source']) {
      assert.equal(JSON.stringify(broadcasts).includes(secret), false, `${secret} cannot enter a webpage broadcast`);
    }
    const current = await message({ type: 'GET_MANUAL_SETTINGS' }, content);
    assert.equal(current.settings.theme, theme);
    assert.equal(current.configurationRevision, first.configurationRevision, 'palette preferences cannot invalidate a manual result');
    assert.equal(signal.aborted, false, 'a theme storage event does not cancel the current fetch');
    assert.equal(calls, 1, 'a theme update cannot start a replacement AI request');
    assert.equal((await message(manual('theme-preserves-manual', 'Duplicate must not fetch'), content)).code, 'REQUEST_IN_PROGRESS');
    finish();
    const result = await task;
    assert.equal(result.ok, true);
    assert.equal(result.text, '切换主题后仍正常完成');
    assert.equal(calls, 1);
    assert.equal((await message({ type: 'GET_MANUAL_SETTINGS' }, content)).configurationRevision, first.configurationRevision);
  } finally {
    if (finish) finish();
    else await message({ type: 'CANCEL_TEXT_TRANSLATION', requestId: 'theme-preserves-manual' }, content);
    await task;
    await chrome.storage.local.set({ [settingsKey]: previous });
  }
});

test('manual input accepts isolated content scripts, validates Unicode limits and reads only saved config', async () => {
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.example.com/v1/chat/completions');
    return translationResponse(options, '手动译文');
  };
  const foreign = { ...content, id: 'other-extension' };
  assert.equal((await message(manual('content-denied'), foreign)).ok, false);
  assert.equal((await message({ type: 'CANCEL_TEXT_TRANSLATION', requestId: 'denied' }, foreign)).ok, false);
  for (const request of [manual(''), manual('bad id'), manual('empty', ''), manual('spaces', '  '), manual('object', {}), manual('long', '😀'.repeat(5001)), manual('language', 'Hello', { targetLanguage: 'anything' })]) assert.equal((await message(request, translatorUI)).ok, false);
  assert.equal(calls, 0);
  const result = await message(manual('unicode-boundary', '😀'.repeat(5000), { targetLanguage: 'fr', providerId: 'other', config: { apiKey: 'attacker', baseUrl: 'https://elsewhere.invalid' } }), translatorUI);
  assert.deepEqual(result, { ok: true, text: '手动译文', cached: false, providerId: 'custom', model: 'test-model', targetLanguage: 'fr' });
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(result).includes('private-key'), false);
  assert.equal((await message(manual('in-page-manual', 'Entered in floating panel'), content)).ok, true);
});

test('manual translation needs only the selected API host, works with selection off, and shares cache and usage', async () => {
  await message({ type: 'SET_SELECTION_ENABLED', enabled: false });
  await message({ type: 'CLEAR_USAGE_STATS' });
  await message({ type: 'CLEAR_CACHE' });
  settings.cacheEnabled = true;
  const originalContains = chrome.permissions.contains;
  const grants = [];
  chrome.permissions.contains = async value => { grants.push(value); return value.origins.length === 1 && value.origins[0] === 'https://api.example.com/*'; };
  let calls = 0;
  globalThis.fetch = async (_url, options) => { calls++; return translationResponse(options, '手动翻译结果', { prompt_tokens: 80, completion_tokens: 20, total_tokens: 100 }); };
  try {
    const source = 'Manual fallback text 😀';
    const first = await message(manual('manual-cache-first', source), translatorUI);
    const second = await message(manual('manual-cache-second', source), translatorUI);
    assert.equal(first.ok, true); assert.equal(first.cached, false);
    assert.equal(second.ok, true); assert.equal(second.cached, true);
    assert.equal((await message(batch('manual-shared-page', source), content)).cachedCount, 1);
    assert.equal(calls, 1);
    assert.ok(grants.every(value => value.origins.length === 1 && value.origins[0] === 'https://api.example.com/*'));
    const stats = await message({ type: 'GET_USAGE_STATS', period: 'all' });
    assert.equal(stats.summary.requests, 1);
    assert.equal(stats.kinds.manual.requests, 1);
    assert.equal(stats.kinds.manual.totalTokens, 100);
    assert.equal(stats.kinds.manual.translatedCharacters, [...source].length * 2);
    assert.equal(stats.kinds.manual.cacheHits, 1);
    assert.equal(stats.kinds.page.cacheHits, 1);
    assert.equal(stats.kinds.selection.requests, 0);
    assert.equal(JSON.stringify(stored['pagelingo.usage.v1']).includes(source), false);
  } finally { chrome.permissions.contains = originalContains; settings.cacheEnabled = false; }
});

test('manual validation stops missing credentials or API grants before fetch and failed calls remain retryable', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('credential must not escape', { status: 401 }); };
  const apiKey = settings.providers.custom.apiKey;
  settings.providers.custom.apiKey = '';
  assert.equal((await message(manual('missing-manual-key'), translatorUI)).code, 'MISSING_KEY');
  settings.providers.custom.apiKey = apiKey;
  permission = false;
  assert.equal((await message(manual('missing-manual-grant'), translatorUI)).code, 'NO_PERMISSION');
  permission = true;
  assert.equal(calls, 0);
  const failed = await message(manual('retryable-manual'), translatorUI);
  assert.equal(failed.code, 'HTTP_401');
  assert.equal(JSON.stringify(failed).includes('credential'), false);
  globalThis.fetch = async (_url, options) => { calls++; return translationResponse(options, '恢复'); };
  assert.equal((await message(manual('retryable-manual'), translatorUI)).ok, true);
  assert.equal(calls, 2);
});

test('manual cancellation and duplicate protection are scoped to their originating extension document', async () => {
  const previousConcurrency = settings.concurrency;
  settings.concurrency = 3;
  const signals = new Map(), finishes = new Map();
  globalThis.fetch = async (_url, options) => {
    const text = JSON.parse(JSON.parse(options.body).messages[1].content)[0].text;
    signals.set(text, options.signal);
    return new Promise((resolve, reject) => {
      finishes.set(text, () => resolve(translationResponse(options, `译文 ${text}`)));
      options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
  };
  const secondUI = { ...translatorUI, documentId: 'manual-document-2', tab: { ...translatorUI.tab, id: 23 } };
  const first = message(manual('same-id', 'Manual first'), translatorUI);
  const second = message(manual('same-id', 'Manual second'), secondUI);
  const page = message(batch('manual-isolation-page', 'Page independent'), content);
  try {
    await until(() => signals.size === 3);
    assert.equal((await message(manual('same-id', 'Duplicate should not fetch'), translatorUI)).code, 'REQUEST_IN_PROGRESS');
    await message({ type: 'SET_SELECTION_ENABLED', enabled: false });
    assert.ok([...signals.values()].every(signal => !signal.aborted));
    await message({ type: 'CANCEL_TEXT_TRANSLATION', requestId: 'same-id' }, translatorUI);
    assert.equal((await first).code, 'ABORTED');
    assert.equal(signals.get('Manual second').aborted, false);
    assert.equal(signals.get('Page independent').aborted, false);
    finishes.get('Manual second')(); finishes.get('Page independent')();
    assert.equal((await second).ok, true); assert.equal((await page).ok, true);
    assert.equal((await message(manual('same-id', 'Late first'), translatorUI)).code, 'ABORTED');
  } finally { settings.concurrency = previousConcurrency; }
});

test('cancelling manual input while its permission check is pending prevents any network activity', async () => {
  const originalContains = chrome.permissions.contains;
  let releasePermission, calls = 0;
  chrome.permissions.contains = async () => new Promise(resolve => { releasePermission = resolve; });
  globalThis.fetch = async (_url, options) => { calls++; return translationResponse(options); };
  const task = message(manual('cancel-during-grant'), translatorUI);
  try {
    await until(() => Boolean(releasePermission));
    assert.deepEqual(await message({ type: 'CANCEL_TEXT_TRANSLATION', requestId: 'cancel-during-grant' }, translatorUI), { ok: true });
    releasePermission(true);
    assert.equal((await task).code, 'ABORTED');
    assert.equal(calls, 0);
    await message({ type: 'CANCEL_TEXT_TRANSLATION', requestId: 'cancel-before-start' }, translatorUI);
    assert.equal((await message(manual('cancel-before-start'), translatorUI)).code, 'ABORTED');
  } finally { chrome.permissions.contains = originalContains; }
});

test('in-page manual requests stay isolated by document and cancellation survives same-page URL changes', async () => {
  const firstDocument = { ...content, documentId: 'floating-document-1' };
  const otherDocument = { ...content, documentId: 'floating-document-2', tab: { ...content.tab, id: 23 } };
  let started;
  const networkStarted = new Promise(resolve => { started = resolve; });
  globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
    started();
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  });
  const task = message(manual('route-cancel', 'Floating panel source'), firstDocument);
  await networkStarted;
  await message({ type: 'CANCEL_TEXT_TRANSLATION', requestId: 'route-cancel' }, otherDocument);
  assert.equal((await message(manual('route-cancel', 'Duplicate'), firstDocument)).code, 'REQUEST_IN_PROGRESS');
  const changedRoute = { ...firstDocument, url: 'https://news.example.com/another-route', tab: { ...firstDocument.tab, url: 'https://news.example.com/another-route' } };
  await message({ type: 'CANCEL_TEXT_TRANSLATION', requestId: 'route-cancel' }, changedRoute);
  assert.equal((await task).code, 'ABORTED');
});

test('closing the manual owner tab cancels its active request without pagehide or cancelling another page', async () => {
  const signals = new Map(), finishes = new Map();
  globalThis.fetch = async (_url, options) => {
    const text = JSON.parse(JSON.parse(options.body).messages[1].content)[0].text;
    signals.set(text, options.signal);
    return new Promise((resolve, reject) => {
      finishes.set(text, () => resolve(translationResponse(options)));
      options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
  };
  const manualTask = message(manual('closed-window', 'Manual close'), translatorUI);
  const pageTask = message(batch('manual-window-independent-page', 'Page continues'), content);
  await until(() => signals.size === 2);
  tabRemovedListener(translatorUI.tab.id);
  assert.equal((await manualTask).code, 'ABORTED');
  assert.equal(signals.get('Page continues').aborted, false);
  finishes.get('Page continues')();
  assert.equal((await pageTask).ok, true);
});

test('full page navigation cancels destroyed-panel requests while same-page route changes keep them active', async () => {
  let started, signal;
  const networkStarted = new Promise(resolve => { started = resolve; });
  globalThis.fetch = async (_url, options) => {
    signal = options.signal;
    return new Promise((_resolve, reject) => {
      started();
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
  };
  const task = message(manual('panel-navigation', 'Floating panel before navigation'), { ...content, documentId: 'navigating-manual-document' });
  await networkStarted;
  tabUpdatedListener(23, { status: 'loading' });
  tabUpdatedListener(content.tab.id, { url: 'https://news.example.com/spa-route' });
  assert.equal(signal.aborted, false);
  tabUpdatedListener(content.tab.id, { status: 'loading' });
  assert.equal((await task).code, 'ABORTED');
});

test('queued manual work shares the page concurrency limit and cancellation does not consume a network slot', async () => {
  const previousConcurrency = settings.concurrency;
  settings.concurrency = 1;
  let calls = 0, releasePage;
  globalThis.fetch = async (_url, options) => {
    calls++;
    if (calls === 1) return new Promise(resolve => { releasePage = () => resolve(translationResponse(options)); });
    return translationResponse(options);
  };
  const pageTask = message(batch('manual-queue-page', 'Page fills the network slot'), content);
  try {
    await until(() => Boolean(releasePage));
    const queued = message(manual('queued-manual', 'Queued manual text'), translatorUI);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(calls, 1);
    await message({ type: 'CANCEL_TEXT_TRANSLATION', requestId: 'queued-manual' }, translatorUI);
    assert.equal((await queued).code, 'ABORTED');
    releasePage();
    assert.equal((await pageTask).ok, true);
    assert.equal((await message(manual('manual-after-queued-cancel'), translatorUI)).ok, true);
    assert.equal(calls, 2);
  } finally { settings.concurrency = previousConcurrency; }
});
