'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { median, percentile } = require('./stats');

function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function patternRegex(pattern) {
  const placeholder = '\u0000';
  const source = escapeRegex(pattern)
    .replace(/\*\*/g, placeholder)
    .replace(/\*/g, '[^.]+')
    .replace(new RegExp(placeholder, 'g'), '.*');
  return new RegExp(`^${source}$`);
}

function flattenLeaves(value, prefix = '', output = []) {
  if (value === null || value === undefined || typeof value !== 'object') {
    if (prefix) output.push({ path: prefix, value });
    return output;
  }
  const entries = Array.isArray(value) ? value.map((item, index) => [String(index), item]) : Object.entries(value);
  if (!entries.length && prefix) output.push({ path: prefix, value });
  for (const [key, child] of entries) flattenLeaves(child, prefix ? `${prefix}.${key}` : key, output);
  return output;
}

function getPath(source, dottedPath) {
  return String(dottedPath).split('.').reduce((value, key) => (value == null ? undefined : value[key]), source);
}

function resolveMatches(source, metricPath) {
  if (!metricPath.includes('*')) {
    const value = getPath(source, metricPath);
    return value === undefined ? [] : [{ path: metricPath, value }];
  }
  const regex = patternRegex(metricPath);
  return flattenLeaves(source).filter((entry) => regex.test(entry.path));
}

function aggregateMatches(matches, aggregate) {
  if (!aggregate || aggregate === 'none') return matches;
  if (aggregate === 'count') {
    if (matches.length === 1 && Array.isArray(matches[0].value)) {
      return [{ path: matches[0].path, value: matches[0].value.length }];
    }
    return [{ path: '<count>', value: matches.length }];
  }
  const values = matches.map((entry) => entry.value).filter(Number.isFinite);
  if (!values.length) return [];
  const reducers = {
    max: () => Math.max(...values),
    min: () => Math.min(...values),
    sum: () => values.reduce((sum, value) => sum + value, 0),
    median: () => median(values),
    p95: () => percentile(values, 0.95),
  };
  if (!reducers[aggregate]) throw new Error(`unsupported budget aggregate: ${aggregate}`);
  return [{ path: `<${aggregate}>`, value: reducers[aggregate]() }];
}

function compareValue(candidate, comparator, expected) {
  if (comparator === 'exists') return candidate !== undefined && candidate !== null;
  if (comparator === 'empty') return candidate == null || candidate.length === 0;
  if (comparator === 'eq') return candidate === expected;
  if (comparator === 'neq') return candidate !== expected;
  if (!Number.isFinite(candidate) || !Number.isFinite(expected)) return false;
  if (comparator === 'lte') return candidate <= expected;
  if (comparator === 'lt') return candidate < expected;
  if (comparator === 'gte') return candidate >= expected;
  if (comparator === 'gt') return candidate > expected;
  throw new Error(`unsupported budget comparator: ${comparator}`);
}

function regressionResult(candidate, baseline, rule) {
  if (!Number.isFinite(candidate) || !Number.isFinite(baseline)) {
    return { passed: false, absoluteChange: null, relativeChange: null, reason: 'values are not finite numbers' };
  }
  const direction = rule.direction || 'increase';
  const signedAbsolute = direction === 'decrease' ? baseline - candidate : candidate - baseline;
  const signedRelative = baseline === 0 ? null : signedAbsolute / Math.abs(baseline);
  const hasAbsolute = Number.isFinite(rule.absoluteThreshold);
  const hasRelative = Number.isFinite(rule.relativeThreshold);
  const exceedsAbsolute = hasAbsolute ? signedAbsolute > rule.absoluteThreshold : true;
  const exceedsRelative = hasRelative ? signedRelative !== null && signedRelative > rule.relativeThreshold : true;
  const regressed = (hasAbsolute || hasRelative) && exceedsAbsolute && exceedsRelative;
  return {
    passed: !regressed,
    absoluteChange: candidate - baseline,
    relativeChange: baseline === 0 ? null : (candidate - baseline) / Math.abs(baseline),
    reason: regressed ? `exceeded ${hasRelative ? `${rule.relativeThreshold * 100}%` : ''}${hasAbsolute && hasRelative ? ' and ' : ''}${hasAbsolute ? rule.absoluteThreshold : ''}` : null,
  };
}

function missingResult(rule, metricPath) {
  const behavior = rule.missing || 'skip';
  return {
    id: rule.id,
    metric: metricPath,
    severity: rule.severity || 'gate',
    status: behavior === 'fail' ? 'failed' : behavior === 'pass' ? 'passed' : 'skipped',
    blocking: false,
    reason: `metric is missing (${behavior})`,
  };
}

