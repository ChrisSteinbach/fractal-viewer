import {
  DEFAULT_STEP_HOLD_MS,
  DEFAULT_STEP_MORPH_MS,
  MAX_STEP_MS,
  TIMELINE_CAP,
  TIMELINE_STORAGE_KEY,
  TimelineStore,
  legSeed,
  timelineDurationMs,
} from "./timeline";

function memoryStorage(initial: Record<string, string> = {}) {
  const store: Record<string, string> = { ...initial };
  return {
    store,
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
  };
}

describe("TimelineStore construction", () => {
  it("starts empty when storage has no saved timeline", () => {
    const timeline = new TimelineStore({ storage: memoryStorage() });
    expect(timeline.size).toBe(0);
    expect(timeline.all()).toEqual([]);
  });

  it("rolls a fresh seed when storage has no saved timeline", () => {
    const timeline = new TimelineStore({
      storage: memoryStorage(),
      rollSeed: () => 777,
    });
    expect(timeline.seed).toBe(777);
  });
});

describe("TimelineStore add", () => {
  it("appends steps in playback order with default timings", () => {
    const timeline = new TimelineStore({ storage: memoryStorage() });
    timeline.add("v1=a", "thumb-a");
    timeline.add("v1=b", "thumb-b");

    expect(timeline.all().map((s) => s.encoded)).toEqual(["v1=a", "v1=b"]);
    expect(timeline.all()[0].morphMs).toBe(DEFAULT_STEP_MORPH_MS);
    expect(timeline.all()[0].holdMs).toBe(DEFAULT_STEP_HOLD_MS);
  });

  it("returns the created step carrying the given encoded and thumbnail", () => {
    const timeline = new TimelineStore({ storage: memoryStorage() });
    const step = timeline.add("v1=scene-a", "data:image/png;base64,aaa");

    expect(step).not.toBeNull();
    expect(step?.encoded).toBe("v1=scene-a");
    expect(step?.thumbnail).toBe("data:image/png;base64,aaa");
  });

  it("mints unique ids for successive adds", () => {
    const timeline = new TimelineStore({ storage: memoryStorage() });
    const a = timeline.add("v1=a", "");
    const b = timeline.add("v1=b", "");

    expect(a?.id).not.toBe(b?.id);
  });

  it("allows the same scene to be added more than once (no dedupe)", () => {
    const timeline = new TimelineStore({ storage: memoryStorage() });
    timeline.add("v1=a", "");
    timeline.add("v1=b", "");
    timeline.add("v1=a", "");

    expect(timeline.all().map((s) => s.encoded)).toEqual([
      "v1=a",
      "v1=b",
      "v1=a",
    ]);
    expect(timeline.size).toBe(3);
  });

  it("returns null and leaves the list unchanged once at TIMELINE_CAP", () => {
    const timeline = new TimelineStore({ storage: memoryStorage() });
    for (let i = 0; i < TIMELINE_CAP; i++) timeline.add(`v1=scene-${i}`, "");
    expect(timeline.size).toBe(TIMELINE_CAP);

    const result = timeline.add("v1=overflow", "");

    expect(result).toBeNull();
    expect(timeline.size).toBe(TIMELINE_CAP);
    expect(timeline.all().some((s) => s.encoded === "v1=overflow")).toBe(false);
  });
});

describe("TimelineStore remove", () => {
  it("drops the step with the given id", () => {
    const timeline = new TimelineStore({ storage: memoryStorage() });
    const a = timeline.add("v1=a", "");
    timeline.add("v1=b", "");

    timeline.remove(a?.id ?? "");

    expect(timeline.all().map((s) => s.encoded)).toEqual(["v1=b"]);
  });

  it("is a no-op when the id is not present", () => {
    const timeline = new TimelineStore({ storage: memoryStorage() });
    timeline.add("v1=a", "");

    expect(() => timeline.remove("does-not-exist")).not.toThrow();
    expect(timeline.size).toBe(1);
  });
});

