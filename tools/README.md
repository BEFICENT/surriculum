# Repository tools

Python maintenance code is kept outside the browser runtime under three
explicit ownership boundaries:

- `data_pipeline/` contains active SUIS scrapers, shared term/response policy,
  derived-history builders, and the runtime data-manifest generator.
- `release/` builds and validates the allowlisted GitHub Pages artifact.
- `legacy/` retains deprecated or one-off migrations that are not part of the
  normal refresh workflow.

Run tools from the repository root as Python modules so package-relative imports
and child-process interpreter selection remain deterministic. For example:

```bash
python -m tools.data_pipeline.fetch_courses
python -m tools.data_pipeline.build_manifest
python -m tools.release.build_pages_artifact --output path/to/output
```

The supported commands and data-refresh sequence are documented in the root
README. Automated refresh and release workflows use these same module entry
points.
