import { embedTransform3 } from "./affine4";
import { ESCAPE_LIMIT, MAX_TRANSFORMS, runChaosGame } from "./chaos-game";
import { runChaosGame4 } from "./chaos-game-4d";
import { pentatopeGasket } from "./presets4";
import { sierpinskiTetrahedron } from "./presets";
import { mulberry32 } from "./rng";
import type { Transform4 } from "./types";

function makeMaps(count: number): Transform4[] {
  return Array.from({ length: count }, (): Transform4 => ({
    position: [0.25, 0.25, 0.25, 0.25],
    scale: [0.5, 0.5, 0.5, 0.5],
  }));
}

describe("runChaosGame4 result shape", () => {
  it("returns an empty result with no transforms", () => {
    const result = runChaosGame4([], 1000);
    expect(result.count).toBe(0);
    expect(result.positions).toHaveLength(0);
    expect(result.w).toHaveLength(0);
    expect(result.transformIndices).toHaveLength(0);
    expect(result.radius).toBe(0);
    expect(result.center).toEqual([0, 0, 0, 0]);
    expect(result.bounds).toEqual({
      minX: 0,
      maxX: 0,
      minY: 0,
      maxY: 0,
      minZ: 0,
      maxZ: 0,
      minW: 0,
      maxW: 0,
    });
  });

  it("returns an empty result for zero points", () => {
    const result = runChaosGame4(makeMaps(4), 0);
    expect(result.count).toBe(0);
    expect(result.positions).toHaveLength(0);
    expect(result.w).toHaveLength(0);
  });

  it("produces count points with matching buffer lengths", () => {
    const result = runChaosGame4(makeMaps(4), 500, mulberry32(1));
    expect(result.count).toBe(500);
    expect(result.positions).toHaveLength(500 * 3);
    expect(result.w).toHaveLength(500);
    expect(result.transformIndices).toHaveLength(500);
  });

  it("rejects systems with more than the supported number of transforms", () => {
    expect(() => runChaosGame4(makeMaps(MAX_TRANSFORMS + 1), 10)).toThrow(
      RangeError,
    );
  });
});

describe("runChaosGame4 determinism", () => {
  it("is byte-for-byte identical for a given seed", () => {
    const a = runChaosGame4(pentatopeGasket(), 400, mulberry32(7));
    const b = runChaosGame4(pentatopeGasket(), 400, mulberry32(7));
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.w)).toEqual(Array.from(b.w));
    expect(Array.from(a.transformIndices)).toEqual(
      Array.from(b.transformIndices),
    );
  });

  it("differs for a different seed", () => {
    const a = runChaosGame4(pentatopeGasket(), 400, mulberry32(7));
    const b = runChaosGame4(pentatopeGasket(), 400, mulberry32(8));
    expect(Array.from(a.positions)).not.toEqual(Array.from(b.positions));
  });
});

describe("runChaosGame4 escape guard", () => {
  it("keeps every coordinate finite and within the escape limit under an expansive map", () => {
    // A single net-expansive map (scale 3) sends the orbit to infinity; the
    // reseed guard — extended to w — must catch it before anything is recorded.
    const expansive: Transform4[] = [
      { position: [0.1, 0, 0, 0.1], scale: [3, 3, 3, 3] },
    ];
    const result = runChaosGame4(expansive, 4000, mulberry32(4));
    for (let i = 0; i < result.count; i++) {
      const x = result.positions[i * 3];
      const y = result.positions[i * 3 + 1];
      const z = result.positions[i * 3 + 2];
      const w = result.w[i];
      for (const c of [x, y, z, w]) {
        expect(Number.isFinite(c)).toBe(true);
        expect(Math.abs(c)).toBeLessThanOrEqual(ESCAPE_LIMIT);
      }
    }
  });
});

