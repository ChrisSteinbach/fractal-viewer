import { systemPartsAreNonFlat } from "./affine4";
import { derivedColorIndex } from "./chaos-game";
import { lerpSystem } from "./morph";
import type { MorphSystem } from "./morph";
import { VARIATION_TYPES } from "./types";
import type { Transform, VariationType } from "./types";
import {
  BOX_FOLD_LIMIT,
  SPHERE_FOLD_FIXED_RADIUS,
  SPHERE_FOLD_MIN_RADIUS,
} from "./variations";

function transform(overrides: Partial<Transform> = {}): Transform {
  return {
    id: 0,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    ...overrides,
  };
}

function system(overrides: Partial<MorphSystem> = {}): MorphSystem {
  return {
    transforms: [transform()],
    finalTransform: null,
    symmetry: { order: 1, plane: "yz" },
    ...overrides,
  };
}

describe("lerpSystem endpoints", () => {
  it("returns a by the same reference at t=0 and for any t<0", () => {
    const a = system({ transforms: [transform({ id: 5 })] });
    const b = system({
      transforms: [transform({ id: 5, position: [1, 1, 1] })],
    });
    expect(lerpSystem(a, b, 0)).toBe(a);
    expect(lerpSystem(a, b, -0.5)).toBe(a);
  });

  it("returns b by the same reference at t=1 and for any t>1", () => {
    const a = system({ transforms: [transform()] });
    const b = system({
      transforms: [transform({ position: [1, 1, 1], weight: 3 })],
    });
    expect(lerpSystem(a, b, 1)).toBe(b);
    expect(lerpSystem(a, b, 1.5)).toBe(b);
  });
});

describe("lerpSystem rotation", () => {
  it("lerps through the nearest turn rather than raw numeric distance", () => {
    const a = system({
      transforms: [transform({ rotation: [(350 * Math.PI) / 180, 0, 0] })],
    });
    const b = system({
      transforms: [transform({ rotation: [(10 * Math.PI) / 180, 0, 0] })],
    });
    const mid = lerpSystem(a, b, 0.5);
    // 350deg -> 10deg is a +20deg turn through 360deg, so the midpoint sits
    // at 360deg (2*PI), not at the raw numeric midpoint (180deg = PI).
    expect(mid.transforms[0].rotation[0]).toBeCloseTo(2 * Math.PI, 10);
  });
});

describe("lerpSystem transform-count mismatch", () => {
  it("pins a surplus map's geometry bit-exact while its weight fades in from 0 (b longer)", () => {
    const a = system({ transforms: [transform({ id: 9 })] });
    const surplus = transform({
      id: 1,
      position: [0.3, -0.2, 0.1],
      rotation: [0.1, 0.2, 0.3],
      scale: [0.5, 0.6, 0.7],
    });
    const b = system({ transforms: [transform({ id: 9 }), surplus] });

    const mid = lerpSystem(a, b, 0.25);

    expect(mid.transforms).toHaveLength(2);
    expect(mid.transforms[1].position).toEqual(surplus.position);
    expect(mid.transforms[1].rotation).toEqual(surplus.rotation);
    expect(mid.transforms[1].scale).toEqual(surplus.scale);
    expect(mid.transforms[1].weight).toBe(0.25);
  });

  it("pins a surplus map's geometry bit-exact while its weight fades out to 0 (a longer)", () => {
    const surplus = transform({
      id: 1,
      position: [0.3, -0.2, 0.1],
      rotation: [0.1, 0.2, 0.3],
      scale: [0.5, 0.6, 0.7],
    });
    const a = system({ transforms: [transform({ id: 9 }), surplus] });
    const b = system({ transforms: [transform({ id: 9 })] });

    const mid = lerpSystem(a, b, 0.75);

    expect(mid.transforms).toHaveLength(2);
    expect(mid.transforms[1].position).toEqual(surplus.position);
    expect(mid.transforms[1].rotation).toEqual(surplus.rotation);
    expect(mid.transforms[1].scale).toEqual(surplus.scale);
    expect(mid.transforms[1].weight).toBe(0.25);
  });

  it("assigns each intermediate transform's id from its pair index, not either side's own id", () => {
    const a = system({ transforms: [transform({ id: 99 })] });
    const b = system({
      transforms: [transform({ id: 42, position: [1, 1, 1] })],
    });
    const mid = lerpSystem(a, b, 0.5);
    expect(mid.transforms[0].id).toBe(0);
  });
});

