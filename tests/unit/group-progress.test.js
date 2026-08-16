'use strict';

// Phase 4 of the requirement-groups redesign: the Summary panel shows per-group
// PROGRESS (current/target), not just a met/unmet flag. groupProgressFor /
// facultyProgress measure the same quantity each graduation evaluator compares
// and report it as ordered rows. These pin the measurement + the derived `ok` so
// the summary can't silently disagree with the graduation check. Rows are built
// inside the vm sandbox, so each is spread into a test-realm object before
// deepEqual (the recurring vm-realm gotcha).

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScriptGlobals } = require('./helpers/load-script');

const { groupProgressFor, facultyProgress } = loadScriptGlobals('scripts/s_curriculum.js');

const FIELDS = {
  effective: 'effective_type',
  category: 'category',
  languageLevel: 'Language_Level',
  exclusionReason: 'degreeExclusionReason',
};

// A minimal ctx over a flat course list (same shape the real curriculum passes).
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
// course builder: code, faculty-course pool, effective_type, static category, SU.
const C = (code, opts = {}) => ({
  code,
  Faculty_Course: opts.pool,
  effective_type: opts.eff,
  category: opts.cat,
  Faculty: opts.fac,
  Language_Level: opts.languageLevel,
  degreeExclusionReason: opts.exclusionReason,
  SU_credit: opts.cr != null ? String(opts.cr) : '3',
});
const row = (r) => ({ ...r });

test('credits group reports base-effective SU as current/target', () => {
  const g = { id: 'core_arthistory', label: 'Core I', base: 'core', suis: 'Core I Electives',
    rule: 'credits', requireBase: true, min: 9, members: ['HART292', 'HART293', 'HART380'] };
  // Two of the pool taken as core (6 SU); a third pool course allocated to free
  // does NOT count (requireBase filters to core-effective).
  const rows = groupProgressFor(ctxOf([
    C('HART292', { eff: 'core', cr: 3 }),
    C('HART293', { eff: 'core', cr: 3 }),
    C('HART380', { eff: 'free', cr: 3 }),
  ]), [g]);
  assert.equal(rows.length, 1);
  assert.deepEqual(row(rows[0]), {
    id: 'core_arthistory', label: 'Core I', base: 'core', suis: 'Core I Electives',
    current: 6, target: 9, unit: 'SU', ok: false,
  });
});

test('credits group de-duplicates mutually-exclusive pairs', () => {
  const g = { id: 'core_skill', label: 'Core II', base: 'core', suis: 's', rule: 'credits',
    requireBase: true, min: 12, members: ['VA302', 'VA304'], exclusivePairs: [['VA302', 'VA304']] };
  // Both of the pair taken as core, but only one counts -> 3 SU.
  const rows = groupProgressFor(ctxOf([
    C('VA302', { eff: 'core', cr: 3 }),
    C('VA304', { eff: 'core', cr: 3 }),
  ]), [g]);
  assert.equal(rows[0].current, 3);
  assert.equal(rows[0].ok, false);
});

test('oneOf group reports 0/1 or 1/1', () => {
  const g = { id: 'math', label: 'Mathematics', base: 'required', suis: 's', rule: 'oneOf',
    members: ['MATH201', 'MATH212'] };
  assert.equal(groupProgressFor(ctxOf([C('CS201')]), [g])[0].current, 0);
  assert.deepEqual(row(groupProgressFor(ctxOf([C('MATH212')]), [g])[0]), {
    id: 'math', label: 'Mathematics', base: 'required', suis: 's',
    current: 1, target: 1, unit: 'course', ok: true,
  });
});

test('entryGatedOneOf is auto-satisfied (with a note) before its term', () => {
  const g = { id: 'ai', label: 'AI course', base: 'core', suis: 's', rule: 'entryGatedOneOf',
    minTerm: 202501, members: ['CS404', 'CS412'] };
  const pre = row(groupProgressFor(ctxOf([C('ME101')], '202401'), [g])[0]);
  assert.equal(pre.ok, true);
  assert.equal(pre.note, 'Not required for your admit term');
  // From the gate term on, it measures normally.
  assert.equal(groupProgressFor(ctxOf([C('ME101')], '202501'), [g])[0].ok, false);
  assert.equal(groupProgressFor(ctxOf([C('CS412')], '202501'), [g])[0].ok, true);
});

test('languageCap is a max (ok when under, isCap flagged)', () => {
  const g = { id: 'lang_cap', label: 'Basic language cap', base: 'free', suis: 's',
    rule: 'languageCap', max: 2 };
  const rows = groupProgressFor(ctxOf([C('CS201', { eff: 'free' })]), [g]);
  assert.deepEqual(row(rows[0]), {
    id: 'lang_cap', label: 'Basic language cap', base: 'free', suis: 's',
    current: 0, target: 2, unit: 'course', isCap: true, ok: true,
  });
});

test('languageCap reports automatically excluded courses as an advisory', () => {
  const g = { id: 'lang_cap', label: 'Basic language cap', base: 'free', suis: 's',
    rule: 'languageCap', max: 2 };
  const courses = [
    C('FRE110', { eff: 'free' }),
    C('FRE120', { eff: 'free' }),
    C('GER110', { eff: 'none', exclusionReason: 'Not counted — basic-language limit' }),
  ];
  const result = row(groupProgressFor(ctxOf(courses), [g])[0]);
  assert.equal(result.current, 2);
  assert.equal(result.ok, true);
  assert.equal(result.note, '1 additional basic language course excluded from degree credit');
});