describe("TimelineStore move", () => {
  it("swaps a step up with its predecessor", () => {
    const timeline = new TimelineStore({ storage: memoryStorage() });
    timeline.add("v1=a", "");
    timeline.add("v1=b", "");
    timeline.add("v1=c", "");
    const b = timeline.all()[1];

    timeline.move(b.id, -1);

    expect(timeline.all().map((s) => s.encoded)).toEqual([
      "v1=b",
      "v1=a",
      "v1=c",
    ]);
  });

  it("swaps a step down with its successor", () => {
    const timeline = new TimelineStore({ storage: memoryStorage() });
    timeline.add("v1=a", "");
    timeline.add("v1=b", "");
    timeline.add("v1=c", "");
    const b = timeline.all()[1];

    timeline.move(b.id, 1);

    expect(timeline.all().map((s) => s.encoded)).toEqual([
      "v1=a",
      "v1=c",
      "v1=b",
    ]);
  });

  it("is a no-op moving the first step up", () => {
    const timeline = new TimelineStore({ storage: memoryStorage() });
    timeline.add("v1=a", "");
    timeline.add("v1=b", "");
    const a = timeline.all()[0];

    timeline.move(a.id, -1);

    expect(timeline.all().map((s) => s.encoded)).toEqual(["v1=a", "v1=b"]);
  });

  it("is a no-op moving the last step down", () => {
    const timeline = new TimelineStore({ storage: memoryStorage() });
    timeline.add("v1=a", "");
    timeline.add("v1=b", "");
    const b = timeline.all()[1];

    timeline.move(b.id, 1);

    expect(timeline.all().map((s) => s.encoded)).toEqual(["v1=a", "v1=b"]);
  });

  it("is a no-op when the id is unknown", () => {
    const timeline = new TimelineStore({ storage: memoryStorage() });
    timeline.add("v1=a", "");
    timeline.add("v1=b", "");

    expect(() => timeline.move("does-not-exist", -1)).not.toThrow();
    expect(timeline.all().map((s) => s.encoded)).toEqual(["v1=a", "v1=b"]);
  });
});

describe("TimelineStore setTiming", () => {
  it("clamps a provided morphMs/holdMs to [0, MAX_STEP_MS]", () => {
    const timeline = new TimelineStore({ storage: memoryStorage() });
    timeline.add("v1=a", "");
    const id = timeline.all()[0].id;

    timeline.setTiming(id, { morphMs: -500, holdMs: MAX_STEP_MS + 5000 });

    expect(timeline.all()[0].morphMs).toBe(0);
    expect(timeline.all()[0].holdMs).toBe(MAX_STEP_MS);
  });

  it("only changes the fields provided, leaving the other alone", () => {
    const timeline = new TimelineStore({ storage: memoryStorage() });
    timeline.add("v1=a", "");
    const id = timeline.all()[0].id;

    timeline.setTiming(id, { morphMs: 1234 });

    expect(timeline.all()[0].morphMs).toBe(1234);
    expect(timeline.all()[0].holdMs).toBe(DEFAULT_STEP_HOLD_MS);
  });

  it("leaves the old value when a provided value is non-finite", () => {
    const timeline = new TimelineStore({ storage: memoryStorage() });
    timeline.add("v1=a", "");
    const id = timeline.all()[0].id;

    timeline.setTiming(id, { morphMs: NaN, holdMs: Infinity });

    expect(timeline.all()[0].morphMs).toBe(DEFAULT_STEP_MORPH_MS);
    expect(timeline.all()[0].holdMs).toBe(DEFAULT_STEP_HOLD_MS);
  });

  it("is a no-op when the id is unknown", () => {
    const timeline = new TimelineStore({ storage: memoryStorage() });
    timeline.add("v1=a", "");

    expect(() =>
      timeline.setTiming("does-not-exist", { morphMs: 500 }),
    ).not.toThrow();
    expect(timeline.all()[0].morphMs).toBe(DEFAULT_STEP_MORPH_MS);
  });
});

