'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const {
  assertInventoryDoesNotGrow,
  countCallsWithLiteralFalseThirdArgument,
  declarationsForSelector,
  inventoryLiteralFalseThirdArgument,
  inventoryMatches,
  loadBaseline,
  parseCssBlocks,
  relativePath,
  runtimeCssFiles,
  runtimeJavaScriptFiles
} = require('./helpers');

const baseline = loadBaseline();
const runtimeFiles = runtimeJavaScriptFiles();
const cssFiles = runtimeCssFiles();

test('synchronous call scanner handles multiline and nested URL arguments', () => {
  const sample = `
    xhr.open('GET', new URL(path, location.href), false);
    xhr.open(
      'GET',
      \`./courses/${'${term}'}.jsonl\`,
      false
    );
    xhr.open('GET', path, true);
    window.open(path, '_blank', 'noopener');
  `;
  assert.equal(countCallsWithLiteralFalseThirdArgument(sample, 'open'), 2);
});

test('first-party runtime does not add synchronous XMLHttpRequest sites', () => {
  // This intentionally inventories the third `false` argument instead of all
  // XMLHttpRequest use. Removing or converting an existing site is always OK;
  // adding one in any file requires an explicit baseline review.
  const actual = inventoryLiteralFalseThirdArgument(runtimeFiles, 'open');
  assertInventoryDoesNotGrow(
    assert,
    'Synchronous XMLHttpRequest inventory',
    actual,
    baseline.synchronousXhrSites
  );
});

