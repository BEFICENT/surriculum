'use strict';

const {
  assertScenarioContext,
  recordInvariant,
  runPhase,
  seedFixture,
  settleAnimationFrames,
  waitForStableFingerprint,
} = require('./_shared');

function clippedRect(rect, width, height) {
  const left = Math.max(0, Math.min(width, rect.left));
  const right = Math.max(0, Math.min(width, rect.right));
  const top = Math.max(0, Math.min(height, rect.top));
  const bottom = Math.max(0, Math.min(height, rect.bottom));
  return {
    left,
    right,
    top,
    bottom,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

async function openScheduler(page, timeout = 30_000) {
  const modal = page.locator('.scheduler-modal');
  await waitForStableFingerprint(page, '.scheduler-modal', async () => {
    await page.evaluate(() => {
      if (typeof window.openSchedulerModal !== 'function') {
        throw new Error('window.openSchedulerModal is unavailable.');
      }
      window.openSchedulerModal();
    });
    await modal.waitFor({ state: 'visible', timeout });
    await page.waitForFunction(() => {
      const root = document.querySelector('.scheduler-modal');
      if (!root) return false;
      const loading = root.querySelector('.scheduler-results .scheduler-muted');
      return Boolean(root.querySelector('.scheduler-course'))
        || !(loading && /Loading schedule data/i.test(loading.textContent || ''));
    }, null, { timeout });
    await modal.locator('.scheduler-course').first()
      .waitFor({ state: 'visible', timeout });
  }, {
    expected: { selector: '.scheduler-modal .scheduler-course', minCount: 1 },
    mutationSelector: '.scheduler-modal .scheduler-results',
    timeout,
  });
  return modal;
}

async function waitForSchedulerLayout(page, mobile, timeout = 30_000) {
  await page.waitForFunction((expectMobile) => {
    const bodyMobile = document.body.classList.contains('is-mobile');
    const modal = document.querySelector('.scheduler-modal');
    if (!modal || bodyMobile !== expectMobile) return false;
    return modal.classList.contains('m-scheduler') === expectMobile;
  }, Boolean(mobile), { timeout });
  await page.locator('.scheduler-modal .scheduler-course').first()
    .waitFor({ state: 'visible', timeout });
  await settleAnimationFrames(page, 3);
}

async function setHoverPreview(modal, enabled) {
  const toggle = modal.locator('.scheduler-toggle-hover-preview');
  await toggle.evaluate((node, next) => {
    if (Boolean(node.checked) === Boolean(next)) return;
    node.checked = Boolean(next);
    node.dispatchEvent(new Event('change', { bubbles: true }));
  }, enabled);
}

async function collectBlurGeometry(page) {
  return page.evaluate(() => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const viewportArea = Math.max(1, viewport.width * viewport.height);
    const modal = document.querySelector('.scheduler-modal');
    const modalRect = modal ? modal.getBoundingClientRect() : null;
    const area = (rect) => Math.max(0, rect.width) * Math.max(0, rect.height);
    const clip = (rect) => {
      const left = Math.max(0, Math.min(viewport.width, rect.left));
      const right = Math.max(0, Math.min(viewport.width, rect.right));
      const top = Math.max(0, Math.min(viewport.height, rect.top));
      const bottom = Math.max(0, Math.min(viewport.height, rect.bottom));
      return {
        left,
        right,
        top,
        bottom,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top),
      };
    };
    const intersectionArea = (left, right) => {
      if (!left || !right) return 0;
      const width = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
      const height = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
      return width * height;
    };
    const selectorFor = (node) => {
      if (node.id) return `#${node.id}`;
      const classes = Array.from(node.classList || []).slice(0, 4);
      return `${node.tagName.toLowerCase()}${classes.map((name) => `.${name}`).join('')}`;
    };
    const blurPattern = /blur\((?!0(?:px|rem|em)?\))/i;
    const blurred = Array.from(document.body.querySelectorAll('*')).flatMap((node) => {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return [];
      const backdrop = style.backdropFilter || style.webkitBackdropFilter || 'none';
      const filter = style.filter || 'none';
      const hasBackdropBlur = blurPattern.test(backdrop);
      const hasFilterBlur = blurPattern.test(filter);
      if (!hasBackdropBlur && !hasFilterBlur) return [];
      const rect = clip(node.getBoundingClientRect());
      if (rect.width <= 0 || rect.height <= 0) return [];
      return [{
        selector: selectorFor(node),
        classes: Array.from(node.classList || []),
        backdropFilter: backdrop,
        filter,
        kind: hasBackdropBlur ? 'backdrop' : 'filter',
        rect,
        viewportAreaFraction: area(rect) / viewportArea,
        modalIntersectionArea: modalRect ? intersectionArea(rect, clip(modalRect)) : 0,
      }];
    });
    const backdrop = blurred.filter((entry) => entry.kind === 'backdrop');
    const clippedModal = modalRect ? clip(modalRect) : null;
    const modalArea = clippedModal ? Math.max(1, area(clippedModal)) : 1;
    const edgeBands = Object.fromEntries(['top', 'right', 'bottom', 'left'].map((side) => [
      side,
      backdrop.find((entry) => entry.classes.includes(`scheduler-edge-blur--${side}`)) || null,
    ]));
    const cornerNames = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
    const cornerPatches = Object.fromEntries(cornerNames.map((corner) => [
      corner,
      backdrop.find((entry) => entry.classes.includes(`scheduler-corner-blur--${corner}`)) || null,
    ]));
    const closeEnough = (left, right) => Math.abs(left - right) <= 1.5;
    const expectedBandVisibility = clippedModal ? {
      top: clippedModal.top > 0.5,
      right: viewport.width - clippedModal.right > 0.5,
      bottom: viewport.height - clippedModal.bottom > 0.5,
      left: clippedModal.left > 0.5,
    } : { top: false, right: false, bottom: false, left: false };
    const alignment = clippedModal ? {
      top: !expectedBandVisibility.top || Boolean(edgeBands.top
        && closeEnough(edgeBands.top.rect.left, 0)
        && closeEnough(edgeBands.top.rect.right, viewport.width)
        && closeEnough(edgeBands.top.rect.bottom, clippedModal.top)),
      right: !expectedBandVisibility.right || Boolean(edgeBands.right
        && closeEnough(edgeBands.right.rect.left, clippedModal.right)
        && closeEnough(edgeBands.right.rect.top, clippedModal.top)
        && closeEnough(edgeBands.right.rect.bottom, clippedModal.bottom)),
      bottom: !expectedBandVisibility.bottom || Boolean(edgeBands.bottom
        && closeEnough(edgeBands.bottom.rect.left, 0)
        && closeEnough(edgeBands.bottom.rect.right, viewport.width)
        && closeEnough(edgeBands.bottom.rect.top, clippedModal.bottom)),
      left: !expectedBandVisibility.left || Boolean(edgeBands.left
        && closeEnough(edgeBands.left.rect.right, clippedModal.left)
        && closeEnough(edgeBands.left.rect.top, clippedModal.top)
        && closeEnough(edgeBands.left.rect.bottom, clippedModal.bottom)),
    } : { top: false, right: false, bottom: false, left: false };
    const radius = (value) => {
      const values = String(value || '').split(/\s+/).map(Number.parseFloat).filter(Number.isFinite);
      return { x: values[0] || 0, y: values[1] || values[0] || 0 };
    };
    const modalStyle = modal ? getComputedStyle(modal) : null;
    const cornerRadii = modalStyle ? {
      'top-left': radius(modalStyle.borderTopLeftRadius),
      'top-right': radius(modalStyle.borderTopRightRadius),
      'bottom-right': radius(modalStyle.borderBottomRightRadius),
      'bottom-left': radius(modalStyle.borderBottomLeftRadius),
    } : Object.fromEntries(cornerNames.map((corner) => [corner, { x: 0, y: 0 }]));
    const expectedCornerVisibility = Object.fromEntries(cornerNames.map((corner) => [
      corner,
      cornerRadii[corner].x > 0.5 && cornerRadii[corner].y > 0.5,
    ]));
    const expectedCornerRects = clippedModal ? {
      'top-left': {
        left: clippedModal.left,
        top: clippedModal.top,
        right: clippedModal.left + cornerRadii['top-left'].x,
        bottom: clippedModal.top + cornerRadii['top-left'].y,
      },
      'top-right': {
        left: clippedModal.right - cornerRadii['top-right'].x,
        top: clippedModal.top,
        right: clippedModal.right,
        bottom: clippedModal.top + cornerRadii['top-right'].y,
      },
      'bottom-right': {
        left: clippedModal.right - cornerRadii['bottom-right'].x,
        top: clippedModal.bottom - cornerRadii['bottom-right'].y,
        right: clippedModal.right,
        bottom: clippedModal.bottom,
      },
      'bottom-left': {
        left: clippedModal.left,
        top: clippedModal.bottom - cornerRadii['bottom-left'].y,
        right: clippedModal.left + cornerRadii['bottom-left'].x,
        bottom: clippedModal.bottom,
      },
    } : null;
    const cornerAlignment = Object.fromEntries(cornerNames.map((corner) => {
      if (!expectedCornerVisibility[corner]) return [corner, !cornerPatches[corner]];
      const actual = cornerPatches[corner]?.rect;
      const expected = expectedCornerRects?.[corner];
      return [corner, Boolean(actual && expected
        && closeEnough(actual.left, expected.left)
        && closeEnough(actual.top, expected.top)
        && closeEnough(actual.right, expected.right)
        && closeEnough(actual.bottom, expected.bottom))];
    }));
    const expectedCornerArea = cornerNames.reduce((sum, corner) => (
      sum + (expectedCornerVisibility[corner]
        ? cornerRadii[corner].x * cornerRadii[corner].y
        : 0)
    ), 0);
    const expectedBackdropAreaFraction = clippedModal
      ? (Math.max(0, viewportArea - area(clippedModal)) + expectedCornerArea) / viewportArea
      : null;
    return {
      viewport,
      modal: clippedModal,
      modalContained: Boolean(clippedModal)
        && clippedModal.left >= -1 && clippedModal.right <= viewport.width + 1
        && clippedModal.top >= -1 && clippedModal.bottom <= viewport.height + 1,
      mobile: document.body.classList.contains('is-mobile'),
      blurred,
      edgeBands,
      cornerPatches,
      edgeBandAlignment: alignment,
      edgeBandsTrackModal: Object.values(alignment).every(Boolean),
      cornerPatchAlignment: cornerAlignment,
      cornerPatchesTrackModal: Object.values(cornerAlignment).every(Boolean),
      expectedBandVisibility,
      expectedCornerVisibility,
      backdropCount: backdrop.length,
      backdropViewportAreaFraction: backdrop.reduce(
        (sum, entry) => sum + entry.viewportAreaFraction,
        0,
      ),
      expectedBackdropAreaFraction,
      backdropAreaErrorFraction: expectedBackdropAreaFraction === null ? null : Math.abs(
        backdrop.reduce((sum, entry) => sum + entry.viewportAreaFraction, 0)
          - expectedBackdropAreaFraction
      ),
      declaredBlurArea: Number(document.querySelector('.scheduler-overlay')?.dataset.schedulerBlurArea || 0),
      backdropModalOverlapFraction: backdrop.reduce(
        (sum, entry) => sum + entry.modalIntersectionArea,
        0,
      ) / modalArea,
    };
  });
}

