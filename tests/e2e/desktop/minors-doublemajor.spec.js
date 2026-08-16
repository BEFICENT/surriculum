'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');

test.describe('minors + double major (desktop)', () => {
  test('computeMinorAllocation returns a well-formed allocation with GPA gating', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      minor1: 'ANALY-MINOR',
      entryTermMinor1: 'Fall 2024-2025',
      curriculum: [['MATH306', 'OPIM302', 'CS404']],
      grades: [['A', 'A', 'A']],
      dates: ['Fall 2024-2025'],
    });

    const r = await page.evaluate(() => {
      const fn = window.computeMinorAllocation
        || (typeof computeMinorAllocation === 'function' ? computeMinorAllocation : null);
      const res = fn(window.curriculum, 'ANALY-MINOR');
      return {
        error: res.error || null,
        hasTitle: !!res.title,
        totalsCats: res.totals ? Object.keys(res.totals).sort() : null,
        cgpa: res.cgpa,
        gpaOk: res.gpaOk,
        pgpa: res.pgpa,
        pgpaOk: res.pgpaOk,
        averagesOk: res.averagesOk,
      };
    });

    expect(r.error).toBeNull();
    expect(r.hasTitle).toBe(true);
    // The allocation buckets every category the minor can draw from.
    expect(r.totalsCats).toEqual(['area', 'core', 'free', 'required']);
    // CGPA is the plan's overall GPA (all A's) and clears the minor threshold.
    expect(r.cgpa).toBe(4);
    expect(r.gpaOk).toBe(true);
    expect(r.pgpa).toBe(4);
    expect(r.pgpaOk).toBe(true);
    expect(r.averagesOk).toBe(true);
  });

  test('the direct minor GPA gate ignores entered grades in future terms', async ({ page }) => {
    await page.goto('/');
    const future = await page.evaluate(() => {
      const current = String(window.currentTermCode || '');
      const year = Number(current.slice(0, 4));
      const suffix = current.slice(4);
      const code = suffix === '01' ? `${year}02` : (suffix === '02' ? `${year}03` : `${year + 1}01`);
      return window.termCodeToName(code);
    });
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      minor1: 'ANALY-MINOR',
      entryTermMinor1: 'Fall 2024-2025',
      curriculum: [['MATH306']],
      grades: [['A']],
      dates: [future],
    });

    const result = await page.evaluate(() => {
      const fn = window.computeMinorAllocation
        || (typeof computeMinorAllocation === 'function' ? computeMinorAllocation : null);
      const sem = window.curriculum.semesters[0];
      const res = fn(window.curriculum, 'ANALY-MINOR');
      return {
        rawCredits: sem.totalGPACredits,
        cgpaFinite: Number.isFinite(res.cgpa),
        gpaOk: res.gpaOk,
        pgpaFinite: Number.isFinite(res.pgpa),
        pgpaOk: res.pgpaOk,
        projectedPgpa: Number.isFinite(res.projectedPgpa.value)
          ? res.projectedPgpa.value : null,
      };
    });
    expect(result).toEqual({
      rawCredits: 3,
      cgpaFinite: false,
      gpaOk: false,
      pgpaFinite: false,
      pgpaOk: false,
      projectedPgpa: 4,
    });

    await page.locator('.summary').click();
    await page.locator(
      '.summary_program_tab[data-program-kind="minor"][data-program-code="ANALY-MINOR"]',
    ).click();
    await page.locator(
      '.summary_program_card.is-active[data-program-kind="minor"][data-program-code="ANALY-MINOR"] .summary_detail_btn',
    ).click();
    await expect(page.locator('.summary_minor_panel .ms-average-projection'))
      .toContainText('Projected minor PGPA from entered grades: 4.000');
  });

  test('minor completion checks minor PGPA separately from a passing CGPA', async ({ page }) => {
    await page.goto('/');
    const current = await page.evaluate(() => window.currentTermName);
    const outsideMinor = [
      'MATH101', 'MATH102', 'NS101', 'NS102', 'CS201',
      'CS204', 'CS300', 'CS301', 'CS302', 'CS303',
    ];
    const minorCourses = ['OPIM390', 'MGMT203', 'IE405', 'OPIM302', 'CS404', 'CS412'];
    const courses = [...outsideMinor, ...minorCourses];
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      minor1: 'ANALY-MINOR',
      entryTermMinor1: 'Fall 2024-2025',
      curriculum: [courses],
      grades: [courses.map((code) => (minorCourses.includes(code) ? 'D' : 'A'))],
      dates: [current],
    });

    const result = await page.evaluate(() => {
      const fn = window.computeMinorAllocation
        || (typeof computeMinorAllocation === 'function' ? computeMinorAllocation : null);
      const res = fn(window.curriculum, 'ANALY-MINOR');
      return {
        totalCourses: Object.values(res.totals)
          .reduce((sum, category) => sum + category.courses, 0),
        totalCredits: Object.values(res.totals)
          .reduce((sum, category) => sum + category.credits, 0),
        cgpa: res.cgpa,
        cgpaOk: res.cgpaOk,
        pgpa: res.pgpa,
        pgpaOk: res.pgpaOk,
        averagesOk: res.averagesOk,
        ok: res.ok,
      };
    });

    expect(result.totalCourses).toBe(6);
    expect(result.totalCredits).toBe(18);
    expect(result.cgpa).toBeGreaterThanOrEqual(2.72);
    expect(result.cgpaOk).toBe(true);
    expect(result.pgpa).toBe(1);
    expect(result.pgpaOk).toBe(false);
    expect(result.averagesOk).toBe(false);
    expect(result.ok).toBe(false);
  });

  test('a failed minor course enters minor PGPA but not earned minor progress', async ({ page }) => {
    await page.goto('/');
    const current = await page.evaluate(() => window.currentTermName);
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      minor1: 'ANALY-MINOR',
      entryTermMinor1: 'Fall 2024-2025',
      curriculum: [['MATH101', 'MATH306', 'OPIM390']],
      grades: [['A', 'A', 'F']],
      dates: [current],
    });

    const result = await page.evaluate(() => {
      const fn = window.computeMinorAllocation
        || (typeof computeMinorAllocation === 'function' ? computeMinorAllocation : null);
      const res = fn(window.curriculum, 'ANALY-MINOR');
      return {
        earnedCodes: Object.keys(res.allocationByCode),
        membership: Object.fromEntries(Object.entries(res.membershipAllocationByCode)
          .map(([code, record]) => [code, record.allocatedCat])),
        pgpa: res.pgpa,
        pgpaCredits: res.pgpaCredits,
      };
    });

    expect(result.earnedCodes).toContain('MATH306');
    expect(result.earnedCodes).not.toContain('OPIM390');
    expect(result.membership.OPIM390).toBe('required');
    expect(result.membership.MATH101).toBeUndefined();
    expect(result.pgpaCredits).toBe(6);
    expect(result.pgpa).toBe(2);

    await page.locator('.summary').click();
    await page.locator(
      '.summary_program_tab[data-program-kind="minor"][data-program-code="ANALY-MINOR"]',
    ).click();
    await page.locator(
      '.summary_program_card.is-active[data-program-kind="minor"][data-program-code="ANALY-MINOR"] .summary_detail_btn',
    ).click();
    const minorPanel = page.locator('.summary_minor_panel');
    const failedRow = minorPanel.locator('.ms-course').filter({ hasText: 'OPIM390' }).first();
    await expect(failedRow).toHaveClass(/is-unsuccessful/);
    await expect(failedRow).toHaveAttribute('data-course-status', 'unsuccessful');
    await expect(failedRow.locator('.ms-state-chip')).toHaveText('Unsuccessful');
    await expect(minorPanel.locator('.ms-untaken-list .ms-course').filter({ hasText: 'OPIM390' }))
      .toHaveCount(0);
  });

  test('minor detailed summary renders requirement and course metadata as text', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      minor1: 'ANALY-MINOR',
      entryTermMinor1: 'Fall 2024-2025',
      curriculum: [['MATH306']],
      grades: [['A']],
      dates: ['Fall 2024-2025'],
    });

    const literals = await page.evaluate(() => {
      const literal = (slot) => `Literal <span data-summary-injected="${slot}">${slot}</span>`;
      const originalLoader = window.loadMinorRequirementsForTerm;
      window.loadMinorRequirementsForTerm = function wrappedMinorRequirements(termCode) {
        const requirements = originalLoader(termCode);
        const record = requirements && requirements['ANALY-MINOR'];
        if (record) {
          record.name = literal('title');
          record.term = literal('term');
          if (record.categories && record.categories.required) {
            record.categories.required.equivalents = [[literal('equivalence'), 'MATH306']];
          }
        }
        return requirements;
      };

      const records = window.curriculum.minorCourseDataByCode['ANALY-MINOR'];
      const course = records.find((record) => `${record.Major}${record.Code}` === 'MATH306');
      course.Course_Name = literal('course');
      course.SU_credit = `3 ${literal('credit')}`;

      return {
        title: literal('title'),
        term: literal('term'),
        equivalence: literal('equivalence'),
        course: literal('course'),
        credit: literal('credit'),
      };
    });

    await page.locator('.summary').click();
    await page.locator(
      '.summary_program_tab[data-program-kind="minor"][data-program-code="ANALY-MINOR"]',
    ).click();
    await page.locator(
      '.summary_program_card.is-active[data-program-kind="minor"][data-program-code="ANALY-MINOR"] .summary_detail_btn',
    ).click();

    const minorPanel = page.locator('.summary_minor_panel');
    await expect(minorPanel.locator('[data-summary-injected]'), 'markup-like data must not create elements')
      .toHaveCount(0);
    await expect(minorPanel.locator('.summary_minor_panel_title')).toContainText(literals.title);
    await expect(minorPanel.locator('.ms-subtitle').filter({ hasText: 'Admit term' }))
      .toContainText(literals.term);
    await expect(minorPanel.locator('.ms-rules').filter({ hasText: literals.equivalence }))
      .toContainText(literals.equivalence);

    const courseRow = minorPanel.locator('.ms-course').filter({ hasText: 'MATH306' }).first();
    await expect(courseRow.locator('.ms-name')).toContainText(literals.course);
    await expect(courseRow.locator('.ms-meta')).toContainText(literals.credit);
  });

  test('an incomplete double major cannot graduate', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      doubleMajor: 'DSA',
      entryTermDM: 'Fall 2024-2025',
      curriculum: [['MATH101', 'NS101', 'CS201']],
      grades: [['A', 'A', 'A']],
      dates: ['Fall 2024-2025'],
    });

    // canGraduateDouble() mirrors canGraduate(): 0 when done, else a positive
    // flag for the first unmet requirement. This 3-course plan is far from done.
    const dmFlag = await page.evaluate(() => window.curriculum.canGraduateDouble());
    expect(dmFlag).toBeGreaterThan(0);
  });
});
