'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScriptsGlobals } = require('./helpers/load-script');

function record(Major, Code, Course_Name, EL_Type) {
  return { Major, Code, Course_Name, EL_Type, SU_credit: '3', Basic_Science: '0' };
}

test('picker provenance is candidate-local and never mutates catalogs', () => {
  const globals = loadScriptsGlobals('scripts/data/course-metadata.js');
  const primary = [record('CS', '101', 'Introduction', 'core')];
  const doubleMajor = [
    record('CS', '101', 'Introduction', 'required'),
    record('EE', '202', 'Circuits', 'area'),
  ];
  const minor = [record('MATH', '201', 'Linear Algebra', 'required')];
  globals.curriculum = {
    doubleMajor: 'EE',
    doubleMajorCourseData: doubleMajor,
    minors: ['MAT-MIN'],
    minorCourseDataByCode: { 'MAT-MIN': minor },
    hasCourse() { return false; },
  };
  const before = JSON.stringify({ primary, doubleMajor, minor });

  const first = globals.getCoursesList(primary);
  const second = globals.getCoursesList(primary);
  const byCode = new Map(first.map((candidate) => [candidate.code, candidate]));

  assert.equal(byCode.get('CS101').type, 'core');
  assert.equal(byCode.get('CS101').dmType, 'required');
  assert.equal(byCode.get('EE202').type, '');
  assert.equal(byCode.get('EE202').dmType, 'area');
  assert.equal(byCode.get('MATH201').type, '');
  assert.deepEqual(second, first);
  assert.equal(JSON.stringify({ primary, doubleMajor, minor }), before);
  for (const source of [...primary, ...doubleMajor, ...minor]) {
    assert.equal(Object.hasOwn(source, '__fromDoubleMajor'), false);
    assert.equal(Object.hasOwn(source, '__fromMinor'), false);
  }
});
