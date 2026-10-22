import assert from 'node:assert/strict';
import test from 'node:test';
import { runBacktest } from '../src/domain/backtest';
import { DEFAULT_PARAMETERS, causalTrendSignal, hasBearishCross } from '../src/domain/strategy';
import type { Candle } from '../src/domain/types';

const minute = 60_000;

function flatCandles(length: number, price = 100): Candle[] {
  return Array.from({ length }, (_, index) => ({ openTime: index * minute, open: price, close: price }));
}

function risingCandles(length: number, startingPrice = 100, increment = 0.1): Candle[] {
  return Array.from({ length }, (_, index) => {
    const price = startingPrice + index * increment;
    return { openTime: index * minute, open: price, close: price };
  });
}

function approximatelyEqual(actual: number, expected: number, tolerance = 1e-9): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to equal ${expected} ± ${tolerance}`);
}

test('activity probes allocate exactly 0.1% of available cash and preserve the cash reserve', () => {
  const result = runBacktest(flatCandles(80), { activityProbeCount: 1 });
  assert.equal(result.trades.length, 1);

  const [trade] = result.trades;
  assert.equal(trade.kind, 'activity-probe');
  assert.equal(trade.allocatedCashUsd, 10);
  assert.equal(trade.costUsd, 10);
  assert.equal(trade.reserveCashUsd, 9_990);
  approximatelyEqual(trade.buyFeeUsd, 0.00999000999000999);
  approximatelyEqual(trade.sellFeeUsd, 0.00999000999000999);
  approximatelyEqual(result.finalBalanceUsd, 10_000 - trade.costUsd + trade.proceedsUsd);
  approximatelyEqual(result.totalFeesUsd, trade.buyFeeUsd + trade.sellFeeUsd);
});

test('six fixed activity opportunities yield six small, flat-ended round trips in a full window', () => {
  const result = runBacktest(flatCandles(1_440));
  const probes = result.trades.filter((trade) => trade.kind === 'activity-probe');

  assert.equal(probes.length, 6);
  assert.ok(result.trades.length >= 5);
  assert.ok(probes.every((trade) => trade.exitReason === 'scheduled-exit'));
  assert.ok(probes.every((trade) => trade.sellTime - trade.buyTime === 10 * minute));
  assert.ok(probes.slice(1).every((trade, index) => trade.buyTime - probes[index].buyTime === 240 * minute));
  approximatelyEqual(result.finalBalanceUsd, result.parameters.initialCash + result.trades.reduce((sum, trade) => sum + trade.profitUsd, 0));
  assert.equal(result.endingBtc, 0);
});

test('a core trend trade takes priority once and later fixed probe opportunities remain available', () => {
  const result = runBacktest(risingCandles(1_440));
  const coreTrades = result.trades.filter((trade) => trade.kind === 'core-trend');
  const probes = result.trades.filter((trade) => trade.kind === 'activity-probe');

  assert.equal(result.coreTradeCount, 1);
  assert.equal(coreTrades.length, 1);
  assert.equal(coreTrades[0].allocatedCashUsd, 10_000);
  assert.equal(coreTrades[0].reserveCashUsd, 0);
  assert.equal(coreTrades[0].exitReason, 'take-profit');
  assert.equal(result.activityProbeTradeCount, 5);
  assert.equal(probes.length, 5);
  assert.ok(result.trades.length >= 5);
  assert.equal(result.endingBtc, 0);
});

test('core trend values and decisions ignore later-candle mutations', () => {
  const source = risingCandles(100);
  const baseline = causalTrendSignal(source, 69, DEFAULT_PARAMETERS);
  const changedFuture = source.map((candle) => ({ ...candle }));
  changedFuture[70].close = 1_000_000;
  changedFuture[71].close = 0.01;

  assert.deepEqual(causalTrendSignal(changedFuture, 69, DEFAULT_PARAMETERS), baseline);

  const baselineRun = runBacktest(source.slice(0, 71));
  const changedRun = runBacktest(changedFuture.slice(0, 71));
  assert.deepEqual(changedRun.trades[0], baselineRun.trades[0]);
});

test('a final open core position is explicitly force-closed and leaves no BTC', () => {
  const result = runBacktest(risingCandles(61));
  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].kind, 'core-trend');
  assert.equal(result.trades[0].exitReason, 'forced-close');
  assert.equal(result.trades[0].sellTime, 61 * minute);
  assert.equal(result.endingBtc, 0);
  assert.ok(result.finalBalanceUsd > 0);
  approximatelyEqual(result.finalBalanceUsd, result.parameters.initialCash + result.trades.reduce((sum, trade) => sum + trade.profitUsd, 0));
});

test('a bearish EMA cross exits a core position at the following candle open', () => {
  const candles = risingCandles(63);
  candles[60] = { openTime: 60 * minute, open: 106, close: 90 };
  candles[61] = { openTime: 61 * minute, open: 89, close: 88 };

  assert.equal(hasBearishCross(candles, 60, DEFAULT_PARAMETERS), true);
  const result = runBacktest(candles, {
    activityProbeCount: 0,
    coreTakeProfitRate: 1,
    coreStopLossRate: 1,
  });

  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].exitReason, 'bearish-cross');
  assert.equal(result.trades[0].buyTime, 60 * minute);
  assert.equal(result.trades[0].sellTime, 61 * minute);
  assert.equal(result.trades[0].sellPrice, 89);
  assert.equal(result.endingBtc, 0);
});

test('a core position exits on its predeclared time limit and reconciles cash', () => {
  const result = runBacktest(risingCandles(65), {
    activityProbeCount: 0,
    coreTakeProfitRate: 1,
    coreStopLossRate: 1,
    coreMaxHoldMinutes: 3,
  });

  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].exitReason, 'time-limit');
  assert.equal(result.trades[0].buyTime, 60 * minute);
  assert.equal(result.trades[0].sellTime, 63 * minute);
  approximatelyEqual(result.finalBalanceUsd, result.parameters.initialCash + result.trades[0].profitUsd);
  assert.equal(result.endingBtc, 0);
});
