'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScriptsGlobals } = require('./helpers/load-script');

const globals = loadScriptsGlobals([
  'scripts/course_requisites.js',
  'scripts/course_filters.js',
]);
const filters = globals.courseFilters;
const req = globals.courseRequisites;

const record = (Major, Code, Course_Name, EL_Type, values = {}) => ({
  Major,
  Code,
  Course_Name,
  EL_Type,
  SU_credit: values.su == null ? '3' : values.su,
  ECTS: values.ects == null ? '6' : values.ects,
  Basic_Science: values.bs == null ? 0 : values.bs,
  Engineering: values.eng == null ? 0 : values.eng,
});

const candidateByCode = (rows, code) => rows.find((candidate) => candidate.code === code);

const offeringHistory = (terms, values = {}) => ({
  scrape_ok: values.scrapeOk !== false,
  last_offered_terms: terms.map((term) => ({ term })),
  ...values.extra,
});

const advisoryKeys = (pattern, targetTermCode, exactOfferingState = 'unknown') => (
  [...filters.contextualOfferingAdvisories(pattern, targetTermCode, exactOfferingState)]
    .map((advisory) => advisory.key)
);

test('buildCandidates merges catalog provenance without mutating any source record', () => {
  const primary = [
    record('IE', '305', 'Simulation', 'area', { su: '3', ects: '6', bs: 1, eng: 5 }),
    record('CS', '401', 'Computer Architectures', 'core', { su: '4', eng: 6 }),
    { ...record('GLOBAL', '999', 'Rehydration only', 'free'), __globalCourseDefinition: true },
  ];
  const dm = [
    record('IE', '305', 'Simulation', 'required', { su: '99', ects: '99' }),
    record('IE', '311', 'Operations Research I', 'required'),
  ];
  const minor = [
    record('IE', '305', 'Simulation', 'core'),
    record('MATH', '201', 'Linear Algebra', 'required', { bs: 6 }),
  ];
  const curriculum = {
    major: 'CS',
    doubleMajor: 'IE',
    doubleMajorCourseData: dm,
    minors: ['MATH-MINOR'],
    minorCourseDataByCode: { 'MATH-MINOR': minor },
  };
  const before = JSON.parse(JSON.stringify({ primary, dm, minor, curriculum }));

  const candidates = filters.buildCandidates(primary, curriculum);
  const ie305 = candidateByCode(candidates, 'IE305');
  assert.ok(ie305);
  assert.equal(candidates.filter((candidate) => candidate.code === 'IE305').length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(ie305.memberships)), {
    main: { program: 'CS', type: 'area' },
    doubleMajor: { program: 'IE', type: 'required' },
    minors: [{ program: 'MATH-MINOR', type: 'core' }],
  });
  assert.deepEqual([...ie305.programs], ['CS', 'IE', 'MATH-MINOR']);
  assert.deepEqual([...ie305.categories], ['area', 'required', 'core']);
  assert.equal(ie305.records.main, primary[0]);
  assert.equal(ie305.records.doubleMajor, dm[0]);
  assert.equal(ie305.records.minors[0].record, minor[0]);
  assert.equal(ie305.su, 3, 'primary metadata remains authoritative after provenance merges');
  assert.equal(candidateByCode(candidates, 'GLOBAL999'), undefined);
  assert.deepEqual({ primary, dm, minor, curriculum }, before);
});

