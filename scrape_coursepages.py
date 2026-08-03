import argparse
import datetime as _dt
import json
import math
import os
import re
import time
import concurrent.futures
import threading
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.parse import urlencode

import requests
from bs4 import BeautifulSoup

from sync_coursepage_offerings import available_current_future_terms, reconcile_coursepage_offerings


BASE = "https://suis.sabanciuniv.edu/prod/"
COURSEPAGE_ENDPOINT = "sabanci_www.p_get_courses"


DEFAULT_COURSES_DIR = "courses"
DEFAULT_OUT_BASIC_SCIENCE = os.path.join(DEFAULT_COURSES_DIR, "basic_science_credits.jsonl")
DEFAULT_OUT_ALL_INFO = os.path.join(DEFAULT_COURSES_DIR, "all_coursepage_info.jsonl")
DEFAULT_CACHE_DIR = os.path.join(DEFAULT_COURSES_DIR, "coursepage_html_cache")


# Program catalogs contain both intrinsic course metadata and contextual degree
# metadata.  Only the former belongs in the course-page index: EL_Type and
# Faculty_Course can differ by program and must continue to be resolved from the
# selected program's catalog at runtime.
CATALOG_FALLBACK_FIELDS = {
    "title": "Course_Name",
    "su_credits": "SU_credit",
    "ects": "ECTS",
    "engineering": "Engineering",
    "basic_science": "Basic_Science",
    "faculty": "Faculty",
}


@dataclass(frozen=True)
class CourseKey:
    subj_code: str
    crse_numb: str

    @property
    def course_id(self) -> str:
        return f"{self.subj_code}{self.crse_numb}"


def _now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat()


def build_coursepage_url(subj_code: str, crse_numb: str, *, levl_code: str = "UG", lang: str = "eng") -> str:
    qs = urlencode(
        {
            "levl_code": levl_code,
            "subj_code": subj_code,
            "crse_numb": crse_numb,
            "lang": lang,
        }
    )
    return f"{BASE}{COURSEPAGE_ENDPOINT}?{qs}"


def _to_float(value: str) -> Optional[float]:
    value = (value or "").strip()
    if not value:
        return None
    try:
        return float(value.replace(",", "."))
    except ValueError:
        return None


def parse_ects_breakdown(text: str) -> Tuple[Optional[float], Optional[float], Optional[float]]:
    """
    Parse patterns like:
      "6 ECTS (ENGINEERING:4 / BASIC:2)"
      "6 ECTS (ENGINEERING: 4 / BASIC: 2)"
      "6 ECTS"

    Returns: (ects_total, engineering, basic_science)
    """
    normalized = " ".join((text or "").split())
    ects_total = None
    engineering = None
    basic_science = None

    m_total = re.search(r"(\d+(?:[.,]\d+)?)\s*ECTS", normalized, flags=re.IGNORECASE)
    if m_total:
        ects_total = _to_float(m_total.group(1))

    m_eng = re.search(r"ENGINEERING\s*:\s*(\d+(?:[.,]\d+)?)", normalized, flags=re.IGNORECASE)
    if m_eng:
        engineering = _to_float(m_eng.group(1))

    m_basic = re.search(r"\bBASIC(?:\s+SCIENCE)?\s*:\s*(\d+(?:[.,]\d+)?)", normalized, flags=re.IGNORECASE)
    if m_basic:
        basic_science = _to_float(m_basic.group(1))

    return ects_total, engineering, basic_science


def _first_text(el) -> str:
    if not el:
        return ""
    return el.get_text(" ", strip=True)


