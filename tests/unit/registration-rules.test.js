'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScriptsGlobals } = require('./helpers/load-script');

const globals = loadScriptsGlobals([
  'scripts/registration_rules.js',
  'scripts/requisites/expression-policy.js',
  'scripts/course_requisites.js',
]);
const rules = globals.registrationRules;
const requisites = globals.courseRequisites;

const profile = (
  program,
  admitTermCode = '202501',
  role = 'main',
  universityAdmitTermCode = admitTermCode,
) => ({
  program,
  role,
  admitTermCode,
  universityAdmitTermCode,
});

const context = ({
  priorSu = 80,
  courses = [],
  profiles = [profile('CS')],
  known = true,
  targetTerm = 202602,
} = {}) => ({
  known,
  targetTerm: known ? targetTerm : 0,
  priorEligibleSu: priorSu,
  earlierCodes: new Set(courses),
  throughCodes: new Set(courses),
  occurrences: courses.map((code) => ({
    code,
    term: 202601,
    eligible: true,
    course: { code, grade: 'A' },
  })),
  programProfiles: profiles,
});

const evaluateEns491 = (options) => rules.evaluateRule('ENS491', context(options));

test('the supplemental registry is explicit, immutable, and leaves ordinary courses unregistered', () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(rules.rules.map((rule) => rule.courseCode))),
    ['ENS491'],
  );
  assert.equal(rules.getRule('CS201'), null);
  assert.equal(rules.describeRule('CS201'), null);
  assert.equal(rules.evaluateRule('CS201', context()), null);
  assert.equal(Object.isFrozen(rules.rules), true);
  assert.equal(Object.isFrozen(rules.getRule('ENS491')), true);

  const ordinary = requisites.evaluateCandidateForTerm(
    { prerequisites: 'MATH 101 - Undergraduate - Min Grade D' },
    'MATH102',
    context({ courses: ['MATH101'], profiles: [] }),
  );
  assert.equal(ordinary.status, 'met');
  assert.equal(ordinary.hasRequirements, true);
  assert.equal(Object.prototype.hasOwnProperty.call(ordinary, 'supplemental'), false);
});

test('ENS491 reviewed metadata identifies its authoritative source and scheduler-only component', () => {
  const rule = rules.getRule('ENS491');
  assert.equal(rules.validateRule(rule).valid, true);
  assert.equal(rule.source.authority, 'Sabanci University Information System (SUIS)');
  assert.match(rule.source.url, /^https:\/\/suis\.sabanciuniv\.edu\//);
  assert.equal(rule.source.sourceLocation, 'description');
  assert.equal(rule.source.reviewedAt, '2026-08-17');
  assert.equal(rule.source.supersedesDescription, true);
  assert.match(rule.source.fingerprint, /^[a-f0-9]{64}$/);
  assert.match(rule.source.reviewedRequirementsText, /at least 80 prior SU/i);
  assert.match(rule.source.reviewedRequirementsText, /CS300, CS306, or CS308/i);

  const component = rules.getComponentMetadata('ENS491R');
  assert.ok(component);
  assert.equal(component.parentCourseCode, 'ENS491');
  assert.equal(component.relationship, 'same-term-corequisite');
  assert.equal(component.schedulerOnly, true);
  assert.equal(component.plannerCourse, false);
  assert.equal(rules.getRule('ENS491R'), null);
});

test('rule validation rejects malformed conditions and requirement nodes', () => {
  const malformed = JSON.parse(JSON.stringify(rules.getRule('ENS491')));
  malformed.programRequirements[0].when.roles = ['not-a-role'];
  malformed.programRequirements[1].requirement = { type: 'all', items: [] };
  malformed.source.fingerprint = 'not-a-hash';
  const result = rules.validateRule(malformed);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => /roles contains/.test(error)));
  assert.ok(result.errors.some((error) => /at least two requirements/.test(error)));
  assert.ok(result.errors.some((error) => /SHA-256/.test(error)));
});

