'use strict';

/** Return only finite numeric samples. */
function finiteSamples(values) {
  return (Array.isArray(values) ? values : []).filter(Number.isFinite);
}

/** Quantile using linear interpolation between adjacent sorted samples. */
function percentile(values, probability) {
  const samples = finiteSamples(values).sort((left, right) => left - right);
  if (!samples.length) return null;
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new RangeError('probability must be between 0 and 1');
  }
  if (samples.length === 1) return samples[0];
  const position = (samples.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const fraction = position - lower;
  return samples[lower] + ((samples[upper] - samples[lower]) * fraction);
}

function median(values) {
  return percentile(values, 0.5);
}

/** Median absolute deviation, a robust measure of run-to-run noise. */
function mad(values, center = median(values)) {
  const samples = finiteSamples(values);
  if (!samples.length || !Number.isFinite(center)) return null;
  return median(samples.map((value) => Math.abs(value - center)));
}

function mean(values) {
  const samples = finiteSamples(values);
  if (!samples.length) return null;
  return samples.reduce((sum, value) => sum + value, 0) / samples.length;
}

function standardDeviation(values) {
  const samples = finiteSamples(values);
  if (!samples.length) return null;
  const average = mean(samples);
  const variance = samples.reduce((sum, value) => sum + ((value - average) ** 2), 0) / samples.length;
  return Math.sqrt(variance);
}

function round(value, digits = 3) {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * Summarize a sample distribution without assuming it is normally distributed.
 * This is the standard summary stored for timing, frame, memory, and byte metrics.
 */
function summarize(values, options = {}) {
  const samples = finiteSamples(values);
  const digits = Number.isInteger(options.digits) ? options.digits : 3;
  if (!samples.length) {
    return {
      count: 0,
      min: null,
      median: null,
      p75: null,
      p90: null,
      p95: null,
      p99: null,
      max: null,
      mean: null,
      standardDeviation: null,
      mad: null,
    };
  }
  const middle = median(samples);
  return {
    count: samples.length,
    min: round(Math.min(...samples), digits),
    median: round(middle, digits),
    p75: round(percentile(samples, 0.75), digits),
    p90: round(percentile(samples, 0.9), digits),
    p95: round(percentile(samples, 0.95), digits),
    p99: round(percentile(samples, 0.99), digits),
    max: round(Math.max(...samples), digits),
    mean: round(mean(samples), digits),
    standardDeviation: round(standardDeviation(samples), digits),
    mad: round(mad(samples, middle), digits),
  };
}

/** Candidate change from baseline. Positive values are increases. */
function change(baseline, candidate) {
  if (!Number.isFinite(baseline) || !Number.isFinite(candidate)) {
    return { absolute: null, relative: null, percent: null };
  }
  const absolute = candidate - baseline;
  const relative = baseline === 0 ? (absolute === 0 ? 0 : null) : absolute / Math.abs(baseline);
  return {
    absolute,
    relative,
    percent: relative === null ? null : relative * 100,
  };
}

module.exports = {
  change,
  finiteSamples,
  mad,
  mean,
  median,
  percentile,
  round,
  standardDeviation,
  summarize,
};