test('canonical DSA210 metadata wins when a legacy CS210 alias appears first', () => {
  const legacy = record('CS', '210', 'Legacy Data Structures', 'free', {
    su: 0,
    ects: 0,
    bs: 0,
    eng: 0,
  });
  const canonical = record('DSA', '210', 'Introduction to Data Science', 'core', {
    su: 3,
    ects: 6,
    bs: 2,
    eng: 4,
  });
  const before = JSON.parse(JSON.stringify([legacy, canonical]));

  const candidates = filters.buildCandidates([legacy, canonical], {
    major: 'CS',
    minors: [],
  });
  const aliases = candidates.filter((candidate) => candidate.code === 'DSA210');

  assert.equal(aliases.length, 1);
  assert.equal(aliases[0].name, 'Introduction to Data Science');
  assert.equal(aliases[0].su, 3);
  assert.equal(aliases[0].ects, 6);
  assert.equal(aliases[0].basicScience, 2);
  assert.equal(aliases[0].engineering, 4);
  assert.deepEqual(JSON.parse(JSON.stringify(aliases[0].memberships.main)), {
    program: 'CS',
    type: 'core',
  });
  assert.equal(aliases[0].records.main, canonical);
  assert.deepEqual([legacy, canonical], before);
});

test('search, exact program/category, level, and numeric predicates compose precisely', () => {
  const candidates = filters.buildCandidates([
    record('IE', '305', 'Simulation', 'area', { su: 3, ects: 6, bs: 1, eng: 5 }),
    record('CS', '401', 'Computer Architectures', 'core', { su: 4, ects: 6, eng: 6 }),
    record('CS', '48001', 'Special Topics', 'area', { su: 3, ects: 6, eng: 6 }),
  ], {
    major: 'CS',
    doubleMajor: 'IE',
    doubleMajorCourseData: [
      record('IE', '305', 'Simulation', 'required', { su: 3, ects: 6, bs: 1, eng: 5 }),
    ],
    minors: [],
  });
  const ie305 = candidateByCode(candidates, 'IE305');
  const special = candidateByCode(candidates, 'CS48001');

  assert.equal(filters.matchesSearch(ie305, 'IE 305'), true);
  assert.equal(filters.matchesSearch(ie305, 'simulation'), true);
  assert.equal(filters.matchesSearch(ie305, 'architecture'), false);
  assert.equal(filters.matchesProgram(ie305, 'CS'), true);
  assert.equal(filters.matchesProgram(ie305, 'IE'), true);
  assert.equal(filters.matchesProgram(ie305, 'MATH-MINOR'), false);
  assert.equal(filters.matchesCategory(ie305, 'area', 'CS'), true);
  assert.equal(filters.matchesCategory(ie305, 'required', 'CS'), false);
  assert.equal(filters.matchesCategory(ie305, 'required', 'IE'), true);
  assert.equal(filters.matchesCategory(ie305, 'core', ''), false);
  assert.equal(filters.matchesLevel(ie305, '300'), true);
  assert.equal(filters.matchesLevel(ie305, '400'), false);
  assert.equal(special.level, 400, 'five-digit special topics use their leading course digit');

  assert.equal(filters.matchesNumeric(ie305, {
    minSu: 3,
    minEcts: 6,
    minBasicScience: 1,
    minEngineering: 5,
  }), true, 'numeric boundaries are inclusive');
  for (const threshold of [
    { minSu: 3.01 },
    { minEcts: 6.01 },
    { minBasicScience: 1.01 },
    { minEngineering: 5.01 },
  ]) {
    assert.equal(filters.matchesNumeric(ie305, threshold), false, JSON.stringify(threshold));
  }

  const visible = filters.filterCandidates(candidates, {
    query: 'simulation',
    program: 'IE',
    category: 'required',
    level: '300',
    minSu: '3,0',
    minEngineering: 5,
  }, {}).map((evaluation) => evaluation.candidate.code);
  assert.deepEqual([...visible], ['IE305']);
});

