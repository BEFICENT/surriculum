# SUrriculum performance suite

This suite turns the performance investigation into repeatable regression
evidence. It is test-only tooling: it adds no production dependency, sends no
telemetry, and never reads a real user's browser profile or plan. All scenarios
start from synthetic, versioned fixtures in `tests/perf/fixtures/`.

Performance has two kinds of checks and they deliberately stay separate:

1. **Deterministic contracts** inspect source and the exact Pages artifact.
   These are low-noise merge gates.
2. **Browser measurements** exercise real journeys and record distributions.
   They are useful only when target, cache, browser, fixture, and environment
   are comparable.

## Quick start

Use Node.js 24, Python 3.13, and the repository's locked npm dependencies.

```powershell
npm ci
npx playwright install chromium
node --test "tests/perf/contracts/*.test.js"
node tests/perf/run.js --profile ci-smoke --target local-artifact --browser chromium --headless --workers 1 --retries 0
node tests/perf/run.js --profile nightly --target local-artifact --browser chromium --headless --workers 1 --retries 0
```

The equivalent package commands are `npm run perf:contracts`,
`npm run perf:smoke`, and `npm run perf:nightly`. Use
`node tests/perf/run.js --help` before a focused or reference-device run; the
help output is the source of truth for optional filters and repetition flags.

The runner keeps browser iteration and CLI orchestration in `run.js`. Pure
metric aggregation, power validation/sample attachment, workload/target
provenance, optional trace/profile reruns, and CLI/profile/scenario
configuration live in `lib/aggregation.js`, `lib/power-validation.js`,
`lib/provenance.js`, `lib/diagnostic-runner.js`, and
`lib/runner-configuration.js`. `run.js` re-exports their established helper APIs
so existing contracts and tooling do not depend on the internal split.
Target-asset provenance reads use a small bounded worker pool and retain sorted
path order, so a large modular shell cannot overwhelm a constrained local
server or leave otherwise valid comparison evidence full of transient fetch
errors.

Every timing command is single-worker and has zero retries. A retry can hide a
real outlier and makes the resulting distribution harder to interpret.

## Targets and cache states

- `local-source` serves the checkout under the Pages-style `/surriculum/`
  mount. It is intended for fast diagnosis.
- `local-artifact` builds with `python -m tools.release.build_pages_artifact` and serves the
  exact allowlisted production bundle. This is the primary regression target.
- `live` targets the deployed GitHub Pages application. It is a deployment/CDN
  observation and must not block a pull request on timing alone.

Base and candidate revisions are separate runs of the same target identity.
Run `local-artifact` once from the base checkout and once from the candidate
checkout, using different `--run-id` values. For a custom HTTP target, run the
two builds at different times behind the exact same `--target` URL; custom
target IDs are derived from that URL. Two distinct base/candidate URLs produce
different target IDs and intentionally will not compare. Do not pass distinct
URLs together through `--targets` and expect the comparison tool to reinterpret
them as base and candidate roles.

If a change edits `tests/perf/` itself, ordinary base-checkout versus
candidate-checkout runs will intentionally have different workload hashes. For
a valid app comparison, run both staged app builds through one unchanged final
harness revision (for example, swap builds behind the same custom URL), or
establish a fresh baseline after the harness change. Do not waive a real
harness mismatch merely to recover a gate.

Service-worker/cache states are separate populations:

- **blocked/cold** measures renderer and data loading without a controlling
  service worker.
- **installing/cold** includes initial service-worker installation.
- **warm** starts after an unmeasured cache warmup in the same clean profile.
- **offline/warm** is restricted to the `service-worker` journey, which warms
  its exact plan online before entering a bounded offline phase.

`installing` is accepted only with the `startup` scenario, so registration and
installation actually occur inside its measured navigation. For every other
journey, navigation and fixture import are setup: timing/network/system sampling
starts at the first named phase after setup. Console, page, and request failures
from setup are retained separately and still participate in hard invariants. The
record keeps both measured `elapsedMs` and full `sessionElapsedMs`, so fixture
cost is visible without being mistaken for interaction cost.

