import { rotationMatrixXYZ, composeAffine } from "./affine";
import {
  applyAffine4,
  composeAffine4,
  embedTransform3,
  isFlatTransform,
  meanContraction,
  planeHasW,
  rotationMatrix4,
  symmetryIsNonFlat,
  symmetryRotation4,
  systemIsFlat,
  systemPartsAreNonFlat,
  toTransform4,
} from "./affine4";
import { symmetryRotation } from "./chaos-game";
import { runChaosGame4 } from "./chaos-game-4d";
import { defaultFinalTransform, defaultTransforms } from "./presets";
import { mulberry32 } from "./rng";
import type { Affine4 } from "./affine4";
import { SYMMETRY_PLANES } from "./types";
import type { SymmetryParams, Transform, Transform4 } from "./types";

const HALF_PI = Math.PI / 2;

/** Apply a bare row-major 4x4 (no translation) to a 4-vector. */
function apply(m: number[], v: number[]): number[] {
  const out = [0, 0, 0, 0];
  for (let r = 0; r < 4; r++) {
    out[r] =
      m[r * 4] * v[0] +
      m[r * 4 + 1] * v[1] +
      m[r * 4 + 2] * v[2] +
      m[r * 4 + 3] * v[3];
  }
  return out;
}

/** Row-major 4x4 product a·b. */
function mul4(a: number[], b: number[]): number[] {
  const out = new Array<number>(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[r * 4 + k] * b[k * 4 + c];
      out[r * 4 + c] = sum;
    }
  }
  return out;
}

function transpose4(m: number[]): number[] {
  const out = new Array<number>(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) out[c * 4 + r] = m[r * 4 + c];
  }
  return out;
}

