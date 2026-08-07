'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');
const plans = require('../fixtures/passing-plans-multiterm.json');

// The MATH212 alternative is NOT the same rule in every program:
//
//   CS, IE:  "either MATH 212 or MATH 201"                   (linear algebra only)
//   EE, ME:  "either MATH 212 or both (MATH 201 and MATH 202)"
//
// MATH212 "Linear Algebra and Differential Equations" replaces MATH201 "Linear
// Algebra" + MATH202 "Differential Equations"; CS/IE need only the first half.
//
// The catalog already encodes exactly this, which is what the engine reads
// rather than hard-coding four majors: for CS/IE, MATH202 is an ordinary `area`
// elective and no part of the alternative; for EE/ME it is `required`. So the
// courses MATH212 stands in for are the `required`-typed ones among
// {MATH201, MATH202} for that program.
const PRE_2025 = ['202301', 'Fall 2023-2024'];

const seed = (page, major, term, termName, courses) => seedPlan(page, {
  major,
  entryTerm: termName,
  curriculum: [courses],
  grades: [courses.map(() => 'A')],
  dates: [termName],
});

const effOf = (page, codes) => page.evaluate((cs) => {
  const out = {};
  window.curriculum.semesters.forEach((s) => s.courses.forEach((c) => {
    if (cs.includes(c.code)) out[c.code] = c.effective_type;
  }));
  return out;
}, codes);

test.describe('MATH212 alternative is program-specific', () => {
  test('CS: MATH212 excludes MATH201, and leaves MATH202 alone', async ({ page }) => {
    const [term, termName] = PRE_2025;
    const courses = plans[term].CS;
    for (const c of ['MATH201', 'MATH212']) {
      expect(courses, `fixture should contain ${c}`).toContain(c);
    }
    await seed(page, 'CS', term, termName, courses.concat(['MATH202']));
    const eff = await effOf(page, ['MATH201', 'MATH202', 'MATH212']);

    expect(eff.MATH212, 'MATH212 is kept').toBe('required');
    expect(eff.MATH201, 'MATH201 is the extra and counts toward nothing').toBe('none');
    // The load-bearing half: MATH202 is NOT part of CS's alternative — it is an
    // ordinary area elective, so it must survive. Applying EE's rule to CS would
    // wrongly strip it.
    expect(eff.MATH202, 'MATH202 is an ordinary elective for CS, not part of the rule').not.toBe('none');
  });

  test('CS: MATH201 alone is untouched when MATH212 is absent', async ({ page }) => {
    const [term, termName] = PRE_2025;
    const courses = plans[term].CS.filter((c) => c !== 'MATH212');
    await seed(page, 'CS', term, termName, courses);
    const eff = await effOf(page, ['MATH201']);
    expect(eff.MATH201, 'nothing is redundant without MATH212').toBe('required');
  });

  for (const [major, threshold, pairCredits] of [['EE', 33, 35], ['ME', 32, 34]]) {
    test(`${major}: MATH212 and MATH201+MATH202 both meet Required`, async ({ page }) => {
      const [term, termName] = PRE_2025;
      const fixture = plans[term][major];
      for (const code of ['MATH201', 'MATH202', 'MATH212']) {
        expect(fixture, `fixture should contain ${code}`).toContain(code);
      }

      const inspect = async (courses) => {
        await seed(page, major, term, termName, courses);
        return page.evaluate(() => ({
          flag: window.curriculum.canGraduate(),
          required: window.curriculum.semesters.reduce((sum, sem) => sum + (sem.totalRequired || 0), 0),
        }));
      };

      const via212 = await inspect(fixture.filter((code) => !['MATH201', 'MATH202'].includes(code)));
      expect(via212.required, `${major}: 4-SU MATH212 route`).toBe(threshold);
      expect(via212.flag, `${major}: MATH212 route must not fail Required`).not.toBe(2);

      const viaPair = await inspect(fixture.filter((code) => code !== 'MATH212'));
      expect(viaPair.required, `${major}: 6-SU MATH201+MATH202 route`).toBe(pairCredits);
      expect(viaPair.flag, `${major}: complete pair must not fail Required`).not.toBe(2);
    });

    test(`${major}: either half of the MATH201+MATH202 route alone remains insufficient`, async ({ page }) => {
      const [term, termName] = PRE_2025;
      const fixture = plans[term][major];
      for (const kept of ['MATH201', 'MATH202']) {
        const courses = fixture.filter((code) => (
          code !== 'MATH212' && (code === kept || !['MATH201', 'MATH202'].includes(code))
        ));
        await seed(page, major, term, termName, courses);
        const result = await page.evaluate(() => ({
          flag: window.curriculum.canGraduate(),
          total: window.curriculum.semesters.reduce((sum, sem) => sum + (sem.totalCredit || 0), 0),
          required: window.curriculum.semesters.reduce((sum, sem) => sum + (sem.totalRequired || 0), 0),
        }));
        expect(result.total, `${major}/${kept}: total should not mask Required`).toBeGreaterThanOrEqual(125);
        expect(result.required, `${major}/${kept}: one 3-SU half`).toBe(threshold - 1);
        expect(result.flag, `${major}/${kept}: incomplete route`).toBe(2);
      }
    });
  }

  test('EE: category minima do not replace the independent 125-SU Total', async ({ page }) => {
    const [term, termName] = PRE_2025;
    await seed(page, 'EE', term, termName, ['EE395']);
    const result = await page.evaluate(() => {
      const req = window.getRequirementRecord('EE', '202301');
      const sem = window.curriculum.semesters[0];
      sem.totalUniversity = req.university;
      sem.totalRequired = req.required;
      sem.totalCore = req.core;
      sem.totalArea = req.area;
      sem.totalFree = req.free;
      sem.totalScience = req.science;
      sem.totalEngineering = req.engineering;
      sem.totalECTS = req.ects;
      sem.totalCredit = req.total - 1;
      return { flag: window.curriculum.canGraduate(), total: sem.totalCredit };
    });
    expect(result.total).toBe(124);
    expect(result.flag, 'overall Total remains a separate earlier check').toBe(5);
  });

  test('MAT/BIO/DSA are untouched — they state no such rule', async ({ page }) => {
    // Their catalogs type these courses quite differently (BIO has MATH212 as an
    // `area` elective), so applying the alternative would corrupt them.
    const [term, termName] = PRE_2025;
    for (const major of ['MAT', 'BIO', 'DSA']) {
      const courses = plans[term][major];
      await seed(page, major, term, termName, courses);
      const eff = await effOf(page, ['MATH201', 'MATH202', 'MATH212']);
      for (const [code, type] of Object.entries(eff)) {
        expect(type, `${major}: ${code} must not be excluded by the CS/IE rule`).not.toBe('none');
      }
    }
  });
});
