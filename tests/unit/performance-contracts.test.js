'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('classic scripts in the document head remain deferred', () => {
  const head = read('index.html').split('</head>', 1)[0];
  const tags = Array.from(head.matchAll(/<script\b[^>]*\bsrc=["'][^"']+["'][^>]*><\/script>/gi), (match) => match[0]);
  const classicTags = tags.filter((tag) => !/\btype=["']module["']/i.test(tag));

  assert.ok(classicTags.length > 0, 'Expected first-party classic scripts in the document head.');
  for (const tag of classicTags) {
    assert.match(tag, /\bdefer\b/i, `Parser-blocking script found: ${tag}`);
  }
});

test('Scheduler snapshots computed grid layout once per render batch', () => {
  const source = read('scripts/scheduler.js');
  const layoutStart = source.indexOf('const getSchedulerLayout = () => {');
  const layoutEnd = source.indexOf('const setBlockPosition =', layoutStart);
  assert.ok(layoutStart >= 0 && layoutEnd > layoutStart, 'Scheduler layout helpers are missing.');

  const layoutHelper = source.slice(layoutStart, layoutEnd);
  assert.equal(
    (layoutHelper.match(/getComputedStyle\s*\(\s*gridEl\s*\)/g) || []).length,
    1,
    'The layout snapshot must use one computed-style read.'
  );
  assert.match(
    source,
    /const setBlockPosition = \(el, startMin, endMin, schedulerLayout\) =>/,
    'Block positioning must accept the batch layout snapshot.'
  );

  const previewStart = source.indexOf('const renderPreviewForCourse =');
  const previewEnd = source.indexOf('let hoverSelectedCourseId', previewStart);
  const previewRenderer = source.slice(previewStart, previewEnd);
  assert.match(previewRenderer, /const schedulerLayout = getSchedulerLayout\(\);\s*clearPreviewBlocks\(schedulerLayout\);/);
  assert.match(previewRenderer, /setBlockPosition\(block, dr\.start, dr\.end, schedulerLayout\);/);
  assert.doesNotMatch(previewRenderer, /setBlockPosition\(block, dr\.start, dr\.end\);/);

  const gridStart = source.indexOf('const renderGrid =');
  const gridEnd = source.indexOf('let resultsLimit', gridStart);
  const gridRenderer = source.slice(gridStart, gridEnd);
  assert.match(gridRenderer, /const schedulerLayout = getSchedulerLayout\(\);\s*clearGridBlocks\(\);/);
  assert.match(gridRenderer, /setBlockPosition\(block, dr\.start, dr\.end, schedulerLayout\);/);
  assert.doesNotMatch(gridRenderer, /setBlockPosition\(block, dr\.start, dr\.end\);/);
});
