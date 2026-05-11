import argparse
import json
import re
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

import requests
from bs4 import BeautifulSoup


BASE = "https://suis.sabanciuniv.edu/prod"
DETAIL_URL = f"{BASE}/bwckschd.p_disp_detail_sched"
SECONDARY_COMPONENTS = {"recitation", "lab", "laboratory"}
PLACEHOLDER_INSTRUCTORS = {
    "",
    "tba",
    "staff",
    "to be announced",
    "to be arranged",
    "arranged",
}
ROLE_TOKEN_RE = re.compile(r"\(\s*[A-Za-z]{1,3}\s*\)")
WHITESPACE_RE = re.compile(r"\s+")
TERM_CODE_RE = re.compile(r"^\d{6}$")
INSTRUCTOR_SPLIT_RE = re.compile(r"\s*,\s*")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build course section instructor/seat history from local schedule JSONL files."
    )
    parser.add_argument("--schedule-dir", default="courses/schedule")
    parser.add_argument("--out", default="courses/course_section_history.jsonl")
    parser.add_argument("--term", default="", help="Single term code to update.")
    parser.add_argument("--terms", default="", help="Comma-separated term codes to update.")
    parser.add_argument("--all-terms", action="store_true", help="Update every local schedule term.")
    parser.add_argument("--refresh", action="store_true", help="Refetch requested rows even when already present.")
    parser.add_argument(
        "--crns",
        default="",
        help="Comma-separated TERM:CRN pairs to update, e.g. 202502:20603,202502:20605.",
    )
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--max-inflight", type=int, default=4)
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--retries", type=int, default=3)
    parser.add_argument("--backoff", type=float, default=1.0)
    parser.add_argument("--max-crns", type=int, default=0, help="Limit fetched CRNs for testing.")
    return parser.parse_args()


def parse_float(value: Any) -> float:
    try:
        return float(str(value or "").strip())
    except Exception:
        return 0.0


def parse_int_or_none(value: Any) -> Optional[int]:
    raw = WHITESPACE_RE.sub("", str(value or "").strip())
    if not raw or not re.fullmatch(r"-?\d+", raw):
        return None
    try:
        return int(raw)
    except Exception:
        return None


def normalize_course_id(value: Any) -> str:
    return str(value or "").upper().replace(" ", "")


def normalize_component(value: Any) -> str:
    return WHITESPACE_RE.sub(" ", str(value or "").strip())


def component_key(value: Any) -> str:
    return normalize_component(value).lower()


def normalize_instructor(value: Any) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    raw = ROLE_TOKEN_RE.sub("", raw)
    raw = WHITESPACE_RE.sub(" ", raw).strip(" -–—,;/")
    if raw.lower() in PLACEHOLDER_INSTRUCTORS:
        return ""
    return raw


def normalize_instructors(value: Any) -> List[str]:
    cleaned = normalize_instructor(value)
    if not cleaned:
        return []
    parts = [part.strip() for part in INSTRUCTOR_SPLIT_RE.split(cleaned) if part.strip()]
    if len(parts) <= 1:
        return [cleaned]
    out: List[str] = []
    for part in parts:
        normalized = normalize_instructor(part)
        if normalized:
            out.append(normalized)
    return out or [cleaned]


def detail_url(term: str, crn: str) -> str:
    return f"{DETAIL_URL}?term_in={term}&crn_in={crn}"


def iter_schedule_rows(schedule_dir: Path) -> Iterable[Tuple[Path, Dict[str, Any]]]:
    for path in sorted(schedule_dir.glob("*.jsonl")):
        with path.open("r", encoding="utf-8") as handle:
            for line_no, line in enumerate(handle, start=1):
                raw = line.strip()
                if not raw:
                    continue
                try:
                    row = json.loads(raw)
                except Exception as exc:
                    raise RuntimeError(f"Invalid JSON in {path}:{line_no}: {exc}") from exc
                yield path, row


def collect_schedule_rows(schedule_dir: Path, terms: Set[str]) -> Dict[Tuple[str, str], List[Dict[str, Any]]]:
    grouped: Dict[Tuple[str, str], List[Dict[str, Any]]] = defaultdict(list)
    for _path, row in iter_schedule_rows(schedule_dir):
        term = str(row.get("term") or "").strip()
        course_id = normalize_course_id(row.get("course_id"))
        if not course_id or not TERM_CODE_RE.fullmatch(term):
            continue
        if terms and term not in terms:
            continue
        grouped[(course_id, term)].append(row)
    return grouped


def list_schedule_terms(schedule_dir: Path) -> List[str]:
    terms = []
    for path in sorted(schedule_dir.glob("*.jsonl")):
        if TERM_CODE_RE.fullmatch(path.stem):
            terms.append(path.stem)
    return sorted(set(terms))


