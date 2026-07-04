import {
  addTransform,
  DEFAULT_COLOR_GAMMA,
  DEFAULT_ESTIMATOR_CURVE,
  DEFAULT_ESTIMATOR_MINIMUM_RADIUS,
  DEFAULT_ESTIMATOR_RADIUS,
  DEFAULT_FLAME_EXPOSURE,
  DEFAULT_FLAME_GAMMA,
  DEFAULT_FLAME_ITERATIONS,
  DEFAULT_FLAME_PALETTE,
  DEFAULT_FLAME_SUPERSAMPLE,
  DEFAULT_FLAME_VIBRANCY,
  DEFAULT_GLOW_BRIGHTNESS,
  DEFAULT_POINT_SIZE,
  DEFAULT_SOLID_AMBIENT,
  DEFAULT_SOLID_ITERATIONS,
  DEFAULT_SOLID_LIGHT_AZIMUTH,
  DEFAULT_SOLID_LIGHT_ELEVATION,
  DEFAULT_SOLID_PALETTE,
  DEFAULT_SOLID_RESOLUTION,
  DEFAULT_SOLID_THRESHOLD,
  DEFAULT_SYMMETRY_AXIS,
  DEFAULT_SYMMETRY_ORDER,
  initialState,
  MAX_COLOR_GAMMA,
  MAX_ESTIMATOR_CURVE,
  MAX_ESTIMATOR_MINIMUM_RADIUS,
  MAX_ESTIMATOR_RADIUS,
  MAX_FLAME_EXPOSURE,
  MAX_FLAME_GAMMA,
  MAX_FLAME_ITERATIONS,
  MAX_FLAME_SUPERSAMPLE,
  MAX_FLAME_VIBRANCY,
  MAX_GLOW_BRIGHTNESS,
  MAX_SOLID_AMBIENT,
  MAX_SOLID_ITERATIONS,
  MAX_SOLID_LIGHT_AZIMUTH,
  MAX_SOLID_LIGHT_ELEVATION,
  MAX_SOLID_RESOLUTION,
  MAX_SOLID_THRESHOLD,
  MAX_SYMMETRY_ORDER,
  MIN_COLOR_GAMMA,
  MIN_ESTIMATOR_CURVE,
  MIN_ESTIMATOR_MINIMUM_RADIUS,
  MIN_ESTIMATOR_RADIUS,
  MIN_FLAME_EXPOSURE,
  MIN_FLAME_GAMMA,
  MIN_FLAME_ITERATIONS,
  MIN_FLAME_SUPERSAMPLE,
  MIN_FLAME_VIBRANCY,
  MIN_GLOW_BRIGHTNESS,
  MIN_SOLID_AMBIENT,
  MIN_SOLID_ITERATIONS,
  MIN_SOLID_LIGHT_AZIMUTH,
  MIN_SOLID_LIGHT_ELEVATION,
  MIN_SOLID_RESOLUTION,
  MIN_SOLID_THRESHOLD,
  MIN_SYMMETRY_ORDER,
  MIN_TRANSFORMS,
  removeTransform,
  selectTransform,
  setColorGamma,
  setFinalTransform,
  setFlameActive,
  setFlameEstimatorCurve,
  setFlameEstimatorMinimumRadius,
  setFlameEstimatorRadius,
  setFlameExposure,
  setFlameGamma,
  setFlameIterations,
  setFlamePaletteId,
  setFlameSupersample,
  setFlameVibrancy,
  setGlowBrightness,
  setPointSize,
  setRenderStyle,
  setSolidActive,
  setSolidAmbient,
  setSolidIterations,
  setSolidLightAzimuth,
  setSolidLightElevation,
  setSolidPaletteId,
  setSolidResolution,
  setSolidThreshold,
  setSymmetryAxis,
  setSymmetryOrder,
  setTransforms,
  updateTransform,
} from "./state";
import {
  defaultFinalTransform,
  mengerSponge,
  presetTransforms,
} from "../fractal/presets";
import { mulberry32 } from "../fractal/rng";

