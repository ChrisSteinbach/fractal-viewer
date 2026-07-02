import {
  MAX_TRANSFORMS,
  WARMUP_ITERATIONS,
  plotPoint,
  prepareChaosGame,
  runChaosGame,
  stepOrbit,
} from "./chaos-game";
import { applyAffine, composeAffine } from "./affine";
import { mulberry32 } from "./rng";
import { sierpinskiTetrahedron } from "./presets";
import type { Transform } from "./types";

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
