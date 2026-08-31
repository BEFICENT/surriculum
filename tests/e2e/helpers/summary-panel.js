'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { expect } = require('../fixtures');

// Shared fixtures for displaySummary(), the progress view behind the
// "Summary" button and the screen students read to see where they stand.
// The assertion that matters is that it AGREES WITH THE ENGINE. The summary
// renders its own card from `sem.total*` and its own requirement lookup
// (lookupReq), separate from the one canGraduate uses (getReq) — and this
// codebase's recurring bug has been two parallel implementations of one rule
// drifting apart. A summary that quietly disagreed with the graduation check
// would be worse than either being wrong alone: the student would be told two
// different things.
//
// Frozen term 202401.
const TERM_NAME = 'Fall 2024-2025';
const ROOT = path.resolve(__dirname, '..', '..', '..');
const REQS = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, 'requirements', '202401.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((d) => [d.major, d]),
);

const openSummary = async (page) => {
  await page.locator('.summary').click();
  const overlay = page.locator('.summary_modal_overlay');
  await expect(overlay).toBeVisible({ timeout: 10000 });
  return overlay;
};

const programCard = (root, kind, code) => root.locator(
  `.summary_program_card[data-program-kind="${kind}"][data-program-code="${code}"]`,
);

const programTab = (root, kind, code) => root.locator(
  `.summary_program_tab[data-program-kind="${kind}"][data-program-code="${code}"]`,
);

const livePastCurrentFuture = async (page) => {
  await page.goto('/');
  return page.evaluate(() => {
    const current = String(window.currentTermCode || '');
    const year = Number(current.slice(0, 4));
    const suffix = current.slice(4);
    const pastCode = suffix === '03' ? `${year}02` : (suffix === '02' ? `${year}01` : `${year - 1}03`);
    const futureCode = suffix === '01' ? `${year}02` : (suffix === '02' ? `${year}03` : `${year + 1}01`);
    return {
      past: window.termCodeToName(pastCode),
      current: window.currentTermName,
      future: window.termCodeToName(futureCode),
    };
  });
};

// Parse the visible average and credit rows back out so the test reads what the
// student reads, while retaining the machine-readable graduation threshold.
const readCard = (page) => page.evaluate(() => {
  const card = document.querySelector('.summary_modal');
  if (!card) return null;
  const rows = {};
  card.querySelectorAll('.summary_metric').forEach((metric) => {
    const label = (metric.querySelector('.summary_metric_head span') || {}).textContent || '';
    if (['gpa', 'pgpa', 'main_pgpa'].includes(metric.dataset.metric) && label) {
      rows[label.trim()] = {
        kind: 'average',
        value: metric.dataset.value === '' ? NaN : Number(metric.dataset.value),
        scale: Number(metric.dataset.limit),
        threshold: Number(metric.dataset.threshold),
        met: metric.dataset.met === 'true',
      };
      return;
    }
    if (label) rows[label.trim()] = { value: Number(metric.dataset.projected), limit: Number(metric.dataset.limit) };
  });
  return { title: (card.querySelector('.summary_modal_title') || {}).textContent || '', rows };
});

const modelTotals = (page) => page.evaluate(() => {
  const s = window.curriculum.semesters;
  const sum = (f) => s.reduce((a, x) => a + (x[f] || 0), 0);
  const gpaCredits = sum('totalGPACredits');
  const progress = window.curriculum.getGraduationProgress('main');
  return {
    total: sum('totalCredit'),
    ects: sum('totalECTS'),
    university: sum('totalUniversity'),
    required: sum('totalRequired'),
    core: sum('totalCore'),
    area: sum('totalArea'),
    free: sum('totalFree'),
    science: sum('totalScience'),
    engineering: sum('totalEngineering'),
    gpa: gpaCredits ? Number((sum('totalGPA') / gpaCredits).toFixed(3)) : 0,
    pgpa: Number(progress.pgpa.value),
    averageThreshold: progress.averageThreshold,
  };
});

module.exports = {
  TERM_NAME,
  REQS,
  openSummary,
  programCard,
  programTab,
  livePastCurrentFuture,
  readCard,
  modelTotals,
};