describe("lerpSystem variations", () => {
  it("unions variation types across both sides, a type missing on one side resolving to weight 0", () => {
    const a = system({
      transforms: [
        transform({ variations: [{ type: "spherical", weight: 1 }] }),
      ],
    });
    const b = system({
      transforms: [transform({ variations: [{ type: "swirl", weight: 0.5 }] })],
    });
    const mid = lerpSystem(a, b, 0.5);
    expect(mid.transforms[0].variations).toEqual([
      { type: "spherical", weight: 0.5 },
      { type: "swirl", weight: 0.25 },
    ]);
  });

  it("folds a side's own repeated entries of one type into a single lane at their summed weight", () => {
    const a = system({
      transforms: [
        transform({
          variations: [
            { type: "swirl", weight: 0.5 },
            { type: "swirl", weight: 0.25 },
          ],
        }),
      ],
    });
    const b = system({
      transforms: [transform({ variations: [{ type: "swirl", weight: 1.5 }] })],
    });
    const mid = lerpSystem(a, b, 0.5);
    // a's two swirl entries sum to 0.75 — the same blend, since a weighted
    // sum of one warp IS that warp at the summed weight — and 0.75 lerps
    // halfway to b's 1.5.
    expect(mid.transforms[0].variations).toEqual([
      { type: "swirl", weight: 1.125 },
    ]);
  });

  it("keeps the widest union a morph can build — the whole vocabulary, split disjointly — at one entry per type", () => {
    const blend = (types: readonly VariationType[]) =>
      types.map((type) => ({ type, weight: 1 }));
    const split = Math.ceil(VARIATION_TYPES.length / 2);
    const a = system({
      transforms: [
        transform({ variations: blend(VARIATION_TYPES.slice(0, split)) }),
      ],
    });
    const b = system({
      transforms: [
        transform({ variations: blend(VARIATION_TYPES.slice(split)) }),
      ],
    });

    const types = (lerpSystem(a, b, 0.5).transforms[0].variations ?? []).map(
      (v) => v.type,
    );

    // The union is keyed by TYPE rather than concatenated, so no morph
    // sample can ever carry more variations than the vocabulary has types —
    // the bound `flame-gpu.ts`'s fixed-count variation lanes rely on.
    expect(types).toHaveLength(VARIATION_TYPES.length);
    expect(new Set(types).size).toBe(VARIATION_TYPES.length);
  });
});