async function schedulerInputGeometry(modal) {
  return modal.evaluate((root) => {
    const sidebar = root.querySelector('.scheduler-sidebar');
    if (!sidebar) throw new Error('Scheduler sidebar is missing.');
    const results = sidebar.querySelector('.scheduler-results-section');
    if (results) sidebar.scrollTop = Math.max(0, results.offsetTop - 8);
    const sidebarRect = sidebar.getBoundingClientRect();
    const visibleCardPoints = Array.from(root.querySelectorAll('.scheduler-course'))
      .map((card) => card.getBoundingClientRect())
      .filter((rect) => (
        rect.width > 0 && rect.height > 0
        && rect.bottom > sidebarRect.top && rect.top < sidebarRect.bottom
      ))
      .slice(0, 16)
      .map((rect, index) => ({
        x: Math.max(sidebarRect.left + 8, Math.min(sidebarRect.right - 8, rect.left + rect.width * 0.55)),
        y: Math.max(sidebarRect.top + 8, Math.min(sidebarRect.bottom - 8, rect.top + rect.height * 0.5)),
        index,
      }));
    const fallback = {
      x: sidebarRect.left + sidebarRect.width * 0.55,
      y: sidebarRect.top + sidebarRect.height * 0.6,
    };
    return {
      point: visibleCardPoints[0] || fallback,
      points: visibleCardPoints.length > 1
        ? visibleCardPoints
        : [fallback, { x: fallback.x + 8, y: fallback.y + 4 }, { x: fallback.x - 8, y: fallback.y - 4 }],
      scrollTop: sidebar.scrollTop,
      scrollHeight: sidebar.scrollHeight,
      clientHeight: sidebar.clientHeight,
      distance: Math.max(400, Math.min(1800, sidebar.scrollHeight - sidebar.clientHeight)),
    };
  });
}