Never average cold and warm runs together. The result records the target URL,
commit, browser, service-worker state, exact fixture hash, selected artifact
hashes (including linked first-party scripts/styles, `data/manifest.json`, and
scenario-declared data inputs), viewport, and environment. Each scenario also
records a composite SHA-256 over the runner, scenario, recursively discovered
CommonJS helpers/fixtures, dependency lockfile, and platform samplers.
Comparison keys keep that workload hash, browser/hardware, viewport, cache,
service-worker, CPU-throttle, headed/headless, fixture, and power populations
separate by default.

## Test lanes

| Lane | Trigger | Runs | Interpretation |
| --- | --- | --- | --- |
| Contracts | Every push and pull request, including `courses/`, `requirements/`, and `data/` changes | Static inventories and production artifact budgets | Hard gate |
| Smoke | Every push/PR and manual `smoke` dispatch | Short critical Chromium journeys | Coarse freeze/error gate and advisory timing evidence |
| Nightly | Daily schedule or manual `nightly` dispatch | More repetitions and soak coverage | Trend and regression evidence |
| Reference device | Before a release or performance-sensitive change | Headed Chrome/Brave, real GPU, AC and battery in separate runs | Hardware-specific release evidence |
| Production observation | After release and periodically | Clean and returning profiles against GitHub Pages | Deployment/cache drift; not a PR timing gate |

GitHub-hosted jobs use Chromium in a virtualized, usually software-rendered
environment. They can detect relative main-thread regressions and hangs, but
their artifacts must never be labelled as real GPU or battery measurements.

## Deterministic contracts

Run them with:

```powershell
node --test "tests/perf/contracts/*.test.js"
```

`contracts/baseline.json` is a reviewed ratchet, not a snapshot that is
regenerated automatically:

- Existing synchronous `XMLHttpRequest.open(..., false)` sites are inventoried
  per first-party runtime file. Removing or converting a site passes without a
  baseline edit; a new site or moving one to a new file fails.
- `setInterval`, `transition: all`, touch-move listeners, and document-wide
  mouse-hover listeners use the same downward-only rule. These are warnings of
  likely risk, not claims that every existing site is slow.
- Backdrop blur declarations are selector-allowlisted. The generic
  `.modal-overlay` remains the one reviewed full-viewport legacy blur for small
  dialogs. Scheduler must explicitly disable that inherited surface and create
  four bounded `.scheduler-edge-blur--top|right|bottom|left` bands plus four
  radius-sized corner patches. Their geometry follows the actual modal and
  refreshes on layout/visual-viewport change notifications; the corner patches
  sit behind the modal so only its rounded cutouts expose them.
- The artifact test invokes the production Pages builder, then checks total,
  top-level group, and selected large-file byte/count budgets. It measures raw
  shipped bytes, not an optimistic gzip estimate.

The 3.1 runtime-split review deliberately raised the script-count ceiling to
accommodate focused controller/domain files while retaining a separate raw-byte
ceiling, so modularity cannot conceal aggregate JavaScript growth. The builder
contract computes the current exact inventory on every run; do not copy a
one-time local artifact count into a future performance claim.

These checks intentionally avoid fragile wall-clock assertions. They answer
questions such as “did another synchronous loader appear?” and “did the
Scheduler regain a viewport-sized blur?” with exact pass/fail results.

## Canonical fixtures

Fixtures are seeded through the versioned public plan-import path and must
assert their exact semantic count after import. Unknown catalog courses may be
skipped by the normal importer, so “at least N courses” is not acceptable.

- `empty`: four fixed terms and no courses.
- `typical`: exactly 24 real CS courses over four fixed terms.
- `scheduler-light`: exactly 60 real courses from the shared CS passing-plan
  fixture over seven fixed terms, with costly Scheduler presentation options
  disabled.
