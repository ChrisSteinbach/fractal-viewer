import {
  applyPrimaryCustomPaletteEffects,
  applyRenderColorInputEffects,
  applyScalarControl,
  condensationBandMode,
  renderColorInputs,
  SCALAR_CONTROLS,
  shapeTrapGeometryBandMode,
  shapeTrapSelectValue,
  surfaceColorLUT,
  surfaceColorSourceUsesOwnPalette,
  tilingClipSelectValue,
} from "./control-spec";
import type { ControlEffects, ScalarControlSpec } from "./control-spec";
import {
  DEFAULT_SOLID_PALETTE,
  FLAME_ITERATION_DETENTS,
  initialState,
  MAX_COLOR_GAMMA,
  nearestFlameIterationDetentIndex,
  nearestLogDetentIndex,
  POINT_COUNT_DETENTS,
  setShapeTrap,
  setSymmetryOrder,
  setSymmetryPlane,
  setTiling,
  SOLID_ITERATION_DETENTS,
  SURFACE_ANTIALIAS_DETENTS,
} from "./state";
import { buildColorModeLUT } from "../fractal/color";
import { buildPaletteLUT, resolvePalette } from "../fractal/palette";
import { resolveBackground } from "./background";
import { GEAR_SHAPE, STAR_PRISM_SHAPE } from "../fractal/shapes";
import {
  LATTICE_CELL_SCALE_DEFAULT,
  LATTICE_CELL_SCALE_MAX,
  LATTICE_CELL_SCALE_MIN,
} from "./constants";
import { pentatope } from "../fractal/presets";
import { BUNDLED_SHAPES, BUNDLED_TRAP_SHAPES } from "./bundled-shapes";

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
      setSurfaceParams: vi.fn(),
      setSurfaceDepthOfField: vi.fn(),
      setSurfaceShapeTrap: vi.fn(),
      setSurfaceColorLUT: vi.fn(),
      setBalloonEchoEnabled: vi.fn(),
      setBalloonEchoRadius: vi.fn(),
      setSurfaceBalloonRadius: vi.fn(),
      setBalloonTint: vi.fn(),
      setBalloonPalette: vi.fn(),
      setFogDensity: vi.fn(),
      setFogTint: vi.fn(),
    },
    postFlame: vi.fn(),
    postVoxel: vi.fn(),
    presentSharedFlameFrame: vi.fn(() => shared),
    regenerateIfAutoUpdate: vi.fn(),
    refreshSurfaceEligibility: vi.fn(),
    recolor: vi.fn(),
    applyFourDColor: vi.fn(),
    restartSolidRender: vi.fn(),
    restartFlameRender: vi.fn(),
    setSurfaceLatticeScale: vi.fn(),
    restartSurfaceRender: vi.fn(),
    applyBackground: vi.fn(),
    trackAutoBackground: vi.fn(),
    cancelBalloonSweep: vi.fn(),
  };
}

