'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScriptGlobals } = require('./helpers/load-script');

const { courseRetakes: retakes } = loadScriptGlobals('scripts/course_retakes.js');

const semester = (termCode, courses) => ({ termCode, courses });
const course = (code, grade) => ({ code, grade, id: `${code}-${grade || 'pending'}` });

test('normalizes codes and finds exact-code occurrences without matching components', () => {
  const rows = [
    semester('202401', [course('CS 201', 'D'), course('CS201L', 'F')]),
    semester('202402', [course('cs-201', 'C')]),
  ];
  const found = retakes.findExactCourseOccurrences(rows, ' cs 201 ');
  assert.equal(retakes.normalizeCourseCode(' cs 201 '), 'CS201');
  assert.equal(found.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(found.map((item) => item.termCode))),
    ['202401', '202402']);
  assert.ok(found.every((item) => item.code === 'CS201'));
  assert.equal(retakes.semesterTermCode({ termName: 'Spring 2024-2025' }), '202402');
  assert.equal(retakes.findCourseOccurrences({ semesters: rows }, 'CS201').length, 2);
});

test('F, U, NA and W may be repeated in any known strictly later term', () => {
  for (const grade of ['F', 'U', 'NA', 'W']) {
    const result = retakes.classifyRetakeOccurrence(
      { course: course('SPS303', grade), semester: { termCode: '201901' } },
      '203003',
    );
    assert.equal(result.eligible, true, grade);
    assert.equal(result.reason, 'unsuccessful-or-withdrawn', grade);
  }
});

test('passing grades use a three-regular-semester window and Summer consumes no step', () => {
  for (const grade of ['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'S']) {
    const boundary = retakes.classifyRetakeOccurrence(
      { course: course('MATH101', grade), semester: { termCode: '202401' } },
      '202503',
    );
    assert.equal(boundary.eligible, true, grade);
    assert.equal(boundary.regularSemesterSteps, 3, grade);

    const expired = retakes.classifyRetakeOccurrence(
      { course: course('MATH101', grade), semester: { termCode: '202401' } },
      '202601',
    );
    assert.equal(expired.eligible, false, grade);
    assert.equal(expired.reason, 'passing-retake-window-expired', grade);
    assert.equal(expired.regularSemesterSteps, 4, grade);
  }

  assert.equal(retakes.regularSemesterSteps('202401', '202402'), 1);
  assert.equal(retakes.regularSemesterSteps('202401', '202403'), 1);
  assert.equal(retakes.regularSemesterSteps('202402', '202403'), 0);
  assert.equal(retakes.regularSemesterSteps('202403', '202501'), 1);
});

test('unfinished, transfer and unsupported grades fail closed', () => {
  for (const grade of ['', 'Registered', 'P', 'I']) {
    const result = retakes.classifyRetakeOccurrence(
      { course: course('MATH101', grade), semester: { termCode: '202401' } },
      '202402',
    );
    assert.equal(result.eligible, false, grade || 'blank');
    assert.equal(result.reason, 'unfinished-grade', grade || 'blank');
  }
  assert.equal(retakes.classifyRetakeOccurrence(
    { course: course('MATH101', 'T'), semester: { termCode: '202401' } },
    '202402',
  ).reason, 'transfer-requires-substitution-review');
  assert.equal(retakes.classifyRetakeOccurrence(
    { course: course('MATH101', 'A+'), semester: { termCode: '202401' } },
    '202402',
  ).reason, 'unsupported-grade');
});

test('same/earlier and unknown terms fail closed', () => {
  const occurrence = { course: course('MATH101', 'F'), semester: { termCode: '202402' } };
  assert.equal(retakes.classifyRetakeOccurrence(occurrence, '202402').reason, 'target-not-later');
  assert.equal(retakes.classifyRetakeOccurrence(occurrence, '202401').reason, 'target-not-later');
  assert.equal(retakes.classifyRetakeOccurrence(occurrence, '').reason, 'unknown-target-term');
  assert.equal(retakes.classifyRetakeOccurrence(
    { course: course('MATH101', 'F'), semester: { termCode: '' } },
    '202402',
  ).reason, 'unknown-source-term');
  assert.equal(retakes.normalizeTermCode('Fall 2024-2025'), '202401');
  assert.equal(retakes.normalizeTermCode('Fall 2024-2026'), '');
});

test('a terminal-looking grade in a future source term is not a completed retake source', () => {
  const existingSemester = { termCode: '202502' };
  const existingCourse = course('MATH101', 'F');
  const futureSource = retakes.classifyRetake(
    existingSemester,
    existingCourse,
    { termCode: '202601' },
    { currentTermCode: '202501' },
  );
  assert.equal(futureSource.eligible, false);
  assert.equal(futureSource.reason, 'source-term-not-completed');
  assert.equal(futureSource.currentTermCode, '202501');

  const currentSource = retakes.classifyRetake(
    existingSemester,
    existingCourse,
    { termCode: '202601' },
    { currentTerm: { termCode: '202502' } },
  );
  assert.equal(currentSource.eligible, true, 'a terminal current-term result may be repeated later');

  const noTrustworthyCurrentTerm = retakes.classifyRetake(
    existingSemester,
    existingCourse,
    { termCode: '202601' },
    { currentTermCode: 'unknown' },
  );
  assert.equal(noTrustworthyCurrentTerm.eligible, true,
    'an invalid optional current term does not invent a completion boundary');
});

test('candidate assessment reports ambiguous multiple prior occurrences', () => {
  const rows = [
    semester('202401', [course('MATH101', 'F')]),
    semester('202402', [course('MATH 101', 'D')]),
  ];
  const result = retakes.assessRetakeCandidate(rows, 'MATH101', '202501');
  assert.equal(result.eligible, false);
  assert.equal(result.ambiguous, true);
  assert.equal(result.reason, 'multiple-prior-occurrences');
  assert.equal(result.priorOccurrences.length, 2);
});

test('candidate assessment returns the sole eligible exact-code prior occurrence', () => {
  const rows = [semester('202401', [course('MATH101', 'D')])];
  const result = retakes.assessRetakeCandidate(rows, 'math 101', '202403');
  assert.equal(result.eligible, true);
  assert.equal(result.ambiguous, false);
  assert.equal(result.reason, 'passing-within-retake-window');
  assert.equal(result.occurrence.course.code, 'MATH101');
  assert.equal(result.classification.regularSemesterSteps, 1);
});

test('stable planner classification API reports normalized terms and elapsed regular semesters', () => {
  const result = retakes.classifyRetake(
    { termName: 'Fall 2024-2025' },
    course('MATH101', 'D'),
    { termName: 'Summer 2025-2026' },
  );
  assert.equal(result.eligible, true);
  assert.equal(result.reason, 'passing-within-retake-window');
  assert.equal(result.grade, 'D');
  assert.equal(result.sourceTermCode, '202401');
  assert.equal(result.targetTermCode, '202503');
  assert.equal(result.regularSemestersElapsed, 3);
});
