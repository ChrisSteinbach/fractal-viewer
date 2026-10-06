import {
  TWIST_AUTHORED_FIELDS,
  TWIST_W_FIELDS,
  resolveTwist,
  twistIsTrivial,
  twistMatrices3,
  twistMatrices4,
  twistWIsNonTrivial,
} from "./twist";
import type { TwistAuthored } from "./twist";
import { rotationMatrixXYZ } from "./affine";
import { multiply4x4, rotationMatrix4 } from "./affine4";
import type { Vec3 } from "./types";

describe("the shared twist vocabulary", () => {
  it("fills absent fields with the neutral twist and refuses unknown keys at both levels", () => {
    const resolution = resolveTwist({});
    if (!resolution.ok) throw new Error(resolution.reasons.join("; "));
    expect(resolution.construction.rotation).toEqual([0, 0, 0]);
    expect(resolution.construction.offset).toEqual([0, 0, 0]);
    expect(resolution.construction.rotation4).toEqual({});
    expect(resolution.construction.offsetW).toBe(0);
    for (const authored of [
      { bogus: 1 },
      { w: { bogus: 1 } },
      { w: { rotation: { bogus: 1 } } },
      { rotation: [0, Number.NaN, 0] },
      { offset: [0, 0, Number.POSITIVE_INFINITY] },
      { rotation: [0, 0] as unknown as Vec3 },
      { w: { offset: Number.NaN } },
      { w: "nope" },
    ] as unknown as TwistAuthored[]) {
      const refused = resolveTwist(authored);
      if (refused.ok) {
        throw new Error(`expected refusal: ${JSON.stringify(authored)}`);
      }
      expect(refused.reasons.length).toBeGreaterThan(0);
    }
  });

  it("reads triviality from the resolved construction and the w extension from the authored block", () => {
    const neutral = resolveTwist({});
    if (!neutral.ok) throw new Error(neutral.reasons.join("; "));
    expect(twistIsTrivial(neutral.construction)).toBe(true);
    const rotated = resolveTwist({ rotation: [0.1, 0, 0] });
    if (!rotated.ok) throw new Error(rotated.reasons.join("; "));
    expect(twistIsTrivial(rotated.construction)).toBe(false);
    const shifted = resolveTwist({ offset: [0, 0, 0.5] });
    if (!shifted.ok) throw new Error(shifted.reasons.join("; "));
    expect(twistIsTrivial(shifted.construction)).toBe(false);
    expect(twistWIsNonTrivial({})).toBe(false);
    expect(twistWIsNonTrivial({ w: {} })).toBe(false);
    expect(twistWIsNonTrivial({ w: { offset: 0 } })).toBe(false);
    expect(twistWIsNonTrivial({ w: { rotation: { xw: 0 } } })).toBe(false);
    expect(twistWIsNonTrivial({ w: { rotation: { yw: 0.3 } } })).toBe(true);
    expect(twistWIsNonTrivial({ w: { offset: -0.2 } })).toBe(true);
  });

  it("never mutates its input and exposes the field lists", () => {
    const authored: TwistAuthored = {
      rotation: [0.1, 0.2, 0.3],
      offset: [0.4, 0.5, 0.6],
      w: { rotation: { xw: 0.7 }, offset: 0.8 },
    };
    const before = JSON.stringify(authored);
    resolveTwist(authored);
    expect(JSON.stringify(authored)).toBe(before);
    expect(TWIST_AUTHORED_FIELDS.includes("rotation")).toBe(true);
    expect(TWIST_W_FIELDS.includes("offset")).toBe(true);
  });

  it("composes the 4D matrix so its embedded upper-left reproduces the 3D matrix", () => {
    const construction = {
      rotation: [0.1, 0.2, 0.3] as Vec3,
      offset: [0.4, 0.5, 0.6] as Vec3,
      rotation4: {},
      offsetW: 0,
    };
    const m3 = twistMatrices3(construction).m;
    const m4 = twistMatrices4(construction).m;
    // Trivial planes: the 4D composition is exactly the 3D matrix embedded.
    expect(m4.slice(0, 3)).toEqual(m3.slice(0, 3));
    expect(m4.slice(4, 7)).toEqual(m3.slice(3, 6));
    expect(m4.slice(8, 11)).toEqual(m3.slice(6, 9));
    expect(m4[3]).toBe(0);
    expect(m4[7]).toBe(0);
    expect(m4[11]).toBe(0);
    expect(m4[12]).toBe(0);
    expect(m4[13]).toBe(0);
    expect(m4[14]).toBe(0);
    expect(m4[15]).toBe(1);
    // And with non-trivial planes the composition is the shared one:
    // the plane rotations AFTER the embedded Euler part.
    const planes = { xy: 0.2, xw: 0.4 };
    const withPlanes = twistMatrices4({ ...construction, rotation4: planes });
    const euler3 = rotationMatrixXYZ(0.1, 0.2, 0.3);
    const euler4 = [
      ...euler3.slice(0, 3),
      0,
      ...euler3.slice(3, 6),
      0,
      ...euler3.slice(6, 9),
      0,
      0,
      0,
      0,
      1,
    ];
    expect(withPlanes.m).toEqual(multiply4x4(rotationMatrix4(planes), euler4));
  });
});
