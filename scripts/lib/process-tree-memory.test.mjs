import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import test from "node:test";

import {
  attributeProcessTreeRssTimeline,
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

test("attributes a timeline to phases with exact bytes when every sample is complete", () => {
  const attribution = attributeProcessTreeRssTimeline([
    { atMs: 0, stage: "before-run", rssBytes: 1_000 },
    { atMs: 100, stage: "controls", rssBytes: 2_000 },
    { atMs: 200, stage: "controls", rssBytes: 2_500 },
    { atMs: 300, stage: "render", completedTiles: 0, rssBytes: 3_000 },
    { atMs: 400, stage: "render", completedTiles: 3, rssBytes: 5_000 },
    { atMs: 500, stage: "render", completedTiles: 7, rssBytes: 4_000 },
    { atMs: 600, stage: "base64", rssBytes: 6_000 },
  ]);
  assert.equal(attribution.status, "ok");
  assert.equal(attribution.sampleCount, 7);
  assert.equal(attribution.baselineRssBytes, 1_000);
  assert.equal(attribution.peakRssBytes, 6_000);
  assert.deepEqual(
    attribution.phases.map((phase) => phase.stage),
    ["before-run", "controls", "render", "base64"],
  );
  const render = attribution.phases.find((phase) => phase.stage === "render");
  assert.equal(render.rssStartBytes, 3_000);
  assert.equal(render.rssMaxBytes, 5_000);
  assert.equal(render.rssEndBytes, 4_000);
  assert.deepEqual(
    attribution.renderTileBands.map((band) => band.tilesFrom),
    [0, 3, 7],
  );
  assert.equal(attribution.renderTileBands[0].rssMaxBytes, 3_000);
});

test("buckets the render phase into equal completed-tile bands", () => {
  const samples = [];
  for (let tile = 0; tile < 8; tile++)
    samples.push({
      atMs: tile * 100,
      stage: "render",
      completedTiles: tile,
      rssBytes: 1_000 + tile * 100,
    });
  const attribution = attributeProcessTreeRssTimeline(samples, {
    renderTileBands: 4,
  });
  assert.equal(attribution.renderTileBands.length, 4);
  assert.deepEqual(
    attribution.renderTileBands.map((band) => [band.tilesFrom, band.tilesTo]),
    [
      [0, 1],
      [2, 3],
      [4, 5],
      [6, 7],
    ],
  );
  assert.equal(attribution.renderTileBands[0].rssMaxBytes, 1_100);
  assert.equal(attribution.renderTileBands[3].rssMaxBytes, 1_700);
});

test("degrades to known lower bounds when a sample is partial", () => {
  const attribution = attributeProcessTreeRssTimeline([
    { atMs: 0, stage: "render", completedTiles: 0, rssBytes: 1_000 },
    { atMs: 100, stage: "render", completedTiles: 1, knownRssBytes: 1_500 },
  ]);
  assert.equal(attribution.status, "partial");
  assert.equal(attribution.peakRssBytes, null);
  assert.equal(attribution.knownPeakRssBytes, 1_500);
  assert.equal(attribution.phases[0].status, "partial");
  assert.equal(attribution.phases[0].rssMaxBytes, null);
  assert.equal(attribution.phases[0].knownRssMaxBytes, 1_500);
  // Band [0,0] holds only the complete sample; band [1,1] the partial one.
  assert.equal(attribution.renderTileBands[0].status, "ok");
  assert.equal(attribution.renderTileBands[1].status, "partial");
});

test("merges a re-entered stage and reports an empty timeline as unknown", () => {
  const merged = attributeProcessTreeRssTimeline([
    { atMs: 0, stage: "render", completedTiles: 0, rssBytes: 1_000 },
    { atMs: 50, stage: "assemble", rssBytes: 2_000 },
    { atMs: 100, stage: "render", completedTiles: 1, rssBytes: 3_000 },
  ]);
  assert.deepEqual(
    merged.phases.map((phase) => phase.stage),
    ["render", "assemble"],
  );
  assert.equal(merged.phases[0].samples, 2);
  const empty = attributeProcessTreeRssTimeline([]);
  assert.equal(empty.status, "unknown");
  assert.equal(empty.phases.length, 0);
  assert.equal(empty.renderTileBands, null);
});
