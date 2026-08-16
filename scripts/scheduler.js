// Current term scheduler UI (SUchedule-like) for building a weekly timetable.
// Loads meeting times from courses/schedule/<termCode>.jsonl.

(function () {
  const PLAN_ID_FOR_SESSION = (() => {
    try {
      const ps = (typeof window !== 'undefined') ? window.planStorage : null;
      return (ps && typeof ps.getSessionPlanId === 'function')
        ? ps.getSessionPlanId() : null;
    } catch (_) {
      return null;
    }
  })();

  const DAYS = [
    { key: 'M', label: 'Mon' },
    { key: 'T', label: 'Tue' },
    { key: 'W', label: 'Wed' },
    { key: 'R', label: 'Thu' },
    { key: 'F', label: 'Fri' },
    { key: 'S', label: 'Sat', optional: true },
    { key: 'U', label: 'Sun', optional: true },
  ];

  const DAY_START_MIN = 8 * 60 + 40;  // 08:40
  const DAY_END_MIN = 19 * 60 + 30;   // 19:30

  let schedulerDialogSequence = 0;

  function nextSchedulerDialogId(prefix) {
    schedulerDialogSequence += 1;
    return `${prefix || 'scheduler-dialog'}-${schedulerDialogSequence}`;
  }

  function getSchedulerDialogFocusables(overlay) {
    if (!overlay || typeof overlay.querySelectorAll !== 'function') return [];
    return Array.from(overlay.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
      'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter((element) => {
      if (!element || element.getAttribute('aria-hidden') === 'true') return false;
      if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
      try {
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden';
      } catch (_) {
        return true;
      }
    });
  }

  function isTopModalDialog(overlay) {
    if (!overlay || !overlay.isConnected) return false;
    try {
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]'))
        .filter((dialog) => {
          if (!dialog || !dialog.isConnected || dialog.hidden) return false;
          try {
            const style = getComputedStyle(dialog);
            return style.display !== 'none' && style.visibility !== 'hidden';
          } catch (_) {
            return true;
          }
        });
      return dialogs.length ? dialogs[dialogs.length - 1] === overlay : true;
    } catch (_) {
      return true;
    }
  }

  function activateSchedulerDialog(overlay, options) {
    const opts = options || {};
    const previouslyFocused = opts.previouslyFocused || (
      typeof HTMLElement !== 'undefined' && document.activeElement instanceof HTMLElement
        ? document.activeElement : null
    );
    let active = true;

    const focusElement = (element) => {
      try {
        if (element && element.isConnected && typeof element.focus === 'function') {
          element.focus({ preventScroll: true });
          return true;
        }
      } catch (_) {}
      return false;
    };

    const resolveInitialFocus = () => {
      try {
        const requested = typeof opts.initialFocus === 'function'
          ? opts.initialFocus()
          : opts.initialFocus;
        if (focusElement(requested)) return;
        const focusables = getSchedulerDialogFocusables(overlay);
        if (focusElement(focusables[0])) return;
        if (overlay) {
          if (!overlay.hasAttribute('tabindex')) overlay.tabIndex = -1;
          focusElement(overlay);
        }
      } catch (_) {}
    };

    const onKeyDown = (event) => {
      if (!active || !isTopModalDialog(overlay)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
        if (typeof opts.onEscape === 'function') opts.onEscape();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusables = getSchedulerDialogFocusables(overlay);
      if (!focusables.length) {
        event.preventDefault();
        if (!overlay.hasAttribute('tabindex')) overlay.tabIndex = -1;
        focusElement(overlay);
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const current = document.activeElement;
      if (event.shiftKey && (current === first || !overlay.contains(current))) {
        event.preventDefault();
        focusElement(last);
      } else if (!event.shiftKey && (current === last || !overlay.contains(current))) {
        event.preventDefault();
        focusElement(first);
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    try { setTimeout(resolveInitialFocus, 0); } catch (_) { resolveInitialFocus(); }

    return {
      release({ restoreFocus = true } = {}) {
        if (!active) return;
        active = false;
        try { document.removeEventListener('keydown', onKeyDown, true); } catch (_) {}
        if (restoreFocus) focusElement(previouslyFocused);
      },
      focusInitial: resolveInitialFocus,
    };
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

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

  function displayTermNameSafe(termCode) {
    const code = String(termCode || '').trim();
    if (!code) return '';
    try {
      if (typeof window !== 'undefined' && typeof window.termCodeToName === 'function') {
        return window.termCodeToName(code) || code;
      }
    } catch (_) {}
    return code;
  }

  const SCHEDULER_TERM_MANIFEST_PATH = './courses/schedule_subjects.json';
  const FUTURE_TERM_WARNING_KEY_PREFIX = 'surriculum.schedulerFutureTermWarning.';

  async function loadSchedulerTermManifest() {
    try {
      if (window.__schedulerTermManifestPromise) return window.__schedulerTermManifestPromise;
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
      const text = await tryReadText(SCHEDULER_TERM_MANIFEST_PATH);
      if (!text) return { terms: {} };
      try {
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === 'object' ? parsed : { terms: {} };
      } catch (_) {
        return { terms: {} };
      }
    })();

    try { window.__schedulerTermManifestPromise = promise; } catch (_) {}
    return promise;
  }

  async function getAvailableSchedulerTerms() {
    const manifest = await loadSchedulerTermManifest();
    const terms = manifest && manifest.terms && typeof manifest.terms === 'object' ? manifest.terms : {};
    return Object.keys(terms)
      .map((code) => String(code || '').trim())
      .filter((code) => /^\d{6}$/.test(code))
      .sort((a, b) => parseInt(String(b || '0'), 10) - parseInt(String(a || '0'), 10));
  }

  function resolveSchedulerTermCode(preferredTermCode, availableTerms, currentTermCode) {
    const preferred = String(preferredTermCode || '').trim();
    const current = String(currentTermCode || '').trim();
    const terms = Array.isArray(availableTerms) ? availableTerms.map(x => String(x || '').trim()).filter(Boolean) : [];
    if (preferred && terms.includes(preferred)) return preferred;
    if (current && terms.includes(current)) return current;
    return terms[0] || current || '';
  }

  function hasSeenFutureTermWarning(termCode) {
    try {
      return localStorage.getItem(FUTURE_TERM_WARNING_KEY_PREFIX + String(termCode || '').trim()) === '1';
    } catch (_) {}
    return false;
  }

  function markFutureTermWarningSeen(termCode) {
    try { localStorage.setItem(FUTURE_TERM_WARNING_KEY_PREFIX + String(termCode || '').trim(), '1'); } catch (_) {}
  }

  async function maybeWarnFutureSchedulerTerm(termCode, currentTermCode, ui) {
    const target = String(termCode || '').trim();
    const current = String(currentTermCode || '').trim();
    if (!target || !current) return;
    if (!/^\d{6}$/.test(target) || !/^\d{6}$/.test(current)) return;
    if (parseInt(target, 10) <= parseInt(current, 10)) return;
    if (hasSeenFutureTermWarning(target)) return;
    if (ui && typeof ui.alert === 'function') {
      await ui.alert(
        'Future term schedule',
        `<p><strong>${escapeHtml(displayTermNameSafe(target))}</strong> is a future term.</p>` +
        `<p>Its courses, sections, CRNs, instructors, and meeting times are provisional and likely to change.</p>`
      );
    }
    markFutureTermWarningSeen(target);
  }

  function getSavedSchedulerSelectedTerm() {
    try { return String(planGetItem('schedulerSelectedTerm') || '').trim(); } catch (_) {}
    return '';
  }

  function setSavedSchedulerSelectedTerm(termCode) {
    try { planSetItem('schedulerSelectedTerm', String(termCode || '').trim()); } catch (_) {}
  }

  function normalizeCourseId(code) {
    return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  function parseDaysToKeys(days) {
    const s = String(days || '').toUpperCase().replace(/\s+/g, '');
    // Banner's compact day codes are combinations such as M, TR, or MTWRF.
    // Reject whole malformed/TBA tokens instead of accidentally interpreting
    // one of their letters as a real meeting day (for example TBA -> Tuesday).
    if (!s || !/^[MTWRFSU]+$/.test(s)) return [];
    return Array.from(new Set(s.split('')));
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
    // Distribute across the hue circle but skip the yellow / yellow-green band
    // (~45–80°): with the theme's course-color saturation/lightness those hues
    // are too pale for block text. Map into the remaining arc, then hop over it.
    const EXCL_START = 45, EXCL_WIDTH = 35; // 45–80° reserved (unreadable yellows)
    let hue = hash % (360 - EXCL_WIDTH);
    if (hue >= EXCL_START) hue += EXCL_WIDTH;
    return `hsl(${hue} var(--scheduler-course-saturation) var(--scheduler-course-lightness))`;
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

  function getPlannerSemesterCourseCodes(termCode) {
    try {
      const cur = window.curriculum;
      if (!cur || !cur.semesters) return [];
      const target = String(termCode || '').trim();
      if (!/^\d{4}(01|02|03)$/.test(target)) return [];
      const codes = new Set();
      cur.semesters.forEach((semester) => {
        const code = (typeof window.semesterTermCode === 'function')
          ? String(window.semesterTermCode(semester) || '')
          : String((semester && semester.termCode) || '');
        if (code !== target) return;
        (Array.isArray(semester && semester.courses) ? semester.courses : []).forEach((course) => {
          const normalized = normalizeCourseId(course && course.code);
          if (normalized) codes.add(normalized);
        });
      });
      return Array.from(codes);
    } catch (_) {}
    return [];
  }

  function extractCoreqCourseIdsFromCoursePageInfoField(coreq) {
    try {
      const shared = (typeof window !== 'undefined') ? window.courseRequisites : null;
      if (shared && typeof shared.extractCourseCodes === 'function') {
        return shared.extractCourseCodes(coreq);
      }
    } catch (_) {}
    const s = String(coreq || '');
    if (!s) return [];
    const out = new Set();
    const re = /([A-Z]{2,5})\s*([0-9]{3,5}[A-Z]?)/g;
    let m;
    while ((m = re.exec(s)) !== null) {
      out.add((m[1] + m[2]).toUpperCase());
    }
    return Array.from(out);
  }

  function createPickerModal({ title, bodyHtml, listItems, buttons }) {
    return new Promise((resolve) => {
      const previouslyFocused = typeof HTMLElement !== 'undefined' && document.activeElement instanceof HTMLElement
        ? document.activeElement : null;
      const dialogId = nextSchedulerDialogId('scheduler-picker');
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay scheduler-picker-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-labelledby', `${dialogId}-title`);
      overlay.setAttribute('aria-describedby', `${dialogId}-body`);

      const modal = document.createElement('div');
      modal.className = 'modal app-modal scheduler-picker-modal';
      modal.id = dialogId;
      modal.tabIndex = -1;
      modal.addEventListener('click', (e) => e.stopPropagation());

      const header = document.createElement('div');
      header.className = 'app-modal-header';

      const h = document.createElement('h3');
      h.className = 'app-modal-title';
      h.id = `${dialogId}-title`;
      h.textContent = title || '';

      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'app-modal-close';
      close.innerHTML = '<i class="fa-solid fa-xmark"></i>';
      close.setAttribute('aria-label', `Close ${title || 'dialog'}`);

      const body = document.createElement('div');
      body.className = 'app-modal-body';
      body.id = `${dialogId}-body`;
      body.innerHTML = bodyHtml || '';

      if (Array.isArray(listItems) && listItems.length) {
        const list = document.createElement('div');
        list.className = 'scheduler-picker-list';
        for (let i = 0; i < listItems.length; i++) {
          const it = listItems[i] || {};
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'scheduler-picker-option' + (it.className ? ' ' + String(it.className) : '');
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

      let settled = false;
      let dialogController = null;
      const cleanup = (payload) => {
        if (settled) return;
        settled = true;
        try { overlay.remove(); } catch (_) {}
        try { if (dialogController) dialogController.release(); } catch (_) {}
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
        if (b && b.ariaLabel) btn.setAttribute('aria-label', String(b.ariaLabel));
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

      dialogController = activateSchedulerDialog(overlay, {
        previouslyFocused,
        initialFocus: () => body.querySelector('.scheduler-picker-option') || footer.querySelector('button') || close,
        onEscape: () => cleanup({ action: 'cancel' }),
      });
    });
  }

  function createInfoModal({ title, bodyHtml, buttons, onMount }) {
    return new Promise((resolve) => {
      const previouslyFocused = typeof HTMLElement !== 'undefined' && document.activeElement instanceof HTMLElement
        ? document.activeElement : null;
      const dialogId = nextSchedulerDialogId('scheduler-info');
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay scheduler-picker-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-labelledby', `${dialogId}-title`);
      overlay.setAttribute('aria-describedby', `${dialogId}-body`);

      const modal = document.createElement('div');
      modal.className = 'modal app-modal scheduler-picker-modal scheduler-details-modal';
      modal.id = dialogId;
      modal.tabIndex = -1;
      modal.addEventListener('click', (e) => e.stopPropagation());

      const header = document.createElement('div');
      header.className = 'app-modal-header';

      const h = document.createElement('h3');
      h.className = 'app-modal-title';
      h.id = `${dialogId}-title`;
      h.textContent = title || '';

      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'app-modal-close';
      close.innerHTML = '<i class="fa-solid fa-xmark"></i>';
      close.setAttribute('aria-label', `Close ${title || 'dialog'}`);

      const body = document.createElement('div');
      body.className = 'app-modal-body';
      body.id = `${dialogId}-body`;
      body.innerHTML = bodyHtml || '';

      const footer = document.createElement('div');
      footer.className = 'app-modal-footer';

      let settled = false;
      let dialogController = null;
      const cleanup = (payload) => {
        if (settled) return;
        settled = true;
        try { overlay.remove(); } catch (_) {}
        try { if (dialogController) dialogController.release(); } catch (_) {}
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
        if (b && b.ariaLabel) btn.setAttribute('aria-label', String(b.ariaLabel));
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
        modal.scrollTop = 0;
        body.scrollTop = 0;
        close.focus({ preventScroll: true });
      } catch (_) {}

      try {
        if (typeof onMount === 'function') onMount({ overlay, modal, body, close: () => cleanup({ action: 'close' }) });
      } catch (_) {}

      dialogController = activateSchedulerDialog(overlay, {
        previouslyFocused,
        initialFocus: close,
        onEscape: () => cleanup({ action: 'cancel' }),
      });
    });
  }

  function createTextInputModal({ title, bodyHtml, initialValue, placeholder, okLabel }) {
    return new Promise((resolve) => {
      const previouslyFocused = typeof HTMLElement !== 'undefined' && document.activeElement instanceof HTMLElement
        ? document.activeElement : null;
      const dialogId = nextSchedulerDialogId('scheduler-input');
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay scheduler-picker-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-labelledby', `${dialogId}-title`);
      overlay.setAttribute('aria-describedby', `${dialogId}-body`);

      const modal = document.createElement('div');
      modal.className = 'modal app-modal scheduler-picker-modal';
      modal.id = dialogId;
      modal.tabIndex = -1;
      modal.addEventListener('click', (e) => e.stopPropagation());

      const header = document.createElement('div');
      header.className = 'app-modal-header';

      const h = document.createElement('h3');
      h.className = 'app-modal-title';
      h.id = `${dialogId}-title`;
      h.textContent = title || '';

      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'app-modal-close';
      close.innerHTML = '<i class="fa-solid fa-xmark"></i>';
      close.setAttribute('aria-label', `Close ${title || 'dialog'}`);

      const body = document.createElement('div');
      body.className = 'app-modal-body';
      body.id = `${dialogId}-body`;
      body.innerHTML = bodyHtml || '';

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'select-control';
      input.placeholder = placeholder || '';
      input.value = String(initialValue || '');
      input.maxLength = 200;
      input.setAttribute('aria-label', title || 'Dialog input');
      input.style.width = '100%';
      input.style.marginTop = bodyHtml ? '10px' : '0';
      body.appendChild(input);

      const footer = document.createElement('div');
      footer.className = 'app-modal-footer';

      let settled = false;
      let dialogController = null;
      const cleanup = (payload) => {
        if (settled) return;
        settled = true;
        try { overlay.remove(); } catch (_) {}
        try { if (dialogController) dialogController.release(); } catch (_) {}
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

      dialogController = activateSchedulerDialog(overlay, {
        previouslyFocused,
        initialFocus: input,
        onEscape: () => cleanup({ action: 'cancel' }),
      });
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

  async function openSchedulerModal(preferredTermCode) {
    const schedulerOpener = typeof HTMLElement !== 'undefined' && document.activeElement instanceof HTMLElement
      ? document.activeElement : null;
    const currentTermName = getCurrentTermNameSafe();
    const currentTermCode = getCurrentTermCodeSafe();
    const ui = (typeof window !== 'undefined') ? window.uiModal : null;
    const DISPLAY_END_EXTRA_MIN = 10; // show the final boundary at 19:40
    const DISPLAY_END_MIN = DAY_END_MIN + DISPLAY_END_EXTRA_MIN;
    const GRID_MAX_END_MIN = 24 * 60;
    let currentGridEndMin = DISPLAY_END_MIN;
    let activePreviewIntervals = [];

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
    setSavedSchedulerSelectedTerm(initialTermCode);
    await maybeWarnFutureSchedulerTerm(initialTermCode, currentTermCode, ui);

    const termCode = initialTermCode;
    const termName = displayTermNameSafe(termCode) || currentTermName || termCode;
    const isCurrentSchedulerTerm = termCode === currentTermCode;
    const schedulerDialogId = nextSchedulerDialogId('scheduler');

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
    let onDocMouseUp = null;
    let onWinResize = null;
    let mainDialogController = null;
    let mobileDayObserver = null;
    let onSharedHideTakenChange = null;
    let onSharedDetailsChange = null;
    let onSharedSortChange = null;
    let schedulerClosed = false;
    let filterMenuOpen = false;
    let setFilterMenuOpen = null;

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
        const intervals = getSectionIntervals(sec);
        return intervals.slice(0, maxMeetings).map(it => {
          const base = `${it.dayKey} ${minutesToLabel(it.start)}–${minutesToLabel(it.end)}`;
          const where = it.where && it.where.includes(' / ') ? 'Multiple locations' : it.where;
          let dateHint = '';
          if (Array.isArray(it.dateLabels) && it.dateLabels.length > 1) {
            dateHint = `${it.dateLabels.length} date ranges`;
          } else if (Array.isArray(it.dateWindows) && it.dateWindows.length === 1 && it.dateWindows[0].startDay === it.dateWindows[0].endDay) {
            dateHint = String((it.dateLabels && it.dateLabels[0]) || '').split(' - ')[0];
          }
          return `${base}${where ? ` @ ${where}` : ''}${dateHint ? ` (${dateHint})` : ''}`;
        }).filter(Boolean).join(' • ');
      } catch (_) {
        return '';
      }
    };

    // Stable key for "same timing" comparisons (ignores classroom/instructor,
    // but preserves date windows so separate intensive offerings are not listed
    // as interchangeable CRNs).
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
          const dateRange = String(m.date_range || m.dateRange || '').trim().replace(/\s+/g, ' ');
          for (let di = 0; di < daysArr.length; di++) {
            parts.push(`${daysArr[di]}|${start}|${end}|${dateRange || 'DATE-TBA'}`);
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
        try {
          const loadInstructorHistory = (typeof window !== 'undefined') ? window.loadCourseInstructorHistoryIndex : null;
          if (!courseInstructorHistoryMap && typeof loadInstructorHistory === 'function') {
            courseInstructorHistoryMap = await loadInstructorHistory();
          }
        } catch (_) {}
        try {
          const loadSectionHistory = (typeof window !== 'undefined') ? window.loadCourseSectionHistoryIndex : null;
          if (!courseSectionHistoryMap && typeof loadSectionHistory === 'function') {
            courseSectionHistoryMap = await loadSectionHistory();
          }
        } catch (_) {}
        const pi = (() => {
          try { return coursePageInfoMap && typeof coursePageInfoMap.get === 'function' ? coursePageInfoMap.get(cid) : null; } catch (_) { return null; }
        })();
        const instructorHistoryInfo = (() => {
          try {
            return courseInstructorHistoryMap && typeof courseInstructorHistoryMap.get === 'function'
              ? courseInstructorHistoryMap.get(cid)
              : null;
          } catch (_) {
            return null;
          }
        })();
        const sectionHistoryInfo = (() => {
          try {
            return courseSectionHistoryMap && typeof courseSectionHistoryMap.get === 'function'
              ? courseSectionHistoryMap.get(cid)
              : null;
          } catch (_) {
            return null;
          }
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

        let termHistoryRowsForDom = [];
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
          const generalPrereq = (pi.general_requirement_prerequisites != null)
            ? String(pi.general_requirement_prerequisites) : '';
          const minimumPriorSu = (pi.minimum_earned_su_credits != null)
            ? fmtNum(pi.minimum_earned_su_credits) : '';
          const generalRequirements = (pi.general_requirements != null)
            ? String(pi.general_requirements) : '';
          const desc = (pi.description != null) ? String(pi.description) : '';
          const offered = Array.isArray(pi.last_offered_terms) ? pi.last_offered_terms : [];
          const formatDescription = (value) => {
            const raw = String(value || '').trim();
            if (!raw) return '';
            return raw
              .replace(/\r\n/g, '\n')
              .replace(/\n{2,}/g, '\u0000')
              .replace(/[ \t]*\n[ \t]*/g, ' ')
              .replace(/\u0000/g, '\n\n')
              .replace(/[ \t]{2,}/g, ' ')
              .trim();
          };

          const metaParts = [];
          if (su) metaParts.push(`<div><span class="muted">SU:</span> ${escapeHtml(su)}</div>`);
          if (ects) metaParts.push(`<div><span class="muted">ECTS:</span> ${escapeHtml(ects)}</div>`);
          if (bs && bs !== '0.0') metaParts.push(`<div><span class="muted">BS:</span> ${escapeHtml(bs)}</div>`);
          if (eng && eng !== '0.0') metaParts.push(`<div><span class="muted">ENG:</span> ${escapeHtml(eng)}</div>`);

          const instructorHistory = (
            instructorHistoryInfo && Array.isArray(instructorHistoryInfo.history)
              ? instructorHistoryInfo.history
              : []
          );
          const sectionHistory = (
            sectionHistoryInfo && Array.isArray(sectionHistoryInfo.history)
              ? sectionHistoryInfo.history
              : []
          );
          const normalizeTerm = (value) => {
            try {
              const fn = (typeof window !== 'undefined') ? window.normalizeTermIdentifier : null;
              if (typeof fn === 'function') return fn(value);
            } catch (_) {}
            return String(value || '').trim();
          };
          const displayTerm = (value) => {
            try {
              const fn = (typeof window !== 'undefined') ? window.displayTermIdentifier : null;
              if (typeof fn === 'function') return fn(value);
            } catch (_) {}
            return String(value || '').trim();
          };
          const termHistoryMap = new Map();
          offered.forEach((entry) => {
            const term = normalizeTerm(entry && entry.term ? String(entry.term) : '');
            if (!term) return;
            const existing = termHistoryMap.get(term) || { term, instructors: [] };
            termHistoryMap.set(term, existing);
          });
          instructorHistory.forEach((entry) => {
            const term = normalizeTerm(entry && entry.term ? String(entry.term) : '');
            if (!term) return;
            const existing = termHistoryMap.get(term) || { term, instructors: [] };
            const instructors = entry && Array.isArray(entry.instructors)
              ? entry.instructors.filter(Boolean).map(name => String(name))
              : [];
            existing.instructors = Array.from(new Set([...(existing.instructors || []), ...instructors])).sort();
            termHistoryMap.set(term, existing);
          });
          const sectionTerms = new Set();
          const sectionRows = sectionHistory
            .map((entry) => {
              const term = normalizeTerm(entry && entry.term ? String(entry.term) : '');
              if (!term) return null;
              sectionTerms.add(term);
              return {
                term,
                termCode: term,
                section: entry && entry.section ? String(entry.section) : '',
                crn: entry && entry.crn ? String(entry.crn) : '',
                instructors: entry && Array.isArray(entry.instructors)
                  ? entry.instructors.filter(Boolean).map(name => String(name))
                  : [],
                capacity: entry ? entry.capacity : null,
                actual: entry ? entry.actual : null,
                remaining: entry ? entry.remaining : null,
                showSeats: true,
              };
            })
            .filter(Boolean);
          const fallbackRows = Array.from(termHistoryMap.values())
            .filter(entry => entry && entry.term && !sectionTerms.has(entry.term))
            .map(entry => ({
              term: entry.term,
              termCode: entry.term,
              section: '',
              crn: '',
              instructors: entry && Array.isArray(entry.instructors)
                ? entry.instructors.filter(Boolean).map(name => String(name))
                : [],
              capacity: null,
              actual: null,
              remaining: null,
              showSeats: true,
              summaryOnly: true,
            }));
          const limitRowsByDistinctTerms = (rows, maxTerms) => {
            const seenTerms = new Set();
            return rows.filter((row) => {
              const term = row && row.term ? String(row.term) : '';
              if (!term) return false;
              if (!seenTerms.has(term) && seenTerms.size >= maxTerms) return false;
              seenTerms.add(term);
              return true;
            });
          };
          const sortedTermHistoryRows = [...sectionRows, ...fallbackRows]
            .sort((a, b) => {
              const termDiff = parseInt(String(b.term || '0'), 10) - parseInt(String(a.term || '0'), 10);
              if (termDiff) return termDiff;
              return String(a.section || '').localeCompare(String(b.section || '')) || String(a.crn || '').localeCompare(String(b.crn || ''));
            });
          const termHistoryRows = limitRowsByDistinctTerms(sortedTermHistoryRows, 24);
          const fullTermCount = new Set(termHistoryRows.map(row => row && row.term).filter(Boolean)).size;
          const termHistoryHtml = termHistoryRows.length
            ? (
              `<div class="scheduler-details-subsection">` +
              `<div class="scheduler-details-subtitle">Offered Terms, Instructors & Seats (${fullTermCount || termHistoryMap.size})</div>` +
              `<div class="course-history-anchor" data-course-history-anchor="scheduler"></div>` +
              `</div>`
            )
            : '';

          termHistoryRowsForDom = termHistoryRows.map(entry => ({
            term: entry && entry.term ? displayTerm(entry.term) : 'Unknown term',
            termCode: entry && entry.termCode ? entry.termCode : (entry && entry.term ? entry.term : ''),
            section: entry && entry.section ? entry.section : '',
            crn: entry && entry.crn ? entry.crn : '',
            instructors: entry && Array.isArray(entry.instructors)
              ? entry.instructors.filter(Boolean).map(name => String(name))
              : [],
            capacity: entry ? entry.capacity : null,
            actual: entry ? entry.actual : null,
            remaining: entry ? entry.remaining : null,
            showSeats: true,
            summaryOnly: !!(entry && entry.summaryOnly),
          }));

          const formattedDesc = formatDescription(desc);
          const descHtml = formattedDesc
            ? (
              `<div class="scheduler-details-subsection">` +
              `<div class="scheduler-details-subtitle">Description</div>` +
              `<div class="scheduler-details-paragraph">${escapeHtml(formattedDesc).replace(/\n\n/g, '<br><br>')}</div>` +
              `</div>`
            )
            : '';
          const prereqHtml = prereq || !generalPrereq
            ? (
              `<div class="scheduler-details-subsection">` +
              `<div class="scheduler-details-subtitle">Prerequisites</div>` +
              `<div class="scheduler-details-paragraph">${prereq ? escapeHtml(prereq) : 'None'}</div>` +
              `</div>`
            )
            : '';
          const generalRequirementsText = generalRequirements || (minimumPriorSu
            ? `Minimum ${minimumPriorSu} prior SU credits.` : '');
          const generalRequirementsHtml = generalRequirementsText
            ? (
              `<div class="scheduler-details-subsection">` +
              `<div class="scheduler-details-subtitle">General requirements</div>` +
              `<div class="scheduler-details-paragraph">${escapeHtml(generalRequirementsText)}</div>` +
              `</div>`
            )
            : '';

          return (
            `<div class="scheduler-details-card">` +
            `<div class="scheduler-details-card-title">Catalog info</div>` +
            (metaParts.length ? `<div class="scheduler-details-meta">${metaParts.join('')}</div>` : '') +
            prereqHtml +
            generalRequirementsHtml +
            `<div class="scheduler-details-subsection">` +
            `<div class="scheduler-details-subtitle">Corequisites</div>` +
            `<div class="scheduler-details-paragraph">${coreq ? escapeHtml(coreq) : 'None'}</div>` +
            `</div>` +
            descHtml +
            (termHistoryRows.length
              ? (
                `<details class="scheduler-details-disclosure">` +
                `<summary class="scheduler-details-disclosure-summary">Offered Terms, Instructors & Seats (${fullTermCount || termHistoryMap.size})</summary>` +
                `<div class="scheduler-details-disclosure-body">` +
                `<div class="course-history-anchor" data-course-history-anchor="scheduler"></div>` +
                `</div>` +
                `</details>`
              )
              : termHistoryHtml) +
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
          onMount: ({ modal, body }) => {
            try {
              const anchor = body ? body.querySelector('[data-course-history-anchor="scheduler"]') : null;
              const build = (typeof window !== 'undefined') ? window.buildCourseHistoryTableElement : null;
              if (anchor && typeof build === 'function') {
                const node = build(termHistoryRowsForDom, { splitTerms: true, openOffered: true, openFuture: false });
                if (node) anchor.appendChild(node);
              }
            } catch (_) {}
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
      if (schedulerClosed) return;
      schedulerClosed = true;
      try { document.removeEventListener('fullscreenchange', onFullscreenChange); } catch (_) {}
      try { if (onWinResize) window.removeEventListener('resize', onWinResize); } catch (_) {}
      try { if (onDocMouseUp) document.removeEventListener('mouseup', onDocMouseUp); } catch (_) {}
      try { if (onSharedHideTakenChange) document.removeEventListener('hideTakenCoursesToggleChanged', onSharedHideTakenChange); } catch (_) {}
      try { if (onSharedDetailsChange) document.removeEventListener('courseDetailsToggleChanged', onSharedDetailsChange); } catch (_) {}
      try { if (onSharedSortChange) document.removeEventListener('sortByScoreToggleChanged', onSharedSortChange); } catch (_) {}
      try { if (mobileDayObserver) mobileDayObserver.disconnect(); } catch (_) {}
      try {
        if (typeof modal.__setCourseSheetOpen === 'function') modal.__setCourseSheetOpen(false);
      } catch (_) {}
      try { overlay.remove(); } catch (_) {}
      try { if (mainDialogController) mainDialogController.release(); } catch (_) {}
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
    const plannerSectionTitle = isCurrentSchedulerTerm ? 'Current Term Plan' : 'Planner Semester';
    const plannerUpdateLabel = isCurrentSchedulerTerm ? 'Update current-term plan' : 'Update planner semester';
    const plannerHintHtml = isCurrentSchedulerTerm
      ? ''
      : `<div class="scheduler-term-note">Planner sync targets <strong>${escapeHtml(termName)}</strong>.</div>`;

    const schedulerFilterControlsHtml =
      `<div class="scheduler-controls">` +
      `  <div class="scheduler-control control-row toggle-row">` +
      `    <div class="toggle-text">Hide taken courses</div>` +
      `    <label class="toggle-switch"><input class="scheduler-toggle-hide-taken" type="checkbox" aria-label="Hide taken courses" /><span class="toggle-slider"></span></label>` +
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
      `          <button class="btn btn-secondary btn-sm scheduler-filter-btn" type="button" aria-expanded="false" aria-controls="${schedulerDialogId}-filters"><i class="fa-solid fa-filter" aria-hidden="true"></i>&nbsp;Filters</button>` +
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

    modal.appendChild(header);
    modal.appendChild(body);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const syncMobileDayTabSemantics = () => {
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

    modal.addEventListener('click', (event) => {
      const tab = event.target && event.target.closest ? event.target.closest('.m-sched-day') : null;
      if (!tab) return;
      try { setTimeout(syncMobileDayTabSemantics, 0); } catch (_) { syncMobileDayTabSemantics(); }
    });
    modal.addEventListener('keydown', (event) => {
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
      syncMobileDayTabSemantics();
    });
    try {
      mobileDayObserver = new MutationObserver(syncMobileDayTabSemantics);
      mobileDayObserver.observe(modal, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-m-day'],
      });
    } catch (_) {}

    mainDialogController = activateSchedulerDialog(overlay, {
      previouslyFocused: schedulerOpener,
      initialFocus: () => (
        document.body.classList.contains('is-mobile')
          ? closeBtn
          : (body.querySelector('.scheduler-search') || closeBtn)
      ),
      onEscape: () => {
        if (filterMenuOpen && typeof setFilterMenuOpen === 'function') {
          setFilterMenuOpen(false);
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
          const { pxPerMin, topGapPx } = getSchedulerLayout();
          for (let i = 0; i <= hourSlots; i++) {
            const line = document.createElement('div');
            line.className = 'scheduler-hour-line';
            line.style.top = `${topGapPx + (i * 60 * pxPerMin)}px`;
            col.insertBefore(line, col.firstChild);
          }
        });
      } catch (_) {}
    };
    renderTimeGrid(DISPLAY_END_MIN);

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
    let courseInstructorHistoryMap = null;
    let courseSectionHistoryMap = null;
    let missingByCourse = {}; // course_id -> [missing coreq course_id]
    let orphanByCourse = {};  // course_id -> [base course_ids that require this course as coreq]
    let reverseCoreqIndex = null; // Map(coreq -> Set(baseCourse))

    const scheduleBtn = body.querySelector('.scheduler-schedule-toggle');
    const scheduleNameEl = body.querySelector('.scheduler-schedule-name');
    const termSelectEl = body.querySelector('.scheduler-term-select');

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

    const applySchedulerTermOptions = () => {
      try {
        if (!termSelectEl) return;
        termSelectEl.innerHTML = availableTerms.map((code) => {
          const label = displayTermNameSafe(code) || code;
          return `<option value="${escapeHtml(code)}">${escapeHtml(label)}</option>`;
        }).join('');
        termSelectEl.value = termCode;
      } catch (_) {}
    };
    applySchedulerTermOptions();

    if (termSelectEl) {
      termSelectEl.addEventListener('change', async () => {
        const nextTermCode = resolveSchedulerTermCode(termSelectEl.value, availableTerms, currentTermCode);
        if (!nextTermCode || nextTermCode === termCode) {
          try { termSelectEl.value = termCode; } catch (_) {}
          return;
        }
        setSavedSchedulerSelectedTerm(nextTermCode);
        await maybeWarnFutureSchedulerTerm(nextTermCode, currentTermCode, ui);
        cleanup();
        try { await openSchedulerModal(nextTermCode); } catch (_) {}
      });
    }

    // Collapsible sidebar sections (Current Term Plan / Selected Sections)
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
          if (sidebarToggleBtn) {
            const expanded = !body.classList.contains('is-sidebar-collapsed');
            sidebarToggleBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
            sidebarToggleBtn.setAttribute('aria-label', expanded ? 'Collapse scheduler sidebar' : 'Expand scheduler sidebar');
            sidebarToggleBtn.setAttribute('title', expanded ? 'Collapse sidebar' : 'Expand sidebar');
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
          const expanded = !active.ui.sidebarCollapsed;
          sidebarToggleBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
          sidebarToggleBtn.setAttribute('aria-label', expanded ? 'Collapse scheduler sidebar' : 'Expand scheduler sidebar');
          sidebarToggleBtn.setAttribute('title', expanded ? 'Collapse sidebar' : 'Expand sidebar');
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
        const v = preferenceGetItem(key);
        if (v === null) return fallback;
        return v === 'true';
      } catch (_) {
        return fallback;
      }
    };
    const readStrLS = (key, fallback) => {
      try {
        const v = preferenceGetItem(key);
        if (v === null) return fallback;
        return String(v);
      } catch (_) {
        return fallback;
      }
    };
    const setGlobalBool = (key, value) => {
      preferenceSetItem(key, value ? 'true' : 'false');
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

    setFilterMenuOpen = (open) => {
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
          const dateRange = String(m.date_range || m.dateRange || '').trim().replace(/\s+/g, ' ');
          if (days && start != null && end != null) {
            meetingBits.push(`${days}|${start}|${end}|${dateRange || 'DATE-TBA'}|${where}`);
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
          `<button type="button" class="btn btn-secondary btn-sm scheduler-blocked-remove" data-block-id="${escapeHtml(String(b.id || ''))}" aria-label="Remove blocked time ${escapeHtml(label)}">Remove</button>` +
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

    // The "hide taken" filter treats a course as taken only if it's planned for
    // the scheduler's selected term OR an earlier one. A course planned solely
    // for a LATER term hasn't been taken yet as of the selected term, so it must
    // stay visible instead of being filtered out. (Current-term planned/selected
    // courses are also kept visible via keepVisible so users can schedule them.)
    let takenUpToTermSet = null; // Set(courseId): selected term and earlier
    let takenBeforeCurrentSet = null; // Set(courseId) populated per renderResults (previous terms only)
    const computeTakenUpToTermSet = () => {
      try {
        const cur = (typeof window !== 'undefined') ? window.curriculum : null;
        if (!cur) return null;
        const curCode = parseInt(String(termCode || ''), 10) || 0;
        if (!curCode) return null;
        const out = new Set();
        const semesters = Array.isArray(cur.semesters) ? cur.semesters : [];
        for (let i = 0; i < semesters.length; i++) {
          const semObj = semesters[i];
          const canonical = typeof window.semesterTermCode === 'function'
            ? window.semesterTermCode(semObj) : (semObj && semObj.termCode);
          const code = parseInt(String(canonical || ''), 10) || 0;
          if (!code || code > curCode) continue; // skip future terms only
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

    // Taken courses from previous terms only (used for prereq checking).
    const computeTakenBeforeCurrentTermSet = () => {
      try {
        const cur = (typeof window !== 'undefined') ? window.curriculum : null;
        if (!cur) return null;
        const curCode = parseInt(String(termCode || ''), 10) || 0;
        if (!curCode) return null;
        const out = new Set();
        const semesters = Array.isArray(cur.semesters) ? cur.semesters : [];
        for (let i = 0; i < semesters.length; i++) {
          const semObj = semesters[i];
          const canonical = typeof window.semesterTermCode === 'function'
            ? window.semesterTermCode(semObj) : (semObj && semObj.termCode);
          const code = parseInt(String(canonical || ''), 10) || 0;
          if (!code || code >= curCode) continue;
          if (!semObj || !Array.isArray(semObj.courses)) continue;
          for (let j = 0; j < semObj.courses.length; j++) {
            const cc = semObj.courses[j];
            if (typeof cur.isDegreeEligibleCourse === 'function'
                && !cur.isDegreeEligibleCourse(cc)) continue;
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
        if (takenUpToTermSet instanceof Set) return takenUpToTermSet.has(cid);
        const cur = (typeof window !== 'undefined') ? window.curriculum : null;
        if (!cur || typeof cur.hasCourse !== 'function') return false;
        return !!cur.hasCourse(cid);
      } catch (_) {
        return false;
      }
    };

    const DATE_DAY_MS = 24 * 60 * 60 * 1000;
    const DATE_MONTHS = {
      Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
      Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
    };
    const DAY_KEY_TO_UTC_DAY = { U: 0, M: 1, T: 2, W: 3, R: 4, F: 5, S: 6 };

    const parseMeetingDateRange = (value) => {
      try {
        const label = String(value || '').trim().replace(/\s+/g, ' ');
        const match = label.match(/^([A-Z][a-z]{2}) (\d{1,2}), (\d{4}) - ([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/);
        if (!match) return null;
        const startMonth = DATE_MONTHS[match[1]];
        const endMonth = DATE_MONTHS[match[4]];
        if (!Number.isInteger(startMonth) || !Number.isInteger(endMonth)) return null;
        const startYear = Number(match[3]);
        const startDate = Number(match[2]);
        const endYear = Number(match[6]);
        const endDate = Number(match[5]);
        const startMs = Date.UTC(startYear, startMonth, startDate);
        const endMs = Date.UTC(endYear, endMonth, endDate);
        const startCheck = new Date(startMs);
        const endCheck = new Date(endMs);
        if (startCheck.getUTCFullYear() !== startYear || startCheck.getUTCMonth() !== startMonth || startCheck.getUTCDate() !== startDate) return null;
        if (endCheck.getUTCFullYear() !== endYear || endCheck.getUTCMonth() !== endMonth || endCheck.getUTCDate() !== endDate) return null;
        const startDay = Math.floor(startMs / DATE_DAY_MS);
        const endDay = Math.floor(endMs / DATE_DAY_MS);
        if (endDay < startDay) return null;
        return { startDay, endDay, label };
      } catch (_) {
        return null;
      }
    };

    const dateWindowContainsDay = (windowRange, dayKey) => {
      try {
        if (!windowRange) return false;
        const wantedDay = DAY_KEY_TO_UTC_DAY[dayKey];
        if (!Number.isInteger(wantedDay)) return false;
        const firstWeekday = new Date(windowRange.startDay * DATE_DAY_MS).getUTCDay();
        const firstOccurrence = windowRange.startDay + ((wantedDay - firstWeekday + 7) % 7);
        return firstOccurrence <= windowRange.endDay;
      } catch (_) {
        return false;
      }
    };

    const mergeDateWindows = (windows) => {
      const sorted = (Array.isArray(windows) ? windows : [])
        .filter(w => w && Number.isInteger(w.startDay) && Number.isInteger(w.endDay) && w.endDay >= w.startDay)
        .map(w => ({ startDay: w.startDay, endDay: w.endDay }))
        .sort((a, b) => (a.startDay - b.startDay) || (a.endDay - b.endDay));
      const merged = [];
      for (let i = 0; i < sorted.length; i++) {
        const next = sorted[i];
        const last = merged[merged.length - 1];
        if (last && next.startDay <= last.endDay + 1) {
          if (next.endDay > last.endDay) last.endDay = next.endDay;
        } else {
          merged.push(next);
        }
      }
      return merged;
    };

    const dateWindowsOverlapOnDay = (dayKey, aWindows, bWindows) => {
      // A missing/invalid date range is treated conservatively as recurring for
      // the whole term so unknown data can never produce a false "available".
      if (!Array.isArray(aWindows) || !aWindows.length) return true;
      if (!Array.isArray(bWindows) || !bWindows.length) return true;
      for (let ai = 0; ai < aWindows.length; ai++) {
        for (let bi = 0; bi < bWindows.length; bi++) {
          const startDay = Math.max(aWindows[ai].startDay, bWindows[bi].startDay);
          const endDay = Math.min(aWindows[ai].endDay, bWindows[bi].endDay);
          if (endDay < startDay) continue;
          if (dateWindowContainsDay({ startDay, endDay }, dayKey)) return true;
        }
      }
      return false;
    };

    const sectionMeetingModelCache = new WeakMap();
    const getSectionMeetingModel = (sec) => {
      if (!sec || typeof sec !== 'object') return { intervals: [], incomplete: true };
      try {
        const cached = sectionMeetingModelCache.get(sec);
        if (cached) return cached;
      } catch (_) {}

      const bySlot = new Map();
      let incomplete = false;
      try {
        const meetings = Array.isArray(sec.meetings) ? sec.meetings : [];
        if (!meetings.length) incomplete = true;
        for (let i = 0; i < meetings.length; i++) {
          const m = meetings[i] || {};
          const days = parseDaysToKeys(m.days || m.Days || '');
          let start = m.start_min;
          let end = m.end_min;
          if (start == null || end == null) {
            const tr = parseTimeRangeToMinutes(m.time || m.Time || '');
            if (tr) {
              start = tr.start;
              end = tr.end;
            } else {
              // Do not let Number(null) turn a partially missing endpoint into
              // midnight and admit a plausible-looking but bogus interval.
              start = Number.NaN;
              end = Number.NaN;
            }
          }
          start = Number(start);
          end = Number(end);
          const rawDateRange = m.date_range || m.dateRange || '';
          const dateWindow = parseMeetingDateRange(rawDateRange);
          const validTime = Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start && end <= GRID_MAX_END_MIN;
          if (!days.length || !validTime || !dateWindow) incomplete = true;
          if (!days.length || !validTime) continue;

          for (let di = 0; di < days.length; di++) {
            const dayKey = days[di];
            const windowMatchesDay = !!(dateWindow && dateWindowContainsDay(dateWindow, dayKey));
            if (dateWindow && !windowMatchesDay) incomplete = true;
            const key = `${dayKey}|${start}|${end}`;
            let slot = bySlot.get(key);
            if (!slot) {
              slot = {
                dayKey,
                start,
                end,
                dateWindows: [],
                dateLabels: new Set(),
                locations: new Set(),
                instructors: new Set(),
                unknownDates: false,
              };
              bySlot.set(key, slot);
            }
            if (windowMatchesDay) {
              slot.dateWindows.push(dateWindow);
              slot.dateLabels.add(dateWindow.label);
            } else {
              slot.unknownDates = true;
            }
            const where = String(m.where || m.Where || '').trim();
            const instructors = String(m.instructors || m.Instructors || '').trim();
            if (where) slot.locations.add(where);
            if (instructors) slot.instructors.add(instructors);
          }
        }
      } catch (_) {
        incomplete = true;
      }

      const intervals = Array.from(bySlot.values()).map(slot => ({
        dayKey: slot.dayKey,
        start: slot.start,
        end: slot.end,
        dateWindows: slot.unknownDates ? null : mergeDateWindows(slot.dateWindows),
        dateLabels: Array.from(slot.dateLabels),
        where: Array.from(slot.locations).join(' / '),
        instructors: Array.from(slot.instructors).join(' / '),
      }));
      const model = { intervals, incomplete };
      try { sectionMeetingModelCache.set(sec, model); } catch (_) {}
      return model;
    };

    const getSectionIntervals = (sec) => getSectionMeetingModel(sec).intervals;

    const sectionHasIncompleteMeetingData = (sec) => getSectionMeetingModel(sec).incomplete;

    const isGridRenderableInterval = (it) => {
      try {
        if (!it || !DAYS.some(d => d.key === it.dayKey)) return false;
        return Number.isFinite(it.start) && Number.isFinite(it.end) &&
          it.start >= DAY_START_MIN && it.end > it.start && it.end <= GRID_MAX_END_MIN;
      } catch (_) {
        return false;
      }
    };

    const getSelectedIntervals = (idx) => {
      const out = [];
      try {
        if (!idx) return out;
        for (const rawCourseId of Object.keys(selected)) {
          const courseId = normalizeCourseId(rawCourseId);
          const pick = selected[rawCourseId] || selected[courseId] || {};
          const entry = courseId ? idx.get(courseId) : null;
          const crn = String(pick && pick.crn ? pick.crn : '');
          const sec = entry && Array.isArray(entry.sections)
            ? (entry.sections.find(s => String(s && s.crn ? s.crn : '') === crn) || null)
            : null;
          if (sec) out.push(...getSectionIntervals(sec));
        }
      } catch (_) {}
      return out;
    };

    const updateGridExtent = (idx) => {
      try {
        const intervals = getSelectedIntervals(idx)
          .concat(Array.isArray(activePreviewIntervals) ? activePreviewIntervals : [])
          .filter(isGridRenderableInterval);
        const optionalDays = new Set(
          intervals.map(it => it.dayKey).filter(dayKey => dayKey === 'S' || dayKey === 'U')
        );

        let requiredEnd = DISPLAY_END_MIN;
        for (let i = 0; i < intervals.length; i++) {
          if (intervals[i].end > requiredEnd) requiredEnd = intervals[i].end;
        }
        const slotCount = Math.max(1, Math.ceil((requiredEnd - DAY_START_MIN) / 60));
        const nextEnd = Math.min(GRID_MAX_END_MIN, DAY_START_MIN + slotCount * 60);
        const visibleDays = DAYS.filter(d => !d.optional || optionalDays.has(d.key));
        const signature = `${visibleDays.map(d => d.key).join('')}:${nextEnd}`;
        if (body.getAttribute('data-grid-layout') === signature) return;

        DAYS.forEach((d) => {
          if (!d.optional) return;
          const visible = optionalDays.has(d.key);
          const head = body.querySelector(`.scheduler-grid-day[data-day="${d.key}"]`);
          const col = body.querySelector(`.scheduler-day-col[data-day="${d.key}"]`);
          if (head) head.hidden = !visible;
          if (col) col.hidden = !visible;
        });

        const dayCount = visibleDays.length;
        const headerEl = body.querySelector('.scheduler-grid-header');
        if (headerEl) headerEl.style.setProperty('--scheduler-day-count', String(dayCount));
        if (schedulerGridEl) schedulerGridEl.style.setProperty('--scheduler-day-count', String(dayCount));
        renderTimeGrid(nextEnd);

        body.setAttribute('data-grid-layout', signature);
        modal.setAttribute('data-grid-days', visibleDays.map(d => d.key).join(''));
        modal.setAttribute('data-grid-minutes', String(nextEnd - DAY_START_MIN));
        try {
          modal.dispatchEvent(new CustomEvent('schedulergridchange', {
            detail: { days: visibleDays.map(d => d.key), endMin: nextEnd },
          }));
        } catch (_) {}
      } catch (_) {}
    };

    const intervalsOverlap = (a, b) => {
      try {
        if (!a || !b) return false;
        if (a.end <= b.start || a.start >= b.end) return false;
        const dayKey = a.dayKey || b.dayKey || '';
        if (a.dayKey && b.dayKey && a.dayKey !== b.dayKey) return false;
        return dateWindowsOverlapOnDay(dayKey, a.dateWindows, b.dateWindows);
      } catch (_) {
        return false;
      }
    };

    const countIntervalOverlaps = (interval, existingIntervals) => {
      let c = 0;
      try {
        const list = Array.isArray(existingIntervals) ? existingIntervals : [];
        for (let i = 0; i < list.length; i++) {
          const it = list[i];
          if (!it) continue;
          if (intervalsOverlap(interval, it)) c += 1;
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
              occ[dayKey].push({ dayKey, start: b.start, end: b.end, dateWindows: null, course_id: '__blocked__' });
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
            occ[it.dayKey].push({
              dayKey: it.dayKey,
              start: it.start,
              end: it.end,
              dateWindows: it.dateWindows,
              course_id: courseId,
            });
          }
        }
      } catch (_) {}
      return occ;
    };

    const sectionAvailabilityClasses = (courseId, sec, occForAvailability) => {
      const classes = [];
      try {
        const cid = normalizeCourseId(courseId);
        const crn = String(sec && sec.crn ? sec.crn : '').trim();
        const isSelected = !!(cid && crn && selected[cid] && String(selected[cid].crn || '') === crn);
        if (isSelected) {
          classes.push('is-selected');
          return classes;
        }
        if (shouldHighlightAvailability()) {
          const intervals = getSectionIntervals(sec);
          const conflict = intervals.some((it) => countIntervalOverlaps(it, (occForAvailability && occForAvailability[it.dayKey]) || []) > 0);
          if (conflict) classes.push('is-available-conflict');
          else if (sectionHasIncompleteMeetingData(sec)) classes.push('is-time-unknown');
          else classes.push('is-available');
        }
        if (Array.isArray(blocked) && blocked.length && shouldShowBlockedCourses()) {
          const blockedByDay = getBlockedByDay();
          const blockedHit = getSectionIntervals(sec).some((it) => countIntervalOverlaps(it, blockedByDay[it.dayKey] || []) > 0);
          if (blockedHit) classes.push('is-blocked-hours');
        }
      } catch (_) {}
      return classes;
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

        let best = { score: Infinity, conflicts: Infinity, unknowns: Infinity, picked: null };
        const picked = {};

        const dfs = (i, conflicts, unknowns) => {
          const partialScore = conflicts * 1000 + unknowns;
          if (partialScore >= best.score) return;
          if (best.score === 0) return;
          if (i >= bundleCourseIds.length) {
            best = { score: partialScore, conflicts, unknowns, picked: Object.assign({}, picked) };
            return;
          }
          const cid = bundleCourseIds[i];
          const secs = candidatesByCourse[cid] || [];
          for (let si = 0; si < secs.length; si++) {
            const sec = secs[si];
            const intervals = getSectionIntervals(sec);
            let extra = 0;
            const addedByDay = {};
            // A section's own date-specific rows are one schedule choice, not
            // competing choices. Score every row against the already occupied
            // schedule first, then add the section as a unit.
            for (let j = 0; j < intervals.length; j++) {
              const it = intervals[j];
              if (!occ[it.dayKey]) occ[it.dayKey] = [];
              extra += countIntervalOverlaps(it, occ[it.dayKey]);
            }
            for (let j = 0; j < intervals.length; j++) {
              const it = intervals[j];
              occ[it.dayKey].push({
                dayKey: it.dayKey,
                start: it.start,
                end: it.end,
                dateWindows: it.dateWindows,
                course_id: cid,
              });
              addedByDay[it.dayKey] = (addedByDay[it.dayKey] || 0) + 1;
            }
            picked[cid] = sec;
            dfs(i + 1, conflicts + extra, unknowns + (sectionHasIncompleteMeetingData(sec) ? 1 : 0));
            delete picked[cid];
            for (const dayKey of Object.keys(addedByDay)) {
              const n = addedByDay[dayKey] || 0;
              if (n > 0 && occ[dayKey] && occ[dayKey].length >= n) occ[dayKey].splice(-n, n);
            }
            if (best.score === 0) return;
          }
        };

        dfs(0, 0, 0);
        return best && best.picked ? best : null;
      } catch (_) {
        return null;
      }
    };

    const removePreviewBlocks = () => {
      try { body.querySelectorAll('.scheduler-block.is-preview').forEach(el => el.remove()); } catch (_) {}
    };

    const clearPreviewBlocks = () => {
      removePreviewBlocks();
      activePreviewIntervals = [];
      try { updateGridExtent(scheduleIndex); } catch (_) {}
      try { renderBlockedBackground(); } catch (_) {}
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
      clearPreviewBlocks();
      try {
        if (!idx || !baseCourseId) return;
        if (!(options && options.ignoreHoverPreference) && !shouldHoverPreview()) return;
        const cid = normalizeCourseId(baseCourseId);
        if (!cid) return;
        try {
          // For hover previews, only treat "taken" as "completed in previous terms".
          // Courses that are just in the current-term plan should still preview.
          if (!(takenBeforeCurrentSet instanceof Set)) takenBeforeCurrentSet = computeTakenBeforeCurrentTermSet();
          if (takenBeforeCurrentSet instanceof Set && takenBeforeCurrentSet.has(cid)) return;
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
        try { renderBlockedBackground(); } catch (_) {}

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
          setBlockPosition(block, dr.start, dr.end);
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
    const expandedResultSections = new Set();

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
        const scheduleWarningHtml = (() => {
          try {
            if (!sec) return '<div class="scheduler-selected-warning"><span class="muted">Schedule:</span> Section details are unavailable.</div>';
            const warnings = [];
            if (sectionHasIncompleteMeetingData(sec)) warnings.push('Some meeting times or dates are unavailable; conflict checks are incomplete.');
            const hiddenIntervals = getSectionIntervals(sec).filter(it => !isGridRenderableInterval(it));
            if (hiddenIntervals.length) warnings.push('Some meetings fall outside the supported 08:40–24:00 time grid; their conflicts are still checked.');
            return warnings.length
              ? `<div class="scheduler-selected-warning"><span class="muted">Schedule:</span> ${escapeHtml(warnings.join(' '))}</div>`
              : '';
          } catch (_) {
            return '';
          }
        })();

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
                `<button class="btn btn-secondary btn-sm scheduler-details" type="button" data-course="${escapeHtml(cid)}" aria-label="Details for ${escapeHtml(cid)}">Details</button>` +
                `<button class="btn btn-secondary btn-sm scheduler-pick" type="button" data-course="${escapeHtml(cid)}" aria-label="${sel ? 'Change section' : 'Pick section'} for ${escapeHtml(cid)}">${btnText}</button>` +
                (sel ? `<button class="scheduler-remove btn btn-secondary btn-sm" type="button" data-course="${escapeHtml(cid)}" aria-label="Remove ${escapeHtml(cid)}">Remove</button>` : '') +
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
          scheduleWarningHtml +
          (miss.length ? `<div class="scheduler-selected-warning"><span class="muted">Missing coreq:</span> ${escapeHtml(miss.join(', '))}</div>` : '') +
          (orphan.length ? `<div class="scheduler-selected-warning"><span class="muted">Looks like a coreq for:</span> ${escapeHtml(orphan.join(', '))}</div>` : '') +
          `<div class="scheduler-selected-actions-row">` +
          `<button type="button" class="btn btn-secondary btn-sm scheduler-details" data-course="${escapeHtml(courseId)}" aria-label="Details for ${escapeHtml(courseId)}">Details</button>` +
          `<button type="button" class="btn btn-secondary btn-sm scheduler-pick" data-course="${escapeHtml(courseId)}" aria-label="Change section for ${escapeHtml(courseId)}">Change</button>` +
          ((miss.length || orphan.length) ? `<button type="button" class="btn btn-warning btn-sm scheduler-fix-coreq" data-course="${escapeHtml(courseId)}" aria-label="Fix corequisites for ${escapeHtml(courseId)}">Fix</button>` : '') +
          `<button type="button" class="scheduler-remove btn btn-secondary btn-sm" data-course="${escapeHtml(courseId)}" aria-label="Remove ${escapeHtml(courseId)}">Remove</button>` +
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
        if (!col || col.hidden) continue;
        const list = byDay[dayKey] || [];
        for (let i = 0; i < list.length; i++) {
          const b = list[i];
          const start = b.start;
          const end = b.end;
          const visibleStart = Math.max(DAY_START_MIN, start);
          const visibleEnd = Math.min(currentGridEndMin, end);
          if (visibleEnd <= visibleStart) continue;
          const block = document.createElement('div');
          block.className = 'scheduler-block scheduler-block-bg is-blocked';
          try { if (b && b.id) block.setAttribute('data-block-id', String(b.id)); } catch (_) {}
          const dr = getDisplayRange(visibleStart, visibleEnd);
          setBlockPosition(block, dr.start, dr.end);
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
      clearGridBlocks();
      clearPreviewBlocks();
      renderBlockedBackground();
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
        setBlockPosition(block, dr.start, dr.end);
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
      try { takenUpToTermSet = computeTakenUpToTermSet(); } catch (_) { takenUpToTermSet = null; }
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
      const priorEligibleSu = (() => {
        if (!checkPrereqs) return 0;
        try {
          const cur = (typeof window !== 'undefined') ? window.curriculum : null;
          const shared = (typeof window !== 'undefined') ? window.courseRequisites : null;
          if (!cur || !shared || typeof shared.priorEligibleSuCredits !== 'function') return 0;
          return shared.priorEligibleSuCredits(
            cur.semesters,
            termCode,
            (course) => (
              typeof cur.isDegreeEligibleCourse !== 'function'
              || cur.isDegreeEligibleCourse(course)
            ),
          );
        } catch (_) {
          return 0;
        }
      })();
      const concurrentPrereqSet = (() => {
        const out = new Set();
        if (!checkPrereqs) return out;
        try {
          if (takenUpToTermSet instanceof Set) takenUpToTermSet.forEach((code) => out.add(code));
          Object.keys(selected || {}).forEach((code) => out.add(normalizeCourseId(code)));
        } catch (_) {}
        return out;
      })();
      const takenBeforeSig = (() => {
        try {
          if (!checkPrereqs || !takenBeforeSet || !(takenBeforeSet instanceof Set)) return '';
          return Array.from(takenBeforeSet).sort().join('|')
            + '::' + Array.from(concurrentPrereqSet).sort().join('|')
            + '::su=' + String(priorEligibleSu);
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
          if (!info) return null;
          const text = info.prerequisites ? String(info.prerequisites || '') : '';

          // The planner uses this same evaluator. Keep the older local parser
          // below only as a defensive fallback for a partially cached shell.
          try {
            const shared = (typeof window !== 'undefined') ? window.courseRequisites : null;
            if (shared && typeof shared.evaluatePrerequisites === 'function') {
              const sharedResult = typeof shared.evaluateCoursePrerequisites === 'function'
                ? shared.evaluateCoursePrerequisites(info, takenBeforeSet, {
                  concurrentAvailableCodes: concurrentPrereqSet,
                })
                : (text ? shared.evaluatePrerequisites(text, takenBeforeSet, {
                  concurrentAvailableCodes: concurrentPrereqSet,
                }) : null);
              const priorSuRequirement = typeof shared.minimumPriorSuRequirement === 'function'
                ? shared.minimumPriorSuRequirement(info, priorEligibleSu) : null;
              const result = sharedResult || priorSuRequirement
                ? {
                  ...(sharedResult || {
                    mode: 'expr', required: [], concurrent: [], oneOf: [], oneOfConcurrent: [],
                  }),
                  priorSuRequirement,
                }
                : null;
              try {
                if (prereqCheckCache && prereqCheckCache.map) {
                  prereqCheckCache.map.set(cid, result);
                }
              } catch (_) {}
              return result;
            }
          } catch (_) {}

          if (!text) return null;

          const tokenizePrereq = (s) => {
            const out = [];
            try {
              const re = /([A-Z]{2,5})\s*([0-9]{3,5}[A-Z]?)|(\()|(\))|\b(and|or)\b/ig;
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
                    return req > 0 || groups > 0 || !!unmet.priorSuRequirement;
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
          const priorSuRequirement = unmetPrereq && unmetPrereq.priorSuRequirement
            ? unmetPrereq.priorSuRequirement : null;
          const hasUnmetPrereq = !!(
            (unmetPrereq && unmetPrereq.mode === 'expr' && (unmetRequired.length || unmetOneOf.length)) ||
            (unmetList && unmetList.length) ||
            priorSuRequirement
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

          const renderInlineSectionsForEntry = (courseId, entry) => {
            const cid = normalizeCourseId(courseId);
            const sections = Array.isArray(entry && entry.sections) ? entry.sections.slice() : [];
            sections.sort((a, b) => {
              const aL = /lec/i.test(a.component || '') ? 0 : 1;
              const bL = /lec/i.test(b.component || '') ? 0 : 1;
              if (aL !== bL) return aL - bL;
              const ac = String(a.component || '').localeCompare(String(b.component || ''));
              if (ac) return ac;
              return String(a.section || '').localeCompare(String(b.section || ''));
            });
            const groups = new Map();
            sections.forEach((sec) => {
              const component = String(sec && sec.component ? sec.component : 'Other').trim() || 'Other';
              if (!groups.has(component)) groups.set(component, []);
              groups.get(component).push(sec);
            });
            const groupHtml = Array.from(groups.entries()).map(([component, list]) => {
              const rows = list.map((sec) => {
                const crn = sec && sec.crn ? String(sec.crn) : '';
                const sectionLabel = sec && sec.section ? String(sec.section) : '';
                const meetingSummary = sectionMeetingPreview(sec, 3);
                const instr = sectionInstructorPreview(sec);
                const meta = [meetingSummary, instr ? `Instructor: ${instr}` : ''].filter(Boolean).join(' — ');
                const isSelected = !!(selected[cid] && String(selected[cid].crn || '') === crn);
                const rowClasses = ['scheduler-inline-section-row', ...sectionAvailabilityClasses(cid, sec, occForAvailability)];
                return (
                  `<div class="${rowClasses.join(' ')}" data-course="${escapeHtml(cid)}" data-crn="${escapeHtml(crn)}" tabindex="0">` +
                  `<div class="scheduler-inline-section-main">` +
                  `<div class="scheduler-inline-section-title">${escapeHtml(cid)}${sectionLabel ? `-${escapeHtml(sectionLabel)}` : ''}${crn ? ` <span class="muted">(CRN ${escapeHtml(crn)})</span>` : ''}${isSelected ? ' <span class="scheduler-details-badge">Selected</span>' : ''}</div>` +
                  (meta ? `<div class="scheduler-inline-section-meta">${escapeHtml(meta)}</div>` : '') +
                  `</div>` +
                  `<div class="scheduler-inline-section-actions">` +
                  `<button class="btn btn-secondary btn-sm scheduler-section-pick" type="button" data-course="${escapeHtml(cid)}" data-crn="${escapeHtml(crn)}" aria-label="${isSelected ? 'Selected' : 'Pick'} ${escapeHtml(cid)}${sectionLabel ? ` section ${escapeHtml(sectionLabel)}` : ' section'}${crn ? ` CRN ${escapeHtml(crn)}` : ''}">${isSelected ? 'Selected' : 'Pick'}</button>` +
                  `</div>` +
                  `</div>`
                );
              }).join('');
              return (
                `<div class="scheduler-inline-section-group">` +
                `<div class="scheduler-inline-section-group-title">${escapeHtml(component)} (${list.length})</div>` +
                rows +
                `</div>`
              );
            }).join('');
            return groupHtml
              ? `<div class="scheduler-inline-sections">${groupHtml}</div>`
              : `<div class="scheduler-inline-sections"><div class="scheduler-muted">No sections listed.</div></div>`;
          };

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
                const expanded = expandedResultSections.has(cid);
                const entry = scheduleIndex.get(cid);
                return (
                  `<div class="scheduler-coreq-row${missing ? ' is-missing' : ''}">` +
                  `<div class="scheduler-coreq-label">${missing ? '<span class="scheduler-coreq-badge">Required</span>' : ''}${escapeHtml(meta)}</div>` +
                  `<div class="scheduler-coreq-actions">` +
                  `<button class="btn btn-secondary btn-sm scheduler-details" type="button" data-course="${escapeHtml(cid)}" aria-label="Details for ${escapeHtml(cid)}">Details</button>` +
                  `<button class="btn btn-secondary btn-sm scheduler-sections-toggle${expanded ? ' is-expanded' : ''}" type="button" data-course="${escapeHtml(cid)}" aria-expanded="${expanded ? 'true' : 'false'}" title="${expanded ? 'Hide sections' : 'Show sections'}" aria-label="${expanded ? 'Hide sections' : 'Show sections'} for ${escapeHtml(cid)}">` +
                  `<i class="fa-solid fa-list-ul" aria-hidden="true"></i>` +
                  (entry && Array.isArray(entry.sections) ? `<span class="scheduler-section-count">${entry.sections.length}</span>` : '') +
                  `</button>` +
                  `<button class="btn btn-secondary btn-sm scheduler-pick" type="button" data-course="${escapeHtml(cid)}" aria-label="${sel ? 'Change section' : 'Pick section'} for ${escapeHtml(cid)}">${btnText}</button>` +
                  `</div>` +
                  (expanded && entry ? renderInlineSectionsForEntry(cid, entry) : '') +
                  `</div>`
                );
              }).join('') +
              `</div>`
            )
            : '';
          const sectionsExpanded = expandedResultSections.has(normalizeCourseId(e.course_id));
          const inlineSectionsHtml = sectionsExpanded
            ? renderInlineSectionsForEntry(e.course_id, e)
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
                      if (best.conflicts > 0) classes.push('is-available-conflict');
                      else if (best.unknowns > 0) classes.push('is-time-unknown');
                      else classes.push('is-available');
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
                    if (priorSuRequirement) {
                      const compactSu = (value) => String(
                        Math.round((Number(value) || 0) * 100) / 100,
                      );
                      const actual = compactSu(priorSuRequirement.actual);
                      const minimum = compactSu(priorSuRequirement.minimum);
                      lines.push(`<div class="scheduler-course-meta"><span class="scheduler-badge-prereq">Prereq</span> Prior SU: ${escapeHtml(actual)} of ${escapeHtml(minimum)} planned/completed</div>`);
                    }
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
            `<button class="btn btn-secondary btn-sm scheduler-details" type="button" data-course="${escapeHtml(e.course_id)}" aria-label="Details for ${escapeHtml(e.course_id)}">Details</button>` +
            `<button class="btn btn-secondary btn-sm scheduler-sections-toggle${sectionsExpanded ? ' is-expanded' : ''}" type="button" data-course="${escapeHtml(e.course_id)}" aria-expanded="${sectionsExpanded ? 'true' : 'false'}" title="${sectionsExpanded ? 'Hide sections' : 'Show sections'}" aria-label="${sectionsExpanded ? 'Hide sections' : 'Show sections'} for ${escapeHtml(e.course_id)}">` +
            `<i class="fa-solid fa-list-ul" aria-hidden="true"></i>` +
            (Array.isArray(e.sections) ? `<span class="scheduler-section-count">${e.sections.length}</span>` : '') +
            `</button>` +
            `<button class="btn btn-secondary btn-sm scheduler-pick" type="button" data-course="${escapeHtml(e.course_id)}" aria-label="${already ? 'Change section' : 'Pick section'} for ${escapeHtml(e.course_id)}">${already ? 'Change section' : 'Pick section'}</button>` +
            `</div>` +
            inlineSectionsHtml +
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
            hoverResultSection = null;
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
              return { action: 'pick', label, subLabel: sub, value: { course_id: cid, crn: sec.crn }, className: sectionAvailabilityClasses(cid, sec, getOccupiedByDayFromSelected(scheduleIndex, { includeBlocked: true })).join(' ') };
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
          return { action: 'pick', label, subLabel: sub, value: { course_id: courseId, crn: sec.crn }, className: sectionAvailabilityClasses(courseId, sec, getOccupiedByDayFromSelected(scheduleIndex, { includeBlocked: true })).join(' ') };
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

    const pickSpecificSection = async (scheduleIndex, courseId, crn) => {
      const cid = normalizeCourseId(courseId);
      const crnText = String(crn || '').trim();
      if (!scheduleIndex || !cid || !crnText) return;
      const entry = scheduleIndex.get(cid);
      if (!entry || !Array.isArray(entry.sections)) return;
      const section = entry.sections.find(sec => String(sec && sec.crn ? sec.crn : '') === crnText) || null;
      if (!section) return;
      selected[cid] = { course_id: cid, crn: crnText };
      saveSchedulerState(termCode, { selected });
      await ensureCoreqsSelected(scheduleIndex, cid);
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
      if (scheduleIndex) renderGrid(scheduleIndex);
      else {
        clearGridBlocks();
        clearPreviewBlocks();
      }
      resultsEl.innerHTML = '<div class="scheduler-muted">Cleared. Search to add courses.</div>';
    });

    const findPlannerSemester = (targetTermCode) => {
      const cur = (typeof window !== 'undefined') ? window.curriculum : null;
      if (!cur) return null;
      const targetTermName = displayTermNameSafe(targetTermCode);
      if (!targetTermName) return null;
      // Prefer stable model identity. A term picker temporarily replaces the
      // rendered <p>, so DOM text alone can incorrectly create a duplicate.
      const targetCode = String(targetTermCode || '').trim();
      const modelMatches = (Array.isArray(cur.semesters) ? cur.semesters : []).filter((semester) => {
        const code = typeof window.semesterTermCode === 'function'
          ? String(window.semesterTermCode(semester) || '')
          : String((semester && semester.termCode) || '').trim();
        return code === targetCode;
      });
      if (modelMatches.length > 1) {
        throw new Error(`The planner contains multiple semester cards for ${targetTermName}. Resolve the duplicate terms before syncing the scheduler.`);
      }
      const modelSemester = modelMatches.length === 1 ? modelMatches[0] : null;
      if (modelSemester && modelSemester.id) {
        const semesterEl = document.getElementById(modelSemester.id);
        const container = semesterEl && semesterEl.closest
          ? semesterEl.closest('.container_semester') : null;
        if (semesterEl && container) {
          return { container, semesterEl, semesterObj: modelSemester };
        }
      }
      return null;
    };

    const createPlannerSemester = (targetTermCode) => {
      const cur = (typeof window !== 'undefined') ? window.curriculum : null;
      const targetTermName = displayTermNameSafe(targetTermCode);
      if (!cur || !targetTermName || typeof createSemeter !== 'function') {
        throw new Error('The planner semester could not be created.');
      }
      const board = document.querySelector('.board');
      const ghost = board ? board.querySelector('.add-semester-ghost') : null;
      const created = createSemeter(true, [], cur, course_data, [], targetTermName);
      if (created && board && ghost) {
        // Keep the "+ New Semester" ghost at the end like the normal flow.
        board.insertBefore(created, ghost);
      }
      const semEl = created ? created.querySelector('.semester') : null;
      const semObj = semEl ? cur.getSemester(semEl.id) : null;
      if (!created || !semEl || !semObj) {
        throw new Error('The planner semester could not be created.');
      }
      return { container: created, semesterEl: semEl, semesterObj: semObj };
    };

    const refreshPlannerTotalsForContainer = (container, semesterObj) => {
      try {
        const span = container ? container.querySelector('.total_credit_text span') : null;
        if (!span) return;
        const computedLoad = semesterObj && semesterObj.totalLoadCredit;
        const load = computedLoad !== null && computedLoad !== undefined
          ? computedLoad : (semesterObj ? (semesterObj.totalCredit || 0) : 0);
        if (typeof window !== 'undefined' && typeof window.updateSemesterCreditIndicator === 'function') {
          // The indicator reads the independently recomputed workload fields.
          // Passing the degree-oriented totalCredit here used to bypass them.
          window.updateSemesterCreditIndicator(span, semesterObj);
        } else {
          const totalText = (typeof window !== 'undefined' && typeof window.formatCreditValue === 'function')
            ? window.formatCreditValue(load)
            : (Number(load).toFixed(1));
          span.textContent = totalText + ' SU';
        }
      } catch (_) {}
    };

    const createPlannerCourseDom = (course, info) => {
      const courseCode = normalizePlannerCode(course && course.code);
      const courseId = String((course && course.id) || '');
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
      grade.textContent = course && course.grade ? String(course.grade) : 'Add grade';

      cContainer.appendChild(cLabel);
      cContainer.appendChild(cInfo);
      cContainer.appendChild(grade);
      domCourse.appendChild(cContainer);
      return domCourse;
    };

    const plannerCourseResolutionFromPage = (code, entry, section) => {
      let info = null;
      try { info = getPlannerInfo(code); } catch (_) {}
      // A selected-program or user-custom row is a complete planner
      // definition. Internal global rows remain external identity fallbacks and
      // must stay plan-scoped/N/A when a scheduler selection reuses them.
      const catalogBacked = !!(info && !info.__globalCourseDefinition);
      if (!catalogBacked && coursePageInfoMap && typeof coursePageInfoMap.get === 'function') {
        const pi = coursePageInfoMap.get(code);
        if (pi) {
          info = {
            ...(info || {}),
            Course_Name: pi.title || pi.header_text || (info && info.Course_Name) || '',
            EL_Type: 'unknown',
            SU_credit: (pi.su_credits != null)
              ? pi.su_credits : ((info && info.SU_credit != null) ? info.SU_credit : 0),
            Basic_Science: (pi.basic_science != null)
              ? pi.basic_science : ((info && info.Basic_Science != null) ? info.Basic_Science : 0),
            Engineering: (pi.engineering != null)
              ? pi.engineering : ((info && info.Engineering != null) ? info.Engineering : 0),
            ECTS: (pi.ects != null)
              ? pi.ects : ((info && info.ECTS != null) ? info.ECTS : 0),
            Faculty_Course: 'No',
            Faculty: pi.faculty || (info && info.Faculty) || '',
          };
        }
      }
      if (!catalogBacked && entry) {
        // The selected schedule row repairs stale/zero-credit placeholders on
        // repeat sync. Preserve fields the schedule does not publish (notably
        // ECTS) while refreshing its current title and section-specific SU.
        info = {
          ...(info || {}),
          Course_Name: entry.title || (info && info.Course_Name) || code,
          EL_Type: 'unknown',
          // The schedule index aggregates course entries; credits remain on
          // the individual section selected by the user.
          SU_credit: (section && section.credits != null)
            ? section.credits : ((info && info.SU_credit != null) ? info.SU_credit : 0),
          Basic_Science: (info && info.Basic_Science != null) ? info.Basic_Science : 0,
          Engineering: (info && info.Engineering != null) ? info.Engineering : 0,
          ECTS: (info && info.ECTS != null) ? info.ECTS : 0,
          Faculty_Course: 'No',
          Faculty: (info && info.Faculty) || '',
        };
      }
      return { info, catalogBacked };
    };

    const plannerCourseInfoFromPage = (code, entry, section) => (
      plannerCourseResolutionFromPage(code, entry, section).info
    );

    const plannerGlobalDefinition = (code, info) => {
      const normalized = normalizePlannerCode(code);
      const match = normalized.match(/^([A-Z]{1,12})(\d[A-Z0-9]*)$/);
      if (!match || !info) return null;
      const number = (value) => {
        const parsed = Number(String(value == null ? '' : value).trim().replace(',', '.'));
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
      };
      return {
        Major: match[1],
        Code: match[2],
        Course_Name: String(info.Course_Name || info.course_name || info.title || normalized),
        ECTS: String(number(info.ECTS != null ? info.ECTS : info.ects)),
        Engineering: number(info.Engineering != null ? info.Engineering : info.engineering),
        Basic_Science: number(info.Basic_Science != null ? info.Basic_Science : info.basic_science),
        SU_credit: String(number(info.SU_credit != null ? info.SU_credit : info.su_credits)),
        Faculty: String(info.Faculty || info.faculty || '').trim().toUpperCase(),
        // Scheduler/global identity cannot claim membership in a selected
        // undergraduate program. A separate explicit program classification is
        // required for that; the safe default is N/A.
        Faculty_Course: 'No',
        EL_Type: 'unknown',
        __globalCourseDefinition: true,
      };
    };

    const plannerGlobalMetadataSnapshot = (rawValue, definitions) => {
      let rows = [];
      if (rawValue) {
        rows = JSON.parse(rawValue);
        if (!Array.isArray(rows)) throw new Error('Saved external course metadata is invalid.');
      }
      const byCode = new Map();
      rows.forEach((row) => {
        const code = normalizePlannerCode(row && row.code);
        if (code && !byCode.has(code)) byCode.set(code, row);
      });
      (Array.isArray(definitions) ? definitions : []).forEach((definition) => {
        const code = normalizePlannerCode(String(definition.Major || '') + String(definition.Code || ''));
        if (!code) return;
        const previous = byCode.get(code) || {};
        const title = String(definition.Course_Name || '').trim();
        const suCredits = Number(definition.SU_credit);
        const nextEcts = Number(definition.ECTS);
        const previousEcts = Number(previous.ects);
        byCode.set(code, {
          code,
          title: title && title !== code ? title : String(previous.title || title || code),
          // Section credit is the scheduler's term-specific source of truth;
          // zero-credit seminars are valid and must not inherit stale credit.
          suCredits: Number.isFinite(suCredits) && suCredits >= 0 ? suCredits : 0,
          // Schedule rows do not currently carry ECTS. Preserve a known value
          // instead of replacing it with that absence-derived zero.
          ects: Number.isFinite(nextEcts) && nextEcts > 0
            ? nextEcts : (Number.isFinite(previousEcts) && previousEcts >= 0 ? previousEcts : 0),
        });
      });
      return JSON.stringify(Array.from(byCode.values()).sort((a, b) => a.code.localeCompare(b.code)));
    };

    const applyPlannerMetadata = (course, info) => {
      if (!course || !info) return;
      const credit = (typeof window !== 'undefined' && typeof window.parseCreditValue === 'function')
        ? window.parseCreditValue(info.SU_credit || 0)
        : (parseFloat(info.SU_credit || 0) || 0);
      course.SU_credit = credit;
      course.Basic_Science = parseFloat(info.Basic_Science || 0) || 0;
      course.Engineering = parseFloat(info.Engineering || 0) || 0;
      course.ECTS = parseFloat(info.ECTS || 0) || 0;
      course.Faculty_Course = info.Faculty_Course || 'No';
      course.Faculty = info.Faculty || '';
    };

    const refreshPlannerCourseDomMetadata = (domCourse, course, info) => {
      if (!domCourse || !course || !info) return;
      try {
        const nameNode = domCourse.querySelector('.course_name');
        const creditNode = domCourse.querySelector('.course_credit');
        const scienceNode = domCourse.querySelector('.course_bs_credit');
        if (nameNode) {
          nameNode.textContent = String(info.Course_Name || info.course_name || info.title || course.code || '');
        }
        if (creditNode) creditNode.textContent = fmtCredit(course.SU_credit) + ' credits';
        if (scienceNode) scienceNode.textContent = 'BS: ' + String(course.Basic_Science || 0) + ' credits';
      } catch (_) {}
    };

    const isPlannerComponent = (section) => {
      const component = String(section && section.component ? section.component : '').trim().toLowerCase();
      return !(component.includes('rec') || component.includes('lab'));
    };

    const captureOwnState = (value) => Object.getOwnPropertyDescriptors(value);
    const restoreOwnState = (value, descriptors) => {
      Object.keys(value).forEach((key) => {
        if (!Object.prototype.hasOwnProperty.call(descriptors, key)) {
          try { delete value[key]; } catch (_) {}
        }
      });
      Object.defineProperties(value, descriptors);
    };

    const capturePlannerRollback = (cur) => {
      const semesters = Array.isArray(cur.semesters) ? cur.semesters.slice() : [];
      const courseDataRows = Array.isArray(course_data) ? course_data.slice() : null;
      const curState = captureOwnState(cur);
      const semesterStates = semesters.map((semester) => ({
        semester,
        state: captureOwnState(semester),
      }));
      const courseStates = [];
      semesters.forEach((semester) => {
        (Array.isArray(semester.courses) ? semester.courses : []).forEach((course) => {
          if (course) courseStates.push({ course, state: captureOwnState(course) });
        });
      });

      const board = document.querySelector('.board');
      const boardChildren = board ? Array.from(board.childNodes) : [];
      const semesterDomStates = Array.from(document.querySelectorAll('.semester')).map((element) => ({
        element,
        children: Array.from(element.childNodes),
      }));
      const subcontainerDomStates = Array.from(document.querySelectorAll('.subcontainer_semester')).map((element) => ({
        element,
        children: Array.from(element.childNodes),
      }));
      const visualStates = Array.from(document.querySelectorAll(
        '.container_semester, .course_type, .total_credit_text span'
      )).map((element) => ({
        element,
        className: element.className,
        html: element.matches('.course_type, .total_credit_text span') ? element.innerHTML : null,
        // The semester-credit indicator now carries its workload split,
        // threshold, and accessible explanation in attributes. A failed
        // transactional replacement must restore those alongside its text and
        // class instead of leaving metadata from the rolled-back schedule.
        attributes: element.matches('.total_credit_text span')
          ? Array.from(element.attributes).map((attribute) => [attribute.name, attribute.value])
          : null,
      }));

      return () => {
        courseStates.forEach(({ course, state }) => restoreOwnState(course, state));
        semesterStates.forEach(({ semester, state }) => restoreOwnState(semester, state));
        restoreOwnState(cur, curState);
        cur.semesters = semesters.slice();
        if (courseDataRows && Array.isArray(course_data)) {
          course_data.splice(0, course_data.length, ...courseDataRows);
        }
        semesterDomStates.forEach(({ element, children }) => element.replaceChildren(...children));
        subcontainerDomStates.forEach(({ element, children }) => element.replaceChildren(...children));
        if (board) board.replaceChildren(...boardChildren);
        visualStates.forEach(({ element, className, html, attributes }) => {
          if (attributes) {
            Array.from(element.attributes).forEach((attribute) => {
              element.removeAttribute(attribute.name);
            });
            attributes.forEach(([name, value]) => element.setAttribute(name, value));
          } else {
            element.className = className;
          }
          if (html !== null) element.innerHTML = html;
        });
      };
    };

    const recomputePlannerSemesterGpa = (semester) => {
      let totalGPA = 0;
      let totalGPACredits = 0;
      (Array.isArray(semester && semester.courses) ? semester.courses : []).forEach((course) => {
        let outcome = null;
        if (typeof evaluateGradeForLegacyTotals === 'function') {
          outcome = evaluateGradeForLegacyTotals(course && course.grade, course && course.gradingBasis);
        } else {
          const policy = (typeof window !== 'undefined') ? window.gradePolicy : null;
          if (policy && typeof policy.evaluateGrade === 'function') {
            outcome = policy.evaluateGrade(course && course.grade, course && course.gradingBasis);
          }
        }
        if (!outcome || !outcome.countsInGpa) return;
        const info = plannerCourseInfoFromPage(normalizePlannerCode(course && course.code), null);
        const rawCredit = course && course.SU_credit != null
          ? course.SU_credit : (info ? info.SU_credit : 0);
        const credit = (typeof window !== 'undefined' && typeof window.parseCreditValue === 'function')
          ? window.parseCreditValue(rawCredit || 0)
          : (parseFloat(rawCredit || 0) || 0);
        totalGPA += credit * outcome.gpaPoints;
        totalGPACredits += credit;
      });
      semester.totalGPA = totalGPA;
      semester.totalGPACredits = totalGPACredits;
    };

    const preparePlannerReplacement = (selectionSnapshot, idx, cur) => {
      const retakePolicy = (typeof window !== 'undefined') ? window.courseRetakes : null;

      const retakeFailureMessage = (code, reason) => {
        const messages = {
          'target-not-later': 'the existing attempt is not in an earlier semester',
          'no-prior-occurrence': 'the existing attempt is not in an earlier semester',
          'unfinished-grade': 'the existing attempt does not yet have a final grade',
          'transfer-requires-substitution-review': 'a T grade uses the separate university substitution process',
          'passing-retake-window-expired': 'the passing-grade repeat window cannot be confirmed from the selected terms',
          'multiple-prior-occurrences': 'the plan contains multiple earlier attempts',
          'multiple-existing-occurrences': 'the plan contains multiple attempts',
          'unknown-source-term': 'the existing attempt has no valid semester',
          'unknown-target-term': 'the target semester is not valid',
          'source-term-not-completed': 'the existing attempt is in a future semester',
          'code-alias-requires-review': 'an older or renamed course code matches it and requires manual review',
          'unsupported-grade': 'the existing grade is not supported for automatic retake planning',
        };
        return `${code} cannot be moved into ${termName} because ${messages[reason] || 'its retake eligibility could not be confirmed'}.`;
      };

      let nextCourseId = Number(cur.course_id || 0);
      const seen = new Set();
      const rows = [];
      const retakes = [];
      const globalDefinitions = [];
      selectionSnapshot.forEach(({ raw, crn }) => {
        const entry = idx && idx.get ? idx.get(raw) : null;
        const section = entry && Array.isArray(entry.sections)
          ? entry.sections.find((candidate) => String(candidate && candidate.crn) === String(crn || ''))
          : null;
        if (!entry || !section) {
          throw new Error(`The selected section for ${raw} is no longer available. Re-pick it and try again.`);
        }
        // Component-only sections never belong in the planner. Filter them
        // before deciding which existing course occurrences must move.
        if (!isPlannerComponent(section)) return;
        const code = normalizePlannerCode(raw);
        if (!code || seen.has(code)) return;
        seen.add(code);

        const resolution = plannerCourseResolutionFromPage(code, entry, section);
        const info = resolution.info;
        const globalDefinition = resolution.catalogBacked
          ? null : plannerGlobalDefinition(code, info);
        if (globalDefinition) globalDefinitions.push(globalDefinition);
        const occurrences = retakePolicy && typeof retakePolicy.findCourseOccurrences === 'function'
          ? retakePolicy.findCourseOccurrences(cur, code) : [];
        // The planner has one legacy canonical alias (CS210/DSA210). It blocks
        // duplicates, but a renamed/different code is not an automatic
        // same-code retake under the university rules. Detect it before the
        // replacement commit's canonical filtering could silently remove it.
        const canonicalOccurrences = [];
        (Array.isArray(cur.semesters) ? cur.semesters : []).forEach((semester) => {
          (Array.isArray(semester && semester.courses) ? semester.courses : []).forEach((candidate) => {
            if (normalizePlannerCode(candidate && candidate.code) === code) {
              canonicalOccurrences.push({ semester, course: candidate });
            }
          });
        });
        if (canonicalOccurrences.length !== occurrences.length) {
          throw new Error(retakeFailureMessage(code, 'code-alias-requires-review'));
        }
        if (occurrences.length > 1) {
          throw new Error(retakeFailureMessage(code, 'multiple-existing-occurrences'));
        }

        const existing = occurrences.length ? occurrences[0] : null;
        const existingTermCode = existing && existing.termCode
          ? String(existing.termCode) : '';
        let course = null;
        let retake = null;

        if (existing && existingTermCode === String(termCode || '')) {
          // Replacing sections in the same planner semester is not a retake.
          course = existing.course;
        } else if (existing) {
          const rawGrade = String((existing.course && existing.course.grade) || '').trim().toUpperCase();
          if (!rawGrade || rawGrade === 'REGISTERED') {
            // Preserve the scheduler's established rescheduling behavior for an
            // ungraded placeholder. Completed/in-progress attempts are handled
            // only by the explicit retake policy below.
            course = existing.course;
          } else {
            if (!retakePolicy || typeof retakePolicy.classifyRetake !== 'function') {
              throw new Error(retakeFailureMessage(code, 'unsupported-grade'));
            }
            const classification = retakePolicy.classifyRetake(
              existing.semester,
              existing.course,
              { termCode },
            );
            if (!classification.eligible) {
              throw new Error(retakeFailureMessage(code, classification.reason));
            }
            nextCourseId += 1;
            course = new s_course(code, 'c' + nextCourseId);
            applyPlannerMetadata(course, info);
            retake = { code, occurrence: existing, classification };
            retakes.push(retake);
          }
        }

        let domCourse = course && course.id ? document.getElementById(course.id) : null;
        if (!course) {
          nextCourseId += 1;
          course = new s_course(code, 'c' + nextCourseId);
          applyPlannerMetadata(course, info);
        }
        if (!domCourse) domCourse = createPlannerCourseDom(course, info);
        // Keep preflight side-effect-free for reused live objects/DOM. Their
        // scheduler metadata is applied only after commit rollback is armed.
        rows.push({ code, course, domCourse, crn: String(crn || ''), retake, info });
      });
      return { rows, nextCourseId, retakes, globalDefinitions };
    };

    const commitPlannerReplacement = (prepared, cur) => {
      const rollback = capturePlannerRollback(cur);
      const storage = (typeof window !== 'undefined') ? window.planStorage : null;
      const hasGlobalDefinitions = Array.isArray(prepared.globalDefinitions)
        && prepared.globalDefinitions.length > 0;
      const planId = storage && typeof storage.getSessionPlanId === 'function'
        ? storage.getSessionPlanId() : null;
      let previousGlobalMetadataRaw = null;
      let nextGlobalMetadataRaw = null;
      let globalMetadataWritten = false;
      let loc = null;
      try {
        if (!storage || typeof storage.requestSave !== 'function'
            || typeof storage.flushSaves !== 'function') {
          throw new Error('Planner saving is unavailable.');
        }
        if (hasGlobalDefinitions) {
          if (typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function'
              || typeof storage.removeItem !== 'function') {
            throw new Error('External course metadata saving is unavailable.');
          }
          previousGlobalMetadataRaw = storage.getItem('globalCourseMetadata', planId || undefined);
          nextGlobalMetadataRaw = plannerGlobalMetadataSnapshot(
            previousGlobalMetadataRaw,
            prepared.globalDefinitions,
          );
        }

        loc = findPlannerSemester(termCode) || createPlannerSemester(termCode);
        if (!loc || !loc.container || !loc.semesterEl || !loc.semesterObj) {
          throw new Error(`The planner semester for ${termName} could not be prepared.`);
        }

        const desiredCodes = new Set(prepared.rows.map((row) => row.code));
        const desiredCourses = prepared.rows.map((row) => row.course);
        cur.course_id = prepared.nextCourseId;

        // Refresh reused stale placeholders only inside the transaction, after
        // capturePlannerRollback has snapshotted their previous model state.
        prepared.rows.forEach((row) => applyPlannerMetadata(row.course, row.info));

        // Apply every model mutation synchronously. Same-term and ungraded
        // rescheduled course objects are reused. Confirmed retakes use a fresh,
        // ungraded object so an earlier result is never carried into the repeat.
        (Array.isArray(cur.semesters) ? cur.semesters : []).forEach((semester) => {
          if (semester === loc.semesterObj) {
            semester.courses = desiredCourses.slice();
            return;
          }
          semester.courses = (Array.isArray(semester.courses) ? semester.courses : [])
            .filter((course) => !desiredCodes.has(normalizePlannerCode(course && course.code)));
        });
        prepared.rows.forEach((row) => {
          row.course.scheduler_crn = row.crn;
        });

        // Mirror the already-committed model in the DOM without any await gap.
        loc.semesterEl.querySelectorAll('.course').forEach((element) => element.remove());
        loc.container.querySelectorAll('.input_container').forEach((element) => element.remove());
        document.querySelectorAll('.container_semester .course').forEach((element) => {
          if (element.closest('.container_semester') === loc.container) return;
          const codeNode = element.querySelector('.course_code');
          const code = normalizePlannerCode(codeNode ? codeNode.textContent : '');
          if (desiredCodes.has(code)) element.remove();
        });
        prepared.rows.forEach((row) => loc.semesterEl.appendChild(row.domCourse));

        // Make scheduler-only university courses resolvable before allocation.
        // These internal rows remain excluded from Add Course and use unknown/N/A
        // classification until a program supplies an authoritative definition.
        prepared.globalDefinitions.forEach((definition) => {
          const code = normalizePlannerCode(String(definition.Major || '') + String(definition.Code || ''));
          const existingIndex = course_data.findIndex((record) => (
            normalizePlannerCode(String((record && record.Major) || '') + String((record && record.Code) || '')) === code
          ));
          if (existingIndex < 0) course_data.push(definition);
          else if (course_data[existingIndex] && course_data[existingIndex].__globalCourseDefinition) {
            course_data[existingIndex] = definition;
          }
        });

        if (typeof cur.recalcEffectiveTypes === 'function') cur.recalcEffectiveTypes(course_data);
        (Array.isArray(cur.semesters) ? cur.semesters : []).forEach((semester) => {
          recomputePlannerSemesterGpa(semester);
          const semesterEl = document.getElementById(semester.id);
          const container = semesterEl && semesterEl.closest
            ? semesterEl.closest('.container_semester') : null;
          refreshPlannerTotalsForContainer(container, semester);
        });
        if (typeof window !== 'undefined' && typeof window.updateCurrentTermHighlights === 'function') {
          window.updateCurrentTermHighlights();
        }

        if (nextGlobalMetadataRaw !== null) {
          if (storage.setItem('globalCourseMetadata', nextGlobalMetadataRaw, planId || undefined) === false) {
            throw new Error('External course metadata could not be saved.');
          }
          globalMetadataWritten = true;
        }
        if (storage.requestSave() === false || storage.flushSaves() === false) {
          throw new Error('The updated planner could not be saved.');
        }
        // No failure boundary remains after persistence succeeds. Updating
        // attached name/credit nodes here keeps failed commits and cancelled
        // preflights from leaking scheduler metadata into the visible plan.
        prepared.rows.forEach((row) => refreshPlannerCourseDomMetadata(row.domCourse, row.course, row.info));
        return loc;
      } catch (error) {
        try { rollback(); } catch (rollbackError) {
          try { console.error('Failed to roll back scheduler planner update:', rollbackError); } catch (_) {}
        }
        if (globalMetadataWritten) {
          try {
            if (previousGlobalMetadataRaw === null) {
              storage.removeItem('globalCourseMetadata', planId || undefined);
            } else {
              storage.setItem('globalCourseMetadata', previousGlobalMetadataRaw, planId || undefined);
            }
          } catch (metadataRollbackError) {
            try { console.error('Failed to roll back external course metadata:', metadataRollbackError); } catch (_) {}
          }
        }
        // A semester creation may have queued a save. Flush the restored model
        // so an autosave cannot later persist the failed intermediate state.
        try {
          const storage = (typeof window !== 'undefined') ? window.planStorage : null;
          if (storage && typeof storage.requestSave === 'function') storage.requestSave();
          if (storage && typeof storage.flushSaves === 'function') storage.flushSaves();
        } catch (_) {}
        throw error;
      }
    };

    let plannerUpdateInProgress = false;
    pickPlanBtn.addEventListener('click', async () => {
      if (plannerUpdateInProgress) return;
      const keys = Object.keys(selected);
      if (!keys.length) {
        if (ui && typeof ui.alert === 'function') ui.alert('Nothing selected', '<p>Select at least one section first.</p>');
        return;
      }
      plannerUpdateInProgress = true;
      pickPlanBtn.disabled = true;
      try {
        const selectionSnapshot = keys.map((raw) => ({
          raw,
          crn: selected[raw] && selected[raw].crn ? String(selected[raw].crn) : '',
        }));
        const ok = (ui && typeof ui.confirm === 'function')
          ? await ui.confirm(
              `Update ${termName}`,
              `<p>This will <strong>replace</strong> the courses in your planner semester for <strong>${escapeHtml(termName)}</strong> with the scheduler’s selected sections.</p>`,
              { confirmText: 'Replace', danger: true }
            )
          : true;
        if (!ok) return;

        // Complete every asynchronous load before the first planner mutation.
        const idx = scheduleIndex || await loadTermScheduleIndex(termCode);
        if (!idx) throw new Error(`Schedule data for ${termName} could not be loaded.`);
        scheduleIndex = idx;
        try {
          const loadInfo = (typeof window !== 'undefined') ? window.loadCoursePageInfoIndex : null;
          if (typeof loadInfo === 'function') coursePageInfoMap = await loadInfo();
        } catch (_) {
          // Planner catalog and schedule metadata remain valid fallbacks.
        }
        const cur = (typeof window !== 'undefined') ? window.curriculum : null;
        if (!cur || !Array.isArray(cur.semesters)) throw new Error('The planner is not ready yet.');
        const prepared = preparePlannerReplacement(selectionSnapshot, idx, cur);
        if (!prepared.rows.length) {
          throw new Error('Only lab or recitation sections are selected; there are no planner courses to add.');
        }
        if (prepared.retakes && prepared.retakes.length) {
          const items = prepared.retakes.map((item) => {
            const occurrence = item.occurrence || {};
            const source = occurrence.semester && (occurrence.semester.termName || occurrence.termCode)
              ? String(occurrence.semester.termName || occurrence.termCode) : 'an earlier semester';
            const grade = occurrence.course ? String(occurrence.course.grade || '') : '';
            return `<li><strong>${escapeHtml(item.code)}</strong> — ${escapeHtml(source)}, grade <strong>${escapeHtml(grade)}</strong></li>`;
          }).join('');
          const plannerImpact = '<p><strong>This temporarily removes each earlier attempt\'s credit, GPA, and prerequisite effect from the planner until a new result is entered.</strong></p>';
          const retakeOk = (ui && typeof ui.confirm === 'function')
            ? await ui.confirm(
                'Confirm planned retake',
                `<p>The scheduler selection repeats course(s) already recorded in an earlier semester:</p><ul>${items}</ul>`
                  + `<p>Continue by removing each earlier planner entry and adding a new ungraded attempt in <strong>${escapeHtml(termName)}</strong>?</p>`
                  + plannerImpact
                  + '<p>The university transcript retains all registrations; this is only a simplified planning view. The newest repeat grade can replace the earlier grade even when it is lower, and university rules do not allow withdrawal from a repeated course.</p>'
                  + '<p>SUrriculum cannot verify approved leave or first-offering/program exceptions; confirm the registration with your advisor or SUIS.</p>',
                { confirmText: 'Replace earlier entries', danger: true },
              )
            : false;
          if (!retakeOk) return;
        }
        // Establish a known-good persisted checkpoint immediately before the
        // synchronous commit. If current edits cannot be saved, leave both the
        // planner model and DOM completely untouched.
        const storage = (typeof window !== 'undefined') ? window.planStorage : null;
        if (!storage || typeof storage.requestSave !== 'function'
            || typeof storage.flushSaves !== 'function'
            || storage.requestSave() === false
            || storage.flushSaves() === false) {
          throw new Error('Your current planner changes could not be saved, so the update was cancelled.');
        }
        const loc = commitPlannerReplacement(prepared, cur);

        // Refresh scheduler planner-semester pills.
        try {
          const nextCourses = (loc.semesterObj && Array.isArray(loc.semesterObj.courses))
            ? loc.semesterObj.courses.map(x => normalizePlannerCode(x && x.code)).filter(Boolean)
            : [];
          plannedCourses.splice(0, plannedCourses.length, ...nextCourses);
          planListEl.innerHTML = plannedCourses.length
            ? plannedCourses.map(c => (
                `<button type="button" class="scheduler-pill scheduler-plan-pick" data-course="${escapeHtml(c)}" title="Pick a section" aria-label="Pick a section for ${escapeHtml(c)}">${escapeHtml(c)}</button>`
              )).join('')
            : `<div class="scheduler-muted">No courses in your planner semester for <strong>${escapeHtml(termName)}</strong> yet.</div>`;
        } catch (_) {}

        // Re-render results/grid (hide-taken & sorting can depend on plan state).
        try {
          if (scheduleIndex) renderResults(scheduleIndex, lastQuery);
          if (scheduleIndex) renderGrid(scheduleIndex);
        } catch (_) {}
      } catch (error) {
        if (ui && typeof ui.alert === 'function') {
          const message = error && error.message ? error.message : 'The planner was left unchanged.';
          ui.alert('Update failed', `<p>${escapeHtml(message)}</p><p>Your previous planner courses were kept.</p>`);
        }
      } finally {
        plannerUpdateInProgress = false;
        pickPlanBtn.disabled = false;
      }
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
      const toggleSections = e.target && e.target.closest ? e.target.closest('.scheduler-sections-toggle') : null;
      if (toggleSections) {
        const courseId = normalizeCourseId(toggleSections.getAttribute('data-course') || '');
        if (!courseId) return;
        if (expandedResultSections.has(courseId)) expandedResultSections.delete(courseId);
        else expandedResultSections.add(courseId);
        try {
          const idx = scheduleIndex || await loadTermScheduleIndex(termCode);
          if (idx) {
            scheduleIndex = idx;
            renderResults(idx, lastQuery);
          }
        } catch (_) {}
        return;
      }
      const sectionPick = e.target && e.target.closest ? e.target.closest('.scheduler-section-pick') : null;
      if (sectionPick) {
        const courseId = normalizeCourseId(sectionPick.getAttribute('data-course') || '');
        const crn = String(sectionPick.getAttribute('data-crn') || '').trim();
        if (!courseId || !crn) return;
        const idx = await loadTermScheduleIndex(termCode);
        if (!idx) return;
        scheduleIndex = idx;
        await pickSpecificSection(idx, courseId, crn);
        return;
      }
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
    onSharedHideTakenChange = () => {
      if (!hideTakenToggle || typeof window.hideTakenCourses !== 'boolean') return;
      const enabled = !!window.hideTakenCourses;
      if (hideTakenToggle.checked === enabled) return;
      hideTakenToggle.checked = enabled;
      try { if (scheduleIndex) renderResults(scheduleIndex, lastQuery); } catch (_) {}
    };
    onSharedDetailsChange = () => {
      if (!detailsToggle || typeof window.showCourseDetails !== 'boolean') return;
      const enabled = !!window.showCourseDetails;
      if (detailsToggle.checked === enabled) return;
      detailsToggle.checked = enabled;
      try {
        renderSelected();
        if (scheduleIndex) renderResults(scheduleIndex, lastQuery);
      } catch (_) {}
    };
    onSharedSortChange = () => {
      if (!scoreToggle || typeof window.sortBasedOnScore !== 'boolean') return;
      const enabled = !!window.sortBasedOnScore;
      if (scoreToggle.checked === enabled) return;
      scoreToggle.checked = enabled;
      try { if (scheduleIndex) renderResults(scheduleIndex, lastQuery); } catch (_) {}
    };
    document.addEventListener('hideTakenCoursesToggleChanged', onSharedHideTakenChange);
    document.addEventListener('courseDetailsToggleChanged', onSharedDetailsChange);
    document.addEventListener('sortByScoreToggleChanged', onSharedSortChange);
    if (hoverPreviewToggle) {
      hoverPreviewToggle.addEventListener('change', () => {
        const enabled = !!hoverPreviewToggle.checked;
        preferenceSetItem('schedulerHoverPreview', enabled ? 'true' : 'false');
        hoverSelectedCourseId = '';
        hoverResultCourseId = '';
        clearPreviewBlocks();
        clearHoverHighlights();
      });
    }
    if (highlightToggle) {
      highlightToggle.addEventListener('change', () => {
        const enabled = !!highlightToggle.checked;
        preferenceSetItem('schedulerHighlightAvailability', enabled ? 'true' : 'false');
        try { if (scheduleIndex) renderResults(scheduleIndex, lastQuery); } catch (_) {}
      });
    }
    if (showBlockedToggle) {
      showBlockedToggle.addEventListener('change', () => {
        const enabled = !!showBlockedToggle.checked;
        preferenceSetItem('schedulerShowBlockedCourses', enabled ? 'true' : 'false');
        try { if (scheduleIndex) renderResults(scheduleIndex, lastQuery); } catch (_) {}
      });
    }
    const rerenderResultsSafe = () => {
      try { if (scheduleIndex) renderResults(scheduleIndex, lastQuery); } catch (_) {}
    };
    const onMinTypeChange = (key, el) => {
      if (!el) return;
      el.addEventListener('change', () => {
        preferenceSetItem(key, String(el.value || ''));
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
        preferenceSetItem(key, String(el.value || ''));
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
        preferenceSetItem('schedulerCheckPrereqs', enabled ? 'true' : 'false');
        syncPrereqUi();
        rerenderResultsSafe();
      });
    }
    if (showUnmetPrereqToggle) {
      showUnmetPrereqToggle.addEventListener('change', () => {
        const enabled = !!showUnmetPrereqToggle.checked;
        preferenceSetItem('schedulerShowUnmetPrereqs', enabled ? 'true' : 'false');
        rerenderResultsSafe();
      });
    }

    // Multiple schedules (within the current term, per saved plan).
    const newScheduleId = () => `sched_${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`;
    const normalizeScheduleName = (value) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, 200);
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
            name: copy ? normalizeScheduleName(`${String(active && active.name ? active.name : 'Schedule')} (copy)`) : 'New schedule',
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
          const name = (promptRes && promptRes.action === 'ok')
            ? normalizeScheduleName(promptRes.value)
            : '';
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

    // Touch devices use an explicit preview request because they have no hover.
    // Keep that interaction independent from the desktop hover-preview setting:
    // disabling mouse hover must not leave mobile's visible Preview action inert.
    modal.addEventListener('schedulerpreviewrequest', (e) => {
      try {
        const detail = e && e.detail ? e.detail : {};
        const courseId = normalizeCourseId(detail.courseId || '');
        const crn = String(detail.crn || '').trim();
        if (!scheduleIndex || !courseId) return;
        const entry = scheduleIndex.get(courseId);
        const section = crn && entry && Array.isArray(entry.sections)
          ? (entry.sections.find(sec => String(sec && sec.crn ? sec.crn : '') === crn) || null)
          : null;
        if (crn && !section) return;
        renderPreviewForCourse(scheduleIndex, courseId, section, { ignoreHoverPreference: true });
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
            const entry = scheduleIndex ? scheduleIndex.get(courseId) : null;
            const section = entry && Array.isArray(entry.sections)
              ? (entry.sections.find(sec => String(sec && sec.crn ? sec.crn : '') === crn) || null)
              : null;
            if (scheduleIndex && section) renderPreviewForCourse(scheduleIndex, courseId, section);
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
