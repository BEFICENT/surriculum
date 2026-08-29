#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const { ArtifactStore } = require('./lib/artifacts');
const { launchBrowser } = require('./lib/browser');
const { evaluateBudgets, loadBudgets } = require('./lib/budgets');
const { createCdpInput } = require('./lib/cdp-input');
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
const { round, summarize } = require('./lib/stats');
const {
  collectEnvironment,
  createSystemSampler,
  readWindowsPowerTelemetry,
  validatePowerState,
} = require('./lib/system-info');
const { startTarget } = require('./lib/targets');
const { profileDiagnostic, traceDiagnostic } = require('./lib/tracing');
const { waitForServiceWorkerReady } = require('./lib/service-worker');
const fixtures = require('./fixtures');
const { writeReports } = require('./report');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PERFORMANCE_BUDGETS = loadBudgets();

const PROFILES = Object.freeze({
  'ci-smoke': Object.freeze({
    scenarios: ['startup', 'scheduler'],
    warmups: 0,
    repeats: 1,
    headless: true,
    cpuThrottle: 4,
    cache: 'cold',
    serviceWorkers: 'block',
    budgetMode: 'advisory',
  }),
  nightly: Object.freeze({
    scenarios: ['startup', 'planner', 'picker', 'scheduler', 'summary', 'transcript', 'persistence', 'responsive', 'service-worker', 'memory'],
    warmups: 1,
    repeats: 5,
    headless: true,
    cpuThrottle: 4,
    cache: 'cold',
    serviceWorkers: 'block',
    budgetMode: 'advisory',
    diagnose: true,
  }),
  reference: Object.freeze({
    scenarios: ['startup', 'planner', 'picker', 'scheduler', 'summary', 'transcript', 'persistence', 'responsive', 'service-worker', 'memory'],
    warmups: 2,
    repeats: 9,
    headless: false,
    cpuThrottle: 1,
    cache: 'cold',
    serviceWorkers: 'block',
    budgetMode: 'advisory',
    diagnose: true,
  }),
  production: Object.freeze({
    scenarios: ['startup', 'planner', 'scheduler', 'service-worker'],
    warmups: 1,
    repeats: 3,
    headless: true,
    cpuThrottle: 1,
    cache: 'warm',
    serviceWorkers: 'allow',
    budgetMode: 'advisory',
    targets: ['live'],
  }),
});

function helpText() {
  return `SUrriculum performance runner

Usage:
  node tests/perf/run.js [options]

Profiles:
  --profile ci-smoke|nightly|reference|production

Selection:
  --scenario <id[,id...]>      Override the profile scenario list
  --list-scenarios             Print available scenarios and exit
  --target <id-or-url>         local-source, local-artifact, live, or an HTTP URL
  --targets <a,b,...>          Interleave multiple targets per recorded iteration

Browser and state:
  --browser chromium|chrome|brave
  --executable-path <path>
  --headed | --headless
  --viewport <width>x<height>  Default: 1440x900
  --cache cold|warm|installing|offline-warm
  --service-workers block|allow
  --cpu-throttle <rate>        1 disables emulation
  --academic-date <ISO date>   Default: 2026-08-29T09:00:00.000Z

Sampling and gates:
  --warmups <count>
  --repeats <count>
  --power ac|battery|desktop   Validate OS power state before/after every iteration
  --await-power                Wait for --power before starting
  --min-battery <percent>      Default: 30 for requested battery runs
  --budget-mode advisory|enforce
  --diagnose                   Capture focused trace/profile reruns when supported
  --no-diagnose                Disable profile-default diagnostic reruns
  --allow-software-gpu         Permit a headed reference run without verified hardware GPU

Output:
  --output <directory>         Default: test-results/perf
  --run-id <id>
  --label <text>

Compatibility assertions used by CI:
  --workers 1                  Any other value is rejected
  --retries 0                 Any other value is rejected

Examples:
  npm run perf:smoke
  node tests/perf/run.js --profile reference --browser brave --headed --scenario scheduler --power ac --await-power
  node tests/perf/run.js --profile production --targets local-artifact,live --scenario startup,scheduler
`;
}

