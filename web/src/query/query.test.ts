// Round trip: parse response -> merged Query -> chips -> JSON stays stable.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultQuery, describeQuery, mergeQuery } from './query.ts';

test('partial parse output merges onto defaults and renders chips', () => {
  const partial = {
    window: { start: '2028-06-01', end: '2028-06-30' },
    filters: [{ metric: 'longest_both_h', op: '>=', value: 144 }, { metric: 'bogus', op: '>=', value: 1 }],
    objectives: [{ metric: 'earth_hours', dir: 'max' }],
    k: 3,
  };
  const q = mergeQuery(defaultQuery('2026-11-14'), partial);
  assert.equal(q.filters.length, 1); // invalid metric dropped
  assert.equal(q.k, 3);
  assert.equal(q.region.type, 'polar');
  const chips = describeQuery(q);
  assert.ok(chips.find((c) => c.kind === 'window')!.text.startsWith('2028-06-01'));
  // serialise -> merge again is a fixed point
  assert.deepEqual(mergeQuery(defaultQuery('2026-11-14'), JSON.parse(JSON.stringify(q))), q);
});
