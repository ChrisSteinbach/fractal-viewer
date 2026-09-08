import { applyAffine, composeAffine } from "./affine";
import { applyAffine4, composeAffine4, toTransform4 } from "./affine4";
import { pentatope, sierpinskiTetrahedron } from "./presets";
import { mulberry32 } from "./rng";
import * as surface3 from "./surface-de";
import { buildSurfaceDE4 } from "./surface-de-4d";
import {
  analyzeSwirlLensRadius,
  setSwirlLensRadius,
  type SwirlLensRadiusAnalysis,
  type SwirlLensRadiusEdit,
} from "./swirl-lens-edit";
import { SWIRL_LENS_MAX_RADIUS } from "./swirl-lens";
import type {
  HybridSchedule,
  SymmetryParams,
  Transform,
  Vec3,
  Vec4,
} from "./types";
import { composeVariations } from "./variations";
import { composeVariations4 } from "./variations4";

function lens(fourD = false): Transform {
  return {
    id: 99,
    position: [0.02, -0.01, 0.03],
    rotation: [0.23, -0.31, 0.47],
    scale: [-0.08, 0.06, 0.07],
    shear: [0.2, -0.1, 0.15],
    variations: [{ type: "swirl", weight: -2 }],
    post: { m: [0.8, 0.1, 0, -0.1, 0.9, 0, 0, 0, 1.1], t: [0.03, -0.01, 0.02] },
    ...(fourD
      ? {
          w: {
            position: 0.02,
            scale: -0.075,
            rotation: { xw: 0.3 },
            shear: { yw: -0.1 },
          },
        }
      : {}),
  };
}

function radius(result: SwirlLensRadiusAnalysis): number {
  expect(result.available).toBe(true);
  if (!result.available) throw new Error(result.reason);
  return result.radius;
}

function edited(result: SwirlLensRadiusEdit): Transform {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result.transform;
}

