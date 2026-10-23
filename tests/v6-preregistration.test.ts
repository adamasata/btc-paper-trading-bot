import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  V6_ADVERSE_FILL_STRESS_BPS,
  V6_ALLOCATION_FRACTION,
  V6_ASSESSMENT_MINUTES,
  V6_CANDIDATE_REGISTRY,
  V6_ENTRY_CUTOFF_UTC_HOUR,
  V6_EXIT_CHECK_MINUTES,
  V6_FEE_RATE,
  V6_MAX_ENTRIES_PER_UTC_DAY,
  V6_MAX_HOLD_MINUTES,
} from '../src/research/v6/strategy';

type PreregistrationArtifact = {
  schemaVersion: number;
  status: string;
  sourceSpec: { path: string; name: string; sha256: string };
  candidates: readonly { id: string; anchorVolumeMultiplier: number; allocationFraction: number }[];
  mechanics: {
    assessmentMinutes: number;
    entryCutoffUtcHour: number;
    exitCheckMinutes: number;
    maxHoldMinutes: number;
    maxEntriesPerUtcDay: number;
    execution: string;
    costs: { feeRatePerFill: number; adverseFillStressBps: readonly number[] };
  };
};

const SOURCE_SPEC_SHA256 = '363d0154e990968dcac62f4b9a7ca65ca3a377bb950181842c704ecb57b35c45';

test('v6 preregistration artifact is outcome-free and matches the frozen registry and mechanics', () => {
  const path = join(process.cwd(), 'research', 'preregistration-v6.json');
  const artifact = JSON.parse(readFileSync(path, 'utf8')) as PreregistrationArtifact;

  assert.equal(artifact.schemaVersion, 1);
  assert.equal(artifact.status, 'shadow/unvalidated');
  assert.deepEqual(artifact.candidates, V6_CANDIDATE_REGISTRY);
  assert.deepEqual(artifact.candidates.map((candidate) => candidate.anchorVolumeMultiplier), [3, 5, 8]);
  assert.ok(artifact.candidates.every((candidate) => candidate.allocationFraction === V6_ALLOCATION_FRACTION));
  assert.equal(artifact.mechanics.assessmentMinutes, V6_ASSESSMENT_MINUTES);
  assert.equal(artifact.mechanics.entryCutoffUtcHour, V6_ENTRY_CUTOFF_UTC_HOUR);
  assert.equal(artifact.mechanics.exitCheckMinutes, V6_EXIT_CHECK_MINUTES);
  assert.equal(artifact.mechanics.maxHoldMinutes, V6_MAX_HOLD_MINUTES);
  assert.equal(artifact.mechanics.maxEntriesPerUtcDay, V6_MAX_ENTRIES_PER_UTC_DAY);
  assert.equal(artifact.mechanics.execution, 'completed-bar decision; next-minute-open fill');
  assert.equal(artifact.mechanics.costs.feeRatePerFill, V6_FEE_RATE);
  assert.deepEqual(artifact.mechanics.costs.adverseFillStressBps, V6_ADVERSE_FILL_STRESS_BPS);
  assert.equal(artifact.sourceSpec.path, 'research/v6-stage1-family-spec.md');
  assert.equal(artifact.sourceSpec.name, 'v6-stage1-family-spec.md');
  assert.match(artifact.sourceSpec.sha256, /^[a-f0-9]{64}$/);
  assert.equal(artifact.sourceSpec.sha256, SOURCE_SPEC_SHA256);
  const sourceSpec = readFileSync(join(process.cwd(), artifact.sourceSpec.path));
  assert.equal(createHash('sha256').update(sourceSpec).digest('hex'), artifact.sourceSpec.sha256);
  assert.equal(Object.hasOwn(artifact, 'outcomes'), false);
});
