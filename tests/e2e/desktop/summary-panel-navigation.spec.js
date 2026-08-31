'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');
const { seedGradPlan, CS_PASSING_PLAN } = require('../helpers/passing-plan');
const {
  TERM_NAME,
  openSummary,
  programCard,
  programTab,
} = require('../helpers/summary-panel');

test.describe('summary panel', () => {
  test('program tabs expose one selected overview card and support keyboard navigation', async ({ page }) => {
    await page.setViewportSize({ width: 821, height: 700 });
    await seedPlan(page, {
      major: 'CS',
      entryTerm: TERM_NAME,
      doubleMajor: 'DSA',
      entryTermDM: TERM_NAME,
      minor1: 'FIN-MINOR',
      entryTermMinor1: TERM_NAME,
      minor2: 'ANALY-MINOR',
      entryTermMinor2: TERM_NAME,
      minor3: 'PHIL-MINOR',
      entryTermMinor3: TERM_NAME,
      curriculum: [['MATH101'], ['CS201']],
      grades: [['A'], ['A']],
      dates: [TERM_NAME, 'Spring 2024-2025'],
    });

    const overlay = await openSummary(page);
    const surface = overlay.locator('.summary_overlay_content');
    const tablist = surface.locator('.summary_program_tabs');
    const tabs = tablist.locator('.summary_program_tab');
    const cards = surface.locator('.summary_program_card');
    const expected = [
      { kind: 'main', code: 'CS' },
      { kind: 'dm', code: 'DSA' },
      { kind: 'minor', code: 'FIN-MINOR' },
      { kind: 'minor', code: 'ANALY-MINOR' },
      { kind: 'minor', code: 'PHIL-MINOR' },
    ];

    await expect(surface).toHaveAttribute('data-program-count', '5');
    await expect(page.locator('body')).not.toHaveClass(/is-mobile/);
    await expect(tablist).toHaveAttribute('role', 'tablist');
    await expect(tabs).toHaveCount(expected.length);
    await expect(cards).toHaveCount(expected.length);

    expect(await tabs.evaluateAll((elements) => elements.map((tab) => ({
      kind: tab.dataset.programKind,
      code: tab.dataset.programCode,
    })))).toEqual(expected);
    expect(await cards.evaluateAll((elements) => elements.map((card) => ({
      kind: card.dataset.programKind,
      code: card.dataset.programCode,
    })))).toEqual(expected);

    const expectSelectedProgram = async (selectedKind, selectedCode) => {
      for (const program of expected) {
        const selected = program.kind === selectedKind && program.code === selectedCode;
        const tab = programTab(surface, program.kind, program.code);
        const card = programCard(surface, program.kind, program.code);
        await expect(tab).toHaveAttribute('role', 'tab');
        await expect(tab).toHaveAttribute('aria-selected', String(selected));
        await expect(tab).toHaveAttribute('tabindex', selected ? '0' : '-1');
        if (selected) {
          await expect(tab).toBeFocused();
          await expect(card).toHaveClass(/is-active/);
          await expect(card).toBeVisible();
        } else {
          await expect(card).not.toHaveClass(/is-active/);
          await expect(card).toBeHidden();
        }
      }
      await expect(surface.locator('.summary_program_card.is-active')).toHaveCount(1);
    };
    const expectFocusedTabInsideRail = async () => {
      await expect.poll(() => tablist.evaluate((rail) => {
        const focusedTab = document.activeElement;
        if (!(focusedTab instanceof HTMLElement) || !focusedTab.matches('.summary_program_tab')) {
          return false;
        }
        const railBox = rail.getBoundingClientRect();
        const tabBox = focusedTab.getBoundingClientRect();
        return tabBox.left >= railBox.left - 1 && tabBox.right <= railBox.right + 1;
      }), {
        message: 'keyboard navigation should scroll the focused tab fully into the 821px rail viewport',
      }).toBe(true);
    };

    const mainTab = programTab(surface, 'main', 'CS');
    await mainTab.focus();
    await expectSelectedProgram('main', 'CS');

    await page.keyboard.press('ArrowRight');
    await expectSelectedProgram('dm', 'DSA');

    await page.keyboard.press('End');
    await expectSelectedProgram('minor', 'PHIL-MINOR');
    await expectFocusedTabInsideRail();

    await page.keyboard.press('Home');
    await expectSelectedProgram('main', 'CS');

    await page.keyboard.press('ArrowLeft');
    await expectSelectedProgram('minor', 'PHIL-MINOR');
    await expectFocusedTabInsideRail();

    await page.keyboard.press('ArrowRight');
    await expectSelectedProgram('main', 'CS');
    await expectFocusedTabInsideRail();

    await programTab(surface, 'minor', 'ANALY-MINOR').click();
    await expectSelectedProgram('minor', 'ANALY-MINOR');
  });

  test('a single-program summary hides its redundant rail and keeps a complete keyboard path', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await seedGradPlan(page, {});

    const trigger = page.locator('.summary');
    await trigger.focus();
    await trigger.click();

    const overlay = page.locator('.summary_modal_overlay');
    const surface = overlay.locator('.summary_overlay_content');
    const tablist = surface.locator('.summary_program_tabs');
    const onlyTab = tablist.locator('.summary_program_tab');
    const card = surface.locator('.summary_program_card.is-active');
    const scrollRegion = surface.locator('[data-summary-scroll-region="overview"]');
    const close = surface.locator('.summary_surface_close');

    await expect(overlay).toBeVisible();
    await expect(surface).toHaveAttribute('data-program-count', '1');
    await expect(surface).not.toHaveClass(/is-multiple/);
    await expect(tablist).toHaveAttribute('aria-hidden', 'true');
    await expect(tablist, 'one program does not need a visible selector rail').toBeHidden();
    await expect(onlyTab).toHaveCount(1);
    await expect(onlyTab).toHaveAttribute('tabindex', '-1');
    await expect(card).toHaveCount(1);
    await expect(card).toBeVisible();
    await expect(close).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(scrollRegion, 'the hidden tab must be skipped in the keyboard order').toBeFocused();
    await page.keyboard.press('Tab');
    const details = card.locator('.summary_detail_btn');
    await expect(details).toBeFocused();
    await page.keyboard.press('Enter');

    const detailPanel = surface.locator('.summary_major_panel');
    await expect(detailPanel).toBeVisible();
    const back = detailPanel.locator('.summary_back_btn');
    await expect(back).toBeFocused();
    await back.click();

    const title = card.locator('.summary_modal_title');
    await expect(title, 'Back has no visible program tab to focus in a single-program summary').toBeFocused();
    await expect(onlyTab).not.toBeFocused();

    await page.keyboard.press('Escape');
    await expect(overlay).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('multi-program overview follows the responsive rail and section-layout contract', async ({ page }) => {
    await page.setViewportSize({ width: 821, height: 600 });
    await seedPlan(page, {
      major: 'CS',
      entryTerm: TERM_NAME,
      doubleMajor: 'DSA',
      entryTermDM: TERM_NAME,
      minor1: 'ANALY-MINOR',
      entryTermMinor1: TERM_NAME,
      curriculum: [['MATH101'], ['CS201']],
      grades: [['A'], ['A']],
      dates: [TERM_NAME, 'Spring 2024-2025'],
    });

    const pageStateBefore = await page.evaluate(() => {
      const board = document.querySelector('.board');
      return {
        document: {
          scrollX: window.scrollX,
          scrollY: window.scrollY,
          htmlOverflow: getComputedStyle(document.documentElement).overflow,
          bodyOverflow: getComputedStyle(document.body).overflow,
        },
        boardOverflowY: getComputedStyle(board).overflowY,
      };
    });
    const programs = [
      { kind: 'main', code: 'CS' },
      { kind: 'dm', code: 'DSA' },
      { kind: 'minor', code: 'ANALY-MINOR' },
    ];
    const viewports = [
      { width: 821, height: 500, singleColumn: true },
      { width: 1024, height: 500, singleColumn: false },
      { width: 1024, height: 768, singleColumn: false },
      { width: 1180, height: 768, singleColumn: false },
      { width: 1280, height: 720, singleColumn: false },
      { width: 1440, height: 500, singleColumn: false },
      { width: 1440, height: 900, singleColumn: false },
    ];

    for (const viewport of viewports) {
      const expectedOrientation = viewport.width >= 1180 && viewport.height >= 620
        ? 'vertical'
        : 'horizontal';
      const existing = page.locator('.summary_modal_overlay');
      if (await existing.count()) {
        await existing.locator('.summary_surface_close').click();
        await expect(existing).toBeHidden();
      }
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const overlay = await openSummary(page);
      const surface = overlay.locator('.summary_overlay_content');
      const header = surface.locator('.summary_header_row');
      const tablist = surface.locator('.summary_program_tabs');
      const scrollRegion = surface.locator('[data-summary-scroll-region="overview"]');

      await expect(page.locator('body')).not.toHaveClass(/is-mobile/);
      await expect(surface).toHaveClass(/is-multiple/);
      await expect(surface).toHaveAttribute('data-program-count', '3');
      await expect(tablist).toBeVisible();
      await expect(tablist).toHaveAttribute('role', 'tablist');
      await expect(tablist).toHaveAttribute('aria-hidden', 'false');
      await expect(tablist).toHaveAttribute('aria-orientation', expectedOrientation);
      await expect(scrollRegion).toHaveAttribute('role', 'region');
      await expect(scrollRegion).toHaveAttribute('aria-label', 'Program progress overview');
      await expect(page.locator('.board')).toHaveCSS('overflow-y', 'hidden');

      for (const program of programs) {
        const tab = programTab(surface, program.kind, program.code);
        const card = programCard(surface, program.kind, program.code);
        await tab.click();
        await expect(tab).toHaveAttribute('aria-selected', 'true');
        await expect(card).toHaveClass(/is-active/);
        await expect(card).toBeVisible();
        await expect(surface.locator('.summary_program_card.is-active')).toHaveCount(1);
        await scrollRegion.evaluate((element) => { element.scrollTop = 0; });
        await page.evaluate(() => new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }));

        const layout = await surface.evaluate((root, expected) => {
          const rect = (element) => {
            const box = element.getBoundingClientRect();
            return {
              left: box.left, right: box.right, top: box.top, bottom: box.bottom,
              width: box.width, height: box.height,
            };
          };
          const visible = (element) => {
            const styles = getComputedStyle(element);
            const box = element.getBoundingClientRect();
            return styles.display !== 'none' && styles.visibility !== 'hidden'
              && box.width > 0 && box.height > 0;
          };
          const insideX = (child, parent, tolerance = 1) => (
            child.left >= parent.left - tolerance && child.right <= parent.right + tolerance
          );
          const inside = (child, parent, tolerance = 1) => (
            insideX(child, parent, tolerance)
            && child.top >= parent.top - tolerance && child.bottom <= parent.bottom + tolerance
          );
          const overlapArea = (first, second) => Math.max(
            0, Math.min(first.right, second.right) - Math.max(first.left, second.left),
          ) * Math.max(
            0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top),
          );
          const surfaceBox = rect(root);
          const headerElement = root.querySelector('.summary_header_row');
          const tabsElement = root.querySelector('.summary_program_tabs');
          const region = root.querySelector('[data-summary-scroll-region="overview"]');
          const card = root.querySelector('.summary_program_card.is-active');
          const identity = card.querySelector('.summary_overview_identity');
          const hero = card.querySelector('.summary_overview_hero');
          const snapshot = card.querySelector('.summary_overview_snapshot');
          const requirements = card.querySelector('.summary_overview_requirements');
          const sections = [identity, hero, snapshot, requirements];
          const headerBox = rect(headerElement);
          const tabsBox = rect(tabsElement);
          const regionBox = rect(region);
          const cardBox = rect(card);
          const identityBox = rect(identity);
          const heroBox = rect(hero);
          const snapshotBox = rect(snapshot);
          const requirementsBox = rect(requirements);
          const identityCopy = identity.querySelector(':scope > .summary_program_identity_copy');
          const heading = identityCopy.querySelector(':scope > .summary_program_card_heading');
          const meta = heading.querySelector(':scope > .summary_program_meta');
          const title = heading.querySelector(':scope > h4.summary_modal_title');
          const context = identityCopy.querySelector(':scope > .summary_program_card_context');
          const term = context.querySelector(':scope > .summary_program_term');
          const footer = identity.querySelector(':scope > .summary_program_card_footer');
          const identityCopyBox = rect(identityCopy);
          const headingBox = rect(heading);
          const metaBox = rect(meta);
          const titleBox = rect(title);
          const contextBox = rect(context);
          const termBox = rect(term);
          const footerBox = footer ? rect(footer) : null;
          const detailButton = footer && footer.querySelector(':scope > .summary_detail_btn');
          const detailButtonBox = detailButton ? rect(detailButton) : null;
          const metaChildBoxes = Array.from(meta.children).map(rect);
          const metaChildCenters = metaChildBoxes.map((box) => (box.top + box.bottom) / 2);
          const metricHeadCollisions = Array.from(card.querySelectorAll('.summary_metric_head'))
            .filter(visible)
            .map((head) => {
              const label = head.querySelector('span');
              const value = head.querySelector('strong');
              return label && value ? overlapArea(rect(label), rect(value)) : 0;
            });
          const actualVerticalOwners = [root, ...root.querySelectorAll('*')]
            .filter(visible)
            .filter((element) => {
              const overflowY = getComputedStyle(element).overflowY;
              return ['auto', 'scroll'].includes(overflowY)
                && element.scrollHeight > element.clientHeight + 1;
            });

          return {
            surfaceInViewport: surfaceBox.left >= -1 && surfaceBox.right <= window.innerWidth + 1
              && surfaceBox.top >= -1 && surfaceBox.bottom <= window.innerHeight + 1,
            headerInsideSurface: insideX(headerBox, surfaceBox),
            headerBeforeWorkspace: headerBox.bottom <= Math.min(tabsBox.top, regionBox.top) + 1,
            railDirection: getComputedStyle(tabsElement).flexDirection,
            horizontalRailPlacement: tabsBox.bottom <= regionBox.top + 1,
            verticalRailPlacement: tabsBox.right <= regionBox.left + 1
              && Math.abs(tabsBox.top - regionBox.top) <= 1,
            cardInsideRegion: insideX(cardBox, regionBox),
            sectionCount: sections.filter(Boolean).length,
            sectionsInsideCard: sections.every((section) => section && insideX(rect(section), cardBox)),
            identityStructure: {
              tag: identity.tagName,
              children: Array.from(identity.children).map((child) => child.classList[0]),
              copyChildren: Array.from(identityCopy.children).map((child) => child.classList[0]),
              headingChildren: Array.from(heading.children).map((child) => child.classList[0]),
              metaChildren: Array.from(meta.children).map((child) => child.classList[0]),
              titleTag: title.tagName,
              contextChildren: Array.from(context.children).map((child) => child.classList[0]),
            },
            identityChildrenInside: [identityCopyBox, footerBox]
              .every((box) => box && inside(box, identityBox)),
            identityContentInside: [headingBox, metaBox, titleBox, contextBox, termBox, detailButtonBox]
              .every((box) => box && inside(box, identityBox)),
            metaSingleRow: metaChildCenters.length > 0
              && Math.max(...metaChildCenters) - Math.min(...metaChildCenters) <= 1,
            titleAndTermLeftAligned: Math.abs(titleBox.left - termBox.left) <= 1
              && Math.abs(titleBox.left - identityCopyBox.left) <= 1,
            wideActionPlacement: footerBox && identityCopyBox.right <= footerBox.left + 1
              && Math.abs(footerBox.right - identityBox.right) <= 1,
            compactActionPlacement: footerBox && identityCopyBox.bottom <= footerBox.top + 1
              && Math.abs(footerBox.left - identityBox.left) <= 1,
            identityBeforeContent: identityBox.bottom <= Math.min(heroBox.top, snapshotBox.top) + 1,
            requirementAfterLeadSections:
              requirementsBox.top >= Math.max(heroBox.bottom, snapshotBox.bottom) - 1,
            leadSectionsStacked: heroBox.bottom <= snapshotBox.top + 1
              && Math.abs(heroBox.left - snapshotBox.left) <= 1
              && Math.abs(heroBox.right - snapshotBox.right) <= 1,
            leadSectionsSideBySide: heroBox.right <= snapshotBox.left + 1
              && Math.abs(heroBox.top - snapshotBox.top) <= 1,
            identityActionOverlap: footerBox ? overlapArea(identityCopyBox, footerBox) : 0,
            maxMetricHeadOverlap: metricHeadCollisions.length
              ? Math.max(...metricHeadCollisions) : 0,
            detailButtonTarget: detailButtonBox
              ? { width: detailButtonBox.width, height: detailButtonBox.height } : null,
            regionOverflowY: getComputedStyle(region).overflowY,
            overlayOverflowY: getComputedStyle(root.closest('.summary_modal_overlay')).overflowY,
            surfaceOverflowY: getComputedStyle(root).overflowY,
            actualOwnerCount: actualVerticalOwners.length,
            actualOwnersAreOverview: actualVerticalOwners.every(
              (element) => element.dataset.summaryScrollRegion === 'overview',
            ),
            regionCanScroll: region.scrollHeight > region.clientHeight + 1,
            regionHorizontalOverflow: region.scrollWidth - region.clientWidth,
            cardHorizontalOverflow: card.scrollWidth - card.clientWidth,
            identityHorizontalOverflow: identity.scrollWidth - identity.clientWidth,
            identityCopyHorizontalOverflow: identityCopy.scrollWidth - identityCopy.clientWidth,
            metaHorizontalOverflow: meta.scrollWidth - meta.clientWidth,
            sectionHorizontalOverflow: Math.max(...sections.map(
              (section) => section.scrollWidth - section.clientWidth,
            )),
            documentHorizontalOverflow:
              document.documentElement.scrollWidth - document.documentElement.clientWidth,
            programKind: card.dataset.programKind,
            programCode: card.dataset.programCode,
            expected,
          };
        }, viewport);

        expect(layout, [
          viewport.width + 'x' + viewport.height,
          program.kind + ':' + program.code,
          'overview geometry',
        ].join(' ')).toMatchObject({
          surfaceInViewport: true,
          headerInsideSurface: true,
          headerBeforeWorkspace: true,
          railDirection: expectedOrientation === 'vertical' ? 'column' : 'row',
          cardInsideRegion: true,
          sectionCount: 4,
          sectionsInsideCard: true,
          identityStructure: {
            tag: 'HEADER',
            children: ['summary_program_identity_copy', 'summary_program_card_footer'],
            copyChildren: ['summary_program_card_heading', 'summary_program_card_context'],
            headingChildren: ['summary_program_meta', 'summary_modal_title'],
            metaChildren: ['summary_program_role', 'summary_program_code', 'summary_program_status'],
            titleTag: 'H4',
            contextChildren: ['summary_program_term'],
          },
          identityChildrenInside: true,
          identityContentInside: true,
          metaSingleRow: true,
          titleAndTermLeftAligned: true,
          identityBeforeContent: true,
          requirementAfterLeadSections: true,
          actualOwnersAreOverview: true,
          regionOverflowY: 'auto',
          overlayOverflowY: 'hidden',
          surfaceOverflowY: 'hidden',
          programKind: program.kind,
          programCode: program.code,
        });
        if (expectedOrientation === 'horizontal') {
          expect(layout.horizontalRailPlacement, 'horizontal program rail belongs above content').toBe(true);
        } else {
          expect(layout.verticalRailPlacement, 'vertical program rail belongs beside content').toBe(true);
        }
        if (viewport.singleColumn) {
          expect(layout.leadSectionsStacked, '821px overview lead sections should stack').toBe(true);
        } else {
          expect(layout.leadSectionsSideBySide, 'wider overview lead sections should sit side by side').toBe(true);
        }
        if (viewport.width <= 900) {
          expect(layout.compactActionPlacement, 'compact header CTA belongs below and left').toBe(true);
        } else {
          expect(layout.wideActionPlacement, 'desktop header CTA belongs to the right of identity copy').toBe(true);
        }
        expect(layout.identityActionOverlap, 'identity copy and detailed-summary action must not collide')
          .toBeLessThanOrEqual(0.5);
        expect(layout.maxMetricHeadOverlap, 'metric labels and values must not collide')
          .toBeLessThanOrEqual(0.5);
        expect(layout.detailButtonTarget).not.toBeNull();
        expect(layout.detailButtonTarget.width, 'detailed-summary action needs a usable target')
          .toBeGreaterThanOrEqual(210);
        expect(layout.detailButtonTarget.height, 'detailed-summary action needs a usable target')
          .toBeGreaterThanOrEqual(42);
        expect(layout.actualOwnerCount, 'there may be at most one active vertical scroll owner')
          .toBeLessThanOrEqual(1);
        expect(layout.regionHorizontalOverflow, 'the overview must not overflow horizontally')
          .toBeLessThanOrEqual(1);
        expect(layout.cardHorizontalOverflow, 'the active card must not clip horizontally')
          .toBeLessThanOrEqual(1);
        expect(layout.identityHorizontalOverflow, 'the reorganized identity header must not clip')
          .toBeLessThanOrEqual(1);
        expect(layout.identityCopyHorizontalOverflow, 'identity copy must stay inside its header column')
          .toBeLessThanOrEqual(1);
        expect(layout.metaHorizontalOverflow, 'role, code, and status must stay inside their row')
          .toBeLessThanOrEqual(1);
        expect(layout.sectionHorizontalOverflow, 'overview sections must not clip horizontally')
          .toBeLessThanOrEqual(1);
        expect(layout.documentHorizontalOverflow, 'Summary must not widen the document')
          .toBeLessThanOrEqual(1);

        if (program.kind === 'main' && layout.regionCanScroll) {
          const fixedTops = await Promise.all([
            header.evaluate((element) => element.getBoundingClientRect().top),
            tablist.evaluate((element) => element.getBoundingClientRect().top),
          ]);
          await scrollRegion.evaluate((element) => { element.scrollTop = element.scrollHeight; });
          await expect.poll(() => scrollRegion.evaluate((element) => element.scrollTop), {
            message: 'the overview card should travel inside its declared scroller',
          }).toBeGreaterThan(0);
          expect(await Promise.all([
            header.evaluate((element) => element.getBoundingClientRect().top),
            tablist.evaluate((element) => element.getBoundingClientRect().top),
          ]), 'surface header and program rail remain fixed while overview content scrolls')
            .toEqual(fixedTops);
        }
        if (program.kind === 'main') {
          const details = card.locator('.summary_detail_btn');
          await details.scrollIntoViewIfNeeded();
          await expect(details, 'the header CTA must be reachable in the overview scroller').toBeVisible();
          expect(await details.evaluate((button) => {
            const region = button.closest('[data-summary-scroll-region="overview"]');
            const buttonBox = button.getBoundingClientRect();
            const regionBox = region.getBoundingClientRect();
            return buttonBox.left >= regionBox.left - 1 && buttonBox.right <= regionBox.right + 1
              && buttonBox.top >= regionBox.top - 1 && buttonBox.bottom <= regionBox.bottom + 1
              && buttonBox.top >= -1 && buttonBox.bottom <= window.innerHeight + 1;
          }), 'the header CTA must be fully inside the active scroll viewport').toBe(true);
          await details.click();
          const detailPanel = surface.locator('.summary_major_panel');
          await expect(detailPanel, 'the reachable header CTA must open requirement details').toBeVisible();
          await detailPanel.locator('.summary_back_btn').first().click();
          await expect(card, 'Back should restore the same selected overview card').toBeVisible();
        }
      }

      await overlay.locator('.summary_surface_close').click();
      await expect(overlay).toBeHidden();
    }

    expect(await page.evaluate(() => {
      const board = document.querySelector('.board');
      return {
        document: {
          scrollX: window.scrollX,
          scrollY: window.scrollY,
          htmlOverflow: getComputedStyle(document.documentElement).overflow,
          bodyOverflow: getComputedStyle(document.body).overflow,
        },
        boardOverflowY: getComputedStyle(board).overflowY,
      };
    }), 'closing Summary restores the background and document state').toEqual(pageStateBefore);
  });

  test('main-major, double-major, and minor detail views return to the selected tab', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: TERM_NAME,
      doubleMajor: 'DSA',
      entryTermDM: TERM_NAME,
      minor1: 'ANALY-MINOR',
      entryTermMinor1: TERM_NAME,
      curriculum: [['MATH101'], ['CS201']],
      grades: [['A'], ['A']],
      dates: [TERM_NAME, 'Spring 2024-2025'],
    });

    const overlay = await openSummary(page);
    const surface = overlay.locator('.summary_overlay_content');
    const scrollRegion = surface.locator('[data-summary-scroll-region="overview"]');

    const exerciseDetail = async ({ kind, code, panelSelector, title }) => {
      const tab = programTab(surface, kind, code);
      const card = programCard(surface, kind, code);
      await tab.click();
      await expect(tab).toHaveAttribute('aria-selected', 'true');
      await expect(card).toHaveClass(/is-active/);
      await expect(card).toBeVisible();
      const overviewPanelId = await card.getAttribute('id');
      const tabId = await tab.getAttribute('id');
      expect(overviewPanelId, `${kind}:${code} overview panel needs a stable id`).toBeTruthy();
      expect(tabId, `${kind}:${code} tab needs a stable id`).toBeTruthy();
      await expect(tab).toHaveAttribute('aria-controls', overviewPanelId);

      await card.locator('.summary_detail_btn').click();
      const panel = surface.locator(panelSelector);
      await expect(scrollRegion, 'the overview should hide while details are open').toBeHidden();
      await expect(panel).toBeVisible();
      await expect(panel.locator('.summary_minor_panel_title')).toContainText(title);
      const backButton = panel.locator('.summary_back_btn');
      const detailPanelId = await panel.getAttribute('id');
      expect(detailPanelId, `${kind}:${code} detail panel needs a stable id`).toBeTruthy();
      await expect(panel).toHaveAttribute('role', 'tabpanel');
      await expect(panel).toHaveAttribute('aria-labelledby', tabId);
      await expect(tab, 'the selected tab must control the panel currently exposed to assistive technology')
        .toHaveAttribute('aria-controls', detailPanelId);
      await expect(backButton, 'detail entry should move focus to the visible Back control').toBeFocused();

      await backButton.click();
      await expect(panel).toBeHidden();
      await expect(scrollRegion).toBeVisible();
      await expect(tab).toHaveAttribute('aria-selected', 'true');
      await expect(tab).toHaveAttribute('tabindex', '0');
      await expect(tab, 'Back should return focus to the selected program tab').toBeFocused();
      await expect(tab, 'the selected tab must control its overview panel again after Back')
        .toHaveAttribute('aria-controls', overviewPanelId);
      await expect(card).toHaveClass(/is-active/);
      await expect(card).toBeVisible();
      await expect(surface.locator('.summary_program_card.is-active')).toHaveCount(1);
    };

    await exerciseDetail({
      kind: 'main',
      code: 'CS',
      panelSelector: '.summary_major_panel',
      title: 'Computer Science and Engineering',
    });
    await exerciseDetail({
      kind: 'dm',
      code: 'DSA',
      panelSelector: '.summary_major_panel',
      title: 'Data Science and Analytics',
    });
    await exerciseDetail({
      kind: 'minor',
      code: 'ANALY-MINOR',
      panelSelector: '.summary_minor_panel',
      title: 'ANALY-MINOR',
    });
  });

  test('major and minor details use sticky section navigation as their sole scroll owner', async ({ page }) => {
    await page.setViewportSize({ width: 821, height: 600 });
    await seedPlan(page, {
      major: 'CS',
      entryTerm: TERM_NAME,
      doubleMajor: 'DSA',
      entryTermDM: TERM_NAME,
      minor1: 'ANALY-MINOR',
      entryTermMinor1: TERM_NAME,
      curriculum: [['MATH101'], ['CS201']],
      grades: [['A'], ['A']],
      dates: [TERM_NAME, 'Spring 2024-2025'],
    });

    const programs = [
      {
        kind: 'main', code: 'CS', panelSelector: '.summary_major_panel',
        scrollRegion: 'major-detail',
      },
      {
        kind: 'minor', code: 'ANALY-MINOR', panelSelector: '.summary_minor_panel',
        scrollRegion: 'minor-detail',
      },
    ];

    for (const viewport of [
      { width: 821, height: 600 },
      { width: 1280, height: 600 },
    ]) {
      const existing = page.locator('.summary_modal_overlay');
      if (await existing.count()) {
        await existing.locator('.summary_surface_close').click();
        await expect(existing).toBeHidden();
      }
      await page.setViewportSize(viewport);
      const overlay = await openSummary(page);
      const surface = overlay.locator('.summary_overlay_content');

      for (const program of programs) {
        const tab = programTab(surface, program.kind, program.code);
        const card = programCard(surface, program.kind, program.code);
        await tab.click();
        await card.locator('.summary_detail_btn').click();

        const panel = surface.locator(program.panelSelector);
        const header = panel.locator('.summary_minor_panel_header');
        const nav = panel.locator('.summary_detail_section_nav');
        const body = panel.locator('.summary_minor_panel_body');
        const links = nav.locator('.summary_detail_section_link');
        await expect(panel).toBeVisible();
        await expect(panel).toHaveAttribute('data-summary-scroll-region', program.scrollRegion);
        await expect(nav).toBeVisible();
        await expect(nav).toHaveAttribute('aria-label', 'Requirement sections');
        await expect(links).not.toHaveCount(0);
        expect(await links.count(), `${program.kind} detail needs more than one navigable requirement section`)
          .toBeGreaterThan(1);

        const relationships = await links.evaluateAll((buttons) => buttons.map((button) => {
          const targetId = button.getAttribute('aria-controls') || '';
          const target = targetId ? document.getElementById(targetId) : null;
          return {
            hasLabel: !!String(button.textContent || '').trim(),
            targetId,
            targetIsSection: !!target && target.classList.contains('ms-section'),
            targetInSamePanel: !!target && target.closest('.summary_scroll_region')
              === button.closest('.summary_scroll_region'),
          };
        }));
        for (const relationship of relationships) {
          expect(relationship.hasLabel).toBe(true);
          expect(relationship.targetId).toBeTruthy();
          expect(relationship.targetIsSection).toBe(true);
          expect(relationship.targetInSamePanel).toBe(true);
        }

        await panel.evaluate((element) => { element.scrollTop = 0; });
        await page.evaluate(() => new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }));
        const geometry = await surface.evaluate((root, panelSelector) => {
          const rect = (element) => {
            const box = element.getBoundingClientRect();
            return {
              left: box.left, right: box.right, top: box.top, bottom: box.bottom,
              width: box.width, height: box.height,
            };
          };
          const visible = (element) => {
            const styles = getComputedStyle(element);
            const box = element.getBoundingClientRect();
            return styles.display !== 'none' && styles.visibility !== 'hidden'
              && box.width > 0 && box.height > 0;
          };
          const insideX = (child, parent, tolerance = 1) => (
            child.left >= parent.left - tolerance && child.right <= parent.right + tolerance
          );
          const panel = root.querySelector(panelSelector);
          const header = panel.querySelector('.summary_minor_panel_header');
          const nav = panel.querySelector('.summary_detail_section_nav');
          const body = panel.querySelector('.summary_minor_panel_body');
          const panelBox = rect(panel);
          const headerBox = rect(header);
          const navBox = rect(nav);
          const bodyBox = rect(body);
          const sectionBoxes = Array.from(body.querySelectorAll('.ms-section')).map(rect);
          const linkBoxes = Array.from(nav.querySelectorAll('.summary_detail_section_link')).map(rect);
          const actualVerticalOwners = [root, ...root.querySelectorAll('*')]
            .filter(visible)
            .filter((element) => {
              const overflowY = getComputedStyle(element).overflowY;
              return ['auto', 'scroll'].includes(overflowY)
                && element.scrollHeight > element.clientHeight + 1;
            });
          return {
            panelInSurface: insideX(panelBox, rect(root)),
            headerInPanel: insideX(headerBox, panelBox),
            navInPanel: insideX(navBox, panelBox),
            bodyInPanel: insideX(bodyBox, panelBox),
            sectionsInBody: sectionBoxes.every((box) => insideX(box, bodyBox)),
            headerBeforeNav: headerBox.bottom <= navBox.top + 1,
            navBeforeBody: navBox.bottom <= bodyBox.top + 1,
            linkTargetsUsable: linkBoxes.every((box) => box.width >= 24 && box.height >= 24),
            panelOverflowY: getComputedStyle(panel).overflowY,
            surfaceOverflowY: getComputedStyle(root).overflowY,
            panelCanScroll: panel.scrollHeight > panel.clientHeight + 1,
            actualOwnerCount: actualVerticalOwners.length,
            actualOwnersArePanel: actualVerticalOwners.every((element) => element === panel),
            panelHorizontalOverflow: panel.scrollWidth - panel.clientWidth,
            bodyHorizontalOverflow: body.scrollWidth - body.clientWidth,
            documentHorizontalOverflow:
              document.documentElement.scrollWidth - document.documentElement.clientWidth,
          };
        }, program.panelSelector);

        expect(geometry, `${viewport.width}x${viewport.height} ${program.kind} detail geometry`)
          .toMatchObject({
            panelInSurface: true,
            headerInPanel: true,
            navInPanel: true,
            bodyInPanel: true,
            sectionsInBody: true,
            headerBeforeNav: true,
            navBeforeBody: true,
            linkTargetsUsable: true,
            panelOverflowY: 'auto',
            surfaceOverflowY: 'hidden',
            panelCanScroll: true,
            actualOwnerCount: 1,
            actualOwnersArePanel: true,
          });
        expect(geometry.panelHorizontalOverflow, 'detail panel must not clip horizontally')
          .toBeLessThanOrEqual(1);
        expect(geometry.bodyHorizontalOverflow, 'detail body must not clip horizontally')
          .toBeLessThanOrEqual(1);
        expect(geometry.documentHorizontalOverflow, 'detail view must not widen the document')
          .toBeLessThanOrEqual(1);

        const stickyTops = {
          header: await header.evaluate((element) => element.getBoundingClientRect().top),
          nav: await nav.evaluate((element) => element.getBoundingClientRect().top),
        };
        await links.last().click();
        await expect.poll(() => panel.evaluate((element) => element.scrollTop), {
          message: 'section navigation should scroll its detail panel',
        }).toBeGreaterThan(0);
        await expect(nav.locator('.summary_detail_section_link[aria-current="true"]')).toHaveCount(1);
        const scrolledTops = {
          header: await header.evaluate((element) => element.getBoundingClientRect().top),
          nav: await nav.evaluate((element) => element.getBoundingClientRect().top),
        };
        expect(scrolledTops.header).toBeCloseTo(stickyTops.header, 1);
        expect(scrolledTops.nav).toBeCloseTo(stickyTops.nav, 1);

        const back = panel.locator('.summary_back_btn');
        await back.click();
        await expect(panel).toBeHidden();
        await expect(tab).toBeFocused();

        await card.locator('.summary_detail_btn').click();
        await expect(panel).toBeVisible();
        await expect.poll(() => panel.evaluate((element) => element.scrollTop), {
          message: 'reopening details should start at the beginning rather than reuse the prior section offset',
        }).toBeLessThanOrEqual(1);
        await expect(panel.locator('.summary_detail_section_link').first())
          .toHaveAttribute('aria-current', 'true');
        await expect(panel.locator('.summary_detail_section_link[aria-current="true"]')).toHaveCount(1);
        await panel.locator('.summary_back_btn').click();
        await expect(panel).toBeHidden();
        await expect(tab).toBeFocused();
      }

      await overlay.locator('.summary_surface_close').click();
      await expect(overlay).toBeHidden();
    }
  });

  test('over-target major and minor progressbars expose valid ARIA bounds', async ({ page }) => {
    const overTargetPlan = Array.from(new Set([
      ...CS_PASSING_PLAN,
      'OPIM390', 'MGMT203', 'IE405', 'OPIM302', 'CS412', 'ECON301',
    ]));
    await seedPlan(page, {
      major: 'CS',
      entryTerm: TERM_NAME,
      minor1: 'ANALY-MINOR',
      entryTermMinor1: TERM_NAME,
      curriculum: [overTargetPlan],
      grades: [overTargetPlan.map(() => 'A')],
      dates: [TERM_NAME],
    });

    const overlay = await openSummary(page);
    const bounds = await overlay.locator('.summary_segment_track[role="progressbar"]')
      .evaluateAll((tracks) => tracks.map((track) => {
        const metric = track.closest('.summary_metric');
        const card = track.closest('.summary_program_card');
        return {
          kind: card && card.dataset.programKind,
          code: card && card.dataset.programCode,
          metric: metric && metric.dataset.metric,
          projected: Number(metric && metric.dataset.projected),
          limit: Number(metric && metric.dataset.limit),
          min: Number(track.getAttribute('aria-valuemin')),
          now: Number(track.getAttribute('aria-valuenow')),
          max: Number(track.getAttribute('aria-valuemax')),
        };
      }));

    expect(bounds.length, 'the overview should expose machine-readable progressbars').toBeGreaterThan(0);
    expect(bounds.some((row) => row.kind === 'main' && row.projected > row.limit),
      'the fixture must exercise an over-target main-major metric').toBe(true);
    expect(bounds.some((row) => row.kind === 'minor' && row.projected > row.limit),
      'the fixture must exercise an over-target minor metric').toBe(true);
    for (const row of bounds) {
      expect(row.now, `${row.kind}:${row.code} ${row.metric} aria-valuenow`).toBe(row.projected);
      expect(row.min, `${row.kind}:${row.code} ${row.metric} aria-valuemin`).toBeLessThanOrEqual(row.now);
      expect(row.max, `${row.kind}:${row.code} ${row.metric} aria-valuemax must contain the current value`)
        .toBeGreaterThanOrEqual(row.now);
      expect(row.max, `${row.kind}:${row.code} ${row.metric} aria-valuemax must contain the requirement target`)
        .toBeGreaterThanOrEqual(row.limit);
    }
  });
});
