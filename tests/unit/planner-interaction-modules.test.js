'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadScriptsGlobals, REPO_ROOT } = require('./helpers/load-script');

const globals = loadScriptsGlobals([
  'scripts/planner/course-picker-layout.js',
  'scripts/planner/course-picker-option-renderer.js',
  'scripts/planner/course-picker.js',
  'scripts/planner/course-commit.js',
  'scripts/planner/course-details-controller.js',
  'scripts/planner/grade-editor.js',
  'scripts/click.js',
]);

test('planner interaction modules preserve the dynamic_click public API', () => {
  const modules = globals.SurriculumModules;
  assert.ok(modules.plannerCoursePicker);
  assert.ok(modules.plannerCoursePickerLayout);
  assert.ok(modules.plannerCoursePickerOptionRenderer);
  assert.ok(modules.plannerCourseCommit);
  assert.ok(modules.plannerCourseDetails);
  assert.ok(modules.plannerGradeEditor);
  assert.equal(Object.isFrozen(modules.plannerCoursePicker), true);
  assert.equal(Object.isFrozen(modules.plannerCoursePickerLayout), true);
  assert.equal(Object.isFrozen(modules.plannerCoursePickerOptionRenderer), true);
  assert.equal(Object.isFrozen(modules.plannerCourseCommit), true);
  assert.equal(Object.isFrozen(modules.plannerCourseDetails), true);
  assert.equal(Object.isFrozen(modules.plannerGradeEditor), true);
  assert.equal(typeof modules.plannerCoursePicker.open, 'function');
  assert.equal(typeof modules.plannerCourseCommit.create, 'function');
  assert.equal(typeof modules.plannerCourseCommit.createBrowser, 'function');
  assert.equal(typeof modules.plannerCourseCommit.commit, 'function');
  assert.equal(typeof modules.plannerCourseDetails.create, 'function');
  assert.equal(typeof modules.plannerCourseDetails.open, 'function');
  assert.equal('createBrowser' in modules.plannerCourseDetails, false);
  assert.equal(typeof modules.plannerGradeEditor.buildGradeOptions, 'function');
  assert.equal(typeof modules.plannerGradeEditor.create, 'function');
  assert.equal(typeof modules.plannerGradeEditor.open, 'function');
  assert.equal('createBrowser' in modules.plannerGradeEditor, false);
  assert.equal(typeof globals.dynamic_click, 'function');
});

test('planner interaction modules load in dependency order before click dispatch', () => {
  const html = fs.readFileSync(path.join(REPO_ROOT, 'index.html'), 'utf8');
  const expected = [
    'scripts/planner/course-picker-layout.js',
    'scripts/planner/course-picker-option-renderer.js',
    'scripts/planner/course-picker.js',
    'scripts/planner/course-commit.js',
    'scripts/planner/course-details-controller.js',
    'scripts/planner/grade-editor.js',
    'scripts/click.js',
  ];
  const positions = expected.map((file) => html.indexOf(`src="${file}"`));
  positions.forEach((position, index) => {
    assert.ok(position >= 0, `${expected[index]} must be linked`);
    if (index) assert.ok(position > positions[index - 1], `${expected[index]} load order drifted`);
  });
});

test('course-picker layout has a bounded fallback when card geometry is unavailable', () => {
  const style = {};
  const dropdown = { style, dataset: {} };
  const filterMenu = { hidden: true, style: {} };
  const controller = globals.SurriculumModules.plannerCoursePickerLayout.createLayoutController({
    document: {
      documentElement: { clientWidth: 800, clientHeight: 600 },
      body: null,
    },
    dropdown,
    filterMenu,
    filterButton: { getBoundingClientRect: () => ({ left: 100, right: 140, top: 50, bottom: 80 }) },
    searchRow: {
      getBoundingClientRect: () => ({ left: 100, right: 400, top: 250, bottom: 290, width: 300 }),
    },
    targetSemesterElement: null,
    semesterContainer: null,
    inputContainer: { isConnected: true },
  });

  assert.equal(Object.isFrozen(controller), true);
  assert.doesNotThrow(() => controller.positionDropdown());
  assert.equal(style.width, '300px');
  assert.match(style.maxHeight, /^\d+px$/);
  assert.ok(['above', 'below'].includes(dropdown.dataset.placement));
});