describe("TimelineStore persistence", () => {
  it("round-trips steps and seed through storage", () => {
    const storage = memoryStorage();
    const first = new TimelineStore({ storage, rollSeed: () => 42 });
    first.add("v1=a", "thumb-a");
    first.add("v1=b", "thumb-b");

    const second = new TimelineStore({ storage });

    expect(second.all().map((s) => s.encoded)).toEqual(["v1=a", "v1=b"]);
    expect(second.seed).toBe(42);
  });

  it("never throws on garbage JSON and starts empty", () => {
    const storage = memoryStorage({ [TIMELINE_STORAGE_KEY]: "not json{" });
    const timeline = new TimelineStore({ storage });
    expect(timeline.size).toBe(0);
  });

  it("drops a malformed step while keeping the valid ones around it", () => {
    const storage = memoryStorage({
      [TIMELINE_STORAGE_KEY]: JSON.stringify({
        seed: 1,
        steps: [
          {
            id: "1",
            encoded: "v1=good-a",
            thumbnail: "",
            morphMs: 1000,
            holdMs: 500,
          },
          {
            id: "2",
            encoded: "v1=bad",
            thumbnail: "",
            morphMs: "oops",
            holdMs: 500,
          },
          {
            id: "3",
            encoded: "v1=good-b",
            thumbnail: "",
            morphMs: 1000,
            holdMs: 500,
          },
        ],
      }),
    });

    const timeline = new TimelineStore({ storage });

    expect(timeline.all().map((s) => s.encoded)).toEqual([
      "v1=good-a",
      "v1=good-b",
    ]);
  });

  it("clamps a non-finite stored timing rather than dropping the step", () => {
    const storage = memoryStorage({
      [TIMELINE_STORAGE_KEY]:
        '{"seed":1,"steps":[{"id":"1","encoded":"v1=a","thumbnail":"","morphMs":1e999,"holdMs":500}]}',
    });

    const timeline = new TimelineStore({ storage });

    expect(timeline.size).toBe(1);
    expect(timeline.all()[0].morphMs).toBe(MAX_STEP_MS);
  });

  it("re-rolls the seed when the stored seed is non-finite", () => {
    const storage = memoryStorage({
      [TIMELINE_STORAGE_KEY]: '{"seed":1e999,"steps":[]}',
    });

    const timeline = new TimelineStore({ storage, rollSeed: () => 999 });

    expect(timeline.seed).toBe(999);
  });

  it("re-rolls the seed when missing, while keeping valid steps", () => {
    const storage = memoryStorage({
      [TIMELINE_STORAGE_KEY]: JSON.stringify({
        steps: [
          {
            id: "1",
            encoded: "v1=a",
            thumbnail: "",
            morphMs: 1000,
            holdMs: 500,
          },
        ],
      }),
    });

    const timeline = new TimelineStore({ storage, rollSeed: () => 555 });

    expect(timeline.seed).toBe(555);
    expect(timeline.size).toBe(1);
  });

  it("truncates steps beyond TIMELINE_CAP to the first 20", () => {
    const steps = Array.from({ length: TIMELINE_CAP + 5 }, (_, i) => ({
      id: `${i}`,
      encoded: `v1=scene-${i}`,
      thumbnail: "",
      morphMs: 1000,
      holdMs: 500,
    }));
    const storage = memoryStorage({
      [TIMELINE_STORAGE_KEY]: JSON.stringify({ seed: 1, steps }),
    });

    const timeline = new TimelineStore({ storage });

    expect(timeline.size).toBe(TIMELINE_CAP);
    expect(timeline.all().map((s) => s.encoded)).toEqual(
      steps.slice(0, TIMELINE_CAP).map((s) => s.encoded),
    );
  });

  it("does not throw when storage.setItem throws (e.g. a full quota), and does not shorten the list", () => {
    const store: Record<string, string> = {};
    const storage = {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: () => {
        throw new Error("quota exceeded");
      },
    };

    const timeline = new TimelineStore({ storage });

    expect(() => {
      timeline.add("v1=a", "");
      timeline.add("v1=b", "");
    }).not.toThrow();

    expect(timeline.all().map((s) => s.encoded)).toEqual(["v1=a", "v1=b"]);
    expect(store[TIMELINE_STORAGE_KEY]).toBeUndefined();
  });
});

