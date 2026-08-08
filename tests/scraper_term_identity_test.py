#!/usr/bin/env python3
"""Offline regressions for SUIS response identity and atomic publication."""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from bs4 import BeautifulSoup

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import fetch_courses as fc  # noqa: E402
import fetch_minors as fm  # noqa: E402
import fetch_requirements as fr  # noqa: E402
from suis_page_validation import (  # noqa: E402
    DegreePageTermMismatch,
    require_matching_admit_term,
    validate_suis_term_code,
)


def degree_page(admit_heading):
    heading = "" if admit_heading is None else f"<h3>{admit_heading}</h3>"
    # The rest deliberately looks complete. SUIS fallback responses can carry
    # real current-term summary/course data even though the requested term was
    # unavailable; content plausibility must not substitute for page identity.
    return f"""
        <html><body>{heading}
          <h1>COMPUTER SCIENCE AND ENGINEERING UNDERGRADUATE PROGRAM</h1>
          <table class="t_mezuniyet">
            <thead><tr><th>Course Category</th><th>Min. ECTS Credits</th><th>Min. SU Credits</th></tr></thead>
            <tr><td>University Courses</td><td>-</td><td>41</td></tr>
            <tr><td>Required Courses</td><td>-</td><td>40</td></tr>
            <tr><td>Core Electives</td><td>-</td><td>27</td></tr>
            <tr><td>Area Electives</td><td>-</td><td>9</td></tr>
            <tr><td>Free Electives</td><td>-</td><td>15</td></tr>
            <tr><td>Total</td><td>240</td><td>132</td></tr>
          </table>
          <a name="CS_REQ"></a>
          <table><tr><th></th><th>Course</th><th>Name</th><th>ECTS</th><th>SU Credits</th></tr>
            <tr><td></td><td>CS 201</td><td>Programming Fundamentals</td><td>6</td><td>3</td></tr>
          </table>
          CS 395
        </body></html>
    """


VALID_PAGE = degree_page("Admit Term: Fall 2026-2027")
FALLBACK_PAGE = degree_page("Admit Term: Fall 2025-2026")


class FakeResponse:
    def __init__(self, text):
        self.text = text

    def raise_for_status(self):
        return None


class FakeSession:
    def __init__(self, text):
        self.text = text
        self.calls = 0

    def get(self, _url, timeout=None):
        self.calls += 1
        return FakeResponse(self.text)


