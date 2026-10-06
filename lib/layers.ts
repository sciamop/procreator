import { stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import bplist from 'bplist-parser';
import { decompressBlock } from 'lz4js';
import { lzo1xDecompress } from 'lzo1x';
import sharp from 'sharp';
import { getArtwork, readArchive } from './archive';
import type { ArtworkLayer, LayerCatalog } from './types';

const MAX_PIXELS = 64 * 1024 * 1024;
const blendNames: Record<number, string> = { 0: 'Normal', 1: 'Multiply', 2: 'Screen', 3: 'Add', 4: 'Lighten', 5: 'Exclusion', 6: 'Difference', 7: 'Subtract', 8: 'Linear burn', 9: 'Color dodge', 10: 'Color burn', 11: 'Overlay', 12: 'Hard light', 13: 'Color', 14: 'Luminosity', 15: 'Hue', 16: 'Saturation', 17: 'Soft light', 19: 'Darken', 20: 'Hard mix', 21: 'Vivid light', 22: 'Linear light', 23: 'Pin light', 24: 'Lighter color', 25: 'Darker color', 26: 'Divide' };
type Tile = { name: string; col: number; row: number; encoding: string };
type LayerData = ArtworkLayer & { width: number; height: number; chunks: Tile[] };
type Document = { layers: LayerData[]; tileSize: number; orientation: number; flipX: boolean; flipY: boolean };
export class LayerError extends Error {}

/** Procreate wraps LZ4 blocks in Apple's bv41/bv4-/bv4$ stream. */
export function decodeTile(data: Buffer, encoding: string, expectedSize: number): Buffer {
  if (expectedSize < 1 || expectedSize > 1024 * 1024 * 4) throw new LayerError('Unsupported layer tile size.');
  if (encoding === 'chunk') return Buffer.from(lzo1xDecompress(data, expectedSize));
  const output = Buffer.alloc(expectedSize);
  let input = 0, written = 0;
  while (input + 4 <= data.length) {
    const magic = data.toString('ascii', input, input + 4); input += 4;
    if (magic === 'bv4$') {
      if (written !== expectedSize || input !== data.length) throw new LayerError('Incomplete layer tile.');
      return output;
    }
    if ((magic !== 'bv41' && magic !== 'bv4-') || input + 4 > data.length) throw new LayerError('Unsupported layer compression.');
    const decodedSize = data.readUInt32LE(input); input += 4;
    if (decodedSize < 1 || written + decodedSize > output.length) throw new LayerError('Invalid layer tile dimensions.');
    if (magic === 'bv4-') {
      if (input + decodedSize > data.length) throw new LayerError('Incomplete layer tile.');
      data.copy(output, written, input, input + decodedSize);
      input += decodedSize; written += decodedSize;
    } else {
      if (input + 4 > data.length) throw new LayerError('Incomplete layer tile.');
      const compressedSize = data.readUInt32LE(input); input += 4;
      if (!compressedSize || input + compressedSize > data.length) throw new LayerError('Incomplete layer tile.');
      const end = decompressBlock(data, output, input, compressedSize, written);
      if (end !== written + decodedSize) throw new LayerError('Incomplete layer tile.');
      written = end; input += compressedSize;
    }
  }
  throw new LayerError('Incomplete layer tile.');
}

export function parseLayers(data: Buffer, filenames: string[]): Document {
  const archive = bplist.parseBuffer(data)[0];
  const objects = archive.$objects;
  const deref = (value: any): any => value && typeof value === 'object' && 'UID' in value ? objects[value.UID] : value;
  const list = (value: any): any[] => deref(value)?.['NS.objects'] || [];
  const text = (value: any, fallback: string) => { const resolved = deref(value); return typeof resolved === 'string' && resolved !== '$null' ? resolved : fallback; };
  const doc = deref(archive.$top.root);
  const size = String(deref(doc.size)).match(/\d+/g)?.map(Number);
  if (!size || size.length !== 2) throw new LayerError('Canvas dimensions are unavailable.');
  const tileSize = Number(doc.tileSize) || 256;
  if (!Number.isInteger(tileSize) || tileSize < 1 || tileSize > 1024) throw new LayerError('Unsupported tile dimensions.');
  const chunks = new Map<string, Tile[]>();
  for (const name of filenames) {
    const match = /^([\w-]+)\/(\d+)~(\d+)\.(lz4|chunk)$/.exec(name);
    if (!match) continue;
    const tiles = chunks.get(match[1]) || [];
    tiles.push({ name, col: Number(match[2]), row: Number(match[3]), encoding: match[4] });
    chunks.set(match[1], tiles);
  }
  const layers: LayerData[] = [];
  const seen = new Set<unknown>();
  function visit(value: any, group: string[], hidden: boolean, kind: 'layer' | 'mask' = 'layer') {
    const layer = deref(value);
    if (!layer || typeof layer !== 'object' || seen.has(layer)) return;
    seen.add(layer);
    if (deref(layer.$class)?.$classname === 'SilicaGroup') {
      for (const child of list(layer.children)) visit(child, [...group, text(layer.name, 'Untitled group')], hidden || Boolean(layer.isHidden));
      return;
    }
    const id = text(layer.UUID, '');
    if (!id || !/^[\w-]+$/.test(id)) return;
    const width = Number(layer.sizeWidth) || size![0], height = Number(layer.sizeHeight) || size![1];
    const blend = Number(layer.extendedBlend ?? layer.blend ?? 0);
    const layerChunks = chunks.get(id) || [];
    layers.push({ id, name: text(layer.name, kind === 'mask' ? 'Layer mask' : 'Untitled layer'), group, kind,
      hidden: hidden || Boolean(layer.hidden), opacity: Number.isFinite(layer.opacity) ? Math.max(0, Math.min(1, layer.opacity)) : 1,
      blend: blendNames[blend] || `Blend mode ${blend}`, clipped: Boolean(layer.clipped),
      width, height, tiles: layerChunks.length, chunks: layerChunks });
    visit(layer.mask, [...group, text(layer.name, 'Untitled layer')], hidden || Boolean(layer.hidden), 'mask');
  }
  // Despite its name, unwrappedLayers preserves the group tree; layers is flat.
  for (const layer of list(doc.unwrappedLayers)) visit(layer, [], false);
  if (!layers.length) for (const layer of list(doc.layers)) visit(layer, [], false);
  return { layers, tileSize, orientation: Number(doc.orientation) || 1, flipX: Boolean(doc.flippedHorizontally), flipY: Boolean(doc.flippedVertically) };
}

const documents = new Map<string, Promise<Document>>();
async function document(id: string) {
  const { file, item } = await getArtwork(id);
  if (item.type !== 'procreate') throw new LayerError('This image does not contain Procreate layers.');
  const info = await stat(file);
  const key = `${file}:${info.size}:${info.mtimeMs}`;
  let pending = documents.get(key);
  if (!pending) {
    pending = readArchive(file, name => name === 'Document.archive', 8 * 1024 * 1024).then(({ data, entries }) => {
      const metadata = data.get('Document.archive');
      if (!metadata) throw new LayerError('Layer metadata is unavailable.');
      return parseLayers(metadata, entries.map(entry => entry.fileName));
    }).catch(error => { documents.delete(key); throw error; });
    if (documents.size >= 24) documents.delete(documents.keys().next().value!);
    documents.set(key, pending);
  }
  return { file, key, doc: await pending };
}

export async function getLayers(id: string): Promise<LayerCatalog> {
  const { doc } = await document(id);
  return { layers: doc.layers.map(({ width, height, chunks, ...layer }) => layer) };
}

/** Tile rows and pixels use a bottom-left origin; pixels are premultiplied RGBA. */
export function placeTile(canvas: Buffer, pixels: Buffer, width: number, height: number, tileSize: number, col: number, row: number, channels: number) {
  const x = col * tileSize, y = row * tileSize;
  const tileWidth = Math.min(tileSize, width - x), tileHeight = Math.min(tileSize, height - y);
  for (let py = 0; py < tileHeight; py++) {
    for (let px = 0; px < tileWidth; px++) {
      const source = (py * tileWidth + px) * channels;
      const destination = ((height - 1 - y - py) * width + x + px) * 4;
      const alpha = channels === 1 ? 255 : pixels[source + 3];
      for (let channel = 0; channel < 3; channel++) {
        canvas[destination + channel] = channels === 1 ? pixels[source] : alpha ? Math.min(255, Math.round(pixels[source + channel] * 255 / alpha)) : 0;
      }
      canvas[destination + 3] = alpha;
    }
  }
}

const previews = new Map<string, Buffer>();
const pendingPreviews = new Map<string, Promise<Buffer>>();
let renderQueue: Promise<unknown> = Promise.resolve();
export async function getLayerPreview(id: string, layerId: string) {
  const { file, key, doc } = await document(id);
  const layer = doc.layers.find(layer => layer.id === layerId);
  if (!layer) throw new LayerError('Layer not found.');
  const cacheKey = `${key}:${layer.id}:png-v1`;
  const etag = `"${createHash('sha256').update(cacheKey).digest('hex')}"`;
  const cached = previews.get(cacheKey);
  if (cached) return { buffer: cached, etag };
  let pending = pendingPreviews.get(cacheKey);
  if (!pending) {
    pending = renderQueue.catch(() => {}).then(async () => {
      const { width, height } = layer;
      if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > MAX_PIXELS) throw new LayerError('This layer is too large to preview (64 megapixel limit).');
      const names = new Set(layer.chunks.map(chunk => chunk.name));
      const { data } = await readArchive(file, name => names.has(name), 192 * 1024 * 1024);
      const canvas = Buffer.alloc(width * height * 4);
      for (const tile of layer.chunks) {
        const tw = Math.min(doc.tileSize, width - tile.col * doc.tileSize), th = Math.min(doc.tileSize, height - tile.row * doc.tileSize);
        if (tw <= 0 || th <= 0) throw new LayerError('Layer tiles extend outside the canvas.');
        const channels = layer.kind === 'mask' ? 1 : 4;
        const pixels = decodeTile(data.get(tile.name)!, tile.encoding, tw * th * channels);
        placeTile(canvas, pixels, width, height, doc.tileSize, tile.col, tile.row, channels);
      }
      let pipeline = sharp(canvas, { raw: { width, height, channels: 4 } });
      if (doc.flipX) pipeline = pipeline.flop();
      if (doc.flipY) pipeline = pipeline.flip();
      const rotation = ({ 1: 0, 2: 180, 3: 270, 4: 90 } as Record<number, number>)[doc.orientation] ?? 0;
      const buffer = await pipeline.rotate(rotation).resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
      if (previews.size >= 32) previews.delete(previews.keys().next().value!);
      previews.set(cacheKey, buffer);
      return buffer;
    }).finally(() => pendingPreviews.delete(cacheKey));
    pendingPreviews.set(cacheKey, pending);
    renderQueue = pending.catch(() => {});
  }
  return { buffer: await pending, etag };
}
