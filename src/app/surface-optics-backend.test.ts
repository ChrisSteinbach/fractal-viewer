import { describe, expect, it } from "vitest";
import { buildSurfaceDE } from "../fractal/surface-de";
import { buildSurfaceDE4 } from "../fractal/surface-de-4d";
import type { Transform } from "../fractal/types";
import { identityRotorPair, rotorMatrix } from "./rotor4";
import { createSurfaceTransmissionStarter } from "./surface-transmission-starters";
import { PRESET_SPHERE_INVERSIONS } from "../fractal/presets";
import { resolveSphereInversion } from "../fractal/sphere-inversion";
import type { SphereInversionAuthored } from "../fractal/sphere-inversion";
import {
  SPHERE_INVERSION_GLASS_MAX_DEPTH,
  SPHERE_INVERSION_GLASS_MAX_GENERATORS,
  sphereInversionGlassAdmission,
  surfaceClosedSolidAdmitted,
  surfaceOpticsOutlook,
  type Surface4OpticsPose,
} from "./surface-optics-backend";

/**
 * The closed-solid routing admission — the codegen refusal list evaluated
 * before any create, over the qualified emitter-only union shape. Every
 * refusal is exercised the way a session can actually reach it.
 *
 * The second subject is the document-level OUTLOOK mirror the panel's
 * optics note reads (`surfaceOpticsOutlook`): the same refusal terms at
 * document level, so the boundary is visible at authoring time. Its tests
 * pin agreement with the DE-level predicate over the same systems, because
 * a disagreement between the two is by definition a bug in the mirror.
 */

const emitterOnly: Transform[] = [
  {
    id: 0,
    position: [0.35, -0.1, 0.05],
    rotation: [0.15, -0.2, 0.1],
    scale: [0.35, 0.35, 0.35],
    weight: 1,
    emitter: {
      parts: [{ primitive: { kind: "sphere", radius: 1 }, combine: "union" }],
    },
  },
  {
    id: 1,
    position: [-0.4, 0.25, -0.05],
    rotation: [-0.1, 0.12, -0.2],
    scale: [0.3, 0.3, 0.3],
    weight: 1,
    emitter: {
      parts: [
        { primitive: { kind: "box", half: [0.7, 0.5, 0.8] }, combine: "union" },
      ],
    },
  },
];

const canonicalPose4: Surface4OpticsPose = {
  rotor: rotorMatrix(identityRotorPair()),
  w0: 0,
  sliceHalfW: 0,
};

describe("surfaceClosedSolidAdmitted", () => {
  it("admits the qualified emitter-only union in 3D", () => {
    const de = buildSurfaceDE(emitterOnly, null, { order: 1, plane: "xy" }, {});
    expect(de.maps.length).toBe(0);
    expect(surfaceClosedSolidAdmitted(de, {})).toBe(true);
  });

  it("admits the qualified emitter-only union at the canonical 4D pose", () => {
    const de = buildSurfaceDE4(
      emitterOnly,
      null,
      { order: 1, plane: "xy" },
      {},
    );
    expect(surfaceClosedSolidAdmitted(de, {}, canonicalPose4)).toBe(true);
  });

  it("refuses systems without condensation emitters", () => {
    const maps: Transform[] = [
      {
        id: 0,
        position: [0.3, 0, 0],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0.5],
        weight: 1,
      },
    ];
    const de = buildSurfaceDE(maps, null, { order: 1, plane: "xy" }, {});
    expect(surfaceClosedSolidAdmitted(de, {})).toBe(false);
  });

  it("refuses emitter-plus-map systems — the field describes only the root union", () => {
    const mixed: Transform[] = [
      ...emitterOnly,
      {
        id: 2,
        position: [0.2, 0.2, 0.2],
        rotation: [0, 0, 0],
        scale: [0.4, 0.4, 0.4],
        weight: 1,
      },
    ];
    const de = buildSurfaceDE(mixed, null, { order: 1, plane: "xy" }, {});
    expect(de.maps.length).toBeGreaterThan(0);
    expect(de.condensation).toBeDefined();
    expect(surfaceClosedSolidAdmitted(de, {})).toBe(false);
  });

  it("refuses tiling and balloon compositions", () => {
    const de = buildSurfaceDE(emitterOnly, null, { order: 1, plane: "xy" }, {});
    expect(surfaceClosedSolidAdmitted(de, { tiling: true })).toBe(false);
    expect(surfaceClosedSolidAdmitted(de, { balloon: true })).toBe(false);
  });

  it("refuses a final transform — the signed field is the bare root term", () => {
    const lens: Transform = {
      id: 9,
      position: [0, 0, 0],
      rotation: [0.3, 0, 0],
      scale: [1, 1, 1],
    };
    const de = buildSurfaceDE(emitterOnly, lens, { order: 1, plane: "xy" }, {});
    expect(de.final).not.toBeNull();
    expect(surfaceClosedSolidAdmitted(de, {})).toBe(false);
  });

  it("refuses a 4D pose off the canonical composition", () => {
    const de = buildSurfaceDE4(
      emitterOnly,
      null,
      { order: 1, plane: "xy" },
      {},
    );
    // A slab never carries the flat exactly.
    expect(
      surfaceClosedSolidAdmitted(
        de,
        {},
        { ...canonicalPose4, sliceHalfW: 0.1 },
      ),
    ).toBe(false);
    // An off-centre slice erodes every member by |w0|.
    expect(
      surfaceClosedSolidAdmitted(de, {}, { ...canonicalPose4, w0: 0.2 }),
    ).toBe(false);
    // An xw rotor turns the flats out of the slice.
    const tilted = [...canonicalPose4.rotor];
    const a = 0.4;
    const c = Math.cos(a);
    const s = Math.sin(a);
    // Row-major xw plane rotation: x' = c·x - s·w, w' = s·x + c·w.
    const rotated = [...tilted];
    rotated[0] = c;
    rotated[3] = -s;
    rotated[12] = s;
    rotated[15] = c;
    expect(
      surfaceClosedSolidAdmitted(de, {}, { ...canonicalPose4, rotor: rotated }),
    ).toBe(false);
  });

  it("refuses a 4D member whose pose mixes w into the displayed space", () => {
    // A transform rotated in the xw plane lifts the member's flat out of
    // the w = 0 slice — the penalty form erodes it, so the admission
    // refuses before the transport can refuse every path on it.
    const tilted4: Transform[] = [
      {
        ...emitterOnly[0],
        w: { rotation: { xw: 0.5 } },
      },
    ];
    const de = buildSurfaceDE4(tilted4, null, { order: 1, plane: "xy" }, {});
    expect(surfaceClosedSolidAdmitted(de, {}, canonicalPose4)).toBe(false);
  });

  it("admits members whose common flat the slice carries, at any world w", () => {
    // The canonical composition generalized: members posed at one common
    // w translation, the slice ON that hyperplane — the penalty vanishes
    // identically, exactly as at the w = 0 lift.
    const lifted: Transform[] = emitterOnly.map((t) => ({
      ...t,
      w: { position: 0.3 },
    }));
    const de = buildSurfaceDE4(lifted, null, { order: 1, plane: "xy" }, {});
    expect(
      surfaceClosedSolidAdmitted(de, {}, { ...canonicalPose4, w0: 0.3 }),
    ).toBe(true);
    // The same pose with the slice OFF the flats erodes every member.
    expect(
      surfaceClosedSolidAdmitted(de, {}, { ...canonicalPose4, w0: 0 }),
    ).toBe(false);
  });
});

