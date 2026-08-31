'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');

function loadBrowserScript(file, overrides = {}) {
  const files = Array.isArray(file) ? file : [file];
  const sandbox = {
    console: { error() {}, warn() {}, log() {} },
    ...overrides,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  files.forEach((relative) => {
    vm.runInContext(
      fs.readFileSync(path.join(ROOT, relative), 'utf8'),
      sandbox,
      { filename: relative },
    );
  });
  return sandbox;
}

function response(text, ok = true) {
  return { ok, async text() { return text; } };
}

test('HTTP instructor and section histories never use synchronous XHR', async () => {
  let xhrConstructions = 0;
  const bodies = new Map([
    ['./courses/course_instructor_history.jsonl', '{"course_id":"CS101","instructors":["Ada"]}'],
    ['./courses/course_section_history.jsonl', '{"course_id":"CS101","sections":["A"]}'],
  ]);
  const sandbox = loadBrowserScript('scripts/data/course-metadata.js', {
    location: { protocol: 'https:' },
    async fetch(resource) {
      const key = String(resource);
      return bodies.has(key) ? response(bodies.get(key)) : response('', false);
    },
    XMLHttpRequest: class {
      constructor() { xhrConstructions += 1; }
    },
  });

  const [instructors, sections] = await Promise.all([
    sandbox.loadCourseInstructorHistoryIndex(),
    sandbox.loadCourseSectionHistoryIndex(),
  ]);

  assert.deepEqual(Array.from(instructors.get('CS101').instructors), ['Ada']);
  assert.deepEqual(Array.from(sections.get('CS101').sections), ['A']);
  assert.equal(xhrConstructions, 0);
});

test('empty HTTP history results are retryable', async () => {
  let available = false;
  let fetchCalls = 0;
  const sandbox = loadBrowserScript('scripts/data/course-metadata.js', {
    location: { protocol: 'https:' },
    async fetch() {
      fetchCalls += 1;
      return available
        ? response('{"course_id":"CS201","instructors":["Grace"]}')
        : response('', false);
    },
    XMLHttpRequest: class {
      constructor() { throw new Error('HTTP must not construct XHR'); }
    },
  });

  const empty = await sandbox.loadCourseInstructorHistoryIndex();
  assert.equal(empty.size, 0);
  assert.equal(sandbox.__courseInstructorHistoryPromise, null);
  available = true;
  const recovered = await sandbox.loadCourseInstructorHistoryIndex();

  assert.deepEqual(Array.from(recovered.get('CS201').instructors), ['Grace']);
  assert.equal(fetchCalls, 3, 'failed load retries once uncached, then the next open retries cleanly');
});

test('file protocol can use the guarded history XHR fallback', async () => {
  const xhrCalls = [];
  const bodies = new Map([
    ['./courses/course_instructor_history.jsonl', '{"course_id":"CS101","instructors":[]}'],
    ['./courses/course_section_history.jsonl', '{"course_id":"CS101","sections":[]}'],
  ]);
  const sandbox = loadBrowserScript('scripts/data/course-metadata.js', {
    location: { protocol: 'file:' },
    async fetch() { throw new Error('file fetch unavailable'); },
    XMLHttpRequest: class {
      open(method, resource, isAsync) {
        assert.equal(method, 'GET');
        assert.equal(isAsync, false);
        this.resource = String(resource);
      }
      overrideMimeType() {}
      send() {
        xhrCalls.push(this.resource);
        this.status = 0;
        this.responseText = bodies.get(this.resource) || '';
      }
    },
  });

  await Promise.all([
    sandbox.loadCourseInstructorHistoryIndex(),
    sandbox.loadCourseSectionHistoryIndex(),
  ]);
  assert.deepEqual(xhrCalls.sort(), Array.from(bodies.keys()).sort());
});

test('course details starts page, instructor, and section index reads together', () => {
  const calls = [];
  const pending = () => new Promise(() => {});
  const sandbox = loadBrowserScript([
    'scripts/planner/course-details-controller.js',
    'scripts/click.js',
  ], {
    uiModal: { alert() {} },
    loadCoursePageInfoIndex() { calls.push('page'); return pending(); },
    loadCourseInstructorHistoryIndex() { calls.push('instructor'); return pending(); },
    loadCourseSectionHistoryIndex() { calls.push('section'); return pending(); },
  });
  const container = { querySelector() { return { textContent: 'CS101' }; } };
  const button = { closest(selector) { return selector === '.course_container' ? container : button; } };
  const target = {
    classList: { contains(name) { return name === 'details_course'; } },
    closest(selector) { return selector === 'button.details_course' ? button : null; },
  };

  sandbox.dynamic_click({ target }, {}, [{}]);
  assert.deepEqual(calls, ['page', 'instructor', 'section']);
});
