'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCurriculumGlobals } = require('./helpers/load-curriculum');

const {
  combinedDegreeMetricsFromAllocations,
  isBasicLanguageCourse,
  languageCourseNeedsLevelReview,
  languageCapForRequirements,
  normalizedLanguageLevel,
  programUnionGenericRecords,
  totalsForGenericRecords,
} = loadCurriculumGlobals();

const KNOWN_BASIC = [
  'ARA110', 'ARA120', 'CHI110', 'CHI120', 'FRE110', 'FRE120',
  'GER110', 'GER120', 'ITA110', 'ITA120', 'JAP110', 'JAP120',
  'LAT110', 'LAT120', 'PERS110', 'PERS120', 'RUS110', 'RUS120',
  'SPA110', 'SPA120', 'TUR101', 'TUR102',
];

test('all known current and historical Sabanci basic-language codes are classified', () => {
  for (const code of KNOWN_BASIC) {
    assert.equal(isBasicLanguageCourse({ code }, null), true, code);
  }
});

test('intermediate and advanced language courses do not consume the basic-course cap', () => {
  for (const code of ['ARA130', 'FRE130', 'FRE140', 'GER140', 'TUR201']) {
    assert.equal(isBasicLanguageCourse({ code }, null), false, code);
  }
});

test('exchange LANG courses require reviewed level metadata', () => {
  assert.equal(isBasicLanguageCourse({ code: 'LANG100' }, { Language_Level: 'basic' }), true);
  assert.equal(isBasicLanguageCourse({ code: 'LANG100' }, { Language_Level: 'other' }), false);
  assert.equal(isBasicLanguageCourse({ code: 'LANG100' }, { Language_Level: '' }), false);
  assert.equal(isBasicLanguageCourse({ code: 'LANG100' }, null), false);
});

test('trusted built-in basic codes cannot be reclassified by stale metadata', () => {
  assert.equal(isBasicLanguageCourse(
    { code: 'FRE110', Language_Level: 'other' },
    { Language_Level: 'other' },
  ), true);
});

test('language level normalization is conservative', () => {
  assert.equal(normalizedLanguageLevel(' BASIC '), 'basic');
  assert.equal(normalizedLanguageLevel('Other'), 'other');
  assert.equal(normalizedLanguageLevel('intermediate'), '');
  assert.equal(normalizedLanguageLevel(undefined), '');
});

test('the allocation limit comes only from the selected requirements record', () => {
  assert.equal(languageCapForRequirements({
    groups: [{ rule: 'credits', min: 9 }, { rule: 'languageCap', max: 2 }],
  }), 2);
  assert.equal(languageCapForRequirements({ groups: [] }), null);
  assert.equal(languageCapForRequirements(null), null);
});

test('an exact LANG record without reviewed metadata fails closed', () => {
  const course = { code: 'LANG240' };
  assert.equal(languageCourseNeedsLevelReview(course, {
    Major: 'LANG', Code: '240', Language_Level: '',
  }), true);
  assert.equal(languageCourseNeedsLevelReview(course, {
    Major: 'LANG', Code: '240', Language_Level: 'basic',
  }), false);
  assert.equal(languageCourseNeedsLevelReview(course, {
    Major: 'LANG', Code: '240', Language_Level: 'other',
  }), false);
  assert.equal(languageCourseNeedsLevelReview({ code: 'LANGUAGE240' }, {
    Major: 'LANGUAGE', Code: '240', Language_Level: '',
  }), false);
});

test('combined main/DM generic records count either accepting program exactly once', () => {
  const course = { code: 'LANG100' };
  const none = { effective: 'none', countsTotal: false, credit: 3, ects: 6 };
  const free = { effective: 'free', countsTotal: false, credit: 3, ects: 6 };

  const csMain = programUnionGenericRecords(
    new Map([[course, none]]), new Map([[course, free]]),
  );
  assert.deepEqual({ ...totalsForGenericRecords(csMain) }, {
    total: 3, science: 0, engineering: 0, ects: 6,
  });

  const manMain = programUnionGenericRecords(
    new Map([[course, { ...free, countsTotal: true }]]), new Map([[course, none]]),
  );
  assert.deepEqual({ ...totalsForGenericRecords(manMain) }, {
    total: 3, science: 0, engineering: 0, ects: 6,
  });

  const acceptedByBoth = programUnionGenericRecords(
    new Map([[course, { ...free, countsTotal: true }]]), new Map([[course, free]]),
  );
  assert.equal(totalsForGenericRecords(acceptedByBoth).total, 3);
});

test('legacy combined metrics use the main/DM allocation union', () => {
  const dmOnly = { code: 'LANG100', effective_type: 'none', effective_type_dm: 'free',
    SU_credit: 3, ECTS: 6, Basic_Science: 0, Engineering: 0 };
  const both = { code: 'FRE130', effective_type: 'free', effective_type_dm: 'free',
    SU_credit: 3, ECTS: 4, Basic_Science: 0, Engineering: 0 };
  const neither = { code: 'LANG240', effective_type: 'none', effective_type_dm: 'none',
    SU_credit: 3, ECTS: 6, Basic_Science: 0, Engineering: 0 };
  assert.deepEqual({ ...combinedDegreeMetricsFromAllocations([
    { courses: [dmOnly, both, neither] },
  ]) }, { total: 6, science: 0, engineering: 0, ects: 10 });
});
