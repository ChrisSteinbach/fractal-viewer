import {
  addTransform,
  DEFAULT_ESTIMATOR_CURVE,
  DEFAULT_ESTIMATOR_MINIMUM_RADIUS,
  DEFAULT_ESTIMATOR_RADIUS,
  DEFAULT_FLAME_EXPOSURE,
  DEFAULT_FLAME_GAMMA,
  DEFAULT_FLAME_ITERATIONS,
  DEFAULT_FLAME_PALETTE,
  DEFAULT_FLAME_SUPERSAMPLE,
  DEFAULT_FLAME_VIBRANCY,
  DEFAULT_POINT_SIZE,
  DEFAULT_RAYMARCH_ITERATIONS,
  DEFAULT_RAYMARCH_MAX_DISTANCE,
  DEFAULT_RAYMARCH_MAX_STEPS,
  DEFAULT_RAYMARCH_POWER,
  initialState,
  MAX_ESTIMATOR_CURVE,
  MAX_ESTIMATOR_MINIMUM_RADIUS,
  MAX_ESTIMATOR_RADIUS,
  MAX_FLAME_EXPOSURE,
  MAX_FLAME_GAMMA,
  MAX_FLAME_ITERATIONS,
  MAX_FLAME_SUPERSAMPLE,
  MAX_FLAME_VIBRANCY,
  MAX_RAYMARCH_MAX_STEPS,
  MAX_RAYMARCH_POWER,
  MIN_ESTIMATOR_CURVE,
  MIN_ESTIMATOR_MINIMUM_RADIUS,
  MIN_ESTIMATOR_RADIUS,
  MIN_FLAME_EXPOSURE,
  MIN_FLAME_GAMMA,
  MIN_FLAME_ITERATIONS,
  MIN_FLAME_SUPERSAMPLE,
  MIN_FLAME_VIBRANCY,
  MIN_RAYMARCH_MAX_DISTANCE,
  MIN_RAYMARCH_POWER,
  MIN_TRANSFORMS,
  removeTransform,
  selectTransform,
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
  setPointSize,
  setRaymarchActive,
  setRaymarchIterations,
  setRaymarchMaxDistance,
  setRaymarchMaxSteps,
  setRaymarchPower,
  setRenderStyle,
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

  // The raymarch renderer is explorer-first too — never the boot mode.
  it("boots with the raymarch render inactive, at its default settings", () => {
    const state = initialState(true);
    expect(state.raymarchActive).toBe(false);
    expect(state.raymarch).toEqual({
      power: DEFAULT_RAYMARCH_POWER,
      iterations: DEFAULT_RAYMARCH_ITERATIONS,
      maxSteps: DEFAULT_RAYMARCH_MAX_STEPS,
      maxDistance: DEFAULT_RAYMARCH_MAX_DISTANCE,
    });
  });

  // The startup fractal must match a menu preset so it can be reselected.
  it("starts with the 'default' preset's system", () => {
    expect(initialState(true).transforms).toEqual(presetTransforms("default"));
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

describe("setRaymarchPower", () => {
  it("sets the Mandelbulb power immutably", () => {
    const state = initialState(true);
    const next = setRaymarchPower(state, 6);
    expect(next.raymarch.power).toBe(6);
    expect(state.raymarch.power).toBe(DEFAULT_RAYMARCH_POWER);
  });

  it("clamps above the maximum", () => {
    expect(setRaymarchPower(initialState(true), 999).raymarch.power).toBe(
      MAX_RAYMARCH_POWER,
    );
  });

  it("clamps below the minimum", () => {
    expect(setRaymarchPower(initialState(true), -5).raymarch.power).toBe(
      MIN_RAYMARCH_POWER,
    );
  });
});

describe("setRaymarchIterations", () => {
  it("rounds to an integer (it drives a fixed GLSL loop)", () => {
    expect(
      setRaymarchIterations(initialState(true), 9.7).raymarch.iterations,
    ).toBe(10);
  });

  it("clamps above the maximum", () => {
    const clamped = setRaymarchIterations(initialState(true), 999).raymarch
      .iterations;
    expect(clamped).toBe(20);
  });
});

describe("setRaymarchMaxSteps", () => {
  it("rounds and clamps to the step ceiling", () => {
    expect(
      setRaymarchMaxSteps(initialState(true), 9999).raymarch.maxSteps,
    ).toBe(MAX_RAYMARCH_MAX_STEPS);
  });
});

describe("setRaymarchMaxDistance", () => {
  it("clamps below the minimum", () => {
    expect(
      setRaymarchMaxDistance(initialState(true), -1).raymarch.maxDistance,
    ).toBe(MIN_RAYMARCH_MAX_DISTANCE);
  });
});

describe("setRaymarchActive", () => {
  it("toggles the raymarch overlay immutably, independent of its params", () => {
    const state = initialState(true);
    const next = setRaymarchActive(state, true);
    expect(next.raymarchActive).toBe(true);
    expect(state.raymarchActive).toBe(false);
    expect(next.raymarch).toBe(state.raymarch);
  });
});
