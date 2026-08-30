import assert from 'node:assert/strict';
import test from 'node:test';
import { calculatePacketErrorRate } from './packetErrorRate.ts';

test('calculates PER from unique counters across the observed counter span', () => {
  const result = calculatePacketErrorRate([100, 101, 103, 103, 105]);

  assert.deepEqual(result && { ...result, percentage: undefined }, {
    percentage: undefined,
    received: 4,
    expected: 6,
    missing: 2,
    firstFCnt: 100,
    lastFCnt: 105,
  });
  assert.ok(Math.abs(result.percentage - 100 / 3) < 1e-10);
});

test('uses explicit FCnt bounds and reports a completely missing known range', () => {
  assert.deepEqual(calculatePacketErrorRate([], { minimum: 20, maximum: 24 }), {
    percentage: 100,
    received: 0,
    expected: 5,
    missing: 5,
    firstFCnt: 20,
    lastFCnt: 24,
  });
});

test('cannot calculate PER without packets or an explicit FCnt range', () => {
  assert.equal(calculatePacketErrorRate([]), null);
});
