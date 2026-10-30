import test from 'node:test';
import assert from 'node:assert/strict';
import { THEMES, normalizeTheme, applyTheme, variables } from '../lib/theme.js';
import { defaultSettings, normalizeSettings } from '../lib/config.js';

function luminance(hex) {
  const values = hex.match(/[a-f\d]{2}/gi).slice(0, 3).map(value => parseInt(value, 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}
function contrast(first, second) {
  return (Math.max(luminance(first), luminance(second)) + 0.05) / (Math.min(luminance(first), luminance(second)) + 0.05);
}

test('new, legacy and invalid settings default to ocean while saved theme choices are preserved', () => {
  assert.equal(defaultSettings().theme, 'ocean');
  assert.equal(normalizeSettings({}).theme, 'ocean');
  for (const value of [undefined, null, '', {}, 'url(javascript:bad)', 'unknown']) assert.equal(normalizeTheme(value), 'ocean');
  const original = defaultSettings();
  original.providers.deepseek.apiKey = 'theme-test-fake-key';
  for (const theme of THEMES) {
    const updated = normalizeSettings({ ...original, theme: theme.id });
    assert.equal(updated.theme, theme.id);
    assert.equal(updated.providers.deepseek.apiKey, original.providers.deepseek.apiKey);
    assert.equal(updated.selectionEnabled, original.selectionEnabled);
  }
});

test('all five palettes have readable text, translated results, secondary labels and primary actions', () => {
  assert.deepEqual(THEMES.map(theme => theme.id), ['sage', 'ocean', 'lavender', 'sand', 'midnight']);
  assert.equal(new Set(THEMES.map(theme => theme.preview.canvas)).size, 5);
  for (const theme of THEMES) {
    const palette = variables(theme.id);
    for (const key of ['text', 'muted', 'subtle']) assert.ok(contrast(palette[`--pl-${key}`], palette['--pl-surface']) >= 4.5, `${theme.id}/${key} must stay legible`);
    assert.match(palette['--pl-translation'], /^#[a-f\d]{6}$/i, `${theme.id}/translation has a usable color`);
    for (const background of ['surface', 'highlight', 'surface-soft']) {
      assert.ok(contrast(palette['--pl-translation'], palette[`--pl-${background}`]) >= 4.5, `${theme.id}/translated result on ${background} must stay legible`);
    }
    assert.ok(contrast(palette['--pl-accent-text'], palette['--pl-accent']) >= 4.5, `${theme.id}/primary action`);
    assert.ok(contrast(palette['--pl-danger'], palette['--pl-danger-bg']) >= 4.5, `${theme.id}/error notice`);
    assert.equal(palette['--pl-color-scheme'], theme.scheme);
  }
});

test('theme application stays scoped to its target and only root changes notify preview panels', () => {
  const events = [], rootValues = new Map(), hostValues = new Map();
  const root = { style: { setProperty: (key, value) => rootValues.set(key, value) }, setAttribute(key, value) { this[key] = value; } };
  const host = { style: { setProperty: (key, value) => hostValues.set(key, value) }, setAttribute(key, value) { this[key] = value; } };
  const document = { documentElement: root, defaultView: { CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } }, dispatchEvent: event => events.push(event) } };
  root.ownerDocument = document; host.ownerDocument = document;
  applyTheme(host, 'midnight');
  assert.equal(host['data-theme'], 'midnight');
  assert.equal(host.style.colorScheme, 'dark');
  assert.equal(rootValues.size, 0, 'website root must remain untouched');
  assert.equal(events.length, 0);
  applyTheme(root, 'ocean');
  assert.equal(root['data-theme'], 'ocean');
  assert.equal(root.style.colorScheme, 'light');
  assert.equal(events.length, 1);
  assert.equal(events[0].detail.target, root);
  assert.equal(events[0].detail.theme, 'ocean');
  assert.equal(hostValues.get('--pl-canvas'), variables('midnight')['--pl-canvas']);
  applyTheme(host, 'unknown');
  assert.equal(host['data-theme'], 'ocean');
});
