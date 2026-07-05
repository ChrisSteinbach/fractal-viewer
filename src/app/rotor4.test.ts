import {
  identityRotorPair,
  rotateInPlane,
  rotorMatrix,
  wSupport,
} from "./rotor4";
import { rotationMatrix4 } from "../fractal/affine4";
import type { Rotation4, Vec4 } from "../fractal/types";

const PLANES: (keyof Rotation4)[] = ["xy", "xz", "yz", "xw", "yw", "zw"];

/** Row-major 4x4 product `a·b` — a local copy of affine4.ts's private
 * `multiply4` (not exported), just for building expected products here. */
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

function expectMatClose(
  actual: number[],
  expected: number[],
  digits = 12,
): void {
  expect(actual).toHaveLength(16);
  expected.forEach((v, i) => expect(actual[i]).toBeCloseTo(v, digits));
}

// prettier-ignore
const IDENTITY = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

describe("rotorMatrix", () => {
  it("is the exact identity pattern for identityRotorPair()", () => {
    const m = rotorMatrix(identityRotorPair());
    IDENTITY.forEach((v, i) => expect(Math.abs(m[i] - v)).toBeLessThan(1e-15));
  });
});

describe("rotateInPlane vs. rotationMatrix4 (the pinned R_ab convention)", () => {
  it("matches a single-plane rotation for every plane and several angles", () => {
    for (const plane of PLANES) {
      for (const angle of [0.7, -1.3]) {
        const actual = rotorMatrix(
          rotateInPlane(identityRotorPair(), plane, angle),
        );
        const expected = rotationMatrix4({ [plane]: angle });
        expectMatClose(actual, expected);
      }
    }
  });

  it("composes a second rotation AFTER the first: matches R_xw(b)·R_xy(a)", () => {
    const a = 0.5;
    const b = -0.8;
    const pair = rotateInPlane(
      rotateInPlane(identityRotorPair(), "xy", a),
      "xw",
      b,
    );
    const expected = mul4(
      rotationMatrix4({ xw: b }),
      rotationMatrix4({ xy: a }),
    );
    expectMatClose(rotorMatrix(pair), expected);
  });

  it("composes two disjoint-plane rotations (xy then zw) into the same double rotation as rotationMatrix4({xy, zw})", () => {
    const xy = 0.4;
    const zw = -1.1;
    const pair = rotateInPlane(
      rotateInPlane(identityRotorPair(), "xy", xy),
      "zw",
      zw,
    );
    expectMatClose(rotorMatrix(pair), rotationMatrix4({ xy, zw }));
  });
});

describe("rotateInPlane drift and purity", () => {
  it("stays orthogonal (M·Mᵀ = I) after 20,000 small compositions across all six planes", () => {
    // The rent-payer for accumulating a quaternion pair instead of a matrix:
    // renormalizing on every rotateInPlane call (see the module doc comment)
    // keeps this bounded where naive matrix accumulation would drift.
    let pair = identityRotorPair();
    for (let i = 0; i < 20_000; i++) {
      pair = rotateInPlane(pair, PLANES[i % PLANES.length], 0.01);
    }
    const m = rotorMatrix(pair);
    const product = mul4(m, transpose4(m));
    IDENTITY.forEach((v, i) =>
      expect(Math.abs(product[i] - v)).toBeLessThan(1e-9),
    );
  });

  it("does not mutate its input pair", () => {
    const original = identityRotorPair();
    const snapshotP = [...original.p];
    const snapshotQ = [...original.q];

    rotateInPlane(original, "xw", 0.9);

    expect(original.p).toEqual(snapshotP);
    expect(original.q).toEqual(snapshotQ);
  });
});

describe("wSupport", () => {
  it("equals the w half-extent under the identity rotation", () => {
    const m = rotorMatrix(identityRotorPair());
    expect(wSupport(m, [2, 3, 5, 0.25])).toBeCloseTo(0.25);
  });

  it("equals the max |rotated w| over the box's 16 corners under a composed tumble", () => {
    const pair = rotateInPlane(
      rotateInPlane(rotateInPlane(identityRotorPair(), "xy", 0.6), "zw", 0.9),
      "xw",
      0.4,
    );
    const m = rotorMatrix(pair);
    const h: Vec4 = [2, 3, 5, 0.25];

    let maxCorner = 0;
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          for (const sw of [-1, 1]) {
            const rotatedW = Math.abs(
              m[12] * (sx * h[0]) +
                m[13] * (sy * h[1]) +
                m[14] * (sz * h[2]) +
                m[15] * (sw * h[3]),
            );
            maxCorner = Math.max(maxCorner, rotatedW);
          }
        }
      }
    }

    expect(maxCorner).toBeCloseTo(wSupport(m, h));
  });

  it("is 0 for zero half-extents under a non-identity rotation", () => {
    const m = rotorMatrix(rotateInPlane(identityRotorPair(), "xw", 0.7));
    expect(wSupport(m, [0, 0, 0, 0])).toBe(0);
  });
});
