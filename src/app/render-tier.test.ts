import {
  createPreviewGovernor,
  createRenderTierScheduler,
  previewMaxDepth,
  PREVIEW_SCALE_RUNGS,
  PREVIEW_START_SCALE,
  TIER_SETTLE_MS,
} from "./render-tier";

describe("previewMaxDepth", () => {
  it("halves a deep full-quality depth, rounding the odd remainder up", () => {
    expect(previewMaxDepth(127)).toBe(64);
  });

  it("rounds a small odd depth up before halving", () => {
    expect(previewMaxDepth(9)).toBe(5);
  });

  it("halves an even depth exactly", () => {
    expect(previewMaxDepth(14)).toBe(7);
  });

  it("lands exactly on the 4-level floor when halving an 8-level depth", () => {
    expect(previewMaxDepth(8)).toBe(4);
  });

  it("floors a 6-level depth up to the 4-level minimum", () => {
    expect(previewMaxDepth(6)).toBe(4);
  });

  it("floors the shallowest full-quality depth up to the 4-level minimum", () => {
    expect(previewMaxDepth(4)).toBe(4);
  });

  it("reproduces the fr-ttg5 half-depth anchor exactly at the 0.3 rung", () => {
    // The scale-aware form must agree with the fixed one it generalizes,
    // rung for rung, or the shipped mid-ladder behavior has changed.
    expect(previewMaxDepth(20, PREVIEW_START_SCALE)).toBe(10);
    expect(previewMaxDepth(127, PREVIEW_START_SCALE)).toBe(64);
    expect(previewMaxDepth(9, PREVIEW_START_SCALE)).toBe(5);
  });

  it("traces the system's whole depth at the full-scale rung", () => {
    // At scale 1 the preview resolves the same pixels the settle frame
    // does, so a shallower descent would pop when the settle frame lands.
    expect(previewMaxDepth(20, 1)).toBe(20);
    expect(previewMaxDepth(127, 1)).toBe(127);
  });

  it("traces deeper at a finer rung than at a coarser one", () => {
    expect(previewMaxDepth(20, 0.55)).toBeGreaterThan(
      previewMaxDepth(20, PREVIEW_START_SCALE),
    );
    expect(previewMaxDepth(20, 0.15)).toBeLessThan(
      previewMaxDepth(20, PREVIEW_START_SCALE),
    );
  });

  it("never trades depth back as the ladder climbs, rung by rung", () => {
    // PREVIEW_SCALE_RUNGS is ordered finest first, so depth must fall
    // monotonically along it — a rung that resolved smaller pixels while
    // descending fewer levels would put an unresolved core blob on screen.
    const depths = PREVIEW_SCALE_RUNGS.map((scale) =>
      previewMaxDepth(20, scale),
    );
    expect(depths).toEqual([20, 18, 16, 13, 10, 10, 9, 8, 7]);
  });

  it("keeps the 4-level floor even at the coarsest rung", () => {
    expect(previewMaxDepth(6, 0.07)).toBe(4);
  });
});