test('plannedStateForTarget distinguishes chronology and hide-taken leaves later plans visible', () => {
  const context = {
    known: true,
    targetTerm: 202402,
    occurrences: [
      { code: 'EARLIER', term: 202401 },
      { code: 'SAME', term: 202402 },
      { code: 'LATER', term: 202403 },
      { code: 'MULTI', term: 202401 },
      { code: 'MULTI', term: 202403 },
      { code: 'UNVERIFIED', term: 0 },
    ],
  };
  assert.equal(filters.plannedStateForTarget('NONE', context).state, 'unplanned');
  assert.equal(filters.plannedStateForTarget('EARLIER', context).state, 'earlier');
  assert.equal(filters.plannedStateForTarget('SAME', context).state, 'same-term');
  assert.equal(filters.plannedStateForTarget('LATER', context).state, 'later');
  assert.equal(filters.plannedStateForTarget('MULTI', context).state, 'multiple');
  assert.equal(filters.plannedStateForTarget('UNVERIFIED', context).state, 'unknown');

  const makeCandidate = (code) => ({ code, name: code, memberships: { main: null, doubleMajor: null, minors: [] } });
  const targetContext = { requirementContext: context };
  assert.equal(filters.evaluateCandidate(makeCandidate('EARLIER'), { hideTaken: true }, targetContext).visible, false);
  assert.equal(filters.evaluateCandidate(makeCandidate('SAME'), { hideTaken: true }, targetContext).visible, false);
  assert.equal(filters.evaluateCandidate(makeCandidate('LATER'), { hideTaken: true }, targetContext).visible, true);
  assert.equal(filters.evaluateCandidate(makeCandidate('UNVERIFIED'), { hideTaken: true }, targetContext).visible, true,
    'unknown chronology fails open');
});

test('hide-taken treats legacy CS210 and catalog DSA210 as one planned identity', () => {
  const requirementContext = {
    known: true,
    targetTerm: 202402,
    occurrences: [{ code: 'CS210', term: 202401 }],
  };
  const candidate = {
    code: 'DSA210',
    name: 'Introduction to Data Science',
    memberships: { main: null, doubleMajor: null, minors: [] },
  };

  const planned = filters.plannedStateForTarget(candidate, requirementContext);
  assert.equal(planned.state, 'earlier');
  assert.equal(planned.hasEarlier, true);
  assert.equal(filters.evaluateCandidate(candidate, { hideTaken: true }, {
    requirementContext,
  }).visible, false);
});

test('offeringState is tri-state and offered-only filtering fails open for unknown data', () => {
  const candidate = { code: 'CS201', name: 'Programming Fundamentals', memberships: { main: null, doubleMajor: null, minors: [] } };
  assert.equal(filters.offeringState(candidate, new Set(['CS201'])).state, 'offered');
  assert.equal(filters.offeringState(candidate, new Set()).state, 'not-offered');
  assert.equal(filters.offeringState(candidate, null).state, 'unknown');
  assert.equal(filters.offeringState(candidate, { known: false, codes: new Set() }).state, 'unknown');

  assert.equal(filters.evaluateCandidate(candidate, { offeredOnly: true }, {
    offeredCourseCodes: new Set(),
  }).visible, false);
  const unknown = filters.evaluateCandidate(candidate, { offeredOnly: true }, {
    offeredCourseCodes: { known: false, codes: new Set() },
  });
  assert.equal(unknown.offering.state, 'unknown');
  assert.equal(unknown.visible, true);
});

test('offering history derives conservative Fall and Spring advisories by distinct academic year', () => {
  const springOnly = filters.deriveOfferingPattern(offeringHistory([
    'Spring 2022-2023',
    'Spring 2023-2024',
    'Spring 2024-2025',
  ]), { referenceTermCode: '202503', lookbackYears: 6 });

  assert.equal(springOnly.status, 'known');
  assert.deepEqual([...springOnly.season.spring.academicYears], [2022, 2023, 2024]);
  assert.equal(springOnly.season.fall.count, 0);
  assert.equal(springOnly.noFall, true);
  assert.deepEqual(advisoryKeys(springOnly, '202601'), ['no-fall']);
  assert.deepEqual(advisoryKeys(springOnly, '202602'), []);
  assert.deepEqual(
    [...filters.contextualOfferingAdvisories(springOnly, 'Fall 2026-2027', 'unknown')]
      .map(({ key, label, kind }) => ({ key, label, kind })),
    [{ key: 'no-fall', label: 'No Fall offerings found', kind: 'season' }],
  );

  const fallOnly = filters.deriveOfferingPattern(offeringHistory([
    'Fall 2022-2023',
    'Fall 2023-2024',
    'Fall 2024-2025',
  ]), { referenceTermCode: '202503' });
  assert.equal(fallOnly.noSpring, true);
  assert.deepEqual(advisoryKeys(fallOnly, '202602'), ['no-spring']);
  assert.deepEqual(advisoryKeys(fallOnly, '202601'), []);
});

