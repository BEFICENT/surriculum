'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const DEFAULT_TARGET_HASH_CONCURRENCY = 8;

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function normalizeFirstPartyAssetPath(value) {
  const withoutQuery = String(value || '').trim().split(/[?#]/, 1)[0].replace(/\\/g, '/');
  if (!withoutQuery
      || /^[a-z][a-z0-9+.-]*:/i.test(withoutQuery)
      || withoutQuery.startsWith('//')
      || withoutQuery.startsWith('/')) return null;
  const normalized = path.posix.normalize(withoutQuery.replace(/^\.\//, ''));
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) return null;
  return normalized;
}

function htmlAttribute(tag, name) {
  const expression = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i');
  return expression.exec(String(tag || ''))?.[2] || '';
}

function linkedFirstPartyAssets(indexSource) {
  const assets = [];
  for (const match of String(indexSource || '').matchAll(/<script\b[^>]*>/gi)) {
    const relative = normalizeFirstPartyAssetPath(htmlAttribute(match[0], 'src'));
    if (relative && /\.(?:js|mjs)$/i.test(relative)) assets.push(relative);
  }
  for (const match of String(indexSource || '').matchAll(/<link\b[^>]*>/gi)) {
    const rel = htmlAttribute(match[0], 'rel').toLowerCase().split(/\s+/);
    if (!rel.includes('stylesheet')) continue;
    const relative = normalizeFirstPartyAssetPath(htmlAttribute(match[0], 'href'));
    if (relative && /\.css$/i.test(relative)) assets.push(relative);
  }
  return Array.from(new Set(assets));
}

function resolveCommonJsDependency(fromFile, specifier, repositoryRoot = REPO_ROOT) {
  if (!String(specifier || '').startsWith('.')) return null;
  const unresolved = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    unresolved,
    `${unresolved}.js`,
    `${unresolved}.json`,
    path.join(unresolved, 'index.js'),
  ];
  const rootWithSeparator = `${path.resolve(repositoryRoot)}${path.sep}`;
  return candidates.find((candidate) => {
    const absolute = path.resolve(candidate);
    return absolute.startsWith(rootWithSeparator)
      && fs.existsSync(absolute)
      && fs.statSync(absolute).isFile();
  }) || null;
}

function commonJsDependencyGraph(entryFiles, repositoryRoot = REPO_ROOT) {
  const pending = (Array.isArray(entryFiles) ? entryFiles : [])
    .map((file) => path.resolve(repositoryRoot, ...String(file).split('/')));
  const visited = new Set();
  while (pending.length) {
    const absolute = pending.pop();
    if (visited.has(absolute)) continue;
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
      throw new Error(`Performance workload source is missing: ${path.relative(repositoryRoot, absolute)}`);
    }
    visited.add(absolute);
    if (!/\.js$/i.test(absolute)) continue;
    const source = fs.readFileSync(absolute, 'utf8');
    for (const match of source.matchAll(/\brequire\s*\(\s*(["'])(.*?)\1\s*\)/g)) {
      const dependency = resolveCommonJsDependency(absolute, match[2], repositoryRoot);
      if (dependency && !visited.has(dependency)) pending.push(dependency);
    }
  }
  return Array.from(visited)
    .map((absolute) => path.relative(repositoryRoot, absolute).split(path.sep).join('/'))
    .sort();
}

function fingerprintRepositoryFiles(relativeFiles, repositoryRoot = REPO_ROOT) {
  const files = {};
  for (const relative of Array.from(new Set(relativeFiles || [])).sort()) {
    const data = fs.readFileSync(path.join(repositoryRoot, ...relative.split('/')));
    files[relative] = { sha256: sha256(data), bytes: data.length };
  }
  const digestInput = Object.entries(files)
    .map(([relative, value]) => `${relative}\0${value.sha256}\0${value.bytes}`)
    .join('\n');
  return {
    schemaVersion: 1,
    sha256: sha256(Buffer.from(digestInput, 'utf8')),
    files,
  };
}

function collectWorkloadProvenance(scenario, repositoryRoot = REPO_ROOT) {
  if (!scenario || !/^[a-z0-9-]+$/.test(String(scenario.id || ''))) {
    throw new TypeError('A valid performance scenario is required for workload provenance.');
  }
  const entryFiles = [
    'tests/perf/run.js',
    `tests/perf/scenarios/${scenario.id}.js`,
    'tests/perf/scenarios/_shared.js',
  ];
  const dependencies = commonJsDependencyGraph(entryFiles, repositoryRoot);
  const supplemental = [
    'package-lock.json',
    'tests/perf/lib/windows-power.ps1',
    'tests/perf/lib/windows-sampler.ps1',
  ].filter((relative) => fs.existsSync(path.join(repositoryRoot, ...relative.split('/'))));
  return fingerprintRepositoryFiles([...dependencies, ...supplemental], repositoryRoot);
}

async function mapWithConcurrency(values, limit, mapper) {
  const items = Array.isArray(values) ? values : [];
  if (!items.length) return [];
  const concurrency = Number(limit);
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new TypeError('Target fingerprint concurrency must be a positive integer.');
  }
  const results = new Array(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

async function collectTargetHashes(target, options = {}) {
  const readTargetFile = async (relative) => {
    if (target.root) return fs.readFileSync(path.join(target.root, ...relative.split('/')));
    const response = await fetch(new URL(relative, target.url), {
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  };

  // Fingerprint the first-party scripts and styles linked by the shell plus
  // scenario-declared data inputs. Modularization, CSS work, or a fixture data
  // update must remain visible in the retained run provenance.
  let indexData = null;
  let linkedAssets = [];
  try {
    indexData = await readTargetFile('index.html');
    linkedAssets = linkedFirstPartyAssets(indexData.toString('utf8'));
  } catch (_) {
    // Keep the index entry below so the read failure is recorded in hashes.
  }
  const additionalFiles = (Array.isArray(options.additionalFiles) ? options.additionalFiles : [])
    .map(normalizeFirstPartyAssetPath)
    .filter(Boolean);
  const files = Array.from(new Set([
    'index.html',
    ...linkedAssets,
    ...additionalFiles,
    'sw.js',
    'data/manifest.json',
  ])).sort();
  const entries = await mapWithConcurrency(
    files,
    DEFAULT_TARGET_HASH_CONCURRENCY,
    async (relative) => {
      try {
        const data = relative === 'index.html' && indexData
          ? indexData : await readTargetFile(relative);
        return [relative, { sha256: sha256(data), bytes: data.length }];
      } catch (error) {
        return [relative, { error: error.message }];
      }
    },
  );
  return Object.fromEntries(entries);
}

module.exports = {
  collectTargetHashes,
  collectWorkloadProvenance,
  commonJsDependencyGraph,
  fingerprintRepositoryFiles,
  linkedFirstPartyAssets,
  normalizeFirstPartyAssetPath,
  resolveCommonJsDependency,
  sha256,
};
