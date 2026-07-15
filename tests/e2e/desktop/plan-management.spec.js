'use strict';

const { test, expect } = require('../fixtures');

// Plan management CRUD against the real planStorage API (scripts/plan_manager.js).
// Plans are localStorage-backed and key-prefixed per plan id; these tests pin the
// contracts the UI depends on — including the ones that are easy to break in a
// refactor because they are quietly inconsistent (see the cap test).
//
// Each test starts from a clean localStorage, so the app builds its default plan.

async function freshApp(page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => !!(window.planStorage && window.planStorage.getPlans));
}

test.describe('plan management', () => {
  test.beforeEach(async ({ page }) => {
    await freshApp(page);
  });

  test('starts with exactly one plan, which is active', async ({ page }) => {
    const r = await page.evaluate(() => {
      const plans = window.planStorage.getPlans();
      return { count: plans.length, activeId: window.planStorage.getActivePlanId(), ids: plans.map((p) => p.id) };
    });
    expect(r.count).toBe(1);
    expect(r.ids, 'the active plan must be one of the stored plans').toContain(r.activeId);
  });

  test('createPlan adds a named plan without activating it', async ({ page }) => {
    const r = await page.evaluate(() => {
      const before = window.planStorage.getActivePlanId();
      const id = window.planStorage.createPlan('Backup Plan');
      const plans = window.planStorage.getPlans();
      return {
        id,
        count: plans.length,
        name: (plans.find((p) => p.id === id) || {}).name,
        activeUnchanged: window.planStorage.getActivePlanId() === before,
      };
    });
    expect(r.id, 'createPlan should return a new id').toBeTruthy();
    expect(r.count).toBe(2);
    expect(r.name).toBe('Backup Plan');
    expect(r.activeUnchanged, 'creating a plan should not switch to it').toBe(true);
  });

  test('renamePlan renames an existing plan and rejects empty names', async ({ page }) => {
    const r = await page.evaluate(() => {
      const id = window.planStorage.createPlan('Original');
      const okRename = window.planStorage.renamePlan(id, 'Renamed');
      const nameAfter = window.planStorage.getPlans().find((p) => p.id === id).name;
      return {
        okRename,
        nameAfter,
        emptyRejected: window.planStorage.renamePlan(id, '   '),
        missingRejected: window.planStorage.renamePlan('no-such-id', 'X'),
        nameStillRenamed: window.planStorage.getPlans().find((p) => p.id === id).name,
      };
    });
    expect(r.okRename).toBe(true);
    expect(r.nameAfter).toBe('Renamed');
    expect(r.emptyRejected, 'a blank name should be rejected').toBe(false);
    expect(r.missingRejected, 'renaming an unknown id should be rejected').toBe(false);
    expect(r.nameStillRenamed, 'a rejected rename must not clobber the name').toBe('Renamed');
  });

  test('duplicatePlan copies the source plan-scoped data into a new plan', async ({ page }) => {
    const r = await page.evaluate(() => {
      const src = window.planStorage.getActivePlanId();
      window.planStorage.setItem('major', 'CS', src);
      window.planStorage.setItem('entryTerm', 'Fall 2024-2025', src);

      const copyId = window.planStorage.duplicatePlan(src, 'Copy A');
      // Mutating the copy must not reach back into the source.
      window.planStorage.setItem('major', 'ME', copyId);
      return {
        copyId,
        distinct: copyId !== src,
        copyEntryTerm: window.planStorage.getItem('entryTerm', copyId),
        copyMajor: window.planStorage.getItem('major', copyId),
        srcMajor: window.planStorage.getItem('major', src),
        count: window.planStorage.getPlans().length,
      };
    });
    expect(r.copyId).toBeTruthy();
    expect(r.distinct, 'the duplicate needs its own id').toBe(true);
    expect(r.count).toBe(2);
    expect(r.copyEntryTerm, 'plan-scoped data should be copied').toBe('Fall 2024-2025');
    expect(r.copyMajor).toBe('ME');
    expect(r.srcMajor, 'editing the copy must not affect the source').toBe('CS');
  });

  test('deletePlan removes a plan and its scoped data, but never the last one', async ({ page }) => {
    const r = await page.evaluate(() => {
      const keep = window.planStorage.getActivePlanId();
      const doomed = window.planStorage.createPlan('Doomed');
      window.planStorage.setItem('major', 'BIO', doomed);

      // Deleting a non-active plan must not trigger the reload path.
      const res = window.planStorage.deletePlan(doomed);
      const out = {
        ok: res.ok,
        reloaded: res.reloaded,
        gone: !window.planStorage.getPlans().some((p) => p.id === doomed),
        // Plan-scoped keys are prefixed with the plan id; none should survive.
        orphanKeys: Object.keys(localStorage).filter((k) => k.includes(doomed)),
        missing: window.planStorage.deletePlan('no-such-id'),
        lastOne: null,
      };
      // Only `keep` remains — the API must refuse to delete it.
      out.lastOne = window.planStorage.deletePlan(keep);
      out.survived = window.planStorage.getPlans().length;
      return out;
    });
    expect(r.ok).toBe(true);
    expect(r.reloaded, 'deleting a non-active plan should not reload').toBe(false);
    expect(r.gone).toBe(true);
    expect(r.orphanKeys, 'deleting a plan must drop its scoped keys').toEqual([]);
    expect(r.missing.ok, 'deleting an unknown id should fail').toBe(false);
    expect(r.lastOne.ok, 'the final plan must not be deletable').toBe(false);
    expect(r.survived, 'the final plan must survive the delete attempt').toBe(1);
  });

  test('setActivePlanId switches plans and rejects unknown ids', async ({ page }) => {
    const r = await page.evaluate(() => {
      const first = window.planStorage.getActivePlanId();
      const second = window.planStorage.createPlan('Second');
      const switched = window.planStorage.setActivePlanId(second);
      return {
        switched,
        activeNow: window.planStorage.getActivePlanId(),
        second,
        first,
        rejected: window.planStorage.setActivePlanId('no-such-id'),
        activeAfterReject: window.planStorage.getActivePlanId(),
      };
    });
    expect(r.switched).toBe(true);
    expect(r.activeNow).toBe(r.second);
    expect(r.rejected, 'an unknown id should be rejected').toBe(false);
    expect(r.activeAfterReject, 'a rejected switch must leave the active plan alone').toBe(r.second);
  });

  test('the plan cap is enforced — and reported differently per entry point', async ({ page }) => {
    const r = await page.evaluate(() => {
      const max = window.planStorage.maxPlans;
      while (window.planStorage.getPlans().length < max) {
        if (window.planStorage.createPlan(`P${window.planStorage.getPlans().length}`) === null) break;
      }
      const atCap = window.planStorage.getPlans().length;

      let importThrew = null;
      try {
        window.planStorage.importPlanObject(
          { type: 'surriculum_plan', version: 1, plan: { name: 'Overflow', state: { major: 'CS' } } },
          { activate: true },
        );
      } catch (e) {
        importThrew = String(e.message || e);
      }

      return {
        max,
        atCap,
        createOverCap: window.planStorage.createPlan('Over'),
        duplicateOverCap: window.planStorage.duplicatePlan(window.planStorage.getActivePlanId(), 'Over'),
        importThrew,
        countUnchanged: window.planStorage.getPlans().length,
      };
    });

    expect(r.max, 'plan cap').toBe(10);
    expect(r.atCap, 'should be able to fill up to the cap').toBe(r.max);
    // Same condition, three entry points, two different contracts. Pinned as-is:
    // the UI relies on both, so a refactor that unifies them must do it
    // deliberately rather than by accident.
    expect(r.createOverCap, 'createPlan returns null at the cap').toBeNull();
    expect(r.duplicateOverCap, 'duplicatePlan returns null at the cap').toBeNull();
    expect(r.importThrew, 'importPlanObject throws at the cap').toContain('Plan limit reached');
    expect(r.countUnchanged, 'nothing should be created past the cap').toBe(r.max);
  });
});
