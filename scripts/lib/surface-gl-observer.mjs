/** Install only in an opt-in browser init script. Every observed call forwards
 * once to the original method, retaining metadata rather than pixel/buffer data.
 * Observation issues no GL calls. The separate explicit rescue hook is the only
 * intervention, and the driver must record and authorize its one invocation. */
export function observeSurfaceGL() {
  const probe = { serial: 0, contexts: [] };
  window.__tilingBalloonGL = probe;
  const contexts = new WeakMap();
  const liveContexts = [];
  const syncs = new WeakMap();
  let nextSync = 0;
  const waitNames = {
    0x911a: "ALREADY_SIGNALED",
    0x911b: "TIMEOUT_EXPIRED",
    0x911c: "CONDITION_SATISFIED",
    0x911d: "WAIT_FAILED",
  };
  const methods = [
    "drawArrays",
    "drawElements",
    "drawArraysInstanced",
    "drawElementsInstanced",
    "clear",
    "blitFramebuffer",
    "fenceSync",
    "clientWaitSync",
    "waitSync",
    "deleteSync",
    "flush",
    "finish",
    "readPixels",
    "getSyncParameter",
    "getError",
  ];
  function contextRecord(gl) {
    let record = contexts.get(gl);
    if (!record) {
      record = {
        id: probe.contexts.length + 1,
        counts: {},
        waitResults: {},
        last: {},
        pendingSyncs: {},
        droppedSyncRecords: 0,
        // Polls have separate last/count records so a stuck poll cannot erase
        // the command order immediately preceding it.
        commands: [],
      };
      contexts.set(gl, record);
      liveContexts.push(gl);
      probe.contexts.push(record);
    }
    return record;
  }
  for (const prototype of [
    window.WebGLRenderingContext?.prototype,
    window.WebGL2RenderingContext?.prototype,
  ]) {
    if (!prototype) continue;
    for (const method of methods) {
      const original = prototype[method];
      if (typeof original !== "function") continue;
      prototype[method] = function (...args) {
        const record = contextRecord(this);
        const call = {
          serial: ++probe.serial,
          atMs: performance.now(),
          method,
        };
        record.counts[method] = (record.counts[method] ?? 0) + 1;
        if (/Sync$|SyncParameter$/.test(method) && method !== "fenceSync")
          call.sync = syncs.get(args[0]) ?? null;
        // Numeric arguments describe submission/poll shape without retaining
        // uploaded or read-back bytes, sync objects, programs or framebuffers.
        call.args = args.map((arg) =>
          typeof arg === "number" || typeof arg === "boolean"
            ? arg
            : arg === null
              ? null
              : typeof arg,
        );
        let result;
        try {
          result = Reflect.apply(original, this, args);
        } catch (error) {
          call.threw = String(error);
          throw error;
        } finally {
          record.last[method] = call;
          if (method !== "clientWaitSync" && method !== "getSyncParameter") {
            record.commands.push(call);
            if (record.commands.length > 128) record.commands.shift();
          }
        }
        if (method === "fenceSync") {
          call.sync = result ? ++nextSync : null;
          if (result) {
            syncs.set(result, call.sync);
            if (Object.keys(record.pendingSyncs).length < 128)
              record.pendingSyncs[call.sync] = {
                createdSerial: call.serial,
                createdAtMs: call.atMs,
                polls: 0,
              };
            else record.droppedSyncRecords++;
          }
        } else if (method === "clientWaitSync") {
          call.result = waitNames[result] ?? result;
          record.waitResults[call.result] =
            (record.waitResults[call.result] ?? 0) + 1;
          const sync = record.pendingSyncs[call.sync];
          if (sync) {
            sync.polls++;
            sync.lastResult = call.result;
            sync.lastPollAtMs = call.atMs;
            sync.lastPollSerial = call.serial;
          }
        } else if (method === "deleteSync") {
          delete record.pendingSyncs[call.sync];
        } else if (typeof result === "number" || typeof result === "boolean") {
          call.result = result;
        }
        return result;
      };
    }
  }
  let rescueFired = false;
  window.__tilingBalloonFlush = () => {
    if (rescueFired)
      throw new Error("This page already received a flush rescue");
    const canvas = document.querySelector("#container canvas");
    const gl = liveContexts.find((context) => context.canvas === canvas);
    if (!gl) throw new Error("No observed GL context for the Surface canvas");
    const record = contexts.get(gl);
    if (Object.keys(record.pendingSyncs).length === 0)
      throw new Error("The observed Surface context has no pending fences");
    rescueFired = true;
    gl.flush();
    return { fired: true, context: record.id, command: record.last.flush };
  };
}

/** Actual host planner/fence advancement, excluding rAF ticks and repeated
 * unsignaled polls. Absence of the opt-in pump snapshot cannot arm a rescue. */
export function surfaceStripProgress(surface) {
  const kind = surface?.settleActive
    ? "settle"
    : surface?.previewActive
      ? "preview"
      : null;
  const job = kind && surface.strips?.[kind];
  if (!job?.planner || !job.queue || !job.diagnostic) return null;
  return {
    kind,
    id: job.diagnostic.id,
    armedAtMs: job.stat?.t0,
    width: job.width,
    height: job.height,
    planner: {
      done: job.planner.done,
      plannedPx: job.planner.plannedPx,
      totalPx: job.planner.totalPx,
    },
    queue: {
      inFlightCount: job.queue.inFlightCount,
      inFlightPx: job.queue.inFlightPx,
      inheritedPx: job.queue.inheritedPx,
      headPx: job.queue.headPx,
      headInherited: job.queue.headInherited,
    },
    fencesCreated: job.diagnostic.fencesCreated,
    fencesRetired: job.diagnostic.fencesRetired,
  };
}

/** Recheck inside the same browser task that performs the requested flush.
 * A trace or file write may give a queue time to resume before intervention. */
export function flushSurfaceIfUnchanged({ expected, deadline }) {
  if (Date.now() >= deadline)
    return { fired: false, reason: "settle-deadline-expired" };
  const surface = window.__surfaceState?.();
  const job = surface?.strips?.[expected.kind];
  const fieldsMatch = (actual, wanted) =>
    Object.entries(wanted).every(([key, value]) => actual?.[key] === value);
  if (
    !surface?.[`${expected.kind}Active`] ||
    job?.diagnostic?.id !== expected.id ||
    job?.stat?.t0 !== expected.armedAtMs ||
    !fieldsMatch(job?.planner, expected.planner) ||
    !fieldsMatch(job?.queue, expected.queue) ||
    job?.diagnostic?.fencesCreated !== expected.fencesCreated ||
    job?.diagnostic?.fencesRetired !== expected.fencesRetired ||
    !(job?.queue?.inFlightCount > 0)
  )
    return { fired: false, reason: "progress-resumed" };
  if (window.__tilingBalloonFlush) return window.__tilingBalloonFlush();
  // Three already owns this context. Host-only observation never requests a
  // context, polls a fence, or calls GL; only this explicit intervention does.
  const gl = document.querySelector("#container canvas")?.getContext("webgl2");
  if (!gl) throw new Error("Surface WebGL2 context is absent");
  gl.flush();
  return { fired: true, gltrace: false };
}
