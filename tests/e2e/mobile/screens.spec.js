'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');

const PLAN = {
  major: 'CS',
  entryTerm: 'Fall 2024-2025',
  curriculum: [['MATH101', 'NS101'], ['MATH102']],
  grades: [['A', 'A'], ['A']],
  dates: ['Fall 2024-2025', 'Spring 2024-2025'],
};

test.describe('mobile screens', () => {
  test('planner is a collapsible accordion of semesters', async ({ page }) => {
    await seedPlan(page, PLAN);
    await expect(page.locator('body')).toHaveClass(/is-mobile/);

    // Each semester card gets a chevron affordance, and (with no current term
    // among the seeded ones) exactly one is left expanded, the rest collapsed.
    await expect(page.locator('.m-sem-chevron').first()).toBeVisible();
    const collapsed = page.locator('.container_semester.m-collapsed');
    await expect(collapsed).toHaveCount(1);

    // Tapping the collapsed semester's header expands it.
    await collapsed.locator('.date').click();
    await expect(page.locator('.container_semester.m-collapsed')).toHaveCount(0);
  });

  test('planner warnings stay inside the course card and collapse with the semester', async ({ page }) => {
    await seedPlan(page, {
      major: 'EE',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['EE200']],
      grades: [['']],
      dates: ['Spring 2024-2025'],
    });
    await page.evaluate(() => window.courseRequisites.refreshPlannerWarnings());

    const semester = page.locator('.container_semester').first();
    const course = semester.locator('.course:has(.course_code:text-is("EE200"))');
    const warning = course.locator('.planner-requisite-warning[data-warning-kind="corequisite"]');
    await expect(warning).toContainText('EE202');
    const contained = await course.evaluate((card) => {
      const note = card.querySelector('.planner-requisite-warning');
      const cardBox = card.getBoundingClientRect();
      const noteBox = note && note.getBoundingClientRect();
      return !!noteBox && noteBox.left >= cardBox.left && noteBox.right <= cardBox.right;
    });
    expect(contained).toBe(true);

    await semester.locator('.date').click();
    await expect(semester).toHaveClass(/m-collapsed/);
    await expect(warning).toBeHidden();
  });

  test('progress screen renders a program card with a completion bar', async ({ page }) => {
    await seedPlan(page, PLAN);

    await page.locator('.m-nav-item[data-mtab="progress"]').click();
    await expect(page.locator('body')).toHaveAttribute('data-mobile-tab', 'progress');

    const card = page.locator('#mProgress .m-prog-card').first();
    await expect(card).toBeVisible({ timeout: 10000 });
    await expect(card.locator('.m-prog-title')).not.toBeEmpty();
    await expect(card.locator('.m-prog-bar')).toBeVisible();
  });

  test('future-only grades show unavailable actual GPA for majors and minors', async ({ page }) => {
    await page.goto('/');
    const future = await page.evaluate(() => {
      const current = String(window.currentTermCode || '');
      const year = Number(current.slice(0, 4));
      const suffix = current.slice(4);
      const code = suffix === '01' ? `${year}02` : (suffix === '02' ? `${year}03` : `${year + 1}01`);
      return window.termCodeToName(code);
    });
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      minor1: 'ANALY-MINOR',
      entryTermMinor1: 'Fall 2024-2025',
      curriculum: [['MATH101']],
      grades: [['D']],
      dates: [future],
    });

    await page.locator('.m-nav-item[data-mtab="progress"]').click();
    const cards = page.locator('#mProgress .m-prog-card');
    await expect(cards).toHaveCount(2);
    const statWithLabel = (card, label) => card.locator('.m-prog-stat').filter({
      has: page.locator('.m-prog-lbl', { hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }),
    });
    const majorCgpa = statWithLabel(cards.first(), 'CGPA (min)');
    const majorPgpa = statWithLabel(cards.first(), 'PGPA (min)');
    await expect(majorCgpa.locator('.m-prog-val')).toHaveText('N/A / 2');
    await expect(majorPgpa.locator('.m-prog-val')).toHaveText('N/A / 2');

    const minorCgpa = statWithLabel(cards.nth(1), 'CGPA (min)');
    const minorPgpa = statWithLabel(cards.nth(1), 'PGPA (min)');
    await expect(minorCgpa.locator('.m-prog-val')).toHaveText('N/A / 2.72');
    await expect(minorPgpa.locator('.m-prog-val')).toHaveText('N/A / 2.72');
  });

  test('progress bar exposes earned, current, future, and needs-grade segments', async ({ page }) => {
    await page.goto('/');
    const terms = await page.evaluate(() => {
      const current = String(window.currentTermCode || '');
      const year = Number(current.slice(0, 4));
      const suffix = current.slice(4);
      const pastCode = suffix === '03' ? `${year}02` : (suffix === '02' ? `${year}01` : `${year - 1}03`);
      const futureCode = suffix === '01' ? `${year}02` : (suffix === '02' ? `${year}03` : `${year + 1}01`);
      return { past: window.termCodeToName(pastCode), current: window.currentTermName, future: window.termCodeToName(futureCode) };
    });
    await seedPlan(page, {
      major: 'CS', entryTerm: 'Fall 2024-2025',
      curriculum: [['MATH102', 'NS101'], ['MATH101', 'IF100'], ['NS102']],
      grades: [['A', ''], ['A', ''], ['A']],
      dates: [terms.current, terms.past, terms.future],
    });

    await page.locator('.m-nav-item[data-mtab="progress"]').click();
    const bar = page.locator('#mProgress .m-prog-card').first().locator('.m-prog-bar.is-segmented');
    await expect(bar).toBeVisible({ timeout: 10000 });
    await expect(bar.locator('.m-prog-fill.is-earned')).toHaveCount(1);
    await expect(bar.locator('.m-prog-fill.is-current')).toHaveCount(1);
    await expect(bar.locator('.m-prog-fill.is-future')).toHaveCount(1);
    await expect(bar.locator('.m-prog-fill.is-unverified')).toHaveCount(1);
    await expect(bar).toHaveAttribute('aria-label', /earned.*current.*future.*needs grade/i);
    await expect(page.locator('#mProgress .m-prog-breakdown').first()).toContainText(/earned/i);
  });

  test('minor overflow preserves earned progress across base pools', async ({ page }) => {
    await page.goto('/');
    const terms = await page.evaluate(() => {
      const current = String(window.currentTermCode || '');
      const year = Number(current.slice(0, 4));
      const suffix = current.slice(4);
      const pastCode = suffix === '03' ? `${year}02` : (suffix === '02' ? `${year}01` : `${year - 1}03`);
      const futureCode = suffix === '01' ? `${year}02` : (suffix === '02' ? `${year}03` : `${year + 1}01`);
      return { past: window.termCodeToName(pastCode), future: window.termCodeToName(futureCode) };
    });
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      minor1: 'FIN-MINOR',
      entryTermMinor1: 'Fall 2024-2025',
      curriculum: [['ACC301'], ['FIN401', 'FIN402', 'FIN403', 'FIN404', 'FIN405']],
      grades: [['A'], ['A', 'A', 'A', 'A', 'A']],
      dates: [terms.past, terms.future],
    });

    await page.locator('.m-nav-item[data-mtab="progress"]').click();
    const card = page.locator('#mProgress .m-prog-card').filter({ hasText: 'Finance Minor' });
    await expect(card).toHaveCount(1);
    const area = card.locator('.m-prog-stat').filter({ hasText: 'Area' });
    await expect(area.locator('.m-prog-val')).toContainText('3 earned');
    await expect(area.locator('.m-prog-val')).toContainText('3 projected / 3');
    const core = card.locator('.m-prog-stat').filter({ hasText: 'Core' });
    await expect(core.locator('.m-prog-val')).toContainText('0 earned');
    await expect(core.locator('.m-prog-val')).toContainText('12 projected / 12');
    await expect(card).not.toContainText(/-\d/);

    const split = await card.evaluate((el) => {
      const bar = el.querySelector('.m-prog-bar.is-segmented');
      return Array.from(bar ? bar.querySelectorAll('.m-prog-fill') : [])
        .map((part) => Number.parseFloat(part.style.width));
    });
    expect(split.length).toBeGreaterThan(0);
    for (const width of split) expect(width).toBeGreaterThanOrEqual(0);
  });

  test('special-requirement groups collapse with their section', async ({ page }) => {
    await seedPlan(page, {
      major: 'VACD',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['HART292', 'VA202']],
      grades: [['A', 'A']],
      dates: ['Fall 2024-2025'],
    });
    await page.locator('.m-nav-item[data-mtab="progress"]').click();
    const section = page.locator('#mProgress .ms-groups-section');
    await expect(section).toBeVisible({ timeout: 10000 });
    if (!(await section.evaluate((el) => el.classList.contains('m-sec-collapsed')))) {
      await section.locator(':scope > .ms-header').click();
    }
    await expect(section).toHaveClass(/m-sec-collapsed/);
    await expect(section.locator(':scope > .ms-group-list')).toBeHidden();
  });
});
