// Shared prerequisite/corequisite parsing plus advisory planner warnings.
// Scheduler and planner both consume the same prerequisite evaluator; planner
// warnings are DOM-only and never participate in allocation or graduation.

(function () {
  'use strict';

  const expressionPolicy = (typeof window !== 'undefined')
    ? window.SurriculumCourseRequisiteExpressions : null;
  if (!expressionPolicy) {
    throw new Error(
      'scripts/requisites/expression-policy.js must load before course_requisites.js',
    );
  }
  const {
    normalizeCourseCode,
    extractCourseCodes,
    parsePrerequisiteExpression,
    evaluatePrerequisites,
    evaluateCoursePrerequisites,
    mergePrerequisiteResults,
    minimumPriorSuRequirement,
    positiveSuCredit,
  } = expressionPolicy;

  // Credit-based prerequisites use the same planning semantics as course-code
  // prerequisites: an eligible course in a strictly earlier term contributes,
  // even when its final grade has not been announced yet. Same-term/future,
  // failed, withdrawn, and term-unverified rows do not. Keep one maximum credit
  // value per normalized course code so a corrupt/legacy repeated attempt cannot
  // satisfy a threshold twice.
  function priorEligibleSuCredits(semesters, targetTerm, isEligible) {
    const target = (targetTerm && typeof targetTerm === 'object')
      ? termNumber(targetTerm)
      : termNumber({ termCode: targetTerm, termName: targetTerm });
    if (!Number.isFinite(target) || target <= 0) return 0;
    const creditByCode = new Map();
    const rows = Array.isArray(semesters) ? semesters : [];
    for (let i = 0; i < rows.length; i++) {
      const semester = rows[i];
      const term = termNumber(semester);
      if (!term || term >= target) continue;
      const courses = semester && Array.isArray(semester.courses) ? semester.courses : [];
      for (let j = 0; j < courses.length; j++) {
        const course = courses[j];
        const code = normalizeCourseCode(course && course.code);
        if (!course || !code) continue;
        let eligible = true;
        try {
          if (typeof isEligible === 'function') eligible = !!isEligible(course, semester);
        } catch (_) {
          eligible = false;
        }
        if (!eligible) continue;
        const credit = positiveSuCredit(course.SU_credit);
        if (!credit) continue;
        creditByCode.set(code, Math.max(creditByCode.get(code) || 0, credit));
      }
    }
    let total = 0;
    creditByCode.forEach((credit) => { total += credit; });
    return total;
  }

  function isPlannerComponentCode(code) {
    // Recitation/lab/discussion components are not separate planner courses.
    // This also covers the irregular EE48010 -> EE4801L relationship.
    return /[RLD]$/.test(normalizeCourseCode(code));
  }

  function termNumber(semester) {
    try {
      const canonical = (typeof window !== 'undefined') ? window.semesterTermCode : null;
      const code = typeof canonical === 'function' ? String(canonical(semester) || '') : '';
      if (/^\d{4}(01|02|03)$/.test(code)) return Number(code);
      if (typeof canonical === 'function') return 0;
    } catch (_) {
      return 0;
    }
    const direct = String((semester && semester.termCode) || '').trim();
    if (/^\d{4}(01|02|03)$/.test(direct)) return Number(direct);
    try {
      const label = String((semester && (semester.termName || semester.date)) || '').trim();
      const convert = (typeof window !== 'undefined') ? window.termNameToCode : null;
      const converted = typeof convert === 'function' ? String(convert(label) || '') : '';
      return /^\d{4}(01|02|03)$/.test(converted) ? Number(converted) : 0;
    } catch (_) {
      return 0;
    }
  }

  function courseInfoFor(infoByCode, code) {
    try {
      if (infoByCode && typeof infoByCode.get === 'function') return infoByCode.get(code) || null;
      return infoByCode && infoByCode[code] ? infoByCode[code] : null;
    } catch (_) {
      return null;
    }
  }

  function courseMeetsMinimumGrade(course, minGrade) {
    const minimum = String(minGrade || '').trim().toUpperCase();
    if (!minimum || minimum === 'D') return true;
    if (minimum !== 'S') return true;
    let grade = String((course && course.grade) || '').trim().toUpperCase();
    try {
      const policy = (typeof window !== 'undefined') ? window.gradePolicy : null;
      if (policy && typeof policy.normalizeGrade === 'function') {
        const normalized = policy.normalizeGrade(course && course.grade);
        if (normalized !== null) grade = normalized;
      } else if (grade === 'REGISTERED') {
        grade = '';
      }
    } catch (_) {}
    // An unannounced/projected result remains a valid plan. S is the normal
    // terminal result; T is accepted transferred credit. A letter grade does
    // not prove the S/U prerequisite and therefore receives an advisory.
    return ['', 'P', 'I', 'S', 'T'].includes(grade);
  }

  // Build the occurrence-aware prerequisite context for one academic term.
  // Academic chronology is derived exclusively from canonical term identity;
  // neither the curriculum array order nor the visual card order participates.
  // The returned Sets are intentionally read-only-by-convention so callers can
  // reuse one context while evaluating every candidate in a picker.
  function buildTermRequirementContext(semesters, targetSemester, isEligible) {
    const targetTerm = (targetSemester && typeof targetSemester === 'object')
      ? termNumber(targetSemester)
      : termNumber({ termCode: targetSemester, termName: targetSemester });
    const source = Array.isArray(semesters) ? semesters : [];
    const occurrences = [];

    for (let i = 0; i < source.length; i++) {
      const semester = source[i];
      const term = termNumber(semester);
      const courses = semester && Array.isArray(semester.courses) ? semester.courses : [];
      for (let j = 0; j < courses.length; j++) {
        const course = courses[j];
        const code = normalizeCourseCode(course && course.code);
        if (!course || !code) continue;
        let eligible = true;
        try {
          if (typeof isEligible === 'function') eligible = !!isEligible(course, semester);
        } catch (_) {
          eligible = false;
        }
        occurrences.push({ course, semester, code, term, eligible });
      }
    }

    const known = Number.isFinite(targetTerm) && targetTerm > 0;
    const earlierCodes = new Set();
    const throughCodes = new Set();
    if (known) {
      for (let i = 0; i < occurrences.length; i++) {
        const occurrence = occurrences[i];
        if (!occurrence.term || !occurrence.eligible) continue;
        if (occurrence.term < targetTerm) earlierCodes.add(occurrence.code);
        if (occurrence.term <= targetTerm) throughCodes.add(occurrence.code);
      }
    }

    return {
      known,
      targetSemester: targetSemester || null,
      targetTerm: known ? targetTerm : 0,
      occurrences,
      earlierCodes,
      throughCodes,
      priorEligibleSu: known
        ? priorEligibleSuCredits(source, targetTerm, isEligible)
        : 0,
    };
  }

  function unknownCandidateRequirementResult(courseCode, reason) {
    return {
      known: false,
      status: 'unknown',
      reason: String(reason || 'requirements-unavailable'),
      courseCode: normalizeCourseCode(courseCode),
      hasRequirements: false,
      prerequisite: null,
      priorSuRequirement: null,
      corequisites: [],
      missingCorequisites: [],
    };
  }

  function supplementalRegistrationEvaluation(courseCode, context) {
    try {
      const registry = (typeof window !== 'undefined') ? window.registrationRules : null;
      if (!registry || typeof registry.getRule !== 'function') return null;
      const rule = registry.getRule(courseCode);
      if (!rule) return null;
      if (typeof registry.evaluateRule !== 'function') {
        return {
          hasRule: true,
          ruleId: String(rule.ruleId || ''),
          courseCode: normalizeCourseCode(courseCode),
          status: 'review',
          reason: 'supplemental-evaluator-unavailable',
          definitiveUnmet: false,
          filterBlocking: false,
          prerequisite: null,
          priorSuRequirement: null,
          guidance: [],
          profiles: [],
          components: Array.isArray(rule.components) ? rule.components : [],
          source: rule.source || null,
        };
      }
      return registry.evaluateRule(courseCode, context) || null;
    } catch (_) {
      return {
        hasRule: true,
        ruleId: '',
        courseCode: normalizeCourseCode(courseCode),
        status: 'review',
        reason: 'supplemental-evaluation-failed',
        definitiveUnmet: false,
        filterBlocking: false,
        prerequisite: null,
        priorSuRequirement: null,
        guidance: [],
        profiles: [],
        components: [],
        source: null,
      };
    }
  }

  function stricterPriorSuRequirement(first, second) {
    if (!first) return second || null;
    if (!second) return first;
    return Number(second.minimum) > Number(first.minimum) ? second : first;
  }

  // Supplemental policies are independent AND clauses. Preserve every legacy
  // field while exposing the reviewed result separately for richer UI. A
  // definite prerequisite/prior-credit miss remains actionable even if another
  // supplemental scope requires human review; review itself never filters.
  function combineCandidateRequirementResult(base, supplemental) {
    if (!supplemental || supplemental.hasRule !== true) return base;
    const prerequisite = mergePrerequisiteResults([
      base && base.prerequisite,
      supplemental.prerequisite,
    ]);
    const priorSuRequirement = stricterPriorSuRequirement(
      base && base.priorSuRequirement,
      supplemental.priorSuRequirement,
    );
    const baseStatus = String(base && base.status || 'unknown');
    const supplementalStatus = String(supplemental.status || 'review');
    let status = 'met';
    if (baseStatus === 'unmet' || supplementalStatus === 'unmet') status = 'unmet';
    else if (supplementalStatus === 'review') status = 'review';
    else if (baseStatus === 'unknown' || supplementalStatus === 'unknown') status = 'unknown';
    const filterBlocking = !!(prerequisite || priorSuRequirement);

    return Object.assign({}, base || {}, {
      known: status === 'met' || status === 'unmet',
      status,
      reason: status === 'review'
        ? String(supplemental.reason || 'supplemental-review-required')
        : String(base && base.reason || ''),
      courseCode: normalizeCourseCode(base && base.courseCode || supplemental.courseCode),
      hasRequirements: true,
      prerequisite,
      priorSuRequirement,
      filterBlocking,
      legacy: base || null,
      supplemental,
    });
  }

  // Evaluate one not-yet-added course against a prebuilt target-term context.
  // Ordinary prerequisites must be in a strictly earlier term. Only a clause
  // explicitly marked "can be taken concurrently" may use the target term.
  // Corequisites are advisory and may appear in the same term or an earlier
  // one. Missing/invalid source data is an unknown, fail-open state rather than
  // a false assertion that the candidate has met every requirement.
  function evaluateCandidateForTerm(info, courseCode, context) {
    const code = normalizeCourseCode(courseCode);
    const supplemental = supplementalRegistrationEvaluation(code, context);
    if (!context || context.known !== true || !context.targetTerm) {
      return combineCandidateRequirementResult(
        unknownCandidateRequirementResult(code, 'unknown-target-term'),
        supplemental,
      );
    }
    if (!info || typeof info !== 'object') {
      return combineCandidateRequirementResult(
        unknownCandidateRequirementResult(code, 'missing-course-info'),
        supplemental,
      );
    }

    const occurrences = Array.isArray(context.occurrences) ? context.occurrences : [];
    const targetTerm = Number(context.targetTerm) || 0;
    const prerequisite = evaluateCoursePrerequisites(info, [], {
      courseAvailable: (requiredCode, qualifier) => {
        const required = normalizeCourseCode(requiredCode);
        if (!required) return false;
        const concurrent = !!(qualifier && qualifier.concurrent === true);
        const minGrade = qualifier && qualifier.minGrade ? qualifier.minGrade : '';
        return occurrences.some((occurrence) => (
          occurrence
          && occurrence.code === required
          && occurrence.eligible
          && occurrence.term
          && (
            occurrence.term < targetTerm
            || (concurrent && occurrence.term === targetTerm)
          )
          && courseMeetsMinimumGrade(occurrence.course, minGrade)
        ));
      },
    });
    const priorSuRequirement = minimumPriorSuRequirement(info, context.priorEligibleSu);

    const throughCodes = context.throughCodes && typeof context.throughCodes.has === 'function'
      ? context.throughCodes
      : new Set(occurrences.filter((occurrence) => (
        occurrence && occurrence.eligible && occurrence.term && occurrence.term <= targetTerm
      )).map((occurrence) => occurrence.code));
    const declaredCorequisites = extractCourseCodes(info.corequisites)
      .filter((requiredCode) => requiredCode !== code && !isPlannerComponentCode(requiredCode));
    const missingCorequisites = Array.from(new Set(declaredCorequisites))
      .filter((requiredCode) => !throughCodes.has(requiredCode));
    const hasRequirements = !!(
      info.prerequisites
      || info.general_requirement_prerequisites
      || positiveSuCredit(info.minimum_earned_su_credits)
      || declaredCorequisites.length
    );
    const unmet = !!(prerequisite || priorSuRequirement || missingCorequisites.length);

    const legacyResult = {
      known: true,
      status: unmet ? 'unmet' : 'met',
      reason: '',
      courseCode: code,
      hasRequirements,
      prerequisite,
      priorSuRequirement,
      corequisites: missingCorequisites,
      missingCorequisites,
    };
    return combineCandidateRequirementResult(legacyResult, supplemental);
  }

  function plannerWarningsForSemesters(
    semesters,
    infoByCode,
    isEligible,
    isWarningTarget,
    options,
  ) {
    const opts = options && typeof options === 'object' ? options : {};
    const programProfiles = Array.isArray(opts.programProfiles) ? opts.programProfiles : [];
    const rows = [];
    const source = Array.isArray(semesters) ? semesters : [];
    for (let i = 0; i < source.length; i++) {
      const semester = source[i];
      const term = termNumber(semester);
      const courses = semester && Array.isArray(semester.courses) ? semester.courses : [];
      for (let j = 0; j < courses.length; j++) {
        const course = courses[j];
        const code = normalizeCourseCode(course && course.code);
        if (!course || !code) continue;
        let eligible = true;
        try { if (typeof isEligible === 'function') eligible = !!isEligible(course, semester); } catch (_) {}
        let warningTarget = eligible;
        try {
          if (typeof isWarningTarget === 'function') {
            warningTarget = eligible && !!isWarningTarget(course, semester);
          }
        } catch (_) {}
        rows.push({ course, semester, code, term, eligible, warningTarget });
      }
    }

    const warnings = [];
    for (let i = 0; i < rows.length; i++) {
      const target = rows[i];
      // Unknown term identity fails open, and an unsuccessful target attempt is
      // not actionable planning work.
      if (!target.term || !target.warningTarget) continue;
      try {
        const registry = (typeof window !== 'undefined') ? window.registrationRules : null;
        const component = registry && typeof registry.getComponentMetadata === 'function'
          ? registry.getComponentMetadata(target.code) : null;
        if (component && component.plannerCourse === false) continue;
      } catch (_) {}
      const info = courseInfoFor(infoByCode, target.code);
      if (!info) continue;

      const termContext = buildTermRequirementContext(source, target.semester, isEligible);
      termContext.programProfiles = programProfiles;

      const requirement = evaluateCandidateForTerm(
        info,
        target.code,
        termContext,
      );
      const supplementalReview = !!(
        requirement.supplemental && requirement.supplemental.status === 'review'
      );
      if (requirement.status !== 'unmet' && !supplementalReview) continue;
      warnings.push({
        courseId: String(target.course.id || ''),
        courseCode: target.code,
        prerequisite: requirement.prerequisite,
        priorSuRequirement: requirement.priorSuRequirement,
        corequisites: requirement.corequisites,
        legacy: requirement.legacy || null,
        supplemental: requirement.supplemental || null,
      });
    }
    return warnings;
  }

  function clearPlannerWarningElements() {
    try {
      document.querySelectorAll('.planner-course-warnings').forEach((node) => node.remove());
      document.querySelectorAll('.course.has-requisite-warning')
        .forEach((node) => node.classList.remove('has-requisite-warning'));
    } catch (_) {}
  }

  function clearPlannerOfferingTagElements() {
    try {
      document.querySelectorAll('.planner-course-offering-tags').forEach((node) => node.remove());
      document.querySelectorAll('.course.has-offering-advisory')
        .forEach((node) => node.classList.remove('has-offering-advisory'));
    } catch (_) {}
  }

  const plannerOfferingSchedulePromises = new Map();

  function plannerOfferingScheduleCodes(termCode, historyApi) {
    const normalizedTerm = historyApi && typeof historyApi.normalizeOfferingTermCode === 'function'
      ? historyApi.normalizeOfferingTermCode(termCode) : String(termCode || '').trim();
    if (!normalizedTerm) return Promise.resolve(null);
    if (plannerOfferingSchedulePromises.has(normalizedTerm)) {
      return plannerOfferingSchedulePromises.get(normalizedTerm);
    }
    const promise = (async () => {
      try {
        const loader = (typeof window !== 'undefined') ? window.loadTermScheduleIndex : null;
        if (typeof loader !== 'function') return null;
        const index = await loader(normalizedTerm);
        if (!index || typeof index.keys !== 'function') return null;
        const normalize = historyApi && typeof historyApi.normalizeCourseCode === 'function'
          ? historyApi.normalizeCourseCode : normalizeCourseCode;
        return new Set(Array.from(index.keys()).map(normalize).filter(Boolean));
      } catch (_) {
        return null;
      }
    })();
    plannerOfferingSchedulePromises.set(normalizedTerm, promise);
    return promise;
  }

  async function renderPlannerOfferingTags(semesters, infoByCode, isTagTarget) {
    clearPlannerOfferingTagElements();
    try {
      const historyApi = (typeof window !== 'undefined') ? window.courseFilters : null;
      if (!historyApi
        || typeof historyApi.offeringHistoryForCandidate !== 'function'
        || typeof historyApi.contextualOfferingAdvisories !== 'function') return;
      const source = Array.isArray(semesters) ? semesters : [];
      const referenceTermCode = (typeof window !== 'undefined')
        ? String(window.currentTermCode || '') : '';
      const pending = [];
      for (let semesterIndex = 0; semesterIndex < source.length; semesterIndex++) {
        const semester = source[semesterIndex];
        const courses = semester && Array.isArray(semester.courses) ? semester.courses : [];
        for (let courseIndex = 0; courseIndex < courses.length; courseIndex++) {
          const course = courses[courseIndex];
          const code = normalizeCourseCode(course && course.code);
          if (!course || !code) continue;
          let shouldTag = true;
          try {
            if (typeof isTagTarget === 'function') shouldTag = !!isTagTarget(course, semester);
          } catch (_) {}
          if (!shouldTag) continue;
          const targetTermCode = (() => {
            try {
              const resolve = (typeof window !== 'undefined') ? window.semesterTermCode : null;
              return typeof resolve === 'function' ? String(resolve(semester) || '') : '';
            } catch (_) {
              return '';
            }
          })();
          // A missing or conflicting persisted term identity is not evidence
          // for a particular season. Fail open instead of guessing from either
          // the visual label or one side of a code/label conflict.
          if (!targetTermCode) continue;
          const pattern = historyApi.offeringHistoryForCandidate(
            { code },
            infoByCode,
            { referenceTermCode },
          );
          const initialAdvisories = historyApi.contextualOfferingAdvisories(
            pattern,
            targetTermCode,
            'unknown',
          );
          if (!Array.isArray(initialAdvisories) || !initialAdvisories.length) continue;
          const card = course.id ? document.getElementById(String(course.id)) : null;
          const info = card ? card.querySelector('.course_info') : null;
          if (!card || !info) continue;
          pending.push({
            code,
            termCode: targetTermCode,
            pattern,
            card,
            info,
            // Every historical advisory, including irregular cadence, yields
            // to a known offering in the selected semester.
            needsExactOffering: true,
          });
        }
      }

      const exactByTerm = new Map();
      const terms = Array.from(new Set(
        pending.filter((item) => item.needsExactOffering).map((item) => item.termCode),
      ));
      await Promise.all(terms.map(async (termCode) => {
        exactByTerm.set(termCode, await plannerOfferingScheduleCodes(termCode, historyApi));
      }));

      for (let itemIndex = 0; itemIndex < pending.length; itemIndex++) {
          const item = pending[itemIndex];
          const exactCodes = item.needsExactOffering ? exactByTerm.get(item.termCode) : null;
          const exactOffering = typeof historyApi.offeringState === 'function'
            ? historyApi.offeringState({ code: item.code }, exactCodes) : 'unknown';
          const advisories = historyApi.contextualOfferingAdvisories(
            item.pattern,
            item.termCode,
            exactOffering,
          );
          if (!Array.isArray(advisories) || !advisories.length) continue;
          const wrapper = document.createElement('div');
          wrapper.className = 'planner-course-offering-tags';
          wrapper.setAttribute(
            'aria-label',
            'Offering history advisory. Based on recorded history; future availability can change.',
          );
          wrapper.dataset.offeringHistoryState = item.pattern && item.pattern.status
            ? String(item.pattern.status) : 'unknown';
          advisories.forEach((advisory) => {
            if (!advisory || !advisory.label) return;
            const tag = document.createElement('span');
            tag.className = 'planner-course-offering-tag';
            tag.dataset.offeringAdvisory = String(advisory.key || 'history');
            tag.textContent = String(advisory.label);
            tag.title = String(advisory.description || advisory.title
              || 'Based on recorded course history; future availability can change.');
            wrapper.appendChild(tag);
          });
          if (!wrapper.children.length) continue;
          item.card.classList.add('has-offering-advisory');
          item.info.appendChild(wrapper);
      }
    } catch (_) {
      clearPlannerOfferingTagElements();
    }
  }

  function appendPlannerWarning(wrapper, kind, message) {
    const warning = document.createElement('div');
    warning.className = 'planner-requisite-warning';
    warning.dataset.warningKind = kind;
    warning.textContent = `⚠ ${message} This is advisory; special approval may still allow enrollment.`;
    wrapper.appendChild(warning);
  }

  function renderPlannerWarnings(warnings) {
    clearPlannerWarningElements();
    const list = Array.isArray(warnings) ? warnings : [];
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      const card = item.courseId ? document.getElementById(item.courseId) : null;
      if (!card || !card.classList || !card.classList.contains('course')) continue;
      const wrapper = document.createElement('div');
      wrapper.className = 'planner-course-warnings';
      wrapper.setAttribute('role', 'status');
      wrapper.setAttribute('aria-live', 'polite');
      wrapper.setAttribute('aria-atomic', 'true');

      const legacy = item.legacy && typeof item.legacy === 'object' ? item.legacy : null;
      const prereq = legacy ? legacy.prerequisite : item.prerequisite;
      if (prereq && Array.isArray(prereq.required) && prereq.required.length) {
        const sameTermAllowed = new Set(Array.isArray(prereq.concurrent) ? prereq.concurrent : []);
        const earlierOnly = prereq.required.filter((code) => !sameTermAllowed.has(code));
        const concurrent = prereq.required.filter((code) => sameTermAllowed.has(code));
        if (earlierOnly.length) {
          appendPlannerWarning(wrapper, 'prerequisite',
            `Prerequisite: complete ${earlierOnly.join(', ')} in an earlier term.`);
        }
        if (concurrent.length) {
          appendPlannerWarning(wrapper, 'prerequisite',
            `Prerequisite: add ${concurrent.join(', ')} in this term or an earlier term.`);
        }
      }
      if (prereq && Array.isArray(prereq.oneOf)) {
        for (let j = 0; j < prereq.oneOf.length; j++) {
          const options = prereq.oneOf[j] || [];
          if (options.length) {
            const concurrentFlags = Array.isArray(prereq.oneOfConcurrent)
              && Array.isArray(prereq.oneOfConcurrent[j]) ? prereq.oneOfConcurrent[j] : [];
            const labels = options.map((option, index) => (
              concurrentFlags[index] ? `${option} (same term allowed)` : option
            ));
            appendPlannerWarning(wrapper, 'prerequisite',
              `Prerequisite: complete one of ${labels.join(' or ')} before taking this course.`);
          }
        }
      }
      const legacyPriorSu = legacy ? legacy.priorSuRequirement : item.priorSuRequirement;
      if (legacyPriorSu) {
        const minimum = Number(legacyPriorSu.minimum) || 0;
        const actual = Number(legacyPriorSu.actual) || 0;
        const format = (value) => {
          const rounded = Math.round(Number(value || 0) * 100) / 100;
          return String(rounded);
        };
        appendPlannerWarning(wrapper, 'prior-credits',
          `Prior SU requirement: ${format(actual)} of ${format(minimum)} SU planned/completed in earlier terms.`);
      }
      const legacyCorequisites = legacy && Array.isArray(legacy.corequisites)
        ? legacy.corequisites : item.corequisites;
      if (Array.isArray(legacyCorequisites) && legacyCorequisites.length) {
        appendPlannerWarning(wrapper, 'corequisite',
          `Corequisite: add ${legacyCorequisites.join(', ')} in this term or an earlier term.`);
      }
      const supplemental = item.supplemental;
      let supplementalLines = 0;
      if (supplemental && Array.isArray(supplemental.guidance)) {
        supplemental.guidance.forEach((guidance) => {
          if (!guidance || guidance.kind === 'component') return;
          if (guidance.status !== 'unmet' && guidance.status !== 'review') return;
          const text = String(guidance.text || '').trim();
          if (!text) return;
          appendPlannerWarning(
            wrapper,
            guidance.status === 'review' ? 'registration-review' : 'registration-rule',
            text,
          );
          supplementalLines++;
        });
      }
      if (supplementalLines && supplemental.source && supplemental.source.url) {
        const source = document.createElement('div');
        source.className = 'planner-requisite-warning';
        source.dataset.warningKind = 'registration-source';
        source.appendChild(document.createTextNode('Reviewed registration source: '));
        const link = document.createElement('a');
        link.href = String(supplemental.source.url);
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = String(supplemental.source.authority || 'SUIS');
        source.appendChild(link);
        wrapper.appendChild(source);
      }
      if (!wrapper.children.length) continue;
      card.classList.add('has-requisite-warning');
      card.appendChild(wrapper);
    }
  }

  async function refreshPlannerWarnings() {
    try {
      const curriculum = (typeof window !== 'undefined') ? window.curriculum : null;
      const loadInfo = (typeof window !== 'undefined') ? window.loadCoursePageInfoIndex : null;
      if (!curriculum || !Array.isArray(curriculum.semesters) || typeof loadInfo !== 'function') {
        clearPlannerWarningElements();
        clearPlannerOfferingTagElements();
        return [];
      }
      const eligible = (course) => (
        typeof curriculum.isDegreeEligibleCourse !== 'function'
        || curriculum.isDegreeEligibleCourse(course)
      );
      const warningTarget = (course, semester) => {
        if (typeof curriculum.getCourseProgressState !== 'function') return true;
        const state = String(curriculum.getCourseProgressState(course, semester) || '');
        return state !== 'earned' && state !== 'unsuccessful';
      };
      const hasWarningTargets = curriculum.semesters.some((semester) => (
        semester && Array.isArray(semester.courses) && semester.courses.some((course) => (
          eligible(course) && warningTarget(course, semester)
        ))
      ));
      if (!hasWarningTargets) {
        clearPlannerWarningElements();
        clearPlannerOfferingTagElements();
        return [];
      }
      const infoByCode = await loadInfo();
      await renderPlannerOfferingTags(curriculum.semesters, infoByCode, warningTarget);
      const programProfiles = (() => {
        try {
          const filters = (typeof window !== 'undefined') ? window.courseFilters : null;
          return filters && typeof filters.buildProgramProfiles === 'function'
            ? filters.buildProgramProfiles(curriculum) : [];
        } catch (_) {
          return [];
        }
      })();
      const warnings = plannerWarningsForSemesters(
        curriculum.semesters,
        infoByCode,
        eligible,
        warningTarget,
        { programProfiles },
      );
      renderPlannerWarnings(warnings);
      return warnings;
    } catch (_) {
      clearPlannerWarningElements();
      clearPlannerOfferingTagElements();
      return [];
    }
  }

  let refreshRequested = false;
  let refreshRunning = false;
  function queuePlannerWarningRefresh() {
    refreshRequested = true;
    if (refreshRunning) return;
    refreshRunning = true;
    Promise.resolve().then(async () => {
      while (refreshRequested) {
        refreshRequested = false;
        await refreshPlannerWarnings();
      }
    }).finally(() => {
      refreshRunning = false;
      if (refreshRequested) queuePlannerWarningRefresh();
    });
  }

  const api = {
    normalizeCourseCode,
    extractCourseCodes,
    parsePrerequisiteExpression,
    evaluatePrerequisites,
    evaluateCoursePrerequisites,
    mergePrerequisiteResults,
    priorEligibleSuCredits,
    minimumPriorSuRequirement,
    isPlannerComponentCode,
    courseMeetsMinimumGrade,
    buildTermRequirementContext,
    evaluateCandidateForTerm,
    plannerWarningsForSemesters,
    refreshPlannerWarnings,
    queuePlannerWarningRefresh,
  };
  if (typeof window !== 'undefined') window.courseRequisites = api;
})();