def parse_coursepage_html(html: str, *, source_url: str) -> Dict[str, Any]:
    soup = BeautifulSoup(html, "lxml")

    header_text = ""
    su_credits = None
    title = None
    parsed_subj = None
    parsed_numb = None

    first_th = soup.find("th")
    if first_th:
        header_text = _first_text(first_th)
        m = re.match(r"^\s*([A-Z]+)\s+([0-9A-Z]+)\s+(.*?)\s*$", header_text)
        if m:
            parsed_subj, parsed_numb, title = m.group(1), m.group(2), m.group(3)
        else:
            title = header_text.strip() or None

    ths = first_th.find_parent("tr").find_all("th") if first_th and first_th.find_parent("tr") else []
    if len(ths) >= 2:
        credit_text = _first_text(ths[1])
        m_credit = re.search(r"(\d+(?:[.,]\d+)?)\s*Credits?\b", credit_text, flags=re.IGNORECASE)
        if m_credit:
            su_credits = _to_float(m_credit.group(1))

    description = None
    ects_total = None
    engineering = None
    basic_science = None
    prerequisites: List[str] = []
    corequisites: List[str] = []
    last_offered: List[Dict[str, Any]] = []

    # Description: first non-empty td after header that isn't a nested table and
    # doesn't start with a bold label.
    outer_table = soup.find("table")
    if outer_table:
        trs = outer_table.find_all("tr", recursive=False) or outer_table.find_all("tr")
        for tr in trs[1:]:
            td = tr.find("td")
            if not td:
                continue
            if td.find("table"):
                continue
            text = _first_text(td)
            if not text:
                continue
            if td.find("b"):
                continue
            description = text
            break

    # ECTS breakdown (site formatting varies; search broadly).
    for td in soup.find_all("td"):
        txt = _first_text(td)
        if not txt:
            continue
        if not re.search(r"\bECTS\b", txt, flags=re.IGNORECASE):
            continue
        if not (
            re.search(r"\bENGINEERING\b", txt, flags=re.IGNORECASE)
            or re.search(r"\bBASIC\b", txt, flags=re.IGNORECASE)
            or re.search(r"\bECTS\s+Credit", txt, flags=re.IGNORECASE)
        ):
            continue
        ects_total, engineering, basic_science = parse_ects_breakdown(txt)
        if ects_total is not None:
            break

    # Last offered terms
    for table in soup.find_all("table"):
        headers = [_first_text(th).lower() for th in table.find_all("td", recursive=False)]
        if not headers:
            headers = [_first_text(th).lower() for th in table.find_all(["th", "td"])][:3]
        if headers and any("last offered terms" in h for h in headers):
            rows = table.find_all("tr")
            for row in rows[1:]:
                cols = [c.get_text(" ", strip=True) for c in row.find_all("td")]
                if len(cols) >= 3:
                    last_offered.append(
                        {
                            "term": cols[0],
                            "course_name": cols[1],
                            "su_credit": _to_float(cols[2]) if cols[2] else None,
                        }
                    )
            break

    # Prerequisite/corequisite blocks: scan rows in the outer table.
    collecting: Optional[str] = None  # "pre" | "co"
    if outer_table:
        for tr in outer_table.find_all("tr"):
            td = tr.find("td")
            if not td:
                continue
            text = _first_text(td)
            if not text or text == "\xa0":
                continue
            b = td.find("b")
            if b:
                label = _first_text(b).lower()
                rest = text[len(_first_text(b)) :].strip()
                if "prerequisite" in label:
                    collecting = "pre"
                    if rest:
                        prerequisites.append(rest)
                    continue
                if "corequisite" in label:
                    collecting = "co"
                    if rest:
                        corequisites.append(rest)
                    continue
                collecting = None
            else:
                if collecting == "pre":
                    prerequisites.append(text)
                elif collecting == "co":
                    corequisites.append(text)

    result: Dict[str, Any] = {
        "parsed_subj_code": parsed_subj,
        "parsed_crse_numb": parsed_numb,
        "header_text": header_text or None,
        "title": title,
        "su_credits": su_credits,
        "ects": ects_total,
        "engineering": engineering,
        "basic_science": basic_science,
        "description": description,
        "prerequisites": " ".join(prerequisites).strip() or None,
        "corequisites": " ".join(corequisites).strip() or None,
        "last_offered_terms": last_offered,
        "source_url": source_url,
        "scraped_at": _now_iso(),
    }
    if result["prerequisites"] in {"__", "-", "N/A"}:
        result["prerequisites"] = None
    if result["corequisites"] in {"__", "-", "N/A"}:
        result["corequisites"] = None
    return result


def iter_course_json_paths(courses_dir: str) -> Iterable[str]:
    for root, _, files in os.walk(courses_dir):
        for fname in files:
            if not (fname.endswith(".json") or fname.endswith(".jsonl")):
                continue
            if fname in {"terms.json", "terms.jsonl", "all_coursepage_info.jsonl", "basic_science_credits.jsonl"}:
                continue
            yield os.path.join(root, fname)


