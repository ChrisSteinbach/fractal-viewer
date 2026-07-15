import {
  BuildReplay,
  ACCRETE_MS,
  DONE_LINGER_MS,
  EMERGE_FRACTION,
  HOP_MS,
  HOP_POINTS,
  REPLAY_CAPTIONS,
  SPOTLIGHT_MAX_MAPS,
  SPOTLIGHT_STEP_MAX_MS,
  SPOTLIGHT_STEP_MIN_MS,
} from "./build-replay";

describe("BuildReplay idle state", () => {
  it("is idle before start() is ever called", () => {
    const replay = new BuildReplay(() => 0);

    expect(replay.frame()).toBeNull();
    expect(replay.active).toBe(false);
  });

  it("start(0) leaves the replay idle — there is nothing to reveal", () => {
    const replay = new BuildReplay(() => 0);

    replay.start(0, 1);

    expect(replay.frame()).toBeNull();
    expect(replay.active).toBe(false);
  });

  it("start(NaN) leaves the replay idle", () => {
    const replay = new BuildReplay(() => 0);

    replay.start(NaN, 1);

    expect(replay.frame()).toBeNull();
    expect(replay.active).toBe(false);
  });
});

describe("BuildReplay hop phase", () => {
  it("reveals a single point immediately when a big replay starts", () => {
    const replay = new BuildReplay(() => 0);

    replay.start(500000, 1);

    expect(replay.frame()).toEqual({
      revealed: 1,
      cursor: 0,
      phase: "hop",
      spotlight: null,
      caption: REPLAY_CAPTIONS.hop,
    });
  });

  it("advances the hop phase by one point every HOP_MS / HOP_POINTS ms", () => {
    let clock = 0;
    const replay = new BuildReplay(() => clock);
    replay.start(500000, 1);

    clock = HOP_MS / HOP_POINTS;
    expect(replay.frame()).toEqual({
      revealed: 2,
      cursor: 1,
      phase: "hop",
      spotlight: null,
      caption: REPLAY_CAPTIONS.hop,
    });

    clock = 11 * (HOP_MS / HOP_POINTS);
    expect(replay.frame()).toEqual({
      revealed: 12,
      cursor: 11,
      phase: "hop",
      spotlight: null,
      caption: REPLAY_CAPTIONS.hop,
    });
  });

  it("carries spotlight: null and the static REPLAY_CAPTIONS caption during the hop phase", () => {
    const replay = new BuildReplay(() => 0);
    replay.start(500000, 3);

    const frame = replay.frame()!;

    expect(frame.spotlight).toBeNull();
    expect(frame.caption).toBe(REPLAY_CAPTIONS.hop);
  });
});

describe("BuildReplay accrete/emerge phase", () => {
  it("keeps revealed monotonic and within [HOP_POINTS, total] through the accrete window", () => {
    let clock = 0;
    const replay = new BuildReplay(() => clock);
    const total = 500000;
    replay.start(total, 1);

    let previous = 0;
    for (clock = HOP_MS; clock <= HOP_MS + ACCRETE_MS; clock += 500) {
      const revealed = replay.frame()!.revealed;
      expect(revealed).toBeGreaterThanOrEqual(previous);
      expect(revealed).toBeGreaterThanOrEqual(HOP_POINTS);
      expect(revealed).toBeLessThanOrEqual(total);
      previous = revealed;
    }
  });

  it("flips the caption phase from accrete to emerge once revealed passes emergeAt", () => {
    let clock = 0;
    const replay = new BuildReplay(() => clock);
    const total = 500000;
    replay.start(total, 1);
    // emergeAt = max(HOP_POINTS + 1, ceil(total * EMERGE_FRACTION)); at this
    // total the ceil term dominates comfortably (10000 vs. 13).
    const emergeAt = Math.ceil(total * EMERGE_FRACTION);
    // Invert the log-space reveal curve to find the clock at which a given
    // revealed count is reached, rather than searching for it.
    const clockForReveal = (revealTarget: number): number => {
      const u =
        Math.log(revealTarget / HOP_POINTS) / Math.log(total / HOP_POINTS);
      return HOP_MS + ACCRETE_MS * u;
    };

    clock = clockForReveal(emergeAt * 2);
    expect(replay.frame()!.phase).toBe("emerge");

    clock = clockForReveal(emergeAt / 100);
    expect(replay.frame()!.phase).toBe("accrete");
  });
});

