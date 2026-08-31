// Scheduler grid, blocked-hours, and preview rendering controller.
(function installSchedulerGridController(root) {
  'use strict';

  const schedulerGridGeometry = (root && root.SurriculumSchedulerGridGeometry)
    || (typeof module !== 'undefined' && module.exports ? require('./grid-geometry.js') : null);
  const schedulerGridAvailability = (root && root.SurriculumSchedulerGridAvailability)
    || (typeof module !== 'undefined' && module.exports ? require('./grid-availability.js') : null);
  if (!schedulerGridGeometry || !schedulerGridAvailability) {
    throw new Error('Scheduler grid helper modules are not loaded.');
  }

  function createGridController(options) {
    const config = options || {};
    const foundation = config.foundation;
    const session = config.session;
    const meeting = config.meeting;
    const body = config.body;
    const modal = config.modal;
    if (!foundation || !session || !meeting || !body || !modal) {
      throw new TypeError('Scheduler grid controller requires foundation, session, meeting tools, body, and modal.');
    }

    const window = config.window || root;
    const document = config.document || window.document;
    const {
      DAYS,
      DAY_START_MIN,
      normalizeCourseId,
      minutesToLabel,
      hslFromString,
      loadTermScheduleIndex,
      createPickerModal,
      saveSchedulerState,
    } = foundation;
    const {
      dateWindowsOverlapOnDay,
      getSectionIntervals,
      sectionHasIncompleteMeetingData,
    } = meeting;
    const termCode = String(config.termCode || '');
    const DISPLAY_END_MIN = Number(config.displayEndMin);
    const GRID_MAX_END_MIN = Number(config.gridMaxEndMin);
    const escapeHtml = config.escapeHtml;
    const shouldHoverPreview = config.shouldHoverPreview;
    const shouldHighlightAvailability = config.shouldHighlightAvailability;
    const shouldShowBlockedCourses = config.shouldShowBlockedCourses;
    const computeTakenBeforeCurrentTermSet = config.computeTakenBeforeCurrentTermSet;
    const normalizePlannerCode = config.normalizePlannerCode;
    const getCoreqsFor = (...args) => config.getCoreqsFor(...args);
    const computeBundleClosure = (...args) => config.computeBundleClosure(...args);
    const pickSectionForCourse = (...args) => config.pickSectionForCourse(...args);
    const openCourseDetailsModal = (...args) => config.openCourseDetailsModal(...args);
    const removeSelectionFromGrid = (...args) => config.removeSelectionFromGrid(...args);
    const renderResults = (...args) => config.renderResults(...args);
    const getLastQuery = () => config.getLastQuery();
    const getSelected = () => session.selected || {};
    const getBlocked = () => session.blocked || [];
    const getScheduleIndex = () => session.scheduleIndex || null;
    const getMissingByCourse = () => session.missingByCourse || {};
    const requestAnimationFrame = (callback) => window.requestAnimationFrame(callback);
    const getComputedStyle = (element) => window.getComputedStyle(element);
    const CustomEvent = window.CustomEvent;

    if (!Array.isArray(DAYS)
        || typeof escapeHtml !== 'function'
        || typeof getSectionIntervals !== 'function'
        || typeof renderResults !== 'function') {
      throw new TypeError('Scheduler grid controller dependencies are incomplete.');
    }

    const schedulerGridEl = body.querySelector('.scheduler-grid');
    const selectedEl = body.querySelector('.scheduler-selected');
    const resultsEl = body.querySelector('.scheduler-results');
    const blockedListEl = body.querySelector('.scheduler-blocked-list');
    const blockedToggleBtn = body.querySelector('.scheduler-blocked-toggle');
    const blockedClearBtn = body.querySelector('.scheduler-blocked-clear');
    const blockModeBtn = config.blockModeButton || null;
    let activePreviewIntervals = [];
    let onDocMouseUp = null;
    let disposed = false;
    let blockMode = false;
    let blockDrag = null; // { dayKey, startMin, ghostEl, col, _range? }

    const geometry = schedulerGridGeometry.createGridGeometry({
      window,
      document,
      body,
      modal,
      schedulerGridElement: schedulerGridEl,
      days: DAYS,
      dayStartMin: DAY_START_MIN,
      displayEndMin: DISPLAY_END_MIN,
      gridMaxEndMin: GRID_MAX_END_MIN,
      minutesToLabel,
      isDisposed: () => disposed,
    });
    const {
      dayColumns: cols,
      invalidateSchedulerLayout,
      getSchedulerLayout,
      setBlockPosition,
      getDisplayRange,
      renderTimeGrid,
      scheduleScrollbarCompensation,
      snapToHour,
      snapRange,
      pointerYToMinute,
    } = geometry;

    const availability = schedulerGridAvailability.createGridAvailability({
      DAYS,
      DAY_START_MIN,
      DISPLAY_END_MIN,
      GRID_MAX_END_MIN,
      body,
      modal,
      schedulerGridElement: schedulerGridEl,
      blockedListElement: blockedListEl,
      blockedToggleButton: blockedToggleBtn,
      blockModeButton: blockModeBtn,
      session,
      termCode,
      normalizeCourseId,
      minutesToLabel,
      escapeHtml,
      saveSchedulerState,
      getBlocked,
      getSelected,
      getSectionIntervals,
      sectionHasIncompleteMeetingData,
      shouldHighlightAvailability,
      shouldShowBlockedCourses,
      dateWindowsOverlapOnDay,
      getCoreqsFor,
      renderTimeGrid,
      CustomEvent,
      getActivePreviewIntervals: () => activePreviewIntervals,
      getBlockMode: () => blockMode,
      setBlockModeState: (value) => { blockMode = !!value; },
    });
    const {
      getBlockedByDay,
      mergeBlockedIntervalsForDay,
      setBlocked,
      renderBlocked,
      setBlockMode,
      canFitWithBlockedHours,
      isGridRenderableInterval,
      updateGridExtent,
      intervalsOverlap,
      countIntervalOverlaps,
      getOccupiedByDayFromSelected,
      sectionAvailabilityClasses,
      getRequiredBundleCourseIds,
      pickBestBundleSections,
    } = availability;



    const startBlockDrag = (e, col) => {
      if (!blockMode) return;
      if (!col) return;
      try {
        if (e.target && e.target.closest && e.target.closest('.scheduler-block-bg')) return;
      } catch (_) {}
      e.preventDefault();
      e.stopPropagation();
      const dayKey = col.getAttribute('data-day') || '';
      if (!dayKey) return;
      const min = pointerYToMinute(e.clientY);
      const { pxPerMin, blockGapPx } = getSchedulerLayout();
      const startMin = snapToHour(min);

      const ghost = document.createElement('div');
      ghost.className = 'scheduler-block is-preview is-blocked scheduler-block-ghost';
      ghost.innerHTML = `<div class="scheduler-block-title">Blocking</div>` +
        `<div class="scheduler-block-time">${escapeHtml(minutesToLabel(startMin))}–${escapeHtml(minutesToLabel(startMin + 60))}</div>`;
      col.appendChild(ghost);

      blockDrag = { dayKey, startMin, startY: 0, ghostEl: ghost, col };
      setBlockPosition(ghost, startMin, startMin + 60);
      try {
        // Ensure a consistent gap inside the hour lines for the ghost block.
        ghost.style.height = `${Math.max(8, (60 * pxPerMin) - (blockGapPx * 2))}px`;
      } catch (_) {}
    };

    const updateBlockDrag = (e) => {
      if (!blockDrag || !blockDrag.ghostEl) return;
      const min = pointerYToMinute(e.clientY);
      const { start, end } = snapRange(blockDrag.startMin, min);
      setBlockPosition(blockDrag.ghostEl, start, end);
      blockDrag.ghostEl.innerHTML = `<div class="scheduler-block-title">Blocking</div>` +
        `<div class="scheduler-block-time">${escapeHtml(minutesToLabel(start))}–${escapeHtml(minutesToLabel(end))}</div>`;
      blockDrag._range = { start, end };
    };

    const finishBlockDrag = async (e) => {
      if (!blockDrag) return;
      const range = blockDrag._range || { start: blockDrag.startMin, end: blockDrag.startMin + 60 };
      try { if (blockDrag.ghostEl) blockDrag.ghostEl.remove(); } catch (_) {}
      const dayKey = blockDrag.dayKey;
      blockDrag = null;
      const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const nextList = (Array.isArray(getBlocked()) ? getBlocked().slice() : []);
      nextList.push({ id, dayKey, start: range.start, end: range.end });
      // Merge per-day to keep it tidy.
      const merged = [];
      const byDay = {};
      nextList.forEach(b => {
        const dk = String(b.dayKey || '');
        byDay[dk] = byDay[dk] || [];
        byDay[dk].push(b);
      });
      for (const dk of Object.keys(byDay)) {
        merged.push(...mergeBlockedIntervalsForDay(dk, byDay[dk]));
      }
      setBlocked(merged);
      renderBlocked();
      try {
        const idx = getScheduleIndex() || await loadTermScheduleIndex(termCode);
        if (idx) {
          session.scheduleIndex = idx;
          renderGrid(idx);
          renderResults(idx, getLastQuery());
        }
      } catch (_) {}
    };

    cols.forEach((col) => {
      col.addEventListener('mousedown', (e) => startBlockDrag(e, col));
      col.addEventListener('mousemove', (e) => updateBlockDrag(e));
    });
    onDocMouseUp = (e) => finishBlockDrag(e);
    document.addEventListener('mouseup', onDocMouseUp);


    const removePreviewBlocks = () => {
      try { body.querySelectorAll('.scheduler-block.is-preview').forEach(el => el.remove()); } catch (_) {}
    };

    const clearPreviewBlocks = (schedulerLayout) => {
      removePreviewBlocks();
      activePreviewIntervals = [];
      try { updateGridExtent(getScheduleIndex()); } catch (_) {}
      try { renderBlockedBackground(schedulerLayout); } catch (_) {}
    };

    const clearHoverHighlights = () => {
      try { body.querySelectorAll('.scheduler-block.is-hover-highlight').forEach(el => el.classList.remove('is-hover-highlight')); } catch (_) {}
    };

    const applyHoverHighlightForCourses = (courseIds) => {
      clearHoverHighlights();
      try {
        const set = courseIds instanceof Set ? courseIds : new Set(Array.isArray(courseIds) ? courseIds : []);
        if (!set.size) return;
        body.querySelectorAll('.scheduler-block').forEach((el) => {
          if (el.classList.contains('is-preview')) return;
          const cid = normalizeCourseId(el.getAttribute('data-course') || '');
          if (cid && set.has(cid)) el.classList.add('is-hover-highlight');
        });
      } catch (_) {}
    };

    const renderPreviewForCourse = (idx, baseCourseId, forcedSection, options) => {
      const selected = getSelected();
      let takenBeforeCurrentSet = session.takenBeforeCurrentSet;
      const schedulerLayout = getSchedulerLayout();
      clearPreviewBlocks(schedulerLayout);
      try {
        if (!idx || !baseCourseId) return;
        if (!(options && options.ignoreHoverPreference) && !shouldHoverPreview()) return;
        const cid = normalizeCourseId(baseCourseId);
        if (!cid) return;
        try {
          // For hover previews, only treat "taken" as "completed in previous terms".
          // Courses that are just in the current-term plan should still preview.
          if (!(takenBeforeCurrentSet instanceof Set)) {
            takenBeforeCurrentSet = computeTakenBeforeCurrentTermSet();
            session.takenBeforeCurrentSet = takenBeforeCurrentSet;
          }
          if (takenBeforeCurrentSet instanceof Set
            && takenBeforeCurrentSet.has(normalizePlannerCode(cid))) return;
        } catch (_) {}
        if (selected[cid] && !forcedSection) return;

        const bundle = forcedSection ? [cid] : getRequiredBundleCourseIds(idx, cid);
        if (!bundle.length) return;

        const baseOcc = getOccupiedByDayFromSelected(idx, { includeBlocked: true });
        if (forcedSection) {
          try {
            Object.keys(baseOcc || {}).forEach((dayKey) => {
              baseOcc[dayKey] = (baseOcc[dayKey] || []).filter(it => normalizeCourseId(it && it.course_id) !== cid);
            });
          } catch (_) {}
        }
        const picked = {};
        if (forcedSection && forcedSection.crn) {
          picked[cid] = forcedSection;
        } else {
          const best = pickBestBundleSections(idx, bundle, baseOcc);
          if (!best || !best.picked) return;
          Object.assign(picked, best.picked);
        }
        const previewItems = [];
        for (let i = 0; i < bundle.length; i++) {
          const courseId = bundle[i];
          const entry = idx.get(courseId);
          const sec = picked[courseId];
          if (!sec) continue;
          const color = hslFromString(courseId);
          const count = entry && Array.isArray(entry.sections) ? entry.sections.length : 0;
          const label = `${courseId}${sec.section ? `-${sec.section}` : ''}${sec.component ? ` • ${sec.component}` : ''}${count > 1 ? ` (${count} sections)` : ''}`;
          const intervals = getSectionIntervals(sec);
          for (let j = 0; j < intervals.length; j++) {
            const it = intervals[j];
            previewItems.push({ courseId, label, color, interval: it });
          }
        }

        activePreviewIntervals = previewItems.map(item => item.interval);
        updateGridExtent(idx);
        try { renderBlockedBackground(schedulerLayout); } catch (_) {}

        const previewBlocksByDay = {};
        DAYS.forEach(d => { previewBlocksByDay[d.key] = []; });
        for (let i = 0; i < previewItems.length; i++) {
          const item = previewItems[i];
          const courseId = item.courseId;
          const it = item.interval;
          if (!isGridRenderableInterval(it)) continue;
          const col = body.querySelector(`.scheduler-day-col[data-day="${it.dayKey}"]`);
          if (!col || col.hidden) continue;
          const block = document.createElement('div');
          block.className = 'scheduler-block is-preview';
          const dr = getDisplayRange(it.start, it.end);
          setBlockPosition(block, dr.start, dr.end, schedulerLayout);
          block.style.background = item.color;
          block.setAttribute('data-course', courseId);
          block.setAttribute('data-day', String(it.dayKey));
          block.setAttribute('data-start', String(it.start));
          block.setAttribute('data-end', String(it.end));
          block.setAttribute('data-display-start', String(dr.start));
          block.setAttribute('data-display-end', String(dr.end));
          block.setAttribute('data-date-count', String(Array.isArray(it.dateLabels) ? it.dateLabels.length : 0));
          try {
            const dates = Array.isArray(it.dateLabels) ? it.dateLabels.join(', ') : '';
            if (dates) block.setAttribute('title', `${item.label} • ${minutesToLabel(it.start)}–${minutesToLabel(it.end)} • ${dates}`);
          } catch (_) {}
          block.innerHTML = `<div class="scheduler-block-title">${escapeHtml(item.label)}</div>` +
            `<div class="scheduler-block-time">${escapeHtml(minutesToLabel(it.start))}–${escapeHtml(minutesToLabel(it.end))}</div>`;
          try {
            if (countIntervalOverlaps(it, baseOcc[it.dayKey] || []) > 0) block.classList.add('is-preview-conflict');
          } catch (_) {}
          col.appendChild(block);
          previewBlocksByDay[it.dayKey].push({ start: it.start, end: it.end, el: block });
        }
        // Date-specific phases may overlap in the weekly projection while
        // never occurring on the same calendar date. Keep every phase visible.
        layoutOverlaps(previewBlocksByDay);
      } catch (_) {
        clearPreviewBlocks();
      }
    };


    let hoverSelectedCourseId = '';
    let hoverResultCourseId = '';
    let hoverResultSection = null;

    const clearGridBlocks = () => {
      try {
        body.querySelectorAll('.scheduler-block').forEach(el => el.remove());
      } catch (_) {}
    };

    const renderBlockedBackground = (schedulerLayout) => {
      try {
        // Remove previous blocked backgrounds (keeps course blocks).
        body.querySelectorAll('.scheduler-block.scheduler-block-bg').forEach(el => el.remove());
      } catch (_) {}
      const byDay = getBlockedByDay();
      let blockLayout = schedulerLayout || null;
      for (const dayKey of Object.keys(byDay)) {
        const col = body.querySelector(`.scheduler-day-col[data-day="${dayKey}"]`);
        if (!col || col.hidden) continue;
        const list = byDay[dayKey] || [];
        for (let i = 0; i < list.length; i++) {
          const b = list[i];
          const start = b.start;
          const end = b.end;
          const visibleStart = Math.max(DAY_START_MIN, start);
          const visibleEnd = Math.min(geometry.getCurrentGridEndMin(), end);
          if (visibleEnd <= visibleStart) continue;
          const block = document.createElement('div');
          block.className = 'scheduler-block scheduler-block-bg is-blocked';
          try { if (b && b.id) block.setAttribute('data-block-id', String(b.id)); } catch (_) {}
          const dr = getDisplayRange(visibleStart, visibleEnd);
          if (!blockLayout) blockLayout = getSchedulerLayout();
          setBlockPosition(block, dr.start, dr.end, blockLayout);
          block.setAttribute('data-day', String(dayKey));
          block.setAttribute('data-start', String(start));
          block.setAttribute('data-end', String(end));
          block.setAttribute('data-display-start', String(dr.start));
          block.setAttribute('data-display-end', String(dr.end));
          block.innerHTML = `<div class="scheduler-block-title">Blocked</div>` +
            `<div class="scheduler-block-time">${escapeHtml(minutesToLabel(start))}–${escapeHtml(minutesToLabel(end))}</div>`;
          col.appendChild(block);
        }
      }
    };

    const applyBlockedConflictStyling = () => {
      try {
        body.querySelectorAll('.scheduler-block.is-blocked-conflict').forEach(el => el.classList.remove('is-blocked-conflict'));
      } catch (_) {}
      const byDay = getBlockedByDay();
      try {
        body.querySelectorAll('.scheduler-block[data-kind="course"]').forEach((el) => {
          const dayKey = el.getAttribute('data-day') || '';
          const start = Number(el.getAttribute('data-start'));
          const end = Number(el.getAttribute('data-end'));
          if (!dayKey || !Number.isFinite(start) || !Number.isFinite(end)) return;
          const blocks = byDay[dayKey] || [];
          for (let i = 0; i < blocks.length; i++) {
            const b = blocks[i];
            if (end <= b.start) break;
            if (start >= b.end) continue;
            el.classList.add('is-blocked-conflict');
            break;
          }
        });
      } catch (_) {}
    };

    const computeConflicts = (blocksByDay) => {
      const conflictSet = new Set();
      for (const dayKey of Object.keys(blocksByDay)) {
        const list = blocksByDay[dayKey].slice().sort((a, b) => a.start - b.start);
        for (let i = 0; i < list.length; i++) {
          for (let j = i + 1; j < list.length; j++) {
            if (list[j].start >= list[i].end) break;
            if (list[i].selectionKey && list[i].selectionKey === list[j].selectionKey) continue;
            if (!intervalsOverlap(list[i], list[j])) continue;
            conflictSet.add(list[i].el);
            conflictSet.add(list[j].el);
          }
        }
      }
      conflictSet.forEach(el => el.classList.add('is-conflict'));
    };

    const layoutOverlaps = (blocksByDay) => {
      const pad = 8; // px
      const gap = 6; // px

      const applyLayoutForCluster = (cluster) => {
        // Greedy interval coloring: assign a column per overlapping block.
        const active = []; // { end, col }
        const used = [];   // bool by col index
        let maxActive = 1;

        for (let i = 0; i < cluster.length; i++) {
          const it = cluster[i];
          // Free ended intervals
          for (let k = active.length - 1; k >= 0; k--) {
            if (active[k].end <= it.start) {
              used[active[k].col] = false;
              active.splice(k, 1);
            }
          }
          let col = 0;
          while (used[col]) col++;
          used[col] = true;
          active.push({ end: it.end, col });
          it._col = col;
          if (active.length > maxActive) maxActive = active.length;
        }

        const cols = Math.max(1, maxActive);
        const base = `(100% - ${pad * 2}px - ${gap * (cols - 1)}px) / ${cols}`;
        for (let i = 0; i < cluster.length; i++) {
          const it = cluster[i];
          const col = it._col || 0;
          // Use left+width so blocks become side-by-side instead of stacking.
          it.el.style.right = 'auto';
          it.el.style.left = `calc(${pad}px + (${col} * (${base} + ${gap}px)))`;
          it.el.style.width = `calc(${base})`;
        }
      };

      for (const dayKey of Object.keys(blocksByDay)) {
        const list = blocksByDay[dayKey].slice().sort((a, b) => (a.start - b.start) || (a.end - b.end));
        if (!list.length) continue;

        // Partition into overlap-clusters (transitive overlaps) so we can size
        // each block based on the maximum simultaneous overlaps in its cluster.
        const clusters = [];
        let cluster = [];
        let clusterEnd = -Infinity;

        for (let i = 0; i < list.length; i++) {
          const it = list[i];
          if (!cluster.length) {
            cluster = [it];
            clusterEnd = it.end;
            continue;
          }
          if (it.start < clusterEnd) {
            cluster.push(it);
            if (it.end > clusterEnd) clusterEnd = it.end;
            continue;
          }
          clusters.push(cluster);
          cluster = [it];
          clusterEnd = it.end;
        }
        if (cluster.length) clusters.push(cluster);

        for (let ci = 0; ci < clusters.length; ci++) {
          applyLayoutForCluster(clusters[ci]);
        }
      }
    };

    const renderGrid = (scheduleIndex) => {
      const selected = getSelected();
      const missingByCourse = getMissingByCourse();
      const schedulerLayout = getSchedulerLayout();
      clearGridBlocks();
      // clearGridBlocks already removes preview blocks and blocked backgrounds.
      // Reset preview state directly so this full render rebuilds the blocked
      // layer once, after the grid extent has been recalculated.
      activePreviewIntervals = [];
      try { updateGridExtent(scheduleIndex); } catch (_) {}
      renderBlockedBackground(schedulerLayout);
      const blocksByDay = {};
      DAYS.forEach(d => blocksByDay[d.key] = []);

      const addBlock = (dayKey, start, end, label, color, meta) => {
        const col = body.querySelector(`.scheduler-day-col[data-day="${dayKey}"]`);
        if (!col || col.hidden) return;
        const dateLabels = meta && Array.isArray(meta.dateLabels) ? meta.dateLabels : [];
        const dateText = dateLabels.join(', ');
        const block = document.createElement('button');
        block.type = 'button';
        block.className = 'scheduler-block';
        const dr = getDisplayRange(start, end);
        setBlockPosition(block, dr.start, dr.end, schedulerLayout);
        block.style.background = color;
        try { if (meta && meta.course_id) block.setAttribute('data-course', String(meta.course_id)); } catch (_) {}
        try { block.setAttribute('data-kind', 'course'); } catch (_) {}
        try { block.setAttribute('data-day', String(dayKey)); } catch (_) {}
        try { block.setAttribute('data-start', String(start)); } catch (_) {}
        try { block.setAttribute('data-end', String(end)); } catch (_) {}
        try { block.setAttribute('data-display-start', String(dr.start)); } catch (_) {}
        try { block.setAttribute('data-display-end', String(dr.end)); } catch (_) {}
        try { block.setAttribute('data-date-count', String(dateLabels.length)); } catch (_) {}
        try { if (dateText) block.setAttribute('title', `${label} • ${minutesToLabel(start)}–${minutesToLabel(end)} • ${dateText}`); } catch (_) {}
        block.innerHTML = `<div class="scheduler-block-title">${escapeHtml(label)}</div>` +
          `<div class="scheduler-block-time">${escapeHtml(minutesToLabel(start))}–${escapeHtml(minutesToLabel(end))}</div>`;
        try {
          if (meta && meta.course_id && Array.isArray(missingByCourse[meta.course_id]) && missingByCourse[meta.course_id].length) {
            block.classList.add('is-missing-coreq');
          }
        } catch (_) {}
        block.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (blockMode) return;
          const res = await createPickerModal({
            title: 'Scheduled Section',
            bodyHtml:
              `<p><strong>${escapeHtml(label)}</strong></p>` +
              `<p>${escapeHtml(minutesToLabel(start))}–${escapeHtml(minutesToLabel(end))} • ${escapeHtml(dayKey)}</p>` +
              (dateText ? `<p><span class="muted">Dates:</span> ${escapeHtml(dateText)}</p>` : '') +
              (meta && meta.where ? `<p><span class="muted">Where:</span> ${escapeHtml(meta.where)}</p>` : '') +
              (meta && meta.instructors ? `<p><span class="muted">Instructors:</span> ${escapeHtml(meta.instructors)}</p>` : ''),
            buttons: [
              { action: 'close', label: 'Close', variant: 'secondary' },
              { action: 'details', label: 'Details', ariaLabel: `Details for ${normalizeCourseId(meta && meta.course_id) || label}`, variant: 'secondary', value: meta && meta.course_id ? meta.course_id : null },
              { action: 'change', label: 'Change section', ariaLabel: `Change section for ${normalizeCourseId(meta && meta.course_id) || label}`, variant: 'secondary', value: meta && meta.course_id ? meta.course_id : null },
              { action: 'remove', label: 'Remove section', ariaLabel: `Remove section for ${normalizeCourseId(meta && meta.course_id) || label}`, variant: 'primary', value: meta && meta.course_id ? meta.course_id : null },
            ],
          });
          if (res.action === 'details' && res.value) {
            const courseId = normalizeCourseId(res.value);
            if (!courseId) return;
            try { await openCourseDetailsModal(courseId); } catch (_) {}
          }
          if (res.action === 'change' && res.value) {
            const courseId = normalizeCourseId(res.value);
            if (!courseId) return;
            try {
              await pickSectionForCourse(scheduleIndex, courseId);
            } catch (_) {}
          }
          if (res.action === 'remove' && res.value) {
            const courseId = normalizeCourseId(res.value);
            await removeSelectionFromGrid(courseId, scheduleIndex);
          }
        });

        col.appendChild(block);
        blocksByDay[dayKey].push({
          dayKey,
          start,
          end,
          dateWindows: meta && Array.isArray(meta.dateWindows) ? meta.dateWindows : null,
          selectionKey: meta && meta.selectionKey ? String(meta.selectionKey) : '',
          el: block,
        });
      };

      const selectedKeys = Object.keys(selected);
      for (let i = 0; i < selectedKeys.length; i++) {
        const courseId = selectedKeys[i];
        const pick = selected[courseId];
        const courseEntry = scheduleIndex.get(courseId);
        if (!courseEntry) continue;
        const sec = courseEntry.sections.find(s => String(s.crn) === String(pick.crn)) || null;
        if (!sec) continue;
        const color = hslFromString(courseId);
        const label = `${courseId}${sec.section ? `-${sec.section}` : ''}${sec.component ? ` • ${sec.component}` : ''}`;
        const intervals = getSectionIntervals(sec);
        for (let ii = 0; ii < intervals.length; ii++) {
          const it = intervals[ii];
          if (!isGridRenderableInterval(it)) continue;
          addBlock(it.dayKey, it.start, it.end, label, color, {
            course_id: courseId,
            selectionKey: `${courseId}:${String(sec.crn || '')}`,
            dateWindows: it.dateWindows,
            dateLabels: it.dateLabels,
            where: it.where,
            instructors: it.instructors,
          });
        }
      }

      layoutOverlaps(blocksByDay);
      computeConflicts(blocksByDay);
      applyBlockedConflictStyling();

      // Keep hover highlight/preview responsive after rerenders.
      try {
        if (hoverSelectedCourseId && shouldHoverPreview()) {
          const bundle = computeBundleClosure(hoverSelectedCourseId);
          applyHoverHighlightForCourses(bundle);
        } else {
          clearHoverHighlights();
        }
      } catch (_) {}
      try {
        if (hoverResultCourseId && shouldHoverPreview()) {
          renderPreviewForCourse(scheduleIndex, hoverResultCourseId);
        } else {
          clearPreviewBlocks();
        }
      } catch (_) {}

      scheduleScrollbarCompensation();
    };

    const resetHover = () => {
      hoverSelectedCourseId = '';
      hoverResultCourseId = '';
      hoverResultSection = null;
      clearPreviewBlocks();
      clearHoverHighlights();
    };

    const reconcileRenderedResults = () => {
      try {
        if (!hoverResultCourseId || !resultsEl) return;
        const cards = resultsEl.querySelectorAll('.scheduler-course[data-course]');
        let found = false;
        cards.forEach((card) => {
          if (found) return;
          const cid = normalizeCourseId(card.getAttribute('data-course') || '');
          if (cid && cid === normalizeCourseId(hoverResultCourseId)) found = true;
        });
        if (!found) resetHover();
      } catch (_) {}
    };

    const reconcileRenderedSelected = () => {
      try {
        if (!hoverSelectedCourseId || !shouldHoverPreview() || !selectedEl) return;
        const items = selectedEl.querySelectorAll('.scheduler-selected-item[data-course]');
        let found = false;
        items.forEach((item) => {
          if (found) return;
          const cid = normalizeCourseId(item.getAttribute('data-course') || '');
          if (cid && cid === normalizeCourseId(hoverSelectedCourseId)) found = true;
        });
        if (!found) {
          hoverSelectedCourseId = '';
          clearHoverHighlights();
          return;
        }
        applyHoverHighlightForCourses(computeBundleClosure(hoverSelectedCourseId));
      } catch (_) {}
    };

    // Touch devices use an explicit preview request because they have no hover.
    // Keep that interaction independent from the desktop hover-preview setting:
    // disabling mouse hover must not leave mobile's visible Preview action inert.
    modal.addEventListener('schedulerpreviewrequest', (e) => {
      try {
        const detail = e && e.detail ? e.detail : {};
        const courseId = normalizeCourseId(detail.courseId || '');
        const crn = String(detail.crn || '').trim();
        if (!getScheduleIndex() || !courseId) return;
        const entry = getScheduleIndex().get(courseId);
        const section = crn && entry && Array.isArray(entry.sections)
          ? (entry.sections.find(sec => String(sec && sec.crn ? sec.crn : '') === crn) || null)
          : null;
        if (crn && !section) return;
        renderPreviewForCourse(getScheduleIndex(), courseId, section, { ignoreHoverPreference: true });
      } catch (_) {}
    });

    // Hover interactions (optional)
    if (selectedEl) {
      selectedEl.addEventListener('mouseover', (e) => {
        if (!shouldHoverPreview()) return;
        const item = e.target && e.target.closest ? e.target.closest('.scheduler-selected-item') : null;
        if (!item) return;
        const courseId = normalizeCourseId(item.getAttribute('data-course') || '');
        if (!courseId) return;
        if (courseId === hoverSelectedCourseId) return;
        hoverSelectedCourseId = courseId;
        hoverResultCourseId = '';
        clearPreviewBlocks();
        try {
          const bundle = computeBundleClosure(courseId);
          applyHoverHighlightForCourses(bundle);
        } catch (_) {}
      });
      selectedEl.addEventListener('mouseleave', () => {
        hoverSelectedCourseId = '';
        clearHoverHighlights();
      });
    }
    if (resultsEl) {
      resultsEl.addEventListener('mouseover', (e) => {
        if (!shouldHoverPreview()) return;
        const sectionRow = e.target && e.target.closest ? e.target.closest('.scheduler-inline-section-row') : null;
        if (sectionRow) {
          const courseId = normalizeCourseId(sectionRow.getAttribute('data-course') || '');
          const crn = String(sectionRow.getAttribute('data-crn') || '').trim();
          if (!courseId || !crn) return;
          const key = `${courseId}:${crn}`;
          if (hoverResultSection === key) return;
          hoverResultSection = key;
          hoverResultCourseId = courseId;
          hoverSelectedCourseId = '';
          clearHoverHighlights();
          try {
            const entry = getScheduleIndex() ? getScheduleIndex().get(courseId) : null;
            const section = entry && Array.isArray(entry.sections)
              ? (entry.sections.find(sec => String(sec && sec.crn ? sec.crn : '') === crn) || null)
              : null;
            if (getScheduleIndex() && section) renderPreviewForCourse(getScheduleIndex(), courseId, section);
          } catch (_) {}
          return;
        }
        const card = e.target && e.target.closest ? e.target.closest('.scheduler-course') : null;
        if (!card) return;
        const courseId = normalizeCourseId(card.getAttribute('data-course') || '');
        if (!courseId) return;
        if (courseId === hoverResultCourseId && !hoverResultSection) return;
        hoverResultCourseId = courseId;
        hoverResultSection = null;
        hoverSelectedCourseId = '';
        clearHoverHighlights();
        try {
          if (getSelected()[courseId]) {
            const bundle = computeBundleClosure(courseId);
            applyHoverHighlightForCourses(bundle);
            clearPreviewBlocks();
            return;
          }
        } catch (_) {}
        try {
          if (getScheduleIndex()) renderPreviewForCourse(getScheduleIndex(), courseId);
        } catch (_) {}
      });
      resultsEl.addEventListener('mouseleave', () => {
        hoverResultCourseId = '';
        hoverResultSection = null;
        clearPreviewBlocks();
        clearHoverHighlights();
      });
    }

    if (blockedListEl) {
      blockedListEl.addEventListener('click', async (e) => {
        const btn = e.target && e.target.closest ? e.target.closest('.scheduler-blocked-remove') : null;
        if (!btn) return;
        const id = String(btn.getAttribute('data-block-id') || '');
        if (!id) return;
        const next = (Array.isArray(getBlocked()) ? getBlocked() : []).filter(b => String(b && b.id ? b.id : '') !== id);
        setBlocked(next);
        renderBlocked();
        try { if (getScheduleIndex()) renderGrid(getScheduleIndex()); } catch (_) {}
        try { if (getScheduleIndex()) renderResults(getScheduleIndex(), getLastQuery()); } catch (_) {}
      });
    }

    if (blockedClearBtn) {
      blockedClearBtn.addEventListener('click', async () => {
        const res = await createPickerModal({
          title: 'Clear blocked hours',
          bodyHtml: '<p>Clear all blocked hours?</p>',
          buttons: [
            { action: 'cancel', label: 'Cancel', variant: 'secondary' },
            { action: 'clear', label: 'Clear', variant: 'primary' },
          ],
        });
        if (res.action !== 'clear') return;
        setBlocked([]);
        renderBlocked();
        try { if (getScheduleIndex()) renderGrid(getScheduleIndex()); } catch (_) {}
        try { if (getScheduleIndex()) renderResults(getScheduleIndex(), getLastQuery()); } catch (_) {}
      });
    }

    if (blockedToggleBtn) {
      blockedToggleBtn.addEventListener('click', () => setBlockMode(!blockMode));
    }
    if (blockModeBtn) {
      blockModeBtn.addEventListener('click', () => setBlockMode(!blockMode));
    }

    // Unblock by clicking a blocked block in block mode.
    body.addEventListener('click', async (e) => {
      if (!blockMode) return;
      const bb = e.target && e.target.closest ? e.target.closest('.scheduler-block.scheduler-block-bg') : null;
      if (!bb) return;
      const id = String(bb.getAttribute('data-block-id') || '');
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();
      const res = await createPickerModal({
        title: 'Unblock hours',
        bodyHtml: '<p>Remove this blocked time?</p>',
        buttons: [
          { action: 'cancel', label: 'Cancel', variant: 'secondary' },
          { action: 'remove', label: 'Remove', variant: 'primary', value: id },
        ],
      });
      if (res.action !== 'remove' || !res.value) return;
      const next = (Array.isArray(getBlocked()) ? getBlocked() : []).filter(b => String(b && b.id ? b.id : '') !== String(res.value));
      setBlocked(next);
      renderBlocked();
      try { if (getScheduleIndex()) renderGrid(getScheduleIndex()); } catch (_) {}
      try { if (getScheduleIndex()) renderResults(getScheduleIndex(), getLastQuery()); } catch (_) {}
    });

    const dispose = () => {
      if (disposed) return;
      disposed = true;
      try { if (onDocMouseUp) document.removeEventListener('mouseup', onDocMouseUp); } catch (_) {}
      geometry.dispose();
    };

    return Object.freeze({
      dispose,
      invalidateSchedulerLayout,
      getSchedulerLayout,
      setBlockMode,
      isBlockMode: () => blockMode,
      getBlockedByDay,
      mergeBlockedIntervalsForDay,
      setBlocked,
      renderBlocked,
      canFitWithBlockedHours,
      isGridRenderableInterval,
      getOccupiedByDayFromSelected,
      sectionAvailabilityClasses,
      getRequiredBundleCourseIds,
      pickBestBundleSections,
      clearPreviewBlocks,
      clearHoverHighlights,
      applyHoverHighlightForCourses,
      renderPreviewForCourse,
      clearGridBlocks,
      renderGrid,
      resetHover,
      reconcileRenderedResults,
      reconcileRenderedSelected,
    });
  }

  const api = Object.freeze({ createGridController });
  if (root) root.SurriculumSchedulerGrid = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
