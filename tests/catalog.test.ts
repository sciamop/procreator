import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { readCatalog, writeCatalog } from '../lib/catalog-store';

test('catalog survives process restarts, reuses unchanged metadata, and reconciles changes', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gallery-catalog-'));
  const media = path.join(directory, 'media'), data = path.join(directory, 'data'), output = path.join(directory, 'result.json');
  const database = path.join(data, 'catalog.sqlite');
  const env = { ...process.env, MEDIA_ROOT: media, DATA_DIR: data, CATALOG_REFRESH_SECONDS: '3600' };
  const run = async (refresh = false) => {
    const child = spawnSync(process.execPath, ['--import', 'tsx', 'tests/fixtures/catalog-process.ts', output, ...(refresh ? ['--refresh'] : [])], { env, encoding: 'utf8', timeout: 30_000 });
    assert.equal(child.status, 0, child.stderr);
    return JSON.parse(await readFile(output, 'utf8')).catalog;
  };
  const png = (file: string, width: number) => sharp({ create: { width, height: 4, channels: 3, background: '#ff0000' } }).png().toFile(path.join(media, file));
  try {
    await mkdir(media);
    await png('keep.png', 4); await png('change.png', 4); await png('remove.png', 4);
    assert.equal((await run()).items.length, 3);
    const saved = readCatalog(database, media)!;
    // A sentinel proves refresh actually reused unchanged extraction results.
    saved.records.find(record => record.relative === 'keep.png')!.item.width = 777;
    writeCatalog(database, media, saved);
    await rename(media, `${media}-offline`);
    assert.equal((await run()).items.find((item: any) => item.filename === 'keep.png').width, 777);
    await rename(`${media}-offline`, media);
    await png('change.png', 9); await png('added.png', 6); await rm(path.join(media, 'remove.png'));
    const refreshed = await run(true);
    assert.deepEqual(refreshed.items.map((item: any) => item.filename), ['added.png', 'change.png', 'keep.png']);
    assert.equal(refreshed.items.find((item: any) => item.filename === 'keep.png').width, 777);
    assert.equal(refreshed.items.find((item: any) => item.filename === 'change.png').width, 9);
    const stale = readCatalog(database, media)!;
    stale.scannedAt = Date.now() - 5000;
    writeCatalog(database, media, stale);
    env.CATALOG_REFRESH_SECONDS = '1';
    await png('background.png', 7);
    const duringRefresh = await run();
    assert.equal(duringRefresh.refreshing, true);
    assert.equal(duringRefresh.items.length, 3, 'Stale metadata returns before background discovery');
    assert.equal(readCatalog(database, media)!.records.length, 4, 'Background check saves new artworks');
    await rename(media, `${media}-offline`);
    const failed = spawnSync(process.execPath, ['--import', 'tsx', 'tests/fixtures/catalog-process.ts', output, '--refresh'], { env, encoding: 'utf8', timeout: 30_000 });
    assert.equal(failed.status, 1);
    assert.equal(readCatalog(database, media)!.records.length, 4, 'Failed scans retain the saved snapshot');
    assert.equal(readCatalog(database, `${media}-different`), undefined, 'A different root never reuses another collection');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
