'use strict';

// Live-source graduation coverage.
//
// The facts below were re-captured from the official SUIS degree-detail pages
// on 2026-07-23. Tests stay offline and deterministic: each captured fact is
// compared with the matching frozen requirements/<term>.jsonl record, and the
// behavioral cases then drive the real rule evaluator with those records.
//
// Source URL template:
// https://suis.sabanciuniv.edu/prod/SU_DEGREE.p_degree_detail
//   ?P_PROGRAM=<program>&P_LANG=EN&P_LEVEL=UG&P_TERM=<term>&P_SUBMIT=Select
//
// EE 202201-202403 and ME 202301-202503 are intentionally absent from the
// captured threshold matrix: their live pages contain internally contradictory
// summary/prose values. Those pages are tracked as a release-data issue rather
// than being encoded here as uncertain graduation truth.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadScriptGlobals, REPO_ROOT } = require('./helpers/load-script');

const {
  evaluateRules,
  facultyRules,
  graduationRulesFor,
  groupRules,
} = loadScriptGlobals('scripts/s_curriculum.js');

const MAJORS = ['BIO', 'CS', 'DSA', 'ECON', 'EE', 'IE', 'MAN', 'MAT', 'ME', 'PSIR', 'PSY', 'VACD'];
const GROUP_RULES = new Set([
  'faculty', 'credits', 'oneOf', 'entryGatedOneOf', 'languageCap',
  'levelCredits', 'specialAny', 'prefixSpan', 'offeringCredits',
  'offeringCount', 'advancedCount',
]);
const MEMBER_RULES = new Set(['credits', 'oneOf', 'entryGatedOneOf', 'specialAny']);

const termFiles = fs.readdirSync(path.join(REPO_ROOT, 'requirements'))
  .filter((name) => /^\d{6}\.jsonl$/.test(name))
  .sort();

const readJsonl = (file) => fs.readFileSync(file, 'utf8')
  .split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));

const reqCache = new Map();
const catalogCache = new Map();

function requirementsFor(term) {
  if (!reqCache.has(term)) {
    const rows = readJsonl(path.join(REPO_ROOT, 'requirements', `${term}.jsonl`));
    reqCache.set(term, Object.fromEntries(rows.map((row) => [row.major, row])));
  }
  return reqCache.get(term);
}

function catalogFor(term, major) {
  const key = `${term}/${major}`;
  if (!catalogCache.has(key)) {
    const rows = readJsonl(path.join(REPO_ROOT, 'courses', term, `${major}.jsonl`));
    catalogCache.set(key, new Map(rows.map((row) => [`${row.Major}${row.Code}`, row])));
  }
  return catalogCache.get(key);
}

const summaryTuple = (req) => [
  req.university, req.required, req.core, req.area, req.free, req.total, req.ects,
];

const sourceUrl = (program, term) => (
  'https://suis.sabanciuniv.edu/prod/SU_DEGREE.p_degree_detail'
  + `?P_PROGRAM=${program}&P_LANG=EN&P_LEVEL=UG&P_TERM=${term}&P_SUBMIT=Select`
);

const LIVE_SUMMARIES = [
  {
    label: 'BIO three-era boundary', major: 'BIO', program: 'BSBIO', snapshots: {
      201901: [41, 21, 39, 9, 15, 125, 240],
      202001: [41, 33, 29, 9, 15, 127, 240],
      202501: [41, 39, 29, 9, 15, 133, 240],
    },
  },
  {
    label: 'CS three-era boundary', major: 'CS', program: 'BSCS', snapshots: {
      201901: [41, 25, 35, 9, 15, 125, 240],
      202101: [41, 29, 31, 9, 15, 125, 240],
      202501: [41, 40, 27, 9, 15, 132, 240],
    },
  },
  {
    label: 'IE within-year boundary', major: 'IE', program: 'BSMS', snapshots: {
      202401: [41, 31, 29, 9, 15, 125, 240],
      202402: [41, 34, 26, 9, 15, 125, 240],
    },
  },
  {
    label: 'MAT 2025 boundary', major: 'MAT', program: 'BSMAT', snapshots: {
      202401: [41, 26, 34, 9, 15, 125, 240],
      202501: [41, 36, 31, 9, 15, 132, 240],
    },
  },
  {
    label: 'DSA one-credit 2025 boundary', major: 'DSA', program: 'BSDSA', snapshots: {
      202401: [41, 30, 27, 12, 15, 125, 240],
      202501: [41, 31, 27, 12, 15, 126, 240],
    },
  },
];

