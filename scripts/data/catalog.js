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

// checks whether the course exists:
export function isCourseValid(course, course_data) {
  const code = course && course.code ? course.code.replace(/\s+/g, '') : '';
  // First check within the main major's course data
  for (let i = 0; i < course_data.length; i++) {
    if (((course_data[i]['Major'] + course_data[i]['Code']) === code)) return true;
  }
  // If not found and a double major is active, check the double major's
  // course catalog for this course code. The global curriculum object
  // exposes doubleMajorCourseData when a second major is selected.
  try {
    const cur = (typeof window !== 'undefined') ? window.curriculum : null;
    if (cur && cur.doubleMajor && Array.isArray(cur.doubleMajorCourseData)) {
      const dmList = cur.doubleMajorCourseData;
      for (let i = 0; i < dmList.length; i++) {
        if (((dmList[i]['Major'] + dmList[i]['Code']) === code)) {
          return true;
        }
      }
    }
  } catch (_) {
    // ignore errors
  }
  // If not found and minors are selected, check each selected minor's
  // catalog. Minor courses are valid for planning even if they are not
  // part of the primary major's scraped pools.
  try {
    const cur = (typeof window !== 'undefined') ? window.curriculum : null;
    if (cur && Array.isArray(cur.minors) && cur.minors.length && cur.minorCourseDataByCode) {
      for (let mi = 0; mi < cur.minors.length; mi++) {
        const minorCode = cur.minors[mi];
        const list = cur.minorCourseDataByCode[minorCode];
        if (!Array.isArray(list)) continue;
        for (let i = 0; i < list.length; i++) {
          if (((list[i]['Major'] + list[i]['Code']) === code)) return true;
        }
      }
    }
  } catch (_) {}
  return false;
}

// returns info's of the course:
export function getInfo(course, course_data) {
  const code = (course || '').replace(/\s+/g, '');
  // First search within the primary course data
  for (let i = 0; i < course_data.length; i++) {
    if ((course_data[i]['Major'] + course_data[i]['Code']) === code) return course_data[i];
  }
  // If not found and a double major is active, search within the double
  // major's catalog so that course details (name, credits) can be
  // retrieved for DM-only courses.  This allows unknown courses to
  // provide their metadata while still being ignored for the main
  // major's allocations.
  try {
    const cur = (typeof window !== 'undefined') ? window.curriculum : null;
    if (cur && cur.doubleMajor && Array.isArray(cur.doubleMajorCourseData)) {
      const dmList = cur.doubleMajorCourseData;
      for (let i = 0; i < dmList.length; i++) {
        if (((dmList[i]['Major'] + dmList[i]['Code']) === code)) {
          return dmList[i];
        }
      }
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
        if (!Array.isArray(list)) continue;
        for (let i = 0; i < list.length; i++) {
          if (((list[i]['Major'] + list[i]['Code']) === code)) {
            return list[i];
          }
        }
      }
    }
  } catch (_) {}
  return 0;
}

// Bridge for classic scripts that still consume these as globals.
if (typeof window !== 'undefined') {
  window.isCourseValid = isCourseValid;
  window.getInfo = getInfo;
}
