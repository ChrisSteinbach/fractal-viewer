import {
  AUTO_BACKGROUND_TUNING,
  autoBackground,
  BACKGROUND_MODES,
  backgroundGradientsEqual,
  BackgroundTween,
  lerpBackground,
  luma709,
  resolveBackground,
} from "./background";
import type { BackgroundGradient } from "./background";
import { DARK_BACKDROP, HAZE_BACKDROP, hexToRgb01 } from "./constants";
import { FLAME_PALETTE_IDS } from "../fractal/palette";

describe("BACKGROUND_MODES", () => {
  it("lists the four modes in UI order", () => {
    expect(BACKGROUND_MODES).toEqual(["dark", "haze", "auto", "custom"]);
  });
});

describe("autoBackground", () => {
  it("returns the dark gradient for the legacy (non-gradient) palette", () => {
    expect(autoBackground("legacy")).toEqual(
      resolveBackground({ mode: "dark" }),
    );
  });

  it("keeps every built-in gradient palette's stops within the tuned luminance bands", () => {
    for (const id of FLAME_PALETTE_IDS.filter((id) => id !== "legacy")) {
      const { top, bottom } = autoBackground(id);
      const topLuma = luma709(top);
      const bottomLuma = luma709(bottom);
      expect(topLuma).toBeGreaterThanOrEqual(
        AUTO_BACKGROUND_TUNING.top.min - 1e-6,
      );
      expect(topLuma).toBeLessThanOrEqual(
        AUTO_BACKGROUND_TUNING.top.max + 1e-6,
      );
      expect(bottomLuma).toBeGreaterThanOrEqual(
        AUTO_BACKGROUND_TUNING.bottom.min - 1e-6,
      );
      expect(bottomLuma).toBeLessThanOrEqual(
        AUTO_BACKGROUND_TUNING.bottom.max + 1e-6,
      );
      expect(topLuma).toBeLessThan(bottomLuma);
      for (const channel of [...top, ...bottom]) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(1);
      }
    }
  });

  // sunset's LUT stop 0 is a warm orange (see FLAME_PALETTES), so its derived
  // top stop should stay red-over-blue even after the darken/desaturate curve.
  it("keeps a warm palette's hue after darkening: sunset's top is redder than it is blue", () => {
    const { top } = autoBackground("sunset");
    expect(top[0]).toBeGreaterThan(top[2]);
  });

  it("derives from a custom palette's own stops: a blue first stop yields a blue-dominant top", () => {
    const { top } = autoBackground({
      stops: [
        [0, 0, 1],
        [0, 1, 0],
      ],
    });
    expect(top[2]).toBeGreaterThan(top[0]);
  });

  it("lands an all-black custom palette exactly on neutral gray at each band's floor", () => {
    const gradient = autoBackground({
      stops: [
        [0, 0, 0],
        [0, 0, 0],
      ],
    });
    const { min: topMin } = AUTO_BACKGROUND_TUNING.top;
    const { min: bottomMin } = AUTO_BACKGROUND_TUNING.bottom;
    expect(gradient.top).toEqual([topMin, topMin, topMin]);
    expect(gradient.bottom).toEqual([bottomMin, bottomMin, bottomMin]);
  });

  it("clamps an all-white custom palette to neutral gray at each band's ceiling", () => {
    const gradient = autoBackground({
      stops: [
        [1, 1, 1],
        [1, 1, 1],
      ],
    });
    const { max: topMax } = AUTO_BACKGROUND_TUNING.top;
    const { max: bottomMax } = AUTO_BACKGROUND_TUNING.bottom;
    for (const channel of gradient.top) expect(channel).toBeCloseTo(topMax, 10);
    for (const channel of gradient.bottom) {
      expect(channel).toBeCloseTo(bottomMax, 10);
    }
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

  it("resolves auto mode to the palette-derived gradient when given a palette", () => {
    expect(resolveBackground({ mode: "auto" }, "sunset")).toEqual(
      autoBackground("sunset"),
    );
  });

  it("falls back to the dark stops for auto mode with no palette argument", () => {
    expect(resolveBackground({ mode: "auto" })).toEqual({
      top: hexToRgb01(DARK_BACKDROP.top),
      bottom: hexToRgb01(DARK_BACKDROP.bottom),
    });
  });

  it("derives from the palette rather than the authored slot for auto mode with a custom payload present", () => {
    const custom: BackgroundGradient = {
      top: [0.1, 0.2, 0.3],
      bottom: [0.4, 0.5, 0.6],
    };
    expect(resolveBackground({ mode: "auto", custom }, "sunset")).toEqual(
      autoBackground("sunset"),
    );
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
