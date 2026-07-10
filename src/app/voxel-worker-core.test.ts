import { sierpinskiTetrahedron } from "../fractal/presets";
import { clampVoxelResolution } from "../fractal/voxel";
import type { Transform4 } from "../fractal/types";
import {
  voxelAccumBudgetVoxels,
  VoxelWorkerSession,
} from "./voxel-worker-core";
import type {
  VoxelWorkerCommand,
  VoxelWorkerDeps,
  VoxelWorkerEvent,
} from "./voxel-worker-core";

// ---------------------------------------------------------------------------
// Test harness — mirrors flame-worker-core.test.ts's.
// ---------------------------------------------------------------------------

function startCommand(
  overrides: Partial<Extract<VoxelWorkerCommand, { type: "start" }>> = {},
): VoxelWorkerCommand {
  return {
    type: "start",
    transforms: sierpinskiTetrahedron(),
    finalTransform: null,
    resolution: 32,
    colorMode: "transform",
    colorGamma: 1,
    palette: "legacy",
    rampPalette: "legacy",
    iterationsBudget: 500,
    seed: 1,
    order: 1,
    axis: "y",
    ...overrides,
  };
}

/** Row-major 4x4 identity rotor — no rotation, so the rotor-projection step
 * degenerates to "drop w, keep xyz" verbatim — mirrors
 * flame-worker-core.test.ts's own fixture. */
// prettier-ignore
const IDENTITY_ROTOR4 = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

/** A simple pentatope-ish 4D system: every map contracts all of 4-space
 * toward the same fixed point, converging to (0.5, 0.5, 0.5, 0.5) — the 4D
 * twin of this file's implicit 3D fixture (`sierpinskiTetrahedron`), just
 * simple enough to reason about by hand — mirrors flame-worker-core.test.ts's
 * own `makeTransforms4`. */
function makeTransforms4(count: number): Transform4[] {
  return Array.from({ length: count }, (): Transform4 => ({
    position: [0.25, 0.25, 0.25, 0.25],
    scale: [0.5, 0.5, 0.5, 0.5],
  }));
}

/** A ready-to-use `fourD` block (see `VoxelWorkerCommand`'s `start` variant)
 * — an inert rotor/center so the projection is "drop w, keep xyz" verbatim,
 * sliceOn false so every point contributes at full weight. Tests that care
 * about a specific field spread over this. */
function defaultFourD(): NonNullable<
  Extract<VoxelWorkerCommand, { type: "start" }>["fourD"]
> {
  return {
    transforms4: makeTransforms4(4),
    finalTransform4: null,
    rotor: IDENTITY_ROTOR4,
    center: [0, 0, 0, 0],
    invWAmp: 1,
    sliceOn: false,
    sliceCenter: 0,
    sliceWidth: 1,
    sliceRelativeColor: false,
    colorMode: "wBlueOrange",
    radiusMin: 0,
    radiusMax: 1,
  };
}

/** A manually-stepped scheduler: `schedule` queues instead of running
 * immediately, so a test can interleave other commands between chunks
 * (`step`) or just drain the whole render (`drain`). */
function stepScheduler(): {
  schedule: (fn: () => void) => void;
  step: () => boolean;
  drain: () => void;
} {
  const queue: (() => void)[] = [];
  return {
    schedule: (fn) => queue.push(fn),
    step: () => {
      const fn = queue.shift();
      if (!fn) return false;
      fn();
      return true;
    },
    drain(): void {
      while (this.step()) {
        /* keep going */
      }
    },
  };
}

/** A clock that advances by `step` (0 by default, so time-driven chunk
 * adaptation and texture throttling are inert unless a test wants them). */
function fakeClock(step = 0): () => number {
  let t = 0;
  return () => {
    const now = t;
    t += step;
    return now;
  };
}

/**
 * A clock that replays a hand-computed sequence of timestamps, one per call —
 * for tests that need to control not just a uniform step but WHICH calls
 * represent accumulate time vs. pack time (see the pack-duty-throttle tests
 * below, where `runChunk` calls `now()` twice per chunk normally and a third
 * time, after `sendGrid`, on any chunk that actually packs). Throws if a test
 * under-anticipated a call, so a wrong call count fails loudly instead of
 * silently returning `undefined`.
 */
