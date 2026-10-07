import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeDevicePayload } from './devicePayload.ts';

test('decodes version 1 with big-endian RF voltage and signed RSSI', () => {
  assert.deepEqual(decodeDevicePayload(`010E0A008D${'A5'.repeat(6)}`), {
    version: 1,
    rfVoltageMv: 3594,
    status: 0,
    rssiDbm: -115,
  });
});

test('treats a zero version 1 RF voltage as not measured', () => {
  assert.deepEqual(decodeDevicePayload(`0100000090${'A5'.repeat(39)}`), {
    version: 1,
    rfVoltageMv: null,
    status: 0,
    rssiDbm: -112,
  });
});

test('decodes version 2 signed power, RSSI, and little-endian location', () => {
  assert.deepEqual(decodeDevicePayload('02148DDEBF6813998C1EC6'), {
    version: 2,
    txPowerDbm: 20,
    rssiDbm: -115,
    location: {
      latitudeDegrees: 32.5631966,
      longitudeDegrees: -97.1076455,
    },
  });

  assert.equal(decodeDevicePayload('02F78DDEBF6813998C1EC6')?.txPowerDbm, -9);
});

test('recognizes the version 2 no-location sentinel without treating 0/0 as missing', () => {
  assert.equal(decodeDevicePayload('02148D0000008000000080')?.location, null);
  assert.deepEqual(decodeDevicePayload('02148D0000000000000000')?.location, {
    latitudeDegrees: 0,
    longitudeDegrees: 0,
  });
});

test('decodes all version 3 fields', () => {
  assert.deepEqual(
    decodeDevicePayload(`030E0A1490DEBF6813998C1EC60300${'A5'.repeat(29)}`),
    {
      version: 3,
      rfVoltageMv: 3594,
      txPowerDbm: 20,
      rssiDbm: -112,
      location: {
        latitudeDegrees: 32.5631966,
        longitudeDegrees: -97.1076455,
      },
      locationAgeSeconds: 3,
    },
  );
});

test('decodes version 3 no-location and saturated-age values', () => {
  assert.deepEqual(
    decodeDevicePayload(`030E0A14900000008000000080FFFF${'A5'.repeat(29)}`),
    {
      version: 3,
      rfVoltageMv: 3594,
      txPowerDbm: 20,
      rssiDbm: -112,
      location: null,
      locationAgeSeconds: null,
    },
  );
  assert.equal(
    decodeDevicePayload(`030E0A1490DEBF6813998C1EC6FEFF${'A5'.repeat(29)}`)?.locationAgeSeconds,
    65_534,
  );
});

test('rejects unsupported, malformed, truncated, or invalidly padded payloads', () => {
  assert.equal(decodeDevicePayload(''), null);
  assert.equal(decodeDevicePayload('04148DDEBF6813998C1EC6'), null);
  assert.equal(decodeDevicePayload('02148DDEBF6813998C1E'), null);
  assert.equal(decodeDevicePayload('02148DDEBF6813998C1EC'), null);
  assert.equal(decodeDevicePayload('02148DDEBF6813998C1EGG'), null);
  assert.equal(decodeDevicePayload(`010E0A008D${'A5'.repeat(5)}00`), null);
  assert.equal(decodeDevicePayload(`010E0A018D${'A5'.repeat(6)}`), null);
  assert.equal(decodeDevicePayload('02148D0000008000000000'), null);
  assert.equal(decodeDevicePayload(`030E0A149000000080000000800300${'A5'.repeat(29)}`), null);
  assert.equal(decodeDevicePayload(`030E0A1490DEBF6813998C1EC6FFFF${'A5'.repeat(29)}`), null);
});
