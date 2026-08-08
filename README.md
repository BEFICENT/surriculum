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
  - Main major and double major each have an admit term selector.
  - Each minor slot (`Minor 1/2/3`) has its own admit term selector.
- **Plans**: keep up to **10 saved plans**, reorder them by dragging in the plan menu, rename, export, import, and delete (while keeping at least 1 plan).
- **Planner board**: add semesters and courses, reorder semesters with their drag handle (mouse or touch), remove courses, and see per-semester totals. Course cards themselves are not draggable between semesters; move one by removing it and adding it to the destination term.
- **Course details**: open a details view for planned courses using the course row actions.
- **Import transcript**: import **Academic Records Summary** (HTML/PDF) or a **YÖK transcript PDF** (not preferred).
- **Graduation + summaries**: check requirement progress and open detailed summaries for majors and minors.
- **Current-term tools**:
  - Current term highlight
  - Optional “only show offered courses” filter for the current term
  - **Scheduler** for picking sections and building weekly timetables by term
- **Quality of life**: dark/light theme, collapsible sidebar, touch-friendly behavior, custom modals (no default browser prompts).

If you hit a bug or want to improve the tool, open an issue/discussion or contact: [bilal.gebenoglu@sabanciuniv.edu](mailto:bilal.gebenoglu@sabanciuniv.edu)

## Planner basics

### Programs + admit terms

1. Choose your **main major** (required).
2. Optionally choose a **double major**.
3. Add up to **3 minors** using the “Add minor” flow.
4. Set admit terms for each selected program.

Course catalogs and requirement rules are loaded based on these selections.

### Adding semesters and courses

- Use **“+ New Semester”** to add a term to your plan.
- Use **“+ Add course”** in a semester to pick a course from the catalog.
- Use a semester's drag handle to reorder terms with a mouse or touch gesture.
- To move a course to another semester, remove it and add it to the destination term; course cards are not drag targets.
- Use per-course buttons (next to delete) to open **details** and other actions.

### Custom courses

If a course is missing from the catalog (or you want placeholders), you can add a **custom course** and set its credits (including `.5`).

## Sidebar options (course dropdown behavior)

The “Add course” dropdown has several optional helpers:

- **Hide taken courses**: hides courses you’ve already taken/added (and also respects currently selected sections in the scheduler for the current term).
- **Only show offered courses for … term**: filters the dropdown only for the **current term** using the same term schedule as the scheduler (with reconciled course-page history as a fallback).
- **Smart Sort**: sorts the dropdown by a per-course “suggestion score” (highest first).

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
  - Hide taken courses
  - Show course details in the list (credits/type)
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

Scrape course pages for metadata (including Basic Science/Engineering credit breakdowns and “offered term” history):

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
- **Repeated attempts and retakes are not fully modelled**: the planner stores one occurrence per canonical course code. A retained failed or withdrawn attempt can therefore prevent planning the same code again. Import reconciliation keeps the latest chronological record and reports superseded or `Repeated` rows, but it does not preserve a complete attempt history or infer cross-code substitutions. Do not treat the planner as the official record for retake GPA replacement.
- **Course movement is not drag-and-drop**: semester and saved-plan ordering have drag controls, but moving a course between terms requires removing and re-adding it.
- **PDFs need readable text**: image-only files, including some Microsoft Print-to-PDF exports, must be re-exported with browser **Save as PDF**, saved as complete HTML, or processed with OCR.
- **Scheduler scraping reliability**: the university schedule endpoints can occasionally return server errors; re-run later or with delays.
- **Minor rule parsing**: minor pages vary; some rules are simplified into structured checks and may miss special cases.
- **Browser verification is still asymmetric**: the full automated browser suite focuses on Chromium; Firefox and WebKit run a smaller critical-flow gate.

## Roadmap

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
