'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const offeringHistoryModule = require('../../scripts/course-filter-offering-history.js');

const normalizeCourseCode = (value) => {
  const normalized = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return normalized === 'CS210' || normalized === 'DSA210' ? 'DSA210' : normalized;
};
const rawRecordCourseCode = (record) => String(
  record && (record.course_id || record.code || `${record.Major || ''}${record.Code || ''}`) || '',
).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
const courseInfoFor = (infoByCode, code) => (
  infoByCode && typeof infoByCode.get === 'function' ? infoByCode.get(code) || null : null
);

const policy = offeringHistoryModule.createOfferingHistoryPolicy({
  normalizeCourseCode,
  rawRecordCourseCode,
  courseInfoFor,
});

test('offering-history module and policy expose frozen narrow APIs', () => {
  assert.equal(Object.isFrozen(offeringHistoryModule), true);
  assert.equal(Object.isFrozen(policy), true);
  assert.deepEqual(Object.keys(offeringHistoryModule), ['createOfferingHistoryPolicy']);
  assert.deepEqual(Object.keys(policy), [
    'deriveOfferingPattern',
    'offeringHistoryForCandidate',
    'contextualOfferingAdvisories',
  ]);
});

test('historical advisories stay contextual and yield to an exact offering', () => {
  const pattern = policy.deriveOfferingPattern({
    scrape_ok: true,
    last_offered_terms: [
      { term: 'Spring 2023-2024' },
      { term: 'Spring 2024-2025' },
      { term: 'Spring 2025-2026' },
    ],
  }, { referenceTermCode: '202601' });

  assert.equal(pattern.noFall, true);
  assert.deepEqual(
    policy.contextualOfferingAdvisories(pattern, 'Fall 2026-2027', 'unknown')
      .map((item) => item.key),
    ['no-fall'],
  );
  assert.deepEqual(
    policy.contextualOfferingAdvisories(pattern, 'Spring 2026-2027', 'unknown'),
    [],
  );
  assert.deepEqual(
    policy.contextualOfferingAdvisories(pattern, 'Fall 2026-2027', 'offered'),
    [],
  );
});

test('offering-history lookup merges the canonical and legacy DSA210 records', () => {
  const info = new Map([
    ['DSA210', { scrape_ok: true, last_offered_terms: [{ term: 'Fall 2023-2024' }] }],
    ['CS210', { scrape_ok: true, last_offered_terms: [{ term: 'Fall 2024-2025' }] }],
  ]);
  const pattern = policy.offeringHistoryForCandidate({ code: 'CS210' }, info, {
    referenceTermCode: '202601',
  });
  assert.deepEqual(pattern.historyTerms, ['202301', '202401']);
  assert.equal(pattern.validSourceCount, 2);
});

test('offering-history classic script loads immediately before course_filters.js', () => {
  const root = path.resolve(__dirname, '../..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const policyPosition = html.indexOf('src="scripts/course-filter-offering-history.js"');
  const filtersPosition = html.indexOf('src="scripts/course_filters.js"');
  assert.ok(policyPosition >= 0, 'offering-history policy script is missing from index.html');
  assert.ok(filtersPosition > policyPosition, 'offering-history policy must load before course_filters.js');
});