def _catalog_path_sort_key(path: str, courses_dir: str) -> Tuple[int, str]:
    """Prefer newer term snapshots, then a stable relative-path ordering."""
    try:
        relative = os.path.relpath(path, courses_dir).replace("\\", "/")
    except ValueError:
        relative = os.path.abspath(path).replace("\\", "/")
    term_codes = [int(part) for part in relative.split("/") if re.fullmatch(r"\d{6}", part)]
    newest_term = max(term_codes) if term_codes else -1
    return (-newest_term, relative.casefold())


def _catalog_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _catalog_number(value: Any) -> Optional[float]:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        normalized = float(value)
    else:
        normalized = _to_float(str(value))
    return normalized if normalized is not None and math.isfinite(normalized) else None


def collect_catalog_courses(
    courses_dir: str,
) -> Tuple[Dict[str, CourseKey], set[str], Dict[str, Dict[str, Any]]]:
    """Collect course identities, breakdown expectations, and fallback metadata.

    Catalog snapshots repeat the same course across programs and admit terms.
    For each intrinsic field, the first non-null value from the newest snapshot
    wins; ties use the normalized relative path.  This makes the result stable
    even when ``os.walk`` returns directories in a different order, while still
    allowing an older snapshot to supply a field omitted by the newest one.
    """
    unique: Dict[str, CourseKey] = {}
    expected_breakdown: set[str] = set()
    fallback_by_course_id: Dict[str, Dict[str, Any]] = {}

    paths = sorted(
        iter_course_json_paths(courses_dir),
        key=lambda path: _catalog_path_sort_key(path, courses_dir),
    )
    for path in paths:
        data = read_course_list(path)
        if not data:
            continue
        for item in data:
            if not isinstance(item, dict):
                continue
            subj = str(item.get("Major") or "").strip()
            numb = str(item.get("Code") or "").strip()
            if not subj or not numb:
                continue
            key = CourseKey(subj_code=subj, crse_numb=numb)
            course_id = key.course_id
            unique.setdefault(course_id, key)

            fallback = fallback_by_course_id.setdefault(course_id, {})
            for output_field, catalog_field in CATALOG_FALLBACK_FIELDS.items():
                if output_field in fallback:
                    continue
                raw_value = item.get(catalog_field)
                value = (
                    _catalog_text(raw_value)
                    if output_field in {"title", "faculty"}
                    else _catalog_number(raw_value)
                )
                if value is not None:
                    fallback[output_field] = value

            bs_val = _catalog_number(item.get("Basic_Science")) or 0.0
            eng_val = _catalog_number(item.get("Engineering")) or 0.0
            if bs_val > 0.0 or eng_val > 0.0:
                expected_breakdown.add(course_id)

    return unique, expected_breakdown, fallback_by_course_id


def read_course_list(path: str) -> List[Dict[str, Any]]:
    if path.endswith(".jsonl"):
        records: List[Dict[str, Any]] = []
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(rec, dict):
                    records.append(rec)
        return records

    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except json.JSONDecodeError:
        # Best-effort fallback: treat as JSONL if a .json file already migrated.
        records: List[Dict[str, Any]] = []
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(rec, dict):
                    records.append(rec)
        return records
    except Exception:
        return []

    return data if isinstance(data, list) else []


def collect_unique_courses(courses_dir: str) -> Tuple[Dict[str, CourseKey], set[str]]:
    # Keep the original two-value helper contract for external/debug callers.
    unique, expected_breakdown, _ = collect_catalog_courses(courses_dir)
    return unique, expected_breakdown


