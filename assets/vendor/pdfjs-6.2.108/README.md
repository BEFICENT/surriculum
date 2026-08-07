# Mozilla PDF.js 6.2.108

These files are copied without modification from the official
`pdfjs-dist@6.2.108` npm package:

- `legacy/build/pdf.min.mjs`
- `legacy/build/pdf.worker.min.mjs`
- `LICENSE`

Package tarball:
`https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-6.2.108.tgz`

Upstream release:
`https://github.com/mozilla/pdf.js/releases/tag/v6.2.108`

Package integrity:
`sha512-YxFb+SQcodN2rnX9Tn3dHYlqfb7NjlzzfONPpJd+AKoKtUjEdevTfbC07d5TcczzOK6261auRkP/M8OBHs9vFQ==`

Vendored file SHA-256 values:

- `pdf.min.mjs`: `9fab0c910bf1484835c5c2aeb68f7eb3dfce7f9eb435a004526c5af86d70890c`
- `pdf.worker.min.mjs`: `bc0d1b88ea0b66196b1d36a58ac243c6d92adfe725624e2a9fdd381bdf8ef434`
- `LICENSE`: `0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594`

PDF.js is licensed under Apache-2.0. The importer is text-only and passes
`useWasm: false`, so the package's optional WASM, CMap, viewer, sandbox, image
decoder, and standard-font assets are not shipped.

This version includes Mozilla's fixes for CVE-2024-4367 and CVE-2026-16633.
The latter affects PDF.js 5.6.83 through 6.2.107, which is why the matched pair
is pinned to 6.2.108 rather than the previously investigated 6.1 release.
