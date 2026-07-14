import { CloudGenerator } from "./cloud-generator";
import type { CloudParams } from "./cloud-generator";
import type {
  CloudRequest,
  CloudResult,
  CloudResult3D,
} from "./cloud-worker-core";

/**
 * A minimal, fully-specified `CloudParams`, overridable per test so each
 * test states only what it actually varies. `transforms: []` keeps every
 * request cheap — this suite tests the request/response POLICY, never the
 * chaos-game compute itself (see cloud-worker-core.test.ts for that).
 */
function params(overrides: Partial<CloudParams> = {}): CloudParams {
  return {
    transforms: [],
    finalTransform: null,
    numPoints: 10,
    seed: 1,
    symmetry: { order: 1, axis: "y" },
    fourD: false,
    colorMode: "transform",
    colorGamma: 1,
    rampPalette: "legacy",
    replaced: false,
    fit: false,
    ...overrides,
  };
}

/** A minimal `CloudResult3D` tagged with `id`, standing in for whatever a
 * real worker (or the sync fallback) would eventually deliver. */
function fakeResult(id: number): CloudResult3D {
  return {
    id,
    fourD: false,
    positions: new Float32Array(3),
    transformIndices: new Uint8Array(1),
    colors: new Float32Array(3),
    count: 1,
    bounds: {
      minX: 0,
      maxX: 0,
      minY: 0,
      maxY: 0,
      minZ: 0,
      maxZ: 0,
      minR: 0,
      maxR: 0,
    },
    frameBounds: {
      minX: 0,
      maxX: 0,
      minY: 0,
      maxY: 0,
      minZ: 0,
      maxZ: 0,
      minR: 0,
      maxR: 0,
    },
  };
}

/**
 * A fresh `CloudGenerator` wired to a fake worker: `createWorker` captures
 * the `onResult`/`onError` callbacks (so a test can fire them via
 * `deliverResult`/`triggerError`) and records every posted request in
 * `posted`; `computeSync` records its calls in `computeSyncCalls` and
 * answers with `fakeResult(request.id)`; `onResult` records every delivery
 * in `delivered`. Passing `"returns-null"` or `"throws"` makes
 * `createWorker` fail the way a missing worker script or a construction-time
 * throw would, for the permanent-sync-mode tests.
 */
function harness(
  brokenWorker?: "returns-null" | "throws",
  now?: () => number,
): {
  generator: CloudGenerator;
  posted: CloudRequest[];
  delivered: {
    result: CloudResult;
    request: CloudRequest;
    elapsedMs: number;
  }[];
  computeSyncCalls: CloudRequest[];
  terminatedCount: () => number;
  deliverResult: (result: CloudResult) => void;
  triggerError: () => void;
} {
  const posted: CloudRequest[] = [];
  const delivered: {
    result: CloudResult;
    request: CloudRequest;
    elapsedMs: number;
  }[] = [];
  const computeSyncCalls: CloudRequest[] = [];
  let terminated = 0;
  let deliver: ((result: CloudResult) => void) | null = null;
  let fail: (() => void) | null = null;

  const generator = new CloudGenerator({
    createWorker: (onResult, onError) => {
      if (brokenWorker === "returns-null") return null;
      if (brokenWorker === "throws") {
        throw new Error("worker script failed to load");
      }
      deliver = onResult;
      fail = onError;
      return {
        post: (request: CloudRequest) => posted.push(request),
        terminate: () => {
          terminated++;
        },
      };
    },
    computeSync: (request: CloudRequest) => {
      computeSyncCalls.push(request);
      return fakeResult(request.id);
    },
    onResult: (result, request, elapsedMs) => {
      delivered.push({ result, request, elapsedMs });
    },
    now,
  });

  return {
    generator,
    posted,
    delivered,
    computeSyncCalls,
    terminatedCount: () => terminated,
    deliverResult: (result: CloudResult) => deliver?.(result),
    triggerError: () => fail?.(),
  };
}

