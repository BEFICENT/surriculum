// Pure, advisory undergraduate course-retake policy.
//
// This layer deliberately handles exact course-code repetitions only. A
// different-code course substitution has separate university approval rules
// and must not be inferred from catalog titles or curriculum categories.

(function () {
  'use strict';

  const PASSING_GRADES = new Set([
    'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'S',
  ]);
  const UNRESTRICTED_RETAKE_GRADES = new Set(['F', 'U', 'NA', 'W']);
  const UNFINISHED_GRADES = new Set(['', 'P', 'I']);
  const MAX_PASSING_RETAKE_STEPS = 3;

  function normalizeCourseCode(value) {
    return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  function termValue(value) {
    if (!value || typeof value !== 'object') return value;
    return value.termCode || value.termName || value.date || value.term || '';
  }

  function normalizeTermCode(value, options) {
    const raw = String(termValue(value) || '').trim();
    if (!raw) return '';
    if (/^\d{4}(01|02|03)$/.test(raw)) return raw;

    let converted = '';
    const injected = options && typeof options.normalizeTerm === 'function'
      ? options.normalizeTerm : null;
    try {
      if (injected) converted = String(injected(raw) || '').trim();
      else if (typeof window !== 'undefined'
        && typeof window.normalizeTermIdentifier === 'function') {
        converted = String(window.normalizeTermIdentifier(raw) || '').trim();
      } else if (typeof window !== 'undefined'
        && typeof window.termNameToCode === 'function') {
        converted = String(window.termNameToCode(raw) || '').trim();
      }
    } catch (_) {
      converted = '';
    }
    if (/^\d{4}(01|02|03)$/.test(converted)) return converted;

    const label = raw.match(/^(Fall|Spring|Summer)\s+(\d{4})-(\d{4})$/i);
    if (!label || Number(label[3]) !== Number(label[2]) + 1) return '';
    const suffix = { fall: '01', spring: '02', summer: '03' }[label[1].toLowerCase()];
    return label[2] + suffix;
  }

  function compareTermCodes(left, right, options) {
    const a = normalizeTermCode(left, options);
    const b = normalizeTermCode(right, options);
    if (!a || !b) return null;
    const difference = Number(a) - Number(b);
    return difference === 0 ? 0 : (difference < 0 ? -1 : 1);
  }

  // Fall and Spring each advance the repeat window by one step. Summer sits
  // chronologically after Spring but does not consume another step.
  function regularSemesterPosition(termCode) {
    const code = normalizeTermCode(termCode);
    if (!code) return null;
    const year = Number(code.slice(0, 4));
    const suffix = code.slice(4);
    if (suffix === '01') return year * 2;
    if (suffix === '02' || suffix === '03') return year * 2 + 1;
    return null;
  }

  function regularSemesterSteps(sourceTerm, targetTerm, options) {
    const source = normalizeTermCode(sourceTerm, options);
    const target = normalizeTermCode(targetTerm, options);
    if (!source || !target || Number(target) <= Number(source)) return null;
    const sourcePosition = regularSemesterPosition(source);
    const targetPosition = regularSemesterPosition(target);
    if (sourcePosition === null || targetPosition === null) return null;
    const steps = targetPosition - sourcePosition;
    return steps >= 0 ? steps : null;
  }

  function normalizeGradeToken(rawGrade, options, course) {
    let normalized;
    const normalizeGrade = options && typeof options.normalizeGrade === 'function'
      ? options.normalizeGrade : null;
    try {
      normalized = normalizeGrade ? normalizeGrade(rawGrade, course) : undefined;
    } catch (_) {
      normalized = null;
    }
    if (normalized === null) return null;
    if (normalized === undefined) {
      normalized = rawGrade === null || rawGrade === undefined
        ? '' : String(rawGrade).trim().toUpperCase();
      if (normalized === 'REGISTERED') normalized = '';
    }
    const token = String(normalized || '').trim().toUpperCase();
    const supported = new Set([
      '', ...PASSING_GRADES, ...UNRESTRICTED_RETAKE_GRADES, 'P', 'I', 'T',
    ]);
    return supported.has(token) ? token : null;
  }

  function occurrenceCourse(value) {
    return value && value.course && typeof value.course === 'object' ? value.course : value;
  }

  function occurrenceTerm(value) {
    if (!value || typeof value !== 'object') return '';
    if (value.termCode || value.termName || value.date || value.term) return value;
    if (value.semester && typeof value.semester === 'object') return value.semester;
    const course = occurrenceCourse(value);
    return course && (course.termCode || course.termName || course.date || course.term)
      ? course : '';
  }

  function findExactCourseOccurrences(semesters, courseCode, options) {
    const wanted = normalizeCourseCode(courseCode && courseCode.code ? courseCode.code : courseCode);
    if (!wanted) return [];
    const rows = Array.isArray(semesters) ? semesters : [];
    const found = [];
    for (let semesterIndex = 0; semesterIndex < rows.length; semesterIndex++) {
      const semester = rows[semesterIndex];
      const courses = semester && Array.isArray(semester.courses) ? semester.courses : [];
      for (let courseIndex = 0; courseIndex < courses.length; courseIndex++) {
        const course = courses[courseIndex];
        const code = normalizeCourseCode(course && course.code);
        if (!course || code !== wanted) continue;
        found.push({
          course,
          semester,
          semesterIndex,
          courseIndex,
          code,
          termCode: normalizeTermCode(semester, options),
          grade: course.grade,
        });
      }
    }
    return found;
  }

  function semesterTermCode(semester, options) {
    return normalizeTermCode(semester, options);
  }

  // Public convenience shape used by planner callers. Accept either the
  // curriculum itself or its semesters array so the pure policy does not need
  // to know which screen initiated the add action.
  function findCourseOccurrences(curriculumOrSemesters, courseCode, options) {
    const semesters = Array.isArray(curriculumOrSemesters)
      ? curriculumOrSemesters
      : (curriculumOrSemesters && Array.isArray(curriculumOrSemesters.semesters)
        ? curriculumOrSemesters.semesters : []);
    return findExactCourseOccurrences(semesters, courseCode, options);
  }

  function currentTermCode(options) {
    const hasCurrentTermCode = !!(options
      && Object.prototype.hasOwnProperty.call(options, 'currentTermCode'));
    const hasCurrentTerm = !!(options
      && Object.prototype.hasOwnProperty.call(options, 'currentTerm'));
    if (hasCurrentTermCode || hasCurrentTerm) {
      return normalizeTermCode(
        hasCurrentTermCode ? options.currentTermCode : options.currentTerm,
        options,
      );
    }
    try {
      if (typeof window !== 'undefined') {
        return normalizeTermCode(window.currentTermCode, options);
      }
    } catch (_) {}
    return '';
  }

  function classificationBase(occurrence, targetTerm, options) {
    const course = occurrenceCourse(occurrence) || {};
    return {
      eligible: false,
      allowed: false,
      advisory: true,
      ambiguous: false,
      courseCode: normalizeCourseCode(course.code || (occurrence && occurrence.code)),
      grade: normalizeGradeToken(course.grade, options, course),
      sourceTermCode: normalizeTermCode(occurrenceTerm(occurrence), options),
      targetTermCode: normalizeTermCode(targetTerm, options),
      currentTermCode: currentTermCode(options),
      regularSemesterSteps: null,
      reason: '',
    };
  }

  function classifyRetakeOccurrence(occurrence, targetTerm, options) {
    const result = classificationBase(occurrence, targetTerm, options);
    if (!result.targetTermCode) {
      result.reason = 'unknown-target-term';
      return result;
    }
    if (!result.sourceTermCode) {
      result.reason = 'unknown-source-term';
      return result;
    }
    // A terminal-looking grade in a future planner column is still only a
    // projection. When the caller (or browser) provides a trustworthy current
    // term, do not use that projection to unlock a retake.
    if (result.currentTermCode
      && Number(result.sourceTermCode) > Number(result.currentTermCode)) {
      result.reason = 'source-term-not-completed';
      return result;
    }
    if (Number(result.targetTermCode) <= Number(result.sourceTermCode)) {
      result.reason = 'target-not-later';
      return result;
    }
    if (result.grade === null) {
      result.reason = 'unsupported-grade';
      return result;
    }
    if (UNFINISHED_GRADES.has(result.grade)) {
      result.reason = 'unfinished-grade';
      return result;
    }
    if (result.grade === 'T') {
      result.reason = 'transfer-requires-substitution-review';
      return result;
    }
    if (UNRESTRICTED_RETAKE_GRADES.has(result.grade)) {
      result.eligible = true;
      result.allowed = true;
      result.reason = 'unsuccessful-or-withdrawn';
      return result;
    }
    if (!PASSING_GRADES.has(result.grade)) {
      result.reason = 'unsupported-grade';
      return result;
    }

    result.regularSemesterSteps = regularSemesterSteps(
      result.sourceTermCode,
      result.targetTermCode,
      options,
    );
    if (result.regularSemesterSteps === null) {
      result.reason = 'unknown-term-distance';
      return result;
    }
    if (result.regularSemesterSteps > MAX_PASSING_RETAKE_STEPS) {
      result.reason = 'passing-retake-window-expired';
      return result;
    }
    result.eligible = true;
    result.allowed = true;
    result.reason = 'passing-within-retake-window';
    return result;
  }

  function classifyRetake(existingSemester, existingCourse, targetSemester, options) {
    const result = classifyRetakeOccurrence({
      semester: existingSemester,
      course: existingCourse,
    }, targetSemester, options);
    return Object.assign({}, result, {
      regularSemestersElapsed: result.regularSemesterSteps,
    });
  }

  function assessRetakeCandidate(semesters, courseCode, targetTerm, options) {
    const code = normalizeCourseCode(courseCode && courseCode.code ? courseCode.code : courseCode);
    const occurrences = findExactCourseOccurrences(semesters, code, options);
    const targetTermCode = normalizeTermCode(targetTerm, options);
    const base = {
      eligible: false,
      allowed: false,
      advisory: true,
      ambiguous: false,
      courseCode: code,
      targetTermCode,
      occurrences,
      priorOccurrences: [],
      occurrence: null,
      classification: null,
      reason: '',
    };
    if (!code) {
      base.reason = 'unknown-course-code';
      return base;
    }
    if (!targetTermCode) {
      base.reason = 'unknown-target-term';
      return base;
    }
    if (!occurrences.length) {
      base.reason = 'course-not-found';
      return base;
    }
    if (occurrences.some((item) => !item.termCode)) {
      base.reason = 'unknown-source-term';
      return base;
    }

    base.priorOccurrences = occurrences.filter(
      (item) => Number(item.termCode) < Number(targetTermCode),
    );
    if (base.priorOccurrences.length > 1) {
      base.ambiguous = true;
      base.reason = 'multiple-prior-occurrences';
      return base;
    }
    if (!base.priorOccurrences.length) {
      base.reason = 'no-prior-occurrence';
      return base;
    }
    if (occurrences.length > 1) {
      base.ambiguous = true;
      base.reason = 'multiple-existing-occurrences';
      return base;
    }

    base.occurrence = base.priorOccurrences[0];
    base.classification = classifyRetakeOccurrence(base.occurrence, targetTermCode, options);
    base.eligible = base.classification.eligible;
    base.allowed = base.classification.allowed;
    base.reason = base.classification.reason;
    return base;
  }

  const api = Object.freeze({
    PASSING_GRADES,
    UNRESTRICTED_RETAKE_GRADES,
    UNFINISHED_GRADES,
    MAX_PASSING_RETAKE_STEPS,
    normalizeCourseCode,
    normalizeTermCode,
    semesterTermCode,
    currentTermCode,
    compareTermCodes,
    regularSemesterSteps,
    normalizeGradeToken,
    findExactCourseOccurrences,
    findCourseOccurrences,
    classifyRetakeOccurrence,
    classifyRetake,
    assessRetakeCandidate,
  });

  if (typeof window !== 'undefined') window.courseRetakes = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
