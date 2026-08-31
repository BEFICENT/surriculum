'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const programSelection = require('../../scripts/app/program-selection-controller.js');

class FakeClassList {
  constructor(initial = []) { this.values = new Set(initial); }
  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  contains(value) { return this.values.has(value); }
}

class FakeTarget {
  constructor({ tagName = 'DIV', hidden = false } = {}) {
    this.tagName = tagName;
    this.classList = new FakeClassList(hidden ? ['is-hidden'] : []);
    this.listeners = new Map();
    this.disabled = false;
    this.focused = false;
    this.value = '';
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  emit(type, event = {}) {
    const payload = { target: this, preventDefault() {}, ...event };
    for (const listener of this.listeners.get(type) || []) listener(payload);
  }

  listenerCount(type) { return (this.listeners.get(type) || []).length; }
  focus() { this.focused = true; }
}

class FakeSelect extends FakeTarget {
  constructor() {
    super({ tagName: 'SELECT' });
    this.options = [];
    this._innerHTML = '';
  }

  set innerHTML(value) {
    this._innerHTML = String(value || '');
    this.options = Array.from(this._innerHTML.matchAll(/<option value="([^"]*)"[^>]*>/g))
      .map((match) => ({ value: match[1], disabled: false }));
  }

  get innerHTML() { return this._innerHTML; }
}

function fixture(initial = {}) {
  const storage = new Map(Object.entries(initial));
  const controls = {
    major: new FakeSelect(),
    entryTerm: new FakeSelect(),
    doubleMajor: new FakeSelect(),
    entryTermDM: new FakeSelect(),
    minorTerm1: new FakeSelect(),
    minorTerm2: new FakeSelect(),
    minorTerm3: new FakeSelect(),
    doubleMajorControlsRow: new FakeTarget({ hidden: true }),
    doubleMajorButtonRow: new FakeTarget(),
    addDoubleMajorButton: new FakeTarget(),
    minor1Row: new FakeTarget({ hidden: true }),
    minor2Row: new FakeTarget({ hidden: true }),
    minor3Row: new FakeTarget({ hidden: true }),
    addMinorRow: new FakeTarget(),
    addMinorButton: new FakeTarget(),
    minor1: new FakeSelect(),
    minor2: new FakeSelect(),
    minor3: new FakeSelect(),
  };
  const selectors = new Map([
    ['.change_major', controls.major],
    ['.entryTerm', controls.entryTerm],
    ['.doubleMajor', controls.doubleMajor],
    ['.entryTermDM', controls.entryTermDM],
  ]);
  const ids = new Map([
    ['minorTerm1', controls.minorTerm1],
    ['minorTerm2', controls.minorTerm2],
    ['minorTerm3', controls.minorTerm3],
    ['doubleMajorControlsRow', controls.doubleMajorControlsRow],
    ['doubleMajorButtonRow', controls.doubleMajorButtonRow],
    ['addDoubleMajorBtn', controls.addDoubleMajorButton],
    ['minor1Row', controls.minor1Row],
    ['minor2Row', controls.minor2Row],
    ['minor3Row', controls.minor3Row],
    ['addMinorRow', controls.addMinorRow],
    ['addMinorBtn', controls.addMinorButton],
    ['minor1', controls.minor1],
    ['minor2', controls.minor2],
    ['minor3', controls.minor3],
  ]);
  const document = {
    querySelector: (selector) => selectors.get(selector) || null,
    getElementById: (id) => ids.get(id) || null,
  };
  let reloads = 0;
  const controller = programSelection.createController({
    document,
    primaryProgram: 'CS',
    entryTerms: ['Fall 2024-2025', 'Fall 2023-2024'],
    minorEntryTerms: ['Fall 2024-2025', 'Fall 2023-2024'],
    entryTermName: 'Fall 2024-2025',
    entryTermDMName: 'Fall 2023-2024',
    entryTermMinor1Name: 'Fall 2024-2025',
    entryTermMinor2Name: 'Fall 2023-2024',
    entryTermMinor3Name: 'Fall 2023-2024',
    minorDefaultTermName: 'Fall 2024-2025',
    entryTermCode: '202401',
    entryTermDMCode: '202301',
    getMajorsForTerm: (term) => term === '202301' ? ['CS', 'EE'] : ['CS', 'BIO'],
    planGetItem: (key) => storage.has(key) ? storage.get(key) : null,
    planSetItem: (key, value) => { storage.set(key, String(value)); },
    planRemoveItem: (key) => { storage.delete(key); },
    reloadAfterPlanFlush: () => { reloads += 1; },
    escapeHtml: (value) => String(value),
  });
  return { controller, controls, storage, getReloads: () => reloads };
}

test.beforeEach(() => {
  globalThis.minorRequirements = {
    A: { minor: 'A', name: 'Alpha Minor' },
    B: { minor: 'B', name: 'Beta Minor' },
    C: { minor: 'C', name: 'Gamma Minor' },
  };
});

test.after(() => {
  delete globalThis.minorRequirements;
});

test('program selection initializes once and preserves program/admit-term writes', () => {
  const f = fixture({ doubleMajor: 'EE' });
  assert.equal(Object.isFrozen(programSelection), true);
  assert.equal(Object.isFrozen(f.controller), true);

  f.controller.initialize();
  f.controller.initialize();

  assert.equal(f.controls.major.value, 'CS');
  assert.match(f.controls.major.innerHTML, /value="BIO"/);
  assert.equal(f.controls.entryTerm.value, 'Fall 2024-2025');
  assert.equal(f.controls.entryTermDM.value, 'Fall 2023-2024');
  assert.equal(f.controls.doubleMajor.value, 'EE');
  assert.equal(f.controls.major.listenerCount('change'), 1);
  assert.equal(f.controls.entryTerm.listenerCount('change'), 1);
  assert.equal(f.controls.doubleMajorControlsRow.classList.contains('is-hidden'), false);
  assert.equal(f.controls.doubleMajorButtonRow.classList.contains('is-hidden'), true);

  f.controls.major.value = 'BIO';
  f.controls.major.emit('change');
  f.controls.entryTerm.value = 'Fall 2023-2024';
  f.controls.entryTerm.emit('change');
  f.controls.minorTerm1.value = 'Fall 2023-2024';
  f.controls.minorTerm1.emit('change');

  assert.equal(f.storage.get('major'), 'BIO');
  assert.equal(f.storage.get('entryTerm'), 'Fall 2023-2024');
  assert.equal(f.storage.get('entryTermMinor1'), 'Fall 2023-2024');
  assert.equal(f.storage.get('entryTermMinor'), 'Fall 2023-2024');
  assert.equal(f.getReloads(), 3);
});

test('double-major removal and reveal keep the existing persistence contract', () => {
  const f = fixture({ doubleMajor: 'EE', showDoubleMajorControls: 'true' });
  f.controller.initialize();

  f.controls.doubleMajor.value = '';
  f.controls.doubleMajor.emit('change');
  assert.equal(f.storage.has('doubleMajor'), false);
  assert.equal(f.storage.get('showDoubleMajorControls'), 'false');
  assert.equal(f.getReloads(), 1);

  f.controls.doubleMajorControlsRow.classList.add('is-hidden');
  f.controls.doubleMajorButtonRow.classList.remove('is-hidden');
  f.controls.addDoubleMajorButton.emit('click');
  assert.equal(f.controls.doubleMajorControlsRow.classList.contains('is-hidden'), false);
  assert.equal(f.controls.doubleMajorButtonRow.classList.contains('is-hidden'), true);
  assert.equal(f.controls.doubleMajor.focused, true);
  assert.equal(f.storage.get('showDoubleMajorControls'), 'true');
});

test('clearing the first minor compacts programs and their admit terms', () => {
  const f = fixture({
    minor1: 'A',
    minor2: 'B',
    minor3: 'C',
    entryTermMinor1: 'Fall 2024-2025',
    entryTermMinor2: 'Fall 2023-2024',
    entryTermMinor3: 'Fall 2022-2023',
  });
  f.controller.initialize();

  assert.equal(f.controls.minor1.value, 'A');
  assert.equal(f.controls.minor2.value, 'B');
  assert.equal(f.controls.minor3.value, 'C');
  assert.equal(f.controls.addMinorButton.disabled, true);

  f.controls.minor1.value = '';
  f.controls.minor1.emit('change');

  assert.equal(f.storage.get('minor1'), 'B');
  assert.equal(f.storage.get('minor2'), 'C');
  assert.equal(f.storage.has('minor3'), false);
  assert.equal(f.storage.get('entryTermMinor1'), 'Fall 2023-2024');
  assert.equal(f.storage.get('entryTermMinor'), 'Fall 2023-2024');
  assert.equal(f.storage.get('entryTermMinor2'), 'Fall 2022-2023');
  assert.equal(f.storage.get('entryTermMinor3'), 'Fall 2024-2025');
  assert.equal(f.storage.get('showMinorControls'), 'true');
  assert.equal(f.getReloads(), 1);
});

test('program selection loads after app services and before main in every manifest', () => {
  const root = path.resolve(__dirname, '../..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const shell = html.indexOf('src="scripts/app/shell-controller.js"');
  const selection = html.indexOf('src="scripts/app/program-selection-controller.js"');
  const main = html.indexOf('src="main.js"');
  assert.ok(shell >= 0 && selection > shell && main > selection);

  const serviceWorker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const pagesBuilder = fs.readFileSync(
    path.join(root, 'tools', 'release', 'build_pages_artifact.py'),
    'utf8',
  );
  assert.match(serviceWorker, /scripts\/app\/program-selection-controller\.js/);
  assert.match(pagesBuilder, /scripts\/app\/program-selection-controller\.js/);
});
