'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT } = require('./helpers/load-script');

let buildFlagMessages;

test.before(async () => {
  const source = fs.readFileSync(
    path.join(REPO_ROOT, 'scripts/ui/graduation-flag-messages.js'),
    'utf8',
  );
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  ({ buildFlagMessages } = await import(moduleUrl));
});

test.afterEach(() => {
  delete globalThis.requirements;
  delete globalThis.curriculum;
  delete globalThis.getRequirementRecord;
});

function humMessage(requirement) {
  globalThis.requirements = { TEST: requirement };
  globalThis.curriculum = { major: 'TEST', entryTerm: '202501' };
  return buildFlagMessages('TEST')[12]();
}

test('flag 12 explains a one-course any-level HUM requirement', () => {
  assert.equal(
    humMessage({ humRequired: 1, humRule: 'any' }),
    'You have not taken a HUM course!',
  );
});

test('flag 12 explains a two-distinct-course any-level HUM requirement', () => {
  assert.equal(
    humMessage({ humRequired: 2, humRule: 'any' }),
    'You need at least 2 distinct HUM courses!',
  );
});

test('flag 12 retains the level-specific wording for the split-level rule', () => {
  assert.equal(
    humMessage({ humRequired: 2, humRule: 'one200One300' }),
    'You have not taken a HUM2XX class!',
  );
});
