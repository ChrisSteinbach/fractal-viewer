import { describe, expect, it } from "vitest";
import { buildSurfaceDE } from "../fractal/surface-de";
import { buildSurfaceDE4 } from "../fractal/surface-de-4d";
import type { Transform } from "../fractal/types";
import { identityRotorPair, rotorMatrix } from "./rotor4";
import {
  surfaceClosedSolidAdmitted,
  type Surface4OpticsPose,
} from "./surface-optics-backend";

/**
 * The closed-solid routing admission — the codegen refusal list evaluated
 * before any create, over the qualified emitter-only union shape. Every
 * refusal is exercised the way a session can actually reach it.
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
