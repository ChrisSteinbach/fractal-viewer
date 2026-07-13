import { lerpSystem } from "./morph";
import type { MorphSystem } from "./morph";
import type { Transform } from "./types";

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
    symmetry: { order: 1, axis: "x" },
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
  it("snaps from a's symmetry to b's at the morph midpoint", () => {
    const a = system({ symmetry: { order: 1, axis: "x" } });
    const b = system({ symmetry: { order: 6, axis: "z" } });
    expect(lerpSystem(a, b, 0.4).symmetry).toBe(a.symmetry);
    expect(lerpSystem(a, b, 0.5).symmetry).toBe(b.symmetry);
    expect(lerpSystem(a, b, 0.6).symmetry).toBe(b.symmetry);
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