/** The upper-left 3x3 block of a row-major 4x4, as a row-major 3x3. */
function upperLeft3x3(m: number[]): number[] {
  return [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
}

function expectVecClose(
  actual: number[],
  expected: number[],
  digits = 12,
): void {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((value, i) => expect(actual[i]).toBeCloseTo(value, digits));
}

describe("rotationMatrix4", () => {
  it("is the exact identity when no angle is given", () => {
    // prettier-ignore
    expect(rotationMatrix4({})).toEqual([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]);
  });

  // Each single-plane rotation by +pi/2 sends its own +a axis to +b, and leaves
  // the two complementary basis vectors untouched (the R_ab convention).
  it("xy rotation turns +x toward +y, leaving z and w fixed", () => {
    const m = rotationMatrix4({ xy: HALF_PI });
    expectVecClose(apply(m, [1, 0, 0, 0]), [0, 1, 0, 0]);
    expectVecClose(apply(m, [0, 0, 1, 0]), [0, 0, 1, 0]);
    expectVecClose(apply(m, [0, 0, 0, 1]), [0, 0, 0, 1]);
  });

  it("xz rotation turns +x toward +z, leaving y and w fixed", () => {
    const m = rotationMatrix4({ xz: HALF_PI });
    expectVecClose(apply(m, [1, 0, 0, 0]), [0, 0, 1, 0]);
    expectVecClose(apply(m, [0, 1, 0, 0]), [0, 1, 0, 0]);
    expectVecClose(apply(m, [0, 0, 0, 1]), [0, 0, 0, 1]);
  });

  it("yz rotation turns +y toward +z, leaving x and w fixed", () => {
    const m = rotationMatrix4({ yz: HALF_PI });
    expectVecClose(apply(m, [0, 1, 0, 0]), [0, 0, 1, 0]);
    expectVecClose(apply(m, [1, 0, 0, 0]), [1, 0, 0, 0]);
    expectVecClose(apply(m, [0, 0, 0, 1]), [0, 0, 0, 1]);
  });

  it("xw rotation turns +x toward +w, leaving y and z fixed", () => {
    const m = rotationMatrix4({ xw: HALF_PI });
    expectVecClose(apply(m, [1, 0, 0, 0]), [0, 0, 0, 1]);
    expectVecClose(apply(m, [0, 1, 0, 0]), [0, 1, 0, 0]);
    expectVecClose(apply(m, [0, 0, 1, 0]), [0, 0, 1, 0]);
  });

  it("yw rotation turns +y toward +w, leaving x and z fixed", () => {
    const m = rotationMatrix4({ yw: HALF_PI });
    expectVecClose(apply(m, [0, 1, 0, 0]), [0, 0, 0, 1]);
    expectVecClose(apply(m, [1, 0, 0, 0]), [1, 0, 0, 0]);
    expectVecClose(apply(m, [0, 0, 1, 0]), [0, 0, 1, 0]);
  });

  it("zw rotation turns +z toward +w, leaving x and y fixed", () => {
    const m = rotationMatrix4({ zw: HALF_PI });
    expectVecClose(apply(m, [0, 0, 1, 0]), [0, 0, 0, 1]);
    expectVecClose(apply(m, [1, 0, 0, 0]), [1, 0, 0, 0]);
    expectVecClose(apply(m, [0, 1, 0, 0]), [0, 1, 0, 0]);
  });

  it("is orthogonal (R·Rᵀ = I) for random angle sets across all six planes", () => {
    for (const seed of [1, 7, 42, 1000]) {
      const rng = mulberry32(seed);
      const angle = () => (rng() - 0.5) * 4; // spread across a few radians
      const m = rotationMatrix4({
        xy: angle(),
        xz: angle(),
        yz: angle(),
        xw: angle(),
        yw: angle(),
        zw: angle(),
      });
      const product = mul4(m, transpose4(m));
      // prettier-ignore
      const identity = [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
      ];
      identity.forEach((v, i) => expect(product[i]).toBeCloseTo(v, 12));
    }
  });
});

describe("rotationMatrix4 vs. the 3D convention", () => {
  it("reproduces rotationMatrixXYZ in its upper-left 3x3 with { yz: rx, xz: -ry, xy: rz }", () => {
    for (const seed of [2, 13, 99, 500]) {
      const rng = mulberry32(seed);
      const rx = (rng() - 0.5) * 3;
      const ry = (rng() - 0.5) * 3;
      const rz = (rng() - 0.5) * 3;
      const m = rotationMatrix4({ yz: rx, xz: -ry, xy: rz });
      expectVecClose(upperLeft3x3(m), rotationMatrixXYZ(rx, ry, rz));
      // Row 3 and column 3 are exactly the identity's — the embedding never
      // touches w.
      expect([m[12], m[13], m[14], m[15]]).toEqual([0, 0, 0, 1]);
      expect([m[3], m[7], m[11], m[15]]).toEqual([0, 0, 0, 1]);
    }
  });
});

describe("symmetryRotation4", () => {
  /** ENTRY-FOR-ENTRY equality, `-0` and `+0` counted equal — the same
   * comparison `chaos-game.test.ts` pins the 3D migration with, for the same
   * reason: these matrices carry a `-0` where the other carries `+0`
   * (`-c*f` with `f = 0` against a literal `0`), which no arithmetic
   * downstream can tell apart. */
  function expectSameMatrix(actual: number[], expected: number[]): void {
    expect(actual).toHaveLength(expected.length);
    for (let i = 0; i < expected.length; i++) {
      expect(actual[i] + 0).toBe(expected[i] + 0);
    }
  }

  const ANGLES = [0.3, 1.1, 2.4, -0.7, (2 * Math.PI) / 5];

  // ——— THE pin: a flat system's kaleidoscope is the SAME kaleidoscope on
  // either path ———
  //
  // A w-free plane with no twist is exactly what the 3D chaos game can
  // express, so `symmetryRotation4` must reproduce `chaos-game.ts`'s
  // `symmetryRotation` there — not up to a rotation of the same order (a
  // cyclic group is sign-agnostic on its own), but entry for entry, because
  // the 3D↔4D SLOT correspondence depends on the absolute sign. Failing this
  // means the PLANE_SIGN table is wrong.

  it("reproduces the 3D symmetryRotation entry for entry on every w-free plane", () => {
    for (const plane of ["xy", "xz", "yz"] as const) {
      for (const angle of ANGLES) {
        expectSameMatrix(
          upperLeft3x3(symmetryRotation4(plane, angle, 0)),
          symmetryRotation(plane, angle),
        );
      }
    }
  });

  it("leaves w exactly untouched on a w-free plane at twist 0 (a single factor, never a product)", () => {
    for (const plane of ["xy", "xz", "yz"] as const) {
      for (const angle of ANGLES) {
        const m = symmetryRotation4(plane, angle, 0);
        expect([m[12], m[13], m[14], m[15]]).toEqual([0, 0, 0, 1]);
        expect([m[3], m[7], m[11]]).toEqual([0, 0, 0]);
      }
    }
  });

  it("negates only the xz angle against rotationMatrix4's own R_ab", () => {
    for (const angle of ANGLES) {
      expectSameMatrix(symmetryRotation4("yz", angle), rotationMatrix4({ yz: angle })); // prettier-ignore
      expectSameMatrix(symmetryRotation4("xy", angle), rotationMatrix4({ xy: angle })); // prettier-ignore
      expectSameMatrix(symmetryRotation4("xz", angle), rotationMatrix4({ xz: -angle })); // prettier-ignore
    }
    // And genuinely differs from the un-negated factor, so the xz assertion
    // above is not vacuously true at some symmetric angle.
    const negated = symmetryRotation4("xz", 1.1);
    const plain = rotationMatrix4({ xz: 1.1 });
    expect(negated[2]).toBeCloseTo(-plain[2], 12);
    expect(negated[2]).not.toBeCloseTo(plain[2], 6);
  });

  it("turns the ORTHOGONAL plane by angle * twist, each plane paired with its complement", () => {
    // xy↔zw, xz↔yw, xw↔yz — the only way to split four coordinates into two
    // disjoint planes. The twist angle carries the complement's own sign, so
    // `yw` reads +, and `xz` (as a complement, under plane `yw`) reads −.
    expectSameMatrix(
      symmetryRotation4("xy", 0.4, 2),
      rotationMatrix4({ xy: 0.4, zw: 0.8 }),
    );
    expectSameMatrix(
      symmetryRotation4("xz", 0.4, 2),
      rotationMatrix4({ xz: -0.4, yw: 0.8 }),
    );
    expectSameMatrix(
      symmetryRotation4("yw", 0.4, 2),
      rotationMatrix4({ yw: 0.4, xz: -0.8 }),
    );
    expectSameMatrix(
      symmetryRotation4("xw", 0.4, 2),
      rotationMatrix4({ xw: 0.4, yz: 0.8 }),
    );
  });

  it("moves the w = 0 hyperplane off itself with a twist, where twist 0 never does", () => {
    const simple = symmetryRotation4("xy", 0.4, 0);
    const twisted = symmetryRotation4("xy", 0.4, 1);
    // A point in the w = 0 slice: the simple rotation keeps it there, the
    // isoclinic twist lifts it out (the zw factor carries z into w).
    expect(apply(simple, [0.3, -0.2, 0.5, 0])[3]).toBe(0);
    expect(Math.abs(apply(twisted, [0.3, -0.2, 0.5, 0])[3])).toBeGreaterThan(
      0.1,
    );
  });

  it("is the identity at angle 0 whatever the twist (copy 0 of any kaleidoscope)", () => {
    expectSameMatrix(symmetryRotation4("zw", 0, 3), rotationMatrix4({}));
  });

  it("accepts the w-planes the 3D symmetryRotation refuses", () => {
    for (const plane of ["xw", "yw", "zw"] as const) {
      expect(() => symmetryRotation(plane, 0.5)).toThrow(/mixes w/);
      expect(symmetryRotation4(plane, 0.5)).toHaveLength(16);
    }
  });
});

describe("composeAffine4", () => {
  it("puts a pure scale on the diagonal and the position in t (exactly)", () => {
    const a = composeAffine4({ position: [1, 2, 3, 4], scale: [2, 3, 4, 5] });
    // prettier-ignore
    expect(a.m).toEqual([
      2, 0, 0, 0,
      0, 3, 0, 0,
      0, 0, 4, 0,
      0, 0, 0, 5,
    ]);
    expect(a.t).toEqual([1, 2, 3, 4]);
  });

  it("scales each column of the rotation by that column's scale", () => {
    // A single xy rotation, then non-uniform scale: column c of R is scaled by
    // scale[c], so m[r*4+c] === R[r*4+c] * scale[c].
    const rot = { xy: 0.7 };
    const scale: [number, number, number, number] = [2, 3, 4, 5];
    const R = rotationMatrix4(rot);
    const a = composeAffine4({ position: [0, 0, 0, 0], scale, rotation: rot });
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        expect(a.m[r * 4 + c]).toBeCloseTo(R[r * 4 + c] * scale[c], 12);
      }
    }
  });

  it("with identity rotation and unit scale, a pure shear composes to exactly U", () => {
    // M = R·diag(scale)·U with R = I and scale = 1 is just U — the unit
    // upper-triangular matrix whose above-diagonal entries are the six shear
    // fields at row index(a), column index(b). Pinned to a hand-written U.
    const a = composeAffine4({
      position: [0, 0, 0, 0],
      scale: [1, 1, 1, 1],
      shear: { xy: 2, xz: 3, xw: 4, yz: 5, yw: 6, zw: 7 },
    });
    // prettier-ignore
    expect(a.m).toEqual([
      1, 2, 3, 4,
      0, 1, 5, 6,
      0, 0, 1, 7,
      0, 0, 0, 1,
    ]);
  });

  it("folds shear as a right-multiply M = R·diag(scale)·U (vs. an explicit product)", () => {
    // Independent check that the in-place descending-column fold equals the
    // honest matrix product B·U, for a rotated + non-uniformly scaled B and a
    // full six-entry shear.
    const rotation = { xy: 0.4, zw: 0.9, xw: -0.3 };
    const scale: [number, number, number, number] = [1.5, 0.7, 2.1, 0.5];
    const shear = { xy: 0.2, xz: -0.4, yz: 0.6, xw: 0.3, yw: -0.5, zw: 0.8 };
    // B = R·diag(scale): compose with NO shear, then multiply by U by hand.
    const B = composeAffine4({ position: [0, 0, 0, 0], scale, rotation }).m;
    // prettier-ignore
    const U = [
      1, shear.xy, shear.xz, shear.xw,
      0, 1,        shear.yz, shear.yw,
      0, 0,        1,        shear.zw,
      0, 0,        0,        1,
    ];
    const expected = mul4(B, U);
    const a = composeAffine4({
      position: [0, 0, 0, 0],
      scale,
      rotation,
      shear,
    });
    expectVecClose(a.m, expected);
  });
});

