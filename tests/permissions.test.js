import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { requestSelectionPermission, RELOAD_PERMISSION_MESSAGE, SELECTION_ORIGINS } from '../lib/permissions.js';

test('the current manifest permits the selection request immediately in the initiating gesture', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  const calls = [];
  const result = requestSelectionPermission({
    runtime: { getManifest: () => { calls.push('manifest'); return manifest; } },
    permissions: { request: options => { calls.push(options); return Promise.resolve(true); } },
  });
  assert.deepEqual(calls, ['manifest', { origins: SELECTION_ORIGINS }], 'no async work may precede the permission request');
  assert.equal(await result, true);
});

test('old loaded permissions are caught before Chrome rejects an undeclared HTTP request', () => {
  let requested = false;
  assert.throws(() => requestSelectionPermission({
    runtime: { getManifest: () => ({ optional_host_permissions: ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*'] }) },
    permissions: { request: () => { requested = true; return Promise.resolve(true); } },
  }), { message: RELOAD_PERMISSION_MESSAGE });
  assert.equal(requested, false);
});

test('valid manifest-wide host declarations work and denial stays a denial', async () => {
  for (const manifest of [{ host_permissions: ['http://*/*', 'https://*/*'] }, { optional_host_permissions: ['*://*/*'] }, { optional_host_permissions: ['<all_urls>'] }]) {
    assert.equal(await requestSelectionPermission({ runtime: { getManifest: () => manifest }, permissions: { request: async () => false } }), false);
  }
});

test('Chrome declaration errors become actionable Chinese messages; unrelated errors are preserved', async () => {
  const manifest = { optional_host_permissions: [...SELECTION_ORIGINS] };
  const error = new Error('Only permissions specified in the manifest may be requested.');
  const runtime = { getManifest: () => manifest };
  await assert.rejects(requestSelectionPermission({ runtime, permissions: { request: async () => { throw error; } } }), { message: RELOAD_PERMISSION_MESSAGE });
  assert.throws(() => requestSelectionPermission({ runtime, permissions: { request: () => { throw error; } } }), { message: RELOAD_PERMISSION_MESSAGE });
  const other = new Error('The user canceled the permission request.');
  await assert.rejects(requestSelectionPermission({ runtime, permissions: { request: async () => { throw other; } } }), candidate => candidate === other);
});
