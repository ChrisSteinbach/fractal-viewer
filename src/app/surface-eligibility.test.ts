import {
  PRESET_FINALS,
  PRESET_NAMES,
  PRESET_RENDER_HINTS,
  PRESET_SCHEDULES,
  PRESET_SYMMETRIES,
  PRESET_TILINGS,
  PRESET_TRAPS,
  presetTransforms,
  sierpinskiTetrahedron,
} from "../fractal/presets";
import type { Preset } from "../fractal/presets";
import { shapeSdfSource } from "../fractal/shapes";
import type { ShapeSpec } from "../fractal/shapes";
import type { TilingSpec } from "../fractal/tiling";
import type { SymmetryParams, Transform } from "../fractal/types";
import {
  SURFACE_SHAPE_SOURCE_BUDGET_BYTES,
  deriveSurfaceDocumentEligibility,
  deriveSurfaceEligibility,
  surfaceEligibilityHasRoute,
} from "./surface-eligibility";
import type { SurfaceEligibilityDocument } from "./surface-eligibility";
import { SURFACE_MAX_MAPS } from "./surface-material";
import { SURFACE4_MAX_MAPS } from "./surface-material-4d";

const NO_SYMMETRY: SymmetryParams = { order: 1, plane: "xy" };

const NEAR_BUDGET_SHAPE: ShapeSpec = {
  parts: Array.from({ length: 8 }, (_, index) => ({
    primitive: {
      kind: "gear" as const,
      teeth: 13,
      radius: 0.91234567890123,
      tooth: [0.11234567890123, 0.01234567890123] as [number, number],
      hole: 0.21234567890123,
      halfHeight: 0.31234567890123,
    },
    combine: "union" as const,
    pose: {
      offset: [
        index + 0.12345678901235,
        index + 0.23456789012346,
        index + 0.34567890123457,
      ] as [number, number, number],
      rotate: [
        index + 0.45678901234568,
        index + 0.56789012345679,
        index + 0.67890123456789,
      ] as [number, number, number],
      scale: index + 1.12345678901235,
    },
  })),
};

function presetDocument(preset: Preset): SurfaceEligibilityDocument {
  return {
    transforms: presetTransforms(preset),
    finalTransform: PRESET_FINALS[preset]?.() ?? null,
    symmetry: PRESET_SYMMETRIES[preset] ?? NO_SYMMETRY,
    schedule: PRESET_SCHEDULES[preset]?.() ?? null,
    shapeTrap: PRESET_TRAPS[preset]?.() ?? null,
    tiling: PRESET_TILINGS[preset] ?? null,
  };
}

/** Derive a preset exactly as main.ts would present it: factory transforms,
 * its side-table final lens and kaleidoscope when it carries them. */
function derivePreset(
  preset: Preset,
  opts: { computeAvailable: boolean } = { computeAvailable: true },
) {
  const document = presetDocument(preset);
  return deriveSurfaceEligibility(
    document.transforms,
    document.finalTransform ?? null,
    document.symmetry,
    opts,
    document.schedule ?? null,
    document.shapeTrap ?? null,
    document.tiling ?? null,
  );
}

