import argparse
import json
import os
from typing import Any, Dict, Iterable, List, Tuple


COURSES_DIR = "courses"
REQUIREMENTS_DIR = "requirements"


def _iter_json_files(root: str) -> Iterable[str]:
    for dirpath, _, filenames in os.walk(root):
        for name in filenames:
            if name.endswith(".json"):
                yield os.path.join(dirpath, name)


def _write_jsonl(path: str, records: Iterable[Dict[str, Any]]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        for rec in records:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")


def _convert_terms(courses_dir: str) -> Tuple[int, int]:
    src = os.path.join(courses_dir, "terms.json")
    dst = os.path.join(courses_dir, "terms.jsonl")
    if not os.path.exists(src):
        return (0, 0)
    with open(src, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        return (0, 0)
    records = [{"term": term, "majors": majors} for term, majors in data.items() if isinstance(majors, list)]
    _write_jsonl(dst, sorted(records, key=lambda r: str(r.get("term", ""))))
    return (1, len(records))


def _convert_requirements_file(path: str) -> Tuple[int, int]:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        return (0, 0)
    records: List[Dict[str, Any]] = []
    for major in sorted(data.keys()):
        val = data.get(major)
        if isinstance(val, dict):
            records.append({"major": major, **val})
    out_path = path + "l"  # .json -> .jsonl
    _write_jsonl(out_path, records)
    return (1, len(records))


def _convert_course_list_file(path: str) -> Tuple[int, int]:
    base = os.path.basename(path)
    if base in {"terms.json"}:
        return (0, 0)
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list):
        return (0, 0)
    out_path = path + "l"  # .json -> .jsonl
    records = [rec for rec in data if isinstance(rec, dict)]
    _write_jsonl(out_path, records)
    return (1, len(records))


def main() -> int:
    parser = argparse.ArgumentParser(description="Convert the repo's pretty-printed .json data files to .jsonl.")
    parser.add_argument("--courses-dir", default=COURSES_DIR)
    parser.add_argument("--requirements-dir", default=REQUIREMENTS_DIR)
    parser.add_argument("--overwrite", action="store_true", help="Overwrite existing .jsonl files.")
    parser.add_argument("--delete-json", action="store_true", help="Delete the original .json files after conversion.")
    parser.add_argument("--dry-run", action="store_true", help="Print what would change without writing.")
    args = parser.parse_args()

    converted_files = 0
    converted_records = 0
    deleted_files = 0

    # terms.json -> terms.jsonl
    terms_src = os.path.join(args.courses_dir, "terms.json")
    terms_dst = os.path.join(args.courses_dir, "terms.jsonl")
    if os.path.exists(terms_src):
        if not os.path.exists(terms_dst) or args.overwrite:
            if args.dry_run:
                print(f"[dry-run] convert {terms_src} -> {terms_dst}")
            else:
                files, recs = _convert_terms(args.courses_dir)
                converted_files += files
                converted_records += recs
        if args.delete_json and os.path.exists(terms_dst):
            if args.dry_run:
                print(f"[dry-run] delete {terms_src}")
            else:
                os.remove(terms_src)
                deleted_files += 1

    # requirements/*.json -> requirements/*.jsonl
    if os.path.isdir(args.requirements_dir):
        for src in sorted(_iter_json_files(args.requirements_dir)):
            dst = src + "l"
            if os.path.exists(dst) and not args.overwrite:
                if args.delete_json:
                    if args.dry_run:
                        print(f"[dry-run] delete {src}")
                    else:
                        os.remove(src)
                        deleted_files += 1
                continue
            if args.dry_run:
                print(f"[dry-run] convert {src} -> {dst}")
                continue
            files, recs = _convert_requirements_file(src)
            converted_files += files
            converted_records += recs
            if args.delete_json and os.path.exists(dst):
                os.remove(src)
                deleted_files += 1

    # courses/**/<MAJOR>.json -> .jsonl (excluding terms.json)
    if os.path.isdir(args.courses_dir):
        for src in sorted(_iter_json_files(args.courses_dir)):
            if os.path.basename(src) == "terms.json":
                continue
            dst = src + "l"
            if os.path.exists(dst) and not args.overwrite:
                if args.delete_json:
                    if args.dry_run:
                        print(f"[dry-run] delete {src}")
                    else:
                        os.remove(src)
                        deleted_files += 1
                continue
            if args.dry_run:
                print(f"[dry-run] convert {src} -> {dst}")
                continue
            files, recs = _convert_course_list_file(src)
            converted_files += files
            converted_records += recs
            if args.delete_json and files and os.path.exists(dst):
                os.remove(src)
                deleted_files += 1

    print(
        f"Converted {converted_files} file(s), wrote {converted_records} record(s), deleted {deleted_files} file(s)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
