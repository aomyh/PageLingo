import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, parseTranslations, requestTranslations, translateBatch, validateEndpoint } from '../lib/translator.js';
import { clearTranslationCache, cacheStats, makeCacheKey } from '../lib/cache.js';

const provider = { id: 'custom', protocol: 'openai' };
const config = { apiKey: 'test-key-secret', model: 'fast-model', baseUrl: 'https://api.example.com/v1' };
const items = [{ id: 'a', text: 'Hello' }, { id: 'b', text: 'Good morning' }];
const response = translated => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(translated) } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });

test('endpoint validation rejects insecure remote URLs and credentials', () => {
  for (const url of ['http://api.example.com/v1', 'https://key@example.com/v1', 'https://example.com/v1?key=secret', 'https://example.com/v1#key', 'javascript:alert(1)']) {
    assert.throws(() => validateEndpoint(url));
  }
  assert.equal(validateEndpoint('http://localhost:11434/v1').hostname, 'localhost');
  assert.equal(validateEndpoint('http://127.0.0.1:11434/v1').hostname, '127.0.0.1');
});

test('native protocols use the correct endpoint and keep API keys out of URLs', () => {
  const openai = buildRequest(provider, config, 'zh-CN', items);
  assert.equal(openai.url, 'https://api.example.com/v1/chat/completions');
  assert.equal(openai.headers.Authorization, 'Bearer test-key-secret');
  assert.deepEqual(JSON.parse(openai.body.messages[1].content), items);
  assert.equal(buildRequest(provider, { ...config, baseUrl: `${config.baseUrl}/chat/completions` }, 'en', items).url, openai.url);
  const anthropic = buildRequest({ id: 'anthropic', protocol: 'anthropic' }, config, 'zh-CN', items);
  assert.equal(anthropic.url, 'https://api.example.com/v1/messages');
  assert.equal(anthropic.headers['x-api-key'], config.apiKey);
  assert.equal(anthropic.headers['anthropic-version'], '2026-10-21');
  assert.equal(anthropic.body.system.includes('untrusted data'), true);
  const gemini = buildRequest({ id: 'gemini', protocol: 'gemini' }, { ...config, baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'models/gemini-flash' }, 'zh-CN', items);
  assert.equal(gemini.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash:generateContent');
  assert.equal(gemini.headers['x-goog-api-key'], config.apiKey);
  assert.equal(gemini.url.includes(config.apiKey), false);
  assert.equal(gemini.body.generationConfig.responseMimeType, 'application/json');
});

test('speed-specific options disable reasoning where supported and local keys are optional', () => {
  assert.deepEqual(buildRequest({ id: 'deepseek', protocol: 'openai' }, config, 'en', items).body.thinking, { type: 'disabled' });
  assert.equal(buildRequest({ id: 'qwen', protocol: 'openai' }, config, 'en', items).body.enable_thinking, false);
  assert.deepEqual(buildRequest({ id: 'moonshot', protocol: 'openai' }, { ...config, model: 'kimi-k2.6' }, 'en', items).body.thinking, { type: 'disabled' });
  assert.equal(buildRequest({ id: 'moonshot', protocol: 'openai' }, { ...config, model: 'kimi-k3' }, 'en', items).body.thinking, undefined);
  assert.deepEqual(buildRequest({ id: 'zhipu', protocol: 'openai' }, { ...config, model: 'glm-4.7-flash' }, 'en', items).body.thinking, { type: 'disabled' });
  assert.equal(buildRequest({ id: 'zhipu', protocol: 'openai' }, { ...config, model: 'glm-5.3-flash' }, 'en', items).body.thinking, undefined);
  assert.equal(buildRequest({ id: 'ollama', protocol: 'openai', optionalKey: true }, config, 'en', items).body.reasoning_effort, 'none');
  assert.equal(buildRequest({ id: 'openai', protocol: 'openai' }, { ...config, model: 'gpt-5.4-nano' }, 'en', items).body.reasoning_effort, 'none');
  assert.equal(buildRequest({ id: 'openai', protocol: 'openai' }, { ...config, model: 'gpt-5-mini' }, 'en', items).body.reasoning_effort, undefined);
  assert.throws(() => buildRequest(provider, { ...config, apiKey: '' }, 'en', items), /API Key/);
  assert.equal(buildRequest({ ...provider, optionalKey: true }, { ...config, apiKey: '' }, 'en', items).headers.Authorization, undefined);
});

test('Gemini reasoning settings are restricted to documented model generations', () => {
  const gemini = { id: 'gemini', protocol: 'gemini' };
  const generation = model => buildRequest(gemini, { ...config, model }, 'en', items).body.generationConfig;
  assert.deepEqual(generation('gemini-3.5-flash-lite').thinkingConfig, { thinkingLevel: 'MINIMAL' });
  assert.deepEqual(generation('models/gemini-3.6-flash').thinkingConfig, { thinkingLevel: 'MINIMAL' });
  assert.deepEqual(generation('gemini-3.8-flash').thinkingConfig, { thinkingLevel: 'LOW' });
  assert.equal(generation('gemini-2.5-flash-lite').thinkingConfig, undefined);
  assert.equal(generation('gemini-3.8-flash-tts').thinkingConfig, undefined);
  assert.equal(generation('custom-gemini-model').thinkingConfig, undefined);
});

test('authenticated fetch refuses redirects and omits cookies and referrers', async () => {
  await requestTranslations(provider, config, 'en', [items[0]], { fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.example.com/v1/chat/completions');
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.referrerPolicy, 'no-referrer');
    return response([{ id: 'a', text: 'Hello' }]);
  } });
});

