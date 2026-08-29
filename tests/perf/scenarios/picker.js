'use strict';

const {
  assertScenarioContext,
  recordInvariant,
  runPhase,
  seedFixture,
  settleAnimationFrames,
  waitForStableFingerprint,
} = require('./_shared');

async function openPicker(page, timeout = 30_000) {
  const semester = page.locator('.container_semester').last();
  if (await semester.evaluate((node) => node.classList.contains('m-collapsed'))) {
    await semester.locator('.date p').click();
    await semester.evaluate((node) => new Promise((resolve) => {
      const check = () => {
        if (!node.classList.contains('m-collapsed')) resolve();
        else requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    }));
  }
  const picker = semester.locator('.input_container');
  await waitForStableFingerprint(page, '.input_container', async () => {
    await semester.locator('.addCourse').click();
    await picker.waitFor({ state: 'visible', timeout });
    await picker.locator('.course-option').first()
      .waitFor({ state: 'visible', timeout });
  }, {
    expected: { selector: '.input_container .course-option', minCount: 1 },
    mutationSelector: '.input_container .course-dropdown',
    timeout,
  });
  return picker;
}

async function readPickerGeometry(picker) {
  return picker.evaluate((root) => {
    const box = (node) => {
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    };
    const dropdown = root.querySelector('.course-dropdown');
    const menu = root.querySelector('.planner-course-filter-menu');
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const visibleControls = menu && !menu.hidden
      ? Array.from(menu.querySelectorAll('button, input, select')).filter((control) => {
        const rect = control.getBoundingClientRect();
        const style = getComputedStyle(control);
        return style.display !== 'none' && style.visibility !== 'hidden'
          && rect.width > 0 && rect.height > 0;
      }) : [];
    const menuRect = box(menu);
    return {
      dropdown: box(dropdown),
      menu: menuRect,
      viewport,
      placement: dropdown?.dataset.placement || '',
      optionCount: dropdown?.querySelectorAll('.course-option').length || 0,
      dropdownContained: Boolean(dropdown) && (() => {
        const rect = dropdown.getBoundingClientRect();
        return rect.left >= -1 && rect.right <= viewport.width + 1
          && rect.top >= -1 && rect.bottom <= viewport.height + 1;
      })(),
      menuContained: !menuRect || (
        menuRect.left >= -1 && menuRect.right <= viewport.width + 1
          && menuRect.top >= -1 && menuRect.bottom <= viewport.height + 1
      ),
      controlsContained: !menuRect || visibleControls.every((control) => {
        const rect = control.getBoundingClientRect();
        return rect.left >= menuRect.left - 1 && rect.right <= menuRect.right + 1;
      }),
      documentHorizontalOverflow:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

module.exports = {
  id: 'picker',
  description: 'Measures planner course-picker opening, search, combined filters, result scrolling, and cleanup.',
  tags: ['planner', 'picker', 'filters', 'interaction'],

  async run(ctx) {
    assertScenarioContext(ctx);
    const { page } = ctx;
    const navigationTimeout = Number(ctx.options?.navigationTimeout || 30_000);
    const phases = [];
    const invariants = [];
    await seedFixture(ctx, 'typical');

    let picker;
    await runPhase(ctx, phases, 'picker.open-and-settle', async () => {
      picker = await openPicker(page, navigationTimeout);
      return readPickerGeometry(picker);
    });

    await runPhase(ctx, phases, 'picker.search-typing', async () => {
      const search = picker.locator('.course_select');
      const samples = [];
      for (const query of ['CS', 'MATH', 'ENS', 'HUM', '']) {
        await waitForStableFingerprint(page, '.input_container', () => search.fill(query), {
          expected: { selector: '.input_container .course_select', value: query },
          mutationSelector: '.input_container .course-dropdown',
          timeout: navigationTimeout,
        });
        samples.push({ query, results: await picker.locator('.course-option').count() });
      }
      return samples;
    });

    let filteredGeometry;
    await runPhase(ctx, phases, 'picker.combined-filter-update', async () => {
      const menu = picker.locator('.planner-course-filter-menu');
      const mutations = [
        ['.planner-filter-prerequisites', true],
        ['.planner-filter-show-unmet', true],
        ['.planner-filter-details', true],
        ['.planner-filter-smart-sort', true],
      ];
      await waitForStableFingerprint(page, '.input_container', async () => {
        await picker.locator('.planner-course-filter-btn').click();
        await menu.waitFor({ state: 'visible' });
        for (const [selector, checked] of mutations) {
          const control = menu.locator(selector);
          if (await control.isChecked() !== checked) {
            await control.evaluate((node, next) => {
              node.checked = next;
              node.dispatchEvent(new Event('change', { bubbles: true }));
            }, checked);
          }
        }
        await menu.locator('.planner-filter-level').selectOption('300');
        await menu.locator('.planner-filter-min-su').fill('3');
        await menu.locator('.planner-filter-min-su').dispatchEvent('change');
      }, {
        expected: [
          ...mutations.map(([selector, checked]) => ({
            selector: `.input_container ${selector}`,
            checked,
          })),
          { selector: '.input_container .planner-filter-level', value: '300' },
          { selector: '.input_container .planner-filter-min-su', value: '3' },
        ],
        mutationSelector: '.input_container .course-dropdown',
        timeout: navigationTimeout,
      });
      filteredGeometry = await readPickerGeometry(picker);
      return filteredGeometry;
    });

    await recordInvariant(
      ctx,
      invariants,
      'picker.filter-panel-is-contained',
      filteredGeometry.menuContained
        && filteredGeometry.controlsContained
        && filteredGeometry.documentHorizontalOverflow <= 1,
      filteredGeometry,
    );

    await runPhase(ctx, phases, 'picker.result-scroll-roundtrip', async () => picker.evaluate((root) => {
      const list = root.querySelector('.course-dropdown');
      if (!list) throw new Error('Course result list is missing.');
      const maximum = Math.max(0, list.scrollHeight - list.clientHeight);
      list.scrollTop = maximum;
      list.dispatchEvent(new Event('scroll'));
      return new Promise((resolve) => requestAnimationFrame(() => {
        const reachedEnd = Math.abs(list.scrollTop - maximum) <= 1;
        list.scrollTop = 0;
        list.dispatchEvent(new Event('scroll'));
        requestAnimationFrame(() => resolve({ maximum, reachedEnd, finalScrollTop: list.scrollTop }));
      }));
    }));

    await picker.locator('.planner-course-filter-close').click();
    await picker.locator('.planner-course-filter-menu').waitFor({ state: 'hidden' });
    const geometry = await readPickerGeometry(picker);
    await recordInvariant(
      ctx,
      invariants,
      'picker.result-list-is-contained',
      geometry.dropdownContained && geometry.documentHorizontalOverflow <= 1,
      geometry,
    );

    await runPhase(ctx, phases, 'picker.close-and-cleanup', async () => {
      await picker.locator('.delete_add_course').click();
      await picker.waitFor({ state: 'detached' });
      await settleAnimationFrames(page);
      return { remainingPickers: await page.locator('.input_container').count() };
    });
    await recordInvariant(
      ctx,
      invariants,
      'picker.cleanup-removes-container',
      await page.locator('.input_container').count() === 0,
      {},
    );

    return { phases, invariants, metadata: { filteredGeometry, finalGeometry: geometry } };
  },
};
