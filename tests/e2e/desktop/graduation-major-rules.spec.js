'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');
const plans = require('../fixtures/passing-plans-multiterm.json');

// The major-specific rules that the multi-term sweep only ever touched at ONE
// point each: it pins the FIRST unmet flag, which says nothing about the checks
// behind it. That blind spot is exactly where the DSA bug lived (flag 28 was
// unsatisfiable for years, masked by flag 27 firing first).
//
// So each rule here is driven in BOTH directions — made to fire, and made to
// clear — rather than observed once.
//
// These pin BEHAVIOUR, not correctness: the SUIS text for these rules has not
// been checked yet, so a rule could be faithfully pinned and still wrong (as
// VACD's was). That is deliberate — behaviour pinned now is behaviour the
// refactor cannot silently change, and correctness is a separate pass.
const TERM = '202301';
const TERM_NAME = 'Fall 2023-2024';

const seed = (page, major, { add = [], drop = [] } = {}) => {
  const courses = plans[TERM][major].filter((c) => !drop.includes(c)).concat(add);
  return seedPlan(page, {
    major,
    entryTerm: TERM_NAME,
    curriculum: [courses],
    grades: [courses.map(() => 'A')],
    dates: [TERM_NAME],
  });
};

const flag = (page) => page.evaluate(() => window.curriculum.canGraduate());

test.describe('EE 400-level rules', () => {
  // Flag 23 counts EE4xx courses whose CATEGORY is Core — the static catalog
  // type, so any EE4xx core-typed course counts regardless of where the cascade
  // allocates it. 19 such courses exist; the generated plan carries one (EE401,
  // 3cr) against a 9-credit minimum.
  test('under 9 credits of 400-level EE core raises flag 23', async ({ page }) => {
    await seed(page, 'EE');
    expect(await flag(page)).toBe(23);
  });

  test('9 credits of 400-level EE core clears 23 — and exposes flag 24', async ({ page }) => {
    // EE401 + EE402 + EE403 = 9cr exactly. Flag 24 then fires because the plan
    // holds none of the specific area courses it wants: 24 was UNREACHABLE
    // before this test, since 23 always fired first.
    await seed(page, 'EE', { add: ['EE402', 'EE403'] });
    expect(await flag(page), 'flag 23 should clear, revealing 24').toBe(24);
  });

  test('one of the named area courses clears flag 24', async ({ page }) => {
    // The rule accepts CS300, CS401, CS412, ME303, PHYS302, PHYS303 — matched by
    // code alone, with no category condition — or any EE48x area course.
    await seed(page, 'EE', { add: ['EE402', 'EE403', 'CS300'] });
    expect(await flag(page), 'both EE rules should now clear').not.toBe(24);
    expect(await flag(page)).not.toBe(23);
  });
});

test.describe('ECON mathematics requirement', () => {
  // SUIS (ECON, "Mathematics Requirement Courses"): 1 course from the pool
  // MATH201 / MATH202 / MATH204 / MATH212 — any ONE satisfies flag 25.
  //
  // MATH212 was missing from the check. It is not an oddity: MATH212 replaces
  // MATH201+MATH202, so it is the one a recent student is most likely to hold.
  //
  // These are all `required`-typed and ECON's required-typed courses total 31
  // against a 21 threshold, so dropping every maths course still leaves required
  // at 22 — flag 2 cannot mask flag 25.
  const MATHS = ['MATH201', 'MATH202', 'MATH204', 'MATH212'];

  test('holding NO maths is caught by the required pool, not flag 25', async ({ page }) => {
    // Flag 25 is unreachable from an empty-maths plan: the pool courses are all
    // `required`-typed and ECON's non-maths required courses total only 18
    // against a 21 threshold, so dropping every maths course trips flag 2 first.
    // Documented rather than asserted as 25 — the same shape as PSY's flag 26.
    await seed(page, 'ECON', { drop: MATHS });
    expect(await flag(page), 'required-short is the binding failure here').toBe(2);
  });

  for (const keep of MATHS) {
    test(`${keep} alone satisfies the requirement`, async ({ page }) => {
      await seed(page, 'ECON', { drop: MATHS.filter((c) => c !== keep) });
      expect(await flag(page), `${keep} should satisfy flag 25 on its own`).not.toBe(25);
    });
  }

  test('the flag-25 message lists all four alternatives', async ({ page }) => {
    await page.goto('/');
    const msg = await page.evaluate(async () => {
      const { buildFlagMessages } = await import('/cases/flagMessages.js');
      return buildFlagMessages('ECON')[25]();
    });
    for (const c of MATHS) {
      expect(msg, `the message should name ${c}`).toContain(c);
    }
  });
});

