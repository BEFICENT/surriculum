'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');
const plans = require('../fixtures/passing-plans-multiterm.json');

// PSY requires PHIL300 or PHIL301 — an alternative pair. Both are EL_Type
// `required` in the PSY catalog, and the threshold is credit-tight:
//   PSY201+PSY202+PSY300(0cr)+PSY310+PSY320+PSY340+PSY350 = 18, + one PHIL = 21
//   = exactly the PSY `required` requirement.
//
// FLAG 26 IS THEREFORE UNREACHABLE. Its check (`hasCourse(PHIL300) ||
// hasCourse(PHIL301)`) sits in the major-specific section, which runs AFTER the
// generic `required < threshold` check (flag 2). A student missing both PHIL
// courses can reach at most 18 required credits, so flag 2 always fires first.
// Same category as flag 12 (HUM), documented unreachable for the same reason.
//
// These tests pin what actually happens, plus the flag-26 message, which was
// wrong in a way that would have been actively misleading had it ever surfaced:
// it read "You need to complete your Physics requirement (PHYS201, PHYS202, or
// PHYS204)!" while the only path returning 26 checks philosophy — and
// PHYS201/202/204 are not in the PSY catalog at all.
const TERM = '202301';
const TERM_NAME = 'Fall 2023-2024';
const PSY_REQUIRED = 21;
const PSY_CORE = 21; // = the 7-course named pool x 3cr

const seedPsy = (page, drop = []) => {
  const courses = plans[TERM].PSY.filter((c) => !drop.includes(c));
  return seedPlan(page, {
    major: 'PSY',
    entryTerm: TERM_NAME,
    curriculum: [courses],
    grades: [courses.map(() => 'A')],
    dates: [TERM_NAME],
  });
};

const read = (page) => page.evaluate(() => {
  const s = window.curriculum.semesters;
  const sum = (f) => s.reduce((a, x) => a + (x[f] || 0), 0);
  const eff = {};
  s.forEach((x) => x.courses.forEach((c) => { if (/^PHIL30[01]$/.test(c.code)) eff[c.code] = c.effective_type; }));
  return {
    flag: window.curriculum.canGraduate(),
    required: sum('totalRequired'),
    core: sum('totalCore'),
    eff,
  };
});

test.describe('PSY philosophy requirement (PHIL300 / PHIL301)', () => {
  test('either PHIL course alone fills the required pool', async ({ page }) => {
    for (const c of ['PHIL300', 'PHIL301']) {
      expect(plans[TERM].PSY, `fixture should contain ${c}`).toContain(c);
    }
    // Each alternative on its own must carry the pool to threshold — that is
    // what makes them alternatives rather than two separate requirements.
    for (const drop of ['PHIL301', 'PHIL300']) {
      await seedPsy(page, [drop]);
      const r = await read(page);
      expect(r.required, `required with ${drop} dropped`).toBeGreaterThanOrEqual(PSY_REQUIRED);
    }
  });

  test('dropping BOTH leaves the required pool short — flag 2, not the philosophy flag', async ({ page }) => {
    await seedPsy(page, ['PHIL300', 'PHIL301']);
    const r = await read(page);
    // The engine is right here, just not via the branch you would expect: the
    // student really is short on required credits, so the generic check wins.
    expect(r.required, 'required without any PHIL course').toBeLessThan(PSY_REQUIRED);
    expect(r.flag, 'generic required-short flag pre-empts the philosophy check').toBe(2);
  });

  test('taking BOTH: one fills the requirement, the extra is a free elective', async ({ page }) => {
    // SUIS is SILENT on taking both — there is no published rule. Assumption
    // agreed with the maintainer: one counts, the extra goes to free.
    //
    // It matters because the fallback was wrong in a specific way. Both PHIL
    // courses are catalog-`required`, so without a pair rule the cascade capped
    // `required` at 21 and pushed the extra PHIL down into `core` — inflating
    // core to 24. PSY's core is a named 14-course pool that excludes PHIL, so
    // that let a PHIL course help satisfy a requirement it is not part of.
    await seedPsy(page);
    const r = await read(page);

    const types = [r.eff.PHIL300, r.eff.PHIL301];
    expect(types.filter((t) => t === 'required'), `exactly one PHIL should be required (got ${types})`).toHaveLength(1);
    expect(types, 'the extra PHIL should be a free elective').toContain('free');
    expect(types, 'the extra PHIL must NOT land in core — it is not in the core pool').not.toContain('core');

    expect(r.required, 'one PHIL still carries required to threshold').toBe(PSY_REQUIRED);
    expect(r.core, 'core comes from the named pool only, un-inflated by the extra PHIL').toBe(PSY_CORE);
  });

  test('the flag-26 message names the philosophy courses, not physics', async ({ page }) => {
    await page.goto('/');
    const msg = await page.evaluate(async () => {
      const { buildFlagMessages } = await import('/cases/flagMessages.js');
      return buildFlagMessages('PSY')[26]();
    });
    // The message table is flat — buildFlagMessages uses `major` only for the
    // generic threshold messages — so there is no per-major variant of 26 for
    // which the physics wording could have been correct.
    expect(msg, 'should name the philosophy courses').toMatch(/PHIL\s?300/);
    expect(msg, 'should name the philosophy courses').toMatch(/PHIL\s?301/);
    expect(msg, 'must not send PSY students after physics courses').not.toMatch(/PHYS/);
  });
});
