import { CanonicalPrimaryWindow } from './windows';
import { TIMEFRAME_MS, type CorrelatedRobustnessWindow, type PrimaryWindow } from './types';

type WindowOutcome = { window: PrimaryWindow | CorrelatedRobustnessWindow; positive: boolean };

type PrimaryOutcome = { window: PrimaryWindow; positive: boolean };

/** Opaque sample prevents diagnostics from being accidentally used as trials. */
export class PrimaryBernoulliSample {
  readonly #outcomes: readonly PrimaryOutcome[];

  constructor(outcomes: readonly PrimaryOutcome[]) {
    if (outcomes.length === 0) throw new Error('A primary Bernoulli sample cannot be empty.');
    this.#outcomes = Object.freeze([...outcomes]);
    Object.freeze(this);
  }

  get denominator(): number {
    return this.#outcomes.length;
  }

  get successes(): number {
    return this.#outcomes.filter((outcome) => outcome.positive).length;
  }
}

export function primaryBernoulliSample(outcomes: readonly WindowOutcome[]): PrimaryBernoulliSample {
  const ids = new Set<string>();
  let previousEnd = Number.NEGATIVE_INFINITY;
  for (const outcome of outcomes) {
    const { window } = outcome;
    if (!(window instanceof CanonicalPrimaryWindow)
      || window.classification !== 'primary_independent'
      || window.endTime - window.startTime !== TIMEFRAME_MS['1d']
      || window.startTime % TIMEFRAME_MS['1d'] !== 0
      || window.id !== `primary:${window.startTime}`
      || ids.has(window.id)
      || window.startTime < previousEnd) {
      throw new Error('Primary Bernoulli samples require unique canonical non-overlapping UTC windows.');
    }
    ids.add(window.id);
    previousEnd = window.endTime;
  }
  return new PrimaryBernoulliSample(outcomes as readonly PrimaryOutcome[]);
}

export type WilsonInterval = { pointEstimate: number; lower: number; upper: number; successes: number; denominator: number };

function wilson(sample: PrimaryBernoulliSample, z: number): WilsonInterval {
  const denominator = sample.denominator;
  const successes = sample.successes;
  const pointEstimate = successes / denominator;
  const zSquared = z ** 2;
  const center = (pointEstimate + zSquared / (2 * denominator)) / (1 + zSquared / denominator);
  const radius = z * Math.sqrt((pointEstimate * (1 - pointEstimate) + zSquared / (4 * denominator)) / denominator) / (1 + zSquared / denominator);
  return { pointEstimate, lower: Math.max(0, center - radius), upper: Math.min(1, center + radius), successes, denominator };
}

/** Two-sided 95% Wilson interval, fixed to avoid hidden library/version variance. */
export function wilsonInterval(sample: PrimaryBernoulliSample): WilsonInterval {
  return wilson(sample, 1.959963984540054);
}

export function wilsonOneSidedLower(sample: PrimaryBernoulliSample): number {
  return wilson(sample, 1.6448536269514722).lower;
}

export type BlockBootstrapConfig = {
  blockSize: number;
  iterations: number;
  seed: number;
  confidence: number;
};

export type BlockBootstrapMean = {
  mean: number;
  lower: number;
  upper: number;
  blockSize: number;
  iterations: number;
  seed: number;
};

function nextUint32(state: number): number {
  let value = state >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return value >>> 0;
}

function quantile(sorted: readonly number[], probability: number): number {
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/** Deterministic moving-block bootstrap; fewer than two fixed blocks is no evidence. */
export function movingBlockBootstrapMean(values: readonly number[], config: BlockBootstrapConfig): BlockBootstrapMean {
  const { blockSize, iterations, seed, confidence } = config;
  if (values.some((value) => !Number.isFinite(value))) throw new Error('Bootstrap values must be finite.');
  if (!Number.isInteger(blockSize) || blockSize <= 0 || !Number.isInteger(iterations) || iterations <= 0 || !Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff || !Number.isFinite(confidence) || confidence <= 0 || confidence >= 1) {
    throw new Error('Bootstrap requires an explicit valid block size, iterations, seed, and confidence.');
  }
  if (values.length < blockSize * 2) throw new Error('Insufficient observations for two complete bootstrap blocks.');
  let state = seed === 0 ? 0x6d2b79f5 : seed;
  const means: number[] = [];
  const startBound = values.length - blockSize + 1;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const resampled: number[] = [];
    while (resampled.length < values.length) {
      state = nextUint32(state);
      const start = state % startBound;
      for (let offset = 0; offset < blockSize && resampled.length < values.length; offset += 1) resampled.push(values[start + offset]);
    }
    means.push(resampled.reduce((sum, value) => sum + value, 0) / resampled.length);
  }
  means.sort((left, right) => left - right);
  const tail = (1 - confidence) / 2;
  return {
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    lower: quantile(means, tail),
    upper: quantile(means, 1 - tail),
    blockSize, iterations, seed,
  };
}

export type HolmAdjustment = { candidateId: string; rawPValue: number; adjustedPValue: number; passesAtAlpha: boolean };

/** Applies Holm to the complete frozen registry, including filtered failures. */
export function holmBonferroni(registeredCandidateIds: readonly string[], rawPValues: Readonly<Record<string, number>>, alpha = 0.05): HolmAdjustment[] {
  if (registeredCandidateIds.length === 0 || new Set(registeredCandidateIds).size !== registeredCandidateIds.length) throw new Error('Registered candidate IDs must be non-empty and unique.');
  if (!Number.isFinite(alpha) || alpha <= 0 || alpha >= 1) throw new Error('Alpha must be in (0, 1).');
  const expected = new Set(registeredCandidateIds);
  const received = Object.keys(rawPValues);
  if (received.length !== expected.size || received.some((id) => !expected.has(id))) throw new Error('Holm adjustment requires every and only registered candidate p-value.');
  const ordered = registeredCandidateIds.map((candidateId) => {
    const rawPValue = rawPValues[candidateId];
    if (!Number.isFinite(rawPValue) || rawPValue < 0 || rawPValue > 1) throw new Error(`Invalid p-value for ${candidateId}.`);
    return { candidateId, rawPValue };
  }).sort((left, right) => left.rawPValue - right.rawPValue || left.candidateId.localeCompare(right.candidateId));
  let previous = 0;
  const byId = new Map<string, number>();
  for (const [index, entry] of ordered.entries()) {
    previous = Math.max(previous, Math.min(1, entry.rawPValue * (ordered.length - index)));
    byId.set(entry.candidateId, previous);
  }
  return registeredCandidateIds.map((candidateId) => {
    const rawPValue = rawPValues[candidateId];
    const adjustedPValue = byId.get(candidateId) as number;
    return { candidateId, rawPValue, adjustedPValue, passesAtAlpha: adjustedPValue <= alpha };
  });
}

export function meetsPromotionSampleGates(input: { independentWindows: number; closedGenuineTrades: number }, minimums = { independentWindows: 30, closedGenuineTrades: 50 }): { passed: boolean; gates: Record<string, boolean> } {
  if (!Number.isInteger(input.independentWindows) || !Number.isInteger(input.closedGenuineTrades) || input.independentWindows < 0 || input.closedGenuineTrades < 0) throw new Error('Sample counts must be non-negative integers.');
  const gates = {
    independentWindows: input.independentWindows >= minimums.independentWindows,
    closedGenuineTrades: input.closedGenuineTrades >= minimums.closedGenuineTrades,
  };
  return { passed: Object.values(gates).every(Boolean), gates };
}
