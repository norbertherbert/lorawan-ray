const NO_LOCATION = -2_147_483_648;
const V1_LENGTHS = new Set([11, 44]);
const V2_LENGTH = 11;
const V3_LENGTH = 44;
const FILLER_BYTE = 0xa5;

interface DeviceLocation {
  latitudeDegrees: number;
  longitudeDegrees: number;
}

export interface DecodedDevicePayloadV1 {
  version: 1;
  rfVoltageMv: number | null;
  status: number;
  rssiDbm: number;
}

export interface DecodedDevicePayloadV2 {
  version: 2;
  txPowerDbm: number;
  rssiDbm: number;
  location: DeviceLocation | null;
}

export interface DecodedDevicePayloadV3 {
  version: 3;
  rfVoltageMv: number | null;
  txPowerDbm: number;
  rssiDbm: number;
  location: DeviceLocation | null;
  locationAgeSeconds: number | null;
}

export type DecodedDevicePayload =
  | DecodedDevicePayloadV1
  | DecodedDevicePayloadV2
  | DecodedDevicePayloadV3;

export function decodeDevicePayload(hex: string): DecodedDevicePayload | null {
  const bytes = parseHex(hex);
  if (!bytes) return null;

  switch (bytes[0]) {
    case 1:
      return decodeV1(bytes);
    case 2:
      return decodeV2(bytes);
    case 3:
      return decodeV3(bytes);
    default:
      return null;
  }
}

function decodeV1(bytes: Uint8Array): DecodedDevicePayloadV1 | null {
  if (!V1_LENGTHS.has(bytes.length) || bytes[3] !== 0 || !hasFiller(bytes, 5)) return null;

  const voltage = uint16BigEndian(bytes, 1);
  return {
    version: 1,
    rfVoltageMv: voltage === 0 ? null : voltage,
    status: bytes[3],
    rssiDbm: int8(bytes[4]),
  };
}

function decodeV2(bytes: Uint8Array): DecodedDevicePayloadV2 | null {
  if (bytes.length !== V2_LENGTH) return null;

  const location = decodeLocation(bytes, 3);
  if (location === undefined) return null;

  return {
    version: 2,
    txPowerDbm: int8(bytes[1]),
    rssiDbm: int8(bytes[2]),
    location,
  };
}

function decodeV3(bytes: Uint8Array): DecodedDevicePayloadV3 | null {
  if (bytes.length !== V3_LENGTH || !hasFiller(bytes, 15)) return null;

  const location = decodeLocation(bytes, 5);
  if (location === undefined) return null;
  const voltage = uint16BigEndian(bytes, 1);
  const rawLocationAge = uint16LittleEndian(bytes, 13);
  const locationAgeMissing = rawLocationAge === 0xffff;
  if ((location === null) !== locationAgeMissing) return null;

  return {
    version: 3,
    rfVoltageMv: voltage === 0 ? null : voltage,
    txPowerDbm: int8(bytes[3]),
    rssiDbm: int8(bytes[4]),
    location,
    locationAgeSeconds: locationAgeMissing ? null : rawLocationAge,
  };
}

function parseHex(hex: string): Uint8Array | null {
  if (!hex.length || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) return null;

  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function decodeLocation(bytes: Uint8Array, offset: number): DeviceLocation | null | undefined {
  const latitude = int32LittleEndian(bytes, offset);
  const longitude = int32LittleEndian(bytes, offset + 4);
  const latitudeMissing = latitude === NO_LOCATION;
  const longitudeMissing = longitude === NO_LOCATION;

  // The protocol defines one sentinel for the coordinate pair. A half-missing
  // pair cannot represent either a valid location or the documented no-fix state.
  if (latitudeMissing !== longitudeMissing) return undefined;
  if (latitudeMissing) return null;

  return {
    latitudeDegrees: latitude / 10_000_000,
    longitudeDegrees: longitude / 10_000_000,
  };
}

function hasFiller(bytes: Uint8Array, offset: number): boolean {
  return bytes.subarray(offset).every((byte) => byte === FILLER_BYTE);
}

function int8(value: number): number {
  return value >= 0x80 ? value - 0x100 : value;
}

function uint16BigEndian(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function uint16LittleEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function int32LittleEndian(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  );
}
