import { rotationMatrix4 } from "./affine4";
import {
  normalizeSurfacePatternSource3,
  normalizeSurfacePatternSource4,
  surfacePatternHitW,
  surfacePatternSourceHit3,
  surfacePatternSourceHit4,
} from "./surface-pattern-frame";
import type { Rotation4, Vec4 } from "./types";

const IDENTITY3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const IDENTITY4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function transpose4(m: readonly number[]): number[] {
  return [
    m[0],
    m[4],
    m[8],
    m[12],
    m[1],
    m[5],
    m[9],
    m[13],
    m[2],
    m[6],
    m[10],
    m[14],
    m[3],
    m[7],
    m[11],
    m[15],
  ];
}

function apply4(m: readonly number[], p: Vec4): Vec4 {
  return [
    m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3] * p[3],
    m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7] * p[3],
    m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11] * p[3],
    m[12] * p[0] + m[13] * p[1] + m[14] * p[2] + m[15] * p[3],
  ];
}

describe("3D surface pattern source frame", () => {
  it.each(["affine", "fold", "escape", "bulb"] as const)(
    "%s uses the visible hit when no outer remap exists",
    (family) => {
      expect(
        surfacePatternSourceHit3({ family, visibleHit: [2, -3, 4] }),
      ).toEqual([2, -3, 4]);
    },
  );

  it("routes balloon through the pre-inversion query before an affine final inverse", () => {
    const got = surfacePatternSourceHit3({
      family: "lens",
      visibleHit: [90, 80, 70],
      balloonSourceHit: [4, 5, 6],
      affineFinal: { invM: IDENTITY3, invT: [-1, -2, -3] },
    });
    expect(got).toEqual([3, 3, 3]);
  });

  it("keeps a fold-final argmin source authoritative under balloon", () => {
    expect(
      surfacePatternSourceHit3({
        family: "lens",
        visibleHit: [90, 80, 70],
        balloonSourceHit: [4, 5, 6],
        foldFinalSourceHit: [0.25, -0.5, 0.75],
      }),
    ).toEqual([0.25, -0.5, 0.75]);
  });

  it("normalizes about the raw IFS bound center and stays finite on a bad radius", () => {
    expect(normalizeSurfacePatternSource3([3, 5, 7], [1, 1, 1], 2)).toEqual([
      1, 2, 3,
    ]);
    expect(normalizeSurfacePatternSource3([3, 5, 7], [1, 1, 1], 0)).toEqual([
      0, 0, 0,
    ]);
  });
});

