import { closeSync, existsSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { canonicalSha256 } from './data-contract';
import { MINUTE_MS, TIMEFRAME_MS, type CorrelatedRobustnessWindow, type Fold, type PrimaryWindow, type TimeRange } from './types';

const DAY_MS = TIMEFRAME_MS['1d'];
const PARTITION_STATE_SCHEMA_VERSION = 1;
let temporaryFileSequence = 0;

function assertRange(range: TimeRange, label: string): void {
  if (!Number.isInteger(range.startTime) || !Number.isInteger(range.endTime) || range.startTime >= range.endTime) throw new Error(`${label} must be a non-empty integer-millisecond range.`);
}

function rangesOverlap(left: TimeRange, right: TimeRange): boolean {
  return left.startTime < right.endTime && right.startTime < left.endTime;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneRange(range: TimeRange): TimeRange {
  return Object.freeze({ startTime: range.startTime, endTime: range.endTime });
}

/** Runtime-opaque primary window emitted only after UTC boundary validation. */
export class CanonicalPrimaryWindow implements PrimaryWindow {
  readonly classification = 'primary_independent' as const;
  readonly id: string;
  readonly endTime: number;

  private constructor(readonly startTime: number) {
    this.id = `primary:${startTime}`;
    this.endTime = startTime + DAY_MS;
    Object.freeze(this);
  }

  static fromStartTime(startTime: number): CanonicalPrimaryWindow {
    if (!Number.isInteger(startTime) || startTime % DAY_MS !== 0) throw new Error('Primary windows must use UTC midnight boundaries.');
    return new CanonicalPrimaryWindow(startTime);
  }
}

/** Primary windows are the sole source of Bernoulli denominators. */
export function buildPrimaryUtcWindows(range: TimeRange): CanonicalPrimaryWindow[] {
  assertRange(range, 'Primary range');
  if (range.startTime % DAY_MS !== 0 || range.endTime % DAY_MS !== 0) throw new Error('Primary windows must use UTC midnight boundaries.');
  const windows: CanonicalPrimaryWindow[] = [];
  for (let startTime = range.startTime; startTime < range.endTime; startTime += DAY_MS) windows.push(CanonicalPrimaryWindow.fromStartTime(startTime));
  return windows;
}

/** Shifted windows are separately typed as correlated diagnostics. */
export function buildRobustnessOffsetWindows(input: TimeRange & { offsetHours: readonly number[] }): CorrelatedRobustnessWindow[] {
  assertRange(input, 'Robustness range');
  const windows: CorrelatedRobustnessWindow[] = [];
  for (const offsetHours of input.offsetHours) {
    if (!Number.isInteger(offsetHours) || offsetHours < 0 || offsetHours > 23) throw new Error('Robustness offsets must be whole UTC hours from 0 through 23.');
    const offsetMs = offsetHours * 60 * 60_000;
    const firstStart = Math.ceil((input.startTime - offsetMs) / DAY_MS) * DAY_MS + offsetMs;
    for (let startTime = firstStart; startTime + DAY_MS <= input.endTime; startTime += DAY_MS) {
      windows.push({ id: `diagnostic:${offsetHours}:${startTime}`, startTime, endTime: startTime + DAY_MS, offsetHours, classification: 'correlated_diagnostic' });
    }
  }
  return windows;
}

type RollingFoldInput = {
  trainingStartTime: number;
  firstValidationStartTime: number;
  validationBlockMs: number;
  foldCount: number;
  maxLookbackMinutes: number;
  maxHoldingMinutes: number;
};

function assertFold(fold: unknown, index: number): asserts fold is Fold {
  if (!isPlainRecord(fold)) throw new Error(`Fold ${index} has an invalid schema.`);
  const record = fold as unknown as Fold;
  if (typeof record.id !== 'string' || record.id.trim() === '' || !isPlainRecord(record.trainRange) || !isPlainRecord(record.purgeRange) || !isPlainRecord(record.validationRange)) {
    throw new Error(`Fold ${index} has an invalid schema.`);
  }
  assertRange(record.trainRange, `Fold ${record.id} train range`);
  assertRange(record.purgeRange, `Fold ${record.id} purge range`);
  assertRange(record.validationRange, `Fold ${record.id} validation range`);
  if ([record.trainRange, record.purgeRange, record.validationRange].some((range) => range.startTime % MINUTE_MS !== 0 || range.endTime % MINUTE_MS !== 0)) {
    throw new Error(`Fold ${record.id} ranges must align to complete UTC minute bars.`);
  }
  if (!Number.isInteger(record.maxLookbackMinutes) || !Number.isInteger(record.maxHoldingMinutes) || record.maxLookbackMinutes < 0 || record.maxHoldingMinutes < 0) {
    throw new Error(`Fold ${record.id} lookback and holding durations must be non-negative integer minutes.`);
  }
  if (record.trainRange.endTime > record.purgeRange.startTime || record.purgeRange.endTime > record.validationRange.startTime) {
    throw new Error(`Fold ${record.id} must order train, purge, then validation without overlap.`);
  }
  const requiredPurgeMs = (record.maxLookbackMinutes + record.maxHoldingMinutes) * 60_000;
  if (record.purgeRange.endTime - record.purgeRange.startTime < requiredPurgeMs) {
    throw new Error(`Fold ${record.id} purge is shorter than max lookback plus max holding time.`);
  }
}

/** Validates external folds before they can define any consumed evaluation partition. */
export function validateFolds(folds: readonly Fold[]): void {
  if (!Array.isArray(folds) || folds.length === 0) throw new Error('At least one fold is required to create a partition book.');
  const ids = new Set<string>();
  let previousValidationEnd = Number.NEGATIVE_INFINITY;
  for (const [index, fold] of folds.entries()) {
    assertFold(fold, index);
    if (ids.has(fold.id)) throw new Error(`Duplicate fold id: ${fold.id}.`);
    ids.add(fold.id);
    if (fold.validationRange.startTime < previousValidationEnd) throw new Error('Validation blocks must be chronological and disjoint.');
    previousValidationEnd = fold.validationRange.endTime;
  }
}

/** Expanding histories stop before a purge of lookback plus maximum holding time. */
export function buildRollingFolds(input: RollingFoldInput): Fold[] {
  const { trainingStartTime, firstValidationStartTime, validationBlockMs, foldCount, maxLookbackMinutes, maxHoldingMinutes } = input;
  if (![trainingStartTime, firstValidationStartTime, validationBlockMs, maxLookbackMinutes, maxHoldingMinutes].every(Number.isInteger) || !Number.isInteger(foldCount)) throw new Error('Fold boundaries and durations must be integers.');
  if (trainingStartTime < 0 || firstValidationStartTime <= trainingStartTime || validationBlockMs <= 0 || foldCount <= 0 || maxLookbackMinutes < 0 || maxHoldingMinutes < 0) throw new Error('Invalid rolling fold configuration.');
  const purgeMs = (maxLookbackMinutes + maxHoldingMinutes) * 60_000;
  const folds: Fold[] = [];
  for (let index = 0; index < foldCount; index += 1) {
    const validationStart = firstValidationStartTime + index * validationBlockMs;
    const trainEnd = validationStart - purgeMs;
    if (trainEnd <= trainingStartTime) throw new Error('Purge leaves no training history.');
    folds.push({
      id: `fold-${String(index + 1).padStart(2, '0')}`,
      trainRange: { startTime: trainingStartTime, endTime: trainEnd },
      purgeRange: { startTime: trainEnd, endTime: validationStart },
      validationRange: { startTime: validationStart, endTime: validationStart + validationBlockMs },
      maxLookbackMinutes,
      maxHoldingMinutes,
    });
  }
  validateFolds(folds);
  return folds;
}

type PersistedPartitionState = {
  schemaVersion: 1;
  partitionBookSha256: string;
  consumedRanges: readonly TimeRange[];
  retiredFinalRange: TimeRange | null;
};

export type PartitionBookOptions = {
  /** Caller-owned durable location; no default research artifact path is ever created. */
  statePath: string;
};

function assertStatePath(statePath: string): void {
  if (typeof statePath !== 'string' || statePath.trim() === '') throw new Error('Partition state path is required.');
  if (!existsSync(dirname(statePath))) throw new Error('Partition state directory must be created by the caller.');
}

function parsePersistedState(contents: string, expectedPartitionBookSha256: string, expectedConsumed: readonly TimeRange[]): PersistedPartitionState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error('Partition state is not valid JSON.');
  }
  if (!isPlainRecord(parsed) || parsed.schemaVersion !== PARTITION_STATE_SCHEMA_VERSION || typeof parsed.partitionBookSha256 !== 'string' || !Array.isArray(parsed.consumedRanges) || !('retiredFinalRange' in parsed)) {
    throw new Error('Partition state has an invalid schema.');
  }
  if (!/^[a-f0-9]{64}$/.test(parsed.partitionBookSha256) || parsed.partitionBookSha256 !== expectedPartitionBookSha256) throw new Error('Partition state does not belong to these folds.');
  const consumedRanges = parsed.consumedRanges.map((range) => {
    assertRange(range as TimeRange, 'Persisted consumed range');
    return { startTime: (range as TimeRange).startTime, endTime: (range as TimeRange).endTime };
  });
  if (canonicalSha256(consumedRanges) !== canonicalSha256(expectedConsumed)) throw new Error('Partition state consumed ranges do not match the supplied folds.');
  let retiredFinalRange: TimeRange | null = null;
  if (parsed.retiredFinalRange !== null) {
    assertRange(parsed.retiredFinalRange as TimeRange, 'Persisted final range');
    retiredFinalRange = cloneRange(parsed.retiredFinalRange as TimeRange);
    if (expectedConsumed.some((range) => rangesOverlap(range, retiredFinalRange as TimeRange))) throw new Error('Persisted final range overlaps consumed fold data.');
  }
  return Object.freeze({ schemaVersion: 1, partitionBookSha256: parsed.partitionBookSha256, consumedRanges: Object.freeze(consumedRanges.map(cloneRange)), retiredFinalRange });
}

