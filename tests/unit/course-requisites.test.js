'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScriptsGlobals } = require('./helpers/load-script');

const { courseRequisites: req } = loadScriptsGlobals([
  'scripts/registration_rules.js',
  'scripts/requisites/expression-policy.js',
  'scripts/course_requisites.js',
]);

const semester = (termCode, courses) => ({ termCode, courses });
const course = (code, id, grade = 'A') => ({ code, id: id || code, grade });
const eligible = (value) => !['F', 'U', 'NA', 'W'].includes(String(value.grade || '').toUpperCase());

test('course tokens include five-digit special topics and identify planner-only components', () => {
  assert.deepEqual(
    [...req.extractCourseCodes('CS 48001 and EE 4801L or EE 200')],
    ['CS48001', 'EE4801L', 'EE200'],
  );
  for (const code of ['MATH102R', 'CS303L', 'ARA110D', 'EE4801L']) {
    assert.equal(req.isPlannerComponentCode(code), true, code);
  }
  assert.equal(req.isPlannerComponentCode('EE202'), false);
});

test('shared prerequisite evaluator preserves AND, OR, and parentheses', () => {
  const text = '(MATH 201 and MATH 203) or MATH 212';
  assert.equal(req.evaluatePrerequisites(text, ['MATH212']), null, 'single alternative satisfies');
  assert.equal(req.evaluatePrerequisites(text, ['MATH201', 'MATH203']), null, 'compound alternative satisfies');

  const missing = req.evaluatePrerequisites(text, ['MATH201']);
  assert.ok(missing);
  assert.deepEqual(missing.required, []);
  assert.deepEqual(JSON.parse(JSON.stringify(missing.oneOf)), [['MATH201 + MATH203', 'MATH212']]);
});

test('shared evaluator honors course-specific concurrent qualifiers', () => {
  const text = 'NS 102 - Undergraduate - Min Grade D(can be taken concurrently) '
    + 'and MATH 102 - Undergraduate - Min Grade D';
  const ast = req.parsePrerequisiteExpression(text);
  assert.equal(ast.items[0].id, 'NS102');
  assert.equal(ast.items[0].concurrent, true);
  assert.equal(ast.items[1].id, 'MATH102');
  assert.equal(ast.items[1].concurrent, false);

  assert.equal(req.evaluatePrerequisites(text, ['MATH102'], {
    concurrentAvailableCodes: ['NS102'],
  }), null, 'only the explicitly concurrent prerequisite may be same-term');
  assert.ok(req.evaluatePrerequisites(text, ['NS102'], {
    concurrentAvailableCodes: ['MATH102'],
  }), 'same-term MATH102 does not satisfy its ordinary prerequisite clause');
});

test('planner prerequisites require an eligible attempt in a strictly earlier term', () => {
  const info = new Map([['MATH102', { prerequisites: 'MATH 101 - Undergraduate - Min Grade D' }]]);
  const warningFor = (rows) => req.plannerWarningsForSemesters(rows, info, eligible)
    .find((item) => item.courseCode === 'MATH102');

  assert.equal(warningFor([
    semester('202401', [course('MATH101')]),
    semester('202402', [course('MATH102')]),
  ]), undefined, 'earlier successful course satisfies');

  assert.ok(warningFor([semester('202401', [course('MATH101'), course('MATH102')])]),
    'same-term prerequisite remains advisory-unmet');
  assert.ok(warningFor([
    semester('202401', [course('MATH102')]),
    semester('202402', [course('MATH101')]),
  ]), 'later prerequisite does not satisfy');
  assert.ok(warningFor([
    semester('202401', [course('MATH101', '', 'F')]),
    semester('202402', [course('MATH102')]),
  ]), 'failed earlier attempt does not satisfy');
});

