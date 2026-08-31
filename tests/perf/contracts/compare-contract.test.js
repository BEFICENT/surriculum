'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { compareRuns, parseArguments } = require('../compare');
const { patternRegex } = require('../lib/budgets');

const config = {
  requireSameEnvironment: true,
  defaultMode: 'advisory',
  comparisonRules: [
    {
      id: 'duration',
      path: 'metrics.timings.*',
      comparator: 'regression',
      direction: 'increase',
      relativeThreshold: 0.15,
      absoluteThreshold: 50,
      severity: 'gate',
    },
    {
      id: 'frames',
      path: 'metrics.phases.*.frames.p95',
      aggregate: 'max',
      comparator: 'regression',
      direction: 'increase',
      relativeThreshold: 0.2,
      absoluteThreshold: 16,
      severity: 'gate',
    },
  ],
};

test('production action-duration rule reaches nested scenario timings', () => {
  const production = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'budgets.json'),
    'utf8',
  ));
  const rule = production.comparisonRules.find((entry) => (
    entry.id === 'action-duration-regression'
  ));
  assert.ok(rule, 'the production action-duration comparison rule is missing');
  assert.equal(rule.path, 'metrics.timings.**');

  const matcher = patternRegex(rule.path);
  assert.equal(matcher.test('metrics.timings.scheduler.search-and-filter-stress'), true);
  assert.equal(matcher.test('metrics.timings.startup.load-and-settle'), true);
  assert.equal(matcher.test('metrics.phases.scheduler.frames.p95'), false);
});

function record(value, iteration, environmentKey = 'same-machine-and-power') {
  return {
    status: 'passed',
    runId: 'run',
    scenarioId: 'scheduler',
    iteration,
    environmentKey,
    target: { id: 'local-artifact' },
    browser: { id: 'chromium', viewport: { width: 1440, height: 900 } },
    fixtureId: 'dense',
    metadata: {
      viewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
      powerSource: 'ac',
      workloadHash: 'workload-v1',
    },
    metrics: {
      timings: { interaction: value },
      phases: [
        { name: 'scroll', frames: { p95: value / 4, samples: [10, 20] } },
        { name: 'hover', frames: { p95: value / 5, samples: [10, 20] } },
      ],
    },
  };
}

test('comparison rules use matched environment-group medians and deterministic bootstrap CIs', () => {
  const baseline = [100, 101, 99, 102, 98].map((value, index) => record(value, index));
  const candidate = [170, 171, 169, 172, 168].map((value, index) => record(value, index));
  const options = { config, mode: 'enforce', bootstrapIterations: 250 };
  const first = compareRuns(baseline, candidate, options);
  const second = compareRuns(baseline, candidate, options);

  assert.equal(first.comparableGroups, 1);
  assert.equal(first.budgetSummary.total, 2);
  assert.equal(first.budgetSummary.regressed, 2);
  assert.equal(first.budgetSummary.blocking, 2);
  assert.equal(first.passed, false);
  assert.deepEqual(first.budgetComparisons, second.budgetComparisons);

  const duration = first.budgetComparisons.find((item) => item.ruleId === 'duration');
  assert.equal(duration.baselineMedian, 100);
  assert.equal(duration.candidateMedian, 170);
  assert.equal(duration.absoluteChange, 70);
  assert.equal(duration.relativeChange, 0.7);
  assert.equal(duration.thresholdCrossings.absolute, true);
  assert.equal(duration.thresholdCrossings.relative, true);
  assert.equal(duration.bootstrap95CI.iterations, 250);
  assert.ok(duration.bootstrap95CI.absoluteChange.lower <= duration.absoluteChange);
  assert.ok(duration.bootstrap95CI.absoluteChange.upper >= duration.absoluteChange);

  const frames = first.budgetComparisons.find((item) => item.ruleId === 'frames');
  assert.equal(frames.aggregate, 'max');
  assert.deepEqual(frames.matchedMetrics, [
    'metrics.phases.hover.frames.p95',
    'metrics.phases.scroll.frames.p95',
  ]);
});

