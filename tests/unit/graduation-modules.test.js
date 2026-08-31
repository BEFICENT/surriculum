'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadScriptsGlobals, REPO_ROOT } = require('./helpers/load-script');

const GRADUATION_STACK = [
  'scripts/domain/minor-allocation.js',
  'scripts/ui/graduation-results.js',
  'scripts/ui/graduation-summary-shell.js',
  'scripts/ui/graduation-minor-summary.js',
  'scripts/graduation_check.js',
];

const globals = loadScriptsGlobals(GRADUATION_STACK);

test('graduation modules expose frozen namespaces and preserve legacy globals', () => {
  const allocation = globals.SurriculumModules.minorAllocation;
  assert.equal(Object.isFrozen(allocation), true);
  assert.equal(Object.isFrozen(globals.SurriculumGraduationResults), true);
  assert.equal(Object.isFrozen(globals.SurriculumGraduationSummaryShell), true);
  assert.equal(Object.isFrozen(globals.SurriculumGraduationMinorSummary), true);

  assert.equal(globals.computeMinorAllocation, allocation.computeMinorAllocation);
  assert.equal(globals.courseCountsTowardDegreePlan,
    allocation.courseCountsTowardDegreePlan);
  assert.equal(globals.displayGraduationResults,
    globals.SurriculumGraduationResults.displayGraduationResults);
  assert.equal(typeof globals.displaySummary, 'function');
});

test('minor allocation factory uses its explicit catalog and credit dependencies', () => {
  const requirements = {
    TEST: {
      name: 'Test minor',
      minCourses: '1',
      minSU: '3',
      categories: {
        required: {
          minCourses: '1',
          minSU: '3',
          allListedRequired: true,
        },
      },
    },
  };
  const service = globals.SurriculumModules.minorAllocation.create({
    window: {
      loadMinorRequirementsForTerm(term) {
        assert.equal(term, '202301');
        return requirements;
      },
    },
    parseCreditValue(value) {
      return Number.parseFloat(String(value).replace(',', '.'));
    },
  });
  const curriculum = {
    minorTermsByCode: { TEST: '202301' },
    minorCourseDataByCode: {
      TEST: [{ Major: 'T', Code: '101', EL_Type: 'required', SU_credit: '3' }],
    },
    semesters: [{
      courses: [{ code: 'T101', grade: 'A' }],
    }],
    getCourseProgressState() {
      return 'earned';
    },
    getActualGpa() {
      return { value: 3.4, credits: 3, resolved: true, issues: [] };
    },
    calculateGpaForMembership(isMember) {
      assert.equal(isMember({ code: 'T101' }), true);
      return {
        value: 3.4,
        credits: 3,
        points: 10.2,
        resolved: true,
        issues: [],
      };
    },
  };

  const result = service.computeMinorAllocation(curriculum, 'TEST');
  assert.equal(Object.isFrozen(service), true);
  assert.equal(result.ok, true);
  assert.equal(result.title, 'Test minor');
  assert.equal(result.totals.required.courses, 1);
  assert.equal(result.totals.required.credits, 3);
  assert.equal(result.allocationByCode.T101.allocatedCat, 'required');
});

test('graduation presenters require their declared controller dependencies', () => {
  assert.throws(
    () => globals.SurriculumGraduationResults.create({
      window: {},
      document: {},
      minorAllocation: {},
    }),
    /minorAllocation/,
  );

  const existingModal = {};
  const guarded = globals.SurriculumGraduationSummaryShell.create({
    curriculum: {},
    window: {},
    document: {
      querySelector(selector) {
        assert.equal(selector, '.summary_modal');
        return existingModal;
      },
    },
    HTMLElement: class {},
  });
  assert.equal(guarded, undefined,
    'the shell must retain the one-summary-modal guard');
});

test('minor summary controller returns the deferred overview-card renderer', () => {
  const controller = globals.SurriculumGraduationMinorSummary.create({
    curriculum: { minors: [] },
    window: {},
    document: {},
    summaryShell: { esc: String },
    minorAllocation: globals.SurriculumModules.minorAllocation,
    getProgressMain: () => null,
    formatTermName: String,
  });
  assert.equal(Object.isFrozen(controller), true);
  assert.equal(typeof controller.appendMinorOverviewCards, 'function');
  assert.doesNotThrow(() => controller.appendMinorOverviewCards());
});

test('graduation runtime scripts load in dependency order as deferred classics', () => {
  const index = fs.readFileSync(path.join(REPO_ROOT, 'index.html'), 'utf8');
  const tags = [...index.matchAll(/<script\s+([^>]*?)src="([^"]+)"([^>]*)><\/script>/g)]
    .map((match) => ({
      attrs: `${match[1]} ${match[3]}`,
      src: match[2],
    }));
  const positions = GRADUATION_STACK.map((src) =>
    tags.findIndex((tag) => tag.src === src));
  assert.ok(positions.every((position) => position >= 0),
    'every graduation module must be present in index.html');
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  for (const src of GRADUATION_STACK) {
    const tag = tags.find((candidate) => candidate.src === src);
    assert.match(tag.attrs, /\bdefer\b/);
    assert.doesNotMatch(tag.attrs, /\btype\s*=\s*["']module["']/);
  }
});

test('graduation_check remains a bounded orchestrator with no extracted fallback', () => {
  const source = fs.readFileSync(
    path.join(REPO_ROOT, 'scripts', 'graduation_check.js'),
    'utf8',
  );
  assert.doesNotMatch(source, /function\s+computeMinorAllocation\s*\(/);
  assert.doesNotMatch(source, /function\s+displayGraduationResults\s*\(/);
  assert.doesNotMatch(source, /root\.displayGraduationResults\s*=/);
  assert.match(source, /graduationSummaryShellApi\.create\s*\(/);
  assert.match(source, /graduationMinorSummaryApi\.create\s*\(/);
  assert.ok(source.split(/\r?\n/).length <= 1050);

  assert.throws(
    () => loadScriptsGlobals('scripts/graduation_check.js'),
    /requires SurriculumModules\.minorAllocation/,
  );
});
