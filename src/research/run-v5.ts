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
const PREREGISTRATION_PATH = path.join(ROOT, 'research', 'preregistration-v5.json');

type Definition = Omit<ResearchCandidate, 'id'>;
const definitions: Definition[] = [
  // UTC session opening-range breakout (7)
  { family: 'utc-opening-range-breakout', allocationRate: .25, params: { sessionUtcHour: 0, rangeMinutes: 30, breakoutBufferFraction: 0, holdMinutes: 60 } },
  { family: 'utc-opening-range-breakout', allocationRate: .4, params: { sessionUtcHour: 6, rangeMinutes: 60, breakoutBufferFraction: .0015, holdMinutes: 180 } },
  { family: 'utc-opening-range-breakout', allocationRate: .6, params: { sessionUtcHour: 12, rangeMinutes: 120, breakoutBufferFraction: .003, holdMinutes: 360 } },
  { family: 'utc-opening-range-breakout', allocationRate: .4, params: { sessionUtcHour: 18, rangeMinutes: 30, breakoutBufferFraction: .0015, holdMinutes: 180 } },
  { family: 'utc-opening-range-breakout', allocationRate: .6, params: { sessionUtcHour: 0, rangeMinutes: 60, breakoutBufferFraction: .003, holdMinutes: 360 } },
  { family: 'utc-opening-range-breakout', allocationRate: .25, params: { sessionUtcHour: 6, rangeMinutes: 120, breakoutBufferFraction: 0, holdMinutes: 60 } },
  { family: 'utc-opening-range-breakout', allocationRate: .4, params: { sessionUtcHour: 12, rangeMinutes: 30, breakoutBufferFraction: .003, holdMinutes: 180 } },
  // Session dip recovery (7)
  { family: 'session-dip-recovery', allocationRate: .25, params: { sessionUtcHour: 0, declineLookbackMinutes: 60, minimumDeclineFraction: .005, recoveryGreenCandles: 2, holdMinutes: 60 } },
  { family: 'session-dip-recovery', allocationRate: .4, params: { sessionUtcHour: 6, declineLookbackMinutes: 180, minimumDeclineFraction: .01, recoveryGreenCandles: 3, holdMinutes: 180 } },
  { family: 'session-dip-recovery', allocationRate: .6, params: { sessionUtcHour: 12, declineLookbackMinutes: 60, minimumDeclineFraction: .015, recoveryGreenCandles: 2, holdMinutes: 360 } },
  { family: 'session-dip-recovery', allocationRate: .4, params: { sessionUtcHour: 18, declineLookbackMinutes: 180, minimumDeclineFraction: .005, recoveryGreenCandles: 3, holdMinutes: 60 } },
  { family: 'session-dip-recovery', allocationRate: .6, params: { sessionUtcHour: 0, declineLookbackMinutes: 180, minimumDeclineFraction: .015, recoveryGreenCandles: 2, holdMinutes: 180 } },
  { family: 'session-dip-recovery', allocationRate: .25, params: { sessionUtcHour: 6, declineLookbackMinutes: 60, minimumDeclineFraction: .01, recoveryGreenCandles: 3, holdMinutes: 360 } },
  { family: 'session-dip-recovery', allocationRate: .4, params: { sessionUtcHour: 12, declineLookbackMinutes: 180, minimumDeclineFraction: .005, recoveryGreenCandles: 2, holdMinutes: 180 } },
  // Volatility expansion continuation (6)
  { family: 'volatility-expansion-continuation', allocationRate: .25, params: { quietLookbackMinutes: 60, quietRangeMaxFraction: .003, breakoutCandleFraction: .002, holdMinutes: 60 } },
  { family: 'volatility-expansion-continuation', allocationRate: .4, params: { quietLookbackMinutes: 60, quietRangeMaxFraction: .005, breakoutCandleFraction: .004, holdMinutes: 180 } },
  { family: 'volatility-expansion-continuation', allocationRate: .6, params: { quietLookbackMinutes: 180, quietRangeMaxFraction: .005, breakoutCandleFraction: .002, holdMinutes: 60 } },
  { family: 'volatility-expansion-continuation', allocationRate: .4, params: { quietLookbackMinutes: 180, quietRangeMaxFraction: .008, breakoutCandleFraction: .004, holdMinutes: 180 } },
  { family: 'volatility-expansion-continuation', allocationRate: .6, params: { quietLookbackMinutes: 60, quietRangeMaxFraction: .008, breakoutCandleFraction: .004, holdMinutes: 60 } },
  { family: 'volatility-expansion-continuation', allocationRate: .25, params: { quietLookbackMinutes: 180, quietRangeMaxFraction: .003, breakoutCandleFraction: .002, holdMinutes: 180 } },
  // Daily time bias (7)
  { family: 'daily-time-bias', allocationRate: .25, params: { entryUtcHour: 0, priorFourHourSign: 0, holdMinutes: 240 } },
  { family: 'daily-time-bias', allocationRate: .4, params: { entryUtcHour: 4, priorFourHourSign: 1, holdMinutes: 480 } },
  { family: 'daily-time-bias', allocationRate: .6, params: { entryUtcHour: 8, priorFourHourSign: -1, holdMinutes: 720 } },
  { family: 'daily-time-bias', allocationRate: .4, params: { entryUtcHour: 12, priorFourHourSign: 0, holdMinutes: 480 } },
  { family: 'daily-time-bias', allocationRate: .6, params: { entryUtcHour: 16, priorFourHourSign: 1, holdMinutes: 240 } },
  { family: 'daily-time-bias', allocationRate: .25, params: { entryUtcHour: 20, priorFourHourSign: -1, holdMinutes: 480 } },
  { family: 'daily-time-bias', allocationRate: .4, params: { entryUtcHour: 8, priorFourHourSign: 1, holdMinutes: 240 } },
  // Long-horizon trend/pullback (7)
  { family: 'long-horizon-trend-pullback', allocationRate: .25, params: { minimumFourHourReturnFraction: .005, minimumThirtyMinutePullbackFraction: .002, holdMinutes: 120 } },
  { family: 'long-horizon-trend-pullback', allocationRate: .4, params: { minimumFourHourReturnFraction: .01, minimumThirtyMinutePullbackFraction: .004, holdMinutes: 240 } },
  { family: 'long-horizon-trend-pullback', allocationRate: .6, params: { minimumFourHourReturnFraction: .005, minimumThirtyMinutePullbackFraction: .004, holdMinutes: 480 } },
  { family: 'long-horizon-trend-pullback', allocationRate: .4, params: { minimumFourHourReturnFraction: .01, minimumThirtyMinutePullbackFraction: .002, holdMinutes: 120 } },
  { family: 'long-horizon-trend-pullback', allocationRate: .6, params: { minimumFourHourReturnFraction: .005, minimumThirtyMinutePullbackFraction: .002, holdMinutes: 240 } },
  { family: 'long-horizon-trend-pullback', allocationRate: .25, params: { minimumFourHourReturnFraction: .01, minimumThirtyMinutePullbackFraction: .004, holdMinutes: 480 } },
  { family: 'long-horizon-trend-pullback', allocationRate: .4, params: { minimumFourHourReturnFraction: .005, minimumThirtyMinutePullbackFraction: .004, holdMinutes: 120 } },
  // Range mean reversion (6)
  { family: 'range-mean-reversion', allocationRate: .25, params: { maxSixHourTrendFraction: .005, bottomRangeFraction: .1, timeoutMinutes: 120 } },
  { family: 'range-mean-reversion', allocationRate: .4, params: { maxSixHourTrendFraction: .01, bottomRangeFraction: .2, timeoutMinutes: 240 } },
  { family: 'range-mean-reversion', allocationRate: .6, params: { maxSixHourTrendFraction: .005, bottomRangeFraction: .2, timeoutMinutes: 120 } },
  { family: 'range-mean-reversion', allocationRate: .4, params: { maxSixHourTrendFraction: .01, bottomRangeFraction: .1, timeoutMinutes: 240 } },
  { family: 'range-mean-reversion', allocationRate: .6, params: { maxSixHourTrendFraction: .005, bottomRangeFraction: .1, timeoutMinutes: 240 } },
  { family: 'range-mean-reversion', allocationRate: .25, params: { maxSixHourTrendFraction: .01, bottomRangeFraction: .2, timeoutMinutes: 120 } },
];

