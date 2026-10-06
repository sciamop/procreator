import { access, mkdir, readFile, writeFile, rename, open } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { getArtwork, getCatalog } from './archive';
import type { Catalog, TaggingStatus } from './types';
import { configuredPath, dataDirectory as configuredDataDirectory, taggingEngine, ConfigurationError } from './config';

const dataDirectory = configuredDataDirectory();
const indexPath = path.join(dataDirectory, 'tags.json');
const statusPath = path.join(dataDirectory, 'tagging-status.json');
const python = () => process.env.TAGGER_PYTHON?.trim() || 'python3';
type TagRecord = { version: string; tags: string[]; error?: string; generatedAt?: string };
type TagIndex = { model: string; items: Record<string, TagRecord> };

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback; throw error; }
}
async function saveJson(file: string, data: unknown) {
  await mkdir(dataDirectory, { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(data)); await rename(temporary, file);
}

export function attachTags(catalog: Catalog, index: TagIndex): Catalog {
  return { ...catalog, items: catalog.items.map(item => {
    const record = index.items[item.id];
    const current = record?.version === item.version;
    return { ...item, tags: current && !record.error ? record.tags : [], tagStatus: !current ? 'pending' : record.error ? 'error' : 'tagged' };
  }) };
}

export async function withTags(catalog: Catalog) {
  return attachTags(catalog, await readJson<TagIndex>(indexPath, { model: 'RAM++', items: {} }));
}

export async function taggingStatus(): Promise<TaggingStatus> {
  if (taggingEngine() === 'none') return { state: 'disabled', processed: 0, total: 0, failed: 0 };
  const status = await readJson<TaggingStatus & { pid?: number }>(statusPath, { state: 'idle', processed: 0, total: 0, failed: 0 });
  const { pid, ...visible } = status;
  if (status.state === 'running' || status.state === 'loading') {
    try { if (!pid) throw new Error('Missing worker'); process.kill(pid, 0); }
    catch { return { ...visible, state: 'error', error: 'Tagging was interrupted. Select Tag untagged to resume.' }; }
  }
  return visible;
}

const shared = globalThis as typeof globalThis & { procreateTagStart?: Promise<TaggingStatus> };
export async function startTagging(): Promise<TaggingStatus> {
  if (shared.procreateTagStart) return shared.procreateTagStart;
  shared.procreateTagStart = (async () => {
    const engine = taggingEngine();
    if (engine === 'none') throw new ConfigurationError('Tagging is disabled. Set TAGGING_ENGINE in .env.local to enable it.');
    const status = await taggingStatus();
    if (status.state === 'loading' || status.state === 'running') return status;
    if (python().includes(path.sep)) await access(path.resolve(python()));
    if (engine === 'custom') await access(configuredPath('TAGGER_PLUGIN'));
    const catalog = await withTags(await getCatalog(true));
    const pending = catalog.items.filter(item => !item.error && item.tagStatus !== 'tagged');
    if (!pending.length) {
      const complete: TaggingStatus = { state: 'complete', processed: 0, total: 0, failed: 0 };
      await saveJson(statusPath, complete); return complete;
    }
    const manifest = await Promise.all(pending.map(async item => ({ id: item.id, version: item.version, file: (await getArtwork(item.id)).file })));
    const input = path.join(dataDirectory, 'tagging-input.json');
    await saveJson(input, manifest);
    const log = await open(path.join(dataDirectory, 'tagging.log'), 'a');
    try {
      const child = spawn(python(), ['-u', path.join(process.cwd(), 'scripts/tag-artworks.py'), '--engine', engine, '--input', input, '--output', indexPath, '--status', statusPath], {
        cwd: process.cwd(), stdio: ['ignore', log.fd, log.fd],
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', TOKENIZERS_PARALLELISM: 'false' },
      });
      await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      // The worker owns the status file; don't overwrite its early progress.
      // Hold the start guard until it reports its PID, preventing duplicate starts.
      const started = { state: 'loading' as const, processed: 0, total: manifest.length, failed: 0 };
      for (let attempt = 0; attempt < 100; attempt++) {
        const current = await readJson<{ pid?: number }>(statusPath, {});
        if (current.pid === child.pid) break;
        if (child.exitCode !== null || child.signalCode) throw new Error('The tagging worker exited before reporting its status.');
        await new Promise(resolve => setTimeout(resolve, 50));
        if (attempt === 99) { child.kill(); throw new Error('The tagging worker did not start.'); }
      }
      child.unref();
      return started;
    } finally { await log.close(); }
  })().finally(() => { shared.procreateTagStart = undefined; });
  return shared.procreateTagStart;
}
