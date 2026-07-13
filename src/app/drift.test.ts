import { DriftShow, DRIFT_DWELL_MS, DRIFT_MORPH_MS } from "./drift";

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
