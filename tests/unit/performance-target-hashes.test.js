'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  collectTargetHashes,
  collectWorkloadProvenance,
  linkedFirstPartyAssets,
} = require('../perf/run');
const schedulerScenario = require('../perf/scenarios/scheduler');
const startupScenario = require('../perf/scenarios/startup');

const ROOT = path.resolve(__dirname, '../..');

test('performance manifests fingerprint every linked first-party script and stylesheet', async () => {
  const indexSource = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const expectedAssets = linkedFirstPartyAssets(indexSource);
  assert.ok(expectedAssets.some((relative) => /\.js$/i.test(relative)));
  assert.ok(expectedAssets.some((relative) => /\.css$/i.test(relative)));

  const hashes = await collectTargetHashes({ root: ROOT });
  for (const relative of expectedAssets) {
    assert.ok(hashes[relative], `Missing runtime fingerprint for ${relative}`);
    assert.equal(hashes[relative].error, undefined, `Could not fingerprint ${relative}`);
    assert.match(hashes[relative].sha256, /^[a-f0-9]{64}$/);
    assert.ok(hashes[relative].bytes > 0, `${relative} should not be empty`);
  }
});

test('Scheduler target provenance includes every declared fixture and dataset input', async () => {
  assert.ok(Array.isArray(schedulerScenario.targetAssets));
  assert.ok(schedulerScenario.targetAssets.length > 0);
  const hashes = await collectTargetHashes(
    { root: ROOT },
    { additionalFiles: schedulerScenario.targetAssets },
  );
  for (const relative of schedulerScenario.targetAssets) {
    assert.ok(hashes[relative], `Missing Scheduler input fingerprint for ${relative}`);
    assert.equal(hashes[relative].error, undefined, `Could not fingerprint ${relative}`);
    assert.match(hashes[relative].sha256, /^[a-f0-9]{64}$/);
    assert.ok(hashes[relative].bytes > 0, `${relative} should not be empty`);
  }
});

test('workload provenance covers runner, selected scenario, helpers, fixtures, and samplers', () => {
  const first = collectWorkloadProvenance(schedulerScenario, ROOT);
  const second = collectWorkloadProvenance(schedulerScenario, ROOT);
  assert.equal(first.schemaVersion, 1);
  assert.match(first.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(second, first);

  for (const relative of [
    'tests/perf/run.js',
    'tests/perf/scenarios/scheduler.js',
    'tests/perf/scenarios/_shared.js',
    'tests/perf/fixtures/plans.js',
    'tests/e2e/helpers/passing-plan.js',
    'tests/perf/lib/observers.js',
    'tests/perf/lib/windows-power.ps1',
    'tests/perf/lib/windows-sampler.ps1',
    'package-lock.json',
  ]) {
    assert.ok(first.files[relative], `Missing workload source fingerprint for ${relative}`);
    assert.match(first.files[relative].sha256, /^[a-f0-9]{64}$/);
    assert.ok(first.files[relative].bytes > 0, `${relative} should not be empty`);
  }

  const startup = collectWorkloadProvenance(startupScenario, ROOT);
  assert.notEqual(startup.sha256, first.sha256);
  assert.ok(startup.files['tests/perf/scenarios/startup.js']);
  assert.equal(startup.files['tests/perf/scenarios/scheduler.js'], undefined);
});
