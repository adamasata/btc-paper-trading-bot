import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertNoQuarantinedRange,
  canonicalSha256,
  createDataManifest,
  createQuarantineRegistry,
  normalizeProviderOhlcv,
  validateCompleteOhlcv,
  validateDataManifest,
} from '../src/research/v6/data-contract';
import type { NormalizedOhlcv, RawOhlcvRow } from '../src/research/v6/types';

const MINUTE = 60_000;
const start = Date.UTC(2026, 0, 1);

function row(index: number, overrides: Partial<RawOhlcvRow> = {}): RawOhlcvRow {
  return {
    openTime: start + index * MINUTE,
    open: '100',
    high: '101',
    low: '99',
    close: '100.5',
    volume: '2',
    providerMarker: `raw-${index}`,
    ...overrides,
  };
}

function candles(count = 3): NormalizedOhlcv[] {
  return normalizeProviderOhlcv(Array.from({ length: count }, (_, index) => row(index))).normalized;
}

test('v6 OHLCV contract rejects gaps, duplicates, invalid values, misalignment, and OHLC invariant violations', () => {
  const cases: Array<[string, NormalizedOhlcv[]]> = [
    ['gap', [{ ...candles(2)[0] }, { ...candles(2)[1], openTime: start + 2 * MINUTE, closeTime: start + 3 * MINUTE }]],
    ['duplicate', [{ ...candles(2)[0] }, { ...candles(2)[1], openTime: start, closeTime: start + MINUTE }]],
    ['non-positive volume', [{ ...candles(1)[0], volume: 0 }]],
    ['NaN', [{ ...candles(1)[0], close: Number.NaN }]],
    ['off-boundary time', [{ ...candles(1)[0], openTime: start + 1, closeTime: start + MINUTE + 1 }]],
    ['high below body', [{ ...candles(1)[0], high: 100 }]],
    ['low above body', [{ ...candles(1)[0], low: 100.25 }]],
  ];

  for (const [, invalid] of cases) assert.throws(() => validateCompleteOhlcv(invalid, '1m'));
});

test('evaluation-grade manifests require a hash-pinned quarantine registry, including explicit empty checks', () => {
  const rawRows = [row(0), row(1)];
  const normalized = normalizeProviderOhlcv(rawRows).normalized;
  const registry = createQuarantineRegistry({
    legacyRecords: [{ path: 'legacy/quarantine-v5.json', sha256: 'a'.repeat(64) }],
  });
  const manifest = createDataManifest(rawRows, normalized, registry);
  assert.equal(manifest.rawSha256, canonicalSha256(rawRows));
  assert.doesNotThrow(() => validateDataManifest(manifest, rawRows, normalized, registry));
  assert.throws(() => validateDataManifest(manifest, rawRows, normalized, { ...registry, legacyRecords: [] }));
  assert.throws(() => validateDataManifest({ ...manifest, quarantineRegistrySha256: '0'.repeat(64) }, rawRows, normalized, registry));
  assert.throws(() => createQuarantineRegistry({ ranges: [
    { id: 'one', startTime: start + 4 * MINUTE, endTime: start + 6 * MINUTE },
    { id: 'two', startTime: start + 5 * MINUTE, endTime: start + 7 * MINUTE },
  ] }));
  assert.throws(() => createQuarantineRegistry({ legacyRecords: [{ path: 'legacy/raw.csv', sha256: 'bad', extra: true } as never] }));
});

test('v6 rejects every dataset range intersecting a quarantined interval', () => {
  const source = candles(3);
  assert.throws(() => assertNoQuarantinedRange(source, [{ startTime: start + MINUTE, endTime: start + 2 * MINUTE, id: 'legacy' }]));
  assert.doesNotThrow(() => assertNoQuarantinedRange(source, [{ startTime: start + 3 * MINUTE, endTime: start + 4 * MINUTE, id: 'later' }]));
  const rawRows = [row(0), row(1), row(2)];
  const registry = createQuarantineRegistry({ ranges: [{ id: 'blocked', startTime: start + MINUTE, endTime: start + 2 * MINUTE }] });
  assert.throws(() => createDataManifest(rawRows, source, registry));
});

test('v6 manifests reject normalized candles not deterministically derived from raw provider prices', () => {
  const rawRows = [row(0), row(1)];
  const normalizedAt200 = normalizeProviderOhlcv(rawRows).normalized.map((candle) => ({
    ...candle,
    open: 200,
    high: 201,
    low: 199,
    close: 200,
  }));
  const registry = createQuarantineRegistry({});

  assert.throws(
    () => createDataManifest(rawRows, normalizedAt200, registry),
    /exact deterministic derivation/,
  );
});