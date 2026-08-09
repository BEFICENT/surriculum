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

The planner gives yellow, non-blocking prerequisite warnings and checks only
genuinely separate corequisite codes. These warnings support planning and do not
change graduation eligibility, so special approvals remain possible.

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

## Known limitation: repeated attempts

Version 3.1 does not introduce the planned first-class attempt model. The
planner still stores at most one occurrence of a canonical course code, so a
retained failed or withdrawn occurrence can block a future same-code retake.
Import reconciliation selects the latest chronological record and reports
superseded or `Repeated` rows, but does not preserve every attempt.

Sabancı's `Repeated` status can describe either a same-code retake or a
cross-code substitution without a reliable replacement link. SUrriculum
therefore reports the ambiguity rather than guessing. Users must verify official
retake GPA replacement and substitutions in university records.

## Release status

Test results and remaining blockers are maintained in
[release-readiness-3.1.md](release-readiness-3.1.md) rather than duplicated here.
The merge, push, `v3.1.0` tag, GitHub Pages setting change, and deployment are
all intentionally unperformed until the maintainer authorizes the release.