test('a rule is advisory unless enforce mode is selected and must cross both thresholds', () => {
  const baseline = [100, 100, 100].map((value, index) => record(value, index));
  const relativeOnly = [130, 130, 130].map((value, index) => record(value, index));
  const advisoryRegression = [170, 170, 170].map((value, index) => record(value, index));

  const belowAbsolute = compareRuns(baseline, relativeOnly, { config, mode: 'enforce', bootstrap: 50 });
  assert.equal(belowAbsolute.budgetComparisons.find((item) => item.ruleId === 'duration').status, 'passed');
  assert.equal(belowAbsolute.passed, true);

  const advisory = compareRuns(baseline, advisoryRegression, { config, mode: 'advisory', bootstrap: 50 });
  assert.ok(advisory.budgetSummary.regressed > 0);
  assert.equal(advisory.budgetSummary.blocking, 0);
  assert.equal(advisory.passed, true);
});

test('different or missing environments are never compared', () => {
  const baseline = [record(100, 0, 'environment-a'), record(100, 1, null)];
  const candidate = [record(200, 0, 'environment-b'), record(200, 1, null)];
  const result = compareRuns(baseline, candidate, { config, mode: 'enforce', bootstrap: 25 });

  assert.equal(result.comparable, false);
  assert.equal(result.comparisons.length, 0);
  assert.equal(result.budgetComparisons.length, 0);
  assert.equal(result.passed, false);
  assert.equal(result.comparisonUnavailable, true);
  assert.equal(result.environmentSafety.excludedBaselineIterations.length, 1);
  assert.equal(result.environmentSafety.excludedCandidateIterations.length, 1);
});

test('different workload fingerprints never share a comparison group', () => {
  const baseline = [record(100, 0)];
  const candidate = [record(110, 0)];
  candidate[0].metadata.workloadHash = 'workload-v2';

  const result = compareRuns(baseline, candidate, {
    config,
    mode: 'advisory',
    bootstrap: 25,
  });

  assert.equal(result.comparable, false);
  assert.equal(result.comparisons.length, 0);
  assert.equal(result.comparisonUnavailable, true);
  assert.equal(result.passed, false);
  assert.equal(result.workloadSafety.mismatchedScenarios.length, 1);
  assert.match(result.warnings.join('\n'), /workload fingerprints differ/);
});

test('missing workload provenance fails closed even in advisory mode', () => {
  const baseline = [record(100, 0)];
  const candidate = [record(110, 0)];
  delete baseline[0].metadata.workloadHash;
  delete candidate[0].metadata.workloadHash;

  const result = compareRuns(baseline, candidate, {
    config,
    mode: 'advisory',
    bootstrap: 25,
  });

  assert.equal(result.comparable, false);
  assert.equal(result.comparisonUnavailable, true);
  assert.equal(result.passed, false);
  assert.equal(result.workloadSafety.requireWorkloadProvenance, true);
  assert.equal(result.workloadSafety.excludedBaselineIterations.length, 1);
  assert.equal(result.workloadSafety.excludedCandidateIterations.length, 1);
  assert.match(result.warnings.join('\n'), /without workload provenance/);

  baseline[0].environmentKey = null;
  const missingBoth = compareRuns(baseline, candidate, {
    config,
    mode: 'advisory',
    bootstrap: 25,
  });
  assert.equal(missingBoth.comparisonUnavailable, true);
  assert.equal(
    missingBoth.workloadSafety.excludedBaselineIterations[0].reason,
    'missing workloadHash',
  );
});

test('legacy provenance override is explicit, comparable, and visibly warned', () => {
  const baseline = [record(100, 0)];
  const candidate = [record(110, 0)];
  delete baseline[0].metadata.workloadHash;

  const result = compareRuns(baseline, candidate, {
    config,
    mode: 'advisory',
    bootstrap: 25,
    allowMissingWorkloadProvenance: true,
  });

  assert.equal(result.comparable, true);
  assert.equal(result.comparisonUnavailable, false);
  assert.equal(result.workloadSafety.requireWorkloadProvenance, false);
  assert.equal(result.workloadSafety.legacyOverrideEnabled, true);
  assert.match(result.warnings.join('\n'), /LEGACY WORKLOAD-PROVENANCE OVERRIDE ENABLED/);
  assert.match(result.warnings.join('\n'), /historical\/advisory/);
  assert.equal(parseArguments([
    '--base', 'old.json',
    '--candidate', 'new.json',
    '--allow-missing-workload-provenance',
  ]).allowMissingWorkloadProvenance, true);

  const attemptedGate = compareRuns(baseline, candidate, {
    config,
    mode: 'enforce',
    bootstrap: 25,
    allowMissingWorkloadProvenance: true,
  });
  assert.equal(attemptedGate.comparisonUnavailable, true);
  assert.equal(attemptedGate.passed, false);
  assert.equal(attemptedGate.workloadSafety.enforceable, false);
  assert.match(attemptedGate.warnings.join('\n'), /cannot produce an enforceable comparison/);
});

