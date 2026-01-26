// requirements.js
// Degree requirements are stored as JSONL files under `requirements/<TERM>.jsonl`.
// This module loads the file matching the user's selected entry term. If no
// term-specific file is found, it falls back to `requirements/default.jsonl`.
// (For backward compatibility, it also supports legacy `.json` files.)

let requirements = {};

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
  if (Array.isArray(data)) {
    const out = {};
    for (const rec of data) {
      if (!rec || typeof rec !== 'object') continue;
      const maj = rec.major;
      if (!maj) continue;
      const copy = { ...rec };
      delete copy.major;
      out[String(maj)] = copy;
    }
    return out;
  }
  if (typeof data === 'object') return data;
  return null;
}

function loadRequirements(termCode) {
  const paths = [`./requirements/${termCode}.jsonl`, `./requirements/${termCode}.json`];
  const defPaths = ['./requirements/default.jsonl', './requirements/default.json'];
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
  if (!data) {
    for (const p of defPaths) {
      data = tryLoad(p);
      if (data) break;
    }
  }
  if (data) {
    for (const maj of Object.keys(data)) {
      if (data[maj].science === undefined) data[maj].science = 0;
      if (data[maj].engineering === undefined) data[maj].engineering = 0;
    }
  }
  return data;
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

const loadedMain = loadRequirements(termCode || 'default') || {};
let loadedDM = null;
if (termCodeDM && termCodeDM !== termCode) {
  loadedDM = loadRequirements(termCodeDM);
}

requirements = loadedDM
  ? { [termCode || 'default']: loadedMain, [termCodeDM]: loadedDM }
  : loadedMain;

// Expose the requirements object on the window in browser environments. This
// allows other scripts to access `requirements` when modules are not
// available (e.g., when loading files directly via the file:// scheme).
if (typeof window !== 'undefined') {
  window.requirements = requirements;
  window.loadRequirements = loadRequirements;
}
