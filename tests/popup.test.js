import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { requestSelectionPermission } from '../lib/permissions.js';

const html = await readFile(new URL('../popup.html', import.meta.url), 'utf8');
const source = (await readFile(new URL('../popup.js', import.meta.url), 'utf8')).replace(/^import[^\n]+\n/gm, '');
const key = 'pagelingo.settings.v1';
const flush = () => new Promise(resolve => setImmediate(resolve));

class Element {
  constructor(id = '') {
    this.id = id; this.textContent = ''; this.value = ''; this.checked = false; this.disabled = false;
    this.dataset = {}; this.style = {}; this.attributes = {}; this.children = []; this.listeners = {};
    this.classes = new Set();
    this.classList = { toggle: (name, force) => { if (force) this.classes.add(name); else this.classes.delete(name); } };
  }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  setAttribute(name, value) { this.attributes[name] = value; }
  append(child) { this.children.push(child); }
  change(checked) { this.checked = checked; return this.listeners.change({ target: this }); }
}

async function popup({ enabled = false, extension = true, permit = true, workerError = '', manualResult = { ok: true, windowId: 17 }, url = 'chrome://settings/', loadedManifest = { optional_host_permissions: ['http://*/*', 'https://*/*'] }, usage = { requests: 0, totalTokens: 0, requestsWithUsage: 0, requestsWithoutUsage: 0 }, usageError = false } = {}) {
  let stored = {
    activeProvider: 'deepseek', targetLanguage: 'zh-CN', displayMode: 'bilingual', concurrency: 4,
    batchSize: 2200, cacheEnabled: true, translateDynamic: true, selectionEnabled: enabled,
    providers: { deepseek: { apiKey: '', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com/v1' } },
  };
  const elements = Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(match => [match[1], new Element(match[1])]));
  elements['mode-bilingual'].dataset.mode = 'bilingual'; elements['mode-translated'].dataset.mode = 'translated';
  const log = [], sent = [], opened = [];
  let usageData = structuredClone(usage), usageCalls = 0;
  let storageListener, closes = 0, manualShows = 0;
  const context = vm.createContext({
    URL, console,
    applyTheme: (target, theme) => { if (target) target.theme = theme || 'midnight'; },
    LANGUAGES: [{ code: 'zh-CN', name: '简体中文' }], STORAGE_KEY: key, extensionAvailable: extension,
    getSettings: async () => { log.push('getSettings'); return structuredClone(stored); },
    saveSettings: async value => { log.push('saveSettings'); stored = structuredClone(value); return structuredClone(stored); },
    getProvider: () => ({ id: 'deepseek', name: 'DeepSeek', abbr: 'D', model: 'deepseek-flash' }),
    isProviderReady: () => false,
    document: {
      documentElement: new Element('html'),
      getElementById: id => elements[id], createElement: () => new Element(),
      querySelectorAll: selector => selector === '[data-mode]' ? [elements['mode-bilingual'], elements['mode-translated']] : [],
    },
    window: { addEventListener() {}, location: {}, close() { closes++; }, open: (...args) => { opened.push(args); return { focus() {} }; }, __pageLingoManualPanel: { show() { manualShows++; } } },
    chrome: {
      permissions: { request: options => { log.push('permissions.request'); assert.deepEqual(Array.from(options.origins), ['http://*/*', 'https://*/*']); return Promise.resolve(typeof permit === 'function' ? permit() : permit); } },
      runtime: {
        getManifest: () => loadedManifest,
        getURL: path => `chrome-extension://extension-id/${path}`,
        sendMessage: async message => {
          log.push('runtime.sendMessage'); sent.push(structuredClone(message));
          if (message.type === 'GET_USAGE_STATS') {
            usageCalls++;
            return usageError ? { ok: false } : { ok: true, summary: structuredClone(usageData) };
          }
          if (message.type === 'OPEN_TEXT_TRANSLATOR') return typeof manualResult === 'function' ? manualResult() : manualResult;
          if (workerError) return { ok: false, error: workerError };
          stored.selectionEnabled = message.enabled;
          return { ok: true, settings: { selectionEnabled: message.enabled } };
        },
        openOptionsPage: async () => {},
      },
      storage: { onChanged: { addListener: callback => { storageListener = callback; } } },
      tabs: { query: async () => [{ id: 7, url }], create: async options => { opened.push(structuredClone(options)); }, sendMessage: async () => { throw new Error('not injected'); } },
    },
    setInterval: () => 1, clearInterval() {},
  });
  context.requestSelectionPermission = () => requestSelectionPermission(context.chrome);
  vm.runInContext(source, context);
  await flush();
  log.length = 0;
  sent.length = 0;
  return {
    elements, log, sent, opened, context,
    get usageCalls() { return usageCalls; },
    get closes() { return closes; },
    get manualShows() { return manualShows; },
    setting: () => structuredClone(stored),
    async externalChange(value) {
      stored.selectionEnabled = value;
      storageListener?.({ [key]: { newValue: structuredClone(stored) } }, 'local');
      await flush();
    },
    async externalUsage(value, repeats = 1) {
      usageData = structuredClone(value);
      for (let index = 0; index < repeats; index++) storageListener?.({ 'pagelingo.usage.v1': { newValue: {} } }, 'local');
      await flush();
    },
  };
}

test('selection enable requests host access in the checkbox gesture before async settings reads', async () => {
  let allow;
  const permission = new Promise(resolve => { allow = resolve; });
  const view = await popup({ permit: () => permission });
  const previousMessage = view.elements['status-message'].textContent;
  const toggle = view.elements['selection-enabled'];
  const change = toggle.change(true);
  assert.deepEqual(view.log, ['permissions.request']);
  assert.equal(toggle.disabled, true); assert.equal(toggle.checked, true);
  assert.equal(view.sent.length, 0, 'the worker is not asked to enable before permission is granted');
  allow(true); await change;
  assert.deepEqual(view.sent, [{ type: 'SET_SELECTION_ENABLED', enabled: true }]);
  assert.equal(view.setting().selectionEnabled, true);
  assert.equal(toggle.checked, true); assert.equal(toggle.disabled, false);
  assert.equal(view.log.includes('saveSettings'), false, 'the worker alone persists extension feature state');
  assert.equal(view.elements['translate-button'].disabled, true, 'selection control remains usable without a page or API key');
  assert.equal(view.elements['selection-state'].textContent, '已开启');
  assert.equal(view.elements['status-message'].textContent, previousMessage, 'switch success must not add or remove a popup-height-changing message');
});

test('denied webpage permission rolls the switch back without enabling or saving', async () => {
  const view = await popup({ permit: false });
  await view.elements['selection-enabled'].change(true);
  assert.equal(view.elements['selection-enabled'].checked, false);
  assert.equal(view.elements['selection-enabled'].disabled, false);
  assert.equal(view.setting().selectionEnabled, false); assert.equal(view.sent.length, 0);
  assert.match(view.elements['status-message'].textContent, /权限/);
});

test('an old loaded Manifest shows reload instructions without sending an invalid permission request', async () => {
  const view = await popup({ loadedManifest: { version: '1.0.0', optional_host_permissions: ['https://*/*', 'http://localhost/*'] } });
  await view.elements['selection-enabled'].change(true);
  assert.equal(view.log.includes('permissions.request'), false);
  assert.equal(view.sent.length, 0);
  assert.equal(view.setting().selectionEnabled, false);
  assert.equal(view.elements['selection-enabled'].checked, false);
  assert.equal(view.elements['selection-enabled'].disabled, false);
  assert.match(view.elements['status-message'].textContent, /chrome:\/\/extensions.*重新加载/);
});

test('quick disable works on restricted pages without keys or a new permission prompt', async () => {
  const view = await popup({ enabled: true });
  const previousMessage = view.elements['status-message'].textContent;
  await view.elements['selection-enabled'].change(false);
  assert.deepEqual(view.sent, [{ type: 'SET_SELECTION_ENABLED', enabled: false }]);
  assert.equal(view.log.includes('permissions.request'), false);
  assert.equal(view.setting().selectionEnabled, false);
  assert.equal(view.elements['selection-enabled'].checked, false);
  assert.equal(view.elements['selection-state'].textContent, '已关闭');
  assert.equal(view.elements['status-message'].textContent, previousMessage);
});

test('worker failures preserve the last saved switch state and report the actual error', async () => {
  const view = await popup({ enabled: true, workerError: '无法关闭划词翻译，请重试。' });
  await view.elements['selection-enabled'].change(false);
  assert.equal(view.setting().selectionEnabled, true);
  assert.equal(view.elements['selection-enabled'].checked, true);
  assert.equal(view.elements['selection-enabled'].disabled, false);
  assert.match(view.elements['status-message'].textContent, /无法关闭/);
});

test('pending enable cannot send duplicate requests when a second change arrives', async () => {
  let allow;
  const permission = new Promise(resolve => { allow = resolve; });
  const view = await popup({ permit: () => permission });
  const first = view.elements['selection-enabled'].change(true);
  await view.elements['selection-enabled'].change(false);
  assert.equal(view.elements['selection-enabled'].checked, true);
  assert.equal(view.log.filter(item => item === 'permissions.request').length, 1);
  allow(true); await first;
  assert.equal(view.sent.length, 1);
});

test('ordinary browser preview saves only preview settings without requesting permissions or claiming activation', async () => {
  const view = await popup({ extension: false });
  await view.elements['selection-enabled'].change(true);
  assert.equal(view.setting().selectionEnabled, true);
  assert.equal(view.sent.length, 0); assert.equal(view.log.includes('permissions.request'), false);
  assert.match(view.elements['selection-hint'].textContent, /预览设置.*加载扩展后生效/);
  assert.match(view.elements['status-message'].textContent, /弹窗界面预览/);
});

test('an external preference change refreshes the open popup switch without network work', async () => {
  const view = await popup();
  await view.externalChange(true);
  assert.equal(view.elements['selection-enabled'].checked, true);
  assert.equal(view.elements['selection-state'].textContent, '已开启');
  assert.equal(view.sent.length, 0); assert.equal(view.log.includes('permissions.request'), false);
});

test('today usage reads real reported totals and opens the detailed usage view without an API key', async () => {
  const view = await popup({ usage: { requests: 12, totalTokens: 1234, requestsWithUsage: 12, requestsWithoutUsage: 0 } });
  assert.equal(view.usageCalls, 1);
  assert.equal(view.elements['usage-summary'].textContent, '今日 1.2k Token · 12次');
  assert.match(view.elements['open-usage'].title, /1,234 Token/);
  assert.match(view.elements['open-usage'].title, /4 路并行/);
  await view.elements['open-usage'].listeners.click();
  assert.deepEqual(view.opened, [{ url: 'chrome-extension://extension-id/options.html#usage' }]);
});

test('usage refresh is coalesced and does not overwrite the popup selection controls', async () => {
  const view = await popup({ enabled: true });
  await view.externalUsage({ requests: 4, totalTokens: 2000, requestsWithUsage: 2, requestsWithoutUsage: 2 }, 4);
  assert.equal(view.usageCalls, 2, 'one initial request and one read for the burst of storage changes');
  assert.equal(view.elements['usage-summary'].textContent, '今日已报2k Token · 4次');
  assert.match(view.elements['open-usage'].title, /2 次请求未返回 Token/);
  assert.equal(view.elements['selection-enabled'].checked, true);
  assert.equal(view.sent.filter(message => message.type === 'SET_SELECTION_ENABLED').length, 0);
});

test('missing usage and an unavailable counter are explicit, and HTTP preview never fabricates totals', async () => {
  const missing = await popup({ usage: { requests: 3, totalTokens: 0, requestsWithUsage: 0, requestsWithoutUsage: 3 } });
  assert.equal(missing.elements['usage-summary'].textContent, '今日 — Token · 3次');
  const unavailable = await popup({ usageError: true });
  assert.equal(unavailable.elements['usage-summary'].textContent, '用量统计 · 暂不可用');
  assert.equal(unavailable.elements['status-message'].classes.has('error'), false, 'counter errors never introduce a popup-height-changing alert');
  const preview = await popup({ extension: false });
  assert.equal(preview.usageCalls, 0);
  assert.equal(preview.elements['usage-summary'].textContent, '用量统计');
  await preview.elements['open-usage'].listeners.click();
  assert.equal(preview.context.window.location.href, 'options.html#usage');
});

test('manual entry sends the current tab to the floating translator without keys or selection permission', async () => {
  const view = await popup();
  await view.elements['open-manual'].listeners.click();
  assert.deepEqual(view.sent, [{ type: 'OPEN_TEXT_TRANSLATOR', tabId: 7 }]);
  assert.equal(view.log.includes('permissions.request'), false);
  assert.equal(view.log.includes('saveSettings'), false);
  assert.equal(view.closes, 1);
  assert.equal(view.setting().selectionEnabled, false);
});

test('manual launch deduplicates pending clicks and keeps the popup open on failure', async () => {
  let resolve;
  const view = await popup({ manualResult: () => new Promise(done => { resolve = done; }) });
  const first = view.elements['open-manual'].listeners.click();
  await view.elements['open-manual'].listeners.click();
  assert.equal(view.sent.length, 1);
  resolve({ ok: false, error: '无法打开独立窗口' });
  await first;
  assert.equal(view.closes, 0);
  assert.equal(view.elements['open-manual'].disabled, false);
  assert.equal(view.elements['status-message'].textContent, '无法打开独立窗口');
});

test('preview shows the floating translator in place without opening a tab or closing the source page', async () => {
  const view = await popup({ extension: false });
  await view.elements['open-manual'].listeners.click();
  await view.elements['open-manual'].listeners.click();
  assert.deepEqual(view.opened, []);
  assert.equal(view.manualShows, 2);
  assert.equal(view.sent.length, 0);
  assert.equal(view.closes, 0);
});