test('power axis compares AC and battery only when captured hardware identity matches', () => {
  const environment = (source, percent) => ({
    host: {
      platform: 'win32',
      osRelease: '10.0.1',
      cpuModel: 'Example CPU',
      physicalCores: 4,
      logicalProcessors: 8,
    },
    browser: {
      version: { product: 'Chrome/140' },
      gpu: {
        gpu: { devices: [{ vendorId: 1, deviceId: 2 }] },
        mode: 'hardware',
        classification: { renderer: 'ANGLE (Example GPU, D3D11)' },
      },
      navigator: { viewport: { width: 1440, height: 900 } },
    },
    power: {
      source,
      activeScheme: { guid: 'balanced' },
      gpus: [{ name: 'Example GPU' }],
      batteries: [{ estimatedChargeRemaining: percent }],
      batteryStatus: [{
        powerOnline: source === 'ac',
        charging: source === 'ac',
        discharging: source === 'battery',
      }],
    },
    display: { refreshRateHz: 60 },
  });
  const baseline = [record(100, 0, 'ac-environment')];
  const candidate = [record(170, 0, 'battery-environment')];
  baseline[0].environment = environment('ac', 84);
  candidate[0].environment = environment('battery', 61);
  candidate[0].metadata.powerSource = 'battery';
  baseline[0].metadata.powerBefore = {
    source: 'ac',
    activeScheme: { guid: 'balanced' },
    gpus: [{ name: 'Example GPU' }],
    batteries: [{ estimatedChargeRemaining: 85 }],
    batteryStatus: [{ powerOnline: true, charging: true, discharging: false }],
  };
  candidate[0].metadata.powerBefore = {
    source: 'battery',
    activeScheme: { guid: 'balanced' },
    gpus: [{ name: 'Example GPU' }],
    batteries: [{ estimatedChargeRemaining: 62 }],
    batteryStatus: [{ powerOnline: false, charging: false, discharging: true }],
  };
  baseline[0].metadata.powerAfter = {
    source: 'ac',
    batteries: [{ estimatedChargeRemaining: 83 }],
    batteryStatus: [{ powerOnline: true, charging: true, discharging: false }],
  };
  candidate[0].metadata.powerAfter = {
    source: 'battery',
    batteries: [{ estimatedChargeRemaining: 59 }],
    batteryStatus: [{ powerOnline: false, charging: false, discharging: true }],
  };
  baseline[0].metadata.powerValidation = {
    valid: true,
    before: 'ac',
    after: 'ac',
    sampled: {
      sourceValid: true,
      samplingAvailable: true,
      observedSources: ['ac'],
    },
  };
  candidate[0].metadata.powerValidation = {
    valid: true,
    before: 'battery',
    after: 'battery',
    sampled: {
      sourceValid: true,
      samplingAvailable: true,
      observedSources: ['battery'],
    },
  };

  const strict = compareRuns(baseline, candidate, { config, mode: 'advisory', bootstrap: 25 });
  assert.equal(strict.comparable, false);

  const powerAxis = compareRuns(baseline, candidate, {
    config,
    mode: 'advisory',
    bootstrap: 25,
    axis: 'power',
  });
  assert.equal(powerAxis.comparable, true);
  assert.equal(powerAxis.environmentSafety.axis, 'power');
  assert.equal(powerAxis.budgetComparisons.find((item) => item.ruleId === 'duration').status, 'failed');
  assert.equal(powerAxis.matchedEnvironmentSummaries.length, 1);
  const summary = powerAxis.matchedEnvironmentSummaries[0];
  assert.deepEqual(summary.baseline.cpu, {
    model: 'Example CPU',
    physicalCores: 4,
    logicalProcessors: 8,
  });
  assert.equal(summary.baseline.gpu.names[0], 'Example GPU');
  assert.equal(summary.baseline.browser.version, 'Chrome/140');
  assert.equal(summary.baseline.power.source, 'ac');
  assert.deepEqual(summary.baseline.power.startBatteryPercent, { min: 85, median: 85, max: 85 });
  assert.deepEqual(summary.baseline.power.batteryPercent, { min: 83, median: 83, max: 83 });
  assert.equal(summary.candidate.power.source, 'battery');
  assert.deepEqual(summary.candidate.power.startBatteryPercent, { min: 62, median: 62, max: 62 });
  assert.deepEqual(summary.candidate.power.batteryPercent, { min: 59, median: 59, max: 59 });

  const sameSourceCandidate = JSON.parse(JSON.stringify(candidate));
  sameSourceCandidate[0].metadata.powerSource = 'ac';
  sameSourceCandidate[0].environment.power.source = 'ac';
  sameSourceCandidate[0].metadata.powerBefore.source = 'ac';
  sameSourceCandidate[0].metadata.powerAfter.source = 'ac';
  sameSourceCandidate[0].metadata.powerValidation.before = 'ac';
  sameSourceCandidate[0].metadata.powerValidation.after = 'ac';
  sameSourceCandidate[0].metadata.powerValidation.sampled.observedSources = ['ac'];
  const sameSource = compareRuns(baseline, sameSourceCandidate, {
    config,
    mode: 'advisory',
    bootstrap: 25,
    axis: 'power',
  });
  assert.equal(sameSource.comparable, false);
  assert.equal(sameSource.environmentSafety.rejectedPowerAxisGroups.length, 1);

  const unstableCandidate = JSON.parse(JSON.stringify(candidate));
  unstableCandidate[0].metadata.powerAfter.source = 'ac';
  unstableCandidate[0].metadata.powerValidation.valid = false;
  unstableCandidate[0].metadata.powerValidation.after = 'ac';
  unstableCandidate[0].metadata.powerValidation.sampled.observedSources = ['battery', 'ac'];
  const unstable = compareRuns(baseline, unstableCandidate, {
    config,
    mode: 'advisory',
    bootstrap: 25,
    axis: 'power',
  });
  assert.equal(unstable.comparable, false);
  assert.equal(unstable.environmentSafety.invalidPowerAxisCandidateIterations.length, 1);

  const softwareCandidate = JSON.parse(JSON.stringify(candidate));
  softwareCandidate[0].environment.browser.gpu.mode = 'software';
  const gpuMismatch = compareRuns(baseline, softwareCandidate, {
    config,
    mode: 'advisory',
    bootstrap: 25,
    axis: 'power',
  });
  assert.equal(gpuMismatch.comparable, false);
  assert.equal(gpuMismatch.environmentSafety.rejectedPowerAxisGroups.length, 0);

  const rendererCandidate = JSON.parse(JSON.stringify(candidate));
  rendererCandidate[0].environment.browser.gpu.classification.renderer = 'ANGLE (Different GPU, D3D11)';
  const rendererMismatch = compareRuns(baseline, rendererCandidate, {
    config,
    mode: 'advisory',
    bootstrap: 25,
    axis: 'power',
  });
  assert.equal(rendererMismatch.comparable, false);

  const incompleteCandidate = JSON.parse(JSON.stringify(candidate));
  delete incompleteCandidate[0].environment.browser.gpu.classification.renderer;
  const incompleteIdentity = compareRuns(baseline, incompleteCandidate, {
    config,
    mode: 'advisory',
    bootstrap: 25,
    axis: 'power',
  });
  assert.equal(incompleteIdentity.comparable, false);
  assert.equal(incompleteIdentity.environmentSafety.powerAxisFallbackCandidateIterations.length, 1);
});

