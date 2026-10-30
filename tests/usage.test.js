import test from 'node:test';
import assert from 'node:assert/strict';
import { createUsageStore, USAGE_STORAGE_KEY } from '../lib/usage.js';

function storage(initial) {
  let stored = initial === undefined ? {} : { [USAGE_STORAGE_KEY]: structuredClone(initial) };
  const writes = [];
  return {
    async get(key) { return structuredClone({ [key]: stored[key] }); },
    async set(value) { await Promise.resolve(); stored = { ...stored, ...structuredClone(value) }; writes.push(structuredClone(value)); },
    get value() { return structuredClone(stored[USAGE_STORAGE_KEY]); }, writes,
  };
}
const request = extra => ({ type: 'request', providerId: 'deepseek', model: 'fast-model', kind: 'page', status: 'success', retry: false, durationMs: 100,
  tokens: { inputTokens: 10, outputTokens: 5, totalTokens: 15, cachedInputTokens: 2 }, ...extra });
const translation = extra => ({ type: 'translation', providerId: 'deepseek', model: 'fast-model', kind: 'page', translatedCharacters: 20, translatedItems: 2, totalItems: 2, cacheHits: 1, ...extra });

test('concurrent updates are serialized without losing request, token or cache counters', async () => {
  const db = storage();
  const usage = createUsageStore({ storage: db, now: () => Date.parse('2026-10-30T03:00:00Z'), timeZone: 'Asia/Shanghai' });
  await Promise.all(Array.from({ length: 150 }, () => usage.recordUsage(request())));
  await Promise.all(Array.from({ length: 100 }, () => usage.recordUsage(translation())));
  const result = await usage.getUsageStats();
  assert.equal(result.summary.requests, 150);
  assert.equal(result.summary.successfulRequests, 150);
  assert.equal(result.summary.totalTokens, 2250);
  assert.equal(result.summary.cachedInputTokens, 300);
  assert.equal(result.summary.translatedCharacters, 2000);
  assert.equal(result.summary.totalItems, 200);
  assert.equal(result.summary.cacheHits, 100);
  assert.equal(result.summary.cacheHitRate, 50);
  assert.equal(result.summary.averageLatencyMs, 100);
  assert.equal(result.breakdown.length, 1);
  assert.equal(result.breakdown[0].requests, 150);
  assert.equal(db.writes.length, 250);
});

test('missing token usage remains distinct from explicit zero, and retry/cancellation are independent attempts', async () => {
  const usage = createUsageStore({ storage: storage(), now: () => 1793329200000, timeZone: 'UTC' });
  await usage.recordUsage(request({ status: 'failed', tokens: null }));
  await usage.recordUsage(request({ retry: true, tokens: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }));
  await usage.recordUsage(request({ status: 'cancelled', tokens: {} }));
  await usage.recordUsage(request({ tokens: { inputTokens: 12, outputTokens: 8 } }));
  const { summary } = await usage.getUsageStats();
  assert.equal(summary.requests, 4);
  assert.equal(summary.successfulRequests, 2);
  assert.equal(summary.failedRequests, 1);
  assert.equal(summary.cancelledRequests, 1);
  assert.equal(summary.retries, 1);
  assert.equal(summary.requestsWithUsage, 2);
  assert.equal(summary.requestsWithoutUsage, 2);
  assert.equal(summary.totalTokens, 20);
});

test('periods use the local calendar boundary and include zero days with matching model breakdowns', async () => {
  let now = Date.parse('2026-10-29T15:59:59Z');
  const usage = createUsageStore({ storage: storage(), now: () => now, timeZone: 'Asia/Shanghai' });
  await usage.recordUsage(request({ model: 'yesterday', kind: 'selection' }));
  now = Date.parse('2026-10-29T16:00:01Z');
  await usage.recordUsage(request({ model: 'today', kind: 'test', durationMs: 300 }));
  await usage.recordUsage(translation({ model: 'today', kind: 'selection' }));
  const today = await usage.getUsageStats();
  assert.equal(today.timezone, 'Asia/Shanghai');
  assert.deepEqual(today.days.map(day => day.date), ['2026-10-30']);
  assert.equal(today.summary.requests, 1);
  assert.equal(today.breakdown.length, 1);
  assert.equal(today.breakdown[0].model, 'today');
  assert.equal(today.kinds.test.requests, 1);
  assert.equal(today.kinds.test.translatedCharacters, 0);
  assert.equal(today.kinds.selection.translatedCharacters, 20);
  const week = await usage.getUsageStats({ period: '7d' });
  assert.equal(week.days.length, 7);
  assert.equal(week.days[0].date, '2026-10-24');
  assert.equal(week.days[0].requests, 0);
  assert.equal(week.summary.requests, 2);
  assert.equal(week.summary.averageLatencyMs, 200);
  assert.equal(week.breakdown.length, 2);
  assert.equal((await usage.getUsageStats({ period: '30d' })).days.length, 30);
});

