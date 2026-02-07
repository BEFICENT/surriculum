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
const mainJsPath = path.join(repoRoot, 'main.js');
const mainJs = fs.readFileSync(mainJsPath, 'utf8');

// Regression: setDoubleMajor() used to do:
//   doubleMajorCourseData = doubleMajorCourseData.concat(dmCustomCourses);
// which breaks the shared reference with curriculum.doubleMajorCourseData and
// causes DM custom courses to disappear from detailed summary course lists.
assert(
  !mainJs.includes('doubleMajorCourseData = doubleMajorCourseData.concat(dmCustomCourses)'),
  'Regression: setDoubleMajor() reassigns doubleMajorCourseData via concat(dmCustomCourses). Use push() to keep references.'
);

// Ensure we keep the safer Array.isArray() guard.
assert(
  mainJs.includes('doubleMajorCourseData = Array.isArray(jsonDM) ? jsonDM : [];'),
  'Expected setDoubleMajor() to assign doubleMajorCourseData using Array.isArray(jsonDM) guard.'
);

// Ensure we actually append DM custom courses without reassignment.
assert(
  mainJs.includes('doubleMajorCourseData.push(dmCustomCourses[i])'),
  'Expected setDoubleMajor() to append dmCustomCourses entries via push().'
);

console.log('OK: static checks passed.');

