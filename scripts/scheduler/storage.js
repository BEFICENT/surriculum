// Scheduler plan-scoped persistence and preference storage.
(function (root) {
  'use strict';

  const PLAN_ID_FOR_SESSION = (() => {
    try {
      const ps = (typeof window !== 'undefined') ? window.planStorage : null;
      return (ps && typeof ps.getSessionPlanId === 'function')
        ? ps.getSessionPlanId() : null;
    } catch (_) {
      return null;
    }
  })();

  function planGetItem(key) {
    const ps = (typeof window !== 'undefined') ? window.planStorage : null;
    if (ps && typeof ps.getItem === 'function') {
      if (!PLAN_ID_FOR_SESSION) return null;
      try { return ps.getItem(key, PLAN_ID_FOR_SESSION); } catch (_) { return null; }
    }
    try { return localStorage.getItem(key); } catch (_) {}
    return null;
  }

  function planSetItem(key, value) {
    const ps = (typeof window !== 'undefined') ? window.planStorage : null;
    if (ps && typeof ps.setItem === 'function') {
      if (!PLAN_ID_FOR_SESSION) return false;
      try { return ps.setItem(key, value, PLAN_ID_FOR_SESSION); } catch (_) { return false; }
    }
    try { localStorage.setItem(key, value); return true; } catch (_) {}
    return false;
  }

  function preferenceGetItem(key) {
    const preferences = (typeof window !== 'undefined') ? window.preferenceStorage : null;
    if (preferences && typeof preferences.getItem === 'function') {
      try { return preferences.getItem(key); } catch (_) { return null; }
    }
    return null;
  }

  function preferenceSetItem(key, value) {
    const preferences = (typeof window !== 'undefined') ? window.preferenceStorage : null;
    if (preferences && typeof preferences.setItem === 'function') {
      try { return preferences.setItem(key, value); } catch (_) { return false; }
    }
    return false;
  }


  function saveSchedulerState(termCode, state) {
    const key = `schedulerState_${termCode}`;
    try {
      const prev = loadSchedulerState(termCode);
      const patch = (state && typeof state === 'object') ? state : {};
      const next = Object.assign({}, prev || {}, patch || {});

      // If we're using multi-schedule storage, store common patches onto the
      // active schedule entry.
      try {
        const schedules = next.schedules && typeof next.schedules === 'object' ? next.schedules : null;
        const items = schedules && schedules.items && typeof schedules.items === 'object' ? schedules.items : null;
        const activeId = schedules && schedules.activeId ? String(schedules.activeId) : '';
        const active = items && activeId && items[activeId] && typeof items[activeId] === 'object' ? items[activeId] : null;
        if (active) {
          if (Object.prototype.hasOwnProperty.call(patch, 'selected')) active.selected = patch.selected;
          if (Object.prototype.hasOwnProperty.call(patch, 'blocked')) active.blocked = patch.blocked;
          if (Object.prototype.hasOwnProperty.call(patch, 'ui')) active.ui = patch.ui;
        }
      } catch (_) {}

      // Keep legacy top-level fields in sync for backwards compatibility.
      try {
        const schedules = next.schedules && typeof next.schedules === 'object' ? next.schedules : null;
        const items = schedules && schedules.items && typeof schedules.items === 'object' ? schedules.items : null;
        const activeId = schedules && schedules.activeId ? String(schedules.activeId) : '';
        const active = items && activeId && items[activeId] && typeof items[activeId] === 'object' ? items[activeId] : null;
        if (active) {
          next.selected = active.selected || {};
          next.blocked = Array.isArray(active.blocked) ? active.blocked : [];
          next.ui = active.ui && typeof active.ui === 'object' ? active.ui : {};
        }
      } catch (_) {}

      planSetItem(key, JSON.stringify(next));
      return;
    } catch (_) {}
    planSetItem(key, JSON.stringify(state || {}));
  }

  function loadSchedulerState(termCode) {
    const key = `schedulerState_${termCode}`;
    const ensure = (raw) => {
      const base = (raw && typeof raw === 'object') ? Object.assign({}, raw) : {};
      const legacySelected = (base.selected && typeof base.selected === 'object') ? base.selected : {};
      const legacyBlocked = Array.isArray(base.blocked) ? base.blocked : [];
      const legacyUi = (base.ui && typeof base.ui === 'object') ? base.ui : {};

      const schedules = (base.schedules && typeof base.schedules === 'object') ? base.schedules : null;
      if (!schedules || !schedules.items || typeof schedules.items !== 'object' || !Array.isArray(schedules.order) || !schedules.order.length) {
        const id = 'default';
        base.schedules = {
          activeId: id,
          order: [id],
          items: {
            [id]: { id, name: 'Default schedule', selected: legacySelected, blocked: legacyBlocked, ui: legacyUi },
          },
        };
      } else {
        // Ensure active exists and all entries have required fields.
        try {
          const items = base.schedules.items;
          base.schedules.order = base.schedules.order.map(String).filter((x) => items[x]);
          if (!base.schedules.order.length) {
            const id = 'default';
            base.schedules.order = [id];
            items[id] = { id, name: 'Default schedule', selected: legacySelected, blocked: legacyBlocked, ui: legacyUi };
          }
          if (!base.schedules.activeId || !items[String(base.schedules.activeId)]) {
            base.schedules.activeId = base.schedules.order[0];
          }
          for (let i = 0; i < base.schedules.order.length; i++) {
            const sid = base.schedules.order[i];
            const it = items[sid] && typeof items[sid] === 'object' ? items[sid] : (items[sid] = { id: sid });
            if (!it.id) it.id = sid;
            if (!it.name) it.name = sid === 'default' ? 'Default schedule' : 'Schedule';
            if (!it.selected || typeof it.selected !== 'object') it.selected = {};
            if (!Array.isArray(it.blocked)) it.blocked = [];
            if (!it.ui || typeof it.ui !== 'object') it.ui = {};
          }
        } catch (_) {}
      }

      // Mirror active schedule back to legacy fields for existing code paths.
      try {
        const s = base.schedules;
        const items = s.items;
        const a = items[String(s.activeId)];
        base.selected = a && a.selected && typeof a.selected === 'object' ? a.selected : {};
        base.blocked = a && Array.isArray(a.blocked) ? a.blocked : [];
        base.ui = a && a.ui && typeof a.ui === 'object' ? a.ui : {};
      } catch (_) {
        base.selected = legacySelected;
        base.blocked = legacyBlocked;
        base.ui = legacyUi;
      }

      return base;
    };
    try {
      const raw = planGetItem(key);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === 'object') {
        const ensured = ensure(parsed);
        try {
          if (!parsed.schedules) planSetItem(key, JSON.stringify(ensured));
        } catch (_) {}
        return ensured;
      }
    } catch (_) {}
    return ensure({ selected: {}, blocked: [] }); // selected[course_id] = { course_id, crn }
  }

  const api = Object.freeze({
    planGetItem,
    planSetItem,
    preferenceGetItem,
    preferenceSetItem,
    saveSchedulerState,
    loadSchedulerState,
  });
  if (root) root.SurriculumSchedulerStorage = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