- `scheduler-heavy`: the same exact 60-course/7-term plan, with six courses in
  the selected term and prerequisites, unmet results, details, smart sort,
  availability highlighting, blocked-course display, hide-planned, and hover
  preview enabled.
- `synthetic-pdf-120`: deterministic transcript text with 120 synthetic course
  rows and no personal data.

Every plan uses explicit term codes through Fall 2026-2027, so crossing the
Summer/Fall date boundary cannot silently change the benchmark. Functional E2E
tests remain the source of truth for maximum-size imports, real PDF extraction,
multi-tab behavior, all program combinations, and malformed/legacy storage;
the performance suite does not claim duplicate coverage that it does not run.

## Journey coverage

The smoke profile runs startup and the filter-heavy Scheduler. Nightly and
reference profiles run all ten implemented journeys:

- **Startup:** cold shell navigation and exact 24-course returning-plan
  hydration at the Pages subpath.
- **Planner:** exact 60-course rendering, board scroll, sidebar round trip,
  mobile accordion behavior when applicable, overflow, and model/DOM stability.
- **Course picker:** open/settle, five search states, combined prerequisite,
  unmet, detail, smart-sort, level and credit filters, result scroll, geometry,
  close-button behavior, and cleanup.
- **Scheduler:** open/settle, five search states, each current toggle round trip,
  synthesized scrolling and hover with preview both enabled and disabled,
  dynamic blur geometry across desktop/mobile resize, and cleanup.
- **Summary:** five repeated dense-plan open/detail/back/close cycles and overlay
  cleanup.
- **Transcript parser:** five parses of a deterministic 120-row synthetic PDF
  text stream plus import-menu open/close. This measures the parser, not PDF.js
  extraction or plan mutation.
- **Persistence:** 100 requested saves and flush coalescing, four temporary plan
  duplications/deletions, orphan-key checks, and exact reload hydration.
- **Responsive:** the dense planner at 1440×900, 800×700, 390×844, 568×320, and
  1280×520, including the mobile New Semester-first/newest-term-first contract.
- **Service worker:** controlled warm runtime, cache inventory, offline reload,
  exact 24-course restore, and an explicit bound on offline fallback attempts.
- **Memory:** warmed Scheduler followed by 20 open/close cycles, forced-GC
  samples every five cycles, and document/node/listener/overlay cleanup
  invariants.

The Scheduler blur regression is a first-class journey. It scrolls results with
CDP's synthesized scroll gesture and sweeps hover targets with CDP mouse events;
it does not serialize dozens of slow Playwright wheel calls. It measures both
the normal hover-preview configuration and a preview-disabled control. Resizing
and mobile edge-to-edge layouts verify that only visible margins are blurred.

## Metrics

Browser scenarios collect phase-specific measurements rather than one global
score:

- Scenario and phase wall time for navigation/hydration, planner and picker
  interactions, Scheduler work, Summary cycles, transcript parsing, persistence,
  responsive reflow, offline restore, and memory churn.
- FCP, LCP, CLS, browser-emitted Event Timing/INP-like latency, long tasks,
  Long Animation Frames, and total blocking time. Long-task evidence includes
  count, total/mean/p95/max duration, and counts above 100 ms and 200 ms for
  each phase and the full measured journey. Programmatic controls that do not
  receive Event Timing still retain phase, CDP, frame, and long-task measurements.
- Animation-frame median/p95/worst and counts above 20, 32, and 50 ms for
  in-document interaction phases. Navigation/reload phases are explicitly
  marked unavailable because a document change resets `requestAnimationFrame`;
  their CDP and PerformanceObserver evidence remains valid. A browser may emit
  a first rAF timestamp just before the sampler's `performance.now()` anchor;
  that invalid negative clock-edge delta is discarded, and persisted frame
  summaries accept only finite, non-negative durations.
- CDP task, script, style and layout duration/count deltas, documents, nodes,
  listeners, frames, and JS heap values.
