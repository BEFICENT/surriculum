'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_CATEGORIES = [
  'blink.user_timing',
  'cc',
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.frame',
  'disabled-by-default-devtools.timeline.invalidationTracking',
  'gpu',
  'input',
  'latencyInfo',
  'loading',
  'renderer.scheduler',
  'toplevel',
  'v8',
];

async function readProtocolStream(cdp, handle, outputPath = null) {
  const chunks = [];
  let file = null;
  if (outputPath) {
    fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
    file = fs.openSync(outputPath, 'w');
  }
  try {
    let eof = false;
    while (!eof) {
      const result = await cdp.send('IO.read', { handle, size: 1024 * 1024 });
      const chunk = result.base64Encoded ? Buffer.from(result.data, 'base64') : Buffer.from(result.data, 'utf8');
      if (file !== null) fs.writeSync(file, chunk);
      else chunks.push(chunk);
      eof = !!result.eof;
    }
    if (file !== null) fs.fsyncSync(file);
  } finally {
    if (file !== null) fs.closeSync(file);
    await cdp.send('IO.close', { handle }).catch(() => {});
  }
  return outputPath ? path.resolve(outputPath) : Buffer.concat(chunks);
}

/** Start an opt-in diagnostic trace. Never use this around budgeted timing runs. */
async function startDiagnosticTrace(cdp, options = {}) {
  let stopped = false;
  let resolveComplete;
  let rejectComplete;
  const complete = new Promise((resolve, reject) => {
    resolveComplete = resolve;
    rejectComplete = reject;
  });
  const onComplete = (event) => resolveComplete(event);
  const onError = () => rejectComplete(new Error('browser target crashed while tracing'));
  const cleanup = () => {
    cdp.removeListener('Tracing.tracingComplete', onComplete);
    cdp.removeListener('Inspector.targetCrashed', onError);
  };
  cdp.once('Tracing.tracingComplete', onComplete);
  cdp.once('Inspector.targetCrashed', onError);
  try {
    await cdp.send('Tracing.start', {
      categories: (options.categories || DEFAULT_CATEGORIES).join(','),
      options: options.options || 'sampling-frequency=10000',
      transferMode: 'ReturnAsStream',
    });
  } catch (error) {
    cleanup();
    throw error;
  }
  return {
    async stop(outputPath = options.outputPath) {
      if (stopped) throw new Error('diagnostic trace has already stopped');
      stopped = true;
      const timeoutMs = Math.max(1_000, Number(options.timeoutMs || 30_000));
      let timeout;
      try {
        await cdp.send('Tracing.end');
        const event = await Promise.race([
          complete,
          new Promise((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error(`timed out waiting ${timeoutMs}ms for CDP trace completion`)),
              timeoutMs,
            );
          }),
        ]);
        if (!event.stream) throw new Error('CDP trace completed without a stream');
        return await readProtocolStream(cdp, event.stream, outputPath);
      } finally {
        clearTimeout(timeout);
        cleanup();
      }
    },
  };
}

/** Rerun one action under tracing after an unprofiled run reports a regression. */
async function traceDiagnostic(cdp, action, options = {}) {
  const trace = await startDiagnosticTrace(cdp, options);
  let value;
  let actionError;
  try {
    value = await action();
  } catch (error) {
    actionError = error;
  }
  let traceResult;
  try {
    traceResult = await trace.stop(options.outputPath);
  } catch (traceError) {
    if (!actionError) throw traceError;
  }
  if (actionError) throw actionError;
  return { value, trace: traceResult };
}

function summarizeCpuProfile(profile, urlPrefix = '') {
  const nodes = new Map((profile.nodes || []).map((node) => [node.id, node]));
  const totals = new Map();
  const samples = profile.samples || [];
  const deltas = profile.timeDeltas || [];
  for (let index = 0; index < samples.length; index += 1) {
    const frame = nodes.get(samples[index])?.callFrame;
    if (!frame) continue;
    if (urlPrefix && frame.url && !frame.url.startsWith(urlPrefix)) continue;
    const key = `${frame.functionName || '(anonymous)'}|${frame.url || ''}|${(frame.lineNumber || 0) + 1}`;
    totals.set(key, (totals.get(key) || 0) + ((deltas[index] || 0) / 1000));
  }
  return Array.from(totals.entries())
    .map(([key, selfMs]) => {
      const [functionName, url, line] = key.split('|');
      return { functionName, url, line: Number(line), selfMs };
    })
    .sort((left, right) => right.selfMs - left.selfMs)
    .slice(0, 25);
}

/** Rerun one action under V8 sampling; CPU profiling is diagnostic-only. */
async function profileDiagnostic(cdp, action, options = {}) {
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: options.samplingInterval || 1000 });
  await cdp.send('Profiler.start');
  let value;
  let actionError;
  try {
    value = await action();
  } catch (error) {
    actionError = error;
  }
  const { profile } = await cdp.send('Profiler.stop');
  await cdp.send('Profiler.disable').catch(() => {});
  if (options.outputPath) {
    fs.mkdirSync(path.dirname(path.resolve(options.outputPath)), { recursive: true });
    fs.writeFileSync(options.outputPath, `${JSON.stringify(profile)}\n`, 'utf8');
  }
  if (actionError) throw actionError;
  return {
    value,
    profile,
    topFunctions: summarizeCpuProfile(profile, options.urlPrefix || ''),
  };
}

module.exports = {
  DEFAULT_CATEGORIES,
  profileDiagnostic,
  readProtocolStream,
  startDiagnosticTrace,
  summarizeCpuProfile,
  traceDiagnostic,
};
