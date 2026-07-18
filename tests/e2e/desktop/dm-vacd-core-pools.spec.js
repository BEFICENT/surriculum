'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');
const plans = require('../fixtures/passing-plans-multiterm.json');

// Bug #21 — VACD-as-DOUBLE-MAJOR must allocate its core pools the same way as
// VACD-as-main.
//
// The main pass was fixed (cdc528e) to resolve VACD's two core pools BEFORE the
// allocation cascade (selectVacdCorePools + a `forceCore` pin), because the VACD
// core requirement (27 at 202301) EXCEEDS the pool minimums (9 + 12 = 21) — so
// the remaining 6 core credits must come from core-typed courses OUTSIDE the
// pools. The old post-cascade approach demoted pool courses out of core after
// the cascade had already spent the core cap, stranding those non-pool core
// courses in area/free. It only misfires for SOME course orderings — the ones
// where pool courses are seen first — which is why catalog-order fixtures mask
// it.
//
// The double-major pass still carried that old post-cascade block. This test
// pins it to the main pass's result: the SAME VACD plan, allocated as the main
// major vs. as the double major, must produce the same per-course categories
// and the same core/area/free totals. Asserted across several orderings so a
// pool-first order (the triggering one) cannot slip through.

const TERM = '202301';
const TERM_NAME = 'Fall 2023-2024';
const VACD = plans[TERM].VACD;

// Every VACD core-pool member (pool 1 + pool 2), whether or not this plan holds
// it — used only to build the triggering order.
const POOL = [
  'HART292', 'HART293', 'HART380', 'HART413', 'HART426', 'VA315', 'VA420', 'VA430',
  'VA202', 'VA204', 'VA234', 'VA302', 'VA304', 'VA402', 'VA404',
];

const poolCourses = VACD.filter((c) => POOL.includes(c));
const nonPool = VACD.filter((c) => !POOL.includes(c));

const ORDERINGS = {
  'catalog order': VACD.slice(),
  // Pool courses first: the cascade fills the core cap with them, so any
  // non-pool core course the post-cascade block fails to keep is stranded.
  'pool courses first': poolCourses.concat(nonPool),
  'pool courses last': nonPool.concat(poolCourses),
};

// Read each course's allocated category (from `field`) plus the core/area/free
// totals (from the `suffix`-ed semester totals) for whichever pass we seeded.
const read = (page, field, suffix) => page.evaluate(({ f, sfx }) => {
  const s = window.curriculum.semesters;
  const eff = {};
  s.forEach((x) => x.courses.forEach((c) => { eff[c.code] = c[f]; }));
  const sum = (name) => s.reduce((a, x) => a + (x[name] || 0), 0);
  return {
    eff,
    core: sum('totalCore' + sfx),
    area: sum('totalArea' + sfx),
    free: sum('totalFree' + sfx),
  };
}, { f: field, sfx: suffix });

const asMain = async (page, order) => {
  await seedPlan(page, {
    major: 'VACD',
    entryTerm: TERM_NAME,
    curriculum: [order],
    grades: [order.map(() => 'A')],
    dates: [TERM_NAME],
  });
  return read(page, 'effective_type', '');
};

// A neutral main major (MAN shares no special rule with VACD); we only read the
// DM allocation.
const asDouble = async (page, order) => {
  await seedPlan(page, {
    major: 'MAN',
    entryTerm: TERM_NAME,
    doubleMajor: 'VACD',
    entryTermDM: TERM_NAME,
    curriculum: [order],
    grades: [order.map(() => 'A')],
    dates: [TERM_NAME],
  });
  return read(page, 'effective_type_dm', 'DM');
};

test.describe('VACD double-major core pools match the main-major allocation (#21)', () => {
  for (const [label, order] of Object.entries(ORDERINGS)) {
    test(`${label}: DM allocation equals main allocation`, async ({ page }) => {
      const main = await asMain(page, order);
      const dm = await asDouble(page, order);

      // Core/area/free totals are the headline: the old DM block undercounts
      // core by stranding non-pool core courses.
      expect(dm.core, `${label}: totalCoreDM must equal main totalCore`).toBe(main.core);
      expect(dm.area, `${label}: totalAreaDM must equal main totalArea`).toBe(main.area);
      expect(dm.free, `${label}: totalFreeDM must equal main totalFree`).toBe(main.free);

      // And every course must land in the same category on both paths.
      const mismatches = Object.keys(main.eff)
        .filter((code) => main.eff[code] !== dm.eff[code])
        .map((code) => `${code}: main=${main.eff[code]} dm=${dm.eff[code]}`);
      expect(mismatches, `${label}: per-course category mismatches`).toEqual([]);
    });
  }
});
