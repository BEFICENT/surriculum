'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan, hoist } = require('../helpers/plan');
const plans = require('../fixtures/passing-plans-multiterm.json');

// SUIS states the same free-elective language cap on every non-engineering
// major, in near-identical words (maintainer supplied all five verbatim):
//   MAN  "At most 2 of the Beginning / Basic level language courses can be used
//         to fulfill the requirements for this area."
//   PSY  "at most two of the beginning/basic level second language courses can
//         be used to fulfill the free elective requirements."
//   VACD "At most 2 of the Begnining / Basic level language courses ..."
//   PSIR "At most two of the beginning/basic level second language courses ..."
//   ECON "At most 2 of the Beginning / Basic level language courses ..."
//
// It was implemented for MAN only — and MAN's was dead anyway, testing course
// codes (LANG101-104) that exist in no catalog. All five now share one
// implementation, countBasicLanguageInFree(), across ten call sites (five
// majors x main/double-major pass). This spec is the guard on that sharing: if
// one major's copy ever drifts, one of these fails.
const TERM = '202301';
const TERM_NAME = 'Fall 2023-2024';
const BASIC_LANGUAGE_FLAG = 40;

// Three Basic-level courses -> over the cap of 2. Hoisted so they occupy free
// slots rather than being appended past a full pool.
const OVER_CAP = ['FRE110', 'FRE120', 'GER110'];
const AT_CAP = ['FRE110', 'FRE120'];

// Every non-engineering major. The value lists the extra courses each plan needs
// before it can even REACH its language check: canGraduate returns the FIRST
// unmet requirement, so any earlier major-specific flag masks flag 40. These are
// hoisted, so they also displace the generated plan's own choices where a pool
// is capped.
const MAJORS = {
  // Core caps at 6 courses; the generated plan's core spans only 5 areas (it
  // picks no ORG course at all), tripping flag 35 — one per area clears it.
  // OPIM302/ORG302 then overflow past the full core pool into area, which needs
  // to span ACC-FIN-MKTG-OPIM-ORG for flag 36 (MGMT is excluded from the Area
  // rule per SUIS, so the plan's MGMT overflow does not help).
  MAN: ['ACC201', 'FIN301', 'MGMT401', 'MKTG301', 'OPIM301', 'ORG301', 'OPIM302', 'ORG302'],
  // ECON201 gives a 3rd faculty area (flag 18); the two 4XX satisfy flag 39.
  PSY: ['ECON201', 'PSY403', 'PSY407'],
  PSIR: [],
  VACD: [],
  ECON: [],
};

const seedFor = (page, major, extras) => {
  const courses = hoist(plans[TERM][major].concat(extras), extras);
  return seedPlan(page, {
    major,
    entryTerm: TERM_NAME,
    curriculum: [courses],
    grades: [courses.map(() => 'A')],
    dates: [TERM_NAME],
  });
};

const readLangs = (page) => page.evaluate(() => {
  const BASIC = ['FRE110', 'FRE120', 'GER110', 'GER120', 'SPA110', 'SPA120', 'TUR101', 'TUR102'];
  const found = [];
  window.curriculum.semesters.forEach((s) => s.courses.forEach((c) => {
    if ((c.effective_type || '').toLowerCase() === 'free' && BASIC.includes(c.code)) found.push(c.code);
  }));
  return { flag: window.curriculum.canGraduate(), found };
});

test.describe('basic-language cap (all non-engineering majors)', () => {
  for (const [major, extras] of Object.entries(MAJORS)) {

    test(`${major}: more than 2 basic language courses is flagged`, async ({ page }) => {
      await seedFor(page, major, [...extras, ...OVER_CAP]);
      const r = await readLangs(page);
      expect(r.found.sort(), `${major}: the 3 basic courses should occupy free slots`).toEqual([...OVER_CAP].sort());
      expect(r.flag, `${major}: 3 basic language courses exceeds the cap of 2`).toBe(BASIC_LANGUAGE_FLAG);
    });

    test(`${major}: exactly 2 basic language courses is allowed`, async ({ page }) => {
      await seedFor(page, major, [...extras, ...AT_CAP]);
      const r = await readLangs(page);
      expect(r.found, `${major}: two basic language courses`).toHaveLength(2);
      expect(r.flag, `${major}: 2 is the cap, not a violation`).not.toBe(BASIC_LANGUAGE_FLAG);
    });
  }

  test('intermediate language courses are not capped', async ({ page }) => {
    // SUIS caps "Beginning / Basic level" only. FRE130/FRE140/TUR201 are
    // Intermediate and must not count toward the limit, so three of them
    // alongside two Basic ones is still legal.
    await seedFor(page, 'VACD', [...AT_CAP, 'FRE130', 'FRE140', 'TUR201']);
    const r = await readLangs(page);
    expect(r.found, 'only the Basic courses count toward the cap').toHaveLength(2);
    expect(r.flag, 'intermediate courses must not trip the cap').not.toBe(BASIC_LANGUAGE_FLAG);
  });
});
