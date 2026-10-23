import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { canonicalJson, canonicalSha256, validateCompleteOhlcv, validateDataManifest, validateQuarantineRegistry, validateRawOhlcvRows } from './data-contract';
import { createCostScenarioRegistry } from './cost-model';
import { type DataManifestIntegrity, type NormalizedOhlcv, type RawOhlcvRow } from './types';
import { validateCandidateDefinition, validateFolds } from './windows';

export const INTEGRITY_ARTIFACT_SCHEMA_VERSION = 1;
export type IntegrityArtifactKind = 'registry' | 'raw_data' | 'normalized_data' | 'quarantine' | 'data_manifest' | 'partitions' | 'frozen_selection' | 'bootstrap_configuration' | 'stage_status';
export type IntegrityArtifactEnvelope = {
  schemaVersion: 1;
  kind: IntegrityArtifactKind;
  payload: unknown;
  sha256: string;
};

let temporaryFileSequence = 0;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertBootstrapConfiguration(payload: unknown): void {
  if (!isPlainRecord(payload)) throw new Error('Bootstrap artifact requires a plain object.');
  const config = payload as { blockSize: number; iterations: number; seed: number; confidence: number };
  if (Object.keys(config).length !== 4
    || !Number.isInteger(config.blockSize) || config.blockSize <= 0
    || !Number.isInteger(config.iterations) || config.iterations <= 0
    || !Number.isInteger(config.seed) || config.seed < 0 || config.seed > 0xffff_ffff
    || !Number.isFinite(config.confidence) || config.confidence <= 0 || config.confidence >= 1) {
    throw new Error('Bootstrap artifact requires blockSize, iterations, seed, and confidence.');
  }
}

function assertStageStatus(payload: unknown): void {
  if (!isPlainRecord(payload) || Object.keys(payload).length !== 2 || typeof payload.stage !== 'string' || payload.stage.trim() === ''
    || (payload.status !== 'pending' && payload.status !== 'running' && payload.status !== 'passed' && payload.status !== 'failed')) {
    throw new Error('Stage status artifact requires a named pending/running/passed/failed stage.');
  }
}

