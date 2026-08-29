'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { readNdjson } = require('./lib/artifacts');
const { comparisonKey } = require('./lib/schema');
const { flattenLeaves, loadBudgets, patternRegex } = require('./lib/budgets');
const { change, median, percentile, summarize } = require('./lib/stats');

const DEFAULT_BOOTSTRAP_ITERATIONS = 2_000;
const MAX_BOOTSTRAP_ITERATIONS = 100_000;

function numericMetrics(record) {
  const metrics = flattenLeaves(record.metrics || {}, 'metrics')
    .filter((entry) => Number.isFinite(entry.value) && !/(^|\.)\d+(\.|$)/.test(entry.path));
  // Measured phases are stored as an array. Give named phase values stable paths
  // while continuing to ignore arbitrary numeric arrays such as raw frame samples.
  for (const phase of Array.isArray(record.metrics?.phases) ? record.metrics.phases : []) {
    if (!phase || typeof phase !== 'object' || typeof phase.name !== 'string') continue;
    const phaseName = phase.name.trim().replace(/[^a-zA-Z0-9_-]+/g, '-');
    if (!phaseName) continue;
    metrics.push(...flattenLeaves(phase, `metrics.phases.${phaseName}`)
      .filter((entry) => Number.isFinite(entry.value) && !/(^|\.)\d+(\.|$)/.test(entry.path)));
  }
  return metrics;
}

function powerAgnosticEnvironmentKey(record) {
  const environment = record?.environment || record?.metadata?.environment;
  if (!environment || typeof environment !== 'object') return null;
  // Keep this in lockstep with makeEnvironmentKey(). A power-axis comparison
  // may remove the measured source, but it must not erase any other part of
  // the strict environment identity (especially the active GPU renderer).
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
    powerScheme: environment.power?.activeScheme?.guid,
    refreshRateHz: environment.display?.refreshRateHz
      ? Math.round(environment.display.refreshRateHz)
      : null,
  };
  const hasStrictIdentity = stable.platform
    && stable.osRelease
    && stable.cpu
    && Number.isFinite(Number(stable.logicalProcessors))
    && Number(stable.logicalProcessors) > 0
    && stable.browser
    && Array.isArray(stable.gpu)
    && stable.gpu.length > 0
    && stable.gpuMode
    && stable.gpuMode !== 'unknown'
    && stable.gpuRenderer
    && Number.isFinite(Number(stable.viewport?.width))
    && Number(stable.viewport.width) > 0
    && Number.isFinite(Number(stable.viewport?.height))
    && Number(stable.viewport.height) > 0
    && stable.powerScheme
    && Number.isFinite(stable.refreshRateHz)
    && stable.refreshRateHz > 0;
  if (!hasStrictIdentity) return null;
  return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex').slice(0, 16);
}

function recordComparisonKey(record, options) {
  if (!options.allowPowerDifference) return { key: comparisonKey(record), powerAxisFallback: false };
  const environmentKey = powerAgnosticEnvironmentKey(record);
  if (!environmentKey) return { key: null, powerAxisFallback: true };
  return {
    key: comparisonKey({
      ...record,
      environmentKey,
      environment: {
        ...(record.environment || {}),
        power: { ...(record.environment?.power || {}), source: 'power-axis' },
      },
      metadata: { ...(record.metadata || {}), powerSource: 'power-axis' },
    }),
    powerAxisFallback: false,
  };
}

function normalizedPowerSource(value) {
  const source = String(value || '').trim().toLowerCase();
  return source === 'ac' || source === 'battery' ? source : null;
}

