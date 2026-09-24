import { composeAffine4, toTransform4 } from "./affine4";
import type { CondensationDepthBand } from "./condensation-de";
import {
  buildCondensationSolid3,
  condensationSolidAdmission3,
  condensationSolidContains3,
  condensationSolidSignedDistance3,
} from "./condensation-solid";
import {
  buildCondensationSolid4,
  condensationSolidAdmission4,
  condensationSolidContains4,
  condensationSolidPoseAdmission4,
  condensationSolidSignedDistance4,
} from "./condensation-solid-4d";
import { sierpinskiTetrahedron } from "./presets";
import { mulberry32 } from "./rng";
import {
  GEAR_SHAPE,
  SHAPE_MARCH_SAFETY,
  shapeSdf,
  type ShapeSpec,
} from "./shapes";
import { buildSurfaceDE } from "./surface-de";
import {
  buildSurfaceDE4,
  estimateDistance4Refined,
  inverse4,
  singularValues4,
} from "./surface-de-4d";
import type { Transform, Vec4 } from "./types";

const SPHERE: ShapeSpec = {
  parts: [{ primitive: { kind: "sphere", radius: 0.9 }, combine: "union" }],
};
const RING: ShapeSpec = {
  parts: [
    {
      primitive: { kind: "torus", major: 0.8, minor: 0.25 },
      combine: "union",
    },
  ],
};

const IDENTITY_ROTOR = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const CANONICAL = { rotor: IDENTITY_ROTOR, w0: 0, sliceHalfW: 0 };

function emitter(shape: ShapeSpec, id = 4): Transform {
  return {
    id,
    position: [0.05, 0.1, -0.05],
    rotation: [0.3, 0.2, 0.1],
    scale: [0.5, 0.5, 0.5],
    weight: 1.4,
    emitter: shape,
  };
}

/** The 3D twin's non-similarity corners, so the ratios sit below 1. */
function stretchedCorners(): Transform[] {
  return sierpinskiTetrahedron().map((t) => ({
    ...t,
    rotation: [0.2, 0.1 * t.id, 0],
    scale: [0.5, 0.42, 0.46],
  }));
}

function solid4Of(transforms: Transform[], band: CondensationDepthBand) {
  return buildCondensationSolid4(
    buildSurfaceDE4(transforms, null, undefined, {
      condensationDepthBand: band,
    }),
  );
}

function solid3Of(transforms: Transform[], band: CondensationDepthBand) {
  return buildCondensationSolid3(
    buildSurfaceDE(transforms, null, undefined, {
      condensationDepthBand: band,
    }),
  );
}

/** THE INDEPENDENT 4D REFERENCE UNION: every word in the band, walked from
 * the lifted transforms themselves (composeAffine4, a direct inverse),
 * never through the surface DE or the module under test. */
function bruteUnion4(
  transforms: Transform[],
  band: { minDepth: number; maxDepth: number },
  p: Vec4,
): { field: number; member: boolean } {
  const lift = (t: Transform) => {
    const a = composeAffine4(toTransform4(t));
    return { inv: inverse4(a.m), t: a.t, sigma: singularValues4(a.m).min };
  };
  const maps = transforms.filter((t) => !t.emitter).map(lift);
  const emitters = transforms
    .filter((t) => t.emitter)
    .map((t) => ({ shape: t.emitter!, ...lift(t) }));
  const apply = (inv: number[], t: number[], q: Vec4): Vec4 => {
    const u = [q[0] - t[0], q[1] - t[1], q[2] - t[2], q[3] - t[3]];
    return [0, 1, 2, 3].map(
      (r) =>
        inv[r * 4] * u[0] +
        inv[r * 4 + 1] * u[1] +
        inv[r * 4 + 2] * u[2] +
        inv[r * 4 + 3] * u[3],
    ) as Vec4;
  };
  let field = Infinity;
  let member = false;
  const walk = (q: Vec4, s: number, depth: number): void => {
    if (depth >= band.minDepth) {
      for (const e of emitters) {
        const l = apply(e.inv, e.t, q);
        const d =
          e.sigma * shapeSdf(e.shape, l[0], l[1], l[2]) + Math.abs(l[3]);
        if (d <= 0) member = true;
        field = Math.min(field, s * SHAPE_MARCH_SAFETY * d);
      }
    }
    if (depth === band.maxDepth) return;
    for (const m of maps) walk(apply(m.inv, m.t, q), s * m.sigma, depth + 1);
  };
  walk(p, 1, 0);
  return { field, member };
}

