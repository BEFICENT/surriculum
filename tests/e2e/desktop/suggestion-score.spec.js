'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');
const { seedGradPlan, CS_PASSING_PLAN } = require('../helpers/passing-plan');

// computeCourseSuggestionScore() — ~300 lines that order every course
// suggestion the user sees, and previously untested. It reads window.curriculum
// and the rendered semesters, so it can't be unit-tested; it IS a global, so
// e2e can call it directly.
//
// What it does: per program context, score = typeWeight(EL_Type) + credits*0.1,
// plus basic-science and engineering bonuses WHILE those requirements are unmet
// (engineering majors only). Each context is then multiplied by its own weight
// and summed:
//
//   typeScore     = { university: 36, required: 28, core: 18, area: 12, free: 0 }
//   context weight = main major 1.2 · double major 0.8 · minor 0.5
//
// So a course counting toward your main major outranks the same course counting
// only toward a minor.
//
// The interesting part is the SUPPRESSION: once the university or required
// requirement is met, courses of that type stop being rewarded — otherwise the
// tool would keep recommending courses the student no longer needs. That is
// behaviour worth pinning precisely, because it depends on a progress-keyed
// cache that a refactor could easily leave stale.
//
// Frozen term 202401 throughout.
const TERM_NAME = 'Fall 2024-2025';

// All three share credits(3) / Basic_Science(0) / Engineering(6) in the CS
// catalog, so any score difference between them is purely the type weight.
const REQUIRED_COURSE = 'CS201';
const CORE_COURSE = 'CS310';
const AREA_COURSE = 'CS414';
const FREE_COURSE = 'ACC201';        // 3cr, no science/engineering
const UNIVERSITY_COURSE = 'IF100';   // 3cr
const SCIENCE_COURSE = 'MATH101';    // university, Basic_Science 6

const emptyPlan = (page) => seedPlan(page, {
  major: 'CS',
  entryTerm: TERM_NAME,
  curriculum: [['CS201']], // one course: the scorer needs a live curriculum
  grades: [['A']],
  dates: [TERM_NAME],
});

const score = (page, code) => page.evaluate(
  (c) => window.computeCourseSuggestionScore(c, {}),
  code,
);