describe("applyAffine4", () => {
  it("computes m·p + t for a hand-worked example", () => {
    // m shears x by y (row 0 has a 2 in the y column); t offsets every axis by 1.
    const a: Affine4 = {
      // prettier-ignore
      m: [
        1, 2, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
      ],
      t: [1, 1, 1, 1],
    };
    // x' = 1·1 + 2·1 + 1 = 4; y' = 1 + 1 = 2; z' = 1 + 1 = 2; w' = 1 + 1 = 2.
    expect(applyAffine4(a, 1, 1, 1, 1)).toEqual([4, 2, 2, 2]);
  });
});

describe("meanContraction", () => {
  it("uses magnitudes, not signed values, for a mixed-sign scale", () => {
    expect(meanContraction([-0.3, 0.6, 0.9])).toBeCloseTo(0.6, 15);
  });
});

describe("embedTransform3", () => {
  function transform(overrides: Partial<Transform>): Transform {
    return {
      id: 0,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      ...overrides,
    };
  }

  it("matches composeAffine's linear part in the upper-left 3x3 for random affine maps WITH shear", () => {
    for (const seed of [3, 21, 77, 2024]) {
      const rng = mulberry32(seed);
      const t = transform({
        position: [(rng() - 0.5) * 2, (rng() - 0.5) * 2, (rng() - 0.5) * 2],
        rotation: [(rng() - 0.5) * 3, (rng() - 0.5) * 3, (rng() - 0.5) * 3],
        scale: [rng() + 0.3, rng() + 0.3, rng() + 0.3],
        // Random shear too (fr-hy8): the embed now carries it, so the fold must
        // still agree with the 3D composeAffine in the upper-left 3x3.
        shear: [(rng() - 0.5) * 2, (rng() - 0.5) * 2, (rng() - 0.5) * 2],
      });
      const a3 = composeAffine(t);
      const a4 = composeAffine4(embedTransform3(t));
      expectVecClose(upperLeft3x3(a4.m), a3.m);
      // The w row is exactly [0, 0, 0, mean spatial contraction] — the embed
      // contracts w at the map's mean 3D rate so 4D edits stay contractive
      // (see embedTransform3's JSDoc). The embedded shear's w-column entries are
      // absent, so the shear fold never touches the w row/column: it stays
      // exactly [0, 0, 0, meanContraction]. Translation gains an exact 0 fourth
      // entry. Scales here are positive, so the mean needs no abs and both
      // computations are the identical fp expression (exact equality holds).
      const meanContraction = (t.scale[0] + t.scale[1] + t.scale[2]) / 3;
      expect([a4.m[12], a4.m[13], a4.m[14]]).toEqual([0, 0, 0]);
      expect(a4.m[15]).toBe(meanContraction);
      // w-column linear entries (rows 0-2) also stay 0.
      expect([a4.m[3], a4.m[7], a4.m[11]]).toEqual([0, 0, 0]);
      expect(a4.t).toEqual([t.position[0], t.position[1], t.position[2], 0]);
    }
  });

  it("carries the weight through when present", () => {
    expect(embedTransform3(transform({ weight: 7 })).weight).toBe(7);
    expect(embedTransform3(transform({})).weight).toBeUndefined();
  });

  it("carries a non-zero shear into { xy, xz, yz } with the w-column entries absent", () => {
    const embedded = embedTransform3(transform({ shear: [0.5, -0.3, 0.2] }));
    expect(embedded.shear).toEqual({ xy: 0.5, xz: -0.3, yz: 0.2 });
    // The w-column shear entries are absent (the embed lives in the w = 0 slice).
    expect(embedded.shear?.xw).toBeUndefined();
    expect(embedded.shear?.yw).toBeUndefined();
    expect(embedded.shear?.zw).toBeUndefined();
  });

  it("leaves shear absent for an unsheared (or explicitly zero-shear) map", () => {
    expect(embedTransform3(transform({})).shear).toBeUndefined();
    expect(
      embedTransform3(transform({ shear: [0, 0, 0] })).shear,
    ).toBeUndefined();
  });

  it("copies the variation list verbatim (into a fresh array)", () => {
    const variations = [
      { type: "spherical" as const, weight: 0.6 },
      { type: "swirl" as const, weight: 0.4 },
    ];
    const embedded = embedTransform3(transform({ variations }));
    expect(embedded.variations).toEqual(variations);
    // A fresh array + fresh entries, so later edits can't alias through.
    expect(embedded.variations).not.toBe(variations);
    expect(embedded.variations?.[0]).not.toBe(variations[0]);
  });

  it("leaves variations absent for a map with none", () => {
    expect(embedTransform3(transform({})).variations).toBeUndefined();
    expect(
      embedTransform3(transform({ variations: [] })).variations,
    ).toBeUndefined();
  });

  it("carries authored colorIndex/colorSpeed onto the lifted Transform4 (fr-hiyu)", () => {
    const embedded = embedTransform3(
      transform({ colorIndex: 0.75, colorSpeed: 0.2 }),
    );
    expect(embedded.colorIndex).toBe(0.75);
    expect(embedded.colorSpeed).toBe(0.2);
  });

  it("leaves colorIndex/colorSpeed absent when the source has neither (no key invented)", () => {
    const embedded = embedTransform3(transform({}));
    expect(embedded.colorIndex).toBeUndefined();
    expect(embedded.colorSpeed).toBeUndefined();
    expect("colorIndex" in embedded).toBe(false);
    expect("colorSpeed" in embedded).toBe(false);
  });
});

