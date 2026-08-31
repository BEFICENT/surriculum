'use strict';

const SCHEMA_VERSION = 1;
const VALID_STATUSES = new Set(['passed', 'failed', 'skipped', 'error']);

function nonEmptyString(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

/**
 * Create the stable envelope written for every measured iteration.
 * Scenario-specific values belong in `metrics`, `diagnostics`, and `metadata`.
 */
function createIterationRecord(input) {
  if (!input || typeof input !== 'object') throw new TypeError('iteration input is required');
  const status = input.status || 'passed';
  if (!VALID_STATUSES.has(status)) throw new TypeError(`unsupported iteration status: ${status}`);
  const iteration = Number(input.iteration);
  if (!Number.isInteger(iteration) || iteration < 0) {
    throw new TypeError('iteration must be a non-negative integer');
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    type: 'performance-iteration',
    runId: nonEmptyString(input.runId, 'runId'),
    scenarioId: nonEmptyString(input.scenarioId, 'scenarioId'),
    iteration,
    timestamp: input.timestamp || new Date().toISOString(),
    status,
    target: input.target || null,
    browser: input.browser || null,
    fixtureId: input.fixtureId || null,
    environmentKey: input.environmentKey || null,
    metrics: input.metrics && typeof input.metrics === 'object' ? input.metrics : {},
    diagnostics: input.diagnostics && typeof input.diagnostics === 'object' ? input.diagnostics : {},
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
    error: input.error || null,
  };
}

function validateIterationRecord(record) {
  const errors = [];
  if (!record || typeof record !== 'object') return ['record must be an object'];
  if (record.schemaVersion !== SCHEMA_VERSION) errors.push(`schemaVersion must be ${SCHEMA_VERSION}`);
  if (record.type !== 'performance-iteration') errors.push('type must be performance-iteration');
  for (const field of ['runId', 'scenarioId']) {
    if (typeof record[field] !== 'string' || !record[field]) errors.push(`${field} is required`);
  }
  if (!Number.isInteger(record.iteration) || record.iteration < 0) errors.push('iteration is invalid');
  if (!VALID_STATUSES.has(record.status)) errors.push('status is invalid');
  if (!record.metrics || typeof record.metrics !== 'object' || Array.isArray(record.metrics)) {
    errors.push('metrics must be an object');
  }
  return errors;
}

/** Stable comparison key; excludes commit/run identifiers by design. */
function comparisonKey(record, options = {}) {
  const viewport = record?.metadata?.viewport || record?.browser?.viewport || {};
  const power = record?.metadata?.powerSource || record?.environment?.power?.source || 'unknown';
  const workload = options.ignoreWorkloadHash
    ? 'workload-provenance-override'
    : record?.metadata?.workloadHash || 'missing-workload-provenance';
  return [
    record?.scenarioId || 'unknown-scenario',
    record?.environmentKey || 'unkeyed-environment',
    record?.target?.id || record?.target || 'unknown-target',
    record?.browser?.id || record?.browser?.name || 'unknown-browser',
    record?.fixtureId || 'no-fixture',
    record?.metadata?.fixtureHash || 'unknown-fixture-hash',
    workload,
    `${viewport.width || 0}x${viewport.height || 0}@${viewport.deviceScaleFactor || 1}`,
    power,
    record?.metadata?.cache || 'unknown-cache',
    record?.metadata?.serviceWorkers || 'unknown-service-worker-mode',
    `${record?.metadata?.cpuThrottle || 1}x-cpu`,
    record?.browser?.headless ? 'headless' : 'headed',
  ].join('|');
}

module.exports = {
  SCHEMA_VERSION,
  comparisonKey,
  createIterationRecord,
  validateIterationRecord,
};
