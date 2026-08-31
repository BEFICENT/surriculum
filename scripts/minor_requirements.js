// minor_requirements.js
// Minor requirements can be stored either:
// - Legacy: `requirements/minors.jsonl` (single snapshot term)
// - Term-specific: `requirements/minors/<TERM>.jsonl` (recommended)
//
// This loader supports both and exposes helpers to load a specific term and
// to discover which term codes are available.

function parseJsonlLines(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return [];
  return trimmed.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => JSON.parse(l));
}

function parseJsonOrJsonl(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch (_) {
    try {
      return parseJsonlLines(trimmed);
    } catch (_) {
      return null;
    }
  }
}

function toRecordArray(parsed) {
  if (!parsed) return [];
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') return Object.values(parsed);
  return [];
}

const minorRequirementsCache = new Map();
const minorRequirementsInflight = new Map();
let minorTermCodesCache = null;
let minorTermCodesInflight = null;
let minorRequirements = {};
let minorRequirementsReadyPromise = Promise.resolve(minorRequirements);
let minorRequirementsInitializationSequence = 0;

function minorRequirementsUseFileProtocol() {
  try {
    return typeof location !== 'undefined' && location && location.protocol === 'file:';
  } catch (_) {
    return false;
  }
}

function minorRequirementPaths(termCode) {
  const code = String(termCode || '').trim();
  return (code
    ? [`./requirements/minors/${code}.jsonl`, `./requirements/minors/${code}.json`]
    : []).concat(['./requirements/minors.jsonl', './requirements/minors.json']);
}

