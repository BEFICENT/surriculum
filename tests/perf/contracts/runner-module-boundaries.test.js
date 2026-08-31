'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const aggregation = require('../lib/aggregation');
const diagnosticRunner = require('../lib/diagnostic-runner');
const powerValidation = require('../lib/power-validation');
const provenance = require('../lib/provenance');
const runnerConfiguration = require('../lib/runner-configuration');
const runner = require('../run');

const ROOT = path.resolve(__dirname, '..', '..', '..');

test('runner preserves its public helper exports across focused module boundaries', () => {
  for (const [moduleApi, names] of [
    [aggregation, [
      'aggregateBudgetResults', 'aggregateObserverMetrics', 'basicSummary', 'frameSummary',
    ]],
    [diagnosticRunner, ['classifyDiagnosticFailures']],
    [powerValidation, [
      'attachSystemSamplesToPhases', 'validateSampledPower',
    ]],
    [provenance, [
      'collectTargetHashes', 'collectWorkloadProvenance', 'commonJsDependencyGraph',
      'fingerprintRepositoryFiles', 'linkedFirstPartyAssets',
    ]],
    [runnerConfiguration, ['loadScenarios', 'parseArguments', 'selectScenarios']],
  ]) {
    for (const name of names) {
      assert.equal(typeof moduleApi[name], 'function', `${name} must be a direct module API`);
      assert.equal(runner[name], moduleApi[name], `${name} must remain a runner re-export`);
    }
  }
  assert.equal(typeof provenance.sha256, 'function');
  assert.equal(typeof diagnosticRunner.createDiagnosticRunner, 'function');
  assert.equal(typeof runnerConfiguration.helpText, 'function');
  assert.equal(runner.PROFILES, runnerConfiguration.PROFILES);
  assert.equal(runner.classifyDiagnosticFailures, diagnosticRunner.classifyDiagnosticFailures);
  assert.equal(typeof runner.runDiagnosticPass, 'function');
  assert.equal(typeof runner.runDiagnostics, 'function');
});

test('runner stays an orchestrator instead of absorbing extracted helper domains again', () => {
  const source = fs.readFileSync(path.join(ROOT, 'tests', 'perf', 'run.js'), 'utf8');
  assert.ok(source.split(/\r?\n/).length <= 850, 'tests/perf/run.js exceeded 850 lines');
  assert.match(source, /require\(['"]\.\/lib\/aggregation['"]\)/);
  assert.match(source, /require\(['"]\.\/lib\/diagnostic-runner['"]\)/);
  assert.match(source, /require\(['"]\.\/lib\/power-validation['"]\)/);
  assert.match(source, /require\(['"]\.\/lib\/provenance['"]\)/);
  assert.match(source, /require\(['"]\.\/lib\/runner-configuration['"]\)/);
  for (const moved of [
    'collectWorkloadProvenance',
    'collectTargetHashes',
    'validateSampledPower',
    'attachSystemSamplesToPhases',
    'frameSummary',
    'aggregateObserverMetrics',
    'parseArguments',
    'loadScenarios',
    'selectScenarios',
    'runDiagnosticPass',
    'runDiagnostics',
  ]) {
    assert.doesNotMatch(source, new RegExp(`function\\s+${moved}\\s*\\(`));
  }
});

test('workload provenance follows the extracted runner helpers transitively', () => {
  const evidence = provenance.collectWorkloadProvenance({ id: 'scheduler' }, ROOT);
  for (const relative of [
    'tests/perf/lib/aggregation.js',
    'tests/perf/lib/diagnostic-runner.js',
    'tests/perf/lib/power-validation.js',
    'tests/perf/lib/provenance.js',
    'tests/perf/lib/runner-configuration.js',
  ]) {
    assert.ok(evidence.files[relative], `${relative} must contribute to workload identity`);
  }
});

test('diagnostic runner exposes a frozen injected pipeline', () => {
  assert.throws(
    () => diagnosticRunner.createDiagnosticRunner({}),
    /requires effectiveServiceWorkerMode/,
  );
  const noop = async () => {};
  const api = diagnosticRunner.createDiagnosticRunner({
    effectiveServiceWorkerMode: () => 'block',
    navigateForScenario: noop,
    runnerSetupOptions: (_scenario, options) => options,
    warmBrowserState: noop,
  });
  assert.equal(Object.isFrozen(api), true);
  assert.equal(typeof api.runDiagnosticPass, 'function');
  assert.equal(typeof api.runDiagnostics, 'function');
});
