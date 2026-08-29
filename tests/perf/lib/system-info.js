'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { spawn } = require('node:child_process');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    timeout: options.timeout || 10000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) return null;
  return result.stdout.trim();
}

/** Authoritative Windows power/device snapshot; navigator.getBattery is not. */
function readWindowsPowerTelemetry() {
  if (process.platform !== 'win32') return { supported: false, source: 'unknown' };
  const script = path.join(__dirname, 'windows-power.ps1');
  const output = run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { timeout: 15000 });
  if (!output) return { supported: false, source: 'unknown', error: 'PowerShell telemetry failed' };
  try {
    return { supported: true, ...JSON.parse(output) };
  } catch (error) {
    return { supported: false, source: 'unknown', error: `PowerShell telemetry was invalid JSON: ${error.message}` };
  }
}

function physicalCoreCount() {
  if (process.platform === 'linux' && fs.existsSync('/proc/cpuinfo')) {
    const blocks = fs.readFileSync('/proc/cpuinfo', 'utf8').split(/\n\s*\n/);
    const pairs = new Set();
    for (const block of blocks) {
      const physical = /^physical id\s*:\s*(.+)$/m.exec(block)?.[1];
      const core = /^core id\s*:\s*(.+)$/m.exec(block)?.[1];
      if (physical !== undefined && core !== undefined) pairs.add(`${physical}:${core}`);
    }
    if (pairs.size) return pairs.size;
  }
  if (process.platform === 'darwin') {
    const value = Number(run('sysctl', ['-n', 'hw.physicalcpu']));
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

function hostSnapshot() {
  const cpus = os.cpus();
  return {
    platform: process.platform,
    architecture: os.arch(),
    osType: os.type(),
    osRelease: os.release(),
    osVersion: typeof os.version === 'function' ? os.version() : null,
    hostnameHash: crypto.createHash('sha256').update(os.hostname()).digest('hex').slice(0, 12),
    logicalProcessors: cpus.length,
    physicalCores: physicalCoreCount(),
    cpuModel: cpus[0]?.model || null,
    cpuSpeedMHz: cpus[0]?.speed || null,
    totalMemoryBytes: os.totalmem(),
    freeMemoryBytes: os.freemem(),
    nodeVersion: process.version,
  };
}

function classifyGpu(systemInfo) {
  const gpu = systemInfo?.gpu || null;
  const renderer = String(gpu?.auxAttributes?.glRenderer || '');
  const featureStatus = gpu?.featureStatus || {};
  const softwarePattern = /swiftshader|llvmpipe|softpipe|software rasterizer|microsoft basic render driver/i;
  const rendererIsSoftware = softwarePattern.test(renderer);
  const primaryDevice = gpu?.devices?.[0]?.deviceString || '';
  const primaryDeviceIsSoftware = softwarePattern.test(primaryDevice);
  const gpuCompositing = String(featureStatus.gpu_compositing || 'unknown');
  const rasterization = String(featureStatus.rasterization || 'unknown');
  const accelerationEnabled = /enabled|enabled_on/i.test(gpuCompositing)
    && /enabled|enabled_on/i.test(rasterization);
  let mode = 'unknown';
  if (rendererIsSoftware || primaryDeviceIsSoftware) mode = 'software';
  else if (renderer && accelerationEnabled) mode = 'hardware';
  return {
    mode,
    renderer: renderer || null,
    primaryDevice: primaryDevice || null,
    gpuCompositing,
    rasterization,
  };
}

async function browserSnapshot(page, cdp, browserCdp = null) {
  const [version, navigatorInfo, systemInfo] = await Promise.all([
    cdp.send('Browser.getVersion').catch(() => null),
    page.evaluate(async () => {
      let battery = null;
      try {
        if (navigator.getBattery) {
          const value = await navigator.getBattery();
          battery = {
            source: 'navigator-informational-only',
            charging: value.charging,
            level: value.level,
            chargingTime: value.chargingTime,
            dischargingTime: value.dischargingTime,
          };
        }
      } catch (_) {}
      return {
        userAgent: navigator.userAgent,
        userAgentData: navigator.userAgentData ? {
          brands: navigator.userAgentData.brands,
          mobile: navigator.userAgentData.mobile,
          platform: navigator.userAgentData.platform,
        } : null,
        hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemoryGiB: navigator.deviceMemory || null,
        language: navigator.language,
        viewport: {
          width: innerWidth,
          height: innerHeight,
          deviceScaleFactor: devicePixelRatio,
          screenWidth: screen.width,
          screenHeight: screen.height,
          colorDepth: screen.colorDepth,
        },
        battery,
      };
    }),
    (browserCdp || cdp).send('SystemInfo.getInfo').catch(() => null),
  ]);
  const gpuClassification = classifyGpu(systemInfo);
  return {
    version,
    navigator: navigatorInfo,
    gpu: systemInfo ? {
      modelName: systemInfo.modelName || null,
      modelVersion: systemInfo.modelVersion || null,
      commandLine: systemInfo.commandLine || null,
      gpu: systemInfo.gpu || null,
      mode: gpuClassification.mode,
      classification: gpuClassification,
    } : null,
  };
}

/** Measure the display interval from rAF rather than assuming 60 Hz. */
async function measureRefreshInterval(page, samples = 60) {
  const sampleCount = Math.max(10, samples);
  const timeoutMs = Math.min(15_000, Math.max(3_000, sampleCount * 100));
  const values = await page.evaluate(({ count, deadlineMs }) => new Promise((resolve) => {
    const deltas = [];
    let previous = null;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(deltas);
    };
    const timeout = setTimeout(finish, deadlineMs);
    const tick = (now) => {
      if (settled) return;
      if (previous !== null) deltas.push(now - previous);
      previous = now;
      if (deltas.length >= count) finish();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), { count: sampleCount, deadlineMs: timeoutMs });
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  const intervalMs = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  return {
    samples: sorted.length,
    intervalMs,
    refreshRateHz: intervalMs ? 1000 / intervalMs : null,
  };
}

function gitSnapshot(repoRoot = process.cwd()) {
  return {
    commit: run('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }),
    branch: run('git', ['branch', '--show-current'], { cwd: repoRoot }),
    dirty: !!run('git', ['status', '--porcelain'], { cwd: repoRoot }),
  };
}

function makeEnvironmentKey(environment) {
  const stable = {
    platform: environment.host?.platform,
    osRelease: environment.host?.osRelease,
    cpu: environment.host?.cpuModel,
    logicalProcessors: environment.host?.logicalProcessors,
    browser: environment.browser?.version?.product,
    gpu: environment.browser?.gpu?.gpu?.devices,
    gpuMode: environment.browser?.gpu?.mode,
    gpuRenderer: environment.browser?.gpu?.classification?.renderer,
    viewport: environment.browser?.navigator?.viewport,
    powerSource: environment.power?.source,
    powerScheme: environment.power?.activeScheme?.guid,
    refreshRateHz: environment.display?.refreshRateHz ? Math.round(environment.display.refreshRateHz) : null,
  };
  return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex').slice(0, 16);
}

/** Build the manifest that prevents cross-device or cross-power comparisons. */
async function collectEnvironment(options) {
  const { page, cdp } = options;
  if (!page || !cdp) throw new TypeError('collectEnvironment requires page and cdp');
  const host = hostSnapshot();
  const power = readWindowsPowerTelemetry();
  if (!host.physicalCores && power.supported) {
    host.physicalCores = (power.processors || []).reduce((sum, item) => sum + (item.physicalCores || 0), 0) || null;
  }
  const environment = {
    capturedAt: new Date().toISOString(),
    host,
    browser: await browserSnapshot(page, cdp, options.browserCdp),
    power,
    display: options.measureRefreshRate === false ? null : await measureRefreshInterval(page, options.refreshSamples || 60),
    git: gitSnapshot(options.repoRoot),
    target: options.target || null,
  };
  environment.environmentKey = makeEnvironmentKey(environment);
  return environment;
}

/** Reject a run if its requested power source changed or was misidentified. */
function validatePowerState(before, after, expected = null) {
  const errors = [];
  const beforeSource = before?.source || 'unknown';
  const afterSource = after?.source || 'unknown';
  if (expected && beforeSource !== expected) errors.push(`expected ${expected}, started on ${beforeSource}`);
  if (beforeSource !== afterSource) errors.push(`power source changed from ${beforeSource} to ${afterSource}`);
  return { valid: errors.length === 0, before: beforeSource, after: afterSource, expected, errors };
}

function cpuTickSnapshot() {
  const cpus = os.cpus();
  const idle = cpus.reduce((sum, cpu) => sum + cpu.times.idle, 0);
  const total = cpus.reduce((sum, cpu) => sum + Object.values(cpu.times).reduce((inner, value) => inner + value, 0), 0);
  return { idle, total, averageClockMHz: cpus.length ? cpus.reduce((sum, cpu) => sum + cpu.speed, 0) / cpus.length : null };
}

/**
 * Start an optional ~2 Hz system sampler. On Windows it records the controlled
 * browser profile's working set plus CPU/GPU/battery data; all platforms also
 * collect CDP process CPU-time snapshots when a browser session is available.
 */
function createSystemSampler(options = {}) {
  const intervalMs = Math.max(250, Number(options.intervalMs || 500));
  const samples = [];
  const portableSamples = [];
  const cdpSamples = [];
  const errors = [];
  const windowsSampleWaiters = new Set();
  let child = null;
  let portableTimer = null;
  let cdpTimer = null;
  let remainder = '';
  let previousCpu = cpuTickSnapshot();

  if (process.platform === 'win32') {
    const script = path.join(__dirname, 'windows-sampler.ps1');
    child = spawn('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', script,
      '-IntervalMs', String(intervalMs),
      '-ProfileMarker', options.profileMarker || '',
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      const lines = `${remainder}${chunk}`.split(/\r?\n/);
      remainder = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          samples.push(JSON.parse(line));
          for (const notify of windowsSampleWaiters) notify();
        } catch (error) { errors.push(`sampler JSON: ${error.message}`); }
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { if (chunk.trim()) errors.push(chunk.trim()); });
    child.on('error', (error) => errors.push(error.message));
  }

  portableTimer = setInterval(() => {
    const current = cpuTickSnapshot();
    const totalDelta = current.total - previousCpu.total;
    const idleDelta = current.idle - previousCpu.idle;
    portableSamples.push({
      capturedAt: new Date().toISOString(),
      cpu: {
        loadPercent: totalDelta > 0 ? ((totalDelta - idleDelta) / totalDelta) * 100 : null,
        currentClockMHz: current.averageClockMHz,
      },
      memory: { totalBytes: os.totalmem(), freeBytes: os.freemem() },
    });
    previousCpu = current;
  }, intervalMs);
  portableTimer.unref?.();

  const processCdp = options.browserCdp || options.cdp;
  if (processCdp) {
    let pending = false;
    cdpTimer = setInterval(async () => {
      if (pending) return;
      pending = true;
      try {
        const result = await processCdp.send('SystemInfo.getProcessInfo');
        cdpSamples.push({ capturedAt: new Date().toISOString(), processInfo: result.processInfo || [] });
      } catch (error) {
        errors.push(`CDP process sampler: ${error.message}`);
        clearInterval(cdpTimer);
        cdpTimer = null;
      } finally {
        pending = false;
      }
    }, intervalMs);
    cdpTimer.unref?.();
  }

  return {
    snapshot() {
      return {
        intervalMs,
        samples: samples.slice(),
        portableSamples: portableSamples.slice(),
        cdpSamples: cdpSamples.slice(),
        errors: errors.slice(),
      };
    },
    async waitForWindowsSamples(minimum = 1, timeoutMs = 15_000) {
      const required = Math.max(1, Number(minimum) || 1);
      const deadline = Math.max(1, Number(timeoutMs) || 15_000);
      if (samples.length >= required) return this.snapshot();
      await new Promise((resolve, reject) => {
        let settled = false;
        const finish = (callback, value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          windowsSampleWaiters.delete(check);
          callback(value);
        };
        const check = () => {
          if (samples.length >= required) finish(resolve);
        };
        const timer = setTimeout(() => finish(
          reject,
          new Error(
            `Windows power sampler did not produce ${required} sample(s) within ${deadline}ms`
              + (errors.length ? `: ${errors.join('; ')}` : ''),
          ),
        ), deadline);
        windowsSampleWaiters.add(check);
        check();
      });
      return this.snapshot();
    },
    async stop() {
      if (portableTimer) clearInterval(portableTimer);
      if (cdpTimer) clearInterval(cdpTimer);
      if (child && child.exitCode === null) {
        await new Promise((resolve) => {
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            resolve();
          };
          const timeout = setTimeout(finish, 2000);
          child.once('close', finish);
          child.kill();
        });
      }
      if (remainder.trim()) {
        try { samples.push(JSON.parse(remainder)); } catch (_) {}
        remainder = '';
      }
      return this.snapshot();
    },
  };
}

module.exports = {
  browserSnapshot,
  classifyGpu,
  collectEnvironment,
  createSystemSampler,
  gitSnapshot,
  hostSnapshot,
  makeEnvironmentKey,
  measureRefreshInterval,
  readWindowsPowerTelemetry,
  validatePowerState,
};
