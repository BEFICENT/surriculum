// Plan storage lifecycle and orchestration.
// UI and strict import/export policy live in scripts/plan/*.js.

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
  const STORAGE_SCHEMA_VERSION = 4;
  const STORAGE_SCHEMA_KEY = 'surriculum.appDataVersion';
  const MAX_PLANS = 10;
  const DEFAULT_PLAN_NAME = 'Default Plan';
  const PLAN_EXPORT_VERSION = 4;
  // Bound once during boot. The shared index's activeId may be changed by a
  // different tab, but code running in this page must keep reading and writing
  // the plan that this page actually rendered.
  let sessionPlanId = null;
  const LEGACY_KEYS = [
    'major', 'doubleMajor',
    'entryTerm', 'entryTermDM',
    // Minor terms: `entryTermMinor` is legacy (single term); keep for migration.
    'entryTermMinor', 'entryTermMinor1', 'entryTermMinor2', 'entryTermMinor3',
    'minor1', 'minor2', 'minor3',
    'curriculum', 'grades', 'gradingBases', 'dates', 'termCodes'
  ];
  const APP_GLOBAL_STORAGE_KEYS = new Set([
    ...LEGACY_KEYS,
    'schedulerSelectedTerm',
    'showDoubleMajorControls',
    'showMinorControls',
    'globalCourseMetadata',
  ]);
  const APP_LEGACY_STORAGE_PATTERNS = [
    /^customCourses_(?=[A-Z0-9-]{1,48}$)[A-Z0-9]+(?:-[A-Z0-9]+)*$/,
    /^schedulerState_\d{6}$/,
    /^dmCustomCoursesCreditsRepairShown_[A-Z][A-Z0-9-]{0,19}$/,
  ];

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

  // Read-only liveness check used by delayed save hooks. It must never call
  // ensureIndex(): doing so after a reset (or a deletion in another tab) would
  // recreate a default plan while the old page is trying to flush.
  function hasPlanWithoutCreating(id) {
    if (!id) return false;
    const idx = loadIndex();
    return !!(idx && idx.plans.some((plan) => plan && plan.id === id));
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

  function getSessionPlanId() {
    return sessionPlanId;
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
    // A visibility/pagehide event may follow the reset. Disable delayed saves
    // before yielding so they cannot recreate the removed plan namespace.
    suspendSaves();
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

  const SAVE_DEBOUNCE_MS = 250;
  const saveHooks = [];
  let pendingSaveTimer = null;
  let savePending = false;
  let savesSuspended = false;
  let planChangeRevision = 0;
  let planChangeNotificationQueued = false;

  function announcePlanChange() {
    planChangeRevision += 1;
    if (planChangeNotificationQueued) return;
    planChangeNotificationQueued = true;

    // Some transactions request a durable checkpoint before mutating and save
    // again after the commit. Notify observers after the current stack so they
    // see only the completed model, and collapse those requests into one refresh.
    const dispatchLatestRevision = () => {
      planChangeNotificationQueued = false;
      try {
        if (typeof document !== 'undefined') {
          document.dispatchEvent(new CustomEvent('surriculum:planchange', {
            detail: { revision: planChangeRevision },
          }));
        }
      } catch (_) {}
    };
    try {
      if (typeof queueMicrotask === 'function') {
        queueMicrotask(dispatchLatestRevision);
      } else if (typeof Promise !== 'undefined') {
        Promise.resolve().then(dispatchLatestRevision);
      } else {
        setTimeout(dispatchLatestRevision, 0);
      }
    } catch (_) {
      setTimeout(dispatchLatestRevision, 0);
    }
  }

  function clearPendingSaveTimer() {
    if (pendingSaveTimer !== null) {
      clearTimeout(pendingSaveTimer);
      pendingSaveTimer = null;
    }
  }

  function flushSaves(options) {
    const opts = options || {};
    clearPendingSaveTimer();
    if (savesSuspended || saveHooks.length === 0) return true;
    if (opts.onlyIfPending && !savePending) return true;

    let succeeded = true;
    saveHooks.forEach((entry) => {
      // A stale tab must not resurrect a plan deleted/reset elsewhere.
      if (entry.planId && !hasPlanWithoutCreating(entry.planId)) return;
      try {
        if (entry.fn() === false) succeeded = false;
      } catch (err) {
        succeeded = false;
        try { console.error('Failed to save plan changes:', err); } catch (_) {}
      }
    });
    if (succeeded) savePending = false;
    return succeeded;
  }

  function requestSave() {
    if (savesSuspended || saveHooks.length === 0) return false;
    announcePlanChange();
    savePending = true;
    clearPendingSaveTimer();
    pendingSaveTimer = setTimeout(() => {
      pendingSaveTimer = null;
      flushSaves();
    }, SAVE_DEBOUNCE_MS);
    return true;
  }

  function suspendSaves() {
    clearPendingSaveTimer();
    savePending = false;
    savesSuspended = true;
  }

  function showSaveFailure() {
    try {
      uiModal.alert(
        'Could not save changes',
        '<p>Your latest planner changes could not be saved in this browser. The requested switch or export was cancelled.</p>'
      );
    } catch (_) {
      try { console.error('Could not save the latest planner changes.'); } catch (_) {}
    }
  }

  const SNAPSHOT_KEYS = ['curriculum', 'grades', 'gradingBases', 'dates', 'termCodes'];

  function canonicalTermCodeFromLabel(value) {
    const match = String(value || '').trim().match(/^(Fall|Spring|Summer)\s+(\d{4})-(\d{4})$/);
    if (!match || Number(match[3]) !== Number(match[2]) + 1) return '';
    const suffix = { Fall: '01', Spring: '02', Summer: '03' }[match[1]];
    return match[2] + suffix;
  }

  function setPlanSnapshot(snapshot, planId) {
    const pid = planId || getActivePlanId();
    if (planId && !hasPlanWithoutCreating(pid)) {
      throw new Error('The plan is no longer available.');
    }
    if (!snapshot || typeof snapshot !== 'object') {
      throw new Error('Invalid planner snapshot.');
    }

    const normalizedSnapshot = Object.assign({}, snapshot);
    if (typeof normalizedSnapshot.termCodes !== 'string') {
      // Backward-compatible bridge for a page/save hook loaded before schema
      // v4. New snapshots always gain the stable parallel identity array.
      let labels = [];
      try {
        const parsed = JSON.parse(String(normalizedSnapshot.dates || '[]'));
        if (Array.isArray(parsed)) labels = parsed;
      } catch (_) {}
      normalizedSnapshot.termCodes = JSON.stringify(labels.map(canonicalTermCodeFromLabel));
    }

    const previous = new Map();
    SNAPSHOT_KEYS.forEach((key) => {
      previous.set(key, localStorage.getItem(planKey(pid, key)));
    });

    try {
      SNAPSHOT_KEYS.forEach((key) => {
        if (typeof normalizedSnapshot[key] !== 'string') {
          throw new Error(`Invalid planner snapshot field: ${key}`);
        }
        localStorage.setItem(planKey(pid, key), normalizedSnapshot[key]);
      });
      touchUpdated(pid);
      return true;
    } catch (err) {
      // localStorage has no transaction primitive. Restore the prior parallel
      // arrays on a partial write so a quota failure cannot leave them skewed.
      SNAPSHOT_KEYS.forEach((key) => {
        try {
          const oldValue = previous.get(key);
          if (oldValue === null) localStorage.removeItem(planKey(pid, key));
          else localStorage.setItem(planKey(pid, key), oldValue);
        } catch (_) {}
      });
      throw err;
    }
  }

  function capturePlanCheckpoint(planId) {
    const pid = planId || sessionPlanId || getActivePlanId();
    if (!hasPlanWithoutCreating(pid)) throw new Error('The plan is no longer available.');
    const prefix = planKey(pid, '');
    const values = {};
    listLocalStorageKeys().forEach((key) => {
      if (!key.startsWith(prefix)) return;
      const value = localStorage.getItem(key);
      if (value != null) values[key.slice(prefix.length)] = value;
    });
    return { planId: pid, values };
  }

  function restorePlanCheckpoint(checkpoint) {
    if (!checkpoint || typeof checkpoint !== 'object'
        || typeof checkpoint.planId !== 'string'
        || !checkpoint.values || typeof checkpoint.values !== 'object'
        || Array.isArray(checkpoint.values)) {
      throw new Error('Invalid plan checkpoint.');
    }
    const pid = checkpoint.planId;
    if (!hasPlanWithoutCreating(pid)) throw new Error('The plan is no longer available.');
    const prefix = planKey(pid, '');
    const values = checkpoint.values;
    const suffixes = Object.keys(values);
    if (suffixes.some((suffix) => !suffix || typeof values[suffix] !== 'string')) {
      throw new Error('Invalid plan checkpoint.');
    }

    // Remove newly-created entries first. This releases quota before restoring
    // any prior value and makes transcript-import rollback reliable even when
    // the failed save was caused by a full storage area.
    listLocalStorageKeys().forEach((key) => {
      if (!key.startsWith(prefix)) return;
      const suffix = key.slice(prefix.length);
      if (!Object.prototype.hasOwnProperty.call(values, suffix)) {
        localStorage.removeItem(key);
      }
    });
    suffixes.forEach((suffix) => localStorage.setItem(prefix + suffix, values[suffix]));
    return true;
  }

  function normalizePlanName(name) {
    const trimmed = String(name || '').trim().replace(/\s+/g, ' ');
    if (!trimmed) return null;
    return trimmed.slice(0, 60);
  }

  const modules = window.SurriculumModules || {};
  const planUi = modules.planUi;
  const planImportValidation = modules.planImportValidation;
  const planImportExport = modules.planImportExport;
  if (!planUi || !planImportValidation || !planImportExport
      || typeof planImportValidation.create !== 'function'
      || typeof planImportExport.create !== 'function') {
    throw new Error(
      'scripts/plan/ui.js, scripts/plan/import-validation.js, and '
      + 'scripts/plan/import-export.js must load before plan_manager.js'
    );
  }
  const uiModal = planUi.uiModal;
  const planValidation = planImportValidation.create({
    planExportVersion: PLAN_EXPORT_VERSION,
    maxPlans: MAX_PLANS,
    normalizePlanName,
    canonicalTermCodeFromLabel,
  });
  const planTransfer = planImportExport.create({
    planExportVersion: PLAN_EXPORT_VERSION,
    maxPlans: MAX_PLANS,
    defaultPlanName: DEFAULT_PLAN_NAME,
    nowIso,
    safeJsonParse,
    canonicalTermCodeFromLabel,
    planKey,
    listLocalStorageKeys,
    touchUpdated,
    ensureIndex,
    getPlanMeta,
    createId,
    saveIndex,
    validation: planValidation,
    storage: localStorage,
  });

  const planStorage = {
    maxPlans: MAX_PLANS,
    ensureIndex,
    getActivePlanId,
    getSessionPlanId,
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
    registerSaveHook(fn, options) {
      if (typeof fn !== 'function') return false;
      const opts = options || {};
      saveHooks.push({ fn, planId: opts.planId || null });
      return true;
    },
    requestSave,
    getChangeRevision() {
      return planChangeRevision;
    },
    flushSaves,
    suspendSaves,
    captureCheckpoint: capturePlanCheckpoint,
    restoreCheckpoint: restorePlanCheckpoint,
    hasPlan(id) {
      return hasPlanWithoutCreating(id);
    },
    clearAllAppData,
    getItem(key, planId) {
      const pid = planId || getActivePlanId();
      const raw = localStorage.getItem(planKey(pid, key));
      if (raw == null) return raw;
      if (String(key || '') === 'globalCourseMetadata') {
        return JSON.stringify(planTransfer.salvageStoredGlobalCourseMetadata(
          safeJsonParse(raw, []),
          'stored global course metadata',
        ));
      }
      if (!String(key || '').startsWith('customCourses_')) return raw;
      try {
        const program = String(key).slice('customCourses_'.length);
        const parsed = JSON.parse(raw);
        const normalized = planTransfer.validateCustomCourses({ [program]: parsed }, `stored custom courses.${program}`);
        return JSON.stringify(normalized[planTransfer.normalizeCustomCourseProgramCode(program, 'stored custom-course program')]);
      } catch (err) {
        try { console.warn('Ignoring invalid stored custom courses:', err); } catch (_) {}
        return '[]';
      }
    },
    setSnapshot: setPlanSnapshot,
    setItem(key, value, planId) {
      const pid = planId || getActivePlanId();
      if (planId && !hasPlanWithoutCreating(pid)) {
        throw new Error('The plan is no longer available.');
      }
      let storedValue = value;
      if (String(key || '').startsWith('customCourses_')) {
        const program = String(key).slice('customCourses_'.length);
        const parsed = JSON.parse(String(value || ''));
        const normalized = planTransfer.validateCustomCourses({ [program]: parsed }, `custom courses.${program}`);
        storedValue = JSON.stringify(normalized[planTransfer.normalizeCustomCourseProgramCode(program, 'custom-course program')]);
      } else if (String(key || '') === 'globalCourseMetadata') {
        storedValue = JSON.stringify(planTransfer.validateGlobalCourseMetadata(
          JSON.parse(String(value || '')),
          'global course metadata',
        ));
      }
      localStorage.setItem(planKey(pid, key), storedValue);
      touchUpdated(pid);
      return true;
    },
    removeItem(key, planId) {
      const pid = planId || getActivePlanId();
      if (planId && !hasPlanWithoutCreating(pid)) {
        throw new Error('The plan is no longer available.');
      }
      localStorage.removeItem(planKey(pid, key));
      touchUpdated(pid);
      return true;
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
      const srcPrefix = planKey(src, '');
      const dstPrefix = planKey(id, '');
      const keys = listLocalStorageKeys();
      const createdAt = nowIso();
      try {
        // Copy the complete namespace before publishing the new plan in the
        // shared index. localStorage has no transaction primitive, so keeping
        // the destination unindexed until the final write is the only way to
        // prevent a quota failure from exposing a partial plan.
        for (const k of keys) {
          if (!k.startsWith(srcPrefix)) continue;
          const rest = k.slice(srcPrefix.length);
          const val = localStorage.getItem(k);
          if (val != null) localStorage.setItem(dstPrefix + rest, val);
        }
        idx.plans.push({ id, name: n, createdAt, updatedAt: createdAt });
        saveIndex(idx);
      } catch (err) {
        // Best-effort rollback covers both a failed data copy and a failed
        // index write. The pre-existing source namespace is never touched.
        try {
          listLocalStorageKeys().forEach((key) => {
            if (key.startsWith(dstPrefix)) localStorage.removeItem(key);
          });
        } catch (_) {}
        throw err;
      }
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
      const deletingSessionPlan = sessionPlanId === id;
      const deletingSharedActivePlan = idx.activeId === id;
      const reloadsThisPage = deletingSessionPlan || deletingSharedActivePlan;
      if (reloadsThisPage && !flushSaves()) {
        return { ok: false, message: 'The visible plan could not be saved, so nothing was deleted.' };
      }

      // Remove all plan-scoped keys for this plan id
      const prefix = planKey(id, '');
      const keys = listLocalStorageKeys();
      for (const k of keys) {
        if (k.startsWith(prefix)) localStorage.removeItem(k);
      }

      idx.plans = idx.plans.filter(p => p.id !== id);
      let reloaded = false;
      if (deletingSharedActivePlan) {
        // Another tab may have made the deleted plan globally active. Keep
        // this page on the plan it actually rendered whenever that plan still
        // exists, instead of jumping to an unrelated first plan.
        idx.activeId = idx.plans.some((plan) => plan && plan.id === sessionPlanId)
          ? sessionPlanId : idx.plans[0].id;
      }
      saveIndex(idx);
      if (reloadsThisPage) {
        suspendSaves();
        location.reload();
        reloaded = true;
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
      const pid = id || sessionPlanId || getActivePlanId();
      if (pid === sessionPlanId) {
        if (!flushSaves()) {
          showSaveFailure();
          return false;
        }
      }
      const obj = planTransfer.buildExportObject(pid);
      const meta = getPlanMeta(pid);
      const fname = `surriculum-plan_${planTransfer.sanitizeFilename(meta?.name || 'plan')}_${nowIso().slice(0, 10)}.json`;
      planTransfer.downloadJson(fname, obj);
      return true;
    },
    async importPlanFile(file, options) {
      return planTransfer.importPlanFile(file, options);
    },
    importPlanObject: planTransfer.importPlanObject,
    validateImportObject: planTransfer.validateImportObject,
    normalizeCustomCourse(course) {
      return planTransfer.validateCustomCourse(course, 'custom course');
    },
    normalizeCustomCourseList(program, list) {
      const programCode = planTransfer.normalizeCustomCourseProgramCode(program, 'custom course program');
      const normalized = planTransfer.validateCustomCourses({ [programCode]: list }, 'custom courses');
      return normalized[programCode];
    },
  };

  // Boot
  ensureIndex();
  migrateLegacyIfNeeded();
  sessionPlanId = ensureIndex().activeId;
  initStorageSchemaVersion();
  window.planStorage = planStorage;
  window.uiModal = window.uiModal || uiModal;

  // Flush synchronously when a tab is backgrounded or leaves the page. These
  // events do not force a reload and remain safe with the back/forward cache.
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => flushSaves({ onlyIfPending: true }));
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushSaves({ onlyIfPending: true });
    });
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
      planUi.initPlanUi({
        ensureIndex,
        getPlanMeta,
        sessionPlanId,
        planStorage,
        maxPlans: MAX_PLANS,
        flushSaves,
        showSaveFailure,
        normalizePlanName,
        suspendSaves,
      });
      planUi.initStaticDisclosureA11y();
    });
  }
})();
