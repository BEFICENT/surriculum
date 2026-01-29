# [SUrriculum v3.0 (Beta)](https://beficent.github.io/surriculum/)

SUrriculum is a fully client-side curriculum planner for Sabancı University undergraduate programs. It runs entirely in your browser (plain HTML/CSS/JS) and helps you:

- Build and maintain a semester-by-semester plan
- Track major / double major / minor requirements
- Import your transcript (Academic Records Summary) to prefill taken courses
- Use a current-term scheduler (SUchedule-style) to build a weekly timetable and sync it back into your plan

Live version: https://beficent.github.io/surriculum/

> Beta note: the tool is feature-rich, but still evolving. Always verify graduation requirements using official sources.

## Quick start

1. Clone/download this repository.
2. Open `index.html` in a modern browser (Chrome / Edge / Firefox).
3. Pick your program(s) + admit term(s) from the sidebar and start planning.

No build step, server, or database is required.

## What you can do (feature overview)

- **Programs**: select a main major, optional double major, and up to **3 minors**.
- **Admit terms**:
  - Main major and double major each have an admit term selector.
  - Each minor slot (`Minor 1/2/3`) has its own admit term selector.
- **Plans**: keep up to **10 saved plans**, reorder via drag-and-drop, rename, export, import, and delete (while keeping at least 1 plan).
- **Planner board**: add semesters, add/remove courses, drag courses between semesters, and see per-semester totals.
- **Course details**: open a details view for planned courses using the course row actions.
- **Import transcript**: import **Academic Records Summary** (HTML/PDF) or a **YÖK transcript PDF** (not preferred).
- **Graduation + summaries**: check requirement progress and open detailed summaries for majors and minors.
- **Current-term tools**:
  - Current term highlight
  - Optional “only show offered courses” filter for the current term
  - **Current Term Scheduler** for picking sections and building a weekly timetable
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
- Drag and drop courses between semesters to reorganize your plan.
- Use per-course buttons (next to delete) to open **details** and other actions.

### Custom courses

If a course is missing from the catalog (or you want placeholders), you can add a **custom course** and set its credits (including `.5`).

## Sidebar options (course dropdown behavior)

The “Add course” dropdown has several optional helpers:

- **Hide taken courses**: hides courses you’ve already taken/added (and also respects currently selected sections in the scheduler for the current term).
- **Only show offered courses in …**: filters the dropdown only for the **current term** (using `courses/all_coursepage_info.jsonl` coursepage history).
- **Sort based on score**: sorts the dropdown by a per-course “suggestion score” (highest first).

### How “Sort based on score” works

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
- If import fails or imports **0 courses**, SUrriculum shows a generic troubleshooting modal. One common cause is generating PDFs using **Microsoft Print to PDF**; prefer a real “Save as PDF”.

## Graduation and summaries

From the graduation/summary UI you can:

- Check graduation progress for your main major (and double major if selected).
- Open **detailed summaries** for majors and minors showing:
  - Which courses are taken (highlighted)
  - Which requirements are satisfied or missing
  - How overflow (upper → lower pool) courses are counted (color-coded)

Minors also enforce a CGPA rule:

- Minimum CGPA **2.72** for most minors
- Minimum CGPA **2.50** for the **Entrepreneurship** minor

## Current Term Scheduler (weekly timetable)

Open **Current Term Scheduler** from the sidebar. It is a SUchedule-style weekly grid for the current term.

Key features:

- **Search + browse** courses for the current term
- **Pick section** and place it on a weekly grid (Mon–Fri, 08:40–19:30)
- **Corequisite bundling**: courses with labs/recitations are treated as a bundle so you don’t “lose” the lab/recitation separately
- **Time conflicts**: overlapping classes render side-by-side instead of blocking each other
- **Copy CRNs**: copies the selected CRNs
- **Update current-term plan**: replaces the courses in your planner’s current-term semester with the scheduler’s selected main courses (labs/recitations are not added to the planner semester)
- **Block hours**:
  - Enable block mode and click-drag to block time slots
  - Courses that can’t fit around blocked hours can be filtered out, or optionally shown in red
- Optional helpers (toggles):
  - Hide taken courses
  - Show course details in the list (credits/type)
  - Sort based on score (same scoring as the main planner)
  - Hover preview (shows a translucent preview of how a course would look if added)
  - Availability highlighting (taken / conflict-free / conflict-prone indicators)

Schedule data files:

- The scheduler reads from `courses/schedule/<TERM>.jsonl`.
- Generate/update these files using `python fetch_schedule.py`.

Mobile note:

- The scheduler is usable on mobile, but works best in **landscape**.
- Some header actions collapse into a **“…”** menu on smaller widths.

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

Update current-term schedule data:

```bash
python fetch_schedule.py
```

Legacy JSON → JSONL migration (only needed if you still have `.json` files):

```bash
python migrate_to_jsonl.py --delete-json
```

## Known limitations (v3.0 Beta)

- **Graduation logic is complex**: requirements are scraped and normalized, but edge cases exist. Always confirm with official program rules.
- **Scheduler scraping reliability**: the university schedule endpoints can occasionally return server errors; re-run later or with delays.
- **Course offering filter quality**: “Only show offered courses in …” depends on `courses/all_coursepage_info.jsonl` and may be incomplete if the scraper hasn’t been run recently.
- **Minor rule parsing**: minor pages vary; some rules are simplified into structured checks and may miss special cases.

## Roadmap (post v3.0 Beta)

- More robust schedule scraping and section metadata (and smarter conflict-free suggestions).
- Richer course detail views (prerequisite parsing, nicer formatting, quick links).
- More term/year-aware rules for minors and program changes.
- Additional planner UX polish and small guidance popups.
- Optional recommendations and planning helpers.

## Credits

This repository started as a fork of the original Surriculum project: https://github.com/melih-kiziltoprak/surriculum

Maintained by **BEFICENT (Bilal M. G.)** with major additions including double major support, Data Science and Analytics and several FASS programs, a large UI overhaul, updated course lists, improved requirement checks, multi-plan support, minor support, and the current-term scheduler.

## License

This project is licensed under the GNU General Public License v3.0 (GPL-3.0).  
See `LICENSE`.
