// requirements.js
// Degree requirements are stored as JSONL files under `requirements/<TERM>.jsonl`.
// Requirements remain explicitly unavailable until main.js resolves a real
// six-digit admit term, then that term's exact, complete dataset is loaded.
// (For backward compatibility, legacy `.json` files are also supported.)

let requirements = {};
let requirementsStatus = {
  main: { term: '', available: false },
  doubleMajor: { term: '', available: false },
};
let flatRequirementsTerm = '';
const requirementsCache = new Map();
const requirementsInflight = new Map();
let requirementsReadyPromise = Promise.resolve(requirements);
let requirementsInitializationSequence = 0;

const EXPECTED_REQUIREMENT_MAJORS = Object.freeze([
  'BIO', 'CS', 'DSA', 'ECON', 'EE', 'IE', 'MAN', 'MAT', 'ME', 'PSIR', 'PSY', 'VACD',
]);
const REQUIRED_REQUIREMENT_FIELDS = Object.freeze([
  'university', 'required', 'core', 'area', 'free', 'ects', 'total', 'humRequired',
]);
const CREDIT_BUCKET_FIELDS = Object.freeze(['university', 'required', 'core', 'area', 'free']);
const ENGINEERING_REQUIREMENT_MAJORS = new Set(['CS', 'EE', 'IE', 'MAT', 'ME']);
const INTERNSHIP_REQUIREMENT_MAJORS = new Set(['BIO', 'CS', 'DSA', 'EE', 'IE', 'MAT', 'ME']);
const GROUP_REQUIREMENT_MAJORS = new Set(['DSA', 'ECON', 'EE', 'MAN', 'ME', 'PSIR', 'PSY', 'VACD']);
const REQUIREMENT_GROUP_RULES = new Set([
  'faculty', 'credits', 'oneOf', 'entryGatedOneOf', 'languageCap', 'levelCredits',
  'specialAny', 'prefixSpan', 'offeringCredits', 'offeringCount', 'advancedCount',
]);
const VALID_HUM_REQUIREMENTS = new Set([
  '1:any',
  '2:any',
  '2:one200One300',
]);

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function isValidRequirementRecord(record, majorCode) {
  const major = String(majorCode || '').toUpperCase();
  if (!EXPECTED_REQUIREMENT_MAJORS.includes(major) || !isPlainObject(record)) return false;

  for (const field of REQUIRED_REQUIREMENT_FIELDS) {
    if (!isNonNegativeInteger(record[field])) return false;
  }
  if (record.total <= 0 || record.ects <= 0) return false;
  if (!VALID_HUM_REQUIREMENTS.has(`${record.humRequired}:${record.humRule}`)) return false;
  const creditTotal = CREDIT_BUCKET_FIELDS.reduce((sum, field) => sum + record[field], 0);
  // Category values are minimum pool targets. They can legitimately add up to
  // less than the independently published overall Total (EE/ME's MATH212 path
  // leaves a two-credit gap), but can never demand more credits than Total.
  if (creditTotal > record.total) return false;

  const facultyReq = record.facultyReq;
  if (!isPlainObject(facultyReq) || Object.keys(facultyReq).length === 0) return false;
  if (!Object.entries(facultyReq).every(([field, value]) => field && isNonNegativeInteger(value))) return false;

  if (ENGINEERING_REQUIREMENT_MAJORS.has(major)) {
    if (!isNonNegativeInteger(record.science) || record.science <= 0) return false;
    if (!isNonNegativeInteger(record.engineering) || record.engineering <= 0) return false;
  } else {
    if (record.science !== undefined && !isNonNegativeInteger(record.science)) return false;
    if (record.engineering !== undefined && !isNonNegativeInteger(record.engineering)) return false;
  }

  if (INTERNSHIP_REQUIREMENT_MAJORS.has(major)) {
    if (typeof record.internshipCourse !== 'string' || !record.internshipCourse.trim()) return false;
  }

  if (GROUP_REQUIREMENT_MAJORS.has(major)) {
    if (!Array.isArray(record.groups) || record.groups.length === 0) return false;
  }
  if (record.groups !== undefined) {
    if (!Array.isArray(record.groups)) return false;
    if (!record.groups.every(group => isPlainObject(group) && REQUIREMENT_GROUP_RULES.has(group.rule))) return false;
  }

  return true;
}

function parseJsonOrJsonl(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch (_) {
    try {
      const lines = trimmed.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      return lines.map(line => JSON.parse(line));
    } catch (_) {
      return null;
    }
  }
}