for (const boundary of LIVE_SUMMARIES) {
  test(`live SUIS: ${boundary.label} matches the frozen requirement records`, () => {
    for (const [term, expected] of Object.entries(boundary.snapshots)) {
      assert.deepEqual(
        summaryTuple(requirementsFor(term)[boundary.major]),
        expected,
        sourceUrl(boundary.program, term),
      );
    }
  });
}

test('live SUIS: PSIR removes POLS304 and IR389 at the 2019-to-2020 boundary', () => {
  const oldReq = requirementsFor('201901').PSIR;
  const newReq = requirementsFor('202001').PSIR;
  const oldPol = oldReq.groups.find((g) => g.id === 'core_polisci');
  const oldIr = oldReq.groups.find((g) => g.id === 'core_ir');
  const newPol = newReq.groups.find((g) => g.id === 'core_polisci');
  const newIr = newReq.groups.find((g) => g.id === 'core_ir');

  assert.equal(oldPol.min, 12, sourceUrl('BAPSIR', '201901'));
  assert.equal(oldIr.min, 12, sourceUrl('BAPSIR', '201901'));
  assert.ok(oldPol.members.includes('POLS304'));
  assert.ok(oldIr.members.includes('IR389'));
  assert.equal(newPol.min, 12, sourceUrl('BAPSIR', '202001'));
  assert.equal(newIr.min, 12, sourceUrl('BAPSIR', '202001'));
  assert.ok(!newPol.members.includes('POLS304'));
  assert.ok(!newIr.members.includes('IR389'));
});

test('live SUIS: VACD 202401 moves six credits from Core to Area and trims both pools', () => {
  const oldReq = requirementsFor('202303').VACD;
  const newReq = requirementsFor('202401').VACD;
  const oldHistory = oldReq.groups.find((g) => g.id === 'core_arthistory');
  const newHistory = newReq.groups.find((g) => g.id === 'core_arthistory');
  const oldSkill = oldReq.groups.find((g) => g.id === 'core_skill');
  const newSkill = newReq.groups.find((g) => g.id === 'core_skill');

  assert.deepEqual(summaryTuple(oldReq), [44, 15, 27, 18, 21, 125, 240], sourceUrl('BAVACD', '202303'));
  assert.deepEqual(summaryTuple(newReq), [44, 15, 21, 24, 21, 125, 240], sourceUrl('BAVACD', '202401'));
  assert.deepEqual([oldHistory.min, oldSkill.min], [9, 18]);
  assert.deepEqual([newHistory.min, newSkill.min], [9, 12]);
  for (const code of ['HART380', 'PHIL322']) {
    assert.ok(oldHistory.members.includes(code), `${code} should be in the 202303 history pool`);
    assert.ok(!newHistory.members.includes(code), `${code} should be absent from the 202401 history pool`);
  }
  for (const code of ['VA323', 'VA324', 'VA328', 'VA331', 'VA335', 'VA431', 'VA433', 'VA434', 'VA440']) {
    assert.ok(oldSkill.members.includes(code), `${code} should be in the 202303 skill pool`);
    assert.ok(!newSkill.members.includes(code), `${code} should be absent from the 202401 skill pool`);
  }
});

