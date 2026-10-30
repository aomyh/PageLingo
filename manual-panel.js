(() => {
  'use strict';

  const existing = globalThis.__pageLingoManualPanel;
  if (existing?.show) { existing.show(); return; }

  const LIMIT = 5000;
  const available = Boolean(globalThis.chrome?.runtime?.id && typeof chrome.runtime.sendMessage === 'function');
  const languages = [['zh-CN', '简体中文'], ['zh-TW', '繁體中文'], ['en', 'English'], ['ja', '日本語'], ['ko', '한국어'], ['fr', 'Français'], ['de', 'Deutsch'], ['es', 'Español'], ['ru', 'Русский'], ['pt', 'Português'], ['it', 'Italiano'], ['ar', 'العربية']];
  const previousFocus = document.activeElement;
  const host = document.createElement('div');
  host.setAttribute('data-pagelingo', 'manual');
  host.setAttribute('translate', 'no');
  host.setAttribute('lang', 'zh-CN');
  host.setAttribute('dir', 'ltr');
  const shadow = host.attachShadow({ mode: 'closed' });
  const $ = id => shadow.getElementById(id);
  const node = (tag, attributes = {}, text) => {
    const result = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) result.setAttribute(name, value);
    if (text !== undefined) result.textContent = text;
    return result;
  };
  const style = node('style');
  style.textContent = `
    :host{all:initial;display:block;position:fixed;z-index:2147483647;inset:auto;margin:0;padding:0;border:0;background:transparent;box-sizing:border-box;overflow:visible;color:#283020;color-scheme:light;font:13px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
    :host::backdrop{background:transparent;pointer-events:none}*{box-sizing:border-box}button,textarea,select{font:inherit}button{cursor:pointer}button:disabled{cursor:default}[hidden]{display:none!important}button:focus-visible,select:focus-visible,textarea:focus-visible,.output:focus-visible{outline:2px solid #7a9f43;outline-offset:2px}
    .card{position:relative;display:flex;flex-direction:column;width:100%;height:100%;min-width:0;min-height:0;border:1px solid #dce4d1;border-radius:14px;background:#fafbf8;box-shadow:0 18px 65px #1a2c1738;overflow:hidden}
    .head{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:53px;padding:12px 16px;background:#f4f7ee;border-bottom:1px solid #e3ead8;cursor:move;touch-action:none;user-select:none}.brand{display:flex;align-items:center;gap:8px;color:#283020;font-size:15px;font-weight:750;letter-spacing:-.3px}.mark{display:grid;place-items:center;width:27px;height:27px;border-radius:8px;background:#c7ef65;color:#31461d;font-size:19px;font-weight:750}.brand-dot{color:#89a94e}.head-label{font-size:10px;font-weight:400;color:#95a083;letter-spacing:0;margin-left:7px}.close{display:grid;place-items:center;flex-shrink:0;width:28px;height:28px;border:0;border-radius:7px;background:transparent;color:#98a18a;font-size:23px;line-height:1}.close:hover{background:#e8efdd;color:#536c39}
    .body{display:flex;flex-direction:column;flex:1;min-height:0;gap:12px;padding:15px 17px 12px;overflow:auto}.intro{flex-shrink:0}.intro h1{font-size:18px;font-weight:650;letter-spacing:-.4px;line-height:1.4;margin:0 0 4px}.intro h1 span{color:#8cab50}.intro p{font-size:10px;color:#98a18c;margin:0}
    .configuration{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-shrink:0;min-width:0}.provider{display:flex;align-items:center;gap:6px;max-width:52%;min-width:0;padding:0;border:0;background:none;text-align:left;color:#62764c}.provider-dot{height:6px;width:6px;border-radius:50%;background:#bbc4af;flex-shrink:0}.provider.ready .provider-dot{background:#8bb34e}.provider-copy{display:flex;flex-direction:column;gap:2px;min-width:0}.provider strong{font-size:10px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.provider-copy>span{font-size:9px;color:#a0ac90;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.provider-arrow{font-size:11px;color:#96a581}.language{display:flex;align-items:center;gap:7px;flex-shrink:0}.language label{font-size:10px;color:#9ba68e}.language-select{position:relative;display:flex;width:116px;flex-shrink:0}.language select{appearance:none;-webkit-appearance:none;width:100%;height:32px;padding:5px 36px 5px 12px;border:1px solid #e1e7d7;border-radius:7px;background:#fff;color:#566b40;font-size:10px;cursor:pointer}.language-chevron{position:absolute;right:calc(12px + 1px);top:50%;transform:translateY(-50%);width:12px;height:12px;color:#6e7b5d;pointer-events:none}
    .panel{display:flex;flex-direction:column;min-height:86px;min-width:0;border:1px solid #e1e7d8;border-radius:9px;background:#fff;overflow:hidden;flex:1}.panel-head{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:35px;padding:8px 11px 6px;flex-shrink:0}.panel-head label,.panel-head h2{font-size:10px;font-weight:600;color:#62754d;margin:0;white-space:nowrap}.panel-head label>span,.panel-head h2>span{font-size:8px;font-weight:400;color:#a5b296;margin-left:4px}.panel-head h2>span.stale{color:#ad8658}.tools{display:flex;align-items:center;gap:9px}.count{font-size:8px;color:#a9b59b;white-space:nowrap;font-variant-numeric:tabular-nums}.count.exceeded{color:#b47450}.text-button{border:0;padding:0;background:none;color:#90a078;font-size:9px;white-space:nowrap}.text-button:hover:not(:disabled){color:#4b692f}.text-button:disabled{color:#c2cbb6}
    textarea{display:block;width:100%;min-height:0;flex:1;resize:none;border:0;background:none;padding:1px 11px 10px;color:#435435;font-size:12px;line-height:1.8;outline-offset:-3px;overflow-y:auto}textarea::placeholder{font-size:11px;color:#b4bfaa}.actions{display:flex;gap:8px;align-items:center;flex-shrink:0}.translate{display:flex;align-items:center;justify-content:center;gap:8px;flex:1;min-width:0;height:37px;padding:0 13px;border:0;border-radius:8px;background:#c7ef65;color:#354b22;font-size:11px;font-weight:600}.translate:hover:not(:disabled){background:#bce55a}.translate:disabled{background:#e7eddd;color:#9eac8d}.shortcut{margin-left:auto;font-weight:400;font-size:8px;opacity:.6}.cancel{height:37px;padding:0 11px;border:1px solid #e2e8d7;border-radius:8px;background:#eef2e7;color:#7f9169;font-size:10px}.result{background:#f5f8ef;border-color:#e3ebd8}.output{white-space:pre-wrap;overflow-wrap:anywhere;word-break:normal;flex:1;min-height:0;padding:1px 11px 10px;overflow-y:auto;user-select:text;color:#486236;font-size:12px;line-height:1.8}.output[data-empty=true]{color:#b0bda2;font-size:11px}.output[aria-busy=true]{opacity:.6}
    .foot{display:flex;flex-direction:column;gap:3px;min-height:29px;flex-shrink:0;padding-right:11px}.status{font-size:9px;line-height:1.6;color:#91a07e;margin:0;overflow-wrap:anywhere}.status.error{color:#ad7855}.hint{font-size:8px;line-height:1.6;color:#b1bca3}.resize{position:absolute;right:0;bottom:0;width:23px;height:23px;border:0;background:transparent;color:#a0b385;cursor:nwse-resize;touch-action:none;font-size:15px;padding:0}.resize:hover{color:#597a35}.compact .intro p{display:none}.compact .body{gap:9px;padding-top:11px}.compact .intro h1{font-size:16px}.compact .panel{min-height:75px}
    @media(forced-colors:active){.card,.panel{border:1px solid CanvasText}.mark{border:1px solid CanvasText}.provider-dot{background:CanvasText}.language select{appearance:auto;-webkit-appearance:auto;padding-right:12px}.language-chevron{display:none}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
  `;
  const card = node('section', { class: 'card', role: 'dialog', 'aria-label': 'PageLingo 手动翻译', 'aria-modal': 'false' });
  const head = node('header', { class: 'head', id: 'manual-drag-handle', title: '拖动此处移动浮窗' });
  const brand = node('div', { class: 'brand' });
  const brandWord = node('span', {}, 'PageLingo');
  brandWord.append(node('span', { class: 'brand-dot' }, '.'));
  brand.append(node('span', { class: 'mark', 'aria-hidden': 'true' }, 'P'), brandWord, node('span', { class: 'head-label' }, '手动翻译'));
  head.append(brand, node('button', { id: 'manual-close', class: 'close', type: 'button', title: '关闭手动翻译浮窗', 'aria-label': '关闭翻译浮窗' }, '×'));
  const body = node('div', { class: 'body' });
  const intro = node('div', { class: 'intro' });
  const title = node('h1', {}, '想读懂的，放在这里'); title.append(node('span', {}, '。'));
  intro.append(title, node('p', {}, '粘贴文字即可翻译，继续阅读当前网页。'));
  const configuration = node('section', { class: 'configuration', 'aria-label': '翻译配置' });
  const provider = node('button', { id: 'manual-settings', class: 'provider', type: 'button', title: '配置 AI 服务商' });
  const providerCopy = node('span', { class: 'provider-copy' });
  providerCopy.append(node('strong', { id: 'manual-provider' }, '读取配置中…'), node('span', { id: 'manual-model' }));
  provider.append(node('span', { class: 'provider-dot', 'aria-hidden': 'true' }), providerCopy, node('span', { class: 'provider-arrow', 'aria-hidden': 'true' }, '↗'));
  const language = node('div', { class: 'language' });
  const select = node('select', { id: 'manual-language', 'aria-label': '手动翻译目标语言' });
  for (const [code, name] of languages) select.append(node('option', { value: code }, name));
  const selectWrap = node('div', { class: 'language-select' });
  const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [name, value] of Object.entries({ class: 'language-chevron', viewBox: '0 0 12 12', 'aria-hidden': 'true', focusable: 'false' })) chevron.setAttribute(name, value);
  const chevronPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  chevronPath.setAttribute('fill', 'currentColor');
  chevronPath.setAttribute('d', 'M1.06 3.94 6 8.88l4.94-4.94L12 5l-6 6-6-6z');
  chevron.append(chevronPath); selectWrap.append(select, chevron);
  language.append(node('label', { for: 'manual-language' }, '翻译为'), selectWrap);
  configuration.append(provider, language);
  const inputPanel = node('section', { class: 'panel', 'aria-labelledby': 'manual-input-label' });
  const inputHead = node('div', { class: 'panel-head' });
  const inputLabel = node('label', { id: 'manual-input-label', for: 'manual-input' }, '原文');
  inputLabel.append(node('span', {}, '自动识别语言'));
  const tools = node('div', { class: 'tools' });
  tools.append(node('span', { id: 'manual-count', class: 'count', 'aria-live': 'polite', 'aria-atomic': 'true' }, '0 / 5,000'), node('button', { id: 'manual-clear', class: 'text-button', type: 'button', disabled: '' }, '清空'));
  inputHead.append(inputLabel, tools);
  inputPanel.append(inputHead, node('textarea', { id: 'manual-input', dir: 'auto', placeholder: '输入或粘贴需要翻译的内容…', 'aria-describedby': 'manual-count', spellcheck: 'false', autocomplete: 'off' }));
  const actions = node('div', { class: 'actions' });
  const translateButton = node('button', { id: 'manual-translate', class: 'translate', type: 'button', disabled: '' });
  translateButton.append(node('span', {}, '翻译文本'), node('span', { class: 'shortcut', 'aria-hidden': 'true' }, '⌘ / Ctrl ↵'));
  actions.append(translateButton, node('button', { id: 'manual-cancel', class: 'cancel', type: 'button', hidden: '' }, '停止翻译'));
  const outputPanel = node('section', { class: 'panel result', 'aria-labelledby': 'manual-output-label' });
  const outputHead = node('div', { class: 'panel-head' });
  const outputTitle = node('h2', { id: 'manual-output-label' }, '译文'); outputTitle.append(node('span', { id: 'manual-result-note' }));
  outputHead.append(outputTitle, node('button', { id: 'manual-copy', class: 'text-button', type: 'button', disabled: '' }, '复制'));
  outputPanel.append(outputHead, node('div', { id: 'manual-output', class: 'output', tabindex: '0', dir: 'auto', 'aria-busy': 'false', 'data-empty': 'true' }, '译文会显示在这里'));
  const foot = node('div', { class: 'foot' });
  foot.append(node('p', { id: 'manual-status', class: 'status', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }, '文字直达当前 AI 服务，输入不会保存为草稿。'), node('span', { class: 'hint' }, '拖动标题栏可移动 · 点击外部、滚动和 Esc 不会关闭'));
  body.append(intro, configuration, inputPanel, actions, outputPanel, foot);
  const resize = node('button', { id: 'manual-resize-handle', class: 'resize', type: 'button', title: '拖动调整浮窗大小', 'aria-label': '调整翻译浮窗大小' }, '◢');
  card.append(head, body, resize); shadow.append(style, card);

  let settings = null, revision = '', settingsEpoch = 0;
  let active = null, result = null, copying = false, closed = false, languageEdited = false, languageInitialized = false;
  let sequence = 0, gesture = null, refreshTimer;
  const bounds = { left: 0, top: 0, width: 420, height: 590 };
  const send = message => chrome.runtime.sendMessage(message);
  const sourceText = () => $('manual-input').value.trim();
  const inputLength = () => [...$('manual-input').value].length;
  function status(text, error = false) { $('manual-status').textContent = text; $('manual-status').classList.toggle('error', error); }
  function stale() {
    return Boolean(result && (result.source !== sourceText() || result.language !== select.value || result.revision !== revision
      || result.providerId !== settings?.activeProvider || result.model !== settings?.model));
  }
  function render() {
    const count = inputLength(), pending = Boolean(active), outdated = stale();
    $('manual-count').textContent = `${count.toLocaleString('zh-CN')} / 5,000`;
    $('manual-count').classList.toggle('exceeded', count > LIMIT); $('manual-input').setAttribute('aria-invalid', String(count > LIMIT));
    $('manual-clear').disabled = !$('manual-input').value && !result;
    translateButton.disabled = !available || !settings?.ready || !sourceText() || count > LIMIT || pending;
    translateButton.querySelector('span').textContent = pending ? '正在翻译…' : '翻译文本';
    $('manual-cancel').hidden = !pending; $('manual-output').setAttribute('aria-busy', String(pending));
    $('manual-copy').disabled = !result || outdated || pending || copying;
    $('manual-result-note').textContent = outdated ? result.revision !== revision ? '服务已更新，请重新翻译' : '内容已修改，请重新翻译' : pending ? '正在等待模型' : result?.cached ? '已复用本地缓存' : '';
    $('manual-result-note').classList.toggle('stale', outdated);
  }
  function cancelRequest(message = '') {
    const previous = active; active = null;
    if (previous && available) { try { void send({ type: 'CANCEL_TEXT_TRANSLATION', requestId: previous.id }).catch(() => {}); } catch {} }
    if (message) status(message); render();
  }
  async function refreshSettings({ keepPreparing = null } = {}) {
    const epoch = ++settingsEpoch;
    if (!available) {
      settings = { targetLanguage: 'zh-CN', activeProvider: 'preview', providerName: '未配置', model: '加载扩展后可用', ready: false };
      revision = 'preview';
    } else {
      try {
        const response = await send({ type: 'GET_MANUAL_SETTINGS' });
        if (epoch !== settingsEpoch || closed) return false;
        if (!response?.ok || !response.settings) throw new Error(response?.error || '无法读取翻译配置，请重试。');
        const next = response.settings, nextRevision = String(response.configurationRevision ?? next.configurationRevision ?? '');
        const changed = settings && (revision !== nextRevision || settings.activeProvider !== next.activeProvider || settings.model !== next.model);
        settings = next; revision = nextRevision;
        if (changed && !(active === keepPreparing && active?.phase === 'preparing')) cancelRequest('翻译服务已更新，请重新翻译当前内容。');
      } catch (error) {
        if (epoch === settingsEpoch && !closed) status(error?.message || '无法读取翻译配置，请重新打开浮窗重试。', true);
        return false;
      }
    }
    if (closed) return false;
    if (!languageInitialized) { if (!languageEdited) select.value = languages.some(([code]) => code === settings.targetLanguage) ? settings.targetLanguage : 'zh-CN'; languageInitialized = true; }
    $('manual-provider').textContent = settings.ready ? settings.providerName || 'AI 翻译' : available ? '先配置 AI 服务' : '界面预览';
    $('manual-model').textContent = settings.model || '请选择翻译模型'; provider.classList.toggle('ready', settings.ready === true);
    if (!available) status('界面预览不会发送内容。加载扩展后即可翻译。');
    else if (!settings.ready && !active) status('请先在扩展配置页填写 API Key 和模型。');
    render(); return true;
  }
  function changed() {
    const wasPending = Boolean(active); cancelRequest();
    if (inputLength() > LIMIT) status('单次最多翻译 5,000 个字符，请缩短内容后重试。', true);
    else if (!available) status('界面预览不会发送内容。加载扩展后即可翻译。');
    else if (wasPending) status('内容已修改，已停止上一条翻译。');
    else if (stale()) status('原文或目标语言已改变，请重新翻译。');
    else status('文字直达当前 AI 服务，输入不会保存为草稿。');
  }
  async function translate() {
    if (closed || active) return;
    if (!available) { status('这是界面预览。加载 Chrome 扩展后即可翻译。'); return; }
    const source = sourceText(), language = select.value;
    if (!source) { status('请输入需要翻译的内容。'); $('manual-input').focus({ preventScroll: true }); return; }
    if (inputLength() > LIMIT) { status('单次最多翻译 5,000 个字符，请缩短内容后重试。', true); return; }
    const request = { id: `manual-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${++sequence}`}`, source, language, phase: 'preparing', revision, started: performance.now() };
    active = request; status('正在翻译，可继续阅读当前网页。'); render();
    try {
      const fresh = await refreshSettings({ keepPreparing: request });
      if (active !== request || closed) return;
      if (!fresh) throw new Error('无法读取最新翻译配置，请重试。');
      if (!settings?.ready) throw new Error('请先在配置页填写 API Key 和模型。');
      request.revision = revision; request.phase = 'network';
      const response = await send({ type: 'TRANSLATE_TEXT', requestId: request.id, text: request.source, targetLanguage: request.language });
      if (active !== request || closed) return;
      if (!response?.ok) throw new Error(response?.error || '翻译失败，请重试。');
      if (typeof response.text !== 'string' || !response.text.trim()) throw new Error('模型未返回有效译文，请重试。');
      if (!await refreshSettings() || active !== request || closed) return;
      if (request.revision !== revision) { cancelRequest('翻译服务已更新，请重新翻译。'); return; }
      result = { source: request.source, language: request.language, revision: request.revision, text: response.text, cached: response.cached === true,
        providerId: response.providerId || settings.activeProvider, model: response.model || settings.model };
      $('manual-output').textContent = result.text; $('manual-output').dataset.empty = 'false'; $('manual-output').scrollTop = 0;
      status(result.cached ? '翻译完成 · 已复用本地缓存。' : `翻译完成 · 耗时 ${((performance.now() - request.started) / 1000).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} 秒。`);
    } catch (error) { if (active === request && !closed) status(error?.message || '翻译失败，请重试。', true); }
    finally { if (active === request) { active = null; render(); } }
  }
  async function copyResult() {
    if (!result || stale() || active || copying || closed) return;
    const copiedResult = result; copying = true; render();
    try {
      await navigator.clipboard.writeText(copiedResult.text);
      if (!closed && result === copiedResult && !stale()) status('译文已复制。');
    } catch {
      if (!closed) {
        const selection = shadow.getSelection?.() || window.getSelection();
        const range = document.createRange(); range.selectNodeContents($('manual-output')); selection?.removeAllRanges(); selection?.addRange(range);
        $('manual-output').focus({ preventScroll: true }); status('无法自动复制，已选中译文，请按 ⌘C 或 Ctrl+C。', true);
      }
    } finally { copying = false; if (!closed) render(); }
  }
  function place() {
    const margin = 8, width = Math.max(1, window.innerWidth), height = Math.max(1, window.innerHeight);
    const maxWidth = Math.max(1, width - margin * 2), maxHeight = Math.max(1, height - margin * 2);
    bounds.width = Math.min(Math.max(Math.min(320, maxWidth), bounds.width), maxWidth);
    bounds.height = Math.min(Math.max(Math.min(410, maxHeight), bounds.height), maxHeight);
    bounds.left = Math.max(Math.min(margin, width - bounds.width), Math.min(bounds.left, width - bounds.width - margin));
    bounds.top = Math.max(Math.min(margin, height - bounds.height), Math.min(bounds.top, height - bounds.height - margin));
    for (const [property, value] of Object.entries({ left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height })) host.style.setProperty(property, `${value}px`, 'important');
    card.classList.toggle('compact', bounds.height < 525);
  }
  function move(event) {
    if (!gesture || event.pointerId !== gesture.id) return;
    if (gesture.kind === 'drag') { bounds.left = gesture.left + event.clientX - gesture.x; bounds.top = gesture.top + event.clientY - gesture.y; }
    else { bounds.width = gesture.width + event.clientX - gesture.x; bounds.height = gesture.height + event.clientY - gesture.y; }
    place(); event.preventDefault();
  }
  function end(event) { if (gesture && event.pointerId === gesture.id) gesture = null; }
  function begin(event, kind) {
    if (event.button !== 0 || (kind === 'drag' && event.target.closest?.('button,select,textarea,input,a'))) return;
    gesture = { kind, id: event.pointerId, x: event.clientX, y: event.clientY, ...bounds };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Mouse movement still works while the pointer stays over its handle. */ }
    event.preventDefault(); event.stopPropagation();
  }
  function show() {
    if (closed) return;
    if (!host.isConnected) document.documentElement.append(host);
    try {
      if (typeof host.showPopover === 'function') { if (!host.matches(':popover-open')) host.showPopover(); }
      else host.removeAttribute('popover');
    } catch { host.removeAttribute('popover'); /* Embedded browsers may expose an unsupported popover implementation. */ }
    place(); $('manual-input').focus({ preventScroll: true }); void refreshSettings();
  }
  function close() {
    if (closed) return;
    closed = true; ++settingsEpoch; clearTimeout(refreshTimer); cancelRequest();
    window.removeEventListener('resize', place); window.removeEventListener('focus', onFocus); window.removeEventListener('pagehide', onPageHide);
    host.remove(); if (globalThis.__pageLingoManualPanel === controller) delete globalThis.__pageLingoManualPanel;
    if (previousFocus?.isConnected && typeof previousFocus.focus === 'function') previousFocus.focus({ preventScroll: true });
  }
  function onFocus() { if (!closed) { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => { void refreshSettings(); }, 50); } }
  function onPageHide() { close(); }
  $('manual-input').addEventListener('input', changed);
  select.addEventListener('change', () => { languageEdited = true; changed(); });
  $('manual-input').addEventListener('keydown', event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing) { event.preventDefault(); void translate(); } });
  shadow.addEventListener('keydown', event => event.stopPropagation());
  shadow.addEventListener('keyup', event => event.stopPropagation());
  shadow.addEventListener('pointerdown', event => event.stopPropagation());
  shadow.addEventListener('click', event => event.stopPropagation());
  translateButton.addEventListener('click', translate);
  $('manual-cancel').addEventListener('click', () => cancelRequest('已停止翻译。内容已保留，可修改后重试。'));
  $('manual-clear').addEventListener('click', () => { cancelRequest(); result = null; $('manual-input').value = ''; $('manual-output').textContent = '译文会显示在这里'; $('manual-output').dataset.empty = 'true'; changed(); render(); $('manual-input').focus({ preventScroll: true }); });
  $('manual-copy').addEventListener('click', copyResult);
  $('manual-close').addEventListener('click', close);
  provider.addEventListener('click', async () => {
    if (!available) { status('界面预览无法打开扩展配置，请加载扩展后使用。'); return; }
    try { const response = await send({ type: 'MANUAL_OPEN_OPTIONS' }); if (!response?.ok) throw new Error(response?.error || '无法打开配置页，请从扩展菜单进入配置。'); }
    catch (error) { status(error?.message || '无法打开配置页，请重试。', true); }
  });
  for (const [handle, kind] of [[head, 'drag'], [resize, 'resize']]) {
    handle.addEventListener('pointerdown', event => begin(event, kind));
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end); handle.addEventListener('lostpointercapture', end);
  }
  resize.addEventListener('keydown', event => {
    const directions = { ArrowRight: [16, 0], ArrowLeft: [-16, 0], ArrowDown: [0, 16], ArrowUp: [0, -16] };
    if (!directions[event.key]) return; const [x, y] = directions[event.key]; bounds.width += x; bounds.height += y; place(); event.preventDefault();
  });
  host.setAttribute('popover', 'manual');
  // Inline important geometry protects the host from broad page selectors; the
  // closed shadow holds input and results outside the page's normal DOM APIs.
  for (const [property, value] of Object.entries({ display: 'block', position: 'fixed', margin: '0', padding: '0', border: '0', background: 'transparent', 'z-index': '2147483647', overflow: 'visible', 'font-family': '-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif', 'font-size': '13px', 'line-height': '1.6', color: '#283020', 'color-scheme': 'light', 'box-sizing': 'border-box' })) host.style.setProperty(property, value, 'important');
  bounds.left = Math.max(8, window.innerWidth - bounds.width - 24); bounds.top = Math.max(8, Math.min(80, window.innerHeight - bounds.height - 16));
  window.addEventListener('resize', place); window.addEventListener('focus', onFocus); window.addEventListener('pagehide', onPageHide);
  const controller = { show, close };
  globalThis.__pageLingoManualPanel = controller;
  show(); render();
})();
