'use strict';

const {
  assertScenarioContext,
  collectPageSnapshot,
  recordInvariant,
  runPhase,
  seedFixture,
  settleAnimationFrames,
} = require('./_shared');

module.exports = {
  id: 'planner',
  description: 'Exercises a dense planner through board scrolling, sidebar changes, and mobile collapse work.',
  tags: ['planner', 'interaction', 'dense'],

  async run(ctx) {
    assertScenarioContext(ctx);
    const { page } = ctx;
    const phases = [];
    const invariants = [];
    await seedFixture(ctx, 'scheduler-light');

    const initial = await collectPageSnapshot(page);
    await recordInvariant(
      ctx,
      invariants,
      'planner.dense-fixture-is-exact',
      initial.modelCourses === 60
        && initial.renderedCourses === 60
        && initial.modelSemesters === 7,
      initial,
    );

    await runPhase(ctx, phases, 'planner.board-scroll-roundtrip', async () => page.evaluate(() => {
      const board = document.querySelector('.board');
      if (!board) throw new Error('Planner board was not rendered.');
      const maximum = Math.max(0, board.scrollWidth - board.clientWidth);
      const animate = (target) => new Promise((resolve) => {
        const start = board.scrollLeft;
        let frame = 0;
        const totalFrames = 24;
        const step = () => {
          frame += 1;
          const progress = frame / totalFrames;
          board.scrollLeft = start + (target - start) * progress;
          if (frame >= totalFrames) resolve();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
      return animate(maximum).then(() => animate(0)).then(() => ({
        clientWidth: board.clientWidth,
        scrollWidth: board.scrollWidth,
        maximum,
        finalScrollLeft: board.scrollLeft,
      }));
    }));

    const sidebarToggle = page.locator('.sidebar-toggle');
    if (await sidebarToggle.isVisible().catch(() => false)) {
      await runPhase(ctx, phases, 'planner.sidebar-collapse-roundtrip', async () => {
        const initialExpanded = await sidebarToggle.getAttribute('aria-expanded');
        await sidebarToggle.click();
        await page.waitForFunction((value) => (
          document.querySelector('.sidebar-toggle')?.getAttribute('aria-expanded') !== value
        ), initialExpanded);
        await settleAnimationFrames(page);
        await sidebarToggle.click();
        await page.waitForFunction((value) => (
          document.querySelector('.sidebar-toggle')?.getAttribute('aria-expanded') === value
        ), initialExpanded);
        await settleAnimationFrames(page);
        return { restoredExpanded: await sidebarToggle.getAttribute('aria-expanded') };
      });
    }

    const isMobile = await page.locator('body').evaluate((body) => body.classList.contains('is-mobile'));
    if (isMobile) {
      await runPhase(ctx, phases, 'planner.mobile-semester-collapse-roundtrip', async () => {
        const card = page.locator('.container_semester').first();
        const before = await card.evaluate((node) => node.classList.contains('m-collapsed'));
        await card.locator('.date p').click();
        await page.waitForFunction((value) => (
          document.querySelector('.container_semester')?.classList.contains('m-collapsed') !== value
        ), before);
        await card.locator('.date p').click();
        await page.waitForFunction((value) => (
          document.querySelector('.container_semester')?.classList.contains('m-collapsed') === value
        ), before);
        return { restoredCollapsed: before };
      });
    }

    const finalSnapshot = await collectPageSnapshot(page);
    await recordInvariant(
      ctx,
      invariants,
      'planner.interactions-preserve-model-and-dom',
      finalSnapshot.modelCourses === initial.modelCourses
        && finalSnapshot.renderedCourses === initial.renderedCourses
        && finalSnapshot.modelSemesters === initial.modelSemesters,
      { initial, final: finalSnapshot },
    );
    await recordInvariant(
      ctx,
      invariants,
      'planner.document-has-no-horizontal-overflow',
      finalSnapshot.documentOverflow.x <= 1,
      finalSnapshot.documentOverflow,
    );

    return { phases, invariants, metadata: { initial, final: finalSnapshot } };
  },
};
