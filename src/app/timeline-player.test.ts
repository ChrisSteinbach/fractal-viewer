import { TimelinePlayer } from "./timeline-player";

describe("TimelinePlayer idle state", () => {
  it("is idle before start() is ever called", () => {
    const player = new TimelinePlayer(() => 0);

    expect(player.active).toBe(false);
    expect(player.frame()).toBe(null);
  });
});

describe("TimelinePlayer.start with no steps", () => {
  it("start([]) leaves the player idle", () => {
    const player = new TimelinePlayer(() => 0);

    player.start([]);

    expect(player.active).toBe(false);
    expect(player.frame()).toBe(null);
  });
});

describe("TimelinePlayer leg 0", () => {
  it("fires on the very first poll, at zero elapsed time, exactly once, leaving the player active", () => {
    const t = 0;
    const player = new TimelinePlayer(() => t);

    player.start([
      { morphMs: 1000, holdMs: 500 },
      { morphMs: 2000, holdMs: 300 },
    ]);

    expect(player.frame()).toEqual({ kind: "leg", index: 0 });
    expect(player.active).toBe(true);
    // Same instant, second poll: leg 0 already consumed, leg 1 not due yet.
    expect(player.frame()).toBe(null);
  });
});

describe("TimelinePlayer leg boundaries", () => {
  it("accumulates morphMs + holdMs across steps, then reports done once the last hold elapses", () => {
    let t = 0;
    const player = new TimelinePlayer(() => t);

    player.start([
      { morphMs: 1000, holdMs: 500 },
      { morphMs: 2000, holdMs: 300 },
    ]);

    // Leg 0 fires immediately.
    expect(player.frame()).toEqual({ kind: "leg", index: 0 });

    // Leg 1 is due at 1000 + 500 = 1500.
    t = 1499;
    expect(player.frame()).toBe(null);
    t = 1500;
    expect(player.frame()).toEqual({ kind: "leg", index: 1 });

    // The run ends at 1500 + 2000 + 300 = 3800.
    t = 3799;
    expect(player.frame()).toBe(null);
    t = 3800;
    expect(player.frame()).toEqual({ kind: "done" });

    expect(player.active).toBe(false);
    t = 999_999;
    expect(player.frame()).toBe(null);
  });
});

describe("TimelinePlayer catch-up", () => {
  it("fires exactly one event per poll even when multiple leg boundaries have elapsed", () => {
    let t = 0;
    const player = new TimelinePlayer(() => t);

    // due: [0, 150, 300]; end due: 450.
    player.start([
      { morphMs: 100, holdMs: 50 },
      { morphMs: 100, holdMs: 50 },
      { morphMs: 100, holdMs: 50 },
    ]);
    expect(player.frame()).toEqual({ kind: "leg", index: 0 });

    // Jump past both leg 1 (due 150) and leg 2 (due 300) at once.
    t = 300;
    expect(player.frame()).toEqual({ kind: "leg", index: 2 });

    // The end (450) isn't due yet, so the next poll is null, not "done".
    expect(player.frame()).toBe(null);
  });
});

describe("TimelinePlayer clock jumps past the end with legs still unfired", () => {
  it("fires the last leg on the first poll, done on the second, null on the third", () => {
    let t = 0;
    const player = new TimelinePlayer(() => t);

    // due: [0, 1500]; end due: 3800.
    player.start([
      { morphMs: 1000, holdMs: 500 },
      { morphMs: 2000, holdMs: 300 },
    ]);

    t = 1_000_000;
    expect(player.frame()).toEqual({ kind: "leg", index: 1 });
    expect(player.active).toBe(true); // done not reported yet
    expect(player.frame()).toEqual({ kind: "done" });
    expect(player.active).toBe(false);
    expect(player.frame()).toBe(null);
  });
});

describe("TimelinePlayer coincident 0/0 step", () => {
  it("skips a step authored with morphMs 0 and holdMs 0 — the latest-wins rule fires the next leg instead", () => {
    let t = 0;
    const player = new TimelinePlayer(() => t);

    // due: [0, 0] (leg 0 and leg 1 coincide); end due: 1000.
    player.start([
      { morphMs: 0, holdMs: 0 },
      { morphMs: 1000, holdMs: 0 },
    ]);

    expect(player.frame()).toEqual({ kind: "leg", index: 1 });

    t = 999;
    expect(player.frame()).toBe(null);
    t = 1000;
    expect(player.frame()).toEqual({ kind: "done" });
  });
});

describe("TimelinePlayer.stop", () => {
  it("returns to idle immediately, with no event, and stays idle however late it's polled afterward", () => {
    let t = 0;
    const player = new TimelinePlayer(() => t);

    player.start([
      { morphMs: 1000, holdMs: 500 },
      { morphMs: 2000, holdMs: 300 },
    ]);
    expect(player.frame()).toEqual({ kind: "leg", index: 0 });

    t = 700;
    player.stop();

    expect(player.active).toBe(false);
    t = 999_999;
    expect(player.frame()).toBe(null);
  });
});

