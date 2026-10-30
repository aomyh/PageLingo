export const USAGE_STORAGE_KEY = 'pagelingo.usage.v1';

const RETENTION_DAYS = 90;
const MAX_BREAKDOWN = 200;
const MAX_STORAGE_BYTES = 4 * 1024 * 1024;
const MAX_NUMBER = Number.MAX_SAFE_INTEGER;
const COUNTERS = [
  'requests', 'successfulRequests', 'failedRequests', 'cancelledRequests', 'retries',
  'inputTokens', 'outputTokens', 'totalTokens', 'cachedInputTokens',
  'requestsWithUsage', 'requestsWithoutUsage', 'translatedCharacters',
  'translatedItems', 'cacheHits', 'totalItems', 'durationMs',
];
const KINDS = ['page', 'selection', 'manual', 'test'];
const OTHER = { providerId: 'other', model: '其他模型' };

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const numeric = (value, integer = true) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return Math.min(MAX_NUMBER, integer ? Math.floor(value) : value);
};
const emptyCounters = () => Object.fromEntries(COUNTERS.map(key => [key, 0]));
const counters = value => Object.fromEntries(COUNTERS.map(key => [key, numeric(value?.[key], key !== 'durationMs')]));
const compact = value => Object.fromEntries(COUNTERS.filter(key => value[key] > 0).map(key => [key, value[key]]));
function add(target, delta) {
  for (const key of COUNTERS) {
    const total = numeric(target[key], key !== 'durationMs') + numeric(delta[key], key !== 'durationMs');
    if (total > 0) target[key] = Math.min(MAX_NUMBER, total);
  }
}
function derived(value) {
  const result = counters(value);
  return { ...result, averageLatencyMs: result.requests ? result.durationMs / result.requests : 0,
    cacheHitRate: result.totalItems ? Math.min(100, result.cacheHits / result.totalItems * 100) : 0 };
}
function label(value, fallback, max) {
  if (typeof value !== 'string') return fallback;
  return [...value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim()].slice(0, max).join('') || fallback;
}
function identity(value) {
  return {
    providerId: typeof value?.providerId === 'string' && /^[\w-]{1,64}$/.test(value.providerId) ? value.providerId : 'unknown',
    model: label(value?.model, '未指定模型', 160),
  };
}
const same = (a, b) => a.providerId === b.providerId && a.model === b.model;
function addBreakdown(rows, source, delta) {
  const id = identity(source);
  let row = rows.find(value => same(value, id));
  if (!row) {
    const specific = rows.filter(value => !same(value, OTHER)).length;
    const entry = specific < MAX_BREAKDOWN - 1 ? id : OTHER;
    row = rows.find(value => same(value, entry));
    if (!row) { row = { ...entry, counters: {} }; rows.push(row); }
  }
  add(row.counters, delta);
}
function cleanBreakdown(value) {
  const rows = [];
  if (Array.isArray(value)) for (const row of value.slice(0, MAX_BREAKDOWN * 5)) {
    const delta = counters(row?.counters);
    if (COUNTERS.some(key => delta[key] > 0)) addBreakdown(rows, row, delta);
  }
  return rows;
}
function cleanBucket(value) {
  return { counters: compact(counters(value?.counters)), breakdown: cleanBreakdown(value?.breakdown),
    kinds: Object.fromEntries(KINDS.map(kind => [kind, compact(counters(value?.kinds?.[kind]))])) };
}
function validZone(zone, fallback = 'UTC') {
  if (typeof zone !== 'string' || !zone.trim()) return fallback;
  try { new Intl.DateTimeFormat('en', { timeZone: zone }).format(0); return zone; }
  catch { return fallback; }
}
function isoTime(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
function localDate(timestamp, zone) {
  const parts = new Intl.DateTimeFormat('en', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(timestamp);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function calendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function shiftDay(date, offset) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}
function fresh(timezone) {
  return { version: 1, timezone, startedAt: null, updatedAt: null, counters: {}, breakdown: [], kinds: {}, days: {} };
}
function prune(state, now) {
  const today = localDate(now, state.timezone), cutoff = shiftDay(today, 1 - RETENTION_DAYS);
  let changed = false;
  for (const key of Object.keys(state.days)) if (!calendarDate(key) || key < cutoff || key > today) { delete state.days[key]; changed = true; }
  return changed;
}
function normalize(raw, timezone, now) {
  if (!raw || raw.version !== 1) return fresh(timezone);
  const state = { version: 1, timezone: validZone(raw.timezone, timezone), startedAt: isoTime(raw.startedAt), updatedAt: isoTime(raw.updatedAt),
    ...cleanBucket(raw), days: {} };
  if (raw.days && typeof raw.days === 'object' && !Array.isArray(raw.days)) {
    const today = localDate(now, state.timezone), cutoff = shiftDay(today, 1 - RETENTION_DAYS);
    for (const key of Object.keys(raw.days).filter(key => calendarDate(key) && key >= cutoff && key <= today).sort().slice(-RETENTION_DAYS)) state.days[key] = cleanBucket(raw.days[key]);
  }
  return state;
}
function compactDailyBreakdowns(state) {
  const bytes = value => new TextEncoder().encode(JSON.stringify(value)).byteLength;
  let size = bytes(state);
  if (size <= MAX_STORAGE_BYTES) return;
  // Preserve every daily total and the lifetime model table. Older daily model
  // details may be folded into one explicit overflow row to leave storage room.
  for (const date of Object.keys(state.days).sort()) {
    const bucket = state.days[date], rows = bucket.breakdown;
    if (!rows.length || (rows.length === 1 && same(rows[0], OTHER))) continue;
    const total = {};
    for (const row of rows) add(total, row.counters);
    const reduced = [{ ...OTHER, counters: total }];
    size += bytes(reduced) - bytes(rows);
    bucket.breakdown = reduced;
    if (size <= MAX_STORAGE_BYTES) break;
  }
}
function deltaFor(event) {
  if (!event || !['request', 'translation'].includes(event.type)) return null;
  const delta = emptyCounters();
  if (event.type === 'request') {
    if (!['success', 'failed', 'cancelled'].includes(event.status)) return null;
    delta.requests = 1;
    delta[{ success: 'successfulRequests', failed: 'failedRequests', cancelled: 'cancelledRequests' }[event.status]] = 1;
    delta.retries = event.retry === true ? 1 : 0;
    delta.durationMs = numeric(event.durationMs, false);
    const tokenKeys = ['inputTokens', 'outputTokens', 'totalTokens', 'cachedInputTokens'];
    const hasUsage = event.tokens && typeof event.tokens === 'object' && tokenKeys.some(key => own(event.tokens, key) && typeof event.tokens[key] === 'number' && Number.isFinite(event.tokens[key]) && event.tokens[key] >= 0);
    if (hasUsage) {
      for (const key of tokenKeys) delta[key] = numeric(event.tokens[key]);
      if (!own(event.tokens, 'totalTokens') || typeof event.tokens.totalTokens !== 'number' || !Number.isFinite(event.tokens.totalTokens) || event.tokens.totalTokens < 0) delta.totalTokens = Math.min(MAX_NUMBER, delta.inputTokens + delta.outputTokens);
      delta.requestsWithUsage = 1;
    } else delta.requestsWithoutUsage = 1;
  } else {
    if (event.kind === 'test') return null;
    delta.translatedCharacters = numeric(event.translatedCharacters);
    delta.translatedItems = numeric(event.translatedItems);
    delta.totalItems = Math.max(delta.translatedItems, numeric(event.totalItems));
    delta.cacheHits = Math.min(delta.totalItems, numeric(event.cacheHits));
    if (!delta.totalItems && !delta.translatedCharacters) return null;
  }
  return delta;
}

function memoryStorage() {
  let data = {};
  return { async get(key) { return { [key]: structuredClone(data[key]) }; }, async set(value) { data = { ...data, ...structuredClone(value) }; } };
}

export function createUsageStore({ storage = globalThis.chrome?.storage?.local || memoryStorage(), now = () => Date.now(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone } = {}) {
  const preferredZone = validZone(timeZone);
  let state;
  let dirty = false;
  let queue = Promise.resolve();
  const clock = () => { const value = new Date(now()).getTime(); return Number.isFinite(value) ? value : Date.now(); };
  function serialize(task) {
    const operation = queue.catch(() => {}).then(task);
    queue = operation.catch(() => {});
    return operation;
  }
  async function read() {
    if (!state) state = normalize((await storage.get(USAGE_STORAGE_KEY))?.[USAGE_STORAGE_KEY], preferredZone, clock());
    return state;
  }
  async function persist() {
    dirty = true;
    compactDailyBreakdowns(state);
    await storage.set({ [USAGE_STORAGE_KEY]: state });
    dirty = false;
  }

  return {
    recordUsage(event) {
      // Only the allowlisted fields below survive. Inputs, endpoints and credentials are never stored.
      const delta = deltaFor(event);
      if (!delta) return Promise.resolve();
      const source = identity(event), kind = KINDS.includes(event.kind) ? event.kind : 'page';
      const timestamp = clock();
      return serialize(async () => {
        await read();
        const date = localDate(timestamp, state.timezone), today = localDate(clock(), state.timezone);
        const iso = new Date(timestamp).toISOString();
        state.startedAt ||= iso;
        state.updatedAt = iso;
        add(state.counters, delta);
        addBreakdown(state.breakdown, source, delta);
        state.kinds[kind] ||= {};
        add(state.kinds[kind], delta);
        if (date >= shiftDay(today, 1 - RETENTION_DAYS) && date <= today) {
          const bucket = state.days[date] ||= { counters: {}, breakdown: [], kinds: {} };
          add(bucket.counters, delta);
          addBreakdown(bucket.breakdown, source, delta);
          bucket.kinds[kind] ||= {};
          add(bucket.kinds[kind], delta);
        }
        prune(state, clock());
        await persist();
      });
    },
    getUsageStats({ period = 'today' } = {}) {
      if (!['today', '7d', '30d', 'all'].includes(period)) return Promise.reject(new Error('统计时间范围无效。'));
      return serialize(async () => {
        await read();
        if (prune(state, clock())) dirty = true;
        if (dirty) await persist();
        const today = localDate(clock(), state.timezone);
        let count = { today: 1, '7d': 7, '30d': 30, all: RETENTION_DAYS }[period];
        if (period === 'all' && state.startedAt) {
          const start = localDate(new Date(state.startedAt), state.timezone);
          count = Math.min(RETENTION_DAYS, Math.max(1, Math.round((new Date(`${today}T12:00:00Z`) - new Date(`${start}T12:00:00Z`)) / 86400000) + 1));
        }
        const days = [];
        const sum = emptyCounters(), rows = [], kinds = Object.fromEntries(KINDS.map(kind => [kind, emptyCounters()]));
        for (let index = count - 1; index >= 0; index--) {
          const date = shiftDay(today, -index), bucket = state.days[date];
          days.push({ date, ...derived(bucket?.counters) });
          add(sum, bucket?.counters || {});
          for (const row of bucket?.breakdown || []) addBreakdown(rows, row, row.counters);
          for (const kind of KINDS) add(kinds[kind], bucket?.kinds?.[kind] || {});
        }
        const breakdown = period === 'all' ? state.breakdown : rows;
        return {
          period, summary: derived(period === 'all' ? state.counters : sum), days,
          breakdown: breakdown.map(row => ({ providerId: row.providerId, model: row.model, ...derived(row.counters) })).sort((a, b) => b.totalTokens - a.totalTokens || b.requests - a.requests || b.translatedCharacters - a.translatedCharacters),
          breakdownCompacted: breakdown.some(row => same(row, OTHER)),
          kinds: Object.fromEntries(KINDS.map(kind => [kind, derived(period === 'all' ? state.kinds[kind] : kinds[kind])])),
          startedAt: state.startedAt, updatedAt: state.updatedAt, timezone: state.timezone, retentionDays: RETENTION_DAYS,
        };
      });
    },
    clearUsageStats() {
      return serialize(async () => { state = fresh(preferredZone); await persist(); });
    },
  };
}

let singleton;
const defaultStore = () => singleton ||= createUsageStore();
export const recordUsage = event => defaultStore().recordUsage(event);
export const getUsageStats = options => defaultStore().getUsageStats(options);
export const clearUsageStats = () => defaultStore().clearUsageStats();
