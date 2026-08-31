// Minimal static checks to catch regressions in critical custom-course logic.
// Run: `node tests/static_checks.js`

const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    const err = new Error(message);
    err.name = 'AssertionError';
    throw err;
  }
}

const repoRoot = path.resolve(__dirname, '..');
const programContextPath = path.join(repoRoot, 'scripts', 'app', 'program_context.js');
const programContextJs = fs.readFileSync(programContextPath, 'utf8');

// Regression: setDoubleMajor() used to do:
//   doubleMajorCourseData = doubleMajorCourseData.concat(dmCustomCourses);
// which breaks the shared reference with curriculum.doubleMajorCourseData and
// causes DM custom courses to disappear from detailed summary course lists.
assert(
  !programContextJs.includes('setDoubleMajorCourseData(getDoubleMajorCourseData().concat(dmCustomCourses))'),
  'Regression: setDoubleMajor() replaces the shared double-major array via concat(). Use push() to keep references.'
);

// Ensure we keep the safer Array.isArray() guard.
assert(
  programContextJs.includes('setDoubleMajorCourseData(Array.isArray(jsonDM) ? jsonDM : []);'),
  'Expected setDoubleMajor() to assign doubleMajorCourseData using Array.isArray(jsonDM) guard.'
);

// Ensure we actually append DM custom courses without reassignment.
assert(
  programContextJs.includes('getDoubleMajorCourseData().push(dmCustomCourses[i])'),
  'Expected setDoubleMajor() to append dmCustomCourses entries via push().'
);

console.log('OK: static checks passed.');

