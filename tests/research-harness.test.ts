import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWindows, candleStreakCycles, developmentQualificationGate, evaluateCandidateWindow, selectQualifiedDevelopmentCandidate, summarizeProtocol, type AggregateMetrics, type CandidateMetrics, type ResearchCandidate } from '../src/research/harness';
import type { Candle } from '../src/domain/types';

const MINUTE = 60_000;
function candles(length: number, start = 0, increment = 0): Candle[] {
  return Array.from({ length }, (_, index) => {
    const price = 100 + index * increment;
    return { openTime: start + index * MINUTE, open: price, close: price };
  });
}

const noTrade: ResearchCandidate = {
  id: 'cash-test',
  family: 'cash',
  allocationRate: 0.25,
  params: {},
};

const buyAndHold: ResearchCandidate = {
  id: 'buy-and-hold-test',
  family: 'buy-and-hold',
  allocationRate: 1,
  params: {},
};

const fiveEntryStreak: ResearchCandidate = {
  id: 'five-entry-streak-test',
  family: 'five-entry-green-candle-streak',
  allocationRate: 0.25,
  params: {},
};

function developmentMetrics(candidate: ResearchCandidate, overrides: Partial<AggregateMetrics> = {}): CandidateMetrics {
  const aggregate: AggregateMetrics = {
    windows: 80,
    positiveWindows: 50,
    negativeWindows: 30,
    flatWindows: 0,
    positiveWindowRatio: 0.625,
    meanReturn: 0.01,
    medianReturn: 0.008,
    expectancyUsd: 12,
    profitFactor: 1.2,
    worstWindowLoss: -0.01,
    maxDrawdown: 0.04,
    totalProfitUsd: 800,
    largestPositiveWindowProfitUsd: 50,
    genuineProfitUsd: 820,
    qualificationProfitUsd: -20,
    genuineFeesUsd: 15,
    qualificationFeesUsd: 5,
    genuineRoundTrips: 200,
    qualificationRoundTrips: 10,
    ...overrides,
  };
  return { candidate, aggregate, byOffset: { '00': aggregate, '06': aggregate, '12': aggregate, '18': aggregate } };
}

test('five-entry streak signals after three completed greens, fills five next opens, charges every fill, and is flat', () => {
  const day = candles(24 * 60 + 1);
  day[0] = { ...day[0], open: 100, close: 101 };
  day[1] = { ...day[1], open: 101, close: 102 };
  day[2] = { ...day[2], open: 102, close: 103 };
  const opens = [100, 101, 102, 103, 104, 105];
  for (const [offset, open] of opens.entries()) day[offset + 3] = { ...day[offset + 3], open, close: open };

  const cycles = candleStreakCycles(day, 0, 24 * 60);
  assert.deepEqual(cycles[0], { signalIndex: 2, entryIndices: [3, 4, 5, 6, 7], exitIndex: 8 });
  const result = evaluateCandidateWindow(day, 0, 24 * 60, fiveEntryStreak);
  const allocated = 9_900 * 0.25;
  const tranche = allocated / 5;
  const quantity = opens.slice(0, 5).reduce((sum, price) => sum + tranche / (price * 1.001), 0);
  const expectedFees = opens.slice(0, 5).reduce((sum, price) => sum + tranche / (price * 1.001) * price * 0.001, 0) + quantity * opens[5] * 0.001;

  assert.equal(result.genuine.roundTrips >= 1, true);
  assert.ok(Math.abs(result.genuine.trades[0].feesUsd - expectedFees) < 1e-9);
  assert.equal(result.genuine.allocatedSleeveUsd, 9_900);
  assert.equal(result.endsFlat, true);
});

test('five-entry streak cycles do not overlap and cannot start without their sixth observable open', () => {
  const allGreen = candles(24 * 60 + 2).map((candle) => ({ ...candle, close: candle.open + 1 }));
  const cycles = candleStreakCycles(allGreen, 0, 24 * 60);
  assert.deepEqual(cycles.slice(0, 2).map((cycle) => [cycle.signalIndex, cycle.entryIndices, cycle.exitIndex]), [
    [2, [3, 4, 5, 6, 7], 8],
    [8, [9, 10, 11, 12, 13], 14],
  ]);
  for (let index = 1; index < cycles.length; index += 1) assert.ok(cycles[index].entryIndices[0] > cycles[index - 1].exitIndex);

  const boundaryOnly = candles(24 * 60 + 2);
  for (let index = 24 * 60 - 2; index <= 24 * 60; index += 1) boundaryOnly[index] = { ...boundaryOnly[index], close: boundaryOnly[index].open + 1 };
  assert.equal(candleStreakCycles(boundaryOnly, 0, 24 * 60).some((cycle) => cycle.signalIndex >= 24 * 60 - 2), false);
  const before = evaluateCandidateWindow(boundaryOnly, 0, 24 * 60, fiveEntryStreak);
  boundaryOnly[24 * 60 + 1] = { ...boundaryOnly[24 * 60 + 1], open: 1_000_000, close: 1_000_000 };
  assert.deepEqual(evaluateCandidateWindow(boundaryOnly, 0, 24 * 60, fiveEntryStreak), before);
});


