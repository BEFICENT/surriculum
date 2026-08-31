'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');
const { CS_PASSING_PLAN } = require('../helpers/passing-plan');
const {
  TERM_NAME,
  openSummary,
  livePastCurrentFuture,
} = require('../helpers/summary-panel');

test.describe('summary panel', () => {
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
