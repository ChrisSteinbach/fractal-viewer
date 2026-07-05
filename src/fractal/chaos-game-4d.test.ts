import { applyAffine4, composeAffine4, embedTransform3 } from "./affine4";
import { ESCAPE_LIMIT, MAX_TRANSFORMS, runChaosGame } from "./chaos-game";
import { runChaosGame4 } from "./chaos-game-4d";
import { pentatopeGasket } from "./presets4";
import { sierpinskiTetrahedron } from "./presets";
import { mulberry32 } from "./rng";
import type { Transform, Transform4 } from "./types";

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
  it("attracts an embedded 3D system to the w = 0 slice while reproducing its xyz attractor", () => {
    // A 3D transform embeds with scale w = its mean spatial contraction (see
    // embedTransform3's JSDoc — this is what keeps later 4D parameter edits
    // contractive), so the seed's w decays geometrically: ~2^-100 after the
    // warmup alone for these ½-scale maps. The attractor genuinely lives in
    // the w = 0 slice, and the xyz attractor matches a native 3D run of the
    // same preset (a different RNG stream, so bounds agree only to within the
    // sampling slop of the shared attractor).
    const embedded = sierpinskiTetrahedron().map(embedTransform3);
    const four = runChaosGame4(embedded, 50000, mulberry32(11));

    // The whole cloud has collapsed onto w = 0 (far below Float32 precision).
    expect(Math.abs(four.bounds.minW)).toBeLessThan(1e-25);
    expect(Math.abs(four.bounds.maxW)).toBeLessThan(1e-25);
    // center.w follows, so w never inflates the framing radius.
    expect(Math.abs(four.center[3])).toBeLessThan(1e-25);

    const three = runChaosGame(sierpinskiTetrahedron(), 50000, mulberry32(23));
    expect(four.bounds.minX).toBeCloseTo(three.bounds.minX, 1);
    expect(four.bounds.maxX).toBeCloseTo(three.bounds.maxX, 1);
    expect(four.bounds.minY).toBeCloseTo(three.bounds.minY, 1);
    expect(four.bounds.maxY).toBeCloseTo(three.bounds.maxY, 1);
    expect(four.bounds.minZ).toBeCloseTo(three.bounds.minZ, 1);
    expect(four.bounds.maxZ).toBeCloseTo(three.bounds.maxZ, 1);
  });
});

describe("runChaosGame4 with variations", () => {
  it("stays bounded and reproducible with a spherical variation and a seed", () => {
    // Two contractive maps, one carrying a nonlinear spherical warp (the full 4D
    // radius genuinely participates). The warp can send a near-origin point far
    // out; the escape guard — which now runs AFTER the warp — must keep every
    // recorded coordinate finite and within the escape limit.
    const maps: Transform4[] = [
      {
        position: [0.3, 0.1, -0.2, 0.15],
        scale: [0.5, 0.5, 0.5, 0.5],
        variations: [{ type: "spherical", weight: 0.6 }],
      },
      { position: [-0.3, 0.2, 0.15, -0.1], scale: [0.5, 0.5, 0.5, 0.5] },
    ];
    const a = runChaosGame4(maps, 5000, mulberry32(7));
    const b = runChaosGame4(maps, 5000, mulberry32(7));
    // Byte-for-byte reproducible for a given seed (the warp draws no RNG, but the
    // path is otherwise identical run to run).
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.w)).toEqual(Array.from(b.w));
    for (let i = 0; i < a.count; i++) {
      for (const c of [
        a.positions[i * 3],
        a.positions[i * 3 + 1],
        a.positions[i * 3 + 2],
        a.w[i],
      ]) {
        expect(Number.isFinite(c)).toBe(true);
        expect(Math.abs(c)).toBeLessThanOrEqual(ESCAPE_LIMIT);
      }
    }
  });
});

