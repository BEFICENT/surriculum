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

  test('EE/ME keep the rule unapplied while their thresholds exclude the MATH212 path', async ({ page }) => {
    // EE's required threshold (35) is the sum of a required list carrying
    // MATH201+MATH202 (6cr). MATH212 is worth 4cr, so the MATH212 path tops out
    // at 33 and an EE student on it is told they cannot graduate — a live bug in
    // the threshold, not in this rule. Until that is settled the exclusion stays
    // off for EE/ME: switching it on would also fail the students who hold all
    // three courses and pass today.
    //
    // This test pins that decision so it cannot be flipped on by accident.
    const [term, termName] = PRE_2025;
    const courses = plans[term].EE;
    for (const c of ['MATH201', 'MATH202', 'MATH212']) {
      expect(courses, `fixture should contain ${c}`).toContain(c);
    }
    await seed(page, 'EE', term, termName, courses);
    const eff = await effOf(page, ['MATH201', 'MATH202', 'MATH212']);

    for (const c of ['MATH201', 'MATH202', 'MATH212']) {
      expect(eff[c], `${c} still counts for EE (rule intentionally not applied)`).not.toBe('none');
    }
  });

  test('the EE MATH212 path is short of the required threshold (bug #19)', async ({ page }) => {
    // Documents the live defect rather than asserting the broken value is fine:
    // a real EE student who takes MATH212 and never takes MATH201/202.
    const [term, termName] = PRE_2025;
    const courses = plans[term].EE.filter((c) => !['MATH201', 'MATH202'].includes(c));
    await seed(page, 'EE', term, termName, courses);

    const r = await page.evaluate(() => {
      const s = window.curriculum.semesters;
      return {
        flag: window.curriculum.canGraduate(),
        required: s.reduce((a, x) => a + (x.totalRequired || 0), 0),
      };
    });
    // 29 non-maths required + 4 (MATH212) = 33, against a threshold of 35.
    expect(r.required, 'the MATH212 path reaches only 33').toBe(33);
    expect(r.flag, 'so the student is told their required credits are short').toBe(2);
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
