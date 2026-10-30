import test from 'node:test';
import assert from 'node:assert/strict';
import { createTextTranslatorWindowManager, TEXT_WINDOW_STORAGE_KEY } from '../lib/manual-window.js';

function fixture(initialId) {
  const saved = { [TEXT_WINDOW_STORAGE_KEY]: initialId };
  const entries = new Map();
  const removed = [];
  const created = [], updated = [], reads = [];
  let nextId = 10;
  const storage = {
    async get(key) { reads.push(key); return { [key]: saved[key] }; },
    async set(values) { await Promise.resolve(); Object.assign(saved, values); },
  };
  const windows = {
    // This mock deliberately never exposes tabs or their sensitive URL fields.
    async get(id) { if (!entries.has(id)) throw new Error('No such window'); return structuredClone(entries.get(id)); },
    async create(options) { const value = { id: nextId++, type: 'popup', state: 'normal' }; created.push(options); entries.set(value.id, value); return value; },
    async update(id, options) { if (!entries.has(id)) throw new Error('No such window'); updated.push({ id, ...options }); Object.assign(entries.get(id), options); return entries.get(id); },
    onRemoved: { addListener(fn) { removed.push(fn); } },
  };
  return { storage, windows, saved, entries, created, updated, reads,
    close(id) { entries.delete(id); for (const listener of removed) listener(id); },
  };
}
const url = 'chrome-extension://test/translate.html';
const manager = db => createTextTranslatorWindowManager({ storage: db.storage, windows: db.windows, url });

test('concurrent opens reuse a single native window without enumerating any browser tabs', async () => {
  const db = fixture(), current = manager(db);
  const results = await Promise.all([current.open(), current.open(), current.open()]);
  assert.deepEqual(results, [10, 10, 10]);
  assert.deepEqual(db.created, [{ type: 'popup', url, width: 460, height: 680, focused: true }]);
  assert.equal(db.saved[TEXT_WINDOW_STORAGE_KEY], 10);
  assert.equal(await current.open(), 10);
  assert.deepEqual(db.updated.at(-1), { id: 10, focused: true });
  assert.equal(db.created.length, 1);
});

test('a new service-worker manager restores the saved window ID from session storage', async () => {
  const db = fixture(), first = manager(db);
  const id = await first.open();
  const restarted = manager(db);
  assert.equal(await restarted.open(), id);
  assert.equal(db.created.length, 1);
  assert.equal(db.reads.length, 2);
  assert.deepEqual(db.updated.at(-1), { id, focused: true });
});

test('a minimized translator window is restored to normal before focusing', async () => {
  const db = fixture(55);
  db.entries.set(55, { id: 55, type: 'popup', state: 'minimized' });
  assert.equal(await manager(db).open(), 55);
  assert.deepEqual(db.updated.at(-1), { id: 55, focused: true, state: 'normal' });
  assert.equal(db.created.length, 0);
});

test('closed or invalid saved window IDs create a fresh window and replace the session ID', async () => {
  for (const id of [99, null, '99', -1]) {
    const db = fixture(id);
    const opened = await manager(db).open();
    assert.equal(opened, 10);
    assert.equal(db.saved[TEXT_WINDOW_STORAGE_KEY], 10);
    assert.equal(db.created.length, 1);
  }
});

test('closing the remembered window clears its ID and never prevents opening a replacement', async () => {
  const db = fixture(), current = manager(db);
  const id = await current.open();
  db.close(id);
  const replacement = await current.open();
  assert.notEqual(replacement, id);
  assert.equal(db.saved[TEXT_WINDOW_STORAGE_KEY], replacement);
  assert.equal(await manager(db).open(), replacement);
  assert.equal(db.created.length, 2);
});

test('session storage failures preserve same-worker memory reuse and a failed window create can be retried', async () => {
  const db = fixture();
  const current = createTextTranslatorWindowManager({ windows: db.windows, url, storage: {
    get: async () => { throw new Error('Session storage unavailable'); },
    set: async () => { throw new Error('Session storage unavailable'); },
  } });
  const create = db.windows.create;
  db.windows.create = async () => { throw new Error('Window create failed'); };
  await assert.rejects(current.open(), /Window create failed/);
  db.windows.create = create;
  assert.equal(await current.open(), 10);
  assert.equal(await current.open(), 10);
  assert.equal(db.created.length, 1);
});
