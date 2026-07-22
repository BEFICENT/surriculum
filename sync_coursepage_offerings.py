#!/usr/bin/env python3
"""Reconcile schedule-proven offerings into cumulative course-page metadata.

The course-page scraper stores one cumulative record per course. Its
``last_offered_terms`` list is useful historical metadata, but it can lag behind
the term schedule because existing course pages are intentionally not fetched
every day. This module makes the schedule authoritative for the terms that were
just refreshed while preserving older course-page history.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

from term_utils import term_code_from_date, term_code_from_name, term_name_from_code, today_in_tz


TERM_CODE_RE = re.compile(r"\d{6}")
SECONDARY_COMPONENTS = {"lab", "laboratory", "recitation"}


@dataclass(frozen=True)
class SyncStats:
    terms: Tuple[str, ...]
    scheduled_courses: int
    matched_courses: int
    missing_coursepage_records: int
    changed_records: int


def _read_jsonl(path: Path) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, start=1):
            raw = line.strip()
            if not raw:
                continue
            try:
                row = json.loads(raw)
            except json.JSONDecodeError as exc:
                raise RuntimeError(f"Invalid JSON in {path}:{line_no}: {exc}") from exc
            if not isinstance(row, dict):
                raise RuntimeError(f"Expected an object in {path}:{line_no}")
            rows.append(row)
    return rows


def _write_jsonl_atomic(path: Path, rows: Iterable[Dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            for row in rows:
                handle.write(json.dumps(row, ensure_ascii=False) + "\n")
        os.replace(temp_name, path)
    except Exception:
        try:
            os.unlink(temp_name)
        except OSError:
            pass
        raise


def _normalize_course_id(value: Any) -> str:
    return re.sub(r"\s+", "", str(value or "")).upper()


def _parse_credit(value: Any) -> Optional[float]:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _schedule_candidate_score(row: Dict[str, Any]) -> Tuple[int, int]:
    component = str(row.get("component") or "").strip().lower()
    credit = _parse_credit(row.get("credits"))
    return (
        1 if component not in SECONDARY_COMPONENTS else 0,
        1 if credit is not None and credit > 0 else 0,
    )


def _load_schedule_offerings(
    schedule_dir: Path,
    terms: Iterable[str],
) -> Dict[Tuple[str, str], Dict[str, Any]]:
    offerings: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for term in terms:
        path = schedule_dir / f"{term}.jsonl"
        if not path.exists():
            raise RuntimeError(f"Missing schedule file for reconciled term: {path}")
        for row in _read_jsonl(path):
            course_id = _normalize_course_id(row.get("course_id"))
            if not course_id:
                continue
            key = (course_id, term)
            current = offerings.get(key)
            if current is None or _schedule_candidate_score(row) > _schedule_candidate_score(current):
                offerings[key] = row
    return offerings


def _term_sort_key(entry: Dict[str, Any]) -> Tuple[int, str]:
    term_name = str(entry.get("term") or "")
    code = term_code_from_name(term_name)
    return (int(code) if code else -1, term_name)


def _schedule_term_entry(
    term: str,
    schedule_row: Dict[str, Any],
    coursepage_record: Dict[str, Any],
) -> Dict[str, Any]:
    title = str(schedule_row.get("title") or coursepage_record.get("title") or "").strip()
    credit = _parse_credit(schedule_row.get("credits"))
    if credit is None:
        credit = _parse_credit(coursepage_record.get("su_credits"))
    return {
        "term": term_name_from_code(term),
        "course_name": title,
        "su_credit": credit,
    }


def reconcile_coursepage_offerings(
    *,
    coursepage_info_path: Path,
    schedule_dir: Path,
    terms: Iterable[str],
    remove_absent: bool = True,
) -> SyncStats:
    selected_terms = tuple(
        sorted(
            {
                str(term or "").strip()
                for term in terms
                if TERM_CODE_RE.fullmatch(str(term or "").strip())
            }
        )
    )
    if not selected_terms:
        return SyncStats((), 0, 0, 0, 0)
    if not coursepage_info_path.exists():
        raise RuntimeError(f"Missing course-page information file: {coursepage_info_path}")

    records = _read_jsonl(coursepage_info_path)
    by_course: Dict[str, Dict[str, Any]] = {}
    for record in records:
        course_id = _normalize_course_id(record.get("course_id"))
        if course_id:
            by_course[course_id] = record

    offerings = _load_schedule_offerings(schedule_dir, selected_terms)
    scheduled_course_ids: Set[str] = {course_id for course_id, _term in offerings}
    matched_course_ids = scheduled_course_ids.intersection(by_course)
    changed_records = 0

    for course_id, record in by_course.items():
        original_terms = record.get("last_offered_terms")
        existing_terms = original_terms if isinstance(original_terms, list) else []
        existing_by_code: Dict[str, Dict[str, Any]] = {}
        preserved: List[Dict[str, Any]] = []
        for entry in existing_terms:
            if not isinstance(entry, dict):
                continue
            code = term_code_from_name(str(entry.get("term") or ""))
            if code in selected_terms:
                existing_by_code.setdefault(code, entry)
                if not remove_absent:
                    preserved.append(entry)
            else:
                preserved.append(entry)

        reconciled = list(preserved)
        for term in selected_terms:
            schedule_row = offerings.get((course_id, term))
            if schedule_row is None:
                continue
            if remove_absent:
                reconciled.append(
                    existing_by_code.get(term)
                    or _schedule_term_entry(term, schedule_row, record)
                )
            elif term not in existing_by_code:
                reconciled.append(_schedule_term_entry(term, schedule_row, record))
        reconciled.sort(key=_term_sort_key, reverse=True)

        if reconciled != existing_terms:
            record["last_offered_terms"] = reconciled
            changed_records += 1

    if changed_records:
        ordered = sorted(records, key=lambda row: _normalize_course_id(row.get("course_id")))
        _write_jsonl_atomic(coursepage_info_path, ordered)

    return SyncStats(
        terms=selected_terms,
        scheduled_courses=len(scheduled_course_ids),
        matched_courses=len(matched_course_ids),
        missing_coursepage_records=len(scheduled_course_ids - matched_course_ids),
        changed_records=changed_records,
    )


def available_current_future_terms(schedule_dir: Path) -> List[str]:
    current = term_code_from_date(today_in_tz())
    return sorted(
        path.stem
        for path in schedule_dir.glob("*.jsonl")
        if TERM_CODE_RE.fullmatch(path.stem) and path.stem >= current
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Reconcile schedule-proven offered terms into all_coursepage_info.jsonl."
    )
    parser.add_argument("--coursepage-info", default="courses/all_coursepage_info.jsonl")
    parser.add_argument("--schedule-dir", default="courses/schedule")
    parser.add_argument(
        "--terms",
        default="",
        help="Comma-separated term codes. Defaults to locally available current/future terms.",
    )
    parser.add_argument(
        "--add-only",
        action="store_true",
        help="Add schedule-proven terms without removing existing course-page claims.",
    )
    args = parser.parse_args()

    schedule_dir = Path(args.schedule_dir)
    terms = (
        [part.strip() for part in str(args.terms).split(",") if part.strip()]
        if args.terms
        else available_current_future_terms(schedule_dir)
    )
    stats = reconcile_coursepage_offerings(
        coursepage_info_path=Path(args.coursepage_info),
        schedule_dir=schedule_dir,
        terms=terms,
        remove_absent=not args.add_only,
    )
    print(
        "Reconciled course-page offerings: "
        f"terms={','.join(stats.terms) or 'none'} "
        f"scheduled_courses={stats.scheduled_courses} "
        f"matched={stats.matched_courses} "
        f"missing_coursepages={stats.missing_coursepage_records} "
        f"changed_records={stats.changed_records}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