function stablePowerAxisSource(record) {
  const metadata = record?.metadata || {};
  const validation = metadata.powerValidation;
  const sampled = validation?.sampled;
  const evidence = [
    ['record metadata', metadata.powerSource],
    ['captured environment', record?.environment?.power?.source || metadata.environment?.power?.source],
    ['power-before snapshot', metadata.powerBefore?.source],
    ['power-after snapshot', metadata.powerAfter?.source],
    ['validation start', validation?.before],
    ['validation end', validation?.after],
    ...((sampled?.observedSources || []).map((source) => ['sampled power', source])),
  ];
  const errors = [];
  if (!validation || validation.valid !== true) {
    errors.push('powerValidation.valid was not explicitly true');
  }
  if (!sampled || sampled.sourceValid !== true || sampled.samplingAvailable !== true) {
    errors.push('stable sampled power evidence was unavailable');
  }
  if (!Array.isArray(sampled?.observedSources) || sampled.observedSources.length === 0) {
    errors.push('no sampled power sources were recorded');
  }
  const sources = [];
  for (const [label, value] of evidence) {
    const source = normalizedPowerSource(value);
    if (!source) errors.push(`${label} did not identify AC or battery power`);
    else sources.push(source);
  }
  const distinctSources = distinct(sources);
  if (distinctSources.length !== 1) {
    errors.push(`power evidence was not stable (${distinctSources.join(', ') || 'unknown'})`);
  }
  return {
    valid: errors.length === 0,
    source: distinctSources.length === 1 ? distinctSources[0] : null,
    errors,
  };
}

function firstFinite(...values) {
  return values.find(Number.isFinite) ?? null;
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function batteryPercent(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const reported = Array.isArray(snapshot.batteries)
    ? snapshot.batteries.map((battery) => finiteNumber(battery?.estimatedChargeRemaining)).find(Number.isFinite)
    : null;
  return firstFinite(
    reported,
    finiteNumber(snapshot.batteryPercent),
    Number.isFinite(snapshot.level) ? snapshot.level * 100 : null,
  );
}

function gpuSummary(environment, record) {
  const names = [];
  const power = record?.metadata?.powerBefore || environment?.power || {};
  for (const gpu of power.gpus || []) {
    if (gpu?.name) names.push(String(gpu.name));
  }
  const devices = (environment?.browser?.gpu?.gpu?.devices || record?.metadata?.gpu?.devices || [])
    .slice(0, 4)
    .map((device) => ({
      vendor: device?.vendorString || device?.vendorId || null,
      device: device?.deviceString || device?.deviceId || null,
      driverVersion: device?.driverVersion || null,
    }));
  return {
    names: Array.from(new Set(names)),
    browserDevices: devices,
    mode: environment?.browser?.gpu?.mode || record?.metadata?.gpuValidation?.mode || 'unknown',
    renderer: environment?.browser?.gpu?.classification?.renderer || null,
  };
}

function compactEnvironment(record) {
  const environment = record?.environment || record?.metadata?.environment || {};
  const host = environment.host || record?.metadata?.system?.host || {};
  const power = record?.metadata?.powerBefore || environment.power || {};
  const powerAfter = record?.metadata?.powerAfter || {};
  const processorPhysicalCores = (power.processors || [])
    .reduce((total, processor) => total + (Number(processor?.physicalCores) || 0), 0);
  const startStatus = power.batteryStatus?.[0] || {};
  const endStatus = powerAfter.batteryStatus?.[0] || {};
  return {
    environmentKey: record?.environmentKey || null,
    host: {
      platform: host.platform || null,
      architecture: host.architecture || null,
      osRelease: host.osRelease || null,
    },
    cpu: {
      model: host.cpuModel || power.processors?.[0]?.name || record?.metadata?.cpuModel || null,
      physicalCores: firstFinite(finiteNumber(host.physicalCores), processorPhysicalCores || null),
      logicalProcessors: firstFinite(
        finiteNumber(host.logicalProcessors),
        finiteNumber(power.processors?.[0]?.logicalProcessors),
        finiteNumber(record?.metadata?.logicalProcessors),
      ),
    },
    gpu: gpuSummary(environment, record),
    browser: {
      id: record?.browser?.id || record?.browser?.name || null,
      version: record?.browser?.version || environment?.browser?.version?.product || null,
    },
    display: {
      refreshRateHz: firstFinite(finiteNumber(environment?.display?.refreshRateHz)),
    },
    power: {
      source: record?.metadata?.powerSource || power.source || 'unknown',
      startBatteryPercent: batteryPercent(power),
      endBatteryPercent: batteryPercent(powerAfter),
      batteryPercent: firstFinite(batteryPercent(powerAfter), batteryPercent(power)),
      charging: endStatus.charging ?? startStatus.charging ?? null,
      discharging: endStatus.discharging ?? startStatus.discharging ?? null,
      powerOnline: endStatus.powerOnline ?? startStatus.powerOnline ?? null,
      schemeGuid: power.activeScheme?.guid || powerAfter.activeScheme?.guid || null,
    },
  };
}

function distinct(values) {
  return Array.from(new Set(values.filter((value) => value !== undefined && value !== null)));
}

function compactRange(values) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return { min: null, median: null, max: null };
  return { min: Math.min(...finite), median: median(finite), max: Math.max(...finite) };
}

