import { DriftShow, DRIFT_DWELL_MS, DRIFT_MORPH_MS } from "./drift";
import { DriftPolicy } from "./drift-policy";

describe("DriftPolicy.stop", () => {
  it("ends an active show and reports a silent stop", () => {
    const t = 0;
    const show = new DriftShow(() => t);
    show.start();
    const stops: boolean[] = [];
    const policy = new DriftPolicy({
      show,
      reducedMotion: () => false,
      onStopped: (notify) => stops.push(notify),
    });

    policy.stop();

    expect(show.active).toBe(false);
    expect(stops).toEqual([false]);
  });

  it("relays the notify flag when the caller asks for one", () => {
    const t = 0;
    const show = new DriftShow(() => t);
    show.start();
    const stops: boolean[] = [];
    const policy = new DriftPolicy({
      show,
      reducedMotion: () => false,
      onStopped: (notify) => stops.push(notify),
    });

    policy.stop({ notify: true });

    expect(stops).toEqual([true]);
  });

  it("is a no-op while the show is idle: onStopped never fires for a stop that didn't happen", () => {
    const t = 0;
    const show = new DriftShow(() => t);
    const stops: boolean[] = [];
    const policy = new DriftPolicy({
      show,
      reducedMotion: () => false,
      onStopped: (notify) => stops.push(notify),
    });

    policy.stop();

    expect(stops).toEqual([]);
  });
});

describe("DriftPolicy.advance", () => {
  it("launches one leg at a due boundary and leaves the show active for the next departure", () => {
    let t = 0;
    const show = new DriftShow(() => t);
    show.start();
    t = DRIFT_DWELL_MS;
    expect(show.frame()).toBe(true);
    let launchCount = 0;
    const stops: boolean[] = [];
    const policy = new DriftPolicy({
      show,
      reducedMotion: () => false,
      onStopped: (notify) => stops.push(notify),
    });

    policy.advance(() => {
      launchCount += 1;
      return true;
    });

    expect(launchCount).toBe(1);
    expect(show.active).toBe(true);
    expect(stops).toEqual([]);
  });

  it("ends the show silently at a leg boundary when reduced motion is active, without launching a leg", () => {
    let t = 0;
    const show = new DriftShow(() => t);
    show.start();
    t = DRIFT_DWELL_MS;
    expect(show.frame()).toBe(true);
    let launchCount = 0;
    const stops: boolean[] = [];
    const policy = new DriftPolicy({
      show,
      reducedMotion: () => true,
      onStopped: (notify) => stops.push(notify),
    });

    policy.advance(() => {
      launchCount += 1;
      return true;
    });

    expect(launchCount).toBe(0);
    expect(show.active).toBe(false);
    expect(stops).toEqual([false]);
  });
});

describe("DriftPolicy own-leg guard", () => {
  it("does not end the show when the leg re-enters stop() while applying itself", () => {
    let t = 0;
    const show = new DriftShow(() => t);
    show.start();
    t = DRIFT_DWELL_MS;
    expect(show.frame()).toBe(true);
    const stops: boolean[] = [];
    const policy: DriftPolicy = new DriftPolicy({
      show,
      reducedMotion: () => false,
      onStopped: (notify) => stops.push(notify),
    });

    policy.advance(() => {
      // Simulates the leg's replace-load flowing through main.ts's
      // applyEdit chokepoint, which calls policy.stop() on every edit.
      policy.stop({ notify: true });
      return true;
    });

    expect(show.active).toBe(true);
    expect(stops).toEqual([]);
  });

  it("lifts once the leg unwinds, so a subsequent genuine stop works normally", () => {
    let t = 0;
    const show = new DriftShow(() => t);
    show.start();
    t = DRIFT_DWELL_MS;
    expect(show.frame()).toBe(true);
    const stops: boolean[] = [];
    const policy = new DriftPolicy({
      show,
      reducedMotion: () => false,
      onStopped: (notify) => stops.push(notify),
    });
    policy.advance(() => true);

    policy.stop();

    expect(show.active).toBe(false);
    expect(stops).toEqual([false]);
  });

  it("fr-4otp: a collection that runs dry mid-show actually ends the show, not just no-ops forever", () => {
    let t = 0;
    const show = new DriftShow(() => t);
    show.start();
    t = DRIFT_DWELL_MS;
    expect(show.frame()).toBe(true);
    const stops: boolean[] = [];
    const policy = new DriftPolicy({
      show,
      reducedMotion: () => false,
      onStopped: (notify) => stops.push(notify),
    });

    policy.advance(() => false);

    expect(show.active).toBe(false);
    expect(stops).toEqual([false]);

    t += 10 * (DRIFT_MORPH_MS + DRIFT_DWELL_MS);
    expect(show.frame()).toBe(false);
  });
});
