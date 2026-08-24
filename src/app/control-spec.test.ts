import {
  applyScalarControl,
  SCALAR_CONTROLS,
  surfaceColorLUT,
} from "./control-spec";
import type { ControlEffects, ScalarControlSpec } from "./control-spec";
import {
  DEFAULT_SOLID_PALETTE,
  FLAME_ITERATION_DETENTS,
  initialState,
  MAX_COLOR_GAMMA,
  MAX_NUM_POINTS,
  MIN_NUM_POINTS,
  nearestFlameIterationDetentIndex,
  setSymmetryOrder,
} from "./state";
import { buildColorModeLUT } from "../fractal/color";
import { buildPaletteLUT, resolvePalette } from "../fractal/palette";
import { resolveBackground } from "./background";

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
    restartSurfaceRender: vi.fn(),
    applyBackground: vi.fn(),
    trackAutoBackground: vi.fn(),
    cancelBalloonSweep: vi.fn(),
  };
}

describe("applyScalarControl: parsing/mapping", () => {
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

  it("flameBalloonRadiusSlider apply writes the SAME numeric balloonRadius", () => {
    const spec = specById("flameBalloonRadiusSlider");

    const state = applyScalarControl(initialState(true), spec, "0.9");

    expect(state.balloonRadius).toBe(0.9);
  });

  it.each(["balloonPalette", "flameBalloonPalette", "surfaceBalloonPalette"])(
    "%s apply writes the shared balloon selection",
    (id) => {
      const state = applyScalarControl(
        initialState(true),
        specById(id),
        "moss",
      );
      expect(state.balloonPaletteId).toBe("moss");
    },
  );

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

  it("surfaceBalloonTintStrength apply parses the raw string into the SAME numeric balloonTintStrength", () => {
    const spec = specById("surfaceBalloonTintStrength");

    const state = applyScalarControl(initialState(true), spec, "0.5");

    expect(state.balloonTintStrength).toBe(0.5);
  });

  it("flameBalloonTintStrength apply parses into the shared balloonTintStrength", () => {
    const spec = specById("flameBalloonTintStrength");

    const state = applyScalarControl(initialState(true), spec, "0.5");

    expect(state.balloonTintStrength).toBe(0.5);
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

  it("rampPalette select apply sets rampPaletteId from the option value", () => {
    const spec = specById("rampPalette");

    const state = applyScalarControl(initialState(true), spec, "ember");

    expect(state.rampPaletteId).toBe("ember");
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

    it.each(["balloonPalette", "flameBalloonPalette", "surfaceBalloonPalette"])(
      "%s resolves one shared LUT, forwards Flame through worker semantics, and does not restart Flame directly",
      (id) => {
        const spec = specById(id);
        const previous = { ...initialState(true), balloonEcho: true };
        const state = applyScalarControl(previous, spec, "aurora");
        const fx = mockEffects();

        spec.effect?.(state, fx, previous);

        expect(fx.scene.setBalloonPalette).toHaveBeenCalledWith(
          buildPaletteLUT("aurora"),
        );
        expect(fx.postFlame).toHaveBeenCalledWith({
          type: "setBalloonPalette",
          palette: "aurora",
        });
        expect(fx.restartFlameRender).not.toHaveBeenCalled();
        expect(fx.restartSurfaceRender).not.toHaveBeenCalled();
      },
    );

    it("sends null/omitted palette for Inherit", () => {
      const spec = specById("balloonPalette");
      const previous = {
        ...initialState(true),
        balloonEcho: true,
        balloonPaletteId: "aurora" as const,
      };
      const state = applyScalarControl(previous, spec, "inherit");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.scene.setBalloonPalette).toHaveBeenCalledWith(null);
      expect(fx.postFlame).toHaveBeenCalledWith({
        type: "setBalloonPalette",
      });
    });

    it("resolves Custom from the independent balloon payload, never the primary slot", () => {
      const spec = specById("flameBalloonPalette");
      const balloonCustomPalette = {
        stops: [
          [1, 0, 0],
          [0, 0, 1],
        ],
      } as const;
      const previous = {
        ...initialState(true),
        balloonEcho: true,
        balloonCustomPalette,
        customPalette: {
          stops: [
            [0, 1, 0],
            [1, 1, 0],
          ],
        },
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

    it("keeps palette authoring renderer-inert while the balloon is off", () => {
      const spec = specById("surfaceBalloonPalette");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, "sunset");
      const fx = mockEffects();

      expect(state.balloonPaletteId).toBe("sunset");
      spec.effect?.(state, fx, previous);

      expect(fx.scene.setBalloonPalette).not.toHaveBeenCalled();
      expect(fx.postFlame).not.toHaveBeenCalled();
      expect(fx.restartFlameRender).not.toHaveBeenCalled();
      expect(fx.restartSurfaceRender).not.toHaveBeenCalled();
    });

    it("restarts an active Surface session after pushing a changed palette", () => {
      const spec = specById("surfaceBalloonPalette");
      const previous = {
        ...initialState(true),
        renderMode: "surface" as const,
        balloonEcho: true,
      };
      const state = applyScalarControl(previous, spec, "dusk");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.scene.setBalloonPalette).toHaveBeenCalledTimes(1);
      expect(fx.restartSurfaceRender).toHaveBeenCalledTimes(1);
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

    it("surfaceBalloonCheckbox effect re-enters the surface session and cancels an in-flight sweep", () => {
      const spec = specById("surfaceBalloonCheckbox");
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

    it("flameBalloonCheckbox effect keeps the Points echo synced and restarts Flame accumulation", () => {
      const spec = specById("flameBalloonCheckbox");
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

    it("flameBalloonRadiusSlider effect syncs both scene arms and restarts Flame accumulation", () => {
      const spec = specById("flameBalloonRadiusSlider");
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

    it("flameBalloonTintStrength effect syncs the scene tint and restarts Flame accumulation", () => {
      const spec = specById("flameBalloonTintStrength");
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

    it("surfaceBalloonRadiusSlider effect forwards the radius through the scene's cheap path and cancels an in-flight sweep", () => {
      const spec = specById("surfaceBalloonRadiusSlider");
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

    it("surfaceBalloonTintStrength effect forwards the SAME tint/strength through the SAME scene method, with no session re-enter", () => {
      const spec = specById("surfaceBalloonTintStrength");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, "0.5");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.scene.setBalloonTint).toHaveBeenCalledWith([0, 0, 0], 0.5);
      // Deliberately NOT a variant-level change, unlike
      // surfaceBalloonCheckbox above: the tint is a uniform/spec value the
      // already-compiled SURFACE_BALLOON arm reads, so
      // surfaceBalloonRadiusSlider's cheap live path applies here too.
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
      // Order 5 first: setSymmetryTwist caps at order - 1, so the default
      // order-1 state would store no twist at all.
      const previous = setSymmetryOrder(initialState(true), 5);
      const state = applyScalarControl(previous, spec, "2");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(state.symmetry.twist).toBe(2);
      expect(fx.regenerateIfAutoUpdate).toHaveBeenCalledTimes(1);
      const command = { type: "setSymmetry", order: 5, plane: "xz", twist: 2 };
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
    it("surfaceLightAzimuthSlider effect forwards the settled surface params to the scene", () => {
      const spec = specById("surfaceLightAzimuthSlider");
      const previous = initialState(true);
      const state = applyScalarControl(previous, spec, "90");
      const fx = mockEffects();

      spec.effect?.(state, fx, previous);

      expect(fx.scene.setSurfaceParams).toHaveBeenCalledWith(state.surface);
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
    // The balloon pairs (balloonEchoCheckbox/balloonRadiusSlider,
    // surfaceBalloonCheckbox/surfaceBalloonRadiusSlider) left this list when
    // the balloon graduated from session-only view state to persisted scene
    // content.
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
    expect(flatIds).toEqual(
      ["colorGammaSlider", "colorMode", "renderStyle"].sort(),
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
