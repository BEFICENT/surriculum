'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');
const { seedGradPlan, CS_PASSING_PLAN } = require('../helpers/passing-plan');

// displaySummary() — the progress view behind the "Summary" button, and the
// screen students actually read to see where they stand. ~900 lines of
// graduation_check.js with no coverage until now.
//
// The assertion that matters is that it AGREES WITH THE ENGINE. The summary
// renders its own card from `sem.total*` and its own requirement lookup
// (lookupReq), separate from the one canGraduate uses (getReq) — and this
// codebase's recurring bug has been two parallel implementations of one rule
// drifting apart. A summary that quietly disagreed with the graduation check
// would be worse than either being wrong alone: the student would be told two
// different things.
//
// Frozen term 202401.
const TERM_NAME = 'Fall 2024-2025';
const ROOT = path.resolve(__dirname, '..', '..', '..');
const REQS = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, 'requirements', '202401.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((d) => [d.major, d]),
);

const openSummary = async (page) => {
  await page.locator('.summary').click();
  const overlay = page.locator('.summary_modal_overlay');
  await expect(overlay).toBeVisible({ timeout: 10000 });
  return overlay;
};

const programCard = (root, kind, code) => root.locator(
  `.summary_program_card[data-program-kind="${kind}"][data-program-code="${code}"]`,
);

const programTab = (root, kind, code) => root.locator(
  `.summary_program_tab[data-program-kind="${kind}"][data-program-code="${code}"]`,
);

const livePastCurrentFuture = async (page) => {
  await page.goto('/');
  return page.evaluate(() => {
    const current = String(window.currentTermCode || '');
    const year = Number(current.slice(0, 4));
    const suffix = current.slice(4);
    const pastCode = suffix === '03' ? `${year}02` : (suffix === '02' ? `${year}01` : `${year - 1}03`);
    const futureCode = suffix === '01' ? `${year}02` : (suffix === '02' ? `${year}03` : `${year + 1}01`);
    return {
      past: window.termCodeToName(pastCode),
      current: window.currentTermName,
      future: window.termCodeToName(futureCode),
    };
  });
};

// Parse the visible average and credit rows back out so the test reads what the
// student reads, while retaining the machine-readable graduation threshold.
const readCard = (page) => page.evaluate(() => {
  const card = document.querySelector('.summary_modal');
  if (!card) return null;
  const rows = {};
  card.querySelectorAll('.summary_metric').forEach((metric) => {
    const label = (metric.querySelector('.summary_metric_head span') || {}).textContent || '';
    if (['gpa', 'pgpa', 'main_pgpa'].includes(metric.dataset.metric) && label) {
      rows[label.trim()] = {
        kind: 'average',
        value: metric.dataset.value === '' ? NaN : Number(metric.dataset.value),
        scale: Number(metric.dataset.limit),
        threshold: Number(metric.dataset.threshold),
        met: metric.dataset.met === 'true',
      };
      return;
    }
    if (label) rows[label.trim()] = { value: Number(metric.dataset.projected), limit: Number(metric.dataset.limit) };
  });
  return { title: (card.querySelector('.summary_modal_title') || {}).textContent || '', rows };
});

