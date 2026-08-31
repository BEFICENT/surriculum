// suggestion-ranking.js
// Pure scoring primitives for Planner and Scheduler course suggestions.
//
// The browser-facing controllers are responsible for building term-aware
// contexts (program progress, unmet groups, and catalog records). Keeping the
// arithmetic here free of app state makes both surfaces use exactly the same
// ranking policy and lets that policy be tested without a rendered curriculum.

export const SUGGESTION_TYPE_SCORES = Object.freeze({
  university: 36,
  required: 28,
  core: 18,
  area: 12,
  free: 0,
});

export const SUGGESTION_GROUP_BONUS = 6;

function normalizeSuggestionCode(value) {
  try {
    return String(value ?? '').toUpperCase().replace(/\s+/g, '');
  } catch (_) {
    return '';
  }
}

/**
 * Return the catalog code used for suggestion lookup and requirement groups.
 * CS210 is the legacy identity of DSA210, so both must share one score.
 */
export function canonicalizeSuggestionCode(value) {
  const normalized = normalizeSuggestionCode(value);
  return normalized === 'CS210' || normalized === 'DSA210'
    ? 'DSA210'
    : normalized;
}

function recordCode(record) {
  if (!record || typeof record !== 'object') return '';

  try {
    const major = record.Major ?? record.major ?? '';
    const number = record.Code ?? record.courseNumber ?? '';
    if (major || number) return normalizeSuggestionCode(`${major}${number}`);
    return normalizeSuggestionCode(record.courseCode ?? record.code ?? '');
  } catch (_) {
    return '';
  }
}

/**
 * Build the canonical record lookup used by a single program context.
 *
 * Catalogs can contain both the old CS210 row and the current DSA210 row. The
 * current row is authoritative even when the legacy row happens to occur first
 * (or last) in scraped data. Other duplicate rows retain first-row behaviour.
 */
export function buildSuggestionRecordMap(records) {
  const map = new Map();
  if (!Array.isArray(records)) return map;

  for (const record of records) {
    const rawCode = recordCode(record);
    const canonicalCode = canonicalizeSuggestionCode(rawCode);
    if (!canonicalCode) continue;

    const existing = map.get(canonicalCode);
    if (!existing) {
      map.set(canonicalCode, record);
      continue;
    }

    // An exact canonical record beats an alias. In particular, DSA210 must
    // always beat CS210 regardless of source row order.
    const candidateIsExact = rawCode === canonicalCode;
    const existingIsExact = recordCode(existing) === canonicalCode;
    if (candidateIsExact && !existingIsExact) map.set(canonicalCode, record);
  }

  return map;
}

function finiteNumber(value, fallback = 0) {
  try {
    if (value === null || value === undefined || value === '') return fallback;
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  } catch (_) {
    return fallback;
  }
}

function roundScore(value) {
  return Math.round(value * 1000) / 1000;
}

function codeCollectionContains(codes, canonicalCode) {
  if (!codes || !canonicalCode) return false;

  try {
    if (typeof codes.has === 'function') {
      if (codes.has(canonicalCode)) return true;
      if (typeof codes.values === 'function') {
        for (const code of codes.values()) {
          if (canonicalizeSuggestionCode(code) === canonicalCode) return true;
        }
      }
    }
    if (Array.isArray(codes)) {
      return codes.some((code) => canonicalizeSuggestionCode(code) === canonicalCode);
    }
    if (typeof codes === 'object') {
      if (Object.prototype.hasOwnProperty.call(codes, canonicalCode)) {
        return codes[canonicalCode] !== false;
      }
      return Object.keys(codes).some((code) => (
        codes[code] !== false && canonicalizeSuggestionCode(code) === canonicalCode
      ));
    }
  } catch (_) {}

  return false;
}

function groupContains(groupBonusCodes, canonicalCode) {
  return codeCollectionContains(groupBonusCodes, canonicalCode);
}

function poolIsNeeded(poolNeeds, type) {
  if (!poolNeeds || typeof poolNeeds !== 'object') return false;
  const value = poolNeeds[type];
  if (typeof value === 'boolean') return value;
  return finiteNumber(value) > 0;
}

function marginalEffectiveType(baseType, poolNeeds, retainBaseType) {
  if (retainBaseType || !poolNeeds || typeof poolNeeds !== 'object') return baseType;

  if (baseType === 'required') {
    if (poolIsNeeded(poolNeeds, 'required')) return 'required';
    if (poolIsNeeded(poolNeeds, 'core')) return 'core';
    if (poolIsNeeded(poolNeeds, 'area')) return 'area';
    return 'free';
  }
  if (baseType === 'core') {
    if (poolIsNeeded(poolNeeds, 'core')) return 'core';
    if (poolIsNeeded(poolNeeds, 'area')) return 'area';
    return 'free';
  }
  if (baseType === 'area') {
    return poolIsNeeded(poolNeeds, 'area') ? 'area' : 'free';
  }
  return baseType;
}

function validProgramType(type) {
  return Object.prototype.hasOwnProperty.call(SUGGESTION_TYPE_SCORES, type);
}

