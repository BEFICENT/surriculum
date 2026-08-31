#!/usr/bin/env python3
"""Generate data/manifest.json — the data-bundle manifest the app reads.

The web app reads `dataVersion` from data/manifest.json and folds it into the
service-worker cache key (see main.js registration + sw.js), so a re-scrape that
changes ANY data file automatically rotates the cache and returning users pick up
the new data. `dataVersion` is therefore CONTENT-DERIVED: it is a short hash of
every data file's contents, so it stays stable across a no-op re-scrape and only
changes when the data actually changes. Per-term hashes are recorded under
`terms` so future tooling can tell which terms changed.

The "data bundle" is every runtime `.jsonl`/`.json` input under courses/ and
requirements/. This includes catalog, requirement, schedule, cumulative course
metadata, and lazy history inputs. It excludes scraper-only intermediates,
saved/back-up schedule files that no runtime loader can request, and the
scraper's HTML page cache. `data/manifest.json` lives outside these roots so it
cannot hash itself.

Large runtime JSONL files still contribute through streaming hashes; their
hundreds of individual paths are not copied into the manifest. The much smaller
set of runtime `.json` files is listed with short hashes so exceptional inputs
such as `courses/schedule_subjects.json` remain auditable.

Run this after any fetch_*.py (it makes no network requests):

    python -m tools.data_pipeline.build_manifest
"""

import datetime
import glob
import hashlib
import json
import os
import re
from pathlib import Path

ROOT = str(Path(__file__).resolve().parents[2])
DATA_DIRS = ("courses", "requirements")
EXCLUDE_SUBSTR = ("coursepage_html_cache",)
EXCLUDE_PATHS = {
    # Scraper intermediate merged into the runtime catalog snapshots.
    "courses/basic_science_credits.jsonl",
    "courses/basic_science_credits.json",
}
# A six-digit term code appearing as a path segment or as the file stem
# (courses/202301/CS.jsonl, requirements/202301.jsonl, requirements/minors/202301.jsonl).
TERM_RE = re.compile(r"(?:^|/)(\d{6})(?:/|\.(?:jsonl|json)$)")
SCHEDULE_RUNTIME_RE = re.compile(r"^courses/schedule/\d{6}\.jsonl$")


def _file_hash(abs_path, chunk_size=65536):
    """Hash runtime JSON as canonical UTF-8 bytes with LF newlines.

    Git checkouts may expose the same tracked text as LF, CRLF, or legacy CR.
    Normalizing while streaming keeps dataVersion reproducible across Windows
    and Linux without loading the multi-megabyte history files into memory.
    """
    h = hashlib.sha256()
    pending_cr = False
    with open(abs_path, "rb") as fh:
        for chunk in iter(lambda: fh.read(chunk_size), b""):
            if pending_cr:
                chunk = b"\r" + chunk
                pending_cr = False
            if chunk.endswith(b"\r"):
                chunk = chunk[:-1]
                pending_cr = True
            chunk = chunk.replace(b"\r\n", b"\n").replace(b"\r", b"\n")
            h.update(chunk)
    if pending_cr:
        h.update(b"\n")
    return h.hexdigest()


def _combined_hash(rel_paths, file_hashes=None):
    """Order-independent hash of a set of files, keyed by relative path so a
    rename counts as a change."""
    h = hashlib.sha256()
    for rel in sorted(rel_paths):
        h.update(rel.encode("utf-8"))
        h.update(b"\0")
        digest = (file_hashes or {}).get(rel)
        if digest is None:
            digest = _file_hash(os.path.join(ROOT, rel))
        h.update(digest.encode("ascii"))
        h.update(b"\n")
    return h.hexdigest()


def _is_runtime_data_path(rel):
    if any(s in rel for s in EXCLUDE_SUBSTR) or rel in EXCLUDE_PATHS:
        return False
    # The scheduler only requests courses/schedule/<six-digit-term>.jsonl.
    # Files such as 202502_from_saved.jsonl are local recovery artifacts, not
    # runtime inputs, and must not rotate returning users' cache versions.
    if rel.startswith("courses/schedule/"):
        return bool(SCHEDULE_RUNTIME_RE.fullmatch(rel))
    return True


def _collect():
    rels = []
    for base in DATA_DIRS:
        for extension in ("jsonl", "json"):
            pattern = os.path.join(ROOT, base, "**", "*." + extension)
            for abs_path in glob.glob(pattern, recursive=True):
                rel = os.path.relpath(abs_path, ROOT).replace(os.sep, "/")
                if _is_runtime_data_path(rel):
                    rels.append(rel)
    return sorted(set(rels))


def build_manifest():
    files = _collect()
    # Read each input once even though its digest can contribute to the global,
    # format-level, and per-term aggregates.
    file_hashes = {
        rel: _file_hash(os.path.join(ROOT, rel))
        for rel in files
    }
    jsonl_files = [rel for rel in files if rel.endswith(".jsonl")]
    json_files = [rel for rel in files if rel.endswith(".json")]
    by_term = {}
    for rel in files:
        m = TERM_RE.search(rel)
        if m:
            by_term.setdefault(m.group(1), []).append(rel)
    term_hashes = {
        term: _combined_hash(fs, file_hashes)[:16]
        for term, fs in sorted(by_term.items())
    }
    data_version = _combined_hash(files, file_hashes)[:16]
    return {
        "dataVersion": data_version,
        "generatedAt": datetime.datetime.now(datetime.timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z"),
        "generatedBy": "tools.data_pipeline.build_manifest",
        "inputs": {
            "jsonl": {
                "count": len(jsonl_files),
                "hash": _combined_hash(jsonl_files, file_hashes)[:16],
            },
            "json": {
                rel: file_hashes[rel][:16]
                for rel in json_files
            },
        },
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