describe("isFlatTransform", () => {
  function transform(overrides: Partial<Transform>): Transform {
    return {
      id: 0,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      ...overrides,
    };
  }

  it("is flat for a transform with no w block", () => {
    expect(isFlatTransform(transform({}))).toBe(true);
  });

  it("is flat for an empty w block", () => {
    expect(isFlatTransform(transform({ w: {} }))).toBe(true);
  });

  it("is flat for a w block whose fields are all present and exactly zero", () => {
    const t = transform({
      w: {
        position: 0,
        scale: 0,
        rotation: { xw: 0, yw: 0, zw: 0 },
        shear: { xw: 0, yw: 0, zw: 0 },
      },
    });
    expect(isFlatTransform(t)).toBe(true);
  });

  it("is not flat when w.position is nonzero", () => {
    expect(isFlatTransform(transform({ w: { position: 0.1 } }))).toBe(false);
  });

  it("is not flat when w.scale is nonzero", () => {
    expect(isFlatTransform(transform({ w: { scale: 0.1 } }))).toBe(false);
  });

  it("is not flat when w.rotation.xw is nonzero", () => {
    expect(isFlatTransform(transform({ w: { rotation: { xw: 0.1 } } }))).toBe(
      false,
    );
  });

  it("is not flat when w.rotation.yw is nonzero", () => {
    expect(isFlatTransform(transform({ w: { rotation: { yw: 0.1 } } }))).toBe(
      false,
    );
  });

  it("is not flat when w.rotation.zw is nonzero", () => {
    expect(isFlatTransform(transform({ w: { rotation: { zw: 0.1 } } }))).toBe(
      false,
    );
  });

  it("is not flat when w.shear.xw is nonzero", () => {
    expect(isFlatTransform(transform({ w: { shear: { xw: 0.1 } } }))).toBe(
      false,
    );
  });

  it("is not flat when w.shear.yw is nonzero", () => {
    expect(isFlatTransform(transform({ w: { shear: { yw: 0.1 } } }))).toBe(
      false,
    );
  });

  it("is not flat when w.shear.zw is nonzero", () => {
    expect(isFlatTransform(transform({ w: { shear: { zw: 0.1 } } }))).toBe(
      false,
    );
  });
});