describe("BuildReplay spotlight phase", () => {
  it("starts the spotlight phase right when the accrete window ends", () => {
    let clock = 0;
    const replay = new BuildReplay(() => clock);
    const total = 500000;
    replay.start(total, 3);

    clock = HOP_MS + ACCRETE_MS;

    expect(replay.frame()).toEqual({
      revealed: total,
      cursor: null,
      phase: "spotlight",
      spotlight: 0,
      caption: "Map 1 of 3: its landings alone — a shrunken copy of the whole",
    });
  });

  it("holds each of a 3-map system's spotlights for the full step ceiling before advancing", () => {
    let clock = 0;
    const replay = new BuildReplay(() => clock);
    // 3 maps: 13000 / 3 ≈ 4333 ms/step clamps to the 2600 ms ceiling.
    replay.start(500000, 3);
    const spotlightStart = HOP_MS + ACCRETE_MS;

    clock = spotlightStart;
    expect(replay.frame()!.spotlight).toBe(0);

    clock = spotlightStart + SPOTLIGHT_STEP_MAX_MS - 1;
    expect(replay.frame()!.spotlight).toBe(0);

    clock = spotlightStart + SPOTLIGHT_STEP_MAX_MS;
    expect(replay.frame()!.spotlight).toBe(1);

    clock = spotlightStart + 2 * SPOTLIGHT_STEP_MAX_MS - 1;
    expect(replay.frame()!.spotlight).toBe(1);

    clock = spotlightStart + 2 * SPOTLIGHT_STEP_MAX_MS;
    expect(replay.frame()!.spotlight).toBe(2);
  });

  it("captions the spotlight step with its map number and the map count", () => {
    let clock = 0;
    const replay = new BuildReplay(() => clock);
    replay.start(500000, 3);

    clock = HOP_MS + ACCRETE_MS + SPOTLIGHT_STEP_MAX_MS;

    expect(replay.frame()!.caption).toBe(
      "Map 2 of 3: its landings alone — a shrunken copy of the whole",
    );
  });

  it("clamps the spotlight index to the last map through the final instant of the window", () => {
    let clock = 0;
    const replay = new BuildReplay(() => clock);
    replay.start(500000, 3);
    const spotlightStart = HOP_MS + ACCRETE_MS;
    const spotlightMs = 3 * SPOTLIGHT_STEP_MAX_MS;

    clock = spotlightStart + spotlightMs - 1;

    expect(replay.frame()!.spotlight).toBe(2);
  });

  it("holds a 16-map system's steps at the floor, touring in 16 × SPOTLIGHT_STEP_MIN_MS", () => {
    let clock = 0;
    const replay = new BuildReplay(() => clock);
    // 16 maps: 13000 / 16 = 812.5 ms/step clamps to the 900 ms floor.
    replay.start(500000, 16);
    const spotlightStart = HOP_MS + ACCRETE_MS;

    clock = spotlightStart + SPOTLIGHT_STEP_MIN_MS - 1;
    expect(replay.frame()!.spotlight).toBe(0);

    clock = spotlightStart + SPOTLIGHT_STEP_MIN_MS;
    expect(replay.frame()!.spotlight).toBe(1);

    clock = spotlightStart + 16 * SPOTLIGHT_STEP_MIN_MS - 1;
    expect(replay.frame()!.spotlight).toBe(15);

    clock = spotlightStart + 16 * SPOTLIGHT_STEP_MIN_MS;
    expect(replay.frame()!.phase).toBe("done");
  });

  it("holds a small 2-map system's steps at the ceiling instead of stretching to fill the budget", () => {
    let clock = 0;
    const replay = new BuildReplay(() => clock);
    // 2 maps: 13000 / 2 = 6500 ms/step clamps to the 2600 ms ceiling.
    replay.start(500000, 2);
    const spotlightStart = HOP_MS + ACCRETE_MS;

    clock = spotlightStart + SPOTLIGHT_STEP_MAX_MS - 1;
    expect(replay.frame()!.spotlight).toBe(0);

    clock = spotlightStart + SPOTLIGHT_STEP_MAX_MS;
    expect(replay.frame()!.spotlight).toBe(1);

    clock = spotlightStart + 2 * SPOTLIGHT_STEP_MAX_MS;
    expect(replay.frame()!.phase).toBe("done");
  });

  it("skips the spotlight phase above SPOTLIGHT_MAX_MAPS — too fine-grained to teach anything", () => {
    let clock = 0;
    const replay = new BuildReplay(() => clock);
    replay.start(500000, SPOTLIGHT_MAX_MAPS + 1);

    clock = HOP_MS + ACCRETE_MS;

    expect(replay.frame()!.phase).toBe("done");
  });

  it("still tours a system of exactly SPOTLIGHT_MAX_MAPS maps", () => {
    let clock = 0;
    const replay = new BuildReplay(() => clock);
    replay.start(500000, SPOTLIGHT_MAX_MAPS);

    clock = HOP_MS + ACCRETE_MS;

    const frame = replay.frame()!;
    expect(frame.phase).toBe("spotlight");
    expect(frame.spotlight).toBe(0);
    expect(frame.caption).toBe(
      `Map 1 of ${SPOTLIGHT_MAX_MAPS}: its landings alone — a shrunken copy of the whole`,
    );
  });

  it("skips the spotlight phase entirely for a single-map system", () => {
    let clock = 0;
    const replay = new BuildReplay(() => clock);
    replay.start(500000, 1);

    clock = HOP_MS + ACCRETE_MS;
    expect(replay.frame()!.phase).toBe("done");

    clock = HOP_MS + ACCRETE_MS + DONE_LINGER_MS;
    expect(replay.frame()).toBeNull();
  });

  it("skips the spotlight phase for a non-finite map count", () => {
    let clock = 0;
    const replay = new BuildReplay(() => clock);
    replay.start(500000, NaN);

    clock = HOP_MS + ACCRETE_MS;

    expect(replay.frame()!.phase).toBe("done");
  });

  it("lingers in done for DONE_LINGER_MS after a real spotlight window, then goes idle", () => {
    let clock = 0;
    const replay = new BuildReplay(() => clock);
    replay.start(500000, 3);
    const spotlightEnd = HOP_MS + ACCRETE_MS + 3 * SPOTLIGHT_STEP_MAX_MS;

    clock = spotlightEnd + DONE_LINGER_MS - 1;
    expect(replay.frame()!.phase).toBe("done");

    clock = spotlightEnd + DONE_LINGER_MS;
    expect(replay.frame()).toBeNull();
    expect(replay.active).toBe(false);
  });

  it("cancels immediately even mid-spotlight", () => {
    let clock = 0;
    const replay = new BuildReplay(() => clock);
    replay.start(500000, 3);
    clock = HOP_MS + ACCRETE_MS + SPOTLIGHT_STEP_MAX_MS;

    replay.cancel();

    expect(replay.frame()).toBeNull();
    expect(replay.active).toBe(false);
  });
});

