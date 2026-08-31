'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const appShell = require('../../scripts/app/shell-controller.js');

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  contains(value) { return this.values.has(value); }
  toggle(value) {
    if (this.values.has(value)) { this.values.delete(value); return false; }
    this.values.add(value); return true;
  }
}

class FakeTarget {
  constructor() {
    this.listeners = new Map();
    this.classList = new FakeClassList();
    this.attributes = new Map();
    this.focused = false;
    this.offsetWidth = 240;
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  removeEventListener(type, listener) {
    const rows = this.listeners.get(type) || [];
    this.listeners.set(type, rows.filter((row) => row !== listener));
  }

  emit(type, event = {}) {
    for (const listener of [...(this.listeners.get(type) || [])]) listener(event);
  }

  listenerCount(type) { return (this.listeners.get(type) || []).length; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) || null; }
  contains(target) { return target === this; }
  focus() { this.focused = true; }
}

function fixture() {
  const sidebar = new FakeTarget();
  const sidebarToggle = new FakeTarget();
  const importToggle = new FakeTarget();
  const importDropdown = new FakeTarget();
  const headerControls = new FakeTarget();
  const headerMore = new FakeTarget();
  const document = new FakeTarget();
  const window = new FakeTarget();
  window.document = document;
  window.innerWidth = 500;
  const bySelector = new Map([
    ['.sidebar', sidebar],
    ['.sidebar-toggle', sidebarToggle],
    ['.import-toggle', importToggle],
  ]);
  const byId = new Map([
    ['importDropdown', importDropdown],
    ['headerControls', headerControls],
    ['headerMore', headerMore],
  ]);
  document.querySelector = (selector) => bySelector.get(selector) || null;
  document.getElementById = (id) => byId.get(id) || null;
  return {
    window, document, sidebar, sidebarToggle, importToggle, importDropdown,
    headerControls, headerMore,
  };
}

test('app shell controller is frozen and idempotent per document', () => {
  const f = fixture();
  const first = appShell.createController(f);
  const second = appShell.createController(f);
  assert.equal(Object.isFrozen(appShell), true);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(first, second);

  first.bindSidebar();
  first.bindSidebar();
  first.bindHeaderAndImportMenus();
  first.bindHeaderAndImportMenus();
  assert.equal(f.sidebarToggle.listenerCount('click'), 1);
  assert.equal(f.document.listenerCount('touchstart'), 1);
  assert.equal(f.document.listenerCount('touchend'), 1);
  assert.equal(f.importToggle.listenerCount('click'), 1);
  assert.equal(f.headerMore.listenerCount('click'), 1);
  assert.equal(f.document.listenerCount('click'), 2);
  assert.equal(f.document.listenerCount('keydown'), 2);
  assert.equal(f.window.listenerCount('resize'), 1);
});

test('sidebar click and swipe behavior is preserved', () => {
  const f = fixture();
  const controller = appShell.createController(f);
  controller.bindSidebar();
  f.sidebarToggle.emit('click');
  assert.equal(f.sidebar.classList.contains('collapsed'), true);

  f.document.emit('touchstart', { touches: [{ clientX: 10, clientY: 30 }] });
  f.document.emit('touchend', { changedTouches: [{ clientX: 90, clientY: 32 }] });
  assert.equal(f.sidebar.classList.contains('collapsed'), false);

  f.document.emit('touchstart', { touches: [{ clientX: 100, clientY: 30 }] });
  f.document.emit('touchend', { changedTouches: [{ clientX: 20, clientY: 32 }] });
  assert.equal(f.sidebar.classList.contains('collapsed'), true);
  controller.dispose();
  assert.equal(f.document.listenerCount('touchstart'), 0);
});

test('header and import menus retain toggle, outside-click, Escape, and resize behavior', () => {
  const f = fixture();
  const controller = appShell.createController(f);
  controller.bindHeaderAndImportMenus();

  f.importToggle.emit('click');
  assert.equal(f.importDropdown.classList.contains('active'), true);
  f.headerMore.emit('click', { stopPropagation() {} });
  assert.equal(f.headerControls.classList.contains('is-open'), true);
  assert.equal(f.headerMore.getAttribute('aria-expanded'), 'true');

  const outside = new FakeTarget();
  f.document.emit('click', { target: outside });
  assert.equal(f.importDropdown.classList.contains('active'), false);
  assert.equal(f.headerControls.classList.contains('is-open'), false);

  f.importToggle.emit('click');
  f.document.emit('keydown', { key: 'Escape', preventDefault() {} });
  assert.equal(f.importDropdown.classList.contains('active'), false);
  assert.equal(f.importToggle.focused, true);

  f.headerMore.emit('click', { stopPropagation() {} });
  f.window.innerWidth = 900;
  f.window.emit('resize');
  assert.equal(f.headerControls.classList.contains('is-open'), false);
});

test('app shell classic script loads after app dependencies and before main.js', () => {
  const root = path.resolve(__dirname, '../..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const programData = html.indexOf('src="scripts/app/program-data.js"');
  const shell = html.indexOf('src="scripts/app/shell-controller.js"');
  const main = html.indexOf('src="main.js"');
  assert.ok(programData >= 0 && shell > programData && main > shell);
});
