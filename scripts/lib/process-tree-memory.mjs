/**
 * Best-effort Linux process-tree RSS sampling for measurement harnesses.
 *
 * `/proc` is live rather than transactional: a browser child can exit between
 * listing `/proc` and reading its status, and a restricted host can deny a
 * status file altogether. Those cases must never turn into a zero-byte child.
 * A sample therefore publishes an exact `rssBytes` only when every process
 * named by the root's recursive `children` walk was readable. Partial samples
 * retain their known lower bound in `knownRssBytes` and describe what was
 * unavailable. It deliberately does not enumerate unrelated `/proc` entries:
 * doing that work on every short-interval sample would perturb the run it is
 * supposed to observe.
 *
 * This measures resident host memory, not GPU driver-private memory or a
 * browser's complete allocation footprint. It is an observation to accompany
 * an allocation plan, never a certification of total process memory.
 */

import fs from "node:fs/promises";

/** Default cadence for `sampleProcessTreeRssPeak`, short enough for previews. */
export const DEFAULT_PEAK_INTERVAL_MS = 25;

/** Keep a result useful without retaining one error for every raced process. */
const MAX_REPORTED_ISSUES = 32;

/**
 * Parse the two `/proc/<pid>/status` fields this sampler needs.
 *
 * `VmRSS` is expressed in kB by procfs. A present `VmRSS: 0 kB` remains zero;
 * `null` is reserved for a missing or malformed value, never silently zero.
 */
export function parseProcStatus(text) {
  if (typeof text !== "string") return null;
  const ppidText = /^PPid:\s*(\d+)\s*$/m.exec(text)?.[1];
  const rssText = /^VmRSS:\s*(\d+)\s*kB\s*$/im.exec(text)?.[1];
  const ppid = Number(ppidText);
  const rssKb = Number(rssText);
  return {
    ppid: Number.isSafeInteger(ppid) && ppid >= 0 ? ppid : null,
    rssBytes:
      Number.isSafeInteger(rssKb) &&
      rssKb >= 0 &&
      rssKb <= Number.MAX_SAFE_INTEGER / 1024
        ? rssKb * 1024
        : null,
  };
}

function validPid(pid) {
  return Number.isSafeInteger(pid) && pid > 0;
}

function issue(pid, path, error) {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : String(error);
  return { pid, path, reason: code };
}

function addIssue(summary, next, unavailableProcess = true) {
  if (unavailableProcess) summary.unavailableProcessCount += 1;
  if (summary.issues.length < MAX_REPORTED_ISSUES) summary.issues.push(next);
}

async function readProcessStatus(pid) {
  const path = `/proc/${pid}/status`;
  let text;
  try {
    text = await fs.readFile(path, "utf8");
  } catch (error) {
    return { pid, record: null, issue: issue(pid, path, error) };
  }
  const record = parseProcStatus(text);
  if (record === null || record.ppid === null || record.rssBytes === null) {
    return {
      pid,
      record: null,
      issue: {
        pid,
        path,
        reason:
          record?.ppid === null
            ? "status lacks a valid PPid"
            : "status lacks a valid VmRSS",
      },
    };
  }
  return { pid, record, issue: null };
}

async function readChildren(pid) {
  const path = `/proc/${pid}/task/${pid}/children`;
  let text;
  try {
    text = await fs.readFile(path, "utf8");
  } catch (error) {
    return { children: null, issue: issue(pid, path, error) };
  }
  const tokens = text.trim() === "" ? [] : text.trim().split(/\s+/);
  const children = tokens.map(Number);
  if (!children.every(validPid)) {
    return {
      children: null,
      issue: { pid, path, reason: "children file contains an invalid pid" },
    };
  }
  return { children, issue: null };
}

/**
 * Sum a root process and every descendant named by the recursive
 * `/proc/<pid>/task/<pid>/children` walk. This function never throws for
 * ordinary process races or denied procfs reads; inspect `status` and `issues`
 * before accepting a total.
 *
 * - `status: "ok"`: `rssBytes` is the snapshot total.
 * - `status: "partial"`: `knownRssBytes` is only a lower bound; `rssBytes`
 *   is null because at least one process could not be inspected.
 * - `status: "unknown"`: even the requested root was unavailable.
 */
