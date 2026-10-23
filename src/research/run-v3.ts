import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { Candle } from '../domain/types';
import { buildWindows, developmentQualificationGate, evaluatePartition, rankDevelopment, winnerGate, type ResearchCandidate } from './harness';

const ROOT = process.cwd();
const OFFSETS = [0, 6, 12, 18];
const SOURCE_RUN = '2026-10-23T06-25-51-688Z';
const SOURCE_CANDLES = path.join(ROOT, 'research', 'runs', SOURCE_RUN, 'candles.json.gz');
const PREREGISTRATION_PATH = path.join(ROOT, 'research', 'preregistration-v3.json');

function candidate(allocationRate: number): ResearchCandidate {
  return {
    id: `five-entry-green-candle-streak-a${allocationRate}`,
    family: 'five-entry-green-candle-streak',
    allocationRate,
    params: {},
  };
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
  const runId = `${startedAt.replace(/[:.]/g, '-')}-v3`;
  const directory = path.join(ROOT, 'research', 'runs', runId);
  await mkdir(directory, { recursive: true });
  await writeJson(directory, 'run-order.json', {
    runId,
    startedAt,
    preregistrationPath: 'research/preregistration-v3.json',
    preregistrationSha256: createHash('sha256').update(preregistration).digest('hex'),
    assertionLimit: 'This records local file and run order only. The v3 document expressly is not immutable preregistration.',
  });
  await writeJson(directory, 'data-manifest.json', {
    sourceRun: `research/runs/${SOURCE_RUN}`,
    sourceArtifact: `research/runs/${SOURCE_RUN}/candles.json.gz`,
    sourceCandlesSha256: sourceHash,
    candleCount: candles.length,
    firstOpenTime: new Date(candles[0].openTime).toISOString(),
    lastCompleteOpenTime: new Date(candles[candles.length - 1].openTime).toISOString(),
    noRefetch: true,
    offsetHours: OFFSETS,
  });

  const candidates = [0.25, 0.4, 0.6].map(candidate);
  const windows = buildWindows(candles, OFFSETS, 30);
  const development = candidates.map((entry) => evaluatePartition(candles, entry, windows, 'development'));
  const ranked = rankDevelopment(development);
  const qualifications = ranked.map((metrics) => ({ candidateId: metrics.candidate.id, allocationRate: metrics.candidate.allocationRate, qualification: developmentQualificationGate(metrics), metrics }));
  const qualified = qualifications.filter((entry) => entry.qualification.passed);
  await writeJson(directory, 'development.json', {
    evaluatedAt: new Date().toISOString(),
    holdoutOpened: false,
    candidates: qualifications,
  });

  if (qualified.length === 0) {
    await writeJson(directory, 'outcome.json', {
      outcome: 'NO WINNER',
      frozenCandidateId: null,
      holdoutOpened: false,
      interpretation: 'No declared allocation passed every existing development qualification gate. Holdout remains sealed.',
    });
    process.stdout.write(`${JSON.stringify({ directory, outcome: 'NO WINNER', holdoutOpened: false, allocations: qualifications.map(({ candidateId, qualification }) => ({ candidateId, gates: qualification.gates })) })}\n`);
    return;
  }

  const frozen = qualified[0];
  await writeJson(directory, 'selection.json', {
    frozenAt: new Date().toISOString(),
    frozenCandidate: frozen.metrics.candidate,
    developmentMetrics: frozen.metrics,
    developmentQualification: frozen.qualification,
    holdoutStatusBeforeOpen: 'sealed',
  });
  const holdout = evaluatePartition(candles, frozen.metrics.candidate, windows, 'holdout');
  const v1 = evaluatePartition(candles, { id: 'v1-baseline', family: 'v1', allocationRate: 1, params: {} }, windows, 'holdout');
  const cash = evaluatePartition(candles, { id: 'cash-baseline', family: 'cash', allocationRate: 1, params: {} }, windows, 'holdout');
  const gate = winnerGate(holdout, v1, cash);
  await writeJson(directory, 'holdout.json', { openedAt: new Date().toISOString(), frozenCandidate: holdout, v1Baseline: v1, cashBaseline: cash, winnerGate: gate });
  await writeJson(directory, 'outcome.json', {
    outcome: gate.passed ? 'WINNER' : 'NO WINNER',
    frozenCandidateId: frozen.metrics.candidate.id,
    holdoutOpened: true,
    winnerGate: gate,
    interpretation: gate.passed ? 'The frozen allocation passed holdout.' : 'The frozen allocation failed one or more holdout gates.',
  });
  process.stdout.write(`${JSON.stringify({ directory, outcome: gate.passed ? 'WINNER' : 'NO WINNER', candidate: frozen.metrics.candidate.id, holdoutOpened: true, gates: gate.gates, metrics: holdout.aggregate })}\n`);
}

void main();
