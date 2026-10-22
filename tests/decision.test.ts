import assert from 'node:assert/strict';
import test from 'node:test';
import { averageTrueRange, evaluateDecision, exponentialMovingAverage, hasApproximateDailyFearGreedCadence, simpleMovingAverage, type FearGreedValue, type LabCandle } from '../src/domain/decision';

const HOUR = 60 * 60 * 1_000;
const DAY = 24 * HOUR;
const asOf = Date.UTC(2026, 0, 15, 12);

function candle(openTime: number, close: number, range = 2): LabCandle {
  return { openTime, open: close, high: close + range, low: close - range, close };
}

function validInput(): { daily: LabCandle[]; hourly: LabCandle[]; fearGreed: FearGreedValue[]; asOf: number } {
  const dailyBoundary = Math.floor(asOf / DAY) * DAY;
  const daily = Array.from({ length: 220 }, (_, index) => candle(dailyBoundary - (220 - index) * DAY, 1_000 + index, 4));
  const priorSevenMean = (daily.slice(-8, -1).reduce((sum, item) => sum + item.close, 0)) / 7;
  const hourly = Array.from({ length: 30 }, (_, index) => candle(asOf - (30 - index) * HOUR, priorSevenMean - 10, 2));
  hourly[hourly.length - 2] = { openTime: asOf - 2 * HOUR, open: priorSevenMean - 1, high: priorSevenMean + 1, low: priorSevenMean - 2, close: priorSevenMean };
  hourly[hourly.length - 1] = { openTime: asOf - HOUR, open: priorSevenMean, high: priorSevenMean + 3, low: priorSevenMean, close: priorSevenMean + 1 };
  const fearGreed = Array.from({ length: 7 }, (_, index) => ({
    value: 58 - index,
    classification: index === 0 ? 'Greed' : 'Neutral',
    timestamp: asOf - (index + 1) * DAY,
  }));
  return { daily, hourly, fearGreed, asOf };
}

test('indicator math uses a stable SMA-seeded EMA and Wilder ATR', () => {
  assert.equal(simpleMovingAverage([1, 2, 3, 4, 5], 3), 4);
  assert.equal(exponentialMovingAverage([1, 2, 3, 4, 5], 3), 4);
  const bars = [
    candle(0, 10, 1),
    { openTime: HOUR, open: 10, high: 13, low: 9, close: 12 },
    { openTime: 2 * HOUR, open: 12, high: 15, low: 11, close: 14 },
    { openTime: 3 * HOUR, open: 14, high: 16, low: 12, close: 13 },
  ];
  assert.equal(averageTrueRange(bars, 2), 4);
});

test('confirmed bullish reclaim creates a next-hour-open proposal without inventing a confirming-close fill', () => {
  const result = evaluateDecision(validInput());
  assert.equal(result.action, 'ENTER LONG');
  assert.equal(result.evidenceScore.label, 'action-rule coverage, not probability');
  assert.equal(result.setup.confirmedReclaim, true);
  assert.equal(result.setup.executionModel, 'NEXT HOUR OPEN');
  assert.equal(result.setup.proposedExecutionAt, asOf);
  assert.equal(result.setup.entry, null);
  assert.ok(result.setup.proposedInvalidation !== null && result.setup.proposedInvalidation < result.setup.pivot!);
  assert.equal(result.setup.target1, null);
  assert.equal(result.setup.target2, null);
  assert.equal(result.setup.expiry, asOf);
  assert.match(result.setup.executionInstruction, /actual fill/);
  assert.ok(result.setup.ema21h !== null);
  assert.ok(result.actionRules.every((rule) => rule.passed));
});

