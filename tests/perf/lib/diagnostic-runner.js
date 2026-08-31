'use strict';

const { performance } = require('node:perf_hooks');

const { launchBrowser } = require('./browser');
const { createCdpInput } = require('./cdp-input');
const { createPageDiagnostics } = require('./metrics');
const { round } = require('./stats');
const { profileDiagnostic, traceDiagnostic } = require('./tracing');
const fixtures = require('../fixtures');

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

function createDiagnosticRunner(setup) {
  const {
    effectiveServiceWorkerMode,
    navigateForScenario,
    runnerSetupOptions,
    warmBrowserState,
  } = setup || {};
  for (const [name, value] of Object.entries({
    effectiveServiceWorkerMode,
    navigateForScenario,
    runnerSetupOptions,
    warmBrowserState,
  })) {
    if (typeof value !== 'function') {
      throw new TypeError(`Diagnostic runner requires ${name}.`);
    }
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
        const profile = await profileDiagnostic(cdp, scenarioAction, {
          outputPath: artifact,
          samplingInterval: 1000,
          urlPrefix: target.url,
        });
        value = profile.value;
        topFunctions = profile.topFunctions;
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
        cleanupErrors.push({
          operation: 'browser-session-close', message: error.message, stack: error.stack,
        });
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

  return Object.freeze({ runDiagnosticPass, runDiagnostics });
}

module.exports = {
  classifyDiagnosticFailures,
  createDiagnosticRunner,
  diagnosticStem,
  summarizeDiagnosticScenario,
};
