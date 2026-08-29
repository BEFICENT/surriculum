'use strict';

const {
  assertScenarioContext,
  collectPageSnapshot,
  recordInvariant,
  runPhase,
  seedFixture,
  targetUrl,
  waitForAppShell,
} = require('./_shared');
const { waitForServiceWorkerReady } = require('../lib/service-worker');

module.exports = {
  id: 'startup',
  description: 'Measures application shell startup and returning-plan hydration.',
  tags: ['startup', 'navigation', 'planner', 'critical'],

  async run(ctx) {
    assertScenarioContext(ctx, ['target']);
    const { page } = ctx;
    const phases = [];
    const invariants = [];
    let installedServiceWorker = null;
    const navigationTimeout = Number(ctx.options?.navigationTimeout || 30_000);

    await runPhase(ctx, phases, 'startup.shell-navigation', async () => {
      await page.goto(targetUrl(ctx), {
        waitUntil: 'domcontentloaded',
        timeout: navigationTimeout,
      });
      await waitForAppShell(page, navigationTimeout);
      if (ctx.options?.cache === 'installing') {
        installedServiceWorker = await waitForServiceWorkerReady(
          page,
          navigationTimeout,
        );
      }
      return {
        ...await collectPageSnapshot(page),
        installedServiceWorker,
      };
    });

    const shell = await collectPageSnapshot(page);
    await recordInvariant(ctx, invariants, 'startup.shell-is-unique', (
      await page.locator('.app').count()
    ) === 1, shell);
    if (ctx.options?.cache === 'installing') {
      await recordInvariant(
        ctx,
        invariants,
        'startup.service-worker-install-reaches-active-ready-state',
        installedServiceWorker?.state === 'activated'
          && Boolean(installedServiceWorker?.scope)
          && Boolean(installedServiceWorker?.scriptURL),
        installedServiceWorker,
      );
    }

    const seeded = await runPhase(ctx, phases, 'startup.returning-plan-hydration', async () => (
      seedFixture(ctx, 'typical')
    ));
    const hydrated = await collectPageSnapshot(page);
    await recordInvariant(
      ctx,
      invariants,
      'startup.typical-plan-hydrates-exactly',
      hydrated.modelCourses === 24
        && hydrated.renderedCourses === 24
        && hydrated.modelSemesters === 4
        && hydrated.renderedSemesters === 4,
      hydrated,
    );

    const navigation = await page.evaluate(() => {
      const entry = performance.getEntriesByType('navigation')[0];
      return entry ? {
        type: entry.type,
        startTime: entry.startTime,
        responseStart: entry.responseStart,
        domInteractive: entry.domInteractive,
        domContentLoadedEventEnd: entry.domContentLoadedEventEnd,
        loadEventEnd: entry.loadEventEnd,
        transferSize: entry.transferSize,
        encodedBodySize: entry.encodedBodySize,
        decodedBodySize: entry.decodedBodySize,
      } : null;
    });

    return {
      phases,
      invariants,
      metadata: {
        fixture: seeded.details?.fixture?.id || 'typical',
        installedServiceWorker,
        navigation,
        snapshot: hydrated,
      },
    };
  },
};
