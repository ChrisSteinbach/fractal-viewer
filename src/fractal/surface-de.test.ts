import {
  analyzeSurfaceSystem,
  buildSurfaceDE,
  estimateDistance,
  estimateDistanceRefined,
  singularValues3,
  transformSigmas,
} from "./surface-de";
import type { SurfaceDE, SurfaceDEMap } from "./surface-de";
import { applyAffine, composeAffine, rotationMatrixXYZ } from "./affine";
import { runChaosGame, symmetryRotation } from "./chaos-game";
import type { ChaosGameResult } from "./chaos-game";
import {
  defaultTransforms,
  mengerSponge,
  sierpinskiTetrahedron,
} from "./presets";
import { mulberry32 } from "./rng";
import type { SymmetryAxis, Transform, Vec3 } from "./types";

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

/** Row-major 3x3 transpose. */
function transpose3(m: number[]): number[] {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

/** Row-major 3x3 product `a · b`. */
function mulMat3(a: number[], b: number[]): number[] {
  const out = new Array<number>(9);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      out[row * 3 + col] =
        a[row * 3] * b[col] +
        a[row * 3 + 1] * b[3 + col] +
        a[row * 3 + 2] * b[6 + col];
    }
  }
  return out;
}

/**
 * The pre-fr-x029 symmetry EXPANSION, preserved here and only here as the
 * reference oracle the sector sweep is measured against: materialise every
 * kaleidoscope copy `Rot_k . f_i` into its own composed inverse slot
 * (`inv(M_i) . Rot_k^T`, sector-major, copy 0 unrotated first — the exact
 * lines `buildSurfaceDE` used to run) and hand back a symmetry-FREE
 * `SurfaceDE`. Order 1 leaves the descent no sectors to sweep, so the
 * returned descriptor reproduces exactly what production computed before
 * the sweep landed.
 */
function expandedReference(de: SurfaceDE): SurfaceDE {
  const { order, axis } = de.symmetry;
  const maps: SurfaceDEMap[] = [];
  for (let k = 0; k < order; k++) {
    const rotT = transpose3(symmetryRotation(axis, (2 * Math.PI * k) / order));
    for (const base of de.maps) {
      maps.push({
        invM: mulMat3(base.invM, rotT),
        invT: base.invT,
        sigmaMin: base.sigmaMin,
        foldKind: base.foldKind,
        foldInvW: base.foldInvW,
        foldSigma: base.foldSigma,
        baseIndex: base.baseIndex,
      });
    }
  }
  return {
    ...de,
    maps,
    symmetry: { order: 1, axis, stepCos: 1, stepSin: 0 },
  };
}