function normalizeRequirementsData(data) {
  if (!data) return null;
  const out = {};
  if (Array.isArray(data)) {
    for (const rec of data) {
      if (!isPlainObject(rec) || typeof rec.major !== 'string') return null;
      const maj = rec.major.trim().toUpperCase();
      if (!maj || out[maj]) return null;
      const copy = { ...rec };
      delete copy.major;
      out[maj] = copy;
    }
  } else if (isPlainObject(data)) {
    for (const [rawMajor, rec] of Object.entries(data)) {
      const major = String(rawMajor || '').trim().toUpperCase();
      if (!major || out[major] || !isPlainObject(rec)) return null;
      out[major] = { ...rec };
    }
  } else {
    return null;
  }

  const majors = Object.keys(out).sort();
  const expected = [...EXPECTED_REQUIREMENT_MAJORS].sort();
  if (majors.length !== expected.length || majors.some((major, index) => major !== expected[index])) return null;
  for (const major of expected) {
    if (!isValidRequirementRecord(out[major], major)) return null;
    if (out[major].science === undefined) out[major].science = 0;
    if (out[major].engineering === undefined) out[major].engineering = 0;
  }
  return out;
}

function requirementPaths(termCode) {
  return [`./requirements/${termCode}.jsonl`, `./requirements/${termCode}.json`];
}

function requirementsUseFileProtocol() {
  try {
    return typeof location !== 'undefined' && location && location.protocol === 'file:';
  } catch (_) {
    return false;
  }
}

function readRequirementTextSynchronously(path) {
  if (!requirementsUseFileProtocol() || typeof XMLHttpRequest !== 'function') return null;
  try {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', path, false);
    xhr.overrideMimeType('application/json');
    xhr.send(null);
    return xhr.status === 200 || xhr.status === 0 ? String(xhr.responseText || '') : null;
  } catch (_) {
    return null;
  }
}

async function fetchRequirementText(path) {
  if (typeof fetch !== 'function') return null;
  try {
    const response = await fetch(path);
    if (!response || !response.ok) return null;
    return await response.text();
  } catch (_) {
    return null;
  }
}

function parseRequirementsText(text) {
  if (text === null) return null;
  return normalizeRequirementsData(parseJsonOrJsonl(text));
}

// Compatibility reader for code that still needs an immediate result. HTTP(S)
// never enters synchronous XHR: callers receive only a validated cached value.
// Local file pages retain their historical synchronous sibling-file fallback.
function loadRequirements(termCode) {
  const requestedTerm = String(termCode || '').trim();
  if (!/^\d{6}$/.test(requestedTerm)) return null;
  if (requirementsCache.has(requestedTerm)) return requirementsCache.get(requestedTerm);
  if (!requirementsUseFileProtocol()) return null;
  for (const path of requirementPaths(requestedTerm)) {
    const data = parseRequirementsText(readRequirementTextSynchronously(path));
    if (!data) continue;
    requirementsCache.set(requestedTerm, data);
    return data;
  }
  return null;
}

function loadRequirementsAsync(termCode) {
  const requestedTerm = String(termCode || '').trim();
  if (!/^\d{6}$/.test(requestedTerm)) return Promise.resolve(null);
  if (requirementsCache.has(requestedTerm)) {
    return Promise.resolve(requirementsCache.get(requestedTerm));
  }
  if (requirementsInflight.has(requestedTerm)) return requirementsInflight.get(requestedTerm);

  const pending = (async () => {
    // `loadRequirements` may synchronously resolve only under file://.
    const local = loadRequirements(requestedTerm);
    if (local) return local;
    for (const path of requirementPaths(requestedTerm)) {
      const data = parseRequirementsText(await fetchRequirementText(path));
      if (!data) continue;
      requirementsCache.set(requestedTerm, data);
      return data;
    }
    // Do not cache an empty/transient result; the next call must be able to retry.
    return null;
  })();
  requirementsInflight.set(requestedTerm, pending);
  pending.finally(() => {
    if (requirementsInflight.get(requestedTerm) === pending) {
      requirementsInflight.delete(requestedTerm);
    }
  });
  return pending;
}