function emptyScoreDetails(baseType = '', courseCode = '', excluded = true) {
  return Object.freeze({
    courseCode,
    baseType,
    effectiveType: excluded ? 'none' : baseType,
    excluded,
    typeScore: 0,
    creditScore: 0,
    groupBonus: 0,
    basicScienceScore: 0,
    engineeringScore: 0,
    score: 0,
  });
}

/**
 * Score one catalog record in one program/progress context.
 *
 * Supported context fields:
 * - baseType: optional catalog/base-type override
 * - baseTypeOverrides: optional Map/object keyed by canonical course code
 * - excludedCodes: codes that must contribute no score in this context
 * - poolNeeds: remaining required/core/area pool needs for marginal scoring
 * - retainBaseTypeCodes: named/group candidates that keep their original type
 * - includeUniversityWeights / includeRequiredWeights: suppression flags
 * - includeBsWeights / includeEngWeights: science/engineering progress flags
 * - groupBonusCodes: Set (or array) of canonical members of unmet groups
 */
export function scoreSuggestionRecordDetails(record, context = {}) {
  if (!record || typeof record !== 'object') return emptyScoreDetails();

  try {
    const safeContext = context && typeof context === 'object' ? context : {};
    const canonicalCode = canonicalizeSuggestionCode(recordCode(record));
    const mappedBaseType = (() => {
      const overrides = safeContext.baseTypeOverrides;
      if (!overrides || !canonicalCode) return undefined;
      if (typeof overrides.get === 'function') return overrides.get(canonicalCode);
      if (typeof overrides === 'object') return overrides[canonicalCode];
      return undefined;
    })();
    const rawBaseType = mappedBaseType ?? safeContext.baseType
      ?? record.EL_Type ?? record.elType ?? '';
    const baseType = String(rawBaseType ?? '').trim().toLowerCase();

    const explicitlyExcluded = codeCollectionContains(safeContext.excludedCodes, canonicalCode);
    const excluded = !canonicalCode || explicitlyExcluded || !validProgramType(baseType);
    if (excluded) return emptyScoreDetails(baseType, canonicalCode, true);

    const retainBaseType = codeCollectionContains(
      safeContext.retainBaseTypeCodes,
      canonicalCode,
    );
    const hasPoolNeeds = !!(
      safeContext.poolNeeds && typeof safeContext.poolNeeds === 'object'
    );
    const effectiveType = marginalEffectiveType(
      baseType,
      safeContext.poolNeeds,
      retainBaseType,
    );

    let typeScore = SUGGESTION_TYPE_SCORES[effectiveType] || 0;
    if (!retainBaseType
        && effectiveType === 'university'
        && safeContext.includeUniversityWeights === false) {
      typeScore = 0;
    } else if (!retainBaseType
        && !hasPoolNeeds
        && effectiveType === 'required'
        && safeContext.includeRequiredWeights === false) {
      typeScore = 0;
    }

    const creditScore = roundScore(finiteNumber(record.SU_credit ?? record.suCredit) * 0.1);
    const groupBonus = groupContains(safeContext.groupBonusCodes, canonicalCode)
      ? SUGGESTION_GROUP_BONUS
      : 0;
    const basicScienceScore = safeContext.includeBsWeights
      ? finiteNumber(record.Basic_Science ?? record.basicScience) * 2
      : 0;
    const engineeringScore = safeContext.includeEngWeights
      ? finiteNumber(record.Engineering ?? record.engineering)
      : 0;
    const score = roundScore(typeScore
      + creditScore
      + groupBonus
      + basicScienceScore
      + engineeringScore);

    return Object.freeze({
      courseCode: canonicalCode,
      baseType,
      effectiveType,
      excluded: false,
      typeScore,
      creditScore,
      groupBonus,
      basicScienceScore,
      engineeringScore,
      score,
    });
  } catch (_) {
    return emptyScoreDetails();
  }
}

/**
 * Add the weighted score of a course across main-major, double-major, and
 * minor contexts. Each context supplies its record lookup as `map` (or the
 * clearer `recordMap`) and may supply a numeric `weight`, defaulting to 1.
 */
export function scoreSuggestionCourse(courseCode, contexts) {
  const canonicalCode = canonicalizeSuggestionCode(courseCode);
  if (!canonicalCode || !Array.isArray(contexts)) return 0;

  let total = 0;
  for (const context of contexts) {
    if (!context || typeof context !== 'object') continue;

    try {
      const map = context.recordMap ?? context.map;
      if (!map || typeof map.get !== 'function') continue;
      const record = map.get(canonicalCode);
      if (!record) continue;

      const weight = finiteNumber(context.weight, 1);
      total += weight * scoreSuggestionRecordDetails(record, context).score;
    } catch (_) {}
  }

  return Number.isFinite(total) ? roundScore(total) : 0;
}

// Temporary bridge for classic scripts. It is immutable so legacy consumers
// cannot silently replace only part of the shared policy.
export const suggestionRanking = Object.freeze({
  SUGGESTION_TYPE_SCORES,
  SUGGESTION_GROUP_BONUS,
  canonicalizeSuggestionCode,
  buildSuggestionRecordMap,
  scoreSuggestionRecordDetails,
  scoreSuggestionCourse,
});

if (typeof window !== 'undefined') {
  window.suggestionRanking = suggestionRanking;
}