test.describe('IE CS201/DSA201 force-core rule', () => {
  // If an IE student has BOTH CS201 and DSA201, CS201 is forced to Core
  // regardless of when it was taken. Unlike the other special cases this has no
  // entry-term guard, so it applies to every term.
  const effOf = (page, code) => page.evaluate((c) => {
    let out = null;
    window.curriculum.semesters.forEach((s) => s.courses.forEach((x) => {
      if (x.code === c) out = x.effective_type;
    }));
    return out;
  }, code);

  test('with both taken, CS201 is forced to core', async ({ page }) => {
    for (const c of ['CS201', 'DSA201']) {
      expect(plans[TERM].IE, `fixture should contain ${c}`).toContain(c);
    }
    await seed(page, 'IE');
    expect(await effOf(page, 'CS201'), 'CS201 should be forced to core').toBe('core');
  });

  test('without DSA201 the rule does not fire', async ({ page }) => {
    // CS201 is `required` in the IE catalog, so with the rule inactive it should
    // take a required slot instead of being pushed into core.
    await seed(page, 'IE', { drop: ['DSA201'] });
    expect(await effOf(page, 'CS201'), 'CS201 should not be forced without DSA201').toBe('required');
  });
});

test.describe('PSIR core-elective pools', () => {
  // PSIR's core-typed courses are EXACTLY Core I + Core II, and the two minimums
  // (12 + 12) equal its 24-credit core requirement. So each pool can be emptied
  // only by filling `core` entirely from the other one.
  const CORE_I = ['LAW312', 'POLS251', 'POLS353', 'POLS404', 'POLS455', 'POLS483', 'POLS493', 'SOC201'];
  const CORE_II_IN_PLAN = ['CONF400', 'IR301', 'IR342', 'IR391'];
  const CORE_II_REST = ['IR394', 'IR405', 'IR489', 'LAW311', 'POLS492'];

  test('dropping the Core II pool raises flag 34', async ({ page }) => {
    // The plan holds all 8 Core I courses (24cr) — exactly the core requirement
    // — so removing Core II leaves `core` satisfied while Core II is empty.
    // Flag 3 cannot mask flag 34.
    await seed(page, 'PSIR', { drop: CORE_II_IN_PLAN });
    expect(await flag(page)).toBe(34);
  });

  test('dropping the Core I pool raises flag 33', async ({ page }) => {
    // All 9 Core II courses = 27cr, over the 24 core requirement, so Core I can
    // go entirely while `core` stays satisfied.
    await seed(page, 'PSIR', { add: CORE_II_REST, drop: CORE_I });
    expect(await flag(page)).toBe(33);
  });

  test('the generated plan satisfies both pools', async ({ page }) => {
    await seed(page, 'PSIR');
    const f = await flag(page);
    expect([33, 34], `flag ${f}: neither pool rule should fire`).not.toContain(f);
  });
});

test.describe('VACD core-elective pools', () => {
  // VACD's core requirement (27cr) EXCEEDS its two pool minimums (9 + 12 = 21),
  // so the balance must come from core-typed courses outside both pools — 16 of
  // which exist. That is also what made the old post-cascade pool handling
  // wrong: demoting a pool extra out of core left the freed credits unfilled
  // while core-eligible courses sat in `free`.
  const CORE_I_IN_PLAN = ['HART292', 'HART293', 'HART380', 'HART413'];
  const CORE_II_IN_PLAN = ['VA202', 'VA204', 'VA234', 'VA302', 'VA402'];
  const NON_POOL_CORE = ['HART450', 'HART480', 'VA323', 'VA324', 'VA328', 'VA331', 'VA335'];

  const readCore = (page) => page.evaluate(() => {
    const s = window.curriculum.semesters;
    const stranded = [];
    s.forEach((x) => x.courses.forEach((c) => {
      if (c.category === 'Core' && (c.effective_type || '') === 'free') stranded.push(c.code);
    }));
    return {
      flag: window.curriculum.canGraduate(),
      core: s.reduce((a, x) => a + (x.totalCore || 0), 0),
      stranded,
    };
  });

  test('core is filled from outside the pools when pool extras are demoted', async ({ page }) => {
    // The regression guard for the demote-without-refill bug: pool extras must
    // not cost core credits when core-typed courses are available to take their
    // place. This produced core=25 against a 27 requirement, with 18 credits of
    // core-typed courses stranded in `free`.
    await seed(page, 'VACD', { add: NON_POOL_CORE, drop: CORE_I_IN_PLAN });
    const r = await readCore(page);
    expect(r.core, `core=${r.core}; stranded in free: ${r.stranded.join(',') || 'none'}`).toBeGreaterThanOrEqual(27);
    expect(r.flag, 'core should be satisfied, so flag 3 must not fire').not.toBe(3);
  });

  test('dropping the Core I pool raises flag 30', async ({ page }) => {
    await seed(page, 'VACD', { add: NON_POOL_CORE, drop: CORE_I_IN_PLAN });
    expect(await flag(page)).toBe(30);
  });

  test('dropping the Core II pool raises flag 31', async ({ page }) => {
    await seed(page, 'VACD', { add: NON_POOL_CORE, drop: CORE_II_IN_PLAN });
    expect(await flag(page)).toBe(31);
  });

  test('the generated plan satisfies both pools', async ({ page }) => {
    await seed(page, 'VACD');
    const f = await flag(page);
    expect([30, 31], `flag ${f}: neither pool rule should fire`).not.toContain(f);
  });
});
