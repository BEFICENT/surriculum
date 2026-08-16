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

function loadRequirementsScript() {
  const requests = [];

  class FakeXMLHttpRequest {
    open(method, url, async) {
      requests.push({ method, url, async });
      this.url = url;
    }

    overrideMimeType() {}

    send() {
      const frozenByUrl = {
        './requirements/202301.jsonl': frozen202301,
        './requirements/202401.jsonl': frozen202401,
      };
      if (frozenByUrl[this.url]) {
        this.status = 200;
        this.responseText = frozenByUrl[this.url];
      } else {
        this.status = 404;
        this.responseText = '';
      }
    }
  }

  const context = {
    console,
    XMLHttpRequest: FakeXMLHttpRequest,
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'scripts/requirements.js' });
  return { context, requests };
}

test('requirements stay unavailable until a validated admit term is supplied', () => {
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
  assert.equal(requests.length, 0, 'invalid terms must not produce file requests');

  context.initializeRequirements('', '202401');
  assert.equal(requests.length, 0, 'a double-major term cannot load without a main admit term');
  assert.deepEqual(Object.keys(context.requirements), []);
});

test('initialization loads only the exact resolved term', () => {
  const { context, requests } = loadRequirementsScript();

  context.initializeRequirements('202401');

  assert.deepEqual(requests, [
    { method: 'GET', url: './requirements/202401.jsonl', async: false },
  ]);
  assert.equal(context.requirementsStatus.main.term, '202401');
  assert.equal(context.requirementsStatus.main.available, true);
  assert.equal(context.requirementsStatus.doubleMajor.term, '202401');
  assert.equal(context.requirementsStatus.doubleMajor.available, true);
  assert.equal(context.getRequirementRecord('BIO', '202401').total, 127);
  assert.equal(context.getRequirementRecord('BIO', '202301'), null);
});

test('distinct main and double-major terms remain isolated', () => {
  const { context, requests } = loadRequirementsScript();

  context.initializeRequirements('202401', '202301');

  assert.deepEqual(requests, [
    { method: 'GET', url: './requirements/202401.jsonl', async: false },
    { method: 'GET', url: './requirements/202301.jsonl', async: false },
  ]);
  assert.deepEqual(Object.keys(context.requirements).sort(), ['202301', '202401']);
  assert.equal(context.requirementsStatus.main.available, true);
  assert.equal(context.requirementsStatus.doubleMajor.available, true);
  assert.equal(context.getRequirementRecord('VACD', '202401').core, 21);
  assert.equal(context.getRequirementRecord('VACD', '202301').core, 27);
});

test('a missing exact double-major term fails closed without replacing main requirements', () => {
  const { context, requests } = loadRequirementsScript();

  context.initializeRequirements('202401', '999999');

  assert.deepEqual(requests, [
    { method: 'GET', url: './requirements/202401.jsonl', async: false },
    { method: 'GET', url: './requirements/999999.jsonl', async: false },
    { method: 'GET', url: './requirements/999999.json', async: false },
  ]);
  assert.equal(context.requirementsStatus.main.available, true);
  assert.equal(context.requirementsStatus.doubleMajor.term, '999999');
  assert.equal(context.requirementsStatus.doubleMajor.available, false);
  assert.equal(context.getRequirementRecord('BIO', '202401').total, 127);
  assert.equal(context.getRequirementRecord('BIO', '999999'), null);
});

test('an invalid explicit double-major term is unavailable instead of inheriting main', () => {
  const { context, requests } = loadRequirementsScript();

  context.initializeRequirements('202401', 'invalid');

  assert.deepEqual(requests, [
    { method: 'GET', url: './requirements/202401.jsonl', async: false },
  ]);
  assert.equal(context.requirementsStatus.main.available, true);
  assert.equal(context.requirementsStatus.doubleMajor.term, '');
  assert.equal(context.requirementsStatus.doubleMajor.available, false);
  assert.equal(context.getRequirementRecord('BIO', '202401').total, 127);
  assert.equal(context.getRequirementRecord('BIO', 'invalid'), null);
});

test('a failed main-term reload clears previously loaded requirements', () => {
  const { context, requests } = loadRequirementsScript();

  context.initializeRequirements('202401');
  assert.equal(context.getRequirementRecord('BIO', '202401').total, 127);

  context.initializeRequirements('999999');

  assert.deepEqual(requests, [
    { method: 'GET', url: './requirements/202401.jsonl', async: false },
    { method: 'GET', url: './requirements/999999.jsonl', async: false },
    { method: 'GET', url: './requirements/999999.json', async: false },
  ]);
  assert.deepEqual(Object.keys(context.requirements), []);
  assert.equal(context.requirementsStatus.main.term, '999999');
  assert.equal(context.requirementsStatus.main.available, false);
  assert.equal(context.requirementsStatus.doubleMajor.term, '999999');
  assert.equal(context.requirementsStatus.doubleMajor.available, false);
  assert.equal(context.getRequirementRecord('BIO', '202401'), null);
  assert.equal(context.getRequirementRecord('BIO', '999999'), null);
});