test('planner accepts concurrent clauses and enforces the S minimum', () => {
  const concurrentInfo = new Map([['ENS205', {
    prerequisites: 'NS 102 - Undergraduate - Min Grade D(can be taken concurrently) '
      + 'and MATH 102 - Undergraduate - Min Grade D',
  }]]);
  assert.equal(req.plannerWarningsForSemesters([
    semester('202401', [course('MATH102')]),
    semester('202402', [course('NS102'), course('ENS205', '', '')]),
  ], concurrentInfo, eligible).length, 0);
  assert.ok(req.plannerWarningsForSemesters([
    semester('202402', [course('MATH102'), course('NS102'), course('ENS205', '', '')]),
  ], concurrentInfo, eligible).some((item) => item.courseCode === 'ENS205'));

  const satisfactoryInfo = new Map([['CIP102', {
    prerequisites: 'CIP 101 - Undergraduate - Min Grade S '
      + 'or TDP 101 - Undergraduate - Min Grade S',
  }]]);
  const warningForGrade = (grade) => req.plannerWarningsForSemesters([
    semester('202401', [course('CIP101', '', grade)]),
    semester('202402', [course('CIP102', '', '')]),
  ], satisfactoryInfo, eligible).find((item) => item.courseCode === 'CIP102');
  assert.ok(warningForGrade('D'), 'a letter D does not satisfy a Min Grade S clause');
  assert.equal(warningForGrade('S'), undefined);
  assert.equal(warningForGrade(''), undefined, 'a projected prerequisite remains valid planning');

  for (const grade of ['', 'Registered', 'P', 'I', 'S', 'T']) {
    assert.equal(req.courseMeetsMinimumGrade(course('CIP101', '', grade), 'S'), true, grade);
  }
  for (const grade of ['A', 'D', 'F', 'U', 'NA', 'W']) {
    assert.equal(req.courseMeetsMinimumGrade(course('CIP101', '', grade), 'S'), false, grade);
  }

  const ens492Info = new Map([['ENS492', {
    prerequisites: 'ENS 491 - Undergraduate - Min Grade S '
      + 'or ENS 491 - Undergraduate - Min Grade D',
  }]]);
  const ens492Warning = (grade) => req.plannerWarningsForSemesters([
    semester('202401', [course('ENS491', '', grade)]),
    semester('202402', [course('ENS492', '', '')]),
  ], ens492Info, eligible).find((item) => item.courseCode === 'ENS492');
  assert.equal(ens492Warning('D'), undefined, 'the duplicate Min Grade D branch remains sufficient');
  assert.ok(ens492Warning('F'));
});

test('completed courses can satisfy prerequisites without becoming warning targets', () => {
  const info = new Map([
    ['MATH101', { prerequisites: 'SPS 101 - Undergraduate - Min Grade D' }],
    ['MATH102', { prerequisites: 'MATH 101 - Undergraduate - Min Grade D' }],
  ]);
  const target = (value) => value.grade !== 'A';
  const warnings = req.plannerWarningsForSemesters([
    semester('202401', [course('MATH101', '', 'A')]),
    semester('202402', [course('MATH102', '', '')]),
  ], info, eligible, target);
  assert.equal(warnings.some((item) => item.courseCode === 'MATH101'), false);
  assert.equal(warnings.some((item) => item.courseCode === 'MATH102'), false,
    'the completed MATH101 still satisfies the projected MATH102');
});

test('prior-SU prerequisites count eligible positive credits only in strictly earlier terms', () => {
  const rows = [
    semester('202401', [
      { code: 'MATH101', grade: 'A', SU_credit: 3 },
      { code: 'MATH102', grade: '', SU_credit: 3 },
      { code: 'FAILED', grade: 'F', SU_credit: 4 },
      { code: 'WITHDRAWN', grade: 'W', SU_credit: 4 },
      { code: 'NAATTEMPT', grade: 'NA', SU_credit: 4 },
      { code: 'UNSUPPORTED', grade: 'A+', SU_credit: 4 },
      { code: 'ZERO', grade: 'A', SU_credit: 0 },
      { code: 'NEGATIVE', grade: 'A', SU_credit: -3 },
      { code: 'DUPLICATE', grade: 'A', SU_credit: 2 },
    ]),
    semester('202402', [
      { code: 'DUPLICATE', grade: '', SU_credit: 3 },
      { code: 'CURRENT', grade: 'A', SU_credit: 30 },
    ]),
    semester('202403', [{ code: 'LATER', grade: 'A', SU_credit: 30 }]),
    semester('', [{ code: 'UNKNOWNTERM', grade: 'A', SU_credit: 30 }]),
  ];
  const planningEligible = (value) => (
    !['F', 'U', 'NA', 'W', 'A+'].includes(String(value.grade || '').toUpperCase())
  );

  assert.equal(req.priorEligibleSuCredits(rows, '202402', planningEligible), 8,
    'successful and pending earlier courses count, duplicate codes count once at max credit');
  assert.equal(req.priorEligibleSuCredits(rows, '202403', planningEligible), 39,
    'the previously same-term course contributes only when the target moves later');
  assert.equal(req.priorEligibleSuCredits(rows, '', planningEligible), 0,
    'unknown target identity fails open without inventing prior credits');
});

test('minimum prior-SU comparison preserves exact decimal boundaries', () => {
  const under = req.minimumPriorSuRequirement({ minimum_earned_su_credits: 58 }, 57.99);
  assert.equal(under.minimum, 58);
  assert.equal(under.actual, 57.99);
  assert.ok(Math.abs(under.missing - 0.01) < 1e-9);
  assert.equal(req.minimumPriorSuRequirement(
    { minimum_earned_su_credits: 58 },
    58,
  ), null);
  assert.equal(req.minimumPriorSuRequirement(
    { minimum_earned_su_credits: 58 },
    60,
  ), null);
  assert.equal(req.minimumPriorSuRequirement({}, 0), null);
});

