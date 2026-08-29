'use strict';

const { performance } = require('node:perf_hooks');
const { readObservers, resetObservers } = require('./observers');

const DURATION_METRICS = new Set([
  'TaskDuration',
  'ScriptDuration',
  'LayoutDuration',
  'RecalcStyleDuration',
  'V8CompileDuration',
  'ThreadTime',
]);

async function enablePerformance(cdp) {
  await cdp.send('Performance.enable', { timeDomain: 'timeTicks' });
}

async function readCdpPerformance(cdp) {
  const response = await cdp.send('Performance.getMetrics');
  return Object.fromEntries((response.metrics || []).map((metric) => [
    metric.name,
    DURATION_METRICS.has(metric.name) ? metric.value * 1000 : metric.value,
  ]));
}

async function readPageMetrics(page) {
  return page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0];
    const resources = performance.getEntriesByType('resource');
    const storageBytes = (storage) => {
      let characters = 0;
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index) || '';
        characters += key.length + (storage.getItem(key) || '').length;
      }
      return characters * 2;
    };
    return {
      now: performance.now(),
      timeOrigin: performance.timeOrigin,
      url: location.href,
      navigation: navigation ? {
        type: navigation.type,
        responseStart: navigation.responseStart,
        domInteractive: navigation.domInteractive,
        domContentLoaded: navigation.domContentLoadedEventEnd,
        loadEventEnd: navigation.loadEventEnd,
        transferSize: navigation.transferSize,
        encodedBodySize: navigation.encodedBodySize,
        decodedBodySize: navigation.decodedBodySize,
      } : null,
      resources: {
        count: resources.length,
        transferSize: resources.reduce((sum, entry) => sum + (entry.transferSize || 0), 0),
        encodedBodySize: resources.reduce((sum, entry) => sum + (entry.encodedBodySize || 0), 0),
        decodedBodySize: resources.reduce((sum, entry) => sum + (entry.decodedBodySize || 0), 0),
      },
      dom: {
        elements: document.querySelectorAll('*').length,
        scripts: document.scripts.length,
        stylesheets: document.styleSheets.length,
      },
      storage: {
        localStorageBytes: storageBytes(localStorage),
        sessionStorageBytes: storageBytes(sessionStorage),
      },
      memory: performance.memory ? {
        jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
        totalJSHeapSize: performance.memory.totalJSHeapSize,
        usedJSHeapSize: performance.memory.usedJSHeapSize,
      } : null,
    };
  });
}

/** Capture a point-in-time CDP + page + observer snapshot. */
async function captureMetrics(cdp, page) {
  const [cdpMetrics, pageMetrics, observers] = await Promise.all([
    readCdpPerformance(cdp),
    readPageMetrics(page),
    readObservers(page).catch(() => null),
  ]);
  return {
    capturedAt: new Date().toISOString(),
    cdp: cdpMetrics,
    page: pageMetrics,
    observers,
  };
}

/** Subtract two CDP snapshots. Duration values are expressed in milliseconds. */
function metricDelta(before, after) {
  const result = {};
  const names = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const name of names) {
    const left = before?.[name];
    const right = after?.[name];
    if (Number.isFinite(left) && Number.isFinite(right)) result[name] = right - left;
  }
  return result;
}

/**
 * Measure an action without tracing/profiling overhead. Use traceDiagnostic()
 * only in a separate rerun after this timing measurement identifies an outlier.
 */
async function measureAction({ cdp, page, action, settle, reset = true }) {
  if (reset) await resetObservers(page).catch(() => {});
  const before = await readCdpPerformance(cdp);
  const started = performance.now();
  const value = await action();
  if (settle) await settle();
  const elapsedMs = performance.now() - started;
  const after = await readCdpPerformance(cdp);
  const observers = await readObservers(page).catch(() => null);
  return { value, elapsedMs, cdpDelta: metricDelta(before, after), observers };
}

