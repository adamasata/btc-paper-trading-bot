import assert from 'node:assert/strict';
import test from 'node:test';
import { runBacktest } from '../src/domain/backtest';
import { causalSignal } from '../src/domain/strategy';
import type { Candle } from '../src/domain/types';

const minute = 60_000;
function candles(length: number, price = 100): Candle[] {
  return Array.from({ length }, (_, index) => ({ openTime: index * minute, open: price, close: price }));
}

test('charges 0.1% on both sides and includes both fees in P/L', () => {
  const result = runBacktest(candles(7), {
    initialCash: 10_000,
    lookbackMinutes: 2,
    fallbackEntryIntervalMinutes: 100,
    maxHoldMinutes: 1,
  });
  assert.equal(result.trades.length, 1);
  const [trade] = result.trades;
  assert.ok(Math.abs(trade.buyFeeUsd - 9.99000999001) < 0.000001);
  assert.ok(Math.abs(trade.sellFeeUsd - 9.99000999001) < 0.000001);
  assert.ok(Math.abs(trade.profitUsd + 19.98001998002) < 0.000001);
  assert.ok(Math.abs(result.finalBalanceUsd - 9980.01998001998) < 0.000001);
});

test('causal signal excludes the decision candle future and all later candles', () => {
  const source = [100, 101, 99, 98, 100, 101].map((price, index) => ({ openTime: index * minute, open: price, close: price }));
  const baseline = causalSignal(source, 3, 3);
  const changedFuture = source.map((candle) => ({ ...candle }));
  changedFuture[4].close = 1_000_000;
  changedFuture[5].close = 0.01;
  assert.deepEqual(causalSignal(changedFuture, 3, 3), baseline);
});

test('predeclared cadence produces at least five completed, flat round trips on a representative full-day fixture', () => {
  const result = runBacktest(candles(1440), {
    lookbackMinutes: 30,
    fallbackEntryIntervalMinutes: 240,
    maxHoldMinutes: 1,
  });
  assert.ok(result.trades.length >= 5);
  assert.ok(result.trades.every((trade) => trade.exitReason === 'time-limit'));
  assert.ok(Number.isFinite(result.finalBalanceUsd));
});

test('time limit is measured fill-to-fill despite next-open execution', () => {
  const result = runBacktest(candles(15), {
    lookbackMinutes: 2,
    fallbackEntryIntervalMinutes: 100,
    maxHoldMinutes: 10,
  });
  assert.equal(result.trades[0].exitReason, 'time-limit');
  assert.equal(result.trades[0].sellTime - result.trades[0].buyTime, 10 * minute);
});

test('a live position is force-closed at the final close and records the reason', () => {
  const result = runBacktest(candles(8), {
    lookbackMinutes: 2,
    fallbackEntryIntervalMinutes: 100,
    maxHoldMinutes: 100,
  });
  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].exitReason, 'forced-close');
  assert.equal(result.trades[0].sellTime, 8 * minute);
  assert.ok(result.finalBalanceUsd > 0);
});