function evaluateRule(rule, candidate, baseline) {
  const metricPath = rule.path || rule.metric;
  if (!metricPath) throw new TypeError(`budget ${rule.id || '<unnamed>'} has no path`);
  const candidateMatches = aggregateMatches(resolveMatches(candidate, metricPath), rule.aggregate);
  if (!candidateMatches.length) return [missingResult(rule, metricPath)];
  const baselineMatches = baseline ? aggregateMatches(resolveMatches(baseline, metricPath), rule.aggregate) : [];
  const baselineByPath = new Map(baselineMatches.map((entry) => [entry.path, entry.value]));
  return candidateMatches.map((entry, index) => {
    const severity = rule.severity || 'gate';
    if (rule.comparator === 'regression') {
      const baselineEntry = baselineByPath.has(entry.path) ? baselineByPath.get(entry.path) : baselineMatches[index]?.value;
      if (baselineEntry === undefined) return missingResult(rule, `${metricPath}:${entry.path}:baseline`);
      const outcome = regressionResult(entry.value, baselineEntry, rule);
      return {
        id: rule.id,
        metric: entry.path,
        severity,
        status: outcome.passed ? 'passed' : 'failed',
        blocking: false,
        candidate: entry.value,
        baseline: baselineEntry,
        absoluteChange: outcome.absoluteChange,
        relativeChange: outcome.relativeChange,
        reason: outcome.reason,
      };
    }
    const passed = compareValue(entry.value, rule.comparator || 'lte', rule.value);
    return {
      id: rule.id,
      metric: entry.path,
      severity,
      status: passed ? 'passed' : 'failed',
      blocking: false,
      candidate: entry.value,
      expected: rule.value,
      reason: passed ? null : `${entry.value} does not satisfy ${rule.comparator || 'lte'} ${rule.value}`,
    };
  });
}

function normalizeArguments(candidateOrOptions, config, options) {
  if (candidateOrOptions && candidateOrOptions.candidate && !config) {
    return {
      candidate: candidateOrOptions.candidate,
      baseline: candidateOrOptions.baseline,
      config: candidateOrOptions.config,
      mode: candidateOrOptions.mode,
    };
  }
  return { candidate: candidateOrOptions, baseline: options?.baseline, config, mode: options?.mode };
}

/**
 * Evaluate hard invariants and timing budgets.
 * In advisory mode only `hard` failures block; in gating mode both `hard` and
 * `gate` failures block. Advisory failures always remain visible in the report.
 */
function evaluateBudgets(candidateOrOptions, config = null, options = {}) {
  const args = normalizeArguments(candidateOrOptions, config, options);
  if (!args.candidate || !args.config) throw new TypeError('evaluateBudgets requires candidate and config');
  const mode = args.mode || args.config.defaultMode || 'advisory';
  if (!['advisory', 'gating'].includes(mode)) throw new Error(`unsupported budget mode: ${mode}`);
  const invariantRules = (args.config.invariants || []).map((rule) => ({ severity: 'hard', missing: 'fail', ...rule }));
  const rules = [...invariantRules, ...(args.config.rules || [])];
  if (args.baseline) rules.push(...(args.config.comparisonRules || []));
  const results = [];
  const candidateEnvironment = args.candidate.environmentKey;
  const baselineEnvironment = args.baseline?.environmentKey;
  if (args.baseline && args.config.requireSameEnvironment !== false
      && candidateEnvironment && baselineEnvironment && candidateEnvironment !== baselineEnvironment) {
    results.push({
      id: 'compatible-environment',
      metric: 'environmentKey',
      severity: 'hard',
      status: 'failed',
      blocking: true,
      candidate: candidateEnvironment,
      baseline: baselineEnvironment,
      reason: 'candidate and baseline were recorded in different environments',
    });
  } else {
    results.push(...rules.flatMap((rule) => evaluateRule(rule, args.candidate, args.baseline)));
  }
  for (const result of results) {
    result.blocking = result.status === 'failed'
      && (result.severity === 'hard' || (mode === 'gating' && result.severity === 'gate'));
  }
  const failed = results.filter((result) => result.status === 'failed');
  const blockingFailures = failed.filter((result) => result.blocking);
  return {
    mode,
    passed: blockingFailures.length === 0,
    results,
    blockingFailures,
    advisories: failed.filter((result) => !result.blocking),
    summary: {
      total: results.length,
      passed: results.filter((result) => result.status === 'passed').length,
      failed: failed.length,
      skipped: results.filter((result) => result.status === 'skipped').length,
      blocking: blockingFailures.length,
    },
  };
}

function loadBudgets(filePath = path.join(__dirname, '..', 'budgets.json')) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

module.exports = {
  evaluateBudgets,
  flattenLeaves,
  getPath,
  loadBudgets,
  patternRegex,
  resolveMatches,
};
