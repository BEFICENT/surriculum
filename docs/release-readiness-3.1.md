# SUrriculum 3.1 release-readiness tracker

Last updated: 2026-07-23

This is the working backlog for the 3.1 release. Items should be handled one at
a time and checked off only after the fix and its verification are complete.

## Decisions and constraints already recorded

- The two academic-record PDFs belong to the maintainer or to a friend who
  consented to their use. This substantially changes the privacy assessment.
  They are nevertheless public downloads and remain recoverable from Git
  history, so retaining real records should remain an explicit release decision.
- PDF.js 2.10.377 is formally affected by CVE-2024-4367. The disclosed exploit
  path appears to require glyph rendering, while SUrriculum only extracts text,
  but that reduced reachability is an inference rather than a vendor guarantee.
- Do not expand test coverage yet. A dedicated coverage pass will happen before
  release when requested.
- The `surriculum-3.1` branch is published but has not been merged into `main`.
- Claude co-author trailers were removed from the rewritten branch history.
- Preserve the individual 3.1 commits. Do not squash or rebase the branch merely
  to simplify GitHub's ahead/behind display; the intended history edits are only
  the removal of Claude trailers from commit messages.

## Verified baseline

- [x] JavaScript/static unit gate passes: 94/94 tests.
- [x] Playwright gate passes: 277/277 tests in a clean dedicated run.
- [x] `python tests/scrape_groups_test.py` passes when run directly.
- [x] All 228,387 JSONL rows parse successfully.
- [x] Manifest hashes and the content-derived data version match the data tree.
- [x] Extended 21-term catalog/requirements integrity audit passes.
- [x] npm-managed dependencies report no known vulnerabilities.
- [x] No runtime analytics, telemetry, or transcript upload was found.

## Release-history cleanup

- [x] Reconstruct the message-only cleanup without rewriting shared `main`
  ancestors.

  The backup proves that immediately before the Claude cleanup, the original
  3.1 tip was 108 commits ahead and 0 behind the then-current `main`. Current
  `main` has since advanced by 22 commits. The inflated 532-ahead/446-behind
  result occurred because the cleanup regenerated hundreds of commits that were
  previously shared with `main`, even though the intended edits were messages.

  The commit-preserving repair is to start from the pre-cleanup backup, leave the
  shared `main` ancestry untouched, and remove Claude trailers only from the 108
  branch-only commits. Preserve each commit's tree, order, parent structure,
  author, committer date, and remaining message. Hashes must still change because
  a Git commit message is part of the hashed commit object. Verify the final tip
  tree and the per-commit patch sequence against both the original and current
  cleaned histories before force-pushing with lease.

  Completed on 2026-07-22. The repaired and pushed tip is `e1151f1`. All 108
  commits retain identical trees, per-commit changes, ordering, authors,
  timestamps, and non-Claude message content. The final application tree is
  byte-for-byte identical to both pre-repair tips, and the resulting topology
  against current `origin/main` is 108 ahead and 22 behind. A complete recovery
  bundle is stored outside the repository at
  `C:\Users\mehme\repos\surriculum-before-ancestry-repair-20260722-223259.bundle`.

  To reach 0 behind while retaining every divergent commit
  and avoiding a rebase, merge current `origin/main` into `surriculum-3.1`; this
  does not merge or release 3.1 into `main`. It should then be about 109 ahead and
  0 behind. If no merge commit is wanted in either direction, the truthful Git
  topology must remain 22 behind—Git cannot record current `main` as an ancestor
  while preserving the divergent chain without either a merge or a rebase.

## Security and privacy decisions

- [ ] Decide whether the consented real academic-record PDFs should remain in a
  public repository or be replaced by synthetic fixtures before release.
- [x] Apply the official interim PDF.js mitigation. Completed on 2026-07-23:
  user-selected PDFs are opened with `isEvalSupported: false`, Mozilla's
  documented workaround for affected releases. The app remains on 2.10.377, so
  this is defense in depth rather than an upgrade or a claim that the old
  dependency is fully resolved.
