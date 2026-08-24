import {
  CHAOS_SUB_ORBIT_POINTS,
  DEFAULT_COLOR_SPEED,
  MAX_SCHEDULE_DEPTH,
  MAX_TRANSFORMS,
  WARMUP_ITERATIONS,
  chaosRowIsNonTrivial,
  createEmitterStream,
  derivedColorIndex,
  effectiveSymmetryOrder,
  emitterSeed,
  pickIndex,
  pickScheduleIndex,
  plotPoint,
  prepareChaosGame,
  prepareEmitters,
  runChaosGame,
  stepOrbit,
  symmetryRotation,
  systemHasChaos,
  systemHasEmitters,
  transformHasEmitter,
} from "./chaos-game";
import type { PreparedChaosGame } from "./chaos-game";
import { applyAffine, composeAffine, rotationMatrixXYZ } from "./affine";
import { rotationMatrix4 } from "./affine4";
import { GEAR_SHAPE, prepareShapeSampler, shapeSdf } from "./shapes";
import type { ShapeSpec } from "./shapes";
import { composeVariations } from "./variations";
import { iterationRng, mulberry32 } from "./rng";
import type { IterationRng, Rng } from "./rng";
import { fernSpongeIsolated, sierpinskiTetrahedron } from "./presets";
import type { Bounds, SymmetryParams, Transform } from "./types";

function makeTransforms(count: number): Transform[] {
  return Array.from({ length: count }, (_, id) => ({
    id,
    position: [0.5, 0.5, 0.5],
    rotation: [0, 0, 0],
    scale: [0.5, 0.5, 0.5],
  }));
}

describe("runChaosGame", () => {
  it("returns an empty result with no transforms", () => {
    const result = runChaosGame([], 1000);
    expect(result.count).toBe(0);
    expect(result.positions).toHaveLength(0);
    expect(result.transformIndices).toHaveLength(0);
  });

  it("returns an empty result for zero points", () => {
    const result = runChaosGame(makeTransforms(4), 0);
    expect(result.count).toBe(0);
    expect(result.positions).toHaveLength(0);
  });

  it("produces count points with matching buffer lengths", () => {
    const result = runChaosGame(makeTransforms(4), 500, mulberry32(1));
    expect(result.count).toBe(500);
    expect(result.positions).toHaveLength(500 * 3);
    expect(result.transformIndices).toHaveLength(500);
  });

  it("is deterministic for a given seed", () => {
    const a = runChaosGame(makeTransforms(4), 200, mulberry32(7));
    const b = runChaosGame(makeTransforms(4), 200, mulberry32(7));
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.transformIndices)).toEqual(
      Array.from(b.transformIndices),
    );
  });

  it("only references valid transform indices", () => {
    const result = runChaosGame(makeTransforms(3), 1000, mulberry32(99));
    for (const idx of result.transformIndices) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(3);
    }
  });

  it("keeps the Sierpinski attractor inside a bounded region", () => {
    const result = runChaosGame(sierpinskiTetrahedron(), 2000, mulberry32(3));
    const { minX, maxX, minY, maxY, minZ, maxZ } = result.bounds;
    expect(minX).toBeGreaterThan(-2);
    expect(maxX).toBeLessThan(2);
    expect(minY).toBeGreaterThan(-2);
    expect(maxY).toBeLessThan(2);
    expect(minZ).toBeGreaterThan(-2);
    expect(maxZ).toBeLessThan(2);
  });

  it("rejects systems with more than the supported number of transforms", () => {
    expect(() => runChaosGame(makeTransforms(MAX_TRANSFORMS + 1), 10)).toThrow(
      RangeError,
    );
  });
});

describe("runChaosGame with variations", () => {
  // Two contractive maps with off-axis rotation, so the affine part alone gives
  // a well-behaved attractor and the variation is the only thing under test.
  function twoMaps(variations?: Transform["variations"]): Transform[] {
    return [
      {
        id: 0,
        position: [0.3, 0.1, -0.2],
        rotation: [0.2, 0.4, 0.1],
        scale: [0.5, 0.5, 0.5],
        variations,
      },
      {
        id: 1,
        position: [-0.3, 0.2, 0.15],
        rotation: [0, 0.3, 0.5],
        scale: [0.5, 0.5, 0.5],
        variations,
      },
    ];
  }

  it("keeps every coordinate finite so a singularity never leaks NaN", () => {
    // spherical diverges at the origin; the escape/non-finite guard must catch
    // any bad landing before it poisons the rest of the orbit.
    const spherical = twoMaps([{ type: "spherical", weight: 1 }]);
    const { positions } = runChaosGame(spherical, 3000, mulberry32(4));
    for (const v of positions) expect(Number.isFinite(v)).toBe(true);
  });

  it("is deterministic for a seed even with a stochastic variation", () => {
    const julia = twoMaps([{ type: "julia", weight: 1 }]);
    const a = runChaosGame(julia, 500, mulberry32(9));
    const b = runChaosGame(julia, 500, mulberry32(9));
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
  });

  it("warps the cloud: a variation changes where points land", () => {
    const plain = runChaosGame(twoMaps(), 500, mulberry32(9));
    const warped = runChaosGame(
      twoMaps([{ type: "spherical", weight: 1 }]),
      500,
      mulberry32(9),
    );
    expect(Array.from(warped.positions)).not.toEqual(
      Array.from(plain.positions),
    );
  });
});

describe("runChaosGame with a final transform", () => {
  // Two contractive maps with a well-behaved affine attractor and no per-map
  // variations, so the only RNG-consuming warp under test is the final one.
  function twoMaps(): Transform[] {
    return [
      {
        id: 0,
        position: [0.3, 0.1, -0.2],
        rotation: [0.2, 0.4, 0.1],
        scale: [0.5, 0.5, 0.5],
      },
      {
        id: 1,
        position: [-0.3, 0.2, 0.15],
        rotation: [0, 0.3, 0.5],
        scale: [0.5, 0.5, 0.5],
      },
    ];
  }

  it("bends plotted points through the final transform without feeding back into the orbit", () => {
    // A pure-affine final transform consumes no RNG, so the underlying orbit —
    // and thus the transform indices — stay identical to a run without it; only
    // the plotted positions change, each the orbit point run through F. That
    // pins down all three properties at once: applied at plot time, applied to
    // the orbit point (not fed back), and RNG-neutral when it has no variation.
    const finalTransform: Transform = {
      id: 0,
      position: [1, -2, 0.5],
      rotation: [0, 0, 0],
      scale: [2, 2, 2],
    };
    const base = runChaosGame(twoMaps(), 400, mulberry32(9));
    const lensed = runChaosGame(twoMaps(), 400, mulberry32(9), finalTransform);

    expect(Array.from(lensed.transformIndices)).toEqual(
      Array.from(base.transformIndices),
    );
    const F = composeAffine(finalTransform);
    for (let i = 0; i < base.count; i++) {
      const [ex, ey, ez] = applyAffine(
        F,
        base.positions[i * 3],
        base.positions[i * 3 + 1],
        base.positions[i * 3 + 2],
      );
      expect(lensed.positions[i * 3]).toBeCloseTo(ex, 4);
      expect(lensed.positions[i * 3 + 1]).toBeCloseTo(ey, 4);
      expect(lensed.positions[i * 3 + 2]).toBeCloseTo(ez, 4);
    }
  });

  it("leaves the cloud unchanged for an identity final transform", () => {
    const identity: Transform = {
      id: 0,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    };
    const without = runChaosGame(twoMaps(), 300, mulberry32(4));
    const withIdentity = runChaosGame(twoMaps(), 300, mulberry32(4), identity);
    expect(Array.from(withIdentity.positions)).toEqual(
      Array.from(without.positions),
    );
  });

  it("keeps every coordinate finite when the final transform diverges at a singularity", () => {
    // spherical inverts through the origin, sending points near it to infinity;
    // the finite guard must plot the un-bent point rather than leak NaN/Inf.
    const finalTransform: Transform = {
      id: 0,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      variations: [{ type: "spherical", weight: 1 }],
    };
    const { positions } = runChaosGame(
      twoMaps(),
      3000,
      mulberry32(4),
      finalTransform,
    );
    for (const v of positions) expect(Number.isFinite(v)).toBe(true);
  });

  it("is deterministic for a seed even with a stochastic final transform", () => {
    const finalTransform: Transform = {
      id: 0,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      variations: [{ type: "julia", weight: 1 }],
    };
    const a = runChaosGame(twoMaps(), 500, mulberry32(9), finalTransform);
    const b = runChaosGame(twoMaps(), 500, mulberry32(9), finalTransform);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
  });
});

describe("runChaosGame weighting", () => {
  // Two maps with identical geometry, so only the weights — never position —
  // can bias which map is chosen.
  function twoMaps(w0: number, w1: number): Transform[] {
    return [
      {
        id: 0,
        position: [0.5, 0, 0],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0.5],
        weight: w0,
      },
      {
        id: 1,
        position: [-0.5, 0, 0],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0.5],
        weight: w1,
      },
    ];
  }

  function shareOfMap0(transforms: Transform[]): number {
    const result = runChaosGame(transforms, 8000, mulberry32(5));
    let zero = 0;
    for (const idx of result.transformIndices) if (idx === 0) zero++;
    return zero / result.count;
  }

  it("draws maps in proportion to their weights (3:1 ≈ 75%)", () => {
    const share = shareOfMap0(twoMaps(3, 1));
    expect(share).toBeGreaterThan(0.7);
    expect(share).toBeLessThan(0.8);
  });

  it("stays unbiased on the weighted path when weights are equal", () => {
    const share = shareOfMap0(twoMaps(2, 2));
    expect(share).toBeGreaterThan(0.45);
    expect(share).toBeLessThan(0.55);
  });

  it("treats an omitted weight as an explicit weight of 1 (same RNG stream)", () => {
    const omitted = makeTransforms(4);
    const explicitOnes = omitted.map((t) => ({ ...t, weight: 1 }));
    const a = runChaosGame(omitted, 500, mulberry32(11));
    const b = runChaosGame(explicitOnes, 500, mulberry32(11));
    expect(Array.from(b.transformIndices)).toEqual(
      Array.from(a.transformIndices),
    );
    expect(Array.from(b.positions)).toEqual(Array.from(a.positions));
  });
});

