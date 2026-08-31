'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan, hoist } = require('../helpers/plan');
const plans = require('../test-data/passing-plans-multiterm.json');

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
// The cap is an allocation rule, not a ban on taking a third course: the first
// two degree-eligible basic courses fill free-elective credit, while later ones
// remain visible and CGPA-active but count toward no degree pool or total.
// All five programs share the same main/double-major implementation.
const TERM = '202301';
const TERM_NAME = 'Fall 2023-2024';
const BASIC_LANGUAGE_FLAG = 40;

// Hoisted so chronological allocation deterministically keeps FRE110/FRE120 and
// excludes GER110 as the third basic course.
const OVER_CAP = ['FRE110', 'FRE120', 'GER110'];
const AT_CAP = ['FRE110', 'FRE120'];

// Every non-engineering major. The values clear earlier program-specific rules
// so canGraduate reaches the language-cap invariant; they are hoisted because
// capped pools allocate chronologically.
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
  const BASIC = [
    'ARA110', 'ARA120', 'CHI110', 'CHI120', 'FRE110', 'FRE120',
    'GER110', 'GER120', 'ITA110', 'ITA120', 'JAP110', 'JAP120',
    'LAT110', 'LAT120', 'PERS110', 'PERS120', 'RUS110', 'RUS120',
    'SPA110', 'SPA120', 'TUR101', 'TUR102',
  ];
  const found = [], effective = {};
  let totalCredit = 0, gpaCredits = 0;
  window.curriculum.semesters.forEach((s) => s.courses.forEach((c) => {
    effective[c.code] = {
      type: (c.effective_type || '').toLowerCase(),
      reason: c.degreeExclusionReason || '',
      label: c.id ? (document.getElementById(c.id)?.querySelector('.course_type')?.textContent || '') : '',
    };
    if ((c.effective_type || '').toLowerCase() === 'free' && BASIC.includes(c.code)) found.push(c.code);
  }));
  window.curriculum.semesters.forEach((s) => {
    totalCredit += s.totalCredit || 0;
    gpaCredits += s.totalGPACredits || 0;
  });
  return { flag: window.curriculum.canGraduate(), found, effective, totalCredit, gpaCredits };
});

