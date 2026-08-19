import {
  PRESET_FINALS,
  PRESET_NAMES,
  PRESET_RENDER_HINTS,
  PRESET_SYMMETRIES,
  presetTransforms,
  sierpinskiTetrahedron,
} from "../fractal/presets";
import type { Preset } from "../fractal/presets";
import type { SymmetryParams, Transform } from "../fractal/types";
import { deriveSurfaceEligibility } from "./surface-eligibility";
import { SURFACE_MAX_MAPS } from "./surface-material";

const NO_SYMMETRY: SymmetryParams = { order: 1, plane: "xy" };

/** Derive a preset exactly as main.ts would present it: factory transforms,
 * its side-table final lens and kaleidoscope when it carries them. */
function derivePreset(
  preset: Preset,
  opts: { computeAvailable: boolean } = { computeAvailable: true },
) {
  return deriveSurfaceEligibility(
    presetTransforms(preset),
    PRESET_FINALS[preset]?.() ?? null,
    PRESET_SYMMETRIES[preset] ?? NO_SYMMETRY,
    opts,
  );
}

describe("deriveSurfaceEligibility over the shipped presets", () => {
  it("admits every surface-hinted preset (none refuses its own showcase)", () => {
    const surfacePresets = PRESET_NAMES.filter(
      (p) => PRESET_RENDER_HINTS[p] === "surface",
    );
    expect(surfacePresets.length).toBeGreaterThan(0);
    for (const preset of surfacePresets) {
      const { status, note } = derivePreset(preset);
      expect(
        status,
        `${preset} should pass its own gate (note: ${note ?? "none"})`,
      ).not.toBe("ineligible");
    }
  });

  it("routes the flat IFS fold showcase to the ifs kind", () => {
    expect(derivePreset("mandelboxKifs").kind).toBe("ifs");
  });

  it("routes the canonical Mandelbox to the escape kind, naming the object", () => {
    const result = derivePreset("mandelboxClassic");
    expect(result.status).toBe("degraded");
    expect(result.kind).toBe("escape");
    expect(result.note).toContain("canonical Mandelbox");
  });

  it("names a hybrid chain as folds AND power maps, never 'these N folds'", () => {
    const result = derivePreset("hybridChainQuaternion");
    expect(result.status).toBe("degraded");
    expect(result.kind).toBe("escape");
    expect(result.note).toContain("hybrid formula chain");
  });

  it("routes the Mandelbulb trio to the bulb kind", () => {
    const result = derivePreset("mandelbulbClassic");
    expect(result.status).toBe("degraded");
    expect(result.kind).toBe("bulb");
    expect(result.note).toContain("Mandelbulb");
  });

  it("routes a 4D IFS preset to the ifs4 kind", () => {
    expect(derivePreset("pentatope").kind).toBe("ifs4");
  });

  it("routes the 4D escape presets to the escape4 kind", () => {
    for (const preset of [
      "mandelboxBrick",
      "mandelboxColumn",
      "hybridChainShells",
    ] as const) {
      const result = derivePreset(preset);
      expect(result.status, preset).toBe("degraded");
      expect(result.kind, preset).toBe("escape4");
    }
  });

  it("refuses a 4D escape chain without compute, and says why", () => {
    const result = derivePreset("mandelboxBrick", { computeAvailable: false });
    expect(result.status).toBe("ineligible");
    expect(result.kind).toBe(null);
    expect(result.note).toContain("WebGPU compute");
  });

  it("keeps a plain 4D IFS eligible without compute (the fragment fallback exists)", () => {
    expect(
      derivePreset("pentatope", { computeAvailable: false }).status,
    ).not.toBe("ineligible");
  });
});

describe("deriveSurfaceEligibility caps and refusal notes", () => {
  it("refuses past the tracer's map cap, counting only active maps", () => {
    const base = sierpinskiTetrahedron();
    const crowd: Transform[] = [];
    for (let i = 0; i < SURFACE_MAX_MAPS + 1; i++) {
      crowd.push({ ...base[i % base.length], id: i + 1 });
    }
    // One extra ZERO-weight map must not count against the cap...
    const overCap = deriveSurfaceEligibility(
      [...crowd, { ...base[0], id: 99, weight: 0 }],
      null,
      NO_SYMMETRY,
      { computeAvailable: true },
    );
    expect(overCap.status).toBe("ineligible");
    expect(overCap.kind).toBe(null);
    expect(overCap.note).toBe(
      `${SURFACE_MAX_MAPS + 1} maps (the surface tracer carries at most ${SURFACE_MAX_MAPS})`,
    );
    // ...and exactly at the cap the gate admits.
    expect(
      deriveSurfaceEligibility(
        crowd.slice(0, SURFACE_MAX_MAPS),
        null,
        NO_SYMMETRY,
        {
          computeAvailable: true,
        },
      ).status,
    ).toBe("eligible");
  });

  it("appends the ONE qsquare hint in both the 3D and 4D refusal arms", () => {
    // A lone quaternion square is refused by every gate (the chain wants it
    // BESIDE a fold), and the hint naming the way out must be the same
    // sentence whichever dimension's arm produced it — the two used to be
    // separate literals 147 lines apart, the only duplicated prose in
    // main.ts.
    const qsquare: Transform[] = [
      {
        id: 1,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        variations: [{ type: "qsquare", weight: 1 }],
      },
    ];
    const flat = deriveSurfaceEligibility(qsquare, null, NO_SYMMETRY, {
      computeAvailable: true,
    });
    // An xw kaleidoscope makes the same document non-flat, routing it
    // through the 4D refusal arm instead.
    const nonFlat = deriveSurfaceEligibility(
      qsquare,
      null,
      { order: 2, plane: "xw" },
      { computeAvailable: true },
    );
    const hint =
      "a quaternion square renders only as a link in an escape-time chain — give it a map of its own beside a fold";
    expect(flat.status).toBe("ineligible");
    expect(nonFlat.status).toBe("ineligible");
    expect(flat.note?.endsWith(hint)).toBe(true);
    expect(nonFlat.note?.endsWith(hint)).toBe(true);
  });
});
