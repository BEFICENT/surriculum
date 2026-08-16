'use strict';

// tallyFacultyCourses / tallyFacultyAreas are the ONE shared faculty-course tally
// behind the graduation checks (flags 14/15/16/19/20/21/22 and the area-span 18).
// The same loop used to be hand-written 22 times across the major blocks in
// canGraduate()/canGraduateDouble(), and the copies had drifted. These pin the
// unified behaviour directly, including the two drifts the unification reconciles:
//   - none-skip: a course the pass excluded (effField === 'none', e.g. a failed
//     faculty course) counts toward nothing. Only CS/EE did this before.
//   - PSYCH->PSY: ECON's area map alone tested a "PSYCH" code prefix that no SU
//     course carries, so ECON never credited a psychology area; the shared map
//     uses "PSY".

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScriptGlobals } = require('./helpers/load-script');

const { tallyFacultyCourses, tallyFacultyAreas } = loadScriptGlobals('scripts/s_curriculum.js');

const course = (code, pool, effective_type, effective_type_dm) =>
  ({ code, Faculty_Course: pool, effective_type, effective_type_dm });
const sems = (...courses) => [{ courses }];

test('counts faculty courses by pool, with the FENS MATH sub-count', () => {
  const t = tallyFacultyCourses(sems(
    course('MATH301', 'FENS', 'area'),   // FENS + MATH -> math++
    course('CS401', 'FENS', 'core'),     // FENS, not MATH
    course('HIST191', 'FASS', 'free'),
    course('MGMT301', 'SBS', 'core'),
    course('CS201', 'No', 'core'),       // pool 'No' -> ignored
    course('PROJ201', undefined, 'core'),// no pool -> ignored
  ), 'effective_type');
  // Spread into a test-realm object: the tally is built inside the vm sandbox,
  // so a bare deepEqual would trip on the differing Object prototype.
  assert.deepEqual({ ...t }, { total: 4, fens: 2, fass: 1, sbs: 1, math: 1 });
});

test('none-skip: a course excluded by the pass counts toward nothing', () => {
  const t = tallyFacultyCourses(sems(
    course('MATH301', 'FENS', 'none'),   // failed/excluded -> skipped
    course('CS401', 'FENS', 'core'),
  ), 'effective_type');
  assert.deepEqual({ ...t }, { total: 1, fens: 1, fass: 0, sbs: 0, math: 0 });
});

test('honours the requested pass field (main vs double major)', () => {
  // Same course is excluded in the main pass but kept in the DM pass.
  const s = sems(course('MATH301', 'FENS', /*main*/ 'none', /*dm*/ 'area'));
  assert.equal(tallyFacultyCourses(s, 'effective_type').total, 0, 'excluded in main');
  assert.equal(tallyFacultyCourses(s, 'effective_type_dm').total, 1, 'kept in DM');
});

test('defaults to the main pass when no field is given', () => {
  const s = sems(course('CS401', 'FENS', 'core', 'none'));
  assert.equal(tallyFacultyCourses(s).total, 1, 'reads effective_type by default');
});

test('areas: PSY-coded faculty course credits the psychology area (PSYCH->PSY fix)', () => {
  // Before unification ECON tested a dead "PSYCH" prefix and missed this.
  const areas = tallyFacultyAreas(sems(
    course('PSY301', 'FASS', 'area'),
    course('CULT201', 'FASS', 'area'),
    course('ECON301', 'FASS', 'core'),
  ), 'effective_type');
  assert.deepEqual([...areas].sort(), ['CULT', 'ECON', 'PSYCH']);
});

test('areas: none-skip and pool marker apply the same as the count', () => {
  const areas = tallyFacultyAreas(sems(
    course('PSY301', 'FASS', 'none'),    // excluded -> not an area
    course('VA201', 'No', 'area'),       // not a faculty course -> ignored
    course('HART201', 'FASS', 'area'),
  ), 'effective_type');
  assert.deepEqual([...areas], ['HART']);
});
