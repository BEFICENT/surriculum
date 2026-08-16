#!/usr/bin/env python3
"""Validate structured General Requirements metadata in the runtime catalog.

The SUIS course page keeps cumulative-credit and, for a few courses, ordinary
course prerequisites in a separate ``General Requirements`` block.  This gate
keeps that block from silently disappearing during an automated data refresh
and requires newly discovered rules to receive an explicit review.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
COURSEPAGE_INFO = ROOT / "courses" / "all_coursepage_info.jsonl"
STRUCTURED_FIELDS = (
    "general_requirements",
    "minimum_earned_su_credits",
    "general_requirement_prerequisites",
)
EXPECTED_CREDIT_REQUIREMENTS = {
    "HUM201": 23.0,
    "HUM202": 23.0,
    "HUM207": 23.0,
    "SPS303": 58.0,
}
HUM_PREREQUISITES = (
    "SPS 101 - Undergraduate - Min Grade D and "
    "SPS 102 - Undergraduate - Min Grade D"
)
EXPECTED_COURSE_REQUIREMENTS = {
    "HUM201": HUM_PREREQUISITES,
    "HUM202": HUM_PREREQUISITES,
    "HUM207": HUM_PREREQUISITES,
}
COURSE_CODE_RE = re.compile(r"([A-Z]{2,5})\s*([0-9]{3,5}[A-Z]?)", re.IGNORECASE)
CREDIT_RE = re.compile(r"\b(\d+(?:[.,]\d+)?)\s+credits?\b", re.IGNORECASE)


def read_rows() -> list[dict]:
    rows = []
    with COURSEPAGE_INFO.open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            value = json.loads(line)
            assert isinstance(value, dict), f"row {line_number} is not an object"
            rows.append(value)
    assert rows, "course-page metadata is empty"
    return rows


def main() -> None:
    rows = read_rows()
    by_code = {}
    credit_requirements = {}
    course_requirements = {}

    for row in rows:
        code = str(row.get("course_id") or "").strip().upper()
        assert code and code not in by_code, f"missing or duplicate course_id: {code!r}"
        by_code[code] = row

        for field in STRUCTURED_FIELDS:
            assert field in row, f"{code}: missing {field}; refresh all course-page records"

        raw = row["general_requirements"]
        assert raw is None or (isinstance(raw, str) and raw), (
            f"{code}.general_requirements must be a non-empty string or null"
        )
        if isinstance(raw, str):
            assert raw == " ".join(raw.split()), (
                f"{code}.general_requirements is not whitespace-normalized"
            )

        minimum = row["minimum_earned_su_credits"]
        assert minimum is None or (
            not isinstance(minimum, bool)
            and isinstance(minimum, (int, float))
            and math.isfinite(minimum)
            and minimum >= 0
        ), f"{code}.minimum_earned_su_credits is invalid: {minimum!r}"
        if minimum is not None:
            assert isinstance(raw, str), f"{code}: structured credits lack source text"
            match = CREDIT_RE.search(raw)
            assert match, f"{code}: source text does not contain the structured credit rule"
            parsed = float(match.group(1).replace(",", "."))
            assert math.isclose(float(minimum), parsed), (
                f"{code}: structured minimum {minimum} disagrees with source text {parsed}"
            )
            credit_requirements[code] = float(minimum)

        expression = row["general_requirement_prerequisites"]
        assert expression is None or (isinstance(expression, str) and expression), (
            f"{code}.general_requirement_prerequisites must be a non-empty string or null"
        )
        if isinstance(expression, str):
            assert expression == " ".join(expression.split()), (
                f"{code}.general_requirement_prerequisites is not whitespace-normalized"
            )
            assert isinstance(raw, str), f"{code}: structured prerequisites lack source text"
            referenced = {
                (match.group(1) + match.group(2)).upper()
                for match in COURSE_CODE_RE.finditer(expression)
            }
            assert referenced, f"{code}: structured prerequisite expression has no course"
            assert code not in referenced, (
                f"{code}: self-referential General Requirements rule must remain raw-only"
            )
            course_requirements[code] = expression

    assert credit_requirements == EXPECTED_CREDIT_REQUIREMENTS, (
        "General Requirements credit rules changed; review the new SUIS data and "
        f"update the pinned set deliberately: {credit_requirements!r}"
    )
    assert course_requirements == EXPECTED_COURSE_REQUIREMENTS, (
        "General Requirements course clauses changed; review parser/evaluator semantics "
        f"before updating the pinned set: {course_requirements!r}"
    )

    # HUM rules contain independent course and prior-credit conditions. SPS 303
    # carries only the 58-SU condition. TLL 001's Banner block refers to itself;
    # keep that unusual source text visible without creating an impossible
    # evaluator expression.
    for code in EXPECTED_COURSE_REQUIREMENTS:
        assert by_code[code]["minimum_earned_su_credits"] == 23
        assert by_code[code]["general_requirements"]
    assert by_code["SPS303"]["general_requirement_prerequisites"] is None
    assert "58.000 credits" in by_code["SPS303"]["general_requirements"]
    assert by_code["TLL001"]["general_requirements"]
    assert by_code["TLL001"]["minimum_earned_su_credits"] is None
    assert by_code["TLL001"]["general_requirement_prerequisites"] is None

    print(
        "OK: %d course-page rows expose reviewed General Requirements metadata "
        "(%d credit thresholds, %d course expressions)."
        % (len(rows), len(credit_requirements), len(course_requirements))
    )


if __name__ == "__main__":
    main()
