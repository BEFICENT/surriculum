# SUrriculum 3.1 release-readiness tracker

Last updated: 2026-08-03

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
- Broad release-blocker coverage remains deferred. Focused graduation and
  scheduler regressions were added when specifically requested.
- The `surriculum-3.1` branch is published but has not been merged into `main`.
- Claude co-author trailers were removed from the rewritten branch history.
- Preserve the individual 3.1 commits. Do not squash or rebase the branch merely
  to simplify GitHub's ahead/behind display; the intended history edits are only
  the removal of Claude trailers from commit messages.

## Verified baseline

- [x] JavaScript/static unit gate passes: 160/160 tests.
- [x] Playwright gate exits clean with 349 tests: 348 passed on the first
  attempt and one recovered on retry after the external Font Awesome CDN
  intermittently rejected its webfont with a CORS error.
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
  Content Security Policy. The 2026-08-03 full browser gate reproduced the
  availability risk: a Font Awesome CDN webfont was intermittently blocked by
  CORS; Playwright's configured retry recovered without an application failure.

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
- [ ] Resolve live SUIS requirement-page ambiguities and restore current
  requirement snapshots. Re-captured on 2026-07-23: EE pages for
  `202201`-`202403` state Total 125 while their five category minima total 123;
  ME pages for `202301`-`202403` have the same two-credit gap. This is probably
  not a contradiction: the MATH 212 route is four SU credits while the MATH
  201+202 route is six, and category minima need not equal the independent
  overall-credit minimum. The current validator wrongly requires equality and
  the local EE/ME snapshots compensate by inflating Required by two credits.
  Change the invariant to `category sum <= total`, restore the captured category
  minima, represent the mathematics alternatives explicitly, and retain Total
  as the final overall threshold. Separately, ME `202501` onward really does say
  Core 21 in its numeric summary but 26 in category prose; use the numeric
  summary as the provisional authority only after documenting/confirming that
  policy. The current fail-closed scraper prevents adding official `202601`-
  `202603` pages until these cases are handled.
- [ ] Define the policy for `requirements/default.jsonl`. It matches no actual
  admit term and mixes older thresholds with a partially newer VACD pool, so it
  should either become an explicit frozen snapshot or track a named/latest term.
- [x] Ensure failed course attempts cannot satisfy degree rules that previously
  relied on `hasCourse`, internship, alternative-course, pool, or other
  degree-completion paths. Completed on
  2026-07-22: grades now live on the course model; F/U/NA/W attempts remain
  structurally present but are excluded from main, double-major, minor,
  requirement-group, alternative-pair, core-pool, and scheduler-prerequisite
  calculations. Grade save/reload is model-backed, so opening the grade picker
  can no longer autosave a failed attempt as blank. Ordinary `hasCourse` remains
  structural for duplicate prevention and existing planner behavior.
- [x] Separate projected-plan credit from completed/earned credit. Completed on
  2026-07-30: semesters now retain stable term codes and every course is
  classified as earned, current, future, unverified-past, or unsuccessful. A
  posted successful grade in the current term counts as earned immediately;
  successful/pending future-term grades remain planning estimates, while an
  explicit F/U/NA/W never projects successful credit. Main-major and double-major
  completion use independent earned and projected allocation passes (including
  alternatives, named pools, cascade overflow, MAN diversity, special rules,
  and GPA), and minor completion uses the same state policy. Desktop Summary,
  detailed pool/group views, Graduation Check, and Mobile Progress now show
  earned/current/future/needs-grade values with text-labelled segmented
  colors. Pool allocation prioritizes earned credit before current, future, and
  unverified work so later plans cannot displace visible earned progress. Only
  the earned audit can say Complete; a plan-only pass says
  Projected complete, and an earned audit with no real GPA fails closed. On
  2026-07-31, the remaining Summary and legacy graduation/minor consumers were
  aligned with the same time-aware actual GPA: future-term entered grades no
  longer leak through the zero-credit fallback, while posted current-term
  grades still count immediately.
