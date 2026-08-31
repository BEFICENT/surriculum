'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScriptsGlobals } = require('./helpers/load-script');
const { CURRICULUM_SCRIPT_PATHS } = require('./helpers/load-curriculum');

const MODULE_PATH = 'scripts/domain/suggestion-candidate-impact.js';
const g = loadScriptsGlobals(MODULE_PATH);

function createCalculator(overrides) {
  const canonical = (value) => {
    const normalized = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return normalized === 'CS210' ? 'DSA210' : normalized;
  };
  return g.SurriculumModules.suggestionCandidateImpact.create({
    normalizeCourseCode: canonical,
    canonicalCourseCode: canonical,
    normalizedLanguageLevel: (value) => String(value || '').trim().toLowerCase(),
    parseCreditValue: (value) => Number(String(value || '0').replace(',', '.')) || 0,
    resolveAlternativeRules: () => ({
      excluded: new Set(),
      typeOverride: new Map(),
      forceCore: new Set(),
    }),
    allocateCascade: (baseType) => baseType,
    applyManDiversity: () => {},
    groupProgressFor: () => [],
    hum200Level: ['HUM201', 'HUM202'],
    hum300Level: ['HUM311'],
    humAnyLevel: ['HUM201', 'HUM202', 'HUM311'],
    ...(overrides || {}),
  });
}

function buildContext(catalog, overrides) {
  const snapshot = {
    available: true,
    totals: { required: 0, core: 0, area: 0 },
    fields: {
      category: 'category',
      languageLevel: 'languageLevel',
      effective: 'effectiveType',
    },
    req: {
      required: 12,
      core: 12,
      area: 12,
      humRequired: 1,
      humRule: 'any',
      internshipCourse: 'PROJ300',
    },
    groupRows: [],
  };
  return {
    curriculum: { semesters: [] },
    major: 'CS',
    entryTerm: '202301',
    catalog,
    snapshot,
    eligibleBeforeTarget: () => true,
    chronologicalSemesters: [],
    lookupCatalogRecord: (code, rows) => (rows || catalog).find((record) => (
      `${record.Major || ''}${record.Code || ''}` === code
    )) || null,
    ...(overrides || {}),
  };
}

test('candidate impact exposes only a frozen dependency-injected factory', () => {
  const api = g.SurriculumModules.suggestionCandidateImpact;
  assert.ok(api);
  assert.equal(Object.isFrozen(api), true);
  assert.deepEqual(Object.keys(api), ['create']);

  const calculator = createCalculator();
  assert.equal(Object.isFrozen(calculator), true);
  assert.deepEqual(Object.keys(calculator), ['build']);
  assert.throws(() => api.create({}), /requires normalizeCourseCode/);
});

test('candidate impact preserves named requirements, aliases, and immutable descriptors', () => {
  const catalog = [
    { Major: 'SPS', Code: '303', EL_Type: 'university', SU_credit: '3' },
    { Major: 'HUM', Code: '201', EL_Type: 'university', SU_credit: '3' },
    { Major: 'PROJ', Code: '300', EL_Type: 'required', SU_credit: '0' },
    { Major: 'CS', Code: '210', EL_Type: 'required', SU_credit: '3' },
    { Major: 'DSA', Code: '210', EL_Type: 'core', SU_credit: '3' },
    { Major: 'IGN', Code: '999', EL_Type: 'core', __globalCourseDefinition: true },
  ];
  const impacts = createCalculator().build(buildContext(catalog));

  assert.equal(impacts.size, 4);
  assert.deepEqual(Array.from(impacts.get('SPS303').reasons), [
    'University requirement: SPS303',
  ]);
  assert.equal(impacts.get('SPS303').fillsNamedRequirement, true);
  assert.equal(impacts.get('SPS303').suppressUniversityWeight, false);
  assert.deepEqual(Array.from(impacts.get('HUM201').reasons), [
    'University requirement: one HUM',
  ]);
  assert.equal(impacts.get('HUM201').fillsNamedRequirement, true);
  assert.equal(impacts.get('HUM201').suppressUniversityWeight, false);
  assert.deepEqual(Array.from(impacts.get('PROJ300').reasons), ['Required internship']);
  assert.equal(impacts.get('DSA210').effectiveType, 'core',
    'the canonical DSA row must replace the older CS alias');
  assert.equal(Object.isFrozen(impacts.get('DSA210')), true);
  assert.equal(Object.isFrozen(impacts.get('SPS303').reasons), true);
});