function parseBoolean(value, label) {
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  throw new Error(`${label} must be true or false`);
}

function parseInteger(value, label, minimum = 0) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum) {
    throw new Error(`${label} must be an integer >= ${minimum}`);
  }
  return number;
}

function parseNumber(value, label, minimum = 0) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum) {
    throw new Error(`${label} must be a number >= ${minimum}`);
  }
  return number;
}

function splitList(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function parseArguments(argv) {
  const explicit = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') explicit.help = true;
    else if (token === '--list-scenarios') explicit.listScenarios = true;
    else if (token === '--headed') explicit.headless = false;
    else if (token === '--headless') explicit.headless = true;
    else if (token === '--await-power') explicit.awaitPower = true;
    else if (token === '--diagnose') explicit.diagnose = true;
    else if (token === '--no-diagnose') explicit.diagnose = false;
    else if (token === '--allow-software-gpu') explicit.allowSoftwareGpu = true;
    else {
      const match = /^--([^=]+)(?:=(.*))?$/.exec(token);
      if (!match) throw new Error(`unexpected argument: ${token}`);
      const key = match[1];
      const value = match[2] !== undefined ? match[2] : argv[++index];
      if (value === undefined) throw new Error(`--${key} requires a value`);
      const names = {
        profile: 'profile', scenario: 'scenarios', scenarios: 'scenarios',
        target: 'target', targets: 'targets', browser: 'browser',
        'executable-path': 'executablePath', viewport: 'viewport', cache: 'cache',
        'service-workers': 'serviceWorkers', 'cpu-throttle': 'cpuThrottle',
        warmups: 'warmups', repeats: 'repeats', power: 'power',
        'min-battery': 'minBattery', 'budget-mode': 'budgetMode',
        output: 'output', 'run-id': 'runId', label: 'label',
        workers: 'workers', retries: 'retries', 'live-url': 'liveUrl',
        port: 'port', 'navigation-timeout': 'navigationTimeout',
        'academic-date': 'academicDate',
      };
      if (!names[key]) throw new Error(`unknown option: --${key}`);
      explicit[names[key]] = value;
    }
  }

  const profileName = explicit.profile || 'ci-smoke';
  const profile = PROFILES[profileName];
  if (!profile) throw new Error(`unknown profile: ${profileName}`);
  const options = { ...profile, ...explicit, profile: profileName };
  options.scenarios = Array.isArray(options.scenarios) ? options.scenarios : splitList(options.scenarios);
  const targetSelection = Object.prototype.hasOwnProperty.call(explicit, 'targets')
    ? explicit.targets
    : (Object.prototype.hasOwnProperty.call(explicit, 'target')
      ? explicit.target
      : (profile.targets || 'local-artifact'));
  options.targets = splitList(targetSelection);
  if (!options.scenarios.length) throw new Error('at least one performance scenario is required');
  if (!options.targets.length) throw new Error('at least one performance target is required');
  options.warmups = parseInteger(options.warmups, '--warmups');
  options.repeats = parseInteger(options.repeats, '--repeats', 1);
  options.cpuThrottle = parseNumber(options.cpuThrottle, '--cpu-throttle', 1);
  options.minBattery = parseNumber(options.minBattery ?? 30, '--min-battery', 0);
  options.workers = parseInteger(options.workers ?? 1, '--workers', 1);
  options.retries = parseInteger(options.retries ?? 0, '--retries', 0);
  options.navigationTimeout = parseInteger(options.navigationTimeout ?? 30_000, '--navigation-timeout', 1);
  if (options.workers !== 1) throw new Error('performance runs require --workers 1');
  if (options.retries !== 0) throw new Error('performance runs require --retries 0');
  if (!['block', 'allow'].includes(options.serviceWorkers)) throw new Error('--service-workers must be block or allow');
  if (!['cold', 'warm', 'installing', 'offline-warm'].includes(options.cache)) throw new Error('unsupported --cache state');
  if (!['advisory', 'enforce'].includes(options.budgetMode)) throw new Error('--budget-mode must be advisory or enforce');
  if (options.power && !['ac', 'battery', 'desktop'].includes(options.power)) throw new Error('--power must be ac, battery, or desktop');
  if (typeof options.headless !== 'boolean') options.headless = parseBoolean(options.headless, '--headless');
  const academicTimestamp = Date.parse(options.academicDate || fixtures.DEFAULT_ACADEMIC_DATE);
  if (!Number.isFinite(academicTimestamp)) throw new Error('--academic-date must be a valid ISO date');
  options.academicDate = new Date(academicTimestamp).toISOString();

  const viewportMatch = /^(\d+)x(\d+)$/i.exec(String(options.viewport || '1440x900'));
  if (!viewportMatch) throw new Error('--viewport must look like 1440x900');
  options.viewport = { width: Number(viewportMatch[1]), height: Number(viewportMatch[2]) };
  return options;
}