describe("initialState", () => {
  it("starts in camera mode with the default system", () => {
    const state = initialState(true);
    expect(state.selectedTransform).toBeNull();
    expect(state.transforms).toHaveLength(4);
    expect(state.colorMode).toBe("transform");
    expect(state.renderStyle).toBe("depthFade");
    expect(state.pointSize).toBe(DEFAULT_POINT_SIZE);
    expect(state.panelOpen).toBe(true);
    expect(state.glowBrightness).toBe(DEFAULT_GLOW_BRIGHTNESS);
    expect(state.colorGamma).toBe(DEFAULT_COLOR_GAMMA);
  });

  // The app always boots into the live explorer, never straight into a
  // flame render — see the headline "explorer-first" decision.
  it("boots with the flame render inactive, at its default settings", () => {
    const state = initialState(true);
    expect(state.flameActive).toBe(false);
    expect(state.flame).toEqual({
      exposure: DEFAULT_FLAME_EXPOSURE,
      iterations: DEFAULT_FLAME_ITERATIONS,
      gamma: DEFAULT_FLAME_GAMMA,
      vibrancy: DEFAULT_FLAME_VIBRANCY,
      supersample: DEFAULT_FLAME_SUPERSAMPLE,
      estimatorRadius: DEFAULT_ESTIMATOR_RADIUS,
      estimatorMinimumRadius: DEFAULT_ESTIMATOR_MINIMUM_RADIUS,
      estimatorCurve: DEFAULT_ESTIMATOR_CURVE,
      paletteId: DEFAULT_FLAME_PALETTE,
    });
  });

  // Like the flame render, the solid render never starts active — see above.
  it("boots with the solid render inactive, at its default settings", () => {
    const state = initialState(true);
    expect(state.solidActive).toBe(false);
    expect(state.solid).toEqual({
      resolution: DEFAULT_SOLID_RESOLUTION,
      iterations: DEFAULT_SOLID_ITERATIONS,
      threshold: DEFAULT_SOLID_THRESHOLD,
      lightAzimuth: DEFAULT_SOLID_LIGHT_AZIMUTH,
      lightElevation: DEFAULT_SOLID_LIGHT_ELEVATION,
      ambient: DEFAULT_SOLID_AMBIENT,
      paletteId: DEFAULT_SOLID_PALETTE,
    });
  });

  // The startup fractal must match a menu preset so it can be reselected.
  it("starts with the 'default' preset's system", () => {
    expect(initialState(true).transforms).toEqual(presetTransforms("default"));
  });

  // Symmetry defaults to off (order 1) so a fresh scene renders exactly like
  // the unreplicated system it always has been.
  it("boots with symmetry off, at the default axis", () => {
    const state = initialState(true);
    expect(state.symmetry).toEqual({
      order: DEFAULT_SYMMETRY_ORDER,
      axis: DEFAULT_SYMMETRY_AXIS,
    });
  });
});

describe("setPointSize", () => {
  it("sets the point-size multiplier immutably", () => {
    const state = initialState(true);
    const next = setPointSize(state, 2.5);
    expect(next.pointSize).toBe(2.5);
    expect(state.pointSize).toBe(DEFAULT_POINT_SIZE);
  });
});

describe("setRenderStyle", () => {
  it("switches the render style immutably", () => {
    const state = initialState(true);
    const next = setRenderStyle(state, "glow");
    expect(next.renderStyle).toBe("glow");
    expect(state.renderStyle).toBe("depthFade");
  });
});

describe("addTransform / removeTransform", () => {
  it("adds a transform immutably", () => {
    const state = initialState(true);
    const next = addTransform(state, mulberry32(1));
    expect(next.transforms).toHaveLength(5);
    expect(state.transforms).toHaveLength(4);
  });

  it("removes the last transform", () => {
    const state = addTransform(initialState(true), mulberry32(1));
    expect(removeTransform(state).transforms).toHaveLength(4);
  });

  it("never drops below the minimum number of transforms", () => {
    let state = initialState(true);
    state = setTransforms(state, [state.transforms[0]]);
    expect(state.transforms).toHaveLength(MIN_TRANSFORMS);
    expect(removeTransform(state).transforms).toHaveLength(MIN_TRANSFORMS);
  });

  it("clears the selection when the selected transform is removed", () => {
    const state = selectTransform(initialState(true), 3);
    expect(removeTransform(state).selectedTransform).toBeNull();
  });

  it("keeps a lower selection index when removing the last transform", () => {
    const state = selectTransform(initialState(true), 1);
    expect(removeTransform(state).selectedTransform).toBe(1);
  });
});

describe("setTransforms", () => {
  it("swaps in a preset and returns to camera mode", () => {
    const state = selectTransform(initialState(true), 2);
    const next = setTransforms(state, mengerSponge());
    expect(next.transforms).toHaveLength(20);
    expect(next.selectedTransform).toBeNull();
  });
});