/** Walk `p` through `k` sector steps exactly as the descent's sweep does. */
function sectorPoint(de: SurfaceDE, k: number, p: Vec3): Vec3 {
  const { axis, stepCos: c, stepSin: s } = de.symmetry;
  let out: Vec3 = [p[0], p[1], p[2]];
  for (let n = 0; n < k; n++) {
    const [x, y, z] = out;
    if (axis === "x") out = [x, c * y + s * z, -s * y + c * z];
    else if (axis === "y") out = [c * x - s * z, y, s * x + c * z];
    else out = [c * x + s * y, -s * x + c * y, z];
  }
  return out;
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
  it("buildSurfaceDE always builds beamWidth 4 — the fr-v6yg pair plus the fr-jkpn validity slots", () => {
    const de = buildSurfaceDE(sierpinskiTetrahedron());
    expect(de.beamWidth).toBe(4);
  });

  it("holds for the 3D mirror of doubleRotation's profile: no jittered query exceeds the cloud-distance bound", () => {
    // The 3D mirror of the 4D `doubleRotation` preset's profile (2 maps,
    // weight 6:1, sigma 0.93 vs 0.22 — see `surface-de-4d.test.ts`'s
    // doubleRotation descent-depth-stress tests for the 4D original this
    // mirrors). Its slowest map (sigma 0.93) drives maxDepth to 127
    // levels (the full formula depth under fr-xok8's MAX_DESCENT_DEPTH
    // ceiling), same as that 4D twin's depth-stress test — so this uses
    // the same 1e-6 tolerance that test documents an accumulated fp-noise
    // floor for, looser than the other estimateDistance tests above.
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
  it("keeps one map slot per base transform instead of expanding by order", () => {
    const transforms = sierpinskiTetrahedron();
    const de = buildSurfaceDE(transforms, null, { order: 3, axis: "z" });
    expect(de.maps).toHaveLength(4);
    expect(de.maps.map((m) => m.baseIndex)).toEqual([0, 1, 2, 3]);
  });

  it("carries the kaleidoscope as sector data the descent sweeps", () => {
    const de = buildSurfaceDE(sierpinskiTetrahedron(), null, {
      order: 3,
      axis: "z",
    });
    expect(de.symmetry.order).toBe(3);
    expect(de.symmetry.axis).toBe("z");
    expect(de.symmetry.stepCos).toBeCloseTo(Math.cos((2 * Math.PI) / 3), 12);
    expect(de.symmetry.stepSin).toBeCloseTo(Math.sin((2 * Math.PI) / 3), 12);
  });

  it("reports a single sector for a system without symmetry", () => {
    const de = buildSurfaceDE(sierpinskiTetrahedron());
    expect(de.symmetry.order).toBe(1);
  });

  it("clamps the sector count exactly as the chaos game does", () => {
    // effectiveSymmetryOrder caps order * transforms.length at MAX_TRANSFORMS
    // (256), so 4 base maps can never sweep more than 64 sectors — the DE's
    // swept set has to be the plotted set.
    const de = buildSurfaceDE(sierpinskiTetrahedron(), null, {
      order: 200,
      axis: "y",
    });
    expect(de.symmetry.order).toBe(64);
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

// ——— fr-x029: the sector sweep that replaced the symmetry expansion ———
//
// The sweep re-associates `inv(M_i) . Rot_k^T . q` into
// `inv(M_i) . (Rot_k^T . q)` and walks the sectors incrementally, so it is
// the SAME candidate set in the SAME order — only the floating-point
// association differs. These tests hold it to that: agreement with the
// expansion it replaced (which lives above as `expandedReference`), with
// the strict lower-bound direction asserted separately, because an estimate
// that came out ABOVE the reference's would be a march that steps through
// surfaces. The measured deviation on every case below is ~1e-16 absolute
// — deep-descent fp noise, orders of magnitude under the 1e-9 the
// assertions allow.
const SWEEP_FP_TOLERANCE = 1e-9;

describe("sector sweep agreement with the symmetry expansion", () => {
  it("reproduces the expansion's estimate for an order-3 z kaleidoscope", () => {
    const de = buildSurfaceDE(sierpinskiTetrahedron(), null, {
      order: 3,
      axis: "z",
    });
    const reference = expandedReference(de);
    expect(de.maps).toHaveLength(4);
    expect(reference.maps).toHaveLength(12);
    const rng = mulberry32(1234);
    for (let i = 0; i < 400; i++) {
      const p: Vec3 = [(rng() - 0.5) * 3, (rng() - 0.5) * 3, (rng() - 0.5) * 3];
      expect(estimateDistanceRefined(de, p)).toBeCloseTo(
        estimateDistanceRefined(reference, p),
        9,
      );
    }
  });

  it("reproduces the expansion's estimate for an order-5 y kaleidoscope", () => {
    const de = buildSurfaceDE(sierpinskiTetrahedron(), null, {
      order: 5,
      axis: "y",
    });
    const reference = expandedReference(de);
    const rng = mulberry32(99);
    for (let i = 0; i < 400; i++) {
      const p: Vec3 = [(rng() - 0.5) * 3, (rng() - 0.5) * 3, (rng() - 0.5) * 3];
      expect(estimateDistanceRefined(de, p)).toBeCloseTo(
        estimateDistanceRefined(reference, p),
        9,
      );
    }
  });

  it("reproduces the expansion's estimate for an order-6 x kaleidoscope", () => {
    const de = buildSurfaceDE(sierpinskiTetrahedron(), null, {
      order: 6,
      axis: "x",
    });
    const reference = expandedReference(de);
    const rng = mulberry32(2024);
    for (let i = 0; i < 400; i++) {
      const p: Vec3 = [(rng() - 0.5) * 3, (rng() - 0.5) * 3, (rng() - 0.5) * 3];
      expect(estimateDistanceRefined(de, p)).toBeCloseTo(
        estimateDistanceRefined(reference, p),
        9,
      );
    }
  });

  it("keeps the width-1 greedy descent on the expansion's numbers too", () => {
    // The legacy estimator shares the descent body, so it sweeps sectors on
    // exactly the same code path — pinned separately because its single
    // chain reaches different branches than the production beam does.
    const de = buildSurfaceDE(sierpinskiTetrahedron(), null, {
      order: 5,
      axis: "z",
    });
    const narrow = { ...de, beamWidth: 1 } as const;
    const reference = { ...expandedReference(de), beamWidth: 1 } as const;
    const rng = mulberry32(555);
    for (let i = 0; i < 300; i++) {
      const p: Vec3 = [(rng() - 0.5) * 4, (rng() - 0.5) * 4, (rng() - 0.5) * 4];
      expect(estimateDistance(narrow, p)).toBeCloseTo(
        estimateDistance(reference, p),
        9,
      );
    }
  });

  it("never over-estimates the expansion's bound on any supported axis", () => {
    // The direction that matters: an estimate ABOVE the reference's is a
    // march that steps through a surface. Asserted one-sided across every
    // axis and a spread of orders, on both estimators.
    const table: { order: number; axis: SymmetryAxis }[] = [
      { order: 2, axis: "x" },
      { order: 3, axis: "y" },
      { order: 4, axis: "z" },
      { order: 5, axis: "x" },
      { order: 6, axis: "y" },
    ];
    for (const symmetry of table) {
      const de = buildSurfaceDE(sierpinskiTetrahedron(), null, symmetry);
      const reference = expandedReference(de);
      const rng = mulberry32(17);
      for (let i = 0; i < 200; i++) {
        const p: Vec3 = [
          (rng() - 0.5) * 3,
          (rng() - 0.5) * 3,
          (rng() - 0.5) * 3,
        ];
        expect(estimateDistanceRefined(de, p)).toBeLessThanOrEqual(
          estimateDistanceRefined(reference, p) + SWEEP_FP_TOLERANCE,
        );
        expect(estimateDistance(de, p)).toBeLessThanOrEqual(
          estimateDistance(reference, p) + SWEEP_FP_TOLERANCE,
        );
      }
    }
  });

  it("agrees with the expansion on hit decisions at march epsilons", () => {
    const de = buildSurfaceDE(sierpinskiTetrahedron(), null, {
      order: 5,
      axis: "z",
    });
    const reference = expandedReference(de);
    const rng = mulberry32(808);
    for (const epsilon of [0.001, 0.01, 0.05]) {
      for (let i = 0; i < 200; i++) {
        const p: Vec3 = [
          (rng() - 0.5) * 3,
          (rng() - 0.5) * 3,
          (rng() - 0.5) * 3,
        ];
        expect(estimateDistanceRefined(de, p) < epsilon).toBe(
          estimateDistanceRefined(reference, p) < epsilon,
        );
      }
    }
  });

  it("sweeps every sector at any blend, exactly as the expansion included every copy", () => {
    // SymmetryParams.blend fades the rotated copies' SELECTION WEIGHTS, not
    // their geometry, and the expansion never read it when choosing which
    // copies to materialise — so a DE built at blend 0 still describes the
    // full kaleidoscope, not the bare base system.
    const transforms = sierpinskiTetrahedron();
    for (const blend of [0, 0.35, 1]) {
      const de = buildSurfaceDE(transforms, null, {
        order: 4,
        axis: "y",
        blend,
      });
      expect(de.symmetry.order).toBe(4);
      const reference = expandedReference(de);
      expect(reference.maps).toHaveLength(16);
      const rng = mulberry32(1010);
      for (let i = 0; i < 150; i++) {
        const p: Vec3 = [
          (rng() - 0.5) * 3,
          (rng() - 0.5) * 3,
          (rng() - 0.5) * 3,
        ];
        expect(estimateDistanceRefined(de, p)).toBeCloseTo(
          estimateDistanceRefined(reference, p),
          9,
        );
      }
    }
  });

  it("still lets blend move the probed bounding radius, exactly as before", () => {
    // Not a symmetry-support question: blend reaches the DE only through the
    // seeded chaos-game probe that sizes `boundingRadius` (a faded copy is
    // drawn less often, so the sampled extent shifts). The expansion fed
    // that same probe the same params, so this is unchanged behavior —
    // pinned here so the "blend never moves the swept geometry" claim above
    // cannot be misread as "blend is inert".
    const transforms = sierpinskiTetrahedron();
    const full = buildSurfaceDE(transforms, null, { order: 4, axis: "y" });
    const faded = buildSurfaceDE(transforms, null, {
      order: 4,
      axis: "y",
      blend: 0,
    });
    expect(faded.boundingRadius).not.toBeCloseTo(full.boundingRadius, 3);
  });
});

describe("sector sweep at the wedge boundaries", () => {
  // Where a naive KIFS fold breaks: a fold picks ONE group element from the
  // query's own angle, and near a sector boundary the certificate-minimising
  // element can be a NEIGHBOUR — so the fold minimises over a subset and
  // comes out too high. The sweep has no such seam (it keeps every sector),
  // and these probes sit exactly where the seam would have been.

  /** A probe at cylindrical `(radius, angle)` about the z axis. */
  function aboutZ(radius: number, angle: number, z: number): Vec3 {
    return [radius * Math.cos(angle), radius * Math.sin(angle), z];
  }

  it("matches the expansion for probes lying exactly on a sector boundary", () => {
    const order = 6;
    const de = buildSurfaceDE(sierpinskiTetrahedron(), null, {
      order,
      axis: "z",
    });
    const reference = expandedReference(de);
    for (let k = 0; k < order; k++) {
      const angle = (2 * Math.PI * k) / order;
      for (const radius of [0.2, 0.6, 1.1]) {
        for (const z of [-0.4, 0, 0.5]) {
          const p = aboutZ(radius, angle, z);
          expect(estimateDistanceRefined(de, p)).toBeCloseTo(
            estimateDistanceRefined(reference, p),
            9,
          );
        }
      }
    }
  });

  it("matches the expansion just either side of a sector boundary", () => {
    const order = 6;
    const de = buildSurfaceDE(sierpinskiTetrahedron(), null, {
      order,
      axis: "z",
    });
    const reference = expandedReference(de);
    for (let k = 0; k < order; k++) {
      const boundary = (2 * Math.PI * k) / order;
      for (const nudge of [-1e-3, -1e-7, 1e-7, 1e-3]) {
        for (const radius of [0.3, 0.9]) {
          const p = aboutZ(radius, boundary + nudge, 0.25);
          expect(estimateDistanceRefined(de, p)).toBeCloseTo(
            estimateDistanceRefined(reference, p),
            9,
          );
        }
      }
    }
  });

  it("matches the expansion near the axis where every sector converges", () => {
    const order = 8;
    const de = buildSurfaceDE(sierpinskiTetrahedron(), null, {
      order,
      axis: "z",
    });
    const reference = expandedReference(de);
    const rng = mulberry32(4242);
    for (let i = 0; i < 200; i++) {
      // Radii collapsing onto the axis, where the sectors are within
      // fp-noise of each other and a fold's choice is arbitrary.
      const radius = 10 ** (-1 - 6 * rng());
      const p = aboutZ(radius, rng() * 2 * Math.PI, (rng() - 0.5) * 1.5);
      expect(estimateDistanceRefined(de, p)).toBeCloseTo(
        estimateDistanceRefined(reference, p),
        9,
      );
    }
  });

  it("stays a valid bound for probes exactly ON the symmetry axis", () => {
    // The axis is the sweep's one genuinely degenerate configuration: every
    // sector rotation FIXES it, so all `order` sector points are bit-equal
    // and the candidate ladder sees exact ties. Validity is what has to
    // hold there — never a bound above the true distance — and it does.
    const transforms = sierpinskiTetrahedron();
    const symmetry = { order: 7, axis: "z" } as const;
    const de = buildSurfaceDE(transforms, null, symmetry);
    const cloud = runChaosGame(
      transforms,
      200000,
      mulberry32(7),
      null,
      symmetry,
    );
    for (let i = 0; i < 60; i++) {
      const p: Vec3 = [0, 0, -2 + (4 * i) / 59];
      expect(estimateDistanceRefined(de, p)).toBeLessThanOrEqual(
        nearestDistance(cloud, p) + 1e-6,
      );
    }
  });

  it("splits exact sector ties deterministically where the expansion split them by rounding", () => {
    // The one place the sweep is not a pure repacking, pinned rather than
    // papered over. On the axis every sector's image is bit-identical under
    // the sweep, while the expansion's COMPOSED matrices carried per-copy
    // rounding that scattered the tie — so the two fill the beam with
    // different (equally certified) branches and their estimates part
    // company. Measured at order 5: 21 of 400 axis probes differ, by up to
    // 1.25e-2 in either direction, with both estimators valid against the
    // attractor throughout. Off the axis, where nothing ties, the two agree
    // to 1e-15 (the suites above).
    const de = buildSurfaceDE(sierpinskiTetrahedron(), null, {
      order: 5,
      axis: "z",
    });
    const reference = expandedReference(de);
    let differing = 0;
    for (let i = 0; i < 400; i++) {
      const p: Vec3 = [0, 0, -2 + (4 * i) / 399];
      const gap = Math.abs(
        estimateDistanceRefined(de, p) - estimateDistanceRefined(reference, p),
      );
      if (gap > SWEEP_FP_TOLERANCE) differing++;
      expect(gap).toBeLessThan(0.02);
    }
    expect(differing).toBeGreaterThan(0);
  });
});

describe("kaleidoscope orders the symmetry expansion could not carry", () => {
  // 4 base maps x order 8 = 32 expanded slots, past the tracer's 24-slot
  // budget: the class the mode used to refuse outright. The sweep carries it
  // in 4 slots, so the only question left is whether the estimate is any
  // good.
  const beyondCap = { order: 8, axis: "z" } as const;

  it("builds in base-sized slots where the expansion would have overflowed", () => {
    const de = buildSurfaceDE(sierpinskiTetrahedron(), null, beyondCap);
    expect(de.maps).toHaveLength(4);
    expect(de.symmetry.order).toBe(8);
    expect(de.maps.length * de.symmetry.order).toBeGreaterThan(24);
  });

  it("reads as a hit on points sampled from the beyond-cap attractor", () => {
    const transforms = sierpinskiTetrahedron();
    const de = buildSurfaceDE(transforms, null, beyondCap);
    const cloud = runChaosGame(
      transforms,
      20000,
      mulberry32(42),
      null,
      beyondCap,
    );
    for (let i = 0; i < 300; i++) {
      const idx = (i * 61) % cloud.count;
      const p: Vec3 = [
        cloud.positions[idx * 3],
        cloud.positions[idx * 3 + 1],
        cloud.positions[idx * 3 + 2],
      ];
      expect(estimateDistanceRefined(de, p)).toBeLessThanOrEqual(
        0.02 * de.boundingRadius,
      );
    }
  });

  it("computes exactly what the expansion would have, 32 slots and all", () => {
    // The decisive one for the newly-admitted class: the estimate the mode
    // now serves is the estimate the old code would have produced if its
    // uniform arrays had been big enough. Measured over 3000 probes,
    // maxAbs = 8.9e-16.
    const de = buildSurfaceDE(sierpinskiTetrahedron(), null, beyondCap);
    const reference = expandedReference(de);
    expect(reference.maps).toHaveLength(32);
    const rng = mulberry32(31337);
    for (let i = 0; i < 600; i++) {
      const p: Vec3 = [(rng() - 0.5) * 3, (rng() - 0.5) * 3, (rng() - 0.5) * 3];
      expect(estimateDistanceRefined(de, p)).toBeCloseTo(
        estimateDistanceRefined(reference, p),
        9,
      );
    }
  });

  it("never over-estimates the distance to the beyond-cap attractor", () => {
    const transforms = sierpinskiTetrahedron();
    const de = buildSurfaceDE(transforms, null, beyondCap);
    const cloud = runChaosGame(
      transforms,
      200000,
      mulberry32(7),
      null,
      beyondCap,
    );
    const rng = mulberry32(1234);
    for (let i = 0; i < 200; i++) {
      const p: Vec3 = [(rng() - 0.5) * 3, (rng() - 0.5) * 3, (rng() - 0.5) * 3];
      expect(estimateDistanceRefined(de, p)).toBeLessThanOrEqual(
        nearestDistance(cloud, p) + 1e-6,
      );
    }
  });

  it("ghosts in voids at high order exactly as much as the expansion does", () => {
    // The feature's honest limitation, pinned to the ORDER rather than to
    // the sweep. The module doc's disclosed interaction — order >= 3
    // multiplies every branch, so levels with more simultaneous in-sphere
    // branches than the beam has slots get common — bites hard at order 8:
    // 11 of 101 genuine-void probes read under the marcher's 0.01R floor,
    // and the minimum void estimate goes slightly negative. The expansion
    // scores IDENTICALLY on the same probes, so lifting the cap exposes a
    // pre-existing high-order weakness rather than introducing one; the
    // beam width, not the map packing, is what would close it.
    const transforms = sierpinskiTetrahedron();
    const de = buildSurfaceDE(transforms, null, beyondCap);
    const reference = expandedReference(de);
    const R = de.boundingRadius;
    const cloud = runChaosGame(
      transforms,
      200000,
      mulberry32(7),
      null,
      beyondCap,
    );
    const rng = mulberry32(1234);
    let voidProbes = 0;
    let sweepGhosts = 0;
    let referenceGhosts = 0;
    for (let i = 0; i < 200; i++) {
      const p: Vec3 = [(rng() - 0.5) * 3, (rng() - 0.5) * 3, (rng() - 0.5) * 3];
      if (nearestDistance(cloud, p) <= 0.05 * R) continue;
      voidProbes++;
      if (estimateDistanceRefined(de, p) < 0.01 * R) sweepGhosts++;
      if (estimateDistanceRefined(reference, p) < 0.01 * R) referenceGhosts++;
    }
    expect(voidProbes).toBeGreaterThan(20);
    expect(sweepGhosts).toBe(referenceGhosts);
    expect(sweepGhosts).toBeGreaterThan(0);
  });
});

describe("estimateDistanceRefined cutoff on a swept kaleidoscope", () => {
  // fr-55r5's contract has to survive the sweep: the early-out exits sit
  // inside the loop the sector sweep now wraps.
  const symmetry = { order: 8, axis: "z" } as const;

  it("returns the full-descent value whenever the result clears the cutoff", () => {
    const de = buildSurfaceDE(sierpinskiTetrahedron(), null, symmetry);
    const rng = mulberry32(31337);
    let cleared = 0;
    for (let i = 0; i < 300; i++) {
      const p: Vec3 = [(rng() - 0.5) * 3, (rng() - 0.5) * 3, (rng() - 0.5) * 3];
      const cutoff = 0.02 * de.boundingRadius;
      const early = estimateDistanceRefined(de, p, cutoff);
      if (early < cutoff) continue;
      cleared++;
      expect(early).toBe(estimateDistanceRefined(de, p));
    }
    expect(cleared).toBeGreaterThan(50);
  });

  it("agrees with the full descent whenever the result falls under the cutoff", () => {
    const de = buildSurfaceDE(sierpinskiTetrahedron(), null, symmetry);
    const rng = mulberry32(31337);
    let dipped = 0;
    for (let i = 0; i < 300; i++) {
      const p: Vec3 = [(rng() - 0.5) * 3, (rng() - 0.5) * 3, (rng() - 0.5) * 3];
      const cutoff = 0.02 * de.boundingRadius;
      const early = estimateDistanceRefined(de, p, cutoff);
      if (early >= cutoff) continue;
      dipped++;
      // The hit VERDICT is what the cutoff preserves, not the value.
      expect(estimateDistanceRefined(de, p)).toBeLessThan(cutoff);
    }
    expect(dipped).toBeGreaterThan(20);
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

  it("on a kaleidoscope system, keeps strict validity at the built width while eliminating the base estimator's balloons", () => {
    // 3D-specific coverage the 4D suite has no analogue for: the refined
    // inner sweep runs over every (sector, base map) pair — 3 x 4 = 12
    // branches here — and kaleidoscope sectors only exist in this module.
    // Order 3 triples
    // every branch, so levels with >= 3 simultaneous in-sphere branches are
    // common — the fr-jkpn drop class. Before the width-4 validity slots
    // this construction measured the disclosed TRADE (refined: 0 ghosts but
    // 2/200 probes overshooting <= 0.0465 = 2.6%R); with them it measures
    // CLEAN — sierpinski's maps all translate, so no branch norms tie
    // exactly and rank-3/4 coverage repairs every drop (the tie-tree
    // residual needs zero-translation copies; see the module doc). Measured
    // on this exact cloud/probe stream at the built width:
    //   base:    4/140 genuine-void probes read under the 0.01R marcher
    //            proxy — balloons on the symmetric render
    //   refined: 0 overshoots (was 2/200 at width 2), 0 ghosts, min void
    //            estimate 0.0431 vs the 0.0176 hit floor
    // The 1e-6 tolerance is the deep-descent fp-noise allowance the beam
    // tests above document.
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
      expect(refined).toBeLessThanOrEqual(nearest + 1e-6);
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
    // that at width 1 in 4D. At the BUILT width the beam keeps this
    // profile clean, refined or not (harness at width 4, depth 127:
    // viol=66 exact-class @3.2e-8 fp noise, maxExcess 0.0%R). Same
    // 127-level depth and 1e-6 tolerance as the base estimator's beam
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

// -----------------------------------------------------------------------
// fr-jkpn validity slots (widths 3/4): a second insert-shift ladder holds
// each level's rank-3/4 candidates, which continue as extra chains ONLY
// while in-sphere — the branches that carry no positive certificate, whose
// silent drop was width 2's measured invalidity (3+ simultaneous in-sphere
// branches: jerusalem 3.6%R, sigma >= 0.96 ~2%R). The sigma-0.96 2-map
// profile pins the mechanism at its sharpest: with m = 2 a level exposes at
// most 4 candidates, so width 4's coverage is EXHAUSTIVE — nothing in-sphere
// can ever drop — while width 2 measurably overshoots on the same queries.
// -----------------------------------------------------------------------

describe("fr-jkpn validity slots on the sigma-0.96 slow-map profile", () => {
  function sigma096Profile(): Transform[] {
    return [
      {
        id: 0,
        position: [0, 0, 0],
        rotation: [0, 0, 0.55],
        scale: [0.96, 0.96, 0.96],
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
  }

  it("holds at the built width: no jittered query exceeds the cloud-distance bound", () => {
    // Same construction and 1e-6 deep-descent fp-noise tolerance as the
    // fr-v6yg beam tests above, one sigma notch up (0.93 -> 0.96) — the
    // notch where sigma clamps at the MAX_DESCENT_DEPTH ceiling (128) and
    // the harness measured width 2 retaining ~2%R real excess (55 refined
    // violations @2.3e-2) while width 4 collapses the real excess to 0
    // (31 surviving counts, all sub-5e-7 fp noise; CLOUD=300k).
    const transforms = sigma096Profile();
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

  it("overshoots somewhere on the same queries when forced back to beamWidth 2 — the fr-jkpn drop the validity slots repair", () => {
    const transforms = sigma096Profile();
    const de = { ...buildSurfaceDE(transforms), beamWidth: 2 as const };
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
      return estimateDistanceRefined(de, q) > nearest + 1e-9;
    });
    expect(violatesSomewhere).toBe(true);
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

// estimateDistanceRefined's early-out cutoff (fr-55r5). The march needs a
// HIT DECISION, not a distance, so it hands the DE its acceptance epsilon
// and the descent may stop once the value it would return is already below
// it. Two properties carry the whole contract, and every test below asserts
// both over a spread of probe distances:
//   (A) a returned value >= cutoff EQUALS the cutoff-0 result bit-for-bit
//       — step sizes above the hit threshold never drift;
//   (B) a returned value < cutoff implies the cutoff-0 result is < cutoff
//       — the hit verdict is identical: no false hit, no lost hit.
// The trap the exits are placed against: `best` must only ever be tested
// AFTER a fold settles it (refined, on this path). Exiting on a raw
// pre-refinement certificate would re-open fr-1z6p's balloon ghosts, which
// the directed void tests at the end of this section pin.
describe("estimateDistanceRefined early-out cutoff", () => {
  it("returns the full-descent value bit-for-bit when the cutoff is 0", () => {
    const de = buildSurfaceDE(sierpinskiTetrahedron());
    const rng = mulberry32(11);
    for (let i = 0; i < 60; i++) {
      const p: Vec3 = [(rng() - 0.5) * 4, (rng() - 0.5) * 4, (rng() - 0.5) * 4];
      expect(estimateDistanceRefined(de, p, 0)).toBe(
        estimateDistanceRefined(de, p),
      );
    }
  });

  it("holds both properties on sierpinskiTetrahedron across on-surface, near and far probes", () => {
    const transforms = sierpinskiTetrahedron();
    const de = buildSurfaceDE(transforms);
    const cloud = runChaosGame(transforms, 20000, mulberry32(1));
    const rng = mulberry32(4242);
    const probes: Vec3[] = [];
    for (let i = 0; i < 40; i++) {
      const idx = Math.floor(rng() * cloud.count);
      const jitter = [0.004, 0.05, 0.4][i % 3];
      probes.push([
        cloud.positions[idx * 3] + (rng() - 0.5) * jitter,
        cloud.positions[idx * 3 + 1] + (rng() - 0.5) * jitter,
        cloud.positions[idx * 3 + 2] + (rng() - 0.5) * jitter,
      ]);
    }
    for (let i = 0; i < 20; i++) {
      probes.push([(rng() - 0.5) * 4, (rng() - 0.5) * 4, (rng() - 0.5) * 4]);
    }
    const cutoffs = [1e-4, 1e-2, 5e-2, 2e-1].map((f) => f * de.boundingRadius);
    let earlyExits = 0;
    for (const p of probes) {
      const full = estimateDistanceRefined(de, p);
      for (const cutoff of cutoffs) {
        const value = estimateDistanceRefined(de, p, cutoff);
        // An early exit can only stop the running min from falling further,
        // so it never reports LESS distance than the full descent.
        expect(value).toBeGreaterThanOrEqual(full);
        if (value >= cutoff) expect(value).toBe(full);
        else expect(full).toBeLessThan(cutoff);
        if (value !== full) earlyExits++;
      }
    }
    // Pins the mechanism as live: a cutoff that never fires would satisfy
    // both properties vacuously.
    expect(earlyExits).toBeGreaterThan(0);
  });

  it("holds both properties on mengerSponge, whose 20 maps make every level's fold sweep wide", () => {
    const transforms = mengerSponge();
    const de = buildSurfaceDE(transforms);
    const cloud = runChaosGame(transforms, 20000, mulberry32(1));
    const rng = mulberry32(909);
    const probes: Vec3[] = [];
    for (let i = 0; i < 30; i++) {
      const idx = Math.floor(rng() * cloud.count);
      const jitter = [0.004, 0.05, 0.4][i % 3];
      probes.push([
        cloud.positions[idx * 3] + (rng() - 0.5) * jitter,
        cloud.positions[idx * 3 + 1] + (rng() - 0.5) * jitter,
        cloud.positions[idx * 3 + 2] + (rng() - 0.5) * jitter,
      ]);
    }
    for (let i = 0; i < 15; i++) {
      probes.push([(rng() - 0.5) * 4, (rng() - 0.5) * 4, (rng() - 0.5) * 4]);
    }
    const cutoffs = [1e-4, 1e-2, 5e-2, 2e-1].map((f) => f * de.boundingRadius);
    let earlyExits = 0;
    for (const p of probes) {
      const full = estimateDistanceRefined(de, p);
      for (const cutoff of cutoffs) {
        const value = estimateDistanceRefined(de, p, cutoff);
        expect(value).toBeGreaterThanOrEqual(full);
        if (value >= cutoff) expect(value).toBe(full);
        else expect(full).toBeLessThan(cutoff);
        if (value !== full) earlyExits++;
      }
    }
    expect(earlyExits).toBeGreaterThan(0);
  });

  it("holds both properties on the doubleRotation-mirror profile, whose slow map descends all 127 levels", () => {
    // The profile the early-out is FOR: sigma 0.93 pushes the depth cap to
    // 127 levels, so a probe that settles its min early otherwise pays the
    // whole descent. Same two maps as the refined-beam test above.
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
    const rng = mulberry32(77);
    const probes: Vec3[] = [];
    for (let i = 0; i < 30; i++) {
      const idx = Math.floor(rng() * cloud.count);
      const jitter = [0.004, 0.05, 0.4][i % 3];
      probes.push([
        cloud.positions[idx * 3] + (rng() - 0.5) * jitter,
        cloud.positions[idx * 3 + 1] + (rng() - 0.5) * jitter,
        cloud.positions[idx * 3 + 2] + (rng() - 0.5) * jitter,
      ]);
    }
    for (let i = 0; i < 15; i++) {
      probes.push([(rng() - 0.5) * 4, (rng() - 0.5) * 4, (rng() - 0.5) * 4]);
    }
    const cutoffs = [1e-4, 1e-2, 5e-2, 2e-1].map((f) => f * de.boundingRadius);
    let earlyExits = 0;
    for (const p of probes) {
      const full = estimateDistanceRefined(de, p);
      for (const cutoff of cutoffs) {
        const value = estimateDistanceRefined(de, p, cutoff);
        expect(value).toBeGreaterThanOrEqual(full);
        if (value >= cutoff) expect(value).toBe(full);
        else expect(full).toBeLessThan(cutoff);
        if (value !== full) earlyExits++;
      }
    }
    expect(earlyExits).toBeGreaterThan(0);
  });

  it("holds both properties on a kaleidoscope-expanded sierpinski, where every level folds rotated copies too", () => {
    const transforms = sierpinskiTetrahedron();
    const symmetry = { order: 3, axis: "z" } as const;
    const de = buildSurfaceDE(transforms, null, symmetry);
    const cloud = runChaosGame(
      transforms,
      20000,
      mulberry32(1),
      null,
      symmetry,
    );
    const rng = mulberry32(31337);
    const probes: Vec3[] = [];
    for (let i = 0; i < 30; i++) {
      const idx = Math.floor(rng() * cloud.count);
      const jitter = [0.004, 0.05, 0.4][i % 3];
      probes.push([
        cloud.positions[idx * 3] + (rng() - 0.5) * jitter,
        cloud.positions[idx * 3 + 1] + (rng() - 0.5) * jitter,
        cloud.positions[idx * 3 + 2] + (rng() - 0.5) * jitter,
      ]);
    }
    for (let i = 0; i < 15; i++) {
      probes.push([(rng() - 0.5) * 4, (rng() - 0.5) * 4, (rng() - 0.5) * 4]);
    }
    const cutoffs = [1e-4, 1e-2, 5e-2, 2e-1].map((f) => f * de.boundingRadius);
    let earlyExits = 0;
    for (const p of probes) {
      const full = estimateDistanceRefined(de, p);
      for (const cutoff of cutoffs) {
        const value = estimateDistanceRefined(de, p, cutoff);
        expect(value).toBeGreaterThanOrEqual(full);
        if (value >= cutoff) expect(value).toBe(full);
        else expect(full).toBeLessThan(cutoff);
        if (value !== full) earlyExits++;
      }
    }
    expect(earlyExits).toBeGreaterThan(0);
  });

  it("holds both properties through a final-transform lens, where the cutoff is compared in lensed units", () => {
    // The lens is the one place the exit test is not just `best < cutoff`:
    // the descent works in RAW attractor units and the caller's epsilon is
    // in VISIBLE ones, so both the running min and the depth-0 sphere floor
    // have to be scaled by the lens before either is compared.
    const transforms = sierpinskiTetrahedron();
    const finalTransform: Transform = {
      id: 99,
      position: [0.3, -0.2, 0.1],
      rotation: [0.4, 0.2, -0.3],
      scale: [0.8, 0.8, 0.8],
    };
    const de = buildSurfaceDE(transforms, finalTransform);
    const cloud = runChaosGame(
      transforms,
      20000,
      mulberry32(1),
      finalTransform,
    );
    const rng = mulberry32(5150);
    const probes: Vec3[] = [];
    for (let i = 0; i < 30; i++) {
      const idx = Math.floor(rng() * cloud.count);
      const jitter = [0.004, 0.05, 0.4][i % 3];
      probes.push([
        cloud.positions[idx * 3] + (rng() - 0.5) * jitter,
        cloud.positions[idx * 3 + 1] + (rng() - 0.5) * jitter,
        cloud.positions[idx * 3 + 2] + (rng() - 0.5) * jitter,
      ]);
    }
    for (let i = 0; i < 15; i++) {
      probes.push([(rng() - 0.5) * 4, (rng() - 0.5) * 4, (rng() - 0.5) * 4]);
    }
    const cutoffs = [1e-4, 1e-2, 5e-2, 2e-1].map((f) => f * de.boundingRadius);
    let earlyExits = 0;
    for (const p of probes) {
      const full = estimateDistanceRefined(de, p);
      for (const cutoff of cutoffs) {
        const value = estimateDistanceRefined(de, p, cutoff);
        expect(value).toBeGreaterThanOrEqual(full);
        if (value >= cutoff) expect(value).toBe(full);
        else expect(full).toBeLessThan(cutoff);
        if (value !== full) earlyExits++;
      }
    }
    expect(earlyExits).toBeGreaterThan(0);
  });

  it("does not false-hit the sierpinski void probe at a cutoff above its plain-certificate dip", () => {
    // The ghost class fr-1z6p killed, aimed straight at the early-out: at
    // this void point the PLAIN certificates dip to 0.0103 while the refined
    // descent settles at 0.2739 (the fixture two describes up). A cutoff of
    // 0.05 sits between them, so an exit that fired on a raw pre-refinement
    // certificate would return under 0.05 — a balloon membrane across the
    // cavity. Fully refined, the value is above the cutoff and property (A)
    // demands it be the full result, bit for bit.
    const de = buildSurfaceDE(sierpinskiTetrahedron());
    const p: Vec3 = [
      0.20299153421451924, -0.2487552135097045, -0.019194388149953938,
    ];
    expect(estimateDistance(de, p)).toBeLessThan(0.05);
    expect(estimateDistanceRefined(de, p, 0.05)).toBe(
      estimateDistanceRefined(de, p),
    );
    expect(estimateDistanceRefined(de, p, 0.05)).toBeGreaterThan(0.1);
  });

  it("does not false-hit the default-preset void probe at a cutoff above its plain-certificate dip", () => {
    // Same shape on the default preset: plain certificates dip to 0.0143,
    // refined settles at 0.0993, so a cutoff of 0.03 separates them.
    const de = buildSurfaceDE(defaultTransforms());
    const p: Vec3 = [
      -0.03995422658712331, -0.12167598089345305, -0.1888897693966145,
    ];
    expect(estimateDistance(de, p)).toBeLessThan(0.03);
    expect(estimateDistanceRefined(de, p, 0.03)).toBe(
      estimateDistanceRefined(de, p),
    );
    expect(estimateDistanceRefined(de, p, 0.03)).toBeGreaterThan(0.05);
  });
});

// The depth-0 sphere floor's own unconditional exit (fr-zkt2): once `best`
// falls to or below `sphereBound`, descentValue's `max(best, sphereBound)`
// clamp is already pinned there, and `best` only ever falls further from a
// fold — so the descent may return the instant that happens, no cutoff
// required. That makes the exit value-exact for EVERY caller, unlike the
// fr-55r5 cutoff exit above (exact only at or above the cutoff), but it
// also makes it value-INVISIBLE: the returned number is identical whether
// or not the exit fired. There is deliberately no "did it fire" counter
// below — the tests instead pin the invariant the exit leans on (the
// return never drops below the floor) and re-run the fr-55r5 cutoff
// contract over probe corpora biased into the region where the new exit
// actually triggers.
describe("estimateDistanceRefined sphere-floor pin (fr-zkt2)", () => {
  it("never returns below the depth-0 sphere floor, for probes inside, near and beyond the bounding sphere", () => {
    const transforms = sierpinskiTetrahedron();
    const de = buildSurfaceDE(transforms);
    const cloud = runChaosGame(transforms, 20000, mulberry32(1));
    const rng = mulberry32(7331);
    const probes: Vec3[] = [];
    // On-surface, jittered — the part-1 cloud+jitter pattern.
    for (let i = 0; i < 20; i++) {
      const idx = Math.floor(rng() * cloud.count);
      const jitter = [0.004, 0.05, 0.4][i % 3];
      probes.push([
        cloud.positions[idx * 3] + (rng() - 0.5) * jitter,
        cloud.positions[idx * 3 + 1] + (rng() - 0.5) * jitter,
        cloud.positions[idx * 3 + 2] + (rng() - 0.5) * jitter,
      ]);
    }
    // Uniform box probes.
    for (let i = 0; i < 15; i++) {
      probes.push([(rng() - 0.5) * 4, (rng() - 0.5) * 4, (rng() - 0.5) * 4]);
    }
    // Outside the bounding sphere, 1.05-3x its radius, random directions.
    for (let i = 0; i < 25; i++) {
      const dx = rng() - 0.5;
      const dy = rng() - 0.5;
      const dz = rng() - 0.5;
      const n = Math.hypot(dx, dy, dz) || 1;
      const radius = (1.05 + rng() * 1.95) * de.boundingRadius;
      probes.push([(dx / n) * radius, (dy / n) * radius, (dz / n) * radius]);
    }
    for (const p of probes) {
      // The exact prologue formula (`descend`'s `startR`), not Math.hypot —
      // the assertion below is bit-exact, so it must match the arithmetic
      // the descent itself runs, not a merely-equivalent one.
      const floor =
        Math.sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]) - de.boundingRadius;
      expect(estimateDistance(de, p)).toBeGreaterThanOrEqual(floor);
      expect(estimateDistanceRefined(de, p)).toBeGreaterThanOrEqual(floor);
    }
  });

  it("computes the floor in lensed units when a final transform is present", () => {
    const transforms = sierpinskiTetrahedron();
    const finalTransform: Transform = {
      id: 99,
      position: [0.3, -0.2, 0.1],
      rotation: [0.4, 0.2, -0.3],
      scale: [0.8, 0.8, 0.8],
    };
    const de = buildSurfaceDE(transforms, finalTransform);
    const f = de.final;
    if (!f) throw new Error("expected a final-transform lens");
    const rng = mulberry32(24601);
    for (let i = 0; i < 12; i++) {
      const dx = rng() - 0.5;
      const dy = rng() - 0.5;
      const dz = rng() - 0.5;
      const n = Math.hypot(dx, dy, dz) || 1;
      const radius = (1.2 + rng() * 1.8) * de.visibleBoundingRadius;
      const p: Vec3 = [(dx / n) * radius, (dy / n) * radius, (dz / n) * radius];
      // The descend prologue's lens step, verbatim: row-major 3x3 invM
      // then invT, THEN the norm — matching order matters for bit-exactness.
      const qx =
        f.invM[0] * p[0] + f.invM[1] * p[1] + f.invM[2] * p[2] + f.invT[0];
      const qy =
        f.invM[3] * p[0] + f.invM[4] * p[1] + f.invM[5] * p[2] + f.invT[1];
      const qz =
        f.invM[6] * p[0] + f.invM[7] * p[1] + f.invM[8] * p[2] + f.invT[2];
      const lensedR = Math.sqrt(qx * qx + qy * qy + qz * qz);
      const floor = (lensedR - de.boundingRadius) * f.sigmaMin;
      expect(estimateDistanceRefined(de, p)).toBeGreaterThanOrEqual(floor);
    }
  });

  it("keeps both cutoff properties on the slow-descending two-map profile when probes are biased outside the bounding sphere", () => {
    // Same two maps as the fr-55r5 doubleRotation-mirror test above: sigma
    // 0.93 pushes the depth cap to 127 levels, so this is where an exit
    // that fires early skips the most descent.
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
    const rng = mulberry32(2718);
    const probes: Vec3[] = [];
    for (let i = 0; i < 24; i++) {
      const dx = rng() - 0.5;
      const dy = rng() - 0.5;
      const dz = rng() - 0.5;
      const n = Math.hypot(dx, dy, dz) || 1;
      const radius = (1.0 + rng() * 1.5) * de.boundingRadius;
      probes.push([(dx / n) * radius, (dy / n) * radius, (dz / n) * radius]);
    }
    for (let i = 0; i < 8; i++) {
      const idx = Math.floor(rng() * cloud.count);
      const jitter = [0.004, 0.05, 0.4][i % 3];
      probes.push([
        cloud.positions[idx * 3] + (rng() - 0.5) * jitter,
        cloud.positions[idx * 3 + 1] + (rng() - 0.5) * jitter,
        cloud.positions[idx * 3 + 2] + (rng() - 0.5) * jitter,
      ]);
    }
    const cutoffs = [1e-4, 1e-2, 5e-2, 2e-1].map((f) => f * de.boundingRadius);
    let earlyExits = 0;
    for (const p of probes) {
      const full = estimateDistanceRefined(de, p);
      for (const cutoff of cutoffs) {
        const value = estimateDistanceRefined(de, p, cutoff);
        expect(value).toBeGreaterThanOrEqual(full);
        if (value >= cutoff) expect(value).toBe(full);
        else expect(full).toBeLessThan(cutoff);
        if (value !== full) earlyExits++;
      }
    }
    expect(earlyExits).toBeGreaterThan(0);
  });

  it("keeps both cutoff properties on a kaleidoscope-swept sierpinski when probes are biased outside the bounding sphere", () => {
    const transforms = sierpinskiTetrahedron();
    const symmetry = { order: 3, axis: "z" } as const;
    const de = buildSurfaceDE(transforms, null, symmetry);
    const cloud = runChaosGame(
      transforms,
      20000,
      mulberry32(1),
      null,
      symmetry,
    );
    const rng = mulberry32(31415);
    const probes: Vec3[] = [];
    for (let i = 0; i < 24; i++) {
      const dx = rng() - 0.5;
      const dy = rng() - 0.5;
      const dz = rng() - 0.5;
      const n = Math.hypot(dx, dy, dz) || 1;
      const radius = (1.0 + rng() * 1.5) * de.boundingRadius;
      probes.push([(dx / n) * radius, (dy / n) * radius, (dz / n) * radius]);
    }
    for (let i = 0; i < 8; i++) {
      const idx = Math.floor(rng() * cloud.count);
      const jitter = [0.004, 0.05, 0.4][i % 3];
      probes.push([
        cloud.positions[idx * 3] + (rng() - 0.5) * jitter,
        cloud.positions[idx * 3 + 1] + (rng() - 0.5) * jitter,
        cloud.positions[idx * 3 + 2] + (rng() - 0.5) * jitter,
      ]);
    }
    const cutoffs = [1e-4, 1e-2, 5e-2, 2e-1].map((f) => f * de.boundingRadius);
    let earlyExits = 0;
    for (const p of probes) {
      const full = estimateDistanceRefined(de, p);
      for (const cutoff of cutoffs) {
        const value = estimateDistanceRefined(de, p, cutoff);
        expect(value).toBeGreaterThanOrEqual(full);
        if (value >= cutoff) expect(value).toBe(full);
        else expect(full).toBeLessThan(cutoff);
        if (value !== full) earlyExits++;
      }
    }
    expect(earlyExits).toBeGreaterThan(0);
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
  it("un-rotates a sector then un-maps the base map back to the original point", () => {
    // The kaleidoscope copy (k, i) is p -> Rot_k . f_i(p). Descending
    // through it must therefore turn the point BACK by k sectors and then
    // apply base map i's inverse — the two halves the sweep does in that
    // order, where the expansion baked them into one composed matrix.
    const transforms = sierpinskiTetrahedron();
    const order = 3;
    const de = buildSurfaceDE(transforms, null, { order, axis: "z" });
    const point: Vec3 = [0.3, -0.2, 0.5];

    for (const [baseIndex, k] of [
      [0, 0],
      [2, 1],
    ]) {
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

      const unrotated = sectorPoint(de, k, rotated);
      const baseMap = de.maps[baseIndex];
      const back = applyAffine(
        { m: baseMap.invM, t: baseMap.invT },
        unrotated[0],
        unrotated[1],
        unrotated[2],
      );

      expect(back[0]).toBeCloseTo(point[0], 10);
      expect(back[1]).toBeCloseTo(point[1], 10);
      expect(back[2]).toBeCloseTo(point[2], 10);
    }
  });
});
