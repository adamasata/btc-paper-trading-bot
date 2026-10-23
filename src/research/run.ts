import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import type { Candle } from '../domain/types';
import { buildWindows, developmentQualificationGate, evaluatePartition, rankDevelopment, type CandidateMetrics, type ResearchCandidate, winnerGate } from './harness';

const MINUTE_MS = 60_000;
const DAY_MINUTES = 24 * 60;
const OFFSETS = [0, 6, 12, 18];
const ROOT = process.cwd();
const PREREGISTRATION_PATH = path.join(ROOT, 'research', 'preregistration-v2.json');

type BinanceRow = [number, string, string, string, string, string, number, ...unknown[]];

function candidateId(family: string, allocationRate: number, params: Record<string, unknown>): string {
  return `${family}-a${allocationRate}-${Object.entries(params).map(([key, value]) => `${key}=${Array.isArray(value) ? value.join('_') : value}`).join('-')}`;
}

function candidateGenerations(): Array<{ generation: number; candidates: ResearchCandidate[] }> {
  const allocations = [0.25, 0.4, 0.6];
  const selectiveRegimePullback: ResearchCandidate[] = [];
  const volatilityContractionBreakoutRetest: ResearchCandidate[] = [];
  const rangeRegimeMeanReversion: ResearchCandidate[] = [];
  const sessionMomentum: ResearchCandidate[] = [];
  for (const allocationRate of allocations) {
    for (const fastEma of [10, 20]) for (const slowEma of [30, 50]) for (const pullbackFraction of [0.001, 0.002]) for (const takeProfitFraction of [0.003, 0.005]) for (const stopLossFraction of [0.002, 0.004]) {
      const params = { fastEma, slowEma, trendEma: 90, pullbackFraction, takeProfitFraction, stopLossFraction, maxHoldMinutes: 60 };
      selectiveRegimePullback.push({ id: candidateId('selective-regime-pullback', allocationRate, params), family: 'selective-regime-pullback', allocationRate, params });
    }
    for (const breakoutLookbackMinutes of [30, 60]) for (const contractionRatioMax of [0.7, 0.85]) for (const retestToleranceFraction of [0.001, 0.002]) {
      const params = { breakoutLookbackMinutes, contractionRatioMax, retestToleranceFraction, takeProfitFraction: 0.004, stopLossFraction: 0.003, maxHoldMinutes: 90 };
      volatilityContractionBreakoutRetest.push({ id: candidateId('volatility-contraction-breakout-retest', allocationRate, params), family: 'volatility-contraction-breakout-retest', allocationRate, params });
    }
    for (const lookbackMinutes of [30, 60]) for (const maxTrendFraction of [0.003, 0.006]) for (const entryZScore of [-1.25, -1.75]) {
      const params = { lookbackMinutes, maxTrendFraction, entryZScore, takeProfitFraction: 0.0025, stopLossFraction: 0.003, maxHoldMinutes: 60 };
      rangeRegimeMeanReversion.push({ id: candidateId('range-regime-mean-reversion', allocationRate, params), family: 'range-regime-mean-reversion', allocationRate, params });
    }
    for (const sessionsUtcHour of [[0, 8, 16], [2, 10, 18]]) for (const lookbackMinutes of [30, 60]) for (const minimumMomentumFraction of [0.0015, 0.003]) {
      const params = { sessionsUtcHour, lookbackMinutes, minimumMomentumFraction, takeProfitFraction: 0.0035, stopLossFraction: 0.0025, maxHoldMinutes: 60 };
      sessionMomentum.push({ id: candidateId('session-momentum', allocationRate, params), family: 'session-momentum', allocationRate, params });
    }
  }
  return [
    { generation: 1, candidates: selectiveRegimePullback },
    { generation: 2, candidates: volatilityContractionBreakoutRetest },
    { generation: 3, candidates: rangeRegimeMeanReversion },
    { generation: 4, candidates: sessionMomentum },
  ];
}

