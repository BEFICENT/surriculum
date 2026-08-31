// Keyed Scheduler results reconciliation. Keeps unchanged, already-attached
// course cards alive so search/filter renders do not invalidate the full tree.
(function (root) {
  'use strict';

  const normalizeKey = (value) => String(value == null ? '' : value).trim();

  function reconcileKeyedNodes(container, candidates, previousEntries) {
    if (!container || typeof container.insertBefore !== 'function'
      || typeof container.removeChild !== 'function') {
      throw new TypeError('A DOM-like results container is required.');
    }
    const previous = previousEntries instanceof Map ? previousEntries : new Map();
    const desired = Array.isArray(candidates) ? candidates : [];
    const next = new Map();
    const nodes = [];
    const seen = new Map();

    for (let index = 0; index < desired.length; index += 1) {
      const candidate = desired[index] || {};
      const baseKey = normalizeKey(candidate.key) || `index:${index}`;
      const occurrence = seen.get(baseKey) || 0;
      seen.set(baseKey, occurrence + 1);
      const key = occurrence ? `${baseKey}\u0000${occurrence}` : baseKey;
      const signature = String(candidate.signature == null ? '' : candidate.signature);
      const cached = previous.get(key);
      const node = cached && cached.signature === signature && cached.node
        ? cached.node : candidate.node;
      if (!node) continue;
      const entry = Object.freeze({ key, signature, node });
      next.set(key, entry);
      nodes.push(node);
    }

    // Moving an existing child with insertBefore is intentionally used here:
    // it preserves focus, scroll state, and per-node browser work for cards
    // whose markup did not change, even when sorting changes their order.
    let cursor = container.firstChild;
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      if (node === cursor) {
        cursor = cursor.nextSibling;
      } else {
        container.insertBefore(node, cursor || null);
      }
    }
    while (cursor) {
      const nextSibling = cursor.nextSibling;
      container.removeChild(cursor);
      cursor = nextSibling;
    }
    return next;
  }

  function createCourseResultsReconciler(container) {
    if (!container) throw new TypeError('Scheduler results container is required.');
    const doc = container.ownerDocument || (root && root.document);
    if (!doc || typeof doc.createElement !== 'function') {
      throw new TypeError('Scheduler results reconciliation requires a document.');
    }
    const template = doc.createElement('template');
    let entries = new Map();

    const parseHtmlNodes = (html) => {
      try {
        template.innerHTML = String(html == null ? '' : html);
        return template.content
          ? Array.from(template.content.childNodes || [])
          : Array.from(template.childNodes || []);
      } finally {
        // The template is only a parsing surface. Release its detached tree as
        // soon as callers hold the nodes they need.
        template.innerHTML = '';
      }
    };

    const renderHtml = (html) => {
      const childNodes = parseHtmlNodes(html);
      const candidates = childNodes.map((node, index) => {
        const isElement = node && node.nodeType === 1;
        const courseId = isElement && typeof node.getAttribute === 'function'
          ? normalizeKey(node.getAttribute('data-course')).toUpperCase()
          : '';
        const isCourseCard = !!(
          courseId
          && node.classList
          && typeof node.classList.contains === 'function'
          && node.classList.contains('scheduler-course')
        );
        const signature = isElement && typeof node.outerHTML === 'string'
          ? node.outerHTML
          : `${node && node.nodeType ? node.nodeType : 0}:${node && node.textContent ? node.textContent : ''}`;
        return {
          key: isCourseCard ? `course:${courseId}` : `static:${index}`,
          signature,
          node,
        };
      });
      entries = reconcileKeyedNodes(container, candidates, entries);
    };

    const renderKeyedHtml = (items) => {
      if (!Array.isArray(items)) return renderHtml(items);
      const seen = new Map();
      const candidates = items.map((item, index) => {
        const baseKey = normalizeKey(item && item.key) || `index:${index}`;
        const occurrence = seen.get(baseKey) || 0;
        seen.set(baseKey, occurrence + 1);
        const lookupKey = occurrence ? `${baseKey}\u0000${occurrence}` : baseKey;
        const signature = String(item && item.html != null ? item.html : '');
        const cached = entries.get(lookupKey);
        const node = cached && cached.signature === signature && cached.node
          ? cached.node
          : parseHtmlNodes(signature).find(candidate => candidate && candidate.nodeType === 1);
        return { key: baseKey, signature, node };
      });
      entries = reconcileKeyedNodes(container, candidates, entries);
    };

    return Object.freeze({
      renderHtml,
      renderKeyedHtml,
      dispose() {
        entries.clear();
        entries = new Map();
        try { template.innerHTML = ''; } catch (_) {}
      },
    });
  }

  // Defensive parser used only when the shared requisite evaluator is absent
  // (for example, in a partially cached file:// shell).
  function parsePrerequisiteAst(value) {
    const tokens = [];
    const re = /([A-Z]{2,5})\s*([0-9]{3,5}[A-Z]?)|(\()|(\))|\b(and|or)\b/ig;
    let match;
    while ((match = re.exec(String(value || ''))) !== null) {
      if (match[1] && match[2]) tokens.push({ t: 'course', v: (match[1] + match[2]).toUpperCase() });
      else if (match[3]) tokens.push({ t: 'lp' });
      else if (match[4]) tokens.push({ t: 'rp' });
      else if (match[5]) tokens.push({ t: 'op', v: String(match[5]).toLowerCase() });
    }
    if (!tokens.length) return null;
    const output = [];
    const operators = [];
    const precedence = { or: 1, and: 2 };
    tokens.forEach((token) => {
      if (token.t === 'course') output.push(token);
      else if (token.t === 'lp') operators.push(token);
      else if (token.t === 'rp') {
        while (operators.length && operators[operators.length - 1].t !== 'lp') output.push(operators.pop());
        if (operators.length && operators[operators.length - 1].t === 'lp') operators.pop();
      } else if (token.t === 'op') {
        while (operators.length && operators[operators.length - 1].t === 'op'
          && (precedence[operators[operators.length - 1].v] || 0) >= (precedence[token.v] || 0)) {
          output.push(operators.pop());
        }
        operators.push(token);
      }
    });
    while (operators.length) {
      const token = operators.pop();
      if (token && token.t === 'op') output.push(token);
    }
    const stack = [];
    const combine = (type, left, right) => {
      const items = [];
      [left, right].forEach((node) => {
        if (!node) return;
        if (node.type === type && Array.isArray(node.items)) items.push(...node.items);
        else items.push(node);
      });
      return { type, items };
    };
    output.forEach((token) => {
      if (token.t === 'course') stack.push({ type: 'course', id: token.v });
      else if (token.t === 'op') {
        const right = stack.pop();
        const left = stack.pop();
        if (left && right) stack.push(combine(token.v, left, right));
      }
    });
    return stack.length ? stack[stack.length - 1] : null;
  }

  function evaluatePrerequisiteAst(ast, takenSet, normalizeCourseId) {
    if (!ast || !(takenSet instanceof Set) || typeof normalizeCourseId !== 'function') return null;
    const required = new Set();
    const oneOf = [];
    const label = (node) => {
      if (!node) return '';
      if (node.type === 'course') return String(node.id || '');
      const parts = (Array.isArray(node.items) ? node.items : []).map(label).filter(Boolean);
      if (node.type === 'and') return parts.length > 1 ? parts.join(' + ') : (parts[0] || '');
      if (node.type === 'or') return parts.length > 1 ? `(${parts.join(' / ')})` : (parts[0] || '');
      return '';
    };
    const visit = (node, context) => {
      if (!node) return true;
      if (node.type === 'course') {
        const id = normalizeCourseId(node.id);
        const met = !!(id && takenSet.has(id));
        if (!met && context === 'and') required.add(id);
        return met;
      }
      const items = Array.isArray(node.items) ? node.items : [];
      if (node.type === 'and') {
        let met = true;
        items.forEach((item) => { met = visit(item, context) && met; });
        return met;
      }
      if (node.type === 'or') {
        if (items.some((item) => visit(item, 'or'))) return true;
        const options = items.map(label).map(item => String(item || '').trim()).filter(Boolean);
        if (options.length) oneOf.push(options);
        return false;
      }
      return true;
    };
    return {
      ok: visit(ast, 'and'),
      required: Array.from(required).filter(Boolean),
      oneOf,
    };
  }

  const api = Object.freeze({
    reconcileKeyedNodes,
    createCourseResultsReconciler,
    parsePrerequisiteAst,
    evaluatePrerequisiteAst,
  });
  if (root) root.SurriculumSchedulerResults = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