test('future mutation and incomplete bars cannot affect an as-of decision', () => {
  const input = validInput();
  input.hourly.push(candle(asOf, 1));
  input.daily.push(candle(asOf, 1));
  const first = evaluateDecision(input);
  input.hourly.at(-1)!.close = 999_999;
  input.hourly.at(-1)!.high = 999_999;
  input.hourly.at(-1)!.low = 1;
  input.daily.at(-1)!.close = 999_999;
  input.daily.at(-1)!.high = 999_999;
  input.daily.at(-1)!.low = 1;
  const second = evaluateDecision(input);
  assert.deepEqual(second, first);
});

test('a failed strict reclaim fails closed rather than entering on a pivot alone', () => {
  const input = validInput();
  input.hourly.at(-2)!.close += 1;
  input.hourly.at(-2)!.high += 1;
  const result = evaluateDecision(input);
  assert.equal(result.action, 'NO TRADE');
  assert.equal(result.setup.confirmedReclaim, false);
  assert.equal(result.setup.entry, null);
  assert.equal(result.setup.proposedInvalidation, null);
  assert.equal(result.actionRules.find((rule) => rule.id === 'hourly-reclaim')?.passed, false);
});

test('a gapped trailing required candle range fails closed even when its count remains sufficient', () => {
  const input = validInput();
  const first = input.daily[0];
  input.daily[110] = { ...input.daily[110], openTime: input.daily[111].openTime };
  input.daily.unshift(candle(first.openTime - DAY, first.close - 1, 4));
  const result = evaluateDecision(input);
  assert.equal(result.data.dailyCompleted, 220);
  assert.equal(result.data.dataQualityPass, false);
  assert.equal(result.action, 'NO TRADE');
  assert.equal(result.actionRules.find((rule) => rule.id === 'daily-history')?.passed, false);
});

test('Fear & Greed changes cannot alter action-rule coverage, action, or proposed execution', () => {
  const firstInput = validInput();
  const secondInput = validInput();
  secondInput.fearGreed = secondInput.fearGreed.map((item, index) => ({ ...item, value: index === 0 ? 1 : 99, classification: 'Extreme Fear' }));
  const first = evaluateDecision(firstInput);
  const second = evaluateDecision(secondInput);
  assert.equal(first.action, second.action);
  assert.deepEqual(first.evidenceScore, second.evidenceScore);
  assert.deepEqual(first.actionRules, second.actionRules);
  assert.deepEqual(first.setup, second.setup);
  assert.equal(second.fearGreed.contextOnly, true);
  assert.notEqual(first.fearGreed.value, second.fearGreed.value);
});

test('stale or missing Fear & Greed is disclosed separately and cannot change the v1 action score', () => {
  const stale = validInput();
  stale.fearGreed = stale.fearGreed.map((entry) => ({ ...entry, timestamp: entry.timestamp - 5 * DAY }));
  const fresh = evaluateDecision(validInput());
  const result = evaluateDecision(stale);
  assert.equal(result.action, fresh.action);
  assert.deepEqual(result.evidenceScore, fresh.evidenceScore);
  assert.equal(result.data.dataQualityPass, true);
  assert.equal(result.contextHealth.available, false);
  assert.equal(result.contextHealth.rules.find((rule) => rule.id === 'fear-greed-freshness')?.passed, false);
});

test('seven-day Fear & Greed direction requires approximately daily cadence and a six-day span', () => {
  const input = validInput();
  assert.equal(hasApproximateDailyFearGreedCadence(input.fearGreed), true);
  assert.equal(evaluateDecision(input).fearGreed.direction7d, 'rising');

  const irregular = validInput();
  irregular.fearGreed[3].timestamp = irregular.fearGreed[2].timestamp - HOUR;
  assert.equal(hasApproximateDailyFearGreedCadence(irregular.fearGreed), false);
  const result = evaluateDecision(irregular);
  assert.equal(result.fearGreed.direction7d, 'unavailable');
  assert.equal(result.contextHealth.rules.find((rule) => rule.id === 'fear-greed-cadence')?.passed, false);
  assert.equal(result.action, evaluateDecision(validInput()).action);
});