- [ ] Upgrade and self-host PDF.js before release. The CDN-loaded main library
  and local worker currently match at 2.10.377, but releases through 4.1.392 are
  covered by CVE-2024-4367 and the external CDN script has no integrity
  check. The investigated target is a matched, locally vendored 6.1.200 legacy
  ESM main/worker pair, lazy-loaded only when a PDF is selected. PDF.js 6.1.200
  targets Safari 18 or newer; if Safari 16.4-17 support is required, 5.7.284 is
  a possible compatibility bridge but is neither current nor an LTS release.
  Decide the browser floor before migrating.

  The migration must replace the classic global script with `import()`, set a
  subpath-safe worker URL, preserve `isEvalSupported: false`, dispose of the
  loading task/document after extraction, and choose either `useWasm: false`
  for this text-only path or locally ship the matching WASM assets and licenses.
  Add sensible file/page/text limits. Before accepting the upgrade, compare the
  extracted text and parsed courses from both consented example PDFs, remove the
  test harness's ignored `pdfjsLib is not defined` error, and include the local
  PDF assets in the eventual service-worker/offline fix.
- [x] Validate every nested field in imported plan JSON and custom courses.
  Completed on 2026-07-23: imports are size- and shape-bounded, nested plan,
  scheduler, and custom-course fields are normalized before storage, unknown or
  invalid fields fail closed, and a rejected import cannot leave a partial plan.
- [x] Replace unescaped `innerHTML` rendering of imported/custom values with
  safe text rendering. Completed on 2026-07-23: planner cards, semester labels,
  course selectors, datalists, and dual-degree labels now treat imported text as
  text. An ad-hoc malicious-import check passed; add its permanent regression
  coverage during the future coverage pass.
- [ ] Consider self-hosting runtime third-party assets and adding a restrictive
  Content Security Policy.

## Graduation and data correctness

- [x] Make requirement scraping atomic. A partial per-program scrape must not
  overwrite a complete term. Completed on 2026-07-22: all 12 programs are now
  fetched and validated before a same-directory temporary file atomically
  replaces the term; failures preserve the last-known-good file and return a
  nonzero command status.
- [x] Validate required programs and requirement schemas at load time; if data
  is unavailable or incomplete, graduation evaluation must fail closed and show
  a clear message. Completed on 2026-07-22: selected admit terms now load exact
  data (including first-run initialization), partial/duplicate/wrong-term data
  is rejected, and graduation/summary display an Unavailable state via flag 99.
- [x] Ensure failed course attempts cannot satisfy degree rules that previously
  relied on `hasCourse`, internship, alternative-course, pool, or other
  degree-completion paths. Completed on
  2026-07-22: grades now live on the course model; F/U/NA/W attempts remain
  structurally present but are excluded from main, double-major, minor,
  requirement-group, alternative-pair, core-pool, and scheduler-prerequisite
  calculations. Grade save/reload is model-backed, so opening the grade picker
  can no longer autosave a failed attempt as blank. Ordinary `hasCourse` remains
  structural for duplicate prevention and existing planner behavior.
- [ ] Separate projected-plan credit from completed/earned credit. Blank,
  Registered, P, and I currently remain eligible in the forward-looking plan,
  but the UI and tests call those credits "earned" and `canGraduate` does not
  distinguish an actual transcript audit from a projection.
- [ ] Align special-grade and GPA semantics with university rules. In
  particular, S is currently treated as 4.0 GPA; U/NA/W are now excluded from
  degree-plan credit but NA's GPA treatment and P/I presentation still need an
  explicit product decision and a complete grade-status matrix.
- [ ] Support repeated attempts and retake planning. The model globally rejects
  a second canonical course code, so a retained failed attempt blocks adding a
  future retake. Transcript import also needs deterministic latest-attempt
  selection and should replace an existing planned placeholder rather than
  silently skipping the completed attempt.
- [ ] Give unsuccessful attempts a distinct Summary state instead of placing
  them in the generic "untaken" bucket.