describe("CloudGenerator request()", () => {
  it("posts the first request immediately with a stamped id when idle", () => {
    const h = harness();

    h.generator.request(params());

    expect(h.posted).toHaveLength(1);
    expect(h.posted[0].id).toBe(1);
    expect(h.delivered).toHaveLength(0);
  });

  it("parks a request made while one is in flight; the in-flight result dispatches it, then delivers", () => {
    const h = harness();

    h.generator.request(params({ seed: 1 })); // A
    expect(h.posted).toHaveLength(1);

    h.generator.request(params({ seed: 2 })); // B, parks while A is in flight
    expect(h.posted).toHaveLength(1); // B not posted yet

    h.deliverResult(fakeResult(1)); // A's result, matching id 1

    expect(h.posted).toHaveLength(2); // B now posted
    expect(h.posted[1].seed).toBe(2);
    expect(h.delivered).toHaveLength(1);
    expect(h.delivered[0].result.id).toBe(1);
    expect(h.delivered[0].request).toBe(h.posted[0]); // A's own request object

    h.deliverResult(fakeResult(2)); // B's result

    expect(h.delivered).toHaveLength(2);
    expect(h.delivered[1].result.id).toBe(2);
    expect(h.delivered[1].request).toBe(h.posted[1]);
    expect(h.posted).toHaveLength(2); // nothing further posted
  });

  it("collapses multiple requests parked while one is in flight to just the latest", () => {
    const h = harness();

    h.generator.request(params({ seed: 1 })); // A, posted
    h.generator.request(params({ seed: 2, numPoints: 20 })); // B, parked
    h.generator.request(params({ seed: 3, numPoints: 30 })); // C, parked, replaces B
    expect(h.posted).toHaveLength(1);

    h.deliverResult(fakeResult(1)); // A's result

    expect(h.posted).toHaveLength(2); // exactly one more post
    expect(h.posted[1].seed).toBe(3);
    expect(h.posted[1].numPoints).toBe(30);
  });

  it("OR-merges replaced/fit flags when a pending request is superseded before it posts", () => {
    const h = harness();

    h.generator.request(params({ seed: 1 })); // A, posted
    h.generator.request(params({ seed: 2, replaced: true, fit: true })); // B, parked
    h.generator.request(params({ seed: 3, replaced: false, fit: false })); // C, replaces B

    h.deliverResult(fakeResult(1)); // dispatches the coalesced pending request

    expect(h.posted).toHaveLength(2);
    expect(h.posted[1].seed).toBe(3); // C's params otherwise...
    expect(h.posted[1].replaced).toBe(true); // ...but the flags OR together
    expect(h.posted[1].fit).toBe(true);
  });

  it("drops a result whose id does not match the in-flight request, without unblocking the pump", () => {
    const h = harness();

    h.generator.request(params({ seed: 1 })); // A, id 1, posted

    h.deliverResult(fakeResult(999)); // unknown/stale id

    expect(h.delivered).toHaveLength(0);
    expect(h.posted).toHaveLength(1); // still nothing new posted

    h.deliverResult(fakeResult(1)); // the real A result

    expect(h.delivered).toHaveLength(1);
    expect(h.delivered[0].result.id).toBe(1);
  });
});

describe("CloudGenerator worker error recovery", () => {
  it("a worker error mid-flight computes the freshest pending request synchronously, terminates the worker, and falls back to sync mode", () => {
    const h = harness();

    h.generator.request(params({ seed: 1 })); // A, in flight
    h.generator.request(params({ seed: 2 })); // B, parked

    h.triggerError();

    expect(h.computeSyncCalls).toHaveLength(1);
    expect(h.computeSyncCalls[0].seed).toBe(2); // B, the freshest outstanding request
    expect(h.delivered).toHaveLength(1);
    expect(h.delivered[0].request.seed).toBe(2);
    expect(h.terminatedCount()).toBe(1);
    expect(h.posted).toHaveLength(1); // B was parked, never actually posted to the worker

    h.generator.request(params({ seed: 3 })); // now permanently synchronous

    expect(h.computeSyncCalls).toHaveLength(2);
    expect(h.delivered).toHaveLength(2);
    expect(h.delivered[1].request.seed).toBe(3);
    expect(h.posted).toHaveLength(1); // nothing posted to the (dead) worker
  });

  it("a worker error with nothing pending re-runs the in-flight request synchronously", () => {
    const h = harness();

    h.generator.request(params({ seed: 5 })); // A, in flight, nothing parked

    h.triggerError();

    expect(h.computeSyncCalls).toHaveLength(1);
    expect(h.computeSyncCalls[0].seed).toBe(5);
    expect(h.delivered).toHaveLength(1);
    expect(h.delivered[0].request.seed).toBe(5);
    expect(h.terminatedCount()).toBe(1);
  });

  it("a second error event after the first is a no-op", () => {
    const h = harness();

    h.generator.request(params({ seed: 1 })); // A, in flight
    h.triggerError();
    expect(h.computeSyncCalls).toHaveLength(1);
    expect(h.terminatedCount()).toBe(1);

    h.triggerError(); // fires again

    expect(h.computeSyncCalls).toHaveLength(1); // unchanged
    expect(h.terminatedCount()).toBe(1); // unchanged
    expect(h.delivered).toHaveLength(1); // unchanged
  });
});

