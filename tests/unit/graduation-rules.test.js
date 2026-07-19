'use strict';

// The graduation rules-as-data evaluator: evaluateRules(ctx, rules) walks an
// ordered descriptor list and returns the flag of the FIRST unmet rule (0 = all
// met). These pin each rule type's evaluator via the real dispatch path, plus the
// first-unmet-wins ordering. Rule tables (PROGRAM_RULES) and the wiring into
// canGraduate are separate; this covers the engine.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScriptGlobals } = require('./helpers/load-script');

const { evaluateRules, sumPoolCredits, graduationRulesFor } = loadScriptGlobals('scripts/s_curriculum.js');

const FIELDS = { effective: 'effective_type', category: 'category' };

// A minimal ctx over a flat course list. `curr` provides the course predicates
// the way the real curriculum does (code-normalised hasCourse/hasAnyCourse).
function ctxOf(courses, entryTerm) {
  const norm = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const has = (code) => courses.some((c) => norm(c.code) === norm(code));
  return {
    curr: { hasCourse: has, hasAnyCourse: (codes) => codes.some(has) },
    semesters: [{ courses }],
    fields: FIELDS,
    entryTerm,
  };
}
// course builder: code, faculty-course pool, effective_type, static category,
// offering Faculty, SU_credit.
const C = (code, opts = {}) => ({
  code,
  Faculty_Course: opts.pool,
  effective_type: opts.eff,
  category: opts.cat,
  Faculty: opts.fac,
  SU_credit: opts.cr != null ? String(opts.cr) : '3',
});
// evaluate a single rule -> 0 (met) or its flag (unmet)
const one = (courses, rule, entryTerm) => evaluateRules(ctxOf(courses, entryTerm), [rule]);

test('hasCourse / hasAny', () => {
  assert.equal(one([C('SPS303')], { type: 'hasCourse', code: 'SPS303', flag: 11 }), 0);
  assert.equal(one([C('CS201')], { type: 'hasCourse', code: 'SPS303', flag: 11 }), 11);
  assert.equal(one([C('HUM202')], { type: 'hasAny', codes: ['HUM201', 'HUM202'], flag: 12 }), 0);
  assert.equal(one([C('CS201')], { type: 'hasAny', codes: ['HUM201', 'HUM202'], flag: 12 }), 12);
});

test('facultyCount / facultyAreas delegate to the shared tallies', () => {
  const many = [C('CS401', { pool: 'FENS' }), C('MATH301', { pool: 'FENS' }),
    C('HIST191', { pool: 'FASS' }), C('MGMT301', { pool: 'SBS' }), C('IF100', { pool: 'FENS' })];
  assert.equal(one(many, { type: 'facultyCount', pool: 'total', min: 5, flag: 14 }), 0);
  assert.equal(one(many, { type: 'facultyCount', pool: 'total', min: 6, flag: 14 }), 14);
  assert.equal(one(many, { type: 'facultyCount', pool: 'fass', min: 2, flag: 15 }), 15);
});

test('levelCreditSum uses the STATIC category (EE 400-level core, flag 23)', () => {
  const courses = [
    C('EE401', { cat: 'Core', cr: 3 }),
    C('EE402', { cat: 'Core', cr: 3 }),
    C('EE403', { cat: 'Area', cr: 3 }),   // not Core -> excluded
    C('EE201', { cat: 'Core', cr: 3 }),   // not 400-level -> excluded
  ];
  assert.equal(one(courses, { type: 'levelCreditSum', prefix: 'EE4', category: 'Core', min: 9, flag: 23 }), 23);
  courses.push(C('EE404', { cat: 'Core', cr: 3 })); // now 9 core credits of EE4xx
  assert.equal(one(courses, { type: 'levelCreditSum', prefix: 'EE4', category: 'Core', min: 9, flag: 23 }), 0);
});

test('specialCourseAny: explicit code OR prefix+static category (EE, flag 24)', () => {
  const rule = { type: 'specialCourseAny', codes: ['CS300', 'ME303'], altPrefix: 'EE48', altCategory: 'Area', flag: 24 };
  assert.equal(one([C('ME303')], rule), 0, 'explicit code satisfies');
  assert.equal(one([C('EE485', { cat: 'Area' })], rule), 0, 'prefix+Area satisfies');
  assert.equal(one([C('EE485', { cat: 'Core' })], rule), 24, 'prefix but wrong category');
  assert.equal(one([C('CS101')], rule), 24, 'nothing matches');
});

test('poolCreditSum: requireCore filter and mutually-exclusive pairs', () => {
  const pool = ['VA302', 'VA304', 'VA402', 'VA404'];
  const pairs = [['VA302', 'VA304'], ['VA402', 'VA404']];
  // Both of the first pair taken as core, but only one counts: 3 credits.
  const sems = [{ courses: [C('VA302', { eff: 'core', cr: 3 }), C('VA304', { eff: 'core', cr: 3 })] }];
  assert.equal(sumPoolCredits(sems, pool,
    { effField: 'effective_type', requireCore: true, pairs }), 3, 'pair de-duplicated');
  // requireCore excludes a pool course allocated elsewhere.
  assert.equal(sumPoolCredits([{ courses: [C('VA402', { eff: 'free', cr: 3 })] }], pool,
    { effField: 'effective_type', requireCore: true, pairs }), 0, 'non-core excluded');
});

