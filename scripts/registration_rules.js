// Reviewed, structured registration rules that supplement Banner's formal
// prerequisite fields. Only explicitly registered courses use this layer;
// every other course remains on the ordinary prerequisite path.

(function () {
  'use strict';

  const TERM_CODE_RE = /^\d{4}(01|02|03)$/;
  const COURSE_CODE_RE = /^[A-Z]{2,5}\d{3,5}[A-Z]?$/;
  const PROGRAM_CODE_RE = /^[A-Z][A-Z0-9]{1,9}$/;
  const SUPPORTED_ROLES = new Set(['main', 'doubleMajor', 'minor']);

  function normalizeCourseCode(value) {
    return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  function normalizeProgram(value) {
    return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  function normalizeRole(value) {
    const role = String(value || '').trim();
    if (role === 'major' || role === 'primary' || role === 'mainMajor') return 'main';
    if (role === 'dm' || role === 'double-major' || role === 'double_major') {
      return 'doubleMajor';
    }
    return SUPPORTED_ROLES.has(role) ? role : '';
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.keys(value).forEach((key) => deepFreeze(value[key]));
    return Object.freeze(value);
  }

  function courseNode(courseCode) {
    return { type: 'course', courseCode };
  }

  function anyCourses(courseCodes) {
    return { type: 'any', items: courseCodes.map(courseNode) };
  }

  function allCourses(courseCodes) {
    return { type: 'all', items: courseCodes.map(courseNode) };
  }

  const REVIEWED_ENS491_REQUIREMENTS = 'At least 80 prior SU. BIO: BIO301 or BIO303; '
    + 'CS: CS300, CS306, or CS308; EE students admitted to the university from '
    + '202601: EE202 and ENS211; EE students admitted to the university before '
    + '202601: EE202 or ENS211; IE: IE305 or IE312; '
    + 'MAT: MAT312 or MAT314; ME: ME301 or ME303.';

  const CURATED_RULES = [
    {
      schemaVersion: 1,
      ruleId: 'ens491-registration-2026-08-17',
      courseCode: 'ENS491',
      common: {
        minimumPriorSu: 80,
        guidance: 'Complete at least 80 SU in semesters strictly before the ENS491 semester.',
      },
      programRequirements: [
        {
          when: { program: 'BIO', roles: ['main', 'doubleMajor'] },
          requirement: anyCourses(['BIO301', 'BIO303']),
          guidance: 'BIO: complete BIO301 or BIO303 before ENS491.',
        },
        {
          when: { program: 'CS', roles: ['main', 'doubleMajor'] },
          requirement: anyCourses(['CS300', 'CS306', 'CS308']),
          guidance: 'CS: complete CS300, CS306, or CS308 before ENS491.',
        },
        {
          when: {
            program: 'EE',
            roles: ['main', 'doubleMajor'],
            admitTerm: { before: '202601' },
            admitTermSource: 'university',
          },
          requirement: anyCourses(['EE202', 'ENS211']),
          guidance: 'EE students admitted to the university before 202601: complete EE202 or ENS211 before ENS491.',
        },
        {
          when: {
            program: 'EE',
            roles: ['main', 'doubleMajor'],
            admitTerm: { from: '202601' },
            admitTermSource: 'university',
          },
          requirement: allCourses(['EE202', 'ENS211']),
          guidance: 'EE students admitted to the university from 202601: complete both EE202 and ENS211 before ENS491.',
        },
        {
          when: { program: 'IE', roles: ['main', 'doubleMajor'] },
          requirement: anyCourses(['IE305', 'IE312']),
          guidance: 'IE: complete IE305 or IE312 before ENS491.',
        },
        {
          when: { program: 'MAT', roles: ['main', 'doubleMajor'] },
          requirement: anyCourses(['MAT312', 'MAT314']),
          guidance: 'MAT: complete MAT312 or MAT314 before ENS491.',
        },
        {
          when: { program: 'ME', roles: ['main', 'doubleMajor'] },
          requirement: anyCourses(['ME301', 'ME303']),
          guidance: 'ME: complete ME301 or ME303 before ENS491.',
        },
        {
          when: { program: 'DSA', roles: ['main', 'doubleMajor'] },
          requirement: { type: 'none' },
          guidance: 'DSA: SUIS lists no additional program-specific course condition for ENS491.',
        },
      ],
      components: [
        {
          courseCode: 'ENS491R',
          relationship: 'same-term-corequisite',
          sameTerm: true,
          schedulerOnly: true,
          plannerCourse: false,
          guidance: 'ENS491R is selected with ENS491 in the Scheduler and is not a separate planner course.',
        },
      ],
      source: {
        authority: 'Sabanci University Information System (SUIS)',
        url: 'https://suis.sabanciuniv.edu/prod/sabanci_www.p_get_courses?levl_code=UG&subj_code=ENS&crse_numb=491&lang=eng',
        sourceLocation: 'description',
        reviewedAt: '2026-08-17',
        supersedesDescription: true,
        summary: REVIEWED_ENS491_REQUIREMENTS,
        reviewedRequirementsText: REVIEWED_ENS491_REQUIREMENTS,
        fingerprintAlgorithm: 'sha256-normalized-description',
        fingerprint: 'c8f556e1b060f1d53833e7174e543d73f1d03f232ea8bef7ddc90b037895eb48',
      },
    },
  ];

  function validateRequirementNode(node, path, errors) {
    if (!node || typeof node !== 'object') {
      errors.push(`${path} must be a requirement object`);
      return;
    }
    if (node.type === 'none') return;
    if (node.type === 'course') {
      const code = normalizeCourseCode(node.courseCode);
      if (!COURSE_CODE_RE.test(code) || code !== node.courseCode) {
        errors.push(`${path}.courseCode must be a normalized course code`);
      }
      return;
    }
    if (node.type !== 'all' && node.type !== 'any') {
      errors.push(`${path}.type must be none, course, all, or any`);
      return;
    }
    if (!Array.isArray(node.items) || node.items.length < 2) {
      errors.push(`${path}.items must contain at least two requirements`);
      return;
    }
    node.items.forEach((item, index) => validateRequirementNode(
      item,
      `${path}.items[${index}]`,
      errors,
    ));
  }

  function validateRule(rule) {
    const errors = [];
    if (!rule || typeof rule !== 'object') {
      return { valid: false, errors: ['rule must be an object'] };
    }
    if (rule.schemaVersion !== 1) errors.push('schemaVersion must be 1');
    if (!String(rule.ruleId || '').trim()) errors.push('ruleId is required');
    const courseCode = normalizeCourseCode(rule.courseCode);
    if (!COURSE_CODE_RE.test(courseCode) || courseCode !== rule.courseCode) {
      errors.push('courseCode must be a normalized course code');
    }
    const hasPriorSu = rule.common && rule.common.minimumPriorSu != null;
    if (hasPriorSu) {
      const minimumPriorSu = Number(rule.common.minimumPriorSu);
      if (!Number.isFinite(minimumPriorSu) || minimumPriorSu <= 0) {
        errors.push('common.minimumPriorSu must be a positive number');
      }
      if (!String(rule.common.guidance || '').trim()) {
        errors.push('common.guidance is required when minimumPriorSu is present');
      }
    }

    if (rule.programRequirements != null && !Array.isArray(rule.programRequirements)) {
      errors.push('programRequirements must be an array when present');
    }
    const requirements = Array.isArray(rule.programRequirements)
      ? rule.programRequirements : [];
    requirements.forEach((entry, index) => {
      const path = `programRequirements[${index}]`;
      const when = entry && entry.when;
      const program = normalizeProgram(when && when.program);
      if (!PROGRAM_CODE_RE.test(program) || program !== (when && when.program)) {
        errors.push(`${path}.when.program must be a normalized program code`);
      }
      if (!Array.isArray(when && when.roles) || !when.roles.length) {
        errors.push(`${path}.when.roles must not be empty`);
      } else {
        when.roles.forEach((role) => {
          if (!SUPPORTED_ROLES.has(role)) errors.push(`${path}.when.roles contains ${role}`);
        });
      }
      const admit = when && when.admitTerm;
      if (admit) {
        const keys = ['before', 'from'].filter((key) => admit[key] != null);
        if (keys.length !== 1 || !TERM_CODE_RE.test(String(admit[keys[0]] || ''))) {
          errors.push(`${path}.when.admitTerm must contain one canonical before/from boundary`);
        }
        if (when.admitTermSource != null
          && !['program', 'university'].includes(when.admitTermSource)) {
          errors.push(`${path}.when.admitTermSource must be program or university`);
        }
      }
      validateRequirementNode(entry && entry.requirement, `${path}.requirement`, errors);
      if (!String(entry && entry.guidance || '').trim()) errors.push(`${path}.guidance is required`);
    });

    if (rule.components != null && !Array.isArray(rule.components)) {
      errors.push('components must be an array when present');
    }
    const components = Array.isArray(rule.components) ? rule.components : [];
    components.forEach((component, index) => {
      const code = normalizeCourseCode(component && component.courseCode);
      if (!COURSE_CODE_RE.test(code) || code !== (component && component.courseCode)) {
        errors.push(`components[${index}].courseCode must be normalized`);
      }
      if (component && component.schedulerOnly === true && component.plannerCourse !== false) {
        errors.push(`components[${index}] scheduler-only components cannot be planner courses`);
      }
    });
    if (!hasPriorSu && !requirements.length && !components.length) {
      errors.push('rule must define a prior-SU clause, program requirement, or component');
    }

    const source = rule.source;
    if (!source || typeof source !== 'object') errors.push('source is required');
    else {
      if (!/^https:\/\//.test(String(source.url || ''))) errors.push('source.url must use HTTPS');
      if (!String(source.authority || '').trim()) errors.push('source.authority is required');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(source.reviewedAt || ''))) {
        errors.push('source.reviewedAt must be YYYY-MM-DD');
      }
      if (!/^[a-f0-9]{64}$/.test(String(source.fingerprint || ''))) {
        errors.push('source.fingerprint must be a SHA-256 hex digest');
      }
    }
    return { valid: errors.length === 0, errors };
  }

  const rulesByCode = new Map();
  const componentsByCode = new Map();
  CURATED_RULES.forEach((rule) => {
    const validation = validateRule(rule);
    if (!validation.valid) {
      throw new Error(`Invalid supplemental registration rule ${rule && rule.ruleId}: ${validation.errors.join('; ')}`);
    }
    const frozen = deepFreeze(rule);
    if (rulesByCode.has(frozen.courseCode)) {
      throw new Error(`Duplicate supplemental registration rule for ${frozen.courseCode}`);
    }
    rulesByCode.set(frozen.courseCode, frozen);
    (Array.isArray(frozen.components) ? frozen.components : []).forEach((component) => {
      if (componentsByCode.has(component.courseCode)) {
        throw new Error(`Duplicate supplemental component metadata for ${component.courseCode}`);
      }
      componentsByCode.set(component.courseCode, deepFreeze(Object.assign(
        { parentCourseCode: frozen.courseCode, source: frozen.source },
        component,
      )));
    });
  });

  function getRule(courseCode) {
    return rulesByCode.get(normalizeCourseCode(courseCode)) || null;
  }

  function getComponentMetadata(courseCode) {
    return componentsByCode.get(normalizeCourseCode(courseCode)) || null;
  }

  function describeRule(courseCode) {
    const rule = getRule(courseCode);
    if (!rule) return null;
    const guidance = [];
    if (rule.common && rule.common.minimumPriorSu != null) {
      guidance.push({
        kind: 'prior-credits',
        text: rule.common.guidance,
        minimumPriorSu: rule.common.minimumPriorSu,
      });
    }
    (Array.isArray(rule.programRequirements) ? rule.programRequirements : []).forEach((entry) => {
      guidance.push({
        kind: 'program-prerequisite',
        text: entry.guidance,
        program: entry.when.program,
        roles: entry.when.roles.slice(),
        admitTerm: entry.when.admitTerm || null,
        admitTermSource: entry.when.admitTermSource || 'program',
      });
    });
    (Array.isArray(rule.components) ? rule.components : []).forEach((component) => {
      guidance.push({
        kind: 'component',
        text: component.guidance,
        courseCode: component.courseCode,
      });
    });
    return deepFreeze({
      hasRule: true,
      ruleId: rule.ruleId,
      courseCode: rule.courseCode,
      guidance,
      components: Array.isArray(rule.components) ? rule.components : [],
      source: rule.source,
    });
  }

  function emptyPrerequisite() {
    return {
      mode: 'expr',
      required: [],
      concurrent: [],
      oneOf: [],
      oneOfConcurrent: [],
    };
  }

  function mergePrerequisites(results) {
    const out = emptyPrerequisite();
    (Array.isArray(results) ? results : []).filter(Boolean).forEach((result) => {
      (result.required || []).forEach((code) => {
        if (!out.required.includes(code)) out.required.push(code);
      });
      (result.concurrent || []).forEach((code) => {
        if (!out.concurrent.includes(code)) out.concurrent.push(code);
      });
      (result.oneOf || []).forEach((group, index) => {
        out.oneOf.push(Array.isArray(group) ? group.slice() : []);
        const flags = result.oneOfConcurrent && result.oneOfConcurrent[index];
        out.oneOfConcurrent.push(Array.isArray(flags) ? flags.slice() : []);
      });
    });
    return out.required.length || out.oneOf.length ? out : null;
  }

  function requirementLabel(node) {
    if (!node) return '';
    if (node.type === 'course') return node.courseCode;
    const labels = (node.items || []).map(requirementLabel).filter(Boolean);
    if (node.type === 'all') return labels.join(' + ');
    if (node.type === 'any') return labels.join(' / ');
    return '';
  }

  function availabilityFromContext(context) {
    if (!context || context.known !== true || !(Number(context.targetTerm) > 0)) {
      return { known: false, has: () => false };
    }
    const earlier = context && context.earlierCodes;
    if (earlier && typeof earlier.has === 'function') {
      return { known: true, has: (code) => earlier.has(code) };
    }
    const targetTerm = Number(context && context.targetTerm);
    const occurrences = context && context.occurrences;
    if (!Number.isFinite(targetTerm) || targetTerm <= 0 || !Array.isArray(occurrences)) {
      return { known: false, has: () => false };
    }
    return {
      known: true,
      has: (code) => occurrences.some((occurrence) => (
        occurrence
        && normalizeCourseCode(occurrence.code) === code
        && occurrence.eligible === true
        && Number(occurrence.term) > 0
        && Number(occurrence.term) < targetTerm
      )),
    };
  }

  function evaluateRequirementNode(node, availability) {
    if (node && node.type === 'none') return { status: 'met', prerequisite: null };
    if (!availability.known) {
      return { status: 'review', reason: 'course-history-unavailable', prerequisite: null };
    }
    if (node.type === 'course') {
      if (availability.has(node.courseCode)) return { status: 'met', prerequisite: null };
      const prerequisite = emptyPrerequisite();
      prerequisite.required.push(node.courseCode);
      return { status: 'unmet', prerequisite };
    }
    const childResults = node.items.map((child) => evaluateRequirementNode(child, availability));
    if (node.type === 'all') {
      const unmet = childResults.filter((result) => result.status === 'unmet');
      if (unmet.length) {
        return {
          status: 'unmet',
          prerequisite: mergePrerequisites(unmet.map((item) => item.prerequisite)),
        };
      }
      if (childResults.some((result) => result.status === 'review')) {
        return { status: 'review', reason: 'course-history-unavailable', prerequisite: null };
      }
      return { status: 'met', prerequisite: null };
    }
    if (childResults.some((result) => result.status === 'met')) {
      return { status: 'met', prerequisite: null };
    }
    if (childResults.some((result) => result.status === 'review')) {
      return { status: 'review', reason: 'course-history-unavailable', prerequisite: null };
    }
    const prerequisite = emptyPrerequisite();
    prerequisite.oneOf.push(node.items.map(requirementLabel));
    prerequisite.oneOfConcurrent.push(node.items.map(() => false));
    return { status: 'unmet', prerequisite };
  }

  function normalizedProfile(profile) {
    return {
      program: normalizeProgram(profile && profile.program),
      role: normalizeRole(profile && profile.role),
      admitTermCode: String(profile && profile.admitTermCode || '').trim(),
      universityAdmitTermCode: String(
        profile && profile.universityAdmitTermCode || '',
      ).trim(),
    };
  }

  function conditionMatchesProfile(when, profile) {
    if (when.program !== profile.program) return { applicable: false, matched: false };
    if (!when.roles.includes(profile.role)) return { applicable: false, matched: false };
    if (!when.admitTerm) return { applicable: true, matched: true };
    const source = when.admitTermSource === 'university' ? 'university' : 'program';
    const termCode = source === 'university'
      ? profile.universityAdmitTermCode : profile.admitTermCode;
    if (!TERM_CODE_RE.test(termCode)) {
      return {
        applicable: true,
        matched: false,
        review: 'missing-canonical-admit-term',
        admitTermSource: source,
      };
    }
    const value = Number(termCode);
    if (when.admitTerm.before) {
      return { applicable: true, matched: value < Number(when.admitTerm.before) };
    }
    return { applicable: true, matched: value >= Number(when.admitTerm.from) };
  }

  function aggregateProfileStatus(scopes) {
    const statuses = (Array.isArray(scopes) ? scopes : []).map((scope) => scope.status);
    if (!statuses.length) return { status: 'met', reason: '' };
    if (statuses.includes('review') || statuses.includes('unknown')) {
      return { status: 'review', reason: 'program-profile-review-required' };
    }
    if (statuses.every((status) => status === 'met')) return { status: 'met', reason: '' };
    if (statuses.every((status) => status === 'unmet')) return { status: 'unmet', reason: '' };
    // A course can be valid for one selected degree and invalid for another.
    // Do not guess which program controls registration and do not hide it.
    return { status: 'review', reason: 'mixed-program-requirements' };
  }

  function evaluateRule(courseCode, context) {
    const rule = getRule(courseCode);
    if (!rule) return null;
    const ctx = context && typeof context === 'object' ? context : {};
    const hasPriorClause = !!(rule.common && rule.common.minimumPriorSu != null);
    const chronologyKnown = ctx.known === true && Number(ctx.targetTerm) > 0;
    const priorKnown = !hasPriorClause || (
      chronologyKnown
      && Object.prototype.hasOwnProperty.call(ctx, 'priorEligibleSu')
      && Number.isFinite(Number(ctx.priorEligibleSu))
    );
    const actualPriorSu = priorKnown ? Math.max(0, Number(ctx.priorEligibleSu)) : 0;
    const priorSuRequirement = hasPriorClause
      && priorKnown
      && actualPriorSu < Number(rule.common.minimumPriorSu)
      ? {
        minimum: Number(rule.common.minimumPriorSu),
        actual: actualPriorSu,
        missing: Number(rule.common.minimumPriorSu) - actualPriorSu,
        supplemental: true,
      }
      : null;
    const commonStatus = !hasPriorClause
      ? 'met'
      : (!priorKnown ? 'review' : (priorSuRequirement ? 'unmet' : 'met'));
    const availability = availabilityFromContext(ctx);
    const rawProfiles = Array.isArray(ctx.programProfiles) ? ctx.programProfiles : [];
    const programRequirements = Array.isArray(rule.programRequirements)
      ? rule.programRequirements : [];
    const scopes = [];

    rawProfiles.map(normalizedProfile).forEach((profile) => {
      if (!profile.program || !profile.role) {
        scopes.push(Object.assign({}, profile, {
          status: 'review',
          reason: 'invalid-program-profile',
          prerequisite: null,
        }));
        return;
      }
      const programEntries = programRequirements.filter((entry) => (
        entry.when.program === profile.program && entry.when.roles.includes(profile.role)
      ));
      // Minor profiles are intentionally ignored unless a future rule opts in
      // by listing the minor role explicitly.
      if (!programEntries.length) return;
      const matches = [];
      let reviewReason = '';
      programEntries.forEach((entry) => {
        const match = conditionMatchesProfile(entry.when, profile);
        if (match.review) reviewReason = match.review;
        if (match.matched) matches.push(entry);
      });
      if (reviewReason || matches.length !== 1) {
        scopes.push(Object.assign({}, profile, {
          status: 'review',
          reason: reviewReason || 'registration-rule-branch-ambiguous',
          prerequisite: null,
          guidance: programEntries.map((entry) => entry.guidance),
        }));
        return;
      }
      const selected = matches[0];
      const evaluated = evaluateRequirementNode(selected.requirement, availability);
      scopes.push(Object.assign({}, profile, evaluated, {
        guidance: [selected.guidance],
      }));
    });

    if (programRequirements.length && !rawProfiles.length) {
      scopes.push({
        program: '',
        role: '',
        admitTermCode: '',
        universityAdmitTermCode: '',
        status: 'review',
        reason: 'missing-program-profiles',
        prerequisite: null,
        guidance: [],
      });
    }

    const profileAggregate = aggregateProfileStatus(scopes);
    const status = commonStatus === 'unmet' || profileAggregate.status === 'unmet'
      ? 'unmet'
      : (commonStatus === 'review' || profileAggregate.status === 'review' ? 'review' : 'met');
    const prerequisite = profileAggregate.status === 'unmet'
      ? mergePrerequisites(scopes
        .filter((scope) => scope.status === 'unmet')
        .map((scope) => scope.prerequisite))
      : null;
    const definitiveUnmet = !!(priorSuRequirement || prerequisite);
    const guidance = [];
    if (hasPriorClause) {
      guidance.push({
        kind: 'prior-credits',
        text: rule.common.guidance,
        status: commonStatus,
        minimumPriorSu: Number(rule.common.minimumPriorSu),
        actualPriorSu: priorKnown ? actualPriorSu : null,
      });
    }
    scopes.forEach((scope) => {
      const lines = Array.isArray(scope.guidance) ? scope.guidance : [];
      lines.forEach((text) => {
        if (!text) return;
        guidance.push({
          kind: 'program-prerequisite',
          text,
          status: scope.status,
          program: scope.program,
          role: scope.role,
          admitTermCode: scope.admitTermCode,
          universityAdmitTermCode: scope.universityAdmitTermCode,
        });
      });
    });
    if (profileAggregate.status === 'review' && !guidance.some((item) => (
      item.kind === 'program-prerequisite' && item.status === 'review'
    ))) {
      guidance.push({
        kind: 'program-prerequisite',
        text: 'Program-specific ENS491 requirements could not be determined automatically; verify them in SUIS.',
        status: 'review',
      });
    }
    return deepFreeze({
      hasRule: true,
      ruleId: rule.ruleId,
      courseCode: rule.courseCode,
      status,
      reason: status === 'review'
        ? (profileAggregate.reason || 'supplemental-review-required') : '',
      definitiveUnmet,
      filterBlocking: definitiveUnmet,
      prerequisite,
      priorSuRequirement,
      guidance,
      profiles: scopes,
      scopes,
      profileAggregate,
      components: Array.isArray(rule.components) ? rule.components : [],
      source: rule.source,
    });
  }

  const api = Object.freeze({
    registryVersion: 1,
    rules: deepFreeze(CURATED_RULES.slice()),
    normalizeCourseCode,
    validateRule,
    getRule,
    describeRule,
    evaluateRule,
    getComponentMetadata,
  });

  if (typeof window !== 'undefined') window.registrationRules = api;
})();