def apply_catalog_fallbacks(
    coursepage_info: Dict[str, Dict[str, Any]],
    unique_courses: Dict[str, CourseKey],
    fallback_by_course_id: Dict[str, Dict[str, Any]],
) -> Tuple[int, int]:
    """Merge intrinsic catalog values into cumulative course-page records.

    A verified non-null scrape is authoritative.  Failed/unverified records use
    catalog values even if their parsed response happened to contain data (an
    invalid response may belong to a different course).  Successful records are
    filled only where a field is null or absent.  Contextual catalog fields are
    never considered by this function.

    Returns ``(records_created, fields_filled)`` for diagnostics/tests.
    """
    records_created = 0
    fields_filled = 0
    for course_id in sorted(unique_courses):
        course = unique_courses[course_id]
        record = coursepage_info.get(course_id)
        if not isinstance(record, dict):
            record = {
                "course_id": course_id,
                "subj_code": course.subj_code,
                "crse_numb": course.crse_numb,
                "scrape_ok": False,
                "scrape_error": "coursepage_data_unavailable",
                "parsed_subj_code": None,
                "parsed_crse_numb": None,
                "header_text": None,
                "description": None,
                "prerequisites": None,
                "corequisites": None,
                "last_offered_terms": [],
                "source_url": build_coursepage_url(course.subj_code, course.crse_numb),
                "scraped_at": None,
            }
            coursepage_info[course_id] = record
            records_created += 1

        successful_scrape = record.get("scrape_ok") is True
        fallback = fallback_by_course_id.get(course_id) or {}
        for field in CATALOG_FALLBACK_FIELDS:
            value = fallback.get(field)
            if not successful_scrape and value is None:
                # A failed response may describe a different course entirely.
                # Do not preserve any parsed intrinsic value unless a catalog
                # snapshot can verify it.
                record[field] = None
                continue
            if value is None:
                continue
            if successful_scrape and record.get(field) is not None:
                continue
            if record.get(field) != value:
                record[field] = value
                fields_filled += 1

    return records_created, fields_filled


def read_jsonl_by_course_id(path: str) -> Dict[str, Dict[str, Any]]:
    if not os.path.exists(path):
        return {}
    out: Dict[str, Dict[str, Any]] = {}
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            course_id = obj.get("course_id")
            if isinstance(course_id, str) and course_id:
                out[course_id] = obj
    return out