test('course-picker option renderer exposes a focused frozen rendering policy', () => {
  const createElement = (tagName) => ({
    tagName,
    children: [],
    dataset: {},
    className: '',
    textContent: '',
    appendChild(child) { this.children.push(child); },
  });
  const renderer = globals.SurriculumModules.plannerCoursePickerOptionRenderer.createOptionRenderer({
    document: { createElement },
    filterApi: null,
    controls: { details: { checked: true } },
    targetTermCode: '202601',
  });
  const container = createElement('div');

  renderer.renderOptionContent(container, {
    candidate: { code: 'CS201', name: 'Programming', su: 3, ects: 6 },
    offering: { state: 'offered' },
  }, { checkPrerequisites: false, offeredOnly: true, program: '' });

  assert.equal(Object.isFrozen(renderer), true);
  assert.equal(container.children[0].textContent, 'CS201 Programming');
  assert.equal(container.children[1].children[0].textContent, 'SU: 3');
  assert.equal(container.children[2].children[0].textContent, 'Offered');
});

test('course actions still fail closed before catalog data is available', () => {
  const alerts = [];
  globals.uiModal = {
    alert(title, body) { alerts.push({ title, body }); },
  };
  const event = {
    target: {
      classList: { contains: (name) => name === 'addCourse' },
    },
  };

  assert.equal(globals.dynamic_click(event, {}, []), undefined);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].title, 'Course data unavailable');
  assert.match(alerts[0].body, /file:\/\//);
});

test('module entry points reject incomplete controller contexts without mutation', async () => {
  assert.equal(globals.SurriculumModules.plannerCoursePicker.open({}), false);
  assert.equal(globals.SurriculumModules.plannerCourseCommit.commit({}), false);
  await assert.doesNotReject(async () => {
    assert.equal(await globals.SurriculumModules.plannerCourseDetails.open({}), false);
  });
  assert.equal(globals.SurriculumModules.plannerGradeEditor.open({}), false);
});

test('grade editor expands ambiguous NA into explicit grading-basis choices', () => {
  const options = globals.SurriculumModules.plannerGradeEditor.buildGradeOptions({
    GRADE_UI_OPTIONS: [
      { value: '', label: 'Registered / no grade' },
      { value: 'NA', label: 'NA' },
    ],
  });

  assert.deepEqual(
    Array.from(options, option => ({
      value: option.value,
      label: option.label,
      basis: option.basis || '',
    })),
    [
      { value: '', label: 'Registered / no grade', basis: '' },
      { value: 'NA', label: 'NA — letter-graded course', basis: 'letter' },
      { value: 'NA', label: 'NA — S/U-graded course', basis: 'satisfactory' },
    ],
  );
});