describe("prepareChaosGame", () => {
  it("composes one affine and one variation slot per transform", () => {
    const prepared = prepareChaosGame(makeTransforms(4));
    expect(prepared.affines).toHaveLength(4);
    expect(prepared.variations).toHaveLength(4);
    expect(prepared.transformCount).toBe(4);
  });

  it("has no final transform when none is passed", () => {
    const prepared = prepareChaosGame(makeTransforms(2));
    expect(prepared.finalAffine).toBeNull();
    expect(prepared.finalWarp).toBeNull();
  });

  it("flags a system as weighted only when a weight differs from 1", () => {
    const uniform = prepareChaosGame(makeTransforms(2));
    expect(uniform.weighted).toBe(false);

    const skewed = [
      { id: 0, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      {
        id: 1,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        weight: 3,
      },
    ] satisfies Transform[];
    const weighted = prepareChaosGame(skewed);
    expect(weighted.weighted).toBe(true);
    expect(weighted.totalWeight).toBe(4);
    expect(Array.from(weighted.cumulative)).toEqual([1, 4]);
  });

  it("rejects systems with more than the supported number of transforms", () => {
    expect(() => prepareChaosGame(makeTransforms(MAX_TRANSFORMS + 1))).toThrow(
      RangeError,
    );
  });
});

describe("derivedColorIndex", () => {
  it("spreads evenly across the ramp for n >= 2", () => {
    expect(derivedColorIndex(0, 3)).toBe(0);
    expect(derivedColorIndex(1, 3)).toBe(0.5);
    expect(derivedColorIndex(2, 3)).toBe(1);
  });

  it("pins the midpoint for a lone map (n === 1)", () => {
    expect(derivedColorIndex(0, 1)).toBe(0.5);
  });

  it("pins the midpoint for n === 0 too (documented fallback, not a spread)", () => {
    expect(derivedColorIndex(0, 0)).toBe(0.5);
  });
});

describe("prepareChaosGame flame color resolution", () => {
  it("resolves an all-absent system to the derived spread and DEFAULT_COLOR_SPEED", () => {
    const prepared = prepareChaosGame(makeTransforms(4));
    expect(Array.from(prepared.colorIndex)).toEqual([0, 1 / 3, 2 / 3, 1]);
    expect(Array.from(prepared.colorSpeed)).toEqual([
      DEFAULT_COLOR_SPEED,
      DEFAULT_COLOR_SPEED,
      DEFAULT_COLOR_SPEED,
      DEFAULT_COLOR_SPEED,
    ]);
  });

  it("resolves authored values per-map, deriving only where a map leaves them absent", () => {
    const transforms = makeTransforms(3);
    transforms[0] = { ...transforms[0], colorIndex: 0.9, colorSpeed: 0.1 };
    const prepared = prepareChaosGame(transforms);
    expect(prepared.colorIndex[0]).toBe(0.9);
    expect(prepared.colorSpeed[0]).toBe(0.1);
    expect(prepared.colorIndex[1]).toBe(derivedColorIndex(1, 3));
    expect(prepared.colorIndex[2]).toBe(derivedColorIndex(2, 3));
    expect(prepared.colorSpeed[1]).toBe(DEFAULT_COLOR_SPEED);
    expect(prepared.colorSpeed[2]).toBe(DEFAULT_COLOR_SPEED);
  });

  it("keys colorIndex/colorSpeed on baseTransformCount, not the symmetry-expanded transformCount", () => {
    const prepared = prepareChaosGame(makeTransforms(2), null, {
      order: 4,
      plane: "xz",
    });
    expect(prepared.transformCount).toBe(8);
    expect(prepared.baseTransformCount).toBe(2);
    expect(prepared.colorIndex).toHaveLength(2);
    expect(prepared.colorSpeed).toHaveLength(2);
    expect(Array.from(prepared.colorIndex)).toEqual([
      derivedColorIndex(0, 2),
      derivedColorIndex(1, 2),
    ]);
  });
});

describe("stepOrbit", () => {
  it("is deterministic for a given prepared system, point, and seed", () => {
    const prepared = prepareChaosGame(makeTransforms(4));
    const a = stepOrbit(prepared, 0.1, -0.2, 0.05, mulberry32(3));
    const b = stepOrbit(prepared, 0.1, -0.2, 0.05, mulberry32(3));
    expect(a).toEqual(b);
  });

  it("only ever returns a valid transform index", () => {
    const prepared = prepareChaosGame(sierpinskiTetrahedron());
    const rng = mulberry32(21);
    let x = 0.1;
    let y = -0.1;
    let z = 0.2;
    for (let i = 0; i < 500; i++) {
      const s = stepOrbit(prepared, x, y, z, rng);
      expect(s.index).toBeGreaterThanOrEqual(0);
      expect(s.index).toBeLessThan(sierpinskiTetrahedron().length);
      x = s.x;
      y = s.y;
      z = s.z;
    }
  });
});

describe("plotPoint", () => {
  it("returns the orbit point unchanged when the prepared system has no final transform", () => {
    const prepared = prepareChaosGame(makeTransforms(4));
    expect(plotPoint(prepared, 1, -2, 0.5, mulberry32(1))).toEqual([
      1, -2, 0.5,
    ]);
  });

  it("bends the point through the final transform when one is present", () => {
    const finalTransform: Transform = {
      id: 0,
      position: [1, -2, 0.5],
      rotation: [0, 0, 0],
      scale: [2, 2, 2],
    };
    const prepared = prepareChaosGame(makeTransforms(4), finalTransform);
    const F = composeAffine(finalTransform);
    const [ex, ey, ez] = applyAffine(F, 0.3, 0.1, -0.2);
    const [px, py, pz] = plotPoint(prepared, 0.3, 0.1, -0.2, mulberry32(1));
    expect(px).toBeCloseTo(ex, 10);
    expect(py).toBeCloseTo(ey, 10);
    expect(pz).toBeCloseTo(ez, 10);
  });
});

describe("driving stepOrbit/plotPoint by hand", () => {
  it("reproduces runChaosGame's output exactly for the same seed", () => {
    // A stand-in for a future consumer (e.g. a histogram accumulator) that
    // shares prepareChaosGame/stepOrbit/plotPoint but owns its own loop and
    // sink. This pins the contract between runChaosGame and the exported
    // building blocks so the two can never silently drift apart.
    const transforms = sierpinskiTetrahedron();
    const finalTransform: Transform = {
      id: 0,
      position: [0.2, -0.1, 0],
      rotation: [0, 0.3, 0],
      scale: [1.2, 1.2, 1.2],
    };
    const numPoints = 500;
    const expected = runChaosGame(
      transforms,
      numPoints,
      mulberry32(42),
      finalTransform,
    );

    const rng = mulberry32(42);
    const prepared = prepareChaosGame(transforms, finalTransform);
    let x = rng() - 0.5;
    let y = rng() - 0.5;
    let z = rng() - 0.5;
    for (let i = 0; i < WARMUP_ITERATIONS; i++) {
      const s = stepOrbit(prepared, x, y, z, rng);
      x = s.x;
      y = s.y;
      z = s.z;
    }

    const positions = new Float32Array(numPoints * 3);
    const transformIndices = new Uint8Array(numPoints);
    for (let i = 0; i < numPoints; i++) {
      const s = stepOrbit(prepared, x, y, z, rng);
      x = s.x;
      y = s.y;
      z = s.z;
      const [px, py, pz] = plotPoint(prepared, x, y, z, rng);
      positions[i * 3] = px;
      positions[i * 3 + 1] = py;
      positions[i * 3 + 2] = pz;
      transformIndices[i] = s.index;
    }

    expect(Array.from(positions)).toEqual(Array.from(expected.positions));
    expect(Array.from(transformIndices)).toEqual(
      Array.from(expected.transformIndices),
    );
  });
});

describe("symmetryRotation", () => {
  /** The upper-left 3x3 of a row-major 4x4 — the block a 4D rotation shares
   * with its 3D counterpart. */
  function upper3(m: number[]): number[] {
    return [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
  }

  /** ENTRY-FOR-ENTRY equality, `-0` and `+0` counted equal: several of these
   * matrices carry a `-0` where the other carries `+0` (`-c*f` with `f = 0`
   * against a literal `0`), which is the same number for every purpose that
   * matters here — no arithmetic can tell them apart downstream. */
  function expectSameMatrix(actual: number[], expected: number[]): void {
    expect(actual).toHaveLength(expected.length);
    for (let i = 0; i < expected.length; i++) {
      expect(actual[i] + 0).toBe(expected[i] + 0);
    }
  }

  const ANGLES = [0.3, 1.1, 2.4, -0.7, (2 * Math.PI) / 5];

  // ——— the axis -> plane migration is BIT-EXACT ———
  //
  // Every document predating it names an axis; persist.ts maps it to a plane.
  // These three pin that the plane produces the SAME matrix the axis did, so
  // no existing document's kaleidoscope moves by so much as an ulp.

  it("reproduces the legacy x axis exactly as the yz plane", () => {
    for (const angle of ANGLES) {
      expectSameMatrix(
        symmetryRotation("yz", angle),
        rotationMatrixXYZ(angle, 0, 0),
      );
    }
  });

  it("reproduces the legacy y axis — the default — exactly as the xz plane", () => {
    for (const angle of ANGLES) {
      expectSameMatrix(
        symmetryRotation("xz", angle),
        rotationMatrixXYZ(0, angle, 0),
      );
    }
  });

  it("reproduces the legacy z axis exactly as the xy plane", () => {
    for (const angle of ANGLES) {
      expectSameMatrix(
        symmetryRotation("xy", angle),
        rotationMatrixXYZ(0, 0, angle),
      );
    }
  });

  // ——— The one sign that is NOT affine4.ts's R_ab ———
  //
  // A trap for the 4D generator this vocabulary exists for. "Rotation about
  // +y" carries +z toward +x, i.e. R_zx = R_xz(-angle) — which is exactly the
  // `xz: -ry` embedTransform3 already writes. Pinned in both directions so a
  // later phase cannot flip either convention silently.

  it("agrees with rotationMatrix4's yz and xy factors sign for sign", () => {
    for (const angle of ANGLES) {
      expectSameMatrix(
        symmetryRotation("yz", angle),
        upper3(rotationMatrix4({ yz: angle })),
      );
      expectSameMatrix(
        symmetryRotation("xy", angle),
        upper3(rotationMatrix4({ xy: angle })),
      );
    }
  });

  it("is rotationMatrix4's xz factor at the NEGATED angle, not the same one", () => {
    for (const angle of ANGLES) {
      expectSameMatrix(
        symmetryRotation("xz", angle),
        upper3(rotationMatrix4({ xz: -angle })),
      );
    }
    // And genuinely differs from the un-negated factor, so the assertion
    // above is not vacuously true at some symmetric angle.
    const off = symmetryRotation("xz", 1.1);
    const same = upper3(rotationMatrix4({ xz: 1.1 }));
    expect(off[2]).toBeCloseTo(-same[2], 12);
    expect(off[2]).not.toBeCloseTo(same[2], 6);
  });

  it("refuses a w-plane, which has no 3x3", () => {
    for (const plane of ["xw", "yw", "zw"] as const) {
      expect(() => symmetryRotation(plane, 0.5)).toThrow(/mixes w/);
    }
  });
});

describe("prepareChaosGame symmetry planes", () => {
  it("refuses to expand a w-plane kaleidoscope, which has no 3x3", () => {
    expect(() =>
      prepareChaosGame(makeTransforms(2), null, { order: 3, plane: "yw" }),
    ).toThrow(/mixes w/);
  });

  it("accepts a w-plane at order 1, where no copy is ever rotated", () => {
    const prepared = prepareChaosGame(makeTransforms(2), null, {
      order: 1,
      plane: "yw",
    });
    expect(prepared.postRotations).toEqual([null, null]);
  });
});

describe("effectiveSymmetryOrder", () => {
  it("returns the requested order unchanged when it fits", () => {
    expect(effectiveSymmetryOrder(5, 10)).toBe(5);
  });

  it("reduces to the largest order that fits MAX_TRANSFORMS", () => {
    expect(effectiveSymmetryOrder(12, 30)).toBe(8); // floor(256 / 30) === 8
  });

  it("fits exactly at the issue's own Jerusalem Cube example (20 maps x 12-fold = 240 <= 256)", () => {
    expect(effectiveSymmetryOrder(12, 20)).toBe(12);
  });

  it("never returns less than 1, even when a single copy would already overflow", () => {
    expect(effectiveSymmetryOrder(1, 300)).toBe(1);
  });

  it("floors a fractional requested order", () => {
    expect(effectiveSymmetryOrder(3.9, 10)).toBe(3);
  });

  it("treats a non-finite request as 1 rather than propagating NaN", () => {
    expect(effectiveSymmetryOrder(NaN, 10)).toBe(1);
  });
});

describe("prepareChaosGame / stepOrbit with symmetry", () => {
  function fixedRng(value: number) {
    return () => value;
  }

  // Base map 0 is pure affine; base map 1 carries a (deterministic, RNG-free)
  // variation, so tests below can exercise "rotate the FULL output" against
  // both the affine-only and the affine+variation case.
  const twoMaps: Transform[] = [
    {
      id: 0,
      position: [0.1, 0.05, -0.05],
      rotation: [0.1, 0.2, 0.05],
      scale: [0.5, 0.5, 0.5],
    },
    {
      id: 1,
      position: [-0.1, 0.05, 0.1],
      rotation: [0, 0.1, 0.2],
      scale: [0.5, 0.5, 0.5],
      variations: [{ type: "swirl", weight: 1 }],
    },
  ];

  it("order 1 leaves the prepared system byte-identical to omitting symmetry, for any axis", () => {
    const withDefault = prepareChaosGame(twoMaps);
    const explicitOrderOne = prepareChaosGame(twoMaps, null, {
      order: 1,
      plane: "xy",
    });
    expect(explicitOrderOne.transformCount).toBe(withDefault.transformCount);
    expect(explicitOrderOne.baseTransformCount).toBe(
      withDefault.baseTransformCount,
    );
    expect(explicitOrderOne.affines).toEqual(withDefault.affines);
    expect(explicitOrderOne.postRotations).toEqual(withDefault.postRotations);
    expect(explicitOrderOne.postRotations.every((p) => p === null)).toBe(true);
  });

  it("expands to order * n slots, k-major, sharing each copy's base affine/variation by reference", () => {
    const prepared = prepareChaosGame(twoMaps, null, { order: 3, plane: "xz" });
    expect(prepared.transformCount).toBe(6);
    expect(prepared.baseTransformCount).toBe(2);
    // Copy 0 (slots 0-1) is always unrotated.
    expect(prepared.postRotations[0]).toBeNull();
    expect(prepared.postRotations[1]).toBeNull();
    // Copies 1 and 2 (slots 2-3, 4-5) are rotated, and reuse — not
    // recompute — their base map's composed affine/variation.
    expect(prepared.postRotations[2]).not.toBeNull();
    expect(prepared.postRotations[4]).not.toBeNull();
    expect(prepared.affines[2]).toBe(prepared.affines[0]);
    expect(prepared.affines[4]).toBe(prepared.affines[0]);
    expect(prepared.variations[3]).toBe(prepared.variations[1]);
  });

  it("clamps the effective order to fit MAX_TRANSFORMS, matching effectiveSymmetryOrder", () => {
    const transforms = makeTransforms(20);
    expect(effectiveSymmetryOrder(20, 20)).toBe(12);
    const prepared = prepareChaosGame(transforms, null, {
      order: 20,
      plane: "xz",
    });
    expect(prepared.transformCount).toBe(12 * 20);
  });

  it("rotates a slot's FULL affine+variation output, not just its affine (critical ordering)", () => {
    // transformCount = 6 for order 3 over 2 maps: slots [0,1]=k0, [2,3]=k1,
    // [4,5]=k2. Force the single pickIndex draw onto slot 3 (k=1, base map
    // 1 — the one with a variation) via a fixed rng() in [3/6, 4/6).
    const order = 3;
    const prepared = prepareChaosGame(twoMaps, null, { order, plane: "xz" });
    const rng = fixedRng(0.55); // floor(0.55 * 6) === 3
    const x = 0.2;
    const y = -0.15;
    const z = 0.1;

    const step = stepOrbit(prepared, x, y, z, rng);

    const baseAffine = composeAffine(twoMaps[1]);
    const warp = composeVariations(twoMaps[1].variations);
    if (warp === null) throw new Error("expected map 1 to have a variation");
    const [ax, ay, az] = applyAffine(baseAffine, x, y, z);
    const [fx, fy, fz] = warp(ax, ay, az, rng);
    const r = rotationMatrixXYZ(0, (2 * Math.PI * 1) / order, 0);
    const expectedX = r[0] * fx + r[1] * fy + r[2] * fz;
    const expectedY = r[3] * fx + r[4] * fy + r[5] * fz;
    const expectedZ = r[6] * fx + r[7] * fy + r[8] * fz;

    expect(step.x).toBeCloseTo(expectedX, 12);
    expect(step.y).toBeCloseTo(expectedY, 12);
    expect(step.z).toBeCloseTo(expectedZ, 12);
    // Recorded index is the BASE map (1), not the expanded slot (3).
    expect(step.index).toBe(1);
  });

  it("rotates a pure-affine slot's output too — post is never baked into the affine", () => {
    const order = 4;
    const prepared = prepareChaosGame(twoMaps, null, { order, plane: "xy" });
    // transformCount = 8: slots [0,1]=k0 [2,3]=k1 [4,5]=k2 [6,7]=k3. Force
    // slot 6 (k=3, base map 0 — pure affine) via rng() in [6/8, 7/8).
    const rng = fixedRng(0.8);
    const x = 0.2;
    const y = -0.1;
    const z = 0.05;

    const step = stepOrbit(prepared, x, y, z, rng);

    const baseAffine = composeAffine(twoMaps[0]);
    const [fx, fy, fz] = applyAffine(baseAffine, x, y, z);
    const r = rotationMatrixXYZ(0, 0, (2 * Math.PI * 3) / order);
    const expectedX = r[0] * fx + r[1] * fy + r[2] * fz;
    const expectedY = r[3] * fx + r[4] * fy + r[5] * fz;
    const expectedZ = r[6] * fx + r[7] * fy + r[8] * fz;

    expect(step.x).toBeCloseTo(expectedX, 12);
    expect(step.y).toBeCloseTo(expectedY, 12);
    expect(step.z).toBeCloseTo(expectedZ, 12);
    expect(step.index).toBe(0);
  });

  it("gives every copy an equal share of its base map's weight (3:1 stays 3:1)", () => {
    const weighted: Transform[] = [
      {
        id: 0,
        position: [0.3, 0, 0],
        rotation: [0, 0, 0],
        scale: [0.4, 0.4, 0.4],
        weight: 3,
      },
      {
        id: 1,
        position: [-0.3, 0, 0],
        rotation: [0, 0, 0],
        scale: [0.4, 0.4, 0.4],
        weight: 1,
      },
    ];
    const result = runChaosGame(weighted, 8000, mulberry32(5), null, {
      order: 4,
      plane: "xz",
    });
    let zero = 0;
    for (const idx of result.transformIndices) if (idx === 0) zero++;
    const share = zero / result.count;
    // Same 3:1 ratio as the unsymmetric weighting test ("draws maps in
    // proportion to their weights") — symmetry replicates geometry, not bias.
    expect(share).toBeGreaterThan(0.7);
    expect(share).toBeLessThan(0.8);
  });

  it("keeps every recorded transform index a valid BASE index, never an expanded slot", () => {
    const prepared = prepareChaosGame(sierpinskiTetrahedron(), null, {
      order: 5,
      plane: "yz",
    });
    const rng = mulberry32(21);
    let x = 0.1;
    let y = -0.1;
    let z = 0.2;
    for (let i = 0; i < 500; i++) {
      const s = stepOrbit(prepared, x, y, z, rng);
      expect(s.index).toBeGreaterThanOrEqual(0);
      expect(s.index).toBeLessThan(sierpinskiTetrahedron().length);
      x = s.x;
      y = s.y;
      z = s.z;
    }
  });

  it("keeps the whole cloud finite and produces a differently-shaped attractor than order 1", () => {
    const unsymmetric = runChaosGame(
      sierpinskiTetrahedron(),
      3000,
      mulberry32(3),
    );
    const symmetric = runChaosGame(
      sierpinskiTetrahedron(),
      3000,
      mulberry32(3),
      null,
      { order: 6, plane: "xz" },
    );
    for (const v of symmetric.positions) expect(Number.isFinite(v)).toBe(true);
    expect(Array.from(symmetric.positions)).not.toEqual(
      Array.from(unsymmetric.positions),
    );
  });
});

describe("runChaosGame vs. stepOrbit/plotPoint (allocation-free oracle)", () => {
  // runChaosGame's recording loop is hand-inlined (mirroring flame.ts's
  // accumulateFlame) to avoid allocating an OrbitStep object and two Vec3
  // arrays per point. This block pins that inlined loop against the real,
  // unmodified stepOrbit/plotPoint building blocks it must stay
  // byte-for-byte equivalent to — if the inlined copy ever drifts from the
  // real thing, one of the scenarios below catches it.
  //
  // referenceChaosGame is the oracle computation itself (the same loop shape
  // as the real stepOrbit/plotPoint building blocks, not runChaosGame's
  // hand-inlined version: seed x/y/z, warm up through the real stepOrbit,
  // then per point stepOrbit + plotPoint, bounds tracked with the same
  // Math.min/Math.max calls runChaosGame uses) — identical by construction
  // for every scenario, so it is shared
  // rather than re-typed five times; each scenario below still states its
  // own system/seed/point-count inline so it reads standalone.
  function referenceChaosGame(
    prepared: PreparedChaosGame,
    numPoints: number,
    rng: Rng,
  ): {
    positions: Float32Array;
    transformIndices: Uint8Array;
    bounds: Bounds;
  } {
    let x = rng() - 0.5;
    let y = rng() - 0.5;
    let z = rng() - 0.5;
    for (let i = 0; i < WARMUP_ITERATIONS; i++) {
      const s = stepOrbit(prepared, x, y, z, rng);
      x = s.x;
      y = s.y;
      z = s.z;
    }

    const positions = new Float32Array(numPoints * 3);
    const transformIndices = new Uint8Array(numPoints);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let minR = Infinity;
    let maxR = -Infinity;
    for (let i = 0; i < numPoints; i++) {
      const s = stepOrbit(prepared, x, y, z, rng);
      x = s.x;
      y = s.y;
      z = s.z;
      const [px, py, pz] = plotPoint(prepared, x, y, z, rng);
      positions[i * 3] = px;
      positions[i * 3 + 1] = py;
      positions[i * 3 + 2] = pz;
      transformIndices[i] = s.index;
      minX = Math.min(minX, px);
      maxX = Math.max(maxX, px);
      minY = Math.min(minY, py);
      maxY = Math.max(maxY, py);
      minZ = Math.min(minZ, pz);
      maxZ = Math.max(maxZ, pz);
      const r = Math.sqrt(px * px + py * py + pz * pz);
      minR = Math.min(minR, r);
      maxR = Math.max(maxR, r);
    }

    return {
      positions,
      transformIndices,
      bounds: { minX, maxX, minY, maxY, minZ, maxZ, minR, maxR },
    };
  }

  it("matches for a plain multi-transform system (no variations, no final transform)", () => {
    const transforms = sierpinskiTetrahedron();
    const numPoints = 800;
    const seed = 42;

    const actual = runChaosGame(transforms, numPoints, mulberry32(seed));
    const reference = referenceChaosGame(
      prepareChaosGame(transforms),
      numPoints,
      mulberry32(seed),
    );

    expect(Array.from(actual.positions)).toEqual(
      Array.from(reference.positions),
    );
    expect(Array.from(actual.transformIndices)).toEqual(
      Array.from(reference.transformIndices),
    );
    expect(actual.count).toBe(numPoints);
    expect(actual.bounds).toEqual(reference.bounds);
  });

  it("matches for a system with a variation on one transform (warp !== null branch)", () => {
    const transforms: Transform[] = [
      {
        id: 0,
        position: [0.3, 0.1, -0.2],
        rotation: [0.2, 0.4, 0.1],
        scale: [0.5, 0.5, 0.5],
        variations: [{ type: "swirl", weight: 1 }],
      },
      {
        id: 1,
        position: [-0.3, 0.2, 0.15],
        rotation: [0, 0.3, 0.5],
        scale: [0.5, 0.5, 0.5],
      },
    ];
    const numPoints = 600;
    const seed = 9;

    const actual = runChaosGame(transforms, numPoints, mulberry32(seed));
    const reference = referenceChaosGame(
      prepareChaosGame(transforms),
      numPoints,
      mulberry32(seed),
    );

    expect(Array.from(actual.positions)).toEqual(
      Array.from(reference.positions),
    );
    expect(Array.from(actual.transformIndices)).toEqual(
      Array.from(reference.transformIndices),
    );
    expect(actual.bounds).toEqual(reference.bounds);
  });

  it("matches for a system with a final-transform lens that itself has a variation (inlined plotPoint's affine+warp)", () => {
    const transforms = sierpinskiTetrahedron();
    const finalTransform: Transform = {
      id: 0,
      position: [0.2, -0.1, 0],
      rotation: [0, 0.3, 0],
      scale: [1.2, 1.2, 1.2],
      variations: [{ type: "julia", weight: 1 }],
    };
    const numPoints = 500;
    const seed = 7;

    const actual = runChaosGame(
      transforms,
      numPoints,
      mulberry32(seed),
      finalTransform,
    );
    const reference = referenceChaosGame(
      prepareChaosGame(transforms, finalTransform),
      numPoints,
      mulberry32(seed),
    );

    expect(Array.from(actual.positions)).toEqual(
      Array.from(reference.positions),
    );
    expect(Array.from(actual.transformIndices)).toEqual(
      Array.from(reference.transformIndices),
    );
    expect(actual.bounds).toEqual(reference.bounds);
  });

  it("matches for a system with symmetry order > 1 (postRotations branch)", () => {
    const transforms: Transform[] = [
      {
        id: 0,
        position: [0.1, 0.05, -0.05],
        rotation: [0.1, 0.2, 0.05],
        scale: [0.5, 0.5, 0.5],
      },
      {
        id: 1,
        position: [-0.1, 0.05, 0.1],
        rotation: [0, 0.1, 0.2],
        scale: [0.5, 0.5, 0.5],
        variations: [{ type: "swirl", weight: 1 }],
      },
    ];
    const symmetry = { order: 3, plane: "xz" } as const;
    const numPoints = 700;
    const seed = 21;

    const actual = runChaosGame(
      transforms,
      numPoints,
      mulberry32(seed),
      null,
      symmetry,
    );
    const reference = referenceChaosGame(
      prepareChaosGame(transforms, null, symmetry),
      numPoints,
      mulberry32(seed),
    );

    expect(Array.from(actual.positions)).toEqual(
      Array.from(reference.positions),
    );
    expect(Array.from(actual.transformIndices)).toEqual(
      Array.from(reference.transformIndices),
    );
    expect(actual.bounds).toEqual(reference.bounds);
  });

  it("matches for a weighted system (pickIndex's weighted path)", () => {
    const transforms: Transform[] = [
      {
        id: 0,
        position: [0.5, 0, 0],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0.5],
        weight: 3,
      },
      {
        id: 1,
        position: [-0.5, 0, 0],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0.5],
        weight: 1,
      },
    ];
    const numPoints = 900;
    const seed = 5;

    const actual = runChaosGame(transforms, numPoints, mulberry32(seed));
    const reference = referenceChaosGame(
      prepareChaosGame(transforms),
      numPoints,
      mulberry32(seed),
    );

    expect(Array.from(actual.positions)).toEqual(
      Array.from(reference.positions),
    );
    expect(Array.from(actual.transformIndices)).toEqual(
      Array.from(reference.transformIndices),
    );
    expect(actual.bounds).toEqual(reference.bounds);
  });
});