test('qualification overlay supplies exactly the round-trip deficit in a dedicated one-percent sleeve', () => {
  const day = candles(24 * 60 + 1);
  const result = evaluateCandidateWindow(day, 0, 24 * 60, noTrade);

  assert.equal(result.genuine.roundTrips, 0);
  assert.equal(result.qualification.roundTrips, 5);
  assert.equal(result.total.roundTrips, 5);
  assert.equal(result.qualification.allocatedSleeveUsd, 100);
  assert.ok(result.qualification.feesUsd > 0);
  assert.equal(result.genuine.feesUsd, 0);
  assert.equal(result.total.profitUsd, result.genuine.profitUsd + result.qualification.profitUsd);
});

test('a window never reads a candle after its observable boundary open', () => {
  const all = candles(24 * 60 + 2, 0, 0.01);
  const candidate: ResearchCandidate = {
    id: 'boundary-causality',
    family: 'session-momentum',
    allocationRate: 0.6,
    params: { sessionsUtcHour: [0], lookbackMinutes: 30, minimumMomentumFraction: 0.0001, takeProfitFraction: 1, stopLossFraction: 1, maxHoldMinutes: 60 },
  };
  const first = evaluateCandidateWindow(all, 0, 24 * 60, candidate);
  all[all.length - 1] = { ...all[all.length - 1], open: 1_000_000, close: 1_000_000 };
  const second = evaluateCandidateWindow(all, 0, 24 * 60, candidate);
  assert.deepEqual(second, first);
});

test('window construction keeps chronological development sealed from holdout at every registered offset', () => {
  const start = Date.UTC(2026, 0, 1);
  const all = candles(35 * 24 * 60 + 1, start);
  const sets = buildWindows(all, [0, 6, 12, 18], 30);

  assert.equal(sets.length, 4);
  for (const set of sets) {
    assert.equal(set.windows.length, 30);
    assert.equal(set.windows.filter((window) => window.partition === 'development').length, 20);
    assert.equal(set.windows.filter((window) => window.partition === 'holdout').length, 10);
    assert.ok(set.windows.every((window, index) => index === 0 || window.startTime > set.windows[index - 1].startTime));
  }
});

test('protocol summary separates development selection from holdout evaluation and retains every offset metric', () => {
  const start = Date.UTC(2026, 0, 1);
  const all = candles(35 * 24 * 60 + 1, start, 0.001);
  const candidate: ResearchCandidate = {
    id: 'session-momentum-test',
    family: 'session-momentum',
    allocationRate: 0.25,
    params: { sessionsUtcHour: [0], lookbackMinutes: 30, minimumMomentumFraction: 0.0001, takeProfitFraction: 1, stopLossFraction: 1, maxHoldMinutes: 5 },
  };
  const summary = summarizeProtocol(all, [candidate], [0, 6, 12, 18], 30);

  assert.equal(summary.development.candidates.length, 1);
  assert.equal(summary.development.candidates[0].aggregate.windows, 20);
  assert.equal(summary.development.candidates[0].byOffset['00'].windows, 20);
  assert.equal(summary.development.candidates[0].byOffset['06'].windows, 20);
  assert.equal(summary.development.candidates[0].byOffset['12'].windows, 20);
  assert.equal(summary.development.candidates[0].byOffset['18'].windows, 20);
  assert.equal(summary.holdout.candidates.length, 1);
  assert.equal(Object.keys(summary.development.candidates[0].byOffset).length, 4);
  assert.equal(Object.keys(summary.holdout.candidates[0].byOffset).length, 4);
  assert.equal(summary.holdout.opened, false);
});

