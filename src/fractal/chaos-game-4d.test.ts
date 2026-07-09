import {
  applyAffine4,
  composeAffine4,
  embedTransform3,
  toTransform4,
} from "./affine4";
import {
  ESCAPE_LIMIT,
  MAX_TRANSFORMS,
  WARMUP_ITERATIONS,
  runChaosGame,
} from "./chaos-game";
import {
  pickIndex4,
  plotPoint4,
  prepareChaosGame4,
  runChaosGame4,
  stepOrbit4,
} from "./chaos-game-4d";
import type { PreparedChaosGame4 } from "./chaos-game-4d";
import { pentatope, sierpinskiTetrahedron } from "./presets";
import { mulberry32 } from "./rng";
import type { Rng } from "./rng";
import { composeVariations4 } from "./variations4";
import type { Bounds4, Transform, Transform4, Vec4 } from "./types";

// presets4.ts (the fr-cbg spike's native-Transform4 preset module) was
// deleted once fr-bf6 unified "4D" into an ordinary Transform's optional `w`
// block: `presets.ts`'s `pentatope` + `toTransform4` now produce the
// bit-identical Transform4[] its old `pentatopeGasket` did (composeAffine4
// skips the lift's all-zero rotation exactly like an absent one — see
// presets.test.ts), so this local alias keeps every assertion below
// unchanged.
function pentatopeGasket(): Transform4[] {
  return pentatope().map(toTransform4);
}

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

  // Golden pin (fr-5b3 seam refactor): exact values captured from the
  // UNMODIFIED (pre-prepareChaosGame4) implementation. If the seam refactor
  // changes RNG consumption order, this fails — fix the refactor, never these
  // constants.
  it("is unchanged by the prepared-seam refactor (golden pin, pentatope, seed 123)", () => {
    const result = runChaosGame4(
      pentatope().map(toTransform4),
      10_000,
      mulberry32(123),
      null,
    );
    let posSum = 0;
    for (const v of result.positions) posSum += v;
    let wSum = 0;
    for (const v of result.w) wSum += v;
    let idxSum = 0;
    for (const v of result.transformIndices) idxSum += v;
    expect(posSum).toBe(-35.70872919570684);
    expect(wSum).toBe(19.6837997417897);
    expect(idxSum).toBe(20069);
    expect(result.radius).toBe(1.13994626685649);
    expect(result.center).toEqual([
      -0.0003939631899278484, -0.000957899587122335, -0.000301348846510896,
      0.3673757091824691,
    ]);
    expect(Array.from(result.positions.slice(0, 9))).toEqual([
      -0.007044479250907898, 0.4197215735912323, -0.13282717764377594,
      0.2759862542152405, 0.48936927318573, 0.21309490501880646,
      0.41750162839889526, 0.5241931080818176, 0.38605594635009766,
    ]);
    expect(Array.from(result.w.slice(0, 3))).toEqual([
      -0.24938935041427612, -0.24969467520713806, -0.24984733760356903,
    ]);
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

describe("prepareChaosGame4", () => {
  it("composes one affine and one variation slot per transform", () => {
    const prepared = prepareChaosGame4(makeMaps(4));
    expect(prepared.affines).toHaveLength(4);
    expect(prepared.variations).toHaveLength(4);
    expect(prepared.transformCount).toBe(4);
  });

  it("has no final transform when none is passed", () => {
    const prepared = prepareChaosGame4(makeMaps(2));
    expect(prepared.finalAffine).toBeNull();
    expect(prepared.finalWarp).toBeNull();
  });

  it("flags a system as weighted only when a weight differs from 1", () => {
    const uniform = prepareChaosGame4(makeMaps(2));
    expect(uniform.weighted).toBe(false);

    const skewed: Transform4[] = [
      { position: [0, 0, 0, 0], scale: [1, 1, 1, 1] },
      { position: [0, 0, 0, 0], scale: [1, 1, 1, 1], weight: 3 },
    ];
    const weighted = prepareChaosGame4(skewed);
    expect(weighted.weighted).toBe(true);
    expect(weighted.totalWeight).toBe(4);
    expect(Array.from(weighted.cumulative)).toEqual([1, 4]);
  });

  it("rejects systems with more than the supported number of transforms", () => {
    expect(() => prepareChaosGame4(makeMaps(MAX_TRANSFORMS + 1))).toThrow(
      RangeError,
    );
  });
});

describe("pickIndex4", () => {
  it("draws uniformly with exactly one rng call when unweighted", () => {
    const prepared = prepareChaosGame4(makeMaps(4));
    let calls = 0;
    const rng = () => {
      calls++;
      return 0.5; // floor(0.5 * 4) = 2.
    };
    expect(pickIndex4(prepared, rng)).toBe(2);
    expect(calls).toBe(1);
  });

  it("picks by cumulative weight band when weighted", () => {
    const maps: Transform4[] = [
      { position: [0, 0, 0, 0], scale: [1, 1, 1, 1], weight: 1 },
      { position: [0, 0, 0, 0], scale: [1, 1, 1, 1], weight: 3 },
    ];
    const prepared = prepareChaosGame4(maps);
    // cumulative = [1, 4], totalWeight = 4.
    expect(pickIndex4(prepared, () => 0)).toBe(0); // r = 0, band [0, 1).
    expect(pickIndex4(prepared, () => 0.9999)).toBe(1); // r ~= 4, band [1, 4).
  });
});

describe("stepOrbit4", () => {
  it("matches a hand-applied affine + variation step", () => {
    const maps: Transform4[] = [
      {
        position: [0.3, 0.1, -0.2, 0.15],
        scale: [0.5, 0.5, 0.5, 0.5],
        variations: [{ type: "spherical", weight: 0.6 }],
      },
    ];
    const prepared = prepareChaosGame4(maps);
    const s = stepOrbit4(prepared, 0.2, -0.1, 0.05, 0.1, mulberry32(7));

    // A single-transform unweighted system's pick consumes exactly one rng
    // call (see pickIndex4), so a fresh rng of the same seed must be advanced
    // past that draw before hand-computing the expected variation step.
    const rngForHand = mulberry32(7);
    rngForHand();
    const affine = composeAffine4(maps[0]);
    const warp = composeVariations4(maps[0].variations)!;
    const [ax, ay, az, aw] = applyAffine4(affine, 0.2, -0.1, 0.05, 0.1);
    const [ex, ey, ez, ew] = warp(ax, ay, az, aw, rngForHand);

    expect(s.x).toBeCloseTo(ex, 10);
    expect(s.y).toBeCloseTo(ey, 10);
    expect(s.z).toBeCloseTo(ez, 10);
    expect(s.w).toBeCloseTo(ew, 10);
    expect(s.index).toBe(0);
  });

  it("reseeds all four coordinates on escape", () => {
    // A single net-expansive map (scale 3) sends the orbit to infinity from
    // any point already near the escape limit; the reseed guard — extended
    // to w — must catch it before it poisons the rest of the orbit.
    const expansive: Transform4[] = [
      { position: [0.1, 0, 0, 0.1], scale: [3, 3, 3, 3] },
    ];
    const prepared = prepareChaosGame4(expansive);
    const s = stepOrbit4(prepared, 40, 40, 40, 40, mulberry32(4));
    for (const c of [s.x, s.y, s.z, s.w]) {
      expect(Number.isFinite(c)).toBe(true);
      expect(Math.abs(c)).toBeLessThanOrEqual(ESCAPE_LIMIT);
    }
  });
});

describe("plotPoint4", () => {
  it("returns the orbit point unchanged when the prepared system has no final transform", () => {
    const prepared = prepareChaosGame4(makeMaps(4));
    expect(plotPoint4(prepared, 1, -2, 0.5, 0.3, mulberry32(1))).toEqual([
      1, -2, 0.5, 0.3,
    ]);
  });

  it("bends the point through the final transform when one is present", () => {
    const finalTransform: Transform4 = {
      position: [1, -2, 0.5, 0.3],
      scale: [2, 2, 2, 2],
    };
    const prepared = prepareChaosGame4(makeMaps(4), finalTransform);
    const F = composeAffine4(finalTransform);
    const [ex, ey, ez, ew] = applyAffine4(F, 0.3, 0.1, -0.2, 0.15);
    const [px, py, pz, pw] = plotPoint4(
      prepared,
      0.3,
      0.1,
      -0.2,
      0.15,
      mulberry32(1),
    );
    expect(px).toBeCloseTo(ex, 10);
    expect(py).toBeCloseTo(ey, 10);
    expect(pz).toBeCloseTo(ez, 10);
    expect(pw).toBeCloseTo(ew, 10);
  });

  it("falls back to the orbit point when the lens produces a non-finite value", () => {
    // An infinite scale composes an affine whose off-diagonal entries are
    // 0 * Infinity = NaN, so applying it to ANY point yields NaN in every
    // coordinate — deterministic, no variation or RNG needed to provoke it.
    const lens: Transform4 = {
      position: [0, 0, 0, 0],
      scale: [Infinity, Infinity, Infinity, Infinity],
    };
    const prepared = prepareChaosGame4(makeMaps(4), lens);
    const result = plotPoint4(prepared, 0.3, 0.1, -0.2, 0.15, mulberry32(1));
    expect(result).toEqual([0.3, 0.1, -0.2, 0.15]);
  });
});

describe("runChaosGame4 vs. stepOrbit4/plotPoint4 (allocation-free oracle)", () => {
  // runChaosGame4's recording loop is hand-inlined (mirroring
  // flame-4d.ts's accumulateFlame4) to avoid allocating an OrbitStep4
  // object and two Vec4 arrays per point. This block pins that inlined loop
  // against the real, unmodified stepOrbit4/plotPoint4 building blocks it
  // must stay byte-for-byte equivalent to — if the inlined copy ever drifts
  // from the real thing, one of the scenarios below catches it. 4D has no
  // symmetry (see PreparedChaosGame4's doc), so unlike the 3D oracle in
  // chaos-game.test.ts there is no postRotations scenario here.
  //
  // referenceChaosGame4 is the oracle computation itself (the exact loop
  // shape runChaosGame4 used to run before it was inlined: seed x/y/z/w,
  // warm up through the real stepOrbit4, then per point stepOrbit4 +
  // plotPoint4, bounds tracked with the same if-comparisons runChaosGame4
  // uses, then a second pass for the exact center/radius) — identical by
  // construction for every scenario, so it is shared rather than re-typed
  // four times; each scenario below still states its own
  // system/seed/point-count inline so it reads standalone.
  function referenceChaosGame4(
    prepared: PreparedChaosGame4,
    numPoints: number,
    rng: Rng,
  ): {
    positions: Float32Array;
    w: Float32Array;
    transformIndices: Uint8Array;
    bounds: Bounds4;
    center: Vec4;
    radius: number;
  } {
    let x = rng() - 0.5;
    let y = rng() - 0.5;
    let z = rng() - 0.5;
    let w = rng() - 0.5;
    for (let i = 0; i < WARMUP_ITERATIONS; i++) {
      const s = stepOrbit4(prepared, x, y, z, w, rng);
      x = s.x;
      y = s.y;
      z = s.z;
      w = s.w;
    }

    const positions = new Float32Array(numPoints * 3);
    const wBuffer = new Float32Array(numPoints);
    const transformIndices = new Uint8Array(numPoints);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let minW = Infinity;
    let maxW = -Infinity;
    for (let i = 0; i < numPoints; i++) {
      const s = stepOrbit4(prepared, x, y, z, w, rng);
      x = s.x;
      y = s.y;
      z = s.z;
      w = s.w;
      const [px, py, pz, pw] = plotPoint4(prepared, x, y, z, w, rng);
      positions[i * 3] = px;
      positions[i * 3 + 1] = py;
      positions[i * 3 + 2] = pz;
      wBuffer[i] = pw;
      transformIndices[i] = s.index;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
      if (pz < minZ) minZ = pz;
      if (pz > maxZ) maxZ = pz;
      if (pw < minW) minW = pw;
      if (pw > maxW) maxW = pw;
    }

    const center: Vec4 = [
      (minX + maxX) / 2,
      (minY + maxY) / 2,
      (minZ + maxZ) / 2,
      (minW + maxW) / 2,
    ];

    let radiusSq = 0;
    for (let i = 0; i < numPoints; i++) {
      const dx = positions[i * 3] - center[0];
      const dy = positions[i * 3 + 1] - center[1];
      const dz = positions[i * 3 + 2] - center[2];
      const dw = wBuffer[i] - center[3];
      const d2 = dx * dx + dy * dy + dz * dz + dw * dw;
      if (d2 > radiusSq) radiusSq = d2;
    }
    const radius = Math.sqrt(radiusSq);

    return {
      positions,
      w: wBuffer,
      transformIndices,
      bounds: { minX, maxX, minY, maxY, minZ, maxZ, minW, maxW },
      center,
      radius,
    };
  }

  it("matches for a plain multi-transform system (no variations, no final transform)", () => {
    const transforms = pentatopeGasket();
    const numPoints = 800;
    const seed = 42;

    const actual = runChaosGame4(transforms, numPoints, mulberry32(seed));
    const reference = referenceChaosGame4(
      prepareChaosGame4(transforms),
      numPoints,
      mulberry32(seed),
    );

    expect(Array.from(actual.positions)).toEqual(
      Array.from(reference.positions),
    );
    expect(Array.from(actual.w)).toEqual(Array.from(reference.w));
    expect(Array.from(actual.transformIndices)).toEqual(
      Array.from(reference.transformIndices),
    );
    expect(actual.count).toBe(numPoints);
    expect(actual.bounds).toEqual(reference.bounds);
    expect(actual.center).toEqual(reference.center);
    expect(actual.radius).toBe(reference.radius);
  });

  it("matches for a system with a variation on one transform (warp !== null branch)", () => {
    const transforms: Transform4[] = [
      {
        position: [0.3, 0.1, -0.2, 0.15],
        scale: [0.5, 0.5, 0.5, 0.5],
        variations: [{ type: "spherical", weight: 0.6 }],
      },
      { position: [-0.3, 0.2, 0.15, -0.1], scale: [0.5, 0.5, 0.5, 0.5] },
    ];
    const numPoints = 600;
    const seed = 7;

    const actual = runChaosGame4(transforms, numPoints, mulberry32(seed));
    const reference = referenceChaosGame4(
      prepareChaosGame4(transforms),
      numPoints,
      mulberry32(seed),
    );

    expect(Array.from(actual.positions)).toEqual(
      Array.from(reference.positions),
    );
    expect(Array.from(actual.w)).toEqual(Array.from(reference.w));
    expect(Array.from(actual.transformIndices)).toEqual(
      Array.from(reference.transformIndices),
    );
    expect(actual.bounds).toEqual(reference.bounds);
    expect(actual.center).toEqual(reference.center);
    expect(actual.radius).toBe(reference.radius);
  });

  it("matches for a system with a final-transform lens that itself has a variation (inlined plotPoint4's affine+warp)", () => {
    const transforms = pentatopeGasket();
    const lens: Transform4 = {
      position: [0, 0, 0, 0],
      scale: [1, 1, 1, 1],
      variations: [{ type: "julia", weight: 1 }],
    };
    const numPoints = 500;
    const seed = 9;

    const actual = runChaosGame4(transforms, numPoints, mulberry32(seed), lens);
    const reference = referenceChaosGame4(
      prepareChaosGame4(transforms, lens),
      numPoints,
      mulberry32(seed),
    );

    expect(Array.from(actual.positions)).toEqual(
      Array.from(reference.positions),
    );
    expect(Array.from(actual.w)).toEqual(Array.from(reference.w));
    expect(Array.from(actual.transformIndices)).toEqual(
      Array.from(reference.transformIndices),
    );
    expect(actual.bounds).toEqual(reference.bounds);
    expect(actual.center).toEqual(reference.center);
    expect(actual.radius).toBe(reference.radius);
  });

  it("matches for a weighted system (pickIndex4's weighted path)", () => {
    const transforms: Transform4[] = [
      { position: [0.3, 0, 0, 0], scale: [0.5, 0.5, 0.5, 0.5], weight: 3 },
      { position: [-0.3, 0, 0, 0], scale: [0.5, 0.5, 0.5, 0.5], weight: 1 },
    ];
    const numPoints = 900;
    const seed = 5;

    const actual = runChaosGame4(transforms, numPoints, mulberry32(seed));
    const reference = referenceChaosGame4(
      prepareChaosGame4(transforms),
      numPoints,
      mulberry32(seed),
    );

    expect(Array.from(actual.positions)).toEqual(
      Array.from(reference.positions),
    );
    expect(Array.from(actual.w)).toEqual(Array.from(reference.w));
    expect(Array.from(actual.transformIndices)).toEqual(
      Array.from(reference.transformIndices),
    );
    expect(actual.bounds).toEqual(reference.bounds);
    expect(actual.center).toEqual(reference.center);
    expect(actual.radius).toBe(reference.radius);
  });
});