test('enforce mode fails closed when matching groups evaluate no comparison rules', () => {
  const noMatchingMetrics = {
    ...config,
    comparisonRules: [{
      id: 'missing-metric',
      path: 'metrics.doesNotExist.*',
      comparator: 'regression',
      direction: 'increase',
      relativeThreshold: 0.1,
      severity: 'gate',
    }],
  };
  const result = compareRuns(
    [record(100, 0)],
    [record(110, 0)],
    { config: noMatchingMetrics, mode: 'enforce', bootstrap: 25 },
  );

  assert.equal(result.comparable, true);
  assert.equal(result.comparableGroups, 1);
  assert.equal(result.budgetComparisons.length, 0);
  assert.equal(result.comparisonRuleEvaluation.unavailable, true);
  assert.equal(result.comparisonUnavailable, true);
  assert.equal(result.passed, false);
});

test('zero baselines cross relative thresholds in the regression direction only', () => {
  const relativeOnly = {
    ...config,
    comparisonRules: [{
      id: 'zero-relative',
      path: 'metrics.timings.interaction',
      comparator: 'regression',
      direction: 'increase',
      relativeThreshold: 0.1,
      severity: 'gate',
    }],
  };
  const regression = compareRuns(
    [record(0, 0)],
    [record(1, 0)],
    { config: relativeOnly, mode: 'enforce', bootstrap: 25 },
  ).budgetComparisons[0];
  const improvement = compareRuns(
    [record(0, 0)],
    [record(-1, 0)],
    { config: relativeOnly, mode: 'enforce', bootstrap: 25 },
  ).budgetComparisons[0];

  assert.equal(regression.relativeChange, Infinity);
  assert.equal(regression.thresholdCrossings.relative, true);
  assert.equal(regression.status, 'failed');
  assert.equal(improvement.relativeChange, -Infinity);
  assert.equal(improvement.thresholdCrossings.relative, false);
  assert.equal(improvement.status, 'passed');

  relativeOnly.comparisonRules[0].direction = 'decrease';
  const reversedRegression = compareRuns(
    [record(0, 0)],
    [record(-1, 0)],
    { config: relativeOnly, mode: 'enforce', bootstrap: 25 },
  ).budgetComparisons[0];
  const reversedImprovement = compareRuns(
    [record(0, 0)],
    [record(1, 0)],
    { config: relativeOnly, mode: 'enforce', bootstrap: 25 },
  ).budgetComparisons[0];
  assert.equal(reversedRegression.thresholdCrossings.relative, true);
  assert.equal(reversedRegression.status, 'failed');
  assert.equal(reversedImprovement.thresholdCrossings.relative, false);
  assert.equal(reversedImprovement.status, 'passed');
});

