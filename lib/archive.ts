import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import { readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import yauzl, { type Entry } from 'yauzl';
import bplist from 'bplist-parser';
import sharp from 'sharp';
import type { Artwork, Catalog } from './types';
import { embeddedArtworkDate } from './artwork-date';
import { configuredPath, dataDirectory, catalogRefreshInterval } from './config';
import { readCatalog, writeCatalog, type CatalogRecord, type SavedCatalog } from './catalog-store';

const extensions = new Set(['.procreate', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.tif', '.tiff', '.bmp']);
export const mediaRoot = () => configuredPath('MEDIA_ROOT');
export const isVideo = (name: string) => /^video\/.*\.(mp4|mov|m4v)$/i.test(name);
export const natural = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** Read only explicitly selected ZIP members; never unpack archive paths. */
export function readArchive(file: string, select: (name: string) => boolean, limit = 40 * 1024 * 1024): Promise<{ entries: Entry[]; data: Map<string, Buffer> }> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, autoClose: true }, (error, zip) => {
      if (error || !zip) return reject(error || new Error('Unreadable document'));
      const entries: Entry[] = [];
      const data = new Map<string, Buffer>();
      let total = 0;
      const fail = (err: Error) => { zip.close(); reject(err); };
      zip.on('error', fail);
      zip.on('end', () => resolve({ entries, data }));
      zip.on('entry', (entry: Entry) => {
        entries.push(entry);
        if (!select(entry.fileName)) return zip.readEntry();
        if (entry.uncompressedSize > limit || total + entry.uncompressedSize > limit) return fail(new Error('Embedded media is too large'));
        zip.openReadStream(entry, (err, stream) => {
          if (err || !stream) return fail(err || new Error('Unreadable media'));
          const chunks: Buffer[] = [];
          stream.on('error', fail);
          stream.on('data', (chunk: Buffer) => { total += chunk.length; chunks.push(chunk); });
          stream.on('end', () => { data.set(entry.fileName, Buffer.concat(chunks)); zip.readEntry(); });
        });
      });
      zip.readEntry();
    });
  });
}

function dimensions(data?: Buffer): [number, number] | null {
  if (!data) return null;
  try {
    const archive = bplist.parseBuffer(data)[0];
    const objects = archive.$objects;
    const unwrap = (value: unknown): any => value && typeof value === 'object' && 'UID' in value ? objects[value.UID as number] : value;
    const doc = unwrap(archive.$top.root);
    const size = String(unwrap(doc.size)).match(/\d+/g);
    return size?.length === 2 ? [Number(size[0]), Number(size[1])] : null;
  } catch { return null; }
}

async function inspect(file: string, root: string, info: Stats): Promise<Artwork> {
  const relative = path.relative(root, file);
  const type = path.extname(file).slice(1).toLowerCase();
  const item: Artwork = {
    id: createHash('sha256').update(relative).digest('hex').slice(0, 24),
    name: path.basename(file, path.extname(file)).replaceAll('_', ' '),
    filename: path.basename(file), folder: path.dirname(relative), type,
    bytes: info.size, modified: info.mtimeMs, version: `${info.mtimeMs}-${info.size}`,
    date: info.mtimeMs, dateSource: 'filesystem',
    width: null, height: null, previewWidth: null, previewHeight: null, segments: 0, error: null,
  };
  try {
    let source: string | Buffer = file;
    if (type === 'procreate') {
      const { entries, data } = await readArchive(file, name => ['QuickLook/Thumbnail.png', 'Document.archive'].includes(name));
      item.segments = entries.filter(entry => isVideo(entry.fileName)).length;
      Object.assign(item, await embeddedArtworkDate(file, item.version, entries, info.mtimeMs));
      const size = dimensions(data.get('Document.archive'));
      if (size) [item.width, item.height] = size;
      const preview = data.get('QuickLook/Thumbnail.png');
      if (!preview) throw new Error('Missing preview');
      source = preview;
    }
    const meta = await sharp(source).metadata();
    const rotated = (meta.orientation || 1) >= 5;
    item.previewWidth = (rotated ? meta.height : meta.width) ?? null;
    item.previewHeight = (rotated ? meta.width : meta.height) ?? null;
    if (type !== 'procreate') { item.width = item.previewWidth; item.height = item.previewHeight; }
  } catch { item.error = 'Preview unavailable'; }
  return item;
}

