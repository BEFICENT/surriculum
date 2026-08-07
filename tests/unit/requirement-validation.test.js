'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadScriptGlobals, REPO_ROOT } = require('./helpers/load-script');

const { isValidRequirementRecord } = loadScriptGlobals('scripts/requirements.js');

const records = fs.readFileSync(path.join(REPO_ROOT, 'requirements', '202401.jsonl'), 'utf8')
  .trim().split(/\r?\n/).map((line) => JSON.parse(line));
const byMajor = Object.fromEntries(records.map((record) => [record.major, record]));

test('requirement validation accepts category minimums below independent Total', () => {
  assert.equal(isValidRequirementRecord(byMajor.EE, 'EE'), true, 'EE 123 category SU / 125 total');
  assert.equal(isValidRequirementRecord(byMajor.ME, 'ME'), true, 'ME 123 category SU / 125 total');
});

test('requirement validation rejects category minimums above Total', () => {
  for (const major of ['EE', 'ME']) {
    const contradictory = { ...byMajor[major], free: byMajor[major].free + 3 };
    assert.equal(isValidRequirementRecord(contradictory, major), false, `${major}: 126 category SU / 125 total`);
  }
});
