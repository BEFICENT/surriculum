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
  // The faculty marker positions the ticker in the order; the real groups follow.
  assert.equal(groups[0].rule, 'faculty', 'faculty marker leads the ordered list');
  const named = groups.filter((g) => g.rule !== 'faculty');
  assert.deepEqual(named.map((g) => g.id), ['core_arthistory', 'core_skill', 'lang_cap']);

  // The pool members / min are SCRAPED per acceptance term off SUIS (phase 5), so
  // these pin the frozen 202301 catalog specifically — which differs from the
  // current (2024+) one: 202301's Core II required 18 SU, and both pools listed
  // more courses before the ~2024 curriculum trim. The app-semantic fields
  // (base/rule/flag/overflowTo/pairs) come from the hand-authored skeleton.
  const arthistory = groups.find((g) => g.id === 'core_arthistory');
  assert.equal(arthistory.base, 'core');
  assert.equal(arthistory.rule, 'credits');
  assert.equal(arthistory.min, 9);
  assert.equal(arthistory.flag, 30);
  assert.equal(arthistory.overflowTo, 'area');
  assert.deepEqual(arthistory.members,
    ['HART292', 'HART293', 'HART380', 'HART392', 'HART411', 'HART413', 'HART414',
      'HART426', 'HART450', 'HART480', 'PHIL322', 'VA315', 'VA420', 'VA430', 'VIS412']);

  const skill = groups.find((g) => g.id === 'core_skill');
  assert.equal(skill.base, 'core');
  assert.equal(skill.min, 18); // 202301 catalog; the current catalog is 12
  assert.equal(skill.flag, 31);
  assert.deepEqual(skill.exclusivePairs, [['VA302', 'VA304'], ['VA402', 'VA404']]);

  const lang = groups.find((g) => g.id === 'lang_cap');
  assert.equal(lang.base, 'free');
  assert.equal(lang.rule, 'languageCap');
  assert.equal(lang.max, 2);
  assert.equal(lang.flag, 40);
});

test('every non-marker group is well-formed (id/label/base/rule/flag/suis)', () => {
  for (const m of Object.keys(byMajor)) {
    for (const g of byMajor[m].groups || []) {
      if (g.rule === 'faculty') continue; // the marker carries no fields of its own
      for (const key of ['id', 'label', 'base', 'rule', 'flag', 'suis']) {
        assert.ok(g[key] !== undefined && g[key] !== '', `${m}/${g.id} missing ${key}`);
      }
      assert.ok(['core', 'area', 'free', 'required', 'university'].includes(g.base),
        `${m}/${g.id} has a real base type`);
    }
  }
});

test('every program is migrated: has facultyReq; the group programs have groups', () => {
  const ALL = ['CS', 'IE', 'EE', 'MAT', 'BIO', 'ME', 'ECON', 'MAN', 'PSIR', 'PSY', 'VACD', 'DSA'];
  for (const m of ALL) assert.ok(byMajor[m].facultyReq, `${m} has a facultyReq ticker`);
  // Faculty-ticker-only programs carry no groups; the rest do.
  for (const m of ['CS', 'IE', 'MAT', 'BIO']) assert.equal(byMajor[m].groups, undefined, `${m} is ticker-only`);
  for (const m of ['EE', 'ME', 'ECON', 'MAN', 'PSIR', 'PSY', 'VACD', 'DSA']) {
    assert.ok(Array.isArray(byMajor[m].groups) && byMajor[m].groups.length, `${m} has groups`);
  }
});

test('PSIR core pools require base-effective credit (same wording as VACD)', () => {
  // The bug the SUIS wording fixes: PSIR's pools overflow extras to Area exactly
  // like VACD's, so they measure base-effective credit — requireBase true.
  for (const g of byMajor.PSIR.groups.filter((x) => x.rule === 'credits')) {
    assert.equal(g.requireBase, true, `PSIR ${g.id} requireBase`);
    assert.equal(g.overflowTo, 'area', `PSIR ${g.id} overflowTo area`);
  }
});