/** Runtime schema gate for every persisted integrity artifact kind. */
export function validateIntegrityArtifactPayload(kind: IntegrityArtifactKind, payload: unknown): void {
  switch (kind) {
    case 'registry':
      if (!Array.isArray(payload)) throw new Error('Registry artifact payload must be an array of scenarios.');
      createCostScenarioRegistry(payload);
      return;
    case 'raw_data':
      validateRawOhlcvRows(payload);
      return;
    case 'normalized_data':
      if (!Array.isArray(payload)) throw new Error('Normalized data artifact payload must be an array.');
      validateCompleteOhlcv(payload as NormalizedOhlcv[], '1m');
      return;
    case 'quarantine':
      validateQuarantineRegistry(payload);
      return;
    case 'data_manifest': {
      if (!isPlainRecord(payload) || Object.keys(payload).length !== 7) throw new Error('Data manifest artifact has an invalid schema.');
      const manifest = payload as DataManifestIntegrity;
      if (![manifest.rawSha256, manifest.normalizedSha256, manifest.quarantineRegistrySha256].every((hash) => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash))
        || typeof manifest.normalizerVersion !== 'string' || manifest.normalizerVersion.trim() === ''
        || !Number.isInteger(manifest.firstOpenTime) || !Number.isInteger(manifest.lastCompleteOpenTime) || !Number.isInteger(manifest.candleCount) || manifest.candleCount <= 0) {
        throw new Error('Data manifest artifact has invalid integrity fields.');
      }
      return;
    }
    case 'partitions':
      if (!Array.isArray(payload)) throw new Error('Partition artifact payload must be a fold array.');
      validateFolds(payload);
      return;
    case 'frozen_selection': {
      if (!isPlainRecord(payload) || Object.keys(payload).length !== 2 || !('candidate' in payload) || typeof payload.definitionSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(payload.definitionSha256)) {
        throw new Error('Frozen selection artifact has an invalid schema.');
      }
      validateCandidateDefinition(payload.candidate);
      if (canonicalSha256(payload.candidate) !== payload.definitionSha256) throw new Error('Frozen selection artifact definition hash does not match candidate.');
      return;
    }
    case 'bootstrap_configuration':
      assertBootstrapConfiguration(payload);
      return;
    case 'stage_status':
      assertStageStatus(payload);
      return;
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unknown integrity artifact kind: ${exhaustive}.`);
    }
  }
}

export function integrityArtifactHash(kind: IntegrityArtifactKind, payload: unknown): string {
  validateIntegrityArtifactPayload(kind, payload);
  return canonicalSha256({ schemaVersion: INTEGRITY_ARTIFACT_SCHEMA_VERSION, kind, payload });
}

function assertArtifactPath(artifactPath: string): void {
  if (typeof artifactPath !== 'string' || artifactPath.trim() === '') throw new Error('Artifact path is required.');
  if (!existsSync(dirname(artifactPath))) throw new Error('Artifact directory must be created by the caller.');
}

/** Atomically writes a schema-validated deterministic envelope to an explicit caller-owned path. */
export function writeIntegrityArtifact(artifactPath: string, kind: IntegrityArtifactKind, payload: unknown): Readonly<IntegrityArtifactEnvelope> {
  assertArtifactPath(artifactPath);
  const sha256 = integrityArtifactHash(kind, payload);
  const envelope: IntegrityArtifactEnvelope = Object.freeze({ schemaVersion: 1, kind, payload, sha256 });
  const temporaryPath = `${artifactPath}.${process.pid}.${temporaryFileSequence += 1}.tmp`;
  try {
    writeFileSync(temporaryPath, `${canonicalJson(envelope)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    renameSync(temporaryPath, artifactPath);
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
  return envelope;
}

/** Reader revalidates JSON type, schema kind, and deterministic hash before returning an artifact. */
export function readIntegrityArtifact(artifactPath: string, expectedKind?: IntegrityArtifactKind): Readonly<IntegrityArtifactEnvelope> {
  assertArtifactPath(artifactPath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(artifactPath, 'utf8'));
  } catch {
    throw new Error('Integrity artifact is not valid JSON.');
  }
  if (!isPlainRecord(parsed) || parsed.schemaVersion !== INTEGRITY_ARTIFACT_SCHEMA_VERSION || typeof parsed.kind !== 'string' || typeof parsed.sha256 !== 'string' || !('payload' in parsed)) {
    throw new Error('Integrity artifact has an invalid envelope schema.');
  }
  const kind = parsed.kind as IntegrityArtifactKind;
  if (!['registry', 'raw_data', 'normalized_data', 'quarantine', 'data_manifest', 'partitions', 'frozen_selection', 'bootstrap_configuration', 'stage_status'].includes(kind)) throw new Error('Integrity artifact has an unknown kind.');
  if (expectedKind !== undefined && kind !== expectedKind) throw new Error(`Integrity artifact kind mismatch: expected ${expectedKind}, received ${kind}.`);
  const expectedHash = integrityArtifactHash(kind, parsed.payload);
  if (parsed.sha256 !== expectedHash) throw new Error('Integrity artifact hash does not match its payload.');
  return Object.freeze({ schemaVersion: 1, kind, payload: parsed.payload, sha256: parsed.sha256 });
}

/** Reads the four coupled data artifacts and rejects any hash-mismatched recombination. */
export function readEvaluationDataArtifacts(paths: { rawDataPath: string; normalizedDataPath: string; quarantinePath: string; dataManifestPath: string }): Readonly<{ rawRows: readonly RawOhlcvRow[]; normalized: readonly NormalizedOhlcv[]; manifest: DataManifestIntegrity }> {
  const rawRows = readIntegrityArtifact(paths.rawDataPath, 'raw_data').payload as readonly RawOhlcvRow[];
  const normalized = readIntegrityArtifact(paths.normalizedDataPath, 'normalized_data').payload as readonly NormalizedOhlcv[];
  const quarantine = readIntegrityArtifact(paths.quarantinePath, 'quarantine').payload;
  const manifest = readIntegrityArtifact(paths.dataManifestPath, 'data_manifest').payload as DataManifestIntegrity;
  validateQuarantineRegistry(quarantine);
  validateDataManifest(manifest, rawRows, normalized, quarantine);
  return Object.freeze({ rawRows, normalized, manifest });
}