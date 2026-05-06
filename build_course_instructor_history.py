import argparse
import json
import re
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple


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
        description="Build course-level instructor history from local schedule JSONL files."
    )
    parser.add_argument(
        "--schedule-dir",
        default="courses/schedule",
        help="Directory containing per-term schedule JSONL files.",
    )
    parser.add_argument(
        "--out",
        default="courses/course_instructor_history.jsonl",
        help="Output JSONL path.",
    )
    return parser.parse_args()


def parse_float(value: Any) -> float:
    try:
        return float(str(value or "").strip())
    except Exception:
        return 0.0


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
    lowered = raw.lower()
    if lowered in PLACEHOLDER_INSTRUCTORS:
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


def collect_grouped_rows(schedule_dir: Path) -> Dict[Tuple[str, str], List[Dict[str, Any]]]:
    grouped: Dict[Tuple[str, str], List[Dict[str, Any]]] = defaultdict(list)
    for path, row in iter_schedule_rows(schedule_dir):
        term = str(row.get("term") or "").strip()
        course_id = normalize_course_id(row.get("course_id"))
        if not course_id or not TERM_CODE_RE.fullmatch(term):
            continue
        grouped[(course_id, term)].append(row)
    return grouped


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


def extract_instructors(rows: List[Dict[str, Any]]) -> Set[str]:
    instructors: Set[str] = set()
    for row in rows:
        meetings = row.get("meetings")
        if not isinstance(meetings, list):
            continue
        for meeting in meetings:
            if not isinstance(meeting, dict):
                continue
            for instructor in normalize_instructors(meeting.get("instructors")):
                instructors.add(instructor)
    return instructors


def build_history_rows(schedule_dir: Path) -> List[Dict[str, Any]]:
    grouped_rows = collect_grouped_rows(schedule_dir)
    by_course: Dict[str, List[Dict[str, Any]]] = defaultdict(list)

    for (course_id, term), rows in grouped_rows.items():
        primary_rows = select_primary_rows(rows)
        if not primary_rows:
            continue

        instructors = sorted(extract_instructors(primary_rows))
        if not instructors:
            continue

        components = sorted(
            {normalize_component(row.get("component")) for row in primary_rows if normalize_component(row.get("component"))}
        )
        by_course[course_id].append(
            {
                "term": term,
                "instructors": instructors,
                "components": components,
            }
        )

    output_rows: List[Dict[str, Any]] = []
    for course_id in sorted(by_course):
        history = sorted(
            by_course[course_id],
            key=lambda item: int(str(item.get("term") or "0")),
            reverse=True,
        )
        output_rows.append({"course_id": course_id, "history": history})
    return output_rows


def write_jsonl(path: Path, rows: Iterable[Dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def main() -> None:
    args = parse_args()
    schedule_dir = Path(args.schedule_dir)
    out_path = Path(args.out)
    rows = build_history_rows(schedule_dir)
    write_jsonl(out_path, rows)
    print(f"Wrote {len(rows)} course histories to {out_path}")


if __name__ == "__main__":
    main()
