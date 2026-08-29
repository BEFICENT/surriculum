'use strict';

const { performance } = require('node:perf_hooks');

function assertScenarioContext(ctx, requirements = []) {
  if (!ctx || !ctx.page) throw new TypeError('Performance scenarios require ctx.page.');
  for (const requirement of requirements) {
    if (!ctx[requirement]) throw new TypeError(`Performance scenario requires ctx.${requirement}.`);
  }
}

function targetUrl(ctx) {
  if (typeof ctx.target === 'string') return ctx.target;
  if (ctx.target && typeof ctx.target.url === 'string') return ctx.target.url;
  if (ctx.options && typeof ctx.options.url === 'string') return ctx.options.url;
  throw new TypeError('ctx.target must be a URL string or an object with a url property.');
}

async function runPhase(ctx, phases, name, action) {
  const handle = typeof ctx.beginPhase === 'function' ? await ctx.beginPhase(name) : null;
  const startedAt = performance.now();
  let details = null;
  let failure = null;
  try {
    details = await action();
    const result = {
      name,
      elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
      details: details === undefined ? null : details,
    };
    phases.push(result);
    return result;
  } catch (error) {
    failure = {
      name: error?.name || 'Error',
      message: error?.message || String(error),
    };
    throw error;
  } finally {
    if (typeof ctx.endPhase === 'function') {
      await ctx.endPhase(handle, failure ? { error: failure } : details);
    }
  }
}

async function recordInvariant(ctx, invariants, name, pass, details = {}) {
  const item = { name, pass: Boolean(pass), details };
  invariants.push(item);
  if (typeof ctx.recordInvariant === 'function') {
    await ctx.recordInvariant(name, item.pass, details);
  }
  return item.pass;
}

async function seedFixture(ctx, name, options = {}) {
  if (!ctx.fixtures || typeof ctx.fixtures.seed !== 'function') {
    throw new TypeError('ctx.fixtures.seed(name) is required by performance scenarios.');
  }
  const navigationTimeout = Number(ctx.options?.navigationTimeout || 30_000);
  if (!ctx.page.url() || ctx.page.url() === 'about:blank') {
    await ctx.page.goto(targetUrl(ctx), {
      waitUntil: 'domcontentloaded',
      timeout: navigationTimeout,
    });
    await waitForAppShell(ctx.page, navigationTimeout);
  }
  return ctx.fixtures.seed(name, options);
}

async function settleAnimationFrames(page, count = 2) {
  await page.evaluate((frames) => new Promise((resolve) => {
    let remaining = Math.max(1, frames);
    const next = () => {
      remaining -= 1;
      if (remaining <= 0) resolve();
      else requestAnimationFrame(next);
    };
    requestAnimationFrame(next);
  }), count);
}

async function waitForAppShell(page, timeout = 30_000) {
  await page.waitForFunction(() => (
    document.readyState !== 'loading'
      && Boolean(document.querySelector('.app .main-content'))
      && Boolean(window.planStorage && window.planStorage.importPlanObject)
  ), null, { timeout });
}

async function waitForPlan(page, expectedCourses, expectedSemesters, timeout = 30_000) {
  await page.waitForFunction(({ courses, semesters }) => {
    const rows = window.curriculum && Array.isArray(window.curriculum.semesters)
      ? window.curriculum.semesters : null;
    return Boolean(rows)
      && rows.length === semesters
      && rows.reduce((sum, row) => sum + (row.courses || []).length, 0) === courses
      && document.querySelectorAll('.container_semester').length === semesters
      && document.querySelectorAll('.container_semester .course').length === courses;
  }, { courses: expectedCourses, semesters: expectedSemesters }, { timeout });
}