describe("createPreviewGovernor", () => {
  it("starts on the shipped fixed preview scale", () => {
    // Mid-ladder by design: an unmeasured device gets exactly fr-5ne3's
    // behavior, and measurement only moves it from there.
    expect(createPreviewGovernor().scale).toBe(0.3);
  });

  it("ignores the very first trace, which carries shader compile cost", () => {
    const governor = createPreviewGovernor();
    // Catastrophic on paper, but a session's first trace also links the
    // program and allocates the target — panicking here would drop a
    // perfectly capable GPU to the floor on every entry to surface mode.
    expect(governor.sample(400)).toBeNull();
    expect(governor.scale).toBe(0.3);
  });

  it("does not step on a single slow trace after warm-up", () => {
    const governor = createPreviewGovernor();
    governor.sample(50);
    expect(governor.sample(200)).toBeNull();
    expect(governor.scale).toBe(0.3);
  });

  it("steps down a rung once slow traces sustain the down window", () => {
    const governor = createPreviewGovernor();
    governor.sample(60);
    // 600ms of down-sustain at 60ms a trace = 10 qualifying samples; 12
    // is past that and still inside the hold-off that follows the step,
    // so exactly one rung is given up.
    for (let i = 0; i < 12; i++) governor.sample(60);
    expect(governor.scale).toBe(0.22);
  });

  it("reports the new scale from the sample that tips a step down", () => {
    const governor = createPreviewGovernor();
    governor.sample(60);
    const steps = Array.from({ length: 12 }, () => governor.sample(60)).filter(
      (s) => s !== null,
    );
    expect(steps).toEqual([0.22]);
  });

  it("keeps stepping down while the device stays too slow to hold a rung", () => {
    const governor = createPreviewGovernor();
    governor.sample(60);
    for (let i = 0; i < 60; i++) governor.sample(60);
    expect(governor.scale).toBeLessThan(0.22);
  });

  it("steps up a rung once fast traces sustain the longer up window", () => {
    const governor = createPreviewGovernor();
    governor.sample(5);
    for (let i = 0; i < 200; i++) governor.sample(5);
    expect(governor.scale).toBe(0.4);
  });

  it("climbs to full scale when the device keeps tracing comfortably", () => {
    const governor = createPreviewGovernor();
    governor.sample(3);
    for (let i = 0; i < 2000; i++) governor.sample(3);
    expect(governor.scale).toBe(1);
  });

  it("makes a fast device wait far longer to climb than a slow one waits to drop", () => {
    const slow = createPreviewGovernor();
    slow.sample(40);
    let slowSamples = 0;
    while (slow.scale === 0.3) {
      slow.sample(40);
      slowSamples++;
    }

    const fast = createPreviewGovernor();
    fast.sample(5);
    let fastSamples = 0;
    while (fast.scale === 0.3) {
      fast.sample(5);
      fastSamples++;
    }

    expect(fastSamples).toBeGreaterThan(slowSamples * 4);
  });

  it("never moves while trace cost sits in the dead band between the thresholds", () => {
    const governor = createPreviewGovernor();
    // 20ms is comfortably under the 33ms budget but nowhere near the
    // margin a step up needs — the band that stops the ladder flapping
    // between two rungs when cost hovers near a single threshold.
    governor.sample(20);
    for (let i = 0; i < 1000; i++) {
      expect(governor.sample(20)).toBeNull();
    }
    expect(governor.scale).toBe(0.3);
  });

  it("does not step up for a device that only just beats the frame budget", () => {
    const governor = createPreviewGovernor();
    governor.sample(32);
    for (let i = 0; i < 1000; i++) governor.sample(32);
    expect(governor.scale).toBe(0.3);
  });

  it("drops straight to the floor rung on one catastrophic trace", () => {
    const governor = createPreviewGovernor();
    governor.sample(10);
    expect(governor.sample(300)).toBe(0.07);
    expect(governor.scale).toBe(0.07);
  });

  it("panics from the top of the ladder without walking down it", () => {
    const governor = createPreviewGovernor();
    governor.sample(3);
    for (let i = 0; i < 2000; i++) governor.sample(3);
    expect(governor.scale).toBe(1);

    // A close-up that suddenly costs a quarter second is the last warning
    // before the GPU watchdog, not a data point to average.
    expect(governor.sample(300)).toBe(0.07);
  });

  it("panics even while the hold-off from a previous step is still running", () => {
    const governor = createPreviewGovernor();
    governor.sample(60);
    for (let i = 0; i < 12; i++) governor.sample(60);
    expect(governor.scale).toBe(0.22);
    expect(governor.sample(400)).toBe(0.07);
  });

  it("ignores a nonsensical measurement entirely", () => {
    const governor = createPreviewGovernor();
    governor.sample(20);
    expect(governor.sample(Number.NaN)).toBeNull();
    expect(governor.sample(-5)).toBeNull();
    expect(governor.scale).toBe(0.3);
  });

  it("reset() returns to the starting rung and forgets the measurements", () => {
    const governor = createPreviewGovernor();
    governor.sample(10);
    governor.sample(300);
    expect(governor.scale).toBe(0.07);

    governor.reset();
    expect(governor.scale).toBe(PREVIEW_START_SCALE);
    // Warm-up applies again: the first trace on the new system cannot step.
    expect(governor.sample(400)).toBeNull();
    expect(governor.scale).toBe(PREVIEW_START_SCALE);
  });

  it("reset(costWeight) enters at the rung whose area discount covers the weight", () => {
    const governor = createPreviewGovernor();
    // 0.22's area discount vs 0.3 is (0.22/0.3)^2 ~ 0.54 — enough for a
    // system 1.8x the anchor cost, not for 2x.
    governor.reset(1.8);
    expect(governor.scale).toBe(0.22);
    governor.reset(2);
    expect(governor.scale).toBe(0.15);
  });

  it("reset(costWeight) saturates at the floor for fold-frontier weights", () => {
    const governor = createPreviewGovernor();
    // A mandelbox pair's static weight is ~243x (81 branches x 12/4 wide
    // frontier) — far past what any scale rung can buy back. The ladder
    // starts at the floor; depth clamp, march budget and strip pacing
    // carry the rest.
    governor.reset(243);
    expect(governor.scale).toBe(0.07);
  });

  it("reset(1) and reset() keep the shipped anchor entry bit for bit", () => {
    const governor = createPreviewGovernor();
    governor.reset(1);
    expect(governor.scale).toBe(PREVIEW_START_SCALE);
    governor.reset();
    expect(governor.scale).toBe(PREVIEW_START_SCALE);
  });

  it("a weighted entry can still climb once traces measure fast", () => {
    const governor = createPreviewGovernor();
    governor.reset(243);
    expect(governor.scale).toBe(0.07);
    governor.sample(5);
    // 2500ms of up-sustain at 16ms minimum accrual per fast trace.
    for (let i = 0; i < 200 && governor.scale === 0.07; i++) {
      governor.sample(5);
    }
    expect(governor.scale).toBe(0.1);
  });
});

