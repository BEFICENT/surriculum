# SUrriculum 3.1 release-readiness tracker

Last updated: 2026-08-09

This is the working backlog for the 3.1 release. Items should be handled one at
a time and checked off only after the fix and its verification are complete.

## Decisions and constraints already recorded

- The two academic-record PDFs belong to the maintainer or to a friend who
  consented to their use. The maintainer has explicitly decided that these
  consented fixtures will remain public; this is settled, not an open release
  decision.
- The old PDF.js 2.10.377 runtime was formally affected by CVE-2024-4367. It
  has been replaced by the locally vendored, patched 6.2.108 release described
  below.
- Broad release-blocker coverage remains deferred. Focused graduation and
  scheduler regressions were added when specifically requested.
- The `surriculum-3.1` branch is published but has not been merged into `main`.
  Additional local commits and the current worktree are being held for the
  production-ready push, as requested; topology must be re-measured immediately
  before release instead of copying a stale ahead/behind count into this file.
- Claude co-author trailers were removed from the rewritten branch history.
- Preserve the individual 3.1 commits. Do not squash or rebase the branch merely
  to simplify GitHub's ahead/behind display; the intended history edits are only
  the removal of Claude trailers from commit messages.

## Verified baseline

- [x] JavaScript/static unit gate passes: 235/235 tests.
- [ ] The current Chromium Playwright inventory is 464 tests (446 desktop and
  18 mobile). On 2026-08-08, the then-current 451-test local run plus a
  failed-case rerun cleared 448 scenarios; the three remaining cases are the
  mounted GitHub-Pages/offline service-worker checks, which were blocked by
  repeated Windows localhost `ERR_NETWORK_ACCESS_DENIED`/`WinError 10053`
  failures before their app assertions could run. The three new narrow-mobile
  layout regressions pass at 320, 360, and default mobile widths. Rerun the full
  464-test gate in a stable environment before release. The new language-course
  focused browser suites pass 31/31, and the program-scoped custom-category
  suite passes 9/9.
- [x] Focused cross-browser gate passes: 2/2 critical flows (Firefox and
  WebKit), also with zero retries.
- [x] `python tests/scrape_groups_test.py` passes when run directly.
- [x] `python tests/scrape_coursepages_fallback_test.py` passes: 3/3 tests.
- [x] SUIS degree-page validation/publication regressions pass: 16/16 tests.
- [x] Python requirement validation and checked-in manifest integrity checks pass.
- [x] All 219,412 deterministic runtime JSONL rows parse successfully.
- [x] Manifest hashes and the content-derived data version match the data tree.
- [x] Extended 23-term catalog/requirements integrity audit passes.
- [x] npm-managed dependencies report no known vulnerabilities.
- [x] No runtime analytics, telemetry, or transcript upload was found.

## Exchange and language-course handling

- [x] Import exact `LANG` transcript subjects for every selected program while
  preserving the recorded grade, title, SU credits, ECTS, and semester. The
  importer never synthesizes a `T` grade: non-FENS definitions are free
  electives, while FENS definitions are effective N/A. Main and double-major
  classifications are stored independently and rolled back together if review
  is skipped or persistence fails.
