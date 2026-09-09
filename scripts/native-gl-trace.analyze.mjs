#!/usr/bin/env node
/**
 * Offline native GL JSONL analysis. Never loads a GL library or starts a browser.
 * Usage: node scripts/native-gl-trace.analyze.mjs TRACE [--events FILE] [--source FILE]
 *        [--output FILE] [--top 20] [--all-syncs]
 *
 * Counts are lower bounds within a continuous observed poll-cache epoch. Cache
 * collisions reset seen; pointer reuse does not. Output-pointer arguments are
 * part of the recorder's sampling key. Keep all uint64 arithmetic as BigInt.
 * An open lifetime means no destroy or superseding create was observed; it
 * does not establish that its process is still alive. Slots identify function
 * implementations, never a shared fence namespace across different functions.
 */
import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const SYNC_CREATE = new Set([
  "glFenceSync",
  "eglCreateSync",
  "eglCreateSyncKHR",
]);
const SYNC_DESTROY = new Set([
  "glDeleteSync",
  "eglDestroySync",
  "eglDestroySyncKHR",
]);
const SYNC_POLL = new Set([
  "glClientWaitSync",
  "glGetSynciv",
  "eglClientWaitSync",
  "eglClientWaitSyncKHR",
  "eglGetSyncAttrib",
  "eglGetSyncAttribKHR",
]);
const SYNC_WAIT = new Set(["glWaitSync", "eglWaitSync", "eglWaitSyncKHR"]);
const UINT64_MASK = (1n << 64n) - 1n;
const DEFAULT_SOURCE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "out/native-gl-trace/native-gl-trace.c",
);

function integer(value) {
  return value == null || value === "(nil)" ? 0n : BigInt(value);
}

function get(record, key, fallback = null) {
  return Object.hasOwn(record, key) ? record[key] : fallback;
}

function tupleKey(values) {
  return JSON.stringify(values, (_, value) =>
    typeof value === "bigint" ? value.toString() : value,
  );
}

function text(value) {
  if (value === null) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  return String(value);
}

function increment(counter, key, amount = 1) {
  counter[key] =
    (counter[key] ?? (typeof amount === "bigint" ? 0n : 0)) + amount;
}

function hex(value) {
  return value < 0n ? `-0x${(-value).toString(16)}` : `0x${value.toString(16)}`;
}

