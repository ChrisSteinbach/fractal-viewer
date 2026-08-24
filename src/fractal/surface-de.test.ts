import {
  analyzeSurfaceSystem,
  buildSurfaceDE,
  DEPTH_RESOLUTION,
  estimateDistance,
  estimateDistanceRefined,
  evaluateSurfaceNativeCarriers,
  MAX_DESCENT_DEPTH,
  NEAR_ZERO_FOLD_WEIGHT,
  setFoldFrontierTap,
  singularValues3,
  SPHEREFOLD_LIPSCHITZ,
  SURFACE_FOLD_BEAM_WIDTH,
  SURFACE_FOLD_BOXFOLD,
  SURFACE_FOLD_MANDELBOX,
  SURFACE_FOLD_NONE,
  SURFACE_FOLD_SPHEREFOLD,
  surfaceDescentCostWeight,
  transformSigmas,
} from "./surface-de";
import type {
  FoldFrontierCandidate,
  SurfaceDE,
  SurfaceDEMap,
} from "./surface-de";
import { applyAffine, composeAffine, rotationMatrixXYZ } from "./affine";
import { runChaosGame, symmetryRotation } from "./chaos-game";
import type { ChaosGameResult } from "./chaos-game";
import {
  defaultTransforms,
  mandelboxKifs,
  mengerSponge,
  sierpinskiTetrahedron,
} from "./presets";
import { mulberry32 } from "./rng";
import {
  BOX_FOLD_LIMIT,
  SPHERE_FOLD_FIXED_RADIUS,
  SPHERE_FOLD_MIN_RADIUS,
} from "./variations";
import type { SymmetryPlane, Transform, Vec3 } from "./types";

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
 * The pre-sweep symmetry EXPANSION, preserved here and only here as the
 * reference oracle the sector sweep is measured against: materialise every
 * kaleidoscope copy `Rot_k . f_i` into its own composed inverse slot
 * (`inv(M_i) . Rot_k^T`, sector-major, copy 0 unrotated first — the exact
 * lines `buildSurfaceDE` used to run) and hand back a symmetry-FREE
 * `SurfaceDE`. Order 1 leaves the descent no sectors to sweep, so the
 * returned descriptor reproduces exactly what production computed before
 * the sweep landed.
 */
function expandedReference(de: SurfaceDE): SurfaceDE {
  const { order, plane } = de.symmetry;
  const maps: SurfaceDEMap[] = [];
  for (let k = 0; k < order; k++) {
    const rot = symmetryRotation(plane, (2 * Math.PI * k) / order);
    const rotT = transpose3(rot);
    for (const base of de.maps) {
      const [gx, gy, gz] = base.bnbDir;
      maps.push({
        invM: mulMat3(base.invM, rotT),
        invT: base.invT,
        sigmaMin: base.sigmaMin,
        foldKind: base.foldKind,
        foldInvW: base.foldInvW,
        foldSigma: base.foldSigma,
        foldRadii: base.foldRadii,
        baseIndex: base.baseIndex,
        // Rotations leave singular values (and invT) alone, so the
        // composed copy's stage-2 scalars are the base map's exactly;
        // the directional bound rotates with the matrix:
        // (invM·rotT)^T · d = rot · (invM^T · d).
        invMSigmaMin: base.invMSigmaMin,
        invTNorm: base.invTNorm,
        bnbDir: [
          rot[0] * gx + rot[1] * gy + rot[2] * gz,
          rot[3] * gx + rot[4] * gy + rot[5] * gz,
          rot[6] * gx + rot[7] * gy + rot[8] * gz,
        ],
      });
    }
  }
  return {
    ...de,
    maps,
    symmetry: { order: 1, plane, stepCos: 1, stepSin: 0 },
  };
}

/** Walk `p` through `k` sector steps exactly as the descent's sweep does. */
function sectorPoint(de: SurfaceDE, k: number, p: Vec3): Vec3 {
  const { plane, stepCos: c, stepSin: s } = de.symmetry;
  let out: Vec3 = [p[0], p[1], p[2]];
  for (let n = 0; n < k; n++) {
    const [x, y, z] = out;
    if (plane === "yz") out = [x, c * y + s * z, -s * y + c * z];
    else if (plane === "xz") out = [c * x - s * z, y, s * x + c * z];
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
    const cloud = runChaosGame(transforms, 20000, mulberry32(7));
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
    const cloud = runChaosGame(transforms, 20000, mulberry32(7));
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
    const cloud = runChaosGame(transforms, 20000, mulberry32(7));
    const rng = mulberry32(1234);
    for (let i = 0; i < 300; i++) {
      const p: Vec3 = [(rng() - 0.5) * 3, (rng() - 0.5) * 3, (rng() - 0.5) * 3];
      const nearest = nearestDistance(cloud, p);
      expect(estimateDistance(de, p)).toBeLessThanOrEqual(nearest + 1e-6);
    }
  });
});

describe("estimateDistance beam descent", () => {
  it("buildSurfaceDE always builds beamWidth 4 — the paired chains plus the rank-3/4 validity slots", () => {
    const de = buildSurfaceDE(sierpinskiTetrahedron());
    expect(de.beamWidth).toBe(4);
  });

  it("holds for the 3D mirror of doubleRotation's profile: no jittered query exceeds the cloud-distance bound", () => {
    // The 3D mirror of the 4D `doubleRotation` preset's profile (2 maps,
    // weight 6:1, sigma 0.93 vs 0.22 — see `surface-de-4d.test.ts`'s
    // doubleRotation descent-depth-stress tests for the 4D original this
    // mirrors). Its slowest map (sigma 0.93) drives maxDepth to 127
    // levels (the full formula depth under the MAX_DESCENT_DEPTH
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

  it("overshoots somewhere on the same queries when forced to beamWidth 1 — the overshoot the beam repairs", () => {
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
    const de = buildSurfaceDE(transforms, null, { order: 3, plane: "xy" });
    expect(de.maps).toHaveLength(4);
    expect(de.maps.map((m) => m.baseIndex)).toEqual([0, 1, 2, 3]);
  });

  it("refuses a 4D kaleidoscope rather than descending it as a 3D one", () => {
    // A w-plane (or a twist) makes the SYSTEM 4D, so it routes to
    // surface-de-4d.ts; reaching this 3D builder with one is a routing bug.
    expect(() =>
      buildSurfaceDE(sierpinskiTetrahedron(), null, { order: 3, plane: "zw" }),
    ).toThrow(/no 3D descent/);
    expect(() =>
      buildSurfaceDE(sierpinskiTetrahedron(), null, {
        order: 3,
        plane: "xy",
        twist: 1,
      }),
    ).toThrow(/no 3D descent/);
  });

  it("still accepts a w-plane at order 1, which turns nothing", () => {
    // Order 1 is the identity for any plane, so such a document is flat and
    // must keep working — the sweep is a single unrotated pass.
    const de = buildSurfaceDE(sierpinskiTetrahedron(), null, {
      order: 1,
      plane: "zw",
    });
    expect(de.symmetry.order).toBe(1);
  });

  it("carries the kaleidoscope as sector data the descent sweeps", () => {
    const de = buildSurfaceDE(sierpinskiTetrahedron(), null, {
      order: 3,
      plane: "xy",
    });
    expect(de.symmetry.order).toBe(3);
    expect(de.symmetry.plane).toBe("xy");
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
      plane: "xz",
    });
    expect(de.symmetry.order).toBe(64);
  });
});

