'use strict';

const { loadScriptsGlobals } = require('./load-script');

// Classic-script compatibility stack for the curriculum unit tests. Keep the
// policy modules ahead of the stateful constructor: their window bridges are
// the temporary production interface while the app migrates away from globals.
const CURRICULUM_SCRIPT_PATHS = Object.freeze([
  'scripts/domain/academic-terms.js',
  'scripts/domain/curriculum-allocation.js',
  'scripts/domain/curriculum-recalculation.js',
  'scripts/domain/curriculum-progress.js',
  'scripts/domain/requirement-engine.js',
  'scripts/domain/suggestion-candidate-impact.js',
  'scripts/domain/suggestion-progress-snapshot.js',
  'scripts/ui/curriculum-view.js',
  'scripts/s_curriculum.js',
]);

function loadCurriculumGlobals() {
  return loadScriptsGlobals(CURRICULUM_SCRIPT_PATHS);
}

module.exports = { CURRICULUM_SCRIPT_PATHS, loadCurriculumGlobals };
