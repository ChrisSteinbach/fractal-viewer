import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { Worker } from "node:worker_threads";
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

test("includes a non-leader thread's real child and that child's descendant", async () => {
  const childSource = `
    const { spawn } = require('node:child_process');
    const grandchild = spawn(process.execPath,
      ['-e', "process.stdout.write('ready'); setInterval(() => {}, 1000)"],
      { stdio: ['ignore', 'pipe', 'inherit'] });
    grandchild.stdout.once('data', () => {
      process.stdout.write(JSON.stringify({ child: process.pid, grandchild: grandchild.pid }) + '\\n');
    });
    process.once('SIGTERM', () => {
      grandchild.once('exit', () => process.exit(0));
      grandchild.kill();
    });
  `;
  const worker = new Worker(
    `
      const { parentPort } = require('node:worker_threads');
      const { spawn } = require('node:child_process');
      const { createInterface } = require('node:readline');
      const child = spawn(process.execPath, ['-e', ${JSON.stringify(childSource)}],
        { stdio: ['ignore', 'pipe', 'inherit'] });
      createInterface({ input: child.stdout }).once('line', line => {
        parentPort.postMessage(JSON.parse(line));
      });
      parentPort.once('message', () => child.kill());
      child.once('exit', () => parentPort.close());
    `,
    { eval: true },
  );
  let childInfo;
  try {
    [childInfo] = await once(worker, "message");
    const leaderChildren = (
      await fs.readFile(
        `/proc/${process.pid}/task/${process.pid}/children`,
        "utf8",
      )
    )
      .trim()
      .split(/\s+/)
      .map(Number);
    // This fixture exercises exactly the old blind spot, independently of
    // the sampler: the process leader cannot see the worker's child.
    assert.ok(!leaderChildren.includes(childInfo.child));
    const sample = await sampleProcessTreeRss(process.pid);
    for (const pid of [process.pid, childInfo.child, childInfo.grandchild]) {
      assert.ok(sample.sampledPids.includes(pid), `Missing descendant ${pid}`);
      assert.equal(
        sample.sampledPids.filter((value) => value === pid).length,
        1,
      );
    }
    assert.ok(sample.knownRssBytes > 0);
  } finally {
    if (childInfo) {
      const exited = once(worker, "exit");
      worker.postMessage("stop");
      await exited;
    } else {
      await worker.terminate();
    }
  }
});

function mockProcFiles(t, files, directories) {
  const read = (collection, path) => {
    const value = collection[path];
    if (value instanceof Error) throw value;
    if (value === undefined)
      throw Object.assign(new Error(`Missing fixture ${path}`), {
        code: "ENOENT",
      });
    return value;
  };
  t.mock.method(fs, "readFile", async (path) => read(files, path));
  t.mock.method(fs, "readdir", async (path) => read(directories, path));
}

const procStatus = (parent, rssKb) => `PPid:\t${parent}\nVmRSS:\t${rssKb} kB\n`;

test("unions all task children but counts each process RSS only once", async (t) => {
  mockProcFiles(
    t,
    {
      "/proc/101/status": procStatus(1, 10),
      "/proc/101/task/101/children": "201\n",
      "/proc/101/task/102/children": "201 301\n",
      "/proc/201/status": procStatus(101, 20),
      "/proc/201/task/201/children": "\n",
      "/proc/301/status": procStatus(101, 30),
      "/proc/301/task/301/children": "",
      "/proc/301/task/302/children": "",
    },
    {
      "/proc/101/task": ["101", "102"],
      "/proc/201/task": ["201"],
      "/proc/301/task": ["301", "302"],
    },
  );
  assert.deepEqual(await sampleProcessTreeRss(101), {
    rootPid: 101,
    status: "ok",
    rssBytes: 60 * 1024,
    knownRssBytes: 60 * 1024,
    sampledPids: [101, 201, 301],
    unavailableProcessCount: 0,
    issues: [],
  });
});

test("keeps known descendants when another task disappears or is unreadable", async (t) => {
  mockProcFiles(
    t,
    {
      "/proc/101/status": procStatus(1, 10),
      "/proc/101/task/101/children": "201",
      "/proc/101/task/103/children": Object.assign(new Error("denied"), {
        code: "EACCES",
      }),
      "/proc/201/status": procStatus(101, 20),
      "/proc/201/task/201/children": "",
    },
    {
      "/proc/101/task": ["101", "102", "103"],
      "/proc/201/task": ["201"],
    },
  );
  const sample = await sampleProcessTreeRss(101);
  assert.equal(sample.status, "partial");
  assert.equal(sample.rssBytes, null);
  assert.equal(sample.knownRssBytes, 30 * 1024);
  assert.deepEqual(sample.sampledPids, [101, 201]);
  assert.deepEqual(
    sample.issues.map(({ path, reason }) => ({ path, reason })),
    [
      { path: "/proc/101/task/102/children", reason: "ENOENT" },
      { path: "/proc/101/task/103/children", reason: "EACCES" },
    ],
  );
});

test("refuses incomplete task enumeration instead of claiming an empty child tree", async (t) => {
  for (const tasks of [
    [],
    ["101", "invalid"],
    Object.assign(new Error("denied"), { code: "EACCES" }),
  ]) {
    mockProcFiles(
      t,
      {
        "/proc/101/status": procStatus(1, 10),
        "/proc/101/task/101/children": "",
      },
      { "/proc/101/task": tasks },
    );
    const sample = await sampleProcessTreeRss(101);
    assert.equal(sample.status, "partial");
    assert.equal(sample.rssBytes, null);
    assert.equal(sample.knownRssBytes, 10 * 1024);
    assert.ok(sample.issues.length > 0);
    t.mock.restoreAll();
  }
});

test("a malformed non-leader children file cannot produce a complete total", async (t) => {
  mockProcFiles(
    t,
    {
      "/proc/101/status": procStatus(1, 10),
      "/proc/101/task/101/children": "",
      "/proc/101/task/102/children": "201 invalid",
    },
    { "/proc/101/task": ["101", "102"] },
  );
  const sample = await sampleProcessTreeRss(101);
  assert.equal(sample.status, "partial");
  assert.equal(sample.rssBytes, null);
  assert.equal(sample.knownRssBytes, 10 * 1024);
  assert.match(sample.issues[0].reason, /invalid pid/);
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