describe("systemIsFlat", () => {
  it("is true for the default preset (no transform carries a w block)", () => {
    expect(systemIsFlat(defaultTransforms())).toBe(true);
  });

  it("flips to false when any single transform in the system gets a nonzero w field", () => {
    const transforms = defaultTransforms();
    const withW = transforms.map((t, i) =>
      i === 2 ? { ...t, w: { position: 0.2 } } : t,
    );
    expect(systemIsFlat(withW)).toBe(false);
  });
});

describe("systemPartsAreNonFlat", () => {
  /** The identity kaleidoscope: order 1, so it contributes nothing to the
   * predicate whatever plane it names (see `symmetryIsNonFlat`). */
  const noSymmetry: SymmetryParams = { order: 1, plane: "xz" };

  it("is false for flat transforms with no final transform", () => {
    expect(systemPartsAreNonFlat(defaultTransforms(), null, noSymmetry)).toBe(
      false,
    );
  });

  it("is true when any transform carries a non-trivial w block", () => {
    const transforms = defaultTransforms();
    const nonFlat: Transform = { ...transforms[0], w: { position: 0.5 } };
    expect(
      systemPartsAreNonFlat(
        [nonFlat, ...transforms.slice(1)],
        null,
        noSymmetry,
      ),
    ).toBe(true);
  });

  it("is true when the final transform carries a non-trivial w block", () => {
    const transforms = defaultTransforms();
    const lens = { ...defaultFinalTransform(), w: { position: 0.5 } };
    expect(systemPartsAreNonFlat(transforms, lens, noSymmetry)).toBe(true);
  });

  it("is true when the kaleidoscope alone turns in a w-plane (fr-q0h6)", () => {
    expect(
      systemPartsAreNonFlat(defaultTransforms(), null, {
        order: 3,
        plane: "zw",
      }),
    ).toBe(true);
  });

  it("is true when the kaleidoscope alone carries a twist (fr-q0h6)", () => {
    expect(
      systemPartsAreNonFlat(defaultTransforms(), null, {
        order: 5,
        plane: "xz",
        twist: 2,
      }),
    ).toBe(true);
  });
});