test('Summer advisory requires three distinct recent academic years with no Summer offering', () => {
  const noSummer = filters.deriveOfferingPattern(offeringHistory([
    // Multiple regular-semester observations in one academic year remain one
    // year of evidence; three distinct years are required for this signal.
    'Fall 2022-2023',
    'Spring 2022-2023',
    'Fall 2022-2023',
    'Spring 2023-2024',
    'Fall 2024-2025',
  ]), { referenceTermCode: '202503', lookbackYears: 6 });

  assert.equal(noSummer.status, 'known');
  assert.equal(noSummer.season.summer.count, 0);
  assert.deepEqual([...noSummer.season.summer.academicYears], []);
  assert.equal(noSummer.season.summer.noOfferingsFound, true);
  assert.equal(noSummer.noSummer, true);
  assert.equal(noSummer.flags.noSummer, true);
  assert.deepEqual(advisoryKeys(noSummer, '202603'), ['no-summer']);
  assert.deepEqual(advisoryKeys(noSummer, '202601'), []);
  assert.deepEqual(advisoryKeys(noSummer, '202602'), []);
  assert.deepEqual(
    [...filters.contextualOfferingAdvisories(noSummer, 'Summer 2026-2027', 'unknown')]
      .map(({ key, label, kind }) => ({ key, label, kind })),
    [{ key: 'no-summer', label: 'No Summer offerings found', kind: 'season' }],
  );

  // Exact selected-term evidence always outranks historical absence signals.
  assert.deepEqual(advisoryKeys(noSummer, '202603', 'offered'), []);
  assert.deepEqual(advisoryKeys(noSummer, '202603', { state: 'offered' }), []);
});

test('Summer advisory deduplicates years and fails open for sparse, failed, or positive Summer evidence', () => {
  const duplicateOnly = filters.deriveOfferingPattern(offeringHistory([
    'Fall 2023-2024',
    'Fall 2023-2024',
    'Spring 2023-2024',
    'Spring 2023-2024',
    'Fall 2024-2025',
    'Spring 2024-2025',
  ]), { referenceTermCode: '202503', lookbackYears: 6 });
  assert.equal(duplicateOnly.status, 'limited');
  assert.equal(duplicateOnly.noSummer, false);
  assert.equal(duplicateOnly.season.summer.noOfferingsFound, false);
  assert.deepEqual(advisoryKeys(duplicateOnly, '202603'), []);

  const failed = filters.deriveOfferingPattern(offeringHistory([
    'Fall 2022-2023',
    'Spring 2023-2024',
    'Fall 2024-2025',
  ], { scrapeOk: false }), { referenceTermCode: '202503', lookbackYears: 6 });
  assert.equal(failed.status, 'unknown');
  assert.equal(failed.noSummer, false);
  assert.deepEqual(advisoryKeys(failed, '202603'), []);

  const summerObserved = filters.deriveOfferingPattern(offeringHistory([
    'Fall 2021-2022',
    'Spring 2022-2023',
    'Summer 2023-2024',
    'Fall 2024-2025',
  ]), { referenceTermCode: '202503', lookbackYears: 6 });
  assert.equal(summerObserved.season.summer.count, 1);
  assert.equal(summerObserved.noSummer, false);
  assert.equal(summerObserved.season.summer.noOfferingsFound, false);
  assert.deepEqual(advisoryKeys(summerObserved, '202603'), []);
});

