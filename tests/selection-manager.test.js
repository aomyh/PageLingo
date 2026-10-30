import test from 'node:test';
import assert from 'node:assert/strict';
import { createSelectionManager, publicSettings, SELECTION_ORIGINS, supportsSelection } from '../lib/selection.js';
import { defaultSettings } from '../lib/config.js';

function harness({ enabled = false, granted = true, registered = [], register, read, query, inject } = {}) {
  let settings = { ...defaultSettings(), selectionEnabled: enabled };
  settings.providers.deepseek.apiKey = 'dummy-never-broadcast-this-key';
  let permission = granted;
  let scripts = structuredClone(registered);
  let disables = 0;
  const registrations = [], removals = [], injections = [], messages = [], permissions = [];
  const api = {
    permissions: { contains: async value => { permissions.push(value); return permission; } },
    scripting: {
      getRegisteredContentScripts: async () => scripts,
      async registerContentScripts(value) { registrations.push(value); if (register) await register(); scripts = value; },
      async unregisterContentScripts(value) { removals.push(value); scripts = []; },
      async executeScript(value) { injections.push(value); if (inject) await inject(value); if (value.target.tabId === 5) throw new Error('closed tab'); },
    },
    tabs: {
      query: async () => { if (query) await query(); return [{ id: 1, url: 'https://news.example/article' }, { id: 2, url: 'http://localhost:4173' }, { id: 3, url: 'chrome://settings/' }, { id: 4, url: 'https://chromewebstore.google.com/detail/example' }, { id: 5 }]; },
      async sendMessage(id, value) { messages.push({ id, value }); if (id >= 3) throw new Error('no receiver'); },
    },
  };
  const manager = createSelectionManager({ api, read: async () => read ? read(settings) : settings, write: async value => (settings = value), onDisable: () => disables++ });
  return { manager, registrations, removals, injections, messages, permissions,
    get settings() { return settings; }, updateSettings(patch) { settings = { ...settings, ...patch }; }, set granted(value) { permission = value; }, get disables() { return disables; } };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('enabling requires broad webpage grants and registers future pages plus existing supported tabs', async () => {
  const page = harness();
  const result = await page.manager.setEnabled(true);
  assert.equal(result.selectionEnabled, true);
  assert.deepEqual(page.permissions[0], { origins: SELECTION_ORIGINS });
  assert.equal(page.settings.selectionEnabled, true);
  assert.equal(page.registrations.length, 1);
  assert.deepEqual(page.registrations[0][0], { id: 'pagelingo-selection', matches: SELECTION_ORIGINS, js: ['lib/themes.js', 'selection.js'], runAt: 'document_idle', allFrames: false, persistAcrossSessions: true });
  assert.deepEqual(page.injections.map(value => value.target.tabId), [1, 2]);
  assert.equal(page.messages.length, 5, 'live settings also reach prior scripts when their URLs are unavailable');
  assert.equal(JSON.stringify(page.messages).includes('dummy-never-broadcast'), false);
  await page.manager.reconcile();
  assert.equal(page.registrations.length, 1, 'reconciliation must not duplicate the registered script');
});

test('startup upgrades an older selection registration to load themes first for new and existing pages', async () => {
  const page = harness({ enabled: true, registered: [{
    id: 'pagelingo-selection', matches: SELECTION_ORIGINS, js: ['selection.js'],
    runAt: 'document_idle', allFrames: false, persistAcrossSessions: true,
  }] });
  const result = await page.manager.reconcile({ injectExisting: true });
  assert.equal(result.selectionEnabled, true);
  assert.equal(page.settings.selectionEnabled, true, 'upgrading assets preserves the enabled preference');
  assert.equal(page.disables, 0);
  assert.deepEqual(page.removals, [{ ids: ['pagelingo-selection'] }]);
  assert.deepEqual(page.registrations, [[{
    id: 'pagelingo-selection', matches: SELECTION_ORIGINS, js: ['lib/themes.js', 'selection.js'],
    runAt: 'document_idle', allFrames: false, persistAcrossSessions: true,
  }]]);
  assert.deepEqual(page.injections, [
    { target: { tabId: 1 }, files: ['lib/themes.js', 'selection.js'] },
    { target: { tabId: 2 }, files: ['lib/themes.js', 'selection.js'] },
  ], 'already-open supported pages receive the helper before the guarded content script');
  assert.equal(JSON.stringify(page.messages).includes('dummy-never-broadcast-this-key'), false);
  await page.manager.reconcile();
  assert.equal(page.removals.length, 1, 'a current registration is not removed again');
  assert.equal(page.registrations.length, 1, 'the upgrade is idempotent');
});

test('denied optional permissions do not persist or register an enabled preference', async () => {
  const page = harness({ granted: false });
  await assert.rejects(page.manager.setEnabled(true), /允许访问网页/);
  assert.equal(page.settings.selectionEnabled, false);
  assert.equal(page.registrations.length, 0);
});

test('disabling stops current documents, unregisters future pages and is idempotent', async () => {
  const page = harness();
  await page.manager.setEnabled(true);
  page.messages.length = 0;
  const result = await page.manager.setEnabled(false);
  assert.equal(result.selectionEnabled, false);
  assert.equal(page.settings.selectionEnabled, false);
  assert.ok(page.disables > 0);
  assert.equal(page.removals.length, 1);
  assert.ok(page.messages.every(entry => entry.value.settings.selectionEnabled === false));
  await page.manager.setEnabled(false);
  assert.equal(page.removals.length, 1);
});

test('permission removal reconciles stored enabled state to off and broadcasts the change', async () => {
  const page = harness();
  await page.manager.setEnabled(true);
  page.granted = false;
  await page.manager.reconcile();
  assert.equal(page.settings.selectionEnabled, false);
  assert.equal(page.removals.length, 1);
  assert.equal(page.messages.at(-1).value.settings.selectionEnabled, false);
});

test('an off-toggle during pending registration cannot inject or leave a stale enabled script', async () => {
  let finish, started;
  const pending = new Promise(resolve => { finish = resolve; });
  const entered = new Promise(resolve => { started = resolve; });
  const page = harness({ register: async () => { started(); await pending; } });
  const enable = page.manager.setEnabled(true);
  await entered;
  const disable = page.manager.setEnabled(false);
  assert.equal(page.manager.isEnabled(page.settings), false, 'the in-memory gate closes immediately');
  finish();
  await Promise.all([enable, disable]);
  assert.equal(page.settings.selectionEnabled, false);
  assert.equal(page.injections.length, 0);
  assert.equal(page.removals.length, 1);
  assert.equal(page.messages.at(-1).value.settings.selectionEnabled, false);
});

test('public settings omit credentials and support checks exclude browser-internal pages', () => {
  const value = publicSettings(defaultSettings());
  assert.equal(value.selectionEnabled, false);
  assert.equal('providers' in value, false);
  assert.equal('baseUrl' in value, false);
  assert.equal(supportsSelection('https://example.com/article'), true);
  assert.equal(supportsSelection('http://example.com/article'), true);
  for (const url of ['chrome://settings/', 'file:///tmp/article.html', 'https://chromewebstore.google.com/detail/extension', 'https://chrome.google.com/webstore/detail/extension', 'not a url']) assert.equal(supportsSelection(url), false);
});

test('a delayed eager off storage read cannot broadcast off after a later enable completes', async () => {
  const readEntered = deferred(), releaseRead = deferred();
  let delayNextRead = false;
  const page = harness({ read: async value => {
    if (delayNextRead) { delayNextRead = false; readEntered.resolve(); await releaseRead.promise; }
    return value;
  } });
  await page.manager.setEnabled(true);
  delayNextRead = true;
  const off = page.manager.setEnabled(false);
  await readEntered.promise;
  await off;
  await page.manager.setEnabled(true);
  const count = page.messages.length;
  releaseRead.resolve();
  await flush();
  assert.equal(page.messages.length, count, 'the old off action must not enqueue a stale broadcast');
  assert.equal(page.messages.at(-1).value.settings.selectionEnabled, true);
  assert.equal(page.settings.selectionEnabled, true);
});

test('a delayed eager off tab lookup cannot broadcast off after a later enable completes', { timeout: 1000 }, async () => {
  const queryEntered = deferred(), releaseQuery = deferred();
  let delayNextQuery = false;
  const page = harness({ query: async () => {
    if (delayNextQuery) { delayNextQuery = false; queryEntered.resolve(); await releaseQuery.promise; }
  } });
  await page.manager.setEnabled(true);
  delayNextQuery = true;
  const off = page.manager.setEnabled(false);
  await queryEntered.promise;
  await off;
  await page.manager.setEnabled(true);
  const count = page.messages.length;
  releaseQuery.resolve();
  await flush();
  assert.equal(page.messages.length, count, 'revision is checked again after the asynchronous tab query');
  assert.equal(page.messages.at(-1).value.settings.selectionEnabled, true);
  assert.equal(page.settings.selectionEnabled, true);
});

test('an off-toggle during existing-tab lookup prevents stale injection and enabled broadcasts', async () => {
  const entered = deferred(), release = deferred();
  let first = true;
  const page = harness({ query: async () => {
    if (first) { first = false; entered.resolve(); await release.promise; }
  } });
  const on = page.manager.setEnabled(true);
  await entered.promise;
  const off = page.manager.setEnabled(false);
  await flush();
  release.resolve();
  await Promise.all([on, off]);
  assert.equal(page.injections.length, 0);
  assert.ok(page.messages.length > 0);
  assert.ok(page.messages.every(entry => entry.value.settings.selectionEnabled === false));
  assert.equal(page.settings.selectionEnabled, false);
});

test('an off-toggle during injection prevents a late enabled broadcast', async () => {
  const entered = deferred(), release = deferred();
  const page = harness({ inject: async value => {
    if (value.target.tabId === 1) { entered.resolve(); await release.promise; }
  } });
  const on = page.manager.setEnabled(true);
  await entered.promise;
  const off = page.manager.setEnabled(false);
  await flush();
  release.resolve();
  await Promise.all([on, off]);
  assert.ok(page.messages.length > 0);
  assert.ok(page.messages.every(entry => entry.value.settings.selectionEnabled === false));
  assert.equal(page.settings.selectionEnabled, false);
});

test('an off-toggle during the enabled broadcast tab query discards that stale payload', async () => {
  const entered = deferred(), release = deferred();
  let queries = 0;
  const page = harness({ query: async () => {
    if (++queries === 2) { entered.resolve(); await release.promise; }
  } });
  const on = page.manager.setEnabled(true);
  await entered.promise;
  const off = page.manager.setEnabled(false);
  await flush();
  release.resolve();
  await Promise.all([on, off]);
  assert.ok(page.messages.length > 0);
  assert.ok(page.messages.every(entry => entry.value.settings.selectionEnabled === false));
  assert.equal(page.settings.selectionEnabled, false);
});

test('registration failure rolls enabled preference back while preserving newer unrelated settings', async () => {
  let page;
  page = harness({ register: async () => {
    page.updateSettings({ targetLanguage: 'fr', cacheEnabled: false });
    throw new Error('Script registration failed');
  } });
  await assert.rejects(page.manager.setEnabled(true), /registration failed/);
  assert.equal(page.settings.selectionEnabled, false);
  assert.equal(page.settings.targetLanguage, 'fr');
  assert.equal(page.settings.cacheEnabled, false);
  assert.equal(page.settings.providers.deepseek.apiKey, 'dummy-never-broadcast-this-key');
  assert.equal(page.manager.isEnabled(page.settings), false);
  assert.equal(page.injections.length, 0);
  assert.ok(page.messages.length > 0);
  assert.ok(page.messages.every(entry => entry.value.settings.selectionEnabled === false));
});

test('a startup registration failure also clears a previously persisted enabled flag', async () => {
  const page = harness({ enabled: true, register: async () => { throw new Error('Script registration failed'); } });
  await assert.rejects(page.manager.reconcile({ injectExisting: true }), /registration failed/);
  assert.equal(page.settings.selectionEnabled, false);
  assert.equal(page.manager.isEnabled(page.settings), false);
  assert.equal(page.messages.at(-1).value.settings.selectionEnabled, false);
});