describe("createRenderTierScheduler", () => {
  it("returns preview for an invalidated frame", () => {
    const tier = createRenderTierScheduler();
    expect(tier.frame(1000, true)).toBe("preview");
  });

  it("keeps returning preview across consecutive invalidated frames", () => {
    const tier = createRenderTierScheduler();
    expect(tier.frame(1000, true)).toBe("preview");
    expect(tier.frame(1016, true)).toBe("preview");
    expect(tier.frame(1032, true)).toBe("preview");
  });

  it("returns null for a quiet frame before the settle delay elapses", () => {
    const tier = createRenderTierScheduler();
    tier.frame(1000, true);
    expect(tier.frame(1000 + TIER_SETTLE_MS - 1, false)).toBeNull();
  });

  it("fires exactly one full once quiet for the full settle delay, then null on later quiet frames", () => {
    const tier = createRenderTierScheduler();
    tier.frame(1000, true);
    expect(tier.frame(1000 + TIER_SETTLE_MS, false)).toBe("full");
    expect(tier.frame(1000 + 2 * TIER_SETTLE_MS, false)).toBeNull();
  });

  it("fires full for a quiet frame landing exactly on the settle deadline", () => {
    const tier = createRenderTierScheduler();
    tier.frame(1000, true);
    // >= comparison: the deadline itself must already tip, not just the
    // moment after it.
    expect(tier.frame(1000 + TIER_SETTLE_MS, false)).toBe("full");
  });

  it("restarts the settle timer from the latest invalidation seen during the pending window", () => {
    const tier = createRenderTierScheduler();
    tier.frame(1000, true);
    expect(tier.frame(1100, false)).toBeNull();
    expect(tier.frame(1150, true)).toBe("preview");
    expect(tier.frame(1150 + TIER_SETTLE_MS - 1, false)).toBeNull();
    expect(tier.frame(1150 + TIER_SETTLE_MS, false)).toBe("full");
  });

  it("starts a fresh preview-then-full cycle after a settle has already fired", () => {
    const tier = createRenderTierScheduler();
    tier.frame(1000, true);
    expect(tier.frame(1000 + TIER_SETTLE_MS, false)).toBe("full");

    expect(tier.frame(2000, true)).toBe("preview");
    expect(tier.frame(2000 + TIER_SETTLE_MS, false)).toBe("full");
  });

  it("returns null on quiet frames when no invalidation has ever been seen", () => {
    const tier = createRenderTierScheduler();
    expect(tier.frame(1000, false)).toBeNull();
    // Even past where a settle deadline would have landed, there is no
    // invalidation timestamp to measure it from.
    expect(tier.frame(1000 + TIER_SETTLE_MS, false)).toBeNull();
  });

  it("reset() cancels a pending settle", () => {
    const tier = createRenderTierScheduler();
    tier.frame(1000, true);
    tier.reset();
    expect(tier.frame(1000 + TIER_SETTLE_MS, false)).toBeNull();
  });
});
