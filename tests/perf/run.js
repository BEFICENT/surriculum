#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const { ArtifactStore } = require('./lib/artifacts');
const {
  aggregateBudgetResults,
  aggregateObserverMetrics,
  basicSummary,
  frameSummary,
} = require('./lib/aggregation');
const { launchBrowser } = require('./lib/browser');
const { evaluateBudgets, loadBudgets } = require('./lib/budgets');
const { createCdpInput } = require('./lib/cdp-input');
const {
  classifyDiagnosticFailures,
  createDiagnosticRunner,
} = require('./lib/diagnostic-runner');
const {
  captureMetrics,
  createNetworkCollector,
  createPageDiagnostics,
  enablePerformance,
  metricDelta,
  readCdpPerformance,
} = require('./lib/metrics');
const {
  beginFrameSampling,
  endFrameSampling,
  installObservers,
  readObservers,
  resetObservers,
} = require('./lib/observers');
const {
  attachSystemSamplesToPhases,
  validateIterationPower,
  validateSampledPower,
  waitForRequestedPower,
} = require('./lib/power-validation');
const {
  collectTargetHashes,
  collectWorkloadProvenance,
  commonJsDependencyGraph,
  fingerprintRepositoryFiles,
  linkedFirstPartyAssets,
  sha256,
} = require('./lib/provenance');
const {
  PROFILES,
  helpText,
  loadScenarios,
  parseArguments,
  selectScenarios,
} = require('./lib/runner-configuration');
const { round } = require('./lib/stats');
const {
  collectEnvironment,
  createSystemSampler,
  readWindowsPowerTelemetry,
  validatePowerState,
} = require('./lib/system-info');
const { startTarget } = require('./lib/targets');
const { waitForServiceWorkerReady } = require('./lib/service-worker');
const fixtures = require('./fixtures');
const { writeReports } = require('./report');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PERFORMANCE_BUDGETS = loadBudgets();

function effectiveServiceWorkerMode(scenario, options) {
  if (scenario.id === 'service-worker' || ['installing', 'offline-warm'].includes(options.cache)) {
    return 'allow';
  }
  return options.serviceWorkers;
}

function offlineFailureSignature(item) {
  return `${item?.method || 'GET'} ${item?.url || ''} ${item?.error || ''}`;
}

function recordedOfflineFailureSignatures(failures) {
  return new Set((failures || []).map(offlineFailureSignature));
}

async function warmBrowserState(page, target, options) {
  if (!['warm', 'offline-warm'].includes(options.cache)) return;
  await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: options.navigationTimeout });
  await page.waitForFunction(() => Boolean(window.planStorage && window.__surriculumReady), null, {
    timeout: options.navigationTimeout,
  });
  if (options.serviceWorkers === 'allow') {
    await waitForServiceWorkerReady(page, options.navigationTimeout);
  }
  await page.goto('about:blank');
  if (options.cache === 'offline-warm') await page.context().setOffline(true);
}

function runnerSetupOptions(scenario, options) {
  return {
    ...options,
    // This journey owns its online fixture warmup and precisely scoped
    // offline phase. Generic setup must not take it offline first.
    cache: scenario.id === 'service-worker' && options.cache === 'offline-warm'
      ? 'cold' : options.cache,
  };
}

async function navigateForScenario(page, scenario, target, options) {
  if (scenario.id === 'startup') return;
  await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: options.navigationTimeout });
  await page.waitForFunction(() => Boolean(window.planStorage && window.planStorage.importPlanObject), null, {
    timeout: options.navigationTimeout,
  });
}

const {
  runDiagnosticPass,
  runDiagnostics,
} = createDiagnosticRunner({
  effectiveServiceWorkerMode,
  navigateForScenario,
  runnerSetupOptions,
  warmBrowserState,
});