describe("setFinalTransform", () => {
  it("enables a final transform immutably", () => {
    const state = initialState(true);
    const lens = defaultFinalTransform();
    const next = setFinalTransform(state, lens);
    expect(next.finalTransform).toBe(lens);
    expect(state.finalTransform).toBeUndefined();
  });

  it("clears the final transform when passed null", () => {
    const enabled = setFinalTransform(
      initialState(true),
      defaultFinalTransform(),
    );
    expect(setFinalTransform(enabled, null).finalTransform).toBeUndefined();
  });
});

describe("selectTransform with the final transform", () => {
  it("targets the final transform", () => {
    expect(selectTransform(initialState(true), "final").selectedTransform).toBe(
      "final",
    );
  });

  it("keeps the final transform selected when a transform is removed", () => {
    let state = addTransform(initialState(true), mulberry32(1));
    state = selectTransform(state, "final");
    expect(removeTransform(state).selectedTransform).toBe("final");
  });
});

describe("updateTransform", () => {
  it("edits one transform's geometry while preserving its id", () => {
    const state = initialState(true);
    const originalId = state.transforms[1].id;
    const next = updateTransform(state, 1, {
      position: [9, 9, 9],
      rotation: [0, 0, 0],
      scale: [0.1, 0.1, 0.1],
    });
    expect(next.transforms[1].position).toEqual([9, 9, 9]);
    expect(next.transforms[1].id).toBe(originalId);
    // Other transforms untouched.
    expect(next.transforms[0]).toBe(state.transforms[0]);
  });
});

describe("setFlameExposure", () => {
  it("sets the exposure immutably", () => {
    const state = initialState(true);
    const next = setFlameExposure(state, 2.5);
    expect(next.flame.exposure).toBe(2.5);
    expect(state.flame.exposure).toBe(DEFAULT_FLAME_EXPOSURE);
  });

  it("clamps above the maximum", () => {
    expect(setFlameExposure(initialState(true), 999).flame.exposure).toBe(
      MAX_FLAME_EXPOSURE,
    );
  });

  it("clamps below the minimum", () => {
    expect(setFlameExposure(initialState(true), -5).flame.exposure).toBe(
      MIN_FLAME_EXPOSURE,
    );
  });
});

describe("setFlameIterations", () => {
  it("sets the iteration budget immutably", () => {
    const state = initialState(true);
    const next = setFlameIterations(state, 50_000_000);
    expect(next.flame.iterations).toBe(50_000_000);
    expect(state.flame.iterations).toBe(DEFAULT_FLAME_ITERATIONS);
  });

  it("clamps above the maximum", () => {
    expect(
      setFlameIterations(initialState(true), 1_000_000_000).flame.iterations,
    ).toBe(MAX_FLAME_ITERATIONS);
  });

  it("clamps below the minimum", () => {
    expect(setFlameIterations(initialState(true), 1).flame.iterations).toBe(
      MIN_FLAME_ITERATIONS,
    );
  });
});

describe("setFlameGamma", () => {
  it("sets gamma immutably", () => {
    const state = initialState(true);
    const next = setFlameGamma(state, 3.5);
    expect(next.flame.gamma).toBe(3.5);
    expect(state.flame.gamma).toBe(DEFAULT_FLAME_GAMMA);
  });

  it("clamps above the maximum", () => {
    expect(setFlameGamma(initialState(true), 999).flame.gamma).toBe(
      MAX_FLAME_GAMMA,
    );
  });

  it("clamps below the minimum", () => {
    expect(setFlameGamma(initialState(true), -5).flame.gamma).toBe(
      MIN_FLAME_GAMMA,
    );
  });
});

describe("setFlameVibrancy", () => {
  it("sets vibrancy immutably", () => {
    const state = initialState(true);
    const next = setFlameVibrancy(state, 0.5);
    expect(next.flame.vibrancy).toBe(0.5);
    expect(state.flame.vibrancy).toBe(DEFAULT_FLAME_VIBRANCY);
  });

  it("clamps above the maximum", () => {
    expect(setFlameVibrancy(initialState(true), 5).flame.vibrancy).toBe(
      MAX_FLAME_VIBRANCY,
    );
  });

  it("clamps below the minimum", () => {
    expect(setFlameVibrancy(initialState(true), -5).flame.vibrancy).toBe(
      MIN_FLAME_VIBRANCY,
    );
  });
});