test('facultyProgress emits the ticker rows in order with derived ok', () => {
  const ctx = ctxOf([
    C('HART101', { pool: 'FASS', eff: 'area' }),
    C('ECON201', { pool: 'FASS', eff: 'area' }),
    C('VA200', { pool: 'FASS', eff: 'area' }),
  ]);
  const rows = [...facultyProgress(ctx, { total: 5, fass: 3, areas: 3 })].map(row);
  assert.deepEqual([...rows.map((r) => r.id)], ['faculty_total', 'faculty_fass', 'faculty_areas']);
  assert.deepEqual([...rows.map((r) => [r.current, r.target, r.ok])],
    [[3, 5, false], [3, 3, true], [3, 3, true]]);
  assert.equal(rows[2].unit, 'area');
});

test('the faculty marker expands to the ticker at its position in groups', () => {
  const groups = [
    { rule: 'faculty' },
    { id: 'core_arthistory', label: 'Core I', base: 'core', suis: 's', rule: 'credits',
      requireBase: true, min: 9, members: ['HART292'] },
  ];
  const ctx = ctxOf([C('HART292', { pool: 'FASS', eff: 'core', cr: 3 })]);
  const rows = [...groupProgressFor(ctx, groups, { total: 5, fass: 3, areas: 3 })].map(row);
  // faculty rows (total, fass, areas) come first, then the credits group.
  assert.deepEqual([...rows.map((r) => r.id)],
    ['faculty_total', 'faculty_fass', 'faculty_areas', 'core_arthistory']);
});

test('EE level-credit and special-area rows mirror the live graduation rules', () => {
  const groups = [
    { id: 'ee400', label: '400-level EE', base: 'core', suis: 'EE Core Electives',
      rule: 'levelCredits', prefix: 'EE4', category: 'Core', min: 9 },
    { id: 'special_area', label: 'Special area course', base: 'area', suis: 'EE Area Electives',
      rule: 'specialAny', members: ['CS300', 'ME303'], altPrefix: 'EE48', altCategory: 'Area' },
  ];
  const rows = [...groupProgressFor(ctxOf([
    C('EE401', { cat: 'Core', cr: 3 }),
    C('EE402', { cat: 'Core', cr: 3 }),
    C('EE403', { cat: 'Core', cr: 3 }),
    C('EE485', { cat: 'Area', cr: 3 }),
  ]), groups)].map(row);

  assert.deepEqual([rows[0].current, rows[0].target, rows[0].ok], [9, 9, true]);
  assert.deepEqual([rows[1].current, rows[1].target, rows[1].ok], [1, 1, true]);
});

test('MAN prefix-span and FASS/FENS-credit rows report exact boundaries', () => {
  const groups = [
    { id: 'core_areas', label: 'Core areas', base: 'core', suis: 'MAN Core Electives',
      rule: 'prefixSpan', category: 'core', prefixes: ['ACC', 'FIN', 'MGMT', 'MKTG', 'OPIM', 'ORG'], min: 6 },
    { id: 'free_fassfens', label: 'FASS/FENS free credits', base: 'free', suis: 'MAN Free Electives',
      rule: 'offeringCredits', faculties: ['FASS', 'FENS'], min: 9 },
  ];
  const rows = [...groupProgressFor(ctxOf([
    C('ACC201', { eff: 'core' }), C('FIN301', { eff: 'core' }),
    C('MGMT401', { eff: 'core' }), C('MKTG301', { eff: 'core' }),
    C('OPIM301', { eff: 'core' }), C('ORG301', { eff: 'core' }),
    C('ANTH214', { eff: 'free', fac: 'FASS', cr: 3 }),
    C('BIO304', { eff: 'free', fac: 'FENS', cr: 3 }),
    C('CS300', { eff: 'free', fac: 'FENS', cr: 3 }),
  ]), groups)].map(row);

  assert.deepEqual([rows[0].current, rows[0].target, rows[0].ok], [6, 6, true]);
  assert.deepEqual([rows[1].current, rows[1].target, rows[1].ok], [9, 9, true]);
});

test('DSA offering-count row uses static Core and the offering faculty', () => {
  const group = { id: 'core_fens', label: 'FENS core courses', base: 'core', suis: 'DSA Core Electives',
    rule: 'offeringCount', faculty: 'FENS', min: 3 };
  const rowResult = row(groupProgressFor(ctxOf([
    C('BIO310', { cat: 'Core', fac: 'FENS', eff: 'area' }),
    C('CS306', { cat: 'Core', fac: 'FENS', eff: 'free' }),
    C('CS404', { cat: 'Core', fac: 'FENS', eff: 'core' }),
    C('ECON401', { cat: 'Core', fac: 'FASS', eff: 'core' }),
  ]), [group])[0]);
  assert.deepEqual([rowResult.current, rowResult.target, rowResult.ok], [3, 3, true]);
});

test('PSY advanced-count row requires PSY 4XX courses allocated to Area', () => {
  const group = { id: 'psy_advanced', label: 'Advanced PSY', base: 'area', suis: 'PSY Area Electives',
    rule: 'advancedCount', min: 2 };
  const rowResult = row(groupProgressFor(ctxOf([
    C('PSY401', { eff: 'area' }),
    C('PSY402', { eff: 'area' }),
    C('PSY403', { eff: 'free' }),
    C('PSY301', { eff: 'area' }),
  ]), [group])[0]);
  assert.deepEqual([rowResult.current, rowResult.target, rowResult.ok], [2, 2, true]);
});
