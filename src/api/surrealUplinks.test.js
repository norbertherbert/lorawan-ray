import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSearchQuery, SurrealUplinkDataSource } from './surrealUplinks.ts';

test('accepts packet batches up to 500 rows', () => {
  assert.equal(buildSearchQuery({ page: { limit: 500 } }).variables.limit, 501);
  assert.throws(
    () => buildSearchQuery({ page: { limit: 501 } }),
    /Page size must be an integer between 1 and 500/,
  );
});

test('builds a parameterized normalized-table query from structured filters', () => {
  const built = buildSearchQuery({
    page: { limit: 25 },
    sorting: [{ field: 'bestRssiDbm', direction: 'desc' }],
    filters: {
      packet: {
        from: '2026-08-27T10:00:00Z',
        devAddrs: ['04:03:06:a0'],
        fCnt: { minimum: 100, maximum: 200 },
        fPorts: [1, 10],
        modulations: ['LR-FHSS'],
        dataRates: ['M0CW137'],
      },
      reception: {
        gatewayIds: ['64:7f:da:ff:fe:00:5e:17'],
        spreadingFactors: [7, 12],
        frequencyMHz: { minimum: 867.1, maximum: 868.5 },
        rssiDbm: { minimum: -110 },
      },
    },
  });

  assert.match(built.text, /FROM lorawan_uplink/);
  assert.match(built.text, /gateway_ids CONTAINSANY \$gateway_ids/);
  assert.match(built.text, /SELECT VALUE id\s+FROM gateway_reception WITH INDEX reception_uplink/);
  assert.match(built.text, /uplink = \$parent\.id/);
  assert.match(built.text, /gateway_id IN \$gateway_ids/);
  assert.match(built.text, /LIMIT 1/);
  assert.doesNotMatch(built.text, /id IN \(SELECT VALUE uplink/);
  assert.match(built.text, /ORDER BY __sort_0 DESC, __sort_1 DESC, __record_key DESC/);
  assert.doesNotMatch(built.text, /040306A0|647FDAFFFE005E17/);
  assert.deepEqual(built.variables.dev_addrs, ['040306A0']);
  assert.equal(built.variables.fcnt_minimum, 100);
  assert.equal(built.variables.fcnt_maximum, 200);
  assert.deepEqual(built.variables.gateway_ids, ['647FDAFFFE005E17']);
  assert.deepEqual(built.variables.modulations, ['LR-FHSS']);
  assert.deepEqual(built.variables.data_rates, ['M0CW137']);
  assert.equal(built.variables.frequency_hz_minimum, 867_100_000);
  assert.equal(built.variables.limit, 26);
});

test('uses the denormalized gateway index path for gateway-only reception filters', () => {
  const built = buildSearchQuery({
    page: { limit: 25 },
    filters: { reception: { gatewayIds: ['64:7f:da:ff:fe:00:5e:17'] } },
  });

  assert.match(built.text, /gateway_ids CONTAINSANY \$gateway_ids/);
  assert.doesNotMatch(built.text, /FROM gateway_reception/);
  assert.deepEqual(built.variables.gateway_ids, ['647FDAFFFE005E17']);
});

test('checks radio filters against one bounded reception lookup per uplink', () => {
  const built = buildSearchQuery({
    page: { limit: 25 },
    filters: {
      reception: {
        spreadingFactors: [7],
        snrDb: { minimum: -10 },
      },
    },
  });

  assert.doesNotMatch(built.text, /gateway_ids CONTAINSANY/);
  assert.match(built.text, /SELECT VALUE id\s+FROM gateway_reception WITH INDEX reception_uplink/);
  assert.match(built.text, /uplink = \$parent\.id/);
  assert.match(built.text, /radio\.spreading_factor IN \$spreading_factors/);
  assert.match(built.text, /radio\.best_snr_db >= \$snr_db_minimum/);
  assert.match(built.text, /LIMIT 1/);
});

test('projects only the fields needed for packet summaries', () => {
  const built = buildSearchQuery({ page: { limit: 25 } });

  assert.doesNotMatch(built.text, /SELECT\s+\*/);
  assert.match(built.text, /SELECT\s+id,/);
  assert.match(built.text, /phy\.\{\s*payload_hex\s*\}/);
  assert.match(built.text, /lorawan\.\{\s*mtype\s*\}/);
  assert.doesNotMatch(built.text, /\bfirst_observed_at\b|\blast_observed_at\b|\bcorrelation\b|\breceptions\b/);
});

test('applies free-text search only to the newest 1,000 structured-filter candidates', () => {
  const built = buildSearchQuery({
    page: { limit: 25 },
    filters: {
      packet: {
        text: '2601',
        devAddrs: ['26:01:1a:bc'],
      },
      reception: { gatewayIds: ['64:7f:da:ff:fe:00:5e:17'] },
    },
  });

  assert.match(built.text, /FROM \(\s+SELECT\s+id,[\s\S]+?FROM lorawan_uplink/);
  assert.doesNotMatch(built.text, /SELECT\s+\*/);
  assert.match(built.text, /dev_addr IN \$dev_addrs/);
  assert.match(built.text, /gateway_ids CONTAINSANY \$gateway_ids/);
  assert.match(built.text, /LIMIT \$text_candidate_limit\s+\)\s+WHERE \(/);
  assert.match(built.text, /string::contains\(string::uppercase\(phy\.payload_hex\), \$text\)/);
  assert.equal(built.variables.text_candidate_limit, 1_000);
  assert.equal(built.variables.text, '2601');
  assert.deepEqual(built.variables.dev_addrs, ['26011ABC']);
});

test('keeps text-search cursors outside the bounded candidate query', async () => {
  const row = searchRow('one', 1_777_800_000_000);
  const client = scriptedClient([[[row]], [[]]]);
  const source = new SurrealUplinkDataSource(client);
  const filters = { packet: { text: '2601' } };
  const first = await source.search({ page: { limit: 1 }, filters });

  await source.search({
    page: { limit: 1, after: first.pageInfo.endCursor },
    filters,
  });

  const query = client.calls[1].query;
  assert.ok(query.indexOf('LIMIT $text_candidate_limit') < query.indexOf('observed_at < <datetime>$cursor_0'));
  assert.match(query, /ORDER BY observed_at DESC, id DESC\s+LIMIT \$limit/);
});

test('uses opaque keyset cursors for forward and backward pages', async () => {
  const rows = [searchRow('one', 1_777_800_000_000), searchRow('two', 1_777_799_999_000)];
  const client = scriptedClient([[rows], [[rows[1]]], [[rows[0]]]]);
  const source = new SurrealUplinkDataSource(client);
  const first = await source.search({ page: { limit: 1 } });
  const second = await source.search({
    page: { limit: 1, after: first.pageInfo.endCursor },
  });
  const backToFirst = await source.search({
    page: { limit: 1, before: second.pageInfo.startCursor },
  });

  assert.equal(first.items[0].id, 'one');
  assert.equal(first.pageInfo.hasNextPage, true);
  assert.equal(second.items[0].id, 'two');
  assert.equal(backToFirst.items[0].id, 'one');
  assert.match(client.calls[0].query, /ORDER BY observed_at DESC, id DESC/);
  assert.doesNotMatch(client.calls[0].query, /time::millis|ORDER BY __sort_0/);
  assert.match(client.calls[1].query, /observed_at < <datetime>\$cursor_0/);
  assert.match(client.calls[1].query, /id < type::record\("lorawan_uplink", \$cursor_record_key\)/);
  assert.match(client.calls[2].query, /observed_at > <datetime>\$cursor_0/);
  assert.equal(client.calls[1].variables.cursor_0, rows[0].observed_at);
  assert.equal(client.calls[2].variables.cursor_record_key, 'two');
});

test('preserves sub-millisecond timestamps in page cursors', async () => {
  const preciseTimestamp = '2026-09-21T15:24:02.123456Z';
  const row = searchRow('precise', Date.parse(preciseTimestamp));
  row.observed_at = preciseTimestamp;
  row.__sort_0 = preciseTimestamp;
  const client = scriptedClient([[[row]], [[]]]);
  const source = new SurrealUplinkDataSource(client);

  const first = await source.search({ page: { limit: 25 } });
  await source.search({ page: { limit: 25, before: first.pageInfo.startCursor } });

  assert.equal(client.calls[1].variables.cursor_0, preciseTimestamp);
  assert.match(client.calls[1].query, /observed_at > <datetime>\$cursor_0/);
  assert.match(client.calls[1].query, /observed_at = <datetime>\$cursor_0/);
});

test('loads the oldest edge and returns it in newest-first order', async () => {
  const oldest = searchRow('oldest', 1_777_799_998_000);
  const newer = searchRow('newer', 1_777_799_999_000);
  const extra = searchRow('extra', 1_777_800_000_000);
  const client = scriptedClient([[[oldest, newer, extra]]]);
  const source = new SurrealUplinkDataSource(client);

  const page = await source.search({ page: { limit: 2, edge: 'oldest' } });

  assert.deepEqual(page.items.map(({ id }) => id), ['newer', 'oldest']);
  assert.equal(page.pageInfo.hasPreviousPage, true);
  assert.equal(page.pageInfo.hasNextPage, false);
  assert.match(client.calls[0].query, /ORDER BY observed_at ASC, id ASC/);
});

test('loads newly arrived packets above the initial newest cursor without overlapping older rows', async () => {
  const timestamp = 1_777_800_000_000;
  const old = searchRow('old', timestamp);
  const newer = searchRow('newer', timestamp + 1000);
  const newest = searchRow('newest', timestamp + 2000);
  // Backward queries return ascending rows; the adapter restores newest-first order.
  const client = scriptedClient([[[old]], [[newer, newest]], [[]]]);
  const source = new SurrealUplinkDataSource(client);
  const filters = { packet: { devAddrs: ['040306A0'] } };
  const initial = await source.search({ page: { limit: 25 }, filters });
  assert.equal(initial.pageInfo.hasPreviousPage, false);

  const added = await source.search({
    page: { limit: 25, before: initial.pageInfo.startCursor }, filters,
  });
  assert.deepEqual([...added.items, ...initial.items].map(({ id }) => id), ['newest', 'newer', 'old']);
  assert.match(client.calls[1].query, /observed_at > <datetime>\$cursor_0/);
  assert.deepEqual(client.calls[1].variables.dev_addrs, ['040306A0']);

  const empty = await source.search({
    page: { limit: 25, before: added.pageInfo.startCursor }, filters,
  });
  assert.deepEqual(empty.items, []);
});

test('calculates PER from the latest 1,000 matching frame counters', async () => {
  const client = scriptedClient([[[100, 101, 103, 103]]]);
  const source = new SurrealUplinkDataSource(client);

  const result = await source.calculatePacketErrorRate({
    packet: {
      devAddrs: ['26011ABC'],
      fCnt: { minimum: 100, maximum: 103 },
    },
    reception: { gatewayIds: ['1032547698BADCFE'] },
  });

  assert.equal(result?.percentage, 25);
  assert.equal(result?.received, 3);
  assert.equal(result?.expected, 4);
  assert.match(client.calls[0].query, /SELECT VALUE fcnt16\s+FROM lorawan_uplink/);
  assert.match(client.calls[0].query, /ORDER BY observed_at DESC/);
  assert.match(client.calls[0].query, /LIMIT \$per_limit/);
  assert.match(client.calls[0].query, /gateway_ids CONTAINSANY \$gateway_ids/);
  assert.doesNotMatch(client.calls[0].query, /FROM gateway_reception/);
  assert.equal(client.calls[0].variables.per_limit, 1_000);
  assert.deepEqual(client.calls[0].variables.dev_addrs, ['26011ABC']);
  assert.deepEqual(client.calls[0].variables.gateway_ids, ['1032547698BADCFE']);
});

test('maps normalized uplink and reception rows into UI details', async () => {
  const uplink = searchRow('uplink-a', Date.parse('2026-08-27T12:00:00Z'));
  uplink.lorawan.fctrl_hex = 'D2';
  uplink.lorawan.fopts_hex = '0304';
  const reception = {
    id: 'gateway_reception:rx-a',
    __record_key: 'rx-a',
    __uplink_key: 'uplink-a',
    schema_version: 1,
    gateway_id: '647FDAFFFE005E17',
    observed_at: '2026-08-27T12:00:00.000Z',
    ingested_at: '2026-08-27T12:00:00.080Z',
    timestamp_source: 'gateway',
    raw_rxpk: {},
    radio: {
      frequency_hz: 868_500_000,
      modulation: 'LORA',
      data_rate: 'SF7BW125',
      spreading_factor: 7,
      bandwidth_hz: 125_000,
      best_rssi_dbm: -91,
      best_snr_db: 7.5,
      signals: [],
    },
    phy: uplink.phy,
    lorawan: uplink.lorawan,
  };
  const client = scriptedClient([[[uplink], [reception]]]);
  const source = new SurrealUplinkDataSource(client);

  const details = await source.getById('uplink-a');

  assert.equal(details.id, 'uplink-a');
  assert.equal(details.frame.kind, 'data-uplink');
  assert.deepEqual(details.frame.macPayload.fhdr.fCtrl, {
    rawHex: 'D2',
    adr: true,
    adrAckRequest: true,
    ack: false,
    classB: true,
    fOptsLength: 2,
  });
  assert.equal(details.receptions[0].frequencyMHz, 868.5);
  assert.equal(details.receptions[0].gatewayId, '647FDAFFFE005E17');
  assert.doesNotMatch(client.calls[0].query, /SELECT\s+\*/);
  assert.match(client.calls[0].query, /phy\.\{\s*payload_hex\s*\}/);
  assert.doesNotMatch(client.calls[0].query, /\braw_rxpk\b|\bcorrelation\b|\breceptions\b/);
  assert.match(client.calls[0].query, /FROM \$uplink_ids/);
  assert.match(client.calls[0].query, /WHERE uplink IN \$uplink_ids/);
  assert.equal(client.calls[0].variables.uplink_ids.length, 1);
});

function searchRow(recordKey, timestamp) {
  return {
    id: `lorawan_uplink:${recordKey}`,
    __record_key: recordKey,
    __sort_0: new Date(timestamp).toISOString(),
    schema_version: 1,
    observed_at: new Date(timestamp).toISOString(),
    first_observed_at: new Date(timestamp).toISOString(),
    last_observed_at: new Date(timestamp).toISOString(),
    correlation: { method: 'single_reception' },
    phy: {
      payload_base64: 'QAECAw==',
      payload_hex: '40A006030400011122334455',
      payload_size: 11,
      payload_hash: 'hash',
    },
    lorawan: {
      decode_status: 'decoded',
      mhdr_hex: '40',
      major: 'LoRaWANR1',
      mtype: 'UnconfirmedDataUp',
      dev_addr: '040306A0',
      fcnt16: 1,
      fport: 1,
      fctrl_hex: '00',
      fopts_hex: '',
      frm_payload_hex: '1122',
      mic_hex: '33445566',
    },
    mtype: 'UnconfirmedDataUp',
    dev_addr: '040306A0',
    fcnt16: 1,
    fport: 1,
    modulation: 'LORA',
    data_rate: 'SF7BW125',
    coding_rate: '4/5',
    receptions: [],
    reception_count: 1,
    gateway_ids: ['647FDAFFFE005E17'],
    best_gateway_id: '647FDAFFFE005E17',
    best_rssi_dbm: -91,
    best_snr_db: 7.5,
    frequency_hz: 868_500_000,
    spreading_factor: 7,
  };
}

function scriptedClient(responses) {
  const calls = [];
  return {
    calls,
    query(query, variables) {
      calls.push({ query, variables });
      const response = responses.shift();
      return {
        json() {
          return {
            async collect() {
              return response;
            },
          };
        },
      };
    },
  };
}