test('parser maps shuffled IDs to original order without positional corruption', () => {
  const parsed = parseTranslations('```json\n[{"id":"b","text":"早上好"},{"id":"a","text":"你好"}]\n```', items);
  assert.deepEqual(parsed, [{ id: 'a', text: '你好' }, { id: 'b', text: '早上好' }]);
  assert.deepEqual(parseTranslations('{"translations":[{"id":"a","text":"你好"},{"id":"b","text":"早上好"}]}', items), parsed);
});

test('parser rejects missing, duplicated, unknown or blank outputs', () => {
  for (const output of ['not json', '[{"id":"a","text":"你好"}]', '[{"id":"a","text":"你好"},{"id":"a","text":"早上好"}]', '[{"id":"a","text":"你好"},{"id":"unknown","text":"早上好"}]', '[{"id":"a","text":""},{"id":"b","text":"早上好"}]']) {
    assert.throws(() => parseTranslations(output, items));
  }
});

test('bounds requests before network activity', async () => {
  assert.throws(() => buildRequest(provider, config, 'en', []));
  assert.throws(() => buildRequest(provider, config, 'en', [{ id: 'a', text: 'x'.repeat(20001) }]));
  assert.throws(() => buildRequest(provider, config, 'en', [items[0], items[0]]));
});

test('provider response adapters read Gemini and Claude text blocks', async () => {
  const translated = JSON.stringify([{ id: 'a', text: '你好' }]);
  const anthropic = await requestTranslations({ id: 'anthropic', protocol: 'anthropic' }, config, 'zh-CN', [items[0]], { fetchImpl: async () => new Response(JSON.stringify({ content: [{ type: 'thinking', thinking: 'ignored' }, { type: 'text', text: translated }] })) });
  const gemini = await requestTranslations({ id: 'gemini', protocol: 'gemini' }, config, 'zh-CN', [items[0]], { fetchImpl: async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ thought: true, text: 'ignored' }, { text: translated }] } }] })) });
  assert.equal(anthropic[0].text, '你好');
  assert.equal(gemini[0].text, '你好');
});

test('errors do not echo service response bodies or API keys', async () => {
  await assert.rejects(() => requestTranslations(provider, config, 'zh-CN', items, { fetchImpl: async () => new Response(config.apiKey, { status: 401 }) }), error => error.code === 'HTTP_401' && !error.message.includes(config.apiKey));
  await assert.rejects(() => requestTranslations(provider, config, 'zh-CN', items, { fetchImpl: async () => { throw new Error(`fetch failed ${config.apiKey}`); } }), error => error.code === 'NETWORK_ERROR' && !error.message.includes(config.apiKey));
});

