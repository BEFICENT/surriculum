#!/usr/bin/env python3
"""Regression checks for the allowlisted GitHub Pages release bundle."""

from pathlib import Path
import shutil
import sys
import tempfile


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from tools.release import build_pages_artifact  # noqa: E402


def main() -> None:
    allowed = build_pages_artifact.collect_allowed_files()

    # Runtime data is present, while the repository's test/dev/source captures
    # can never enter through either half of the allowlist.
    for required in (
        "index.html",
        "LICENSE",
        "data/manifest.json",
        "scripts/registration_rules.js",
        "scripts/app/transcript-custom-course-review.js",
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
        "tests/fixtures/academic-records/Academic Records Summary_ex.html",
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
        assert not (output / "tools").exists()

        try:
            build_pages_artifact.build(output, run_smoke=False)
        except FileExistsError:
            pass
        else:
            raise AssertionError("builder accepted a non-empty output directory")

        # Runtime manifests are exact, not merely subsets. Stale scripts left
        # behind after an index cleanup must fail on both mirrored lists.
        sw_path = output / "sw.js"
        original_sw = sw_path.read_text(encoding="utf-8")
        sw_path.write_text(
            original_sw.replace(
                "const APP_SHELL_PATHS = [\n",
                "const APP_SHELL_PATHS = [\n  'sw.js',\n",
                1,
            ),
            encoding="utf-8",
        )
        try:
            build_pages_artifact.validate_artifact(output, allowed)
        except ValueError as error:
            assert "service-worker shell runtime manifest drift" in str(error)
        else:
            raise AssertionError("stale service-worker runtime entry was accepted")
        finally:
            sw_path.write_text(original_sw, encoding="utf-8")

        stale_runtime = output / "unused-runtime.js"
        shutil.copy2(output / "theme.js", stale_runtime)
        try:
            build_pages_artifact.validate_artifact(
                output,
                allowed | {"unused-runtime.js"},
            )
        except ValueError as error:
            assert "Pages artifact allowlist runtime manifest drift" in str(error)
        else:
            raise AssertionError("stale artifact runtime entry was accepted")

    print(
        "OK: Pages artifact is allowlisted, manifest-current, shell-complete, "
        "and healthy under /surriculum/."
    )


if __name__ == "__main__":
    main()
