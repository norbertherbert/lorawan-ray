import type {
  GatewayReception,
  RadioSignal,
  UplinkDetails,
  UplinkSummary,
} from '../api/types.ts';
import type { DataUplinkFrame, JoinRequestFrame } from '../lorawan/types.ts';

const BASE_TIME = Date.parse('2026-08-27T12:00:00.000Z');
const GATEWAY_IDS = [
  '647FDAFFFE005E17',
  '1032547698BADCFE',
  'A84041FFFF123456',
] as const;
const DEV_ADDRS = ['26011ABC', '040306A0', '04022780', '0403A211', '04034B9A'] as const;
const DEV_EUIS = ['1122334455667788', '70B3D57ED0001001', 'A84041A1B2C3D4E5'] as const;
const FREQUENCIES_MHZ = [867.1, 867.3, 867.5, 867.7, 867.9, 868.1, 868.3, 868.5] as const;
const SPREADING_FACTORS = [7, 8, 9, 10, 11, 12] as const;

export const mockUplinks: readonly UplinkDetails[] = Array.from({ length: 60 }, (_, index) =>
  createMockUplink(index),
);

export function toUplinkSummary(details: UplinkDetails): UplinkSummary {
  const { frame: _frame, receptions: _receptions, ...summary } = details;
  return summary;
}

function createMockUplink(index: number): UplinkDetails {
  return index % 13 === 0 ? createJoinRequest(index) : createDataUplink(index);
}

function createDataUplink(index: number): UplinkDetails {
  const observedAt = timestamp(index);
  const devAddr = DEV_ADDRS[index % DEV_ADDRS.length];
  const fCnt = 6_000 + index + Math.floor(index / 9);
  const fPort = index % 8 === 0 ? null : [1, 2, 10, 100][index % 4];
  const confirmed = index % 5 === 0;
  const mType = confirmed ? 'ConfirmedDataUp' : 'UnconfirmedDataUp';
  const mhdrHex = confirmed ? '80' : '40';
  const fCtrlValue = index % 2 === 0 ? 0x80 : 0;
  const fCtrlHex = hexNumber(fCtrlValue, 2);
  const frmPayloadHex = fPort === null ? null : hexNumber(0x1020_0000 + index, 8);
  const micHex = hexNumber(0xa0b0_c000 + index, 8);
  const phyPayloadHex = [
    mhdrHex,
    reverseHexBytes(devAddr),
    fCtrlHex,
    littleEndianHex(fCnt, 2),
    fPort === null ? '' : hexNumber(fPort, 2),
    frmPayloadHex ?? '',
    micHex,
  ].join('');
  const receptions = createReceptions(index, observedAt);
  const bestReception = selectBestReception(receptions);
  const frame: DataUplinkFrame = {
    kind: 'data-uplink',
    mhdr: { rawHex: mhdrHex, mType, major: 'LoRaWANR1' },
    macPayload: {
      fhdr: {
        devAddr,
        fCtrl: {
          rawHex: fCtrlHex,
          adr: fCtrlValue & 0x80 ? true : false,
          adrAckRequest: false,
          ack: false,
          classB: false,
          fOptsLength: 0,
        },
        fCnt16: fCnt,
        fOptsHex: '',
      },
      fPort,
      frmPayloadHex,
    },
    micHex,
  };

  return {
    id: mockId(index),
    observedAt,
    devEui: null,
    devAddr,
    fCnt,
    fCntWidth: 16,
    fPort,
    mType,
    modulation: bestReception.modulation,
    dataRate: bestReception.dataRate,
    codingRate: bestReception.codingRate,
    hoppingChannelWidth: bestReception.hoppingChannelWidth,
    spreadingFactor: bestReception.spreadingFactor,
    frequencyMHz: bestReception.frequencyMHz,
    bestRssiDbm: bestReception.bestRssiDbm,
    bestSnrDb: bestReception.bestSnrDb,
    bestGatewayId: bestReception.gatewayId,
    receptionCount: receptions.length,
    phyPayloadHex,
    analysis: {
      duplicate: index > 0 && index % 14 === 0,
      possibleRetransmission: index > 0 && index % 17 === 0,
      missingFrameCountBefore: index > 0 && index % 9 === 0 ? 1 : null,
    },
    frame,
    receptions,
  };
}

