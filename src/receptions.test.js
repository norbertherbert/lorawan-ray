import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildReceptionPageQuery,
  emptyReceptionFilters,
  normalizeReceptionFilters,
  parseLocalDateTime,
} from './receptions.js';

test('normalizes gateway and device hexadecimal identifiers', () => {
  assert.deepEqual(
    normalizeReceptionFilters({
      from: '',
      to: '',
      gatewayId: '10:32:54:76:98:ba:dc:fe',
      devAddr: '26-01-1a-bc',
    }),
    {
      from: '',
      to: '',
      gatewayId: '1032547698BADCFE',
      devAddr: '26011ABC',
    },
  );
});

test('builds an unfiltered lookahead page query', () => {
  const result = buildReceptionPageQuery({ page: 2, pageSize: 25, filters: emptyReceptionFilters });
  assert.doesNotMatch(result.text, /WHERE/);
  assert.deepEqual(result.variables, { limit: 26, start: 50 });
});

test('adds only active filters as bound query variables', () => {
  const result = buildReceptionPageQuery({
    page: 0,
    pageSize: 50,
    filters: {
      from: '2026-08-26 10:00:00',
      to: '2026-08-26 12:00:00',
      gatewayId: '1032547698BADCFE',
      devAddr: '26011ABC',
    },
  });

  assert.match(result.text, /gateway\.ingested_at >= \$from/);
  assert.match(result.text, /gateway\.ingested_at <= \$to/);
  assert.match(result.text, /gateway\.gateway_id = \$gateway_id/);
  assert.match(result.text, /gateway\.gateway_id = \$legacy_gateway_id/);
  assert.match(result.text, /lorawan\.dev_addr = \$dev_addr/);
  assert.equal(result.variables.limit, 51);
  assert.equal(result.variables.start, 0);
  assert.equal(result.variables.gateway_id, '1032547698BADCFE');
  assert.equal(result.variables.legacy_gateway_id, '10:32:54:76:98:BA:DC:FE');
  assert.equal(result.variables.dev_addr, '26011ABC');
  assert.ok(result.variables.from instanceof Date);
  assert.ok(result.variables.to instanceof Date);
});

test('treats date-only bounds as the start and end of their local day', () => {
  const from = parseLocalDateTime('2026-08-26');
  const to = parseLocalDateTime('2026-08-26', { endOfDay: true });

  assert.deepEqual(
    [from.getHours(), from.getMinutes(), from.getSeconds(), from.getMilliseconds()],
    [0, 0, 0, 0],
  );
  assert.deepEqual(
    [to.getHours(), to.getMinutes(), to.getSeconds(), to.getMilliseconds()],
    [23, 59, 59, 999],
  );
});
