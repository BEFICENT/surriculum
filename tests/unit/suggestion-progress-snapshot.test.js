'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScriptsGlobals } = require('./helpers/load-script');
const { CURRICULUM_SCRIPT_PATHS } = require('./helpers/load-curriculum');

const MODULE_PATH = 'scripts/domain/suggestion-progress-snapshot.js';
const globals = loadScriptsGlobals(MODULE_PATH);

function createSnapshotService(overrides) {
  const dependencies = {
    normalizeProgressTermCode(value) {
      return /^\d{6}$/.test(String(value || '')) ? String(value) : '';
    },
    isDegreeEligibleCourse(course) { return !!course && course.eligible !== false; },
    semesterProgressTermCode(semester) { return String(semester && semester.termCode || ''); },
    canonicalCourseCode(value) { return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); },
    groupProgressFor(context, groups) {
      return [{ id: groups[0].id, semesterCount: context.semesters.length }];
    },
    facultyProgress(context) {
      return [{ id: 'faculty', semesterCount: context.semesters.length }];
    },
    programUnionGenericRecords(mainRecords, programRecords) {
      return new Map([...mainRecords, ...programRecords]);
    },
    totalsForGenericRecords(records) { return { total: records.size * 3, ects: records.size * 6 }; },
    getChronologicalSemesters(curriculum) { return curriculum.semesters.slice(); },
    lookupCatalogRecord(major, catalog, code) { return { major, catalog, code }; },
    candidateImpactCalculator: { build() { return new Map(); } },
    earnedState: 'earned',
    ...overrides,
  };
  return globals.SurriculumModules.suggestionProgressSnapshot.create(dependencies);
}

test('suggestion progress snapshot exposes only a frozen factory API', () => {
  const api = globals.SurriculumModules.suggestionProgressSnapshot;
  assert.equal(Object.isFrozen(api), true);
  assert.deepEqual(Object.keys(api), ['create']);
  const service = createSnapshotService();
  assert.equal(Object.isFrozen(service), true);
  assert.deepEqual(Object.keys(service), ['buildViews', 'selectView', 'combine']);
});

test('snapshot factory rejects an incomplete dependency boundary', () => {
  assert.throws(
    () => globals.SurriculumModules.suggestionProgressSnapshot.create({}),
    /requires normalizeProgressTermCode/,
  );
  assert.throws(
    () => createSnapshotService({ candidateImpactCalculator: null }),
    /requires candidateImpactCalculator\.build/,
  );
});

test('snapshot orchestration preserves term scope, DM union totals, and candidate impacts', () => {
  const impactCalls = [];
  const service = createSnapshotService({
    candidateImpactCalculator: {
      build(context) {
        impactCalls.push(context);
        return new Map([[`${context.major}201`, Object.freeze({ effectiveType: 'core' })]]);
      },
    },
  });
  const before = { code: 'CS101', eligible: true };
  const atTarget = { code: 'CS102', eligible: true };
  const excluded = { code: 'CS103', eligible: false };
  const curriculum = {
    major: 'CS',
    entryTerm: '202301',
    primaryCourseData: [{ Major: 'CS', Code: '201' }],
    doubleMajor: 'EE',
    entryTermDM: '202301',
    doubleMajorCourseData: [{ Major: 'EE', Code: '201' }],
    semesters: [
      { termCode: '202401', courses: [before, excluded] },
      { termCode: '202402', courses: [atTarget] },
    ],
  };
  const allocationCalls = [];
  const records = {
    main: new Map([[before, { effective: 'core' }]]),
    dm: new Map([[atTarget, { effective: 'area' }]]),
  };
  const runProgressAllocation = (view, layer, isEligible, stateOf) => {
    allocationCalls.push({ view, layer, isEligible, state: stateOf() });
    return {
      available: true,
      major: view === 'dm' ? 'EE' : 'CS',
      entryTerm: '202301',
      req: { groups: [{ id: `${view}-group` }], facultyReq: {} },
      fields: { effective: `${view}Effective` },
      totals: { total: view === 'dm' ? 2 : 1 },
      records: records[view],
      isEligible,
    };
  };

  const views = service.buildViews({ curriculum, runProgressAllocation }, '202402', {
    includeCandidateImpacts: true,
  });

  assert.equal(views.available, true);
  assert.equal(views.targetTermCode, '202402');
  assert.deepEqual(allocationCalls.map(({ view, layer, state }) => [view, layer, state]), [
    ['main', 'before_target', 'earned'],
    ['dm', 'before_target', 'earned'],
  ]);
  assert.deepEqual(Array.from(views.main.courseCodes), ['CS101']);
  assert.deepEqual(Array.from(views.dm.courseCodes), ['CS101']);
  assert.equal(views.main.groupRows[0].id, 'main-group');
  assert.equal(views.dm.groupRows[0].id, 'dm-group');
  assert.equal(views.dm.totals.total, 6);
  assert.equal(views.dm.totals.ects, 12);
  assert.equal(views.dm.genericRecords.size, 2);
  assert.equal(views.dm.mainProgramRecords, records.main);
  assert.equal(impactCalls.length, 2);
  assert.equal(impactCalls[0].major, 'CS');
  assert.equal(impactCalls[1].major, 'EE');
  assert.equal(impactCalls[0].eligibleBeforeTarget(before, curriculum.semesters[0]), true);
  assert.equal(impactCalls[0].eligibleBeforeTarget(atTarget, curriculum.semesters[1]), false);
  assert.equal(service.selectView(views, 'dm'), views.dm);
});

test('invalid targets and missing selected views preserve the established unavailable shape', () => {
  const service = createSnapshotService();
  let allocations = 0;
  const views = service.buildViews({
    curriculum: { semesters: [] },
    runProgressAllocation() { allocations += 1; },
  }, 'not-a-term');
  assert.equal(allocations, 0);
  assert.equal(views.available, false);
  assert.equal(views.targetTermCode, '');
  assert.equal(views.main.view, 'main');
  assert.equal(views.main.targetTermCode, '');
  assert.deepEqual(Array.from(views.main.courseCodes), []);

  const selected = service.selectView(null, 'dm');
  assert.equal(selected.available, false);
  assert.equal(selected.view, 'dm');
  assert.equal(selected.targetTermCode, '');
  assert.deepEqual(Array.from(selected.courseCodes), []);
});

test('s_curriculum fails closed without the snapshot module and reviewed order includes it', () => {
  const missing = loadScriptsGlobals([
    'scripts/domain/curriculum-allocation.js',
    'scripts/domain/curriculum-progress.js',
    'scripts/domain/requirement-engine.js',
    'scripts/domain/suggestion-candidate-impact.js',
    'scripts/ui/curriculum-view.js',
    'scripts/s_curriculum.js',
  ]);
  assert.throws(
    () => new missing.s_curriculum(),
    /suggestion-progress-snapshot\.js must load before s_curriculum\.js/,
  );

  const requiredOrder = [
    'scripts/domain/curriculum-recalculation.js',
    'scripts/domain/suggestion-candidate-impact.js',
    MODULE_PATH,
    'scripts/ui/curriculum-view.js',
    'scripts/s_curriculum.js',
  ];
  const positions = requiredOrder.map((entry) => CURRICULUM_SCRIPT_PATHS.indexOf(entry));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual(positions, [...positions].sort((left, right) => left - right));
});
