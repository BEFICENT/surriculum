# Changelog

This file records user-visible SUrriculum changes. The 3.1 entry remains
unreleased until the branch is merged, published, and tagged.

## [Unreleased] — 3.1 candidate

### Added

- Earned, current-term, future-planned, needs-grade, unsuccessful, and not-taken
  progress states across graduation summaries.
- Separate CGPA and program GPA (PGPA) checks for the main degree, double major,
  and minors, including clearly labelled projections.
- Non-blocking prerequisite and separate-course corequisite warnings in the
  planner.
- Term-selectable scheduler support for date-specific meetings, conditional
  weekend/late-hour display, blocked times, previews, and transactional planner
  updates.
- Catalog-independent transcript-course identity fallback for verified courses
  outside the programs currently selected by the user.
- Content-derived data manifest coverage for every deterministic runtime JSONL
  and JSON input.
- A service worker scoped correctly for the `/surriculum/` GitHub Pages path,
  with app-owned caches and active-plan offline warming.
- An **Estimated class level** based on earned SU credits, using the
  undergraduate 34/64/94-credit thresholds.
- Program-aware Erasmus/exchange `LANG` imports with an explicit reviewed
  beginning/basic versus higher-level classification.
- Program-code-labelled custom-course categories for the main degree, double
  major, and every selected minor, with independent classifications retained
  when program roles change.

### Changed

- A successful posted grade in the current term is treated as earned
  immediately; grades entered for future terms remain projections.
- Failed letter-grade attempts stay in the applicable GPA denominator but award
  no degree credit. Effective N/A courses remain in CGPA and are excluded from
  PGPA.
- Transcript imports now report added, updated, already-present, superseded,
  skipped, invalid-grade, and not-found records separately.
- Transcript-created custom courses use an explicit **Save & Keep** or
  **Skip & Remove** review step; removal rolls back the imported occurrence and
  saved definition together.
- `LANG` imports preserve the transcript's actual grade and credits. They count
  as free electives only where the selected program permits language electives;
  FENS retains them as effective N/A without changing their CGPA treatment.
- Planner autosave now flushes shortly after mutations and on page hiding while
  preserving plan deletion/reset boundaries and multi-tab isolation.
- Semester totals now show a non-blocking overload advisory above 8 SU in
  Summer or 20 SU in Fall/Spring; approved overloads remain fully editable.
- Shared preferences use SUrriculum-owned storage keys and copy legacy values
  without changing their plan-independent behavior. Ambiguous generic keys are
  deliberately left untouched for other same-origin applications.
- PDF transcript processing now uses a matched, locally vendored PDF.js 6.2.108
  main/worker pair with bounded text extraction.
- Inter and Font Awesome are served locally, and a restrictive same-origin
  Content Security Policy replaces runtime CDN access.

### Fixed

- Graduation allocation now separates earned credit from planned credit and
  handles special grades consistently across desktop, mobile, summaries, and
  imports.
- Shifted-layout PDF parsing no longer guesses a grade from unrelated title or
  status text, and malformed term boundaries fail closed.
- Scheduler-to-planner replacement rolls back completely if loading, rendering,
  recalculation, or persistence fails.
- Schedule scraping and the planner's offered-course filter now reconcile into
  the same available data.
- Requirements, major-catalog, and minor scrapers now reject complete-looking
  HTTP-200 fallback pages unless their displayed admit term exactly matches the
  requested term; failed refreshes preserve the last-known catalog index.
- The beginning/basic-language rule now recognizes current and historical
  language subjects and excludes courses beyond the first two from degree/free
  credit instead of merely blocking graduation. Higher-level language courses
  remain uncapped.
- Dense mobile Progress rows, Special Requirements badges, and narrow semester
  headers now wrap into deliberate rows instead of clipping names or controls.
- The structured-data block no longer publishes an unverified aggregate rating.

### Security and privacy

- Transcript files continue to be processed entirely in the browser with no
  upload, analytics, telemetry, or server-side plan storage.
- PDF.js 6.2.108 includes the fixes relevant to CVE-2024-4367 and
  CVE-2026-16633.
- Reset avoids blanket origin-wide clearing and preserves unrelated keys and
  caches, while still removing the explicitly supported legacy SUrriculum keys.

### Known limitation

- Repeated attempts and future retakes are not yet first-class records. The
  planner still permits only one occurrence of a canonical course code, and
  transcript reconciliation cannot safely infer cross-code substitutions from
  Sabancı's ambiguous `Repeated` status.

See [the 3.1 release notes](docs/release-notes-3.1.md) and
[release-readiness tracker](docs/release-readiness-3.1.md) for the detailed
scope and remaining work.

## [3.0] — 2026-02-10

- Promoted the 3.0 application out of beta.
