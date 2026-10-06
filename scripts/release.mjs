import { readdir, readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [];
const roots = ['.gitignore', '.env.example', 'README.md', 'LICENSE', 'package.json', 'package-lock.json', 'tsconfig.json', 'next.config.ts', 'postcss.config.mjs', 'start.sh', 'stop.sh', 'restart.sh', 'status.sh', 'public/favicon.svg', 'media/.gitkeep'];
for (const file of roots) {
  try { if ((await lstat(path.join(root, file))).isSymbolicLink()) throw new Error(`Refusing symlink: ${file}`); files.push(file); }
  catch (error) { if (file !== 'LICENSE' || error.code !== 'ENOENT') throw error; }
}
async function walk(directory) {
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === '__pycache__') continue;
    const file = `${directory}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`Refusing symlink: ${file}`);
    if (entry.isDirectory()) await walk(file);
    else if (/\.(ts|tsx|mjs|py|sh|css|md|txt|yml|template)$/.test(file)) files.push(file);
  }
}
for (const directory of ['app', 'components', 'lib', 'scripts', 'tests', 'docs', 'systemd', '.github']) await walk(directory);
const checks = [
  ['personal home directory', /\/home\/[a-zA-Z0-9_.-]+\//],
  ['personal macOS directory', /\/Users\/[a-zA-Z0-9_.-]+\//],
  ['private network address', /\b(?:192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)\b/],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['API token', /(?:sk-|ghp_)[A-Za-z0-9_-]{24,}/],
];
for (const file of files) {
  const text = await readFile(path.join(root, file), 'utf8');
  for (const [name, pattern] of checks) if (pattern.test(text)) throw new Error(`Release check: possible ${name} in ${file}. Inspect it before publishing.`);
}
console.log(`Checked ${files.length} source files. Private environment, artwork, tag data, caches, screenshots, and generated service files are excluded.`);
if (!files.includes('LICENSE')) console.log('No license selected. Choose one before publishing if you want to grant reuse rights.');
if (process.argv.includes('--bundle')) {
  await mkdir(path.join(root, '.artifacts'), { recursive: true });
  const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  if (!/^[\w.-]+$/.test(version)) throw new Error('Invalid package version');
  const output = `.artifacts/procreator-${version}.tar.gz`;
  const inventory = '.artifacts/release-files.txt';
  await writeFile(path.join(root, inventory), files.sort().join('\0') + '\0');
  const result = spawnSync('tar', ['-czf', output, '--null', '-T', inventory], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || 'Source archive failed');
  console.log(`Created ${output}`);
}