function summarizeGroupEnvironment(group) {
  const summaries = group.environmentSummaries;
  const first = summaries[0] || compactEnvironment({});
  const sources = distinct(summaries.map((summary) => summary.power.source));
  return {
    environmentKeys: distinct(summaries.map((summary) => summary.environmentKey)),
    host: first.host,
    cpu: first.cpu,
    gpu: first.gpu,
    browser: first.browser,
    display: first.display,
    power: {
      source: sources.length === 1 ? sources[0] : null,
      sources,
      batteryPercent: compactRange(summaries.map((summary) => summary.power.batteryPercent)),
      startBatteryPercent: compactRange(summaries.map((summary) => summary.power.startBatteryPercent)),
      endBatteryPercent: compactRange(summaries.map((summary) => summary.power.endBatteryPercent)),
      chargingStates: distinct(summaries.map((summary) => summary.power.charging)),
      dischargingStates: distinct(summaries.map((summary) => summary.power.discharging)),
      powerOnlineStates: distinct(summaries.map((summary) => summary.power.powerOnline)),
      schemeGuids: distinct(summaries.map((summary) => summary.power.schemeGuid)),
    },
  };
}

function collectGroups(records, options = {}) {
  const groups = new Map();
  const excluded = [];
  const powerAxisFallbacks = [];
  const powerAxisInvalids = [];
  for (const record of records.filter((item) => item.status === 'passed')) {
    if (options.requireEnvironment && !record.environmentKey) {
      excluded.push({
        runId: record.runId || null,
        scenarioId: record.scenarioId || null,
        iteration: record.iteration,
        reason: 'missing environmentKey',
      });
      continue;
    }
    let powerAxisState = null;
    if (options.allowPowerDifference) {
      powerAxisState = stablePowerAxisSource(record);
      if (!powerAxisState.valid) {
        powerAxisInvalids.push({
          runId: record.runId || null,
          scenarioId: record.scenarioId || null,
          iteration: record.iteration,
          reason: 'power-axis comparison requires known, stable AC or battery samples',
          errors: powerAxisState.errors,
        });
        continue;
      }
    }
    const keyResult = recordComparisonKey(record, options);
    const key = keyResult.key;
    if (keyResult.powerAxisFallback) {
      powerAxisFallbacks.push({
        runId: record.runId || null,
        scenarioId: record.scenarioId || null,
        iteration: record.iteration,
        reason: 'power-axis comparison requires the complete strict environment artifact',
      });
      continue;
    }
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        records: 0,
        metrics: new Map(),
        environmentSummaries: [],
        powerSources: new Set(),
      });
    }
    const group = groups.get(key);
    group.records += 1;
    group.environmentSummaries.push(compactEnvironment(record));
    if (powerAxisState?.source) group.powerSources.add(powerAxisState.source);
    for (const metric of numericMetrics(record)) {
      if (!group.metrics.has(metric.path)) group.metrics.set(metric.path, []);
      group.metrics.get(metric.path).push(metric.value);
    }
  }
  return { groups, excluded, powerAxisFallbacks, powerAxisInvalids };
}

function publicGroup(group) {
  return {
    key: group.key,
    records: group.records,
    metrics: Object.fromEntries(
      Array.from(group.metrics.entries()).map(([metric, values]) => [metric, summarize(values)]),
    ),
  };
}

/** Aggregate repeated iteration records by environment/scenario and metric. */
function summarizeRun(records) {
  return Array.from(collectGroups(records).groups.values()).map(publicGroup);
}

