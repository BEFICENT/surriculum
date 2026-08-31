// Strict, side-effect-free normalization for imported plan data.
(function installPlanImportValidation(root) {
  'use strict';

  function createPlanImportValidation(context) {
    const deps = context || {};
    const {
      planExportVersion: PLAN_EXPORT_VERSION,
      maxPlans: MAX_PLANS,
      normalizePlanName,
      canonicalTermCodeFromLabel,
    } = deps;

  const IMPORT_MAX_FILE_BYTES = 2 * 1024 * 1024;
  const IMPORT_MAX_SEMESTERS = 80;
  const IMPORT_MAX_COURSES_PER_SEMESTER = 100;
  const IMPORT_MAX_CUSTOM_COURSES = 2000;
  const IMPORT_MAX_SCHEDULER_TERMS = 40;
  const IMPORT_MAX_SELECTED_SECTIONS = 200;
  const IMPORT_MAX_BLOCKED_RANGES = 100;
  const IMPORT_MAX_SCHEDULES_PER_TERM = 10;
  const IMPORT_MAX_SCHEDULE_NAME_LENGTH = 200;
  const IMPORT_MAX_SNAPSHOT_TEXT_LENGTH = 4000;
  const IMPORT_MAX_GLOBAL_COURSE_METADATA = 2000;
  const IMPORT_COURSE_TYPES = new Set([
    'core', 'area', 'university', 'free', 'required', 'none', 'unknown',
  ]);
  const IMPORT_LANGUAGE_LEVELS = new Set(['', 'basic', 'other']);
  const IMPORT_FACULTIES = new Set(['', 'FENS', 'FASS', 'SBS', 'SL']);
  const IMPORT_GRADES = new Set(['', 'S', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'F', 'T', 'P', 'I', 'U', 'W', 'NA']);
  const IMPORT_GRADING_BASES = new Set(['unknown', 'letter', 'satisfactory']);
  const IMPORT_STATE_FIELDS = new Set([
    'major', 'doubleMajor',
    'entryTerm', 'entryTermDM',
    'entryTermMinor', 'entryTermMinor1', 'entryTermMinor2', 'entryTermMinor3',
    'minor1', 'minor2', 'minor3',
    'schedulerSelectedTerm',
    'curriculum', 'grades', 'gradingBases', 'dates', 'termCodes', 'customCourses', 'schedulerStates',
    'globalCourseMetadata',
  ]);

  function importError(path, message) {
    throw new Error(`Invalid plan data at ${path}: ${message}.`);
  }

  function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  }

  function requirePlainObject(value, path) {
    if (!isPlainObject(value)) importError(path, 'expected an object');
    return value;
  }

  function requireKnownFields(value, allowed, path) {
    Object.keys(value).forEach((key) => {
      if (!allowed.has(key)) importError(path, `unknown field "${String(key).slice(0, 80)}"`);
    });
  }

  function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
  }

  function normalizeImportedText(value, path, options) {
    const opts = options || {};
    if (typeof value !== 'string') importError(path, 'expected text');
    if (/\u0000|[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) {
      importError(path, 'contains unsupported control characters');
    }
    let normalized = opts.collapseWhitespace ? value.trim().replace(/\s+/g, ' ') : value.trim();
    const maxLength = Number.isInteger(opts.maxLength) ? opts.maxLength : 120;
    if (!opts.allowEmpty && !normalized) importError(path, 'must not be empty');
    if (normalized.length > maxLength) {
      if (opts.truncate) normalized = normalized.slice(0, maxLength);
      else importError(path, `must be at most ${maxLength} characters`);
    }
    return normalized;
  }

  function normalizeProgramCode(value, path) {
    const normalized = normalizeImportedText(value, path, { maxLength: 16 }).toUpperCase();
    if (!/^[A-Z][A-Z0-9]{1,15}$/.test(normalized)) importError(path, 'has an invalid program code');
    return normalized;
  }

  function normalizeMinorCode(value, path) {
    const normalized = normalizeImportedText(value, path, { maxLength: 48 }).toUpperCase();
    if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(normalized)) importError(path, 'has an invalid minor code');
    return normalized;
  }

  // Custom-course definitions are scoped by the selected program code. That
  // namespace includes both ordinary major codes (CS, IE, …) and hyphenated
  // minor codes (ANALY-MINOR, FIN-MINOR, …), so it cannot use the stricter
  // major-only validator.
  function normalizeCustomCourseProgramCode(value, path) {
    return normalizeMinorCode(value, path);
  }

  function normalizeCourseCode(value, path) {
    if (typeof value !== 'string') importError(path, 'expected a course code');
    const normalized = value.toUpperCase().replace(/\s+/g, '');
    if (!/^[A-Z]{1,12}\d{1,6}[A-Z0-9]{0,3}$/.test(normalized)) importError(path, 'has an invalid course code');
    return normalized;
  }

  function normalizeTermName(value, path) {
    const normalized = normalizeImportedText(value, path, { maxLength: 32, collapseWhitespace: true });
    if (!/^(Fall|Spring|Summer) \d{4}-\d{4}$/.test(normalized)) importError(path, 'has an invalid academic term');
    return normalized;
  }

  function normalizeTermCode(value, path) {
    const normalized = normalizeImportedText(value, path, { maxLength: 6 });
    if (!/^\d{4}(01|02|03)$/.test(normalized)) importError(path, 'has an invalid term code');
    return normalized;
  }

  function normalizeFiniteNumber(value, path, maxValue) {
    let raw = value;
    if (typeof raw === 'string') {
      raw = raw.trim().replace(',', '.');
      if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw)) importError(path, 'expected a non-negative number');
    } else if (typeof raw !== 'number') {
      importError(path, 'expected a non-negative number');
    }
    const number = Number(raw);
    if (!Number.isFinite(number) || number < 0 || number > maxValue) {
      importError(path, `must be between 0 and ${maxValue}`);
    }
    return Object.is(number, -0) ? 0 : number;
  }

  function normalizeIsoTimestamp(value, path) {
    if (value === null) return null;
    const normalized = normalizeImportedText(value, path, { maxLength: 40 });
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(normalized)
        || !Number.isFinite(Date.parse(normalized))) {
      importError(path, 'has an invalid timestamp');
    }
    return normalized;
  }

  function validateCurriculum(value, path) {
    if (value === null) return null;
    if (!Array.isArray(value)) importError(path, 'expected an array of semesters');
    if (value.length > IMPORT_MAX_SEMESTERS) importError(path, `supports at most ${IMPORT_MAX_SEMESTERS} semesters`);
    let totalCourses = 0;
    return value.map((semester, semesterIndex) => {
      const semesterPath = `${path}[${semesterIndex}]`;
      if (!Array.isArray(semester)) importError(semesterPath, 'expected an array of course codes');
      if (semester.length > IMPORT_MAX_COURSES_PER_SEMESTER) {
        importError(semesterPath, `supports at most ${IMPORT_MAX_COURSES_PER_SEMESTER} courses`);
      }
      totalCourses += semester.length;
      if (totalCourses > IMPORT_MAX_CUSTOM_COURSES) importError(path, 'contains too many courses');
      return semester.map((courseCode, courseIndex) => normalizeCourseCode(courseCode, `${semesterPath}[${courseIndex}]`));
    });
  }

  function validateGrades(value, curriculum, path) {
    if (value === null) return null;
    if (!Array.isArray(value)) importError(path, 'expected an array of semesters');
    if (!Array.isArray(curriculum)) {
      if (value.length === 0) return [];
      importError(path, 'requires curriculum data');
    }
    if (value.length !== curriculum.length) importError(path, 'must have one entry per curriculum semester');
    return value.map((semester, semesterIndex) => {
      const semesterPath = `${path}[${semesterIndex}]`;
      if (!Array.isArray(semester)) importError(semesterPath, 'expected an array of grades');
      if (semester.length !== curriculum[semesterIndex].length) {
        importError(semesterPath, 'must have one grade per course');
      }
      return semester.map((grade, gradeIndex) => {
        if (typeof grade !== 'string') importError(`${semesterPath}[${gradeIndex}]`, 'expected a grade');
        const policy = (typeof window !== 'undefined' && window.gradePolicy) ? window.gradePolicy : null;
        let normalized = policy && typeof policy.normalizeGrade === 'function'
          ? policy.normalizeGrade(grade)
          : grade.trim().toUpperCase();
        if (!policy && normalized === 'REGISTERED') normalized = '';
        if (normalized === null || !IMPORT_GRADES.has(normalized)) {
          importError(`${semesterPath}[${gradeIndex}]`, 'has an unsupported grade');
        }
        return normalized;
      });
    });
  }

  function validateGradingBases(value, curriculum, path) {
    if (value === null) return null;
    if (!Array.isArray(value)) importError(path, 'expected an array of semesters');
    if (!Array.isArray(curriculum)) {
      if (value.length === 0) return [];
      importError(path, 'requires curriculum data');
    }
    if (value.length !== curriculum.length) importError(path, 'must have one entry per curriculum semester');
    return value.map((semester, semesterIndex) => {
      const semesterPath = `${path}[${semesterIndex}]`;
      if (!Array.isArray(semester)) importError(semesterPath, 'expected an array of grading bases');
      if (semester.length !== curriculum[semesterIndex].length) {
        importError(semesterPath, 'must have one grading basis per course');
      }
      return semester.map((basis, basisIndex) => {
        if (typeof basis !== 'string') importError(`${semesterPath}[${basisIndex}]`, 'expected a grading basis');
        const raw = basis.trim().toLowerCase() || 'unknown';
        if (!IMPORT_GRADING_BASES.has(raw)) {
          importError(`${semesterPath}[${basisIndex}]`, 'has an unsupported grading basis');
        }
        const policy = (typeof window !== 'undefined' && window.gradePolicy) ? window.gradePolicy : null;
        const normalized = policy && typeof policy.normalizeGradingBasis === 'function'
          ? policy.normalizeGradingBasis(raw)
          : raw;
        return normalized;
      });
    });
  }

  function inferImportedGradingBasis(grade, explicitBasis) {
    const policy = (typeof window !== 'undefined' && window.gradePolicy) ? window.gradePolicy : null;
    if (policy && typeof policy.inferGradingBasis === 'function') {
      return policy.inferGradingBasis(grade, explicitBasis);
    }
    const normalized = String(grade || '').trim().toUpperCase();
    if (/^(?:A|A-|B\+|B|B-|C\+|C|C-|D\+|D|F)$/.test(normalized)) return 'letter';
    if (normalized === 'S' || normalized === 'U') return 'satisfactory';
    const basis = String(explicitBasis || '').trim().toLowerCase();
    if (basis === 'letter' || basis === 'satisfactory') return basis;
    return 'unknown';
  }

  function canonicalizeGradingBases(curriculum, grades, gradingBases) {
    if (!Array.isArray(curriculum)) return null;
    return curriculum.map((semester, semesterIndex) =>
      semester.map((_, courseIndex) => {
        const grade = Array.isArray(grades) && Array.isArray(grades[semesterIndex])
          ? grades[semesterIndex][courseIndex] : '';
        const explicitBasis = Array.isArray(gradingBases)
          && Array.isArray(gradingBases[semesterIndex])
          ? gradingBases[semesterIndex][courseIndex] : 'unknown';
        return inferImportedGradingBasis(grade, explicitBasis);
      }));
  }

  function synthesizeGradingBases(curriculum, grades) {
    return canonicalizeGradingBases(curriculum, grades, null);
  }

  function validateDates(value, curriculum, path) {
    if (value === null) return null;
    if (!Array.isArray(value)) importError(path, 'expected an array of semester labels');
    if (!Array.isArray(curriculum)) {
      if (value.length === 0) return [];
      importError(path, 'requires curriculum data');
    }
    if (value.length !== curriculum.length) importError(path, 'must have one label per curriculum semester');
    return value.map((label, index) => normalizeImportedText(label, `${path}[${index}]`, {
      maxLength: 80,
      collapseWhitespace: true,
    }));
  }

  function validateTermCodes(value, curriculum, path) {
    if (value === null) return null;
    if (!Array.isArray(value)) importError(path, 'expected an array of semester term codes');
    if (!Array.isArray(curriculum)) {
      if (value.length === 0) return [];
      importError(path, 'requires curriculum data');
    }
    if (value.length !== curriculum.length) importError(path, 'must have one code per curriculum semester');
    return value.map((code, index) => {
      if (typeof code !== 'string') importError(`${path}[${index}]`, 'expected a term code');
      const normalized = code.trim();
      if (!normalized) return '';
      return normalizeTermCode(normalized, `${path}[${index}]`);
    });
  }

  function validateGlobalCourseMetadataItem(raw, itemPath) {
    const item = requirePlainObject(raw, itemPath);
    requireKnownFields(item, new Set(['code', 'title', 'suCredits', 'ects']), itemPath);
    ['code', 'title', 'suCredits', 'ects'].forEach((field) => {
      if (!hasOwn(item, field)) importError(`${itemPath}.${field}`, 'is required');
    });
    return {
      code: normalizeCourseCode(item.code, `${itemPath}.code`),
      title: normalizeImportedText(item.title, `${itemPath}.title`, {
        maxLength: 200,
        collapseWhitespace: true,
        truncate: true,
      }),
      suCredits: normalizeFiniteNumber(item.suCredits, `${itemPath}.suCredits`, 100),
      ects: normalizeFiniteNumber(item.ects, `${itemPath}.ects`, 100),
    };
  }

  function validateGlobalCourseMetadata(value, path) {
    if (value === null) return [];
    if (!Array.isArray(value)) importError(path, 'expected an array');
    if (value.length > IMPORT_MAX_GLOBAL_COURSE_METADATA) {
      importError(path, `supports at most ${IMPORT_MAX_GLOBAL_COURSE_METADATA} courses`);
    }
    const seen = new Set();
    return value.map((raw, index) => {
      const itemPath = `${path}[${index}]`;
      const item = validateGlobalCourseMetadataItem(raw, itemPath);
      if (seen.has(item.code)) importError(itemPath, 'contains a duplicate course code');
      seen.add(item.code);
      return item;
    });
  }

  // Stored state can be damaged by an interrupted/manual localStorage edit.
  // Imports remain atomic and strict, but reads salvage independent valid rows
  // so one bad snapshot cannot erase every unrelated global transcript course.
  function salvageStoredGlobalCourseMetadata(value, path) {
    if (!Array.isArray(value)) return [];
    const out = [];
    const seen = new Set();
    let ignored = Math.max(0, value.length - IMPORT_MAX_GLOBAL_COURSE_METADATA);
    value.slice(0, IMPORT_MAX_GLOBAL_COURSE_METADATA).forEach((raw, index) => {
      try {
        const item = validateGlobalCourseMetadataItem(raw, `${path}[${index}]`);
        if (seen.has(item.code)) {
          ignored++;
          return;
        }
        seen.add(item.code);
        out.push(item);
      } catch (_) {
        ignored++;
      }
    });
    if (ignored) {
      try { console.warn(`Ignored ${ignored} invalid stored global course metadata row(s).`); } catch (_) {}
    }
    return out;
  }

  function validateCustomCourse(value, path) {
    const course = requirePlainObject(value, path);
    requireKnownFields(course, new Set([
      'Major', 'Code', 'Course_Name', 'ECTS', 'Engineering', 'Basic_Science',
      'SU_credit', 'Faculty', 'Faculty_Course', 'EL_Type', 'Language_Level',
    ]), path);

    if (!hasOwn(course, 'Major')) importError(`${path}.Major`, 'is required');
    if (!hasOwn(course, 'Code')) importError(`${path}.Code`, 'is required');
    const major = normalizeImportedText(course.Major, `${path}.Major`, { maxLength: 12 }).toUpperCase();
    const code = normalizeImportedText(course.Code, `${path}.Code`, { maxLength: 9 }).toUpperCase();
    const combined = normalizeCourseCode(major + code, path);
    const majorMatch = combined.match(/^([A-Z]{1,12})(\d[A-Z0-9]*)$/);
    if (!majorMatch || majorMatch[1] !== major || majorMatch[2] !== code) importError(path, 'has inconsistent course-code fields');

    const name = hasOwn(course, 'Course_Name')
      ? normalizeImportedText(course.Course_Name, `${path}.Course_Name`, {
          maxLength: 200,
          collapseWhitespace: true,
          truncate: true,
        })
      : combined;
    const ects = hasOwn(course, 'ECTS') ? normalizeFiniteNumber(course.ECTS, `${path}.ECTS`, 100) : 0;
    const engineering = hasOwn(course, 'Engineering') ? normalizeFiniteNumber(course.Engineering, `${path}.Engineering`, 100) : 0;
    const basicScience = hasOwn(course, 'Basic_Science') ? normalizeFiniteNumber(course.Basic_Science, `${path}.Basic_Science`, 100) : 0;
    const suCredit = hasOwn(course, 'SU_credit') ? normalizeFiniteNumber(course.SU_credit, `${path}.SU_credit`, 100) : 0;

    let faculty = '';
    if (hasOwn(course, 'Faculty')) {
      if (typeof course.Faculty !== 'string') importError(`${path}.Faculty`, 'expected text');
      const candidate = course.Faculty.trim().toUpperCase();
      faculty = IMPORT_FACULTIES.has(candidate) ? candidate : '';
    }

    let courseType = 'none';
    if (hasOwn(course, 'EL_Type')) {
      if (typeof course.EL_Type !== 'string') importError(`${path}.EL_Type`, 'expected text');
      const candidate = course.EL_Type.trim().toLowerCase();
      // Old exports could contain a free-form category. Keep the course but
      // fail closed by assigning it to no graduation bucket.
      courseType = IMPORT_COURSE_TYPES.has(candidate) ? candidate : 'none';
    }

    if (hasOwn(course, 'Faculty_Course') && typeof course.Faculty_Course !== 'string') {
      importError(`${path}.Faculty_Course`, 'expected text');
    }

    let languageLevel = '';
    if (hasOwn(course, 'Language_Level')) {
      if (typeof course.Language_Level !== 'string') {
        importError(`${path}.Language_Level`, 'expected text');
      }
      languageLevel = course.Language_Level.trim().toLowerCase();
      if (!IMPORT_LANGUAGE_LEVELS.has(languageLevel)) {
        importError(`${path}.Language_Level`, 'expected "basic", "other", or an empty value');
      }
    }

    const normalized = {
      Major: major,
      Code: code,
      Course_Name: name,
      ECTS: String(ects),
      Engineering: engineering,
      Basic_Science: basicScience,
      SU_credit: String(suCredit),
      Faculty: faculty,
      // User-defined courses cannot claim membership in the catalog's faculty
      // course pool, even if an imported file says otherwise.
      Faculty_Course: 'No',
      EL_Type: courseType,
    };
    // Absence and an empty string both mean "not reviewed yet". Omitting that
    // state keeps legacy/non-language custom-course exports unchanged while a
    // reviewed language course carries an explicit, validated classification.
    if (languageLevel) normalized.Language_Level = languageLevel;
    return normalized;
  }

  function validateCustomCourses(value, path) {
    if (value === null) return {};
    const map = requirePlainObject(value, path);
    const programs = Object.keys(map);
    if (programs.length > 40) importError(path, 'contains too many program groups');
    let totalCourses = 0;
    const out = {};
    programs.forEach((programKey) => {
      const program = normalizeCustomCourseProgramCode(programKey, `${path}.${String(programKey).slice(0, 80)}`);
      if (hasOwn(out, program)) importError(path, 'contains duplicate normalized program codes');
      const list = map[programKey];
      if (!Array.isArray(list)) importError(`${path}.${program}`, 'expected an array of custom courses');
      totalCourses += list.length;
      if (totalCourses > IMPORT_MAX_CUSTOM_COURSES) importError(path, `supports at most ${IMPORT_MAX_CUSTOM_COURSES} custom courses`);
      out[program] = list.map((course, index) => validateCustomCourse(course, `${path}.${program}[${index}]`));
    });
    return out;
  }

  function validateSelectedSections(value, path) {
    if (value === undefined || value === null) return {};
    const selected = requirePlainObject(value, path);
    const keys = Object.keys(selected);
    if (keys.length > IMPORT_MAX_SELECTED_SECTIONS) importError(path, 'contains too many selected sections');
    const out = {};
    keys.forEach((key) => {
      const courseCode = normalizeCourseCode(key, `${path}.${String(key).slice(0, 80)}`);
      if (hasOwn(out, courseCode)) importError(path, 'contains duplicate normalized course codes');
      const entryPath = `${path}.${courseCode}`;
      const entry = requirePlainObject(selected[key], entryPath);
      requireKnownFields(entry, new Set(['course_id', 'crn']), entryPath);
      const entryCode = normalizeCourseCode(entry.course_id, `${entryPath}.course_id`);
      if (entryCode !== courseCode) importError(`${entryPath}.course_id`, 'must match its selected-course key');
      const crn = normalizeImportedText(entry.crn, `${entryPath}.crn`, { maxLength: 12 });
      if (!/^\d{1,12}$/.test(crn)) importError(`${entryPath}.crn`, 'has an invalid CRN');
      out[courseCode] = { course_id: courseCode, crn };
    });
    return out;
  }

  function validateBlockedRanges(value, path) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) importError(path, 'expected an array of blocked ranges');
    if (value.length > IMPORT_MAX_BLOCKED_RANGES) importError(path, 'contains too many blocked ranges');
    return value.map((item, index) => {
      const itemPath = `${path}[${index}]`;
      const block = requirePlainObject(item, itemPath);
      requireKnownFields(block, new Set(['id', 'dayKey', 'start', 'end']), itemPath);
      const id = normalizeImportedText(block.id, `${itemPath}.id`, { maxLength: 100 });
      if (!/^[A-Za-z0-9._-]+$/.test(id)) importError(`${itemPath}.id`, 'has invalid characters');
      const dayKey = normalizeImportedText(block.dayKey, `${itemPath}.dayKey`, { maxLength: 1 }).toUpperCase();
      if (!/^[MTWRFSU]$/.test(dayKey)) importError(`${itemPath}.dayKey`, 'has an invalid day');
      const start = normalizeFiniteNumber(block.start, `${itemPath}.start`, 1440);
      const end = normalizeFiniteNumber(block.end, `${itemPath}.end`, 1440);
      if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) {
        importError(itemPath, 'must contain increasing whole-minute bounds');
      }
      return { id, dayKey, start, end };
    });
  }

  function validateSchedulerUi(value, path) {
    if (value === undefined || value === null) return {};
    const ui = requirePlainObject(value, path);
    const allowed = new Set(['planCollapsed', 'selectedCollapsed', 'blockedCollapsed', 'sidebarCollapsed']);
    requireKnownFields(ui, allowed, path);
    const out = {};
    Object.keys(ui).forEach((key) => {
      if (typeof ui[key] !== 'boolean') importError(`${path}.${key}`, 'expected true or false');
      out[key] = ui[key];
    });
    return out;
  }

  function normalizeScheduleId(value, path) {
    const id = normalizeImportedText(value, path, { maxLength: 100 });
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)
        || ['__proto__', 'prototype', 'constructor'].includes(id.toLowerCase())) {
      importError(path, 'has invalid characters');
    }
    return id;
  }

  function validateScheduleEntry(value, expectedId, path) {
    const entry = requirePlainObject(value, path);
    requireKnownFields(entry, new Set(['id', 'name', 'selected', 'blocked', 'ui']), path);
    const id = normalizeScheduleId(entry.id, `${path}.id`);
    if (id !== expectedId) importError(`${path}.id`, 'must match its schedule key');
    return {
      id,
      name: normalizeImportedText(entry.name, `${path}.name`, {
        maxLength: IMPORT_MAX_SCHEDULE_NAME_LENGTH,
        collapseWhitespace: true,
        truncate: true,
      }),
      selected: validateSelectedSections(entry.selected, `${path}.selected`),
      blocked: validateBlockedRanges(entry.blocked, `${path}.blocked`),
      ui: validateSchedulerUi(entry.ui, `${path}.ui`),
    };
  }

  function validateSchedules(value, path) {
    const schedules = requirePlainObject(value, path);
    requireKnownFields(schedules, new Set(['activeId', 'order', 'items']), path);
    if (!Array.isArray(schedules.order) || schedules.order.length < 1
        || schedules.order.length > IMPORT_MAX_SCHEDULES_PER_TERM) {
      importError(`${path}.order`, `must contain 1-${IMPORT_MAX_SCHEDULES_PER_TERM} schedule IDs`);
    }
    const order = schedules.order.map((id, index) => normalizeScheduleId(id, `${path}.order[${index}]`));
    if (new Set(order).size !== order.length) importError(`${path}.order`, 'contains duplicate schedule IDs');
    const activeId = normalizeScheduleId(schedules.activeId, `${path}.activeId`);
    if (!order.includes(activeId)) importError(`${path}.activeId`, 'must identify an ordered schedule');
    const items = requirePlainObject(schedules.items, `${path}.items`);
    const itemKeys = Object.keys(items);
    if (itemKeys.length !== order.length || itemKeys.some((id) => !order.includes(id))) {
      importError(`${path}.items`, 'must exactly match the ordered schedules');
    }
    const normalizedItems = {};
    order.forEach((id) => {
      normalizedItems[id] = validateScheduleEntry(items[id], id, `${path}.items.${id}`);
    });
    return { activeId, order, items: normalizedItems };
  }

  function validateScheduleSnapshots(value, path) {
    if (value === undefined || value === null) return {};
    const snapshots = requirePlainObject(value, path);
    const scheduleIds = Object.keys(snapshots);
    if (scheduleIds.length > IMPORT_MAX_SCHEDULES_PER_TERM) {
      importError(path, `supports at most ${IMPORT_MAX_SCHEDULES_PER_TERM} schedules`);
    }
    const out = {};
    scheduleIds.forEach((rawScheduleId) => {
      const scheduleId = normalizeScheduleId(rawScheduleId, `${path}.${String(rawScheduleId).slice(0, 80)}`);
      if (hasOwn(out, scheduleId)) importError(path, 'contains duplicate normalized schedule IDs');
      const schedulePath = `${path}.${scheduleId}`;
      const courseSnapshots = requirePlainObject(snapshots[rawScheduleId], schedulePath);
      const courseCodes = Object.keys(courseSnapshots);
      if (courseCodes.length > IMPORT_MAX_SELECTED_SECTIONS) {
        importError(schedulePath, 'contains too many section snapshots');
      }
      const normalizedCourseSnapshots = {};
      courseCodes.forEach((rawCourseCode) => {
        const courseCode = normalizeCourseCode(rawCourseCode, `${schedulePath}.${String(rawCourseCode).slice(0, 80)}`);
        if (hasOwn(normalizedCourseSnapshots, courseCode)) {
          importError(schedulePath, 'contains duplicate normalized course codes');
        }
        const snapshotPath = `${schedulePath}.${courseCode}`;
        const snapshot = requirePlainObject(courseSnapshots[rawCourseCode], snapshotPath);
        requireKnownFields(snapshot, new Set([
          'crn', 'meetingKey', 'instrKey', 'meetingSummary', 'instrSummary',
        ]), snapshotPath);
        if (!hasOwn(snapshot, 'crn')) importError(`${snapshotPath}.crn`, 'is required');
        const crn = normalizeImportedText(snapshot.crn, `${snapshotPath}.crn`, { maxLength: 12 });
        if (!/^\d{1,12}$/.test(crn)) importError(`${snapshotPath}.crn`, 'has an invalid CRN');
        const textField = (key) => hasOwn(snapshot, key)
          ? normalizeImportedText(snapshot[key], `${snapshotPath}.${key}`, {
              allowEmpty: true,
              maxLength: IMPORT_MAX_SNAPSHOT_TEXT_LENGTH,
            })
          : '';
        normalizedCourseSnapshots[courseCode] = {
          crn,
          meetingKey: textField('meetingKey'),
          instrKey: textField('instrKey'),
          meetingSummary: textField('meetingSummary'),
          instrSummary: textField('instrSummary'),
        };
      });
      out[scheduleId] = normalizedCourseSnapshots;
    });
    return out;
  }

  function validateSchedulerState(value, path) {
    const state = requirePlainObject(value, path);
    requireKnownFields(state, new Set([
      'selected', 'blocked', 'ui', 'schedules', 'lastSeenScheduleSnapshots',
    ]), path);
    const legacySelected = validateSelectedSections(state.selected, `${path}.selected`);
    const legacyBlocked = validateBlockedRanges(state.blocked, `${path}.blocked`);
    const legacyUi = validateSchedulerUi(state.ui, `${path}.ui`);
    const snapshots = hasOwn(state, 'lastSeenScheduleSnapshots')
      ? validateScheduleSnapshots(state.lastSeenScheduleSnapshots, `${path}.lastSeenScheduleSnapshots`)
      : undefined;
    if (!hasOwn(state, 'schedules') || state.schedules === null) {
      const legacy = { selected: legacySelected, blocked: legacyBlocked, ui: legacyUi };
      if (snapshots !== undefined) legacy.lastSeenScheduleSnapshots = snapshots;
      return legacy;
    }
    const schedules = validateSchedules(state.schedules, `${path}.schedules`);
    const active = schedules.items[schedules.activeId];
    const normalized = {
      schedules,
      // Canonicalize the legacy mirror to the validated active schedule.
      selected: active.selected,
      blocked: active.blocked,
      ui: active.ui,
    };
    if (snapshots !== undefined) normalized.lastSeenScheduleSnapshots = snapshots;
    return normalized;
  }

  function validateSchedulerStates(value, path) {
    if (value === null) return {};
    const states = requirePlainObject(value, path);
    const terms = Object.keys(states);
    if (terms.length > IMPORT_MAX_SCHEDULER_TERMS) importError(path, 'contains too many scheduler terms');
    const out = {};
    terms.forEach((termKey) => {
      const term = normalizeTermCode(termKey, `${path}.${String(termKey).slice(0, 80)}`);
      if (hasOwn(out, term)) importError(path, 'contains duplicate normalized term codes');
      out[term] = validateSchedulerState(states[termKey], `${path}.${term}`);
    });
    return out;
  }

  function validatePlanState(value, path, fileVersion) {
    if (value === undefined || value === null) return {};
    const state = requirePlainObject(value, path);
    const allowedFields = new Set(Array.from(IMPORT_STATE_FIELDS).filter((field) => {
      if (field === 'gradingBases') return fileVersion >= 2;
      if (field === 'globalCourseMetadata') return fileVersion >= 3;
      if (field === 'termCodes') return fileVersion >= 4;
      return true;
    }));
    requireKnownFields(state, allowedFields, path);
    const out = {};

    const programFields = ['major', 'doubleMajor'];
    programFields.forEach((key) => {
      if (hasOwn(state, key) && state[key] !== null && state[key] !== '') {
        out[key] = normalizeProgramCode(state[key], `${path}.${key}`);
      }
    });
    const termFields = ['entryTerm', 'entryTermDM', 'entryTermMinor', 'entryTermMinor1', 'entryTermMinor2', 'entryTermMinor3'];
    termFields.forEach((key) => {
      if (hasOwn(state, key) && state[key] !== null && state[key] !== '') {
        out[key] = normalizeTermName(state[key], `${path}.${key}`);
      }
    });
    ['minor1', 'minor2', 'minor3'].forEach((key) => {
      if (hasOwn(state, key) && state[key] !== null && state[key] !== '') {
        out[key] = normalizeMinorCode(state[key], `${path}.${key}`);
      }
    });
    if (hasOwn(state, 'schedulerSelectedTerm') && state.schedulerSelectedTerm !== null && state.schedulerSelectedTerm !== '') {
      out.schedulerSelectedTerm = normalizeTermCode(state.schedulerSelectedTerm, `${path}.schedulerSelectedTerm`);
    }

    const curriculum = hasOwn(state, 'curriculum') ? validateCurriculum(state.curriculum, `${path}.curriculum`) : undefined;
    if (curriculum !== undefined) out.curriculum = curriculum;
    if (hasOwn(state, 'grades')) out.grades = validateGrades(state.grades, curriculum, `${path}.grades`);
    if (fileVersion >= 2 && hasOwn(state, 'gradingBases') && state.gradingBases !== null) {
      const suppliedBases = validateGradingBases(state.gradingBases, curriculum, `${path}.gradingBases`);
      // A decisive A–F or S/U grade is the source of truth if stale metadata
      // disagrees with it. Ambiguous grades such as NA retain the supplied basis.
      out.gradingBases = canonicalizeGradingBases(curriculum, out.grades, suppliedBases);
    } else if (Array.isArray(curriculum)) {
      out.gradingBases = synthesizeGradingBases(curriculum, out.grades);
    }
    if (hasOwn(state, 'dates')) out.dates = validateDates(state.dates, curriculum, `${path}.dates`);
    if (fileVersion >= 4 && hasOwn(state, 'termCodes')) {
      out.termCodes = validateTermCodes(state.termCodes, curriculum, `${path}.termCodes`);
      if (Array.isArray(out.dates)) {
        out.termCodes.forEach((code, index) => {
          const derived = canonicalTermCodeFromLabel(out.dates[index]);
          if (code && derived && code !== derived) {
            importError(`${path}.termCodes[${index}]`, 'conflicts with the semester label');
          }
        });
      }
    } else if (Array.isArray(curriculum) && Array.isArray(out.dates)) {
      out.termCodes = out.dates.map(canonicalTermCodeFromLabel);
    }
    if (hasOwn(state, 'customCourses')) out.customCourses = validateCustomCourses(state.customCourses, `${path}.customCourses`);
    if (hasOwn(state, 'schedulerStates')) out.schedulerStates = validateSchedulerStates(state.schedulerStates, `${path}.schedulerStates`);
    if (fileVersion >= 3 && hasOwn(state, 'globalCourseMetadata')) {
      out.globalCourseMetadata = validateGlobalCourseMetadata(
        state.globalCourseMetadata,
        `${path}.globalCourseMetadata`,
      );
    }
    return out;
  }

  function validateImportObject(obj) {
    const root = requirePlainObject(obj, 'file');
    requireKnownFields(root, new Set(['type', 'version', 'exportedAt', 'plan']), 'file');
    if (root.type !== 'surriculum_plan' || ![1, 2, 3, PLAN_EXPORT_VERSION].includes(root.version)) {
      throw new Error('Unsupported file');
    }
    if (hasOwn(root, 'exportedAt') && root.exportedAt !== null) normalizeIsoTimestamp(root.exportedAt, 'file.exportedAt');

    const plan = requirePlainObject(root.plan, 'file.plan');
    requireKnownFields(plan, new Set(['id', 'name', 'order', 'createdAt', 'updatedAt', 'state']), 'file.plan');
    if (hasOwn(plan, 'id') && plan.id !== null) normalizeScheduleId(plan.id, 'file.plan.id');
    if (hasOwn(plan, 'order') && plan.order !== null
        && (!Number.isInteger(plan.order) || plan.order < 0 || plan.order >= MAX_PLANS)) {
      importError('file.plan.order', `must be an integer from 0 to ${MAX_PLANS - 1}`);
    }
    if (hasOwn(plan, 'createdAt')) normalizeIsoTimestamp(plan.createdAt, 'file.plan.createdAt');
    if (hasOwn(plan, 'updatedAt')) normalizeIsoTimestamp(plan.updatedAt, 'file.plan.updatedAt');

    let name = 'Imported Plan';
    if (hasOwn(plan, 'name') && plan.name !== null) {
      const rawName = normalizeImportedText(plan.name, 'file.plan.name', { maxLength: 500, collapseWhitespace: true });
      name = normalizePlanName(rawName) || 'Imported Plan';
    }
    return { name, state: validatePlanState(plan.state, 'file.plan.state', root.version) };
  }

    return Object.freeze({
      maxFileBytes: IMPORT_MAX_FILE_BYTES,
      validateImportObject,
      validateCustomCourse,
      validateCustomCourses,
      validateGlobalCourseMetadata,
      salvageStoredGlobalCourseMetadata,
      normalizeCustomCourseProgramCode,
      canonicalizeGradingBases,
      normalizeCustomCourse(course) {
        return validateCustomCourse(course, 'custom course');
      },
      normalizeCustomCourseList(program, list) {
        const programCode = normalizeCustomCourseProgramCode(
          program,
          'custom course program',
        );
        const normalized = validateCustomCourses(
          { [programCode]: list },
          'custom courses',
        );
        return normalized[programCode];
      },
    });
  }

  const namespace = root.SurriculumModules || (root.SurriculumModules = {});
  namespace.planImportValidation = Object.freeze({
    create: createPlanImportValidation,
  });
})(typeof window !== 'undefined' ? window : globalThis);
