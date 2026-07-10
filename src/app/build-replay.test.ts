import {
  BuildReplay,
  ACCRETE_MS,
  DONE_LINGER_MS,
  EMERGE_FRACTION,
  HOP_MS,
  HOP_POINTS,
} from "./build-replay";

describe("BuildReplay idle state", () => {
  it("is idle before start() is ever called", () => {
    const replay = new BuildReplay(() => 0);

    expect(replay.frame()).toBeNull();
    expect(replay.active).toBe(false);
  });

  it("start(0) leaves the replay idle — there is nothing to reveal", () => {
    const replay = new BuildReplay(() => 0);

    replay.start(0);

    expect(replay.frame()).toBeNull();
    expect(replay.active).toBe(false);
  });

  it("start(NaN) leaves the replay idle", () => {
    const replay = new BuildReplay(() => 0);

    replay.start(NaN);

    expect(replay.frame()).toBeNull();
    expect(replay.active).toBe(false);
  });
});

describe("BuildReplay hop phase", () => {
  it("reveals a single point immediately when a big replay starts", () => {
    const replay = new BuildReplay(() => 0);

    replay.start(500000);

    expect(replay.frame()).toEqual({ revealed: 1, cursor: 0, phase: "hop" });
  });

  it("advances the hop phase by one point every HOP_MS / HOP_POINTS ms", () => {
    let clock = 0;
    const replay = new BuildReplay(() => clock);
    replay.start(500000);

    clock = HOP_MS / HOP_POINTS;
    expect(replay.frame()).toEqual({ revealed: 2, cursor: 1, phase: "hop" });

    clock = 11 * (HOP_MS / HOP_POINTS);
    expect(replay.frame()).toEqual({ revealed: 12, cursor: 11, phase: "hop" });
  });
});

describe("BuildReplay accrete/emerge phase", () => {
  it("keeps revealed monotonic and within [HOP_POINTS, total] through the accrete window", () => {
    let clock = 0;
    const replay = new BuildReplay(() => clock);
    const total = 500000;
    replay.start(total);

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
    replay.start(total);
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

describe("BuildReplay done phase", () => {
  it("reveals the full cloud once hop+accrete elapses, entering done", () => {
    let clock = 0;
    const replay = new BuildReplay(() => clock);
    const total = 500000;
    replay.start(total);

    clock = HOP_MS + ACCRETE_MS;

    expect(replay.frame()).toEqual({
      revealed: total,
      cursor: null,
      phase: "done",
    });
  });

  it("lingers in done through DONE_LINGER_MS, then goes idle", () => {
    let clock = 0;
    const replay = new BuildReplay(() => clock);
    replay.start(500000);

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
    replay.start(500000);
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
    replay.start(100);
    clock = 5000;

    replay.start(200);

    expect(replay.frame()).toEqual({ revealed: 1, cursor: 0, phase: "hop" });
  });
});

describe("BuildReplay small clouds", () => {
  it("plays a small 5-point cloud with no accrete ramp (hop alone reveals everything)", () => {
    let clock = 0;
    const replay = new BuildReplay(() => clock);
    replay.start(5);

    clock = 1000;
    expect(replay.frame()).toEqual({ revealed: 5, cursor: 4, phase: "hop" });

    clock = 1250;
    expect(replay.frame()).toEqual({
      revealed: 5,
      cursor: null,
      phase: "done",
    });

    clock = 3750;
    expect(replay.frame()).toBeNull();
    expect(replay.active).toBe(false);
  });

  it("plays a single-point cloud: the hop window is just HOP_MS / HOP_POINTS ms", () => {
    let clock = 0;
    const replay = new BuildReplay(() => clock);
    replay.start(1);

    expect(replay.frame()).toEqual({ revealed: 1, cursor: 0, phase: "hop" });

    clock = HOP_MS / HOP_POINTS;
    expect(replay.frame()).toEqual({
      revealed: 1,
      cursor: null,
      phase: "done",
    });
  });
});
