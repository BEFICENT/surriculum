# [Surriculum v2.6](https://beficent.github.io/surriculum/)

Surriculum is an interactive graduation planner for Sabanci University undergraduate programs. The entire application runs in the browser using plain HTML, CSS and JavaScript. It lets you build a semester-by-semester plan, track program requirements and check whether you are on course to graduate.

A live instance is available at [beficent.github.io/surriculum](https://beficent.github.io/surriculum/).

## Using the tool

Clone this repository or download the source and open `index.html` in a modern web browser. No build step or server is required.

The interface allows you to:

- Select your major, optional double major, and up to 3 minors
- Keep multiple saved plans (up to 10) and switch between them from the header
- Add semesters and drag courses from the catalog
- Import your Academic Records Summary (HTML or PDF) to prefill taken courses (or import your YÖK Transcript PDF)
- Add custom courses manually
- Check graduation status and view a summary of remaining requirements for each major
- Toggle between light and dark themes or follow your system preference
- Collapse the sidebar to maximize planning space
- On touch devices, swipe from the left edge to open the sidebar
- Insert new semesters and courses using "+ New Semester" and "+ Add course" ghosts
- Show additional course details using the "Show Course Details" toggle
- Hide courses you've already added from the "Add course" dropdown list using the "Hide Taken Courses" toggle
- Optionally filter the "Add course" dropdown to only show courses offered in the current term (based on scraped coursepage info)

Always verify graduation requirements yourself. For issues or suggestions, contact [bilal.gebenoglu@sabanciuniv.edu](mailto:bilal.gebenoglu@sabanciuniv.edu), or start a discussion/issue on the repository.

## Updates in v2.6

- **JSONL storage**: course catalogs, requirements, and coursepage scrape outputs are stored as `.jsonl` (app still supports legacy `.json` as a fallback).
- **Multiple plans**: save up to 10 plans, reorder via drag-and-drop, rename, export, import, and delete (while keeping at least 1 plan).
- **Minors (early support)**: select up to 3 minors; minor courses appear in the course dropdown; a minor completion summary is shown in the graduation modal.
- **Less “browser-y” UX**: replaced default browser popups with custom modals for import/plan flows.
- **Current-term awareness**: current term is highlighted; admit term max is derived dynamically; optional filtering by “offered this term” uses `courses/all_coursepage_info.jsonl`.

## Known limitations (v2.6)

- **Minor term mismatch**: the bundled minor catalogs/requirements are currently scraped from **Spring 2025-2026** (`requirements/minors.jsonl`). They are not yet stored per admit term, so they may not match your actual admit term.
- **Minors are informational**: minor status is currently shown as a “completion summary” and does not affect the main graduation pass/fail result.
- **Minor rule parsing is partial**: only simple equivalence rules are auto-detected (e.g. “take one of X or Y”) plus the “all courses below are required” phrase.
- **Academic Records import edge case**: PDFs created via **Microsoft Print to PDF** may not be detected reliably. Prefer “Save as PDF” or the HTML export.
- **Wrong HTML save mode**: if you save SIS pages as “HTML only” instead of “Webpage, complete”, imports can fail (the app warns for the known “no permission” HTML content).
- **Course offering filter quality**: the “offered in current term” toggle depends on scraped coursepage history; it can be incomplete/out-of-date if the scraper hasn’t been run recently.

## Updating course data

Course catalogs and requirements are stored as JSONL files (`.jsonl`) under `courses/` and `requirements/`. The app and scrapers still support legacy `.json` as a fallback.

0. Install scraper dependencies: `pip install -r requirements.txt`
1. Edit `fetch_courses.py` if the university site changes and run `python fetch_courses.py` to regenerate the JSONL files. The scraper downloads data for every term starting from Fall 2019 and stores them under `courses/<TERM>/`. A `terms.jsonl` file indicates which majors are available for each term. By default it also updates **minor** catalogs/requirements for the newest term (use `--skip-minors` to disable).
2. Run `scrape_coursepages.py` to populate `Basic_Science` and `Engineering` values by scraping each course page (the old CSV-based `update_credits.py` is deprecated).
3. Run `python fetch_requirements.py` to scrape updated graduation rules into the JSONL files under `requirements/`. By default it also updates **minor** catalogs/requirements for the same term set (use `--skip-minors` to disable). Update matching messages in `main.js` if necessary.
4. Run `python fetch_minors.py --terms <TERM>` to scrape minor catalogs and requirements for a specific admit term into `courses/minors/<TERM>/*.jsonl` and `requirements/minors/<TERM>.jsonl` (use multiple comma-separated terms to add more).

To migrate existing pretty-printed `.json` files in-place, use `python migrate_to_jsonl.py` (add `--delete-json` to remove the legacy files after conversion).

When using the planner, select your major and specify the entry term for both your main major and optional double major. Course lists and graduation requirements adjust automatically based on the selected terms.

After updating data, manually test with various course combinations to ensure the graduation checker behaves correctly.

### Coursepage outputs

`scrape_coursepages.py` also maintains two cumulative files:

- `courses/basic_science_credits.jsonl`: per-course ECTS breakdown (engineering/basic science) scraped from course pages
- `courses/all_coursepage_info.jsonl`: full per-course coursepage info (description, prerequisites, etc.) for all courses ever recorded by this repo

Tip: if scraping is slow, use `python scrape_coursepages.py --workers 8 --max-inflight 4`.
Tip: if course fetching is slow, use `python fetch_courses.py --workers 8 --max-inflight 6` (or `--skip-coursepages` to only refresh catalogs).

## Future plans (v3.0)

- **Course details actions**: per-course “details” buttons that open an in-app panel and/or link out to the official SU course pages.
- **Built-in “SUchedule”**: a current-semester schedule builder with time-conflict detection, making it easy to create weekly timetables for upcoming registration.
- **Term-aware minors**: store minor catalogs/requirements by admit term (like majors) and support year-based differences.
- **UI polish**: small layout improvements, fewer reloads, and more consistent micro-interactions.
- **Warnings/notifiers**: lightweight notifications for common pitfalls (bad export formats, missing data files, etc.).
- **Fun + helpful extras**: curriculum trivia, course recommendations, and quality-of-life planning tools.

## Credits

This repository started as a fork of the original Surriculum project (https://github.com/melih-kiziltoprak/surriculum) and is maintained by **BEFICENT (Bilal M. G.)**. Major additions include double major support, Data Science and Analytics and several FASS programs, UI overhaul, updated course lists and improved requirement checks.

## License

This project is licensed under the GNU General Public License v3.0 (GPL-3.0).  
See the [LICENSE](./LICENSE) file for more information.
