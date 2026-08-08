const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const EXPECTED_HASHES = Object.freeze({
  'assets/vendor/fontawesome-6.4.0/css/fontawesome.min.css':
    '3dc869c82a722d9fd7c7d881a453ee3d269d461917c7a27901ad357d9dcbbfc4',
  'assets/vendor/fontawesome-6.4.0/css/solid.min.css':
    'b43dcc895ec8fa778047b69062f1920729246b946fba0c34cddd15e558a801e3',
  'assets/vendor/fontawesome-6.4.0/webfonts/fa-solid-900.woff2':
    '7152a6933ee3d690ec2af3d09da9d701723d16aa3410a6d80f28ff8866f3b880',
  'assets/vendor/fontawesome-6.4.0/webfonts/fa-solid-900.ttf':
    '67a65763c7f80903d81603bbeb9049fc2bf28508479b83ed011fe24c71fa950a',
  'assets/vendor/fontawesome-6.4.0/LICENSE.txt':
    '0aa8f86525273b2efa4f40f4272a188e187704252170e979dc06879adf68d43c',
  'assets/vendor/inter-5.3.0/inter.css':
    '4070e3f7d8df4319e9585744d13672ff4211dabc6dd8631975e7acd7c62edc61',
  'assets/vendor/inter-5.3.0/files/inter-latin-wght-normal.woff2':
    '3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62',
  'assets/vendor/inter-5.3.0/files/inter-latin-ext-wght-normal.woff2':
    '34b9c504cab7a73e37b746343a449132e56cf7b5481af2cb81dc74dcff25c956',
  'assets/vendor/inter-5.3.0/LICENSE':
    '3b0a5fca3d17942cde889069889dedbbbd075e9b599968c82a95f4d944e9b345',
});

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

test('local font assets retain their reviewed bytes', () => {
  for (const [relativePath, expectedHash] of Object.entries(EXPECTED_HASHES)) {
    const file = path.join(ROOT, ...relativePath.split('/'));
    assert.equal(sha256(file), expectedHash, relativePath);
  }
});

test('local font stylesheets reference only shipped files', () => {
  for (const relativeCss of [
    'assets/vendor/fontawesome-6.4.0/css/fontawesome.min.css',
    'assets/vendor/fontawesome-6.4.0/css/solid.min.css',
    'assets/vendor/inter-5.3.0/inter.css',
  ]) {
    const cssFile = path.join(ROOT, ...relativeCss.split('/'));
    const css = fs.readFileSync(cssFile, 'utf8');
    const urls = Array.from(css.matchAll(/url\((?:['"]?)([^)'"]+)/g), (match) => match[1]);
    for (const url of urls) {
      if (/^(?:data:|https?:)/i.test(url)) continue;
      assert.equal(
        fs.existsSync(path.resolve(path.dirname(cssFile), url)),
        true,
        `${relativeCss} references missing ${url}`
      );
    }
  }
});