describe("setFlameSupersample", () => {
  it("sets the supersample factor immutably", () => {
    const state = initialState(true);
    const next = setFlameSupersample(state, 3);
    expect(next.flame.supersample).toBe(3);
    expect(state.flame.supersample).toBe(DEFAULT_FLAME_SUPERSAMPLE);
  });

  it("rounds to the nearest integer", () => {
    expect(setFlameSupersample(initialState(true), 2.6).flame.supersample).toBe(
      3,
    );
  });

  it("clamps above the maximum", () => {
    expect(setFlameSupersample(initialState(true), 99).flame.supersample).toBe(
      MAX_FLAME_SUPERSAMPLE,
    );
  });

  it("clamps below the minimum", () => {
    expect(setFlameSupersample(initialState(true), 0).flame.supersample).toBe(
      MIN_FLAME_SUPERSAMPLE,
    );
  });
});

describe("setFlamePaletteId", () => {
  it("sets the palette id immutably", () => {
    const state = initialState(true);
    const next = setFlamePaletteId(state, "spectrum");
    expect(next.flame.paletteId).toBe("spectrum");
    expect(state.flame.paletteId).toBe(DEFAULT_FLAME_PALETTE);
  });

  it("leaves the other flame params untouched", () => {
    const state = initialState(true);
    const next = setFlamePaletteId(state, "ember");
    expect(next.flame.gamma).toBe(state.flame.gamma);
    expect(next.flame.exposure).toBe(state.flame.exposure);
    expect(next.flame.supersample).toBe(state.flame.supersample);
  });
});

describe("setFlameEstimatorRadius", () => {
  it("sets the widest adaptive-blur radius immutably", () => {
    const state = initialState(true);
    const next = setFlameEstimatorRadius(state, 9);
    expect(next.flame.estimatorRadius).toBe(9);
    expect(state.flame.estimatorRadius).toBe(DEFAULT_ESTIMATOR_RADIUS);
  });

  it("clamps above the maximum", () => {
    expect(
      setFlameEstimatorRadius(initialState(true), 999).flame.estimatorRadius,
    ).toBe(MAX_ESTIMATOR_RADIUS);
  });

  it("clamps below the minimum", () => {
    expect(
      setFlameEstimatorRadius(initialState(true), -5).flame.estimatorRadius,
    ).toBe(MIN_ESTIMATOR_RADIUS);
  });
});

describe("setFlameEstimatorMinimumRadius", () => {
  it("sets the narrowest adaptive-blur radius immutably", () => {
    const state = initialState(true);
    const next = setFlameEstimatorMinimumRadius(state, 2);
    expect(next.flame.estimatorMinimumRadius).toBe(2);
    expect(state.flame.estimatorMinimumRadius).toBe(
      DEFAULT_ESTIMATOR_MINIMUM_RADIUS,
    );
  });

  it("clamps above the maximum", () => {
    expect(
      setFlameEstimatorMinimumRadius(initialState(true), 999).flame
        .estimatorMinimumRadius,
    ).toBe(MAX_ESTIMATOR_MINIMUM_RADIUS);
  });

  it("clamps below the minimum", () => {
    expect(
      setFlameEstimatorMinimumRadius(initialState(true), -5).flame
        .estimatorMinimumRadius,
    ).toBe(MIN_ESTIMATOR_MINIMUM_RADIUS);
  });
});

describe("setFlameEstimatorCurve", () => {
  it("sets the adaptive-blur falloff curve immutably", () => {
    const state = initialState(true);
    const next = setFlameEstimatorCurve(state, 1.2);
    expect(next.flame.estimatorCurve).toBe(1.2);
    expect(state.flame.estimatorCurve).toBe(DEFAULT_ESTIMATOR_CURVE);
  });

  it("clamps above the maximum", () => {
    expect(
      setFlameEstimatorCurve(initialState(true), 999).flame.estimatorCurve,
    ).toBe(MAX_ESTIMATOR_CURVE);
  });

  it("clamps below the minimum", () => {
    expect(
      setFlameEstimatorCurve(initialState(true), -5).flame.estimatorCurve,
    ).toBe(MIN_ESTIMATOR_CURVE);
  });
});

describe("setFlameActive", () => {
  it("toggles the flame overlay immutably, independent of flame params", () => {
    const state = initialState(true);
    const next = setFlameActive(state, true);
    expect(next.flameActive).toBe(true);
    expect(state.flameActive).toBe(false);
    expect(next.flame).toBe(state.flame);
  });
});

