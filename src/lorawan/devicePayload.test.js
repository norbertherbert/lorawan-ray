import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeDevicePayload } from './devicePayload.ts';

test('decodes the application payload and treats the battery as little-endian', () => {
  assert.deepEqual(decodeDevicePayload('01341207A6'), {
    version: 1,
    batteryLevel: 0x1234,
    status: 7,
    rssi: -90,
  });
});

test('ignores trailing padding bytes', () => {
  assert.deepEqual(decodeDevicePayload('02CDAB03F60000FF'), {
    version: 2,
    batteryLevel: 0xabcd,
    status: 3,
    rssi: -10,
  });
});

test('returns null for truncated or malformed hexadecimal payloads', () => {
  assert.equal(decodeDevicePayload('01020304'), null);
  assert.equal(decodeDevicePayload('010203040'), null);
  assert.equal(decodeDevicePayload('01020304GG'), null);
});
