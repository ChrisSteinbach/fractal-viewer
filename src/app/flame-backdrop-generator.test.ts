import {
  compositeFlameBackdrop,
  FlameBackdropGenerator,
  FLAME_BACKDROP_DEBOUNCE_MS,
  FLAME_BACKDROP_ITERATIONS,
} from "./flame-backdrop-generator";
import type {
  FlameBackdropGeneratorDeps,
  FlameBackdropImage,
  FlameBackdropParams,
} from "./flame-backdrop-generator";
import type { FlameWorkerCommand, FlameWorkerEvent } from "./flame-worker-core";

function params(
  overrides: Partial<FlameBackdropParams> = {},
): FlameBackdropParams {
  return {
    transforms: [],
    finalTransform: null,
    projection: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    width: 2,
    height: 2,
    seed: 1,
    palette: "legacy",
    order: 1,
    plane: "xz",
    ...overrides,
  };
}

function terminal(
  image: Uint8ClampedArray<ArrayBuffer> = new Uint8ClampedArray(16),
  width = 2,
  height = 2,
): Extract<FlameWorkerEvent, { type: "progress" }> {
  return {
    type: "progress",
    iterationsDone: FLAME_BACKDROP_ITERATIONS,
    iterationsBudget: FLAME_BACKDROP_ITERATIONS,
    image,
    width,
    height,
  };
}

interface Timer {
  readonly fn: () => void;
  readonly delayMs: number;
  cancelled: boolean;
}

interface FakeWorker {
  readonly posted: FlameWorkerCommand[];
  readonly emit: (event: FlameWorkerEvent) => void;
  readonly fail: (error: unknown) => void;
  terminated: number;
}