test.describe('course suggestion scoring', () => {
  test('scores rank by requirement type: university > required > core > area > free', async ({ page }) => {
    await emptyPlan(page);
    const [req, core, area, free] = await Promise.all([
      score(page, REQUIRED_COURSE),
      score(page, CORE_COURSE),
      score(page, AREA_COURSE),
      score(page, FREE_COURSE),
    ]);
    // These three are identical but for their type, so the ordering is the
    // weighting and nothing else.
    expect(req, `${REQUIRED_COURSE} (required) > ${CORE_COURSE} (core)`).toBeGreaterThan(core);
    expect(core, `${CORE_COURSE} (core) > ${AREA_COURSE} (area)`).toBeGreaterThan(area);
    expect(area, `${AREA_COURSE} (area) > ${FREE_COURSE} (free)`).toBeGreaterThan(free);
  });

  test('a free elective still scores above zero on credits alone', async ({ page }) => {
    await emptyPlan(page);
    // free's type weight is 0, so its whole score is the credit bonus, scaled by
    // the main-major context weight: 3cr * 0.1 * 1.2. Pins both terms at once —
    // the 0.1/credit tie-breaker between same-type courses, and the fact that a
    // single-major plan is scored through exactly ONE context (a stray second
    // context would show up here as a multiple).
    expect(await score(page, FREE_COURSE)).toBeCloseTo(0.36, 3);
  });

  test('an unknown course scores 0 rather than throwing', async ({ page }) => {
    await emptyPlan(page);
    // The dropdown scores whatever the user types, so junk input must be safe.
    expect(await score(page, 'NOTACOURSE999')).toBe(0);
    expect(await score(page, '')).toBe(0);
  });

  test('basic-science courses are rewarded while science is unmet', async ({ page }) => {
    await emptyPlan(page);
    // MATH101 and IF100 are both university/3cr; MATH101 carries 6 basic-science
    // and IF100 none, so the gap is the science bonus.
    const [sci, plain] = await Promise.all([score(page, SCIENCE_COURSE), score(page, UNIVERSITY_COURSE)]);
    expect(sci, 'a science-bearing course should outrank an equivalent one without').toBeGreaterThan(plain);
  });

  test('meeting the university requirement stops rewarding university courses', async ({ page }) => {
    // The suppression rule. On a complete plan, university is long since met, so
    // IF100's 36-point weight must drop away and leave only the credit bonus.
    await emptyPlan(page);
    const before = await score(page, UNIVERSITY_COURSE);

    await seedGradPlan(page, { drop: [UNIVERSITY_COURSE] });
    const after = await score(page, UNIVERSITY_COURSE);

    expect(before, 'university weight should apply on an empty plan').toBeGreaterThan(30);
    expect(after, `university weight should be suppressed once met (was ${before})`).toBeLessThan(before);
    expect(after, 'only the credit bonus should remain').toBeLessThan(5);
  });

  test('meeting the required pool stops rewarding required courses', async ({ page }) => {
    await emptyPlan(page);
    const before = await score(page, REQUIRED_COURSE);

    // A complete plan minus CS201 still clears `required` (the plan carries more
    // required credits than the 29-credit threshold), so CS201's own weight
    // should be suppressed.
    await seedGradPlan(page, { drop: [REQUIRED_COURSE] });
    const after = await score(page, REQUIRED_COURSE);

    expect(before, 'required weight should apply on an empty plan').toBeGreaterThan(25);
    expect(after, `required weight should be suppressed once met (was ${before})`).toBeLessThan(before);
  });

  test('a course filling an unmet requirement-group pool is rewarded, then suppressed once met (VACD)', async ({ page }) => {
    // Phase 6: group-awareness. A member of an unmet enumerable pool (VACD Core I,
    // "Art/Design History") gets a bonus so the scheduler steers toward filling it;
    // once the pool is met the bonus turns off — the same suppression the
    // university/required weights have, keyed through the same progress cache.
    const POOL_MEMBER = 'HART426'; // a Core I member, untaken in both plans below

    // Core I unmet: 6 of 9 SU (two art-history members).
    await seedPlan(page, {
      major: 'VACD', entryTerm: TERM_NAME,
      curriculum: [['HART292', 'HART293']], grades: [['A', 'A']], dates: [TERM_NAME],
    });
    const unmet = await page.evaluate(() =>
      window.curriculum.requirementGroupProgress('main').find((g) => g.id === 'core_arthistory'));
    expect(unmet.ok, 'Core I is unmet at 6/9').toBe(false);
    const rewarded = await score(page, POOL_MEMBER);

    // Core I met: 9 of 9 SU (three art-history members).
    await seedPlan(page, {
      major: 'VACD', entryTerm: TERM_NAME,
      curriculum: [['HART292', 'HART293', 'HART413']], grades: [['A', 'A', 'A']], dates: [TERM_NAME],
    });
    const met = await page.evaluate(() =>
      window.curriculum.requirementGroupProgress('main').find((g) => g.id === 'core_arthistory'));
    expect(met.ok, 'Core I is met at 9/9').toBe(true);
    const suppressed = await score(page, POOL_MEMBER);

    expect(rewarded, 'an unmet-pool member is rewarded above its suppressed self').toBeGreaterThan(suppressed);
    // The gap is exactly the group bonus scaled by the main-major context weight.
    expect(rewarded - suppressed, 'gap is GROUP_BONUS(6) * mainWeight(1.2)').toBeCloseTo(6 * 1.2, 1);
  });

  test('the score reflects new progress rather than a stale cache', async ({ page }) => {
    // Scores come from a cache keyed on program config AND progress. Every other
    // test here starts on a fresh page, where the cache is empty — so a cache
    // that never invalidated would still pass them all, while the live app
    // served stale scores for the whole session. This one changes progress
    // WITHIN a page, which only the cache key turning can account for.
    await emptyPlan(page);
    const before = await score(page, UNIVERSITY_COURSE);
    expect(before, 'university weight applies while the requirement is unmet').toBeGreaterThan(30);

    const met = await page.evaluate((plan) => {
      // Add the whole degree to the model and recalc, with no reload. CS needs
      // 41 university credits, so this has to clear the threshold outright —
      // partial progress would not flip the suppression and would prove nothing.
      const sem = window.curriculum.semesters[0];
      plan.forEach((code, i) => sem.courses.push({ id: `probe_${i}_${code}`, code }));
      window.curriculum.recalcEffectiveTypes(course_data);
      return window.curriculum.semesters.reduce((a, s) => a + (s.totalUniversity || 0), 0);
    }, CS_PASSING_PLAN);

    expect(met, 'the university requirement should now be met').toBeGreaterThanOrEqual(41);
    const after = await score(page, UNIVERSITY_COURSE);
    expect(after, `score must fall once university is met in-session (${before} -> ${after})`).toBeLessThan(before);
  });
});