describe("lerpSystem fold radii", () => {
  it("returns a/b by reference at the endpoints with fold lengths present, absent, and mixed", () => {
    const a = system({
      transforms: [
        // Both sides omit every fold length.
        transform({ id: 0, variations: [{ type: "spherefold", weight: 1 }] }),
        // Both sides author different values.
        transform({
          id: 1,
          variations: [
            {
              type: "mandelbox",
              weight: 1,
              minRadius: 0.2,
              fixedRadius: 0.7,
              boxLimit: 0.8,
            },
          ],
        }),
        // Mixed present/absent, one direction (a has it, b doesn't).
        transform({
          id: 2,
          variations: [{ type: "boxfold", weight: 1, boxLimit: 0.6 }],
        }),
        // Mixed present/absent, the other direction (b has it, a doesn't).
        transform({ id: 3, variations: [{ type: "spherefold", weight: 1 }] }),
      ],
    });
    const b = system({
      transforms: [
        transform({ id: 0, variations: [{ type: "spherefold", weight: 1 }] }),
        transform({
          id: 1,
          variations: [
            {
              type: "mandelbox",
              weight: 1,
              minRadius: 0.4,
              fixedRadius: 1.6,
              boxLimit: 1.3,
            },
          ],
        }),
        transform({
          id: 2,
          variations: [{ type: "boxfold", weight: 1 }],
        }),
        transform({
          id: 3,
          variations: [{ type: "spherefold", weight: 1, minRadius: 0.9 }],
        }),
      ],
    });
    expect(lerpSystem(a, b, 0)).toBe(a);
    expect(lerpSystem(a, b, 1)).toBe(b);
  });

  it("keeps fold lengths absent at the midpoint when both sides omit them", () => {
    const a = system({
      transforms: [
        transform({ variations: [{ type: "spherefold", weight: 1 }] }),
      ],
    });
    const b = system({
      transforms: [
        transform({
          variations: [{ type: "spherefold", weight: 0.4 }],
          position: [1, 1, 1],
        }),
      ],
    });
    const mid = lerpSystem(a, b, 0.5);
    const variations = mid.transforms[0].variations!;
    expect(variations).toHaveLength(1);
    expect(variations[0].type).toBe("spherefold");
    expect(variations[0].weight).toBeCloseTo(0.7, 10); // lerp(1, 0.4, 0.5)
    expect(variations[0].minRadius).toBeUndefined();
    expect(variations[0].fixedRadius).toBeUndefined();
    expect(variations[0].boxLimit).toBeUndefined();
  });

  it("lerps two authored fold lengths to their midpoint when both sides set them", () => {
    const a = system({
      transforms: [
        transform({
          variations: [
            {
              type: "mandelbox",
              weight: 2,
              minRadius: 0.2,
              fixedRadius: 0.8,
              boxLimit: 0.6,
            },
          ],
        }),
      ],
    });
    const b = system({
      transforms: [
        transform({
          variations: [
            {
              type: "mandelbox",
              weight: 2,
              minRadius: 0.6,
              fixedRadius: 1.6,
              boxLimit: 1.4,
            },
          ],
        }),
      ],
    });
    const mid = lerpSystem(a, b, 0.5);
    const v = mid.transforms[0].variations![0];
    expect(v.type).toBe("mandelbox");
    expect(v.weight).toBe(2); // a === b, exact via lerp's a + (b-a)*t form
    expect(v.minRadius).toBeCloseTo(0.4, 10);
    expect(v.fixedRadius).toBeCloseTo(1.2, 10);
    expect(v.boxLimit).toBeCloseTo(1, 10);
  });

  it("interpolates a present minRadius against an absent one through the classic value's midpoint", () => {
    const a = system({
      transforms: [
        transform({
          variations: [{ type: "spherefold", weight: 1, minRadius: 0.3 }],
        }),
      ],
    });
    const b = system({
      transforms: [
        transform({ variations: [{ type: "spherefold", weight: 1 }] }),
      ],
    });
    const mid = lerpSystem(a, b, 0.5);
    // b omits minRadius, which means the classic SPHERE_FOLD_MIN_RADIUS —
    // never a synthesized 0 — so the midpoint sits halfway to THAT value.
    expect(mid.transforms[0].variations![0].minRadius).toBeCloseTo(
      (0.3 + SPHERE_FOLD_MIN_RADIUS) / 2,
      10,
    );
  });

  it("resolves each fold length independently through its own classic default when they're mixed present/absent in both directions", () => {
    const a = system({
      transforms: [
        transform({
          variations: [
            { type: "mandelbox", weight: 1, minRadius: 0.3, boxLimit: 1.5 },
          ],
        }),
      ],
    });
    const b = system({
      transforms: [
        transform({
          variations: [{ type: "mandelbox", weight: 1, fixedRadius: 1.4 }],
        }),
      ],
    });
    const mid = lerpSystem(a, b, 0.5);
    // a omits fixedRadius (-> classic SPHERE_FOLD_FIXED_RADIUS); b omits
    // minRadius and boxLimit (-> their own classic defaults). Each field
    // resolves independently of what the other fields on the same entry do.
    const v = mid.transforms[0].variations![0];
    expect(v.minRadius).toBeCloseTo((0.3 + SPHERE_FOLD_MIN_RADIUS) / 2, 10);
    expect(v.fixedRadius).toBeCloseTo((SPHERE_FOLD_FIXED_RADIUS + 1.4) / 2, 10);
    expect(v.boxLimit).toBeCloseTo((1.5 + BOX_FOLD_LIMIT) / 2, 10);
  });

  it("resolves fold lengths through the classic default when a fold type is present on only one side", () => {
    const a = system({
      transforms: [
        transform({
          variations: [{ type: "spherefold", weight: 1, minRadius: 0.2 }],
        }),
      ],
    });
    const b = system({ transforms: [transform({ position: [1, 1, 1] })] });
    const mid = lerpSystem(a, b, 0.5);
    // b carries no spherefold entry at all, which resolves exactly like a
    // present entry that merely omits minRadius: the classic default.
    const v = mid.transforms[0].variations![0];
    expect(v.type).toBe("spherefold");
    expect(v.weight).toBeCloseTo(0.5, 10);
    expect(v.minRadius).toBeCloseTo((0.2 + SPHERE_FOLD_MIN_RADIUS) / 2, 10);
  });

  it("morphs two unparameterized systems to a result carrying no fold fields at all", () => {
    const a = system({
      transforms: [
        transform({ variations: [{ type: "spherical", weight: 1 }] }),
      ],
    });
    const b = system({
      transforms: [
        transform({
          variations: [{ type: "swirl", weight: 0.5 }],
          position: [1, 1, 1],
        }),
      ],
    });
    const mid = lerpSystem(a, b, 0.5);
    expect(mid.transforms[0].variations).toEqual([
      { type: "spherical", weight: 0.5 },
      { type: "swirl", weight: 0.25 },
    ]);
  });
});

