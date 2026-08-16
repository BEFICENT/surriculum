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


def coursepage_html(code, general_label="", general_body=""):
    subject, number = code.split("-", 1)
    return f"""
    <html><body><table>
      <tr><th>{subject} {number} Test Course</th><th>3 Credits</th></tr>
      <tr><td>Test description.</td></tr>
      <tr><td><b>Prerequisite: </b>__</td></tr>
      <tr><td><b>Corequisite: </b>__</td></tr>
      <tr><td><b>General Requirements: </b>{general_label}</td></tr>
      <tr><td>{general_body}</td></tr>
      <tr><td>&nbsp;</td></tr>
    </table></body></html>
    """


class GeneralRequirementParserTests(unittest.TestCase):
    def test_credit_threshold_and_course_clauses_are_additive_structured_fields(self):
        html = coursepage_html(
            "HUM-201",
            "23.000 credits",
            """
            Course or Test: <a>SPS</a> 101<br>
            Minimum Grade of D<br>May not be taken concurrently.<br>
            <span>and</span> Course or Test: <a>SPS</a> 102<br>
            Minimum Grade of D<br>May not be taken concurrently.<br>
            <span>and</span> 000 to 9999<br>
            Minimum Grade of D<br>May not be taken concurrently.
            """,
        )

        parsed = scraper.parse_coursepage_html(html, source_url="fixture://hum201")

        self.assertIsNone(parsed["prerequisites"], "the ordinary source field stays faithful")
        self.assertEqual(parsed["minimum_earned_su_credits"], 23.0)
        self.assertEqual(
            parsed["general_requirement_prerequisites"],
            "SPS 101 - Undergraduate - Min Grade D and "
            "SPS 102 - Undergraduate - Min Grade D",
        )
        self.assertEqual(
            parsed["general_requirements"],
            "23.000 credits Course or Test: SPS 101 Minimum Grade of D "
            "May not be taken concurrently. and Course or Test: SPS 102 "
            "Minimum Grade of D May not be taken concurrently. and 000 to "
            "9999 Minimum Grade of D May not be taken concurrently.",
        )

    def test_sps303_credit_only_rule_is_parsed(self):
        parsed = scraper.parse_coursepage_html(
            coursepage_html(
                "SPS-303",
                "58.000 credits",
                "000 to 9999<br>Minimum Grade of D<br>May not be taken concurrently.",
            ),
            source_url="fixture://sps303",
        )

        self.assertEqual(parsed["minimum_earned_su_credits"], 58.0)
        self.assertIsNone(parsed["general_requirement_prerequisites"])
        self.assertEqual(
            parsed["general_requirements"],
            "58.000 credits 000 to 9999 Minimum Grade of D "
            "May not be taken concurrently.",
        )

    def test_generic_boilerplate_is_suppressed_but_self_rule_remains_raw_only(self):
        generic = scraper.parse_coursepage_html(
            coursepage_html(
                "CS-101",
                "",
                "000 to 9999<br>Minimum Grade of D<br>May not be taken concurrently.",
            ),
            source_url="fixture://generic",
        )
        self.assertIsNone(generic["general_requirements"])
        self.assertIsNone(generic["minimum_earned_su_credits"])
        self.assertIsNone(generic["general_requirement_prerequisites"])

        self_rule = scraper.parse_coursepage_html(
            coursepage_html(
                "TLL-001",
                "",
                "Course or Test: TLL 001<br>Minimum Grade of W<br>"
                "May not be taken concurrently.",
            ),
            source_url="fixture://tll001",
        )
        self.assertEqual(
            self_rule["general_requirements"],
            "Course or Test: TLL 001 Minimum Grade of W May not be taken concurrently.",
        )
        self.assertIsNone(self_rule["minimum_earned_su_credits"])
        self.assertIsNone(self_rule["general_requirement_prerequisites"])

    def test_structured_parser_preserves_concurrent_qualifier_and_avoids_self_or(self):
        self.assertEqual(
            scraper.parse_general_requirement_prerequisites(
                "Course or Test: NS 102 Minimum Grade of D May be taken concurrently.",
                course_id="ENS205",
            ),
            "NS 102 - Undergraduate - Min Grade D (can be taken concurrently)",
        )
        self.assertIsNone(scraper.parse_general_requirement_prerequisites(
            "Course or Test: TLL 001 Minimum Grade of W or "
            "Course or Test: SPS 101 Minimum Grade of D",
            course_id="TLL001",
        ))

    def test_cached_page_hydrates_additive_fields_without_replacing_old_metadata(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            cache_dir = Path(temp_dir)
            (cache_dir / "SPS303.html").write_text(
                coursepage_html(
                    "SPS-303",
                    "58.000 credits",
                    "000 to 9999<br>Minimum Grade of D<br>May not be taken concurrently.",
                ),
                encoding="utf-8",
            )
            records = {"SPS303": {
                "course_id": "SPS303",
                "subj_code": "SPS",
                "crse_numb": "303",
                "title": "Preserved title",
                "scraped_at": "old-timestamp",
                "source_url": "https://example.test/SPS303",
            }}

            self.assertEqual(
                scraper.hydrate_general_requirement_fields_from_cache(
                    records,
                    str(cache_dir),
                ),
                1,
            )
            self.assertEqual(records["SPS303"]["minimum_earned_su_credits"], 58.0)
            self.assertEqual(records["SPS303"]["title"], "Preserved title")
            self.assertEqual(records["SPS303"]["scraped_at"], "old-timestamp")


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
        self.assertIsNone(missing["general_requirements"])
        self.assertIsNone(missing["minimum_earned_su_credits"])
        self.assertIsNone(missing["general_requirement_prerequisites"])
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
