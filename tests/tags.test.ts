import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachTags } from '../lib/tags';
import type { Artwork } from '../lib/types';

test('tags follow file versions and failed records stay retryable', () => {
  const items = ['current', 'changed', 'failed', 'new'].map(id => ({ id, version: 'v2' } as Artwork));
  const catalog = { root: '/media', items };
  const result = attachTags(catalog, { model: 'RAM++', items: {
    current: { version: 'v2', tags: ['tree', 'house'] },
    changed: { version: 'v1', tags: ['old subject'] },
    failed: { version: 'v2', tags: [], error: 'Unreadable preview' },
  } });
  assert.deepEqual(result.items.map(item => [item.tagStatus, item.tags]), [
    ['tagged', ['tree', 'house']], ['pending', []], ['error', []], ['pending', []],
  ]);
  assert.equal(catalog.items[0].tags, undefined);
});