function maxPoolCredits(group, catalog) {
  const paired = new Set();
  let total = 0;
  for (const pair of group.exclusivePairs || []) {
    const values = pair.map((code) => Number(catalog.get(code).SU_credit) || 0);
    total += Math.max(...values);
    pair.forEach((code) => paired.add(code));
  }
  for (const code of group.members || []) {
    if (!paired.has(code)) total += Number(catalog.get(code).SU_credit) || 0;
  }
  return total;
}

function expectedGeneratedRuleCount(req) {
  const hum = req.humRequired >= 2 ? 2 : (req.humRequired >= 1 ? 1 : 0);
  const faculty = Object.keys(req.facultyReq || {}).length;
  const generated = req.groups
    ? req.groups.reduce((n, group) => n + (group.rule === 'faculty' ? faculty : 1), 0)
    : faculty;
  return 1 + hum + generated; // shared SPS303 + HUM + program rules
}

for (const filename of termFiles) {
  const term = filename.slice(0, 6);
  test(`requirements/${term}: every captured graduation rule is executable and catalog-backed`, () => {
    const byMajor = requirementsFor(term);
    assert.deepEqual(Object.keys(byMajor).sort(), MAJORS);

    for (const major of MAJORS) {
      const req = byMajor[major];
      const catalog = catalogFor(term, major);
      assert.equal(
        req.university + req.required + req.core + req.area + req.free,
        req.total,
        `${term}/${major}: category credits must add to total`,
      );
      assert.ok(req.facultyReq && Object.keys(req.facultyReq).length, `${term}/${major}: facultyReq`);
      if (req.internshipCourse) {
        assert.ok(catalog.has(req.internshipCourse), `${term}/${major}: missing ${req.internshipCourse}`);
      }

      for (const group of req.groups || []) {
        assert.ok(GROUP_RULES.has(group.rule), `${term}/${major}/${group.id}: unsupported ${group.rule}`);
        if (group.rule === 'faculty') continue;
        assert.equal(typeof group.suis, 'string', `${term}/${major}/${group.id}: source label`);
        assert.ok(group.suis.length > 0, `${term}/${major}/${group.id}: source label`);

        if (MEMBER_RULES.has(group.rule)) {
          assert.ok(Array.isArray(group.members) && group.members.length, `${term}/${major}/${group.id}: members`);
          for (const code of group.members) {
            assert.ok(catalog.has(code), `${term}/${major}/${group.id}: catalog missing ${code}`);
          }
        }
        for (const pair of group.exclusivePairs || []) {
          for (const code of pair) {
            assert.ok(group.members.includes(code), `${term}/${major}/${group.id}: pair member ${code}`);
            assert.ok(catalog.has(code), `${term}/${major}/${group.id}: pair catalog member ${code}`);
          }
        }
        if (group.rule === 'credits') {
          assert.ok(maxPoolCredits(group, catalog) >= group.min,
            `${term}/${major}/${group.id}: pool cannot reach ${group.min} SU`);
        }
        if (group.rule === 'prefixSpan') {
          const prefixes = new Set([...catalog.entries()]
            .filter(([, row]) => String(row.EL_Type).toLowerCase() === group.category)
            .map(([code]) => group.prefixes.find((prefix) => code.startsWith(prefix)))
            .filter(Boolean));
          assert.ok(prefixes.size >= group.min, `${term}/${major}/${group.id}: only ${prefixes.size} prefixes`);
        }
        if (group.rule === 'offeringCount') {
          const count = [...catalog.values()].filter((row) => (
            String(row.EL_Type).toLowerCase() === 'core' && row.Faculty === group.faculty
          )).length;
          assert.ok(count >= group.min, `${term}/${major}/${group.id}: only ${count} ${group.faculty} core courses`);
        }
        if (group.rule === 'advancedCount') {
          const count = [...catalog.entries()].filter(([code, row]) => (
            /^PSY4\d{2}$/.test(code) && String(row.EL_Type).toLowerCase() === 'area'
          )).length;
          assert.ok(count >= group.min, `${term}/${major}/${group.id}: only ${count} advanced PSY courses`);
        }
      }

      const rules = graduationRulesFor(major, req);
      assert.equal(rules.length, expectedGeneratedRuleCount(req), `${term}/${major}: a group was dropped`);
      for (const rule of rules) {
        assert.equal(typeof rule.type, 'string', `${term}/${major}: generated rule type`);
        assert.ok(Number.isInteger(rule.flag) && rule.flag > 0, `${term}/${major}/${rule.type}: flag`);
        assert.equal(typeof rule.suis, 'string', `${term}/${major}/${rule.type}: source`);
      }
    }
  });
}

