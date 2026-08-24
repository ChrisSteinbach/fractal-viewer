import {
  PRESET_FINALS,
  PRESET_NAMES,
  PRESET_RENDER_HINTS,
  PRESET_SCHEDULES,
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
    PRESET_SCHEDULES[preset]?.() ?? null,
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

describe("deriveSurfaceEligibility chaos rows", () => {
  it("refuses the chi presets with the surface gate's reason in the note, routing nowhere", () => {
    // Both fern|sponge presets: contractive IFS shapes that would be
    // Surface-eligible but for their rows — the gate refusal (not the
    // escape/bulb complements, which refuse chi too) is what the user reads.
    for (const preset of ["fernSponge", "fernSpongeLeak"] as const) {
      const result = deriveSurfaceEligibility(
        presetTransforms(preset),
        null,
        NO_SYMMETRY,
        { computeAvailable: true },
      );
      expect(result.status).toBe("ineligible");
      expect(result.kind).toBeNull();
      expect(result.note).toContain(
        "chaos rows constrain the attractor (Surface would march the unconstrained object)",
      );
    }
  });

  it("refuses a chi-carrying escape-shaped document too — no arm slips through to march the wrong object", () => {
    // A non-contracting mandelbox with a row: the IFS gate refuses (chi +
    // does not contract), and the escape complement must NOT then admit it.
    const mandelbox: Transform = {
      id: 0,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      variations: [{ type: "mandelbox", weight: 2 }],
      chaos: [0.5],
    };
    const result = deriveSurfaceEligibility([mandelbox], null, NO_SYMMETRY, {
      computeAvailable: true,
    });
    expect(result.status).toBe("ineligible");
    expect(result.kind).toBeNull();
    expect(result.note).toContain("chaos rows");
  });
});

describe("deriveSurfaceEligibility and the scheduled-hybrid block", () => {
  const pairB: Transform[] = [
    {
      id: 0,
      position: [-0.5, 0, 0],
      rotation: [0, 0, 0],
      scale: [0.5, 0.5, 0.5],
    },
    {
      id: 1,
      position: [0.5, 0, 0],
      rotation: [0, 0, 0],
      scale: [0.5, 0.5, 0.5],
    },
  ];

  it("refuses any document carrying a live schedule, whatever the system's own shape", () => {
    const result = deriveSurfaceEligibility(
      sierpinskiTetrahedron(),
      null,
      NO_SYMMETRY,
      { computeAvailable: true },
      { transforms: pairB, depth: 3 },
    );
    expect(result.status).toBe("ineligible");
    expect(result.kind).toBeNull();
    expect(result.note).toContain("hybrid schedule");
    expect(result.note).toContain("system A alone");
  });

  it("refuses the shipped Sponge of Ferns preset by its side-table schedule", () => {
    const result = derivePreset("spongeOfFerns");
    expect(result.status).toBe("ineligible");
    expect(result.note).toContain("hybrid schedule");
  });

  it("a dead block (depth 0 / empty B) refuses nothing — the one consumption domain decides", () => {
    const clean = deriveSurfaceEligibility(
      sierpinskiTetrahedron(),
      null,
      NO_SYMMETRY,
      { computeAvailable: true },
    );
    for (const dead of [
      null,
      { transforms: pairB, depth: 0 },
      { transforms: [], depth: 3 },
    ]) {
      const result = deriveSurfaceEligibility(
        sierpinskiTetrahedron(),
        null,
        NO_SYMMETRY,
        { computeAvailable: true },
        dead,
      );
      expect(result).toEqual(clean);
    }
  });
});

describe("deriveSurfaceEligibility shape emitters", () => {
  it("refuses the gearworks preset with the surface gate's emitter reason in the note, routing nowhere", () => {
    const result = derivePreset("gearworks");
    expect(result.status).toBe("ineligible");
    expect(result.kind).toBeNull();
    expect(result.note).toContain("map 5 is a shape emitter (condensation)");
  });

  it("refuses an emitter-carrying escape-shaped document too — no arm slips through to march the plain object", () => {
    // A non-contracting mandelbox carrying an emitter beside its fold: the
    // IFS gate refuses, and the escape complement must NOT then admit it
    // (its own explicit emitter refusal is what closes that door).
    const mandelbox: Transform = {
      id: 0,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      variations: [{ type: "mandelbox", weight: 2 }],
      emitter: {
        parts: [
          { primitive: { kind: "sphere", radius: 0.5 }, combine: "union" },
        ],
      },
    };
    const result = deriveSurfaceEligibility([mandelbox], null, NO_SYMMETRY, {
      computeAvailable: true,
    });
    expect(result.status).toBe("ineligible");
    expect(result.kind).toBeNull();
    expect(result.note).toContain("shape emitter");
  });

  it("refuses an emitter-carrying 4D document through the 4D analyzers", () => {
    const transforms: Transform[] = sierpinskiTetrahedron().map((t, i) =>
      i === 0
        ? { ...t, w: { rotation: { xw: 0.3 } } }
        : i === 1
          ? {
              ...t,
              emitter: {
                parts: [
                  {
                    primitive: { kind: "sphere", radius: 0.5 },
                    combine: "union",
                  },
                ],
              },
            }
          : t,
    );
    const result = deriveSurfaceEligibility(transforms, null, NO_SYMMETRY, {
      computeAvailable: true,
    });
    expect(result.status).toBe("ineligible");
    expect(result.kind).toBeNull();
    expect(result.note).toContain("map 2 is a shape emitter (condensation)");
  });
});
