import {
  applyAffine,
  composeAffine,
  rotationMatrixXYZ,
  shearMatrix,
} from "./affine";
import type { Transform, Vec3 } from "./types";

const HALF_PI = Math.PI / 2;

function transform(overrides: Partial<Transform>): Transform {
  return {
    id: 0,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    ...overrides,
  };
}

function expectVecClose(actual: number[], expected: number[]): void {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((value, i) => expect(actual[i]).toBeCloseTo(value, 10));
}

describe("rotationMatrixXYZ", () => {
  it("is the identity for zero angles", () => {
    expectVecClose(rotationMatrixXYZ(0, 0, 0), [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it("rotates (0,1,0) to (0,0,1) about the X axis", () => {
    const a = composeAffine(transform({ rotation: [HALF_PI, 0, 0] }));
    expectVecClose(applyAffine(a, 0, 1, 0), [0, 0, 1]);
  });

  it("rotates (1,0,0) to (0,0,-1) about the Y axis", () => {
    const a = composeAffine(transform({ rotation: [0, HALF_PI, 0] }));
    expectVecClose(applyAffine(a, 1, 0, 0), [0, 0, -1]);
  });

  it("rotates (1,0,0) to (0,1,0) about the Z axis", () => {
    const a = composeAffine(transform({ rotation: [0, 0, HALF_PI] }));
    expectVecClose(applyAffine(a, 1, 0, 0), [0, 1, 0]);
  });
});

describe("composeAffine + applyAffine", () => {
  it("translates by the transform position", () => {
    const a = composeAffine(transform({ position: [1, 2, 3] }));
    expectVecClose(applyAffine(a, 0, 0, 0), [1, 2, 3]);
    expectVecClose(applyAffine(a, 1, 1, 1), [2, 3, 4]);
  });

  it("scales per axis before translating", () => {
    const a = composeAffine(transform({ scale: [2, 3, 4] }));
    expectVecClose(applyAffine(a, 1, 1, 1), [2, 3, 4]);
  });

  it("applies scale, then rotation, then translation", () => {
    // Scale (1,1,1)->(2,2,2), rotate 90° about Z: (2,2,2)->(-2,2,2),
    // then translate by (10,0,0) -> (8,2,2).
    const a = composeAffine(
      transform({
        position: [10, 0, 0],
        rotation: [0, 0, HALF_PI],
        scale: [2, 2, 2],
      }),
    );
    expectVecClose(applyAffine(a, 1, 1, 1), [8, 2, 2]);
  });

  it("halves toward a corner like the default Sierpinski-style map", () => {
    const a = composeAffine(
      transform({ position: [0.5, 0.5, 0.5], scale: [0.5, 0.5, 0.5] }),
    );
    expectVecClose(applyAffine(a, 1, 1, 1), [1, 1, 1]);
    expectVecClose(applyAffine(a, -1, -1, -1), [0, 0, 0]);
  });
});

describe("composeAffine shear", () => {
  it("is identical to no shear when shear is zero", () => {
    const base = composeAffine(transform({ scale: [2, 3, 4] }));
    const zero = composeAffine(
      transform({ scale: [2, 3, 4], shear: [0, 0, 0] }),
    );
    expectVecClose(zero.m, base.m);
  });

  it("shears x by y (the XY component)", () => {
    // M = U with shear [1,0,0]: x' = x + y, y and z unchanged.
    const a = composeAffine(transform({ shear: [1, 0, 0] }));
    expectVecClose(applyAffine(a, 0, 1, 0), [1, 1, 0]);
    expectVecClose(applyAffine(a, 1, 0, 0), [1, 0, 0]);
  });

  it("shears x by z and y by z (XZ and YZ components)", () => {
    const xz = composeAffine(transform({ shear: [0, 1, 0] }));
    expectVecClose(applyAffine(xz, 0, 0, 1), [1, 0, 1]); // x += z
    const yz = composeAffine(transform({ shear: [0, 0, 1] }));
    expectVecClose(applyAffine(yz, 0, 0, 1), [0, 1, 1]); // y += z
  });

  it("applies shear before scale (M = R · diag(scale) · U)", () => {
    // Shear x by y, then scale x by 2: x' = 2·(x + y).
    const a = composeAffine(transform({ scale: [2, 1, 1], shear: [1, 0, 0] }));
    expectVecClose(applyAffine(a, 1, 1, 0), [4, 1, 0]);
  });

  it("can reproduce a non-orthogonal (sheared) map a pure scale+rotation can't", () => {
    // Columns of the linear part need not be orthogonal once sheared.
    const a = composeAffine(transform({ shear: [0.5, 0, 0] }));
    const col0 = [a.m[0], a.m[3], a.m[6]];
    const col1 = [a.m[1], a.m[4], a.m[7]];
    const dot = col0[0] * col1[0] + col0[1] * col1[1] + col0[2] * col1[2];
    expect(dot).toBeCloseTo(0.5); // 0 would mean orthogonal (no shear)
  });
});

describe("shearMatrix", () => {
  it("is the identity for zero shear", () => {
    expectVecClose(shearMatrix([0, 0, 0]), [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it("puts [xy, xz, yz] on the off-diagonal of a unit upper-triangular matrix", () => {
    // prettier-ignore
    expectVecClose(shearMatrix([0.3, -0.5, 0.7]), [
      1, 0.3, -0.5,
      0, 1,    0.7,
      0, 0,    1,
    ]);
  });

  it("matches the U composeAffine folds in, so guides can't drift from the fractal", () => {
    // With identity rotation and unit scale, composeAffine's linear part is
    // exactly U — the same convention, encoded two ways, pinned to agree.
    const shear: Vec3 = [0.3, -0.5, 0.7];
    expectVecClose(composeAffine(transform({ shear })).m, shearMatrix(shear));
  });
});