function normalizeMode(mode, config) {
  const selected = mode || config.defaultMode || 'advisory';
  if (selected === 'gating') return 'enforce';
  if (!['advisory', 'enforce'].includes(selected)) {
    throw new Error(`unsupported comparison mode: ${selected}`);
  }
  return selected;
}

function normalizeBootstrapIterations(value) {
  const iterations = value === undefined ? DEFAULT_BOOTSTRAP_ITERATIONS : Number(value);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_BOOTSTRAP_ITERATIONS) {
    throw new RangeError(`bootstrap iterations must be an integer between 1 and ${MAX_BOOTSTRAP_ITERATIONS}`);
  }
  return iterations;
}

function stableSeed(value) {
  return crypto.createHash('sha256').update(String(value)).digest().readUInt32LE(0);
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function bootstrapMedian(values, random) {
  const sample = new Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    sample[index] = values[Math.floor(random() * values.length)];
  }
  return median(sample);
}

function aggregate(values, reducer) {
  if (!values.length) return null;
  if (!reducer || reducer === 'none') return values[0];
  if (reducer === 'max') return Math.max(...values);
  if (reducer === 'min') return Math.min(...values);
  if (reducer === 'sum') return values.reduce((total, value) => total + value, 0);
  if (reducer === 'median') return median(values);
  if (reducer === 'p95') return percentile(values, 0.95);
  throw new Error(`unsupported comparison aggregate: ${reducer}`);
}

function comparisonChange(baseline, candidate) {
  const delta = change(baseline, candidate);
  if (baseline !== 0 || candidate === 0) return delta;
  const relative = candidate > 0 ? Infinity : -Infinity;
  return { ...delta, relative, percent: relative };
}

function interval(values) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return { lower: null, upper: null };
  return {
    lower: percentile(finite, 0.025),
    upper: percentile(finite, 0.975),
  };
}

function bootstrapChange(baselineGroup, candidateGroup, paths, aggregateName, iterations, seedKey) {
  const seed = stableSeed(seedKey);
  const random = seededRandom(seed);
  const absoluteChanges = [];
  const relativeChanges = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const baseline = aggregate(
      paths.map((metricPath) => bootstrapMedian(baselineGroup.metrics.get(metricPath), random)),
      aggregateName,
    );
    const candidate = aggregate(
      paths.map((metricPath) => bootstrapMedian(candidateGroup.metrics.get(metricPath), random)),
      aggregateName,
    );
    const delta = comparisonChange(baseline, candidate);
    absoluteChanges.push(delta.absolute);
    if (Number.isFinite(delta.relative)) relativeChanges.push(delta.relative);
  }
  const absolute = interval(absoluteChanges);
  const relative = interval(relativeChanges);
  return {
    confidenceLevel: 0.95,
    iterations,
    seed,
    absoluteChange: absolute,
    relativeChange: relative,
    percentChange: {
      lower: Number.isFinite(relative.lower) ? relative.lower * 100 : null,
      upper: Number.isFinite(relative.upper) ? relative.upper * 100 : null,
    },
  };
}

function regressionOutcome(baseline, candidate, rule) {
  const direction = rule.direction || 'increase';
  const signedAbsolute = direction === 'decrease' ? baseline - candidate : candidate - baseline;
  const signedRelative = baseline === 0
    ? (signedAbsolute === 0 ? 0 : (signedAbsolute > 0 ? Infinity : -Infinity))
    : signedAbsolute / Math.abs(baseline);
  const hasAbsolute = Number.isFinite(rule.absoluteThreshold);
  const hasRelative = Number.isFinite(rule.relativeThreshold);
  const exceedsAbsolute = hasAbsolute ? signedAbsolute > rule.absoluteThreshold : true;
  const exceedsRelative = hasRelative ? signedRelative > rule.relativeThreshold : true;
  return {
    regressed: (hasAbsolute || hasRelative) && exceedsAbsolute && exceedsRelative,
    direction,
    exceedsAbsolute,
    exceedsRelative,
  };
}