test('CLI writes output and exits nonzero only for an enforced threshold regression', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'surriculum-perf-compare-'));
  const baselinePath = path.join(directory, 'baseline.json');
  const candidatePath = path.join(directory, 'candidate.json');
  const outputPath = path.join(directory, 'nested', 'comparison.json');
  const legacyOutputPath = path.join(directory, 'nested', 'legacy-comparison.json');
  const baseline = [100, 100, 100].map((value, index) => record(value, index));
  const candidate = [170, 170, 170].map((value, index) => record(value, index));
  fs.writeFileSync(baselinePath, JSON.stringify(baseline));
  fs.writeFileSync(candidatePath, JSON.stringify(candidate));

  try {
    const script = path.resolve(__dirname, '..', 'compare.js');
    const run = spawnSync(process.execPath, [
      script,
      '--base', baselinePath,
      '--candidate', candidatePath,
      '--mode', 'enforce',
      '--bootstrap', '25',
      '--out', outputPath,
    ], { encoding: 'utf8' });
    assert.equal(run.status, 1, run.stderr);
    const output = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    assert.equal(output.mode, 'enforce');
    assert.equal(output.passed, false);

    const legacyRun = spawnSync(process.execPath, [
      script,
      '--base', baselinePath,
      '--candidate', candidatePath,
      '--mode', 'advisory',
      '--allow-missing-workload-provenance',
      '--out', legacyOutputPath,
    ], { encoding: 'utf8' });
    assert.equal(legacyRun.status, 0, legacyRun.stderr);
    assert.match(legacyRun.stderr, /WARNING: legacy workload-provenance override enabled/);
    const legacyOutput = JSON.parse(fs.readFileSync(legacyOutputPath, 'utf8'));
    assert.equal(legacyOutput.workloadSafety.legacyOverrideEnabled, true);
    assert.match(legacyOutput.warnings.join('\n'), /historical\/advisory/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