test('offering history fails open for failed, empty, sparse, and duplicate-only evidence', () => {
  const failed = filters.deriveOfferingPattern(offeringHistory([
    'Spring 2022-2023',
    'Spring 2023-2024',
    'Spring 2024-2025',
  ], { scrapeOk: false }), { referenceTermCode: '202503' });
  assert.equal(failed.status, 'unknown');
  assert.deepEqual([...failed.historyTerms], []);
  assert.deepEqual(advisoryKeys(failed, '202601'), []);

  const empty = filters.deriveOfferingPattern(offeringHistory([]), {
    referenceTermCode: '202503',
  });
  assert.equal(empty.status, 'unknown');
  assert.deepEqual(advisoryKeys(empty, '202601'), []);

  const sparse = filters.deriveOfferingPattern(offeringHistory([
    'Spring 2023-2024',
    'Spring 2024-2025',
  ]), { referenceTermCode: '202503' });
  assert.equal(sparse.status, 'limited');
  assert.equal(sparse.noFall, false);
  assert.deepEqual(advisoryKeys(sparse, '202601'), []);

  const sparseOld = filters.deriveOfferingPattern(offeringHistory([
    'Fall 2014-2015',
  ]), { referenceTermCode: '202503', lookbackYears: 6 });
  assert.equal(sparseOld.status, 'limited');
  assert.equal(sparseOld.noRecent, false,
    'one old positive record is not enough evidence for a negative recency claim');
  assert.deepEqual(advisoryKeys(sparseOld, '202601'), []);

  const twoOldYears = filters.deriveOfferingPattern(offeringHistory([
    'Fall 2013-2014',
    'Spring 2014-2015',
  ]), { referenceTermCode: '202503', lookbackYears: 6 });
  assert.equal(twoOldYears.status, 'limited');
  assert.equal(twoOldYears.noRecent, false,
    'two old academic years are still sparse positive-only evidence');
  assert.deepEqual(advisoryKeys(twoOldYears, '202601'), []);

  // The real MATH301 source contains repeated term rows. Repeats are one
  // observation, not enough evidence to infer that Fall is never offered.
  const math301 = filters.offeringHistoryForCandidate({ code: 'MATH301' }, new Map([
    ['MATH301', offeringHistory([
      'Spring 2024-2025',
      'Spring 2024-2025',
      'Spring 2024-2025',
    ])],
  ]), { referenceTermCode: '202503' });
  assert.deepEqual([...math301.historyTerms], ['202402']);
  assert.equal(math301.season.spring.count, 1);
  assert.equal(math301.noFall, false);
  assert.deepEqual(advisoryKeys(math301, '202601'), []);
});

test('offering cadence uses completed academic years and ignores current/future years as misses', () => {
  const irregular = filters.deriveOfferingPattern(offeringHistory([
    'Fall 2022-2023',
    'Spring 2024-2025',
    // Positive records in the reference and future academic years may be
    // retained, but neither year belongs to the completed-year denominator.
    'Fall 2026-2027',
    'Fall 2027-2028',
  ]), { referenceTermCode: '202601', lookbackYears: 6 });

  assert.deepEqual([...irregular.cadence.eligibleYears], [2022, 2023, 2024, 2025]);
  assert.deepEqual([...irregular.cadence.offeredYears], [2022, 2024]);
  assert.deepEqual([...irregular.cadence.missedYears], [2023, 2025]);
  assert.equal(irregular.cadence.status, 'irregular');
  assert.deepEqual(advisoryKeys(irregular, '202602'), ['irregular']);

  const oneMiss = filters.deriveOfferingPattern(offeringHistory([
    'Fall 2022-2023',
    'Fall 2023-2024',
    'Fall 2024-2025',
  ]), { referenceTermCode: '202601' });
  assert.deepEqual([...oneMiss.cadence.missedYears], [2025]);
  assert.equal(oneMiss.cadence.status, 'regular');
  assert.deepEqual(advisoryKeys(oneMiss, '202601'), [],
    'cadence remains non-advisory; Summer has its own independent seasonal signal');

  const oneOffer = filters.deriveOfferingPattern(offeringHistory([
    'Fall 2022-2023',
  ]), { referenceTermCode: '202601' });
  assert.equal(oneOffer.cadence.status, 'limited');
  assert.equal(oneOffer.irregular, false);
});