describe("iteration-local randomness isolation", () => {
  // A fixture exercising every way ε-different runs can desynchronize a
  // SHARED stream: map 0's non-1 weight forces the weighted pick path (an
  // ε weight change flips occasional picks across cumulative boundaries),
  // map 1's `julia` draws a coin per application (a flipped pick lands on a
  // differently-drawing map), and map 2's `spherical` diverges near the
  // origin (the escape-reseed safety net fires occasionally). The system
  // stays contractive on average, so two orbits driven by the same pick
  // sequence re-converge geometrically — which is what makes per-point
  // correspondence possible at all.
  function gauntletSystem(weight0 = 2, aPosX = 0.5): Transform[] {
    return [
      {
        id: 0,
        position: [aPosX, 0.5, 0.5],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0.5],
        weight: weight0,
      },
      {
        id: 1,
        position: [-0.5, -0.5, -0.5],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0.5],
        variations: [
          { type: "linear", weight: 1 },
          { type: "julia", weight: 0.3 },
        ],
      },
      {
        id: 2,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [0.6, 0.6, 0.6],
        variations: [{ type: "spherical", weight: 1 }],
      },
    ];
  }

  it("shares one stream when iterationRng is omitted — the original behavior", () => {
    // Without an iterationRng, julia's coin flips and the escape reseeds
    // draw from the primary stream: its consumption exceeds the rigid
    // one-draw-per-pick floor. (The floor itself: 3 seed draws + one pick
    // per warmup and recorded iteration.)
    const numPoints = 4000;
    let draws = 0;
    const inner = mulberry32(5);
    const primary: Rng = () => {
      draws++;
      return inner();
    };

    runChaosGame(gauntletSystem(), numPoints, primary);

    expect(draws).toBeGreaterThan(3 + WARMUP_ITERATIONS + numPoints);
  });

  it("keeps the primary stream rigid — one draw per pick — when an iterationRng is provided", () => {
    const numPoints = 4000;
    let primaryDraws = 0;
    const inner = mulberry32(5);
    const primary: Rng = () => {
      primaryDraws++;
      return inner();
    };
    let auxDraws = 0;
    const iter = iterationRng(1234);
    const countingIter: IterationRng = {
      begin: (i) => iter.begin(i),
      draw: () => {
        auxDraws++;
        return iter.draw();
      },
    };

    runChaosGame(
      gauntletSystem(),
      numPoints,
      primary,
      null,
      undefined,
      countingIter,
    );

    // 3 draws seed the initial point, then exactly one pick per warmup and
    // recorded iteration — no matter how often julia flipped its coin or the
    // orbit escaped: those land on the iteration stream instead.
    expect(primaryDraws).toBe(3 + WARMUP_ITERATIONS + numPoints);
    expect(auxDraws).toBeGreaterThan(0);
  });

  it("keeps ε-different runs point-for-point correspondent (the morph-flow guarantee)", () => {
    // Two samples one morph frame apart differ by a tiny weight + position
    // step. With iteration-local randomness, the pick streams stay aligned
    // and every iteration rolls its own dice, so a differing escape or a
    // weight-boundary pick flip perturbs only its short contraction wake.
    // On the shared stream the first differing draw shifts every later pick
    // and re-rolls the whole remaining cloud. Measured on this fixture:
    // ~2% displaced when isolated vs ~90% shared.
    const numPoints = 20_000;
    const jumpedFraction = (a: Float32Array, b: Float32Array): number => {
      let jumped = 0;
      for (let i = 0; i < numPoints; i++) {
        const dx = a[i * 3] - b[i * 3];
        const dy = a[i * 3 + 1] - b[i * 3 + 1];
        const dz = a[i * 3 + 2] - b[i * 3 + 2];
        if (Math.hypot(dx, dy, dz) > 0.3) jumped++;
      }
      return jumped / numPoints;
    };

    const isolated = jumpedFraction(
      runChaosGame(
        gauntletSystem(2, 0.5),
        numPoints,
        mulberry32(5),
        null,
        undefined,
        iterationRng(1234),
      ).positions,
      runChaosGame(
        gauntletSystem(2.01, 0.502),
        numPoints,
        mulberry32(5),
        null,
        undefined,
        iterationRng(1234),
      ).positions,
    );
    const shared = jumpedFraction(
      runChaosGame(gauntletSystem(2, 0.5), numPoints, mulberry32(5)).positions,
      runChaosGame(gauntletSystem(2.01, 0.502), numPoints, mulberry32(5))
        .positions,
    );

    expect(isolated).toBeLessThan(0.15);
    expect(shared).toBeGreaterThan(0.5);
  });
});

