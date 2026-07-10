import { applyScalarControl, SCALAR_CONTROLS } from "./control-spec";
import type { ControlEffects, ScalarControlSpec } from "./control-spec";
import {
  FLAME_ITERATION_DETENTS,
  initialState,
  MAX_COLOR_GAMMA,
  MAX_NUM_POINTS,
  MIN_NUM_POINTS,
  nearestFlameIterationDetentIndex,
} from "./state";

/** Look up a table entry by its index.html element id. */
function specById(id: string): ScalarControlSpec {
  const spec = SCALAR_CONTROLS.find((s) => s.id === id);
  if (!spec) throw new Error(`No SCALAR_CONTROLS entry for #${id}`);
  return spec;
}

/** A ControlEffects whose every capability is a spy; `shared` sets what
 * presentSharedFlameFrame reports (false = not a shared-memory session). */
function mockEffects(shared = false): ControlEffects {
  return {
    scene: {
      setPointSize: vi.fn(),
      setRenderStyle: vi.fn(),
      setGlowExposure: vi.fn(),
      setGuidesVisible: vi.fn(),
      setFourDDepthFade: vi.fn(),
      setSolidParams: vi.fn(),
    },
    postFlame: vi.fn(),
    postVoxel: vi.fn(),
    presentSharedFlameFrame: vi.fn(() => shared),
    regenerateIfAutoUpdate: vi.fn(),
    recolor: vi.fn(),
    applyFourDColor: vi.fn(),
    restartSolidRender: vi.fn(),
  };
}

describe("applyScalarControl: parsing/mapping", () => {
  it("pointSizeSlider apply parses the raw string into a numeric pointSize", () => {
    const spec = specById("pointSizeSlider");

    const state = applyScalarControl(initialState(true), spec, "1.75");

    expect(state.pointSize).toBe(1.75);
  });

  it("numPointsSlider apply floors raw 0 to the MIN_NUM_POINTS endpoint", () => {
    const spec = specById("numPointsSlider");

    const state = applyScalarControl(initialState(true), spec, "0");

    expect(state.numPoints).toBe(MIN_NUM_POINTS);
  });

  it("numPointsSlider apply ceilings raw 1000 to the MAX_NUM_POINTS endpoint", () => {
    const spec = specById("numPointsSlider");

    const state = applyScalarControl(initialState(true), spec, "1000");

    expect(state.numPoints).toBe(MAX_NUM_POINTS);
  });

  it("colorGammaSlider apply maps raw 0 to the exact neutral gamma of 1", () => {
    const spec = specById("colorGammaSlider");

    const state = applyScalarControl(initialState(true), spec, "0");

    expect(state.colorGamma).toBe(1);
  });

  it("colorGammaSlider apply maps raw 1 to the exact MAX_COLOR_GAMMA ceiling", () => {
    const spec = specById("colorGammaSlider");

    const state = applyScalarControl(initialState(true), spec, "1");

    expect(state.colorGamma).toBe(MAX_COLOR_GAMMA);
  });

  it("flameIterationsSlider apply maps a detent index to its FLAME_ITERATION_DETENTS entry", () => {
    const spec = specById("flameIterationsSlider");

    const state = applyScalarControl(initialState(true), spec, "7");

    expect(state.flame.iterations).toBe(FLAME_ITERATION_DETENTS[7]);
  });

  it("colorMode select apply sets colorMode from the option value", () => {
    const spec = specById("colorMode");

    const state = applyScalarControl(initialState(true), spec, "height");

    expect(state.colorMode).toBe("height");
  });

  it("showGuides checkbox apply sets showGuides from the checked flag", () => {
    const spec = specById("showGuides");

    const state = applyScalarControl(initialState(true), spec, false);

    expect(state.showGuides).toBe(false);
  });
});

describe("read: state -> element value", () => {
  it("numPointsSlider read/apply round-trips through the log slider mapping", () => {
    const spec = specById("numPointsSlider");
    const original = { ...initialState(true), numPoints: 100_000 };

    const roundTripped = applyScalarControl(
      initialState(true),
      spec,
      spec.read(original),
    );

    expect(roundTripped.numPoints).toBe(100_000);
  });

  it("flameIterationsSlider read snaps a non-detent persisted value to the nearest detent index", () => {
    const spec = specById("flameIterationsSlider");
    const base = initialState(true);
    const state = {
      ...base,
      flame: { ...base.flame, iterations: 37_000_000 },
    };

    expect(spec.read(state)).toBe(
      String(nearestFlameIterationDetentIndex(37_000_000)),
    );
  });

  it("fourDDepthFadeToggle read reflects a true fourDDepthFade state", () => {
    const spec = specById("fourDDepthFadeToggle");
    const state = { ...initialState(true), fourDDepthFade: true };

    expect(spec.read(state)).toBe(true);
  });
});