function harness(): {
  readonly generator: FlameBackdropGenerator;
  readonly workers: FakeWorker[];
  readonly delivered: FlameBackdropImage[];
  readonly errors: unknown[];
  readonly activeTimers: () => Timer[];
  readonly fireDebounce: () => void;
} {
  const workers: FakeWorker[] = [];
  const delivered: FlameBackdropImage[] = [];
  const errors: unknown[] = [];
  const timers: Timer[] = [];
  const deps: FlameBackdropGeneratorDeps = {
    createWorker: (onEvent, onError) => {
      const worker: FakeWorker = {
        posted: [],
        emit: onEvent,
        fail: onError,
        terminated: 0,
      };
      workers.push(worker);
      return {
        post: (command) => worker.posted.push(command),
        terminate: () => {
          worker.terminated++;
        },
      };
    },
    onImage: (image) => delivered.push(image),
    onError: (error) => errors.push(error),
    schedule: (fn, delayMs) => {
      const timer: Timer = { fn, delayMs, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
  };
  return {
    generator: new FlameBackdropGenerator(deps),
    workers,
    delivered,
    errors,
    activeTimers: () => timers.filter((timer) => !timer.cancelled),
    fireDebounce: () => {
      let timer: Timer | undefined;
      for (let i = timers.length - 1; i >= 0; i--) {
        if (!timers[i].cancelled) {
          timer = timers[i];
          break;
        }
      }
      if (timer === undefined) throw new Error("No debounce is armed");
      timer.cancelled = true;
      timer.fn();
    },
  };
}

describe("FlameBackdropGenerator request policy", () => {
  it("debounces the complete 4D snapshot into one fixed low-budget CPU start", () => {
    const h = harness();
    const fourD: NonNullable<FlameBackdropParams["fourD"]> = {
      transforms4: [],
      finalTransform4: null,
      rotor: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      center: [1, 2, 3, 4],
      invWAmp: 0.5,
      sliceOn: true,
      sliceCenter: 0.1,
      sliceWidth: 0.25,
      sliceRelativeColor: true,
      colorMode: "radius",
      radiusMin: 1,
      radiusMax: 5,
      rampPalette: "legacy",
    };

    h.generator.request(params({ seed: 1 }));
    h.generator.request(params({ seed: 2, twist: 0.75, fourD }));

    expect(h.workers).toHaveLength(0); // lazy: no worker before the debounce
    expect(h.activeTimers()).toHaveLength(1);
    expect(h.activeTimers()[0].delayMs).toBe(FLAME_BACKDROP_DEBOUNCE_MS);

    h.fireDebounce();

    expect(h.workers).toHaveLength(1);
    expect(h.workers[0].posted).toHaveLength(1);
    expect(h.workers[0].posted[0]).toEqual({
      type: "start",
      ...params({ seed: 2, twist: 0.75, fourD }),
      requestedSupersample: 1,
      iterationsBudget: 1_000_000,
      exposure: 0.2,
      gamma: 2.4,
      vibrancy: 1,
      estimatorRadius: 4,
      estimatorMinimumRadius: 4,
      estimatorCurve: 0.4,
      gpuPreference: "off",
    });
    expect("sharedFrames" in h.workers[0].posted[0]).toBe(false);
  });

  it("keeps one request in flight, collapses parked edits to the latest, and reuses its worker", () => {
    const h = harness();

    h.generator.request(params({ seed: 1 })); // A
    h.fireDebounce();
    h.generator.request(params({ seed: 2 })); // B, replaced before ready
    h.generator.request(params({ seed: 3 })); // C
    h.fireDebounce(); // C is ready but A is still in flight

    expect(h.workers[0].posted).toHaveLength(1);
    h.workers[0].emit(terminal()); // A must not flash after C was requested

    expect(h.delivered).toHaveLength(0);
    expect(h.workers).toHaveLength(1);
    expect(h.workers[0].posted).toHaveLength(2);
    expect(h.workers[0].posted[1]).toMatchObject({ seed: 3 });

    h.workers[0].emit(terminal());

    expect(h.delivered).toHaveLength(1);
    expect(h.delivered[0].revision).toBe(3);
  });

  it("suppresses a terminal image as soon as a newer edit exists, even before its debounce settles", () => {
    const h = harness();

    h.generator.request(params({ seed: 1 }));
    h.fireDebounce();
    h.generator.request(params({ seed: 2 }));
    h.workers[0].emit(terminal());

    expect(h.delivered).toHaveLength(0);
    expect(h.workers[0].posted).toHaveLength(1);

    h.fireDebounce();
    expect(h.workers[0].posted).toHaveLength(2);
    expect(h.workers[0].posted[1]).toMatchObject({ seed: 2 });
  });
});

describe("FlameBackdropGenerator holds and lifecycle", () => {
  it("holds through suspend, parks only the latest snapshot, and resumes with a fresh debounce", async () => {
    const h = harness();

    h.generator.request(params({ seed: 1 }));
    h.fireDebounce();
    h.generator.suspend();
    h.generator.request(params({ seed: 2 }));
    expect(h.activeTimers()).toHaveLength(0);

    let settled = false;
    void h.generator.settle().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false); // the already-running A still drains

    h.workers[0].emit(terminal());
    await Promise.resolve();
    expect(h.delivered).toHaveLength(0);
    expect(settled).toBe(true); // parked B does not block while held

    h.generator.resume();
    expect(h.activeTimers()).toHaveLength(1);
    h.fireDebounce();
    expect(h.workers[0].posted).toHaveLength(2);
    expect(h.workers[0].posted[1]).toMatchObject({ seed: 2 });

    h.workers[0].emit(terminal());
    expect(h.delivered).toHaveLength(1);
  });

  it("drops worker errors without a sync fallback and lazily recreates on a later request", () => {
    const h = harness();

    h.generator.request(params({ seed: 1 }));
    h.fireDebounce();
    const deadWorker = h.workers[0];
    deadWorker.fail(new Error("worker crashed"));

    expect(deadWorker.terminated).toBe(1);
    expect(h.errors).toHaveLength(1);
    expect(h.delivered).toHaveLength(0);

    h.generator.request(params({ seed: 2 }));
    h.fireDebounce();
    expect(h.workers).toHaveLength(2);
    expect(h.workers[1].posted[0]).toMatchObject({ seed: 2 });

    deadWorker.emit(terminal()); // queued terminal event from the dead worker
    expect(h.delivered).toHaveLength(0);
    h.workers[1].emit(terminal());
    expect(h.delivered).toHaveLength(1);
  });

  it("settle spans the debounce and worker render; destroy releases it and ignores late events", async () => {
    const h = harness();
    h.generator.request(params());
    let settled = false;
    void h.generator.settle().then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    h.fireDebounce();
    await Promise.resolve();
    expect(settled).toBe(false);

    const worker = h.workers[0];
    h.generator.destroy();
    await Promise.resolve();
    expect(settled).toBe(true);
    expect(worker.terminated).toBe(1);

    worker.emit(terminal());
    h.generator.request(params({ seed: 2 }));
    expect(h.delivered).toHaveLength(0);
    expect(h.activeTimers()).toHaveLength(0);
  });
});

describe("compositeFlameBackdrop", () => {
  it("screen-composites over the dark gradient, forces opacity, and reports the final mean", () => {
    const source = new Uint8ClampedArray([0, 0, 0, 0, 255, 0, 127, 255]);

    const result = compositeFlameBackdrop(source, 1, 2, 7);

    expect([...result.rgba]).toEqual([18, 18, 32, 255, 255, 27, 151, 255]);
    expect(result.revision).toBe(7);
    expect(result.meanRgb).toEqual([
      (18 + 255) / (2 * 255),
      (18 + 27) / (2 * 255),
      (32 + 151) / (2 * 255),
    ]);
    expect([...source]).toEqual([0, 0, 0, 0, 255, 0, 127, 255]);
  });
});
