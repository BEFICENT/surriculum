// Program-manifest and catalog loading for the application boot path.
// HTTP(S) stays fully asynchronous; synchronous XHR exists only as a
// compatibility fallback for browsers that still permit local file:// use.
(function installProgramData(root) {
  'use strict';

  const DEFAULT_MAJORS = Object.freeze([
    'BIO', 'CS', 'EE', 'IE', 'MAT', 'ME', 'ECON', 'DSA', 'MAN', 'PSIR', 'PSY', 'VACD',
  ]);
  let termManifestPromise = null;

  function parseJsonOrJsonl(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed);
    } catch (_) {
      try {
        return trimmed.split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => JSON.parse(line));
      } catch (_) {
        return null;
      }
    }
  }

  function normalizeTermManifest(parsed) {
    if (!parsed) return {};
    if (!Array.isArray(parsed)) {
      if (typeof parsed === 'object' && parsed.term && Array.isArray(parsed.majors)) {
        return { [String(parsed.term)]: parsed.majors.slice() };
      }
      return typeof parsed === 'object' ? parsed : {};
    }
    const manifest = {};
    parsed.forEach((record) => {
      if (!record || typeof record !== 'object' || !record.term || !Array.isArray(record.majors)) return;
      manifest[String(record.term)] = record.majors.slice();
    });
    return manifest;
  }

  function normalizeCatalog(parsed) {
    if (Array.isArray(parsed)) return parsed;
    return parsed && typeof parsed === 'object' ? [parsed] : [];
  }

  function usesFileProtocol() {
    try {
      return !!(root.location && root.location.protocol === 'file:');
    } catch (_) {
      return false;
    }
  }

  function readTextWithSynchronousXhr(path) {
    if (!usesFileProtocol() || typeof root.XMLHttpRequest !== 'function') return null;
    try {
      const xhr = new root.XMLHttpRequest();
      xhr.open('GET', path, false);
      xhr.overrideMimeType('application/json');
      xhr.send(null);
      return xhr.status === 200 || xhr.status === 0 ? String(xhr.responseText || '') : null;
    } catch (_) {
      return null;
    }
  }

  async function fetchText(path) {
    if (typeof root.fetch !== 'function') return null;
    try {
      const response = await root.fetch(path);
      if (!response || !response.ok) return null;
      return await response.text();
    } catch (_) {
      return null;
    }
  }

  async function readFirstParsed(paths, normalize) {
    const candidates = Array.isArray(paths) ? paths : [];
    const parser = typeof normalize === 'function' ? normalize : (value) => value;

    // Fetching file:// URLs is commonly blocked. Preserve the historical local
    // fallback without ever bringing a synchronous request onto HTTP(S).
    if (usesFileProtocol()) {
      for (const path of candidates) {
        const text = readTextWithSynchronousXhr(path);
        if (text === null) continue;
        const parsed = parseJsonOrJsonl(text);
        if (parsed !== null) return parser(parsed);
      }
    }

    for (const path of candidates) {
      const text = await fetchText(path);
      if (text === null) continue;
      const parsed = parseJsonOrJsonl(text);
      if (parsed !== null) return parser(parsed);
    }
    return null;
  }

  function loadTermManifest() {
    if (termManifestPromise) return termManifestPromise;
    termManifestPromise = readFirstParsed(
      ['./courses/terms.jsonl', './courses/terms.json'],
      normalizeTermManifest,
    ).then((manifest) => manifest && typeof manifest === 'object' ? manifest : {})
      .catch(() => ({}));
    return termManifestPromise;
  }

  function programCatalogPaths(major, termCode) {
    const program = String(major || '').trim().toUpperCase();
    const term = String(termCode || '').trim();
    if (!program) return [];
    const primaryBase = term ? `courses/${term}/${program}` : `courses/${program}`;
    const fallbackBase = `courses/${program}`;
    const rootBase = program;
    return Array.from(new Set([
      `${primaryBase}.jsonl`, `${primaryBase}.json`,
      `${fallbackBase}.jsonl`, `${fallbackBase}.json`,
      `${rootBase}.jsonl`, `${rootBase}.json`,
    ]));
  }

  async function loadProgramCatalog(major, termCode) {
    const result = await readFirstParsed(
      programCatalogPaths(major, termCode),
      normalizeCatalog,
    );
    return Array.isArray(result) ? result : [];
  }

  function minorCatalogPaths(minorProgram, termCode) {
    const program = String(minorProgram || '').trim().toUpperCase();
    const term = String(termCode || '').trim();
    if (!program) return [];
    return Array.from(new Set([
      ...(term
        ? [`courses/minors/${term}/${program}.jsonl`, `courses/minors/${term}/${program}.json`]
        : []),
      `courses/minors/${program}.jsonl`,
      `courses/minors/${program}.json`,
      `${program}.jsonl`,
      `${program}.json`,
    ]));
  }

  async function loadMinorCatalog(minorProgram, termCode) {
    const result = await readFirstParsed(
      minorCatalogPaths(minorProgram, termCode),
      normalizeCatalog,
    );
    return Array.isArray(result) ? result : [];
  }

  root.surriculumProgramData = Object.freeze({
    DEFAULT_MAJORS,
    parseJsonOrJsonl,
    normalizeTermManifest,
    usesFileProtocol,
    loadTermManifest,
    loadProgramCatalog,
    loadMinorCatalog,
  });
})(typeof window !== 'undefined' ? window : globalThis);
