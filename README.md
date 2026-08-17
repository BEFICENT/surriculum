# [SUrriculum v3.1](https://beficent.github.io/surriculum/)

SUrriculum is a fully client-side curriculum planner for Sabancı University undergraduate programs. It runs entirely in your browser (plain HTML/CSS/JS) and helps you:

- Build and maintain a semester-by-semester plan
- Track major / double major / minor requirements
- Import your transcript (Academic Records Summary) to prefill taken courses
- Use a term-selectable scheduler (SUchedule-style) to build a weekly timetable and sync it back into your plan

Live version: https://beficent.github.io/surriculum/

> Note: Always verify graduation requirements using official sources.

## Quick start

1. Clone or download this repository.
2. From the repository root, start a local HTTP server:

   ```bash
   python -m http.server 8000
   ```

3. Open [http://localhost:8000/](http://localhost:8000/) in a modern browser.
4. Pick your program(s) and admit term(s) from the sidebar and start planning.

There is no build step, application server, or database. A small static HTTP
server is required because browser modules, data requests, PDF.js workers, and
offline caching do not work reliably when `index.html` is opened directly over
`file://`.

The core planner targets current evergreen browsers. PDF transcript import uses
the locally bundled PDF.js 6.2.108 legacy build, whose practical upstream floor
is Chrome 125+, Firefox ESR+, and Safari 18+ (mostly). Microsoft Edge follows
its corresponding Chromium baseline. The full browser suite runs on Chromium,
with an additional critical-flow gate for Firefox and WebKit.

All plans and progress are stored locally in your browser. Use the plan
**Export/Import** flow to back up or move data between devices.

## What you can do (feature overview)

- **Programs**: select a main major, optional double major, and up to **3 minors**.
- **Admit terms**:
  - Verify the relevant dates in **SUIS → Student Records → General Student Information**.
  - For the main major and every minor, usually use your initial university entry term. For most students, this means the minors use the same admit term as the main major.
  - For a double major started before **Fall 2026-2027**, use the first term after the double-major application was accepted. For one started in **Fall 2026-2027 or later**, use your initial university entry term.
  - Main major and double major each have an admit-term selector, and each minor slot (`Minor 1/2/3`) has its own.
- **Plans**: keep up to **10 saved plans**, reorder them by dragging in the plan menu, rename, export, import, and delete (while keeping at least 1 plan).
- **Planner board**: add semesters and courses, reorder semesters with the desktop drag handle or directional controls, restore oldest-to-newest display order with **Sort Semesters**, remove courses, and see each term's full SU workload. Card order is presentation-only: prerequisites, retakes, progress, GPA, and curriculum allocation use each semester's persisted academic term code. New and edited cards cannot duplicate an existing term; legacy duplicate-term plans remain lossless but ambiguous scheduler sync fails closed. Every positive-SU course card contributes to this load even when it is N/A for the primary program; that portion is shown separately, for example **15 SU (3 N/A)**. The full load turns red above the standard 8-SU Summer or 20-SU Fall/Spring threshold, but this is advisory and does not prevent an approved overload. Graduation-credit totals remain separate. On desktop, courses can be dragged between semesters with a visible insertion preview; the course move control also provides a keyboard destination picker.
- **Course details**: open a details view for planned courses using the course
  row actions. Catalog details include the university's prerequisite,
  corequisite, and **General Requirements** text when available.
- **Import transcript**: import **Academic Records Summary** (HTML/PDF) or a **YÖK transcript PDF** (not preferred).
- **Graduation + summaries**: check requirement progress and open detailed summaries for majors and minors.
- **Current-term tools**:
  - Current term highlight
  - Optional exact-term offered-course filtering for each planner semester
  - **Scheduler** for picking sections and building weekly timetables by term
- **Quality of life**: dark/light theme, collapsible sidebar, touch-friendly behavior, custom modals (no default browser prompts), first-use guidance, and a concise one-time release summary for returning users.

If you hit a bug or want to improve the tool, open an issue/discussion or contact: [bilal.gebenoglu@sabanciuniv.edu](mailto:bilal.gebenoglu@sabanciuniv.edu)

## Planner basics

### Programs + admit terms

1. Choose your **main major** (required).
2. Optionally choose a **double major**.
3. Add up to **3 minors** using the “Add minor” flow.
4. Verify the dates in **SUIS → Student Records → General Student Information**, then set each selected program's admit term:
   - **Main major and minors:** usually use your initial university entry term. For most students, the minor terms therefore match the main-major term.
   - **Double major before Fall 2026-2027:** use the first term after your double-major application was accepted.
   - **Double major from Fall 2026-2027 onward:** use your initial university entry term.

Course catalogs and requirement rules are loaded based on these selections.

### Adding semesters and courses

- Use **“+ New Semester”** to add a term to your plan.
- Use **“+ Add course”** in a semester to pick a course from the catalog.
- Use a semester's desktop drag handle or its directional controls to reorder terms.
- Semester order is only visual. Academic chronology always follows the saved term codes; use **Sort Semesters** to restore an oldest-to-newest view.
- On desktop, drag a course to another semester or activate its move control and choose a destination. The move preserves the course record and recalculates both terms.
- Use per-course buttons (next to delete) to open **details** and other actions.

The course picker can combine search with program/category, course level,
credit, exact-term offering, already-planned, and prerequisite filters. Its
prerequisite checks use the target semester's canonical term code: ordinary
prerequisites and prior-SU requirements look strictly earlier, while only
explicit concurrent clauses can use the target term.

The suggestion list adapts to the selected semester's visible course pane. It
uses extra room on tall cards, contracts inside short viewports, and opens below
the search controls only when the space above is genuinely too limited.

Picker results and planned course cards can also show advisory offering-history
tags such as **No Fall offerings found**, **No Spring offerings found**,
**No Summer offerings found**, and **Not offered every year**. These are derived
from deduplicated recorded
offerings, not hardcoded course lists. Failed, empty, or sparse histories remain
untagged, and an exact published target-term offering suppresses all historical
warnings for that selection. The
tags describe past evidence only; future availability can change.

Course and credit prerequisites are advisory planning guidance. A requirement
such as SPS 303's 58 prior SU is checked against positive SU credits in strictly
earlier planner semesters. Successful and still-planned eligible courses count,
matching ordinary course-prerequisite planning; failed, withdrawn, grade NA,
unsupported-grade, same-term, and later courses do not. The warning therefore
says **planned/completed**, not officially earned. It does not remove a course
or prevent an approved exception, and official enrollment eligibility must
still be confirmed in SUIS.

This is an overall prior-SU check, not a program-allocation total. A course
categorized N/A for the selected major can still contribute when its own grade
is successful or pending; the separate transcript grade `NA` (Not Attended)
cannot.

### Custom courses

If a course is missing from the catalog (or you want placeholders), you can add a **custom course** and set its credits (including `.5`). Its category is saved separately for every selected program: for example, the form shows **CS Category**, **IE Category**, and one category selector for each selected minor. Changing which program is the main or double major does not move those classifications between programs. Use the **?** beside a selector to see how its available categories are allocated, including the difference between **None** and **N/A**. An official catalog classification always takes priority when that course is listed by the selected program and admit term.

## Course picker defaults and filters

Controls provides four course-picker defaults: **Show course
details**, **Hide courses planned by the selected semester**, **Only show courses offered in
the semester**, and **Smart Sort**. They are applied when a course picker opens.
The offered-only control inside a picker is local to that semester: changing it
does not rewrite the sidebar default or another open semester's picker.

In a Planner course picker, **Hide courses planned in this or earlier semesters**
hides courses in the destination semester and academically earlier semesters; a
course planned only in a later semester remains visible. In Scheduler, **Hide
courses planned before the selected term** keeps the selected term's planned
courses available for section selection.

The offered-only setting uses the destination semester's exact schedule. If
that schedule is unavailable, it fails open and leaves courses visible;
offering-history badges remain advisory and do not drive this filter.

Open **Filters** beside the course search for program, category, level, credit,
and course-requirement controls. Planner credit and requirement choices persist
independently from Scheduler choices.

### How “Smart Sort” works

Each course is scored based on how helpful it is for your selected programs, then the dropdown is sorted by that score.

Base points (by course type, per program):

- `University`: 36
- `Required`: 28
- `Core`: 18
- `Area`: 12
- `Free`: 0

Extra points:

- `+ 0.1 × (SU credits)` per course
- For **engineering majors only** (Data Science is not treated as engineering):
  - `+ 2 × (Basic Science credits)` only if your Basic Science requirement is **not fulfilled yet**
  - `+ 1 × (Engineering credits)` only if your Engineering requirement is **not fulfilled yet**
- `University` and `Required` points stop contributing once the relevant requirement is already fulfilled (per program).

Program weighting:

- Main major: `× 1.0`
- Double major: `× 0.8`
- Each minor: `× 0.5` (minors contribute at half weight)

Equivalences:

- `CS 210` / `DSA 210` are treated as the same course for scoring/suggestions (canonicalized as `DSA210`).

## Importing Academic Records (Transcript)

Open **Import Records** in the header and upload one of:

- **Academic Records Summary HTML** (preferred): save as **“Webpage, Complete”**
- **Academic Records Summary PDF**: use your browser/system **Save as PDF**
- **YÖK transcript PDF** (not preferred): supported as an alternative import

Important notes:

- If you upload a **Degree Evaluation** document, SUrriculum rejects it and shows a dedicated warning explaining how to export the correct file.
- Erasmus/exchange courses with the transcript subject `LANG` are retained with
  their actual recorded grade and credits. During review, identify whether the
  course is beginning/basic or higher-level. Language electives count as free
  electives only for programs whose degree rules permit them; FENS keeps them
  as effective N/A, where a letter grade can still affect CGPA.
- At most two beginning/basic language courses receive free-elective and degree
  credit. Additional beginning/basic courses remain visible, including their
  recorded grade, but are labelled as excluded from degree credit. Higher-level
  language courses do not consume this two-course allowance.
- If you saved SIS pages as **HTML only** (instead of **Webpage, Complete**) and the file contains the known “no permission” page HTML, SUrriculum warns you to re-save correctly.
- If a PDF has no readable text layer, SUrriculum explains how to re-export it
  with the browser's **Save as PDF**, save **Webpage, Complete** HTML, or run
  OCR. **Microsoft Print to PDF** is a known source of image-only transcripts.

## Graduation and summaries

From the graduation/summary UI you can:

- Check graduation progress for your main major (and double major if selected).
- Open **detailed summaries** for majors and minors showing:
  - Earned, current-term, future-planned, needs-grade, unsuccessful, and not-taken states
  - Which requirements are satisfied or missing
  - How overflow (upper → lower pool) courses are counted (color-coded)
- See earned and projected credit separately. Only the earned audit can report
  **Complete**; planned work can report **Projected complete**.
- See an **Estimated class level** based only on earned SU credits across the
  academic record, using the undergraduate thresholds: Freshman 0–33.99,
  Sophomore 34–63.99, Junior 64–93.99, and Senior 94 or more credits.
- See overall CGPA separately from the PGPA calculated for each selected
  program. Effective N/A courses remain in letter-grade CGPA but do not enter a
  program's PGPA.
- Count a posted successful current-term grade as earned immediately, including
  the period between grade publication and the application's next-term switch.
  Grades entered for future terms remain projections and cannot make the earned
  graduation audit pass.

Main-degree completion requires CGPA and main-program PGPA of at least 2.00.
Double-major completion requires CGPA, main-program PGPA, and double-major PGPA
of 3.20 (2.72 for pre-2019 admits). Minor completion requires CGPA and that
minor's PGPA of 2.72, except Entrepreneurship at 2.50.

## Scheduler (weekly timetable)

Open **Scheduler** from the sidebar. It is a SUchedule-style weekly grid that defaults to the current term and can switch between locally available schedule terms.

Key features:

- **Search + browse** courses for the selected scheduler term
- **Pick section** and place it on a compact weekday grid that adds weekend days or later hours only when the selected section or active preview needs them
- **Corequisite bundling**: courses with labs/recitations are treated as a bundle so you don’t “lose” the lab/recitation separately
- **Time conflicts**: overlapping classes render side-by-side instead of blocking each other
- **Copy CRNs**: copies the selected CRNs
- **Update planner semester**: replaces the courses in the matching planner semester with the scheduler’s selected main courses (labs/recitations are not added to the planner semester)
- **Block hours**:
  - Enable block mode and click-drag to block time slots
  - Courses that can’t fit around blocked hours can be filtered out, or optionally shown in red
- Optional helpers (toggles):
  - Hide courses planned before the selected term
  - Show course details in the list (credits/type)
  - Check course prerequisites, including prior-SU and General Requirements
    rules, with an option to keep unmet courses visible
- Smart Sort (same scoring as the main planner)
  - Hover preview (shows a translucent preview of how a course would look if added)
  - Availability highlighting (taken / conflict-free / conflict-prone indicators)

Schedule data files:

- The scheduler reads from `courses/schedule/<TERM>.jsonl`.
- Course details also lazily read `courses/course_instructor_history.jsonl`, which is derived from all saved schedule files.
- Course details can also read `courses/course_section_history.jsonl` for per-section instructors and seat counts.
- Generate/update these files using `python fetch_schedule.py` (defaults to all terms from the current term onward, reconciles those offerings into `courses/all_coursepage_info.jsonl`, and rebuilds derived history automatically).

Mobile note:

- The scheduler is usable on mobile, but works best in **landscape**.
- Some header actions collapse into a **“…”** menu on smaller widths.

## Privacy and local data

- Transcript files are parsed inside your browser. SUrriculum does not upload
  the selected HTML or PDF, and it has no runtime analytics, telemetry, user
  account, or server-side plan storage.
- Plans, grades, custom courses, preferences, and scheduler selections are kept
  in this site's browser storage. The service worker may also cache the static
  application and public catalog data for offline use.
- Data does not automatically sync between browsers or devices. Export each
  important plan as a backup before clearing site data, resetting SUrriculum, or
  changing devices.
- PDF.js, Inter, and Font Awesome are served from this repository. The running
  application does not depend on a font, icon, or PDF-reader CDN.
- Public test fixtures in this repository are maintainer-owned or included with
  the contributor's consent. Choosing your own transcript in the application
  never adds it to the repository or publishes it.

## Updating data (for maintainers)

Data is stored as `.jsonl` under `courses/` and `requirements/`.

Install dependencies:

```bash
pip install -r requirements.txt
```

Update course catalogs:

```bash
python fetch_courses.py
```

Update requirement rules:

```bash
python fetch_requirements.py
```

The degree-detail scrapers reject successful HTTP responses unless the page's
displayed **Admit Term** exactly matches the requested `YYYY01`/`02`/`03` term.
An unavailable-term fallback therefore cannot overwrite requirements. Complete
course-catalog rows merge into `courses/terms.jsonl` atomically while failed and
unrequested terms remain discoverable. Full minor-term refreshes publish only
after every selected minor succeeds; program-limited runs merge with the
existing snapshot instead of truncating it.

Scrape course pages for metadata (including prerequisite/corequisite and
General Requirements rules, Basic Science/Engineering credit breakdowns, and
“offered term” history):

```bash
python scrape_coursepages.py
```

The same step also uses the newest program/minor catalog snapshots to fill
missing intrinsic fields after a verified scrape. For failed or unverified
course-page responses, it replaces intrinsic values with catalog-backed values
and clears any that cannot be verified. Program-specific classification fields
such as `EL_Type` and `Faculty_Course` remain in their program and admit-term
catalogs; they are never copied into the global course-page index.

Use `python scrape_coursepages.py --refresh` for a genuine full refresh of
existing records. Full refreshes bypass the local HTML cache; the automated data
workflow performs one every Monday and remains incremental on other days.

Regenerate the data manifest after **any** data update (no network requests). It
writes `data/manifest.json`, whose content-derived `dataVersion` keys the app's
service-worker cache — so returning users automatically pick up changed data, with
no manual cache bump:

```bash
python build_manifest.py
```

Update schedule data from the current term onward:

```bash
python fetch_schedule.py
```

Daily schedule refreshes update section seat history in delta mode by default; use full mode when you explicitly want to refresh every current/future primary section detail page:

```bash
python fetch_schedule.py --section-history-mode full
```

Scrape one specific term (or a custom list) instead:

```bash
python fetch_schedule.py --term 202502
python fetch_schedule.py --terms 202502,202503,202601
```

Backfill historical schedule terms once (for example from Fall 2019 through the current term):

```bash
python fetch_schedule.py --from-term 201901
```

Rebuild instructor history from already-downloaded schedule files without making any network requests:

```bash
python build_course_instructor_history.py
```

Backfill section-level seat history from already-downloaded schedule CRNs:

```bash
python build_course_section_history.py --all-terms --workers 8 --max-inflight 4
```

Legacy JSON → JSONL migration (only needed if you still have `.json` files):

```bash
python migrate_to_jsonl.py --delete-json
```

## Known limitations (v3.1)

- **Graduation logic is complex**: requirements are scraped and normalized, but edge cases exist. Always confirm with official program rules.
- **Repeated attempts are represented as a planning replacement**: when an exact
  same-code course in an earlier term has a supported final grade, adding it to
  a later term can offer a confirmed retake replacement. `F/U/NA/W` are accepted
  without a deadline; passing `A-D` (and `S`) use the three-regular-semester
  window, with Summer excluded from the count. The new attempt starts ungraded
  and the earlier planner card is removed. This is intentionally not complete
  attempt history: the university transcript retains both registrations, while
  SUrriculum keeps one. `T`, unfinished/unknown grades, future source terms,
  ambiguous duplicates, and different-code substitutions fail closed. Always
  verify official repeat eligibility and GPA replacement. The planner excludes
  Summer from its window count but cannot identify approved leave semesters, so
  it may conservatively decline a passing-grade repeat that the university
  would allow after leave.
- **PDFs need readable text**: image-only files, including some Microsoft Print-to-PDF exports, must be re-exported with browser **Save as PDF**, saved as complete HTML, or processed with OCR.
- **Scheduler scraping reliability**: the university schedule endpoints can occasionally return server errors; re-run later or with delays.
- **Minor rule parsing**: minor pages vary; some rules are simplified into structured checks and may miss special cases.
- **Browser verification is still asymmetric**: the full automated browser suite focuses on Chromium; Firefox and WebKit run a smaller critical-flow gate.

## Roadmap

- **Post-3.1:** replace full-page reloads for main-major, double-major, minor,
  and admit-term changes with one transactional in-place program switch. The
  switch should fetch and validate the next catalogs/requirements, atomically
  replace program state, recalculate and rerender every dependent view, and
  restore the previous state on failure. Whole-plan switching, import, reset,
  and deletion may keep their reload boundary because they change the active
  plan identity rather than only its academic configuration.
- More robust schedule scraping and section metadata (and smarter conflict-free suggestions).
- A first-class course-attempt model for retakes, repeated grades, and explicit substitutions.
- Richer course detail views (prerequisite parsing, nicer formatting, quick links).
- More term/year-aware rules for minors and program changes.
- Additional planner UX polish and small guidance popups.
- Optional recommendations and planning helpers.

## Credits

This repository started as a fork of the original Surriculum project: https://github.com/melih-kiziltoprak/surriculum

Maintained by **BEFICENT (Bilal M. G.)** with major additions including double major support, Data Science and Analytics and several FASS programs, a large UI overhaul, updated course lists, improved requirement checks, multi-plan support, minor support, and the term-selectable scheduler.

## License

This project is licensed under the GNU General Public License v3.0 (GPL-3.0).  
See `LICENSE`.
