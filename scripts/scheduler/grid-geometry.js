// Scheduler grid geometry, scale, and pointer-coordinate helpers.
(function (root) {
  'use strict';

  function createGridGeometry(options) {
    const config = options || {};
    const window = config.window || root;
    const document = config.document || (window && window.document);
    const body = config.body;
    const modal = config.modal;
    const schedulerGridEl = config.schedulerGridElement;
    const DAYS = config.days;
    const DAY_START_MIN = Number(config.dayStartMin);
    const DISPLAY_END_MIN = Number(config.displayEndMin);
    const GRID_MAX_END_MIN = Number(config.gridMaxEndMin);
    const minutesToLabel = config.minutesToLabel;
    const isDisposed = typeof config.isDisposed === 'function' ? config.isDisposed : () => false;
    if (!window || !document || !body || !modal || !Array.isArray(DAYS)
        || typeof minutesToLabel !== 'function') {
      throw new TypeError('Scheduler grid geometry dependencies are incomplete.');
    }
    const requestAnimationFrame = (callback) => window.requestAnimationFrame(callback);
    const getComputedStyle = (element) => window.getComputedStyle(element);
    // These are the invariant values declared by `.scheduler-grid`. Mobile
    // landscape overrides them at runtime, but desktop never does. Keeping the
    // desktop snapshot here avoids forcing layout for the whole freshly-mounted
    // planner merely to recover constants that are already known.
    const baseSchedulerLayout = Object.freeze({
      pxPerMin: 1.05,
      topGapPx: 14,
      blockGapPx: 6,
    });
    let currentGridEndMin = DISPLAY_END_MIN;
    let scrollbarCompensationFrame = 0;
    let schedulerLayoutCache = null;
    let onWinResize = null;

    const updateScrollbarCompensation = () => {
      try {
        if (isDisposed() || !body.isConnected || !schedulerGridEl) return;
        const sbw = Math.max(0, (schedulerGridEl.offsetWidth || 0) - (schedulerGridEl.clientWidth || 0));
        const nextValue = `${sbw}px`;
        if (body.style.getPropertyValue('--scheduler-scrollbar-w') !== nextValue) {
          body.style.setProperty('--scheduler-scrollbar-w', nextValue);
        }
      } catch (_) {}
    };
    const scheduleScrollbarCompensation = () => {
      if (isDisposed() || scrollbarCompensationFrame) return;
      try {
        scrollbarCompensationFrame = requestAnimationFrame(() => {
          scrollbarCompensationFrame = 0;
          updateScrollbarCompensation();
        });
      } catch (_) {
        scrollbarCompensationFrame = 0;
        updateScrollbarCompensation();
      }
    };
    const invalidateSchedulerLayout = () => {
      schedulerLayoutCache = null;
      scheduleScrollbarCompensation();
    };
    try { modal.__invalidateSchedulerLayout = invalidateSchedulerLayout; } catch (_) {}
    scheduleScrollbarCompensation();
    onWinResize = () => invalidateSchedulerLayout();
    try { window.addEventListener('resize', onWinResize); } catch (_) {}

    const getSchedulerLayout = () => {
      try {
        const appBody = document.body;
        if (appBody && appBody.classList && !appBody.classList.contains('is-mobile')) {
          return baseSchedulerLayout;
        }
      } catch (_) {}
      if (schedulerLayoutCache) return schedulerLayoutCache;
      let pxPerMin = baseSchedulerLayout.pxPerMin;
      let topGapPx = baseSchedulerLayout.topGapPx;
      let blockGapPx = baseSchedulerLayout.blockGapPx;
      try {
        const gridEl = schedulerGridEl;
        if (gridEl) {
          const gridStyle = getComputedStyle(gridEl);
          const mm = gridStyle.getPropertyValue('--scheduler-minute');
          const mmN = parseFloat(String(mm || '').trim());
          if (Number.isFinite(mmN) && mmN > 0) pxPerMin = mmN;
          const tg = gridStyle.getPropertyValue('--scheduler-top-gap');
          const tgN = parseFloat(String(tg || '').trim());
          if (Number.isFinite(tgN) && tgN >= 0) topGapPx = tgN;
          const bg = gridStyle.getPropertyValue('--scheduler-block-gap');
          const bgN = parseFloat(String(bg || '').trim());
          if (Number.isFinite(bgN) && bgN >= 0) blockGapPx = bgN;
        }
      } catch (_) {}
      schedulerLayoutCache = Object.freeze({ pxPerMin, topGapPx, blockGapPx });
      return schedulerLayoutCache;
    };

    const setBlockPosition = (el, startMin, endMin, schedulerLayout) => {
      try {
        const { pxPerMin, topGapPx, blockGapPx } = schedulerLayout || getSchedulerLayout();
        const topMin = Math.max(0, startMin - DAY_START_MIN);
        const durMin = Math.max(8, endMin - startMin);
        const topPx = topGapPx + (topMin * pxPerMin) + blockGapPx;
        const heightPx = Math.max(8, (durMin * pxPerMin) - (blockGapPx * 2));
        el.style.top = `${topPx}px`;
        el.style.height = `${heightPx}px`;
      } catch (_) {}
    };

    // Visual-only: SU schedules usually use 50-minute classes with 10-minute breaks.
    // To match the hour guidelines (every 60 minutes starting at 08:40),
    // we extend those 50-minute blocks to the next hour line.
    const snapUpToHourLine = (min) => {
      try {
        const rel = min - DAY_START_MIN;
        const k = Math.ceil(rel / 60);
        return DAY_START_MIN + (k * 60);
      } catch (_) {
        return min;
      }
    };
    const getDisplayRange = (startMin, endMin) => {
      const s = Number(startMin);
      const e = Number(endMin);
      if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return { start: startMin, end: endMin };
      const dur = e - s;
      // Only stretch "standard" 50-minute blocks to avoid distorting other patterns.
      if (dur === 50 || (s % 60 === 40 && e % 60 === 30)) {
        const ee = snapUpToHourLine(e);
        if (ee > e && ee <= currentGridEndMin) return { start: s, end: ee };
      }
      return { start: s, end: e };
    };

    // Render the visible time scale. The base grid ends at 19:40; selected or
    // previewed late meetings can temporarily extend it in hour-sized steps.
    const timesEl = body.querySelector('.scheduler-times');
    const cols = body.querySelectorAll('.scheduler-day-col');
    const renderTimeGrid = (requestedEndMin) => {
      try {
        // Snapshot the CSS metrics before changing grid DOM. Reading computed
        // style after the writes below would synchronously flush the whole modal.
        const { pxPerMin, topGapPx } = getSchedulerLayout();
        const safeEnd = Math.max(DISPLAY_END_MIN, Math.min(GRID_MAX_END_MIN, Number(requestedEndMin) || DISPLAY_END_MIN));
        currentGridEndMin = safeEnd;
        const totalMins = Math.max(60, safeEnd - DAY_START_MIN);
        const hourSlots = Math.max(1, Math.ceil(totalMins / 60));
        if (schedulerGridEl) schedulerGridEl.style.setProperty('--scheduler-total-minutes', String(totalMins));

        if (timesEl) {
          timesEl.innerHTML = '';
          for (let i = 0; i < hourSlots; i++) {
            const row = document.createElement('div');
            row.className = 'scheduler-time-row';
            row.textContent = minutesToLabel(DAY_START_MIN + i * 60);
            timesEl.appendChild(row);
          }
        }

        cols.forEach((col) => {
          col.querySelectorAll('.scheduler-hour-line').forEach(line => line.remove());
          for (let i = 0; i <= hourSlots; i++) {
            const line = document.createElement('div');
            line.className = 'scheduler-hour-line';
            line.style.top = `${topGapPx + (i * 60 * pxPerMin)}px`;
            col.insertBefore(line, col.firstChild);
          }
        });
        scheduleScrollbarCompensation();
      } catch (_) {}
    };
    renderTimeGrid(DISPLAY_END_MIN);

    // Coordinate helpers used by the controller's blocked-hours interaction.
    const getPxPerMinute = () => {
      try {
        return getSchedulerLayout().pxPerMin;
      } catch (_) {
        return 1.05;
      }
    };
    const snapToHour = (min) => {
      // Snap DOWN to the hour cell that contains the pointer, not "nearest".
      // This avoids a click in the lower half of an hour selecting the next cell.
      const rel = min - DAY_START_MIN;
      const snapped = DAY_START_MIN + Math.floor(rel / 60) * 60;
      const maxStart = currentGridEndMin - 60;
      return Math.max(DAY_START_MIN, Math.min(maxStart, snapped));
    };
    const snapRange = (a, b) => {
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const start = DAY_START_MIN + Math.floor((lo - DAY_START_MIN) / 60) * 60;
      const end = DAY_START_MIN + Math.ceil((hi - DAY_START_MIN) / 60) * 60;
      const maxStart = currentGridEndMin - 60;
      const s = Math.max(DAY_START_MIN, Math.min(maxStart, start));
      const e = Math.max(s + 60, Math.min(currentGridEndMin, end));
      return { start: s, end: e };
    };

    const pointerYToMinute = (clientY) => {
      try {
        const { pxPerMin, topGapPx } = getSchedulerLayout();
        if (!schedulerGridEl) return DAY_START_MIN;
        const gridRect = schedulerGridEl.getBoundingClientRect();
        const scrollTop = schedulerGridEl.scrollTop || 0;
        const y = (clientY - gridRect.top) + scrollTop;
        return DAY_START_MIN + ((y - topGapPx) / pxPerMin);
      } catch (_) {
        return DAY_START_MIN;
      }
    };

    const dispose = () => {
      try { if (onWinResize) window.removeEventListener('resize', onWinResize); } catch (_) {}
      if (scrollbarCompensationFrame) {
        try { window.cancelAnimationFrame(scrollbarCompensationFrame); } catch (_) {}
        scrollbarCompensationFrame = 0;
      }
      schedulerLayoutCache = null;
      try { delete modal.__invalidateSchedulerLayout; } catch (_) {}
    };

    return Object.freeze({
      dayColumns: cols,
      dispose,
      invalidateSchedulerLayout,
      getSchedulerLayout,
      setBlockPosition,
      getDisplayRange,
      renderTimeGrid,
      scheduleScrollbarCompensation,
      snapToHour,
      snapRange,
      pointerYToMinute,
      getCurrentGridEndMin: () => currentGridEndMin,
    });
  }

  const api = Object.freeze({ createGridGeometry });
  if (root) root.SurriculumSchedulerGridGeometry = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
