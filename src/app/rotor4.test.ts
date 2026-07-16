import {
  identityRotorPair,
  normalizeRotorPair,
  rotateInPlane,
  rotorMatrix,
  slerpRotorPair,
  wSupport,
} from "./rotor4";
import type { RotorPair } from "./rotor4";
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

describe("normalizeRotorPair", () => {
  it("rejects a pair when either half has the wrong length", () => {
    expect(normalizeRotorPair([1, 0, 0], [1, 0, 0, 0])).toBeNull();
    expect(normalizeRotorPair([1, 0, 0, 0], [1, 0, 0, 0, 0])).toBeNull();
  });

  it("rejects a pair when either half has a non-number entry", () => {
    const withString = [1, 0, 0, "0"] as unknown as number[];
    expect(normalizeRotorPair(withString, [1, 0, 0, 0])).toBeNull();
    expect(normalizeRotorPair([1, 0, 0, 0], withString)).toBeNull();
  });

  it("rejects a pair when either half has a non-finite entry", () => {
    expect(normalizeRotorPair([1, 0, 0, NaN], [1, 0, 0, 0])).toBeNull();
    expect(normalizeRotorPair([1, 0, 0, 0], [Infinity, 0, 0, 0])).toBeNull();
  });

  it("rejects a pair when either half's norm is near zero", () => {
    expect(normalizeRotorPair([0, 0, 0, 0], [1, 0, 0, 0])).toBeNull();
    expect(normalizeRotorPair([1, 0, 0, 0], [1e-9, 0, 0, 0])).toBeNull();
  });

  it("normalizes a scaled pair to unit halves", () => {
    expect(normalizeRotorPair([2, 0, 0, 0], [0, 3, 0, 0])).toEqual({
      p: [1, 0, 0, 0],
      q: [0, 1, 0, 0],
    });
  });

  it("returns fresh arrays: mutating the result doesn't touch the input", () => {
    const p = [2, 0, 0, 0];
    const q = [0, 3, 0, 0];

    const result = normalizeRotorPair(p, q);
    result!.p[0] = 999;
    result!.q[1] = 999;

    expect(p).toEqual([2, 0, 0, 0]);
    expect(q).toEqual([0, 3, 0, 0]);
  });
});

describe("slerpRotorPair", () => {
  it("returns a's rotation at t=0 and b's rotation at t=1", () => {
    const a = identityRotorPair();
    const b = rotateInPlane(identityRotorPair(), "xy", 0.8);

    expectMatClose(rotorMatrix(slerpRotorPair(a, b, 0)), rotorMatrix(a));
    expectMatClose(rotorMatrix(slerpRotorPair(a, b, 1)), rotorMatrix(b));
  });

  it("reaches the half-angle rotation at the midpoint of a single xy-plane rotation", () => {
    const a = identityRotorPair();
    const b = rotateInPlane(identityRotorPair(), "xy", 0.8);

    const mid = slerpRotorPair(a, b, 0.5);

    expectMatClose(
      rotorMatrix(mid),
      rotorMatrix(rotateInPlane(identityRotorPair(), "xy", 0.4)),
    );
  });

  it("reaches the half-angle rotation at the midpoint of a w-mixing xw-plane rotation", () => {
    const a = identityRotorPair();
    const b = rotateInPlane(identityRotorPair(), "xw", 0.8);

    const mid = slerpRotorPair(a, b, 0.5);

    expectMatClose(
      rotorMatrix(mid),
      rotorMatrix(rotateInPlane(identityRotorPair(), "xw", 0.4)),
    );
  });

  it("gives the same result for b's double-cover-negated twin (same rotation as b)", () => {
    const a = identityRotorPair();
    const b = rotateInPlane(identityRotorPair(), "xy", 0.8);
    const bNegated: RotorPair = {
      p: [-b.p[0], -b.p[1], -b.p[2], -b.p[3]],
      q: [-b.q[0], -b.q[1], -b.q[2], -b.q[3]],
    };

    expectMatClose(
      rotorMatrix(slerpRotorPair(a, bNegated, 0.5)),
      rotorMatrix(slerpRotorPair(a, b, 0.5)),
    );
  });

  it("keeps both halves at unit length across several t values", () => {
    const a = identityRotorPair();
    const b = rotateInPlane(
      rotateInPlane(identityRotorPair(), "xy", 0.8),
      "zw",
      -1.1,
    );

    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const result = slerpRotorPair(a, b, t);
      expect(Math.hypot(...result.p)).toBeCloseTo(1);
      expect(Math.hypot(...result.q)).toBeCloseTo(1);
    }
  });

  it("does not mutate its input pairs", () => {
    const a = identityRotorPair();
    const b = rotateInPlane(identityRotorPair(), "xy", 0.8);
    const snapshotAP = [...a.p];
    const snapshotAQ = [...a.q];
    const snapshotBP = [...b.p];
    const snapshotBQ = [...b.q];

    slerpRotorPair(a, b, 0.5);

    expect(a.p).toEqual(snapshotAP);
    expect(a.q).toEqual(snapshotAQ);
    expect(b.p).toEqual(snapshotBP);
    expect(b.q).toEqual(snapshotBQ);
  });
});
