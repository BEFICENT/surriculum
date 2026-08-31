#!/usr/bin/env python3
"""Offline regression checks for requirement-record credit validation."""

import copy
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from tools.data_pipeline import fetch_requirements as fr  # noqa: E402


def records_for(term):
    path = os.path.join(ROOT, "requirements", f"{term}.jsonl")
    with open(path, "r", encoding="utf-8") as handle:
        rows = [json.loads(line) for line in handle if line.strip()]
    return {row["major"]: row for row in rows}


def main():
    records = records_for("202401")
    for major in ("EE", "ME"):
        record = records[major]
        fr.validate_requirement_record(major, record)

        contradictory = copy.deepcopy(record)
        contradictory["free"] += 3
        try:
            fr.validate_requirement_record(major, contradictory)
        except ValueError as exc:
            assert "exceed total" in str(exc), str(exc)
        else:
            raise AssertionError(f"{major}: category minimums above Total were accepted")

    one_hum = {"BIO", "CS", "DSA", "EE", "IE", "MAT", "ME"}
    two_hum = {"ECON", "MAN", "PSIR", "PSY", "VACD"}
    expected_counts = {
        **{major: 1 for major in one_hum},
        **{major: 2 for major in two_hum},
    }
    term_files = sorted(
        name for name in os.listdir(os.path.join(ROOT, "requirements"))
        if name.endswith(".jsonl") and name[:6].isdigit()
    )
    assert term_files, "no major requirement term files found"
    for filename in term_files:
        term = filename[:6]
        by_major = records_for(term)
        expected_rules = {
            **{major: "any" for major in one_hum},
            **{
                major: "any" if term < "202001" else "one200One300"
                for major in two_hum
            },
        }
        actual_counts = {
            major: record["humRequired"] for major, record in by_major.items()
        }
        actual_rules = {major: record["humRule"] for major, record in by_major.items()}
        assert actual_counts == expected_counts, (
            f"{term}: unexpected HUM counts {actual_counts!r}"
        )
        assert actual_rules == expected_rules, (
            f"{term}: unexpected HUM rules {actual_rules!r}"
        )
        for major, record in by_major.items():
            fr.validate_requirement_record(major, record)

    rejected = copy.deepcopy(records["EE"])
    rejected["humRequired"] = 0
    try:
        fr.validate_requirement_record("EE", rejected)
    except ValueError as exc:
        assert "humRequired/humRule" in str(exc), str(exc)
    else:
        raise AssertionError("zero-HUM major requirement was accepted")

    rejected = copy.deepcopy(records["EE"])
    rejected["humRule"] = "one200One300"
    try:
        fr.validate_requirement_record("EE", rejected)
    except ValueError as exc:
        assert "humRequired/humRule" in str(exc), str(exc)
    else:
        raise AssertionError("a one-course tiered HUM requirement was accepted")

    print(
        f"OK: requirement validation passed for {len(term_files)} terms; "
        "every major requires one or two HUM courses."
    )


if __name__ == "__main__":
    main()
