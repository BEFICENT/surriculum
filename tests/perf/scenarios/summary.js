'use strict';

const {
  assertScenarioContext,
  recordInvariant,
  runPhase,
  seedFixture,
  settleAnimationFrames,
} = require('./_shared');

module.exports = {
  id: 'summary',
  description: 'Measures repeated dense graduation-summary rendering, detail navigation, and cleanup.',
  tags: ['summary', 'requirements', 'memory'],

  async run(ctx) {
    assertScenarioContext(ctx);
    const { page } = ctx;
    const phases = [];
    const invariants = [];
    const cycles = Math.max(1, Number(ctx.options?.summaryCycles || 5));
    const navigationTimeout = Number(ctx.options?.navigationTimeout || 30_000);
    await seedFixture(ctx, 'scheduler-light');

    const samples = [];
    await runPhase(ctx, phases, 'summary.repeated-open-detail-close', async () => {
      for (let cycle = 0; cycle < cycles; cycle += 1) {
        await page.locator('.summary').click();
        const overlay = page.locator('.summary_modal_overlay');
        await overlay.waitFor({ state: 'visible', timeout: navigationTimeout });
        await overlay.locator('.summary_program_card').first().waitFor({ state: 'visible', timeout: navigationTimeout });
        await settleAnimationFrames(page, 2);
        const sample = {
          cycle: cycle + 1,
          cards: await overlay.locator('.summary_program_card').count(),
          elements: await overlay.locator('*').count(),
        };
        const detail = overlay.locator('.summary_detail_btn').first();
        if (cycle < 2 && await detail.isVisible().catch(() => false)) {
          await detail.click();
          await overlay.locator('.summary_major_panel, .summary_minor_panel').filter({ visible: true })
            .first().waitFor({ state: 'visible' }).catch(() => {});
          await settleAnimationFrames(page);
          const back = overlay.locator('.summary_back_btn').filter({ visible: true }).first();
          if (await back.isVisible().catch(() => false)) await back.click();
        }
        samples.push(sample);
        await overlay.locator('.summary_surface_close').click();
        await overlay.waitFor({ state: 'detached' });
        await settleAnimationFrames(page);
      }
      return samples;
    });

    const cleanup = await page.evaluate(() => ({
      overlays: document.querySelectorAll('.summary_modal_overlay').length,
      modals: document.querySelectorAll('.summary_modal').length,
    }));
    await recordInvariant(
      ctx,
      invariants,
      'summary.each-cycle-renders-one-program-card-set',
      samples.every((sample) => sample.cards >= 1),
      { samples },
    );
    await recordInvariant(
      ctx,
      invariants,
      'summary.close-removes-all-summary-dom',
      cleanup.overlays === 0 && cleanup.modals === 0,
      cleanup,
    );

    return { phases, invariants, metadata: { cycles, samples, cleanup } };
  },
};
