import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../selection.js', import.meta.url), 'utf8');
const blockedTags = new Set('SCRIPT STYLE NOSCRIPT PRE CODE KBD SAMP SVG MATH CANVAS IFRAME OBJECT TEXTAREA INPUT SELECT OPTION BUTTON FORM'.split(' '));
const enabled = { selectionEnabled: true, targetLanguage: 'zh-CN', providerName: 'Test AI', model: 'test-model', ready: true };
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

class FakeNode {
  constructor(type, tag, text = '') { this.nodeType = type; this.tagName = tag?.toUpperCase(); this.nodeValue = type === 3 ? text : null; this.childNodes = []; this.parentNode = null; this.attributes = new Map(); this.listeners = new Map(); this.style = {}; }
  get parentElement() { return this.parentNode?.nodeType === 1 ? this.parentNode : null; }
  get isConnected() { return this.nodeType === 9 || Boolean(this.parentNode?.isConnected); }
  get textContent() { return this.nodeType === 3 ? this.nodeValue : this.childNodes.map(node => node.textContent).join(''); }
  set textContent(value) { this.childNodes.forEach(node => { node.parentNode = null; }); this.childNodes = []; if (this.nodeType === 3) this.nodeValue = String(value); else if (String(value)) this.append(new FakeNode(3, null, String(value))); }
  set className(value) { this.setAttribute('class', value); }
  get className() { return this.getAttribute('class') || ''; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  append(...nodes) { for (const node of nodes) { node.remove(); node.parentNode = this; this.childNodes.push(node); } }
  remove() { if (this.parentNode) { const siblings = this.parentNode.childNodes; siblings.splice(siblings.indexOf(this), 1); this.parentNode = null; } }
  contains(node) { return this === node || this.childNodes.some(child => child.contains(node)); }
  addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(fn); }
  removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
  fire(name, options = {}) { const event = { target: this, preventDefault() {}, ...options }; for (const fn of [...this.listeners.get(name) || []]) fn(event); }
  blocked() { return blockedTags.has(this.tagName) || this.attributes.has('data-pagelingo') || this.getAttribute('translate') === 'no' || this.getAttribute('aria-hidden') === 'true' || this.attributes.has('inert') || (this.attributes.has('contenteditable') && this.getAttribute('contenteditable') !== 'false'); }
  closest(selector) { for (let node = this; node?.nodeType === 1; node = node.parentElement) if (selector === '[hidden]' ? node.attributes.has('hidden') : node.blocked()) return node; return null; }
  querySelectorAll(selector) { return descendants(this).filter(node => node !== this && node.nodeType === 1 && (selector === '*' || (selector.includes('script,style') && (node.blocked() || node.attributes.has('hidden'))) || (selector === '[data-pagelingo]' && node.attributes.has('data-pagelingo')))); }
  attachShadow() { this.shadow = new FakeNode(11); this.shadow.parentNode = this; return this.shadow; }
  getBoundingClientRect() { return { left: 20, right: 380, top: 100, bottom: 280, width: 360, height: 180 }; }
}
function descendants(node) { return [node, ...node.childNodes.flatMap(descendants)]; }
function ancestor(node) { const result = []; for (let current = node; current; current = current.parentNode) result.push(current); return result; }

