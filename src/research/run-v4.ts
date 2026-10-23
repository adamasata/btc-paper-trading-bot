import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { Candle } from '../domain/types';
import { buildWindows, developmentQualificationGate, evaluatePartition, rankDevelopment, winnerGate, type AggregateMetrics, type CandidateMetrics, type ResearchCandidate } from './harness';

const ROOT = process.cwd();
const OFFSETS = [0, 6, 12, 18];
const SOURCE_RUN = '2026-10-23T06-25-51-688Z';
const SOURCE_CANDLES = path.join(ROOT, 'research', 'runs', SOURCE_RUN, 'candles.json.gz');
const PREREGISTRATION_PATH = path.join(ROOT, 'research', 'preregistration-v4.json');

type Definition = Omit<ResearchCandidate, 'id'> & { label: string };

const definitions: Definition[] = [
  ...[
    [2, 0, 3, .25], [2, .0015, 5, .4], [2, .003, 10, .6], [3, 0, 5, .4], [3, .0015, 10, .6], [3, .003, 15, .25],
    [4, 0, 10, .6], [4, .0015, 15, .25], [4, .003, 30, .4], [5, 0, 15, .25], [5, .0015, 30, .4], [5, .003, 5, .6],
  ].map(([streakLength, minimumReturnFraction, holdMinutes, allocationRate]) => ({ family: 'green-streak-continuation', allocationRate, params: { streakLength, minimumReturnFraction, holdMinutes }, label: `green ${streakLength}, minimum ${minimumReturnFraction}, hold ${holdMinutes}` })),
  ...[
    [2, 0, 3, .4], [2, .0015, 5, .6], [2, .003, 10, .25], [3, 0, 5, .6], [3, .0015, 10, .25], [3, .003, 15, .4],
    [4, 0, 10, .25], [4, .0015, 15, .4], [4, .003, 30, .6], [5, 0, 15, .4], [5, .0015, 30, .6], [5, .003, 5, .25],
  ].map(([streakLength, minimumReturnFraction, holdMinutes, allocationRate]) => ({ family: 'red-streak-mean-reversion', allocationRate, params: { streakLength, minimumReturnFraction, holdMinutes }, label: `red ${streakLength}, minimum ${minimumReturnFraction}, hold ${holdMinutes}` })),
  ...[
    [3, .0015, 5, .25], [3, .003, 10, .4], [3, .0015, 15, .6], [4, .0015, 10, .4], [4, .003, 15, .6], [4, .003, 5, .25],
  ].map(([streakLength, minimumReturnFraction, holdMinutes, allocationRate]) => ({ family: 'green-streak-delayed-continuation', allocationRate, params: { streakLength, minimumReturnFraction, holdMinutes }, label: `green ${streakLength}, pullback, minimum ${minimumReturnFraction}, hold ${holdMinutes}` })),
  ...[
    [5, 4, .0015, 5, .25], [5, 4, .003, 10, .4], [5, 4, .0015, 15, .6], [5, 4, .003, 5, .6], [5, 4, .0015, 10, .4],
    [8, 6, .0015, 5, .4], [8, 6, .003, 10, .6], [8, 6, .0015, 15, .25], [8, 6, .003, 5, .25], [8, 6, .0015, 10, .6],
  ].map(([lookbackLength, minimumGreen, minimumReturnFraction, holdMinutes, allocationRate]) => ({ family: 'majority-momentum', allocationRate, params: { lookbackLength, minimumGreen, minimumReturnFraction, holdMinutes }, label: `majority ${minimumGreen}/${lookbackLength}, minimum ${minimumReturnFraction}, hold ${holdMinutes}` })),
];

function candidateId(definition: Omit<Definition, 'label'>): string {
  return `${definition.family}-a${definition.allocationRate}-${Object.entries(definition.params).map(([key, value]) => `${key}=${value}`).join('-')}`;
}

export function v4Candidates(): ResearchCandidate[] {
  const candidates = definitions.map((definition) => ({
    id: candidateId(definition), family: definition.family, allocationRate: definition.allocationRate, params: definition.params,
  }));
  const unique = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  if (candidates.length !== 40 || unique.size !== 40) throw new Error(`v4 requires exactly 40 distinct candidates; got ${candidates.length} declared and ${unique.size} unique.`);
  return [...unique.values()];
}

function compact(metrics: AggregateMetrics) {
  return {
    windows: metrics.windows, positiveWindows: metrics.positiveWindows, negativeWindows: metrics.negativeWindows, flatWindows: metrics.flatWindows,
    positiveWindowRatio: metrics.positiveWindowRatio, meanReturn: metrics.meanReturn, medianReturn: metrics.medianReturn,
    expectancyUsd: metrics.expectancyUsd, profitFactor: metrics.profitFactor, worstWindowLoss: metrics.worstWindowLoss, maxDrawdown: metrics.maxDrawdown,
    totalProfitUsd: metrics.totalProfitUsd, genuineProfitUsd: metrics.genuineProfitUsd, qualificationProfitUsd: metrics.qualificationProfitUsd,
    genuineFeesUsd: metrics.genuineFeesUsd, qualificationFeesUsd: metrics.qualificationFeesUsd, genuineRoundTrips: metrics.genuineRoundTrips, qualificationRoundTrips: metrics.qualificationRoundTrips,
  };
}