describe("setSolidResolution", () => {
  it("sets the resolution immutably", () => {
    const state = initialState(true);
    const next = setSolidResolution(state, 224);
    expect(next.solid.resolution).toBe(224);
    expect(state.solid.resolution).toBe(DEFAULT_SOLID_RESOLUTION);
  });

  it("snaps to the nearest multiple of the voxel step", () => {
    expect(setSolidResolution(initialState(true), 100).solid.resolution).toBe(
      96,
    );
  });

  it("clamps above the maximum", () => {
    expect(setSolidResolution(initialState(true), 999).solid.resolution).toBe(
      MAX_SOLID_RESOLUTION,
    );
  });

  it("clamps below the minimum", () => {
    expect(setSolidResolution(initialState(true), 1).solid.resolution).toBe(
      MIN_SOLID_RESOLUTION,
    );
  });
});

describe("setSolidIterations", () => {
  it("sets the iteration budget immutably", () => {
    const state = initialState(true);
    const next = setSolidIterations(state, 50_000_000);
    expect(next.solid.iterations).toBe(50_000_000);
    expect(state.solid.iterations).toBe(DEFAULT_SOLID_ITERATIONS);
  });

  it("clamps above the maximum", () => {
    expect(
      setSolidIterations(initialState(true), 1_000_000_000).solid.iterations,
    ).toBe(MAX_SOLID_ITERATIONS);
  });

  it("clamps below the minimum", () => {
    expect(setSolidIterations(initialState(true), 1).solid.iterations).toBe(
      MIN_SOLID_ITERATIONS,
    );
  });
});

describe("setSolidThreshold", () => {
  it("sets the isosurface level immutably", () => {
    const state = initialState(true);
    const next = setSolidThreshold(state, 0.6);
    expect(next.solid.threshold).toBe(0.6);
    expect(state.solid.threshold).toBe(DEFAULT_SOLID_THRESHOLD);
  });

  it("clamps above the maximum", () => {
    expect(setSolidThreshold(initialState(true), 999).solid.threshold).toBe(
      MAX_SOLID_THRESHOLD,
    );
  });

  it("clamps below the minimum", () => {
    expect(setSolidThreshold(initialState(true), -5).solid.threshold).toBe(
      MIN_SOLID_THRESHOLD,
    );
  });
});

describe("setSolidLightAzimuth", () => {
  it("sets the light's horizontal angle immutably", () => {
    const state = initialState(true);
    const next = setSolidLightAzimuth(state, -90);
    expect(next.solid.lightAzimuth).toBe(-90);
    expect(state.solid.lightAzimuth).toBe(DEFAULT_SOLID_LIGHT_AZIMUTH);
  });

  it("clamps above the maximum", () => {
    expect(
      setSolidLightAzimuth(initialState(true), 999).solid.lightAzimuth,
    ).toBe(MAX_SOLID_LIGHT_AZIMUTH);
  });

  it("clamps below the minimum", () => {
    expect(
      setSolidLightAzimuth(initialState(true), -999).solid.lightAzimuth,
    ).toBe(MIN_SOLID_LIGHT_AZIMUTH);
  });
});

describe("setSolidLightElevation", () => {
  it("sets the light's elevation immutably", () => {
    const state = initialState(true);
    const next = setSolidLightElevation(state, 70);
    expect(next.solid.lightElevation).toBe(70);
    expect(state.solid.lightElevation).toBe(DEFAULT_SOLID_LIGHT_ELEVATION);
  });

  it("clamps above the maximum", () => {
    expect(
      setSolidLightElevation(initialState(true), 999).solid.lightElevation,
    ).toBe(MAX_SOLID_LIGHT_ELEVATION);
  });

  it("clamps below the minimum", () => {
    expect(
      setSolidLightElevation(initialState(true), -999).solid.lightElevation,
    ).toBe(MIN_SOLID_LIGHT_ELEVATION);
  });
});

describe("setSolidAmbient", () => {
  it("sets the ambient floor immutably", () => {
    const state = initialState(true);
    const next = setSolidAmbient(state, 0.5);
    expect(next.solid.ambient).toBe(0.5);
    expect(state.solid.ambient).toBe(DEFAULT_SOLID_AMBIENT);
  });

  it("clamps above the maximum", () => {
    expect(setSolidAmbient(initialState(true), 5).solid.ambient).toBe(
      MAX_SOLID_AMBIENT,
    );
  });

  it("clamps below the minimum", () => {
    expect(setSolidAmbient(initialState(true), -5).solid.ambient).toBe(
      MIN_SOLID_AMBIENT,
    );
  });
});

