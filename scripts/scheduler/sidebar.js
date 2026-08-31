// Scheduler sidebar collapse state and interaction controller.
(function (root) {
  'use strict';

  function createSidebarController(options) {
    const config = options || {};
    const body = config.body;
    const sidebarToggleBtn = config.sidebarToggleButton;
    const termCode = String(config.termCode || '');
    const loadSchedulerState = config.loadSchedulerState;
    const saveSchedulerState = config.saveSchedulerState;
    const getActiveSchedule = config.getActiveSchedule;
    const getState = config.getState;
    const getGridController = config.getGridController;
    if (!body || typeof loadSchedulerState !== 'function' || typeof saveSchedulerState !== 'function'
        || typeof getActiveSchedule !== 'function' || typeof getState !== 'function'
        || typeof getGridController !== 'function') {
      throw new TypeError('Scheduler sidebar dependencies are incomplete.');
    }

    const applyCollapse = (key, collapsed) => {
      const sec = body.querySelector(`.scheduler-collapsible[data-collapsible="${key}"]`);
      if (!sec) return;
      const next = !!collapsed;
      sec.classList.toggle('is-collapsed', next);
      const btn = sec.querySelector('.scheduler-collapsible-header');
      const panel = sec.querySelector('.scheduler-collapsible-body');
      if (btn) btn.setAttribute('aria-expanded', next ? 'false' : 'true');
      if (panel) panel.hidden = next;
    };
    const applyScheduleUi = () => {
      try {
        const root = getState() || loadSchedulerState(termCode);
        const active = getActiveSchedule(root);
        const uiState = active.ui && typeof active.ui === 'object' ? active.ui : {};
        applyCollapse('plan', !!uiState.planCollapsed);
        applyCollapse('selected', !!uiState.selectedCollapsed);
        applyCollapse('blocked', !!uiState.blockedCollapsed);
        body.classList.toggle('is-sidebar-collapsed', !!uiState.sidebarCollapsed);
        try {
          const icon = sidebarToggleBtn ? sidebarToggleBtn.querySelector('i') : null;
          if (icon) {
            icon.className = body.classList.contains('is-sidebar-collapsed')
              ? 'fa-solid fa-angles-right'
              : 'fa-solid fa-angles-left';
          }
          if (sidebarToggleBtn) {
            const expanded = !body.classList.contains('is-sidebar-collapsed');
            sidebarToggleBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
            sidebarToggleBtn.setAttribute('aria-label', expanded ? 'Collapse scheduler sidebar' : 'Expand scheduler sidebar');
            sidebarToggleBtn.setAttribute('title', expanded ? 'Collapse sidebar' : 'Expand sidebar');
          }
        } catch (_) {}
        try { const grid = getGridController(); if (grid) grid.invalidateSchedulerLayout(); } catch (_) {}
      } catch (_) {}
    };
    applyScheduleUi();

    if (sidebarToggleBtn) {
      sidebarToggleBtn.addEventListener('click', () => {
        body.classList.toggle('is-sidebar-collapsed');
        const root = loadSchedulerState(termCode);
        const active = getActiveSchedule(root);
        active.ui = active.ui && typeof active.ui === 'object' ? active.ui : {};
        active.ui.sidebarCollapsed = body.classList.contains('is-sidebar-collapsed');
        saveSchedulerState(termCode, { ui: active.ui });
        try {
          const icon = sidebarToggleBtn.querySelector('i');
          if (icon) {
            icon.className = active.ui.sidebarCollapsed
              ? 'fa-solid fa-angles-right'
              : 'fa-solid fa-angles-left';
          }
          const expanded = !active.ui.sidebarCollapsed;
          sidebarToggleBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
          sidebarToggleBtn.setAttribute('aria-label', expanded ? 'Collapse scheduler sidebar' : 'Expand scheduler sidebar');
          sidebarToggleBtn.setAttribute('title', expanded ? 'Collapse sidebar' : 'Expand sidebar');
        } catch (_) {}
        try { const grid = getGridController(); if (grid) grid.invalidateSchedulerLayout(); } catch (_) {}
      });
    }

    body.querySelectorAll('.scheduler-collapsible-header').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sec = btn.closest('.scheduler-collapsible');
        if (!sec) return;
        const key = sec.getAttribute('data-collapsible') || '';
        const collapsed = !sec.classList.contains('is-collapsed');
        applyCollapse(key, collapsed);
        const root = loadSchedulerState(termCode);
        const active = getActiveSchedule(root);
        active.ui = active.ui && typeof active.ui === 'object' ? active.ui : {};
        if (key === 'plan') active.ui.planCollapsed = collapsed;
        if (key === 'selected') active.ui.selectedCollapsed = collapsed;
        if (key === 'blocked') active.ui.blockedCollapsed = collapsed;
        // Persist only UI state (stored on the active schedule).
        saveSchedulerState(termCode, { ui: active.ui });
      });
    });

    return Object.freeze({ applyCollapse, applyScheduleUi });
  }

  const api = Object.freeze({ createSidebarController });
  if (root) root.SurriculumSchedulerSidebar = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
