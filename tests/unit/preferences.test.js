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