type Index = { catalog: Catalog; paths: Map<string, string>; records: Map<string, CatalogRecord>; expires: number };
type IndexState = { index?: Index; pending?: Promise<Index> };
const indexes = new Map<string, IndexState>();

function hydrate(root: string, saved: SavedCatalog): Index {
  const items = saved.records.map(record => record.item).sort((a, b) => natural.compare(a.name, b.name) || natural.compare(a.folder, b.folder));
  return {
    catalog: { items, root, indexedAt: saved.scannedAt },
    paths: new Map(saved.records.map(record => [record.item.id, path.join(root, record.relative)])),
    records: new Map(saved.records.map(record => [record.relative, record])),
    expires: saved.scannedAt + catalogRefreshInterval(),
  };
}

async function buildIndex(root: string, database: string, previous?: Index): Promise<Index> {
  const files: string[] = [];
  async function walk(directory: string) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) files.push(file);
    }
  }
  await walk(root);
  const records: CatalogRecord[] = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (cursor < files.length) {
      const file = files[cursor++];
      let info: Stats;
      try { info = await stat(file); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
      const relative = path.relative(root, file);
      const fingerprint = `${info.mtimeMs}:${info.ctimeMs}:${info.size}`;
      const cached = previous?.records.get(relative);
      const item = cached?.fingerprint === fingerprint ? cached.item : await inspect(file, root, info);
      records.push({ relative, fingerprint, item });
    }
  }));
  const saved = { records, scannedAt: Date.now() };
  writeCatalog(database, root, saved);
  return hydrate(root, saved);
}

async function getIndex(refresh = false): Promise<Index> {
  const root = mediaRoot();
  const database = path.join(dataDirectory(), 'catalog.sqlite');
  const key = `${database}\0${root}`;
  let state = indexes.get(key);
  if (!state) {
    state = {};
    const saved = readCatalog(database, root);
    if (saved) state.index = hydrate(root, saved);
    indexes.set(key, state);
  }
  const current = state;
  function scan() {
    if (!current.pending) {
      current.pending = buildIndex(root, database, current.index).then(result => (current.index = result)).catch(error => {
        // A disconnected drive must not erase the saved catalog or cause a retry storm.
        if (current.index) current.index.expires = Date.now() + catalogRefreshInterval();
        throw error;
      }).finally(() => { current.pending = undefined; });
    }
    return current.pending;
  }
  if (refresh || !current.index) return scan();
  if (current.index.expires <= Date.now() && !current.pending) {
    void scan().catch(error => console.warn('Archive refresh failed; keeping the saved catalog:', error));
  }
  return current.index;
}

export async function getCatalog(refresh = false) {
  const index = await getIndex(refresh);
  const state = indexes.get(`${path.join(dataDirectory(), 'catalog.sqlite')}\0${mediaRoot()}`);
  return { ...index.catalog, refreshing: Boolean(state?.pending) };
}

export async function getArtwork(id: string) {
  if (!/^[a-f0-9]{24}$/.test(id)) throw new Error('Artwork not found');
  const current = await getIndex();
  const file = current.paths.get(id);
  if (!file) throw new Error('Artwork not found');
  const resolved = await realpath(file);
  const relative = path.relative(await realpath(mediaRoot()), resolved);
  if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) throw new Error('Artwork not found');
  return { file: resolved, item: current.catalog.items.find(item => item.id === id)! };
}

const previews = new Map<string, Buffer>();
export async function getPreview(id: string, small: boolean) {
  const { file, item } = await getArtwork(id);
  const info = await stat(file);
  const key = `${file}:${info.mtimeMs}:${info.size}:${small}:png-v1`;
  const etag = `"${createHash('sha256').update(key).digest('hex')}"`;
  let buffer = previews.get(key);
  if (!buffer) {
    let source: Buffer | string = file;
    if (item.type === 'procreate') {
      const { data } = await readArchive(file, name => name === 'QuickLook/Thumbnail.png');
      const image = data.get('QuickLook/Thumbnail.png');
      if (!image) throw new Error('Preview unavailable');
      source = image;
    }
    buffer = await sharp(source).rotate().resize(small ? 560 : 2400, small ? 560 : 2400, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    if (previews.size >= 96) previews.delete(previews.keys().next().value!);
    previews.set(key, buffer);
  }
  return { buffer, etag };
}
