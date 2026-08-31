'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');
const {
  TERM_NAME,
  REQS,
  openSummary,
  programTab,
  livePastCurrentFuture,
} = require('../helpers/summary-panel');

test.describe('summary panel', () => {
  test('the detailed summary shows per-group progress that agrees with the engine (VACD)', async ({ page }) => {
    // Phase 4: programs with requirement groups get a "Special requirements"
    // section in the detailed view. It must show the SAME numbers the graduation
    // engine measures (requirementGroupProgress) — the drift guard, applied to
    // the group model this time.
    await seedPlan(page, {
      major: 'VACD',
      entryTerm: TERM_NAME,
      curriculum: [['HART292', 'HART293', 'VA202', 'VA204', 'ECON201']],
      grades: [['A', 'A', 'A', 'A', 'A']],
      dates: [TERM_NAME],
    });
    const overlay = await openSummary(page);
    await overlay.locator('.summary_detail_btn').first().click();

    const section = overlay.locator('.ms-groups-section');
    await expect(section, 'VACD carries groups, so the section renders').toBeVisible();
    await expect(section.locator('.ms-header .ms-title')).toHaveText('SPECIAL REQUIREMENTS');

    // What the student reads on each group row...
    const rendered = await section.locator('.ms-group').evaluateAll((els) => els.map((g) => ({
      label: g.querySelector('.ms-group-label').textContent,
      nums: g.querySelector('.ms-group-nums').textContent,
      met: g.classList.contains('is-met'),
    })));
    // ...must equal the engine's own group progress, row for row and in order.
    const engine = await page.evaluate(() => window.curriculum.requirementGroupProgress('main').map((g) => ({
      label: g.label, nums: `${g.current}/${g.target}`, met: !!g.ok,
    })));
    expect(rendered, 'the summary must not derive its own group numbers').toEqual(engine);

    // A concrete anchor: the art/design-history pool measures base-effective SU,
    // so HART292 + HART293 = 6 of the 9 required.
    const art = rendered.find((r) => r.label === 'Art/Design History');
    expect(art, 'the art/design history pool row is present').toBeTruthy();
    expect(art.nums).toBe('6/9');
    expect(art.met, '6 < 9 is not met').toBe(false);
  });

  test('a double major renders a second card with its own limits', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: TERM_NAME,
      doubleMajor: 'ME',
      entryTermDM: TERM_NAME,
      // Use a course catalogued by both programs. An uncatalogued course now
      // correctly opens the double-major classification prompt before Summary.
      curriculum: [['CS201']],
      grades: [['A']],
      dates: [TERM_NAME],
    });
    const overlay = await openSummary(page);

    await expect(page.locator('.summary_modal'), 'one degree card per program').toHaveCount(2);
    await expect(overlay.locator('.summary_class_level'), 'each degree card explains the same overall standing')
      .toHaveCount(2);
    const limits = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('.summary_modal').forEach((card) => {
        const row = card.querySelector('.summary_metric[data-metric="required"]');
        out.push(row ? Number(row.dataset.limit) : null);
      });
      return out;
    });
    // Each card must use ITS OWN 202401 requirements — CS 29 vs ME 32. Sharing
    // one limit across both is the obvious way for this to break.
    expect(limits.sort((a, b) => a - b), 'CS and ME required limits').toEqual([REQS.CS.required, REQS.ME.required].sort((a, b) => a - b));

    const dmCard = page.locator('.summary_modal').nth(1);
    const mainStanding = page.locator('.summary_modal').nth(0).locator('.summary_class_level');
    const dmStanding = dmCard.locator('.summary_class_level');
    await expect(mainStanding).toHaveCount(1);
    await expect(dmStanding).toHaveCount(1);
    await expect(dmStanding).toHaveAttribute(
      'data-estimated-class-level',
      await mainStanding.getAttribute('data-estimated-class-level'),
    );
    await expect(dmStanding).toHaveAttribute(
      'data-earned-su-credits',
      await mainStanding.getAttribute('data-earned-su-credits'),
    );
    await expect(dmStanding).toContainText('earned SU');
    await expect(dmCard.locator('.summary_metric[data-metric="main_pgpa"] .summary_metric_head span'))
      .toHaveText('Main PGPA');
    await expect(dmCard.locator('.summary_metric[data-metric="pgpa"] .summary_metric_head span'))
      .toHaveText('Double-major PGPA');
    await expect(dmCard.locator('.summary_metric[data-metric="main_pgpa"]'))
      .toHaveAttribute('data-threshold', '3.2');
  });

  test('a selected minor gets an engine-backed compact card and opens its own detail panel', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: TERM_NAME,
      minor1: 'ANALY-MINOR',
      entryTermMinor1: TERM_NAME,
      minor2: 'ANALY-MINOR',
      entryTermMinor2: TERM_NAME,
      curriculum: [['MATH306']],
      grades: [['A']],
      dates: [TERM_NAME],
    });

    const expected = await page.evaluate(() => {
      const fn = window.computeMinorAllocation
        || (typeof computeMinorAllocation === 'function' ? computeMinorAllocation : null);
      const allocation = fn(window.curriculum, 'ANALY-MINOR');
      const layers = {
        earned: { courses: 0, credits: 0 },
        current: { courses: 0, credits: 0 },
        future: { courses: 0, credits: 0 },
        unverified: { courses: 0, credits: 0 },
      };
      Object.values(allocation.allocationByCode || {}).forEach((record) => {
        const state = Object.prototype.hasOwnProperty.call(layers, record.progressState)
          ? record.progressState : 'unverified';
        layers[state].courses += 1;
        layers[state].credits += Number(record.credit) || 0;
      });
      const category = allocation.totals.required || { courses: 0, credits: 0 };
      const categoryReq = allocation.req.categories.required;
      return {
        title: allocation.title,
        term: allocation.req.term,
        cgpa: String(Number(allocation.cgpa)),
        pgpa: String(Number(allocation.pgpa)),
        threshold: String(Number(allocation.gpaThreshold)),
        layers,
        minCourses: String(Number(allocation.req.minCourses)),
        minSu: String(Number(allocation.req.minSU)),
        requiredText: `${category.courses}/${categoryReq.minCourses} courses • ${category.credits}/${categoryReq.minSU} SU`,
      };
    });

    const overlay = await openSummary(page);
    const surface = overlay.locator('.summary_overlay_content');
    const card = overlay.locator(
      '.summary_program_card[data-program-kind="minor"][data-program-code="ANALY-MINOR"]',
    );
    const tab = programTab(surface, 'minor', 'ANALY-MINOR');
    await expect(surface).toHaveAttribute('data-program-count', '2');
    await expect(surface).toHaveClass(/is-multiple/);
    await expect(overlay.locator('.summary_program_section.is-degree .summary_program_card')).toHaveCount(1);
    await expect(overlay.locator('.summary_program_section.is-minor .summary_program_card'),
      'duplicate minor slots collapse to one program card').toHaveCount(1);
    await expect(card).toHaveCount(1);
    await expect(card).toHaveClass(/summary_minor_overview_card/);
    await expect(card).toHaveAttribute('role', 'tabpanel');
    await expect(tab).toHaveAttribute('aria-controls', await card.getAttribute('id'));
    await expect(card).toHaveAttribute('aria-labelledby', await tab.getAttribute('id'));
    await expect(card.locator('.summary_program_role')).toHaveText('Minor');
    await expect(card.locator('.summary_program_code')).toHaveText('ANALY-MINOR');
    await expect(card.locator('.summary_modal_title')).toHaveText(expected.title);
    await expect(card.locator('.summary_program_card_context')).toContainText(`Admit term: ${expected.term}`);

    const cgpa = card.locator('.summary_minor_metric[data-metric="cgpa"]');
    const pgpa = card.locator('.summary_minor_metric[data-metric="pgpa"]');
    await expect(cgpa).toHaveAttribute('data-value', expected.cgpa);
    await expect(cgpa).toHaveAttribute('data-threshold', expected.threshold);
    await expect(pgpa).toHaveAttribute('data-value', expected.pgpa);
    await expect(pgpa).toHaveAttribute('data-threshold', expected.threshold);
    for (const [metric, field, limit] of [
      ['courses', 'courses', expected.minCourses],
      ['su', 'credits', expected.minSu],
    ]) {
      const row = card.locator(`.summary_minor_metric[data-metric="${metric}"]`);
      for (const state of ['earned', 'current', 'future', 'unverified']) {
        await expect(row).toHaveAttribute(`data-${state}`, String(expected.layers[state][field]));
      }
      await expect(row).toHaveAttribute('data-limit', limit);
    }
    await expect(card.locator('.summary_minor_category[data-category="required"] strong'))
      .toHaveText(expected.requiredText);

    await tab.click();
    await expect(card).toHaveClass(/is-active/);
    await expect(card).toBeVisible();
    await card.locator('.summary_detail_btn').click();
    const panel = overlay.locator('.summary_minor_panel');
    await expect(panel).toBeVisible();
    await expect(overlay.locator('.summary_cards_row')).toHaveClass(/is-hidden/);
    await expect(overlay.locator('.summary_header_row'), 'the shared surface header stays fixed in detail')
      .toBeVisible();
    await expect(panel.locator('.summary_minor_panel_title')).toContainText('ANALY-MINOR');
    await expect(panel.locator('.summary_minor_panel_title')).toContainText(expected.title);
    await expect(panel.locator('.summary_minor_switch_btn[data-minor-code="ANALY-MINOR"]'))
      .toHaveClass(/is-active/);

    await panel.locator('.summary_back_btn').click();
    await expect(panel).toHaveClass(/is-hidden/);
    await expect(overlay.locator('.summary_cards_row')).not.toHaveClass(/is-hidden/);
    await expect(card).toBeVisible();
  });

  test('minor completion distinguishes projected courses from fully earned requirements', async ({ page }) => {
    const terms = await livePastCurrentFuture(page);
    const minorCourses = ['OPIM390', 'MGMT203', 'IE405', 'OPIM302', 'CS404', 'CS412'];
    const earnedCourses = minorCourses.slice(0, -1);
    const futureCourse = minorCourses.slice(-1);
    const readCompletion = () => page.evaluate(() => {
      const fn = window.computeMinorAllocation
        || (typeof computeMinorAllocation === 'function' ? computeMinorAllocation : null);
      const current = window.curriculum;
      const progress = current.getGraduationProgress('main');
      const projected = fn(current, 'ANALY-MINOR', { progressGpa: progress.gpa });
      const earned = fn(current, 'ANALY-MINOR', {
        progressGpa: progress.gpa,
        isEligible: (course, semester) => (
          current.getCourseProgressState(course, semester) === 'earned'
        ),
      });
      return { projected: projected.ok, earned: earned.ok };
    });

    await seedPlan(page, {
      major: 'CS',
      entryTerm: TERM_NAME,
      minor1: 'ANALY-MINOR',
      entryTermMinor1: TERM_NAME,
      curriculum: [earnedCourses, futureCourse],
      grades: [earnedCourses.map(() => 'A'), ['A']],
      dates: [terms.past, terms.future],
    });
    expect(await readCompletion(), 'the plan satisfies the minor only after its future course')
      .toEqual({ projected: true, earned: false });

    let overlay = await openSummary(page);
    let card = overlay.locator(
      '.summary_program_card[data-program-kind="minor"][data-program-code="ANALY-MINOR"]',
    );
    await expect(card).toHaveAttribute('data-summary-status', 'projected');
    await expect(card.locator('.summary_program_status')).toHaveClass(/is-projected/);
    await expect(card.locator('.summary_program_status')).toHaveText('Projected complete');
    await expect(card.locator('.summary_program_status')).not.toHaveText('Requirements met');
    await expect(card.locator('.summary_minor_metric[data-metric="courses"]'))
      .toHaveAttribute('data-future', '1');
    await expect(card.locator('.summary_minor_metric[data-metric="su"]'))
      .toHaveAttribute('data-future', '3');
    await overlay.locator('.summary_surface_close').click();
    await expect(overlay).toBeHidden();

    await seedPlan(page, {
      major: 'CS',
      entryTerm: TERM_NAME,
      minor1: 'ANALY-MINOR',
      entryTermMinor1: TERM_NAME,
      curriculum: [minorCourses],
      grades: [minorCourses.map(() => 'A')],
      dates: [terms.past],
    });
    expect(await readCompletion(), 'the same six courses are complete once all are earned')
      .toEqual({ projected: true, earned: true });

    overlay = await openSummary(page);
    card = overlay.locator(
      '.summary_program_card[data-program-kind="minor"][data-program-code="ANALY-MINOR"]',
    );
    await expect(card).toHaveAttribute('data-summary-status', 'complete');
    await expect(card.locator('.summary_program_status')).toHaveClass(/is-complete/);
    await expect(card.locator('.summary_program_status')).toHaveText('Requirements met');
    await expect(card.locator('.summary_minor_metric[data-metric="courses"]'))
      .toHaveAttribute('data-earned', '6');
    await expect(card.locator('.summary_minor_metric[data-metric="su"]'))
      .toHaveAttribute('data-earned', '18');
  });

  test('a minor with unavailable requirements remains explicit and non-interactive', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: TERM_NAME,
      minor1: 'ANALY-MINOR',
      entryTermMinor1: TERM_NAME,
      curriculum: [['MATH306']],
      grades: [['A']],
      dates: [TERM_NAME],
    });
    await page.evaluate(() => {
      window.loadMinorRequirementsForTerm = () => ({});
      window.minorRequirements = {};
    });

    const overlay = await openSummary(page);
    const card = overlay.locator(
      '.summary_program_card[data-program-kind="minor"][data-program-code="ANALY-MINOR"]',
    );
    await programTab(overlay, 'minor', 'ANALY-MINOR').click();
    await expect(card, 'selected minors must not disappear when their requirement data is missing')
      .toHaveCount(1);
    await expect(card).toBeVisible();
    await expect(overlay.locator('.summary_overlay_content')).toHaveAttribute('data-program-count', '2');
    await expect(card).toHaveClass(/is-unavailable/);
    await expect(card).toHaveAttribute('data-summary-status', 'unavailable');
    await expect(card.locator('.summary_minor_unavailable'))
      .toHaveText('Requirements are unavailable for this minor and admit term.');
    await expect(card.locator('.summary_minor_metric')).toHaveCount(0);
    await expect(card.locator('.summary_minor_category')).toHaveCount(0);
    await expect(card.getByRole('button', { name: 'Requirement details unavailable' })).toBeDisabled();
    await expect(overlay.locator('.summary_minor_panel')).toHaveClass(/is-hidden/);
  });
});
