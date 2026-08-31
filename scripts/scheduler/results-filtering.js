// Scheduler result-filter preferences, feedback, and term-scoped scoring.
(function (root) {
  'use strict';

  function createResultFiltering(options) {
    const config = options || {};
    const window = config.window || root;
    const termCode = String(config.termCode || '');
    const preferenceGetItem = config.preferenceGetItem;
    const preferenceSetItem = config.preferenceSetItem;
    const {
      filterButton: filterBtn, filterCountElement: filterCountEl, filterMenuElement: filterMenuEl,
      hideTakenToggle, detailsToggle, scoreToggle, hoverPreviewToggle, highlightToggle,
      showBlockedToggle, minMainTypeSelect, minDmTypeSelect, minMinorTypeSelect,
      minSuInput, minEctsInput, minBsInput, minEngInput, prereqToggle, showUnmetPrereqToggle,
    } = config.controls || {};
    if (!window || typeof preferenceGetItem !== 'function' || typeof preferenceSetItem !== 'function') {
      throw new TypeError('Scheduler result filtering dependencies are incomplete.');
    }
    let filterMenuOpen = false;

    const readBool = (key, fallback) => {
      try {
        const value = preferenceGetItem(key);
        return value === null ? fallback : value === 'true';
      } catch (_) { return fallback; }
    };
    const readString = (key, fallback) => {
      try {
        const value = preferenceGetItem(key);
        return value === null ? fallback : String(value);
      } catch (_) { return fallback; }
    };
    const setGlobalBool = (key, value) => {
      preferenceSetItem(key, value ? 'true' : 'false');
      try {
        if (key === 'hideTakenCourses') window.hideTakenCourses = !!value;
        if (key === 'showCourseDetails') window.showCourseDetails = !!value;
        if (key === 'sortBasedOnScore') window.sortBasedOnScore = !!value;
      } catch (_) {}
    };
    const shouldHideTaken = () => {
      try {
        if (typeof window.hideTakenCourses !== 'undefined') return !!window.hideTakenCourses;
      } catch (_) {}
      return readBool('hideTakenCourses', true);
    };
    const shouldShowDetails = () => {
      try {
        if (typeof window.showCourseDetails !== 'undefined') return !!window.showCourseDetails;
      } catch (_) {}
      return readBool('showCourseDetails', true);
    };
    const shouldSortByScore = () => {
      try {
        if (typeof window.sortBasedOnScore !== 'undefined') return !!window.sortBasedOnScore;
      } catch (_) {}
      return readBool('sortBasedOnScore', true);
    };
    const shouldHoverPreview = () => readBool('schedulerHoverPreview', true);
    const shouldHighlightAvailability = () => readBool('schedulerHighlightAvailability', true);
    const shouldShowBlockedCourses = () => readBool('schedulerShowBlockedCourses', true);

    try { if (hideTakenToggle) hideTakenToggle.checked = typeof window.hideTakenCourses !== 'undefined' ? !!window.hideTakenCourses : shouldHideTaken(); } catch (_) {}
    try { if (detailsToggle) detailsToggle.checked = typeof window.showCourseDetails !== 'undefined' ? !!window.showCourseDetails : shouldShowDetails(); } catch (_) {}
    try { if (scoreToggle) scoreToggle.checked = typeof window.sortBasedOnScore !== 'undefined' ? !!window.sortBasedOnScore : shouldSortByScore(); } catch (_) {}
    try { if (hoverPreviewToggle) hoverPreviewToggle.checked = shouldHoverPreview(); } catch (_) {}
    try { if (highlightToggle) highlightToggle.checked = shouldHighlightAvailability(); } catch (_) {}
    try { if (showBlockedToggle) showBlockedToggle.checked = shouldShowBlockedCourses(); } catch (_) {}
    [
      [minMainTypeSelect, 'schedulerMinMajorType'],
      [minDmTypeSelect, 'schedulerMinDmType'],
      [minMinorTypeSelect, 'schedulerMinMinorType'],
      [minSuInput, 'schedulerMinSuCredits'],
      [minEctsInput, 'schedulerMinEcts'],
      [minBsInput, 'schedulerMinBasicScience'],
      [minEngInput, 'schedulerMinEngineering'],
    ].forEach(([element, key]) => {
      try { if (element) element.value = readString(key, ''); } catch (_) {}
    });
    try { if (prereqToggle) prereqToggle.checked = readBool('schedulerCheckPrereqs', true); } catch (_) {}
    try { if (showUnmetPrereqToggle) showUnmetPrereqToggle.checked = readBool('schedulerShowUnmetPrereqs', true); } catch (_) {}

    const syncPrereqUi = () => {
      try {
        if (showUnmetPrereqToggle) showUnmetPrereqToggle.disabled = !(prereqToggle && prereqToggle.checked);
      } catch (_) {}
    };
    const countActiveFilters = () => {
      try {
        const common = {
          hideTaken: !!(hideTakenToggle && hideTakenToggle.checked),
          minSu: minSuInput && minSuInput.value,
          minEcts: minEctsInput && minEctsInput.value,
          minBasicScience: minBsInput && minBsInput.value,
          minEngineering: minEngInput && minEngInput.value,
          checkPrerequisites: !!(prereqToggle && prereqToggle.checked),
          showUnmetPrerequisites: !!(showUnmetPrereqToggle && showUnmetPrereqToggle.checked),
        };
        const api = window.courseFilters;
        let count = api && typeof api.countActiveFilters === 'function'
          ? api.countActiveFilters(common) : 0;
        if (!api || typeof api.countActiveFilters !== 'function') {
          const positive = (value) => Number.parseFloat(String(value == null ? '' : value).trim()) > 0;
          if (common.hideTaken) count++;
          if (positive(common.minSu)) count++;
          if (positive(common.minEcts)) count++;
          if (positive(common.minBasicScience)) count++;
          if (positive(common.minEngineering)) count++;
          if (common.checkPrerequisites && !common.showUnmetPrerequisites) count++;
        }
        if (minMainTypeSelect && String(minMainTypeSelect.value || '').trim()) count++;
        if (minDmTypeSelect && String(minDmTypeSelect.value || '').trim()) count++;
        if (minMinorTypeSelect && String(minMinorTypeSelect.value || '').trim()) count++;
        if (showBlockedToggle && !showBlockedToggle.checked) count++;
        return count;
      } catch (_) { return 0; }
    };
    const syncFilterButtonFeedback = () => {
      try {
        const count = countActiveFilters();
        if (filterCountEl) {
          filterCountEl.textContent = String(count);
          filterCountEl.hidden = count <= 0;
        }
        if (filterBtn) {
          filterBtn.classList.toggle('has-active-filters', count > 0);
          filterBtn.setAttribute('aria-label', count > 0 ? `Filters, ${count} active` : 'Filters');
        }
      } catch (_) {}
    };
    const setFilterMenuOpen = (open) => {
      filterMenuOpen = !!open;
      try {
        if (filterMenuEl) {
          filterMenuEl.hidden = !filterMenuOpen;
          filterMenuEl.classList.toggle('is-open', filterMenuOpen);
        }
        if (filterBtn) {
          filterBtn.classList.toggle('is-active', filterMenuOpen);
          filterBtn.setAttribute('aria-expanded', filterMenuOpen ? 'true' : 'false');
        }
      } catch (_) {}
    };
    syncPrereqUi();
    syncFilterButtonFeedback();
    setFilterMenuOpen(false);

    const scoreRankerOptions = {
      progressPolicy: 'before-target',
      targetTermCode: termCode,
    };
    let scoreRanker = null;
    let scoreRankerKey = '';
    const buildScoreRanker = () => {
      try {
        const keyFor = (typeof window !== 'undefined')
          ? window.getCourseSuggestionScorerKey : null;
        const nextKey = (typeof keyFor === 'function')
          ? keyFor(scoreRankerOptions) : '';
        if (scoreRanker && (!nextKey || scoreRankerKey === nextKey)) {
          return scoreRanker;
        }
        const build = (typeof window !== 'undefined')
          ? window.buildCourseSuggestionScorer : null;
        if (typeof build === 'function') {
          scoreRanker = build(scoreRankerOptions);
          scoreRankerKey = (scoreRanker && scoreRanker.key)
            ? scoreRanker.key : nextKey;
          return scoreRanker;
        }
      } catch (_) {}
      return null;
    };

    const computeScore = (courseId, ranker) => {
      try {
        if (ranker && typeof ranker.score === 'function') {
          return ranker.score(courseId) || 0;
        }
        const fn = (typeof window !== 'undefined') ? window.computeCourseSuggestionScore : null;
        if (typeof fn === 'function') {
          return fn(courseId, scoreRankerOptions) || 0;
        }
      } catch (_) {}
      return 0;
    };

    return Object.freeze({
      readBool,
      readString,
      setGlobalBool,
      shouldHideTaken,
      shouldShowDetails,
      shouldSortByScore,
      shouldHoverPreview,
      shouldHighlightAvailability,
      shouldShowBlockedCourses,
      syncPrereqUi,
      countActiveFilters,
      syncFilterButtonFeedback,
      setFilterMenuOpen,
      isFilterMenuOpen: () => filterMenuOpen,
      buildScoreRanker,
      computeScore,
      scoreRankerOptions: Object.freeze(Object.assign({}, scoreRankerOptions)),
    });
  }

  const api = Object.freeze({ createResultFiltering });
  if (root) root.SurriculumSchedulerResultFiltering = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
