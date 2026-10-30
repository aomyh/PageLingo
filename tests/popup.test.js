import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../popup.html', import.meta.url), 'utf8');
const source = (await readFile(new URL('../popup.js', import.meta.url), 'utf8')).replace(/^import[^\n]+\n/, '');
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

async function popup({ enabled = false, extension = true, permit = true, workerError = '', url = 'chrome://settings/' } = {}) {
  let stored = {
    activeProvider: 'deepseek', targetLanguage: 'zh-CN', displayMode: 'bilingual', concurrency: 4,
    batchSize: 2200, cacheEnabled: true, translateDynamic: true, selectionEnabled: enabled,
    providers: { deepseek: { apiKey: '', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com/v1' } },
  };
  const elements = Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(match => [match[1], new Element(match[1])]));
  elements['mode-bilingual'].dataset.mode = 'bilingual'; elements['mode-translated'].dataset.mode = 'translated';
  const log = [], sent = [];
  let storageListener;
  const context = vm.createContext({
    URL, console,
    LANGUAGES: [{ code: 'zh-CN', name: '简体中文' }], STORAGE_KEY: key, extensionAvailable: extension,
    getSettings: async () => { log.push('getSettings'); return structuredClone(stored); },
    saveSettings: async value => { log.push('saveSettings'); stored = structuredClone(value); return structuredClone(stored); },
    getProvider: () => ({ id: 'deepseek', name: 'DeepSeek', abbr: 'D', model: 'deepseek-flash' }),
    isProviderReady: () => false,
    document: {
      getElementById: id => elements[id], createElement: () => new Element(),
      querySelectorAll: selector => selector === '[data-mode]' ? [elements['mode-bilingual'], elements['mode-translated']] : [],
    },
    window: { addEventListener() {}, location: {}, close() {} },
    chrome: {
      permissions: { request: options => { log.push('permissions.request'); assert.deepEqual(Array.from(options.origins), ['http://*/*', 'https://*/*']); return Promise.resolve(typeof permit === 'function' ? permit() : permit); } },
      runtime: {
        sendMessage: async message => {
          log.push('runtime.sendMessage'); sent.push(structuredClone(message));
          if (workerError) return { ok: false, error: workerError };
          stored.selectionEnabled = message.enabled;
          return { ok: true, settings: { selectionEnabled: message.enabled } };
        },
        openOptionsPage: async () => {},
      },
      storage: { onChanged: { addListener: callback => { storageListener = callback; } } },
      tabs: { query: async () => [{ id: 7, url }], sendMessage: async () => { throw new Error('not injected'); } },
    },
    setInterval: () => 1, clearInterval() {},
  });
  vm.runInContext(source, context);
  await flush();
  log.length = 0;
  return {
    elements, log, sent,
    setting: () => structuredClone(stored),
    async externalChange(value) {
      stored.selectionEnabled = value;
      storageListener?.({ [key]: { newValue: structuredClone(stored) } }, 'local');
      await flush();
    },
  };
}

test('selection enable requests host access in the checkbox gesture before async settings reads', async () => {
  let allow;
  const permission = new Promise(resolve => { allow = resolve; });
  const view = await popup({ permit: () => permission });
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
  assert.match(view.elements['status-message'].textContent, /已开启/);
});

test('denied webpage permission rolls the switch back without enabling or saving', async () => {
  const view = await popup({ permit: false });
  await view.elements['selection-enabled'].change(true);
  assert.equal(view.elements['selection-enabled'].checked, false);
  assert.equal(view.elements['selection-enabled'].disabled, false);
  assert.equal(view.setting().selectionEnabled, false); assert.equal(view.sent.length, 0);
  assert.match(view.elements['status-message'].textContent, /权限/);
});

test('quick disable works on restricted pages without keys or a new permission prompt', async () => {
  const view = await popup({ enabled: true });
  await view.elements['selection-enabled'].change(false);
  assert.deepEqual(view.sent, [{ type: 'SET_SELECTION_ENABLED', enabled: false }]);
  assert.equal(view.log.includes('permissions.request'), false);
  assert.equal(view.setting().selectionEnabled, false);
  assert.equal(view.elements['selection-enabled'].checked, false);
  assert.match(view.elements['status-message'].textContent, /已关闭/);
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
  assert.match(view.elements['status-message'].textContent, /预览设置.*加载扩展后生效/);
});

test('an external preference change refreshes the open popup switch without network work', async () => {
  const view = await popup();
  await view.externalChange(true);
  assert.equal(view.elements['selection-enabled'].checked, true);
  assert.equal(view.elements['selection-state'].textContent, '已开启');
  assert.equal(view.sent.length, 0); assert.equal(view.log.includes('permissions.request'), false);
});
