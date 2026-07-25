import {
  analyzeSurfaceSystem,
  buildSurfaceDE,
  estimateDistance,
  estimateDistanceRefined,
  singularValues3,
  transformSigmas,
} from "./surface-de";
import { applyAffine, composeAffine, rotationMatrixXYZ } from "./affine";
import { runChaosGame } from "./chaos-game";
import type { ChaosGameResult } from "./chaos-game";
import { defaultTransforms, sierpinskiTetrahedron } from "./presets";
import { mulberry32 } from "./rng";
import type { Transform, Vec3 } from "./types";

/** Minimal contracting map for the eligibility-table tests below, merged
 * with each test's own overrides. */
function map(overrides: Partial<Transform> = {}): Transform {
  return {
    id: 0,
    position: [0.1, 0.2, 0.3],
    rotation: [0, 0, 0],
    scale: [0.5, 0.5, 0.5],
    ...overrides,
  };
}

/** Sierpinski tetrahedron with an anisotropic y-scale (0.25 instead of the
 * uniform 0.5), shared by the "degraded" eligibility/estimate tests. */
function anisotropicSierpinski(): Transform[] {
  return sierpinskiTetrahedron().map((t): Transform => ({
    ...t,
    scale: [0.5, 0.25, 0.5],
  }));
}

/** Brute-force nearest distance from `p` to any point of a sampled cloud —
 * the ground truth {@link estimateDistance}'s lower-bound property is
 * checked against, computed independently of the module under test. */
