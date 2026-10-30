import test from 'node:test';
import assert from 'node:assert/strict';

let listener;
let permission = true;
let openedOptions = false;
let storageProtection;
let changedListener, removedListener, startupListener;
let registeredScripts = [];
const selectionMessages = [];
const selectionInjections = [];
let settings = { activeProvider: 'custom', concurrency: 2, cacheEnabled: false, providers: { custom: { apiKey: 'private-key-do-not-expose', model: 'test-model', baseUrl: 'https://api.example.com/v1' } } };
globalThis.chrome = {
  runtime: {
    id: 'extension-id', getURL: path => `chrome-extension://extension-id/${path}`,
    onMessage: { addListener: fn => { listener = fn; } },
    onInstalled: { addListener: () => {} }, openOptionsPage: () => { openedOptions = true; },
    onStartup: { addListener: fn => { startupListener = fn; } },
  },
  storage: { local: {
    get: async key => ({ [key]: settings }),
    set: async values => {
      const [key, value] = Object.entries(values)[0];
      const previous = settings;
      settings = value;
      queueMicrotask(() => changedListener?.({ [key]: { oldValue: previous, newValue: value } }, 'local'));
    },
    setAccessLevel: async options => { storageProtection = options; },
  }, onChanged: { addListener: fn => { changedListener = fn; } } },
  permissions: { contains: async () => permission, onRemoved: { addListener: fn => { removedListener = fn; } } },
  tabs: { onRemoved: { addListener: () => {} }, query: async () => [{ id: 7, url: 'https://news.example.com/article' }], sendMessage: async (id, value) => { selectionMessages.push({ id, value }); return { ok: true }; } },
  scripting: {
    getRegisteredContentScripts: async () => registeredScripts,
    registerContentScripts: async scripts => { registeredScripts = scripts; },
    unregisterContentScripts: async () => { registeredScripts = []; },
    executeScript: async value => { selectionInjections.push(value); },
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
function translationResponse(options, text = '你好') {
  const items = JSON.parse(JSON.parse(options.body).messages[1].content);
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(items.map(item => ({ id: item.id, text }))) } }] }));
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