function scriptedClock(values: number[]): () => number {
  let i = 0;
  return () => {
    if (i >= values.length) {
      throw new Error(
        `scriptedClock: now() called more times (${i + 1}) than the ${values.length} scripted values`,
      );
    }
    return values[i++];
  };
}

interface Harness {
  session: VoxelWorkerSession;
  events: VoxelWorkerEvent[];
  scheduler: ReturnType<typeof stepScheduler>;
}

function harness(
  overrides: Partial<
    Omit<VoxelWorkerDeps, "emit" | "schedule"> & { now: () => number }
  > = {},
): Harness {
  const events: VoxelWorkerEvent[] = [];
  const scheduler = stepScheduler();
  const session = new VoxelWorkerSession({
    now: overrides.now ?? fakeClock(0),
    schedule: scheduler.schedule,
    emit: (event) => events.push(event),
    createGrid: overrides.createGrid,
    maxVoxels: overrides.maxVoxels,
    initialChunkSize: overrides.initialChunkSize,
    boundsSamples: overrides.boundsSamples ?? 500,
  });
  return { session, events, scheduler };
}

function gridEvents(
  events: VoxelWorkerEvent[],
): Extract<VoxelWorkerEvent, { type: "grid" }>[] {
  return events.filter((e) => e.type === "grid");
}

function noteEvents(
  events: VoxelWorkerEvent[],
): Extract<VoxelWorkerEvent, { type: "resolutionNote" }>[] {
  return events.filter((e) => e.type === "resolutionNote");
}

// ---------------------------------------------------------------------------
// Basic session lifecycle
// ---------------------------------------------------------------------------

describe("VoxelWorkerSession start", () => {
  it("runs to completion and reports the final grid at the full budget", () => {
    const { session, events, scheduler } = harness();
    session.handle(startCommand({ iterationsBudget: 500 }));
    scheduler.drain();

    const grids = gridEvents(events);
    expect(grids.length).toBeGreaterThan(0);
    const last = grids[grids.length - 1];
    expect(last.iterationsDone).toBe(500);
    expect(last.iterationsBudget).toBe(500);
    expect(last.size).toBe(32);
    expect(last.texture).toHaveLength(32 * 32 * 32 * 4);
  });

  it("accumulates real density: the final texture is not all zeros", () => {
    const { session, events, scheduler } = harness();
    session.handle(startCommand({ iterationsBudget: 2000 }));
    scheduler.drain();

    const grids = gridEvents(events);
    const last = grids[grids.length - 1];
    expect(last.texture.some((b) => b > 0)).toBe(true);
    // The bounds are a cube (equal extent per axis).
    const ex = last.boundsMax[0] - last.boundsMin[0];
    expect(ex).toBeGreaterThan(0);
    expect(last.boundsMax[1] - last.boundsMin[1]).toBeCloseTo(ex, 12);
    expect(last.boundsMax[2] - last.boundsMin[2]).toBeCloseTo(ex, 12);
  });

  it("emits a resolutionNote with a null effective when no clamp is needed", () => {
    const { session, events, scheduler } = harness();
    session.handle(startCommand({ resolution: 32 }));
    scheduler.drain();

    expect(noteEvents(events)[0]).toEqual({
      type: "resolutionNote",
      effective: null,
      requested: 32,
    });
  });

  it("carries the color mode into the packed voxel colors (fr-c1d)", () => {
    const { session, events, scheduler } = harness();
    session.handle(
      startCommand({ colorMode: "uniform", iterationsBudget: 2000 }),
    );
    scheduler.drain();

    const grids = gridEvents(events);
    const texture = grids[grids.length - 1].texture;
    // Uniform mode paints every hit voxel the explorer's flat cyan
    // (0.4, 0.8, 1.0 → 102, 204, 255); empty voxels stay transparent black.
    let colored = 0;
    for (let i = 0; i < texture.length; i += 4) {
      if (texture[i + 3] === 0) continue;
      colored++;
      expect(texture[i]).toBe(102);
      expect(texture[i + 1]).toBe(204);
      expect(texture[i + 2]).toBe(255);
    }
    expect(colored).toBeGreaterThan(0);
  });

  it("is reproducible: the same seed yields byte-identical final textures", () => {
    const run = (): Uint8Array => {
      const { session, events, scheduler } = harness();
      session.handle(startCommand({ seed: 77, iterationsBudget: 1000 }));
      scheduler.drain();
      const grids = gridEvents(events);
      return grids[grids.length - 1].texture;
    };
    expect(run()).toEqual(run());
  });

  it("carries the ramp palette into the height ramp's voxel colors (fr-3b6)", () => {
    // Same seed and geometry, differing ONLY in the start command's
    // rampPalette: the height-mode colors must come out different — pinning
    // that the wire field actually reaches accumulateVoxels (the ramp's
    // exact colors are color.test.ts's business).
    const run = (rampPalette: "legacy" | "spectrum"): Uint8Array => {
      const { session, events, scheduler } = harness();
      session.handle(
        startCommand({
          colorMode: "height",
          rampPalette,
          seed: 5,
          iterationsBudget: 2000,
        }),
      );
      scheduler.drain();
      const grids = gridEvents(events);
      return grids[grids.length - 1].texture;
    };
    expect(run("spectrum")).not.toEqual(run("legacy"));
  });
});

