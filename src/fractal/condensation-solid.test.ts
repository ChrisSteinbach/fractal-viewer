import { composeAffine, inverse3x3 } from "./affine";
import {
  CONDENSATION_SOLID_MAX_DEPTH,
  buildCondensationSolid3,
  condensationSolidAdmission3,
  condensationSolidContains3,
  condensationSolidSignedDistance3,
} from "./condensation-solid";
import type { CondensationDepthBand } from "./condensation-de";
import { sierpinskiTetrahedron } from "./presets";
import { mulberry32 } from "./rng";
import { SHAPE_MARCH_SAFETY, shapeSdf, type ShapeSpec } from "./shapes";
import { buildSurfaceDE, singularValues3 } from "./surface-de";
import type { Transform, Vec3 } from "./types";

const SPHERE: ShapeSpec = {
  parts: [{ primitive: { kind: "sphere", radius: 0.9 }, combine: "union" }],
};
const BOX: ShapeSpec = {
  parts: [
    { primitive: { kind: "box", half: [0.7, 0.4, 0.5] }, combine: "union" },
  ],
};
/** A sphere cut by a box: the intersect fold makes its SDF conservative. */
const LENS: ShapeSpec = {
  parts: [
    { primitive: { kind: "sphere", radius: 0.8 }, combine: "union" },
    { primitive: { kind: "box", half: [0.5, 0.5, 0.5] }, combine: "intersect" },
  ],
};

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

/** Four corner maps with a shear-free NON-UNIFORM scale, so the maps are not
 * similarities and the prune threshold carries a singular ratio below 1. */
function stretchedCorners(): Transform[] {
  return sierpinskiTetrahedron().map((t) => ({
    ...t,
    rotation: [0.2, 0.1 * t.id, 0],
    scale: [0.5, 0.42, 0.46],
  }));
}

function solidOf(transforms: Transform[], band: CondensationDepthBand) {
  return buildCondensationSolid3(
    buildSurfaceDE(transforms, null, undefined, {
      condensationDepthBand: band,
    }),
    // The soundness tests build a conservative shape on purpose (the
    // emitter rule refuses it for routing, not for the field).
    { admitConservativeShapes: true },
  );
}

/** THE INDEPENDENT REFERENCE UNION: every word in the band, walked from the
 * transforms themselves (composeAffine, inverse3x3), never through the
 * surface DE or the module under test. */
function bruteUnion(
  transforms: Transform[],
  band: { minDepth: number; maxDepth: number },
  p: Vec3,
): { field: number; member: boolean } {
  const maps = transforms
    .filter((t) => !t.emitter)
    .map((t) => {
      const a = composeAffine(t);
      return { inv: inverse3x3(a.m), t: a.t, sigma: singularValues3(a.m).min };
    });
  const emitters = transforms
    .filter((t) => t.emitter)
    .map((t) => {
      const a = composeAffine(t);
      return {
        shape: t.emitter!,
        inv: inverse3x3(a.m),
        t: a.t,
        sigma: singularValues3(a.m).min,
      };
    });
  const apply = (inv: number[], t: Vec3, q: Vec3): Vec3 => {
    const u = [q[0] - t[0], q[1] - t[1], q[2] - t[2]];
    return [
      inv[0] * u[0] + inv[1] * u[1] + inv[2] * u[2],
      inv[3] * u[0] + inv[4] * u[1] + inv[5] * u[2],
      inv[6] * u[0] + inv[7] * u[1] + inv[8] * u[2],
    ];
  };
  let field = Infinity;
  let member = false;
  const walk = (q: Vec3, s: number, depth: number): void => {
    if (depth >= band.minDepth) {
      for (const e of emitters) {
        const local = apply(e.inv, e.t, q);
        const sd = shapeSdf(e.shape, local[0], local[1], local[2]);
        if (sd <= 0) member = true;
        field = Math.min(field, s * SHAPE_MARCH_SAFETY * e.sigma * sd);
      }
    }
    if (depth === band.maxDepth) return;
    for (const m of maps) walk(apply(m.inv, m.t, q), s * m.sigma, depth + 1);
  };
  walk(p, 1, 0);
  return { field, member };
}

