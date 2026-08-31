'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { startServer } = require('./server');

const DEFAULT_LIVE_URL = 'https://beficent.github.io/surriculum/';

/** Normalize a target id/URL into a stable descriptor without starting it. */
function resolveTarget(input = 'local-artifact', options = {}) {
  if (input && typeof input === 'object') return resolveTarget(input.id || input.url, { ...options, ...input });
  const value = String(input || 'local-artifact');
  if (/^https?:\/\//i.test(value)) {
    const parsed = new URL(value);
    const host = parsed.hostname.replace(/[^a-zA-Z0-9.-]+/g, '-').slice(0, 48) || 'url';
    const digest = crypto.createHash('sha256').update(value).digest('hex').slice(0, 8);
    return { id: options.id || `url-${host}-${digest}`, kind: 'live', url: value };
  }
  if (value === 'live') return { id: 'live', kind: 'live', url: options.liveUrl || DEFAULT_LIVE_URL };
  if (value === 'local-source') return { id: value, kind: value, mount: '/surriculum/' };
  if (value === 'local-artifact') return { id: value, kind: value, mount: '/surriculum/' };
  throw new Error(`unsupported performance target: ${value}`);
}

function runArtifactBuild(repoRoot, outputDirectory, options = {}) {
  const python = options.python || process.env.PYTHON || 'python';
  const result = spawnSync(python, [
    '-m',
    'tools.release.build_pages_artifact',
    '--output', outputDirectory,
    '--skip-mounted-smoke',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Pages artifact build failed (${result.status}):\n${result.stdout || ''}${result.stderr || ''}`);
  }
  return { stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function safelyRemoveArtifact(directory) {
  const resolved = path.resolve(directory);
  const tempRoot = path.resolve(os.tmpdir());
  if (!resolved.startsWith(`${tempRoot}${path.sep}`) || !path.basename(resolved).startsWith('surriculum-perf-artifact-')) {
    throw new Error(`refusing to remove an unowned artifact directory: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3 });
}

/**
 * Start/resolve a complete target and return {id, url, close()}.
 * `local-artifact` builds the same allowlisted Pages bundle used in production.
 */
async function startTarget(input = 'local-artifact', options = {}) {
  const descriptor = resolveTarget(input, options);
  if (descriptor.kind === 'live') {
    return { ...descriptor, async close() {} };
  }
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, '..', '..', '..'));
  if (descriptor.kind === 'local-source') {
    const server = await startServer({ root: repoRoot, mount: descriptor.mount, port: options.port });
    return { ...descriptor, url: server.url, root: repoRoot, server, close: () => server.close() };
  }

  const ownsArtifact = !options.artifactDirectory;
  const artifactDirectory = options.artifactDirectory
    ? path.resolve(options.artifactDirectory)
    : fs.mkdtempSync(path.join(os.tmpdir(), 'surriculum-perf-artifact-'));
  if (!options.skipBuild) runArtifactBuild(repoRoot, artifactDirectory, options);
  let server;
  try {
    server = await startServer({ root: artifactDirectory, mount: descriptor.mount, port: options.port });
  } catch (error) {
    if (ownsArtifact) safelyRemoveArtifact(artifactDirectory);
    throw error;
  }
  let closed = false;
  return {
    ...descriptor,
    url: server.url,
    root: artifactDirectory,
    server,
    async close() {
      if (closed) return;
      closed = true;
      try {
        await server.close();
      } finally {
        if (ownsArtifact) safelyRemoveArtifact(artifactDirectory);
      }
    },
  };
}

module.exports = {
  DEFAULT_LIVE_URL,
  resolveTarget,
  runArtifactBuild,
  startServer,
  startTarget,
};
