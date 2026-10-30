import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../content.js', import.meta.url), 'utf8');
const excludedTags = new Set('SCRIPT STYLE NOSCRIPT PRE CODE KBD SAMP SVG MATH CANVAS IFRAME OBJECT TEXTAREA INPUT SELECT OPTION BUTTON FORM'.split(' '));

// A small deterministic DOM harness exercises the injected script and its public messages.
// It deliberately retains node identity, so flattening inline markup fails these tests.
class FakeNode {
  constructor(type, tag, value = '') {
    this.nodeType = type;
    this.tagName = tag?.toUpperCase();
    this.nodeValue = type === 3 ? value : null;
    this.parentNode = null;
    this.childNodes = [];
    this.attributes = new Map();
    this.style = {};
    this.listeners = new Map();
    this.top = 10;
  }
  get parentElement() { return this.parentNode?.nodeType === 1 ? this.parentNode : null; }
  get isConnected() { return this.nodeType === 9 || Boolean(this.parentNode?.isConnected); }
  get nextSibling() { const siblings = this.parentNode?.childNodes || []; return siblings[siblings.indexOf(this) + 1] || null; }
  get textContent() { return this.nodeType === 3 ? this.nodeValue : this.childNodes.map(node => node.textContent).join(''); }
  set textContent(value) {
    if (this.nodeType === 3) { this.nodeValue = String(value); return; }
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    if (String(value)) this.append(new FakeNode(3, null, String(value)));
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  append(...nodes) { for (const node of nodes) { node.remove(); node.parentNode = this; this.childNodes.push(node); } }
  insertBefore(node, before) {
    node.remove();
    const index = before ? this.childNodes.indexOf(before) : this.childNodes.length;
    node.parentNode = this;
    this.childNodes.splice(index < 0 ? this.childNodes.length : index, 0, node);
  }
  remove() {
    if (!this.parentNode) return;
    const siblings = this.parentNode.childNodes;
    siblings.splice(siblings.indexOf(this), 1);
    this.parentNode = null;
  }
  closest(selector) {
    for (let node = this; node?.nodeType === 1; node = node.parentElement) {
      if (selector === '[hidden]' && node.attributes.has('hidden')) return node;
      if (selector === '[data-pagelingo]' && node.attributes.has('data-pagelingo')) return node;
      if (selector.includes('script,style') && (excludedTags.has(node.tagName) || node.attributes.has('data-pagelingo') || node.getAttribute('translate') === 'no' || node.getAttribute('aria-hidden') === 'true' || node.attributes.has('inert') || (node.attributes.has('contenteditable') && node.getAttribute('contenteditable') !== 'false'))) return node;
    }
    return null;
  }
  checkVisibility() {
    for (let node = this; node; node = node.parentElement) if (node.attributes.has('hidden') || node.style.display === 'none') return false;
    return true;
  }
  getBoundingClientRect() { return { top: this.top, bottom: this.top + 30 }; }
  compareDocumentPosition(other) {
    if (this === other) return 0;
    let root = this; while (root.parentNode) root = root.parentNode;
    const nodes = allNodes(root), first = nodes.indexOf(this), second = nodes.indexOf(other);
    return second < 0 ? 1 : second < first ? 2 : 4;
  }
  attachShadow() { this.shadow = new FakeNode(11); this.shadow.parentNode = this; return this.shadow; }
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function harness(translate) {
  const document = new FakeNode(9);
  document.documentElement = new FakeNode(1, 'html');
  document.body = new FakeNode(1, 'body');
  document.append(document.documentElement);
  document.documentElement.append(document.body);
  document.createElement = tag => new FakeNode(1, tag);
  document.createTreeWalker = root => {
    const texts = [];
    function walk(node) { for (const child of node.childNodes) { if (child.nodeType === 3) texts.push(child); else walk(child); } }
    walk(root);
    let index = 0;
    return { nextNode: () => texts[index++] || null };
  };
  let listener;
  const messages = [];
  let mutationCallback;
  const context = vm.createContext({
    document,
    window: { innerHeight: 900, addEventListener() {} },
    Node: { TEXT_NODE: 3, ELEMENT_NODE: 1, DOCUMENT_POSITION_PRECEDING: 2 },
    NodeFilter: { SHOW_TEXT: 4 },
    getComputedStyle: node => ({ display: node.style.display || 'block', visibility: node.style.visibility || 'visible', opacity: node.style.opacity || '1', contentVisibility: node.style.contentVisibility || 'visible', backgroundColor: node.style.backgroundColor || 'rgba(0, 0, 0, 0)', color: node.style.color || 'rgb(32, 32, 32)' }),
    MutationObserver: class { constructor(callback) { mutationCallback = callback; } observe() {} disconnect() {} },
    chrome: { runtime: {
      onMessage: { addListener(callback) { listener = callback; } },
      sendMessage(message) {
        messages.push(message);
        if (message.type === 'TRANSLATE_BATCH') return translate(message);
        if (message.type === 'GET_PUBLIC_SETTINGS') return Promise.resolve({ ok: true, settings: defaults });
        return Promise.resolve({ ok: true });
      }
    } },
    setTimeout, clearTimeout, console
  });
  vm.runInContext(source, context);
  return {
    document, messages,
    text: value => new FakeNode(3, null, value),
    node(tag, ...children) { const node = new FakeNode(1, tag); node.append(...children); return node; },
    message(type, extra = {}) { let result; listener({ type, ...extra }, {}, value => { result = value; }); return result; },
    mutation(mutations) { mutationCallback?.(mutations); },
    reinject() { vm.runInContext(source, context); }
  };
}

const defaults = { targetLanguage: 'zh-CN', displayMode: 'bilingual', concurrency: 4, batchSize: 2200, translateDynamic: false, ready: true };
const automatic = async message => ({ ok: true, translations: [...message.items].reverse().map(item => ({ id: item.id, text: `译：${item.text}`, cached: false })) });
const flush = () => new Promise(resolve => setImmediate(resolve));
function allNodes(root) { return [root, ...root.childNodes.flatMap(allNodes)]; }

test('translation ink adapts to the website surface while preserving its original colors and content', async () => {
  const cases = [
    { name: 'light page with gray text', background: 'rgb(248, 249, 251)', text: 'rgb(98, 107, 115)', ink: '#0e7490' },
    { name: 'dark page with gray text', background: 'rgb(21, 27, 35)', text: 'rgb(196, 203, 212)', ink: '#7dd3fc' },
    { name: 'transparent paragraph over a dark body', body: 'rgb(21, 27, 35)', text: 'rgb(196, 203, 212)', ink: '#7dd3fc' },
    { name: 'translucent surface over a dark body', body: 'rgb(21, 27, 35)', background: 'rgba(255, 255, 255, 0.08)', text: 'rgb(196, 203, 212)', ink: '#7dd3fc' },
    { name: 'image-only dark page uses existing light ink as fallback', text: 'rgb(230, 237, 243)', ink: '#7dd3fc' },
    { name: 'opaque light surface wins over inherited light ink', background: 'rgb(255, 255, 255)', text: 'rgb(230, 237, 243)', ink: '#0e7490' },
  ];
  for (const example of cases) {
    const page = harness(automatic), original = page.text('The translated paragraph should be distinct from the original gray website text.');
    const paragraph = page.node('p', original);
    paragraph.style.color = example.text;
    if (example.background) paragraph.style.backgroundColor = example.background;
    if (example.body) page.document.body.style.backgroundColor = example.body;
    const originalStyle = { ...paragraph.style };
    page.document.body.append(paragraph);
    page.message('PAGELINGO_START', { settings: { ...defaults, theme: 'midnight' } });
    await flush();
    const translation = allNodes(paragraph).find(node => node.getAttribute('data-pagelingo') === 'translation');
    assert.ok(translation, example.name);
    assert.equal(translation.style.cssText.match(/(?:^|;)color:([^;]+);/)?.[1], example.ink, example.name);
    assert.deepEqual(paragraph.style, originalStyle, 'translation colors must stay scoped to the inserted text');
    assert.equal(original.nodeValue, 'The translated paragraph should be distinct from the original gray website text.');
    page.message('PAGELINGO_RESTORE');
    assert.deepEqual(paragraph.childNodes, [original]);
  }
});

test('bilingual and translated modes preserve links, whitespace and original node identities; restore is exact', async () => {
  const page = harness(automatic);
  const hello = page.text(' Hello ');
  const world = page.text('world');
  const anchor = page.node('a', world);
  anchor.setAttribute('href', '/documentation');
  const ending = page.text('!');
  const paragraph = page.node('p', hello, anchor, ending);
  page.document.body.append(paragraph);
  const response = page.message('PAGELINGO_START', { settings: defaults });
  assert.equal(response.ok, true);
  assert.equal(response.status.state, 'translating');
  await flush();
  assert.equal(page.message('PAGELINGO_STATUS').status.state, 'complete');
  assert.equal(page.message('PAGELINGO_STATUS').status.completed, 2);
  assert.equal(hello.nodeValue, ' Hello ');
  assert.equal(world.nodeValue, 'world');
  assert.equal(anchor.parentNode, paragraph);
  assert.equal(anchor.childNodes[0], world);
  assert.equal(allNodes(paragraph).filter(node => node.getAttribute('data-pagelingo') === 'translation').length, 2);
  page.message('PAGELINGO_MODE', { mode: 'translated' });
  assert.equal(hello.nodeValue, ' 译：Hello ');
  assert.equal(world.nodeValue, '译：world');
  assert.equal(anchor.getAttribute('href'), '/documentation');
  assert.equal(allNodes(paragraph).filter(node => node.getAttribute('data-pagelingo') === 'translation').length, 0);
  page.message('PAGELINGO_RESTORE');
  assert.deepEqual(paragraph.childNodes, [hello, anchor, ending]);
  assert.deepEqual(anchor.childNodes, [world]);
  assert.equal(paragraph.textContent, ' Hello world!');
  assert.equal(page.message('PAGELINGO_STATUS').status.state, 'idle');
});

test('one marker per paragraph follows source order across out-of-order replies and mode changes', async () => {
  const pending = [];
  const page = harness(request => {
    const value = deferred(); pending.push({ request, ...value }); return value.promise;
  });
  const first = page.text('First fragment '.repeat(35)), second = page.text('Linked fragment '.repeat(35));
  const link = page.node('a', second), paragraph = page.node('p', first, link);
  const otherText = page.text('A separate paragraph.'), other = page.node('p', otherText);
  page.document.body.append(paragraph, other);
  page.message('PAGELINGO_START', { settings: defaults });
  assert.equal(pending.length, 2);
  const complete = entry => entry.resolve({ ok: true, translations: entry.request.items.map(item => ({ id: item.id, text: `Result for ${item.id}`, cached: false })) });
  const markers = node => allNodes(node).filter(child => child.getAttribute('data-pagelingo-marker') !== null);
  complete(pending[1]); await flush();
  assert.equal(markers(paragraph).length, 1);
  assert.equal(markers(paragraph)[0].parentNode, link, 'a later fragment can be marked while the earlier one is pending');
  complete(pending[0]); await flush();
  assert.equal(markers(paragraph).length, 1);
  assert.equal(markers(paragraph)[0], first.nextSibling, 'the marker moves to the first source fragment in document order');
  assert.equal(markers(other).length, 1, 'another paragraph has its own marker');
  assert.equal(paragraph.textContent.includes('译'), false, 'generated badges are not part of the selectable DOM text');
  page.message('PAGELINGO_MODE', { mode: 'translated' });
  assert.equal(markers(paragraph).length, 1);
  assert.equal(markers(paragraph)[0].textContent, '', 'translation-only markers are empty decorative nodes');
  assert.equal(first.parentNode, paragraph); assert.equal(second.parentNode, link);
  page.message('PAGELINGO_MODE', { mode: 'bilingual' });
  assert.equal(markers(paragraph).length, 1);
  page.message('PAGELINGO_RESTORE');
  assert.deepEqual(paragraph.childNodes, [first, link]); assert.deepEqual(link.childNodes, [second]);
  assert.deepEqual(other.childNodes, [otherText]);
  assert.equal(allNodes(page.document.documentElement).some(node => node.getAttribute('data-pagelingo') === 'translation-style'), false);
});

test('removing the marked source reassigns its paragraph badge without leaving an orphan translation', async () => {
  const page = harness(automatic), first = page.text('First source fragment.'), second = page.text('Linked source fragment.');
  const link = page.node('a', second), paragraph = page.node('p', first, link);
  page.document.body.append(paragraph);
  page.message('PAGELINGO_START', { settings: { ...defaults, translateDynamic: true } }); await flush();
  const oldTranslation = first.nextSibling;
  assert.equal(oldTranslation.getAttribute('data-pagelingo-marker'), '');
  first.remove();
  page.mutation([{ type: 'childList', target: paragraph, addedNodes: [], removedNodes: [first] }]);
  assert.equal(oldTranslation.isConnected, false);
  assert.equal(second.nextSibling.getAttribute('data-pagelingo-marker'), '');
  assert.equal(allNodes(paragraph).filter(node => node.getAttribute('data-pagelingo-marker') !== null).length, 1);
  page.message('PAGELINGO_RESTORE');
  assert.deepEqual(paragraph.childNodes, [link], 'restoring does not bring back source text removed by the website');
  assert.deepEqual(link.childNodes, [second]);
});

test('late model responses cannot insert translations after restore or overwrite newly changed page text', async () => {
  const request = deferred();
  const page = harness(() => request.promise);
  const text = page.text('Keep this text.');
  page.document.body.append(page.node('p', text));
  page.message('PAGELINGO_START', { settings: defaults });
  const batch = page.messages.find(message => message.type === 'TRANSLATE_BATCH');
  page.message('PAGELINGO_RESTORE');
  text.nodeValue = 'Updated by the website.';
  request.resolve({ ok: true, translations: batch.items.map(item => ({ id: item.id, text: '旧译文' })) });
  await flush();
  assert.equal(text.nodeValue, 'Updated by the website.');
  assert.equal(allNodes(page.document.body).filter(node => node.getAttribute('data-pagelingo') === 'translation').length, 0);
  assert.equal(page.message('PAGELINGO_STATUS').status.state, 'idle');
  assert.ok(page.messages.some(message => message.type === 'CANCEL_TRANSLATION'));
});

test('skips forms, code, hidden content and translate=no; viewport content is scheduled first', async () => {
  const requests = [];
  const page = harness(message => { requests.push(message); return automatic(message); });
  const offscreen = page.node('p', page.text('Below the fold '.repeat(40)));
  offscreen.top = 4000;
  const visible = page.node('p', page.text('Visible article heading'));
  page.document.body.append(offscreen, page.node('form', page.node('label', page.text('Private form content'))), page.node('code', page.text('Secret code content')));
  const hidden = page.node('div', page.node('p', page.text('Hidden content')));
  hidden.setAttribute('hidden', '');
  const excluded = page.node('p', page.text('Do not translate'));
  excluded.setAttribute('translate', 'no');
  page.document.body.append(hidden, excluded, visible);
  page.message('PAGELINGO_START', { settings: defaults });
  await flush();
  assert.equal(requests[0].items[0].text, 'Visible article heading');
  const sent = requests.flatMap(request => request.items.map(item => item.text)).join('\n');
  assert.ok(!sent.includes('Private'));
  assert.ok(!sent.includes('Secret'));
  assert.ok(!sent.includes('Hidden'));
  assert.ok(!sent.includes('Do not translate'));
  assert.equal(page.message('PAGELINGO_STATUS').status.total, 2);
});

test('older Chrome without checkVisibility never sends text inside CSS-hidden ancestors', async () => {
  const requests = [];
  const page = harness(message => { requests.push(message); return automatic(message); });
  for (const [property, value] of [['display', 'none'], ['opacity', '0'], ['contentVisibility', 'hidden']]) {
    const paragraph = page.node('p', page.text(`Private ancestor content: ${property}`));
    paragraph.checkVisibility = undefined;
    const section = page.node('section', paragraph);
    section.style[property] = value;
    page.document.body.append(section);
  }
  const visible = page.node('p', page.text('Visible public article'));
  visible.checkVisibility = undefined;
  page.document.body.append(visible);
  page.message('PAGELINGO_START', { settings: defaults });
  await flush();
  const sent = requests.flatMap(request => request.items.map(item => item.text));
  assert.deepEqual(sent, ['Visible public article']);
  assert.equal(page.message('PAGELINGO_STATUS').status.total, 1);
});

test('concurrency is bounded, results render incrementally, and incomplete model output stays retryable', async () => {
  const requests = [];
  const page = harness(message => { const pending = deferred(); requests.push({ ...pending, message }); return pending.promise; });
  for (let index = 0; index < 14; index++) page.document.body.append(page.node('p', page.text(`Paragraph ${index} ` + 'a'.repeat(480))));
  page.message('PAGELINGO_START', { settings: { ...defaults, concurrency: 2, batchSize: 1200 } });
  assert.equal(requests.length, 2);
  requests[1].resolve(await automatic(requests[1].message));
  await flush();
  assert.equal(requests.length, 3);
  const partial = page.message('PAGELINGO_STATUS').status;
  assert.ok(partial.completed > 0 && partial.completed < partial.total);
  assert.equal(partial.state, 'translating');
  requests[0].resolve({ ok: true, translations: [] });
  await flush();
  for (let index = 2; index < requests.length; index++) {
    requests[index].resolve(await automatic(requests[index].message));
    await flush();
  }
  const final = page.message('PAGELINGO_STATUS').status;
  assert.equal(final.state, 'error');
  assert.ok(final.completed < final.total);
  assert.match(final.error, /不完整/);
});

test('dynamic content is translated once; reinjection does not reset an existing translation session', async () => {
  const page = harness(automatic);
  const paragraph = page.node('p', page.text('Initial paragraph'));
  page.document.body.append(paragraph);
  page.message('PAGELINGO_START', { settings: { ...defaults, translateDynamic: true } });
  await flush();
  page.reinject();
  assert.equal(page.message('PAGELINGO_STATUS').status.completed, 1);
  const additional = page.node('p', page.text('A newly loaded paragraph'));
  page.document.body.append(additional);
  page.mutation([{ type: 'childList', target: page.document.body, addedNodes: [additional] }]);
  await new Promise(resolve => setTimeout(resolve, 330));
  await flush();
  assert.equal(page.message('PAGELINGO_STATUS').status.completed, 2);
  assert.equal(page.messages.filter(message => message.type === 'TRANSLATE_BATCH').flatMap(message => message.items).filter(item => item.text === 'A newly loaded paragraph').length, 1);
  page.message('PAGELINGO_RESTORE');
});

test('very long text splits into bounded requests without corrupting emoji or original spacing', async () => {
  const page = harness(async message => ({ ok: true, translations: message.items.map(item => ({ id: item.id, text: item.text, cached: true })) }));
  const original = ' '.repeat(2500) + 'A long article. '.repeat(240) + ' '.repeat(3000) + 'A final paragraph 😀 with emoji.';
  const node = page.text(original);
  page.document.body.append(page.node('p', node));
  page.message('PAGELINGO_START', { settings: { ...defaults, displayMode: 'translated', batchSize: 500 } });
  for (let index = 0; index < 30; index++) await flush();
  assert.equal(page.message('PAGELINGO_STATUS').status.state, 'complete');
  assert.equal(node.nodeValue, original);
  const items = page.messages.filter(message => message.type === 'TRANSLATE_BATCH').flatMap(message => message.items);
  assert.ok(items.length > 5);
  assert.ok(items.every(item => item.text.length <= 500));
  assert.ok(items.every(item => !/[\uD800-\uDBFF]$/.test(item.text) && !/^[\uDC00-\uDFFF]/.test(item.text)));
  page.message('PAGELINGO_RESTORE');
  assert.equal(node.nodeValue, original);
});