describe("symmetry blend", () => {
  // An attractor pinned strictly to +x, so an order-2 y-axis kaleidoscope's
  // rotated copy lands strictly in -x: the share of points at x < 0 reads
  // the copies' selection share directly.
  function offAxisSystem(): Transform[] {
    return [
      {
        id: 0,
        position: [1, 0.2, 0],
        rotation: [0, 0, 0],
        scale: [0.4, 0.4, 0.4],
      },
      {
        id: 1,
        position: [1, -0.2, 0],
        rotation: [0, 0, 0],
        scale: [0.4, 0.4, 0.4],
      },
    ];
  }

  function negativeXShare(order: number, blend?: number): number {
    const result = runChaosGame(offAxisSystem(), 6000, mulberry32(11), null, {
      order,
      plane: "xz",
      ...(blend === undefined ? {} : { blend }),
    });
    let negative = 0;
    for (let i = 0; i < result.count; i++) {
      if (result.positions[i * 3] < 0) negative++;
    }
    return negative / result.count;
  }

  it("renders blend 0 bit-identically to order 1", () => {
    const faded = runChaosGame(offAxisSystem(), 3000, mulberry32(3), null, {
      order: 5,
      plane: "xz",
      blend: 0,
    });
    const orderOne = runChaosGame(offAxisSystem(), 3000, mulberry32(3));
    expect(faded.positions).toEqual(orderOne.positions);
    expect(faded.transformIndices).toEqual(orderOne.transformIndices);
    expect(faded.bounds).toEqual(orderOne.bounds);
  });

  it("renders blend 1 identically to an absent blend — the full kaleidoscope", () => {
    const explicit = runChaosGame(offAxisSystem(), 3000, mulberry32(3), null, {
      order: 5,
      plane: "xz",
      blend: 1,
    });
    const absent = runChaosGame(offAxisSystem(), 3000, mulberry32(3), null, {
      order: 5,
      plane: "xz",
    });
    expect(explicit.positions).toEqual(absent.positions);
    expect(explicit.transformIndices).toEqual(absent.transformIndices);
  });

  it("thins the rotated copies' point share continuously between those ends", () => {
    // Order 2: the copy's share of points is blend / (1 + blend) — 1/2 at
    // full strength, 1/3 at half, 0 when faded out.
    expect(negativeXShare(2, undefined)).toBeCloseTo(0.5, 1);
    expect(negativeXShare(2, 0.5)).toBeCloseTo(1 / 3, 1);
    expect(negativeXShare(2, 0)).toBe(0);
  });

  it("clamps blend outside 0..1 instead of corrupting the weight table", () => {
    const over = runChaosGame(offAxisSystem(), 2000, mulberry32(7), null, {
      order: 3,
      plane: "xz",
      blend: 7,
    });
    const full = runChaosGame(offAxisSystem(), 2000, mulberry32(7), null, {
      order: 3,
      plane: "xz",
    });
    expect(over.positions).toEqual(full.positions);

    const under = runChaosGame(offAxisSystem(), 2000, mulberry32(7), null, {
      order: 3,
      plane: "xz",
      blend: -2,
    });
    const off = runChaosGame(offAxisSystem(), 2000, mulberry32(7));
    expect(under.positions).toEqual(off.positions);
  });
});