class TermIdentityTests(unittest.TestCase):
    def test_exact_displayed_term_is_required(self):
        soup = BeautifulSoup(VALID_PAGE, "lxml")
        self.assertEqual(require_matching_admit_term(soup, "202601"), "202601")

        rejected = [
            degree_page(None),
            degree_page("Admit Term:"),
            FALLBACK_PAGE,
        ]
        for html in rejected:
            with self.subTest(html=html[:80]):
                with self.assertRaises(DegreePageTermMismatch):
                    require_matching_admit_term(BeautifulSoup(html, "lxml"), "202601")

    def test_invalid_term_suffix_is_rejected(self):
        for term in ("202600", "202604", "999999", "20261", "offline", ""):
            with self.subTest(term=term), self.assertRaises(ValueError):
                validate_suis_term_code(term)
        for term in ("202601", "202602", "202603"):
            self.assertEqual(validate_suis_term_code(term), term)

    def test_requirements_reject_fallback_before_parsing(self):
        original_session = fr._session
        fake = FakeSession(FALLBACK_PAGE)
        try:
            fr._session = fake
            with self.assertRaises(DegreePageTermMismatch):
                fr.fetch_requirements("BSCS", "202601")
            self.assertEqual(fake.calls, 1)

            fake.calls = 0
            with self.assertRaises(ValueError):
                fr.fetch_requirements("BSCS", "999999")
            self.assertEqual(fake.calls, 0, "invalid term input must fail before HTTP")
        finally:
            fr._session = original_session

    def test_course_catalog_rejects_fallback_before_parsing(self):
        original_fetch = fc.fetch_html
        calls = []
        try:
            fc.fetch_html = lambda url: calls.append(url) or FALLBACK_PAGE
            with self.assertRaises(DegreePageTermMismatch):
                fc.crawl_program("BSCS", "202601")
            self.assertEqual(len(calls), 1)

            calls.clear()
            with self.assertRaises(ValueError):
                fc.crawl_program("BSCS", "999999")
            self.assertEqual(calls, [], "invalid term input must fail before HTTP")
        finally:
            fc.fetch_html = original_fetch

    def test_minor_catalog_rejects_fallback_before_parsing(self):
        original_fetch = fm.fetch_html
        calls = []
        try:
            fm.fetch_html = lambda url, timeout=30.0: calls.append(url) or FALLBACK_PAGE
            with self.assertRaises(DegreePageTermMismatch):
                fm.load_minor_detail_html("PHYS-MINOR", "202601", None, 30.0)
            self.assertEqual(len(calls), 1)

            calls.clear()
            with self.assertRaises(ValueError):
                fm.load_minor_detail_html("PHYS-MINOR", "999999", None, 30.0)
            self.assertEqual(calls, [], "invalid term input must fail before HTTP")
        finally:
            fm.fetch_html = original_fetch

    def test_full_minor_refresh_is_atomic_when_one_program_fails(self):
        original_courses_dir = fm.COURSES_DIR
        original_requirements_dir = fm.REQUIREMENTS_DIR
        original_legacy_path = fm.REQUIREMENTS_LEGACY_PATH
        original_manifest_path = fm.REQUIREMENTS_TERMS_MANIFEST
        original_fetch = fm.fetch_html
        original_load_detail = fm.load_minor_detail_html
        original_credit_lookup = fm.load_coursepage_credit_lookup
        original_argv = sys.argv[:]
        try:
            with tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                courses_dir = root / "courses" / "minors"
                requirements_dir = root / "requirements" / "minors"
                requirements_dir.mkdir(parents=True)
                (courses_dir / "202601").mkdir(parents=True)

                requirement_path = requirements_dir / "202601.jsonl"
                requirement_before = (
                    '{"minor":"GOOD-MINOR","old":true}\n'
                    '{"minor":"ZBAD-MINOR","old":true}\n'
                )
                requirement_path.write_text(requirement_before, encoding="utf-8")
                good_catalog = courses_dir / "202601" / "GOOD-MINOR.jsonl"
                bad_catalog = courses_dir / "202601" / "ZBAD-MINOR.jsonl"
                good_catalog.write_text("old good catalog\n", encoding="utf-8")
                bad_catalog.write_text("old bad catalog\n", encoding="utf-8")
                manifest = requirements_dir / "terms.jsonl"
                manifest_before = '{"term":"202601"}\n'
                manifest.write_text(manifest_before, encoding="utf-8")

                fm.COURSES_DIR = str(courses_dir)
                fm.REQUIREMENTS_DIR = str(requirements_dir)
                fm.REQUIREMENTS_LEGACY_PATH = str(root / "requirements" / "minors.jsonl")
                fm.REQUIREMENTS_TERMS_MANIFEST = str(manifest)
                fm.fetch_html = lambda _url, timeout=30.0: (
                    '<a href="SU_DEGREE.p_degree_detail?P_PROGRAM=GOOD-MINOR">Good</a>'
                    '<a href="SU_DEGREE.p_degree_detail?P_PROGRAM=ZBAD-MINOR">Bad</a>'
                )

                def load_detail(program, _term, _offline_dir, _timeout):
                    if program == "ZBAD-MINOR":
                        raise DegreePageTermMismatch("fallback page")
                    return VALID_PAGE

                fm.load_minor_detail_html = load_detail
                fm.load_coursepage_credit_lookup = lambda: {}
                sys.argv = ["fetch_minors.py", "--terms", "202601", "--workers", "1"]

                self.assertEqual(fm.main(), 1)
                self.assertEqual(requirement_path.read_text(encoding="utf-8"), requirement_before)
                self.assertEqual(good_catalog.read_text(encoding="utf-8"), "old good catalog\n")
                self.assertEqual(bad_catalog.read_text(encoding="utf-8"), "old bad catalog\n")
                self.assertEqual(manifest.read_text(encoding="utf-8"), manifest_before)
                self.assertEqual(list(root.rglob(".*.tmp")), [])
                self.assertEqual(list(root.rglob(".*.bak")), [])
        finally:
            fm.COURSES_DIR = original_courses_dir
            fm.REQUIREMENTS_DIR = original_requirements_dir
            fm.REQUIREMENTS_LEGACY_PATH = original_legacy_path
            fm.REQUIREMENTS_TERMS_MANIFEST = original_manifest_path
            fm.fetch_html = original_fetch
            fm.load_minor_detail_html = original_load_detail
            fm.load_coursepage_credit_lookup = original_credit_lookup
            sys.argv = original_argv

    def test_max_programs_minor_refresh_merges_without_truncating(self):
        original_courses_dir = fm.COURSES_DIR
        original_requirements_dir = fm.REQUIREMENTS_DIR
        original_legacy_path = fm.REQUIREMENTS_LEGACY_PATH
        original_manifest_path = fm.REQUIREMENTS_TERMS_MANIFEST
        original_fetch = fm.fetch_html
        original_load_detail = fm.load_minor_detail_html
        original_credit_lookup = fm.load_coursepage_credit_lookup
        original_argv = sys.argv[:]
        try:
            with tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                courses_dir = root / "courses" / "minors"
                requirements_dir = root / "requirements" / "minors"
                requirements_dir.mkdir(parents=True)
                (courses_dir / "202601").mkdir(parents=True)

                requirement_path = requirements_dir / "202601.jsonl"
                requirement_path.write_text(
                    '{"minor":"GOOD-MINOR","old":true}\n'
                    '{"minor":"ZBAD-MINOR","keep":"unchanged"}\n',
                    encoding="utf-8",
                )
                untouched_catalog = courses_dir / "202601" / "ZBAD-MINOR.jsonl"
                untouched_catalog.write_text("untouched catalog\n", encoding="utf-8")
                manifest = requirements_dir / "terms.jsonl"
                manifest_before = '{"term":"202501"}\n'
                manifest.write_text(manifest_before, encoding="utf-8")

                fm.COURSES_DIR = str(courses_dir)
                fm.REQUIREMENTS_DIR = str(requirements_dir)
                fm.REQUIREMENTS_LEGACY_PATH = str(root / "requirements" / "minors.jsonl")
                fm.REQUIREMENTS_TERMS_MANIFEST = str(manifest)
                fm.fetch_html = lambda _url, timeout=30.0: (
                    '<a href="SU_DEGREE.p_degree_detail?P_PROGRAM=GOOD-MINOR">Good</a>'
                    '<a href="SU_DEGREE.p_degree_detail?P_PROGRAM=ZBAD-MINOR">Bad</a>'
                )
                calls = []
                fm.load_minor_detail_html = lambda program, _term, _offline_dir, _timeout: (
                    calls.append(program) or VALID_PAGE
                )
                fm.load_coursepage_credit_lookup = lambda: {}
                sys.argv = [
                    "fetch_minors.py", "--terms", "202601", "--max-programs", "1", "--workers", "1"
                ]

                self.assertEqual(fm.main(), 0)
                records = {
                    record["minor"]: record
                    for record in map(json.loads, requirement_path.read_text(encoding="utf-8").splitlines())
                }
                self.assertEqual(calls, ["GOOD-MINOR"])
                self.assertEqual(set(records), {"GOOD-MINOR", "ZBAD-MINOR"})
                self.assertEqual(records["ZBAD-MINOR"], {"minor": "ZBAD-MINOR", "keep": "unchanged"})
                self.assertNotIn("old", records["GOOD-MINOR"])
                self.assertEqual(untouched_catalog.read_text(encoding="utf-8"), "untouched catalog\n")
                self.assertEqual(manifest.read_text(encoding="utf-8"), manifest_before)
        finally:
            fm.COURSES_DIR = original_courses_dir
            fm.REQUIREMENTS_DIR = original_requirements_dir
            fm.REQUIREMENTS_LEGACY_PATH = original_legacy_path
            fm.REQUIREMENTS_TERMS_MANIFEST = original_manifest_path
            fm.fetch_html = original_fetch
            fm.load_minor_detail_html = original_load_detail
            fm.load_coursepage_credit_lookup = original_credit_lookup
            sys.argv = original_argv

    def test_minor_atomic_publish_cleans_staging_when_replace_fails(self):
        original_replace = fm.os.replace
        try:
            with tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                target = root / "requirements.jsonl"
                target.write_text("last-known-good\n", encoding="utf-8")

                fm.os.replace = lambda _source, _target: (_ for _ in ()).throw(
                    OSError("injected replace failure")
                )
                with self.assertRaises(OSError):
                    fm._publish_text_files_atomically({str(target): "replacement\n"})

                self.assertEqual(target.read_text(encoding="utf-8"), "last-known-good\n")
                self.assertEqual(list(root.glob(".*.tmp")), [])
                self.assertEqual(list(root.glob(".*.bak")), [])
        finally:
            fm.os.replace = original_replace

    def test_requirement_refresh_preserves_existing_term_on_fallback(self):
        original_dir = fr.REQUIREMENTS_DIR
        original_session = fr._session
        original_argv = sys.argv[:]
        try:
            with tempfile.TemporaryDirectory() as tmp:
                fr.REQUIREMENTS_DIR = tmp
                target = Path(tmp, "202601.jsonl")
                target.write_text("last-known-good\n", encoding="utf-8")
                fr._session = FakeSession(FALLBACK_PAGE)
                sys.argv = ["fetch_requirements.py", "--terms", "202601", "--skip-minors"]

                self.assertEqual(fr.main(), 1)
                self.assertEqual(target.read_text(encoding="utf-8"), "last-known-good\n")
                self.assertEqual(list(Path(tmp).glob(".*.tmp")), [])
        finally:
            fr.REQUIREMENTS_DIR = original_dir
            fr._session = original_session
            sys.argv = original_argv

    def test_course_refresh_invalid_term_creates_no_output(self):
        original_dir = fc.COURSES_DIR
        original_get_programs = fc.get_program_codes
        original_argv = sys.argv[:]
        try:
            with tempfile.TemporaryDirectory() as tmp:
                out_dir = Path(tmp, "courses")
                fc.COURSES_DIR = str(out_dir)
                fc.get_program_codes = lambda: self.fail("program discovery must not run")
                sys.argv = [
                    "fetch_courses.py", "--terms", "999999", "--skip-minors", "--skip-coursepages"
                ]
                with self.assertRaises(ValueError):
                    fc.main()
                self.assertEqual(list(out_dir.glob("**/*")), [])
        finally:
            fc.COURSES_DIR = original_dir
            fc.get_program_codes = original_get_programs
            sys.argv = original_argv

    def test_empty_program_list_preserves_existing_catalog_index(self):
        original_dir = fc.COURSES_DIR
        original_get_programs = fc.get_program_codes
        original_argv = sys.argv[:]
        try:
            with tempfile.TemporaryDirectory() as tmp:
                out_dir = Path(tmp, "courses")
                catalog = out_dir / "202601" / "CS.jsonl"
                catalog.parent.mkdir(parents=True)
                catalog.write_text("existing catalog\n", encoding="utf-8")
                index = out_dir / "terms.jsonl"
                index.write_text('{"term":"202601","majors":["CS"]}\n', encoding="utf-8")

                fc.COURSES_DIR = str(out_dir)
                fc.get_program_codes = lambda: {}
                sys.argv = [
                    "fetch_courses.py", "--terms", "202601", "--skip-minors", "--skip-coursepages"
                ]
                with self.assertRaises(RuntimeError):
                    fc.main()

                self.assertEqual(catalog.read_text(encoding="utf-8"), "existing catalog\n")
                self.assertEqual(
                    index.read_text(encoding="utf-8"),
                    '{"term":"202601","majors":["CS"]}\n',
                )
        finally:
            fc.COURSES_DIR = original_dir
            fc.get_program_codes = original_get_programs
            sys.argv = original_argv

    def test_all_program_failures_preserve_existing_catalog_index(self):
        original_dir = fc.COURSES_DIR
        original_get_programs = fc.get_program_codes
        original_program_files = fc.PROGRAM_FILES
        original_crawl = fc.crawl_program
        original_argv = sys.argv[:]
        try:
            with tempfile.TemporaryDirectory() as tmp:
                out_dir = Path(tmp, "courses")
                catalog = out_dir / "202601" / "CS.jsonl"
                catalog.parent.mkdir(parents=True)
                catalog.write_text("existing catalog\n", encoding="utf-8")
                index = out_dir / "terms.jsonl"
                index.write_text('{"term":"202601","majors":["CS"]}\n', encoding="utf-8")

                fc.COURSES_DIR = str(out_dir)
                fc.PROGRAM_FILES = {"BSCS": "CS.jsonl"}
                fc.get_program_codes = lambda: {"BSCS": "Computer Science"}
                fc.crawl_program = lambda _program, _term: (_ for _ in ()).throw(
                    DegreePageTermMismatch("fallback page")
                )
                sys.argv = [
                    "fetch_courses.py", "--terms", "202601", "--workers", "1",
                    "--skip-minors", "--skip-coursepages",
                ]

                self.assertEqual(fc.main(), 1)
                self.assertEqual(catalog.read_text(encoding="utf-8"), "existing catalog\n")
                self.assertEqual(
                    index.read_text(encoding="utf-8"),
                    '{"term":"202601","majors":["CS"]}\n',
                )
        finally:
            fc.COURSES_DIR = original_dir
            fc.get_program_codes = original_get_programs
            fc.PROGRAM_FILES = original_program_files
            fc.crawl_program = original_crawl
            sys.argv = original_argv

    def test_successful_subset_merges_without_dropping_unrequested_or_failed_terms(self):
        original_dir = fc.COURSES_DIR
        original_get_programs = fc.get_program_codes
        original_program_files = fc.PROGRAM_FILES
        original_crawl = fc.crawl_program
        original_argv = sys.argv[:]
        try:
            with tempfile.TemporaryDirectory() as tmp:
                out_dir = Path(tmp, "courses")
                out_dir.mkdir()
                index = out_dir / "terms.jsonl"
                index.write_text(
                    '{"term":"202401","majors":["OLD"]}\n'
                    '{"term":"202501","majors":["STALE"]}\n'
                    '{"term":"202502","majors":["LAST_GOOD"]}\n',
                    encoding="utf-8",
                )

                fc.COURSES_DIR = str(out_dir)
                fc.PROGRAM_FILES = {"BSCS": "CS.jsonl"}
                fc.get_program_codes = lambda: {"BSCS": "Computer Science"}

                def crawl(_program, term):
                    if term == "202502":
                        raise DegreePageTermMismatch("fallback page")
                    return [{"Major": "CS", "Code": "201"}]

                fc.crawl_program = crawl
                sys.argv = [
                    "fetch_courses.py", "--terms", "202501,202502", "--workers", "1",
                    "--skip-minors", "--skip-coursepages",
                ]

                self.assertEqual(fc.main(), 1)
                rows = {
                    row["term"]: row
                    for row in map(json.loads, index.read_text(encoding="utf-8").splitlines())
                }
                self.assertEqual(rows["202401"]["majors"], ["OLD"])
                self.assertEqual(rows["202501"]["majors"], ["CS"])
                self.assertEqual(rows["202502"]["majors"], ["LAST_GOOD"])
                self.assertEqual(list(out_dir.glob(".terms.*.tmp")), [])
        finally:
            fc.COURSES_DIR = original_dir
            fc.get_program_codes = original_get_programs
            fc.PROGRAM_FILES = original_program_files
            fc.crawl_program = original_crawl
            sys.argv = original_argv

    def test_max_terms_merges_only_the_terms_actually_processed(self):
        original_dir = fc.COURSES_DIR
        original_get_programs = fc.get_program_codes
        original_program_files = fc.PROGRAM_FILES
        original_crawl = fc.crawl_program
        original_argv = sys.argv[:]
        try:
            with tempfile.TemporaryDirectory() as tmp:
                out_dir = Path(tmp, "courses")
                out_dir.mkdir()
                index = out_dir / "terms.jsonl"
                index.write_text(
                    '{"term":"202501","majors":["STALE"]}\n'
                    '{"term":"202502","majors":["UNTOUCHED"]}\n',
                    encoding="utf-8",
                )

                calls = []
                fc.COURSES_DIR = str(out_dir)
                fc.PROGRAM_FILES = {"BSCS": "CS.jsonl"}
                fc.get_program_codes = lambda: {"BSCS": "Computer Science"}
                fc.crawl_program = lambda _program, term: (
                    calls.append(term) or [{"Major": "CS", "Code": "201"}]
                )
                sys.argv = [
                    "fetch_courses.py", "--terms", "202501,202502", "--max-terms", "1",
                    "--workers", "1", "--skip-minors", "--skip-coursepages",
                ]

                self.assertEqual(fc.main(), 0)
                rows = {
                    row["term"]: row
                    for row in map(json.loads, index.read_text(encoding="utf-8").splitlines())
                }
                self.assertEqual(calls, ["202501"])
                self.assertEqual(rows["202501"]["majors"], ["CS"])
                self.assertEqual(rows["202502"]["majors"], ["UNTOUCHED"])
                self.assertEqual(list(out_dir.glob(".terms.*.tmp")), [])
        finally:
            fc.COURSES_DIR = original_dir
            fc.get_program_codes = original_get_programs
            fc.PROGRAM_FILES = original_program_files
            fc.crawl_program = original_crawl
            sys.argv = original_argv

    def test_course_refresh_propagates_minor_subprocess_failure(self):
        original_dir = fc.COURSES_DIR
        original_get_programs = fc.get_program_codes
        original_program_files = fc.PROGRAM_FILES
        original_crawl = fc.crawl_program
        original_run = fc.subprocess.run
        original_argv = sys.argv[:]
        try:
            with tempfile.TemporaryDirectory() as tmp:
                out_dir = Path(tmp, "courses")
                fc.COURSES_DIR = str(out_dir)
                fc.PROGRAM_FILES = {"BSCS": "CS.jsonl"}
                fc.get_program_codes = lambda: {"BSCS": "Computer Science"}
                fc.crawl_program = lambda _program, _term: [
                    {"Major": "CS", "Code": "201"}
                ]
                calls = []

                def fail_minor_refresh(command, check=False):
                    calls.append(command)
                    self.assertTrue(check)
                    raise subprocess.CalledProcessError(1, command)

                fc.subprocess.run = fail_minor_refresh
                sys.argv = [
                    "fetch_courses.py", "--terms", "202601", "--workers", "1",
                    "--skip-coursepages",
                ]

                self.assertEqual(fc.main(), 1)
                self.assertEqual(len(calls), 1)
                self.assertIn("fetch_minors.py", calls[0])
        finally:
            fc.COURSES_DIR = original_dir
            fc.get_program_codes = original_get_programs
            fc.PROGRAM_FILES = original_program_files
            fc.crawl_program = original_crawl
            fc.subprocess.run = original_run
            sys.argv = original_argv

    def test_requirement_refresh_propagates_minor_subprocess_failure(self):
        original_dir = fr.REQUIREMENTS_DIR
        original_program_codes = fr.PROGRAM_CODES
        original_expected_majors = fr.EXPECTED_MAJORS
        original_fetch = fr.fetch_requirements
        original_hum_required = fr.hum_required
        original_special = fr.special_requirements
        original_validate = fr.validate_requirement_record
        original_write = fr.write_requirements_term_atomic
        original_run = fr.subprocess.run
        original_argv = sys.argv[:]
        try:
            with tempfile.TemporaryDirectory() as tmp:
                fr.REQUIREMENTS_DIR = tmp
                fr.PROGRAM_CODES = {"BSCS": "CS"}
                fr.EXPECTED_MAJORS = ("CS",)
                fr.fetch_requirements = lambda _program, _term, _offline, timeout_s=30.0: {
                    "university": 0
                }
                fr.hum_required = lambda _major, _university: 0
                fr.special_requirements = lambda _major, _pools=None: {}
                fr.validate_requirement_record = lambda _major, _record: None
                published = []
                fr.write_requirements_term_atomic = lambda term, records: published.append(
                    (term, records)
                )
                calls = []

                def fail_minor_refresh(command, check=False):
                    calls.append(command)
                    self.assertTrue(check)
                    raise subprocess.CalledProcessError(1, command)

                fr.subprocess.run = fail_minor_refresh
                sys.argv = ["fetch_requirements.py", "--terms", "202601"]

                self.assertEqual(fr.main(), 1)
                self.assertEqual(len(published), 1)
                self.assertEqual(len(calls), 1)
                self.assertIn("fetch_minors.py", calls[0])
        finally:
            fr.REQUIREMENTS_DIR = original_dir
            fr.PROGRAM_CODES = original_program_codes
            fr.EXPECTED_MAJORS = original_expected_majors
            fr.fetch_requirements = original_fetch
            fr.hum_required = original_hum_required
            fr.special_requirements = original_special
            fr.validate_requirement_record = original_validate
            fr.write_requirements_term_atomic = original_write
            fr.subprocess.run = original_run
            sys.argv = original_argv


if __name__ == "__main__":
    unittest.main(verbosity=2)