test('known static main-thread risk patterns only move downward', () => {
  const risks = [
    {
      label: 'setInterval inventory',
      files: runtimeFiles,
      expression: /\bsetInterval\s*\(/g,
      allowed: baseline.riskyPatterns.setInterval
    },
    {
      label: 'transition: all inventory',
      files: cssFiles,
      expression: /\btransition\s*:\s*all\b/gi,
      allowed: baseline.riskyPatterns.transitionAll
    },
    {
      label: 'touchmove listener inventory',
      files: runtimeFiles,
      expression: /\.addEventListener\s*\(\s*['"]touchmove['"]/g,
      allowed: baseline.riskyPatterns.touchmoveListeners
    },
    {
      label: 'document mouse hover listener inventory',
      files: runtimeFiles,
      expression: /\bdocument\.addEventListener\s*\(\s*['"](?:mouseover|mouseout|mousemove|pointermove)['"]/g,
      allowed: baseline.riskyPatterns.documentMouseHoverListeners
    }
  ];

  for (const risk of risks) {
    const actual = inventoryMatches(risk.files, risk.expression);
    assertInventoryDoesNotGrow(assert, risk.label, actual, risk.allowed);
  }
});

test('backdrop blur declarations remain on the reviewed selector allowlist', () => {
  const found = [];
  const fullViewport = [];

  for (const file of cssFiles) {
    const blocks = parseCssBlocks(fs.readFileSync(file, 'utf8'));
    for (const block of blocks) {
      const hasBlur = /(?:^|;)\s*(?:-webkit-)?backdrop-filter\s*:\s*(?!none\b)[^;]*\bblur\s*\(/i.test(block.body);
      if (!hasBlur) continue;
      for (const selector of block.selector.split(',').map((item) => item.trim())) {
        found.push(selector);
        const fixed = /(?:^|;)\s*position\s*:\s*fixed\b/i.test(block.body);
        const inset = /(?:^|;)\s*inset\s*:\s*0(?:\D|$)/i.test(block.body);
        const viewportWidth = /(?:^|;)\s*(?:width|min-width|max-width)\s*:\s*100vw\b/i.test(block.body);
        const viewportHeight = /(?:^|;)\s*(?:height|min-height|max-height)\s*:\s*100(?:d|s|l)?vh\b/i.test(block.body);
        if (fixed && (inset || (viewportWidth && viewportHeight))) fullViewport.push(selector);
      }
    }
  }

  const allowed = new Set(baseline.backdropFilter.allowedBlurSelectors);
  const unexpected = [...new Set(found)].filter((selector) => !allowed.has(selector)).sort();
  assert.deepEqual(
    unexpected,
    [],
    `Unreviewed backdrop blur selectors: ${unexpected.join(', ')}. ` +
      'A full or large composited blur can make Scheduler input jank badly.'
  );

  const allowedFullViewport = new Set(baseline.backdropFilter.allowedFullViewportBlurSelectors);
  const unexpectedFullViewport = [...new Set(fullViewport)]
    .filter((selector) => !allowedFullViewport.has(selector))
    .sort();
  assert.deepEqual(
    unexpectedFullViewport,
    [],
    `Unreviewed full-viewport backdrop blur selectors: ${unexpectedFullViewport.join(', ')}`
  );
});

test('Scheduler disables inherited full-screen blur and uses bounded edge and corner surfaces', () => {
  const stylesheet = cssFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  const blocks = parseCssBlocks(stylesheet);
  const overlay = declarationsForSelector(blocks, '.scheduler-overlay');
  assert.match(overlay, /(?:^|;)\s*backdrop-filter\s*:\s*none\b/i);
  assert.match(overlay, /(?:^|;)\s*background\s*:\s*transparent\b/i);

  const edgeBase = declarationsForSelector(blocks, '.scheduler-edge-blur');
  assert.match(edgeBase, /(?:^|;)\s*position\s*:\s*(?:absolute|fixed)\b/i);
  assert.match(edgeBase, /(?:^|;)\s*pointer-events\s*:\s*none\b/i);
  assert.match(edgeBase, /(?:^|;)\s*(?:-webkit-)?backdrop-filter\s*:[^;]*\bblur\s*\(/i);
  assert.doesNotMatch(edgeBase, /(?:^|;)\s*inset\s*:\s*0(?:\D|$)/i);

  const schedulerSource = runtimeFiles
    .filter((file) => {
      const relative = relativePath(file);
      return relative === 'scripts/scheduler.js' || relative.startsWith('scripts/scheduler/');
    })
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n');
  assert.match(
    schedulerSource,
    /\[\s*['"]top['"]\s*,\s*['"]right['"]\s*,\s*['"]bottom['"]\s*,\s*['"]left['"]\s*\]/,
    'Scheduler must create top, right, bottom, and left edge bands.'
  );
  assert.ok(
    schedulerSource.includes('scheduler-edge-blur--${side}'),
    'Scheduler edge-band elements must receive their side modifier class.'
  );
  assert.match(
    schedulerSource,
    /\[\s*['"]top-left['"]\s*,\s*['"]top-right['"]\s*,\s*['"]bottom-right['"]\s*,\s*['"]bottom-left['"]\s*\]/,
    'Scheduler must create a bounded patch for every rounded corner.'
  );
  assert.ok(
    schedulerSource.includes('scheduler-corner-blur--${corner}'),
    'Scheduler corner patches must receive their corner modifier class.'
  );
  for (const property of [
    'borderTopLeftRadius',
    'borderTopRightRadius',
    'borderBottomRightRadius',
    'borderBottomLeftRadius',
  ]) {
    assert.ok(
      schedulerSource.includes(property),
      `Scheduler corner geometry must follow the computed ${property}.`
    );
  }

  for (const block of blocks.filter((entry) => entry.selector.includes('.scheduler-edge-blur'))) {
    const hasInsetZero = /(?:^|;)\s*inset\s*:\s*0(?:\D|$)/i.test(block.body);
    const hasFullWidth = /(?:^|;)\s*width\s*:\s*100vw\b/i.test(block.body);
    const hasFullHeight = /(?:^|;)\s*height\s*:\s*100(?:d|s|l)?vh\b/i.test(block.body);
    assert.ok(
      !hasInsetZero && !(hasFullWidth && hasFullHeight),
      `${block.selector} restores a full-viewport blur surface.`
    );
  }

  assert.ok(
    schedulerSource.includes('ResizeObserver'),
    'Scheduler edge geometry must follow modal size changes through ResizeObserver.'
  );
  assert.match(
    schedulerSource,
    /visualViewport/,
    'Scheduler edge geometry must follow the visual viewport on mobile/zoom changes.'
  );
});