async function runSynthesizedInteraction(ctx, modal, hoverPreview) {
  if (!ctx.input || typeof ctx.input.synthesizeScroll !== 'function'
      || typeof ctx.input.sweepMouse !== 'function') {
    throw new TypeError(
      'Scheduler scenarios require ctx.input.synthesizeScroll(options) and ctx.input.sweepMouse(options).',
    );
  }
  await setHoverPreview(modal, hoverPreview);
  await settleAnimationFrames(ctx.page);
  const geometry = await schedulerInputGeometry(modal);
  const readMotionState = () => modal.locator('.scheduler-sidebar').evaluate((sidebar) => ({
    scrollTop: sidebar.scrollTop,
    previewBlocks: document.querySelectorAll('.scheduler-modal .scheduler-block.is-preview').length,
    hoverHighlights: document.querySelectorAll('.scheduler-modal .scheduler-block.is-hover-highlight').length,
  }));
  const before = await readMotionState();
  await ctx.input.sweepMouse({ points: geometry.points, durationMs: 450 });
  const afterFirstHover = await readMotionState();
  await ctx.input.synthesizeScroll({
    x: geometry.point.x,
    y: geometry.point.y,
    yDistance: geometry.distance,
    durationMs: 900,
    speed: 1400,
  });
  const afterDown = await readMotionState();
  await ctx.input.sweepMouse({ points: geometry.points.slice().reverse(), durationMs: 450 });
  const afterSecondHover = await readMotionState();
  await ctx.input.synthesizeScroll({
    x: geometry.point.x,
    y: geometry.point.y,
    yDistance: -geometry.distance,
    durationMs: 900,
    speed: 1400,
  });
  await settleAnimationFrames(ctx.page);
  const afterRoundtrip = await readMotionState();
  return {
    hoverPreview,
    input: geometry,
    before,
    afterFirstHover,
    afterDown,
    afterSecondHover,
    afterRoundtrip,
  };
}