describe("TimelineStore restore", () => {
  it("re-inserts a removed step at the index it was removed from", () => {
    const timeline = new TimelineStore({ storage: memoryStorage() });
    timeline.add("v1=a", "");
    const b = timeline.add("v1=b", "");
    timeline.add("v1=c", "");
    if (!b) throw new Error("add unexpectedly refused");
    timeline.remove(b.id);

    timeline.restore(b, 1);

    expect(timeline.all().map((s) => s.encoded)).toEqual([
      "v1=a",
      "v1=b",
      "v1=c",
    ]);
  });

  it("clamps a stale index past the end to the tail", () => {
    const timeline = new TimelineStore({ storage: memoryStorage() });
    timeline.add("v1=a", "");
    timeline.add("v1=b", "");
    const c = timeline.add("v1=c", "");
    if (!c) throw new Error("add unexpectedly refused");
    timeline.remove(c.id);
    const aStep = timeline.all()[0];
    timeline.remove(aStep.id);

    timeline.restore(c, 2);

    expect(timeline.all().map((s) => s.encoded)).toEqual(["v1=b", "v1=c"]);
  });

  it("is a no-op when a step with the same id is already present", () => {
    const timeline = new TimelineStore({ storage: memoryStorage() });
    const a = timeline.add("v1=a", "");
    if (!a) throw new Error("add unexpectedly refused");

    timeline.restore(a, 0);

    expect(timeline.size).toBe(1);
  });

  it("refuses (rather than evicts) when the timeline is back at TIMELINE_CAP", () => {
    const timeline = new TimelineStore({ storage: memoryStorage() });
    for (let i = 0; i < TIMELINE_CAP; i++) timeline.add(`v1=s${i}`, "");
    const first = timeline.all()[0];
    timeline.remove(first.id);
    timeline.add("v1=refill", "");

    timeline.restore(first, 0);

    expect(timeline.size).toBe(TIMELINE_CAP);
    expect(timeline.all().some((s) => s.id === first.id)).toBe(false);
  });

  it("persists the restored step", () => {
    const storage = memoryStorage();
    const timeline = new TimelineStore({ storage });
    const a = timeline.add("v1=a", "");
    if (!a) throw new Error("add unexpectedly refused");
    timeline.remove(a.id);

    timeline.restore(a, 0);

    const reloaded = new TimelineStore({ storage });
    expect(reloaded.all().map((s) => s.encoded)).toEqual(["v1=a"]);
  });
});

describe("TimelineStore mode (fr-v3au)", () => {
  it("round-trips a mode tag through storage", () => {
    const storage = memoryStorage();
    new TimelineStore({ storage }).add("v1=a", "thumb-a", "flame");

    const reloaded = new TimelineStore({ storage });

    expect(reloaded.all()[0].mode).toBe("flame");
  });

  it("add without a mode leaves it undefined", () => {
    const timeline = new TimelineStore({ storage: memoryStorage() });
    const step = timeline.add("v1=a", "");

    expect(step?.mode).toBeUndefined();
  });

  it("loads a pre-fr-v3au step with no mode field at all, mode undefined and the step intact", () => {
    const storage = memoryStorage({
      [TIMELINE_STORAGE_KEY]: JSON.stringify({
        seed: 1,
        steps: [
          {
            id: "1",
            encoded: "v1=a",
            thumbnail: "thumb-a",
            morphMs: 1000,
            holdMs: 500,
          },
        ],
      }),
    });

    const timeline = new TimelineStore({ storage });

    expect(timeline.size).toBe(1);
    expect(timeline.all()[0]).toEqual({
      id: "1",
      encoded: "v1=a",
      thumbnail: "thumb-a",
      morphMs: 1000,
      holdMs: 500,
      mode: undefined,
    });
  });

  it("drops a garbage stored mode string to undefined while keeping the step", () => {
    const storage = memoryStorage({
      [TIMELINE_STORAGE_KEY]: JSON.stringify({
        seed: 1,
        steps: [
          {
            id: "1",
            encoded: "v1=a",
            thumbnail: "",
            morphMs: 1000,
            holdMs: 500,
            mode: "neon",
          },
        ],
      }),
    });

    const timeline = new TimelineStore({ storage });

    expect(timeline.size).toBe(1);
    expect(timeline.all()[0].mode).toBeUndefined();
    expect(timeline.all()[0].encoded).toBe("v1=a");
  });

  it("drops a garbage stored mode number to undefined while keeping the step", () => {
    const storage = memoryStorage({
      [TIMELINE_STORAGE_KEY]: JSON.stringify({
        seed: 1,
        steps: [
          {
            id: "1",
            encoded: "v1=a",
            thumbnail: "",
            morphMs: 1000,
            holdMs: 500,
            mode: 42,
          },
        ],
      }),
    });

    const timeline = new TimelineStore({ storage });

    expect(timeline.size).toBe(1);
    expect(timeline.all()[0].mode).toBeUndefined();
    expect(timeline.all()[0].encoded).toBe("v1=a");
  });

  it("restore after remove preserves the removed step's mode", () => {
    const timeline = new TimelineStore({ storage: memoryStorage() });
    const a = timeline.add("v1=a", "", "solid");
    if (!a) throw new Error("add unexpectedly refused");
    timeline.remove(a.id);

    timeline.restore(a, 0);

    expect(timeline.all()[0].mode).toBe("solid");
  });
});

