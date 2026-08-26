import assert from 'node:assert/strict';
import test from 'node:test';
import { formatDate, stringifyJson } from './lib.js';

test('formats browser-local dates with fixed-width components', () => {
  const date = new Date(2026, 7, 6, 4, 5, 9);
  assert.equal(formatDate(date), '2026-08-06 04:05:09');
});

test('omits only the top-level record id from displayed JSON', () => {
  const json = stringifyJson({
    id: 'gateway_rxpk:internal',
    gateway: { id: 'nested-value', gateway_id: '1032547698BADCFE' },
    counter: 12n,
  });

  assert.deepEqual(JSON.parse(json), {
    gateway: { id: 'nested-value', gateway_id: '1032547698BADCFE' },
    counter: '12',
  });
});
