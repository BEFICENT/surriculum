// Scheduler result query, filtering, scoring, and keyed-card controller.
(function installSchedulerResultsController(root) {
  'use strict';

  const schedulerResultFiltering = (root && root.SurriculumSchedulerResultFiltering)
    || (typeof module !== 'undefined' && module.exports ? require('./results-filtering.js') : null);
  const schedulerResultCard = (root && root.SurriculumSchedulerResultCard)
    || (typeof module !== 'undefined' && module.exports ? require('./result-card.js') : null);
  if (!schedulerResultFiltering || !schedulerResultCard) {
    throw new Error('Scheduler result helper modules are not loaded.');
  }

  function createResultsController(options) {
    const config = options || {};
    const foundation = config.foundation;
    const session = config.session;
    const window = config.window || root;
    const document = config.document || (window && window.document);
    const controls = config.controls || {};
    const resultsReconciler = config.resultsReconciler;
    if (!foundation || !session || !window || !document || !resultsReconciler
        || !config.results || typeof config.results.parsePrerequisiteAst !== 'function'
        || typeof config.results.evaluatePrerequisiteAst !== 'function') {
      throw new TypeError('Scheduler results controller dependencies are incomplete.');
    }
    const {
      normalizeCourseId,
      escapeHtml,
      preferenceGetItem,
      preferenceSetItem,
      loadTermScheduleIndex,
    } = foundation;
    const termCode = String(config.termCode || '');
    const plannedCourses = Array.isArray(config.plannedCourses) ? config.plannedCourses : [];
    const normalizePlannerCode = config.normalizePlannerCode;
    const sectionInstructorPreview = config.sectionInstructorPreview;
    const sectionMeetingPreview = config.sectionMeetingPreview;
    const buildDetailUrl = config.buildDetailUrl;
    const getCourseDetails = config.getCourseDetails;
    const fmtCredit = config.formatCredit;
    const buildSchedulerRequirementContext = config.buildSchedulerRequirementContext;
    const computeTakenUpToTermSet = config.computeTakenUpToTermSet;
    const computeTakenBeforeCurrentTermSet = config.computeTakenBeforeCurrentTermSet;
    const buildReverseCoreqIndex = (...args) => config.buildReverseCoreqIndex(...args);
    const getCoreqsFor = (...args) => config.getCoreqsFor(...args);
    const getSelectedSection = (...args) => config.getSelectedSection(...args);
    const canFitWithBlockedHours = (...args) => config.canFitWithBlockedHours(...args);
    const getOccupiedByDayFromSelected = (...args) => config.getOccupiedByDayFromSelected(...args);
    const sectionAvailabilityClasses = (...args) => config.sectionAvailabilityClasses(...args);
    const getRequiredBundleCourseIds = (...args) => config.getRequiredBundleCourseIds(...args);
    const pickBestBundleSections = (...args) => config.pickBestBundleSections(...args);
    const reconcileRenderedResults = () => config.reconcileRenderedResults();
    const schedulerIsMounted = () => config.schedulerIsMounted();
    const renderSelected = () => config.renderSelected();
    const resetHover = () => config.resetHover();
    const {
      body,
      resultsElement,
      searchElement,
      loadMoreButton,
      filterButton,
      filterCountElement,
      filterMenuElement,
      hideTakenToggle,
      detailsToggle,
      scoreToggle,
      hoverPreviewToggle,
      highlightToggle,
      showBlockedToggle,
      minMainTypeSelect,
      minDmTypeSelect,
      minMinorTypeSelect,
      minSuInput,
      minEctsInput,
      minBsInput,
      minEngInput,
      prereqToggle,
      showUnmetPrereqToggle,
    } = controls;
    const resultsEl = resultsElement;
    const searchEl = searchElement;
    const loadMoreBtn = loadMoreButton;
    const filterBtn = filterButton;
    const filterCountEl = filterCountElement;
    const filterMenuEl = filterMenuElement;
    let takenUpToTermSet = null;
    const prereqCheckCache = { sig: '', map: new Map() };
    const prereqAstCache = new Map();
    const expandedResultSections = new Set();
    let searchRenderTimer = null;
    const numericInputTimers = new Set();

    const filtering = schedulerResultFiltering.createResultFiltering({
      window,
      termCode,
      preferenceGetItem,
      preferenceSetItem,
      controls,
    });
    const {
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
      syncFilterButtonFeedback,
      setFilterMenuOpen,
      isFilterMenuOpen,
      buildScoreRanker,
      computeScore,
    } = filtering;

    let resultsLimit = 60;
    let lastQuery = '';
    const isTakenCourse = (courseId) => {
      try {
        const id = normalizePlannerCode(courseId);
        if (!id) return false;
        if (takenUpToTermSet instanceof Set) return takenUpToTermSet.has(id);
        const curriculum = window.curriculum;
        return !!(curriculum && typeof curriculum.hasCourse === 'function' && curriculum.hasCourse(id));
      } catch (_) { return false; }
    };

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

    const resultCardRenderer = schedulerResultCard.createResultCardRenderer({
      window,
      coursePreviewInstructor,
      buildDetailUrl,
      shouldShowDetails,
      getCourseDetails,
      normalizeCourseId,
      getCoreqsFor,
      sectionMeetingPreview,
      sectionInstructorPreview,
      sectionAvailabilityClasses,
      escapeHtml,
      getSelectedSection,
      expandedResultSections,
      shouldHighlightAvailability,
      getRequiredBundleCourseIds,
      pickBestBundleSections,
      shouldShowBlockedCourses,
      normalizePlannerCode,
      canFitWithBlockedHours,
      formatCredit: fmtCredit,
    });

    const renderResults = (scheduleIndex, query) => {
      syncFilterButtonFeedback();
      const qRaw = String(query || '').trim();
      const q = qRaw.toLowerCase();
      lastQuery = q;
      const selected = session.selected || {};
      const blocked = Array.isArray(session.blocked) ? session.blocked : [];
      const coursePageInfoMap = session.coursePageInfoMap;
      const missingByCourse = session.missingByCourse || {};
      const orphanByCourse = session.orphanByCourse || {};
      let reverseCoreqIndex = session.reverseCoreqIndex;
      let takenBeforeCurrentSet = null;

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

      const queryMode = (() => {
        try {
          const raw = qRaw;
          const code = normalizeCourseId(raw); // upper alnum
          if (!raw || !code) {
            return {
              mode: 'text', subject: '', codePrefix: '', canonicalCodePrefix: '', extra: '',
            };
          }

          const m = raw.match(/^\s*([A-Za-z]{2,5})\s*[-]?\s*([0-9]{1,5}[A-Za-z0-9]?)?(.*)$/);
          const subj = m ? String(m[1] || '').toUpperCase() : '';
          const numb = m && m[2] ? String(m[2] || '').toUpperCase() : '';
          const rest = m ? String(m[3] || '').trim().toLowerCase() : '';

          if (subj && !numb && /^[A-Z]{2,5}$/.test(subj) && subjectSet && subjectSet.has(subj)) {
            if (!rest) return { mode: 'subject', subject: subj, codePrefix: subj, extra: '' };
            return { mode: 'subjectText', subject: subj, codePrefix: subj, extra: rest };
          }
          const rawCodePrefix = subj + numb;
          const aliasCode = rawCodePrefix === 'CS210' || rawCodePrefix === 'DSA210';
          if (subj && numb && /^[A-Z]{2,5}$/.test(subj)
            && /^[0-9]{1,5}[A-Z0-9]?$/.test(numb)
            && subjectSet && (subjectSet.has(subj) || aliasCode)) {
            return {
              mode: 'code',
              subject: subj,
              codePrefix: rawCodePrefix,
              canonicalCodePrefix: normalizePlannerCode(rawCodePrefix),
              extra: rest,
            };
          }
          return {
            mode: 'text', subject: '', codePrefix: '', canonicalCodePrefix: '', extra: '',
          };
        } catch (_) {
          return {
            mode: 'text', subject: '', codePrefix: '', canonicalCodePrefix: '', extra: '',
          };
        }
      })();

      try { takenUpToTermSet = computeTakenUpToTermSet(); } catch (_) { takenUpToTermSet = null; }
      try { takenBeforeCurrentSet = computeTakenBeforeCurrentTermSet(); } catch (_) { takenBeforeCurrentSet = null; }
      session.takenBeforeCurrentTermSet = takenBeforeCurrentSet;

      const takenBeforeSetForHighlight = shouldHighlightAvailability()
        && takenBeforeCurrentSet instanceof Set ? takenBeforeCurrentSet : null;

      try {
        if (!reverseCoreqIndex && coursePageInfoMap) {
          reverseCoreqIndex = buildReverseCoreqIndex(scheduleIndex);
          session.reverseCoreqIndex = reverseCoreqIndex;
        }
      } catch (_) {}

      const keepVisible = new Set();
      try {
        plannedCourses.forEach(c => keepVisible.add(normalizePlannerCode(c)));
      } catch (_) {}
      try {
        Object.keys(selected).forEach(c => keepVisible.add(normalizePlannerCode(c)));
      } catch (_) {}
      try {
        const keys = Object.keys(selected);
        for (let i = 0; i < keys.length; i++) {
          const c = keys[i];
          getCoreqsFor(c).forEach(x => keepVisible.add(normalizePlannerCode(x)));
        }
      } catch (_) {}
      try {
        for (const k of Object.keys(missingByCourse || {})) {
          const arr = missingByCourse[k];
          if (!Array.isArray(arr)) continue;
          arr.forEach(x => keepVisible.add(normalizePlannerCode(x)));
        }
      } catch (_) {}
      try {
        for (const k of Object.keys(orphanByCourse || {})) {
          const arr = orphanByCourse[k];
          if (!Array.isArray(arr)) continue;
          arr.forEach(x => keepVisible.add(normalizePlannerCode(x)));
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
      const requirementEvaluationById = new Map(); // course_id -> shared evaluator result
      const takenBeforeSet = checkPrereqs
        ? (takenBeforeCurrentSet instanceof Set ? takenBeforeCurrentSet : new Set())
        : null;
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
          Object.keys(selected || {}).forEach((code) => out.add(normalizePlannerCode(code)));
        } catch (_) {}
        return out;
      })();
      const schedulerRequirementContext = checkPrereqs
        ? buildSchedulerRequirementContext() : null;
      const takenBeforeSig = (() => {
        try {
          if (!checkPrereqs || !takenBeforeSet || !(takenBeforeSet instanceof Set)) return '';
          return Array.from(takenBeforeSet).sort().join('|')
            + '::' + Array.from(concurrentPrereqSet).sort().join('|')
            + '::su=' + String(priorEligibleSu)
            + '::profiles=' + (
              schedulerRequirementContext
              && Array.isArray(schedulerRequirementContext.programProfiles)
                ? schedulerRequirementContext.programProfiles.map((profile) => (
                  `${profile.role || ''}:${profile.program || ''}:${profile.admitTermCode || ''}:${profile.universityAdmitTermCode || ''}`
                )).join('|') : ''
            );
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
              const cached = prereqCheckCache.map.get(cid);
              if (cached && cached.evaluation) {
                requirementEvaluationById.set(cid, cached.evaluation);
              }
              return cached;
            }
          } catch (_) {}
          const info = coursePageInfoMap.get(cid);
          if (!info) return null;
          const text = info.prerequisites ? String(info.prerequisites || '') : '';

          // The planner uses this same evaluator. Keep the older local parser
          // below only as a defensive fallback for a partially cached shell.
          try {
            const shared = (typeof window !== 'undefined') ? window.courseRequisites : null;
            if (shared && typeof shared.evaluateCandidateForTerm === 'function'
              && schedulerRequirementContext) {
              const evaluation = shared.evaluateCandidateForTerm(
                info,
                cid,
                schedulerRequirementContext,
              );
              if (evaluation) requirementEvaluationById.set(cid, evaluation);
              const sharedResult = evaluation && evaluation.prerequisite
                ? evaluation.prerequisite : null;
              const priorSuRequirement = evaluation && evaluation.priorSuRequirement
                ? evaluation.priorSuRequirement : null;
              const result = evaluation && (
                evaluation.status === 'unmet'
                || evaluation.status === 'review'
                || (evaluation.supplemental && evaluation.supplemental.hasRule)
              )
                ? {
                  ...(sharedResult || {
                    mode: 'expr', required: [], concurrent: [], oneOf: [], oneOfConcurrent: [],
                  }),
                  priorSuRequirement,
                  status: evaluation.status,
                  supplemental: evaluation.supplemental || null,
                  legacy: evaluation.legacy || null,
                  filterBlocking: evaluation.filterBlocking === true,
                  evaluation,
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

          let ast = prereqAstCache.get(cid);
          if (!prereqAstCache.has(cid)) {
            ast = config.results.parsePrerequisiteAst(text);
            prereqAstCache.set(cid, ast);
          }
          if (!ast) return null;
          const evaluation = config.results.evaluatePrerequisiteAst(ast, takenBeforeSet, normalizePlannerCode);
          const result = evaluation && evaluation.ok ? null : { mode: 'expr', required: evaluation ? evaluation.required : [], oneOf: evaluation ? evaluation.oneOf : [] };
          try { prereqCheckCache.map.set(cid, result); } catch (_) {}
          return result;
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
              if (isTakenCourse(id) && !keepVisible.has(normalizePlannerCode(id))) return;
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
            const canonicalCid = normalizePlannerCode(cid);
            const matchesRawPrefix = !!(cid && cid.startsWith(queryMode.codePrefix));
            const matchesCanonicalPrefix = !!(
              canonicalCid
              && queryMode.canonicalCodePrefix
              && canonicalCid.startsWith(queryMode.canonicalCodePrefix)
            );
            if (!matchesRawPrefix && !matchesCanonicalPrefix) continue;
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

        try {
          const cid = normalizeCourseId(id);
          const registry = (typeof window !== 'undefined') ? window.registrationRules : null;
          const componentMetadata = registry && typeof registry.getComponentMetadata === 'function'
            ? registry.getComponentMetadata(cid) : null;
          if (componentMetadata && componentMetadata.plannerCourse === false) {
            const parentId = normalizeCourseId(componentMetadata.parentCourseCode);
            if (q && parentId) {
              const parentEntry = scheduleIndex.get(parentId);
              if (parentEntry) addEntry(parentEntry);
            }
            continue;
          }
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
            if (isTakenCourse(cid) && !keepVisible.has(normalizePlannerCode(cid))) continue;
          }
        } catch (_) {}

        try {
          if (Array.isArray(blocked) && blocked.length) {
            const cid = normalizeCourseId(id);
            if (cid && !keepVisible.has(normalizePlannerCode(cid))) {
              const ok = canFitWithBlockedHours(scheduleIndex, cid);
              if (!ok && !shouldShowBlockedCourses()) continue;
            }
          }
        } catch (_) {}

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

        try {
          if (checkPrereqs) {
            const cid = normalizeCourseId(id);
            if (cid) {
              const unmet = getUnmetPrereqs(cid);
              const hasUnmet = (() => {
                try {
                  if (!unmet) return false;
                  if (unmet.supplemental && unmet.supplemental.hasRule) {
                    return unmet.filterBlocking === true
                      || unmet.supplemental.definitiveUnmet === true;
                  }
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
                if (!showUnmetPrereqs && !keepVisible.has(normalizePlannerCode(cid))) continue;
              }
            }
          }
        } catch (_) {}
        addEntry(entry);
      }
      const items = Array.from(itemsById.values());
      try {
        if (shouldSortByScore()) {
          const ranker = items.length ? buildScoreRanker() : null;
          for (let i = 0; i < items.length; i++) {
            const it = items[i];
            if (!it) continue;
            it.__score = computeScore(it.course_id, ranker);
          }
          items.sort((a, b) => {
            if (checkPrereqs) {
              const aBlocked = unmetPrereqById.has(normalizeCourseId(a && a.course_id)) ? 1 : 0;
              const bBlocked = unmetPrereqById.has(normalizeCourseId(b && b.course_id)) ? 1 : 0;
              if (aBlocked !== bBlocked) return aBlocked - bBlocked;
            }
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

      resultsReconciler.renderKeyedHtml(limited.length
        ? limited.map((entry) => resultCardRenderer.renderCard({
          entry,
          selected,
          missingByCourse,
          scheduleIndex,
          unmetPrereqById,
          requirementEvaluationById,
          takenBeforeSetForHighlight,
          occForAvailability,
          blocked,
          keepVisible,
        }))
        : '<div class="scheduler-muted">No courses match your search.</div>');


      try {
        if (loadMoreBtn) {
          const more = items.length > resultsLimit;
          loadMoreBtn.style.display = more ? 'inline-flex' : 'none';
          if (more) loadMoreBtn.textContent = `Load more (${Math.min(resultsLimit + 60, items.length)}/${items.length})`;
        }
      } catch (_) {}

      reconcileRenderedResults();
    };

    const disposers = [];
    const listen = (target, type, listener) => {
      if (!target || typeof target.addEventListener !== 'function') return;
      target.addEventListener(type, listener);
      disposers.push(() => target.removeEventListener(type, listener));
    };
    const rerender = () => {
      try { if (session.scheduleIndex) renderResults(session.scheduleIndex, lastQuery); } catch (_) {}
    };
    const broadcast = (name) => {
      try { document.dispatchEvent(new window.Event(name)); } catch (_) {}
    };
    listen(filterBtn, 'click', (event) => {
      try { event.preventDefault(); event.stopPropagation(); } catch (_) {}
      setFilterMenuOpen(!isFilterMenuOpen());
    });
    listen(body, 'click', (event) => {
      if (!isFilterMenuOpen()) return;
      const target = event && event.target;
      if (target && !(filterMenuEl && filterMenuEl.contains(target)) && !(filterBtn && filterBtn.contains(target))) setFilterMenuOpen(false);
    });
    listen(hideTakenToggle, 'change', () => {
      setGlobalBool('hideTakenCourses', !!hideTakenToggle.checked);
      syncFilterButtonFeedback();
      broadcast('hideTakenCoursesToggleChanged');
      rerender();
    });
    listen(detailsToggle, 'change', () => {
      setGlobalBool('showCourseDetails', !!detailsToggle.checked);
      broadcast('courseDetailsToggleChanged');
      try { renderSelected(); } catch (_) {}
      rerender();
    });
    listen(scoreToggle, 'change', () => {
      setGlobalBool('sortBasedOnScore', !!scoreToggle.checked);
      broadcast('sortByScoreToggleChanged');
      rerender();
    });
    const bindShared = (name, toggle, globalKey, after) => listen(document, name, () => {
      if (!toggle || typeof window[globalKey] !== 'boolean' || toggle.checked === !!window[globalKey]) return;
      toggle.checked = !!window[globalKey];
      if (after) after();
      rerender();
    });
    bindShared('hideTakenCoursesToggleChanged', hideTakenToggle, 'hideTakenCourses', syncFilterButtonFeedback);
    bindShared('courseDetailsToggleChanged', detailsToggle, 'showCourseDetails', renderSelected);
    bindShared('sortByScoreToggleChanged', scoreToggle, 'sortBasedOnScore');
    listen(hoverPreviewToggle, 'change', () => {
      preferenceSetItem('schedulerHoverPreview', hoverPreviewToggle.checked ? 'true' : 'false');
      resetHover();
    });
    listen(highlightToggle, 'change', () => {
      preferenceSetItem('schedulerHighlightAvailability', highlightToggle.checked ? 'true' : 'false');
      rerender();
    });
    listen(showBlockedToggle, 'change', () => {
      preferenceSetItem('schedulerShowBlockedCourses', showBlockedToggle.checked ? 'true' : 'false');
      syncFilterButtonFeedback();
      rerender();
    });
    [[minMainTypeSelect, 'schedulerMinMajorType'], [minDmTypeSelect, 'schedulerMinDmType'], [minMinorTypeSelect, 'schedulerMinMinorType']]
      .forEach(([element, key]) => listen(element, 'change', () => {
        preferenceSetItem(key, String(element.value || ''));
        syncFilterButtonFeedback();
        rerender();
      }));
    [[minSuInput, 'schedulerMinSuCredits'], [minEctsInput, 'schedulerMinEcts'], [minBsInput, 'schedulerMinBasicScience'], [minEngInput, 'schedulerMinEngineering']]
      .forEach(([element, key]) => {
        let timer = null;
        const flush = () => {
          if (timer) { clearTimeout(timer); numericInputTimers.delete(timer); }
          timer = null;
          preferenceSetItem(key, String(element.value || ''));
          syncFilterButtonFeedback();
          rerender();
        };
        listen(element, 'input', () => {
          syncFilterButtonFeedback();
          if (timer) { clearTimeout(timer); numericInputTimers.delete(timer); }
          timer = setTimeout(flush, 120);
          numericInputTimers.add(timer);
        });
        listen(element, 'change', flush);
      });
    listen(prereqToggle, 'change', () => {
      preferenceSetItem('schedulerCheckPrereqs', prereqToggle.checked ? 'true' : 'false');
      syncPrereqUi(); syncFilterButtonFeedback(); rerender();
    });
    listen(showUnmetPrereqToggle, 'change', () => {
      preferenceSetItem('schedulerShowUnmetPrereqs', showUnmetPrereqToggle.checked ? 'true' : 'false');
      syncFilterButtonFeedback(); rerender();
    });
    listen(loadMoreBtn, 'click', async () => {
      resultsLimit += 60;
      const index = session.scheduleIndex || await loadTermScheduleIndex(termCode);
      if (index) { session.scheduleIndex = index; renderResults(index, lastQuery); }
    });
    listen(searchEl, 'input', () => {
      if (searchRenderTimer) clearTimeout(searchRenderTimer);
      searchRenderTimer = setTimeout(() => {
        searchRenderTimer = null;
        if (!schedulerIsMounted() || !session.scheduleIndex) return;
        resultsLimit = 60;
        renderResults(session.scheduleIndex, searchEl.value);
      }, 80);
    });

    return Object.freeze({
      renderResults,
      getLastQuery: () => lastQuery,
      resetLimit: () => { resultsLimit = 60; },
      expandedResultSections,
      shouldShowDetails,
      shouldHoverPreview,
      shouldHighlightAvailability,
      shouldShowBlockedCourses,
      isFilterMenuOpen,
      setFilterMenuOpen,
      syncFilterButtonFeedback,
      dispose() {
        if (searchRenderTimer) clearTimeout(searchRenderTimer);
        numericInputTimers.forEach(timer => clearTimeout(timer));
        disposers.splice(0).forEach(dispose => { try { dispose(); } catch (_) {} });
      },
    });
  }

  const api = Object.freeze({ createResultsController });
  if (root) root.SurriculumSchedulerResultsController = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
