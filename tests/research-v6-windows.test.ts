import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  buildPrimaryUtcWindows,
  buildRobustnessOffsetWindows,
  buildRollingFolds,
  createPartitionBook,
  freezeCandidate,
} from '../src/research/v6/windows';
import type { Fold } from '../src/research/v6/types';
import type { CandidateDefinition } from '../src/research/v6/windows';

const DAY = 24 * 60 * 60_000;
const start = Date.UTC(2026, 0, 1);

const candidate: CandidateDefinition = {
  id: 'candidate-a',
  family: 'breakout',
  featureSpec: { timeframe: '5m' },
  signalSpec: { threshold: 1 },
  exitSpec: { stopLossBps: 20 },
  allocationSpec: { sleeveFraction: 0.1 },
  maxLookbackMinutes: 60,
  maxHoldingMinutes: 120,
  duplicateFingerprint: 'breakout-5m-v1',
};

function statePath(): { directory: string; path: string } {
  const directory = mkdtempSync(`${tmpdir()}/research-v6-partitions-`);
  return { directory, path: `${directory}/partition-state.json` };
}

test('primary UTC windows are contiguous, non-overlapping, and have an integer artifact count', () => {
  const windows = buildPrimaryUtcWindows({ startTime: start, endTime: start + 4 * DAY });
  assert.equal(windows.length, 4);
  for (let index = 1; index < windows.length; index += 1) assert.equal(windows[index - 1].endTime, windows[index].startTime);
});

test('robustness offsets are correlated diagnostics and cannot construct a primary Bernoulli series', () => {
  const diagnostics = buildRobustnessOffsetWindows({ startTime: start, endTime: start + 4 * DAY, offsetHours: [6, 12] });
  assert.equal(diagnostics[0].classification, 'correlated_diagnostic');
  assert.throws(() => buildPrimaryUtcWindows({ startTime: start + 6 * 60 * 60_000, endTime: start + 3 * DAY }));
});

test('rolling validation blocks are disjoint, chronological, and purged from fit history', () => {
  const folds = buildRollingFolds({
    trainingStartTime: start,
    firstValidationStartTime: start + 10 * DAY,
    validationBlockMs: 2 * DAY,
    foldCount: 3,
    maxLookbackMinutes: 60,
    maxHoldingMinutes: 120,
  });
  const purgeMs = 180 * 60_000;
  for (let index = 0; index < folds.length; index += 1) {
    assert.equal(folds[index].validationRange.startTime - folds[index].trainRange.endTime, purgeMs);
    if (index > 0) assert.ok(folds[index - 1].validationRange.endTime <= folds[index].validationRange.startTime);
  }
});

test('externally supplied folds reject malformed chronology, overlap, and insufficient purge', () => {
  const valid = buildRollingFolds({ trainingStartTime: start, firstValidationStartTime: start + 10 * DAY, validationBlockMs: DAY, foldCount: 2, maxLookbackMinutes: 1, maxHoldingMinutes: 1 });
  const invalidCases: Fold[][] = [
    [{ ...valid[0], purgeRange: { startTime: valid[0].trainRange.endTime - 1, endTime: valid[0].validationRange.startTime } }],
    [{ ...valid[0], purgeRange: { startTime: valid[0].trainRange.endTime, endTime: valid[0].trainRange.endTime + 60_000 }, validationRange: { ...valid[0].validationRange, startTime: valid[0].trainRange.endTime + 60_000 } }],
    [valid[0], { ...valid[1], validationRange: { ...valid[0].validationRange } }],
    [{ ...valid[0], trainRange: { startTime: valid[0].trainRange.startTime + 1, endTime: valid[0].trainRange.endTime + 1 }, purgeRange: { startTime: valid[0].purgeRange.startTime + 1, endTime: valid[0].purgeRange.endTime + 1 }, validationRange: { startTime: valid[0].validationRange.startTime + 1, endTime: valid[0].validationRange.endTime + 1 } }],
  ];
  for (const folds of invalidCases) {
    const temp = statePath();
    try {
      assert.throws(() => createPartitionBook(folds, { statePath: temp.path }));
    } finally {
      rmSync(temp.directory, { recursive: true, force: true });
    }
  }
});

test('final retirement persists atomically and a fresh Node process rejects the same range', () => {
  const folds = buildRollingFolds({ trainingStartTime: start, firstValidationStartTime: start + 10 * DAY, validationBlockMs: DAY, foldCount: 2, maxLookbackMinutes: 1, maxHoldingMinutes: 1 });
  const temp = statePath();
  const finalRange = { startTime: start + 20 * DAY, endTime: start + 21 * DAY };
  try {
    const partitions = createPartitionBook(folds, { statePath: temp.path });
    assert.throws(() => partitions.reserveFinalTestRange({ startTime: folds[1].validationRange.startTime, endTime: folds[1].validationRange.endTime }));
    assert.doesNotThrow(() => partitions.reserveFinalTestRange(finalRange));
    const state = JSON.parse(readFileSync(temp.path, 'utf8')) as { retiredFinalRange: unknown };
    assert.deepEqual(state.retiredFinalRange, finalRange);
    assert.throws(() => createPartitionBook(folds, { statePath: temp.path }).reserveFinalTestRange(finalRange));

    const moduleUrl = pathToFileURL(resolve('src/research/v6/windows.ts')).href;
    const code = `import { createPartitionBook } from ${JSON.stringify(moduleUrl)}; const folds = ${JSON.stringify(folds)}; createPartitionBook(folds, { statePath: ${JSON.stringify(temp.path)} }).reserveFinalTestRange(${JSON.stringify(finalRange)});`;
    const child = spawnSync(resolve('node_modules/.bin/tsx'), ['--eval', code], { encoding: 'utf8' });
    assert.notEqual(child.status, 0, child.stderr);
    assert.match(child.stderr, /already retired/i);
  } finally {
    rmSync(temp.directory, { recursive: true, force: true });
  }
});

test('frozen candidates require complete definitions and reject any post-freeze mutation', () => {
  assert.throws(() => freezeCandidate({ id: 'candidate-a', definition: { threshold: 1 } } as unknown as CandidateDefinition));
  const frozen = freezeCandidate(candidate);
  assert.doesNotThrow(() => frozen.assertMatches({ ...candidate, featureSpec: { timeframe: '5m' } }));
  assert.throws(() => frozen.assertMatches({ ...candidate, signalSpec: { threshold: 2 } }));
  assert.equal(frozen.toArtifact().definitionSha256.length, 64);
});