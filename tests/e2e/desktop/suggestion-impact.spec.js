'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');

const TERMS = Object.freeze({
  2023: Object.freeze({ entryCode: '202301', entryName: 'Fall 2023-2024', targetCode: '202302' }),
  2024: Object.freeze({ entryCode: '202401', entryName: 'Fall 2024-2025', targetCode: '202402' }),
  2026: Object.freeze({
    entryCode: '202601',
    entryName: 'Fall 2026-2027',
    targetCode: '202602',
    targetName: 'Spring 2026-2027',
  }),
});

const UNIVERSITY_41 = Object.freeze([
  'AL102', 'HIST191', 'HIST192', 'HUM202', 'IF100',
  'MATH101', 'MATH102', 'NS101', 'NS102', 'PROJ201',
  'SPS101', 'SPS102', 'SPS303', 'TLL101', 'TLL102',
]);

const REQUIRED_29_WITHOUT_INTERNSHIP = Object.freeze([
  'CS201', 'CS204', 'CS300', 'CS301', 'CS303',
  'ENS491', 'ENS492', 'MATH201', 'MATH203', 'MATH204',
]);

async function seedPriorCourses(page, major, term, courses) {
  await seedPlan(page, {
    major,
    entryTerm: term.entryName,
    curriculum: [courses],
    grades: [courses.map(() => 'A')],
    dates: [term.entryName],
    termCodes: [term.entryCode],
  });
}

async function inspectScore(page, courseCode, targetCode) {
  return page.evaluate(({ code, target }) => {
    const canonicalize = window.suggestionRanking.canonicalizeSuggestionCode;
    const catalog = typeof course_data !== 'undefined' && Array.isArray(course_data)
      ? course_data : [];
    const record = catalog.find((row) => canonicalize(
      String(row && row.Major || '') + String(row && row.Code || ''),
    ) === canonicalize(code));
    const scorer = window.buildCourseSuggestionScorer({
      progressPolicy: 'before-target',
      targetTermCode: target,
    });
    const semesters = window.curriculum.semesters || [];
    const sum = (field) => semesters.reduce(
      (total, semester) => total + (Number(semester && semester[field]) || 0),
      0,
    );
    return {
      score: scorer.score(code),
      available: scorer.available,
      record: record ? {
        type: String(record.EL_Type || '').toLowerCase(),
        credit: Number(record.SU_credit) || 0,
        engineering: Number(record.Engineering) || 0,
        faculty: String(record.Faculty || ''),
      } : null,
      totals: {
        university: sum('totalUniversity'),
        required: sum('totalRequired'),
      },
    };
  }, { code: courseCode, target: targetCode });
}