function samples(n: number, seed: number, extent = 1.4): Vec3[] {
  const rng = mulberry32(seed);
  return Array.from({ length: n }, () => [
    (rng() * 2 - 1) * extent,
    (rng() * 2 - 1) * extent,
    (rng() * 2 - 1) * extent,
  ]);
}

describe("condensation solid (3D)", () => {
  it("equals the brute-force union over every word for exact shape SDFs", () => {
    const band = { minDepth: 0, maxDepth: 3 };
    for (const transforms of [
      [...sierpinskiTetrahedron(), emitter(SPHERE)],
      [...stretchedCorners(), emitter(BOX)],
    ]) {
      const solid = solidOf(transforms, band);
      for (const p of samples(300, 7)) {
        const ref = bruteUnion(transforms, band, p).field;
        const got = condensationSolidSignedDistance3(solid, p);
        expect(Math.abs(got - ref)).toBeLessThanOrEqual(
          1e-12 * Math.max(1, Math.abs(ref)),
        );
      }
    }
  });

  it("equals the brute-force union over a band that skips the root", () => {
    const band = { minDepth: 1, maxDepth: 2 };
    const transforms = [...stretchedCorners(), emitter(SPHERE)];
    const solid = solidOf(transforms, band);
    for (const p of samples(300, 11)) {
      const ref = bruteUnion(transforms, band, p).field;
      expect(
        Math.abs(condensationSolidSignedDistance3(solid, p) - ref),
      ).toBeLessThanOrEqual(1e-12 * Math.max(1, Math.abs(ref)));
    }
  });

  it("is the safety-scaled exact distance to a union of balls under similarity maps", () => {
    // Every member of a sphere emitter under similarities is itself a ball,
    // so the union's signed distance outside is exact in closed form.
    const transforms = [...sierpinskiTetrahedron(), emitter(SPHERE)];
    const band = { minDepth: 0, maxDepth: 2 };
    const solid = solidOf(transforms, band);
    const maps = transforms.filter((t) => !t.emitter).map(composeAffine);
    const e = composeAffine(transforms[4]);
    const balls: { c: Vec3; r: number }[] = [];
    const push = (m: number[], t: Vec3, scale: number, depth: number) => {
      // The ball f_w(e(B(0, 0.9))): centre f_w(e(0)), radius 0.9·0.5·scale.
      const c: Vec3 = [
        m[0] * e.t[0] + m[1] * e.t[1] + m[2] * e.t[2] + t[0],
        m[3] * e.t[0] + m[4] * e.t[1] + m[5] * e.t[2] + t[1],
        m[6] * e.t[0] + m[7] * e.t[1] + m[8] * e.t[2] + t[2],
      ];
      balls.push({ c, r: 0.9 * 0.5 * scale });
      if (depth === band.maxDepth) return;
      for (const f of maps) {
        const mm = [0, 0, 0, 0, 0, 0, 0, 0, 0];
        for (let r = 0; r < 3; r++)
          for (let k = 0; k < 3; k++)
            for (let j = 0; j < 3; j++)
              mm[r * 3 + k] += m[r * 3 + j] * f.m[j * 3 + k];
        const tt: Vec3 = [
          m[0] * f.t[0] + m[1] * f.t[1] + m[2] * f.t[2] + t[0],
          m[3] * f.t[0] + m[4] * f.t[1] + m[5] * f.t[2] + t[1],
          m[6] * f.t[0] + m[7] * f.t[1] + m[8] * f.t[2] + t[2],
        ];
        push(mm, tt, scale * 0.5, depth + 1);
      }
    };
    push([1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 0, 0], 1, 0);
    for (const p of samples(300, 3)) {
      const exact = Math.min(
        ...balls.map(
          (b) => Math.hypot(p[0] - b.c[0], p[1] - b.c[1], p[2] - b.c[2]) - b.r,
        ),
      );
      expect(condensationSolidSignedDistance3(solid, p)).toBeCloseTo(
        SHAPE_MARCH_SAFETY * exact,
        12,
      );
    }
  });

  it("never falls below the brute-force union's value and keeps its exact sign for a conservative shape SDF", () => {
    const band = { minDepth: 0, maxDepth: 3 };
    const transforms = [...stretchedCorners(), emitter(LENS)];
    const solid = solidOf(transforms, band);
    let inside = 0;
    for (const p of samples(400, 5, 1.1)) {
      const ref = bruteUnion(transforms, band, p);
      const got = condensationSolidSignedDistance3(solid, p);
      // Pruned subtrees only remove terms: never below the full union.
      expect(got).toBeGreaterThanOrEqual(ref.field - 1e-12);
      expect(got <= 0).toBe(ref.member);
      expect(condensationSolidContains3(solid, p)).toBe(ref.member);
      if (ref.member) inside++;
    }
    expect(inside).toBeGreaterThan(0);
  });

  it("decides membership exactly, agreeing with the field's sign", () => {
    const band = { minDepth: 0, maxDepth: 4 };
    const transforms = [...sierpinskiTetrahedron(), emitter(SPHERE)];
    const solid = solidOf(transforms, band);
    let inside = 0;
    for (const p of samples(500, 13, 1.2)) {
      const member = condensationSolidContains3(solid, p);
      expect(member).toBe(bruteUnion(transforms, band, p).member);
      expect(condensationSolidSignedDistance3(solid, p) <= 0).toBe(member);
      if (member) inside++;
    }
    expect(inside).toBeGreaterThan(0);
  });

  it("is the root term alone for an emitter-only system (the shipped C0)", () => {
    const transforms = [emitter(SPHERE)];
    const solid = solidOf(transforms, { maxDepth: 0 });
    for (const p of samples(100, 17))
      expect(condensationSolidSignedDistance3(solid, p)).toBeCloseTo(
        bruteUnion(transforms, { minDepth: 0, maxDepth: 0 }, p).field,
        13,
      );
  });

  it("carries every map's image of its ball inside it", () => {
    const solid = solidOf([...stretchedCorners(), emitter(BOX)], {
      maxDepth: 3,
    });
    for (const map of solid.maps) {
      const fwd = inverse3x3(map.invM);
      const u = [
        solid.center[0] - map.invT[0],
        solid.center[1] - map.invT[1],
        solid.center[2] - map.invT[2],
      ];
      const fc = [0, 1, 2].map(
        (r) =>
          fwd[r * 3] * u[0] + fwd[r * 3 + 1] * u[1] + fwd[r * 3 + 2] * u[2],
      );
      expect(
        Math.hypot(
          fc[0] - solid.center[0],
          fc[1] - solid.center[1],
          fc[2] - solid.center[2],
        ) +
          map.sigmaMax * solid.radius,
      ).toBeLessThanOrEqual(solid.radius);
    }
  });

  it("refuses an unbounded or too-deep band, and admits the ceiling", () => {
    const transforms = [...sierpinskiTetrahedron(), emitter(SPHERE)];
    const at = (band?: CondensationDepthBand) =>
      condensationSolidAdmission3(
        buildSurfaceDE(transforms, null, undefined, {
          condensationDepthBand: band,
        }),
      ).ok;
    expect(at()).toBe(false);
    expect(at({ maxDepth: CONDENSATION_SOLID_MAX_DEPTH + 1 })).toBe(false);
    expect(at({ maxDepth: CONDENSATION_SOLID_MAX_DEPTH })).toBe(true);
  });

  it("refuses a system without emitters and one with a fold map", () => {
    expect(
      condensationSolidAdmission3(buildSurfaceDE(sierpinskiTetrahedron())).ok,
    ).toBe(false);
    const folded = sierpinskiTetrahedron();
    folded[0] = { ...folded[0], variations: [{ type: "boxfold", weight: 1 }] };
    const de = buildSurfaceDE([...folded, emitter(SPHERE)], null, undefined, {
      condensationDepthBand: { maxDepth: 2 },
    });
    expect(condensationSolidAdmission3(de)).toEqual({
      ok: false,
      reason: "a fold map",
    });
  });
});
