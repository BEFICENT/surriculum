'use strict';

const {
  assertScenarioContext,
  recordInvariant,
  runPhase,
  seedFixture,
  waitForPlan,
} = require('./_shared');

module.exports = {
  id: 'persistence',
  description: 'Measures save coalescing, plan-management churn, and exact reload hydration.',
  tags: ['storage', 'persistence', 'planner'],

  async run(ctx) {
    assertScenarioContext(ctx);
    const { page } = ctx;
    const navigationTimeout = Number(ctx.options?.navigationTimeout || 30_000);
    const phases = [];
    const invariants = [];
    const saveRequests = Math.max(10, Number(ctx.options?.saveRequests || 100));
    await seedFixture(ctx, 'typical');
    const initialPlanCount = await page.evaluate(() => window.planStorage.getPlans().length);

    let saveProbe;
    await runPhase(ctx, phases, 'persistence.rapid-save-coalescing', async () => {
      saveProbe = await page.evaluate((requests) => {
        const nativeSetItem = Storage.prototype.setItem;
        const activeId = window.planStorage.getActivePlanId();
        const writes = [];
        Storage.prototype.setItem = function measuredSetItem(key, value) {
          const startedAt = performance.now();
          const result = nativeSetItem.call(this, key, value);
          writes.push({
            key: String(key),
            bytes: String(value).length,
            elapsedMs: performance.now() - startedAt,
          });
          return result;
        };
        try {
          const requested = [];
          for (let index = 0; index < requests; index += 1) {
            requested.push(window.planStorage.requestSave());
          }
          const flushed = window.planStorage.flushSaves();
          return {
            activeId,
            requested: requested.length,
            requestAccepted: requested.filter(Boolean).length,
            flushed,
            writes,
            totalWriteBytes: writes.reduce((sum, write) => sum + write.bytes, 0),
            totalWriteMs: writes.reduce((sum, write) => sum + write.elapsedMs, 0),
          };
        } finally {
          Storage.prototype.setItem = nativeSetItem;
        }
      }, saveRequests);
      return saveProbe;
    });

    await recordInvariant(
      ctx,
      invariants,
      'persistence.save-burst-is-coalesced',
      saveProbe.flushed === true && saveProbe.writes.length < saveRequests,
      saveProbe,
    );

    let management;
    await runPhase(ctx, phases, 'persistence.plan-management-churn', async () => {
      management = await page.evaluate(() => {
        const storage = window.planStorage;
        const activeBefore = storage.getActivePlanId();
        const created = [];
        for (let index = 0; index < 4; index += 1) {
          const id = storage.duplicatePlan(activeBefore, `Performance copy ${index + 1}`);
          if (id) created.push(id);
        }
        const peakCount = storage.getPlans().length;
        const deleteResults = created.map((id) => storage.deletePlan(id));
        return {
          activeBefore,
          activeAfter: storage.getActivePlanId(),
          created,
          peakCount,
          deleteResults,
          finalCount: storage.getPlans().length,
          orphanKeys: Object.keys(localStorage).filter((key) => (
            created.some((id) => key.includes(id))
          )),
        };
      });
      return management;
    });
    await recordInvariant(
      ctx,
      invariants,
      'persistence.temporary-plans-clean-up-completely',
      management.activeAfter === management.activeBefore
        && management.finalCount === initialPlanCount
        && management.orphanKeys.length === 0
        && management.deleteResults.every((result) => result?.ok === true),
      management,
    );

    await runPhase(ctx, phases, 'persistence.reload-hydration', async () => {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: navigationTimeout });
      await waitForPlan(page, 24, 4, navigationTimeout);
      return page.evaluate(() => ({
        plans: window.planStorage.getPlans().length,
        modelCourses: window.curriculum.semesters.reduce(
          (sum, semester) => sum + semester.courses.length,
          0,
        ),
        renderedCourses: document.querySelectorAll('.container_semester .course').length,
      }));
    });
    const reloaded = await page.evaluate(() => ({
      plans: window.planStorage.getPlans().length,
      modelCourses: window.curriculum.semesters.reduce(
        (sum, semester) => sum + semester.courses.length,
        0,
      ),
      renderedCourses: document.querySelectorAll('.container_semester .course').length,
    }));
    await recordInvariant(
      ctx,
      invariants,
      'persistence.reload-restores-exact-plan',
      reloaded.plans === initialPlanCount
        && reloaded.modelCourses === 24
        && reloaded.renderedCourses === 24,
      reloaded,
    );

    return {
      phases,
      invariants,
      metadata: { initialPlanCount, saveRequests, saveProbe, management, reloaded },
    };
  },
};