describe("derived swirl radius authoring", () => {
  it("matches the existing 3D/4D builder bounds including symmetry and a finite schedule", () => {
    const symmetry: SymmetryParams = { order: 3, plane: "xy" };
    for (const fourD of [false, true]) {
      const transforms = fourD ? pentatope() : sierpinskiTetrahedron();
      const final = lens(fourD);
      const schedule: HybridSchedule = {
        depth: 2,
        transforms: [
          {
            id: 101,
            position: [0.1, -0.04, 0.02],
            rotation: [0.1, 0.2, -0.15],
            scale: [0.8, 0.8, 0.8],
            ...(fourD ? { w: { position: 0.04 } } : {}),
            // Scheduled posts are inert in the existing point-word stage.
            post: { m: Array<number>(9).fill(0), t: [9, 8, 7] },
          },
        ],
      };
      const expected = fourD
        ? buildSurfaceDE4(transforms, final, symmetry, { schedule })
        : surface3.buildSurfaceDE(transforms, final, symmetry, { schedule });
      expect(
        radius(analyzeSwirlLensRadius(transforms, final, symmetry, schedule)),
      ).toBe(expected.foldFinal!.swirlRadius);
      const plain = radius(analyzeSwirlLensRadius(transforms, final));
      expect(
        radius(analyzeSwirlLensRadius(transforms, final, symmetry, schedule)),
      ).not.toBe(plain);
    }
  });

  it("uses the final and symmetry in dimensional routing, while respecting schedule routing refusals", () => {
    const transforms = sierpinskiTetrahedron();
    const final4 = lens(true);
    expect(radius(analyzeSwirlLensRadius(transforms, final4))).toBe(
      buildSurfaceDE4(transforms, final4).foldFinal!.swirlRadius,
    );
    const symmetry: SymmetryParams = { order: 3, plane: "xw", twist: 1 };
    const final = lens();
    expect(radius(analyzeSwirlLensRadius(transforms, final, symmetry))).toBe(
      buildSurfaceDE4(transforms, final, symmetry).foldFinal!.swirlRadius,
    );
    const schedule: HybridSchedule = {
      depth: 1,
      transforms: [{ ...transforms[0], w: { position: 0.1 } }],
    };
    expect(
      analyzeSwirlLensRadius(transforms, final, undefined, schedule),
    ).toMatchObject({
      available: false,
      reason: expect.stringMatching(/schedule.*4D/),
    });
    expect(
      radius(
        analyzeSwirlLensRadius(transforms, final, undefined, {
          ...schedule,
          depth: 0,
        }),
      ),
    ).toBe(radius(analyzeSwirlLensRadius(transforms, final)));
  });

  it("shows over-cap imported radii unchanged and brings both dimensions inside the exact .5 endpoint", () => {
    for (const fourD of [false, true]) {
      const transforms = fourD ? pentatope() : sierpinskiTetrahedron();
      for (const position of [
        [0.02, -0.01, 0.03],
        [1.2, -0.8, 0.4],
      ] as Vec3[]) {
        const final: Transform = {
          ...lens(fourD),
          position,
          scale: [-0.9, 0.7, 0.8],
        };
        const current = radius(analyzeSwirlLensRadius(transforms, final));
        expect(current).toBeGreaterThan(SWIRL_LENS_MAX_RADIUS);
        const change = edited(
          setSwirlLensRadius(final, current, SWIRL_LENS_MAX_RADIUS),
        );
        const next = radius(analyzeSwirlLensRadius(transforms, change));
        expect(next).toBeLessThanOrEqual(SWIRL_LENS_MAX_RADIUS);
        expect(next).toBeCloseTo(SWIRL_LENS_MAX_RADIUS, 8);
        const de = fourD
          ? buildSurfaceDE4(transforms, change)
          : surface3.buildSurfaceDE(transforms, change);
        expect(de.foldFinal!.swirlRadius).toBe(next);
        const larger = edited(setSwirlLensRadius(change, next, 1.25));
        expect(radius(analyzeSwirlLensRadius(transforms, larger))).toBeCloseTo(
          1.25,
          10,
        );
      }
    }
  });

  it("does not include output weight or post-affine resizing in the derived radius", () => {
    const transforms = sierpinskiTetrahedron();
    const final = lens();
    const current = radius(analyzeSwirlLensRadius(transforms, final));
    expect(
      radius(
        analyzeSwirlLensRadius(transforms, {
          ...final,
          variations: [{ type: "swirl", weight: 28 }],
          post: { m: [5, 0, 0, 0, 5, 0, 0, 0, 5], t: [10, 20, 30] },
        }),
      ),
    ).toBe(current);
  });

  it("reports ordinary refusals and preserves unexpected builder failures", () => {
    const transforms = sierpinskiTetrahedron();
    expect(analyzeSwirlLensRadius(transforms, null)).toMatchObject({
      available: false,
    });
    expect(
      analyzeSwirlLensRadius(transforms, {
        ...lens(),
        variations: [
          { type: "swirl", weight: 1 },
          { type: "linear", weight: 1 },
        ],
      }),
    ).toMatchObject({
      available: false,
      reason: expect.stringMatching(/one active/),
    });
    expect(analyzeSwirlLensRadius([], lens())).toMatchObject({
      available: false,
      reason: expect.stringMatching(/raw system/),
    });
    expect(
      analyzeSwirlLensRadius(
        [{ ...transforms[0], variations: [{ type: "swirl", weight: 1 }] }],
        lens(),
      ),
    ).toMatchObject({
      available: false,
      reason: expect.stringMatching(/raw system/),
    });
    for (const final of [
      { ...lens(), scale: [0, 1, 1] as Vec3 },
      { ...lens(), position: [NaN, 0, 0] as Vec3 },
      {
        ...lens(),
        post: { m: Array<number>(9).fill(0), t: [0, 0, 0] as Vec3 },
      },
    ]) {
      expect(analyzeSwirlLensRadius(transforms, final)).toMatchObject({
        available: false,
      });
    }
    const failure = new Error("unexpected raw calibration failure");
    const build = vi
      .spyOn(surface3, "buildSurfaceDE")
      .mockImplementationOnce(() => {
        throw failure;
      });
    try {
      expect(() => analyzeSwirlLensRadius(transforms, lens())).toThrow(failure);
    } finally {
      build.mockRestore();
    }
  });
});

