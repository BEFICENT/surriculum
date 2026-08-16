# SUrriculum 3.1 release notes

Status: release candidate. Version 3.1 has not been merged into `main`, tagged,
published, or deployed from this working branch.

## Highlights

### More honest graduation progress

SUrriculum now keeps earned progress separate from current and future plans.
Posted successful grades in the real current term count immediately, while a
grade entered in a future term remains a projection. Summaries distinguish
earned, current, future, needs-grade, unsuccessful, and genuinely not-taken
courses; only the earned audit can report **Complete**.

The main Summary and Graduation Check also show an **Estimated class level**
from earned SU credits overall. It excludes unfinished current-term, future,
needs-grade, and unsuccessful work. The undergraduate bands are Freshman
0–33.99, Sophomore 34–63.99, Junior 64–93.99, and Senior 94 or more credits.

The graduation views also show CGPA and program GPA (PGPA) separately. The main
degree requires both to reach 2.00. Double-major checks use 3.20, or 2.72 for
pre-2019 admits, across CGPA, main PGPA, and double-major PGPA. Minor checks use
CGPA and that minor's PGPA at 2.72, except Entrepreneurship at 2.50. Failed
letter attempts affect the applicable GPA without awarding degree credit.

### Safer, clearer transcript import

HTML, Academic Records PDF, and YÖK import paths now share stricter semester and
grade handling. Imports report added, updated, already-present, superseded,
skipped, invalid-grade, and not-found records instead of implying every parsed
row was added. Verified courses outside the selected program catalogs can be
retained as effective N/A until the correct program and admit term make their
membership available.

When an import needs a custom-course definition, its review form now offers
**Save & Keep** or **Skip & Remove**. Removing it rolls back the imported planner
occurrence and stored custom definition together. Image-only PDFs still require
a browser **Save as PDF** export, complete HTML, or OCR.

An import is now called complete only after its planner snapshot has been
written successfully. If browser storage rejects that write, SUrriculum restores
the checkpoint from immediately before the import, explains the failure, and
reloads the known-good plan. Plan duplication follows the same publish-last
rule: a copy is not added to the plan menu until every scoped value is durable.

Custom-course categories are now tied to program codes rather than to the
temporary main/double-major role. The form labels them explicitly, such as
**CS Category**, **IE Category**, and **FIN-MINOR Category**, and supports every
distinct selected minor. For an unchanged course code, these choices survive
role and minor selection changes; when a course is officially listed for the
active admit term, the catalog's category remains authoritative and the stored
custom choice stays dormant. An accessible **?** beside each selector explains
its available categories, downstream allocation, and the difference between
**None** and **N/A**.

Erasmus/exchange `LANG` rows are now imported for every major without inventing
a transfer grade: the grade, title, SU credits, and ECTS recorded on the
transcript are preserved. The review asks whether the course is beginning/basic
or higher-level because a foreign course number is not a reliable level signal.
The category is program-specific: eligible non-FENS programs receive free-
elective treatment, while FENS retains the course as effective N/A with its
normal CGPA effect. Only the first two beginning/basic language courses receive
degree/free credit; later ones remain visible and clearly labelled as excluded.
Higher-level language courses do not use that allowance.

### Planner and scheduler reliability

Semester-card order is now explicitly presentation-only. Academic allocation,
progress, prerequisites, prior-credit requirements, scheduler filters, and
retakes all use a persisted canonical term code. Dragging moves the complete
card—so its current-term and disclosure state travel with it—and **Sort
Semesters** restores an oldest-to-newest view. New or edited cards cannot reuse
an existing term; transcript imports add courses to the matching card. Legacy
duplicate-term plans remain lossless, while ambiguous scheduler updates fail
closed instead of choosing a card by visual position.

The planner gives yellow, non-blocking prerequisite warnings and checks only
genuinely separate corequisite codes. It also reads SUIS **General
Requirements**: the HUM 201/202/207 SPS-course clauses and minimum prior-credit
rules such as 23 SU for those HUM courses and 58 SU for SPS 303 are no longer
lost outside the ordinary prerequisite field. The scheduler uses the same
checks, and both course-details views preserve the complete source text.

Prior-SU guidance counts positive credit from eligible courses in strictly
earlier planner semesters. It includes successful and still-planned courses,
just like ordinary prerequisite planning, while excluding failed, withdrawn,
grade NA, unsupported-grade, same-term, and later work. A course categorized
N/A for the selected program can still contribute when its grade is successful
or pending, because this is an overall prior-SU rule rather than program
allocation. Its copy reports prior SU
**planned/completed** rather than claiming the planner knows the university's
official earned-credit total. All prerequisite warnings support planning and do
not change graduation eligibility, so special approvals remain possible.

The planner course picker now combines search with program/category, level,
credit, already-planned, exact-term offering, and prerequisite controls. Its
term-aware checks use canonical semester codes rather than visual card order.
The result list now grows with the selected semester's visible course area,
shrinks safely on shorter screens, and can open below the search row when that
is the better contained placement.
The four common picker choices are grouped in Controls as **Course picker
defaults** and seed each newly opened picker. Offered-only filtering is local to
that picker and follows its destination semester, so changing one semester does
not affect another picker or the sidebar default. The former current-term-only
wording and state are retired. Existing planner credit and requirement preferences are
migrated once from the previously shared Scheduler values, then remain
independent.
It also derives cautious offering-history tags—**No Fall offerings found**,
**No Spring offerings found**, **No Summer offerings found**, and **Not offered
every year**—from recorded
course-page history. Duplicate observations are collapsed, failed or sparse
histories stay untagged, and an exact published schedule for the target term
suppresses every historical warning. The same advisory tags appear on
unfinished planned course cards without changing filtering or eligibility.

