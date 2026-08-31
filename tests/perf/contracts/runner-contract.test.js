'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { ArtifactStore } = require('../lib/artifacts');
const { comparisonKey } = require('../lib/schema');
const { startServer } = require('../lib/server');
const { resolveTarget } = require('../lib/targets');
const {
  attachSystemSamplesToPhases,
  classifyDiagnosticFailures,
  effectiveServiceWorkerMode,
  frameSummary,
  parseArguments,
  validateSampledPower,
} = require('../run');

test('runner refuses empty scenario and target selections', () => {
  assert.throws(
    () => parseArguments(['--profile', 'ci-smoke', '--scenario=']),
    /at least one performance scenario/,
  );
  assert.throws(
    () => parseArguments(['--profile', 'ci-smoke', '--targets=']),
    /at least one performance target/,
  );
});

test('diagnostic completion fails on unexpected browser errors but permits scoped offline failures', () => {
  const offline = {
    method: 'GET',
    url: 'https://example.test/surriculum/data.json',
    error: 'net::ERR_INTERNET_DISCONNECTED',
  };
  const snapshot = {
    console: [
      {
        type: 'error',
        text: 'Failed to load resource: net::ERR_INTERNET_DISCONNECTED',
        location: { url: offline.url },
      },
      { type: 'error', text: 'unexpected', location: { url: 'https://example.test/surriculum/' } },
    ],
    pageErrors: [{ message: 'boom' }],
    requestFailures: [offline, { ...offline, url: 'https://example.test/surriculum/other.json' }],
    badResponses: [{ url: 'https://third-party.test/missing', status: 500 }],
  };
  const failures = classifyDiagnosticFailures(snapshot, {
    metadata: { offlineFailures: { failures: [offline] } },
  }, { url: 'https://example.test/surriculum/' });
  assert.equal(failures.consoleErrors.length, 1);
  assert.equal(failures.pageErrors.length, 1);
  assert.equal(failures.requestFailures.length, 1);
  assert.equal(failures.badResponses.length, 0);
  assert.equal(failures.count, 3);
});

test('runner fixes the academic date and keeps service-worker journeys enabled', () => {
  const options = parseArguments(['--profile', 'nightly']);
  assert.equal(options.academicDate, '2026-08-29T09:00:00.000Z');
  assert.equal(options.diagnose, true);
  assert.equal(parseArguments(['--profile', 'nightly', '--no-diagnose']).diagnose, false);
  assert.ok(options.scenarios.includes('transcript'));
  assert.equal(
    effectiveServiceWorkerMode({ id: 'service-worker' }, options),
    'allow',
  );
  assert.equal(
    effectiveServiceWorkerMode({ id: 'planner' }, { ...options, cache: 'offline-warm' }),
    'allow',
  );
});

test('in-iteration power samples catch a transient source change and battery-floor crossing', () => {
  const validation = validateSampledPower({
    samples: [
      { source: 'ac', battery: { chargePercent: 55 } },
      { source: 'battery', battery: { chargePercent: 29 } },
      { source: 'ac', battery: { chargePercent: 54 } },
    ],
  }, { supported: true, source: 'ac' }, { power: 'ac', minBattery: 30 });
  assert.equal(validation.sourceValid, false);
  assert.match(validation.errors.join(' '), /battery/);

  const battery = validateSampledPower({
    samples: [{ source: 'battery', battery: { chargePercent: 29 } }],
  }, { supported: true, source: 'battery' }, { power: 'battery', minBattery: 30 });
  assert.equal(battery.sourceValid, true);
  assert.equal(battery.batteryValid, false);

  const missing = validateSampledPower({
    samples: [],
    errors: ['sampler did not start'],
  }, { supported: true, source: 'ac' }, { power: 'ac', minBattery: 30 });
  assert.equal(missing.samplingRequired, true);
  assert.equal(missing.samplingAvailable, false);
  assert.equal(missing.sourceValid, false);
  assert.equal(missing.valid, false);
  assert.deepEqual(missing.samplerErrors, ['sampler did not start']);
  assert.match(missing.errors.join(' '), /no in-iteration Windows power samples/);

  const unrequested = validateSampledPower({ samples: [] }, {
    supported: true,
    source: 'ac',
  }, { power: null, minBattery: 30 });
  assert.equal(unrequested.samplingRequired, false);
  assert.equal(unrequested.valid, true);
});

