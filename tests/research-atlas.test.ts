import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { experimentIds, researchExperiments, summarizeResearchAtlas, type DevelopmentResult } from '../src/lib/research-atlas';

type AggregateArtifact = {
  windows: number;
  positiveWindows: number;
  positiveWindowRatio: number;
  meanReturn: number;
  profitFactor: number;
  totalProfitUsd: number;
};

type OutcomeArtifact = {
  outcome: string;
  evaluatedGenerations?: number[];
  maximumGenerations?: number;
  frozenCandidateId: string | null;
  holdoutOpened: boolean;
  interpretation: string;
  bestRankedRejectedCandidate?: { aggregate: AggregateArtifact };
};

function readOutcome(relativePath: string): OutcomeArtifact {
  return JSON.parse(readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')) as OutcomeArtifact;
}

type V2DevelopmentArtifact = {
  holdoutOpened: boolean;
  generations: Array<{
    family: string;
    candidateCount: number;
    qualifiedCount: number;
    topCandidates: Array<{ aggregate: AggregateArtifact }>;
  }>;
};

type V3DevelopmentArtifact = {
  holdoutOpened: boolean;
  candidates: Array<{
    allocationRate: number;
    qualification: { passed: boolean };
    metrics: { aggregate: AggregateArtifact };
  }>;
};

function readArtifact<T>(relativePath: string): T {
  return JSON.parse(readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')) as T;
}

function formatPercent(value: number, fractionDigits: number): string {
  return `${value < 0 ? '−' : ''}${Math.abs(value * 100).toFixed(fractionDigits)}%`;
}

function formatUsd(value: number): string {
  return `${value < 0 ? '−' : ''}$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPositiveWindows(positiveWindows: number, windows: number): string {
  if (positiveWindows === 0) return `${positiveWindows} / ${windows}`;
  const ratio = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 2 }).format((positiveWindows / windows) * 100);
  return `${positiveWindows} / ${windows} (${ratio}%)`;
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
  assert.ok(summary.experiments.filter((experiment) => experiment.evaluationState === 'rejected').every((experiment) => experiment.keyScore !== null || experiment.developmentResults !== undefined));
});

test('v2 displays first recorded top candidates from every predeclared development generation', () => {
  const v2 = researchExperiments.find((experiment) => experiment.id === 'v2');
  const outcome = readOutcome('research/runs/2026-10-23T06-25-51-688Z/outcome.json');
  const development = readArtifact<V2DevelopmentArtifact>('research/runs/2026-10-23T06-25-51-688Z/development.json');

  assert.ok(v2);
  assert.deepEqual(outcome.evaluatedGenerations, [1, 2, 3, 4]);
  assert.equal(outcome.maximumGenerations, 4);
  assert.equal(outcome.outcome, 'NO WINNER');
  assert.equal(outcome.frozenCandidateId, null);
  assert.equal(outcome.holdoutOpened, false);
  assert.equal(v2.keyScore, null);
  assert.ok(v2.developmentResults);
  assert.equal(development.holdoutOpened, false);
  assert.equal(development.generations.length, 4);
  assert.ok(development.generations.every((generation) => generation.qualifiedCount === 0));
  assert.deepEqual(v2.developmentResults.rows, development.generations.map((generation): DevelopmentResult => {
    const aggregate = generation.topCandidates[0]?.aggregate;
    assert.ok(aggregate, `expected recorded top candidate for ${generation.family}`);
    return {
      label: generation.family,
      candidatesTried: String(generation.candidateCount),
      positiveWindows: formatPositiveWindows(aggregate.positiveWindows, aggregate.windows),
      meanReturn: formatPercent(aggregate.meanReturn, 6),
      profitFactor: aggregate.profitFactor.toFixed(3),
      totalProfit: formatUsd(aggregate.totalProfitUsd),
      qualification: `${generation.qualifiedCount} qualified`,
    };
  }));
  assert.match(v2.failureOrLearning, /NO WINNER/);
  assert.match(v2.failureOrLearning, /Generations 1–4/);
  assert.match(v2.holdout, /sealed; never opened/i);
  assert.match(v2.developmentResults.note, /not a valid cross-family winner selection/i);
  assert.match(v2.developmentResults.note, /holdout remained sealed/i);
  assert.match(v2.source, /2026-10-23T06-25-51-688Z\/development\.json/);
});

test('v3 displays every declared allocation result from its committed development artifact', () => {
  const v3 = researchExperiments.find((experiment) => experiment.id === 'v3');
  const outcome = readOutcome('research/runs/2026-10-23T06-33-11-306Z-v3/outcome.json');
  const development = readArtifact<V3DevelopmentArtifact>('research/runs/2026-10-23T06-33-11-306Z-v3/development.json');

  assert.ok(v3);
  assert.equal(outcome.outcome, 'NO WINNER');
  assert.equal(outcome.frozenCandidateId, null);
  assert.equal(outcome.holdoutOpened, false);
  assert.equal(development.holdoutOpened, false);
  assert.equal(v3.keyScore, null);
  assert.ok(v3.developmentResults);
  assert.equal(v3.developmentResults.rows.length, development.candidates.length);
  assert.ok(development.candidates.every((candidate) => candidate.qualification.passed === false));
  assert.deepEqual(v3.developmentResults.rows, development.candidates.map((candidate): DevelopmentResult => {
    const aggregate = candidate.metrics.aggregate;
    return {
      label: `${candidate.allocationRate * 100}% allocation`,
      positiveWindows: formatPositiveWindows(aggregate.positiveWindows, aggregate.windows),
      meanReturn: formatPercent(aggregate.meanReturn, 6),
      profitFactor: aggregate.profitFactor.toFixed(4),
      totalProfit: formatUsd(aggregate.totalProfitUsd),
      qualification: candidate.qualification.passed ? 'Qualified' : 'Not qualified',
    };
  }));
  assert.match(v3.developmentResults.note, /fee and turnover drag/i);
  assert.match(v3.developmentResults.note, /no allocation qualified/i);
  assert.match(v3.holdout, /sealed; never opened/i);
  assert.match(v3.source, /2026-10-23T06-33-11-306Z-v3\/development\.json/);
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
  assert.match(v5.failureOrLearning, /caveated post-hoc observation/i);
  assert.match(v4.holdout, /sealed; not accessed/i);
  assert.match(v5.holdout, /sealed; not accessed/i);
});

test('the registry rejects a ranking that tries to present a non-rejected experiment as best observed', () => {
  assert.throws(
    () => summarizeResearchAtlas(researchExperiments.map((experiment) => experiment.id === 'v6' ? { ...experiment, bestObserved: true } : { ...experiment, bestObserved: undefined })),
    /explicitly rejected/,
  );
});