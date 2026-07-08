import { rotationMatrix4 } from "./affine4";
import {
  composeFlameProjection4,
  composeRotorProjection4,
  sliceColorRemap,
  sliceWeight,
} from "./project4";
import type { RotorProjection4 } from "./project4";
import type { Mat4 } from "./flame";
import type { Vec4 } from "./types";

/** Evaluate a 20-entry row-major projection (4 rows x [x,y,z,w,constant]) at
 * a point — the same "affine map, point as a column" evaluation every
 * composed-projection consumer performs, done by hand here so the tests
 * don't just re-assert the implementation's own loop shape. */
function applyProjection4(
  proj: Float64Array,
  v: Vec4,
): [number, number, number, number] {
  const rows: [number, number, number, number] = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    const o = i * 5;
    rows[i] =
      proj[o] * v[0] +
      proj[o + 1] * v[1] +
      proj[o + 2] * v[2] +
      proj[o + 3] * v[3] +
      proj[o + 4];
  }
  return rows;
}

/** Bare row-major 4x4 matrix-vector multiply (no translation) — the explicit
 * hand reference for `R · (v − c)`, kept separate from `project4.ts`'s own
 * (unexported) `applyRotor4` so the test doesn't just call the same code. */
function applyMatrix4(m: number[], v: Vec4): Vec4 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2] + m[3] * v[3],
    m[4] * v[0] + m[5] * v[1] + m[6] * v[2] + m[7] * v[3],
    m[8] * v[0] + m[9] * v[1] + m[10] * v[2] + m[11] * v[3],
    m[12] * v[0] + m[13] * v[1] + m[14] * v[2] + m[15] * v[3],
  ];
}

describe("composeRotorProjection4", () => {
  it("reduces to the plain xyz drop and w − center[3] for an identity rotor", () => {
    const identity = rotationMatrix4({});
    const center: Vec4 = [1, 2, 3, 4];
    const proj = composeRotorProjection4(identity, center);

    const v: Vec4 = [10, 20, 30, 40];
    const [px, py, pz, sRaw] = applyProjection4(proj, v);
    expect(px).toBeCloseTo(v[0], 12);
    expect(py).toBeCloseTo(v[1], 12);
    expect(pz).toBeCloseTo(v[2], 12);
    // sRaw = q.w with q = v − center (identity rotation), so w − center[3] —
    // NOT (w − center[3]) + center[3]: no c.w add-back (see module doc).
    expect(sRaw).toBeCloseTo(v[3] - center[3], 12);
  });

  it("agrees with the explicit two-step reference for a genuinely 4D rotation", () => {
    const R = rotationMatrix4({ xy: 0.7, zw: 1.1, xw: 0.4 });
    const center: Vec4 = [0.5, -0.3, 0.2, 1.4];
    const proj = composeRotorProjection4(R, center);

    const samples: Vec4[] = [
      [0, 0, 0, 0],
      [1, 0, 0, 0],
      [0.3, -0.6, 0.9, -1.2],
      [-2, 5, -0.5, 3.3],
    ];
    for (const v of samples) {
      const vMinusC: Vec4 = [
        v[0] - center[0],
        v[1] - center[1],
        v[2] - center[2],
        v[3] - center[3],
      ];
      const q = applyMatrix4(R, vMinusC);
      const expectedP: Vec4 = [
        q[0] + center[0],
        q[1] + center[1],
        q[2] + center[2],
        0,
      ];
      const expectedSRaw = q[3]; // no c.w add-back.

      const [px, py, pz, sRaw] = applyProjection4(proj, v);
      expect(px).toBeCloseTo(expectedP[0], 10);
      expect(py).toBeCloseTo(expectedP[1], 10);
      expect(pz).toBeCloseTo(expectedP[2], 10);
      expect(sRaw).toBeCloseTo(expectedSRaw, 10);
    }
  });
});

