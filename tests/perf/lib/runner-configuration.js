'use strict';

const fs = require('node:fs');
const path = require('node:path');

const fixtures = require('../fixtures');

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
  const directory = path.join(__dirname, '..', 'scenarios');
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

module.exports = {
  PROFILES,
  helpText,
  loadScenarios,
  parseArguments,
  selectScenarios,
};
