import {
  PRESET_FINALS,
  PRESET_NAMES,
  PRESET_RENDER_HINTS,
  PRESET_SCHEDULES,
  PRESET_SYMMETRIES,
  PRESET_TRAPS,
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
    PRESET_TRAPS[preset]?.() ?? null,
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

describe("deriveSurfaceEligibility for shape-trap geometry", () => {
  const geometryTrap = PRESET_TRAPS.foldChainGear!();
  const colorTrap = { ...geometryTrap, geometry: false };

  it("admits the shipped conformal fold-chain geometry preset and a 4D conformal fold", () => {
    expect(derivePreset("foldChainGear")).toMatchObject({
      status: "degraded",
      kind: "escape",
    });
    expect(
      deriveSurfaceEligibility(
        presetTransforms("mandelboxBrick"),
        null,
        NO_SYMMETRY,
        { computeAvailable: true },
        null,
        geometryTrap,
      ),
    ).toMatchObject({ status: "degraded", kind: "escape4" });
  });

  it("refuses geometry on 3D and 4D power chains with the color-only way out", () => {
    for (const preset of ["hybridChainCube", "hybridChainShells"] as const) {
      const result = deriveSurfaceEligibility(
        presetTransforms(preset),
        null,
        NO_SYMMETRY,
        { computeAvailable: true },
        null,
        geometryTrap,
      );
      expect(result.status, preset).toBe("ineligible");
      expect(result.kind, preset).toBeNull();
      expect(result.note, preset).toContain("fold-only conformal escape chain");
      expect(result.note, preset).toContain("power maps are unsupported");
      expect(result.note, preset).toContain("keep this trap as a color source");
    }
  });

  it("refuses geometry on the Mandelbulb while its color-only trap remains routable", () => {
    const transforms = presetTransforms("mandelbulbClassic");
    const refused = deriveSurfaceEligibility(
      transforms,
      null,
      NO_SYMMETRY,
      { computeAvailable: true },
      null,
      geometryTrap,
    );
    expect(refused.status).toBe("ineligible");
    expect(refused.note).toContain("the Mandelbulb is a power map");

    const colored = deriveSurfaceEligibility(
      transforms,
      null,
      NO_SYMMETRY,
      { computeAvailable: true },
      null,
      colorTrap,
    );
    expect(colored).toMatchObject({ status: "degraded", kind: "bulb" });
  });

  it("refuses anisotropic fold geometry in both dimensions without refusing color", () => {
    for (const preset of ["foldChain", "mandelboxBrick"] as const) {
      const transforms = presetTransforms(preset).map((transform, i) =>
        i === 0
          ? { ...transform, scale: [2, 1, 1] as [number, number, number] }
          : transform,
      );
      const refused = deriveSurfaceEligibility(
        transforms,
        null,
        NO_SYMMETRY,
        { computeAvailable: true },
        null,
        geometryTrap,
      );
      expect(refused.status, preset).toBe("ineligible");
      expect(refused.note, preset).toContain(
        "map 1 is anisotropic (ratio 2.00)",
      );
      expect(refused.note, preset).toContain(
        "keep this trap as a color source",
      );

      expect(
        deriveSurfaceEligibility(
          transforms,
          null,
          NO_SYMMETRY,
          { computeAvailable: true },
          null,
          colorTrap,
        ).kind,
        preset,
      ).toBe(preset === "foldChain" ? "escape" : "escape4");
    }
  });

  it("uses true conformality rather than the inverse-descent gate's 5% tolerance", () => {
    const transforms = presetTransforms("foldChain").map((transform, i) =>
      i === 0
        ? {
            ...transform,
            scale: [1.02, 1, 1] as [number, number, number],
          }
        : transform,
    );
    const result = deriveSurfaceEligibility(
      transforms,
      null,
      NO_SYMMETRY,
      { computeAvailable: true },
      null,
      geometryTrap,
    );
    expect(result.status).toBe("ineligible");
    expect(result.note).toContain("anisotropic (ratio 1.02)");
  });

  it("refuses geometry rather than silently dropping it on 3D and 4D inverse descents", () => {
    for (const preset of ["default", "pentatope"] as const) {
      const transforms = presetTransforms(preset);
      const refused = deriveSurfaceEligibility(
        transforms,
        null,
        NO_SYMMETRY,
        { computeAvailable: true },
        null,
        geometryTrap,
      );
      expect(refused.status, preset).toBe("ineligible");
      expect(refused.kind, preset).toBeNull();
      expect(refused.note, preset).toContain(
        "only on conformal fold-only escape chains",
      );
      expect(refused.note, preset).toContain(
        "inverse-descent attractor tracer",
      );

      const colored = deriveSurfaceEligibility(
        transforms,
        null,
        NO_SYMMETRY,
        { computeAvailable: true },
        null,
        colorTrap,
      );
      expect(colored.kind, preset).toBe(preset === "default" ? "ifs" : "ifs4");
    }
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
  it("admits the Gearworks condensation preset into the IFS descent", () => {
    const result = derivePreset("gearworks");
    expect(result.status).toBe("eligible");
    expect(result.kind).toBe("ifs");
    expect(result.note).toBeNull();
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

  it("admits an emitter-carrying contracting 4D document", () => {
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
    expect(result.status).not.toBe("ineligible");
    expect(result.kind).toBe("ifs4");
  });

  it("prices symmetry-expanded emitter records against the common cap", () => {
    const transforms: Transform[] = Array.from({ length: 25 }, (_, id) => ({
      id,
      position: [id * 0.01, 0, 0],
      rotation: [0, 0, 0],
      scale: [0.25, 0.25, 0.25],
      ...(id === 0
        ? {}
        : {
            emitter: {
              parts: [
                {
                  primitive: { kind: "sphere" as const, radius: 0.5 },
                  combine: "union" as const,
                },
              ],
            },
          }),
    }));
    const result = deriveSurfaceEligibility(transforms, null, NO_SYMMETRY, {
      computeAvailable: true,
    });
    expect(result.status).toBe("ineligible");
    expect(result.note).toContain("25 map/emitter records");
  });
});
