import type { ResolutionGovernor } from "./resolution-governor";
import {
  createResolutionGovernor,
  GOVERNOR_DOWN_MS,
  GOVERNOR_DOWN_SUSTAIN,
  GOVERNOR_HOLDOFF,
  GOVERNOR_OUTLIER_MS,
  GOVERNOR_UP_MS,
  GOVERNOR_UP_SUSTAIN,
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
    // Comfortably more samples than GOVERNOR_UP_SUSTAIN needs — even though
    // 16.7ms qualifies as "fast", already being at the top of the ladder
    // means there is no further step to take.
    const results = feed(governor, 16.7, GOVERNOR_UP_SUSTAIN + 50);
    expect(results.every((r) => r === null)).toBe(true);
    expect(governor.scale).toBe(RESOLUTION_SCALE_STEPS[0]);
  });

  it("steps down to the second rung after a sustained slow streak, returned by the tipping sample", () => {
    const governor = createResolutionGovernor();
    const results = feed(governor, 50, GOVERNOR_DOWN_SUSTAIN);
    expect(results.slice(0, -1).every((r) => r === null)).toBe(true);
    expect(results[results.length - 1]).toBe(RESOLUTION_SCALE_STEPS[1]);
    expect(governor.scale).toBe(RESOLUTION_SCALE_STEPS[1]);
  });

  it("walks all the way down to the resolution floor under continued slowness, and never below it", () => {
    const governor = createResolutionGovernor();
    // One down-step costs GOVERNOR_DOWN_SUSTAIN qualifying samples plus a
    // GOVERNOR_HOLDOFF settle; feed far more than the ladder needs.
    const stepsAvailable = RESOLUTION_SCALE_STEPS.length - 1;
    const samplesNeeded =
      (GOVERNOR_DOWN_SUSTAIN + GOVERNOR_HOLDOFF) * stepsAvailable;
    feed(governor, 50, samplesNeeded + 500);
    expect(governor.scale).toBe(
      RESOLUTION_SCALE_STEPS[RESOLUTION_SCALE_STEPS.length - 1],
    );
  });

  it("never steps when a slow burst falls one sample short of sustain, even once fast frames zero the counter", () => {
    const governor = createResolutionGovernor();
    // A burst just above the down threshold pegs the EMA at that value; one
    // short of GOVERNOR_DOWN_SUSTAIN leaves the down counter at its highest
    // non-tipping value.
    const burst = feed(
      governor,
      GOVERNOR_DOWN_MS + 1,
      GOVERNOR_DOWN_SUSTAIN - 1,
    );
    expect(burst.every((r) => r === null)).toBe(true);

    // A single fast sample blended into that pegged EMA (35 -> 35 + 0.1 *
    // (5 - 35) = 32) already drops back under GOVERNOR_DOWN_MS, so the down
    // counter resets to 0 on this very sample instead of tipping to 45.
    const recovery = feed(governor, 5, 200);
    expect(recovery.every((r) => r === null)).toBe(true);
    expect(governor.scale).toBe(RESOLUTION_SCALE_STEPS[0]);
  });

  it("ignores huge outliers mixed into fast frames without poisoning the EMA into a step", () => {
    const governor = createResolutionGovernor();
    const results: (number | null)[] = [];
    for (let i = 0; i < 1000; i++) {
      // Every third sample is a stall far past the outlier cutoff; if it
      // were folded into the EMA instead of ignored, it would eventually
      // drag the average over GOVERNOR_DOWN_MS and force a step down.
      const dt = i % 3 === 0 ? GOVERNOR_OUTLIER_MS + 150 : GOVERNOR_UP_MS - 5;
      results.push(governor.sample(dt));
    }
    expect(results.every((r) => r === null)).toBe(true);
    expect(governor.scale).toBe(RESOLUTION_SCALE_STEPS[0]);
  });

  it("requires far more sustained fast samples to recover than it took to step down", () => {
    const governor = createResolutionGovernor();

    let downCount = 0;
    let downResult: number | null = null;
    while (downResult === null) {
      downCount++;
      downResult = governor.sample(50);
    }
    expect(downCount).toBe(GOVERNOR_DOWN_SUSTAIN);
    expect(downResult).toBe(RESOLUTION_SCALE_STEPS[1]);

    let upCount = 0;
    let upResult: number | null = null;
    while (upResult === null) {
      upCount++;
      upResult = governor.sample(10);
    }
    // GOVERNOR_HOLDOFF samples to clear the post-step freeze, then
    // GOVERNOR_UP_SUSTAIN qualifying samples to earn the recovery.
    expect(upCount).toBe(GOVERNOR_HOLDOFF + GOVERNOR_UP_SUSTAIN);
    expect(upResult).toBe(RESOLUTION_SCALE_STEPS[0]);

    expect(upCount).toBeGreaterThan(downCount);
  });

  it("holds off a second step until GOVERNOR_HOLDOFF samples pass, then allows one once slowness continues", () => {
    const governor = createResolutionGovernor();
    const first = feed(governor, 50, GOVERNOR_DOWN_SUSTAIN);
    expect(first[first.length - 1]).toBe(RESOLUTION_SCALE_STEPS[1]);

    const heldOff = feed(governor, 50, GOVERNOR_HOLDOFF);
    expect(heldOff.every((r) => r === null)).toBe(true);
    expect(governor.scale).toBe(RESOLUTION_SCALE_STEPS[1]);

    const second = feed(governor, 50, GOVERNOR_DOWN_SUSTAIN);
    expect(second.some((r) => r !== null)).toBe(true);
    expect(governor.scale).toBe(RESOLUTION_SCALE_STEPS[2]);
  });

  it("never steps when the EMA is parked in the dead band, even from a stepped-down state", () => {
    const governor = createResolutionGovernor();
    feed(governor, 50, GOVERNOR_DOWN_SUSTAIN); // step down to the second rung
    expect(governor.scale).toBe(RESOLUTION_SCALE_STEPS[1]);

    // Midpoint of the dead band: neither the down nor the up threshold.
    const deadBandMs = (GOVERNOR_DOWN_MS + GOVERNOR_UP_MS) / 2;
    const deadBand = feed(
      governor,
      deadBandMs,
      GOVERNOR_UP_SUSTAIN + GOVERNOR_HOLDOFF + 50,
    );
    expect(deadBand.every((r) => r === null)).toBe(true);
    expect(governor.scale).toBe(RESOLUTION_SCALE_STEPS[1]);
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
    const first = feed(governor, 50, GOVERNOR_DOWN_SUSTAIN - 1);
    expect(first.every((r) => r === null)).toBe(true);

    governor.reset();
    expect(governor.scale).toBe(RESOLUTION_SCALE_STEPS[0]);

    // The EMA reseeds on reset, so this streak's samples each count toward
    // the counter from scratch rather than carrying over the prior streak's
    // near-miss — kept one shorter than GOVERNOR_DOWN_SUSTAIN so it still
    // doesn't tip on its own.
    const second = feed(governor, 50, GOVERNOR_DOWN_SUSTAIN - 1);
    expect(second.every((r) => r === null)).toBe(true);
    expect(governor.scale).toBe(RESOLUTION_SCALE_STEPS[0]);
  });
});