function harness(translate = async request => ({ ok: true, text: `译文：${request.text}`, cached: false }), initial) {
  const document = new FakeNode(9);
  document.documentElement = new FakeNode(1, 'html'); document.body = new FakeNode(1, 'body');
  document.append(document.documentElement); document.documentElement.append(document.body);
  document.createElement = tag => new FakeNode(1, tag);
  document.createTreeWalker = root => { const nodes = descendants(root).filter(node => node.nodeType === 3); let index = 0; return { nextNode: () => nodes[index++] || null }; };
  const window = new FakeNode(0);
  window.innerWidth = 1000; window.innerHeight = 800;
  let selection = { rangeCount: 0, isCollapsed: true, toString: () => '' };
  window.getSelection = () => selection;
  const messages = [], listeners = [], timers = new Map();
  let time = 0, timerId = 0;
  const context = vm.createContext({ document, window, Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 }, NodeFilter: { SHOW_TEXT: 4 },
    getComputedStyle: node => ({ display: node.style.display || 'block', visibility: node.style.visibility || 'visible', opacity: node.style.opacity ?? '1', contentVisibility: node.style.contentVisibility || 'visible' }),
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, when: time + delay }); return id; }, clearTimeout(id) { timers.delete(id); },
    chrome: { runtime: { onMessage: { addListener(fn) { listeners.push(fn); } }, sendMessage(request) { messages.push(request); if (request.type === 'GET_PUBLIC_SETTINGS') return initial?.promise || Promise.resolve({ ok: true, settings: { ...enabled, selectionEnabled: false } }); if (request.type === 'TRANSLATE_SELECTION') return translate(request); return Promise.resolve({ ok: true }); } } }, console });
  vm.runInContext(source, context);
  return {
    document, window, messages,
    text: text => new FakeNode(3, null, text),
    node(tag, ...children) { const element = new FakeNode(1, tag); element.append(...children); return element; },
    get host() { return document.documentElement.childNodes.find(node => node.getAttribute('data-pagelingo') === 'selection'); },
    get requests() { return messages.filter(message => message.type === 'TRANSLATE_SELECTION'); },
    message(type, extra = {}) { let response; for (const fn of listeners) fn({ type, ...extra }, {}, value => { response = value; }); return response; },
    settings(settings) { return this.message('PAGELINGO_SELECTION_SETTINGS', { settings }); },
    select(start, end = start, text = start.nodeValue, included) {
      const nodes = included || [start, end];
      const endAncestors = new Set(ancestor(end));
      const commonAncestorContainer = ancestor(start).find(node => endAncestors.has(node));
      const range = { startContainer: start, endContainer: end, startOffset: 0, endOffset: end.nodeValue?.length || 0, commonAncestorContainer,
        intersectsNode(node) { return nodes.some(selected => node === selected || node.contains(selected)); },
        comparePoint() { return 0; }, cloneRange() { return this; }, getBoundingClientRect() { return { left: 80, right: 160, top: 100, bottom: 120, width: 80, height: 20 }; } };
      selection = { anchorNode: start, focusNode: end, rangeCount: 1, isCollapsed: false, toString: () => text, getRangeAt: () => range };
    },
    collapse() { selection = { rangeCount: 0, isCollapsed: true, toString: () => '' }; document.fire('selectionchange'); },
    advance(milliseconds = 250) { time += milliseconds; for (const [id, timer] of [...timers]) if (timer.when <= time) { timers.delete(id); timer.fn(); } },
    reinject() { vm.runInContext(source, context); },
    listenerCount() { return listeners.length; }
  };
}

test('disabled by default, then translates selected text without changing original nodes or executing HTML', async () => {
  const page = harness(async () => ({ ok: true, text: '<img onerror="danger()"> 安全译文', cached: true }));
  await flush();
  const text = page.text('Original link text'); const link = page.node('a', text); page.document.body.append(page.node('p', link));
  page.select(text); page.document.fire('mouseup', { button: 0 }); page.advance(); await flush();
  assert.equal(page.requests.length, 0);
  page.settings(enabled);
  page.document.fire('mouseup', { button: 0 }); page.advance(); await flush();
  assert.equal(page.requests.length, 1); assert.equal(page.requests[0].text, 'Original link text');
  assert.equal(page.host.getAttribute('data-state'), 'complete');
  assert.equal(page.host.shadow.textContent.includes('<img onerror="danger()"> 安全译文'), true);
  assert.equal(descendants(page.host.shadow).some(node => node.tagName === 'IMG'), false);
  assert.equal(text.nodeValue, 'Original link text'); assert.equal(link.childNodes[0], text);
  assert.equal(page.host.shadow.textContent.includes('本地缓存'), true);
});

test('live disable clears pending debounce, aborts active session, removes listeners and rejects late results', async () => {
  const pending = deferred(), page = harness(() => pending.promise);
  page.settings(enabled);
  const text = page.text('Cancel selection'); page.document.body.append(page.node('p', text)); page.select(text);
  page.document.fire('selectionchange'); page.advance(100);
  page.settings({ ...enabled, selectionEnabled: false }); page.advance(300); await flush();
  assert.equal(page.requests.length, 0);
  page.settings(enabled); page.document.fire('mouseup', { button: 0 }); page.advance(250);
  assert.equal(page.requests.length, 1);
  const sessionId = page.requests[0].sessionId;
  page.settings({ ...enabled, selectionEnabled: false });
  assert.equal(page.host, undefined);
  assert.equal(page.messages.some(message => message.type === 'CANCEL_TRANSLATION' && message.sessionId === sessionId), true);
  assert.equal([...page.document.listeners.values()].every(set => !set.size), true);
  pending.resolve({ ok: true, text: '迟到译文' }); await flush();
  assert.equal(page.host, undefined); assert.equal(page.message('PAGELINGO_SELECTION_STATUS').enabled, false);
});

test('same selection is deduplicated while newer selections cancel and replace older requests', async () => {
  const one = deferred(), two = deferred();
  const page = harness(request => request.text === 'First source' ? one.promise : two.promise);
  page.settings(enabled);
  const first = page.text('First source'), second = page.text('Second source'); page.document.body.append(page.node('p', first), page.node('p', second));
  page.select(first); page.document.fire('selectionchange'); page.advance();
  page.document.fire('mouseup', { button: 0 }); page.advance();
  assert.equal(page.requests.length, 1);
  page.select(second); page.document.fire('selectionchange');
  assert.equal(page.host, undefined);
  page.advance(); assert.equal(page.requests.length, 2);
  two.resolve({ ok: true, text: '新的译文' }); await flush();
  one.resolve({ ok: true, text: '旧的译文' }); await flush();
  assert.equal(page.host.shadow.textContent.includes('新的译文'), true);
  assert.equal(page.host.shadow.textContent.includes('旧的译文'), false);
  assert.equal(first.nodeValue, 'First source'); assert.equal(second.nodeValue, 'Second source');
});