def write_jsonl(path: str, records: List[Dict[str, Any]]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        for rec in records:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")


def fetch_coursepage_html(
    session: requests.Session,
    course: CourseKey,
    *,
    cache_dir: Optional[str],
    timeout_s: float,
    retries: int = 3,
    backoff_s: float = 0.5,
    net_semaphore: Optional[threading.Semaphore] = None,
    read_cache: bool = True,
    write_cache: bool = True,
) -> Tuple[str, str]:
    url = build_coursepage_url(course.subj_code, course.crse_numb)
    cache_path = os.path.join(cache_dir, f"{course.course_id}.html") if cache_dir else None

    if read_cache and cache_path and os.path.exists(cache_path):
        with open(cache_path, "r", encoding="utf-8") as f:
            return f.read(), url

    last_err: Optional[BaseException] = None
    attempts = max(0, int(retries)) + 1
    for attempt in range(attempts):
        try:
            if net_semaphore is None:
                resp = session.get(url, timeout=timeout_s)
            else:
                with net_semaphore:
                    resp = session.get(url, timeout=timeout_s)
            resp.raise_for_status()
            html = resp.text
            break
        except Exception as e:
            last_err = e
            if attempt >= attempts - 1:
                raise
            sleep_for = float(backoff_s) * (2**attempt) + random.uniform(0, 0.25)
            time.sleep(sleep_for)
    else:
        raise last_err if last_err else RuntimeError("failed to fetch course page")

    if write_cache and cache_path:
        os.makedirs(os.path.dirname(cache_path), exist_ok=True)
        with open(cache_path, "w", encoding="utf-8") as f:
            f.write(html)

    return html, url


def update_course_json_files(courses_dir: str, credits_by_course_id: Dict[str, Dict[str, float]]) -> None:
    for path in iter_course_json_paths(courses_dir):
        data = read_course_list(path)
        if not data:
            continue

        changed = False
        for item in data:
            if not isinstance(item, dict):
                continue
            course_id = f"{item.get('Major')}{item.get('Code')}"
            credits = credits_by_course_id.get(course_id)
            if not credits:
                continue
            bs_val = credits.get("Basic_Science", 0.0)
            eng_val = credits.get("Engineering", 0.0)
            if item.get("Basic_Science") != bs_val:
                item["Basic_Science"] = bs_val
                changed = True
            if item.get("Engineering") != eng_val:
                item["Engineering"] = eng_val
                changed = True

        if changed:
            if path.endswith(".jsonl"):
                with open(path, "w", encoding="utf-8") as f:
                    for rec in data:
                        f.write(json.dumps(rec, ensure_ascii=False) + "\n")
            else:
                with open(path, "w", encoding="utf-8") as f:
                    json.dump(data, f, indent=2, ensure_ascii=False)

def _is_valid_scrape(parsed: Dict[str, Any], course: CourseKey) -> bool:
    subj = parsed.get("parsed_subj_code")
    numb = parsed.get("parsed_crse_numb")
    return bool(subj and numb and subj == course.subj_code and str(numb) == str(course.crse_numb))


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Scrape Sabanci SUIS course pages to populate Basic Science/Engineering ECTS "
            "credits and generate a cumulative coursepage info file."
        )
    )
    parser.add_argument("--courses-dir", default=DEFAULT_COURSES_DIR)
    parser.add_argument("--out-basic-science", default=DEFAULT_OUT_BASIC_SCIENCE)
    parser.add_argument("--out-all-info", default=DEFAULT_OUT_ALL_INFO)
    parser.add_argument("--cache-dir", default=DEFAULT_CACHE_DIR)
    parser.add_argument("--no-cache", action="store_true")
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="Re-fetch every course even if it exists in the output files (bypasses the HTML cache).",
    )
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--workers", type=int, default=6, help="Number of parallel workers for scraping course pages.")
    parser.add_argument(
        "--max-inflight",
        type=int,
        default=4,
        help="Maximum number of simultaneous network requests (useful to avoid throttling).",
    )
    parser.add_argument("--retries", type=int, default=3, help="Retry count for network errors and invalid responses.")
    parser.add_argument("--backoff", type=float, default=0.5, help="Base backoff seconds for retries (exponential).")
    parser.add_argument("--sleep", type=float, default=0.0, help="Optional sleep seconds per request (applied inside each worker).")
    parser.add_argument("--max-courses", type=int, default=0, help="If set, only scrape up to N missing courses.")
    parser.add_argument("--no-update-course-json", action="store_true", help="Do not rewrite program course JSON files.")
    parser.add_argument("--from-file", default="", help="Parse a local coursepage HTML file (debug) and print JSON to stdout.")

    args = parser.parse_args()

    if args.from_file:
        with open(args.from_file, "r", encoding="utf-8") as f:
            html = f.read()
        info = parse_coursepage_html(html, source_url=f"file://{os.path.abspath(args.from_file)}")
        print(json.dumps(info, indent=2, ensure_ascii=False))
        return 0

    courses_dir = args.courses_dir
    if not os.path.isdir(courses_dir):
        raise SystemExit(f"Missing courses directory: {courses_dir}")

    existing_info = read_jsonl_by_course_id(args.out_all_info)
    existing_credits = read_jsonl_by_course_id(args.out_basic_science)

    unique_courses, expected_breakdown, catalog_fallbacks = collect_catalog_courses(courses_dir)
    needed: List[CourseKey] = []
    for course_id in sorted(unique_courses.keys()):
        if args.refresh or (course_id not in existing_info) or (course_id not in existing_credits):
            needed.append(unique_courses[course_id])
            continue

        if course_id in expected_breakdown:
            rec = existing_credits.get(course_id) or {}
            if rec.get("scrape_ok") is False:
                needed.append(unique_courses[course_id])
                continue
            if not rec.get("breakdown_present"):
                needed.append(unique_courses[course_id])
                continue

    if args.max_courses and args.max_courses > 0:
        needed = needed[: args.max_courses]

    known_valid_attempts = {
        course.course_id
        for course in needed
        if (existing_info.get(course.course_id) or {}).get("scrape_ok") is True
    }

    tls = threading.local()

    def get_session() -> requests.Session:
        sess = getattr(tls, "session", None)
        if sess is None:
            sess = requests.Session()
            sess.headers.update(
                {
                    "User-Agent": "surriculum-scraper/1.0 (+https://github.com/beficent/surriculum)",
                }
            )
            tls.session = sess
        return sess

    cache_dir = None if args.no_cache else args.cache_dir
    net_semaphore = threading.Semaphore(max(1, int(args.max_inflight)))

    accepted_scrapes = 0
    successful_scrapes = 0
    successful_course_ids: set[str] = set()

    def store_scrape_result(
        course_id: str,
        info_record: Dict[str, Any],
        credit_record: Dict[str, Any],
    ) -> bool:
        previous_info = existing_info.get(course_id)
        previous_credits = existing_credits.get(course_id)
        if info_record.get("scrape_ok") is False and (
            (previous_info and previous_info.get("scrape_ok") is not False)
            or (previous_credits and previous_credits.get("scrape_ok") is not False)
        ):
            print(f"[warn] retaining last known-good course-page data for {course_id}")
            return False
        existing_info[course_id] = info_record
        existing_credits[course_id] = credit_record
        return True

    def scrape_one(course: CourseKey) -> Tuple[str, Dict[str, Any], Dict[str, Any]]:
        attempts = max(0, int(args.retries)) + 1
        last_err: Optional[BaseException] = None
        last_parsed: Optional[Dict[str, Any]] = None
        valid_parsed: Optional[Dict[str, Any]] = None
        for attempt in range(attempts):
            try:
                session = get_session()
                html, url = fetch_coursepage_html(
                    session,
                    course,
                    cache_dir=cache_dir,
                    timeout_s=args.timeout,
                    retries=0,
                    net_semaphore=net_semaphore,
                    read_cache=not args.refresh,
                    write_cache=not args.refresh,
                )
                parsed = parse_coursepage_html(html, source_url=url)
                if _is_valid_scrape(parsed, course):
                    if args.refresh and cache_dir:
                        cache_path = os.path.join(cache_dir, f"{course.course_id}.html")
                        os.makedirs(os.path.dirname(cache_path), exist_ok=True)
                        with open(cache_path, "w", encoding="utf-8") as f:
                            f.write(html)
                    valid_parsed = parsed
                    break
                last_parsed = parsed
                last_err = ValueError("invalid coursepage response (code mismatch or missing header)")
                if cache_dir and not args.refresh:
                    cache_path = os.path.join(cache_dir, f"{course.course_id}.html")
                    try:
                        if os.path.exists(cache_path):
                            os.remove(cache_path)
                    except OSError:
                        pass
                if attempt >= attempts - 1:
                    break
                sleep_for = float(args.backoff) * (2**attempt) + random.uniform(0, 0.25)
                time.sleep(sleep_for)
                continue
            except Exception as e:
                last_err = e
                if cache_dir and not args.refresh:
                    cache_path = os.path.join(cache_dir, f"{course.course_id}.html")
                    try:
                        if os.path.exists(cache_path):
                            os.remove(cache_path)
                    except OSError:
                        pass
            if attempt >= attempts - 1:
                break
            sleep_for = float(args.backoff) * (2**attempt) + random.uniform(0, 0.25)
            time.sleep(sleep_for)

        if valid_parsed is not None:
            parsed = valid_parsed
            scrape_ok = True
        elif last_parsed is not None:
            parsed = last_parsed
            scrape_ok = False
        else:
            raise last_err if last_err else RuntimeError("failed to scrape course page")

        course_id = course.course_id
        info_record = {
            "course_id": course_id,
            "subj_code": course.subj_code,
            "crse_numb": course.crse_numb,
            "scrape_ok": scrape_ok,
            "scrape_error": None if scrape_ok else "invalid_coursepage_response",
            **parsed,
        }

        ects_total = parsed.get("ects")
        eng_raw = parsed.get("engineering")
        bs_raw = parsed.get("basic_science")
        breakdown_present = isinstance(eng_raw, (int, float)) or isinstance(bs_raw, (int, float))
        # Many non-FENS/FENS-like courses have no ENGINEERING/BASIC breakdown on
        # the course page; treat that as 0 credits (but keep breakdown_present
        # so we can distinguish it from parse failures on courses that are
        # expected to have a breakdown).
        eng_val = float(eng_raw) if isinstance(eng_raw, (int, float)) else 0.0
        bs_val = float(bs_raw) if isinstance(bs_raw, (int, float)) else 0.0
        credit_record = {
            "course_id": course_id,
            "subj_code": course.subj_code,
            "crse_numb": course.crse_numb,
            "scrape_ok": scrape_ok,
            "scrape_error": None if scrape_ok else "invalid_coursepage_response",
            "ects": ects_total,
            "engineering": eng_val,
            "basic_science": bs_val,
            "breakdown_present": breakdown_present,
            "source_url": parsed.get("source_url"),
            "scraped_at": parsed.get("scraped_at"),
        }
        if args.sleep and args.sleep > 0:
            time.sleep(args.sleep)
        return course_id, info_record, credit_record

    if needed:
        workers = max(1, int(args.workers))
        if workers == 1:
            for course in needed:
                try:
                    course_id, info_record, credit_record = scrape_one(course)
                except Exception as e:
                    print(f"[warn] failed to scrape {course.course_id}: {e}")
                    continue
                if store_scrape_result(course_id, info_record, credit_record):
                    accepted_scrapes += 1
                if info_record.get("scrape_ok") is True:
                    successful_scrapes += 1
                    successful_course_ids.add(course_id)
        else:
            with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
                futures = {executor.submit(scrape_one, course): course for course in needed}
                completed = 0
                for future in concurrent.futures.as_completed(futures):
                    course = futures[future]
                    try:
                        course_id, info_record, credit_record = future.result()
                    except Exception as e:
                        print(f"[warn] failed to scrape {course.course_id}: {e}")
                        continue
                    if store_scrape_result(course_id, info_record, credit_record):
                        accepted_scrapes += 1
                    if info_record.get("scrape_ok") is True:
                        successful_scrapes += 1
                        successful_course_ids.add(course_id)
                    completed += 1
                    if completed % 200 == 0:
                        print(f"... scraped {completed}/{len(needed)}")

    if args.refresh and known_valid_attempts:
        known_valid_successes = len(successful_course_ids.intersection(known_valid_attempts))
        success_rate = known_valid_successes / len(known_valid_attempts)
        if success_rate < 0.8:
            print(
                f"[error] full course-page refresh recovered only "
                f"{known_valid_successes}/{len(known_valid_attempts)} previously valid pages "
                f"({success_rate:.1%}); preserving the existing output files"
            )
            return 1

    # Every catalog course must have useful intrinsic metadata even when its
    # course page could not be fetched or omitted an individual field.
    apply_catalog_fallbacks(existing_info, unique_courses, catalog_fallbacks)

    # Write cumulative outputs (deterministic ordering).
    write_jsonl(args.out_all_info, [existing_info[k] for k in sorted(existing_info.keys())])
    write_jsonl(args.out_basic_science, [existing_credits[k] for k in sorted(existing_credits.keys())])

    schedule_dir = Path(courses_dir) / "schedule"
    schedule_terms = available_current_future_terms(schedule_dir)
    if schedule_terms:
        stats = reconcile_coursepage_offerings(
            coursepage_info_path=Path(args.out_all_info),
            schedule_dir=schedule_dir,
            terms=schedule_terms,
            remove_absent=False,
        )
        print(
            "Restored schedule-proven course-page offerings: "
            f"terms={','.join(stats.terms)} changed_records={stats.changed_records}"
        )

    credits_by_course_id: Dict[str, Dict[str, float]] = {}
    for course_id, rec in existing_credits.items():
        if rec.get("scrape_ok") is False:
            continue
        # If a course historically had non-zero engineering/basic science in
        # our catalogs, we treat it as "expected_breakdown". In that case, we
        # never overwrite with zeros unless we successfully parsed a breakdown.
        if course_id in expected_breakdown and not rec.get("breakdown_present"):
            continue
        bs = rec.get("basic_science")
        eng = rec.get("engineering")
        bs_val = float(bs) if isinstance(bs, (int, float)) else 0.0
        eng_val = float(eng) if isinstance(eng, (int, float)) else 0.0
        credits_by_course_id[course_id] = {
            "Basic_Science": bs_val,
            "Engineering": eng_val,
        }

    if not args.no_update_course_json:
        update_course_json_files(courses_dir, credits_by_course_id)

    print(
        f"Accepted {accepted_scrapes} course-page updates "
        f"({successful_scrapes} valid responses). "
        f"Wrote {len(existing_info)} records to {args.out_all_info} and "
        f"{len(existing_credits)} records to {args.out_basic_science}."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
