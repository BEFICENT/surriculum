'use strict';

// Unit tests for the term-name <-> term-code academic-term policy.
// These are pure and dependency-free, and the ordering property they encode is
// load-bearing: the scheduler's prereq check and earlier-planned filter both
// compare numeric term codes to decide what counts as past / current / future.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScriptGlobals } = require('./helpers/load-script');

const h = loadScriptGlobals('scripts/domain/academic-terms.js');

const indicatorStub = () => {
  const classes = new Set();
  const attributes = {};
  return {
    classList: {
      contains: (name) => classes.has(name),
      toggle: (name, force) => {
        if (force) classes.add(name);
        else classes.delete(name);
      },
    },
    dataset: {},
    setAttribute: (name, value) => { attributes[name] = String(value); },
    getAttribute: (name) => attributes[name] ?? null,
    textContent: '',
    title: '',
  };
};

test('termNameToCode maps season + year to a 6-digit code', () => {
  assert.equal(h.termNameToCode('Fall 2024-2025'), '202401');
  assert.equal(h.termNameToCode('Spring 2024-2025'), '202402');
  assert.equal(h.termNameToCode('Summer 2024-2025'), '202403');
  assert.equal(h.termNameToCode('Fall 2025-2026'), '202501');
  assert.equal(h.termNameToCode('Summer 2025-2026'), '202503');
  assert.equal(h.termNameToCode('not a term'), '');
});

test('termCodeToName is the inverse of termNameToCode', () => {
  for (const name of ['Fall 2024-2025', 'Spring 2024-2025', 'Summer 2025-2026', 'Fall 2026-2027']) {
    assert.equal(h.termCodeToName(h.termNameToCode(name)), name);
  }
});

test('term codes sort chronologically (Fall < Spring < Summer, then by year)', () => {
  // This is exactly the ordering the scheduler relies on to tell whether a
  // planned course sits before, in, or after the selected term.
  const chronological = [
    'Fall 2024-2025', 'Spring 2024-2025', 'Summer 2024-2025',
    'Fall 2025-2026', 'Spring 2025-2026', 'Summer 2025-2026',
    'Fall 2026-2027',
  ];
  const codes = chronological.map((n) => Number(h.termNameToCode(n)));
  const sorted = [...codes].sort((a, b) => a - b);
  assert.deepEqual(codes, sorted, 'numeric term codes must be monotonic with real-world term order');
});

test('normalizeTermIdentifier / displayTermIdentifier round-trip names and codes', () => {
  assert.equal(h.normalizeTermIdentifier('Spring 2024-2025'), '202402');
  assert.equal(h.normalizeTermIdentifier('202402'), '202402'); // already a code -> unchanged
  assert.equal(h.displayTermIdentifier('202402'), 'Spring 2024-2025');
  assert.equal(h.displayTermIdentifier('Spring 2024-2025'), 'Spring 2024-2025');
});

test('semester credit limits are advisory and Summer-specific', () => {
  assert.equal(h.semesterCreditLimit('Fall 2024-2025'), 20);
  assert.equal(h.semesterCreditLimit('Spring 2024-2025'), 20);
  assert.equal(h.semesterCreditLimit('Summer 2024-2025'), 8);
  assert.equal(h.semesterCreditLimit('202403'), 8);
  assert.equal(h.semesterCreditLimit({ termCode: '202403', termName: 'Summer 2024-2025' }), 8);
  assert.equal(h.semesterCreditLimit({ termCode: '', termName: 'Summer 2024-2025' }), 8);
  assert.equal(h.semesterCreditLimit({ termCode: '202402', termName: 'Spring 2024-2025' }), 20);
  assert.equal(h.semesterCreditLimit({ termCode: '202402', termName: 'Summer 2024-2025' }), 20);
  assert.equal(h.semesterCreditLimit('not a term'), 20);

  assert.equal(h.isSemesterCreditOverLimit({ termCode: '202403', totalCredit: 8 }), false);
  assert.equal(h.isSemesterCreditOverLimit({ termCode: '202403', totalCredit: 8.01 }), true);
  assert.equal(h.isSemesterCreditOverLimit({ termCode: '202401', totalCredit: 20 }), false);
  assert.equal(h.isSemesterCreditOverLimit({ termCode: '202401', totalCredit: 20.01 }), true);
});