- [x] Keep planner and scheduler offered-course data aligned. The planner now
  uses the exact current-term schedule when it is available, schedule scrapes
  reconcile offerings back into the course-page dataset, and the weekly full
  course-page refresh preserves valid schedule-derived offerings.
- [x] Make the daily refresh regenerate and verify `data/manifest.json` before
  opening its update PR.
- [ ] Decide whether all runtime JSON inputs, including
  `courses/schedule_subjects.json`, should be included in the manifest.

## Scheduler and persistence

- [ ] Preserve Saturday and late-evening meetings in display and conflict
  detection. Current data includes Saturday meetings and classes ending at
  20:30, outside the scheduler's Monday-Friday 08:40-19:30 grid.
- [ ] Make scheduler replacement transactional so a rendering/build failure
  cannot leave the plan partially cleared.
- [x] Replace origin-wide `localStorage.clear()` with deletion of only known
  SUrriculum keys. Completed on 2026-07-23: reset now removes namespaced plan
  data plus the explicit legacy, preference, scheduler, and valid dynamic keys;
  it reloads only after a successful reset. A browser check confirmed that an
  unrelated origin key and a near-match legacy key survive while SUrriculum data
  is removed and legacy migration does not restore it.
- [ ] Namespace the still-global SUrriculum preference and scheduler keys, then
  migrate their existing values. Scoped reset is safe now, but namespacing keys
  such as `theme` will also prevent ordinary writes from colliding with another
  app on a shared origin.
- [ ] Save on mutations with a short debounce and flush on `pagehide` or hidden
  visibility so quick closes/mobile backgrounding do not lose recent edits.

## GitHub Pages and offline behavior

- [ ] Fix service-worker URLs for the `/surriculum/` Pages subpath and add an
  offline/subpath test during the future coverage pass.
- [ ] Restrict service-worker cache cleanup to SUrriculum-owned cache-name
  prefixes instead of deleting other caches on the shared Pages origin.
- [ ] Choose an explicit 3.1 deployment path. GitHub Pages currently publishes
  `main`, so pushing `surriculum-3.1` does not release it.
- [ ] Prefer a GitHub Pages Actions deployment containing an allowlisted
  production artifact instead of publishing the entire repository root.
- [ ] Align the daily data-refresh workflow with whichever branch/artifact is
  used for production.

## Test-suite work (deferred until requested)

- [ ] Integrate `tests/scrape_groups_test.py` into the normal test command. It is
  a standalone Python assertion script, is not discovered by the Node test
  runner, and is currently omitted from `npm test` and CI. A likely structure is
  a `test:python` npm script included by `npm test`, while keeping the direct
  Python command available.
- [ ] Expand coverage for the release blockers above.
- [ ] Add the deferred grade-status/repeat matrix: S/P/I/U/NA semantics, failed
  named/static/pool rules, scheduler prerequisites, autosave while editing a
  grade, document-order-independent repeats, and import over a planned
  placeholder.
- [ ] Add Firefox and WebKit coverage for critical flows; current Playwright
  projects cover desktop Chromium and a Pixel 7 Chromium profile.
- [ ] Add CI that runs npm tests, the Python parity check, and data/manifest
  validation; protect the release branch after the gate is stable.

## Accessibility, documentation, and release polish

- [ ] Add accessible names to selectors, checkboxes, icon buttons, and delete
  controls.
- [ ] Add keyboard equivalents for drag/reorder workflows and proper dialog
  labelling, focus trapping, and focus restoration.
- [ ] Correct known color-contrast failures and respect reduced-motion settings.
- [ ] Fix README quick-start instructions: the application must be served over
  HTTP; opening `index.html` directly does not reliably load modules/data.
- [ ] Update remaining v3.0 references to 3.1.
- [ ] Add concise privacy copy for transcript processing and local persistence.
- [ ] Add a changelog, release notes, rollback notes, and a `v3.1.0` tag.
- [ ] Remove or verify the hard-coded structured-data aggregate rating before
  public release.
- [ ] Review tracked editor/development artifacts such as `.claude/launch.json`
  and `.vscode/settings.json`.