test('system samples are summarized inside their matching phase window', () => {
  const phases = [{
    name: 'scheduler.scroll',
    startedAtUtc: '2026-08-29T09:00:00.000Z',
    endedAtUtc: '2026-08-29T09:00:01.000Z',
  }];
  attachSystemSamplesToPhases(phases, {
    samples: [
      {
        capturedAt: '2026-08-29T09:00:00.250Z', source: 'battery',
        browserProcesses: { cumulativeCpuSeconds: 2, workingSetBytes: 100, privateMemoryBytes: 80 },
        battery: { chargePercent: 70 },
      },
      {
        capturedAt: '2026-08-29T09:00:00.750Z', source: 'battery',
        browserProcesses: { cumulativeCpuSeconds: 2.3, workingSetBytes: 120, privateMemoryBytes: 90 },
        battery: { chargePercent: 69 },
      },
    ],
    portableSamples: [
      { capturedAt: '2026-08-29T09:00:00.500Z', cpu: { loadPercent: 40, currentClockMHz: 3000 } },
    ],
    cdpSamples: [],
  });
  assert.equal(phases[0].system.sampleCounts.windows, 2);
  assert.equal(phases[0].system.browserCpuSecondsDelta, 0.3);
  assert.deepEqual(phases[0].system.powerSources, ['battery']);
  assert.equal(phases[0].system.batteryPercent.min, 69);
});

test('navigation frame samples are unavailable instead of reporting false zero-jank data', () => {
  const result = frameSummary([], 16.67, 'document-navigation-reset-request-animation-frame-sampling');
  assert.equal(result.available, false);
  assert.equal(result.over50Share, null);
  assert.match(result.unavailableReason, /navigation/);
});

test('frame summaries discard every non-finite or negative delta', () => {
  const result = frameSummary([-12, Number.NaN, Number.POSITIVE_INFINITY, 0, 16, 32], 16);
  assert.equal(result.available, true);
  assert.equal(result.count, 3);
  assert.equal(result.min, 0);
  assert.equal(result.max, 32);
  assert.ok(result.min >= 0);
});

test('comparison identity separates cache, service-worker, throttle, and browser presentation modes', () => {
  const base = {
    scenarioId: 'scheduler',
    environmentKey: 'environment',
    target: { id: 'local-artifact' },
    browser: { id: 'chromium', headless: true },
    fixtureId: 'scheduler-heavy',
    metadata: {
      fixtureHash: 'fixture',
      workloadHash: 'workload',
      viewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
      powerSource: 'ac',
      cache: 'cold',
      serviceWorkers: 'block',
      cpuThrottle: 4,
    },
  };
  const key = comparisonKey(base);
  for (const mutation of [
    { metadata: { cache: 'warm' } },
    { metadata: { serviceWorkers: 'allow' } },
    { metadata: { cpuThrottle: 1 } },
    { metadata: { workloadHash: 'different-workload' } },
    { browser: { headless: false } },
  ]) {
    assert.notEqual(comparisonKey({
      ...base,
      browser: { ...base.browser, ...(mutation.browser || {}) },
      metadata: { ...base.metadata, ...(mutation.metadata || {}) },
    }), key);
  }
});

test('custom URL targets receive collision-resistant ids', () => {
  const first = resolveTarget('https://example.test/a');
  const second = resolveTarget('https://example.test/b');
  assert.notEqual(first.id, second.id);
  assert.match(first.id, /^url-example\.test-[a-f0-9]{8}$/);
  assert.equal(resolveTarget('local-source').mount, '/surriculum/');
});

test('artifact runs refuse to append into an existing non-empty run directory', () => {
  const baseDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'surriculum-perf-artifacts-'));
  try {
    new ArtifactStore({ baseDirectory, runId: 'same-run' }).initialize({ schemaVersion: 1 });
    assert.throws(
      () => new ArtifactStore({ baseDirectory, runId: 'same-run' }).initialize(),
      /already exists and is not empty/,
    );
    assert.doesNotThrow(() => new ArtifactStore({
      baseDirectory,
      runId: 'same-run',
      allowExisting: true,
    }).initialize());
  } finally {
    fs.rmSync(baseDirectory, { recursive: true, force: true });
  }
});

test('local performance server provides a genuinely reusable HTTP cache response', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surriculum-perf-server-'));
  let server;
  try {
    fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>cache</title>');
    server = await startServer({ root, mount: '/surriculum/' });
    const first = await fetch(server.url);
    assert.equal(first.status, 200);
    assert.match(first.headers.get('cache-control') || '', /max-age=[1-9]/);
    const etag = first.headers.get('etag');
    assert.ok(etag);
    const second = await fetch(server.url, { headers: { 'If-None-Match': etag } });
    assert.equal(second.status, 304);
  } finally {
    if (server) await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