test('an exact target offering suppresses every historical advisory', () => {
  const irregular = filters.deriveOfferingPattern(offeringHistory([
    'Fall 2018-2019',
    'Fall 2021-2022',
    'Spring 2023-2024',
  ]), { referenceTermCode: '202503', lookbackYears: 6 });
  assert.equal(irregular.cadence.status, 'irregular');
  assert.deepEqual(advisoryKeys(irregular, '202601', 'unknown'), ['irregular']);
  assert.deepEqual(advisoryKeys(irregular, '202601', 'not-offered'), ['irregular']);
  assert.deepEqual(advisoryKeys(irregular, '202601', 'offered'), []);
  assert.deepEqual(advisoryKeys(irregular, '202601', { state: 'offered' }), []);

  const noRecent = filters.deriveOfferingPattern(offeringHistory([
    'Fall 2013-2014',
    'Spring 2014-2015',
    'Fall 2015-2016',
  ]), { referenceTermCode: '202503', lookbackYears: 6 });
  assert.equal(noRecent.noRecent, true);
  assert.deepEqual(advisoryKeys(noRecent, '202601', 'unknown'), ['no-recent']);
  assert.deepEqual(advisoryKeys(noRecent, '202601', { state: 'not-offered' }), ['no-recent']);
  assert.deepEqual(advisoryKeys(noRecent, '202601', { state: 'offered' }), []);
});

test('alias history is merged without mutation and exact offering wins over a seasonal warning', () => {
  const legacy = offeringHistory([], { scrapeOk: false });
  const canonical = offeringHistory([
    'Spring 2022-2023',
    'Spring 2023-2024',
    'Spring 2024-2025',
  ]);
  const before = JSON.parse(JSON.stringify({ legacy, canonical }));
  const infoByCode = new Map([
    ['CS210', legacy],
    ['DSA210', canonical],
  ]);

  const fromLegacy = filters.offeringHistoryForCandidate(
    { code: 'CS210' }, infoByCode, { referenceTermCode: '202503' },
  );
  const fromCanonical = filters.offeringHistoryForCandidate(
    { code: 'DSA210' }, infoByCode, { referenceTermCode: '202503' },
  );
  assert.deepEqual(JSON.parse(JSON.stringify(fromLegacy)), JSON.parse(JSON.stringify(fromCanonical)));
  assert.deepEqual([...fromCanonical.historyTerms], ['202202', '202302', '202402']);
  assert.equal(fromCanonical.noFall, true);
  assert.deepEqual(advisoryKeys(fromCanonical, '202601', 'unknown'), ['no-fall']);
  assert.deepEqual(advisoryKeys(fromCanonical, '202601', { state: 'not-offered' }), ['no-fall']);
  assert.deepEqual(advisoryKeys(fromCanonical, '202601', { state: 'offered' }), []);
  assert.deepEqual({ legacy, canonical }, before);
});

test('offering history annotations do not change exact-term offered-only tri-state filtering', () => {
  const candidate = {
    code: 'CS201',
    name: 'Programming Fundamentals',
    memberships: { main: null, doubleMajor: null, minors: [] },
  };
  const courseInfoByCode = new Map([['CS201', offeringHistory([
    'Spring 2022-2023',
    'Spring 2023-2024',
    'Spring 2024-2025',
  ])]]);
  const base = { courseInfoByCode, currentTermCode: '202503' };

  const offered = filters.evaluateCandidate(candidate, { offeredOnly: true }, {
    ...base,
    offeredCourseCodes: new Set(['CS201']),
  });
  assert.equal(offered.visible, true);
  assert.equal(offered.offering.state, 'offered');
  assert.equal(offered.offeringHistory.noFall, true);
  assert.deepEqual(advisoryKeys(offered.offeringHistory, '202601', offered.offering), []);

  const absent = filters.evaluateCandidate(candidate, { offeredOnly: true }, {
    ...base,
    offeredCourseCodes: new Set(),
  });
  assert.equal(absent.visible, false);
  assert.equal(absent.offering.state, 'not-offered');

  const unknown = filters.evaluateCandidate(candidate, { offeredOnly: true }, {
    ...base,
    offeredCourseCodes: { known: false, codes: new Set() },
  });
  assert.equal(unknown.visible, true);
  assert.equal(unknown.offering.state, 'unknown');
});