test('buy-and-hold makes one full-window genuine round trip, pays both 0.1% fees, beats cash on a rising window, and ends flat', () => {
  const day = candles(24 * 60 + 1, 0, 0.1);
  const result = evaluateCandidateWindow(day, 0, 24 * 60, buyAndHold);
  const cash = evaluateCandidateWindow(day, 0, 24 * 60, noTrade);
  const entryPrice = day[0].open;
  const exitPrice = day[24 * 60].open;
  const quantity = 9_900 / (entryPrice * 1.001);
  const expectedFees = quantity * entryPrice * 0.001 + quantity * exitPrice * 0.001;

  assert.equal(result.genuine.roundTrips, 1);
  assert.equal(result.qualification.roundTrips, 4);
  assert.equal(result.genuine.allocatedSleeveUsd, 9_900);
  assert.ok(Math.abs(result.genuine.feesUsd - expectedFees) < 1e-9);
  assert.ok(result.total.profitUsd > cash.total.profitUsd);
  assert.notEqual(result.total.profitUsd, cash.total.profitUsd);
  assert.equal(result.endsFlat, true);
});

test('development selection exhausts at most four predeclared generations and never freezes a negative candidate', () => {
  const negative = developmentMetrics({ ...buyAndHold, id: 'negative-development' }, {
    positiveWindows: 20,
    negativeWindows: 60,
    positiveWindowRatio: 0.25,
    meanReturn: -0.0024763,
    medianReturn: -0.002,
    expectancyUsd: -3,
    profitFactor: 0.3195,
    totalProfitUsd: -198,
    genuineProfitUsd: -180,
  });
  const result = selectQualifiedDevelopmentCandidate([
    { generation: 1, candidates: [negative] },
    { generation: 2, candidates: [negative] },
    { generation: 3, candidates: [negative] },
    { generation: 4, candidates: [negative] },
  ]);

  assert.equal(result.status, 'no-development-qualifier');
  assert.deepEqual(result.evaluatedGenerations, [1, 2, 3, 4]);
  assert.equal(result.frozen, null);
});

test('development selection freezes the first qualified generation before any later generation can be considered for holdout', () => {
  const negative = developmentMetrics({ ...buyAndHold, id: 'negative-development' }, { meanReturn: -0.001, medianReturn: -0.001, expectancyUsd: -1, profitFactor: 0.5, totalProfitUsd: -80, genuineProfitUsd: -70 });
  const qualified = developmentMetrics({ ...buyAndHold, id: 'qualified-development' });
  const result = selectQualifiedDevelopmentCandidate([
    { generation: 1, candidates: [negative] },
    { generation: 2, candidates: [qualified] },
    { generation: 3, candidates: [negative] },
    { generation: 4, candidates: [negative] },
  ]);

  assert.equal(result.status, 'qualified');
  assert.deepEqual(result.evaluatedGenerations, [1, 2]);
  assert.equal(result.frozen?.candidate.id, qualified.candidate.id);
});

test('v4 fixed-hold pattern families signal from completed candles, fill next opens, use one fee-aware entry and exit, and end flat', () => {
  const cases: Array<{ candidate: ResearchCandidate; configure: (day: Candle[]) => void; entry: number; exit: number }> = [
    { candidate: { id: 'green', family: 'green-streak-continuation', allocationRate: .25, params: { streakLength: 2, minimumReturnFraction: 0, holdMinutes: 3 } }, configure: (day) => { day[0] = { ...day[0], open: 100, close: 101 }; day[1] = { ...day[1], open: 101, close: 102 }; }, entry: 2, exit: 5 },
    { candidate: { id: 'red', family: 'red-streak-mean-reversion', allocationRate: .4, params: { streakLength: 2, minimumReturnFraction: 0, holdMinutes: 3 } }, configure: (day) => { day[0] = { ...day[0], open: 100, close: 99 }; day[1] = { ...day[1], open: 99, close: 98 }; }, entry: 2, exit: 5 },
    { candidate: { id: 'delayed', family: 'green-streak-delayed-continuation', allocationRate: .6, params: { streakLength: 3, minimumReturnFraction: 0, holdMinutes: 5 } }, configure: (day) => { for (let index = 0; index < 3; index += 1) day[index] = { ...day[index], open: 100 + index, close: 101 + index }; }, entry: 4, exit: 9 },
    { candidate: { id: 'majority', family: 'majority-momentum', allocationRate: .25, params: { lookbackLength: 5, minimumGreen: 4, minimumReturnFraction: 0, holdMinutes: 5 } }, configure: (day) => { for (let index = 0; index < 4; index += 1) day[index] = { ...day[index], open: 100 + index, close: 101 + index }; }, entry: 5, exit: 10 },
  ];
  for (const { candidate, configure, entry, exit } of cases) {
    const day = candles(24 * 60 + 2);
    configure(day);
    day[entry] = { ...day[entry], open: 110, close: 110 };
    day[exit] = { ...day[exit], open: 121, close: 121 };
    const result = evaluateCandidateWindow(day, 0, 24 * 60, candidate);
    const allocation = 9_900 * candidate.allocationRate;
    const quantity = allocation / (110 * 1.001);
    const expectedProfit = quantity * 121 * .999 - allocation;
    const expectedFees = quantity * 110 * .001 + quantity * 121 * .001;
    assert.ok(Math.abs(result.genuine.trades[0].profitUsd - expectedProfit) < 1e-9, candidate.id);
    assert.ok(Math.abs(result.genuine.trades[0].feesUsd - expectedFees) < 1e-9, candidate.id);
    assert.ok(result.genuine.trades.length >= 1, candidate.id);
    assert.equal(result.endsFlat, true, candidate.id);
  }
});

