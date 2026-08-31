// Restores plan-scoped course definitions before planner hydration, then
// enriches placeholders from the shipped university index without gating boot.
(function installSavedCourseRestoration(root) {
  'use strict';

  function createSavedCourseRestoration(options) {
    const config = options || {};
    const getCourseData = config.getCourseData;
    const getDoubleMajorCourseData = config.getDoubleMajorCourseData;
    const getCurriculum = config.getCurriculum;
    const planGetItem = config.planGetItem;
    const parseCreditValue = config.parseCreditValue;
    const formatCreditValue = config.formatCreditValue;
    const evaluateGrade = config.evaluateGrade;

    if (typeof getCourseData !== 'function'
      || typeof getDoubleMajorCourseData !== 'function'
      || typeof getCurriculum !== 'function'
      || typeof planGetItem !== 'function'
      || typeof parseCreditValue !== 'function'
      || typeof formatCreditValue !== 'function'
      || typeof evaluateGrade !== 'function') {
      throw new TypeError('Saved-course restoration dependencies are required.');
    }

    const recordCode = (record) => String(
      record && record.code
        ? record.code
        : String((record && record.Major) || '') + String((record && record.Code) || ''),
    ).toUpperCase().replace(/\s+/g, '');

    function restore() {
      let saved = null;
      try {
        saved = JSON.parse(planGetItem('curriculum') || 'null');
      } catch (_) {
        saved = null;
      }
      if (!Array.isArray(saved)) return { added: [], missing: [] };

      const normalizedCodes = [];
      const seen = new Set();
      saved.forEach((semester) => {
        if (!Array.isArray(semester)) return;
        semester.forEach((rawCode) => {
          const code = String(rawCode || '').toUpperCase().replace(/\s+/g, '');
          if (!code || seen.has(code)) return;
          seen.add(code);
          normalizedCodes.push(code);
        });
      });
      if (!normalizedCodes.length) return { added: [], missing: [] };

      const courseData = getCourseData();
      const curriculum = getCurriculum();
      const selectedLists = [courseData, getDoubleMajorCourseData()];
      try {
        if (curriculum && curriculum.minorCourseDataByCode) {
          Object.values(curriculum.minorCourseDataByCode).forEach((list) => selectedLists.push(list));
        }
      } catch (_) {}
      const selectedCodes = new Set();
      selectedLists.forEach((list) => {
        if (!Array.isArray(list)) return;
        list.forEach((record) => {
          if (record && !record.__globalCourseDefinition) selectedCodes.add(recordCode(record));
        });
      });
      const unresolved = normalizedCodes.filter((code) => !selectedCodes.has(code));
      if (!unresolved.length) return { added: [], missing: [] };

      const storedMetadata = root && typeof root.getStoredGlobalCourseMetadata === 'function'
        ? root.getStoredGlobalCourseMetadata() : new Map();
      const preserved = [];
      unresolved.forEach((code) => {
        if (courseData.some((record) => recordCode(record) === code)) return;
        const match = code.match(/^([A-Z]{1,12})(\d[A-Z0-9]*)$/);
        if (!match) return;
        const metadata = storedMetadata.get(code) || {};
        const placeholder = {
          Major: match[1],
          Code: match[2],
          Course_Name: String(metadata.title || code),
          ECTS: String(Number.isFinite(Number(metadata.ects)) ? Number(metadata.ects) : 0),
          Engineering: 0,
          Basic_Science: 0,
          SU_credit: String(Number.isFinite(Number(metadata.suCredits)) ? Number(metadata.suCredits) : 0),
          Faculty: '',
          Faculty_Course: 'No',
          EL_Type: 'unknown',
          __globalCourseDefinition: true,
          __storedCoursePlaceholder: true,
        };
        courseData.push(placeholder);
        preserved.push(placeholder);
      });
      return { added: [], missing: unresolved.slice(), preserved };
    }

    async function enrich(restoration) {
      const pending = restoration && Array.isArray(restoration.preserved)
        ? restoration.preserved.slice() : [];
      if (!pending.length || !root
        || typeof root.loadCoursePageInfoIndex !== 'function'
        || typeof root.resolveGlobalCourseDefinition !== 'function') return;

      try {
        await root.loadCoursePageInfoIndex();
      } catch (_) {
        return;
      }

      const storedMetadata = typeof root.getStoredGlobalCourseMetadata === 'function'
        ? root.getStoredGlobalCourseMetadata() : new Map();
      const courseData = getCourseData();
      const resolvedByCode = new Map();
      pending.forEach((placeholder) => {
        const code = recordCode(placeholder);
        if (!code) return;
        let resolved = null;
        try {
          resolved = root.resolveGlobalCourseDefinition(code, storedMetadata.get(code) || {});
        } catch (_) {}
        if (!resolved) return;
        const index = courseData.findIndex((record) => recordCode(record) === code);
        if (index < 0 || (courseData[index] && !courseData[index].__globalCourseDefinition)) return;
        courseData[index] = resolved;
        resolvedByCode.set(code, resolved);
        try {
          if (typeof root.rememberGlobalCourseDefinition === 'function') {
            root.rememberGlobalCourseDefinition(resolved);
          }
        } catch (_) {}
      });
      if (!resolvedByCode.size) return;

      const curriculum = getCurriculum();
      (curriculum && Array.isArray(curriculum.semesters) ? curriculum.semesters : []).forEach((semester) => {
        semester.totalGPA = 0;
        semester.totalGPACredits = 0;
        (Array.isArray(semester.courses) ? semester.courses : []).forEach((course) => {
          const definition = resolvedByCode.get(recordCode(course));
          if (definition) {
            course.SU_credit = parseCreditValue(definition.SU_credit || 0);
            course.Basic_Science = Number(definition.Basic_Science || 0) || 0;
            course.Engineering = Number(definition.Engineering || 0) || 0;
            course.ECTS = Number(definition.ECTS || 0) || 0;
            course.Faculty_Course = definition.Faculty_Course || 'No';
            course.Faculty = definition.Faculty || '';
            const document = root.document;
            const node = document && course.id ? document.getElementById(course.id) : null;
            const nameNode = node && node.querySelector('.course_name');
            const creditNode = node && node.querySelector('.course_credit');
            const scienceNode = node && node.querySelector('.course_bs_credit');
            if (nameNode) nameNode.textContent = String(definition.Course_Name || course.code || '');
            if (creditNode) creditNode.textContent = formatCreditValue(course.SU_credit) + ' credits';
            if (scienceNode) scienceNode.textContent = 'BS: ' + course.Basic_Science + ' credits';
          }
          const outcome = evaluateGrade(course.grade, course.gradingBasis);
          if (outcome && outcome.countsInGpa) {
            const credit = Number(course.SU_credit || 0) || 0;
            semester.totalGPA += credit * outcome.gpaPoints;
            semester.totalGPACredits += credit;
          }
        });
      });
      try {
        if (curriculum && typeof curriculum.recalcEffectiveTypes === 'function') {
          curriculum.recalcEffectiveTypes(courseData);
        }
      } catch (_) {}
    }

    return Object.freeze({ recordCode, restore, enrich });
  }

  const api = Object.freeze({ createSavedCourseRestoration });
  if (root) root.surriculumSavedCourseRestoration = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