describe("lerpSystem flat/4D continuity", () => {
  it("derives an absent w.scale from that side's own mean spatial contraction, not the lerped scale", () => {
    const a = system({ transforms: [transform({ w: { scale: 0.2 } })] });
    const b = system({ transforms: [transform({ scale: [0.9, 0.3, 0.6] })] });
    const mid = lerpSystem(a, b, 0.5);
    // b's derived endpoint is (0.9+0.3+0.6)/3 = 0.6, so the midpoint is
    // lerp(0.2, 0.6, 0.5) = 0.4.
    expect(mid.transforms[0].w?.scale).toBeCloseTo(0.4, 10);
  });

  it("stays w-less when neither side carries a w block", () => {
    const a = system({ transforms: [transform()] });
    const b = system({
      transforms: [transform({ position: [1, 1, 1], scale: [0.5, 0.5, 0.5] })],
    });
    const mid = lerpSystem(a, b, 0.5);
    expect(mid.transforms[0].w).toBeUndefined();
  });

  it("stays w-less when a side's w block is present but trivially all-zero", () => {
    const a = system({ transforms: [transform({ w: { position: 0 } })] });
    const b = system({
      transforms: [transform({ position: [1, 1, 1], scale: [0.5, 0.5, 0.5] })],
    });
    const mid = lerpSystem(a, b, 0.5);
    expect(mid.transforms[0].w).toBeUndefined();
  });
});

describe("lerpSystem negative scale", () => {
  it("lerps scale straight through zero for a mirror fold-through", () => {
    const a = system({ transforms: [transform({ scale: [-1, 1, 1] })] });
    const b = system({ transforms: [transform({ scale: [1, 1, 1] })] });
    const mid = lerpSystem(a, b, 0.5);
    expect(mid.transforms[0].scale[0]).toBe(0);
  });
});

describe("lerpSystem finalTransform", () => {
  it("fades a final-transform lens in from the identity when only b has one", () => {
    const a = system({ finalTransform: null });
    const b = system({
      finalTransform: {
        id: 7,
        position: [1, 0, 0],
        rotation: [0, 0, 0],
        scale: [2, 1, 1],
        variations: [{ type: "julia", weight: 0.8 }],
      },
    });
    const mid = lerpSystem(a, b, 0.5);
    expect(mid.finalTransform).toEqual({
      id: 7,
      position: [0.5, 0, 0],
      rotation: [0, 0, 0],
      scale: [1.5, 1, 1],
      variations: [{ type: "julia", weight: 0.4 }],
    });
  });

  it("fades a final-transform lens out to the identity when only a has one", () => {
    const a = system({
      finalTransform: {
        id: 3,
        position: [0, 2, 0],
        rotation: [0, 0, 0],
        scale: [1, 3, 1],
      },
    });
    const b = system({ finalTransform: null });
    const mid = lerpSystem(a, b, 0.5);
    expect(mid.finalTransform).toEqual({
      id: 3,
      position: [0, 1, 0],
      scale: [1, 2, 1],
      rotation: [0, 0, 0],
    });
  });

  it("keeps finalTransform null when both sides have none", () => {
    const a = system({ finalTransform: null });
    const b = system({ finalTransform: null });
    expect(lerpSystem(a, b, 0.5).finalTransform).toBeNull();
  });
});