function nearestDistance(cloud: ChaosGameResult, p: Vec3): number {
  let best = Infinity;
  const { positions, count } = cloud;
  for (let i = 0; i < count; i++) {
    const dx = positions[i * 3] - p[0];
    const dy = positions[i * 3 + 1] - p[1];
    const dz = positions[i * 3 + 2] - p[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}

/** Value at percentile `frac` (0..1) of an ascending-sorted array —
 * nearest-rank, matching how the tightness thresholds below were measured. */
function percentile(sortedAscending: number[], frac: number): number {
  return sortedAscending[Math.floor(frac * (sortedAscending.length - 1))];
}

describe("singularValues3", () => {
  it("returns equal min/max for an identity matrix (the uniform-scale fast path)", () => {
    const sigmas = singularValues3([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(sigmas).toEqual({ min: 1, max: 1 });
  });
});

describe("transformSigmas", () => {
  it("returns exact scale extremes when there is no shear, ignoring rotation", () => {
    const sigmas = transformSigmas({
      id: 0,
      position: [0, 0, 0],
      rotation: [0.3, -0.7, 1.1],
      scale: [0.3, 0.7, 0.5],
    });
    expect(sigmas).toEqual({ min: 0.3, max: 0.7 });
  });

  it("takes the absolute value of a negative scale component", () => {
    const sigmas = transformSigmas({
      id: 0,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [-0.6, 0.5, 0.5],
    });
    expect(sigmas.max).toBe(0.6);
  });
});

describe("transformSigmas with shear", () => {
  it("matches the closed-form golden-ratio singular values for a unit xy shear", () => {
    const phi = (1 + Math.sqrt(5)) / 2;
    const sigmas = transformSigmas({
      id: 0,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [0.5, 0.5, 0.5],
      shear: [1, 0, 0],
    });
    expect(sigmas.max).toBeCloseTo(0.5 * phi, 10);
    expect(sigmas.min).toBeCloseTo(0.5 / phi, 10);
  });

  it("keeps the same singular values when a rotation is composed on top (rotation-invariance)", () => {
    const phi = (1 + Math.sqrt(5)) / 2;
    const sigmas = transformSigmas({
      id: 0,
      position: [0, 0, 0],
      rotation: [0.4, 0.2, -0.3],
      scale: [0.5, 0.5, 0.5],
      shear: [1, 0, 0],
    });
    expect(sigmas.max).toBeCloseTo(0.5 * phi, 10);
    expect(sigmas.min).toBeCloseTo(0.5 / phi, 10);
  });
});

describe("analyzeSurfaceSystem on sierpinskiTetrahedron", () => {
  it("classifies the uniform-scale system as eligible with no anisotropy", () => {
    const analysis = analyzeSurfaceSystem(sierpinskiTetrahedron());
    expect(analysis.status).toBe("eligible");
    expect(analysis.anisotropy).toBe(1);
    expect(analysis.stepScale).toBe(1);
    for (const s of analysis.sigmas) {
      expect(s).toEqual({ min: 0.5, max: 0.5 });
    }
  });
});

describe("analyzeSurfaceSystem on an anisotropic scale", () => {
  it("classifies scale [0.5, 0.25, 0.5] as degraded with anisotropy 2", () => {
    const analysis = analyzeSurfaceSystem(anisotropicSierpinski());
    expect(analysis.status).toBe("degraded");
    expect(analysis.anisotropy).toBe(2);
    expect(analysis.stepScale).toBe(0.55);
    for (const s of analysis.sigmas) {
      expect(s).toEqual({ min: 0.25, max: 0.5 });
    }
  });
});

describe("analyzeSurfaceSystem eligibility", () => {
  it("flags a map with an active variation as ineligible, naming the map", () => {
    const analysis = analyzeSurfaceSystem([
      map({ variations: [{ type: "spherical", weight: 0.5 }] }),
    ]);
    expect(analysis.status).toBe("ineligible");
    expect(analysis.reasons).toHaveLength(1);
    expect(analysis.reasons[0]).toMatch(/uses variations/);
    expect(analysis.reasons[0]).toContain("map 1");
  });

  it("treats a weight-0 variation as inert, staying eligible", () => {
    const analysis = analyzeSurfaceSystem([
      map({ variations: [{ type: "spherical", weight: 0 }] }),
    ]);
    expect(analysis.status).toBe("eligible");
    expect(analysis.reasons).toEqual([]);
  });

  it("flags a map with a nontrivial w extension as ineligible", () => {
    const analysis = analyzeSurfaceSystem([map({ w: { position: 0.4 } })]);
    expect(analysis.status).toBe("ineligible");
    expect(analysis.reasons).toHaveLength(1);
    expect(analysis.reasons[0]).toMatch(/extends into 4D/);
  });

  it("flags a near-singular map as ineligible for being nearly flat", () => {
    const analysis = analyzeSurfaceSystem([map({ scale: [1e-9, 0.5, 0.5] })]);
    expect(analysis.status).toBe("ineligible");
    expect(analysis.reasons).toHaveLength(1);
    expect(analysis.reasons[0]).toMatch(/nearly flat/);
  });

  it("flags a non-contracting map as ineligible", () => {
    const analysis = analyzeSurfaceSystem([map({ scale: [1.2, 0.5, 0.5] })]);
    expect(analysis.status).toBe("ineligible");
    expect(analysis.reasons).toHaveLength(1);
    expect(analysis.reasons[0]).toMatch(/does not contract/);
  });

  it("ignores an inactive (weight-0) map's own issues, staying eligible", () => {
    const analysis = analyzeSurfaceSystem([
      map({ weight: 0, variations: [{ type: "spherical", weight: 1 }] }),
      map({ id: 1 }),
    ]);
    expect(analysis.status).toBe("eligible");
    expect(analysis.reasons).toEqual([]);
  });

  it("flags an empty system as ineligible", () => {
    const analysis = analyzeSurfaceSystem([]);
    expect(analysis.status).toBe("ineligible");
    expect(analysis.reasons).toEqual(["no transforms"]);
  });

  it("flags a system whose every map has weight 0 as ineligible", () => {
    const analysis = analyzeSurfaceSystem([
      map({ weight: 0 }),
      map({ id: 1, weight: 0 }),
    ]);
    expect(analysis.status).toBe("ineligible");
    expect(analysis.reasons).toEqual(["every transform has weight 0"]);
  });

  it("flags a final transform with an active variation as ineligible", () => {
    const analysis = analyzeSurfaceSystem(
      [map()],
      map({ variations: [{ type: "spherical", weight: 1 }] }),
    );
    expect(analysis.status).toBe("ineligible");
    expect(analysis.reasons).toHaveLength(1);
    expect(analysis.reasons[0]).toMatch(/final transform uses variations/);
  });

  it("allows an expanding final-transform lens as long as the base maps contract", () => {
    const analysis = analyzeSurfaceSystem(
      [map()],
      map({ scale: [1.5, 1.5, 1.5] }),
    );
    expect(analysis.status).toBe("eligible");
    expect(analysis.reasons).toEqual([]);
  });
});

describe("buildSurfaceDE eligibility gate", () => {
  it("throws when building a DE for an ineligible system", () => {
    const ineligible = [
      map({ variations: [{ type: "spherical", weight: 1 }] }),
    ];
    expect(() => buildSurfaceDE(ineligible)).toThrow(/variations/);
  });
});

describe("buildSurfaceDE on sierpinskiTetrahedron", () => {
  it("probes a bounding radius padded beyond the sampled attractor", () => {
    const de = buildSurfaceDE(sierpinskiTetrahedron());
    expect(de.boundingRadius).toBeGreaterThan(1.5);
    expect(de.boundingRadius).toBeLessThan(2.2);
  });

  it("sizes the depth cap within the clamp bounds", () => {
    const de = buildSurfaceDE(sierpinskiTetrahedron());
    expect(de.maxDepth).toBeGreaterThanOrEqual(8);
    expect(de.maxDepth).toBeLessThanOrEqual(48);
  });

  it("builds one inverse map per active (unsymmetrized) transform", () => {
    const de = buildSurfaceDE(sierpinskiTetrahedron());
    expect(de.maps).toHaveLength(4);
  });
});

describe("estimateDistance on sierpinskiTetrahedron", () => {
  it("stays within 0.05 of the attractor for points sampled on it", () => {
    const transforms = sierpinskiTetrahedron();
    const de = buildSurfaceDE(transforms);
    const cloud = runChaosGame(transforms, 20000, mulberry32(42));
    for (let i = 0; i < 200; i++) {
      const idx = (i * 97) % cloud.count;
      const p: Vec3 = [
        cloud.positions[idx * 3],
        cloud.positions[idx * 3 + 1],
        cloud.positions[idx * 3 + 2],
      ];
      expect(estimateDistance(de, p)).toBeLessThanOrEqual(0.05);
    }
  });

  it("never exceeds the brute-force nearest sampled distance, for every probe", () => {
    const transforms = sierpinskiTetrahedron();
    const de = buildSurfaceDE(transforms);
    const cloud = runChaosGame(transforms, 200000, mulberry32(7));
    const rng = mulberry32(1234);
    for (let i = 0; i < 300; i++) {
      const p: Vec3 = [(rng() - 0.5) * 3, (rng() - 0.5) * 3, (rng() - 0.5) * 3];
      const nearest = nearestDistance(cloud, p);
      expect(estimateDistance(de, p)).toBeLessThanOrEqual(nearest + 1e-6);
    }
  });

  it("stays within a bounded fraction of the true nearest distance (not a uselessly slack bound)", () => {
    const transforms = sierpinskiTetrahedron();
    const de = buildSurfaceDE(transforms);
    const cloud = runChaosGame(transforms, 200000, mulberry32(7));
    const rng = mulberry32(1234);
    const ratios: number[] = [];
    for (let i = 0; i < 300; i++) {
      const p: Vec3 = [(rng() - 0.5) * 3, (rng() - 0.5) * 3, (rng() - 0.5) * 3];
      const nearest = nearestDistance(cloud, p);
      if (nearest > 0.02 && nearest < 1) {
        const d = estimateDistance(de, p);
        ratios.push(Math.max(d, 0) / nearest);
      }
    }
    ratios.sort((a, b) => a - b);
    expect(percentile(ratios, 0.1)).toBeGreaterThan(0.25);
    expect(percentile(ratios, 0.5)).toBeGreaterThan(0.5);
  });

  it("crosses the central void rather than stalling at a non-positive bound", () => {
    const de = buildSurfaceDE(sierpinskiTetrahedron());
    expect(estimateDistance(de, [0, -0.1, 0])).toBeGreaterThan(0);
  });

  it("bounds a far-away point by the padded bounding sphere", () => {
    const de = buildSurfaceDE(sierpinskiTetrahedron());
    const R = de.boundingRadius;
    const d = estimateDistance(de, [10 * R, 0, 0]);
    expect(d).toBeGreaterThanOrEqual(9 * R - 1e-9);
    expect(d).toBeLessThanOrEqual(11 * R);
  });
});

describe("estimateDistance on an anisotropic system", () => {
  it("stays within 0.05 of the attractor despite the non-uniform scale", () => {
    const transforms = anisotropicSierpinski();
    const de = buildSurfaceDE(transforms);
    const cloud = runChaosGame(transforms, 20000, mulberry32(42));
    for (let i = 0; i < 200; i++) {
      const idx = (i * 97) % cloud.count;
      const p: Vec3 = [
        cloud.positions[idx * 3],
        cloud.positions[idx * 3 + 1],
        cloud.positions[idx * 3 + 2],
      ];
      expect(estimateDistance(de, p)).toBeLessThanOrEqual(0.05);
    }
  });

  it("never exceeds the brute-force nearest sampled distance, for every probe", () => {
    const transforms = anisotropicSierpinski();
    const de = buildSurfaceDE(transforms);
    const cloud = runChaosGame(transforms, 200000, mulberry32(7));
    const rng = mulberry32(1234);
    for (let i = 0; i < 300; i++) {
      const p: Vec3 = [(rng() - 0.5) * 3, (rng() - 0.5) * 3, (rng() - 0.5) * 3];
      const nearest = nearestDistance(cloud, p);
      expect(estimateDistance(de, p)).toBeLessThanOrEqual(nearest + 1e-6);
    }
  });
});

describe("estimateDistance beam descent (fr-v6yg)", () => {
  it("buildSurfaceDE always builds beamWidth 2", () => {
    const de = buildSurfaceDE(sierpinskiTetrahedron());
    expect(de.beamWidth).toBe(2);
  });

  it("holds for the 3D mirror of doubleRotation's profile: no jittered query exceeds the cloud-distance bound", () => {
    // The 3D mirror of the 4D `doubleRotation` preset's profile (2 maps,
    // weight 6:1, sigma 0.93 vs 0.22 — see `surface-de-4d.test.ts`'s
    // doubleRotation descent-depth-stress tests for the 4D original this
    // mirrors). Its slowest map (sigma 0.93) drives maxDepth to the
    // 48-level cap, same as that 4D twin's depth-stress test — so this uses
    // the same 1e-6 tolerance that test documents an accumulated fp-noise
    // floor for (~1e-7 at 48 levels), looser than the other estimateDistance
    // tests above.
    const transforms: Transform[] = [
      {
        id: 0,
        position: [0, 0, 0],
        rotation: [0, 0, 0.55],
        scale: [0.93, 0.93, 0.93],
        weight: 6,
      },
      {
        id: 1,
        position: [0.85, 0, 0],
        rotation: [0, 0, 0],
        scale: [0.22, 0.22, 0.22],
        weight: 1,
      },
    ];
    const de = buildSurfaceDE(transforms);
    const cloud = runChaosGame(transforms, 20000, mulberry32(1));
    const jitterRng = mulberry32(2);
    const queries: Vec3[] = [];
    for (let i = 0; i < cloud.count; i += 40) {
      queries.push([
        cloud.positions[i * 3] + (jitterRng() - 0.5) * 0.3,
        cloud.positions[i * 3 + 1] + (jitterRng() - 0.5) * 0.3,
        cloud.positions[i * 3 + 2] + (jitterRng() - 0.5) * 0.3,
      ]);
    }
    for (const q of queries) {
      const nearest = nearestDistance(cloud, q);
      expect(estimateDistance(de, q)).toBeLessThanOrEqual(nearest + 1e-6);
    }
  });

  it("overshoots somewhere on the same queries when forced to beamWidth 1 — the fr-v6yg overshoot the beam repairs", () => {
    // Same profile and query construction as the fix test above, forced
    // back to beamWidth 1 (the old single-chain algorithm). Measured (this
    // exact profile, this test's cloud/query construction): max excess
    // ~26% of R — the same order of magnitude as the module doc's own
    // harness figure for this profile (worst measured case across every
    // system it tried, ~19% of R over a broader query sweep).
    const transforms: Transform[] = [
      {
        id: 0,
        position: [0, 0, 0],
        rotation: [0, 0, 0.55],
        scale: [0.93, 0.93, 0.93],
        weight: 6,
      },
      {
        id: 1,
        position: [0.85, 0, 0],
        rotation: [0, 0, 0],
        scale: [0.22, 0.22, 0.22],
        weight: 1,
      },
    ];
    const de = { ...buildSurfaceDE(transforms), beamWidth: 1 as const };
    const cloud = runChaosGame(transforms, 20000, mulberry32(1));
    const jitterRng = mulberry32(2);
    const queries: Vec3[] = [];
    for (let i = 0; i < cloud.count; i += 40) {
      queries.push([
        cloud.positions[i * 3] + (jitterRng() - 0.5) * 0.3,
        cloud.positions[i * 3 + 1] + (jitterRng() - 0.5) * 0.3,
        cloud.positions[i * 3 + 2] + (jitterRng() - 0.5) * 0.3,
      ]);
    }
    const violatesSomewhere = queries.some((q) => {
      const nearest = nearestDistance(cloud, q);
      return estimateDistance(de, q) > nearest + 1e-9;
    });
    expect(violatesSomewhere).toBe(true);
  });
});

describe("buildSurfaceDE with kaleidoscope symmetry", () => {
  it("expands to order * baseCount maps, cycling baseIndex through the base maps", () => {
    const transforms = sierpinskiTetrahedron();
    const de = buildSurfaceDE(transforms, null, { order: 3, axis: "z" });
    expect(de.maps).toHaveLength(12);
    expect(de.maps.map((m) => m.baseIndex)).toEqual([
      0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3,
    ]);
  });
});

describe("estimateDistance with kaleidoscope symmetry", () => {
  it("stays within 0.08 of the symmetric attractor for points sampled on it", () => {
    const transforms = sierpinskiTetrahedron();
    const symmetry = { order: 3, axis: "z" } as const;
    const de = buildSurfaceDE(transforms, null, symmetry);
    const cloud = runChaosGame(
      transforms,
      20000,
      mulberry32(42),
      null,
      symmetry,
    );
    for (let i = 0; i < 300; i++) {
      const idx = (i * 61) % cloud.count;
      const p: Vec3 = [
        cloud.positions[idx * 3],
        cloud.positions[idx * 3 + 1],
        cloud.positions[idx * 3 + 2],
      ];
      expect(estimateDistance(de, p)).toBeLessThanOrEqual(0.08);
    }
  });
});

// -----------------------------------------------------------------------
// estimateDistanceRefined (fr-1z6p — fr-beck's 4D ghost-eliminator ported
// down; see the module doc's refined-certificates paragraph): one extra
// Hutchinson level applied to escaped-sibling certificates before they
// freeze, lifting the barely-escaped near-zero bounds the marcher
// false-hit as smooth "balloon" membranes across attractor voids. The GLSL
// tracer mirrors THIS estimator; the plain one stays as the mechanism seam.
// -----------------------------------------------------------------------

describe("estimateDistanceRefined never falls below the base estimate", () => {
  it("holds for sierpinskiTetrahedron across jittered, uniform, and on-cloud queries", () => {
    const transforms = sierpinskiTetrahedron();
    const de = buildSurfaceDE(transforms);
    const cloud = runChaosGame(transforms, 20000, mulberry32(42));
    const rng = mulberry32(9);
    const queries: Vec3[] = [];
    for (let i = 0; i < 60; i++) {
      const idx = (i * 331) % cloud.count;
      queries.push([
        cloud.positions[idx * 3] + (rng() - 0.5) * 0.3,
        cloud.positions[idx * 3 + 1] + (rng() - 0.5) * 0.3,
        cloud.positions[idx * 3 + 2] + (rng() - 0.5) * 0.3,
      ]);
    }
    for (let i = 0; i < 40; i++) {
      queries.push([(rng() - 0.5) * 3, (rng() - 0.5) * 3, (rng() - 0.5) * 3]);
    }
    for (let i = 0; i < 20; i++) {
      const idx = (i * 977) % cloud.count;
      queries.push([
        cloud.positions[idx * 3],
        cloud.positions[idx * 3 + 1],
        cloud.positions[idx * 3 + 2],
      ]);
    }
    for (const q of queries) {
      expect(estimateDistanceRefined(de, q)).toBeGreaterThanOrEqual(
        estimateDistance(de, q) - 1e-12,
      );
    }
  });
});

describe("estimateDistanceRefined validity (never exceeds the true distance to a sampled cloud)", () => {
  it("holds for sierpinskiTetrahedron across uniform probes", () => {
    const transforms = sierpinskiTetrahedron();
    const de = buildSurfaceDE(transforms);
    const cloud = runChaosGame(transforms, 200000, mulberry32(7));
    const rng = mulberry32(1234);
    for (let i = 0; i < 300; i++) {
      const p: Vec3 = [(rng() - 0.5) * 3, (rng() - 0.5) * 3, (rng() - 0.5) * 3];
      const nearest = nearestDistance(cloud, p);
      expect(estimateDistanceRefined(de, p)).toBeLessThanOrEqual(
        nearest + 1e-6,
      );
    }
  });

  it("on a kaleidoscope system, trades the base estimator's balloons for the disclosed fr-jkpn overshoot envelope", () => {
    // 3D-specific coverage the 4D suite has no analogue for: the refined
    // inner sweep runs over the symmetry-EXPANDED map list (12 slots here),
    // whose rotated inverses only exist in this module. Order 3 triples
    // every branch, so >= 3 simultaneous in-sphere branches drop uncounted
    // (fr-jkpn) — which breaks STRICT validity for the refined estimator:
    // raising certificates elsewhere exposes the invalid min the dropped
    // branches leave behind. Measured on this exact cloud/probe stream:
    //   base:    0 violations, but 3/140 genuine-void probes read under
    //            the 0.01R marcher proxy — balloons on the symmetric
    //            render (probe #76: est 0.0009 vs true distance 0.0564)
    //   refined: 0 ghosts, 2/200 probes overshoot by <= 0.0465 (2.6%R) —
    //            the disclosed fr-jkpn class (~2-5%R)
    // So this pins the TRADE, not strict validity: refined stays inside
    // the disclosed envelope and eliminates every balloon, while the base
    // estimator (checked by the same sweep) still fabricates them.
    const transforms = sierpinskiTetrahedron();
    const symmetry = { order: 3, axis: "z" } as const;
    const de = buildSurfaceDE(transforms, null, symmetry);
    const R = de.boundingRadius;
    const cloud = runChaosGame(
      transforms,
      300000,
      mulberry32(7),
      null,
      symmetry,
    );
    const rng = mulberry32(1234);
    let baseGhosts = 0;
    for (let i = 0; i < 200; i++) {
      const p: Vec3 = [(rng() - 0.5) * 3, (rng() - 0.5) * 3, (rng() - 0.5) * 3];
      const nearest = nearestDistance(cloud, p);
      const refined = estimateDistanceRefined(de, p);
      expect(refined).toBeLessThanOrEqual(nearest + 0.05 * R);
      if (nearest > 0.05 * R) {
        if (estimateDistance(de, p) < 0.01 * R) baseGhosts++;
        expect(refined).toBeGreaterThanOrEqual(0.01 * R);
      }
    }
    expect(baseGhosts).toBeGreaterThan(0);
  });

  it("holds at the built width on the doubleRotation-mirror profile — refinement does not reopen the branch-selection overshoot the beam closed", () => {
    // The scary interaction, pinned: refinement RAISES certificates, and on
    // profiles where descent drops in-sphere branches (fr-jkpn) a raised min
    // can expose more of the drop's invalidity — fr-beck measured exactly
    // that at width 1 in 4D. At the BUILT width 2 the beam keeps this
    // profile clean, refined or not (harness: viol=4 exact-class @5.2e-9 fp
    // noise, maxExcess 0.0%R). Same 48-level depth cap and 1e-6 tolerance
    // as the base estimator's beam tests above.
    const transforms: Transform[] = [
      {
        id: 0,
        position: [0, 0, 0],
        rotation: [0, 0, 0.55],
        scale: [0.93, 0.93, 0.93],
        weight: 6,
      },
      {
        id: 1,
        position: [0.85, 0, 0],
        rotation: [0, 0, 0],
        scale: [0.22, 0.22, 0.22],
        weight: 1,
      },
    ];
    const de = buildSurfaceDE(transforms);
    const cloud = runChaosGame(transforms, 20000, mulberry32(1));
    const jitterRng = mulberry32(2);
    for (let i = 0; i < cloud.count; i += 40) {
      const q: Vec3 = [
        cloud.positions[i * 3] + (jitterRng() - 0.5) * 0.3,
        cloud.positions[i * 3 + 1] + (jitterRng() - 0.5) * 0.3,
        cloud.positions[i * 3 + 2] + (jitterRng() - 0.5) * 0.3,
      ];
      const nearest = nearestDistance(cloud, q);
      expect(estimateDistanceRefined(de, q)).toBeLessThanOrEqual(
        nearest + 1e-6,
      );
    }
  });
});

describe("estimateDistanceRefined collapses a measured balloon point the base estimator false-hits", () => {
  it("clears the sierpinski central-void probe that rendered as a membrane across the cavity", () => {
    // Pinned from the fr-1z6p finder (cloud mulberry32(101)/300_000, uniform
    // probe stream mulberry32(3), probe #140): a genuine void point in the
    // tetrahedron's central cavity — the smooth membrane the surface render
    // visibly painted across it. Measured (this build, bit-exact to
    // R = 1.7736184730150315):
    //   width-2 base    = 0.010280685515655863  (< 0.01*R = 0.0177...: a
    //                     marcher false-hit — the balloon)
    //   width-2 refined = 0.2739168941440459    (clears eps_hit 15x over)
    //   true nearest sampled distance = 0.3634189034867699 (20% of R)
    const de = buildSurfaceDE(sierpinskiTetrahedron());
    const p: Vec3 = [
      0.20299153421451924, -0.2487552135097045, -0.019194388149953938,
    ];
    expect(estimateDistance(de, p)).toBeLessThan(0.01 * de.boundingRadius);
    expect(estimateDistanceRefined(de, p)).toBeGreaterThan(0.1);
  });

  it("clears a default-preset void probe the same way", () => {
    // Same finder, default preset, probe #464. Measured: base
    // 0.014314948609363665 (< 0.01*R = 0.01792...), refined
    // 0.09926437339620453, true nearest sampled distance 0.229 (13% of R).
    const de = buildSurfaceDE(defaultTransforms());
    const p: Vec3 = [
      -0.03995422658712331, -0.12167598089345305, -0.1888897693966145,
    ];
    expect(estimateDistance(de, p)).toBeLessThan(0.01 * de.boundingRadius);
    expect(estimateDistanceRefined(de, p)).toBeGreaterThan(0.05);
  });
});

describe("buildSurfaceDE / estimateDistance with a final transform", () => {
  function finalT(): Transform {
    return {
      id: 99,
      position: [0.3, -0.2, 0.1],
      rotation: [0.4, 0.2, -0.3],
      scale: [0.8, 0.8, 0.8],
    };
  }

  it("stays within 0.05 of the attractor for points sampled through the lens", () => {
    const transforms = sierpinskiTetrahedron();
    const de = buildSurfaceDE(transforms, finalT());
    const cloud = runChaosGame(transforms, 20000, mulberry32(42), finalT());
    for (let i = 0; i < 300; i++) {
      const idx = (i * 61) % cloud.count;
      const p: Vec3 = [
        cloud.positions[idx * 3],
        cloud.positions[idx * 3 + 1],
        cloud.positions[idx * 3 + 2],
      ];
      expect(estimateDistance(de, p)).toBeLessThanOrEqual(0.05);
    }
  });

  it("derives visibleBoundingRadius from the lens's sigma_max and translation length", () => {
    const de = buildSurfaceDE(sierpinskiTetrahedron(), finalT());
    const expected = 0.8 * de.boundingRadius + Math.hypot(0.3, -0.2, 0.1);
    expect(de.visibleBoundingRadius).toBeCloseTo(expected, 6);
  });
});

describe("SurfaceDEMap inverse contract", () => {
  it("un-rotates then un-maps a kaleidoscope slot back to the original point", () => {
    const transforms = sierpinskiTetrahedron();
    const order = 3;
    const de = buildSurfaceDE(transforms, null, { order, axis: "z" });
    const point: Vec3 = [0.3, -0.2, 0.5];

    for (const slot of [0, 6]) {
      const baseIndex = slot % 4;
      const k = Math.floor(slot / 4);
      const forward = applyAffine(
        composeAffine(transforms[baseIndex]),
        point[0],
        point[1],
        point[2],
      );
      const rot = rotationMatrixXYZ(0, 0, (2 * Math.PI * k) / order);
      const rotated: Vec3 = [
        rot[0] * forward[0] + rot[1] * forward[1] + rot[2] * forward[2],
        rot[3] * forward[0] + rot[4] * forward[1] + rot[5] * forward[2],
        rot[6] * forward[0] + rot[7] * forward[1] + rot[8] * forward[2],
      ];

      const slotMap = de.maps[slot];
      const back = applyAffine(
        { m: slotMap.invM, t: slotMap.invT },
        rotated[0],
        rotated[1],
        rotated[2],
      );

      expect(back[0]).toBeCloseTo(point[0], 10);
      expect(back[1]).toBeCloseTo(point[1], 10);
      expect(back[2]).toBeCloseTo(point[2], 10);
    }
  });
});
