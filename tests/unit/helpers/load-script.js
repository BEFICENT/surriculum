'use strict';

// Load a browser script that exposes helpers on `window`, inside a tolerant
// sandbox, and return its global object so unit tests can call those helpers
// directly — no build step, no real DOM.
//
// The app has no module exports yet (everything is a browser global or closure),
// so this bridges the gap for PURE logic: unknown free identifiers (DOM globals,
// other scripts' globals not loaded here) resolve to `undefined` instead of
// throwing a ReferenceError, while Node's real built-ins (parseInt, Math, Date,
// JSON, …) still resolve normally. When the codebase is refactored to real
// modules, these tests can switch to importing directly and this shim goes away.
//
// Rule of thumb: use this only for logic that doesn't actually touch the DOM.
// Anything that needs layout / real elements belongs in an e2e (Playwright) test.

const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

function loadScriptGlobals(relPath) {
  const abs = path.isAbsolute(relPath) ? relPath : path.join(REPO_ROOT, relPath);
  const src = fs.readFileSync(abs, 'utf8');

  const REAL = globalThis;
  const g = {};
  g.window = g;
  g.globalThis = g;
  g.self = g;

  const sandbox = new Proxy(g, {
    has() { return true; }, // suppress ReferenceError for undeclared app globals
    get(target, prop) {
      if (typeof prop === 'symbol') return target[prop];
      if (prop in target) return target[prop];
      if (prop in REAL) return REAL[prop]; // fall through to Node built-ins
      return undefined; // unknown app globals -> tolerated as undefined
    },
    set(target, prop, val) { target[prop] = val; return true; },
  });

  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: relPath });
  return g;
}

module.exports = { loadScriptGlobals, REPO_ROOT };