const FIELDS = { effective: 'effective_type', category: 'category' };

function ctxOf(courses, entryTerm) {
  return { semesters: [{ courses }], fields: FIELDS, entryTerm };
}

function courseFrom(term, major, code, options = {}) {
  const row = catalogFor(term, major).get(code);
  assert.ok(row, `${term}/${major}: missing course ${code}`);
  const staticType = String(row.EL_Type || '');
  return {
    code,
    grade: options.grade == null ? '' : options.grade,
    Faculty_Course: row.Faculty_Course,
    effective_type: options.effective || staticType,
    category: staticType ? staticType[0].toUpperCase() + staticType.slice(1) : '',
    Faculty: row.Faculty,
    SU_credit: String(row.SU_credit || '0'),
  };
}

function evaluateGroup(term, major, groupId, courses) {
  const req = requirementsFor(term)[major];
  const group = req.groups.find((candidate) => candidate.id === groupId);
  assert.ok(group, `${term}/${major}: missing group ${groupId}`);
  return evaluateRules(ctxOf(courses, term), groupRules([group], req.facultyReq));
}

test('VACD: the same 12-SU skill selection fails in 202303 and passes in 202401', () => {
  const codes = ['VA202', 'VA204', 'VA234', 'VA302'];
  const oldCourses = codes.map((code) => courseFrom('202303', 'VACD', code, { effective: 'core' }));
  const newCourses = codes.map((code) => courseFrom('202401', 'VACD', code, { effective: 'core' }));
  assert.equal(evaluateGroup('202303', 'VACD', 'core_skill', oldCourses), 31, 'old target is 18 SU');
  assert.equal(evaluateGroup('202401', 'VACD', 'core_skill', newCourses), 0, 'new target is 12 SU');
});

test('VACD: PHIL322 satisfies the old history pool but not the redesigned pool', () => {
  const codes = ['PHIL322', 'HART292', 'HART293'];
  const oldCourses = codes.map((code) => courseFrom('202303', 'VACD', code, { effective: 'core' }));
  // PHIL322 still exists in 202401, but is free-typed and no longer a pool member.
  const newCourses = codes.map((code) => courseFrom('202401', 'VACD', code, { effective: 'core' }));
  assert.equal(evaluateGroup('202303', 'VACD', 'core_arthistory', oldCourses), 0);
  assert.equal(evaluateGroup('202401', 'VACD', 'core_arthistory', newCourses), 30);
});

test('MAN: all six distinct core prefixes are required, not merely six core courses', () => {
  const codes = ['ACC201', 'FIN301', 'MGMT401', 'MKTG301', 'OPIM301', 'ORG301'];
  const courses = codes.map((code) => courseFrom('202501', 'MAN', code, { effective: 'core' }));
  assert.equal(evaluateGroup('202501', 'MAN', 'core_areas', courses.slice(0, 5)), 35);
  assert.equal(evaluateGroup('202501', 'MAN', 'core_areas', courses), 0);
  const duplicate = courseFrom('202501', 'MAN', 'ACC301', { effective: 'core' });
  assert.equal(evaluateGroup('202501', 'MAN', 'core_areas', courses.slice(0, 5).concat(duplicate)), 35);
});