describe("symmetryIsNonFlat", () => {
  it("is false for the identity order, whatever plane or twist it names", () => {
    for (const plane of SYMMETRY_PLANES) {
      expect(symmetryIsNonFlat({ order: 1, plane })).toBe(false);
      expect(symmetryIsNonFlat({ order: 1, plane, twist: 3 })).toBe(false);
    }
  });

  it("is false for the three w-free planes with no twist", () => {
    for (const plane of ["xy", "xz", "yz"] as const) {
      expect(symmetryIsNonFlat({ order: 6, plane })).toBe(false);
      expect(symmetryIsNonFlat({ order: 6, plane, twist: 0 })).toBe(false);
    }
  });

  it("is true for each w-plane at order > 1", () => {
    for (const plane of ["xw", "yw", "zw"] as const) {
      expect(symmetryIsNonFlat({ order: 2, plane })).toBe(true);
    }
  });

  it("is true for a nonzero twist in a w-free plane at order > 1", () => {
    expect(symmetryIsNonFlat({ order: 4, plane: "xy", twist: 1 })).toBe(true);
  });
});

describe("planeHasW", () => {
  it("splits the six planes into the three that mix w and the three that do not", () => {
    expect(SYMMETRY_PLANES.filter(planeHasW)).toEqual(["xw", "yw", "zw"]);
    expect(SYMMETRY_PLANES.filter((p) => !planeHasW(p))).toEqual([
      "xy",
      "xz",
      "yz",
    ]);
  });
});

