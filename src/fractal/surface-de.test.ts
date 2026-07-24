import {
  analyzeSurfaceSystem,
  buildSurfaceDE,
  estimateDistance,
  singularValues3,
  transformSigmas,
} from "./surface-de";
import { applyAffine, composeAffine, rotationMatrixXYZ } from "./affine";
import { runChaosGame } from "./chaos-game";
import type { ChaosGameResult } from "./chaos-game";
import { sierpinskiTetrahedron } from "./presets";
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
