'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { buildReport } = require('../report');
const { aggregateObserverMetrics } = require('../run');
const {
  beginFrameSampling,
  endFrameSampling,
  readObservers,
  summarizeLongTaskDurations,
} = require('../lib/observers');

function assertClose(actual, expected, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

function observerEntries(longTaskDurations) {
  return {
    events: [{ duration: 24 }],
    layoutShifts: [],
    longAnimationFrames: [{ duration: 80 }],
    longTasks: longTaskDurations.map((duration) => ({ duration })),
    largestContentfulPaint: [{ startTime: 420 }],
    marks: [],
    measures: [],
    paints: [],
    resources: [],
    synchronousXhr: [],
  };
}

test('long-task summaries retain duration distribution and strict threshold buckets', () => {
  const summary = summarizeLongTaskDurations([50, 100, 100.001, 200, 200.001, 400]);
  assert.equal(summary.longTaskCount, 6);
  assertClose(summary.totalBlockingTime, 750.002);
  assertClose(summary.longTaskTotalDuration, 1050.002);
  assertClose(summary.longTaskMeanDuration, 175.00033333333334);
  assertClose(summary.longTaskP95Duration, 350.00025);
  assert.equal(summary.longTaskMaxDuration, 400);
  assert.equal(summary.longTaskOver100msCount, 4);
  assert.equal(summary.longTaskOver200msCount, 2);

  assert.deepEqual(summarizeLongTaskDurations([]), {
    totalBlockingTime: 0,
    longTaskCount: 0,
    longTaskTotalDuration: 0,
    longTaskMeanDuration: null,
    longTaskP95Duration: null,
    longTaskMaxDuration: null,
    longTaskOver100msCount: 0,
    longTaskOver200msCount: 0,
  });
});

test('observer snapshots publish the full long-task distribution beside existing metrics', async () => {
  const state = {
    installedAt: 12,
    supportedEntryTypes: ['longtask'],
    cls: 0.125,
    entries: observerEntries([75, 125, 225]),
  };
  const page = {
    async evaluate(callback) {
      const previousWindow = global.window;
      global.window = { __surriculumPerformance: state };
      try {
        return callback();
      } finally {
        if (previousWindow === undefined) delete global.window;
        else global.window = previousWindow;
      }
    },
  };

  const snapshot = await readObservers(page);
  assert.equal(snapshot.derived.cls, 0.125);
  assert.equal(snapshot.derived.lcp, 420);
  assert.equal(snapshot.derived.longestEvent, 24);
  assert.equal(snapshot.derived.longAnimationFrameCount, 1);
  assert.equal(snapshot.derived.longTaskCount, 3);
  assert.equal(snapshot.derived.totalBlockingTime, 275);
  assert.equal(snapshot.derived.longTaskTotalDuration, 425);
  assertClose(snapshot.derived.longTaskMeanDuration, 141.66666666666666);
  assert.equal(snapshot.derived.longTaskP95Duration, 215);
  assert.equal(snapshot.derived.longTaskMaxDuration, 225);
  assert.equal(snapshot.derived.longTaskOver100msCount, 2);
  assert.equal(snapshot.derived.longTaskOver200msCount, 1);
});

test('frame sampling drops an invalid negative first rAF interval', async () => {
  const callbacks = [];
  const state = { frameSamples: {} };
  const previousWindow = global.window;
  const previousPerformance = global.performance;
  const previousRaf = global.requestAnimationFrame;
  global.window = { __surriculumPerformance: state };
  global.performance = { now: () => 100 };
  global.requestAnimationFrame = (callback) => {
    callbacks.push(callback);
    return callbacks.length;
  };
  const page = {
    async evaluate(callback, argument) {
      return callback(argument);
    },
  };

  try {
    await beginFrameSampling(page, 'negative-first-frame');
    callbacks.shift()(95);
    callbacks.shift()(111);
    callbacks.shift()(127);
    const samples = await endFrameSampling(page, 'negative-first-frame');
    assert.deepEqual(samples, [16, 16]);
    assert.ok(samples.every((sample) => Number.isFinite(sample) && sample >= 0));
  } finally {
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
    if (previousPerformance === undefined) delete global.performance;
    else global.performance = previousPerformance;
    if (previousRaf === undefined) delete global.requestAnimationFrame;
    else global.requestAnimationFrame = previousRaf;
  }
});

test('phase aggregation recomputes a true cross-phase distribution and reports stable paths', () => {
  const phase = (name, durations, extra) => ({
    name,
    observers: {
      derived: {
        cls: extra.cls,
        lcp: extra.lcp,
        longestEvent: extra.longestEvent,
        longAnimationFrameCount: extra.longAnimationFrameCount,
        ...summarizeLongTaskDurations(durations),
      },
      entries: observerEntries(durations),
    },
  });
  const phases = [
    phase('scroll', [60, 120, 240], {
      cls: 0.1, lcp: 400, longestEvent: 30, longAnimationFrameCount: 1,
    }),
    phase('hover', [80, 180, 280], {
      cls: 0.2, lcp: 500, longestEvent: 44, longAnimationFrameCount: 2,
    }),
  ];
  const observers = aggregateObserverMetrics(phases);
  assert.equal(observers.derived.totalBlockingTime, 660);
  assert.equal(observers.derived.longTaskCount, 6);
  assert.equal(observers.derived.longTaskTotalDuration, 960);
  assert.equal(observers.derived.longTaskMeanDuration, 160);
  assert.equal(observers.derived.longTaskP95Duration, 270);
  assert.equal(observers.derived.longTaskMaxDuration, 280);
  assert.equal(observers.derived.longTaskOver100msCount, 4);
  assert.equal(observers.derived.longTaskOver200msCount, 2);
  assert.equal(observers.derived.longAnimationFrameCount, 3);

  const report = buildReport({
    manifest: { runId: 'observer-contract' },
    iterations: [{
      status: 'passed',
      runId: 'observer-contract',
      scenarioId: 'scheduler',
      iteration: 0,
      metrics: { observers, phases },
    }],
  });
  const metrics = report.summary.groups[0].metrics;
  assert.ok(metrics['metrics.observers.derived.longTaskTotalDuration']);
  assert.ok(metrics['metrics.observers.derived.longTaskP95Duration']);
  assert.ok(metrics['metrics.observers.derived.longTaskOver200msCount']);
  assert.ok(metrics['metrics.phases.scroll.observers.derived.longTaskMeanDuration']);
  assert.match(report.csv, /longTaskMaxDuration/);
  assert.match(report.markdown, /longTaskOver100msCount/);
  assert.match(report.html, /longTaskP95Duration/);
  assert.match(report.markdown, /\| Metric \| Samples \| Median \|/);
  assert.match(report.markdown, /longTaskP95Duration \| 1 \|/);
  assert.match(report.html, /<th>Metric<\/th><th>Samples<\/th><th>Median<\/th>/);
  assert.match(report.html, /longTaskP95Duration<\/td><td>1<\/td>/);
});

test('legacy phase summaries preserve count and TBT without requiring raw entries', () => {
  const observers = aggregateObserverMetrics([
    { observers: { derived: { totalBlockingTime: 25, longTaskCount: 1 } } },
    { observers: { derived: { totalBlockingTime: 100, longTaskCount: 2 } } },
  ]);
  assert.equal(observers.derived.totalBlockingTime, 125);
  assert.equal(observers.derived.longTaskCount, 3);
  assert.equal(observers.derived.longTaskTotalDuration, 275);
  assertClose(observers.derived.longTaskMeanDuration, 91.66666666666667);
  assert.equal(observers.derived.longTaskP95Duration, null);
  assert.equal(observers.derived.longTaskMaxDuration, null);
  assert.equal(observers.derived.longTaskOver100msCount, null);
  assert.equal(observers.derived.longTaskOver200msCount, null);

  const partial = aggregateObserverMetrics([
    {
      observers: {
        derived: {
          totalBlockingTime: 25,
          longTaskCount: 1,
          longTaskTotalDuration: 75,
        },
      },
    },
    { observers: { derived: { totalBlockingTime: 200, longTaskCount: 1 } } },
  ]);
  assert.equal(partial.derived.longTaskTotalDuration, 325);
  assert.equal(partial.derived.longTaskMeanDuration, 162.5);
  assert.equal(partial.derived.longTaskOver100msCount, null);
});
