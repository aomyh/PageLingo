import { readFile, access, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
if (manifest.manifest_version !== 3) throw new Error('Expected Manifest V3');
for (const asset of [manifest.background.service_worker, manifest.action.default_popup, manifest.options_page, 'content.js', 'selection.js', 'manual-panel.js', ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon)]) {
  await access(path.join(root, asset));
}
const jsFiles = [];
async function checkDir(dir) {
  for (const entry of await readdir(path.join(root, dir), { withFileTypes: true })) {
    if (['dist', 'node_modules', '.git'].includes(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await checkDir(file);
    else if (/\.(?:js|mjs)$/.test(entry.name)) jsFiles.push(file);
  }
}
await checkDir('');
for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${file}: ${result.stderr}`);
}
for (const htmlFile of ['options.html', 'popup.html', 'translate.html']) {
  const html = await readFile(path.join(root, htmlFile), 'utf8');
  if (/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i.test(html)) throw new Error(`${htmlFile} has inline JavaScript incompatible with extension CSP`);
  for (const [, asset] of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    if (/^(?:https?:|chrome:|mailto:)/.test(asset)) continue;
    await access(path.join(root, asset));
  }
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  if (new Set(ids).size !== ids.length) throw new Error(`${htmlFile} has duplicate IDs`);
  const script = await readFile(path.join(root, htmlFile.replace('.html', '.js')), 'utf8');
  for (const [, id] of script.matchAll(/\$\('([^']+)'\)/g)) if (!ids.includes(id)) throw new Error(`${htmlFile}: missing element #${id}`);
}
for (const size of [16, 32, 48, 128]) {
  const png = await readFile(path.join(root, `assets/icon${size}.png`));
  if (png.readUInt32BE(16) !== size || png.readUInt32BE(20) !== size) throw new Error(`Incorrect icon${size} dimensions`);
}
console.log(`Manifest, referenced assets, CSP, UI bindings, 4 icons and ${jsFiles.length} JavaScript files verified.`);
