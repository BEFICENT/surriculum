'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { REPO_ROOT } = require('./helpers/load-script');

let ranking;
let browserBridge;

test.before(async () => {
  browserBridge = {};
  globalThis.window = browserBridge;
  const moduleUrl = pathToFileURL(
    path.join(REPO_ROOT, 'scripts/domain/suggestion-ranking.js'),
  ).href;
  ranking = await import(moduleUrl);
  delete globalThis.window;
});

const record = (major, code, type, overrides = {}) => ({
  Major: major,
  Code: code,
  EL_Type: type,
  SU_credit: '3',
  Basic_Science: '0',
  Engineering: '0',
  ...overrides,
});

test('exports the established immutable policy through a frozen browser bridge', () => {
  assert.deepEqual(ranking.SUGGESTION_TYPE_SCORES, {
    university: 36,
    required: 28,
    core: 18,
    area: 12,
    free: 0,
  });
  assert.equal(ranking.SUGGESTION_GROUP_BONUS, 6);
  assert.equal(Object.isFrozen(ranking.SUGGESTION_TYPE_SCORES), true);
  assert.equal(Object.isFrozen(browserBridge.suggestionRanking), true);
  assert.equal(browserBridge.suggestionRanking.scoreSuggestionCourse, ranking.scoreSuggestionCourse);
});

test('record details preserve every current score component exactly', () => {
  const math = record('MATH', '101', 'university', {
    Basic_Science: '6',
    Engineering: '2',
  });
  const details = ranking.scoreSuggestionRecordDetails(math, {
    includeBsWeights: true,
    includeEngWeights: true,
    groupBonusCodes: new Set(['MATH101']),
  });

  assert.deepEqual(details, {
    courseCode: 'MATH101',
    baseType: 'university',
    effectiveType: 'university',
    excluded: false,
    typeScore: 36,
    creditScore: 0.3,
    groupBonus: 6,
    basicScienceScore: 12,
    engineeringScore: 2,
    score: 56.3,
  });
  assert.equal(Object.isFrozen(details), true);
});

test('a context baseType overrides catalog metadata', () => {
  const details = ranking.scoreSuggestionRecordDetails(
    record('CS', '404', 'required'),
    { baseType: 'core' },
  );

  assert.equal(details.baseType, 'core');
  assert.equal(details.effectiveType, 'core');
  assert.equal(details.typeScore, 18);
  assert.equal(details.score, 18.3);

  const mapped = ranking.scoreSuggestionRecordDetails(
    record('CS', '412', 'required'),
    { baseTypeOverrides: new Map([['CS412', 'core']]) },
  );
  assert.equal(mapped.baseType, 'core');
  assert.equal(mapped.effectiveType, 'core');
  assert.equal(mapped.score, 18.3);
});

test('course scores add weighted contexts and round to three decimals', () => {
  const mainMap = ranking.buildSuggestionRecordMap([record('CS', '310', 'core')]);
  const minorMap = ranking.buildSuggestionRecordMap([record('CS', '310', 'area')]);

  // (18 + 0.3) * 1.2 + (12 + 0.3) * 0.5 = 28.11
  assert.equal(ranking.scoreSuggestionCourse(' cs 310 ', [
    { map: mainMap, weight: 1.2 },
    { recordMap: minorMap, weight: 0.5 },
  ]), 28.11);
});

test('fulfilled university and required categories suppress only their type points', () => {
  const university = record('IF', '100', 'university');
  const required = record('CS', '201', 'required');

  assert.equal(ranking.scoreSuggestionRecordDetails(university, {
    includeUniversityWeights: false,
    groupBonusCodes: new Set(['IF100']),
  }).score, 6.3, 'credit and unmet-group scores remain');

  assert.equal(ranking.scoreSuggestionRecordDetails(required, {
    includeRequiredWeights: false,
  }).score, 0.3, 'credit score remains');

  assert.equal(ranking.scoreSuggestionRecordDetails(required, {
    includeRequiredWeights: true,
  }).score, 28.3);
});

test('pool needs assign the highest still-useful marginal requirement type', () => {
  const required = record('CS', '301', 'required');
  const core = record('CS', '302', 'core');
  const area = record('CS', '303', 'area');

  const cases = [
    [required, { required: true, core: true, area: true }, 'required', 28.3],
    [required, { required: false, core: true, area: true }, 'core', 18.3],
    [required, { required: 0, core: 0, area: '3' }, 'area', 12.3],
    [required, { required: false, core: false, area: false }, 'free', 0.3],
    [core, { required: true, core: true, area: true }, 'core', 18.3],
    [core, { required: true, core: false, area: true }, 'area', 12.3],
    [core, { required: true, core: false, area: false }, 'free', 0.3],
    [area, { required: true, core: true, area: true }, 'area', 12.3],
    [area, { required: true, core: true, area: false }, 'free', 0.3],
  ];

  for (const [course, poolNeeds, effectiveType, score] of cases) {
    const details = ranking.scoreSuggestionRecordDetails(course, { poolNeeds });
    assert.equal(details.effectiveType, effectiveType);
    assert.equal(details.score, score);
  }

  const poolStateWinsOverLegacyRequiredFlag = ranking.scoreSuggestionRecordDetails(required, {
    poolNeeds: { required: true, core: false, area: false },
    includeRequiredWeights: false,
  });
  assert.equal(poolStateWinsOverLegacyRequiredFlag.effectiveType, 'required');
  assert.equal(poolStateWinsOverLegacyRequiredFlag.score, 28.3);
});