describe("effects", () => {
  describe("appearance controls", () => {
    it("pointSize effect forwards the post-reducer pointSize to the scene", () => {
      const spec = specById("pointSizeSlider");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, "1.75");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.scene.setPointSize).toHaveBeenCalledWith(1.75);
    });

    it("renderStyle effect resets glow exposure when switching to a non-glow style", () => {
      const spec = specById("renderStyle");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, "aerial");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.scene.setRenderStyle).toHaveBeenCalledWith("aerial");
      expect(fx.scene.setGlowExposure).toHaveBeenCalledWith(1);
    });

    it("renderStyle effect leaves glow exposure untouched when switching to glow", () => {
      const spec = specById("renderStyle");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, "glow");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.scene.setRenderStyle).toHaveBeenCalledWith("glow");
      expect(fx.scene.setGlowExposure).not.toHaveBeenCalled();
    });

    it("showGuides effect forwards showGuides to the scene", () => {
      const spec = specById("showGuides");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, false);
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.scene.setGuidesVisible).toHaveBeenCalledWith(false);
    });
  });

  describe("symmetry controls", () => {
    it("symmetryOrderSlider effect regenerates once and posts setSymmetry to both render workers", () => {
      const spec = specById("symmetryOrderSlider");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, "4");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.regenerateIfAutoUpdate).toHaveBeenCalledTimes(1);
      const command = { type: "setSymmetry", order: 4, axis: "y" };
      expect(fx.postFlame).toHaveBeenCalledWith(command);
      expect(fx.postVoxel).toHaveBeenCalledWith(command);
    });

    it("symmetryAxis effect posts the identical setSymmetry shape to both render workers", () => {
      const spec = specById("symmetryAxis");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, "x");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      const command = { type: "setSymmetry", order: 1, axis: "x" };
      expect(fx.postFlame).toHaveBeenCalledWith(command);
      expect(fx.postVoxel).toHaveBeenCalledWith(command);
    });
  });

  describe("flame render controls", () => {
    it("flameExposureSlider effect tone-maps locally in a shared session instead of posting to the worker", () => {
      const spec = specById("flameExposureSlider");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, "2");
      const fx = mockEffects(true);

      spec.effect?.(state, fx, previous);

      expect(fx.presentSharedFlameFrame).toHaveBeenCalled();
      expect(fx.postFlame).not.toHaveBeenCalled();
    });

    it("flameExposureSlider effect posts setExposure when the session is not shared-memory", () => {
      const spec = specById("flameExposureSlider");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, "2");
      const fx = mockEffects(false);

      spec.effect?.(state, fx, previous);

      expect(fx.postFlame).toHaveBeenCalledWith({
        type: "setExposure",
        exposure: 2,
      });
    });

    it("flameGammaSlider effect posts setGamma when the session is not shared-memory", () => {
      const spec = specById("flameGammaSlider");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, "3");
      const fx = mockEffects(false);

      spec.effect?.(state, fx, previous);

      expect(fx.postFlame).toHaveBeenCalledWith({
        type: "setGamma",
        gamma: 3,
      });
    });

    it("flameVibrancySlider effect posts setVibrancy when the session is not shared-memory", () => {
      const spec = specById("flameVibrancySlider");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, "0.5");
      const fx = mockEffects(false);

      spec.effect?.(state, fx, previous);

      expect(fx.postFlame).toHaveBeenCalledWith({
        type: "setVibrancy",
        vibrancy: 0.5,
      });
    });

    it("flameIterationsSlider effect posts setIterationsBudget with the resolved iteration count", () => {
      const spec = specById("flameIterationsSlider");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, "7");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.postFlame).toHaveBeenCalledWith({
        type: "setIterationsBudget",
        iterations: FLAME_ITERATION_DETENTS[7],
      });
    });

    it("flameSupersampleSlider effect posts setSupersample", () => {
      const spec = specById("flameSupersampleSlider");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, "3");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.postFlame).toHaveBeenCalledWith({
        type: "setSupersample",
        supersample: 3,
      });
    });

    it("flamePalette effect posts setPalette", () => {
      const spec = specById("flamePalette");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, "spectrum");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.postFlame).toHaveBeenCalledWith({
        type: "setPalette",
        paletteId: "spectrum",
      });
    });

    it("flameEstimatorRadiusSlider effect posts setEstimatorRadius", () => {
      const spec = specById("flameEstimatorRadiusSlider");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, "10");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.postFlame).toHaveBeenCalledWith({
        type: "setEstimatorRadius",
        estimatorRadius: 10,
      });
    });

    it("flameEstimatorMinimumRadiusSlider effect posts setEstimatorMinimumRadius", () => {
      const spec = specById("flameEstimatorMinimumRadiusSlider");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, "2");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.postFlame).toHaveBeenCalledWith({
        type: "setEstimatorMinimumRadius",
        estimatorMinimumRadius: 2,
      });
    });

    it("flameEstimatorCurveSlider effect posts setEstimatorCurve", () => {
      const spec = specById("flameEstimatorCurveSlider");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, "0.8");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.postFlame).toHaveBeenCalledWith({
        type: "setEstimatorCurve",
        estimatorCurve: 0.8,
      });
    });
  });

  describe("solid render controls", () => {
    it("solidThresholdSlider effect forwards the settled solid params to the scene", () => {
      const spec = specById("solidThresholdSlider");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, "0.5");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.scene.setSolidParams).toHaveBeenCalledWith(state.solid);
    });

    it("solidLightAzimuthSlider effect forwards the settled solid params to the scene", () => {
      const spec = specById("solidLightAzimuthSlider");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, "90");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.scene.setSolidParams).toHaveBeenCalledWith(state.solid);
    });

    it("solidLightElevationSlider effect forwards the settled solid params to the scene", () => {
      const spec = specById("solidLightElevationSlider");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, "60");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.scene.setSolidParams).toHaveBeenCalledWith(state.solid);
    });

    it("solidAmbientSlider effect forwards the settled solid params to the scene", () => {
      const spec = specById("solidAmbientSlider");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, "0.4");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.scene.setSolidParams).toHaveBeenCalledWith(state.solid);
    });

    it("solidPalette effect posts setPalette to the voxel worker", () => {
      const spec = specById("solidPalette");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, "spectrum");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.postVoxel).toHaveBeenCalledWith({
        type: "setPalette",
        paletteId: "spectrum",
      });
    });

    it("solidIterationsSlider effect posts setIterationsBudget to the voxel worker", () => {
      const spec = specById("solidIterationsSlider");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, "40000000");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.postVoxel).toHaveBeenCalledWith({
        type: "setIterationsBudget",
        iterations: 40_000_000,
      });
    });

    it("solidResolutionSlider effect restarts the solid render when active and the resolution actually changed", () => {
      const spec = specById("solidResolutionSlider");
      const previous = { ...initialState(true), renderMode: "solid" as const };
      const state = applyScalarControl(previous, spec, "224");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.restartSolidRender).toHaveBeenCalled();
    });

    it("solidResolutionSlider effect does not restart when active but the resolution is unchanged", () => {
      const spec = specById("solidResolutionSlider");
      const previous = { ...initialState(true), renderMode: "solid" as const };
      const state = applyScalarControl(
        previous,
        spec,
        String(previous.solid.resolution),
      );
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.restartSolidRender).not.toHaveBeenCalled();
    });

    it("solidResolutionSlider effect does not restart when the solid render is not active", () => {
      const spec = specById("solidResolutionSlider");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, "224");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.restartSolidRender).not.toHaveBeenCalled();
    });
  });
});

