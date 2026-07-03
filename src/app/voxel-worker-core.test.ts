import { sierpinskiTetrahedron } from "../fractal/presets";
import { VoxelWorkerSession } from "./voxel-worker-core";
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
    iterationsBudget: 500,
    seed: 1,
    order: 1,
    axis: "y",
    ...overrides,
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
