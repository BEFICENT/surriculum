'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');
const plans = require('../fixtures/passing-plans-multiterm.json');

// Bug #21 — VACD-as-DOUBLE-MAJOR must allocate its core pools the same way as
// VACD-as-main.
//
// The main pass was fixed (cdc528e) to resolve VACD's two core pools BEFORE the
// allocation cascade (selectVacdCorePools + a `forceCore` pin), because the VACD
// core requirement at 202301 is exactly the two historical pool minimums
// (9 + 18 = 27). The old post-cascade approach could still choose/demote the
// wrong pool courses after the cascade had already spent the core cap, making
// the result depend on course order. Catalog-order fixtures masked that class
// of failure.
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
  'HART292', 'HART293', 'HART380', 'HART392', 'HART411', 'HART413', 'HART414',
  'HART426', 'HART450', 'HART480', 'PHIL322', 'VA315', 'VA420', 'VA430', 'VIS412',
  'VA202', 'VA204', 'VA234', 'VA302', 'VA304', 'VA323', 'VA324', 'VA328',
  'VA331', 'VA335', 'VA402', 'VA404', 'VA431', 'VA433', 'VA434', 'VA440',
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
