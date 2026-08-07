# Tests

Dev-time test suite for SUrriculum. **The shipped app stays dependency-free** —
plain HTML/CSS/JS, no build step. Everything here is tooling only; `node_modules`
is git-ignored and never served to users.

## Running

```bash
npm install            # once: installs @playwright/test (dev only)
pip install -r requirements.txt  # once: installs Python scraper dependencies
npx playwright install chromium   # once: the browser binary

npm test               # unit + Python checks + e2e
npm run test:unit      # fast: node --test + the legacy static checks
npm run test:python    # offline scraper parity/fallback/schema checks
npm run test:e2e       # Playwright (real browser)
python tests/scrape_groups_test.py
python tests/scrape_coursepages_fallback_test.py
python tests/requirements_validation_test.py
python tests/manifest_integrity_test.py
npm run test:e2e:ui    # Playwright interactive UI mode
```

The four Python checks are included in `npm test`; their direct commands remain
available for focused runs. Python dependencies are installed separately from
the JavaScript dev tooling.

## Layout

```
tests/
  static_checks.js         legacy source-pattern asserts (kept, runs in test:unit)
  unit/
    helpers/load-script.js pure-logic harness (see below)
    *.test.js              node:test unit tests for pure helpers
  e2e/
    fixtures.js            shared Playwright fixtures (browserErrors collector)
    desktop/*.spec.js      desktop-viewport flows
    mobile/*.spec.js       phone-viewport flows (body.is-mobile layer)
```

## Philosophy

The codebase has no module exports yet (browser globals + closures), and a
refactor for maintainability is coming. So the primary safety net is
**end-to-end tests that drive the real app in a real browser** — they pin
behaviour at the UI boundary, which the refactor must preserve, so they survive
internal restructuring. Unit tests are a second layer for pure logic only.

- **`unit/helpers/load-script.js`** loads a real browser script (e.g.
  `helper_functions.js`) inside a tolerant `vm` sandbox and returns the functions
  it puts on `window`, so pure helpers can be unit-tested today without a build
  step. Use it only for logic that doesn't touch the DOM; anything needing layout
  or real elements belongs in an e2e test. When the code is modularised, these
  can switch to plain `import` and the shim goes away.
- **`e2e/fixtures.js`** exposes a `browserErrors` array (uncaught `pageerror` +
  `console.error`) so a test can assert the app logged nothing unexpected —
  catching silent regressions the app would otherwise swallow in try/catch.
  `net::ERR_` failures (blocked external CDNs in offline/sandboxed runs) are
  ignored; HTTP 404s and real app errors are not.

## Notes

- Playwright serves the app with `python -m http.server 8000` (same as the dev
  loop) and reuses an already-running server on that port.
- A small retry budget is configured to absorb cold-start timing noise; a real
  regression fails consistently and is not hidden (retried flakes are reported).
- CI is intentionally not wired up yet — run locally until coverage is worth
  gating on.