describe("TimelinePlayer restart while active", () => {
  it("replaces the in-flight run with a fresh schedule timed from now", () => {
    let t = 0;
    const player = new TimelinePlayer(() => t);

    // Old schedule: due [0, 3000].
    player.start([
      { morphMs: 2000, holdMs: 1000 },
      { morphMs: 2000, holdMs: 300 },
    ]);
    expect(player.frame()).toEqual({ kind: "leg", index: 0 });

    t = 700;
    // New schedule anchored at t=700: due [0, 6000] relative to startMs.
    player.start([
      { morphMs: 5000, holdMs: 1000 },
      { morphMs: 2000, holdMs: 300 },
    ]);

    // New leg 0 fires immediately on the very next poll.
    expect(player.frame()).toEqual({ kind: "leg", index: 0 });

    // The OLD schedule's leg-1 boundary (absolute t=3000) no longer fires
    // anything — the new schedule's own leg 1 isn't due until 700 + 6000.
    t = 3000;
    expect(player.frame()).toBe(null);

    t = 700 + 6000;
    expect(player.frame()).toEqual({ kind: "leg", index: 1 });
  });
});

describe("TimelinePlayer restart after done", () => {
  it("plays again after a completed run", () => {
    let t = 0;
    const player = new TimelinePlayer(() => t);

    player.start([{ morphMs: 100, holdMs: 50 }]);
    expect(player.frame()).toEqual({ kind: "leg", index: 0 });
    t = 150;
    expect(player.frame()).toEqual({ kind: "done" });
    expect(player.active).toBe(false);

    t = 1000;
    player.start([{ morphMs: 100, holdMs: 50 }]);

    expect(player.active).toBe(true);
    expect(player.frame()).toEqual({ kind: "leg", index: 0 });
    t = 1150;
    expect(player.frame()).toEqual({ kind: "done" });
    expect(player.active).toBe(false);
  });
});