test.describe('candidate-specific Smart Sort impacts', () => {
  test('historical IE CS201/DSA201 pair completion has marginal core value', async ({ page }) => {
    await seedPriorCourses(page, 'IE', TERMS[2023], ['DSA201']);
    const cs201 = await inspectScore(page, 'CS201', TERMS[2023].targetCode);
    expect(cs201.record).toMatchObject({ type: 'required', credit: 3, engineering: 6 });
    // CS201 is forced to Core once DSA201 is present. Its engineering credit is
    // still useful, so: (core 18 + SU 0.3 + engineering 6) * main 1.2.
    expect(cs201.score).toBeCloseTo((18 + 0.3 + 6) * 1.2, 3);

    await seedPriorCourses(page, 'IE', TERMS[2023], ['CS201']);
    const dsa201 = await inspectScore(page, 'DSA201', TERMS[2023].targetCode);
    expect(dsa201.record).toMatchObject({ type: 'required', credit: 3, engineering: 3 });
    // Adding DSA201 moves the earlier CS201 from Required to forced Core, so the
    // pair's net marginal pool is Core. DSA201 also adds 3 BS and 3 ENG credits.
    expect(dsa201.score).toBeCloseTo((18 + 0.3 + (3 * 2) + 3) * 1.2, 3);
  });

  test('CS 202601 MATH201 is real unknown metadata and contributes no score', async ({ page }) => {
    await seedPriorCourses(page, 'CS', TERMS[2026], ['CS201']);

    const result = await inspectScore(page, 'MATH201', TERMS[2026].targetCode);
    expect(result.available).toBe(true);
    expect(result.record).toMatchObject({ type: 'unknown', credit: 3 });
    expect(result.score, 'unknown metadata must not leak credit/science bonuses').toBe(0);
  });

  test('PSY maps the second philosophy alternative to marginal free value', async ({ page }) => {
    await seedPriorCourses(page, 'PSY', TERMS[2026], ['PHIL300']);

    const result = await inspectScore(page, 'PHIL301', TERMS[2026].targetCode);
    expect(result.record).toMatchObject({ type: 'required', credit: 3 });
    expect(result.score, 'PHIL300 already fills the named philosophy requirement')
      .toBeCloseTo(0.3 * 1.2, 3);
  });

  test('VACD excludes the second mutually exclusive required alternative', async ({ page }) => {
    await seedPriorCourses(page, 'VACD', TERMS[2026], ['VA301']);

    const result = await inspectScore(page, 'VA303', TERMS[2026].targetCode);
    expect(result.record).toMatchObject({ type: 'required', credit: 3 });
    expect(result.score, 'VA301 already occupies the VA301/VA303 degree slot').toBe(0);
  });

  test('Planner visibly ranks an advancing VACD candidate above excluded VA303', async ({ page }) => {
    const term = TERMS[2026];
    await seedPlan(page, {
      major: 'VACD',
      entryTerm: term.entryName,
      curriculum: [['VA301'], []],
      grades: [['A'], []],
      dates: [term.entryName, term.targetName],
      termCodes: [term.entryCode, term.targetCode],
    });
    await page.evaluate(() => {
      window.sortBasedOnScore = true;
      window.hideTakenCourses = false;
      window.plannerFilterOfferedOnly = false;
      window.preferenceStorage.setItem('sortBasedOnScore', 'true');
      window.preferenceStorage.setItem('hideTakenCourses', 'false');
      window.preferenceStorage.setItem('plannerFilterOfferedOnly', 'false');
      window.preferenceStorage.setItem('plannerFilterCheckPrerequisites', 'false');
    });

    const excluded = await inspectScore(page, 'VA303', term.targetCode);
    const advancing = await inspectScore(page, 'VA304', term.targetCode);
    expect(excluded.score).toBe(0);
    expect(advancing.score).toBeGreaterThan(excluded.score);

    const semester = page.locator(
      `.container_semester:has(.date p:text-is("${term.targetName}"))`,
    );
    await expect(semester).toHaveCount(1);
    await semester.locator('.addCourse').click();
    const picker = semester.locator('.input_container');
    await picker.locator('.course_select').fill('VA30');
    await expect(picker.locator('.course-option[data-code="VA303"]')).toBeVisible();
    await expect(picker.locator('.course-option[data-code="VA304"]')).toBeVisible();
    await expect.poll(async () => {
      const codes = await picker.locator('.course-option[data-code]').evaluateAll(
        (nodes) => nodes.map((node) => node.dataset.code),
      );
      return codes.indexOf('VA304') >= 0
        && codes.indexOf('VA303') >= 0
        && codes.indexOf('VA304') < codes.indexOf('VA303');
    }).toBe(true);
  });

  test('VACD bonuses only candidates that actually advance an exclusive credit pool', async ({ page }) => {
    await seedPriorCourses(page, 'VACD', TERMS[2026], ['VA302']);

    const pairedExtra = await inspectScore(page, 'VA304', TERMS[2026].targetCode);
    expect(pairedExtra.record).toMatchObject({ type: 'core', credit: 3 });
    expect(pairedExtra.score, 'VA304 overflows to area after VA302 occupies their shared pool slot')
      .toBeCloseTo((12 + 0.3) * 1.2, 3);

    const advancingMember = await inspectScore(page, 'VA204', TERMS[2026].targetCode);
    expect(advancingMember.record).toMatchObject({ type: 'core', credit: 3 });
    expect(advancingMember.score, 'an independent Core II member still earns the unmet-pool bonus')
      .toBeCloseTo((18 + 0.3 + 6) * 1.2, 3);
  });

  test('MAN reruns diversity assignment for candidates that supply missing Core or Area prefixes', async ({ page }) => {
    await seedPriorCourses(page, 'MAN', TERMS[2026], [
      'ACC201', 'ACC301', 'FIN301', 'MGMT401', 'MKTG301', 'OPIM301',
    ]);

    const result = await inspectScore(page, 'ORG301', TERMS[2026].targetCode);
    expect(result.record).toMatchObject({ type: 'core', credit: 3 });
    // The prior six courses already fill 18 SU of Core but span only five of
    // MAN's six required prefixes. The real diversity pass swaps ORG301 into
    // Core and moves the duplicate-prefix ACC301 down, so ORG301 keeps Core
    // value and earns the unmet-prefix bonus.
    expect(result.score).toBeCloseTo((18 + 0.3 + 6) * 1.2, 3);

    await seedPriorCourses(page, 'MAN', TERMS[2026], [
      'ACC201', 'FIN301', 'MGMT401', 'MKTG301', 'OPIM301', 'ORG301',
      'ACC405', 'FIN402', 'FIN403', 'FIN405',
      'MKTG401', 'MKTG404', 'OPIM390', 'OPIM401',
    ]);
    const areaResult = await inspectScore(page, 'ORG302', TERMS[2026].targetCode);
    expect(areaResult.record).toMatchObject({ type: 'core', credit: 3 });
    // Core already spans all six prefixes and Area already has 24 SU, but Area
    // lacks ORG. MAN therefore keeps the earlier ORG301 in Core and selects the
    // static-Core ORG302 into Area, where it completes the five-prefix rule.
    expect(areaResult.score).toBeCloseTo((12 + 0.3 + 6) * 1.2, 3);
  });

  test('a DSA offering-faculty predicate improvement earns the group bonus', async ({ page }) => {
    await seedPriorCourses(page, 'DSA', TERMS[2026], ['DSA201']);

    const result = await inspectScore(page, 'CS306', TERMS[2026].targetCode);
    expect(result.record).toMatchObject({ type: 'core', credit: 3, faculty: 'FENS' });
    // (core 18 + SU tie-breaker 0.3 + unmet predicate-group bonus 6) * main 1.2
    expect(result.score).toBeCloseTo((18 + 0.3 + 6) * 1.2, 3);
  });

  test('named SPS, HUM, and internship needs outrank additional HUM choices', async ({ page }) => {
    const universityWithoutSps = UNIVERSITY_41
      .filter((code) => code !== 'SPS303');
    await seedPriorCourses(page, 'CS', TERMS[2024], universityWithoutSps);
    const sps = await inspectScore(page, 'SPS303', TERMS[2024].targetCode);
    const extraHum = await inspectScore(page, 'HUM201', TERMS[2024].targetCode);
    expect(sps.totals.university).toBe(38);
    expect(sps.score, 'missing SPS303 remains a university-priority candidate')
      .toBeCloseTo((36 + 0.3 + 6) * 1.2, 3);
    expect(extraHum.score, 'a second HUM does not inherit the SPS303 credit gap')
      .toBeCloseTo(0.3 * 1.2, 3);

    const twoHumsAtOneLevel = UNIVERSITY_41.concat('HUM201');
    await seedPriorCourses(page, 'PSY', TERMS[2024], twoHumsAtOneLevel);
    const hum = await inspectScore(page, 'HUM311', TERMS[2024].targetCode);
    expect(hum.totals.university).toBe(44);
    expect(hum.score, 'the missing 300-level HUM remains a university-priority candidate')
      .toBeCloseTo((36 + 0.3 + 6) * 1.2, 3);

    await seedPriorCourses(page, 'CS', TERMS[2024], REQUIRED_29_WITHOUT_INTERNSHIP);
    const internship = await inspectScore(page, 'CS395', TERMS[2024].targetCode);
    expect(internship.totals.required).toBe(29);
    expect(internship.record).toMatchObject({ type: 'required', credit: 0, engineering: 5 });
    expect(internship.score, 'the zero-credit internship remains required-priority')
      .toBeCloseTo((28 + 5 + 6) * 1.2, 3);
  });
});
