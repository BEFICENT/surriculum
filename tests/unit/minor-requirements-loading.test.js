'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(ROOT, 'scripts/minor_requirements.js'), 'utf8');
const files = {
  './requirements/minors/terms.jsonl': fs.readFileSync(
    path.join(ROOT, 'requirements/minors/terms.jsonl'), 'utf8',
  ),
  './requirements/minors/202401.jsonl': fs.readFileSync(
    path.join(ROOT, 'requirements/minors/202401.jsonl'), 'utf8',
  ),
  './requirements/minors/202301.jsonl': fs.readFileSync(
    path.join(ROOT, 'requirements/minors/202301.jsonl'), 'utf8',
  ),
  './requirements/minors.jsonl': fs.readFileSync(
    path.join(ROOT, 'requirements/minors.jsonl'), 'utf8',
  ),
};

function responseFor(url) {
  const text = files[url];
  return {
    ok: !!text,
    status: text ? 200 : 404,
    async text() { return text || ''; },
  };
}

function loadScript(options = {}) {
  const requests = [];
  class FakeXMLHttpRequest {
    open(method, url, async) {
      requests.push({ transport: 'xhr', method, url, async });
      this.url = url;
    }
    overrideMimeType() {}
    send() {
      this.status = files[this.url] ? 200 : 404;
      this.responseText = files[this.url] || '';
    }
  }
  const sandbox = {
    console,
    location: { protocol: options.protocol || 'https:' },
    XMLHttpRequest: FakeXMLHttpRequest,
    termNameToCode(value) {
      const match = String(value).match(/(20\d{2})-(20\d{2})/);
      return match ? `${match[1]}01` : '';
    },
    async fetch(url) {
      requests.push({ transport: 'fetch', method: 'GET', url });
      if (typeof options.fetchImpl === 'function') return options.fetchImpl(url);
      return responseFor(url);
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'scripts/minor_requirements.js' });
  return { sandbox, requests };
}

test('HTTP minor requirement startup is idle and all reads are asynchronous', async () => {
  const { sandbox, requests } = loadScript();
  assert.deepEqual(Object.keys(sandbox.minorRequirements), []);
  assert.equal(requests.length, 0);
  assert.deepEqual(Array.from(await sandbox.loadMinorTermCodesAsync()).slice(0, 2), ['202601', '202503']);
  assert.equal(requests.every((request) => request.transport === 'fetch'), true);
  assert.equal(requests.some((request) => request.async === false), false);
});

test('selected minor terms are ready and cache-backed before synchronous graduation reads', async () => {
  const { sandbox, requests } = loadScript();
  await sandbox.initializeMinorRequirementsAsync(['202401', '202301'], '202401');

  assert.equal(requests.every((request) => request.transport === 'fetch'), true);
  assert.equal(sandbox.minorRequirements['ANALY-MINOR'].termCode, '202401');
  assert.equal(sandbox.loadMinorRequirementsForTerm('202301')['ANALY-MINOR'].termCode, '202301');
  assert.equal(sandbox.minorRequirementsStatus.availableByTerm['202401'], true);
  assert.equal(sandbox.minorRequirementsStatus.availableByTerm['202301'], true);
  const requestCount = requests.length;
  assert.equal((await sandbox.whenMinorRequirementsReady())['ANALY-MINOR'].termCode, '202401');
  assert.equal(requests.length, requestCount, 'readiness and compatibility reads must reuse the cache');
});

test('transient minor requirement failures are retried instead of cached empty', async () => {
  let failuresRemaining = 4;
  const { sandbox } = loadScript({
    async fetchImpl(url) {
      if (failuresRemaining > 0) {
        failuresRemaining -= 1;
        return { ok: false, status: 503, async text() { return ''; } };
      }
      return responseFor(url);
    },
  });

  const first = await sandbox.loadMinorRequirementsForTermAsync('202401');
  assert.deepEqual(Object.keys(first), []);
  const second = await sandbox.loadMinorRequirementsForTermAsync('202401');
  assert.equal(second['ANALY-MINOR'].termCode, '202401');
});

test('slower stale minor initialization cannot replace the latest default term', async () => {
  let releaseFirst;
  const gate = new Promise((resolve) => { releaseFirst = resolve; });
  const { sandbox } = loadScript({
    async fetchImpl(url) {
      if (url === './requirements/minors/202401.jsonl') {
        await gate;
      }
      return responseFor(url);
    },
  });

  const stale = sandbox.initializeMinorRequirementsAsync(['202401'], '202401');
  await sandbox.initializeMinorRequirementsAsync(['202301'], '202301');
  assert.equal(sandbox.minorRequirements['ANALY-MINOR'].termCode, '202301');
  releaseFirst();
  await stale;
  assert.equal(sandbox.minorRequirements['ANALY-MINOR'].termCode, '202301');
  assert.equal(sandbox.minorRequirementsStatus.defaultTerm, '202301');
});

test('file protocol keeps the synchronous minor requirements fallback', () => {
  const { sandbox, requests } = loadScript({ protocol: 'file:' });
  const records = sandbox.loadMinorRequirementsForTerm('202401');

  assert.equal(records['ANALY-MINOR'].termCode, '202401');
  assert.equal(requests.some((request) => (
    request.transport === 'xhr'
    && request.url === './requirements/minors/202401.jsonl'
    && request.async === false
  )), true);
  assert.equal(requests.some((request) => request.transport === 'fetch'), false);
});
