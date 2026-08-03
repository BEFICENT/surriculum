'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');
const { CS_PASSING_PLAN } = require('../helpers/passing-plan');

const ENTRY_TERM = 'Fall 2024-2025';

const liveTerms = async (page) => {
  await page.goto('/');
  return page.evaluate(() => {
    const current = String(window.currentTermCode || '');
    const year = Number(current.slice(0, 4));
    const suffix = current.slice(4);
    const pastCode = suffix === '03' ? `${year}02`
      : (suffix === '02' ? `${year}01` : `${year - 1}03`);
    const futureCode = suffix === '01' ? `${year}02`
      : (suffix === '02' ? `${year}03` : `${year + 1}01`);
    return {
      past: window.termCodeToName(pastCode),
      current: window.currentTermName,
      future: window.termCodeToName(futureCode),
    };
  });
};

const setGradingBases = (page, bases) => page.evaluate((basisByCode) => {
  for (const semester of window.curriculum.semesters || []) {
    for (const course of semester.courses || []) {
      if (Object.prototype.hasOwnProperty.call(basisByCode, course.code)) {
        course.gradingBasis = basisByCode[course.code];
      }
    }
  }
}, bases);

const readPolicySnapshot = (page) => page.evaluate(() => {
  const progress = window.curriculum.getGraduationProgress('main');
  const actual = window.curriculum.getActualGpa();
  const unresolved = actual && (
    actual.unresolved === true
    || actual.resolved === false
    || String(actual.status || '').toLowerCase() === 'unresolved'
  );
  const courses = {};
  for (const row of progress.courseStates || []) {
    courses[row.course.code] = {
      state: row.state,
      eligible: window.curriculum.isDegreeEligibleCourse(row.course),
      basis: row.course.gradingBasis,
    };
  }
  return {
    policyReady: !!window.gradePolicy
      && typeof window.gradePolicy.normalizeGrade === 'function'
      && typeof window.gradePolicy.normalizeGradingBasis === 'function'
      && typeof window.gradePolicy.inferGradingBasis === 'function'
      && typeof window.gradePolicy.evaluateGrade === 'function',
    courses,
    total: progress.breakdown.total,
    gpa: {
      credits: Number(actual.credits || 0),
      points: Number(actual.points || 0),
      value: Number.isFinite(actual.value) ? actual.value : null,
      unresolved: !!unresolved,
    },
    status: progress.status,
    earnedFlag: progress.earnedFlag,
    projectedFlag: progress.projectedFlag,
    legacyFlag: window.curriculum.canGraduate(),
  };
});

