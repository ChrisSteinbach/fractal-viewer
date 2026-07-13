import {
  DriftShow,
  DRIFT_DWELL_MS,
  DRIFT_MORPH_MS,
  DRIFT_RENDER_LINGER_MS,
} from "./drift";

describe("DriftShow idle state", () => {
  it("is idle before start() is ever called", () => {
    const drift = new DriftShow(() => 0);

    expect(drift.active).toBe(false);
    expect(drift.frame()).toBe(false);
  });
});

describe("DriftShow.start", () => {
  it("arms the show, but doesn't fire until the dwell elapses", () => {
    let t = 0;
    const drift = new DriftShow(() => t);

    drift.start();
    expect(drift.active).toBe(true);

    t = DRIFT_DWELL_MS - 1;
    expect(drift.frame()).toBe(false);
  });

  it("re-arms the dwell from now when called again while already active", () => {
    let t = 0;
    const drift = new DriftShow(() => t);
    drift.start();

    t = DRIFT_DWELL_MS - 1;
    drift.start();

    t = 2 * DRIFT_DWELL_MS - 2;
    expect(drift.frame()).toBe(false);

    t = DRIFT_DWELL_MS - 1 + DRIFT_DWELL_MS;
    expect(drift.frame()).toBe(true);
  });
});

describe("DriftShow dwell boundary", () => {
  it("fires exactly at the dwell boundary", () => {
    let t = 0;
    const drift = new DriftShow(() => t);
    drift.start();

    t = DRIFT_DWELL_MS;

    expect(drift.frame()).toBe(true);
  });

  it("fires once per boundary: polling again at the same instant is false", () => {
    let t = 0;
    const drift = new DriftShow(() => t);
    drift.start();
    t = DRIFT_DWELL_MS;
    expect(drift.frame()).toBe(true);

    expect(drift.frame()).toBe(false);
  });

  it("resumes the morph+dwell cadence after a leg fires", () => {
    let t = 0;
    const drift = new DriftShow(() => t);
    drift.start();
    t = DRIFT_DWELL_MS;
    const t0 = t;
    expect(drift.frame()).toBe(true);

    t = t0 + DRIFT_MORPH_MS + DRIFT_DWELL_MS - 1;
    expect(drift.frame()).toBe(false);

    t = t0 + DRIFT_MORPH_MS + DRIFT_DWELL_MS;
    expect(drift.frame()).toBe(true);
  });
});

describe("DriftShow.stop", () => {
  it("goes idle even at a time long past the armed boundary", () => {
    let t = 0;
    const drift = new DriftShow(() => t);
    drift.start();
    t = 1000;

    drift.stop();

    t = 10 * DRIFT_DWELL_MS;
    expect(drift.active).toBe(false);
    expect(drift.frame()).toBe(false);
  });

  it("allows a clean restart: start() after stop() fires at the fresh dwell boundary", () => {
    let t = 0;
    const drift = new DriftShow(() => t);
    drift.start();
    t = 1000;
    drift.stop();

    t = 5000;
    drift.start();

    t = 5000 + DRIFT_DWELL_MS - 1;
    expect(drift.frame()).toBe(false);

    t = 5000 + DRIFT_DWELL_MS;
    expect(drift.frame()).toBe(true);
  });
});

describe("DriftShow.hold", () => {
  it("suspends the deadline: an armed show never fires while held, however late the poll", () => {
    let t = 0;
    const drift = new DriftShow(() => t);
    drift.start();

    drift.hold();

    expect(drift.active).toBe(true);
    expect(drift.holding).toBe(true);
    t = 100 * (DRIFT_MORPH_MS + DRIFT_DWELL_MS);
    expect(drift.frame()).toBe(false);
  });

  it("is a no-op while idle: holding is a way of being active, not of becoming it", () => {
    const drift = new DriftShow(() => 0);

    drift.hold();

    expect(drift.active).toBe(false);
    expect(drift.holding).toBe(false);
  });

  it("start() while held re-arms the plain dwell (a fresh toggle outranks a hold)", () => {
    let t = 0;
    const drift = new DriftShow(() => t);
    drift.start();
    drift.hold();

    t = 1000;
    drift.start();

    expect(drift.holding).toBe(false);
    t = 1000 + DRIFT_DWELL_MS;
    expect(drift.frame()).toBe(true);
  });
});

describe("DriftShow.resumeAfter", () => {
  it("ends a hold: the next leg departs exactly the delay after the resume", () => {
    let t = 0;
    const drift = new DriftShow(() => t);
    drift.start();
    drift.hold();

    t = 30_000;
    drift.resumeAfter(DRIFT_RENDER_LINGER_MS);

    expect(drift.holding).toBe(false);
    t = 30_000 + DRIFT_RENDER_LINGER_MS - 1;
    expect(drift.frame()).toBe(false);
    t = 30_000 + DRIFT_RENDER_LINGER_MS;
    expect(drift.frame()).toBe(true);
  });

  it("a leg fired via resumeAfter reschedules the normal morph+dwell cadence", () => {
    let t = 0;
    const drift = new DriftShow(() => t);
    drift.start();
    drift.hold();
    drift.resumeAfter(DRIFT_RENDER_LINGER_MS);
    t = DRIFT_RENDER_LINGER_MS;
    expect(drift.frame()).toBe(true);

    t = DRIFT_RENDER_LINGER_MS + DRIFT_MORPH_MS + DRIFT_DWELL_MS - 1;
    expect(drift.frame()).toBe(false);
    t = DRIFT_RENDER_LINGER_MS + DRIFT_MORPH_MS + DRIFT_DWELL_MS;
    expect(drift.frame()).toBe(true);
  });

  it("is a no-op while idle: a completion signal after stop() must not restart the show", () => {
    let t = 0;
    const drift = new DriftShow(() => t);
    drift.start();
    drift.hold();
    drift.stop();

    drift.resumeAfter(DRIFT_RENDER_LINGER_MS);

    expect(drift.active).toBe(false);
    t = 10 * (DRIFT_MORPH_MS + DRIFT_DWELL_MS);
    expect(drift.frame()).toBe(false);
  });

  it("is a no-op on a clock deadline: a stray signal can't reschedule an unheld show", () => {
    let t = 0;
    const drift = new DriftShow(() => t);
    drift.start();

    drift.resumeAfter(DRIFT_RENDER_LINGER_MS);

    t = DRIFT_RENDER_LINGER_MS;
    expect(drift.frame()).toBe(false); // NOT pulled earlier than the dwell
    t = DRIFT_DWELL_MS;
    expect(drift.frame()).toBe(true); // the original dwell still governs
  });
});

describe("DriftShow backgrounded tab", () => {
  it("fires exactly one catch-up leg after a long unpolled gap, rescheduling from the catch-up instant rather than the stale due time", () => {
    let t = 0;
    const drift = new DriftShow(() => t);
    drift.start();

    const gapEnd = 10 * (DRIFT_MORPH_MS + DRIFT_DWELL_MS);
    t = gapEnd;
    expect(drift.frame()).toBe(true);
    expect(drift.frame()).toBe(false);

    t = gapEnd + DRIFT_MORPH_MS + DRIFT_DWELL_MS - 1;
    expect(drift.frame()).toBe(false);

    t = gapEnd + DRIFT_MORPH_MS + DRIFT_DWELL_MS;
    expect(drift.frame()).toBe(true);
  });
});
