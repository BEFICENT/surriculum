// Scheduler term-scoped requirement and prior-course context.
(function (root) {
  'use strict';

  function createTermContextTools(options) {
    const config = options || {};
    const window = config.window || root;
    const termCode = String(config.termCode || '');
    const normalizeCourseId = config.normalizeCourseId;
    const normalizePlannerCode = config.normalizePlannerCode;
    const getSelected = config.getSelected;
    if (!window || typeof normalizeCourseId !== 'function' || typeof normalizePlannerCode !== 'function'
        || typeof getSelected !== 'function') {
      throw new TypeError('Scheduler term context dependencies are incomplete.');
    }

    const buildSchedulerRequirementContext = () => {
      try {
        const cur = (typeof window !== 'undefined') ? window.curriculum : null;
        const filters = (typeof window !== 'undefined') ? window.courseFilters : null;
        const shared = (typeof window !== 'undefined') ? window.courseRequisites : null;
        if (!cur) return null;
        let context = filters && typeof filters.buildTargetContext === 'function'
          ? filters.buildTargetContext(cur, termCode) : null;
        if (!context && shared && typeof shared.buildTermRequirementContext === 'function') {
          context = shared.buildTermRequirementContext(
            cur.semesters,
            termCode,
            (course) => (
              typeof cur.isDegreeEligibleCourse !== 'function'
              || cur.isDegreeEligibleCourse(course)
            ),
          );
          if (context && filters && typeof filters.buildProgramProfiles === 'function') {
            context.programProfiles = filters.buildProgramProfiles(cur);
          }
        }
        if (!context || typeof context !== 'object') return null;

        // A Scheduler selection is a same-term occurrence.  This preserves
        // explicit concurrent-prerequisite behavior without allowing it to
        // contribute to strictly-prior course or SU requirements.
        const targetTerm = Number(context.targetTerm) || Number(termCode) || 0;
        const occurrences = Array.isArray(context.occurrences)
          ? context.occurrences.slice() : [];
        const throughCodes = context.throughCodes && typeof context.throughCodes.has === 'function'
          ? new Set(context.throughCodes) : new Set();
        const present = new Set(occurrences.map((occurrence) => (
          normalizeCourseId(occurrence && occurrence.code)
        )).filter(Boolean));
        Object.keys(getSelected() || {}).forEach((rawCode) => {
          const code = normalizeCourseId(rawCode);
          if (!code) return;
          throughCodes.add(code);
          if (present.has(code)) return;
          occurrences.push({
            code,
            term: targetTerm,
            eligible: true,
            course: { code, grade: '' },
            semester: { termCode },
          });
        });
        return Object.assign({}, context, { occurrences, throughCodes });
      } catch (_) {
        return null;
      }
    };

    // The earlier-planned filter treats a course as matched only if it's planned for
    // the scheduler's selected term OR an earlier one. A course planned solely
    // for a LATER term hasn't been taken yet as of the selected term, so it must
    // stay visible instead of being filtered out. (Current-term planned/selected
    // courses are also kept visible via keepVisible so users can schedule them.)
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
            const cid = normalizePlannerCode(cc && cc.code);
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
            const cid = normalizePlannerCode(cc && cc.code);
            if (cid) out.add(cid);
          }
        }
        return out;
      } catch (_) {
        return null;
      }
    };

    return Object.freeze({
      buildSchedulerRequirementContext,
      computeTakenUpToTermSet,
      computeTakenBeforeCurrentTermSet,
    });
  }

  const api = Object.freeze({ createTermContextTools });
  if (root) root.SurriculumSchedulerTermContext = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
