const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

test('production HTML has no third-party runtime scripts, styles, or inline handlers', () => {
  assert.doesNotMatch(HTML, /<script\b[^>]+src=["']https?:/i);
  assert.doesNotMatch(
    HTML,
    /<link\b(?=[^>]*rel=["']stylesheet["'])[^>]+href=["']https?:/i
  );
  assert.doesNotMatch(HTML, /\son[a-z]+\s*=/i);
  assert.doesNotMatch(HTML, /fonts\.googleapis|fonts\.gstatic|cdnjs\.cloudflare|unpkg\.com/i);
});

test('CSP permits only the reviewed inline structured-data block', () => {
  const cspMatch = HTML.match(
    /<meta\s+http-equiv=["']Content-Security-Policy["']\s+content=["']([^"']*(?:'[^']*'[^"']*)*)["']/i
  );
  assert.ok(cspMatch, 'Content-Security-Policy meta tag is missing');
  const csp = cspMatch[1];
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'self'/);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);

  const jsonLd = HTML.match(/<script type=["']application\/ld\+json["']>([\s\S]*?)<\/script>/i);
  assert.ok(jsonLd, 'structured data is missing');
  const normalizedJsonLd = jsonLd[1].replace(/\r\n?/g, '\n');
  const hash = crypto.createHash('sha256').update(normalizedJsonLd).digest('base64');
  assert.match(csp, new RegExp(`script-src[^;]*'sha256-${hash.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
});

test('structured data does not claim an unverified aggregate rating', () => {
  assert.doesNotMatch(HTML, /aggregateRating|ratingValue|ratingCount/);
});