test('injected grade editor commits model, totals, recalculation, and save together', () => {
  function createElement(tagName) {
    const classes = new Set();
    const element = {
      tagName,
      children: [],
      parentNode: null,
      dataset: {},
      style: {},
      attributes: {},
      listeners: {},
      offsetWidth: 0,
      offsetHeight: 0,
      isConnected: true,
      appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
      },
      querySelectorAll(selector) {
        return selector === '.grade-option'
          ? this.children.filter(child => child.classList.contains('grade-option'))
          : [];
      },
      setAttribute(name, value) { this.attributes[name] = String(value); },
      addEventListener(name, listener) { this.listeners[name] = listener; },
      contains(node) {
        return node === this || this.children.some(child => child.contains(node));
      },
      closest(selector) {
        return selector === '.grade-option' && this.classList.contains('grade-option')
          ? this : null;
      },
      scrollIntoView() {},
      focus() { this.focused = true; },
      remove() {
        this.removed = true;
        if (this.parentNode) {
          this.parentNode.children = this.parentNode.children.filter(child => child !== this);
        }
      },
      classList: {
        add(...names) { names.forEach(name => classes.add(name)); },
        remove(...names) { names.forEach(name => classes.delete(name)); },
        contains(name) { return classes.has(name); },
        toggle(name, force) {
          if (force) classes.add(name);
          else classes.delete(name);
        },
      },
    };
    Object.defineProperty(element, 'className', {
      get() { return Array.from(classes).join(' '); },
      set(value) {
        classes.clear();
        String(value || '').split(/\s+/).filter(Boolean).forEach(name => classes.add(name));
      },
    });
    return element;
  }

  const body = createElement('body');
  const documentListeners = new Map();
  const document = {
    body,
    createElement,
    addEventListener(name, listener) { documentListeners.set(name, listener); },
    removeEventListener(name) { documentListeners.delete(name); },
  };
  let recalculations = 0;
  let saves = 0;
  const host = {
    document,
    innerWidth: 1200,
    innerHeight: 800,
    addEventListener() {},
    removeEventListener() {},
    getInfo() { return { SU_credit: '3' }; },
    parseCreditValue(value) { return Number(value); },
    evaluateGradeForLegacyTotals(grade) {
      return grade === 'A'
        ? { countsInGpa: true, gpaPoints: 4 }
        : { countsInGpa: false, gpaPoints: 0 };
    },
    gradePolicy: {
      inferGradingBasis(grade) { return grade === 'A' ? 'letter' : 'unknown'; },
    },
    planStorage: { requestSave() { saves += 1; } },
  };
  const course = { id: 'course-1', code: 'CS201', grade: '', gradingBasis: 'unknown' };
  const semester = {
    courses: [course],
    totalGPA: 0,
    totalGPACredits: 0,
  };
  const curriculum = {
    getSemester() { return semester; },
    isDegreeEligibleCourse() { return true; },
    recalcEffectiveTypes() { recalculations += 1; },
  };
  const courseElement = createElement('article');
  courseElement.id = 'course-1';
  const semesterElement = createElement('section');
  semesterElement.id = 'semester-1';
  const gradeElement = createElement('button');
  gradeElement.closest = selector => (
    selector === '.course' ? courseElement
      : (selector === '.semester' ? semesterElement : null)
  );
  gradeElement.getBoundingClientRect = () => ({ top: 100, right: 400, bottom: 130 });

  const editor = globals.SurriculumModules.plannerGradeEditor.create(host);
  assert.equal(Object.isFrozen(editor), true);
  assert.equal(editor.open({
    event: { target: gradeElement },
    curriculum,
    courseData: [{ Code: '201' }],
  }), true);

  const dropdown = body.children[0];
  const optionsContainer = dropdown.children[0];
  const aOption = optionsContainer.children.find(option => option.dataset.value === 'A');
  optionsContainer.listeners.click({
    target: aOption,
    preventDefault() {},
    stopPropagation() {},
  });

  assert.equal(course.grade, 'A');
  assert.equal(course.gradingBasis, 'letter');
  assert.equal(semester.totalGPA, 12);
  assert.equal(semester.totalGPACredits, 3);
  assert.equal(gradeElement.textContent, 'A');
  assert.equal(gradeElement.attributes['aria-label'], 'Grade for CS201: A');
  assert.equal(gradeElement.attributes['aria-expanded'], 'false');
  assert.equal(gradeElement.focused, true);
  assert.equal(recalculations, 1);
  assert.equal(saves, 1);
  assert.equal(dropdown.removed, true);
});

