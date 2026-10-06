import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { configuredPath, taggingEngine, cacheLimit } from '../lib/config';
import { renderService } from '../scripts/render-service.mjs';
import { serverConfig } from '../scripts/server-config.mjs';

test('configuration rejects missing media, unknown engines, and invalid cache limits', () => {
  const original = { ...process.env };
  try {
    delete process.env.MEDIA_ROOT;
    assert.throws(() => configuredPath('MEDIA_ROOT'), /Set MEDIA_ROOT/);
    process.env.MEDIA_ROOT = './media';
    assert.equal(configuredPath('MEDIA_ROOT'), path.resolve('media'));
    delete process.env.TAGGING_ENGINE;
    assert.equal(taggingEngine(), 'none');
    process.env.TAGGING_ENGINE = 'custom';
    assert.equal(taggingEngine(), 'custom');
    process.env.TAGGING_ENGINE = 'typo';
    assert.throws(taggingEngine, /TAGGING_ENGINE/);
    process.env.TIMELAPSE_CACHE_GB = '-1';
    assert.throws(cacheLimit, /positive/);
  } finally { process.env = original; }
});

test('service generation quotes checkout and Node paths without machine assumptions', () => {
  const unit = renderService('WorkingDirectory=@PROJECT_DIR@\nExecStart=@NODE@ @SERVER@ start', '/srv/art gallery %1', '/opt/node/bin/node');
  assert.match(unit, /WorkingDirectory=\/srv\/art gallery %%1\n/);
  assert.match(unit, /ExecStart="\/opt\/node\/bin\/node" "\/srv\/art gallery %%1\/scripts\/server.mjs" start/);
  assert.throws(() => renderService('@NODE@', '/srv/app', '/node\nInjected=value'), /control/);
  const dollar = renderService('@PROJECT_DIR@ @SERVER@', '/srv/$art', '/opt/node');
  assert.equal(dollar, '/srv/$art "/srv/$$art/scripts/server.mjs"');
});

test('launcher reads host and port from a portable env file', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gallery-env-'));
  const original = { ...process.env };
  try {
    delete process.env.APP_HOST; delete process.env.APP_PORT;
    await writeFile(path.join(directory, '.env'), 'APP_HOST=127.0.0.1\nAPP_PORT=4317\n');
    assert.deepEqual(serverConfig('start', directory), { host: '127.0.0.1', port: 4317 });
    process.env.APP_PORT = 'invalid';
    assert.throws(() => serverConfig('start', directory), /APP_PORT/);
  } finally { process.env = original; await rm(directory, { recursive: true, force: true }); }
});

test('disabled tagging blocks starts, keeps saved labels, and omits absolute paths from the API', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gallery-config-'));
  const original = { ...process.env };
  try {
    process.env.MEDIA_ROOT = path.join(directory, 'media');
    process.env.DATA_DIR = path.join(directory, 'data');
    process.env.TAGGING_ENGINE = 'none';
    await mkdir(process.env.MEDIA_ROOT); await mkdir(process.env.DATA_DIR);
    const { startTagging, taggingStatus, withTags } = await import('../lib/tags');
    assert.equal((await taggingStatus()).state, 'disabled');
    await assert.rejects(startTagging(), /disabled/);
    await writeFile(path.join(process.env.DATA_DIR, 'tags.json'), JSON.stringify({ model: 'fixture', items: { test: { version: 'v1', tags: ['tree'] } } }));
    const tagged = await withTags({ items: [{ id: 'test', version: 'v1' } as any] });
    assert.deepEqual(tagged.items[0].tags, ['tree']);
    const { GET } = await import('../app/api/artworks/route');
    const response = await GET(new Request('http://localhost/api/artworks'));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.items, []);
    assert.equal(body.refreshing, false);
    assert.equal(typeof body.indexedAt, 'number');
    assert.equal('root' in body, false);
  } finally { process.env = original; await rm(directory, { recursive: true, force: true }); }
});
