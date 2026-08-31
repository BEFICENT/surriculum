// Shared Scheduler browser, data, dialog, and persistence primitives.
// Loaded as a classic deferred script so local file:// use remains supported.
(function (root) {
  'use strict';

  const schedulerDialogs = (root && root.SurriculumSchedulerDialogs)
    || (typeof module !== 'undefined' && module.exports ? require('./dialogs.js') : null);
  const schedulerStorage = (root && root.SurriculumSchedulerStorage)
    || (typeof module !== 'undefined' && module.exports ? require('./storage.js') : null);
  const schedulerMeetingModel = (root && root.SurriculumSchedulerMeetingModel)
    || (typeof module !== 'undefined' && module.exports ? require('./meeting-model.js') : null);
  if (!schedulerDialogs || !schedulerStorage || !schedulerMeetingModel) {
    throw new Error('Scheduler foundation dependencies are not loaded.');
  }
  const {
    nextSchedulerDialogId,
    activateSchedulerDialog,
    activateSchedulerEdgeBlur,
    createPickerModal,
    createInfoModal,
    createTextInputModal,
  } = schedulerDialogs;
  const {
    planGetItem,
    planSetItem,
    preferenceGetItem,
    preferenceSetItem,
    saveSchedulerState,
    loadSchedulerState,
  } = schedulerStorage;
  const { createMeetingModelTools: createMeetingModelToolsBase } = schedulerMeetingModel;

  function createMeetingModelTools(options) {
    return createMeetingModelToolsBase(Object.assign({}, options || {}, {
      parseDaysToKeys,
      parseTimeRangeToMinutes,
    }));
  }


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

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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

  function schedulerUsesFileProtocol() {
    try {
      return typeof location !== 'undefined' && location && location.protocol === 'file:';
    } catch (_) {
      return false;
    }
  }

  function readSchedulerTextWithXhr(path) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      try {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', path, true);
        xhr.overrideMimeType('application/json');
        xhr.onload = () => {
          if (xhr.status === 200 || xhr.status === 0) {
            finish(String(xhr.responseText || ''));
            return;
          }
          finish(null);
        };
        xhr.onerror = () => finish(null);
        xhr.onabort = () => finish(null);
        xhr.send(null);
      } catch (_) {
        finish(null);
      }
    });
  }

  // HTTP deployments use fetch directly. Local file:// copies use an async
  // XHR first because browsers commonly reject file fetches; status 0 remains
  // a successful local-file response, without blocking the main thread.
  async function readSchedulerText(path) {
    const tryFetch = async () => {
      try {
        const response = await fetch(path);
        if (response.ok) return await response.text();
      } catch (_) {}
      return null;
    };

    if (schedulerUsesFileProtocol()) {
      const localText = await readSchedulerTextWithXhr(path);
      if (localText !== null) return localText;
      const fetchedText = await tryFetch();
      return fetchedText === null ? '' : fetchedText;
    }

    const fetchedText = await tryFetch();
    if (fetchedText !== null) return fetchedText;
    const xhrText = await readSchedulerTextWithXhr(path);
    return xhrText === null ? '' : xhrText;
  }

  async function loadSchedulerTermManifest() {
    try {
      if (window.__schedulerTermManifestPromise) return window.__schedulerTermManifestPromise;
    } catch (_) {}

    const promise = (async () => {
      const text = await readSchedulerText(SCHEDULER_TERM_MANIFEST_PATH);
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

    const promise = (async () => {
      const candidates = [
        `./courses/schedule/${tc}.jsonl`,
        `./courses/schedule_${tc}.jsonl`,
      ];
      let text = '';
      for (let i = 0; i < candidates.length && !text; i++) {
        text = await readSchedulerText(candidates[i]);
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





  const api = Object.freeze({
    DAYS,
    DAY_START_MIN,
    DAY_END_MIN,
    nextSchedulerDialogId,
    activateSchedulerDialog,
    activateSchedulerEdgeBlur,
    escapeHtml,
    planGetItem,
    planSetItem,
    preferenceGetItem,
    preferenceSetItem,
    termNameToCodeSafe,
    getCurrentTermNameSafe,
    getCurrentTermCodeSafe,
    displayTermNameSafe,
    schedulerUsesFileProtocol,
    readSchedulerTextWithXhr,
    readSchedulerText,
    loadSchedulerTermManifest,
    getAvailableSchedulerTerms,
    resolveSchedulerTermCode,
    hasSeenFutureTermWarning,
    markFutureTermWarningSeen,
    maybeWarnFutureSchedulerTerm,
    getSavedSchedulerSelectedTerm,
    setSavedSchedulerSelectedTerm,
    normalizeCourseId,
    parseDaysToKeys,
    parseClockToMinutes,
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
    createMeetingModelTools,
  });

  if (root) root.SurriculumSchedulerFoundation = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
