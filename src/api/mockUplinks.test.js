import assert from 'node:assert/strict';
import test from 'node:test';
import { MockUplinkDataSource } from './mockUplinks.ts';
import { mockUplinks } from '../mocks/uplinks.ts';

test('mock data models logical uplinks with multiple gateway receptions', () => {
  assert.equal(mockUplinks.length, 60);
  assert.ok(mockUplinks.some(({ receptions }) => receptions.length > 1));
  assert.ok(mockUplinks.some(({ frame }) => frame.kind === 'join-request'));
  assert.ok(mockUplinks.some(({ frame }) => frame.kind === 'data-uplink'));
  assert.ok(
    mockUplinks.some(
      ({ modulation, dataRate, spreadingFactor }) =>
        modulation === 'LR-FHSS' && String(dataRate).startsWith('M') && spreadingFactor === null,
    ),
  );
});

test('filters LR-FHSS packets by modulation and data-rate identifier', async () => {
  const source = new MockUplinkDataSource();
  const page = await source.search({
    page: { limit: 250 },
    filters: { packet: { modulations: ['LR-FHSS'], dataRates: ['M0CW137'] } },
  });

  assert.ok(page.items.length > 0);
  assert.ok(page.items.every(({ modulation, dataRate }) => modulation === 'LR-FHSS' && dataRate === 'M0CW137'));
});

test('uses stable cursors without overlapping adjacent pages', async () => {
  const source = new MockUplinkDataSource();
  const first = await source.search({ page: { limit: 7 } });
  const second = await source.search({
    page: { limit: 7, after: first.pageInfo.endCursor },
  });

  assert.equal(first.items.length, 7);
  assert.equal(second.items.length, 7);
  assert.equal(first.pageInfo.hasPreviousPage, false);
  assert.equal(second.pageInfo.hasPreviousPage, true);
  assert.equal(new Set([...first.items, ...second.items].map(({ id }) => id)).size, 14);
});

test('applies combined radio filters to the same gateway reception', async () => {
  const source = new MockUplinkDataSource();
  const page = await source.search({
    page: { limit: 250 },
    filters: {
      reception: {
        gatewayIds: ['64:7f:da:ff:fe:00:5e:17'],
        rssiDbm: { minimum: -100 },
      },
    },
  });

  assert.ok(page.items.length > 0);
  for (const item of page.items) {
    const details = await source.getById(item.id);
    assert.ok(
      details.receptions.some(
        ({ gatewayId, bestRssiDbm }) =>
          gatewayId === '647FDAFFFE005E17' && bestRssiDbm !== null && bestRssiDbm >= -100,
      ),
    );
  }
});

test('sorts nullable counters after concrete values', async () => {
  const source = new MockUplinkDataSource();
  for (const direction of ['asc', 'desc']) {
    const page = await source.search({
      page: { limit: 250 },
      sorting: [{ field: 'fCnt', direction }],
    });
    const firstNull = page.items.findIndex(({ fCnt }) => fCnt === null);

    assert.ok(firstNull > 0);
    assert.ok(page.items.slice(0, firstNull).every(({ fCnt }) => fCnt !== null));
    assert.ok(page.items.slice(firstNull).every(({ fCnt }) => fCnt === null));
  }
});

test('rejects stale cursors when filters change', async () => {
  const source = new MockUplinkDataSource();
  const first = await source.search({ page: { limit: 5 } });

  await assert.rejects(
    source.search({
      page: { limit: 5, after: first.pageInfo.endCursor },
      filters: { packet: { mTypes: ['JoinRequest'] } },
    }),
    ({ code }) => code === 'invalid_cursor',
  );
});