// ---------------------------------------------------------------------------
// Live iteration budget
// ---------------------------------------------------------------------------

describe("VoxelWorkerSession setIterationsBudget", () => {
  it("resumes a finished render when the budget is raised", () => {
    const { session, events, scheduler } = harness({ initialChunkSize: 100 });
    session.handle(startCommand({ iterationsBudget: 200 }));
    scheduler.drain();
    expect(
      gridEvents(events)[gridEvents(events).length - 1].iterationsDone,
    ).toBe(200);

    session.handle({ type: "setIterationsBudget", iterations: 400 });
    scheduler.drain();

    const last = gridEvents(events)[gridEvents(events).length - 1];
    expect(last.iterationsDone).toBe(400);
    expect(last.iterationsBudget).toBe(400);
  });

  it("stops an in-flight render cleanly when the budget is lowered below what is done", () => {
    const { session, events, scheduler } = harness({ initialChunkSize: 100 });
    session.handle(startCommand({ iterationsBudget: 1000 }));
    scheduler.step(); // one 100-iteration chunk done, more scheduled.

    session.handle({ type: "setIterationsBudget", iterations: 50 });
    scheduler.drain();

    // No grid event ever reports beyond what actually accumulated, and the
    // progress count never goes backwards or negative.
    for (const grid of gridEvents(events)) {
      expect(grid.iterationsDone).toBeGreaterThanOrEqual(0);
      expect(grid.iterationsDone).toBeLessThanOrEqual(100);
    }
    // The lowered budget finished the render on the spot, and no chunk runs
    // to say so — the session must send the final grid itself (fresh
    // counters included) or the progress label freezes (fr-15z).
    const last = gridEvents(events)[gridEvents(events).length - 1];
    expect(last.iterationsDone).toBe(100); // what actually accumulated, unchanged.
    expect(last.iterationsBudget).toBe(50); // the new (already-met) target.
  });

  it("refreshes the label's target without re-packing when an already-finished render's budget is lowered further", () => {
    const { session, events, scheduler } = harness({ initialChunkSize: 100 });
    session.handle(startCommand({ iterationsBudget: 200 }));
    scheduler.drain();
    const gridsWhenDone = gridEvents(events).length;

    session.handle({ type: "setIterationsBudget", iterations: 100 });

    // The displayed texture was already final — no heavy grid re-pack, just
    // a counters-only progress event so the label tracks the new target.
    expect(gridEvents(events)).toHaveLength(gridsWhenDone);
    const progress = events.filter((e) => e.type === "progress");
    expect(progress).toHaveLength(1);
    expect(progress[0]).toEqual({
      type: "progress",
      iterationsDone: 200,
      iterationsBudget: 100,
    });
  });
});

// ---------------------------------------------------------------------------
// Palette: live setPalette command (fr-1kt)
// ---------------------------------------------------------------------------