Semester headers show the full positive-SU course load represented in that
term. Credit not allocated to a primary-program category is called out in the
same compact indicator, for example **15 SU (3 N/A)**. The full load turns red
above the standard 8-SU Summer or 20-SU Fall/Spring threshold. This remains an
advisory warning only: the planner retains the courses, an overload remains
possible with approval, and graduation-credit totals are calculated separately.

The scheduler now accounts for date-specific meetings and detects conflicts even
when weekend or late-hour rows are not visible. Saturday, Sunday, and extended
hours appear only when a selected section or active preview needs them. Updating
a planner semester is transactional: a load, render, recalculation, or storage
failure restores the previous term rather than leaving it partly replaced.

Automated degree-data refreshes no longer trust HTTP status alone. Requirements,
major catalogs, and minor catalogs accept a degree-detail page only when its
displayed **Admit Term** exactly matches the requested term. A complete-looking
wrong-term fallback is rejected, and failed catalog refreshes keep the prior
term index discoverable.

### Local-first security and offline behavior

PDF transcript processing uses a matched, locally vendored PDF.js 6.2.108
main/worker pair. The importer bounds file size, page count, extracted fragments,
and text length. Inter and Font Awesome are also local, and a same-origin Content
Security Policy removes the remaining runtime CDN dependency.

The service worker is correctly scoped to the GitHub Pages `/surriculum/` path,
owns only `surriculum-*` caches, and can warm the active plan's public data for
offline use. It does not delete planner `localStorage` or unrelated same-origin
caches during an upgrade.

### Easier first use and release discovery

People opening SUrriculum for the first time now receive the existing **Help &
information** guide as a one-time introduction. People returning from the
previous live release instead receive a short **What's new in SUrriculum 3.1**
summary, with an optional path into the full guide. The two dialogs are mutually
exclusive, accessible by keyboard, responsive on mobile, and acknowledged for
the whole browser installation rather than for only one saved plan.

## Privacy

Transcript files are parsed inside the user's browser and are not uploaded.
There is no runtime analytics, telemetry, account, or server-side plan storage.
Plans, grades, custom courses, preferences, and scheduler selections remain in
browser storage on the current origin; exports are the portable backup.

The public academic-record fixtures already in the repository are maintainer-
owned or included with consent. That settled fixture policy is separate from
normal users selecting their own local files, which never publishes those
files.

## Compatibility

The planner targets current evergreen browsers. PDF import uses the PDF.js
6.2.108 legacy build; its practical upstream floor is Chrome 125+, Firefox ESR+,
and Safari 18+ (mostly), with corresponding Chromium-based Edge support. The
complete application suite remains Chromium-focused, with a smaller
critical-flow gate for Firefox and WebKit.

## Retake planning and its attempt-history limitation

Version 3.1 adds a conservative exact-code retake replacement. When a supported
final attempt appears in an earlier term, both the planner picker and scheduler
can ask permission to remove that planner entry and create a new ungraded one
in the later term. `F/U/NA/W` are accepted without a deadline. Passing `A-D`
and `S` use the three-regular-semester window; Summer does not consume a step.
Future source terms, unfinished/unknown grades, `T`, multiple existing attempts,
and different-code replacements fail closed. Cancel leaves the plan unchanged,
and scheduler persistence failures restore the previous plan.
Approved leave also does not consume the official window, but SUrriculum has no
leave-semester marker; it therefore applies the calendar window conservatively
and may require manual verification after leave.

This remains a lossy planning simplification rather than the planned
first-class attempt model. The university transcript retains every registered
attempt and the latest repeat result replaces the earlier CGPA result even when
it is lower; SUrriculum temporarily removes the earlier credit/GPA until the new
grade is entered, so its planner prerequisite effect is temporarily removed as
well. Import reconciliation selects the latest chronological record
and reports superseded or `Repeated` rows, but does not preserve every attempt.

Sabancı's `Repeated` status can describe either a same-code retake or a
cross-code substitution without a reliable replacement link. SUrriculum only
offers the planner workflow for an exact same code and reports the remaining
ambiguity rather than guessing. Users must verify official retake GPA
replacement and substitutions in university records.

## Release status

One small, accepted implementation gap remains for a synthetic pre-2025 EE/ME
plan containing MATH 201, MATH 202, and MATH 212 together: SUrriculum does not
guess which surplus mathematics course to exclude. Real historical course
lists use their matching older catalog configuration, so this should not affect
ordinary plans; the all-three mixed case remains documented rather than given
an invented repeat/order rule.

Test results and remaining blockers are maintained in
[release-readiness-3.1.md](release-readiness-3.1.md) rather than duplicated here.
The merge, push, `v3.1.0` tag, GitHub Pages setting change, and deployment are
all intentionally unperformed until the maintainer authorizes the release.
