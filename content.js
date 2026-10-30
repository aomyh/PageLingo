(() => {
  'use strict';

  // This script is injected on demand. Reopening the popup must not duplicate listeners.
  if (globalThis.__pageLingoInstalled) return;
  globalThis.__pageLingoInstalled = true;

  const EXCLUDED = 'script,style,noscript,pre,code,kbd,samp,svg,math,canvas,iframe,object,textarea,input,select,option,button,form,[contenteditable]:not([contenteditable="false"]),[translate="no"],[inert],[aria-hidden="true"],[data-pagelingo]';
  const MAX_RECORDS = 6000;
  const MAX_CHARACTERS = 500000;
  const records = new Set();
  const trackedNodes = new WeakMap();
  let sequence = 0;
  let epoch = 0;
  let sessionId = '';
  let settings = {};
  let themeRevision = 0;
  let latestTheme;
  let queue = [];
  let running = 0;
  let observer = null;
  let scanTimer = null;
  let pendingRoots = new Set();
  let host = null;
  let toolbar = null;
  let dismissed = false;
  let cachedCount = 0;
  let errorMessage = '';
  let limited = false;
  let state = 'idle';
  let scannedCharacters = 0;
  let queueNeedsSort = true;
  let markerGroups = new WeakMap();
  let markerStyle = null;
  const PARAGRAPH_TAGS = new Set('P LI DD DT H1 H2 H3 H4 H5 H6 BLOCKQUOTE FIGCAPTION CAPTION TD TH'.split(' '));
  window.addEventListener('scroll', () => { queueNeedsSort = true; }, { passive: true });

  function send(message) {
    return chrome.runtime.sendMessage(message);
  }

  function status() {
    const active = [...records].filter(record => !record.obsolete);
    return {
      state,
      completed: active.filter(record => record.rendered).length,
      total: active.length,
      cachedCount,
      error: errorMessage,
      displayMode: settings.displayMode || 'bilingual',
      limited
    };
  }

  function element(tag, attributes = {}, text) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function makeToolbar() {
    if (host || dismissed) return;
    host = element('div', { 'data-pagelingo': 'toolbar' });
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = element('style');
    style.textContent = `
      :host{all:initial;position:fixed;bottom:24px;right:24px;z-index:2147483647;color:var(--pl-text,#20231d);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:13px;line-height:1.4;color-scheme:var(--pl-color-scheme,light)}
      *{box-sizing:border-box}button{font:inherit;cursor:pointer}button:focus-visible{outline:2px solid var(--pl-focus,#5f8520);outline-offset:3px}
      .bar{display:flex;align-items:center;gap:12px;padding:12px 14px;background:var(--pl-surface,#fff);border:1px solid var(--pl-line,#e5e8df);border-radius:16px;box-shadow:0 8px 35px var(--pl-shadow,#17200b20);max-width:min(650px,calc(100vw - 32px))}
      .mark{width:34px;height:34px;background:var(--pl-accent,#c7ef65);color:var(--pl-accent-text,#20231d);border-radius:10px;display:grid;place-items:center;font-size:18px;font-weight:750;flex-shrink:0}.info{min-width:128px;max-width:260px}.title{font-weight:650;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.detail{font-size:11px;color:var(--pl-muted,#777e6d);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .progress{height:3px;border-radius:2px;background:var(--pl-surface-soft,#eef1e8);margin-top:7px;overflow:hidden}.fill{height:100%;background:var(--pl-accent,#95c93c);transition:width .2s}
      .actions{display:flex;align-items:center;gap:5px}.action{border:0;border-radius:8px;background:var(--pl-surface-soft,#f3f5ef);color:var(--pl-text,#424a36);padding:7px 10px;white-space:nowrap}.action:hover{background:var(--pl-surface-hover,#e9eedf)}.restore{background:var(--pl-accent,#20251c);color:var(--pl-accent-text,#fff)}.restore:hover{background:var(--pl-accent-hover,#37412c)}.close{border:0;background:transparent;font-size:20px;color:var(--pl-muted,#909687);padding:1px 5px}.retry{background:var(--pl-highlight,#fff0d6);color:var(--pl-highlight-text,#8a5e12)}[hidden]{display:none!important}
      @media(max-width:520px){:host{right:12px;bottom:12px}.bar{gap:8px;padding:10px}.mark{display:none}.info{min-width:100px;max-width:150px}.action{padding:6px 8px}.detail{max-width:140px}}
      @media(prefers-reduced-motion:reduce){.fill{transition:none}}
    `;
    const bar = element('div', { class: 'bar', role: 'region', 'aria-label': 'PageLingo 网页翻译' });
    const mark = element('div', { class: 'mark', 'aria-hidden': 'true' }, '译');
    const info = element('div', { class: 'info' });
    const title = element('div', { class: 'title', role: 'status', 'aria-live': 'polite' });
    const detail = element('div', { class: 'detail' });
    const progress = element('div', { class: 'progress', role: 'progressbar', 'aria-label': '翻译进度', 'aria-valuemin': '0', 'aria-valuemax': '100' });
    const fill = element('div', { class: 'fill' });
    progress.append(fill);
    info.append(title, detail, progress);
    const actions = element('div', { class: 'actions' });
    const retry = element('button', { class: 'action retry', type: 'button' }, '重试');
    retry.hidden = true;
    retry.addEventListener('click', retryFailed);
    const mode = element('button', { class: 'action', type: 'button', title: '切换双语对照 / 仅看译文' }, '双语');
    mode.addEventListener('click', () => setMode(settings.displayMode === 'translated' ? 'bilingual' : 'translated'));
    const restore = element('button', { class: 'action restore', type: 'button' }, '还原');
    restore.addEventListener('click', restorePage);
    const close = element('button', { class: 'close', type: 'button', title: '隐藏工具栏，保留译文', 'aria-label': '隐藏翻译工具栏' }, '×');
    close.addEventListener('click', () => {
      dismissed = true;
      host?.remove();
      host = null;
      toolbar = null;
    });
    actions.append(retry, mode, restore, close);
    bar.append(mark, info, actions);
    shadow.append(style, bar);
    document.documentElement.append(host);
    globalThis.PageLingoThemes?.applyTheme(host, settings.theme);
    toolbar = { title, detail, progress, fill, mode, retry };
  }

  function updateToolbar() {
    if (!toolbar) return;
    const current = status();
    const percent = current.total ? Math.round(current.completed / current.total * 100) : 0;
    toolbar.title.textContent = state === 'error' ? '部分内容未翻译' : state === 'translating' ? '正在翻译网页…' : current.total ? '网页翻译完成' : '没有找到可翻译的正文';
    toolbar.detail.textContent = errorMessage || (limited ? `已处理 ${current.completed} 段 · 页面较长，已达处理上限` : `${current.completed} / ${current.total} 段${cachedCount ? ` · ${cachedCount} 片段缓存` : ''}`);
    toolbar.detail.title = toolbar.detail.textContent;
    toolbar.fill.style.width = `${percent}%`;
    toolbar.progress.setAttribute('aria-valuenow', String(percent));
    toolbar.mode.textContent = settings.displayMode === 'translated' ? '仅译文' : '双语';
    toolbar.mode.setAttribute('aria-pressed', String(settings.displayMode === 'translated'));
    toolbar.retry.hidden = state !== 'error';
  }

  function isEligible(node) {
    const parent = node.parentElement;
    if (!parent || !node.isConnected || !node.nodeValue?.trim() || trackedNodes.has(node)) return false;
    const text = node.nodeValue.trim();
    if (text.length < 2 || !/\p{L}/u.test(text) || /^(?:https?:\/\/|www\.)\S+$/i.test(text)) return false;
    if (parent.closest(EXCLUDED) || parent.closest('[hidden]')) return false;
    // Older supported Chrome versions do not have checkVisibility. display:none
    // and opacity are not inherited, so checking only the text's immediate
    // parent would disclose text inside a hidden ancestor to the AI service.
    if (typeof parent.checkVisibility === 'function') {
      if (!parent.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    } else {
      for (let ancestor = parent; ancestor; ancestor = ancestor.parentElement) {
        const ancestorStyle = getComputedStyle(ancestor);
        if (ancestorStyle.display === 'none' || ancestorStyle.opacity === '0' || ancestorStyle.contentVisibility === 'hidden') return false;
      }
    }
    const style = getComputedStyle(parent);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse' && style.opacity !== '0';
  }

  function splitText(text, limit) {
    const pieces = [];
    let remaining = text;
    while (remaining.length > limit) {
      const window = remaining.slice(0, limit);
      const boundaries = [...window.matchAll(/[.!?。！？；;\n]\s*|\s+/g)];
      const last = boundaries.reverse().find(match => match.index + match[0].length >= limit * 0.45);
      let end = last ? last.index + last[0].length : limit;
      // Keep UTF-16 surrogate pairs intact, including emoji beside prose.
      if (/[\uD800-\uDBFF]/.test(remaining[end - 1]) && /[\uDC00-\uDFFF]/.test(remaining[end])) end--;
      pieces.push(remaining.slice(0, end));
      remaining = remaining.slice(end);
    }
    if (remaining) pieces.push(remaining);
    const chunks = [];
    let leading = '';
    for (const raw of pieces) {
      if (!raw.trim()) {
        if (chunks.length) chunks[chunks.length - 1].suffix += raw;
        else leading += raw;
        continue;
      }
      chunks.push({ text: raw.trim(), prefix: leading + raw.match(/^\s*/)[0], suffix: raw.match(/\s*$/)[0] });
      leading = '';
    }
    return chunks;
  }

  function addNode(node) {
    if (!isEligible(node)) return;
    if (records.size >= MAX_RECORDS || scannedCharacters + node.nodeValue.length > MAX_CHARACTERS) {
      limited = true;
      return;
    }
    scannedCharacters += node.nodeValue.length;
    const record = { node, original: node.nodeValue, rendered: false, obsolete: false, lastApplied: null, translationNode: null, pieces: [] };
    const chunkLimit = Math.min(3000, Math.max(400, Number(settings.batchSize) || 2200));
    record.pieces = splitText(record.original, chunkLimit).map(piece => ({ ...piece, id: `t${++sequence}`, record, result: null, state: 'pending', cached: false }));
    if (!record.pieces.length) return;
    records.add(record);
    trackedNodes.set(node, record);
    queue.push(...record.pieces);
    queueNeedsSort = true;
  }

  function collect(root) {
    if (!root?.isConnected) return;
    if (root.nodeType === Node.TEXT_NODE) return addNode(root);
    if (root.nodeType !== Node.ELEMENT_NODE || root.closest(EXCLUDED)) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    let visited = 0;
    // Finite scans prevent enormous documents or hostile DOMs from blocking the page.
    while ((node = walker.nextNode()) && visited++ < 60000) {
      addNode(node);
      if (limited) break;
    }
  }

  function priority(piece) {
    const parent = piece.record.node.parentElement;
    if (!parent || !piece.record.node.isConnected) return Infinity;
    const rect = parent.getBoundingClientRect();
    const viewport = window.innerHeight || 900;
    if (rect.bottom >= 0 && rect.top <= viewport) return Math.max(0, rect.top) / 10;
    return 10000 + Math.abs(rect.top - viewport / 2);
  }

  function makeBatch() {
    queue = queue.filter(piece => piece.state === 'pending' && !piece.record.obsolete && piece.record.node.isConnected);
    if (queueNeedsSort) {
      const priorities = new Map();
      for (const piece of queue) if (!priorities.has(piece.record)) priorities.set(piece.record, priority(piece));
      queue.sort((a, b) => priorities.get(a.record) - priorities.get(b.record));
      queueNeedsSort = false;
    }
    const batch = [];
    const limit = running === 0 && ![...records].some(record => record.rendered) ? Math.min(700, Number(settings.batchSize) || 2200) : Number(settings.batchSize) || 2200;
    let length = 0;
    while (queue.length && batch.length < 12) {
      const piece = queue[0];
      if (batch.length && length + piece.text.length > limit) break;
      queue.shift();
      piece.state = 'running';
      batch.push(piece);
      length += piece.text.length;
    }
    return batch;
  }

  function renderRecord(record) {
    if (record.obsolete || !record.node.isConnected || record.pieces.some(piece => piece.result === null)) return;
    if (record.node.nodeValue !== record.original && record.node.nodeValue !== record.lastApplied) {
      record.obsolete = true;
      return;
    }
    const translation = record.pieces.map(piece => piece.prefix + piece.result + piece.suffix).join('');
    record.rendered = true;
    record.translation = translation;
    applyMode(record);
  }

  function rgbColor(value) {
    const match = typeof value === 'string' && value.match(/^rgba?\(([^)]+)\)$/i);
    if (!match) return null;
    const parts = match[1].trim().split(/[\s,/]+/);
    const channels = parts.slice(0, 3).map(part => Number.parseFloat(part) * (part.endsWith('%') ? 2.55 : 1));
    const alpha = parts[3] === undefined ? 1 : Number.parseFloat(parts[3]) / (parts[3].endsWith('%') ? 100 : 1);
    if (channels.length !== 3 || !channels.every(Number.isFinite) || !Number.isFinite(alpha)) return null;
    return [...channels.map(channel => Math.min(255, Math.max(0, channel))), Math.min(1, Math.max(0, alpha))];
  }

  function luminance(channels) {
    const linear = channels.map(channel => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  }

  function translationColor(node) {
    // Read the website's own surface, independently of the extension theme.
    // Composite translucent ancestors so a transparent paragraph on a dark
    // page receives light ink rather than the light-page translation color.
    const background = [0, 0, 0];
    let remaining = 1, originalColor;
    for (let parent = node.parentElement; parent && remaining > 0.001; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      originalColor ||= rgbColor(style.color);
      const surface = rgbColor(style.backgroundColor);
      if (!surface) continue;
      const contribution = surface[3] * remaining;
      for (let index = 0; index < 3; index++) background[index] += surface[index] * contribution;
      remaining *= 1 - surface[3];
    }
    // Gradient/image-only backgrounds have no opaque computed surface. The
    // page's original ink provides a useful fallback for its light/dark intent.
    const fallback = originalColor && luminance(originalColor.slice(0, 3)) > 0.45 ? [21, 27, 35] : [255, 255, 255];
    for (let index = 0; index < 3; index++) background[index] += fallback[index] * remaining;
    const surface = luminance(background);
    const contrast = ink => (Math.max(ink, surface) + 0.05) / (Math.min(ink, surface) + 0.05);
    return contrast(luminance([14, 116, 144])) >= contrast(luminance([125, 211, 252])) ? '#0e7490' : '#7dd3fc';
  }

  function paragraphGroup(node) {
    const start = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    for (let parent = start; parent; parent = parent.parentElement) if (PARAGRAPH_TAGS.has(parent.tagName)) return parent;
    return start;
  }

  function ensureMarkerStyle() {
    if (markerStyle?.isConnected) return;
    markerStyle = element('style', { 'data-pagelingo': 'translation-style' });
    markerStyle.textContent = `
      [data-pagelingo="translation"][data-pagelingo-marker]::before,
      [data-pagelingo="translation-marker"][data-pagelingo-marker]::before{
        content:"译";display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;
        width:17px;height:17px;margin-inline-end:6px;border:0;border-radius:4px;
        background:var(--pagelingo-marker-color);color:var(--pagelingo-marker-ink);
        font:700 10px/1 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;
        vertical-align:0.08em;white-space:nowrap;user-select:none;-webkit-user-select:none;pointer-events:none;
      }
    `;
    document.documentElement.append(markerStyle);
  }

  function syncMarkerGroup(group) {
    const members = markerGroups.get(group);
    if (!members) return;
    let first;
    for (const record of [...members]) {
      if (record.obsolete || !record.node.isConnected) {
        record.translationNode?.remove(); members.delete(record); record.markerGroup = null;
        continue;
      }
      if (!record.translationNode?.isConnected) continue;
      if (!first || (first.node.compareDocumentPosition(record.node) & Node.DOCUMENT_POSITION_PRECEDING)) first = record;
    }
    for (const record of members) {
      if (record === first) record.translationNode.setAttribute('data-pagelingo-marker', '');
      else record.translationNode?.removeAttribute('data-pagelingo-marker');
    }
  }

  function attachMarker(record) {
    const group = paragraphGroup(record.node);
    if (record.markerGroup !== group) {
      const previous = record.markerGroup;
      if (previous) { markerGroups.get(previous)?.delete(record); syncMarkerGroup(previous); }
      record.markerGroup = group;
      if (!markerGroups.has(group)) markerGroups.set(group, new Set());
      markerGroups.get(group).add(record);
    }
    syncMarkerGroup(group);
  }

  function removeTranslation(record) {
    record.translationNode?.remove();
    const group = record.markerGroup;
    if (group) { markerGroups.get(group)?.delete(record); record.markerGroup = null; syncMarkerGroup(group); }
  }

  function applyMode(record) {
    if (!record.rendered) return;
    if (record.obsolete || !record.node.isConnected) { removeTranslation(record); return; }
    if (record.node.nodeValue !== record.original && record.node.nodeValue !== record.lastApplied) {
      record.obsolete = true;
      removeTranslation(record);
      return;
    }
    ensureMarkerStyle();
    record.translationNode ||= element('span', { lang: settings.targetLanguage || 'zh-CN' });
    const color = translationColor(record.node);
    const markerColors = `--pagelingo-marker-color:${color};--pagelingo-marker-ink:${color === '#0e7490' ? '#fff' : '#10232f'};`;
    if (settings.displayMode === 'translated') {
      record.lastApplied = record.translation;
      record.node.nodeValue = record.translation;
      record.translationNode.textContent = '';
      record.translationNode.setAttribute('data-pagelingo', 'translation-marker');
      record.translationNode.setAttribute('aria-hidden', 'true');
      record.translationNode.style.cssText = `${markerColors}display:inline;font-size:inherit;line-height:inherit;`;
      record.node.parentNode.insertBefore(record.translationNode, record.node);
    } else {
      record.node.nodeValue = record.original;
      record.lastApplied = record.original;
      record.translationNode.setAttribute('data-pagelingo', 'translation');
      record.translationNode.removeAttribute('aria-hidden');
      record.translationNode.textContent = record.translation.trim();
      const long = record.original.trim().length > 65;
      record.translationNode.style.cssText = `${markerColors}display:${long ? 'block' : 'inline'};${long ? 'margin:0.45em 0 0.6em;padding:0.3em 0.7em;border-left:3px solid color-mix(in srgb,currentColor 55%,transparent);border-radius:0 6px 6px 0;background:color-mix(in srgb,currentColor 4%,transparent);' : 'margin-left:0.45em;'}color:${color};opacity:1;font-size:1em;line-height:1.8;overflow-wrap:anywhere;font-style:normal;`;
      record.node.parentNode.insertBefore(record.translationNode, record.node.nextSibling);
    }
    attachMarker(record);
  }

  function setMode(mode) {
    settings.displayMode = mode === 'translated' ? 'translated' : 'bilingual';
    for (const record of records) applyMode(record);
    updateToolbar();
  }

  function settleState() {
    if (running || queue.some(piece => piece.state === 'pending')) {
      state = 'translating';
    } else {
      const failed = [...records].some(record => !record.obsolete && record.pieces.some(piece => piece.state === 'failed'));
      state = failed ? 'error' : 'complete';
      if (!failed) errorMessage = '';
    }
    updateToolbar();
  }

  function pump(myEpoch = epoch) {
    if (myEpoch !== epoch || !sessionId) return;
    const concurrency = Math.min(8, Math.max(1, Number(settings.concurrency) || 4));
    while (running < concurrency) {
      const batch = makeBatch();
      if (!batch.length) break;
      running++;
      void translateBatch(batch, myEpoch);
    }
    settleState();
  }

  async function translateBatch(batch, myEpoch) {
    try {
      const response = await send({ type: 'TRANSLATE_BATCH', sessionId, targetLanguage: settings.targetLanguage, items: batch.map(piece => ({ id: piece.id, text: piece.text })) });
      if (myEpoch !== epoch) return;
      if (!response?.ok) throw new Error(response?.error || '翻译请求失败，请检查模型配置后重试。');
      const results = new Map((response.translations || []).map(item => [String(item.id), item]));
      for (const piece of batch) {
        const result = results.get(piece.id);
        if (!result || typeof result.text !== 'string' || !result.text.trim()) {
          piece.state = 'failed';
          errorMessage = '模型返回的译文不完整，请重试。';
          continue;
        }
        piece.result = result.text.trim();
        piece.cached = Boolean(result.cached);
        piece.state = 'complete';
        if (piece.cached) cachedCount++;
        renderRecord(piece.record);
      }
    } catch (error) {
      if (myEpoch !== epoch) return;
      for (const piece of batch) piece.state = 'failed';
      errorMessage = error?.message || '连接失败，请检查网络和服务商设置。';
      // A rejected key or inaccessible endpoint would otherwise be retried on every batch.
      // Keep pending work available for the toolbar's explicit retry action.
      for (const piece of queue) if (piece.state === 'pending') piece.state = 'failed';
      queue = [];
    } finally {
      if (myEpoch === epoch) {
        running--;
        pump(myEpoch);
      }
    }
  }

  function retryFailed() {
    if (!records.size) {
      void start();
      return;
    }
    errorMessage = '';
    for (const record of records) {
      if (!record.obsolete && record.node.isConnected) {
        for (const piece of record.pieces) {
          if (piece.state === 'failed') {
            piece.state = 'pending';
            queue.push(piece);
          }
        }
      }
    }
    pump();
  }

  function watchDynamic(myEpoch) {
    if (!settings.translateDynamic || !document.body) return;
    observer = new MutationObserver(mutations => {
      if (myEpoch !== epoch) return;
      const affectedGroups = new Set();
      for (const mutation of mutations) {
        if (mutation.target.parentElement?.closest('[data-pagelingo]') || mutation.target.closest?.('[data-pagelingo]')) continue;
        if (mutation.type === 'characterData') {
          const record = trackedNodes.get(mutation.target);
          if (record && mutation.target.nodeValue === record.lastApplied) continue;
          if (record) {
            record.obsolete = true;
            removeTranslation(record);
            trackedNodes.delete(mutation.target);
          }
          pendingRoots.add(mutation.target);
        } else {
          affectedGroups.add(paragraphGroup(mutation.target));
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.ELEMENT_NODE) pendingRoots.add(node);
            if (pendingRoots.size > 100) break;
          }
        }
      }
      for (const group of affectedGroups) syncMarkerGroup(group);
      if (!pendingRoots.size || scanTimer) return;
      scanTimer = setTimeout(() => {
        scanTimer = null;
        if (myEpoch !== epoch) return;
        const roots = [...pendingRoots];
        pendingRoots.clear();
        for (const root of roots) collect(root);
        if (queue.length) pump(myEpoch);
      }, 300);
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  }

  function restorePage() {
    epoch++;
    const oldSession = sessionId;
    sessionId = '';
    observer?.disconnect();
    observer = null;
    clearTimeout(scanTimer);
    scanTimer = null;
    pendingRoots.clear();
    for (const record of records) {
      record.translationNode?.remove();
      if (record.node.isConnected && record.lastApplied !== null && record.node.nodeValue === record.lastApplied) record.node.nodeValue = record.original;
      trackedNodes.delete(record.node);
    }
    records.clear();
    markerGroups = new WeakMap();
    markerStyle?.remove();
    markerStyle = null;
    queue = [];
    running = 0;
    cachedCount = 0;
    scannedCharacters = 0;
    errorMessage = '';
    limited = false;
    state = 'idle';
    host?.remove();
    host = null;
    toolbar = null;
    dismissed = false;
    if (oldSession) void send({ type: 'CANCEL_TRANSLATION', sessionId: oldSession }).catch(() => {});
  }

  async function start(nextSettings) {
    restorePage();
    const myEpoch = epoch;
    const myThemeRevision = themeRevision;
    if (!nextSettings) {
      try {
        const response = await send({ type: 'GET_PUBLIC_SETTINGS' });
        if (myEpoch !== epoch) return;
        if (!response?.ok) throw new Error(response?.error || '无法读取翻译配置。');
        nextSettings = response.settings;
      } catch (error) {
        state = 'error';
        errorMessage = error.message;
        makeToolbar();
        updateToolbar();
        return;
      }
    }
    settings = { ...nextSettings };
    if (myThemeRevision !== themeRevision) settings.theme = latestTheme;
    sessionId = `pagelingo-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    makeToolbar();
    if (settings.ready === false) {
      state = 'error';
      errorMessage = '请先在 PageLingo 设置中配置 API Key 和模型。';
      updateToolbar();
      return;
    }
    state = 'translating';
    collect(document.body || document.documentElement);
    watchDynamic(myEpoch);
    pump(myEpoch);
  }

  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (!message || typeof message.type !== 'string') return;
    switch (message.type) {
      case 'PAGELINGO_THEME_CHANGED':
        themeRevision++;
        latestTheme = message.theme;
        settings.theme = latestTheme;
        if (host) globalThis.PageLingoThemes?.applyTheme(host, latestTheme);
        respond({ ok: true });
        break;
      case 'PAGELINGO_START':
        void start(message.settings);
        respond({ ok: true, status: status() });
        break;
      case 'PAGELINGO_RESTORE':
        restorePage();
        respond({ ok: true, status: status() });
        break;
      case 'PAGELINGO_STATUS':
        respond({ ok: true, status: status() });
        break;
      case 'PAGELINGO_MODE':
        setMode(message.mode);
        respond({ ok: true, status: status() });
        break;
    }
  });
})();
