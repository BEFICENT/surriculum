# [Surriculum v2.5](https://beficent.github.io/surriculum/)

Surriculum is an interactive graduation planner for Sabanci University undergraduate programs. The entire application runs in the browser using plain HTML, CSS and JavaScript. It lets you build a semester-by-semester plan, track program requirements and check whether you are on course to graduate.

A live instance is available at [beficent.github.io/surriculum](https://beficent.github.io/surriculum/).

## Using the tool

Clone this repository or download the source and open `index.html` in a modern web browser. No build step or server is required.

The interface allows you to:

- Select your major and an optional double major
- Add semesters and drag courses from the catalog
- Import your Academic Records Summary (HTML or PDF) to prefill taken courses. Or alternatively import your YÖK Transcript PDF file.
- Add custom courses manually
- Check graduation status and view a summary of remaining requirements for each major
- Toggle between light and dark themes or follow your system preference
- Collapse the sidebar to maximize planning space
- On touch devices, swipe from the left edge to open the sidebar
- Insert new semesters and courses using "+ New Semester" and "+ Add course" ghosts
- Show additional course details using the "Show Course Details" toggle
- Hide courses you've already added from the "Add course" dropdown list using the "Hide Taken Courses" toggle

Always verify graduation requirements yourself. For issues or suggestions, contact [bilal.gebenoglu@sabanciuniv.edu](mailto:bilal.gebenoglu@sabanciuniv.edu), or start a discussion/issue on the repository.

## Updating course data

Course catalogs and requirements are stored as JSONL files (`.jsonl`) under `courses/` and `requirements/`. The app and scrapers still support legacy `.json` as a fallback.

0. Install scraper dependencies: `pip install -r requirements.txt`
1. Edit `fetch_courses.py` if the university site changes and run `python fetch_courses.py` to regenerate the JSONL files. The scraper downloads data for every term starting from Fall 2019 and stores them under `courses/<TERM>/`. A `terms.jsonl` file indicates which majors are available for each term.
2. Run `scrape_coursepages.py` to populate `Basic_Science` and `Engineering` values by scraping each course page (the old CSV-based `update_credits.py` is deprecated).
3. Run `python fetch_requirements.py` to scrape updated graduation rules into the JSONL files under `requirements/`. Update matching messages in `main.js` if necessary.

To migrate existing pretty-printed `.json` files in-place, use `python migrate_to_jsonl.py` (add `--delete-json` to remove the legacy files after conversion).

When using the planner, select your major and specify the entry term for both your main major and optional double major. Course lists and graduation requirements adjust automatically based on the selected terms.

After updating data, manually test with various course combinations to ensure the graduation checker behaves correctly.

### Coursepage outputs

`scrape_coursepages.py` also maintains two cumulative files:

- `courses/basic_science_credits.jsonl`: per-course ECTS breakdown (engineering/basic science) scraped from course pages
- `courses/all_coursepage_info.jsonl`: full per-course coursepage info (description, prerequisites, etc.) for all courses ever recorded by this repo

Tip: if scraping is slow, use `python scrape_coursepages.py --workers 8 --max-inflight 4`.
Tip: if course fetching is slow, use `python fetch_courses.py --workers 8 --max-inflight 6` (or `--skip-coursepages` to only refresh catalogs).

## Credits

This repository started as a fork of the original Surriculum project (https://github.com/melih-kiziltoprak/surriculum) and is maintained by **BEFICENT (Bilal M. G.)**. Major additions include double major support, Data Science and Analytics and several FASS programs, UI overhaul, updated course lists and improved requirement checks.

## License

This project is licensed under the GNU General Public License v3.0 (GPL-3.0).  
See the [LICENSE](./LICENSE) file for more information.
