'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const source = fs.readFileSync(path.join(ROOT, 'scripts', 'requirements.js'), 'utf8');
const frozen202401 = fs.readFileSync(path.join(ROOT, 'requirements', '202401.jsonl'), 'utf8');
const frozen202301 = fs.readFileSync(path.join(ROOT, 'requirements', '202301.jsonl'), 'utf8');

const frozenByUrl = {
  './requirements/202301.jsonl': frozen202301,
  './requirements/202401.jsonl': frozen202401,
};

function responseFor(url) {
  const text = frozenByUrl[url];
  return {
    ok: !!text,
    status: text ? 200 : 404,
    async text() { return text || ''; },
  };
}

function loadRequirementsScript(options = {}) {
  const requests = [];
  const protocol = options.protocol || 'https:';

  class FakeXMLHttpRequest {
    open(method, url, async) {
      requests.push({ transport: 'xhr', method, url, async });
      this.url = url;
    }

    overrideMimeType() {}

    send() {
      const text = frozenByUrl[this.url];
      this.status = text ? 200 : 404;
      this.responseText = text || '';
    }
  }

  const context = {
    console,
    location: { protocol },
    XMLHttpRequest: FakeXMLHttpRequest,
    async fetch(url) {
      requests.push({ transport: 'fetch', method: 'GET', url });
      if (typeof options.fetchImpl === 'function') return options.fetchImpl(url);
      return responseFor(url);
    },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'scripts/requirements.js' });
  return { context, requests };
}

test('requirements stay unavailable until a validated admit term is supplied', async () => {
  const { context, requests } = loadRequirementsScript();

  assert.deepEqual(Object.keys(context.requirements), []);
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.requirementsStatus)),
    {
      main: { term: '', available: false },
      doubleMajor: { term: '', available: false },
    },
  );
  assert.equal(requests.length, 0, 'script startup must not fetch synthetic requirements');
  assert.equal(context.loadRequirements('default'), null);
  assert.equal(context.loadRequirements('../202401'), null);
  assert.equal(await context.loadRequirementsAsync('default'), null);
  assert.equal(requests.length, 0, 'invalid terms must not produce requests');

  await context.initializeRequirementsAsync('', '202401');
  assert.equal(requests.length, 0, 'a double-major term cannot load without a main admit term');
  assert.deepEqual(Object.keys(context.requirements), []);
});

test('HTTP initialization fetches only the exact resolved term without synchronous XHR', async () => {
  const { context, requests } = loadRequirementsScript();

  await context.initializeRequirementsAsync('202401');

  assert.deepEqual(requests, [
    { transport: 'fetch', method: 'GET', url: './requirements/202401.jsonl' },
  ]);
  assert.equal(context.requirementsStatus.main.available, true);
  assert.equal(context.requirementsStatus.doubleMajor.available, true);
  assert.equal(context.getRequirementRecord('BIO', '202401').total, 127);
  assert.equal(context.getRequirementRecord('BIO', '202301'), null);
  assert.equal(await context.whenRequirementsReady(), context.requirements);
});

test('distinct main and double-major terms load concurrently and remain isolated', async () => {
  const { context, requests } = loadRequirementsScript();

  await context.initializeRequirementsAsync('202401', '202301');

  assert.deepEqual(requests.map((request) => request.url).sort(), [
    './requirements/202301.jsonl',
    './requirements/202401.jsonl',
  ]);
  assert.equal(requests.every((request) => request.transport === 'fetch'), true);
  assert.deepEqual(Object.keys(context.requirements).sort(), ['202301', '202401']);
  assert.equal(context.requirementsStatus.main.available, true);
  assert.equal(context.requirementsStatus.doubleMajor.available, true);
  assert.equal(context.getRequirementRecord('VACD', '202401').core, 21);
  assert.equal(context.getRequirementRecord('VACD', '202301').core, 27);
});

test('missing and invalid exact double-major terms fail closed', async () => {
  const { context, requests } = loadRequirementsScript();

  await context.initializeRequirementsAsync('202401', '999999');
  assert.equal(context.requirementsStatus.main.available, true);
  assert.equal(context.requirementsStatus.doubleMajor.term, '999999');
  assert.equal(context.requirementsStatus.doubleMajor.available, false);
  assert.equal(context.getRequirementRecord('BIO', '202401').total, 127);
  assert.equal(context.getRequirementRecord('BIO', '999999'), null);
  assert.deepEqual(requests.filter((request) => request.url.includes('999999')).map((request) => request.url), [
    './requirements/999999.jsonl',
    './requirements/999999.json',
  ]);

  requests.length = 0;
  await context.initializeRequirementsAsync('202401', 'invalid');
  assert.equal(context.requirementsStatus.main.available, true);
  assert.equal(context.requirementsStatus.doubleMajor.term, '');
  assert.equal(context.requirementsStatus.doubleMajor.available, false);
  assert.equal(requests.length, 0, 'the cached main term needs no request and invalid DM never fetches');
});

test('transient empty HTTP results are not latched and can be retried', async () => {
  let attempts = 0;
  const { context } = loadRequirementsScript({
    async fetchImpl(url) {
      attempts += 1;
      if (attempts <= 2) return { ok: false, status: 503, async text() { return ''; } };
      return responseFor(url);
    },
  });

  await context.initializeRequirementsAsync('202401');
  assert.equal(context.requirementsStatus.main.available, false);
  await context.initializeRequirementsAsync('202401');
  assert.equal(context.requirementsStatus.main.available, true);
  assert.equal(context.getRequirementRecord('BIO', '202401').total, 127);
});

test('a slower stale initialization cannot replace the latest selected term', async () => {
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const { context } = loadRequirementsScript({
    async fetchImpl(url) {
      if (url === './requirements/202401.jsonl') {
        await firstGate;
        return responseFor(url);
      }
      return responseFor(url);
    },
  });

  const stale = context.initializeRequirementsAsync('202401');
  await context.initializeRequirementsAsync('202301');
  assert.equal(context.requirementsStatus.main.term, '202301');
  releaseFirst();
  await stale;
  assert.equal(context.requirementsStatus.main.term, '202301');
  assert.equal(context.getRequirementRecord('VACD', '202301').core, 27);
  assert.equal(context.getRequirementRecord('BIO', '202401'), null);
});

test('file protocol retains the synchronous compatibility fallback', () => {
  const { context, requests } = loadRequirementsScript({ protocol: 'file:' });

  context.initializeRequirements('202401');

  assert.deepEqual(requests, [{
    transport: 'xhr', method: 'GET', url: './requirements/202401.jsonl', async: false,
  }]);
  assert.equal(context.requirementsStatus.main.available, true);
  assert.equal(context.getRequirementRecord('BIO', '202401').total, 127);
});