export async function sampleProcessTreeRss(rootPid) {
  const summary = {
    rootPid,
    status: "unknown",
    rssBytes: null,
    knownRssBytes: null,
    sampledPids: [],
    unavailableProcessCount: 0,
    issues: [],
  };
  if (!validPid(rootPid)) {
    summary.issues.push({
      pid: rootPid,
      path: "/proc",
      reason: "root pid must be a positive safe integer",
    });
    return summary;
  }

  const records = new Map();
  const discovered = new Set([rootPid]);
  const pending = [rootPid];
  while (pending.length > 0) {
    const pid = pending.pop();
    const read = await readProcessStatus(pid);
    if (read.record === null) {
      if (pid === rootPid) {
        summary.issues.push(read.issue);
        return summary;
      }
      addIssue(summary, read.issue);
      continue;
    }
    records.set(pid, read.record);

    const childRead = await readChildren(pid);
    if (childRead.children === null) {
      // A readable parent with an unreadable child list still has known RSS,
      // but its descendant total is incomplete.
      addIssue(summary, childRead.issue, false);
      continue;
    }
    for (const child of childRead.children) {
      if (!discovered.has(child)) {
        discovered.add(child);
        pending.push(child);
      }
    }
  }

  summary.sampledPids = [...records.keys()].sort((a, b) => a - b);
  summary.knownRssBytes = summary.sampledPids.reduce(
    (total, pid) => total + records.get(pid).rssBytes,
    0,
  );
  if (summary.issues.length === 0) {
    summary.status = "ok";
    summary.rssBytes = summary.knownRssBytes;
  } else {
    summary.status = "partial";
  }
  return summary;
}

function safeInterval(intervalMs) {
  return Number.isFinite(intervalMs) && intervalMs > 0
    ? Math.max(1, Math.floor(intervalMs))
    : DEFAULT_PEAK_INTERVAL_MS;
}

function unknownSample(rootPid, error) {
  return {
    rootPid,
    status: "unknown",
    rssBytes: null,
    knownRssBytes: null,
    sampledPids: [],
    unavailableProcessCount: 1,
    issues: [issue(rootPid, "/proc", error)],
  };
}

/**
 * Observe a process tree while `operation` runs and return its value with the
 * peak RSS observation. Sampling failures never hide the operation's own
 * error: the operation is rethrown after the monitor has stopped and taken a
 * final sample. Peak totals obey the same complete/partial contract as one
 * sample; `knownPeakRssBytes` is a lower bound whenever `status !== "ok"`.
 */
export async function sampleProcessTreeRssPeak(
  rootPid,
  operation,
  options = {},
) {
  if (typeof operation !== "function") {
    throw new TypeError(
      "operation must be a function returning a promise or value",
    );
  }
  const intervalMs = safeInterval(options.intervalMs);
  const startedAtMs = Date.now();
  let sampleCount = 0;
  let completeSampleCount = 0;
  let partialSampleCount = 0;
  let unknownSampleCount = 0;
  let knownPeakRssBytes = null;
  let exactPeakRssBytes = null;
  const issues = [];

  const capture = async (initialSample) => {
    let sample;
    try {
      sample = initialSample ?? (await sampleProcessTreeRss(rootPid));
    } catch (error) {
      // The public sampler already handles normal procfs failures. This guard
      // protects a monitor from an unexpected implementation failure as well.
      sample = unknownSample(rootPid, error);
    }
    sampleCount += 1;
    if (sample.status === "ok") {
      completeSampleCount += 1;
      exactPeakRssBytes = Math.max(exactPeakRssBytes ?? 0, sample.rssBytes);
    } else if (sample.status === "partial") {
      partialSampleCount += 1;
    } else {
      unknownSampleCount += 1;
    }
    if (sample.knownRssBytes !== null) {
      knownPeakRssBytes = Math.max(
        knownPeakRssBytes ?? 0,
        sample.knownRssBytes,
      );
    }
    for (const next of sample.issues) {
      if (issues.length >= MAX_REPORTED_ISSUES) break;
      issues.push(next);
    }
  };

  // A caller which needs its timing scope to begin at the operation can take
  // this baseline just before entering here. Reusing it avoids charging a
  // duplicate /proc walk to the operation while still making it the peak
  // monitor's first observation.
  await capture(options.initialSample);
  let stopped = false;
  const monitor = (async () => {
    while (!stopped) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      if (!stopped) await capture();
    }
  })();

  let value;
  let operationError;
  let operationFailed = false;
  try {
    value = await operation();
  } catch (error) {
    operationError = error;
    operationFailed = true;
  } finally {
    stopped = true;
    await monitor;
    await capture();
  }
  if (operationFailed) throw operationError;

  const status =
    completeSampleCount === sampleCount
      ? "ok"
      : completeSampleCount === 0
        ? "unknown"
        : "partial";
  return {
    value,
    peak: {
      rootPid,
      status,
      peakRssBytes: status === "ok" ? exactPeakRssBytes : null,
      knownPeakRssBytes,
      intervalMs,
      startedAtMs,
      endedAtMs: Date.now(),
      sampleCount,
      completeSampleCount,
      partialSampleCount,
      unknownSampleCount,
      issues,
    },
  };
}