describe("graph-directed selection (chaos rows)", () => {
  // A weighted 3-map contractive affine system (no variations, so the orbit
  // never escapes and every rng draw is a pick) whose chi rows are easy to
  // reason about. Row semantics: chi[i][j] scales P(pick base j | prev base
  // i) alongside the weights.
  function chiSystem(): Transform[] {
    return [
      {
        id: 0,
        position: [0.6, 0.4, 0.1],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0.5],
        weight: 1,
        chaos: [1, 0.5, 2],
      },
      {
        id: 1,
        position: [-0.5, 0.3, -0.4],
        rotation: [0, 0.2, 0],
        scale: [0.45, 0.45, 0.45],
        weight: 2,
        chaos: [2, 1, 0],
      },
      {
        id: 2,
        position: [0.1, -0.6, 0.4],
        rotation: [0.1, 0, 0.3],
        scale: [0.5, 0.5, 0.5],
        weight: 1,
        // No row: reads all-1s — an absent row must select exactly like the
        // global table from this map.
      },
    ];
  }

  it("chaosRowIsNonTrivial pads/truncates to the base count with 1s and resolves the domain", () => {
    // Absent, all-1s, and short-but-all-1s rows are all trivial.
    expect(chaosRowIsNonTrivial(undefined, 3)).toBe(false);
    expect(chaosRowIsNonTrivial([1, 1, 1], 3)).toBe(false);
    expect(chaosRowIsNonTrivial([1, 1], 4)).toBe(false);
    // A deviation past the base count is truncated away — trivial.
    expect(chaosRowIsNonTrivial([1, 1, 1, 7], 3)).toBe(false);
    // A non-finite entry reads as 1 (defense; persist drops such rows).
    expect(chaosRowIsNonTrivial([Number.NaN, 1], 2)).toBe(false);
    // A real deviation anywhere inside the base count is non-trivial...
    expect(chaosRowIsNonTrivial([0.5], 2)).toBe(true);
    expect(chaosRowIsNonTrivial([1, 1, 0], 3)).toBe(true);
    // ...including a negative one, which clamps to 0 (0 !== 1).
    expect(chaosRowIsNonTrivial([1, -0.5], 2)).toBe(true);
  });

  it("systemHasChaos is true exactly when some transform carries a non-trivial row", () => {
    const plain = makeTransforms(3);
    expect(systemHasChaos(plain)).toBe(false);
    expect(systemHasChaos(plain.map((t) => ({ ...t, chaos: [1, 1, 1] })))).toBe(
      false,
    );
    expect(systemHasChaos(chiSystem())).toBe(true);
  });

  it("is byte-identical to a chaos-free run — same draw count, same output — at absent AND at explicit all-1s chi", () => {
    const numPoints = 6000;
    const base = gauntletChiFixture();
    const withTrivialChi = base.map((t) => ({
      ...t,
      chaos: [1, 1, 1],
    }));

    const countingRun = (transforms: Transform[]) => {
      let draws = 0;
      const inner = mulberry32(11);
      const spy: Rng = () => {
        draws++;
        return inner();
      };
      const result = runChaosGame(transforms, numPoints, spy);
      return { draws, result };
    };

    const plain = countingRun(base);
    const trivial = countingRun(withTrivialChi);

    expect(trivial.draws).toBe(plain.draws);
    expect(Array.from(trivial.result.positions)).toEqual(
      Array.from(plain.result.positions),
    );
    expect(Array.from(trivial.result.transformIndices)).toEqual(
      Array.from(plain.result.transformIndices),
    );
    expect(trivial.result.bounds).toEqual(plain.result.bounds);
  });

  // The byte-identity fixture: weighted + a stochastic variation + an
  // occasional escape, so "same draw count" covers every draw source, not
  // just picks. Named apart from the iteration-rng block's gauntletSystem
  // (scoped to that describe) but shaped like it.
  function gauntletChiFixture(): Transform[] {
    return [
      {
        id: 0,
        position: [0.5, 0.5, 0.5],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0.5],
        weight: 2,
      },
      {
        id: 1,
        position: [-0.5, -0.5, -0.5],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0.5],
        variations: [
          { type: "linear", weight: 1 },
          { type: "julia", weight: 0.3 },
        ],
      },
      {
        id: 2,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [0.6, 0.6, 0.6],
        variations: [{ type: "spherical", weight: 1 }],
      },
    ];
  }

  it("spends exactly one primary draw per pick and 3 aux draws per re-fuse (iterationRng draw accounting)", () => {
    // Plain affine chi system: no variation/escape draws, so the counts
    // are exact. 10000 points crosses two sub-orbit boundaries (4096, 8192);
    // each re-fuse is 3 aux seed draws + WARMUP_ITERATIONS picks.
    const numPoints = 10_000;
    const refuses = 2;
    let primaryDraws = 0;
    const inner = mulberry32(5);
    const primary: Rng = () => {
      primaryDraws++;
      return inner();
    };
    let auxDraws = 0;
    const iter = iterationRng(1234);
    const countingIter: IterationRng = {
      begin: (i) => iter.begin(i),
      draw: () => {
        auxDraws++;
        return iter.draw();
      },
    };

    runChaosGame(
      chiSystem(),
      numPoints,
      primary,
      null,
      undefined,
      countingIter,
    );

    expect(primaryDraws).toBe(
      3 + WARMUP_ITERATIONS + numPoints + refuses * WARMUP_ITERATIONS,
    );
    expect(auxDraws).toBe(refuses * 3);
  });

  it("matches a reference loop driving stepOrbit/plotPoint by hand under chi — weighted, kaleidoscope order 2, escapes, and a sub-orbit boundary inside the run", () => {
    // The chi twin of the allocation-free oracle: runChaosGame's inlined
    // loop (prevBase threading, escape re-fuse, the sub-orbit re-fuse
    // block) must stay byte-for-byte what the real stepOrbit/plotPoint
    // building blocks produce when a caller threads selection state per
    // their documented contract. gauntletChiFixture escapes occasionally
    // (spherical near the origin) so the escaped -> entry-pick path is
    // genuinely walked; 6000 points crosses the 4096 boundary once.
    const transforms = gauntletChiFixture().map((t, i) => ({
      ...t,
      chaos: [
        [1, 0.25, 1.5],
        [2, 1, 1],
        [1, 1, 1],
      ][i],
    }));
    const symmetry: SymmetryParams = { order: 2, plane: "xz" };
    const numPoints = 6000;
    const seed = 77;

    const actual = runChaosGame(
      transforms,
      numPoints,
      mulberry32(seed),
      null,
      symmetry,
    );

    const prepared = prepareChaosGame(transforms, null, symmetry);
    const rng = mulberry32(seed);
    let x = rng() - 0.5;
    let y = rng() - 0.5;
    let z = rng() - 0.5;
    let prevBase = -1;
    for (let i = 0; i < WARMUP_ITERATIONS; i++) {
      const s = stepOrbit(prepared, x, y, z, rng, rng, prevBase);
      x = s.x;
      y = s.y;
      z = s.z;
      prevBase = s.escaped ? -1 : s.index;
    }
    const positions = new Float32Array(numPoints * 3);
    const transformIndices = new Uint8Array(numPoints);
    for (let i = 0; i < numPoints; i++) {
      if (i > 0 && i % CHAOS_SUB_ORBIT_POINTS === 0) {
        x = rng() - 0.5;
        y = rng() - 0.5;
        z = rng() - 0.5;
        prevBase = -1;
        for (let k = 0; k < WARMUP_ITERATIONS; k++) {
          const s = stepOrbit(prepared, x, y, z, rng, rng, prevBase);
          x = s.x;
          y = s.y;
          z = s.z;
          prevBase = s.escaped ? -1 : s.index;
        }
      }
      const s = stepOrbit(prepared, x, y, z, rng, rng, prevBase);
      x = s.x;
      y = s.y;
      z = s.z;
      prevBase = s.escaped ? -1 : s.index;
      const [px, py, pz] = plotPoint(prepared, x, y, z, rng);
      positions[i * 3] = px;
      positions[i * 3 + 1] = py;
      positions[i * 3 + 2] = pz;
      transformIndices[i] = s.index;
    }

    expect(Array.from(actual.positions)).toEqual(Array.from(positions));
    expect(Array.from(actual.transformIndices)).toEqual(
      Array.from(transformIndices),
    );
  });

  it("draws transitions with empirical P(j | i) proportional to w_j * chi_ij, kaleidoscope copies included", () => {
    // The transition histogram over recorded consecutive picks. Order-2
    // kaleidoscope: both copies of base j inherit its chi column, so
    // P(base j | i) stays proportional to w_j * chi_ij at any order.
    // Sub-orbit boundaries are excluded — the pick at a boundary is an
    // ENTRY pick, not a transition. chiSystem never escapes (pure affine
    // contractions), so no other exclusions apply.
    const transforms = chiSystem();
    const numPoints = 200_000;
    const result = runChaosGame(transforms, numPoints, mulberry32(99), null, {
      order: 2,
      plane: "xz",
    });

    const weights = transforms.map((t) => t.weight ?? 1);
    const counts = [0, 1, 2].map(() => [0, 0, 0]);
    for (let i = 1; i < numPoints; i++) {
      if (i % CHAOS_SUB_ORBIT_POINTS === 0) continue;
      counts[result.transformIndices[i - 1]][result.transformIndices[i]]++;
    }
    for (let from = 0; from < 3; from++) {
      const chi = transforms[from].chaos ?? [1, 1, 1];
      const expected = weights.map((w, j) => w * (chi[j] ?? 1));
      const expectedTotal = expected.reduce((a, b) => a + b, 0);
      const observedTotal = counts[from].reduce((a, b) => a + b, 0);
      expect(observedTotal).toBeGreaterThan(10_000);
      for (let to = 0; to < 3; to++) {
        const expectedP = expected[to] / expectedTotal;
        const observedP = counts[from][to] / observedTotal;
        expect(Math.abs(observedP - expectedP)).toBeLessThan(0.02);
      }
    }
    // The zeroed edge (map 1 -> map 2) is EXACTLY never drawn, not merely
    // rare — the cumulative row gives it zero width.
    expect(counts[1][2]).toBe(0);
  });

  it("keeps block-diagonal blocks isolated while the sub-orbit re-fuse still samples both (the fern|sponge invariant)", () => {
    // The shipped isolated preset: fern maps 0..3, sponge maps 4..23. Zero
    // cross-block CONSECUTIVE transitions (entry picks at sub-orbit
    // boundaries excluded; the fern/sponge maps are contractive, so no
    // escape-reseed exclusion is ever needed) — AND both blocks receive
    // plotted points, which is the sub-orbit design's whole reason to
    // exist: one orbit never leaves its block, so without re-fusing the
    // cloud would be one object, not two.
    const transforms = fernSpongeIsolated();
    const numPoints = 30_000;
    const result = runChaosGame(transforms, numPoints, mulberry32(3));

    const fernCount = 4;
    let fernPoints = 0;
    let spongePoints = 0;
    let crossings = 0;
    for (let i = 0; i < numPoints; i++) {
      const inFern = result.transformIndices[i] < fernCount;
      if (inFern) fernPoints++;
      else spongePoints++;
      if (i === 0 || i % CHAOS_SUB_ORBIT_POINTS === 0) continue;
      const prevInFern = result.transformIndices[i - 1] < fernCount;
      if (inFern !== prevInFern) crossings++;
    }
    expect(crossings).toBe(0);
    expect(fernPoints).toBeGreaterThan(0);
    expect(spongePoints).toBeGreaterThan(0);
  });

  it("falls back to the global table for a degenerate (all-zero-total) row, one draw either way", () => {
    // Map 0's row weights to zero total; a draw from prevBase 0 must land
    // exactly where the global table would land the same rng value, and
    // the prepared object records the row for the UI's future disclosure.
    const transforms = chiSystem().map((t, i) =>
      i === 0 ? { ...t, chaos: [0, 0, 0] } : t,
    );
    const prepared = prepareChaosGame(transforms);
    expect(prepared.chaosFallbackRows).toEqual([0]);

    for (const draw of [0.01, 0.3, 0.6, 0.99]) {
      const fixed: Rng = () => draw;
      expect(pickIndex(prepared, fixed, 0)).toBe(pickIndex(prepared, fixed));
    }
  });

  it("keeps ε-different chi runs point-for-point correspondent under a pinned iterationRng seed", () => {
    // The morph-flow guarantee under chi: iteration numbering is a pure
    // function of the plotted-point index (chaosPointIteration), so an
    // ε-different weight — or a chi entry edit — decorrelates no worse
    // than it does chaos-free. Compare against the shared-stream runs,
    // which re-roll the whole remaining cloud after the first divergence.
    const numPoints = 20_000;
    const system = (w0: number, chi01: number): Transform[] =>
      gauntletChiFixture().map((t, i) =>
        i === 0
          ? { ...t, weight: w0, chaos: [1, chi01, 1.5] }
          : { ...t, chaos: [2, 1, 1][i] === 2 ? [2, 1, 1] : [1, 1, 1] },
      );
    const jumpedFraction = (a: Float32Array, b: Float32Array): number => {
      let jumped = 0;
      for (let i = 0; i < numPoints; i++) {
        const dx = a[i * 3] - b[i * 3];
        const dy = a[i * 3 + 1] - b[i * 3 + 1];
        const dz = a[i * 3 + 2] - b[i * 3 + 2];
        if (Math.hypot(dx, dy, dz) > 0.3) jumped++;
      }
      return jumped / numPoints;
    };

    const isolated = jumpedFraction(
      runChaosGame(
        system(2, 0.5),
        numPoints,
        mulberry32(5),
        null,
        undefined,
        iterationRng(1234),
      ).positions,
      runChaosGame(
        system(2.01, 0.502),
        numPoints,
        mulberry32(5),
        null,
        undefined,
        iterationRng(1234),
      ).positions,
    );
    const shared = jumpedFraction(
      runChaosGame(system(2, 0.5), numPoints, mulberry32(5)).positions,
      runChaosGame(system(2.01, 0.502), numPoints, mulberry32(5)).positions,
    );

    expect(isolated).toBeLessThan(0.15);
    expect(shared).toBeGreaterThan(0.5);
  });
});

