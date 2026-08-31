#!/usr/bin/env python3
"""Fail when the checked-in data manifest is stale relative to its inputs."""

import json
import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from tools.data_pipeline import build_manifest  # noqa: E402


def validate_canonical_newline_hashing():
    """The manifest must be identical for LF/CRLF/CR Git worktrees."""
    # Put CR exactly at a hash-chunk boundary to exercise the streaming carry.
    prefix = b"x" * 65535
    variants = (
        prefix + b"\nsecond\nthird\n",
        prefix + b"\r\nsecond\r\nthird\r\n",
        prefix + b"\rsecond\rthird\r",
    )
    hashes = []
    with tempfile.TemporaryDirectory() as temp_dir:
        for index, content in enumerate(variants):
            path = os.path.join(temp_dir, f"variant-{index}.jsonl")
            with open(path, "wb") as handle:
                handle.write(content)
            hashes.append(build_manifest._file_hash(path))
    assert len(set(hashes)) == 1, "runtime data hashes must normalize newlines"


def validate_runtime_json(files):
    """Parse every deployable data record, with actionable file/line errors."""
    parsed_rows = 0
    for rel in sorted(files):
        path = os.path.join(ROOT, *rel.split("/"))
        if rel.endswith(".json"):
            with open(path, "r", encoding="utf-8") as handle:
                json.load(handle)
            continue

        if not rel.endswith(".jsonl"):
            continue
        file_rows = 0
        with open(path, "r", encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, start=1):
                if not line.strip():
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError as error:
                    raise AssertionError(
                        f"invalid runtime JSONL at {rel}:{line_number}: {error}"
                    ) from error
                assert isinstance(record, dict), (
                    f"runtime JSONL row must be an object: {rel}:{line_number}"
                )
                file_rows += 1
        assert file_rows > 0, f"runtime JSONL file is empty: {rel}"
        parsed_rows += file_rows
    return parsed_rows


def main():
    validate_canonical_newline_hashing()
    expected, files = build_manifest.build_manifest()
    file_set = set(files)
    manifest_path = os.path.join(ROOT, "data", "manifest.json")
    with open(manifest_path, "r", encoding="utf-8") as handle:
        actual = json.load(handle)

    assert actual.get("dataVersion") == expected["dataVersion"], (
        "data/manifest.json has a stale dataVersion; run "
        "python -m tools.data_pipeline.build_manifest"
    )
    assert actual.get("terms") == expected["terms"], (
        "data/manifest.json has stale term hashes; run "
        "python -m tools.data_pipeline.build_manifest"
    )
    assert actual.get("inputs") == expected["inputs"], (
        "data/manifest.json has stale input metadata; run "
        "python -m tools.data_pipeline.build_manifest"
    )
    assert actual.get("generatedBy") == "tools.data_pipeline.build_manifest"

    # Exceptional JSON runtime inputs must not be lost merely because the
    # dominant data format is JSONL.
    schedule_subjects = "courses/schedule_subjects.json"
    assert schedule_subjects in file_set
    assert set(expected["inputs"]["json"]) == {schedule_subjects}

    # Large deterministic files are hashed, not enumerated in the output. They
    # are real lazy/runtime inputs, so changes must still rotate dataVersion.
    for rel in (
        "courses/all_coursepage_info.jsonl",
        "courses/course_instructor_history.jsonl",
        "courses/course_section_history.jsonl",
    ):
        assert rel in file_set, "%s must contribute to dataVersion" % rel

    # Scraper intermediates, local recovery files, and the output itself are
    # deliberately outside the bundle.
    assert "courses/basic_science_credits.jsonl" not in file_set
    assert "courses/schedule/202502_from_saved.jsonl" not in file_set
    assert "data/manifest.json" not in file_set
    assert "manifest.json" not in file_set
    assert build_manifest._is_runtime_data_path("courses/schedule/202602.jsonl")
    assert not build_manifest._is_runtime_data_path(
        "courses/schedule/202602_from_saved.jsonl"
    )
    assert not build_manifest._is_runtime_data_path(
        "courses/basic_science_credits.jsonl"
    )

    parsed_rows = validate_runtime_json(files)

    print(
        "OK: data manifest matches %d files across %d terms; "
        "%d runtime JSONL rows parse."
        % (len(files), len(expected["terms"]), parsed_rows)
    )


if __name__ == "__main__":
    main()