describe("toTransform4", () => {
  function transform(overrides: Partial<Transform>): Transform {
    return {
      id: 0,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      ...overrides,
    };
  }

  it("equals embedTransform3(t) exactly for a w-less transform (same shape, same absent fields)", () => {
    const t = transform({
      position: [0.2, -0.3, 0.4],
      rotation: [0.1, 0.2, 0.3],
      scale: [0.6, 0.7, 0.8],
    });
    // toStrictEqual: toEqual would treat `{ shear: undefined }` and `{}` as
    // equal, masking exactly the shape leak this anchor exists to catch.
    expect(toTransform4(t)).toStrictEqual(embedTransform3(t));
  });

  it("overrides position[3] and leaves the derived scale[3] alone when only w.position is set", () => {
    const t = transform({ scale: [0.4, 0.6, 0.8], w: { position: 0.9 } });
    const lifted = toTransform4(t);
    expect(lifted.position[3]).toBe(0.9);
    expect(lifted.scale[3]).toBeCloseTo((0.4 + 0.6 + 0.8) / 3, 12);
  });

  it("uses an explicit w.scale in place of the derived mean contraction", () => {
    const t = transform({ scale: [0.4, 0.6, 0.8], w: { scale: 0.5 } });
    expect(toTransform4(t).scale[3]).toBe(0.5);
  });

  it("re-derives scale[3] from the current mean after a scale edit when w.scale is absent", () => {
    const t = transform({ scale: [0.4, 0.4, 0.4] });
    expect(toTransform4(t).scale[3]).toBeCloseTo(0.4, 12);

    // Edit t.scale in place, then lift again: scale[3] must track the NEW
    // mean, not whatever a first lift happened to compute.
    t.scale = [0.8, 0.8, 0.8];
    expect(toTransform4(t).scale[3]).toBeCloseTo(0.8, 12);
  });

  it("splices w rotation angles onto the embed's rotation object", () => {
    const t = transform({
      rotation: [0.1, 0.2, 0.3],
      w: { rotation: { xw: 0.5, yw: -0.2, zw: 0.1 } },
    });
    const base = embedTransform3(t);
    const lifted = toTransform4(t);
    expect(lifted.rotation).toEqual({
      ...base.rotation,
      xw: 0.5,
      yw: -0.2,
      zw: 0.1,
    });
  });

  it("creates a shear object for w-only shear when the 3D base is unsheared", () => {
    const t = transform({ w: { shear: { xw: 0.3 } } });
    expect(embedTransform3(t).shear).toBeUndefined(); // sanity: base is unsheared
    expect(toTransform4(t).shear).toEqual({ xw: 0.3 });
  });

  it("merges w shear entries onto an existing 3D-sheared embed", () => {
    const t = transform({
      shear: [0.5, -0.3, 0.2],
      w: { shear: { xw: 0.1, yw: 0.2, zw: 0.3 } },
    });
    expect(toTransform4(t).shear).toEqual({
      xy: 0.5,
      xz: -0.3,
      yz: 0.2,
      xw: 0.1,
      yw: 0.2,
      zw: 0.3,
    });
  });
});