def select_primary_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    candidates = [
        row
        for row in rows
        if parse_float(row.get("credits")) > 0
        and component_key(row.get("component")) not in SECONDARY_COMPONENTS
    ]
    if not candidates:
        return []
    if any(component_key(row.get("component")) == "lecture" for row in candidates):
        return [row for row in candidates if component_key(row.get("component")) == "lecture"]
    return candidates


def extract_instructors(row: Dict[str, Any]) -> List[str]:
    instructors: Set[str] = set()
    meetings = row.get("meetings")
    if isinstance(meetings, list):
        for meeting in meetings:
            if not isinstance(meeting, dict):
                continue
            for instructor in normalize_instructors(meeting.get("instructors")):
                instructors.add(instructor)
    return sorted(instructors)


def build_requested_sections(schedule_dir: Path, terms: Set[str]) -> List[Dict[str, Any]]:
    grouped = collect_schedule_rows(schedule_dir, terms)
    sections: List[Dict[str, Any]] = []
    seen: Set[Tuple[str, str, str]] = set()
    for (course_id, term), rows in sorted(grouped.items()):
        for row in select_primary_rows(rows):
            crn = str(row.get("crn") or "").strip()
            if not crn:
                continue
            key = (course_id, term, crn)
            if key in seen:
                continue
            seen.add(key)
            sections.append(
                {
                    "course_id": course_id,
                    "term": term,
                    "crn": crn,
                    "section": str(row.get("section") or "").strip(),
                    "component": normalize_component(row.get("component")),
                    "instructors": extract_instructors(row),
                }
            )
    return sorted(sections, key=lambda item: (item["term"], item["course_id"], item["section"], item["crn"]))


def parse_crn_filter(value: str) -> Set[Tuple[str, str]]:
    out: Set[Tuple[str, str]] = set()
    for part in str(value or "").split(","):
        raw = part.strip()
        if not raw:
            continue
        if ":" not in raw:
            continue
        term, crn = [piece.strip() for piece in raw.split(":", 1)]
        if TERM_CODE_RE.fullmatch(term) and crn:
            out.add((term, crn))
    return out


def load_existing(path: Path) -> Dict[Tuple[str, str, str], Dict[str, Any]]:
    rows: Dict[Tuple[str, str, str], Dict[str, Any]] = {}
    if not path.exists():
        return rows
    with path.open("r", encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, start=1):
            raw = line.strip()
            if not raw:
                continue
            try:
                obj = json.loads(raw)
            except Exception as exc:
                raise RuntimeError(f"Invalid JSON in {path}:{line_no}: {exc}") from exc
            course_id = normalize_course_id(obj.get("course_id"))
            history = obj.get("history")
            if not course_id or not isinstance(history, list):
                continue
            for entry in history:
                if not isinstance(entry, dict):
                    continue
                term = str(entry.get("term") or "").strip()
                crn = str(entry.get("crn") or "").strip()
                if not TERM_CODE_RE.fullmatch(term) or not crn:
                    continue
                normalized = dict(entry)
                normalized["course_id"] = course_id
                normalized["term"] = term
                normalized["crn"] = crn
                rows[(course_id, term, crn)] = normalized
    return rows


def parse_seat_counts(html: str) -> Tuple[Optional[int], Optional[int], Optional[int]]:
    soup = BeautifulSoup(html, "lxml")
    for table in soup.select("table.datadisplaytable"):
        caption = table.find("caption")
        if not caption or "registration availability" not in caption.get_text(" ", strip=True).lower():
            continue
        headers = [th.get_text(" ", strip=True).lower() for th in table.find_all("th", class_="ddheader")]
        header_index = {name: idx for idx, name in enumerate(headers)}
        for tr in table.find_all("tr"):
            row_header = tr.find("th", class_="ddlabel")
            if not row_header:
                continue
            label = row_header.get_text(" ", strip=True).lower()
            if label != "seats":
                continue
            cells = tr.find_all("td", class_="dddefault")
            def get_cell(name: str) -> Optional[int]:
                idx = header_index.get(name)
                if idx is None or idx >= len(cells):
                    return None
                return parse_int_or_none(cells[idx].get_text(" ", strip=True))
            return get_cell("capacity"), get_cell("actual"), get_cell("remaining")
    return None, None, None


def fetch_with_retry(
    session: requests.Session,
    url: str,
    *,
    timeout: float,
    retries: int,
    backoff: float,
) -> str:
    last_error: Optional[Exception] = None
    for attempt in range(retries + 1):
        try:
            response = session.get(url, timeout=timeout)
            response.raise_for_status()
            return response.text
        except Exception as exc:
            last_error = exc
            if attempt < retries:
                time.sleep(min(8.0, backoff * (2**attempt)))
    raise RuntimeError(f"Failed to fetch {url}: {last_error}")


