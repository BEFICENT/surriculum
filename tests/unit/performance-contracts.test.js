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

test('Playwright artifacts cannot erase retained performance runs', () => {
  const configNames = fs.readdirSync(ROOT)
    .filter((name) => /^playwright(?:\.[^.]+)*\.config\.js$/.test(name))
    .sort();
  assert.ok(configNames.length > 0, 'Expected at least one Playwright configuration.');

  const performanceDirectory = path.resolve(ROOT, 'test-results/perf');
  const seenOutputDirectories = new Set();
  for (const configName of configNames) {
    const config = read(configName);
    const match = config.match(/outputDir:\s*['"]([^'"]+)['"]/);
    assert.ok(
      match,
      `${configName} must define an outputDir outside the shared test-results root.`,
    );

    const outputDirectory = path.resolve(ROOT, match[1]);
    const relativePerfPath = path.relative(outputDirectory, performanceDirectory);
    const outputContainsPerformanceRuns = relativePerfPath === '' || (
      !relativePerfPath.startsWith(`..${path.sep}`)
      && relativePerfPath !== '..'
      && !path.isAbsolute(relativePerfPath)
    );
    const relativeOutputPath = path.relative(performanceDirectory, outputDirectory);
    const performanceRunsContainOutput = relativeOutputPath === '' || (
      !relativeOutputPath.startsWith(`..${path.sep}`)
      && relativeOutputPath !== '..'
      && !path.isAbsolute(relativeOutputPath)
    );
    assert.equal(
      outputContainsPerformanceRuns || performanceRunsContainOutput,
      false,
      `${configName} outputDir must not overlap retained performance runs.`,
    );
    assert.equal(
      seenOutputDirectories.has(outputDirectory),
      false,
      `${configName} must not clear another Playwright suite's artifacts.`,
    );
    seenOutputDirectories.add(outputDirectory);
  }
});

