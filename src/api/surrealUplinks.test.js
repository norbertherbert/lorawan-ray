import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSearchQuery, SurrealUplinkDataSource } from './surrealUplinks.ts';

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
  assert.match(built.text, /SELECT VALUE uplink FROM gateway_reception/);
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
  assert.match(client.calls[1].query, /time::millis\(observed_at\) < \$cursor_0/);
  assert.match(client.calls[2].query, /time::millis\(observed_at\) > \$cursor_0/);
  assert.equal(client.calls[2].variables.cursor_record_key, 'two');
});

test('maps normalized uplink and reception rows into UI details', async () => {
  const uplink = searchRow('uplink-a', Date.parse('2026-08-27T12:00:00Z'));
  uplink.lorawan.fctrl_hex = 'D2';
  uplink.lorawan.fopts_hex = '0304';
  const reception = {
    id: 'gateway_reception:rx-a',
    __record_key: 'rx-a',
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
  const source = new SurrealUplinkDataSource(scriptedClient([[uplink, [reception]]]));

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
});

function searchRow(recordKey, timestamp) {
  return {
    id: `lorawan_uplink:${recordKey}`,
    __record_key: recordKey,
    __sort_0: timestamp,
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