describe("composeFlameProjection4", () => {
  // A small asymmetric camera fixture (distinct, nonzero coefficients on
  // every row/column) so a swapped row or transposed index would fail —
  // built like flame.test.ts's Mat4 fixtures, just less degenerate.
  // prettier-ignore
  const ASYMMETRIC_CAMERA: Mat4 = [
    1.1,  0.2, -0.3,  0.4,
   -0.1,  0.9,  0.15,-0.25,
    0.05,-0.2,  1.3,  0.1,
    0.02,-0.01, 0.3,  1.05,
  ];

  it("agrees with the explicit two-step reference (rotor-project, then apply the camera rows)", () => {
    const R = rotationMatrix4({ xy: 0.7, zw: 1.1, xw: 0.4 });
    const center: Vec4 = [0.5, -0.3, 0.2, 1.4];
    const rotorProj = composeRotorProjection4(R, center);
    const combined = composeFlameProjection4(ASYMMETRIC_CAMERA, rotorProj);

    const samples: Vec4[] = [
      [0, 0, 0, 0],
      [0.3, -0.6, 0.9, -1.2],
      [-2, 5, -0.5, 3.3],
    ];
    for (const v of samples) {
      // Step 1: rotor-project to 3D (+ raw sRaw).
      const [px, py, pz, sRaw] = applyProjection4(rotorProj, v);
      // Step 2: apply the camera's clip rows to (px, py, pz, 1).
      const clipX =
        ASYMMETRIC_CAMERA[0] * px +
        ASYMMETRIC_CAMERA[1] * py +
        ASYMMETRIC_CAMERA[2] * pz +
        ASYMMETRIC_CAMERA[3];
      const clipY =
        ASYMMETRIC_CAMERA[4] * px +
        ASYMMETRIC_CAMERA[5] * py +
        ASYMMETRIC_CAMERA[6] * pz +
        ASYMMETRIC_CAMERA[7];
      const clipW =
        ASYMMETRIC_CAMERA[12] * px +
        ASYMMETRIC_CAMERA[13] * py +
        ASYMMETRIC_CAMERA[14] * pz +
        ASYMMETRIC_CAMERA[15];

      const [ccx, ccy, ccw, cs] = applyProjection4(combined, v);
      expect(ccx).toBeCloseTo(clipX, 10);
      expect(ccy).toBeCloseTo(clipY, 10);
      expect(ccw).toBeCloseTo(clipW, 10);
      // Row S passes through untouched — the camera never sees sRaw.
      expect(cs).toBeCloseTo(sRaw, 10);
    }
  });

  it("passes the S row through byte-identical to the rotor projection's row 3", () => {
    const R = rotationMatrix4({ yw: 0.9 });
    const center: Vec4 = [0.1, 0.2, -0.3, 0.4];
    const rotorProj: RotorProjection4 = composeRotorProjection4(R, center);
    const combined = composeFlameProjection4(ASYMMETRIC_CAMERA, rotorProj);
    expect(combined.slice(15, 20)).toEqual(rotorProj.slice(15, 20));
  });
});

describe("sliceWeight", () => {
  it("peaks at 1 when s equals center, regardless of floor", () => {
    expect(sliceWeight(0.3, 0.3, 0.2, 0)).toBeCloseTo(1, 12);
    expect(sliceWeight(0.3, 0.3, 0.2, 0.06)).toBeCloseTo(1, 12);
    expect(sliceWeight(-0.5, -0.5, 0.5, 0.5)).toBeCloseTo(1, 12);
  });

  it("approaches the floor far from center", () => {
    const far = sliceWeight(100, 0, 0.1, 0.06);
    expect(far).toBeCloseTo(0.06, 6);
  });

  it("gives a pure Gaussian when floor is 0", () => {
    const s = 1;
    const center = 0;
    const width = 1;
    const expected = Math.exp(-0.5);
    expect(sliceWeight(s, center, width, 0)).toBeCloseTo(expected, 12);
  });

  it("scales the falloff by width: one width away from center equals floor + (1 − floor) * exp(-0.5)", () => {
    const center = 0.2;
    const width = 0.4;
    const floor = 0.06;
    const expected = floor + (1 - floor) * Math.exp(-0.5);
    expect(sliceWeight(center + width, center, width, floor)).toBeCloseTo(
      expected,
      12,
    );
    expect(sliceWeight(center - width, center, width, floor)).toBeCloseTo(
      expected,
      12,
    );
  });
});

describe("sliceColorRemap", () => {
  it("returns the identity (shift 0, invScale 1) when the slice is off, even with sliceRelativeColor true", () => {
    const remap = sliceColorRemap({
      sliceOn: false,
      sliceRelativeColor: true,
      sliceCenter: 0.4,
      sliceWidth: 0.2,
    });
    expect(remap).toEqual({ shift: 0, invScale: 1 });
  });

  it("returns the identity when sliceRelativeColor is false, even with the slice on", () => {
    const remap = sliceColorRemap({
      sliceOn: true,
      sliceRelativeColor: false,
      sliceCenter: 0.4,
      sliceWidth: 0.2,
    });
    expect(remap).toEqual({ shift: 0, invScale: 1 });
  });

  it("recenters on the slice when both the slice and the option are on", () => {
    // The ramp's full [-1, 1] spans ±2 slice-widths (SLICE_COLOR_SPAN) around
    // the slice center — 1 / (2 * 0.25) = 2, pinned here as its own literal
    // rather than restating the constant.
    const remap = sliceColorRemap({
      sliceOn: true,
      sliceRelativeColor: true,
      sliceCenter: -0.5,
      sliceWidth: 0.25,
    });
    expect(remap).toEqual({ shift: -0.5, invScale: 2 });
  });
});