describe("runChaosGame4 embedding a 3D system WITH variations (anchor property end-to-end)", () => {
  it("collapses w onto the w = 0 slice while reproducing the warped xyz attractor", () => {
    // A Sierpinski tetrahedron with a spherical variation on one map — a system
    // that genuinely HAS a nonlinear warp. Because the 4D lift is w = 0-exact
    // (the anchor property), the embedded system's w = 0 slice warps bit-for-bit
    // like the native 3D path: w decays geometrically onto 0 (the map contracts
    // w at its mean spatial rate), and the xyz attractor matches a 3D run of the
    // identical warped system (a different RNG stream, so bounds agree only to
    // within sampling slop of the shared attractor).
    const system: Transform[] = sierpinskiTetrahedron().map((t, i) =>
      i === 0 ? { ...t, variations: [{ type: "spherical", weight: 0.6 }] } : t,
    );
    const embedded = system.map(embedTransform3);
    const four = runChaosGame4(embedded, 50000, mulberry32(11));

    // The whole cloud has collapsed onto w = 0 (far below Float32 precision),
    // so bounds.minW/maxW — the extremes of w — bound every recorded point.
    expect(Math.abs(four.bounds.minW)).toBeLessThan(1e-25);
    expect(Math.abs(four.bounds.maxW)).toBeLessThan(1e-25);
    expect(Math.abs(four.center[3])).toBeLessThan(1e-25);

    const three = runChaosGame(system, 50000, mulberry32(23));
    expect(four.bounds.minX).toBeCloseTo(three.bounds.minX, 1);
    expect(four.bounds.maxX).toBeCloseTo(three.bounds.maxX, 1);
    expect(four.bounds.minY).toBeCloseTo(three.bounds.minY, 1);
    expect(four.bounds.maxY).toBeCloseTo(three.bounds.maxY, 1);
    expect(four.bounds.minZ).toBeCloseTo(three.bounds.minZ, 1);
    expect(four.bounds.maxZ).toBeCloseTo(three.bounds.maxZ, 1);
  });
});

describe("runChaosGame4 with a final-transform lens", () => {
  it("bends the plotted cloud through the lens without feeding back into the orbit", () => {
    // A pure-affine lens consumes no RNG, so the underlying orbit — and thus the
    // transform indices — stay identical to a run without it; only the plotted
    // positions change, each the orbit point run through the lens affine. That
    // pins all three properties at once: applied at plot time, applied to the
    // orbit point (not fed back), and RNG-neutral when it has no variation.
    const lens: Transform4 = {
      position: [1, -2, 0.5, 0.3],
      scale: [2, 2, 2, 2],
    };
    const base = runChaosGame4(pentatopeGasket(), 2000, mulberry32(9));
    const lensed = runChaosGame4(pentatopeGasket(), 2000, mulberry32(9), lens);

    expect(Array.from(lensed.transformIndices)).toEqual(
      Array.from(base.transformIndices),
    );
    // The bent cloud really moved: its bounds differ from the un-lensed run.
    expect(lensed.bounds).not.toEqual(base.bounds);

    const F = composeAffine4(lens);
    for (let i = 0; i < base.count; i++) {
      const [ex, ey, ez, ew] = applyAffine4(
        F,
        base.positions[i * 3],
        base.positions[i * 3 + 1],
        base.positions[i * 3 + 2],
        base.w[i],
      );
      expect(lensed.positions[i * 3]).toBeCloseTo(ex, 4);
      expect(lensed.positions[i * 3 + 1]).toBeCloseTo(ey, 4);
      expect(lensed.positions[i * 3 + 2]).toBeCloseTo(ez, 4);
      expect(lensed.w[i]).toBeCloseTo(ew, 4);
    }
  });

  it("leaves the cloud unchanged for an identity lens", () => {
    const identity: Transform4 = {
      position: [0, 0, 0, 0],
      scale: [1, 1, 1, 1],
    };
    const without = runChaosGame4(pentatopeGasket(), 1000, mulberry32(4));
    const withIdentity = runChaosGame4(
      pentatopeGasket(),
      1000,
      mulberry32(4),
      identity,
    );
    expect(Array.from(withIdentity.positions)).toEqual(
      Array.from(without.positions),
    );
    expect(Array.from(withIdentity.w)).toEqual(Array.from(without.w));
  });

  it("keeps every coordinate finite when the lens diverges at a singularity", () => {
    // spherical inverts through the origin, sending points near it to infinity;
    // the finite guard must plot the un-bent orbit point rather than leak NaN/∞.
    const lens: Transform4 = {
      position: [0, 0, 0, 0],
      scale: [1, 1, 1, 1],
      variations: [{ type: "spherical", weight: 1 }],
    };
    const { positions, w } = runChaosGame4(
      pentatopeGasket(),
      3000,
      mulberry32(4),
      lens,
    );
    for (const v of positions) expect(Number.isFinite(v)).toBe(true);
    for (const v of w) expect(Number.isFinite(v)).toBe(true);
  });

  it("is deterministic for a seed even with a stochastic (julia) lens", () => {
    const lens: Transform4 = {
      position: [0, 0, 0, 0],
      scale: [1, 1, 1, 1],
      variations: [{ type: "julia", weight: 1 }],
    };
    const a = runChaosGame4(pentatopeGasket(), 500, mulberry32(9), lens);
    const b = runChaosGame4(pentatopeGasket(), 500, mulberry32(9), lens);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.w)).toEqual(Array.from(b.w));
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