async function fetchLatestCompleteCandles(now: number): Promise<Candle[]> {
  const completedExclusive = Math.floor(now / MINUTE_MS) * MINUTE_MS;
  const required = 31 * DAY_MINUTES + 1;
  const rows: BinanceRow[] = [];
  let endExclusive = completedExclusive;
  while (rows.length < required) {
    const url = new URL('https://api.binance.us/api/v3/klines');
    url.searchParams.set('symbol', 'BTCUSD');
    url.searchParams.set('interval', '1m');
    url.searchParams.set('limit', '1000');
    url.searchParams.set('endTime', String(endExclusive - 1));
    const response = await fetch(url, { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`Binance.US returned ${response.status} while retrieving research candles.`);
    const batch = await response.json() as unknown;
    if (!Array.isArray(batch) || batch.length === 0) throw new Error('Binance.US returned no research candles.');
    const parsed = batch as BinanceRow[];
    rows.push(...parsed);
    const firstTime = Number(parsed[0]?.[0]);
    if (!Number.isFinite(firstTime)) throw new Error('Binance.US returned a malformed research candle timestamp.');
    endExclusive = firstTime;
  }
  const deduplicated = new Map<number, Candle>();
  for (const row of rows) {
    const openTime = Number(row[0]);
    const open = Number(row[1]);
    const close = Number(row[4]);
    if (Number.isFinite(openTime) && Number.isFinite(open) && Number.isFinite(close) && open > 0 && close > 0 && openTime < completedExclusive) {
      deduplicated.set(openTime, { openTime, open, close });
    }
  }
  const candles = [...deduplicated.values()].sort((left, right) => left.openTime - right.openTime);
  if (candles.length < required) throw new Error(`Binance.US supplied only ${candles.length} complete research candles; ${required} required.`);
  const selected = candles.slice(-required);
  for (let index = 1; index < selected.length; index += 1) {
    if (selected[index].openTime - selected[index - 1].openTime !== MINUTE_MS) throw new Error('Binance.US research candles contain a one-minute gap.');
  }
  return selected;
}

async function writeJson(directory: string, name: string, value: unknown): Promise<void> {
  await writeFile(path.join(directory, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function percentage(value: number): string {
  return `${(value * 100).toFixed(6)}%`;
}

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  const preregistration = await readFile(PREREGISTRATION_PATH, 'utf8');
  const runId = startedAt.replace(/[:.]/g, '-');
  const directory = path.join(ROOT, 'research', 'runs', runId);
  await mkdir(directory, { recursive: true });
  await writeJson(directory, 'run-order.json', {
    runId,
    startedAt,
    preregistrationPath: 'research/preregistration-v2.json',
    preregistrationSha256: createHash('sha256').update(preregistration).digest('hex'),
    maximumGenerations: 4,
    assertionLimit: 'This artifact records local file and run order only; it does not establish independent preregistration provenance.',
  });

  const candles = await fetchLatestCompleteCandles(Date.now());
  const candleJson = `${JSON.stringify(candles)}\n`;
  const candleArtifact = 'candles.json.gz';
  await writeFile(path.join(directory, candleArtifact), gzipSync(candleJson, { level: 9 }));
  await writeJson(directory, 'data-manifest.json', {
    provider: 'Binance.US public klines',
    symbol: 'BTCUSD',
    interval: '1m',
    candleCount: candles.length,
    firstOpenTime: new Date(candles[0].openTime).toISOString(),
    lastCompleteOpenTime: new Date(candles[candles.length - 1].openTime).toISOString(),
    candleArtifact,
    candleEncoding: 'gzip-compressed JSON array',
    candlesSha256: createHash('sha256').update(candleJson).digest('hex'),
    offsetHours: OFFSETS,
  });

  const baselines: ResearchCandidate[] = [
    { id: 'v1-baseline', family: 'v1', allocationRate: 1, params: {} },
    { id: 'cash-baseline', family: 'cash', allocationRate: 1, params: {} },
    { id: 'buy-and-hold-baseline', family: 'buy-and-hold', allocationRate: 1, params: {} },
  ];
  const windowSets = buildWindows(candles, OFFSETS, 30);
  const developmentBaselines = baselines.map((candidate) => evaluatePartition(candles, candidate, windowSets, 'development'));
  const generationSummaries: Array<{
    generation: number;
    family: string;
    candidateCount: number;
    qualifiedCount: number;
    topCandidates: Array<CandidateMetrics & { qualification: ReturnType<typeof developmentQualificationGate> }>;
  }> = [];
  let frozen: CandidateMetrics | null = null;
  let frozenQualification: ReturnType<typeof developmentQualificationGate> | null = null;

  for (const generation of candidateGenerations()) {
    const evaluated = generation.candidates.map((candidate) => evaluatePartition(candles, candidate, windowSets, 'development'));
    const ranked = rankDevelopment(evaluated);
    const qualified = ranked
      .map((metrics) => ({ metrics, qualification: developmentQualificationGate(metrics) }))
      .filter((entry) => entry.qualification.passed);
    generationSummaries.push({
      generation: generation.generation,
      family: generation.candidates[0]?.family ?? 'unknown',
      candidateCount: evaluated.length,
      qualifiedCount: qualified.length,
      topCandidates: ranked.slice(0, 10).map((metrics) => ({ ...metrics, qualification: developmentQualificationGate(metrics) })),
    });
    if (qualified.length > 0) {
      frozen = qualified[0].metrics;
      frozenQualification = qualified[0].qualification;
      break;
    }
  }

  await writeJson(directory, 'development.json', {
    evaluatedAt: new Date().toISOString(),
    holdoutOpened: false,
    baselines: developmentBaselines,
    generations: generationSummaries,
  });

  if (!frozen || !frozenQualification) {
    await writeJson(directory, 'outcome.json', {
      outcome: 'NO WINNER',
      evaluatedGenerations: generationSummaries.map((generation) => generation.generation),
      maximumGenerations: 4,
      frozenCandidateId: null,
      holdoutOpened: false,
      interpretation: 'No development candidate passed every pre-holdout qualification gate, so the sealed holdout was not opened and no production v2 is authorized.',
    });
    process.stdout.write(`${JSON.stringify({ directory, outcome: 'NO WINNER', holdoutOpened: false, evaluatedGenerations: generationSummaries.map((generation) => generation.generation) })}\n`);
    return;
  }

  await writeJson(directory, 'selection.json', {
    frozenAt: new Date().toISOString(),
    frozenCandidate: frozen.candidate,
    developmentMetrics: frozen,
    developmentQualification: frozenQualification,
    holdoutStatusBeforeOpen: 'sealed',
  });

  const holdoutWinner = evaluatePartition(candles, frozen.candidate, windowSets, 'holdout');
  const holdoutV1 = evaluatePartition(candles, baselines[0], windowSets, 'holdout');
  const holdoutCash = evaluatePartition(candles, baselines[1], windowSets, 'holdout');
  const holdoutBuyAndHold = evaluatePartition(candles, baselines[2], windowSets, 'holdout');
  const gate = winnerGate(holdoutWinner, holdoutV1, holdoutCash);
  await writeJson(directory, 'holdout.json', {
    openedAt: new Date().toISOString(),
    frozenCandidate: holdoutWinner,
    v1Baseline: holdoutV1,
    cashBaseline: holdoutCash,
    buyAndHoldBaseline: holdoutBuyAndHold,
    winnerGate: gate,
  });
  await writeJson(directory, 'outcome.json', {
    outcome: gate.passed ? 'WINNER' : 'NO WINNER',
    evaluatedGenerations: generationSummaries.map((generation) => generation.generation),
    maximumGenerations: 4,
    frozenCandidateId: frozen.candidate.id,
    winnerGate: gate,
    headline: {
      holdoutPositiveWindowRatio: percentage(holdoutWinner.aggregate.positiveWindowRatio),
      holdoutMeanReturn: percentage(holdoutWinner.aggregate.meanReturn),
      holdoutMedianReturn: percentage(holdoutWinner.aggregate.medianReturn),
      holdoutProfitFactor: holdoutWinner.aggregate.profitFactor,
      holdoutTotalProfitUsd: holdoutWinner.aggregate.totalProfitUsd,
      genuineProfitUsd: holdoutWinner.aggregate.genuineProfitUsd,
      qualificationProfitUsd: holdoutWinner.aggregate.qualificationProfitUsd,
      genuineRoundTrips: holdoutWinner.aggregate.genuineRoundTrips,
      qualificationRoundTrips: holdoutWinner.aggregate.qualificationRoundTrips,
    },
    interpretation: gate.passed
      ? 'The frozen candidate passed every predeclared holdout gate.'
      : 'No production v2 is authorized by this run because the frozen candidate failed one or more winner gates.',
  });
  process.stdout.write(`${JSON.stringify({ directory, outcome: gate.passed ? 'WINNER' : 'NO WINNER', candidate: frozen.candidate.id, gates: gate.gates, metrics: holdoutWinner.aggregate })}\n`);
}

void main();
