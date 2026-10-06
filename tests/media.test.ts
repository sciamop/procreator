import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { serveFile } from '../lib/serve-file';
import { getArtwork, isVideo, natural, readArchive } from '../lib/archive';

test('video seeking supports full, bounded, suffix, and invalid byte ranges', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'procreator-test-'));
  try {
    const file = path.join(dir, 'clip.mp4');
    await writeFile(file, '0123456789');
    for (const [range, expected, status] of [[null, '0123456789', 200], ['bytes=2-5', '2345', 206], ['bytes=-3', '789', 206], ['bytes=8-', '89', 206], ['bytes=99-', '', 416], ['bytes=-0', '', 416], ['bytes=5-2', '', 416], ['bytes=-', '', 416]] as const) {
      const response = await serveFile(file, new Request('http://localhost/video', range ? { headers: { range } } : {}), 'video/mp4');
      assert.equal(response.status, status, String(range));
      assert.equal(await response.text(), expected);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('time-lapse segments are ordered numerically and only video members qualify', () => {
  const names = ['video/segments/segment-10.mp4', 'video/segments/segment-2.mp4', 'video/segments/segment-1.mp4'];
  assert.deepEqual(names.sort(natural.compare).map(n => n.match(/segment-(\d+)/)![1]), ['1', '2', '10']);
  assert.equal(isVideo(names[0]), true);
  assert.equal(isVideo('QuickLook/Thumbnail.png'), false);
  assert.equal(isVideo('../outside.mp4'), false);
});

test('invalid artwork IDs and damaged documents fail safely', async () => {
  await assert.rejects(getArtwork('../../etc/passwd'));
  const dir = await mkdtemp(path.join(os.tmpdir(), 'procreator-test-'));
  try {
    const file = path.join(dir, 'broken.procreate');
    await writeFile(file, 'not a zip');
    await assert.rejects(readArchive(file, () => true));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
