'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { firstPartyStylesheetPaths } = require('../helpers/runtime-css');

const ROOT = path.resolve(__dirname, '../..');
const TOKEN_START = '/* === THEME TOKENS: START === */';
const TOKEN_END = '/* === THEME TOKENS: END === */';
const EXPECTED_ORDER = Object.freeze([
  'styles.css',
  'styles/planner-shell.css',
  'styles/graduation.css',
  'styles/planner.css',
  'styles/scheduler-shell.css',
  'styles/scheduler-grid.css',
  'styles/planner-controls.css',
  'styles/summary-overview.css',
  'styles/summary-workspace.css',
  'mobile.css',
  'styles/mobile-scheduler.css',
]);

function read(relative) {
  return fs.readFileSync(path.join(ROOT, ...relative.split('/')), 'utf8');
}

test('first-party stylesheets retain the reviewed cascade order', () => {
  assert.deepEqual(firstPartyStylesheetPaths(ROOT), EXPECTED_ORDER);
  const shippedComponents = fs.readdirSync(path.join(ROOT, 'styles'), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.css'))
    .map((entry) => `styles/${entry.name}`)
    .sort();
  assert.deepEqual(
    shippedComponents,
    EXPECTED_ORDER.filter((relative) => relative.startsWith('styles/')).sort(),
    'every component stylesheet must be linked exactly once, with no orphan files',
  );
});

test('CSS modules remain bounded without adding render-blocking import chains', () => {
  let totalBytes = 0;
  for (const relative of EXPECTED_ORDER) {
    const source = read(relative);
    const bytes = Buffer.byteLength(source);
    const lines = source.split(/\r?\n/).length;
    totalBytes += bytes;
    assert.ok(lines <= 1300, `${relative} grew to ${lines} lines (limit 1300)`);
    assert.ok(bytes <= 40 * 1024, `${relative} grew to ${bytes} bytes (limit ${40 * 1024})`);
    assert.doesNotMatch(source, /@import\b/i, `${relative} must stay a direct page stylesheet`);
  }
  assert.ok(
    totalBytes <= 256 * 1024,
    `first-party CSS grew to ${totalBytes} bytes (limit ${256 * 1024})`,
  );
});

test('theme identity remains centralized in styles.css', () => {
  for (const relative of EXPECTED_ORDER) {
    const source = read(relative);
    const starts = source.split(TOKEN_START).length - 1;
    const ends = source.split(TOKEN_END).length - 1;
    assert.equal(starts, relative === 'styles.css' ? 1 : 0, `${relative} token START count`);
    assert.equal(ends, relative === 'styles.css' ? 1 : 0, `${relative} token END count`);
  }
});

test('shared icon variables resolve from their component stylesheet consumers', () => {
  const declarations = read('styles/planner.css');
  const componentSources = [read('styles/planner.css'), read('styles/planner-controls.css')];
  const consumedIconVariables = new Set();
  for (const source of componentSources) {
    for (const match of source.matchAll(/var\((--icon-[a-z-]+)\)/g)) {
      consumedIconVariables.add(match[1]);
    }
  }

  assert.ok(consumedIconVariables.size > 0, 'expected component stylesheets to consume icon variables');
  for (const variable of consumedIconVariables) {
    const escaped = variable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp(`${escaped}:\\s*url\\(`).test(declarations)) continue;
    assert.match(
      declarations,
      new RegExp(`${escaped}:\\s*url\\(['\"]?\\.\\./assets/`),
      `${variable} must step out of styles/ before resolving its asset`,
    );
  }
});

test('global accessibility and planner modal rules stay with their CSS owners', () => {
  const base = read('styles.css');
  const plannerControls = read('styles/planner-controls.css');
  const summaryWorkspace = read('styles/summary-workspace.css');

  for (const selector of [
    '.custom_course_overlay {',
    '.custom_course_manage_overlay {',
    '.double_major_overlay {',
  ]) {
    assert.ok(plannerControls.includes(selector), `${selector} must be owned by planner controls`);
    assert.ok(!summaryWorkspace.includes(selector), `${selector} leaked into the Summary workspace`);
  }

  assert.match(base, /@supports selector\(:focus-visible\)/);
  assert.match(base, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(base, /input\[type="text"\], input\[type="file"\], select/);
  assert.doesNotMatch(summaryWorkspace, /@supports selector\(:focus-visible\)/);
  assert.doesNotMatch(summaryWorkspace, /@media \(prefers-reduced-motion: reduce\)/);
});
