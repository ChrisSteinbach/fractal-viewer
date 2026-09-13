import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import test from "node:test";

import {
  parseProcStatus,
  sampleProcessTreeRss,
  sampleProcessTreeRssPeak,
} from "./process-tree-memory.mjs";

test("parses parent PID and VmRSS without turning a missing value into zero", () => {
  assert.deepEqual(
    parseProcStatus("Name:\tnode\nPPid:\t72\nVmRSS:\t1234 kB\n"),
    { ppid: 72, rssBytes: 1_263_616 },
  );
  assert.deepEqual(parseProcStatus("PPid:\t72\n"), {
    ppid: 72,
    rssBytes: null,
  });
});

test("samples this process with an explicit complete or incomplete verdict", async () => {
  const sample = await sampleProcessTreeRss(process.pid);
  assert.ok(sample.sampledPids.includes(process.pid));
  assert.ok(sample.knownRssBytes !== null && sample.knownRssBytes > 0);
  if (sample.status === "ok") {
    assert.equal(sample.rssBytes, sample.knownRssBytes);
  } else {
    assert.equal(sample.rssBytes, null);
    assert.ok(sample.issues.length > 0);
  }
});

test("reports an invalid root as unknown instead of an empty process tree", async () => {
  const sample = await sampleProcessTreeRss(-1);
  assert.equal(sample.status, "unknown");
  assert.equal(sample.rssBytes, null);
  assert.equal(sample.knownRssBytes, null);
  assert.match(sample.issues[0].reason, /positive safe integer/);
});

test("includes a live child and reports a peak around an async operation", async () => {
  const child = spawn(
    process.execPath,
    ["-e", "process.stdout.write('ready\\n'); setTimeout(() => {}, 1000)"],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  try {
    await once(child.stdout, "data");
    const duringChild = await sampleProcessTreeRss(process.pid);
    assert.ok(duringChild.sampledPids.includes(child.pid));
    const childOnly = await sampleProcessTreeRss(child.pid);
    assert.deepEqual(childOnly.sampledPids, [child.pid]);
    assert.ok(childOnly.knownRssBytes !== null && childOnly.knownRssBytes > 0);

    const baseline = await sampleProcessTreeRss(process.pid);
    const observed = await sampleProcessTreeRssPeak(
      process.pid,
      () => new Promise((resolve) => setTimeout(resolve, 35)),
      { intervalMs: 5, initialSample: baseline },
    );
    assert.equal(observed.value, undefined);
    assert.ok(observed.peak.sampleCount >= 2);
    assert.ok(observed.peak.knownPeakRssBytes !== null);
    if (observed.peak.status === "ok") {
      assert.ok(observed.peak.peakRssBytes !== null);
    } else {
      assert.equal(observed.peak.peakRssBytes, null);
      assert.ok(observed.peak.issues.length > 0);
    }
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await once(child, "exit");
    }
  }
});

test("stops sampling and preserves an operation failure", async () => {
  const expected = new Error("operation failed");
  await assert.rejects(
    sampleProcessTreeRssPeak(process.pid, async () => {
      throw expected;
    }),
    expected,
  );
});
