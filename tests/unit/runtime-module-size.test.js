'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');

function sourceStats(relative) {
  const source = fs.readFileSync(path.join(ROOT, ...relative.split('/')), 'utf8');
  return {
    bytes: Buffer.byteLength(source),
    lines: source.split(/\r?\n/).length,
  };
}

test('legacy runtime entry points remain bounded orchestrators', () => {
  const limits = {
    'main.js': { lines: 1050, bytes: 52 * 1024 },
    'mobile.js': { lines: 80, bytes: 8 * 1024 },
    'scripts/scheduler.js': { lines: 950, bytes: 44 * 1024 },
    'scripts/scheduler/foundation.js': { lines: 500, bytes: 24 * 1024 },
    'scripts/scheduler/course-ui.js': { lines: 550, bytes: 32 * 1024 },
    'scripts/scheduler/results-controller.js': { lines: 900, bytes: 40 * 1024 },
    'scripts/scheduler/grid-controller.js': { lines: 950, bytes: 44 * 1024 },
    'scripts/s_curriculum.js': { lines: 1000, bytes: 56 * 1024 },
    'scripts/domain/curriculum-recalculation.js': { lines: 400, bytes: 24 * 1024 },
    'scripts/mouse_and_drag.js': { lines: 1000, bytes: 48 * 1024 },
    'scripts/ui/course-history-table.js': { lines: 300, bytes: 16 * 1024 },
    'scripts/click.js': { lines: 400, bytes: 24 * 1024 },
    'scripts/plan_manager.js': { lines: 1000, bytes: 48 * 1024 },
    'scripts/graduation_check.js': { lines: 1050, bytes: 64 * 1024 },
    'scripts/academic_records_parser.js': { lines: 80, bytes: 8 * 1024 },
    'scripts/course_filters.js': { lines: 850, bytes: 40 * 1024 },
    'scripts/course_requisites.js': { lines: 850, bytes: 36 * 1024 },
    'scripts/course-filter-offering-history.js': { lines: 450, bytes: 24 * 1024 },
    'scripts/app/transcript-custom-course-review.js': { lines: 320, bytes: 20 * 1024 },
    'scripts/app/program_context.js': { lines: 760, bytes: 44 * 1024 },
    'scripts/app/shell-controller.js': { lines: 220, bytes: 16 * 1024 },
    'scripts/app/program-selection-controller.js': { lines: 420, bytes: 24 * 1024 },
    'scripts/planner/course-picker.js': { lines: 1000, bytes: 56 * 1024 },
    'scripts/planner/course-picker-layout.js': { lines: 260, bytes: 16 * 1024 },
    'scripts/planner/course-picker-option-renderer.js': { lines: 320, bytes: 20 * 1024 },
    'scripts/planner/course-details-controller.js': { lines: 500, bytes: 32 * 1024 },
    'scripts/planner/grade-editor.js': { lines: 350, bytes: 20 * 1024 },
  };

  for (const [relative, limit] of Object.entries(limits)) {
    const actual = sourceStats(relative);
    assert.ok(
      actual.lines <= limit.lines,
      `${relative} grew to ${actual.lines} lines (limit ${limit.lines}); extract a cohesive responsibility`,
    );
    assert.ok(
      actual.bytes <= limit.bytes,
      `${relative} grew to ${actual.bytes} bytes (limit ${limit.bytes})`,
    );
  }
});

test('graduation minor summary remains a focused presentation controller', () => {
  const actual = sourceStats('scripts/ui/graduation-minor-summary.js');
  assert.ok(actual.lines <= 1000,
    `graduation-minor-summary.js grew to ${actual.lines} lines (limit 1000)`);
  assert.ok(actual.bytes <= 80 * 1024,
    `graduation-minor-summary.js grew to ${actual.bytes} bytes (limit ${80 * 1024})`);
});

test('custom-course UI modules remain focused below the 1,000-line boundary', () => {
  for (const relative of [
    'scripts/app/custom_course_manager.js',
    'scripts/app/custom_course_form.js',
    'scripts/app/custom_course_ui.js',
  ]) {
    const actual = sourceStats(relative);
    assert.ok(actual.lines < 1000,
      `${relative} grew to ${actual.lines} lines; extract another cohesive responsibility`);
    assert.ok(actual.bytes < 64 * 1024,
      `${relative} grew to ${actual.bytes} bytes (limit ${64 * 1024})`);
  }
});

test('academic-record import modules remain focused below the 1,000-line boundary', () => {
  for (const relative of [
    'scripts/academic-records/catalog-resolution.js',
    'scripts/academic-records/importer.js',
  ]) {
    const actual = sourceStats(relative);
    assert.ok(actual.lines < 1000,
      `${relative} grew to ${actual.lines} lines; extract another cohesive responsibility`);
    assert.ok(actual.bytes < 64 * 1024,
      `${relative} grew to ${actual.bytes} bytes (limit ${64 * 1024})`);
  }
});

test('new controller and policy modules do not become replacement monoliths', () => {
  const directories = [
    'scripts/adapters',
    'scripts/academic-records',
    'scripts/app',
    'scripts/data',
    'scripts/domain',
    'scripts/mobile',
    'scripts/plan',
    'scripts/planner',
    'scripts/scheduler',
    'scripts/storage',
    'scripts/ui',
  ];
  const findings = [];
  for (const directory of directories) {
    const absolute = path.join(ROOT, ...directory.split('/'));
    if (!fs.existsSync(absolute)) continue;
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      if (!entry.isFile() || !/\.js$/i.test(entry.name)) continue;
      const relative = `${directory}/${entry.name}`;
      const actual = sourceStats(relative);
      if (actual.lines > 1000 || actual.bytes > 64 * 1024) {
        findings.push(`${relative}: ${actual.lines} lines, ${actual.bytes} bytes`);
      }
    }
  }
  assert.deepEqual(
    findings,
    [],
    `Extracted module exceeds the reviewed boundary:\n${findings.join('\n')}`,
  );
});

test('every Scheduler runtime module stays below the reviewed module boundary', () => {
  const directory = path.join(ROOT, 'scripts', 'scheduler');
  const findings = fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.js$/i.test(entry.name))
    .map((entry) => ({ entry, actual: sourceStats(`scripts/scheduler/${entry.name}`) }))
    .filter(({ actual }) => actual.lines > 1000 || actual.bytes > 64 * 1024)
    .map(({ entry, actual }) => `${entry.name}: ${actual.lines} lines, ${actual.bytes} bytes`);
  assert.deepEqual(findings, [], `Scheduler module boundary exceeded:\n${findings.join('\n')}`);
});