describe("surfaceClosedSolidAdmitted — the identity final", () => {
  it("admits an enabled-but-identity final transform (the lens nobody moved)", () => {
    const identityLens: Transform = {
      id: 9,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    };
    const de = buildSurfaceDE(
      emitterOnly,
      identityLens,
      { order: 1, plane: "xy" },
      {},
    );
    expect(de.final).not.toBeNull();
    expect(surfaceClosedSolidAdmitted(de, {})).toBe(true);
  });
});

describe("surfaceOpticsOutlook — the panel note's document mirror", () => {
  const view3D = {
    transforms: emitterOnly,
    finalTransform: null,
    schedulePresent: false,
    tilingPresent: false,
    balloonOn: false,
  };

  it("reads the finiteSolid route as resolving finite cells", () => {
    expect(surfaceOpticsOutlook("finiteSolid", view3D)).toEqual({
      resolves: "finite-cells",
    });
    expect(surfaceOpticsOutlook("finiteSolid4", view3D)).toEqual({
      resolves: "finite-cells",
    });
  });

  it("reads the emitter-only 3D route as resolving closed-solid, uncoupled", () => {
    expect(surfaceOpticsOutlook("ifs", view3D)).toEqual({
      resolves: "closed-solid",
      sliceCoupled: false,
    });
  });

  it("reads the emitter-only 4D route as closed-solid with the slice coupling", () => {
    expect(surfaceOpticsOutlook("ifs4", view3D)).toEqual({
      resolves: "closed-solid",
      sliceCoupled: true,
    });
  });

  it("keeps classic on forward and replaced-subject routes", () => {
    for (const kind of [
      "escape",
      "bulb",
      "escape4",
      "sphereInversion",
      "sphereInversion4",
      null,
    ]) {
      expect(surfaceOpticsOutlook(kind, view3D)).toEqual({ resolves: false });
    }
  });

  it("keeps classic on every composition the DE-level predicate refuses", () => {
    const mixedMap: Transform = {
      id: 2,
      position: [0.2, 0.2, 0.2],
      rotation: [0, 0, 0],
      scale: [0.4, 0.4, 0.4],
      weight: 1,
    };
    expect(
      surfaceOpticsOutlook("ifs", {
        ...view3D,
        transforms: [...emitterOnly, mixedMap],
      }),
    ).toEqual({ resolves: false });
    expect(
      surfaceOpticsOutlook("ifs", { ...view3D, schedulePresent: true }),
    ).toEqual({ resolves: false });
    expect(
      surfaceOpticsOutlook("ifs", { ...view3D, tilingPresent: true }),
    ).toEqual({ resolves: false });
    expect(surfaceOpticsOutlook("ifs", { ...view3D, balloonOn: true })).toEqual(
      { resolves: false },
    );
  });

  it("refuses a final the descent warps the query by, admits the identity lens", () => {
    const lens: Transform = {
      id: 9,
      position: [0, 0, 0],
      rotation: [0.3, 0, 0],
      scale: [1, 1, 1],
    };
    expect(
      surfaceOpticsOutlook("ifs", { ...view3D, finalTransform: lens }),
    ).toEqual({ resolves: false });
    const identityLens: Transform = { ...lens, rotation: [0, 0, 0] };
    expect(
      surfaceOpticsOutlook("ifs", { ...view3D, finalTransform: identityLens }),
    ).toEqual({ resolves: "closed-solid", sliceCoupled: false });
    // A variation on the final is a real warp even at an identity affine.
    const swirled: Transform = {
      ...identityLens,
      variations: [{ type: "swirl", weight: 0.9 }],
    };
    expect(
      surfaceOpticsOutlook("ifs", { ...view3D, finalTransform: swirled }),
    ).toEqual({ resolves: false });
  });

  it("agrees with the DE-level predicate over the shipped starters' documents", () => {
    for (const id of ["glass-garden", "glass-corner-cells"] as const) {
      const snap = createSurfaceTransmissionStarter(id);
      const de = buildSurfaceDE(
        snap.transforms,
        snap.finalTransform ?? null,
        { order: 1, plane: "xy" },
        {},
      );
      const outlook = surfaceOpticsOutlook("ifs", {
        transforms: snap.transforms,
        finalTransform: snap.finalTransform ?? null,
        schedulePresent: false,
        tilingPresent: false,
        balloonOn: false,
      });
      expect(outlook).toEqual({
        resolves: "closed-solid",
        sliceCoupled: false,
      });
      expect(surfaceClosedSolidAdmitted(de, {})).toBe(true);
    }
  });
});

