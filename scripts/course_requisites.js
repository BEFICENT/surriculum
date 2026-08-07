// Shared prerequisite/corequisite parsing plus advisory planner warnings.
// Scheduler and planner both consume the same prerequisite evaluator; planner
// warnings are DOM-only and never participate in allocation or graduation.

(function () {
  'use strict';

  const astCache = new Map();

  function normalizeCourseCode(value) {
    return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  function extractCourseCodes(value) {
    const text = String(value || '');
    const out = [];
    const seen = new Set();
    // SU special-topic numbers can be five digits (for example CS48001).
    const re = /([A-Z]{2,5})\s*([0-9]{3,5}[A-Z]?)/gi;
    let match;
    while ((match = re.exec(text)) !== null) {
      const code = normalizeCourseCode(match[1] + match[2]);
      if (code && !seen.has(code)) {
        seen.add(code);
        out.push(code);
      }
    }
    return out;
  }

  function tokenizePrerequisites(value) {
    const source = String(value || '');
    // Parentheses around this qualifier are prose, not expression grouping.
    // Preserve string offsets so each course token can still read its own
    // qualifier from the original text below.
    const expressionText = source.replace(
      /\(\s*can be taken concurrently\s*\)/gi,
      (match) => ' '.repeat(match.length),
    );
    const out = [];
    const re = /([A-Z]{2,5})\s*([0-9]{3,5}[A-Z]?)|(\()|(\))|\b(and|or)\b/gi;
    let match;
    while ((match = re.exec(expressionText)) !== null) {
      if (match[1] && match[2]) {
        out.push({
          t: 'course',
          v: normalizeCourseCode(match[1] + match[2]),
          start: match.index,
          end: re.lastIndex,
        });
      } else if (match[3]) {
        out.push({ t: 'lp', start: match.index, end: re.lastIndex });
      } else if (match[4]) {
        out.push({ t: 'rp', start: match.index, end: re.lastIndex });
      } else if (match[5]) {
        out.push({
          t: 'op',
          v: String(match[5]).toLowerCase(),
          start: match.index,
          end: re.lastIndex,
        });
      }
    }
    for (let i = 0; i < out.length; i++) {
      const token = out[i];
      if (!token || token.t !== 'course') continue;
      const nextStart = out[i + 1] ? out[i + 1].start : source.length;
      const qualifier = source.slice(token.end, nextStart);
      const grade = qualifier.match(/Min\s+Grade\s+([A-Z][+-]?)/i);
      token.minGrade = grade ? String(grade[1]).toUpperCase() : '';
      token.concurrent = /can\s+be\s+taken\s+concurrently/i.test(qualifier);
    }
    return out;
  }

  function parsePrerequisiteExpression(value) {
    const text = String(value || '');
    if (astCache.has(text)) return astCache.get(text);
    const tokens = tokenizePrerequisites(text);
    if (!tokens.length) {
      astCache.set(text, null);
      return null;
    }

    const precedence = { or: 1, and: 2 };
    const output = [];
    const operators = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.t === 'course') {
        output.push(token);
      } else if (token.t === 'lp') {
        operators.push(token);
      } else if (token.t === 'rp') {
        while (operators.length && operators[operators.length - 1].t !== 'lp') {
          output.push(operators.pop());
        }
        if (operators.length && operators[operators.length - 1].t === 'lp') operators.pop();
      } else if (token.t === 'op') {
        while (operators.length) {
          const top = operators[operators.length - 1];
          if (!top || top.t !== 'op') break;
          if ((precedence[top.v] || 0) >= (precedence[token.v] || 0)) output.push(operators.pop());
          else break;
        }
        operators.push(token);
      }
    }
    while (operators.length) {
      const operator = operators.pop();
      if (operator && operator.t === 'op') output.push(operator);
    }

    const stack = [];
    const flatten = (type, left, right) => {
      const items = [];
      const add = (node) => {
        if (!node) return;
        if (node.type === type && Array.isArray(node.items)) items.push(...node.items);
        else items.push(node);
      };
      add(left);
      add(right);
      return { type, items };
    };
    for (let i = 0; i < output.length; i++) {
      const token = output[i];
      if (token.t === 'course') {
        stack.push({
          type: 'course',
          id: token.v,
          minGrade: token.minGrade || '',
          concurrent: token.concurrent === true,
        });
      } else if (token.t === 'op') {
        const right = stack.pop();
        const left = stack.pop();
        if (!left || !right) continue;
        stack.push(flatten(token.v, left, right));
      }
    }
    const ast = stack.length ? stack[stack.length - 1] : null;
    astCache.set(text, ast);
    return ast;
  }

  function normalizedCodeSet(values) {
    const out = new Set();
    try {
      for (const value of (values || [])) {
        const code = normalizeCourseCode(value);
        if (code) out.add(code);
      }
    } catch (_) {}
    return out;
  }

  function evaluatePrerequisites(value, availableCodes, options) {
    const ast = parsePrerequisiteExpression(value);
    if (!ast) return null;
    const available = normalizedCodeSet(availableCodes);
    const concurrentAvailable = normalizedCodeSet(options && options.concurrentAvailableCodes);
    const courseAvailable = options && typeof options.courseAvailable === 'function'
      ? options.courseAvailable : null;
    const required = new Set();
    const concurrent = new Set();
    const oneOf = [];
    const oneOfConcurrent = [];

    const optionLabel = (node) => {
      if (!node) return '';
      if (node.type === 'course') return String(node.id || '');
      const parts = (Array.isArray(node.items) ? node.items : []).map(optionLabel).filter(Boolean);
      if (node.type === 'and') return parts.length > 1 ? parts.join(' + ') : (parts[0] || '');
      if (node.type === 'or') return parts.length > 1 ? `(${parts.join(' / ')})` : (parts[0] || '');
      return '';
    };
    const containsConcurrent = (node) => {
      if (!node) return false;
      if (node.type === 'course') return node.concurrent === true;
      return Array.isArray(node.items) && node.items.some(containsConcurrent);
    };

    const visit = (node, context) => {
      if (!node) return true;
      if (node.type === 'course') {
        const code = normalizeCourseCode(node.id);
        let met = false;
        if (code && courseAvailable) {
          try {
            met = !!courseAvailable(code, {
              minGrade: node.minGrade || '',
              concurrent: node.concurrent === true,
            });
          } catch (_) {}
        } else if (code) {
          met = available.has(code)
            || (node.concurrent === true && concurrentAvailable.has(code));
        }
        if (!met && context === 'and') {
          required.add(code);
          if (node.concurrent === true) concurrent.add(code);
        }
        return met;
      }
      if (node.type === 'and') {
        let met = true;
        const items = Array.isArray(node.items) ? node.items : [];
        for (let i = 0; i < items.length; i++) met = visit(items[i], context) && met;
        return met;
      }
      if (node.type === 'or') {
        const items = Array.isArray(node.items) ? node.items : [];
        for (let i = 0; i < items.length; i++) {
          if (visit(items[i], 'or')) return true;
        }
        const options = Array.from(new Set(
          items.map(optionLabel).map((label) => label.trim()).filter(Boolean),
        ));
        if (options.length) {
          oneOf.push(options);
          oneOfConcurrent.push(items.map(containsConcurrent));
        }
        return false;
      }
      return true;
    };

    if (visit(ast, 'and')) return null;
    return {
      mode: 'expr',
      required: Array.from(required).filter(Boolean),
      concurrent: Array.from(concurrent).filter(Boolean),
      oneOf,
      oneOfConcurrent,
    };
  }

  function isPlannerComponentCode(code) {
    // Recitation/lab/discussion components are not separate planner courses.
    // This also covers the irregular EE48010 -> EE4801L relationship.
    return /[RLD]$/.test(normalizeCourseCode(code));
  }

  function termNumber(semester) {
    const direct = String((semester && semester.termCode) || '').trim();
    if (/^\d{6}$/.test(direct)) return Number(direct);
    try {
      const label = String((semester && (semester.termName || semester.date)) || '').trim();
      const convert = (typeof window !== 'undefined') ? window.termNameToCode : null;
      const converted = typeof convert === 'function' ? String(convert(label) || '') : '';
      return /^\d{6}$/.test(converted) ? Number(converted) : 0;
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

  function plannerWarningsForSemesters(
    semesters,
    infoByCode,
    isEligible,
    isWarningTarget,
  ) {
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
      const info = courseInfoFor(infoByCode, target.code);
      if (!info) continue;

      const throughTarget = new Set();
      for (let j = 0; j < rows.length; j++) {
        const candidate = rows[j];
        if (!candidate.term || !candidate.eligible) continue;
        if (candidate.term <= target.term) throughTarget.add(candidate.code);
      }

      const prerequisite = info.prerequisites
        ? evaluatePrerequisites(String(info.prerequisites), [], {
          courseAvailable: (code, qualifier) => rows.some((candidate) => (
            candidate.code === code
            && candidate.eligible
            && (
              candidate.term < target.term
              || (qualifier.concurrent === true && candidate.term === target.term)
            )
            && courseMeetsMinimumGrade(candidate.course, qualifier.minGrade)
          )),
        }) : null;
      const corequisites = extractCourseCodes(info.corequisites)
        .filter((code) => code !== target.code && !isPlannerComponentCode(code));
      const missingCorequisites = Array.from(new Set(corequisites))
        .filter((code) => !throughTarget.has(code));
      if (!prerequisite && !missingCorequisites.length) continue;
      warnings.push({
        courseId: String(target.course.id || ''),
        courseCode: target.code,
        prerequisite,
        corequisites: missingCorequisites,
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

      const prereq = item.prerequisite;
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
      if (Array.isArray(item.corequisites) && item.corequisites.length) {
        appendPlannerWarning(wrapper, 'corequisite',
          `Corequisite: add ${item.corequisites.join(', ')} in this term or an earlier term.`);
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
        return [];
      }
      const infoByCode = await loadInfo();
      const warnings = plannerWarningsForSemesters(
        curriculum.semesters,
        infoByCode,
        eligible,
        warningTarget,
      );
      renderPlannerWarnings(warnings);
      return warnings;
    } catch (_) {
      clearPlannerWarningElements();
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
    isPlannerComponentCode,
    courseMeetsMinimumGrade,
    plannerWarningsForSemesters,
    refreshPlannerWarnings,
    queuePlannerWarningRefresh,
  };
  if (typeof window !== 'undefined') window.courseRequisites = api;
})();