test('semester overload prefers raw workload, then explicit and legacy totals', () => {
  assert.equal(h.isSemesterCreditOverLimit({
    termCode: '202403', totalLoadCredit: 9, totalCredit: 0,
  }, 1), true, 'stored workload wins over both explicit and legacy totals');
  assert.equal(h.isSemesterCreditOverLimit({
    termCode: '202403', totalLoadCredit: 8, totalCredit: 99,
  }, 9), false, 'a finite stored workload also wins at the exact Summer boundary');

  assert.equal(h.isSemesterCreditOverLimit({ termCode: '202403', totalCredit: 99 }, 8), false);
  assert.equal(h.isSemesterCreditOverLimit({ termCode: '202403', totalCredit: 0 }, 8.01), true);

  assert.equal(h.isSemesterCreditOverLimit({ termCode: '202403', totalCredit: 8 }), false);
  assert.equal(h.isSemesterCreditOverLimit({ termCode: '202403', totalCredit: 8.01 }), true);
  assert.equal(h.isSemesterCreditOverLimit({ termCode: '202401', totalLoadCredit: 20.01 }), true);
});

test('semester indicator formats fractional N/A load and exposes its full meaning', () => {
  const span = indicatorStub();
  const result = h.updateSemesterCreditIndicator(span, {
    termCode: '202401',
    primaryProgramCode: 'CS',
    totalLoadCredit: 15.5,
    primaryAllocatedCredit: 13,
    primaryUnallocatedCredit: 2.5,
    totalCredit: 13,
  });

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    load: 15.5, allocated: 13, unallocated: 2.5, limit: 20, overLimit: false,
  });
  assert.equal(span.textContent, '15.5 SU (2.5 N/A)');
  assert.deepEqual(span.dataset, {
    suLoad: '15.5',
    primaryAllocatedSu: '13',
    primaryUnallocatedSu: '2.5',
    creditLimit: '20',
    overloadAdvisory: 'false',
  });
  assert.equal(span.classList.contains('is-overlimit'), false);
  assert.equal(
    span.title,
    '15.5 SU semester load: 13 SU are allocated to CS degree categories; '
      + '2.5 SU are not allocated to a CS degree category (N/A). '
      + 'Grade, PGPA, and other-program treatment are separate. '
      + 'Standard regular-semester load threshold: 20 SU.',
  );
  assert.equal(span.getAttribute('aria-label'), span.title);
});

test('semester indicator omits zero N/A and explains a raw-load Summer overload', () => {
  const normal = indicatorStub();
  h.updateSemesterCreditIndicator(normal, {
    termCode: '202401', primaryProgramCode: 'CS',
    totalLoadCredit: 3, primaryAllocatedCredit: 3, primaryUnallocatedCredit: 0,
  });
  assert.equal(normal.textContent, '3 SU');

  const overloaded = indicatorStub();
  const result = h.updateSemesterCreditIndicator(overloaded, {
    termCode: '202403', primaryProgramCode: 'MAN',
    totalLoadCredit: 9, primaryAllocatedCredit: 6, primaryUnallocatedCredit: 3,
    totalCredit: 6,
  });
  assert.equal(result.overLimit, true);
  assert.equal(overloaded.textContent, '9 SU (3 N/A)');
  assert.equal(overloaded.classList.contains('is-overlimit'), true);
  assert.equal(
    overloaded.title,
    '9 SU semester load: 6 SU are allocated to MAN degree categories; '
      + '3 SU are not allocated to a MAN degree category (N/A). '
      + 'Grade, PGPA, and other-program treatment are separate. '
      + 'Above the standard 8-SU Summer load; an overload may be possible with approval.',
  );
  assert.equal(overloaded.getAttribute('aria-label'), overloaded.title);
});