function readMinorRequirementTextSynchronously(path) {
  if (!minorRequirementsUseFileProtocol() || typeof XMLHttpRequest !== 'function') return null;
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

async function fetchMinorRequirementText(path) {
  if (typeof fetch !== 'function') return null;
  try {
    const response = await fetch(path);
    if (!response || !response.ok) return null;
    return await response.text();
  } catch (_) {
    return null;
  }
}

function normalizeMinorRequirements(parsed) {
  const data = toRecordArray(parsed);
  const byCode = {};
  if (Array.isArray(data)) {
    for (const rec of data) {
      if (!rec || typeof rec !== 'object') continue;
      const code = rec.minor;
      if (!code) continue;
      byCode[String(code)] = rec;
    }
  }
  return Object.keys(byCode).length ? byCode : null;
}

function parseMinorRequirementsText(text) {
  if (text === null) return null;
  return normalizeMinorRequirements(parseJsonOrJsonl(text));
}

// Immediate compatibility lookup. On HTTP(S) this is cache-only so legacy
// graduation consumers can remain synchronous without blocking the main thread.
function loadMinorRequirementsForTerm(termCode) {
  const code = String(termCode || '').trim();
  if (code && !/^\d{6}$/.test(code)) return {};
  if (minorRequirementsCache.has(code)) return minorRequirementsCache.get(code);
  if (!minorRequirementsUseFileProtocol()) return {};
  for (const path of minorRequirementPaths(code)) {
    const data = parseMinorRequirementsText(readMinorRequirementTextSynchronously(path));
    if (!data) continue;
    minorRequirementsCache.set(code, data);
    return data;
  }
  return {};
}

function loadMinorRequirementsForTermAsync(termCode) {
  const code = String(termCode || '').trim();
  if (code && !/^\d{6}$/.test(code)) return Promise.resolve({});
  if (minorRequirementsCache.has(code)) {
    return Promise.resolve(minorRequirementsCache.get(code));
  }
  if (minorRequirementsInflight.has(code)) return minorRequirementsInflight.get(code);

  const pending = (async () => {
    // The compatibility lookup can perform I/O only for local file pages.
    const local = loadMinorRequirementsForTerm(code);
    if (Object.keys(local).length) return local;
    for (const path of minorRequirementPaths(code)) {
      const data = parseMinorRequirementsText(await fetchMinorRequirementText(path));
      if (!data) continue;
      minorRequirementsCache.set(code, data);
      return data;
    }
    // Empty/transient reads are deliberately not cached so later calls retry.
    return {};
  })();
  minorRequirementsInflight.set(code, pending);
  pending.finally(() => {
    if (minorRequirementsInflight.get(code) === pending) {
      minorRequirementsInflight.delete(code);
    }
  });
  return pending;
}

function loadMinorRequirements() {
  return loadMinorRequirementsForTerm('');
}

function termCodesFromParsedMinorData(parsed) {
  const out = [];
  for (const rec of toRecordArray(parsed)) {
    if (typeof rec === 'string' && /^\d{6}$/.test(rec)) out.push(rec);
    else if (rec && typeof rec === 'object' && rec.term && /^\d{6}$/.test(String(rec.term))) {
      out.push(String(rec.term));
    }
  }
  return Array.from(new Set(out)).sort((a, b) => (parseInt(b, 10) - parseInt(a, 10)));
}

function deriveMinorTermCodesFromRequirements(req) {
  const codes = [];
  for (const record of Object.values(req || {})) {
    if (!record || typeof record !== 'object' || !record.term) continue;
    try {
      if (typeof window !== 'undefined' && typeof window.termNameToCode === 'function') {
        const code = window.termNameToCode(String(record.term));
        if (code && /^\d{6}$/.test(code)) codes.push(code);
      }
    } catch (_) {}
  }
  return Array.from(new Set(codes)).sort((a, b) => (parseInt(b, 10) - parseInt(a, 10)));
}

function loadMinorTermCodes() {
  if (minorTermCodesCache) return minorTermCodesCache.slice();
  if (!minorRequirementsUseFileProtocol()) return [];
  const paths = ['./requirements/minors/terms.jsonl', './requirements/minors/terms.json'];
  for (const path of paths) {
    const text = readMinorRequirementTextSynchronously(path);
    if (text === null) continue;
    const codes = termCodesFromParsedMinorData(parseJsonOrJsonl(text));
    if (codes.length) {
      minorTermCodesCache = codes;
      return codes.slice();
    }
  }
  const derived = deriveMinorTermCodesFromRequirements(loadMinorRequirements());
  if (derived.length) minorTermCodesCache = derived;
  return derived.slice();
}

function loadMinorTermCodesAsync() {
  if (minorTermCodesCache) return Promise.resolve(minorTermCodesCache.slice());
  if (minorTermCodesInflight) return minorTermCodesInflight;
  const pending = (async () => {
    const local = loadMinorTermCodes();
    if (local.length) return local;
    const paths = ['./requirements/minors/terms.jsonl', './requirements/minors/terms.json'];
    for (const path of paths) {
      const text = await fetchMinorRequirementText(path);
      if (text === null) continue;
      const codes = termCodesFromParsedMinorData(parseJsonOrJsonl(text));
      if (!codes.length) continue;
      minorTermCodesCache = codes;
      return codes.slice();
    }
    const derived = deriveMinorTermCodesFromRequirements(
      await loadMinorRequirementsForTermAsync('')
    );
    if (derived.length) minorTermCodesCache = derived;
    // Do not latch an empty result; a later call must retry transient failures.
    return derived.slice();
  })();
  minorTermCodesInflight = pending;
  pending.finally(() => {
    if (minorTermCodesInflight === pending) minorTermCodesInflight = null;
  });
  return pending;
}

function publishMinorRequirements(defaultTerm, terms, recordsByTerm) {
  const preferred = String(defaultTerm || '').trim();
  minorRequirements = recordsByTerm.get(preferred) || {};
  const availability = {};
  terms.forEach((term) => {
    availability[term] = !!(recordsByTerm.get(term)
      && Object.keys(recordsByTerm.get(term)).length);
  });
  if (typeof window !== 'undefined') {
    window.minorRequirements = minorRequirements;
    window.minorRequirementsStatus = {
      defaultTerm: preferred,
      terms: terms.slice(),
      availableByTerm: availability,
    };
  }
  return minorRequirements;
}

function initializeMinorRequirementsAsync(termCodes, defaultTermCode) {
  const requested = Array.isArray(termCodes) ? termCodes : [];
  const preferred = String(defaultTermCode || '').trim();
  const terms = Array.from(new Set(
    (preferred ? [preferred] : []).concat(requested)
      .map((term) => String(term || '').trim())
      .filter((term) => /^\d{6}$/.test(term))
  ));
  const sequence = ++minorRequirementsInitializationSequence;
  const pending = (async () => {
    const records = await Promise.all(terms.map(loadMinorRequirementsForTermAsync));
    const recordsByTerm = new Map(terms.map((term, index) => [term, records[index] || {}]));
    if (sequence === minorRequirementsInitializationSequence) {
      publishMinorRequirements(preferred, terms, recordsByTerm);
    }
    return minorRequirements;
  })();
  minorRequirementsReadyPromise = pending;
  return pending;
}

function whenMinorRequirementsReady() {
  return minorRequirementsReadyPromise;
}

if (typeof window !== 'undefined') {
  if (minorRequirementsUseFileProtocol()) minorRequirements = loadMinorRequirements() || {};
  window.minorRequirements = minorRequirements;
  window.loadMinorRequirements = loadMinorRequirements;
  window.loadMinorRequirementsForTerm = loadMinorRequirementsForTerm;
  window.loadMinorRequirementsForTermAsync = loadMinorRequirementsForTermAsync;
  window.loadMinorTermCodes = loadMinorTermCodes;
  window.loadMinorTermCodesAsync = loadMinorTermCodesAsync;
  window.initializeMinorRequirementsAsync = initializeMinorRequirementsAsync;
  window.whenMinorRequirementsReady = whenMinorRequirementsReady;
}
