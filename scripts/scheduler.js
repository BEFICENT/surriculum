// Current term scheduler UI (SUchedule-like) for building a weekly timetable.
// Loads meeting times from courses/schedule/<termCode>.jsonl.

(function () {
  const schedulerFoundation = (typeof window !== 'undefined')
    ? window.SurriculumSchedulerFoundation : null;
  if (!schedulerFoundation) {
    throw new Error('Scheduler foundation was not loaded before scripts/scheduler.js.');
  }
  const schedulerCourseUi = (typeof window !== 'undefined')
    ? window.SurriculumSchedulerCourseUi : null;
  if (!schedulerCourseUi) {
    throw new Error('Scheduler course UI was not loaded before scripts/scheduler.js.');
  }
  const schedulerPlannerSync = (typeof window !== 'undefined')
    ? window.SurriculumSchedulerPlannerSync : null;
  if (!schedulerPlannerSync) {
    throw new Error('Scheduler planner sync was not loaded before scripts/scheduler.js.');
  }
  const schedulerResults = (typeof window !== 'undefined')
    ? window.SurriculumSchedulerResults : null;
  if (!schedulerResults) {
    throw new Error('Scheduler results reconciler was not loaded before scripts/scheduler.js.');
  }
  const schedulerResultsController = (typeof window !== 'undefined')
    ? window.SurriculumSchedulerResultsController : null;
  if (!schedulerResultsController) {
    throw new Error('Scheduler results controller was not loaded before scripts/scheduler.js.');
  }
  const schedulerGrid = (typeof window !== 'undefined')
    ? window.SurriculumSchedulerGrid : null;
  if (!schedulerGrid) {
    throw new Error('Scheduler grid controller was not loaded before scripts/scheduler.js.');
  }
  const schedulerSelection = (typeof window !== 'undefined')
    ? window.SurriculumSchedulerSelection : null;
  if (!schedulerSelection) {
    throw new Error('Scheduler selection controller was not loaded before scripts/scheduler.js.');
  }
  const schedulerSession = window.SurriculumSchedulerSession;
  const schedulerSidebar = window.SurriculumSchedulerSidebar;
  const schedulerProgramDetails = window.SurriculumSchedulerProgramDetails;
  const schedulerTermContext = window.SurriculumSchedulerTermContext;
  if (!schedulerSession || !schedulerSidebar || !schedulerProgramDetails || !schedulerTermContext) {
    throw new Error('Scheduler session, sidebar, program-detail, and term-context helpers were not loaded.');
  }
  const {
    DAYS,
    DAY_START_MIN,
    DAY_END_MIN,
    nextSchedulerDialogId,
    activateSchedulerDialog,
    activateSchedulerEdgeBlur,
    escapeHtml,
    getCurrentTermNameSafe,
    getCurrentTermCodeSafe,
    displayTermNameSafe,
    getAvailableSchedulerTerms,
    resolveSchedulerTermCode,
    maybeWarnFutureSchedulerTerm,
    getSavedSchedulerSelectedTerm,
    setSavedSchedulerSelectedTerm,
    normalizeCourseId,
    parseDaysToKeys,
    parseTimeRangeToMinutes,
    minutesToLabel,
    hslFromString,
    loadTermScheduleIndex,
    getPlannerSemesterCourseCodes,
    extractCoreqCourseIdsFromCoursePageInfoField,
    createPickerModal,
    createInfoModal,
    createTextInputModal,
    saveSchedulerState,
    loadSchedulerState,
  } = schedulerFoundation;
  async function openSchedulerModal(preferredTermCode) {
    try { performance.mark('surriculum:scheduler-open-start'); } catch (_) {}

    const schedulerOpener = typeof HTMLElement !== 'undefined' && document.activeElement instanceof HTMLElement
      ? document.activeElement : null;
    const currentTermName = getCurrentTermNameSafe();
    const currentTermCode = getCurrentTermCodeSafe();
    const ui = (typeof window !== 'undefined') ? window.uiModal : null;
    const DISPLAY_END_EXTRA_MIN = 10; // show the final boundary at 19:40
    const DISPLAY_END_MIN = DAY_END_MIN + DISPLAY_END_EXTRA_MIN;
    const GRID_MAX_END_MIN = 24 * 60;

    if (!currentTermCode) {
      if (ui && typeof ui.alert === 'function') {
        ui.alert('Scheduler unavailable', '<p>Could not determine the current term.</p>');
      }
      return;
    }

    const availableTerms = await getAvailableSchedulerTerms();
    if (!availableTerms.length) {
      if (ui && typeof ui.alert === 'function') {
        ui.alert('Scheduler unavailable', '<p>No schedule terms are available locally. Run the schedule scraper first.</p>');
      }
      return;
    }

    const initialTermCode = resolveSchedulerTermCode(
      preferredTermCode || getSavedSchedulerSelectedTerm(),
      availableTerms,
      currentTermCode
    );
    if (!initialTermCode) {
      if (ui && typeof ui.alert === 'function') {
        ui.alert('Scheduler unavailable', '<p>Could not resolve a schedule term to open.</p>');
      }
      return;
    }
    const termCode = initialTermCode;
    const termName = displayTermNameSafe(termCode) || currentTermName || termCode;
    const isCurrentSchedulerTerm = termCode === currentTermCode;
    const schedulerDialogId = nextSchedulerDialogId('scheduler');
    const scheduleIndexPromise = Promise.resolve(loadTermScheduleIndex(termCode)).catch(() => null);
    const coursePageInfoPromise = (async () => {
      try {
        const loadInfo = (typeof window !== 'undefined') ? window.loadCoursePageInfoIndex : null;
        return typeof loadInfo === 'function' ? await loadInfo() : null;
      } catch (_) {
        return null;
      }
    })();
    setSavedSchedulerSelectedTerm(termCode);
    await maybeWarnFutureSchedulerTerm(termCode, currentTermCode, ui);

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay scheduler-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', `${schedulerDialogId}-title`);

    const modal = document.createElement('div');
    modal.className = 'modal scheduler-modal';
    modal.id = schedulerDialogId;
    modal.tabIndex = -1;
    modal.addEventListener('click', (e) => e.stopPropagation());

    const header = document.createElement('div');
    header.className = 'scheduler-header';
    header.innerHTML =
      `<div class="scheduler-title" id="${schedulerDialogId}-title">Scheduler <span class="scheduler-term${isCurrentSchedulerTerm ? ' is-current' : ''}">— ${escapeHtml(termName || termCode)}</span></div>` +
      `<div class="scheduler-legend">` +
      `  <span class="scheduler-legend-item"><span class="scheduler-legend-dot"></span> Course color</span>` +
      `  <span class="scheduler-legend-item"><span class="scheduler-legend-badge scheduler-legend-conflict"></span> Time conflict</span>` +
      `  <span class="scheduler-legend-item"><span class="scheduler-legend-badge scheduler-legend-coreq"></span> Missing coreq</span>` +
      `  <span class="scheduler-legend-item"><span class="scheduler-legend-badge scheduler-legend-blocked"></span> Blocked time</span>` +
      `</div>` +
      `<div class="scheduler-header-actions">` +
      `  <button class="scheduler-header-btn scheduler-copy-crns scheduler-action-optional" type="button" title="Copy CRNs" aria-label="Copy CRNs"><i class="fa-solid fa-copy"></i></button>` +
      `  <button class="scheduler-header-btn scheduler-block-mode scheduler-action-optional" type="button" title="Block hours" aria-label="Block hours"><i class="fa-solid fa-ban"></i></button>` +
      `  <button class="scheduler-header-btn scheduler-fullscreen scheduler-action-optional" type="button" title="Fullscreen" aria-label="Fullscreen"><i class="fa-solid fa-expand"></i></button>` +
      `  <button class="scheduler-header-btn scheduler-more" type="button" title="More" aria-label="More"><i class="fa-solid fa-ellipsis-vertical"></i></button>` +
      `  <button class="scheduler-header-btn scheduler-close" type="button" title="Close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>` +
      `</div>`;

    const closeBtn = header.querySelector('.scheduler-close');
    const fsBtn = header.querySelector('.scheduler-fullscreen');
    const copyBtn = header.querySelector('.scheduler-copy-crns');
    const blockModeBtn = header.querySelector('.scheduler-block-mode');
    const moreBtn = header.querySelector('.scheduler-more');
    let mainDialogController = null;
    let plannerSyncController = null;
    let scheduleManagerController = null;
    let termSelectorController = null;
    let mobileDayTabsController = null;
    let resultsReconciler = null;
    let resultsController = null;
    let gridController = null;
    let selectionController = null;
    let edgeBlurController = null;
    let schedulerClosed = false;

    const courseDetailsSession = {};
    Object.defineProperties(courseDetailsSession, {
      scheduleIndex: {
        get: () => scheduleIndex,
        set: (value) => { scheduleIndex = value; },
      },
      coursePageInfoMap: {
        get: () => coursePageInfoMap,
        set: (value) => { coursePageInfoMap = value; },
      },
      courseInstructorHistoryMap: {
        get: () => courseInstructorHistoryMap,
        set: (value) => { courseInstructorHistoryMap = value; },
      },
      courseSectionHistoryMap: {
        get: () => courseSectionHistoryMap,
        set: (value) => { courseSectionHistoryMap = value; },
      },
      reverseCoreqIndex: {
        get: () => reverseCoreqIndex,
        set: (value) => { reverseCoreqIndex = value; },
      },
      selected: { get: () => selected },
    });
    const courseDetailsController = schedulerCourseUi.createCourseDetailsController({
      foundation: schedulerFoundation,
      session: courseDetailsSession,
      termCode,
      getSectionIntervals: (...args) => getSectionIntervals(...args),
      sectionInstructorPreview: (...args) => sectionInstructorPreview(...args),
      buildReverseCoreqIndex: (...args) => selectionController.buildReverseCoreqIndex(...args),
    });
    const {
      buildDetailUrl,
      buildSyllabusUrl,
      sectionMeetingPreview,
      sectionTimeKey,
      openDetailPickerForCourse,
      openSyllabusPickerForCourse,
      openCourseDetailsModal,
    } = courseDetailsController;
    const updateFullscreenIcon = () => {
      try {
        const inFs = !!(document.fullscreenElement && document.fullscreenElement === modal);
        const icon = fsBtn ? fsBtn.querySelector('i') : null;
        if (!icon) return;
        icon.classList.toggle('fa-expand', !inFs);
        icon.classList.toggle('fa-compress', inFs);
        try { if (edgeBlurController) edgeBlurController.refresh(); } catch (_) {}
      } catch (_) {}
    };

    const onFullscreenChange = () => updateFullscreenIcon();
    try { document.addEventListener('fullscreenchange', onFullscreenChange); } catch (_) {}

    const cleanup = () => {
      if (schedulerClosed) return;
      schedulerClosed = true;
      try { document.removeEventListener('fullscreenchange', onFullscreenChange); } catch (_) {}
      try { if (mobileDayTabsController) mobileDayTabsController.dispose(); } catch (_) {}
      try { if (edgeBlurController) edgeBlurController.release(); } catch (_) {}
      try { if (plannerSyncController) plannerSyncController.dispose(); } catch (_) {}
      try { if (scheduleManagerController) scheduleManagerController.dispose(); } catch (_) {}
      try { if (termSelectorController) termSelectorController.dispose(); } catch (_) {}
      try { if (resultsController) resultsController.dispose(); } catch (_) {}
      try { if (resultsReconciler) resultsReconciler.dispose(); } catch (_) {}
      try { if (gridController) gridController.dispose(); } catch (_) {}
      try {
        if (typeof modal.__setCourseSheetOpen === 'function') modal.__setCourseSheetOpen(false);
      } catch (_) {}
      try { overlay.remove(); } catch (_) {}
      try { if (mainDialogController) mainDialogController.release(); } catch (_) {}
    };
    const schedulerIsMounted = () => (
      !schedulerClosed && overlay.isConnected && modal.isConnected
    );
    closeBtn.addEventListener('click', cleanup);
    overlay.addEventListener('click', cleanup);

    fsBtn.addEventListener('click', async () => {
      try {
        if (document.fullscreenElement) {
          await document.exitFullscreen();
          updateFullscreenIcon();
          return;
        }
        if (typeof modal.requestFullscreen === 'function') {
          await modal.requestFullscreen();
          updateFullscreenIcon();
          return;
        }
        // Fallback: emulate fullscreen with CSS
        modal.classList.toggle('is-fullscreen');
      } catch (_) {
        // Fallback: emulate fullscreen with CSS
        try { modal.classList.toggle('is-fullscreen'); } catch (_) {}
      }
    });

    const toggleFullscreen = async () => {
      try { await fsBtn.click(); } catch (_) {
        // If click fails, try the same logic directly.
        try {
          if (document.fullscreenElement) {
            await document.exitFullscreen();
            updateFullscreenIcon();
            return;
          }
          if (typeof modal.requestFullscreen === 'function') {
            await modal.requestFullscreen();
            updateFullscreenIcon();
            return;
          }
          modal.classList.toggle('is-fullscreen');
        } catch (_) {}
      }
    };

    copyBtn.addEventListener('click', async () => {
      try {
        const rawState = loadSchedulerState(termCode);
        const sel = rawState.selected && typeof rawState.selected === 'object' ? rawState.selected : {};
        const selectedPairs = Object.entries(sel)
          .map(([k, v]) => ({ courseId: normalizeCourseId(k), crn: (v && v.crn ? String(v.crn).trim() : '') }))
          .filter(x => x.courseId && x.crn);
        if (!selectedPairs.length) {
          if (ui && typeof ui.alert === 'function') ui.alert('No CRNs', '<p>No sections selected yet.</p>');
          return;
        }

        const idx = scheduleIndex || await loadTermScheduleIndex(termCode);
        if (idx) scheduleIndex = idx;

        selectedPairs.sort((a, b) => {
          const c = a.courseId.localeCompare(b.courseId);
          if (c) return c;
          return a.crn.localeCompare(b.crn);
        });

        const rows = selectedPairs.map(({ courseId, crn }) => {
          let label = courseId;
          let altText = '';
          try {
            const entry = idx ? idx.get(courseId) : null;
            const sec = entry && Array.isArray(entry.sections)
              ? (entry.sections.find(s => String(s && s.crn ? s.crn : '') === crn) || null)
              : null;
            const secLabel = sec && sec.section ? `-${String(sec.section)}` : '';
            const comp = sec && sec.component ? String(sec.component) : '';
            label = `${courseId}${secLabel}${comp ? ` ${comp}` : ''}`.trim();

            // Alternative CRNs for the same component with identical timing.
            // Common case: same hours, different CRN/classroom.
            if (entry && sec && Array.isArray(entry.sections) && entry.sections.length) {
              const key = sectionTimeKey(sec);
              const alt = [];
              for (let i = 0; i < entry.sections.length; i++) {
                const s = entry.sections[i];
                if (!s) continue;
                const sCrn = String(s.crn || '').trim();
                if (!sCrn || sCrn === crn) continue;
                if (sectionTimeKey(s) !== key) continue;
                const sSec = String(s.section || '').trim();
                alt.push(sSec ? `${sCrn}(${sSec})` : sCrn);
              }
              alt.sort();
              if (alt.length) {
                const shown = alt.slice(0, 5);
                altText = `Alt: ${shown.join(', ')}${alt.length > shown.length ? ', …' : ''}`;
              }
            }
          } catch (_) {}
          return { label, crn, altText };
        });

        const maxLabelLen = rows.reduce((m, r) => Math.max(m, String(r.label || '').length), 0);
        const maxCrnLen = rows.reduce((m, r) => Math.max(m, String(r.crn || '').length), 0);
        const pad = (s, n) => {
          const str = String(s || '');
          if (str.length >= n) return str;
          return str + ' '.repeat(n - str.length);
        };
        const padLeft = (s, n) => {
          const str = String(s || '');
          if (str.length >= n) return str;
          return ' '.repeat(n - str.length) + str;
        };

        const lines = rows.map(r => {
          const left = pad(String(r.label || ''), maxLabelLen);
          const mid = padLeft(String(r.crn || ''), maxCrnLen);
          const right = String(r.altText || '');
          return right ? `${left}  ${mid}  ${right}` : `${left}  ${mid}`;
        });
        const text = lines.join('\n');
        try {
          if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            await navigator.clipboard.writeText(text);
            if (ui && typeof ui.alert === 'function') ui.alert('Copied', `<p>Copied ${selectedPairs.length} selected section(s) to clipboard.</p>`);
            return;
          }
        } catch (_) {}
        if (ui && typeof ui.alert === 'function') {
          ui.alert('Copy CRNs', `<p>Copy the sections below:</p><pre style="white-space:pre-wrap">${escapeHtml(text)}</pre>`);
        }
      } catch (_) {}
    });

    if (moreBtn) {
      moreBtn.addEventListener('click', async () => {
        const inFs = !!(document.fullscreenElement && document.fullscreenElement === modal);
        const res = await createPickerModal({
          title: 'Scheduler actions',
          bodyHtml: '<p>Choose an action:</p>',
          listItems: [
            { action: 'copy', label: 'Copy CRNs', subLabel: 'Copy CRNs with course/section labels to clipboard.' },
            { action: 'block', label: isBlockMode() ? 'Exit block mode' : 'Block hours', subLabel: isBlockMode() ? 'Stop blocking time on the grid.' : 'Click+drag on the grid to block time.' },
            { action: 'fs', label: inFs ? 'Exit fullscreen' : 'Fullscreen', subLabel: 'Toggle fullscreen for the scheduler.' },
          ],
          buttons: [{ action: 'close', label: 'Close', variant: 'secondary' }],
        });
        if (!res || !res.action) return;
        if (res.action === 'copy') {
          try { copyBtn.click(); } catch (_) {}
        }
        if (res.action === 'block') {
          try { setBlockMode(!isBlockMode()); } catch (_) {}
        }
        if (res.action === 'fs') {
          try { await toggleFullscreen(); } catch (_) {}
        }
      });
    }

    const body = schedulerCourseUi.createSchedulerBody({
      isCurrentSchedulerTerm,
      termName,
      schedulerDialogId,
      days: DAYS,
      escapeHtml,
    });
    modal.appendChild(header);
    modal.appendChild(body);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    edgeBlurController = activateSchedulerEdgeBlur(overlay, modal);

    mobileDayTabsController = schedulerCourseUi.createMobileDayTabsController({
      modal,
      schedulerDialogId,
    });

    mainDialogController = activateSchedulerDialog(overlay, {
      previouslyFocused: schedulerOpener,
      initialFocus: () => (
        document.body.classList.contains('is-mobile')
          ? closeBtn
          : (body.querySelector('.scheduler-search') || closeBtn)
      ),
      onEscape: () => {
        if (resultsController && resultsController.isFilterMenuOpen()) {
          resultsController.setFilterMenuOpen(false);
          try { body.querySelector('.scheduler-filter-btn').focus({ preventScroll: true }); } catch (_) {}
          return;
        }
        if (modal.classList.contains('m-sheet-open')) {
          if (typeof modal.__setCourseSheetOpen === 'function') {
            modal.__setCourseSheetOpen(false);
          } else {
            modal.classList.remove('m-sheet-open');
          }
          return;
        }
        cleanup();
      },
    });

    const sidebarToggleBtn = body.querySelector('.scheduler-sidebar-toggle');
    // Grid geometry, blocked-hour dragging, and preview interaction are
    // installed after the live Scheduler session and meeting tools exist.

    let state = loadSchedulerState(termCode);
    let selected = state.selected && typeof state.selected === 'object' ? state.selected : {};
    let blocked = Array.isArray(state.blocked) ? state.blocked : [];
    let scheduleIndex = null;
    let coursePageInfoMap = null;
    let courseInstructorHistoryMap = null;
    let courseSectionHistoryMap = null;
    let missingByCourse = {}; // course_id -> [missing coreq course_id]
    let orphanByCourse = {};  // course_id -> [base course_ids that require this course as coreq]
    let reverseCoreqIndex = null; // Map(coreq -> Set(baseCourse))
    let takenBeforeCurrentSet = null;

    const schedulerControllerSession = schedulerSession.createLiveSession({
      selected: { get: () => selected, set: (value) => { selected = value; } },
      blocked: { get: () => blocked, set: (value) => { blocked = value; } },
      scheduleIndex: { get: () => scheduleIndex, set: (value) => { scheduleIndex = value; } },
      coursePageInfoMap: { get: () => coursePageInfoMap, set: (value) => { coursePageInfoMap = value; } },
      reverseCoreqIndex: { get: () => reverseCoreqIndex, set: (value) => { reverseCoreqIndex = value; } },
      missingByCourse: { get: () => missingByCourse, set: (value) => { missingByCourse = value; } },
      orphanByCourse: { get: () => orphanByCourse, set: (value) => { orphanByCourse = value; } },
      takenBeforeCurrentTermSet: {
        get: () => takenBeforeCurrentSet,
        set: (value) => { takenBeforeCurrentSet = value; },
      },
    });

    // Controllers access the live session through properties so schedule
    // switching can replace state references without leaving stale snapshots.


    const scheduleBtn = body.querySelector('.scheduler-schedule-toggle');
    const scheduleNameEl = body.querySelector('.scheduler-schedule-name');
    const termSelectEl = body.querySelector('.scheduler-term-select');


    termSelectorController = schedulerCourseUi.createTermSelectorController({
      foundation: schedulerFoundation,
      select: termSelectEl,
      termCode,
      currentTermCode,
      availableTerms,
      ui,
      close: cleanup,
      open: openSchedulerModal,
    });

    const sidebarController = schedulerSidebar.createSidebarController({
      body,
      sidebarToggleButton: sidebarToggleBtn,
      termCode,
      loadSchedulerState,
      saveSchedulerState,
      getActiveSchedule: schedulerSession.getActiveSchedule,
      getState: () => state,
      getGridController: () => gridController,
    });
    const { applyScheduleUi } = sidebarController;

    // Collapsible sidebar sections (Current Term Plan / Selected Sections)

    const plannedCourses = getPlannerSemesterCourseCodes(termCode);
    const planListEl = body.querySelector('.scheduler-plan-list');
    if (plannedCourses.length) {
      planListEl.innerHTML = plannedCourses.map(c => (
        `<button type="button" class="scheduler-pill scheduler-plan-pick" data-course="${escapeHtml(c)}" title="Pick a section" aria-label="Pick a section for ${escapeHtml(c)}">${escapeHtml(c)}</button>`
      )).join('');
    } else {
      planListEl.innerHTML = `<div class="scheduler-muted">No courses in your planner semester for <strong>${escapeHtml(termName)}</strong> yet.</div>`;
    }

    const resultsEl = body.querySelector('.scheduler-results');
    resultsReconciler = schedulerResults.createCourseResultsReconciler(resultsEl);
    const selectedEl = body.querySelector('.scheduler-selected');
    const blockedListEl = body.querySelector('.scheduler-blocked-list');
    const blockedToggleBtn = body.querySelector('.scheduler-blocked-toggle');
    const blockedClearBtn = body.querySelector('.scheduler-blocked-clear');
    const searchEl = body.querySelector('.scheduler-search');
    const filterBtn = body.querySelector('.scheduler-filter-btn');
    const filterCountEl = body.querySelector('.scheduler-filter-count');
    const filterMenuEl = body.querySelector('.scheduler-filter-menu');
    const clearBtn = body.querySelector('.scheduler-clear');
    const pickPlanBtn = body.querySelector('.scheduler-pick-plan');
    const loadMoreBtn = body.querySelector('.scheduler-load-more');
    const hideTakenToggle = body.querySelector('.scheduler-toggle-hide-taken');
    const detailsToggle = body.querySelector('.scheduler-toggle-details');
    const scoreToggle = body.querySelector('.scheduler-toggle-score');
    const hoverPreviewToggle = body.querySelector('.scheduler-toggle-hover-preview');
    const highlightToggle = body.querySelector('.scheduler-toggle-highlight');
    const showBlockedToggle = body.querySelector('.scheduler-toggle-show-blocked');
    const minMainTypeSelect = body.querySelector('.scheduler-filter-min-main');
    const minDmTypeSelect = body.querySelector('.scheduler-filter-min-dm');
    const minMinorTypeSelect = body.querySelector('.scheduler-filter-min-minor');
    const minSuInput = body.querySelector('.scheduler-filter-min-su');
    const minEctsInput = body.querySelector('.scheduler-filter-min-ects');
    const minBsInput = body.querySelector('.scheduler-filter-min-bs');
    const minEngInput = body.querySelector('.scheduler-filter-min-eng');
    const prereqToggle = body.querySelector('.scheduler-toggle-prereq');
    const showUnmetPrereqToggle = body.querySelector('.scheduler-toggle-show-unmet-prereq');

    const scheduleLoadingEl = document.createElement('div');
    scheduleLoadingEl.className = 'scheduler-muted';
    scheduleLoadingEl.textContent = 'Loading schedule data...';
    resultsEl.appendChild(scheduleLoadingEl);

    const sectionChangeTools = schedulerSession.createSectionChangeTools({
      normalizeCourseId,
      parseTimeRangeToMinutes,
      sectionMeetingPreview,
    });
    const { sectionInstructorPreview, computeSelectedSectionChangeReport } = sectionChangeTools;


    // Section/corequisite graph helpers are provided by the selection controller.

    const programDetailTools = schedulerProgramDetails.createProgramDetailTools({
      window,
      normalizeCourseId,
      getCoursePageInfoMap: () => coursePageInfoMap,
      getCourseData: () => (typeof course_data !== 'undefined' ? course_data : []),
      getInfo: typeof getInfo === 'function' ? getInfo : window.getInfo,
    });
    const { normalizePlannerCode, getPlannerInfo, formatCredit: fmtCredit, getCourseDetails } = programDetailTools;

    const termContextTools = schedulerTermContext.createTermContextTools({
      window,
      termCode,
      normalizeCourseId,
      normalizePlannerCode,
      getSelected: () => selected,
    });
    const {
      buildSchedulerRequirementContext,
      computeTakenUpToTermSet,
      computeTakenBeforeCurrentTermSet,
    } = termContextTools;


    // Blocked-hour state and rendering are owned by the grid controller.


    const meetingModelTools = schedulerFoundation.createMeetingModelTools({
      gridMaxEndMin: GRID_MAX_END_MIN,
    });
    const {
      parseMeetingDateRange,
      dateWindowContainsDay,
      mergeDateWindows,
      dateWindowsOverlapOnDay,
      getSectionMeetingModel,
      getSectionIntervals,
      sectionHasIncompleteMeetingData,
    } = meetingModelTools;
    resultsController = schedulerResultsController.createResultsController({
      foundation: schedulerFoundation,
      results: schedulerResults,
      session: schedulerControllerSession,
      window,
      document,
      termCode,
      plannedCourses,
      resultsReconciler,
      controls: {
        body,
        resultsElement: resultsEl,
        searchElement: searchEl,
        loadMoreButton: loadMoreBtn,
        filterButton: filterBtn,
        filterCountElement: filterCountEl,
        filterMenuElement: filterMenuEl,
        hideTakenToggle,
        detailsToggle,
        scoreToggle,
        hoverPreviewToggle,
        highlightToggle,
        showBlockedToggle,
        minMainTypeSelect,
        minDmTypeSelect,
        minMinorTypeSelect,
        minSuInput,
        minEctsInput,
        minBsInput,
        minEngInput,
        prereqToggle,
        showUnmetPrereqToggle,
      },
      normalizePlannerCode,
      sectionInstructorPreview,
      sectionMeetingPreview,
      buildDetailUrl,
      getCourseDetails,
      formatCredit: fmtCredit,
      buildSchedulerRequirementContext,
      computeTakenUpToTermSet,
      computeTakenBeforeCurrentTermSet,
      buildReverseCoreqIndex: (...args) => selectionController.buildReverseCoreqIndex(...args),
      getCoreqsFor: (...args) => selectionController.getCoreqsFor(...args),
      getSelectedSection: (...args) => selectionController.getSelectedSection(...args),
      canFitWithBlockedHours: (...args) => gridController.canFitWithBlockedHours(...args),
      getOccupiedByDayFromSelected: (...args) => gridController.getOccupiedByDayFromSelected(...args),
      sectionAvailabilityClasses: (...args) => gridController.sectionAvailabilityClasses(...args),
      getRequiredBundleCourseIds: (...args) => gridController.getRequiredBundleCourseIds(...args),
      pickBestBundleSections: (...args) => gridController.pickBestBundleSections(...args),
      reconcileRenderedResults: () => gridController.reconcileRenderedResults(),
      resetHover: () => gridController.resetHover(),
      renderSelected: () => selectionController.renderSelected(),
      schedulerIsMounted,
    });
    const {
      renderResults,
      getLastQuery,
      expandedResultSections,
      shouldShowDetails,
      shouldHoverPreview,
      shouldHighlightAvailability,
      shouldShowBlockedCourses,
    } = resultsController;
    gridController = schedulerGrid.createGridController({
      foundation: schedulerFoundation,
      session: schedulerControllerSession,
      meeting: meetingModelTools,
      window,
      document,
      body,
      modal,
      blockModeButton: blockModeBtn,
      termCode,
      displayEndMin: DISPLAY_END_MIN,
      gridMaxEndMin: GRID_MAX_END_MIN,
      escapeHtml,
      shouldHoverPreview,
      shouldHighlightAvailability,
      shouldShowBlockedCourses,
      computeTakenBeforeCurrentTermSet,
      normalizePlannerCode,
      getCoreqsFor: (...args) => selectionController.getCoreqsFor(...args),
      computeBundleClosure: (...args) => selectionController.computeBundleClosure(...args),
      pickSectionForCourse: (...args) => selectionController.pickSectionForCourse(...args),
      openCourseDetailsModal,
      removeSelectionFromGrid: (...args) => selectionController.removeSelectionFromGrid(...args),
      renderResults,
      getLastQuery,
    });
    const {
      setBlockMode,
      isBlockMode,
      renderBlocked,
      canFitWithBlockedHours,
      getOccupiedByDayFromSelected,
      sectionAvailabilityClasses,
      getRequiredBundleCourseIds,
      pickBestBundleSections,
      renderGrid,
    } = gridController;
    selectionController = schedulerSelection.createSelectionController({
      foundation: schedulerFoundation,
      session: schedulerControllerSession,
      meeting: meetingModelTools,
      grid: gridController,
      window,
      termCode,
      selectedElement: selectedEl,
      resultsElement: resultsEl,
      clearButton: clearBtn,
      sectionMeetingPreview,
      sectionInstructorPreview,
      buildDetailUrl,
      openCourseDetailsModal,
      getCourseDetails,
      formatCredit: fmtCredit,
      shouldShowDetails,
      renderResults,
      getLastQuery,
      expandedResultSections,
      resultsReconciler,
    });
    const {
      getSelectedSection,
      buildReverseCoreqIndex,
      getCoreqsFor,
      computeBundleClosure,
      renderSelected,
      recomputeMissingCoreqs,
      pickSectionForCourse,
    } = selectionController;

    // Grid rendering is delegated to gridController.

    // Selection mutations and clear behavior are owned by selectionController.

    const plannerSyncSession = {};
    Object.defineProperties(plannerSyncSession, {
      scheduleIndex: {
        get: () => scheduleIndex,
        set: (value) => { scheduleIndex = value; },
      },
      coursePageInfoMap: {
        get: () => coursePageInfoMap,
        set: (value) => { coursePageInfoMap = value; },
      },
      selected: { get: () => selected },
    });
    plannerSyncController = schedulerPlannerSync.createPlannerSyncController({
      foundation: schedulerFoundation,
      session: plannerSyncSession,
      termCode,
      termName,
      ui,
      pickPlanBtn,
      planListEl,
      plannedCourses,
      normalizePlannerCode,
      getPlannerInfo,
      formatCredit: fmtCredit,
      renderResults,
      renderGrid,
      getLastQuery,
    });
    // Selected/results click mutations are bound by selectionController.

    // Multiple schedules (within the current term, per saved plan).
    const scheduleManagerSession = {};
    Object.defineProperties(scheduleManagerSession, {
      state: { get: () => state, set: (value) => { state = value; } },
      selected: { get: () => selected, set: (value) => { selected = value; } },
      blocked: { get: () => blocked, set: (value) => { blocked = value; } },
      scheduleIndex: { get: () => scheduleIndex, set: (value) => { scheduleIndex = value; } },
    });
    scheduleManagerController = schedulerCourseUi.createScheduleManager({
      foundation: schedulerFoundation,
      session: scheduleManagerSession,
      termCode,
      scheduleButton: scheduleBtn,
      scheduleName: scheduleNameEl,
      getActiveSchedule: schedulerSession.getActiveSchedule,
      applyScheduleUi,
      renderBlocked,
      recomputeMissingCoreqs,
      renderSelected,
      renderGrid,
      renderResults,
      getLastQuery,
    });

    // Grid preview and blocked-hour interactions are bound by gridController.

    // Render blocked-hours list immediately (even before schedule loads).
    renderBlocked();

    // Load the schedule and course metadata together. Both files are needed by
    // the initial result/corequisite pass, so serial network waits only delay
    // readiness. Every post-await DOM mutation is gated in case the user closes
    // the Scheduler while either file is still in flight.
    (async () => {
      const [idx, infoMap] = await Promise.all([
        scheduleIndexPromise,
        coursePageInfoPromise,
      ]);
      if (!schedulerIsMounted()) return;
      if (infoMap && typeof infoMap.get === 'function') coursePageInfoMap = infoMap;
      if (!idx) {
        resultsReconciler.renderHtml(
          `<div class="scheduler-muted">No schedule data found for <strong>${escapeHtml(termName || termCode)}</strong>.</div>` +
          `<div class="scheduler-muted">Expected file: <code>courses/schedule/${escapeHtml(termCode)}.jsonl</code></div>` +
          `<div class="scheduler-muted">Run the schedule scraper to generate it.</div>`
        );
        renderSelected();
        return;
      }
      scheduleIndex = idx;
      await recomputeMissingCoreqs();
      if (!schedulerIsMounted()) return;
      renderSelected();
      renderResults(idx, searchEl.value);
      renderGrid(idx);
      try { performance.mark('surriculum:scheduler-ready'); } catch (_) {}

      // Notify once if the schedule data has changed for any previously-seen
      // selected sections (hours/instructors), then refresh the "last seen"
      // baseline so the user isn't spammed repeatedly.
      try {
        const root = loadSchedulerState(termCode);
        const report = computeSelectedSectionChangeReport(idx, root);
        const changes = Array.isArray(report && report.changes) ? report.changes : [];
        const seen = (report && report.seen && typeof report.seen === 'object') ? report.seen : {};

        // Update baseline regardless of whether we show a popup.
        saveSchedulerState(termCode, { lastSeenScheduleSnapshots: seen });

        if (changes.length) {
          const ui = (typeof window !== 'undefined') ? window.uiModal : null;
          if (ui && typeof ui.alert === 'function') {
            const bySched = {};
            changes.forEach(ch => {
              const k = String(ch.scheduleName || ch.scheduleId || 'Schedule');
              bySched[k] = bySched[k] || [];
              bySched[k].push(ch);
            });

            const blocks = Object.keys(bySched).sort().map((name) => {
              const list = bySched[name] || [];
              const items = list.map(ch => {
                const what = [ch.hoursChanged ? 'Hours' : '', ch.instrChanged ? 'Instructor' : ''].filter(Boolean).join(' + ');
                const prevMeet = ch.prev && ch.prev.meetingSummary ? ch.prev.meetingSummary : '';
                const curMeet = ch.cur && ch.cur.meetingSummary ? ch.cur.meetingSummary : '';
                const prevInstr = ch.prev && ch.prev.instrSummary ? ch.prev.instrSummary : '';
                const curInstr = ch.cur && ch.cur.instrSummary ? ch.cur.instrSummary : '';
                const lines = [];
                if (ch.hoursChanged) lines.push(`<div class="scheduler-details-muted"><span class="muted">Hours:</span> ${escapeHtml(prevMeet || 'TBA')} → <strong>${escapeHtml(curMeet || 'TBA')}</strong></div>`);
                if (ch.instrChanged) lines.push(`<div class="scheduler-details-muted"><span class="muted">Instructor:</span> ${escapeHtml(prevInstr || '—')} → <strong>${escapeHtml(curInstr || '—')}</strong></div>`);
                return (
                  `<div class="scheduler-details-card">` +
                  `<div class="scheduler-details-card-title">${escapeHtml(ch.courseId)} <span class="muted">(CRN ${escapeHtml(ch.crn)})</span></div>` +
                  `<div class="scheduler-details-paragraph"><span class="muted">Changed:</span> ${escapeHtml(what || 'Schedule')}</div>` +
                  lines.join('') +
                  `</div>`
                );
              }).join('');
              return (
                `<div class="scheduler-details-subsection">` +
                `<div class="scheduler-details-subtitle">${escapeHtml(name)}</div>` +
                items +
                `</div>`
              );
            }).join('');

            ui.alert(
              'Schedule updated',
              `<div class="scheduler-details">` +
              `<div class="scheduler-details-paragraph">Some of your selected sections have changed since the last time you opened the scheduler.</div>` +
              blocks +
              `</div>`
            );
          }
        }
      } catch (_) {}

      planListEl.addEventListener('click', async (e) => {
        const btn = e.target && e.target.closest ? e.target.closest('.scheduler-plan-pick') : null;
        if (!btn) return;
        const courseId = normalizeCourseId(btn.getAttribute('data-course') || '');
        if (!courseId) return;
        if (!idx.get(courseId)) {
          const ui = (typeof window !== 'undefined') ? window.uiModal : null;
          if (ui && typeof ui.alert === 'function') {
            ui.alert('Not found in schedule', `<p>No schedule entries found for <strong>${escapeHtml(courseId)}</strong> in this term.</p>`);
          }
          return;
        }
        await pickSectionForCourse(idx, courseId);
      });

    })();
  }

  if (typeof window !== 'undefined') {
    window.loadTermScheduleIndex = loadTermScheduleIndex;
    window.openSchedulerModal = openSchedulerModal;
  }

  const bindSchedulerLauncher = () => {
    const button = document.getElementById('openSchedulerButton');
    if (!button || button.dataset.schedulerLauncherBound === 'true') return;
    button.dataset.schedulerLauncherBound = 'true';
    button.addEventListener('click', () => { openSchedulerModal(); });
  };
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bindSchedulerLauncher, { once: true });
    } else {
      bindSchedulerLauncher();
    }
  }
})();