/** Default band count for the render stage's tile-band attribution. */
export const DEFAULT_TIMELINE_BANDS = 8;

function knownBytes(sample) {
  return sample.rssBytes ?? sample.knownRssBytes ?? null;
}

function present(value) {
  return value !== null && value !== undefined;
}

function phaseSummary(stage, samples) {
  const values = samples.map(knownBytes);
  const allComplete = samples.every((sample) => present(sample.rssBytes));
  const anyKnown = values.some(present);
  return {
    stage,
    samples: samples.length,
    firstAtMs: samples[0]?.atMs ?? null,
    lastAtMs: samples[samples.length - 1]?.atMs ?? null,
    status: allComplete ? "ok" : anyKnown ? "partial" : "unknown",
    // Exact only when every sample in the phase was complete; otherwise the
    // known lower bounds, per the sampler's own contract.
    rssStartBytes: allComplete ? values[0] : null,
    rssEndBytes: allComplete ? values[values.length - 1] : null,
    rssMaxBytes: allComplete ? Math.max(...values) : null,
    knownRssStartBytes: anyKnown ? values[0] : null,
    knownRssEndBytes: anyKnown ? values[values.length - 1] : null,
    knownRssMaxBytes: anyKnown
      ? Math.max(...values.filter((v) => v !== null))
      : null,
  };
}

/**
 * Attribute a sampled RSS timeline to run phases. The input is the ordered
 * output of a monitor that snapshots the process tree alongside the observed
 * run's own progress (stage, completedTiles). Consecutive samples sharing a
 * stage form that phase's evidence; the render phase is additionally bucketed
 * into equal completed-tile bands so growth inside the render can be located.
 *
 * The same complete/partial contract as one sample applies per phase: exact
 * byte fields only when every sample in the group was complete, known lower
 * bounds otherwise.
 */
export function attributeProcessTreeRssTimeline(samples, options = {}) {
  const bandCount = Number.isInteger(options.renderTileBands)
    ? Math.max(1, options.renderTileBands)
    : DEFAULT_TIMELINE_BANDS;
  const usable = (samples ?? []).filter(
    (sample) => sample !== null && typeof sample === "object",
  );
  const phases = [];
  for (const sample of usable) {
    const last = phases[phases.length - 1];
    if (last !== undefined && last.stage === sample.stage)
      last.samples.push(sample);
    else phases.push({ stage: sample.stage, samples: [sample] });
  }
  // A stage can reappear only if the observed run restarts one; merging keeps
  // the report one row per phase name while preserving first/last ordering.
  const merged = new Map();
  for (const phase of phases) {
    const existing = merged.get(phase.stage);
    if (existing === undefined) merged.set(phase.stage, phase);
    else existing.samples.push(...phase.samples);
  }
  const phaseReports = [...merged.values()].map((phase) => ({
    ...phaseSummary(phase.stage, phase.samples),
    samples: phase.samples.length,
  }));

  const renderSamples = usable.filter(
    (sample) =>
      sample.stage === "render" &&
      sample.completedTiles !== null &&
      sample.completedTiles !== undefined,
  );
  let renderTileBands = null;
  if (renderSamples.length > 0) {
    const maxTiles = Math.max(
      ...renderSamples.map((sample) => sample.completedTiles),
    );
    const bandWidth = Math.max(1, Math.ceil((maxTiles + 1) / bandCount));
    renderTileBands = [];
    for (let start = 0; start <= maxTiles; start += bandWidth) {
      const end = Math.min(maxTiles, start + bandWidth - 1);
      const bandSamples = renderSamples.filter(
        (sample) =>
          sample.completedTiles >= start && sample.completedTiles <= end,
      );
      if (bandSamples.length === 0) continue;
      renderTileBands.push({
        tilesFrom: start,
        tilesTo: end,
        ...phaseSummary(`render tiles ${start}-${end}`, bandSamples),
      });
    }
  }

  const completeValues = usable
    .filter((sample) => present(sample.rssBytes))
    .map((sample) => sample.rssBytes);
  const knownValues = usable.map(knownBytes).filter(present);
  return {
    sampleCount: usable.length,
    completeSampleCount: completeValues.length,
    status:
      completeValues.length === usable.length && usable.length > 0
        ? "ok"
        : completeValues.length === 0
          ? "unknown"
          : "partial",
    baselineRssBytes:
      completeValues.length === usable.length && usable.length > 0
        ? completeValues[0]
        : null,
    peakRssBytes:
      completeValues.length === usable.length && usable.length > 0
        ? Math.max(...completeValues)
        : null,
    knownBaselineRssBytes: knownValues.length > 0 ? knownValues[0] : null,
    knownPeakRssBytes: knownValues.length > 0 ? Math.max(...knownValues) : null,
    phases: phaseReports,
    renderTileBands,
  };
}