describe("applyScalarControl: parsing/mapping", () => {
  it("authors classic, root-only, and sorted custom condensation bands", () => {
    const mode = specById("surfaceCondensationBandMode");
    const min = specById("surfaceCondensationMinSlider");
    const max = specById("surfaceCondensationMaxSlider");
    const initial = initialState(true);

    const root = applyScalarControl(initial, mode, "root");
    expect(root.condensationDepthBand).toEqual({ maxDepth: 0 });
    expect(condensationBandMode(root)).toBe("root");

    const custom = applyScalarControl(root, mode, "custom");
    const withMin = applyScalarControl(custom, min, "7");
    expect(withMin.condensationDepthBand).toEqual({
      minDepth: 1,
      maxDepth: 7,
    });
    const sorted = applyScalarControl(withMin, max, "3");
    expect(sorted.condensationDepthBand).toEqual({
      minDepth: 1,
      maxDepth: 3,
    });
    expect(condensationBandMode(sorted)).toBe("custom");

    const classic = applyScalarControl(sorted, mode, "all");
    expect(classic.condensationDepthBand).toBeUndefined();
    expect(condensationBandMode(classic)).toBe("all");
  });

  it("restarts the frozen Surface session after a condensation-band edit", () => {
    const spec = specById("surfaceCondensationMaxSlider");
    const state = applyScalarControl(initialState(true), spec, "4");
    const fx = mockEffects();
    spec.effect?.(state, fx, initialState(true));
    expect(fx.restartSurfaceRender).toHaveBeenCalledTimes(1);
  });

  it("authors every registered trap and maps each canonical spec back to its kind", () => {
    const spec = specById("surfaceTrapShape");
    for (const entry of BUNDLED_TRAP_SHAPES) {
      const state = applyScalarControl(initialState(true), spec, entry.kind);
      expect(state.shapeTrap).toEqual({ shape: entry.shape });
      expect(shapeTrapSelectValue(state)).toBe(entry.kind);
    }

    const state = applyScalarControl(initialState(true), spec, "star");
    expect(state.shapeTrap).toEqual({ shape: STAR_PRISM_SHAPE });
    const fx = mockEffects();
    spec.effect?.(state, fx, initialState(true));
    expect(fx.scene.setSurfaceShapeTrap).toHaveBeenCalledWith(state.shapeTrap);
    expect(fx.restartSurfaceRender).toHaveBeenCalledTimes(1);
  });

  it("creates a custom shape and keeps an opaque mesh composition untouched", () => {
    const spec = specById("surfaceTrapShape");
    const created = applyScalarControl(initialState(true), spec, "custom");
    expect(created.shapeTrap).toEqual({
      shape: {
        parts: [
          {
            primitive: { kind: "sphere", radius: 1 },
            combine: "union",
          },
        ],
      },
    });
    expect(shapeTrapSelectValue(created)).toBe("custom");

    const authored = setShapeTrap(initialState(true), {
      shape: {
        parts: [
          {
            primitive: STAR_PRISM_SHAPE.parts[0].primitive,
            combine: "union",
          },
          {
            primitive: { kind: "box", half: [0.2, 0.3, 0.4] },
            combine: "union",
          },
        ],
      },
      fade: 0.2,
    });

    expect(shapeTrapSelectValue(authored)).toBe("authored");
    expect(applyScalarControl(authored, spec, "authored")).toBe(authored);
    const cleared = applyScalarControl(authored, spec, "");
    expect(cleared.shapeTrap).toBeUndefined();
    expect(shapeTrapSelectValue(cleared)).toBe("");
  });

  it("normalizes trap geometry and its all/root/custom inclusive band", () => {
    const geometry = specById("surfaceTrapGeometryCheckbox");
    const mode = specById("surfaceTrapGeometryBandMode");
    const min = specById("surfaceTrapGeometryMinSlider");
    const max = specById("surfaceTrapGeometryMaxSlider");
    const trapped = setShapeTrap(initialState(true), { shape: GEAR_SHAPE });

    const enabled = applyScalarControl(trapped, geometry, true);
    expect(enabled.shapeTrap).toEqual({ shape: GEAR_SHAPE, geometry: true });
    expect(shapeTrapGeometryBandMode(enabled)).toBe("all");

    const root = applyScalarControl(enabled, mode, "root");
    expect(root.shapeTrap).toEqual({
      shape: GEAR_SHAPE,
      geometry: true,
      geometryLevelMax: 0,
    });
    expect(shapeTrapGeometryBandMode(root)).toBe("root");

    const custom = applyScalarControl(root, mode, "custom");
    expect(custom.shapeTrap).toMatchObject({
      geometry: true,
      geometryLevelMin: 1,
      geometryLevelMax: 1,
    });
    const withMin = applyScalarControl(custom, min, "7");
    expect(withMin.shapeTrap).toMatchObject({
      geometryLevelMin: 1,
      geometryLevelMax: 7,
    });
    const sorted = applyScalarControl(withMin, max, "3");
    expect(sorted.shapeTrap).toMatchObject({
      geometryLevelMin: 1,
      geometryLevelMax: 3,
    });
    const disabledCustom = applyScalarControl(sorted, geometry, false);
    expect(disabledCustom.shapeTrap).toEqual({ shape: GEAR_SHAPE });

    const all = applyScalarControl(sorted, mode, "all");
    expect(all.shapeTrap).toEqual({ shape: GEAR_SHAPE, geometry: true });
    const disabled = applyScalarControl(all, geometry, false);
    expect(disabled.shapeTrap).toEqual({ shape: GEAR_SHAPE });
  });

  it("re-derives eligibility and restarts Surface when trap geometry toggles", () => {
    const spec = specById("surfaceTrapGeometryCheckbox");
    const trapped = setShapeTrap(initialState(true), { shape: GEAR_SHAPE });
    const state = applyScalarControl(trapped, spec, true);
    const fx = mockEffects();

    spec.effect?.(state, fx, trapped);

    expect(fx.scene.setSurfaceShapeTrap).toHaveBeenCalledWith(state.shapeTrap);
    expect(fx.refreshSurfaceEligibility).toHaveBeenCalledTimes(1);
    expect(fx.restartSurfaceRender).toHaveBeenCalledTimes(1);
  });

  it("pointSizeSlider apply parses the raw string into a numeric pointSize", () => {
    const spec = specById("pointSizeSlider");

    const state = applyScalarControl(initialState(true), spec, "1.75");

    expect(state.pointSize).toBe(1.75);
  });

  it("balloonRadiusSlider apply parses the raw string into a numeric balloonRadius", () => {
    const spec = specById("balloonRadiusSlider");

    const state = applyScalarControl(initialState(true), spec, "0.9");

    expect(state.balloonRadius).toBe(0.9);
  });

  it("balloonPalette apply writes the shared balloon selection", () => {
    const state = applyScalarControl(
      initialState(true),
      specById("balloonPalette"),
      "moss",
    );
    expect(state.balloonPaletteId).toBe("moss");
  });

  it("fogSlider apply parses the raw string into a numeric fogDensity", () => {
    const spec = specById("fogSlider");

    const state = applyScalarControl(initialState(true), spec, "0.5");

    expect(state.fogDensity).toBe(0.5);
  });

  it("fogTintStrength apply parses the raw string into a numeric fogTintStrength", () => {
    const spec = specById("fogTintStrength");

    const state = applyScalarControl(initialState(true), spec, "0.5");

    expect(state.fogTintStrength).toBe(0.5);
  });

  it("balloonTintStrength apply parses the raw string into a numeric balloonTintStrength", () => {
    const spec = specById("balloonTintStrength");

    const state = applyScalarControl(initialState(true), spec, "0.5");

    expect(state.balloonTintStrength).toBe(0.5);
  });

  it("numPointsSlider apply maps a detent index to its preferred count", () => {
    const spec = specById("numPointsSlider");

    const state = applyScalarControl(initialState(true), spec, "8");

    expect(state.numPoints).toBe(POINT_COUNT_DETENTS[8]);
  });

  it("detent-index sliders safely clamp synthetic out-of-range indexes", () => {
    const spec = specById("numPointsSlider");

    const low = applyScalarControl(initialState(true), spec, "-100");
    const high = applyScalarControl(initialState(true), spec, "1000");

    expect(low.numPoints).toBe(POINT_COUNT_DETENTS[0]);
    expect(high.numPoints).toBe(
      POINT_COUNT_DETENTS[POINT_COUNT_DETENTS.length - 1],
    );
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

  it("solidIterationsSlider apply maps a detent index to its preferred budget", () => {
    const spec = specById("solidIterationsSlider");

    const state = applyScalarControl(initialState(true), spec, "5");

    expect(state.solid.iterations).toBe(SOLID_ITERATION_DETENTS[5]);
  });

  it("surfaceAntialiasSlider apply maps a detent index to samples per pixel", () => {
    const spec = specById("surfaceAntialiasSlider");

    const state = applyScalarControl(initialState(true), spec, "4");

    expect(state.surface.antialiasSamples).toBe(SURFACE_ANTIALIAS_DETENTS[4]);
  });

  it.each(["colorMode", "solidColorMode"])(
    "%s select apply sets colorMode from the option value",
    (id) => {
      const spec = specById(id);

      const state = applyScalarControl(initialState(true), spec, "height");

      expect(state.colorMode).toBe("height");
      if (id === "solidColorMode") {
        expect(state.solid.paletteId).toBe("legacy");
      }
    },
  );

  it.each(["rampPalette", "solidRampPalette"])(
    "%s select apply sets rampPaletteId from the option value",
    (id) => {
      const spec = specById(id);

      const state = applyScalarControl(initialState(true), spec, "ember");

      expect(state.rampPaletteId).toBe("ember");
    },
  );

  it("solidFourDColor select applies the existing 4D color definition", () => {
    const spec = specById("solidFourDColor");
    const base = initialState(true);
    const initial = {
      ...base,
      transforms: [
        { ...base.transforms[0], w: { position: 0.5 } },
        ...base.transforms.slice(1),
      ],
    };

    const state = applyScalarControl(initial, spec, "radius");

    expect(state.fourDColor).toBe("radius");
    expect(state.solid.paletteId).toBe("legacy");
  });

  it("Solid's Orbit palette choice maps to its default structural palette", () => {
    const spec = specById("solidColorMode");
    const initial = {
      ...initialState(true),
      solid: { ...initialState(true).solid, paletteId: "legacy" as const },
    };

    const state = applyScalarControl(initial, spec, "orbit");

    expect(state.solid.paletteId).toBe(DEFAULT_SOLID_PALETTE);
    expect(spec.kind === "select" && spec.read(state)).toBe("orbit");
  });

  it("solidColorGammaSlider applies the same contrast mapping", () => {
    const spec = specById("solidColorGammaSlider");

    const state = applyScalarControl(initialState(true), spec, "1");

    expect(state.colorGamma).toBe(MAX_COLOR_GAMMA);
  });

  it("background select apply sets background.mode from the option value", () => {
    const spec = specById("background");

    const state = applyScalarControl(initialState(true), spec, "flame");

    expect(state.background.mode).toBe("flame");
  });

  it('background select apply landing on "custom" seeds background.custom from the replaced backdrop', () => {
    const spec = specById("background");
    const previous = initialState(true); // dark, no custom slot authored yet

    const state = applyScalarControl(previous, spec, "custom");

    expect(state.background.custom).toEqual(
      resolveBackground(previous.background),
    );
  });

  it("backgroundShape select apply sets background.shape from the option value", () => {
    const spec = specById("backgroundShape");

    const state = applyScalarControl(initialState(true), spec, "radial");

    expect(state.background.shape).toBe("radial");
  });

  it("backgroundFlamePalette select apply authors the backdrop palette", () => {
    const spec = specById("backgroundFlamePalette");

    const state = applyScalarControl(initialState(true), spec, "ember");

    expect(state.background.flamePaletteId).toBe("ember");
  });

  it("showGuides checkbox apply sets showGuides from the checked flag", () => {
    const spec = specById("showGuides");

    const state = applyScalarControl(initialState(true), spec, false);

    expect(state.showGuides).toBe(false);
  });
});

describe("read: state -> element value", () => {
  it("numPointsSlider read snaps a non-detent saved count without rewriting it", () => {
    const spec = specById("numPointsSlider");
    const original = { ...initialState(true), numPoints: 37_000 };

    expect(spec.read(original)).toBe(
      String(nearestLogDetentIndex(37_000, POINT_COUNT_DETENTS)),
    );
    expect(original.numPoints).toBe(37_000);
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

  it("solidIterationsSlider read snaps only the thumb for a non-detent saved budget", () => {
    const spec = specById("solidIterationsSlider");
    const base = initialState(true);
    const state = {
      ...base,
      solid: { ...base.solid, iterations: 37_000_000 },
    };

    expect(spec.read(state)).toBe(
      String(nearestLogDetentIndex(37_000_000, SOLID_ITERATION_DETENTS)),
    );
    expect(state.solid.iterations).toBe(37_000_000);
  });

  it("surfaceAntialiasSlider read exposes the authored detent index", () => {
    const spec = specById("surfaceAntialiasSlider");
    const base = initialState(true);
    const state = {
      ...base,
      surface: { ...base.surface, antialiasSamples: 16 },
    };

    expect(spec.read(state)).toBe("4");
  });

  it("surfaceDepthOfFieldCheckbox read reflects the saved Surface choice", () => {
    const spec = specById("surfaceDepthOfFieldCheckbox");
    const base = initialState(true);
    const state = {
      ...base,
      surface: { ...base.surface, depthOfField: true },
    };

    expect(spec.read(state)).toBe(true);
  });

  it("fourDDepthFadeToggle read reflects a true fourDDepthFade state", () => {
    const spec = specById("fourDDepthFadeToggle");
    const state = { ...initialState(true), fourDDepthFade: true };

    expect(spec.read(state)).toBe(true);
  });

  it("rampPalette read reflects state.rampPaletteId", () => {
    const spec = specById("rampPalette");
    const state = { ...initialState(true), rampPaletteId: "ember" as const };

    expect(spec.read(state)).toBe("ember");
  });

  it("surfaceGroundPlaneCheckbox read reflects state.groundPlane", () => {
    const spec = specById("surfaceGroundPlaneCheckbox");
    const state = { ...initialState(true), groundPlane: true };

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

    it("accepts 4D glow/DOF while refusing synthetic 4D aerial/EDL edits", () => {
      const spec = specById("renderStyle");
      const initial = initialState(true);
      const nonFlat = {
        ...initial,
        transforms: [
          { ...initial.transforms[0], w: { position: 0.5 } },
          ...initial.transforms.slice(1),
        ],
      };

      expect(applyScalarControl(nonFlat, spec, "glow").renderStyle).toBe(
        "glow",
      );
      expect(applyScalarControl(nonFlat, spec, "dof").renderStyle).toBe("dof");
      expect(applyScalarControl(nonFlat, spec, "aerial")).toBe(nonFlat);
      expect(applyScalarControl(nonFlat, spec, "edl")).toBe(nonFlat);
    });

    it("showGuides effect forwards showGuides to the scene", () => {
      const spec = specById("showGuides");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, false);
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.scene.setGuidesVisible).toHaveBeenCalledWith(false);
    });

    it("balloonEchoCheckbox effect forwards the enabled flag and current radius, and cancels an in-flight sweep", () => {
      const spec = specById("balloonEchoCheckbox");
      const previous = {
        ...initialState(true),
        balloonPaletteId: "aurora" as const,
      };
      const state = applyScalarControl(previous, spec, true);
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.scene.setBalloonPalette).toHaveBeenCalledWith(
        buildPaletteLUT("aurora"),
      );
      expect(fx.scene.setBalloonEchoEnabled).toHaveBeenCalledWith(true);
      expect(fx.scene.setBalloonEchoRadius).toHaveBeenCalledWith(
        state.balloonRadius,
      );
      expect(fx.cancelBalloonSweep).toHaveBeenCalledTimes(1);
    });

    it("balloon enable applies a palette authored while the echo was off", () => {
      const spec = specById("balloonEchoCheckbox");
      const previous = {
        ...initialState(true),
        balloonPaletteId: "sunset" as const,
      };
      const state = applyScalarControl(previous, spec, true);
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.scene.setBalloonPalette).toHaveBeenCalledWith(
        buildPaletteLUT("sunset"),
      );
      // Checkbox enable uses the scene-only setup path. An active Flame
      // session is restarted below from the full current state instead of
      // receiving a redundant live-palette command first.
      expect(fx.postFlame).not.toHaveBeenCalled();
    });

    it("balloonRadiusSlider effect forwards the radius and cancels an in-flight sweep", () => {
      const spec = specById("balloonRadiusSlider");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, "0.9");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.scene.setBalloonEchoRadius).toHaveBeenCalledWith(0.9);
      expect(fx.cancelBalloonSweep).toHaveBeenCalledTimes(1);
    });

    it.each([
      ["points", false, false],
      ["solid", false, false],
      ["flame", true, false],
      ["surface", false, true],
    ] as const)(
      "balloonPalette applies the truthful %s renderer cost",
      (renderMode, postsFlame, restartsSurface) => {
        const spec = specById("balloonPalette");
        const previous = {
          ...initialState(true),
          renderMode,
          balloonEcho: true,
        };
        const state = applyScalarControl(previous, spec, "aurora");
        const fx = mockEffects();

        spec.effect?.(state, fx, previous);

        expect(fx.scene.setBalloonPalette).toHaveBeenCalledWith(
          buildPaletteLUT("aurora"),
        );
        expect(fx.postFlame).toHaveBeenCalledTimes(postsFlame ? 1 : 0);
        expect(fx.restartFlameRender).not.toHaveBeenCalled();
        expect(fx.restartSurfaceRender).toHaveBeenCalledTimes(
          restartsSurface ? 1 : 0,
        );
        expect(fx.postVoxel).not.toHaveBeenCalled();
      },
    );

    it("stages a Solid mode before switching the worker out of Orbit palette", () => {
      const previous = initialState(true);
      const spec = specById("solidColorMode");
      const state = applyScalarControl(previous, spec, "height");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(
        vi.mocked(fx.postVoxel).mock.calls.map(([command]) => command.type),
      ).toEqual(["setColorInputs", "setPalette"]);
      expect(fx.postVoxel).toHaveBeenLastCalledWith({
        type: "setPalette",
        palette: "legacy",
      });
      expect(fx.trackAutoBackground).toHaveBeenCalledTimes(1);
    });

    it("switches Solid from a mode to Orbit palette without a redundant color-input restart", () => {
      const base = initialState(true);
      const previous = {
        ...base,
        solid: { ...base.solid, paletteId: "legacy" as const },
      };
      const spec = specById("solidColorMode");
      const state = applyScalarControl(previous, spec, "orbit");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.postVoxel).toHaveBeenCalledExactlyOnceWith({
        type: "setPalette",
        palette: DEFAULT_SOLID_PALETTE,
      });
      expect(fx.postFlame).not.toHaveBeenCalled();
    });

    it("sends Flame the omitted-palette Inherit command", () => {
      const spec = specById("balloonPalette");
      const previous = {
        ...initialState(true),
        renderMode: "flame" as const,
        balloonEcho: true,
        balloonPaletteId: "aurora" as const,
      };
      const state = applyScalarControl(previous, spec, "inherit");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.scene.setBalloonPalette).toHaveBeenCalledWith(null);
      expect(fx.postFlame).toHaveBeenCalledWith({ type: "setBalloonPalette" });
    });

    it("resolves Custom from the independent Balloon payload", () => {
      const spec = specById("balloonPalette");
      const balloonCustomPalette = {
        stops: [
          [1, 0, 0],
          [0, 0, 1],
        ],
      } as const;
      const previous = {
        ...initialState(true),
        renderMode: "flame" as const,
        balloonEcho: true,
        balloonCustomPalette,
      } as const;
      const state = applyScalarControl(previous, spec, "custom");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.scene.setBalloonPalette).toHaveBeenCalledWith(
        buildPaletteLUT(balloonCustomPalette),
      );
      expect(fx.postFlame).toHaveBeenCalledWith({
        type: "setBalloonPalette",
        palette: balloonCustomPalette,
      });
    });

    it("keeps palette authoring renderer-inert while Balloon is off", () => {
      const spec = specById("balloonPalette");
      const previous = {
        ...initialState(true),
        renderMode: "surface" as const,
      };
      const state = applyScalarControl(previous, spec, "sunset");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(state.balloonPaletteId).toBe("sunset");
      expect(fx.scene.setBalloonPalette).not.toHaveBeenCalled();
      expect(fx.postFlame).not.toHaveBeenCalled();
      expect(fx.restartSurfaceRender).not.toHaveBeenCalled();
    });

    it("does no renderer work for a redundant selection event", () => {
      const spec = specById("balloonPalette");
      const previous = {
        ...initialState(true),
        balloonEcho: true,
        balloonPaletteId: "moss" as const,
      };
      const state = applyScalarControl(previous, spec, "moss");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.scene.setBalloonPalette).not.toHaveBeenCalled();
      expect(fx.postFlame).not.toHaveBeenCalled();
      expect(fx.restartSurfaceRender).not.toHaveBeenCalled();
    });

    it("fogSlider effect forwards the density to the scene", () => {
      const spec = specById("fogSlider");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, "0.5");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.scene.setFogDensity).toHaveBeenCalledWith(0.5);
    });

    it("fogTintStrength effect forwards the tint (as rgb01) and strength to the scene", () => {
      const spec = specById("fogTintStrength");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, "0.5");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      // initialState's fogTint defaults to "#ffffff" — white.
      expect(fx.scene.setFogTint).toHaveBeenCalledWith([1, 1, 1], 0.5);
    });

    it("shared Balloon checkbox re-enters an active Surface session", () => {
      const spec = specById("balloonEchoCheckbox");
      const previous = {
        ...initialState(true),
        renderMode: "surface" as const,
      };
      const state = applyScalarControl(previous, spec, true);
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      // A variant-level change: the session re-enter re-derives routing,
      // grid, SURFACE_BALLOON define and uniforms from state in one sweep
      // — no direct scene call here.
      expect(fx.restartSurfaceRender).toHaveBeenCalledTimes(1);
      expect(fx.cancelBalloonSweep).toHaveBeenCalledTimes(1);
    });

    it("shared Balloon checkbox restarts active Flame accumulation", () => {
      const spec = specById("balloonEchoCheckbox");
      const previous = {
        ...initialState(true),
        renderMode: "flame" as const,
      };
      const state = applyScalarControl(previous, spec, true);
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.scene.setBalloonEchoEnabled).toHaveBeenCalledWith(true);
      expect(fx.scene.setBalloonEchoRadius).toHaveBeenCalledWith(
        state.balloonRadius,
      );
      expect(fx.restartFlameRender).toHaveBeenCalledTimes(1);
      expect(fx.cancelBalloonSweep).toHaveBeenCalledTimes(1);
    });

    it("shared Balloon checkbox updates Solid live without rebuilding", () => {
      const spec = specById("balloonEchoCheckbox");
      const previous = {
        ...initialState(true),
        renderMode: "solid" as const,
      };
      const state = applyScalarControl(previous, spec, true);
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(state.balloonEcho).toBe(true);
      expect(fx.scene.setBalloonEchoEnabled).toHaveBeenCalledWith(true);
      expect(fx.scene.setBalloonEchoRadius).toHaveBeenCalledWith(
        state.balloonRadius,
      );
      expect(fx.restartSolidRender).not.toHaveBeenCalled();
      expect(fx.postVoxel).not.toHaveBeenCalled();
      expect(fx.cancelBalloonSweep).toHaveBeenCalledTimes(1);
    });

    it("shared Balloon radius syncs both scene arms and restarts Flame", () => {
      const spec = specById("balloonRadiusSlider");
      const previous = {
        ...initialState(true),
        renderMode: "flame" as const,
      };
      const state = applyScalarControl(previous, spec, "0.9");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.scene.setBalloonEchoRadius).toHaveBeenCalledWith(0.9);
      expect(fx.scene.setSurfaceBalloonRadius).toHaveBeenCalledWith(0.9);
      expect(fx.restartFlameRender).toHaveBeenCalledTimes(1);
      expect(fx.cancelBalloonSweep).toHaveBeenCalledTimes(1);
    });

    it("shared Balloon radius updates Solid live without rebuilding", () => {
      const spec = specById("balloonRadiusSlider");
      const previous = {
        ...initialState(true),
        renderMode: "solid" as const,
      };
      const state = applyScalarControl(previous, spec, "0.9");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.scene.setBalloonEchoRadius).toHaveBeenCalledWith(0.9);
      expect(fx.restartSolidRender).not.toHaveBeenCalled();
      expect(fx.postVoxel).not.toHaveBeenCalled();
      expect(fx.cancelBalloonSweep).toHaveBeenCalledTimes(1);
    });

    it("shared Balloon tint syncs the scene and restarts Flame", () => {
      const spec = specById("balloonTintStrength");
      const previous = {
        ...initialState(true),
        renderMode: "flame" as const,
      };
      const state = applyScalarControl(previous, spec, "0.5");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.scene.setBalloonTint).toHaveBeenCalledWith([0, 0, 0], 0.5);
      expect(fx.restartFlameRender).toHaveBeenCalledTimes(1);
    });

    it("shared Balloon tint updates Solid live without rebuilding", () => {
      const spec = specById("balloonTintStrength");
      const previous = {
        ...initialState(true),
        renderMode: "solid" as const,
      };
      const state = applyScalarControl(previous, spec, "0.5");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.scene.setBalloonTint).toHaveBeenCalledWith([0, 0, 0], 0.5);
      expect(fx.restartSolidRender).not.toHaveBeenCalled();
      expect(fx.postVoxel).not.toHaveBeenCalled();
    });

    it("shared Balloon radius uses Surface's live cheap path", () => {
      const spec = specById("balloonRadiusSlider");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, "0.9");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.scene.setSurfaceBalloonRadius).toHaveBeenCalledWith(0.9);
      expect(fx.restartSurfaceRender).not.toHaveBeenCalled();
      expect(fx.cancelBalloonSweep).toHaveBeenCalledTimes(1);
    });

    it("balloonTintStrength effect forwards the tint (as rgb01) and strength to the scene", () => {
      const spec = specById("balloonTintStrength");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, "0.5");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      // initialState's balloonTint defaults to DEFAULT_BALLOON_TINT,
      // "#000000" — black.
      expect(fx.scene.setBalloonTint).toHaveBeenCalledWith([0, 0, 0], 0.5);
    });

    it("shared Balloon tint stays live in Surface without session re-entry", () => {
      const spec = specById("balloonTintStrength");
      const previous = {
        ...initialState(true),
        renderMode: "surface" as const,
      };
      const state = applyScalarControl(previous, spec, "0.5");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.scene.setBalloonTint).toHaveBeenCalledWith([0, 0, 0], 0.5);
      // Deliberately NOT a variant-level change: the tint is a uniform/spec
      // value the already-compiled SURFACE_BALLOON arm reads, so the shared
      // radius control's cheap live path applies here too.
      expect(fx.restartSurfaceRender).not.toHaveBeenCalled();
    });

    it("surfaceGroundPlaneCheckbox apply sets state.groundPlane and its effect re-enters the surface session", () => {
      const spec = specById("surfaceGroundPlaneCheckbox");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, true);
      const fx = mockEffects();

      expect(state.groundPlane).toBe(true);

      spec.effect?.(state, fx, previous);

      // A variant-level change: the session re-enter re-derives the floor
      // uniforms/kernel choice from state in one sweep — no direct scene
      // call here, and no sweep to cancel (the floor has no Inflate
      // replay, unlike the balloon checkbox above).
      expect(fx.restartSurfaceRender).toHaveBeenCalledTimes(1);
    });

    it("rampPalette effect re-bakes both views' ramp colors (recolor + applyFourDColor)", () => {
      const spec = specById("rampPalette");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, "ember");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      // Each no-ops in the other view (recolor only touches the flat cloud;
      // applyFourDColor only touches the 4D bake), so calling both
      // unconditionally re-bakes exactly the displayed cloud.
      expect(fx.recolor).toHaveBeenCalled();
      expect(fx.applyFourDColor).toHaveBeenCalled();
    });

    it("rampPalette effect also tracks the auto background", () => {
      const spec = specById("rampPalette");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, "ember");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.trackAutoBackground).toHaveBeenCalledTimes(1);
    });

    it.each(["height", "radius"] as const)(
      "shared gamma refreshes Surface %s LUT without a view guard",
      (colorSource) => {
        const spec = specById("colorGammaSlider");
        const previous = {
          ...initialState(true),
          surface: { ...initialState(true).surface, colorSource },
        };
        const state = applyScalarControl(previous, spec, "0.75");
        const fx = mockEffects();

        expect(spec.view).toBeUndefined();
        spec.effect?.(state, fx, previous);

        expect(fx.scene.setSurfaceColorLUT).toHaveBeenCalledWith(
          surfaceColorLUT(state),
        );
        expect(fx.recolor).toHaveBeenCalledOnce();
        expect(fx.applyFourDColor).toHaveBeenCalledOnce();
        expect(fx.restartSurfaceRender).not.toHaveBeenCalled();
      },
    );

    it("posts one identical atomic color snapshot to both workers", () => {
      const state = {
        ...initialState(true),
        colorMode: "position" as const,
      };
      const fx = mockEffects();

      applyRenderColorInputEffects(state, fx, { points: "flat" });

      const flame = vi.mocked(fx.postFlame).mock.calls[0][0];
      const voxel = vi.mocked(fx.postVoxel).mock.calls[0][0];
      expect(flame).toEqual(voxel);
      expect(flame.type).toBe("setColorInputs");
      expect(fx.recolor).toHaveBeenCalledTimes(1);
    });

    it.each([
      ["solidColorMode", "height"],
      ["solidRampPalette", "ember"],
      ["solidColorGammaSlider", "0.75"],
    ] as const)(
      "%s pushes the complete color snapshot to an active Solid worker",
      (id, raw) => {
        const previous = initialState(true);
        const spec = specById(id);
        const state = applyScalarControl(previous, spec, raw);
        const fx = mockEffects();

        spec.effect?.(state, fx, previous);

        expect(fx.postVoxel).toHaveBeenCalledWith({
          type: "setColorInputs",
          inputs: renderColorInputs(state),
        });
      },
    );

    it("orders primary Custom before its ramp snapshot and never duplicates backdrop work", () => {
      const state = {
        ...initialState(true),
        colorMode: "height" as const,
        fourDColor: "radius" as const,
        rampPaletteId: "custom" as const,
        flame: { ...initialState(true).flame, paletteId: "custom" as const },
        solid: { ...initialState(true).solid, paletteId: "custom" as const },
      };
      const fx = mockEffects();

      applyPrimaryCustomPaletteEffects(state, fx);

      expect(
        vi.mocked(fx.postFlame).mock.calls.map(([command]) => command.type),
      ).toEqual(["setPalette", "setColorInputs"]);
      expect(
        vi.mocked(fx.postVoxel).mock.calls.map(([command]) => command.type),
      ).toEqual(["setPalette", "setColorInputs"]);
      expect(fx.recolor).toHaveBeenCalledTimes(1);
      expect(fx.applyFourDColor).toHaveBeenCalledTimes(1);
      expect(fx.trackAutoBackground).toHaveBeenCalledTimes(1);
    });

    it("background effect invokes applyBackground exactly once and touches no scene method", () => {
      const spec = specById("background");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, "haze");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.applyBackground).toHaveBeenCalledTimes(1);
      // main.ts owns the live backdrop value (the crossfade tween's `from`
      // endpoint), so this control must route through applyBackground alone
      // — a direct scene.* call here would desync the tween (see
      // ControlEffects.applyBackground's doc in control-spec.ts).
      for (const sceneMethod of Object.values(fx.scene)) {
        expect(sceneMethod).not.toHaveBeenCalled();
      }
    });

    it("backgroundShape effect invokes applyBackground exactly once and touches no scene method", () => {
      const spec = specById("backgroundShape");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, "radial");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.applyBackground).toHaveBeenCalledTimes(1);
      for (const sceneMethod of Object.values(fx.scene)) {
        expect(sceneMethod).not.toHaveBeenCalled();
      }
    });

    it("backgroundFlamePalette effect requests one guarded backdrop refresh", () => {
      const spec = specById("backgroundFlamePalette");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, "aurora");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.trackAutoBackground).toHaveBeenCalledTimes(1);
      expect(fx.applyBackground).not.toHaveBeenCalled();
      for (const sceneMethod of Object.values(fx.scene)) {
        expect(sceneMethod).not.toHaveBeenCalled();
      }
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
      const command = { type: "setSymmetry", order: 4, plane: "xz", twist: 0 };
      expect(fx.postFlame).toHaveBeenCalledWith(command);
      expect(fx.postVoxel).toHaveBeenCalledWith(command);
    });

    it("symmetry effect re-derives the Surface eligibility gate", () => {
      // A symmetry edit can flip the document's flatness (a w-plane or a
      // twist) or close the Mandelbulb arm (order > 1), and the scalar
      // pipeline never runs a full refreshUi — the effect must refresh the
      // gate itself or the Surface button goes stale until an unrelated
      // edit.
      const spec = specById("symmetryOrderSlider");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, "4");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.refreshSurfaceEligibility).toHaveBeenCalledTimes(1);
    });

    it("authors a 3D-to-4D symmetry edit without restarting a fixed-dimension worker incorrectly", () => {
      const spec = specById("symmetryPlane");
      const previous = setSymmetryOrder(initialState(true), 3);
      const state = setSymmetryPlane(previous, "zw");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.regenerateIfAutoUpdate).toHaveBeenCalledTimes(1);
      expect(fx.refreshSurfaceEligibility).toHaveBeenCalledTimes(1);
      expect(fx.postFlame).not.toHaveBeenCalled();
      expect(fx.postVoxel).not.toHaveBeenCalled();
    });

    it("symmetryPlane effect posts the identical setSymmetry shape to both render workers", () => {
      const spec = specById("symmetryPlane");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, "yz");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      const command = { type: "setSymmetry", order: 1, plane: "yz", twist: 0 };
      expect(fx.postFlame).toHaveBeenCalledWith(command);
      expect(fx.postVoxel).toHaveBeenCalledWith(command);
    });

    it("symmetryTwistSlider applies through setSymmetryTwist and posts the twist in the setSymmetry command", () => {
      const spec = specById("symmetryTwistSlider");
      // Start non-flat so this twist edit remains within the active worker's
      // fixed 4D dimension; the separate test above covers a dimension flip.
      const previous = setSymmetryPlane(
        setSymmetryOrder(initialState(true), 5),
        "zw",
      );
      const state = applyScalarControl(previous, spec, "2");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(state.symmetry.twist).toBe(2);
      expect(fx.regenerateIfAutoUpdate).toHaveBeenCalledTimes(1);
      const command = { type: "setSymmetry", order: 5, plane: "zw", twist: 2 };
      expect(fx.postFlame).toHaveBeenCalledWith(command);
      expect(fx.postVoxel).toHaveBeenCalledWith(command);
    });
  });

  describe("finite tiling controls", () => {
    it("enables a dimension-matched default and clears the whole authored block", () => {
      const toggle = specById("tilingEnabledCheckbox");

      const flat = applyScalarControl(initialState(true), toggle, true);
      expect(flat.tiling).toEqual({ group: "a3" });

      const nonFlat = applyScalarControl(
        { ...initialState(true), transforms: pentatope() },
        toggle,
        true,
      );
      expect(nonFlat.tiling).toEqual({ group: "a4" });

      expect(applyScalarControl(nonFlat, toggle, false).tiling).toBeUndefined();
    });

    it("authors the fixed group and optional analytic clip independently", () => {
      const group = specById("tilingGroup");
      const clip = specById("tilingClip");
      const base = setTiling(initialState(true), { group: "a3" });
      const withGroup = applyScalarControl(base, group, "h3");
      expect(withGroup.tiling).toEqual({ group: "h3" });

      const catalog = BUNDLED_SHAPES[0];
      const withClip = applyScalarControl(withGroup, clip, catalog.kind);
      expect(withClip.tiling).toEqual({
        group: "h3",
        clip: catalog.shape,
      });
      expect(tilingClipSelectValue(withClip)).toBe(catalog.kind);

      const cleared = applyScalarControl(withClip, clip, "");
      expect(cleared.tiling).toEqual({ group: "h3" });
    });

    it("preserves an imported analytic clip until the user chooses a replacement", () => {
      const clip = specById("tilingClip");
      const authored = setTiling(initialState(true), {
        group: "b3",
        clip: {
          parts: [
            {
              primitive: { kind: "sphere", radius: 0.731 },
              combine: "union",
            },
          ],
        },
      });

      expect(tilingClipSelectValue(authored)).toBe("authored");
      expect(applyScalarControl(authored, clip, "authored")).toBe(authored);
    });

    it("keeps the finite group row inert on a lattice block while the shared clip row edits it", () => {
      const lattice = setTiling(initialState(true), {
        kind: "lattice",
        cellScale: 1.5,
      });

      expect(applyScalarControl(lattice, specById("tilingGroup"), "b3")).toBe(
        lattice,
      );
      const clipped = applyScalarControl(
        lattice,
        specById("tilingClip"),
        "gear",
      );
      expect(clipped.tiling).toEqual({
        kind: "lattice",
        cellScale: 1.5,
        clip: GEAR_SHAPE,
      });
      expect(
        applyScalarControl(lattice, specById("tilingEnabledCheckbox"), true),
      ).toBe(lattice);
      expect(
        applyScalarControl(lattice, specById("tilingEnabledCheckbox"), false)
          .tiling,
      ).toBeUndefined();
    });

    it("switches arms through the kind select, preserving the shared clip", () => {
      const finite = setTiling(initialState(true), {
        group: "h3",
        clip: GEAR_SHAPE,
      });
      const lattice = applyScalarControl(
        finite,
        specById("tilingKind"),
        "lattice",
      );
      expect(lattice.tiling).toEqual({
        kind: "lattice",
        cellScale: LATTICE_CELL_SCALE_DEFAULT,
        clip: GEAR_SHAPE,
      });
      expect(
        applyScalarControl(lattice, specById("tilingKind"), "lattice"),
      ).toBe(lattice);
      const back = applyScalarControl(
        lattice,
        specById("tilingKind"),
        "reflection",
      );
      expect(back.tiling).toEqual({ group: "a3", clip: GEAR_SHAPE });
      expect(
        applyScalarControl(finite, specById("tilingKind"), "reflection"),
      ).toBe(finite);
    });

    it("clamps and writes the lattice cell scale", () => {
      const lattice = setTiling(initialState(true), {
        kind: "lattice",
        cellScale: 1.5,
      });
      const edited = applyScalarControl(
        lattice,
        specById("tilingCellScaleSlider"),
        "2.4",
      );
      expect((edited.tiling as { cellScale: number }).cellScale).toBe(2.4);
      const clamped = applyScalarControl(
        lattice,
        specById("tilingCellScaleSlider"),
        "99",
      );
      expect((clamped.tiling as { cellScale: number }).cellScale).toBe(
        LATTICE_CELL_SCALE_MAX,
      );
      const floored = applyScalarControl(
        lattice,
        specById("tilingCellScaleSlider"),
        "0.1",
      );
      expect((floored.tiling as { cellScale: number }).cellScale).toBe(
        LATTICE_CELL_SCALE_MIN,
      );
      const finite = setTiling(initialState(true), { group: "a3" });
      expect(
        applyScalarControl(finite, specById("tilingCellScaleSlider"), "2"),
      ).toBe(finite);
    });

    it("pushes lattice cell scale live on Surface without restarting", () => {
      const spec = specById("tilingCellScaleSlider");
      const previous = setTiling(
        { ...initialState(true), renderMode: "surface" },
        { kind: "lattice", cellScale: 1.5 },
      );
      const state = applyScalarControl(previous, spec, "2.4");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.setSurfaceLatticeScale).toHaveBeenCalledWith(2.4);
      expect(fx.restartSurfaceRender).not.toHaveBeenCalled();
      expect(fx.refreshSurfaceEligibility).not.toHaveBeenCalled();
    });

    it("only stores lattice cell scale outside an active Surface session", () => {
      const spec = specById("tilingCellScaleSlider");
      const previous = setTiling(initialState(true), {
        kind: "lattice",
        cellScale: 1.5,
      });
      const state = applyScalarControl(previous, spec, "2.4");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.setSurfaceLatticeScale).not.toHaveBeenCalled();
      expect(fx.restartSurfaceRender).not.toHaveBeenCalled();
    });

    it("reads a mesh-backed bundled clip as authored, not a selectable kind", () => {
      const meshClipped = setTiling(initialState(true), {
        group: "a3",
        clip: STAR_PRISM_SHAPE,
      });
      expect(tilingClipSelectValue(meshClipped)).toBe("authored");
      const analytic = setTiling(initialState(true), {
        group: "a3",
        clip: GEAR_SHAPE,
      });
      expect(tilingClipSelectValue(analytic)).toBe("gear");
      const latticeClipped = setTiling(initialState(true), {
        kind: "lattice",
        cellScale: 1.5,
        clip: GEAR_SHAPE,
      });
      expect(tilingClipSelectValue(latticeClipped)).toBe("gear");
    });

    it("restarts kind, group, clip, and toggle edits only on an active Surface", () => {
      for (const id of [
        "tilingEnabledCheckbox",
        "tilingKind",
        "tilingGroup",
        "tilingClip",
      ]) {
        const spec = specById(id);
        expect(spec.persisted).not.toBe(false);

        for (const renderMode of ["points", "surface"] as const) {
          const state = setTiling(
            { ...initialState(true), renderMode },
            { group: "b3" },
          );
          const fx = mockEffects();
          spec.effect?.(state, fx, state);

          expect(fx.refreshSurfaceEligibility).toHaveBeenCalledTimes(1);
          expect(fx.restartSurfaceRender).toHaveBeenCalledTimes(
            renderMode === "surface" ? 1 : 0,
          );
        }
      }
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
        palette: "spectrum",
      });
    });

    it("flamePalette effect also tracks the auto background, alongside still posting setPalette", () => {
      const spec = specById("flamePalette");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, "spectrum");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      // Proves the auto-background call extended the effect rather than
      // replacing it: the pre-existing worker forward still fires alongside
      // the new call.
      expect(fx.trackAutoBackground).toHaveBeenCalledTimes(1);
      expect(fx.postFlame).toHaveBeenCalledWith({
        type: "setPalette",
        palette: "spectrum",
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
      expect(fx.postVoxel).not.toHaveBeenCalled();
      expect(fx.restartSolidRender).not.toHaveBeenCalled();
    });

    it("solidLightAzimuthSlider effect forwards the settled solid params to the scene", () => {
      const spec = specById("solidLightAzimuthSlider");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, "90");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.scene.setSolidParams).toHaveBeenCalledWith(state.solid);
      expect(state.surface).toBe(previous.surface);
      expect(fx.scene.setSurfaceParams).not.toHaveBeenCalled();
      expect(fx.postVoxel).not.toHaveBeenCalled();
      expect(fx.restartSolidRender).not.toHaveBeenCalled();
    });

    it("solidLightElevationSlider effect forwards the settled solid params to the scene", () => {
      const spec = specById("solidLightElevationSlider");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, "60");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.scene.setSolidParams).toHaveBeenCalledWith(state.solid);
      expect(fx.postVoxel).not.toHaveBeenCalled();
      expect(fx.restartSolidRender).not.toHaveBeenCalled();
    });

    it("solidAmbientSlider effect forwards the settled solid params to the scene", () => {
      const spec = specById("solidAmbientSlider");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, "0.4");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.scene.setSolidParams).toHaveBeenCalledWith(state.solid);
      expect(fx.postVoxel).not.toHaveBeenCalled();
      expect(fx.restartSolidRender).not.toHaveBeenCalled();
    });

    it.each([
      ["solidEnvLightSlider", "0.65"],
      ["solidFloorEnabledCheckbox", true],
      ["solidFloorPatternSelect", "checker"],
      ["solidFloorTileScaleSlider", "1.2"],
      ["solidFloorEmissionSlider", "1.5"],
    ] as const)("%s applies presentation only through the scene", (id, raw) => {
      const spec = specById(id);
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, raw);
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.scene.setSolidParams).toHaveBeenCalledWith(state.solid);
      expect(fx.postVoxel).not.toHaveBeenCalled();
      expect(fx.restartSolidRender).not.toHaveBeenCalled();
      expect(fx.scene.setSurfaceParams).not.toHaveBeenCalled();
    });

    it("solidPalette effect posts setPalette to the voxel worker", () => {
      const spec = specById("solidPalette");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, "spectrum");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.postVoxel).toHaveBeenCalledWith({
        type: "setPalette",
        palette: "spectrum",
      });
    });

    it("solidPalette effect also tracks the auto background", () => {
      const spec = specById("solidPalette");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, "spectrum");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.trackAutoBackground).toHaveBeenCalledTimes(1);
    });

    it("solidIterationsSlider effect posts setIterationsBudget to the voxel worker", () => {
      const spec = specById("solidIterationsSlider");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, "5");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.postVoxel).toHaveBeenCalledWith({
        type: "setIterationsBudget",
        iterations: SOLID_ITERATION_DETENTS[5],
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

    it("exportScale effect restarts the flame render when active and the scale actually changed", () => {
      const spec = specById("exportScale");
      const previous = { ...initialState(true), renderMode: "flame" as const };
      const state = applyScalarControl(previous, spec, "4");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.restartFlameRender).toHaveBeenCalled();
    });

    it("exportScale effect does not restart when active but the scale is unchanged", () => {
      const spec = specById("exportScale");
      const previous = { ...initialState(true), renderMode: "flame" as const };
      const state = applyScalarControl(
        previous,
        spec,
        String(previous.exportScale),
      );
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.restartFlameRender).not.toHaveBeenCalled();
    });

    it("exportScale effect does not restart while the points explorer is showing", () => {
      const spec = specById("exportScale");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, "4");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.restartFlameRender).not.toHaveBeenCalled();
    });

    it("exportScale effect does not restart the flame render from solid mode", () => {
      const spec = specById("exportScale");
      const previous = { ...initialState(true), renderMode: "solid" as const };
      const state = applyScalarControl(previous, spec, "2");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.restartFlameRender).not.toHaveBeenCalled();
      expect(fx.restartSolidRender).not.toHaveBeenCalled();
    });
  });

  describe("surface render controls", () => {
    it("surfaceDepthOfFieldCheckbox toggles presentation without restarting or pushing trace params", () => {
      const spec = specById("surfaceDepthOfFieldCheckbox");
      const previous = {
        ...initialState(true),
        renderMode: "surface" as const,
      };
      const state = applyScalarControl(previous, spec, true);
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(state.surface.depthOfField).toBe(true);
      expect(fx.scene.setSurfaceDepthOfField).toHaveBeenCalledExactlyOnceWith(
        true,
      );
      expect(fx.scene.setSurfaceParams).not.toHaveBeenCalled();
      expect(fx.restartSurfaceRender).not.toHaveBeenCalled();
    });

    it("surfaceAntialiasSlider restarts active refinement after a genuine change", () => {
      const spec = specById("surfaceAntialiasSlider");
      const previous = {
        ...initialState(true),
        renderMode: "surface" as const,
      };
      const state = applyScalarControl(previous, spec, "4");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(state.surface.antialiasSamples).toBe(16);
      expect(fx.restartSurfaceRender).toHaveBeenCalledTimes(1);
    });

    it("surfaceAntialiasSlider does not restart outside Surface or for an unchanged choice", () => {
      const spec = specById("surfaceAntialiasSlider");
      const points = initialState(true);
      const changed = applyScalarControl(points, spec, "4");
      const fx = mockEffects();

      spec.effect?.(changed, fx, points);
      expect(fx.restartSurfaceRender).not.toHaveBeenCalled();

      const surface = { ...points, renderMode: "surface" as const };
      const unchanged = applyScalarControl(surface, spec, "3");
      spec.effect?.(unchanged, fx, surface);
      expect(fx.restartSurfaceRender).not.toHaveBeenCalled();
    });

    it("surfaceLightAzimuthSlider effect forwards the settled surface params to the scene", () => {
      const spec = specById("surfaceLightAzimuthSlider");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, "90");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.scene.setSurfaceParams).toHaveBeenCalledWith(state.surface);
      expect(state.solid).toBe(previous.solid);
      expect(fx.scene.setSolidParams).not.toHaveBeenCalled();
    });

    it("surfaceLightElevationSlider effect forwards the settled surface params to the scene", () => {
      const spec = specById("surfaceLightElevationSlider");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, "60");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.scene.setSurfaceParams).toHaveBeenCalledWith(state.surface);
    });

    it("surfaceAmbientSlider effect forwards the settled surface params to the scene", () => {
      const spec = specById("surfaceAmbientSlider");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, "0.4");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.scene.setSurfaceParams).toHaveBeenCalledWith(state.surface);
    });

    it("surfaceEnvLightSlider effect forwards the settled surface params to the scene", () => {
      const spec = specById("surfaceEnvLightSlider");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, "0.7");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.scene.setSurfaceParams).toHaveBeenCalledWith(state.surface);
    });

    it("surfaceColorSpeedSlider effect forwards the settled surface params to the scene", () => {
      const spec = specById("surfaceColorSpeedSlider");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, "0.8");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.scene.setSurfaceParams).toHaveBeenCalledWith(state.surface);
    });

    it("surfaceColorSource effect pushes the settled params and the new LUT", () => {
      const spec = specById("surfaceColorSource");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, "height");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.scene.setSurfaceParams).toHaveBeenCalledWith(state.surface);
      expect(fx.scene.setSurfaceColorLUT).toHaveBeenCalledWith(
        surfaceColorLUT(state),
      );
    });

    it('surfaceColorSource effect does not push a LUT for "transform"', () => {
      const spec = specById("surfaceColorSource");
      const previous = {
        ...initialState(true),
        surface: {
          ...initialState(true).surface,
          colorSource: "height" as const,
        },
      };
      const state = applyScalarControl(previous, spec, "transform");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.scene.setSurfaceParams).toHaveBeenCalledWith(state.surface);
      expect(fx.scene.setSurfaceColorLUT).not.toHaveBeenCalled();
    });

    it("surfacePalette effect pushes the settled params and the new LUT", () => {
      const spec = specById("surfacePalette");
      const previous = {
        ...initialState(true),
        surface: {
          ...initialState(true).surface,
          colorSource: "palette" as const,
        },
      };
      const state = applyScalarControl(previous, spec, "aurora");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.scene.setSurfaceParams).toHaveBeenCalledWith(state.surface);
      expect(fx.scene.setSurfaceColorLUT).toHaveBeenCalledWith(
        surfaceColorLUT(state),
      );
    });

    it("surfacePalette effect also tracks the auto background", () => {
      const spec = specById("surfacePalette");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, "aurora");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.trackAutoBackground).toHaveBeenCalledTimes(1);
    });
  });
});