test('injected course-commit policy completes a successful add without browser globals', () => {
  const catalog = [{
    Major: 'CS',
    Code: '201',
    Course_Name: 'Programming Fundamentals',
    SU_credit: '3,5',
    Basic_Science: '1',
    Engineering: '2',
    ECTS: '6',
    EL_Type: 'required',
    Faculty_Course: 'Yes',
  }];
  const semester = {
    courses: [],
    totalCredit: 3.5,
    addCourse(course) { this.courses.push(course); },
  };
  const rendered = [];
  let recalculations = 0;
  const curriculum = {
    course_id: 4,
    semesters: [semester],
    hasCourse: () => false,
    recalcEffectiveTypes() { recalculations += 1; },
  };
  const policy = globals.SurriculumModules.plannerCourseCommit.create({
    createCourse(code, id) { return { code, id }; },
    isCourseValid(course) { return course && course.code === 'CS201'; },
    getInfo(code) { return code === 'CS201' ? catalog[0] : null; },
    parseCreditValue(value) { return Number(String(value).replace(',', '.')); },
    formatCreditValue(value) { return Number(String(value).replace(',', '.')).toFixed(1); },
    renderAddedCourse(payload) { rendered.push(payload); return true; },
  });

  globals.s_course = () => { throw new Error('unexpected global constructor'); };
  globals.getInfo = () => { throw new Error('unexpected global catalog lookup'); };
  const committed = policy.commit({
    event: { target: {} },
    inputContainer: { dataset: {} },
    inputValue: 'CS201 Programming Fundamentals',
    targetSemester: semester,
    curriculum,
    courseData: catalog,
  });

  assert.equal(Object.isFrozen(policy), true);
  assert.equal(committed, true);
  assert.equal(curriculum.course_id, 5);
  assert.equal(semester.courses.length, 1);
  assert.deepEqual(
    {
      code: semester.courses[0].code,
      id: semester.courses[0].id,
      credit: semester.courses[0].SU_credit,
      category: semester.courses[0].category,
      faculty: semester.courses[0].Faculty_Course,
    },
    { code: 'CS201', id: 'c5', credit: 3.5, category: 'Required', faculty: 'Yes' },
  );
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0].semester, semester);
  assert.equal(recalculations, 1);
});

test('injected course-commit policy checkpoints and completes an eligible retake', async () => {
  const oldCourse = { code: 'CS201', id: 'old-course', grade: 'F' };
  const sourceSemester = { termName: 'Fall 2024-2025', courses: [oldCourse] };
  const targetSemester = { termName: 'Spring 2024-2025', courses: [] };
  const occurrence = { course: oldCourse, semester: sourceSemester, termCode: '202401' };
  const calls = [];
  const storage = {
    requestSave() { calls.push('save'); return true; },
    flushSaves() { calls.push('flush'); return true; },
    suspendSaves() { calls.push('suspend'); },
  };
  const retakes = {
    assessRetakeCandidate() {
      return { eligible: true, occurrence };
    },
    normalizeCourseCode(value) {
      return String(value && value.code ? value.code : value || '').toUpperCase();
    },
  };
  const inputContainer = { dataset: {} };
  let confirmed = 0;
  let replacements = 0;
  let reloads = 0;
  const policy = globals.SurriculumModules.plannerCourseCommit.create({
    createCourse(code, id) { return { code, id }; },
    isCourseValid(course) { return course && course.code === 'CS201'; },
    getInfo() { return null; },
    renderAddedCourse() { throw new Error('duplicate path must not render directly'); },
    getUi() {
      return {
        async confirm() { confirmed += 1; return true; },
        async alert() { throw new Error('successful retake must not alert'); },
      };
    },
    getRetakes() { return retakes; },
    getStorage() { return storage; },
    replaceRetake() {
      replacements += 1;
      sourceSemester.courses = [];
      targetSemester.courses.push({ code: 'CS201', id: 'replacement' });
      return true;
    },
    reload() { reloads += 1; },
  });
  const curriculum = {
    course_id: 1,
    semesters: [sourceSemester, targetSemester],
    hasCourse: () => true,
  };

  const committed = policy.commit({
    event: { target: {} },
    inputContainer,
    inputValue: 'CS201',
    targetSemester,
    curriculum,
    courseData: [{ Major: 'CS', Code: '201', Course_Name: 'Programming Fundamentals' }],
    escapeHtml: String,
  });
  assert.equal(committed, true);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(confirmed, 1);
  assert.equal(replacements, 1);
  assert.deepEqual(calls, ['save', 'flush', 'save', 'flush']);
  assert.equal(sourceSemester.courses.length, 0);
  assert.equal(targetSemester.courses[0].code, 'CS201');
  assert.equal(reloads, 0);
});