function loadScenarios() {
  const directory = path.join(__dirname, 'scenarios');
  const modules = new Map();
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.js') || entry.name.startsWith('_') || entry.name === 'index.js') continue;
    const scenario = require(path.join(directory, entry.name));
    if (!scenario || typeof scenario.id !== 'string' || typeof scenario.run !== 'function') {
      throw new Error(`invalid performance scenario module: ${entry.name}`);
    }
    if (modules.has(scenario.id)) throw new Error(`duplicate performance scenario id: ${scenario.id}`);
    modules.set(scenario.id, scenario);
  }
  return modules;
}

function selectScenarios(registry, requested) {
  const selected = [];
  for (const id of requested) {
    const scenario = registry.get(id);
    if (!scenario) throw new Error(`unknown scenario "${id}"; available: ${Array.from(registry.keys()).sort().join(', ')}`);
    selected.push(scenario);
  }
  return selected;
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function collectTargetHashes(target) {
  const files = ['index.html', 'scripts/scheduler.js', 'sw.js', 'data/manifest.json'];
  const hashes = {};
  for (const relative of files) {
    try {
      let data;
      if (target.root) data = fs.readFileSync(path.join(target.root, ...relative.split('/')));
      else {
        const response = await fetch(new URL(relative, target.url), {
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        data = Buffer.from(await response.arrayBuffer());
      }
      hashes[relative] = { sha256: sha256(data), bytes: data.length };
    } catch (error) {
      hashes[relative] = { error: error.message };
    }
  }
  return hashes;
}

function batteryPercentage(power) {
  const values = (power?.batteries || [])
    .map((battery) => Number(battery.estimatedChargeRemaining))
    .filter(Number.isFinite);
  return values.length ? Math.min(...values) : null;
}

function validateIterationPower(power, options) {
  const errors = [];
  const source = power?.source || 'unknown';
  const percentage = batteryPercentage(power);
  if (options.power && source !== options.power) {
    errors.push(`expected ${options.power} power, detected ${source}`);
  }
  if (options.power === 'battery') {
    if (percentage === null) errors.push('battery percentage is unavailable');
    else if (percentage < options.minBattery) {
      errors.push(`battery is ${percentage}%, below the ${options.minBattery}% safety floor`);
    }
  }
  return {
    valid: errors.length === 0,
    source,
    percentage,
    expected: options.power || null,
    minimumBatteryPercent: options.power === 'battery' ? options.minBattery : null,
    errors,
  };
}

function validateSampledPower(systemSamples, before, options) {
  const samples = Array.isArray(systemSamples?.samples) ? systemSamples.samples : [];
  const samplerErrors = Array.isArray(systemSamples?.errors) ? systemSamples.errors : [];
  const expectedSource = options.power || before?.source || 'unknown';
  const samplingRequired = Boolean(options.power && before?.supported);
  const samplingAvailable = samples.length > 0;
  const observedSources = Array.from(new Set(samples.map((sample) => sample?.source || 'unknown')));
  const sourceErrors = [];
  if (samplingRequired && !samplingAvailable) {
    sourceErrors.push('no in-iteration Windows power samples were captured');
  }
  if (expectedSource !== 'unknown') {
    for (const source of observedSources) {
      if (source !== expectedSource) sourceErrors.push(`sampled power source ${source}; expected ${expectedSource}`);
    }
  }
  const batteryPercentages = samples
    .map((sample) => Number(sample?.battery?.chargePercent))
    .filter(Number.isFinite);
  const minimumBatteryPercent = options.power === 'battery' ? options.minBattery : null;
  const belowFloor = Number.isFinite(minimumBatteryPercent)
    ? batteryPercentages.filter((percentage) => percentage < minimumBatteryPercent)
    : [];
  return {
    valid: sourceErrors.length === 0 && belowFloor.length === 0,
    sourceValid: sourceErrors.length === 0,
    batteryValid: belowFloor.length === 0,
    expectedSource,
    samplingRequired,
    samplingAvailable,
    observedSources,
    sampleCount: samples.length,
    samplerErrors,
    batteryPercentages,
    minimumBatteryPercent,
    errors: [
      ...sourceErrors,
      ...(belowFloor.length ? [`sampled battery below ${minimumBatteryPercent}%: ${Math.min(...belowFloor)}%`] : []),
    ],
  };
}

function attachSystemSamplesToPhases(phases, systemSamples) {
  const groups = [
    ['windows', systemSamples?.samples || []],
    ['portable', systemSamples?.portableSamples || []],
    ['cdp', systemSamples?.cdpSamples || []],
  ];
  const inWindow = (sample, start, end) => {
    const timestamp = Date.parse(sample?.capturedAt || '');
    return Number.isFinite(timestamp) && timestamp >= start && timestamp <= end;
  };
  const finite = (values) => values.map(Number).filter(Number.isFinite);
  const range = (values) => {
    const numbers = finite(values);
    return numbers.length ? {
      min: Math.min(...numbers),
      median: summarize(numbers, { digits: 3 }).median,
      max: Math.max(...numbers),
    } : { min: null, median: null, max: null };
  };
  for (const phase of phases) {
    const start = Date.parse(phase.startedAtUtc || '');
    const end = Date.parse(phase.endedAtUtc || '');
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const selected = Object.fromEntries(groups.map(([name, samples]) => [
      name,
      samples.filter((sample) => inWindow(sample, start, end)),
    ]));
    const windowsCpu = finite(selected.windows.map((sample) => sample?.browserProcesses?.cumulativeCpuSeconds));
    const cdpCpu = selected.cdp.map((sample) => (
      (sample.processInfo || []).reduce((sum, processInfo) => sum + (Number(processInfo.cpuTime) || 0), 0)
    ));
    phase.system = {
      sampleCounts: {
        windows: selected.windows.length,
        portable: selected.portable.length,
        cdp: selected.cdp.length,
      },
      hostCpuLoadPercent: range(selected.portable.map((sample) => sample?.cpu?.loadPercent)),
      hostClockMHz: range(selected.portable.map((sample) => sample?.cpu?.currentClockMHz)),
      browserWorkingSetBytes: range(selected.windows.map((sample) => sample?.browserProcesses?.workingSetBytes)),
      browserPrivateMemoryBytes: range(selected.windows.map((sample) => sample?.browserProcesses?.privateMemoryBytes)),
      browserCpuSecondsDelta: windowsCpu.length >= 2
        ? round(windowsCpu[windowsCpu.length - 1] - windowsCpu[0], 6) : null,
      cdpProcessCpuSecondsDelta: cdpCpu.length >= 2
        ? round(cdpCpu[cdpCpu.length - 1] - cdpCpu[0], 6) : null,
      powerSources: Array.from(new Set(selected.windows.map((sample) => sample?.source || 'unknown'))),
      batteryPercent: range(selected.windows.map((sample) => sample?.battery?.chargePercent)),
    };
  }
  return phases;
}

async function waitForRequestedPower(options) {
  if (!options.power) return readWindowsPowerTelemetry();
  const started = Date.now();
  let lastSource = null;
  while (true) {
    const snapshot = readWindowsPowerTelemetry();
    if (snapshot.source !== lastSource) {
      process.stdout.write(`Power source: ${snapshot.source || 'unknown'}${batteryPercentage(snapshot) === null ? '' : ` (${batteryPercentage(snapshot)}%)`}\n`);
      lastSource = snapshot.source;
    }
    if (snapshot.source === options.power) {
      if (options.power === 'battery') {
        const percentage = batteryPercentage(snapshot);
        if (percentage !== null && percentage < options.minBattery) {
          throw new Error(`battery is ${percentage}%, below the ${options.minBattery}% safety floor`);
        }
      }
      return snapshot;
    }
    if (!options.awaitPower) {
      throw new Error(`expected ${options.power} power, detected ${snapshot.source || 'unknown'}`);
    }
    if (Date.now() - started > 30 * 60 * 1000) throw new Error(`timed out waiting for ${options.power} power`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

function frameSummary(values, refreshIntervalMs = null, unavailableReason = null) {
  if (unavailableReason) {
    return {
      available: false,
      unavailableReason,
      count: 0,
      min: null,
      median: null,
      p75: null,
      p90: null,
      p95: null,
      p99: null,
      max: null,
      mean: null,
      standardDeviation: null,
      mad: null,
      refreshIntervalMs,
      over20ms: null,
      over32ms: null,
      over50ms: null,
      over20Share: null,
      over32Share: null,
      over50Share: null,
      overThreeFrames: null,
    };
  }
  const summary = summarize(values, { digits: 3 });
  const count = values.length;
  const over20ms = values.filter((value) => value > 20).length;
  const over32ms = values.filter((value) => value > 32).length;
  const over50ms = values.filter((value) => value > 50).length;
  return {
    available: true,
    ...summary,
    refreshIntervalMs,
    over20ms,
    over32ms,
    over50ms,
    over20Share: count ? over20ms / count : 0,
    over32Share: count ? over32ms / count : 0,
    over50Share: count ? over50ms / count : 0,
    overThreeFrames: Number.isFinite(refreshIntervalMs)
      ? values.filter((value) => value > (refreshIntervalMs * 3)).length : null,
  };
}

function aggregateObserverMetrics(phases) {
  const derived = (phases || []).map((phase) => phase.observers?.derived).filter(Boolean);
  const finite = (name) => derived.map((item) => item[name]).filter(Number.isFinite);
  const maximum = (name) => {
    const values = finite(name);
    return values.length ? Math.max(...values) : null;
  };
  const total = (name) => finite(name).reduce((sum, value) => sum + value, 0);
  return {
    derived: {
      cls: maximum('cls'),
      lcp: maximum('lcp'),
      longestEvent: maximum('longestEvent'),
      totalBlockingTime: total('totalBlockingTime'),
      longTaskCount: total('longTaskCount'),
      longAnimationFrameCount: total('longAnimationFrameCount'),
    },
  };
}

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

async function runIteration({ scenario, target, options, store, iteration, warmup }) {
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

function diagnosticStem(scenario, target, kind) {
  return `${scenario.id}-${target.id}-${kind}`.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function summarizeDiagnosticScenario(value) {
  return {
    phases: (value?.phases || []).map((phase) => ({
      name: phase.name,
      elapsedMs: phase.elapsedMs,
    })),
    invariants: (value?.invariants || []).map((invariant) => ({
      name: invariant.name,
      pass: Boolean(invariant.pass),
    })),
    metadata: value?.metadata || null,
  };
}

function classifyDiagnosticFailures(snapshot, scenarioValue, target) {
  const diagnostics = snapshot || {};
  const expectedOfflineFailures = scenarioValue?.metadata?.offlineFailures?.failures || [];
  const expectedOfflineSignatures = new Set(expectedOfflineFailures.map((item) => (
    `${item.method || 'GET'} ${item.url || ''} ${item.error || ''}`
  )));
  const expectedOfflineUrls = new Set(expectedOfflineFailures.map((item) => item.url).filter(Boolean));
  const targetOrigin = new URL(target.url).origin;
  const sameOrigin = (url) => {
    try { return new URL(url).origin === targetOrigin; } catch (_) { return false; }
  };
  const requestFailures = (diagnostics.requestFailures || []).filter((item) => (
    sameOrigin(item.url)
    && !/ERR_ABORTED/i.test(item.error || '')
    && !expectedOfflineSignatures.has(`${item.method || 'GET'} ${item.url || ''} ${item.error || ''}`)
  ));
  const badResponses = (diagnostics.badResponses || []).filter((item) => sameOrigin(item.url));
  const consoleErrors = (diagnostics.console || []).filter((item) => {
    if (item.type !== 'error') return false;
    return !(
      expectedOfflineUrls.has(item.location?.url)
      && /Failed to load resource:\s*net::ERR_(?:FAILED|INTERNET_DISCONNECTED)/i.test(item.text || '')
    );
  });
  const pageErrors = diagnostics.pageErrors || [];
  return {
    consoleErrors,
    pageErrors,
    requestFailures,
    badResponses,
    count: consoleErrors.length + pageErrors.length + requestFailures.length + badResponses.length,
  };
}

/**
 * Rerun one failed scenario in a fresh profile under either tracing or the V8
 * CPU profiler. These artifacts are diagnostic only and are never appended to
 * the budget sample population.
 */
async function runDiagnosticPass({ scenario, target, options, store, kind }) {
  const effectiveServiceWorkers = effectiveServiceWorkerMode(scenario, options);
  const scenarioOptions = { ...options, serviceWorkers: effectiveServiceWorkers };
  const stem = diagnosticStem(scenario, target, kind);
  let browserSession = null;
  let browserContext = null;
  let page = null;
  let cdp = null;
  let diagnostics = null;
  const invariants = [];
  const phases = [];
  let sequence = 0;
  let result = null;
  let artifact = null;
  let topFunctions = null;

  try {
    browserSession = await launchBrowser({
      browser: options.browser || 'chromium',
      executablePath: options.executablePath,
      headless: options.headless,
      viewport: options.viewport,
      deviceScaleFactor: 1,
      serviceWorkers: effectiveServiceWorkers,
    });
    ({ context: browserContext, page, cdp } = browserSession);
    diagnostics = createPageDiagnostics(page);
    await fixtures.installDefaultOnboardingState(browserContext);
    await fixtures.installFixedDate(browserContext, options.academicDate);
    if (options.cpuThrottle > 1) {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: options.cpuThrottle });
    }
    if (!options.headless) await page.bringToFront();
    await warmBrowserState(page, target, runnerSetupOptions(scenario, scenarioOptions));
    await navigateForScenario(page, scenario, target, scenarioOptions);

    const beginPhase = async (name) => {
      const id = `${++sequence}-${String(name).replace(/[^a-zA-Z0-9._-]+/g, '-')}`;
      await cdp.send('Tracing.recordClockSyncMarker', {
        syncId: `surriculum:diagnostic:${id}:start`,
      }).catch(() => {});
      await page.evaluate((mark) => performance.mark(`${mark}:start`), `surriculum:diagnostic:${id}`)
        .catch(() => {});
      return {
        id,
        name,
        startedAt: performance.now(),
        startedAtUtc: new Date().toISOString(),
      };
    };
    const endPhase = async (handle, details = null) => {
      if (!handle) return;
      const endedAt = performance.now();
      const endedAtUtc = new Date().toISOString();
      const elapsedMs = round(endedAt - handle.startedAt, 3);
      phases.push({
        name: handle.name,
        elapsedMs,
        startedAtUtc: handle.startedAtUtc,
        endedAtUtc,
        details,
      });
      await cdp.send('Tracing.recordClockSyncMarker', {
        syncId: `surriculum:diagnostic:${handle.id}:end`,
      }).catch(() => {});
      await page.evaluate((mark) => {
        performance.mark(`${mark}:end`);
        if (performance.getEntriesByName(`${mark}:start`, 'mark').length) {
          performance.measure(mark, `${mark}:start`, `${mark}:end`);
        }
      }, `surriculum:diagnostic:${handle.id}`).catch(() => {});
    };
    const scenarioAction = () => scenario.run({
      page,
      browserContext,
      cdp,
      input: createCdpInput(cdp),
      target,
      options: scenarioOptions,
      fixtures: fixtures.createFixtureHelpers(page, { timeout: options.navigationTimeout }),
      beginPhase,
      endPhase,
      recordInvariant(name, pass, details = {}) {
        invariants.push({ name, pass: Boolean(pass), details });
      },
      artifactDir: store.directory,
    });

    let value;
    if (kind === 'trace') {
      artifact = store.artifactPath(`traces/${stem}.json`);
      ({ value } = await traceDiagnostic(cdp, scenarioAction, { outputPath: artifact }));
    } else if (kind === 'profile') {
      artifact = store.artifactPath(`profiles/${stem}.cpuprofile`);
      const result = await profileDiagnostic(cdp, scenarioAction, {
        outputPath: artifact,
        samplingInterval: 1000,
        urlPrefix: target.url,
      });
      value = result.value;
      topFunctions = result.topFunctions;
    } else {
      throw new Error(`unsupported diagnostic kind: ${kind}`);
    }

    const failedInvariants = invariants.filter((item) => !item.pass);
    const snapshot = diagnostics.snapshot();
    const diagnosticFailures = classifyDiagnosticFailures(snapshot, value, target);
    result = {
      status: failedInvariants.length || diagnosticFailures.count ? 'failed' : 'passed',
      scenarioId: scenario.id,
      target: { id: target.id, url: target.url },
      kind,
      artifact,
      serviceWorkers: effectiveServiceWorkers,
      cpuThrottle: options.cpuThrottle,
      phases,
      invariants,
      failedInvariants,
      topFunctions,
      scenario: summarizeDiagnosticScenario(value),
      diagnostics: snapshot,
      diagnosticFailures,
    };
  } catch (error) {
    result = {
      status: 'error',
      scenarioId: scenario.id,
      target: { id: target.id, url: target.url },
      kind,
      phases,
      invariants,
      artifact,
      diagnostics: diagnostics ? diagnostics.snapshot() : {
        console: [], pageErrors: [], requestFailures: [], badResponses: [],
      },
      error: { name: error.name, message: error.message, stack: error.stack },
    };
  } finally {
    const cleanupErrors = [];
    try { if (diagnostics) diagnostics.dispose(); } catch (error) {
      cleanupErrors.push({ operation: 'diagnostics-dispose', message: error.message });
    }
    try {
      if (options.cache === 'offline-warm' && browserContext) await browserContext.setOffline(false);
    } catch (error) {
      cleanupErrors.push({ operation: 'restore-online-state', message: error.message });
    }
    try {
      if (browserSession) await browserSession.close();
    } catch (error) {
      cleanupErrors.push({ operation: 'browser-session-close', message: error.message, stack: error.stack });
    }
    if (!result) {
      result = {
        status: 'error',
        scenarioId: scenario.id,
        target: { id: target.id, url: target.url },
        kind,
        phases,
        invariants,
        error: { name: 'DiagnosticError', message: 'Diagnostic pass ended without a result.' },
      };
    }
    if (cleanupErrors.length) {
      result.status = 'error';
      result.cleanupErrors = cleanupErrors;
    }
    store.writeJson(`diagnostics/${stem}.json`, result);
  }
  return result;
}

async function runDiagnostics(requests, options, store) {
  const results = [];
  for (const { scenario, target } of requests) {
    for (const kind of ['trace', 'profile']) {
      process.stdout.write(`[diagnostic:${kind}] ${scenario.id} ${target.id}\n`);
      try {
        results.push(await runDiagnosticPass({ scenario, target, options, store, kind }));
      } catch (error) {
        const stem = diagnosticStem(scenario, target, kind);
        const failure = {
          status: 'error',
          scenarioId: scenario.id,
          target: { id: target.id, url: target.url },
          kind,
          error: { name: error.name, message: error.message, stack: error.stack },
        };
        try { store.writeJson(`diagnostics/${stem}-runner-error.json`, failure); } catch (_) {}
        results.push(failure);
      }
    }
  }
  return results;
}

function basicSummary(iterations) {
  const byScenario = {};
  for (const record of iterations) {
    const key = `${record.scenarioId}|${record.target?.id || 'target'}`;
    const entry = byScenario[key] || {
      scenarioId: record.scenarioId,
      target: record.target?.id || null,
      statuses: {},
      elapsedMs: [],
      phases: {},
    };
    entry.statuses[record.status] = (entry.statuses[record.status] || 0) + 1;
    if (Number.isFinite(record.metrics?.elapsedMs)) entry.elapsedMs.push(record.metrics.elapsedMs);
    for (const phase of record.metrics?.phases || []) {
      if (!entry.phases[phase.name]) entry.phases[phase.name] = [];
      if (Number.isFinite(phase.elapsedMs)) entry.phases[phase.name].push(phase.elapsedMs);
    }
    byScenario[key] = entry;
  }
  return {
    generatedAt: new Date().toISOString(),
    totals: {
      iterations: iterations.length,
      passed: iterations.filter((item) => item.status === 'passed').length,
      failed: iterations.filter((item) => item.status === 'failed').length,
      errors: iterations.filter((item) => item.status === 'error').length,
    },
    scenarios: Object.values(byScenario).map((entry) => ({
      scenarioId: entry.scenarioId,
      target: entry.target,
      statuses: entry.statuses,
      elapsedMs: summarize(entry.elapsedMs),
      phases: Object.fromEntries(Object.entries(entry.phases).map(([name, values]) => [name, summarize(values)])),
    })),
  };
}

function aggregateBudgetResults(iterations, requestedMode) {
  const results = [];
  for (const record of iterations) {
    for (const result of record.metadata?.budgets?.results || []) {
      results.push({
        ...result,
        scenarioId: record.scenarioId,
        targetId: record.target?.id || null,
        iteration: record.iteration,
      });
    }
  }
  const blockingFailures = results.filter((result) => result.status === 'failed' && result.blocking);
  const failedResults = results.filter((result) => result.status === 'failed');
  return {
    mode: requestedMode === 'enforce' ? 'gating' : 'advisory',
    passed: blockingFailures.length === 0,
    results,
    blockingFailures,
    advisories: failedResults.filter((result) => !result.blocking),
    summary: {
      total: results.length,
      passed: results.filter((result) => result.status === 'passed').length,
      failed: failedResults.length,
      skipped: results.filter((result) => result.status === 'skipped').length,
      blocking: blockingFailures.length,
    },
  };
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
    scenarios: scenarios.map(({ id, description, tags }) => ({ id, description, tags: tags || [] })),
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
      target.hashes = await collectTargetHashes(target);
      targets.push(target);
      manifest.targets.push({ id: target.id, kind: target.kind, url: target.url, hashes: target.hashes });
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
          const record = await runIteration({ scenario, target, options, store, iteration, warmup });
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
  aggregateBudgetResults,
  attachSystemSamplesToPhases,
  basicSummary,
  classifyDiagnosticFailures,
  collectTargetHashes,
  effectiveServiceWorkerMode,
  frameSummary,
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
