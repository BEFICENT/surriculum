'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { summarizeRun } = require('./compare');

function escapeCsv(value) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function buildSummary(manifest, iterations, budgetResults) {
  const statuses = {};
  for (const record of iterations) statuses[record.status] = (statuses[record.status] || 0) + 1;
  return {
    schemaVersion: 1,
    runId: manifest?.runId || iterations[0]?.runId || null,
    generatedAt: new Date().toISOString(),
    manifest: manifest || {},
    iterationCount: iterations.length,
    statuses,
    groups: summarizeRun(iterations),
    budgets: budgetResults || null,
  };
}

function rowsFromSummary(summary) {
  return summary.groups.flatMap((group) => Object.entries(group.metrics).map(([metric, stats]) => ({
    group: group.key,
    iterations: group.records,
    metric,
    ...stats,
  })));
}

function renderCsv(summary) {
  const columns = ['group', 'iterations', 'metric', 'count', 'min', 'median', 'p75', 'p90', 'p95', 'p99', 'max', 'mean', 'standardDeviation', 'mad'];
  return `${columns.join(',')}\n${rowsFromSummary(summary).map((row) => columns.map((column) => escapeCsv(row[column])).join(',')).join('\n')}\n`;
}

function renderMarkdown(summary) {
  const lines = [
    `# Performance report: ${summary.runId || 'unknown run'}`,
    '',
    `Generated: ${summary.generatedAt}`,
    '',
    `Iterations: ${summary.iterationCount} (${Object.entries(summary.statuses).map(([name, count]) => `${name}: ${count}`).join(', ') || 'none'})`,
    '',
  ];
  if (summary.budgets) {
    lines.push(`Budget mode: ${summary.budgets.mode}; blocking failures: ${summary.budgets.summary?.blocking || 0}.`, '');
    const failures = (summary.budgets.results || []).filter((result) => result.status === 'failed');
    if (failures.length) {
      lines.push('| Budget | Metric | Severity | Blocking | Reason |', '| --- | --- | --- | --- | --- |');
      for (const failure of failures) {
        lines.push(`| ${failure.id} | ${failure.metric} | ${failure.severity} | ${failure.blocking ? 'yes' : 'no'} | ${String(failure.reason || '').replace(/\|/g, '\\|')} |`);
      }
      lines.push('');
    }
  }
  for (const group of summary.groups) {
    lines.push(`## ${group.key}`, '', `Recorded iterations: ${group.records}`, '', '| Metric | Median | p95 | MAD | Min | Max |', '| --- | ---: | ---: | ---: | ---: | ---: |');
    for (const [metric, stats] of Object.entries(group.metrics)) {
      lines.push(`| ${metric} | ${stats.median} | ${stats.p95} | ${stats.mad} | ${stats.min} | ${stats.max} |`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function renderHtml(summary) {
  const budgetRows = (summary.budgets?.results || []).filter((item) => item.status === 'failed').map((item) => (
    `<tr><td>${escapeHtml(item.id)}</td><td>${escapeHtml(item.metric)}</td><td>${escapeHtml(item.severity)}</td><td>${item.blocking ? 'yes' : 'no'}</td><td>${escapeHtml(item.reason || '')}</td></tr>`
  )).join('');
  const groups = summary.groups.map((group) => {
    const rows = Object.entries(group.metrics).map(([metric, stats]) => (
      `<tr><td>${escapeHtml(metric)}</td><td>${stats.median}</td><td>${stats.p95}</td><td>${stats.mad}</td><td>${stats.min}</td><td>${stats.max}</td></tr>`
    )).join('');
    return `<section><h2>${escapeHtml(group.key)}</h2><p>${group.records} recorded iterations</p><table><thead><tr><th>Metric</th><th>Median</th><th>p95</th><th>MAD</th><th>Min</th><th>Max</th></tr></thead><tbody>${rows}</tbody></table></section>`;
  }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Performance report ${escapeHtml(summary.runId || '')}</title><style>body{font:14px system-ui;max-width:1200px;margin:32px auto;padding:0 20px;color:#17202a}table{border-collapse:collapse;width:100%;margin-bottom:28px}th,td{border:1px solid #d9dee3;padding:7px;text-align:left}th{background:#f4f6f7}h1,h2{line-height:1.2}.fail{color:#a11}</style></head><body><h1>Performance report: ${escapeHtml(summary.runId || 'unknown run')}</h1><p>Generated ${escapeHtml(summary.generatedAt)} · ${summary.iterationCount} iterations</p>${budgetRows ? `<h2 class="fail">Budget failures</h2><table><thead><tr><th>Budget</th><th>Metric</th><th>Severity</th><th>Blocking</th><th>Reason</th></tr></thead><tbody>${budgetRows}</tbody></table>` : ''}${groups}</body></html>`;
}

/** buildReport({manifest, iterations, budgetResults}) -> all report formats. */
function buildReport({ manifest = {}, iterations = [], budgetResults = null }) {
  const summary = buildSummary(manifest, iterations, budgetResults);
  return {
    summary,
    json: `${JSON.stringify(summary, null, 2)}\n`,
    csv: renderCsv(summary),
    markdown: renderMarkdown(summary),
    html: renderHtml(summary),
  };
}

/** Write summary.json/csv and report.md/html through an ArtifactStore. */
function writeReports(store, input) {
  const report = buildReport(input);
  store.writeJson('summary.json', report.summary);
  store.writeText('summary.csv', report.csv);
  store.writeText('report.md', report.markdown);
  store.writeText('report.html', report.html);
  return report;
}

if (require.main === module) {
  try {
    const runDirectory = path.resolve(process.argv[2] || '');
    if (!process.argv[2]) throw new Error('Usage: node tests/perf/report.js <run-directory>');
    const manifestPath = path.join(runDirectory, 'manifest.json');
    const iterationsPath = path.join(runDirectory, 'iterations.ndjson');
    const { ArtifactStore, readNdjson } = require('./lib/artifacts');
    const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
    const store = new ArtifactStore({
      baseDirectory: path.dirname(runDirectory),
      runId: path.basename(runDirectory),
      allowExisting: true,
    }).initialize();
    writeReports(store, { manifest, iterations: readNdjson(iterationsPath) });
  } catch (error) {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  }
}

module.exports = { buildReport, buildSummary, renderCsv, renderHtml, renderMarkdown, writeReports };
