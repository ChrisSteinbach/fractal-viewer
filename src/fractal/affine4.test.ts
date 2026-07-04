import { rotationMatrixXYZ, composeAffine } from "./affine";
import {
  applyAffine4,
  composeAffine4,
  embedTransform3,
  rotationMatrix4,
} from "./affine4";
import { mulberry32 } from "./rng";
import type { Affine4 } from "./affine4";
import type { Transform } from "./types";

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

  it("matches composeAffine's linear part in the upper-left 3x3 for random affine-only maps", () => {
    for (const seed of [3, 21, 77, 2024]) {
      const rng = mulberry32(seed);
      const t = transform({
        position: [(rng() - 0.5) * 2, (rng() - 0.5) * 2, (rng() - 0.5) * 2],
        rotation: [(rng() - 0.5) * 3, (rng() - 0.5) * 3, (rng() - 0.5) * 3],
        scale: [rng() + 0.3, rng() + 0.3, rng() + 0.3],
      });
      const a3 = composeAffine(t);
      const a4 = composeAffine4(embedTransform3(t));
      expectVecClose(upperLeft3x3(a4.m), a3.m);
      // w row is exactly [0,0,0,1]; translation gains an exact 0 fourth entry.
      expect([a4.m[12], a4.m[13], a4.m[14], a4.m[15]]).toEqual([0, 0, 0, 1]);
      expect(a4.t).toEqual([t.position[0], t.position[1], t.position[2], 0]);
    }
  });

  it("carries the weight through when present", () => {
    expect(embedTransform3(transform({ weight: 7 })).weight).toBe(7);
    expect(embedTransform3(transform({})).weight).toBeUndefined();
  });

  it("throws on a non-zero shear (not representable in the 4D spike)", () => {
    expect(() => embedTransform3(transform({ shear: [0.5, 0, 0] }))).toThrow(
      RangeError,
    );
  });

  it("throws on an enabled variation (not representable in the 4D spike)", () => {
    expect(() =>
      embedTransform3(
        transform({ variations: [{ type: "swirl", weight: 1 }] }),
      ),
    ).toThrow(RangeError);
  });

  it("allows a zero-shear / zero-weight variation (nothing to drop)", () => {
    expect(() =>
      embedTransform3(transform({ shear: [0, 0, 0] })),
    ).not.toThrow();
    expect(() =>
      embedTransform3(
        transform({ variations: [{ type: "swirl", weight: 0 }] }),
      ),
    ).not.toThrow();
  });
});