/** Collect request-level data from CDP and expose reset/snapshot/dispose. */
async function createNetworkCollector(cdp) {
  const requests = new Map();
  let sequence = 0;
  const listeners = [];
  const on = (event, handler) => {
    cdp.on(event, handler);
    listeners.push([event, handler]);
  };
  on('Network.requestWillBeSent', (event) => {
    const existing = requests.get(event.requestId);
    requests.set(event.requestId, {
      sequence: existing?.sequence || ++sequence,
      requestId: event.requestId,
      url: event.request.url,
      method: event.request.method,
      type: event.type,
      initiatorType: event.initiator?.type || null,
      startedAt: event.timestamp,
      redirects: (existing?.redirects || 0) + (event.redirectResponse ? 1 : 0),
      fromDiskCache: false,
      fromServiceWorker: false,
      failed: false,
    });
  });
  on('Network.responseReceived', (event) => {
    const item = requests.get(event.requestId);
    if (!item) return;
    Object.assign(item, {
      status: event.response.status,
      mimeType: event.response.mimeType,
      protocol: event.response.protocol,
      responseAt: event.timestamp,
      fromDiskCache: !!event.response.fromDiskCache,
      fromServiceWorker: !!event.response.fromServiceWorker,
      fromPrefetchCache: !!event.response.fromPrefetchCache,
      encodedDataLength: event.response.encodedDataLength || 0,
    });
  });
  on('Network.requestServedFromCache', (event) => {
    const item = requests.get(event.requestId);
    if (item) item.fromDiskCache = true;
  });
  on('Network.loadingFinished', (event) => {
    const item = requests.get(event.requestId);
    if (!item) return;
    item.finishedAt = event.timestamp;
    item.encodedDataLength = event.encodedDataLength || item.encodedDataLength || 0;
  });
  on('Network.loadingFailed', (event) => {
    const item = requests.get(event.requestId);
    if (!item) return;
    Object.assign(item, { failed: true, errorText: event.errorText, canceled: !!event.canceled, finishedAt: event.timestamp });
  });
  await cdp.send('Network.enable');

  return {
    reset() {
      requests.clear();
      sequence = 0;
    },
    snapshot() {
      const entries = Array.from(requests.values()).sort((left, right) => left.sequence - right.sequence);
      const counts = new Map();
      for (const item of entries) {
        const key = `${item.method} ${item.url}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      return {
        requests: entries,
        summary: {
          count: entries.length,
          failed: entries.filter((item) => item.failed).length,
          badResponses: entries.filter((item) => Number(item.status) >= 400).length,
          cacheHits: entries.filter((item) => item.fromDiskCache || item.fromServiceWorker || item.fromPrefetchCache).length,
          encodedDataLength: entries.reduce((sum, item) => sum + (item.encodedDataLength || 0), 0),
          duplicateUrls: Array.from(counts.entries()).filter(([, count]) => count > 1).map(([request, count]) => ({ request, count })),
        },
      };
    },
    async dispose() {
      for (const [event, handler] of listeners) cdp.removeListener(event, handler);
      await cdp.send('Network.disable').catch(() => {});
    },
  };
}

/** Capture console/page/request failures without changing scenario assertions. */
function createPageDiagnostics(page) {
  const state = { console: [], pageErrors: [], requestFailures: [], badResponses: [] };
  const handlers = {
    console(message) {
      if (!['warning', 'error'].includes(message.type())) return;
      state.console.push({ type: message.type(), text: message.text(), location: message.location() });
    },
    pageerror(error) {
      state.pageErrors.push({ name: error.name, message: error.message, stack: error.stack });
    },
    requestfailed(request) {
      state.requestFailures.push({ url: request.url(), method: request.method(), error: request.failure()?.errorText || null });
    },
    response(response) {
      if (response.status() >= 400) state.badResponses.push({ url: response.url(), status: response.status() });
    },
  };
  for (const [event, handler] of Object.entries(handlers)) page.on(event, handler);
  return {
    reset() {
      for (const values of Object.values(state)) values.length = 0;
    },
    snapshot() {
      return Object.fromEntries(Object.entries(state).map(([name, values]) => [name, values.slice()]));
    },
    dispose() {
      for (const [event, handler] of Object.entries(handlers)) page.removeListener(event, handler);
    },
  };
}

module.exports = {
  captureMetrics,
  createNetworkCollector,
  createPageDiagnostics,
  enablePerformance,
  measureAction,
  metricDelta,
  readCdpPerformance,
  readPageMetrics,
};
