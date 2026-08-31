#!/usr/bin/env python3
"""Build and validate the exact static bundle published to GitHub Pages.

The source repository intentionally contains scrapers, tests, captured HTML,
sample academic records, and editor configuration. Publishing the repository
directory wholesale would expose those non-runtime files. This builder starts
from an explicit application allowlist plus the data-pipeline manifest module's runtime-data
allowlist, copies only those files, and refuses to reuse a non-empty output
directory.
"""

from __future__ import annotations

import argparse
from html.parser import HTMLParser
import http.server
import json
from pathlib import Path, PurePosixPath
import posixpath
import re
import shutil
import threading
from urllib.error import HTTPError
from urllib.parse import unquote, urlsplit
from urllib.request import urlopen

from tools.data_pipeline import build_manifest


ROOT = Path(__file__).resolve().parents[2]


# Keep this list intentionally boring and reviewable. A new runtime script or
# asset must be added explicitly and will then be checked against index.html,
# the service-worker shell, and the mounted-subpath smoke test below.
APP_FILES = {
    "index.html",
    "styles.css",
    "styles/planner-shell.css",
    "styles/graduation.css",
    "styles/planner.css",
    "styles/scheduler-shell.css",
    "styles/scheduler-grid.css",
    "styles/planner-controls.css",
    "styles/summary-overview.css",
    "styles/summary-workspace.css",
    "mobile.css",
    "styles/mobile-scheduler.css",
    "manifest.json",
    "robots.txt",
    "sitemap.xml",
    "sw.js",
    "main.js",
    "scripts/mobile/viewport-mode.js",
    "scripts/mobile/navigation-progress.js",
    "scripts/mobile/planner-accordion.js",
    "scripts/mobile/scheduler-adaptation.js",
    "mobile.js",
    "theme.js",
    "LICENSE",
    "data/manifest.json",
    "scripts/ui/graduation-flag-messages.js",
    "scripts/version.js",
    "scripts/preferences.js",
    "scripts/plan/ui.js",
    "scripts/plan/import-validation.js",
    "scripts/plan/import-export.js",
    "scripts/plan_manager.js",
    "scripts/domain/academic-terms.js",
    "scripts/ui/course-history-table.js",
    "scripts/adapters/course-suggestion-scorer.js",
    "scripts/data/course-metadata.js",
    "scripts/storage/curriculum-persistence.js",
    "scripts/course_retakes.js",
    "scripts/registration_rules.js",
    "scripts/requisites/expression-policy.js",
    "scripts/course_requisites.js",
    "scripts/course-filter-offering-history.js",
    "scripts/course_filters.js",
    "scripts/scheduler/dialogs.js",
    "scripts/scheduler/storage.js",
    "scripts/scheduler/meeting-model.js",
    "scripts/scheduler/foundation.js",
    "scripts/scheduler/course-details.js",
    "scripts/scheduler/course-ui.js",
    "scripts/scheduler/planner-sync.js",
    "scripts/scheduler/results.js",
    "scripts/scheduler/results-filtering.js",
    "scripts/scheduler/result-card.js",
    "scripts/scheduler/results-controller.js",
    "scripts/scheduler/grid-geometry.js",
    "scripts/scheduler/grid-availability.js",
    "scripts/scheduler/grid-controller.js",
    "scripts/scheduler/selection-controller.js",
    "scripts/scheduler/session.js",
    "scripts/scheduler/sidebar.js",
    "scripts/scheduler/program-details.js",
    "scripts/scheduler/term-context.js",
    "scripts/scheduler.js",
    "scripts/mouse_and_drag.js",
    "scripts/s_semester.js",
    "scripts/create_semester.js",
    "scripts/planner/course-picker-layout.js",
    "scripts/planner/course-picker-option-renderer.js",
    "scripts/planner/course-picker.js",
    "scripts/planner/course-commit.js",
    "scripts/planner/course-details-controller.js",
    "scripts/planner/grade-editor.js",
    "scripts/click.js",
    "scripts/academic-records/parser.js",
    "scripts/academic-records/catalog-resolution.js",
    "scripts/academic-records/importer.js",
    "scripts/academic_records_parser.js",
    "scripts/pdf_transcript_reader.js",
    "scripts/domain/credits.js",
    "scripts/domain/grades.js",
    "scripts/domain/suggestion-ranking.js",
    "scripts/data/catalog.js",
    "scripts/domain/curriculum-allocation.js",
    "scripts/domain/curriculum-recalculation.js",
    "scripts/domain/curriculum-progress.js",
    "scripts/domain/requirement-engine.js",
    "scripts/domain/suggestion-candidate-impact.js",
    "scripts/domain/suggestion-progress-snapshot.js",
    "scripts/ui/curriculum-view.js",
    "scripts/s_curriculum.js",
    "scripts/requirements.js",
    "scripts/minor_requirements.js",
    "scripts/domain/minor-allocation.js",
    "scripts/ui/graduation-results.js",
    "scripts/ui/graduation-summary-shell.js",
    "scripts/ui/graduation-minor-summary.js",
    "scripts/graduation_check.js",
    "scripts/app/program-data.js",
    "scripts/app/runtime.js",
    "scripts/app/custom_course_model.js",
    "scripts/app/custom_course_runtime.js",
    "scripts/app/custom_course_manager.js",
    "scripts/app/custom_course_form.js",
    "scripts/app/custom_course_ui.js",
    "scripts/app/academic_records_import.js",
    "scripts/app/transcript-custom-course-review.js",
    "scripts/app/program_context.js",
    "scripts/app/onboarding.js",
    "scripts/app/mobile_notice.js",
    "scripts/app/planner-preferences.js",
    "scripts/app/saved-course-restoration.js",
    "scripts/app/shell-controller.js",
    "scripts/app/program-selection-controller.js",
    "assets/favicon.ico",
    "assets/favicon-16x16.png",
    "assets/favicon-32x32.png",
    "assets/android-chrome-192x192.png",
    "assets/android-chrome-512x512.png",
    "assets/apple-touch-icon.png",
    "assets/closedb.png",
    "assets/closedw.png",
    "assets/dragb.png",
    "assets/dragw.png",
    "assets/editb.png",
    "assets/editw.png",
    "assets/tickb.png",
    "assets/tickw.png",
    "assets/open.png",
    "assets/vendor/inter-5.3.0/inter.css",
    "assets/vendor/inter-5.3.0/files/inter-latin-wght-normal.woff2",
    "assets/vendor/inter-5.3.0/files/inter-latin-ext-wght-normal.woff2",
    "assets/vendor/inter-5.3.0/LICENSE",
    "assets/vendor/inter-5.3.0/README.md",
    "assets/vendor/fontawesome-6.4.0/css/fontawesome.min.css",
    "assets/vendor/fontawesome-6.4.0/css/solid.min.css",
    "assets/vendor/fontawesome-6.4.0/webfonts/fa-solid-900.woff2",
    "assets/vendor/fontawesome-6.4.0/webfonts/fa-solid-900.ttf",
    "assets/vendor/fontawesome-6.4.0/LICENSE.txt",
    "assets/vendor/fontawesome-6.4.0/README.md",
    "assets/vendor/pdfjs-6.2.108/pdf.min.mjs",
    "assets/vendor/pdfjs-6.2.108/pdf.worker.min.mjs",
    "assets/vendor/pdfjs-6.2.108/LICENSE",
    "assets/vendor/pdfjs-6.2.108/README.md",
}