const modelTotals = (page) => page.evaluate(() => {
  const s = window.curriculum.semesters;
  const sum = (f) => s.reduce((a, x) => a + (x[f] || 0), 0);
  const gpaCredits = sum('totalGPACredits');
  const progress = window.curriculum.getGraduationProgress('main');
  return {
    total: sum('totalCredit'),
    ects: sum('totalECTS'),
    university: sum('totalUniversity'),
    required: sum('totalRequired'),
    core: sum('totalCore'),
    area: sum('totalArea'),
    free: sum('totalFree'),
    science: sum('totalScience'),
    engineering: sum('totalEngineering'),
    gpa: gpaCredits ? Number((sum('totalGPA') / gpaCredits).toFixed(3)) : 0,
    pgpa: Number(progress.pgpa.value),
    averageThreshold: progress.averageThreshold,
  };
});

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

  test('program tabs expose one selected overview card and support keyboard navigation', async ({ page }) => {
    await page.setViewportSize({ width: 821, height: 700 });
    await seedPlan(page, {
      major: 'CS',
      entryTerm: TERM_NAME,
      doubleMajor: 'DSA',
      entryTermDM: TERM_NAME,
      minor1: 'FIN-MINOR',
      entryTermMinor1: TERM_NAME,
      minor2: 'ANALY-MINOR',
      entryTermMinor2: TERM_NAME,
      minor3: 'PHIL-MINOR',
      entryTermMinor3: TERM_NAME,
      curriculum: [['MATH101'], ['CS201']],
      grades: [['A'], ['A']],
      dates: [TERM_NAME, 'Spring 2024-2025'],
    });

    const overlay = await openSummary(page);
    const surface = overlay.locator('.summary_overlay_content');
    const tablist = surface.locator('.summary_program_tabs');
    const tabs = tablist.locator('.summary_program_tab');
    const cards = surface.locator('.summary_program_card');
    const expected = [
      { kind: 'main', code: 'CS' },
      { kind: 'dm', code: 'DSA' },
      { kind: 'minor', code: 'FIN-MINOR' },
      { kind: 'minor', code: 'ANALY-MINOR' },
      { kind: 'minor', code: 'PHIL-MINOR' },
    ];

    await expect(surface).toHaveAttribute('data-program-count', '5');
    await expect(page.locator('body')).not.toHaveClass(/is-mobile/);
    await expect(tablist).toHaveAttribute('role', 'tablist');
    await expect(tabs).toHaveCount(expected.length);
    await expect(cards).toHaveCount(expected.length);

    expect(await tabs.evaluateAll((elements) => elements.map((tab) => ({
      kind: tab.dataset.programKind,
      code: tab.dataset.programCode,
    })))).toEqual(expected);
    expect(await cards.evaluateAll((elements) => elements.map((card) => ({
      kind: card.dataset.programKind,
      code: card.dataset.programCode,
    })))).toEqual(expected);

    const expectSelectedProgram = async (selectedKind, selectedCode) => {
      for (const program of expected) {
        const selected = program.kind === selectedKind && program.code === selectedCode;
        const tab = programTab(surface, program.kind, program.code);
        const card = programCard(surface, program.kind, program.code);
        await expect(tab).toHaveAttribute('role', 'tab');
        await expect(tab).toHaveAttribute('aria-selected', String(selected));
        await expect(tab).toHaveAttribute('tabindex', selected ? '0' : '-1');
        if (selected) {
          await expect(tab).toBeFocused();
          await expect(card).toHaveClass(/is-active/);
          await expect(card).toBeVisible();
        } else {
          await expect(card).not.toHaveClass(/is-active/);
          await expect(card).toBeHidden();
        }
      }
      await expect(surface.locator('.summary_program_card.is-active')).toHaveCount(1);
    };
    const expectFocusedTabInsideRail = async () => {
      await expect.poll(() => tablist.evaluate((rail) => {
        const focusedTab = document.activeElement;
        if (!(focusedTab instanceof HTMLElement) || !focusedTab.matches('.summary_program_tab')) {
          return false;
        }
        const railBox = rail.getBoundingClientRect();
        const tabBox = focusedTab.getBoundingClientRect();
        return tabBox.left >= railBox.left - 1 && tabBox.right <= railBox.right + 1;
      }), {
        message: 'keyboard navigation should scroll the focused tab fully into the 821px rail viewport',
      }).toBe(true);
    };

    const mainTab = programTab(surface, 'main', 'CS');
    await mainTab.focus();
    await expectSelectedProgram('main', 'CS');

    await page.keyboard.press('ArrowRight');
    await expectSelectedProgram('dm', 'DSA');

    await page.keyboard.press('End');
    await expectSelectedProgram('minor', 'PHIL-MINOR');
    await expectFocusedTabInsideRail();

    await page.keyboard.press('Home');
    await expectSelectedProgram('main', 'CS');

    await page.keyboard.press('ArrowLeft');
    await expectSelectedProgram('minor', 'PHIL-MINOR');
    await expectFocusedTabInsideRail();

    await page.keyboard.press('ArrowRight');
    await expectSelectedProgram('main', 'CS');
    await expectFocusedTabInsideRail();

    await programTab(surface, 'minor', 'ANALY-MINOR').click();
    await expectSelectedProgram('minor', 'ANALY-MINOR');
  });

  test('a single-program summary hides its redundant rail and keeps a complete keyboard path', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await seedGradPlan(page, {});

    const trigger = page.locator('.summary');
    await trigger.focus();
    await trigger.click();

    const overlay = page.locator('.summary_modal_overlay');
    const surface = overlay.locator('.summary_overlay_content');
    const tablist = surface.locator('.summary_program_tabs');
    const onlyTab = tablist.locator('.summary_program_tab');
    const card = surface.locator('.summary_program_card.is-active');
    const scrollRegion = surface.locator('[data-summary-scroll-region="overview"]');
    const close = surface.locator('.summary_surface_close');

    await expect(overlay).toBeVisible();
    await expect(surface).toHaveAttribute('data-program-count', '1');
    await expect(surface).not.toHaveClass(/is-multiple/);
    await expect(tablist).toHaveAttribute('aria-hidden', 'true');
    await expect(tablist, 'one program does not need a visible selector rail').toBeHidden();
    await expect(onlyTab).toHaveCount(1);
    await expect(onlyTab).toHaveAttribute('tabindex', '-1');
    await expect(card).toHaveCount(1);
    await expect(card).toBeVisible();
    await expect(close).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(scrollRegion, 'the hidden tab must be skipped in the keyboard order').toBeFocused();
    await page.keyboard.press('Tab');
    const details = card.locator('.summary_detail_btn');
    await expect(details).toBeFocused();
    await page.keyboard.press('Enter');

    const detailPanel = surface.locator('.summary_major_panel');
    await expect(detailPanel).toBeVisible();
    const back = detailPanel.locator('.summary_back_btn');
    await expect(back).toBeFocused();
    await back.click();

    const title = card.locator('.summary_modal_title');
    await expect(title, 'Back has no visible program tab to focus in a single-program summary').toBeFocused();
    await expect(onlyTab).not.toBeFocused();

    await page.keyboard.press('Escape');
    await expect(overlay).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('multi-program overview follows the responsive rail and section-layout contract', async ({ page }) => {
    await page.setViewportSize({ width: 821, height: 600 });
    await seedPlan(page, {
      major: 'CS',
      entryTerm: TERM_NAME,
      doubleMajor: 'DSA',
      entryTermDM: TERM_NAME,
      minor1: 'ANALY-MINOR',
      entryTermMinor1: TERM_NAME,
      curriculum: [['MATH101'], ['CS201']],
      grades: [['A'], ['A']],
      dates: [TERM_NAME, 'Spring 2024-2025'],
    });

    const pageStateBefore = await page.evaluate(() => {
      const board = document.querySelector('.board');
      return {
        document: {
          scrollX: window.scrollX,
          scrollY: window.scrollY,
          htmlOverflow: getComputedStyle(document.documentElement).overflow,
          bodyOverflow: getComputedStyle(document.body).overflow,
        },
        boardOverflowY: getComputedStyle(board).overflowY,
      };
    });
    const programs = [
      { kind: 'main', code: 'CS' },
      { kind: 'dm', code: 'DSA' },
      { kind: 'minor', code: 'ANALY-MINOR' },
    ];
    const viewports = [
      { width: 821, height: 500, singleColumn: true },
      { width: 1024, height: 500, singleColumn: false },
      { width: 1024, height: 768, singleColumn: false },
      { width: 1180, height: 768, singleColumn: false },
      { width: 1280, height: 720, singleColumn: false },
      { width: 1440, height: 500, singleColumn: false },
      { width: 1440, height: 900, singleColumn: false },
    ];

    for (const viewport of viewports) {
      const expectedOrientation = viewport.width >= 1180 && viewport.height >= 620
        ? 'vertical'
        : 'horizontal';
      const existing = page.locator('.summary_modal_overlay');
      if (await existing.count()) {
        await existing.locator('.summary_surface_close').click();
        await expect(existing).toBeHidden();
      }
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const overlay = await openSummary(page);
      const surface = overlay.locator('.summary_overlay_content');
      const header = surface.locator('.summary_header_row');
      const tablist = surface.locator('.summary_program_tabs');
      const scrollRegion = surface.locator('[data-summary-scroll-region="overview"]');

      await expect(page.locator('body')).not.toHaveClass(/is-mobile/);
      await expect(surface).toHaveClass(/is-multiple/);
      await expect(surface).toHaveAttribute('data-program-count', '3');
      await expect(tablist).toBeVisible();
      await expect(tablist).toHaveAttribute('role', 'tablist');
      await expect(tablist).toHaveAttribute('aria-hidden', 'false');
      await expect(tablist).toHaveAttribute('aria-orientation', expectedOrientation);
      await expect(scrollRegion).toHaveAttribute('role', 'region');
      await expect(scrollRegion).toHaveAttribute('aria-label', 'Program progress overview');
      await expect(page.locator('.board')).toHaveCSS('overflow-y', 'hidden');

      for (const program of programs) {
        const tab = programTab(surface, program.kind, program.code);
        const card = programCard(surface, program.kind, program.code);
        await tab.click();
        await expect(tab).toHaveAttribute('aria-selected', 'true');
        await expect(card).toHaveClass(/is-active/);
        await expect(card).toBeVisible();
        await expect(surface.locator('.summary_program_card.is-active')).toHaveCount(1);
        await scrollRegion.evaluate((element) => { element.scrollTop = 0; });
        await page.evaluate(() => new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }));

        const layout = await surface.evaluate((root, expected) => {
          const rect = (element) => {
            const box = element.getBoundingClientRect();
            return {
              left: box.left, right: box.right, top: box.top, bottom: box.bottom,
              width: box.width, height: box.height,
            };
          };
          const visible = (element) => {
            const styles = getComputedStyle(element);
            const box = element.getBoundingClientRect();
            return styles.display !== 'none' && styles.visibility !== 'hidden'
              && box.width > 0 && box.height > 0;
          };
          const insideX = (child, parent, tolerance = 1) => (
            child.left >= parent.left - tolerance && child.right <= parent.right + tolerance
          );
          const inside = (child, parent, tolerance = 1) => (
            insideX(child, parent, tolerance)
            && child.top >= parent.top - tolerance && child.bottom <= parent.bottom + tolerance
          );
          const overlapArea = (first, second) => Math.max(
            0, Math.min(first.right, second.right) - Math.max(first.left, second.left),
          ) * Math.max(
            0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top),
          );
          const surfaceBox = rect(root);
          const headerElement = root.querySelector('.summary_header_row');
          const tabsElement = root.querySelector('.summary_program_tabs');
          const region = root.querySelector('[data-summary-scroll-region="overview"]');
          const card = root.querySelector('.summary_program_card.is-active');
          const identity = card.querySelector('.summary_overview_identity');
          const hero = card.querySelector('.summary_overview_hero');
          const snapshot = card.querySelector('.summary_overview_snapshot');
          const requirements = card.querySelector('.summary_overview_requirements');
          const sections = [identity, hero, snapshot, requirements];
          const headerBox = rect(headerElement);
          const tabsBox = rect(tabsElement);
          const regionBox = rect(region);
          const cardBox = rect(card);
          const identityBox = rect(identity);
          const heroBox = rect(hero);
          const snapshotBox = rect(snapshot);
          const requirementsBox = rect(requirements);
          const identityCopy = identity.querySelector(':scope > .summary_program_identity_copy');
          const heading = identityCopy.querySelector(':scope > .summary_program_card_heading');
          const meta = heading.querySelector(':scope > .summary_program_meta');
          const title = heading.querySelector(':scope > h4.summary_modal_title');
          const context = identityCopy.querySelector(':scope > .summary_program_card_context');
          const term = context.querySelector(':scope > .summary_program_term');
          const footer = identity.querySelector(':scope > .summary_program_card_footer');
          const identityCopyBox = rect(identityCopy);
          const headingBox = rect(heading);
          const metaBox = rect(meta);
          const titleBox = rect(title);
          const contextBox = rect(context);
          const termBox = rect(term);
          const footerBox = footer ? rect(footer) : null;
          const detailButton = footer && footer.querySelector(':scope > .summary_detail_btn');
          const detailButtonBox = detailButton ? rect(detailButton) : null;
          const metaChildBoxes = Array.from(meta.children).map(rect);
          const metaChildCenters = metaChildBoxes.map((box) => (box.top + box.bottom) / 2);
          const metricHeadCollisions = Array.from(card.querySelectorAll('.summary_metric_head'))
            .filter(visible)
            .map((head) => {
              const label = head.querySelector('span');
              const value = head.querySelector('strong');
              return label && value ? overlapArea(rect(label), rect(value)) : 0;
            });
          const actualVerticalOwners = [root, ...root.querySelectorAll('*')]
            .filter(visible)
            .filter((element) => {
              const overflowY = getComputedStyle(element).overflowY;
              return ['auto', 'scroll'].includes(overflowY)
                && element.scrollHeight > element.clientHeight + 1;
            });

          return {
            surfaceInViewport: surfaceBox.left >= -1 && surfaceBox.right <= window.innerWidth + 1
              && surfaceBox.top >= -1 && surfaceBox.bottom <= window.innerHeight + 1,
            headerInsideSurface: insideX(headerBox, surfaceBox),
            headerBeforeWorkspace: headerBox.bottom <= Math.min(tabsBox.top, regionBox.top) + 1,
            railDirection: getComputedStyle(tabsElement).flexDirection,
            horizontalRailPlacement: tabsBox.bottom <= regionBox.top + 1,
            verticalRailPlacement: tabsBox.right <= regionBox.left + 1
              && Math.abs(tabsBox.top - regionBox.top) <= 1,
            cardInsideRegion: insideX(cardBox, regionBox),
            sectionCount: sections.filter(Boolean).length,
            sectionsInsideCard: sections.every((section) => section && insideX(rect(section), cardBox)),
            identityStructure: {
              tag: identity.tagName,
              children: Array.from(identity.children).map((child) => child.classList[0]),
              copyChildren: Array.from(identityCopy.children).map((child) => child.classList[0]),
              headingChildren: Array.from(heading.children).map((child) => child.classList[0]),
              metaChildren: Array.from(meta.children).map((child) => child.classList[0]),
              titleTag: title.tagName,
              contextChildren: Array.from(context.children).map((child) => child.classList[0]),
            },
            identityChildrenInside: [identityCopyBox, footerBox]
              .every((box) => box && inside(box, identityBox)),
            identityContentInside: [headingBox, metaBox, titleBox, contextBox, termBox, detailButtonBox]
              .every((box) => box && inside(box, identityBox)),
            metaSingleRow: metaChildCenters.length > 0
              && Math.max(...metaChildCenters) - Math.min(...metaChildCenters) <= 1,
            titleAndTermLeftAligned: Math.abs(titleBox.left - termBox.left) <= 1
              && Math.abs(titleBox.left - identityCopyBox.left) <= 1,
            wideActionPlacement: footerBox && identityCopyBox.right <= footerBox.left + 1
              && Math.abs(footerBox.right - identityBox.right) <= 1,
            compactActionPlacement: footerBox && identityCopyBox.bottom <= footerBox.top + 1
              && Math.abs(footerBox.left - identityBox.left) <= 1,
            identityBeforeContent: identityBox.bottom <= Math.min(heroBox.top, snapshotBox.top) + 1,
            requirementAfterLeadSections:
              requirementsBox.top >= Math.max(heroBox.bottom, snapshotBox.bottom) - 1,
            leadSectionsStacked: heroBox.bottom <= snapshotBox.top + 1
              && Math.abs(heroBox.left - snapshotBox.left) <= 1
              && Math.abs(heroBox.right - snapshotBox.right) <= 1,
            leadSectionsSideBySide: heroBox.right <= snapshotBox.left + 1
              && Math.abs(heroBox.top - snapshotBox.top) <= 1,
            identityActionOverlap: footerBox ? overlapArea(identityCopyBox, footerBox) : 0,
            maxMetricHeadOverlap: metricHeadCollisions.length
              ? Math.max(...metricHeadCollisions) : 0,
            detailButtonTarget: detailButtonBox
              ? { width: detailButtonBox.width, height: detailButtonBox.height } : null,
            regionOverflowY: getComputedStyle(region).overflowY,
            overlayOverflowY: getComputedStyle(root.closest('.summary_modal_overlay')).overflowY,
            surfaceOverflowY: getComputedStyle(root).overflowY,
            actualOwnerCount: actualVerticalOwners.length,
            actualOwnersAreOverview: actualVerticalOwners.every(
              (element) => element.dataset.summaryScrollRegion === 'overview',
            ),
            regionCanScroll: region.scrollHeight > region.clientHeight + 1,
            regionHorizontalOverflow: region.scrollWidth - region.clientWidth,
            cardHorizontalOverflow: card.scrollWidth - card.clientWidth,
            identityHorizontalOverflow: identity.scrollWidth - identity.clientWidth,
            identityCopyHorizontalOverflow: identityCopy.scrollWidth - identityCopy.clientWidth,
            metaHorizontalOverflow: meta.scrollWidth - meta.clientWidth,
            sectionHorizontalOverflow: Math.max(...sections.map(
              (section) => section.scrollWidth - section.clientWidth,
            )),
            documentHorizontalOverflow:
              document.documentElement.scrollWidth - document.documentElement.clientWidth,
            programKind: card.dataset.programKind,
            programCode: card.dataset.programCode,
            expected,
          };
        }, viewport);

        expect(layout, [
          viewport.width + 'x' + viewport.height,
          program.kind + ':' + program.code,
          'overview geometry',
        ].join(' ')).toMatchObject({
          surfaceInViewport: true,
          headerInsideSurface: true,
          headerBeforeWorkspace: true,
          railDirection: expectedOrientation === 'vertical' ? 'column' : 'row',
          cardInsideRegion: true,
          sectionCount: 4,
          sectionsInsideCard: true,
          identityStructure: {
            tag: 'HEADER',
            children: ['summary_program_identity_copy', 'summary_program_card_footer'],
            copyChildren: ['summary_program_card_heading', 'summary_program_card_context'],
            headingChildren: ['summary_program_meta', 'summary_modal_title'],
            metaChildren: ['summary_program_role', 'summary_program_code', 'summary_program_status'],
            titleTag: 'H4',
            contextChildren: ['summary_program_term'],
          },
          identityChildrenInside: true,
          identityContentInside: true,
          metaSingleRow: true,
          titleAndTermLeftAligned: true,
          identityBeforeContent: true,
          requirementAfterLeadSections: true,
          actualOwnersAreOverview: true,
          regionOverflowY: 'auto',
          overlayOverflowY: 'hidden',
          surfaceOverflowY: 'hidden',
          programKind: program.kind,
          programCode: program.code,
        });
        if (expectedOrientation === 'horizontal') {
          expect(layout.horizontalRailPlacement, 'horizontal program rail belongs above content').toBe(true);
        } else {
          expect(layout.verticalRailPlacement, 'vertical program rail belongs beside content').toBe(true);
        }
        if (viewport.singleColumn) {
          expect(layout.leadSectionsStacked, '821px overview lead sections should stack').toBe(true);
        } else {
          expect(layout.leadSectionsSideBySide, 'wider overview lead sections should sit side by side').toBe(true);
        }
        if (viewport.width <= 900) {
          expect(layout.compactActionPlacement, 'compact header CTA belongs below and left').toBe(true);
        } else {
          expect(layout.wideActionPlacement, 'desktop header CTA belongs to the right of identity copy').toBe(true);
        }
        expect(layout.identityActionOverlap, 'identity copy and detailed-summary action must not collide')
          .toBeLessThanOrEqual(0.5);
        expect(layout.maxMetricHeadOverlap, 'metric labels and values must not collide')
          .toBeLessThanOrEqual(0.5);
        expect(layout.detailButtonTarget).not.toBeNull();
        expect(layout.detailButtonTarget.width, 'detailed-summary action needs a usable target')
          .toBeGreaterThanOrEqual(210);
        expect(layout.detailButtonTarget.height, 'detailed-summary action needs a usable target')
          .toBeGreaterThanOrEqual(42);
        expect(layout.actualOwnerCount, 'there may be at most one active vertical scroll owner')
          .toBeLessThanOrEqual(1);
        expect(layout.regionHorizontalOverflow, 'the overview must not overflow horizontally')
          .toBeLessThanOrEqual(1);
        expect(layout.cardHorizontalOverflow, 'the active card must not clip horizontally')
          .toBeLessThanOrEqual(1);
        expect(layout.identityHorizontalOverflow, 'the reorganized identity header must not clip')
          .toBeLessThanOrEqual(1);
        expect(layout.identityCopyHorizontalOverflow, 'identity copy must stay inside its header column')
          .toBeLessThanOrEqual(1);
        expect(layout.metaHorizontalOverflow, 'role, code, and status must stay inside their row')
          .toBeLessThanOrEqual(1);
        expect(layout.sectionHorizontalOverflow, 'overview sections must not clip horizontally')
          .toBeLessThanOrEqual(1);
        expect(layout.documentHorizontalOverflow, 'Summary must not widen the document')
          .toBeLessThanOrEqual(1);

        if (program.kind === 'main' && layout.regionCanScroll) {
          const fixedTops = await Promise.all([
            header.evaluate((element) => element.getBoundingClientRect().top),
            tablist.evaluate((element) => element.getBoundingClientRect().top),
          ]);
          await scrollRegion.evaluate((element) => { element.scrollTop = element.scrollHeight; });
          await expect.poll(() => scrollRegion.evaluate((element) => element.scrollTop), {
            message: 'the overview card should travel inside its declared scroller',
          }).toBeGreaterThan(0);
          expect(await Promise.all([
            header.evaluate((element) => element.getBoundingClientRect().top),
            tablist.evaluate((element) => element.getBoundingClientRect().top),
          ]), 'surface header and program rail remain fixed while overview content scrolls')
            .toEqual(fixedTops);
        }
        if (program.kind === 'main') {
          const details = card.locator('.summary_detail_btn');
          await details.scrollIntoViewIfNeeded();
          await expect(details, 'the header CTA must be reachable in the overview scroller').toBeVisible();
          expect(await details.evaluate((button) => {
            const region = button.closest('[data-summary-scroll-region="overview"]');
            const buttonBox = button.getBoundingClientRect();
            const regionBox = region.getBoundingClientRect();
            return buttonBox.left >= regionBox.left - 1 && buttonBox.right <= regionBox.right + 1
              && buttonBox.top >= regionBox.top - 1 && buttonBox.bottom <= regionBox.bottom + 1
              && buttonBox.top >= -1 && buttonBox.bottom <= window.innerHeight + 1;
          }), 'the header CTA must be fully inside the active scroll viewport').toBe(true);
          await details.click();
          const detailPanel = surface.locator('.summary_major_panel');
          await expect(detailPanel, 'the reachable header CTA must open requirement details').toBeVisible();
          await detailPanel.locator('.summary_back_btn').first().click();
          await expect(card, 'Back should restore the same selected overview card').toBeVisible();
        }
      }

      await overlay.locator('.summary_surface_close').click();
      await expect(overlay).toBeHidden();
    }

    expect(await page.evaluate(() => {
      const board = document.querySelector('.board');
      return {
        document: {
          scrollX: window.scrollX,
          scrollY: window.scrollY,
          htmlOverflow: getComputedStyle(document.documentElement).overflow,
          bodyOverflow: getComputedStyle(document.body).overflow,
        },
        boardOverflowY: getComputedStyle(board).overflowY,
      };
    }), 'closing Summary restores the background and document state').toEqual(pageStateBefore);
  });

  test('main-major, double-major, and minor detail views return to the selected tab', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: TERM_NAME,
      doubleMajor: 'DSA',
      entryTermDM: TERM_NAME,
      minor1: 'ANALY-MINOR',
      entryTermMinor1: TERM_NAME,
      curriculum: [['MATH101'], ['CS201']],
      grades: [['A'], ['A']],
      dates: [TERM_NAME, 'Spring 2024-2025'],
    });

    const overlay = await openSummary(page);
    const surface = overlay.locator('.summary_overlay_content');
    const scrollRegion = surface.locator('[data-summary-scroll-region="overview"]');

    const exerciseDetail = async ({ kind, code, panelSelector, title }) => {
      const tab = programTab(surface, kind, code);
      const card = programCard(surface, kind, code);
      await tab.click();
      await expect(tab).toHaveAttribute('aria-selected', 'true');
      await expect(card).toHaveClass(/is-active/);
      await expect(card).toBeVisible();
      const overviewPanelId = await card.getAttribute('id');
      const tabId = await tab.getAttribute('id');
      expect(overviewPanelId, `${kind}:${code} overview panel needs a stable id`).toBeTruthy();
      expect(tabId, `${kind}:${code} tab needs a stable id`).toBeTruthy();
      await expect(tab).toHaveAttribute('aria-controls', overviewPanelId);

      await card.locator('.summary_detail_btn').click();
      const panel = surface.locator(panelSelector);
      await expect(scrollRegion, 'the overview should hide while details are open').toBeHidden();
      await expect(panel).toBeVisible();
      await expect(panel.locator('.summary_minor_panel_title')).toContainText(title);
      const backButton = panel.locator('.summary_back_btn');
      const detailPanelId = await panel.getAttribute('id');
      expect(detailPanelId, `${kind}:${code} detail panel needs a stable id`).toBeTruthy();
      await expect(panel).toHaveAttribute('role', 'tabpanel');
      await expect(panel).toHaveAttribute('aria-labelledby', tabId);
      await expect(tab, 'the selected tab must control the panel currently exposed to assistive technology')
        .toHaveAttribute('aria-controls', detailPanelId);
      await expect(backButton, 'detail entry should move focus to the visible Back control').toBeFocused();

      await backButton.click();
      await expect(panel).toBeHidden();
      await expect(scrollRegion).toBeVisible();
      await expect(tab).toHaveAttribute('aria-selected', 'true');
      await expect(tab).toHaveAttribute('tabindex', '0');
      await expect(tab, 'Back should return focus to the selected program tab').toBeFocused();
      await expect(tab, 'the selected tab must control its overview panel again after Back')
        .toHaveAttribute('aria-controls', overviewPanelId);
      await expect(card).toHaveClass(/is-active/);
      await expect(card).toBeVisible();
      await expect(surface.locator('.summary_program_card.is-active')).toHaveCount(1);
    };

    await exerciseDetail({
      kind: 'main',
      code: 'CS',
      panelSelector: '.summary_major_panel',
      title: 'Computer Science and Engineering',
    });
    await exerciseDetail({
      kind: 'dm',
      code: 'DSA',
      panelSelector: '.summary_major_panel',
      title: 'Data Science and Analytics',
    });
    await exerciseDetail({
      kind: 'minor',
      code: 'ANALY-MINOR',
      panelSelector: '.summary_minor_panel',
      title: 'ANALY-MINOR',
    });
  });

  test('major and minor details use sticky section navigation as their sole scroll owner', async ({ page }) => {
    await page.setViewportSize({ width: 821, height: 600 });
    await seedPlan(page, {
      major: 'CS',
      entryTerm: TERM_NAME,
      doubleMajor: 'DSA',
      entryTermDM: TERM_NAME,
      minor1: 'ANALY-MINOR',
      entryTermMinor1: TERM_NAME,
      curriculum: [['MATH101'], ['CS201']],
      grades: [['A'], ['A']],
      dates: [TERM_NAME, 'Spring 2024-2025'],
    });

    const programs = [
      {
        kind: 'main', code: 'CS', panelSelector: '.summary_major_panel',
        scrollRegion: 'major-detail',
      },
      {
        kind: 'minor', code: 'ANALY-MINOR', panelSelector: '.summary_minor_panel',
        scrollRegion: 'minor-detail',
      },
    ];

    for (const viewport of [
      { width: 821, height: 600 },
      { width: 1280, height: 600 },
    ]) {
      const existing = page.locator('.summary_modal_overlay');
      if (await existing.count()) {
        await existing.locator('.summary_surface_close').click();
        await expect(existing).toBeHidden();
      }
      await page.setViewportSize(viewport);
      const overlay = await openSummary(page);
      const surface = overlay.locator('.summary_overlay_content');

      for (const program of programs) {
        const tab = programTab(surface, program.kind, program.code);
        const card = programCard(surface, program.kind, program.code);
        await tab.click();
        await card.locator('.summary_detail_btn').click();

        const panel = surface.locator(program.panelSelector);
        const header = panel.locator('.summary_minor_panel_header');
        const nav = panel.locator('.summary_detail_section_nav');
        const body = panel.locator('.summary_minor_panel_body');
        const links = nav.locator('.summary_detail_section_link');
        await expect(panel).toBeVisible();
        await expect(panel).toHaveAttribute('data-summary-scroll-region', program.scrollRegion);
        await expect(nav).toBeVisible();
        await expect(nav).toHaveAttribute('aria-label', 'Requirement sections');
        await expect(links).not.toHaveCount(0);
        expect(await links.count(), `${program.kind} detail needs more than one navigable requirement section`)
          .toBeGreaterThan(1);

        const relationships = await links.evaluateAll((buttons) => buttons.map((button) => {
          const targetId = button.getAttribute('aria-controls') || '';
          const target = targetId ? document.getElementById(targetId) : null;
          return {
            hasLabel: !!String(button.textContent || '').trim(),
            targetId,
            targetIsSection: !!target && target.classList.contains('ms-section'),
            targetInSamePanel: !!target && target.closest('.summary_scroll_region')
              === button.closest('.summary_scroll_region'),
          };
        }));
        for (const relationship of relationships) {
          expect(relationship.hasLabel).toBe(true);
          expect(relationship.targetId).toBeTruthy();
          expect(relationship.targetIsSection).toBe(true);
          expect(relationship.targetInSamePanel).toBe(true);
        }

        await panel.evaluate((element) => { element.scrollTop = 0; });
        await page.evaluate(() => new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }));
        const geometry = await surface.evaluate((root, panelSelector) => {
          const rect = (element) => {
            const box = element.getBoundingClientRect();
            return {
              left: box.left, right: box.right, top: box.top, bottom: box.bottom,
              width: box.width, height: box.height,
            };
          };
          const visible = (element) => {
            const styles = getComputedStyle(element);
            const box = element.getBoundingClientRect();
            return styles.display !== 'none' && styles.visibility !== 'hidden'
              && box.width > 0 && box.height > 0;
          };
          const insideX = (child, parent, tolerance = 1) => (
            child.left >= parent.left - tolerance && child.right <= parent.right + tolerance
          );
          const panel = root.querySelector(panelSelector);
          const header = panel.querySelector('.summary_minor_panel_header');
          const nav = panel.querySelector('.summary_detail_section_nav');
          const body = panel.querySelector('.summary_minor_panel_body');
          const panelBox = rect(panel);
          const headerBox = rect(header);
          const navBox = rect(nav);
          const bodyBox = rect(body);
          const sectionBoxes = Array.from(body.querySelectorAll('.ms-section')).map(rect);
          const linkBoxes = Array.from(nav.querySelectorAll('.summary_detail_section_link')).map(rect);
          const actualVerticalOwners = [root, ...root.querySelectorAll('*')]
            .filter(visible)
            .filter((element) => {
              const overflowY = getComputedStyle(element).overflowY;
              return ['auto', 'scroll'].includes(overflowY)
                && element.scrollHeight > element.clientHeight + 1;
            });
          return {
            panelInSurface: insideX(panelBox, rect(root)),
            headerInPanel: insideX(headerBox, panelBox),
            navInPanel: insideX(navBox, panelBox),
            bodyInPanel: insideX(bodyBox, panelBox),
            sectionsInBody: sectionBoxes.every((box) => insideX(box, bodyBox)),
            headerBeforeNav: headerBox.bottom <= navBox.top + 1,
            navBeforeBody: navBox.bottom <= bodyBox.top + 1,
            linkTargetsUsable: linkBoxes.every((box) => box.width >= 24 && box.height >= 24),
            panelOverflowY: getComputedStyle(panel).overflowY,
            surfaceOverflowY: getComputedStyle(root).overflowY,
            panelCanScroll: panel.scrollHeight > panel.clientHeight + 1,
            actualOwnerCount: actualVerticalOwners.length,
            actualOwnersArePanel: actualVerticalOwners.every((element) => element === panel),
            panelHorizontalOverflow: panel.scrollWidth - panel.clientWidth,
            bodyHorizontalOverflow: body.scrollWidth - body.clientWidth,
            documentHorizontalOverflow:
              document.documentElement.scrollWidth - document.documentElement.clientWidth,
          };
        }, program.panelSelector);

        expect(geometry, `${viewport.width}x${viewport.height} ${program.kind} detail geometry`)
          .toMatchObject({
            panelInSurface: true,
            headerInPanel: true,
            navInPanel: true,
            bodyInPanel: true,
            sectionsInBody: true,
            headerBeforeNav: true,
            navBeforeBody: true,
            linkTargetsUsable: true,
            panelOverflowY: 'auto',
            surfaceOverflowY: 'hidden',
            panelCanScroll: true,
            actualOwnerCount: 1,
            actualOwnersArePanel: true,
          });
        expect(geometry.panelHorizontalOverflow, 'detail panel must not clip horizontally')
          .toBeLessThanOrEqual(1);
        expect(geometry.bodyHorizontalOverflow, 'detail body must not clip horizontally')
          .toBeLessThanOrEqual(1);
        expect(geometry.documentHorizontalOverflow, 'detail view must not widen the document')
          .toBeLessThanOrEqual(1);

        const stickyTops = {
          header: await header.evaluate((element) => element.getBoundingClientRect().top),
          nav: await nav.evaluate((element) => element.getBoundingClientRect().top),
        };
        await links.last().click();
        await expect.poll(() => panel.evaluate((element) => element.scrollTop), {
          message: 'section navigation should scroll its detail panel',
        }).toBeGreaterThan(0);
        await expect(nav.locator('.summary_detail_section_link[aria-current="true"]')).toHaveCount(1);
        const scrolledTops = {
          header: await header.evaluate((element) => element.getBoundingClientRect().top),
          nav: await nav.evaluate((element) => element.getBoundingClientRect().top),
        };
        expect(scrolledTops.header).toBeCloseTo(stickyTops.header, 1);
        expect(scrolledTops.nav).toBeCloseTo(stickyTops.nav, 1);

        const back = panel.locator('.summary_back_btn');
        await back.click();
        await expect(panel).toBeHidden();
        await expect(tab).toBeFocused();

        await card.locator('.summary_detail_btn').click();
        await expect(panel).toBeVisible();
        await expect.poll(() => panel.evaluate((element) => element.scrollTop), {
          message: 'reopening details should start at the beginning rather than reuse the prior section offset',
        }).toBeLessThanOrEqual(1);
        await expect(panel.locator('.summary_detail_section_link').first())
          .toHaveAttribute('aria-current', 'true');
        await expect(panel.locator('.summary_detail_section_link[aria-current="true"]')).toHaveCount(1);
        await panel.locator('.summary_back_btn').click();
        await expect(panel).toBeHidden();
        await expect(tab).toBeFocused();
      }

      await overlay.locator('.summary_surface_close').click();
      await expect(overlay).toBeHidden();
    }
  });

  test('over-target major and minor progressbars expose valid ARIA bounds', async ({ page }) => {
    const overTargetPlan = Array.from(new Set([
      ...CS_PASSING_PLAN,
      'OPIM390', 'MGMT203', 'IE405', 'OPIM302', 'CS412', 'ECON301',
    ]));
    await seedPlan(page, {
      major: 'CS',
      entryTerm: TERM_NAME,
      minor1: 'ANALY-MINOR',
      entryTermMinor1: TERM_NAME,
      curriculum: [overTargetPlan],
      grades: [overTargetPlan.map(() => 'A')],
      dates: [TERM_NAME],
    });

    const overlay = await openSummary(page);
    const bounds = await overlay.locator('.summary_segment_track[role="progressbar"]')
      .evaluateAll((tracks) => tracks.map((track) => {
        const metric = track.closest('.summary_metric');
        const card = track.closest('.summary_program_card');
        return {
          kind: card && card.dataset.programKind,
          code: card && card.dataset.programCode,
          metric: metric && metric.dataset.metric,
          projected: Number(metric && metric.dataset.projected),
          limit: Number(metric && metric.dataset.limit),
          min: Number(track.getAttribute('aria-valuemin')),
          now: Number(track.getAttribute('aria-valuenow')),
          max: Number(track.getAttribute('aria-valuemax')),
        };
      }));

    expect(bounds.length, 'the overview should expose machine-readable progressbars').toBeGreaterThan(0);
    expect(bounds.some((row) => row.kind === 'main' && row.projected > row.limit),
      'the fixture must exercise an over-target main-major metric').toBe(true);
    expect(bounds.some((row) => row.kind === 'minor' && row.projected > row.limit),
      'the fixture must exercise an over-target minor metric').toBe(true);
    for (const row of bounds) {
      expect(row.now, `${row.kind}:${row.code} ${row.metric} aria-valuenow`).toBe(row.projected);
      expect(row.min, `${row.kind}:${row.code} ${row.metric} aria-valuemin`).toBeLessThanOrEqual(row.now);
      expect(row.max, `${row.kind}:${row.code} ${row.metric} aria-valuemax must contain the current value`)
        .toBeGreaterThanOrEqual(row.now);
      expect(row.max, `${row.kind}:${row.code} ${row.metric} aria-valuemax must contain the requirement target`)
        .toBeGreaterThanOrEqual(row.limit);
    }
  });

  test('credits split into earned, current, future, and needs-grade states', async ({ page }) => {
    const terms = await livePastCurrentFuture(page);
    await seedPlan(page, {
      major: 'CS',
      entryTerm: TERM_NAME,
      curriculum: [
        ['MATH101', 'IF100'],
        ['MATH102', 'NS101'],
        ['NS102'],
      ],
      grades: [
        ['A', ''],
        ['A', ''],
        ['A'],
      ],
      dates: [terms.past, terms.current, terms.future],
    });

    const expected = await page.evaluate(() => {
      const p = window.curriculum.getGraduationProgress('main');
      return {
        breakdown: p.breakdown,
        states: p.courseStates.map((x) => ({ code: x.course.code, state: x.state })),
      };
    });
    expect(expected.states).toEqual(expect.arrayContaining([
      { code: 'MATH101', state: 'earned' },
      { code: 'MATH102', state: 'earned' },
      { code: 'NS101', state: 'current' },
      { code: 'NS102', state: 'future' },
      { code: 'IF100', state: 'unverified' },
    ]));
    for (const [metric, split] of Object.entries(expected.breakdown)) {
      for (const state of ['earned', 'current', 'future', 'unverified']) {
        expect(split[state], `${metric}.${state} must never be negative`).toBeGreaterThanOrEqual(0);
      }
      expect(split.earned + split.current + split.future + split.unverified,
        `${metric} segments should add up to projected`).toBeCloseTo(split.projected, 8);
    }

    const overlay = await openSummary(page);
    const row = overlay.locator('.summary_metric[data-metric="total"]').first();
    await expect(row).toHaveAttribute('data-earned', String(expected.breakdown.total.earned));
    await expect(row).toHaveAttribute('data-current', String(expected.breakdown.total.current));
    await expect(row).toHaveAttribute('data-future', String(expected.breakdown.total.future));
    await expect(row).toHaveAttribute('data-unverified', String(expected.breakdown.total.unverified));
    await expect(row.locator('.summary_metric_legacy')).toHaveAttribute('aria-hidden', 'true');
    await expect(row.locator('.summary_metric_equation')).toContainText('earned');
    await expect(row.locator('.summary_metric_equation')).toContainText('current');
    await expect(row.locator('.summary_metric_equation')).toContainText('future');
    await expect(row.locator('.summary_metric_equation')).toContainText('needs grade');

    await overlay.locator('.summary_detail_btn').first().click();
    const chips = overlay.locator('.major-summary .ms-state-chip');
    const chipTexts = await chips.allTextContents();
    expect(chipTexts).toEqual(expect.arrayContaining(['Earned', 'Current', 'Future', 'Needs grade']));
  });

  test('estimated class level uses all earned SU but not unfinished current or future plan credits', async ({ page }) => {
    const terms = await livePastCurrentFuture(page);
    const earned31 = [
      'HIST191', 'HIST192', 'IF100', 'MATH101', 'MATH102',
      'NS101', 'NS102', 'SPS101', 'SPS102', 'MATH212',
    ];
    await seedPlan(page, {
      major: 'CS',
      entryTerm: TERM_NAME,
      curriculum: [earned31, ['CS201'], ['CS204']],
      grades: [earned31.map(() => 'A'), [''], ['A']],
      dates: [terms.past, terms.current, terms.future],
    });

    let progress = await page.evaluate(() => {
      const value = window.curriculum.getGraduationProgress('main');
      return {
        earnedSuCredits: value.earnedSuCredits,
        estimatedClassLevel: value.estimatedClassLevel.label,
        projectedDegreeCredits: value.breakdown.total.projected,
      };
    });
    expect(progress).toEqual({
      earnedSuCredits: 31,
      estimatedClassLevel: 'Freshman',
      projectedDegreeCredits: 37,
    });

    let overlay = await openSummary(page);
    let classRow = overlay.locator('.summary_class_level');
    await expect(classRow).toHaveCount(1);
    await expect(classRow).toHaveAttribute('data-estimated-class-level', 'Freshman');
    await expect(classRow).toHaveAttribute('data-earned-su-credits', '31');
    await expect(classRow).toContainText('31 earned SU');
    await expect(classRow).toContainText('3 SU to Sophomore');
    await expect(classRow.locator('.summary_metric_equation')).toHaveAttribute(
      'title',
      'Estimated from earned SU only. Current-term, future, needs-grade, and unsuccessful courses are excluded.',
    );

    await overlay.click({ position: { x: 2, y: 2 } });
    await expect(overlay).toBeHidden();
    await page.evaluate(() => {
      const course = window.curriculum.semesters
        .flatMap((semester) => semester.courses || [])
        .find((candidate) => candidate && candidate.code === 'CS201');
      course.grade = 'A';
    });

    progress = await page.evaluate(() => {
      const value = window.curriculum.getGraduationProgress('main');
      return {
        earnedSuCredits: value.earnedSuCredits,
        estimatedClassLevel: value.estimatedClassLevel.label,
      };
    });
    expect(progress).toEqual({ earnedSuCredits: 34, estimatedClassLevel: 'Sophomore' });

    overlay = await openSummary(page);
    classRow = overlay.locator('.summary_class_level');
    await expect(classRow).toHaveAttribute('data-estimated-class-level', 'Sophomore');
    await expect(classRow).toHaveAttribute('data-earned-su-credits', '34');
    await overlay.click({ position: { x: 2, y: 2 } });
    await expect(overlay).toBeHidden();

    await page.locator('.check').click();
    const graduation = page.locator('.graduation_modal_overlay');
    await expect(graduation).toBeVisible();
    const standingDetails = graduation.locator('.graduation_meta_item')
      .filter({ hasText: 'Estimated class level:' });
    await expect(standingDetails).toHaveCount(1);
    await expect(standingDetails).toContainText('Sophomore (34 earned SU overall');
  });

  test('earned summary segments agree with an independently complete earned audit', async ({ page }) => {
    const terms = await livePastCurrentFuture(page);
    const earnedCourses = CS_PASSING_PLAN.filter((code) => code !== 'BIO310');
    await seedPlan(page, {
      major: 'CS',
      entryTerm: TERM_NAME,
      curriculum: [earnedCourses, ['BIO310'], ['MATH212']],
      grades: [earnedCourses.map(() => 'A'), [''], ['A']],
      dates: [terms.past, terms.current, terms.future],
    });

    const audit = await page.evaluate(() => {
      const p = window.curriculum.getGraduationProgress('main');
      const exact = p.layers.earned.totals;
      const rows = {};
      for (const key of ['total', 'ects', 'university', 'required', 'core', 'area', 'free', 'science', 'engineering']) {
        rows[key] = { displayedEarned: p.breakdown[key].earned, exactEarned: exact[key] };
      }
      return { earnedFlag: p.earnedFlag, status: p.status, rows };
    });
    expect(audit.earnedFlag).toBe(0);
    expect(audit.status).toBe('complete');
    for (const [metric, values] of Object.entries(audit.rows)) {
      expect(values.displayedEarned, `${metric} should show the earned audit allocation`)
        .toBeCloseTo(values.exactEarned, 8);
    }

    const overlay = await openSummary(page);
    for (const [metric, values] of Object.entries(audit.rows)) {
      await expect(overlay.locator(`.summary_metric[data-metric="${metric}"]`).first())
        .toHaveAttribute('data-earned', String(values.exactEarned));
    }
    await overlay.locator('.summary_detail_btn').first().click();
    const earnedAlternative = overlay.locator('.major-summary .ms-course').filter({ hasText: 'MATH201' }).first();
    await expect(earnedAlternative).not.toHaveClass(/is-missing/);
    await expect(earnedAlternative).toContainText('Earned');
  });

  test('future-only entered grades do not appear as an actual GPA', async ({ page }) => {
    const terms = await livePastCurrentFuture(page);
    await seedPlan(page, {
      major: 'CS',
      entryTerm: TERM_NAME,
      doubleMajor: 'ME',
      entryTermDM: TERM_NAME,
      curriculum: [['MATH101']],
      grades: [['D']],
      dates: [terms.future],
    });

    const gpa = await page.evaluate(() => {
      const sem = window.curriculum.semesters[0];
      const actual = window.curriculum.getActualGpa();
      const progress = window.curriculum.getGraduationProgress('main').gpa;
      return {
        // The raw cache deliberately retains the entered grade; consumers must
        // not mistake it for an actual GPA while its term is still future.
        rawCredits: sem.totalGPACredits,
        rawPoints: sem.totalGPA,
        actualCredits: actual.credits,
        actualPoints: actual.points,
        actualFinite: Number.isFinite(actual.value),
        progressCredits: progress.credits,
      };
    });
    expect(gpa).toEqual({
      rawCredits: 3,
      rawPoints: 3,
      actualCredits: 0,
      actualPoints: 0,
      actualFinite: false,
      progressCredits: 0,
    });

    const overlay = await openSummary(page);
    const cgpaRows = overlay.locator('.summary_metric[data-metric="gpa"]');
    const pgpaRows = overlay.locator('.summary_metric[data-metric="pgpa"]');
    const mainPgpaRow = overlay.locator('.summary_metric[data-metric="main_pgpa"]');
    await expect(cgpaRows).toHaveCount(2);
    await expect(pgpaRows).toHaveCount(2);
    await expect(mainPgpaRow).toHaveCount(1);
    await expect(cgpaRows.nth(0).locator('p')).toHaveText('CGPA: N/A / 4.00');
    await expect(cgpaRows.nth(1).locator('p')).toHaveText('CGPA: N/A / 4.00');
    await expect(pgpaRows.nth(0).locator('p')).toHaveText('PGPA: N/A / 4.00');
    await expect(pgpaRows.nth(1).locator('p')).toHaveText('Double-major PGPA: N/A / 4.00');
    await expect(mainPgpaRow.locator('p')).toHaveText('Main PGPA: N/A / 4.00');
    for (const row of [pgpaRows.nth(0), pgpaRows.nth(1), mainPgpaRow]) {
      await expect(row.locator('.summary_gpa_projection'))
        .toContainText('Entered-grade projection: 1.000');
    }
  });

  test('posted current-term grades appear in the actual GPA immediately', async ({ page }) => {
    const terms = await livePastCurrentFuture(page);
    await seedPlan(page, {
      major: 'CS',
      entryTerm: TERM_NAME,
      curriculum: [['MATH101', 'MATH102']],
      grades: [['A', 'B']],
      dates: [terms.current],
    });

    const gpa = await page.evaluate(() => {
      const actual = window.curriculum.getActualGpa();
      const graduation = window.curriculum.getGraduationProgress('main');
      const progress = graduation.gpa;
      return {
        actual: { value: actual.value, credits: actual.credits, points: actual.points },
        progress: { value: progress.value, credits: progress.credits, points: progress.points },
        pgpa: {
          value: graduation.pgpa.value,
          credits: graduation.pgpa.credits,
          points: graduation.pgpa.points,
        },
      };
    });
    expect(gpa.actual).toEqual({ value: 3.5, credits: 6, points: 21 });
    expect(gpa.progress).toEqual(gpa.actual);
    expect(gpa.pgpa).toEqual(gpa.actual);

    const overlay = await openSummary(page);
    await expect(overlay.locator('.summary_metric[data-metric="gpa"]').first().locator('p'))
      .toHaveText('CGPA: 3.500 / 4.00');
    await expect(overlay.locator('.summary_metric[data-metric="pgpa"]').first().locator('p'))
      .toHaveText('PGPA: 3.500 / 4.00');
  });

  test('an explicit future F is unsuccessful in overview and detail', async ({ page }) => {
    const terms = await livePastCurrentFuture(page);
    await seedPlan(page, {
      major: 'CS',
      entryTerm: TERM_NAME,
      curriculum: [['MATH101'], ['MATH102']],
      grades: [['A'], ['F']],
      dates: [terms.past, terms.future],
    });
    const state = await page.evaluate(() => {
      const p = window.curriculum.getGraduationProgress('main');
      const failed = p.courseStates.find((row) => row.course.code === 'MATH102');
      return { state: failed.state, total: p.breakdown.total.projected,
        gpa: p.gpa.value, gpaCredits: p.gpa.credits,
        normalEffective: failed.course.effective_type };
    });
    expect(state).toEqual({ state: 'unsuccessful', total: 3, gpa: 4, gpaCredits: 3, normalEffective: 'none' });

    const overlay = await openSummary(page);
    await expect(overlay.locator('.summary_metric[data-metric="total"]').first())
      .toHaveAttribute('data-projected', '3');
    await overlay.locator('.summary_detail_btn').first().click();
    const failedRow = overlay.locator('.major-summary .ms-course').filter({ hasText: 'MATH102' }).first();
    await expect(failedRow).toHaveClass(/is-unsuccessful/);
    await expect(failedRow).toHaveAttribute('data-course-status', 'unsuccessful');
    await expect(failedRow.locator('.ms-state-chip')).toHaveText('Unsuccessful');
    await expect(overlay.locator('.major-summary .ms-untaken-list .ms-course').filter({ hasText: 'MATH102' }))
      .toHaveCount(0);

    const untakenToggle = overlay.locator('.major-summary .ms-untaken-toggle').first();
    await untakenToggle.click();
    const untakenRow = overlay.locator('.major-summary .ms-untaken-list:not(.is-hidden) .ms-course.is-missing').first();
    await expect(untakenRow).toHaveAttribute('data-course-status', 'not-taken');
    await expect(untakenRow.locator('.ms-state-chip')).toHaveText('Not taken');
  });

  test('a future basic-language course beyond the cap is shown as excluded', async ({ page }) => {
    const terms = await livePastCurrentFuture(page);
    await seedPlan(page, {
      major: 'ECON',
      entryTerm: TERM_NAME,
      curriculum: [['FRE110', 'FRE120'], ['GER110']],
      grades: [['A', 'A'], ['A']],
      dates: [terms.past, terms.future],
    });

    const overlay = await openSummary(page);
    await overlay.locator('.summary_detail_btn').first().click();
    const group = overlay.locator('.ms-group').filter({ hasText: 'beginning/basic language cap' });
    await expect(group).toHaveCount(1);
    await expect(group).not.toHaveClass(/is-over/);
    await expect(group.locator('.ms-group-nums')).toHaveText('2/2');
    await expect(group.locator('.ms-group-earned')).toHaveText('2 earned');
    await expect(group.locator('.ms-group-badge')).toHaveText('OK');
    await expect(group).toContainText('1 additional basic language course excluded from degree credit');
  });
});
