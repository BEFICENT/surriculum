#!/usr/bin/env python3
"""Regression checks for the allowlisted GitHub Pages release bundle."""

from pathlib import Path
import sys
import tempfile


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import build_pages_artifact  # noqa: E402


def main() -> None:
    allowed = build_pages_artifact.collect_allowed_files()

    # Runtime data is present, while the repository's test/dev/source captures
    # can never enter through either half of the allowlist.
    for required in (
        "index.html",
        "LICENSE",
        "data/manifest.json",
        "scripts/registration_rules.js",
        "courses/schedule_subjects.json",
        "courses/all_coursepage_info.jsonl",
        "assets/vendor/pdfjs-6.2.108/LICENSE",
        "assets/vendor/fontawesome-6.4.0/LICENSE.txt",
        "assets/vendor/inter-5.3.0/LICENSE",
    ):
        assert required in allowed, f"missing runtime/release file: {required}"

    for forbidden in (
        "package.json",
        "playwright.config.js",
        "tests/e2e/desktop/smoke.spec.js",
        "courses/schedule/202502_from_saved.jsonl",
        "courses/basic_science_credits.jsonl",
        "Example Files/Academic Records Summary_ex.html",
    ):
        assert forbidden not in allowed, f"non-runtime file was allowlisted: {forbidden}"

    assert not any(path.lower().endswith(".pdf") for path in allowed)
    assert not any(path.startswith(".vscode/") for path in allowed)
    assert not any(path.startswith(".claude/") for path in allowed)

    with tempfile.TemporaryDirectory(prefix="surriculum-pages-test-") as temporary:
        output = Path(temporary) / "site"
        built = build_pages_artifact.build(output)
        assert built == allowed
        assert (output / ".nojekyll").is_file()
        assert (output / "index.html").is_file()
        assert not (output / "tests").exists()
        assert not (output / "Example Files").exists()

        try:
            build_pages_artifact.build(output, run_smoke=False)
        except FileExistsError:
            pass
        else:
            raise AssertionError("builder accepted a non-empty output directory")

    print(
        "OK: Pages artifact is allowlisted, manifest-current, shell-complete, "
        "and healthy under /surriculum/."
    )


if __name__ == "__main__":
    main()
