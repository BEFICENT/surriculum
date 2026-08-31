// Shared course-candidate metadata and filtering for planner and scheduler.
//
// Catalog membership is deliberately kept separate for the main program,
// double major, and every minor. A metadata lookup may fall through between
// those catalogs, but a program/category filter must never do so. All helpers
// are read-only with respect to catalog rows and curriculum state.

(function () {
  'use strict';

  function normalizeCourseCode(value) {
    let normalized = '';
    try {
      const shared = (typeof window !== 'undefined') ? window.courseRequisites : null;
      if (shared && typeof shared.normalizeCourseCode === 'function') {
        normalized = shared.normalizeCourseCode(value);
      }
    } catch (_) {}
    if (!normalized) {
      normalized = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    }
    // Preserve the planner's canonical identity invariant for the one renamed
    // course that can still appear under its legacy code in saved plans.
    return normalized === 'CS210' || normalized === 'DSA210' ? 'DSA210' : normalized;
  }

  function recordCourseCode(record) {
    if (!record || typeof record !== 'object') return '';
    if (record.course_id != null) return normalizeCourseCode(record.course_id);
    if (record.code != null && !record.Major && !record.Code) {
      return normalizeCourseCode(record.code);
    }
    return normalizeCourseCode(String(record.Major || '') + String(record.Code || ''));
  }

  function rawRecordCourseCode(record) {
    if (!record || typeof record !== 'object') return '';
    let value = '';
    if (record.course_id != null) value = record.course_id;
    else if (record.code != null && !record.Major && !record.Code) value = record.code;
    else value = String(record.Major || '') + String(record.Code || '');
    return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  // Some historical catalogs contain both the former CS210 record and its
  // canonical DSA210 replacement. Merge them into one suggestion, but make
  // the canonical record authoritative for title, curriculum category, and
  // numeric metadata regardless of source-file order.
  function canonicalAliasFirst(rows) {
    return (Array.isArray(rows) ? rows : []).slice().sort((left, right) => {
      const priority = (record) => {
        const code = rawRecordCourseCode(record);
        if (code === 'DSA210') return -1;
        if (code === 'CS210') return 1;
        return 0;
      };
      return priority(left) - priority(right);
    });
  }

  function normalizeCategory(value) {
    return String(value == null ? '' : value).trim().toLowerCase();
  }

  function categoryForRecord(record) {
    if (!record || typeof record !== 'object') return '';
    return normalizeCategory(
      record.EL_Type != null ? record.EL_Type
        : (record.el_type != null ? record.el_type : record.category),
    );
  }

  function finiteNumber(value) {
    if (value === null || value === undefined || value === '') return 0;
    const normalized = typeof value === 'string' ? value.trim().replace(',', '.') : value;
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function firstDefinedNumber(record, keys) {
    if (!record || typeof record !== 'object') return { found: false, value: 0 };
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
      const raw = record[key];
      if (raw === null || raw === undefined || String(raw).trim() === '') continue;
      return { found: true, value: finiteNumber(raw) };
    }
    return { found: false, value: 0 };
  }

  function titleForRecord(record) {
    if (!record || typeof record !== 'object') return '';
    return String(
      record.Course_Name != null ? record.Course_Name
        : (record.course_name != null ? record.course_name
          : (record.title != null ? record.title : record.header_text || '')),
    ).trim().replace(/\s+/g, ' ');
  }

  function courseLevelForCode(value) {
    const code = normalizeCourseCode(value);
    const match = code.match(/^[A-Z]+(\d)/);
    return match ? Number(match[1]) * 100 : null;
  }

  function normalizeProgram(value) {
    const raw = String(value == null ? '' : value).trim();
    if (!raw) return '';
    const alias = raw.toLowerCase().replace(/[\s_-]+/g, '');
    if (alias === 'main') return 'main';
    if (alias === 'dm' || alias === 'doublemajor') return 'dm';
    if (alias === 'minor' || alias === 'minors') return 'minor';
    return raw.toUpperCase();
  }

  function normalizeLevel(value) {
    if (value === null || value === undefined || value === '') return null;
    const match = String(value).trim().match(/\d+/);
    if (!match) return null;
    const parsed = Number.parseInt(match[0], 10);
    if (!Number.isFinite(parsed) || parsed < 0) return null;
    if (parsed < 10) return parsed * 100;
    if (parsed < 100) return Math.floor(parsed / 10) * 100;
    return Math.floor(parsed / 100) * 100;
  }

  function positiveFilterNumber(value) {
    const parsed = finiteNumber(value);
    return parsed > 0 ? parsed : null;
  }

  function normalizeFilters(filters) {
    const source = filters && typeof filters === 'object' ? filters : {};
    const readBool = (primary, aliases, fallback) => {
      const keys = [primary].concat(aliases || []);
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
        const value = source[key];
        if (typeof value === 'string') return value === 'true';
        return !!value;
      }
      return !!fallback;
    };
    const read = (primary, aliases) => {
      const keys = [primary].concat(aliases || []);
      for (let i = 0; i < keys.length; i++) {
        if (Object.prototype.hasOwnProperty.call(source, keys[i])) return source[keys[i]];
      }
      return '';
    };

    return {
      query: String(read('query', ['search']) || '').trim(),
      program: normalizeProgram(read('program', ['programCode'])),
      category: normalizeCategory(read('category', ['courseType', 'type'])),
      level: normalizeLevel(read('level', ['courseLevel'])),
      minSu: positiveFilterNumber(read('minSu', ['minSuCredits'])),
      minEcts: positiveFilterNumber(read('minEcts', [])),
      minBasicScience: positiveFilterNumber(read('minBasicScience', ['minBs'])),
      minEngineering: positiveFilterNumber(read('minEngineering', ['minEng'])),
      hideTaken: readBool('hideTaken', ['hideTakenCourses'], false),
      offeredOnly: readBool('offeredOnly', ['offeredThisTermOnly'], false),
      checkPrerequisites: readBool('checkPrerequisites', ['checkPrereqs'], false),
      showUnmetPrerequisites: readBool(
        'showUnmetPrerequisites',
        ['showUnmetPrereqs'],
        true,
      ),
    };
  }

  // Registration-rule profiles deliberately reuse the curriculum's canonical
  // admit-term values.  They are presentation/evaluation context only: this
  // helper neither derives a new term nor reads a second persistence source.
  function buildProgramProfiles(curriculum) {
    const cur = curriculum && typeof curriculum === 'object' ? curriculum : {};
    const profiles = [];
    const universityAdmitTermCode = String(cur.entryTerm || '').trim();
    const add = (role, program, admitTermCode) => {
      const normalizedProgram = String(program || '').trim().toUpperCase();
      if (!normalizedProgram || normalizedProgram === 'NONE') return;
      const key = `${role}:${normalizedProgram}`;
      if (profiles.some((profile) => `${profile.role}:${profile.program}` === key)) return;
      profiles.push({
        role,
        program: normalizedProgram,
        admitTermCode: String(admitTermCode || '').trim(),
        universityAdmitTermCode,
      });
    };

    add('main', cur.major, cur.entryTerm);
    add('dm', cur.doubleMajor, cur.entryTermDM);
    const minorTerms = cur.minorTermsByCode && typeof cur.minorTermsByCode === 'object'
      ? cur.minorTermsByCode : {};
    const minors = Array.isArray(cur.minors) ? cur.minors : [];
    for (let i = 0; i < minors.length; i++) {
      const program = String(minors[i] || '').trim().toUpperCase();
      add('minor', program, minorTerms[program] || cur.entryTermMinor);
    }

    return profiles;
  }

  function isSupplementalPlannerComponent(courseCode) {
    try {
      const registry = (typeof window !== 'undefined') ? window.registrationRules : null;
      if (!registry || typeof registry.getComponentMetadata !== 'function') return false;
      const metadata = registry.getComponentMetadata(normalizeCourseCode(courseCode));
      return !!(metadata && metadata.plannerCourse === false);
    } catch (_) {
      return false;
    }
  }

  function supplementalGuidanceItems(supplemental, options) {
    if (!supplemental || typeof supplemental !== 'object') return [];
    const opts = options && typeof options === 'object' ? options : {};
    const includeMet = opts.includeMet === true;
    const includeComponents = opts.includeComponents === true;
    const includeAllBranches = opts.includeAllBranches === true;
    const staticGuidance = Array.isArray(supplemental.guidance)
      ? supplemental.guidance : [];
    const profiles = Array.isArray(supplemental.profiles)
      ? supplemental.profiles
      : (Array.isArray(supplemental.scopes) ? supplemental.scopes : []);
    const out = [];
    const seen = new Set();
    const add = (item, fallbackKind) => {
      const text = String(item && item.text ? item.text : item || '').trim();
      if (!text || seen.has(text)) return;
      seen.add(text);
      out.push({
        kind: String(item && item.kind ? item.kind : fallbackKind || 'registration-guidance'),
        text,
      });
    };

    if (includeAllBranches) {
      staticGuidance.forEach((item) => {
        if (!includeComponents && item && item.kind === 'component') return;
        add(item);
      });
      return out;
    }

    if (!profiles.length) {
      staticGuidance.forEach((item) => {
        if (!item || (!includeComponents && item.kind === 'component')) return;
        if (includeMet || String(item.status || 'review') !== 'met') add(item);
      });
      return out;
    }

    const prior = supplemental.priorSuRequirement;
    const common = staticGuidance.find((item) => item && item.kind === 'prior-credits');
    if (prior) {
      const compact = (value) => String(Math.round((Number(value) || 0) * 100) / 100);
      add({
        kind: 'prior-credits',
        text: `Prior SU: ${compact(prior.actual)} of ${compact(prior.minimum)} SU planned/completed in earlier semesters.`,
      });
    } else if (common && (includeMet || String(common.status || '') === 'review')) {
      add(common);
    }

    profiles.forEach((profile) => {
      const status = String(profile && profile.status || 'review').toLowerCase();
      if (!includeMet && status === 'met') return;
      const guidance = profile && Array.isArray(profile.guidance) ? profile.guidance : [];
      guidance.forEach((text) => add({ kind: 'program-prerequisite', text }));
    });
    staticGuidance.forEach((item) => {
      if (!item || item.kind === 'prior-credits' || item.kind === 'component') return;
      if (includeMet || String(item.status || '') !== 'met') add(item);
    });
    if (includeComponents) {
      staticGuidance.filter((item) => item && item.kind === 'component').forEach((item) => add(item));
      const components = Array.isArray(supplemental.components)
        ? supplemental.components : [];
      components.forEach((component) => {
        if (component && component.guidance) {
          add({ kind: 'component', text: component.guidance });
        }
      });
    }
    return out;
  }

  function buildCandidates(primaryCourseData, curriculum) {
    const byCode = new Map();
    const cur = curriculum && typeof curriculum === 'object' ? curriculum : {};
    const mainProgram = String(cur.major || '').trim().toUpperCase();
    const doubleMajorProgram = (() => {
      const value = String(cur.doubleMajor || '').trim().toUpperCase();
      return value && value !== 'NONE' ? value : '';
    })();
    const minorPrograms = Array.isArray(cur.minors)
      ? cur.minors.map((value) => String(value || '').trim().toUpperCase()).filter(Boolean)
      : [];

    const ensureCandidate = (record) => {
      const code = recordCourseCode(record);
      if (!code || (record && record.__globalCourseDefinition)
        || isSupplementalPlannerComponent(code)) return null;
      if (!byCode.has(code)) {
        byCode.set(code, {
          code,
          name: '',
          searchUpper: code,
          searchNoSpace: code,
          level: courseLevelForCode(code),
          su: 0,
          ects: 0,
          basicScience: 0,
          engineering: 0,
          memberships: { main: null, doubleMajor: null, minors: [] },
          programs: [],
          categories: [],
          records: { main: null, doubleMajor: null, minors: [] },
          _metadataFound: { su: false, ects: false, basicScience: false, engineering: false },
        });
      }
      const candidate = byCode.get(code);
      if (!candidate.name) candidate.name = titleForRecord(record);
      const numericFields = [
        ['su', ['SU_credit', 'su_credit', 'su_credits', 'credits']],
        ['ects', ['ECTS', 'ects']],
        ['basicScience', ['Basic_Science', 'basic_science']],
        ['engineering', ['Engineering', 'engineering']],
      ];
      for (let i = 0; i < numericFields.length; i++) {
        const field = numericFields[i][0];
        if (candidate._metadataFound[field]) continue;
        const value = firstDefinedNumber(record, numericFields[i][1]);
        if (!value.found) continue;
        candidate[field] = value.value;
        candidate._metadataFound[field] = true;
      }
      return candidate;
    };

    const addProgram = (candidate, program) => {
      if (program && !candidate.programs.includes(program)) candidate.programs.push(program);
    };
    const addCategory = (candidate, category) => {
      if (category && !candidate.categories.includes(category)) candidate.categories.push(category);
    };

    const mainRows = canonicalAliasFirst(primaryCourseData);
    for (let i = 0; i < mainRows.length; i++) {
      const record = mainRows[i];
      const candidate = ensureCandidate(record);
      if (!candidate || candidate.memberships.main) continue;
      const type = categoryForRecord(record);
      candidate.memberships.main = { program: mainProgram, type };
      candidate.records.main = record;
      addProgram(candidate, mainProgram);
      addCategory(candidate, type);
    }

    const dmRows = doubleMajorProgram
      ? canonicalAliasFirst(cur.doubleMajorCourseData) : [];
    for (let i = 0; i < dmRows.length; i++) {
      const record = dmRows[i];
      const candidate = ensureCandidate(record);
      if (!candidate || candidate.memberships.doubleMajor) continue;
      const type = categoryForRecord(record);
      candidate.memberships.doubleMajor = { program: doubleMajorProgram, type };
      candidate.records.doubleMajor = record;
      addProgram(candidate, doubleMajorProgram);
      addCategory(candidate, type);
    }

    const minorData = cur.minorCourseDataByCode && typeof cur.minorCourseDataByCode === 'object'
      ? cur.minorCourseDataByCode : {};
    for (let p = 0; p < minorPrograms.length; p++) {
      const program = minorPrograms[p];
      const rows = canonicalAliasFirst(minorData[program]);
      for (let i = 0; i < rows.length; i++) {
        const record = rows[i];
        const candidate = ensureCandidate(record);
        if (!candidate) continue;
        if (candidate.memberships.minors.some((membership) => membership.program === program)) continue;
        const type = categoryForRecord(record);
        candidate.memberships.minors.push({ program, type });
        candidate.records.minors.push({ program, record });
        addProgram(candidate, program);
        addCategory(candidate, type);
      }
    }

    const candidates = Array.from(byCode.values());
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      delete candidate._metadataFound;
      candidate.searchUpper = `${candidate.code} ${candidate.name}`.toUpperCase();
      candidate.searchNoSpace = `${candidate.code}${candidate.name}`.toUpperCase().replace(/\s+/g, '');
      // Compatibility aliases keep existing renderers simple while the
      // normalized names above remain the shared public contract.
      candidate.credit = candidate.su;
      candidate.bs = candidate.basicScience;
      candidate.eng = candidate.engineering;
      candidate.type = candidate.memberships.main ? candidate.memberships.main.type : '';
      candidate.dmType = candidate.memberships.doubleMajor
        ? candidate.memberships.doubleMajor.type : '';
      candidate.minorTypes = candidate.memberships.minors.slice();
    }
    candidates.sort((left, right) => left.code.localeCompare(right.code));
    return candidates;
  }

  function matchesSearch(candidate, query) {
    const normalized = String(query || '').trim().toUpperCase();
    if (!normalized) return true;
    const noSpace = normalized.replace(/\s+/g, '');
    // Saved plans and older users can still refer to DSA210 by its former
    // CS210 code. Candidate identity is canonicalized to DSA210, but search
    // should accept either spelling without adding a second visible result.
    if ((noSpace === 'CS210' || noSpace === 'DSA210')
      && normalizeCourseCode(candidate && candidate.code) === 'DSA210') {
      return true;
    }
    const searchUpper = String(
      candidate && candidate.searchUpper
        ? candidate.searchUpper
        : `${candidate && candidate.code ? candidate.code : ''} ${candidate && candidate.name ? candidate.name : ''}`,
    ).toUpperCase();
    const searchNoSpace = String(
      candidate && candidate.searchNoSpace
        ? candidate.searchNoSpace : searchUpper.replace(/\s+/g, ''),
    ).toUpperCase();
    return searchUpper.includes(normalized) || searchNoSpace.includes(noSpace);
  }

  function membershipsForProgram(candidate, program) {
    if (!candidate || !candidate.memberships) return [];
    const selected = normalizeProgram(program);
    const memberships = [];
    if (candidate.memberships.main) memberships.push({ role: 'main', ...candidate.memberships.main });
    if (candidate.memberships.doubleMajor) {
      memberships.push({ role: 'dm', ...candidate.memberships.doubleMajor });
    }
    const minors = Array.isArray(candidate.memberships.minors) ? candidate.memberships.minors : [];
    for (let i = 0; i < minors.length; i++) memberships.push({ role: 'minor', ...minors[i] });
    if (!selected) return memberships;
    if (selected === 'main') return memberships.filter((membership) => membership.role === 'main');
    if (selected === 'dm') return memberships.filter((membership) => membership.role === 'dm');
    if (selected === 'minor') return memberships.filter((membership) => membership.role === 'minor');
    return memberships.filter((membership) => String(membership.program || '').toUpperCase() === selected);
  }

  function matchesProgram(candidate, program) {
    const selected = normalizeProgram(program);
    return !selected || membershipsForProgram(candidate, selected).length > 0;
  }

  function matchesCategory(candidate, category, program) {
    const selected = normalizeCategory(category);
    if (!selected) return true;
    return membershipsForProgram(candidate, program)
      .some((membership) => normalizeCategory(membership.type) === selected);
  }

  function matchesLevel(candidate, level) {
    const selected = normalizeLevel(level);
    if (selected === null) return true;
    return Number(candidate && candidate.level) === selected;
  }

  function matchesNumeric(candidate, filters) {
    const normalized = normalizeFilters(filters);
    const row = candidate || {};
    return !(
      (normalized.minSu !== null && finiteNumber(row.su) < normalized.minSu)
      || (normalized.minEcts !== null && finiteNumber(row.ects) < normalized.minEcts)
      || (normalized.minBasicScience !== null
        && finiteNumber(row.basicScience) < normalized.minBasicScience)
      || (normalized.minEngineering !== null
        && finiteNumber(row.engineering) < normalized.minEngineering)
    );
  }

  function plannedStateForTarget(candidateOrCode, requirementContext) {
    const code = normalizeCourseCode(
      candidateOrCode && typeof candidateOrCode === 'object'
        ? candidateOrCode.code : candidateOrCode,
    );
    const allOccurrences = requirementContext && Array.isArray(requirementContext.occurrences)
      ? requirementContext.occurrences : [];
    const occurrences = allOccurrences.filter((occurrence) => (
      occurrence && normalizeCourseCode(occurrence.code || (occurrence.course && occurrence.course.code)) === code
    ));
    const known = !!(
      requirementContext
      && requirementContext.known === true
      && Number(requirementContext.targetTerm) > 0
    );
    if (!occurrences.length) {
      return {
        state: 'unplanned',
        hasEarlier: false,
        hasSameTerm: false,
        hasLater: false,
        hasUnknown: false,
        occurrences: [],
      };
    }
    if (!known) {
      return {
        state: 'unknown',
        hasEarlier: false,
        hasSameTerm: false,
        hasLater: false,
        hasUnknown: true,
        occurrences,
      };
    }

    const targetTerm = Number(requirementContext.targetTerm);
    let hasEarlier = false;
    let hasSameTerm = false;
    let hasLater = false;
    let hasUnknown = false;
    for (let i = 0; i < occurrences.length; i++) {
      const term = Number(occurrences[i] && occurrences[i].term) || 0;
      if (!term) hasUnknown = true;
      else if (term < targetTerm) hasEarlier = true;
      else if (term === targetTerm) hasSameTerm = true;
      else hasLater = true;
    }
    const positions = [hasEarlier, hasSameTerm, hasLater, hasUnknown].filter(Boolean).length;
    let state = 'unknown';
    if (positions > 1) state = 'multiple';
    else if (hasEarlier) state = 'earlier';
    else if (hasSameTerm) state = 'same-term';
    else if (hasLater) state = 'later';
    return { state, hasEarlier, hasSameTerm, hasLater, hasUnknown, occurrences };
  }

  function offeringState(candidateOrCode, offeredCourseCodes) {
    const code = normalizeCourseCode(
      candidateOrCode && typeof candidateOrCode === 'object'
        ? candidateOrCode.code : candidateOrCode,
    );
    let codes = offeredCourseCodes;
    let explicitlyKnown = null;
    const directSetLike = offeredCourseCodes && typeof offeredCourseCodes.has === 'function';
    if (offeredCourseCodes && !directSetLike
      && typeof offeredCourseCodes === 'object') {
      explicitlyKnown = Object.prototype.hasOwnProperty.call(offeredCourseCodes, 'known')
        ? offeredCourseCodes.known === true : null;
      codes = offeredCourseCodes.codes || offeredCourseCodes.courseCodes || null;
    }
    const setLike = codes && typeof codes.has === 'function';
    if (!code || explicitlyKnown === false || !setLike) {
      return { state: 'unknown', known: false, offered: null };
    }
    const offered = !!codes.has(code);
    return { state: offered ? 'offered' : 'not-offered', known: true, offered };
  }

  function courseInfoFor(infoByCode, code) {
    if (!infoByCode) return null;
    try {
      if (typeof infoByCode.get === 'function') {
        return infoByCode.get(code) || infoByCode.get(String(code || '').toLowerCase()) || null;
      }
      return infoByCode[code] || infoByCode[String(code || '').toLowerCase()] || null;
    } catch (_) {
      return null;
    }
  }

  const offeringHistoryModule = (typeof window !== 'undefined')
    ? window.SurriculumCourseOfferingHistory : null;
  if (!offeringHistoryModule) {
    throw new Error('Course offering-history policy was not loaded before course_filters.js.');
  }
  const offeringHistoryPolicy = offeringHistoryModule.createOfferingHistoryPolicy({
    normalizeCourseCode,
    rawRecordCourseCode,
    courseInfoFor,
  });
  const {
    deriveOfferingPattern,
    offeringHistoryForCandidate,
    contextualOfferingAdvisories,
  } = offeringHistoryPolicy;

  function evaluateCandidate(candidate, filters, context) {
    const normalized = normalizeFilters(filters);
    const ctx = context && typeof context === 'object' ? context : {};
    const requirementContext = ctx.requirementContext || ctx.termRequirementContext || null;
    const plannedState = plannedStateForTarget(candidate, requirementContext);
    const offering = offeringState(candidate, ctx.offeredCourseCodes);
    const offeringHistoryOptions = Object.assign(
      {},
      ctx.offeringHistoryOptions && typeof ctx.offeringHistoryOptions === 'object'
        ? ctx.offeringHistoryOptions : {},
    );
    if (!offeringHistoryOptions.referenceTermCode) {
      offeringHistoryOptions.referenceTermCode = ctx.referenceTermCode || ctx.currentTermCode || (() => {
        try { return typeof window !== 'undefined' ? window.currentTermCode : ''; } catch (_) { return ''; }
      })();
    }
    const offeringHistory = offeringHistoryForCandidate(
      candidate,
      ctx.courseInfoByCode,
      offeringHistoryOptions,
    );
    const requirements = (() => {
      if (!normalized.checkPrerequisites) return null;
      try {
        const shared = (typeof window !== 'undefined') ? window.courseRequisites : null;
        if (!shared || typeof shared.evaluateCandidateForTerm !== 'function') {
          return {
            known: false,
            status: 'unknown',
            reason: 'requirements-engine-unavailable',
            courseCode: normalizeCourseCode(candidate && candidate.code),
            hasRequirements: false,
            prerequisite: null,
            priorSuRequirement: null,
            corequisites: [],
            missingCorequisites: [],
          };
        }
        const code = normalizeCourseCode(candidate && candidate.code);
        const info = courseInfoFor(ctx.courseInfoByCode, code);
        return shared.evaluateCandidateForTerm(info, code, requirementContext);
      } catch (_) {
        return {
          known: false,
          status: 'unknown',
          reason: 'requirements-evaluation-failed',
          courseCode: normalizeCourseCode(candidate && candidate.code),
          hasRequirements: false,
          prerequisite: null,
          priorSuRequirement: null,
          corequisites: [],
          missingCorequisites: [],
        };
      }
    })();

    const matches = {
      search: matchesSearch(candidate, normalized.query),
      program: matchesProgram(candidate, normalized.program),
      category: matchesCategory(candidate, normalized.category, normalized.program),
      level: matchesLevel(candidate, normalized.level),
      numeric: matchesNumeric(candidate, normalized),
      planned: !normalized.hideTaken || !(plannedState.hasEarlier || plannedState.hasSameTerm),
      offering: !normalized.offeredOnly || offering.state !== 'not-offered',
      prerequisites: !(
        normalized.checkPrerequisites
        && !normalized.showUnmetPrerequisites
        && candidateRequirementIsBlocking(requirements)
      ),
    };
    const reasons = Object.keys(matches).filter((key) => matches[key] === false);
    return {
      candidate,
      visible: reasons.length === 0,
      matches,
      plannedState,
      offering,
      offeringHistory,
      requirements,
      reasons,
    };
  }

  function evaluateCandidates(candidates, filters, context) {
    const rows = Array.isArray(candidates) ? candidates : [];
    return rows.map((candidate) => evaluateCandidate(candidate, filters, context));
  }

  function filterCandidates(candidates, filters, context) {
    return evaluateCandidates(candidates, filters, context)
      .filter((evaluation) => evaluation.visible);
  }

  // Smart Sort first groups visible courses by whether they are actionable in
  // the destination term, then applies the curriculum score. Unknown/review
  // data deliberately stays in the ready bucket (fail open), and missing
  // corequisites remain advisory just like the prerequisite filter itself.
  function candidateRequirementIsBlocking(requirements) {
    if (!requirements || typeof requirements !== 'object') return false;
    const supplemental = requirements.supplemental;
    if (supplemental && supplemental.hasRule) {
      return requirements.filterBlocking === true
        || supplemental.definitiveUnmet === true;
    }
    return !!(requirements.prerequisite || requirements.priorSuRequirement);
  }

  function candidateActionabilityRank(evaluation, filters) {
    const normalized = normalizeFilters(filters);
    const row = evaluation && typeof evaluation === 'object' ? evaluation : {};
    return Object.freeze({
      prerequisiteBlocked: normalized.checkPrerequisites
        && candidateRequirementIsBlocking(row.requirements) ? 1 : 0,
      notOffered: row.offering && row.offering.state === 'not-offered' ? 1 : 0,
    });
  }

  function compareCandidateActionability(left, right, filters) {
    const a = candidateActionabilityRank(left, filters);
    const b = candidateActionabilityRank(right, filters);
    if (a.prerequisiteBlocked !== b.prerequisiteBlocked) {
      return a.prerequisiteBlocked - b.prerequisiteBlocked;
    }
    return a.notOffered - b.notOffered;
  }

  function countActiveFilters(filters) {
    const normalized = normalizeFilters(filters);
    let count = 0;
    if (normalized.program) count++;
    if (normalized.category) count++;
    if (normalized.level !== null) count++;
    if (normalized.minSu !== null) count++;
    if (normalized.minEcts !== null) count++;
    if (normalized.minBasicScience !== null) count++;
    if (normalized.minEngineering !== null) count++;
    if (normalized.hideTaken) count++;
    if (normalized.offeredOnly) count++;
    if (normalized.checkPrerequisites && !normalized.showUnmetPrerequisites) count++;
    return count;
  }

  function buildTargetContext(curriculum, targetSemester) {
    try {
      const shared = (typeof window !== 'undefined') ? window.courseRequisites : null;
      if (!shared || typeof shared.buildTermRequirementContext !== 'function') return null;
      const cur = curriculum && typeof curriculum === 'object' ? curriculum : {};
      const eligible = (course) => (
        typeof cur.isDegreeEligibleCourse !== 'function'
        || cur.isDegreeEligibleCourse(course)
      );
      const context = shared.buildTermRequirementContext(cur.semesters, targetSemester, eligible);
      if (context && typeof context === 'object') {
        // The picker's visual Program filter must not alter academic rule
        // evaluation.  Always provide every canonical selected-program profile.
        context.programProfiles = buildProgramProfiles(cur);
      }
      return context;
    } catch (_) {
      return null;
    }
  }

  const api = {
    normalizeCourseCode,
    normalizeCategory,
    normalizeProgram,
    normalizeLevel,
    normalizeFilters,
    courseLevelForCode,
    buildCandidates,
    buildProgramProfiles,
    supplementalGuidanceItems,
    buildTargetContext,
    membershipsForProgram,
    matchesSearch,
    matchesProgram,
    matchesCategory,
    matchesLevel,
    matchesNumeric,
    plannedStateForTarget,
    offeringState,
    deriveOfferingPattern,
    offeringHistoryForCandidate,
    contextualOfferingAdvisories,
    evaluateCandidate,
    evaluateCandidates,
    filterCandidates,
    candidateRequirementIsBlocking,
    candidateActionabilityRank,
    compareCandidateActionability,
    countActiveFilters,
  };

  if (typeof window !== 'undefined') window.courseFilters = Object.freeze(api);
})();