describe("toTransform4 end-to-end (runChaosGame4 equivalence)", () => {
  it("runs identically to a hand-built Transform4 carrying the same params", () => {
    // A transform with overrides on every w field, lifted, must compose and
    // run exactly like a Transform4 written out by hand with the same
    // numbers — the anchor property that makes toTransform4 a genuine 3D/4D
    // unification rather than a separate code path.
    const t: Transform = {
      id: 0,
      position: [0.2, -0.1, 0.3],
      rotation: [0.1, 0.4, -0.2],
      scale: [0.5, 0.5, 0.5],
      w: {
        position: 0.15,
        scale: 0.45,
        rotation: { xw: 0.2, yw: -0.1, zw: 0.05 },
        shear: { xw: 0.1, yw: -0.05, zw: 0.02 },
      },
    };
    const lifted = toTransform4(t);
    // Hand-worked: embedTransform3 maps rotation [rx,ry,rz] = [0.1,0.4,-0.2]
    // to { yz: rx, xz: -ry, xy: rz }, the mean contraction (0.5) is overridden
    // by w.scale (0.45), and the w-column shear is created fresh (the 3D base
    // carries no shear of its own).
    const handBuilt: Transform4 = {
      position: [0.2, -0.1, 0.3, 0.15],
      scale: [0.5, 0.5, 0.5, 0.45],
      rotation: { yz: 0.1, xz: -0.4, xy: -0.2, xw: 0.2, yw: -0.1, zw: 0.05 },
      shear: { xw: 0.1, yw: -0.05, zw: 0.02 },
    };
    expect(lifted).toEqual(handBuilt);
    expect(composeAffine4(lifted)).toEqual(composeAffine4(handBuilt));

    const a = runChaosGame4([lifted], 500, mulberry32(13));
    const b = runChaosGame4([handBuilt], 500, mulberry32(13));
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.w)).toEqual(Array.from(b.w));
    expect(Array.from(a.transformIndices)).toEqual(
      Array.from(b.transformIndices),
    );
  });
});
