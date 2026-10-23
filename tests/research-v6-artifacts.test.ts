import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { readEvaluationDataArtifacts, readIntegrityArtifact, writeIntegrityArtifact } from '../src/research/v6/artifacts';
import { adverseCostScenario, baseCostScenario, createCostScenarioRegistry } from '../src/research/v6/cost-model';
import { canonicalSha256, createDataManifest, createQuarantineRegistry, normalizeProviderOhlcv } from '../src/research/v6/data-contract';
import { buildRollingFolds, freezeCandidate } from '../src/research/v6/windows';

const start = Date.UTC(2026, 0, 1);
const MINUTE = 60_000;

function rawRows() {
  return [0, 1].map((index) => ({
    openTime: start + index * MINUTE,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1,
  }));
}

test('integrity artifacts atomically round-trip all required evidence kinds through caller-owned paths', () => {
  const directory = mkdtempSync(`${tmpdir()}/research-v6-artifacts-`);
  const costRegistry = createCostScenarioRegistry([
    baseCostScenario({ id: 'base', version: 'v1', feeRate: 0.001, spreadBps: 5, adverseSlippageBps: 0 }),
    adverseCostScenario({ id: 'adverse', version: 'v1', feeRate: 0.002, spreadBps: 6, adverseSlippageBps: 1 }),
  ]);
  const raw = rawRows();
  const normalized = normalizeProviderOhlcv(raw).normalized;
  const quarantine = createQuarantineRegistry({ legacyRecords: [{ path: 'legacy/v5.json', sha256: 'b'.repeat(64) }] });
  const manifest = createDataManifest(raw, normalized, quarantine);
  const folds = buildRollingFolds({ trainingStartTime: start, firstValidationStartTime: start + 2 * 24 * 60 * MINUTE, validationBlockMs: 24 * 60 * MINUTE, foldCount: 1, maxLookbackMinutes: 1, maxHoldingMinutes: 1 });
  const frozen = freezeCandidate({
    id: 'candidate', family: 'momentum', featureSpec: { source: 'close' }, signalSpec: { threshold: 1 }, exitSpec: { timeout: 1 }, allocationSpec: { fraction: 0.1 }, maxLookbackMinutes: 1, maxHoldingMinutes: 1, duplicateFingerprint: 'momentum-v1',
  });
  const artifacts = [
    ['registry', costRegistry.toArtifact()],
    ['raw_data', raw],
    ['normalized_data', normalized],
    ['quarantine', quarantine],
    ['data_manifest', manifest],
    ['partitions', folds],
    ['frozen_selection', frozen.toArtifact()],
    ['bootstrap_configuration', { blockSize: 2, iterations: 100, seed: 7, confidence: 0.95 }],
    ['stage_status', { stage: 'selection', status: 'passed' }],
  ] as const;
  try {
    for (const [kind, payload] of artifacts) {
      const path = `${directory}/${kind}.json`;
      const written = writeIntegrityArtifact(path, kind, payload);
      const read = readIntegrityArtifact(path, kind);
      assert.equal(read.sha256, written.sha256);
      assert.deepEqual(read.payload, payload);
    }
    const path = `${directory}/registry.json`;
    writeFileSync(path, JSON.stringify({ schemaVersion: 1, kind: 'registry', payload: costRegistry.toArtifact(), sha256: '0'.repeat(64) }));
    assert.throws(() => readIntegrityArtifact(path, 'registry'));
    assert.throws(() => writeIntegrityArtifact(`${directory}/bad.json`, 'stage_status', { stage: 'selection', status: 'unknown' }));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('evaluation artifact read-back rejects tampered derivation and unknown normalizer versions', () => {
  const directory = mkdtempSync(`${tmpdir()}/research-v6-provenance-`);
  const paths = {
    rawDataPath: `${directory}/raw.json`,
    normalizedDataPath: `${directory}/normalized.json`,
    quarantinePath: `${directory}/quarantine.json`,
    dataManifestPath: `${directory}/manifest.json`,
  };
  const raw = rawRows();
  const normalized = normalizeProviderOhlcv(raw).normalized;
  const quarantine = createQuarantineRegistry({});
  const manifest = createDataManifest(raw, normalized, quarantine);
  const normalizedAt200 = normalized.map((candle) => ({
    ...candle,
    open: 200,
    high: 201,
    low: 199,
    close: 200,
  }));

  try {
    writeIntegrityArtifact(paths.rawDataPath, 'raw_data', raw);
    writeIntegrityArtifact(paths.quarantinePath, 'quarantine', quarantine);
    writeIntegrityArtifact(paths.normalizedDataPath, 'normalized_data', normalizedAt200);
    writeIntegrityArtifact(paths.dataManifestPath, 'data_manifest', {
      ...manifest,
      normalizedSha256: canonicalSha256(normalizedAt200),
    });
    assert.throws(
      () => readEvaluationDataArtifacts(paths),
      /exact deterministic derivation/,
    );

    writeIntegrityArtifact(paths.normalizedDataPath, 'normalized_data', normalized);
    writeIntegrityArtifact(paths.dataManifestPath, 'data_manifest', {
      ...manifest,
      normalizerVersion: 'provider-ohlcv-v999',
    });
    assert.throws(
      () => readEvaluationDataArtifacts(paths),
      /Unsupported raw OHLCV normalizer version/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});