- Request count, encoded transfer bytes, cache/service-worker source, duplicate
  URLs, failed same-origin requests, and synchronous XHR observations.
- Scenario-owned DOM/overlay cleanup, save calls/bytes, and forced-GC memory
  samples where the journey implements them.
- UTC start/end timestamps on every phase, with matching per-phase host CPU,
  clock, browser memory/CPU, battery, and power-source summaries derived from
  the 2 Hz samples.
- Console errors, page errors, action completion, and exact fixture invariants.

Tracing and V8 profiling are diagnostic reruns, never part of a budget sample.
They perturb the timings they are trying to explain. Nightly/reference profiles,
or any run with `--diagnose`, rerun each failed scenario/target once for a trace
and once for a 1,000 µs V8 CPU profile after the unprofiled repetitions. Use
`--no-diagnose` to suppress the profile default while investigating a broad
failure.

## Comparison and gating policy

Historical absolute numbers are not compared across different browser majors,
hardware, power states, viewport/refresh rates, fixtures, cache states, service
worker modes, CPU throttles, or headed/headless modes. For a code regression
decision:

1. Build and measure the base commit and candidate on the same job/machine.
2. Use separate runner invocations with the same target identity and different
   run IDs. For `local-artifact`, change the checkout between runs; for a custom
   HTTP target, replace the build behind the same exact URL between runs.
3. Warm both runs equally. Alternate which revision runs first across repeated
   comparison jobs where practical, and retain every valid sample.
4. Use at least one warmup and three to five recorded repetitions in CI; use
   two warmups and five to nine repetitions on the reference device.
5. Run `node tests/perf/compare.js --base <run> --candidate <run>` to compare
   matched medians, MAD/p95 distributions, threshold deltas, and deterministic
   bootstrap 95% confidence intervals. Add `--mode enforce` only after budgets
   are calibrated. Use `--axis power` only for known, stable, opposite AC and
   battery populations. It derives identity from the strict environment minus
   only power source—including GPU mode and renderer—and fails closed if full
   environment or sampled power evidence is unavailable.
6. Fail duration only when the candidate crosses both a relative and an
   absolute noise floor. Initial calibration uses greater than 15% plus a
   phase-appropriate floor (one display frame for frame metrics, typically
   50 ms for coarse action durations).

Exact invariants—new errors, failed local requests, duplicated schedule loads,
fixture mismatch, leaked overlays/listeners, or deterministic budget excess—can
fail immediately. Timing budgets should run advisory for several calibration
runs before becoming required.

Workload provenance is required even in advisory mode. A missing workload hash
makes the comparison unavailable, while different hashes form different groups
and therefore cannot silently mix changed scenario/harness implementations.
For a pre-provenance artifact only, the explicit
`--allow-missing-workload-provenance` escape hatch disables workload matching
and emits a prominent warning. Label that output historical/advisory; never use
it as a release gate. Establish a new fully provenanced base/candidate pair for
future enforced comparisons. The runner never invents or backfills a hash for
an old record, and the comparison CLI prints the override warning to stderr even
when its JSON result is redirected with `--out`.

## Real-device AC and battery protocol

All browser interaction and sampling is automated. Physically connecting or
disconnecting power is the only manual step.

1. Use the same laptop, display, browser version, clean temporary profile,
   viewport, and fixture for both populations.
2. Close unrelated heavy applications and let the machine reach an idle,
   thermally stable state. Keep the test window foreground and unobscured.
3. Start the AC run only after the runner confirms AC power is stable. For the
   battery run, unplug once and wait for stable battery power. Abort below the
   configured safety level (30% is the default recommendation).
4. Run headed with hardware acceleration. Reference runs classify the active
   renderer and fail unless hardware acceleration is verified. The explicit
   `--allow-software-gpu` escape hatch keeps an intentionally software-rendered
   run labelled as such rather than mixing it with hardware results.
