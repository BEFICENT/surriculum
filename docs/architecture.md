# Runtime architecture

SUrriculum is a static, dependency-free browser application. The production
runtime has no bundling step, application server, account service, or database.
That constraint is deliberate: the same reviewed files run on GitHub Pages, a
mounted subpath, and the supported local-file fallback paths.

## Design rules

- `index.html` is the source of truth for runtime execution order. Classic
  scripts remain `defer`; the few ES modules expose explicit browser bridges for
  legacy consumers.
- First-party CSS is linked as eleven direct, render-blocking files in reviewed
  cascade order: centralized tokens/base, planner/dialog surfaces, graduation,
  Scheduler shell/grid, planner controls, Summary, and two mobile layers. Avoid
  `@import`; it adds a dependent request chain and hides ordering from the page.
- State has one owner. Extracted modules receive mutable state through accessors
  or controller factories instead of copying arrays or replacing shared object
  references.
- Domain modules do not create UI. UI modules receive policy/data functions as
  dependencies. Orchestrators assemble them and retain compatibility globals.
- A new runtime file must also be listed in `sw.js` and
  `tools/release/build_pages_artifact.py`. The artifact tests reject drift among all
  three lists.
- HTTP(S) data reads are asynchronous. Synchronous XHR is permitted only inside
  an explicitly guarded `file:` compatibility path, where browsers commonly
  block `fetch` for local files.
- Performance runs fingerprint the linked script/CSS graph, scenario harness,
  fixture, and target datasets, so results cannot be compared across different
  workloads or application artifacts without an explicit legacy override.

## Boot layers

The exact order remains visible in `index.html`; these are the responsibility
layers rather than a second copy of that manifest.

1. **Storage and plan shell** — preferences, plan modal UI, strict plan-import
   validation, import/export serialization, and the plan-storage orchestrator.
2. **Shared planner policy/data** — academic-term identity, compatibility
   helpers, Smart Sort adaptation, course metadata/history, and curriculum
   persistence.
3. **Course eligibility and Scheduler** — retakes, the pure prerequisite
   expression policy, registration/requisite coordination, conservative
   offering-history inference, filters, Scheduler dialog/storage/meeting
   primitives, course-details and course UI,
   planner-sync transaction, keyed result reconciliation, grid/blocked-time
   preview rendering, result query/filter/scoring/card orchestration,
   section/corequisite selection, session/sidebar/program/term context, and the
   Scheduler orchestrator.
4. **Planner interaction** — drag/move behavior, semester construction, course
   picker geometry/result rendering/actions, course-detail presentation,
   accessible grade editing, academic-record parsing, catalog resolution/import
   transactions, and local PDF extraction. The legacy click entry point only
   dispatches those controllers and retains local semester/course mutations.
5. **Curriculum domain** — credits, grades, suggestion ranking, catalogs,
   pure allocation policy, dependency-injected live allocation recalculation,
   progress, Smart Sort candidate-impact simulation and minor allocation,
   requirement evaluation, curriculum rendering, graduation
   result/summary/minor-detail presentation, and the stateful curriculum model.
6. **Application composition** — asynchronous term/program catalog loading,
   shared app runtime, custom-course model/runtime/manager/form/UI coordinator,
   transactional transcript custom-course review, selected-program context
   coordination, academic-import controller, planner defaults, saved-course
   restoration, responsive app-shell
   controls, program/admit-term selection controls, onboarding/help, mobile
   notice, and `main.js`. Four focused mobile
   modules own viewport mode, navigation/progress, planner accordion, and
   Scheduler adaptation; `mobile.js` only composes them once.
   Boot awaits the term manifest and the exact selected main-major,
   double-major, and minor requirement records before it publishes planner
   readiness. Program catalogs continue loading inside the planner
   initialization flow, with independent HTTP reads overlapped rather than
   replaced by synchronous requests.

## Public module boundaries

New classic modules expose narrow frozen APIs while small, deliberate window
bridges preserve existing browser contracts:

- `window.SurriculumModules`: academic terms, plan UI/import policy, course
  metadata, shared course-history presentation,
  curriculum persistence/allocation/recalculation/progress/requirements/view, the
  dependency-injected Smart Sort candidate-impact factory, planner picker
  geometry/result rendering, planner course-detail and grade-editor controllers,
  the frozen Academic Records
  parsing/catalog-resolution/import factories, and the browser Smart Sort
  adapter.
- `window.SurriculumCourseOfferingHistory`: the conservative, positive-evidence
  offering-history policy consumed by `window.courseFilters`.
- `window.SurriculumSchedulerFoundation`,
  `window.SurriculumSchedulerCourseUi`,
  `window.SurriculumSchedulerPlannerSync`, and
  `window.SurriculumSchedulerResults`: Scheduler shell controllers and pure
  helpers.