- [x] Align special-grade and GPA semantics with university rules. Completed on
  2026-08-01: one canonical policy now defines the accepted grade vocabulary,
  letter points, credit eligibility, pending states, and GPA treatment. S and T
  earn GPA-neutral credit; U and W do not; P and I remain projected only in a
  current/future term; F earns no degree credit but remains a zero-point GPA
  attempt. NA is F-equivalent on a letter basis and U-equivalent on an S/U
  basis; an unknown positive-credit basis leaves actual GPA unresolved and all
  graduation paths fail closed with a visible review warning. Unsupported
  tokens, including A+, earn and project nothing. A posted current-term final
  grade is actual immediately, while a future-term grade remains an estimate.

  Grading basis is stored per planned occurrence, survives autosave and v2 plan
  export/import, and is synthesized conservatively for v1/schema-1 plans.
  Decisive A-F and S/U grades override stale basis metadata. The grade picker
  exposes the full supported set and explicit letter/S-U choices for NA without
  clearing a grade when dismissed. Transcript import retains W and NA, reports
  unsupported grades, and passes aligned basis metadata into the plan. The
  policy does not auto-convert an unresolved I to F/U; the eventual official
  replacement grade remains the source of truth.

  The persistence review also fixed three adjacent data-loss paths: a partial
  plan import no longer drops grades when dates are absent; deleting the active
  plan no longer recreates its removed namespace through a stale save hook; and
  a stale/misaligned grading-basis array is repaired before export so the app's
  own v2 file remains re-importable.
- [x] Add Program GPA (PGPA) to graduation evaluation. Completed on 2026-08-03:
  main-degree completion now requires both CGPA and main-program PGPA to be at
  least 2.00. Double-major completion requires CGPA, main-program PGPA, and
  double-major PGPA to meet 3.20 (2.72 for pre-2019 admits). Minor completion
  requires both CGPA and that minor's PGPA to meet 2.72, except Entrepreneurship
  at 2.50. Program membership follows each program's effective allocation;
  effective N/A courses remain in CGPA but are excluded from PGPA. A separate
  membership pass keeps GPA-bearing failures in PGPA without awarding degree
  credit or consuming a fulfilled requirement slot.

  Actual averages use posted grades from known current/past terms, so a posted
  current-term grade counts immediately; future-term entered grades never make
  an earned graduation check pass. Summary, Graduation Check, and Mobile
  Progress show CGPA and the relevant PGPA separately. They may also show a
  clearly labelled projected PGPA from entered future grade estimates and
  report program credits that still need an estimate.
- [ ] Retain valid transcript courses that are outside the currently selected
  program catalogs. Imports currently reject those records. Later, keep them as
  effective N/A so they can contribute to CGPA, while excluding them from PGPA
  until program membership is known. Do not infer membership merely from the
  programs selected at import time.
- [ ] Support repeated attempts and retake planning. The model globally rejects
  a second canonical course code, so a retained failed attempt blocks adding a
  future retake. Official GPA calculation uses the latest repeated-course grade
  while the transcript retains all attempts. Preserve attempts, derive the
  active/latest one by term and attempt order, and make every import path use the
  same reconciliation. Importing a completed attempt should replace an existing
  planned placeholder rather than reporting success while leaving it unchanged.

  Interim import reconciliation completed on 2026-08-01: HTML, PDF, and YÖK
  imports now select the latest record chronologically instead of trusting
  document order; YÖK Repeated/Excluded rows are skipped; same-term planned
  occurrences update in place; empty/phantom imports are avoided; and added,
  updated, already-present, superseded, invalid-grade, skipped, and not-found
  records are reported truthfully. This does not yet preserve multiple attempts
  or allow a failed/withdrawn occurrence and a later retake to coexist.
- [ ] Harden shifted-layout PDF transcript grade-column detection. The normal
  tracked PDF extracts correctly, but the fallback parsers still infer a grade
  from token position: wrapped title/status text after a missing column can be
  reported as an unsupported grade, while a missing level marker can let an
  unsupported grade blend into the title. Define a bounded grade-like token
  grammar and add synthetic wrapped-title/missing-level cases before changing
  this fragile fallback. The Microsoft Print-to-PDF sample contains no PDF.js
  text items at all and will still require a clearer re-export/OCR path.
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

