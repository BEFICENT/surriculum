// minor_requirements.js
// Minor requirements are stored as JSONL under `requirements/minors.jsonl`.
// This file is not term-specific for now; each record includes the term shown
// on the degree detail page used during scraping.

function parseJsonlLines(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return [];
  return trimmed.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => JSON.parse(l));
}

function loadMinorRequirements() {
  const paths = ['./requirements/minors.jsonl', './requirements/minors.json'];
  const tryLoad = (p) => {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', p, false);
      xhr.overrideMimeType('application/json');
      xhr.send(null);
      if (xhr.status === 200 || xhr.status === 0) {
        try {
          const parsed = JSON.parse(xhr.responseText);
          if (Array.isArray(parsed)) return parsed;
          if (parsed && typeof parsed === 'object') return Object.values(parsed);
        } catch (_) {
          return parseJsonlLines(xhr.responseText);
        }
      }
    } catch (_) {}
    return null;
  };

  let data = null;
  for (const p of paths) {
    data = tryLoad(p);
    if (data) break;
  }
  const byCode = {};
  if (Array.isArray(data)) {
    for (const rec of data) {
      if (!rec || typeof rec !== 'object') continue;
      const code = rec.minor;
      if (!code) continue;
      byCode[String(code)] = rec;
    }
  }
  return byCode;
}

const minorRequirements = loadMinorRequirements() || {};
if (typeof window !== 'undefined') {
  window.minorRequirements = minorRequirements;
  window.loadMinorRequirements = loadMinorRequirements;
}

