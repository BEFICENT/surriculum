# SUrriculum

This project provides a simple web interface for creating semester schedules using Sabancı University course lists.

The course data used by the app is stored in JSON files (e.g. `CS.json`). These files were generated from the university course catalog and may need to be updated every academic year.

## Updating course lists

There is no built‑in scraper in this repository. To collect the latest courses you can use the scraper available in the [suchedule](https://github.com/aburakayaz/suchedule) project. A helper script `update_courses.py` is provided to merge newly discovered courses into the existing JSON data.

### Usage

1. Install dependencies
   ```bash
   pip install -r requirements.txt
   ```
2. Run the update script with the target term code (e.g. `20258` for Fall 2025):
   ```bash
   python update_courses.py --term 20258 --input CS.json --output courses_2025_2026.json
   ```
   The script fetches the offered course list and appends any courses not already present in the input file. Basic science/engineering fields are left as `0` by default because this information is not available from the schedule pages.

The generated file can then replace the existing JSON files so students can add the new courses in the application.

Visit the website from the link below:
https://melih-kiziltoprak.github.io/surriculum/