function ruleMetricSets(rule, baselineGroup, candidateGroup) {
  const expression = patternRegex(rule.path || rule.metric);
  const baselinePaths = new Set(Array.from(baselineGroup.metrics.keys()).filter((metric) => expression.test(metric)));
  const paths = Array.from(candidateGroup.metrics.keys())
    .filter((metric) => expression.test(metric) && baselinePaths.has(metric))
    .sort();
  if (!paths.length) return [];
  if (rule.aggregate && rule.aggregate !== 'none') return [paths];
  return paths.map((metric) => [metric]);
}

function evaluateComparisonRules(baselineGroups, candidateGroups, rules, options) {
  const results = [];
  for (const [key, candidateGroup] of candidateGroups) {
    const baselineGroup = baselineGroups.get(key);
    if (!baselineGroup) continue;
    for (const rule of rules) {
      if ((rule.comparator || 'regression') !== 'regression') continue;
      for (const paths of ruleMetricSets(rule, baselineGroup, candidateGroup)) {
        const aggregateName = rule.aggregate || null;
        const baseline = aggregate(paths.map((metric) => median(baselineGroup.metrics.get(metric))), aggregateName);
        const candidate = aggregate(paths.map((metric) => median(candidateGroup.metrics.get(metric))), aggregateName);
        const delta = comparisonChange(baseline, candidate);
        const outcome = regressionOutcome(baseline, candidate, rule);
        const metric = aggregateName
          ? `${rule.path || rule.metric}:<${aggregateName}>`
          : paths[0];
        const severity = rule.severity || 'gate';
        const blocking = options.mode === 'enforce'
          && outcome.regressed
          && (severity === 'gate' || severity === 'hard');
        results.push({
          key,
          ruleId: rule.id || rule.path || rule.metric,
          metric,
          matchedMetrics: paths,
          aggregate: aggregateName,
          severity,
          status: outcome.regressed ? 'failed' : 'passed',
          blocking,
          direction: outcome.direction,
          baselineMedian: baseline,
          candidateMedian: candidate,
          absoluteChange: delta.absolute,
          relativeChange: delta.relative,
          percentChange: delta.percent,
          change: delta,
          thresholds: {
            absolute: Number.isFinite(rule.absoluteThreshold) ? rule.absoluteThreshold : null,
            relative: Number.isFinite(rule.relativeThreshold) ? rule.relativeThreshold : null,
            percent: Number.isFinite(rule.relativeThreshold) ? rule.relativeThreshold * 100 : null,
          },
          thresholdCrossings: {
            absolute: outcome.exceedsAbsolute,
            relative: outcome.exceedsRelative,
          },
          bootstrap95CI: bootstrapChange(
            baselineGroup,
            candidateGroup,
            paths,
            aggregateName,
            options.bootstrapIterations,
            `${key}|${rule.id || rule.path}|${metric}`,
          ),
        });
      }
    }
  }
  return results;
}

function validatePowerAxisPair(key, baselineGroup, candidateGroup) {
  const baselineSources = Array.from(baselineGroup.powerSources || []);
  const candidateSources = Array.from(candidateGroup.powerSources || []);
  const valid = baselineSources.length === 1
    && candidateSources.length === 1
    && baselineSources[0] !== candidateSources[0]
    && new Set([...baselineSources, ...candidateSources]).size === 2;
  return {
    key,
    valid,
    baselineSources,
    candidateSources,
    reason: valid ? null : 'power-axis groups must be stable, opposite AC and battery populations',
  };
}

