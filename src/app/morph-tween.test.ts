import { MorphTween, MORPH_TWEEN_MS } from "./morph-tween";
import type { MorphSystem } from "../fractal/morph";
import type { Transform } from "../fractal/types";

function transform(overrides: Partial<Transform> = {}): Transform {
  return {
    id: 0,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    ...overrides,
  };
}

function system(overrides: Partial<MorphSystem> = {}): MorphSystem {
  return {
    transforms: [transform()],
    finalTransform: null,
    symmetry: { order: 1, axis: "x" },
    ...overrides,
  };
}

describe("MorphTween.sample", () => {
  it("returns null before any start, and active is false", () => {
    const tween = new MorphTween();

    expect(tween.sample(0)).toBeNull();
    expect(tween.active).toBe(false);
  });

  it("at the start instant, the system is `from` by reference (t=0 exactness)", () => {
    const tween = new MorphTween();
    const a = system({ transforms: [transform({ position: [0, 0, 0] })] });
    const b = system({ transforms: [transform({ position: [1, 0, 0] })] });
    tween.start(a, b, 7, 0);

    const result = tween.sample(0);

    // lerpSystem returns `a` BY REFERENCE at t<=0 — pin that MorphTween
    // forwards that exact reference rather than a coincidentally-equal copy.
    expect(result!.system).toBe(a);
    expect(result!.final).toBe(false);
  });

  it("at elapsed === MORPH_TWEEN_MS, the system is `to` by reference, final, and deactivates", () => {
    const tween = new MorphTween();
    const a = system({ transforms: [transform({ position: [0, 0, 0] })] });
    const b = system({ transforms: [transform({ position: [1, 0, 0] })] });
    tween.start(a, b, 7, 0);

    const result = tween.sample(MORPH_TWEEN_MS);

    // The final sample doubles as the real generation request the
    // integration issues, so `to` must be forwarded BY REFERENCE, not a
    // freshly-lerped object that merely equals it.
    expect(result!.system).toBe(b);
    expect(result!.final).toBe(true);
    expect(tween.active).toBe(false);
    expect(tween.sample(MORPH_TWEEN_MS)).toBeNull();
  });

  it("still returns the final to-by-reference sample once when the first poll is past the duration, then null", () => {
    const tween = new MorphTween();
    const a = system({ transforms: [transform({ position: [0, 0, 0] })] });
    const b = system({ transforms: [transform({ position: [1, 0, 0] })] });
    tween.start(a, b, 7, 0);

    const result = tween.sample(3 * MORPH_TWEEN_MS);

    expect(result!.system).toBe(b);
    expect(result!.final).toBe(true);
    expect(tween.sample(3 * MORPH_TWEEN_MS)).toBeNull();
  });

  it("is exactly halfway at elapsed = MORPH_TWEEN_MS / 2 (smoothstep(0.5) = 0.5)", () => {
    const tween = new MorphTween();
    const a = system({ transforms: [transform({ position: [0, 0, 0] })] });
    const b = system({ transforms: [transform({ position: [1, 0, 0] })] });
    tween.start(a, b, 7, 0);

    const result = tween.sample(MORPH_TWEEN_MS / 2);

    expect(result!.system.transforms[0].position[0]).toBe(0.5);
    expect(result!.final).toBe(false);
    expect(tween.active).toBe(true);
  });

  it("eases with smoothstep, not linearly: at elapsed = MORPH_TWEEN_MS / 4, position[0] is 0.15625", () => {
    const tween = new MorphTween();
    const a = system({ transforms: [transform({ position: [0, 0, 0] })] });
    const b = system({ transforms: [transform({ position: [1, 0, 0] })] });
    tween.start(a, b, 7, 0);

    const result = tween.sample(MORPH_TWEEN_MS / 4);

    // Pins the easing curve: smoothstep(0.25) = 0.25^2 * (3 - 2*0.25) =
    // 0.15625, not the linear 0.25 a plain `t` lerp would give.
    expect(result!.system.transforms[0].position[0]).toBeCloseTo(0.15625, 10);
  });

  it("carries the seed passed to start on every sample, including the final one", () => {
    const tween = new MorphTween();
    const a = system({ transforms: [transform({ position: [0, 0, 0] })] });
    const b = system({ transforms: [transform({ position: [1, 0, 0] })] });
    tween.start(a, b, 42, 0);

    expect(tween.sample(MORPH_TWEEN_MS / 2)!.seed).toBe(42);
    expect(tween.sample(MORPH_TWEEN_MS)!.seed).toBe(42);
  });
});