test('retained named and group candidates keep their base type after pool completion', () => {
  const required = record('CS', '401', 'required');
  const retainedRequired = ranking.scoreSuggestionRecordDetails(required, {
    poolNeeds: { required: false, core: false, area: false },
    includeRequiredWeights: false,
    retainBaseTypeCodes: new Set(['CS401']),
  });
  assert.equal(retainedRequired.baseType, 'required');
  assert.equal(retainedRequired.effectiveType, 'required');
  assert.equal(retainedRequired.score, 28.3);

  const retainedCore = ranking.scoreSuggestionRecordDetails(record('CS', '402', 'core'), {
    poolNeeds: { required: false, core: false, area: false },
    retainBaseTypeCodes: [' cs 402 '],
  });
  assert.equal(retainedCore.effectiveType, 'core');
  assert.equal(retainedCore.score, 18.3);

  const legacyRequired = ranking.scoreSuggestionRecordDetails(required, {
    includeRequiredWeights: false,
    retainBaseTypeCodes: new Set(['CS401']),
  });
  assert.equal(legacyRequired.score, 28.3, 'an explicitly retained named course keeps its tier');

  const university = ranking.scoreSuggestionRecordDetails(record('IF', '100', 'university'), {
    includeUniversityWeights: false,
    poolNeeds: { required: false, core: false, area: false },
    retainBaseTypeCodes: new Set(['IF100']),
  });
  assert.equal(university.score, 36.3, 'retention overrides aggregate university completion');
});

test('excluded codes contribute zero in every component and only in that context', () => {
  const course = record('CS', '310', 'core', {
    SU_credit: '4',
    Basic_Science: '3',
    Engineering: '2',
  });
  const excluded = ranking.scoreSuggestionRecordDetails(course, {
    excludedCodes: { ' cs 310 ': true },
    groupBonusCodes: new Set(['CS310']),
    includeBsWeights: true,
    includeEngWeights: true,
  });

  assert.deepEqual(excluded, {
    courseCode: 'CS310',
    baseType: 'core',
    effectiveType: 'none',
    excluded: true,
    typeScore: 0,
    creditScore: 0,
    groupBonus: 0,
    basicScienceScore: 0,
    engineeringScore: 0,
    score: 0,
  });
  assert.equal(Object.isFrozen(excluded), true);

  const map = ranking.buildSuggestionRecordMap([course]);
  assert.equal(ranking.scoreSuggestionCourse('CS310', [
    { map, weight: 100, excludedCodes: new Set(['CS310']) },
    { map, weight: 0.5 },
  ]), 9.2, 'exclusion in one program context must not suppress another');

  const aliasExcluded = ranking.scoreSuggestionRecordDetails(
    record('DSA', '210', 'required'),
    { excludedCodes: new Set(['cs210']) },
  );
  assert.equal(aliasExcluded.excluded, true);
  assert.equal(aliasExcluded.score, 0);
});

test('unknown and malformed input is safe and always produces finite scores', () => {
  assert.equal(ranking.canonicalizeSuggestionCode(null), '');
  assert.equal(ranking.scoreSuggestionCourse('', []), 0);
  assert.equal(ranking.scoreSuggestionCourse('NOTACOURSE999', [null, {}, { map: new Map() }]), 0);
  assert.equal(ranking.scoreSuggestionRecordDetails(null, null).score, 0);

  const malformed = record('ODD', '999', 'unknown', {
    SU_credit: 'not-a-number',
    Basic_Science: undefined,
    Engineering: Infinity,
  });
  const details = ranking.scoreSuggestionRecordDetails(malformed, {
    includeBsWeights: true,
    includeEngWeights: true,
  });
  assert.equal(details.score, 0);
  assert.equal(details.excluded, true);
  assert.equal(details.effectiveType, 'none');
  assert.equal(Number.isFinite(details.score), true);

  for (const type of ['unknown', 'none', '', '   ']) {
    const invalid = ranking.scoreSuggestionRecordDetails(record('ODD', '998', type, {
      SU_credit: '5',
      Basic_Science: '4',
      Engineering: '3',
    }), {
      groupBonusCodes: new Set(['ODD998']),
      includeBsWeights: true,
      includeEngWeights: true,
    });
    assert.equal(invalid.excluded, true);
    assert.equal(invalid.effectiveType, 'none');
    assert.equal(invalid.typeScore, 0);
    assert.equal(invalid.creditScore, 0);
    assert.equal(invalid.groupBonus, 0);
    assert.equal(invalid.basicScienceScore, 0);
    assert.equal(invalid.engineeringScore, 0);
    assert.equal(invalid.score, 0);
  }

  const missingIdentity = ranking.scoreSuggestionRecordDetails(record('', '', 'required'));
  assert.equal(missingIdentity.excluded, true);
  assert.equal(missingIdentity.score, 0);
});

test('DSA210 metadata wins over legacy CS210 regardless of catalog row order', () => {
  const legacy = record('CS', '210', 'area', { Course_Name: 'Legacy', SU_credit: '3' });
  const canonical = record('DSA', '210', 'required', { Course_Name: 'Current', SU_credit: '4' });

  for (const rows of [[legacy, canonical], [canonical, legacy]]) {
    const map = ranking.buildSuggestionRecordMap(rows);
    assert.equal(map.size, 1);
    assert.equal(map.get('DSA210'), canonical);
    assert.equal(ranking.scoreSuggestionCourse('CS210', [{ map }]), 28.4);
    assert.equal(ranking.scoreSuggestionCourse('DSA 210', [{ map }]), 28.4);
  }
});
