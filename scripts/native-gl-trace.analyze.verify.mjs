#!/usr/bin/env node
/**
 * Offline analyzer behavior checks: no browser, driver or GL library is loaded.
 * node scripts/native-gl-trace.analyze.verify.mjs [--source=EXACT_GENERATED_C]
 *      [--outdir=scripts/out/native-gl-trace-analyzer-check]
 * Fixtures assert observable fence identity/status/count contracts, not golden
 * copies of the report or the recorder's sampling implementation.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  analyzeNativeTrace,
  stringifyNativeTraceReport,
} from "./native-gl-trace.analyze.mjs";

const { values } = parseArgs({
  options: {
    source: {
      type: "string",
      default: path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "out/native-gl-trace/native-gl-trace.c",
      ),
    },
    outdir: {
      type: "string",
      default: "scripts/out/native-gl-trace-analyzer-check",
    },
  },
});
assert(values.source, "--source must name the exact generated observer C");
const outdir = path.resolve(values.outdir);
await fs.mkdir(outdir, { recursive: true });
const PROVIDER_A = "/mock/provider-a.so";
const PROVIDER_B = "/mock/provider-b.so";

function resolve(call, slot = 0, module = PROVIDER_A) {
  const base = module === PROVIDER_A ? 0x400000 : 0x800000;
  return {
    kind: "resolve",
    pid: 7,
    tid: 7,
    call,
    slot,
    layer: "native",
    module,
    base: `0x${base.toString(16)}`,
    original: `0x${(base + call.length * 256 + slot).toString(16)}`,
  };
}

function call(name, tick, options = {}) {
  return {
    kind: "call",
    pid: 7,
    tid: 7,
    wallMs: 1000 + tick,
    monoNs: String((1000 + tick) * 1e6),
    id: String(tick + 1),
    parent: "0",
    call: name,
    slot: 0,
    layer: "native",
    object: "0x1234",
    context: "0x22",
    display: "0x0",
    caller: "0x401000",
    args: [],
    result: "0",
    out: null,
    attrs: [],
    seen: "1",
    durationNs: "100",
    ...options,
  };
}

const create = (tick, options) =>
  call("glFenceSync", tick, {
    args: ["37143", "0"],
    result: "0x1234",
    ...options,
  });
const wait = (tick, seen, signaled = false, options) =>
  call("glClientWaitSync", tick, {
    slot: 1,
    args: ["4660", "0", "0"],
    result: String(signaled ? 0x911a : 0x911b),
    seen: String(seen),
    ...options,
  });
const destroy = (tick, options) =>
  call("glDeleteSync", tick, { args: ["4660"], ...options });
const sameProvider = [
  resolve("glFenceSync"),
  resolve("glClientWaitSync", 1),
  resolve("glDeleteSync"),
];
const checked = [];

async function fixture(name, rows) {
  const trace = path.join(outdir, `${name}.jsonl`);
  await fs.writeFile(
    trace,
    rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
  );
  const report = await analyzeNativeTrace(trace, {
    source: values.source,
    allSyncs: true,
  });
  assert.equal(report.errors.count, 0, `${name} trace parsing`);
  await fs.writeFile(
    path.join(outdir, `${name}-report.json`),
    stringifyNativeTraceReport(report) + "\n",
  );
  return report;
}

const slots = await fixture("per-function-slots", [
  ...sameProvider,
  create(0),
  wait(1, 1),
  wait(10, 256),
  wait(11, 257, true),
  destroy(12),
]);
assert.equal(
  slots.nativeSyncs.lifetimes,
  1,
  "Function-local slot numbers must not split one fence",
);
assert.equal(slots.syncLifetimes[0].pollCountLowerBound, 257n);
assert.equal(slots.syncLifetimes[0].pendingPollCountLowerBound, 256n);
assert.equal(slots.syncLifetimes[0].identityAmbiguous, false);
assert.deepEqual(
  slots.syncLifetimes[0].bindingObservations.map(({ call, slot }) => [
    call,
    slot,
  ]),
  [
    ["glFenceSync", 0],
    ["glClientWaitSync", 1],
    ["glDeleteSync", 0],
  ],
);
checked.push(
  "Different per-function slots preserve one fence and actual binding provenance",
);

const generations = await fixture("pointer-generations", [
  ...sameProvider,
  create(0),
  wait(1, 1),
  wait(2, 256),
  wait(3, 257, true),
  destroy(4),
  create(5),
  wait(6, 512),
  wait(7, 1),
  wait(8, 2, true),
  destroy(9),
]);
assert.deepEqual(
  generations.syncLifetimes.map((life) => life.generation),
  [1, 2],
);
assert.equal(generations.syncLifetimes[0].pollCountLowerBound, 257n);
assert.equal(
  generations.syncLifetimes[1].pollCountLowerBound,
  3n,
  "A recycled handle must not inherit polls counted before its creation",
);
assert.equal(generations.syncLifetimes[1].pendingPollCountLowerBound, 2n);
assert(generations.sampling.observedCounterResetsOrCollisions > 0);
checked.push(
  "Pointer reuse splits generations while sampled-counter resets remain lower bounds",
);

const eglRows = [];
for (const [index, suffix] of ["", "KHR"].entries()) {
  const offset = index * 10;
  const handle = `0x${(0x2000 + index).toString(16)}`;
  const names = ["eglCreateSync", "eglClientWaitSync", "eglDestroySync"].map(
    (name) => name + suffix,
  );
  const args = ["136", String(0x2000 + index), "0", "0"];
  eglRows.push(
    resolve(names[0]),
    resolve(names[1], 1),
    resolve(names[2]),
    call(names[0], offset, {
      object: handle,
      display: "0xaa",
      args: ["136", String(0x30f9), "0"],
      result: handle,
    }),
    call(names[1], offset + 1, {
      slot: 1,
      object: handle,
      display: "0xbb",
      args,
      result: String(0x30f5),
    }),
    call(names[1], offset + 2, {
      slot: 1,
      object: handle,
      display: "0xcc",
      args,
      result: String(0x30f6),
      seen: "2",
    }),
    call(names[2], offset + 3, {
      object: handle,
      display: "0xdd",
      args: args.slice(0, 2),
      result: "1",
    }),
  );
}
const egl = await fixture("egl-status-and-display", eglRows);
assert.equal(egl.nativeSyncs.lifetimes, 2);
for (const life of egl.syncLifetimes) {
  assert.deepEqual(life.statusCounts, { pending: 1, signaled: 1 });
  assert.equal(life.firstSignalWallMs, life.createdWallMs + 2);
  assert.equal(
    life.syncDisplay,
    "0x88",
    "The API's explicit EGLDisplay owns its sync",
  );
  assert.equal(
    life.createDisplay,
    "0xaa",
    "Keep reported current display for flush correlation",
  );
  assert.equal(life.pollCountLowerBound, 2n);
}
checked.push(
  "Core/KHR EGL timeout and signal values; explicit object display survives current-display changes",
);

const ambiguity = await fixture("provider-ambiguity", [
  ...sameProvider,
  resolve("glClientWaitSync", 2, PROVIDER_B),
  resolve("glFenceSync", 1, PROVIDER_B),
  resolve("glDeleteSync", 1, PROVIDER_B),
  create(0),
  wait(1, 1),
  wait(2, 1, false, { slot: 2 }),
  create(3, { slot: 1 }),
  wait(4, 2, true, { slot: 2 }),
  destroy(5, { slot: 1 }),
]);
assert.equal(ambiguity.nativeSyncs.identityAmbiguous, 2);
const [first, second] = ambiguity.syncLifetimes;
assert(
  first.identityAmbiguities.some((reason) =>
    reason.includes("Different resolved provider modules"),
  ),
);
assert.equal(second.overlappingLifetimeId, first.id);
assert.equal(first.destroyedWallMs, null);
assert.equal(second.generation, 2);
checked.push(
  "Provider collisions and overlapping creates disclose ambiguity without unique attribution",
);

function queryRows(pid = 7, signaled = false) {
  const base = BigInt(pid) * 0x100000000n;
  const address = (value) => `0x${(base + value).toString(16)}`;
  const offsets = [0x77d8dc0n, 0x76eb081n, 0xbf7ed2en, 0xbf2837dn, 0xd181420n];
  const frameAddress = (index) => `0x${(0x700000 + index * 0x40).toString(16)}`;
  const shared = { pid, tid: pid, stackId: "91" };
  return [
    {
      kind: "init",
      pid: pid + 100,
      wallMs: 999,
      executableBase: address(0n),
      executableBuildId: "5f6e1a6835b28b53be4483a0c48063fd3fcb3108",
      queryLayoutValidated: true,
      framePointerLayoutValidated: true,
    },
    ...sameProvider.map((row) => ({ ...row, pid, tid: pid })),
    { ...create(0), pid, tid: pid },
    { ...wait(1, 1), pid, tid: pid },
    {
      kind: "stack",
      ...shared,
      call: "glClientWaitSync",
      slot: 1,
      layer: "native",
      object: "0x1234",
      context: "0x22",
      display: "0x0",
      caller: address(offsets[0]),
      result: String(signaled ? 0x911a : 0x911b),
      wallMs: 1002,
      monoNs: "1002000000",
      queryLayoutValidated: true,
      reason: signaled ? "successful-query" : "pending-timeout",
    },
    {
      kind: "frame-pointer-chain",
      ...shared,
      seedFp: frameAddress(0),
      seedR13: "0x9000",
    },
    ...offsets.map((offset, index) => ({
      kind: "frame-pointer",
      ...shared,
      index,
      base: address(0n),
      offset: `0x${offset.toString(16)}`,
      pc: address(offset),
      fp: frameAddress(index),
      previousFp: frameAddress(index + 1),
      returnPc: address(offsets[index + 1] ?? 0x12345n),
      belowReadOk: true,
      savedBelow: ["0x0", "0xa000", "0x0", "0xb000"],
    })),
    {
      kind: "query-snapshot",
      ...shared,
      frameFound: true,
      readOk: true,
      syncReadOk: true,
      targetMatches: true,
      recovery: "verified-frame-pointer",
      pc: address(offsets[4]),
      query: "0x9000",
      decoder: "0xa000",
      target: 0x84f8,
      serviceId: 9,
      querySync: "0xc000",
      submitCount: 1,
      processCount: 0,
      queryResult: "0",
      shadowFence: "0xb000",
      commandsFence: "0x0",
      fenceObject: "0xb000",
      fenceObjectMatches: true,
      angleSyncReadOk: true,
      angleSync: "0x2",
    },
  ];
}

const queries = await fixture("query-identity", [
  ...queryRows(),
  ...queryRows(8, true),
]);
assert.equal(queries.queryObservations.length, 2);
assert(queries.queryObservations.every((row) => row.identityObserved));
assert.deepEqual(
  queries.queryObservations.map((row) => row.native.status),
  ["pending", "signaled"],
);
assert(
  queries.queryObservations.every(
    (row) => row.query.processCount !== row.query.submitCount,
  ),
);
assert(queries.queryObservations.every((row) => row.native.generation === 1));
assert(
  queries.queryObservations.every(
    (row) => row.guards.provenance === "matching-image-initialization",
  ),
);
assert(
  queries.queryObservations.every((row) => !row.frontendFenceMappingObserved),
);

const negatives = {
  "missing-snapshot": (rows) =>
    rows.filter((row) => row.kind !== "query-snapshot"),
  "duplicate-snapshot": (rows) => [
    ...rows,
    rows.find((row) => row.kind === "query-snapshot"),
  ],
  "missing-init": (rows) => rows.filter((row) => row.kind !== "init"),
  "ambiguous-init": (rows) => [...rows, { ...rows[0], pid: 999 }],
  "wrong-build": (rows) =>
    rows.map((row) =>
      row.kind === "init" ? { ...row, executableBuildId: "wrong" } : row,
    ),
  "unvalidated-layout": (rows) =>
    rows.map((row) =>
      row.kind === "init"
        ? { ...row, framePointerLayoutValidated: false }
        : row,
    ),
  "wrong-thread": (rows) =>
    rows.map((row) =>
      row.kind === "query-snapshot" ? { ...row, tid: 8 } : row,
    ),
  "wrong-pid": (rows) =>
    rows.map((row) =>
      row.kind === "query-snapshot" ? { ...row, pid: 8 } : row,
    ),
  "unknown-recovery": (rows) =>
    rows.map((row) =>
      row.kind === "query-snapshot" ? { ...row, recovery: "unknown" } : row,
    ),
  "wrong-target": (rows) =>
    rows.map((row) =>
      row.kind === "query-snapshot" ? { ...row, target: 0x84f7 } : row,
    ),
  "wrong-pc": (rows) =>
    rows.map((row) =>
      row.kind === "query-snapshot" ? { ...row, pc: "0x1" } : row,
    ),
  "wrong-fence": (rows) =>
    rows.map((row) =>
      row.kind === "query-snapshot" ? { ...row, shadowFence: "0xb008" } : row,
    ),
  "wrong-register": (rows) =>
    rows.map((row) =>
      row.kind === "frame-pointer" && row.index === 2
        ? { ...row, savedBelow: [] }
        : row,
    ),
  "wrong-seed": (rows) =>
    rows.map((row) =>
      row.kind === "frame-pointer-chain" ? { ...row, seedR13: "0x9008" } : row,
    ),
  "duplicate-frame": (rows) => [
    ...rows,
    rows.find((row) => row.kind === "frame-pointer" && row.index === 2),
  ],
  "unresolved-provider": (rows) => rows.filter((row) => row.kind !== "resolve"),
  "wait-failed": (rows) =>
    rows.map((row) =>
      row.kind === "stack" ? { ...row, result: String(0x911d) } : row,
    ),
};
for (const [name, mutate] of Object.entries(negatives)) {
  const report = await fixture(`query-${name}`, mutate(queryRows()));
  assert(report.queryObservations.length > 0);
  assert(
    report.queryObservations.every((row) => !row.identityObserved),
    name,
  );
  assert(
    report.queryObservations.every((row) => row.incompleteReasons.length > 0),
    name,
  );
}
checked.push(
  "Query identity requires complete consistent frame, image, provider and field evidence; PID joins remain separate and counter inequality is not a failure",
);

console.log(JSON.stringify({ outdir, checked }));
