import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function systemdQuote(value, command = false) {
  if (/[\x00-\x1f\x7f]/.test(value)) throw new Error('Service paths cannot contain control characters.');
  const escaped = value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%');
  return '"' + (command ? escaped.replaceAll('$', () => '$$') : escaped) + '"';
}
export function renderService(template, directory, node) {
  if (!path.isAbsolute(directory) || /[\x00-\x1f\x7f]/.test(directory) || directory.trim() !== directory) throw new Error('Service directory must be an absolute path without control characters or trailing whitespace.');
  // WorkingDirectory is a literal path directive; only ExecStart uses word quoting.
  return template.replaceAll('@PROJECT_DIR@', () => directory.replaceAll('%', '%%')).replaceAll('@NODE@', () => systemdQuote(node, true)).replaceAll('@SERVER@', () => systemdQuote(path.join(directory, 'scripts/server.mjs'), true));
}
async function main() {
  const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const template = await readFile(path.join(directory, 'systemd/procreate-archive.service.template'), 'utf8');
  await writeFile(path.join(directory, 'systemd/procreate-archive.service'), renderService(template, directory, process.execPath));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
