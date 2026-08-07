#!/usr/bin/env python3
"""Offline regression checks for requirement-record credit validation."""

import copy
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import fetch_requirements as fr  # noqa: E402


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

    print("OK: requirement credit-gap validation checks passed.")


if __name__ == "__main__":
    main()