async function* records(filename, errors) {
  const stream = fs.createReadStream(filename, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let lineNumber = 0;
  try {
    for await (const line of lines) {
      lineNumber++;
      if (!line.trim()) continue;
      try {
        yield JSON.parse(line);
      } catch (error) {
        errors.count++;
        if (errors.examples.length < 8)
          errors.examples.push({
            file: filename,
            line: lineNumber,
            error: error.message,
          });
      }
    }
  } finally {
    lines.close();
    stream.destroy();
  }
}

function pollStatus(record) {
  const name = record.call;
  const args = (record.args ?? []).map(integer);
  const result = integer(record.result);
  const value = integer(record.out);
  if (name === "glClientWaitSync") {
    if (result === 0x911an || result === 0x911cn) return "signaled";
    if (result === 0x911bn) return "pending";
    if (result === 0x911dn) return "wait-failed";
    return "unknown";
  }
  if (name.startsWith("eglClientWaitSync")) {
    if (result === 0x30f5n) return "pending";
    if (result === 0x30f6n) return "signaled";
    if (result === 0n) return "wait-failed";
    return "unknown";
  }
  if (name === "glGetSynciv" && args.length > 1 && args[1] === 0x9114n) {
    if (record.out == null) return "unknown";
    if (value === 0x9119n) return "signaled";
    if (value === 0x9118n) return "pending";
    return "unknown";
  }
  if (
    name.startsWith("eglGetSyncAttrib") &&
    args.length > 2 &&
    args[2] === 0x30f1n
  ) {
    if (result === 0n || record.out == null) return "query-failed";
    if (value === 0x30f2n) return "signaled";
    if (value === 0x30f3n) return "pending";
    return "unknown";
  }
  return "not-status-query";
}

// These offsets describe only the build whose private layout the observer
// validates. A different executable or recovery path remains observational data.
const QUERY_BUILD_ID = "5f6e1a6835b28b53be4483a0c48063fd3fcb3108";
const QUERY_FRAME_OFFSETS = [0x77d8dc0n, 0x76eb081n, 0xbf7ed2en, 0xbf2837dn];
const QUERY_TARGETS = new Map([
  [0xd181420n, 0x84f8],
  [0xd1814e6n, 0x84f7],
]);

function queryInteger(value) {
  try {
    return value == null ? null : integer(value);
  } catch {
    return null;
  }
}

function queryObservation(entry, initializations, scenes) {
  const stack = entry.stack;
  const snapshot = entry.snapshot;
  const missing = [];
  const requireFlag = (condition, reason) => {
    if (!condition) missing.push(reason);
  };
  requireFlag(entry.stackRecords === 1, "Expected exactly one stack record");
  requireFlag(
    entry.snapshotRecords === 1,
    "Expected exactly one query snapshot",
  );
  requireFlag(
    queryInteger(entry.stackId) > 0n &&
      Number.isInteger(entry.pid) &&
      entry.pid > 0,
    "Missing process or call identity",
  );
  requireFlag(
    stack?.tid != null && stack.tid === snapshot?.tid,
    "Stack and query snapshot belong to different or missing threads",
  );
  requireFlag(
    stack?.call === "glClientWaitSync" &&
      stack?.layer === "native" &&
      queryInteger(stack?.object) > 0n,
    "The verified query path requires an identified native glClientWaitSync",
  );
  requireFlag(
    stack?.queryLayoutValidated === true,
    "Query layout was not validated",
  );
  requireFlag(
    snapshot?.frameFound === true,
    "Matching query frame was not found",
  );
  requireFlag(
    snapshot?.readOk === true,
    "Query memory was not read successfully",
  );
  requireFlag(
    snapshot?.syncReadOk === true,
    "QuerySync memory was not read successfully",
  );
  requireFlag(
    snapshot?.targetMatches === true,
    "Query target did not match the call site",
  );
  requireFlag(
    snapshot?.recovery === "verified-frame-pointer",
    "Query recovery method has not been qualified by this analyzer",
  );
  const frames = Array.from({ length: 5 }, (_, index) =>
    entry.frames.filter((frame) => frame.index === index),
  );
  requireFlag(
    frames.every((rows) => rows.length === 1),
    "Expected exactly one record for each verified frame",
  );
  const chain = frames.map((rows) => rows[0]);
  const base = queryInteger(chain[0]?.base);
  const queryPc = queryInteger(snapshot?.pc);
  const queryOffset = base != null && queryPc != null ? queryPc - base : null;
  const target = QUERY_TARGETS.get(queryOffset);
  requireFlag(
    base > 0n && target != null && snapshot?.target === target,
    "Query PC and target do not match the pinned completion branch",
  );
  requireFlag(
    chain.every((frame, index) => {
      const pc = queryInteger(frame?.pc);
      const offset = index === 4 ? queryOffset : QUERY_FRAME_OFFSETS[index];
      return (
        frame?.tid === stack?.tid &&
        base != null &&
        offset != null &&
        pc === base + offset &&
        queryInteger(frame?.base) === base &&
        queryInteger(frame?.offset) === offset &&
        (index === 4 ||
          (frame?.returnPc === chain[index + 1]?.pc &&
            frame?.previousFp === chain[index + 1]?.fp))
      );
    }),
    "Recorded frame chain does not match the guarded native-to-query path",
  );
  requireFlag(
    snapshot?.pc === chain[4]?.pc && stack?.caller === chain[0]?.pc,
    "Native caller and query PC do not match the joined frame chain",
  );

  // A GPU child can inherit initialization from a zygote without emitting init.
  // Match its observed image base, disclose the record PID, and require a unique
  // record. This establishes guard provenance, not process ancestry.
  const candidates = initializations.filter(
    (record) =>
      queryInteger(record.executableBase) === base &&
      record.wallMs <= stack?.wallMs,
  );
  const initialization = candidates.length === 1 ? candidates[0] : null;
  requireFlag(
    candidates.length === 1,
    "Expected one initialization for the observed executable image base",
  );
  requireFlag(
    initialization?.executableBuildId === QUERY_BUILD_ID &&
      initialization?.queryLayoutValidated === true &&
      initialization?.framePointerLayoutValidated === true,
    "Pinned executable and frame-pointer layout were not validated",
  );
  const selectedFence =
    target === 0x84f8 ? snapshot?.shadowFence : snapshot?.commandsFence;
  requireFlag(
    snapshot?.fenceObjectMatches === true &&
      queryInteger(selectedFence) > 0n &&
      queryInteger(snapshot?.fenceObject) === queryInteger(selectedFence),
    "Restored fence object did not match the query's selected fence",
  );
  requireFlag(
    chain[2]?.belowReadOk === true &&
      chain[2]?.savedBelow?.[1] === snapshot?.decoder &&
      chain[2]?.savedBelow?.[3] === snapshot?.fenceObject,
    "Saved registers do not corroborate decoder and fence identity",
  );
  requireFlag(
    entry.seedRecords === 1 &&
      entry.seed?.tid === stack?.tid &&
      entry.seed?.seedFp === chain[0]?.fp &&
      entry.seed?.seedR13 === snapshot?.query,
    "Frame-pointer seed does not corroborate query identity",
  );
  requireFlag(
    queryInteger(snapshot?.query) > 0n &&
      queryInteger(snapshot?.decoder) > 0n &&
      queryInteger(snapshot?.querySync) > 0n &&
      Number.isInteger(snapshot?.serviceId) &&
      snapshot.serviceId > 0 &&
      Number.isInteger(snapshot?.submitCount) &&
      snapshot.submitCount > 0 &&
      Number.isInteger(snapshot?.processCount) &&
      snapshot.processCount >= 0,
    "Query identifiers or counters are missing or invalid",
  );
  requireFlag(
    entry.binding?.module &&
      entry.binding.module !== "unknown" &&
      queryInteger(entry.binding?.original) > 0n,
    "Native function provider is unresolved",
  );
  requireFlag(
    entry.lifetime?.identityAmbiguous !== true,
    "Native handle lifetime has ambiguous provider or creation identity",
  );
  let status = "unknown";
  if (typeof stack?.call === "string") {
    // Wait functions return their status directly. Getter stack records retain
    // the observer's status output but may have no sampled call/argument record.
    if (
      stack.call === "glClientWaitSync" ||
      stack.call.startsWith("eglClientWaitSync")
    )
      status = pollStatus(stack);
    else if (stack.hasOut === true && stack.call === "glGetSynciv") {
      const value = integer(stack.out);
      if (value === 0x9118n) status = "pending";
      else if (value === 0x9119n) status = "signaled";
    } else if (
      stack.hasOut === true &&
      stack.call.startsWith("eglGetSyncAttrib")
    ) {
      const value = integer(stack.out);
      if (value === 0x30f3n) status = "pending";
      else if (value === 0x30f2n) status = "signaled";
    }
  }
  requireFlag(
    status === "pending" || status === "signaled",
    "Native wait did not return a recognized completion status",
  );
  return {
    pid: entry.pid,
    stackId: entry.stackId,
    tid: get(stack ?? snapshot ?? {}, "tid"),
    reason: get(stack ?? {}, "reason"),
    wallMs: get(stack ?? {}, "wallMs"),
    monoNs: get(stack ?? {}, "monoNs"),
    native: stack
      ? {
          call: stack.call,
          slot: get(stack, "slot"),
          layer: get(stack, "layer"),
          object: get(stack, "object"),
          context: get(stack, "context"),
          display: get(stack, "display"),
          result: get(stack, "result"),
          out: get(stack, "out"),
          hasOut: get(stack, "hasOut"),
          status,
          provider: entry.binding ?? null,
          lifetimeId: entry.lifetime?.id ?? null,
          generation: entry.lifetime?.generation ?? null,
        }
      : null,
    guards: {
      queryLayoutValidated: get(stack ?? {}, "queryLayoutValidated"),
      framePointerLayoutValidated: get(
        initialization ?? {},
        "framePointerLayoutValidated",
      ),
      initializationPid: initialization?.pid ?? null,
      provenance: initialization
        ? initialization.pid === entry.pid
          ? "same-process-initialization"
          : "matching-image-initialization"
        : null,
      executableBase: initialization?.executableBase ?? null,
      executableBuildId: initialization?.executableBuildId ?? null,
    },
    identityObserved: missing.length === 0,
    frontendFenceMappingObserved: false,
    scenes: scenes(stack?.wallMs),
    incompleteReasons: missing,
    query: snapshot ?? null,
  };
}

class CallerMaps {
  constructor(directory) {
    this.directory = directory;
    this.maps = new Map();
    this.segments = new Map();
  }

  describe(pid, caller) {
    if (!this.maps.has(pid)) {
      // Accept the original manual capture and the harness-owned capture name.
      const candidates = [
        path.join(this.directory, `native-process-${pid}.maps`),
        path.join(this.directory, `native-gl-process-${pid}.maps`),
      ];
      const filename = candidates.find((candidate) => fs.existsSync(candidate));
      this.maps.set(
        pid,
        filename ? fs.readFileSync(filename, "utf8").split(/\r?\n/) : [],
      );
    }
    const address = integer(caller);
    for (const row of this.maps.get(pid)) {
      const parts = row.match(/^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.*)$/);
      if (!parts) continue;
      const [lo, hi] = parts[1].split("-").map((value) => BigInt(`0x${value}`));
      if (address < lo || address >= hi) continue;
      const module = parts[6];
      const fileOffset = address - lo + BigInt(`0x${parts[3]}`);
      const result = { pc: caller, module, fileOffset: hex(fileOffset) };
      if (!this.segments.has(module)) {
        const segments = [];
        let fd;
        try {
          fd = fs.openSync(module, "r");
          const header = Buffer.alloc(64);
          const count = fs.readSync(fd, header, 0, header.length, 0);
          if (
            count === header.length &&
            header
              .subarray(0, 6)
              .equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1]))
          ) {
            const phoff = header.readBigUInt64LE(32);
            const phsize = header.readUInt16LE(54);
            const phcount = header.readUInt16LE(56);
            const ph = Buffer.alloc(56);
            for (let index = 0; index < phcount; index++) {
              if (
                fs.readSync(
                  fd,
                  ph,
                  0,
                  ph.length,
                  Number(phoff) + index * phsize,
                ) !== ph.length
              )
                break;
              if (ph.readUInt32LE(0) === 1)
                segments.push([
                  ph.readBigUInt64LE(8),
                  ph.readBigUInt64LE(16),
                  ph.readBigUInt64LE(32),
                ]);
            }
          }
        } catch {
          // A removed binary or a non-file mapping has no available ELF image.
        } finally {
          if (fd !== undefined) fs.closeSync(fd);
        }
        this.segments.set(module, segments);
      }
      // File offsets and ELF virtual addresses need not agree. Respect PT_LOAD
      // before computing the load bias used to symbolize an absolute caller PC.
      for (const [offset, vaddr, size] of this.segments.get(module)) {
        if (fileOffset >= offset && fileOffset < offset + size) {
          const virtualAddress = fileOffset - offset + vaddr;
          result.elfVirtualAddress = hex(virtualAddress);
          result.elfLoadBias = hex(address - virtualAddress);
          break;
        }
      }
      return result;
    }
    return { pc: caller, module: null };
  }
}

