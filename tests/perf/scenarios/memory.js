'use strict';

const {
  assertScenarioContext,
  recordInvariant,
  runPhase,
  seedFixture,
  settleAnimationFrames,
} = require('./_shared');
const { openScheduler } = require('./scheduler');

async function cdpMetrics(cdp) {
  const response = await cdp.send('Performance.getMetrics');
  return Object.fromEntries((response.metrics || []).map((metric) => [metric.name, metric.value]));
}

async function memorySample(page, cdp, cycle) {
  try { await cdp.send('HeapProfiler.collectGarbage'); } catch (_) {}
  await settleAnimationFrames(page, 2);
  const metrics = await cdpMetrics(cdp);
  const dom = await page.evaluate(() => ({
    elements: document.querySelectorAll('*').length,
    schedulerOverlays: document.querySelectorAll('.scheduler-overlay').length,
    schedulerModals: document.querySelectorAll('.scheduler-modal').length,
    pickerContainers: document.querySelectorAll('.input_container').length,
  }));
  return {
    cycle,
    jsHeapUsedBytes: metrics.JSHeapUsedSize ?? null,
    jsHeapTotalBytes: metrics.JSHeapTotalSize ?? null,
    nodes: metrics.Nodes ?? null,
    documents: metrics.Documents ?? null,
    eventListeners: metrics.JSEventListeners ?? null,
    frames: metrics.Frames ?? null,
    dom,
  };
}

async function schedulerCycle(page, timeout = 30_000) {
  const modal = await openScheduler(page, timeout);
  await modal.locator('.scheduler-close').click();
  await page.locator('.scheduler-overlay').waitFor({ state: 'detached', timeout });
  await settleAnimationFrames(page);
}

module.exports = {
  id: 'memory',
  description: 'Looks for retained Scheduler DOM/documents across repeated open and close cycles.',
  tags: ['memory', 'scheduler', 'soak'],

  async run(ctx) {
    assertScenarioContext(ctx, ['cdp']);
    const { page, cdp } = ctx;
    const phases = [];
    const invariants = [];
    const cycles = Math.max(5, Number(ctx.options?.memoryCycles || 20));
    const sampleEvery = Math.max(1, Number(ctx.options?.memorySampleEvery || 5));
    const navigationTimeout = Number(ctx.options?.navigationTimeout || 30_000);
    await seedFixture(ctx, 'scheduler-heavy');
    await cdp.send('Performance.enable');
    try { await cdp.send('HeapProfiler.enable'); } catch (_) {}

    // The first open fills schedule/catalog caches. Exclude that one-time cost
    // from leak slopes by warming before the first forced-GC sample.
    await schedulerCycle(page, navigationTimeout);
    const samples = [await memorySample(page, cdp, 0)];

    await runPhase(ctx, phases, 'memory.scheduler-open-close-soak', async () => {
      for (let cycle = 1; cycle <= cycles; cycle += 1) {
        await schedulerCycle(page, navigationTimeout);
        if (cycle % sampleEvery === 0 || cycle === cycles) {
          samples.push(await memorySample(page, cdp, cycle));
        }
      }
      return { cycles, sampleEvery, samples };
    });

    const first = samples[0];
    const last = samples[samples.length - 1];
    const nodesGrowth = Number.isFinite(first.nodes) && Number.isFinite(last.nodes)
      ? last.nodes - first.nodes : null;
    const documentsGrowth = Number.isFinite(first.documents) && Number.isFinite(last.documents)
      ? last.documents - first.documents : null;
    const listenerGrowth = Number.isFinite(first.eventListeners) && Number.isFinite(last.eventListeners)
      ? last.eventListeners - first.eventListeners : null;
    const heapGrowthBytes = Number.isFinite(first.jsHeapUsedBytes) && Number.isFinite(last.jsHeapUsedBytes)
      ? last.jsHeapUsedBytes - first.jsHeapUsedBytes : null;
    const allowedNodeNoise = Number.isFinite(first.nodes)
      ? Math.max(100, Math.ceil(first.nodes * 0.02)) : null;

    await recordInvariant(
      ctx,
      invariants,
      'memory.scheduler-always-cleans-visible-dom',
      samples.every((sample) => (
        sample.dom.schedulerOverlays === 0
          && sample.dom.schedulerModals === 0
          && sample.dom.pickerContainers === 0
      )),
      { samples },
    );
    await recordInvariant(
      ctx,
      invariants,
      'memory.scheduler-does-not-retain-documents',
      documentsGrowth === null || documentsGrowth <= 0,
      { first, last, documentsGrowth },
    );
    await recordInvariant(
      ctx,
      invariants,
      'memory.scheduler-node-growth-is-bounded',
      nodesGrowth === null || nodesGrowth <= allowedNodeNoise,
      { first, last, nodesGrowth, allowedNodeNoise },
    );
    await recordInvariant(
      ctx,
      invariants,
      'memory.scheduler-does-not-retain-event-listeners',
      listenerGrowth === null || listenerGrowth <= 0,
      { first, last, listenerGrowth },
    );

    return {
      phases,
      invariants,
      metadata: {
        cycles,
        samples,
        growth: {
          nodes: nodesGrowth,
          documents: documentsGrowth,
          eventListeners: listenerGrowth,
          heapBytes: heapGrowthBytes,
        },
      },
    };
  },
};