function readPersistedState(statePath: string, partitionBookSha256: string, consumed: readonly TimeRange[]): PersistedPartitionState | null {
  if (!existsSync(statePath)) return null;
  return parsePersistedState(readFileSync(statePath, 'utf8'), partitionBookSha256, consumed);
}

function atomicWriteState(statePath: string, state: PersistedPartitionState): void {
  const temporaryPath = `${statePath}.${process.pid}.${temporaryFileSequence += 1}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(state)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    renameSync(temporaryPath, statePath);
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

function withStateLock<T>(statePath: string, operation: () => T): T {
  const lockPath = `${statePath}.lock`;
  let lock: number | undefined;
  try {
    lock = openSync(lockPath, 'wx', 0o600);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Partition state is currently being updated; retry the reservation.');
    throw error;
  }
  try {
    return operation();
  } finally {
    if (lock !== undefined) closeSync(lock);
    if (existsSync(lockPath)) unlinkSync(lockPath);
  }
}

/** Tracks consumed folds and durably retires exactly one final range across processes. */
export class PartitionBook {
  readonly #consumed: readonly TimeRange[];
  readonly #partitionBookSha256: string;
  readonly #statePath: string;
  #finalRange: TimeRange | null;

  constructor(folds: readonly Fold[], options: PartitionBookOptions) {
    validateFolds(folds);
    assertStatePath(options.statePath);
    this.#consumed = Object.freeze(folds.flatMap((fold) => [fold.trainRange, fold.purgeRange, fold.validationRange]).map(cloneRange));
    this.#partitionBookSha256 = canonicalSha256(folds);
    this.#statePath = options.statePath;
    this.#finalRange = readPersistedState(this.#statePath, this.#partitionBookSha256, this.#consumed)?.retiredFinalRange ?? null;
  }

  get retiredFinalRange(): Readonly<TimeRange> | null {
    return this.#finalRange === null ? null : cloneRange(this.#finalRange);
  }

  private assertFinalRangeAvailable(range: TimeRange): void {
    assertRange(range, 'Final test range');
    if (this.#finalRange !== null) throw new Error('A final test range is already retired and cannot be reused.');
    if (this.#consumed.some((consumed) => rangesOverlap(range, consumed))) throw new Error('Final test range overlaps already-consumed fold data.');
  }

  reserveFinalTestRange(range: TimeRange): Readonly<TimeRange> {
    return withStateLock(this.#statePath, () => {
      const latest = readPersistedState(this.#statePath, this.#partitionBookSha256, this.#consumed);
      this.#finalRange = latest?.retiredFinalRange ?? null;
      this.assertFinalRangeAvailable(range);
      const retiredFinalRange = cloneRange(range);
      const state: PersistedPartitionState = Object.freeze({
        schemaVersion: 1,
        partitionBookSha256: this.#partitionBookSha256,
        consumedRanges: this.#consumed,
        retiredFinalRange,
      });
      atomicWriteState(this.#statePath, state);
      this.#finalRange = retiredFinalRange;
      return cloneRange(retiredFinalRange);
    });
  }
}

export function createPartitionBook(folds: readonly Fold[], options: PartitionBookOptions): PartitionBook {
  return new PartitionBook(folds, options);
}

export type CandidateSpec = Readonly<Record<string, unknown>>;
export type CandidateDefinition = {
  id: string;
  family: string;
  featureSpec: CandidateSpec;
  signalSpec: CandidateSpec;
  exitSpec: CandidateSpec;
  allocationSpec: CandidateSpec;
  maxLookbackMinutes: number;
  maxHoldingMinutes: number;
  duplicateFingerprint: string;
};

function assertCandidateSpec(spec: unknown, label: string): asserts spec is CandidateSpec {
  if (!isPlainRecord(spec) || Object.keys(spec).length === 0) throw new Error(`${label} must be a non-empty plain JSON object.`);
  canonicalSha256(spec);
}

/** Candidate definitions are complete, canonicalizable, and immutable before selection. */
export function validateCandidateDefinition(candidate: unknown): asserts candidate is CandidateDefinition {
  if (!isPlainRecord(candidate)) throw new Error('Candidate requires a plain-object definition.');
  const record = candidate as unknown as CandidateDefinition;
  if (typeof record.id !== 'string' || record.id.trim() === ''
    || typeof record.family !== 'string' || record.family.trim() === ''
    || !Number.isInteger(record.maxLookbackMinutes) || record.maxLookbackMinutes < 0
    || !Number.isInteger(record.maxHoldingMinutes) || record.maxHoldingMinutes < 0
    || typeof record.duplicateFingerprint !== 'string' || record.duplicateFingerprint.trim() === '') {
    throw new Error('Candidate requires id, family, feature/signal/exit/allocation specs, durations, and duplicate fingerprint.');
  }
  assertCandidateSpec(record.featureSpec, 'Candidate featureSpec');
  assertCandidateSpec(record.signalSpec, 'Candidate signalSpec');
  assertCandidateSpec(record.exitSpec, 'Candidate exitSpec');
  assertCandidateSpec(record.allocationSpec, 'Candidate allocationSpec');
}

function cloneCandidate(candidate: CandidateDefinition): CandidateDefinition {
  return JSON.parse(JSON.stringify(candidate)) as CandidateDefinition;
}

/** Candidate identity and the complete frozen definition must both match later stages. */
export class FrozenCandidate {
  readonly #candidate: CandidateDefinition;
  readonly #definitionSha256: string;

  constructor(candidate: CandidateDefinition) {
    validateCandidateDefinition(candidate);
    this.#candidate = Object.freeze(cloneCandidate(candidate));
    this.#definitionSha256 = canonicalSha256(this.#candidate);
    Object.freeze(this);
  }

  get candidateId(): string {
    return this.#candidate.id;
  }

  get definitionSha256(): string {
    return this.#definitionSha256;
  }

  toArtifact(): Readonly<{ candidate: CandidateDefinition; definitionSha256: string }> {
    return Object.freeze({ candidate: cloneCandidate(this.#candidate), definitionSha256: this.#definitionSha256 });
  }

  assertMatches(candidate: CandidateDefinition): void {
    validateCandidateDefinition(candidate);
    if (candidate.id !== this.#candidate.id || canonicalSha256(candidate) !== this.#definitionSha256) throw new Error('Candidate changed after freeze.');
  }
}

export function freezeCandidate(candidate: CandidateDefinition): FrozenCandidate {
  return new FrozenCandidate(candidate);
}