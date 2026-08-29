'use strict';

function observerBootstrap(options = {}) {
  const key = '__surriculumPerformance';
  const previous = window[key];
  if (previous?.observers) {
    for (const observer of previous.observers) {
      try { observer.disconnect(); } catch (_) {}
    }
  }
  try { previous?.restoreXhr?.(); } catch (_) {}
  const maxEntries = Number.isFinite(options.maxEntries) ? Math.max(100, options.maxEntries) : 10000;
  const supported = globalThis.PerformanceObserver?.supportedEntryTypes || [];
  const state = {
    version: 1,
    installedAt: performance.now(),
    maxEntries,
    supportedEntryTypes: Array.from(supported),
    observers: [],
    entries: {
      events: [],
      layoutShifts: [],
      longAnimationFrames: [],
      longTasks: [],
      largestContentfulPaint: [],
      marks: [],
      measures: [],
      paints: [],
      resources: [],
      synchronousXhr: [],
    },
    cls: 0,
    frameSamples: {},
  };

  try {
    const originalOpen = XMLHttpRequest.prototype.open;
    const wrappedOpen = function performanceObservedOpen(method, url, async = true, ...rest) {
      if (async === false) {
        state.entries.synchronousXhr.push({
          method: String(method || 'GET'),
          url: String(url || ''),
          startTime: Number(performance.now().toFixed(3)),
        });
      }
      return originalOpen.call(this, method, url, async, ...rest);
    };
    XMLHttpRequest.prototype.open = wrappedOpen;
    state.restoreXhr = () => {
      if (XMLHttpRequest.prototype.open === wrappedOpen) XMLHttpRequest.prototype.open = originalOpen;
    };
  } catch (_) {}

  const copyEntry = (entry) => {
    const base = {
      name: entry.name,
      entryType: entry.entryType,
      startTime: Number(entry.startTime.toFixed(3)),
      duration: Number(entry.duration.toFixed(3)),
    };
    if (entry.entryType === 'event') {
      return { ...base, interactionId: entry.interactionId || 0, processingStart: entry.processingStart, processingEnd: entry.processingEnd };
    }
    if (entry.entryType === 'layout-shift') {
      return { ...base, value: entry.value, hadRecentInput: entry.hadRecentInput };
    }
    if (entry.entryType === 'largest-contentful-paint') {
      return { ...base, renderTime: entry.renderTime, loadTime: entry.loadTime, size: entry.size, id: entry.id || null, url: entry.url || null };
    }
    if (entry.entryType === 'resource') {
      return {
        ...base,
        initiatorType: entry.initiatorType,
        transferSize: entry.transferSize,
        encodedBodySize: entry.encodedBodySize,
        decodedBodySize: entry.decodedBodySize,
        responseStart: entry.responseStart,
        responseEnd: entry.responseEnd,
      };
    }
    if (entry.entryType === 'long-animation-frame') {
      return {
        ...base,
        blockingDuration: entry.blockingDuration || 0,
        renderStart: entry.renderStart || 0,
        styleAndLayoutStart: entry.styleAndLayoutStart || 0,
        firstUIEventTimestamp: entry.firstUIEventTimestamp || 0,
      };
    }
    return base;
  };

  const watch = (type, destination, observeOptions = {}) => {
    if (!supported.includes(type)) return;
    try {
      const observer = new PerformanceObserver((list) => {
        const target = state.entries[destination];
        for (const entry of list.getEntries()) {
          if (type === 'layout-shift' && !entry.hadRecentInput) state.cls += entry.value;
          target.push(copyEntry(entry));
        }
        if (target.length > maxEntries) target.splice(0, target.length - maxEntries);
      });
      observer.observe({ type, buffered: true, ...observeOptions });
      state.observers.push(observer);
    } catch (_) {}
  };

  watch('event', 'events', { durationThreshold: options.eventDurationThreshold || 16 });
  watch('layout-shift', 'layoutShifts');
  watch('long-animation-frame', 'longAnimationFrames');
  watch('longtask', 'longTasks');
  watch('largest-contentful-paint', 'largestContentfulPaint');
  watch('mark', 'marks');
  watch('measure', 'measures');
  watch('paint', 'paints');
  watch('resource', 'resources');
  window[key] = state;
}

/** Install observers for current and future documents on a Playwright page. */
async function installObservers(page, options = {}) {
  await page.addInitScript(observerBootstrap, options);
  await page.evaluate(observerBootstrap, options);
}

/** Clear samples at the beginning of a phase without reallocating observers. */
async function resetObservers(page) {
  await page.evaluate(() => {
    const state = window.__surriculumPerformance;
    if (!state) return;
    for (const entries of Object.values(state.entries)) entries.length = 0;
    state.cls = 0;
    state.installedAt = performance.now();
  });
}

/** Start display-frame sampling; endFrameSampling returns the recorded deltas. */
async function beginFrameSampling(page, label = 'default') {
  await page.evaluate((sampleLabel) => {
    const state = window.__surriculumPerformance;
    if (!state) throw new Error('performance observers are not installed');
    const sample = { active: true, previous: performance.now(), deltas: [] };
    state.frameSamples[sampleLabel] = sample;
    const tick = (now) => {
      if (!sample.active) return;
      sample.deltas.push(now - sample.previous);
      sample.previous = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, label);
}

async function endFrameSampling(page, label = 'default') {
  return page.evaluate(async (sampleLabel) => {
    const sample = window.__surriculumPerformance?.frameSamples?.[sampleLabel];
    if (!sample) return [];
    sample.active = false;
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The first interval begins before the measured action. If that action
    // blocks the main thread before the first rAF callback, this is the exact
    // interval that captures the stall and must not be discarded.
    return sample.deltas.slice();
  }, label);
}

/** Read raw entries plus derived lab metrics without destroying the observers. */
async function readObservers(page) {
  return page.evaluate(() => {
    const state = window.__surriculumPerformance;
    if (!state) return null;
    const clone = Object.fromEntries(Object.entries(state.entries).map(([name, values]) => [name, values.slice()]));
    const lcpEntries = clone.largestContentfulPaint;
    const lcp = lcpEntries.length ? lcpEntries[lcpEntries.length - 1].startTime : null;
    const eventDurations = clone.events.map((entry) => entry.duration);
    const longTaskBlocking = clone.longTasks.reduce((sum, entry) => sum + Math.max(0, entry.duration - 50), 0);
    return {
      installedAt: state.installedAt,
      timeOrigin: performance.timeOrigin,
      supportedEntryTypes: state.supportedEntryTypes.slice(),
      derived: {
        cls: state.cls,
        lcp,
        longestEvent: eventDurations.length ? Math.max(...eventDurations) : null,
        totalBlockingTime: longTaskBlocking,
        longTaskCount: clone.longTasks.length,
        longAnimationFrameCount: clone.longAnimationFrames.length,
      },
      entries: clone,
    };
  });
}

module.exports = {
  beginFrameSampling,
  endFrameSampling,
  installObservers,
  readObservers,
  resetObservers,
};
