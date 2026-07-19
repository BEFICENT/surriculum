'use strict';

// Phase 1 of the requirement-groups redesign (docs/requirement-groups-design.md):
// the special requirements are authored as scraped DATA on the requirements
// record — `groups` (named subsets of a base type) and `facultyReq` (the
// cross-cutting faculty-course ticker). Phase-1 target is VACD only, and nothing
// in the app reads these fields yet (no behaviour change). These tests pin the
// authored data + the schema so phase 2 (wiring the app to consume it) has a
// fixed target, and so the hand-authored materialization of today's constants
// can't silently drift.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REQ = path.join(__dirname, '..', '..', 'requirements', '202301.jsonl');
const records = fs.readFileSync(REQ, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const byMajor = Object.fromEntries(records.map((r) => [r.major, r]));

test('VACD carries its faculty ticker minimums', () => {
  assert.deepEqual(byMajor.VACD.facultyReq, { total: 5, fass: 3, areas: 3 });
});

test('VACD carries its three groups with the expected shape', () => {
  const groups = byMajor.VACD.groups;
  assert.equal(groups.length, 3);
  assert.deepEqual(groups.map((g) => g.id), ['core_arthistory', 'core_skill', 'lang_cap']);

  const arthistory = groups.find((g) => g.id === 'core_arthistory');
  assert.equal(arthistory.base, 'core');
  assert.equal(arthistory.rule, 'credits');
  assert.equal(arthistory.min, 9);
  assert.equal(arthistory.flag, 30);
  assert.deepEqual(arthistory.members,
    ['HART292', 'HART293', 'HART380', 'HART413', 'HART426', 'VA315', 'VA420', 'VA430']);

  const skill = groups.find((g) => g.id === 'core_skill');
  assert.equal(skill.base, 'core');
  assert.equal(skill.min, 12);
  assert.equal(skill.flag, 31);
  assert.deepEqual(skill.exclusivePairs, [['VA302', 'VA304'], ['VA402', 'VA404']]);

  const lang = groups.find((g) => g.id === 'lang_cap');
  assert.equal(lang.base, 'free');
  assert.equal(lang.rule, 'languageCap');
  assert.equal(lang.max, 2);
  assert.equal(lang.flag, 40);
});

test('every group is well-formed (id/label/base/rule/flag/suis)', () => {
  for (const g of byMajor.VACD.groups) {
    for (const key of ['id', 'label', 'base', 'rule', 'flag', 'suis']) {
      assert.ok(g[key] !== undefined && g[key] !== '', `group ${g.id} missing ${key}`);
    }
    assert.ok(['core', 'area', 'free', 'required', 'university'].includes(g.base),
      `group ${g.id} has a real base type`);
  }
});

test('phase-1 is VACD-only: unmigrated programs carry no groups yet', () => {
  assert.equal(byMajor.CS.groups, undefined);
  assert.equal(byMajor.ECON.groups, undefined);
});
