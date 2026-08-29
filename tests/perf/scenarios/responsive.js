'use strict';

const {
  assertScenarioContext,
  recordInvariant,
  runPhase,
  seedFixture,
  settleAnimationFrames,
} = require('./_shared');

async function responsiveSnapshot(page) {
  return page.evaluate(() => {
    const rows = [
      ...document.querySelectorAll('.board .container_semester'),
      ...document.querySelectorAll('.board .add-semester-ghost'),
    ].map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        kind: node.classList.contains('add-semester-ghost') ? 'new-semester' : 'semester',
        label: node.classList.contains('add-semester-ghost')
          ? 'New Semester'
          : String(node.querySelector('.date p')?.textContent || '').trim(),
        top: rect.top,
        left: rect.left,
        right: rect.right,
        bottom: rect.bottom,
      };
    }).sort((left, right) => (left.top - right.top) || (left.left - right.left));
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    return {
      viewport,
      mobile: document.body.classList.contains('is-mobile'),
      stack: rows,
      documentHorizontalOverflow:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
      visibleStackContained: rows.every((row) => (
        row.right <= viewport.width + 1 && row.left >= -1
      )),
      modelTerms: (window.curriculum?.semesters || []).map((semester) => semester.termName),
    };
  });
}

module.exports = {
  id: 'responsive',
  description: 'Measures dense planner reflow and pins the mobile newest-first/New Semester-first contract.',
  tags: ['responsive', 'mobile', 'planner', 'regression'],

  async run(ctx) {
    assertScenarioContext(ctx);
    const { page } = ctx;
    const phases = [];
    const invariants = [];
    const seeded = await seedFixture(ctx, 'scheduler-light');
    const dates = seeded.fixture?.plan?.dates || [];
    const originalViewport = page.viewportSize() || { width: 1280, height: 800 };
    const viewports = ctx.options?.responsiveViewports || [
      { width: 1440, height: 900 },
      { width: 800, height: 700 },
      { width: 390, height: 844 },
      { width: 568, height: 320 },
      { width: 1280, height: 520 },
    ];
    const snapshots = [];

    try {
      await runPhase(ctx, phases, 'responsive.viewport-matrix', async () => {
        for (const viewport of viewports) {
          await page.setViewportSize(viewport);
          await settleAnimationFrames(page, 3);
          snapshots.push(await responsiveSnapshot(page));
        }
        return snapshots;
      });
    } finally {
      await page.setViewportSize(originalViewport);
      await settleAnimationFrames(page, 3);
    }

    for (const snapshot of snapshots) {
      const labels = snapshot.stack.map((row) => row.label);
      const expected = snapshot.mobile
        ? ['New Semester', ...dates.slice().reverse()]
        : [...dates, 'New Semester'];
      await recordInvariant(
        ctx,
        invariants,
        `responsive.visual-order-${snapshot.viewport.width}x${snapshot.viewport.height}`,
        labels.length === expected.length && labels.every((label, index) => label === expected[index]),
        { expected, actual: labels, mobile: snapshot.mobile },
      );
      await recordInvariant(
        ctx,
        invariants,
        `responsive.no-document-overflow-${snapshot.viewport.width}x${snapshot.viewport.height}`,
        snapshot.documentHorizontalOverflow <= 1
          && (!snapshot.mobile || snapshot.visibleStackContained),
        snapshot,
      );
    }

    return { phases, invariants, metadata: { viewports, snapshots } };
  },
};