describe("sphereInversionGlassAdmission (the sphere-inversion glass routing)", () => {
  const glass = [{ optics: { model: "dielectric" as const } }];
  const admit = (block: SphereInversionAuthored, compute = true) => {
    const r = resolveSphereInversion(block);
    if (!r.ok) throw new Error(r.reasons.join("; "));
    return sphereInversionGlassAdmission(block, r.construction, compute);
  };

  it("has nothing to decide for a block that authors no glass", () => {
    expect(admit({ arrangement: "oct6" })).toBeUndefined();
    expect(
      admit({ arrangement: "oct6", materials: [{ finish: { metalness: 1 } }] }),
    ).toBeUndefined();
  });

  it("pins every shipped preset's leaf: 3D ball and shell seeds admit, the cut-shell vaults and the 600-cell refuse", () => {
    const leaves: Record<string, string | true> = {};
    for (const [name, factory] of Object.entries(PRESET_SPHERE_INVERSIONS)) {
      const verdict = admit({ ...factory(), materials: glass });
      leaves[name] = verdict!.admitted ? true : verdict!.reason;
    }
    const seeds = "glass is available for ball and shell seeds";
    expect(leaves).toEqual({
      inversionPearls: true,
      inversionCubePearls: true,
      inversionVault: seeds,
      inversionLace: true,
      inversionTetraFrame: true,
      inversionDodecaWindows: true,
      inversionRhombiLace: true,
      inversionIcosidodecaStar: true,
      inversionVault4: seeds,
      inversionMedallions4: `glass is available up to ${SPHERE_INVERSION_GLASS_MAX_GENERATORS} generators`,
    });
  });

  it("admits every 4D arrangement below the generator cap", () => {
    for (const arrangement of ["cross8", "tess16", "cell24"]) {
      expect(
        admit({
          arrangement,
          seed: { kind: "shell" },
          depth: 2,
          materials: glass,
        }),
      ).toEqual({ admitted: true });
    }
  });

  it("admits up to the depth the look gate swept, and not past it", () => {
    const at = (depth: number) =>
      admit({ arrangement: "oct6", depth, materials: glass });
    expect(at(SPHERE_INVERSION_GLASS_MAX_DEPTH)).toEqual({ admitted: true });
    expect(at(0)).toEqual({ admitted: true });
    expect(at(SPHERE_INVERSION_GLASS_MAX_DEPTH + 1)).toEqual({
      admitted: false,
      reason: `glass is available up to depth ${SPHERE_INVERSION_GLASS_MAX_DEPTH}`,
    });
  });

  it("refuses without compute: the backend has no fragment twin in either dimension", () => {
    for (const arrangement of ["oct6", "cross8"]) {
      expect(admit({ arrangement, materials: glass }, false)).toEqual({
        admitted: false,
        reason: "glass needs WebGPU compute, which is unavailable here",
      });
    }
  });

  it("reads glass on any generation's material, not only the first", () => {
    expect(
      admit({
        arrangement: "oct6",
        materials: [{}, { optics: { model: "dielectric" } }],
      }),
    ).toEqual({ admitted: true });
  });
});
