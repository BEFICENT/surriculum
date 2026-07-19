#!/usr/bin/env python3
"""Generate data/manifest.json — the data-bundle manifest the app reads.

The web app reads `dataVersion` from data/manifest.json and folds it into the
service-worker cache key (see main.js registration + sw.js), so a re-scrape that
changes ANY data file automatically rotates the cache and returning users pick up
the new data. `dataVersion` is therefore CONTENT-DERIVED: it is a short hash of
every data file's contents, so it stays stable across a no-op re-scrape and only
changes when the data actually changes. Per-term hashes are recorded under
`terms` so future tooling can tell which terms changed.

The "data bundle" is every `.jsonl` under courses/ and requirements/ (the files
the app fetches at runtime), excluding the scraper's HTML page cache.

Run this after any fetch_*.py (it makes no network requests):

    python build_manifest.py
"""

import datetime
import glob
import hashlib
import json
import os
import re

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_DIRS = ("courses", "requirements")
EXCLUDE_SUBSTR = ("coursepage_html_cache",)
# A six-digit term code appearing as a path segment or as the file stem
# (courses/202301/CS.jsonl, requirements/202301.jsonl, requirements/minors/202301.jsonl).
TERM_RE = re.compile(r"(?:^|/)(\d{6})(?:/|\.jsonl$)")


def _file_hash(abs_path):
    h = hashlib.sha256()
    with open(abs_path, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _combined_hash(rel_paths):
    """Order-independent hash of a set of files, keyed by relative path so a
    rename counts as a change."""
    h = hashlib.sha256()
    for rel in sorted(rel_paths):
        h.update(rel.encode("utf-8"))
        h.update(b"\0")
        h.update(_file_hash(os.path.join(ROOT, rel)).encode("ascii"))
        h.update(b"\n")
    return h.hexdigest()


def _collect():
    rels = []
    for base in DATA_DIRS:
        pattern = os.path.join(ROOT, base, "**", "*.jsonl")
        for abs_path in glob.glob(pattern, recursive=True):
            rel = os.path.relpath(abs_path, ROOT).replace(os.sep, "/")
            if any(s in rel for s in EXCLUDE_SUBSTR):
                continue
            rels.append(rel)
    return rels


def build_manifest():
    files = _collect()
    by_term = {}
    for rel in files:
        m = TERM_RE.search(rel)
        if m:
            by_term.setdefault(m.group(1), []).append(rel)
    term_hashes = {term: _combined_hash(fs)[:16] for term, fs in sorted(by_term.items())}
    data_version = _combined_hash(files)[:16]
    return {
        "dataVersion": data_version,
        "generatedAt": datetime.datetime.now(datetime.timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z"),
        "generatedBy": "build_manifest.py",
        "terms": term_hashes,
    }, files


def main():
    manifest, files = build_manifest()
    out_dir = os.path.join(ROOT, "data")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "manifest.json")
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    print(
        "Wrote data/manifest.json: dataVersion=%s, %d terms, %d files"
        % (manifest["dataVersion"], len(manifest["terms"]), len(files))
    )


if __name__ == "__main__":
    main()
