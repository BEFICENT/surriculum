'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScriptGlobals, loadScriptsGlobals } = require('./helpers/load-script');

const { courseRequisites } = loadScriptsGlobals([
  'scripts/requisites/expression-policy.js',
  'scripts/course_requisites.js',
]);
const { courseRetakes } = loadScriptGlobals('scripts/course_retakes.js');
const {
  semesterTermCode,
  compareSemesterTerms,
  hasDuplicateSemesterTerm,
} = loadScriptGlobals('scripts/domain/academic-terms.js');

const course = (code, grade = '', credit = 3) => ({
  code,
  id: `${code}-${grade || 'planned'}`,
  grade,
  SU_credit: credit,
});
const semester = (termCode, courses) => ({ termCode, courses });
const eligible = (value) => !['F', 'U', 'NA', 'W'].includes(
  String((value && value.grade) || '').toUpperCase(),
);

test('prerequisite and prior-SU checks depend on term codes, not visual semester order', () => {
  const target = semester('202402', [course('HUM201')]);
  const earlier = semester('202401', [course('SPS101', 'A'), course('SPS102')]);
  const later = semester('202403', [course('MATH101', 'A', 30)]);
  const info = new Map([['HUM201', {
    prerequisites: 'SPS 101 - Undergraduate - Min Grade D',
    minimum_earned_su_credits: 6,
  }]]);

  const chronological = courseRequisites.plannerWarningsForSemesters(
    [earlier, target, later], info, eligible,
  );
  const visuallyShuffled = courseRequisites.plannerWarningsForSemesters(
    [later, target, earlier], info, eligible,
  );
  assert.deepEqual(visuallyShuffled, chronological);
  assert.equal(visuallyShuffled.length, 0,
    'only the two earlier courses satisfy both requirements; later credit is ignored');

  const sameTermCard = semester('202402', [course('SPS101', 'A', 30)]);
  const sameTermWarnings = courseRequisites.plannerWarningsForSemesters(
    [target, sameTermCard], info, eligible,
  );
  assert.equal(sameTermWarnings.length, 1);
  assert.deepEqual([...sameTermWarnings[0].prerequisite.required], ['SPS101']);
  assert.equal(sameTermWarnings[0].priorSuRequirement.actual, 0,
    'a duplicate visual card for the same term is not an earlier semester');
});

test('retake eligibility depends on source and target term codes, not visual order', () => {
  const source = semester('202401', [course('MATH101', 'F')]);
  const target = semester('202402', []);
  const unrelated = semester('202403', [course('NS101', 'A')]);

  for (const rows of [
    [source, target, unrelated],
    [unrelated, target, source],
    [target, source, unrelated],
  ]) {
    const result = courseRetakes.assessRetakeCandidate(
      rows, 'MATH101', target, { currentTermCode: '202503' },
    );
    assert.equal(result.eligible, true);
    assert.equal(result.reason, 'unsuccessful-or-withdrawn');
    assert.equal(result.occurrence.termCode, '202401');
  }

  const sameTermSource = semester('202402', [course('MATH101', 'F')]);
  const sameTermTarget = semester('202402', []);
  const sameTerm = courseRetakes.assessRetakeCandidate(
    [sameTermTarget, sameTermSource],
    'MATH101',
    sameTermTarget,
    { currentTermCode: '202503' },
  );
  assert.equal(sameTerm.eligible, false);
  assert.equal(sameTerm.reason, 'no-prior-occurrence');
});

test('canonical term helpers recognize equivalent labels and reject conflicting identities', () => {
  assert.equal(semesterTermCode('Fall 2024-2025'), '202401');
  assert.equal(semesterTermCode({ termCode: '202402', termName: 'Spring 2024-2025' }), '202402');
  assert.equal(
    semesterTermCode({ termCode: '202401', termName: 'Spring 2024-2025' }),
    '',
    'conflicting persisted identities must fail closed',
  );
  assert.ok(compareSemesterTerms(
    { termName: 'Fall 2024-2025' },
    { termCode: '202402' },
  ) < 0);
});

test('duplicate-term detection uses canonical identity and can exclude the edited semester', () => {
  const rows = [
    { id: 's1', termCode: '202401', termName: 'Fall 2024-2025', courses: [] },
    { id: 's2', termCode: '202402', termName: 'Spring 2024-2025', courses: [] },
  ];

  assert.equal(hasDuplicateSemesterTerm(rows, 'Fall 2024-2025'), true);
  assert.equal(hasDuplicateSemesterTerm(rows, { termCode: '202401' }, { excludeSemesterId: 's1' }), false);
  assert.equal(hasDuplicateSemesterTerm({ semesters: rows }, 'Summer 2024-2025'), false);
  assert.equal(hasDuplicateSemesterTerm(rows, 'legacy term without a canonical code'), false);
});

test('duplicate-term tie order depends on grade and basis, never generated semester ids', () => {
  const letter = {
    id: 'random-id-z',
    termCode: '202401',
    termName: 'Fall 2024-2025',
    courses: [{ code: 'MATH101', grade: 'A', gradingBasis: 'letter' }],
  };
  const satisfactory = {
    id: 'random-id-a',
    termCode: '202401',
    termName: 'Fall 2024-2025',
    courses: [{ code: 'MATH101', grade: 'S', gradingBasis: 'satisfactory' }],
  };
  const semantic = (row) => `${row.courses[0].grade}/${row.courses[0].gradingBasis}`;
  const expected = [letter, satisfactory].sort(compareSemesterTerms).map(semantic);

  for (const input of [
    [letter, satisfactory],
    [satisfactory, letter],
    [
      { ...letter, id: 'reload-generated-1' },
      { ...satisfactory, id: 'reload-generated-999' },
    ],
    [
      { ...satisfactory, id: 'reload-generated-1' },
      { ...letter, id: 'reload-generated-999' },
    ],
  ]) {
    assert.deepEqual(input.sort(compareSemesterTerms).map(semantic), expected);
  }
  assert.notEqual(compareSemesterTerms(letter, satisfactory), 0,
    'same-code duplicate rows with different outcomes have a stable semantic tie-break');
});