describe("setSolidPaletteId", () => {
  it("sets the palette id immutably", () => {
    const state = initialState(true);
    const next = setSolidPaletteId(state, "spectrum");
    expect(next.solid.paletteId).toBe("spectrum");
    expect(state.solid.paletteId).toBe(DEFAULT_SOLID_PALETTE);
  });

  it("leaves the other solid params untouched", () => {
    const state = initialState(true);
    const next = setSolidPaletteId(state, "ember");
    expect(next.solid.threshold).toBe(state.solid.threshold);
    expect(next.solid.resolution).toBe(state.solid.resolution);
    expect(next.solid.iterations).toBe(state.solid.iterations);
  });
});

describe("setSolidActive", () => {
  it("toggles the solid overlay immutably, independent of solid params", () => {
    const state = initialState(true);
    const next = setSolidActive(state, true);
    expect(next.solidActive).toBe(true);
    expect(state.solidActive).toBe(false);
    expect(next.solid).toBe(state.solid);
  });
});

describe("setSymmetryOrder", () => {
  it("sets the replica count immutably", () => {
    const state = initialState(true);
    const next = setSymmetryOrder(state, 4);
    expect(next.symmetry.order).toBe(4);
    expect(state.symmetry.order).toBe(DEFAULT_SYMMETRY_ORDER);
  });

  it("rounds to the nearest integer", () => {
    expect(setSymmetryOrder(initialState(true), 4.6).symmetry.order).toBe(5);
  });

  it("clamps below the minimum", () => {
    expect(setSymmetryOrder(initialState(true), 0).symmetry.order).toBe(
      MIN_SYMMETRY_ORDER,
    );
  });

  it("clamps above the maximum", () => {
    expect(setSymmetryOrder(initialState(true), 99).symmetry.order).toBe(
      MAX_SYMMETRY_ORDER,
    );
  });

  it("leaves the axis and the rest of state untouched", () => {
    const state = initialState(true);
    const next = setSymmetryOrder(state, 6);
    expect(next.symmetry.axis).toBe(state.symmetry.axis);
    expect(next.transforms).toBe(state.transforms);
    expect(next.flame).toBe(state.flame);
  });
});

describe("setSymmetryAxis", () => {
  it("sets the axis immutably", () => {
    const state = initialState(true);
    const next = setSymmetryAxis(state, "x");
    expect(next.symmetry.axis).toBe("x");
    expect(state.symmetry.axis).toBe(DEFAULT_SYMMETRY_AXIS);
  });

  it("leaves the order and the rest of state untouched", () => {
    const state = initialState(true);
    const next = setSymmetryAxis(state, "z");
    expect(next.symmetry.order).toBe(state.symmetry.order);
    expect(next.transforms).toBe(state.transforms);
    expect(next.flame).toBe(state.flame);
  });
});

describe("setGlowBrightness", () => {
  it("sets the manual glow brightness immutably", () => {
    const state = initialState(true);
    const next = setGlowBrightness(state, 2);
    expect(next.glowBrightness).toBe(2);
    expect(state.glowBrightness).toBe(DEFAULT_GLOW_BRIGHTNESS);
  });

  it("clamps above the maximum", () => {
    expect(setGlowBrightness(initialState(true), 999).glowBrightness).toBe(
      MAX_GLOW_BRIGHTNESS,
    );
  });

  it("clamps below the minimum", () => {
    expect(setGlowBrightness(initialState(true), -5).glowBrightness).toBe(
      MIN_GLOW_BRIGHTNESS,
    );
  });
});

describe("setColorGamma", () => {
  it("sets the color-contrast exponent immutably", () => {
    const state = initialState(true);
    const next = setColorGamma(state, 2.5);
    expect(next.colorGamma).toBe(2.5);
    expect(state.colorGamma).toBe(DEFAULT_COLOR_GAMMA);
  });

  it("clamps above the maximum", () => {
    expect(setColorGamma(initialState(true), 999).colorGamma).toBe(
      MAX_COLOR_GAMMA,
    );
  });

  it("clamps below the minimum", () => {
    expect(setColorGamma(initialState(true), -5).colorGamma).toBe(
      MIN_COLOR_GAMMA,
    );
  });
});
