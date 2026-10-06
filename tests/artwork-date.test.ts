import { test } from 'node:test';
import assert from 'node:assert/strict';
import { movieCreationDate, validArtworkDate } from '../lib/artwork-date';

function box(type: string, data: Buffer) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length + 8); header.write(type, 4);
  return Buffer.concat([header, data]);
}
function movie(date: number, version: number) {
  const header = Buffer.alloc(version ? 32 : 20);
  header[0] = version;
  const seconds = date / 1000 + 2_082_844_800;
  if (version) header.writeBigUInt64BE(BigInt(seconds), 4);
  else header.writeUInt32BE(seconds, 4);
  return Buffer.concat([box('ftyp', Buffer.from('qt  ')), box('moov', box('mvhd', header)), box('mdat', Buffer.alloc(1024))]);
}
test('embedded movie dates decode both header versions independently of file copy dates', () => {
  const date = Date.UTC(2021, 5, 15, 12, 34, 56);
  assert.equal(movieCreationDate(movie(date, 0)), date);
  assert.equal(movieCreationDate(movie(date, 1)), date);
  assert.equal(movieCreationDate(movie(date, 0).subarray(0, 60)), date);
  assert.equal(movieCreationDate(Buffer.from('not a movie')), null);
  assert.equal(movieCreationDate(movie(date, 1).subarray(0, 34)), null);
  assert.equal(validArtworkDate(Date.UTC(1904, 0, 1)), false);
});