describe("lerpSystem symmetry", () => {
  it("keeps a matching kaleidoscope untouched (by reference) across the whole morph", () => {
    const a = system({ symmetry: { order: 4, plane: "xz" } });
    const b = system({ symmetry: { order: 4, plane: "xz" } });
    expect(lerpSystem(a, b, 0.25).symmetry).toBe(a.symmetry);
    expect(lerpSystem(a, b, 0.75).symmetry).toBe(b.symmetry);
  });

  it("fades a departing kaleidoscope out over the first half when the target has none", () => {
    const a = system({ symmetry: { order: 6, plane: "xy" } });
    const b = system({ symmetry: { order: 1, plane: "yz" } });
    expect(lerpSystem(a, b, 0.25).symmetry).toEqual({
      order: 6,
      plane: "xy",
      blend: 0.5,
    });
    // From the midpoint on, the order-1 target rides by reference — nothing
    // left to fade.
    expect(lerpSystem(a, b, 0.5).symmetry).toBe(b.symmetry);
    expect(lerpSystem(a, b, 0.75).symmetry).toBe(b.symmetry);
  });

  it("fades an arriving kaleidoscope in over the second half when the source has none", () => {
    const a = system({ symmetry: { order: 1, plane: "yz" } });
    const b = system({ symmetry: { order: 5, plane: "xz" } });
    expect(lerpSystem(a, b, 0.25).symmetry).toBe(a.symmetry);
    expect(lerpSystem(a, b, 0.75).symmetry).toEqual({
      order: 5,
      plane: "xz",
      blend: 0.5,
    });
    // The blend closes to the full kaleidoscope as t -> 1 (t = 1 itself
    // returns `b` by reference via lerpSystem's endpoint rule).
    expect(lerpSystem(a, b, 0.9).symmetry).toEqual({
      order: 5,
      plane: "xz",
      blend: expect.closeTo(0.8),
    });
  });

  it("crossfades two differing kaleidoscopes through blend 0 at the midpoint", () => {
    const a = system({ symmetry: { order: 2, plane: "yz" } });
    const b = system({ symmetry: { order: 6, plane: "xy" } });
    expect(lerpSystem(a, b, 0.3).symmetry).toEqual({
      order: 2,
      plane: "yz",
      blend: expect.closeTo(0.4),
    });
    // Continuous at the midpoint: both sides sit at blend 0, which
    // prepareChaosGame renders bit-identically to order 1.
    expect(lerpSystem(a, b, 0.5).symmetry).toEqual({
      order: 6,
      plane: "xy",
      blend: 0,
    });
    expect(lerpSystem(a, b, 0.7).symmetry).toEqual({
      order: 6,
      plane: "xy",
      blend: expect.closeTo(0.4),
    });
  });

  it("departs from a mid-fade sample's own strength on a chained morph, never popping back to full", () => {
    // A chained restart's `from` is the in-flight morph's live sample
    // (morph-tween.ts), whose kaleidoscope may already be half-faded.
    const a = system({ symmetry: { order: 4, plane: "xz", blend: 0.6 } });
    const b = system({ symmetry: { order: 1, plane: "yz" } });
    expect(lerpSystem(a, b, 0.25).symmetry).toEqual({
      order: 4,
      plane: "xz",
      blend: expect.closeTo(0.3),
    });
  });

  it("treats a differing twist as a different kaleidoscope and crossfades, never interpolating the twist", () => {
    // Same order and plane, different second angle: (order, plane, twist) is
    // the identity tuple, so this pair crossfades — each half
    // still that side's own group, twist carried whole, no in-between twist
    // value ever synthesized (it would be a rotation in neither group).
    const a = system({ symmetry: { order: 6, plane: "xw", twist: 1 } });
    const b = system({ symmetry: { order: 6, plane: "xw", twist: 5 } });
    expect(lerpSystem(a, b, 0.25).symmetry).toEqual({
      order: 6,
      plane: "xw",
      twist: 1,
      blend: 0.5,
    });
    expect(lerpSystem(a, b, 0.75).symmetry).toEqual({
      order: 6,
      plane: "xw",
      twist: 5,
      blend: 0.5,
    });
  });

  it("keeps a matching twisted kaleidoscope untouched (by reference) across the whole morph", () => {
    const a = system({ symmetry: { order: 6, plane: "xy", twist: 2 } });
    const b = system({ symmetry: { order: 6, plane: "xy", twist: 2 } });
    expect(lerpSystem(a, b, 0.25).symmetry).toBe(a.symmetry);
    expect(lerpSystem(a, b, 0.75).symmetry).toBe(b.symmetry);
  });

  it("crossfades the kaleidoscopes of a flat -> 4D morph like any other differing pair", () => {
    // The old non-flat skip is gone: a 4D sample renders its
    // kaleidoscope, so the crossfade runs even though b's transform
    // carries a genuine w block and every intermediate is non-flat.
    const a = system({
      transforms: [transform()],
      symmetry: { order: 6, plane: "xy" },
    });
    const b = system({
      transforms: [transform({ w: { position: 0.5 } })],
      symmetry: { order: 5, plane: "xz" },
    });
    expect(lerpSystem(a, b, 0.1).symmetry).toEqual({
      order: 6,
      plane: "xy",
      blend: expect.closeTo(0.8),
    });
    expect(lerpSystem(a, b, 0.9).symmetry).toEqual({
      order: 5,
      plane: "xz",
      blend: expect.closeTo(0.8),
    });
  });

  it("produces genuinely non-flat intermediates when a flat-transform endpoint carries a w-plane kaleidoscope", () => {
    // Every transform on both sides is flat; only a's symmetry plane mixes
    // w. The departing kaleidoscope fades through the first half of the
    // morph, and while it is present the SAMPLE itself is a 4D system —
    // derived from the finished parts + symmetry, the same predicate the
    // app routes generation requests on.
    const a = system({ symmetry: { order: 6, plane: "xw" } });
    const b = system({ symmetry: { order: 1, plane: "xz" } });
    const sample = lerpSystem(a, b, 0.25);
    expect(sample.symmetry).toEqual({
      order: 6,
      plane: "xw",
      blend: 0.5,
    });
    expect(
      systemPartsAreNonFlat(
        sample.transforms,
        sample.finalTransform,
        sample.symmetry,
      ),
    ).toBe(true);
    // Past the midpoint only b's w-free order-1 side remains: flat again.
    const late = lerpSystem(a, b, 0.75);
    expect(
      systemPartsAreNonFlat(
        late.transforms,
        late.finalTransform,
        late.symmetry,
      ),
    ).toBe(false);
  });
});