def fetch_section(
    base: Dict[str, Any],
    *,
    timeout: float,
    retries: int,
    backoff: float,
    semaphore: threading.Semaphore,
    local_state: threading.local,
) -> Optional[Dict[str, Any]]:
    session = getattr(local_state, "session", None)
    if session is None:
        session = requests.Session()
        session.headers.update(
            {"User-Agent": "Mozilla/5.0 (compatible; SUrriculum/3.0; +https://github.com/)"}
        )
        local_state.session = session

    url = detail_url(base["term"], base["crn"])
    with semaphore:
        html = fetch_with_retry(session, url, timeout=timeout, retries=retries, backoff=backoff)
    capacity, actual, remaining = parse_seat_counts(html)
    return {
        **base,
        "capacity": capacity,
        "actual": actual,
        "remaining": remaining,
    }


def merge_rows(existing: Dict[Tuple[str, str, str], Dict[str, Any]], updates: Iterable[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    merged: Dict[Tuple[str, str, str], Dict[str, Any]] = dict(existing)
    for update in updates:
        course_id = normalize_course_id(update.get("course_id"))
        term = str(update.get("term") or "").strip()
        crn = str(update.get("crn") or "").strip()
        if not course_id or not TERM_CODE_RE.fullmatch(term) or not crn:
            continue
        row = dict(update)
        row.pop("course_id", None)
        merged[(course_id, term, crn)] = row

    by_course: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for (course_id, _term, _crn), row in merged.items():
        out = dict(row)
        out.pop("course_id", None)
        by_course[course_id].append(out)

    for rows in by_course.values():
        rows.sort(
            key=lambda item: (
                -int(str(item.get("term") or "0")),
                str(item.get("section") or ""),
                str(item.get("crn") or ""),
            )
        )
    return dict(sorted(by_course.items()))


def write_jsonl(path: Path, by_course: Dict[str, List[Dict[str, Any]]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for course_id in sorted(by_course):
            handle.write(json.dumps({"course_id": course_id, "history": by_course[course_id]}, ensure_ascii=False) + "\n")


def resolve_terms(args: argparse.Namespace, schedule_dir: Path) -> Set[str]:
    selected: Set[str] = set()
    if args.term:
        selected.add(str(args.term).strip())
    if args.terms:
        selected.update(part.strip() for part in str(args.terms).split(",") if part.strip())
    if args.all_terms:
        selected.update(list_schedule_terms(schedule_dir))
    selected = {term for term in selected if TERM_CODE_RE.fullmatch(term)}
    if not selected:
        raise RuntimeError("Provide --term, --terms, or --all-terms.")
    return selected


def main() -> None:
    args = parse_args()
    schedule_dir = Path(args.schedule_dir)
    out_path = Path(args.out)
    terms = resolve_terms(args, schedule_dir)
    requested = build_requested_sections(schedule_dir, terms)
    crn_filter = parse_crn_filter(args.crns)
    existing = load_existing(out_path)
    requested_keys = {
        (section["course_id"], section["term"], section["crn"])
        for section in requested
    }
    existing_for_merge = existing
    if args.refresh and not crn_filter:
        existing_for_merge = {
            key: row
            for key, row in existing.items()
            if key[1] not in terms or key in requested_keys
        }

    to_fetch: List[Dict[str, Any]] = []
    updates: List[Dict[str, Any]] = []
    for section in requested:
        key = (section["course_id"], section["term"], section["crn"])
        pair = (section["term"], section["crn"])
        explicitly_requested = not crn_filter or pair in crn_filter
        if args.refresh:
            if not explicitly_requested:
                continue
        elif key in existing and not explicitly_requested:
            continue
        to_fetch.append(section)

    if args.max_crns and args.max_crns > 0:
        to_fetch = to_fetch[: args.max_crns]

    if to_fetch:
        semaphore = threading.Semaphore(max(1, int(args.max_inflight or 1)))
        local_state = threading.local()
        workers = max(1, int(args.workers or 1))
        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {
                executor.submit(
                    fetch_section,
                    section,
                    timeout=args.timeout,
                    retries=args.retries,
                    backoff=args.backoff,
                    semaphore=semaphore,
                    local_state=local_state,
                ): section
                for section in to_fetch
            }
            for idx, future in enumerate(as_completed(futures), start=1):
                section = futures[future]
                try:
                    row = future.result()
                    if row:
                        updates.append(row)
                except Exception as exc:
                    print(f"Warning: failed {section['term']} CRN {section['crn']}: {exc}")
                if idx == 1 or idx % 50 == 0 or idx == len(futures):
                    print(f"Fetched {idx}/{len(futures)} section detail pages...")

    by_course = merge_rows(existing_for_merge, updates)
    write_jsonl(out_path, by_course)
    print(f"Wrote {len(by_course)} course section histories to {out_path}")
    print(f"Fetched {len(updates)} new/updated section rows; reused {len(existing)} existing rows.")


if __name__ == "__main__":
    main()
