import type { NumericRange, PacketErrorRateResult } from './types.ts';

export function calculatePacketErrorRate(
  frameCounters: readonly number[],
  requestedRange?: NumericRange,
): PacketErrorRateResult | null {
  const uniqueCounters = [...new Set(frameCounters)]
    .filter((value) => Number.isInteger(value))
    .sort((left, right) => left - right);
  const firstFCnt = requestedRange?.minimum ?? uniqueCounters[0];
  const lastFCnt = requestedRange?.maximum ?? uniqueCounters[uniqueCounters.length - 1];

  if (firstFCnt === undefined || lastFCnt === undefined || firstFCnt > lastFCnt) return null;

  const received = uniqueCounters.filter((value) => value >= firstFCnt && value <= lastFCnt).length;
  const expected = lastFCnt - firstFCnt + 1;
  const missing = Math.max(0, expected - received);

  return {
    percentage: expected === 0 ? 0 : (missing / expected) * 100,
    received,
    expected,
    missing,
    firstFCnt,
    lastFCnt,
  };
}
