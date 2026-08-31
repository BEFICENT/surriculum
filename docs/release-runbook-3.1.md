# SUrriculum 3.1 release and rollback runbook

This runbook records the release procedure executed on 2026-08-16. SUrriculum
3.1 was merged through commit `498ed78`, deployed by the existing GitHub Pages
branch source, smoke-tested on the public site, and tagged as `v3.1.0`. No
GitHub Pages setting was changed.

## Release invariants

- Preserve every 3.1 commit. Do not squash or rebase the release branch.
- Release by merging `surriculum-3.1` into `main` with a merge commit.
- Do not force-push `main` or move a published release tag.
- Do not publish while the release-readiness tracker has an unresolved blocker
  the maintainer has not explicitly accepted.
- The current production path is GitHub Pages publishing the repository root
  from `main`. Merely pushing `surriculum-3.1` does not deploy it.
- A future allowlisted GitHub Pages Actions artifact is separate infrastructure
  work; changing the Pages source is not part of this runbook unless explicitly
  approved and verified first.

## 1. Preflight the release branch

From a clean `surriculum-3.1` worktree:

```bash
git status --short
git fetch origin
git log --oneline --decorate origin/main..HEAD
git diff --stat origin/main...HEAD
```

Confirm that only intended source, data, tests, documentation, and vendored
runtime assets are tracked. In particular, confirm that temporary files, editor
settings, test output, and caches are absent.

Install the test tooling and run the normal gate:

```bash
python -m pip install -r requirements.txt
npm ci
npx playwright install chromium
npm test
```

Run the focused cross-browser gate when its browser binaries are available:

```bash
npx playwright install firefox webkit
npm run test:e2e:cross-browser
```

Confirm the generated-data policy without fetching live data:

```bash
python tests/requirements_validation_test.py
python tests/manifest_integrity_test.py
python tests/pages_artifact_test.py
```

If any checked-in runtime data changed intentionally, regenerate and recheck the
manifest before committing:

```bash
python -m tools.data_pipeline.build_manifest
python tests/manifest_integrity_test.py
```

Record the final results in `docs/release-readiness-3.1.md`. Do not copy stale
counts from an earlier run.

## 2. Review the production artifact

Before the merge, inspect the exact set that production is expected to serve.
Confirm that it contains the app shell, data, local PDF.js/fonts/icons, licenses,
manifest, and service worker, while excluding tests, scraper inputs, development
directories, real test fixtures, and repository metadata if the allowlisted
Actions artifact path is later adopted.

For the currently configured legacy Pages path, remember that the repository
root from `main` is published. Do not switch the Pages source or trigger an
artifact deployment as part of a dry run.

## 3. Merge and publish — maintainer approval required

Only after explicit release approval and a fresh green preflight:

```bash
git switch main
git pull --ff-only origin main
git merge --no-ff surriculum-3.1 -m "Release SUrriculum 3.1"
npm test
git push origin main
```

The push to `main` is the deployment trigger under the current GitHub Pages
configuration. Watch the Pages workflow and do not tag a failed deployment.

After production smoke tests pass, create the immutable release tag on the merge
commit:

```bash
git tag -a v3.1.0 -m "SUrriculum 3.1.0"
git push origin v3.1.0
```

These commands were executed after explicit maintainer approval and a green
post-merge release gate.

## 4. Production smoke checks

Use a clean browser profile and an existing returning-user profile:

1. Open the GitHub Pages `/surriculum/` URL and confirm version 3.1 loads with no
   console or Content Security Policy errors.
2. Create or import a disposable plan, reload, and confirm its terms, grades,
   grading bases, custom courses, and selected programs persist.
3. Import the supported Academic Records HTML and readable-text PDF fixtures;
   confirm the import report and custom-course review behavior.
4. Open Summary and Graduation Check; verify CGPA/PGPA and earned/current/future/
   unsuccessful labels on a known plan.
5. Open Scheduler, preview and select a section, and update a disposable planner
   term.
6. Reload once under service-worker control, then test an offline reload of a
   warmed plan.
7. Confirm another same-origin storage key and cache are not removed during the
   service-worker upgrade or SUrriculum reset.
8. Confirm the public page has no runtime requests to Google Fonts, unpkg, or a
   Font Awesome CDN.

## 5. Rollback

Prefer a history-preserving revert; never reset or force-push `main`.

If the 3.1 merge itself must be rolled back:

```bash
git switch main
git pull --ff-only origin main
git revert -m 1 <release-merge-commit>
git push origin main
```

If a later single production commit caused the regression, revert that commit
instead:

```bash
git revert <offending-commit>
git push origin main
```

Then watch the Pages deployment and repeat the production smoke checks. Do not
delete or move `v3.1.0`; if a corrected release is needed after tagging, prepare
a new patch version and tag (for example `v3.1.1`).

For a data-only failure, revert the bad data/manifest commit together so the
content-derived `dataVersion` matches the restored tree. For a service-worker
failure, ship a reviewed forward fix or revert promptly and verify both a fresh
profile and an upgrading profile; browser storage must not be manually cleared
as the normal recovery path.

## Release outcome

- [x] Merge `surriculum-3.1` into `main` without squashing.
- [x] Push release merge `498ed78` to `origin/main`.
- [x] Verify successful GitHub Pages run `31967155857` and the public site.
- [x] Create and push `v3.1.0` after production smoke checks passed.
- [x] Keep the existing GitHub Pages settings unchanged; the allowlisted
  Actions artifact remains an optional future deployment path.
