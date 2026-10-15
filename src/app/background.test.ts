import {
  AUTO_BACKGROUND_TUNING,
  autoBackground,
  AUTO_FLOOR_TUNING,
  autoFloorAlbedo,
  BACKGROUND_MODES,
  backgroundGradientsEqual,
  BackgroundTween,
  lerpBackground,
  luma709,
  resolveBackground,
  stopFloorAlbedo,
} from "./background";
import type { BackgroundGradient } from "./background";
import { DARK_BACKDROP, HAZE_BACKDROP, hexToRgb01 } from "./constants";
import { FLAME_PALETTE_IDS } from "../fractal/palette";
import { PRESENTATION_FLOOR_ALBEDO } from "../fractal/presentation-floor";

describe("BACKGROUND_MODES", () => {
  it("lists the five modes in UI order", () => {
    expect(BACKGROUND_MODES).toEqual([
      "dark",
      "haze",
      "auto",
      "flame",
      "custom",
    ]);
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

describe("stopFloorAlbedo", () => {
  const NEUTRAL = [...PRESENTATION_FLOOR_ALBEDO] as [number, number, number];

  it("is the neutral floor for a pure-grey stop (no chroma to lay over)", () => {
    expect(stopFloorAlbedo([0.3, 0.3, 0.3])).toEqual(NEUTRAL);
  });

  it("is the neutral floor for a below-blackFloor stop (no usable hue)", () => {
    expect(stopFloorAlbedo([0.01, 0.01, 0.01])).toEqual(NEUTRAL);
  });

  it("preserves the floor's own luma and follows the stop's hue direction", () => {
    const albedo = stopFloorAlbedo([0.12, 0.13, 0.22]);
    expect(luma709(albedo)).toBeCloseTo(luma709(NEUTRAL), 10);
    expect(albedo[2]).toBeGreaterThan(albedo[0]);
  });

  it("autoFloorAlbedo reads through the same curve", () => {
    // A palette whose LUT at the tie's sample position is pure blue: the
    // palette-sampling half and the stop-sampling half agree exactly.
    const lutBlue = {
      stops: [
        [0, 0, 1],
        [0, 0, 1],
      ],
    } as const;
    expect(autoFloorAlbedo(lutBlue)).toEqual(stopFloorAlbedo([0, 0, 1]));
  });
});

describe("autoFloorAlbedo", () => {
  const NEUTRAL = [...PRESENTATION_FLOOR_ALBEDO] as [number, number, number];

  it("keeps the neutral floor albedo for the legacy (non-gradient) palette", () => {
    expect(autoFloorAlbedo("legacy")).toEqual(NEUTRAL);
  });

  it("keeps the neutral albedo for an all-white custom palette (no chroma to lay over)", () => {
    expect(
      autoFloorAlbedo({
        stops: [
          [1, 1, 1],
          [1, 1, 1],
        ],
      }),
    ).toEqual(NEUTRAL);
  });

  it("keeps the neutral albedo for an all-black custom palette (no usable hue)", () => {
    expect(
      autoFloorAlbedo({
        stops: [
          [0, 0, 0],
          [0, 0, 0],
        ],
      }),
    ).toEqual(NEUTRAL);
  });

  // The chroma-offset form's point: the floor keeps its own luma even on a
  // monochromatic sample a scale-to-target-luma curve would clamp badly.
  it("preserves the floor's own luma and follows the hue on a deep-blue sample", () => {
    const albedo = autoFloorAlbedo({
      stops: [
        [0, 0, 0.5],
        [0, 0, 0.5],
      ],
    });
    expect(luma709(albedo)).toBeCloseTo(luma709(NEUTRAL), 10);
    expect(albedo[2]).toBeGreaterThan(albedo[0]);
  });

  it("tints every built-in gradient palette within the channel range and near the floor's luma", () => {
    for (const id of FLAME_PALETTE_IDS.filter((id) => id !== "legacy")) {
      const albedo = autoFloorAlbedo(id);
      for (const channel of albedo) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(1);
      }
      expect(luma709(albedo)).toBeGreaterThanOrEqual(0.5);
      expect(luma709(albedo)).toBeLessThanOrEqual(0.72);
    }
  });

  it("derives a blue-dominant floor from a blue first stop, like the backdrop does", () => {
    const albedo = autoFloorAlbedo({
      stops: [
        [0, 0, 1],
        [0, 1, 0],
      ],
    });
    expect(albedo[2]).toBeGreaterThan(albedo[0]);
    // The sample's blue channel overshoots 1 and clamps, which shifts the
    // luma by that clamp's slack alone — still the floor's luma to 3 places.
    expect(luma709(albedo)).toBeCloseTo(luma709(NEUTRAL), 3);
  });

  it("tints more strongly than the backdrop's desaturation when the sample is saturated", () => {
    const sample: [number, number, number] = [1, 0, 0];
    const albedo = autoFloorAlbedo({ stops: [sample, sample] });
    const luma = luma709(sample);
    // The kept chroma share is exactly AUTO_FLOOR_TUNING.strength of the
    // sample's own channel offsets (clamped only at the channel ceiling).
    expect(albedo[0]).toBeCloseTo(
      Math.min(
        1,
        PRESENTATION_FLOOR_ALBEDO[0] +
          AUTO_FLOOR_TUNING.strength * (sample[0] - luma),
      ),
      10,
    );
    expect(albedo[1]).toBeCloseTo(
      PRESENTATION_FLOOR_ALBEDO[1] +
        AUTO_FLOOR_TUNING.strength * (sample[1] - luma),
      10,
    );
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

  it("returns the dark placeholder for flame mode while its image is transient", () => {
    expect(resolveBackground({ mode: "flame" }, "sunset")).toEqual({
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