test('ordinary and General Requirements course clauses are independent AND conditions', () => {
  const info = {
    prerequisites: 'MATH 101 - Undergraduate - Min Grade D',
    general_requirement_prerequisites:
      'SPS 101 - Undergraduate - Min Grade D and SPS 102 - Undergraduate - Min Grade D',
  };

  const missingGeneral = req.evaluateCoursePrerequisites(info, ['MATH101', 'SPS101']);
  assert.deepEqual([...missingGeneral.required], ['SPS102']);
  const missingOrdinary = req.evaluateCoursePrerequisites(info, ['SPS101', 'SPS102']);
  assert.deepEqual([...missingOrdinary.required], ['MATH101']);
  assert.equal(req.evaluateCoursePrerequisites(info, ['MATH101', 'SPS101', 'SPS102']), null);
});

test('planner combines a HUM General Requirements course clause with its prior-SU threshold', () => {
  const info = new Map([['HUM201', {
    general_requirement_prerequisites:
      'SPS 101 - Undergraduate - Min Grade D and SPS 102 - Undergraduate - Min Grade D',
    minimum_earned_su_credits: 23,
  }]]);
  const eligibleCourse = (value) => !['F', 'U', 'NA', 'W'].includes(
    String(value.grade || '').toUpperCase(),
  );
  const rows = [
    semester('202401', [
      { code: 'SPS101', id: 'sps101', grade: 'A', SU_credit: 3 },
      { code: 'MATH101', id: 'math101', grade: '', SU_credit: 20 },
    ]),
    semester('202402', [{ code: 'HUM201', id: 'hum201', grade: '', SU_credit: 3 }]),
  ];

  const missingCourse = req.plannerWarningsForSemesters(rows, info, eligibleCourse)[0];
  assert.deepEqual([...missingCourse.prerequisite.required], ['SPS102']);
  assert.equal(missingCourse.priorSuRequirement, null, '23 earlier SU clears the credit clause');

  rows[0].courses.push({ code: 'SPS102', id: 'sps102', grade: '', SU_credit: 3 });
  rows[0].courses[1].SU_credit = 16.99;
  const missingCredits = req.plannerWarningsForSemesters(rows, info, eligibleCourse)[0];
  assert.equal(missingCredits.prerequisite, null, 'both SPS clauses are now planned earlier');
  assert.equal(missingCredits.priorSuRequirement.minimum, 23);
  assert.equal(missingCredits.priorSuRequirement.actual, 22.99);
});

test('planner checks different-course corequisites but suppresses recitation/lab components', () => {
  const info = new Map([
    ['EE200', { corequisites: 'EE 202' }],
    ['EE202', { corequisites: 'EE 200 and EE 202R' }],
    ['EE48010', { corequisites: 'EE 4801L' }],
  ]);
  const warningsFor = (rows) => req.plannerWarningsForSemesters(rows, info, eligible);

  const missing = warningsFor([semester('202401', [course('EE200')])]);
  assert.deepEqual([...missing[0].corequisites], ['EE202']);

  assert.equal(warningsFor([semester('202401', [course('EE200'), course('EE202')])]).length, 0,
    'same-term cross-course corequisites satisfy each other');
  const earlier = warningsFor([
    semester('202401', [course('EE202')]),
    semester('202402', [course('EE200')]),
  ]);
  assert.equal(earlier.some((item) => item.courseCode === 'EE200'), false,
    'an earlier cross-course corequisite satisfies the later course');
  assert.equal(warningsFor([semester('202401', [course('EE48010')])]).length, 0,
    'irregularly numbered lab component is not a planner course');
});

test('planner warnings use canonical program profiles for ENS491 and never target ENS491R', () => {
  const info = new Map([
    ['ENS491', { corequisites: 'ENS 491R' }],
    ['ENS491R', { prerequisites: 'MATH 101 - Undergraduate - Min Grade D' }],
  ]);
  const warnings = req.plannerWarningsForSemesters(
    [semester('202602', [course('ENS491', 'ens491', ''), course('ENS491R', 'ens491r', '')])],
    info,
    eligible,
    undefined,
    {
      programProfiles: [{ role: 'main', program: 'CS', admitTermCode: '202501' }],
    },
  );

  assert.deepEqual(
    JSON.parse(JSON.stringify(warnings.map((item) => item.courseCode))),
    ['ENS491'],
  );
  const warning = warnings[0];
  assert.equal(warning.priorSuRequirement.minimum, 80);
  assert.equal(warning.priorSuRequirement.actual, 0);
  assert.equal(warning.corequisites.length, 0);
  assert.equal(warning.supplemental.status, 'unmet');
  assert.ok(warning.supplemental.guidance.some((item) => (
    item.status === 'unmet' && /CS300, CS306, or CS308/.test(item.text)
  )));
});