function expectNeutralParity(
  document: SurfaceEligibilityDocument,
): ReturnType<typeof deriveSurfaceEligibility> {
  const neutral = deriveSurfaceDocumentEligibility(document);
  const legacyComplete = deriveSurfaceEligibility(
    document.transforms,
    document.finalTransform ?? null,
    document.symmetry,
    { computeAvailable: true },
    document.schedule ?? null,
    document.shapeTrap ?? null,
    document.tiling ?? null,
  );
  expect(neutral).toEqual(legacyComplete);
  return neutral;
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

describe("capability-neutral Surface document eligibility", () => {
  it("matches the complete-capability legacy derivation over every shipped preset", () => {
    for (const preset of PRESET_NAMES) {
      expect(
        deriveSurfaceDocumentEligibility(presetDocument(preset)),
        preset,
      ).toEqual(derivePreset(preset, { computeAvailable: true }));
    }
  });

  it("admits compute-only 4D escape and fold routes while preserving legacy machine refusals", () => {
    const escapeDocument = presetDocument("mandelboxBrick");
    expect(deriveSurfaceDocumentEligibility(escapeDocument)).toMatchObject({
      status: "degraded",
      kind: "escape4",
    });
    expect(derivePreset("mandelboxBrick", { computeAvailable: false })).toEqual(
      {
        status: "ineligible",
        note: "4D escape-time chains render on WebGPU compute, which is unavailable here",
        kind: null,
      },
    );

    const foldDocument: SurfaceEligibilityDocument = {
      ...presetDocument("mandelboxKifs"),
      transforms: presetTransforms("mandelboxKifs").map((transform, index) =>
        index === 0
          ? { ...transform, w: { rotation: { xw: 0.25 } } }
          : transform,
      ),
    };
    expect(deriveSurfaceDocumentEligibility(foldDocument)).toMatchObject({
      kind: "ifs4",
    });
    expect(
      deriveSurfaceEligibility(
        foldDocument.transforms,
        foldDocument.finalTransform ?? null,
        foldDocument.symmetry,
        { computeAvailable: false },
        foldDocument.schedule ?? null,
        foldDocument.shapeTrap ?? null,
      ),
    ).toEqual({
      status: "ineligible",
      note: "4D folds render on WebGPU compute, which is unavailable here",
      kind: null,
    });
  });

  it("leaves a fragment-capable 4D IFS unchanged when compute is unavailable", () => {
    const document = presetDocument("pentatope");
    const neutral = deriveSurfaceDocumentEligibility(document);
    const machineWithoutCompute = derivePreset("pentatope", {
      computeAvailable: false,
    });

    expect(neutral).toEqual(machineWithoutCompute);
    expect(neutral).toMatchObject({ status: "eligible", kind: "ifs4" });
  });

  it("routes a final-lens-only 4D document through the shared 4D analysis", () => {
    const document: SurfaceEligibilityDocument = {
      transforms: sierpinskiTetrahedron(),
      finalTransform: {
        id: 99,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        w: { position: 0.4, rotation: { xw: 0.2 } },
      },
      symmetry: NO_SYMMETRY,
    };

    expect(expectNeutralParity(document)).toMatchObject({
      status: "eligible",
      kind: "ifs4",
    });
  });

  it("preserves schedules, chaos rows and both dimensional record caps", () => {
    const pairB: Transform[] = [
      {
        id: 100,
        position: [-0.5, 0, 0],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0.5],
      },
      {
        id: 101,
        position: [0.5, 0, 0],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0.5],
      },
    ];
    const scheduled: SurfaceEligibilityDocument = {
      transforms: sierpinskiTetrahedron(),
      symmetry: NO_SYMMETRY,
      schedule: { transforms: pairB, depth: 2 },
    };
    expect(expectNeutralParity(scheduled)).toMatchObject({
      status: "eligible",
      kind: "ifs",
    });

    const chiEscape: SurfaceEligibilityDocument = {
      transforms: [
        {
          id: 0,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          variations: [{ type: "mandelbox", weight: 2 }],
          chaos: [0.5],
        },
      ],
      symmetry: NO_SYMMETRY,
    };
    expect(expectNeutralParity(chiEscape)).toMatchObject({
      status: "ineligible",
      kind: null,
    });

    const base3 = sierpinskiTetrahedron();
    const overCap3: SurfaceEligibilityDocument = {
      transforms: Array.from({ length: SURFACE_MAX_MAPS + 1 }, (_, index) => ({
        ...base3[index % base3.length],
        id: index,
      })),
      symmetry: NO_SYMMETRY,
    };
    expect(expectNeutralParity(overCap3)).toMatchObject({
      status: "ineligible",
      kind: null,
    });

    const base4 = presetTransforms("pentatope");
    const overCap4: SurfaceEligibilityDocument = {
      transforms: Array.from({ length: SURFACE4_MAX_MAPS + 1 }, (_, index) => ({
        ...base4[index % base4.length],
        id: index,
      })),
      symmetry: NO_SYMMETRY,
    };
    expect(expectNeutralParity(overCap4)).toMatchObject({
      status: "ineligible",
      kind: null,
    });
  });

  it("preserves emitter, authored-source-budget and shape-trap decisions", () => {
    expect(expectNeutralParity(presetDocument("gearworks"))).toMatchObject({
      status: "eligible",
      kind: "ifs",
    });

    const emitters = sierpinskiTetrahedron().map((transform, index) =>
      index < 2 ? { ...transform, emitter: NEAR_BUDGET_SHAPE } : transform,
    );
    const sourceRefusal = expectNeutralParity({
      transforms: emitters,
      symmetry: NO_SYMMETRY,
    });
    expect(sourceRefusal).toMatchObject({ status: "ineligible", kind: null });
    expect(sourceRefusal.note).toContain("Authored custom-shape source needs");

    const geometryTrap = PRESET_TRAPS.foldChainGear!();
    expect(
      expectNeutralParity({
        transforms: presetTransforms("foldChainGear"),
        symmetry: NO_SYMMETRY,
        shapeTrap: geometryTrap,
      }),
    ).toMatchObject({ status: "degraded", kind: "escape" });

    const trapRefusal = expectNeutralParity({
      transforms: presetTransforms("default"),
      symmetry: NO_SYMMETRY,
      shapeTrap: geometryTrap,
    });
    expect(trapRefusal).toMatchObject({
      status: "ineligible",
      kind: null,
      recovery: "disableShapeTrapGeometry",
    });
  });

  it("treats eligible and degraded as routes and only ineligible as refusal", () => {
    const eligible = deriveSurfaceDocumentEligibility(
      presetDocument("default"),
    );
    const degraded = deriveSurfaceDocumentEligibility(
      presetDocument("mandelboxClassic"),
    );
    const ineligible = deriveSurfaceDocumentEligibility({
      transforms: [
        {
          id: 1,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          variations: [{ type: "qsquare", weight: 1 }],
        },
      ],
      symmetry: NO_SYMMETRY,
    });

    expect(eligible.status).toBe("eligible");
    expect(degraded.status).toBe("degraded");
    expect(ineligible.status).toBe("ineligible");
    expect(surfaceEligibilityHasRoute(eligible)).toBe(true);
    expect(surfaceEligibilityHasRoute(degraded)).toBe(true);
    expect(surfaceEligibilityHasRoute(ineligible)).toBe(false);
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
    const flat = derivePreset("foldChainGear");
    expect(flat).toMatchObject({
      status: "degraded",
      kind: "escape",
    });
    const nonFlat = deriveSurfaceEligibility(
      presetTransforms("mandelboxBrick"),
      null,
      NO_SYMMETRY,
      { computeAvailable: true },
      null,
      geometryTrap,
    );
    expect(nonFlat).toMatchObject({ status: "degraded", kind: "escape4" });
    expect(flat.recovery).toBeUndefined();
    expect(nonFlat.recovery).toBeUndefined();
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
      expect(result.recovery, preset).toBe("disableShapeTrapGeometry");
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
    expect(refused.recovery).toBe("disableShapeTrapGeometry");

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
      expect(refused.recovery, preset).toBe("disableShapeTrapGeometry");

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
    expect(result.recovery).toBe("disableShapeTrapGeometry");
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
      expect(refused.recovery, preset).toBe("disableShapeTrapGeometry");

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

  it("does not offer the geometry recovery for an unrelated refusal", () => {
    const result = deriveSurfaceEligibility(
      presetTransforms("mandelboxBrick"),
      null,
      NO_SYMMETRY,
      { computeAvailable: false },
      null,
      geometryTrap,
    );

    expect(result).toMatchObject({
      status: "ineligible",
      note: "4D escape-time chains render on WebGPU compute, which is unavailable here",
      kind: null,
    });
    expect(result.recovery).toBeUndefined();
  });
});

describe("deriveSurfaceEligibility chaos rows", () => {
  it("admits both shipped chi showcases through inverse Surface", () => {
    for (const preset of ["fernSponge", "fernSpongeLeak"] as const) {
      const result = derivePreset(preset);
      expect(result.status).toBe("degraded");
      expect(result.kind).toBe("ifs");
      expect(result.note).toContain("Anisotropic maps");
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
    expect(result.note).toContain("does not contract");
  });

  it("admits a live chi matrix on a genuine 4D attractor through inverse Surface", () => {
    const transforms = presetTransforms("pentatope");
    const graph = transforms.map((transform, row) => ({
      ...transform,
      chaos: transforms.map((_, predecessor) =>
        predecessor === row || predecessor === (row + 1) % transforms.length
          ? 1
          : 0,
      ),
    }));
    for (const computeAvailable of [false, true]) {
      const result = deriveSurfaceEligibility(graph, null, NO_SYMMETRY, {
        computeAvailable,
      });
      expect(result.status).not.toBe("ineligible");
      expect(result.kind).toBe("ifs4");
    }
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

  it("admits a live affine schedule through the inverse-descent route", () => {
    const result = deriveSurfaceEligibility(
      sierpinskiTetrahedron(),
      null,
      NO_SYMMETRY,
      { computeAvailable: true },
      { transforms: pairB, depth: 3 },
    );
    expect(result.status).toBe("eligible");
    expect(result.kind).toBe("ifs");
    expect(result.note).toBeNull();
  });

  it("admits the shipped Sponge of Ferns preset as a conservative affine descent", () => {
    const result = derivePreset("spongeOfFerns");
    expect(result.status).toBe("degraded");
    expect(result.kind).toBe("ifs");
    expect(result.note).toContain("Anisotropic maps");
  });

  it("never falls through to an A-only escape renderer when scheduled inverse analysis refuses", () => {
    const mandelbox: Transform = {
      id: 0,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      variations: [{ type: "mandelbox", weight: 2 }],
    };
    const result = deriveSurfaceEligibility(
      [mandelbox],
      null,
      NO_SYMMETRY,
      { computeAvailable: true },
      { transforms: pairB, depth: 1 },
    );
    expect(result.status).toBe("ineligible");
    expect(result.kind).toBeNull();
    expect(result.note).toContain("does not contract");
    expect(result.note).not.toContain("Escape-time render");
  });

  it("prices B records in the shared 24-record cap", () => {
    const base = sierpinskiTetrahedron();
    const scheduleTransforms = Array.from({ length: 21 }, (_, id) => ({
      ...pairB[id % pairB.length],
      id,
    }));
    const over = deriveSurfaceEligibility(
      base,
      null,
      NO_SYMMETRY,
      { computeAvailable: true },
      { transforms: scheduleTransforms, depth: 1 },
    );
    expect(over.status).toBe("ineligible");
    expect(over.note).toContain("25 map/schedule records");

    const atCap = deriveSurfaceEligibility(
      base,
      null,
      NO_SYMMETRY,
      { computeAvailable: true },
      { transforms: scheduleTransforms.slice(0, 20), depth: 1 },
    );
    expect(atCap.status).toBe("eligible");
    expect(atCap.kind).toBe("ifs");
  });

  it("matches B's weighted support and all-zero uniform fallback when counting records", () => {
    const base = sierpinskiTetrahedron();
    const many = Array.from({ length: 21 }, (_, id): Transform => ({
      ...pairB[id % pairB.length],
      id,
      weight: 0,
    }));
    const allZero = deriveSurfaceEligibility(
      base,
      null,
      NO_SYMMETRY,
      { computeAvailable: true },
      { transforms: many, depth: 1 },
    );
    expect(allZero.status).toBe("ineligible");
    expect(allZero.note).toContain("25 map/schedule records");

    const weighted = many.map((transform, index) => ({
      ...transform,
      weight: index === 7 ? 1 : 0,
    }));
    const oneSupported = deriveSurfaceEligibility(
      base,
      null,
      NO_SYMMETRY,
      { computeAvailable: true },
      { transforms: weighted, depth: 1 },
    );
    expect(oneSupported.status).toBe("eligible");
    expect(oneSupported.kind).toBe("ifs");
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

  it("admits an intersection emitter into Surface even though point modes cannot sample it", () => {
    const transforms = sierpinskiTetrahedron().map((transform, index) =>
      index === 1
        ? {
            ...transform,
            emitter: {
              parts: [
                {
                  primitive: { kind: "sphere" as const, radius: 0.5 },
                  combine: "union" as const,
                },
                {
                  primitive: {
                    kind: "box" as const,
                    half: [0.25, 0.25, 0.25] as [number, number, number],
                  },
                  combine: "intersect" as const,
                },
              ],
            },
          }
        : transform,
    );
    expect(
      deriveSurfaceEligibility(transforms, null, NO_SYMMETRY, {
        computeAvailable: true,
      }),
    ).toEqual({ status: "eligible", note: null, kind: "ifs" });
  });

  it("enforces one aggregate 8192-byte budget in both dialects across active emitter functions", () => {
    const encoder = new TextEncoder();
    const glslBytes = encoder.encode(
      shapeSdfSource(NEAR_BUDGET_SHAPE, "glsl", "condensationSdf0"),
    ).byteLength;
    const wgslBytes0 = encoder.encode(
      shapeSdfSource(NEAR_BUDGET_SHAPE, "wgsl", "condensationShape0"),
    ).byteLength;
    const wgslBytes1 = encoder.encode(
      shapeSdfSource(NEAR_BUDGET_SHAPE, "wgsl", "condensationShape1"),
    ).byteLength;
    expect(glslBytes).toBeLessThanOrEqual(SURFACE_SHAPE_SOURCE_BUDGET_BYTES);
    expect(wgslBytes0).toBeLessThanOrEqual(SURFACE_SHAPE_SOURCE_BUDGET_BYTES);
    expect(wgslBytes0 + wgslBytes1).toBeGreaterThan(
      SURFACE_SHAPE_SOURCE_BUDGET_BYTES,
    );

    const one = sierpinskiTetrahedron().map((transform, index) =>
      index === 0 ? { ...transform, emitter: NEAR_BUDGET_SHAPE } : transform,
    );
    expect(
      deriveSurfaceEligibility(one, null, NO_SYMMETRY, {
        computeAvailable: true,
      }).status,
    ).toBe("eligible");

    const two = one.map((transform, index) =>
      index === 1 ? { ...transform, emitter: NEAR_BUDGET_SHAPE } : transform,
    );
    const refused = deriveSurfaceEligibility(two, null, NO_SYMMETRY, {
      computeAvailable: true,
    });
    expect(refused.status).toBe("ineligible");
    expect(refused.kind).toBeNull();
    // GLSL structurally deduplicates equal functions; WGSL emits one body
    // per base-emitter shade slot.
    expect(refused.note).toContain(`${glslBytes} GLSL bytes`);
    expect(refused.note).toContain(`${wgslBytes0 + wgslBytes1} WGSL bytes`);
    expect(refused.note).toContain(
      `${SURFACE_SHAPE_SOURCE_BUDGET_BYTES} bytes in each dialect`,
    );

    // Inactive emitters produce no function and therefore do not spend the
    // aggregate, even though their document field remains preserved.
    const inactiveSecond = two.map((transform, index) =>
      index === 1 ? { ...transform, weight: 0 } : transform,
    );
    expect(
      deriveSurfaceEligibility(inactiveSecond, null, NO_SYMMETRY, {
        computeAvailable: true,
      }).status,
    ).toBe("eligible");

    const nonFlatTwo = two.map((transform, index) =>
      index === 2 ? { ...transform, w: { rotation: { xw: 0.25 } } } : transform,
    );
    const glsl4dBytes = encoder.encode(
      shapeSdfSource(NEAR_BUDGET_SHAPE, "glsl", "condensation4Sdf0"),
    ).byteLength;
    const refused4d = deriveSurfaceEligibility(nonFlatTwo, null, NO_SYMMETRY, {
      computeAvailable: true,
    });
    expect(refused4d.status).toBe("ineligible");
    expect(refused4d.note).toContain(`${glsl4dBytes} GLSL bytes`);
    expect(refused4d.note).toContain(`${wgslBytes0 + wgslBytes1} WGSL bytes`);

    const symmetric = deriveSurfaceEligibility(
      two,
      null,
      { order: 2, plane: "xy" },
      { computeAvailable: true },
    );
    expect(symmetric.status).toBe("ineligible");
    expect(symmetric.note).toContain(`${glslBytes} GLSL bytes`);
    expect(symmetric.note).toContain(`${wgslBytes0 + wgslBytes1} WGSL bytes`);
  });

  it("applies the same source gate to the active forward-route shape trap", () => {
    const overBudgetShape: ShapeSpec = {
      parts: NEAR_BUDGET_SHAPE.parts.map((part) => ({
        ...part,
        pose: {
          ...part.pose,
          offset: [Number.MAX_VALUE, -Number.MAX_VALUE, Number.MAX_VALUE],
        },
      })),
    };
    const result = deriveSurfaceEligibility(
      presetTransforms("mandelboxClassic"),
      null,
      NO_SYMMETRY,
      { computeAvailable: true },
      null,
      { shape: overBudgetShape },
    );
    expect(result.status).toBe("ineligible");
    expect(result.kind).toBeNull();
    expect(result.note).toContain("Authored custom-shape source needs");
    const encoder = new TextEncoder();
    const trapGlsl = encoder.encode(
      shapeSdfSource(overBudgetShape, "glsl", "surfaceTrapSdf"),
    ).byteLength;
    const trapWgsl = encoder.encode(
      shapeSdfSource(overBudgetShape, "wgsl", "trapShapeSdf"),
    ).byteLength;
    expect(result.note).toContain(`${trapGlsl} GLSL bytes`);
    expect(result.note).toContain(`${trapWgsl} WGSL bytes`);
  });

  it("invalidates source eligibility cache entries after in-place mutation", () => {
    const mutable: ShapeSpec = {
      parts: [
        {
          primitive: { kind: "sphere", radius: 0.5 },
          combine: "union",
        },
      ],
    };
    const transforms = sierpinskiTetrahedron().map((transform, index) =>
      index === 0 ? { ...transform, emitter: mutable } : transform,
    );
    expect(
      deriveSurfaceEligibility(transforms, null, NO_SYMMETRY, {
        computeAvailable: true,
      }).status,
    ).toBe("eligible");

    mutable.parts = NEAR_BUDGET_SHAPE.parts.map((part) => ({
      ...part,
      pose: {
        ...part.pose,
        offset: [Number.MAX_VALUE, -Number.MAX_VALUE, Number.MAX_VALUE],
      },
    }));
    expect(
      deriveSurfaceEligibility(transforms, null, NO_SYMMETRY, {
        computeAvailable: true,
      }).status,
    ).toBe("ineligible");
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

describe("deriveSurfaceEligibility and the tiling block", () => {
  function deriveWithTiling(
    preset: Preset,
    tiling: TilingSpec,
    symmetry: SymmetryParams = presetDocument(preset).symmetry,
  ) {
    const document = presetDocument(preset);
    return deriveSurfaceEligibility(
      document.transforms,
      document.finalTransform ?? null,
      symmetry,
      { computeAvailable: true },
      document.schedule ?? null,
      document.shapeTrap ?? null,
      tiling,
    );
  }

  it("refuses a tiled document with a kaleidoscope, naming the two query-space folds", () => {
    const result = deriveWithTiling(
      "mandelboxKifs",
      { group: "a3" },
      {
        ...NO_SYMMETRY,
        order: 2,
      },
    );
    expect(result.status).toBe("ineligible");
    expect(result.kind).toBeNull();
    expect(result.note).toContain("query-space folds");
    expect(result.note).toContain("tiling");
  });

  it("applies the one uniform refusal rule to every routing kind — escape included", () => {
    const document = presetDocument("mandelboxClassic");
    const result = deriveSurfaceEligibility(
      document.transforms,
      document.finalTransform ?? null,
      { ...document.symmetry, order: 2 },
      { computeAvailable: true },
      document.schedule ?? null,
      document.shapeTrap ?? null,
      { group: "b3" },
    );
    expect(result.status).toBe("ineligible");
    expect(result.kind).toBeNull();
    expect(result.note).toContain("query-space folds");
  });

  it("keeps a tiled document without a kaleidoscope exactly as eligible as the untiled one", () => {
    const plain = derivePreset("mandelboxKifs");
    const tiled = deriveWithTiling("mandelboxKifs", { group: "a3" });
    expect(tiled).toEqual(plain);
  });

  it("keeps a tiled 4D document eligible — eligibility refuses no dimension rule; the slab refusal lives at the routing seam", () => {
    const plain = derivePreset("pentatope");
    const tiled = deriveWithTiling("pentatope", { group: "a4" });
    expect(tiled).toEqual(plain);
    expect(tiled.status).not.toBe("ineligible");
  });

  it("refuses a finite group whose dimension does not match the document", () => {
    const group4On3 = deriveWithTiling("mandelboxKifs", { group: "a4" });
    expect(group4On3).toMatchObject({ status: "ineligible", kind: null });
    expect(group4On3.note).toContain("A4 tiling group is 4D");
    expect(group4On3.note).toContain("document is 3D");

    const group3On4 = deriveWithTiling("pentatope", { group: "a3" });
    expect(group3On4).toMatchObject({ status: "ineligible", kind: null });
    expect(group3On4.note).toContain("A3 tiling group is 3D");
    expect(group3On4.note).toContain("document is 4D");
  });

  it("admits the lattice arm through the same analysers the finite arm routes", () => {
    // The lattice renderer is live: the derivation no longer refuses the
    // recognized block — the routing arms resolve it against each
    // estimator's authority radius after the DE exists (the eligibility
    // gate's job ends at the shared refusals: balloon, kaleidoscope, the
    // 4D slab, mesh clips).
    for (const preset of ["sierpinski", "pentatope"] as Preset[]) {
      const result = deriveWithTiling(preset, {
        kind: "lattice",
        cellScale: 1,
      });
      expect(result.status).not.toBe("ineligible");
      expect(result.kind).not.toBeNull();
    }
  });

  it("keeps the lattice arm's backend independence", () => {
    const document = presetDocument("sierpinski");
    const derive = (computeAvailable: boolean) =>
      deriveSurfaceEligibility(
        document.transforms,
        document.finalTransform ?? null,
        document.symmetry,
        { computeAvailable },
        document.schedule ?? null,
        document.shapeTrap ?? null,
        { kind: "lattice", cellScale: 2 },
      );
    expect(derive(false)).toEqual(derive(true));
    expect(derive(false).status).not.toBe("ineligible");
  });

  it("refuses mesh-backed tiling clips before either shader backend can ignore them", () => {
    const result = deriveWithTiling("mandelboxKifs", {
      group: "a3",
      clip: {
        parts: [
          {
            primitive: { kind: "mesh", meshId: "star-prism-v1" },
            combine: "union",
          },
        ],
      },
    });
    expect(result).toMatchObject({ status: "ineligible", kind: null });
    expect(result.note).toContain("analytic shapes");
    expect(result.note).toContain("preserved in the document");
  });

  it("prices the tiling clip together with another baked authored shape", () => {
    const transforms = sierpinskiTetrahedron().map((transform, index) =>
      index === 0 ? { ...transform, emitter: NEAR_BUDGET_SHAPE } : transform,
    );
    const withoutClip = deriveSurfaceEligibility(
      transforms,
      null,
      NO_SYMMETRY,
      { computeAvailable: true },
      null,
      null,
      { group: "a3" },
    );
    expect(withoutClip.status).not.toBe("ineligible");

    const withClip = deriveSurfaceEligibility(
      transforms,
      null,
      NO_SYMMETRY,
      { computeAvailable: true },
      null,
      null,
      { group: "a3", clip: NEAR_BUDGET_SHAPE },
    );
    expect(withClip).toMatchObject({ status: "ineligible", kind: null });
    expect(withClip.note).toContain("Authored custom-shape source needs");
  });

  it("never consults machine availability for the tiling refusal — a tiled kaleidoscope document is refused on every backend", () => {
    const document = presetDocument("mandelboxKifs");
    const withTiling = (computeAvailable: boolean) =>
      deriveSurfaceEligibility(
        document.transforms,
        document.finalTransform ?? null,
        { ...NO_SYMMETRY, order: 2 },
        { computeAvailable },
        document.schedule ?? null,
        document.shapeTrap ?? null,
        { group: "h3" },
      );
    expect(withTiling(false)).toEqual(withTiling(true));
    expect(withTiling(false).status).toBe("ineligible");
  });

  it("deriveSurfaceDocumentEligibility reads document.tiling (neutral parity holds for a tiled document)", () => {
    const tiled: SurfaceEligibilityDocument = {
      ...presetDocument("mandelboxKifs"),
      tiling: { group: "a3" },
      symmetry: { ...NO_SYMMETRY, order: 2 },
    };
    expectNeutralParity(tiled);
    expect(deriveSurfaceDocumentEligibility(tiled).status).toBe("ineligible");
  });

  it("deriveSurfaceDocumentEligibility admits the lattice arm at neutral parity", () => {
    const tiled: SurfaceEligibilityDocument = {
      ...presetDocument("pentatope"),
      tiling: { kind: "lattice", cellScale: 3 },
    };
    expectNeutralParity(tiled);
    const result = deriveSurfaceDocumentEligibility(tiled);
    expect(result.status).not.toBe("ineligible");
    expect(result.kind).not.toBeNull();
  });
});