test('any-HUM rules count distinct planned HUM courses up to humRequired', () => {
  const catalog = [
    { Major: 'HUM', Code: '201', EL_Type: 'university', SU_credit: '3' },
    { Major: 'HUM', Code: '202', EL_Type: 'university', SU_credit: '3' },
    { Major: 'HUM', Code: '311', EL_Type: 'university', SU_credit: '3' },
  ];
  const priorHum = {
    courses: [
      { code: 'HUM201', SU_credit: 3, grade: 'A' },
      { code: 'HUM201', SU_credit: 3, grade: 'A' },
    ],
  };

  const oneHumContext = buildContext(catalog, {
    chronologicalSemesters: [priorHum],
  });
  const oneHumImpacts = createCalculator().build(oneHumContext);
  assert.equal(oneHumImpacts.get('HUM311').fillsNamedRequirement, false);
  assert.equal(oneHumImpacts.get('HUM311').suppressUniversityWeight, true);

  const twoHumContext = buildContext(catalog, {
    chronologicalSemesters: [priorHum],
  });
  twoHumContext.snapshot.req.humRequired = 2;
  const twoHumImpacts = createCalculator().build(twoHumContext);
  assert.equal(twoHumImpacts.get('HUM201').suppressUniversityWeight, true,
    'repeating the same HUM does not advance a distinct-course rule');
  assert.equal(twoHumImpacts.get('HUM202').fillsNamedRequirement, true);
  assert.equal(twoHumImpacts.get('HUM202').suppressUniversityWeight, false,
    'a different 200-level HUM can fill an any-HUM rule');
  assert.equal(twoHumImpacts.get('HUM311').fillsNamedRequirement, true);
  assert.equal(twoHumImpacts.get('HUM311').suppressUniversityWeight, false);

  const completedContext = buildContext(catalog, {
    chronologicalSemesters: [{
      courses: [
        { code: 'HUM201', SU_credit: 3, grade: 'A' },
        { code: 'HUM311', SU_credit: 3, grade: 'A' },
      ],
    }],
  });
  completedContext.snapshot.req.humRequired = 2;
  const completedImpacts = createCalculator().build(completedContext);
  assert.equal(completedImpacts.get('HUM202').fillsNamedRequirement, false);
  assert.equal(completedImpacts.get('HUM202').suppressUniversityWeight, true);
});

test('tiered HUM rules preserve independent 200- and 300-level needs', () => {
  const catalog = [
    { Major: 'HUM', Code: '201', EL_Type: 'university', SU_credit: '3' },
    { Major: 'HUM', Code: '202', EL_Type: 'university', SU_credit: '3' },
    { Major: 'HUM', Code: '311', EL_Type: 'university', SU_credit: '3' },
  ];
  const context = buildContext(catalog, {
    chronologicalSemesters: [{
      courses: [{ code: 'HUM201', SU_credit: 3, grade: 'A' }],
    }],
  });
  context.snapshot.req.humRequired = 2;
  context.snapshot.req.humRule = 'one200One300';

  const impacts = createCalculator().build(context);
  assert.equal(impacts.get('HUM202').fillsNamedRequirement, false);
  assert.equal(impacts.get('HUM202').suppressUniversityWeight, true,
    'another 200-level HUM does not fill the missing 300-level tier');
  assert.equal(impacts.get('HUM311').fillsNamedRequirement, true);
  assert.equal(impacts.get('HUM311').suppressUniversityWeight, false);
});

test('candidate impact measures an unmet requirement group without mutating the snapshot', () => {
  const catalog = [{ Major: 'CS', Code: '401', EL_Type: 'core', SU_credit: '3' }];
  const context = buildContext(catalog);
  context.snapshot.req.groups = [{ id: 'advanced' }];
  context.snapshot.groupRows = [{ id: 'advanced', current: 0, ok: false }];
  const originalRows = JSON.stringify(context.snapshot.groupRows);
  const calculator = createCalculator({
    groupProgressFor: ({ semesters }) => [{
      id: 'advanced',
      label: 'Advanced CS elective',
      current: semesters[semesters.length - 1].courses[0].SU_credit,
      ok: true,
    }],
  });

  const impact = calculator.build(context).get('CS401');
  assert.equal(impact.fillsUnmetGroup, true);
  assert.equal(impact.retainBaseType, true);
  assert.deepEqual(Array.from(impact.reasons), ['Advanced CS elective']);
  assert.equal(JSON.stringify(context.snapshot.groupRows), originalRows);
});

test('candidate impact has an explicit constructor load boundary and reviewed order', () => {
  const missing = loadScriptsGlobals([
    'scripts/domain/curriculum-allocation.js',
    'scripts/domain/curriculum-progress.js',
    'scripts/domain/requirement-engine.js',
    'scripts/ui/curriculum-view.js',
    'scripts/s_curriculum.js',
  ]);
  assert.throws(
    () => new missing.s_curriculum(),
    /suggestion-candidate-impact\.js must load before s_curriculum\.js/,
  );

  const order = [
    'scripts/domain/curriculum-allocation.js',
    'scripts/domain/curriculum-recalculation.js',
    'scripts/domain/curriculum-progress.js',
    'scripts/domain/requirement-engine.js',
    MODULE_PATH,
    'scripts/ui/curriculum-view.js',
    'scripts/s_curriculum.js',
  ];
  const positions = order.map((entry) => CURRICULUM_SCRIPT_PATHS.indexOf(entry));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual(positions, [...positions].sort((left, right) => left - right));
});