describe("4D surface pattern source frame", () => {
  it("uses w0 + sStar * sliceHalfW under the identity rotor across slices", () => {
    for (const [w0, sStar, halfW] of [
      [0, 0, 0],
      [0.3, -0.5, 0.2],
      [-0.4, 0.75, 0.08],
    ]) {
      const got = surfacePatternSourceHit4({
        family: "affine4",
        visibleHit: [0.2, -0.3, 0.4],
        inverseRotor: IDENTITY4,
        w0,
        sStar,
        sliceHalfW: halfW,
      });
      expect(got).toEqual([
        0.2,
        -0.3,
        0.4,
        surfacePatternHitW(w0, sStar, halfW),
      ]);
    }
  });

  it("round-trips a w-mixing rotor at multiple slice decompositions", () => {
    const rotation: Rotation4 = {
      xy: 0.17,
      xz: -0.21,
      xw: 0.63,
      yz: 0.11,
      yw: -0.37,
      zw: 0.29,
    };
    const rotor = rotationMatrix4(rotation);
    const inverseRotor = transpose4(rotor);
    const raw: Vec4 = [0.31, -0.27, 0.44, 0.18];
    const view = apply4(rotor, raw);
    for (const [w0, sStar, halfW] of [
      [view[3], 0, 0],
      [view[3] - 0.1, 0.5, 0.2],
      [view[3] + 0.06, -0.75, 0.08],
    ]) {
      const got = surfacePatternSourceHit4({
        family: "fold4",
        visibleHit: [view[0], view[1], view[2]],
        inverseRotor,
        w0,
        sStar,
        sliceHalfW: halfW,
      });
      got.forEach((value, i) => expect(value).toBeCloseTo(raw[i], 12));
    }
  });

  it("routes balloon before the inverse rotor and the affine final afterward", () => {
    const got = surfacePatternSourceHit4({
      family: "affine4",
      visibleHit: [9, 9, 9],
      balloonSourceHit: [1, 2, 3],
      inverseRotor: IDENTITY4,
      w0: 0.4,
      sStar: -0.5,
      sliceHalfW: 0.2,
      affineFinal: {
        invM: [0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0],
        invT: [0.5, -0.5, 1, -1],
      },
    });
    expect(got).toEqual([2.5, 0.5, 1.3, 2]);
  });

  it("round-trips balloon, a w-mixing rotor, multiple slab slices, and a noncommuting affine final", () => {
    const rotation: Rotation4 = {
      xy: 0.08,
      xz: -0.19,
      xw: 0.57,
      yz: 0.14,
      yw: -0.31,
      zw: 0.23,
    };
    const rotor = rotationMatrix4(rotation);
    const inverseRotor = transpose4(rotor);
    const preFinal: Vec4 = [0.6, -0.4, 0.2, 0.1];
    const view = apply4(rotor, preFinal);
    const affineFinal = {
      // Swap x/w and x/z so the final inverse cannot commute with the rotor.
      invM: [0, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0],
      invT: [0.05, 0.1, -0.2, 0.3] as Vec4,
    };
    const expected = [0.15, -0.3, 0.4, 0.5];

    for (const [w0, sStar, halfW] of [
      [view[3], 0, 0],
      [view[3] - 0.12, 0.6, 0.2],
      [view[3] + 0.09, -0.75, 0.12],
    ]) {
      const got = surfacePatternSourceHit4({
        family: "affine4",
        visibleHit: [9, 8, 7],
        balloonSourceHit: [view[0], view[1], view[2]],
        inverseRotor,
        w0,
        sStar,
        sliceHalfW: halfW,
        affineFinal,
      });
      expected.forEach((value, i) => expect(got[i]).toBeCloseTo(value, 12));
    }
  });

  it("uses bestQ + sStar * bestExt for a fold-final without applying the rotor twice", () => {
    const bestQ: Vec4 = [0.2, 0.4, -0.6, 0.8];
    const bestExt: Vec4 = [0.1, -0.2, 0.3, -0.4];
    const got = surfacePatternSourceHit4({
      family: "fold4",
      visibleHit: [9, 8, 7],
      balloonSourceHit: [6, 5, 4],
      inverseRotor: Array(16).fill(3),
      w0: 2,
      sStar: 0.5,
      sliceHalfW: 4,
      foldFinalSource: { bestQ, bestExt },
    });
    [0.25, 0.3, -0.45, 0.6].forEach((value, i) =>
      expect(got[i]).toBeCloseTo(value, 14),
    );
  });

  it("keeps a balloon-fed fold-final winner authoritative", () => {
    const got = surfacePatternSourceHit4({
      family: "fold4",
      visibleHit: [90, 80, 70],
      balloonSourceHit: [4, 5, 6],
      inverseRotor: Array(16).fill(-7),
      w0: -3,
      sStar: -0.25,
      sliceHalfW: 2,
      // The fold hit-info wrapper has already routed the balloon query into
      // its winning branch and returns this resolved centre/extent tuple.
      foldFinalSource: {
        bestQ: [0.4, -0.2, 0.6, -0.8],
        bestExt: [0.2, 0.4, -0.8, 1.2],
      },
    });
    [0.35, -0.3, 0.8, -1.1].forEach((value, i) =>
      expect(got[i]).toBeCloseTo(value, 14),
    );
  });

  it("lifts escape4 through identity and w-mixing rotors with its zero slab width", () => {
    const raw: Vec4 = [0.27, -0.18, 0.39, -0.22];
    const rotations: Rotation4[] = [
      { xy: 0, xz: 0, xw: 0, yz: 0, yw: 0, zw: 0 },
      { xy: 0.1, xz: -0.2, xw: 0.5, yz: 0.3, yw: -0.4, zw: 0.25 },
    ];
    for (const rotation of rotations) {
      const rotor = rotationMatrix4(rotation);
      const view = apply4(rotor, raw);
      const got = surfacePatternSourceHit4({
        family: "escape4",
        visibleHit: [view[0], view[1], view[2]],
        inverseRotor: transpose4(rotor),
        w0: view[3],
        sStar: 0.9,
        sliceHalfW: 0,
      });
      got.forEach((value, i) => expect(value).toBeCloseTo(raw[i], 12));
    }
  });

  it("normalizes xyz by the raw 4D bound, not a slice or visible radius", () => {
    expect(normalizeSurfacePatternSource4([3, 5, 7, 99], 2)).toEqual([
      1.5, 2.5, 3.5,
    ]);
    expect(normalizeSurfacePatternSource4([3, 5, 7, 99], NaN)).toEqual([
      0, 0, 0,
    ]);
  });
});