describe("runChaosGame4 weighting", () => {
  it("draws maps in proportion to their weights (3:1 ≈ 75%)", () => {
    // Identical geometry so only the weights bias the pick.
    const maps: Transform4[] = [
      { position: [0.3, 0, 0, 0], scale: [0.5, 0.5, 0.5, 0.5], weight: 3 },
      { position: [-0.3, 0, 0, 0], scale: [0.5, 0.5, 0.5, 0.5], weight: 1 },
    ];
    const result = runChaosGame4(maps, 20000, mulberry32(5));
    let zero = 0;
    for (const idx of result.transformIndices) if (idx === 0) zero++;
    const share = zero / result.count;
    expect(share).toBeGreaterThan(0.72);
    expect(share).toBeLessThan(0.78);
  });
});

describe("runChaosGame4 embedding a 3D system (structural equivalence)", () => {
  it("keeps an embedded 3D system in a single w-slice while reproducing its xyz attractor", () => {
    // A 3D transform embeds with scale w = 1 and w-row [0,0,0,1], so w is
    // PRESERVED exactly at its seed — the orbit never leaves the w-slice it
    // started in (no map re-introduces w). We assert that exactly (maxW ===
    // minW, to the last bit), and that the xyz attractor matches a native 3D
    // run of the same preset (a different RNG stream, so bounds agree only to
    // within the sampling slop of the shared attractor).
    const embedded = sierpinskiTetrahedron().map(embedTransform3);
    const four = runChaosGame4(embedded, 50000, mulberry32(11));

    // The whole cloud lives in one w = const slice, exactly.
    expect(four.bounds.maxW).toBe(four.bounds.minW);
    // center.w absorbs that constant, so w never inflates the framing radius.
    expect(four.center[3]).toBe(four.bounds.minW);

    const three = runChaosGame(sierpinskiTetrahedron(), 50000, mulberry32(23));
    expect(four.bounds.minX).toBeCloseTo(three.bounds.minX, 1);
    expect(four.bounds.maxX).toBeCloseTo(three.bounds.maxX, 1);
    expect(four.bounds.minY).toBeCloseTo(three.bounds.minY, 1);
    expect(four.bounds.maxY).toBeCloseTo(three.bounds.maxY, 1);
    expect(four.bounds.minZ).toBeCloseTo(three.bounds.minZ, 1);
    expect(four.bounds.maxZ).toBeCloseTo(three.bounds.maxZ, 1);
  });
});

describe("runChaosGame4 bounds, center and radius", () => {
  it("frames the pentatope: w spans its apex-to-base extent and the radius bounds every point", () => {
    const result = runChaosGame4(pentatopeGasket(), 50000, mulberry32(3));
    const { minW, maxW, maxX } = result.bounds;
    // The apex vertex sits at w = 1, the four base vertices at w = −1/4; the
    // cloud approaches all five fixed points.
    expect(maxW).toBeGreaterThan(0.95);
    expect(maxW).toBeLessThanOrEqual(1 + 1e-6);
    expect(minW).toBeGreaterThanOrEqual(-0.25 - 1e-6);
    expect(minW).toBeLessThan(-0.24);
    // Two vertices reach x = √5/4 ≈ 0.559.
    expect(maxX).toBeGreaterThan(0.5);
    expect(maxX).toBeLessThanOrEqual(0.56);
    // Bounds-box center along w.
    expect(result.center[3]).toBeCloseTo((minW + maxW) / 2, 12);
    // Circumradius-1 simplex about a center offset up the w axis: ~1.1.
    expect(result.radius).toBeGreaterThan(0.9);
    expect(result.radius).toBeLessThan(1.2);
  });

  it("reports radius as the exact max distance from center over the emitted cloud", () => {
    const result = runChaosGame4(pentatopeGasket(), 2000, mulberry32(9));
    let maxDistSq = 0;
    for (let i = 0; i < result.count; i++) {
      const dx = result.positions[i * 3] - result.center[0];
      const dy = result.positions[i * 3 + 1] - result.center[1];
      const dz = result.positions[i * 3 + 2] - result.center[2];
      const dw = result.w[i] - result.center[3];
      maxDistSq = Math.max(maxDistSq, dx * dx + dy * dy + dz * dz + dw * dw);
    }
    expect(result.radius).toBeCloseTo(Math.sqrt(maxDistSq), 6);
    // Every point is within the radius (it is the max, by construction).
    expect(result.radius).toBeGreaterThanOrEqual(Math.sqrt(maxDistSq) - 1e-9);
  });
});
