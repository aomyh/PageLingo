import { cp, mkdir, readFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const { version } = JSON.parse(await readFile(path.join(root, 'manifest.json')));
const folder = `PageLingo-${version}`;
const destination = path.join(root, 'dist', folder);
await mkdir(destination, { recursive: true });
const entries = ['manifest.json', 'background.js', 'content.js', 'selection.js', 'options.html', 'options.js', 'options.css', 'popup.html', 'popup.js', 'popup.css', 'translate.html', 'translate.js', 'translate.css', 'lib', 'assets', 'styles', 'README.md'];
for (const entry of entries) await cp(path.join(root, entry), path.join(destination, entry), { recursive: true });
// Exact allowlist prevents local environment files, tests, and credentials from entering the archive.
const archive = path.join(root, 'dist', `${folder}.zip`);
const result = spawnSync('/usr/bin/zip', ['-q', '-r', '-FS', archive, folder], { cwd: path.join(root, 'dist'), encoding: 'utf8' });
if (result.status !== 0) throw new Error(result.stderr || 'zip packaging failed');
await access(archive);
console.log(`Chrome unpacked directory: ${destination}\nDistribution archive: ${archive}`);
