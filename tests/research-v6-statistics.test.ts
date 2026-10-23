import assert from 'node:assert/strict';
import test from 'node:test';
import { movingBlockBootstrapMean, holmBonferroni, meetsPromotionSampleGates, primaryBernoulliSample, wilsonInterval } from '../src/research/v6/statistics';
import { buildPrimaryUtcWindows, buildRobustnessOffsetWindows } from '../src/research/v6/windows';

const DAY = 24 * 60 * 60_000;
const start = Date.UTC(2026, 0, 1);
function sample(successes: number, total: number) {
  const windows = buildPrimaryUtcWindows({ startTime: start, endTime: start + total * DAY });
  return primaryBernoulliSample(windows.map((window, index) => ({ window, positive: index < successes })));
}

test('Wilson intervals are deterministic for zero, all-success, small, and ordinary primary samples', () => {
  assert.equal(wilsonInterval(sample(0, 10)).pointEstimate, 0);
  assert.equal(wilsonInterval(sample(10, 10)).pointEstimate, 1);
  const small = wilsonInterval(sample(1, 2));
  const ordinary = wilsonInterval(sample(8, 10));
  assert.ok(small.lower >= 0 && small.upper <= 1);
  assert.ok(ordinary.lower < ordinary.pointEstimate && ordinary.upper > ordinary.pointEstimate);
  const primary = buildPrimaryUtcWindows({ startTime: start, endTime: start + DAY })[0];
  assert.throws(() => primaryBernoulliSample([{ window: primary, positive: true }, { window: primary, positive: true }]));
  assert.throws(() => primaryBernoulliSample([{ window: buildRobustnessOffsetWindows({ startTime: start, endTime: start + DAY, offsetHours: [6] })[0], positive: true }]));
  assert.throws(() => primaryBernoulliSample([{ window: { ...primary, classification: 'primary_independent' }, positive: true }]));
});

test('block bootstrap requires predeclared seed and block size and rejects insufficient blocks', () => {
  const config = { blockSize: 2, iterations: 100, seed: 12345, confidence: 0.95 } as const;
  const first = movingBlockBootstrapMean([1, 2, 3, 4], config);
  const second = movingBlockBootstrapMean([1, 2, 3, 4], config);
  assert.deepEqual(first, second);
  assert.throws(() => movingBlockBootstrapMean([1, 2, 3], config));
});

test('Holm adjustment covers every registered candidate and rejects a reduced post-hoc family', () => {
  const ids = ['a', 'b', 'c'];
  const adjusted = holmBonferroni(ids, { a: 0.01, b: 0.04, c: 0.03 });
  assert.equal(adjusted.length, 3);
  assert.deepEqual(adjusted.map((entry) => entry.candidateId).sort(), ids);
  assert.throws(() => holmBonferroni(ids, { a: 0.01, b: 0.04 }));
});

test('an 8/10 result fails fixed promotion sample gates regardless of point estimate', () => {
  assert.equal(meetsPromotionSampleGates({ independentWindows: 10, closedGenuineTrades: 100 }).passed, false);
});