test('MAN: all five distinct area prefixes are required', () => {
  const codes = ['ACC401', 'FIN402', 'MKTG401', 'OPIM390', 'ORG401'];
  const courses = codes.map((code) => courseFrom('202501', 'MAN', code, { effective: 'area' }));
  assert.equal(evaluateGroup('202501', 'MAN', 'area_areas', courses.slice(0, 4)), 36);
  assert.equal(evaluateGroup('202501', 'MAN', 'area_areas', courses), 0);
});

test('MAN: the FASS/FENS free-elective boundary is exactly 9 SU', () => {
  const codes = ['ANTH214', 'BIO304', 'CS300'];
  const courses = codes.map((code) => courseFrom('202501', 'MAN', code, { effective: 'free' }));
  assert.equal(evaluateGroup('202501', 'MAN', 'free_fassfens', courses.slice(0, 2)), 37);
  assert.equal(evaluateGroup('202501', 'MAN', 'free_fassfens', courses), 0);
});

test('MAN: five faculty courses still fail when only one is from SBS', () => {
  const req = requirementsFor('202501').MAN;
  const oneSbs = ['ACC201', 'ECON202', 'ECON204', 'CS201', 'CS204']
    .map((code) => courseFrom('202501', 'MAN', code));
  const twoSbs = oneSbs.concat(courseFrom('202501', 'MAN', 'FIN301'));
  assert.equal(evaluateRules(ctxOf(oneSbs, '202501'), facultyRules(req.facultyReq)), 22);
  assert.equal(evaluateRules(ctxOf(twoSbs, '202501'), facultyRules(req.facultyReq)), 0);
});

test('FASS faculty courses must span three recognized areas, not just total five courses', () => {
  const req = requirementsFor('202501').ECON;
  const twoAreas = ['ECON201', 'ECON202', 'ECON204', 'HART292', 'HART293']
    .map((code) => courseFrom('202501', 'ECON', code));
  const threeAreas = twoAreas.slice(0, 4).concat(courseFrom('202501', 'ECON', 'VA201'));
  assert.equal(evaluateRules(ctxOf(twoAreas, '202501'), facultyRules(req.facultyReq)), 18);
  assert.equal(evaluateRules(ctxOf(threeAreas, '202501'), facultyRules(req.facultyReq)), 0);
});

test('DSA: two FENS core offerings fail flag 27 and exactly three pass', () => {
  const two = ['BIO310', 'CS306'].map((code) => courseFrom('202501', 'DSA', code));
  const three = two.concat(courseFrom('202501', 'DSA', 'CS404'));
  assert.equal(evaluateGroup('202501', 'DSA', 'core_fens', two), 27);
  assert.equal(evaluateGroup('202501', 'DSA', 'core_fens', three), 0);
});

test('F/U/NA/W attempts cannot satisfy named, pool, or faculty graduation rules', () => {
  const rules = [
    { type: 'hasCourse', code: 'SPS303', flag: 11 },
    { type: 'poolCreditSum', pool: ['SPS303'], min: 3, flag: 31 },
    { type: 'facultyCount', pool: 'fens', min: 1, flag: 16 },
  ];
  for (const grade of ['F', 'U', 'NA', 'W']) {
    const course = {
      code: 'SPS303', grade, Faculty_Course: 'FENS', effective_type: 'core',
      category: 'Core', Faculty: 'FENS', SU_credit: '3',
    };
    for (const rule of rules) {
      assert.equal(evaluateRules(ctxOf([course], '202501'), [rule]), rule.flag, `${grade}/${rule.type}`);
    }
  }
});

test('projected and successful attempts remain eligible under the current graduation policy', () => {
  const rule = { type: 'hasCourse', code: 'SPS303', flag: 11 };
  for (const grade of ['', 'Registered', 'T', 'P', 'I', 'A']) {
    assert.equal(evaluateRules(ctxOf([{ code: 'SPS303', grade }], '202501'), [rule]), 0, grade || 'blank');
  }
});
