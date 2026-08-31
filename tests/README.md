# Tests

Dev-time test suite for SUrriculum. **The shipped app stays dependency-free** —
plain HTML/CSS/JS, no build step. Everything here is tooling only; `node_modules`
is git-ignored and never served to users.

## Running

```bash
npm install            # once: installs @playwright/test (dev only)
pip install -r requirements.txt  # once: installs Python scraper dependencies
npx playwright install chromium  # once: full-suite browser binary
npx playwright install firefox webkit  # once: focused cross-browser binaries

npm test               # unit + Python checks + e2e
npm run test:unit      # fast: node --test + the legacy static checks
npm run test:python    # offline scraper/data/Pages-artifact checks
npm run test:e2e       # full Chromium Playwright suite
npm run test:e2e:cross-browser  # one critical flow in Firefox + WebKit
npm run perf:contracts # deterministic source/artifact performance guards
npm run perf:smoke     # single-worker, zero-retry browser performance smoke
python tests/scrape_groups_test.py
python tests/scrape_coursepages_fallback_test.py
python tests/coursepage_requirements_data_test.py
python tests/requirements_validation_test.py
python tests/scraper_term_identity_test.py
python tests/manifest_integrity_test.py
python tests/pages_artifact_test.py
npm run test:e2e:ui    # Playwright interactive UI mode
```

The seven Python checks are included in `npm test`; their direct commands remain
available for focused runs. Python dependencies are installed separately from
the JavaScript dev tooling. The cross-browser command is intentionally separate
from `npm test`: it repeats one release-critical planner flow, not the complete
Chromium matrix.

## Layout

```
tests/
  static_checks.js         legacy source-pattern asserts (kept, runs in test:unit)
  unit/
    helpers/load-script.js pure-logic harness (see below)
    *.test.js              node:test unit tests for pure helpers
  e2e/
    fixtures.js            shared Playwright fixtures (browserErrors collector)
    helpers/*.js           deterministic plan and feature-specific setup helpers
    cross-browser/*.spec.js focused Firefox/WebKit release-critical flow
    desktop/*.spec.js      behavior-focused desktop-viewport flows
    mobile/*.spec.js       phone-viewport flows (body.is-mobile layer)
  perf/
    README.md              performance lanes, metrics, and AC/battery protocol
    run.js                 isolated browser-journey orchestrator
    lib/                   metrics, provenance, power, diagnostics, and reports
    compare.js             environment-safe regression and power comparison
    contracts/*.test.js    deterministic performance regression guards
  coursepage_requirements_data_test.py  reviewed General Requirements schema/data
  pages_artifact_test.py   release allowlist + mounted-subpath smoke
```

## Philosophy

The runtime deliberately combines compatibility globals and focused classic
modules with a smaller set of pure ES modules. The primary safety net is
**end-to-end tests that drive the real app in a real browser** — they pin
behaviour at the UI boundary, which the refactor must preserve, so they survive
internal restructuring. Unit tests are a second layer for pure logic only.

- **`unit/helpers/load-script.js`** loads real classic browser scripts (for
  example, `scripts/data/course-metadata.js`) inside a tolerant `vm` sandbox and returns the functions
  it puts on `window`, so pure helpers can be unit-tested today without a build
  step. Use it only for logic that doesn't touch the DOM; anything needing layout
  or real elements belongs in an e2e test. New pure modules should use plain
  `import`; the shim remains for classic scripts until they are extracted.
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
- `.github/workflows/ci.yml` runs unit/Python checks, the full Chromium suite,
  and the focused Firefox/WebKit flow with read-only repository permissions.
  Data-only refresh pushes and pull requests from `bot/daily-data-refresh` skip
  that heavier workflow; the refresh job still runs the fast course-page rule,
  requirements, term-identity, and manifest validators before it opens a pull
  request.
- `.github/workflows/performance.yml` separately runs deterministic contracts,
  a short pull-request smoke, and a scheduled extended benchmark. Hosted-runner
  artifacts are software/virtual-machine evidence; real GPU and AC/battery
  conclusions use the reference-device protocol in `tests/perf/README.md`.
- `.github/workflows/pages-release.yml` is manual and build-only by default. A
  build-only run first validates the reviewed course-page rules and data
  manifest, then uploads the allowlisted bundle for review. Deployment requires
  both the explicit `deploy` input and `refs/heads/main`; ordinary pushes and
  merges cannot publish it.
