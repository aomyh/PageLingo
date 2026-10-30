(() => {
  'use strict';

  if (globalThis.__pageLingoSelectionInstalled) return;
  globalThis.__pageLingoSelectionInstalled = true;

  const EXCLUDED = 'script,style,noscript,pre,code,kbd,samp,svg,math,canvas,iframe,object,textarea,input,select,option,button,form,[contenteditable]:not([contenteditable="false"]),[translate="no"],[inert],[aria-hidden="true"],[data-pagelingo]';
  const MAX_TEXT = 5000;
  const DEBOUNCE = 250;
  const nodeIds = new WeakMap();
  const languageNames = { 'zh-CN': '简体中文', 'zh-TW': '繁體中文', en: 'English', ja: '日本語', ko: '한국어', fr: 'Français', de: 'Deutsch', es: 'Español', ru: 'Русский', pt: 'Português', it: 'Italiano', ar: 'العربية' };
  let nextNodeId = 0;
  let settings = { selectionEnabled: false, targetLanguage: 'zh-CN', providerName: 'AI', ready: false };
  let revision = 0;
  let epoch = 0;
  let listening = false;
  let pointerSelecting = false;
  let timer = null;
  let host = null;
  let shadow = null;
  let card = null;
  let active = null;
  let lastKey = '';

  function send(message) { return chrome.runtime.sendMessage(message); }
  function element(tag, attributes = {}, text) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function ownNode(node) {
    return Boolean(node && (node === host || host?.contains(node) || shadow?.contains(node)));
  }
  function ownEvent(event) { return Boolean(host && (event.composedPath?.().includes(host) || ownNode(event.target))); }
  function ownSelection(selection) { return ownNode(selection?.anchorNode) || ownNode(selection?.focusNode); }
  function id(node) {
    if (!nodeIds.has(node)) nodeIds.set(node, ++nextNodeId);
    return nodeIds.get(node);
  }
  function rawSelection() {
    const selection = window.getSelection();
    if (!selection || ownSelection(selection)) return null;
    if (selection.isCollapsed || selection.rangeCount !== 1) return { invalid: true };
    const text = selection.toString().trim();
    if (!text || text.length > MAX_TEXT || !/\p{L}/u.test(text)) return { invalid: true };
    const range = selection.getRangeAt(0);
    const key = [text, settings.targetLanguage, id(range.startContainer), range.startOffset, id(range.endContainer), range.endOffset].join('|');
    return { text, range, key };
  }
  function visible(elementNode) {
    if (!elementNode || !elementNode.isConnected || elementNode.closest(EXCLUDED) || elementNode.closest('[hidden]')) return false;
    if (typeof elementNode.checkVisibility === 'function' && !elementNode.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    for (let ancestor = elementNode; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0' || style.contentVisibility === 'hidden') return false;
    }
    return true;
  }
  function parentElement(node) { return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement; }
  function snapshot() {
    const candidate = rawSelection();
    if (!candidate || candidate.invalid) return null;
    const { range } = candidate;
    if (!visible(parentElement(range.startContainer)) || !visible(parentElement(range.endContainer))) return null;
    const root = parentElement(range.commonAncestorContainer);
    if (!root || !visible(root)) return null;
    try {
      // Checking both endpoints alone would allow a range crossing a form or hidden
      // element to send that intermediate private text to the model.
      for (const excluded of root.querySelectorAll(`${EXCLUDED},[hidden]`)) if (range.intersectsNode(excluded)) return null;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node;
      let selectedNodes = 0;
      while ((node = walker.nextNode())) {
        if (range.comparePoint?.(node, 0) === 1 && node !== range.endContainer) break;
        if (!range.intersectsNode(node)) continue;
        if (++selectedNodes > 1500 || !visible(node.parentElement)) return null;
      }
      const rect = range.getBoundingClientRect();
      if (!rect || (!rect.width && !rect.height) || rect.bottom < 0 || rect.top > window.innerHeight) return null;
      return { ...candidate, range: range.cloneRange(), rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } };
    } catch { return null; }
  }

  function dismiss() {
    epoch++;
    clearTimeout(timer);
    timer = null;
    const sessionId = active?.sessionId;
    active = null;
    host?.remove();
    host = null;
    shadow = null;
    card = null;
    if (sessionId) void send({ type: 'CANCEL_TRANSLATION', sessionId }).catch(() => {});
  }
  function place(rect) {
    if (!host || !card) return;
    const width = Math.min(360, Math.max(0, window.innerWidth - 24));
    host.style.width = `${width}px`;
    const height = card.box.getBoundingClientRect().height || 180;
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    const below = rect.bottom + 10;
    const top = below + height <= window.innerHeight - 12 ? below : Math.max(12, rect.top - height - 10);
    host.style.left = `${left}px`;
    host.style.top = `${top}px`;
  }
  function createCard(selection) {
    host = element('div', { 'data-pagelingo': 'selection', 'data-state': 'loading' });
    shadow = host.attachShadow({ mode: 'closed' });
    const style = element('style');
    style.textContent = `
      :host{all:initial;position:fixed;z-index:2147483647;display:block;width:min(360px,calc(100vw - 24px));font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;font-size:13px;line-height:1.6;color:#283020;color-scheme:light}
      *{box-sizing:border-box}.card{border:1px solid #dfe6d5;border-radius:14px;background:#fff;box-shadow:0 12px 45px #1d2c132b;overflow:hidden}.head{display:flex;align-items:center;gap:8px;padding:12px 14px 9px}.mark{display:grid;place-items:center;width:25px;height:25px;flex-shrink:0;border-radius:8px;background:#c7ef65;color:#354524;font-size:13px;font-weight:700}.title{font-size:11px;font-weight:650;flex:1}.close{border:0;background:none;color:#99a18e;font-size:21px;line-height:1;padding:4px;cursor:pointer}.source{font-size:11px;color:#8f9982;white-space:pre-wrap;overflow-wrap:anywhere;max-height:57px;overflow:auto;margin:0 15px 10px;padding-bottom:9px;border-bottom:1px solid #edf0e7}.result{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;line-height:1.75;padding:0 15px 13px;max-height:min(280px,45vh);overflow:auto;user-select:text}.result.loading{color:#8c9b77}.result.error{color:#aa694e}.foot{display:flex;align-items:center;justify-content:space-between;gap:8px;background:#f8faf4;border-top:1px solid #edf0e7;padding:8px 14px;font-size:9px;color:#97a186}.meta{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.retry{font:inherit;font-size:10px;color:#698441;background:#edf4df;border:0;border-radius:5px;padding:4px 9px;cursor:pointer}button:focus-visible{outline:2px solid #7b9a4c;outline-offset:2px}[hidden]{display:none!important}
    `;
    const box = element('div', { class: 'card', role: 'dialog', 'aria-label': 'PageLingo 划词翻译' });
    const head = element('div', { class: 'head' });
    const close = element('button', { class: 'close', type: 'button', 'aria-label': '关闭划词翻译', title: '关闭（Esc）' }, '×');
    close.addEventListener('pointerdown', event => event.preventDefault());
    close.addEventListener('click', dismiss);
    head.append(element('span', { class: 'mark', 'aria-hidden': 'true' }, '译'), element('span', { class: 'title' }, 'PageLingo · 划词翻译'), close);
    const source = element('div', { class: 'source' }, selection.text);
    const result = element('div', { class: 'result loading', role: 'status', 'aria-live': 'polite' }, '正在翻译所选文字…');
    const foot = element('div', { class: 'foot' });
    const meta = element('span', { class: 'meta' }, `${settings.providerName || 'AI'} · ${languageNames[settings.targetLanguage] || settings.targetLanguage}`);
    const retry = element('button', { class: 'retry', type: 'button' }, '重试');
    retry.hidden = true;
    retry.addEventListener('pointerdown', event => event.preventDefault());
    retry.addEventListener('click', () => { const selected = snapshot(); if (selected) void translate(selected); else dismiss(); });
    foot.append(meta, retry);
    box.append(head, source, result, foot);
    shadow.append(style, box);
    document.documentElement.append(host);
    card = { box, result, retry, meta };
    place(selection.rect);
  }
  async function translate(selection) {
    dismiss();
    if (!settings.selectionEnabled) return;
    const myEpoch = epoch;
    const sessionId = `selection-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    active = { ...selection, sessionId, state: 'loading' };
    lastKey = selection.key;
    createCard(selection);
    try {
      if (!settings.ready) throw new Error('请先在 PageLingo 中配置 API Key 和模型。');
      const response = await send({ type: 'TRANSLATE_SELECTION', text: selection.text, sessionId, targetLanguage: settings.targetLanguage });
      if (myEpoch !== epoch || !settings.selectionEnabled || !active) return;
      if (!response?.ok) throw new Error(response?.error || '划词翻译失败，请重试。');
      if (typeof response.text !== 'string' || !response.text.trim()) throw new Error('模型未返回有效译文，请重试。');
      active.state = 'complete';
      host.setAttribute('data-state', 'complete');
      card.result.className = 'result';
      card.result.textContent = response.text;
      if (response.cached) card.meta.textContent += ' · 本地缓存';
      place(selection.rect);
    } catch (error) {
      if (myEpoch !== epoch || !settings.selectionEnabled || !active) return;
      active.state = 'error';
      host.setAttribute('data-state', 'error');
      card.result.className = 'result error';
      card.result.textContent = error?.message || '划词翻译失败，请检查配置后重试。';
      card.retry.hidden = false;
      place(selection.rect);
    }
  }
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (!settings.selectionEnabled) return;
      const selected = snapshot();
      if (!selected || selected.key === lastKey) return;
      void translate(selected);
    }, DEBOUNCE);
  }
  function selectionChanged() {
    if (!settings.selectionEnabled) return;
    const candidate = rawSelection();
    // Selection within our closed shadow root is intentional interaction with the
    // translation card, rather than new source text to send to the model.
    if (!candidate) return;
    if (candidate.invalid) { dismiss(); lastKey = ''; return; }
    if (active && candidate.key !== active.key) dismiss();
    if (candidate.key !== lastKey) lastKey = '';
    if (!pointerSelecting) schedule();
  }
  function selectionEnded(event) {
    pointerSelecting = false;
    if (ownEvent(event) || (event.button !== undefined && event.button !== 0)) return;
    schedule();
  }
  function pointerDown(event) {
    if (ownEvent(event)) return;
    dismiss();
    pointerSelecting = event.button === undefined || event.button === 0;
  }
  function pointerCanceled() { pointerSelecting = false; dismiss(); }
  function keyDown(event) { if (event.key === 'Escape') dismiss(); }
  function moved(event) { if (!ownEvent(event)) dismiss(); }

  function setListening(enabled) {
    if (enabled === listening) return;
    listening = enabled;
    if (!enabled) pointerSelecting = false;
    const method = enabled ? 'addEventListener' : 'removeEventListener';
    document[method]('selectionchange', selectionChanged);
    document[method]('pointerup', selectionEnded);
    document[method]('mouseup', selectionEnded);
    document[method]('pointerdown', pointerDown, true);
    document[method]('pointercancel', pointerCanceled, true);
    document[method]('keydown', keyDown, true);
    window[method]('scroll', moved, true);
    window[method]('resize', moved);
  }
  function applySettings(next) {
    const previous = settings;
    settings = { ...settings, ...next, selectionEnabled: next?.selectionEnabled === true };
    const changed = ['selectionEnabled', 'targetLanguage', 'providerName', 'model', 'ready'].some(key => previous[key] !== settings[key]);
    if (changed) { dismiss(); lastKey = ''; }
    setListening(settings.selectionEnabled);
  }

  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type === 'PAGELINGO_SELECTION_SETTINGS') {
      revision++;
      applySettings(message.settings || {});
      respond({ ok: true, enabled: settings.selectionEnabled });
    } else if (message?.type === 'PAGELINGO_SELECTION_STATUS') {
      respond({ ok: true, enabled: settings.selectionEnabled, state: active?.state || 'idle' });
    }
  });
  const initialRevision = revision;
  void send({ type: 'GET_PUBLIC_SETTINGS' }).then(response => {
    if (response?.ok && revision === initialRevision) applySettings(response.settings || {});
  }).catch(() => {});
})();
