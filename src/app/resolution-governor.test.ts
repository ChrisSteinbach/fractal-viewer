import type { ResolutionGovernor } from "./resolution-governor";
import {
  createResolutionGovernor,
  GOVERNOR_DOWN_MS,
  GOVERNOR_DOWN_SUSTAIN_MS,
  GOVERNOR_HOLDOFF_MS,
  GOVERNOR_OUTLIER_MS,
  GOVERNOR_OUTLIER_STREAK,
  GOVERNOR_UP_SUSTAIN_MS,
  RESOLUTION_SCALE_STEPS,
} from "./resolution-governor";

/** Feed the same dt to `governor` `count` times, collecting every result. */
function feed(
  governor: ResolutionGovernor,
  dtMs: number,
  count: number,
): (number | null)[] {
  const results: (number | null)[] = [];
  for (let i = 0; i < count; i++) {
    results.push(governor.sample(dtMs));
  }
  return results;
}

describe("createResolutionGovernor", () => {
  it("stays at full resolution under steady 60fps frames", () => {
    const governor = createResolutionGovernor();
    // Far more fast frames than any sustain needs — even though 16.7ms
    // qualifies as "fast", already being at the top of the ladder means
    // there is no further step to take.
    const results = feed(governor, 16.7, 500);
    expect(results.every((r) => r === null)).toBe(true);
    expect(governor.scale).toBe(RESOLUTION_SCALE_STEPS[0]);
  });

  it("steps down to the second rung once slow frames accumulate the sustain time, returned by the tipping sample", () => {
    const governor = createResolutionGovernor();
    // 50ms frames: the EMA seeds at 50 (already over GOVERNOR_DOWN_MS), so
    // every sample accrues its own dt — the step tips exactly when the
    // accrued frame time reaches the sustain.
    const samplesToStep = Math.ceil(GOVERNOR_DOWN_SUSTAIN_MS / 50);
    const results = feed(governor, 50, samplesToStep);
    expect(results.slice(0, -1).every((r) => r === null)).toBe(true);
    expect(results[results.length - 1]).toBe(RESOLUTION_SCALE_STEPS[1]);
    expect(governor.scale).toBe(RESOLUTION_SCALE_STEPS[1]);
  });

  it("walks all the way down to the resolution floor under continued slowness, and never below it", () => {
    const governor = createResolutionGovernor();
    // Each extra step costs a hold-off plus a fresh sustain; feed far more
    // 50ms frames than the whole ladder needs.
    feed(governor, 50, 500);
    expect(governor.scale).toBe(
      RESOLUTION_SCALE_STEPS[RESOLUTION_SCALE_STEPS.length - 1],
    );
  });

  it("never steps when a slow burst falls just short of the sustain time, once fast frames reset the accrual", () => {
    const governor = createResolutionGovernor();
    // 35ms frames sit just over the down threshold, so each accrues; stop
    // one frame short of the sustain.
    const shortOfStep = Math.ceil(GOVERNOR_DOWN_SUSTAIN_MS / 35) - 1;
    const burst = feed(governor, 35, shortOfStep);
    expect(burst.every((r) => r === null)).toBe(true);

    // A single fast sample blended into that pegged EMA (35 -> 35 + 0.1 *
    // (5 - 35) = 32) already drops back under GOVERNOR_DOWN_MS, so the down
    // accrual resets before ever tipping.
    const recovery = feed(governor, 5, 400);
    expect(recovery.every((r) => r === null)).toBe(true);
    expect(governor.scale).toBe(RESOLUTION_SCALE_STEPS[0]);
  });

  it("ignores huge outliers mixed into fast frames without poisoning the EMA into a step", () => {
    const governor = createResolutionGovernor();
    const results: (number | null)[] = [];
    for (let i = 0; i < 1000; i++) {
      // Every third sample is a stall far past the outlier cutoff; the fast
      // frames between them keep resetting the outlier streak, so none of
      // the stalls ever counts.
      const dt = i % 3 === 0 ? GOVERNOR_OUTLIER_MS + 150 : 15;
      results.push(governor.sample(dt));
    }
    expect(results.every((r) => r === null)).toBe(true);
    expect(governor.scale).toBe(RESOLUTION_SCALE_STEPS[0]);
  });

  it("requires more sustained fast time to recover than slow time it took to step down", () => {
    const governor = createResolutionGovernor();

    let downCount = 0;
    let downResult: number | null = null;
    while (downResult === null) {
      downCount++;
      downResult = governor.sample(50);
    }
    expect(downCount).toBe(Math.ceil(GOVERNOR_DOWN_SUSTAIN_MS / 50));
    expect(downResult).toBe(RESOLUTION_SCALE_STEPS[1]);

    let upCount = 0;
    let upResult: number | null = null;
    while (upResult === null) {
      upCount++;
      upResult = governor.sample(10);
    }
    // The hold-off elapses first (in frame time), then the up sustain must
    // accrue in full.
    expect(upCount).toBe(
      Math.ceil(GOVERNOR_HOLDOFF_MS / 10) +
        Math.ceil(GOVERNOR_UP_SUSTAIN_MS / 10),
    );
    expect(upResult).toBe(RESOLUTION_SCALE_STEPS[0]);
  });

  it("holds off a second step until the hold-off time passes, then allows one once slowness continues", () => {
    const governor = createResolutionGovernor();
    const toStep = Math.ceil(GOVERNOR_DOWN_SUSTAIN_MS / 50);
    const first = feed(governor, 50, toStep);
    expect(first[first.length - 1]).toBe(RESOLUTION_SCALE_STEPS[1]);

    // Every sample inside the hold-off window is frozen out.
    const heldOff = feed(governor, 50, Math.ceil(GOVERNOR_HOLDOFF_MS / 50));
    expect(heldOff.every((r) => r === null)).toBe(true);
    expect(governor.scale).toBe(RESOLUTION_SCALE_STEPS[1]);

    const second = feed(governor, 50, toStep);
    expect(second.some((r) => r !== null)).toBe(true);
    expect(governor.scale).toBe(RESOLUTION_SCALE_STEPS[2]);
  });

  it("never steps when the EMA is parked in the dead band, even from a stepped-down state", () => {
    const governor = createResolutionGovernor();
    feed(governor, 50, Math.ceil(GOVERNOR_DOWN_SUSTAIN_MS / 50)); // down one rung
    expect(governor.scale).toBe(RESOLUTION_SCALE_STEPS[1]);

    // 27ms frames park the EMA between the two thresholds. The glide from
    // 50 down to 27 spends a few samples still over the down threshold, but
    // that brief accrual is nowhere near the sustain before the dead band
    // resets it.
    const deadBand = feed(governor, 27, 1000);
    expect(deadBand.every((r) => r === null)).toBe(true);
    expect(governor.scale).toBe(RESOLUTION_SCALE_STEPS[1]);
  });

  it("steps down even when every frame is outlier-sized — a catastrophically slow device is sustained load, not a stall", () => {
    const governor = createResolutionGovernor();
    // The first GOVERNOR_OUTLIER_STREAK - 1 are dismissed as stalls; from
    // the streak's completion on, each counts as GOVERNOR_OUTLIER_MS of
    // accrued slowness (clamped), so relief arrives within a handful of
    // frames rather than minutes of sample-counting.
    const fedNeeded = Math.ceil(GOVERNOR_DOWN_SUSTAIN_MS / GOVERNOR_OUTLIER_MS);
    const results = feed(
      governor,
      GOVERNOR_OUTLIER_MS + 400,
      GOVERNOR_OUTLIER_STREAK - 1 + fedNeeded,
    );
    expect(results.some((r) => r !== null)).toBe(true);
    expect(governor.scale).toBeLessThan(RESOLUTION_SCALE_STEPS[0]);
  });

  it("keeps dismissing outlier bursts shorter than the streak, even repeated ones", () => {
    const governor = createResolutionGovernor();
    // Many rounds of almost-a-streak stalls, each broken by fast frames: the
    // fast frame resets the streak, so none of the stalls ever count and the
    // fast frames keep the EMA honest.
    for (let round = 0; round < 40; round++) {
      const stalls = feed(
        governor,
        GOVERNOR_OUTLIER_MS + 400,
        GOVERNOR_OUTLIER_STREAK - 1,
      );
      expect(stalls.every((r) => r === null)).toBe(true);
      feed(governor, 10, 3);
    }
    expect(governor.scale).toBe(RESOLUTION_SCALE_STEPS[0]);
  });

  it("ignores non-finite and non-positive dt values", () => {
    const governor = createResolutionGovernor();
    const results = [
      governor.sample(Number.NaN),
      governor.sample(Number.POSITIVE_INFINITY),
      governor.sample(0),
      governor.sample(-5),
    ];
    expect(results.every((r) => r === null)).toBe(true);
    expect(governor.scale).toBe(RESOLUTION_SCALE_STEPS[0]);
  });

  it("reset() clears momentum so two short slow streaks never add up to a step", () => {
    const governor = createResolutionGovernor();
    const shortOfStep = Math.ceil(GOVERNOR_DOWN_SUSTAIN_MS / 50) - 1;
    const first = feed(governor, 50, shortOfStep);
    expect(first.every((r) => r === null)).toBe(true);

    governor.reset();
    expect(governor.scale).toBe(RESOLUTION_SCALE_STEPS[0]);

    // The EMA reseeds on reset, so this streak accrues from scratch rather
    // than continuing the prior near-miss — kept just short of the sustain
    // so it still doesn't tip on its own.
    const second = feed(governor, 50, shortOfStep);
    expect(second.every((r) => r === null)).toBe(true);
    expect(governor.scale).toBe(RESOLUTION_SCALE_STEPS[0]);
  });

  it("sanity: the down threshold leaves a deliberately 30fps-capped device alone", () => {
    const governor = createResolutionGovernor();
    // ~33.3ms frames (a 30Hz cap, or iOS low-power mode) sit just under
    // GOVERNOR_DOWN_MS: not fast enough to recover anything, but never
    // punished either.
    expect(1000 / 30).toBeLessThan(GOVERNOR_DOWN_MS);
    const results = feed(governor, 1000 / 30, 1000);
    expect(results.every((r) => r === null)).toBe(true);
    expect(governor.scale).toBe(RESOLUTION_SCALE_STEPS[0]);
  });
});