module.exports = {
  id: 'scheduler',
  description: 'Profiles the filter-heavy Scheduler, synthesized scroll/hover work, and dynamic blur geometry.',
  tags: ['scheduler', 'interaction', 'scroll', 'hover', 'blur', 'critical'],

  async run(ctx) {
    assertScenarioContext(ctx, ['input']);
    const { page } = ctx;
    const navigationTimeout = Number(ctx.options?.navigationTimeout || 30_000);
    const phases = [];
    const invariants = [];
    await seedFixture(ctx, 'scheduler-heavy');

    let modal;
    await runPhase(ctx, phases, 'scheduler.open-and-settle', async () => {
      modal = await openScheduler(page, navigationTimeout);
      return {
        courseCards: await modal.locator('.scheduler-course').count(),
        elements: await modal.locator('*').count(),
      };
    });

    const expectedFilterToggleSelectors = [
      '.scheduler-toggle-prereq',
      '.scheduler-toggle-show-unmet-prereq',
      '.scheduler-toggle-details',
      '.scheduler-toggle-score',
      '.scheduler-toggle-hover-preview',
      '.scheduler-toggle-highlight',
      '.scheduler-toggle-show-blocked',
      '.scheduler-toggle-hide-taken',
    ];
    const filterStressPhase = await runPhase(ctx, phases, 'scheduler.search-and-filter-stress', async () => {
      const search = modal.locator('.scheduler-search');
      const samples = [];
      const toggles = [];
      for (const query of ['MATH', 'CS', 'ENS491', 'SPS', '']) {
        await waitForStableFingerprint(
          page,
          '.scheduler-modal',
          () => search.fill(query),
          {
            expected: { selector: '.scheduler-modal .scheduler-search', value: query },
            mutationSelector: '.scheduler-modal .scheduler-results',
            timeout: navigationTimeout,
          },
        );
        samples.push({ query, results: await modal.locator('.scheduler-course').count() });
      }
      const filterButton = modal.locator('.scheduler-filter-btn');
      await filterButton.click();
      const menu = modal.locator('.scheduler-filter-menu');
      await menu.waitFor({ state: 'visible' });
      for (const selector of expectedFilterToggleSelectors) {
        const control = menu.locator(selector);
        const count = await control.count();
        const disabled = count === 1 ? await control.isDisabled() : null;
        if (count !== 1 || disabled) {
          toggles.push({ selector, count, disabled, exercised: false, elapsedMs: null });
          continue;
        }
        const startedAt = performance.now();
        const initialChecked = await control.isChecked();
        const toggleRendersResults = selector !== '.scheduler-toggle-hover-preview';
        await waitForStableFingerprint(
          page,
          '.scheduler-modal',
          () => control.evaluate((node) => node.click()),
          {
            expected: { selector: `.scheduler-modal ${selector}`, checked: !initialChecked },
            mutationSelector: '.scheduler-modal .scheduler-results',
            requireMutation: toggleRendersResults,
            timeout: navigationTimeout,
          },
        );
        await waitForStableFingerprint(
          page,
          '.scheduler-modal',
          () => control.evaluate((node) => node.click()),
          {
            expected: { selector: `.scheduler-modal ${selector}`, checked: initialChecked },
            mutationSelector: '.scheduler-modal .scheduler-results',
            requireMutation: toggleRendersResults,
            timeout: navigationTimeout,
          },
        );
        toggles.push({
          selector,
          count,
          disabled,
          exercised: true,
          elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
        });
      }
      await waitForStableFingerprint(page, '.scheduler-modal', async () => {
        await search.fill('');
        if (await menu.isVisible()) await filterButton.click();
      }, {
        expected: [
          { selector: '.scheduler-modal .scheduler-search', value: '' },
          { selector: '.scheduler-modal .scheduler-filter-menu', hidden: true },
        ],
        mutationSelector: '.scheduler-modal .scheduler-results',
        requireMutation: false,
        timeout: navigationTimeout,
      });
      return { searches: samples, toggles };
    });
    const filterExercise = filterStressPhase.details?.toggles || [];
    await recordInvariant(
      ctx,
      invariants,
      'scheduler.every-filter-toggle-is-present-enabled-and-exercised',
      filterExercise.length === expectedFilterToggleSelectors.length
        && filterExercise.every((item) => item.count === 1 && !item.disabled && item.exercised),
      { expected: expectedFilterToggleSelectors, observed: filterExercise },
    );

    const previewOnPhase = await runPhase(ctx, phases, 'scheduler.scroll-hover-preview-on', async () => (
      runSynthesizedInteraction(ctx, modal, true)
    ));
    const previewOffPhase = await runPhase(ctx, phases, 'scheduler.scroll-hover-preview-off', async () => (
      runSynthesizedInteraction(ctx, modal, false)
    ));
    const previewOn = previewOnPhase.details;
    const previewOff = previewOffPhase.details;
    await recordInvariant(
      ctx,
      invariants,
      'scheduler.cdp-scroll-gesture-moves-the-sidebar',
      Math.abs(previewOn.afterDown.scrollTop - previewOn.before.scrollTop) > 1
        && Math.abs(previewOff.afterDown.scrollTop - previewOff.before.scrollTop) > 1,
      { previewOn, previewOff },
    );
    await recordInvariant(
      ctx,
      invariants,
      'scheduler.hover-preview-toggle-changes-rendered-preview-work',
      Math.max(previewOn.afterFirstHover.previewBlocks, previewOn.afterSecondHover.previewBlocks) > 0
        && Math.max(previewOff.afterFirstHover.previewBlocks, previewOff.afterSecondHover.previewBlocks) === 0,
      { previewOn, previewOff },
    );

    const initialBlurGeometry = await collectBlurGeometry(page);
    await recordInvariant(
      ctx,
      invariants,
      'scheduler.backdrop-does-not-cover-modal',
      initialBlurGeometry.backdropModalOverlapFraction <= 0.01,
      initialBlurGeometry,
    );
    await recordInvariant(
      ctx,
      invariants,
      'scheduler.blur-area-is-bounded-to-edges',
      initialBlurGeometry.backdropAreaErrorFraction <= 0.02,
      initialBlurGeometry,
    );
    await recordInvariant(
      ctx,
      invariants,
      'scheduler.edge-bands-track-modal-geometry',
      initialBlurGeometry.edgeBandsTrackModal,
      initialBlurGeometry,
    );
    await recordInvariant(
      ctx,
      invariants,
      'scheduler.corner-patches-track-rounded-modal-geometry',
      initialBlurGeometry.cornerPatchesTrackModal,
      initialBlurGeometry,
    );

    const originalViewport = page.viewportSize() || await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));
    const resizeViewport = originalViewport.width > 820
      ? { width: Math.max(821, originalViewport.width - 240), height: Math.max(600, originalViewport.height - 120) }
      : { width: Math.max(320, originalViewport.width - 40), height: Math.max(500, originalViewport.height - 40) };
    let resizedBlurGeometry;
    await runPhase(ctx, phases, 'scheduler.blur-geometry-resize', async () => {
      await page.setViewportSize(resizeViewport);
      await settleAnimationFrames(page, 3);
      resizedBlurGeometry = await collectBlurGeometry(page);
      await page.setViewportSize(originalViewport);
      await settleAnimationFrames(page, 3);
      return resizedBlurGeometry;
    });
    await recordInvariant(
      ctx,
      invariants,
      'scheduler.modal-remains-contained-after-resize',
      resizedBlurGeometry.modalContained,
      resizedBlurGeometry,
    );
    await recordInvariant(
      ctx,
      invariants,
      'scheduler.resized-backdrop-does-not-cover-modal',
      resizedBlurGeometry.backdropModalOverlapFraction <= 0.01
        && resizedBlurGeometry.edgeBandsTrackModal
        && resizedBlurGeometry.cornerPatchesTrackModal
        && resizedBlurGeometry.backdropAreaErrorFraction <= 0.02,
      resizedBlurGeometry,
    );

    let mobileBlurGeometry = resizedBlurGeometry.mobile ? resizedBlurGeometry : null;
    if (!mobileBlurGeometry) {
      await runPhase(ctx, phases, 'scheduler.blur-geometry-mobile-edge-to-edge', async () => {
        await page.setViewportSize({ width: 800, height: 600 });
        await waitForSchedulerLayout(page, true, navigationTimeout);
        mobileBlurGeometry = await collectBlurGeometry(page);
        await page.setViewportSize(originalViewport);
        await waitForSchedulerLayout(page, originalViewport.width <= 820, navigationTimeout);
        return mobileBlurGeometry;
      });
    }
    if (mobileBlurGeometry?.mobile) {
      await recordInvariant(
        ctx,
        invariants,
        'scheduler.edge-to-edge-mobile-has-no-blur-surface',
        mobileBlurGeometry.backdropViewportAreaFraction <= 0.01
          && mobileBlurGeometry.backdropModalOverlapFraction <= 0.01
          && mobileBlurGeometry.edgeBandsTrackModal
          && mobileBlurGeometry.cornerPatchesTrackModal,
        mobileBlurGeometry,
      );
    }

    await runPhase(ctx, phases, 'scheduler.close-and-cleanup', async () => {
      await modal.locator('.scheduler-close').click();
      await page.locator('.scheduler-overlay').waitFor({ state: 'detached' });
      await settleAnimationFrames(page, 3);
      return {
        overlays: await page.locator('.scheduler-overlay').count(),
        modals: await page.locator('.scheduler-modal').count(),
      };
    });
    const cleanup = await page.evaluate(() => ({
      overlays: document.querySelectorAll('.scheduler-overlay').length,
      modals: document.querySelectorAll('.scheduler-modal').length,
      schedulerBlurElements: Array.from(document.querySelectorAll('[class*="scheduler"]')).filter((node) => {
        const style = getComputedStyle(node);
        return /blur\((?!0(?:px)?\))/i.test(
          `${style.backdropFilter || style.webkitBackdropFilter || ''} ${style.filter || ''}`,
        );
      }).length,
    }));
    await recordInvariant(
      ctx,
      invariants,
      'scheduler.close-cleans-up-modal-and-blur-elements',
      cleanup.overlays === 0 && cleanup.modals === 0 && cleanup.schedulerBlurElements === 0,
      cleanup,
    );

    return {
      phases,
      invariants,
      metadata: { initialBlurGeometry, resizedBlurGeometry, mobileBlurGeometry, cleanup },
    };
  },
};

module.exports.collectBlurGeometry = collectBlurGeometry;
module.exports.clippedRect = clippedRect;
module.exports.openScheduler = openScheduler;