- [x] Add a reviewed language-level field for foreign/custom courses. Only
  explicit **Basic**/**Beginning** title wording seeds a suggestion; otherwise
  the user must choose beginning/basic or higher/other. The value survives plan
  export/import validation.
- [x] Enforce the published maximum of two beginning/basic language courses as
  an allocation rule. The first two eligible attempts receive free/degree
  credit; later ones remain visible and CGPA-active but are labelled effective
  N/A and excluded from degree totals. Higher-level courses remain uncapped,
  and the recognized built-in set includes historical ARA/CHI/ITA/JAP/LAT/
  PERS/RUS courses rather than only the former eight-code subset.

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
  byte-for-byte identical to both pre-repair tips. At the time of that repair,
  its topology against `origin/main` was 108 ahead and 22 behind. A complete
  recovery bundle is stored outside the repository at
  `C:\Users\mehme\repos\surriculum-before-ancestry-repair-20260722-223259.bundle`.

  As of 2026-08-08, the published feature branch is 110 ahead and 34 behind
  `origin/main`. The local count is intentionally omitted until the final
  commits are complete. To reach 0 behind
  while retaining every divergent commit and avoiding a rebase, merge current
  `origin/main` into `surriculum-3.1`; this does not merge or release 3.1 into
  `main`. If no merge commit is wanted in either direction, the truthful Git
  topology must remain behind—Git cannot record current `main` as an ancestor
  while preserving the divergent chain without either a merge or a rebase.

## Security and privacy decisions

- [x] Keep the consented real academic-record PDFs public. This decision was
  explicitly confirmed by the maintainer and must not be reopened as an
  unresolved release item.
- [x] Apply the official interim PDF.js mitigation. Completed on 2026-07-23:
  the old 2.10.377 runtime opened user-selected PDFs with
  `isEvalSupported: false`, Mozilla's documented CVE-2024-4367 workaround. This
  historical mitigation was retired with the completed upgrade below; the
  option no longer exists in PDF.js 6.2.
- [x] Upgrade and self-host PDF.js before release. Completed on 2026-08-08 with
  the exact matched legacy-ESM main/worker pair from `pdfjs-dist@6.2.108`, plus
  its Apache-2.0 license and recorded npm integrity/SHA-256 provenance. The
  earlier 6.1.200/5.7.284 candidates were rejected after Mozilla disclosed
  CVE-2026-16633: releases from 5.6.83 through 6.2.107 are affected, while
  6.2.108 is patched. The old unpkg script and 2.10.377 worker are gone.

  The runtime is lazy-imported from a same-origin, versioned path and uses its
  matching subpath-safe module worker. This text-only importer disables optional
  WASM loading, caps input at 10 MiB / 100 pages / 50,000 text fragments /
  1,000,000 extracted characters, and always destroys the PDF loading task.
  Main and worker are installed atomically into a dedicated versioned
  service-worker cache, survive daily app/data cache rotations without another
  download, and work on first use while offline. The supported legacy-build
  floor for this PDF.js major is Firefox ESR+, Chrome 125+, and Safari 18+
  (mostly); Firefox/WebKit receive a focused critical-flow gate rather than the
  full Chromium matrix.

  Real-fixture comparison found changed text-item segmentation but the same 38
  parsed courses and import semantics for the normal Academic Records Summary.
  Both old and new versions extract zero text from the Microsoft Print-to-PDF
  fixture because it has no text layer; the UI now identifies that case and
  gives browser Save-as-PDF, complete-HTML, and OCR guidance. The real Basic
  Science and Engineering ECTS credit-distribution catalog remains rejected by
  its accurately labelled wrong-file path; it is not a Degree Evaluation
  document. Permanent
  tests also verify same-origin loading, version/hash pairing, limits, mounted
  `/surriculum/` URLs, and first-use offline extraction.
- [x] Validate every nested field in imported plan JSON and custom courses.
  Completed on 2026-07-23: imports are size- and shape-bounded, nested plan,
  scheduler, and custom-course fields are normalized before storage, unknown or
  invalid fields fail closed, and a rejected import cannot leave a partial plan.
- [x] Replace unescaped `innerHTML` rendering of imported/custom values with
  safe text rendering. Completed on 2026-07-23: planner cards, semester labels,
  course selectors, datalists, and dual-degree labels now treat imported text as
  text. An ad-hoc malicious-import check passed; add its permanent regression
  coverage during the future coverage pass.
- [x] Self-host runtime third-party assets and add a restrictive Content
  Security Policy. Completed on 2026-08-08: the exact Inter 5.3.0 variable-font
  subsets and Font Awesome Free 6.4.0 solid runtime are locally vendored with
  their licenses and package provenance. Google Fonts and Font Awesome CDN
  requests are removed from the page and service-worker shell.

  A same-origin meta CSP now restricts scripts, fonts, workers, connections,
  manifests, images, forms, and objects. The two inline event handlers were
  replaced with ordinary listeners; the reviewed JSON-LD block is the only
  inline script and is allowed by its exact hash. Inline style remains allowed
  because the existing UI uses both style attributes and dynamic style writes.
  Static tests pin the local assets, licenses, CSP directives, script hash, and
  absence of known runtime CDN references.

## Graduation and data correctness

- [x] Make requirement scraping atomic. A partial per-program scrape must not
  overwrite a complete term. Completed on 2026-07-22: all 12 programs are now
  fetched and validated before a same-directory temporary file atomically
  replaces the term; failures preserve the last-known-good file and return a
  nonzero command status.
- [x] Reject valid-looking SUIS fallback pages returned with HTTP 200 for an
  unavailable term. Completed on 2026-08-08: major requirements, major course
  catalogs, and minor detail scrapes now accept only `YYYY01`/`02`/`03` term
  codes and require the page's displayed **Admit Term** to match the requested
  term before parsing. Missing or blank headings, mismatches, and
  complete-looking fallback curriculum pages fail closed. Course-catalog
  discovery also requires the complete expected program list. Successful term
  rows merge atomically into `courses/terms.jsonl`; failed and unrequested rows
  remain last-known-good. Full minor-term refreshes stage requirements, catalogs,
  optional legacy snapshots, and the term manifest together and roll back if
  any selected minor or publication fails. `--programs`/`--max-programs` runs
  merge without truncating unselected data. Minor subprocess failures propagate
  through both parent scrapers. Sixteen offline regressions cover response
  identity, input rejection, manifest merging, atomic preservation, debug
  limits, and subprocess status; the fast daily data gate runs them.
- [x] Validate required programs and requirement schemas at load time; if data
  is unavailable or incomplete, graduation evaluation must fail closed and show
  a clear message. Completed on 2026-07-22: selected admit terms now load exact
  data (including first-run initialization), partial/duplicate/wrong-term data
  is rejected, and graduation/summary display an Unavailable state via flag 99.
- [x] Restore the official pre-2025 EE/ME category minima without weakening the
  independent overall Total. Completed on 2026-08-08: both scraper and browser
  validators now accept `category sum <= total` while rejecting a sum above
  Total. EE `202201`-`202403` now stores Required 33 and ME `202301`-`202403`
  stores Required 32, matching the live pages' 123 category SU / 125 Total.
  Route tests cover MATH 212, MATH 201+202, either incomplete half, and the
  separate 125-SU check. The current live `202601`-`202603` pages validate; they
  are not local yet because the generated term window does not include them
  before Fall 2026-2027 becomes current.
- [x] Resolve the separate ME `202501`-onward source ambiguity. The structured
  numeric summary is authoritative over the inconsistent prose, so Core remains
  21 for `202501`-`202503`. Those values sum exactly to the independent 131-SU
  Total, have remained stable across repeated live scraper refreshes, and are
  now pinned for all three terms plus the 20/21-SU graduation boundary.
- [ ] Decide the rare pre-2025 EE/ME mathematics edge policy when a student has
  all three of MATH 201, MATH 202, and MATH 212. Ordinary valid routes are now
  correct; no extra course is excluded in the all-three case until repeat/order
  semantics are specified. Also revisit whether a failed low-credit named
  requirement such as EE 200 should ever be enforced beyond credit minima; the
  planner now warns about its EE 202 corequisite, but graduation remains purely
  credit/rule based as intended for this release.
- [x] Remove the synthetic `requirements/default.jsonl`. It matched no actual
  admit term and mixed incompatible curriculum snapshots. Requirements now
  start explicitly unavailable on the supported HTTP/GitHub Pages path, accept
  only a validated six-digit admit term, and load that exact term before
  graduation is evaluated. The service-worker shell no longer references the
  deleted file, and the content-derived data manifest was rebuilt after its
  removal.
- [x] Ensure failed course attempts cannot satisfy degree rules that previously
  relied on `hasCourse`, internship, alternative-course, pool, or other
  degree-completion paths. Completed on
  2026-07-22: grades now live on the course model; F/U/NA/W attempts remain
  structurally present but are excluded from main, double-major, minor,
  requirement-group, alternative-pair, core-pool, and scheduler-prerequisite
  calculations. Grade save/reload is model-backed, so opening the grade picker
  can no longer autosave a failed attempt as blank. Ordinary `hasCourse` remains
  structural for duplicate prevention and existing planner behavior.
- [x] Add non-blocking planner prerequisite/corequisite guidance. Completed on
  2026-08-08: planner cards show yellow advisory warnings when prerequisite
  expressions are unmet in earlier terms or when a genuinely separate
  corequisite such as EE 200/EE 202 is absent from the same or an earlier term.
  Failed attempts do not satisfy the warning check. Recitation/lab/discussion
  component codes ending R/L/D are intentionally suppressed because those
  sections are not separate planner courses. The planner and scheduler now
  share the same AND/OR parser, including clause-specific concurrent enrollment;
  planner checks also respect the catalog's minimum-S prerequisites. Completed
  transcript courses can satisfy later prerequisites but do not receive planning
  warnings themselves. Warnings remain completely outside graduation and
  allocation logic.
- [x] Apply term-specific advisory semester loads. Completed on 2026-08-08:
  semester totals turn red only above 8 SU in Summer or 20 SU in Fall/Spring.
  The threshold follows stable model term identity and updates immediately after
  term edits, reloads, imports, manual changes, and scheduler replacement. It is
  display-only: overload courses remain in the plan, and the accessible warning
  explicitly notes that an overload may be possible with approval. Unit and
  browser tests cover exact boundaries, both regular terms, retained overloads,
  and Summer/regular term switching.
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
- [x] Show an earned-credit class-level estimate. Completed on 2026-08-08:
  Summary and Graduation Check show one main-plan `Estimated class level` based
  on all earned SU credits, independent of selected-program allocation.
  Unfinished current-term, future, unverified, and unsuccessful credits do not
  advance it. The displayed undergraduate bands are Freshman 0–33.99,
  Sophomore 34–63.99, Junior 64–93.99, and Senior 94 or more credits.
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

  Grading basis is stored per planned occurrence, survives autosave and v2+
  plan export/import, and is synthesized conservatively for v1/schema-1 plans.
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
- [x] Retain valid transcript courses that are outside the currently selected
  program catalogs. Completed on 2026-08-04: transcript import now resolves the
  selected main, double-major, and minor catalogs first, then uses the cumulative
  course-page index only as a catalog-independent identity fallback. Such
  courses reload as effective N/A, remain in letter-grade CGPA, and stay out of
  PGPA and graduation pools until a selected program/admit-term catalog supplies
  real membership. Correcting those selections therefore reclassifies the saved
  course without another transcript import. Newly imported codes that cannot be
  verified still fail closed and are reported as skipped.

  Resolved global identity metadata is also saved per plan as a validated,
  catalog-neutral snapshot (storage/export schema 3). Current shipped data wins
  on reload and the snapshot only fills missing fields. If the global index is
  temporarily unavailable, an internal N/A placeholder preserves the saved
  code, grade, term, and known credits instead of letting autosave erase it.

  The data refresh now hydrates missing/failed course-page identity fields from
  deterministic catalog metadata without copying contextual `EL_Type` or
  `Faculty_Course`, and without adding daily network requests. The global index
  is fetched lazily, and only definitions for unresolved saved/imported
  codes are appended to the planner catalog. Those definitions are excluded
  from the Add Course/manual course choices. A retained course already in the
  plan can still be scheduled when it appears in the selected term's live
  offerings.
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

  Deferred design note (2026-08-04): Sabancı transcripts use the status
  `Repeated` for both same-code retakes and cross-code substitutions, without a
  reliable replacement link. Future support must therefore preserve transcript
  attempts separately, infer a retake only when a later occurrence of the same
  canonical code exists, and leave other superseded records unresolved unless
  an explicit mapping is available. Arbitrary duplicate planner courses remain
  out of scope for 3.1. As an interim safeguard, the import result now lists
  every added, updated, already-present, superseded, skipped, invalid-grade, and
  not-found course and explains the `Repeated` ambiguity instead of guessing.
- [x] Harden shifted-layout PDF transcript grade-column detection. Completed on
  2026-08-08: both Academic Records PDF fallbacks now establish a bounded course
  row, locate plausible adjacent SU-credit/ECTS columns, and infer a grade only
  from the token anchored immediately before those columns. Canonical grade
  policy remains authoritative; narrowly grade-shaped unsupported values such as
  `A+` are reported for review instead of being imported. Wrapped title/status
  text, missing level markers, split signs, short title words such as Art/Law/AI,
  and numeric title fragments are covered without changing the explicit-column
  HTML or YÖK parsers. The real tracked Academic Records Summary still produces
  the same 38 courses, three status skips, and no invalid grades. The Microsoft
  Print-to-PDF sample contains no PDF.js text items at all; that separate
  condition retains its explicit re-export/OCR guidance and regression coverage.
  Missing, malformed, non-consecutive, or unsupported semester headings now
  fail closed in HTML, line-PDF, token-PDF, YÖK, and direct importer inputs.
  A malformed boundary clears the prior valid semester so later courses cannot
  inherit it accidentally, while the next valid heading resumes parsing. Every
  rejected row is named in the import report, and no `Unknown Semester` planner
  term is created. Transcript-created custom-course placeholders are also made
  visible only after their session-plan storage succeeds; a failed write is
  reported without changing the catalog, planner, or legacy storage.
- [x] Make transcript-created custom-course review cancellation explicit and
  transactional. Completed on 2026-08-08: the import-only form labels its
  choices **Save & Keep** and **Skip & Remove**. Skipping rolls back the exact
  imported occurrence, custom-course definition, catalog entry, empty semester,
  DOM, and persisted plan snapshot before the review closes. A rejected rollback
  leaves the form open with a visible error instead of pretending the course was
  removed. Ordinary custom-course editing retains its non-destructive Cancel
  behavior, with browser coverage for both keep and remove paths across reload.
- [x] Scope custom-course categories to explicit program codes, including
  minors. Completed on 2026-08-09: selectors are labelled `<CODE> Category` for
  every distinct selected main, double-major, and minor program. Existing
  `customCourses_<PROGRAM>` storage remains export-compatible, categories
  follow their program when roles change, official catalog rows remain
  authoritative, and fractional minor credits are preserved. A simulated
  later-key write rejection verifies best-effort restoration of earlier
  selected-program writes without changing the planner occurrence.
- [x] Give unsuccessful attempts a distinct Summary state instead of placing
  them in the generic "untaken" bucket. Completed on 2026-08-08: unsuccessful
  rows receive their own red state, text label, data attribute, and legend entry;
  genuinely not-taken rows remain separate and behind the existing pool toggle.
  This display-only split does not change GPA, earned credit, or allocation.
- [x] Keep planner and scheduler offered-course data aligned. The planner now
  uses the exact current-term schedule when it is available, schedule scrapes
  reconcile offerings back into the course-page dataset, and the weekly full
  course-page refresh preserves valid schedule-derived offerings.
- [x] Make the daily refresh regenerate and verify `data/manifest.json` before
  opening its update PR.
- [x] Make the data manifest cover every checked-in deterministic runtime JSON
  input. Completed on 2026-08-08: both JSONL and JSON runtime files now rotate
  `dataVersion`, including `courses/schedule_subjects.json`. Large catalogs,
  schedules, cumulative course metadata, and lazy history indexes contribute
  through streaming aggregate hashes without bloating the manifest with
  hundreds of paths. Scraper-only `basic_science_credits`, saved schedule
  recovery files, HTML caches, the generated data manifest itself, the PWA
  manifest, tooling packages, and test fixtures remain intentionally excluded.

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
- [x] Make scheduler replacement transactional so a rendering/build failure
  cannot leave the plan partially cleared. Completed on 2026-08-08: schedule and
  course metadata are loaded and validated before the first planner mutation,
  lab/recitation-only selections fail without touching the plan, and a persisted
  checkpoint is flushed immediately before one synchronous model/DOM commit.
  Existing course objects and DOM nodes are reused so moves retain stable IDs,
  grades, grading bases, hydrated metadata, and CRN updates. A thrown
  recalculation/render error or final snapshot failure restores the exact model,
  DOM, totals, course IDs, and persisted arrays, then shows a visible failure.
  Model term identity also prevents a duplicate semester while its date editor
  temporarily hides the rendered label, and a busy guard rejects double updates.
- [x] Replace origin-wide `localStorage.clear()` with deletion of only known
  SUrriculum keys. Completed on 2026-07-23: reset now removes namespaced plan
  data plus explicit app legacy, namespaced preference, scheduler, and valid
  dynamic keys; ambiguous raw preference names that another app may own are
  excluded;
  it reloads only after a successful reset. A browser check confirmed that an
  an unrelated origin key and a near-match legacy key survive while SUrriculum
  data is removed and legacy migration does not restore it. Exact raw names from
  the pre-multi-plan schema (`major`, `grades`, `dates`, and similar) remain
  reserved for backward-compatible cleanup and therefore cannot yet be
  distinguished from a sibling app using the same generic name.
- [x] Namespace the still-global SUrriculum preference and scheduler keys, then
  migrate their existing values. Completed on 2026-08-08: shared theme, planner,
  mobile-notice, and scheduler preferences now live under
  `surriculum.preference.*`, remain intentionally shared between plans and tabs,
  and copy each known legacy key into the namespace on boot/read. A namespaced
  value wins over a stale generic copy and failed writes never fall back to a
  generic key. Because another Pages app may own an ambiguous raw key such as
  `theme`, migration and reset deliberately leave those raw keys untouched.
  Unit and browser checks cover copy-only migration,
  storage failure, reload persistence, scheduler mirroring, and multi-tab
  sharing without crossing plan-scoped state.
- [x] Accept the ambiguous pre-multi-plan raw plan keys for 3.1. The maintainer
  explicitly chose not to add migration provenance or a reset tombstone for
  generic legacy names such as `major`, `grades`, and `dates`. Current 3.1 plan
  writes remain namespaced; this accepted edge concerns only old-schema
  migration/reset on an origin where another app uses the same raw names.
- [x] Save on mutations with a short debounce and flush on `pagehide` or hidden
  visibility so quick closes/mobile backgrounding do not lose recent edits.
  Completed on 2026-08-08: planner mutations coalesce into a 250 ms snapshot,
  while the existing two-second save remains as a fallback. Plan/major/admit
  term changes and plan imports synchronously flush before reloading; reset and
  active-plan deletion suspend late lifecycle writes so removed namespaces
  cannot be recreated. Term labels now serialize from the model rather than a
  transient open editor. Focused browser checks disable the fallback timer and
  cover page hiding, mobile-style backgrounding, immediate setting reloads,
  plan import, deletion, reset, partial-write rollback, and stale-page snapshot
  suppression.
- [x] Complete multi-tab isolation for interactive plan-scoped helpers.
  Completed on 2026-08-08: the storage layer captures one immutable session plan
  before deferred application scripts run. Main planner state, scheduler term
  and schedule state, transcript/global metadata, custom-course catalogs,
  semester creation/reload, plus plan-menu header/copy/delete/export actions,
  all use that same identifier instead of whichever plan another tab most
  recently activated.
  Once the visible plan is deleted elsewhere, stale reads/writes fail closed and
  cannot alter the other plan, recreate the deleted namespace, or fall back to
  legacy unscoped keys. A real two-page browser regression also distinguishes
  intentionally shared preferences such as scheduler preview settings from
  plan-scoped data.

## GitHub Pages and offline behavior

- [x] Fix service-worker URLs for the `/surriculum/` Pages subpath. Completed on
  2026-08-08: every app-shell URL is now derived from
  `self.registration.scope`; installation precaches the complete local shell
  plus small bootstrap manifests atomically, and a failed precache leaves the
  previous worker active. A real Chromium test serves the repository at the
  GitHub Pages-style `/surriculum/` mount and verifies installation, scoped
  cache entries, a worker-controlled reload, and an offline reload of a saved
  BIO plan with its real course, grade, catalog, and requirement record.
- [x] Restrict cache ownership and preserve already-used plan data. Activation
  now removes only obsolete `surriculum-*` caches, preserving unrelated
  same-origin caches and all `localStorage` planner state. Network-first runtime
  caching is limited to the worker scope and tracked through the fetch event.
  Versioned shell caches are separated from a persistent runtime-data cache, and
  the active main/double-major/minor plan's exact catalogs and requirements are
  warmed after registration or selection changes. Unit tests cover install
  failure, cache ownership, scope boundaries, offline fallbacks, and warmup URL
  validation; the mounted browser test proves both an unrelated cache and a
  localStorage sentinel survive activation and offline reload. A separate
  browser upgrade case starts from the previously deployed worker behavior
  (which ignores warmup messages) and proves the new controller warms the active
  plan on the first upgraded visit. Completed warmups are marked per app/data
  version and plan bundle to avoid downloading the same catalogs on every load.
- [x] Choose an explicit 3.1 deployment path. Verified on 2026-07-28: GitHub
  Pages uses the legacy branch configuration and publishes the repository root
  from `main`. The final release will merge `surriculum-3.1` into `main`, which
  automatically triggers `pages-build-deployment`; pushing the feature branch
  alone does not deploy. Use a merge commit to preserve every 3.1 commit—do not
  squash or rebase at merge time.
- [x] Prepare an optional GitHub Pages Actions deployment containing an
  allowlisted production artifact instead of the entire repository root. The
  local workflow is manual and build-only by default; deployment additionally
  requires an explicit boolean approval and `main`. The artifact builder checks
  the data manifest, service-worker shell, local static references, exact
  allowlist, and a live `/surriculum/` mount while excluding tests, tools,
  captured pages, PDFs, editor files, and temporary data.
- [ ] After explicit release approval, decide whether to keep the existing
  merge-triggered legacy Pages path for 3.1 or switch Pages to the prepared
  Actions artifact. No Pages setting or deployment has been changed.
- [x] Align the daily data-refresh workflow with the chosen production branch.
  It runs from the default `main` branch and opens data-update PRs against it;
  merging one of those PRs will trigger the same legacy Pages deployment.

## Test-suite work

- [x] Integrate `tests/scrape_groups_test.py` and
  `tests/scrape_coursepages_fallback_test.py` into the normal test command. They
  remain standalone Python assertion scripts, but `npm test` now runs them
  through `test:python` after the fast JavaScript/static gate and before the
  browser suite. The direct Python commands remain available for focused runs.
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
- [x] Add focused Firefox and WebKit projects for critical planner, requirement,
  persistence, and graduation flows. The final local gate passed 2/2 with zero
  retries; CI installs and runs the same browser versions.
- [x] Add read-only CI for the JavaScript/static, Python/data, full Chromium,
  and focused Firefox/WebKit gates. Data-only changes are skipped through path
  filters, but unexpected source changes on the refresh branch still run CI.
  The refresh PR itself is allowlisted to data paths and runs fast requirement
  validation plus the manifest check that parses every runtime JSON/JSONL row.
  Checkout credentials are not persisted through scraper/dependency execution;
  the token is passed only to the pinned PR action. The workflow is committed
  locally but has not run on GitHub.
- [ ] Configure any desired required-check/branch-protection settings after the
  first successful GitHub CI run; this is an external release-time action.

## Accessibility, documentation, and release polish

- [x] Add accessible names to primary selectors, checkboxes, icon buttons,
  semester controls, and delete controls. Edit-mode term selectors retain a
  valid accessible name instead of referencing a removed label.
- [x] Add explicit Move up/Move down controls for plan and semester reordering,
  live announcements, and shared-dialog labelling, initial focus, Tab trapping,
  Escape handling, and focus restoration. Mobile cards do not collapse when a
  move control is used.
- [x] Correct the identified low-contrast UI tokens, add consistent
  `:focus-visible` treatment, and respect `prefers-reduced-motion`. This is a
  bounded 3.1 pass, not a claim of full WCAG conformance; feature-specific
  overlays and a broader automated accessibility audit remain follow-up work.
- [x] Fix README quick-start instructions: it now serves the static app over
  HTTP and explains why direct `file://` loading is unreliable.
- [x] Update user-facing README v3.0 references to 3.1 and correct its planner
  drag claims: saved plans and semesters can be reordered, but course cards are
  removed and re-added rather than dragged between terms.
- [x] Add concise privacy copy for local transcript processing, browser
  persistence/cache behavior, backups, absent analytics/uploads, consented
  public fixtures, and locally hosted PDF/font/icon assets.
- [x] Add `CHANGELOG.md`, 3.1 release notes, and a release/rollback runbook. The
  runbook keeps history-preserving merge/revert steps distinct from deployment
  and explicitly records every final action as unperformed.
- [x] Remove the hard-coded structured-data aggregate rating. The remaining
  WebApplication JSON-LD contains no unsupported rating or review claim and is
  pinned by the CSP/static tests.
- [x] Remove the tracked `.claude/launch.json` and `.vscode/settings.json`
  editor files and ignore both project-specific directories going forward.
- [ ] After explicit release approval, merge into `main`, push, verify GitHub
  Pages, and create/push the immutable `v3.1.0` tag. None of these final actions
  has been performed.