class Sampling {
  constructor(source) {
    const contents = fs.readFileSync(source, "utf8");
    const body = contents.match(/enum CallCode\s*\{([\s\S]*?)CALL_COUNT/);
    if (!body) throw new Error(`CallCode enum absent from ${source}`);
    this.codes = new Map(
      [...body[1].matchAll(/C_(\w+)/g)].map((match, index) => [
        match[1],
        index,
      ]),
    );
    this.buckets = new Map();
    this.resets = 0;
    this.ambiguous = 0;
  }

  count(record, lifetimeId = null) {
    const name = record.call;
    const isPoll =
      SYNC_POLL.has(name) ||
      name.startsWith("glGetQueryObject") ||
      name === "eglGetCurrentContext" ||
      name === "glXGetCurrentContext";
    if (!isPoll) return [1n, 1n];
    const args = (record.args ?? []).map(integer);
    const slot = get(record, "slot", 0);
    const object = integer(record.object);
    const context = integer(record.context);
    const signature = tupleKey([name, slot, object, context, args]);
    const seen = integer(get(record, "seen", 1));
    if (!this.codes.has(name)) {
      this.ambiguous++;
      return [1n, 1n];
    }
    let key =
      object ^
      (context >> 3n) ^
      (BigInt(this.codes.get(name) * 8 + slot + 1) << 43n);
    for (const arg of args) key = ((key ^ arg) * 1099511628211n) & UINT64_MASK;
    if (key === 0n) key = 1n;
    const bucket = tupleKey([
      record.pid,
      record.tid,
      (key ^ (key >> 32n)) & 1023n,
    ]);
    const prior = this.buckets.get(bucket);
    let globalDelta = 1n;
    let lifetimeDelta = 1n;
    if (prior) {
      if (prior.signature === signature && seen > prior.seen) {
        globalDelta = seen - prior.seen;
        if (prior.lifetimeId === lifetimeId) lifetimeDelta = globalDelta;
      } else this.resets++;
    }
    this.buckets.set(bucket, { signature, seen, lifetimeId });
    return [globalDelta, lifetimeDelta];
  }
}

function bisect(values, target, right) {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (values[mid] < target || (right && values[mid] === target)) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export async function analyzeNativeTrace(
  trace,
  { events = null, source = DEFAULT_SOURCE, top = 20, allSyncs = false } = {},
) {
  const errors = { count: 0, examples: [] };
  const sceneEvents = [];
  if (events)
    for await (const record of records(events, errors))
      sceneEvents.push(record);
  sceneEvents.sort(
    (a, b) =>
      get(a, "wallTimeMs", get(a, "wallMs", 0)) -
      get(b, "wallTimeMs", get(b, "wallMs", 0)),
  );
  const intervals = [];
  const active = new Map();
  for (const record of sceneEvents) {
    const kind = get(record, "event", "");
    const wall = get(record, "wallTimeMs", get(record, "wallMs"));
    if (kind.endsWith("-start")) active.set(kind.slice(0, -6), record);
    else if (kind.endsWith("-end")) {
      const intervalKind = kind.slice(0, -4);
      const start = active.get(intervalKind);
      active.delete(intervalKind);
      if (start)
        intervals.push({
          kind: intervalKind,
          name: get(start, "name"),
          startWallMs: get(start, "wallTimeMs", get(start, "wallMs")),
          endWallMs: wall,
          completed: get(record, "completed"),
          pass: get(record, "pass"),
        });
    }
  }
  for (const [kind, start] of active)
    intervals.push({
      kind,
      name: get(start, "name"),
      startWallMs: get(start, "wallTimeMs", get(start, "wallMs")),
      endWallMs: null,
      completed: null,
    });
  const scenes = (wall) =>
    intervals
      .filter(
        (interval) =>
          wall != null &&
          interval.startWallMs <= wall &&
          (interval.endWallMs === null || wall <= interval.endWallMs),
      )
      .map(({ kind, name }) => ({ kind, name }));
  const sampling = new Sampling(source);
  const callerMaps = new CallerMaps(path.dirname(trace));
  const processes = new Map();
  const resolved = new Map();
  const current = new Map();
  const generations = new Map();
  const lifetimes = [];
  const flushes = new Map();
  const overflows = [];
  const initializations = [];
  const queryRecords = new Map();

  function processFor(pid) {
    if (!processes.has(pid))
      processes.set(pid, {
        pid,
        calls: {},
        contexts: {},
        firstWallMs: null,
        lastWallMs: null,
        nativeSyncCreates: 0,
        nativePollRecords: 0,
      });
    return processes.get(pid);
  }

  function newLifetime(record, key, created) {
    const encodedKey = tupleKey(key);
    const generation = (generations.get(encodedKey) ?? 0) + 1;
    generations.set(encodedKey, generation);
    const binding =
      resolved.get(
        tupleKey([record.pid, record.call, get(record, "slot", 0)]),
      ) ?? {};
    const life = {
      pid: record.pid,
      layer: get(record, "layer"),
      api: key[2],
      ...(key[2] === "EGL" ? { syncDisplay: hex(key[3]) } : {}),
      slot: get(record, "slot", 0),
      originModule: get(binding, "module"),
      originBase: get(binding, "base"),
      handle: record.object,
      generation,
      id: `${key.map(text).join("/")}/g${generation}`,
      createdWallMs: created ? record.wallMs : null,
      createdMonoNs: created ? get(record, "monoNs") : null,
      firstObservedWallMs: record.wallMs,
      lastObservedWallMs: record.wallMs,
      creationObserved: created,
      createCall: created ? record.call : null,
      createContext: created ? get(record, "context") : null,
      createDisplay: created ? get(record, "display") : null,
      createArgs: created ? get(record, "args") : null,
      attrs: created ? get(record, "attrs", []) : null,
      createCaller: created ? get(record, "caller") : null,
      bindingObservations: [],
      identityAmbiguous: false,
      identityAmbiguities: [],
      providerResolutionIncomplete: false,
      pollRecords: 0,
      pollCountLowerBound: 0n,
      pendingPollCountLowerBound: 0n,
      statusCounts: {},
      pollContexts: {},
      callerSites: {},
      lastStatus: null,
      firstSignalWallMs: null,
      destroyedWallMs: null,
      pendingObservedSpanMs: 0,
      _pendingStart: null,
      _pendingLast: null,
      _pendingStartMono: null,
      _pendingLastMono: null,
      _bindingKeys: new Set(),
      _providerKeys: new Set(),
    };
    current.set(encodedKey, life);
    lifetimes.push(life);
    return life;
  }

  function markAmbiguous(life, reason) {
    life.identityAmbiguous = true;
    if (!life.identityAmbiguities.includes(reason))
      life.identityAmbiguities.push(reason);
  }

  function observeBinding(life, record) {
    const slot = get(record, "slot", 0);
    const binding = resolved.get(tupleKey([record.pid, record.call, slot]));
    const observation = {
      call: record.call,
      slot,
      original: get(binding ?? {}, "original"),
      module: get(binding ?? {}, "module"),
      base: get(binding ?? {}, "base"),
    };
    const key = tupleKey(Object.values(observation));
    if (!life._bindingKeys.has(key)) {
      life._bindingKeys.add(key);
      life.bindingObservations.push(observation);
    }
    if (
      observation.module &&
      observation.module !== "unknown" &&
      observation.base
    ) {
      life._providerKeys.add(tupleKey([observation.module, observation.base]));
      if (life._providerKeys.size > 1)
        markAmbiguous(
          life,
          "Different resolved provider modules share this handle",
        );
    } else life.providerResolutionIncomplete = true;
  }

  for await (const record of records(trace, errors)) {
    const pid = get(record, "pid");
    const kind = get(record, "kind");
    if (kind === "init") {
      initializations.push(record);
      continue;
    }
    if (
      [
        "stack",
        "query-snapshot",
        "frame-pointer",
        "frame-pointer-chain",
      ].includes(kind)
    ) {
      const key = tupleKey([pid, get(record, "stackId")]);
      if (!queryRecords.has(key))
        queryRecords.set(key, {
          pid,
          stackId: get(record, "stackId"),
          stackRecords: 0,
          snapshotRecords: 0,
          seedRecords: 0,
          frames: [],
        });
      const entry = queryRecords.get(key);
      if (kind === "stack") {
        entry.stack = record;
        entry.stackRecords++;
        entry.binding = resolved.get(
          tupleKey([pid, record.call, get(record, "slot", 0)]),
        );
        const family = record.call?.startsWith("egl") ? "EGL" : "GL";
        entry.lifetime = current.get(
          tupleKey([
            pid,
            get(record, "layer"),
            family,
            family === "EGL" ? integer(record.display) : 0n,
            integer(record.object),
          ]),
        );
      } else if (kind === "query-snapshot") {
        entry.snapshot = record;
        entry.snapshotRecords++;
      } else if (kind === "frame-pointer-chain") {
        entry.seed = record;
        entry.seedRecords++;
      } else {
        entry.frames.push(record);
      }
      continue;
    }
    if (kind === "slot-overflow") {
      overflows.push(record);
      continue;
    }
    if (kind === "resolve") {
      resolved.set(tupleKey([pid, record.call, record.slot]), record);
      continue;
    }
    if (kind !== "call") continue;
    const process = processFor(pid);
    const wall = record.wallMs;
    const name = record.call;
    const layer = get(record, "layer", "unknown");
    process.firstWallMs =
      process.firstWallMs === null ? wall : Math.min(process.firstWallMs, wall);
    process.lastWallMs =
      process.lastWallMs === null ? wall : Math.max(process.lastWallMs, wall);
    const object = integer(record.object);
    const family = name.startsWith("egl") ? "EGL" : "GL";
    // EGL objects belong to the display passed to the API, even if a recorder
    // separately reports the calling thread's different current display.
    const syncDisplay =
      family === "EGL"
        ? integer(record.args?.length ? record.args[0] : record.display)
        : 0n;
    const key = [pid, layer, family, syncDisplay, object];
    const encodedKey = tupleKey(key);
    let life = null;
    if (SYNC_CREATE.has(name) && object !== 0n) {
      const previous = current.get(encodedKey);
      if (previous) {
        previous.supersededByReusedHandleWallMs = wall;
        markAmbiguous(
          previous,
          "Another create was observed before destruction of this handle",
        );
      }
      life = newLifetime(record, key, true);
      if (previous) {
        markAmbiguous(
          life,
          "Create overlaps a handle whose destruction was not observed",
        );
        life.overlappingLifetimeId = previous.id;
      }
      if (layer === "native") process.nativeSyncCreates++;
    } else if (
      (SYNC_POLL.has(name) || SYNC_DESTROY.has(name) || SYNC_WAIT.has(name)) &&
      object !== 0n
    )
      life = current.get(encodedKey) ?? newLifetime(record, key, false);
    const [delta, lifetimeDelta] = sampling.count(record, life?.id ?? null);
    const apiKey = `${layer}:${name}`;
    const count = (process.calls[apiKey] ??= {
      records: 0,
      countLowerBound: 0n,
      maxCallMs: 0,
    });
    count.records++;
    count.countLowerBound += delta;
    count.maxCallMs = Math.max(
      count.maxCallMs,
      Number(integer(record.durationNs)) / 1e6,
    );
    const contextKey = `${layer}:${text(get(record, "display"))}:${text(get(record, "context"))}`;
    const context = (process.contexts[contextKey] ??= {
      records: 0,
      countLowerBound: 0n,
      calls: {},
    });
    context.records++;
    context.countLowerBound += delta;
    increment(context.calls, name, delta);
    if (name === "glFlush" || name === "glFinish") {
      const flushKey = tupleKey([
        pid,
        layer,
        get(record, "display"),
        get(record, "context"),
        name,
      ]);
      if (!flushes.has(flushKey)) flushes.set(flushKey, []);
      flushes.get(flushKey).push(wall);
    }
    if (!life) continue;
    observeBinding(life, record);
    life.lastObservedWallMs = wall;
    if (SYNC_DESTROY.has(name)) {
      if (name === "glDeleteSync" || integer(record.result) !== 0n) {
        life.destroyedWallMs = wall;
        life.destroyContext = get(record, "context");
        current.delete(encodedKey);
      } else life.destroyFailed = true;
    }
    if (!SYNC_POLL.has(name)) continue;
    const status = pollStatus(record);
    life.pollRecords++;
    life.pollCountLowerBound += lifetimeDelta;
    increment(life.statusCounts, status);
    life.lastStatus = status;
    life.lastPollWallMs = wall;
    life.lastPollResult = {
      call: name,
      result: get(record, "result"),
      out: get(record, "out"),
      args: get(record, "args"),
    };
    increment(life.callerSites, get(record, "caller", "unknown"));
    const pollContext = (life.pollContexts[contextKey] ??= {
      records: 0,
      countLowerBound: 0n,
    });
    pollContext.records++;
    pollContext.countLowerBound += lifetimeDelta;
    if (layer === "native") process.nativePollRecords++;
    if (status === "pending") {
      // A sample delta crossing a status change is not all pending work.
      life.pendingPollCountLowerBound +=
        life._pendingStart !== null ? lifetimeDelta : 1n;
      if (life._pendingStart === null) {
        life._pendingStart = wall;
        life._pendingStartMono = integer(record.monoNs);
      }
      life._pendingLast = wall;
      life._pendingLastMono = integer(record.monoNs);
      life.pendingObservedSpanMs = Math.max(
        life.pendingObservedSpanMs,
        Number(life._pendingLastMono - life._pendingStartMono) / 1e6,
      );
    } else if (status === "signaled") {
      if (life.firstSignalWallMs === null) life.firstSignalWallMs = wall;
      life._pendingStart = null;
    }
  }

  for (const times of flushes.values()) times.sort((a, b) => a - b);
  for (const life of lifetimes) {
    const wall = life.firstObservedWallMs;
    const end = get(life, "lastPollWallMs", life.lastObservedWallMs);
    life.scenesAtCreation = scenes(wall);
    life.scenesAtLastPoll = scenes(get(life, "lastPollWallMs"));
    life.openAtTraceEnd =
      life.destroyedWallMs === null &&
      !Object.hasOwn(life, "supersededByReusedHandleWallMs");
    life.ageAtLastPendingObservationMs =
      life.createdMonoNs !== null && life._pendingLastMono !== null
        ? Number(life._pendingLastMono - integer(life.createdMonoNs)) / 1e6
        : null;
    life.callerLocations = Object.keys(life.callerSites).map((caller) =>
      callerMaps.describe(life.pid, caller),
    );
    life.createCallerLocation = life.createCaller
      ? callerMaps.describe(life.pid, life.createCaller)
      : null;
    if (life.creationObserved) {
      for (const name of ["glFlush", "glFinish"]) {
        const times =
          flushes.get(
            tupleKey([
              life.pid,
              life.layer,
              life.createDisplay,
              life.createContext,
              name,
            ]),
          ) ?? [];
        const lo = bisect(times, wall, false);
        const hi = bisect(times, end, true);
        life[`${name}OnCreationContext`] = {
          recordsBeforeLastObservation: hi - lo,
          firstAfterCreateWallMs: lo < hi ? times[lo] : null,
          lastBeforeObservationWallMs: hi > lo ? times[hi - 1] : null,
        };
      }
    }
    for (const key of Object.keys(life))
      if (key.startsWith("_")) delete life[key];
  }
  const native = lifetimes.filter((life) => life.layer === "native");
  const ranked = [...native].sort(
    (a, b) =>
      b.pendingObservedSpanMs - a.pendingObservedSpanMs ||
      (b.ageAtLastPendingObservationMs || 0) -
        (a.ageAtLastPendingObservationMs || 0),
  );
  return {
    trace,
    events,
    interpretation:
      "Native lifetimes describe completion at the driver API. Query observations identify a service FIFO front only when identityObserved is true; frontend JavaScript fence IDs remain unmapped. A successful native wait is observed before the service publishes processCount, so inequality with submitCount is expected at that instant. Pending does not identify shader execution versus unscheduled/dependency-blocked driver work. Layer is the observer's path heuristic; verify resolve module/base. Slots are per symbol and do not identify a fence across APIs. Overlapping creates and different resolved provider modules make handle identity ambiguous. Return-only records and sampled parents cannot prove an outer call is blocked. An open lifetime means no destroy or superseding create was observed, not that its process remains alive.",
    countContract:
      "records are emitted observations; countLowerBound uses positive seen deltas only within continuous matching cache keys; per-sync deltas also require the same handle generation. Unlogged tail polls and cache evictions make these lower bounds, not totals.",
    errors,
    slotOverflows: overflows,
    sampling: {
      observedCounterResetsOrCollisions: sampling.resets,
      unknownCallCodes: sampling.ambiguous,
    },
    processes: [...processes.values()],
    resolvedFunctions: [...resolved.values()],
    scenes: intervals,
    // A successful native wait is sampled before ProcessQueries publishes its
    // result. processCount != submitCount is therefore not a failure diagnosis.
    queryObservations: [...queryRecords.values()].map((entry) =>
      queryObservation(entry, initializations, scenes),
    ),
    nativeSyncs: {
      lifetimes: native.length,
      creationObserved: native.filter((life) => life.creationObserved).length,
      signaledObserved: native.filter((life) => life.firstSignalWallMs !== null)
        .length,
      pendingAtLastPoll: native.filter((life) => life.lastStatus === "pending")
        .length,
      unpolled: native.filter((life) => life.pollRecords === 0).length,
      destroyed: native.filter((life) => life.destroyedWallMs !== null).length,
      identityAmbiguous: native.filter((life) => life.identityAmbiguous).length,
    },
    longestNativePending: ranked.slice(0, top),
    ...(allSyncs ? { syncLifetimes: lifetimes } : {}),
  };
}

export function stringifyNativeTraceReport(report, space = 2) {
  // Node 22's rawJSON keeps lower-bound counters as JSON integers without
  // rounding uint64-derived values or changing the Python report's schema.
  return JSON.stringify(
    report,
    (_, value) =>
      typeof value === "bigint" ? JSON.rawJSON(value.toString()) : value,
    space,
  );
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      events: { type: "string" },
      source: { type: "string" },
      output: { type: "string" },
      top: { type: "string", default: "20" },
      "all-syncs": { type: "boolean", default: false },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(
      "Usage: node scripts/native-gl-trace.analyze.mjs TRACE [--events FILE] [--source FILE] [--output FILE] [--top 20] [--all-syncs]",
    );
    return;
  }
  if (positionals.length !== 1)
    throw new Error("Expected one native trace JSONL path");
  const top = Number(values.top);
  if (!Number.isInteger(top)) throw new Error("--top must be an integer");
  const report = await analyzeNativeTrace(positionals[0], {
    events: values.events ?? null,
    source: values.source ?? DEFAULT_SOURCE,
    top,
    allSyncs: values["all-syncs"],
  });
  const output = `${stringifyNativeTraceReport(report)}\n`;
  if (values.output) {
    fs.writeFileSync(values.output, output);
    console.log(
      stringifyNativeTraceReport(
        {
          output: values.output,
          nativeSyncs: report.nativeSyncs,
          errors: report.errors,
        },
        0,
      ),
    );
  } else process.stdout.write(output);
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
)
  await main();
