// @vitest-environment jsdom
import {
  PRESET_FINALS,
  PRESET_SCHEDULES,
  PRESET_SYMMETRIES,
  PRESET_TILINGS,
  PRESET_TRAPS,
  presetTransforms,
  type Preset,
} from "../fractal/presets";
import type { SymmetryParams } from "../fractal/types";
import { decodeScene, encodeScene, fromSnapshot, toSnapshot } from "./persist";
import { deriveSurfaceEligibility } from "./surface-eligibility";
import { RENDER_MODES, initialState, type AppState } from "./state";

const NO_SYMMETRY: SymmetryParams = { order: 1, plane: "xy" };

function rawScene(payload: unknown): string {
  const base64 = btoa(JSON.stringify(payload))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  return `v1=${base64}`;
}

function presetEligibility(preset: Preset, computeAvailable: boolean) {
  return deriveSurfaceEligibility(
    presetTransforms(preset),
    PRESET_FINALS[preset]?.() ?? null,
    PRESET_SYMMETRIES[preset] ?? NO_SYMMETRY,
    { computeAvailable },
    PRESET_SCHEDULES[preset]?.() ?? null,
    PRESET_TRAPS[preset]?.() ?? null,
    PRESET_TILINGS[preset] ?? null,
  );
}

describe("renderer identity contracts", () => {
  it("keeps Solid as the only volumetric sampled-density renderer", () => {
    const state = initialState(false);
    const renderSettings = {
      flame: state.flame,
      solid: state.solid,
      surface: state.surface,
    };
    const sampledDensitySignature = [
      "resolution",
      "iterations",
      "threshold",
    ] as const;

    expect(RENDER_MODES).toEqual(["points", "flame", "solid", "surface"]);
    expect(
      Object.entries(renderSettings)
        .filter(([, settings]) =>
          sampledDensitySignature.every((key) => key in settings),
        )
        .map(([mode]) => mode),
    ).toEqual(["solid"]);

    // Surface is the analytic marcher. In particular, it must not silently
    // inherit Solid's density-grid convergence controls just because the two
    // modes share lighting vocabulary and a default palette.
    for (const key of sampledDensitySignature) {
      expect(state.surface).not.toHaveProperty(key);
    }
  });
});

describe("Solid document compatibility contracts", () => {
  it("restores Solid defaults and authored color from a document predating the Solid block", () => {
    const current = toSnapshot(initialState(false));
    const {
      solid: _solid,
      surface: _surface,
      fourDColor: _fourDColor,
      rampPaletteId: _rampPaletteId,
      colorGamma: _colorGamma,
      ...legacy
    } = current;
    const decoded = decodeScene(rawScene(legacy));

    expect(decoded).not.toBeNull();
    expect(decoded!.solid).toEqual({
      resolution: 192,
      iterations: 20_000_000,
      threshold: 0.3,
      lightAzimuth: 135,
      lightElevation: 50,
      ambient: 0.25,
      envLight: 0,
      floorEnabled: false,
      floorPattern: "solid",
      floorTileScale: 0.64,
      floorEmission: 0,
      paletteId: "spectrum",
    });
    expect(decoded).toMatchObject({
      colorMode: "transform",
      fourDColor: "wBlueOrange",
      rampPaletteId: "legacy",
      colorGamma: 1,
    });
  });

  it("round-trips current Solid density, lighting, and 3D/4D color settings without persisting the active mode", () => {
    const authored: AppState = {
      ...initialState(false),
      renderMode: "solid",
      colorMode: "position",
      fourDColor: "radius",
      colorGamma: 1.75,
      rampPaletteId: "ember",
      positionAxisColors: {
        x: [0.2, 0.4, 0.6],
        y: [1, 0, 0],
        z: [0, 0.4, 1],
      },
      solid: {
        ...initialState(false).solid,
        resolution: 224,
        iterations: 42_000_000,
        threshold: 0.61,
        lightAzimuth: -45,
        lightElevation: 70,
        ambient: 0.5,
        paletteId: "aurora",
      },
    };

    const snapshot = toSnapshot(authored);
    expect(snapshot).not.toHaveProperty("renderMode");

    const decoded = decodeScene(encodeScene(snapshot));
    expect(decoded).not.toBeNull();
    const restored = fromSnapshot(decoded!, initialState(false));

    expect(restored.renderMode).toBe("points");
    expect(restored.solid).toEqual(authored.solid);
    expect(restored).toMatchObject({
      colorMode: "position",
      fourDColor: "radius",
      colorGamma: 1.75,
      rampPaletteId: "ember",
      positionAxisColors: authored.positionAxisColors,
    });
  });
});

describe("analytic Surface routing contracts", () => {
  it.each([
    ["default", "ifs", "eligible"],
    ["mandelboxClassic", "escape", "degraded"],
    ["mandelbulbClassic", "bulb", "degraded"],
    ["pentatope", "ifs4", "eligible"],
    ["mandelboxBrick", "escape4", "degraded"],
  ] as const)("keeps %s on its existing %s route", (preset, kind, status) => {
    expect(presetEligibility(preset, true)).toMatchObject({ kind, status });
  });

  it.each([
    ["default", "ifs"],
    ["mandelboxKifs", "ifs"],
    ["mandelboxClassic", "escape"],
    ["mandelbulbClassic", "bulb"],
    ["pentatope", "ifs4"],
  ] as const)(
    "keeps the analytic WebGL fallback for %s (%s) when compute is absent",
    (preset, kind) => {
      const withCompute = presetEligibility(preset, true);
      const withoutCompute = presetEligibility(preset, false);

      expect(withCompute.status).not.toBe("ineligible");
      expect(withoutCompute.status).not.toBe("ineligible");
      expect(withoutCompute.kind).toBe(kind);
    },
  );

  it("keeps 4D fold and escape routes compute-only", () => {
    const foldSymmetry: SymmetryParams = { order: 2, plane: "xw" };
    const foldWithCompute = deriveSurfaceEligibility(
      presetTransforms("mandelboxKifs"),
      null,
      foldSymmetry,
      { computeAvailable: true },
    );
    const foldWithoutCompute = deriveSurfaceEligibility(
      presetTransforms("mandelboxKifs"),
      null,
      foldSymmetry,
      { computeAvailable: false },
    );

    expect(foldWithCompute).toMatchObject({
      status: "eligible",
      kind: "ifs4",
    });
    expect(foldWithoutCompute).toMatchObject({
      status: "ineligible",
      kind: null,
    });
    expect(foldWithoutCompute.note).toContain("WebGPU compute");

    expect(presetEligibility("mandelboxBrick", false)).toMatchObject({
      status: "ineligible",
      kind: null,
    });
  });
});