test('the general schema supports program-only and component-only add-ons without a prior-SU clause', () => {
  const source = {
    authority: 'Authoritative test source',
    url: 'https://example.edu/course',
    reviewedAt: '2026-08-17',
    fingerprint: 'a'.repeat(64),
  };
  const base = {
    schemaVersion: 1,
    ruleId: 'general-schema-contract',
    courseCode: 'ABC123',
    source,
  };

  const programOnly = {
    ...base,
    programRequirements: [{
      when: { program: 'CS', roles: ['main'] },
      requirement: { type: 'course', courseCode: 'CS300' },
      guidance: 'Complete CS300.',
    }],
  };
  assert.deepEqual(
    JSON.parse(JSON.stringify(rules.validateRule(programOnly))),
    { valid: true, errors: [] },
  );

  const componentOnly = {
    ...base,
    ruleId: 'component-only-contract',
    components: [{
      courseCode: 'ABC123R',
      relationship: 'same-term-corequisite',
      schedulerOnly: true,
      plannerCourse: false,
    }],
  };
  assert.deepEqual(
    JSON.parse(JSON.stringify(rules.validateRule(componentOnly))),
    { valid: true, errors: [] },
  );

  const empty = rules.validateRule(base);
  assert.equal(empty.valid, false);
  assert.ok(empty.errors.some((error) => /must define/.test(error)));
});

test('ENS491 enforces 80 strictly-prior SU at the exact decimal boundary', () => {
  const under = evaluateEns491({ priorSu: 79.99, courses: ['CS300'] });
  assert.equal(under.status, 'unmet');
  assert.equal(under.filterBlocking, true);
  assert.equal(under.priorSuRequirement.minimum, 80);
  assert.equal(under.priorSuRequirement.actual, 79.99);
  assert.ok(Math.abs(under.priorSuRequirement.missing - 0.01) < 1e-9);

  const exact = evaluateEns491({ priorSu: 80, courses: ['CS300'] });
  assert.equal(exact.status, 'met');
  assert.equal(exact.priorSuRequirement, null);
  assert.equal(exact.filterBlocking, false);
});

test('each published non-EE program branch accepts every listed alternative', () => {
  const branches = {
    BIO: ['BIO301', 'BIO303'],
    CS: ['CS300', 'CS306', 'CS308'],
    IE: ['IE305', 'IE312'],
    MAT: ['MAT312', 'MAT314'],
    ME: ['ME301', 'ME303'],
  };

  Object.entries(branches).forEach(([program, alternatives]) => {
    const missing = evaluateEns491({ profiles: [profile(program)], courses: [] });
    assert.equal(missing.status, 'unmet', `${program} without its branch prerequisite`);
    assert.equal(missing.filterBlocking, true, program);
    alternatives.forEach((courseCode) => {
      const met = evaluateEns491({ profiles: [profile(program)], courses: [courseCode] });
      assert.equal(met.status, 'met', `${program} via ${courseCode}`);
      assert.equal(met.filterBlocking, false, `${program} via ${courseCode}`);
    });
  });
});

test('EE uses the canonical 202601 admit boundary: earlier admits use OR, later admits use AND', () => {
  for (const courseCode of ['EE202', 'ENS211']) {
    assert.equal(evaluateEns491({
      profiles: [profile('EE', '202503')],
      courses: [courseCode],
    }).status, 'met', `pre-202601 EE via ${courseCode}`);
  }

  for (const courses of [[], ['EE202'], ['ENS211']]) {
    const result = evaluateEns491({
      profiles: [profile('EE', '202601')],
      courses,
    });
    assert.equal(result.status, 'unmet', `202601 EE with ${courses.join(',') || 'neither'}`);
    assert.equal(result.filterBlocking, true);
  }
  assert.equal(evaluateEns491({
    profiles: [profile('EE', '202601')],
    courses: ['EE202', 'ENS211'],
  }).status, 'met');
});

test('an EE double major uses the initial university admit term, not its later catalog term', () => {
  const earlierUniversityAdmit = evaluateEns491({
    profiles: [profile('EE', '202601', 'dm', '202401')],
    courses: ['EE202'],
  });
  assert.equal(earlierUniversityAdmit.status, 'met');
  assert.equal(earlierUniversityAdmit.profiles[0].admitTermCode, '202601');
  assert.equal(earlierUniversityAdmit.profiles[0].universityAdmitTermCode, '202401');

  const laterUniversityAdmit = evaluateEns491({
    profiles: [profile('EE', '202601', 'dm', '202601')],
    courses: ['EE202'],
  });
  assert.equal(laterUniversityAdmit.status, 'unmet');
  assert.equal(laterUniversityAdmit.filterBlocking, true);
  assert.deepEqual([...laterUniversityAdmit.prerequisite.required], ['ENS211']);
});

