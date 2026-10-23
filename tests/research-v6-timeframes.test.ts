import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeProviderOhlcv } from '../src/research/v6/data-contract';
import { aggregateMinuteTimeframes, completedBarsAt, requireCompletedHistory } from '../src/research/v6/timeframes';
import type { RawOhlcvRow } from '../src/research/v6/types';

const MINUTE = 60_000;
const start = Date.UTC(2026, 0, 1);

function rows(count: number): RawOhlcvRow[] {
  return Array.from({ length: count }, (_, index) => ({
    openTime: start + index * MINUTE,
    open: 100 + index,
    high: 102 + index,
    low: 99 - index / 10,
    close: 101 + index,
    volume: index + 1,
  }));
}

function minuteCandles(count: number) {
  return normalizeProviderOhlcv(rows(count)).normalized;
}

test('UTC-aligned aggregation preserves OHLCV semantics exactly', () => {
  const aggregated = aggregateMinuteTimeframes(minuteCandles(10), ['5m']);
  assert.equal(aggregated['5m'].length, 2);
  assert.deepEqual(aggregated['5m'][0], {
    openTime: start,
    closeTime: start + 5 * MINUTE,
    open: 100,
    high: 106,
    low: 98.6,
    close: 105,
    volume: 15,
  });
});

test('a higher timeframe bar is unavailable until its right edge has completed', () => {
  const bars = aggregateMinuteTimeframes(minuteCandles(10), ['5m'])['5m'];
  assert.deepEqual(completedBarsAt(bars, '5m', start + 5 * MINUTE - 1), []);
  assert.equal(completedBarsAt(bars, '5m', start + 5 * MINUTE).length, 1);
  assert.equal(completedBarsAt(bars, '5m', start + 10 * MINUTE).length, 2);
});

test('mutating every future base bar cannot change prior completed aggregates or available history', () => {
  const base = minuteCandles(15);
  const first = aggregateMinuteTimeframes(base, ['5m'])['5m'];
  const before = completedBarsAt(first, '5m', start + 10 * MINUTE);
  for (let index = 10; index < base.length; index += 1) {
    base[index] = { ...base[index], open: 9_999, high: 10_000, low: 9_998, close: 9_999, volume: 999 };
  }
  const second = aggregateMinuteTimeframes(base, ['5m'])['5m'];
  assert.deepEqual(completedBarsAt(second, '5m', start + 10 * MINUTE), before);
});

test('partial parent bars and insufficient completed history fail closed', () => {
  assert.throws(() => aggregateMinuteTimeframes(minuteCandles(6), ['5m']));
  const bars = aggregateMinuteTimeframes(minuteCandles(10), ['5m'])['5m'];
  assert.throws(() => requireCompletedHistory(bars, '5m', start + 5 * MINUTE, 2));
  assert.deepEqual(requireCompletedHistory(bars, '5m', start + 10 * MINUTE, 2), bars);
  assert.throws(() => completedBarsAt([{ ...bars[0], closeTime: bars[0].openTime }], '5m', bars[0].openTime));
});
