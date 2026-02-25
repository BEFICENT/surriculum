// Current term scheduler UI (SUchedule-like) for building a weekly timetable.
// Loads meeting times from courses/schedule/<termCode>.jsonl.

(function () {
  const DAYS = [
    { key: 'M', label: 'Mon' },
    { key: 'T', label: 'Tue' },
    { key: 'W', label: 'Wed' },
    { key: 'R', label: 'Thu' },
    { key: 'F', label: 'Fri' },
  ];

  const DAY_START_MIN = 8 * 60 + 40;  // 08:40
  const DAY_END_MIN = 19 * 60 + 30;   // 19:30

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function planGetItem(key) {
    try {
      const ps = (typeof window !== 'undefined') ? window.planStorage : null;
      return ps ? ps.getItem(key) : localStorage.getItem(key);
    } catch (_) {}
    try { return localStorage.getItem(key); } catch (_) {}
    return null;
  }

  function planSetItem(key, value) {
    try {
      const ps = (typeof window !== 'undefined') ? window.planStorage : null;
      if (ps) return ps.setItem(key, value);
      return localStorage.setItem(key, value);
    } catch (_) {}
    try { return localStorage.setItem(key, value); } catch (_) {}
  }

  function termNameToCodeSafe(name) {
    try {
      if (typeof window !== 'undefined' && typeof window.termNameToCode === 'function') {
        return window.termNameToCode(name);
      }
    } catch (_) {}
    return null;
  }

  function getCurrentTermNameSafe() {
    try { return window.currentTermName || ''; } catch (_) { return ''; }
  }

  function getCurrentTermCodeSafe() {
    try {
      if (window.currentTermCode) return String(window.currentTermCode);
    } catch (_) {}
    const name = getCurrentTermNameSafe();
    const code = termNameToCodeSafe(name);
    return code ? String(code) : '';
  }

  function normalizeCourseId(code) {
    return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  function parseDaysToKeys(days) {
    const s = String(days || '').toUpperCase().replace(/\s+/g, '');
    const keys = [];
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === 'M' || ch === 'T' || ch === 'W' || ch === 'R' || ch === 'F') keys.push(ch);
    }
    return keys;
  }

  function parseClockToMinutes(token) {
    // "12:40 pm" / "2:30 pm" / "08:40" / "14:30"
    const t = String(token || '').trim().toLowerCase();
    if (!t) return null;
    const m = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
    if (!m) return null;
    let hh = parseInt(m[1], 10);
    const mm = parseInt(m[2] || '0', 10);
    const ap = m[3] || '';
    if (ap) {
      if (ap === 'am') {
        if (hh === 12) hh = 0;
      } else if (ap === 'pm') {
        if (hh !== 12) hh += 12;
      }
    }
    return hh * 60 + mm;
  }

  function parseTimeRangeToMinutes(timeStr) {
    // "12:40 pm - 2:30 pm"
    const s = String(timeStr || '').trim();
    if (!s || /TBA/i.test(s)) return null;
    const parts = s.split('-').map(x => x.trim());
    if (parts.length < 2) return null;
    const start = parseClockToMinutes(parts[0]);
    const end = parseClockToMinutes(parts[1]);
    if (start == null || end == null) return null;
    return { start, end };
  }

  function minutesToLabel(mins) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }

  function hslFromString(str) {
    const s = String(str || '');
    let hash = 0;
    for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
    const hue = hash % 360;
    return `hsl(${hue} 75% 55%)`;
  }

  async function loadTermScheduleIndex(termCode) {
    const tc = String(termCode || '').trim();
    if (!tc) return null;
    try {
      if (window.__scheduleIndexPromise && window.__scheduleIndexTerm === tc) return window.__scheduleIndexPromise;
    } catch (_) {}

    const tryReadText = async (path) => {
      try {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', path, false);
        xhr.overrideMimeType('application/json');
        xhr.send(null);
        if (xhr.status === 200 || xhr.status === 0) return xhr.responseText;
      } catch (_) {}
      try {
        const res = await fetch(path);
        if (res.ok) return await res.text();
      } catch (_) {}
      return '';
    };

    const promise = (async () => {
      const candidates = [
        `./courses/schedule/${tc}.jsonl`,
        `./courses/schedule_${tc}.jsonl`,
      ];
      let text = '';
      for (let i = 0; i < candidates.length && !text; i++) {
        text = await tryReadText(candidates[i]);
      }
      if (!text) return null;

      const byCourse = new Map(); // course_id -> {course_id, title, sections:[]}
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] && lines[i].trim();
        if (!line) continue;
        let obj = null;
        try { obj = JSON.parse(line); } catch (_) { continue; }
        const courseId = normalizeCourseId(obj.course_id || obj.courseId || obj.course || '');
        if (!courseId) continue;
        const title = obj.title || obj.course_title || obj.courseTitle || '';
        const courseEntry = byCourse.get(courseId) || { course_id: courseId, title: title || '', sections: [] };
        if (!courseEntry.title && title) courseEntry.title = title;
        const sec = {
          course_id: courseId,
          title: title || courseEntry.title || '',
          crn: String(obj.crn || ''),
          section: String(obj.section || obj.sec || ''),
          component: String(obj.component || obj.schedule_type || obj.scheduleType || ''),
          credits: (typeof obj.credits === 'number') ? obj.credits : (parseFloat(obj.credits || obj.su_credits || obj.su_credit || '0') || 0),
          meetings: Array.isArray(obj.meetings) ? obj.meetings : [],
          source_url: obj.source_url || '',
        };
        courseEntry.sections.push(sec);
        byCourse.set(courseId, courseEntry);
      }

      // Normalize sections ordering
      for (const entry of byCourse.values()) {
        entry.sections.sort((a, b) => {
          const ac = (a.component || '').localeCompare(b.component || '');
          if (ac) return ac;
          const as = (a.section || '').localeCompare(b.section || '');
          if (as) return as;
          return (a.crn || '').localeCompare(b.crn || '');
        });
      }

      return byCourse;
    })();

    try {
      window.__scheduleIndexPromise = promise;
      window.__scheduleIndexTerm = tc;
    } catch (_) {}
    return promise;
  }

  function getCurrentTermSemesterCourseCodes() {
    try {
      const cur = window.curriculum;
      if (!cur || !cur.semesters) return [];
      const ct = getCurrentTermNameSafe();
      if (!ct) return [];
      const containers = document.querySelectorAll('.container_semester');
      for (let i = 0; i < containers.length; i++) {
        const c = containers[i];
        const p = c.querySelector('.date p');
        const name = p ? String(p.textContent || '').trim() : '';
        if (name !== ct) continue;
        const sem = c.querySelector('.semester');
        if (!sem) continue;
        const semObj = cur.getSemester(sem.id);
        if (!semObj || !Array.isArray(semObj.courses)) return [];
        return semObj.courses.map(x => normalizeCourseId(x && x.code)).filter(Boolean);
      }
    } catch (_) {}
    return [];
  }

  function extractCoreqCourseIdsFromCoursePageInfoField(coreq) {
    const s = String(coreq || '');
    if (!s) return [];
    const out = new Set();
    const re = /([A-Z]{2,5})\s*([0-9]{3}[A-Z0-9]?)/g;
    let m;
    while ((m = re.exec(s)) !== null) {
      out.add((m[1] + m[2]).toUpperCase());
    }
    return Array.from(out);
  }

  function createPickerModal({ title, bodyHtml, listItems, buttons }) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay scheduler-picker-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');

      const modal = document.createElement('div');
      modal.className = 'modal app-modal scheduler-picker-modal';
      modal.addEventListener('click', (e) => e.stopPropagation());

      const header = document.createElement('div');
      header.className = 'app-modal-header';

      const h = document.createElement('h3');
      h.className = 'app-modal-title';
      h.textContent = title || '';

      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'app-modal-close';
      close.innerHTML = '<i class="fa-solid fa-xmark"></i>';

      const body = document.createElement('div');
      body.className = 'app-modal-body';
      body.innerHTML = bodyHtml || '';

      if (Array.isArray(listItems) && listItems.length) {
        const list = document.createElement('div');
        list.className = 'scheduler-picker-list';
        for (let i = 0; i < listItems.length; i++) {
          const it = listItems[i] || {};
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'scheduler-picker-option';
          btn.innerHTML =
            `<div class="scheduler-picker-option-title">${escapeHtml(it.label || '')}</div>` +
            (it.subLabel ? `<div class="scheduler-picker-option-meta">${escapeHtml(it.subLabel || '')}</div>` : '');
          btn.addEventListener('click', () => cleanup({ action: it.action || 'pick', value: it.value }));
          list.appendChild(btn);
        }
        body.appendChild(list);
      }

      const footer = document.createElement('div');
      footer.className = 'app-modal-footer';

      const cleanup = (payload) => {
        try { document.removeEventListener('keydown', onKeyDown); } catch (_) {}
        try { overlay.remove(); } catch (_) {}
        resolve(payload);
      };

      close.addEventListener('click', () => cleanup({ action: 'close' }));
      overlay.addEventListener('click', () => cleanup({ action: 'cancel' }));

      header.appendChild(h);
      header.appendChild(close);

      (buttons || []).forEach((b) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        const variant = (b && b.variant) ? String(b.variant) : 'secondary';
        const cls = (variant === 'primary')
          ? 'btn-primary'
          : (variant === 'danger')
            ? 'btn-danger'
            : (variant === 'warning')
              ? 'btn-warning'
              : 'btn-secondary';
        btn.className = 'btn ' + cls + ' btn-sm';
        btn.textContent = b.label;
        btn.addEventListener('click', () => cleanup({ action: b.action, value: b.value }));
        footer.appendChild(btn);
      });

      modal.appendChild(header);
      modal.appendChild(body);
      modal.appendChild(footer);
      overlay.appendChild(modal);
      try {
        const root = document.fullscreenElement || document.body;
        root.appendChild(overlay);
      } catch (_) {
        document.body.appendChild(overlay);
      }

      const onKeyDown = (e) => {
        if (e.key === 'Escape') cleanup({ action: 'cancel' });
      };
      document.addEventListener('keydown', onKeyDown);
    });
  }

  function createInfoModal({ title, bodyHtml, buttons, onMount }) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay scheduler-picker-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');

      const modal = document.createElement('div');
      modal.className = 'modal app-modal scheduler-picker-modal scheduler-details-modal';
      modal.addEventListener('click', (e) => e.stopPropagation());

      const header = document.createElement('div');
      header.className = 'app-modal-header';

      const h = document.createElement('h3');
      h.className = 'app-modal-title';
      h.textContent = title || '';

      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'app-modal-close';
      close.innerHTML = '<i class="fa-solid fa-xmark"></i>';

      const body = document.createElement('div');
      body.className = 'app-modal-body';
      body.innerHTML = bodyHtml || '';

      const footer = document.createElement('div');
      footer.className = 'app-modal-footer';

      const cleanup = (payload) => {
        try { document.removeEventListener('keydown', onKeyDown); } catch (_) {}
        try { overlay.remove(); } catch (_) {}
        resolve(payload);
      };

      close.addEventListener('click', () => cleanup({ action: 'close' }));
      overlay.addEventListener('click', () => cleanup({ action: 'cancel' }));

      header.appendChild(h);
      header.appendChild(close);

      (buttons || []).forEach((b) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        const variant = (b && b.variant) ? String(b.variant) : 'secondary';
        const cls = (variant === 'primary')
          ? 'btn-primary'
          : (variant === 'danger')
            ? 'btn-danger'
            : (variant === 'warning')
              ? 'btn-warning'
              : 'btn-secondary';
        btn.className = 'btn ' + cls + ' btn-sm';
        btn.textContent = b.label;
        btn.addEventListener('click', () => cleanup({ action: b.action, value: b.value }));
        footer.appendChild(btn);
      });

      modal.appendChild(header);
      modal.appendChild(body);
      modal.appendChild(footer);
      overlay.appendChild(modal);
      try {
        const root = document.fullscreenElement || document.body;
        root.appendChild(overlay);
      } catch (_) {
        document.body.appendChild(overlay);
      }

      try {
        if (typeof onMount === 'function') onMount({ overlay, modal, body, close: () => cleanup({ action: 'close' }) });
      } catch (_) {}

      const onKeyDown = (e) => {
        if (e.key === 'Escape') cleanup({ action: 'cancel' });
      };
      document.addEventListener('keydown', onKeyDown);
    });
  }

  function createTextInputModal({ title, bodyHtml, initialValue, placeholder, okLabel }) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay scheduler-picker-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');

      const modal = document.createElement('div');
      modal.className = 'modal app-modal scheduler-picker-modal';
      modal.addEventListener('click', (e) => e.stopPropagation());

      const header = document.createElement('div');
      header.className = 'app-modal-header';

      const h = document.createElement('h3');
      h.className = 'app-modal-title';
      h.textContent = title || '';

      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'app-modal-close';
      close.innerHTML = '<i class="fa-solid fa-xmark"></i>';

      const body = document.createElement('div');
      body.className = 'app-modal-body';
      body.innerHTML = bodyHtml || '';

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'select-control';
      input.placeholder = placeholder || '';
      input.value = String(initialValue || '');
      input.style.width = '100%';
      input.style.marginTop = bodyHtml ? '10px' : '0';
      body.appendChild(input);

      const footer = document.createElement('div');
      footer.className = 'app-modal-footer';

      const cleanup = (payload) => {
        try { document.removeEventListener('keydown', onKeyDown); } catch (_) {}
        try { overlay.remove(); } catch (_) {}
        resolve(payload);
      };

      const okBtn = document.createElement('button');
      okBtn.type = 'button';
      okBtn.className = 'btn btn-primary btn-sm';
      okBtn.textContent = okLabel || 'OK';
      okBtn.addEventListener('click', () => cleanup({ action: 'ok', value: input.value }));

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn btn-secondary btn-sm';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', () => cleanup({ action: 'cancel' }));

      close.addEventListener('click', () => cleanup({ action: 'close' }));
      overlay.addEventListener('click', () => cleanup({ action: 'cancel' }));

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          okBtn.click();
        }
      });

      header.appendChild(h);
      header.appendChild(close);
      footer.appendChild(cancelBtn);
      footer.appendChild(okBtn);
      modal.appendChild(header);
      modal.appendChild(body);
      modal.appendChild(footer);
      overlay.appendChild(modal);

      try {
        const root = document.fullscreenElement || document.body;
        root.appendChild(overlay);
      } catch (_) {
        document.body.appendChild(overlay);
      }

      const onKeyDown = (e) => {
        if (e.key === 'Escape') cleanup({ action: 'cancel' });
      };
      document.addEventListener('keydown', onKeyDown);

      try { setTimeout(() => input.focus(), 0); } catch (_) {}
    });
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

  function openSchedulerModal() {
    const termName = getCurrentTermNameSafe();
    const termCode = getCurrentTermCodeSafe();
    const ui = (typeof window !== 'undefined') ? window.uiModal : null;
    const DISPLAY_END_EXTRA_MIN = 10; // show the final boundary at 19:40
    const DISPLAY_END_MIN = DAY_END_MIN + DISPLAY_END_EXTRA_MIN;
    const BLOCK_END_MIN = DISPLAY_END_MIN;

    if (!termCode) {
      if (ui && typeof ui.alert === 'function') {
        ui.alert('Scheduler unavailable', '<p>Could not determine the current term.</p>');
      }
      return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay scheduler-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    const modal = document.createElement('div');
    modal.className = 'modal scheduler-modal';
    modal.addEventListener('click', (e) => e.stopPropagation());

    const header = document.createElement('div');
    header.className = 'scheduler-header';
    header.innerHTML =
      `<div class="scheduler-title">Current Term Scheduler <span class="scheduler-term">— ${escapeHtml(termName || termCode)}</span></div>` +
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
    let onDocMouseUp = null;
    let onWinResize = null;

    const buildDetailUrl = (crn) => {
      const c = String(crn || '').trim();
      if (!c) return '';
      return `https://suis.sabanciuniv.edu/prod/bwckschd.p_disp_detail_sched?term_in=${encodeURIComponent(termCode)}&crn_in=${encodeURIComponent(c)}`;
    };

    const buildSyllabusUrl = (courseId, section) => {
      try {
        const cid = normalizeCourseId(courseId);
        const sec = String(section || '').trim();
        if (!cid || !sec) return '';
        const m = cid.match(/^([A-Z]{2,5})([0-9]+)/);
        const sc = m ? String(m[1] || '').toUpperCase() : '';
        const cn = m ? String(m[2] || '') : '';
        if (!sc || !cn) return '';
        return `https://apps.sabanciuniv.edu/courses/syllabus/view.php?term=${encodeURIComponent(termCode)}&sc=${encodeURIComponent(sc)}&cn=${encodeURIComponent(cn)}&section=${encodeURIComponent(sec)}&view=su`;
      } catch (_) {
        return '';
      }
    };

    const sectionMeetingPreview = (sec, maxMeetings = 3) => {
      try {
        const meetings = (sec && Array.isArray(sec.meetings)) ? sec.meetings : [];
        return meetings.slice(0, maxMeetings).map(m => {
          const days = (m && m.days ? String(m.days) : '').trim();
          const tr = (m && m.time ? String(m.time) : '').trim();
          const where = (m && m.where ? String(m.where) : '').trim();
          const base = `${days} ${tr}`.trim();
          return where ? `${base} @ ${where}` : base;
        }).filter(Boolean).join(' • ');
      } catch (_) {
        return '';
      }
    };

    // Stable key for "same timing" comparisons (ignores classroom/instructor).
    // Expands multi-day strings ("MW") into per-day slots so equivalent schedules
    // normalize the same even if meetings are represented differently.
    const sectionTimeKey = (sec) => {
      try {
        const comp = String(sec && sec.component ? sec.component : '').trim().toLowerCase();
        const parts = [];
        const meetings = (sec && Array.isArray(sec.meetings)) ? sec.meetings : [];
        for (let i = 0; i < meetings.length; i++) {
          const m = meetings[i] || {};
          const daysArr = parseDaysToKeys(m.days || m.Days || '');
          if (!daysArr.length) continue;
          let start = m.start_min;
          let end = m.end_min;
          if (start == null || end == null) {
            const tr = parseTimeRangeToMinutes(m.time || m.Time || '');
            if (tr) {
              start = tr.start;
              end = tr.end;
            }
          }
          if (start == null || end == null) continue;
          for (let di = 0; di < daysArr.length; di++) {
            parts.push(`${daysArr[di]}|${start}|${end}`);
          }
        }
        parts.sort();
        return `${comp}|${parts.length ? parts.join('||') : 'TBA'}`;
      } catch (_) {
        return 'tba|TBA';
      }
    };

    const openDetailPickerForCourse = async (courseId) => {
      try {
        const cid = normalizeCourseId(courseId);
        if (!cid) return;
        const idx = scheduleIndex || await loadTermScheduleIndex(termCode);
        if (!idx) return;
        scheduleIndex = idx;
        const entry = idx.get(cid);
        if (!entry || !Array.isArray(entry.sections) || !entry.sections.length) return;

        const sections = entry.sections.slice();
        sections.sort((a, b) => {
          const aL = /lec/i.test(a.component || '') ? 0 : 1;
          const bL = /lec/i.test(b.component || '') ? 0 : 1;
          if (aL !== bL) return aL - bL;
          return (String(a.section || '')).localeCompare(String(b.section || ''));
        });

        const res = await createPickerModal({
          title: `Open section — ${cid}`,
          bodyHtml: `<p>${escapeHtml(entry.title || '')}</p><p>Select a section to open its detail page:</p>`,
          listItems: sections.slice(0, 140).map(sec => {
            const meetingSummary = sectionMeetingPreview(sec, 3);
            const instr = sectionInstructorPreview(sec);
            const sub = [meetingSummary, instr ? `Instructor: ${instr}` : ''].filter(Boolean).join(' — ');
            const label = `${cid}${sec.section ? `-${sec.section}` : ''}${sec.component ? ` • ${sec.component}` : ''}${sec.crn ? ` (CRN ${sec.crn})` : ''}`;
            return { action: 'open', label, subLabel: sub, value: { crn: String(sec.crn || '') } };
          }),
          buttons: [{ action: 'cancel', label: 'Close', variant: 'secondary' }],
        });
        if (res && res.action === 'open' && res.value && res.value.crn) {
          const url = buildDetailUrl(res.value.crn);
          if (url) {
            try { window.open(url, '_blank', 'noopener'); } catch (_) {}
          }
        }
      } catch (_) {}
    };

    const openSyllabusPickerForCourse = async (courseId) => {
      try {
        const cid = normalizeCourseId(courseId);
        if (!cid) return;
        const idx = scheduleIndex || await loadTermScheduleIndex(termCode);
        if (!idx) return;
        scheduleIndex = idx;
        const entry = idx.get(cid);
        if (!entry || !Array.isArray(entry.sections) || !entry.sections.length) return;

        const sections = entry.sections.slice();
        sections.sort((a, b) => {
          const aL = /lec/i.test(a.component || '') ? 0 : 1;
          const bL = /lec/i.test(b.component || '') ? 0 : 1;
          if (aL !== bL) return aL - bL;
          return (String(a.section || '')).localeCompare(String(b.section || ''));
        });

        const res = await createPickerModal({
          title: `Open syllabus — ${cid}`,
          bodyHtml: `<p>${escapeHtml(entry.title || '')}</p><p>Select a section to open its syllabus:</p>`,
          listItems: sections.slice(0, 140).map(sec => {
            const meetingSummary = sectionMeetingPreview(sec, 3);
            const instr = sectionInstructorPreview(sec);
            const sub = [meetingSummary, instr ? `Instructor: ${instr}` : ''].filter(Boolean).join(' — ');
            const label = `${cid}${sec.section ? `-${sec.section}` : ''}${sec.component ? ` • ${sec.component}` : ''}${sec.crn ? ` (CRN ${sec.crn})` : ''}`;
            return { action: 'open', label, subLabel: sub, value: { courseId: cid, section: String(sec.section || '') } };
          }),
          buttons: [{ action: 'cancel', label: 'Close', variant: 'secondary' }],
        });
        if (res && res.action === 'open' && res.value && res.value.courseId && res.value.section) {
          const url = buildSyllabusUrl(res.value.courseId, res.value.section);
          if (url) {
            try { window.open(url, '_blank', 'noopener'); } catch (_) {}
          }
        }
      } catch (_) {}
    };

    const openCourseDetailsModal = async (courseId) => {
      try {
        const cid = normalizeCourseId(courseId);
        if (!cid) return;
        const idx = scheduleIndex || await loadTermScheduleIndex(termCode);
        if (!idx) return;
        scheduleIndex = idx;
        const entry = idx.get(cid);
        if (!entry) return;

        // Load course-page (catalog) info if available so we can show additional
        // details such as description/prereqs/last-offered terms.
        try {
          const loadInfo = (typeof window !== 'undefined') ? window.loadCoursePageInfoIndex : null;
          if (!coursePageInfoMap && typeof loadInfo === 'function') {
            coursePageInfoMap = await loadInfo();
          }
        } catch (_) {}
        const pi = (() => {
          try { return coursePageInfoMap && typeof coursePageInfoMap.get === 'function' ? coursePageInfoMap.get(cid) : null; } catch (_) { return null; }
        })();

        // If this course is a linked recitation/lab (coreq-only), don't show
        // syllabus buttons (syllabi are for the main course).
        let isCoreqOnly = false;
        try {
          if (!reverseCoreqIndex && coursePageInfoMap) {
            reverseCoreqIndex = buildReverseCoreqIndex(idx);
          }
          const parents = reverseCoreqIndex ? reverseCoreqIndex.get(cid) : null;
          isCoreqOnly = !!(parents && parents.size);
        } catch (_) {}

        const pick = selected && selected[cid] ? selected[cid] : null;
        const pickCrn = pick && pick.crn ? String(pick.crn) : '';
        const selectedSec = (pickCrn && Array.isArray(entry.sections))
          ? (entry.sections.find(s => String(s && s.crn ? s.crn : '') === pickCrn) || null)
          : null;

        const renderMeetingRows = (sec) => {
          const ms = (sec && Array.isArray(sec.meetings)) ? sec.meetings : [];
          if (!ms.length) return '<div class="scheduler-details-muted">No meeting times listed.</div>';
          return ms.map(m => {
            const days = (m && m.days ? String(m.days) : '').trim();
            const tr = (m && m.time ? String(m.time) : '').trim();
            const where = (m && m.where ? String(m.where) : '').trim();
            const dr = (m && m.date_range ? String(m.date_range) : '').trim();
            const instr = (m && m.instructors ? String(m.instructors) : '').trim();
            const left = [days, tr].filter(Boolean).join(' ');
            const right = [where, dr].filter(Boolean).join(' — ');
            const iLine = instr ? `<div class="scheduler-details-meeting-instr"><span class="muted">Instructor:</span> ${escapeHtml(instr)}</div>` : '';
            return (
              `<div class="scheduler-details-meeting">` +
              `<div class="scheduler-details-meeting-top">` +
              `<div class="scheduler-details-meeting-when">${escapeHtml(left || 'TBA')}</div>` +
              (right ? `<div class="scheduler-details-meeting-where">${escapeHtml(right)}</div>` : '') +
              `</div>` +
              iLine +
              `</div>`
            );
          }).join('');
        };

        const coursePageUrl = (() => {
          try {
            const u = pi && pi.source_url ? String(pi.source_url) : '';
            return u;
          } catch (_) {
            return '';
          }
        })();

        const actionRow = (() => {
          const openSuisBtn = pickCrn
            ? `<button type="button" class="btn btn-primary btn-sm scheduler-details-open" data-crn="${escapeHtml(pickCrn)}">Open selected on SUIS</button>`
            : `<button type="button" class="btn btn-primary btn-sm scheduler-details-open-picker" data-course="${escapeHtml(cid)}">Open a section on SUIS</button>`;
          const syllabusBtn = isCoreqOnly
            ? ''
            : (
              (selectedSec && selectedSec.section)
                ? `<button type="button" class="btn btn-secondary btn-sm scheduler-details-syllabus" data-course="${escapeHtml(cid)}" data-section="${escapeHtml(String(selectedSec.section))}">Syllabus</button>`
                : `<button type="button" class="btn btn-secondary btn-sm scheduler-details-syllabus-picker" data-course="${escapeHtml(cid)}">Syllabus</button>`
            );
          const openCoursePageBtn = coursePageUrl
            ? `<a class="btn btn-secondary btn-sm" href="${escapeHtml(coursePageUrl)}" target="_blank" rel="noopener">Open course page</a>`
            : '';
          return `<div class="scheduler-details-actions">${openCoursePageBtn}${syllabusBtn}${openSuisBtn}</div>`;
        })();

        const fmtNum = (v) => {
          const n = Number(v);
          if (!Number.isFinite(n)) return '';
          return (Math.round(n * 10) / 10).toFixed(1);
        };

        const catalogCard = (() => {
          if (!pi) {
            return (
              `<div class="scheduler-details-card">` +
              `<div class="scheduler-details-card-title">Catalog info</div>` +
              `<div class="scheduler-details-muted">Catalog details are not available for this course.</div>` +
              `</div>`
            );
          }
          const su = (pi.su_credits != null) ? fmtNum(pi.su_credits) : '';
          const ects = (pi.ects != null) ? fmtNum(pi.ects) : '';
          const bs = (pi.basic_science != null) ? fmtNum(pi.basic_science) : '';
          const eng = (pi.engineering != null) ? fmtNum(pi.engineering) : '';
          const prereq = (pi.prerequisites != null) ? String(pi.prerequisites) : '';
          const coreq = (pi.corequisites != null) ? String(pi.corequisites) : '';
          const desc = (pi.description != null) ? String(pi.description) : '';
          const offered = Array.isArray(pi.last_offered_terms) ? pi.last_offered_terms : [];

          const metaParts = [];
          if (su) metaParts.push(`<div><span class="muted">SU:</span> ${escapeHtml(su)}</div>`);
          if (ects) metaParts.push(`<div><span class="muted">ECTS:</span> ${escapeHtml(ects)}</div>`);
          if (bs && bs !== '0.0') metaParts.push(`<div><span class="muted">BS:</span> ${escapeHtml(bs)}</div>`);
          if (eng && eng !== '0.0') metaParts.push(`<div><span class="muted">ENG:</span> ${escapeHtml(eng)}</div>`);

          const offeredPreview = offered.slice(0, 12).map(o => {
            const t = o && o.term ? String(o.term) : '';
            const n = o && o.course_name ? String(o.course_name) : '';
            const c = (o && o.su_credit != null) ? fmtNum(o.su_credit) : '';
            const label = t || 'Unknown term';
            const suffix = n ? ` — ${n}` : '';
            const cr = c ? ` <span class="muted">(${escapeHtml(c)} cr)</span>` : '';
            return `<li><strong>${escapeHtml(label)}</strong>${escapeHtml(suffix)}${cr}</li>`;
          }).join('');
          const offeredHtml = offered.length
            ? (
              `<div class="scheduler-details-subsection">` +
              `<div class="scheduler-details-subtitle">Last Offered (${offered.length})</div>` +
              `<ul class="scheduler-details-list">${offeredPreview}</ul>` +
              `</div>`
            )
            : '';

          const descHtml = desc
            ? (
              `<div class="scheduler-details-subsection">` +
              `<div class="scheduler-details-subtitle">Description</div>` +
              `<div class="scheduler-details-paragraph">${escapeHtml(desc).replace(/\\n/g, '<br>')}</div>` +
              `</div>`
            )
            : '';

          return (
            `<div class="scheduler-details-card">` +
            `<div class="scheduler-details-card-title">Catalog info</div>` +
            (metaParts.length ? `<div class="scheduler-details-meta">${metaParts.join('')}</div>` : '') +
            `<div class="scheduler-details-subsection">` +
            `<div class="scheduler-details-subtitle">Prerequisites</div>` +
            `<div class="scheduler-details-paragraph">${prereq ? escapeHtml(prereq) : 'None'}</div>` +
            `</div>` +
            `<div class="scheduler-details-subsection">` +
            `<div class="scheduler-details-subtitle">Corequisites</div>` +
            `<div class="scheduler-details-paragraph">${coreq ? escapeHtml(coreq) : 'None'}</div>` +
            `</div>` +
            offeredHtml +
            descHtml +
            `</div>`
          );
        })();

        const secRows = (() => {
          const list = Array.isArray(entry.sections) ? entry.sections.slice() : [];
          list.sort((a, b) => {
            const aL = /lec/i.test(a.component || '') ? 0 : 1;
            const bL = /lec/i.test(b.component || '') ? 0 : 1;
            if (aL !== bL) return aL - bL;
            return (String(a.section || '')).localeCompare(String(b.section || ''));
          });
          const limited = list.slice(0, 120);
          const rows = limited.map(sec => {
            const crn = sec && sec.crn ? String(sec.crn) : '';
            const label = `${cid}${sec.section ? `-${sec.section}` : ''}${sec.component ? ` • ${sec.component}` : ''}${crn ? ` (CRN ${crn})` : ''}`;
            const meetingSummary = sectionMeetingPreview(sec, 3);
            const instr = sectionInstructorPreview(sec);
            const meta = [meetingSummary, instr ? `Instructor: ${instr}` : ''].filter(Boolean).join(' — ');
            const selectedBadge = (pickCrn && crn === pickCrn) ? `<span class="scheduler-details-badge">Selected</span>` : '';
            const openBtn = crn
              ? `<button type="button" class="btn btn-secondary btn-sm scheduler-details-open" data-crn="${escapeHtml(crn)}">Open</button>`
              : '';
            const syllabusBtn = (!isCoreqOnly && sec && sec.section)
              ? `<button type="button" class="btn btn-secondary btn-sm scheduler-details-syllabus" data-course="${escapeHtml(cid)}" data-section="${escapeHtml(String(sec.section))}">Syllabus</button>`
              : '';
            return (
              `<div class="scheduler-details-section-row">` +
              `<div class="scheduler-details-section-main">` +
              `<div class="scheduler-details-section-title">${escapeHtml(label)} ${selectedBadge}</div>` +
              (meta ? `<div class="scheduler-details-section-meta">${escapeHtml(meta)}</div>` : '') +
              `</div>` +
              `<div class="scheduler-details-section-actions">${syllabusBtn}${openBtn}</div>` +
              `</div>`
            );
          }).join('');
          const note = list.length > limited.length
            ? `<div class="scheduler-details-muted">Showing ${limited.length} of ${list.length} sections.</div>`
            : '';
          return `<div class="scheduler-details-sections">${rows}${note}</div>`;
        })();

        const bodyHtml =
          `<div class="scheduler-details">` +
          `<div class="scheduler-details-title"><strong>${escapeHtml(cid)}</strong>${entry.title ? ` — ${escapeHtml(entry.title)}` : ''}</div>` +
          actionRow +
          catalogCard +
          (selectedSec
            ? (
              `<div class="scheduler-details-card">` +
              `<div class="scheduler-details-card-title">Selected section</div>` +
              `<div class="scheduler-details-meetings">${renderMeetingRows(selectedSec)}</div>` +
              `</div>`
            )
            : '') +
          `<div class="scheduler-details-card">` +
          `<div class="scheduler-details-card-title">All sections</div>` +
          secRows +
          `</div>` +
          `</div>`;

        await createInfoModal({
          title: `Details — ${cid}`,
          bodyHtml,
          buttons: [{ action: 'close', label: 'Close', variant: 'secondary' }],
          onMount: ({ modal }) => {
            modal.addEventListener('click', async (e) => {
              const openBtn = e.target && e.target.closest ? e.target.closest('.scheduler-details-open') : null;
              if (openBtn) {
                const crn = String(openBtn.getAttribute('data-crn') || '').trim();
                if (crn) {
                  const url = buildDetailUrl(crn);
                  if (url) {
                    try { window.open(url, '_blank', 'noopener'); } catch (_) {}
                  }
                }
                return;
              }
              const syllabusBtn = e.target && e.target.closest ? e.target.closest('.scheduler-details-syllabus') : null;
              if (syllabusBtn) {
                const c = normalizeCourseId(syllabusBtn.getAttribute('data-course') || '');
                const sec = String(syllabusBtn.getAttribute('data-section') || '').trim();
                if (c && sec) {
                  const url = buildSyllabusUrl(c, sec);
                  if (url) {
                    try { window.open(url, '_blank', 'noopener'); } catch (_) {}
                  }
                }
                return;
              }
              const openPicker = e.target && e.target.closest ? e.target.closest('.scheduler-details-open-picker') : null;
              if (openPicker) {
                const c = normalizeCourseId(openPicker.getAttribute('data-course') || '');
                if (c) await openDetailPickerForCourse(c);
                return;
              }
              const syllabusPicker = e.target && e.target.closest ? e.target.closest('.scheduler-details-syllabus-picker') : null;
              if (syllabusPicker) {
                const c = normalizeCourseId(syllabusPicker.getAttribute('data-course') || '');
                if (c) await openSyllabusPickerForCourse(c);
              }
            });
          },
        });
      } catch (_) {}
    };

    const updateFullscreenIcon = () => {
      try {
        const inFs = !!(document.fullscreenElement && document.fullscreenElement === modal);
        const icon = fsBtn ? fsBtn.querySelector('i') : null;
        if (!icon) return;
        icon.classList.toggle('fa-expand', !inFs);
        icon.classList.toggle('fa-compress', inFs);
      } catch (_) {}
    };

    const onFullscreenChange = () => updateFullscreenIcon();
    try { document.addEventListener('fullscreenchange', onFullscreenChange); } catch (_) {}

    const cleanup = () => {
      try { document.removeEventListener('keydown', onKeyDown); } catch (_) {}
      try { document.removeEventListener('fullscreenchange', onFullscreenChange); } catch (_) {}
      try { if (onWinResize) window.removeEventListener('resize', onWinResize); } catch (_) {}
      try { if (onDocMouseUp) document.removeEventListener('mouseup', onDocMouseUp); } catch (_) {}
      try { overlay.remove(); } catch (_) {}
    };
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
            { action: 'block', label: blockMode ? 'Exit block mode' : 'Block hours', subLabel: blockMode ? 'Stop blocking time on the grid.' : 'Click+drag on the grid to block time.' },
            { action: 'fs', label: inFs ? 'Exit fullscreen' : 'Fullscreen', subLabel: 'Toggle fullscreen for the scheduler.' },
          ],
          buttons: [{ action: 'close', label: 'Close', variant: 'secondary' }],
        });
        if (!res || !res.action) return;
        if (res.action === 'copy') {
          try { copyBtn.click(); } catch (_) {}
        }
        if (res.action === 'block') {
          try { setBlockMode(!blockMode); } catch (_) {}
        }
        if (res.action === 'fs') {
          try { await toggleFullscreen(); } catch (_) {}
        }
      });
    }

    const body = document.createElement('div');
    body.className = 'scheduler-body';

    const schedulerFilterControlsHtml =
      `<div class="scheduler-controls">` +
      `  <div class="scheduler-control control-row toggle-row">` +
      `    <div class="toggle-text">Hide taken courses</div>` +
      `    <label class="toggle-switch"><input class="scheduler-toggle-hide-taken" type="checkbox" /><span class="toggle-slider"></span></label>` +
      `  </div>` +
      `  <div class="scheduler-control control-row toggle-row">` +
      `    <div class="toggle-text">Show course details</div>` +
      `    <label class="toggle-switch"><input class="scheduler-toggle-details" type="checkbox" /><span class="toggle-slider"></span></label>` +
      `  </div>` +
      `  <div class="scheduler-control control-row toggle-row">` +
      `    <div class="toggle-text">Smart Sort</div>` +
      `    <label class="toggle-switch"><input class="scheduler-toggle-score" type="checkbox" /><span class="toggle-slider"></span></label>` +
      `  </div>` +
      `  <div class="scheduler-control control-row toggle-row">` +
      `    <div class="toggle-text">Hover preview</div>` +
      `    <label class="toggle-switch"><input class="scheduler-toggle-hover-preview" type="checkbox" /><span class="toggle-slider"></span></label>` +
      `  </div>` +
      `  <div class="scheduler-control control-row toggle-row">` +
      `    <div class="toggle-text">Highlight course availability</div>` +
      `    <label class="toggle-switch"><input class="scheduler-toggle-highlight" type="checkbox" /><span class="toggle-slider"></span></label>` +
      `  </div>` +
      `  <div class="scheduler-control control-row toggle-row">` +
      `    <div class="toggle-text">Show blocked courses</div>` +
      `    <label class="toggle-switch"><input class="scheduler-toggle-show-blocked" type="checkbox" /><span class="toggle-slider"></span></label>` +
      `  </div>` +
      `  <div class="scheduler-control control-row toggle-row">` +
      `    <div class="toggle-text">Check prerequisites</div>` +
      `    <label class="toggle-switch"><input class="scheduler-toggle-prereq" type="checkbox" /><span class="toggle-slider"></span></label>` +
      `  </div>` +
      `  <div class="scheduler-control control-row toggle-row">` +
      `    <div class="toggle-text">Show unmet prerequisites</div>` +
      `    <label class="toggle-switch"><input class="scheduler-toggle-show-unmet-prereq" type="checkbox" /><span class="toggle-slider"></span></label>` +
      `  </div>` +
      `  <div class="scheduler-control scheduler-filter-row">` +
      `    <div class="scheduler-filter-label">Min SU credits</div>` +
      `    <input class="select-control scheduler-filter-min-su" type="number" min="0" step="0.5" placeholder="0" />` +
      `  </div>` +
      `  <div class="scheduler-control scheduler-filter-row">` +
      `    <div class="scheduler-filter-label">Min ECTS</div>` +
      `    <input class="select-control scheduler-filter-min-ects" type="number" min="0" step="1" placeholder="0" />` +
      `  </div>` +
      `  <div class="scheduler-control scheduler-filter-row">` +
      `    <div class="scheduler-filter-label">Min Basic Science</div>` +
      `    <input class="select-control scheduler-filter-min-bs" type="number" min="0" step="0.5" placeholder="0" />` +
      `  </div>` +
      `  <div class="scheduler-control scheduler-filter-row">` +
      `    <div class="scheduler-filter-label">Min Engineering</div>` +
      `    <input class="select-control scheduler-filter-min-eng" type="number" min="0" step="0.5" placeholder="0" />` +
      `  </div>` +
      `  <div class="scheduler-control scheduler-filter-row">` +
      `    <div class="scheduler-filter-label">Min Major type</div>` +
      `    <select class="select-control scheduler-filter-min-main">` +
      `      <option value="">Any</option>` +
      `      <option value="free">Free</option>` +
      `      <option value="area">Area</option>` +
      `      <option value="core">Core</option>` +
      `      <option value="university">University</option>` +
      `      <option value="required">Required</option>` +
      `    </select>` +
      `  </div>` +
      `  <div class="scheduler-control scheduler-filter-row">` +
      `    <div class="scheduler-filter-label">Min Double Major type</div>` +
      `    <select class="select-control scheduler-filter-min-dm">` +
      `      <option value="">Any</option>` +
      `      <option value="free">Free</option>` +
      `      <option value="area">Area</option>` +
      `      <option value="core">Core</option>` +
      `      <option value="university">University</option>` +
      `      <option value="required">Required</option>` +
      `    </select>` +
      `  </div>` +
      `  <div class="scheduler-control scheduler-filter-row">` +
      `    <div class="scheduler-filter-label">Min Minor type</div>` +
      `    <select class="select-control scheduler-filter-min-minor">` +
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
      `      <div class="scheduler-schedule-row">` +
      `        <button type="button" class="btn btn-secondary btn-sm scheduler-schedule-toggle" title="Switch schedule"><i class="fa-solid fa-layer-group"></i>&nbsp;<span class="scheduler-schedule-name">Default schedule</span></button>` +
      `      </div>` +
      `      <div class="scheduler-hint">Adds sections with lecture/recitation/lab meeting times. Conflicts are highlighted.</div>` +
      `    </div>` +
      `    <div class="scheduler-sidebar-section scheduler-collapsible" data-collapsible="plan">` +
      `      <button type="button" class="scheduler-collapsible-header">` +
      `        <span>Current Term Plan</span>` +
      `        <i class="fa-solid fa-chevron-down"></i>` +
      `      </button>` +
      `      <div class="scheduler-collapsible-body">` +
      `        <div class="scheduler-plan-list"></div>` +
      `      </div>` +
      `    </div>` +
      `    <div class="scheduler-sidebar-section scheduler-collapsible" data-collapsible="selected">` +
      `      <button type="button" class="scheduler-collapsible-header">` +
      `        <span>Selected Sections</span>` +
      `        <i class="fa-solid fa-chevron-down"></i>` +
      `      </button>` +
      `      <div class="scheduler-collapsible-body">` +
      `        <div class="scheduler-selected"></div>` +
      `        <div class="scheduler-selected-actions">` +
      `          <button class="btn btn-danger btn-sm scheduler-clear" type="button">Clear</button>` +
      `          <button class="btn btn-primary btn-sm scheduler-pick-plan" type="button">Update current-term plan</button>` +
      `        </div>` +
      `      </div>` +
      `    </div>` +
      `    <div class="scheduler-sidebar-section scheduler-collapsible" data-collapsible="blocked">` +
      `      <button type="button" class="scheduler-collapsible-header">` +
      `        <span>Blocked Hours</span>` +
      `        <i class="fa-solid fa-chevron-down"></i>` +
      `      </button>` +
      `      <div class="scheduler-collapsible-body">` +
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
      `          <input class="scheduler-search" type="text" placeholder="Search courses (e.g., CS 201, programming)..." />` +
      `          <button class="btn btn-secondary btn-sm scheduler-filter-btn" type="button" aria-expanded="false"><i class="fa-solid fa-filter"></i>&nbsp;Filters</button>` +
      `        </div>` +
      `        <div class="scheduler-filter-menu" hidden>` +
      `          <div class="scheduler-filter-menu-header">Filter Options</div>` +
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
      `        <button type="button" class="scheduler-corner-btn scheduler-sidebar-toggle" title="Toggle sidebar" aria-label="Toggle sidebar"><i class="fa-solid fa-angles-left"></i></button>` +
      `      </div>` +
      DAYS.map(d => `<div class="scheduler-grid-day">${escapeHtml(d.label)}</div>`).join('') +
      `    </div>` +
      `    <div class="scheduler-grid">` +
      `      <div class="scheduler-times"></div>` +
      DAYS.map(d => `<div class="scheduler-day-col" data-day="${d.key}"></div>`).join('') +
      `    </div>` +
      `  </div>` +
      `</div>`;

    modal.appendChild(header);
    modal.appendChild(body);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const schedulerGridEl = body.querySelector('.scheduler-grid');
    const sidebarToggleBtn = body.querySelector('.scheduler-sidebar-toggle');
    const updateScrollbarCompensation = () => {
      try {
        if (!schedulerGridEl) return;
        const sbw = Math.max(0, (schedulerGridEl.offsetWidth || 0) - (schedulerGridEl.clientWidth || 0));
        body.style.setProperty('--scheduler-scrollbar-w', `${sbw}px`);
      } catch (_) {}
    };
    try {
      updateScrollbarCompensation();
      requestAnimationFrame(() => updateScrollbarCompensation());
    } catch (_) {}
    onWinResize = () => updateScrollbarCompensation();
    try { window.addEventListener('resize', onWinResize); } catch (_) {}

    const onKeyDown = (e) => {
      if (e.key === 'Escape') cleanup();
    };
    document.addEventListener('keydown', onKeyDown);

    const getSchedulerLayout = () => {
      let pxPerMin = 1.05;
      let topGapPx = 14;
      let blockGapPx = 6;
      try {
        const gridEl = body.querySelector('.scheduler-grid');
        if (gridEl) {
          const mm = getComputedStyle(gridEl).getPropertyValue('--scheduler-minute');
          const mmN = parseFloat(String(mm || '').trim());
          if (Number.isFinite(mmN) && mmN > 0) pxPerMin = mmN;
          const tg = getComputedStyle(gridEl).getPropertyValue('--scheduler-top-gap');
          const tgN = parseFloat(String(tg || '').trim());
          if (Number.isFinite(tgN) && tgN >= 0) topGapPx = tgN;
          const bg = getComputedStyle(gridEl).getPropertyValue('--scheduler-block-gap');
          const bgN = parseFloat(String(bg || '').trim());
          if (Number.isFinite(bgN) && bgN >= 0) blockGapPx = bgN;
        }
      } catch (_) {}
      return { pxPerMin, topGapPx, blockGapPx };
    };

    const setBlockPosition = (el, startMin, endMin) => {
      try {
        const { pxPerMin, topGapPx, blockGapPx } = getSchedulerLayout();
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
        if (ee > e && ee <= DISPLAY_END_MIN) return { start: s, end: ee };
      }
      return { start: s, end: e };
    };

    // Render time labels and grid lines
    const timesEl = body.querySelector('.scheduler-times');
    const totalMins = DAY_END_MIN - DAY_START_MIN;
    const hourSlots = Math.floor(totalMins / 60) + 1;
    for (let i = 0; i < hourSlots; i++) {
      const t = DAY_START_MIN + i * 60;
      const row = document.createElement('div');
      row.className = 'scheduler-time-row';
      row.textContent = minutesToLabel(t);
      timesEl.appendChild(row);
    }

    // Draw hour separators in each day column
    const cols = body.querySelectorAll('.scheduler-day-col');
    cols.forEach((col) => {
      const { pxPerMin, topGapPx } = getSchedulerLayout();
      for (let i = 0; i < hourSlots; i++) {
        const line = document.createElement('div');
        line.className = 'scheduler-hour-line';
        line.style.top = `${topGapPx + (i * 60 * pxPerMin)}px`;
        col.appendChild(line);
      }
      // Also draw a final guideline at 19:40 so the last slot has a clear boundary.
      try {
        const endLine = document.createElement('div');
        endLine.className = 'scheduler-hour-line';
        endLine.style.top = `${topGapPx + ((DISPLAY_END_MIN - DAY_START_MIN) * pxPerMin)}px`;
        col.appendChild(endLine);
      } catch (_) {}
    });

    // Block-hours interaction: click+drag to create blocked time ranges.
    let blockDrag = null; // { dayKey, startY, ghostEl }
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
      const maxStart = BLOCK_END_MIN - 60;
      return Math.max(DAY_START_MIN, Math.min(maxStart, snapped));
    };
    const snapRange = (a, b) => {
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const start = DAY_START_MIN + Math.floor((lo - DAY_START_MIN) / 60) * 60;
      const end = DAY_START_MIN + Math.ceil((hi - DAY_START_MIN) / 60) * 60;
      const maxStart = BLOCK_END_MIN - 60;
      const s = Math.max(DAY_START_MIN, Math.min(maxStart, start));
      const e = Math.max(s + 60, Math.min(BLOCK_END_MIN, end));
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
      ghost.style.background = 'rgba(107, 114, 128, 0.45)';
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
      const nextList = (Array.isArray(blocked) ? blocked.slice() : []);
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
        const idx = scheduleIndex || await loadTermScheduleIndex(termCode);
        if (idx) {
          scheduleIndex = idx;
          renderGrid(idx);
          renderResults(idx, lastQuery);
        }
      } catch (_) {}
    };

    cols.forEach((col) => {
      col.addEventListener('mousedown', (e) => startBlockDrag(e, col));
      col.addEventListener('mousemove', (e) => updateBlockDrag(e));
    });
    onDocMouseUp = (e) => finishBlockDrag(e);
    document.addEventListener('mouseup', onDocMouseUp);

    let state = loadSchedulerState(termCode);
    let selected = state.selected && typeof state.selected === 'object' ? state.selected : {};
    let blocked = Array.isArray(state.blocked) ? state.blocked : [];
    let scheduleIndex = null;
    let coursePageInfoMap = null;
    let missingByCourse = {}; // course_id -> [missing coreq course_id]
    let orphanByCourse = {};  // course_id -> [base course_ids that require this course as coreq]
    let reverseCoreqIndex = null; // Map(coreq -> Set(baseCourse))

    const scheduleBtn = body.querySelector('.scheduler-schedule-toggle');
    const scheduleNameEl = body.querySelector('.scheduler-schedule-name');

    const getActiveSchedule = (root) => {
      try {
        const s = root && root.schedules && typeof root.schedules === 'object' ? root.schedules : null;
        const items = s && s.items && typeof s.items === 'object' ? s.items : null;
        const activeId = s && s.activeId ? String(s.activeId) : '';
        const it = items && activeId && items[activeId] ? items[activeId] : null;
        if (it && typeof it === 'object') return it;
      } catch (_) {}
      return { id: 'default', name: 'Default schedule', selected: {}, blocked: [], ui: {} };
    };

    const saveSchedulerRoot = (root) => {
      try {
        const key = `schedulerState_${termCode}`;
        planSetItem(key, JSON.stringify(root || {}));
      } catch (_) {}
    };

    const refreshScheduleLabel = () => {
      try {
        if (!scheduleNameEl) return;
        const active = getActiveSchedule(state);
        scheduleNameEl.textContent = String(active && active.name ? active.name : 'Schedule');
      } catch (_) {}
    };
    refreshScheduleLabel();

    // Collapsible sidebar sections (Current Term Plan / Selected Sections)
    const applyCollapse = (key, collapsed) => {
      const sec = body.querySelector(`.scheduler-collapsible[data-collapsible="${key}"]`);
      if (!sec) return;
      sec.classList.toggle('is-collapsed', !!collapsed);
    };
    const applyScheduleUi = () => {
      try {
        const root = state || loadSchedulerState(termCode);
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
        } catch (_) {}
        try { updateScrollbarCompensation(); } catch (_) {}
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
        } catch (_) {}
        try {
          updateScrollbarCompensation();
          requestAnimationFrame(() => updateScrollbarCompensation());
        } catch (_) {}
      });
    }

    body.querySelectorAll('.scheduler-collapsible-header').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sec = btn.closest('.scheduler-collapsible');
        if (!sec) return;
        sec.classList.toggle('is-collapsed');
        const key = sec.getAttribute('data-collapsible') || '';
        const root = loadSchedulerState(termCode);
        const active = getActiveSchedule(root);
        active.ui = active.ui && typeof active.ui === 'object' ? active.ui : {};
        if (key === 'plan') active.ui.planCollapsed = sec.classList.contains('is-collapsed');
        if (key === 'selected') active.ui.selectedCollapsed = sec.classList.contains('is-collapsed');
        if (key === 'blocked') active.ui.blockedCollapsed = sec.classList.contains('is-collapsed');
        // Persist only UI state (stored on the active schedule).
        saveSchedulerState(termCode, { ui: active.ui });
      });
    });

    const plannedCourses = getCurrentTermSemesterCourseCodes();
    const planListEl = body.querySelector('.scheduler-plan-list');
    if (plannedCourses.length) {
      planListEl.innerHTML = plannedCourses.map(c => (
        `<button type="button" class="scheduler-pill scheduler-plan-pick" data-course="${escapeHtml(c)}" title="Pick a section">${escapeHtml(c)}</button>`
      )).join('');
    } else {
      planListEl.innerHTML = '<div class="scheduler-muted">No courses in your current-term plan yet.</div>';
    }

    const resultsEl = body.querySelector('.scheduler-results');
    const selectedEl = body.querySelector('.scheduler-selected');
    const blockedListEl = body.querySelector('.scheduler-blocked-list');
    const blockedToggleBtn = body.querySelector('.scheduler-blocked-toggle');
    const blockedClearBtn = body.querySelector('.scheduler-blocked-clear');
    const searchEl = body.querySelector('.scheduler-search');
    const filterBtn = body.querySelector('.scheduler-filter-btn');
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

    // Scheduler controls mirror the main app's settings (sidebar toggles).
    const readBoolLS = (key, fallback) => {
      try {
        const v = localStorage.getItem(key);
        if (v === null) return fallback;
        return v === 'true';
      } catch (_) {
        return fallback;
      }
    };
    const readStrLS = (key, fallback) => {
      try {
        const v = localStorage.getItem(key);
        if (v === null) return fallback;
        return String(v);
      } catch (_) {
        return fallback;
      }
    };
    const setGlobalBool = (key, value) => {
      try { localStorage.setItem(key, value ? 'true' : 'false'); } catch (_) {}
      try {
        if (key === 'hideTakenCourses') window.hideTakenCourses = !!value;
        if (key === 'showCourseDetails') window.showCourseDetails = !!value;
        if (key === 'sortBasedOnScore') window.sortBasedOnScore = !!value;
      } catch (_) {}
    };

    try {
      if (hideTakenToggle) hideTakenToggle.checked = (typeof window !== 'undefined' && typeof window.hideTakenCourses !== 'undefined')
        ? !!window.hideTakenCourses
        : readBoolLS('hideTakenCourses', true);
    } catch (_) {}
    try {
      if (detailsToggle) detailsToggle.checked = (typeof window !== 'undefined' && typeof window.showCourseDetails !== 'undefined')
        ? !!window.showCourseDetails
        : readBoolLS('showCourseDetails', true);
    } catch (_) {}
    try {
      if (scoreToggle) scoreToggle.checked = (typeof window !== 'undefined' && typeof window.sortBasedOnScore !== 'undefined')
        ? !!window.sortBasedOnScore
        : readBoolLS('sortBasedOnScore', true);
    } catch (_) {}
    try {
      if (hoverPreviewToggle) hoverPreviewToggle.checked = readBoolLS('schedulerHoverPreview', true);
    } catch (_) {}
    try {
      if (highlightToggle) highlightToggle.checked = readBoolLS('schedulerHighlightAvailability', true);
    } catch (_) {}
    try {
      if (showBlockedToggle) showBlockedToggle.checked = readBoolLS('schedulerShowBlockedCourses', true);
    } catch (_) {}
    try { if (minMainTypeSelect) minMainTypeSelect.value = readStrLS('schedulerMinMajorType', ''); } catch (_) {}
    try { if (minDmTypeSelect) minDmTypeSelect.value = readStrLS('schedulerMinDmType', ''); } catch (_) {}
    try { if (minMinorTypeSelect) minMinorTypeSelect.value = readStrLS('schedulerMinMinorType', ''); } catch (_) {}
    try { if (minSuInput) minSuInput.value = readStrLS('schedulerMinSuCredits', ''); } catch (_) {}
    try { if (minEctsInput) minEctsInput.value = readStrLS('schedulerMinEcts', ''); } catch (_) {}
    try { if (minBsInput) minBsInput.value = readStrLS('schedulerMinBasicScience', ''); } catch (_) {}
    try { if (minEngInput) minEngInput.value = readStrLS('schedulerMinEngineering', ''); } catch (_) {}
    try { if (prereqToggle) prereqToggle.checked = readBoolLS('schedulerCheckPrereqs', true); } catch (_) {}
    try { if (showUnmetPrereqToggle) showUnmetPrereqToggle.checked = readBoolLS('schedulerShowUnmetPrereqs', true); } catch (_) {}

    const syncPrereqUi = () => {
      try {
        if (!showUnmetPrereqToggle) return;
        const enabled = !!(prereqToggle && prereqToggle.checked);
        showUnmetPrereqToggle.disabled = !enabled;
      } catch (_) {}
    };
    syncPrereqUi();

    let filterMenuOpen = false;
    const setFilterMenuOpen = (open) => {
      try {
        const next = !!open;
        filterMenuOpen = next;
        if (filterMenuEl) {
          filterMenuEl.hidden = !next;
          filterMenuEl.classList.toggle('is-open', next);
        }
        if (filterBtn) {
          filterBtn.classList.toggle('is-active', next);
          filterBtn.setAttribute('aria-expanded', next ? 'true' : 'false');
        }
      } catch (_) {}
    };
    setFilterMenuOpen(false);

    if (filterBtn) {
      filterBtn.addEventListener('click', (e) => {
        try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
        setFilterMenuOpen(!filterMenuOpen);
      });
    }

    body.addEventListener('click', (e) => {
      if (!filterMenuOpen) return;
      const t = e && e.target ? e.target : null;
      if (!t) return;
      const inMenu = !!(filterMenuEl && filterMenuEl.contains(t));
      const onBtn = !!(filterBtn && filterBtn.contains(t));
      if (!inMenu && !onBtn) setFilterMenuOpen(false);
    });

    const scheduleLoadingEl = document.createElement('div');
    scheduleLoadingEl.className = 'scheduler-muted';
    scheduleLoadingEl.textContent = 'Loading schedule data...';
    resultsEl.appendChild(scheduleLoadingEl);

    const sectionInstructorPreview = (sec) => {
      try {
        const set = new Set();
        const meetings = Array.isArray(sec && sec.meetings) ? sec.meetings : [];
        for (let i = 0; i < meetings.length; i++) {
          const mi = meetings[i] || {};
          const s = String(mi.instructors || mi.Instructors || mi.instructor || mi.Instructor || '').trim();
          if (s) set.add(s.replace(/\s+/g, ' '));
        }
        const arr = Array.from(set);
        return arr.slice(0, 2).join(' / ');
      } catch (_) {
        return '';
      }
    };

    const snapshotForSection = (sec) => {
      try {
        const meetings = (sec && Array.isArray(sec.meetings)) ? sec.meetings : [];
        const meetingBits = [];
        const instrSet = new Set();
        for (let i = 0; i < meetings.length; i++) {
          const m = meetings[i] || {};
          const days = String(m.days || m.Days || '').toUpperCase().replace(/\s+/g, '');
          let start = m.start_min;
          let end = m.end_min;
          if (start == null || end == null) {
            const tr = parseTimeRangeToMinutes(m.time || m.Time || '');
            if (tr) {
              start = tr.start;
              end = tr.end;
            }
          }
          const where = String(m.where || m.Where || '').trim();
          if (days && start != null && end != null) {
            meetingBits.push(`${days}|${start}|${end}|${where}`);
          }
          const instr = String(m.instructors || m.Instructors || m.instructor || m.Instructor || '').trim();
          if (instr) instrSet.add(instr.replace(/\s+/g, ' '));
        }
        meetingBits.sort();
        const meetingKey = meetingBits.length ? meetingBits.join('||') : 'TBA';
        const instrKey = Array.from(instrSet).sort().join('|');
        const meetingSummary = sectionMeetingPreview(sec, 10) || '';
        const instrSummary = sectionInstructorPreview(sec) || '';
        return { meetingKey, instrKey, meetingSummary, instrSummary };
      } catch (_) {
        return { meetingKey: 'TBA', instrKey: '', meetingSummary: '', instrSummary: '' };
      }
    };

    const computeSelectedSectionChangeReport = (idx, root) => {
      const changes = [];
      const seen = {};
      try {
        if (!idx || !root) return { changes, seen };
        const prevSeen = (root.lastSeenScheduleSnapshots && typeof root.lastSeenScheduleSnapshots === 'object')
          ? root.lastSeenScheduleSnapshots
          : {};
        const schedules = root.schedules && typeof root.schedules === 'object' ? root.schedules : null;
        const order = Array.isArray(schedules && schedules.order) ? schedules.order.map(String) : [];
        const items = schedules && schedules.items && typeof schedules.items === 'object' ? schedules.items : {};

        for (let si = 0; si < order.length; si++) {
          const sid = order[si];
          const sch = items[sid] || {};
          const schName = String(sch.name || (sid === 'default' ? 'Default schedule' : 'Schedule'));
          const selectedMap = (sch.selected && typeof sch.selected === 'object') ? sch.selected : {};
          const prevForSchedule = (prevSeen && prevSeen[sid] && typeof prevSeen[sid] === 'object') ? prevSeen[sid] : {};
          const nextForSchedule = {};

          for (const courseIdRaw of Object.keys(selectedMap)) {
            const courseId = normalizeCourseId(courseIdRaw);
            if (!courseId) continue;
            const pick = selectedMap[courseIdRaw] || selectedMap[courseId] || {};
            const crn = String(pick && pick.crn ? pick.crn : '').trim();
            if (!crn) continue;
            const entry = idx.get(courseId);
            if (!entry || !Array.isArray(entry.sections)) continue;
            const sec = entry.sections.find(s => String(s && s.crn ? s.crn : '') === crn) || null;
            if (!sec) continue;

            const snap = snapshotForSection(sec);
            nextForSchedule[courseId] = Object.assign({ crn }, snap);

            const prev = prevForSchedule && prevForSchedule[courseId] ? prevForSchedule[courseId] : null;
            if (!prev) continue; // first time seeing this selection: don't notify
            if (String(prev.crn || '') !== crn) continue; // user changed CRN: don't notify as "update"

            const hoursChanged = String(prev.meetingKey || '') !== String(snap.meetingKey || '');
            const instrChanged = String(prev.instrKey || '') !== String(snap.instrKey || '');
            if (!hoursChanged && !instrChanged) continue;

            changes.push({
              scheduleId: sid,
              scheduleName: schName,
              courseId,
              crn,
              hoursChanged,
              instrChanged,
              prev: {
                meetingSummary: String(prev.meetingSummary || ''),
                instrSummary: String(prev.instrSummary || ''),
              },
              cur: {
                meetingSummary: String(snap.meetingSummary || ''),
                instrSummary: String(snap.instrSummary || ''),
              },
            });
          }

          if (Object.keys(nextForSchedule).length) {
            seen[sid] = nextForSchedule;
          }
        }
      } catch (_) {}
      return { changes, seen };
    };

    const getSelectedSection = (courseId) => {
      try {
        if (!scheduleIndex) return null;
        const entry = scheduleIndex.get(courseId);
        if (!entry) return null;
        const pick = selected[courseId];
        const crn = pick && pick.crn ? String(pick.crn) : '';
        return entry.sections.find(s => String(s.crn) === crn) || null;
      } catch (_) {
        return null;
      }
    };

    const buildReverseCoreqIndex = (idx) => {
      const map = new Map(); // coreq -> Set(base)
      try {
        if (!idx || !coursePageInfoMap) return map;
        for (const entry of idx.values()) {
          const courseId = entry && entry.course_id ? normalizeCourseId(entry.course_id) : '';
          if (!courseId) continue;
          const info = coursePageInfoMap.get(courseId);
          if (!info || !info.corequisites) continue;
          const coreqs = extractCoreqCourseIdsFromCoursePageInfoField(info.corequisites)
            .map(c => normalizeCourseId(c))
            .filter(Boolean)
            .filter(c => idx.get(c));
          for (let i = 0; i < coreqs.length; i++) {
            const c = coreqs[i];
            const set = map.get(c) || new Set();
            set.add(courseId);
            map.set(c, set);
          }
        }
      } catch (_) {}
      return map;
    };

    const getCoreqsFor = (courseId) => {
      try {
        const cid = normalizeCourseId(courseId);
        if (!cid || !coursePageInfoMap) return [];
        const info = coursePageInfoMap.get(cid);
        if (!info || !info.corequisites) return [];
        return extractCoreqCourseIdsFromCoursePageInfoField(info.corequisites)
          .map(c => normalizeCourseId(c))
          .filter(Boolean);
      } catch (_) {
        return [];
      }
    };

    const computeBundleClosure = (courseId) => {
      const start = normalizeCourseId(courseId);
      const set = new Set();
      const stack = [];
      if (!start) return set;
      set.add(start);
      stack.push(start);

      const keys = Object.keys(selected);
      while (stack.length) {
        const curId = stack.pop();
        // Forward edges: cur -> its selected coreqs
        const coreqs = getCoreqsFor(curId);
        for (let i = 0; i < coreqs.length; i++) {
          const c = coreqs[i];
          if (!selected[c]) continue;
          if (set.has(c)) continue;
          set.add(c);
          stack.push(c);
        }
        // Reverse edges: other selected course requires cur
        for (let i = 0; i < keys.length; i++) {
          const other = keys[i];
          if (!other || set.has(other)) continue;
          const reqs = getCoreqsFor(other);
          if (reqs.includes(curId)) {
            set.add(other);
            stack.push(other);
          }
        }
      }
      return set;
    };

    const normalizePlannerCode = (code) => {
      const n = normalizeCourseId(code);
      if (n === 'CS210' || n === 'DSA210') return 'DSA210';
      return n;
    };

    const getPlannerInfo = (code) => {
      try {
        if (typeof getInfo === 'function') return getInfo(code, course_data);
      } catch (_) {}
      try {
        if (typeof window !== 'undefined' && typeof window.getInfo === 'function') return window.getInfo(code, course_data);
      } catch (_) {}
      return null;
    };

    const fmtCredit = (v) => {
      try {
        if (typeof window !== 'undefined' && typeof window.formatCreditValue === 'function') return window.formatCreditValue(v);
      } catch (_) {}
      const n = parseFloat(v || '0') || 0;
      return n.toFixed(1);
    };

    const buildTypeMaps = () => {
      const maps = { dm: new Map(), minors: [] };
      try {
        const cur = (typeof window !== 'undefined') ? window.curriculum : null;
        if (cur && cur.doubleMajor && Array.isArray(cur.doubleMajorCourseData)) {
          for (let i = 0; i < cur.doubleMajorCourseData.length; i++) {
            const r = cur.doubleMajorCourseData[i];
            if (!r) continue;
            const code = normalizeCourseId((r.Major || '') + (r.Code || ''));
            if (!code) continue;
            if (!maps.dm.has(code)) maps.dm.set(code, String(r.EL_Type || '').toLowerCase());
          }
        }
        if (cur && Array.isArray(cur.minors) && cur.minors.length && cur.minorCourseDataByCode) {
          cur.minors.forEach(minorCode => {
            const list = cur.minorCourseDataByCode[minorCode];
            if (!Array.isArray(list)) return;
            const m = new Map();
            for (let i = 0; i < list.length; i++) {
              const r = list[i];
              if (!r) continue;
              const code = normalizeCourseId((r.Major || '') + (r.Code || ''));
              if (!code) continue;
              if (!m.has(code)) m.set(code, String(r.EL_Type || '').toLowerCase());
            }
            maps.minors.push({ code: minorCode, map: m });
          });
        }
      } catch (_) {}
      return maps;
    };

    let typeMapsCache = null;
    let typeMapsCacheKey = '';
    const getTypeMaps = () => {
      try {
        const cur = (typeof window !== 'undefined') ? window.curriculum : null;
        const dm = cur ? String(cur.doubleMajor || '') : '';
        const dmLen = (cur && Array.isArray(cur.doubleMajorCourseData)) ? cur.doubleMajorCourseData.length : 0;
        const minors = (cur && Array.isArray(cur.minors)) ? cur.minors.slice().sort() : [];
        const minorLens = [];
        try {
          if (cur && cur.minorCourseDataByCode) {
            minors.forEach(m => {
              const list = cur.minorCourseDataByCode[m];
              minorLens.push(Array.isArray(list) ? list.length : 0);
            });
          }
        } catch (_) {}
        const key = [dm, dmLen, minors.join(','), minorLens.join(':')].join('|');
        if (typeMapsCache && typeMapsCacheKey === key) return typeMapsCache;
        typeMapsCache = buildTypeMaps();
        typeMapsCacheKey = key;
        return typeMapsCache;
      } catch (_) {
        return buildTypeMaps();
      }
    };

    const getCourseDetails = (courseId) => {
      const cid = normalizePlannerCode(courseId);
      const out = { title: '', su: 0, ects: 0, bs: 0, eng: 0, mainType: '', dmType: '', minorTypes: [] };
      try {
        const info = getPlannerInfo(cid);
        if (info) {
          out.title = String(info.Course_Name || info.course_name || info.title || '').trim();
          out.su = (typeof window !== 'undefined' && typeof window.parseCreditValue === 'function')
            ? window.parseCreditValue(info.SU_credit || '0')
            : (parseFloat(info.SU_credit || '0') || 0);
          out.ects = parseFloat(info.ECTS || '0') || 0;
          out.bs = parseFloat(info.Basic_Science || '0') || 0;
          out.eng = parseFloat(info.Engineering || '0') || 0;
          out.mainType = String(info.EL_Type || '').toLowerCase();
        }
      } catch (_) {}
      try {
        if ((!out.title || !out.su || !out.ects) && coursePageInfoMap && typeof coursePageInfoMap.get === 'function') {
          const pi = coursePageInfoMap.get(cid);
          if (pi) {
            if (!out.title) out.title = String(pi.title || pi.header_text || '').trim();
            if (!out.su && pi.su_credits != null) out.su = parseFloat(pi.su_credits) || 0;
            if (!out.ects && pi.ects != null) out.ects = parseFloat(pi.ects) || 0;
            if (!out.bs && pi.basic_science != null) out.bs = parseFloat(pi.basic_science) || 0;
            if (!out.eng && pi.engineering != null) out.eng = parseFloat(pi.engineering) || 0;
          }
        }
      } catch (_) {}
      try {
        const maps = getTypeMaps();
        if (maps && maps.dm && maps.dm.has(cid)) out.dmType = maps.dm.get(cid) || '';
      } catch (_) {}
      try {
        const maps = getTypeMaps();
        const arr = (maps && maps.minors) ? maps.minors : [];
        for (let i = 0; i < arr.length; i++) {
          const m = arr[i];
          if (!m || !m.map) continue;
          if (m.map.has(cid)) out.minorTypes.push({ code: m.code, type: m.map.get(cid) || '' });
        }
      } catch (_) {}
      // Extra fallback: if a double major is selected but the dm map misses this
      // course for any reason, try direct lookup in the DM catalog list.
      try {
        if (!out.dmType) {
          const cur = (typeof window !== 'undefined') ? window.curriculum : null;
          if (cur && cur.doubleMajor && Array.isArray(cur.doubleMajorCourseData)) {
            for (let i = 0; i < cur.doubleMajorCourseData.length; i++) {
              const r = cur.doubleMajorCourseData[i];
              if (!r) continue;
              const code = normalizeCourseId((r.Major || '') + (r.Code || ''));
              if (code === cid) {
                out.dmType = String(r.EL_Type || '').toLowerCase();
                break;
              }
            }
          }
        }
      } catch (_) {}
      return out;
    };

    const shouldHideTaken = () => {
      try {
        if (typeof window !== 'undefined' && typeof window.hideTakenCourses !== 'undefined') return !!window.hideTakenCourses;
      } catch (_) {}
      try { return readBoolLS('hideTakenCourses', true); } catch (_) {}
      return true;
    };
    const shouldShowDetails = () => {
      try {
        if (typeof window !== 'undefined' && typeof window.showCourseDetails !== 'undefined') return !!window.showCourseDetails;
      } catch (_) {}
      try { return readBoolLS('showCourseDetails', true); } catch (_) {}
      return true;
    };
    const shouldSortByScore = () => {
      try {
        if (typeof window !== 'undefined' && typeof window.sortBasedOnScore !== 'undefined') return !!window.sortBasedOnScore;
      } catch (_) {}
      try { return readBoolLS('sortBasedOnScore', true); } catch (_) {}
      return true;
    };
    const shouldHoverPreview = () => {
      try { return readBoolLS('schedulerHoverPreview', true); } catch (_) {}
      return true;
    };
    const shouldHighlightAvailability = () => {
      try { return readBoolLS('schedulerHighlightAvailability', true); } catch (_) {}
      return true;
    };
    const shouldShowBlockedCourses = () => {
      try { return readBoolLS('schedulerShowBlockedCourses', true); } catch (_) {}
      return true;
    };

    const getBlockedByDay = () => {
      const out = {};
      DAYS.forEach(d => { out[d.key] = []; });
      try {
        const list = Array.isArray(blocked) ? blocked : [];
        for (let i = 0; i < list.length; i++) {
          const b = list[i] || {};
          const dayKey = String(b.dayKey || '').trim();
          const start = Number(b.start);
          const end = Number(b.end);
          if (!out[dayKey]) continue;
          if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
          if (end <= start) continue;
          out[dayKey].push({ id: String(b.id || ''), start, end });
        }
        for (const k of Object.keys(out)) out[k].sort((a, b) => a.start - b.start);
      } catch (_) {}
      return out;
    };

    const mergeBlockedIntervalsForDay = (dayKey, list) => {
      try {
        const items = (Array.isArray(list) ? list : [])
          .map(x => ({ start: Number(x.start), end: Number(x.end), id: String(x.id || '') }))
          .filter(x => Number.isFinite(x.start) && Number.isFinite(x.end) && x.end > x.start)
          .sort((a, b) => a.start - b.start);
        const merged = [];
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          const last = merged[merged.length - 1];
          if (!last || it.start > last.end) {
            merged.push({ id: it.id || `${Date.now()}_${Math.random().toString(16).slice(2)}`, start: it.start, end: it.end });
            continue;
          }
          last.end = Math.max(last.end, it.end);
        }
        return merged.map(x => ({ id: x.id, dayKey, start: x.start, end: x.end }));
      } catch (_) {
        return [];
      }
    };

    const setBlocked = (next) => {
      blocked = Array.isArray(next) ? next : [];
      saveSchedulerState(termCode, { blocked });
    };

    const renderBlocked = () => {
      if (!blockedListEl) return;
      const list = Array.isArray(blocked) ? blocked.slice() : [];
      list.sort((a, b) => {
        const da = String(a.dayKey || '');
        const db = String(b.dayKey || '');
        if (da !== db) return da.localeCompare(db);
        return (Number(a.start) || 0) - (Number(b.start) || 0);
      });
      if (!list.length) {
        blockedListEl.innerHTML = '<div class="scheduler-muted">No blocked hours.</div>';
        return;
      }
      blockedListEl.innerHTML = list.map((b) => {
        const day = String(b.dayKey || '');
        const start = Number(b.start);
        const end = Number(b.end);
        const label = `${day} ${minutesToLabel(start)}–${minutesToLabel(end)}`;
        return (
          `<div class="scheduler-blocked-item" data-block-id="${escapeHtml(String(b.id || ''))}">` +
          `<div class="scheduler-blocked-label">${escapeHtml(label)}</div>` +
          `<div class="scheduler-blocked-actions-row">` +
          `<button type="button" class="btn btn-secondary btn-sm scheduler-blocked-remove" data-block-id="${escapeHtml(String(b.id || ''))}">Remove</button>` +
          `</div>` +
          `</div>`
        );
      }).join('');
    };

    let blockMode = false;
    const setBlockMode = (enabled) => {
      blockMode = !!enabled;
      try { modal.classList.toggle('is-block-mode', blockMode); } catch (_) {}
      try { if (blockModeBtn) blockModeBtn.classList.toggle('is-active', blockMode); } catch (_) {}
      try { if (blockedToggleBtn) blockedToggleBtn.textContent = blockMode ? 'Exit block mode' : 'Block hours'; } catch (_) {}
      try { if (blockModeBtn) blockModeBtn.title = blockMode ? 'Exit block mode' : 'Block hours'; } catch (_) {}
    };

    const computeBlockedFitCache = { sig: '', map: new Map() };
    const blockedSig = () => {
      try {
        const list = Array.isArray(blocked) ? blocked.slice() : [];
        list.sort((a, b) => {
          const da = String(a.dayKey || '');
          const db = String(b.dayKey || '');
          if (da !== db) return da.localeCompare(db);
          return (Number(a.start) || 0) - (Number(b.start) || 0);
        });
        return list.map(b => `${b.dayKey}:${b.start}-${b.end}`).join('|');
      } catch (_) {
        return '';
      }
    };

    const canFitWithBlockedHours = (idx, courseId) => {
      try {
        const sig = blockedSig();
        if (computeBlockedFitCache.sig !== sig) {
          computeBlockedFitCache.sig = sig;
          computeBlockedFitCache.map = new Map();
        }
        const cid = normalizeCourseId(courseId);
        if (!cid) return true;
        if (computeBlockedFitCache.map.has(cid)) return computeBlockedFitCache.map.get(cid);
        const byDay = getBlockedByDay();
        const bundle = getRequiredBundleCourseIds(idx, cid);
        const best = pickBestBundleSections(idx, bundle, byDay);
        const ok = !!(best && typeof best.conflicts === 'number' && best.conflicts === 0);
        computeBlockedFitCache.map.set(cid, ok);
        return ok;
      } catch (_) {
        return true;
      }
    };

    // In the scheduler, "taken" is treated as "already present anywhere in the
    // user's plan". We keep current-term planned/selected courses visible via
    // keepVisible so users can still schedule them.
    let takenAnySet = null; // Set(courseId) populated per renderResults
    let takenBeforeCurrentSet = null; // Set(courseId) populated per renderResults (previous terms only)
    const computeTakenAnySet = () => {
      try {
        const cur = (typeof window !== 'undefined') ? window.curriculum : null;
        if (!cur || !Array.isArray(cur.semesters)) return null;
        const out = new Set();
        for (let i = 0; i < cur.semesters.length; i++) {
          const sem = cur.semesters[i];
          if (!sem || !Array.isArray(sem.courses)) continue;
          for (let j = 0; j < sem.courses.length; j++) {
            const cc = sem.courses[j];
            const cid = normalizeCourseId(cc && cc.code);
            if (cid) out.add(cid);
          }
        }
        return out;
      } catch (_) {
        return null;
      }
    };

    // Taken courses from previous terms only (used for prereq checking).
    const computeTakenBeforeCurrentTermSet = () => {
      try {
        const cur = (typeof window !== 'undefined') ? window.curriculum : null;
        if (!cur) return null;
        const curCode = parseInt(String(termCode || ''), 10) || 0;
        if (!curCode) return null;
        const out = new Set();
        const containers = document.querySelectorAll('.container_semester');
        for (let i = 0; i < containers.length; i++) {
          const c = containers[i];
          const p = c ? c.querySelector('.date p') : null;
          const name = p ? String(p.textContent || '').trim() : '';
          const code = parseInt(String(termNameToCodeSafe(name) || ''), 10) || 0;
          if (!code || code >= curCode) continue;
          const semEl = c ? c.querySelector('.semester') : null;
          if (!semEl) continue;
          const semObj = (cur && typeof cur.getSemester === 'function') ? cur.getSemester(semEl.id) : null;
          if (!semObj || !Array.isArray(semObj.courses)) continue;
          for (let j = 0; j < semObj.courses.length; j++) {
            const cc = semObj.courses[j];
            const cid = normalizeCourseId(cc && cc.code);
            if (cid) out.add(cid);
          }
        }
        return out;
      } catch (_) {
        return null;
      }
    };

    const prereqCheckCache = { sig: '', map: new Map() }; // course_id -> {mode, missing} | null
    const prereqAstCache = new Map(); // course_id -> parsed AST | null

    const isTakenCourse = (courseId) => {
      try {
        const cid = normalizeCourseId(courseId);
        if (!cid) return false;
        if (takenAnySet instanceof Set) return takenAnySet.has(cid);
        const cur = (typeof window !== 'undefined') ? window.curriculum : null;
        if (!cur || typeof cur.hasCourse !== 'function') return false;
        return !!cur.hasCourse(cid);
      } catch (_) {
        return false;
      }
    };

    const getSectionIntervals = (sec) => {
      const out = [];
      try {
        const meetings = Array.isArray(sec && sec.meetings) ? sec.meetings : [];
        for (let i = 0; i < meetings.length; i++) {
          const m = meetings[i] || {};
          const days = parseDaysToKeys(m.days || m.Days || '');
          let start = m.start_min;
          let end = m.end_min;
          if (start == null || end == null) {
            const tr = parseTimeRangeToMinutes(m.time || m.Time || '');
            if (!tr) continue;
            start = tr.start;
            end = tr.end;
          }
          if (!days.length) continue;
          if (start < DAY_START_MIN || end > DAY_END_MIN) continue;
          for (let di = 0; di < days.length; di++) {
            out.push({ dayKey: days[di], start, end });
          }
        }
      } catch (_) {}
      return out;
    };

    const countIntervalOverlaps = (interval, existingIntervals) => {
      let c = 0;
      try {
        const list = Array.isArray(existingIntervals) ? existingIntervals : [];
        for (let i = 0; i < list.length; i++) {
          const it = list[i];
          if (!it) continue;
          if (interval.end <= it.start) continue;
          if (interval.start >= it.end) continue;
          c += 1;
        }
      } catch (_) {}
      return c;
    };

    const getOccupiedByDayFromSelected = (idx, opts) => {
      const occ = {};
      DAYS.forEach(d => { occ[d.key] = []; });
      try {
        if (!idx) return occ;
        const includeBlocked = !!(opts && opts.includeBlocked);
        if (includeBlocked) {
          const byDay = getBlockedByDay();
          for (const dayKey of Object.keys(byDay)) {
            const list = byDay[dayKey] || [];
            for (let i = 0; i < list.length; i++) {
              const b = list[i];
              occ[dayKey].push({ start: b.start, end: b.end, course_id: '__blocked__' });
            }
          }
        }
        const keys = Object.keys(selected);
        for (let i = 0; i < keys.length; i++) {
          const courseId = normalizeCourseId(keys[i]);
          if (!courseId) continue;
          const entry = idx.get(courseId);
          if (!entry) continue;
          const pick = selected[courseId];
          const crn = pick && pick.crn ? String(pick.crn) : '';
          const sec = entry.sections.find(s => String(s.crn) === crn) || null;
          if (!sec) continue;
          const intervals = getSectionIntervals(sec);
          for (let j = 0; j < intervals.length; j++) {
            const it = intervals[j];
            if (!occ[it.dayKey]) occ[it.dayKey] = [];
            occ[it.dayKey].push({ start: it.start, end: it.end, course_id: courseId });
          }
        }
      } catch (_) {}
      return occ;
    };

    const getRequiredBundleCourseIds = (idx, baseCourseId) => {
      const start = normalizeCourseId(baseCourseId);
      if (!start || !idx) return [];
      const out = [];
      const seen = new Set();
      const stack = [start];
      while (stack.length) {
        const cid = normalizeCourseId(stack.pop());
        if (!cid || seen.has(cid)) continue;
        seen.add(cid);
        if (!idx.get(cid)) continue;
        out.push(cid);
        try {
          const coreqs = getCoreqsFor(cid)
            .map(x => normalizeCourseId(x))
            .filter(Boolean)
            .filter(x => idx.get(x));
          for (let i = 0; i < coreqs.length; i++) stack.push(coreqs[i]);
        } catch (_) {}
      }
      // Ensure base is first.
      if (out.length > 1) {
        const idx = out.indexOf(start);
        if (idx > 0) {
          out.splice(idx, 1);
          out.unshift(start);
        }
      }
      return out;
    };

    const pickBestBundleSections = (idx, bundleCourseIds, baseOccByDay) => {
      try {
        if (!idx || !bundleCourseIds || !bundleCourseIds.length) return null;
        const candidatesByCourse = {};
        for (let i = 0; i < bundleCourseIds.length; i++) {
          const cid = bundleCourseIds[i];
          const entry = idx.get(cid);
          if (!entry || !Array.isArray(entry.sections) || !entry.sections.length) return null;
          const secs = entry.sections.slice();
          secs.sort((a, b) => {
            const aL = /lec/i.test(a.component || '') ? 0 : 1;
            const bL = /lec/i.test(b.component || '') ? 0 : 1;
            if (aL !== bL) return aL - bL;
            const as = String(a.section || '');
            const bs = String(b.section || '');
            if (as !== bs) return as.localeCompare(bs);
            return String(a.component || '').localeCompare(String(b.component || ''));
          });
          candidatesByCourse[cid] = secs.slice(0, 80);
        }

        const occ = {};
        DAYS.forEach(d => { occ[d.key] = (baseOccByDay && Array.isArray(baseOccByDay[d.key])) ? baseOccByDay[d.key].slice() : []; });

        let best = { conflicts: Infinity, picked: null };
        const picked = {};

        const dfs = (i, conflicts) => {
          if (conflicts >= best.conflicts) return;
          if (best.conflicts === 0) return;
          if (i >= bundleCourseIds.length) {
            best = { conflicts, picked: Object.assign({}, picked) };
            return;
          }
          const cid = bundleCourseIds[i];
          const secs = candidatesByCourse[cid] || [];
          for (let si = 0; si < secs.length; si++) {
            const sec = secs[si];
            const intervals = getSectionIntervals(sec);
            let extra = 0;
            const addedByDay = {};
            for (let j = 0; j < intervals.length; j++) {
              const it = intervals[j];
              if (!occ[it.dayKey]) occ[it.dayKey] = [];
              extra += countIntervalOverlaps(it, occ[it.dayKey]);
              occ[it.dayKey].push({ start: it.start, end: it.end, course_id: cid });
              addedByDay[it.dayKey] = (addedByDay[it.dayKey] || 0) + 1;
            }
            picked[cid] = sec;
            dfs(i + 1, conflicts + extra);
            delete picked[cid];
            for (const dayKey of Object.keys(addedByDay)) {
              const n = addedByDay[dayKey] || 0;
              if (n > 0 && occ[dayKey] && occ[dayKey].length >= n) occ[dayKey].splice(-n, n);
            }
            if (best.conflicts === 0) return;
          }
        };

        dfs(0, 0);
        return best && best.picked ? best : null;
      } catch (_) {
        return null;
      }
    };

    const clearPreviewBlocks = () => {
      try { body.querySelectorAll('.scheduler-block.is-preview').forEach(el => el.remove()); } catch (_) {}
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

    const renderPreviewForCourse = (idx, baseCourseId) => {
      clearPreviewBlocks();
      try {
        if (!idx || !baseCourseId) return;
        if (!shouldHoverPreview()) return;
        const cid = normalizeCourseId(baseCourseId);
        if (!cid) return;
        try {
          // For hover previews, only treat "taken" as "completed in previous terms".
          // Courses that are just in the current-term plan should still preview.
          if (!(takenBeforeCurrentSet instanceof Set)) takenBeforeCurrentSet = computeTakenBeforeCurrentTermSet();
          if (takenBeforeCurrentSet instanceof Set && takenBeforeCurrentSet.has(cid)) return;
        } catch (_) {}
        if (selected[cid]) return;

        const bundle = getRequiredBundleCourseIds(idx, cid);
        if (!bundle.length) return;

        const baseOcc = getOccupiedByDayFromSelected(idx, { includeBlocked: true });
        const best = pickBestBundleSections(idx, bundle, baseOcc);
        if (!best || !best.picked) return;

        const picked = best.picked;
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
            const col = body.querySelector(`.scheduler-day-col[data-day="${it.dayKey}"]`);
            if (!col) continue;
            const block = document.createElement('div');
            block.className = 'scheduler-block is-preview';
            const dr = getDisplayRange(it.start, it.end);
            setBlockPosition(block, dr.start, dr.end);
            block.style.background = color;
            block.setAttribute('data-course', courseId);
            block.innerHTML = `<div class="scheduler-block-title">${escapeHtml(label)}</div>` +
              `<div class="scheduler-block-time">${escapeHtml(minutesToLabel(it.start))}–${escapeHtml(minutesToLabel(it.end))}</div>`;
            try {
              if (countIntervalOverlaps(it, baseOcc[it.dayKey] || []) > 0) block.classList.add('is-preview-conflict');
            } catch (_) {}
            col.appendChild(block);
          }
        }
      } catch (_) {}
    };

    let hoverSelectedCourseId = '';
    let hoverResultCourseId = '';

    const computeScore = (courseId) => {
      try {
        const fn = (typeof window !== 'undefined') ? window.computeCourseSuggestionScore : null;
        if (typeof fn === 'function') return fn(courseId, { schedulerPreviousOnly: true }) || 0;
      } catch (_) {}
      return 0;
    };

    const renderSelected = () => {
      const keys = Object.keys(selected);
      if (!keys.length) {
        selectedEl.innerHTML = '<div class="scheduler-muted">No sections selected.</div>';
        clearHoverHighlights();
        return;
      }

      // Bundle corequisite sections under their main course so users don't end
      // up with "lecture without recitation" (or vice-versa) hidden in the list.
      const selectedKeys = keys.map(k => normalizeCourseId(k)).filter(Boolean);
      const selectedSet = new Set(selectedKeys);
      const parentsFor = (cid) => {
        try {
          const set = reverseCoreqIndex ? reverseCoreqIndex.get(cid) : null;
          return set ? Array.from(set) : [];
        } catch (_) {
          return [];
        }
      };
      const hasSelectedParent = (cid) => {
        try {
          const parents = parentsFor(cid);
          for (let i = 0; i < parents.length; i++) {
            const p = parents[i];
            if (!selectedSet.has(p)) continue;
            const coreqs = getCoreqsFor(p).map(x => normalizeCourseId(x)).filter(Boolean);
            if (coreqs.includes(cid)) return true;
          }
        } catch (_) {}
        return false;
      };

      const roots = selectedKeys
        .filter(cid => !(reverseCoreqIndex && reverseCoreqIndex.has(cid) && hasSelectedParent(cid)))
        .sort((a, b) => String(a).localeCompare(String(b)));

      selectedEl.innerHTML = roots.map((courseId) => {
        const s = selected[courseId] || selected[normalizeCourseId(courseId)] || null;
        const sec = getSelectedSection(courseId);
        const sectionLabel = sec && sec.section ? `-${sec.section}` : '';
        const comp = sec && sec.component ? ` • ${String(sec.component)}` : '';
        const label = `${courseId}${sectionLabel}${comp}`;

        const miss = Array.isArray(missingByCourse[courseId]) ? missingByCourse[courseId] : [];
        const orphan = Array.isArray(orphanByCourse[courseId]) ? orphanByCourse[courseId] : [];

        const instr = sectionInstructorPreview(sec);
        const url = (s && s.crn) ? buildDetailUrl(s.crn) : '';

        const showDetails = shouldShowDetails();
        const d = showDetails ? getCourseDetails(courseId) : null;
        const typeParts = [];
        try {
          if (d && d.mainType) typeParts.push(`Major: ${String(d.mainType).toUpperCase()}`);
          if (d && d.dmType) typeParts.push(`DM: ${String(d.dmType).toUpperCase()}`);
          if (d && Array.isArray(d.minorTypes) && d.minorTypes.length) {
            d.minorTypes.slice(0, 2).forEach(mt => {
              if (!mt || !mt.type) return;
              typeParts.push(`Minor: ${String(mt.type).toUpperCase()}`);
            });
          }
        } catch (_) {}

        const detailLine = (showDetails && d)
          ? (
            (() => {
              const parts = [];
              parts.push(`<span class="muted">Credits:</span> ${escapeHtml(fmtCredit(d.su))} SU`);
              if ((d.bs || 0) > 0) parts.push(`<span class="scheduler-meta-bs">BS</span>: ${escapeHtml(fmtCredit(d.bs))}`);
              if ((d.eng || 0) > 0) parts.push(`<span class="scheduler-meta-eng">ENG</span>: ${escapeHtml(fmtCredit(d.eng))}`);
              if (typeParts.length) parts.push(`<span class="muted">Type:</span> ${escapeHtml(typeParts.join(' / '))}`);
              return `<div class="scheduler-selected-meta">${parts.join(' • ')}</div>`;
            })()
          )
          : '';

        const coreqs = (() => {
          try {
            return getCoreqsFor(courseId)
              .map(c => normalizeCourseId(c))
              .filter(Boolean)
              .filter(c => scheduleIndex && scheduleIndex.get(c));
          } catch (_) {
            return [];
          }
        })();

        const coreqHtml = coreqs.length
          ? (
            `<div class="scheduler-course-coreqs">` +
            `<div class="scheduler-course-coreqs-title">Linked recitation/lab</div>` +
            coreqs.map((cid) => {
              const sel = selected[cid];
              const sec2 = sel ? getSelectedSection(cid) : null;
              const comp2 = sec2 && sec2.component ? String(sec2.component) : '';
              const secLabel2 = sel && sec2 && sec2.section ? `-${sec2.section}` : '';
              const meta = sel ? `${cid}${secLabel2}${comp2 ? ` • ${escapeHtml(comp2)}` : ''}` : cid;
              const missing = miss.includes(cid);
              const btnText = sel ? 'Change' : 'Pick';
              return (
                `<div class="scheduler-coreq-row${missing ? ' is-missing' : ''}">` +
                `<div class="scheduler-coreq-label">${missing ? '<span class="scheduler-coreq-badge">Required</span>' : ''}${escapeHtml(meta)}</div>` +
                `<div class="scheduler-coreq-actions">` +
                `<button class="btn btn-secondary btn-sm scheduler-details" type="button" data-course="${escapeHtml(cid)}">Details</button>` +
                `<button class="btn btn-secondary btn-sm scheduler-pick" type="button" data-course="${escapeHtml(cid)}">${btnText}</button>` +
                (sel ? `<button class="scheduler-remove btn btn-secondary btn-sm" type="button" data-course="${escapeHtml(cid)}">Remove</button>` : '') +
                `</div>` +
                `</div>`
              );
            }).join('') +
            `</div>`
          )
          : '';

        return (
          `<div class="scheduler-selected-item${(miss.length || orphan.length) ? ' is-missing-coreq' : ''}" data-course="${escapeHtml(courseId)}">` +
          `<div class="scheduler-selected-label"><span class="scheduler-color-dot" style="background:${escapeHtml(hslFromString(courseId))}"></span>${escapeHtml(label)}</div>` +
          (instr ? `<div class="scheduler-selected-meta"><span class="muted">Instructor:</span> ${escapeHtml(instr)}</div>` : '') +
          detailLine +
          (miss.length ? `<div class="scheduler-selected-warning"><span class="muted">Missing coreq:</span> ${escapeHtml(miss.join(', '))}</div>` : '') +
          (orphan.length ? `<div class="scheduler-selected-warning"><span class="muted">Looks like a coreq for:</span> ${escapeHtml(orphan.join(', '))}</div>` : '') +
          `<div class="scheduler-selected-actions-row">` +
          `<button type="button" class="btn btn-secondary btn-sm scheduler-details" data-course="${escapeHtml(courseId)}">Details</button>` +
          `<button type="button" class="btn btn-secondary btn-sm scheduler-pick" data-course="${escapeHtml(courseId)}">Change</button>` +
          ((miss.length || orphan.length) ? `<button type="button" class="btn btn-warning btn-sm scheduler-fix-coreq" data-course="${escapeHtml(courseId)}">Fix</button>` : '') +
          `<button type="button" class="scheduler-remove btn btn-secondary btn-sm" data-course="${escapeHtml(courseId)}">Remove</button>` +
          `</div>` +
          coreqHtml +
          `</div>`
        );
      }).join('');

      // If the user is currently hovering something in the selected list,
      // re-apply the highlight after the DOM is rebuilt.
      try {
        if (hoverSelectedCourseId && shouldHoverPreview()) {
          const items = selectedEl.querySelectorAll('.scheduler-selected-item[data-course]');
          let found = false;
          items.forEach((it) => {
            if (found) return;
            const cid = normalizeCourseId(it.getAttribute('data-course') || '');
            if (cid && cid === normalizeCourseId(hoverSelectedCourseId)) found = true;
          });
          if (!found) {
            hoverSelectedCourseId = '';
            clearHoverHighlights();
            return;
          }
          const bundle = computeBundleClosure(hoverSelectedCourseId);
          applyHoverHighlightForCourses(bundle);
        }
      } catch (_) {}
    };

    const clearGridBlocks = () => {
      try {
        body.querySelectorAll('.scheduler-block').forEach(el => el.remove());
      } catch (_) {}
    };

    const renderBlockedBackground = () => {
      try {
        // Remove previous blocked backgrounds (keeps course blocks).
        body.querySelectorAll('.scheduler-block.scheduler-block-bg').forEach(el => el.remove());
      } catch (_) {}
      const byDay = getBlockedByDay();
      for (const dayKey of Object.keys(byDay)) {
        const col = body.querySelector(`.scheduler-day-col[data-day="${dayKey}"]`);
        if (!col) continue;
        const list = byDay[dayKey] || [];
        for (let i = 0; i < list.length; i++) {
          const b = list[i];
          const start = b.start;
          const end = b.end;
          const block = document.createElement('div');
          block.className = 'scheduler-block scheduler-block-bg is-blocked';
          try { if (b && b.id) block.setAttribute('data-block-id', String(b.id)); } catch (_) {}
          const dr = getDisplayRange(start, end);
          setBlockPosition(block, dr.start, dr.end);
          block.style.background = 'rgba(107, 114, 128, 0.35)';
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
      clearGridBlocks();
      clearPreviewBlocks();
      renderBlockedBackground();
      const blocksByDay = {};
      DAYS.forEach(d => blocksByDay[d.key] = []);

      const addBlock = (dayKey, start, end, label, color, meta) => {
        const col = body.querySelector(`.scheduler-day-col[data-day="${dayKey}"]`);
        if (!col) return;
        const block = document.createElement('button');
        block.type = 'button';
        block.className = 'scheduler-block';
        const dr = getDisplayRange(start, end);
        setBlockPosition(block, dr.start, dr.end);
        block.style.background = color;
        try { if (meta && meta.course_id) block.setAttribute('data-course', String(meta.course_id)); } catch (_) {}
        try { block.setAttribute('data-kind', 'course'); } catch (_) {}
        try { block.setAttribute('data-day', String(dayKey)); } catch (_) {}
        try { block.setAttribute('data-start', String(start)); } catch (_) {}
        try { block.setAttribute('data-end', String(end)); } catch (_) {}
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
              (meta && meta.where ? `<p><span class="muted">Where:</span> ${escapeHtml(meta.where)}</p>` : '') +
              (meta && meta.instructors ? `<p><span class="muted">Instructors:</span> ${escapeHtml(meta.instructors)}</p>` : ''),
            buttons: [
              { action: 'close', label: 'Close', variant: 'secondary' },
              { action: 'details', label: 'Details', variant: 'secondary', value: meta && meta.course_id ? meta.course_id : null },
              { action: 'change', label: 'Change section', variant: 'secondary', value: meta && meta.course_id ? meta.course_id : null },
              { action: 'remove', label: 'Remove section', variant: 'primary', value: meta && meta.course_id ? meta.course_id : null },
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
              await recomputeMissingCoreqs();
              renderSelected();
              renderGrid(scheduleIndex);
              try { renderResults(scheduleIndex, lastQuery); } catch (_) {}
            } catch (_) {}
          }
          if (res.action === 'remove' && res.value) {
            const courseId = normalizeCourseId(res.value);
            const bundle = computeBundleClosure(courseId);
            if (bundle && bundle.size > 1) {
              // In the grid, default to bundle removal to avoid orphaned coreqs.
              bundle.forEach(x => { delete selected[x]; });
            } else {
              delete selected[courseId];
            }
            saveSchedulerState(termCode, { selected });
            await recomputeMissingCoreqs();
            renderSelected();
            renderGrid(scheduleIndex);
            try { renderResults(scheduleIndex, lastQuery); } catch (_) {}
          }
        });

        col.appendChild(block);
        blocksByDay[dayKey].push({ start, end, el: block });
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
        const meetings = Array.isArray(sec.meetings) ? sec.meetings : [];
        for (let mi = 0; mi < meetings.length; mi++) {
          const m = meetings[mi] || {};
          const days = parseDaysToKeys(m.days || m.Days || '');
          let start = m.start_min;
          let end = m.end_min;
          if (start == null || end == null) {
            const tr = parseTimeRangeToMinutes(m.time || m.Time || '');
            if (!tr) continue;
            start = tr.start;
            end = tr.end;
          }
          if (!days.length) continue;
          if (start < DAY_START_MIN || end > DAY_END_MIN) continue;
          for (let di = 0; di < days.length; di++) {
            addBlock(days[di], start, end, label, color, {
              course_id: courseId,
              where: m.where || m.Where || '',
              instructors: m.instructors || m.Instructors || '',
            });
          }
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

      try { updateScrollbarCompensation(); } catch (_) {}
    };

    let resultsLimit = 60;
    let lastQuery = '';

    const coursePreviewInstructor = (entry) => {
      try {
        const secs = Array.isArray(entry && entry.sections) ? entry.sections : [];
        const lec = secs.find(s => /lec/i.test(s.component || '')) || secs[0] || null;
        const instr = sectionInstructorPreview(lec);
        return instr;
      } catch (_) {
        return '';
      }
    };

    const renderResults = (scheduleIndex, query) => {
      const qRaw = String(query || '').trim();
      const q = qRaw.toLowerCase();
      lastQuery = q;

      const entryInstructorHay = (entry) => {
        try {
          if (!entry) return '';
          if (typeof entry.__instrHay === 'string') return entry.__instrHay;
          const set = new Set();
          const secs = Array.isArray(entry.sections) ? entry.sections : [];
          for (let i = 0; i < secs.length; i++) {
            const meetings = Array.isArray(secs[i] && secs[i].meetings) ? secs[i].meetings : [];
            for (let j = 0; j < meetings.length; j++) {
              const mj = meetings[j] || {};
              const s = String(mj.instructors || mj.Instructors || mj.instructor || mj.Instructor || '').trim();
              if (s) set.add(s.replace(/\s+/g, ' '));
            }
          }
          const out = Array.from(set).join(' ').toLowerCase();
          entry.__instrHay = out;
          return out;
        } catch (_) {
          return '';
        }
      };

      const getSubjectSet = (idx) => {
        try {
          if (!idx) return new Set();
          if (idx.__subjectSet instanceof Set) return idx.__subjectSet;
          const set = new Set();
          for (const cid of idx.keys()) {
            const m = String(cid || '').match(/^([A-Z]{2,5})\d/);
            if (m && m[1]) set.add(String(m[1]).toUpperCase());
          }
          idx.__subjectSet = set;
          return set;
        } catch (_) {
          return new Set();
        }
      };
      const subjectSet = getSubjectSet(scheduleIndex);

      // Smarter search: detect when the user is typing a course code/subject
      // and avoid matching substrings in titles (e.g., "cs" shouldn't match
      // "statistiCS").
      const queryMode = (() => {
        try {
          const raw = qRaw;
          const code = normalizeCourseId(raw); // upper alnum
          if (!raw || !code) return { mode: 'text', subject: '', codePrefix: '', extra: '' };

          // Try to detect patterns like "CS", "CS 301", "CS301", "CS-301", or
          // "CS 301 intro".
          const m = raw.match(/^\s*([A-Za-z]{2,5})\s*[-]?\s*([0-9]{1,5}[A-Za-z0-9]?)?(.*)$/);
          const subj = m ? String(m[1] || '').toUpperCase() : '';
          const numb = m && m[2] ? String(m[2] || '').toUpperCase() : '';
          const rest = m ? String(m[3] || '').trim().toLowerCase() : '';

          // Only treat "CS" as a subject search if it matches a known subject
          // code in this term; otherwise treat it as a text query so instructor
          // names like "Ali" or "Eken" still work.
          if (subj && !numb && /^[A-Z]{2,5}$/.test(subj) && subjectSet && subjectSet.has(subj)) {
            if (!rest) return { mode: 'subject', subject: subj, codePrefix: subj, extra: '' };
            return { mode: 'subjectText', subject: subj, codePrefix: subj, extra: rest };
          }
          if (subj && numb && /^[A-Z]{2,5}$/.test(subj) && /^[0-9]{1,5}[A-Z0-9]?$/.test(numb) && subjectSet && subjectSet.has(subj)) {
            return { mode: 'code', subject: subj, codePrefix: subj + numb, extra: rest };
          }
          return { mode: 'text', subject: '', codePrefix: '', extra: '' };
        } catch (_) {
          return { mode: 'text', subject: '', codePrefix: '', extra: '' };
        }
      })();

      // Recompute taken courses set for this render pass so filtering and
      // availability highlighting stays accurate as the user edits the plan.
      try { takenAnySet = computeTakenAnySet(); } catch (_) { takenAnySet = null; }
      try { takenBeforeCurrentSet = computeTakenBeforeCurrentTermSet(); } catch (_) { takenBeforeCurrentSet = null; }

      // For availability highlighting, treat "taken" as "completed in previous terms".
      // Courses in the current-term plan should still be schedulable (green/yellow)
      // unless the user has already selected a section for them.
      let takenBeforeSetForHighlight = null;
      try {
        if (shouldHighlightAvailability()) {
          takenBeforeSetForHighlight = computeTakenBeforeCurrentTermSet();
          if (!(takenBeforeSetForHighlight instanceof Set)) takenBeforeSetForHighlight = null;
        }
      } catch (_) {
        takenBeforeSetForHighlight = null;
      }

      // Ensure we have a reverse-coreq index so we can group recitations/labs
      // under their main course cards and avoid listing them separately.
      try {
        if (!reverseCoreqIndex && coursePageInfoMap) {
          reverseCoreqIndex = buildReverseCoreqIndex(scheduleIndex);
        }
      } catch (_) {}

      // Courses that we should keep visible even when "Hide taken courses" is enabled.
      const keepVisible = new Set();
      try {
        plannedCourses.forEach(c => keepVisible.add(normalizeCourseId(c)));
      } catch (_) {}
      try {
        Object.keys(selected).forEach(c => keepVisible.add(normalizeCourseId(c)));
      } catch (_) {}
      try {
        // Also keep coreqs (and potential "main" courses) visible so users
        // can recover from partial selections without having to disable the toggle.
        const keys = Object.keys(selected);
        for (let i = 0; i < keys.length; i++) {
          const c = keys[i];
          getCoreqsFor(c).forEach(x => keepVisible.add(normalizeCourseId(x)));
        }
      } catch (_) {}
      try {
        for (const k of Object.keys(missingByCourse || {})) {
          const arr = missingByCourse[k];
          if (!Array.isArray(arr)) continue;
          arr.forEach(x => keepVisible.add(normalizeCourseId(x)));
        }
      } catch (_) {}
      try {
        for (const k of Object.keys(orphanByCourse || {})) {
          const arr = orphanByCourse[k];
          if (!Array.isArray(arr)) continue;
          arr.forEach(x => keepVisible.add(normalizeCourseId(x)));
        }
      } catch (_) {}

      const typeRank = { free: 0, area: 1, core: 2, university: 3, required: 4 };
      const typeToRank = (t) => {
        try {
          const s = String(t || '').toLowerCase().trim();
          return Object.prototype.hasOwnProperty.call(typeRank, s) ? typeRank[s] : -1;
        } catch (_) {
          return -1;
        }
      };
      const thresholdRank = (value) => {
        try {
          const s = String(value || '').toLowerCase().trim();
          if (!s) return null;
          return Object.prototype.hasOwnProperty.call(typeRank, s) ? typeRank[s] : null;
        } catch (_) {
          return null;
        }
      };

      const minMainRank = thresholdRank(minMainTypeSelect && minMainTypeSelect.value);
      const minDmRank = thresholdRank(minDmTypeSelect && minDmTypeSelect.value);
      const minMinorRank = thresholdRank(minMinorTypeSelect && minMinorTypeSelect.value);
      const minSu = (() => {
        try {
          const v = parseFloat(String(minSuInput && minSuInput.value != null ? minSuInput.value : '').trim());
          return Number.isFinite(v) && v > 0 ? v : null;
        } catch (_) {
          return null;
        }
      })();
      const minEcts = (() => {
        try {
          const v = parseFloat(String(minEctsInput && minEctsInput.value != null ? minEctsInput.value : '').trim());
          return Number.isFinite(v) && v > 0 ? v : null;
        } catch (_) {
          return null;
        }
      })();
      const minBs = (() => {
        try {
          const v = parseFloat(String(minBsInput && minBsInput.value != null ? minBsInput.value : '').trim());
          return Number.isFinite(v) && v > 0 ? v : null;
        } catch (_) {
          return null;
        }
      })();
      const minEng = (() => {
        try {
          const v = parseFloat(String(minEngInput && minEngInput.value != null ? minEngInput.value : '').trim());
          return Number.isFinite(v) && v > 0 ? v : null;
        } catch (_) {
          return null;
        }
      })();

      const hasDm = (() => {
        try {
          const cur = (typeof window !== 'undefined') ? window.curriculum : null;
          const dm = cur ? String(cur.doubleMajor || '') : '';
          return !!(dm && dm !== 'None');
        } catch (_) {
          return false;
        }
      })();
      const hasMinors = (() => {
        try {
          const cur = (typeof window !== 'undefined') ? window.curriculum : null;
          return !!(cur && Array.isArray(cur.minors) && cur.minors.length);
        } catch (_) {
          return false;
        }
      })();

      const checkPrereqs = !!(prereqToggle && prereqToggle.checked);
      const showUnmetPrereqs = checkPrereqs && !!(showUnmetPrereqToggle && showUnmetPrereqToggle.checked);
      const unmetPrereqById = new Map(); // course_id -> { mode, missing }
      const takenBeforeSet = checkPrereqs ? (computeTakenBeforeCurrentTermSet() || new Set()) : null;
      const takenBeforeSig = (() => {
        try {
          if (!checkPrereqs || !takenBeforeSet || !(takenBeforeSet instanceof Set)) return '';
          return Array.from(takenBeforeSet).sort().join('|');
        } catch (_) {
          return '';
        }
      })();
      try {
        if (checkPrereqs && prereqCheckCache.sig !== takenBeforeSig) {
          prereqCheckCache.sig = takenBeforeSig;
          prereqCheckCache.map = new Map();
        }
      } catch (_) {}

      const detailsCache = new Map(); // course_id -> getCourseDetails()
      const getDetailsCached = (courseId) => {
        const cid = normalizeCourseId(courseId);
        if (!cid) return null;
        if (detailsCache.has(cid)) return detailsCache.get(cid);
        const d = getCourseDetails(cid);
        detailsCache.set(cid, d);
        return d;
      };

      const getUnmetPrereqs = (courseId) => {
        try {
          if (!checkPrereqs || !takenBeforeSet || !(takenBeforeSet instanceof Set)) return null;
          if (!coursePageInfoMap) return null;
          const cid = normalizeCourseId(courseId);
          if (!cid) return null;
          try {
            if (prereqCheckCache && prereqCheckCache.map && prereqCheckCache.map.has(cid)) {
              return prereqCheckCache.map.get(cid);
            }
          } catch (_) {}
          const info = coursePageInfoMap.get(cid);
          const text = info && info.prerequisites ? String(info.prerequisites || '') : '';
          if (!text) return null;

          const tokenizePrereq = (s) => {
            const out = [];
            try {
              const re = /([A-Z]{2,5})\s*([0-9]{3}[A-Z0-9]?)|(\()|(\))|\b(and|or)\b/ig;
              let m;
              while ((m = re.exec(String(s || ''))) !== null) {
                if (m[1] && m[2]) {
                  out.push({ t: 'course', v: (m[1] + m[2]).toUpperCase() });
                  continue;
                }
                if (m[3]) { out.push({ t: 'lp' }); continue; }
                if (m[4]) { out.push({ t: 'rp' }); continue; }
                if (m[5]) {
                  const op = String(m[5]).toLowerCase();
                  out.push({ t: 'op', v: op });
                }
              }
            } catch (_) {}
            return out;
          };

          const parsePrereqAst = (s) => {
            const tokens = tokenizePrereq(s);
            if (!tokens.length) return null;

            const prec = { or: 1, and: 2 };
            const output = [];
            const ops = [];
            for (let i = 0; i < tokens.length; i++) {
              const tok = tokens[i];
              if (!tok) continue;
              if (tok.t === 'course') {
                output.push(tok);
                continue;
              }
              if (tok.t === 'lp') { ops.push(tok); continue; }
              if (tok.t === 'rp') {
                while (ops.length && ops[ops.length - 1].t !== 'lp') output.push(ops.pop());
                if (ops.length && ops[ops.length - 1].t === 'lp') ops.pop();
                continue;
              }
              if (tok.t === 'op') {
                while (ops.length) {
                  const top = ops[ops.length - 1];
                  if (!top || top.t !== 'op') break;
                  const pTop = prec[top.v] || 0;
                  const pTok = prec[tok.v] || 0;
                  if (pTop >= pTok) output.push(ops.pop());
                  else break;
                }
                ops.push(tok);
              }
            }
            while (ops.length) {
              const op = ops.pop();
              if (op && op.t === 'op') output.push(op);
            }

            const stack = [];
            const asNode = (x) => x;
            const makeFlat = (type, a, b) => {
              const items = [];
              const add = (n) => {
                if (!n) return;
                if (n.type === type && Array.isArray(n.items)) items.push(...n.items);
                else items.push(n);
              };
              add(a);
              add(b);
              return { type, items };
            };
            for (let i = 0; i < output.length; i++) {
              const tok = output[i];
              if (!tok) continue;
              if (tok.t === 'course') {
                stack.push({ type: 'course', id: tok.v });
                continue;
              }
              if (tok.t === 'op') {
                const b = stack.pop();
                const a = stack.pop();
                if (!a || !b) continue;
                if (tok.v === 'and') stack.push(makeFlat('and', asNode(a), asNode(b)));
                else if (tok.v === 'or') stack.push(makeFlat('or', asNode(a), asNode(b)));
              }
            }
            return stack.length ? stack[stack.length - 1] : null;
          };

          const ast = (() => {
            try {
              if (prereqAstCache.has(cid)) return prereqAstCache.get(cid);
              const a = parsePrereqAst(text);
              prereqAstCache.set(cid, a);
              return a;
            } catch (_) {
              return null;
            }
          })();
          if (!ast) return null;

          const evalExpr = (node) => {
            const normalize = (arr) => Array.from(new Set(arr.filter(Boolean)));
            const reqMissing = new Set();
            const oneOf = [];

            const optionLabel = (n) => {
              try {
                if (!n) return '';
                if (n.type === 'course') return String(n.id || '');
                if (n.type === 'and') {
                  const parts = (Array.isArray(n.items) ? n.items : []).map(optionLabel).filter(Boolean);
                  return parts.length > 1 ? parts.join(' + ') : (parts[0] || '');
                }
                if (n.type === 'or') {
                  const parts = (Array.isArray(n.items) ? n.items : []).map(optionLabel).filter(Boolean);
                  return parts.length > 1 ? `(${parts.join(' / ')})` : (parts[0] || '');
                }
              } catch (_) {}
              return '';
            };

            const helper = (n, context) => {
              if (!n) return true;
              if (n.type === 'course') {
                const id = normalizeCourseId(n.id);
                const ok = !!(id && takenBeforeSet.has(id));
                if (!ok && context === 'and') reqMissing.add(id);
                return ok;
              }
              if (n.type === 'and') {
                const items = Array.isArray(n.items) ? n.items : [];
                let ok = true;
                for (let i = 0; i < items.length; i++) {
                  const childOk = helper(items[i], context);
                  ok = ok && childOk;
                }
                return ok;
              }
              if (n.type === 'or') {
                const items = Array.isArray(n.items) ? n.items : [];
                for (let i = 0; i < items.length; i++) {
                  if (helper(items[i], 'or')) return true;
                }
                // None satisfied -> record this as a "one of" group.
                const opts = items.map(optionLabel).map(s => String(s || '').trim()).filter(Boolean);
                if (opts.length) oneOf.push(opts);
                return false;
              }
              return true;
            };

            const ok = helper(node, 'and');
            return { ok, required: normalize(Array.from(reqMissing)), oneOf };
          };

          const ev = evalExpr(ast);
          const res = (ev && ev.ok) ? null : { mode: 'expr', required: (ev && ev.required) ? ev.required : [], oneOf: (ev && ev.oneOf) ? ev.oneOf : [] };
          try { if (prereqCheckCache && prereqCheckCache.map) prereqCheckCache.map.set(cid, res); } catch (_) {}
          return res;
        } catch (_) {
          return null;
        }
      };

      const itemsById = new Map(); // course_id -> entry
      const addEntry = (entry) => {
        try {
          if (!entry || !entry.course_id) return;
          const id = normalizeCourseId(entry.course_id);
          if (!id) return;
          try {
            if (shouldHideTaken()) {
              if (isTakenCourse(id) && !keepVisible.has(id)) return;
            }
          } catch (_) {}
          if (!itemsById.has(id)) itemsById.set(id, entry);
        } catch (_) {}
      };

      for (const entry of scheduleIndex.values()) {
        const id = entry.course_id;
        const title = entry.title || '';

        if (q) {
          const cid = normalizeCourseId(id);
          if (queryMode.mode === 'subject') {
            if (!cid || !cid.startsWith(queryMode.codePrefix)) continue;
          } else if (queryMode.mode === 'subjectText') {
            if (!cid || !cid.startsWith(queryMode.codePrefix)) continue;
            if (queryMode.extra) {
              const t = String(title || '').toLowerCase();
              const ih = entryInstructorHay(entry);
              if (!t.includes(queryMode.extra) && !ih.includes(queryMode.extra)) continue;
            }
          } else if (queryMode.mode === 'code') {
            if (!cid || !cid.startsWith(queryMode.codePrefix)) continue;
            if (queryMode.extra) {
              const t = String(title || '').toLowerCase();
              const ih = entryInstructorHay(entry);
              if (!t.includes(queryMode.extra) && !ih.includes(queryMode.extra)) continue;
            }
          } else {
            const hay = (id + ' ' + title + ' ' + entryInstructorHay(entry)).toLowerCase();
            if (!hay.includes(q)) continue;
          }
        }

        // Reduce clutter: never list corequisite-only courses as their own
        // cards. Instead, if the user searches for them, show their parent
        // course card(s) so they can pick/change the linked section there.
        try {
          const cid = normalizeCourseId(id);
          const parents = reverseCoreqIndex ? reverseCoreqIndex.get(cid) : null;
          const isCoreqOnly = !!(parents && parents.size);
          if (isCoreqOnly) {
            if (q) {
              const ps = Array.from(parents);
              for (let pi = 0; pi < ps.length; pi++) {
                const parentId = ps[pi];
                const pe = scheduleIndex.get(parentId);
                if (pe) addEntry(pe);
              }
            }
            continue;
          }
        } catch (_) {}

        try {
          if (shouldHideTaken()) {
            const cid = normalizeCourseId(id);
            if (isTakenCourse(cid) && !keepVisible.has(cid)) continue;
          }
        } catch (_) {}

        // If the user has blocked hours, only show courses that have at least one
        // section-combination that avoids those hours. Keep important items visible.
        try {
          if (Array.isArray(blocked) && blocked.length) {
            const cid = normalizeCourseId(id);
            if (cid && !keepVisible.has(cid)) {
              const ok = canFitWithBlockedHours(scheduleIndex, cid);
              if (!ok && !shouldShowBlockedCourses()) continue;
            }
          }
        } catch (_) {}

        // Minimum course-type filters (major / DM / minors).
        try {
          const cid = normalizeCourseId(id);
          if (cid) {
            if (minSu != null || minEcts != null || minBs != null || minEng != null) {
              const d = getDetailsCached(cid);
              if (d) {
                if (minSu != null && (Number(d.su) || 0) < minSu) continue;
                if (minEcts != null && (Number(d.ects) || 0) < minEcts) continue;
                if (minBs != null && (Number(d.bs) || 0) < minBs) continue;
                if (minEng != null && (Number(d.eng) || 0) < minEng) continue;
              } else {
                continue;
              }
            }
            if (minMainRank != null) {
              const d = getDetailsCached(cid);
              if (!d || typeToRank(d.mainType) < minMainRank) continue;
            }
            if (hasDm && minDmRank != null) {
              const d = getDetailsCached(cid);
              if (!d || typeToRank(d.dmType) < minDmRank) continue;
            }
            if (hasMinors && minMinorRank != null) {
              const d = getDetailsCached(cid);
              let best = -1;
              if (d && Array.isArray(d.minorTypes)) {
                for (let mi = 0; mi < d.minorTypes.length; mi++) {
                  const mt = d.minorTypes[mi];
                  if (!mt || !mt.type) continue;
                  best = Math.max(best, typeToRank(mt.type));
                }
              }
              if (best < minMinorRank) continue;
            }
          }
        } catch (_) {}

        // Prerequisite checking: only consider courses taken in previous terms.
        try {
          if (checkPrereqs) {
            const cid = normalizeCourseId(id);
            if (cid) {
              const unmet = getUnmetPrereqs(cid);
              const hasUnmet = (() => {
                try {
                  if (!unmet) return false;
                  if (unmet.mode === 'expr') {
                    const req = Array.isArray(unmet.required) ? unmet.required.length : 0;
                    const groups = Array.isArray(unmet.oneOf) ? unmet.oneOf.length : 0;
                    return req > 0 || groups > 0;
                  }
                  return Array.isArray(unmet.missing) && unmet.missing.length > 0;
                } catch (_) {
                  return false;
                }
              })();
              if (hasUnmet) {
                unmetPrereqById.set(cid, unmet);
                if (!showUnmetPrereqs && !keepVisible.has(cid)) continue;
              }
            }
          }
        } catch (_) {}
        addEntry(entry);
      }
      const items = Array.from(itemsById.values());
      try {
        if (shouldSortByScore()) {
          for (let i = 0; i < items.length; i++) {
            const it = items[i];
            if (!it) continue;
            if (typeof it.__score !== 'number') it.__score = computeScore(it.course_id);
          }
          items.sort((a, b) => {
            const as = (a && typeof a.__score === 'number') ? a.__score : 0;
            const bs = (b && typeof b.__score === 'number') ? b.__score : 0;
            if (bs !== as) return bs - as;
            return (a.course_id || '').localeCompare(b.course_id || '');
          });
        } else {
          items.sort((a, b) => (a.course_id || '').localeCompare(b.course_id || ''));
        }
      } catch (_) {
        items.sort((a, b) => (a.course_id || '').localeCompare(b.course_id || ''));
      }
      const limited = items.slice(0, resultsLimit);
      const occForAvailability = (() => {
        try {
          if (!shouldHighlightAvailability()) return null;
          return getOccupiedByDayFromSelected(scheduleIndex, { includeBlocked: true });
        } catch (_) {
          return null;
        }
      })();

      resultsEl.innerHTML = limited.length
        ? limited.map(e => {
          const already = !!selected[e.course_id];
          const miss = Array.isArray(missingByCourse[e.course_id]) ? missingByCourse[e.course_id] : [];
          const instr = coursePreviewInstructor(e);
          const pick = selected[e.course_id];
          const url = pick && pick.crn ? buildDetailUrl(pick.crn) : '';
          const showDetails = shouldShowDetails();
          const d = showDetails ? getCourseDetails(e.course_id) : null;
          const unmetPrereq = (() => {
            try {
              const cid = normalizeCourseId(e.course_id);
              return cid ? unmetPrereqById.get(cid) : null;
            } catch (_) {
              return null;
            }
          })();
          const unmetRequired = (unmetPrereq && unmetPrereq.mode === 'expr' && Array.isArray(unmetPrereq.required)) ? unmetPrereq.required.slice() : [];
          const unmetOneOf = (unmetPrereq && unmetPrereq.mode === 'expr' && Array.isArray(unmetPrereq.oneOf)) ? unmetPrereq.oneOf.slice() : [];
          const unmetList = (unmetPrereq && Array.isArray(unmetPrereq.missing)) ? unmetPrereq.missing.slice() : [];
          const hasUnmetPrereq = !!(
            (unmetPrereq && unmetPrereq.mode === 'expr' && (unmetRequired.length || unmetOneOf.length)) ||
            (unmetList && unmetList.length)
          );
          const typeParts = [];
          try {
            if (d && d.mainType) typeParts.push(`Major: ${String(d.mainType).toUpperCase()}`);
            if (d && d.dmType) typeParts.push(`DM: ${String(d.dmType).toUpperCase()}`);
            if (d && Array.isArray(d.minorTypes) && d.minorTypes.length) {
              d.minorTypes.slice(0, 2).forEach(mt => {
                if (!mt || !mt.type) return;
                typeParts.push(`Minor: ${String(mt.type).toUpperCase()}`);
              });
            }
          } catch (_) {}

          const coreqs = (() => {
            try {
              return getCoreqsFor(e.course_id)
                .map(c => normalizeCourseId(c))
                .filter(Boolean)
                .filter(c => scheduleIndex.get(c));
            } catch (_) {
              return [];
            }
          })();

          const coreqHtml = coreqs.length
            ? (
              `<div class="scheduler-course-coreqs">` +
              `<div class="scheduler-course-coreqs-title">Linked recitation/lab</div>` +
              coreqs.map((cid) => {
                const sel = selected[cid];
                const sec = sel ? getSelectedSection(cid) : null;
                const comp = sec && sec.component ? String(sec.component) : '';
                const secLabel = sel && sec && sec.section ? `-${sec.section}` : '';
                const meta = sel ? `${cid}${secLabel}${comp ? ` • ${escapeHtml(comp)}` : ''}` : cid;
                const missing = (Array.isArray(missingByCourse[e.course_id]) ? missingByCourse[e.course_id] : []).includes(cid);
                const btnText = sel ? 'Change' : 'Pick';
                return (
                  `<div class="scheduler-coreq-row${missing ? ' is-missing' : ''}">` +
                  `<div class="scheduler-coreq-label">${missing ? '<span class="scheduler-coreq-badge">Required</span>' : ''}${escapeHtml(meta)}</div>` +
                  `<div class="scheduler-coreq-actions">` +
                  `<button class="btn btn-secondary btn-sm scheduler-details" type="button" data-course="${escapeHtml(cid)}">Details</button>` +
                  `<button class="btn btn-secondary btn-sm scheduler-pick" type="button" data-course="${escapeHtml(cid)}">${btnText}</button>` +
                  `</div>` +
                  `</div>`
                );
              }).join('') +
              `</div>`
            )
            : '';
          return (
            (() => {
              const classes = ['scheduler-course'];
              if (miss.length) classes.push('is-missing-coreq');
              if (hasUnmetPrereq) classes.push('is-unmet-prereq');
              try {
                if (shouldHighlightAvailability()) {
                  const cid = normalizeCourseId(e.course_id);
                  const isCompleted = !!(cid && takenBeforeSetForHighlight instanceof Set && takenBeforeSetForHighlight.has(cid));
                  if (isCompleted) {
                    classes.push('is-taken');
                  } else if (!already) {
                    const bundle = getRequiredBundleCourseIds(scheduleIndex, e.course_id);
                    const best = pickBestBundleSections(scheduleIndex, bundle, occForAvailability || {});
                    if (best && typeof best.conflicts === 'number') {
                      if (best.conflicts === 0) classes.push('is-available');
                      else classes.push('is-available-conflict');
                    }
                  }
                }
              } catch (_) {}
              try {
                if (Array.isArray(blocked) && blocked.length && shouldShowBlockedCourses()) {
                  const cid = normalizeCourseId(e.course_id);
                  if (cid && !keepVisible.has(cid)) {
                    if (!canFitWithBlockedHours(scheduleIndex, cid)) classes.push('is-blocked-hours');
                  }
                }
              } catch (_) {}
              const prereqHtml = (() => {
                try {
                  if (!hasUnmetPrereq) return '';
                  const lines = [];
                  if (unmetPrereq && unmetPrereq.mode === 'expr') {
                    if (unmetRequired.length) {
                      const missing = unmetRequired.slice(0, 6).join(', ') + (unmetRequired.length > 6 ? '…' : '');
                      lines.push(`<div class="scheduler-course-meta"><span class="scheduler-badge-prereq">Prereq</span> Missing: ${escapeHtml(missing)}</div>`);
                    }
                    (unmetOneOf || []).slice(0, 2).forEach((opts) => {
                      const arr = Array.isArray(opts) ? opts : [];
                      const text = arr.slice(0, 6).join(' / ') + (arr.length > 6 ? ' / …' : '');
                      if (text) lines.push(`<div class="scheduler-course-meta"><span class="scheduler-badge-prereq">Prereq</span> Needs one of: ${escapeHtml(text)}</div>`);
                    });
                    return lines.join('');
                  }

                  const mode = unmetPrereq && unmetPrereq.mode ? String(unmetPrereq.mode) : 'and';
                  const label = mode === 'or' ? 'Needs one of:' : 'Missing:';
                  const missing = unmetList.slice(0, 6).join(', ') + (unmetList.length > 6 ? '…' : '');
                  return `<div class="scheduler-course-meta"><span class="scheduler-badge-prereq">Prereq</span> ${escapeHtml(label)} ${escapeHtml(missing)}</div>`;
                } catch (_) {
                  return '';
                }
              })();
              return (
                `<div class="${classes.join(' ')}" data-course="${escapeHtml(e.course_id)}">` +
            `<div class="scheduler-course-head">` +
            `<div class="scheduler-course-id">${escapeHtml(e.course_id)}</div>` +
            `<div class="scheduler-course-title">${escapeHtml(e.title || '')}</div>` +
            `</div>` +
            prereqHtml +
            (classes.includes('is-blocked-hours') ? `<div class="scheduler-course-meta"><span class="scheduler-badge-blocked">Blocked hours</span> No section combination fits your blocked time.</div>` : '') +
            (instr ? `<div class="scheduler-course-meta"><span class="muted">Instructor:</span> ${escapeHtml(instr)}</div>` : '') +
            (showDetails && d
              ? (
                (() => {
                  const parts = [];
                  parts.push(`<span class="muted">Credits:</span> ${escapeHtml(fmtCredit(d.su))} SU`);
                  if ((d.bs || 0) > 0) parts.push(`<span class="scheduler-meta-bs">BS</span>: ${escapeHtml(fmtCredit(d.bs))}`);
                  if ((d.eng || 0) > 0) parts.push(`<span class="scheduler-meta-eng">ENG</span>: ${escapeHtml(fmtCredit(d.eng))}`);
                  if (typeParts.length) parts.push(`<span class="muted">Type:</span> ${escapeHtml(typeParts.join(' / '))}`);
                  return `<div class="scheduler-course-meta">${parts.join(' • ')}</div>`;
                })()
              )
              : '') +
            `<div class="scheduler-course-actions">` +
            `<button class="btn btn-secondary btn-sm scheduler-details" type="button" data-course="${escapeHtml(e.course_id)}">Details</button>` +
            `<button class="btn btn-secondary btn-sm scheduler-pick" type="button" data-course="${escapeHtml(e.course_id)}">${already ? 'Change section' : 'Pick section'}</button>` +
            `</div>` +
            coreqHtml +
            `</div>`
              );
            })()
          );
        }).join('')
        : '<div class="scheduler-muted">No courses match your search.</div>';

      try {
        if (loadMoreBtn) {
          const more = items.length > resultsLimit;
          loadMoreBtn.style.display = more ? 'inline-flex' : 'none';
          if (more) loadMoreBtn.textContent = `Load more (${Math.min(resultsLimit + 60, items.length)}/${items.length})`;
        }
      } catch (_) {}

      // If we rebuilt the results list while hovering, clear stale hover state
      // to avoid "stuck" previews.
      try {
        if (hoverResultCourseId) {
          const cards = resultsEl.querySelectorAll('.scheduler-course[data-course]');
          let found = false;
          cards.forEach((c) => {
            if (found) return;
            const cid = normalizeCourseId(c.getAttribute('data-course') || '');
            if (cid && cid === normalizeCourseId(hoverResultCourseId)) found = true;
          });
          if (!found) {
            hoverResultCourseId = '';
            clearPreviewBlocks();
            clearHoverHighlights();
          }
        }
      } catch (_) {}
    };

    const recomputeMissingCoreqs = async () => {
      missingByCourse = {};
      orphanByCourse = {};
      try {
        const loadInfo = (typeof window !== 'undefined') ? window.loadCoursePageInfoIndex : null;
        if (!coursePageInfoMap && typeof loadInfo === 'function') {
          coursePageInfoMap = await loadInfo();
        }
        if (!coursePageInfoMap || !scheduleIndex) return;
        if (!reverseCoreqIndex) {
          reverseCoreqIndex = buildReverseCoreqIndex(scheduleIndex);
        }

        const selectedKeys = Object.keys(selected);
        for (let i = 0; i < selectedKeys.length; i++) {
          const courseId = selectedKeys[i];
          const info = coursePageInfoMap.get(courseId);
          if (!info || !info.corequisites) continue;
          const coreqs = extractCoreqCourseIdsFromCoursePageInfoField(info.corequisites);
          if (!coreqs.length) continue;
          const missing = coreqs
            .map(c => normalizeCourseId(c))
            .filter(c => c && scheduleIndex.get(c))
            .filter(c => !selected[c]);
          if (missing.length) {
            missingByCourse[courseId] = Array.from(new Set(missing));
          }
        }

        // Orphan detection: if a selected course is a known coreq for another course
        // but none of those "main" courses are selected, warn and allow quick-fix.
        try {
          if (reverseCoreqIndex && reverseCoreqIndex.size) {
            const selectedSet = new Set(selectedKeys.map(c => normalizeCourseId(c)));
            selectedKeys.forEach((cidRaw) => {
              const cid = normalizeCourseId(cidRaw);
              const parents = reverseCoreqIndex.get(cid);
              if (!parents || !parents.size) return;
              const missingParents = Array.from(parents).filter(p => !selectedSet.has(p));
              if (missingParents.length) orphanByCourse[cid] = missingParents.slice(0, 4);
            });
          }
        } catch (_) {}
      } catch (_) {}
    };

    const ensureCoreqsSelected = async (scheduleIndex, baseCourseId) => {
      try {
        const loadInfo = (typeof window !== 'undefined') ? window.loadCoursePageInfoIndex : null;
        if (typeof loadInfo !== 'function') return;
        const map = await loadInfo();
        coursePageInfoMap = map;
        const info = map && typeof map.get === 'function' ? map.get(baseCourseId) : null;
        if (!info) return;
        const coreqs = extractCoreqCourseIdsFromCoursePageInfoField(info.corequisites);
        for (let i = 0; i < coreqs.length; i++) {
          const cid = normalizeCourseId(coreqs[i]);
          if (!cid) continue;
          if (selected[cid]) continue;
          const entry = scheduleIndex.get(cid);
          if (!entry || !entry.sections || !entry.sections.length) continue;
          const res = await createPickerModal({
            title: `Select corequisite for ${baseCourseId}`,
            bodyHtml: `<p><strong>${escapeHtml(baseCourseId)}</strong> requires <strong>${escapeHtml(cid)}</strong>.</p><p>Select a section to add:</p>`,
            listItems: entry.sections.slice(0, 80).map(sec => {
              const meetingSummary = sectionMeetingPreview(sec, 3);
              const instr = sectionInstructorPreview(sec);
              const sub = [meetingSummary, instr ? `Instructor: ${instr}` : ''].filter(Boolean).join(' — ');
              const label = `${cid}${sec.section ? `-${sec.section}` : ''}${sec.component ? ` • ${sec.component}` : ''}${sec.crn ? ` (CRN ${sec.crn})` : ''}`;
              return { action: 'pick', label, subLabel: sub, value: { course_id: cid, crn: sec.crn } };
            }),
            buttons: [{ action: 'cancel', label: 'Skip', variant: 'secondary' }],
          });
          if (res.action === 'pick' && res.value) {
            selected[cid] = { course_id: cid, crn: String(res.value.crn || '') };
            saveSchedulerState(termCode, { selected });
            await recomputeMissingCoreqs();
            renderSelected();
            renderGrid(scheduleIndex);
            try { renderResults(scheduleIndex, lastQuery); } catch (_) {}
          }
        }
      } catch (_) {}
    };

    const pickSectionForCourse = async (scheduleIndex, courseId) => {
      const entry = scheduleIndex.get(courseId);
      if (!entry || !entry.sections || !entry.sections.length) return;

      // Prefer Lecture sections first if present
      const sections = entry.sections.slice();
      sections.sort((a, b) => {
        const aL = /lec/i.test(a.component || '') ? 0 : 1;
        const bL = /lec/i.test(b.component || '') ? 0 : 1;
        if (aL !== bL) return aL - bL;
        return (a.section || '').localeCompare(b.section || '');
      });

      const res = await createPickerModal({
        title: `Pick a section — ${courseId}`,
        bodyHtml: `<p>${escapeHtml(entry.title || '')}</p>`,
        listItems: sections.slice(0, 120).map(sec => {
          const meetingSummary = sectionMeetingPreview(sec, 3);
          const instr = sectionInstructorPreview(sec);
          const sub = [meetingSummary, instr ? `Instructor: ${instr}` : ''].filter(Boolean).join(' — ');
          const label = `${courseId}${sec.section ? `-${sec.section}` : ''}${sec.component ? ` • ${sec.component}` : ''}${sec.crn ? ` (CRN ${sec.crn})` : ''}`;
          return { action: 'pick', label, subLabel: sub, value: { course_id: courseId, crn: sec.crn } };
        }),
        buttons: [{ action: 'cancel', label: 'Cancel', variant: 'secondary' }],
      });
      if (res.action !== 'pick' || !res.value) return;

      selected[courseId] = { course_id: courseId, crn: String(res.value.crn || '') };
      saveSchedulerState(termCode, { selected });
      await ensureCoreqsSelected(scheduleIndex, courseId);
      await recomputeMissingCoreqs();
      renderSelected();
      renderGrid(scheduleIndex);
      try { renderResults(scheduleIndex, lastQuery); } catch (_) {}
    };

    clearBtn.addEventListener('click', () => {
      for (const k of Object.keys(selected)) delete selected[k];
      saveSchedulerState(termCode, { selected });
      missingByCourse = {};
      renderSelected();
      clearGridBlocks();
      resultsEl.innerHTML = '<div class="scheduler-muted">Cleared. Search to add courses.</div>';
    });

    const findOrCreateCurrentTermSemester = () => {
      const cur = (typeof window !== 'undefined') ? window.curriculum : null;
      if (!cur) return null;
      const ct = getCurrentTermNameSafe();
      if (!ct) return null;
      const containers = document.querySelectorAll('.container_semester');
      for (let i = 0; i < containers.length; i++) {
        const c = containers[i];
        const p = c.querySelector('.date p');
        const name = p ? String(p.textContent || '').trim() : '';
        if (name !== ct) continue;
        const semEl = c.querySelector('.semester');
        if (!semEl) continue;
        const semObj = cur.getSemester(semEl.id);
        return { container: c, semesterEl: semEl, semesterObj: semObj };
      }
      // Create a semester for the current term if missing.
      try {
        if (typeof createSemeter === 'function') {
          const board = document.querySelector('.board');
          const ghost = board ? board.querySelector('.add-semester-ghost') : null;
          const created = createSemeter(true, [], cur, course_data, [], ct);
          if (created && board && ghost) {
            // Keep the "+ New Semester" ghost at the end like the normal flow.
            board.insertBefore(created, ghost);
          }
          if (created) {
            const semEl = created.querySelector('.semester');
            const semObj = semEl ? cur.getSemester(semEl.id) : null;
            return { container: created, semesterEl: semEl, semesterObj: semObj };
          }
        }
      } catch (_) {}
      // Retry lookup after creation attempt.
      try {
        const containers2 = document.querySelectorAll('.container_semester');
        for (let i = 0; i < containers2.length; i++) {
          const c = containers2[i];
          const p = c.querySelector('.date p');
          const name = p ? String(p.textContent || '').trim() : '';
          if (name !== ct) continue;
          const semEl = c.querySelector('.semester');
          if (!semEl) continue;
          const semObj = cur.getSemester(semEl.id);
          return { container: c, semesterEl: semEl, semesterObj: semObj };
        }
      } catch (_) {}
      return null;
    };

    const refreshPlannerTotalsForContainer = (container, semesterObj) => {
      try {
        const span = container ? container.querySelector('.total_credit_text span') : null;
        if (!span) return;
        const tc = semesterObj ? (semesterObj.totalCredit || 0) : 0;
        const totalText = (typeof window !== 'undefined' && typeof window.formatCreditValue === 'function')
          ? window.formatCreditValue(tc)
          : (Number(tc).toFixed(1));
        span.innerHTML = 'Total: ' + totalText + ' credits';
        try { span.classList.toggle('is-overlimit', tc > 20); } catch (_) {}
      } catch (_) {}
    };

    const removeCourseFromOtherSemesters = (courseCode, keepSemesterId) => {
      try {
        const cur = (typeof window !== 'undefined') ? window.curriculum : null;
        if (!cur || !Array.isArray(cur.semesters)) return;
        const target = normalizePlannerCode(courseCode);
        for (let i = 0; i < cur.semesters.length; i++) {
          const sem = cur.semesters[i];
          if (!sem || sem.id === keepSemesterId) continue;
          if (!Array.isArray(sem.courses)) continue;
          for (let j = sem.courses.length - 1; j >= 0; j--) {
            const c = sem.courses[j];
            if (!c) continue;
            if (normalizePlannerCode(c.code) !== target) continue;
            try {
              const el = document.getElementById(c.id);
              if (el) el.remove();
            } catch (_) {}
            try { sem.deleteCourse(c.id); } catch (_) {}
          }
        }
      } catch (_) {}
    };

    const createPlannerCourseDom = (courseCode, courseId, info) => {
      const domCourse = document.createElement('div');
      domCourse.classList.add('course');
      domCourse.id = courseId;

      const cContainer = document.createElement('div');
      cContainer.classList.add('course_container');

      const cLabel = document.createElement('div');
      cLabel.classList.add('course_label');
      cLabel.innerHTML =
        '<div class="course_code">' + escapeHtml(courseCode) + '</div>' +
        '<div class="course_actions">' +
        '<button class="details_course" type="button" title="Details" aria-label="Course details">' +
        '<i class="fa-solid fa-circle-info"></i>' +
        '</button>' +
        '<button class="delete_course" type="button" title="Delete" aria-label="Delete course"></button>' +
        '</div>';

      const cInfo = document.createElement('div');
      cInfo.classList.add('course_info');
      const name = info ? (info.Course_Name || info.course_name || info.title || '') : '';
      const elType = info ? (info.EL_Type || '') : '';
      const su = info ? (info.SU_credit || info.su_credits || 0) : 0;
      const bs = info ? (info.Basic_Science || info.basic_science || 0) : 0;
      cInfo.innerHTML = '<div class="course_name">' + escapeHtml(name || '') + '</div>';
      cInfo.innerHTML += '<div class="course_type">' + escapeHtml(String(elType || 'N/A').toUpperCase()) + '</div>';
      cInfo.innerHTML += '<div class="course_credit">' + escapeHtml(fmtCredit(su)) + ' credits </div>';

      const bsDiv = document.createElement('div');
      bsDiv.classList.add('course_bs_credit');
      bsDiv.textContent = 'BS: ' + String(bs || 0) + ' credits';
      try {
        if (typeof window !== 'undefined' && window.showCourseDetails === false) bsDiv.style.display = 'none';
      } catch (_) {}
      cInfo.appendChild(bsDiv);

      const grade = document.createElement('div');
      grade.classList.add('grade');
      grade.textContent = 'Add grade';

      cContainer.appendChild(cLabel);
      cContainer.appendChild(cInfo);
      cContainer.appendChild(grade);
      domCourse.appendChild(cContainer);
      return domCourse;
    };

    pickPlanBtn.addEventListener('click', async () => {
      try {
        const keys = Object.keys(selected);
        if (!keys.length) {
          if (ui && typeof ui.alert === 'function') ui.alert('Nothing selected', '<p>Select at least one section first.</p>');
          return;
        }
        const ok = (ui && typeof ui.confirm === 'function')
          ? await ui.confirm(
              'Update current-term plan',
              '<p>This will <strong>replace</strong> the courses in your current-term plan with the scheduler’s selected sections.</p>',
              { confirmText: 'Replace', danger: true }
            )
          : true;
        if (!ok) return;

        const loc = findOrCreateCurrentTermSemester();
        if (!loc || !loc.container || !loc.semesterEl || !loc.semesterObj) {
          if (ui && typeof ui.alert === 'function') ui.alert('Update failed', '<p>Could not find (or create) the current-term semester in your plan.</p>');
          return;
        }

        // Avoid duplicates across semesters: move any matching courses into the current term.
        for (let i = 0; i < keys.length; i++) {
          removeCourseFromOtherSemesters(keys[i], loc.semesterObj.id);
        }

        // Clear current term semester DOM + any open add-course inputs.
        try { loc.semesterEl.querySelectorAll('.course').forEach(el => el.remove()); } catch (_) {}
        try { loc.container.querySelectorAll('.input_container').forEach(el => el.remove()); } catch (_) {}

        // Clear current term semester model.
        try {
          loc.semesterObj.courses = [];
          loc.semesterObj.totalCredit = 0;
          loc.semesterObj.totalArea = 0;
          loc.semesterObj.totalCore = 0;
          loc.semesterObj.totalFree = 0;
          loc.semesterObj.totalUniversity = 0;
          loc.semesterObj.totalRequired = 0;
          loc.semesterObj.totalScience = 0.0;
          loc.semesterObj.totalEngineering = 0.0;
          loc.semesterObj.totalECTS = 0.0;
          loc.semesterObj.totalGPA = 0.0;
          loc.semesterObj.totalGPACredits = 0.0;
        } catch (_) {}
        refreshPlannerTotalsForContainer(loc.container, loc.semesterObj);

        // Ensure schedule index is loaded for possible title/credits fallbacks.
        const idx = scheduleIndex || await loadTermScheduleIndex(termCode);
        if (idx) scheduleIndex = idx;

        const cur = (typeof window !== 'undefined') ? window.curriculum : null;
        for (let i = 0; i < keys.length; i++) {
          const raw = keys[i];
          const code = normalizePlannerCode(raw);
          if (!code) continue;

          // Do NOT add lab/recitation sections to the term plan; only add the course itself.
          // Scheduler still tracks labs/recitations, but the planner semester should stay clean.
          try {
            const sec = getSelectedSection(raw);
            const comp = String(sec && sec.component ? sec.component : '').toLowerCase();
            if (comp && (comp.includes('rec') || comp.includes('lab'))) {
              continue;
            }
          } catch (_) {}

          try {
            if (cur && typeof cur.hasCourse === 'function' && cur.hasCourse(code)) continue;
          } catch (_) {}

          try { cur.course_id = (cur.course_id || 0) + 1; } catch (_) {}
          const newId = 'c' + (cur ? cur.course_id : Date.now());
          const myCourse = new s_course(code, newId);

          // Keep CRN around for future integrations.
          try {
            const pick = selected[raw];
            if (pick && pick.crn) myCourse.scheduler_crn = String(pick.crn);
          } catch (_) {}

          // Prefer planner catalog info; fall back to course-page index.
          let info = null;
          try { info = getPlannerInfo(code); } catch (_) {}
          if (!info && coursePageInfoMap && typeof coursePageInfoMap.get === 'function') {
            const pi = coursePageInfoMap.get(code);
            if (pi) {
              info = {
                Course_Name: pi.title || pi.header_text || '',
                EL_Type: '',
                SU_credit: (pi.su_credits != null) ? pi.su_credits : 0,
                Basic_Science: (pi.basic_science != null) ? pi.basic_science : 0,
                Engineering: (pi.engineering != null) ? pi.engineering : 0,
                ECTS: (pi.ects != null) ? pi.ects : 0,
              };
            }
          }

          try { loc.semesterObj.addCourse(myCourse); } catch (_) {
            try { loc.semesterObj.courses.push(myCourse); } catch (_) {}
          }

          const domCourse = createPlannerCourseDom(code, newId, info);
          loc.semesterEl.appendChild(domCourse);
        }

        // Recompute effective categories and totals and refresh "current term" highlights.
        try {
          if (cur && typeof cur.recalcEffectiveTypes === 'function') cur.recalcEffectiveTypes(course_data);
          if (cur && cur.doubleMajor && typeof cur.recalcEffectiveTypesDouble === 'function') {
            cur.recalcEffectiveTypesDouble(cur.doubleMajorCourseData);
          }
          if (typeof window !== 'undefined' && typeof window.updateCurrentTermHighlights === 'function') {
            window.updateCurrentTermHighlights();
          }
        } catch (_) {}

        refreshPlannerTotalsForContainer(loc.container, loc.semesterObj);

        // Refresh scheduler "Current Term Plan" pills.
        try {
          const nextCourses = (loc.semesterObj && Array.isArray(loc.semesterObj.courses))
            ? loc.semesterObj.courses.map(x => normalizePlannerCode(x && x.code)).filter(Boolean)
            : [];
          plannedCourses.splice(0, plannedCourses.length, ...nextCourses);
          planListEl.innerHTML = plannedCourses.length
            ? plannedCourses.map(c => (
                `<button type="button" class="scheduler-pill scheduler-plan-pick" data-course="${escapeHtml(c)}" title="Pick a section">${escapeHtml(c)}</button>`
              )).join('')
            : '<div class="scheduler-muted">No courses in your current-term plan yet.</div>';
        } catch (_) {}

        // Re-render results/grid (hide-taken & sorting can depend on plan state).
        try {
          if (scheduleIndex) renderResults(scheduleIndex, lastQuery);
          if (scheduleIndex) renderGrid(scheduleIndex);
        } catch (_) {}
      } catch (_) {}
    });

    selectedEl.addEventListener('click', async (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('.scheduler-remove') : null;
      const pick = e.target && e.target.closest ? e.target.closest('.scheduler-pick') : null;
      const fix = e.target && e.target.closest ? e.target.closest('.scheduler-fix-coreq') : null;
      const details = e.target && e.target.closest ? e.target.closest('.scheduler-details') : null;
      if (details) {
        const courseId = normalizeCourseId(details.getAttribute('data-course') || '');
        if (courseId) await openCourseDetailsModal(courseId);
        return;
      }
      if (pick) {
        try {
          const courseId = normalizeCourseId(pick.getAttribute('data-course') || '');
          if (!courseId) return;
          const idx = scheduleIndex || await loadTermScheduleIndex(termCode);
          if (!idx) return;
          scheduleIndex = idx;
          await pickSectionForCourse(idx, courseId);
          await recomputeMissingCoreqs();
          renderSelected();
          renderGrid(idx);
          renderResults(idx, lastQuery);
        } catch (_) {}
        return;
      }
      if (fix) {
        try {
          const courseId = normalizeCourseId(fix.getAttribute('data-course') || '');
          if (!courseId) return;
          const idx = scheduleIndex || await loadTermScheduleIndex(termCode);
          if (!idx) return;
          scheduleIndex = idx;
          const miss = Array.isArray(missingByCourse[courseId]) ? missingByCourse[courseId] : [];
          const orphan = Array.isArray(orphanByCourse[courseId]) ? orphanByCourse[courseId] : [];
          if (miss.length) {
            if (miss.length === 1) {
              await pickSectionForCourse(idx, miss[0]);
              return;
            }
            const res = await createPickerModal({
              title: `Fix corequisite for ${courseId}`,
              bodyHtml: `<p>Select a missing corequisite to add:</p>`,
              listItems: miss.slice(0, 10).map(c => ({ action: 'pick', label: c, value: { course_id: c } })),
              buttons: [{ action: 'cancel', label: 'Cancel', variant: 'secondary' }],
            });
            if (res.action === 'pick' && res.value && res.value.course_id) {
              await pickSectionForCourse(idx, res.value.course_id);
            }
            return;
          }
          if (orphan.length) {
            const parents = orphan.filter(p => idx.get(p));
            if (parents.length === 1) {
              await pickSectionForCourse(idx, parents[0]);
              return;
            }
            const res = await createPickerModal({
              title: `Add main course for ${courseId}`,
              bodyHtml: `<p><strong>${courseId}</strong> looks like a corequisite. Select the main course to add:</p>`,
              listItems: parents.slice(0, 10).map(c => ({ action: 'pick', label: c, value: { course_id: c } })),
              buttons: [{ action: 'cancel', label: 'Cancel', variant: 'secondary' }],
            });
            if (res.action === 'pick' && res.value && res.value.course_id) {
              await pickSectionForCourse(idx, res.value.course_id);
            }
          }
        } catch (_) {}
        return;
      }
      if (btn) {
        const c = btn.getAttribute('data-course') || '';
        if (!c) return;
        const courseId = normalizeCourseId(c);
        const bundle = computeBundleClosure(courseId);
        if (bundle && bundle.size > 1) {
          const res = await createPickerModal({
            title: 'Remove sections',
            bodyHtml:
              `<p><strong>${escapeHtml(courseId)}</strong> is linked with corequisites.</p>` +
              `<p>What would you like to remove?</p>`,
            buttons: [
              { action: 'bundle', label: `Remove ${bundle.size} linked sections`, variant: 'primary', value: 'bundle' },
              { action: 'single', label: 'Remove only this section', variant: 'secondary', value: 'single' },
              { action: 'cancel', label: 'Cancel', variant: 'secondary' },
            ],
          });
          if (res.action === 'cancel') return;
          if (res.action === 'bundle') {
            bundle.forEach(x => { delete selected[x]; });
          } else if (res.action === 'single') {
            delete selected[courseId];
          }
        } else {
          delete selected[courseId];
        }
        saveSchedulerState(termCode, { selected });
        await recomputeMissingCoreqs();
        renderSelected();
        try {
          const idx = scheduleIndex || await loadTermScheduleIndex(termCode);
          if (idx) {
            scheduleIndex = idx;
            renderGrid(idx);
            renderResults(idx, lastQuery);
          }
        } catch (_) {}
      }
    });

    resultsEl.addEventListener('click', async (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('.scheduler-pick') : null;
      const details = e.target && e.target.closest ? e.target.closest('.scheduler-details') : null;
      if (details) {
        const courseId = normalizeCourseId(details.getAttribute('data-course') || '');
        if (courseId) await openCourseDetailsModal(courseId);
        return;
      }
      if (!btn) return;
      const courseId = normalizeCourseId(btn.getAttribute('data-course') || '');
      if (!courseId) return;
      const idx = await loadTermScheduleIndex(termCode);
      if (!idx) return;
      scheduleIndex = idx;
      await pickSectionForCourse(idx, courseId);
      await recomputeMissingCoreqs();
      renderSelected();
      renderGrid(idx);
    });

    if (hideTakenToggle) {
      hideTakenToggle.addEventListener('change', () => {
        const enabled = !!hideTakenToggle.checked;
        setGlobalBool('hideTakenCourses', enabled);
        try { document.dispatchEvent(new Event('hideTakenCoursesToggleChanged')); } catch (_) {}
        try { if (scheduleIndex) renderResults(scheduleIndex, lastQuery); } catch (_) {}
      });
    }
    if (detailsToggle) {
      detailsToggle.addEventListener('change', () => {
        const enabled = !!detailsToggle.checked;
        setGlobalBool('showCourseDetails', enabled);
        try { document.dispatchEvent(new Event('courseDetailsToggleChanged')); } catch (_) {}
        try {
          renderSelected();
          if (scheduleIndex) renderResults(scheduleIndex, lastQuery);
        } catch (_) {}
      });
    }
    if (scoreToggle) {
      scoreToggle.addEventListener('change', () => {
        const enabled = !!scoreToggle.checked;
        setGlobalBool('sortBasedOnScore', enabled);
        try { document.dispatchEvent(new Event('sortByScoreToggleChanged')); } catch (_) {}
        try { if (scheduleIndex) renderResults(scheduleIndex, lastQuery); } catch (_) {}
      });
    }
    if (hoverPreviewToggle) {
      hoverPreviewToggle.addEventListener('change', () => {
        const enabled = !!hoverPreviewToggle.checked;
        try { localStorage.setItem('schedulerHoverPreview', enabled ? 'true' : 'false'); } catch (_) {}
        hoverSelectedCourseId = '';
        hoverResultCourseId = '';
        clearPreviewBlocks();
        clearHoverHighlights();
      });
    }
    if (highlightToggle) {
      highlightToggle.addEventListener('change', () => {
        const enabled = !!highlightToggle.checked;
        try { localStorage.setItem('schedulerHighlightAvailability', enabled ? 'true' : 'false'); } catch (_) {}
        try { if (scheduleIndex) renderResults(scheduleIndex, lastQuery); } catch (_) {}
      });
    }
    if (showBlockedToggle) {
      showBlockedToggle.addEventListener('change', () => {
        const enabled = !!showBlockedToggle.checked;
        try { localStorage.setItem('schedulerShowBlockedCourses', enabled ? 'true' : 'false'); } catch (_) {}
        try { if (scheduleIndex) renderResults(scheduleIndex, lastQuery); } catch (_) {}
      });
    }
    const rerenderResultsSafe = () => {
      try { if (scheduleIndex) renderResults(scheduleIndex, lastQuery); } catch (_) {}
    };
    const onMinTypeChange = (key, el) => {
      if (!el) return;
      el.addEventListener('change', () => {
        try { localStorage.setItem(key, String(el.value || '')); } catch (_) {}
        rerenderResultsSafe();
      });
    };
    onMinTypeChange('schedulerMinMajorType', minMainTypeSelect);
    onMinTypeChange('schedulerMinDmType', minDmTypeSelect);
    onMinTypeChange('schedulerMinMinorType', minMinorTypeSelect);

    const onMinNumberInput = (key, el) => {
      if (!el) return;
      let t = null;
      const flush = () => {
        try { localStorage.setItem(key, String(el.value || '')); } catch (_) {}
        rerenderResultsSafe();
      };
      el.addEventListener('input', () => {
        if (t) clearTimeout(t);
        t = setTimeout(flush, 120);
      });
      el.addEventListener('change', flush);
    };
    onMinNumberInput('schedulerMinSuCredits', minSuInput);
    onMinNumberInput('schedulerMinEcts', minEctsInput);
    onMinNumberInput('schedulerMinBasicScience', minBsInput);
    onMinNumberInput('schedulerMinEngineering', minEngInput);

    if (prereqToggle) {
      prereqToggle.addEventListener('change', () => {
        const enabled = !!prereqToggle.checked;
        try { localStorage.setItem('schedulerCheckPrereqs', enabled ? 'true' : 'false'); } catch (_) {}
        syncPrereqUi();
        rerenderResultsSafe();
      });
    }
    if (showUnmetPrereqToggle) {
      showUnmetPrereqToggle.addEventListener('change', () => {
        const enabled = !!showUnmetPrereqToggle.checked;
        try { localStorage.setItem('schedulerShowUnmetPrereqs', enabled ? 'true' : 'false'); } catch (_) {}
        rerenderResultsSafe();
      });
    }

    // Multiple schedules (within the current term, per saved plan).
    const newScheduleId = () => `sched_${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`;
    const maxSchedules = 10;

    const applyActiveScheduleFromRoot = async (root) => {
      state = root || loadSchedulerState(termCode);
      const active = getActiveSchedule(state);
      selected = active.selected && typeof active.selected === 'object' ? active.selected : {};
      blocked = Array.isArray(active.blocked) ? active.blocked : [];

      // Mirror to legacy fields for other code paths.
      try { state.selected = selected; } catch (_) {}
      try { state.blocked = blocked; } catch (_) {}
      try { state.ui = active.ui && typeof active.ui === 'object' ? active.ui : {}; } catch (_) {}
      saveSchedulerRoot(state);

      refreshScheduleLabel();
      applyScheduleUi();
      try { renderBlocked(); } catch (_) {}
      try { await recomputeMissingCoreqs(); } catch (_) {}
      try { renderSelected(); } catch (_) {}
      try {
        if (scheduleIndex) {
          renderGrid(scheduleIndex);
          renderResults(scheduleIndex, lastQuery);
        }
      } catch (_) {}
    };

    const openScheduleManager = async () => {
      const ui = (typeof window !== 'undefined') ? window.uiModal : null;
      while (true) {
        const root = loadSchedulerState(termCode);
        const schedules = root.schedules && typeof root.schedules === 'object' ? root.schedules : null;
        const items = schedules && schedules.items && typeof schedules.items === 'object' ? schedules.items : {};
        const order = Array.isArray(schedules && schedules.order) ? schedules.order.slice() : [];
        const activeId = schedules && schedules.activeId ? String(schedules.activeId) : (order[0] || 'default');
        const active = items[activeId] || getActiveSchedule(root);

        const listItems = order.map((sid) => {
          const it = items[sid] || {};
          const selCount = it && it.selected && typeof it.selected === 'object' ? Object.keys(it.selected).length : 0;
          const blkCount = Array.isArray(it.blocked) ? it.blocked.length : 0;
          const meta = [];
          if (selCount) meta.push(`${selCount} selected`);
          if (blkCount) meta.push(`${blkCount} blocked`);
          if (String(sid) === activeId) meta.unshift('Active');
          return { action: 'switch', value: String(sid), label: String(it.name || sid), subLabel: meta.length ? meta.join(' • ') : '' };
        });

        const res = await createPickerModal({
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

        if (!res || !res.action || res.action === 'close' || res.action === 'cancel') return;

        if (res.action === 'switch') {
          const targetId = String(res.value || '');
          if (!targetId || !items[targetId]) continue;
          try { root.schedules.activeId = targetId; } catch (_) {}
          await applyActiveScheduleFromRoot(root);
          continue;
        }

        if (res.action === 'new' || res.action === 'dup') {
          if (order.length >= maxSchedules) {
            if (ui && typeof ui.alert === 'function') {
              ui.alert('Schedule limit', `<p>You can have up to <strong>${maxSchedules}</strong> schedules per term.</p>`);
            }
            continue;
          }
          const id = newScheduleId();
          const copy = (res.action === 'dup');
          const next = {
            id,
            name: copy ? `${String(active && active.name ? active.name : 'Schedule')} (copy)` : 'New schedule',
            selected: copy && active && active.selected ? JSON.parse(JSON.stringify(active.selected)) : {},
            blocked: copy && Array.isArray(active && active.blocked) ? JSON.parse(JSON.stringify(active.blocked)) : [],
            ui: copy && active && active.ui ? JSON.parse(JSON.stringify(active.ui)) : (active && active.ui ? JSON.parse(JSON.stringify(active.ui)) : {}),
          };
          try { items[id] = next; } catch (_) {}
          try { root.schedules.order.push(id); } catch (_) {}
          try { root.schedules.activeId = id; } catch (_) {}
          await applyActiveScheduleFromRoot(root);
          continue;
        }

        if (res.action === 'rename') {
          const promptRes = await createTextInputModal({
            title: 'Rename schedule',
            bodyHtml: '<p>Choose a name for this schedule.</p>',
            initialValue: String(active && active.name ? active.name : ''),
            placeholder: 'Schedule name',
            okLabel: 'Rename',
          });
          const name = (promptRes && promptRes.action === 'ok') ? String(promptRes.value || '').trim() : '';
          if (!name) continue;
          try { items[activeId].name = name; } catch (_) {}
          saveSchedulerRoot(root);
          refreshScheduleLabel();
          continue;
        }

        if (res.action === 'delete') {
          if (order.length <= 1) {
            if (ui && typeof ui.alert === 'function') {
              ui.alert('Cannot delete', '<p>You must keep at least one schedule.</p>');
            }
            continue;
          }
          const ok = await createPickerModal({
            title: 'Delete schedule',
            bodyHtml: `<p>Delete <strong>${escapeHtml(String(active && active.name ? active.name : 'this schedule'))}</strong>?</p>`,
            buttons: [
              { action: 'cancel', label: 'Cancel', variant: 'secondary' },
              { action: 'delete', label: 'Delete', variant: 'danger' },
            ],
          });
          if (!ok || ok.action !== 'delete') continue;
          try { delete items[activeId]; } catch (_) {}
          try { root.schedules.order = order.filter(x => String(x) !== String(activeId)); } catch (_) {}
          try { root.schedules.activeId = String(root.schedules.order[0] || 'default'); } catch (_) {}
          await applyActiveScheduleFromRoot(root);
          continue;
        }
      }
    };

    if (scheduleBtn) {
      scheduleBtn.addEventListener('click', async () => {
        try { await openScheduleManager(); } catch (_) {}
      });
    }

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
        const card = e.target && e.target.closest ? e.target.closest('.scheduler-course') : null;
        if (!card) return;
        const courseId = normalizeCourseId(card.getAttribute('data-course') || '');
        if (!courseId) return;
        if (courseId === hoverResultCourseId) return;
        hoverResultCourseId = courseId;
        hoverSelectedCourseId = '';
        clearHoverHighlights();
        try {
          if (selected[courseId]) {
            const bundle = computeBundleClosure(courseId);
            applyHoverHighlightForCourses(bundle);
            clearPreviewBlocks();
            return;
          }
        } catch (_) {}
        try {
          if (scheduleIndex) renderPreviewForCourse(scheduleIndex, courseId);
        } catch (_) {}
      });
      resultsEl.addEventListener('mouseleave', () => {
        hoverResultCourseId = '';
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
        const next = (Array.isArray(blocked) ? blocked : []).filter(b => String(b && b.id ? b.id : '') !== id);
        setBlocked(next);
        renderBlocked();
        try { if (scheduleIndex) renderGrid(scheduleIndex); } catch (_) {}
        try { if (scheduleIndex) renderResults(scheduleIndex, lastQuery); } catch (_) {}
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
        try { if (scheduleIndex) renderGrid(scheduleIndex); } catch (_) {}
        try { if (scheduleIndex) renderResults(scheduleIndex, lastQuery); } catch (_) {}
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
      const next = (Array.isArray(blocked) ? blocked : []).filter(b => String(b && b.id ? b.id : '') !== String(res.value));
      setBlocked(next);
      renderBlocked();
      try { if (scheduleIndex) renderGrid(scheduleIndex); } catch (_) {}
      try { if (scheduleIndex) renderResults(scheduleIndex, lastQuery); } catch (_) {}
    });

    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', async () => {
        try {
          resultsLimit += 60;
          const idx = scheduleIndex || await loadTermScheduleIndex(termCode);
          if (!idx) return;
          scheduleIndex = idx;
          renderResults(idx, lastQuery);
        } catch (_) {}
      });
    }

    // Render blocked-hours list immediately (even before schedule loads).
    renderBlocked();

    // Load schedule index and initialize UI
    (async () => {
      const idx = await loadTermScheduleIndex(termCode);
      if (!idx) {
        resultsEl.innerHTML =
          `<div class="scheduler-muted">No schedule data found for <strong>${escapeHtml(termName || termCode)}</strong>.</div>` +
          `<div class="scheduler-muted">Expected file: <code>courses/schedule/${escapeHtml(termCode)}.jsonl</code></div>` +
          `<div class="scheduler-muted">Run the schedule scraper to generate it.</div>`;
        renderSelected();
        return;
      }
      scheduleIndex = idx;
      try {
        const loadInfo = (typeof window !== 'undefined') ? window.loadCoursePageInfoIndex : null;
        if (typeof loadInfo === 'function') coursePageInfoMap = await loadInfo();
      } catch (_) {}

      renderSelected();
      await recomputeMissingCoreqs();
      renderSelected();
      renderResults(idx, '');
      renderGrid(idx);

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

      let t = null;
      searchEl.addEventListener('input', () => {
        if (t) clearTimeout(t);
        t = setTimeout(() => {
          resultsLimit = 60;
          renderResults(idx, searchEl.value);
        }, 80);
      });
    })();
  }

  if (typeof window !== 'undefined') {
    window.openSchedulerModal = openSchedulerModal;
  }
})();
