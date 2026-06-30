import { MAX_TRANSFORMS, runChaosGame } from "./chaos-game";
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