test('stored aggregates survive a new service-worker store instance without retaining secret fields', async () => {
  const db = storage();
  const options = { storage: db, now: () => Date.parse('2026-10-30T03:00:00Z'), timeZone: 'Asia/Shanghai' };
  const first = createUsageStore(options);
  await first.recordUsage(request({ apiKey: 'never-store-api-key', baseUrl: 'https://secret.example.com/v1', text: 'Private original text', url: 'https://private.page/' }));
  await first.recordUsage(translation({ source: 'Private original text', translation: 'Private translated text' }));
  const reopened = createUsageStore(options);
  const result = await reopened.getUsageStats({ period: 'all' });
  assert.equal(result.summary.requests, 1);
  assert.equal(result.summary.totalTokens, 15);
  assert.equal(result.summary.translatedCharacters, 20);
  assert.equal(result.startedAt, '2026-10-30T03:00:00.000Z');
  const json = JSON.stringify(db.value);
  for (const secret of ['never-store-api-key', 'secret.example.com', 'Private original text', 'Private translated text', 'private.page']) assert.equal(json.includes(secret), false);
  for (const field of ['apiKey', 'baseUrl', 'source', 'url', 'text', 'translation']) assert.equal(Object.hasOwn(db.value, field), false);
});

test('retention bounds daily history to90days while lifetime totals and breakdowns remain complete', async () => {
  let now = Date.parse('2026-07-01T04:00:00Z');
  const db = storage(), usage = createUsageStore({ storage: db, now: () => now, timeZone: 'Asia/Shanghai' });
  for (let index = 0; index < 110; index++) {
    await usage.recordUsage(request());
    if (index < 109) now += 86400000;
  }
  const all = await usage.getUsageStats({ period: 'all' });
  assert.equal(Object.keys(db.value.days).length, 90);
  assert.equal(all.retentionDays, 90);
  assert.equal(all.days.length, 90);
  assert.equal(all.summary.requests, 110);
  assert.equal(all.breakdown[0].requests, 110);
  assert.equal(all.days.reduce((sum, day) => sum + day.requests, 0), 90);
  assert.equal((await usage.getUsageStats({ period: '7d' })).summary.requests, 7);
  now += 100 * 86400000;
  assert.equal((await usage.getUsageStats()).summary.requests, 0);
  assert.equal(Object.keys(db.value.days).length, 0);
  assert.equal((await usage.getUsageStats({ period: 'all' })).summary.requests, 110);
});

test('model cardinality is bounded and overflow is aggregated without losing totals', async () => {
  const db = storage(), usage = createUsageStore({ storage: db, now: () => Date.parse('2026-10-30T03:00:00Z'), timeZone: 'Asia/Shanghai' });
  for (let index = 0; index < 260; index++) await usage.recordUsage(request({ model: `model-${index}` }));
  const all = await usage.getUsageStats({ period: 'all' });
  assert.equal(all.breakdown.length, 200);
  assert.equal(all.breakdown.reduce((sum, row) => sum + row.requests, 0), 260);
  assert.equal(all.breakdown.find(row => row.providerId === 'other').requests, 61);
  assert.equal(all.breakdownCompacted, true);
  assert.equal(db.value.breakdown.length, 200);
  assert.equal(Object.values(db.value.days)[0].breakdown.length, 200);
});