describe("immutable swirl radius edits", () => {
  it("preserves un-posted forward size and carried z/w while changing the actual xy turn", () => {
    const rng = mulberry32(0x5e7a);
    for (const fourD of [false, true]) {
      for (const weight of [-2, 0.75]) {
        const final = {
          ...lens(fourD),
          variations: [{ type: "swirl" as const, weight }],
        };
        const transforms = fourD ? pentatope() : sierpinskiTetrahedron();
        const current = radius(analyzeSwirlLensRadius(transforms, final));
        const changed = edited(
          setSwirlLensRadius(final, current, current * 0.4),
        );
        const forward3 = composeVariations(final.variations)!;
        const changed3 = composeVariations(changed.variations)!;
        const forward4 = composeVariations4(final.variations)!;
        const changed4 = composeVariations4(changed.variations)!;
        let moved = 0;
        for (let i = 0; i < 32; i++) {
          const q: Vec4 = [rng() - 0.5, rng() - 0.5, rng() - 0.5, rng() - 0.5];
          const before = fourD
            ? [
                ...forward4(
                  ...applyAffine4(composeAffine4(toTransform4(final)), ...q),
                  rng,
                ),
              ]
            : [
                ...forward3(
                  ...applyAffine(composeAffine(final), q[0], q[1], q[2]),
                  rng,
                ),
              ];
          const after = fourD
            ? [
                ...changed4(
                  ...applyAffine4(composeAffine4(toTransform4(changed)), ...q),
                  rng,
                ),
              ]
            : [
                ...changed3(
                  ...applyAffine(composeAffine(changed), q[0], q[1], q[2]),
                  rng,
                ),
              ];
          expect(Math.hypot(...after)).toBeCloseTo(Math.hypot(...before), 13);
          expect(after[2]).toBeCloseTo(before[2], 13);
          if (fourD) expect(after[3]).toBeCloseTo(before[3], 13);
          if (Math.hypot(after[0] - before[0], after[1] - before[1]) > 1e-7)
            moved++;
        }
        expect(moved).toBeGreaterThan(24);
      }
    }
  });

  it("preserves metadata, dormant variations, signs and optional W presence without mutating input", () => {
    for (const w of [
      undefined,
      {},
      { position: -0 },
      {
        scale: -0.08,
        position: 0.02,
        rotation: { xw: 0.2 },
        shear: { yw: -0.1 },
      },
    ]) {
      const final: Transform = {
        ...lens(),
        weight: 3,
        colorIndex: 0.3,
        colorSpeed: 0.7,
        chaos: [0, 1],
        variations: [
          { type: "linear", weight: 0 },
          { type: "swirl", weight: -2 },
          { type: "spherefold", weight: NaN },
        ],
        ...(w === undefined ? {} : { w }),
      };
      const original = structuredClone(final);
      const changed = edited(setSwirlLensRadius(final, 1, 0.25));
      expect(final).toEqual(original);
      expect(changed).not.toBe(final);
      expect(changed.scale).toEqual(final.scale.map((value) => value * 0.25));
      expect(changed.position).toEqual(
        final.position.map((value) => value * 0.25),
      );
      expect(changed.variations![1].weight).toBe(-8);
      expect(changed.variations![0]).toBe(final.variations![0]);
      expect(changed.variations![2]).toBe(final.variations![2]);
      for (const field of [
        "id",
        "weight",
        "colorIndex",
        "colorSpeed",
        "rotation",
        "shear",
        "post",
        "chaos",
      ] as const)
        expect(changed[field]).toBe(final[field]);
      expect(Object.hasOwn(changed, "w")).toBe(Object.hasOwn(final, "w"));
      if (final.w) {
        expect(Object.keys(changed.w!)).toEqual(Object.keys(final.w));
        expect(changed.w!.rotation).toBe(final.w.rotation);
        expect(changed.w!.shear).toBe(final.w.shear);
      }
      if (final.w?.scale !== undefined)
        expect(changed.w!.scale).toBe(final.w.scale * 0.25);
      if (final.w?.position !== undefined)
        expect(changed.w!.position).toBe(final.w.position * 0.25);
      const before4 = composeAffine4(toTransform4(final));
      const after4 = composeAffine4(toTransform4(changed));
      after4.m.forEach((value, i) =>
        expect(value).toBeCloseTo(before4.m[i] * 0.25, 14),
      );
      after4.t.forEach((value, i) =>
        expect(value).toBeCloseTo(before4.t[i] * 0.25, 14),
      );
    }
  });

  it("returns explicit numeric refusals, keeps no-op edits exact, and does not clamp large reciprocal weights", () => {
    const final = lens();
    for (const value of [0, -1, NaN, Infinity, -Infinity]) {
      expect(setSwirlLensRadius(final, 1, value)).toMatchObject({ ok: false });
      expect(setSwirlLensRadius(final, value, 1)).toMatchObject({ ok: false });
    }
    expect(
      setSwirlLensRadius(final, Number.MIN_VALUE, Number.MAX_VALUE),
    ).toMatchObject({ ok: false });
    expect(
      setSwirlLensRadius(final, Number.MAX_VALUE, Number.MIN_VALUE),
    ).toMatchObject({ ok: false });
    expect(
      setSwirlLensRadius(
        { ...final, position: [Number.MIN_VALUE, 0, 0] },
        1,
        0.1,
      ),
    ).toMatchObject({ ok: false });
    expect(setSwirlLensRadius(final, 0.25, 0.25)).toEqual({
      ok: true,
      transform: final,
    });
    expect(
      edited(setSwirlLensRadius(final, 1, 0.001)).variations![0].weight,
    ).toBe(-2000);
  });
});