describe("scheduled hybrids: the post-word stage", () => {
  // A one-map system whose attractor IS its fixed point: scale 0 sends every
  // orbit point straight to `position`, so the plotted support isolates the
  // post-word's arrangement exactly (and doubles as the proof the post-word
  // never feeds back into the orbit — a fed-back word would wander the
  // orbit over B's whole attractor instead of leaving one fixed point).
  function pointSystem(p: [number, number, number]): Transform[] {
    return [{ id: 0, position: p, rotation: [0, 0, 0], scale: [0, 0, 0] }];
  }

  // System B: two half-scale contractions offset along x — the level-k
  // arrangement is 2^k exactly-enumerable images.
  function pairB(): Transform[] {
    return [
      {
        id: 0,
        position: [-0.5, 0, 0],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0.5],
      },
      {
        id: 1,
        position: [0.5, 0, 0],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0.5],
      },
    ];
  }

  function countingRng(seed: number): { rng: Rng; count: () => number } {
    const inner = mulberry32(seed);
    let n = 0;
    return {
      rng: () => {
        n++;
        return inner();
      },
      count: () => n,
    };
  }

  it("absent/depth-0 schedule is byte-identical: same stream, same output, zero extra draws", () => {
    const transforms = sierpinskiTetrahedron();
    const base = countingRng(7);
    const baseline = runChaosGame(transforms, 500, base.rng);

    const explicitNull = countingRng(7);
    const withNull = runChaosGame(
      transforms,
      500,
      explicitNull.rng,
      null,
      undefined,
      undefined,
      null,
    );
    expect(withNull.positions).toEqual(baseline.positions);
    expect(explicitNull.count()).toBe(base.count());

    // A depth-0 block is ABSENT by the one consumption domain
    // (resolveScheduleDepth) — same stream, same bytes, zero draws.
    const deadBlock = countingRng(7);
    const withDead = runChaosGame(
      transforms,
      500,
      deadBlock.rng,
      null,
      undefined,
      undefined,
      { transforms: pairB(), depth: 0 },
    );
    expect(withDead.positions).toEqual(baseline.positions);
    expect(deadBlock.count()).toBe(base.count());
  });

  it("a present block draws exactly depth extra primary draws per plotted point", () => {
    // Contractive, variation-free, unweighted system: no escapes and no
    // iteration-local draws, so the whole primary stream is 3 (seed) +
    // WARMUP + N picks — and with the block, + N * depth schedule picks.
    const transforms = sierpinskiTetrahedron();
    const n = 400;
    const base = countingRng(11);
    runChaosGame(transforms, n, base.rng);
    const baselineDraws = base.count();
    expect(baselineDraws).toBe(3 + WARMUP_ITERATIONS + n);

    for (const depth of [1, 3]) {
      const counted = countingRng(11);
      runChaosGame(transforms, n, counted.rng, null, undefined, undefined, {
        transforms: pairB(),
        depth,
      });
      expect(counted.count()).toBe(baselineDraws + n * depth);
    }
  });

  it("plots the depth-k B-arrangement of A's attractor (support matches the 2^k word images, both directions)", () => {
    const q: [number, number, number] = [0.2, 0.1, 0.3];
    const depth = 3;
    const bAffines = pairB().map(composeAffine);
    // Every word image s_w(q), |w| = k — the expected support.
    let images: [number, number, number][] = [q];
    for (let level = 0; level < depth; level++) {
      images = images.flatMap((p) =>
        bAffines.map((a) => {
          const r = applyAffine(a, p[0], p[1], p[2]);
          return [r[0], r[1], r[2]] as [number, number, number];
        }),
      );
    }
    expect(images).toHaveLength(2 ** depth);

    const result = runChaosGame(
      pointSystem(q),
      2000,
      mulberry32(21),
      null,
      undefined,
      undefined,
      { transforms: pairB(), depth },
    );
    const hit = new Array<boolean>(images.length).fill(false);
    for (let i = 0; i < result.count; i++) {
      const px = result.positions[i * 3];
      const py = result.positions[i * 3 + 1];
      const pz = result.positions[i * 3 + 2];
      let best = -1;
      for (let j = 0; j < images.length; j++) {
        const [ix, iy, iz] = images[j];
        if (
          Math.abs(px - ix) < 1e-5 &&
          Math.abs(py - iy) < 1e-5 &&
          Math.abs(pz - iz) < 1e-5
        ) {
          best = j;
          break;
        }
      }
      // Every plotted point IS one of the word images (within Float32
      // storage rounding)...
      expect(best).toBeGreaterThanOrEqual(0);
      hit[best] = true;
    }
    // ...and every word image is realized (2000 points over 8 uniform
    // cells cannot plausibly miss one).
    expect(hit.every(Boolean)).toBe(true);
  });

  it("plotPoint applies the post-word BEFORE the lens", () => {
    const lens: Transform = {
      id: 0,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [2, 2, 2],
    };
    // One B map (uniform pick over one entry is deterministic): translate
    // by [1, 0, 0].
    const prepared = prepareChaosGame(
      pointSystem([0, 0, 0]),
      lens,
      { order: 1, plane: "xz" },
      {
        transforms: [
          {
            id: 0,
            position: [1, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
          },
        ],
        depth: 1,
      },
    );
    // lens(B([0.25, 0.5, 0.75])) = 2 * ([0.25, 0.5, 0.75] + [1, 0, 0]).
    expect(plotPoint(prepared, 0.25, 0.5, 0.75, mulberry32(1))).toEqual([
      2.5, 1, 1.5,
    ]);
  });

  it("a non-finite word falls back to the pre-word point while still consuming its draws", () => {
    const overflow: Transform = {
      id: 0,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1e308, 1e308, 1e308],
    };
    const prepared = prepareChaosGame(
      pointSystem([0, 0, 0]),
      null,
      { order: 1, plane: "xz" },
      { transforms: [overflow], depth: 2 },
    );
    const counted = countingRng(3);
    // 1e308 * 1e308 overflows to Infinity at level 2 — the word is
    // discarded, the pre-word point survives, and both picks still drew
    // (the draw count must be a pure function of the document).
    expect(plotPoint(prepared, 0.5, 0.25, 0.125, counted.rng)).toEqual([
      0.5, 0.25, 0.125,
    ]);
    expect(counted.count()).toBe(2);
  });

  it("prepareChaosGame resolves the schedule through the one consumption domain", () => {
    const none = prepareChaosGame(pointSystem([0, 0, 0]));
    expect(none.schedule).toBeNull();

    const empty = prepareChaosGame(pointSystem([0, 0, 0]), null, undefined, {
      transforms: [],
      depth: 3,
    });
    expect(empty.schedule).toBeNull();

    // Depth clamps into 1..MAX_SCHEDULE_DEPTH (floor first: 2.9 -> 2).
    const clamped = prepareChaosGame(pointSystem([0, 0, 0]), null, undefined, {
      transforms: pairB(),
      depth: 99,
    });
    expect(clamped.schedule?.depth).toBe(MAX_SCHEDULE_DEPTH);
    const floored = prepareChaosGame(pointSystem([0, 0, 0]), null, undefined, {
      transforms: pairB(),
      depth: 2.9,
    });
    expect(floored.schedule?.depth).toBe(2);
  });

  it("pickScheduleIndex follows pickIndex's uniform/weighted conventions at one draw each", () => {
    const uniform = prepareChaosGame(pointSystem([0, 0, 0]), null, undefined, {
      transforms: [...pairB(), ...pairB()].map((t, id) => ({ ...t, id })),
      depth: 1,
    }).schedule!;
    expect(uniform.weighted).toBe(false);
    // Uniform fast path: floor(r * count), one draw.
    expect(pickScheduleIndex(uniform, () => 0.7)).toBe(2);

    const weighted = prepareChaosGame(pointSystem([0, 0, 0]), null, undefined, {
      transforms: [
        { ...pairB()[0], weight: 1 },
        { ...pairB()[1], weight: 3 },
      ],
      depth: 1,
    }).schedule!;
    expect(weighted.weighted).toBe(true);
    expect(weighted.totalWeight).toBe(4);
    // Lower-bound search over cumulative [1, 4]: r * 4 = 0.8 -> index 0;
    // r * 4 = 1.2 -> index 1. One draw each (the fns below ARE the draw).
    expect(pickScheduleIndex(weighted, () => 0.2)).toBe(0);
    expect(pickScheduleIndex(weighted, () => 0.3)).toBe(1);
  });
});

