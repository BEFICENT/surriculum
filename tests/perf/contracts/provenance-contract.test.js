'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const test = require('node:test');

const { collectTargetHashes } = require('../lib/provenance');

const EXPECTED_TARGET_HASH_CONCURRENCY = 8;

test('target fingerprints cap HTTP concurrency and retain every ordered hash', async (t) => {
  const assets = Array.from({ length: 24 }, (_, index) => `scripts/runtime-${index}.js`);
  const indexSource = [
    '<!doctype html><html><head>',
    ...assets.map((relative) => `<script defer src="${relative}"></script>`),
    '</head><body></body></html>',
  ].join('');
  const bodies = new Map([
    ['/index.html', indexSource],
    ['/sw.js', 'self.addEventListener("fetch", () => {});'],
    ['/data/manifest.json', '{"dataVersion":"contract"}'],
    ...assets.map((relative, index) => [`/${relative}`, `window.runtime${index} = true;`]),
  ]);
  let activeRequests = 0;
  let peakRequests = 0;
  let rejectedRequests = 0;
  const server = http.createServer((request, response) => {
    activeRequests += 1;
    peakRequests = Math.max(peakRequests, activeRequests);
    const finish = (status, body) => {
      response.writeHead(status, { 'Content-Type': 'application/octet-stream' });
      response.end(body);
      activeRequests -= 1;
    };
    if (activeRequests > EXPECTED_TARGET_HASH_CONCURRENCY) {
      rejectedRequests += 1;
      finish(503, 'too many concurrent requests');
      return;
    }
    const assetNumber = Number(/runtime-(\d+)/.exec(request.url)?.[1]);
    const responseDelay = Number.isFinite(assetNumber) ? 10 + ((assetNumber * 7) % 5) * 8 : 12;
    setTimeout(() => {
      const body = bodies.get(request.url);
      finish(body === undefined ? 404 : 200, body === undefined ? 'missing' : body);
    }, responseDelay);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  const targetUrl = `http://127.0.0.1:${address.port}/`;

  const hashes = await collectTargetHashes({ url: targetUrl });
  const expectedFiles = [
    'index.html',
    ...assets,
    'sw.js',
    'data/manifest.json',
  ].sort();

  assert.equal(rejectedRequests, 0, 'the collector exceeded the server concurrency limit');
  assert.equal(
    peakRequests,
    EXPECTED_TARGET_HASH_CONCURRENCY,
    'the contract did not exercise the complete bounded worker pool',
  );
  assert.deepEqual(Object.keys(hashes), expectedFiles, 'fingerprints must retain deterministic path order');
  for (const relative of expectedFiles) {
    const body = bodies.get(`/${relative}`);
    assert.equal(hashes[relative].error, undefined, `${relative} was not fingerprinted`);
    assert.equal(
      hashes[relative].sha256,
      crypto.createHash('sha256').update(body).digest('hex'),
      `${relative} retained the wrong content hash`,
    );
    assert.equal(hashes[relative].bytes, Buffer.byteLength(body), `${relative} retained the wrong byte size`);
  }
});
