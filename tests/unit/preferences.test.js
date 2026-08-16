const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(
  path.resolve(__dirname, '../../scripts/preferences.js'),
  'utf8'
);

function createStorage(seed = {}, hooks = {}) {
  const values = new Map(Object.entries(seed));
  return {
    values,
    getItem(key) {
      if (hooks.getItem) hooks.getItem(key);
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      if (hooks.setItem) hooks.setItem(key, value);
      values.set(key, String(value));
    },
    removeItem(key) {
      if (hooks.removeItem) hooks.removeItem(key);
      values.delete(key);
    },
  };
}

function load(seed, hooks) {
  const localStorage = createStorage(seed, hooks);
  const window = {};
  vm.runInNewContext(SOURCE, { window, localStorage, Set, Object, String });
  return { api: window.preferenceStorage, localStorage };
}

test('copies legacy global preferences into the SUrriculum namespace', () => {
  const { api, localStorage } = load({ theme: 'dark-theme' });

  assert.equal(api.getItem('theme'), 'dark-theme');
  assert.equal(localStorage.values.get('surriculum.preference.theme'), 'dark-theme');
  assert.equal(localStorage.values.get('theme'), 'dark-theme');
});

test('keeps the namespaced value authoritative without deleting a generic copy', () => {
  const { api, localStorage } = load({
    theme: 'light-theme',
    'surriculum.preference.theme': 'dark-theme',
  });

  assert.equal(api.getItem('theme'), 'dark-theme');
  assert.equal(localStorage.values.get('theme'), 'light-theme');
});

test('writes only namespaced keys and validates the known preference list', () => {
  const { api, localStorage } = load();

  assert.equal(api.setItem('schedulerHoverPreview', false), true);
  assert.equal(
    localStorage.values.get('surriculum.preference.schedulerHoverPreview'),
    'false'
  );
  assert.equal(localStorage.values.has('schedulerHoverPreview'), false);
  assert.equal(api.setItem('notAnAppPreference', 'x'), false);
  assert.equal(api.storageKey('notAnAppPreference'), '');
});

test('does not fall back to an unscoped write when namespaced storage fails', () => {
  const { api, localStorage } = load({}, {
    setItem(key) {
      if (key === 'surriculum.preference.theme') throw new Error('quota');
    },
  });

  assert.equal(api.setItem('theme', 'dark-theme'), false);
  assert.equal(localStorage.values.has('theme'), false);
  assert.equal(localStorage.values.has('surriculum.preference.theme'), false);
});

test('removes only the namespaced representation during cleanup', () => {
  const { api, localStorage } = load({
    mobileNoticeDismissed: 'true',
    'surriculum.preference.mobileNoticeDismissed': 'true',
  });

  assert.equal(api.removeItem('mobileNoticeDismissed'), true);
  assert.equal(localStorage.values.get('mobileNoticeDismissed'), 'true');
  assert.equal(
    localStorage.values.has('surriculum.preference.mobileNoticeDismissed'),
    false
  );
});

test('recognizes every planner-specific filter preference as app-owned storage', () => {
  const { api } = load();
  const plannerKeys = [
    'plannerFilterProgram',
    'plannerFilterCategory',
    'plannerFilterLevel',
    'plannerFilterOfferedOnly',
    'plannerFilterMinSu',
    'plannerFilterMinEcts',
    'plannerFilterMinBasicScience',
    'plannerFilterMinEngineering',
    'plannerFilterCheckPrerequisites',
    'plannerFilterShowUnmetPrerequisites',
  ];

  for (const key of plannerKeys) {
    assert.equal(api.knownKeys.includes(key), true, `${key} should be a known preference`);
    assert.equal(api.storageKey(key), `surriculum.preference.${key}`);
  }
});

test('keeps onboarding cohort and release acknowledgments in the app preference namespace', () => {
  const { api } = load();
  const onboardingKeys = [
    'onboardingCohort',
    'onboardingHelpSeen',
    'onboardingLastSeenRelease',
  ];

  for (const key of onboardingKeys) {
    assert.equal(api.knownKeys.includes(key), true, `${key} should be a known preference`);
    assert.equal(api.storageKey(key), `surriculum.preference.${key}`);
  }
});

