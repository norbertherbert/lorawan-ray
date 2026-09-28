export interface DecodedDevicePayload {
  version: number;
  batteryLevel: number;
  status: number;
  rssi: number;
}

const PAYLOAD_BYTES = 5;

export function decodeDevicePayload(hex: string): DecodedDevicePayload | null {
  if (hex.length < PAYLOAD_BYTES * 2 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) {
    return null;
  }

  const version = byteAt(hex, 0);
  const batteryLow = byteAt(hex, 1);
  const batteryHigh = byteAt(hex, 2);
  const status = byteAt(hex, 3);
  const rawRssi = byteAt(hex, 4);

  return {
    version,
    batteryLevel: batteryLow | (batteryHigh << 8),
    status,
    rssi: rawRssi >= 0x80 ? rawRssi - 0x100 : rawRssi,
  };
}

function byteAt(hex: string, index: number): number {
  return Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
}
