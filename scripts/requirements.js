// requirements.js
// Degree requirements are stored as JSONL files under `requirements/<TERM>.jsonl`.
// A selected term must load its exact, complete dataset; the stable
// `requirements/default.jsonl` is used only when no term has been selected yet.
// (For backward compatibility, legacy `.json` files are also supported.)

let requirements = {};
let requirementsStatus = {};
let flatRequirementsTerm = '';

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
  if (!new Set([0, 1, 2]).has(record.humRequired)) return false;
  const creditTotal = CREDIT_BUCKET_FIELDS.reduce((sum, field) => sum + record[field], 0);
  if (creditTotal !== record.total) return false;

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

function loadRequirements(termCode) {
  const requestedTerm = String(termCode || 'default').trim() || 'default';
  const paths = requestedTerm === 'default'
    ? ['./requirements/default.jsonl', './requirements/default.json']
    : [`./requirements/${requestedTerm}.jsonl`, `./requirements/${requestedTerm}.json`];
  const tryLoad = (p) => {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', p, false);
      xhr.overrideMimeType('application/json');
      xhr.send(null);
      if (xhr.status === 200 || xhr.status === 0) return normalizeRequirementsData(parseJsonOrJsonl(xhr.responseText));
    } catch (_) {}
    return null;
  };
  let data = null;
  for (const p of paths) {
    data = tryLoad(p);
    if (data) break;
  }
  return data;
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

function initializeRequirements(mainTermCode, doubleMajorTermCode) {
  const mainTerm = String(mainTermCode || 'default').trim() || 'default';
  const dmTerm = String(doubleMajorTermCode || mainTerm).trim() || mainTerm;
  const loadedMain = loadRequirements(mainTerm);
  const loadedDM = dmTerm !== mainTerm ? loadRequirements(dmTerm) : loadedMain;

  if (dmTerm !== mainTerm) {
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

let termName = '';
let termNameDM = '';
try {
  const ps = (typeof window !== 'undefined') ? window.planStorage : null;
  const get = (k) => {
    try { return ps ? ps.getItem(k) : localStorage.getItem(k); } catch (_) {}
    try { return localStorage.getItem(k); } catch (_) {}
    return null;
  };
  termName = get('entryTerm') || '';
  termNameDM = get('entryTermDM') || termName;
} catch (_) {}

let termCode = '';
let termCodeDM = '';
try {
  if (typeof termNameToCode === 'function') {
    termCode = termNameToCode(termName);
    termCodeDM = termNameToCode(termNameDM);
  }
} catch (_) {}

initializeRequirements(termCode || 'default', termCodeDM || termCode || 'default');

// Expose the requirements object on the window in browser environments. This
// allows other scripts to access `requirements` when modules are not
// available (e.g., when loading files directly via the file:// scheme).
if (typeof window !== 'undefined') {
  window.requirements = requirements;
  window.requirementsStatus = requirementsStatus;
  window.loadRequirements = loadRequirements;
  window.initializeRequirements = initializeRequirements;
  window.getRequirementRecord = getRequirementRecord;
  window.isValidRequirementRecord = isValidRequirementRecord;
  window.normalizeRequirementsData = normalizeRequirementsData;
}