test('migrates the old offered default once and keeps the new picker preference authoritative', () => {
  const first = load({
    'surriculum.preference.offeredThisTermOnly': 'false',
  });
  assert.equal(first.api.getItem('plannerFilterOfferedOnly'), 'false');
  assert.equal(
    first.localStorage.values.get('surriculum.preference.plannerFilterOfferedOnly'),
    'false'
  );
  assert.equal(
    first.localStorage.values.get('surriculum.preference.offeredThisTermOnly'),
    'false',
    'migration must preserve the old value'
  );

  const existingTarget = load({
    'surriculum.preference.offeredThisTermOnly': 'false',
    'surriculum.preference.plannerFilterOfferedOnly': 'true',
  });
  assert.equal(existingTarget.api.getItem('plannerFilterOfferedOnly'), 'true');
  assert.equal(existingTarget.api.getItem('offeredThisTermOnly'), 'false');
});

test('copies former Scheduler-backed planner defaults without changing Scheduler preferences', () => {
  const schedulerValues = {
    schedulerMinSuCredits: '7',
    schedulerMinEcts: '8',
    schedulerMinBasicScience: '9',
    schedulerMinEngineering: '10',
    schedulerCheckPrereqs: 'false',
    schedulerShowUnmetPrereqs: 'true',
  };
  const seed = Object.fromEntries(Object.entries(schedulerValues).map(([key, value]) => (
    [`surriculum.preference.${key}`, value]
  )));
  // A pre-existing planner value is already migrated/user-owned and must win.
  seed['surriculum.preference.plannerFilterMinEcts'] = '12';

  const { api, localStorage } = load(seed);
  assert.deepEqual({
    minSu: api.getItem('plannerFilterMinSu'),
    minEcts: api.getItem('plannerFilterMinEcts'),
    minBasicScience: api.getItem('plannerFilterMinBasicScience'),
    minEngineering: api.getItem('plannerFilterMinEngineering'),
    checkPrerequisites: api.getItem('plannerFilterCheckPrerequisites'),
    showUnmetPrerequisites: api.getItem('plannerFilterShowUnmetPrerequisites'),
  }, {
    minSu: '7',
    minEcts: '12',
    minBasicScience: '9',
    minEngineering: '10',
    checkPrerequisites: 'false',
    showUnmetPrerequisites: 'true',
  });

  for (const [key, value] of Object.entries(schedulerValues)) {
    assert.equal(api.getItem(key), value, `${key} must retain its Scheduler value`);
    assert.equal(localStorage.values.get(`surriculum.preference.${key}`), value);
  }
});

test('retries an incomplete planner migration on the next boot using the same storage', () => {
  let failPlannerDestinationOnce = true;
  const localStorage = createStorage({
    'surriculum.preference.schedulerMinSuCredits': '7',
  }, {
    setItem(key) {
      if (key === 'surriculum.preference.plannerFilterMinSu'
          && failPlannerDestinationOnce) {
        failPlannerDestinationOnce = false;
        throw new Error('simulated quota failure');
      }
    },
  });

  const firstWindow = {};
  vm.runInNewContext(SOURCE, { window: firstWindow, localStorage, Set, Object, String });
  assert.equal(firstWindow.preferenceStorage.getItem('plannerFilterMinSu'), null);
  assert.equal(firstWindow.preferenceStorage.getItem('schedulerMinSuCredits'), '7');
  assert.equal(firstWindow.preferenceStorage.getItem('plannerFilterMigrationVersion'), null);

  const secondWindow = {};
  vm.runInNewContext(SOURCE, { window: secondWindow, localStorage, Set, Object, String });
  assert.equal(secondWindow.preferenceStorage.getItem('plannerFilterMinSu'), '7');
  assert.equal(secondWindow.preferenceStorage.getItem('schedulerMinSuCredits'), '7');
  assert.equal(secondWindow.preferenceStorage.getItem('plannerFilterMigrationVersion'), '1');
});
