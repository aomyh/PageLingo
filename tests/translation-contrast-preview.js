(() => {
  'use strict';
  const root = new URL('../', location.href), $ = id => document.getElementById(id);
  const rows = [
    { id: '01-page-light', kind: 'page', title: '浅色网页 · 黑灰原文与青蓝译文', height: 650 },
    { id: '02-page-dark', kind: 'page', dark: true, title: '深色网页 · 灰白原文与浅青蓝译文', height: 650 },
    { id: '03-selection', kind: 'selection', title: '划词翻译卡片', height: 400 },
    { id: '04-manual', kind: 'manual', title: '手动翻译浮窗', height: 640 },
  ];
  const source = 'Stay curious.\nRead a little further.\n\nDiscover a new idea.\nFind another perspective.\n\nGo beyond language.\nKeep exploring the world.';
  const translated = '保持好奇。\n多读一点，发现新想法。\n\n换一个角度，看见不同。\n跨过语言的边界。\n\n让阅读自然地继续。\n世界等你探索。';
  const longSource = 'Good ideas travel beyond language. Read a little further, follow a new thought, and discover another point of view.';
  const longTranslation = '好想法会跨越语言。多读一点，跟随一个新念头，你会发现另一种看待世界的方式，也会在熟悉的日常里找到新的可能。';
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  function installMock(kind, text, longText) {
    const roots = new WeakMap(), listeners = [], attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (options) { const value = attach.call(this, options); roots.set(this, value); return value; };
    const mock = window.__contrastMock = { roots, errors: [], calls: [], copies: [] };
    window.addEventListener('error', event => mock.errors.push(event.message));
    window.addEventListener('unhandledrejection', event => mock.errors.push(String(event.reason?.message || event.reason)));
    window.fetch = async () => { throw new Error('演示不发送网络请求'); }; window.open = () => { throw new Error('演示不打开页面'); }; window.close = () => {};
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { mock.copies.push(text); } } });
    const settings = { theme: 'midnight', ready: true, targetLanguage: 'zh-CN', displayMode: 'bilingual', concurrency: 4, batchSize: 2200, cacheEnabled: true, translateDynamic: false, selectionEnabled: true, activeProvider: 'deepseek', providerName: 'DeepSeek', model: 'deepseek-flash' };
    window.chrome = { runtime: {
      id: 'pagelingo-contrast-demo',
      onMessage: { addListener: fn => listeners.push(fn), removeListener: fn => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); } },
      async sendMessage(message) {
        mock.calls.push(structuredClone(message));
        if (message.type === 'GET_PUBLIC_SETTINGS') return { ok: true, settings: { ...settings } };
        if (message.type === 'GET_MANUAL_SETTINGS') return { ok: true, settings: { ...settings }, configurationRevision: 'contrast-demo' };
        if (message.type === 'TRANSLATE_TEXT' || message.type === 'TRANSLATE_SELECTION') return { ok: true, text, cached: true, providerId: 'deepseek', model: settings.model, targetLanguage: 'zh-CN' };
        if (message.type === 'TRANSLATE_BATCH') return { ok: true, translations: message.items.map(item => ({ id: item.id, text: item.text.trim() === longText.source ? longText.translation : ({ 'A quieter way to read.': '让阅读，更从容。', 'Stay curious.': '保持好奇。', 'The world is yours to explore.': '世界等你探索。', 'A new language is a new perspective.': '一种新的语言，一种新的视角。', 'Read a little further.': '多读一点，发现新想法。' }[item.text.trim()] || `演示译文：${item.text}`), cached: false })) };
        if (['CANCEL_TRANSLATION', 'CANCEL_TEXT_TRANSLATION'].includes(message.type)) return { ok: true };
        throw new Error(`未执行的模拟操作：${message.type}`);
      },
    } };
    mock.settings = settings;
    mock.dispatch = (type, extra = {}) => { let reply; for (const fn of listeners) fn({ type, ...extra }, {}, value => { reply = value; }); return reply; };
  }
  function documentHTML(row) {
    const kind = row.kind, background = kind !== 'page' ? '#f3f1e9' : row.dark ? '#151b23' : '#f8f9fb';
    const foreground = row.dark ? '#c4cbd4' : '#626b73', heading = row.dark ? '#e6edf3' : '#24292f';
    const style = `html,body{margin:0;width:700px;min-height:100%;background:${background};color:${foreground};font:17px/1.7 Georgia,"Times New Roman",serif}*{box-sizing:border-box}.article{max-width:700px;padding:32px 34px}.eyebrow{font:10px/1.6 -apple-system,BlinkMacSystemFont,sans-serif;letter-spacing:2px;color:#83917b}h1{font-size:27px;font-weight:400;letter-spacing:-.7px;line-height:1.35;margin:16px 0 22px;color:${heading}}p{font-size:17px;line-height:1.7;margin:20px 0;color:${foreground}}.note{font:10px/1.7 -apple-system,BlinkMacSystemFont,sans-serif;letter-spacing:.2px;color:#91a085}body.float .article{opacity:.52;padding-top:28px}body.float h1{font-size:25px}body.float p{font-size:15px;max-width:550px}`;
    const contents = kind === 'page' ? `<div class="article"><div class="eyebrow" translate="no">READING THE WORLD / DEMO</div><h1>A quieter way to read.</h1><p id="long-source">${longSource}</p><p>Stay curious.</p><p>A new language is a new perspective.</p><p>The world is yours to explore.</p><p>Read a little further.</p></div>` : `<div class="article"><div class="eyebrow" translate="no">DEMO ARTICLE</div><h1 id="selection-source">Stay curious. Read a little further.</h1><p>Good ideas travel beyond language. Discover another point of view.</p><p class="note">演示网页 · 浮窗内全部内容为模拟译文</p></div>`;
    return `<!doctype html><html><head><meta charset="utf-8"><base href="${root.href}"><style>${style}</style><script>(${installMock.toString()})(${JSON.stringify(kind)},${JSON.stringify(translated)},${JSON.stringify({ source: longSource, translation: longTranslation })});<\/script></head><body class="${kind === 'page' ? 'reading' : 'float'}">${contents}</body></html>`;
  }
  async function until(predicate, label) { const deadline = performance.now() + 8000; while (performance.now() < deadline) { if (predicate()) return; await wait(20); } throw new Error(`等待超时：${label}`); }
  async function inject(frame, path) {
    const script = frame.contentDocument.createElement('script'); script.src = new URL(`${path}?contrast=${Date.now()}-${Math.random()}`, root).href;
    await new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(new Error(`${path}加载超时`)), 8000); script.onload = () => { clearTimeout(timeout); resolve(); }; script.onerror = () => { clearTimeout(timeout); reject(new Error(`${path}加载失败`)); }; frame.contentDocument.head.append(script); });
  }
  function previousStyles(row, frame, host) {
    const doc = frame.contentDocument, style = doc.createElement('style');
    if (row.kind === 'page') {
      style.textContent = '[data-pagelingo="translation"]::before,[data-pagelingo="translation-marker"]::before{content:none!important;display:none!important}';
      doc.head.append(style);
    } else {
      const shadow = frame.contentWindow.__contrastMock.roots.get(host);
      style.textContent = '.translation-paragraph::before{content:none!important;display:none!important}';
      shadow.append(style);
    }
  }
  function centerHost(frame, host, top) {
    const rect = host.getBoundingClientRect(); host.style.setProperty('left', `${Math.round((700 - rect.width) / 2)}px`, 'important'); host.style.setProperty('top', `${top ?? Math.max(8, Math.round((frame.contentWindow.innerHeight - rect.height) / 2))}px`, 'important');
  }
  async function load(row, frame, before) {
    await new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(new Error('演示画面加载超时')), 8000); frame.addEventListener('load', () => { clearTimeout(timeout); resolve(); }, { once: true }); frame.srcdoc = documentHTML(row); });
    await inject(frame, 'lib/themes.js');
    const child = frame.contentWindow, doc = frame.contentDocument, mock = child.__contrastMock;
    let host;
    if (row.kind === 'page') {
      await inject(frame, 'content.js'); mock.dispatch('PAGELINGO_START', { settings: mock.settings });
      await until(() => mock.dispatch('PAGELINGO_STATUS')?.status?.state === 'complete', '双语正文完成');
    } else if (row.kind === 'selection') {
      await inject(frame, 'selection.js'); await until(() => mock.calls.some(call => call.type === 'GET_PUBLIC_SETTINGS'), '划词设置'); await wait(30);
      const range = doc.createRange(); range.selectNodeContents(doc.getElementById('selection-source')); const selection = child.getSelection(); selection.removeAllRanges(); selection.addRange(range); doc.dispatchEvent(new child.Event('selectionchange')); doc.dispatchEvent(new child.MouseEvent('mouseup', { bubbles: true, button: 0 }));
      await until(() => doc.querySelector('[data-pagelingo="selection"]')?.dataset.state === 'complete', '划词完成'); host = doc.querySelector('[data-pagelingo="selection"]');
    } else {
      await inject(frame, 'manual-panel.js'); await until(() => doc.querySelector('[data-pagelingo="manual"]')?.dataset.theme === 'midnight', '手动框'); host = doc.querySelector('[data-pagelingo="manual"]');
      const shadow = mock.roots.get(host), input = shadow.getElementById('manual-input'); await until(() => shadow.getElementById('manual-provider').textContent === 'DeepSeek', '读取手动设置');
      input.value = source; input.dispatchEvent(new child.Event('input', { bubbles: true })); shadow.getElementById('manual-translate').click();
      await until(() => shadow.getElementById('manual-output').textContent === translated && !shadow.getElementById('manual-copy').disabled, '手动翻译完成'); input.blur();
    }
    if (before) previousStyles(row, frame, host);
    if (host) centerHost(frame, host, row.kind === 'manual' ? 25 : undefined);
    await until(() => !doc.fonts || doc.fonts.status === 'loaded', '演示字体');
    if (mock.errors.length) throw new Error(mock.errors.join('\n'));
  }
  function colorChannels(doc, value) {
    const canvas = doc.createElement('canvas'); canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.fillStyle = value; context.fillRect(0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data];
  }
  function backgroundOf(element) {
    const path = []; let current = element;
    while (current) { path.push(current); current = current.parentElement || current.getRootNode?.().host; }
    let result = [255, 255, 255];
    for (const node of path.reverse()) {
      const value = colorChannels(node.ownerDocument, node.ownerDocument.defaultView.getComputedStyle(node).backgroundColor), alpha = value[3] / 255;
      result = value.slice(0, 3).map((channel, index) => channel * alpha + result[index] * (1 - alpha));
    }
    return result;
  }
  function contrast(first, second) {
    const luminance = values => values.slice(0, 3).map(value => { const channel = value / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    const a = luminance(first), b = luminance(second); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  }
  function renderedStyle(row, frame) {
    const doc = frame.contentDocument, child = frame.contentWindow;
    const host = row.kind !== 'page' && doc.querySelector(`[data-pagelingo="${row.kind}"]`);
    const target = row.kind === 'page' ? doc.querySelector('#long-source [data-pagelingo="translation"]') : child.__contrastMock.roots.get(host).querySelector(row.kind === 'selection' ? '.result:not(.loading):not(.error)' : '.output');
    const style = child.getComputedStyle(target), background = backgroundOf(target), color = colorChannels(doc, style.color), box = target.getBoundingClientRect();
    return { color: style.color, background: `rgb(${background.map(Math.round).join(', ')})`, contrast: Number(contrast(color, background).toFixed(3)), fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.lineHeight, opacity: style.opacity, horizontalOverflow: doc.scrollingElement.scrollWidth > 700 || box.right > 700.5 || box.left < -.5 };
  }
  async function markerEvidence(row, frame) {
    const doc = frame.contentDocument, child = frame.contentWindow, mock = child.__contrastMock;
    const host = row.kind !== 'page' && doc.querySelector(`[data-pagelingo="${row.kind}"]`), shadow = host && mock.roots.get(host);
    const outputs = row.kind === 'page' ? [...doc.querySelectorAll('[data-pagelingo="translation"]')] : [shadow.querySelector(row.kind === 'selection' ? '.result:not(.loading):not(.error)' : '.output')];
    const elements = row.kind === 'page' ? [...doc.querySelectorAll('[data-pagelingo="translation"],[data-pagelingo="translation-marker"]')] : [...outputs[0].querySelectorAll('.translation-paragraph')];
    const markers = elements.map(element => {
      const style = child.getComputedStyle(element, '::before');
      return { content: style.content, display: style.display, width: style.width, height: style.height, fontSize: style.fontSize, fontWeight: style.fontWeight, color: style.color, background: style.backgroundColor, visible: !['none', 'normal', '""', "''"].includes(style.content) && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' };
    });
    const target = row.kind === 'page' ? doc.querySelector('#long-source [data-pagelingo="translation"]') : outputs[0];
    const selection = child.getSelection(), oldRanges = Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()), range = doc.createRange();
    range.selectNodeContents(target); selection.removeAllRanges(); selection.addRange(range); const nativeSelectionText = selection.toString();
    selection.removeAllRanges(); for (const previous of oldRanges) selection.addRange(previous);
    let clipboardText = null;
    if (row.kind === 'manual') {
      const button = shadow.getElementById('manual-copy'); button.click(); await until(() => mock.copies.length > 0 && !button.disabled, '复制原始译文'); clipboardText = mock.copies.at(-1);
    }
    return { count: markers.filter(marker => marker.visible).length, markers, rawText: outputs.map(output => output.textContent), nativeSelectionText, selectionContainsMarker: nativeSelectionText.includes('译'), clipboardText, copyPreservesRawText: clipboardText === null || clipboardText === translated, rawTextHasMarker: outputs.some(output => output.textContent.includes('译')) };
  }
  async function styleEvidence() {
    const evidence = [];
    for (const row of rows) {
      const before = { ...renderedStyle(row, row.before), marker: await markerEvidence(row, row.before) }, after = { ...renderedStyle(row, row.after), marker: await markerEvidence(row, row.after) };
      const expected = row.kind === 'page' && !row.dark ? 'rgb(14, 116, 144)' : 'rgb(125, 211, 252)';
      const textEqual = JSON.stringify(before.marker.rawText) === JSON.stringify(after.marker.rawText);
      const markersValid = before.marker.count === 0 && after.marker.count > 0 && after.marker.markers.filter(marker => marker.visible).every(marker => marker.content.includes('译'));
      const copyingValid = [before, after].every(item => item.marker.nativeSelectionText.length > 0 && !item.marker.selectionContainsMarker && !item.marker.rawTextHasMarker && item.marker.copyPreservesRawText);
      evidence.push({ id: row.id, title: row.title, before, after, expected, textEqual, markersValid, copyingValid, pass: before.color === expected && after.color === expected && after.contrast >= 4.5 && !after.horizontalOverflow && markersValid && textEqual && copyingValid });
    }
    window.__translationColorEvidence = window.__translationMarkerEvidence = evidence; $('style-evidence').textContent = JSON.stringify(evidence, null, 2); return evidence;
  }
  function geometry() {
    const rect = node => { const box = node.getBoundingClientRect(); return { x: box.x + scrollX, y: box.y + scrollY, width: box.width, height: box.height }; };
    const manifest = { theme: 'midnight', variant: 'marker', cssWidth: 1440, scale: devicePixelRatio, demo: true, evidence: window.__translationMarkerEvidence, rows: rows.map(row => ({ id: row.id, title: row.title, rect: rect(row.section), frame: { before: rect(row.before), after: rect(row.after) }, before: rect(row.before), after: rect(row.after) })) };
    window.__translationContrastGeometry = manifest; $('geometry').textContent = JSON.stringify(manifest, null, 2); return manifest;
  }
  async function run() {
    document.documentElement.dataset.preview = 'loading';
    try {
      for (const row of rows) {
        row.section = document.createElement('section'); row.section.className = 'comparison'; row.section.dataset.kind = row.kind;
        const title = document.createElement('h2'); title.textContent = `${row.id.slice(0, 2)} / ${row.title}`; const columns = document.createElement('div'); columns.className = 'columns'; row.section.append(title, columns);
        for (const [key, label] of [['before', '青蓝译文'], ['after', '加标识后']]) { const column = document.createElement('div'); column.className = `column ${key}`; const heading = document.createElement('h3'); heading.textContent = label; row[key] = document.createElement('iframe'); row[key].title = `${row.title} · ${label}`; column.append(heading, row[key]); columns.append(column); }
        $('comparisons').append(row.section);
      }
      for (const [index, row] of rows.entries()) { $('status').textContent = `正在加载 ${index + 1} / 4 · ${row.title}`; await load(row, row.before, true); await load(row, row.after, false); }
      await wait(200); window.scrollTo(0, 0); const evidence = await styleEvidence(); geometry();
      if (evidence.some(row => !row.pass)) throw new Error('标识显示、原始正文、复制内容或渲染样式检查未通过，请查看下方样式证据。');
      $('status').textContent = '4 组标识对比已就绪 · 正文与复制内容保持原样 · 演示数据'; document.documentElement.dataset.preview = 'ready'; $('download').focus({ preventScroll: true });
    } catch (error) { $('status').textContent = '预览加载失败'; $('status').classList.add('error'); $('errors').textContent = error.stack || error.message; document.documentElement.dataset.preview = 'error'; }
  }
  $('download').addEventListener('click', () => { const url = URL.createObjectURL(new Blob([JSON.stringify(geometry(), null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = 'pagelingo-translation-marker-geometry.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
  void run();
})();
