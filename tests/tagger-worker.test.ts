import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';

test('custom engine tags previews without RAM, preserves completed items, and retries failures', async context => {
  const python = process.env.TEST_PYTHON || 'python3';
  if (spawnSync(python, ['-c', 'from PIL import Image']).status !== 0) { context.skip('Install Python and Pillow for the optional tagging worker check.'); return; }
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gallery-tagger-'));
  try {
    const file = path.join(directory, 'preview.png');
    await sharp({ create: { width: 8, height: 8, channels: 4, background: '#ff000080' } }).png().toFile(file);
    const plugin = path.join(directory, 'adapter.py');
    await writeFile(plugin, `import sys\ndef create_tagger():\n    assert 'torch' not in sys.modules\n    def tag(image):\n        assert image.mode == 'RGB'\n        return [' Tree ', 'tree', 'illustration']\n    return tag\n`);
    const input = path.join(directory, 'input.json'), output = path.join(directory, 'tags.json'), status = path.join(directory, 'status.json');
    await writeFile(input, JSON.stringify([{ id: 'good', version: 'v1', file }, { id: 'retry', version: 'v1', file: path.join(directory, 'missing.png') }]));
    const run = () => {
      const result = spawnSync(python, ['scripts/tag-artworks.py', '--engine', 'custom', '--input', input, '--output', output, '--status', status], { env: { ...process.env, TAGGER_PLUGIN: plugin }, encoding: 'utf8', timeout: 30_000 });
      assert.equal(result.status, 0, result.stderr);
    };
    run();
    const first = JSON.parse(await readFile(output, 'utf8'));
    assert.deepEqual(first.items.good.tags, ['illustration', 'tree']);
    assert.equal(first.items.good.engine, 'custom');
    assert.ok(first.items.retry.error);
    assert.equal(JSON.parse(await readFile(status, 'utf8')).failed, 1);
    await writeFile(input, JSON.stringify([{ id: 'good', version: 'v1', file }, { id: 'retry', version: 'v1', file }]));
    run();
    const second = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(second.items.good.generatedAt, first.items.good.generatedAt);
    assert.deepEqual(second.items.retry.tags, ['illustration', 'tree']);
    const finished = JSON.parse(await readFile(status, 'utf8'));
    assert.equal(finished.state, 'complete'); assert.equal(finished.processed, 1); assert.equal(finished.failed, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