describe("estimateDistance with kaleidoscope symmetry", () => {
  it("stays within 0.08 of the symmetric attractor for points sampled on it", () => {
    const transforms = sierpinskiTetrahedron();
    const symmetry = { order: 3, plane: "xy" } as const;
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

// ——— The sector sweep that replaced the symmetry expansion ———
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
      plane: "xy",
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
      plane: "xz",
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
      plane: "yz",
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
      plane: "xy",
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

  it("never over-estimates the expansion's bound in any supported plane", () => {
    // The direction that matters: an estimate ABOVE the reference's is a
    // march that steps through a surface. Asserted one-sided across every
    // plane and a spread of orders, on both estimators.
    const table: { order: number; plane: SymmetryPlane }[] = [
      { order: 2, plane: "yz" },
      { order: 3, plane: "xz" },
      { order: 4, plane: "xy" },
      { order: 5, plane: "yz" },
      { order: 6, plane: "xz" },
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
      plane: "xy",
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
        plane: "xz",
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
    const full = buildSurfaceDE(transforms, null, { order: 4, plane: "xz" });
    const faded = buildSurfaceDE(transforms, null, {
      order: 4,
      plane: "xz",
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
      plane: "xy",
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
      plane: "xy",
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
      plane: "xy",
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
    const symmetry = { order: 7, plane: "xy" } as const;
    const de = buildSurfaceDE(transforms, null, symmetry);
    const cloud = runChaosGame(
      transforms,
      20000,
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
    // company, with both estimators valid against the attractor
    // throughout. Off the axis, where nothing ties, the two agree to 1e-15
    // (the suites above). Probes sweep the segment of the axis inside the
    // bounding ball: outside it, the tighter probe-fit sphere bound
    // DOMINATES the returned max on both sides, which masks the tie noise
    // this test exists to pin (the original origin-ball sweep of
    // z in [-2, 2] measured 21/400 differing; the ball-clipped sweep keeps
    // the phenomenon observable regardless of how tight the fit gets).
    const de = buildSurfaceDE(sierpinskiTetrahedron(), null, {
      order: 5,
      plane: "xy",
    });
    const reference = expandedReference(de);
    const zLo = de.boundCenter[2] - de.boundingRadius;
    const zHi = de.boundCenter[2] + de.boundingRadius;
    let differing = 0;
    for (let i = 0; i < 400; i++) {
      const p: Vec3 = [0, 0, zLo + ((zHi - zLo) * i) / 399];
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
  const beyondCap = { order: 8, plane: "xy" } as const;

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
      20000,
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
    // Density is the subject: this test classifies probes as void via
    // `nearestDistance(cloud, p) <= 0.05 * R`, and a sparser cloud would
    // widen every gap and manufacture spurious "voids" rather than finding
    // the genuine ones the ghosting property is about. Kept well above the
    // 20k default (still 2.5x down from the 200k this once built).
    const cloud = runChaosGame(
      transforms,
      80000,
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
  // The cutoff contract has to survive the sweep: the early-out exits sit
  // inside the loop the sector sweep now wraps.
  const symmetry = { order: 8, plane: "xy" } as const;

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

describe("estimateDistance cutoff on a mixed affine+boxfold system", () => {
  // The empty-space grid grew the cutoff param on the PLAIN estimator too —
  // it's the one the fold GLSL tracer marches (surface-material.ts's
  // SURFACE_FOLDS body has no refined variant; see that module's doc for
  // why), but no test ever exercised the cutoff path on a MIXED affine+fold
  // system — the shape that grew phantom box faces under the acceptance-eps
  // investigation (scripts/fold-phantom.harness.ts). Same cutoff contract
  // as the swept-kaleidoscope describe above, on defaultTransforms with a
  // boxfold map substituted in for map 0.
  function defaultTetraWithBoxfoldMap0(): Transform[] {
    return defaultTransforms().map((t) =>
      t.id === 0
        ? { ...t, variations: [{ type: "boxfold" as const, weight: 1 }] }
        : t,
    );
  }

  it("returns the full-descent value whenever the result clears the cutoff", () => {
    const de = buildSurfaceDE(defaultTetraWithBoxfoldMap0());
    const R = de.boundingRadius;
    // Seed picked (of 200 probed) so the 60-sample cube draws a handful of
    // near-surface points too — this system has no kaleidoscope sweep to
    // thicken the attractor's presence the way sierpinskiTetrahedron+
    // symmetry(8) does above, so the true dip rate here is only ~2%
    // (measured over 5000 uniform samples) and most seeds draw zero of
    // them at n=60. Seed 4 measures 57 cleared / 3 dipped.
    const rng = mulberry32(4);
    let cleared = 0;
    for (let i = 0; i < 60; i++) {
      const p: Vec3 = [
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
      ];
      const cutoff = 0.02 * R;
      const early = estimateDistance(de, p, cutoff);
      if (early < cutoff) continue;
      cleared++;
      expect(early).toBe(estimateDistance(de, p));
    }
    expect(cleared).toBeGreaterThan(40);
  });

  it("agrees with the full descent whenever the result falls under the cutoff", () => {
    const de = buildSurfaceDE(defaultTetraWithBoxfoldMap0());
    const R = de.boundingRadius;
    const rng = mulberry32(4);
    let dipped = 0;
    for (let i = 0; i < 60; i++) {
      const p: Vec3 = [
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
      ];
      const cutoff = 0.02 * R;
      const early = estimateDistance(de, p, cutoff);
      if (early >= cutoff) continue;
      dipped++;
      // The hit VERDICT is what the cutoff preserves, not the value.
      expect(estimateDistance(de, p)).toBeLessThan(cutoff);
    }
    expect(dipped).toBeGreaterThan(0);
  });
});

// -----------------------------------------------------------------------
// estimateDistanceRefined (the 4D spike's ghost-eliminator ported
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
    const cloud = runChaosGame(transforms, 20000, mulberry32(7));
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
    // common — the validity-slot drop class. Before the width-4 slots
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
    const symmetry = { order: 3, plane: "xy" } as const;
    const de = buildSurfaceDE(transforms, null, symmetry);
    const R = de.boundingRadius;
    // Density is the subject: `baseGhosts` counts probes the cloud calls
    // genuinely void (nearest > 0.05R) where the base estimator false-hits,
    // and a sparse cloud misclassifies near-attractor points as void from
    // sampling gaps alone — measured at 80k, one probe's refined estimate
    // (0.0142) landed just under the 0.01R floor once its "far" classification
    // stopped being reliable at that density. Kept well above the 20k default
    // (still 1.5x down from the 300k this once built).
    const cloud = runChaosGame(
      transforms,
      200000,
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
    // profiles where descent drops in-sphere branches a raised min
    // can expose more of the drop's invalidity — the 4D spike measured exactly
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
// Rank-3/4 validity slots (widths 3/4): a second insert-shift ladder holds
// each level's rank-3/4 candidates, which continue as extra chains ONLY
// while in-sphere — the branches that carry no positive certificate, whose
// silent drop was width 2's measured invalidity (3+ simultaneous in-sphere
// branches: jerusalem 3.6%R, sigma >= 0.96 ~2%R). The sigma-0.96 2-map
// profile pins the mechanism at its sharpest: with m = 2 a level exposes at
// most 4 candidates, so width 4's coverage is EXHAUSTIVE — nothing in-sphere
// can ever drop — while width 2 measurably overshoots on the same queries.
// -----------------------------------------------------------------------

describe("validity slots on the sigma-0.96 slow-map profile", () => {
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
    // beam tests above, one sigma notch up (0.93 -> 0.96) — the
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

  it("overshoots somewhere on the same queries when forced back to beamWidth 2 — the drop the validity slots repair", () => {
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
    // Pinned from the refinement finder (cloud mulberry32(101)/300_000, uniform
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

// estimateDistanceRefined's early-out cutoff. The march needs a
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
// pre-refinement certificate would re-open the balloon ghosts refinement
// killed, which the directed void tests at the end of this section pin.
describe("estimateDistanceRefined early-out cutoff", () => {
  it("runs the full descent for a cutoff too small to fire, bit-for-bit", () => {
    // The claim the `cutoff = 0` default makes, stated against a DIFFERENT
    // call: every exit is guarded `cutoff > 0 && best < cutoff`, so a cutoff
    // below every value the descent can report has to be a no-op. Comparing
    // the default-arg call against an explicit `0` would be the identical
    // call on both sides and could not fail.
    const de = buildSurfaceDE(sierpinskiTetrahedron());
    const rng = mulberry32(11);
    const tiny = 1e-12 * de.boundingRadius;
    for (let i = 0; i < 60; i++) {
      const p: Vec3 = [(rng() - 0.5) * 4, (rng() - 0.5) * 4, (rng() - 0.5) * 4];
      const full = estimateDistanceRefined(de, p);
      // Keeps the equality below from passing vacuously off an exit that
      // COULD have fired: no probe here sits within `tiny` of the set.
      expect(full).toBeGreaterThan(tiny);
      expect(estimateDistanceRefined(de, p, tiny)).toBe(full);
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
    const symmetry = { order: 3, plane: "xy" } as const;
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
    // The ghost class refinement killed, aimed straight at the early-out: at
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

// The depth-0 sphere floor's own unconditional exit: once `best`
// falls to or below `sphereBound`, descentValue's `max(best, sphereBound)`
// clamp is already pinned there, and `best` only ever falls further from a
// fold — so the descent may return the instant that happens, no cutoff
// required. That makes the exit value-exact for EVERY caller, unlike the
// cutoff exit above (exact only at or above the cutoff), but it
// also makes it value-INVISIBLE: the returned number is identical whether
// or not the exit fired. There is deliberately no "did it fire" counter
// below — the tests instead pin the invariant the exit leans on (the
// return never drops below the floor) and re-run the cutoff
// contract over probe corpora biased into the region where the new exit
// actually triggers.
describe("estimateDistanceRefined sphere-floor pin", () => {
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
    // Same two maps as the cutoff doubleRotation-mirror test above: sigma
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
    const symmetry = { order: 3, plane: "xy" } as const;
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
    const de = buildSurfaceDE(transforms, null, { order, plane: "xy" });
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

// -----------------------------------------------------------------------
// PURE-FOLD MAPS — the fold-branch sweep. A map whose variation
// list is exactly one active fold-family entry (boxfold/spherefold/
// mandelbox) decomposes into its inverse BRANCHES instead of gating the
// mode out; see the module doc's "PURE-FOLD MAPS" section for the validity
// argument `descendFold` implements. `map()` (above) is reused throughout
// for the eligibility-table tests, exactly as the pre-existing eligibility
// suite uses it.
// -----------------------------------------------------------------------

/** Two-map pure-boxfold system: both maps carry exactly one active boxfold
 * variation and nothing else — isometric branches only (sigma_c = 1 on
 * every one of the 27), shared by the fold-branch soundness tests below. */
function pureBoxfoldPair(): Transform[] {
  return [
    {
      id: 0,
      position: [0.4, 0.1, 0],
      rotation: [0.3, 0.2, 0],
      scale: [0.45, 0.45, 0.45],
      variations: [{ type: "boxfold", weight: 1 }],
    },
    {
      id: 1,
      position: [-0.35, -0.2, 0.3],
      rotation: [0, 0.5, 0.1],
      scale: [0.5, 0.5, 0.5],
      variations: [{ type: "boxfold", weight: 0.9 }],
    },
  ];
}

/** Two-map pure-mandelbox system: both maps carry exactly one active
 * mandelbox variation (`sphereFold . boxFold`), the widest branch count (81)
 * and the spherefold's query-dependent mid-branch sigma. */
function pureMandelboxPair(): Transform[] {
  return [
    {
      id: 0,
      position: [0.3, -0.15, 0.1],
      rotation: [0.2, 0.4, 0],
      scale: [0.2, 0.2, 0.2],
      variations: [{ type: "mandelbox", weight: 1.1 }],
    },
    {
      id: 1,
      position: [-0.25, 0.2, -0.2],
      rotation: [0.1, 0, 0.3],
      scale: [0.22, 0.22, 0.22],
      variations: [{ type: "mandelbox", weight: 0.9 }],
    },
  ];
}

describe("analyzeSurfaceSystem eligibility for pure-fold maps", () => {
  it("classifies a pure-boxfold map (plus a plain affine map) as not ineligible", () => {
    const analysis = analyzeSurfaceSystem([
      map({ variations: [{ type: "boxfold", weight: 1 }] }),
      map({ id: 1 }),
    ]);
    expect(analysis.status).not.toBe("ineligible");
    expect(analysis.reasons).toEqual([]);
  });

  it("keeps a blended fold+linear map ineligible, naming it a variations map — blends stay out forever", () => {
    const analysis = analyzeSurfaceSystem([
      map({
        variations: [
          { type: "mandelbox", weight: 1.2 },
          { type: "linear", weight: 0.25 },
        ],
      }),
    ]);
    expect(analysis.status).toBe("ineligible");
    expect(analysis.reasons).toEqual(["map 1 uses variations"]);
  });

  it("keeps a map blending two fold variations ineligible — a sum of folds is not a composition", () => {
    const analysis = analyzeSurfaceSystem([
      map({
        variations: [
          { type: "boxfold", weight: 1 },
          { type: "spherefold", weight: 0.5 },
        ],
      }),
    ]);
    expect(analysis.status).toBe("ineligible");
    expect(analysis.reasons).toEqual(["map 1 uses variations"]);
  });

  it("treats a weight-0 extra variation as inert alongside a pure-fold entry", () => {
    const analysis = analyzeSurfaceSystem([
      map({
        scale: [0.2, 0.2, 0.2],
        variations: [
          { type: "mandelbox", weight: 1 },
          { type: "linear", weight: 0 },
        ],
      }),
    ]);
    expect(analysis.status).not.toBe("ineligible");
    expect(analysis.reasons).toEqual([]);
  });

  it("gates a spherefold map on the composite Lipschitz bound, not the affine scale alone", () => {
    const analysis = analyzeSurfaceSystem([
      map({
        scale: [0.3, 0.3, 0.3],
        variations: [{ type: "spherefold", weight: 1.2 }],
      }),
    ]);
    expect(analysis.status).toBe("ineligible");
    expect(analysis.reasons).toEqual(["map 1 does not contract"]);
  });

  it("lets a boxfold map at the same weight and scale contract, since its Lipschitz bound is 1 not 4", () => {
    const analysis = analyzeSurfaceSystem([
      map({
        scale: [0.3, 0.3, 0.3],
        variations: [{ type: "boxfold", weight: 1.2 }],
      }),
    ]);
    expect(analysis.status).not.toBe("ineligible");
    expect(analysis.reasons).toEqual([]);
  });

  it("lets a small fold weight rescue an affine part that alone would expand", () => {
    const analysis = analyzeSurfaceSystem([
      map({
        scale: [5, 5, 5],
        variations: [{ type: "boxfold", weight: 0.1 }],
      }),
    ]);
    expect(analysis.status).not.toBe("ineligible");
    expect(analysis.reasons).toEqual([]);
  });

  it("admits a pure-fold final transform — the lens expands into one round of branch root descents", () => {
    const analysis = analyzeSurfaceSystem(
      [map()],
      map({ id: 99, variations: [{ type: "boxfold", weight: 1 }] }),
    );
    expect(analysis.status).not.toBe("ineligible");
    expect(analysis.reasons).toEqual([]);
  });

  it("puts no contraction gate on a pure-fold final — an un-iterated lens needs none", () => {
    // Weight 2 mandelbox: iterated it would need sigma_max < 0.125; as a
    // lens it is applied once and any weight is admissible.
    const analysis = analyzeSurfaceSystem(
      [map()],
      map({ id: 99, variations: [{ type: "mandelbox", weight: 2 }] }),
    );
    expect(analysis.status).not.toBe("ineligible");
    expect(analysis.reasons).toEqual([]);
  });

  it("keeps a BLENDED final transform ineligible — a weighted sum has no branch decomposition", () => {
    const analysis = analyzeSurfaceSystem(
      [map()],
      map({
        id: 99,
        variations: [
          { type: "boxfold", weight: 1 },
          { type: "linear", weight: 0.25 },
        ],
      }),
    );
    expect(analysis.status).toBe("ineligible");
    expect(analysis.reasons).toEqual(["final transform uses variations"]);
  });
});

describe("fold-weight eligibility floor", () => {
  it("refuses a boxfold map whose weight is just under the floor, though the composite Lipschitz gate alone would pass", () => {
    // A smaller |w| only ever HELPS the composite contraction bound (it
    // shrinks as w -> 0), so nothing here fails on that gate — the descent
    // divides the chain point by w instead, and NEAR_ZERO_FOLD_WEIGHT is the
    // only thing standing between this and that division blowing up.
    const analysis = analyzeSurfaceSystem([
      map({ variations: [{ type: "boxfold", weight: 5e-5 }] }),
    ]);
    expect(analysis.status).toBe("ineligible");
    expect(analysis.reasons).toEqual(["map 1 fold weight ≈ 0"]);
  });

  it("refuses the same weight negated — the floor is on |w|; folds are odd, so negative weights are otherwise legal above it", () => {
    const analysis = analyzeSurfaceSystem([
      map({ variations: [{ type: "boxfold", weight: -5e-5 }] }),
    ]);
    expect(analysis.status).toBe("ineligible");
    expect(analysis.reasons).toEqual(["map 1 fold weight ≈ 0"]);
  });

  it("admits a weight exactly at the floor — the gate is a strict less-than", () => {
    const analysis = analyzeSurfaceSystem([
      map({
        variations: [{ type: "boxfold", weight: NEAR_ZERO_FOLD_WEIGHT }],
      }),
    ]);
    expect(analysis.status).not.toBe("ineligible");
    expect(analysis.reasons).toEqual([]);
  });

  it("refuses a pure-fold FINAL transform at a near-zero weight — the lens has no contraction gate to catch it otherwise", () => {
    const analysis = analyzeSurfaceSystem(
      [map()],
      map({ id: 99, variations: [{ type: "mandelbox", weight: 5e-5 }] }),
    );
    expect(analysis.status).toBe("ineligible");
    expect(analysis.reasons).toEqual(["final transform fold weight ≈ 0"]);
  });

  it("leaves a weight-0 fold variation inert rather than naming it near-zero — it is not a fold map at all", () => {
    // composeVariations' active filter drops weight-0 entries outright, so
    // pureFoldVariation sees no active variation here; the floor must never
    // misfire on an entry that was never a fold map to begin with.
    const analysis = analyzeSurfaceSystem([
      map({ variations: [{ type: "boxfold", weight: 0 }] }),
    ]);
    expect(analysis.status).not.toBe("ineligible");
    expect(analysis.reasons).toEqual([]);
  });

  it("makes buildSurfaceDE throw for a near-zero-weight fold system", () => {
    const ineligible = [
      map({ variations: [{ type: "boxfold", weight: 5e-5 }] }),
    ];
    expect(() => buildSurfaceDE(ineligible)).toThrow(/fold weight/);
  });
});

describe("buildSurfaceDE fold fields and depth sizing", () => {
  it("gives a plain affine map the inert fold defaults and a pure-fold map its signed weight and branch kind", () => {
    const transforms: Transform[] = [
      map(),
      map({
        id: 1,
        scale: [0.16, 0.16, 0.16],
        variations: [{ type: "mandelbox", weight: -1.25 }],
      }),
    ];
    const de = buildSurfaceDE(transforms);
    const [affineMap, foldMap] = de.maps;
    expect(affineMap.foldKind).toBe(SURFACE_FOLD_NONE);
    expect(affineMap.foldInvW).toBe(1);
    expect(affineMap.foldSigma).toBe(affineMap.sigmaMin);
    expect(foldMap.foldKind).toBe(SURFACE_FOLD_MANDELBOX);
    expect(foldMap.sigmaMin).toBe(0.16);
    expect(foldMap.foldInvW).toBe(1 / -1.25);
    expect(foldMap.foldSigma).toBe(Math.abs(-1.25) * 0.16);
  });

  it("sizes maxDepth from the slowest fold branch factor, not the affine sigmaMin", () => {
    const transforms: Transform[] = [
      map({ scale: [0.2, 0.2, 0.2] }),
      map({
        id: 1,
        scale: [0.24, 0.24, 0.24],
        variations: [{ type: "spherefold", weight: 0.9 }],
      }),
    ];
    const de = buildSurfaceDE(transforms);
    // The spherefold branch factor (|w| * sigmaMin * SPHEREFOLD_LIPSCHITZ)
    // beats the affine map's plain sigmaMin (0.2), so it drives the cap.
    const slowest = 0.9 * 0.24 * SPHEREFOLD_LIPSCHITZ;
    const expected = Math.min(
      MAX_DESCENT_DEPTH,
      Math.max(8, Math.ceil(Math.log(DEPTH_RESOLUTION) / Math.log(slowest))),
    );
    expect(de.maxDepth).toBe(expected);
  });
});

describe("surfaceDescentCostWeight", () => {
  // render-tier.ts's preview ladder consumes this number to pick a starting
  // rung before a fold session has a single measured frame; these are its
  // first direct pins, one per shape the formula treats specially.

  it("is exactly 1 for an affine-only system — the ladder's untouched baseline", () => {
    const de = buildSurfaceDE(sierpinskiTetrahedron());
    expect(surfaceDescentCostWeight(de)).toBe(1);
  });

  it("prices a pure-boxfold pair at the 27-branch mean times the frontier/ladder width ratio", () => {
    const de = buildSurfaceDE(pureBoxfoldPair());
    // Every map contributes 27 branches, so the mean is 27; the frontier
    // (SURFACE_FOLD_BEAM_WIDTH = 12) prices over the affine ladder's 4
    // slots: 27 * (12/4) = 81.
    const expected = 27 * (SURFACE_FOLD_BEAM_WIDTH / 4);
    expect(surfaceDescentCostWeight(de)).toBeCloseTo(expected, 9);
  });

  it("prices a pure-spherefold pair at the 3-branch mean times the width ratio", () => {
    // Inline fixture — no local spherefold pair exists in this file.
    // Mirrors scripts/harness-profiles.ts's foldSpherefoldPair: uniform
    // contraction-safe scales and weights whose composite Lipschitz bound
    // (|w| * 4 * sigma_max) clears CONTRACTION_LIMIT on both maps.
    const transforms: Transform[] = [
      map({
        scale: [0.24, 0.24, 0.24],
        variations: [{ type: "spherefold", weight: 0.9 }],
      }),
      map({
        id: 1,
        scale: [0.2, 0.2, 0.2],
        variations: [{ type: "spherefold", weight: 1.1 }],
      }),
    ];
    const de = buildSurfaceDE(transforms);
    // 3 * (12/4) = 9.
    const expected = 3 * (SURFACE_FOLD_BEAM_WIDTH / 4);
    expect(surfaceDescentCostWeight(de)).toBeCloseTo(expected, 9);
  });

  it("prices the shipped mandelboxKifs preset from its 8 mandelbox + 4 boxfold maps", () => {
    const de = buildSurfaceDE(mandelboxKifs());
    // 8 mandelbox corner maps (81 branches) + 4 boxfold binder maps (27
    // branches) over 12 maps total, times the width ratio:
    // ((8*81 + 4*27) / 12) * (12/4) = 189. Update this pin deliberately if
    // the preset's composition ever changes.
    const expected = ((8 * 81 + 4 * 27) / 12) * (SURFACE_FOLD_BEAM_WIDTH / 4);
    expect(surfaceDescentCostWeight(de)).toBeCloseTo(expected, 9);
  });

  it("counts a plain affine map as 1 branch in a mixed mean", () => {
    const transforms: Transform[] = [
      map({ variations: [{ type: "boxfold", weight: 1 }] }),
      map({ id: 1 }),
    ];
    const de = buildSurfaceDE(transforms);
    // (27 + 1) / 2 = 14, times the width ratio: 14 * (12/4) = 42.
    const expected = ((27 + 1) / 2) * (SURFACE_FOLD_BEAM_WIDTH / 4);
    expect(surfaceDescentCostWeight(de)).toBeCloseTo(expected, 9);
  });

  it("multiplies by branchCount/8 for a pure-boxfold FINAL lens", () => {
    const de = buildSurfaceDE(
      [map()],
      map({ id: 99, variations: [{ type: "boxfold", weight: 1 }] }),
    );
    // No fold maps in the base system, so the map-side weight stays 1; the
    // lens multiplies by 27/8 = 3.375.
    const expected = 27 / 8;
    expect(surfaceDescentCostWeight(de)).toBeCloseTo(expected, 9);
  });

  it("clamps a pure-spherefold FINAL lens's multiplier to 1 — max(1, 3/8)", () => {
    const de = buildSurfaceDE(
      [map()],
      map({ id: 99, variations: [{ type: "spherefold", weight: 1 }] }),
    );
    expect(surfaceDescentCostWeight(de)).toBe(1);
  });

  it("multiplies the maps' fold cost by the lens's cost when a system has both", () => {
    const de = buildSurfaceDE(
      pureBoxfoldPair(),
      map({ id: 99, variations: [{ type: "boxfold", weight: 1 }] }),
    );
    const expected = 27 * (SURFACE_FOLD_BEAM_WIDTH / 4) * (27 / 8);
    expect(surfaceDescentCostWeight(de)).toBeCloseTo(expected, 9);
  });

  it("returns 1 for an empty maps array — guards the mean's 0/0 against NaN", () => {
    expect(surfaceDescentCostWeight({ maps: [] } as unknown as SurfaceDE)).toBe(
      1,
    );
  });
});

describe("estimateDistance / estimateDistanceRefined validity on a pure-boxfold system", () => {
  it("keeps both estimators below the brute-force nearest cloud distance, jittered and uniform probes alike", () => {
    const transforms = pureBoxfoldPair();
    const de = buildSurfaceDE(transforms);
    expect(de.maps[0].foldKind).toBe(SURFACE_FOLD_BOXFOLD);
    expect(de.maps[1].foldKind).toBe(SURFACE_FOLD_BOXFOLD);
    const cloud = runChaosGame(transforms, 20000, mulberry32(101));
    const R = de.boundingRadius;
    const rng = mulberry32(202);
    const probes: Vec3[] = [];
    for (let i = 0; i < 100; i++) {
      const idx = Math.floor(rng() * cloud.count);
      probes.push([
        cloud.positions[idx * 3] + (rng() - 0.5) * 0.3,
        cloud.positions[idx * 3 + 1] + (rng() - 0.5) * 0.3,
        cloud.positions[idx * 3 + 2] + (rng() - 0.5) * 0.3,
      ]);
    }
    for (let i = 0; i < 50; i++) {
      probes.push([
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
      ]);
    }
    for (const p of probes) {
      const nearest = nearestDistance(cloud, p);
      expect(estimateDistance(de, p)).toBeLessThanOrEqual(nearest + 1e-9);
      expect(estimateDistanceRefined(de, p)).toBeLessThanOrEqual(
        nearest + 1e-9,
      );
    }
  });

  it("stays within 0.02R of the attractor for points sampled exactly on it (no erosion)", () => {
    const transforms = pureBoxfoldPair();
    const de = buildSurfaceDE(transforms);
    const cloud = runChaosGame(transforms, 20000, mulberry32(101));
    const R = de.boundingRadius;
    for (let i = 0; i < 50; i++) {
      const idx = (i * 337) % cloud.count;
      const p: Vec3 = [
        cloud.positions[idx * 3],
        cloud.positions[idx * 3 + 1],
        cloud.positions[idx * 3 + 2],
      ];
      expect(estimateDistanceRefined(de, p)).toBeLessThanOrEqual(0.02 * R);
    }
  });

  it("has zero void false hits: the refined estimate never dips below 0.01R once the true distance clears 0.15R", () => {
    const transforms = pureBoxfoldPair();
    const de = buildSurfaceDE(transforms);
    const cloud = runChaosGame(transforms, 20000, mulberry32(101));
    const R = de.boundingRadius;
    const rng = mulberry32(303);
    let voidProbes = 0;
    for (let i = 0; i < 150; i++) {
      const p: Vec3 = [
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
      ];
      const nearest = nearestDistance(cloud, p);
      if (nearest <= 0.15 * R) continue;
      voidProbes++;
      expect(estimateDistanceRefined(de, p)).toBeGreaterThanOrEqual(0.01 * R);
    }
    expect(voidProbes).toBeGreaterThan(0);
  });
});

describe("estimateDistanceRefined on a pure-mandelbox system", () => {
  it("never falls below the base estimate", () => {
    const transforms = pureMandelboxPair();
    const de = buildSurfaceDE(transforms);
    const R = de.boundingRadius;
    const rng = mulberry32(404);
    for (let i = 0; i < 100; i++) {
      const p: Vec3 = [
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
      ];
      expect(estimateDistanceRefined(de, p)).toBeGreaterThanOrEqual(
        estimateDistance(de, p) - 1e-12,
      );
    }
  });

  it("honors the early-out cutoff contract on a fold system: clearing the cutoff matches the full descent bit-for-bit, dipping under it implies the full descent does too", () => {
    const transforms = pureMandelboxPair();
    const de = buildSurfaceDE(transforms);
    const cloud = runChaosGame(transforms, 20000, mulberry32(101));
    const R = de.boundingRadius;
    const cutoff = 0.02 * R;
    const rng = mulberry32(505);
    const probes: Vec3[] = [];
    for (let i = 0; i < 60; i++) {
      const idx = Math.floor(rng() * cloud.count);
      const jitter = [0.004, 0.05, 0.3][i % 3];
      probes.push([
        cloud.positions[idx * 3] + (rng() - 0.5) * jitter,
        cloud.positions[idx * 3 + 1] + (rng() - 0.5) * jitter,
        cloud.positions[idx * 3 + 2] + (rng() - 0.5) * jitter,
      ]);
    }
    for (let i = 0; i < 40; i++) {
      probes.push([
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
      ]);
    }
    let cleared = 0;
    let dipped = 0;
    for (const q of probes) {
      const full = estimateDistanceRefined(de, q);
      const cut = estimateDistanceRefined(de, q, cutoff);
      if (cut >= cutoff) {
        cleared++;
        expect(cut).toBe(full);
      } else {
        dipped++;
        expect(full).toBeLessThan(cutoff);
      }
    }
    // Pins the mechanism as live on both sides, as the pre-existing cutoff
    // suites do for the affine descent.
    expect(cleared).toBeGreaterThan(0);
    expect(dipped).toBeGreaterThan(0);
  });
});

describe("spherefold mid-branch guard", () => {
  it("returns a finite estimate at and near the sector origin, where the mid branch's inversion would otherwise overflow", () => {
    const transforms: Transform[] = [
      map({
        scale: [0.2, 0.2, 0.2],
        variations: [{ type: "spherefold", weight: 1 }],
      }),
      map({
        id: 1,
        position: [-0.1, 0.1, -0.05],
        scale: [0.22, 0.22, 0.22],
        variations: [{ type: "spherefold", weight: 0.9 }],
      }),
    ];
    const de = buildSurfaceDE(transforms);
    expect(de.maps[0].foldKind).toBe(SURFACE_FOLD_SPHEREFOLD);
    expect(de.maps[1].foldKind).toBe(SURFACE_FOLD_SPHEREFOLD);
    const points: Vec3[] = [
      [0, 0, 0],
      [1e-9, 0, 0],
    ];
    for (const p of points) {
      expect(Number.isFinite(estimateDistanceRefined(de, p))).toBe(true);
    }
  });
});

describe("fold-branch sweep interactions: kaleidoscope and beamWidth", () => {
  it("stays a sound bound under a kaleidoscope sweep combined with pure-fold maps", () => {
    const transforms = pureBoxfoldPair();
    const symmetry = { order: 3, plane: "xz" } as const;
    const de = buildSurfaceDE(transforms, null, symmetry);
    const cloud = runChaosGame(
      transforms,
      20000,
      mulberry32(101),
      null,
      symmetry,
    );
    const R = de.boundingRadius;
    const rng = mulberry32(606);
    for (let i = 0; i < 80; i++) {
      const p: Vec3 = [
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
      ];
      const nearest = nearestDistance(cloud, p);
      expect(estimateDistance(de, p)).toBeLessThanOrEqual(nearest + 1e-9);
      expect(estimateDistanceRefined(de, p)).toBeLessThanOrEqual(
        nearest + 1e-9,
      );
    }
  });

  it("returns identical estimates whether the DE reports beamWidth 4 or is forced to 1 — the fold frontier ignores it", () => {
    const transforms = pureBoxfoldPair();
    const de = buildSurfaceDE(transforms);
    const narrow = { ...de, beamWidth: 1 as const };
    const R = de.boundingRadius;
    const rng = mulberry32(707);
    for (let i = 0; i < 20; i++) {
      const p: Vec3 = [
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
      ];
      expect(estimateDistance(narrow, p)).toBe(estimateDistance(de, p));
    }
  });
});

// -----------------------------------------------------------------------
// The c59b019 unsorted-worst-scan frontier restructure needs a
// direct pin on the KEPT SET itself, not just estimator validity — a
// dropped candidate always folds a VALID (if looser) bound, so the
// validity suites above would stay green through a kept-set regression.
// -----------------------------------------------------------------------

describe("descendFold frontier kept set", () => {
  // The tap reports every candidate that reaches frontier insertion
  // (arrival order) and each completed level's kept slots (slot order);
  // replayFrontier below is a brute-force model of the CONTRACT — fill in
  // arrival order; once full, replace the FIRST-scanned worst slot (strict
  // `>` scan from index 0) only when a STRICTLY smaller key arrives; ties
  // evict the newcomer — and the tests below demand slot-exact agreement.
  // Any future frontier restructure that drifts the kept set, the tie
  // rule, or the worst-slot tracking fails this suite.

  function replayFrontier(candidates: FoldFrontierCandidate[]): {
    slots: FoldFrontierCandidate[];
    replacements: number;
  } {
    const slots: FoldFrontierCandidate[] = [];
    let replacements = 0;
    for (const c of candidates) {
      if (slots.length < SURFACE_FOLD_BEAM_WIDTH) {
        slots.push(c);
        continue;
      }
      let worst = 0;
      for (let i = 1; i < slots.length; i++) {
        if (slots[i].key > slots[worst].key) worst = i;
      }
      if (c.key < slots[worst].key) {
        slots[worst] = c;
        replacements++;
      }
    }
    return { slots, replacements };
  }

  /** Installs the tap for one `estimateDistance` call and hands back every
   * candidate seen (by depth) alongside every completed level's kept slots. */
  function tapDescent(
    de: SurfaceDE,
    p: Vec3,
  ): {
    candidates: Map<number, FoldFrontierCandidate[]>;
    levels: Map<number, FoldFrontierCandidate[]>;
  } {
    const candidates = new Map<number, FoldFrontierCandidate[]>();
    const levels = new Map<number, FoldFrontierCandidate[]>();
    setFoldFrontierTap({
      candidate(depth, c) {
        let list = candidates.get(depth);
        if (!list) {
          list = [];
          candidates.set(depth, list);
        }
        list.push(c);
      },
      level(depth, kept) {
        levels.set(depth, kept);
      },
    });
    try {
      estimateDistance(de, p);
    } finally {
      setFoldFrontierTap(null);
    }
    return { candidates, levels };
  }

  it("agrees slot-for-slot with the replay on a pure-boxfold pair (27-branch isometries)", () => {
    const transforms = pureBoxfoldPair();
    const de = buildSurfaceDE(transforms);
    const cloud = runChaosGame(transforms, 20000, mulberry32(2101));
    const R = de.boundingRadius;
    const probes: Vec3[] = [];
    for (let i = 0; i < 8; i++) {
      const idx = (i * 337) % cloud.count;
      probes.push([
        cloud.positions[idx * 3],
        cloud.positions[idx * 3 + 1],
        cloud.positions[idx * 3 + 2],
      ]);
    }
    const rng = mulberry32(2102);
    for (let i = 0; i < 16; i++) {
      probes.push([
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
      ]);
    }

    let levelsChecked = 0;
    let saturated = false;
    let replacements = 0;
    for (const p of probes) {
      const { candidates, levels } = tapDescent(de, p);
      for (const [depth, kept] of levels) {
        const atDepth = candidates.get(depth) ?? [];
        const replay = replayFrontier(atDepth);
        expect(kept).toEqual(replay.slots);
        levelsChecked++;
        replacements += replay.replacements;
        if (atDepth.length > SURFACE_FOLD_BEAM_WIDTH) saturated = true;
      }
    }
    // Unlike the three fixtures below, a bare 2-map boxfold pair never
    // floods a level anywhere near SURFACE_FOLD_BEAM_WIDTH: every
    // non-identity branch differs from the identity branch by a
    // box-lattice reflection (a jump of ~2-4 units), and inv(M) EXPANDS
    // that gap (M itself contracts to build the attractor), so almost
    // every reflected branch lands past the escape radius immediately.
    // Measured directly (a hill-climbing search over query points
    // maximizing per-level candidate count, 40 restarts x 60 steps,
    // starting from this exact DE): the true ceiling is 4, and replacement
    // never triggers below FOLD_W. This it() therefore pins the replay
    // contract in the SPARSE regime — the complementary case to the
    // saturating fixtures below, where every candidate fits without ever
    // evicting — rather than asserting a saturation floor this pair
    // cannot reach.
    expect(levelsChecked).toBeGreaterThan(0);
    expect(saturated).toBe(false);
    expect(replacements).toBe(0);
  });

  it("agrees slot-for-slot with the replay on a pure-mandelbox pair (81-branch worst case, saturation guaranteed)", () => {
    const transforms = pureMandelboxPair();
    const de = buildSurfaceDE(transforms);
    const cloud = runChaosGame(transforms, 20000, mulberry32(2201));
    const R = de.boundingRadius;
    const probes: Vec3[] = [];
    for (let i = 0; i < 8; i++) {
      const idx = (i * 337) % cloud.count;
      probes.push([
        cloud.positions[idx * 3],
        cloud.positions[idx * 3 + 1],
        cloud.positions[idx * 3 + 2],
      ]);
    }
    const rng = mulberry32(2202);
    for (let i = 0; i < 16; i++) {
      probes.push([
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
      ]);
    }

    let levelsChecked = 0;
    let saturated = false;
    let replacements = 0;
    for (const p of probes) {
      const { candidates, levels } = tapDescent(de, p);
      for (const [depth, kept] of levels) {
        const atDepth = candidates.get(depth) ?? [];
        const replay = replayFrontier(atDepth);
        expect(kept).toEqual(replay.slots);
        levelsChecked++;
        replacements += replay.replacements;
        if (atDepth.length > SURFACE_FOLD_BEAM_WIDTH) saturated = true;
      }
    }
    expect(levelsChecked).toBeGreaterThan(0);
    expect(saturated).toBe(true);
    expect(replacements).toBeGreaterThan(0);
  });

  it("agrees slot-for-slot with the replay under a kaleidoscope sweep over a pure-boxfold pair", () => {
    const transforms = pureBoxfoldPair();
    const symmetry = { order: 3, plane: "xz" } as const;
    const de = buildSurfaceDE(transforms, null, symmetry);
    const cloud = runChaosGame(
      transforms,
      20000,
      mulberry32(2301),
      null,
      symmetry,
    );
    const R = de.boundingRadius;
    const probes: Vec3[] = [];
    for (let i = 0; i < 8; i++) {
      const idx = (i * 337) % cloud.count;
      probes.push([
        cloud.positions[idx * 3],
        cloud.positions[idx * 3 + 1],
        cloud.positions[idx * 3 + 2],
      ]);
    }
    const rng = mulberry32(2302);
    for (let i = 0; i < 16; i++) {
      probes.push([
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
      ]);
    }

    let levelsChecked = 0;
    let saturated = false;
    let replacements = 0;
    for (const p of probes) {
      const { candidates, levels } = tapDescent(de, p);
      for (const [depth, kept] of levels) {
        const atDepth = candidates.get(depth) ?? [];
        const replay = replayFrontier(atDepth);
        expect(kept).toEqual(replay.slots);
        levelsChecked++;
        replacements += replay.replacements;
        if (atDepth.length > SURFACE_FOLD_BEAM_WIDTH) saturated = true;
      }
    }
    expect(levelsChecked).toBeGreaterThan(0);
    expect(saturated).toBe(true);
    expect(replacements).toBeGreaterThan(0);
  });

  it("agrees slot-for-slot with the replay on a mixed boxfold + plain-affine pair (a single-candidate arm competing in the same stream)", () => {
    const transforms: Transform[] = [
      map({ variations: [{ type: "boxfold", weight: 1 }] }),
      // A hair off map 0's position (rather than sharing it verbatim): an
      // IDENTICAL affine part makes the plain map's one candidate exactly
      // coincide with the boxfold map's identity branch every time, which
      // floods saturated levels with EXACT duplicate keys and starves the
      // replacement path (ties always evict the newcomer). The 1e-4 offset
      // keeps this a plain, ordinarily-contracting affine map while letting
      // the two arms' candidates genuinely differ.
      map({ id: 1, position: [0.1001, 0.2, 0.3] }),
    ];
    const de = buildSurfaceDE(transforms);
    const cloud = runChaosGame(transforms, 20000, mulberry32(2401));
    const R = de.boundingRadius;
    const probes: Vec3[] = [];
    for (let i = 0; i < 8; i++) {
      const idx = (i * 337) % cloud.count;
      probes.push([
        cloud.positions[idx * 3],
        cloud.positions[idx * 3 + 1],
        cloud.positions[idx * 3 + 2],
      ]);
    }
    const rng = mulberry32(2402);
    for (let i = 0; i < 16; i++) {
      probes.push([
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
      ]);
    }

    let levelsChecked = 0;
    let saturated = false;
    let replacements = 0;
    for (const p of probes) {
      const { candidates, levels } = tapDescent(de, p);
      for (const [depth, kept] of levels) {
        const atDepth = candidates.get(depth) ?? [];
        const replay = replayFrontier(atDepth);
        expect(kept).toEqual(replay.slots);
        levelsChecked++;
        replacements += replay.replacements;
        if (atDepth.length > SURFACE_FOLD_BEAM_WIDTH) saturated = true;
      }
    }
    expect(levelsChecked).toBeGreaterThan(0);
    expect(saturated).toBe(true);
    expect(replacements).toBeGreaterThan(0);
  });
});

/** A boxfold final lens over the Sierpinski tetrahedron — the fold-lens
 * archetype (an affine base under a fold lens; Surprise Me's boxfold-final
 * rolls land here). The SMALL weight matters: `u = p/w` reaches ~2.2, so
 * the attractor genuinely CROSSES the fold planes and the non-identity
 * branches carry real geometry — a weight much above 1 leaves `|u| < 1`
 * everywhere and the lens degenerates to its affine part. */
function boxfoldFinal(): Transform {
  return map({
    id: 99,
    position: [0.15, -0.1, 0.05],
    rotation: [0.2, 0.3, 0.1],
    scale: [0.9, 0.9, 0.9],
    variations: [{ type: "boxfold", weight: 0.55 }],
  });
}

describe("SurfaceDE native-carrier calibration", () => {
  const baseSystems = (): Transform[][] => [
    sierpinskiTetrahedron(),
    pureBoxfoldPair(),
  ];

  it("produces finite affine and fold carrier data with exact repeated-build calibration", () => {
    for (const transforms of baseSystems()) {
      const first = buildSurfaceDE(transforms);
      const second = buildSurfaceDE(transforms);
      expect(second.patternCalibration).toEqual(first.patternCalibration);
      expect(
        Object.values(first.patternCalibration).every(Number.isFinite),
      ).toBe(true);
      expect(first.patternCalibration.ringsInvSpan).toBeGreaterThanOrEqual(0);
      expect(first.patternCalibration.sheetsInvSpan).toBeGreaterThanOrEqual(0);

      const raw = runChaosGame(transforms, 64, mulberry32(0xc411b));
      const offset = (raw.count - 1) * 3;
      const carriers = evaluateSurfaceNativeCarriers(first, [
        raw.positions[offset],
        raw.positions[offset + 1],
        raw.positions[offset + 2],
      ]);
      expect(Number.isFinite(carriers.rings)).toBe(true);
      expect(Number.isFinite(carriers.sheets)).toBe(true);
      expect(carriers.rings).toBeGreaterThanOrEqual(0);
      expect(carriers.rings).toBeLessThanOrEqual(1);
      expect(carriers.sheets).toBeGreaterThanOrEqual(0);
      expect(carriers.sheets).toBeLessThanOrEqual(1);
    }
  });

  it("is exactly invariant under affine and pure-fold final lenses", () => {
    const affineFinal: Transform = {
      id: 98,
      position: [0.3, -0.2, 0.1],
      rotation: [0.4, 0.2, -0.3],
      scale: [0.8, 0.8, 0.8],
    };
    for (const transforms of baseSystems()) {
      const raw = buildSurfaceDE(transforms);
      const affineLens = buildSurfaceDE(transforms, affineFinal);
      const foldLens = buildSurfaceDE(transforms, boxfoldFinal());
      expect(affineLens.patternCalibration).toEqual(raw.patternCalibration);
      expect(foldLens.patternCalibration).toEqual(raw.patternCalibration);
    }
  });
});

describe("buildSurfaceDE with a pure-fold final lens", () => {
  it("builds foldFinal (and no affine final) with the lens's kind, weight and affine part", () => {
    const final = boxfoldFinal();
    const de = buildSurfaceDE(sierpinskiTetrahedron(), final);
    expect(de.final).toBeNull();
    expect(de.foldFinal).not.toBeNull();
    expect(de.foldFinal!.foldKind).toBe(SURFACE_FOLD_BOXFOLD);
    expect(de.foldFinal!.invW).toBeCloseTo(1 / 0.55, 12);
    expect(de.foldFinal!.absW).toBeCloseTo(0.55, 12);
    expect(de.foldFinal!.sigmaMin).toBeCloseTo(0.9, 12);
  });

  it("bounds the visible set: every plotted point of the lensed cloud sits inside visibleBoundingRadius", () => {
    const final = boxfoldFinal();
    const de = buildSurfaceDE(sierpinskiTetrahedron(), final);
    const cloud = runChaosGame(
      sierpinskiTetrahedron(),
      20000,
      mulberry32(11),
      final,
    );
    expect(cloud.bounds.maxR).toBeLessThanOrEqual(de.visibleBoundingRadius);
  });

  it("bounds the visible set of a mandelbox lens the same way", () => {
    const final = map({
      id: 99,
      variations: [{ type: "mandelbox", weight: 0.6 }],
    });
    const de = buildSurfaceDE(sierpinskiTetrahedron(), final);
    const cloud = runChaosGame(
      sierpinskiTetrahedron(),
      20000,
      mulberry32(11),
      final,
    );
    expect(de.foldFinal!.foldKind).toBe(SURFACE_FOLD_MANDELBOX);
    expect(cloud.bounds.maxR).toBeLessThanOrEqual(de.visibleBoundingRadius);
  });
});

describe("estimateDistance / estimateDistanceRefined with a fold final lens", () => {
  it("keeps both estimators below the brute-force nearest distance to the LENSED cloud, jittered and uniform probes alike", () => {
    const transforms = sierpinskiTetrahedron();
    const final = boxfoldFinal();
    const de = buildSurfaceDE(transforms, final);
    const cloud = runChaosGame(transforms, 20000, mulberry32(101), final);
    const R = de.visibleBoundingRadius;
    const rng = mulberry32(202);
    const probes: Vec3[] = [];
    for (let i = 0; i < 100; i++) {
      const idx = Math.floor(rng() * cloud.count);
      probes.push([
        cloud.positions[idx * 3] + (rng() - 0.5) * 0.3,
        cloud.positions[idx * 3 + 1] + (rng() - 0.5) * 0.3,
        cloud.positions[idx * 3 + 2] + (rng() - 0.5) * 0.3,
      ]);
    }
    for (let i = 0; i < 50; i++) {
      probes.push([
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
      ]);
    }
    for (const p of probes) {
      const nearest = nearestDistance(cloud, p);
      expect(estimateDistance(de, p)).toBeLessThanOrEqual(nearest + 1e-9);
      expect(estimateDistanceRefined(de, p)).toBeLessThanOrEqual(
        nearest + 1e-9,
      );
    }
  });

  it("stays within 0.02R of the lensed attractor for points sampled exactly on it (no erosion)", () => {
    const transforms = sierpinskiTetrahedron();
    const final = boxfoldFinal();
    const de = buildSurfaceDE(transforms, final);
    const cloud = runChaosGame(transforms, 20000, mulberry32(101), final);
    const R = de.visibleBoundingRadius;
    for (let i = 0; i < 50; i++) {
      const idx = (i * 337) % cloud.count;
      const p: Vec3 = [
        cloud.positions[idx * 3],
        cloud.positions[idx * 3 + 1],
        cloud.positions[idx * 3 + 2],
      ];
      expect(estimateDistanceRefined(de, p)).toBeLessThanOrEqual(0.02 * R);
    }
  });

  it("absorbs a negative lens weight through |w| — both estimators stay sound", () => {
    const transforms = sierpinskiTetrahedron();
    const final = map({
      id: 99,
      position: [0.1, 0, -0.1],
      rotation: [0, 0.4, 0.2],
      scale: [0.8, 0.8, 0.8],
      variations: [{ type: "boxfold", weight: -0.6 }],
    });
    const de = buildSurfaceDE(transforms, final);
    const cloud = runChaosGame(transforms, 20000, mulberry32(31), final);
    const R = de.visibleBoundingRadius;
    const rng = mulberry32(32);
    for (let i = 0; i < 80; i++) {
      const p: Vec3 = [
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
      ];
      const nearest = nearestDistance(cloud, p);
      expect(estimateDistance(de, p)).toBeLessThanOrEqual(nearest + 1e-9);
      expect(estimateDistanceRefined(de, p)).toBeLessThanOrEqual(
        nearest + 1e-9,
      );
    }
  });

  it("stays sound with a mandelbox lens (81 branches, the region-floor stress case)", () => {
    const transforms = sierpinskiTetrahedron();
    const final = map({
      id: 99,
      position: [0.05, 0.1, 0],
      rotation: [0.3, 0, 0.2],
      scale: [0.85, 0.85, 0.85],
      variations: [{ type: "mandelbox", weight: 0.6 }],
    });
    const de = buildSurfaceDE(transforms, final);
    const cloud = runChaosGame(transforms, 20000, mulberry32(41), final);
    const R = de.visibleBoundingRadius;
    const rng = mulberry32(42);
    for (let i = 0; i < 80; i++) {
      const p: Vec3 = [
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
      ];
      const nearest = nearestDistance(cloud, p);
      expect(estimateDistance(de, p)).toBeLessThanOrEqual(nearest + 1e-9);
      expect(estimateDistanceRefined(de, p)).toBeLessThanOrEqual(
        nearest + 1e-9,
      );
    }
  });

  it("stays sound with a boxfold lens OVER a pure-fold base — lens branches seeding fold-frontier descents", () => {
    const transforms = pureBoxfoldPair();
    const final = map({
      id: 99,
      position: [0.1, -0.05, 0.1],
      rotation: [0.15, 0.25, 0],
      scale: [0.9, 0.9, 0.9],
      variations: [{ type: "boxfold", weight: 0.6 }],
    });
    const de = buildSurfaceDE(transforms, final);
    const cloud = runChaosGame(transforms, 20000, mulberry32(51), final);
    const R = de.visibleBoundingRadius;
    const rng = mulberry32(52);
    for (let i = 0; i < 60; i++) {
      const p: Vec3 = [
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
      ];
      const nearest = nearestDistance(cloud, p);
      expect(estimateDistance(de, p)).toBeLessThanOrEqual(nearest + 1e-9);
      expect(estimateDistanceRefined(de, p)).toBeLessThanOrEqual(
        nearest + 1e-9,
      );
    }
  });

  it("stays sound under a kaleidoscope sweep beneath the lens", () => {
    const transforms = sierpinskiTetrahedron();
    const symmetry = { order: 3, plane: "xy" } as const;
    const final = boxfoldFinal();
    const de = buildSurfaceDE(transforms, final, symmetry);
    const cloud = runChaosGame(
      transforms,
      20000,
      mulberry32(61),
      final,
      symmetry,
    );
    const R = de.visibleBoundingRadius;
    const rng = mulberry32(62);
    for (let i = 0; i < 60; i++) {
      const p: Vec3 = [
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
      ];
      const nearest = nearestDistance(cloud, p);
      expect(estimateDistance(de, p)).toBeLessThanOrEqual(nearest + 1e-9);
      expect(estimateDistanceRefined(de, p)).toBeLessThanOrEqual(
        nearest + 1e-9,
      );
    }
  });

  it("honors the cutoff contract: values at or above the cutoff equal the full result, values below imply the full result is below too", () => {
    const transforms = sierpinskiTetrahedron();
    const final = boxfoldFinal();
    const de = buildSurfaceDE(transforms, final);
    const R = de.visibleBoundingRadius;
    const rng = mulberry32(72);
    for (let i = 0; i < 120; i++) {
      const p: Vec3 = [
        (rng() - 0.5) * 2.6 * R,
        (rng() - 0.5) * 2.6 * R,
        (rng() - 0.5) * 2.6 * R,
      ];
      const cutoff = rng() * 0.2 * R;
      const full = estimateDistanceRefined(de, p);
      const cut = estimateDistanceRefined(de, p, cutoff);
      if (cut >= cutoff) {
        expect(cut).toBe(full);
      } else {
        expect(full).toBeLessThan(cutoff);
      }
    }
  });

  it("reports positive distance across deep voids of the lensed set — the region floors close vacuous branch terms", () => {
    const transforms = sierpinskiTetrahedron();
    const final = boxfoldFinal();
    const de = buildSurfaceDE(transforms, final);
    // Density is the subject here, not just probe coverage: `nearest` below
    // stands in for "is p genuinely in a void of the lensed attractor", and
    // a sparse cloud would misclassify near-attractor points as void merely
    // from sampling gaps. Kept well above the 20k default (still 15x down
    // from the 300k this once built) with `deepVoidProbes > 20` re-verified at
    // this size.
    const cloud = runChaosGame(transforms, 80000, mulberry32(81), final);
    const R = de.visibleBoundingRadius;
    const rng = mulberry32(82);
    let deepVoidProbes = 0;
    for (let i = 0; i < 200; i++) {
      const p: Vec3 = [
        (rng() - 0.5) * 2.2 * R,
        (rng() - 0.5) * 2.2 * R,
        (rng() - 0.5) * 2.2 * R,
      ];
      const nearest = nearestDistance(cloud, p);
      if (nearest <= 0.15 * R) continue;
      deepVoidProbes++;
      expect(estimateDistanceRefined(de, p)).toBeGreaterThanOrEqual(0.01 * R);
    }
    expect(deepVoidProbes).toBeGreaterThan(20);
  });
});

// -----------------------------------------------------------------------
// PROBE-FIT CENTERED BOUNDING BALL. Shipped presets are authored
// near the origin, so the origin ball wins the build's tightness
// comparison on every one of them and the centered path never runs there
// (measured: every beam-harness system keeps its historical R). These
// tests exist to exercise the centered path deliberately — off-center
// systems (Surprise-Me rolls translate freely) are where it pays.
// -----------------------------------------------------------------------

describe("probe-fit centered bounding ball", () => {
  /** Translate an IFS so its attractor moves by exactly `d`: the map
   * x -> M(x − d) + t + d has translation t + d − M·d and the same linear
   * part, and its attractor is the original's shifted by `d`. */
  function translated(transforms: Transform[], d: Vec3): Transform[] {
    return transforms.map((t): Transform => {
      const m = composeAffine(t).m;
      const md: Vec3 = [
        m[0] * d[0] + m[1] * d[1] + m[2] * d[2],
        m[3] * d[0] + m[4] * d[1] + m[5] * d[2],
        m[6] * d[0] + m[7] * d[1] + m[8] * d[2],
      ];
      return {
        ...t,
        position: [
          (t.position?.[0] ?? 0) + d[0] - md[0],
          (t.position?.[1] ?? 0) + d[1] - md[1],
          (t.position?.[2] ?? 0) + d[2] - md[2],
        ],
      };
    });
  }

  it("keeps a far-translated system's ball tight instead of inflating it to reach the origin", () => {
    const d: Vec3 = [5, -3, 4];
    const de = buildSurfaceDE(sierpinskiTetrahedron());
    const shifted = buildSurfaceDE(translated(sierpinskiTetrahedron(), d));
    // The origin ball would need radius ~|d| + R (~8.8); the fit stays at
    // the attractor's own size and sits on the shifted attractor.
    expect(shifted.boundingRadius).toBeLessThan(Math.hypot(...d));
    expect(shifted.boundingRadius).toBeLessThan(de.boundingRadius * 1.35);
    const centerOffset = Math.hypot(
      shifted.boundCenter[0] - d[0],
      shifted.boundCenter[1] - d[1],
      shifted.boundCenter[2] - d[2],
    );
    expect(centerOffset).toBeLessThan(shifted.boundingRadius);
  });

  it("keeps a far-translated system's estimates valid and un-degraded by |d|", () => {
    const d: Vec3 = [5, -3, 4];
    const de = buildSurfaceDE(sierpinskiTetrahedron());
    const shiftedTransforms = translated(sierpinskiTetrahedron(), d);
    const shifted = buildSurfaceDE(shiftedTransforms);
    const cloud = runChaosGame(shiftedTransforms, 20000, mulberry32(1235));
    const rng = mulberry32(1234);
    const R = de.boundingRadius;
    for (let i = 0; i < 60; i++) {
      const p: Vec3 = [
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
      ];
      const q: Vec3 = [p[0] + d[0], p[1] + d[1], p[2] + d[2]];
      const a = estimateDistanceRefined(de, p);
      const b = estimateDistanceRefined(shifted, q);
      // Still a lower bound at the translated query...
      expect(b).toBeLessThanOrEqual(nearestDistance(cloud, q) + 1e-6);
      // ...and within the two BALLS' own shape difference of the
      // original's estimate — Ritter's few-percent radius slack plus the
      // fitted center's offset, measured ~0.18R worst here. The origin
      // ball would have degraded these estimates by |d|-scale slack
      // (whole units at |d| ~ 7), which this band cleanly excludes.
      expect(b).toBeGreaterThan(a - 0.25 * R);
    }
  });

  it("keeps descendFold a valid lower bound under a hand-centered ball", () => {
    // No shipped fold system picks a fitted center (fold attractors hug
    // the origin), so exercise the fold body's centered arithmetic
    // directly: any ball enclosing ball(0, R) is a valid bound ball, so
    // shifting the center by c and growing the radius by |c| must keep
    // every estimate a lower bound. The stage-2 skip data is rebuilt for
    // the new center exactly as buildSurfaceDE derives it.
    const transforms = pureBoxfoldPair();
    const de = buildSurfaceDE(transforms);
    const c: Vec3 = [0.11, -0.07, 0.09];
    const grown = de.boundingRadius + Math.hypot(...c);
    const maps = de.maps.map((m): SurfaceDEMap => {
      const tpx = m.invT[0] - c[0];
      const tpy = m.invT[1] - c[1];
      const tpz = m.invT[2] - c[2];
      const tn = Math.hypot(tpx, tpy, tpz);
      return {
        ...m,
        invTNorm: tn,
        bnbDir:
          tn > 0
            ? [
                (m.invM[0] * tpx + m.invM[3] * tpy + m.invM[6] * tpz) / tn,
                (m.invM[1] * tpx + m.invM[4] * tpy + m.invM[7] * tpz) / tn,
                (m.invM[2] * tpx + m.invM[5] * tpy + m.invM[8] * tpz) / tn,
              ]
            : [0, 0, 0],
      };
    });
    const centered: SurfaceDE = {
      ...de,
      maps,
      boundCenter: c,
      boundingRadius: grown,
      escapeRadius: 2 * grown,
    };
    const cloud = runChaosGame(transforms, 20000, mulberry32(55));
    const rng = mulberry32(56);
    for (let i = 0; i < 150; i++) {
      const base = Math.floor(rng() * cloud.count) * 3;
      const p: Vec3 = [
        cloud.positions[base] + (rng() - 0.5) * 0.3,
        cloud.positions[base + 1] + (rng() - 0.5) * 0.3,
        cloud.positions[base + 2] + (rng() - 0.5) * 0.3,
      ];
      const nearest = nearestDistance(cloud, p);
      expect(estimateDistance(centered, p)).toBeLessThanOrEqual(nearest + 1e-6);
      expect(estimateDistanceRefined(centered, p)).toBeLessThanOrEqual(
        nearest + 1e-6,
      );
    }
  });
});

// -----------------------------------------------------------------------
// FOOTPRINT-CAPPED DESCENT DEPTH. The marcher's per-step cone
// footprint (eps·t) caps how deep a descent can usefully resolve: a chain
// at depth d tracks a piece of diameter <= 2R·slowestSigma^d, so depth
// past ceil(log(f/2R)/log(slowestSigma)) resolves sub-footprint detail.
// The cap is VALID at any depth (cap terminals are certified bounds for
// their pieces); what it trades is resolution — bounded by the footprint
// itself, which is the `previewMaxDepth` argument made per-query.
// -----------------------------------------------------------------------

describe("footprint-capped descent depth", () => {
  /** The doubleRotation 3D mirror (sigma 0.93 — maxDepth 127, the
   * profile the solid-ball artifact was measured on; its slow
   * map's fixed point is the origin). */
  function slowProfile(): Transform[] {
    return [
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
  }

  it("is bit-identical to the frame-wide descent at footprint 0 (and NaN)", () => {
    const de = buildSurfaceDE(slowProfile());
    const rng = mulberry32(31);
    for (let i = 0; i < 40; i++) {
      const p: Vec3 = [rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1];
      expect(
        Object.is(estimateDistance(de, p), estimateDistance(de, p, 0, 0)),
      ).toBe(true);
      expect(
        Object.is(
          estimateDistanceRefined(de, p),
          estimateDistanceRefined(de, p, 0, Number.NaN),
        ),
      ).toBe(true);
    }
  });

  it("stays a valid lower bound at every footprint, on affine and fold systems alike", () => {
    for (const transforms of [sierpinskiTetrahedron(), pureBoxfoldPair()]) {
      const de = buildSurfaceDE(transforms);
      const cloud = runChaosGame(transforms, 20000, mulberry32(91));
      const rng = mulberry32(92);
      const R = de.boundingRadius;
      for (const f of [R / 10, R / 100, R / 1000]) {
        for (let i = 0; i < 40; i++) {
          const base = Math.floor(rng() * cloud.count) * 3;
          const p: Vec3 = [
            cloud.positions[base] + (rng() - 0.5) * 0.3,
            cloud.positions[base + 1] + (rng() - 0.5) * 0.3,
            cloud.positions[base + 2] + (rng() - 0.5) * 0.3,
          ];
          const nearest = nearestDistance(cloud, p);
          expect(estimateDistance(de, p, 0, f)).toBeLessThanOrEqual(
            nearest + 1e-6,
          );
          expect(estimateDistanceRefined(de, p, 0, f)).toBeLessThanOrEqual(
            nearest + 1e-6,
          );
        }
      }
    }
  });

  it("bounds any fabricated reading by the footprint itself", () => {
    // The resolution trade's whole envelope: a capped in-sphere terminal
    // is scale·(r − R) with scale <= footprint/2R by the cap's sizing, so
    // no capped estimate can sit below -footprint — the fabricated
    // surface, where one exists, is sub-footprint by construction.
    const de = buildSurfaceDE(slowProfile());
    const R = de.boundingRadius;
    const rng = mulberry32(93);
    for (const f of [R / 20, R / 200, R / 2000]) {
      for (let i = 0; i < 60; i++) {
        const p: Vec3 = [
          (rng() - 0.5) * 2.4 * R,
          (rng() - 0.5) * 2.4 * R,
          (rng() - 0.5) * 2.4 * R,
        ];
        expect(estimateDistance(de, p, 0, f)).toBeGreaterThanOrEqual(-f);
        expect(estimateDistanceRefined(de, p, 0, f)).toBeGreaterThanOrEqual(-f);
      }
    }
  });

  it("does not regrow the solid-ball artifact at a realistic pixel footprint", () => {
    // The record: at frame-wide cap 48 this profile read
    // est = |p| − 0.047 along a ray into the slow map's fixed point (the
    // origin) — a fat fabricated ball, ~5% of R. With the footprint form
    // at a full-tier pixel scale (f = 1e-3·R) the cap sizes itself to
    // ~105 levels and the fabricated band shrinks under f: probes well
    // clear of the attractor (nearest >= 0.02R, 20x the footprint) must
    // still read a no-hit-at-this-resolution estimate.
    const transforms = slowProfile();
    const de = buildSurfaceDE(transforms);
    const cloud = runChaosGame(transforms, 20000, mulberry32(94));
    const R = de.boundingRadius;
    const f = 1e-3 * R;
    let checked = 0;
    for (let i = 0; i < 400; i++) {
      // March-like samples along rays toward the origin from outside.
      const theta = (i / 400) * Math.PI * 2;
      const t = 0.02 + (0.18 * ((i * 7) % 400)) / 400;
      const p: Vec3 = [
        Math.cos(theta) * t * R,
        Math.sin(theta) * t * R,
        (((i * 13) % 400) / 400 - 0.5) * 0.2 * R,
      ];
      const nearest = nearestDistance(cloud, p);
      if (nearest < 0.02 * R) continue;
      checked++;
      expect(estimateDistance(de, p, 0, f)).toBeGreaterThan(f);
      expect(estimateDistanceRefined(de, p, 0, f)).toBeGreaterThan(f);
    }
    expect(checked).toBeGreaterThan(60);
  });

  it("actually engages: a coarse footprint coarsens some estimate", () => {
    const de = buildSurfaceDE(slowProfile());
    const R = de.boundingRadius;
    const rng = mulberry32(95);
    let differing = 0;
    for (let i = 0; i < 60; i++) {
      const p: Vec3 = [
        (rng() - 0.5) * 1.6 * R,
        (rng() - 0.5) * 1.6 * R,
        (rng() - 0.5) * 1.6 * R,
      ];
      if (
        !Object.is(estimateDistance(de, p), estimateDistance(de, p, 0, R / 2))
      ) {
        differing++;
      }
    }
    expect(differing).toBeGreaterThan(0);
  });
});

describe("authored fold radii in the inverse branch algebra", () => {
  // The fold's three lengths became `Variation` fields, so every constant in
  // the branch enumeration became an expression. Two properties have to
  // survive that: the defaults must not move at all, and the bound must stay
  // a LOWER bound at lengths nobody has rendered before.
  //
  // Ground truth is `nearestDistance` against a chaos-game cloud, the same
  // oracle the affine sections above use — sound because the cloud is a
  // SUBSET of the attractor, so distance-to-cloud is an upper bound on
  // distance-to-attractor, which the estimate must sit under.

  it("descends a mandelbox map identically whether the classic radii are absent or spelled out", () => {
    const absent: Transform[] = [
      {
        id: 1,
        position: [0.2, 0.1, 0],
        rotation: [0.3, 0, 0.2],
        scale: [0.2, 0.2, 0.2],
        variations: [{ type: "mandelbox", weight: 0.25 }],
      },
      {
        id: 2,
        position: [-0.3, 0.25, 0.1],
        rotation: [0, 0.4, 0],
        scale: [0.5, 0.5, 0.5],
      },
    ];
    const spelled: Transform[] = [
      {
        ...absent[0],
        variations: [
          {
            type: "mandelbox",
            weight: 0.25,
            minRadius: 0.5,
            fixedRadius: 1,
            boxLimit: 1,
          },
        ],
      },
      absent[1],
    ];
    const deAbsent = buildSurfaceDE(absent);
    const deSpelled = buildSurfaceDE(spelled);
    const rng = mulberry32(0x5f11);
    for (let i = 0; i < 300; i++) {
      const p: Vec3 = [(rng() - 0.5) * 3, (rng() - 0.5) * 3, (rng() - 0.5) * 3];
      expect(estimateDistance(deSpelled, p)).toBe(
        estimateDistance(deAbsent, p),
      );
      expect(estimateDistanceRefined(deSpelled, p)).toBe(
        estimateDistanceRefined(deAbsent, p),
      );
    }
  });

  it("stays a lower bound on a boxfold map at a non-classic wall, which is the only length its branches read", () => {
    const transforms: Transform[] = [
      {
        id: 1,
        position: [0.15, 0.1, -0.05],
        rotation: [0.2, 0.3, 0],
        scale: [0.6, 0.6, 0.6],
        variations: [{ type: "boxfold", weight: 0.9, boxLimit: 0.6 }],
      },
      {
        id: 2,
        position: [-0.4, 0.2, 0.3],
        rotation: [0, -0.5, 0.25],
        scale: [0.45, 0.45, 0.45],
      },
    ];
    expect(analyzeSurfaceSystem(transforms).status).not.toBe("ineligible");
    const de = buildSurfaceDE(transforms);
    const cloud = runChaosGame(transforms, 20000, mulberry32(7));
    const rng = mulberry32(0x5f12);
    for (let i = 0; i < 300; i++) {
      const p: Vec3 = [(rng() - 0.5) * 4, (rng() - 0.5) * 4, (rng() - 0.5) * 4];
      const nearest = nearestDistance(cloud, p);
      expect(estimateDistance(de, p)).toBeLessThanOrEqual(nearest + 1e-6);
      expect(estimateDistanceRefined(de, p)).toBeLessThanOrEqual(
        nearest + 1e-6,
      );
    }
  });

  it("stays a lower bound on a spherefold map at a wider ball, where the magnification is unchanged but every radius moved", () => {
    // fR = 1.4, mR = 0.7 holds fR²/mR² at the classic 4 while moving the
    // outer region, the mid shell, the inversion radius and the inner
    // branch's output cap — so a failure here is a length substitution and
    // not the magnification.
    const transforms: Transform[] = [
      {
        id: 1,
        position: [0.1, 0.2, 0.05],
        rotation: [0, 0.35, 0.1],
        scale: [0.35, 0.35, 0.35],
        variations: [
          { type: "spherefold", weight: 0.6, minRadius: 0.7, fixedRadius: 1.4 },
        ],
      },
      {
        id: 2,
        position: [-0.35, -0.15, 0.2],
        rotation: [0.4, 0, -0.3],
        scale: [0.45, 0.45, 0.45],
      },
    ];
    expect(analyzeSurfaceSystem(transforms).status).not.toBe("ineligible");
    const de = buildSurfaceDE(transforms);
    const cloud = runChaosGame(transforms, 20000, mulberry32(7));
    const rng = mulberry32(0x5f13);
    for (let i = 0; i < 300; i++) {
      const p: Vec3 = [(rng() - 0.5) * 5, (rng() - 0.5) * 5, (rng() - 0.5) * 5];
      const nearest = nearestDistance(cloud, p);
      expect(estimateDistance(de, p)).toBeLessThanOrEqual(nearest + 1e-6);
      expect(estimateDistanceRefined(de, p)).toBeLessThanOrEqual(
        nearest + 1e-6,
      );
    }
  });

  it("stays a lower bound on a mandelbox map with all three lengths moved at once", () => {
    const transforms: Transform[] = [
      {
        id: 1,
        position: [0.2, -0.1, 0.15],
        rotation: [0.25, 0.4, 0],
        scale: [0.2, 0.2, 0.2],
        variations: [
          {
            type: "mandelbox",
            weight: 0.25,
            minRadius: 0.3,
            fixedRadius: 1.2,
            boxLimit: 0.8,
          },
        ],
      },
      {
        id: 2,
        position: [-0.3, 0.3, -0.2],
        rotation: [0, -0.6, 0.2],
        scale: [0.5, 0.5, 0.5],
      },
    ];
    expect(analyzeSurfaceSystem(transforms).status).not.toBe("ineligible");
    const de = buildSurfaceDE(transforms);
    const cloud = runChaosGame(transforms, 20000, mulberry32(7));
    const rng = mulberry32(0x5f14);
    for (let i = 0; i < 300; i++) {
      const p: Vec3 = [(rng() - 0.5) * 4, (rng() - 0.5) * 4, (rng() - 0.5) * 4];
      const nearest = nearestDistance(cloud, p);
      expect(estimateDistance(de, p)).toBeLessThanOrEqual(nearest + 1e-6);
      expect(estimateDistanceRefined(de, p)).toBeLessThanOrEqual(
        nearest + 1e-6,
      );
    }
  });

  it("stays a lower bound through a fold LENS at non-classic lengths — descendLens has no contraction gate to keep it honest", () => {
    const transforms: Transform[] = [
      {
        id: 1,
        position: [0.4, 0.3, 0.1],
        rotation: [0.2, 0.5, 0],
        scale: [0.5, 0.5, 0.5],
      },
      {
        id: 2,
        position: [-0.4, 0.15, -0.25],
        rotation: [0, -0.6, 0.3],
        scale: [0.48, 0.48, 0.48],
      },
    ];
    const lens: Transform = {
      id: 3,
      position: [0.05, -0.1, 0],
      rotation: [0.1, 0.2, 0],
      scale: [0.9, 0.9, 0.9],
      variations: [
        {
          type: "mandelbox",
          weight: 1.1,
          minRadius: 0.35,
          fixedRadius: 1.3,
          boxLimit: 0.75,
        },
      ],
    };
    expect(analyzeSurfaceSystem(transforms, lens).status).not.toBe(
      "ineligible",
    );
    const de = buildSurfaceDE(transforms, lens);
    const cloud = runChaosGame(transforms, 20000, mulberry32(7), lens);
    const rng = mulberry32(0x5f15);
    for (let i = 0; i < 300; i++) {
      const p: Vec3 = [(rng() - 0.5) * 5, (rng() - 0.5) * 5, (rng() - 0.5) * 5];
      const nearest = nearestDistance(cloud, p);
      expect(estimateDistance(de, p)).toBeLessThanOrEqual(nearest + 1e-6);
      expect(estimateDistanceRefined(de, p)).toBeLessThanOrEqual(
        nearest + 1e-6,
      );
    }
  });

  it("moves the eligibility gate with the magnification — a map that contracts at the classic radii need not at a smaller minRadius", () => {
    // `SPHEREFOLD_LIPSCHITZ` is no longer a constant the gate multiplies; it
    // is `fR²/mR²`, so the same weight and scale fall on either side of
    // CONTRACTION_LIMIT depending on the authored radii (measured:
    // `mandelboxKifs` sits 9% from this seam).
    const at = (minRadius?: number): Transform[] => [
      {
        id: 1,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [0.2, 0.2, 0.2],
        variations: [{ type: "spherefold", weight: 1, minRadius }],
      },
    ];
    // Classic: 1 x 4 x 0.2 = 0.8, contracts.
    expect(analyzeSurfaceSystem(at()).status).not.toBe("ineligible");
    // mR = 0.25: 1 x 16 x 0.2 = 3.2, does not.
    expect(analyzeSurfaceSystem(at(0.25)).reasons).toContain(
      "map 1 does not contract",
    );
  });
});

describe("fold-radius rescale equivariance", () => {
  // The sharpest check the fold family admits, and the reason the
  // no-fourth-SIZE-field argument could measure anything at all: a uniform
  // rescale is EQUIVARIANT through both folds, so conjugating a system by
  // `p = k·q` gives back the same system with all three lengths and every
  // translation divided by k —
  //
  //     T(p)  = w·V_{mR,fR,wall}(M p + t)
  //     T'(q) = T(k q)/k = w·V_{mR/k, fR/k, wall/k}(M q + t/k)
  //
  // — whose attractor is exactly `A/k`. So `DE'(q)` must equal `DE(k q)/k`
  // to floating point, at every query, and that is an EQUALITY rather than
  // an inequality: it fails in BOTH directions, which the conservatism
  // bounds above cannot do. Every LENGTH the branch algebra reads (`fixedR`,
  // its square and reciprocal, `outputR`, the box wall, the mid guard) is
  // pinned by it; the two dimensionless RATIOS are invariant under the
  // rescale and are pinned by the tightness floors instead.
  //
  // The tolerance is relative and not exact because `buildSurfaceDE` fits
  // its bounding ball from a seeded chaos-game probe whose first point is
  // NOT rescaled — the two clouds converge to proportional within a few
  // warm-up iterations, not identically.
  const K = 2.5;
  /** Measured worst relative disagreement across these four fixtures is
   * 1.9e-3 to 2.6e-3, and it tracks the bounding-ball ratio (0.9974-0.9987)
   * almost exactly — so this is the probe, not the algebra. 1% leaves ~4x
   * margin while staying two orders under the O(1) shift any wrong length
   * produces. */
  const RELATIVE_TOLERANCE = 0.01;

  /** `S` conjugated by `p = k·q`: same linear parts and weights, every
   * translation and every fold length divided by `k`. */
  function rescale(t: Transform, k: number): Transform {
    return {
      ...t,
      position: [t.position[0] / k, t.position[1] / k, t.position[2] / k],
      variations: t.variations?.map((v) => ({
        ...v,
        minRadius: (v.minRadius ?? SPHERE_FOLD_MIN_RADIUS) / k,
        fixedRadius: (v.fixedRadius ?? SPHERE_FOLD_FIXED_RADIUS) / k,
        boxLimit: (v.boxLimit ?? BOX_FOLD_LIMIT) / k,
      })),
    };
  }

  function expectEquivariant(
    transforms: Transform[],
    lens: Transform | null,
    seed: number,
    span: number,
  ): void {
    const de = buildSurfaceDE(transforms, lens);
    const deK = buildSurfaceDE(
      transforms.map((t) => rescale(t, K)),
      lens ? rescale(lens, K) : null,
    );
    const rng = mulberry32(seed);
    let compared = 0;
    for (let i = 0; i < 200; i++) {
      const q: Vec3 = [
        (rng() - 0.5) * span,
        (rng() - 0.5) * span,
        (rng() - 0.5) * span,
      ];
      const scaled: Vec3 = [q[0] * K, q[1] * K, q[2] * K];
      for (const estimate of [estimateDistance, estimateDistanceRefined]) {
        const small = estimate(deK, q);
        const large = estimate(de, scaled) / K;
        if (Math.abs(large) <= 1e-3) continue;
        expect(
          Math.abs(small - large) / Math.abs(large),
          `q=[${q.join(", ")}] ${small} vs ${large}`,
        ).toBeLessThan(RELATIVE_TOLERANCE);
        compared++;
      }
    }
    // Guard against a vacuous pass: the queries must actually reach the
    // descent rather than all bailing out at the sphere gate.
    expect(compared).toBeGreaterThan(100);
  }

  it("holds for a mandelbox map with all three lengths authored", () => {
    expectEquivariant(
      [
        {
          id: 1,
          position: [0.2, -0.1, 0.15],
          rotation: [0.25, 0.4, 0],
          scale: [0.2, 0.2, 0.2],
          variations: [
            {
              type: "mandelbox",
              weight: 0.25,
              minRadius: 0.3,
              fixedRadius: 1.2,
              boxLimit: 0.8,
            },
          ],
        },
        {
          id: 2,
          position: [-0.3, 0.3, -0.2],
          rotation: [0, -0.6, 0.2],
          scale: [0.5, 0.5, 0.5],
        },
      ],
      null,
      0x5f21,
      4,
    );
  });

  it("holds for a spherefold map, where only the radial lengths are in play", () => {
    expectEquivariant(
      [
        {
          id: 1,
          position: [0.1, 0.2, 0.05],
          rotation: [0, 0.35, 0.1],
          scale: [0.35, 0.35, 0.35],
          variations: [
            {
              type: "spherefold",
              weight: 0.6,
              minRadius: 0.7,
              fixedRadius: 1.4,
            },
          ],
        },
        {
          id: 2,
          position: [-0.35, -0.15, 0.2],
          rotation: [0.4, 0, -0.3],
          scale: [0.45, 0.45, 0.45],
        },
      ],
      null,
      0x5f22,
      5,
    );
  });

  it("holds for a boxfold map, where only the wall is in play", () => {
    expectEquivariant(
      [
        {
          id: 1,
          position: [0.15, 0.1, -0.05],
          rotation: [0.2, 0.3, 0],
          scale: [0.6, 0.6, 0.6],
          variations: [{ type: "boxfold", weight: 0.9, boxLimit: 0.6 }],
        },
        {
          id: 2,
          position: [-0.4, 0.2, 0.3],
          rotation: [0, -0.5, 0.25],
          scale: [0.45, 0.45, 0.45],
        },
      ],
      null,
      0x5f23,
      4,
    );
  });

  it("holds at queries within the mid branch's near-origin guard, where it folds a shell bound instead of inverting", () => {
    // The mid branch stops inverting inside `SPHEREFOLD_MID_MIN_R·fR` of the
    // sector origin and folds a shell bound instead. No query drawn across
    // the bounding ball reaches that regime, so it needs probes aimed at the
    // origin — and equivariance is the invariant that still holds there.
    //
    // DISCLOSED LIMIT, measured by mutating each substitution and re-running
    // this file: three of the fold constants are NOT observable through the
    // public estimate on any fixture here, so no test in this describe pins
    // them. The mid guard's THRESHOLD would need a query landing in the thin
    // band between the classic 1e-3 and 1e-3·fR; its SHELL STAND-IN is
    // deliberately loose enough (~|w|·fR) never to be the argmin, which is
    // the whole reason it is safe; and the inner branch's `innerScale` is
    // dominated by that branch's own region floor, which reads `outputR`
    // (pinned) rather than the child position. The inner branch's SIGMA is
    // pinned, and it is the same authored ratio, so a wrong magnification
    // still fails — what is unpinned is only an inconsistent pair no single
    // edit produces. The argument for the mid threshold scaling with fR
    // rather than fR² is therefore dimensional, and lives on the constant.
    expectEquivariant(
      [
        {
          id: 1,
          position: [0.2, -0.1, 0.15],
          rotation: [0.25, 0.4, 0],
          scale: [0.2, 0.2, 0.2],
          variations: [
            {
              type: "mandelbox",
              weight: 0.25,
              minRadius: 0.3,
              fixedRadius: 1.2,
              boxLimit: 0.8,
            },
          ],
        },
        {
          id: 2,
          position: [-0.3, 0.3, -0.2],
          rotation: [0, -0.6, 0.2],
          scale: [0.5, 0.5, 0.5],
        },
      ],
      null,
      0x5f25,
      1e-4,
    );
  });

  it("holds through a fold LENS, whose branches are swept at the query rather than iterated", () => {
    expectEquivariant(
      [
        {
          id: 1,
          position: [0.4, 0.3, 0.1],
          rotation: [0.2, 0.5, 0],
          scale: [0.5, 0.5, 0.5],
        },
        {
          id: 2,
          position: [-0.4, 0.15, -0.25],
          rotation: [0, -0.6, 0.3],
          scale: [0.48, 0.48, 0.48],
        },
      ],
      {
        id: 3,
        position: [0.05, -0.1, 0],
        rotation: [0.1, 0.2, 0],
        scale: [0.9, 0.9, 0.9],
        variations: [
          {
            type: "mandelbox",
            weight: 1.1,
            minRadius: 0.35,
            fixedRadius: 1.3,
            boxLimit: 0.75,
          },
        ],
      },
      0x5f24,
      5,
    );
  });
});

describe("analyzeSurfaceSystem chaos rows", () => {
  it("refuses a chi-carrying document — the descent would march the unconstrained object", () => {
    const transforms = sierpinskiTetrahedron().map((t, i) =>
      i === 0 ? { ...t, chaos: [1, 0, 1, 1] } : t,
    );
    const analysis = analyzeSurfaceSystem(transforms);
    expect(analysis.status).toBe("ineligible");
    expect(analysis.reasons).toContain(
      "chaos rows constrain the attractor (Surface would march the unconstrained object)",
    );
    // A trivial (all-1s) row is no row at all — the same document stays
    // eligible with it.
    const trivial = sierpinskiTetrahedron().map((t) => ({
      ...t,
      chaos: [1, 1, 1, 1],
    }));
    expect(analyzeSurfaceSystem(trivial).status).toBe("eligible");
  });
});
