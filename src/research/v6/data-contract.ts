import { createHash } from 'node:crypto';
import {
  MINUTE_MS,
  TIMEFRAME_MS,
  type DataManifestIntegrity,
  type LegacyQuarantineRecord,
  type NormalizedOhlcv,
  type QuarantinedRange,
  type QuarantineRegistry,
  type RawOhlcvRow,
  type Timeframe,
} from './types';

function finiteNumber(value: unknown, field: string, index: number): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) throw new Error(`OHLCV row ${index} has non-finite ${field}.`);
  return parsed;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function canonicalJson(value: unknown, ancestors = new WeakSet<object>()): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Canonical hashing rejects non-finite numbers.');
    return Object.is(value, -0) ? '0' : JSON.stringify(value);
  }
  if (typeof value !== 'object') throw new Error(`Canonical hashing rejects ${typeof value} values.`);
  if (ancestors.has(value)) throw new Error('Canonical hashing rejects cyclic values.');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.keys(value).length !== value.length) throw new Error('Canonical hashing rejects sparse arrays and extra array properties.');
      return `[${value.map((entry) => canonicalJson(entry, ancestors)).join(',')}]`;
    }
    if (!isPlainRecord(value)) throw new Error('Canonical hashing accepts only plain JSON objects.');
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key], ancestors)}`).join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

/** Stable hash for persisted manifests; object key order cannot alter evidence. */
export function canonicalSha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function assertSha256(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`${label} must be lowercase SHA-256 hex.`);
}

function assertRange(range: unknown, label: string): asserts range is QuarantinedRange {
  if (!isPlainRecord(range)) throw new Error(`${label} must be a non-empty integer-millisecond range with an id.`);
  const record = range as unknown as QuarantinedRange;
  if (typeof record.id !== 'string' || record.id.trim() === '' || !Number.isInteger(record.startTime) || !Number.isInteger(record.endTime) || record.startTime >= record.endTime) {
    throw new Error(`${label} must be a non-empty integer-millisecond range with an id.`);
  }
}

function assertLegacyRecord(record: unknown): asserts record is LegacyQuarantineRecord {
  if (!isPlainRecord(record) || typeof record.path !== 'string' || record.path.trim() === '' || Object.keys(record).length !== 2) {
    throw new Error('Legacy quarantine records must persist path and SHA-256 only.');
  }
  assertSha256(record.sha256, 'Legacy quarantine record hash');
}

/** Validates a persisted quarantine registry before it can protect evaluation data. */
export function validateQuarantineRegistry(registry: unknown): asserts registry is QuarantineRegistry {
  if (!isPlainRecord(registry) || registry.schemaVersion !== 1 || !Array.isArray(registry.ranges) || !Array.isArray(registry.legacyRecords) || Object.keys(registry).length !== 3) {
    throw new Error('Evaluation-grade data requires a schema-v1 quarantine registry.');
  }
  const rangeIds = new Set<string>();
  const ranges: QuarantinedRange[] = [];
  for (const range of registry.ranges) {
    assertRange(range, 'Quarantined range');
    if (rangeIds.has(range.id)) throw new Error(`Duplicate quarantined range id: ${range.id}.`);
    rangeIds.add(range.id);
    ranges.push(range);
  }
  ranges.sort((left, right) => left.startTime - right.startTime || left.endTime - right.endTime);
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index - 1].endTime > ranges[index].startTime) throw new Error('Quarantined ranges must not overlap.');
  }
  const legacyPaths = new Set<string>();
  for (const record of registry.legacyRecords) {
    assertLegacyRecord(record);
    if (legacyPaths.has(record.path)) throw new Error(`Duplicate legacy quarantine path: ${record.path}.`);
    legacyPaths.add(record.path);
  }
}

/** Builds an immutable registry; even an empty registry is an explicit quarantine check. */
export function createQuarantineRegistry(input: { ranges?: readonly QuarantinedRange[]; legacyRecords?: readonly LegacyQuarantineRecord[] }): QuarantineRegistry {
  const registry: QuarantineRegistry = {
    schemaVersion: 1,
    ranges: input.ranges?.map((range) => ({ ...range })) ?? [],
    legacyRecords: input.legacyRecords?.map((record) => ({ ...record })) ?? [],
  };
  validateQuarantineRegistry(registry);
  return Object.freeze({
    ...registry,
    ranges: Object.freeze(registry.ranges.map((range) => Object.freeze({ ...range }))),
    legacyRecords: Object.freeze(registry.legacyRecords.map((record) => Object.freeze({ ...record }))),
  });
}

export const PROVIDER_OHLCV_NORMALIZER_V1 = 'provider-ohlcv-v1';

const RAW_OHLCV_REQUIRED_FIELDS = ['openTime', 'open', 'high', 'low', 'close', 'volume'] as const;
type RawOhlcvNormalizer = (rawRows: readonly RawOhlcvRow[]) => NormalizedOhlcv[];

/**
 * Validates the provider fields used by every registered normalizer while retaining
 * provider-specific fields as hash-pinned raw evidence.
 */
export function validateRawOhlcvRows(rawRows: unknown): asserts rawRows is readonly RawOhlcvRow[] {
  if (!Array.isArray(rawRows) || rawRows.length === 0) throw new Error('Raw OHLCV data must be a non-empty provider-row array.');
  for (let index = 0; index < rawRows.length; index += 1) {
    const row = rawRows[index];
    if (!isPlainRecord(row)) throw new Error(`Raw OHLCV row ${index} must be a plain provider record.`);
    for (const field of RAW_OHLCV_REQUIRED_FIELDS) {
      if (!Object.hasOwn(row, field)) throw new Error(`Raw OHLCV row ${index} is missing required provider field ${field}.`);
      finiteNumber(row[field], field, index);
    }
    const openTime = finiteNumber(row.openTime, 'openTime', index);
    if (!Number.isInteger(openTime)) throw new Error(`OHLCV row ${index} has non-integer openTime.`);
  }
  canonicalJson(rawRows);
}

function normalizeProviderOhlcvV1(rawRows: readonly RawOhlcvRow[]): NormalizedOhlcv[] {
  return rawRows.map((row, index) => {
    const openTime = finiteNumber(row.openTime, 'openTime', index);
    return {
      openTime,
      closeTime: openTime + MINUTE_MS,
      open: finiteNumber(row.open, 'open', index),
      high: finiteNumber(row.high, 'high', index),
      low: finiteNumber(row.low, 'low', index),
      close: finiteNumber(row.close, 'close', index),
      volume: finiteNumber(row.volume, 'volume', index),
    };
  });
}

const RAW_OHLCV_NORMALIZERS: Readonly<Record<string, RawOhlcvNormalizer>> = Object.freeze({
  [PROVIDER_OHLCV_NORMALIZER_V1]: normalizeProviderOhlcvV1,
});

function getRawOhlcvNormalizer(version: unknown): RawOhlcvNormalizer {
  if (typeof version !== 'string' || !Object.hasOwn(RAW_OHLCV_NORMALIZERS, version)) {
    throw new Error(`Unsupported raw OHLCV normalizer version: ${String(version)}.`);
  }
  return RAW_OHLCV_NORMALIZERS[version];
}

/** Re-derives normalized 1m candles from persisted provider rows using a versioned contract. */
export function deriveNormalizedOhlcv(rawRows: readonly RawOhlcvRow[], normalizerVersion: string): NormalizedOhlcv[] {
  validateRawOhlcvRows(rawRows);
  const normalized = getRawOhlcvNormalizer(normalizerVersion)(rawRows);
  validateCompleteOhlcv(normalized, '1m');
  return normalized;
}

/** Converts but never imputes provider data; the caller retains raw rows beside output. */
export function normalizeProviderOhlcv(rawRows: readonly RawOhlcvRow[]): { rawRows: readonly RawOhlcvRow[]; normalized: NormalizedOhlcv[] } {
  return { rawRows, normalized: deriveNormalizedOhlcv(rawRows, PROVIDER_OHLCV_NORMALIZER_V1) };
}

/** Data must be complete, UTC aligned, ordered, and internally physically valid. */
export function validateCompleteOhlcv(candles: readonly NormalizedOhlcv[], timeframe: Timeframe): void {
  if (candles.length === 0) throw new Error('OHLCV data cannot be empty.');
  const interval = TIMEFRAME_MS[timeframe];
  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    const values = [candle.openTime, candle.closeTime, candle.open, candle.high, candle.low, candle.close, candle.volume];
    if (values.some((value) => !Number.isFinite(value))) throw new Error(`OHLCV candle ${index} has a non-finite field.`);
    if (!Number.isInteger(candle.openTime) || candle.openTime % interval !== 0) throw new Error(`OHLCV candle ${index} is not ${timeframe} UTC aligned.`);
    if (candle.closeTime !== candle.openTime + interval) throw new Error(`OHLCV candle ${index} has an invalid close boundary.`);
    if (candle.open <= 0 || candle.high <= 0 || candle.low <= 0 || candle.close <= 0 || candle.volume <= 0) throw new Error(`OHLCV candle ${index} must have positive prices and volume.`);
    if (candle.high < Math.max(candle.open, candle.close) || candle.low > Math.min(candle.open, candle.close) || candle.low > candle.high) {
      throw new Error(`OHLCV candle ${index} violates OHLC invariants.`);
    }
    if (index > 0 && candle.openTime - candles[index - 1].openTime !== interval) throw new Error(`OHLCV candles must be contiguous ${timeframe} bars without duplicates.`);
  }
}

export function assertNoQuarantinedRange(candles: readonly NormalizedOhlcv[], quarantined: readonly QuarantinedRange[]): void {
  validateCompleteOhlcv(candles, '1m');
  const dataStart = candles[0].openTime;
  const dataEnd = candles[candles.length - 1].closeTime;
  for (const range of quarantined) {
    assertRange(range, 'Quarantined range');
    if (dataStart < range.endTime && range.startTime < dataEnd) throw new Error(`Data range intersects quarantined range: ${range.id}.`);
  }
}

/** Creates a hash-pinned manifest only after deterministic derivation and quarantine checks. */
export function createDataManifest(rawRows: readonly RawOhlcvRow[], normalized: readonly NormalizedOhlcv[], quarantineRegistry: QuarantineRegistry): DataManifestIntegrity {
  const normalizerVersion = PROVIDER_OHLCV_NORMALIZER_V1;
  const rederivedNormalized = deriveNormalizedOhlcv(rawRows, normalizerVersion);
  validateCompleteOhlcv(normalized, '1m');
  if (canonicalJson(rederivedNormalized) !== canonicalJson(normalized)
    || canonicalSha256(rederivedNormalized) !== canonicalSha256(normalized)) {
    throw new Error('Normalized data is not the exact deterministic derivation of raw provider rows.');
  }
  validateQuarantineRegistry(quarantineRegistry);
  assertNoQuarantinedRange(rederivedNormalized, quarantineRegistry.ranges);
  return Object.freeze({
    rawSha256: canonicalSha256(rawRows),
    normalizedSha256: canonicalSha256(rederivedNormalized),
    quarantineRegistrySha256: canonicalSha256(quarantineRegistry),
    normalizerVersion,
    firstOpenTime: rederivedNormalized[0].openTime,
    lastCompleteOpenTime: rederivedNormalized[rederivedNormalized.length - 1].openTime,
    candleCount: rederivedNormalized.length,
  });
}

/** Verifies hash-pinned artifacts, deterministic raw-to-normalized provenance, and mandatory quarantine checks. */
export function validateDataManifest(manifest: DataManifestIntegrity, rawRows: readonly RawOhlcvRow[], normalized: readonly NormalizedOhlcv[], quarantineRegistry: QuarantineRegistry): void {
  if (!isPlainRecord(manifest) || Object.keys(manifest).length !== 7) throw new Error('Data manifest must be a plain schema-v1 object.');
  assertSha256(manifest.rawSha256, 'Raw artifact hash');
  assertSha256(manifest.normalizedSha256, 'Normalized artifact hash');
  assertSha256(manifest.quarantineRegistrySha256, 'Quarantine registry hash');
  const rederivedNormalized = deriveNormalizedOhlcv(rawRows, manifest.normalizerVersion);
  validateCompleteOhlcv(normalized, '1m');
  if (canonicalJson(rederivedNormalized) !== canonicalJson(normalized)
    || canonicalSha256(rederivedNormalized) !== canonicalSha256(normalized)) {
    throw new Error('Normalized data is not the exact deterministic derivation of raw provider rows.');
  }
  validateQuarantineRegistry(quarantineRegistry);
  if (manifest.rawSha256 !== canonicalSha256(rawRows)) throw new Error('Raw artifact hash does not match data manifest.');
  if (manifest.normalizedSha256 !== canonicalSha256(normalized)) throw new Error('Normalized artifact hash does not match data manifest.');
  if (manifest.quarantineRegistrySha256 !== canonicalSha256(quarantineRegistry)) throw new Error('Quarantine registry hash does not match data manifest.');
  assertNoQuarantinedRange(rederivedNormalized, quarantineRegistry.ranges);
  if (manifest.candleCount !== rederivedNormalized.length || manifest.firstOpenTime !== rederivedNormalized[0].openTime || manifest.lastCompleteOpenTime !== rederivedNormalized[rederivedNormalized.length - 1].openTime) {
    throw new Error('Data manifest range or count does not match normalized candles.');
  }
}