function getRequirementRecord(majorCode, termCode, source) {
  const major = String(majorCode || '').trim().toUpperCase();
  const term = String(termCode || '').trim();
  const all = source || requirements;
  if (!major || !isPlainObject(all)) return null;

  if (term && isPlainObject(all[term])) {
    return isValidRequirementRecord(all[term][major], major) ? all[term][major] : null;
  }
  if (source === undefined && term && flatRequirementsTerm && term !== flatRequirementsTerm) return null;
  return isValidRequirementRecord(all[major], major) ? all[major] : null;
}

function normalizeRequirementTerms(mainTermCode, doubleMajorTermCode) {
  const rawMainTerm = String(mainTermCode || '').trim();
  const mainTerm = /^\d{6}$/.test(rawMainTerm) ? rawMainTerm : '';
  const rawDMTerm = String(doubleMajorTermCode || '').trim();
  const dmTerm = !mainTerm
    ? ''
    : (!rawDMTerm ? mainTerm : (/^\d{6}$/.test(rawDMTerm) ? rawDMTerm : ''));
  return { mainTerm, dmTerm };
}

function publishRequirementsState(mainTerm, dmTerm, loadedMain, loadedDM) {
  if (!mainTerm) {
    requirements = {};
    flatRequirementsTerm = '';
    requirementsStatus = {
      main: { term: '', available: false },
      doubleMajor: { term: '', available: false },
    };
    if (typeof window !== 'undefined') {
      window.requirements = requirements;
      window.requirementsStatus = requirementsStatus;
    }
    return requirements;
  }

  if (dmTerm && dmTerm !== mainTerm) {
    requirements = {
      [mainTerm]: loadedMain || {},
      [dmTerm]: loadedDM || {},
    };
    flatRequirementsTerm = '';
  } else {
    requirements = loadedMain || {};
    flatRequirementsTerm = mainTerm;
  }

  requirementsStatus = {
    main: { term: mainTerm, available: !!loadedMain },
    doubleMajor: { term: dmTerm, available: !!loadedDM },
  };
  if (typeof window !== 'undefined') {
    window.requirements = requirements;
    window.requirementsStatus = requirementsStatus;
  }
  return requirements;
}

function initializeRequirements(mainTermCode, doubleMajorTermCode) {
  const { mainTerm, dmTerm } = normalizeRequirementTerms(mainTermCode, doubleMajorTermCode);
  requirementsInitializationSequence += 1;
  const loadedMain = mainTerm ? loadRequirements(mainTerm) : null;
  const loadedDM = !dmTerm ? null : (dmTerm !== mainTerm ? loadRequirements(dmTerm) : loadedMain);
  const result = publishRequirementsState(mainTerm, dmTerm, loadedMain, loadedDM);
  requirementsReadyPromise = Promise.resolve(result);
  return result;
}

function initializeRequirementsAsync(mainTermCode, doubleMajorTermCode) {
  const { mainTerm, dmTerm } = normalizeRequirementTerms(mainTermCode, doubleMajorTermCode);
  const sequence = ++requirementsInitializationSequence;
  const pending = (async () => {
    if (!mainTerm) {
      if (sequence === requirementsInitializationSequence) {
        publishRequirementsState('', '', null, null);
      }
      return requirements;
    }
    const [loadedMain, loadedDistinctDM] = await Promise.all([
      loadRequirementsAsync(mainTerm),
      dmTerm && dmTerm !== mainTerm ? loadRequirementsAsync(dmTerm) : Promise.resolve(null),
    ]);
    const loadedDM = !dmTerm ? null : (dmTerm === mainTerm ? loadedMain : loadedDistinctDM);
    if (sequence === requirementsInitializationSequence) {
      publishRequirementsState(mainTerm, dmTerm, loadedMain, loadedDM);
    }
    return requirements;
  })();
  requirementsReadyPromise = pending;
  return pending;
}

function whenRequirementsReady() {
  return requirementsReadyPromise;
}

// Expose the requirements object on the window in browser environments. This
// allows other scripts to access `requirements` when modules are not
// available (e.g., when loading files directly via the file:// scheme).
if (typeof window !== 'undefined') {
  window.requirements = requirements;
  window.requirementsStatus = requirementsStatus;
  window.loadRequirements = loadRequirements;
  window.loadRequirementsAsync = loadRequirementsAsync;
  window.initializeRequirements = initializeRequirements;
  window.initializeRequirementsAsync = initializeRequirementsAsync;
  window.whenRequirementsReady = whenRequirementsReady;
  window.getRequirementRecord = getRequirementRecord;
  window.isValidRequirementRecord = isValidRequirementRecord;
  window.normalizeRequirementsData = normalizeRequirementsData;
}
