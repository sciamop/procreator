import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lzo1xCompress } from 'lzo1x';
import { decodeTile, placeTile } from '../lib/layers';

function rawBlock(bytes: Buffer) {
  const header = Buffer.alloc(8);
  header.write('bv4-'); header.writeUInt32LE(bytes.length, 4);
  return Buffer.concat([header, bytes]);
}

test('Apple LZ4 framing preserves history across consecutive blocks', () => {
  const compressed = Buffer.alloc(15);
  compressed.write('bv41'); compressed.writeUInt32LE(4, 4); compressed.writeUInt32LE(3, 8);
  compressed.set([0, 4, 0], 12); // Four-byte match against the preceding raw block.
  const source = Buffer.concat([rawBlock(Buffer.from('ABCD')), compressed, Buffer.from('bv4$')]);
  assert.equal(decodeTile(source, 'lz4', 8).toString(), 'ABCDABCD');
  assert.throws(() => decodeTile(source, 'lz4', 4), /dimensions/);
  assert.throws(() => decodeTile(source.subarray(0, -4), 'lz4', 8), /Incomplete/);
});

test('older LZO tiles decode to the required pixel count', () => {
  const original = Buffer.from([255, 0, 0, 255, 0, 128, 0, 128, 0, 0, 0, 0]);
  const encoded = Buffer.from(lzo1xCompress(original));
  assert.deepEqual(decodeTile(encoded, 'chunk', original.length), original);
  assert.throws(() => decodeTile(encoded, 'chunk', original.length - 1));
});

test('partial tiles retain their edge placement and unpremultiply alpha', () => {
  const canvas = Buffer.alloc(3 * 3 * 4);
  placeTile(canvas, Buffer.from([64, 32, 16, 128]), 3, 3, 2, 1, 1, 4);
  assert.deepEqual([...canvas.subarray(8, 12)], [128, 64, 32, 128]);
  assert.equal(canvas.subarray(12).some(value => value !== 0), false);
});

test('tile scanlines flip into top-left coordinates and mask pixels stay grayscale', () => {
  const canvas = Buffer.alloc(2 * 2 * 4);
  placeTile(canvas, Buffer.from([10, 20, 30, 40]), 2, 2, 2, 0, 0, 1);
  assert.deepEqual([...canvas], [30, 30, 30, 255, 40, 40, 40, 255, 10, 10, 10, 255, 20, 20, 20, 255]);
});
