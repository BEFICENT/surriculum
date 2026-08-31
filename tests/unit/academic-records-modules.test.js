'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScriptsGlobals } = require('./helpers/load-script');

const globals = loadScriptsGlobals([
  'scripts/academic-records/parser.js',
  'scripts/academic-records/catalog-resolution.js',
  'scripts/academic-records/importer.js',
  'scripts/academic_records_parser.js',
]);

test('academic-record modules expose frozen focused APIs and the exact legacy bridge', () => {
  const modules = globals.SurriculumModules;
  assert.ok(modules.academicRecordsParsing);
  assert.ok(modules.academicRecordsCatalogResolution);
  assert.ok(modules.academicRecordsImporter);
  assert.equal(Object.isFrozen(modules.academicRecordsParsing), true);
  assert.equal(Object.isFrozen(modules.academicRecordsCatalogResolution), true);
  assert.equal(Object.isFrozen(modules.academicRecordsImporter), true);
  assert.equal(typeof modules.academicRecordsParsing.create, 'function');
  assert.deepEqual(Object.keys(modules.academicRecordsCatalogResolution), ['create']);
  assert.deepEqual(Object.keys(modules.academicRecordsImporter), [
    'create',
    'importParsedCourses',
  ]);
  assert.equal(typeof modules.academicRecordsImporter.create, 'function');

  assert.deepEqual(Object.keys(globals.academicRecordsParser), [
    'parseAcademicRecords',
    'parseAcademicRecordsPdf',
    'importParsedCourses',
  ]);
  assert.equal(
    globals.academicRecordsParser.parseAcademicRecords,
    modules.academicRecordsParsing.parseAcademicRecords,
  );
  assert.equal(
    globals.academicRecordsParser.parseAcademicRecordsPdf,
    modules.academicRecordsParsing.parseAcademicRecordsPdf,
  );
  assert.equal(
    globals.academicRecordsParser.importParsedCourses,
    modules.academicRecordsImporter.importParsedCourses,
  );
});

test('academic-record catalog resolution fails closed when loaded out of order', () => {
  assert.throws(
    () => loadScriptsGlobals(['scripts/academic-records/catalog-resolution.js']),
    /parser\.js must load before catalog-resolution\.js/,
  );
  assert.throws(
    () => loadScriptsGlobals([
      'scripts/academic-records/parser.js',
      'scripts/academic-records/importer.js',
    ]),
    /catalog-resolution\.js must load before importer\.js/,
  );
});

test('catalog-resolution factory exposes frozen planner lookup and GPA helpers', () => {
  const remembered = [];
  const catalog = globals.SurriculumModules.academicRecordsCatalogResolution.create({
    document: undefined,
    getSemesterTermCode: () => undefined,
    getResolveGlobalCourseDefinition: () => (code, fallback) => ({
      Major: code.match(/^[A-Z]+/)[0],
      Code: code.match(/\d+[A-Z0-9]*/)[0],
      Course_Name: fallback.title,
      SU_credit: String(fallback.suCredits),
      ECTS: String(fallback.ects),
      Engineering: 0,
      Basic_Science: 0,
      Faculty: '',
      Faculty_Course: 'No',
      __globalCourseDefinition: true,
    }),
    getRememberGlobalCourseDefinition: () => (record) => remembered.push(record),
    evaluateGradeForLegacyTotals: (grade) => ({
      countsInGpa: grade === 'B',
      gpaPoints: grade === 'B' ? 3 : 0,
    }),
    parseCreditValue: (value) => Number(value) || 0,
  });

  assert.equal(Object.isFrozen(catalog), true);
  assert.equal(catalog.transcriptTermCode('Fall 2025-2026'), '202501');
  assert.equal(catalog.transcriptTermCode('Spring 2025-2026'), '202502');
  assert.equal(catalog.transcriptTermCode('Summer 2025-2026'), '202503');

  const courseData = [];
  const resolution = catalog.resolveTranscriptCourseRecord({
    code: 'ENS491',
    title: 'Special Project',
    suCredits: 3,
    ects: 6,
  }, courseData, { semesters: [] });
  assert.equal(resolution.isGlobal, true);
  assert.equal(resolution.source, 'global-course-index');
  assert.equal(courseData.length, 1);
  assert.equal(remembered.length, 1);

  const semester = {
    courses: [{ code: 'ENS491', grade: 'B', gradingBasis: 'letter' }],
  };
  catalog.recomputeSemesterTranscriptGpa(semester, { semesters: [semester] }, courseData);
  assert.equal(semester.totalGPA, 9);
  assert.equal(semester.totalGPACredits, 3);
});

test('parser factory normalizes transcript records through only its injected grade policy', () => {
  const calls = [];
  const parsing = globals.SurriculumModules.academicRecordsParsing.create({
    getGradePolicy: () => ({
      normalizeGrade(value) { calls.push(['grade', value]); return 'S'; },
      inferGradingBasis(grade, basis) {
        calls.push(['basis', grade, basis]);
        return 'satisfactory';
      },
    }),
  });

  assert.equal(Object.isFrozen(parsing), true);
  const normalized = parsing.normalizeTranscriptGradeRecord('custom', 'reviewed');
  assert.equal(normalized.grade, 'S');
  assert.equal(normalized.gradingBasis, 'satisfactory');
  assert.deepEqual(calls, [
    ['grade', 'custom'],
    ['basis', 'S', 'reviewed'],
  ]);
});

test('importer factory is frozen and accepts an explicit dependency surface', () => {
  const importer = globals.SurriculumModules.academicRecordsImporter.create({
    document: undefined,
    localStorage: undefined,
    getCreateSemester: () => () => {},
    getSemesterTermCode: () => undefined,
    getResolveGlobalCourseDefinition: () => undefined,
    getRememberGlobalCourseDefinition: () => undefined,
    getPlanStorage: () => undefined,
    refreshSemesterAccessibility() {},
    formatCreditValue: String,
    evaluateGradeForLegacyTotals: () => null,
    parseCreditValue: (value) => Number(value) || 0,
  });
  assert.equal(Object.isFrozen(importer), true);
  assert.equal(typeof importer.importParsedCourses, 'function');
});
