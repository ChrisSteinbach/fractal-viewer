import {
  createRenderTierScheduler,
  previewMaxDepth,
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
