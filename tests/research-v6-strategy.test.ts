import assert from 'node:assert/strict';
import test from 'node:test';
import {
  V6_CANDIDATE_REGISTRY,
  anchorMetrics,
  evaluateV6ShadowDecisions,
  trailingVolumeMedian,
  validateV6CandidateRegistry,
} from '../src/research/v6/strategy';
import type { NormalizedOhlcv } from '../src/research/v6/types';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const dayStart = Date.UTC(2026, 0, 2);

function candle(openTime: number, volume = 10, price = 100, close = price): NormalizedOhlcv {
  return { openTime, closeTime: openTime + MINUTE, open: price, high: Math.max(price, close), low: Math.min(price, close), close, volume };
}

function history(minutes = 1_440): NormalizedOhlcv[] {
  return Array.from({ length: minutes }, (_, index) => candle(dayStart - minutes * MINUTE + index * MINUTE));
}

function atDayMinute(minutes: number, volume = 10, price = 100, close = price): NormalizedOhlcv {
  return candle(dayStart + minutes * MINUTE, volume, price, close);
}

function decision(candles: NormalizedOhlcv[], observedExecutionOpen: number | null = null) {
  const latest = candles.at(-1)!;
  return evaluateV6ShadowDecisions({
    candles,
    asOf: latest.closeTime,
    observedExecutionOpen: observedExecutionOpen === null ? null : { openTime: latest.closeTime, open: observedExecutionOpen },
  });
}

function candidate(result: ReturnType<typeof decision>, id = 'v6-avwap-vrel3-accept60-a025') {
  const found = result.candidates.find((item) => item.candidateId === id);
  assert.ok(found);
  return found;
}

test('v6 registry is frozen to exactly three preregistered 25% candidates', () => {
  assert.doesNotThrow(() => validateV6CandidateRegistry(V6_CANDIDATE_REGISTRY));
  assert.equal(V6_CANDIDATE_REGISTRY.length, 3);
  assert.throws(() => validateV6CandidateRegistry([...V6_CANDIDATE_REGISTRY, { ...V6_CANDIDATE_REGISTRY[0], id: 'fourth' }]), /exactly three/);
  assert.throws(() => validateV6CandidateRegistry(V6_CANDIDATE_REGISTRY.map((item) => item.id.endsWith('5-accept60-a025') ? { ...item, anchorVolumeMultiplier: 6 } : item)), /does not match/);
  assert.throws(() => validateV6CandidateRegistry(V6_CANDIDATE_REGISTRY.map((item) => ({ ...item, allocationFraction: 0.5 }))), /does not match/);
});

test('relative-volume median excludes the current bar and anchor threshold is inclusive', () => {
  const candles = history();
  candles.push(atDayMinute(0, 30));
  assert.equal(trailingVolumeMedian(candles, 1_440), 10);
  assert.equal(candidate(decision(candles)).state, 'waiting_for_assessment');

  const below = history();
  below.push(atDayMinute(0, 29.999));
  assert.equal(candidate(decision(below)).state, 'waiting_for_anchor');
});

test('AVWAP and participation use typical price and precise anchor ranges', () => {
  const candles = [
    { ...candle(0, 2, 100, 102), high: 106, low: 96 }, // typical 101.333...
    { ...candle(MINUTE, 3, 104, 105), high: 108, low: 102 }, // typical 105
    { ...candle(2 * MINUTE, 5, 110, 111), high: 114, low: 108 }, // typical 111
  ];
  const metrics = anchorMetrics(candles, 0, 2);
  assert.equal(metrics.participationQ, 4);
  assert.equal(metrics.avwap, (2 * ((106 + 96 + 102) / 3) + 3 * ((108 + 102 + 105) / 3) + 5 * ((114 + 108 + 111) / 3)) / 10);
});

