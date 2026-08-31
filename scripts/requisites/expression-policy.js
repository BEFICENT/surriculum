// Pure prerequisite expression parsing and evaluation shared by planner and
// Scheduler. Planner orchestration and DOM warnings remain in course_requisites.
(function installCourseRequisiteExpressions(root) {
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
          if ((precedence[top.v] || 0) >= (precedence[token.v] || 0)) {
            output.push(operators.pop());
          } else break;
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

  function positiveSuCredit(value) {
    try {
      const raw = String(value == null ? '' : value).trim().replace(',', '.');
      if (!raw) return 0;
      const parsed = Number.parseFloat(raw);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    } catch (_) {
      return 0;
    }
  }

  function mergePrerequisiteResults(results) {
    const unmet = (Array.isArray(results) ? results : []).filter(Boolean);
    if (!unmet.length) return null;
    const required = new Set();
    const concurrent = new Set();
    const oneOf = [];
    const oneOfConcurrent = [];
    for (let i = 0; i < unmet.length; i++) {
      const result = unmet[i];
      (Array.isArray(result.required) ? result.required : []).forEach((code) => {
        const normalized = normalizeCourseCode(code);
        if (normalized) required.add(normalized);
      });
      (Array.isArray(result.concurrent) ? result.concurrent : []).forEach((code) => {
        const normalized = normalizeCourseCode(code);
        if (normalized) concurrent.add(normalized);
      });
      const groups = Array.isArray(result.oneOf) ? result.oneOf : [];
      const flags = Array.isArray(result.oneOfConcurrent) ? result.oneOfConcurrent : [];
      for (let j = 0; j < groups.length; j++) {
        oneOf.push(Array.isArray(groups[j]) ? groups[j].slice() : []);
        oneOfConcurrent.push(Array.isArray(flags[j]) ? flags[j].slice() : []);
      }
    }
    return {
      mode: 'expr',
      required: Array.from(required),
      concurrent: Array.from(concurrent),
      oneOf,
      oneOfConcurrent,
    };
  }

  // Banner exposes some mandatory course clauses under General Requirements
  // rather than Prerequisites. Treat both expressions as independent AND
  // requirements while keeping the old single-field data fully compatible.
  function evaluateCoursePrerequisites(info, availableCodes, options) {
    if (!info || typeof info !== 'object') return null;
    const results = [];
    if (info.prerequisites) {
      results.push(evaluatePrerequisites(String(info.prerequisites), availableCodes, options));
    }
    if (info.general_requirement_prerequisites) {
      results.push(evaluatePrerequisites(
        String(info.general_requirement_prerequisites),
        availableCodes,
        options,
      ));
    }
    return mergePrerequisiteResults(results);
  }

  function minimumPriorSuRequirement(info, actualPriorSu) {
    if (!info || typeof info !== 'object') return null;
    const minimum = positiveSuCredit(info.minimum_earned_su_credits);
    if (!minimum) return null;
    const parsedActual = Number(actualPriorSu);
    const actual = Number.isFinite(parsedActual) && parsedActual > 0 ? parsedActual : 0;
    if (actual >= minimum) return null;
    return { minimum, actual, missing: minimum - actual };
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

  const api = Object.freeze({
    normalizeCourseCode,
    extractCourseCodes,
    parsePrerequisiteExpression,
    evaluatePrerequisites,
    evaluateCoursePrerequisites,
    mergePrerequisiteResults,
    minimumPriorSuRequirement,
    positiveSuCredit,
  });
  if (root) root.SurriculumCourseRequisiteExpressions = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