describe("table policy", () => {
  it("autoUpdate is the only entry marked persisted: false", () => {
    const neverPersisted = SCALAR_CONTROLS.filter(
      (s) => s.persisted === false,
    ).map((s) => s.id);

    expect(neverPersisted).toEqual(["autoUpdate"]);
  });

  it("autoUpdate apply flips state.autoUpdate", () => {
    const spec = specById("autoUpdate");
    const initial = initialState(true);

    const state = applyScalarControl(initial, spec, false);

    expect(state.autoUpdate).toBe(false);
  });

  it("partitions entries into flat, nonFlat, and unguarded view groups exactly as declared", () => {
    const flatIds = SCALAR_CONTROLS.filter((s) => s.view === "flat")
      .map((s) => s.id)
      .sort();
    const nonFlatIds = SCALAR_CONTROLS.filter((s) => s.view === "nonFlat")
      .map((s) => s.id)
      .sort();
    const noneCount = SCALAR_CONTROLS.filter(
      (s) => s.view === undefined,
    ).length;

    expect(flatIds).toEqual(
      [
        "colorGammaSlider",
        "colorMode",
        "renderStyle",
        "symmetryAxis",
        "symmetryOrderSlider",
      ].sort(),
    );
    expect(nonFlatIds).toEqual(["fourDColor", "fourDDepthFadeToggle"].sort());
    // Every entry lands in exactly one of the three groups — catches a spec
    // that declared some other, unexpected `view` value and so fell out of
    // both named sets without landing in "none" either.
    expect(flatIds.length + nonFlatIds.length + noneCount).toBe(
      SCALAR_CONTROLS.length,
    );
  });

  it("has a unique id for every entry", () => {
    const ids = SCALAR_CONTROLS.map((s) => s.id);

    expect(new Set(ids).size).toBe(ids.length);
  });
});
