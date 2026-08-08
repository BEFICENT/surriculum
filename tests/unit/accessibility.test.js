const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
const PLAN_MANAGER = fs.readFileSync(path.join(ROOT, 'scripts/plan_manager.js'), 'utf8');
const SEMESTER_UI = fs.readFileSync(path.join(ROOT, 'scripts/mouse_and_drag.js'), 'utf8');

test('static planner controls expose durable accessible names', () => {
  for (const name of [
    'Major program',
    'Major admit term',
    'Double-major program',
    'Double-major admit term',
    'Minor 1 program',
    'Minor 1 admit term',
    'Academic records file',
  ]) {
    assert.match(HTML, new RegExp(`aria-label=["']${name}["']`));
  }
  for (const labelledBy of [
    'courseDetailsToggleLabel',
    'hideTakenCoursesToggleLabel',
    'offeredThisTermLabel',
    'sortByScoreLabel',
  ]) {
    assert.match(HTML, new RegExp(`aria-labelledby=["']${labelledBy}["']`));
  }
  assert.match(HTML, /id=["']a11yStatus["'][^>]*role=["']status["']/);
});

test('shared modal has a name, focus trap, Escape handling, and focus restoration', () => {
  assert.match(PLAN_MANAGER, /aria-labelledby/);
  assert.match(PLAN_MANAGER, /aria-describedby/);
  assert.match(PLAN_MANAGER, /e\.key === 'Tab'/);
  assert.match(PLAN_MANAGER, /e\.key === 'Escape'/);
  assert.match(PLAN_MANAGER, /previouslyFocused\.focus/);
  assert.match(PLAN_MANAGER, /Close \$\{title \|\| 'dialog'\}/);
});

test('planner reorder alternatives are buttons and announce their result', () => {
  assert.match(PLAN_MANAGER, /plan-move-up/);
  assert.match(PLAN_MANAGER, /plan-move-down/);
  assert.match(PLAN_MANAGER, /Moved \$\{p\.name\}/);
  assert.match(SEMESTER_UI, /semester_move_up/);
  assert.match(SEMESTER_UI, /semester_move_down/);
  assert.match(SEMESTER_UI, /announcePlannerChange/);
  assert.match(SEMESTER_UI, /requestSave/);
});

test('focus visibility and reduced-motion rules are pinned', () => {
  assert.match(CSS, /@supports selector\(:focus-visible\)/);
  assert.match(CSS, /:focus-visible/);
  assert.match(CSS, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(CSS, /animation-duration:\s*0\.01ms\s*!important/);
  assert.match(CSS, /transition-duration:\s*0\.01ms\s*!important/);
  assert.match(CSS, /--text-secondary:\s*#475569/);
  assert.match(CSS, /--text-muted:\s*#64748B/);
  assert.match(CSS, /--accent:\s*#2E7D32/);
});