describe("shape emitters (condensation)", () => {
  const SPHERE_SPEC: ShapeSpec = {
    parts: [{ primitive: { kind: "sphere", radius: 0.5 }, combine: "union" }],
  };
  const INTERSECT_SPEC: ShapeSpec = {
    parts: [
      { primitive: { kind: "sphere", radius: 0.5 }, combine: "union" },
      {
        primitive: { kind: "box", half: [0.4, 0.4, 0.4] },
        combine: "intersect",
      },
    ],
  };

  /** One ordinary contraction plus one emitter map — the smallest
   * condensation system. */
  function emitterSystem(
    weight = 1,
    spec: ShapeSpec = SPHERE_SPEC,
  ): Transform[] {
    return [
      {
        id: 0,
        position: [0.4, 0.4, 0.4],
        rotation: [0, 0.3, 0],
        scale: [0.5, 0.5, 0.5],
      },
      {
        id: 1,
        position: [0.2, -0.1, 0],
        rotation: [0, 0, 0.4],
        scale: [0.6, 0.6, 0.6],
        weight,
        emitter: spec,
      },
    ];
  }

  it("keys transformHasEmitter/systemHasEmitters on PRESENCE — empty parts read absent", () => {
    expect(transformHasEmitter(emitterSystem()[1])).toBe(true);
    expect(transformHasEmitter(emitterSystem()[0])).toBe(false);
    expect(transformHasEmitter({ emitter: { parts: [] } })).toBe(false);
    expect(systemHasEmitters(emitterSystem())).toBe(true);
    expect(systemHasEmitters(makeTransforms(3))).toBe(false);
    // A weight-0 emitter still counts (the conservative line the predicate
    // documents).
    const zeroWeight = emitterSystem(0);
    expect(systemHasEmitters(zeroWeight)).toBe(true);
  });

  it("prepares one sampler per emitter-carrying BASE map, and null without any", () => {
    const prepared = prepareChaosGame(emitterSystem());
    expect(prepared.emitters).not.toBeNull();
    expect(prepared.emitters![0]).toBeNull();
    expect(prepared.emitters![1]).not.toBeNull();
    expect(prepareChaosGame(makeTransforms(3)).emitters).toBeNull();
  });

  it("createEmitterStream reproduces mulberry32(seed)'s sequence after every reseed", () => {
    const stream = createEmitterStream();
    for (const seed of [0, 1, 0x9ea2c0f5, 4294967295]) {
      stream.reseed(seed);
      const reference = mulberry32(seed);
      for (let i = 0; i < 8; i++) {
        expect(stream.draw()).toBe(reference());
      }
    }
  });

  it("emits the transform's posed shape sample — incoming point and variations both ignored, exactly one primary draw beyond the pick", () => {
    // The emitter also carries a julia variation, which would flip aux
    // coins if it ran; the emitted point must be the affine of the sample
    // alone, and the aux stream must stay untouched.
    const transforms = emitterSystem();
    transforms[1].variations = [{ type: "julia", weight: 1 }];
    const prepared = prepareChaosGame(transforms);

    // Drive the pick onto the emitter slot (index 1 of 2 base maps).
    const primary: number[] = [0.9, 0.123456];
    let primaryAt = 0;
    const rng: Rng = () => primary[primaryAt++];
    let auxDraws = 0;
    const aux: Rng = () => {
      auxDraws++;
      return 0.5;
    };
    const step = stepOrbit(prepared, 9, -9, 9, rng, aux);

    const seed = (0.123456 * 0x100000000) >>> 0;
    const sample = prepareShapeSampler(SPHERE_SPEC)(mulberry32(seed));
    const expected = applyAffine(
      prepared.affines[1],
      sample[0],
      sample[1],
      sample[2],
    );
    expect([step.x, step.y, step.z]).toEqual(expected);
    expect(step.index).toBe(1);
    expect(step.escaped).toBe(false);
    expect(primaryAt).toBe(2); // pick + seed, nothing else
    expect(auxDraws).toBe(0); // no julia coin, no reseed
  });

  it("emitted fraction tracks the emitter's weight share", () => {
    // Emitter weight 1 against a weight-3 contraction: ~25% of plotted
    // points come from the emitter.
    const transforms = emitterSystem(1);
    transforms[0].weight = 3;
    const numPoints = 20000;
    const { transformIndices } = runChaosGame(
      transforms,
      numPoints,
      mulberry32(11),
    );
    let emitted = 0;
    for (let i = 0; i < numPoints; i++) {
      if (transformIndices[i] === 1) emitted++;
    }
    expect(emitted / numPoints).toBeGreaterThan(0.22);
    expect(emitted / numPoints).toBeLessThan(0.28);
  });

  it("every emitter-indexed point lies in the transform's image of the shape (sampler-through-stepper distribution)", () => {
    // Invert the emitter's own affine on each emitter-indexed plotted point
    // and ask the shape's SDF for membership — the stepper must deliver
    // exactly the sampler's support, posed by the TRS.
    const transforms = emitterSystem();
    const aff = composeAffine(transforms[1]);
    const numPoints = 4000;
    const { positions, transformIndices } = runChaosGame(
      transforms,
      numPoints,
      mulberry32(21),
    );
    // Invert p = M s + t for the pure rotation+uniform-scale M authored
    // above: s = Mᵀ (p - t) / scale².
    const s2 = 0.6 * 0.6;
    let checked = 0;
    for (let i = 0; i < numPoints; i++) {
      if (transformIndices[i] !== 1) continue;
      const dx = positions[i * 3] - aff.t[0];
      const dy = positions[i * 3 + 1] - aff.t[1];
      const dz = positions[i * 3 + 2] - aff.t[2];
      const sx = (aff.m[0] * dx + aff.m[3] * dy + aff.m[6] * dz) / s2;
      const sy = (aff.m[1] * dx + aff.m[4] * dy + aff.m[7] * dz) / s2;
      const sz = (aff.m[2] * dx + aff.m[5] * dy + aff.m[8] * dz) / s2;
      expect(shapeSdf(SPHERE_SPEC, sx, sy, sz)).toBeLessThanOrEqual(1e-9);
      checked++;
    }
    expect(checked).toBeGreaterThan(numPoints / 4);
  });

  it("costs the primary stream a CONSTANT one extra draw per emitter step even for a rejection-loop sampler (gear)", () => {
    // GEAR_SHAPE's sampler redraws unboundedly inside the annulus; every
    // one of those draws must come from the derived stream, so the primary
    // count is exactly 3 seed + 2 per step (pick + emitter seed).
    const transforms: Transform[] = [
      {
        id: 0,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [0.4, 0.4, 0.4],
        emitter: GEAR_SHAPE,
      },
    ];
    const numPoints = 500;
    let draws = 0;
    const inner = mulberry32(7);
    const spy: Rng = () => {
      draws++;
      return inner();
    };
    runChaosGame(transforms, numPoints, spy);
    expect(draws).toBe(3 + 2 * (WARMUP_ITERATIONS + numPoints));
  });

  it("emitter-free documents keep the exact pre-emitter draw count, and empty parts behave as absent byte-identically", () => {
    const plain = makeTransforms(3);
    const emptySpec: ShapeSpec = { parts: [] };
    const withEmpty = makeTransforms(3).map((t, i) =>
      i === 1 ? { ...t, emitter: emptySpec } : t,
    );
    const numPoints = 800;
    const run = (transforms: Transform[]) => {
      let draws = 0;
      const inner = mulberry32(13);
      const spy: Rng = () => {
        draws++;
        return inner();
      };
      const result = runChaosGame(transforms, numPoints, spy);
      return { draws, result };
    };
    const a = run(plain);
    const b = run(withEmpty);
    // Plain affine system: 3 seed draws + one pick per warmup/recorded step.
    expect(a.draws).toBe(3 + WARMUP_ITERATIONS + numPoints);
    expect(b.draws).toBe(a.draws);
    expect(b.result.positions).toEqual(a.result.positions);
    expect(b.result.transformIndices).toEqual(a.result.transformIndices);
  });

  it("falls back to the plain transform for an unsamplable (intersect) spec, byte-identically", () => {
    // prepareShapeSampler throws on the intersect part; the transform must
    // then behave exactly as if the field were absent — same draws, same
    // output — and prepare no emitters at all.
    const withEmitter = emitterSystem(1, INTERSECT_SPEC);
    withEmitter[1].variations = [{ type: "swirl", weight: 0.5 }];
    const plain = emitterSystem(1, INTERSECT_SPEC).map((t, i) => {
      if (i !== 1) return t;
      const { emitter: _emitter, ...rest } = t;
      return { ...rest, variations: [{ type: "swirl" as const, weight: 0.5 }] };
    });
    expect(prepareChaosGame(withEmitter).emitters).toBeNull();
    const numPoints = 600;
    const a = runChaosGame(withEmitter, numPoints, mulberry32(31));
    const b = runChaosGame(plain, numPoints, mulberry32(31));
    expect(a.positions).toEqual(b.positions);
    expect(a.transformIndices).toEqual(b.transformIndices);
  });

  it("prepareEmitters is shared vocabulary: the sampler fallback never hides a samplable sibling", () => {
    const emitters = prepareEmitters([
      { emitter: INTERSECT_SPEC },
      {},
      { emitter: SPHERE_SPEC },
    ]);
    expect(emitters).not.toBeNull();
    expect(emitters![0]).toBeNull();
    expect(emitters![1]).toBeNull();
    expect(emitters![2]).not.toBeNull();
  });

  it("rotates a kaleidoscope copy's emitted stamp by the copy's own rotation", () => {
    const transforms: Transform[] = [emitterSystem()[1]];
    transforms[0].id = 0;
    const symmetry: SymmetryParams = { order: 2, plane: "xy" };
    const prepared = prepareChaosGame(transforms, null, symmetry);
    // Two slots (copy 0, copy 1); drive the pick onto copy 1.
    const primary = [0.75, 0.5];
    let at = 0;
    const rng: Rng = () => primary[at++];
    const step = stepOrbit(prepared, 0, 0, 0, rng);

    const seed = (0.5 * 0x100000000) >>> 0;
    const sample = prepareShapeSampler(SPHERE_SPEC)(mulberry32(seed));
    const base = applyAffine(
      prepared.affines[1],
      sample[0],
      sample[1],
      sample[2],
    );
    const post = symmetryRotation("xy", Math.PI);
    expect(step.x).toBeCloseTo(
      post[0] * base[0] + post[1] * base[1] + post[2] * base[2],
      12,
    );
    expect(step.y).toBeCloseTo(
      post[3] * base[0] + post[4] * base[1] + post[5] * base[2],
      12,
    );
    expect(step.index).toBe(0); // still the BASE map
  });

  it("keeps the escape guard: an emitter whose pose flings samples out reseeds from aux", () => {
    const transforms = emitterSystem();
    transforms[1].position = [1000, 0, 0]; // far past ESCAPE_LIMIT
    const prepared = prepareChaosGame(transforms);
    const primary = [0.9, 0.5];
    let at = 0;
    const rng: Rng = () => primary[at++];
    const auxSeq = [0.7, 0.6, 0.5];
    let auxAt = 0;
    const aux: Rng = () => auxSeq[auxAt++];
    const step = stepOrbit(prepared, 0, 0, 0, rng, aux);
    expect(step.escaped).toBe(true);
    expect(step.x).toBeCloseTo(0.2, 12);
    expect(step.y).toBeCloseTo(0.1, 12);
    expect(step.z).toBeCloseTo(0.0, 12);
  });

  it("reproduces runChaosGame's output exactly when driven by hand (inlined-mirror oracle with an emitter, weights + kaleidoscope + lens)", () => {
    const transforms = emitterSystem(1.5, GEAR_SHAPE);
    transforms[0].weight = 2;
    const finalTransform: Transform = {
      id: 0,
      position: [0.05, 0, 0],
      rotation: [0, 0.2, 0],
      scale: [0.95, 0.95, 0.95],
    };
    const symmetry: SymmetryParams = { order: 3, plane: "xz" };
    const numPoints = 3000;
    const seed = 41;

    const expected = runChaosGame(
      transforms,
      numPoints,
      mulberry32(seed),
      finalTransform,
      symmetry,
    );

    const prepared = prepareChaosGame(transforms, finalTransform, symmetry);
    const rng = mulberry32(seed);
    let x = rng() - 0.5;
    let y = rng() - 0.5;
    let z = rng() - 0.5;
    for (let i = 0; i < WARMUP_ITERATIONS; i++) {
      const s = stepOrbit(prepared, x, y, z, rng);
      x = s.x;
      y = s.y;
      z = s.z;
    }
    for (let i = 0; i < numPoints; i++) {
      const s = stepOrbit(prepared, x, y, z, rng);
      x = s.x;
      y = s.y;
      z = s.z;
      const [px, py, pz] = plotPoint(prepared, x, y, z, rng);
      expect(expected.positions[i * 3]).toBe(Math.fround(px));
      expect(expected.positions[i * 3 + 1]).toBe(Math.fround(py));
      expect(expected.positions[i * 3 + 2]).toBe(Math.fround(pz));
      expect(expected.transformIndices[i]).toBe(s.index);
    }
  });

  it("keeps the primary stream rigid under an iterationRng: pick + seed per emitter step", () => {
    const transforms = emitterSystem();
    const numPoints = 400;
    let primaryDraws = 0;
    const inner = mulberry32(3);
    const spy: Rng = () => {
      primaryDraws++;
      return inner();
    };
    const iter = iterationRng(77);
    const result = runChaosGame(
      transforms,
      numPoints,
      spy,
      null,
      { order: 1, plane: "xz" },
      iter,
    );
    expect(result.count).toBe(numPoints);
    // 3 seed draws + one pick per step + one emitter seed exactly on
    // emitter picks: total = 3 + steps + emitterSteps. Recover the emitter
    // step count from the recorded indices (warmup steps counted via a
    // second, plain run below).
    let expectedDraws = 3; // the seed point's three draws
    const prepared = prepareChaosGame(transforms);
    const iter2 = iterationRng(77);
    // Reproduce the run to count emitter picks including warmup: drive the
    // same loop and count.
    const rng2 = mulberry32(3);
    let x = rng2() - 0.5;
    let y = rng2() - 0.5;
    let z = rng2() - 0.5;
    let emitterSteps = 0;
    for (let i = 0; i < WARMUP_ITERATIONS + numPoints; i++) {
      iter2.begin(i);
      const s = stepOrbit(prepared, x, y, z, rng2, iter2.draw);
      if (s.index === 1) emitterSteps++;
      x = s.x;
      y = s.y;
      z = s.z;
    }
    expectedDraws += WARMUP_ITERATIONS + numPoints + emitterSteps;
    expect(primaryDraws).toBe(expectedDraws);
  });

  it("emitterSeed spends exactly one draw and spreads over the u32 space", () => {
    let draws = 0;
    const rng: Rng = () => {
      draws++;
      return 0.999999999;
    };
    const seed = emitterSeed(rng);
    expect(draws).toBe(1);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(seed)).toBe(true);
    expect(emitterSeed(() => 0)).toBe(0);
  });
});