test('categoryPrefixSpan counts distinct prefixes in an effective category (MAN, flag 35)', () => {
  const rule = { type: 'categoryPrefixSpan', category: 'core', prefixes: ['ACC', 'FIN', 'MGMT', 'MKTG', 'OPIM', 'ORG'], min: 3, flag: 35 };
  const two = [C('ACC201', { eff: 'core' }), C('FIN301', { eff: 'core' }), C('FIN302', { eff: 'core' })];
  assert.equal(one(two, rule), 35, 'only 2 distinct prefixes (ACC, FIN)');
  two.push(C('MKTG301', { eff: 'core' }));
  assert.equal(one(two, rule), 0, 'now 3 distinct prefixes');
});

test('coreOfferingFacultyCount uses the OFFERING faculty on STATIC-core courses (DSA, 27)', () => {
  const rule = { type: 'coreOfferingFacultyCount', faculty: 'FENS', min: 3, flag: 27 };
  const courses = [C('X1', { cat: 'Core', fac: 'FENS' }), C('X2', { cat: 'Core', fac: 'FENS' }),
    C('X3', { cat: 'Core', fac: 'FASS' })];
  assert.equal(one(courses, rule), 27, 'only 2 FENS core');
  courses.push(C('X4', { cat: 'Core', fac: 'FENS' }));
  assert.equal(one(courses, rule), 0);
});

test('entryGatedHasAny applies only from the entry term onward (ME 2025+, flag 2)', () => {
  const rule = { type: 'entryGatedHasAny', minTerm: 202501, codes: ['CS404', 'CS412'], flag: 2 };
  assert.equal(one([C('ME101')], rule, '202401'), 0, 'pre-2025 entry: gate inactive');
  assert.equal(one([C('ME101')], rule, '202501'), 2, '2025+ entry without CS404/CS412: flagged');
  assert.equal(one([C('CS412')], rule, '202502'), 0, '2025+ entry with CS412: satisfied');
});

test('evaluateRules returns the FIRST unmet flag (order matters)', () => {
  const ctx = ctxOf([C('SPS303')]);
  const rules = [
    { type: 'hasCourse', code: 'SPS303', flag: 11 }, // met
    { type: 'hasCourse', code: 'PROJ201', flag: 4 }, // unmet -> should win
    { type: 'hasCourse', code: 'MATH101', flag: 25 }, // unmet, but later
  ];
  assert.equal(evaluateRules(ctx, rules), 4);
  assert.equal(evaluateRules(ctxOf([C('SPS303'), C('PROJ201'), C('MATH101')]), rules), 0, 'all met -> 0');
});

// The double-major pass and the main pass BOTH evaluate graduationRulesFor(major),
// so the table's contents are the single source for both. These pin the specific
// requirements the double-major pass used to be missing (its own incomplete
// copies) — asserting them on the shared table proves both passes now enforce them.
const ALL_MAJORS = ['CS', 'IE', 'EE', 'MAT', 'BIO', 'ME', 'ECON', 'MAN', 'PSIR', 'PSY', 'VACD', 'DSA'];
const FASS_MAJORS = ['ECON', 'MAN', 'PSIR', 'PSY', 'VACD'];
const flagsOf = (major) => graduationRulesFor(major).map((r) => r.flag);

test('every program requires SPS303 (flag 11) — DM non-CS used to skip it', () => {
  for (const m of ALL_MAJORS) {
    assert.ok(flagsOf(m).includes(11), `${m} should require SPS303`);
  }
});

test('HUM rule is generated from humRequired (scraped data), not hard-listed', () => {
  // 2 -> one 2XX AND one 3XX (flags 12 then 13); 1 -> any single HUM (12);
  // 0/absent -> none. It is a university rule, so it does not depend on the major.
  // Spread into a test-realm array (the rule list is built inside the vm sandbox).
  const humFlags = (major, humRequired) =>
    [...graduationRulesFor(major, humRequired).map((r) => r.flag).filter((f) => f === 12 || f === 13)];
  assert.deepEqual(humFlags('ECON', 2), [12, 13], 'humRequired 2 -> 12 then 13');
  assert.deepEqual(humFlags('CS', 1), [12], 'humRequired 1 -> flag 12 only');
  assert.deepEqual(humFlags('IE', 0), [], 'humRequired 0 -> no HUM');
  assert.deepEqual(humFlags('ECON', undefined), [], 'absent -> no HUM');
});

test('EE carries the faculty-course check (14/19/16) — EE-DM used to lack it', () => {
  const f = flagsOf('EE');
  for (const flag of [14, 19, 16]) assert.ok(f.includes(flag), `EE should carry flag ${flag}`);
});

test("ECON's mathematics requirement accepts MATH212 — ECON-DM used to omit it", () => {
  const mathRule = graduationRulesFor('ECON').find((r) => r.flag === 25);
  assert.ok(mathRule, 'ECON has a math requirement rule (25)');
  assert.ok(mathRule.codes.includes('MATH212'), 'MATH212 satisfies the ECON math requirement');
});

test('every rule carries a SUIS citation (incl. the generated HUM rules)', () => {
  for (const m of ALL_MAJORS) {
    for (const r of graduationRulesFor(m, 2)) {
      assert.equal(typeof r.suis, 'string', `${m} flag ${r.flag} needs a suis citation`);
      assert.ok(r.suis.length > 0);
    }
  }
});