async function runIteration({
  scenario,
  target,
  options,
  store,
  iteration,
  warmup,
  workloadProvenance = null,
}) {
  const effectiveServiceWorkers = effectiveServiceWorkerMode(scenario, options);
  const scenarioOptions = { ...options, serviceWorkers: effectiveServiceWorkers };
  let browserSession = null;
  let browserContext = null;
  let page = null;
  let cdp = null;
  let browserCdp = null;
  let network = null;
  let diagnostics = null;
  let systemSampler = null;
  let systemSamples = null;
  let setupDiagnostics = null;
  const measuredPhases = [];
  const recordedInvariants = [];
  let environment = null;
  let powerAfter = null;
  const sessionStartedAt = performance.now();
  const sessionStartedAtUtc = new Date().toISOString();
  let measurementStartedAt = null;
  let measurementStartedAtUtc = null;
  let measurementEndedAt = null;
  let measurementEndedAtUtc = null;

  try {
    browserSession = await launchBrowser({
      browser: options.browser || 'chromium',
      executablePath: options.executablePath,
      headless: options.headless,
      viewport: options.viewport,
      deviceScaleFactor: 1,
      serviceWorkers: effectiveServiceWorkers,
    });
    ({ context: browserContext, page, cdp, browserCdp } = browserSession);
    await fixtures.installDefaultOnboardingState(browserContext);
    await fixtures.installFixedDate(browserContext, options.academicDate);
    await installObservers(page);
    await enablePerformance(cdp);
    network = await createNetworkCollector(cdp);
    diagnostics = createPageDiagnostics(page);
    if (options.cpuThrottle > 1) {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: options.cpuThrottle });
    }
    if (!options.headless) await page.bringToFront();
    await warmBrowserState(page, target, runnerSetupOptions(scenario, scenarioOptions));
    environment = await collectEnvironment({
      page,
      cdp,
      browserCdp,
      repoRoot: REPO_ROOT,
      target: { id: target.id, url: target.url },
      refreshSamples: options.headless ? 20 : 60,
    });
    const gpuMode = environment.browser?.gpu?.mode || 'unknown';
    const gpuRequired = options.profile === 'reference' && !options.headless;
    const gpuValidation = {
      required: gpuRequired,
      mode: gpuMode,
      valid: !gpuRequired || gpuMode === 'hardware' || options.allowSoftwareGpu === true,
      override: options.allowSoftwareGpu === true,
    };
    environment.gpuValidation = gpuValidation;
    if (!warmup) {
      const canonicalEnvironment = store.artifactPath(`system/environments/${environment.environmentKey}.json`);
      if (!fs.existsSync(canonicalEnvironment)) {
        store.writeJson(`system/environments/${environment.environmentKey}.json`, environment);
      }
      store.writeJson(
        `system/iterations/${scenario.id}-${target.id}-${iteration + 1}-environment.json`,
        environment,
      );
    }
    if (!gpuValidation.valid) {
      throw new Error(`headed reference run requires a hardware GPU; detected ${gpuMode} (use --allow-software-gpu to override)`);
    }
    const expectedPower = options.power || null;
    if (expectedPower && environment.power?.source !== expectedPower) {
      throw new Error(`power changed before iteration: expected ${expectedPower}, found ${environment.power?.source || 'unknown'}`);
    }
    const startSystemSampler = () => createSystemSampler({
      cdp,
      browserCdp,
      intervalMs: 500,
      profileMarker: path.basename(browserSession.userDataDir),
    });
    if (options.power && environment.power?.supported) {
      // PowerShell/CIM startup can outlast a sub-second journey. Prime one
      // authoritative sample before measurement so short scenarios retain the
      // same fail-closed source validation as longer runs.
      systemSampler = startSystemSampler();
      await systemSampler.waitForWindowsSamples(1, 15_000);
    }

    await navigateForScenario(page, scenario, target, scenarioOptions);

    let phaseSequence = 0;
    const beginPhase = async (name) => {
      if (measurementStartedAt === null) {
        measurementStartedAt = performance.now();
        measurementStartedAtUtc = new Date().toISOString();
        setupDiagnostics = diagnostics.snapshot();
        network.reset();
        diagnostics.reset();
        if (!systemSampler) systemSampler = startSystemSampler();
      }
      const label = `${scenario.id}-${iteration}-${++phaseSequence}`;
      const navigation = { count: 0 };
      const onFrameNavigated = (frame) => {
        if (frame === page.mainFrame()) navigation.count += 1;
      };
      page.on('framenavigated', onFrameNavigated);
      await resetObservers(page).catch(() => {});
      const cdpBefore = await readCdpPerformance(cdp);
      await beginFrameSampling(page, label);
      const startedAt = performance.now();
      return {
        name,
        label,
        startedAt,
        startedAtUtc: new Date().toISOString(),
        startOffsetMs: measurementStartedAt === null ? null : round(startedAt - measurementStartedAt, 3),
        cdpBefore,
        navigation,
        onFrameNavigated,
      };
    };
    const endPhase = async (handle, details = null) => {
      if (!handle) return null;
      const endedAt = performance.now();
      const endedAtUtc = new Date().toISOString();
      page.removeListener('framenavigated', handle.onFrameNavigated);
      const frames = await endFrameSampling(page, handle.label).catch(() => []);
      const [cdpAfter, observers] = await Promise.all([
        readCdpPerformance(cdp),
        readObservers(page).catch(() => null),
      ]);
      const phase = {
        name: handle.name,
        elapsedMs: round(endedAt - handle.startedAt, 3),
        startedAtUtc: handle.startedAtUtc,
        endedAtUtc,
        startOffsetMs: handle.startOffsetMs,
        endOffsetMs: measurementStartedAt === null ? null : round(endedAt - measurementStartedAt, 3),
        cdpDelta: metricDelta(handle.cdpBefore, cdpAfter),
        frames: frameSummary(
          frames,
          environment?.display?.intervalMs || null,
          handle.navigation.count > 0 ? 'document-navigation-reset-request-animation-frame-sampling' : null,
        ),
        navigations: handle.navigation.count,
        observers,
        details,
      };
      measuredPhases.push(phase);
      return phase;
    };

    let seededFixtureId = null;
    let seededFixtureHash = null;
    const fixtureHelpers = fixtures.createFixtureHelpers(page, { timeout: options.navigationTimeout });
    const seedFixture = fixtureHelpers.seed;
    fixtureHelpers.seed = async (name, seedOptions = {}) => {
      const seeded = await seedFixture(name, seedOptions);
      seededFixtureId = seeded?.fixture?.id || String(name);
      seededFixtureHash = seeded?.fixture ? sha256(JSON.stringify(seeded.fixture)) : null;
      return seeded;
    };

    const scenarioResult = await scenario.run({
      page,
      browserContext,
      cdp,
      input: createCdpInput(cdp),
      target,
      options: scenarioOptions,
      fixtures: fixtureHelpers,
      beginPhase,
      endPhase,
      recordInvariant(name, pass, details = {}) {
        recordedInvariants.push({ name, pass: Boolean(pass), details });
      },
      artifactDir: store.directory,
    });
    measurementEndedAt = performance.now();
    measurementEndedAtUtc = new Date().toISOString();

    if (systemSampler) {
      systemSamples = await systemSampler.stop();
      systemSampler = null;
    } else {
      systemSamples = { intervalMs: 500, samples: [], portableSamples: [], cdpSamples: [], errors: [] };
    }
    attachSystemSamplesToPhases(measuredPhases, systemSamples);
    const finalMetrics = await captureMetrics(cdp, page);
    const networkResult = network.snapshot();
    const pageDiagnostics = diagnostics.snapshot();
    const beforeMeasurementDiagnostics = setupDiagnostics || {
      console: [], pageErrors: [], requestFailures: [], badResponses: [],
    };
    const scenarioOfflineFailures = scenarioResult?.metadata?.offlineFailures?.failures || [];
    const expectedOfflineFailureSignatures = recordedOfflineFailureSignatures(scenarioOfflineFailures);
    const expectedOfflineUrls = new Set(scenarioOfflineFailures.map((item) => item.url).filter(Boolean));
    const isExpectedOfflineRequest = (item) => scenario.id === 'service-worker'
      && expectedOfflineFailureSignatures.has(offlineFailureSignature(item));
    const isExpectedOfflineConsole = (item) => (
      scenario.id === 'service-worker'
      && expectedOfflineUrls.has(item?.location?.url)
      && /Failed to load resource:\s*net::ERR_(?:FAILED|INTERNET_DISCONNECTED)/i.test(item?.text || '')
    );
    const allSetupConsoleErrors = beforeMeasurementDiagnostics.console
      .filter((item) => item.type === 'error');
    const setupConsoleErrors = allSetupConsoleErrors;
    const measurementConsoleErrors = pageDiagnostics.console.filter((item) => item.type === 'error');
    const allConsoleErrors = [...allSetupConsoleErrors, ...measurementConsoleErrors];
    const consoleErrors = [
      ...setupConsoleErrors,
      ...measurementConsoleErrors.filter((item) => !isExpectedOfflineConsole(item)),
    ];
    powerAfter = readWindowsPowerTelemetry();
    const endpointPowerValidation = validatePowerState(environment.power, powerAfter, options.power || null);
    const sampledPowerValidation = validateSampledPower(systemSamples, environment.power, options);
    const powerValidation = {
      ...endpointPowerValidation,
      valid: endpointPowerValidation.valid && sampledPowerValidation.sourceValid,
      sampled: sampledPowerValidation,
    };
    const batterySafety = {
      before: validateIterationPower(environment.power, options),
      after: validateIterationPower(powerAfter, options),
      sampled: sampledPowerValidation,
    };
    batterySafety.valid = batterySafety.before.valid
      && batterySafety.after.valid
      && sampledPowerValidation.batteryValid;
    recordedInvariants.push({ name: 'runner.power-state-stable', pass: powerValidation.valid, details: powerValidation });
    recordedInvariants.push({ name: 'runner.battery-safety-floor', pass: batterySafety.valid, details: batterySafety });

    const targetOrigin = new URL(target.url).origin;
    const filterSameOriginFailures = (items, allowExpectedOffline) => items.filter((item) => {
      try {
        return new URL(item.url).origin === targetOrigin
          && !/ERR_ABORTED/i.test(item.error || '')
          && !(allowExpectedOffline && isExpectedOfflineRequest(item));
      } catch (_) { return false; }
    });
    const sameOriginFailures = [
      ...filterSameOriginFailures(beforeMeasurementDiagnostics.requestFailures, false),
      ...filterSameOriginFailures(pageDiagnostics.requestFailures, true),
    ];
    const filterSameOriginResponses = (items) => items.filter((item) => {
      try { return new URL(item.url).origin === targetOrigin; } catch (_) { return false; }
    });
    const sameOriginBadResponses = [
      ...filterSameOriginResponses(beforeMeasurementDiagnostics.badResponses),
      ...filterSameOriginResponses(pageDiagnostics.badResponses),
    ];
    const pageErrors = [
      ...beforeMeasurementDiagnostics.pageErrors,
      ...pageDiagnostics.pageErrors,
    ];
    recordedInvariants.push({
      name: 'runner.no-page-errors',
      pass: pageErrors.length === 0,
      details: { count: pageErrors.length, errors: pageErrors },
    });
    recordedInvariants.push({
      name: 'runner.no-console-errors',
      pass: consoleErrors.length === 0,
      details: { errors: consoleErrors },
    });
    recordedInvariants.push({
      name: 'runner.no-failed-same-origin-requests',
      pass: sameOriginFailures.length === 0 && sameOriginBadResponses.length === 0,
      details: { requestFailures: sameOriginFailures, badResponses: sameOriginBadResponses },
    });

    const scheduleDuplicates = networkResult.summary.duplicateUrls.filter((item) => (
      /\/courses\/schedule\/[^/]+\.jsonl(?:\?|$)/.test(item.request)
    ));
    recordedInvariants.push({
      name: 'runner.no-duplicate-schedule-loads',
      pass: scheduleDuplicates.length === 0,
      details: { duplicates: scheduleDuplicates },
    });

    const invariantFailures = recordedInvariants.filter((item) => !item.pass);
    const timings = Object.fromEntries(measuredPhases.map((phase) => [phase.name, phase.elapsedMs]));
    const frames = Object.fromEntries(measuredPhases.map((phase) => [phase.name, phase.frames]));
    const scenarioSkipped = scenarioResult?.metadata?.skipped || null;
    const record = {
      runId: store.runId,
      scenarioId: scenario.id,
      iteration,
      status: invariantFailures.length ? 'failed' : (scenarioSkipped ? 'skipped' : 'passed'),
      target: { id: target.id, kind: target.kind, url: target.url },
      browser: {
        id: browserSession.id,
        version: environment.browser?.version?.product || null,
        viewport: { ...options.viewport, deviceScaleFactor: 1 },
        headless: options.headless,
      },
      fixtureId: seededFixtureId || scenarioResult?.metadata?.fixture || null,
      environmentKey: environment.environmentKey,
      metrics: {
        elapsedMs: measurementStartedAt === null
          ? null : round((measurementEndedAt || performance.now()) - measurementStartedAt, 3),
        sessionElapsedMs: round(performance.now() - sessionStartedAt, 3),
        measurementStartedAtUtc,
        measurementEndedAtUtc,
        sessionStartedAtUtc,
        timings,
        frames,
        observers: aggregateObserverMetrics(measuredPhases),
        phases: measuredPhases,
        scenario: scenarioResult,
        final: finalMetrics,
        network: networkResult.summary,
      },
      diagnostics: {
        setup: beforeMeasurementDiagnostics,
        measurement: pageDiagnostics,
        console: [...beforeMeasurementDiagnostics.console, ...pageDiagnostics.console],
        consoleErrors,
        allConsoleErrors,
        pageErrors,
        requestFailures: sameOriginFailures,
        badResponses: sameOriginBadResponses,
        allRequestFailures: [
          ...beforeMeasurementDiagnostics.requestFailures,
          ...pageDiagnostics.requestFailures,
        ],
        allBadResponses: [
          ...beforeMeasurementDiagnostics.badResponses,
          ...pageDiagnostics.badResponses,
        ],
        network: networkResult.requests,
      },
      metadata: {
        profile: options.profile,
        fixtureHash: seededFixtureHash,
        workloadHash: workloadProvenance?.sha256 || null,
        workloadSchemaVersion: workloadProvenance?.schemaVersion || null,
        cache: options.cache,
        serviceWorkers: effectiveServiceWorkers,
        cpuThrottle: options.cpuThrottle,
        viewport: { ...options.viewport, deviceScaleFactor: 1 },
        powerSource: environment.power?.source || 'unknown',
        powerBefore: environment.power,
        powerAfter,
        powerValidation,
        batterySafety,
        gpuValidation: environment.gpuValidation,
        systemSamples: {
          count: systemSamples.samples?.length || 0,
          portableCount: systemSamples.portableSamples?.length || 0,
          cdpCount: systemSamples.cdpSamples?.length || 0,
          errors: systemSamples.errors || [],
        },
        invariants: recordedInvariants,
        tags: scenario.tags || [],
        skippedReason: scenarioSkipped,
        warmup: Boolean(warmup),
      },
    };
    const budgetResult = evaluateBudgets({
      candidate: record,
      config: PERFORMANCE_BUDGETS,
      mode: options.budgetMode === 'enforce' ? 'gating' : 'advisory',
    });
    record.metadata.budgets = budgetResult;
    if (!budgetResult.passed) record.status = 'failed';
    if (!warmup) {
      const artifactStem = `${scenario.id}-${target.id}-${iteration + 1}`;
      store.writeJson(`system/samples/${artifactStem}.json`, systemSamples);
      store.writeJson(`logs/${artifactStem}-console.json`, {
        setup: beforeMeasurementDiagnostics,
        measurement: pageDiagnostics,
      });
      store.writeJson(`logs/${artifactStem}-network.json`, networkResult);
    }
    if (!warmup) store.appendIteration(record);
    return record;
  } catch (error) {
    try {
      if (systemSampler) systemSamples = await systemSampler.stop();
      systemSampler = null;
    } catch (_) {}
    powerAfter = readWindowsPowerTelemetry();
    const errorDiagnostics = diagnostics ? diagnostics.snapshot() : {};
    if (Array.isArray(errorDiagnostics.console)) {
      errorDiagnostics.consoleErrors = errorDiagnostics.console.filter((item) => item.type === 'error');
    }
    const record = {
      runId: store.runId,
      scenarioId: scenario.id,
      iteration,
      status: 'error',
      target: { id: target.id, kind: target.kind, url: target.url },
      browser: {
        id: browserSession?.id || options.browser || 'chromium',
        viewport: options.viewport,
        headless: options.headless,
      },
      fixtureId: null,
      environmentKey: environment?.environmentKey || null,
      metrics: {
        elapsedMs: measurementStartedAt === null
          ? null : round(performance.now() - measurementStartedAt, 3),
        sessionElapsedMs: round(performance.now() - sessionStartedAt, 3),
        measurementStartedAtUtc,
        measurementEndedAtUtc: measurementEndedAtUtc || new Date().toISOString(),
        sessionStartedAtUtc,
        phases: measuredPhases,
      },
      diagnostics: errorDiagnostics,
      metadata: {
        profile: options.profile,
        workloadHash: workloadProvenance?.sha256 || null,
        workloadSchemaVersion: workloadProvenance?.schemaVersion || null,
        cache: options.cache,
        cpuThrottle: options.cpuThrottle,
        serviceWorkers: effectiveServiceWorkers,
        powerBefore: environment?.power || null,
        powerAfter,
        gpuValidation: environment?.gpuValidation || null,
        systemSamples: systemSamples ? {
          count: systemSamples.samples?.length || 0,
          portableCount: systemSamples.portableSamples?.length || 0,
          cdpCount: systemSamples.cdpSamples?.length || 0,
          errors: systemSamples.errors || [],
        } : null,
        warmup: Boolean(warmup),
      },
      error: { name: error.name, message: error.message, stack: error.stack },
    };
    if (!warmup) {
      const artifactStem = `${scenario.id}-${target.id}-${iteration + 1}`;
      if (systemSamples) store.writeJson(`system/samples/${artifactStem}.json`, systemSamples);
      store.writeJson(`logs/${artifactStem}-error.json`, errorDiagnostics);
      store.appendIteration(record);
    }
    return record;
  } finally {
    try { if (systemSampler) await systemSampler.stop(); } catch (_) {}
    try { if (network) await network.dispose(); } catch (_) {}
    try { if (diagnostics) diagnostics.dispose(); } catch (_) {}
    try {
      if (options.cache === 'offline-warm' && browserContext) await browserContext.setOffline(false);
    } catch (_) {}
    try {
      if (browserSession) await browserSession.close();
    } catch (error) {
      const cleanup = {
        at: new Date().toISOString(),
        scenarioId: scenario.id,
        targetId: target.id,
        iteration,
        warmup: Boolean(warmup),
        operation: 'browser-session-close',
        error: { name: error.name, message: error.message, stack: error.stack },
      };
      process.stderr.write(`Browser cleanup failed (${scenario.id}/${target.id}): ${error.message}\n`);
      if (!warmup) {
        try {
          store.writeJson(`logs/${scenario.id}-${target.id}-${iteration + 1}-cleanup.json`, cleanup);
        } catch (_) {}
      }
    }
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const registry = loadScenarios();
  if (options.help) {
    process.stdout.write(helpText());
    return;
  }
  if (options.listScenarios) {
    for (const scenario of Array.from(registry.values()).sort((left, right) => left.id.localeCompare(right.id))) {
      process.stdout.write(`${scenario.id.padEnd(18)} ${scenario.description}\n`);
    }
    return;
  }
  const scenarios = selectScenarios(registry, options.scenarios);
  if (options.cache === 'installing' && scenarios.some((scenario) => scenario.id !== 'startup')) {
    throw new Error('--cache installing is supported only by the startup scenario, where installation occurs inside the measured navigation');
  }
  if (options.cache === 'offline-warm' && scenarios.some((scenario) => scenario.id !== 'service-worker')) {
    throw new Error('--cache offline-warm is supported only by the service-worker scenario, which owns the online fixture warmup and bounded offline phase');
  }
  await waitForRequestedPower(options);

  const workloadByScenario = new Map(scenarios.map((scenario) => [
    scenario.id,
    collectWorkloadProvenance(scenario),
  ]));
  const scenarioTargetAssets = Array.from(new Set(scenarios.flatMap((scenario) => (
    Array.isArray(scenario.targetAssets) ? scenario.targetAssets : []
  )))).sort();

  const store = new ArtifactStore({
    baseDirectory: options.output ? path.resolve(options.output) : undefined,
    runId: options.runId,
    label: options.label || options.profile,
  });
  const manifest = {
    schemaVersion: 1,
    runId: store.runId,
    createdAt: new Date().toISOString(),
    profile: options.profile,
    options: { ...options, executablePath: options.executablePath || null },
    scenarios: scenarios.map(({ id, description, tags, targetAssets }) => ({
      id,
      description,
      tags: tags || [],
      targetAssets: Array.isArray(targetAssets) ? targetAssets : [],
      workload: workloadByScenario.get(id),
    })),
    targets: [],
    environments: {},
    diagnostics: [],
  };
  store.initialize(manifest);

  const targets = [];
  const diagnosticRequests = new Map();
  let aborted = null;
  let failed = false;
  try {
    for (const input of options.targets) {
      const target = await startTarget(input, {
        repoRoot: REPO_ROOT,
        liveUrl: options.liveUrl,
        port: options.port,
      });
      target.hashes = await collectTargetHashes(target, { additionalFiles: scenarioTargetAssets });
      targets.push(target);
      manifest.targets.push({
        id: target.id,
        kind: target.kind,
        url: target.url,
        scenarioAssets: scenarioTargetAssets,
        hashes: target.hashes,
      });
    }
    store.writeJson('manifest.json', manifest);

    measurementLoop:
    for (const scenario of scenarios) {
      for (let pass = -options.warmups; pass < options.repeats; pass += 1) {
        const warmup = pass < 0;
        const iteration = warmup ? Math.abs(pass) - 1 : pass;
        const targetOrder = (pass + options.warmups) % 2 === 0 ? targets : targets.slice().reverse();
        for (const target of targetOrder) {
          if (options.power) {
            const preflightPower = readWindowsPowerTelemetry();
            const preflightValidation = validateIterationPower(preflightPower, options);
            if (!preflightValidation.valid) {
              failed = true;
              aborted = {
                at: new Date().toISOString(),
                reason: 'power preflight failed before the next iteration',
                validation: preflightValidation,
              };
              process.stderr.write(`Performance run aborted: ${preflightValidation.errors.join('; ')}\n`);
              break measurementLoop;
            }
          }
          const kind = warmup ? 'warmup' : `iteration ${iteration + 1}/${options.repeats}`;
          process.stdout.write(`[${scenario.id}] ${target.id} ${kind}\n`);
          const record = await runIteration({
            scenario,
            target,
            options,
            store,
            iteration,
            warmup,
            workloadProvenance: workloadByScenario.get(scenario.id),
          });
          if (warmup && record.status === 'error') {
            failed = true;
            aborted = {
              at: new Date().toISOString(),
              reason: 'an unrecorded warmup failed',
              scenarioId: scenario.id,
              targetId: target.id,
              error: record.error,
            };
            process.stderr.write(`Performance run aborted: ${aborted.reason} (${scenario.id}/${target.id})\n`);
            break measurementLoop;
          }
          if (!warmup && ['failed', 'error'].includes(record.status)) {
            failed = true;
            diagnosticRequests.set(`${scenario.id}|${target.id}`, { scenario, target });
          }
          if (record.environmentKey && !manifest.environments[record.environmentKey]) {
            manifest.environments[record.environmentKey] = {
              browser: record.browser,
              powerSource: record.metadata?.powerSource,
              viewport: record.metadata?.viewport,
            };
          }
          if (record.metadata?.powerValidation?.valid === false
              || record.metadata?.batterySafety?.valid === false) {
            failed = true;
            aborted = {
              at: new Date().toISOString(),
              reason: record.metadata?.powerValidation?.valid === false
                ? 'power source changed during an iteration'
                : 'battery safety floor was crossed during an iteration',
              scenarioId: scenario.id,
              targetId: target.id,
              powerValidation: record.metadata?.powerValidation || null,
              batterySafety: record.metadata?.batterySafety || null,
            };
            process.stderr.write(`Performance run aborted: ${aborted.reason}\n`);
            break measurementLoop;
          }
        }
      }
    }
    if (aborted) manifest.aborted = aborted;
    if (options.diagnose && diagnosticRequests.size && !aborted) {
      manifest.diagnostics = await runDiagnostics(
        Array.from(diagnosticRequests.values()),
        options,
        store,
      );
      store.writeJson('manifest.json', manifest);
    }
  } finally {
    for (const target of targets.reverse()) {
      try { await target.close(); } catch (_) {}
    }
  }

  const iterations = store.readIterations();
  const completedManifest = { ...manifest, completedAt: new Date().toISOString() };
  const budgetResults = aggregateBudgetResults(iterations, options.budgetMode);
  store.writeJson('manifest.json', completedManifest);
  const report = writeReports(store, {
    manifest: completedManifest,
    iterations,
    budgetResults,
  });
  const statuses = report.summary.statuses || {};
  process.stdout.write(`Performance artifacts: ${store.directory}\n`);
  process.stdout.write(`Iterations: ${report.summary.iterationCount}; passed ${statuses.passed || 0}; failed ${statuses.failed || 0}; errors ${statuses.error || 0}\n`);
  if (failed || statuses.failed || statuses.error || !budgetResults.passed) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  PROFILES,
  aggregateObserverMetrics,
  aggregateBudgetResults,
  attachSystemSamplesToPhases,
  basicSummary,
  classifyDiagnosticFailures,
  collectWorkloadProvenance,
  collectTargetHashes,
  commonJsDependencyGraph,
  effectiveServiceWorkerMode,
  frameSummary,
  fingerprintRepositoryFiles,
  linkedFirstPartyAssets,
  loadScenarios,
  main,
  offlineFailureSignature,
  parseArguments,
  recordedOfflineFailureSignatures,
  runDiagnosticPass,
  runDiagnostics,
  runIteration,
  selectScenarios,
  validateSampledPower,
};