describe("lerpSystem weight", () => {
  it("keeps weight absent when both sides omit it", () => {
    const a = system({ transforms: [transform()] });
    const b = system({ transforms: [transform({ position: [1, 1, 1] })] });
    const mid = lerpSystem(a, b, 0.5);
    expect(mid.transforms[0].weight).toBeUndefined();
  });

  it("emits weight explicitly, resolving an absent side to 1, when either side has one", () => {
    const a = system({ transforms: [transform({ weight: 3 })] });
    const b = system({ transforms: [transform({ position: [1, 1, 1] })] });
    const mid = lerpSystem(a, b, 0.5);
    expect(mid.transforms[0].weight).toBe(2); // lerp(3, 1, 0.5) = 2
  });
});

describe("lerpSystem shear", () => {
  it("keeps shear absent when both sides omit it", () => {
    const a = system({ transforms: [transform()] });
    const b = system({ transforms: [transform({ position: [1, 1, 1] })] });
    const mid = lerpSystem(a, b, 0.5);
    expect(mid.transforms[0].shear).toBeUndefined();
  });

  it("emits shear explicitly, resolving an absent side to [0,0,0], when either side has one", () => {
    const a = system({ transforms: [transform({ shear: [0.2, -0.1, 0.4] })] });
    const b = system({ transforms: [transform({ position: [1, 1, 1] })] });
    const mid = lerpSystem(a, b, 0.5);
    expect(mid.transforms[0].shear).toEqual([0.1, -0.05, 0.2]);
  });
});

