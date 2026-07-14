import {
  addTransform,
  clampToSpec,
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
  DEFAULT_FOUR_D_COLOR,
  DEFAULT_GLOW_BRIGHTNESS,
  DEFAULT_POINT_SIZE,
  DEFAULT_RAMP_PALETTE,
  DEFAULT_SOLID_AMBIENT,
  DEFAULT_SOLID_ITERATIONS,
  DEFAULT_SOLID_LIGHT_AZIMUTH,
  DEFAULT_SOLID_LIGHT_ELEVATION,
  DEFAULT_SOLID_PALETTE,
  DEFAULT_SOLID_RESOLUTION,
  DEFAULT_SOLID_THRESHOLD,
  DEFAULT_SYMMETRY_AXIS,
  DEFAULT_SYMMETRY_ORDER,
  FLAME_ITERATION_DETENTS,
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
  MAX_POINT_SIZE,
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
  MIN_NUM_POINTS,
  MIN_POINT_SIZE,
  MIN_SOLID_AMBIENT,
  MIN_SOLID_ITERATIONS,
  MIN_SOLID_LIGHT_AZIMUTH,
  MIN_SOLID_LIGHT_ELEVATION,
  MIN_SOLID_RESOLUTION,
  MIN_SOLID_THRESHOLD,
  MIN_SYMMETRY_ORDER,
  MIN_TRANSFORMS,
  nearestFlameIterationDetentIndex,
  PARAM,
  removeTransform,
  selectTransform,
  setColorGamma,
  setCustomPaletteStops,
  setFinalTransform,
  setFlameEstimatorCurve,
  setFlameEstimatorMinimumRadius,
  setFlameEstimatorRadius,
  setFlameExposure,
  setFlameGamma,
  setFlameIterations,
  setFlamePaletteId,
  setFlameSupersample,
  setFlameVibrancy,
  setFourDColor,
  setFourDDepthFade,
  setGlowBrightness,
  setMorphDetail,
  setNumPoints,
  setPointSize,
  setPositionAxisColors,
  setRampPaletteId,
  setRenderMode,
  setRenderStyle,
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
  systemIsNonFlat,
  systemPartsAreNonFlat,
  updateTransform,
} from "./state";
import {
  defaultFinalTransform,
  mengerSponge,
  presetTransforms,
} from "../fractal/presets";
import { seedCustomStops } from "../fractal/palette";
import { mulberry32 } from "../fractal/rng";
import type { Transform } from "../fractal/types";

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

  // The app always boots into the live explorer, never straight into a flame
  // or solid render — see the headline "explorer-first" decision.
  it("boots into the points render mode", () => {
    expect(initialState(true).renderMode).toBe("points");
  });

  it("boots with the flame render at its default settings", () => {
    const state = initialState(true);
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

  it("boots with the solid render at its default settings", () => {
    const state = initialState(true);
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

  // fr-9mw: a fresh session's first flame/solid render should show the
  // iridescent cosine-gradient look, not "legacy" flat per-transform hue.
  // Pinned to the literal id (not the DEFAULT_ constants) so reverting the
  // default back to "legacy" fails here, not just in the field docs. Old
  // persisted/shared scenes still decode to "legacy" — see persist.test.ts.
  it("boots with the spectrum gradient palette for both renders", () => {
    const state = initialState(true);
    expect(state.flame.paletteId).toBe("spectrum");
    expect(state.solid.paletteId).toBe("spectrum");
  });

  // fr-3b6: unlike the flame/solid palettes (spectrum by default, fr-9mw),
  // the height/radius ramp palette defaults to "legacy" — the built-in
  // coordinate ramps are a designed look in their own right, not a
  // placeholder to upgrade to a gradient.
  it("boots with the legacy ramp palette", () => {
    const state = initialState(true);
    expect(state.rampPaletteId).toBe("legacy");
    expect(state.rampPaletteId).toBe(DEFAULT_RAMP_PALETTE);
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

  // wBlueOrange is the default 4D color mode, so a scene with no stored
  // fourDColor field (or a fresh one) renders the diverging blue/orange ramp
  // either way.
  it("defaults to the wBlueOrange 4D color mode", () => {
    expect(initialState(true).fourDColor).toBe(DEFAULT_FOUR_D_COLOR);
  });

  // Off is the default 4D depth-fade, so a scene with no stored
  // fourDDepthFade field (or a fresh one) renders the 4D projection without
  // it either way.
  it("defaults the 4D camera-depth fade to off", () => {
    expect(initialState(true).fourDDepthFade).toBe(false);
  });

  // fr-55k: absent, not an empty stop list — "never authored" is a distinct
  // state from "authored an empty gradient" (which isn't even valid, per
  // MIN_CUSTOM_PALETTE_STOPS).
  it("boots with no custom palette", () => {
    expect(initialState(true).customPalette).toBeUndefined();
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

describe("setPointSize clamps to PARAM.pointSize", () => {
  it("clamps an over-range multiplier down to the ceiling", () => {
    expect(setPointSize(initialState(true), 10).pointSize).toBe(MAX_POINT_SIZE);
  });

  it("clamps an under-range multiplier up to the floor", () => {
    expect(setPointSize(initialState(true), 0.01).pointSize).toBe(
      MIN_POINT_SIZE,
    );
  });
});

describe("setNumPoints clamps to PARAM.numPoints", () => {
  it("clamps an over-range count down to the ceiling", () => {
    expect(setNumPoints(initialState(true), 9_000_000).numPoints).toBe(
      PARAM.numPoints.max,
    );
  });

  it("clamps a negative count up to the data floor of 0", () => {
    expect(setNumPoints(initialState(true), -5).numPoints).toBe(0);
  });
});

// The persist decode boundary accepts a wider numPoints range than the UI
// slider exposes: PARAM.numPoints.min is the DATA floor (0), deliberately
// below MIN_NUM_POINTS (the log-scaled slider's own floor, which needs a
// positive value since log 0 is -Infinity). This pins that intentional gap.
describe("numPoints floor divergence (fr-2v7)", () => {
  it("keeps the data floor at 0, strictly below the UI slider floor", () => {
    expect(PARAM.numPoints.min).toBe(0);
    expect(MIN_NUM_POINTS).toBeGreaterThan(PARAM.numPoints.min);
  });
});

describe("clampToSpec", () => {
  it("plain-clamps into [min, max]", () => {
    expect(clampToSpec(PARAM.pointSize, 10)).toBe(4);
    expect(clampToSpec(PARAM.pointSize, 0)).toBe(0.25);
    expect(clampToSpec(PARAM.pointSize, 1.5)).toBe(1.5);
  });

  it("rounds to an integer when the spec asks", () => {
    expect(clampToSpec(PARAM.flameSupersample, 2.4)).toBe(2);
    expect(clampToSpec(PARAM.flameSupersample, 2.6)).toBe(3);
  });

  it("snaps to the step multiple before clamping", () => {
    // 200/32 = 6.25 -> round 6 -> 192, already inside [64, 512].
    expect(clampToSpec(PARAM.solidResolution, 200)).toBe(192);
    // 10/32 = 0.3125 -> round 0 -> 0, then the clamp rescues it up to 64.
    expect(clampToSpec(PARAM.solidResolution, 10)).toBe(64);
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

describe("setMorphDetail", () => {
  it("switches the morph detail immutably, defaulting to adaptive", () => {
    const state = initialState(true);
    const next = setMorphDetail(state, "full");
    expect(next.morphDetail).toBe("full");
    expect(state.morphDetail).toBe("adaptive");
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

  // fr-bf6.3: the single editor emits a `w` key only when its own working
  // copy is non-empty (see ui.ts's emitGeometry), so this plain object
  // spread over the patch is exactly what gives "sparse write" its meaning —
  // a `w`-carrying patch replaces the stored block outright (never a
  // field-by-field merge), and a `w`-less patch never touches it.
  it("replaces the transform's w when the patch carries one", () => {
    const state = initialState(true);
    const withW = updateTransform(state, 1, {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      w: { position: 0.4, rotation: { xw: 0.2 } },
    });
    expect(withW.transforms[1].w).toEqual({
      position: 0.4,
      rotation: { xw: 0.2 },
    });

    // A second w-carrying patch REPLACES the whole block, not merges into it
    // — the old `rotation.xw` does not survive alongside the new `scale`.
    const replaced = updateTransform(withW, 1, {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      w: { scale: 0.6 },
    });
    expect(replaced.transforms[1].w).toEqual({ scale: 0.6 });
  });

  it("leaves an existing w untouched when the patch carries none", () => {
    const state = initialState(true);
    const withW = updateTransform(state, 1, {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      w: { position: 0.4 },
    });

    // An ordinary edit (no `w` key at all in the patch) must not disturb it.
    const moved = updateTransform(withW, 1, {
      position: [2, 2, 2],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    });
    expect(moved.transforms[1].position).toEqual([2, 2, 2]);
    expect(moved.transforms[1].w).toEqual({ position: 0.4 });
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
      setFlameIterations(initialState(true), 3_000_000_000).flame.iterations,
    ).toBe(MAX_FLAME_ITERATIONS);
  });

  it("clamps below the minimum", () => {
    expect(setFlameIterations(initialState(true), 1).flame.iterations).toBe(
      MIN_FLAME_ITERATIONS,
    );
  });
});

describe("FLAME_ITERATION_DETENTS", () => {
  it("starts at the minimum and ends at the maximum iteration budget", () => {
    expect(FLAME_ITERATION_DETENTS[0]).toBe(MIN_FLAME_ITERATIONS);
    expect(FLAME_ITERATION_DETENTS[FLAME_ITERATION_DETENTS.length - 1]).toBe(
      MAX_FLAME_ITERATIONS,
    );
  });

  // index.html's flameIterationsSlider hardcodes value="4" as the default
  // detent index (and max="10" as the last one) — this pins the assumption
  // so the markup and this list can never silently drift apart.
  it("has the default iteration budget at index 4", () => {
    expect(FLAME_ITERATION_DETENTS[4]).toBe(DEFAULT_FLAME_ITERATIONS);
  });
});

describe("nearestFlameIterationDetentIndex", () => {
  it("returns a detent's own index when given its exact value", () => {
    expect(nearestFlameIterationDetentIndex(5_000_000)).toBe(2);
    expect(nearestFlameIterationDetentIndex(2_000_000_000)).toBe(10);
  });

  it("snaps a value between two detents to the nearer one in log space", () => {
    // 37M sits between 2e7 (index 4) and 5e7 (index 5). Log10 distances are
    // 0.267 to 20M vs 0.131 to 50M, so it snaps up to index 5 — a plain
    // linear midpoint (35M) would also call this closer to 50M, but the two
    // rules disagree closer to the geometric mean (~31.6M), which is why the
    // comparison has to be logarithmic, not linear.
    expect(nearestFlameIterationDetentIndex(37_000_000)).toBe(5);
  });

  it("clamps a below-minimum value to the first index", () => {
    expect(nearestFlameIterationDetentIndex(1)).toBe(0);
  });

  it("clamps an above-maximum value to the last index", () => {
    expect(nearestFlameIterationDetentIndex(10_000_000_000)).toBe(
      FLAME_ITERATION_DETENTS.length - 1,
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
    // "aurora", not the "spectrum" default — a no-op write couldn't prove
    // immutability.
    const next = setFlamePaletteId(state, "aurora");
    expect(next.flame.paletteId).toBe("aurora");
    expect(state.flame.paletteId).toBe(DEFAULT_FLAME_PALETTE);
  });

  it("leaves the other flame params untouched", () => {
    const state = initialState(true);
    const next = setFlamePaletteId(state, "ember");
    expect(next.flame.gamma).toBe(state.flame.gamma);
    expect(next.flame.exposure).toBe(state.flame.exposure);
    expect(next.flame.supersample).toBe(state.flame.supersample);
  });

  // fr-55k: the first switch to Custom seeds a tweakable copy of whatever
  // gradient the user was just looking at — "ember", not the "spectrum"
  // default, to prove it seeds from the ACTUAL previous id rather than some
  // hardcoded fallback.
  it("seeds customPalette from the previous flame palette on first switch to custom", () => {
    const state = setFlamePaletteId(initialState(true), "ember");
    const next = setFlamePaletteId(state, "custom");
    expect(next.flame.paletteId).toBe("custom");
    expect(next.customPalette).toEqual({ stops: seedCustomStops("ember") });
  });

  it("keeps the existing custom stops instead of re-seeding when selecting custom again", () => {
    const seeded = setFlamePaletteId(initialState(true), "custom");
    const customStops = [
      [0.1, 0.2, 0.3],
      [0.9, 0.8, 0.7],
    ] as const;
    const withStops = setCustomPaletteStops(seeded, customStops);
    const next = setFlamePaletteId(withStops, "custom");
    expect(next.customPalette).toEqual({ stops: customStops });
  });

  it("keeps customPalette intact when switching back to a preset id", () => {
    const seeded = setFlamePaletteId(initialState(true), "custom");
    const next = setFlamePaletteId(seeded, "aurora");
    expect(next.flame.paletteId).toBe("aurora");
    expect(next.customPalette).toBe(seeded.customPalette);
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

describe("setRenderMode", () => {
  it("switches to the flame render immutably", () => {
    const state = initialState(true);
    const next = setRenderMode(state, "flame");
    expect(next.renderMode).toBe("flame");
    expect(state.renderMode).toBe("points");
  });

  it("switches to the solid render immutably", () => {
    const state = initialState(true);
    const next = setRenderMode(state, "solid");
    expect(next.renderMode).toBe("solid");
    expect(state.renderMode).toBe("points");
  });

  it("switches back to points immutably", () => {
    const state = setRenderMode(initialState(true), "flame");
    const next = setRenderMode(state, "points");
    expect(next.renderMode).toBe("points");
    expect(state.renderMode).toBe("flame");
  });

  it("leaves the flame and solid settings untouched", () => {
    const state = initialState(true);
    const next = setRenderMode(state, "flame");
    expect(next.flame).toBe(state.flame);
    expect(next.solid).toBe(state.solid);
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
    // "aurora", not the "spectrum" default — a no-op write couldn't prove
    // immutability.
    const next = setSolidPaletteId(state, "aurora");
    expect(next.solid.paletteId).toBe("aurora");
    expect(state.solid.paletteId).toBe(DEFAULT_SOLID_PALETTE);
  });

  it("leaves the other solid params untouched", () => {
    const state = initialState(true);
    const next = setSolidPaletteId(state, "ember");
    expect(next.solid.threshold).toBe(state.solid.threshold);
    expect(next.solid.resolution).toBe(state.solid.resolution);
    expect(next.solid.iterations).toBe(state.solid.iterations);
  });

  // fr-55k: the solid twin of setFlamePaletteId's seeding test — "moss", not
  // the "spectrum" default, to prove it seeds from the ACTUAL previous SOLID
  // id (independent of the flame palette's own selection).
  it("seeds customPalette from the previous solid palette on first switch to custom", () => {
    const state = setSolidPaletteId(initialState(true), "moss");
    const next = setSolidPaletteId(state, "custom");
    expect(next.solid.paletteId).toBe("custom");
    expect(next.customPalette).toEqual({ stops: seedCustomStops("moss") });
  });
});

describe("setCustomPaletteStops", () => {
  it("replaces the stops with clamped fresh values", () => {
    const state = initialState(true);
    const next = setCustomPaletteStops(state, [
      [-1, 0.5, 2],
      [0.2, -5, 1.5],
    ]);
    expect(next.customPalette).toEqual({
      stops: [
        [0, 0.5, 1],
        [0.2, 0, 1],
      ],
    });
  });

  it("returns the state unchanged when given fewer than the minimum stops", () => {
    const state = initialState(true);
    const next = setCustomPaletteStops(state, [[0.1, 0.2, 0.3]]);
    expect(next).toBe(state);
  });

  it("keeps only the first 8 stops when given more than the maximum", () => {
    const nineStops: Array<[number, number, number]> = Array.from(
      { length: 9 },
      (_, i) => [i / 8, i / 8, i / 8],
    );
    const next = setCustomPaletteStops(initialState(true), nineStops);
    expect(next.customPalette?.stops).toEqual(nineStops.slice(0, 8));
  });

  it("returns the state unchanged when a channel is NaN or Infinity", () => {
    const state = initialState(true);
    expect(
      setCustomPaletteStops(state, [
        [0, 0, 0],
        [NaN, 1, 1],
      ]),
    ).toBe(state);
    expect(
      setCustomPaletteStops(state, [
        [0, 0, 0],
        [Infinity, 1, 1],
      ]),
    ).toBe(state);
  });
});

describe("setPositionAxisColors", () => {
  it("stores custom axis colors", () => {
    const state = initialState(true);
    const next = setPositionAxisColors(state, {
      x: [1, 0.5, 0],
      y: [0, 0.5, 1],
      z: [0.2, 0.4, 0.6],
    });
    expect(next.positionAxisColors).toEqual({
      x: [1, 0.5, 0],
      y: [0, 0.5, 1],
      z: [0.2, 0.4, 0.6],
    });
    expect(state.positionAxisColors).toBeUndefined();
  });

  it("normalizes the exact legacy identity back to undefined", () => {
    const custom = setPositionAxisColors(initialState(true), {
      x: [1, 0.5, 0],
      y: [0, 0.5, 1],
      z: [0.2, 0.4, 0.6],
    });
    const next = setPositionAxisColors(custom, {
      x: [1, 0, 0],
      y: [0, 1, 0],
      z: [0, 0, 1],
    });
    expect(next.positionAxisColors).toBeUndefined();
  });

  it("keeps a near-identity as custom colors", () => {
    const next = setPositionAxisColors(initialState(true), {
      x: [1, 0, 0],
      y: [0, 1, 0],
      z: [0, 0.1, 1],
    });
    expect(next.positionAxisColors).toEqual({
      x: [1, 0, 0],
      y: [0, 1, 0],
      z: [0, 0.1, 1],
    });
  });
});

describe("systemIsNonFlat", () => {
  // A transform's `w` block absent or all-zero is flat (see affine4.ts's
  // isFlatTransform) — the default system carries none, so it stays flat.
  it("is false for the default (flat) system with no final transform", () => {
    expect(systemIsNonFlat(initialState(true))).toBe(false);
  });

  it("is true when any transform carries a non-trivial w block", () => {
    const state = initialState(true);
    const nonFlat: Transform = { ...state.transforms[0], w: { position: 0.5 } };
    expect(
      systemIsNonFlat({
        ...state,
        transforms: [nonFlat, ...state.transforms.slice(1)],
      }),
    ).toBe(true);
  });

  it("is false when a transform's w block is present but all-zero", () => {
    const state = initialState(true);
    const stillFlat: Transform = {
      ...state.transforms[0],
      w: { position: 0, scale: 0 },
    };
    expect(
      systemIsNonFlat({
        ...state,
        transforms: [stillFlat, ...state.transforms.slice(1)],
      }),
    ).toBe(false);
  });

  // The final transform counts only per its own enabled semantics: a
  // disabled lens (finalTransform undefined) never makes an otherwise-flat
  // system read as non-flat, no matter what a stale `w` block on it would say.
  it("ignores a non-flat final transform while the lens is disabled", () => {
    const state = initialState(true);
    expect(systemIsNonFlat({ ...state, finalTransform: undefined })).toBe(
      false,
    );
  });

  it("is true when an ENABLED final transform carries a non-trivial w block", () => {
    const state = initialState(true);
    const lens = defaultFinalTransform();
    expect(
      systemIsNonFlat({
        ...state,
        finalTransform: { ...lens, w: { position: 0.5 } },
      }),
    ).toBe(true);
  });

  it("is false for an enabled but flat final transform", () => {
    const state = initialState(true);
    expect(
      systemIsNonFlat({ ...state, finalTransform: defaultFinalTransform() }),
    ).toBe(false);
  });
});

describe("systemPartsAreNonFlat", () => {
  it("is false for flat transforms with no final transform", () => {
    expect(systemPartsAreNonFlat(initialState(true).transforms, null)).toBe(
      false,
    );
  });

  it("is true when any transform carries a non-trivial w block", () => {
    const { transforms } = initialState(true);
    const nonFlat: Transform = { ...transforms[0], w: { position: 0.5 } };
    expect(systemPartsAreNonFlat([nonFlat, ...transforms.slice(1)], null)).toBe(
      true,
    );
  });

  it("is true when the final transform carries a non-trivial w block", () => {
    const { transforms } = initialState(true);
    const lens = { ...defaultFinalTransform(), w: { position: 0.5 } };
    expect(systemPartsAreNonFlat(transforms, lens)).toBe(true);
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

describe("setFourDColor", () => {
  it("sets the 4D color mode immutably", () => {
    const state = initialState(true);
    const next = setFourDColor(state, "wCyanMagenta");
    expect(next.fourDColor).toBe("wCyanMagenta");
    expect(state.fourDColor).toBe(DEFAULT_FOUR_D_COLOR);
  });
});

describe("setFourDDepthFade", () => {
  it("toggles the 4D camera-depth fade immutably", () => {
    const state = initialState(true);
    const next = setFourDDepthFade(state, true);
    expect(next.fourDDepthFade).toBe(true);
    expect(state.fourDDepthFade).toBe(false);
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

describe("setRampPaletteId", () => {
  it("sets the ramp palette id immutably", () => {
    const state = initialState(true);
    // "aurora", not the "legacy" default — a no-op write couldn't prove
    // immutability.
    const next = setRampPaletteId(state, "aurora");
    expect(next.rampPaletteId).toBe("aurora");
    expect(state.rampPaletteId).toBe(DEFAULT_RAMP_PALETTE);
  });

  it("leaves the flame/solid palette ids untouched", () => {
    const state = initialState(true);
    const next = setRampPaletteId(state, "ember");
    expect(next.flame.paletteId).toBe(state.flame.paletteId);
    expect(next.solid.paletteId).toBe(state.solid.paletteId);
  });

  // fr-3b6: the first switch to Custom seeds a tweakable copy of whatever
  // ramp gradient the user was just looking at — "ember", not the "legacy"
  // default, to prove it seeds from the ACTUAL previous id rather than some
  // hardcoded fallback.
  it("seeds customPalette from the previous ramp palette on first switch to custom", () => {
    const state = setRampPaletteId(initialState(true), "ember");
    const next = setRampPaletteId(state, "custom");
    expect(next.rampPaletteId).toBe("custom");
    expect(next.customPalette).toEqual({ stops: seedCustomStops("ember") });
  });

  it("keeps the existing custom stops instead of re-seeding when selecting custom again", () => {
    const seeded = setRampPaletteId(initialState(true), "custom");
    const customStops = [
      [0.1, 0.2, 0.3],
      [0.9, 0.8, 0.7],
    ] as const;
    const withStops = setCustomPaletteStops(seeded, customStops);
    const next = setRampPaletteId(withStops, "custom");
    expect(next.customPalette).toEqual({ stops: customStops });
  });

  it("keeps customPalette intact when switching back to a preset id", () => {
    const seeded = setRampPaletteId(initialState(true), "custom");
    const next = setRampPaletteId(seeded, "aurora");
    expect(next.rampPaletteId).toBe("aurora");
    expect(next.customPalette).toBe(seeded.customPalette);
  });
});