/** Compare medians only inside exact matching scenario/environment groups. */
function compareRuns(baselineRecords, candidateRecords, options = {}) {
  const config = options.config || options.budgets || loadBudgets();
  const mode = normalizeMode(options.mode, config);
  const bootstrapIterations = normalizeBootstrapIterations(
    options.bootstrapIterations === undefined ? options.bootstrap : options.bootstrapIterations,
  );
  const requireEnvironment = config.requireSameEnvironment !== false;
  const allowPowerDifference = Boolean(options.allowPowerDifference || options.axis === 'power');
  const collectionOptions = { requireEnvironment, allowPowerDifference };
  const baselineCollection = collectGroups(baselineRecords, collectionOptions);
  const candidateCollection = collectGroups(candidateRecords, collectionOptions);
  const baseline = baselineCollection.groups;
  const candidate = candidateCollection.groups;
  const commonKeys = Array.from(candidate.keys()).filter((key) => baseline.has(key));
  const rejectedPowerAxisGroups = allowPowerDifference
    ? commonKeys
      .map((key) => validatePowerAxisPair(key, baseline.get(key), candidate.get(key)))
      .filter((item) => !item.valid)
    : [];
  const rejectedPowerAxisKeys = new Set(rejectedPowerAxisGroups.map((item) => item.key));
  const matchingKeys = commonKeys.filter((key) => !rejectedPowerAxisKeys.has(key));
  const comparisonBaseline = new Map(matchingKeys.map((key) => [key, baseline.get(key)]));
  const comparisonCandidate = new Map(matchingKeys.map((key) => [key, candidate.get(key)]));
  const comparisons = [];
  for (const [key, candidateGroup] of comparisonCandidate) {
    const baselineGroup = comparisonBaseline.get(key);
    for (const [metric, candidateValues] of candidateGroup.metrics) {
      const baselineValues = baselineGroup.metrics.get(metric);
      if (!baselineValues) continue;
      const baselineStats = summarize(baselineValues);
      const candidateStats = summarize(candidateValues);
      comparisons.push({
        key,
        metric,
        baseline: baselineStats,
        candidate: candidateStats,
        change: comparisonChange(baselineStats.median, candidateStats.median),
      });
    }
  }
  const comparisonRules = config.comparisonRules || [];
  const budgetComparisons = evaluateComparisonRules(
    comparisonBaseline,
    comparisonCandidate,
    comparisonRules,
    { mode, bootstrapIterations },
  );
  const regressions = budgetComparisons.filter((item) => item.status === 'failed');
  const blockingRegressions = budgetComparisons.filter((item) => item.blocking);
  const matchedEnvironmentSummaries = matchingKeys.map((key) => ({
    key,
    baseline: {
      records: comparisonBaseline.get(key).records,
      ...summarizeGroupEnvironment(comparisonBaseline.get(key)),
    },
    candidate: {
      records: comparisonCandidate.get(key).records,
      ...summarizeGroupEnvironment(comparisonCandidate.get(key)),
    },
  }));
  const warnings = [];
  if (baselineCollection.excluded.length || candidateCollection.excluded.length) {
    warnings.push('Passed iterations without an environmentKey were excluded from comparison.');
  }
  if (allowPowerDifference
      && (baselineCollection.powerAxisFallbacks.length || candidateCollection.powerAxisFallbacks.length)) {
    warnings.push('Some iterations lacked complete strict environment details and were excluded from the power-axis comparison.');
  }
  if (allowPowerDifference
      && (baselineCollection.powerAxisInvalids.length || candidateCollection.powerAxisInvalids.length)) {
    warnings.push('Some iterations lacked known, stable AC/battery evidence and were excluded from the power-axis comparison.');
  }
  if (rejectedPowerAxisGroups.length) {
    warnings.push('Some matched hardware groups were excluded because they did not contain opposite stable AC and battery populations.');
  }
  if (!matchingKeys.length) warnings.push('No environment-compatible scenario groups were available for comparison.');
  const evaluatedRuleIds = distinct(budgetComparisons.map((item) => item.ruleId));
  const ruleEvaluationUnavailable = mode === 'enforce'
    && matchingKeys.length > 0
    && budgetComparisons.length === 0;
  if (ruleEvaluationUnavailable) {
    warnings.push('Enforced comparison had matching groups, but no configured comparison rule could be evaluated.');
  }
  const comparisonUnavailable = mode === 'enforce'
    && (matchingKeys.length === 0 || ruleEvaluationUnavailable);
  return {
    mode,
    passed: blockingRegressions.length === 0 && !comparisonUnavailable,
    comparable: matchingKeys.length > 0,
    comparisonUnavailable,
    bootstrapIterations,
    baselineGroups: baseline.size,
    candidateGroups: candidate.size,
    matchedGroups: new Set(comparisons.map((item) => item.key)).size,
    comparableGroups: matchingKeys.length,
    unmatchedBaselineGroups: Array.from(baseline.keys()).filter((key) => !candidate.has(key)),
    unmatchedCandidateGroups: Array.from(candidate.keys()).filter((key) => !baseline.has(key)),
    environmentSafety: {
      requireSameEnvironment: requireEnvironment,
      axis: allowPowerDifference ? 'power' : 'strict',
      excludedBaselineIterations: baselineCollection.excluded,
      excludedCandidateIterations: candidateCollection.excluded,
      powerAxisFallbackBaselineIterations: baselineCollection.powerAxisFallbacks,
      powerAxisFallbackCandidateIterations: candidateCollection.powerAxisFallbacks,
      invalidPowerAxisBaselineIterations: baselineCollection.powerAxisInvalids,
      invalidPowerAxisCandidateIterations: candidateCollection.powerAxisInvalids,
      rejectedPowerAxisGroups,
    },
    matchedEnvironmentSummaries,
    warnings,
    comparisons,
    budgetComparisons,
    regressions,
    blockingRegressions,
    comparisonRuleEvaluation: {
      configured: comparisonRules.length,
      evaluated: budgetComparisons.length,
      evaluatedRuleIds,
      unavailable: ruleEvaluationUnavailable,
    },
    budgetSummary: {
      total: budgetComparisons.length,
      passed: budgetComparisons.length - regressions.length,
      regressed: regressions.length,
      blocking: blockingRegressions.length,
    },
  };
}