test('hide-unmet filters prerequisite/prior-SU failures but keeps coreq-only and unknown states', () => {
  const target = { termCode: '202402', courses: [] };
  const requirementContext = req.buildTermRequirementContext([target], target, () => true);
  const candidate = (code) => ({
    code,
    name: code,
    memberships: { main: null, doubleMajor: null, minors: [] },
  });
  const baseFilters = { checkPrerequisites: true, showUnmetPrerequisites: false };

  const prerequisite = filters.evaluateCandidate(candidate('MATH102'), baseFilters, {
    requirementContext,
    courseInfoByCode: new Map([['MATH102', {
      prerequisites: 'MATH 101 - Undergraduate - Min Grade D',
    }]]),
  });
  assert.equal(prerequisite.requirements.status, 'unmet');
  assert.equal(prerequisite.visible, false);
  assert.deepEqual([...prerequisite.reasons], ['prerequisites']);

  const priorSu = filters.evaluateCandidate(candidate('SPS303'), baseFilters, {
    requirementContext,
    courseInfoByCode: new Map([['SPS303', { minimum_earned_su_credits: 58 }]]),
  });
  assert.equal(priorSu.requirements.priorSuRequirement.actual, 0);
  assert.equal(priorSu.visible, false);

  const corequisite = filters.evaluateCandidate(candidate('EE200'), baseFilters, {
    requirementContext,
    courseInfoByCode: new Map([['EE200', { corequisites: 'EE 202 and EE 202R' }]]),
  });
  assert.equal(corequisite.requirements.status, 'unmet');
  assert.deepEqual([...corequisite.requirements.missingCorequisites], ['EE202']);
  assert.equal(corequisite.matches.prerequisites, true);
  assert.equal(corequisite.visible, true, 'a reciprocal corequisite pair must remain addable');

  const unknown = filters.evaluateCandidate(candidate('UNKNOWN101'), baseFilters, {
    requirementContext,
    courseInfoByCode: new Map(),
  });
  assert.equal(unknown.requirements.status, 'unknown');
  assert.equal(unknown.visible, true, 'missing metadata fails open');

  const unknownTermContext = req.buildTermRequirementContext(
    [{ termCode: '', courses: [] }],
    { termCode: '', courses: [] },
    () => true,
  );
  const unknownTerm = filters.evaluateCandidate(candidate('MATH102'), baseFilters, {
    requirementContext: unknownTermContext,
    courseInfoByCode: new Map([['MATH102', {
      prerequisites: 'MATH 101 - Undergraduate - Min Grade D',
    }]]),
  });
  assert.equal(unknownTerm.requirements.status, 'unknown');
  assert.equal(unknownTerm.visible, true);
});

test('active-filter count excludes search and annotation-only prerequisite checking', () => {
  assert.equal(filters.countActiveFilters({
    query: 'CS',
    checkPrerequisites: true,
    showUnmetPrerequisites: true,
  }), 0);
  assert.equal(filters.countActiveFilters({
    query: 'CS',
    program: 'IE',
    category: 'required',
    level: '400',
    minSu: 3,
    minEcts: 6,
    minBasicScience: 1,
    minEngineering: 5,
    hideTaken: true,
    offeredOnly: true,
    checkPrerequisites: true,
    showUnmetPrerequisites: false,
  }), 10);
});
