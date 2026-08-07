'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const VENDOR = path.join(ROOT, 'assets', 'vendor', 'pdfjs-6.2.108');

const EXPECTED_FILES = Object.freeze({
  'pdf.min.mjs': {
    bytes: 512483,
    sha256: '9fab0c910bf1484835c5c2aeb68f7eb3dfce7f9eb435a004526c5af86d70890c',
  },
  'pdf.worker.min.mjs': {
    bytes: 1312452,
    sha256: 'bc0d1b88ea0b66196b1d36a58ac243c6d92adfe725624e2a9fdd381bdf8ef434',
  },
  LICENSE: {
    bytes: 10174,
    sha256: '0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594',
  },
});

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('vendored PDF.js files exactly match the audited 6.2.108 package', () => {
  for (const [name, expected] of Object.entries(EXPECTED_FILES)) {
    const filePath = path.join(VENDOR, name);
    const bytes = fs.readFileSync(filePath);
    assert.equal(bytes.length, expected.bytes, `${name} byte length`);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), expected.sha256, `${name} SHA-256`);
  }

  for (const name of ['pdf.min.mjs', 'pdf.worker.min.mjs']) {
    assert.match(fs.readFileSync(path.join(VENDOR, name), 'utf8'), /pdfjsVersion = 6\.2\.108/);
  }
  assert.match(fs.readFileSync(path.join(VENDOR, 'LICENSE'), 'utf8'), /Apache License\s+Version 2\.0/);
});

test('PDF.js is lazy-loaded locally as an exact matched main/worker pair', () => {
  const indexHtml = read('index.html');
  const mainJs = read('main.js');
  const readerJs = read('scripts/pdf_transcript_reader.js');

  assert.doesNotMatch(indexHtml, /unpkg\.com\/pdfjs-dist/i);
  assert.doesNotMatch(indexHtml, /<script[^>]+pdf(?:\.min)?\.m?js/i);
  assert.match(indexHtml, /scripts\/pdf_transcript_reader\.js/);
  assert.doesNotMatch(indexHtml + mainJs + readerJs, /\bpdfjsLib\b/);
  assert.match(mainJs, /pdfTranscriptReader\.extractText\(file\)/);
  assert.match(readerJs, /assets\/vendor\/pdfjs-6\.2\.108\/pdf\.min\.mjs/);
  assert.match(readerJs, /assets\/vendor\/pdfjs-6\.2\.108\/pdf\.worker\.min\.mjs/);
  assert.match(readerJs, /useWasm:\s*false/);
  assert.match(readerJs, /await loadingTask\.destroy\(\)/);
  assert.doesNotMatch(readerJs, /isEvalSupported/);
  assert.equal(fs.existsSync(path.join(ROOT, 'assets', 'pdf.worker.js')), false);
});

test('PDF.js provenance records the official package integrity and local hashes', () => {
  const provenance = fs.readFileSync(path.join(VENDOR, 'README.md'), 'utf8');
  assert.match(provenance, /pdfjs-dist@6\.2\.108/);
  assert.match(provenance, /sha512-YxFb\+SQcodN2rnX9Tn3dHYlqfb7NjlzzfONPpJd\+AKoKtUjEdevTfbC07d5TcczzOK6261auRkP\/M8OBHs9vFQ==/);
  assert.match(provenance, new RegExp(EXPECTED_FILES['pdf.min.mjs'].sha256));
  assert.match(provenance, new RegExp(EXPECTED_FILES['pdf.worker.min.mjs'].sha256));
});
