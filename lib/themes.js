(() => {
  'use strict';
  if (globalThis.PageLingoThemes) return;

  const definitions = [
    { id: 'sage', name: '草木绿', description: '熟悉的浅绿与留白，轻松阅读。', scheme: 'light', colors: {
      canvas: '#fafbf8', surface: '#ffffff', 'surface-soft': '#f0f3e9', 'surface-hover': '#e9efdf',
      text: '#283020', muted: '#647158', subtle: '#647158', line: '#dfe6d5',
      accent: '#c7ef65', 'accent-hover': '#b8e34e', 'accent-text': '#2c3919',
      highlight: '#edf4df', 'highlight-line': '#c4d6a5', 'highlight-text': '#506832',
      success: '#547a2c', danger: '#a34631', 'danger-bg': '#fff0e9', 'danger-line': '#e7bca9',
      focus: '#6d932d', shadow: '#1d2c132b', 'inverse-surface': '#2f3c24', 'inverse-text': '#f4f9ec',
      'disabled-bg': '#e6eddb', 'disabled-text': '#7a886c',
    } },
    { id: 'ocean', name: '海盐蓝', description: '清透蓝调，像海风一样清爽。', scheme: 'light', colors: {
      canvas: '#f4f8fc', surface: '#ffffff', 'surface-soft': '#eaf2fa', 'surface-hover': '#dcebf8',
      text: '#1f3448', muted: '#526b81', subtle: '#526b81', line: '#d8e3ee',
      accent: '#b2dcff', 'accent-hover': '#93cdfc', 'accent-text': '#163d61',
      highlight: '#e5f1fc', 'highlight-line': '#b6d5ee', 'highlight-text': '#315d81',
      success: '#26716e', danger: '#a7453b', 'danger-bg': '#fff0ec', 'danger-line': '#e8bdb5',
      focus: '#367bb6', shadow: '#163d6126', 'inverse-surface': '#203e59', 'inverse-text': '#f1f8ff',
      'disabled-bg': '#e0eaf3', 'disabled-text': '#74879b',
    } },
    { id: 'lavender', name: '柔雾紫', description: '柔和紫色，让阅读多一点灵感。', scheme: 'light', colors: {
      canvas: '#f9f6fc', surface: '#fffdff', 'surface-soft': '#f1eafa', 'surface-hover': '#e8ddf4',
      text: '#382849', muted: '#70617f', subtle: '#70617f', line: '#e4d9ee',
      accent: '#dcc7f7', 'accent-hover': '#cdb0ef', 'accent-text': '#4a2e70',
      highlight: '#f0e8fb', 'highlight-line': '#d7c2ec', 'highlight-text': '#6a438f',
      success: '#50784e', danger: '#a74560', 'danger-bg': '#fff0f3', 'danger-line': '#eabccc',
      focus: '#8a5db6', shadow: '#38284926', 'inverse-surface': '#49315d', 'inverse-text': '#faf3ff',
      'disabled-bg': '#ebe3f3', 'disabled-text': '#8c7a9c',
    } },
    { id: 'sand', name: '暖纸棕', description: '温暖纸张质感，适合长时间阅读。', scheme: 'light', colors: {
      canvas: '#fbf7ee', surface: '#fffcf6', 'surface-soft': '#f4ebdb', 'surface-hover': '#ecdec6',
      text: '#493723', muted: '#7a664b', subtle: '#7a664b', line: '#e7d9bf',
      accent: '#f3d493', 'accent-hover': '#ebc271', 'accent-text': '#573b18',
      highlight: '#f7ecd4', 'highlight-line': '#dfc58f', 'highlight-text': '#7e5c25',
      success: '#60773e', danger: '#a54830', 'danger-bg': '#fff0e5', 'danger-line': '#e7b9a3',
      focus: '#a27a31', shadow: '#49372326', 'inverse-surface': '#513e29', 'inverse-text': '#fff8e9',
      'disabled-bg': '#eee4d2', 'disabled-text': '#917e62',
    } },
    { id: 'midnight', name: '午夜深色', description: '沉静夜色与柔蓝，照顾夜间阅读。', scheme: 'dark', colors: {
      canvas: '#101823', surface: '#172230', 'surface-soft': '#1e2b3a', 'surface-hover': '#293b4f',
      text: '#e4ecf7', muted: '#b0bfd2', subtle: '#a0b2c9', line: '#35475d',
      accent: '#a8c7ff', 'accent-hover': '#bfd6ff', 'accent-text': '#142845',
      highlight: '#223b59', 'highlight-line': '#3c5e83', 'highlight-text': '#c7ddff',
      success: '#9bd3ad', danger: '#ffb3a8', 'danger-bg': '#3b2429', 'danger-line': '#7a424b',
      focus: '#a8c7ff', shadow: '#00000060', 'inverse-surface': '#dce7f7', 'inverse-text': '#152235',
      'disabled-bg': '#253244', 'disabled-text': '#8c9bb0',
    } },
  ];
  const byId = new Map(definitions.map(theme => [theme.id, theme]));
  const normalizeTheme = value => byId.has(value) ? value : 'midnight';
  const getTheme = value => byId.get(normalizeTheme(value));
  const THEMES = Object.freeze(definitions.map(theme => Object.freeze({
    id: theme.id, name: theme.name, description: theme.description, scheme: theme.scheme,
    preview: Object.freeze({ canvas: theme.colors.canvas, surface: theme.colors.surface, accent: theme.colors.accent, text: theme.colors.text }),
  })));

  function variables(value) {
    const theme = getTheme(value);
    const result = Object.fromEntries(Object.entries(theme.colors).map(([key, color]) => [`--pl-${key}`, color]));
    result['--pl-color-scheme'] = theme.scheme;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12"><path fill="${theme.colors.muted}" d="M1.06 3.94 6 8.88l4.94-4.94L12 5l-6 6-6-6z"/></svg>`;
    result['--pl-chevron'] = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
    return result;
  }

  function applyTheme(target, value) {
    const theme = getTheme(value);
    if (!target?.style?.setProperty) return theme.id;
    for (const [name, color] of Object.entries(variables(theme.id))) target.style.setProperty(name, color);
    target.setAttribute('data-theme', theme.id);
    target.style.colorScheme = theme.scheme;
    const document = target.ownerDocument;
    // Page themes belong only to extension documents. Content scripts call this
    // with their own shadow host, never the website's documentElement.
    if (document?.documentElement === target && typeof document.defaultView?.CustomEvent === 'function') {
      document.defaultView.dispatchEvent(new document.defaultView.CustomEvent('pagelingo-theme-change', { detail: { target, theme: theme.id } }));
    }
    return theme.id;
  }

  globalThis.PageLingoThemes = Object.freeze({ THEMES, normalizeTheme, getTheme, variables, applyTheme });
})();