test('assessment is exactly the sixtieth completed minute and creates only a next-open intent', () => {
  const candles = [...history(), atDayMinute(0, 30)];
  for (let minute = 1; minute <= 60; minute += 1) candles.push(atDayMinute(minute, 1, 101, 101));
  const pending = candidate(decision(candles));
  assert.equal(pending.state, 'entry_ready');
  assert.equal(pending.assessmentTime, dayStart + 60 * MINUTE);
  assert.equal(pending.execution.openTime, dayStart + 61 * MINUTE);
  assert.equal(pending.execution.executable, false);
  assert.equal(pending.paperAccount.preBuyEquityUsd, 10_000);
  assert.equal(pending.paperAccount.intendedAllocationUsd, 2_500);

  candles.push(atDayMinute(61, 1, 102, 102));
  const filled = candidate(decision(candles));
  assert.equal(filled.state, 'long');
  assert.equal(filled.filledEntriesToday, 1);
});

test('future bars are rejected rather than allowed to mutate a past decision', () => {
  const candles = [...history(), atDayMinute(0, 30)];
  const asOf = candles.at(-1)!.closeTime;
  const result = evaluateV6ShadowDecisions({ candles: [...candles, atDayMinute(1, 1)], asOf, observedExecutionOpen: null });
  assert.ok(result.candidates.every((item) => item.state === 'data_invalid'));
});

test('failed anchors expire and later valid anchors remain eligible', () => {
  const candles = [...history(), atDayMinute(0, 30)];
  for (let minute = 1; minute <= 60; minute += 1) candles.push(atDayMinute(minute, 0.1, 99, 99));
  candles.push(atDayMinute(61, 30, 100, 100));
  for (let minute = 62; minute <= 121; minute += 1) candles.push(atDayMinute(minute, 1, 102, 102));
  const result = candidate(decision(candles));
  assert.equal(result.state, 'entry_ready');
  assert.equal(result.anchorTime, dayStart + 61 * MINUTE);
  assert.equal(result.assessmentTime, dayStart + 121 * MINUTE);
});

test('cutoff precludes an otherwise valid noon-or-later entry', () => {
  const candles = [...history(), ...Array.from({ length: 660 }, (_, minute) => atDayMinute(minute, 10)), atDayMinute(660, 30)];
  for (let minute = 661; minute <= 720; minute += 1) candles.push(atDayMinute(minute, 1, 102, 102));
  const result = candidate(decision(candles));
  assert.equal(result.state, 'no_signal');
  assert.match(result.reason, /cutoff/);
});

test('AVWAP-loss exits only at 30-minute checks, then uses next open', () => {
  const candles = [...history(), atDayMinute(0, 30)];
  for (let minute = 1; minute <= 91; minute += 1) {
    const close = minute >= 90 ? 90 : 101;
    candles.push(atDayMinute(minute, 1, close, close));
  }
  const before = candidate(decision(candles.slice(0, -2)));
  assert.equal(before.state, 'long');
  const due = candidate(decision(candles.slice(0, -1)));
  assert.equal(due.state, 'exit_ready');
  assert.equal(due.execution.openTime, dayStart + 91 * MINUTE);
  assert.match(due.reason, /AVWAP/);
});

test('12-hour and UTC-boundary exits are enforced without carrying a position', () => {
  const longHold = [...history(), atDayMinute(0, 30)];
  for (let minute = 1; minute <= 781; minute += 1) longHold.push(atDayMinute(minute, 1, 101, 101));
  const maxHold = candidate(decision(longHold));
  assert.equal(maxHold.state, 'exit_ready');
  assert.match(maxHold.reason, /12-hour/);

  const boundary = [...history(), atDayMinute(660, 30)];
  // Directly exercise an already-open position by allowing a valid earlier entry that remains open into midnight.
  const nextDayStart = dayStart + DAY;
  // Latest eligible entry fills at 11:59; its 12-hour decision is the 23:59 bar,
  // so the required sell open is the UTC boundary where boundary-flat takes precedence.
  const carry = [...history(), ...Array.from({ length: 658 }, (_, minute) => atDayMinute(minute, 10)), atDayMinute(658, 30)];
  for (let minute = 659; minute < 1_440; minute += 1) carry.push(atDayMinute(minute, 1, 101, 101));
  carry.push(candle(nextDayStart, 1, 101, 101));
  const result = candidate(decision(carry));
  assert.equal(result.filledEntriesToday, 0);
  assert.equal(result.state, 'waiting_for_anchor');
  assert.equal(result.lastExitReason, 'utc_boundary');
  void boundary;
});

