// catalog.js
// Course-catalog lookups: does a course exist, and fetch its record. Both take
// the catalog array explicitly (course_data) and fall back to the active
// double-major / minor catalogs via the global `curriculum` object — read
// lazily at call time so this stays a pure function of its inputs plus whatever
// program context is live.
//
// Shipped as an ES module with a window bridge (see cases/flagMessages.js and
// scripts/domain/credits.js): classic scripts call window.getInfo /
// window.isCourseValid; new module code can `import` them.

function normalizeCatalogCode(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

function recordCode(record) {
  if (!record || typeof record !== 'object') return '';
  return normalizeCatalogCode(String(record.Major || '') + String(record.Code || ''));
}

// Search a list without allowing an internal global definition to shadow a
// real program or user-custom record later in that list.
function findCatalogRecord(list, code, fallback) {
  if (!Array.isArray(list)) return { record: null, fallback };
  let nextFallback = fallback;
  for (let i = 0; i < list.length; i++) {
    const record = list[i];
    if (recordCode(record) !== code) continue;
    if (record.__globalCourseDefinition) {
      if (!nextFallback) nextFallback = record;
      continue;
    }
    return { record, fallback: nextFallback };
  }
  return { record: null, fallback: nextFallback };
}

// returns info's of the course:
export function getInfo(course, course_data) {
  const code = normalizeCatalogCode(course);
  if (!code) return 0;
  let fallback = null;

  // First search within the primary course data. User custom courses are
  // appended here and are real definitions for lookup precedence purposes.
  let result = findCatalogRecord(course_data, code, fallback);
  if (result.record) return result.record;
  fallback = result.fallback;

  // If not found and a double major is active, search within the double
  // major's catalog so that course details (name, credits) can be
  // retrieved for DM-only courses.  This allows unknown courses to
  // provide their metadata while still being ignored for the main
  // major's allocations.
  try {
    const cur = (typeof window !== 'undefined') ? window.curriculum : null;
    if (cur && cur.doubleMajor && Array.isArray(cur.doubleMajorCourseData)) {
      result = findCatalogRecord(cur.doubleMajorCourseData, code, fallback);
      if (result.record) return result.record;
      fallback = result.fallback;
    }
  } catch (_) {
    // ignore errors
  }
  // If not found and minors are selected, search within each selected
  // minor's catalog so we can retrieve metadata (name/credits) for
  // minor-only courses.
  try {
    const cur = (typeof window !== 'undefined') ? window.curriculum : null;
    if (cur && Array.isArray(cur.minors) && cur.minors.length && cur.minorCourseDataByCode) {
      for (let mi = 0; mi < cur.minors.length; mi++) {
        const minorCode = cur.minors[mi];
        const list = cur.minorCourseDataByCode[minorCode];
        result = findCatalogRecord(list, code, fallback);
        if (result.record) return result.record;
        fallback = result.fallback;
      }
    }
  } catch (_) {}
  return fallback || 0;
}

// checks whether the course exists:
export function isCourseValid(course, course_data) {
  const code = normalizeCatalogCode(course && typeof course === 'object' ? course.code : course);
  const record = code ? getInfo(code, course_data) : null;
  // Global definitions exist only to render/reload/import an occurrence that
  // already came from an external record. Hiding them from datalists is not
  // sufficient: typed course codes also pass through this validator.
  return Boolean(record && !record.__globalCourseDefinition);
}

// Bridge for classic scripts that still consume these as globals.
if (typeof window !== 'undefined') {
  window.isCourseValid = isCourseValid;
  window.getInfo = getInfo;
}