test.describe('central grade policy (desktop)', () => {
  test('current and past S, plus T, earn degree credit without entering GPA', async ({ page }) => {
    const terms = await liveTerms(page);
    await seedPlan(page, {
      major: 'CS', entryTerm: ENTRY_TERM,
      curriculum: [['MATH101'], ['MATH102', 'MATH201']],
      grades: [['S'], ['S', 'T']],
      dates: [terms.past, terms.current],
    });
    await setGradingBases(page, {
      MATH101: 'satisfactory',
      MATH102: 'satisfactory',
      MATH201: 'letter',
    });

    const result = await readPolicySnapshot(page);
    expect(result.policyReady).toBe(true);
    expect(result.courses.MATH101.state).toBe('earned');
    expect(result.courses.MATH102.state).toBe('earned');
    expect(result.courses.MATH201.state).toBe('earned');
    expect(result.total.earned).toBe(9);
    expect(result.total.projected).toBe(9);
    expect(result.gpa).toEqual({ credits: 0, points: 0, value: null, unresolved: false });
  });

  test('an otherwise complete all-S plan is only projected-complete without a computable GPA', async ({ page }) => {
    const terms = await liveTerms(page);
    await seedPlan(page, {
      major: 'CS', entryTerm: ENTRY_TERM,
      curriculum: [[...CS_PASSING_PLAN]],
      grades: [CS_PASSING_PLAN.map(() => 'S')],
      dates: [terms.current],
    });

    const result = await readPolicySnapshot(page);
    expect(result.gpa).toEqual({ credits: 0, points: 0, value: null, unresolved: false });
    expect(result.earnedFlag).toBe(38);
    expect(result.projectedFlag).toBe(0);
    // The legacy method represents the forward-looking plan; the earned audit
    // above is the authoritative graduation decision when no GPA exists yet.
    expect(result.legacyFlag).toBe(0);
    expect(result.status).toBe('projected');
  });

  test('F loses degree credit but remains a zero-point GPA attempt', async ({ page }) => {
    const terms = await liveTerms(page);
    await seedPlan(page, {
      major: 'CS', entryTerm: ENTRY_TERM,
      curriculum: [['MATH101']], grades: [['F']], dates: [terms.current],
    });
    await setGradingBases(page, { MATH101: 'letter' });

    const directGpa = await page.evaluate(() => window.curriculum.getActualGpa());
    expect(directGpa.credits).toBe(3);
    expect(directGpa.points).toBe(0);
    expect(directGpa.value).toBe(0);
    expect(directGpa.resolved).toBe(true);

    const result = await readPolicySnapshot(page);
    expect(result.courses.MATH101.eligible).toBe(false);
    expect(result.total.earned).toBe(0);
    expect(result.total.projected).toBe(0);
    expect(result.gpa).toEqual({ credits: 3, points: 0, value: 0, unresolved: false });
  });

  test('U and W earn no degree credit and remain GPA-neutral', async ({ page }) => {
    const terms = await liveTerms(page);
    await seedPlan(page, {
      major: 'CS', entryTerm: ENTRY_TERM,
      curriculum: [['MATH101', 'MATH102']], grades: [['U', 'W']], dates: [terms.current],
    });
    await setGradingBases(page, { MATH101: 'satisfactory', MATH102: 'unknown' });

    const result = await readPolicySnapshot(page);
    expect(result.courses.MATH101.eligible).toBe(false);
    expect(result.courses.MATH102.eligible).toBe(false);
    expect(result.total.earned).toBe(0);
    expect(result.total.projected).toBe(0);
    expect(result.gpa).toEqual({ credits: 0, points: 0, value: null, unresolved: false });
  });

  test('P and I stay projected in the current term without becoming earned or GPA-bearing', async ({ page }) => {
    const terms = await liveTerms(page);
    await seedPlan(page, {
      major: 'CS', entryTerm: ENTRY_TERM,
      curriculum: [['MATH101', 'MATH102']], grades: [['P', 'I']], dates: [terms.current],
    });
    await setGradingBases(page, { MATH101: 'unknown', MATH102: 'unknown' });

    const result = await readPolicySnapshot(page);
    expect(result.courses.MATH101.state).toBe('current');
    expect(result.courses.MATH102.state).toBe('current');
    expect(result.total.earned).toBe(0);
    expect(result.total.current).toBe(6);
    expect(result.total.projected).toBe(6);
    expect(result.gpa).toEqual({ credits: 0, points: 0, value: null, unresolved: false });
  });

  for (const [basis, expectedGpa] of [
    ['letter', { credits: 3, points: 0, value: 0, unresolved: false }],
    ['satisfactory', { credits: 0, points: 0, value: null, unresolved: false }],
  ]) {
    test(`NA on the ${basis} basis follows ${basis === 'letter' ? 'F' : 'U'} policy`, async ({ page }) => {
      const terms = await liveTerms(page);
      await seedPlan(page, {
        major: 'CS', entryTerm: ENTRY_TERM,
        curriculum: [['MATH101']], grades: [['NA']], dates: [terms.current],
      });
      await setGradingBases(page, { MATH101: basis });

      const result = await readPolicySnapshot(page);
      expect(result.courses.MATH101.eligible).toBe(false);
      expect(result.total.earned).toBe(0);
      expect(result.total.projected).toBe(0);
      expect(result.gpa).toEqual(expectedGpa);
    });
  }

  test('NA with an unknown basis makes GPA unresolved and graduation fails closed', async ({ page }) => {
    const terms = await liveTerms(page);
    const courses = [...CS_PASSING_PLAN, 'CS460'];
    await seedPlan(page, {
      major: 'CS', entryTerm: ENTRY_TERM,
      curriculum: [courses],
      grades: [courses.map((code) => (code === 'CS460' ? 'NA' : 'A'))],
      dates: [terms.current],
    });
    await setGradingBases(page, { CS460: 'unknown' });

    const result = await readPolicySnapshot(page);
    expect(result.courses.CS460.eligible).toBe(false);
    expect(result.gpa.unresolved).toBe(true);
    expect(result.earnedFlag).toBe(38);
    expect(result.projectedFlag).toBe(38);
    expect(result.status).toBe('incomplete');
    expect(result.legacyFlag).toBe(38);

    await page.locator('.summary').click();
    const gpaMetric = page.locator('.summary_modal .summary_metric[data-metric="gpa"]').first();
    await expect(gpaMetric).toHaveAttribute('data-gpa-resolved', 'false');
    await expect(gpaMetric.locator('.summary_gpa_warning')).toContainText('CS460');
  });

  test('unknown grades and A+ fail closed instead of earning or projecting credit', async ({ page }) => {
    const terms = await liveTerms(page);
    await seedPlan(page, {
      major: 'CS', entryTerm: ENTRY_TERM,
      curriculum: [['MATH101', 'MATH102']], grades: [['', '']], dates: [terms.current],
    });
    await page.evaluate(() => {
      const courses = window.curriculum.semesters[0].courses;
      courses.find((course) => course.code === 'MATH101').grade = 'X';
      courses.find((course) => course.code === 'MATH102').grade = 'A+';
    });
    await setGradingBases(page, { MATH101: 'letter', MATH102: 'letter' });

    const result = await readPolicySnapshot(page);
    expect(result.courses.MATH101.eligible).toBe(false);
    expect(result.courses.MATH102.eligible).toBe(false);
    expect(result.total.earned).toBe(0);
    expect(result.total.current).toBe(0);
    expect(result.total.future).toBe(0);
    expect(result.total.projected).toBe(0);
    expect(result.gpa.credits).toBe(0);
    expect(result.gpa.points).toBe(0);
  });

  test('future letter grades stay out of actual GPA while a posted current grade counts', async ({ page }) => {
    const terms = await liveTerms(page);
    await seedPlan(page, {
      major: 'CS', entryTerm: ENTRY_TERM,
      curriculum: [['MATH101'], ['MATH102']],
      grades: [['A'], ['D']],
      dates: [terms.current, terms.future],
    });
    await setGradingBases(page, { MATH101: 'letter', MATH102: 'letter' });

    const result = await readPolicySnapshot(page);
    expect(result.courses.MATH101.state).toBe('earned');
    expect(result.courses.MATH102.state).toBe('future');
    expect(result.total.earned).toBe(3);
    expect(result.total.future).toBe(3);
    expect(result.total.projected).toBe(6);
    expect(result.gpa).toEqual({ credits: 3, points: 12, value: 4, unresolved: false });
  });

  test('a failed in-program course stays in PGPA without earning degree credit', async ({ page }) => {
    const terms = await liveTerms(page);
    await seedPlan(page, {
      major: 'CS', entryTerm: ENTRY_TERM,
      curriculum: [['MATH101', 'CS201']], grades: [['A', 'F']], dates: [terms.current],
    });

    const result = await page.evaluate(() => {
      const progress = window.curriculum.getGraduationProgress('main');
      const failed = progress.courseStates.find((row) => row.course.code === 'CS201');
      return {
        earned: progress.breakdown.total.earned,
        pgpa: {
          credits: progress.pgpa.credits,
          points: progress.pgpa.points,
          value: progress.pgpa.value,
        },
        failed: {
          state: failed.state,
          visibleEffective: failed.course.effective_type,
          pgpaEffective: failed.pgpaEffective,
        },
      };
    });

    expect(result.earned).toBe(3);
    expect(result.pgpa).toEqual({ credits: 6, points: 12, value: 2 });
    expect(result.failed).toEqual({
      state: 'unsuccessful', visibleEffective: 'none', pgpaEffective: 'required',
    });
  });

  test('effective N/A membership is excluded independently for each program', async ({ page }) => {
    const terms = await liveTerms(page);
    await seedPlan(page, {
      major: 'CS', entryTerm: ENTRY_TERM,
      doubleMajor: 'VACD', entryTermDM: ENTRY_TERM,
      curriculum: [['NS213', 'VA202']], grades: [['A', 'D']], dates: [terms.current],
    });

    const result = await page.evaluate(() => {
      const main = window.curriculum.getGraduationProgress('main');
      const dm = window.curriculum.getGraduationProgress('dm');
      const state = (progress, code) => {
        const row = progress.courseStates.find((entry) => entry.course.code === code);
        return row && row.pgpaEffective;
      };
      return {
        main: { value: main.pgpa.value, credits: main.pgpa.credits },
        dm: { value: dm.pgpa.value, credits: dm.pgpa.credits },
        ns213: { main: state(main, 'NS213'), dm: state(dm, 'NS213') },
      };
    });

    expect(result.main.credits).toBe(7);
    expect(result.main.value).toBeCloseTo(16 / 7, 8);
    expect(result.dm).toEqual({ value: 1, credits: 4 });
    expect(result.ns213).toEqual({ main: 'area', dm: 'none' });
  });

  test('PGPA treats posted current grades as actual and future grades as projections', async ({ page }) => {
    const terms = await liveTerms(page);
    await seedPlan(page, {
      major: 'CS', entryTerm: ENTRY_TERM,
      curriculum: [['MATH101'], ['MATH102']], grades: [['A'], ['D']],
      dates: [terms.current, terms.future],
    });

    const result = await page.evaluate(() => {
      const progress = window.curriculum.getGraduationProgress('main');
      return {
        actual: {
          value: progress.pgpa.value,
          credits: progress.pgpa.credits,
          points: progress.pgpa.points,
        },
        projected: {
          value: progress.projectedPgpa.value,
          credits: progress.projectedPgpa.credits,
          points: progress.projectedPgpa.points,
          missingCredits: progress.projectedPgpa.missingCredits,
        },
      };
    });

    expect(result.actual).toEqual({ value: 4, credits: 3, points: 12 });
    expect(result.projected).toEqual({
      value: 2.5, credits: 6, points: 15, missingCredits: 0,
    });
  });

  test('graduation fails on PGPA even when N/A courses lift CGPA above the threshold', async ({ page }) => {
    const terms = await liveTerms(page);
    const courses = [...CS_PASSING_PLAN, 'NS213'];
    await seedPlan(page, {
      major: 'CS', entryTerm: ENTRY_TERM,
      curriculum: [courses],
      grades: [courses.map((code) => (code === 'MATH101' ? 'D' : (code === 'NS213' ? 'A' : 'C')))],
      dates: [terms.current],
    });

    const result = await page.evaluate(() => {
      // Model a course whose effective type is N/A for this program. It still
      // belongs to the academic record and therefore to CGPA, but not PGPA.
      const record = window.curriculum.primaryCourseData.find(
        (row) => `${row.Major}${row.Code}` === 'NS213',
      );
      record.EL_Type = 'unknown';
      const progress = window.curriculum.getGraduationProgress('main');
      return {
        cgpa: progress.cgpa.value,
        pgpa: progress.pgpa.value,
        earnedFlag: progress.earnedFlag,
        projectedFlag: progress.projectedFlag,
      };
    });

    expect(result.cgpa).toBeGreaterThanOrEqual(2);
    expect(result.pgpa).toBeLessThan(2);
    expect(result.earnedFlag).toBe(41);
    expect(result.projectedFlag).toBe(41);
  });
});
