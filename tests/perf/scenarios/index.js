'use strict';

const scenarios = [
  require('./startup'),
  require('./planner'),
  require('./picker'),
  require('./scheduler'),
  require('./memory'),
  require('./summary'),
  require('./transcript'),
  require('./persistence'),
  require('./responsive'),
  require('./service-worker'),
];

const ids = scenarios.map((scenario) => scenario.id);
if (new Set(ids).size !== ids.length) {
  throw new Error(`Duplicate performance scenario ids: ${ids.join(', ')}`);
}
for (const scenario of scenarios) {
  if (!scenario.id || !scenario.description || typeof scenario.run !== 'function') {
    throw new TypeError('Every performance scenario must export id, description, and async run(ctx).');
  }
}

module.exports = { scenarios };