describe("surfaceColorLUT", () => {
  it.each(["palette", "rings", "sheets", "shapeTrap"] as const)(
    'classifies "%s" as a Surface-own-palette source',
    (source) => expect(surfaceColorSourceUsesOwnPalette(source)).toBe(true),
  );

  it.each(["transform", "height", "radius"] as const)(
    'does not classify "%s" as a Surface-own-palette source',
    (source) => expect(surfaceColorSourceUsesOwnPalette(source)).toBe(false),
  );

  it('returns null for the "transform" colorSource', () => {
    const state = initialState(true);
    expect(state.surface.colorSource).toBe("transform"); // sanity: the default
    expect(surfaceColorLUT(state)).toBeNull();
  });

  it('returns a 768-length Float32Array for the "palette" colorSource', () => {
    const state = {
      ...initialState(true),
      surface: {
        ...initialState(true).surface,
        colorSource: "palette" as const,
        paletteId: "aurora" as const,
      },
    };
    const lut = surfaceColorLUT(state);
    expect(lut).not.toBeNull();
    expect(lut!.length).toBe(768);
  });

  it('falls back to the default gradient for the "palette" colorSource when paletteId is "legacy"', () => {
    // "legacy" has no gradient LUT (buildPaletteLUT returns null for it) —
    // the surface palette <select> never actually offers it, but a decoded
    // scene could still carry one, and this source always needs a LUT.
    const state = {
      ...initialState(true),
      surface: {
        ...initialState(true).surface,
        colorSource: "palette" as const,
        paletteId: "legacy" as const,
      },
    };
    const lut = surfaceColorLUT(state);
    expect(lut).not.toBeNull();
    expect(lut).toEqual(buildPaletteLUT(DEFAULT_SOLID_PALETTE));
  });

  it('returns the identical LUT as "palette" for the "rings" colorSource (same paletteId)', () => {
    // rings and palette read different coordinates off the same descent, but
    // both sample the user's chosen gradient — they must share one LUT.
    const base = initialState(true);
    const paletteState = {
      ...base,
      surface: {
        ...base.surface,
        colorSource: "palette" as const,
        paletteId: "aurora" as const,
      },
    };
    const ringsState = {
      ...base,
      surface: {
        ...base.surface,
        colorSource: "rings" as const,
        paletteId: "aurora" as const,
      },
    };
    const lut = surfaceColorLUT(ringsState);
    expect(lut).not.toBeNull();
    expect(lut!.length).toBe(768);
    expect(lut).toEqual(surfaceColorLUT(paletteState));
  });

  it('returns the identical LUT as "palette" for the "sheets" colorSource (same paletteId)', () => {
    const base = initialState(true);
    const paletteState = {
      ...base,
      surface: {
        ...base.surface,
        colorSource: "palette" as const,
        paletteId: "aurora" as const,
      },
    };
    const sheetsState = {
      ...base,
      surface: {
        ...base.surface,
        colorSource: "sheets" as const,
        paletteId: "aurora" as const,
      },
    };
    const lut = surfaceColorLUT(sheetsState);
    expect(lut).not.toBeNull();
    expect(lut!.length).toBe(768);
    expect(lut).toEqual(surfaceColorLUT(paletteState));
  });

  it('returns the identical Custom LUT as "palette" for the "shapeTrap" colorSource', () => {
    const base = {
      ...initialState(true),
      customPalette: {
        stops: [
          [1, 0, 0],
          [0, 0, 1],
        ] as const,
      },
    };
    const paletteState = {
      ...base,
      surface: {
        ...base.surface,
        colorSource: "palette" as const,
        paletteId: "custom" as const,
      },
    };
    const shapeTrapState = {
      ...base,
      surface: {
        ...base.surface,
        colorSource: "shapeTrap" as const,
        paletteId: "custom" as const,
      },
    };

    expect(surfaceColorLUT(shapeTrapState)).toEqual(
      surfaceColorLUT(paletteState),
    );
  });

  it('respects colorGamma for the "height" colorSource, matching a direct buildColorModeLUT call', () => {
    const state = {
      ...initialState(true),
      colorGamma: 2.4,
      surface: {
        ...initialState(true).surface,
        colorSource: "height" as const,
      },
    };
    expect(surfaceColorLUT(state)).toEqual(
      buildColorModeLUT(
        "height",
        state.colorGamma,
        resolvePalette(state.rampPaletteId, state.customPalette),
      ),
    );
  });
});

