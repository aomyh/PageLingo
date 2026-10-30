import test from 'node:test';
import assert from 'node:assert/strict';
import { responseUsage, requestTranslations, translateBatch } from '../lib/translator.js';
import { clearTranslationCache } from '../lib/cache.js';

const provider = { id: 'custom', protocol: 'openai' };
const config = { apiKey: 'secret-key', model: 'usage-model', baseUrl: 'https://example.com/v1' };
const items = [{ id: 'one', text: 'Hello 😀' }];
const usage = { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25, prompt_tokens_details: { cached_tokens: 10 } };
function response(options, extra = {}) {
  const input = JSON.parse(JSON.parse(options.body).messages[1].content);
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(input.map(item => ({ id: item.id, text: '你好' }))) } }], usage, ...extra }));
}

test('native token adapters retain cached input and reasoning without double counting', () => {
  assert.deepEqual(responseUsage(provider, { usage }), { inputTokens: 20, outputTokens: 5, totalTokens: 25, cachedInputTokens: 10 });
  assert.deepEqual(responseUsage(provider, { usage: { prompt_tokens: 20, completion_tokens: 5, prompt_cache_hit_tokens: 12 } }), { inputTokens: 20, outputTokens: 5, totalTokens: 25, cachedInputTokens: 12 });
  assert.deepEqual(responseUsage({ protocol: 'anthropic' }, { usage: { input_tokens: 10, cache_creation_input_tokens: 30, cache_read_input_tokens: 50, output_tokens: 5 } }), { inputTokens: 90, outputTokens: 5, totalTokens: 95, cachedInputTokens: 50 });
  assert.deepEqual(responseUsage({ protocol: 'gemini' }, { usageMetadata: { promptTokenCount: 30, toolUsePromptTokenCount: 2, cachedContentTokenCount: 20, candidatesTokenCount: 10, thoughtsTokenCount: 5, totalTokenCount: 47 } }), { inputTokens: 32, outputTokens: 15, totalTokens: 47, cachedInputTokens: 20 });
  assert.deepEqual(responseUsage({ protocol: 'gemini' }, { usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 10, thoughtsTokenCount: 5 } }), { inputTokens: 30, outputTokens: 15, totalTokens: 45, cachedInputTokens: 0 });
});

test('missing or malformed usage stays unknown, while reported zero remains known', () => {
  for (const data of [null, {}, { usage: {} }, { usage: { prompt_tokens: '100', completion_tokens: -1, total_tokens: Infinity } }]) assert.equal(responseUsage(provider, data), null);
  assert.deepEqual(responseUsage(provider, { usage: { total_tokens: 0 } }), { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0 });
});

test('request events contain only counters and model identity; retries are separate attempts', async () => {
  const events = [];
  let calls = 0;
  await requestTranslations(provider, config, 'zh-CN', items, {
    kind: 'selection', onUsage: event => events.push(event),
    fetchImpl: async (_url, options) => ++calls === 1 ? new Response('', { status: 429, headers: { 'retry-after': '0' } }) : response(options),
  });
  assert.equal(events.length, 2);
  assert.deepEqual(events.map(event => [event.status, event.retry, event.kind]), [['failed', false, 'selection'], ['success', true, 'selection']]);
  assert.equal(events[0].tokens, null);
  assert.equal(events[1].tokens.totalTokens, 25);
  assert.ok(events.every(event => Number.isFinite(event.durationMs) && event.durationMs >= 0));
  for (const secret of [config.apiKey, config.baseUrl, items[0].text, '你好']) assert.equal(JSON.stringify(events).includes(secret), false);
});

test('invalid model output still records its reported billable usage', async () => {
  const events = [];
  await assert.rejects(requestTranslations(provider, config, 'zh-CN', items, {
    onUsage: event => events.push(event), fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: 'invalid' } }], usage })),
  }), error => error.code === 'INVALID_OUTPUT');
  assert.equal(events.length, 1);
  assert.equal(events[0].status, 'failed');
  assert.equal(events[0].tokens.totalTokens, 25);
});

test('aborted and timed out attempts are distinguished and pre-network validation is not counted', async () => {
  const events = [];
  const controller = new AbortController();
  const blocking = async (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
  const task = requestTranslations(provider, config, 'zh-CN', items, { signal: controller.signal, onUsage: event => events.push(event), fetchImpl: blocking });
  controller.abort();
  await assert.rejects(task, error => error.code === 'ABORTED');
  await assert.rejects(requestTranslations(provider, config, 'zh-CN', items, { timeout: 5, onUsage: event => events.push(event), fetchImpl: blocking }), error => error.code === 'TIMEOUT');
  await assert.rejects(requestTranslations(provider, config, 'zh-CN', items, { signal: controller.signal, onUsage: event => events.push(event), fetchImpl: blocking }));
  await assert.rejects(requestTranslations(provider, config, 'zh-CN', [], { onUsage: event => events.push(event), fetchImpl: blocking }));
  assert.deepEqual(events.map(event => event.status), ['cancelled', 'failed']);
});

test('cache hits and shared in-flight work do not duplicate token usage; Unicode characters count once', async () => {
  await clearTranslationCache();
  const events = [];
  let calls = 0;
  const options = { scope: 'usage-shared', onUsage: event => events.push(event), fetchImpl: async (_url, request) => {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 5));
    return response(request);
  } };
  await Promise.all([translateBatch(provider, config, 'zh-CN', items, options), translateBatch(provider, config, 'zh-CN', [{ ...items[0], id: 'two' }], options)]);
  await translateBatch(provider, config, 'zh-CN', items, options);
  assert.equal(calls, 1);
  const requests = events.filter(event => event.type === 'request');
  const translations = events.filter(event => event.type === 'translation');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].tokens.totalTokens, 25);
  assert.equal(translations.length, 3);
  assert.equal(translations.reduce((sum, event) => sum + event.cacheHits, 0), 1);
  assert.ok(translations.every(event => event.translatedCharacters === 7 && event.translatedItems === 1));
});

test('statistics writes never block or break the translation result', async () => {
  for (const onUsage of [() => { throw new Error('disk full'); }, () => Promise.reject(new Error('disk full')), () => new Promise(() => {})]) {
    const result = await translateBatch(provider, config, 'zh-CN', items, { scope: `independent-${Math.random()}`, cacheEnabled: false, onUsage, fetchImpl: async (_url, options) => response(options) });
    assert.equal(result.translations[0].text, '你好');
  }
});