- [x] Preserve weekend and late-evening meetings in display and conflict
  detection. Completed on 2026-07-28: the grid remains Monday-Friday and at its
  standard height until an exact selected section or active preview needs an
  additional day or later time. It then adds Saturday/Sunday and/or extends to
  the next hour boundary, collapsing again when the selection/preview is gone.
  All valid intervals participate in availability, section choice, blocked-hour
  checks, and conflicts even while their extra UI is hidden. Weekend blocked
  ranges now survive plan import/export but do not expand the grid by themselves.
  Historical Sunday meetings receive the same policy; incomplete/TBA meetings
  remain selectable but are neutral rather than incorrectly marked available,
  and selected incomplete sections warn that conflict checking is partial.
  Frozen browser coverage uses real `202403` Saturday/22:00 sections across
  desktop and mobile, plus a real `202402` Sunday section on desktop.
- [x] Make date-specific intensive meetings date-aware. Completed on
  2026-07-28: repeated exact slots are collapsed into one visible block with all
  of their date windows, while timetable phases with different clocks remain
  separately visible. Availability, bundle scoring, blocked-hour checks,
  selected-section conflicts, time-equivalence keys, and schedule-change
  snapshots now use calendar-aware intervals. Missing/malformed dates remain
  conservative rather than creating false availability. The overlap check also
  verifies that the shared calendar range actually contains the stated weekday.
  An audit of the 23 active schedule files found 34,843 meeting rows, all with
  parseable ranges; 325 sections repeat 616 exact slots, 344 sections overlap in
  a weekly projection, and none self-overlap on an actual date. Seven frozen
  browser regressions cover repeated intensives, disjoint/shared dates, a
  no-shared-weekday boundary, and a section whose timetable changes mid-term.
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
  offline/subpath test during the future coverage pass. The app's ordinary
  relative URLs are subpath-safe, but the service worker precaches leading-`/`
  URLs at the account root. The atomic precache can therefore fail on Pages;
  its swallowed install error can still allow an empty new cache to activate
  and replace a previously useful one. Build URLs from
  `self.registration.scope`, precache the complete shell atomically, and test a
  mounted `/surriculum/` installation plus offline reload.
- [ ] Restrict service-worker cache cleanup to SUrriculum-owned cache-name
  prefixes instead of deleting other caches on the shared Pages origin. Runtime
  caching should likewise be restricted to the worker's own scope and await
  cache writes.
- [x] Choose an explicit 3.1 deployment path. Verified on 2026-07-28: GitHub
  Pages uses the legacy branch configuration and publishes the repository root
  from `main`. The final release will merge `surriculum-3.1` into `main`, which
  automatically triggers `pages-build-deployment`; pushing the feature branch
  alone does not deploy. Use a merge commit to preserve every 3.1 commit—do not
  squash or rebase at merge time.
- [ ] Prefer a GitHub Pages Actions deployment containing an allowlisted
  production artifact instead of publishing the entire repository root.
- [x] Align the daily data-refresh workflow with the chosen production branch.
  It runs from the default `main` branch and opens data-update PRs against it;
  merging one of those PRs will trigger the same legacy Pages deployment.

## Test-suite work

- [ ] Integrate `tests/scrape_groups_test.py` into the normal test command. It is
  a standalone Python assertion script, is not discovered by the Node test
  runner, and is currently omitted from `npm test` and CI. A likely structure is
  a `test:python` npm script included by `npm test`, while keeping the direct
  Python command available.
- [ ] Expand coverage for the release blockers above. A focused graduation pass
  completed on 2026-07-23 adds 48 non-duplicative cases: 42 unit/data checks and
  six browser checks. It pins live SUIS threshold transitions for BIO, CS, IE,
  MAT, and DSA; historical PSIR/VACD pool changes; executable/catalog-backed
  graduation rules across all 21 stored admit terms; exact MAN/DSA/faculty
  boundaries; unsuccessful/projected grade eligibility; missing progress-row
  evaluators; and all non-CS internship programs. The saved pool-page test now
  verifies its real `202501` fixture identity. Broader release-blocker coverage
  remains open.
- [x] Add the deferred special-grade matrix. Unit and browser regressions now
  cover A-F/S/P/I/U/T/NA/W/blank/unsupported outcomes, letter-vs-S/U NA, actual
  versus future GPA, failed degree allocation, grading-basis persistence and
  legacy migration, grade-picker/autosave behavior, and fail-closed warnings.
- [ ] Add the remaining repeat-attempt matrix: retained multi-attempt history,
  cross-term retake planning, scheduler prerequisites after a retake, and
  replacement/movement of a planned placeholder when the imported attempt is
  in a different term.
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
