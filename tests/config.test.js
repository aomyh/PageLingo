import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings, normalizeSettings, isProviderReady, validateEndpoint } from '../lib/config.js';

test('provider settings are independent and readiness requires model plus credentials', () => {
  const settings = defaultSettings();
  assert.equal(isProviderReady(settings), false);
  settings.providers.deepseek.apiKey = 'dummy-local-test-key';
  assert.equal(isProviderReady(settings), true);
  settings.activeProvider = 'openai';
  assert.equal(isProviderReady(settings), false);
  assert.equal(settings.providers.openai.apiKey, '');
  settings.activeProvider = 'ollama';
  assert.equal(isProviderReady(settings), true);
  settings.providers.ollama.model = '';
  assert.equal(isProviderReady(settings), false);
});

test('untrusted or stale settings cannot bypass concurrency, batch or enum boundaries', () => {
  const settings = normalizeSettings({ activeProvider: 'unknown', targetLanguage: 'made-up', displayMode: 'html', concurrency: 999, batchSize: -1,
    providers: { deepseek: { apiKey: '  test  ', baseUrl: 'https://api.deepseek.com/v1/', model: ' model-id ' } } });
  assert.equal(settings.activeProvider, 'deepseek'); assert.equal(settings.targetLanguage, 'zh-CN');
  assert.equal(settings.displayMode, 'bilingual'); assert.equal(settings.concurrency, 8); assert.equal(settings.batchSize, 500);
  assert.equal(settings.providers.deepseek.apiKey, 'test'); assert.equal(settings.providers.deepseek.model, 'model-id');
  assert.equal(settings.providers.deepseek.baseUrl, 'https://api.deepseek.com/v1');
  assert.equal(normalizeSettings({ concurrency: 'invalid' }).concurrency, 4);
});

test('configuration endpoint validation agrees with optional permissions', () => {
  for (const url of ['http://remote.example/v1', 'https://user:pass@example.com/v1', 'https://example.com/v1?key=x', 'https://example.com/v1#key', 'http://[::1]:11434/v1', 'javascript:alert(1)']) assert.throws(() => validateEndpoint(url));
  assert.equal(validateEndpoint('http://localhost:11434/v1').hostname, 'localhost');
  assert.equal(validateEndpoint('http://127.0.0.1:11434/v1').hostname, '127.0.0.1');
  assert.equal(validateEndpoint('https://api.example.com/v1').protocol, 'https:');
});