/** Points ON the canonical slice `w = 0`. */
function slicePoints(n: number, seed: number, extent = 1.3): Vec4[] {
  const rng = mulberry32(seed);
  return Array.from({ length: n }, () => [
    (rng() * 2 - 1) * extent,
    (rng() * 2 - 1) * extent,
    (rng() * 2 - 1) * extent,
    0,
  ]);
}

describe("condensation solid (4D)", () => {
  it("is the 3D solid of the restriction on the canonical slice", () => {
    for (const [transforms, band] of [
      [[...sierpinskiTetrahedron(), emitter(SPHERE)], { maxDepth: 3 }],
      [[...stretchedCorners(), emitter(RING)], { minDepth: 1, maxDepth: 2 }],
    ] as const) {
      const solid4 = solid4Of([...transforms], band);
      const solid3 = solid3Of([...transforms], band);
      for (const p of slicePoints(250, 7)) {
        const d3 = condensationSolidSignedDistance3(solid3, p);
        const d4 = condensationSolidSignedDistance4(solid4, p);
        expect(Math.abs(d4 - d3)).toBeLessThanOrEqual(
          1e-12 * Math.max(1, Math.abs(d3)),
        );
        expect(condensationSolidContains4(solid4, p)).toBe(
          condensationSolidContains3(solid3, p),
        );
      }
    }
  });

  it("sweeps the kaleidoscope copies exactly as the 3D solid does", () => {
    const transforms = [...stretchedCorners(), emitter(RING)];
    const symmetry = { order: 3, plane: "xy" as const };
    const options = { condensationDepthBand: { maxDepth: 2 } };
    const solid4 = buildCondensationSolid4(
      buildSurfaceDE4(transforms, null, symmetry, options),
    );
    const solid3 = buildCondensationSolid3(
      buildSurfaceDE(transforms, null, symmetry, options),
    );
    expect(solid4.maps.length).toBe(12);
    expect(condensationSolidPoseAdmission4(solid4, CANONICAL).ok).toBe(true);
    for (const p of slicePoints(200, 5)) {
      const d3 = condensationSolidSignedDistance3(solid3, p);
      expect(
        Math.abs(condensationSolidSignedDistance4(solid4, p) - d3),
      ).toBeLessThanOrEqual(1e-12 * Math.max(1, Math.abs(d3)));
    }
  });

  it("equals the independent 4D brute-force union on the canonical slice", () => {
    const band = { minDepth: 0, maxDepth: 3 };
    const transforms = [...stretchedCorners(), emitter(SPHERE)];
    const solid = solid4Of(transforms, band);
    let inside = 0;
    for (const p of slicePoints(300, 11, 1.1)) {
      const ref = bruteUnion4(transforms, band, p);
      const got = condensationSolidSignedDistance4(solid, p);
      expect(Math.abs(got - ref.field)).toBeLessThanOrEqual(
        1e-12 * Math.max(1, Math.abs(ref.field)),
      );
      expect(got <= 0).toBe(ref.member);
      if (ref.member) inside++;
    }
    expect(inside).toBeGreaterThan(0);
  });

  it("carries every map's image of its origin ball inside it", () => {
    const solid = solid4Of([...stretchedCorners(), emitter(RING)], {
      maxDepth: 3,
    });
    for (const map of solid.maps) {
      const fwd = inverse4(map.invM);
      const fc = [0, 1, 2, 3].map(
        (r) =>
          -(
            fwd[r * 4] * map.invT[0] +
            fwd[r * 4 + 1] * map.invT[1] +
            fwd[r * 4 + 2] * map.invT[2] +
            fwd[r * 4 + 3] * map.invT[3]
          ),
      );
      expect(Math.hypot(...fc) + map.sigmaMax * solid.radius).toBeLessThan(
        solid.radius,
      );
    }
  });

  it("admits the lifted document's canonical pose", () => {
    const solid = solid4Of([...stretchedCorners(), emitter(SPHERE)], {
      maxDepth: 2,
    });
    expect(condensationSolidPoseAdmission4(solid, CANONICAL)).toEqual({
      ok: true,
    });
  });

  it("refuses a slab, a w-turning rotor and a slice off the flats", () => {
    const solid = solid4Of([...sierpinskiTetrahedron(), emitter(SPHERE)], {
      maxDepth: 2,
    });
    const c = Math.cos(0.3);
    const s = Math.sin(0.3);
    const xwRotor = [c, 0, 0, -s, 0, 1, 0, 0, 0, 0, 1, 0, s, 0, 0, c];
    expect(
      condensationSolidPoseAdmission4(solid, { ...CANONICAL, sliceHalfW: 0.1 }),
    ).toEqual({ ok: false, reason: "a slice with thickness" });
    expect(
      condensationSolidPoseAdmission4(solid, { ...CANONICAL, rotor: xwRotor }),
    ).toEqual({ ok: false, reason: "a rotor that turns w" });
    expect(
      condensationSolidPoseAdmission4(solid, { ...CANONICAL, w0: 0.2 }).ok,
    ).toBe(false);
  });

  it("pins the 4D Surface descent of a finite band to the solid on the slice", () => {
    const transforms = [...sierpinskiTetrahedron(), emitter(SPHERE)];
    const de = buildSurfaceDE4(transforms, null, undefined, {
      condensationDepthBand: { maxDepth: 2 },
    });
    const solid = buildCondensationSolid4(de);
    for (const p of slicePoints(400, 23, 1.5)) {
      const s = condensationSolidSignedDistance4(solid, p);
      const d = estimateDistance4Refined(de, p);
      // The 4D display estimator is unsigned inside (the hypot form), so
      // the pins are the exterior bound and the membership sign.
      expect(d <= 0).toBe(s <= 0);
      if (s > 0) {
        expect(d).toBeLessThanOrEqual(s + 1e-12);
        expect(d).toBeGreaterThanOrEqual(0.5 * s);
      }
    }
  });

  it("refuses the pose for a map that turns into w", () => {
    const corners = sierpinskiTetrahedron();
    corners[1] = { ...corners[1], w: { rotation: { xw: 0.4 } } };
    const solid = solid4Of([...corners, emitter(SPHERE)], { maxDepth: 2 });
    expect(condensationSolidPoseAdmission4(solid, CANONICAL)).toEqual({
      ok: false,
      reason: "a map that mixes w",
    });
  });
});

