// Scheduler course-detail and static shell presentation helpers.
(function (root) {
  'use strict';


  const schedulerCourseDetails = (root && root.SurriculumSchedulerCourseDetails)
    || (typeof module !== 'undefined' && module.exports ? require('./course-details.js') : null);
  if (!schedulerCourseDetails) throw new Error('Scheduler course details are not loaded.');
  const { createCourseDetailsController } = schedulerCourseDetails;

  function createMobileDayTabsController(options) {
    const config = options || {};
    const modal = config.modal;
    const schedulerDialogId = String(config.schedulerDialogId || 'scheduler');
    if (!modal) throw new TypeError('Mobile day tabs require a scheduler modal.');

    const sync = () => {
      try {
        const tablist = modal.querySelector('.m-sched-days');
        if (!tablist) return;
        tablist.setAttribute('role', 'tablist');
        tablist.setAttribute('aria-label', 'Schedule days');
        tablist.setAttribute('aria-orientation', 'horizontal');
        const tabs = Array.from(tablist.querySelectorAll('.m-sched-day'));
        const selectedDay = String(modal.getAttribute('data-m-day') || '');
        tabs.forEach((tab, index) => {
          const dayKey = String(tab.getAttribute('data-day') || '');
          const selected = dayKey === selectedDay || (!selectedDay && index === 0);
          const panel = modal.querySelector(`.scheduler-day-col[data-day="${dayKey}"]`);
          if (panel && !panel.id) panel.id = `${schedulerDialogId}-day-${dayKey}`;
          tab.setAttribute('role', 'tab');
          tab.setAttribute('aria-selected', selected ? 'true' : 'false');
          tab.tabIndex = selected ? 0 : -1;
          if (panel && panel.id) tab.setAttribute('aria-controls', panel.id);
        });
      } catch (_) {}
    };

    const onClick = (event) => {
      const tab = event.target && event.target.closest ? event.target.closest('.m-sched-day') : null;
      if (!tab) return;
      try { setTimeout(sync, 0); } catch (_) { sync(); }
    };
    const onKeydown = (event) => {
      const tab = event.target && event.target.closest ? event.target.closest('.m-sched-day') : null;
      if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const tabs = Array.from(modal.querySelectorAll('.m-sched-days .m-sched-day'));
      const currentIndex = tabs.indexOf(tab);
      if (currentIndex < 0 || !tabs.length) return;
      let nextIndex = currentIndex;
      if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
      if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = tabs.length - 1;
      event.preventDefault();
      const next = tabs[nextIndex];
      if (!next) return;
      next.click();
      try { next.focus({ preventScroll: true }); } catch (_) {}
      sync();
    };

    modal.addEventListener('click', onClick);
    modal.addEventListener('keydown', onKeydown);
    let observer = null;
    try {
      observer = new MutationObserver(sync);
      observer.observe(modal, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-m-day'],
      });
    } catch (_) {}

    return Object.freeze({
      sync,
      dispose() {
        try { modal.removeEventListener('click', onClick); } catch (_) {}
        try { modal.removeEventListener('keydown', onKeydown); } catch (_) {}
        try { if (observer) observer.disconnect(); } catch (_) {}
        observer = null;
      },
    });
  }

  function createTermSelectorController(options) {
    const config = options || {};
    const foundation = config.foundation;
    const select = config.select;
    if (!foundation || !select) return Object.freeze({ dispose() {} });
    const termCode = String(config.termCode || '');
    const currentTermCode = String(config.currentTermCode || '');
    const availableTerms = Array.isArray(config.availableTerms) ? config.availableTerms.slice() : [];

    try {
      select.innerHTML = availableTerms.map((code) => {
        const label = foundation.displayTermNameSafe(code) || code;
        return `<option value="${foundation.escapeHtml(code)}">${foundation.escapeHtml(label)}</option>`;
      }).join('');
      select.value = termCode;
    } catch (_) {}

    const onChange = async () => {
      const nextTermCode = foundation.resolveSchedulerTermCode(
        select.value,
        availableTerms,
        currentTermCode,
      );
      if (!nextTermCode || nextTermCode === termCode) {
        try { select.value = termCode; } catch (_) {}
        return;
      }
      foundation.setSavedSchedulerSelectedTerm(nextTermCode);
      await foundation.maybeWarnFutureSchedulerTerm(nextTermCode, currentTermCode, config.ui);
      config.close();
      try { await config.open(nextTermCode); } catch (_) {}
    };
    select.addEventListener('change', onChange);
    return Object.freeze({
      dispose() {
        try { select.removeEventListener('change', onChange); } catch (_) {}
      },
    });
  }

  function createScheduleManager(options) {
    const config = options || {};
    const foundation = config.foundation;
    const session = config.session;
    if (!foundation || !session) throw new TypeError('Schedule manager requires foundation and session.');
    const scheduleButton = config.scheduleButton;
    const scheduleName = config.scheduleName;
    const termCode = String(config.termCode || '');
    const getActiveSchedule = config.getActiveSchedule;
    const maxSchedules = 10;
    const newScheduleId = () => `sched_${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`;
    const normalizeScheduleName = (value) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, 200);

    const saveSchedulerRoot = (rootState) => {
      try {
        foundation.planSetItem(`schedulerState_${termCode}`, JSON.stringify(rootState || {}));
      } catch (_) {}
    };
    const refreshScheduleLabel = (rootState) => {
      try {
        if (!scheduleName) return;
        const active = getActiveSchedule(rootState || session.state);
        scheduleName.textContent = String(active && active.name ? active.name : 'Schedule');
      } catch (_) {}
    };

    const applyActiveScheduleFromRoot = async (rootState) => {
      session.state = rootState || foundation.loadSchedulerState(termCode);
      const active = getActiveSchedule(session.state);
      session.selected = active.selected && typeof active.selected === 'object' ? active.selected : {};
      session.blocked = Array.isArray(active.blocked) ? active.blocked : [];
      try { session.state.selected = session.selected; } catch (_) {}
      try { session.state.blocked = session.blocked; } catch (_) {}
      try { session.state.ui = active.ui && typeof active.ui === 'object' ? active.ui : {}; } catch (_) {}
      saveSchedulerRoot(session.state);

      refreshScheduleLabel();
      config.applyScheduleUi();
      try { config.renderBlocked(); } catch (_) {}
      try { await config.recomputeMissingCoreqs(); } catch (_) {}
      try { config.renderSelected(); } catch (_) {}
      try {
        if (session.scheduleIndex) {
          config.renderGrid(session.scheduleIndex);
          config.renderResults(session.scheduleIndex, config.getLastQuery());
        }
      } catch (_) {}
    };

    const openScheduleManager = async () => {
      const ui = root && root.uiModal ? root.uiModal : null;
      while (true) {
        const rootState = foundation.loadSchedulerState(termCode);
        const schedules = rootState.schedules && typeof rootState.schedules === 'object'
          ? rootState.schedules : null;
        const items = schedules && schedules.items && typeof schedules.items === 'object'
          ? schedules.items : {};
        const order = Array.isArray(schedules && schedules.order) ? schedules.order.slice() : [];
        const activeId = schedules && schedules.activeId
          ? String(schedules.activeId) : (order[0] || 'default');
        const active = items[activeId] || getActiveSchedule(rootState);
        const listItems = order.map((scheduleId) => {
          const item = items[scheduleId] || {};
          const selectedCount = item.selected && typeof item.selected === 'object'
            ? Object.keys(item.selected).length : 0;
          const blockedCount = Array.isArray(item.blocked) ? item.blocked.length : 0;
          const meta = [];
          if (selectedCount) meta.push(`${selectedCount} selected`);
          if (blockedCount) meta.push(`${blockedCount} blocked`);
          if (String(scheduleId) === activeId) meta.unshift('Active');
          return {
            action: 'switch',
            value: String(scheduleId),
            label: String(item.name || scheduleId),
            subLabel: meta.length ? meta.join(' • ') : '',
          };
        });

        const result = await foundation.createPickerModal({
          title: 'Schedules',
          bodyHtml: '<p>Save multiple scheduler setups for this term (different section combinations / blocked hours).</p>',
          listItems,
          buttons: [
            { action: 'new', label: 'New', variant: 'primary' },
            { action: 'dup', label: 'Duplicate', variant: 'secondary' },
            { action: 'rename', label: 'Rename', variant: 'secondary' },
            { action: 'delete', label: 'Delete', variant: 'danger' },
            { action: 'close', label: 'Close', variant: 'secondary' },
          ],
        });
        if (!result || !result.action || result.action === 'close' || result.action === 'cancel') return;

        if (result.action === 'switch') {
          const targetId = String(result.value || '');
          if (!targetId || !items[targetId]) continue;
          try { rootState.schedules.activeId = targetId; } catch (_) {}
          await applyActiveScheduleFromRoot(rootState);
          continue;
        }

        if (result.action === 'new' || result.action === 'dup') {
          if (order.length >= maxSchedules) {
            if (ui && typeof ui.alert === 'function') {
              ui.alert('Schedule limit', `<p>You can have up to <strong>${maxSchedules}</strong> schedules per term.</p>`);
            }
            continue;
          }
          const id = newScheduleId();
          const copy = result.action === 'dup';
          const next = {
            id,
            name: copy
              ? normalizeScheduleName(`${String(active && active.name ? active.name : 'Schedule')} (copy)`)
              : 'New schedule',
            selected: copy && active && active.selected
              ? JSON.parse(JSON.stringify(active.selected)) : {},
            blocked: copy && Array.isArray(active && active.blocked)
              ? JSON.parse(JSON.stringify(active.blocked)) : [],
            ui: active && active.ui ? JSON.parse(JSON.stringify(active.ui)) : {},
          };
          try { items[id] = next; } catch (_) {}
          try { rootState.schedules.order.push(id); } catch (_) {}
          try { rootState.schedules.activeId = id; } catch (_) {}
          await applyActiveScheduleFromRoot(rootState);
          continue;
        }

        if (result.action === 'rename') {
          const promptResult = await foundation.createTextInputModal({
            title: 'Rename schedule',
            bodyHtml: '<p>Choose a name for this schedule.</p>',
            initialValue: String(active && active.name ? active.name : ''),
            placeholder: 'Schedule name',
            okLabel: 'Rename',
          });
          const name = promptResult && promptResult.action === 'ok'
            ? normalizeScheduleName(promptResult.value) : '';
          if (!name) continue;
          try { items[activeId].name = name; } catch (_) {}
          saveSchedulerRoot(rootState);
          refreshScheduleLabel(rootState);
          continue;
        }

        if (result.action === 'delete') {
          if (order.length <= 1) {
            if (ui && typeof ui.alert === 'function') {
              ui.alert('Cannot delete', '<p>You must keep at least one schedule.</p>');
            }
            continue;
          }
          const confirmation = await foundation.createPickerModal({
            title: 'Delete schedule',
            bodyHtml: `<p>Delete <strong>${foundation.escapeHtml(String(active && active.name ? active.name : 'this schedule'))}</strong>?</p>`,
            buttons: [
              { action: 'cancel', label: 'Cancel', variant: 'secondary' },
              { action: 'delete', label: 'Delete', variant: 'danger' },
            ],
          });
          if (!confirmation || confirmation.action !== 'delete') continue;
          try { delete items[activeId]; } catch (_) {}
          try {
            rootState.schedules.order = order.filter((id) => String(id) !== String(activeId));
          } catch (_) {}
          try { rootState.schedules.activeId = String(rootState.schedules.order[0] || 'default'); } catch (_) {}
          await applyActiveScheduleFromRoot(rootState);
        }
      }
    };

    const onClick = async () => {
      try { await openScheduleManager(); } catch (_) {}
    };
    if (scheduleButton) scheduleButton.addEventListener('click', onClick);
    refreshScheduleLabel();
    return Object.freeze({
      applyActiveScheduleFromRoot,
      openScheduleManager,
      refreshScheduleLabel,
      dispose() {
        try { if (scheduleButton) scheduleButton.removeEventListener('click', onClick); } catch (_) {}
      },
    });
  }

  function createSchedulerBody(options) {
    const config = options || {};
    const isCurrentSchedulerTerm = config.isCurrentSchedulerTerm === true;
    const termName = String(config.termName || '');
    const schedulerDialogId = String(config.schedulerDialogId || 'scheduler');
    const DAYS = Array.isArray(config.days) ? config.days : [];
    const escapeHtml = typeof config.escapeHtml === 'function'
      ? config.escapeHtml : (value) => String(value == null ? '' : value);

    const body = document.createElement('div');
    body.className = 'scheduler-body';
    const plannerSectionTitle = isCurrentSchedulerTerm ? 'Current Term Plan' : 'Planner Semester';
    const plannerUpdateLabel = isCurrentSchedulerTerm ? 'Update current-term plan' : 'Update planner semester';
    const plannerHintHtml = isCurrentSchedulerTerm
      ? ''
      : `<div class="scheduler-term-note">Planner sync targets <strong>${escapeHtml(termName)}</strong>.</div>`;

    const schedulerFilterControlsHtml =
      `<div class="scheduler-controls">` +
      `  <div class="scheduler-control control-row toggle-row">` +
      `    <div class="toggle-text">Hide courses planned before the selected term</div>` +
      `    <label class="toggle-switch"><input class="scheduler-toggle-hide-taken" type="checkbox" aria-label="Hide courses planned before the selected term" /><span class="toggle-slider"></span></label>` +
      `  </div>` +
      `  <div class="scheduler-control control-row toggle-row">` +
      `    <div class="toggle-text">Show course details</div>` +
      `    <label class="toggle-switch"><input class="scheduler-toggle-details" type="checkbox" aria-label="Show course details" /><span class="toggle-slider"></span></label>` +
      `  </div>` +
      `  <div class="scheduler-control control-row toggle-row">` +
      `    <div class="toggle-text">Smart Sort</div>` +
      `    <label class="toggle-switch"><input class="scheduler-toggle-score" type="checkbox" aria-label="Smart Sort" /><span class="toggle-slider"></span></label>` +
      `  </div>` +
      `  <div class="scheduler-control control-row toggle-row">` +
      `    <div class="toggle-text">Hover preview</div>` +
      `    <label class="toggle-switch"><input class="scheduler-toggle-hover-preview" type="checkbox" aria-label="Hover preview" /><span class="toggle-slider"></span></label>` +
      `  </div>` +
      `  <div class="scheduler-control control-row toggle-row">` +
      `    <div class="toggle-text">Highlight course availability</div>` +
      `    <label class="toggle-switch"><input class="scheduler-toggle-highlight" type="checkbox" aria-label="Highlight course availability" /><span class="toggle-slider"></span></label>` +
      `  </div>` +
      `  <div class="scheduler-control control-row toggle-row">` +
      `    <div class="toggle-text">Show blocked courses</div>` +
      `    <label class="toggle-switch"><input class="scheduler-toggle-show-blocked" type="checkbox" aria-label="Show blocked courses" /><span class="toggle-slider"></span></label>` +
      `  </div>` +
      `  <div class="scheduler-control control-row toggle-row">` +
      `    <div class="toggle-text">Check prerequisites</div>` +
      `    <label class="toggle-switch"><input class="scheduler-toggle-prereq" type="checkbox" aria-label="Check prerequisites" /><span class="toggle-slider"></span></label>` +
      `  </div>` +
      `  <div class="scheduler-control control-row toggle-row">` +
      `    <div class="toggle-text">Show unmet prerequisites</div>` +
      `    <label class="toggle-switch"><input class="scheduler-toggle-show-unmet-prereq" type="checkbox" aria-label="Show unmet prerequisites" /><span class="toggle-slider"></span></label>` +
      `  </div>` +
      `  <div class="scheduler-control scheduler-filter-row">` +
      `    <label class="scheduler-filter-label" for="${schedulerDialogId}-min-su">Min SU credits</label>` +
      `    <input id="${schedulerDialogId}-min-su" class="select-control scheduler-filter-min-su" type="number" min="0" step="0.5" placeholder="0" />` +
      `  </div>` +
      `  <div class="scheduler-control scheduler-filter-row">` +
      `    <label class="scheduler-filter-label" for="${schedulerDialogId}-min-ects">Min ECTS</label>` +
      `    <input id="${schedulerDialogId}-min-ects" class="select-control scheduler-filter-min-ects" type="number" min="0" step="1" placeholder="0" />` +
      `  </div>` +
      `  <div class="scheduler-control scheduler-filter-row">` +
      `    <label class="scheduler-filter-label" for="${schedulerDialogId}-min-bs">Min Basic Science</label>` +
      `    <input id="${schedulerDialogId}-min-bs" class="select-control scheduler-filter-min-bs" type="number" min="0" step="0.5" placeholder="0" />` +
      `  </div>` +
      `  <div class="scheduler-control scheduler-filter-row">` +
      `    <label class="scheduler-filter-label" for="${schedulerDialogId}-min-eng">Min Engineering</label>` +
      `    <input id="${schedulerDialogId}-min-eng" class="select-control scheduler-filter-min-eng" type="number" min="0" step="0.5" placeholder="0" />` +
      `  </div>` +
      `  <div class="scheduler-control scheduler-filter-row">` +
      `    <label class="scheduler-filter-label" for="${schedulerDialogId}-min-main">Min Major type</label>` +
      `    <select id="${schedulerDialogId}-min-main" class="select-control scheduler-filter-min-main">` +
      `      <option value="">Any</option>` +
      `      <option value="free">Free</option>` +
      `      <option value="area">Area</option>` +
      `      <option value="core">Core</option>` +
      `      <option value="university">University</option>` +
      `      <option value="required">Required</option>` +
      `    </select>` +
      `  </div>` +
      `  <div class="scheduler-control scheduler-filter-row">` +
      `    <label class="scheduler-filter-label" for="${schedulerDialogId}-min-dm">Min Double Major type</label>` +
      `    <select id="${schedulerDialogId}-min-dm" class="select-control scheduler-filter-min-dm">` +
      `      <option value="">Any</option>` +
      `      <option value="free">Free</option>` +
      `      <option value="area">Area</option>` +
      `      <option value="core">Core</option>` +
      `      <option value="university">University</option>` +
      `      <option value="required">Required</option>` +
      `    </select>` +
      `  </div>` +
      `  <div class="scheduler-control scheduler-filter-row">` +
      `    <label class="scheduler-filter-label" for="${schedulerDialogId}-min-minor">Min Minor type</label>` +
      `    <select id="${schedulerDialogId}-min-minor" class="select-control scheduler-filter-min-minor">` +
      `      <option value="">Any</option>` +
      `      <option value="free">Free</option>` +
      `      <option value="area">Area</option>` +
      `      <option value="core">Core</option>` +
      `      <option value="university">University</option>` +
      `      <option value="required">Required</option>` +
      `    </select>` +
      `  </div>` +
      `</div>`;

    body.innerHTML =
      `<div class="scheduler-layout">` +
      `  <div class="scheduler-sidebar">` +
      `    <div class="scheduler-sidebar-top">` +
      `      <div class="scheduler-term-row">` +
      `        <label class="scheduler-term-label" for="${schedulerDialogId}-term">Schedule term</label>` +
      `        <div class="scheduler-term-controls">` +
      `          <select id="${schedulerDialogId}-term" class="select-control scheduler-term-select${isCurrentSchedulerTerm ? ' is-current' : ''}"></select>` +
      `          ${isCurrentSchedulerTerm ? '<span class="scheduler-term-badge is-current">Current</span>' : ''}` +
      `        </div>` +
      `      </div>` +
      `      <div class="scheduler-schedule-row">` +
      `        <button type="button" class="btn btn-secondary btn-sm scheduler-schedule-toggle" title="Switch schedule" aria-label="Switch schedule"><i class="fa-solid fa-layer-group" aria-hidden="true"></i>&nbsp;<span class="scheduler-schedule-name">Default schedule</span></button>` +
      `      </div>` +
      `      <div class="scheduler-hint">Adds sections with lecture/recitation/lab meeting times. Conflicts are highlighted.</div>` +
      `    </div>` +
      `    <div class="scheduler-sidebar-section scheduler-collapsible" data-collapsible="plan">` +
      `      <button type="button" class="scheduler-collapsible-header" aria-expanded="true" aria-controls="${schedulerDialogId}-plan-panel">` +
      `        <span>${escapeHtml(plannerSectionTitle)}</span>` +
      `        <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>` +
      `      </button>` +
      `      <div id="${schedulerDialogId}-plan-panel" class="scheduler-collapsible-body">` +
      `        ${plannerHintHtml}` +
      `        <div class="scheduler-plan-list"></div>` +
      `      </div>` +
      `    </div>` +
      `    <div class="scheduler-sidebar-section scheduler-collapsible" data-collapsible="selected">` +
      `      <button type="button" class="scheduler-collapsible-header" aria-expanded="true" aria-controls="${schedulerDialogId}-selected-panel">` +
      `        <span>Selected Sections</span>` +
      `        <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>` +
      `      </button>` +
      `      <div id="${schedulerDialogId}-selected-panel" class="scheduler-collapsible-body">` +
      `        <div class="scheduler-selected"></div>` +
      `        <div class="scheduler-selected-actions">` +
      `          <button class="btn btn-danger btn-sm scheduler-clear" type="button">Clear</button>` +
      `          <button class="btn btn-primary btn-sm scheduler-pick-plan" type="button">${escapeHtml(plannerUpdateLabel)}</button>` +
      `        </div>` +
      `      </div>` +
      `    </div>` +
      `    <div class="scheduler-sidebar-section scheduler-collapsible" data-collapsible="blocked">` +
      `      <button type="button" class="scheduler-collapsible-header" aria-expanded="true" aria-controls="${schedulerDialogId}-blocked-panel">` +
      `        <span>Blocked Hours</span>` +
      `        <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>` +
      `      </button>` +
      `      <div id="${schedulerDialogId}-blocked-panel" class="scheduler-collapsible-body">` +
      `        <div class="scheduler-blocked-hint">Click <strong>Block hours</strong>, then click+drag on the grid to block time.</div>` +
      `        <div class="scheduler-blocked-list"></div>` +
      `        <div class="scheduler-blocked-actions">` +
      `          <button class="btn btn-secondary btn-sm scheduler-blocked-toggle" type="button">Block hours</button>` +
      `          <button class="btn btn-danger btn-sm scheduler-blocked-clear" type="button">Clear</button>` +
      `        </div>` +
      `      </div>` +
      `    </div>` +
      `    <div class="scheduler-sidebar-section scheduler-results-section">` +
      `      <div class="scheduler-results-head">` +
      `        <div class="scheduler-section-title">Courses</div>` +
      `        <div class="scheduler-search-row">` +
      `          <input class="scheduler-search" type="text" aria-label="Search courses" placeholder="Search courses (e.g., CS 201, programming)..." />` +
      `          <button class="btn btn-secondary btn-sm scheduler-filter-btn" type="button" aria-label="Filters" aria-expanded="false" aria-controls="${schedulerDialogId}-filters"><i class="fa-solid fa-filter" aria-hidden="true"></i><span class="scheduler-filter-btn-label">Filters</span><span class="scheduler-filter-count" aria-hidden="true" hidden>0</span></button>` +
      `        </div>` +
      `        <div id="${schedulerDialogId}-filters" class="scheduler-filter-menu" role="region" aria-labelledby="${schedulerDialogId}-filters-title" hidden>` +
      `          <div id="${schedulerDialogId}-filters-title" class="scheduler-filter-menu-header">Filter Options</div>` +
      schedulerFilterControlsHtml +
      `        </div>` +
      `      </div>` +
      `      <div class="scheduler-results"></div>` +
      `      <div class="scheduler-results-actions">` +
      `        <button class="btn btn-secondary btn-sm scheduler-load-more" type="button" style="width:100%; display:none;">Load more</button>` +
      `      </div>` +
      `    </div>` +
      `  </div>` +
      `  <div class="scheduler-grid-wrap">` +
      `    <div class="scheduler-grid-header">` +
      `      <div class="scheduler-grid-corner">` +
      `        <button type="button" class="scheduler-corner-btn scheduler-sidebar-toggle" title="Collapse sidebar" aria-label="Collapse scheduler sidebar" aria-expanded="true"><i class="fa-solid fa-angles-left" aria-hidden="true"></i></button>` +
      `      </div>` +
      DAYS.map(d => `<div class="scheduler-grid-day" data-day="${d.key}"${d.optional ? ' hidden' : ''}>${escapeHtml(d.label)}</div>`).join('') +
      `    </div>` +
      `    <div class="scheduler-grid">` +
      `      <div class="scheduler-times"></div>` +
      DAYS.map(d => `<div class="scheduler-day-col" data-day="${d.key}"${d.optional ? ' hidden' : ''}></div>`).join('') +
      `    </div>` +
      `  </div>` +
      `</div>`;

    return body;
  }

  const api = Object.freeze({
    createCourseDetailsController,
    createMobileDayTabsController,
    createTermSelectorController,
    createScheduleManager,
    createSchedulerBody,
  });
  if (root) root.SurriculumSchedulerCourseUi = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