describe("MorphTween.start", () => {
  it("a chained start resumes from the currently sampled system, ignoring the passed `from`", () => {
    const tween = new MorphTween();
    const a = system({ transforms: [transform({ position: [0, 0, 0] })] });
    const b = system({ transforms: [transform({ position: [1, 0, 0] })] });
    const c = system({ transforms: [transform({ position: [5, 0, 0] })] });
    tween.start(a, b, 7, 0);

    const chainNow = MORPH_TWEEN_MS / 2;
    // Passing `a` again as `from` here is deliberate: a chained start must
    // ignore it in favor of the live A->B halfway system, or the displayed
    // cloud would visibly teleport back to A before morphing to C.
    tween.start(a, c, 99, chainNow);

    const result = tween.sample(chainNow);
    expect(result!.system.transforms[0].position[0]).toBe(0.5);
  });

  it("a chained start keeps the in-flight seed, not the newly passed one", () => {
    const tween = new MorphTween();
    const a = system({ transforms: [transform({ position: [0, 0, 0] })] });
    const b = system({ transforms: [transform({ position: [1, 0, 0] })] });
    const c = system({ transforms: [transform({ position: [5, 0, 0] })] });
    tween.start(a, b, 7, 0);

    const chainNow = MORPH_TWEEN_MS / 2;
    tween.start(a, c, 99, chainNow);

    // Seed 7 (the in-flight seed), never 99 (the ignored, newly-passed
    // seed) — switching seeds mid-chain would re-place every point on the
    // screen even though the system barely changed at the chain instant.
    expect(tween.sample(chainNow)!.seed).toBe(7);
    expect(tween.sample(chainNow + MORPH_TWEEN_MS)!.seed).toBe(7);
  });

  it("a chained morph runs its own full duration timed from the chain instant", () => {
    const tween = new MorphTween();
    const a = system({ transforms: [transform({ position: [0, 0, 0] })] });
    const b = system({ transforms: [transform({ position: [1, 0, 0] })] });
    const c = system({ transforms: [transform({ position: [5, 0, 0] })] });
    tween.start(a, b, 7, 0);

    const chainNow = MORPH_TWEEN_MS / 2;
    tween.start(a, c, 99, chainNow);

    const result = tween.sample(chainNow + MORPH_TWEEN_MS);
    expect(result!.system).toBe(c);
    expect(result!.final).toBe(true);
  });

  it("chains from the old target when the previous morph ran past its duration unpolled", () => {
    const tween = new MorphTween();
    const a = system({ transforms: [transform({ position: [0, 0, 0] })] });
    const b = system({ transforms: [transform({ position: [1, 0, 0] })] });
    const c = system({ transforms: [transform({ position: [5, 0, 0] })] });
    tween.start(a, b, 7, 0);

    // The first morph is never polled until long past its own duration.
    const chainNow = 10 * MORPH_TWEEN_MS;
    tween.start(a, c, 99, chainNow);

    // What was actually left on screen at chainNow is `b` (the old
    // morph's target), not `a` — the chain must resume from there, by
    // reference, keeping the old seed.
    const result = tween.sample(chainNow);
    expect(result!.system).toBe(b);
    expect(result!.seed).toBe(7);
  });
});

describe("MorphTween.finish", () => {
  it("mid-flight, snaps to `to` by reference, marks final, and deactivates", () => {
    const tween = new MorphTween();
    const a = system({ transforms: [transform({ position: [0, 0, 0] })] });
    const b = system({ transforms: [transform({ position: [1, 0, 0] })] });
    tween.start(a, b, 7, 0);

    const result = tween.finish();

    // Same reference-exactness contract as sample()'s final sample — finish()
    // is the ONLY cancellation path, so it must be just as exact.
    expect(result!.system).toBe(b);
    expect(result!.final).toBe(true);
    expect(tween.active).toBe(false);
    expect(tween.sample(0)).toBeNull();
  });

  it("returns null when idle", () => {
    const tween = new MorphTween();

    expect(tween.finish()).toBeNull();
  });
});
