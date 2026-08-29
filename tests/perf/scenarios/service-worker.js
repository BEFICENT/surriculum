'use strict';

const {
  assertScenarioContext,
  recordInvariant,
  runPhase,
  seedFixture,
  waitForAppShell,
  waitForPlan,
} = require('./_shared');
const { waitForServiceWorkerReady } = require('../lib/service-worker');

module.exports = {
  id: 'service-worker',
  description: 'Measures a warmed service-worker reload and validates an offline returning-plan restore.',
  tags: ['service-worker', 'offline', 'cache', 'artifact'],

  async run(ctx) {
    assertScenarioContext(ctx, ['browserContext']);
    const { page, browserContext } = ctx;
    const phases = [];
    const invariants = [];
    if (ctx.options?.serviceWorker === false || ctx.options?.serviceWorkers === 'block') {
      return { phases, invariants, metadata: { skipped: 'Disabled by runner options.' } };
    }
    const seeded = await seedFixture(ctx, 'typical');
    const fixture = seeded?.fixture || null;
    const expectedPlan = {
      major: fixture?.plan?.major || 'CS',
      courseCount: Number(fixture?.expectedCourseCount ?? 24),
      semesterCount: Number(fixture?.expectedSemesterCount ?? 4),
      termCodes: Array.isArray(fixture?.expectedTermCodes)
        ? fixture.expectedTermCodes.map(String) : null,
      courseOrder: Array.isArray(fixture?.plan?.curriculum)
        ? fixture.plan.curriculum.map((semester) => semester.map(String)) : null,
    };
    const timeout = Number(ctx.options?.navigationTimeout || 30_000);
    const supported = await page.evaluate(() => (
      'serviceWorker' in navigator && 'caches' in window && window.isSecureContext
    )).catch(() => false);
    if (!supported) {
      return { phases, invariants, metadata: { skipped: 'Service workers are unavailable for this target.' } };
    }
    let online;
    await runPhase(ctx, phases, 'service-worker.warm-runtime', async () => {
      let activeWorker = await waitForServiceWorkerReady(page, timeout);
      const controllerMatches = await page.evaluate((scriptURL) => (
        navigator.serviceWorker.controller?.scriptURL === scriptURL
      ), activeWorker.scriptURL);
      if (!controllerMatches) {
        await page.reload({ waitUntil: 'domcontentloaded', timeout });
        activeWorker = await waitForServiceWorkerReady(page, timeout);
      }
      await page.waitForFunction((scriptURL) => (
        navigator.serviceWorker.controller?.scriptURL === scriptURL
      ), activeWorker.scriptURL, { timeout });
      await waitForPlan(page, expectedPlan.courseCount, expectedPlan.semesterCount, timeout);
      online = await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.ready;
        const names = await caches.keys();
        const inventories = Object.fromEntries(await Promise.all(names.map(async (name) => {
          const cache = await caches.open(name);
          return [name, (await cache.keys()).map((request) => request.url)];
        })));
        return {
          scope: registration.scope,
          scriptURL: registration.active?.scriptURL || '',
          activeState: registration.active?.state || '',
          controller: navigator.serviceWorker.controller?.scriptURL || '',
          cacheNames: names,
          cacheEntries: Object.fromEntries(
            Object.entries(inventories).map(([name, urls]) => [name, urls.length]),
          ),
        };
      });
      return online;
    });

    let offline;
    const offlineFailures = [];
    const onOfflineFailure = (request) => {
      offlineFailures.push({
        url: request.url(),
        method: request.method(),
        error: request.failure()?.errorText || null,
      });
    };
    try {
      await runPhase(ctx, phases, 'service-worker.offline-plan-restore', async () => {
        page.on('requestfailed', onOfflineFailure);
        await browserContext.setOffline(true);
        await page.reload({ waitUntil: 'domcontentloaded', timeout });
        await waitForAppShell(page, timeout);
        await waitForPlan(page, expectedPlan.courseCount, expectedPlan.semesterCount, timeout);
        offline = await page.evaluate(() => {
          const semesters = window.curriculum?.semesters || [];
          return {
            controller: navigator.serviceWorker.controller?.scriptURL || '',
            major: window.curriculum?.major || '',
            modelCourses: semesters.reduce(
              (sum, semester) => sum + (semester.courses || []).length,
              0,
            ),
            modelSemesters: semesters.length,
            termCodes: semesters.map((semester) => String(semester.termCode || '')),
            courseOrder: semesters.map((semester) => (
              (semester.courses || []).map((course) => String(course.code || ''))
            )),
            renderedCourses: document.querySelectorAll('.container_semester .course').length,
            header: String(document.querySelector('.header-title')?.textContent || '').trim(),
          };
        });
        return offline;
      });
    } finally {
      page.removeListener('requestfailed', onOfflineFailure);
      await browserContext.setOffline(false);
    }

    await recordInvariant(
      ctx,
      invariants,
      'service-worker-controls-the-warm-page',
      Boolean(online.controller)
        && Boolean(online.scope)
        && online.activeState === 'activated'
        && online.controller === online.scriptURL
        && online.cacheNames.length > 0,
      online,
    );
    await recordInvariant(
      ctx,
      invariants,
      'service-worker-offline-controller-matches-active-worker',
      Boolean(offline.controller)
        && Boolean(online.scriptURL)
        && offline.controller === online.scriptURL,
      {
        onlineActiveWorker: online.scriptURL,
        onlineController: online.controller,
        offlineController: offline.controller,
      },
    );
    const termCodesMatch = expectedPlan.termCodes === null
      || JSON.stringify(offline.termCodes) === JSON.stringify(expectedPlan.termCodes);
    const courseOrderMatches = expectedPlan.courseOrder === null
      || JSON.stringify(offline.courseOrder) === JSON.stringify(expectedPlan.courseOrder);
    await recordInvariant(
      ctx,
      invariants,
      'service-worker-restores-the-exact-plan-offline',
      offline.major === expectedPlan.major
        && offline.modelCourses === expectedPlan.courseCount
        && offline.renderedCourses === expectedPlan.courseCount
        && offline.modelSemesters === expectedPlan.semesterCount
        && termCodesMatch
        && courseOrderMatches,
      { actual: offline, expected: expectedPlan },
    );
    const uniqueOfflineFailures = Array.from(new Set(offlineFailures.map((item) => item.url)));
    await recordInvariant(
      ctx,
      invariants,
      'service-worker.offline-fallback-requests-stay-bounded',
      offlineFailures.length <= 25 && uniqueOfflineFailures.length <= 15,
      {
        count: offlineFailures.length,
        uniqueCount: uniqueOfflineFailures.length,
        uniqueUrls: uniqueOfflineFailures,
        failures: offlineFailures,
      },
    );

    return {
      phases,
      invariants,
      metadata: {
        online,
        offline,
        offlineFailures: {
          count: offlineFailures.length,
          uniqueCount: uniqueOfflineFailures.length,
          uniqueUrls: uniqueOfflineFailures,
          failures: offlineFailures,
        },
      },
    };
  },
};
