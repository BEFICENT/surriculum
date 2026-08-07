#!/usr/bin/env python3
"""Fail when the checked-in data manifest is stale relative to its inputs."""

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import build_manifest  # noqa: E402


def main():
    expected, files = build_manifest.build_manifest()
    manifest_path = os.path.join(ROOT, "data", "manifest.json")
    with open(manifest_path, "r", encoding="utf-8") as handle:
        actual = json.load(handle)

    assert actual.get("dataVersion") == expected["dataVersion"], (
        "data/manifest.json has a stale dataVersion; run python build_manifest.py"
    )
    assert actual.get("terms") == expected["terms"], (
        "data/manifest.json has stale term hashes; run python build_manifest.py"
    )
    assert actual.get("generatedBy") == "build_manifest.py"
    print(
        "OK: data manifest matches %d files across %d terms."
        % (len(files), len(expected["terms"]))
    )


if __name__ == "__main__":
    main()