describe("TimelineStore clear", () => {
  it("empties the steps and re-rolls the seed", () => {
    let rolls = 0;
    const timeline = new TimelineStore({
      storage: memoryStorage(),
      rollSeed: () => ++rolls * 1000,
    });
    timeline.add("v1=a", "");
    const seedBefore = timeline.seed;

    timeline.clear();

    expect(timeline.size).toBe(0);
    expect(timeline.all()).toEqual([]);
    expect(timeline.seed).not.toBe(seedBefore);
  });

  it("persists the cleared state: a second store over the same storage sees it empty with the new seed", () => {
    const storage = memoryStorage();
    const timeline = new TimelineStore({ storage, rollSeed: () => 42 });
    timeline.add("v1=a", "");

    timeline.clear();

    const reloaded = new TimelineStore({ storage });
    expect(reloaded.size).toBe(0);
    expect(reloaded.seed).toBe(timeline.seed);
  });
});

describe("TimelineStore replaceAll (fr-h9rk)", () => {
  it("replaces the existing steps wholesale, in the given order", () => {
    const timeline = new TimelineStore({ storage: memoryStorage() });
    timeline.add("v1=old-a", "");
    timeline.add("v1=old-b", "");

    timeline.replaceAll([
      {
        encoded: "v1=new-a",
        thumbnail: "thumb-a",
        morphMs: 1000,
        holdMs: 500,
      },
      {
        encoded: "v1=new-b",
        thumbnail: "thumb-b",
        morphMs: 2000,
        holdMs: 1000,
      },
      {
        encoded: "v1=new-c",
        thumbnail: "thumb-c",
        morphMs: 3000,
        holdMs: 1500,
      },
    ]);

    expect(timeline.all().map((s) => s.encoded)).toEqual([
      "v1=new-a",
      "v1=new-b",
      "v1=new-c",
    ]);
  });

  it("stores the given seed", () => {
    const timeline = new TimelineStore({ storage: memoryStorage() });

    timeline.replaceAll([], 1234);

    expect(timeline.seed).toBe(1234);
  });

  it("rolls a fresh seed when none is given", () => {
    const seeds = [7, 99];
    let i = 0;
    const timeline = new TimelineStore({
      storage: memoryStorage(),
      rollSeed: () => seeds[i++],
    });
    expect(timeline.seed).toBe(7);

    timeline.replaceAll([
      { encoded: "v1=a", thumbnail: "", morphMs: 1000, holdMs: 500 },
    ]);

    expect(timeline.seed).toBe(99);
  });

  it("mints fresh ids for the imported steps", () => {
    const timeline = new TimelineStore({ storage: memoryStorage() });

    timeline.replaceAll([
      { encoded: "v1=a", thumbnail: "", morphMs: 1000, holdMs: 500 },
      { encoded: "v1=b", thumbnail: "", morphMs: 1000, holdMs: 500 },
    ]);

    const [a, b] = timeline.all();
    expect(a.id).toBeTruthy();
    expect(b.id).toBeTruthy();
    expect(a.id).not.toBe(b.id);
  });

  it("clamps timings to [0, MAX_STEP_MS]", () => {
    const timeline = new TimelineStore({ storage: memoryStorage() });

    timeline.replaceAll([
      { encoded: "v1=a", thumbnail: "", morphMs: Infinity, holdMs: -5 },
    ]);

    expect(timeline.all()[0].morphMs).toBe(MAX_STEP_MS);
    expect(timeline.all()[0].holdMs).toBe(0);
  });

  it("truncates beyond TIMELINE_CAP", () => {
    const timeline = new TimelineStore({ storage: memoryStorage() });
    const steps = Array.from({ length: TIMELINE_CAP + 3 }, (_, i) => ({
      encoded: `v1=scene-${i}`,
      thumbnail: "",
      morphMs: 1000,
      holdMs: 500,
    }));

    timeline.replaceAll(steps);

    expect(timeline.size).toBe(TIMELINE_CAP);
    expect(timeline.all().map((s) => s.encoded)).toEqual(
      steps.slice(0, TIMELINE_CAP).map((s) => s.encoded),
    );
  });

  it("persists: a second store over the same storage sees the imported steps and seed", () => {
    const storage = memoryStorage();
    const first = new TimelineStore({ storage });

    first.replaceAll(
      [
        { encoded: "v1=a", thumbnail: "thumb-a", morphMs: 1000, holdMs: 500 },
        {
          encoded: "v1=b",
          thumbnail: "thumb-b",
          morphMs: 2000,
          holdMs: 1000,
        },
      ],
      4242,
    );

    const second = new TimelineStore({ storage });

    expect(second.all().map((s) => s.encoded)).toEqual(["v1=a", "v1=b"]);
    expect(second.seed).toBe(4242);
  });

  it("keeps each step's mode tag", () => {
    const timeline = new TimelineStore({ storage: memoryStorage() });

    timeline.replaceAll([
      {
        encoded: "v1=a",
        thumbnail: "",
        morphMs: 1000,
        holdMs: 500,
        mode: "flame",
      },
    ]);

    expect(timeline.all()[0].mode).toBe("flame");
  });

  it("round-trips a previous all() snapshot — the undo path", () => {
    const timeline = new TimelineStore({ storage: memoryStorage() });
    timeline.add("v1=a", "thumb-a");
    timeline.add("v1=b", "thumb-b");
    const prev = timeline.all();
    const prevSeed = timeline.seed;

    timeline.replaceAll(
      [{ encoded: "v1=c", thumbnail: "", morphMs: 1000, holdMs: 500 }],
      9999,
    );
    timeline.replaceAll(prev, prevSeed);

    expect(timeline.all().map((s) => s.encoded)).toEqual(["v1=a", "v1=b"]);
    expect(timeline.seed).toBe(prevSeed);
  });
});

describe("legSeed", () => {
  it("is stable for the same seed and index across calls", () => {
    expect(legSeed(42, 0)).toBe(legSeed(42, 0));
  });

  it("differs across leg indices for the same seed", () => {
    expect(legSeed(42, 0)).not.toBe(legSeed(42, 1));
  });

  it("differs across seeds for the same leg index", () => {
    expect(legSeed(42, 0)).not.toBe(legSeed(43, 0));
  });

  it("returns an integer in [0, 2^32)", () => {
    const value = legSeed(123456789, 7);
    expect(Number.isInteger(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(0x100000000);
  });
});

describe("timelineDurationMs", () => {
  it("sums morphMs + holdMs across all steps", () => {
    const total = timelineDurationMs([
      { morphMs: 1000, holdMs: 500 },
      { morphMs: 2000, holdMs: 1500 },
    ]);

    expect(total).toBe(5000);
  });

  it("is 0 for an empty list", () => {
    expect(timelineDurationMs([])).toBe(0);
  });
});
