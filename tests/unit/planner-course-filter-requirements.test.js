'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScriptsGlobals } = require('./helpers/load-script');

const { courseRequisites: req } = loadScriptsGlobals([
  'scripts/requisites/expression-policy.js',
  'scripts/course_requisites.js',
]);

const semester = (termCode, courses = []) => ({ termCode, courses });
const course = (code, grade = 'A', SU_credit = 3) => ({
  code,
  id: `${code}-${termSequence += 1}`,
  grade,
  SU_credit,
});
let termSequence = 0;
const eligible = (value) => !['F', 'U', 'NA', 'W'].includes(
  String((value && value.grade) || '').toUpperCase(),
);

test('candidate prerequisites use canonical target chronology, never visual order', () => {
  const target = semester('202402');
  const earlier = semester('202401', [course('MATH101', 'A')]);
  const later = semester('202403', [course('NS101', 'A', 30)]);
  const info = { prerequisites: 'MATH 101 - Undergraduate - Min Grade D' };

  for (const rows of [
    [earlier, target, later],
    [later, target, earlier],
    [target, later, earlier],
  ]) {
    const context = req.buildTermRequirementContext(rows, target, eligible);
    const result = req.evaluateCandidateForTerm(info, 'MATH102', context);
    assert.equal(context.known, true);
    assert.equal(result.known, true);
    assert.equal(result.status, 'met');
    assert.equal(result.prerequisite, null);
  }

  const tooEarly = semester('202401');
  const laterPrereq = semester('202402', [course('MATH101', 'A')]);
  const context = req.buildTermRequirementContext([laterPrereq, tooEarly], tooEarly, eligible);
  const result = req.evaluateCandidateForTerm(info, 'MATH102', context);
  assert.equal(result.status, 'unmet');
  assert.deepEqual([...result.prerequisite.required], ['MATH101']);
});

test('only explicit concurrent clauses can use courses in the target term', () => {
  const info = {
    prerequisites: 'NS 102 - Undergraduate - Min Grade D(can be taken concurrently) '
      + 'and MATH 102 - Undergraduate - Min Grade D',
  };

  const targetWithConcurrent = semester('202402', [course('NS102', '')]);
  let context = req.buildTermRequirementContext([
    semester('202401', [course('MATH102', 'A')]),
    targetWithConcurrent,
  ], targetWithConcurrent, eligible);
  assert.equal(req.evaluateCandidateForTerm(info, 'ENS205', context).status, 'met');

  const targetWithOrdinary = semester('202402', [course('MATH102', '')]);
  context = req.buildTermRequirementContext([
    semester('202401', [course('NS102', 'A')]),
    targetWithOrdinary,
  ], targetWithOrdinary, eligible);
  const unmet = req.evaluateCandidateForTerm(info, 'ENS205', context);
  assert.equal(unmet.status, 'unmet');
  assert.deepEqual([...unmet.prerequisite.required], ['MATH102']);
  assert.deepEqual([...unmet.prerequisite.concurrent], []);
});

test('candidate checking preserves Min Grade S semantics', () => {
  const info = {
    prerequisites: 'CIP 101 - Undergraduate - Min Grade S '
      + 'or TDP 101 - Undergraduate - Min Grade S',
  };
  const target = semester('202402');
  const statusFor = (grade) => {
    const prior = semester('202401', [course('CIP101', grade)]);
    const context = req.buildTermRequirementContext([target, prior], target, eligible);
    return req.evaluateCandidateForTerm(info, 'CIP102', context).status;
  };

  assert.equal(statusFor('D'), 'unmet', 'a letter grade does not prove an S prerequisite');
  assert.equal(statusFor('S'), 'met');
  assert.equal(statusFor(''), 'met', 'a projected prerequisite remains valid planning');
});

test('prior-SU candidates count eligible credits from strictly earlier terms only', () => {
  const target = semester('202402', [course('SAME', 'A', 20)]);
  const earlier = semester('202401', [
    course('A', 'A', 30),
    course('B', '', 27.5),
    course('FAILED', 'F', 20),
    course('DUP', 'A', 0.25),
    course('DUP', 'A', 0.5),
  ]);
  const later = semester('202403', [course('LATER', 'A', 30)]);
  const info = { minimum_earned_su_credits: 58 };

  let context = req.buildTermRequirementContext([later, target, earlier], target, eligible);
  let result = req.evaluateCandidateForTerm(info, 'SPS303', context);
  assert.equal(context.priorEligibleSu, 58);
  assert.equal(result.status, 'met');

  earlier.courses[1].SU_credit = 27.49;
  context = req.buildTermRequirementContext([target, earlier, later], target, eligible);
  result = req.evaluateCandidateForTerm(info, 'SPS303', context);
  assert.ok(Math.abs(context.priorEligibleSu - 57.99) < 1e-9);
  assert.equal(result.status, 'unmet');
  assert.equal(result.priorSuRequirement.minimum, 58);
  assert.ok(Math.abs(result.priorSuRequirement.actual - 57.99) < 1e-9);
});

test('corequisites use same-or-earlier terms and suppress planner-only components', () => {
  const info = { corequisites: 'EE 202 and EE 202R' };
  const target = semester('202402');

  let context = req.buildTermRequirementContext([target], target, eligible);
  let result = req.evaluateCandidateForTerm(info, 'EE200', context);
  assert.equal(result.status, 'unmet');
  assert.deepEqual([...result.corequisites], ['EE202']);

  target.courses.push(course('EE202', ''));
  context = req.buildTermRequirementContext([target], target, eligible);
  result = req.evaluateCandidateForTerm(info, 'EE200', context);
  assert.equal(result.status, 'met');
  assert.deepEqual([...result.corequisites], []);
});

test('an unknown target term produces an explicit fail-open requirement state', () => {
  const target = semester('');
  const context = req.buildTermRequirementContext([
    semester('202401', [course('MATH101', 'A')]),
    target,
  ], target, eligible);
  const result = req.evaluateCandidateForTerm(
    { prerequisites: 'MATH 101 - Undergraduate - Min Grade D' },
    'MATH102',
    context,
  );

  assert.equal(context.known, false);
  assert.equal(result.known, false);
  assert.equal(result.status, 'unknown');
});