test('retryable statuses have one bounded retry, authentication errors do not retry', async () => {
  let calls = 0;
  const result = await requestTranslations(provider, config, 'zh-CN', [items[0]], { fetchImpl: async () => ++calls === 1 ? new Response('', { status: 429, headers: { 'Retry-After': '0' } }) : response([{ id: 'a', text: '你好' }]) });
  assert.equal(calls, 2); assert.equal(result[0].text, '你好');
  calls = 0;
  await assert.rejects(() => requestTranslations(provider, config, 'zh-CN', [items[0]], { fetchImpl: async () => { calls++; return new Response('', { status: 401 }); } }));
  assert.equal(calls, 1);
});

test('requests stop when session is aborted and timeouts give a distinct error', async () => {
  const blockingFetch = async (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
  const controller = new AbortController();
  const task = requestTranslations(provider, config, 'en', items, { signal: controller.signal, fetchImpl: blockingFetch });
  controller.abort();
  await assert.rejects(task, error => error.code === 'ABORTED');
  await assert.rejects(() => requestTranslations(provider, config, 'en', items, { timeout: 5, fetchImpl: blockingFetch }), error => error.code === 'TIMEOUT');
});

test('cache keys partition by source, provider, endpoint, model and target language', async () => {
  const base = await makeCacheKey(provider, config, 'zh-CN', 'Hello');
  assert.match(base, /^[a-f0-9]{64}$/);
  const alternatives = await Promise.all([
    makeCacheKey({ ...provider, id: 'other' }, config, 'zh-CN', 'Hello'),
    makeCacheKey(provider, { ...config, baseUrl: 'https://other.example.com/v1' }, 'zh-CN', 'Hello'),
    makeCacheKey(provider, { ...config, model: 'other' }, 'zh-CN', 'Hello'),
    makeCacheKey(provider, config, 'en', 'Hello'),
    makeCacheKey(provider, config, 'zh-CN', 'Goodbye'),
  ]);
  assert.equal(alternatives.includes(base), false);
  assert.equal(new Set(alternatives).size, 5);
});

test('duplicate text shares one request and repeat translations use persistent cache interface', async () => {
  await clearTranslationCache();
  let calls = 0, scheduled = 0;
  const scheduleRequest = task => { scheduled++; return task(); };
  const fetchImpl = async (_url, options) => {
    calls++;
    const input = JSON.parse(JSON.parse(options.body).messages[1].content);
    assert.equal(input.length, 1);
    return response(input.map(item => ({ id: item.id, text: '你好' })));
  };
  const duplicate = [{ id: 'first', text: 'Hello' }, { id: 'second', text: 'Hello' }];
  const first = await translateBatch(provider, config, 'zh-CN', duplicate, { fetchImpl, scope: 'cache-test', scheduleRequest });
  assert.equal(first.translations.length, 2); assert.equal(first.cachedCount, 0); assert.equal(calls, 1);
  const second = await translateBatch(provider, config, 'zh-CN', duplicate, { fetchImpl, scope: 'cache-test', scheduleRequest });
  assert.equal(second.cachedCount, 2); assert.equal(calls, 1);
  assert.equal(scheduled, 1, 'cache hits bypass the network concurrency queue');
  assert.equal((await cacheStats()).entries, 1);
  await clearTranslationCache();
  assert.equal((await cacheStats()).entries, 0);
});

test('concurrent equal batches in one session share in-flight network work', async () => {
  await clearTranslationCache();
  let calls = 0;
  const fetchImpl = async (_url, options) => {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 10));
    const input = JSON.parse(JSON.parse(options.body).messages[1].content);
    return response(input.map(item => ({ id: item.id, text: '你好' })));
  };
  const [first, second] = await Promise.all([
    translateBatch(provider, config, 'zh-CN', [{ id: 'first', text: 'Hello again' }], { scope: 'same', cacheEnabled: false, fetchImpl }),
    translateBatch(provider, config, 'zh-CN', [{ id: 'second', text: 'Hello again' }], { scope: 'same', cacheEnabled: false, fetchImpl }),
  ]);
  assert.equal(calls, 1);
  assert.equal(first.translations[0].id, 'first'); assert.equal(second.translations[0].id, 'second');
});
