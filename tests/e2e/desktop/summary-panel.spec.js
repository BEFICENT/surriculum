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

  test('clicking Summary again closes the panel rather than stacking one', async ({ page }) => {
    // A document-level handler removes the overlay on any click outside the
    // card — and the Summary button is outside it. So the button toggles.
    await seedGradPlan(page, {});
    await openSummary(page);
    await expect(page.locator('.summary_modal')).toHaveCount(1);

    await page.locator('.summary').click({ force: true });
    await expect(page.locator('.summary_modal'), 'the second click should close it').toHaveCount(0);
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
      curriculum: [['CS201', 'ME201']],
      grades: [['A', 'A']],
      dates: [TERM_NAME],
    });
    await openSummary(page);

    await expect(page.locator('.summary_modal'), 'one card per program').toHaveCount(2);
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
    await expect(dmCard.locator('.summary_metric[data-metric="main_pgpa"] .summary_metric_head span'))
      .toHaveText('Main PGPA');
    await expect(dmCard.locator('.summary_metric[data-metric="pgpa"] .summary_metric_head span'))
      .toHaveText('Double-major PGPA');
    await expect(dmCard.locator('.summary_metric[data-metric="main_pgpa"]'))
      .toHaveAttribute('data-threshold', '3.2');
  });

  test('a wrapped double-major summary remains reachable on a short viewport', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 1000 });
    await seedPlan(page, {
      major: 'CS',
      entryTerm: TERM_NAME,
      doubleMajor: 'ME',
      entryTermDM: TERM_NAME,
      curriculum: [['CS201', 'ME201']],
      grades: [['A', 'A']],
      dates: [TERM_NAME],
    });
    const overlay = await openSummary(page);
    const cards = overlay.locator('.summary_modal');
    await expect(cards).toHaveCount(2);
    expect(await overlay.evaluate((el) => getComputedStyle(el).overflowY)).toBe('auto');

    for (const card of [cards.first(), cards.last()]) {
      await card.scrollIntoViewIfNeeded();
      const box = await card.boundingBox();
      expect(box, 'the summary card should have a rendered box').not.toBeNull();
      expect(box.y, 'the card top should be reachable').toBeGreaterThanOrEqual(0);
      expect(box.y + box.height, 'the card bottom should be reachable').toBeLessThanOrEqual(1001);
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
    await expect(overlay.locator('.major-summary .ms-course').filter({ hasText: 'MATH102' }).first())
      .toHaveClass(/is-missing/);
  });

  test('a future course that exceeds a cap is shown as over-limit', async ({ page }) => {
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
    await expect(group).toHaveClass(/is-over/);
    await expect(group.locator('.ms-group-nums')).toHaveText('3/2');
    await expect(group.locator('.ms-group-earned')).toHaveText('2 earned');
    await expect(group.locator('.ms-group-badge')).toHaveText('Over limit');
    await expect(overlay.locator('.ms-groups-section .ms-header .ms-req')).toContainText('projected');
  });
});
