import assert from 'node:assert/strict';
import test from 'node:test';
import { exportPacketsToCsv } from './packetCsv.ts';

test('exports every filtered cursor page with all table and packet-detail columns', async () => {
  const requests = [];
  const packets = [
    packet('first', '2026-09-04T12:00:00.000Z', 'plain'),
    packet('second', '2026-09-04T11:00:00.000Z', 'value, with "quotes"'),
  ];
  const dataSource = {
    async search(request) {
      requests.push(request);
      const secondPage = Boolean(request.page.after);
      return {
        items: [packets[secondPage ? 1 : 0]],
        pageInfo: {
          startCursor: secondPage ? 'second' : 'first',
          endCursor: secondPage ? 'second' : 'first',
          hasPreviousPage: secondPage,
          hasNextPage: !secondPage,
        },
      };
    },
    async getById(id) {
      return packets.find((candidate) => candidate.id === id);
    },
  };

  const progress = [];
  const csv = await exportPacketsToCsv({
    dataSource,
    filters: { packet: { devAddrs: ['first', 'second'] } },
    onProgress: (count) => progress.push(count),
  });

  const lines = csv.trimEnd().split('\r\n');
  assert.match(lines[0], /^"Timestamp","DevEUI","DevAddr","FCnt"/);
  assert.match(lines[0], /"Decoded frame \(JSON\)","Gateway receptions \(JSON\)"$/);
  assert.match(lines[1], /"first"/);
  assert.match(lines[2], /"value, with ""quotes"""/);
  assert.match(lines[2], /"\{""kind"":""unsupported""/);
  assert.deepEqual(progress, [1, 2]);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0].sorting, [{ field: 'observedAt', direction: 'desc' }]);
  assert.equal(requests[0].page.limit, 250);
  assert.deepEqual(requests[0].filters, { packet: { devAddrs: ['first', 'second'] } });
  assert.equal(requests[1].page.after, 'first');
});

function packet(devAddr, observedAt, dataRate) {
  return {
    id: devAddr,
    observedAt,
    devEui: null,
    devAddr,
    fCnt: null,
    fCntWidth: null,
    fPort: null,
    mType: 'UnconfirmedDataUp',
    modulation: 'LORA',
    dataRate,
    codingRate: null,
    hoppingChannelWidth: null,
    spreadingFactor: null,
    frequencyMHz: null,
    bestRssiDbm: null,
    bestSnrDb: null,
    bestGatewayId: null,
    receptionCount: 0,
    phyPayloadHex: '',
    analysis: {
      duplicate: false,
      possibleRetransmission: false,
      missingFrameCountBefore: null,
    },
    frame: {
      kind: 'unsupported',
      mhdr: { rawHex: '00', mType: 'Proprietary', major: 'LoRaWANR1' },
      reason: 'test frame',
    },
    receptions: [{
      id: `${devAddr}-reception`,
      gatewayId: 'gateway',
      receivedAt: observedAt,
      ingestedAt: observedAt,
      frequencyMHz: 868.1,
      modulation: 'LORA',
      dataRate: 'SF7BW125',
      spreadingFactor: 7,
      bandwidthKHz: 125,
      codingRate: '4/5',
      hoppingChannelWidth: null,
      crcStatus: 1,
      bestRssiDbm: -70,
      bestSnrDb: 8,
      signals: [],
    }],
  };
}