test('v4 patterns do not overlap, respect the genuine sleeve cap, and do not read after the boundary', () => {
  const day = candles(24 * 60 + 2).map((candle) => ({ ...candle, close: candle.open + 1 }));
  const candidate: ResearchCandidate = { id: 'non-overlap', family: 'green-streak-continuation', allocationRate: .6, params: { streakLength: 2, minimumReturnFraction: 0, holdMinutes: 10 } };
  const first = evaluateCandidateWindow(day, 0, 24 * 60, candidate);
  day[24 * 60 + 1] = { ...day[24 * 60 + 1], open: 1_000_000, close: 1_000_000 };
  const second = evaluateCandidateWindow(day, 0, 24 * 60, candidate);
  assert.deepEqual(second, first);
  assert.ok(first.genuine.roundTrips < 24 * 60 / 10, 'active fixed holds prevent overlap');
  assert.ok(first.genuine.trades.every((trade) => trade.feesUsd > 0));
  assert.equal(first.genuine.allocatedSleeveUsd, 9_900);
});

test('exploration gate supports the declared 55 and 60 percent thresholds', () => {
  const eleven = developmentMetrics({ ...buyAndHold, id: 'threshold-55' }, { positiveWindows: 11, negativeWindows: 9, positiveWindowRatio: .55 });
  assert.equal(developmentQualificationGate(eleven, .55).gates.positiveWindowsMeetExplorationThreshold, true);
  assert.equal(developmentQualificationGate(eleven).gates.positiveWindowsMeetExplorationThreshold, false);
  const twelve = developmentMetrics({ ...buyAndHold, id: 'threshold-60' }, { positiveWindows: 12, negativeWindows: 8, positiveWindowRatio: .6 });
  assert.equal(developmentQualificationGate(twelve).gates.positiveWindowsMeetExplorationThreshold, true);
});

test('v5 daily time bias enters at the next open after its completed UTC signal, charges both fees, and ignores later candles', () => {
  const start = Date.UTC(2026, 0, 1);
  const day = candles(24 * 60 + 2, start);
  for (let index = 0; index <= 240; index += 1) day[index] = { ...day[index], open: 100 + index * .01, close: 100 + index * .01 };
  day[241] = { ...day[241], open: 110, close: 110 };
  day[301] = { ...day[301], open: 121, close: 121 };
  const candidate: ResearchCandidate = { id: 'daily-v5', family: 'daily-time-bias', allocationRate: .25, params: { entryUtcHour: 4, priorFourHourSign: 1, holdMinutes: 60 } };
  const first = evaluateCandidateWindow(day, 0, 24 * 60, candidate);
  const allocation = 9_900 * .25;
  const quantity = allocation / (110 * 1.001);
  assert.ok(Math.abs(first.genuine.trades[0].profitUsd - (quantity * 121 * .999 - allocation)) < 1e-9);
  assert.ok(Math.abs(first.genuine.trades[0].feesUsd - (quantity * 110 * .001 + quantity * 121 * .001)) < 1e-9);
  day[24 * 60 + 1] = { ...day[24 * 60 + 1], open: 1_000_000, close: 1_000_000 };
  assert.deepEqual(evaluateCandidateWindow(day, 0, 24 * 60, candidate), first);
});
