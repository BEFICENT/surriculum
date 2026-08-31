'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'scripts/app/program-data.js'), 'utf8');

function loadProgramData(overrides = {}) {
  const sandbox = {
    console: { error() {}, warn() {}, log() {} },
    ...overrides,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: 'scripts/app/program-data.js' });
  return sandbox;
}

function response(text, ok = true) {
  return { ok, async text() { return text; } };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('HTTP program data uses fetch only for manifest, main, and minor catalogs', async () => {
  const fetchCalls = [];
  let xhrConstructions = 0;
  const bodies = new Map([
    ['./courses/terms.jsonl', [
      '{"term":"202601","majors":["CS","EE"]}',
      '{"term":"202602","majors":["CS"]}',
    ].join('\n')],
    ['courses/202601/CS.jsonl', '{"Major":"CS","Code":"101"}'],
    ['courses/minors/202601/MAT-MIN.jsonl', '{"Major":"MATH","Code":"201"}'],
  ]);
  const sandbox = loadProgramData({
    location: { protocol: 'https:' },
    async fetch(resource) {
      const key = String(resource);
      fetchCalls.push(key);
      return bodies.has(key) ? response(bodies.get(key)) : response('', false);
    },
    XMLHttpRequest: class {
      constructor() { xhrConstructions += 1; }
    },
  });

  const manifest = await sandbox.surriculumProgramData.loadTermManifest();
  const main = await sandbox.surriculumProgramData.loadProgramCatalog('cs', '202601');
  const minor = await sandbox.surriculumProgramData.loadMinorCatalog('mat-min', '202601');
  const missing = await sandbox.surriculumProgramData.loadProgramCatalog('ee', '202601');

  assert.deepEqual(plain(manifest), {
    202601: ['CS', 'EE'],
    202602: ['CS'],
  });
  assert.deepEqual(plain(main), [{ Major: 'CS', Code: '101' }]);
  assert.deepEqual(plain(minor), [{ Major: 'MATH', Code: '201' }]);
  assert.deepEqual(plain(missing), []);
  assert.equal(xhrConstructions, 0, 'HTTP failures must not fall back to synchronous XHR');
  assert.ok(fetchCalls.includes('./courses/terms.jsonl'));
  assert.ok(fetchCalls.includes('courses/202601/CS.jsonl'));
  assert.ok(fetchCalls.includes('courses/minors/202601/MAT-MIN.jsonl'));
});

test('file protocol preserves the synchronous compatibility fallback', async () => {
  const xhrCalls = [];
  const bodies = new Map([
    ['./courses/terms.jsonl', '{"term":"202601","majors":["CS"]}'],
    ['courses/202601/CS.jsonl', '{"Major":"CS","Code":"101"}'],
    ['courses/minors/202601/MAT-MIN.jsonl', '{"Major":"MATH","Code":"201"}'],
  ]);
  const sandbox = loadProgramData({
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
        this.status = bodies.has(this.resource) ? 0 : 404;
        this.responseText = bodies.get(this.resource) || '';
      }
    },
  });

  const manifest = await sandbox.surriculumProgramData.loadTermManifest();
  const main = await sandbox.surriculumProgramData.loadProgramCatalog('CS', '202601');
  const minor = await sandbox.surriculumProgramData.loadMinorCatalog('MAT-MIN', '202601');

  assert.deepEqual(plain(manifest), { 202601: ['CS'] });
  assert.deepEqual(plain(main), [{ Major: 'CS', Code: '101' }]);
  assert.deepEqual(plain(minor), [{ Major: 'MATH', Code: '201' }]);
  assert.deepEqual(xhrCalls, [
    './courses/terms.jsonl',
    'courses/202601/CS.jsonl',
    'courses/minors/202601/MAT-MIN.jsonl',
  ]);
});