describe("CloudGenerator broken worker at construction", () => {
  it("falls back to synchronous compute for every request when createWorker returns null", () => {
    const h = harness("returns-null");

    h.generator.request(params({ seed: 1 }));
    h.generator.request(params({ seed: 2 }));

    expect(h.posted).toHaveLength(0);
    expect(h.computeSyncCalls).toHaveLength(2);
    expect(h.delivered).toHaveLength(2);
    expect(h.delivered[0].request.seed).toBe(1);
    expect(h.delivered[1].request.seed).toBe(2);
  });

  it("falls back to synchronous compute for every request when createWorker throws", () => {
    const h = harness("throws");

    h.generator.request(params({ seed: 1 }));
    h.generator.request(params({ seed: 2 }));

    expect(h.posted).toHaveLength(0);
    expect(h.computeSyncCalls).toHaveLength(2);
    expect(h.delivered).toHaveLength(2);
    expect(h.delivered[0].request.seed).toBe(1);
    expect(h.delivered[1].request.seed).toBe(2);
  });
});

describe("CloudGenerator generateSync", () => {
  it("delivers immediately and supersedes an older in-flight worker result", () => {
    const h = harness();

    h.generator.request(params({ seed: 1 })); // A, in flight
    expect(h.posted).toHaveLength(1);

    h.generator.generateSync(params({ seed: 99 })); // delivered immediately

    expect(h.delivered).toHaveLength(1);
    expect(h.delivered[0].request.seed).toBe(99);
    expect(h.computeSyncCalls).toHaveLength(1);

    h.deliverResult(fakeResult(1)); // A's now-stale result arrives late

    expect(h.delivered).toHaveLength(1); // still just the sync delivery
  });

  it("drops a request parked before it ran — the sync generation snapshots newer state, superseding it whole", () => {
    const h = harness();

    h.generator.request(params({ seed: 1 })); // A, in flight, id 1
    h.generator.request(params({ seed: 2 })); // B, parked, id 2 (stamped, unsent)
    expect(h.posted).toHaveLength(1);

    h.generator.generateSync(params({ seed: 99 })); // stamped id 3, delivered inline
    expect(h.delivered).toHaveLength(1);
    expect(h.delivered[0].request.seed).toBe(99);

    h.deliverResult(fakeResult(1)); // A's now-stale result arrives

    // B was built from OLDER state than the sync generation, so it is
    // superseded whole: never dispatched to the worker (no wasted compute
    // whose result the staleness threshold would only swallow anyway), and
    // A's own result is suppressed (its id is below the sync request's id).
    expect(h.posted).toHaveLength(1);
    expect(h.delivered).toHaveLength(1);

    // The pump is idle again: a fresh request posts immediately.
    h.generator.request(params({ seed: 3 }));
    expect(h.posted).toHaveLength(2);
    expect(h.posted[1].seed).toBe(3);
  });
});

describe("CloudGenerator latency reporting (fr-a5gu)", () => {
  it("reports the post-to-reply latency of a worker generation to onResult", () => {
    let clock = 1000;
    const h = harness(undefined, () => clock);

    h.generator.request(params());
    clock += 42;
    h.deliverResult(fakeResult(1));

    expect(h.delivered).toHaveLength(1);
    expect(h.delivered[0].elapsedMs).toBe(42);
  });

  it("times each request from its own post, not the burst's first", () => {
    let clock = 0;
    const h = harness(undefined, () => clock);

    h.generator.request(params()); // id 1 posted at t=0
    clock = 10;
    h.generator.request(params()); // id 2 parked
    clock = 30;
    h.deliverResult(fakeResult(1)); // id 1 done (30ms); id 2 posted at t=30
    clock = 45;
    h.deliverResult(fakeResult(2)); // id 2 done (15ms)

    expect(h.delivered.map((d) => d.elapsedMs)).toEqual([30, 15]);
  });

  it("times the synchronous paths around the compute itself", () => {
    let clock = 0;
    const delivered: number[] = [];
    const generator = new CloudGenerator({
      createWorker: () => null, // permanent synchronous mode
      computeSync: (request) => {
        clock += 7; // the compute is what advances the clock
        return fakeResult(request.id);
      },
      onResult: (_result, _request, elapsedMs) => {
        delivered.push(elapsedMs);
      },
      now: () => clock,
    });

    generator.request(params());
    generator.generateSync(params());

    expect(delivered).toEqual([7, 7]);
  });
});
