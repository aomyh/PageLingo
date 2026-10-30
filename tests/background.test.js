import test from 'node:test';
import assert from 'node:assert/strict';

let listener;
let permission = true;
let openedOptions = false;
let storageProtection;
let settings = { activeProvider: 'custom', concurrency: 2, cacheEnabled: false, providers: { custom: { apiKey: 'private-key-do-not-expose', model: 'test-model', baseUrl: 'https://api.example.com/v1' } } };
globalThis.chrome = {
  runtime: {
    id: 'extension-id', getURL: path => `chrome-extension://extension-id/${path}`,
    onMessage: { addListener: fn => { listener = fn; } },
    onInstalled: { addListener: () => {} }, openOptionsPage: () => { openedOptions = true; },
  },
  storage: { local: {
    get: async key => ({ [key]: settings }),
    setAccessLevel: async options => { storageProtection = options; },
  } },
  permissions: { contains: async () => permission },
  tabs: { onRemoved: { addListener: () => {} } },
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
