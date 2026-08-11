import {
  BACKGROUND_MODES,
  backgroundGradientsEqual,
  BackgroundTween,
  lerpBackground,
  resolveBackground,
} from "./background";
import type { BackgroundGradient } from "./background";
import { DARK_BACKDROP, HAZE_BACKDROP, hexToRgb01 } from "./constants";

describe("BACKGROUND_MODES", () => {
  it("lists the three modes in UI order", () => {
    expect(BACKGROUND_MODES).toEqual(["dark", "haze", "custom"]);
  });
});

describe("resolveBackground", () => {
  it("resolves dark mode to the DARK_BACKDROP stops", () => {
    expect(resolveBackground({ mode: "dark" })).toEqual({
      top: hexToRgb01(DARK_BACKDROP.top),
      bottom: hexToRgb01(DARK_BACKDROP.bottom),
    });
  });

  it("resolves haze mode to the HAZE_BACKDROP stops", () => {
    expect(resolveBackground({ mode: "haze" })).toEqual({
      top: hexToRgb01(HAZE_BACKDROP.top),
      bottom: hexToRgb01(HAZE_BACKDROP.bottom),
    });
  });

  it("returns the exact custom payload for custom mode", () => {
    const custom: BackgroundGradient = {
      top: [0.1, 0.2, 0.3],
      bottom: [0.4, 0.5, 0.6],
    };
    expect(resolveBackground({ mode: "custom", custom })).toBe(custom);
  });

  it("falls back to the dark stops for custom mode with no payload", () => {
    expect(resolveBackground({ mode: "custom" })).toEqual({
      top: hexToRgb01(DARK_BACKDROP.top),
      bottom: hexToRgb01(DARK_BACKDROP.bottom),
    });
  });
});

describe("backgroundGradientsEqual", () => {
  it("is true for two gradients with identical stops", () => {
    const a: BackgroundGradient = {
      top: [0.1, 0.2, 0.3],
      bottom: [0.4, 0.5, 0.6],
    };
    const b: BackgroundGradient = {
      top: [0.1, 0.2, 0.3],
      bottom: [0.4, 0.5, 0.6],
    };
    expect(backgroundGradientsEqual(a, b)).toBe(true);
  });

  it("is false when a top channel differs", () => {
    const a: BackgroundGradient = {
      top: [0.1, 0.2, 0.3],
      bottom: [0.4, 0.5, 0.6],
    };
    const b: BackgroundGradient = {
      top: [0.1, 0.2, 0.99],
      bottom: [0.4, 0.5, 0.6],
    };
    expect(backgroundGradientsEqual(a, b)).toBe(false);
  });

  it("is false when a bottom channel differs", () => {
    const a: BackgroundGradient = {
      top: [0.1, 0.2, 0.3],
      bottom: [0.4, 0.5, 0.6],
    };
    const b: BackgroundGradient = {
      top: [0.1, 0.2, 0.3],
      bottom: [0.4, 0.99, 0.6],
    };
    expect(backgroundGradientsEqual(a, b)).toBe(false);
  });
});

describe("lerpBackground", () => {
  const a: BackgroundGradient = { top: [0, 0, 0], bottom: [0.2, 0.2, 0.2] };
  const b: BackgroundGradient = { top: [1, 1, 1], bottom: [0.8, 0.8, 0.8] };

  it("returns the start gradient by reference at t=0", () => {
    expect(lerpBackground(a, b, 0)).toBe(a);
  });

  it("returns the end gradient by reference at t=1", () => {
    expect(lerpBackground(a, b, 1)).toBe(b);
  });

  it("clamps a t below 0 to the start gradient", () => {
    expect(lerpBackground(a, b, -5)).toBe(a);
  });

  it("clamps a t above 1 to the end gradient", () => {
    expect(lerpBackground(a, b, 5)).toBe(b);
  });

  it("blends each channel at the midpoint for t=0.5", () => {
    expect(lerpBackground(a, b, 0.5)).toEqual({
      top: [0.5, 0.5, 0.5],
      bottom: [0.5, 0.5, 0.5],
    });
  });
});

describe("BackgroundTween", () => {
  const from: BackgroundGradient = { top: [0, 0, 0], bottom: [0.2, 0.2, 0.2] };
  const to: BackgroundGradient = { top: [1, 1, 1], bottom: [0.8, 0.8, 0.8] };

  it("samples null while never started", () => {
    const tween = new BackgroundTween();
    expect(tween.sample(0)).toBeNull();
    expect(tween.active()).toBe(false);
  });

  it("blends by smoothstep(0.5)=0.5 at the midpoint, still active and not final", () => {
    const tween = new BackgroundTween();
    tween.start(from, to, 1000, 0);

    const sample = tween.sample(500);

    expect(sample).toEqual({
      gradient: { top: [0.5, 0.5, 0.5], bottom: [0.5, 0.5, 0.5] },
      final: false,
    });
    expect(tween.active()).toBe(true);
  });

  it("lands on the exact target reference at the duration, then deactivates", () => {
    const tween = new BackgroundTween();
    tween.start(from, to, 1000, 0);

    const sample = tween.sample(1000);

    expect(sample!.final).toBe(true);
    expect(sample!.gradient).toBe(to);
    expect(tween.active()).toBe(false);
    expect(tween.sample(1000)).toBeNull();
  });

  it("discards the in-flight crossfade on cancel", () => {
    const tween = new BackgroundTween();
    tween.start(from, to, 1000, 0);

    tween.cancel();

    expect(tween.active()).toBe(false);
    expect(tween.sample(500)).toBeNull();
  });

  it("lands final on the first sample for a zero duration", () => {
    const tween = new BackgroundTween();
    tween.start(from, to, 0, 0);

    const sample = tween.sample(0);

    expect(sample).toEqual({ gradient: to, final: true });
    expect(tween.active()).toBe(false);
  });

  it("lands final on the first sample for a negative duration", () => {
    const tween = new BackgroundTween();
    tween.start(from, to, -500, 0);

    const sample = tween.sample(0);

    expect(sample).toEqual({ gradient: to, final: true });
  });

  it("replaces an in-flight crossfade when started again before it finishes", () => {
    const tween = new BackgroundTween();
    const replacement: BackgroundGradient = {
      top: [0.5, 0.25, 0.75],
      bottom: [0.1, 0.9, 0.4],
    };
    tween.start(from, to, 1000, 0);
    tween.sample(200); // partway through the first flight, still active

    tween.start(from, replacement, 1000, 200);
    const sample = tween.sample(1200);

    expect(sample!.final).toBe(true);
    expect(sample!.gradient).toBe(replacement);
  });
});
