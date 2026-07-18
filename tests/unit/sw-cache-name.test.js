'use strict';

// The service-worker cache key is derived from the app+data version passed in
// the registration URL (sw.js?v=…), so a release or a re-scrape rotates the
// cache automatically instead of needing a manual bump. That derivation can't be
// exercised end-to-end (service workers don't register in the sandbox), so it's
// pinned here: sw.js is evaluated in a minimal mocked worker global and its
// CACHE_NAME read back. Only load-time code runs — the install/activate/fetch
// handlers are registered but never invoked.

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const SW_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'sw.js'), 'utf8');

function cacheNameFor(search) {
  const self = {
    addEventListener() {},               // handlers are registered, not run
    location: { origin: 'https://example.test', search },
  };
  const sandbox = { self, URLSearchParams, Promise, console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  // Top-level `const` in a classic script isn't attached to the vm global, so
  // append an assignment to read the derived value back out.
  vm.runInContext(SW_SRC + '\nglobalThis.__CACHE_NAME = CACHE_NAME;', sandbox, { filename: 'sw.js' });
  return sandbox.__CACHE_NAME;
}

test('cache name derives from the ?v= registration query', () => {
  assert.equal(cacheNameFor('?v=3.1-2026-07-18'), 'surriculum-3.1-2026-07-18');
});

test('a URL-encoded version is read back intact', () => {
  assert.equal(
    cacheNameFor('?v=' + encodeURIComponent('3.2-2026-08-01')),
    'surriculum-3.2-2026-08-01',
  );
});

test('falls back to the historical fixed key when no version query is present', () => {
  // Covers an older cached main.js that registers a plain "sw.js".
  assert.equal(cacheNameFor(''), 'surriculum-cache-v4');
});
