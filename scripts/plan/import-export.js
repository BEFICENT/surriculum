// Plan namespace serialization plus atomic export/import orchestration.
(function installPlanImportExport(root) {
  'use strict';

  function createPlanImportExport(context) {
    const deps = context || {};
    const {
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
      validation,
    } = deps;
    const localStorage = deps.storage || root.localStorage;
    if (!validation) {
      throw new Error('Plan import validation must be created before import/export');
    }
    const {
      maxFileBytes: IMPORT_MAX_FILE_BYTES,
      validateImportObject,
      validateCustomCourse,
      validateCustomCourses,
      validateGlobalCourseMetadata,
      salvageStoredGlobalCourseMetadata,
      normalizeCustomCourseProgramCode,
      canonicalizeGradingBases,
    } = validation;

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
      termCodes: safeJsonParse(get('termCodes') || 'null', null),
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
            )[normalizeCustomCourseProgramCode(program, 'stored custom-course program')];
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
      if (!Array.isArray(state.termCodes) || state.termCodes.length !== state.curriculum.length) {
        state.termCodes = Array.isArray(state.dates)
          ? state.dates.map(canonicalTermCodeFromLabel)
          : state.curriculum.map(() => '');
      }
      state.termCodes = state.termCodes.map((code, index) => {
        const stored = String(code || '').trim();
        const fromDate = Array.isArray(state.dates)
          ? canonicalTermCodeFromLabel(state.dates[index]) : '';
        return /^\d{4}(01|02|03)$/.test(stored) && (!fromDate || fromDate === stored)
          ? stored : fromDate;
      });
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
    if (state.termCodes != null) setJson('termCodes', state.termCodes);
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

    async function importPlanFile(file, options) {
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
      if (text.length > IMPORT_MAX_FILE_BYTES) {
        throw new Error('Plan file is too large (maximum 2 MB).');
      }
      const obj = safeJsonParse(text, null);
      return importExportObject(obj, options || { activate: true });
    }

    return Object.freeze({
      maxFileBytes: IMPORT_MAX_FILE_BYTES,
      validateImportObject,
      validateCustomCourse,
      validateCustomCourses,
      validateGlobalCourseMetadata,
      salvageStoredGlobalCourseMetadata,
      normalizeCustomCourseProgramCode,
      readPlanState,
      buildExportObject,
      downloadJson,
      sanitizeFilename,
      importPlanFile,
      importPlanObject: importExportObject,
      normalizeCustomCourse: validation.normalizeCustomCourse,
      normalizeCustomCourseList: validation.normalizeCustomCourseList,
    });
  }

  const namespace = root.SurriculumModules || (root.SurriculumModules = {});
  namespace.planImportExport = Object.freeze({ create: createPlanImportExport });
})(typeof window !== 'undefined' ? window : globalThis);
