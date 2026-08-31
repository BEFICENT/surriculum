'use strict';

const { round, summarize } = require('./stats');
const { readWindowsPowerTelemetry } = require('./system-info');

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

module.exports = {
  attachSystemSamplesToPhases,
  batteryPercentage,
  validateIterationPower,
  validateSampledPower,
  waitForRequestedPower,
};