async function waitForStableFingerprint(page, rootSelector, action, options = {}) {
  if (typeof action !== 'function') {
    throw new TypeError('waitForStableFingerprint requires an action function.');
  }
  const timeout = Number(options.timeout || 15_000);
  const quietMs = Math.max(0, Number(options.quietMs ?? 120));
  const stableFrames = Math.max(1, Number(options.stableFrames ?? 2));
  const mutationSelector = String(options.mutationSelector || rootSelector);
  const requireMutation = options.requireMutation !== false;
  const expected = options.expected || null;

  // Arm the observer before the interaction. A fresh token prevents a later
  // action from inheriting a previous action's stable-frame count, while the
  // scoped MutationObserver catches synchronous renders that finish before the
  // Playwright action promise resolves.
  const token = await page.evaluate(({ selector, observedSelector }) => {
    const registryKey = '__surriculumPerfStabilityWaits';
    const sequenceKey = '__surriculumPerfStabilitySequence';
    const registry = window[registryKey] instanceof Map
      ? window[registryKey] : new Map();
    window[registryKey] = registry;
    window[sequenceKey] = Number(window[sequenceKey] || 0) + 1;
    const observationToken = `wait-${window[sequenceKey]}`;
    const readFingerprint = (root) => {
      if (!root) return 'missing';
      const optionsFound = root.querySelectorAll('.course-option, .scheduler-course');
      const loading = /\bloading\b/i.test(String(root.textContent || ''));
      return [
        optionsFound.length,
        root.querySelectorAll('*').length,
        root.scrollHeight,
        root.scrollWidth,
        loading ? 1 : 0,
      ].join('|');
    };
    const now = performance.now();
    const state = {
      selector,
      observedSelector,
      readFingerprint,
      lastFingerprint: readFingerprint(document.querySelector(selector)),
      lastChangeAt: now,
      mutationCount: 0,
      quietFrames: 0,
      observer: null,
    };
    const touches = (node, target) => {
      if (!node || !target) return false;
      if (node === target) return true;
      try {
        return Boolean(
          (typeof node.contains === 'function' && node.contains(target))
          || (typeof target.contains === 'function' && target.contains(node))
        );
      } catch (_) {
        return false;
      }
    };
    state.observer = new MutationObserver((records) => {
      const observedRoot = document.querySelector(state.observedSelector);
      if (!observedRoot) return;
      const relevant = records.some((record) => {
        if (record.target === observedRoot
            || (typeof observedRoot.contains === 'function'
              && observedRoot.contains(record.target))) return true;
        return [...(record.addedNodes || []), ...(record.removedNodes || [])]
          .some((node) => touches(node, observedRoot));
      });
      if (!relevant) return;
      state.mutationCount += 1;
      state.lastChangeAt = performance.now();
      state.quietFrames = 0;
    });
    state.observer.observe(document.documentElement, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
    registry.set(observationToken, state);
    return observationToken;
  }, { selector: rootSelector, observedSelector: mutationSelector });

  let failure = null;
  try {
    await action();
    await page.waitForFunction((args) => {
      const registry = window.__surriculumPerfStabilityWaits;
      const state = registry instanceof Map ? registry.get(args.token) : null;
      if (!state) return false;
      const root = document.querySelector(args.selector);
      if (!root) {
        state.quietFrames = 0;
        return false;
      }

      const fingerprint = state.readFingerprint(root);
      if (fingerprint !== state.lastFingerprint) {
        state.lastFingerprint = fingerprint;
        state.lastChangeAt = performance.now();
        state.quietFrames = 0;
      }

      const matchesExpected = (condition) => {
        if (!condition) return true;
        if (Array.isArray(condition)) return condition.every(matchesExpected);
        const nodes = Array.from(document.querySelectorAll(condition.selector));
        if (Object.prototype.hasOwnProperty.call(condition, 'count')) {
          if (nodes.length !== Number(condition.count)) return false;
        }
        if (Object.prototype.hasOwnProperty.call(condition, 'minCount')) {
          if (nodes.length < Number(condition.minCount)) return false;
        }
        if (!nodes.length) return false;
        const node = nodes[0];
        if (Object.prototype.hasOwnProperty.call(condition, 'value')
            && String(node.value ?? '') !== String(condition.value)) return false;
        if (Object.prototype.hasOwnProperty.call(condition, 'checked')
            && Boolean(node.checked) !== Boolean(condition.checked)) return false;
        if (Object.prototype.hasOwnProperty.call(condition, 'hidden')
            && Boolean(node.hidden) !== Boolean(condition.hidden)) return false;
        if (Object.prototype.hasOwnProperty.call(condition, 'attribute')
            && String(node.getAttribute(condition.attribute) ?? '')
              !== String(condition.attributeValue ?? '')) return false;
        return true;
      };

      const loading = /\bloading\b/i.test(String(root.textContent || ''));
      const mutationSatisfied = !args.requireMutation || state.mutationCount > 0;
      const quietFor = performance.now() - state.lastChangeAt;
      if (loading || !mutationSatisfied || !matchesExpected(args.expected)
          || quietFor < args.quietMs) {
        state.quietFrames = 0;
        return false;
      }
      state.quietFrames += 1;
      return state.quietFrames >= args.stableFrames;
    }, {
      token,
      selector: rootSelector,
      expected,
      quietMs,
      requireMutation,
      stableFrames,
    }, { polling: 'raf', timeout });
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    try {
      await page.evaluate((observationToken) => {
        const registry = window.__surriculumPerfStabilityWaits;
        const state = registry instanceof Map ? registry.get(observationToken) : null;
        if (state && state.observer) state.observer.disconnect();
        if (registry instanceof Map) registry.delete(observationToken);
      }, token);
    } catch (cleanupError) {
      // A navigation or crashed action can destroy the execution context. Keep
      // its primary error instead of replacing it with observer-cleanup noise.
      if (!failure) throw cleanupError;
    }
  }
}

async function collectPageSnapshot(page) {
  return page.evaluate(() => {
    const semesters = window.curriculum && Array.isArray(window.curriculum.semesters)
      ? window.curriculum.semesters : [];
    return {
      readyState: document.readyState,
      domNodes: document.querySelectorAll('*').length,
      renderedSemesters: document.querySelectorAll('.container_semester').length,
      renderedCourses: document.querySelectorAll('.container_semester .course').length,
      modelSemesters: semesters.length,
      modelCourses: semesters.reduce((sum, semester) => sum + (semester.courses || []).length, 0),
      schedulerOverlays: document.querySelectorAll('.scheduler-overlay').length,
      summaryOverlays: document.querySelectorAll('.summary_modal_overlay').length,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        dpr: window.devicePixelRatio,
      },
      documentOverflow: {
        x: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        y: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      },
    };
  });
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
}

function summarizeDurations(values) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return { count: 0, medianMs: null, p95Ms: null, worstMs: null };
  return {
    count: finite.length,
    medianMs: Number(percentile(finite, 0.5).toFixed(2)),
    p95Ms: Number(percentile(finite, 0.95).toFixed(2)),
    worstMs: Number(Math.max(...finite).toFixed(2)),
  };
}

module.exports = {
  assertScenarioContext,
  collectPageSnapshot,
  percentile,
  recordInvariant,
  runPhase,
  seedFixture,
  settleAnimationFrames,
  summarizeDurations,
  targetUrl,
  waitForAppShell,
  waitForPlan,
  waitForStableFingerprint,
};