describe("condensation solid emitter rule (both dimensions)", () => {
  const withShape = (shape: ShapeSpec) => [
    ...sierpinskiTetrahedron(),
    emitter(shape),
  ];
  const reasons = (shape: ShapeSpec) => {
    const band = { condensationDepthBand: { maxDepth: 2 } };
    return [
      condensationSolidAdmission3(
        buildSurfaceDE(withShape(shape), null, undefined, band),
      ),
      condensationSolidAdmission4(
        buildSurfaceDE4(withShape(shape), null, undefined, band),
      ),
    ];
  };

  it("admits unions of the exact analytic primitives", () => {
    const union: ShapeSpec = {
      parts: [
        { primitive: { kind: "sphere", radius: 0.5 }, combine: "union" },
        { primitive: { kind: "box", half: [0.3, 0.2, 0.4] }, combine: "union" },
        {
          primitive: { kind: "torus", major: 0.6, minor: 0.2 },
          combine: "union",
        },
        {
          primitive: {
            kind: "capsule",
            a: [0, -1, 0],
            b: [0, 1, 0],
            radius: 0.1,
          },
          combine: "union",
        },
      ],
    };
    expect(reasons(union)).toEqual([{ ok: true }, { ok: true }]);
  });

  it("refuses an intersect part, whose distance is only conservative", () => {
    const lens: ShapeSpec = {
      parts: [
        { primitive: { kind: "sphere", radius: 0.8 }, combine: "union" },
        {
          primitive: { kind: "box", half: [0.5, 0.5, 0.5] },
          combine: "intersect",
        },
      ],
    };
    const refused = { ok: false, reason: "an intersect emitter part" };
    expect(reasons(lens)).toEqual([refused, refused]);
  });

  it("refuses the gear and a spindle torus", () => {
    const gear = { ok: false, reason: "a gear emitter shape" };
    expect(reasons(GEAR_SHAPE)).toEqual([gear, gear]);
    const spindle: ShapeSpec = {
      parts: [
        {
          primitive: { kind: "torus", major: 0.2, minor: 0.5 },
          combine: "union",
        },
      ],
    };
    const refused = { ok: false, reason: "a spindle torus emitter shape" };
    expect(reasons(spindle)).toEqual([refused, refused]);
  });
});
