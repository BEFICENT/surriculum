#!/usr/bin/env python3
"""Focused offline tests for catalog fallback course-page metadata.

Run through ``npm run test:python`` or directly from the repository root:

    python tests/scrape_coursepages_fallback_test.py
"""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import scrape_coursepages as scraper  # noqa: E402


def write_jsonl(path: Path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows),
        encoding="utf-8",
    )


def catalog_row(
    code,
    *,
    title,
    su=3,
    ects=5,
    engineering=0,
    basic_science=0,
    faculty="FENS",
    el_type="required",
    faculty_course="No",
):
    subject, number = code.split("-", 1)
    return {
        "Major": subject,
        "Code": number,
        "Course_Name": title,
        "SU_credit": su,
        "ECTS": ects,
        "Engineering": engineering,
        "Basic_Science": basic_science,
        "Faculty": faculty,
        "EL_Type": el_type,
        "Faculty_Course": faculty_course,
    }


class CatalogFallbackCollectionTests(unittest.TestCase):
    def test_newest_non_null_catalog_values_win_deterministically(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            write_jsonl(
                root / "202401" / "OLD.jsonl",
                [catalog_row(
                    "CS-101",
                    title="Old title",
                    su="2",
                    ects="4",
                    engineering="1",
                    basic_science="3",
                    faculty="OLD",
                )],
            )
            # Same newest term, conflicting values: the lexical path is the
            # documented deterministic tie-breaker, so AAA wins over ZZZ.
            write_jsonl(
                root / "202503" / "ZZZ.jsonl",
                [catalog_row(
                    "CS-101",
                    title="Other newest title",
                    su="9",
                    ects="9",
                    engineering="9",
                    basic_science="9",
                    faculty="OTHER",
                )],
            )
            newest = catalog_row(
                "CS-101",
                title="Newest title",
                su="3",
                ects=None,
                engineering="5",
                basic_science="0",
                faculty="FENS",
                el_type="core",
                faculty_course="FENS",
            )
            write_jsonl(root / "202503" / "AAA.jsonl", [newest])

            courses, expected_breakdown, fallbacks = scraper.collect_catalog_courses(str(root))

            self.assertEqual(courses["CS101"], scraper.CourseKey("CS", "101"))
            self.assertIn("CS101", expected_breakdown)
            self.assertEqual(
                fallbacks["CS101"],
                {
                    "title": "Newest title",
                    "su_credits": 3.0,
                    # The newest record omitted ECTS, so the next deterministic
                    # candidate supplies it before the older term is considered.
                    "ects": 9.0,
                    "engineering": 5.0,
                    "basic_science": 0.0,
                    "faculty": "FENS",
                },
            )
            self.assertNotIn("EL_Type", fallbacks["CS101"])
            self.assertNotIn("Faculty_Course", fallbacks["CS101"])

            # The legacy/debug helper retains its original two-result contract.
            legacy_courses, legacy_expected = scraper.collect_unique_courses(str(root))
            self.assertEqual(legacy_courses, courses)
            self.assertEqual(legacy_expected, expected_breakdown)


class CatalogFallbackMergeTests(unittest.TestCase):
    def test_merge_preserves_good_scrapes_and_contextual_fields(self):
        courses = {
            "CS101": scraper.CourseKey("CS", "101"),
            "MATH101": scraper.CourseKey("MATH", "101"),
            "HIST191": scraper.CourseKey("HIST", "191"),
        }
        fallbacks = {
            "CS101": {
                "title": "Catalog CS",
                "su_credits": 3.0,
                "ects": 5.0,
                "engineering": 5.0,
                "basic_science": 0.0,
                "faculty": "FENS",
            },
            "MATH101": {
                "title": "Calculus I",
                "su_credits": 3.0,
                "ects": 6.0,
                "engineering": 0.0,
                "basic_science": 6.0,
            },
            "HIST191": {
                "title": "History I",
                "su_credits": 2.0,
                "ects": 3.0,
                "engineering": 0.0,
                "basic_science": 0.0,
                "faculty": "FASS",
            },
        }
        records = {
            "CS101": {
                "course_id": "CS101",
                "scrape_ok": True,
                "title": "Live title",
                "su_credits": None,
                "ects": 7.0,
                "engineering": None,
                "basic_science": None,
                "faculty": "LIVE",
                "EL_Type": "area",
                "Faculty_Course": "SBS",
            },
            "MATH101": {
                "course_id": "MATH101",
                "scrape_ok": False,
                "title": "Wrong response title",
                "su_credits": 99.0,
                "ects": 99.0,
                "engineering": 99.0,
                "basic_science": 99.0,
                "faculty": "WRONG",
                "EL_Type": "university",
                "Faculty_Course": "FENS",
            },
        }

        created, filled = scraper.apply_catalog_fallbacks(records, courses, fallbacks)

        self.assertEqual(created, 1)
        self.assertGreater(filled, 0)

        good = records["CS101"]
        self.assertEqual(good["title"], "Live title")
        self.assertEqual(good["su_credits"], 3.0)
        self.assertEqual(good["ects"], 7.0)
        self.assertEqual(good["engineering"], 5.0)
        self.assertEqual(good["basic_science"], 0.0)
        self.assertEqual(good["faculty"], "LIVE")
        self.assertEqual(good["EL_Type"], "area")
        self.assertEqual(good["Faculty_Course"], "SBS")

        failed = records["MATH101"]
        for field, value in fallbacks["MATH101"].items():
            self.assertEqual(failed[field], value)
        self.assertIsNone(failed["faculty"])
        self.assertEqual(failed["EL_Type"], "university")
        self.assertEqual(failed["Faculty_Course"], "FENS")

        missing = records["HIST191"]
        self.assertFalse(missing["scrape_ok"])
        self.assertEqual(missing["scrape_error"], "coursepage_data_unavailable")
        self.assertEqual(missing["title"], "History I")
        self.assertEqual(missing["su_credits"], 2.0)
        self.assertEqual(missing["faculty"], "FASS")
        self.assertEqual(missing["last_offered_terms"], [])
        self.assertNotIn("EL_Type", missing)
        self.assertNotIn("Faculty_Course", missing)

    def test_cli_writes_fallback_record_after_total_fetch_failure(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / "courses"
            write_jsonl(
                root / "202503" / "CS.jsonl",
                [catalog_row(
                    "CS-404",
                    title="Machine Learning",
                    su="3",
                    ects="5",
                    engineering="5",
                    basic_science="0",
                    faculty="FENS",
                )],
            )
            output_dir = Path(temp_dir) / "output"
            all_info = output_dir / "all.jsonl"
            basic_science = output_dir / "basic.jsonl"
            argv = [
                "scrape_coursepages.py",
                "--courses-dir", str(root),
                "--out-all-info", str(all_info),
                "--out-basic-science", str(basic_science),
                "--cache-dir", str(Path(temp_dir) / "cache"),
                "--workers", "1",
                "--retries", "0",
                "--no-update-course-json",
            ]

            with mock.patch.object(sys, "argv", argv), mock.patch.object(
                scraper,
                "fetch_coursepage_html",
                side_effect=RuntimeError("offline"),
            ):
                self.assertEqual(scraper.main(), 0)

            records = scraper.read_jsonl_by_course_id(str(all_info))
            self.assertEqual(set(records), {"CS404"})
            record = records["CS404"]
            self.assertFalse(record["scrape_ok"])
            self.assertEqual(record["scrape_error"], "coursepage_data_unavailable")
            self.assertEqual(record["title"], "Machine Learning")
            self.assertEqual(record["su_credits"], 3.0)
            self.assertEqual(record["ects"], 5.0)
            self.assertEqual(record["engineering"], 5.0)
            self.assertEqual(record["basic_science"], 0.0)
            self.assertEqual(record["faculty"], "FENS")


if __name__ == "__main__":
    unittest.main()