describe("commit", () => {
  it("numPointsSlider commit calls regenerateIfAutoUpdate", () => {
    const spec = specById("numPointsSlider");
    if (spec.kind !== "range") throw new Error("expected a range spec");
    const state = applyScalarControl(initialState(true), spec, "500");
    const fx = mockEffects();

    spec.commit?.(state, fx, state);

    expect(fx.regenerateIfAutoUpdate).toHaveBeenCalledTimes(1);
  });

  it("numPointsSlider is the only entry that declares a commit effect", () => {
    const withCommit = SCALAR_CONTROLS.filter(
      (s) => s.kind === "range" && s.commit !== undefined,
    ).map((s) => s.id);

    expect(withCommit).toEqual(["numPointsSlider"]);
  });
});

describe("table policy", () => {
  it("morphDetail, autoUpdate, adaptiveResolutionCheckbox, and exportScale are the only entries marked persisted: false", () => {
    // Balloon's shared checkbox/radius pair left this list when the feature
    // graduated from session-only view state to persisted scene content.
    const neverPersisted = SCALAR_CONTROLS.filter(
      (s) => s.persisted === false,
    ).map((s) => s.id);

    expect(neverPersisted).toEqual([
      "morphDetail",
      "autoUpdate",
      "adaptiveResolutionCheckbox",
      "exportScale",
    ]);
  });

  it("autoUpdate apply flips state.autoUpdate", () => {
    const spec = specById("autoUpdate");
    const initial = initialState(true);

    const state = applyScalarControl(initial, spec, false);

    expect(state.autoUpdate).toBe(false);
  });

  it("adaptiveResolutionCheckbox apply flips state.adaptiveResolution", () => {
    const spec = specById("adaptiveResolutionCheckbox");
    const initial = initialState(true);

    const state = applyScalarControl(initial, spec, false);

    expect(state.adaptiveResolution).toBe(false);
  });

  it("balloonEchoCheckbox apply flips state.balloonEcho", () => {
    const spec = specById("balloonEchoCheckbox");
    const initial = initialState(true);

    const state = applyScalarControl(initial, spec, true);

    expect(state.balloonEcho).toBe(true);
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

    // The symmetry entries left the flat set when the 4D chaos game got a
    // kaleidoscope of its own: it is live in both views now (a w-plane or
    // twist even makes the system 4D), so its controls carry no view guard.
    expect(flatIds).toEqual(["colorMode", "solidColorMode"].sort());
    expect(nonFlatIds).toEqual(
      ["fourDColor", "fourDDepthFadeToggle", "solidFourDColor"].sort(),
    );
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