test('Scheduler snapshots computed grid layout once per render batch', () => {
  const source = read('scripts/scheduler/grid-controller.js');
  const geometry = read('scripts/scheduler/grid-geometry.js');
  const layoutStart = geometry.indexOf('const getSchedulerLayout = () => {');
  const layoutEnd = geometry.indexOf('const setBlockPosition =', layoutStart);
  assert.ok(layoutStart >= 0 && layoutEnd > layoutStart, 'Scheduler layout helpers are missing.');

  const layoutHelper = geometry.slice(layoutStart, layoutEnd);
  const desktopFastPath = layoutHelper.indexOf("!appBody.classList.contains('is-mobile')");
  const computedLayoutRead = layoutHelper.indexOf('getComputedStyle(gridEl)');
  assert.ok(
    desktopFastPath >= 0 && computedLayoutRead > desktopFastPath,
    'Invariant desktop metrics must bypass the computed-style layout read.'
  );
  assert.equal(
    (layoutHelper.match(/getComputedStyle\s*\(\s*gridEl\s*\)/g) || []).length,
    1,
    'The layout snapshot must use one computed-style read.'
  );
  assert.match(
    geometry,
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
  const gridEnd = source.indexOf('const resetHover =', gridStart);
  const gridRenderer = source.slice(gridStart, gridEnd);
  assert.match(gridRenderer, /const schedulerLayout = getSchedulerLayout\(\);\s*clearGridBlocks\(\);/);
  assert.match(gridRenderer, /setBlockPosition\(block, dr\.start, dr\.end, schedulerLayout\);/);
  assert.doesNotMatch(gridRenderer, /setBlockPosition\(block, dr\.start, dr\.end\);/);
});

test('Scheduler desktop geometry constants stay aligned with their CSS declarations', () => {
  const geometry = read('scripts/scheduler/grid-geometry.js');
  assert.match(geometry, /pxPerMin:\s*1\.05,/);
  assert.match(geometry, /topGapPx:\s*14,/);
  assert.match(geometry, /blockGapPx:\s*6,/);

  const styles = fs.readdirSync(path.join(ROOT, 'styles'))
    .filter((name) => name.endsWith('.css'))
    .map((name) => read(`styles/${name}`))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const declarationValues = (property) => Array.from(
    styles.matchAll(new RegExp(`${property}\\s*:\\s*([^;]+);`, 'g')),
    (match) => match[1].trim(),
  ).sort();

  assert.deepEqual(declarationValues('--scheduler-minute'), [
    '1.05px',
    'var(--m-fit-ppm, 0.42px)',
  ]);
  assert.deepEqual(declarationValues('--scheduler-top-gap'), ['14px', '8px']);
  assert.deepEqual(declarationValues('--scheduler-block-gap'), ['1px', '2px', '6px']);
});

test('Scheduler data loading stays asynchronous and overlaps independent reads', () => {
  const source = read('scripts/scheduler.js');
  const foundation = read('scripts/scheduler/foundation.js');
  const loaderStart = foundation.indexOf('function readSchedulerTextWithXhr');
  const loaderEnd = foundation.indexOf('async function loadSchedulerTermManifest', loaderStart);
  assert.ok(loaderStart >= 0 && loaderEnd > loaderStart, 'Shared Scheduler text loader is missing.');

  const loader = foundation.slice(loaderStart, loaderEnd);
  assert.match(loader, /xhr\.open\('GET', path, true\)/, 'XHR fallback must remain asynchronous.');
  assert.match(loader, /xhr\.status === 200 \|\| xhr\.status === 0/, 'file:// status-0 fallback was lost.');
  assert.match(loader, /await fetch\(path\)/, 'HTTP loading must retain the fetch path.');
  assert.doesNotMatch(
    source + foundation,
    /\.open\([\s\S]{0,160},\s*false\s*\)/,
    'Scheduler reintroduced a synchronous open call.',
  );

  const startupStart = source.indexOf('// Load the schedule and course metadata together.');
  const startupEnd = source.indexOf('planListEl.addEventListener', startupStart);
  assert.ok(startupStart >= 0 && startupEnd > startupStart, 'Scheduler startup block is missing.');
  const startup = source.slice(startupStart, startupEnd);
  assert.match(
    startup,
    /await Promise\.all\(\[\s*scheduleIndexPromise,\s*coursePageInfoPromise,\s*\]\)/,
    'Schedule and course metadata must begin independently and join once.',
  );
  assert.ok(
    (startup.match(/if \(!schedulerIsMounted\(\)\) return;/g) || []).length >= 2,
    'Async startup must stop before DOM work when the Scheduler was closed.',
  );
});

test('Scheduler full renders rebuild expensive surfaces once per state change', () => {
  const schedulerSource = read('scripts/scheduler.js');
  const gridSource = read('scripts/scheduler/grid-controller.js');
  const selectionSource = read('scripts/scheduler/selection-controller.js');
  const gridStart = gridSource.indexOf('const renderGrid =');
  const gridEnd = gridSource.indexOf('const resetHover =', gridStart);
  const gridRenderer = gridSource.slice(gridStart, gridEnd);
  assert.equal(
    (gridRenderer.match(/renderBlockedBackground\(/g) || []).length,
    1,
    'A full grid render must rebuild blocked backgrounds only once.',
  );

  const coreqStart = selectionSource.indexOf('const ensureCoreqsSelected =');
  const coreqEnd = selectionSource.indexOf('const pickSectionForCourse =', coreqStart);
  const coreqPicker = selectionSource.slice(coreqStart, coreqEnd);
  assert.doesNotMatch(
    coreqPicker,
    /renderSelected\(|renderGrid\(|renderResults\(/,
    'The nested corequisite picker must leave one final render to its caller.',
  );

  const startupStart = schedulerSource.indexOf('// Load the schedule and course metadata together.');
  const startupEnd = schedulerSource.indexOf('// Notify once if the schedule data has changed', startupStart);
  const startup = schedulerSource.slice(startupStart, startupEnd);
  assert.equal(
    (startup.match(/renderSelected\(/g) || []).length,
    2,
    'Startup should render the selected list once on success and once only in the no-data branch.',
  );
});

test('Scheduler reuses layout metrics until a responsive boundary invalidates them', () => {
  const source = read('scripts/scheduler/grid-geometry.js');
  const layoutStart = source.indexOf('const getSchedulerLayout = () => {');
  const layoutEnd = source.indexOf('const setBlockPosition =', layoutStart);
  const layoutHelper = source.slice(layoutStart, layoutEnd);
  assert.match(layoutHelper, /if \(schedulerLayoutCache\) return schedulerLayoutCache;/);
  assert.match(
    layoutHelper,
    /schedulerLayoutCache = Object\.freeze\(\{ pxPerMin, topGapPx, blockGapPx \}\);/,
  );

  const invalidatorStart = source.indexOf('const invalidateSchedulerLayout = () => {');
  const invalidatorEnd = source.indexOf('const getSchedulerLayout = () => {', invalidatorStart);
  const invalidator = source.slice(invalidatorStart, invalidatorEnd);
  assert.match(invalidator, /schedulerLayoutCache = null;/);
  assert.match(invalidator, /modal\.__invalidateSchedulerLayout = invalidateSchedulerLayout;/);
  assert.match(invalidator, /onWinResize = \(\) => invalidateSchedulerLayout\(\);/);
  assert.match(source, /delete modal\.__invalidateSchedulerLayout;/);

  const timeGridStart = source.indexOf('const renderTimeGrid =');
  const timeGridEnd = source.indexOf('renderTimeGrid(DISPLAY_END_MIN);', timeGridStart);
  const timeGrid = source.slice(timeGridStart, timeGridEnd);
  assert.equal(
    (timeGrid.match(/getSchedulerLayout\(\)/g) || []).length,
    1,
    'Time-grid rendering must reuse one layout snapshot across all day columns.',
  );
  assert.ok(
    timeGrid.indexOf('getSchedulerLayout()')
      < timeGrid.indexOf("schedulerGridEl.style.setProperty('--scheduler-total-minutes'"),
    'Time-grid metrics must be read before DOM/style writes.',
  );
  assert.match(timeGrid, /scheduleScrollbarCompensation\(\);/);
});

test('Scheduler responsive hooks batch geometry work and keep blur reads ahead of writes', () => {
  const source = read('scripts/scheduler/grid-geometry.js');
  const dialogs = read('scripts/scheduler/dialogs.js');
  const scrollbarStart = source.indexOf('const updateScrollbarCompensation = () => {');
  const scrollbarEnd = source.indexOf('const getSchedulerLayout = () => {', scrollbarStart);
  const scrollbarHelpers = source.slice(scrollbarStart, scrollbarEnd);
  assert.match(scrollbarHelpers, /scrollbarCompensationFrame = requestAnimationFrame\(/);
  assert.match(
    scrollbarHelpers,
    /body\.style\.getPropertyValue\('--scheduler-scrollbar-w'\) !== nextValue/,
  );
  assert.doesNotMatch(
    source,
    /requestAnimationFrame\(\(\) => updateScrollbarCompensation\(\)\)/,
    'Callers must go through the single-frame scheduler.',
  );

  const blurStart = dialogs.indexOf('function activateSchedulerEdgeBlur');
  const blurUpdateStart = dialogs.indexOf('const update = () => {', blurStart);
  const blurUpdateEnd = dialogs.indexOf('const refresh = () => {', blurUpdateStart);
  const blurUpdate = dialogs.slice(blurUpdateStart, blurUpdateEnd);
  assert.ok(
    blurUpdate.indexOf('const modalStyle = getComputedStyle(modal);')
      < blurUpdate.indexOf('place(bands.top'),
    'Edge-blur corner style must be read before any band is written.',
  );

  const mobile = read('scripts/mobile/scheduler-adaptation.js');
  const fitStart = mobile.indexOf('function updateFitPpm()');
  const fitEnd = mobile.indexOf('function reRenderOpenScheduler()', fitStart);
  assert.equal(
    (mobile.slice(fitStart, fitEnd).match(/invalidateOpenSchedulerLayout\(\);/g) || []).length,
    2,
    'Both set and remove paths for --m-fit-ppm must invalidate the cached layout.',
  );
  const refitStart = mobile.indexOf('function refitLandscapeInPlace()');
  const refitEnd = mobile.indexOf('function init()', refitStart);
  assert.match(
    mobile.slice(refitStart, refitEnd),
    /setProperty\('--m-fit-ppm'[\s\S]*invalidateOpenSchedulerLayout\(\);/,
  );
});

test('Scheduler result rerenders reuse cards and compute prerequisite history once', () => {
  const source = read('scripts/scheduler/results-controller.js');
  const resultsSource = read('scripts/scheduler/results.js');
  const renderStart = source.indexOf('const renderResults =');
  const renderEnd = source.indexOf('const disposers =', renderStart);
  assert.ok(renderStart >= 0 && renderEnd > renderStart, 'Scheduler results renderer is missing.');
  const renderer = source.slice(renderStart, renderEnd);

  assert.equal(
    (renderer.match(/computeTakenBeforeCurrentTermSet\(\)/g) || []).length,
    1,
    'Previous-term courses must be collected only once per results render.',
  );
  assert.match(renderer, /resultsReconciler\.renderKeyedHtml\(limited\.length/);
  assert.doesNotMatch(source, /resultsEl\.innerHTML\s*=/);
  assert.match(resultsSource, /cached\.signature === signature/);
  assert.match(resultsSource, /renderKeyedHtml/);
  assert.match(resultsSource, /parseHtmlNodes\(signature\)/);
  assert.match(resultsSource, /container\.insertBefore\(node, cursor \|\| null\)/);
});

test('Scheduler numeric filter change cancels its pending input render', () => {
  const source = read('scripts/scheduler/results-controller.js');
  const start = source.indexOf("[[minSuInput, 'schedulerMinSuCredits']");
  const end = source.indexOf("listen(prereqToggle, 'change'", start);
  assert.ok(start >= 0 && end > start, 'Scheduler numeric filter binding is missing.');
  const binding = source.slice(start, end);
  assert.match(binding, /if \(timer\) \{ clearTimeout\(timer\); numericInputTimers\.delete\(timer\); \}/);
  assert.match(binding, /listen\(element, 'change', flush\)/);
});
