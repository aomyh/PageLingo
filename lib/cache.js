const DB_NAME = 'pagelingo-translations';
const STORE = 'translations';
const MAX_ENTRIES = 2000;
const MAX_BYTES = 12 * 1024 * 1024;
const TTL = 30 * 24 * 60 * 60 * 1000;
const memory = new Map();
let database;

async function openDatabase() {
  if (!globalThis.indexedDB) return null;
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'key' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch(() => null);
  return database;
}

async function transaction(mode, action) {
  const db = await openDatabase();
  if (!db) return undefined;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = action(tx.objectStore(STORE));
    let result;
    if (request) request.onsuccess = () => { result = request.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function makeCacheKey(provider, config, language, text) {
  const input = JSON.stringify([provider.id, config.baseUrl.replace(/\/+$/, ''), config.model, language, text]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

export async function getCachedTranslation(key) {
  const entry = memory.get(key) || await transaction('readonly', store => store.get(key));
  if (!entry || Date.now() - entry.createdAt > TTL) return undefined;
  memory.set(key, entry);
  if (memory.size > MAX_ENTRIES) memory.delete(memory.keys().next().value);
  return entry.text;
}

let writes = 0;
export async function setCachedTranslation(key, text) {
  const entry = { key, text, createdAt: Date.now(), bytes: new TextEncoder().encode(text).length + key.length + 32 };
  memory.set(key, entry);
  if (memory.size > MAX_ENTRIES) memory.delete(memory.keys().next().value);
  await transaction('readwrite', store => store.put(entry));
  // Bound storage even when each translation is unusually long.
  if (++writes % 20 === 0) await pruneCache();
}

async function entries() {
  return await transaction('readonly', store => store.getAll()) || [...memory.values()];
}

async function pruneCache() {
  const all = (await entries()).sort((a, b) => b.createdAt - a.createdAt);
  let size = 0;
  const remove = all.filter((entry, index) => {
    size += entry.bytes;
    return index >= MAX_ENTRIES || size > MAX_BYTES || Date.now() - entry.createdAt > TTL;
  });
  for (const entry of remove) memory.delete(entry.key);
  if (remove.length) await transaction('readwrite', store => {
    for (const entry of remove) store.delete(entry.key);
  });
}

export async function cacheStats() {
  await pruneCache();
  const all = await entries();
  return { entries: all.length, bytes: all.reduce((sum, entry) => sum + entry.bytes, 0) };
}

export async function clearTranslationCache() {
  memory.clear();
  await transaction('readwrite', store => store.clear());
}
