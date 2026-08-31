'use strict';

const { summarizeLongTaskDurations } = require('./observers');
const { summarize } = require('./stats');

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
  // Keep persisted frame evidence physically meaningful even when a browser or
  // test double supplies a clock-domain edge at sampler startup.
  const samples = (Array.isArray(values) ? values : [])
    .filter((value) => Number.isFinite(value) && value >= 0);
  const summary = summarize(samples, { digits: 3 });
  const count = samples.length;
  const over20ms = samples.filter((value) => value > 20).length;
  const over32ms = samples.filter((value) => value > 32).length;
  const over50ms = samples.filter((value) => value > 50).length;
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
      ? samples.filter((value) => value > (refreshIntervalMs * 3)).length : null,
  };
}

function aggregateObserverMetrics(phases) {
  const observedPhases = (phases || []).filter((phase) => phase?.observers);
  const derived = observedPhases.map((phase) => phase.observers?.derived).filter(Boolean);
  const hasCompleteDerived = derived.length === observedPhases.length;
  const finite = (name) => derived.map((item) => item[name]).filter(Number.isFinite);
  const maximum = (name) => {
    const values = finite(name);
    return values.length ? Math.max(...values) : null;
  };
  const total = (name) => finite(name).reduce((sum, value) => sum + value, 0);
  const hasCompleteLongTaskEntries = observedPhases.every(
    (phase) => Array.isArray(phase.observers?.entries?.longTasks),
  );
  let longTasks;
  if (hasCompleteLongTaskEntries) {
    longTasks = summarizeLongTaskDurations(observedPhases.flatMap(
      (phase) => phase.observers.entries.longTasks,
    ));
  } else {
    const longTaskCount = total('longTaskCount');
    const phaseTotalDurations = derived.map((item) => {
      if (Number.isFinite(item.longTaskTotalDuration)) return item.longTaskTotalDuration;
      if (Number.isFinite(item.totalBlockingTime) && Number.isFinite(item.longTaskCount)) {
        return item.totalBlockingTime + (item.longTaskCount * 50);
      }
      return null;
    });
    const longTaskTotalDuration = hasCompleteDerived && phaseTotalDurations.every(Number.isFinite)
      ? phaseTotalDurations.reduce((sum, value) => sum + value, 0) : null;
    const p95Values = finite('longTaskP95Duration');
    const taskBearingPhases = derived.filter((item) => Number(item.longTaskCount) > 0);
    const maxValues = taskBearingPhases.map((item) => item.longTaskMaxDuration);
    const completeBucketTotal = (name) => {
      const values = finite(name);
      return hasCompleteDerived && values.length === derived.length
        ? values.reduce((sum, value) => sum + value, 0) : null;
    };
    longTasks = {
      totalBlockingTime: total('totalBlockingTime'),
      longTaskCount,
      longTaskTotalDuration,
      longTaskMeanDuration: longTaskCount && Number.isFinite(longTaskTotalDuration)
        ? longTaskTotalDuration / longTaskCount : null,
      // A cross-phase percentile cannot be reconstructed from per-phase p95s.
      longTaskP95Duration: derived.length === 1 && p95Values.length === 1 ? p95Values[0] : null,
      longTaskMaxDuration: taskBearingPhases.length && maxValues.every(Number.isFinite)
        ? Math.max(...maxValues) : null,
      longTaskOver100msCount: completeBucketTotal('longTaskOver100msCount'),
      longTaskOver200msCount: completeBucketTotal('longTaskOver200msCount'),
    };
  }
  return {
    derived: {
      cls: maximum('cls'),
      lcp: maximum('lcp'),
      longestEvent: maximum('longestEvent'),
      ...longTasks,
      longAnimationFrameCount: total('longAnimationFrameCount'),
    },
  };
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

module.exports = {
  aggregateBudgetResults,
  aggregateObserverMetrics,
  basicSummary,
  frameSummary,
};
