'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const { ROOT, loadBaseline, relativePath } = require('./helpers');

const baseline = loadBaseline().artifact;

function findPython() {
  const candidates = process.env.PYTHON
    ? [process.env.PYTHON]
    : process.platform === 'win32'
      ? ['python', 'py']
      : ['python3', 'python'];
  for (const candidate of candidates) {
    const args = candidate === 'py' ? ['-3', '--version'] : ['--version'];
    const result = spawnSync(candidate, args, { encoding: 'utf8' });
    if (!result.error && result.status === 0) {
      return { command: candidate, prefix: candidate === 'py' ? ['-3'] : [] };
    }
  }
  throw new Error(`Python was not found (tried ${candidates.join(', ')}).`);
}

function collectFiles(directory) {
  const files = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile()) files.push(child);
    }
  };
  visit(directory);
  return files;
}

function groupFor(relative) {
  const first = relative.split('/')[0];
  if (['assets', 'courses', 'requirements', 'scripts'].includes(first)) return first;
  return 'app-shell';
}

function assertWithin(label, actual, maximum) {
  assert.ok(
    actual <= maximum,
    `${label} is ${actual.toLocaleString()} (budget ${maximum.toLocaleString()}). ` +
      `Reduce the artifact or update ${relativePath(path.join(__dirname, 'baseline.json'))} ` +
      'with a measured transfer/startup justification.'
  );
}

test('validated Pages artifact stays within reviewed file and byte budgets', { timeout: 120_000 }, () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'surriculum-perf-artifact-'));
  const output = path.join(temporary, 'site');
  try {
    const python = findPython();
    const build = spawnSync(
      python.command,
      python.prefix.concat([
        '-m',
        'tools.release.build_pages_artifact',
        '--output', output,
        '--skip-mounted-smoke'
      ]),
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
    );
    assert.equal(
      build.status,
      0,
      `Pages artifact build failed.\nstdout:\n${build.stdout}\nstderr:\n${build.stderr}`
    );

    const files = collectFiles(output);
    const entries = files.map((file) => ({
      relative: path.relative(output, file).split(path.sep).join('/'),
      bytes: fs.statSync(file).size
    }));
    const totalBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
    assertWithin('Artifact file count', entries.length, baseline.maxFiles);
    assertWithin('Artifact bytes', totalBytes, baseline.maxTotalBytes);

    const groups = new Map();
    for (const entry of entries) {
      const group = groupFor(entry.relative);
      const current = groups.get(group) || { files: 0, bytes: 0 };
      current.files += 1;
      current.bytes += entry.bytes;
      groups.set(group, current);
    }
    for (const [group, budget] of Object.entries(baseline.maxGroups)) {
      const actual = groups.get(group) || { files: 0, bytes: 0 };
      assertWithin(`${group} file count`, actual.files, budget.files);
      assertWithin(`${group} bytes`, actual.bytes, budget.bytes);
    }

    const byPath = new Map(entries.map((entry) => [entry.relative, entry.bytes]));
    for (const [relative, maximum] of Object.entries(baseline.maxFileBytes)) {
      assert.ok(byPath.has(relative), `Budgeted production file is missing: ${relative}`);
      assertWithin(relative, byPath.get(relative), maximum);
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