test('DSA uses the universal 80-SU clause without inventing a program prerequisite', () => {
  const under = evaluateEns491({ priorSu: 79.99, profiles: [profile('DSA')], courses: [] });
  assert.equal(under.status, 'unmet');
  assert.equal(under.filterBlocking, true);

  const exact = evaluateEns491({ priorSu: 80, profiles: [profile('DSA')], courses: [] });
  assert.equal(exact.status, 'met');
  assert.equal(exact.filterBlocking, false);
  assert.equal(exact.prerequisite, null);
});

test('unknown chronology, missing admit terms, and malformed profiles fail open for review', () => {
  const unknownTermContext = context({
    known: false,
    priorSu: 0,
    courses: [],
    profiles: [profile('CS')],
  });
  const unknownTerm = requisites.evaluateCandidateForTerm({}, 'ENS491', unknownTermContext);
  assert.equal(unknownTerm.status, 'review');
  assert.equal(unknownTerm.filterBlocking, false);
  assert.equal(unknownTerm.known, false);

  const missingAdmit = evaluateEns491({
    profiles: [profile('EE', '')],
    courses: ['EE202', 'ENS211'],
  });
  assert.equal(missingAdmit.status, 'review');
  assert.equal(missingAdmit.filterBlocking, false);
  assert.ok(missingAdmit.profiles.some((item) => item.reason === 'missing-canonical-admit-term'));

  const malformed = evaluateEns491({
    profiles: [{ program: '', role: 'main', admitTermCode: '202501' }],
    courses: ['CS300'],
  });
  assert.equal(malformed.status, 'review');
  assert.equal(malformed.filterBlocking, false);
});

test('a known false AND clause remains definitively unmet when another clause needs review', () => {
  const result = evaluateEns491({
    priorSu: 79,
    profiles: [profile('EE', '')],
    courses: ['EE202', 'ENS211'],
  });
  assert.equal(result.profileAggregate.status, 'review');
  assert.equal(result.status, 'unmet', 'known false dominates unknown in an AND policy');
  assert.equal(result.filterBlocking, true);
  assert.equal(result.priorSuRequirement.minimum, 80);
});

test('mixed applicable program outcomes are reviewable, while unanimous outcomes remain definitive', () => {
  const profiles = [profile('CS', '202501', 'main'), profile('ME', '202501', 'dm')];

  const mixed = evaluateEns491({ profiles, courses: ['CS300'] });
  assert.equal(mixed.status, 'review');
  assert.equal(mixed.filterBlocking, false);
  assert.deepEqual(
    JSON.parse(JSON.stringify(mixed.profiles.map((item) => item.status))),
    ['met', 'unmet'],
  );

  const allMet = evaluateEns491({ profiles, courses: ['CS300', 'ME301'] });
  assert.equal(allMet.status, 'met');
  assert.equal(allMet.filterBlocking, false);

  const allUnmet = evaluateEns491({ profiles, courses: [] });
  assert.equal(allUnmet.status, 'unmet');
  assert.equal(allUnmet.filterBlocking, true);
});

test('the shared evaluator composes ENS491 guidance without changing ordinary result fields', () => {
  const unmet = requisites.evaluateCandidateForTerm(
    { corequisites: 'ENS 491R' },
    'ENS491',
    context({ priorSu: 79, profiles: [profile('CS')], courses: [] }),
  );
  assert.equal(unmet.status, 'unmet');
  assert.equal(unmet.hasRequirements, true);
  assert.equal(unmet.supplemental.hasRule, true);
  assert.equal(unmet.supplemental.courseCode, 'ENS491');
  assert.equal(unmet.priorSuRequirement.minimum, 80);
  assert.equal(unmet.missingCorequisites.length, 0, 'ENS491R remains a planner-suppressed component');
});
