'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');

// Official SUIS rule, stated verbatim on the CS, ME, MAT and IE pages:
//   "For students admitted in the 2025-2026 academic year and later, MATH 201
//    'Linear Algebra' and MATH 202 'Differential Equations' are not included in
//    any course pool."
//
// The catalogs encode this as `EL_Type: 'unknown'`, and they do it consistently
// — the marking appears on exactly two sets of courses:
//   MATH201/MATH202  ->  CS, DSA, EE, IE, MAT, ME, and only from 202501 on
//   NS213/NS214      ->  ECON, MAN, PSIR, PSY, VACD ("physics for scientists
//                        and engineers", in no pool for a non-engineer)
// So `unknown` means what SUIS says: listed, but counting toward no pool.
//
// THE BUG: the engine implemented the exclusion only for `major === 'CS'`, and
// treated `unknown` elsewhere as its own category — which counted toward no
// pool BUT still added to total credits, ECTS, basic science, engineering, and
// the flag-19 math tally. Half-excluded. A course in no pool cannot count
// toward the degree total either: every major's `total` is exactly the sum of
// its pool minimums (CS: 41+29+31+9+15 = 125).
//
// Fixed from the data rather than a hard-coded list of six majors, since the
// catalog already states the rule and does so uniformly.
const PRE_2025 = ['202401', 'Fall 2024-2025'];
const POST_2025 = ['202501', 'Fall 2025-2026'];

const seed = (page, major, termName, codes) => seedPlan(page, {
  major,
  entryTerm: termName,
  curriculum: [codes],
  grades: [codes.map(() => 'A')],
  dates: [termName],
});

const read = (page, codes) => page.evaluate((cs) => {
  const s = window.curriculum.semesters;
  const sum = (f) => s.reduce((a, x) => a + (x[f] || 0), 0);
  const eff = {};
  s.forEach((x) => x.courses.forEach((c) => { if (cs.includes(c.code)) eff[c.code] = c.effective_type; }));
  return {
    eff,
    credit: sum('totalCredit'),
    ects: sum('totalECTS'),
    science: sum('totalScience'),
    required: sum('totalRequired'),
  };
}, codes);

test.describe('courses in no pool (EL_Type: unknown)', () => {
  // The four majors whose SUIS text the maintainer confirmed verbatim, plus the
  // two whose catalogs carry the identical marking.
  for (const major of ['CS', 'ME', 'MAT', 'IE', 'DSA', 'EE']) {
    test(`${major} 2025+: MATH201/MATH202 count toward nothing`, async ({ page }) => {
      const codes = ['MATH201', 'MATH202'];
      await seed(page, major, POST_2025[1], codes);
      const r = await read(page, codes);

      expect(r.eff.MATH201, 'MATH201 should be excluded outright').toBe('none');
      expect(r.eff.MATH202, 'MATH202 should be excluded outright').toBe('none');
      // Not merely poolless — they must not reach the degree total either.
      expect(r.credit, `${major}: excluded courses must not add credits`).toBe(0);
      expect(r.ects, `${major}: excluded courses must not add ECTS`).toBe(0);
      expect(r.science, `${major}: excluded courses must not add basic science`).toBe(0);
    });
  }

  test('the rule is scoped to 2025+ admits, not applied retroactively', async ({ page }) => {
    // ME's pre-2025 catalog types both as `required`, and the rule explicitly
    // names 2025-2026 and later. An earlier admit keeps their credits.
    const codes = ['MATH201', 'MATH202'];
    await seed(page, 'ME', PRE_2025[1], codes);
    const r = await read(page, codes);

    expect(r.eff.MATH201, 'a pre-2025 ME admit still counts MATH201').toBe('required');
    expect(r.eff.MATH202, 'a pre-2025 ME admit still counts MATH202').toBe('required');
    expect(r.credit, 'and their credits count').toBeGreaterThan(0);
  });

  test('NS213/NS214 count toward nothing for a non-engineering major', async ({ page }) => {
    // Same marking, same meaning: physics for scientists and engineers is in no
    // ECON pool. This is the case that makes a hard-coded "MATH201/202 for six
    // majors" rule the wrong shape — the catalog is saying something general.
    const codes = ['NS213', 'NS214'];
    await seed(page, 'ECON', PRE_2025[1], codes);
    const r = await read(page, codes);

    expect(r.eff.NS213).toBe('none');
    expect(r.eff.NS214).toBe('none');
    expect(r.credit, 'they must not add credits').toBe(0);
  });

  test('excluded courses do not satisfy the >=2 MATH requirement (flag 19)', async ({ page }) => {
    // MATH201/202 carry the FENS Faculty_Course marker that flag 19 counts. If
    // they were merely poolless rather than excluded, they would still satisfy
    // "you need at least 2 MATH courses" — a requirement met by courses that
    // count toward nothing.
    await seed(page, 'ME', POST_2025[1], ['MATH201', 'MATH202']);
    const counted = await page.evaluate(() => {
      let n = 0;
      window.curriculum.semesters.forEach((s) => s.courses.forEach((c) => {
        if (c.effective_type === 'none') return; // what canGraduate skips
        if (c.Faculty_Course === 'FENS' && String(c.code).startsWith('MATH')) n += 1;
      }));
      return n;
    });
    expect(counted, 'excluded maths must not count toward the MATH requirement').toBe(0);
  });

  test('the double-major pass excludes them too', async ({ page }) => {
    // The DM pass is a parallel copy and had the same gap — the shape that has
    // produced a bug every previous time it drifted.
    const codes = ['MATH201', 'MATH202'];
    await seedPlan(page, {
      major: 'MAN',
      entryTerm: POST_2025[1],
      doubleMajor: 'ME',
      entryTermDM: POST_2025[1],
      curriculum: [codes],
      grades: [codes.map(() => 'A')],
      dates: [POST_2025[1]],
    });
    const dm = await page.evaluate(() => {
      const s = window.curriculum.semesters;
      const eff = {};
      s.forEach((x) => x.courses.forEach((c) => { eff[c.code] = c.effective_type_dm; }));
      return { eff, requiredDM: s.reduce((a, x) => a + (x.totalRequiredDM || 0), 0) };
    });
    expect(dm.eff.MATH201, 'MATH201 excluded on the DM path').toBe('none');
    expect(dm.eff.MATH202, 'MATH202 excluded on the DM path').toBe('none');
    expect(dm.requiredDM, 'and contributing nothing to DM required').toBe(0);
  });
});
