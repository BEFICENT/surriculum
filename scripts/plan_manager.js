// plan_manager.js
// Adds multi-plan support by namespacing localStorage keys under an active plan.

(function () {
  const INDEX_KEY = 'surriculum.plans.v1';
  const MIGRATED_KEY = 'surriculum.plans.migrated.v1';
  const PLAN_PREFIX = 'surriculum.plan.';
  // Storage-schema version: bumped when the SHAPE of what we persist to
  // localStorage changes, to drive plan-storage migrations. Distinct from the
  // DATA version (data/manifest.json — the scrape bundle) and the APP version
  // (version.js — code/UI). Was misleadingly named APP_DATA_VERSION. The
  // persisted key STRING is kept as-is so existing installs aren't mistaken for
  // a fresh run.
  const STORAGE_SCHEMA_VERSION = 3;
  const STORAGE_SCHEMA_KEY = 'surriculum.appDataVersion';
  const MAX_PLANS = 10;
  const DEFAULT_PLAN_NAME = 'Default Plan';
  const PLAN_EXPORT_VERSION = 3;
  const LEGACY_KEYS = [
    'major', 'doubleMajor',
    'entryTerm', 'entryTermDM',
    // Minor terms: `entryTermMinor` is legacy (single term); keep for migration.
    'entryTermMinor', 'entryTermMinor1', 'entryTermMinor2', 'entryTermMinor3',
    'minor1', 'minor2', 'minor3',
    'curriculum', 'grades', 'gradingBases', 'dates'
  ];
  const APP_GLOBAL_STORAGE_KEYS = new Set([
    ...LEGACY_KEYS,
    'schedulerSelectedTerm',
    'theme',
    'showCourseDetails',
    'hideTakenCourses',
    'offeredThisTermOnly',
    'sortBasedOnScore',
    'showDoubleMajorControls',
    'showMinorControls',
    'mobileNoticeDismissed',
    'schedulerHoverPreview',
    'schedulerHighlightAvailability',
    'schedulerShowBlockedCourses',
    'schedulerMinMajorType',
    'schedulerMinDmType',
    'schedulerMinMinorType',
    'schedulerMinSuCredits',
    'schedulerMinEcts',
    'schedulerMinBasicScience',
    'schedulerMinEngineering',
    'schedulerCheckPrereqs',
    'schedulerShowUnmetPrereqs',
    'globalCourseMetadata',
  ]);
  const APP_LEGACY_STORAGE_PATTERNS = [
    /^customCourses_[A-Z][A-Z0-9-]{0,19}$/,
    /^schedulerState_\d{6}$/,
    /^dmCustomCoursesCreditsRepairShown_[A-Z][A-Z0-9-]{0,19}$/,
  ];

  function createModal({ title, bodyHtml, input, buttons, onMount }) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');

      const modal = document.createElement('div');
      modal.className = 'modal app-modal';
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
      const cleanupAndResolve = (payload) => {
        try { document.removeEventListener('keydown', onKeyDown); } catch (_) {}
        try { overlay.remove(); } catch (_) {}
        resolve(payload);
      };
      close.addEventListener('click', () => cleanupAndResolve({ action: 'close', value: null }));

      header.appendChild(h);
      header.appendChild(close);

      const body = document.createElement('div');
      body.className = 'app-modal-body';
      body.innerHTML = bodyHtml || '';

      let inputEl = null;
      if (input) {
        inputEl = document.createElement('input');
        inputEl.className = 'app-modal-input';
        inputEl.type = 'text';
        inputEl.value = input.value || '';
        inputEl.placeholder = input.placeholder || '';
        body.appendChild(inputEl);
      }

      const footer = document.createElement('div');
      footer.className = 'app-modal-footer';

      const btns = Array.isArray(buttons) && buttons.length
        ? buttons
        : [{ action: 'ok', label: 'OK', variant: 'primary' }];

      btns.forEach((b) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        const variant = b.variant || (b.action === 'cancel' ? 'secondary' : 'primary');
        btn.className = `btn btn-${variant} btn-sm`;
        btn.textContent = b.label || b.action;
        if (b.danger) btn.style.backgroundColor = '#DC2626';
        btn.addEventListener('click', () => {
          try {
            if (typeof b.onClick === 'function') b.onClick({ overlay, modal, body, button: btn });
          } catch (_) {}
          if (b.href) {
            try {
              window.open(String(b.href), b.target || '_blank', b.features || 'noopener');
            } catch (_) {}
          }
          if (b.closeOnClick === false) return;
          const val = inputEl ? inputEl.value : null;
          cleanupAndResolve({ action: b.action, value: val });
        });
        footer.appendChild(btn);
      });

      modal.appendChild(header);
      modal.appendChild(body);
      modal.appendChild(footer);
      overlay.appendChild(modal);

      overlay.addEventListener('click', () => {
        cleanupAndResolve({ action: 'cancel', value: null });
      });

      // If the user is currently in browser fullscreen (e.g., the scheduler),
      // DOM elements outside the fullscreen element may appear behind it.
      // Attach modals to the fullscreen root so they always render on top.
      const root = document.fullscreenElement || document.body;
      root.appendChild(overlay);

      try {
        if (typeof onMount === 'function') onMount({ overlay, modal, body, close });
      } catch (_) {}

      setTimeout(() => {
        try {
          if (modal) modal.scrollTop = 0;
          if (body) body.scrollTop = 0;
          if (inputEl) {
            inputEl.focus({ preventScroll: true });
            inputEl.select();
          } else {
            close.focus({ preventScroll: true });
          }
        } catch (_) {}
      }, 0);

      const onKeyDown = (e) => {
        if (e.key === 'Escape') {
          cleanupAndResolve({ action: 'cancel', value: null });
        }
        if (e.key === 'Enter' && inputEl) {
          const primary = footer.querySelector('.btn-primary');
          if (primary) primary.click();
        }
      };
      document.addEventListener('keydown', onKeyDown, { once: false });
    });
  }

  const uiModal = {
    alert(title, bodyHtml, options) {
      const opts = options || {};
      return createModal({
        title,
        bodyHtml,
        onMount: opts.onMount,
        buttons: Array.isArray(opts.buttons) && opts.buttons.length
          ? opts.buttons
          : [{ action: 'ok', label: 'OK', variant: 'primary' }],
      });
    },
    async confirm(title, bodyHtml, options) {
      const opts = options || {};
      const res = await createModal({
        title,
        bodyHtml,
        buttons: [
          { action: 'cancel', label: opts.cancelText || 'Cancel', variant: 'secondary' },
          { action: 'confirm', label: opts.confirmText || 'Confirm', variant: 'primary', danger: !!opts.danger },
        ],
      });
      return res.action === 'confirm';
    },
    async prompt(title, bodyHtml, options) {
      const opts = options || {};
      const res = await createModal({
        title,
        bodyHtml,
        input: { value: opts.value || '', placeholder: opts.placeholder || '' },
        buttons: [
          { action: 'cancel', label: opts.cancelText || 'Cancel', variant: 'secondary' },
          { action: 'confirm', label: opts.confirmText || 'Save', variant: 'primary' },
        ],
      });
      if (res.action !== 'confirm') return null;
      return res.value;
    },
  };

  function nowIso() {
    return new Date().toISOString();
  }

  function safeJsonParse(value, fallback) {
    try {
      return JSON.parse(value);
    } catch (_) {
      return fallback;
    }
  }

  function initStorageSchemaVersion() {
    let storedBefore = 0;
    try {
      const raw = localStorage.getItem(STORAGE_SCHEMA_KEY);
      const parsed = parseInt(String(raw || '0'), 10);
      storedBefore = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    } catch (_) {}

    try {
      localStorage.setItem(STORAGE_SCHEMA_KEY, String(STORAGE_SCHEMA_VERSION));
    } catch (_) {}

    const info = {
      current: STORAGE_SCHEMA_VERSION,
      storedBefore,
      firstRunAfterUpgrade: storedBefore > 0 && storedBefore < STORAGE_SCHEMA_VERSION,
      firstRunEver: storedBefore <= 0,
    };

    const api = {
      getCurrentSchemaVersion() {
        return STORAGE_SCHEMA_VERSION;
      },
      getStoredSchemaVersion() {
        try {
          const raw = localStorage.getItem(STORAGE_SCHEMA_KEY);
          const parsed = parseInt(String(raw || '0'), 10);
          return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
        } catch (_) {
          return 0;
        }
      },
      getPreviousSchemaVersion() {
        return storedBefore;
      },
      isFirstRunAfterUpgrade() {
        return info.firstRunAfterUpgrade;
      },
      markCurrentSchemaVersionSeen() {
        try { localStorage.setItem(STORAGE_SCHEMA_KEY, String(STORAGE_SCHEMA_VERSION)); } catch (_) {}
      },
    };

    try {
      window.STORAGE_SCHEMA_VERSION = STORAGE_SCHEMA_VERSION;
      window.storageSchemaInfo = info;
      window.storageSchema = api;
    } catch (_) {}
  }

  function loadIndex() {
    const raw = localStorage.getItem(INDEX_KEY);
    const parsed = safeJsonParse(raw, null);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!Array.isArray(parsed.plans)) return null;
    return parsed;
  }

  function saveIndex(idx) {
    localStorage.setItem(INDEX_KEY, JSON.stringify(idx));
  }

  function createId() {
    return 'p_' + Math.random().toString(36).slice(2, 10);
  }

  function ensureIndex() {
    let idx = loadIndex();
    if (!idx) {
      const id = createId();
      idx = {
        version: 1,
        activeId: id,
        plans: [{ id, name: DEFAULT_PLAN_NAME, createdAt: nowIso(), updatedAt: nowIso() }],
      };
      saveIndex(idx);
      return idx;
    }
    if (!idx.activeId || !idx.plans.some(p => p && p.id === idx.activeId)) {
      idx.activeId = idx.plans[0]?.id || null;
    }
    if (!idx.activeId) {
      const id = createId();
      idx.activeId = id;
      idx.plans = [{ id, name: DEFAULT_PLAN_NAME, createdAt: nowIso(), updatedAt: nowIso() }];
    }
    if (idx.plans.length === 0) {
      const id = createId();
      idx.activeId = id;
      idx.plans.push({ id, name: DEFAULT_PLAN_NAME, createdAt: nowIso(), updatedAt: nowIso() });
    }
    saveIndex(idx);
    return idx;
  }

  function planKey(planId, key) {
    return PLAN_PREFIX + planId + '.' + key;
  }

  function touchUpdated(planId) {
    const idx = ensureIndex();
    const p = idx.plans.find(x => x.id === planId);
    if (p) {
      p.updatedAt = nowIso();
      saveIndex(idx);
    }
  }

  function getActivePlanId() {
    return ensureIndex().activeId;
  }

  function getPlanMeta(id) {
    const idx = ensureIndex();
    return idx.plans.find(p => p.id === id) || null;
  }

  function listLocalStorageKeys() {
    const keys = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k) keys.push(k);
      }
    } catch (_) {}
    return keys;
  }

  function isAppOwnedStorageKey(key) {
    const value = String(key || '');
    if (!value) return false;
    if (value.startsWith('surriculum.')) return true;
    if (APP_GLOBAL_STORAGE_KEYS.has(value)) return true;
    return APP_LEGACY_STORAGE_PATTERNS.some((pattern) => pattern.test(value));
  }

  function clearAllAppData() {
    const ownedKeys = listLocalStorageKeys().filter(isAppOwnedStorageKey);
    const failedKeys = [];
    ownedKeys.forEach((key) => {
      try {
        localStorage.removeItem(key);
      } catch (_) {
        failedKeys.push(key);
      }
    });
    if (failedKeys.length) {
      throw new Error(`Could not remove ${failedKeys.length} SUrriculum storage item(s).`);
    }
    return ownedKeys;
  }

  function migrateLegacyIfNeeded() {
    if (localStorage.getItem(MIGRATED_KEY)) return;
    const idx = ensureIndex();
    const pid = idx.activeId;

    let didAnything = false;

    // Basic legacy keys
    for (const k of LEGACY_KEYS) {
      const legacy = localStorage.getItem(k);
      const destKey = planKey(pid, k);
      if (legacy != null && localStorage.getItem(destKey) == null) {
        localStorage.setItem(destKey, legacy);
        didAnything = true;
      }
    }

    // Derive per-minor admit terms from the legacy single term if needed.
    try {
      const legacy = localStorage.getItem(planKey(pid, 'entryTermMinor')) || localStorage.getItem('entryTermMinor');
      if (legacy) {
        const k1 = planKey(pid, 'entryTermMinor1');
        const k2 = planKey(pid, 'entryTermMinor2');
        const k3 = planKey(pid, 'entryTermMinor3');
        if (localStorage.getItem(k1) == null) { localStorage.setItem(k1, legacy); didAnything = true; }
        if (localStorage.getItem(k2) == null) { localStorage.setItem(k2, legacy); didAnything = true; }
        if (localStorage.getItem(k3) == null) { localStorage.setItem(k3, legacy); didAnything = true; }
      }
    } catch (_) {}

    // Legacy custom courses (customCourses_<major>)
    const keys = listLocalStorageKeys();
    for (const k of keys) {
      if (!k.startsWith('customCourses_')) continue;
      const destKey = planKey(pid, k);
      if (localStorage.getItem(destKey) == null) {
        const val = localStorage.getItem(k);
        if (val != null) {
          localStorage.setItem(destKey, val);
          didAnything = true;
        }
      }
    }

    localStorage.setItem(MIGRATED_KEY, didAnything ? nowIso() : 'noop');
  }

  const saveHooks = [];

  function normalizePlanName(name) {
    const trimmed = String(name || '').trim().replace(/\s+/g, ' ');
    if (!trimmed) return null;
    return trimmed.slice(0, 60);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  const IMPORT_MAX_FILE_BYTES = 2 * 1024 * 1024;
  const IMPORT_MAX_SEMESTERS = 80;
  const IMPORT_MAX_COURSES_PER_SEMESTER = 100;
  const IMPORT_MAX_CUSTOM_COURSES = 2000;
  const IMPORT_MAX_SCHEDULER_TERMS = 40;
  const IMPORT_MAX_SELECTED_SECTIONS = 200;
  const IMPORT_MAX_BLOCKED_RANGES = 100;
  const IMPORT_MAX_SCHEDULES_PER_TERM = 10;
  const IMPORT_MAX_SCHEDULE_NAME_LENGTH = 200;
  const IMPORT_MAX_SNAPSHOT_TEXT_LENGTH = 4000;
  const IMPORT_MAX_GLOBAL_COURSE_METADATA = 2000;
  const IMPORT_COURSE_TYPES = new Set(['core', 'area', 'university', 'free', 'required', 'none']);
  const IMPORT_FACULTIES = new Set(['', 'FENS', 'FASS', 'SBS', 'SL']);
  const IMPORT_GRADES = new Set(['', 'S', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'F', 'T', 'P', 'I', 'U', 'W', 'NA']);
  const IMPORT_GRADING_BASES = new Set(['unknown', 'letter', 'satisfactory']);
  const IMPORT_STATE_FIELDS = new Set([
    'major', 'doubleMajor',
    'entryTerm', 'entryTermDM',
    'entryTermMinor', 'entryTermMinor1', 'entryTermMinor2', 'entryTermMinor3',
    'minor1', 'minor2', 'minor3',
    'schedulerSelectedTerm',
    'curriculum', 'grades', 'gradingBases', 'dates', 'customCourses', 'schedulerStates',
    'globalCourseMetadata',
  ]);

  function importError(path, message) {
    throw new Error(`Invalid plan data at ${path}: ${message}.`);
  }

  function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  }

  function requirePlainObject(value, path) {
    if (!isPlainObject(value)) importError(path, 'expected an object');
    return value;
  }

  function requireKnownFields(value, allowed, path) {
    Object.keys(value).forEach((key) => {
      if (!allowed.has(key)) importError(path, `unknown field "${String(key).slice(0, 80)}"`);
    });
  }

  function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
  }

  function normalizeImportedText(value, path, options) {
    const opts = options || {};
    if (typeof value !== 'string') importError(path, 'expected text');
    if (/\u0000|[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) {
      importError(path, 'contains unsupported control characters');
    }
    let normalized = opts.collapseWhitespace ? value.trim().replace(/\s+/g, ' ') : value.trim();
    const maxLength = Number.isInteger(opts.maxLength) ? opts.maxLength : 120;
    if (!opts.allowEmpty && !normalized) importError(path, 'must not be empty');
    if (normalized.length > maxLength) {
      if (opts.truncate) normalized = normalized.slice(0, maxLength);
      else importError(path, `must be at most ${maxLength} characters`);
    }
    return normalized;
  }

  function normalizeProgramCode(value, path) {
    const normalized = normalizeImportedText(value, path, { maxLength: 16 }).toUpperCase();
    if (!/^[A-Z][A-Z0-9]{1,15}$/.test(normalized)) importError(path, 'has an invalid program code');
    return normalized;
  }

  function normalizeMinorCode(value, path) {
    const normalized = normalizeImportedText(value, path, { maxLength: 48 }).toUpperCase();
    if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(normalized)) importError(path, 'has an invalid minor code');
    return normalized;
  }

  function normalizeCourseCode(value, path) {
    if (typeof value !== 'string') importError(path, 'expected a course code');
    const normalized = value.toUpperCase().replace(/\s+/g, '');
    if (!/^[A-Z]{1,12}\d{1,6}[A-Z0-9]{0,3}$/.test(normalized)) importError(path, 'has an invalid course code');
    return normalized;
  }

  function normalizeTermName(value, path) {
    const normalized = normalizeImportedText(value, path, { maxLength: 32, collapseWhitespace: true });
    if (!/^(Fall|Spring|Summer) \d{4}-\d{4}$/.test(normalized)) importError(path, 'has an invalid academic term');
    return normalized;
  }

  function normalizeTermCode(value, path) {
    const normalized = normalizeImportedText(value, path, { maxLength: 6 });
    if (!/^\d{6}$/.test(normalized)) importError(path, 'has an invalid term code');
    return normalized;
  }

  function normalizeFiniteNumber(value, path, maxValue) {
    let raw = value;
    if (typeof raw === 'string') {
      raw = raw.trim().replace(',', '.');
      if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw)) importError(path, 'expected a non-negative number');
    } else if (typeof raw !== 'number') {
      importError(path, 'expected a non-negative number');
    }
    const number = Number(raw);
    if (!Number.isFinite(number) || number < 0 || number > maxValue) {
      importError(path, `must be between 0 and ${maxValue}`);
    }
    return Object.is(number, -0) ? 0 : number;
  }

  function normalizeIsoTimestamp(value, path) {
    if (value === null) return null;
    const normalized = normalizeImportedText(value, path, { maxLength: 40 });
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(normalized)
        || !Number.isFinite(Date.parse(normalized))) {
      importError(path, 'has an invalid timestamp');
    }
    return normalized;
  }

  function validateCurriculum(value, path) {
    if (value === null) return null;
    if (!Array.isArray(value)) importError(path, 'expected an array of semesters');
    if (value.length > IMPORT_MAX_SEMESTERS) importError(path, `supports at most ${IMPORT_MAX_SEMESTERS} semesters`);
    let totalCourses = 0;
    return value.map((semester, semesterIndex) => {
      const semesterPath = `${path}[${semesterIndex}]`;
      if (!Array.isArray(semester)) importError(semesterPath, 'expected an array of course codes');
      if (semester.length > IMPORT_MAX_COURSES_PER_SEMESTER) {
        importError(semesterPath, `supports at most ${IMPORT_MAX_COURSES_PER_SEMESTER} courses`);
      }
      totalCourses += semester.length;
      if (totalCourses > IMPORT_MAX_CUSTOM_COURSES) importError(path, 'contains too many courses');
      return semester.map((courseCode, courseIndex) => normalizeCourseCode(courseCode, `${semesterPath}[${courseIndex}]`));
    });
  }

  function validateGrades(value, curriculum, path) {
    if (value === null) return null;
    if (!Array.isArray(value)) importError(path, 'expected an array of semesters');
    if (!Array.isArray(curriculum)) {
      if (value.length === 0) return [];
      importError(path, 'requires curriculum data');
    }
    if (value.length !== curriculum.length) importError(path, 'must have one entry per curriculum semester');
    return value.map((semester, semesterIndex) => {
      const semesterPath = `${path}[${semesterIndex}]`;
      if (!Array.isArray(semester)) importError(semesterPath, 'expected an array of grades');
      if (semester.length !== curriculum[semesterIndex].length) {
        importError(semesterPath, 'must have one grade per course');
      }
      return semester.map((grade, gradeIndex) => {
        if (typeof grade !== 'string') importError(`${semesterPath}[${gradeIndex}]`, 'expected a grade');
        const policy = (typeof window !== 'undefined' && window.gradePolicy) ? window.gradePolicy : null;
        let normalized = policy && typeof policy.normalizeGrade === 'function'
          ? policy.normalizeGrade(grade)
          : grade.trim().toUpperCase();
        if (!policy && normalized === 'REGISTERED') normalized = '';
        if (normalized === null || !IMPORT_GRADES.has(normalized)) {
          importError(`${semesterPath}[${gradeIndex}]`, 'has an unsupported grade');
        }
        return normalized;
      });
    });
  }

  function validateGradingBases(value, curriculum, path) {
    if (value === null) return null;
    if (!Array.isArray(value)) importError(path, 'expected an array of semesters');
    if (!Array.isArray(curriculum)) {
      if (value.length === 0) return [];
      importError(path, 'requires curriculum data');
    }
    if (value.length !== curriculum.length) importError(path, 'must have one entry per curriculum semester');
    return value.map((semester, semesterIndex) => {
      const semesterPath = `${path}[${semesterIndex}]`;
      if (!Array.isArray(semester)) importError(semesterPath, 'expected an array of grading bases');
      if (semester.length !== curriculum[semesterIndex].length) {
        importError(semesterPath, 'must have one grading basis per course');
      }
      return semester.map((basis, basisIndex) => {
        if (typeof basis !== 'string') importError(`${semesterPath}[${basisIndex}]`, 'expected a grading basis');
        const raw = basis.trim().toLowerCase() || 'unknown';
        if (!IMPORT_GRADING_BASES.has(raw)) {
          importError(`${semesterPath}[${basisIndex}]`, 'has an unsupported grading basis');
        }
        const policy = (typeof window !== 'undefined' && window.gradePolicy) ? window.gradePolicy : null;
        const normalized = policy && typeof policy.normalizeGradingBasis === 'function'
          ? policy.normalizeGradingBasis(raw)
          : raw;
        return normalized;
      });
    });
  }

  function inferImportedGradingBasis(grade, explicitBasis) {
    const policy = (typeof window !== 'undefined' && window.gradePolicy) ? window.gradePolicy : null;
    if (policy && typeof policy.inferGradingBasis === 'function') {
      return policy.inferGradingBasis(grade, explicitBasis);
    }
    const normalized = String(grade || '').trim().toUpperCase();
    if (/^(?:A|A-|B\+|B|B-|C\+|C|C-|D\+|D|F)$/.test(normalized)) return 'letter';
    if (normalized === 'S' || normalized === 'U') return 'satisfactory';
    const basis = String(explicitBasis || '').trim().toLowerCase();
    if (basis === 'letter' || basis === 'satisfactory') return basis;
    return 'unknown';
  }

  function canonicalizeGradingBases(curriculum, grades, gradingBases) {
    if (!Array.isArray(curriculum)) return null;
    return curriculum.map((semester, semesterIndex) =>
      semester.map((_, courseIndex) => {
        const grade = Array.isArray(grades) && Array.isArray(grades[semesterIndex])
          ? grades[semesterIndex][courseIndex] : '';
        const explicitBasis = Array.isArray(gradingBases)
          && Array.isArray(gradingBases[semesterIndex])
          ? gradingBases[semesterIndex][courseIndex] : 'unknown';
        return inferImportedGradingBasis(grade, explicitBasis);
      }));
  }

  function synthesizeGradingBases(curriculum, grades) {
    return canonicalizeGradingBases(curriculum, grades, null);
  }

  function validateDates(value, curriculum, path) {
    if (value === null) return null;
    if (!Array.isArray(value)) importError(path, 'expected an array of semester labels');
    if (!Array.isArray(curriculum)) {
      if (value.length === 0) return [];
      importError(path, 'requires curriculum data');
    }
    if (value.length !== curriculum.length) importError(path, 'must have one label per curriculum semester');
    return value.map((label, index) => normalizeImportedText(label, `${path}[${index}]`, {
      maxLength: 80,
      collapseWhitespace: true,
    }));
  }

  function validateGlobalCourseMetadataItem(raw, itemPath) {
    const item = requirePlainObject(raw, itemPath);
    requireKnownFields(item, new Set(['code', 'title', 'suCredits', 'ects']), itemPath);
    ['code', 'title', 'suCredits', 'ects'].forEach((field) => {
      if (!hasOwn(item, field)) importError(`${itemPath}.${field}`, 'is required');
    });
    return {
      code: normalizeCourseCode(item.code, `${itemPath}.code`),
      title: normalizeImportedText(item.title, `${itemPath}.title`, {
        maxLength: 200,
        collapseWhitespace: true,
        truncate: true,
      }),
      suCredits: normalizeFiniteNumber(item.suCredits, `${itemPath}.suCredits`, 100),
      ects: normalizeFiniteNumber(item.ects, `${itemPath}.ects`, 100),
    };
  }

  function validateGlobalCourseMetadata(value, path) {
    if (value === null) return [];
    if (!Array.isArray(value)) importError(path, 'expected an array');
    if (value.length > IMPORT_MAX_GLOBAL_COURSE_METADATA) {
      importError(path, `supports at most ${IMPORT_MAX_GLOBAL_COURSE_METADATA} courses`);
    }
    const seen = new Set();
    return value.map((raw, index) => {
      const itemPath = `${path}[${index}]`;
      const item = validateGlobalCourseMetadataItem(raw, itemPath);
      if (seen.has(item.code)) importError(itemPath, 'contains a duplicate course code');
      seen.add(item.code);
      return item;
    });
  }

  // Stored state can be damaged by an interrupted/manual localStorage edit.
  // Imports remain atomic and strict, but reads salvage independent valid rows
  // so one bad snapshot cannot erase every unrelated global transcript course.
  function salvageStoredGlobalCourseMetadata(value, path) {
    if (!Array.isArray(value)) return [];
    const out = [];
    const seen = new Set();
    let ignored = Math.max(0, value.length - IMPORT_MAX_GLOBAL_COURSE_METADATA);
    value.slice(0, IMPORT_MAX_GLOBAL_COURSE_METADATA).forEach((raw, index) => {
      try {
        const item = validateGlobalCourseMetadataItem(raw, `${path}[${index}]`);
        if (seen.has(item.code)) {
          ignored++;
          return;
        }
        seen.add(item.code);
        out.push(item);
      } catch (_) {
        ignored++;
      }
    });
    if (ignored) {
      try { console.warn(`Ignored ${ignored} invalid stored global course metadata row(s).`); } catch (_) {}
    }
    return out;
  }

  function validateCustomCourse(value, path) {
    const course = requirePlainObject(value, path);
    requireKnownFields(course, new Set([
      'Major', 'Code', 'Course_Name', 'ECTS', 'Engineering', 'Basic_Science',
      'SU_credit', 'Faculty', 'Faculty_Course', 'EL_Type',
    ]), path);

    if (!hasOwn(course, 'Major')) importError(`${path}.Major`, 'is required');
    if (!hasOwn(course, 'Code')) importError(`${path}.Code`, 'is required');
    const major = normalizeImportedText(course.Major, `${path}.Major`, { maxLength: 12 }).toUpperCase();
    const code = normalizeImportedText(course.Code, `${path}.Code`, { maxLength: 9 }).toUpperCase();
    const combined = normalizeCourseCode(major + code, path);
    const majorMatch = combined.match(/^([A-Z]{1,12})(\d[A-Z0-9]*)$/);
    if (!majorMatch || majorMatch[1] !== major || majorMatch[2] !== code) importError(path, 'has inconsistent course-code fields');

    const name = hasOwn(course, 'Course_Name')
      ? normalizeImportedText(course.Course_Name, `${path}.Course_Name`, {
          maxLength: 200,
          collapseWhitespace: true,
          truncate: true,
        })
      : combined;
    const ects = hasOwn(course, 'ECTS') ? normalizeFiniteNumber(course.ECTS, `${path}.ECTS`, 100) : 0;
    const engineering = hasOwn(course, 'Engineering') ? normalizeFiniteNumber(course.Engineering, `${path}.Engineering`, 100) : 0;
    const basicScience = hasOwn(course, 'Basic_Science') ? normalizeFiniteNumber(course.Basic_Science, `${path}.Basic_Science`, 100) : 0;
    const suCredit = hasOwn(course, 'SU_credit') ? normalizeFiniteNumber(course.SU_credit, `${path}.SU_credit`, 100) : 0;

    let faculty = '';
    if (hasOwn(course, 'Faculty')) {
      if (typeof course.Faculty !== 'string') importError(`${path}.Faculty`, 'expected text');
      const candidate = course.Faculty.trim().toUpperCase();
      faculty = IMPORT_FACULTIES.has(candidate) ? candidate : '';
    }

    let courseType = 'none';
    if (hasOwn(course, 'EL_Type')) {
      if (typeof course.EL_Type !== 'string') importError(`${path}.EL_Type`, 'expected text');
      const candidate = course.EL_Type.trim().toLowerCase();
      // Old exports could contain a free-form category. Keep the course but
      // fail closed by assigning it to no graduation bucket.
      courseType = IMPORT_COURSE_TYPES.has(candidate) ? candidate : 'none';
    }

    if (hasOwn(course, 'Faculty_Course') && typeof course.Faculty_Course !== 'string') {
      importError(`${path}.Faculty_Course`, 'expected text');
    }

    return {
      Major: major,
      Code: code,
      Course_Name: name,
      ECTS: String(ects),
      Engineering: engineering,
      Basic_Science: basicScience,
      SU_credit: String(suCredit),
      Faculty: faculty,
      // User-defined courses cannot claim membership in the catalog's faculty
      // course pool, even if an imported file says otherwise.
      Faculty_Course: 'No',
      EL_Type: courseType,
    };
  }

  function validateCustomCourses(value, path) {
    if (value === null) return {};
    const map = requirePlainObject(value, path);
    const programs = Object.keys(map);
    if (programs.length > 40) importError(path, 'contains too many program groups');
    let totalCourses = 0;
    const out = {};
    programs.forEach((programKey) => {
      const program = normalizeProgramCode(programKey, `${path}.${String(programKey).slice(0, 80)}`);
      if (hasOwn(out, program)) importError(path, 'contains duplicate normalized program codes');
      const list = map[programKey];
      if (!Array.isArray(list)) importError(`${path}.${program}`, 'expected an array of custom courses');
      totalCourses += list.length;
      if (totalCourses > IMPORT_MAX_CUSTOM_COURSES) importError(path, `supports at most ${IMPORT_MAX_CUSTOM_COURSES} custom courses`);
      out[program] = list.map((course, index) => validateCustomCourse(course, `${path}.${program}[${index}]`));
    });
    return out;
  }

  function validateSelectedSections(value, path) {
    if (value === undefined || value === null) return {};
    const selected = requirePlainObject(value, path);
    const keys = Object.keys(selected);
    if (keys.length > IMPORT_MAX_SELECTED_SECTIONS) importError(path, 'contains too many selected sections');
    const out = {};
    keys.forEach((key) => {
      const courseCode = normalizeCourseCode(key, `${path}.${String(key).slice(0, 80)}`);
      if (hasOwn(out, courseCode)) importError(path, 'contains duplicate normalized course codes');
      const entryPath = `${path}.${courseCode}`;
      const entry = requirePlainObject(selected[key], entryPath);
      requireKnownFields(entry, new Set(['course_id', 'crn']), entryPath);
      const entryCode = normalizeCourseCode(entry.course_id, `${entryPath}.course_id`);
      if (entryCode !== courseCode) importError(`${entryPath}.course_id`, 'must match its selected-course key');
      const crn = normalizeImportedText(entry.crn, `${entryPath}.crn`, { maxLength: 12 });
      if (!/^\d{1,12}$/.test(crn)) importError(`${entryPath}.crn`, 'has an invalid CRN');
      out[courseCode] = { course_id: courseCode, crn };
    });
    return out;
  }

  function validateBlockedRanges(value, path) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) importError(path, 'expected an array of blocked ranges');
    if (value.length > IMPORT_MAX_BLOCKED_RANGES) importError(path, 'contains too many blocked ranges');
    return value.map((item, index) => {
      const itemPath = `${path}[${index}]`;
      const block = requirePlainObject(item, itemPath);
      requireKnownFields(block, new Set(['id', 'dayKey', 'start', 'end']), itemPath);
      const id = normalizeImportedText(block.id, `${itemPath}.id`, { maxLength: 100 });
      if (!/^[A-Za-z0-9._-]+$/.test(id)) importError(`${itemPath}.id`, 'has invalid characters');
      const dayKey = normalizeImportedText(block.dayKey, `${itemPath}.dayKey`, { maxLength: 1 }).toUpperCase();
      if (!/^[MTWRFSU]$/.test(dayKey)) importError(`${itemPath}.dayKey`, 'has an invalid day');
      const start = normalizeFiniteNumber(block.start, `${itemPath}.start`, 1440);
      const end = normalizeFiniteNumber(block.end, `${itemPath}.end`, 1440);
      if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) {
        importError(itemPath, 'must contain increasing whole-minute bounds');
      }
      return { id, dayKey, start, end };
    });
  }

  function validateSchedulerUi(value, path) {
    if (value === undefined || value === null) return {};
    const ui = requirePlainObject(value, path);
    const allowed = new Set(['planCollapsed', 'selectedCollapsed', 'blockedCollapsed', 'sidebarCollapsed']);
    requireKnownFields(ui, allowed, path);
    const out = {};
    Object.keys(ui).forEach((key) => {
      if (typeof ui[key] !== 'boolean') importError(`${path}.${key}`, 'expected true or false');
      out[key] = ui[key];
    });
    return out;
  }

  function normalizeScheduleId(value, path) {
    const id = normalizeImportedText(value, path, { maxLength: 100 });
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)
        || ['__proto__', 'prototype', 'constructor'].includes(id.toLowerCase())) {
      importError(path, 'has invalid characters');
    }
    return id;
  }

  function validateScheduleEntry(value, expectedId, path) {
    const entry = requirePlainObject(value, path);
    requireKnownFields(entry, new Set(['id', 'name', 'selected', 'blocked', 'ui']), path);
    const id = normalizeScheduleId(entry.id, `${path}.id`);
    if (id !== expectedId) importError(`${path}.id`, 'must match its schedule key');
    return {
      id,
      name: normalizeImportedText(entry.name, `${path}.name`, {
        maxLength: IMPORT_MAX_SCHEDULE_NAME_LENGTH,
        collapseWhitespace: true,
        truncate: true,
      }),
      selected: validateSelectedSections(entry.selected, `${path}.selected`),
      blocked: validateBlockedRanges(entry.blocked, `${path}.blocked`),
      ui: validateSchedulerUi(entry.ui, `${path}.ui`),
    };
  }

  function validateSchedules(value, path) {
    const schedules = requirePlainObject(value, path);
    requireKnownFields(schedules, new Set(['activeId', 'order', 'items']), path);
    if (!Array.isArray(schedules.order) || schedules.order.length < 1
        || schedules.order.length > IMPORT_MAX_SCHEDULES_PER_TERM) {
      importError(`${path}.order`, `must contain 1-${IMPORT_MAX_SCHEDULES_PER_TERM} schedule IDs`);
    }
    const order = schedules.order.map((id, index) => normalizeScheduleId(id, `${path}.order[${index}]`));
    if (new Set(order).size !== order.length) importError(`${path}.order`, 'contains duplicate schedule IDs');
    const activeId = normalizeScheduleId(schedules.activeId, `${path}.activeId`);
    if (!order.includes(activeId)) importError(`${path}.activeId`, 'must identify an ordered schedule');
    const items = requirePlainObject(schedules.items, `${path}.items`);
    const itemKeys = Object.keys(items);
    if (itemKeys.length !== order.length || itemKeys.some((id) => !order.includes(id))) {
      importError(`${path}.items`, 'must exactly match the ordered schedules');
    }
    const normalizedItems = {};
    order.forEach((id) => {
      normalizedItems[id] = validateScheduleEntry(items[id], id, `${path}.items.${id}`);
    });
    return { activeId, order, items: normalizedItems };
  }

  function validateScheduleSnapshots(value, path) {
    if (value === undefined || value === null) return {};
    const snapshots = requirePlainObject(value, path);
    const scheduleIds = Object.keys(snapshots);
    if (scheduleIds.length > IMPORT_MAX_SCHEDULES_PER_TERM) {
      importError(path, `supports at most ${IMPORT_MAX_SCHEDULES_PER_TERM} schedules`);
    }
    const out = {};
    scheduleIds.forEach((rawScheduleId) => {
      const scheduleId = normalizeScheduleId(rawScheduleId, `${path}.${String(rawScheduleId).slice(0, 80)}`);
      if (hasOwn(out, scheduleId)) importError(path, 'contains duplicate normalized schedule IDs');
      const schedulePath = `${path}.${scheduleId}`;
      const courseSnapshots = requirePlainObject(snapshots[rawScheduleId], schedulePath);
      const courseCodes = Object.keys(courseSnapshots);
      if (courseCodes.length > IMPORT_MAX_SELECTED_SECTIONS) {
        importError(schedulePath, 'contains too many section snapshots');
      }
      const normalizedCourseSnapshots = {};
      courseCodes.forEach((rawCourseCode) => {
        const courseCode = normalizeCourseCode(rawCourseCode, `${schedulePath}.${String(rawCourseCode).slice(0, 80)}`);
        if (hasOwn(normalizedCourseSnapshots, courseCode)) {
          importError(schedulePath, 'contains duplicate normalized course codes');
        }
        const snapshotPath = `${schedulePath}.${courseCode}`;
        const snapshot = requirePlainObject(courseSnapshots[rawCourseCode], snapshotPath);
        requireKnownFields(snapshot, new Set([
          'crn', 'meetingKey', 'instrKey', 'meetingSummary', 'instrSummary',
        ]), snapshotPath);
        if (!hasOwn(snapshot, 'crn')) importError(`${snapshotPath}.crn`, 'is required');
        const crn = normalizeImportedText(snapshot.crn, `${snapshotPath}.crn`, { maxLength: 12 });
        if (!/^\d{1,12}$/.test(crn)) importError(`${snapshotPath}.crn`, 'has an invalid CRN');
        const textField = (key) => hasOwn(snapshot, key)
          ? normalizeImportedText(snapshot[key], `${snapshotPath}.${key}`, {
              allowEmpty: true,
              maxLength: IMPORT_MAX_SNAPSHOT_TEXT_LENGTH,
            })
          : '';
        normalizedCourseSnapshots[courseCode] = {
          crn,
          meetingKey: textField('meetingKey'),
          instrKey: textField('instrKey'),
          meetingSummary: textField('meetingSummary'),
          instrSummary: textField('instrSummary'),
        };
      });
      out[scheduleId] = normalizedCourseSnapshots;
    });
    return out;
  }

  function validateSchedulerState(value, path) {
    const state = requirePlainObject(value, path);
    requireKnownFields(state, new Set([
      'selected', 'blocked', 'ui', 'schedules', 'lastSeenScheduleSnapshots',
    ]), path);
    const legacySelected = validateSelectedSections(state.selected, `${path}.selected`);
    const legacyBlocked = validateBlockedRanges(state.blocked, `${path}.blocked`);
    const legacyUi = validateSchedulerUi(state.ui, `${path}.ui`);
    const snapshots = hasOwn(state, 'lastSeenScheduleSnapshots')
      ? validateScheduleSnapshots(state.lastSeenScheduleSnapshots, `${path}.lastSeenScheduleSnapshots`)
      : undefined;
    if (!hasOwn(state, 'schedules') || state.schedules === null) {
      const legacy = { selected: legacySelected, blocked: legacyBlocked, ui: legacyUi };
      if (snapshots !== undefined) legacy.lastSeenScheduleSnapshots = snapshots;
      return legacy;
    }
    const schedules = validateSchedules(state.schedules, `${path}.schedules`);
    const active = schedules.items[schedules.activeId];
    const normalized = {
      schedules,
      // Canonicalize the legacy mirror to the validated active schedule.
      selected: active.selected,
      blocked: active.blocked,
      ui: active.ui,
    };
    if (snapshots !== undefined) normalized.lastSeenScheduleSnapshots = snapshots;
    return normalized;
  }

  function validateSchedulerStates(value, path) {
    if (value === null) return {};
    const states = requirePlainObject(value, path);
    const terms = Object.keys(states);
    if (terms.length > IMPORT_MAX_SCHEDULER_TERMS) importError(path, 'contains too many scheduler terms');
    const out = {};
    terms.forEach((termKey) => {
      const term = normalizeTermCode(termKey, `${path}.${String(termKey).slice(0, 80)}`);
      if (hasOwn(out, term)) importError(path, 'contains duplicate normalized term codes');
      out[term] = validateSchedulerState(states[termKey], `${path}.${term}`);
    });
    return out;
  }

  function validatePlanState(value, path, fileVersion) {
    if (value === undefined || value === null) return {};
    const state = requirePlainObject(value, path);
    const allowedFields = new Set(Array.from(IMPORT_STATE_FIELDS).filter((field) => {
      if (field === 'gradingBases') return fileVersion >= 2;
      if (field === 'globalCourseMetadata') return fileVersion >= 3;
      return true;
    }));
    requireKnownFields(state, allowedFields, path);
    const out = {};

    const programFields = ['major', 'doubleMajor'];
    programFields.forEach((key) => {
      if (hasOwn(state, key) && state[key] !== null && state[key] !== '') {
        out[key] = normalizeProgramCode(state[key], `${path}.${key}`);
      }
    });
    const termFields = ['entryTerm', 'entryTermDM', 'entryTermMinor', 'entryTermMinor1', 'entryTermMinor2', 'entryTermMinor3'];
    termFields.forEach((key) => {
      if (hasOwn(state, key) && state[key] !== null && state[key] !== '') {
        out[key] = normalizeTermName(state[key], `${path}.${key}`);
      }
    });
    ['minor1', 'minor2', 'minor3'].forEach((key) => {
      if (hasOwn(state, key) && state[key] !== null && state[key] !== '') {
        out[key] = normalizeMinorCode(state[key], `${path}.${key}`);
      }
    });
    if (hasOwn(state, 'schedulerSelectedTerm') && state.schedulerSelectedTerm !== null && state.schedulerSelectedTerm !== '') {
      out.schedulerSelectedTerm = normalizeTermCode(state.schedulerSelectedTerm, `${path}.schedulerSelectedTerm`);
    }

    const curriculum = hasOwn(state, 'curriculum') ? validateCurriculum(state.curriculum, `${path}.curriculum`) : undefined;
    if (curriculum !== undefined) out.curriculum = curriculum;
    if (hasOwn(state, 'grades')) out.grades = validateGrades(state.grades, curriculum, `${path}.grades`);
    if (fileVersion >= 2 && hasOwn(state, 'gradingBases') && state.gradingBases !== null) {
      const suppliedBases = validateGradingBases(state.gradingBases, curriculum, `${path}.gradingBases`);
      // A decisive A–F or S/U grade is the source of truth if stale metadata
      // disagrees with it. Ambiguous grades such as NA retain the supplied basis.
      out.gradingBases = canonicalizeGradingBases(curriculum, out.grades, suppliedBases);
    } else if (Array.isArray(curriculum)) {
      out.gradingBases = synthesizeGradingBases(curriculum, out.grades);
    }
    if (hasOwn(state, 'dates')) out.dates = validateDates(state.dates, curriculum, `${path}.dates`);
    if (hasOwn(state, 'customCourses')) out.customCourses = validateCustomCourses(state.customCourses, `${path}.customCourses`);
    if (hasOwn(state, 'schedulerStates')) out.schedulerStates = validateSchedulerStates(state.schedulerStates, `${path}.schedulerStates`);
    if (fileVersion >= 3 && hasOwn(state, 'globalCourseMetadata')) {
      out.globalCourseMetadata = validateGlobalCourseMetadata(
        state.globalCourseMetadata,
        `${path}.globalCourseMetadata`,
      );
    }
    return out;
  }

  function validateImportObject(obj) {
    const root = requirePlainObject(obj, 'file');
    requireKnownFields(root, new Set(['type', 'version', 'exportedAt', 'plan']), 'file');
    if (root.type !== 'surriculum_plan' || ![1, 2, PLAN_EXPORT_VERSION].includes(root.version)) {
      throw new Error('Unsupported file');
    }
    if (hasOwn(root, 'exportedAt') && root.exportedAt !== null) normalizeIsoTimestamp(root.exportedAt, 'file.exportedAt');

    const plan = requirePlainObject(root.plan, 'file.plan');
    requireKnownFields(plan, new Set(['id', 'name', 'order', 'createdAt', 'updatedAt', 'state']), 'file.plan');
    if (hasOwn(plan, 'id') && plan.id !== null) normalizeScheduleId(plan.id, 'file.plan.id');
    if (hasOwn(plan, 'order') && plan.order !== null
        && (!Number.isInteger(plan.order) || plan.order < 0 || plan.order >= MAX_PLANS)) {
      importError('file.plan.order', `must be an integer from 0 to ${MAX_PLANS - 1}`);
    }
    if (hasOwn(plan, 'createdAt')) normalizeIsoTimestamp(plan.createdAt, 'file.plan.createdAt');
    if (hasOwn(plan, 'updatedAt')) normalizeIsoTimestamp(plan.updatedAt, 'file.plan.updatedAt');

    let name = 'Imported Plan';
    if (hasOwn(plan, 'name') && plan.name !== null) {
      const rawName = normalizeImportedText(plan.name, 'file.plan.name', { maxLength: 500, collapseWhitespace: true });
      name = normalizePlanName(rawName) || 'Imported Plan';
    }
    return { name, state: validatePlanState(plan.state, 'file.plan.state', root.version) };
  }

  function downloadJson(filename, obj) {
    const text = JSON.stringify(obj, null, 2);
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function sanitizeFilename(name) {
    return String(name || 'plan')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'plan';
  }

  function readPlanState(planId) {
    const get = (k) => localStorage.getItem(planKey(planId, k));
    const state = {
      major: get('major') || null,
      doubleMajor: get('doubleMajor') || null,
      entryTerm: get('entryTerm') || null,
      entryTermDM: get('entryTermDM') || null,
      entryTermMinor: get('entryTermMinor') || null,
      entryTermMinor1: get('entryTermMinor1') || null,
      entryTermMinor2: get('entryTermMinor2') || null,
      entryTermMinor3: get('entryTermMinor3') || null,
      minor1: get('minor1') || null,
      minor2: get('minor2') || null,
      minor3: get('minor3') || null,
      schedulerSelectedTerm: get('schedulerSelectedTerm') || null,
      curriculum: safeJsonParse(get('curriculum') || 'null', null),
      grades: safeJsonParse(get('grades') || 'null', null),
      gradingBases: safeJsonParse(get('gradingBases') || 'null', null),
      dates: safeJsonParse(get('dates') || 'null', null),
      globalCourseMetadata: safeJsonParse(get('globalCourseMetadata') || '[]', []),
      customCourses: {},
      schedulerStates: {},
    };

    state.globalCourseMetadata = salvageStoredGlobalCourseMetadata(
      state.globalCourseMetadata,
      'stored global course metadata',
    );

    const prefix = planKey(planId, 'customCourses_');
    const schedulerPrefix = planKey(planId, 'schedulerState_');
    const keys = listLocalStorageKeys();
    for (const k of keys) {
      if (k.startsWith(prefix)) {
        const majorKey = k.slice(planKey(planId, '').length);
        const raw = localStorage.getItem(k);
        const parsed = safeJsonParse(raw || 'null', null);
        if (Array.isArray(parsed)) {
          const program = majorKey.replace(/^customCourses_/, '');
          try {
            state.customCourses[program] = validateCustomCourses(
              { [program]: parsed },
              `stored custom courses.${program}`
            )[normalizeProgramCode(program, 'stored custom-course program')];
          } catch (err) {
            try { console.warn('Ignoring invalid stored custom courses during export:', err); } catch (_) {}
          }
        }
        continue;
      }
      if (k.startsWith(schedulerPrefix)) {
        const termKey = k.slice(planKey(planId, '').length).replace(/^schedulerState_/, '');
        const raw = localStorage.getItem(k);
        const parsed = safeJsonParse(raw || 'null', null);
        if (parsed && typeof parsed === 'object') {
          state.schedulerStates[termKey] = parsed;
        }
      }
    }

    if (Array.isArray(state.curriculum)) {
      // Autosave writes parallel arrays sequentially. Recover a stale or
      // partially written basis array before exporting so our own v2 export is
      // always re-importable, and canonicalize conflicts from older storage.
      state.gradingBases = canonicalizeGradingBases(
        state.curriculum,
        state.grades,
        state.gradingBases,
      );
    }

    return state;
  }

  function writePlanState(planId, state, options) {
    if (!state || typeof state !== 'object') return;
    const writeOptions = options || {};
    const setRaw = (k, v) => localStorage.setItem(planKey(planId, k), v);
    const setJson = (k, v) => setRaw(k, JSON.stringify(v));

    if (state.major != null) setRaw('major', String(state.major));
    if (state.doubleMajor != null) setRaw('doubleMajor', String(state.doubleMajor));
    if (state.entryTerm != null) setRaw('entryTerm', String(state.entryTerm));
    if (state.entryTermDM != null) setRaw('entryTermDM', String(state.entryTermDM));
    if (state.entryTermMinor != null) setRaw('entryTermMinor', String(state.entryTermMinor));
    if (state.entryTermMinor1 != null) setRaw('entryTermMinor1', String(state.entryTermMinor1));
    if (state.entryTermMinor2 != null) setRaw('entryTermMinor2', String(state.entryTermMinor2));
    if (state.entryTermMinor3 != null) setRaw('entryTermMinor3', String(state.entryTermMinor3));
    if (state.minor1 != null) setRaw('minor1', String(state.minor1));
    if (state.minor2 != null) setRaw('minor2', String(state.minor2));
    if (state.minor3 != null) setRaw('minor3', String(state.minor3));
    if (state.schedulerSelectedTerm != null) setRaw('schedulerSelectedTerm', String(state.schedulerSelectedTerm));

    if (state.curriculum != null) setJson('curriculum', state.curriculum);
    if (state.grades != null) setJson('grades', state.grades);
    if (state.gradingBases != null) setJson('gradingBases', state.gradingBases);
    if (state.dates != null) setJson('dates', state.dates);
    if (state.globalCourseMetadata != null) {
      setJson('globalCourseMetadata', validateGlobalCourseMetadata(
        state.globalCourseMetadata,
        'plan.globalCourseMetadata',
      ));
    }

    if (state.customCourses && typeof state.customCourses === 'object') {
      for (const maj of Object.keys(state.customCourses)) {
        const list = state.customCourses[maj];
        if (!Array.isArray(list)) continue;
        setJson('customCourses_' + maj, list);
      }
    }

    if (state.schedulerStates && typeof state.schedulerStates === 'object') {
      for (const term of Object.keys(state.schedulerStates)) {
        const schedState = state.schedulerStates[term];
        if (!schedState || typeof schedState !== 'object') continue;
        setJson('schedulerState_' + term, schedState);
      }
    }

    if (!writeOptions.skipTouch) touchUpdated(planId);
  }

  function buildExportObject(planId) {
    const idx = ensureIndex();
    const meta = getPlanMeta(planId);
    const order = idx.plans.findIndex(p => p.id === planId);
    const state = readPlanState(planId);
    return {
      type: 'surriculum_plan',
      version: PLAN_EXPORT_VERSION,
      exportedAt: nowIso(),
      plan: {
        id: meta?.id || planId,
        name: meta?.name || DEFAULT_PLAN_NAME,
        order,
        createdAt: meta?.createdAt || null,
        updatedAt: meta?.updatedAt || null,
        state,
      },
    };
  }

  function importExportObject(obj, opts) {
    const options = opts || {};
    const validated = validateImportObject(obj);
    const idx = ensureIndex();
    if (idx.plans.length >= MAX_PLANS) throw new Error(`Plan limit reached (${MAX_PLANS}).`);

    const id = createId();
    const createdAt = nowIso();
    const prefix = planKey(id, '');
    try {
      // Persist the already-normalized state first. The plan is not added to
      // the visible index until every state write succeeds, so malformed data
      // or a storage-quota failure cannot leave a partial active plan behind.
      writePlanState(id, validated.state, { skipTouch: true });
      idx.plans.push({ id, name: validated.name, createdAt, updatedAt: createdAt });
      if (options.activate) idx.activeId = id;
      saveIndex(idx);
    } catch (err) {
      try {
        listLocalStorageKeys().forEach((key) => {
          if (key.startsWith(prefix)) localStorage.removeItem(key);
        });
      } catch (_) {}
      throw err;
    }
    return id;
  }

  function initPlanUi() {
    const toggle = document.getElementById('planToggle');
    const dropdown = document.getElementById('planDropdown');
    const nameSpan = document.getElementById('activePlanName');
    if (!toggle || !dropdown || !nameSpan) return;

    const closeDropdown = () => dropdown.classList.remove('active');
    const openDropdown = () => dropdown.classList.add('active');

    const setHeaderName = () => {
      const active = getPlanMeta(getActivePlanId());
      nameSpan.textContent = active?.name || DEFAULT_PLAN_NAME;
    };

    function render() {
      const idx = ensureIndex();
      const activeId = idx.activeId;
      setHeaderName();

      const list = dropdown.querySelector('.plan-list');
      if (!list) return;
      list.innerHTML = '';

      idx.plans.forEach((p) => {
        const row = document.createElement('div');
        row.className = 'plan-item' + (p.id === activeId ? ' active' : '');
        row.dataset.id = p.id;
        row.draggable = true;

        const grip = document.createElement('span');
        grip.className = 'plan-grip';
        grip.innerHTML = '<i class="fa-solid fa-grip-vertical"></i>';

        const select = document.createElement('button');
        select.className = 'plan-select';
        select.type = 'button';
        select.textContent = p.name;
        select.addEventListener('click', (e) => {
          e.stopPropagation();
          if (p.id === getActivePlanId()) {
            closeDropdown();
            return;
          }
          try {
            for (const fn of saveHooks) {
              try { fn(); } catch (_) {}
            }
          } catch (_) {}
          const ok = planStorage.setActivePlanId(p.id);
          if (ok) location.reload();
        });

        const actions = document.createElement('div');
        actions.className = 'plan-actions';

        const mkAction = (title, iconHtml, onClick, extraClass) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'btn-icon plan-action' + (extraClass ? ' ' + extraClass : '');
          b.title = title;
          b.innerHTML = iconHtml;
          b.addEventListener('click', (e) => {
            e.stopPropagation();
            onClick();
          });
          return b;
        };

        actions.appendChild(
          mkAction('Rename', '<i class="fa-solid fa-pen"></i>', () => {
            uiModal
              .prompt('Rename plan', '<p>Enter a new name for this plan.</p>', { value: p.name, confirmText: 'Rename' })
              .then((val) => {
                const next = normalizePlanName(val);
                if (!next) {
                  uiModal.alert('Invalid name', '<p>Plan name cannot be empty.</p>');
                  return;
                }
                planStorage.renamePlan(p.id, next);
                render();
              })
              .catch(() => {});
          })
        );
        actions.appendChild(
          mkAction('Export', '<i class="fa-solid fa-file-arrow-down"></i>', () => {
            planStorage.exportPlan(p.id);
          })
        );
        actions.appendChild(
          mkAction('Delete', '<i class="fa-solid fa-trash"></i>', () => {
            uiModal
              .confirm(
                'Delete plan?',
                `<p>Delete <strong>${escapeHtml(p.name)}</strong>?</p><p>This cannot be undone.</p>`,
                { confirmText: 'Delete', danger: true }
              )
              .then((ok) => {
                if (!ok) return;
                const res = planStorage.deletePlan(p.id);
                if (!res.ok) {
                  uiModal.alert('Cannot delete plan', `<p>${escapeHtml(res.message || 'At least one plan must exist.')}</p>`);
                  return;
                }
                if (res.reloaded) return;
                render();
              })
              .catch(() => {});
          }, 'danger')
        );

        row.appendChild(grip);
        row.appendChild(select);
        row.appendChild(actions);
        list.appendChild(row);
      });
    }

    // Drag and drop ordering
    let draggingId = null;
    dropdown.addEventListener('dragstart', (e) => {
      const target = e.target && e.target.closest ? e.target.closest('.plan-item') : null;
      if (!target) return;
      draggingId = target.dataset.id;
      target.classList.add('dragging');
      try {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', draggingId);
      } catch (_) {}
    });
    dropdown.addEventListener('dragend', (e) => {
      const target = e.target && e.target.closest ? e.target.closest('.plan-item') : null;
      if (target) target.classList.remove('dragging');
      draggingId = null;
      const ids = Array.from(dropdown.querySelectorAll('.plan-item')).map(el => el.dataset.id).filter(Boolean);
      if (ids.length) planStorage.reorder(ids);
    });
    dropdown.addEventListener('dragover', (e) => {
      const over = e.target && e.target.closest ? e.target.closest('.plan-item') : null;
      if (!over || !draggingId) return;
      e.preventDefault();
      const list = dropdown.querySelector('.plan-list');
      const draggingEl = list.querySelector(`.plan-item[data-id="${draggingId}"]`);
      if (!draggingEl || over === draggingEl) return;
      const rect = over.getBoundingClientRect();
      const after = e.clientY > rect.top + rect.height / 2;
      list.insertBefore(draggingEl, after ? over.nextSibling : over);
    });

    // Add / Import controls
    const addBtn = document.getElementById('addPlanBtn');
    const importBtn = document.getElementById('importPlanBtn2');
    const importInput = document.getElementById('planImportInput2');

    if (addBtn) {
      addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = ensureIndex();
        if (idx.plans.length >= MAX_PLANS) {
          uiModal.alert('Plan limit reached', `<p>You can have up to <strong>${MAX_PLANS}</strong> plans.</p>`);
          return;
        }
        // Flush the current plan before creating/switching. This avoids the
        // autosave loop writing the current plan into the newly active plan.
        try {
          for (const fn of saveHooks) {
            try { fn(); } catch (_) {}
          }
        } catch (_) {}

        const currentId = getActivePlanId();
        uiModal
          .prompt('New plan', '<p>Name your new plan.</p>', { value: `Plan ${idx.plans.length + 1}`, confirmText: 'Continue' })
          .then((val) => {
            const baseName = normalizePlanName(val);
            if (!baseName) {
              uiModal.alert('Invalid name', '<p>Plan name cannot be empty.</p>');
              return null;
            }
            return uiModal.confirm(
              'Copy semesters?',
              '<p>Copy current semesters/courses into the new plan?</p><p><small>(Start empty resets major/minor/double-major and admit terms to defaults.)</small></p>',
              { confirmText: 'Copy', cancelText: 'Start empty' }
            ).then((copySemesters) => ({ baseName, copySemesters }));
          })
          .then((res) => {
            if (!res) return;
            const { baseName, copySemesters } = res;
            let newId = null;
            if (copySemesters) {
              newId = planStorage.duplicatePlan(currentId, baseName);
            } else {
              newId = planStorage.createPlan(baseName);
            }
            if (newId) {
              planStorage.setActivePlanId(newId);
              location.reload();
            }
          })
          .catch(() => {});
      });
    }

    if (importBtn && importInput) {
      importBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        importInput.value = '';
        importInput.click();
      });
      importInput.addEventListener('change', () => {
        const file = importInput.files && importInput.files[0];
        if (!file) return;
        planStorage.importPlanFile(file, { activate: true })
          .then(() => location.reload())
          .catch((err) => uiModal.alert('Import failed', `<p>${escapeHtml(err && err.message ? err.message : 'Failed to import plan.')}</p>`));
      });
    }

    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dropdown.classList.contains('active')) closeDropdown();
      else openDropdown();
    });

    document.addEventListener('click', (e) => {
      if (!dropdown.classList.contains('active')) return;
      if (dropdown.contains(e.target) || toggle.contains(e.target)) return;
      closeDropdown();
    });

    render();
  }

  const planStorage = {
    maxPlans: MAX_PLANS,
    ensureIndex,
    getActivePlanId,
    getPlans() {
      return ensureIndex().plans.slice();
    },
    getActivePlan() {
      const idx = ensureIndex();
      return idx.plans.find(p => p.id === idx.activeId) || idx.plans[0];
    },
    setActivePlanId(id) {
      const idx = ensureIndex();
      if (!idx.plans.some(p => p.id === id)) return false;
      idx.activeId = id;
      saveIndex(idx);
      return true;
    },
    registerSaveHook(fn) {
      if (typeof fn === 'function') saveHooks.push(fn);
    },
    clearAllAppData,
    getItem(key, planId) {
      const pid = planId || getActivePlanId();
      const raw = localStorage.getItem(planKey(pid, key));
      if (raw == null) return raw;
      if (String(key || '') === 'globalCourseMetadata') {
        return JSON.stringify(salvageStoredGlobalCourseMetadata(
          safeJsonParse(raw, []),
          'stored global course metadata',
        ));
      }
      if (!String(key || '').startsWith('customCourses_')) return raw;
      try {
        const program = String(key).slice('customCourses_'.length);
        const parsed = JSON.parse(raw);
        const normalized = validateCustomCourses({ [program]: parsed }, `stored custom courses.${program}`);
        return JSON.stringify(normalized[normalizeProgramCode(program, 'stored custom-course program')]);
      } catch (err) {
        try { console.warn('Ignoring invalid stored custom courses:', err); } catch (_) {}
        return '[]';
      }
    },
    setItem(key, value, planId) {
      const pid = planId || getActivePlanId();
      let storedValue = value;
      if (String(key || '').startsWith('customCourses_')) {
        const program = String(key).slice('customCourses_'.length);
        const parsed = JSON.parse(String(value || ''));
        const normalized = validateCustomCourses({ [program]: parsed }, `custom courses.${program}`);
        storedValue = JSON.stringify(normalized[normalizeProgramCode(program, 'custom-course program')]);
      } else if (String(key || '') === 'globalCourseMetadata') {
        storedValue = JSON.stringify(validateGlobalCourseMetadata(
          JSON.parse(String(value || '')),
          'global course metadata',
        ));
      }
      localStorage.setItem(planKey(pid, key), storedValue);
      touchUpdated(pid);
    },
    removeItem(key, planId) {
      const pid = planId || getActivePlanId();
      localStorage.removeItem(planKey(pid, key));
      touchUpdated(pid);
    },
    createPlan(name) {
      const n = normalizePlanName(name) || 'New Plan';
      const idx = ensureIndex();
      if (idx.plans.length >= MAX_PLANS) return null;
      const id = createId();
      idx.plans.push({ id, name: n, createdAt: nowIso(), updatedAt: nowIso() });
      saveIndex(idx);
      return id;
    },
    duplicatePlan(sourceId, name) {
      const idx = ensureIndex();
      if (idx.plans.length >= MAX_PLANS) return null;
      const src = sourceId || idx.activeId;
      const n = normalizePlanName(name) || 'Copy of Plan';
      const id = createId();
      idx.plans.push({ id, name: n, createdAt: nowIso(), updatedAt: nowIso() });
      saveIndex(idx);
      const srcPrefix = planKey(src, '');
      const dstPrefix = planKey(id, '');
      const keys = listLocalStorageKeys();
      for (const k of keys) {
        if (!k.startsWith(srcPrefix)) continue;
        const rest = k.slice(srcPrefix.length);
        const val = localStorage.getItem(k);
        if (val != null) localStorage.setItem(dstPrefix + rest, val);
      }
      touchUpdated(id);
      return id;
    },
    renamePlan(id, name) {
      const n = normalizePlanName(name);
      if (!n) return false;
      const idx = ensureIndex();
      const p = idx.plans.find(x => x.id === id);
      if (!p) return false;
      p.name = n;
      p.updatedAt = nowIso();
      saveIndex(idx);
      return true;
    },
    deletePlan(id) {
      const idx = ensureIndex();
      if (idx.plans.length <= 1) {
        return { ok: false, message: 'At least one plan must exist.' };
      }
      const exists = idx.plans.some(p => p.id === id);
      if (!exists) return { ok: false, message: 'Plan not found.' };

      // The page save hook is bound to the plan that was active when this
      // session loaded. Flush it before removing that namespace; running the
      // hook afterwards would recreate orphaned keys for the deleted plan.
      if (idx.activeId === id) {
        try {
          for (const fn of saveHooks) {
            try { fn(); } catch (_) {}
          }
        } catch (_) {}
      }

      // Remove all plan-scoped keys for this plan id
      const prefix = planKey(id, '');
      const keys = listLocalStorageKeys();
      for (const k of keys) {
        if (k.startsWith(prefix)) localStorage.removeItem(k);
      }

      idx.plans = idx.plans.filter(p => p.id !== id);
      let reloaded = false;
      if (idx.activeId === id) {
        idx.activeId = idx.plans[0].id;
        saveIndex(idx);
        location.reload();
        reloaded = true;
      } else {
        saveIndex(idx);
      }
      return { ok: true, reloaded };
    },
    reorder(idsInOrder) {
      const idx = ensureIndex();
      const order = Array.isArray(idsInOrder) ? idsInOrder.filter(Boolean) : [];
      if (order.length !== idx.plans.length) return false;
      const map = new Map(idx.plans.map(p => [p.id, p]));
      const next = [];
      for (const id of order) {
        const p = map.get(id);
        if (!p) return false;
        next.push(p);
      }
      idx.plans = next;
      saveIndex(idx);
      return true;
    },
    exportPlan(id) {
      const pid = id || getActivePlanId();
      if (pid === getActivePlanId()) {
        for (const fn of saveHooks) {
          try { fn(); } catch (_) {}
        }
      }
      const obj = buildExportObject(pid);
      const meta = getPlanMeta(pid);
      const fname = `surriculum-plan_${sanitizeFilename(meta?.name || 'plan')}_${nowIso().slice(0, 10)}.json`;
      downloadJson(fname, obj);
      return true;
    },
    async importPlanFile(file, options) {
      if (!file || typeof file !== 'object') throw new Error('Invalid file');
      if (Number.isFinite(file.size) && file.size > IMPORT_MAX_FILE_BYTES) {
        throw new Error('Plan file is too large (maximum 2 MB).');
      }
      const text = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsText(file);
      });
      if (text.length > IMPORT_MAX_FILE_BYTES) throw new Error('Plan file is too large (maximum 2 MB).');
      const obj = safeJsonParse(text, null);
      const id = importExportObject(obj, options || { activate: true });
      return id;
    },
    importPlanObject: importExportObject,
    validateImportObject,
    normalizeCustomCourse(course) {
      return validateCustomCourse(course, 'custom course');
    },
    normalizeCustomCourseList(program, list) {
      const programCode = normalizeProgramCode(program, 'custom course program');
      const normalized = validateCustomCourses({ [programCode]: list }, 'custom courses');
      return normalized[programCode];
    },
  };

  // Boot
  ensureIndex();
  migrateLegacyIfNeeded();
  initStorageSchemaVersion();
  window.planStorage = planStorage;
  window.uiModal = window.uiModal || uiModal;

  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', initPlanUi);
  }
})();
