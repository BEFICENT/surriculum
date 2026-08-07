'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScriptGlobals } = require('./helpers/load-script');

const { courseRequisites: req } = loadScriptGlobals('scripts/course_requisites.js');

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