function compactCandidate(metrics: CandidateMetrics) {
  return { candidate: metrics.candidate, aggregate: compact(metrics.aggregate), byOffset: Object.fromEntries(Object.entries(metrics.byOffset).map(([offset, value]) => [offset, compact(value)])), qualification: developmentQualificationGate(metrics, 0.55) };
}

async function writeJson(directory: string, name: string, value: unknown): Promise<void> {
  await writeFile(path.join(directory, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  const preregistration = await readFile(PREREGISTRATION_PATH, 'utf8');
  const compressed = await readFile(SOURCE_CANDLES);
  const candleJson = gunzipSync(compressed).toString('utf8');
  const sourceHash = createHash('sha256').update(candleJson).digest('hex');
  const candles = JSON.parse(candleJson) as Candle[];
  const candidates = v4Candidates();
  const runId = `${startedAt.replace(/[:.]/g, '-')}-v4`;
  const directory = path.join(ROOT, 'research', 'runs', runId);
  await mkdir(directory, { recursive: true });
  await writeJson(directory, 'run-order.json', { runId, startedAt, preregistrationPath: 'research/preregistration-v4.json', preregistrationSha256: createHash('sha256').update(preregistration).digest('hex'), provenance: 'POST-HOC EXPLORATORY; local run ordering is not independent preregistration provenance.' });
  await writeJson(directory, 'data-manifest.json', { sourceRun: `research/runs/${SOURCE_RUN}`, sourceArtifact: `research/runs/${SOURCE_RUN}/candles.json.gz`, sourceCandlesSha256: sourceHash, candleCount: candles.length, firstOpenTime: new Date(candles[0].openTime).toISOString(), lastCompleteOpenTime: new Date(candles[candles.length - 1].openTime).toISOString(), noExternalRefetch: true, offsetHours: OFFSETS });
  const windows = buildWindows(candles, OFFSETS, 30);
  const evaluated = candidates.map((candidate) => evaluatePartition(candles, candidate, windows, 'development'));
  const ranked = rankDevelopment(evaluated);
  const qualified = ranked.filter((metrics) => developmentQualificationGate(metrics, 0.55).passed);
  const familySummaries = [...new Set(candidates.map((candidate) => candidate.family))].map((family) => ({ family, candidateCount: candidates.filter((candidate) => candidate.family === family).length, topCandidates: ranked.filter((metrics) => metrics.candidate.family === family).slice(0, 3).map(compactCandidate) }));
  await writeJson(directory, 'development.json', { evaluatedAt: new Date().toISOString(), provenance: 'POST-HOC EXPLORATORY', holdoutOpened: false, candidateCount: candidates.length, allCandidateSummaries: evaluated.map(compactCandidate), topCandidatesPerFamily: familySummaries, qualifiedCandidateCount: qualified.length });
  if (qualified.length === 0) {
    await writeJson(directory, 'outcome.json', { outcome: 'NO WINNER', provenance: 'POST-HOC EXPLORATORY', candidateCount: candidates.length, frozenCandidateId: null, holdoutOpened: false, bestRankedRejectedCandidate: compactCandidate(ranked[0]), interpretation: 'No candidate passed every existing per-offset development gate plus the v4 >=55% positive development-window gate at every offset. Holdout was not accessed.' });
    process.stdout.write(`${JSON.stringify({ directory, outcome: 'NO WINNER', candidateCount: candidates.length, holdoutOpened: false, bestRankedRejectedCandidate: ranked[0].candidate.id })}\n`);
    return;
  }
  const frozen = qualified[0];
  await writeJson(directory, 'selection.json', { frozenAt: new Date().toISOString(), provenance: 'POST-HOC EXPLORATORY', frozenCandidate: frozen.candidate, developmentMetrics: compactCandidate(frozen), holdoutStatusBeforeOpen: 'sealed' });
  const holdout = evaluatePartition(candles, frozen.candidate, windows, 'holdout');
  const v1 = evaluatePartition(candles, { id: 'v1-baseline', family: 'v1', allocationRate: 1, params: {} }, windows, 'holdout');
  const cash = evaluatePartition(candles, { id: 'cash-baseline', family: 'cash', allocationRate: 1, params: {} }, windows, 'holdout');
  const gate = winnerGate(holdout, v1, cash);
  await writeJson(directory, 'holdout.json', { openedAt: new Date().toISOString(), provenance: 'POST-HOC EXPLORATORY', frozenCandidate: compactCandidate(holdout), v1Baseline: compactCandidate(v1), cashBaseline: compactCandidate(cash), winnerGate: gate });
  await writeJson(directory, 'outcome.json', { outcome: gate.passed ? 'WINNER' : 'NO WINNER', provenance: 'POST-HOC EXPLORATORY', candidateCount: candidates.length, frozenCandidateId: frozen.candidate.id, holdoutOpened: true, winnerGate: gate, interpretation: gate.passed ? 'Candidate passed all holdout winner gates; production implementation still requires independent review.' : 'Frozen candidate failed one or more existing holdout winner gates; production implementation is not authorized.' });
  process.stdout.write(`${JSON.stringify({ directory, outcome: gate.passed ? 'WINNER' : 'NO WINNER', candidateCount: candidates.length, candidate: frozen.candidate.id, holdoutOpened: true, gates: gate.gates, metrics: compact(holdout.aggregate) })}\n`);
}

void main();