describe("VoxelWorkerSession setPalette", () => {
  it("restarts a finished render so it re-accumulates in the new palette", () => {
    const { session, events, scheduler } = harness({ initialChunkSize: 100 });
    session.handle(startCommand({ iterationsBudget: 200, palette: "legacy" }));
    scheduler.drain();
    expect(gridEvents(events).at(-1)!.iterationsDone).toBe(200);
    const gridsBefore = gridEvents(events).length;

    session.handle({ type: "setPalette", palette: "spectrum" });
    scheduler.drain();

    // A finished render produces no more grids on its own; that it climbs
    // back to the budget AND emits new grid events proves it reset to zero
    // and re-ran.
    expect(gridEvents(events).at(-1)!.iterationsDone).toBe(200);
    expect(gridEvents(events).length).toBeGreaterThan(gridsBefore);
  });

  it("colors differently under a gradient palette than legacy for the same seed", () => {
    function finalTexture(palette: "legacy" | "spectrum"): Uint8Array {
      const { session, events, scheduler } = harness();
      session.handle(
        startCommand({ seed: 7, iterationsBudget: 2000, palette }),
      );
      scheduler.drain();
      return gridEvents(events).at(-1)!.texture;
    }
    // Same seed → identical orbit and density; only the baked-in colors
    // differ, so the packed texture must differ once a gradient palette is
    // in play.
    expect(Array.from(finalTexture("spectrum"))).not.toEqual(
      Array.from(finalTexture("legacy")),
    );
  });

  it("is a no-op and does not throw when sent before any start", () => {
    const { session, events } = harness();
    expect(() =>
      session.handle({ type: "setPalette", palette: "spectrum" }),
    ).not.toThrow();
    expect(events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Symmetry: live setSymmetry command (fr-6im)
// ---------------------------------------------------------------------------

describe("VoxelWorkerSession setSymmetry", () => {
  it("runs to completion and reports the final grid when order > 1", () => {
    const { session, events, scheduler } = harness();
    session.handle(
      startCommand({ order: 3, axis: "y", iterationsBudget: 500 }),
    );
    scheduler.drain();

    const grids = gridEvents(events);
    expect(grids.length).toBeGreaterThan(0);
    const last = grids[grids.length - 1];
    expect(last.iterationsDone).toBe(500);
    expect(last.iterationsBudget).toBe(500);
  });

  it("restarts accumulation from zero when the order actually changes", () => {
    const { session, events, scheduler } = harness({ initialChunkSize: 100 });
    session.handle(
      startCommand({ order: 1, axis: "y", iterationsBudget: 400 }),
    );
    scheduler.step();
    const gridsBeforeRestart = gridEvents(events).length;
    expect(gridEvents(events).at(-1)!.iterationsDone).toBe(100);

    session.handle({ type: "setSymmetry", order: 3, axis: "y" });
    scheduler.step();
    const afterOneStep = gridEvents(events);
    expect(afterOneStep.length).toBe(gridsBeforeRestart + 1); // a genuinely NEW event landed, not just a re-send.
    expect(afterOneStep.at(-1)!.iterationsDone).toBe(100); // exactly one chunk's worth, not 200 -> iterationsDone was reset to 0.

    scheduler.drain();
    expect(gridEvents(events).at(-1)!.iterationsDone).toBe(400); // still reaches the same budget after restarting.
  });

  it("restarts accumulation when only the axis changes (order held constant)", () => {
    const { session, events, scheduler } = harness({ initialChunkSize: 100 });
    session.handle(
      startCommand({ order: 3, axis: "y", iterationsBudget: 400 }),
    );
    scheduler.step();
    const gridsBeforeRestart = gridEvents(events).length;
    expect(gridEvents(events).at(-1)!.iterationsDone).toBe(100);

    session.handle({ type: "setSymmetry", order: 3, axis: "z" });
    scheduler.step();
    const afterOneStep = gridEvents(events);
    expect(afterOneStep.length).toBe(gridsBeforeRestart + 1);
    expect(afterOneStep.at(-1)!.iterationsDone).toBe(100);
  });

  it("does not restart when order and axis are unchanged (no-op guard)", () => {
    const { session, events, scheduler } = harness({ initialChunkSize: 100 });
    session.handle(
      startCommand({ order: 3, axis: "y", iterationsBudget: 200 }),
    );
    scheduler.drain();
    const gridsAtCompletion = gridEvents(events).length;

    session.handle({ type: "setSymmetry", order: 3, axis: "y" });
    // No restart -> no fresh accumulation, so no new grid event fires from a
    // no-op command with nothing scheduled.
    expect(gridEvents(events)).toHaveLength(gridsAtCompletion);
  });

  it("is a no-op and does not throw when sent before any start", () => {
    const { session, events } = harness();
    expect(() =>
      session.handle({ type: "setSymmetry", order: 3, axis: "y" }),
    ).not.toThrow();
    expect(events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Memory guards
// ---------------------------------------------------------------------------

describe("VoxelWorkerSession memory guards", () => {
  it("proactively clamps the resolution to the voxel budget and says so", () => {
    const { session, events, scheduler } = harness({ maxVoxels: 32 ** 3 });
    session.handle(startCommand({ resolution: 96 }));
    scheduler.drain();

    expect(noteEvents(events)[0]).toEqual({
      type: "resolutionNote",
      effective: 32,
      requested: 96,
    });
    const grids = gridEvents(events);
    expect(grids[grids.length - 1].size).toBe(32);
  });

  it("clamps against the start command's own budget when it carries one", () => {
    // Same 64 -> 32 clamp as the deps-budget test above, but the budget
    // rides in the start command — the path main.ts actually uses (fr-8x7).
    // Without it, the built-in floor (256^3 worth of voxels) would clamp
    // nothing at a mere 64^3 request.
    const { session, events, scheduler } = harness();
    session.handle(startCommand({ resolution: 64, maxVoxels: 32 * 32 * 32 }));
    scheduler.drain();

    expect(noteEvents(events)[0]).toEqual({
      type: "resolutionNote",
      effective: 32,
      requested: 64,
    });
    const grids = gridEvents(events);
    expect(grids[grids.length - 1].size).toBe(32);
  });

  it("shrinks and retries when the grid allocation actually fails", () => {
    const { session, events, scheduler } = harness({
      createGrid: (size, bounds) => {
        if (size > 32) throw new RangeError("Array buffer allocation failed");
        return {
          size,
          bounds,
          density: new Float32Array(size ** 3),
          avgRGB: new Float32Array(size ** 3 * 3),
          maxDensity: 0,
          orbit: null,
          orbitColor: 0.5,
          orbitW: 0,
        };
      },
    });
    session.handle(startCommand({ resolution: 96 }));
    scheduler.drain();

    expect(events.some((e) => e.type === "error")).toBe(false);
    const grids = gridEvents(events);
    expect(grids.length).toBeGreaterThan(0);
    expect(grids[grids.length - 1].size).toBe(32);
    // The note reports the learned effective size against the request.
    const notes = noteEvents(events);
    expect(notes[notes.length - 1]).toEqual({
      type: "resolutionNote",
      effective: 32,
      requested: 96,
    });
  });

  it("surfaces an error when even the smallest grid cannot be allocated", () => {
    const { session, events, scheduler } = harness({
      createGrid: () => {
        throw new RangeError("Array buffer allocation failed");
      },
    });
    session.handle(startCommand({ resolution: 32 }));
    scheduler.drain();

    expect(events.some((e) => e.type === "error")).toBe(true);
    expect(gridEvents(events)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 4D solid render (fr-4wd): the `fourD` start-command block drives
// computeVoxelBounds4/accumulateVoxels4 instead of the 3D path, and every
// command handler must still behave sanely — setSymmetry becomes a no-op
// (symmetry is 3D-only), setPalette still restarts. A plain 3D start (no
// fourD) must keep behaving exactly as every other describe block in this
// file already proves.
// ---------------------------------------------------------------------------

describe("VoxelWorkerSession 4D solid render", () => {
  it("emits a grid event with a nonzero texture for a simple 4D transform fixture", () => {
    const { session, events, scheduler } = harness();
    session.handle(
      startCommand({ fourD: defaultFourD(), iterationsBudget: 2000 }),
    );
    scheduler.drain();

    const grids = gridEvents(events);
    expect(grids.length).toBeGreaterThan(0);
    const last = grids[grids.length - 1];
    expect(last.iterationsDone).toBe(2000);
    expect(last.texture.some((b) => b > 0)).toBe(true);
  });

  it("setSymmetry on a 4D session is a no-op: no bounds re-run, no restart", () => {
    const { session, events, scheduler } = harness();
    session.handle(
      startCommand({ fourD: defaultFourD(), iterationsBudget: 200 }),
    );
    scheduler.drain();
    const gridsBefore = gridEvents(events).length;
    const notesBefore = noteEvents(events).length;

    session.handle({ type: "setSymmetry", order: 3, axis: "z" });

    // No restart -> no new grid/resolutionNote from a no-op command with
    // nothing scheduled.
    expect(gridEvents(events)).toHaveLength(gridsBefore);
    expect(noteEvents(events)).toHaveLength(notesBefore);
  });

  it("setPalette on a 4D session restarts accumulation and re-emits a grid", () => {
    const { session, events, scheduler } = harness({ initialChunkSize: 50 });
    session.handle(
      startCommand({
        fourD: defaultFourD(),
        iterationsBudget: 200,
        palette: "legacy",
      }),
    );
    scheduler.drain();
    expect(gridEvents(events).at(-1)!.iterationsDone).toBe(200);
    const gridsBefore = gridEvents(events).length;

    session.handle({ type: "setPalette", palette: "spectrum" });
    scheduler.drain();

    // A finished render produces no more grids on its own; that it climbs
    // back to the budget AND emits new grid events proves it reset to zero
    // and re-ran, exactly like the 3D setPalette restart.
    expect(gridEvents(events).at(-1)!.iterationsDone).toBe(200);
    expect(gridEvents(events).length).toBeGreaterThan(gridsBefore);
  });

  it("a 3D start (no fourD) is unaffected: still runs to completion with a real texture", () => {
    const { session, events, scheduler } = harness();
    session.handle(startCommand({ iterationsBudget: 500 }));
    scheduler.drain();

    const grids = gridEvents(events);
    expect(grids.length).toBeGreaterThan(0);
    const last = grids[grids.length - 1];
    expect(last.iterationsDone).toBe(500);
    expect(last.texture.some((b) => b > 0)).toBe(true);
  });

  it("does not produce a degenerate grid (bounds min < max) when the slice sits far outside the cloud", () => {
    // s is always clamped into [-1, 1], so a center of 50 is many widths
    // away from every sample regardless of the system — the <1% fallback
    // (voxel-4d.ts's computeVoxelBounds4) must engage instead of trimming
    // to a near-empty (or NaN) qualifying set.
    const { session, events, scheduler } = harness();
    session.handle(
      startCommand({
        fourD: {
          ...defaultFourD(),
          sliceOn: true,
          sliceCenter: 50,
          sliceWidth: 0.1,
        },
        iterationsBudget: 500,
      }),
    );
    scheduler.drain();

    const grids = gridEvents(events);
    expect(grids.length).toBeGreaterThan(0);
    const last = grids[grids.length - 1];
    expect(last.boundsMax[0]).toBeGreaterThan(last.boundsMin[0]);
    expect(last.boundsMax[1]).toBeGreaterThan(last.boundsMin[1]);
    expect(last.boundsMax[2]).toBeGreaterThan(last.boundsMin[2]);
  });
});

// ---------------------------------------------------------------------------
// Device-aware accumulation budget policy (fr-8x7)
// ---------------------------------------------------------------------------

describe("voxelAccumBudgetVoxels", () => {
  /** MiB → voxels, restating the contract: one voxel is 20 bytes (Float32
   * density + Float32 RGB running mean + the RGBA8 texture texel). */
  const voxels = (mib: number) => Math.floor((mib * 1024 * 1024) / 20);

  it("keeps the flat 320 MiB phone floor on coarse-pointer devices, ignoring reported memory", () => {
    // Flagship phones report the capped deviceMemory maximum of 8 — exactly
    // the devices the conservative floor exists for, so the report is
    // ignored. Also pins today's exact ceiling (256^3) so phones see no
    // regression from raising the desktop slider max.
    expect(voxelAccumBudgetVoxels(8, true)).toBe(voxels(320));
    expect(voxelAccumBudgetVoxels(8, true)).toBe(256 ** 3);
  });

  it("scales the desktop budget with reported device memory", () => {
    expect(voxelAccumBudgetVoxels(4, false)).toBe(voxels(1280));
  });

  it("assumes a desktop-class budget when deviceMemory is unavailable (Firefox/Safari)", () => {
    expect(voxelAccumBudgetVoxels(undefined, false)).toBe(voxels(2560));
  });

  it("never drops below the phone-safe floor on tiny-memory desktops", () => {
    expect(voxelAccumBudgetVoxels(0.25, false)).toBe(voxels(320));
  });

  it("caps the budget even if a future UA reports more than 8 GiB", () => {
    expect(voxelAccumBudgetVoxels(64, false)).toBe(voxels(2560));
  });

  it("lets a desktop run the full 512^3 slider maximum", () => {
    expect(clampVoxelResolution(512, voxelAccumBudgetVoxels(8, false))).toBe(
      512,
    );
  });

  it("still pins a phone asking for 512^3 to the old 256^3 ceiling", () => {
    expect(clampVoxelResolution(512, voxelAccumBudgetVoxels(8, true))).toBe(
      256,
    );
  });
});

// ---------------------------------------------------------------------------
// Texture throttling
// ---------------------------------------------------------------------------

describe("VoxelWorkerSession texture throttling", () => {
  it("packs textures on a throttle while accumulating, not once per chunk", () => {
    // 100 chunks of 10 iterations, clock advancing 10 ms per read: chunk
    // boundaries land every ~20 ms of fake time, so with a 250 ms texture
    // interval only a fraction of chunks may emit — plus the never-throttled
    // first one and the always-emitted final one.
    const { session, events, scheduler } = harness({
      initialChunkSize: 10,
      now: fakeClock(10),
    });
    session.handle(startCommand({ iterationsBudget: 1000 }));
    scheduler.drain();

    const grids = gridEvents(events);
    expect(grids.length).toBeGreaterThan(1); // progressive, not one-shot…
    expect(grids.length).toBeLessThan(50); // …but throttled well below 100.
    expect(grids[grids.length - 1].iterationsDone).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// Pack-aware texture throttle (fr-8x7): the refresh interval stretches when
// packing itself is slow, so a big grid can't spend nearly all its time
// re-packing instead of accumulating — see VOXEL_TEXTURE_PACK_DUTY's doc.
// ---------------------------------------------------------------------------

describe("VoxelWorkerSession texture pack throttling", () => {
  it("stretches the refresh interval when packing is slow, keeping packing a bounded fraction of worker time", () => {
    // 10 equal chunks: initialChunkSize is set to VOXEL_CHUNK_MIN (100,000)
    // itself, so adaptChunkSize's floor never perturbs it; every chunk's
    // accumulate also takes exactly 8 fake-ms (t1 - t0 = 8), which equals
    // VOXEL_FRAME_BUDGET_MS, pinning the adaptive multiplier at exactly 1 so
    // chunkSize never drifts from there either — 1,000,000 iterations / 10
    // chunks of 100,000.
    //
    // runChunk calls now() twice per chunk (t0, t1) normally, plus a third
    // time (t2) right after sendGrid on any chunk that actually packs (see
    // `this.lastPackMs = this.now() - t1`). Chunk 1 is always due
    // (lastTextureAt starts undefined); scripting its pack at 400 fake-ms
    // makes lastPackMs 400, so the throttle stretches to
    // VOXEL_TEXTURE_PACK_DUTY(3) * 400 = 1200 ms — bigger than the flat
    // 250 ms floor, so the stretch actually governs from here on.
    //
    // Chunks 2-9 cost 8 ms each and nothing packs again in between, so their
    // gap-since-chunk-1's-pack (t1 - 8) merely climbs 408, 416, 424, 432,
    // 440, 448, 456, 464 — all comfortably under the 1200 ms stretched
    // threshold, so none of them re-pack.
    //
    // Chunk 10 finishes the budget, which forces a send regardless of the
    // throttle.
    //
    // So only chunks 1 and 10 emit a grid: 2 total. Contrast with a flat
    // 250 ms stride under this SAME pack cost: a 400 ms pack pushes the very
    // next chunk's gap to 400 + 8 = 408 ms, already >= 250 ms — so EVERY one
    // of the 10 chunks would re-pack (fr-8x7's exact bug: lastTextureAt is
    // stamped at pack START, so a slow-enough pack makes every subsequent
    // chunk immediately "due" again).
    const values = [
      0,
      8,
      408, // chunk 1: t0, t1, t2 (400 ms pack) -> due, lastPackMs=400
      408,
      416, // chunk 2: t0, t1 -> gap 408 < 1200, not due
      416,
      424, // chunk 3 -> gap 416 < 1200
      424,
      432, // chunk 4 -> gap 424 < 1200
      432,
      440, // chunk 5 -> gap 432 < 1200
      440,
      448, // chunk 6 -> gap 440 < 1200
      448,
      456, // chunk 7 -> gap 448 < 1200
      456,
      464, // chunk 8 -> gap 456 < 1200
      464,
      472, // chunk 9 -> gap 464 < 1200
      472,
      480,
      880, // chunk 10: t0, t1 (finished -> forced due), t2 (pack)
    ];
    const { session, events, scheduler } = harness({
      initialChunkSize: 100_000,
      now: scriptedClock(values),
    });
    session.handle(startCommand({ iterationsBudget: 1_000_000 }));
    scheduler.drain();

    const grids = gridEvents(events);
    expect(grids.length).toBe(2); // hand-computed above: only chunks 1 and 10.
    expect(grids.length).toBeLessThan(10); // a flat 250 ms stride would have re-packed on every chunk.
    expect(grids[grids.length - 1].iterationsDone).toBe(1_000_000);
  });

  it("keeps today's flat 250 ms schedule when packing is fast (3x cost stays under the floor)", () => {
    // Identical structure to the slow-pack case above, but the pack costs
    // only 10 fake-ms: VOXEL_TEXTURE_PACK_DUTY(3) * 10 = 30, which loses to
    // the Math.max against the flat VOXEL_TEXTURE_INTERVAL_MS (250) — so the
    // throttle threshold is 250 ms throughout, exactly as it was before
    // fr-8x7 introduced the stretch (today's <=256^3 sizes, where packing is
    // fast). With only 10 chunks of 8 ms each, the gap since chunk 1's pack
    // (18, 26, 34, 42, 50, 58, 66, 74 minus 8) never climbs anywhere near
    // 250 ms either, so — like the slow-pack case — only the always-due
    // first and last chunks emit.
    //
    // The exact count (not a loose range) is what would catch a regression
    // that dropped the `Math.max` floor: a bare `3 * lastPackMs` (30 ms)
    // threshold, with no floor, is already crossed by chunk 4's 34 ms gap —
    // which would inflate this count well past 2.
    const values = [
      0,
      8,
      18, // chunk 1: t0, t1, t2 (10 ms pack) -> due, lastPackMs=10
      18,
      26, // chunk 2: t0, t1 -> gap 18 < 250, not due
      26,
      34, // chunk 3 -> gap 26 < 250
      34,
      42, // chunk 4 -> gap 34 < 250
      42,
      50, // chunk 5 -> gap 42 < 250
      50,
      58, // chunk 6 -> gap 50 < 250
      58,
      66, // chunk 7 -> gap 58 < 250
      66,
      74, // chunk 8 -> gap 66 < 250
      74,
      82, // chunk 9 -> gap 74 < 250
      82,
      90,
      100, // chunk 10: t0, t1 (finished -> forced due), t2 (pack)
    ];
    const { session, events, scheduler } = harness({
      initialChunkSize: 100_000,
      now: scriptedClock(values),
    });
    session.handle(startCommand({ iterationsBudget: 1_000_000 }));
    scheduler.drain();

    const grids = gridEvents(events);
    expect(grids.length).toBe(2); // same forced first/last as the flat stride would give at this scale.
    expect(grids[grids.length - 1].iterationsDone).toBe(1_000_000);
  });
});
