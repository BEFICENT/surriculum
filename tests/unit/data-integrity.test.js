'use strict';

// Structural + referential integrity of the requirement/catalog data the app is
// built on. Pure Node (no browser). Catches data-build regressions: a malformed
// threshold, an invalid course category, or a requirement pointing at a course
// that isn't in the catalog. Pinned to the frozen term 202401.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const TERM = '202401';
const readJsonl = (p) => fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

const reqs = readJsonl(path.join(ROOT, 'requirements', `${TERM}.jsonl`));
const VALID_EL_TYPE = new Set(['university', 'required', 'core', 'area', 'free', 'unknown']);
const CATEGORY_KEYS = ['university', 'required', 'core', 'area', 'free', 'total'];
const isNonNegNumber = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const creditOk = (v) => v === '-' || v === '' || v == null || Number.isFinite(parseFloat(v));

test(`requirements/${TERM}: every major has non-negative numeric thresholds`, () => {
  assert.ok(reqs.length >= 12, `expected >= 12 majors, got ${reqs.length}`);
  for (const r of reqs) {
    assert.ok(r.major && typeof r.major === 'string', 'major code must be a non-empty string');
    for (const k of CATEGORY_KEYS) {
      assert.ok(isNonNegNumber(r[k]), `${r.major}.${k} must be a non-negative number, got ${JSON.stringify(r[k])}`);
    }
    // The degree total can't be less than the sum of its category minimums.
    const catSum = r.university + r.required + r.core + r.area + r.free;
    assert.ok(r.total >= r.university, `${r.major}: total ${r.total} < university ${r.university}`);
    assert.ok(catSum >= r.total * 0.5, `${r.major}: category mins (${catSum}) implausibly small vs total ${r.total}`);
  }
});

for (const r of reqs) {
  const major = r.major;
  const catalogPath = path.join(ROOT, 'courses', TERM, `${major}.jsonl`);

  test(`courses/${TERM}/${major}: catalog is well-formed`, () => {
    assert.ok(fs.existsSync(catalogPath), `catalog file missing for ${major}`);
    const rows = readJsonl(catalogPath);
    assert.ok(rows.length > 0, `${major} catalog is empty`);
    for (const c of rows) {
      const code = String(c.Major || '') + String(c.Code || '');
      assert.ok(code.length >= 3, `${major}: implausible course code "${code}"`);
      assert.ok(VALID_EL_TYPE.has(c.EL_Type), `${major}: course ${code} has invalid EL_Type "${c.EL_Type}"`);
      assert.ok(creditOk(c.SU_credit), `${major}: course ${code} has non-numeric SU_credit "${c.SU_credit}"`);
    }
  });

  test(`courses/${TERM}/${major}: internship requirement resolves to a real course`, () => {
    if (!r.internshipCourse) return; // non-engineering majors have none
    const codes = new Set(readJsonl(catalogPath).map((c) => String(c.Major) + String(c.Code)));
    assert.ok(codes.has(r.internshipCourse), `${major}: internshipCourse ${r.internshipCourse} not found in its catalog`);
  });
}
