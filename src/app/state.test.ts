import {
  addTransform,
  DEFAULT_FLAME_EXPOSURE,
  DEFAULT_FLAME_GAMMA,
  DEFAULT_FLAME_ITERATIONS,
  DEFAULT_FLAME_SUPERSAMPLE,
  DEFAULT_FLAME_VIBRANCY,
  DEFAULT_POINT_SIZE,
  initialState,
  MAX_FLAME_EXPOSURE,
  MAX_FLAME_GAMMA,
  MAX_FLAME_ITERATIONS,
  MAX_FLAME_SUPERSAMPLE,
  MAX_FLAME_VIBRANCY,
  MIN_FLAME_EXPOSURE,
  MIN_FLAME_GAMMA,
  MIN_FLAME_ITERATIONS,
  MIN_FLAME_SUPERSAMPLE,
  MIN_FLAME_VIBRANCY,
  MIN_TRANSFORMS,
  removeTransform,
  selectTransform,
  setFinalTransform,
  setFlameActive,
  setFlameExposure,
  setFlameGamma,
  setFlameIterations,
  setFlameSupersample,
  setFlameVibrancy,
  setPointSize,
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

describe("setFlameActive", () => {
  it("toggles the flame overlay immutably, independent of flame params", () => {
    const state = initialState(true);
    const next = setFlameActive(state, true);
    expect(next.flameActive).toBe(true);
    expect(state.flameActive).toBe(false);
    expect(next.flame).toBe(state.flame);
  });
});