test.describe('basic-language cap (all non-engineering majors)', () => {
  for (const [major, extras] of Object.entries(MAJORS)) {

    test(`${major}: a third basic language course is retained but excluded`, async ({ page }) => {
      await seedFor(page, major, [...extras, ...OVER_CAP]);
      const r = await readLangs(page);
      expect(r.found, `${major}: only the first two basic courses count`).toEqual(AT_CAP);
      expect(r.effective.GER110.type, `${major}: the third basic course is degree N/A`).toBe('none');
      expect(r.effective.GER110.reason, `${major}: the exclusion is explained`).toMatch(/basic-language limit/i);
      expect(r.effective.GER110.label, `${major}: the visible allocation explains N/A`).toMatch(/basic-language limit/i);
      expect(r.flag, `${major}: an automatically excluded third course is not a graduation failure`).not.toBe(BASIC_LANGUAGE_FLAG);
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
    for (const code of ['FRE130', 'FRE140', 'TUR201']) {
      expect(r.effective[code].type, `${code} remains a free elective`).toBe('free');
    }
    expect(r.flag, 'intermediate courses must not trip the cap').not.toBe(BASIC_LANGUAGE_FLAG);
  });

  test('the excluded course leaves degree totals unchanged but remains in CGPA', async ({ page }) => {
    await seedFor(page, 'VACD', AT_CAP);
    const atCap = await readLangs(page);
    await seedFor(page, 'VACD', OVER_CAP);
    const overCap = await readLangs(page);

    expect(overCap.totalCredit, 'the third basic course adds no degree credit').toBe(atCap.totalCredit);
    expect(overCap.gpaCredits - atCap.gpaCredits, 'its letter grade still contributes to CGPA').toBe(3);
  });

  test('the chronologically earliest two courses count, independent of card order', async ({ page }) => {
    // Cards are intentionally newest-first and the courses are deliberately not
    // in allocation order: Fall FRE110, then Spring FRE120, then Summer GER110.
    await seedPlan(page, {
      major: 'ECON',
      entryTerm: TERM_NAME,
      curriculum: [['GER110'], ['FRE110'], ['FRE120']],
      grades: [['A'], ['A'], ['A']],
      dates: ['Summer 2022-2023', 'Fall 2022-2023', 'Spring 2022-2023'],
    });
    const r = await readLangs(page);
    expect(r.effective.FRE110.type, 'the earliest course counts first').toBe('free');
    expect(r.effective.FRE120.type, 'the second chronological course also counts').toBe('free');
    expect(r.effective.GER110.type, 'the later third course is excluded').toBe('none');
  });

  test('a failed earlier basic course does not consume one of the two positions', async ({ page }) => {
    await seedPlan(page, {
      major: 'ECON',
      entryTerm: TERM_NAME,
      curriculum: [['FRE120'], ['GER110'], ['FRE110']],
      grades: [['A'], ['F'], ['A']],
      dates: ['Summer 2022-2023', 'Fall 2022-2023', 'Spring 2022-2023'],
    });
    const r = await readLangs(page);
    expect(r.effective.FRE110.type).toBe('free');
    expect(r.effective.FRE120.type).toBe('free');
    expect(r.effective.GER110.type, 'the failed attempt remains N/A for failure, not the cap').toBe('none');
    expect(r.effective.GER110.reason).toBe('');
  });

  test('a FENS LANG course is CGPA-active but degree and PGPA N/A', async ({ page }) => {
    const lang = {
      Major: 'LANG', Code: '100', Course_Name: 'Swedish for International Students 1',
      ECTS: '3', Engineering: 0, Basic_Science: 0, SU_credit: '2', Faculty: '',
      Faculty_Course: 'No', EL_Type: 'unknown', Language_Level: 'basic',
    };
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      customCourses: { CS: [lang] },
      curriculum: [['LANG100']],
      grades: [['B+']],
      dates: ['Fall 2024-2025'],
    });
    const result = await page.evaluate(() => {
      const sem = window.curriculum.semesters[0];
      const course = sem.courses.find((c) => c.code === 'LANG100');
      const pgpa = window.curriculum.getProgramGpa('main');
      return {
        effective: course.effective_type,
        degreeCredits: sem.totalCredit,
        cgpaCredits: sem.totalGPACredits,
        cgpaPoints: sem.totalGPA,
        pgpaCredits: pgpa.credits,
        label: document.getElementById(course.id)?.querySelector('.course_type')?.textContent || '',
      };
    });
    expect(result.effective).toBe('none');
    expect(result.label).toBe('N/A');
    expect(result.degreeCredits).toBe(0);
    expect(result.pgpaCredits).toBe(0);
    expect(result.cgpaCredits).toBe(2);
    expect(result.cgpaPoints).toBeCloseTo(6.6, 5);
  });

  test('main totals stay contextual while double-major totals use the program union', async ({ page }) => {
    const definition = (type) => ({
      Major: 'LANG', Code: '100', Course_Name: 'Basic Swedish for International Students',
      ECTS: '6', Engineering: 0, Basic_Science: 0, SU_credit: '3', Faculty: '',
      Faculty_Course: 'No', EL_Type: type, Language_Level: 'basic',
    });
    const read = () => page.evaluate(() => {
      const course = window.curriculum.semesters[0].courses[0];
      const main = window.curriculum.getGraduationProgress('main');
      const dm = window.curriculum.getGraduationProgress('dm');
      return {
        effectiveMain: course.effective_type,
        effectiveDm: course.effective_type_dm,
        mainTotal: main.layers.projected.totals.total,
        mainEcts: main.layers.projected.totals.ects,
        combinedTotal: dm.layers.projected.totals.total,
        combinedEcts: dm.layers.projected.totals.ects,
        legacyCombined: window.curriculum.getCombinedDegreeMetrics(),
      };
    });

    await seedPlan(page, {
      major: 'CS', entryTerm: 'Fall 2024-2025',
      doubleMajor: 'MAN', entryTermDM: 'Fall 2024-2025',
      customCourses: { CS: [definition('unknown')], MAN: [definition('free')] },
      curriculum: [['LANG100']], grades: [['B+']], dates: ['Fall 2024-2025'],
    });
    expect(await read()).toEqual({
      effectiveMain: 'none', effectiveDm: 'free',
      mainTotal: 0, mainEcts: 0,
      combinedTotal: 3, combinedEcts: 6,
      legacyCombined: { total: 3, science: 0, engineering: 0, ects: 6 },
    });

    await seedPlan(page, {
      major: 'MAN', entryTerm: 'Fall 2024-2025',
      doubleMajor: 'CS', entryTermDM: 'Fall 2024-2025',
      customCourses: { MAN: [definition('free')], CS: [definition('unknown')] },
      curriculum: [['LANG100']], grades: [['B+']], dates: ['Fall 2024-2025'],
    });
    expect(await read()).toEqual({
      effectiveMain: 'free', effectiveDm: 'none',
      mainTotal: 3, mainEcts: 6,
      combinedTotal: 3, combinedEcts: 6,
      legacyCombined: { total: 3, science: 0, engineering: 0, ects: 6 },
    });
  });
});
