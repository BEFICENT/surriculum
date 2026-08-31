'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadScriptsGlobals, REPO_ROOT } = require('./helpers/load-script');

const POLICY_PATH = 'scripts/requisites/expression-policy.js';
const COORDINATOR_PATH = 'scripts/course_requisites.js';
const policy = require('../../scripts/requisites/expression-policy.js');
const globals = loadScriptsGlobals([POLICY_PATH, COORDINATOR_PATH]);

const PUBLIC_API = [
  'normalizeCourseCode',
  'extractCourseCodes',
  'parsePrerequisiteExpression',
  'evaluatePrerequisites',
  'evaluateCoursePrerequisites',
  'mergePrerequisiteResults',
  'priorEligibleSuCredits',
  'minimumPriorSuRequirement',
  'isPlannerComponentCode',
  'courseMeetsMinimumGrade',
  'buildTermRequirementContext',
  'evaluateCandidateForTerm',
  'plannerWarningsForSemesters',
  'refreshPlannerWarnings',
  'queuePlannerWarningRefresh',
];

test('expression policy is frozen and courseRequisites keeps its exact public API', () => {
  assert.equal(Object.isFrozen(policy), true);
  assert.deepEqual(Object.keys(policy), [
    'normalizeCourseCode',
    'extractCourseCodes',
    'parsePrerequisiteExpression',
    'evaluatePrerequisites',
    'evaluateCoursePrerequisites',
    'mergePrerequisiteResults',
    'minimumPriorSuRequirement',
    'positiveSuCredit',
  ]);
  assert.deepEqual(Object.keys(globals.courseRequisites), PUBLIC_API);

  const browserPolicy = globals.SurriculumCourseRequisiteExpressions;
  assert.equal(Object.isFrozen(browserPolicy), true);
  for (const name of Object.keys(policy).filter((key) => key !== 'positiveSuCredit')) {
    assert.equal(globals.courseRequisites[name], browserPolicy[name], `${name} identity changed`);
  }
  assert.equal(Object.hasOwn(globals.courseRequisites, 'positiveSuCredit'), false,
    'the compatibility API must not grow an internal helper');
});

test('expression policy preserves grouping, qualifiers, and merged fields directly', () => {
  const expression = '(MATH 201 and MATH 203) or MATH 212';
  assert.equal(policy.evaluatePrerequisites(expression, ['MATH212']), null);
  const missing = policy.evaluatePrerequisites(expression, ['MATH201']);
  assert.deepEqual(missing.required, []);
  assert.deepEqual(missing.oneOf, [['MATH201 + MATH203', 'MATH212']]);

  const concurrent = policy.parsePrerequisiteExpression(
    'NS 102 - Min Grade D(can be taken concurrently) and MATH 102 - Min Grade D',
  );
  assert.equal(concurrent.items[0].concurrent, true);
  assert.equal(concurrent.items[0].minGrade, 'D');
  assert.equal(concurrent.items[1].concurrent, false);

  const merged = policy.evaluateCoursePrerequisites({
    prerequisites: 'MATH 101',
    general_requirement_prerequisites: 'NS 101',
  }, []);
  assert.deepEqual(merged.required, ['MATH101', 'NS101']);
});

test('course_requisites has an explicit policy load boundary and both files stay focused', () => {
  assert.throws(
    () => loadScriptsGlobals(COORDINATOR_PATH),
    /expression-policy\.js must load before course_requisites\.js/,
  );
  assert.ok(globals.courseRequisites, 'policy -> coordinator order should install the API');

  const limits = new Map([
    [POLICY_PATH, { lines: 400, bytes: 16 * 1024 }],
    [COORDINATOR_PATH, { lines: 850, bytes: 36 * 1024 }],
  ]);
  for (const [relative, limit] of limits) {
    const source = fs.readFileSync(path.join(REPO_ROOT, ...relative.split('/')), 'utf8');
    assert.ok(source.split(/\r?\n/).length <= limit.lines, `${relative} exceeded ${limit.lines} lines`);
    assert.ok(Buffer.byteLength(source) <= limit.bytes, `${relative} exceeded ${limit.bytes} bytes`);
  }
});