describe("TimelinePlayer held legs (fr-v3au)", () => {
  it("hold suspends firing: frame() returns null repeatedly however far the clock runs, staying active and held", () => {
    let t = 0;
    const player = new TimelinePlayer(() => t);

    // due: [0, 150, 300]; end due: 450.
    player.start([
      { morphMs: 100, holdMs: 50 },
      { morphMs: 100, holdMs: 50 },
      { morphMs: 100, holdMs: 50 },
    ]);
    expect(player.frame()).toEqual({ kind: "leg", index: 0 });

    player.hold();

    t = 1_000_000; // way past every due time, including endDue (450)
    expect(player.frame()).toBe(null);
    expect(player.frame()).toBe(null);
    expect(player.frame()).toBe(null);
    expect(player.active).toBe(true);
    expect(player.holding).toBe(true);
  });

  it("resume re-arms from the held leg's own holdMs, not a fixed linger", () => {
    let t = 0;
    const player = new TimelinePlayer(() => t);

    // due: [0, 150, 300]; end due: 450.
    player.start([
      { morphMs: 100, holdMs: 50 },
      { morphMs: 100, holdMs: 50 },
      { morphMs: 100, holdMs: 50 },
    ]);
    expect(player.frame()).toEqual({ kind: "leg", index: 0 });
    player.hold();

    const resumeAt = 500_000; // arbitrary late clock reading
    t = resumeAt;
    player.resume();

    // Leg 0's own holdMs (50) governs the re-armed due time, counted from
    // the resume instant, not from the original due times.
    t = resumeAt + 49;
    expect(player.frame()).toBe(null);
    t = resumeAt + 50;
    expect(player.frame()).toEqual({ kind: "leg", index: 1 });
  });

  it("authored relative spacing survives a resume: later legs aren't shifted by how long the hold lasted", () => {
    let t = 0;
    const player = new TimelinePlayer(() => t);

    // due: [0, 150, 300]; end due: 450.
    player.start([
      { morphMs: 100, holdMs: 50 },
      { morphMs: 100, holdMs: 50 },
      { morphMs: 100, holdMs: 50 },
    ]);
    expect(player.frame()).toEqual({ kind: "leg", index: 0 });
    player.hold();

    t = 500_000;
    player.resume();
    t = 500_050;
    expect(player.frame()).toEqual({ kind: "leg", index: 1 });

    // Leg 2 is due at leg 1's actual due time (500_050) plus step 1's own
    // morphMs + holdMs (100 + 50 = 150) = 500_200 — the AUTHORED spacing,
    // regardless of how long the hold ran before the resume.
    t = 500_199;
    expect(player.frame()).toBe(null);
    t = 500_200;
    expect(player.frame()).toEqual({ kind: "leg", index: 2 });
  });

  it("hold on the last leg resumes into done, holdMs later", () => {
    let t = 0;
    const player = new TimelinePlayer(() => t);

    // due: [0]; end due: 150.
    player.start([{ morphMs: 100, holdMs: 50 }]);
    expect(player.frame()).toEqual({ kind: "leg", index: 0 });
    player.hold();

    t = 1_000_000; // way past end due (150)
    expect(player.frame()).toBe(null);
    expect(player.active).toBe(true);

    const resumeAt = 2_000_000;
    t = resumeAt;
    player.resume();

    t = resumeAt + 49;
    expect(player.frame()).toBe(null);
    t = resumeAt + 50;
    expect(player.frame()).toEqual({ kind: "done" });
    expect(player.active).toBe(false);
  });

  it("resume while not holding is a no-op: a running schedule's next leg still fires on its original due time", () => {
    let t = 0;
    const player = new TimelinePlayer(() => t);

    // due: [0, 150]; end due: 300.
    player.start([
      { morphMs: 100, holdMs: 50 },
      { morphMs: 100, holdMs: 50 },
    ]);
    expect(player.frame()).toEqual({ kind: "leg", index: 0 });

    player.resume(); // stray signal — not holding, must do nothing

    t = 149;
    expect(player.frame()).toBe(null);
    t = 150;
    expect(player.frame()).toEqual({ kind: "leg", index: 1 });
  });

  it("hold before any leg has fired is a no-op: leg 0 still fires on the first poll", () => {
    const t = 0;
    const player = new TimelinePlayer(() => t);

    player.start([
      { morphMs: 100, holdMs: 50 },
      { morphMs: 100, holdMs: 50 },
    ]);

    player.hold(); // no leg fired yet — must do nothing

    expect(player.holding).toBe(false);
    expect(player.frame()).toEqual({ kind: "leg", index: 0 });
  });

  it("hold while idle is a no-op, both before the first start() and after a run completes", () => {
    let t = 0;
    const player = new TimelinePlayer(() => t);

    player.hold();
    expect(player.holding).toBe(false);
    expect(player.frame()).toBe(null);

    player.start([{ morphMs: 100, holdMs: 50 }]);
    expect(player.frame()).toEqual({ kind: "leg", index: 0 });
    t = 150;
    expect(player.frame()).toEqual({ kind: "done" });
    expect(player.active).toBe(false);

    player.hold(); // idle again after done — still a no-op
    expect(player.holding).toBe(false);
    expect(player.frame()).toBe(null);
  });

  it("stop clears a hold: a fresh start() afterward is not held", () => {
    const t = 0;
    const player = new TimelinePlayer(() => t);

    player.start([
      { morphMs: 100, holdMs: 50 },
      { morphMs: 100, holdMs: 50 },
    ]);
    expect(player.frame()).toEqual({ kind: "leg", index: 0 });
    player.hold();
    expect(player.holding).toBe(true);

    player.stop();
    expect(player.holding).toBe(false);
    expect(player.active).toBe(false);
    expect(player.frame()).toBe(null);

    player.start([{ morphMs: 100, holdMs: 50 }]);
    expect(player.holding).toBe(false);
    expect(player.frame()).toEqual({ kind: "leg", index: 0 });
  });

  it("double hold is idempotent: a second hold() changes nothing, one resume() still re-arms it", () => {
    let t = 0;
    const player = new TimelinePlayer(() => t);

    // due: [0, 150, 300]; end due: 450.
    player.start([
      { morphMs: 100, holdMs: 50 },
      { morphMs: 100, holdMs: 50 },
      { morphMs: 100, holdMs: 50 },
    ]);
    expect(player.frame()).toEqual({ kind: "leg", index: 0 });

    player.hold();
    player.hold(); // redundant — must not re-anchor the held leg

    const resumeAt = 500_000;
    t = resumeAt;
    player.resume();

    t = resumeAt + 49;
    expect(player.frame()).toBe(null);
    t = resumeAt + 50;
    expect(player.frame()).toEqual({ kind: "leg", index: 1 });
  });

  it("catch-up then hold: holding the leg fired by a catch-up jump still resumes correctly", () => {
    let t = 0;
    const player = new TimelinePlayer(() => t);

    // due: [0, 150, 300]; end due: 450.
    player.start([
      { morphMs: 100, holdMs: 50 },
      { morphMs: 100, holdMs: 50 },
      { morphMs: 100, holdMs: 50 },
    ]);

    // Blow the clock past every due time before the very first poll — the
    // catch-up rule fires only the latest, leg 2.
    t = 1_000_000;
    expect(player.frame()).toEqual({ kind: "leg", index: 2 });

    player.hold();
    expect(player.holding).toBe(true);

    const resumeAt = 2_000_000;
    t = resumeAt;
    player.resume();

    // Leg 2's own holdMs (50) governs the done time.
    t = resumeAt + 49;
    expect(player.frame()).toBe(null);
    t = resumeAt + 50;
    expect(player.frame()).toEqual({ kind: "done" });
    expect(player.active).toBe(false);
  });
});
