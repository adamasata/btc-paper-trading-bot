import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { experimentIds, researchExperiments, summarizeResearchAtlas } from '../src/lib/research-atlas';

type OutcomeArtifact = {
  outcome: string;
  evaluatedGenerations?: number[];
  maximumGenerations?: number;
  frozenCandidateId: string | null;
  holdoutOpened: boolean;
  interpretation: string;
  bestRankedRejectedCandidate?: {
    aggregate: {
      windows: number;
      positiveWindows: number;
      positiveWindowRatio: number;
      meanReturn: number;
      profitFactor: number;
      totalProfitUsd: number;
    };
  };
};

function readOutcome(relativePath: string): OutcomeArtifact {
  return JSON.parse(readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')) as OutcomeArtifact;
}

function rejectedCandidateScore(outcome: OutcomeArtifact, meanReturnFractionDigits: number, includePositiveWindowCount: boolean): NonNullable<(typeof researchExperiments)[number]['keyScore']> {
  const aggregate = outcome.bestRankedRejectedCandidate?.aggregate;
  assert.ok(aggregate, 'expected a recorded rejected candidate aggregate');
  const formatPercent = (value: number, maximumFractionDigits: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(value * 100);
  const formatUsd = (value: number) => `${value < 0 ? '−' : ''}$${Math.abs(value).toFixed(2)}`;

  const positiveWindowRatio = `${formatPercent(aggregate.positiveWindowRatio, 2)}%`;

  return {
    positiveWindows: includePositiveWindowCount ? `${positiveWindowRatio} (${aggregate.positiveWindows} / ${aggregate.windows})` : positiveWindowRatio,
    meanReturn: `${aggregate.meanReturn < 0 ? '−' : ''}${Math.abs(aggregate.meanReturn * 100).toFixed(meanReturnFractionDigits)}%`,
    profitFactor: new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(aggregate.profitFactor),
    totalProfit: formatUsd(aggregate.totalProfitUsd),
  };
}

test('Research Atlas covers each registered version once and does not authorize a winner', () => {
  const summary = summarizeResearchAtlas();

  assert.deepEqual(researchExperiments.map((experiment) => experiment.id), experimentIds);
  assert.equal(new Set(researchExperiments.map((experiment) => experiment.id)).size, 6);
  assert.equal(summary.productionWinner, null);
  assert.ok(summary.experiments.every((experiment) => experiment.evaluationState === 'rejected' || experiment.evaluationState === 'pending'));
});

test('v2 reflects the successor outcome artifact and keeps its holdout sealed', () => {
  const v2 = researchExperiments.find((experiment) => experiment.id === 'v2');
  const outcome = readOutcome('research/runs/2026-10-23T06-25-51-688Z/outcome.json');

  assert.ok(v2);
  assert.deepEqual(outcome.evaluatedGenerations, [1, 2, 3, 4]);
  assert.equal(outcome.maximumGenerations, 4);
  assert.equal(outcome.outcome, 'NO WINNER');
  assert.equal(outcome.frozenCandidateId, null);
  assert.equal(outcome.holdoutOpened, false);
  assert.equal(v2.keyScore, null);
  assert.match(v2.failureOrLearning, /NO WINNER/);
  assert.match(v2.failureOrLearning, /Generations 1–4/);
  assert.match(v2.holdout, /sealed; never opened/i);
  assert.match(v2.source, /2026-10-23T06-25-51-688Z\/outcome\.json/);
});

test('v4 and v5 metrics and holdout treatment match their committed outcome artifacts', () => {
  const v4 = researchExperiments.find((experiment) => experiment.id === 'v4');
  const v5 = researchExperiments.find((experiment) => experiment.id === 'v5');
  const v4Outcome = readOutcome('research/runs/2026-10-23T07-12-34-900Z-v4/outcome.json');
  const v5Outcome = readOutcome('research/runs/2026-10-23T07-03-01-732Z-v5/outcome.json');

  assert.ok(v4);
  assert.ok(v5);
  for (const outcome of [v4Outcome, v5Outcome]) {
    assert.equal(outcome.outcome, 'NO WINNER');
    assert.equal(outcome.frozenCandidateId, null);
    assert.equal(outcome.holdoutOpened, false);
    assert.match(outcome.interpretation, /holdout (was )?not accessed/i);
  }
  assert.deepEqual(v4.keyScore, rejectedCandidateScore(v4Outcome, 5, false));
  assert.deepEqual(v5.keyScore, rejectedCandidateScore(v5Outcome, 4, true));
  assert.match(v4.holdout, /sealed; not accessed/i);
  assert.match(v5.holdout, /sealed; not accessed/i);
});

test('the registry rejects a ranking that tries to present a non-rejected experiment as best observed', () => {
  assert.throws(
    () => summarizeResearchAtlas(researchExperiments.map((experiment) => experiment.id === 'v6' ? { ...experiment, bestObserved: true } : { ...experiment, bestObserved: undefined })),
    /explicitly rejected/,
  );
});