import { applyAffine, composeAffine, rotationMatrixXYZ } from "./affine";
import type { Transform } from "./types";

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