test('malformed saved data and event counters are sanitized before persistence', async () => {
  const db = storage({ version: 1, timezone: 'invalid-zone', startedAt: 'not-a-date', apiKey: 'stale-secret',
    counters: { requests: -5, totalTokens: Infinity, text: 'private' }, breakdown: 'broken',
    days: { 'not-a-day': { counters: { requests: 999 } }, '2026-02-30': {}, '2999-01-01': {} } });
  const usage = createUsageStore({ storage: db, now: () => Date.parse('2026-10-30T03:00:00Z'), timeZone: 'Asia/Shanghai' });
  await usage.recordUsage(translation({ translatedCharacters: -20, translatedItems: 2, totalItems: 1, cacheHits: 200 }));
  await usage.recordUsage(request({ durationMs: NaN, tokens: { inputTokens: -1, outputTokens: 7.9, totalTokens: NaN } }));
  const { summary } = await usage.getUsageStats();
  assert.equal(summary.requests, 1);
  assert.equal(summary.totalTokens, 7);
  assert.equal(summary.translatedCharacters, 0);
  assert.equal(summary.totalItems, 2);
  assert.equal(summary.cacheHits, 2);
  assert.equal(summary.durationMs, 0);
  assert.equal(db.value.timezone, 'Asia/Shanghai');
  assert.deepEqual(Object.keys(db.value.days), ['2026-10-30']);
  assert.equal(JSON.stringify(db.value).includes('stale-secret'), false);
  assert.equal(JSON.stringify(db.value).includes('private'), false);
  await assert.rejects(usage.getUsageStats({ period: 'invalid' }), /时间范围/);
  const missingZone = createUsageStore({ storage: storage({ version: 1, counters: {}, breakdown: [{ providerId: 'empty', model: 'empty', counters: {} }] }), now: () => Date.parse('2026-10-30T03:00:00Z'), timeZone: 'Asia/Shanghai' });
  const clean = await missingZone.getUsageStats();
  assert.equal(clean.timezone, 'Asia/Shanghai');
  assert.equal(clean.breakdown.length, 0);
});

test('clearing is serialized with in-flight writes and persists an empty aggregate', async () => {
  const db = storage(), usage = createUsageStore({ storage: db, now: () => Date.parse('2026-10-30T03:00:00Z'), timeZone: 'Asia/Shanghai' });
  const writes = Array.from({ length: 20 }, () => usage.recordUsage(request()));
  const clear = usage.clearUsageStats();
  await Promise.all([...writes, clear]);
  const cleared = await usage.getUsageStats({ period: 'all' });
  assert.equal(cleared.summary.requests, 0);
  assert.equal(cleared.startedAt, null);
  assert.equal(cleared.updatedAt, null);
  assert.equal(cleared.breakdown.length, 0);
  assert.equal(Object.keys(db.value.days).length, 0);
  await usage.recordUsage(request({ kind: 'test' }));
  await usage.recordUsage(translation({ kind: 'test' }));
  assert.equal((await usage.getUsageStats()).summary.requests, 1);
  assert.equal((await usage.getUsageStats()).summary.translatedCharacters, 0);
});

test('a failed statistics write does not poison future updates', async () => {
  const db = storage();
  let first = true;
  const usage = createUsageStore({ storage: { get: db.get, set: value => { if (first) { first = false; return Promise.reject(new Error('quota')); } return db.set(value); } }, now: () => Date.parse('2026-10-30T03:00:00Z'), timeZone: 'Asia/Shanghai' });
  await assert.rejects(usage.recordUsage(request()), /quota/);
  await usage.recordUsage(request());
  assert.equal((await usage.getUsageStats()).summary.requests, 2);
  assert.equal(db.value.counters.requests, 2);
});

test('manual translations have their own kind and old saved usage receives an empty manual bucket', async () => {
  const db = storage({ version: 1, timezone: 'UTC', counters: { requests: 2, successfulRequests: 2 }, kinds: { page: { requests: 2, successfulRequests: 2 } } });
  const options = { storage: db, now: () => Date.parse('2026-10-30T03:00:00Z'), timeZone: 'UTC' };
  const usage = createUsageStore(options);
  assert.equal((await usage.getUsageStats({ period: 'all' })).kinds.manual.requests, 0);
  await usage.recordUsage(request({ kind: 'manual' }));
  await usage.recordUsage(translation({ kind: 'manual' }));
  const result = await createUsageStore(options).getUsageStats({ period: 'all' });
  assert.equal(result.summary.requests, 3);
  assert.equal(result.kinds.manual.requests, 1);
  assert.equal(result.kinds.manual.totalTokens, 15);
  assert.equal(result.kinds.manual.translatedCharacters, 20);
  assert.equal(result.kinds.page.requests, 2);
  assert.equal(result.kinds.selection.requests, 0);
});