describe("lerpSystem colorIndex/colorSpeed", () => {
  it("keeps both fields absent when both sides omit them", () => {
    const a = system({ transforms: [transform()] });
    const b = system({ transforms: [transform({ position: [1, 1, 1] })] });
    const mid = lerpSystem(a, b, 0.5);
    expect(mid.transforms[0].colorIndex).toBeUndefined();
    expect(mid.transforms[0].colorSpeed).toBeUndefined();
  });

  it("lerps both fields to their midpoint when both sides author them", () => {
    const a = system({
      transforms: [transform({ colorIndex: 0.2, colorSpeed: 0.1 })],
    });
    const b = system({
      transforms: [transform({ colorIndex: 0.8, colorSpeed: 0.9 })],
    });
    const mid = lerpSystem(a, b, 0.5);
    expect(mid.transforms[0].colorIndex).toBeCloseTo(0.5, 10);
    expect(mid.transforms[0].colorSpeed).toBeCloseTo(0.5, 10);
  });

  it("resolves an absent colorSpeed to DEFAULT_COLOR_SPEED (0.5) when only one side authors it", () => {
    const a = system({ transforms: [transform({ colorSpeed: 0.9 })] });
    const b = system({ transforms: [transform({ position: [1, 1, 1] })] });
    const mid = lerpSystem(a, b, 0.5);
    expect(mid.transforms[0].colorSpeed).toBe(0.7); // lerp(0.9, 0.5, 0.5) = 0.7
  });

  it("resolves an absent colorIndex through derivedColorIndex(i, n) when only one side authors it", () => {
    const a = system({
      transforms: [transform({ id: 0, colorIndex: 0.9 }), transform({ id: 1 })],
    });
    const b = system({
      transforms: [
        transform({ id: 0, position: [1, 1, 1] }),
        transform({ id: 1, position: [1, 1, 1] }),
      ],
    });
    const mid = lerpSystem(a, b, 0.5);
    // b's map 0 has no colorIndex, so it resolves through the paired-length
    // fallback derivedColorIndex(0, 2) = 0; lerp(0.9, 0, 0.5) = 0.45.
    expect(mid.transforms[0].colorIndex).toBeCloseTo(0.45, 10);
  });

  it("returns a/b by reference at the endpoints with authored color fields intact", () => {
    const a = system({
      transforms: [transform({ colorIndex: 0.3, colorSpeed: 0.2 })],
    });
    const b = system({
      transforms: [transform({ colorIndex: 0.7, colorSpeed: 0.8 })],
    });
    expect(lerpSystem(a, b, 0)).toBe(a);
    expect(lerpSystem(a, b, 1)).toBe(b);
  });

  it("uses the PAIRED transform count, not either side's own count, for an overlapping pair's colorIndex fallback", () => {
    const a = system({
      // Own length 2 -- no colorIndex authored on either map.
      transforms: [transform({ id: 0 }), transform({ id: 1 })],
    });
    const b = system({
      // Own length 4 -- map 1 authors colorIndex, the rest don't.
      transforms: [
        transform({ id: 0, position: [1, 1, 1] }),
        transform({ id: 1, position: [1, 1, 1], colorIndex: 0.6 }),
        transform({ id: 2, position: [1, 1, 1] }),
        transform({ id: 3, position: [1, 1, 1] }),
      ],
    });
    const mid = lerpSystem(a, b, 0.5);
    // Index 1 is a REAL pair on both sides (1 < min(2,4)), not phantom
    // padding. a's own count is 2 (derivedColorIndex(1,2) would be 1), but
    // the paired length is 4 (derivedColorIndex(1,4) = 1/3) -- the fallback
    // must resolve through the latter.
    const fallback = derivedColorIndex(1, 4);
    expect(fallback).toBeCloseTo(1 / 3, 10);
    expect(mid.transforms[1].colorIndex).toBeCloseTo(
      fallback + (0.6 - fallback) * 0.5,
      10,
    );
  });

  it("keeps a phantom-padded pair's colorIndex pinned bit-exact across the whole morph", () => {
    const a = system({ transforms: [transform({ id: 9 })] });
    const surplus = transform({ id: 1, colorIndex: 0.42 });
    const b = system({ transforms: [transform({ id: 9 }), surplus] });

    // The padded pair (index 1) is phantomTransform(surplus) against surplus
    // itself -- literally the same colorIndex on both sides -- so it lerps
    // exactly, at every t, the same way its geometry does.
    for (const t of [0.1, 0.5, 0.9]) {
      expect(lerpSystem(a, b, t).transforms[1].colorIndex).toBe(0.42);
    }
  });
});