FORBIDDEN_PARTS = {
    ".claude",
    ".git",
    ".github",
    ".idea",
    ".vscode",
    "node_modules",
    "test-results",
    "tests",
    "tmp",
    "tools",
}
FORBIDDEN_SUFFIXES = {".pdf", ".py", ".pyc", ".code-workspace"}


class _IndexReferences(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.references: set[str] = set()
        self.runtime_references: set[str] = set()

    def handle_starttag(self, tag: str, attrs) -> None:
        values = dict(attrs)
        if tag == "script" and values.get("src"):
            self.references.add(values["src"])
            self.runtime_references.add(values["src"])
        elif tag == "link" and values.get("href"):
            self.references.add(values["href"])
            rel = str(values.get("rel") or "").lower().split()
            if "stylesheet" in rel:
                self.runtime_references.add(values["href"])


def _runtime_data_files() -> set[str]:
    _manifest, files = build_manifest.build_manifest()
    return set(files)


def collect_allowed_files() -> set[str]:
    """Return every source path allowed into a Pages bundle."""
    return APP_FILES | _runtime_data_files()


def _validate_source_path(relative: str) -> Path:
    pure = PurePosixPath(relative)
    if pure.is_absolute() or ".." in pure.parts:
        raise ValueError(f"unsafe artifact source path: {relative}")
    unresolved = ROOT / Path(*pure.parts)
    if unresolved.is_symlink():
        raise ValueError(f"artifact sources must not be symlinks: {relative}")
    source = unresolved.resolve()
    try:
        source.relative_to(ROOT)
    except ValueError as error:
        raise ValueError(f"artifact source escapes repository: {relative}") from error
    if not source.is_file():
        raise FileNotFoundError(f"allowlisted runtime file is missing: {relative}")
    return source


def _manifest_is_current() -> None:
    expected, _files = build_manifest.build_manifest()
    actual = json.loads((ROOT / "data/manifest.json").read_text(encoding="utf-8"))
    for key in ("dataVersion", "generatedBy", "inputs", "terms"):
        if actual.get(key) != expected.get(key):
            raise ValueError(
                "data/manifest.json is stale; run "
                "python -m tools.data_pipeline.build_manifest "
                f"(mismatch: {key})"
            )


def _extract_worker_paths(source: str, variable: str) -> set[str]:
    match = re.search(
        rf"const\s+{re.escape(variable)}\s*=\s*\[(.*?)\];",
        source,
        flags=re.DOTALL,
    )
    if not match:
        raise ValueError(f"could not find {variable} in sw.js")
    return {
        value
        for _quote, value in re.findall(
            r"(?:^|,)\s*(['\"])([^'\"]+)\1", match.group(1)
        )
    }


def _normalize_local_references(references: set[str]) -> set[str]:
    local = set()
    for reference in references:
        parsed = urlsplit(reference)
        if parsed.scheme or parsed.netloc or reference.startswith(("#", "data:")):
            continue
        if parsed.path.startswith("/"):
            raise ValueError(
                f"root-relative runtime reference breaks Pages subpaths: {reference}"
            )
        normalized = posixpath.normpath(unquote(parsed.path))
        if normalized not in ("", "."):
            local.add(normalized)
    return local


def _index_reference_sets(index_path: Path) -> tuple[set[str], set[str]]:
    parser = _IndexReferences()
    parser.feed(index_path.read_text(encoding="utf-8"))
    return (
        _normalize_local_references(parser.references),
        _normalize_local_references(parser.runtime_references),
    )


def _local_index_references(index_path: Path) -> set[str]:
    references, _runtime = _index_reference_sets(index_path)
    return references


def _validate_css_references(output: Path, files: set[str]) -> None:
    for relative in sorted(path for path in files if path.endswith(".css")):
        css = (output / Path(*PurePosixPath(relative).parts)).read_text(
            encoding="utf-8"
        )
        for raw in re.findall(r"url\(\s*['\"]?([^)'\"]+)", css):
            parsed = urlsplit(raw.strip())
            if parsed.scheme or parsed.netloc or raw.startswith("data:"):
                continue
            if parsed.path.startswith("/"):
                raise ValueError(f"root-relative CSS asset in {relative}: {raw}")
            resolved = posixpath.normpath(
                posixpath.join(posixpath.dirname(relative), unquote(parsed.path))
            )
            if resolved not in files:
                raise FileNotFoundError(
                    f"CSS asset is absent from Pages artifact: {relative} -> {resolved}"
                )


def validate_artifact(output: Path, expected_files: set[str]) -> None:
    actual_files = {
        path.relative_to(output).as_posix()
        for path in output.rglob("*")
        if path.is_file()
    }
    expected_output = expected_files | {".nojekyll"}
    if actual_files != expected_output:
        missing = sorted(expected_output - actual_files)
        unexpected = sorted(actual_files - expected_output)
        raise ValueError(
            f"artifact allowlist mismatch; missing={missing}, unexpected={unexpected}"
        )

    for relative in actual_files:
        pure = PurePosixPath(relative)
        if FORBIDDEN_PARTS.intersection(pure.parts):
            raise ValueError(f"developer/private path leaked into artifact: {relative}")
        if pure.suffix.lower() in FORBIDDEN_SUFFIXES:
            raise ValueError(f"non-runtime file leaked into artifact: {relative}")
        if pure.suffix.lower() == ".html" and relative != "index.html":
            raise ValueError(f"captured HTML leaked into artifact: {relative}")
        if "_from_saved" in pure.stem:
            raise ValueError(f"saved scraper recovery file leaked: {relative}")

    index_refs, index_runtime_refs = _index_reference_sets(output / "index.html")
    missing_index_refs = index_refs - actual_files
    if missing_index_refs:
        raise FileNotFoundError(
            f"index.html references files absent from artifact: {sorted(missing_index_refs)}"
        )

    sw_source = (output / "sw.js").read_text(encoding="utf-8")
    shell_paths = _extract_worker_paths(sw_source, "APP_SHELL_PATHS")
    pdf_paths = _extract_worker_paths(sw_source, "PDFJS_PATHS")
    missing_shell = {path for path in shell_paths | pdf_paths if path} - actual_files
    if missing_shell:
        raise FileNotFoundError(
            f"service-worker shell is incomplete: {sorted(missing_shell)}"
        )

    # JavaScript and stylesheet lists are a three-way manifest contract. A
    # stale entry must fail just as a missing one does; otherwise removing a
    # page resource can silently leave dead bytes in both the worker shell and
    # the Pages artifact allowlist forever.
    shell_runtime_refs = {
        path for path in shell_paths if path.endswith((".js", ".css"))
    }
    artifact_runtime_refs = {
        path for path in expected_files
        if path.endswith((".js", ".css")) and path != "sw.js"
    }
    for label, runtime_refs in (
        ("service-worker shell", shell_runtime_refs),
        ("Pages artifact allowlist", artifact_runtime_refs),
    ):
        if runtime_refs != index_runtime_refs:
            missing = sorted(index_runtime_refs - runtime_refs)
            stale = sorted(runtime_refs - index_runtime_refs)
            raise ValueError(
                f"{label} runtime manifest drift; missing={missing}, stale={stale}"
            )

    _validate_css_references(output, actual_files)

    web_manifest = json.loads((output / "manifest.json").read_text(encoding="utf-8"))
    for icon in web_manifest.get("icons", []):
        if icon.get("src") not in actual_files:
            raise FileNotFoundError(
                f"web manifest icon is absent from artifact: {icon.get('src')}"
            )


class _MountedPagesHandler(http.server.SimpleHTTPRequestHandler):
    artifact_directory: Path
    mount = "/surriculum/"

    def translate_path(self, path: str) -> str:
        requested = unquote(urlsplit(path).path)
        if not requested.startswith(self.mount):
            return str(self.artifact_directory / ".not-found")
        relative = posixpath.normpath(requested[len(self.mount) :]).lstrip("/")
        pure = PurePosixPath(relative)
        if relative in ("", "."):
            return str(self.artifact_directory)
        if pure.is_absolute() or ".." in pure.parts:
            return str(self.artifact_directory / ".not-found")
        return str(self.artifact_directory.joinpath(*pure.parts))

    def log_message(self, _format: str, *_args) -> None:
        return


def mounted_subpath_smoke(output: Path) -> None:
    """Serve the built site at /surriculum/ and request its complete shell."""
    handler = type(
        "MountedPagesHandler",
        (_MountedPagesHandler,),
        {"artifact_directory": output.resolve()},
    )
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        # The mount must be real: a root request should not accidentally work.
        try:
            urlopen(origin + "/index.html", timeout=5)
        except HTTPError as error:
            if error.code != 404:
                raise
        else:
            raise AssertionError("mounted artifact unexpectedly served at origin root")

        sw_source = (output / "sw.js").read_text(encoding="utf-8")
        requested_paths = (
            {"", "index.html", "courses/schedule_subjects.json"}
            | _extract_worker_paths(sw_source, "APP_SHELL_PATHS")
            | _extract_worker_paths(sw_source, "PDFJS_PATHS")
            | _local_index_references(output / "index.html")
        )
        for relative in sorted(requested_paths):
            url = origin + "/surriculum/" + relative
            with urlopen(url, timeout=10) as response:
                if response.status != 200:
                    raise AssertionError(f"mounted smoke failed for {url}: {response.status}")
                # Force a complete read so truncated or prematurely closed
                # responses fail without resetting the local server socket.
                response.read()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def build(output: Path, *, run_smoke: bool = True) -> set[str]:
    output = output.expanduser().resolve()
    if output == ROOT or output in ROOT.parents:
        raise ValueError("refusing to build over the repository root or an ancestor")
    if output.exists() and not output.is_dir():
        raise FileExistsError(f"output path is not a directory: {output}")
    if output.exists() and any(output.iterdir()):
        raise FileExistsError(
            f"output directory is not empty; choose a fresh path: {output}"
        )
    output.mkdir(parents=True, exist_ok=True)

    _manifest_is_current()
    files = collect_allowed_files()
    for relative in sorted(files):
        source = _validate_source_path(relative)
        destination = output / Path(*PurePosixPath(relative).parts)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
    (output / ".nojekyll").write_text("", encoding="utf-8")

    validate_artifact(output, files)
    if run_smoke:
        mounted_subpath_smoke(output)
    return files


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument(
        "--skip-mounted-smoke",
        action="store_true",
        help="skip the local /surriculum/ HTTP smoke (not recommended in CI)",
    )
    args = parser.parse_args()
    files = build(args.output, run_smoke=not args.skip_mounted_smoke)
    total_bytes = sum((args.output / path).stat().st_size for path in files)
    print(
        f"Built validated Pages artifact: {len(files)} files, "
        f"{total_bytes / (1024 * 1024):.1f} MiB -> {args.output.resolve()}"
    )


if __name__ == "__main__":
    main()
