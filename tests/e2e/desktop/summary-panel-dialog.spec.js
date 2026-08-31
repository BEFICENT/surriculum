'use strict';

const { test, expect } = require('../fixtures');
const { seedGradPlan } = require('../helpers/passing-plan');
const {
  REQS,
  openSummary,
  readCard,
  modelTotals,
} = require('../helpers/summary-panel');

test.describe('summary panel', () => {
  test('clicking the Summary icon keeps the newly opened panel visible', async ({ page }) => {
    await seedGradPlan(page, {});
    await page.locator('.summary i').click();
    await expect(page.locator('.summary_modal_overlay')).toBeVisible();
  });

  test('Summary is a labelled modal, traps keyboard focus, and restores its trigger', async ({ page }) => {
    await seedGradPlan(page, {});
    const trigger = page.locator('.summary');
    await trigger.focus();
    await trigger.click();

    const dialog = page.getByRole('dialog', { name: 'Program progress' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    const close = dialog.getByRole('button', { name: 'Close program progress' });
    await expect(close).toBeFocused();

    // Shift+Tab from the first focus target wraps to the last visible control;
    // Tab from there wraps back to Close instead of escaping to the planner.
    await page.keyboard.press('Shift+Tab');
    await expect.poll(() => page.evaluate(() => (
      !!document.activeElement && !!document.activeElement.closest('.summary_overlay_content')
    ))).toBe(true);
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('an open desktop Summary adapts in place when resized to a phone viewport', async ({ page }) => {
    await seedGradPlan(page, {});
    const overlay = await openSummary(page);
    const surface = overlay.locator('.summary_overlay_content');
    const activeCard = surface.locator('.summary_program_card.is-active');
    const detailButton = activeCard.locator('.summary_detail_btn');
    const initialProgram = await surface.evaluate((element) => ({
      kind: element.dataset.activeProgramKind,
      code: element.dataset.activeProgramCode,
      view: element.dataset.summaryView,
    }));

    await detailButton.focus();
    await page.setViewportSize({ width: 320, height: 800 });
    await expect(page.locator('body')).toHaveClass(/is-mobile/);
    await expect(overlay).toBeVisible();
    await expect(detailButton).toBeFocused();
    await expect(surface).toHaveAttribute('data-active-program-kind', initialProgram.kind);
    await expect(surface).toHaveAttribute('data-active-program-code', initialProgram.code);
    await expect(surface).toHaveAttribute('data-summary-view', initialProgram.view);

    const overviewGeometry = await overlay.evaluate((root) => {
      const surfaceElement = root.querySelector('.summary_overlay_content');
      const card = root.querySelector('.summary_program_card.is-active');
      const rect = (element) => {
        const box = element.getBoundingClientRect();
        return { left: box.left, right: box.right };
      };
      const overlayBox = rect(root);
      const surfaceBox = rect(surfaceElement);
      const cardBox = rect(card);
      return {
        surfaceInOverlay: surfaceBox.left >= overlayBox.left - 1 && surfaceBox.right <= overlayBox.right + 1,
        cardInSurface: cardBox.left >= surfaceBox.left - 1 && cardBox.right <= surfaceBox.right + 1,
        overlayOverflow: root.scrollWidth - root.clientWidth,
        surfaceOverflow: surfaceElement.scrollWidth - surfaceElement.clientWidth,
        cardOverflow: card.scrollWidth - card.clientWidth,
      };
    });
    expect(overviewGeometry).toMatchObject({ surfaceInOverlay: true, cardInSurface: true });
    expect(overviewGeometry.overlayOverflow).toBeLessThanOrEqual(1);
    expect(overviewGeometry.surfaceOverflow).toBeLessThanOrEqual(1);
    expect(overviewGeometry.cardOverflow).toBeLessThanOrEqual(1);

    await detailButton.press('Enter');
    await expect(surface).toHaveAttribute('data-summary-view', 'detail');
    const detailPanel = surface.locator('.summary_major_panel:not(.is-hidden)');
    const back = detailPanel.locator('.summary_back_btn');
    await expect(back).toBeFocused();
    const detailGeometry = await detailPanel.evaluate((panel) => {
      const panelBox = panel.getBoundingClientRect();
      const offenders = Array.from(panel.querySelectorAll('*')).map((element) => {
        const box = element.getBoundingClientRect();
        return {
          selector: element.className || element.tagName,
          ownOverflow: element.scrollWidth - element.clientWidth,
          rightOverflow: box.right - panelBox.right,
          width: box.width,
        };
      }).filter((row) => row.ownOverflow > 1 || row.rightOverflow > 1)
        .sort((first, second) => Math.max(second.ownOverflow, second.rightOverflow)
          - Math.max(first.ownOverflow, first.rightOverflow)).slice(0, 5);
      return { overflow: panel.scrollWidth - panel.clientWidth, offenders };
    });
    expect(detailGeometry.overflow, JSON.stringify(detailGeometry.offenders)).toBeLessThanOrEqual(1);

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.locator('body')).not.toHaveClass(/is-mobile/);
    await expect(surface).toHaveAttribute('data-summary-view', 'detail');
    await expect(surface).toHaveAttribute('data-active-program-code', initialProgram.code);
    await expect(back).toBeFocused();
  });

  test('nested content clicks stay inside Summary and Graduation modal boundaries', async ({ page }) => {
    await seedGradPlan(page, {});
    const summary = await openSummary(page);
    await summary.locator('.summary_metric_head span').first().click();
    await expect(summary).toBeVisible();

    await summary.click({ position: { x: 2, y: 2 } });
    await expect(summary).toBeHidden();
    await page.locator('.check').click();
    const graduation = page.locator('.graduation_modal_overlay');
    await expect(graduation).toBeVisible();
    await graduation.locator('.graduation_card_message').first().click();
    await expect(graduation).toBeVisible();
  });

  test('every metric shown matches the engine model and the requirement limits', async ({ page }) => {
    await seedGradPlan(page, {});
    await openSummary(page);

    const card = await readCard(page);
    const model = await modelTotals(page);
    const req = REQS.CS;

    expect(card, 'the summary card should render').not.toBeNull();
    expect(card.title).toContain('Computer Science');

    // The values the student reads must be the engine's own numbers — not a
    // second, independently-derived set.
    const pairs = [
      ['SU Credits', model.total, req.total],
      ['ECTS', model.ects, req.ects],
      ['University', model.university, req.university],
      ['Required', model.required, req.required],
      ['Core', model.core, req.core],
      ['Area', model.area, req.area],
      ['Free', model.free, req.free],
      ['Basic Science', model.science, req.science],
      ['Engineering', model.engineering, req.engineering],
    ];
    for (const [label, value, limit] of pairs) {
      expect(card.rows[label], `the card should have a "${label}" row`).toBeTruthy();
      expect(card.rows[label].value, `${label} value should match the model`).toBeCloseTo(value, 2);
      expect(card.rows[label].limit, `${label} limit should match requirements/202401`).toBe(limit);
    }
    expect(card.rows.CGPA.value, 'CGPA should match the model').toBeCloseTo(model.gpa, 2);
    expect(card.rows.PGPA.value, 'PGPA should match the program-allocation model').toBeCloseTo(model.pgpa, 2);
    for (const label of ['CGPA', 'PGPA']) {
      expect(card.rows[label].scale, `${label} is out of 4.00`).toBe(4);
      expect(card.rows[label].threshold, `${label} uses the engine threshold`)
        .toBe(model.averageThreshold);
      expect(card.rows[label].met, `${label} should pass for the all-A plan`).toBe(true);
    }
  });

  test('the summary agrees with the graduation check about what is met', async ({ page }) => {
    // A complete plan: canGraduate returns 0, so EVERY metric on the card must
    // be at or above its limit. If the two ever disagree the student is told
    // two different things at once.
    await seedGradPlan(page, {});
    expect(await page.evaluate(() => window.curriculum.canGraduate()), 'the plan should graduate').toBe(0);

    await openSummary(page);
    const card = await readCard(page);
    for (const [label, row] of Object.entries(card.rows)) {
      if (row.kind === 'average') {
        expect(row.met, `${label} should be marked met on a graduating plan`).toBe(true);
        expect(row.value, `${label} should clear its graduation threshold`)
          .toBeGreaterThanOrEqual(row.threshold);
        continue;
      }
      expect(row.value, `${label} (${row.value}/${row.limit}) must be met on a graduating plan`)
        .toBeGreaterThanOrEqual(row.limit);
    }
  });

  test('an incomplete plan shows the shortfall rather than hiding it', async ({ page }) => {
    // Drop the internship + a required course; the card must reflect the gap.
    await seedGradPlan(page, { drop: ['CS395', 'CS201'] });
    await openSummary(page);
    const card = await readCard(page);
    const model = await modelTotals(page);

    expect(card.rows.Required.value, 'Required should drop with CS201 gone').toBeCloseTo(model.required, 2);
    expect(card.rows['SU Credits'].value).toBeCloseTo(model.total, 2);
  });

  test('a repeated covered Summary trigger cannot dismiss or stack the panel', async ({ page }) => {
    // The open overlay covers the page trigger in normal use. Even a forced
    // programmatic click must respect the backdrop-only dismissal boundary,
    // while displaySummary's re-entry guard prevents a second card.
    await seedGradPlan(page, {});
    await openSummary(page);
    await expect(page.locator('.summary_modal')).toHaveCount(1);

    await page.locator('.summary').click({ force: true });
    await expect(page.locator('.summary_modal'), 'the covered trigger must not stack cards').toHaveCount(1);
    await expect(page.locator('.summary_modal_overlay'), 'only the actual backdrop may dismiss Summary').toBeVisible();
  });

  test('displaySummary is guarded against building a second card', async ({ page }) => {
    // The toggle above means the button alone can never exercise the guard, so
    // call the global directly — twice, with the panel already open. It bails on
    // an existing .summary_modal. Without that, any re-entry (a re-render, a
    // second caller) would silently double every card.
    await seedGradPlan(page, {});
    await openSummary(page);

    await page.evaluate(() => {
      window.displaySummary(window.curriculum, window.curriculum.major);
      window.displaySummary(window.curriculum, window.curriculum.major);
    });
    await expect(page.locator('.summary_modal'), 're-entry must not stack cards').toHaveCount(1);
    await expect(page.locator('.summary_modal_overlay'), 'nor stack overlays').toHaveCount(1);
  });

  test('"View detailed summary" opens the pool breakdown, and back returns', async ({ page }) => {
    await seedGradPlan(page, {});
    const overlay = await openSummary(page);

    await overlay.locator('.summary_detail_btn').first().click();
    const panel = overlay.locator('.summary_major_panel');
    await expect(panel, 'the detail panel should open').not.toHaveClass(/is-hidden/);
    await expect(overlay.locator('.summary_cards_row'), 'the overview should hide').toHaveClass(/is-hidden/);

    await panel.locator('.summary_back_btn').first().click();
    await expect(panel, 'back should hide the detail panel').toHaveClass(/is-hidden/);
    await expect(overlay.locator('.summary_cards_row'), 'back should restore the overview').not.toHaveClass(/is-hidden/);
  });
});
