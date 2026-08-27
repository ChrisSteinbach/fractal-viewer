import {
  activeScenePalette,
  addTransform,
  appendXaosBlock,
  BALLOON_PALETTE_IDS,
  BALLOON_PALETTE_INHERIT,
  clampToSpec,
  computeXaosBlockOffset,
  DEFAULT_BALLOON_PALETTE,
  DEFAULT_BALLOON_RADIUS,
  DEFAULT_BALLOON_TINT,
  DEFAULT_BALLOON_TINT_STRENGTH,
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
  DEFAULT_FOG_DENSITY,
  DEFAULT_FOG_TINT,
  DEFAULT_FOG_TINT_STRENGTH,
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
  DEFAULT_SURFACE_ANTIALIAS_SAMPLES,
  DEFAULT_SURFACE_COLOR_SPEED,
  DEFAULT_SURFACE_ENV_LIGHT,
  DEFAULT_SURFACE_FLOOR_EMISSION,
  DEFAULT_SURFACE_FLOOR_TILE_SCALE,
  DEFAULT_SYMMETRY_PLANE,
  DEFAULT_SYMMETRY_ORDER,
  detectXaosBlocks,
  detectXaosLeaks,
  FLAME_ITERATION_DETENTS,
  initialState,
  MAX_BALLOON_RADIUS,
  MAX_BALLOON_TINT_STRENGTH,
  MAX_COLOR_GAMMA,
  MAX_ESTIMATOR_CURVE,
  MAX_ESTIMATOR_MINIMUM_RADIUS,
  MAX_ESTIMATOR_RADIUS,
  MAX_FLAME_EXPOSURE,
  MAX_FLAME_GAMMA,
  MAX_FLAME_ITERATIONS,
  MAX_FLAME_SUPERSAMPLE,
  MAX_FLAME_VIBRANCY,
  MAX_FOG_DENSITY,
  MAX_FOG_TINT_STRENGTH,
  MAX_GLOW_BRIGHTNESS,
  MAX_POINT_SIZE,
  MAX_SOLID_AMBIENT,
  MAX_SOLID_ITERATIONS,
  MAX_SOLID_LIGHT_AZIMUTH,
  MAX_SOLID_LIGHT_ELEVATION,
  MAX_SOLID_RESOLUTION,
  MAX_SOLID_THRESHOLD,
  MAX_SURFACE_COLOR_SPEED,
  MAX_SURFACE_ENV_LIGHT,
  MAX_SYMMETRY_ORDER,
  MIN_BALLOON_RADIUS,
  MIN_BALLOON_TINT_STRENGTH,
  MIN_COLOR_GAMMA,
  MIN_ESTIMATOR_CURVE,
  MIN_ESTIMATOR_MINIMUM_RADIUS,
  MIN_ESTIMATOR_RADIUS,
  MIN_FLAME_EXPOSURE,
  MIN_FLAME_GAMMA,
  MIN_FLAME_ITERATIONS,
  MIN_FLAME_SUPERSAMPLE,
  MIN_FLAME_VIBRANCY,
  MIN_FOG_DENSITY,
  MIN_FOG_TINT_STRENGTH,
  MIN_GLOW_BRIGHTNESS,
  MIN_NUM_POINTS,
  MIN_POINT_SIZE,
  MIN_SOLID_AMBIENT,
  MIN_SOLID_ITERATIONS,
  MIN_SOLID_LIGHT_AZIMUTH,
  MIN_SOLID_LIGHT_ELEVATION,
  MIN_SOLID_RESOLUTION,
  MIN_SOLID_THRESHOLD,
  MIN_SURFACE_COLOR_SPEED,
  MIN_SURFACE_ENV_LIGHT,
  MIN_SYMMETRY_ORDER,
  MIN_TRANSFORMS,
  nearestFlameIterationDetentIndex,
  nearestLogDetentIndex,
  PARAM,
  POINT_COUNT_DETENTS,
  removeTransform,
  resolveBalloonPalette,
  resolveFlameBackdropPalette,
  resolveSceneBackground,
  selectTransform,
  setAdaptiveResolution,
  setBackgroundCustom,
  setBackgroundFlamePaletteId,
  setBackgroundMode,
  setBackgroundShape,
  setBalloonCustomPaletteStops,
  setBalloonEcho,
  setBalloonPaletteId,
  setBalloonRadius,
  setBalloonTint,
  setBalloonTintStrength,
  setChaosCell,
  setChaosLeak,
  setColorGamma,
  setCondensationDepthBand,
  setCustomPaletteStops,
  setExportScale,
  setFinalTransform,
  setSchedule,
  setShapeTrap,
  updateShapeTrap,
  setScheduleDepth,
  stripScheduleTransform,
  setFlameEstimatorCurve,
  setFlameEstimatorMinimumRadius,
  setFlameEstimatorRadius,
  setFlameExposure,
  setFlameGamma,
  setFlameIterations,
  setFlamePaletteId,
  setFlameSupersample,
  setFlameVibrancy,
  setFogDensity,
  setFogTint,
  setFogTintStrength,
  setFourDColor,
  setFourDDepthFade,
  setGlowBrightness,
  setGroundPlane,
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
  setSurfaceAmbient,
  setSurfaceAntialiasSamples,
  setSurfaceColorSource,
  setSurfaceColorSpeed,
  setSurfaceEnvLight,
  setSurfaceLightAzimuth,
  setSurfaceLightElevation,
  setSurfacePaletteId,
  SOLID_ITERATION_DETENTS,
  SURFACE_ANTIALIAS_DETENTS,
  setSymmetryPlane,
  setSymmetryTwist,
  setSymmetryOrder,
  setTransforms,
  setTransformEmitter,
  systemIsNonFlat,
  updateTransform,
} from "./state";
import { autoBackground, resolveBackground } from "./background";
import {
  barnsleyFern,
  defaultFinalTransform,
  fernSpongeIsolated,
  fernSpongeLeak,
  mengerSponge,
  presetTransforms,
} from "../fractal/presets";
import { seedCustomStops } from "../fractal/palette";
import { mulberry32 } from "../fractal/rng";
import { chaosRowIsNonTrivial, MAX_TRANSFORMS } from "../fractal/chaos-game";
import type { ShapeTrap, Transform } from "../fractal/types";
import {
  CRESCENT_MOON_SHAPE,
  FACETED_CRYSTAL_SHAPE,
  GEAR_SHAPE,
  HEART_PRISM_SHAPE,
  ORBIT_RING_SHAPE,
  PEACE_SIGN_SHAPE,
  SNOWFLAKE_PRISM_SHAPE,
  STAR_PRISM_SHAPE,
  TREFOIL_KNOT_SHAPE,
} from "../fractal/shapes";

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
    expect(state.fogDensity).toBe(DEFAULT_FOG_DENSITY);
    expect(state.fogTint).toBe(DEFAULT_FOG_TINT);
    expect(state.fogTintStrength).toBe(DEFAULT_FOG_TINT_STRENGTH);
    expect(state.groundPlane).toBe(false);
  });

  // The app always boots into the live explorer, never straight into a flame
  // or solid render — see the headline "explorer-first" decision.
  it("boots into the points render mode", () => {
    expect(initialState(true).renderMode).toBe("points");
  });

  // The balloon echo starts off, like every other session-only
  // view toggle, so a shared link never surprises a viewer with an extra
  // cloud; its radius still carries a sane rest-pose default for the moment
  // it's first turned on.
  it("boots with the balloon echo off at its default radius", () => {
    const state = initialState(true);
    expect(state.balloonEcho).toBe(false);
    expect(state.balloonRadius).toBe(DEFAULT_BALLOON_RADIUS);
  });

  it("boots with the balloon palette explicitly inheriting and no custom payload", () => {
    const state = initialState(true);
    expect(state.balloonPaletteId).toBe(BALLOON_PALETTE_INHERIT);
    expect(state.balloonPaletteId).toBe(DEFAULT_BALLOON_PALETTE);
    expect(state.balloonCustomPalette).toBeUndefined();
  });

  // The balloon tint starts fully off too: black at strength 0,
  // which every arm's mix collapses to today's untinted rendering exactly.
  it("boots with the balloon tint at its default color and zero strength", () => {
    const state = initialState(true);
    expect(state.balloonTint).toBe(DEFAULT_BALLOON_TINT);
    expect(state.balloonTintStrength).toBe(DEFAULT_BALLOON_TINT_STRENGTH);
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

  // The surface render's lighting reuses the solid render's own
  // MIN_/MAX_/DEFAULT_ constants (same physical meaning), and its default
  // colorSource is "transform" — not "palette" — so a fresh session's
  // surface render shows each map's own color, not the (still-primed)
  // gradient paletteId.
  it("boots with the surface render at its default settings", () => {
    const state = initialState(true);
    expect(state.surface).toEqual({
      antialiasSamples: DEFAULT_SURFACE_ANTIALIAS_SAMPLES,
      lightAzimuth: DEFAULT_SOLID_LIGHT_AZIMUTH,
      lightElevation: DEFAULT_SOLID_LIGHT_ELEVATION,
      ambient: DEFAULT_SOLID_AMBIENT,
      colorSource: "transform",
      paletteId: DEFAULT_SOLID_PALETTE,
      colorSpeed: DEFAULT_SURFACE_COLOR_SPEED,
      envLight: DEFAULT_SURFACE_ENV_LIGHT,
      floorPattern: "solid",
      floorTileScale: DEFAULT_SURFACE_FLOOR_TILE_SCALE,
      floorEmission: DEFAULT_SURFACE_FLOOR_EMISSION,
    });
  });

  // A fresh session's first flame/solid render should show the
  // iridescent cosine-gradient look, not "legacy" flat per-transform hue.
  // Pinned to the literal id (not the DEFAULT_ constants) so reverting the
  // default back to "legacy" fails here, not just in the field docs. Old
  // persisted/shared scenes still decode to "legacy" — see persist.test.ts.
  it("boots with the spectrum gradient palette for both renders", () => {
    const state = initialState(true);
    expect(state.flame.paletteId).toBe("spectrum");
    expect(state.solid.paletteId).toBe("spectrum");
  });

  // Unlike the flame/solid palettes (spectrum by default),
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
      plane: DEFAULT_SYMMETRY_PLANE,
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

  // Absent, not an empty stop list — "never authored" is a distinct
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
describe("numPoints floor divergence", () => {
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

describe("setAdaptiveResolution", () => {
  it("toggles the adaptive-resolution governor immutably, defaulting to true", () => {
    const state = initialState(true);
    const next = setAdaptiveResolution(state, false);
    expect(next.adaptiveResolution).toBe(false);
    expect(state.adaptiveResolution).toBe(true);
  });
});

describe("setBalloonEcho", () => {
  it("toggles the balloon echo immutably, defaulting to off", () => {
    const state = initialState(true);
    const next = setBalloonEcho(state, true);
    expect(next.balloonEcho).toBe(true);
    expect(state.balloonEcho).toBe(false);
  });
});

describe("setBalloonRadius", () => {
  it("sets the balloon echo's radius immutably", () => {
    const state = initialState(true);
    const next = setBalloonRadius(state, 0.9);
    expect(next.balloonRadius).toBe(0.9);
    expect(state.balloonRadius).toBe(DEFAULT_BALLOON_RADIUS);
  });

  it("clamps above the maximum", () => {
    expect(setBalloonRadius(initialState(true), 999).balloonRadius).toBe(
      MAX_BALLOON_RADIUS,
    );
  });

  it("clamps below the minimum", () => {
    expect(setBalloonRadius(initialState(true), -5).balloonRadius).toBe(
      MIN_BALLOON_RADIUS,
    );
  });
});

describe("balloon palette document state", () => {
  it("registers inherit, every gradient built-in, and custom — never legacy", () => {
    expect(BALLOON_PALETTE_IDS).toEqual([
      "inherit",
      "spectrum",
      "sunset",
      "dusk",
      "lagoon",
      "ember",
      "aurora",
      "moss",
      "custom",
    ]);
    expect(BALLOON_PALETTE_IDS).not.toContain("legacy");
  });

  it("selects a built-in without changing any primary palette state", () => {
    const primaryStops = {
      stops: [
        [0.1, 0.2, 0.3],
        [0.9, 0.8, 0.7],
      ],
    } as const;
    const state = { ...initialState(true), customPalette: primaryStops };

    const next = setBalloonPaletteId(state, "aurora");

    expect(next.balloonPaletteId).toBe("aurora");
    expect(next.customPalette).toBe(primaryStops);
    expect(next.flame).toBe(state.flame);
    expect(next.solid).toBe(state.solid);
    expect(next.surface).toBe(state.surface);
  });

  it("resolves Inherit to null even with dormant balloon stops", () => {
    const state = {
      ...initialState(true),
      balloonCustomPalette: {
        stops: [
          [1, 0, 0],
          [0, 0, 1],
        ],
      },
    } as const;
    expect(resolveBalloonPalette(state)).toBeNull();
  });

  it("resolves built-in and Custom selections through the balloon slot", () => {
    expect(
      resolveBalloonPalette(setBalloonPaletteId(initialState(true), "aurora")),
    ).toBe("aurora");

    const balloonCustomPalette = {
      stops: [
        [1, 0, 0],
        [0, 0, 1],
      ],
    } as const;
    const primaryCustomPalette = {
      stops: [
        [0, 1, 0],
        [1, 1, 0],
      ],
    } as const;
    const state = {
      ...initialState(true),
      balloonPaletteId: "custom",
      balloonCustomPalette,
      customPalette: primaryCustomPalette,
    } as const;
    expect(resolveBalloonPalette(state)).toBe(balloonCustomPalette);
  });

  it("seeds a first Custom selection from Spectrum when replacing Inherit", () => {
    const next = setBalloonPaletteId(initialState(true), "custom");

    expect(next.balloonPaletteId).toBe("custom");
    expect(next.balloonCustomPalette).toEqual({
      stops: seedCustomStops("spectrum"),
    });
    expect(next.customPalette).toBeUndefined();
  });

  it("seeds a first Custom selection from the balloon built-in being replaced", () => {
    const state = setBalloonPaletteId(initialState(true), "ember");
    const next = setBalloonPaletteId(state, "custom");

    expect(next.balloonCustomPalette).toEqual({
      stops: seedCustomStops("ember"),
    });
  });

  it("preserves authored balloon stops while switching away and back", () => {
    const authored = setBalloonCustomPaletteStops(
      setBalloonPaletteId(initialState(true), "custom"),
      [
        [0.1, 0.2, 0.3],
        [0.9, 0.8, 0.7],
      ],
    );
    const away = setBalloonPaletteId(authored, "lagoon");
    const back = setBalloonPaletteId(away, "custom");

    expect(back.balloonCustomPalette).toBe(authored.balloonCustomPalette);
  });

  it("edits only balloon stops, with the primary custom slot untouched", () => {
    const primaryStops = {
      stops: [
        [1, 0, 0],
        [0, 1, 0],
      ],
    } as const;
    const state = { ...initialState(true), customPalette: primaryStops };
    const next = setBalloonCustomPaletteStops(state, [
      [-1, 0.5, 2],
      [0.2, -5, 1.5],
    ]);

    expect(next.balloonCustomPalette).toEqual({
      stops: [
        [0, 0.5, 1],
        [0.2, 0, 1],
      ],
    });
    expect(next.customPalette).toBe(primaryStops);
  });

  it("keeps balloon stops untouched when the primary custom slot is edited", () => {
    const balloonStops = {
      stops: [
        [0.1, 0.2, 0.3],
        [0.9, 0.8, 0.7],
      ],
    } as const;
    const state = { ...initialState(true), balloonCustomPalette: balloonStops };
    const next = setCustomPaletteStops(state, [
      [1, 0, 0],
      [0, 1, 0],
    ]);

    expect(next.balloonCustomPalette).toBe(balloonStops);
    expect(next.customPalette).toEqual({
      stops: [
        [1, 0, 0],
        [0, 1, 0],
      ],
    });
  });

  it("rejects invalid balloon stops with the same contract as the primary slot", () => {
    const state = initialState(true);
    expect(setBalloonCustomPaletteStops(state, [[0, 0, 0]])).toBe(state);
    expect(
      setBalloonCustomPaletteStops(state, [
        [0, 0, 0],
        [NaN, 1, 1],
      ]),
    ).toBe(state);
  });
});

describe("setBalloonTint", () => {
  it("sets the balloon tint color immutably", () => {
    const state = initialState(true);
    const next = setBalloonTint(state, "#336699");
    expect(next.balloonTint).toBe("#336699");
    expect(state.balloonTint).toBe(DEFAULT_BALLOON_TINT);
  });

  it("normalizes an uppercase hex string to lowercase", () => {
    expect(setBalloonTint(initialState(true), "#AABBCC").balloonTint).toBe(
      "#aabbcc",
    );
  });

  it("rejects a string with too few hex digits, leaving state unchanged", () => {
    const state = initialState(true);
    expect(setBalloonTint(state, "#abc").balloonTint).toBe(
      DEFAULT_BALLOON_TINT,
    );
    expect(setBalloonTint(state, "#abc")).toBe(state);
  });

  it("rejects a string with non-hex characters, leaving state unchanged", () => {
    const state = initialState(true);
    expect(setBalloonTint(state, "#zzzzzz")).toBe(state);
  });

  it("rejects a string missing the leading #, leaving state unchanged", () => {
    const state = initialState(true);
    expect(setBalloonTint(state, "336699")).toBe(state);
  });
});

describe("setBalloonTintStrength", () => {
  it("sets the balloon tint strength immutably", () => {
    const state = initialState(true);
    const next = setBalloonTintStrength(state, 0.5);
    expect(next.balloonTintStrength).toBe(0.5);
    expect(state.balloonTintStrength).toBe(DEFAULT_BALLOON_TINT_STRENGTH);
  });

  it("clamps above the maximum", () => {
    expect(
      setBalloonTintStrength(initialState(true), 999).balloonTintStrength,
    ).toBe(MAX_BALLOON_TINT_STRENGTH);
  });

  it("clamps below the minimum", () => {
    expect(
      setBalloonTintStrength(initialState(true), -5).balloonTintStrength,
    ).toBe(MIN_BALLOON_TINT_STRENGTH);
  });
});

describe("setGroundPlane", () => {
  it("toggles the ground plane immutably, defaulting to off", () => {
    const state = initialState(true);
    const next = setGroundPlane(state, true);
    expect(next.groundPlane).toBe(true);
    expect(state.groundPlane).toBe(false);
  });
});

describe("setExportScale", () => {
  it("sets the export scale immutably", () => {
    const state = initialState(true);
    const next = setExportScale(state, 4);
    expect(next.exportScale).toBe(4);
    expect(state.exportScale).toBe(1);
  });

  it("defaults to 1", () => {
    expect(initialState(true).exportScale).toBe(1);
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

  it("preserves the document-level balloon palette and its dormant custom stops", () => {
    const state = setBalloonCustomPaletteStops(
      setBalloonPaletteId(initialState(true), "custom"),
      [
        [0.1, 0.2, 0.3],
        [0.9, 0.8, 0.7],
      ],
    );
    const next = setTransforms(state, mengerSponge());

    expect(next.balloonPaletteId).toBe("custom");
    expect(next.balloonCustomPalette).toBe(state.balloonCustomPalette);
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

  // The single editor emits a `w` key only when its own working
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

describe("setTransformEmitter", () => {
  it("authors every canonical bundled mesh without touching other maps", () => {
    for (const shape of [
      STAR_PRISM_SHAPE,
      FACETED_CRYSTAL_SHAPE,
      HEART_PRISM_SHAPE,
      CRESCENT_MOON_SHAPE,
      SNOWFLAKE_PRISM_SHAPE,
      TREFOIL_KNOT_SHAPE,
    ]) {
      const state = initialState(true);
      const next = setTransformEmitter(state, 1, shape);

      expect(next.transforms[1].emitter).toBe(shape);
      expect(next.transforms[0]).toBe(state.transforms[0]);
      expect(state.transforms[1].emitter).toBeUndefined();
    }
  });

  it("switches shapes and clears back to true field absence", () => {
    const state = setTransformEmitter(initialState(true), 2, GEAR_SHAPE);
    const orbit = setTransformEmitter(state, 2, ORBIT_RING_SHAPE);
    expect(orbit.transforms[2].emitter).toBe(ORBIT_RING_SHAPE);
    const switched = setTransformEmitter(orbit, 2, PEACE_SIGN_SHAPE);
    expect(switched.transforms[2].emitter).toBe(PEACE_SIGN_SHAPE);

    const cleared = setTransformEmitter(switched, 2, null);
    expect(cleared.transforms[2].emitter).toBeUndefined();
    expect("emitter" in cleared.transforms[2]).toBe(false);
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

describe("renderer Quality detents", () => {
  it("pins the Points endpoints and default markup index", () => {
    expect(POINT_COUNT_DETENTS[0]).toBe(MIN_NUM_POINTS);
    expect(POINT_COUNT_DETENTS[POINT_COUNT_DETENTS.length - 1]).toBe(
      PARAM.numPoints.max,
    );
    expect(POINT_COUNT_DETENTS[6]).toBe(initialState(true).numPoints);
  });

  it("pins the Flame endpoints and default markup index", () => {
    expect(FLAME_ITERATION_DETENTS[0]).toBe(MIN_FLAME_ITERATIONS);
    expect(FLAME_ITERATION_DETENTS[FLAME_ITERATION_DETENTS.length - 1]).toBe(
      MAX_FLAME_ITERATIONS,
    );
    expect(FLAME_ITERATION_DETENTS[4]).toBe(DEFAULT_FLAME_ITERATIONS);
  });

  it("pins the Solid endpoints and default markup index", () => {
    expect(SOLID_ITERATION_DETENTS[0]).toBe(MIN_SOLID_ITERATIONS);
    expect(SOLID_ITERATION_DETENTS[SOLID_ITERATION_DETENTS.length - 1]).toBe(
      MAX_SOLID_ITERATIONS,
    );
    expect(SOLID_ITERATION_DETENTS[4]).toBe(DEFAULT_SOLID_ITERATIONS);
  });

  it("returns exact indexes for each budget family", () => {
    expect(nearestLogDetentIndex(100_000, POINT_COUNT_DETENTS)).toBe(6);
    expect(nearestFlameIterationDetentIndex(5_000_000)).toBe(2);
    expect(nearestLogDetentIndex(50_000_000, SOLID_ITERATION_DETENTS)).toBe(5);
  });

  it("snaps non-detent values to the nearer choice in log space", () => {
    // 37M sits between 2e7 (index 4) and 5e7 (index 5). Log10 distances are
    // 0.267 to 20M vs 0.131 to 50M, so it snaps up to index 5 — a plain
    // linear midpoint (35M) would also call this closer to 50M, but the two
    // rules disagree closer to the geometric mean (~31.6M), which is why the
    // comparison has to be logarithmic, not linear.
    expect(nearestLogDetentIndex(37_000, POINT_COUNT_DETENTS)).toBe(5);
    expect(nearestFlameIterationDetentIndex(37_000_000)).toBe(5);
    expect(nearestLogDetentIndex(37_000_000, SOLID_ITERATION_DETENTS)).toBe(5);
  });

  it.each([
    [POINT_COUNT_DETENTS, 1, 10_000_000],
    [FLAME_ITERATION_DETENTS, 1, 10_000_000_000],
    [SOLID_ITERATION_DETENTS, 1, 1_000_000_000],
  ] as const)(
    "clamps values outside %# to the endpoint indexes",
    (detents, low, high) => {
      expect(nearestLogDetentIndex(low, detents)).toBe(0);
      expect(nearestLogDetentIndex(high, detents)).toBe(detents.length - 1);
    },
  );
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

  // The first switch to Custom seeds a tweakable copy of whatever
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

  it("leaves the flame/solid/surface settings untouched", () => {
    const state = initialState(true);
    const next = setRenderMode(state, "flame");
    expect(next.flame).toBe(state.flame);
    expect(next.solid).toBe(state.solid);
    expect(next.surface).toBe(state.surface);
  });

  it.each(["points", "flame", "solid", "surface"] as const)(
    "preserves numbered and final-transform editor selections when switching to %s",
    (renderMode) => {
      const numbered = selectTransform(initialState(true), 2);
      expect(setRenderMode(numbered, renderMode).selectedTransform).toBe(2);

      const withFinal = setFinalTransform(
        initialState(true),
        defaultFinalTransform(),
      );
      const final = selectTransform(withFinal, "final");
      expect(setRenderMode(final, renderMode).selectedTransform).toBe("final");
    },
  );
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

  // The solid twin of setFlamePaletteId's seeding test — "moss", not
  // the "spectrum" default, to prove it seeds from the ACTUAL previous SOLID
  // id (independent of the flame palette's own selection).
  it("seeds customPalette from the previous solid palette on first switch to custom", () => {
    const state = setSolidPaletteId(initialState(true), "moss");
    const next = setSolidPaletteId(state, "custom");
    expect(next.solid.paletteId).toBe("custom");
    expect(next.customPalette).toEqual({ stops: seedCustomStops("moss") });
  });
});

describe("setSurfaceLightAzimuth", () => {
  it("sets the light's horizontal angle immutably", () => {
    const state = initialState(true);
    const next = setSurfaceLightAzimuth(state, -90);
    expect(next.surface.lightAzimuth).toBe(-90);
    expect(state.surface.lightAzimuth).toBe(DEFAULT_SOLID_LIGHT_AZIMUTH);
  });

  it("clamps above the maximum", () => {
    expect(
      setSurfaceLightAzimuth(initialState(true), 999).surface.lightAzimuth,
    ).toBe(MAX_SOLID_LIGHT_AZIMUTH);
  });

  it("clamps below the minimum", () => {
    expect(
      setSurfaceLightAzimuth(initialState(true), -999).surface.lightAzimuth,
    ).toBe(MIN_SOLID_LIGHT_AZIMUTH);
  });
});

describe("setSurfaceAntialiasSamples", () => {
  it("sets a supported sample count immutably", () => {
    const state = initialState(true);
    const next = setSurfaceAntialiasSamples(state, 16);

    expect(next.surface.antialiasSamples).toBe(16);
    expect(state.surface.antialiasSamples).toBe(
      DEFAULT_SURFACE_ANTIALIAS_SAMPLES,
    );
  });

  it("snaps an unsupported count to the nearest UI detent", () => {
    expect(
      setSurfaceAntialiasSamples(initialState(true), 7).surface
        .antialiasSamples,
    ).toBe(8);
    expect(SURFACE_ANTIALIAS_DETENTS).toEqual([1, 2, 4, 8, 16]);
  });
});

describe("setSurfaceLightElevation", () => {
  it("sets the light's elevation immutably", () => {
    const state = initialState(true);
    const next = setSurfaceLightElevation(state, 70);
    expect(next.surface.lightElevation).toBe(70);
    expect(state.surface.lightElevation).toBe(DEFAULT_SOLID_LIGHT_ELEVATION);
  });

  it("clamps above the maximum", () => {
    expect(
      setSurfaceLightElevation(initialState(true), 999).surface.lightElevation,
    ).toBe(MAX_SOLID_LIGHT_ELEVATION);
  });

  it("clamps below the minimum", () => {
    expect(
      setSurfaceLightElevation(initialState(true), -999).surface.lightElevation,
    ).toBe(MIN_SOLID_LIGHT_ELEVATION);
  });
});

describe("setSurfaceAmbient", () => {
  it("sets the ambient floor immutably", () => {
    const state = initialState(true);
    const next = setSurfaceAmbient(state, 0.5);
    expect(next.surface.ambient).toBe(0.5);
    expect(state.surface.ambient).toBe(DEFAULT_SOLID_AMBIENT);
  });

  it("clamps above the maximum", () => {
    expect(setSurfaceAmbient(initialState(true), 5).surface.ambient).toBe(
      MAX_SOLID_AMBIENT,
    );
  });

  it("clamps below the minimum", () => {
    expect(setSurfaceAmbient(initialState(true), -5).surface.ambient).toBe(
      MIN_SOLID_AMBIENT,
    );
  });
});

describe("setSurfaceColorSpeed", () => {
  it("clamps above the maximum", () => {
    expect(setSurfaceColorSpeed(initialState(true), 5).surface.colorSpeed).toBe(
      MAX_SURFACE_COLOR_SPEED,
    );
  });

  it("clamps below the minimum", () => {
    expect(
      setSurfaceColorSpeed(initialState(true), -5).surface.colorSpeed,
    ).toBe(MIN_SURFACE_COLOR_SPEED);
  });

  it("leaves the other surface params untouched", () => {
    const state = initialState(true);
    const next = setSurfaceColorSpeed(state, 0.9);
    expect(next.surface.lightAzimuth).toBe(state.surface.lightAzimuth);
    expect(next.surface.lightElevation).toBe(state.surface.lightElevation);
    expect(next.surface.ambient).toBe(state.surface.ambient);
    expect(next.surface.colorSource).toBe(state.surface.colorSource);
    expect(next.surface.paletteId).toBe(state.surface.paletteId);
  });
});

describe("setSurfaceEnvLight", () => {
  it("sets the environment-light strength immutably", () => {
    const state = initialState(true);
    const next = setSurfaceEnvLight(state, 0.9);
    expect(next.surface.envLight).toBe(0.9);
    expect(state.surface.envLight).toBe(DEFAULT_SURFACE_ENV_LIGHT);
  });

  it("clamps above the maximum", () => {
    expect(setSurfaceEnvLight(initialState(true), 5).surface.envLight).toBe(
      MAX_SURFACE_ENV_LIGHT,
    );
  });

  it("clamps below the minimum", () => {
    expect(setSurfaceEnvLight(initialState(true), -5).surface.envLight).toBe(
      MIN_SURFACE_ENV_LIGHT,
    );
  });
});

describe("setSurfaceColorSource", () => {
  it("sets the color source immutably", () => {
    const state = initialState(true);
    const next = setSurfaceColorSource(state, "palette");
    expect(next.surface.colorSource).toBe("palette");
    expect(state.surface.colorSource).toBe("transform");
  });

  it("leaves the other surface params untouched", () => {
    const state = initialState(true);
    const next = setSurfaceColorSource(state, "height");
    expect(next.surface.lightAzimuth).toBe(state.surface.lightAzimuth);
    expect(next.surface.ambient).toBe(state.surface.ambient);
    expect(next.surface.paletteId).toBe(state.surface.paletteId);
  });
});

describe("setSurfacePaletteId", () => {
  it("sets the palette id immutably", () => {
    const state = initialState(true);
    // "aurora", not the "spectrum" default — a no-op write couldn't prove
    // immutability.
    const next = setSurfacePaletteId(state, "aurora");
    expect(next.surface.paletteId).toBe("aurora");
    expect(state.surface.paletteId).toBe(DEFAULT_SOLID_PALETTE);
  });

  it("leaves the other surface params untouched", () => {
    const state = initialState(true);
    const next = setSurfacePaletteId(state, "ember");
    expect(next.surface.lightAzimuth).toBe(state.surface.lightAzimuth);
    expect(next.surface.lightElevation).toBe(state.surface.lightElevation);
    expect(next.surface.ambient).toBe(state.surface.ambient);
    expect(next.surface.colorSource).toBe(state.surface.colorSource);
  });

  // The surface twin of setSolidPaletteId's seeding test — "moss",
  // not the "spectrum" default, to prove it seeds from the ACTUAL previous
  // SURFACE id (independent of the flame/solid palettes' own selections).
  it("seeds customPalette from the previous surface palette on first switch to custom", () => {
    const state = setSurfacePaletteId(initialState(true), "moss");
    const next = setSurfacePaletteId(state, "custom");
    expect(next.surface.paletteId).toBe("custom");
    expect(next.customPalette).toEqual({ stops: seedCustomStops("moss") });
  });
});

describe("setCustomPaletteStops", () => {
  it("seeds once from the first primary consumer and never re-seeds for the other four", () => {
    const rampPreset = setRampPaletteId(initialState(true), "ember");
    const seeded = setRampPaletteId(rampPreset, "custom");
    const shared = seeded.customPalette;

    const everyConsumer = setBackgroundFlamePaletteId(
      setSurfacePaletteId(
        setSolidPaletteId(setFlamePaletteId(seeded, "custom"), "custom"),
        "custom",
      ),
      "custom",
    );

    expect(shared).toEqual({ stops: seedCustomStops("ember") });
    expect(everyConsumer.customPalette).toBe(shared);
    expect(everyConsumer.rampPaletteId).toBe("custom");
    expect(everyConsumer.flame.paletteId).toBe("custom");
    expect(everyConsumer.solid.paletteId).toBe("custom");
    expect(everyConsumer.surface.paletteId).toBe("custom");
    expect(everyConsumer.background.flamePaletteId).toBe("custom");
    expect(everyConsumer.balloonCustomPalette).toBeUndefined();
  });

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

  it("leaves the plane and the rest of state untouched", () => {
    const state = initialState(true);
    const next = setSymmetryOrder(state, 6);
    expect(next.symmetry.plane).toBe(state.symmetry.plane);
    expect(next.transforms).toBe(state.transforms);
    expect(next.flame).toBe(state.flame);
  });

  // setSymmetryTwist's cap is against the order at the time of the
  // twist edit, so lowering the order has to re-apply it — otherwise the live
  // render draws a twist persist.ts's decoder caps away on reload.
  it("re-caps a twist the lowered order no longer allows", () => {
    const twisted = setSymmetryTwist(
      setSymmetryOrder(initialState(true), 12),
      7,
    );
    expect(setSymmetryOrder(twisted, 3).symmetry.twist).toBe(2);
  });

  it("drops the twist to absent when the lowered order leaves room for none", () => {
    const twisted = setSymmetryTwist(
      setSymmetryOrder(initialState(true), 6),
      4,
    );
    expect("twist" in setSymmetryOrder(twisted, 1).symmetry).toBe(false);
  });

  it("leaves a twist the new order still allows untouched", () => {
    const twisted = setSymmetryTwist(
      setSymmetryOrder(initialState(true), 12),
      2,
    );
    expect(setSymmetryOrder(twisted, 5).symmetry.twist).toBe(2);
  });

  it("never materializes a twist field on a system that had none", () => {
    const state = setSymmetryOrder(initialState(true), 8);
    expect("twist" in setSymmetryOrder(state, 4).symmetry).toBe(false);
  });
});

describe("setSymmetryPlane", () => {
  it("sets the plane immutably", () => {
    const state = initialState(true);
    const next = setSymmetryPlane(state, "yz");
    expect(next.symmetry.plane).toBe("yz");
    expect(state.symmetry.plane).toBe(DEFAULT_SYMMETRY_PLANE);
  });

  it("leaves the order and the rest of state untouched", () => {
    const state = initialState(true);
    const next = setSymmetryPlane(state, "xy");
    expect(next.symmetry.order).toBe(state.symmetry.order);
    expect(next.transforms).toBe(state.transforms);
    expect(next.flame).toBe(state.flame);
  });

  it("makes the system non-flat when the plane mixes w", () => {
    const state = setSymmetryOrder(initialState(true), 4);
    expect(systemIsNonFlat(state)).toBe(false);
    expect(systemIsNonFlat(setSymmetryPlane(state, "zw"))).toBe(true);
  });

  it("leaves an order-1 system flat even in a w-plane", () => {
    const state = initialState(true);
    expect(state.symmetry.order).toBe(1);
    expect(systemIsNonFlat(setSymmetryPlane(state, "zw"))).toBe(false);
  });
});

describe("setSymmetryTwist", () => {
  it("stores a twist immutably", () => {
    const state = setSymmetryOrder(initialState(true), 6);
    const next = setSymmetryTwist(state, 2);
    expect(next.symmetry.twist).toBe(2);
    expect(state.symmetry.twist).toBeUndefined();
  });

  it("caps the twist at the current order's last distinct value", () => {
    const state = setSymmetryOrder(initialState(true), 4);
    expect(setSymmetryTwist(state, 9).symmetry.twist).toBe(3);
  });

  it("drops a zero twist to an absent field", () => {
    const state = setSymmetryTwist(setSymmetryOrder(initialState(true), 6), 2);
    expect("twist" in setSymmetryTwist(state, 0).symmetry).toBe(false);
  });

  it("makes the system non-flat at order > 1", () => {
    const state = setSymmetryOrder(initialState(true), 5);
    expect(systemIsNonFlat(setSymmetryTwist(state, 1))).toBe(true);
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

describe("setFogDensity", () => {
  it("sets the fog density multiplier immutably", () => {
    const state = initialState(true);
    const next = setFogDensity(state, 0.5);
    expect(next.fogDensity).toBe(0.5);
    expect(state.fogDensity).toBe(DEFAULT_FOG_DENSITY);
  });

  it("clamps above the maximum", () => {
    expect(setFogDensity(initialState(true), 999).fogDensity).toBe(
      MAX_FOG_DENSITY,
    );
  });

  it("clamps below the minimum (0 disables fog, never negative)", () => {
    expect(setFogDensity(initialState(true), -5).fogDensity).toBe(
      MIN_FOG_DENSITY,
    );
  });
});

describe("setFogTint", () => {
  it("sets the fog tint color immutably", () => {
    const state = initialState(true);
    const next = setFogTint(state, "#336699");
    expect(next.fogTint).toBe("#336699");
    expect(state.fogTint).toBe(DEFAULT_FOG_TINT);
  });

  it("normalizes an uppercase hex string to lowercase", () => {
    expect(setFogTint(initialState(true), "#AABBCC").fogTint).toBe("#aabbcc");
  });

  it("rejects a string with too few hex digits, leaving state unchanged", () => {
    const state = initialState(true);
    expect(setFogTint(state, "#abc").fogTint).toBe(DEFAULT_FOG_TINT);
    expect(setFogTint(state, "#abc")).toBe(state);
  });

  it("rejects a string with non-hex characters, leaving state unchanged", () => {
    const state = initialState(true);
    expect(setFogTint(state, "#zzzzzz")).toBe(state);
  });

  it("rejects a string missing the leading #, leaving state unchanged", () => {
    const state = initialState(true);
    expect(setFogTint(state, "336699")).toBe(state);
  });
});

describe("setFogTintStrength", () => {
  it("sets the fog tint strength immutably", () => {
    const state = initialState(true);
    const next = setFogTintStrength(state, 0.5);
    expect(next.fogTintStrength).toBe(0.5);
    expect(state.fogTintStrength).toBe(DEFAULT_FOG_TINT_STRENGTH);
  });

  it("clamps above the maximum", () => {
    expect(setFogTintStrength(initialState(true), 999).fogTintStrength).toBe(
      MAX_FOG_TINT_STRENGTH,
    );
  });

  it("clamps below the minimum", () => {
    expect(setFogTintStrength(initialState(true), -5).fogTintStrength).toBe(
      MIN_FOG_TINT_STRENGTH,
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

  it("leaves the flame/solid/surface palette ids untouched", () => {
    const state = initialState(true);
    const next = setRampPaletteId(state, "ember");
    expect(next.flame.paletteId).toBe(state.flame.paletteId);
    expect(next.solid.paletteId).toBe(state.solid.paletteId);
    expect(next.surface.paletteId).toBe(state.surface.paletteId);
  });

  // The first switch to Custom seeds a tweakable copy of whatever
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

describe("initialState background", () => {
  it("boots with the dark background and no authored custom slot", () => {
    expect(initialState(true).background).toEqual({ mode: "dark" });
  });
});

describe("setBackgroundMode", () => {
  it("switches the mode immutably", () => {
    const state = initialState(true);
    const next = setBackgroundMode(state, "haze");
    expect(next.background.mode).toBe("haze");
    expect(state.background.mode).toBe("dark");
  });

  it("selects the generated flame mode without adding image state", () => {
    const next = setBackgroundMode(initialState(true), "flame");

    expect(next.background).toEqual({ mode: "flame" });
  });

  it("seeds the custom slot from the dark backdrop's resolved stops on first switch to custom", () => {
    const state = initialState(true);
    const next = setBackgroundMode(state, "custom");
    expect(next.background.mode).toBe("custom");
    expect(next.background.custom).toEqual(resolveBackground({ mode: "dark" }));
  });

  it("seeds the custom slot from the haze backdrop's resolved stops on first switch to custom", () => {
    const state = setBackgroundMode(initialState(true), "haze");
    const next = setBackgroundMode(state, "custom");
    expect(next.background.custom).toEqual(resolveBackground({ mode: "haze" }));
  });

  // An "auto" predecessor's seed is the DERIVED stops (the palette
  // the scene was actually showing), not a flat built-in gradient — "sunset",
  // not a default palette, so a wrong (e.g. always-spectrum) derivation would
  // fail this rather than accidentally matching.
  it("seeds the custom slot from the auto-derived stops on first switch to custom", () => {
    const state = setBackgroundMode(
      setFlamePaletteId(setRenderMode(initialState(true), "flame"), "sunset"),
      "auto",
    );
    const next = setBackgroundMode(state, "custom");
    expect(next.background.custom).toEqual(autoBackground("sunset"));
  });

  it("keeps the existing custom stops instead of re-seeding when selecting custom again", () => {
    const seeded = setBackgroundMode(initialState(true), "custom");
    const authored = {
      top: [0.1, 0.2, 0.3],
      bottom: [0.9, 0.8, 0.7],
    } as const;
    const withCustom = setBackgroundCustom(seeded, authored);
    const next = setBackgroundMode(withCustom, "custom");
    expect(next.background.custom).toEqual(authored);
  });

  it("keeps the authored custom payload when switching away to haze", () => {
    const seeded = setBackgroundMode(initialState(true), "custom");
    const authored = {
      top: [0.1, 0.2, 0.3],
      bottom: [0.9, 0.8, 0.7],
    } as const;
    const withCustom = setBackgroundCustom(seeded, authored);
    const next = setBackgroundMode(withCustom, "haze");
    expect(next.background.mode).toBe("haze");
    expect(next.background.custom).toEqual(authored);
  });

  it("keeps authored custom colors and shape dormant while flame is selected", () => {
    const state = setBackgroundShape(
      setBackgroundCustom(setBackgroundMode(initialState(true), "custom"), {
        top: [0.1, 0.2, 0.3],
        bottom: [0.9, 0.8, 0.7],
      }),
      "radial",
    );

    const next = setBackgroundMode(state, "flame");

    expect(next.background).toEqual({
      mode: "flame",
      custom: {
        top: [0.1, 0.2, 0.3],
        bottom: [0.9, 0.8, 0.7],
      },
      shape: "radial",
    });
  });

  it("seeds a never-authored custom slot from flame mode's dark placeholder", () => {
    const flame = setBackgroundMode(initialState(true), "flame");

    const next = setBackgroundMode(flame, "custom");

    expect(next.background.custom).toEqual(resolveBackground({ mode: "dark" }));
  });
});

describe("setBackgroundCustom", () => {
  it("replaces the custom payload while preserving mode, immutably", () => {
    const state = setBackgroundMode(initialState(true), "custom");
    const authored = {
      top: [0.9, 0.8, 0.7],
      bottom: [0.1, 0.2, 0.3],
    } as const;
    const next = setBackgroundCustom(state, authored);
    expect(next.background).toEqual({ mode: "custom", custom: authored });
    expect(state.background.custom).not.toEqual(authored);
  });
});

describe("setBackgroundShape", () => {
  it("sets the shape while preserving mode/custom, immutably", () => {
    const state = setBackgroundMode(initialState(true), "haze");
    const next = setBackgroundShape(state, "radial");
    expect(next.background).toEqual({ mode: "haze", shape: "radial" });
    expect(state.background).not.toHaveProperty("shape");
  });
});

describe("setBackgroundFlamePaletteId", () => {
  it("authors a backdrop-owned palette without changing its mode", () => {
    const state = setBackgroundMode(initialState(true), "flame");
    const next = setBackgroundFlamePaletteId(state, "aurora");

    expect(next.background).toEqual({
      mode: "flame",
      flamePaletteId: "aurora",
    });
    expect(state.background).toEqual({ mode: "flame" });
  });

  it("keeps the palette dormant when another backdrop mode is selected", () => {
    const authored = setBackgroundFlamePaletteId(initialState(true), "ember");
    const next = setBackgroundMode(authored, "haze");

    expect(next.background).toEqual({
      mode: "haze",
      flamePaletteId: "ember",
    });
  });

  it("seeds a first Custom selection from the backdrop palette being replaced", () => {
    const authored = setBackgroundFlamePaletteId(initialState(true), "sunset");
    const next = setBackgroundFlamePaletteId(authored, "custom");

    expect(next.background.flamePaletteId).toBe("custom");
    expect(next.customPalette?.stops).toEqual(seedCustomStops("sunset"));
  });
});

describe("resolveFlameBackdropPalette", () => {
  it("defaults to Spectrum instead of the points renderer's Transform palette", () => {
    const state = setBackgroundMode(initialState(true), "flame");

    expect(state.rampPaletteId).toBe("legacy");
    expect(resolveFlameBackdropPalette(state)).toBe(DEFAULT_FLAME_PALETTE);
  });

  it("uses the backdrop-owned palette independently of the active renderer", () => {
    const state = setRenderMode(
      setBackgroundFlamePaletteId(initialState(true), "lagoon"),
      "surface",
    );

    expect(activeScenePalette(state)).toBe(state.surface.paletteId);
    expect(resolveFlameBackdropPalette(state)).toBe("lagoon");
  });

  it("resolves the backdrop's Custom selection to the shared authored stops", () => {
    const state = setBackgroundFlamePaletteId(initialState(true), "custom");

    expect(resolveFlameBackdropPalette(state)).toBe(state.customPalette);
  });
});

describe("activeScenePalette", () => {
  it("returns the ramp palette id in points mode", () => {
    expect(activeScenePalette(initialState(true))).toBe("legacy");
  });

  it("returns the flame palette id in flame mode", () => {
    const state = setRenderMode(
      setFlamePaletteId(initialState(true), "aurora"),
      "flame",
    );
    expect(activeScenePalette(state)).toBe("aurora");
  });

  it("returns the solid palette id in solid mode", () => {
    const state = setRenderMode(
      setSolidPaletteId(initialState(true), "ember"),
      "solid",
    );
    expect(activeScenePalette(state)).toBe("ember");
  });

  it("returns the surface palette id in surface mode", () => {
    const state = setRenderMode(
      setSurfacePaletteId(initialState(true), "moss"),
      "surface",
    );
    expect(activeScenePalette(state)).toBe("moss");
  });

  it("resolves a custom selection to the customPalette payload object", () => {
    const flameMode = setRenderMode(initialState(true), "flame");
    const state = setFlamePaletteId(flameMode, "custom");
    expect(activeScenePalette(state)).toBe(state.customPalette);
  });
});

describe("resolveSceneBackground", () => {
  it("resolves the dark stops for the initial state", () => {
    expect(resolveSceneBackground(initialState(true))).toEqual(
      resolveBackground({ mode: "dark" }),
    );
  });

  it("derives from the active render's palette when the background mode is auto", () => {
    const state = setBackgroundMode(
      setFlamePaletteId(setRenderMode(initialState(true), "flame"), "sunset"),
      "auto",
    );
    expect(resolveSceneBackground(state)).toEqual(autoBackground("sunset"));
  });

  // The fresh-scene case: points mode's rampPaletteId defaults to "legacy",
  // which has no gradient to derive from, so auto mode falls back to dark —
  // a brand-new scene never opens on a backdrop that hasn't rendered yet.
  it("falls back to the dark stops for a fresh scene's auto mode (legacy ramp palette)", () => {
    const state = setBackgroundMode(initialState(true), "auto");
    expect(resolveSceneBackground(state)).toEqual(
      resolveBackground({ mode: "dark" }),
    );
  });
});

describe("setSchedule / setScheduleDepth (scheduled-hybrid block)", () => {
  const bSource: Transform[] = [
    {
      id: 7,
      position: [-0.5, 0, 0],
      rotation: [0, 0, 0],
      scale: [0.5, 0.5, 0.5],
      weight: 3,
      shear: [0.1, 0, 0],
      variations: [{ type: "julia", weight: 1 }],
      colorIndex: 0.25,
      chaos: [0, 1],
      w: { position: 0.5 },
    },
    {
      id: 9,
      position: [0.5, 0, 0],
      rotation: [0, 0, 0],
      scale: [0.5, 0.5, 0.5],
    },
  ];

  it("installs a stripped, affine-only block immutably", () => {
    const state = initialState(true);
    const next = setSchedule(state, { transforms: bSource, depth: 3 });
    expect(state.schedule).toBeUndefined();
    const schedule = next.schedule!;
    expect(schedule.depth).toBe(3);
    // Every non-affine field is gone; ids reassigned by index; weight and
    // non-zero shear survive.
    expect(schedule.transforms).toEqual([
      {
        id: 0,
        position: [-0.5, 0, 0],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0.5],
        weight: 3,
        shear: [0.1, 0, 0],
      },
      {
        id: 1,
        position: [0.5, 0, 0],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0.5],
      },
    ]);
  });

  it("stores ABSENT for null, empty B, and depth <= 0 — the classic-removal rule", () => {
    const installed = setSchedule(initialState(true), {
      transforms: bSource,
      depth: 2,
    });
    expect(setSchedule(installed, null).schedule).toBeUndefined();
    expect(
      setSchedule(installed, { transforms: [], depth: 2 }).schedule,
    ).toBeUndefined();
    expect(
      setSchedule(installed, { transforms: bSource, depth: 0 }).schedule,
    ).toBeUndefined();
  });

  it("clamps and floors depth through the one domain", () => {
    const state = initialState(true);
    expect(
      setSchedule(state, { transforms: bSource, depth: 99 }).schedule!.depth,
    ).toBe(5);
    expect(
      setSchedule(state, { transforms: bSource, depth: 2.9 }).schedule!.depth,
    ).toBe(2);
  });

  it("setScheduleDepth moves the installed block's depth, removes at 0, and no-ops without a block", () => {
    const installed = setSchedule(initialState(true), {
      transforms: bSource,
      depth: 2,
    });
    expect(setScheduleDepth(installed, 4).schedule!.depth).toBe(4);
    expect(setScheduleDepth(installed, 0).schedule).toBeUndefined();
    const bare = initialState(true);
    expect(setScheduleDepth(bare, 3)).toBe(bare);
  });

  it("stripScheduleTransform copies vectors rather than aliasing the source", () => {
    const stripped = stripScheduleTransform(bSource[0], 0);
    expect(stripped.position).toEqual(bSource[0].position);
    expect(stripped.position).not.toBe(bSource[0].position);
    expect(stripped.shear).not.toBe(bSource[0].shear);
  });
});

describe("setCondensationDepthBand", () => {
  const base = initialState(true);

  it("stores a sorted inclusive finite band", () => {
    expect(
      setCondensationDepthBand(base, { minDepth: 5.9, maxDepth: 2.2 })
        .condensationDepthBand,
    ).toEqual({ minDepth: 2, maxDepth: 5 });
    expect(
      setCondensationDepthBand(base, { maxDepth: -3 }).condensationDepthBand,
    ).toEqual({ maxDepth: 0 });
  });

  it("stores the classic all-depth range as absence and clears with null", () => {
    const authored = setCondensationDepthBand(base, { maxDepth: 4 });
    expect(setCondensationDepthBand(authored, null).condensationDepthBand).toBe(
      undefined,
    );
    expect(
      setCondensationDepthBand(base, { minDepth: 0 }).condensationDepthBand,
    ).toBeUndefined();
  });
});

/** A generic, contracting (scale 0.5) transform list for the Xaos tests
 * below — real enough that `conjugateApart` (inside `appendXaosBlock`)
 * actually moves something, unlike an identity-linear map. */
function makeXaosTransforms(count: number): Transform[] {
  return Array.from({ length: count }, (_, id) => ({
    id,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [0.5, 0.5, 0.5],
  }));
}

describe("detectXaosBlocks", () => {
  it("reads an untouched system as one block", () => {
    expect(detectXaosBlocks(makeXaosTransforms(4))).toEqual([[0, 1, 2, 3]]);
  });

  it("splits a block-diagonal system exactly along its chaos rows", () => {
    const transforms = makeXaosTransforms(4).map((t, i): Transform => ({
      ...t,
      chaos: i < 2 ? [1, 1, 0, 0] : [0, 0, 1, 1],
    }));
    expect(detectXaosBlocks(transforms)).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  it("requires BOTH directions to read 1 before merging — an asymmetric edit stays split", () => {
    const transforms = makeXaosTransforms(2).map((t, i): Transform => ({
      ...t,
      chaos: i === 0 ? [1, 1] : [0, 1],
    }));
    expect(detectXaosBlocks(transforms)).toEqual([[0], [1]]);
  });

  it("recovers the xaos reachability preset's own block structure", () => {
    expect(detectXaosBlocks(fernSpongeIsolated())).toEqual([
      [0, 1, 2, 3],
      Array.from({ length: 20 }, (_, i) => i + 4),
    ]);
  });

  it("a leak short of 1 does not merge the blocks it connects", () => {
    expect(detectXaosBlocks(fernSpongeLeak())).toEqual([
      [0, 1, 2, 3],
      Array.from({ length: 20 }, (_, i) => i + 4),
    ]);
  });
});

describe("detectXaosLeaks", () => {
  it("reads a uniform leak value between two blocks", () => {
    const transforms = makeXaosTransforms(4).map((t, i): Transform => ({
      ...t,
      chaos: i < 2 ? [1, 1, 0.02, 0.02] : [0.02, 0.02, 1, 1],
    }));
    const blocks = detectXaosBlocks(transforms);
    const leaks = detectXaosLeaks(transforms, blocks);
    expect(leaks).toEqual([{ blockA: [0, 1], blockB: [2, 3], value: 0.02 }]);
  });

  it("reads null when a pair's cross entries are not uniform", () => {
    const transforms = makeXaosTransforms(4).map((t, i): Transform => ({
      ...t,
      chaos:
        i === 0
          ? [1, 1, 0.02, 0.05] // one hand-edited entry differs
          : i < 2
            ? [1, 1, 0.02, 0.02]
            : [0.02, 0.02, 1, 1],
    }));
    const blocks = detectXaosBlocks(transforms);
    const leaks = detectXaosLeaks(transforms, blocks);
    expect(leaks).toHaveLength(1);
    expect(leaks[0].value).toBeNull();
  });

  it("reads the xaos reachability presets' own 0 and 1% leaks", () => {
    const isoBlocks = detectXaosBlocks(fernSpongeIsolated());
    expect(detectXaosLeaks(fernSpongeIsolated(), isoBlocks)[0].value).toBe(0);
    const leakBlocks = detectXaosBlocks(fernSpongeLeak());
    expect(detectXaosLeaks(fernSpongeLeak(), leakBlocks)[0].value).toBeCloseTo(
      0.01,
    );
  });

  it("returns nothing for fewer than two blocks", () => {
    const transforms = makeXaosTransforms(3);
    expect(detectXaosLeaks(transforms, detectXaosBlocks(transforms))).toEqual(
      [],
    );
  });
});

describe("setChaosCell", () => {
  it("materializes a row only on first touch, padding with 1s, leaving every other transform untouched", () => {
    const state = { ...initialState(true), transforms: makeXaosTransforms(3) };
    const next = setChaosCell(state, 0, 2, 0.4);
    expect(next.transforms[0].chaos).toEqual([1, 1, 0.4]);
    expect(next.transforms[1]).toBe(state.transforms[1]);
    expect(next.transforms[2]).toBe(state.transforms[2]);
  });

  it("editing a row back to all-1s removes it — chaosRowIsNonTrivial is the one predicate", () => {
    const state = { ...initialState(true), transforms: makeXaosTransforms(2) };
    const touched = setChaosCell(state, 0, 1, 0.5);
    expect(touched.transforms[0].chaos).toEqual([1, 0.5]);
    const restored = setChaosCell(touched, 0, 1, 1);
    expect(restored.transforms[0].chaos).toBeUndefined();
  });

  it("writing the classic value on an untouched system stays byte-identical", () => {
    const state = { ...initialState(true), transforms: makeXaosTransforms(2) };
    expect(setChaosCell(state, 0, 1, 1).transforms[0].chaos).toBeUndefined();
  });

  it("stores a raw out-of-domain value faithfully — the domain lives at resolveChaosEntry, not here", () => {
    const state = { ...initialState(true), transforms: makeXaosTransforms(2) };
    const next = setChaosCell(state, 0, 1, -3);
    expect(next.transforms[0].chaos).toEqual([1, -3]);
    expect(chaosRowIsNonTrivial(next.transforms[0].chaos, 2)).toBe(true);
  });

  it("no-ops on an out-of-range index", () => {
    const state = { ...initialState(true), transforms: makeXaosTransforms(2) };
    expect(setChaosCell(state, 5, 0, 0.5)).toBe(state);
    expect(setChaosCell(state, 0, -1, 0.5)).toBe(state);
  });
});

describe("setChaosLeak", () => {
  it("writes both directions between two blocks, leaving within-block entries untouched", () => {
    const state = {
      ...initialState(true),
      transforms: makeXaosTransforms(4).map((t, i): Transform => ({
        ...t,
        chaos: i < 2 ? [1, 1, 0, 0] : [0, 0, 1, 1],
      })),
    };
    const next = setChaosLeak(state, [0, 1], [2, 3], 0.3);
    expect(next.transforms[0].chaos).toEqual([1, 1, 0.3, 0.3]);
    expect(next.transforms[1].chaos).toEqual([1, 1, 0.3, 0.3]);
    expect(next.transforms[2].chaos).toEqual([0.3, 0.3, 1, 1]);
    expect(next.transforms[3].chaos).toEqual([0.3, 0.3, 1, 1]);
  });

  it("dragging the leak to 1 (full merge) removes rows whose only asymmetry was the leak", () => {
    const state = {
      ...initialState(true),
      transforms: makeXaosTransforms(2).map((t, i): Transform => ({
        ...t,
        chaos: i === 0 ? [1, 0] : [0, 1],
      })),
    };
    const next = setChaosLeak(state, [0], [1], 1);
    expect(next.transforms[0].chaos).toBeUndefined();
    expect(next.transforms[1].chaos).toBeUndefined();
  });

  it("preserves finer structure nested inside a block being leaked against another", () => {
    // Block A = {0}; block B is itself two sub-blocks, {1} and {2},
    // isolated from each other.
    const state = {
      ...initialState(true),
      transforms: makeXaosTransforms(3).map((t, i): Transform => ({
        ...t,
        chaos: [i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0],
      })),
    };
    const next = setChaosLeak(state, [0], [1, 2], 0.2);
    expect(next.transforms[0].chaos).toEqual([1, 0.2, 0.2]);
    expect(next.transforms[1].chaos).toEqual([0.2, 1, 0]);
    expect(next.transforms[2].chaos).toEqual([0.2, 0, 1]);
  });
});

describe("computeXaosBlockOffset", () => {
  it("is deterministic, finite, and positive for two real systems", () => {
    const a = computeXaosBlockOffset(barnsleyFern(), mengerSponge());
    const b = computeXaosBlockOffset(barnsleyFern(), mengerSponge());
    expect(a).toBe(b);
    expect(Number.isFinite(a)).toBe(true);
    expect(a).toBeGreaterThan(0);
  });
});

describe("appendXaosBlock", () => {
  it("appends, seats the new block apart along x, and writes block-structured rows", () => {
    const existing = makeXaosTransforms(2);
    const incoming = makeXaosTransforms(2).map((t): Transform => ({
      ...t,
      id: t.id + 50,
    }));
    const result = appendXaosBlock(existing, incoming, 5, false);
    if ("refused" in result) throw new Error("unexpectedly refused");
    expect(result.transforms.map((t) => t.id)).toEqual([0, 1, 2, 3]);
    expect(result.transforms[0].chaos).toEqual([1, 1, 0, 0]);
    expect(result.transforms[1].chaos).toEqual([1, 1, 0, 0]);
    expect(result.transforms[2].chaos).toEqual([0, 0, 1, 1]);
    expect(result.transforms[3].chaos).toEqual([0, 0, 1, 1]);
    // conjugateApart on a 0.5-scale identity-rotation map: position' =
    // position + offset - 0.5*offset = 0 + 5 - 2.5 = 2.5.
    expect(result.transforms[2].position[0]).toBe(2.5);
    expect(result.transforms[3].position[0]).toBe(2.5);
    // The pre-existing block's own positions are untouched.
    expect(result.transforms[0].position).toEqual([0, 0, 0]);
  });

  it("preserves a source's own internal chaos structure, remapped rather than flattened", () => {
    const existing = makeXaosTransforms(2);
    const nestedIncoming = makeXaosTransforms(2).map((t, i): Transform => ({
      ...t,
      chaos: i === 0 ? [1, 0] : [0, 1],
    }));
    const result = appendXaosBlock(existing, nestedIncoming, 5, false);
    if ("refused" in result) throw new Error("unexpectedly refused");
    expect(detectXaosBlocks(result.transforms)).toEqual([[0, 1], [2], [3]]);
  });

  it("balances the incoming block's weights to the existing block's sum, uniformly", () => {
    const existing = makeXaosTransforms(2).map(
      (t, i): Transform => ({ ...t, weight: i === 0 ? 40 : 60 }), // sums to 100
    );
    const incoming = makeXaosTransforms(2).map(
      (t): Transform => ({ ...t, weight: 1 }), // sums to 2 -> factor 50
    );
    const result = appendXaosBlock(existing, incoming, 5, true);
    if ("refused" in result) throw new Error("unexpectedly refused");
    expect(result.transforms[2].weight).toBe(50);
    expect(result.transforms[3].weight).toBe(50);
  });

  it("leaves the incoming block's weights untouched when balancing is off", () => {
    const existing = makeXaosTransforms(2);
    const incoming = makeXaosTransforms(2);
    const result = appendXaosBlock(existing, incoming, 5, false);
    if ("refused" in result) throw new Error("unexpectedly refused");
    expect(result.transforms[2].weight).toBeUndefined();
  });

  it("refuses an empty source", () => {
    const result = appendXaosBlock(makeXaosTransforms(2), [], 5, false);
    expect(result).toEqual({ refused: expect.any(String) });
  });

  it("refuses past MAX_TRANSFORMS with a stated reason, never truncating", () => {
    const result = appendXaosBlock(
      makeXaosTransforms(MAX_TRANSFORMS - 1),
      makeXaosTransforms(2),
      5,
      false,
    );
    expect("refused" in result).toBe(true);
    if ("refused" in result) {
      expect(result.refused).toContain(String(MAX_TRANSFORMS));
    }
  });

  it("end-to-end: appending mengerSponge onto barnsleyFern reproduces the reachability preset's block shape", () => {
    const fern = barnsleyFern();
    const sponge = mengerSponge();
    const offsetX = computeXaosBlockOffset(fern, sponge);
    const result = appendXaosBlock(fern, sponge, offsetX, false);
    if ("refused" in result) throw new Error("unexpectedly refused");
    expect(result.transforms).toHaveLength(24);
    expect(detectXaosBlocks(result.transforms)).toEqual([
      [0, 1, 2, 3],
      Array.from({ length: 20 }, (_, i) => i + 4),
    ]);
  });
});

describe("setShapeTrap / updateShapeTrap (shape-trap color/geometry block)", () => {
  const base = initialState(false);

  it("stores a normalized block and clears with null (absent-means-off)", () => {
    const on = setShapeTrap(base, { shape: PEACE_SIGN_SHAPE });
    expect(on.shapeTrap).toEqual({ shape: PEACE_SIGN_SHAPE });
    const off = setShapeTrap(on, null);
    expect(off.shapeTrap).toBeUndefined();
    // A shape with no parts stores absent too — nothing to trap.
    expect(
      setShapeTrap(base, { shape: { parts: [] } }).shapeTrap,
    ).toBeUndefined();
  });

  it("strips classic-valued optional fields — the fold lengths' removal rule at block scope", () => {
    const authored: ShapeTrap = {
      shape: PEACE_SIGN_SHAPE,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: 1,
      mode: "min",
      threshold: 0.4,
      fade: 0,
    };
    const stored = setShapeTrap(base, authored).shapeTrap;
    // Everything was classic (and threshold rides only the threshold
    // mode), so only the shape survives.
    expect(stored).toEqual({ shape: PEACE_SIGN_SHAPE });
  });

  it("keeps authored values away from the classics, threshold only under its own mode", () => {
    const stored = setShapeTrap(base, {
      shape: PEACE_SIGN_SHAPE,
      position: [0.3, 0, -0.2],
      rotation: [0, 0.5, 0],
      scale: 0.5,
      mode: "threshold",
      threshold: 0.3,
      fade: 0.1,
    }).shapeTrap;
    expect(stored).toEqual({
      shape: PEACE_SIGN_SHAPE,
      position: [0.3, 0, -0.2],
      rotation: [0, 0.5, 0],
      scale: 0.5,
      mode: "threshold",
      threshold: 0.3,
      fade: 0.1,
    });
  });

  it("stores geometry only while on and canonicalizes its inclusive level band without dropping color fields", () => {
    const off = setShapeTrap(base, {
      shape: PEACE_SIGN_SHAPE,
      position: [0.3, 0, 0],
      mode: "threshold",
      threshold: 0.2,
      geometry: false,
      geometryLevelMin: 8,
      geometryLevelMax: 2,
    }).shapeTrap;
    expect(off).toEqual({
      shape: PEACE_SIGN_SHAPE,
      position: [0.3, 0, 0],
      mode: "threshold",
      threshold: 0.2,
    });

    const on = setShapeTrap(base, {
      shape: PEACE_SIGN_SHAPE,
      fade: 0.1,
      geometry: true,
      geometryLevelMin: 8.9,
      geometryLevelMax: 2.2,
    }).shapeTrap;
    expect(on).toEqual({
      shape: PEACE_SIGN_SHAPE,
      fade: 0.1,
      geometry: true,
      geometryLevelMin: 2,
      geometryLevelMax: 8,
    });

    expect(
      setShapeTrap(base, {
        shape: PEACE_SIGN_SHAPE,
        geometry: true,
        geometryLevelMin: -4,
        geometryLevelMax: Number.POSITIVE_INFINITY,
      }).shapeTrap,
    ).toEqual({ shape: PEACE_SIGN_SHAPE, geometry: true });
  });

  it("updateShapeTrap patches through the same normalization and no-ops without a block", () => {
    expect(updateShapeTrap(base, { scale: 2 })).toBe(base);
    const on = setShapeTrap(base, { shape: PEACE_SIGN_SHAPE });
    const scaled = updateShapeTrap(on, { scale: 2 });
    expect(scaled.shapeTrap?.scale).toBe(2);
    // Dragging back to the classic value removes the field.
    expect(
      updateShapeTrap(scaled, { scale: 1 }).shapeTrap?.scale,
    ).toBeUndefined();
    // Flipping to min mode drops the mode AND its threshold.
    const th = updateShapeTrap(on, { mode: "threshold", threshold: 0.2 });
    expect(th.shapeTrap?.mode).toBe("threshold");
    const backToMin = updateShapeTrap(th, { mode: "min" });
    expect(backToMin.shapeTrap?.mode).toBeUndefined();
    expect(backToMin.shapeTrap?.threshold).toBeUndefined();

    const geometry = updateShapeTrap(backToMin, {
      geometry: true,
      geometryLevelMin: 7,
      geometryLevelMax: 3,
    });
    expect(geometry.shapeTrap).toMatchObject({
      geometry: true,
      geometryLevelMin: 3,
      geometryLevelMax: 7,
    });
    const geometryOff = updateShapeTrap(geometry, { geometry: false });
    expect(geometryOff.shapeTrap?.geometry).toBeUndefined();
    expect(geometryOff.shapeTrap?.geometryLevelMin).toBeUndefined();
    expect(geometryOff.shapeTrap?.geometryLevelMax).toBeUndefined();
    expect(geometryOff.shapeTrap?.shape).toBe(PEACE_SIGN_SHAPE);
  });
});
