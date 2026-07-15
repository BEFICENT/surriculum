'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('../fixtures');
const { seedPlan, hoist } = require('../helpers/plan');
const plans = require('../fixtures/passing-plans-multiterm.json');

// The double-major allocation pass (recalcEffectiveTypesDouble) is a parallel
// copy of the main-major one, and it had drifted: every alternative-course rule
// was still applied AFTER the allocation cascade, which undercounts `required`
// (the cascade has already spilled the surplus into the elective pools, so
// freeing a required slot later refills nothing). The ME rule had also never
// been taught about ME403/ME425 at all.
//
// These tests pin the double-major path to the same behaviour as the main one.
// Each seeds a plan holding every required course of the DOUBLE major, so the
// required pool actually reaches its cap — which is the only state in which the
// undercount is reachable.
const ROOT = path.resolve(__dirname, '..', '..', '..');
const readReqs = (term) => Object.fromEntries(
  fs.readFileSync(path.join(ROOT, 'requirements', `${term}.jsonl`), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((d) => [d.major, d]),
);
const termName = (code) => {
  const y = Number(code.slice(0, 4));
  return `${{ '01': 'Fall', '02': 'Spring', '03': 'Summer' }[code.slice(4)]} ${y}-${y + 1}`;
};

// A neutral main major: these tests only read the DM totals, and MAN shares no
// special-case rule with the double majors under test.
const MAIN_MAJOR = 'MAN';

// NB the VACD case below MUST hoist its pair courses. The undercount is
// order-dependent, and the fixtures are generated in catalog order — the one
// order that happens to mask it. Seeded verbatim, that test passes against the
// buggy engine, which makes it no test at all.

async function seedDouble(page, { dm, term, courses, probe }) {
  await seedPlan(page, {
    major: MAIN_MAJOR,
    entryTerm: termName(term),
    doubleMajor: dm,
    entryTermDM: termName(term),
    curriculum: [courses],
    grades: [courses.map(() => 'A')],
    dates: [termName(term)],
  });
  return page.evaluate((codes) => {
    const s = window.curriculum.semesters;
    const eff = {};
    s.forEach((x) => x.courses.forEach((c) => {
      if (codes.includes(c.code)) eff[c.code] = c.effective_type_dm;
    }));
    return { requiredDM: s.reduce((a, x) => a + (x.totalRequiredDM || 0), 0), eff };
  }, probe);
}

// Exactly one member of an alternative pair holds the required slot; the extra
// spills into an elective pool rather than costing the student required credits.
function expectPair(eff, a, b, electives) {
  const types = [eff[a], eff[b]];
  expect(types.filter((t) => t === 'required'), `${a}/${b}: exactly one should be required (got ${types})`).toHaveLength(1);
  const extra = types.find((t) => t !== 'required');
  expect(electives, `${a}/${b}: extra should be an elective, got "${extra}"`).toContain(extra);
}

test.describe('double-major alternative-course rules', () => {
  test('VACD as double major: pairs do not cost required credits', async ({ page }) => {
    const TERM = '202301';
    const probe = ['VA201', 'VA203', 'VA300', 'VA301', 'VA303', 'VA401', 'VA403'];
    for (const c of probe) {
      expect(plans[TERM].VACD, `fixture should contain ${c}`).toContain(c);
    }
    const { requiredDM, eff } = await seedDouble(page, {
      dm: 'VACD',
      term: TERM,
      courses: hoist(plans[TERM].VACD, ['VA401', 'VA403', 'VA301', 'VA303']),
      probe,
    });

    expect(requiredDM, 'VACD requiredDM').toBeGreaterThanOrEqual(readReqs(TERM).VACD.required);
    // SUIS: only one of each pair is counted towards the degree, so the extra
    // is excluded outright rather than filling a free-elective slot.
    expectPair(eff, 'VA301', 'VA303', ['none']);
    expectPair(eff, 'VA401', 'VA403', ['none']);
    expect(eff.VA300, 'VA300 (0 credits) should stay required').toBe('required');
  });

  test('ME as double major (2025+): both alternative pairs are honoured', async ({ page }) => {
    const TERM = '202501';
    const probe = ['ME403', 'ME425', 'CS404', 'CS412'];
    for (const c of probe) {
      expect(plans[TERM].ME, `fixture should contain ${c}`).toContain(c);
    }
    const { requiredDM, eff } = await seedDouble(page, {
      dm: 'ME', term: TERM, courses: plans[TERM].ME, probe,
    });

    expect(requiredDM, 'ME requiredDM').toBeGreaterThanOrEqual(readReqs(TERM).ME.required);
    // ME403/ME425 was previously unhandled on the DM path entirely.
    expectPair(eff, 'ME403', 'ME425', ['core', 'area', 'free']);
    expectPair(eff, 'CS404', 'CS412', ['core', 'area', 'free']);
  });

  test('CS as double major (pre-2025): the extra math alternative counts toward nothing', async ({ page }) => {
    const TERM = '202301';
    const probe = ['MATH201', 'MATH212'];
    for (const c of probe) {
      expect(plans[TERM].CS, `fixture should contain ${c}`).toContain(c);
    }
    const { requiredDM, eff } = await seedDouble(page, {
      dm: 'CS', term: TERM, courses: plans[TERM].CS, probe,
    });

    expect(requiredDM, 'CS requiredDM').toBeGreaterThanOrEqual(readReqs(TERM).CS.required);
    // SUIS: with both taken, MATH201 is dropped from EVERY pool — not core,
    // not area, not free — while MATH212 keeps its required slot.
    expect(eff.MATH201, 'MATH201 should be excluded from all pools').toBe('none');
    expect(eff.MATH212, 'MATH212 should hold the required slot').toBe('required');
  });
});
