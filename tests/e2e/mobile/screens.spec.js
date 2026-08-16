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

const unallocatedCustomCourse = {
  Major: 'ZZZ',
  Code: '925',
  Course_Name: 'Fractional Unallocated Course',
  ECTS: '5',
  Engineering: 0,
  Basic_Science: 0,
  SU_credit: '2.5',
  Faculty: '',
  Faculty_Course: 'No',
  EL_Type: 'unknown',
};

const progressSection = (page, title) => page.locator(
  `#mProgress .m-prog-detail .ms-section:has(> .ms-header .ms-title:text-is("${title}"))`,
);

const expandProgressSection = async (section) => {
  await expect(section).toHaveCount(1);
  if (await section.evaluate((element) => element.classList.contains('m-sec-collapsed'))) {
    await section.locator(':scope > .ms-header').click();
  }
  await expect(section).not.toHaveClass(/m-sec-collapsed/);
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

    const term = await collapsed.locator('.date p').textContent();
    const collapsedCard = page.locator('.container_semester').filter({ hasText: term.trim() });
    const disclosure = page.getByRole('button', { name: `Expand ${term.trim()}` });
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await expect(disclosure).toHaveAttribute('aria-controls', /s\d+/);
    await disclosure.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.container_semester.m-collapsed')).toHaveCount(0);
    await expect(page.getByRole('button', { name: `Collapse ${term.trim()}` }))
      .toHaveAttribute('aria-expanded', 'true');

    // The larger header remains a touch/click target as well as the keyboard button.
    await collapsedCard.locator('.date p').click();
    await expect(collapsedCard).toHaveClass(/m-collapsed/);
    await collapsedCard.locator('.date p').click();
    await expect(collapsedCard).not.toHaveClass(/m-collapsed/);
  });

  test('semester move controls stay out of collapsed headers and do not toggle the card', async ({ page }) => {
    await seedPlan(page, PLAN);

    const collapsed = page.locator('.container_semester.m-collapsed');
    await expect(collapsed).toHaveCount(1);
    await expect(collapsed.locator('.semester-move-controls')).toBeHidden();

    await collapsed.locator('.date').click();
    await expect(page.locator('.container_semester.m-collapsed')).toHaveCount(0);
    // Spring is visually first in the newest-first mobile stack, so moving it
    // toward the second row is a Down action even though it enters the previous
    // slot in the persisted oldest-to-newest sequence.
    await page.getByRole('button', { name: 'Move Spring 2024-2025 down' }).click();

    await expect(page.locator('.container_semester.m-collapsed')).toHaveCount(0);
    await expect(page.locator('.container_semester .date p')).toHaveText([
      'Spring 2024-2025',
      'Fall 2024-2025',
    ]);
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

    // The compact one-row header's geometric centre can legitimately be an
    // action button. Activate the term label, which is the disclosure target a
    // user taps when they intend to collapse the semester.
    await semester.locator('.date p').click();
    await expect(semester).toHaveClass(/m-collapsed/);
    await expect(warning).toBeHidden();
  });

  test('expanded semester header controls stay contained and non-overlapping at 320px', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      customCourses: { CS: [unallocatedCustomCourse] },
      curriculum: [['MATH101', 'ZZZ925']],
      grades: [['A', 'A']],
      dates: ['Spring 2024-2025'],
    });

    const semester = page.locator('.container_semester').first();
    await expect(semester).toBeVisible();
    if (await semester.evaluate((element) => element.classList.contains('m-collapsed'))) {
      await semester.locator('.date').click();
    }
    await expect(semester).not.toHaveClass(/m-collapsed/);
    await expect(semester.locator('.date p')).toHaveText('Spring 2024-2025');
    await expect(semester.locator('.semester-move-controls')).toBeVisible();
    await expect(semester.locator('.total_credit_text')).toContainText('5.5 SU (2.5 N/A)');

    await testInfo.attach('expanded-semester-header-320', {
      body: await semester.screenshot({ animations: 'disabled' }),
      contentType: 'image/png',
    });

    const layout = await semester.evaluate((card) => {
      const date = card.querySelector('.date');
      const label = date && date.querySelector('p');
      const icons = date && date.querySelector('.icons');
      const chevron = date && date.querySelector('.m-sem-chevron');
      const credit = card.querySelector('.total_credit');
      const board = card.closest('.board');
      const visibleButtons = icons ? Array.from(icons.querySelectorAll('button:not(.m-sem-chevron)')).filter((button) => {
        const style = getComputedStyle(button);
        const box = button.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
      }) : [];
      const rect = (element) => {
        const box = element.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
      };
      const inside = (child, parent, tolerance = 1) => child.left >= parent.left - tolerance
        && child.right <= parent.right + tolerance
        && child.top >= parent.top - tolerance
        && child.bottom <= parent.bottom + tolerance;
      const overlapArea = (first, second) => Math.max(
        0, Math.min(first.right, second.right) - Math.max(first.left, second.left),
      ) * Math.max(
        0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top),
      );
      const cardBox = rect(card);
      const dateBox = rect(date);
      const labelBox = rect(label);
      const iconsBox = rect(icons);
      const chevronBox = rect(chevron);
      const creditBox = rect(credit);
      const buttonBoxes = visibleButtons.map(rect);
      return {
        visibleButtonCount: buttonBoxes.length,
        cardInViewport: cardBox.left >= -1 && cardBox.right <= window.innerWidth + 1,
        dateInCard: inside(dateBox, cardBox),
        labelInDate: inside(labelBox, dateBox),
        iconsInDate: inside(iconsBox, dateBox),
        chevronInDate: inside(chevronBox, dateBox),
        creditInCard: inside(creditBox, cardBox),
        buttonsInIcons: buttonBoxes.every((box) => inside(box, iconsBox)),
        buttonsInCard: buttonBoxes.every((box) => inside(box, cardBox)),
        labelIconsOverlap: overlapArea(labelBox, iconsBox),
        labelChevronOverlap: overlapArea(labelBox, chevronBox),
        labelCreditOverlap: overlapArea(labelBox, creditBox),
        iconsCreditOverlap: overlapArea(iconsBox, creditBox),
        cardOverflow: card.scrollWidth - card.clientWidth,
        dateOverflow: date.scrollWidth - date.clientWidth,
        boardOverflow: board.scrollWidth - board.clientWidth,
      };
    });

    expect(layout.visibleButtonCount, 'edit, two move buttons, and delete are measurable').toBe(4);
    expect(layout).toMatchObject({
      cardInViewport: true,
      dateInCard: true,
      labelInDate: true,
      iconsInDate: true,
      chevronInDate: true,
      creditInCard: true,
      buttonsInIcons: true,
      buttonsInCard: true,
    });
    expect(layout.labelIconsOverlap).toBeLessThanOrEqual(0.5);
    expect(layout.labelChevronOverlap).toBeLessThanOrEqual(0.5);
    expect(layout.labelCreditOverlap).toBeLessThanOrEqual(0.5);
    expect(layout.iconsCreditOverlap).toBeLessThanOrEqual(0.5);
    expect(layout.cardOverflow).toBeLessThanOrEqual(1);
    expect(layout.dateOverflow).toBeLessThanOrEqual(1);
    expect(layout.boardOverflow).toBeLessThanOrEqual(1);

    await semester.locator('.date p').click();
    await expect(semester).toHaveClass(/m-collapsed/);
    await expect(semester.locator('.total_credit_text')).toContainText('5.5 SU (2.5 N/A)');
    await semester.locator('.m-sem-chevron').evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished));
    });
    const collapsedLayout = await semester.evaluate((card) => {
      const rect = (element) => {
        const box = element.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
      };
      const inside = (child, parent, tolerance = 1) => child.left >= parent.left - tolerance
        && child.right <= parent.right + tolerance
        && child.top >= parent.top - tolerance
        && child.bottom <= parent.bottom + tolerance;
      const overlapArea = (first, second) => Math.max(
        0, Math.min(first.right, second.right) - Math.max(first.left, second.left),
      ) * Math.max(
        0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top),
      );
      const cardBox = rect(card);
      const date = card.querySelector('.date');
      const dateBox = rect(date);
      const labelBox = rect(date.querySelector('p'));
      const chevronBox = rect(date.querySelector('.m-sem-chevron'));
      const creditBox = rect(card.querySelector('.total_credit'));
      const board = card.closest('.board');
      return {
        creditInCard: inside(creditBox, cardBox),
        labelInDate: inside(labelBox, dateBox),
        chevronInDate: inside(chevronBox, dateBox),
        labelCreditOverlap: overlapArea(labelBox, creditBox),
        chevronCreditOverlap: overlapArea(chevronBox, creditBox),
        cardOverflow: card.scrollWidth - card.clientWidth,
        dateOverflow: date.scrollWidth - date.clientWidth,
        boardOverflow: board.scrollWidth - board.clientWidth,
      };
    });
    expect(collapsedLayout).toMatchObject({
      creditInCard: true,
      labelInDate: true,
      chevronInDate: true,
    });
    expect(collapsedLayout.labelCreditOverlap).toBeLessThanOrEqual(0.5);
    expect(collapsedLayout.chevronCreditOverlap).toBeLessThanOrEqual(0.5);
    expect(collapsedLayout.cardOverflow).toBeLessThanOrEqual(1);
    expect(collapsedLayout.dateOverflow).toBeLessThanOrEqual(1);
    expect(collapsedLayout.boardOverflow).toBeLessThanOrEqual(1);
  });

  test('progress adapter preserves the desktop overview data and detail CTA on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await seedPlan(page, PLAN);

    await page.locator('.m-nav-item[data-mtab="progress"]').click();
    await expect(page.locator('body')).toHaveAttribute('data-mobile-tab', 'progress');

    const card = page.locator('#mProgress .m-prog-card').first();
    await expect(card).toBeVisible({ timeout: 10000 });
    await expect(card.locator('.m-prog-title')).toHaveText('Computer Science and Engineering');
    await expect(card.locator('.m-prog-barrow')).toContainText('SU credits');
    await expect(card.locator('.m-prog-lbl').filter({ hasText: /^CGPA \(min\)$/ })).toHaveCount(1);
    await expect(card.locator('.m-prog-lbl').filter({ hasText: /^ECTS$/ })).toHaveCount(1);
    await expect(card.locator('.m-prog-bar')).toBeVisible();
    await expect(page.locator('#mProgress .m-prog-detail .major-summary'),
      'mobile detail extraction still reaches the CTA nested in the reorganized header')
      .toBeVisible({ timeout: 10000 });
    await expect(page.locator('.summary_modal_overlay'),
      'the off-screen desktop Summary adapter must clean up after extraction').toHaveCount(0);

    const dot = page.locator('#mProgress .m-prog-dot').first();
    await expect(dot).toHaveAttribute('aria-current', 'true');
    await expect(dot).toHaveAttribute('aria-controls', 'm-progress-program-0');

    const section = page.locator('#mProgress .m-prog-detail .ms-section').first();
    const header = section.locator(':scope > .ms-header');
    await expect(header).toHaveJSProperty('tagName', 'BUTTON');
    await expect(header).toHaveAttribute('aria-expanded', 'true');
    await expect(header).toHaveAttribute('aria-controls', /m-progress-section-0-content-/);
    await header.focus();
    await page.keyboard.press(' ');
    await expect(section).toHaveClass(/m-sec-collapsed/);
    await expect(header).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Enter');
    await expect(section).not.toHaveClass(/m-sec-collapsed/);
    await expect(header).toHaveAttribute('aria-expanded', 'true');
  });

  test('tag-dense progress course cards wrap without clipping or horizontal overlap', async ({ page }, testInfo) => {
    // Three Area courses consume CS's 9-SU allowance. The deliberately long
    // MATH484 row then overflows to Free and renders every metadata affordance:
    // progress state, BS, ENG, SU, and a "Counts as FREE" note.
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['CS414', 'CS415', 'CS435', 'MATH484']],
      grades: [['A', 'A', 'A', 'A']],
      dates: ['Fall 2024-2025'],
    });

    await page.locator('.m-nav-item[data-mtab="progress"]').click();
    await expect(page.locator('#mProgress .m-prog-detail .major-summary')).toBeVisible({ timeout: 10000 });
    const area = progressSection(page, 'AREA');
    await expandProgressSection(area);
    const row = area.locator('.ms-course:has(.ms-code:text-is("MATH484"))');
    await expect(row).toHaveCount(1);
    await expect(row.locator('.ms-state-chip')).toHaveText('Earned');
    await expect(row.locator('.ms-chip')).toHaveText(['BS 3', 'ENG 3', 'SU 3']);
    await expect(row.locator('.ms-meta-note')).toContainText('Counts as FREE');

    const defaultWidth = await page.evaluate(() => window.innerWidth);
    const widths = [...new Set([defaultWidth, 360, 320])];
    for (const width of widths) {
      await page.setViewportSize({ width, height: 800 });
      await expect(row).toBeVisible();
      await testInfo.attach(`tag-dense-progress-row-${width}`, {
        body: await row.screenshot({ animations: 'disabled' }),
        contentType: 'image/png',
      });

      const layout = await row.evaluate((card) => {
        const identity = card.querySelector('.ms-course-left');
        const meta = card.querySelector('.ms-meta');
        const section = card.closest('.ms-section');
        const screen = card.closest('#mProgress');
        const tokens = Array.from(meta.querySelectorAll('.ms-state-chip, .ms-chip, .ms-meta-note'));
        const rect = (element) => {
          const box = element.getBoundingClientRect();
          return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
        };
        const inside = (child, parent, tolerance = 1) => child.left >= parent.left - tolerance
          && child.right <= parent.right + tolerance
          && child.top >= parent.top - tolerance
          && child.bottom <= parent.bottom + tolerance;
        const overlapArea = (first, second) => Math.max(
          0, Math.min(first.right, second.right) - Math.max(first.left, second.left),
        ) * Math.max(
          0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top),
        );
        const cardBox = rect(card);
        const identityBox = rect(identity);
        const metaBox = rect(meta);
        const sectionBox = rect(section);
        const tokenBoxes = tokens.map(rect);
        return {
          tokenCount: tokenBoxes.length,
          cardInSection: inside(cardBox, sectionBox),
          cardInViewport: cardBox.left >= -1 && cardBox.right <= window.innerWidth + 1,
          metaInCard: inside(metaBox, cardBox),
          tokensInMeta: tokenBoxes.every((box) => inside(box, metaBox)),
          tokensInCard: tokenBoxes.every((box) => inside(box, cardBox)),
          tokensHaveArea: tokenBoxes.every((box) => box.right > box.left && box.bottom > box.top),
          identityMetaOverlap: overlapArea(identityBox, metaBox),
          cardOverflow: card.scrollWidth - card.clientWidth,
          metaOverflow: meta.scrollWidth - meta.clientWidth,
          screenOverflow: screen.scrollWidth - screen.clientWidth,
          documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });

      expect(layout.tokenCount, `${width}px fixture must retain all five metadata tokens`).toBe(5);
      expect(layout, `${width}px dense course-card containment`).toMatchObject({
        cardInSection: true,
        cardInViewport: true,
        metaInCard: true,
        tokensInMeta: true,
        tokensInCard: true,
        tokensHaveArea: true,
      });
      expect(layout.identityMetaOverlap, `${width}px identity/meta collision`).toBeLessThanOrEqual(0.5);
      expect(layout.cardOverflow, `${width}px course-card horizontal overflow`).toBeLessThanOrEqual(1);
      expect(layout.metaOverflow, `${width}px metadata horizontal overflow`).toBeLessThanOrEqual(1);
      expect(layout.screenOverflow, `${width}px Progress screen horizontal overflow`).toBeLessThanOrEqual(1);
      expect(layout.documentOverflow, `${width}px document horizontal overflow`).toBeLessThanOrEqual(1);
    }
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
    const dots = page.locator('#mProgress .m-prog-dot');
    await expect(dots).toHaveCount(2);
    await expect(dots.first()).toHaveAttribute('aria-current', 'true');
    await expect(dots.nth(1)).not.toHaveAttribute('aria-current', /.+/);
    await dots.nth(1).click();
    await expect(dots.nth(1)).toHaveAttribute('aria-current', 'true');
    await expect(dots.first()).not.toHaveAttribute('aria-current', /.+/);
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

  test('special-requirement counts stay inside their cards at 320px', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await seedPlan(page, {
      major: 'VACD',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['HART292', 'VA202']],
      grades: [['A', 'A']],
      dates: ['Fall 2024-2025'],
    });
    await page.locator('.m-nav-item[data-mtab="progress"]').click();
    await expect(page.locator('#mProgress .m-prog-detail .major-summary')).toBeVisible({ timeout: 10000 });

    const section = progressSection(page, 'SPECIAL REQUIREMENTS');
    await expandProgressSection(section);
    const group = section.locator('.ms-group').filter({
      has: page.locator('.ms-group-label', { hasText: /beginning\/basic language cap/i }),
    });
    await expect(group).toHaveCount(1);
    await expect(group.locator('.ms-group-count > *')).toHaveCount(4);
    await expect(group.locator('.ms-group-badge')).not.toBeEmpty();

    await testInfo.attach('special-requirement-language-cap-320', {
      body: await group.screenshot({ animations: 'disabled' }),
      contentType: 'image/png',
    });

    const layout = await group.evaluate((card) => {
      const top = card.querySelector('.ms-group-top');
      const labels = card.querySelector('.ms-group-labels');
      const count = card.querySelector('.ms-group-count');
      const screen = card.closest('#mProgress');
      const countItems = Array.from(count.children);
      const rect = (element) => {
        const box = element.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
      };
      const inside = (child, parent, tolerance = 1) => child.left >= parent.left - tolerance
        && child.right <= parent.right + tolerance
        && child.top >= parent.top - tolerance
        && child.bottom <= parent.bottom + tolerance;
      const overlapArea = (first, second) => Math.max(
        0, Math.min(first.right, second.right) - Math.max(first.left, second.left),
      ) * Math.max(
        0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top),
      );
      const cardBox = rect(card);
      const topBox = rect(top);
      const labelsBox = rect(labels);
      const countBox = rect(count);
      const itemBoxes = countItems.map(rect);
      return {
        countItemCount: itemBoxes.length,
        cardInViewport: cardBox.left >= -1 && cardBox.right <= window.innerWidth + 1,
        topInCard: inside(topBox, cardBox),
        countInTop: inside(countBox, topBox),
        countInCard: inside(countBox, cardBox),
        itemsInCount: itemBoxes.every((box) => inside(box, countBox)),
        itemsInCard: itemBoxes.every((box) => inside(box, cardBox)),
        itemsHaveArea: itemBoxes.every((box) => box.right > box.left && box.bottom > box.top),
        labelsCountOverlap: overlapArea(labelsBox, countBox),
        cardOverflow: card.scrollWidth - card.clientWidth,
        topOverflow: top.scrollWidth - top.clientWidth,
        countOverflow: count.scrollWidth - count.clientWidth,
        screenOverflow: screen.scrollWidth - screen.clientWidth,
      };
    });

    expect(layout.countItemCount).toBe(4);
    expect(layout).toMatchObject({
      cardInViewport: true,
      topInCard: true,
      countInTop: true,
      countInCard: true,
      itemsInCount: true,
      itemsInCard: true,
      itemsHaveArea: true,
    });
    expect(layout.labelsCountOverlap).toBeLessThanOrEqual(0.5);
    expect(layout.cardOverflow).toBeLessThanOrEqual(1);
    expect(layout.topOverflow).toBeLessThanOrEqual(1);
    expect(layout.countOverflow).toBeLessThanOrEqual(1);
    expect(layout.screenOverflow).toBeLessThanOrEqual(1);
  });
});