function createJoinRequest(index: number): UplinkDetails {
  const observedAt = timestamp(index);
  const joinEui = '0102030405060708';
  const devEui = DEV_EUIS[Math.floor(index / 13) % DEV_EUIS.length];
  const devNonce = 0x1200 + index;
  const micHex = hexNumber(0xc0d0_e000 + index, 8);
  const phyPayloadHex = [
    '00',
    reverseHexBytes(joinEui),
    reverseHexBytes(devEui),
    littleEndianHex(devNonce, 2),
    micHex,
  ].join('');
  const receptions = createReceptions(index, observedAt);
  const bestReception = selectBestReception(receptions);
  const frame: JoinRequestFrame = {
    kind: 'join-request',
    mhdr: { rawHex: '00', mType: 'JoinRequest', major: 'LoRaWANR1' },
    macPayload: { joinEui, devEui, devNonce },
    micHex,
  };

  return {
    id: mockId(index),
    observedAt,
    devEui,
    devAddr: null,
    fCnt: null,
    fCntWidth: null,
    fPort: null,
    mType: 'JoinRequest',
    modulation: bestReception.modulation,
    dataRate: bestReception.dataRate,
    codingRate: bestReception.codingRate,
    hoppingChannelWidth: bestReception.hoppingChannelWidth,
    spreadingFactor: bestReception.spreadingFactor,
    frequencyMHz: bestReception.frequencyMHz,
    bestRssiDbm: bestReception.bestRssiDbm,
    bestSnrDb: bestReception.bestSnrDb,
    bestGatewayId: bestReception.gatewayId,
    receptionCount: receptions.length,
    phyPayloadHex,
    analysis: {
      duplicate: false,
      possibleRetransmission: false,
      missingFrameCountBefore: null,
    },
    frame,
    receptions,
  };
}

function createReceptions(index: number, observedAt: string): GatewayReception[] {
  const count = 1 + (index % GATEWAY_IDS.length);
  const lrFhss = index % 7 === 3 || index % 11 === 5;
  const spreadingFactor = lrFhss ? null : SPREADING_FACTORS[index % SPREADING_FACTORS.length];
  const frequencyMHz = FREQUENCIES_MHZ[index % FREQUENCIES_MHZ.length];

  return Array.from({ length: count }, (_, receptionIndex) => {
    const signals = createSignals(index, receptionIndex);
    const bestSignal = signals.reduce((best, signal) =>
      (signal.rssiChannelDbm ?? -Infinity) > (best.rssiChannelDbm ?? -Infinity) ? signal : best,
    );
    const receivedAt = new Date(Date.parse(observedAt) + receptionIndex * 12).toISOString();

    return {
      id: `${mockId(index)}-rx-${receptionIndex + 1}`,
      gatewayId: GATEWAY_IDS[(index + receptionIndex) % GATEWAY_IDS.length],
      receivedAt,
      ingestedAt: new Date(Date.parse(receivedAt) + 80 + receptionIndex * 15).toISOString(),
      frequencyMHz,
      modulation: lrFhss ? 'LR-FHSS' : 'LORA',
      dataRate: lrFhss ? ['M0CW137', 'M1CW336'][index % 2] : `SF${spreadingFactor}BW125`,
      spreadingFactor,
      bandwidthKHz: lrFhss ? null : 125,
      codingRate: lrFhss ? (index % 2 ? '2/3' : '1/3') : '4/5',
      hoppingChannelWidth: lrFhss ? (index % 2 ? 2 : 4) : null,
      crcStatus: 1,
      bestRssiDbm: bestSignal.rssiChannelDbm,
      bestSnrDb: bestSignal.snrDb,
      signals,
    };
  });
}

function createSignals(index: number, receptionIndex: number): RadioSignal[] {
  const count = (index + receptionIndex) % 4 === 0 ? 2 : 1;

  return Array.from({ length: count }, (_, signalIndex) => {
    const rssi = -118 + ((index * 7 + receptionIndex * 11 + signalIndex * 5) % 42);
    return {
      antenna: signalIndex,
      channel: index % 8,
      rssiChannelDbm: rssi,
      rssiSignalDbm: rssi - 1,
      snrDb: -14 + ((index * 3 + receptionIndex * 4 + signalIndex * 2) % 24) * 0.5,
      rssiStandardDeviationDb: index % 3 === 0 ? 2 : null,
      fineTimestampNs: null,
      frequencyOffsetHz: index % 4 === 0 ? -320 + index : null,
      frequencyDriftHz: index % 7 === 3 || index % 11 === 5 ? -12 + index : null,
      fineTimestampStatus: null,
    };
  });
}

function selectBestReception(receptions: GatewayReception[]): GatewayReception {
  return receptions.reduce((best, reception) =>
    (reception.bestRssiDbm ?? -Infinity) > (best.bestRssiDbm ?? -Infinity) ? reception : best,
  );
}

function timestamp(index: number): string {
  return new Date(BASE_TIME - index * 73_000).toISOString();
}

function mockId(index: number): string {
  return `mock-uplink-${String(index + 1).padStart(4, '0')}`;
}

function hexNumber(value: number, width: number): string {
  return value.toString(16).toUpperCase().padStart(width, '0').slice(-width);
}

function littleEndianHex(value: number, byteLength: number): string {
  return Array.from({ length: byteLength }, (_, byte) => hexNumber(value >> (byte * 8), 2)).join('');
}

function reverseHexBytes(value: string): string {
  return value.match(/../g)?.reverse().join('') ?? '';
}