5. Record power before, throughout, and after every iteration and discard an
   iteration if any 2 Hz sample changes source or crosses the battery floor,
   even if its endpoints match. `navigator.getBattery()` is supplemental;
   Windows WMI/power APIs are authoritative. The runner primes one Windows
   sample before the first measured phase, so sub-second journeys cannot finish
   before authoritative sampling starts.
6. Alternate comparison order where practical and retain every valid iteration,
   including outliers. Do not rerun only because a value looks inconvenient.

Example reference-device runs:

```powershell
node tests/perf/run.js --profile reference --browser brave --headed --target local-artifact --power ac --await-power --run-id reference-brave-ac
node tests/perf/run.js --profile reference --browser brave --headed --target local-artifact --power battery --await-power --min-battery 30 --run-id reference-brave-battery
node tests/perf/compare.js --base test-results/perf/reference-brave-ac --candidate test-results/perf/reference-brave-battery --axis power --mode advisory --out test-results/perf/reference-brave-power-comparison.json
```

The environment record includes laptop model, CPU/core/thread/clock data,
GPU/driver/renderer, RAM, OS version, browser/version/command line, viewport/DPR,
measured display interval, battery percentage/rate, AC/charging state, active
Windows power scheme, and processor policy. Roughly 2 Hz samples include host
CPU/clock/RAM, browser working set/private memory/cumulative CPU, battery state,
and CDP browser-process data. Real GPU automation must run in an interactive
Windows session; locked desktops, services, and disconnected RDP sessions can
lose acceleration.

## Results and artifacts

All output belongs under the ignored directory:

```text
test-results/perf/<run-id>/
  manifest.json
  iterations.ndjson
  summary.json
  summary.csv
  report.md
  report.html
  system/
  logs/
  traces/
  profiles/
  diagnostics/
```

Playwright correctness runs write only to `test-results/playwright/`. Keep that
separation: Playwright clears its output directory on startup, so pointing it at
the shared `test-results/` root would erase retained performance populations.

An iteration record is appended as soon as that iteration completes, so an
interrupted battery run remains useful. CI uploads `test-results/perf/` with
`if: always()` for both successful and failed browser runs.

Markdown and HTML reports include a per-metric `Samples` column. Check it before
interpreting a median or p95: a row with fewer samples than the group's recorded
iteration count is valid sparse evidence, not a full-population statistic.

## Updating a contract or timing baseline

Never update a baseline merely to make CI green.

1. Reproduce the failure from a clean checkout and inspect the exact changed
   selector/site/file or the base-versus-candidate distribution.
2. Prefer removing the new risk, reducing bytes, or fixing duplicate work.
3. If growth is intentional, record why it is user-visible value, its raw and
   transfer cost, and the measurement environment in the change description.
4. Change only the affected entry in `contracts/baseline.json`; retain modest
   headroom rather than copying the observed value exactly.
5. Run the contracts, smoke profile, relevant focused scenario, and ordinary
   functional tests before review.

Removing a known risky site does not require lowering its inventory immediately:
the comparison is downward-only. Lowering the stored ceiling in the same change
is encouraged because it tightens the ratchet for future work.

## Troubleshooting

- **Artifact contract says the manifest is stale:** run the repository's normal
  manifest generator, inspect its data diff, then rerun the contract. Do not
  bypass production artifact validation.
- **A timing result is noisy:** verify no other benchmark job is running, close
  overlays/background software, keep the window visible, increase repetitions,
  and compare matched environments. Do not add retries.
- **GPU reports software rendering:** confirm hardware acceleration, interactive
  desktop state, driver/browser version, and launch arguments. Hosted CI remains
  valid only for its software-rendered lane.
- **Battery state disagrees with the browser API:** trust the Windows power
  record and reject the iteration if any endpoint or in-run sample is unstable.
- **Live and local-artifact disagree:** compare recorded asset hashes,
  service-worker controller/cache state, response headers, and failed requests
  before attributing the difference to application code.
- **A trace is much slower than the budget run:** expected—use the trace for
  attribution, not as the measured regression value.