test('a paused mouse drag waits for release while keyboard selections still use debounce', async () => {
  const page = harness(); page.settings(enabled);
  const text = page.text('Wait until selection is finished'); page.document.body.append(page.node('p', text));
  page.document.fire('pointerdown', { button: 0, target: text.parentElement });
  page.select(text); page.document.fire('selectionchange'); page.advance(600); await flush();
  assert.equal(page.requests.length, 0);
  page.document.fire('pointerup', { button: 0, target: text.parentElement });
  page.document.fire('mouseup', { button: 0, target: text.parentElement });
  page.advance(250); await flush(); assert.equal(page.requests.length, 1);
  const host = page.host;
  page.window.fire('scroll', { target: host, composedPath: () => [host] });
  assert.equal(page.host, host, 'scrolling inside the result card keeps the translation open');
  page.collapse(); page.select(text); page.document.fire('selectionchange'); page.advance(250); await flush();
  assert.equal(page.requests.length, 2, 'keyboard/programmatic selections need no pointerup');
});

test('rejects editable/code endpoints and ranges crossing private forms or CSS-hidden text', async () => {
  const page = harness(); page.settings(enabled);
  const before = page.text('Before'), after = page.text('After'), privateText = page.text('Private form value'), hiddenText = page.text('Hidden paragraph');
  const form = page.node('form', page.node('label', privateText));
  const hidden = page.node('div', hiddenText); hidden.style.opacity = '0';
  const editableText = page.text('Editable content'), editable = page.node('div', editableText); editable.setAttribute('contenteditable', 'true');
  const codeText = page.text('Code content'), code = page.node('pre', codeText);
  page.document.body.append(page.node('p', before), form, hidden, editable, code, page.node('p', after));
  const reject = (start, end, text, nodes) => { page.select(start, end, text, nodes); page.document.fire('mouseup', { button: 0 }); page.advance(); };
  reject(editableText); reject(codeText);
  reject(before, after, 'Before Private form value After', [before, privateText, after]);
  reject(before, after, 'Before Hidden paragraph After', [before, hiddenText, after]);
  reject(before, before, '12345'); reject(before, before, 'a'.repeat(5001)); reject(before, before, '   ');
  await flush(); assert.equal(page.requests.length, 0); assert.equal(page.host, undefined);
});

test('errors offer retry and Escape/scroll dismiss without reopening the unchanged selection', async () => {
  let calls = 0;
  const page = harness(async () => ++calls === 1 ? { ok: false, error: '额度不足，请重试。' } : { ok: true, text: '重试成功' }); page.settings(enabled);
  const text = page.text('Retry this'); page.document.body.append(page.node('p', text)); page.select(text);
  page.document.fire('mouseup', { button: 0 }); page.advance(); await flush();
  assert.equal(page.host.getAttribute('data-state'), 'error');
  const retry = descendants(page.host.shadow).find(node => node.className === 'retry');
  assert.equal(retry.hidden, false); retry.fire('click'); await flush();
  assert.equal(page.requests.length, 2); assert.equal(page.host.getAttribute('data-state'), 'complete');
  page.document.fire('keydown', { key: 'Escape' }); assert.equal(page.host, undefined);
  page.document.fire('mouseup', { button: 0 }); page.advance(); assert.equal(page.requests.length, 2);
  page.collapse(); page.select(text); page.document.fire('selectionchange'); page.advance(); await flush();
  assert.equal(page.requests.length, 3);
  page.window.fire('scroll'); assert.equal(page.host, undefined);
});

test('card selections do not translate themselves, and reinjection never duplicates listeners', async () => {
  const page = harness(); page.settings(enabled);
  const text = page.text('One source'); page.document.body.append(page.node('p', text)); page.select(text);
  page.document.fire('mouseup', { button: 0 }); page.advance(); await flush();
  const host = page.host, resultText = descendants(host.shadow).find(node => node.nodeType === 3 && node.nodeValue === '译文：One source');
  page.select(resultText); page.document.fire('selectionchange'); page.document.fire('mouseup', { button: 0, target: host, composedPath: () => [host] }); page.advance();
  assert.equal(page.requests.length, 1); assert.equal(page.host, host);
  page.reinject(); assert.equal(page.listenerCount(), 1);
});

test('late startup settings cannot override a newer explicit disable', async () => {
  const initial = deferred(), page = harness(undefined, initial);
  page.settings({ ...enabled, selectionEnabled: false });
  initial.resolve({ ok: true, settings: enabled }); await flush();
  assert.equal(page.message('PAGELINGO_SELECTION_STATUS').enabled, false);
  const text = page.text('Still disabled'); page.document.body.append(page.node('p', text)); page.select(text);
  page.document.fire('selectionchange'); page.advance(); await flush(); assert.equal(page.requests.length, 0);
});
