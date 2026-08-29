'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createIterationRecord, validateIterationRecord } = require('./schema');

function safeSegment(value, fallback = 'run') {
  const cleaned = String(value || fallback)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return cleaned || fallback;
}

function defaultRunId(label = 'perf') {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${safeSegment(label)}-${stamp}-${crypto.randomBytes(3).toString('hex')}`;
}

function jsonReplacer(_key, value) {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  return value;
}

function stringify(value, spacing = 2) {
  return JSON.stringify(value, jsonReplacer, spacing);
}

/**
 * Durable writer for one performance run.
 * Each iteration is appended and fsynced before control returns, so an aborted
 * battery or soak run keeps every fully completed iteration.
 */
class ArtifactStore {
  constructor(options = {}) {
    const baseDirectory = path.resolve(options.baseDirectory || path.join(process.cwd(), 'test-results', 'perf'));
    this.runId = safeSegment(options.runId || defaultRunId(options.label));
    this.directory = path.resolve(baseDirectory, this.runId);
    if (path.dirname(this.directory) !== baseDirectory) throw new Error('unsafe artifact run id');
    this.iterationsPath = path.join(this.directory, 'iterations.ndjson');
    this.allowExisting = options.allowExisting === true;
    this._initialized = false;
  }

  initialize(manifest = null) {
    if (!this._initialized && !this.allowExisting && fs.existsSync(this.directory)
        && fs.readdirSync(this.directory).length > 0) {
      throw new Error(`performance run directory already exists and is not empty: ${this.directory}`);
    }
    fs.mkdirSync(this.directory, { recursive: true });
    this._initialized = true;
    if (manifest) this.writeJson('manifest.json', { ...manifest, runId: this.runId });
    return this;
  }

  artifactPath(relativePath) {
    const candidate = path.resolve(this.directory, relativePath);
    if (candidate !== this.directory && !candidate.startsWith(`${this.directory}${path.sep}`)) {
      throw new Error(`artifact path escapes run directory: ${relativePath}`);
    }
    return candidate;
  }

  ensureInitialized() {
    if (!this._initialized) this.initialize();
  }

  appendIteration(input) {
    this.ensureInitialized();
    const record = input?.type === 'performance-iteration' ? input : createIterationRecord({ ...input, runId: input?.runId || this.runId });
    const errors = validateIterationRecord(record);
    if (errors.length) throw new TypeError(`invalid performance iteration: ${errors.join('; ')}`);
    const handle = fs.openSync(this.iterationsPath, 'a');
    try {
      fs.writeSync(handle, `${stringify(record, 0)}\n`, null, 'utf8');
      fs.fsyncSync(handle);
    } finally {
      fs.closeSync(handle);
    }
    return record;
  }

  /** Write JSON via a temporary sibling and atomic rename. */
  writeJson(relativePath, value) {
    return this.writeText(relativePath, `${stringify(value, 2)}\n`);
  }

  writeText(relativePath, value) {
    this.ensureInitialized();
    const destination = this.artifactPath(relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
    fs.writeFileSync(temporary, String(value), 'utf8');
    try {
      fs.renameSync(temporary, destination);
    } catch (error) {
      if (process.platform !== 'win32' || !fs.existsSync(destination)) throw error;
      fs.rmSync(destination);
      fs.renameSync(temporary, destination);
    }
    return destination;
  }

  copyFile(sourcePath, relativePath) {
    this.ensureInitialized();
    const destination = this.artifactPath(relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(sourcePath, destination);
    return destination;
  }

  readIterations(options = {}) {
    return readNdjson(this.iterationsPath, options);
  }
}

/** Read completed NDJSON records; optionally tolerate only a truncated final line. */
function readNdjson(filePath, options = {}) {
  if (!fs.existsSync(filePath)) return [];
  const source = fs.readFileSync(filePath, 'utf8');
  const lines = source.split(/\r?\n/);
  const records = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    try {
      records.push(JSON.parse(line));
    } catch (error) {
      const isLastContent = !lines.slice(index + 1).some((item) => item.trim());
      if (options.ignoreTrailingPartial !== false && isLastContent) break;
      throw new SyntaxError(`invalid NDJSON at ${filePath}:${index + 1}: ${error.message}`);
    }
  }
  return records;
}

module.exports = {
  ArtifactStore,
  defaultRunId,
  readNdjson,
  safeSegment,
  stringify,
};