function loadRecords(inputPath) {
  const resolved = path.resolve(inputPath);
  const file = fs.statSync(resolved).isDirectory() ? path.join(resolved, 'iterations.ndjson') : resolved;
  let records;
  if (file.endsWith('.ndjson')) records = readNdjson(file);
  else {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    records = Array.isArray(value) ? value : value.iterations || value.records || [];
  }
  const environmentDirectory = path.join(path.dirname(file), 'system', 'environments');
  if (!fs.existsSync(environmentDirectory)) return records;
  const environments = new Map();
  for (const entry of fs.readdirSync(environmentDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || path.extname(entry.name) !== '.json') continue;
    const environment = JSON.parse(fs.readFileSync(path.join(environmentDirectory, entry.name), 'utf8'));
    const key = environment.environmentKey || path.basename(entry.name, '.json');
    environments.set(key, environment);
  }
  return records.map((record) => ({
    ...record,
    environment: record.environment || environments.get(record.environmentKey) || null,
  }));
}

function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === '--help' || name === '-h') result.help = true;
    else if (name === '--base') result.base = argv[++index];
    else if (name === '--candidate') result.candidate = argv[++index];
    else if (name === '--out') result.out = argv[++index];
    else if (name === '--mode') result.mode = argv[++index];
    else if (name === '--bootstrap') result.bootstrapIterations = argv[++index];
    else if (name === '--allow-power-difference') result.allowPowerDifference = true;
    else if (name === '--axis') result.axis = argv[++index];
    else if (name === '--enforce') result.mode = 'enforce';
    else if (name === '--advisory') result.mode = 'advisory';
    else throw new Error(`unknown compare option: ${name}`);
  }
  if (!result.help && (!result.base || !result.candidate)) {
    throw new Error('Usage: node tests/perf/compare.js --base <run> --candidate <run> [--mode advisory|enforce] [--bootstrap iterations] [--axis power] [--out file]');
  }
  if (result.axis && result.axis !== 'power') throw new Error(`unsupported comparison axis: ${result.axis}`);
  return result;
}

function runCli(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    process.stdout.write([
      'Usage: node tests/perf/compare.js --base <run> --candidate <run> [options]',
      '',
      '  --mode advisory|enforce',
      '  --bootstrap <iterations>',
      '  --axis power',
      '  --out <file>',
      '',
    ].join('\n'));
    return 0;
  }
  const result = compareRuns(loadRecords(options.base), loadRecords(options.candidate), options);
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (options.out) {
    const destination = path.resolve(options.out);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, json, 'utf8');
  } else {
    process.stdout.write(json);
  }
  if (result.comparisonUnavailable) return 2;
  return result.passed ? 0 : 1;
}

if (require.main === module) {
  try {
    process.exitCode = runCli();
  } catch (error) {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  compareRuns,
  loadRecords,
  numericMetrics,
  parseArguments,
  runCli,
  summarizeRun,
};