describe("BuildReplay done phase", () => {
  it("reveals the full cloud once hop+accrete elapses, entering done", () => {
    let clock = 0;
    const replay = new BuildReplay(() => clock);
    const total = 500000;
    replay.start(total, 1);

    clock = HOP_MS + ACCRETE_MS;

    expect(replay.frame()).toEqual({
      revealed: total,
      cursor: null,
      phase: "done",
      spotlight: null,
      caption: REPLAY_CAPTIONS.done,
    });
  });

  it("lingers in done through DONE_LINGER_MS, then goes idle", () => {
    let clock = 0;
    const replay = new BuildReplay(() => clock);
    replay.start(500000, 1);

    clock = HOP_MS + ACCRETE_MS + DONE_LINGER_MS - 1;
    expect(replay.frame()!.phase).toBe("done");

    clock = HOP_MS + ACCRETE_MS + DONE_LINGER_MS;
    expect(replay.frame()).toBeNull();
    expect(replay.active).toBe(false);
  });
});

describe("BuildReplay.cancel", () => {
  it("stops an active replay and returns it to idle", () => {
    let clock = 0;
    const replay = new BuildReplay(() => clock);
    replay.start(500000, 1);
    clock = 1500;

    replay.cancel();

    expect(replay.frame()).toBeNull();
    expect(replay.active).toBe(false);
  });
});

describe("BuildReplay.start restart", () => {
  it("restarts from the beginning when start() is called again mid-flight", () => {
    let clock = 0;
    const replay = new BuildReplay(() => clock);
    replay.start(100, 1);
    clock = 5000;

    replay.start(200, 1);

    expect(replay.frame()).toEqual({
      revealed: 1,
      cursor: 0,
      phase: "hop",
      spotlight: null,
      caption: REPLAY_CAPTIONS.hop,
    });
  });
});

describe("BuildReplay small clouds", () => {
  it("plays a small 5-point cloud with no accrete ramp (hop alone reveals everything)", () => {
    let clock = 0;
    const replay = new BuildReplay(() => clock);
    replay.start(5, 1);

    clock = 1000;
    expect(replay.frame()).toEqual({
      revealed: 5,
      cursor: 4,
      phase: "hop",
      spotlight: null,
      caption: REPLAY_CAPTIONS.hop,
    });

    clock = 1250;
    expect(replay.frame()).toEqual({
      revealed: 5,
      cursor: null,
      phase: "done",
      spotlight: null,
      caption: REPLAY_CAPTIONS.done,
    });

    clock = 3750;
    expect(replay.frame()).toBeNull();
    expect(replay.active).toBe(false);
  });

  it("plays a single-point cloud: the hop window is just HOP_MS / HOP_POINTS ms", () => {
    let clock = 0;
    const replay = new BuildReplay(() => clock);
    replay.start(1, 1);

    expect(replay.frame()).toEqual({
      revealed: 1,
      cursor: 0,
      phase: "hop",
      spotlight: null,
      caption: REPLAY_CAPTIONS.hop,
    });

    clock = HOP_MS / HOP_POINTS;
    expect(replay.frame()).toEqual({
      revealed: 1,
      cursor: null,
      phase: "done",
      spotlight: null,
      caption: REPLAY_CAPTIONS.done,
    });
  });
});