- `window.SurriculumSchedulerResultsController`: live-session result search,
  filter, prerequisite, Smart Sort, and keyed-card orchestration.
- `window.SurriculumCourseRequisiteExpressions`: frozen prerequisite parsing
  and expression-evaluation policy composed by the compatibility
  `window.courseRequisites` coordinator.
- `window.SurriculumSchedulerGrid` and
  `window.SurriculumSchedulerSelection`: live-session controllers for grid,
  blocked-time and preview rendering, and section/corequisite mutations.
- `window.SurriculumModules.minorAllocation`,
  `window.SurriculumGraduationResults`, and
  `window.SurriculumGraduationSummaryShell` plus
  `window.SurriculumGraduationMinorSummary`: minor allocation policy and the
  graduation result/summary presentation controllers.
- `window.surriculumProgramData`, `window.surriculumAppRuntime`,
  `window.surriculumCustomCourseModel`,
  `window.surriculumCustomCourseRuntime`, the custom-course manager/form/UI
  namespaces, `window.surriculumPlannerPreferences`,
  `window.surriculumSavedCourseRestoration`, `window.surriculumAppShell`,
  `window.surriculumProgramSelection`,
  `window.surriculumTranscriptCustomCourseReview`,
  `window.surriculumProgramContext`, and the app controller namespaces:
  application-level services configured by `main.js`. The custom-course UI and
  transcript-review and program-context coordinators receive live planner state
  through accessors; they compose the model/runtime rather than owning a second
  catalog state. Transcript review separately owns its review sequencing and
  transactional rollback boundary.

The legacy globals `window.planStorage`, `window.uiModal`,
`window.openSchedulerModal`, `window.loadTermScheduleIndex`,
`window.academicRecordsParser`,
`window.computeMinorAllocation`, `window.displayGraduationResults`,
`window.displaySummary`, `window.curriculum`, and the `SUrriculum` planner-boot
entry point are compatibility contracts. `SUrriculum` remains callable for name
compatibility, but boot now performs asynchronous manifest, requirement, and
catalog reads and therefore returns a Promise. Runtime consumers should await
`window.whenSurriculumReady()` for complete application boot or
`window.whenSurriculumPlannerReady()` for the visible planner boundary instead
of depending on a synchronous return value. Do not introduce another global
with the name `SUrriculum`.

## File-boundary guardrails

- Legacy entry points are composition layers with explicit line/byte limits in
  `tests/unit/runtime-module-size.test.js`; raising a limit requires a reviewed
  reason rather than silently growing a coordinator.
- Every Scheduler implementation file and every custom-course, academic-import,
  picker, program-selection, and mobile controller stays below its focused
  boundary. The tests fail when a split merely moves a monolith into a new
  directory.
- `styles.css` and `mobile.css` retain only shared/base responsibilities. The
  nine domain stylesheets preserve the former cascade at reviewed boundaries,
  without `@import` request chains.
- Global focus and reduced-motion policy stays in `styles.css`; custom-course
  and double-major modal styling stays in `styles/planner-controls.css`; and
  `styles/summary-workspace.css` owns only the Summary workspace.

## State ownership invariants

- The active browser page pins its session plan id. A different tab changing the
  shared active-plan pointer must not redirect delayed writes from this page.
- Planner import is validate-then-commit. A failed write removes the unpublished
  namespace and restores the prior checkpoint.
- `course_data`, double-major catalog arrays, semester arrays, and course objects
  have identity-sensitive consumers. Controllers read them through accessors;
  they must not replace a shared array merely to append entries.
- Scheduler controllers read `selected`, `blocked`, schedule index, and term
  state dynamically. Schedule switching changes those references.
- Curriculum allocation may mutate effective category fields on live course
  occurrences. The stateful model delegates its main/double-major passes to one
  dependency-injected recalculation controller, which preserves semester/course
  identity and publishes only after the synchronous pass (and any nested
  double-major pass) is coherent. Private suggestion simulations clone only the
  explicitly isolated snapshot path.

## Change checklist

For a new or moved runtime script or stylesheet:

1. Add the script in dependency order to `index.html`.
2. Mirror the path in `APP_SHELL_PATHS` (`sw.js`) and `APP_FILES`
   (`tools/release/build_pages_artifact.py`).
3. Add a direct module-contract test and update any VM test loader to include its
   real dependencies; never let a tolerant sandbox silently test a fallback.
4. Run unit and Python checks, the relevant Playwright flows, Pages artifact and
   service-worker tests, performance contracts/smoke, and `git diff --check`.
5. Compare a matched Scheduler performance run when the change can affect card
   rendering, scrolling, hover preview, blur geometry, or runtime file count.

The release checklist and deployment/rollback procedure remain in
`docs/release-readiness-3.1.md` and `docs/release-runbook-3.1.md`.