test('the UTC boundary emits a sell intent at 23:59 and records the 00:00 observed-open fill', () => {
  const carry = [...history(), ...Array.from({ length: 658 }, (_, minute) => atDayMinute(minute, 10)), atDayMinute(658, 30)];
  for (let minute = 659; minute < 1_440; minute += 1) carry.push(atDayMinute(minute, 1, 101, 101));
  const intent = candidate(decision(carry));
  assert.equal(intent.state, 'exit_ready');
  assert.equal(intent.execution.intent, 'SELL_AT_NEXT_OPEN');
  assert.equal(intent.execution.openTime, dayStart + DAY);
  assert.match(intent.reason, /UTC boundary/);

  const filled = candidate(decision(carry, 101));
  assert.equal(filled.state, 'waiting_for_anchor');
  assert.equal(filled.execution.intent, 'NONE');
  assert.equal(filled.lastExitReason, 'utc_boundary');
  assert.equal(filled.paperAccount.btcQuantity, 0);
});

test('initial partial UTC-day candles warm the median but cannot produce strategy actions', () => {
  const middayStart = dayStart - 12 * 60 * MINUTE;
  const partial = Array.from({ length: 720 }, (_, index) => candle(middayStart + index * MINUTE, index === 0 ? 100 : 10));
  const beforeBoundary = candidate(decision(partial));
  assert.equal(beforeBoundary.state, 'waiting_for_anchor');
  assert.match(beforeBoundary.reason, /warm-up only/);

  partial.push(candle(dayStart, 10));
  const afterBoundary = candidate(decision(partial));
  assert.equal(afterBoundary.state, 'insufficient_history');
  assert.doesNotMatch(afterBoundary.reason, /Initial partial UTC day/);
});

test('the second entry uses 25% of changed account equity after realized P/L and fees', () => {
  const candles = [...history(), atDayMinute(0, 30)];
  for (let minute = 1; minute <= 60; minute += 1) candles.push(atDayMinute(minute, 1, 101, 101));
  candles.push(atDayMinute(61, 1, 101, 101));
  for (let minute = 62; minute <= 89; minute += 1) candles.push(atDayMinute(minute, 1, 101, 101));
  candles.push(atDayMinute(90, 1, 90, 90));
  candles.push(atDayMinute(91, 1, 90, 90));
  candles.push(atDayMinute(92, 30, 101, 101));
  for (let minute = 93; minute <= 153; minute += 1) candles.push(atDayMinute(minute, 1, 102, 102));
  const result = candidate(decision(candles));
  assert.equal(result.state, 'long');
  assert.equal(result.filledEntriesToday, 2);
  assert.ok((result.paperAccount.preBuyEquityUsd ?? 10_000) < 10_000);
  assert.equal(result.paperAccount.intendedAllocationUsd, (result.paperAccount.preBuyEquityUsd ?? 0) * 0.25);
});

test('the daily cap prevents a third entry and reports a synthetic passed path', () => {
  const candles = [...history()];
  for (const anchorMinute of [0, 92, 184]) {
    candles.push(atDayMinute(anchorMinute, 30));
    for (let minute = anchorMinute + 1; minute <= anchorMinute + 61; minute += 1) {
      const close = minute === anchorMinute + 60 ? 101 : minute === anchorMinute + 90 ? 90 : 101;
      candles.push(atDayMinute(minute, 1, close, close));
    }
    for (let minute = anchorMinute + 62; minute <= anchorMinute + 91; minute += 1) candles.push(atDayMinute(minute, 1, 90, 90));
  }
  const result = candidate(decision(candles));
  assert.equal(result.filledEntriesToday, 2);
  assert.equal(result.completedRoundTripsToday, 2);
  assert.equal(result.state, 'no_signal');
});

test('a no-anchor path remains a no-signal/waiting shadow state without a trade claim', () => {
  const result = candidate(decision([...history(), ...Array.from({ length: 120 }, (_, index) => atDayMinute(index, 10))]));
  assert.equal(result.state, 'waiting_for_anchor');
  assert.equal(result.execution.intent, 'NONE');
});