test('reading retries unsaved statistics and reports persistent failures until recovery', async () => {
  const db = storage();
  let failures = 2;
  const options = { storage: { get: db.get, set: value => failures-- > 0 ? Promise.reject(new Error('storage unavailable')) : db.set(value) }, now: () => Date.parse('2026-10-30T03:00:00Z'), timeZone: 'Asia/Shanghai' };
  const usage = createUsageStore(options);
  await assert.rejects(usage.recordUsage(request()), /storage unavailable/);
  await assert.rejects(usage.getUsageStats(), /storage unavailable/);
  assert.equal(db.value, undefined);
  assert.equal((await usage.getUsageStats()).summary.requests, 1);
  assert.equal(db.value.counters.requests, 1);
  assert.equal((await createUsageStore(options).getUsageStats()).summary.requests, 1);
});

test('a failed initial read can recover without replacing previously saved totals', async () => {
  const db = storage({ version: 1, timezone: 'UTC', counters: { requests: 4, successfulRequests: 4 } });
  let first = true;
  const usage = createUsageStore({ storage: { get: key => { if (first) { first = false; return Promise.reject(new Error('storage unavailable')); } return db.get(key); }, set: db.set }, now: () => Date.parse('2026-10-30T03:00:00Z'), timeZone: 'UTC' });
  await assert.rejects(usage.getUsageStats({ period: 'all' }), /storage unavailable/);
  assert.equal((await usage.getUsageStats({ period: 'all' })).summary.requests, 4);
  await usage.recordUsage(request());
  assert.equal(db.value.counters.requests, 5);
});

test('storage budget folds older daily model details while preserving every total and lifetime table', async () => {
  const dayCounters = { requests: 1, successfulRequests: 1, inputTokens: 10, outputTokens: 5, totalTokens: 15, cachedInputTokens: 2, requestsWithUsage: 1,
    translatedCharacters: 100, translatedItems: 5, cacheHits: 2, totalItems: 5, durationMs: 100 };
  const multiply = (value, factor) => Object.fromEntries(Object.entries(value).map(([key, count]) => [key, count * factor]));
  const model = index => `${'模'.repeat(155)}${String(index).padStart(5, '0')}`;
  const rows = Array.from({ length: 180 }, (_, index) => ({ providerId: 'custom', model: model(index), counters: dayCounters }));
  const daily = { counters: multiply(dayCounters, 180), breakdown: rows, kinds: { page: multiply(dayCounters, 180) } };
  const days = {};
  for (let index = 0; index < 90; index++) days[new Date(Date.UTC(2026, 9, 30 - index)).toISOString().slice(0, 10)] = daily;
  const db = storage({ version: 1, timezone: 'UTC', startedAt: '2026-08-02T03:00:00.000Z', updatedAt: '2026-10-30T03:00:00.000Z',
    counters: multiply(dayCounters, 180 * 90), breakdown: rows.map(row => ({ ...row, counters: multiply(dayCounters, 90) })), kinds: { page: multiply(dayCounters, 180 * 90) }, days });
  assert.ok(Buffer.byteLength(JSON.stringify(db.value)) > 4 * 1024 * 1024);
  const usage = createUsageStore({ storage: db, now: () => Date.parse('2026-10-30T03:00:00Z'), timeZone: 'UTC' });
  await usage.recordUsage(request({ providerId: 'custom', model: model(0) }));
  const saved = db.value, all = await usage.getUsageStats({ period: 'all' });
  assert.ok(Buffer.byteLength(JSON.stringify(saved)) <= 4 * 1024 * 1024);
  assert.equal(Object.keys(saved.days).length, 90);
  assert.equal(saved.days['2026-08-02'].breakdown[0].providerId, 'other');
  assert.equal(saved.days['2026-10-30'].breakdown.length, 180);
  assert.equal(all.summary.requests, 180 * 90 + 1);
  assert.equal(all.days.reduce((sum, day) => sum + day.requests, 0), all.summary.requests);
  assert.equal(all.breakdown.reduce((sum, row) => sum + row.requests, 0), all.summary.requests);
  assert.equal(all.breakdown.length, 180);
  assert.equal(all.breakdownCompacted, false);
  const recent = await usage.getUsageStats({ period: '7d' });
  assert.equal(recent.summary.requests, 180 * 7 + 1);
  assert.equal(recent.breakdownCompacted, false);
  const month = await usage.getUsageStats({ period: '30d' });
  assert.equal(month.breakdown.reduce((sum, row) => sum + row.requests, 0), month.summary.requests);
  assert.equal(month.breakdownCompacted, true);
});
