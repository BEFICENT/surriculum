'use strict';

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, milliseconds)));
}

function finiteCoordinate(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${name} must be finite`);
  return number;
}

/**
 * Create compositor-level input helpers. These avoid Playwright's serialized
 * wheel loop, which can accidentally benchmark the driver instead of the app.
 */
function createCdpInput(cdp) {
  if (!cdp || typeof cdp.send !== 'function') throw new TypeError('a CDP session is required');

  async function synthesizeScroll(options = {}) {
    const x = finiteCoordinate(options.x, 'x');
    const y = finiteCoordinate(options.y, 'y');
    const xDistance = Number(options.xDistance || 0);
    const yDistance = Number(options.yDistance || 0);
    if (!Number.isFinite(xDistance) || !Number.isFinite(yDistance) || (!xDistance && !yDistance)) {
      throw new TypeError('synthesizeScroll requires a non-zero finite xDistance or yDistance');
    }
    const distance = Math.hypot(xDistance, yDistance);
    const durationMs = Number(options.durationMs || 0);
    const derivedSpeed = durationMs > 0 ? distance / (durationMs / 1000) : null;
    const speed = Number(options.speed || derivedSpeed || 800);
    await cdp.send('Input.synthesizeScrollGesture', {
      x,
      y,
      xDistance,
      yDistance,
      speed: Math.max(1, speed),
      gestureSourceType: options.gestureSourceType || 'mouse',
      repeatCount: Number.isInteger(options.repeatCount) ? options.repeatCount : 0,
      repeatDelayMs: Number.isFinite(options.repeatDelayMs) ? options.repeatDelayMs : 0,
      preventFling: options.preventFling !== false,
      interactionMarkerName: options.interactionMarkerName || 'surriculum-perf-scroll',
    });
  }

  async function moveMouse(point, options = {}) {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: finiteCoordinate(point.x, 'x'),
      y: finiteCoordinate(point.y, 'y'),
      button: 'none',
      buttons: 0,
      pointerType: options.pointerType || 'mouse',
      modifiers: options.modifiers || 0,
    });
  }

  async function sweepMouse(options = {}) {
    const points = Array.isArray(options.points) ? options.points : [];
    if (!points.length) throw new TypeError('sweepMouse requires at least one point');
    const durationMs = Math.max(0, Number(options.durationMs || 0));
    const interval = points.length > 1 ? durationMs / (points.length - 1) : 0;
    for (let index = 0; index < points.length; index += 1) {
      await moveMouse(points[index], options);
      if (interval && index < points.length - 1) await delay(interval);
    }
  }

  async function dispatchWheel(options = {}) {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: finiteCoordinate(options.x, 'x'),
      y: finiteCoordinate(options.y, 'y'),
      deltaX: Number(options.deltaX || 0),
      deltaY: Number(options.deltaY || 0),
      modifiers: options.modifiers || 0,
      pointerType: 'mouse',
    });
  }

  return {
    dispatchWheel,
    moveMouse,
    scrollGesture: synthesizeScroll,
    sweepMouse,
    synthesizeScroll,
  };
}

module.exports = { createCdpInput };