function candidateId(definition: Definition): string {
  return `${definition.family}-a${definition.allocationRate}-${Object.entries(definition.params).map(([key, value]) => `${key}=${value}`).join('-')}`;
}
export function v5Candidates(): ResearchCandidate[] {
  const candidates = definitions.map((definition) => ({ id: candidateId(definition), family: definition.family, allocationRate: definition.allocationRate, params: definition.params }));
  if (candidates.length !== 40 || new Set(candidates.map((candidate) => candidate.id)).size !== 40) throw new Error('v5 requires exactly 40 distinct new candidates.');
  return candidates;
}
function compact(metrics: AggregateMetrics) { return { windows: metrics.windows, positiveWindows: metrics.positiveWindows, negativeWindows: metrics.negativeWindows, flatWindows: metrics.flatWindows, positiveWindowRatio: metrics.positiveWindowRatio, meanReturn: metrics.meanReturn, medianReturn: metrics.medianReturn, expectancyUsd: metrics.expectancyUsd, profitFactor: metrics.profitFactor, worstWindowLoss: metrics.worstWindowLoss, maxDrawdown: metrics.maxDrawdown, totalProfitUsd: metrics.totalProfitUsd, genuineProfitUsd: metrics.genuineProfitUsd, qualificationProfitUsd: metrics.qualificationProfitUsd, genuineFeesUsd: metrics.genuineFeesUsd, qualificationFeesUsd: metrics.qualificationFeesUsd, genuineRoundTrips: metrics.genuineRoundTrips, qualificationRoundTrips: metrics.qualificationRoundTrips }; }
function compactCandidate(metrics: CandidateMetrics) { return { candidate: metrics.candidate, aggregate: compact(metrics.aggregate), byOffset: Object.fromEntries(Object.entries(metrics.byOffset).map(([offset, value]) => [offset, compact(value)])), qualification: developmentQualificationGate(metrics) }; }
async function writeJson(directory: string, name: string, value: unknown): Promise<void> { await writeFile(path.join(directory, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  const preregistration = await readFile(PREREGISTRATION_PATH, 'utf8');
  const compressed = await readFile(SOURCE_CANDLES); const candleJson = gunzipSync(compressed).toString('utf8'); const candles = JSON.parse(candleJson) as Candle[];
  const candidates = v5Candidates(); const runId = `${startedAt.replace(/[:.]/g, '-')}-v5`; const directory = path.join(ROOT, 'research', 'runs', runId); await mkdir(directory, { recursive: true });
  await writeJson(directory, 'run-order.json', { runId, startedAt, preregistrationPath: 'research/preregistration-v5.json', preregistrationSha256: createHash('sha256').update(preregistration).digest('hex'), provenance: 'POST-HOC EXPLORATORY: cumulative v1-v5 search means all results have multiple-testing risk and are not confirmatory evidence.' });
  await writeJson(directory, 'data-manifest.json', { sourceRun: `research/runs/${SOURCE_RUN}`, sourceArtifact: `research/runs/${SOURCE_RUN}/candles.json.gz`, sourceCandlesSha256: createHash('sha256').update(candleJson).digest('hex'), candleCount: candles.length, firstOpenTime: new Date(candles[0].openTime).toISOString(), lastCompleteOpenTime: new Date(candles[candles.length - 1].openTime).toISOString(), noExternalRefetch: true, offsetHours: OFFSETS });
  const windows = buildWindows(candles, OFFSETS, 30); const evaluated = candidates.map((candidate) => evaluatePartition(candles, candidate, windows, 'development')); const ranked = rankDevelopment(evaluated); const qualified = ranked.filter((metric) => developmentQualificationGate(metric).passed);
  const familySummaries = [...new Set(candidates.map((candidate) => candidate.family))].map((family) => ({ family, candidateCount: candidates.filter((candidate) => candidate.family === family).length, topCandidates: ranked.filter((metric) => metric.candidate.family === family).slice(0, 3).map(compactCandidate) }));
  await writeJson(directory, 'development.json', { evaluatedAt: new Date().toISOString(), provenance: 'POST-HOC EXPLORATORY; cumulative multiple-testing caveat applies across v1-v5.', holdoutOpened: false, candidateCount: candidates.length, allCandidateSummaries: evaluated.map(compactCandidate), topCandidatesPerFamily: familySummaries, qualifiedCandidateCount: qualified.length });
  if (qualified.length === 0) { await writeJson(directory, 'outcome.json', { outcome: 'NO WINNER', provenance: 'POST-HOC EXPLORATORY; cumulative multiple-testing caveat applies across v1-v5.', candidateCount: candidates.length, frozenCandidateId: null, holdoutOpened: false, bestRankedRejectedCandidate: compactCandidate(ranked[0]), interpretation: 'No candidate passed all per-offset gates including >=12/20 positive development windows. Sealed holdout was not accessed.' }); process.stdout.write(`${JSON.stringify({ directory, outcome: 'NO WINNER', candidateCount: 40, holdoutOpened: false, bestRankedRejectedCandidate: ranked[0].candidate.id })}\n`); return; }
  const frozen = qualified[0]; await writeJson(directory, 'selection.json', { frozenAt: new Date().toISOString(), provenance: 'POST-HOC EXPLORATORY', frozenCandidate: frozen.candidate, developmentMetrics: compactCandidate(frozen), holdoutStatusBeforeOpen: 'sealed' });
  const holdout = evaluatePartition(candles, frozen.candidate, windows, 'holdout'); const v1 = evaluatePartition(candles, { id: 'v1-baseline', family: 'v1', allocationRate: 1, params: {} }, windows, 'holdout'); const cash = evaluatePartition(candles, { id: 'cash-baseline', family: 'cash', allocationRate: 1, params: {} }, windows, 'holdout'); const gate = winnerGate(holdout, v1, cash); const perOffset60 = Object.values(holdout.byOffset).every((metric) => metric.positiveWindows >= 6 && metric.positiveWindowRatio >= .6); gate.gates.holdoutPositiveWindowsAtLeast60PercentEachOffset = perOffset60; gate.passed &&= perOffset60;
  await writeJson(directory, 'holdout.json', { openedAt: new Date().toISOString(), provenance: 'POST-HOC EXPLORATORY', frozenCandidate: compactCandidate(holdout), v1Baseline: compactCandidate(v1), cashBaseline: compactCandidate(cash), winnerGate: gate }); await writeJson(directory, 'outcome.json', { outcome: gate.passed ? 'WINNER' : 'NO WINNER', provenance: 'POST-HOC EXPLORATORY; cumulative multiple-testing caveat applies across v1-v5.', candidateCount: 40, frozenCandidateId: frozen.candidate.id, holdoutOpened: true, winnerGate: gate, interpretation: gate.passed ? 'Candidate passed all gates; production implementation requires independent review.' : 'Frozen candidate failed one or more holdout gates; production implementation is not authorized.' }); process.stdout.write(`${JSON.stringify({ directory, outcome: gate.passed ? 'WINNER' : 'NO WINNER', candidateCount: 40, candidate: frozen.candidate.id, holdoutOpened: true, gates: gate.gates, metrics: compact(holdout.aggregate) })}\n`);
}
void main();
