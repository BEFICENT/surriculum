'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScriptsGlobals } = require('./helpers/load-script');

const globals = loadScriptsGlobals([
  'scripts/plan/ui.js',
  'scripts/plan/import-validation.js',
  'scripts/plan/import-export.js',
]);

const normalizePlanName = (name) => {
  const normalized = String(name || '').trim().replace(/\s+/g, ' ');
  return normalized ? normalized.slice(0, 60) : null;
};
const canonicalTermCodeFromLabel = (value) => {
  const match = String(value || '').match(/^(Fall|Spring|Summer) (\d{4})-\d{4}$/);
  if (!match) return '';
  return match[2] + { Fall: '01', Spring: '02', Summer: '03' }[match[1]];
};

function createValidation() {
  return globals.SurriculumModules.planImportValidation.create({
    planExportVersion: 4,
    maxPlans: 10,
    normalizePlanName,
    canonicalTermCodeFromLabel,
  });
}

function validExport() {
  return {
    type: 'surriculum_plan',
    version: 4,
    plan: {
      name: '  Imported   plan  ',
      state: {
        major: 'cs',
        curriculum: [['CS101']],
        grades: [['A']],
        dates: ['Fall 2024-2025'],
        termCodes: ['202401'],
      },
    },
  };
}

test('plan modules install frozen namespaces and preserve the uiModal bridge', () => {
  const modules = globals.SurriculumModules;
  for (const name of ['planUi', 'planImportValidation', 'planImportExport']) {
    assert.ok(modules[name]);
    assert.equal(Object.isFrozen(modules[name]), true);
  }
  assert.equal(globals.uiModal, modules.planUi.uiModal);
  assert.equal(typeof globals.uiModal.alert, 'function');
  assert.equal(globals.planStorage, undefined,
    'storage lifecycle remains owned by plan_manager.js');
});

test('validation normalizes a v4 plan and rejects conflicting term identity', () => {
  const validation = createValidation();
  const normalized = validation.validateImportObject(validExport());
  assert.equal(normalized.name, 'Imported plan');
  assert.equal(normalized.state.major, 'CS');
  assert.equal(normalized.state.termCodes[0], '202401');

  const conflict = validExport();
  conflict.plan.state.termCodes[0] = '202402';
  assert.throws(
    () => validation.validateImportObject(conflict),
    /termCodes\[0\].*conflicts with the semester label/,
  );
});

test('a failed state write rolls back the unpublished imported namespace', () => {
  const validation = createValidation();
  const values = new Map();
  const storage = {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem(key, value) {
      if (String(key).endsWith('.grades')) throw new Error('quota probe');
      values.set(String(key), String(value));
    },
    removeItem: (key) => values.delete(String(key)),
  };
  const index = {
    activeId: 'existing',
    plans: [{ id: 'existing', name: 'Existing' }],
  };
  const planKey = (id, key) => `surriculum.plan.${id}.${key}`;
  const transfer = globals.SurriculumModules.planImportExport.create({
    planExportVersion: 4,
    maxPlans: 10,
    defaultPlanName: 'Default Plan',
    nowIso: () => '2026-08-31T00:00:00.000Z',
    safeJsonParse: (value, fallback) => {
      try { return JSON.parse(value); } catch (_) { return fallback; }
    },
    canonicalTermCodeFromLabel,
    planKey,
    listLocalStorageKeys: () => [...values.keys()],
    touchUpdated: () => {},
    ensureIndex: () => index,
    getPlanMeta: (id) => index.plans.find((plan) => plan.id === id),
    createId: () => 'imported',
    saveIndex: () => {},
    validation,
    storage,
  });

  assert.throws(() => transfer.importPlanObject(validExport()), /quota probe/);
  assert.deepEqual(index.plans.map((plan) => plan.id), ['existing']);
  assert.equal(
    [...values.keys()].some((key) => key.startsWith(planKey('imported', ''))),
    false,
  );
});

test('export derives missing term codes through the injected canonicalizer', () => {
  const validation = createValidation();
  const planKey = (id, key) => `surriculum.plan.${id}.${key}`;
  const values = new Map([
    [planKey('existing', 'curriculum'), JSON.stringify([['CS101']])],
    [planKey('existing', 'grades'), JSON.stringify([['A']])],
    [planKey('existing', 'dates'), JSON.stringify(['Fall 2024-2025'])],
  ]);
  const storage = {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(String(key), String(value)),
    removeItem: (key) => values.delete(String(key)),
  };
  const index = {
    activeId: 'existing',
    plans: [{
      id: 'existing', name: 'Existing',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-02T00:00:00.000Z',
    }],
  };
  const transfer = globals.SurriculumModules.planImportExport.create({
    planExportVersion: 4,
    maxPlans: 10,
    defaultPlanName: 'Default Plan',
    nowIso: () => '2026-08-31T00:00:00.000Z',
    safeJsonParse: (value, fallback) => {
      try { return JSON.parse(value); } catch (_) { return fallback; }
    },
    canonicalTermCodeFromLabel,
    planKey,
    listLocalStorageKeys: () => [...values.keys()],
    touchUpdated: () => {},
    ensureIndex: () => index,
    getPlanMeta: (id) => index.plans.find((plan) => plan.id === id),
    createId: () => 'imported',
    saveIndex: () => {},
    validation,
    storage,
  });

  const exported = transfer.buildExportObject('existing');
  assert.deepEqual([...exported.plan.state.termCodes], ['202401']);
  assert.deepEqual(
    exported.plan.state.gradingBases.map((semester) => [...semester]),
    [['letter']],
  );
});
