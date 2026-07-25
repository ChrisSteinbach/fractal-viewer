import {
  analyzeSurfaceSystem4,
  buildSurfaceDE4,
  estimateDistance4,
  estimateDistance4Refined,
  singularValues4,
  transformSigmas4,
} from "./surface-de-4d";
import type { SurfaceDE4Map } from "./surface-de-4d";
import { singularValues3 } from "./surface-de";
import { composeAffine } from "./affine";
import { applyAffine4, composeAffine4, toTransform4 } from "./affine4";
import { runChaosGame4 } from "./chaos-game-4d";
import type { ChaosGame4Result } from "./chaos-game-4d";
import { doubleRotation, pentatope, sixteenCellFlake } from "./presets";
import { mulberry32 } from "./rng";
import type { Transform, Transform4, Vec4 } from "./types";

/** Minimal contracting 4D-analysis map for the eligibility-table tests
 * below, merged with each test's own overrides — mirrors `surface-de.test.ts`'s
 * `map()` exactly, since `analyzeSurfaceSystem4` still takes plain 3D
 * `Transform`s (the `w` block is what makes a case genuinely 4D). */
function map4(overrides: Partial<Transform> = {}): Transform {
  return {
    id: 0,
    position: [0.1, 0.2, 0.3],
    rotation: [0, 0, 0],
    scale: [0.5, 0.5, 0.5],
    ...overrides,
  };
}

/** Apply a row-major 4x4's LINEAR part only (no translation) to a vector. */
function applyLinear4(m: number[], v: Vec4): Vec4 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2] + m[3] * v[3],
    m[4] * v[0] + m[5] * v[1] + m[6] * v[2] + m[7] * v[3],
    m[8] * v[0] + m[9] * v[1] + m[10] * v[2] + m[11] * v[3],
    m[12] * v[0] + m[13] * v[1] + m[14] * v[2] + m[15] * v[3],
  ];
}

function normalize4(v: Vec4): Vec4 {
  const len = Math.hypot(v[0], v[1], v[2], v[3]);
  return [v[0] / len, v[1] / len, v[2] / len, v[3] / len];
}

/** Row-major 4x4 product `a . b`, for the invM/forward-M round-trip checks
 * below (independent of `surface-de-4d.ts`'s own matrix helpers). */
function multiply4x4(a: number[], b: number[]): number[] {
  const out = new Array<number>(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[r * 4 + k] * b[k * 4 + c];
      out[r * 4 + c] = sum;
    }
  }
  return out;
}

/** Apply a {@link SurfaceDE4Map}'s inverse affine to a point. */
function applyInverse4(map: SurfaceDE4Map, p: Vec4): Vec4 {
  const { invM: im, invT: it } = map;
  return [
    im[0] * p[0] + im[1] * p[1] + im[2] * p[2] + im[3] * p[3] + it[0],
    im[4] * p[0] + im[5] * p[1] + im[6] * p[2] + im[7] * p[3] + it[1],
    im[8] * p[0] + im[9] * p[1] + im[10] * p[2] + im[11] * p[3] + it[2],
    im[12] * p[0] + im[13] * p[1] + im[14] * p[2] + im[15] * p[3] + it[3],
  ];
}

/** Brute-force nearest 4D distance from `p` to any point of a sampled cloud
 * — the ground truth {@link estimateDistance4}'s lower-bound property is
 * checked against, computed independently of the module under test. */
function nearestDistance4(cloud: ChaosGame4Result, p: Vec4): number {
  let best = Infinity;
  const { positions, w, count } = cloud;
  for (let i = 0; i < count; i++) {
    const dx = positions[i * 3] - p[0];
    const dy = positions[i * 3 + 1] - p[1];
    const dz = positions[i * 3 + 2] - p[2];
    const dw = w[i] - p[3];
    const d2 = dx * dx + dy * dy + dz * dz + dw * dw;
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}

/** The standard {@link estimateDistance4} validity query set: every 40th
 * cloud sample jittered by +-0.15 per coordinate, ~20 points uniform in
 * `[-1.5, 1.5]^4`, and 5 exact (unjittered) cloud samples spread across the
 * cloud — near/far/on-cloud probes in one pass. */
function validityQueries(cloud: ChaosGame4Result): Vec4[] {
  const queries: Vec4[] = [];
  const jitterRng = mulberry32(2);
  for (let i = 0; i < cloud.count; i += 40) {
    queries.push([
      cloud.positions[i * 3] + (jitterRng() - 0.5) * 0.3,
      cloud.positions[i * 3 + 1] + (jitterRng() - 0.5) * 0.3,
      cloud.positions[i * 3 + 2] + (jitterRng() - 0.5) * 0.3,
      cloud.w[i] + (jitterRng() - 0.5) * 0.3,
    ]);
  }
  const uniformRng = mulberry32(3);
  for (let i = 0; i < 20; i++) {
    queries.push([
      (uniformRng() - 0.5) * 3,
      (uniformRng() - 0.5) * 3,
      (uniformRng() - 0.5) * 3,
      (uniformRng() - 0.5) * 3,
    ]);
  }
  for (let i = 0; i < 5; i++) {
    const j = Math.floor((cloud.count * (i + 0.5)) / 5);
    queries.push([
      cloud.positions[j * 3],
      cloud.positions[j * 3 + 1],
      cloud.positions[j * 3 + 2],
      cloud.w[j],
    ]);
  }
  return queries;
}

/** A lighter query set — `count` cloud samples jittered by +-0.15 per
 * coordinate — for the descent-depth stress test, which only needs to show
 * no violations, not re-exercise the full near/far/on-cloud mix. */
function jitteredQueries(cloud: ChaosGame4Result, count: number): Vec4[] {
  const queries: Vec4[] = [];
  const jitterRng = mulberry32(2);
  const stride = Math.max(1, Math.floor(cloud.count / count));
  for (let i = 0; i < count; i++) {
    const idx = (i * stride) % cloud.count;
    queries.push([
      cloud.positions[idx * 3] + (jitterRng() - 0.5) * 0.3,
      cloud.positions[idx * 3 + 1] + (jitterRng() - 0.5) * 0.3,
      cloud.positions[idx * 3 + 2] + (jitterRng() - 0.5) * 0.3,
      cloud.w[idx] + (jitterRng() - 0.5) * 0.3,
    ]);
  }
  return queries;
}

describe("singularValues4", () => {
  it("returns equal min/max for a 4x4 identity (the uniform-scale fast path)", () => {
    // prettier-ignore
    const identity = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ];
    expect(singularValues4(identity)).toEqual({ min: 1, max: 1 });
  });

  it("returns the scale extremes for an unrotated diagonal transform", () => {
    const t: Transform4 = { position: [0, 0, 0, 0], scale: [2, 5, 3, 4] };
    const sigmas = singularValues4(composeAffine4(t).m);
    expect(sigmas.min).toBeCloseTo(2, 10);
    expect(sigmas.max).toBeCloseTo(5, 10);
  });

  it("stays rotation-invariant: several rotation planes still give exactly the scale extremes", () => {
    const t: Transform4 = {
      position: [0, 0, 0, 0],
      scale: [0.5, 0.8, 0.3, 0.6],
      rotation: { xy: 0.7, zw: 1.1, xw: 0.4 },
    };
    const sigmas = singularValues4(composeAffine4(t).m);
    expect(Math.abs(sigmas.min - 0.3)).toBeLessThan(1e-12);
    expect(Math.abs(sigmas.max - 0.8)).toBeLessThan(1e-12);
  });

  it("takes the absolute value of negative scale components", () => {
    const t: Transform4 = {
      position: [0, 0, 0, 0],
      scale: [-0.5, 0.25, 0.4, -0.9],
    };
    const sigmas = singularValues4(composeAffine4(t).m);
    expect(sigmas.min).toBeCloseTo(0.25, 10);
    expect(sigmas.max).toBeCloseTo(0.9, 10);
  });
});

describe("singularValues4 cross-check against singularValues3", () => {
  it("matches a sheared 3D map's sigmas on the upper-left block, embedded block-diagonal with a scalar w-block", () => {
    const sheared: Transform = {
      id: 0,
      position: [0, 0, 0],
      rotation: [0.3, -0.4, 0.6],
      scale: [0.6, 0.4, 0.5],
      shear: [0.3, -0.2, 0.15],
    };
    const m3 = composeAffine(sheared).m;
    const sv3 = singularValues3(m3);
    const sw = 0.7;
    // prettier-ignore
    const m4 = [
      m3[0], m3[1], m3[2], 0,
      m3[3], m3[4], m3[5], 0,
      m3[6], m3[7], m3[8], 0,
      0,     0,     0,     sw,
    ];
    const sv4 = singularValues4(m4);
    expect(Math.abs(sv4.min - Math.min(sv3.min, sw))).toBeLessThan(1e-10);
    expect(Math.abs(sv4.max - Math.max(sv3.max, sw))).toBeLessThan(1e-10);
  });
});

describe("singularValues4 sandwich bound (the property the DE leans on)", () => {
  it("bounds |Mv| between sigma_min*|v| and sigma_max*|v| for axis vectors and two arbitrary directions", () => {
    const t: Transform4 = {
      position: [0, 0, 0, 0],
      scale: [0.6, 0.9, 0.3, 0.7],
      rotation: { xy: 0.5, xz: -0.3, yw: 0.8 },
      shear: { xy: 0.2, zw: -0.15, xw: 0.1 },
    };
    const m = composeAffine4(t).m;
    const sigmas = singularValues4(m);
    const directions: Vec4[] = [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
      normalize4([1, 1, 1, 1]),
      normalize4([1, -2, 0.5, 3]),
    ];
    for (const v of directions) {
      const mv = applyLinear4(m, v);
      const vLen = Math.hypot(v[0], v[1], v[2], v[3]);
      const mvLen = Math.hypot(mv[0], mv[1], mv[2], mv[3]);
      expect(mvLen).toBeGreaterThanOrEqual(sigmas.min * vLen - 1e-10);
      expect(mvLen).toBeLessThanOrEqual(sigmas.max * vLen + 1e-10);
    }
  });
});

describe("transformSigmas4", () => {
  it("returns exact scale extremes when unsheared, ignoring rotation", () => {
    const t: Transform4 = {
      position: [0, 0, 0, 0],
      scale: [0.3, 0.7, 0.5, 0.4],
      rotation: { xy: 0.3, zw: -0.6 },
    };
    expect(transformSigmas4(t)).toEqual({ min: 0.3, max: 0.7 });
  });

  it("matches singularValues4(composeAffine4(t).m) when sheared", () => {
    const t: Transform4 = {
      position: [0, 0, 0, 0],
      scale: [0.5, 0.5, 0.5, 0.5],
      shear: { xy: 0.3, zw: 0.2 },
    };
    const expected = singularValues4(composeAffine4(t).m);
    expect(transformSigmas4(t)).toEqual(expected);
  });
});

describe("analyzeSurfaceSystem4 on presets", () => {
  it("classifies pentatope as eligible, isotropic, with all five sigmas {0.5, 0.5}", () => {
    const analysis = analyzeSurfaceSystem4(pentatope());
    expect(analysis.status).toBe("eligible");
    expect(analysis.anisotropy).toBe(1);
    expect(analysis.stepScale).toBe(1);
    expect(analysis.sigmas).toHaveLength(5);
    for (const s of analysis.sigmas) {
      expect(Math.abs(s.min - 0.5)).toBeLessThan(1e-12);
      expect(Math.abs(s.max - 0.5)).toBeLessThan(1e-12);
    }
  });

  it("classifies doubleRotation as eligible", () => {
    const analysis = analyzeSurfaceSystem4(doubleRotation());
    expect(analysis.status).toBe("eligible");
    expect(analysis.reasons).toEqual([]);
  });
});

describe("analyzeSurfaceSystem4 eligibility", () => {
  it("flags a map with an active variation as ineligible, naming the map", () => {
    const analysis = analyzeSurfaceSystem4([
      map4({ variations: [{ type: "swirl", weight: 1 }] }),
    ]);
    expect(analysis.status).toBe("ineligible");
    expect(analysis.reasons).toHaveLength(1);
    expect(analysis.reasons[0]).toMatch(/uses variations/);
    expect(analysis.reasons[0]).toContain("map 1");
  });

  it("treats a weight-0 variation as inert, staying eligible", () => {
    const analysis = analyzeSurfaceSystem4([
      map4({ variations: [{ type: "swirl", weight: 0 }] }),
    ]);
    expect(analysis.status).toBe("eligible");
    expect(analysis.reasons).toEqual([]);
  });

  it("flags a uniform scale-1 map as not contracting", () => {
    const analysis = analyzeSurfaceSystem4([map4({ scale: [1, 1, 1] })]);
    expect(analysis.status).toBe("ineligible");
    expect(analysis.reasons).toHaveLength(1);
    expect(analysis.reasons[0]).toMatch(/does not contract/);
  });

  it("flags a near-zero scale map as nearly flat", () => {
    const analysis = analyzeSurfaceSystem4([
      map4({ scale: [1e-5, 1e-5, 1e-5] }),
    ]);
    expect(analysis.status).toBe("ineligible");
    expect(analysis.reasons).toHaveLength(1);
    expect(analysis.reasons[0]).toMatch(/nearly flat/);
  });

  it("ignores a weight-0 non-contracting map, staying eligible if the rest are fine", () => {
    const analysis = analyzeSurfaceSystem4([
      map4({ weight: 0, scale: [1.5, 1.5, 1.5] }),
      map4({ id: 1 }),
    ]);
    expect(analysis.status).toBe("eligible");
    expect(analysis.reasons).toEqual([]);
  });

  it("does not gate a map that extends into 4D via its w block — that is the point of this module", () => {
    const analysis = analyzeSurfaceSystem4([
      map4({ w: { position: 0.6, rotation: { xw: 0.4 } } }),
    ]);
    expect(analysis.status).toBe("eligible");
    expect(analysis.reasons).toEqual([]);
  });

  it("flags an empty system as ineligible", () => {
    const analysis = analyzeSurfaceSystem4([]);
    expect(analysis.status).toBe("ineligible");
    expect(analysis.reasons).toEqual(["no transforms"]);
  });

  it("flags a system whose every map has weight 0 as ineligible", () => {
    const analysis = analyzeSurfaceSystem4([
      map4({ weight: 0 }),
      map4({ id: 1, weight: 0 }),
    ]);
    expect(analysis.status).toBe("ineligible");
    expect(analysis.reasons).toEqual(["every transform has weight 0"]);
  });
});

describe("buildSurfaceDE4 eligibility gate", () => {
  it("throws when building a DE for an ineligible system", () => {
    const ineligible = [map4({ variations: [{ type: "swirl", weight: 1 }] })];
    expect(() => buildSurfaceDE4(ineligible)).toThrow(/variations/);
  });
});

describe("buildSurfaceDE4 on pentatope", () => {
  it("builds one inverse map per active transform", () => {
    const de = buildSurfaceDE4(pentatope());
    expect(de.maps).toHaveLength(5);
  });

  it("probes a bounding radius that reaches the vertices' circumradius of 1", () => {
    const de = buildSurfaceDE4(pentatope());
    expect(de.boundingRadius).toBeGreaterThanOrEqual(1);
    expect(de.boundingRadius).toBeLessThan(1.3);
  });

  it("sizes the depth cap at 14 (ceil(log(1e-4) / log(0.5)))", () => {
    const de = buildSurfaceDE4(pentatope());
    expect(de.maxDepth).toBe(14);
  });

  it("derives escapeRadius as exactly 2x boundingRadius", () => {
    const de = buildSurfaceDE4(pentatope());
    expect(de.escapeRadius).toBeCloseTo(2 * de.boundingRadius, 10);
  });

  it("contributes no slot for a weight-0 map, in a 6-transform variant", () => {
    const transforms = pentatope();
    const withInactive: Transform[] = [
      ...transforms,
      { ...transforms[0], id: 5, weight: 0 },
    ];
    expect(withInactive).toHaveLength(6);
    const de = buildSurfaceDE4(withInactive);
    expect(de.maps).toHaveLength(5);
  });

  it("inverts the composed forward map exactly (forward . inverse = identity)", () => {
    const transforms = pentatope();
    const de = buildSurfaceDE4(transforms);
    const forward = composeAffine4(toTransform4(transforms[0])).m;
    const product = multiply4x4(forward, de.maps[0].invM);
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        expect(product[r * 4 + c]).toBeCloseTo(r === c ? 1 : 0, 10);
      }
    }
  });

  it("round-trips a point through a map's forward image and back via invM/invT", () => {
    const transforms = pentatope();
    const de = buildSurfaceDE4(transforms);
    const forward = composeAffine4(toTransform4(transforms[1]));
    const p: Vec4 = [0.1, -0.2, 0.05, 0.3];
    const image = applyAffine4(forward, p[0], p[1], p[2], p[3]);
    const back = applyInverse4(de.maps[1], image);
    expect(back[0]).toBeCloseTo(p[0], 10);
    expect(back[1]).toBeCloseTo(p[1], 10);
    expect(back[2]).toBeCloseTo(p[2], 10);
    expect(back[3]).toBeCloseTo(p[3], 10);
  });
});

describe("estimateDistance4 validity (never exceeds the true distance to a sampled cloud)", () => {
  it("holds for pentatope across jittered/uniform/exact queries", () => {
    const transforms = pentatope();
    const de = buildSurfaceDE4(transforms);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(1),
    );
    for (const q of validityQueries(cloud)) {
      const nearest = nearestDistance4(cloud, q);
      expect(estimateDistance4(de, q)).toBeLessThanOrEqual(nearest + 1e-9);
    }
  });

  it("holds for sixteenCellFlake across jittered/uniform/exact queries", () => {
    const transforms = sixteenCellFlake();
    const de = buildSurfaceDE4(transforms);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(1),
    );
    for (const q of validityQueries(cloud)) {
      const nearest = nearestDistance4(cloud, q);
      expect(estimateDistance4(de, q)).toBeLessThanOrEqual(nearest + 1e-9);
    }
  });
});

describe("estimateDistance4 on-attractor", () => {
  it("reads at or below ~0 at each pentatope vertex (a fixed point of its own map)", () => {
    const de = buildSurfaceDE4(pentatope());
    const s = Math.sqrt(5) / 4;
    const vertices: Vec4[] = [
      [s, s, s, -0.25],
      [s, -s, -s, -0.25],
      [-s, s, -s, -0.25],
      [-s, -s, s, -0.25],
      [0, 0, 0, 1],
    ];
    for (const v of vertices) {
      expect(estimateDistance4(de, v)).toBeLessThanOrEqual(1e-6);
    }
  });
});

describe("estimateDistance4 far-point bound", () => {
  it("floors at the sphere bound and stays within the true nearest-sample distance", () => {
    const transforms = pentatope();
    const de = buildSurfaceDE4(transforms);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(1),
    );
    const q: Vec4 = [10, 0, 0, 0];
    const d = estimateDistance4(de, q);
    expect(d).toBeGreaterThanOrEqual(10 - de.boundingRadius - 1e-9);
    const nearest = nearestDistance4(cloud, q);
    expect(d).toBeLessThanOrEqual(nearest + 1e-9);
  });
});

describe("estimateDistance4 void positivity", () => {
  it("confirms the pentatope centroid sits in a genuine void of a dense sampled cloud", () => {
    const transforms = pentatope();
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      200000,
      mulberry32(11),
    );
    // Measured (this probe, this seed): true nearest-cloud distance from the
    // centroid is ~0.412 — comfortably clear of the margin below, well
    // outside sampling noise.
    const trueDistance = nearestDistance4(cloud, [0, 0, 0, 0]);
    expect(trueDistance).toBeGreaterThan(0.1);
  });

  it("reads a strictly positive DE at the pentatope centroid (that same void)", () => {
    const de = buildSurfaceDE4(pentatope());
    // True nearest-cloud distance measured above is ~0.412 (DE itself reads
    // ~0.242 there); this pins a conservative threshold well under both,
    // robust to sampling noise.
    expect(estimateDistance4(de, [0, 0, 0, 0])).toBeGreaterThan(0.02);
  });
});

describe("estimateDistance4 descent depth stress (doubleRotation, maxDepth capped at 48)", () => {
  it("holds validity for exact cloud-sample queries despite the capped depth", () => {
    const transforms = doubleRotation();
    const de = buildSurfaceDE4(transforms);
    expect(de.maxDepth).toBe(48);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(1),
    );
    // Exact (unjittered) samples, not the jittered/uniform mix the other two
    // presets' validity tests use above — see the "known limitation" test
    // below for why. These stay governed by the terminal KIFS bound, which
    // is unconditionally valid at any depth (see the module doc), so this
    // still meaningfully exercises the 48-level-capped descent itself. The
    // epsilon is looser than the other validity tests' 1e-9: up to 48
    // levels of accumulated 4x4 matrix-multiply rounding widens the
    // floating-point noise floor (empirically ~1e-7 here).
    for (let i = 0; i < cloud.count; i += 400) {
      const q: Vec4 = [
        cloud.positions[i * 3],
        cloud.positions[i * 3 + 1],
        cloud.positions[i * 3 + 2],
        cloud.w[i],
      ];
      const nearest = nearestDistance4(cloud, q);
      expect(estimateDistance4(de, q)).toBeLessThanOrEqual(nearest + 1e-6);
    }
  });

  it("still bounds a far point correctly", () => {
    const de = buildSurfaceDE4(doubleRotation());
    const d = estimateDistance4(de, [8, 0, 0, 0]);
    expect(d).toBeGreaterThanOrEqual(8 - de.boundingRadius - 1e-9);
  });

  it("shows off-attractor jittered queries CAN exceed the cloud-distance bound here — a known, inherited limitation, not a 4D-specific defect", () => {
    // doubleRotation has only two maps, weight 6:1, sigma 0.93 vs 0.22 (see
    // its preset doc): a system this far from evenly-weighted/conformal is
    // exactly where the module doc's documented "residual risk" applies —
    // "branches whose images stay inside the sphere carry no positive
    // certificate ... the residual risk of that choice is what the
    // eligibility analysis' stepScale fudge (and the marcher's hit epsilon)
    // absorbs." Confirmed during this spike's development that this is
    // INHERITED, not introduced by the 4D port: a structurally identical
    // 2-map, weight-6:1, sigma-0.93/0.22 3D system built on the production,
    // unmodified `surface-de.ts` shows the same overshoot against its own
    // sampled cloud. Off-attractor validity for low-map-count,
    // high-disparity systems is exactly the kind of caveat a feasibility
    // spike exists to surface — contrast the exact-sample test above (which
    // this preset satisfies) and pentatope/sixteenCellFlake's validity
    // tests (whose many, evenly-weighted maps satisfy the full jittered
    // query mix cleanly).
    const transforms = doubleRotation();
    const de = buildSurfaceDE4(transforms);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(1),
    );
    const violatesSomewhere = jitteredQueries(cloud, 20).some((q) => {
      const nearest = nearestDistance4(cloud, q);
      return estimateDistance4(de, q) > nearest + 1e-9;
    });
    expect(violatesSomewhere).toBe(true);
  });
});

// -----------------------------------------------------------------------
// estimateDistance4Refined (fr-beck spike verdict — see the module doc's
// SPIKE VERDICT section): the certificate-refinement variant that measurably
// eliminates the slice-march ghosting section (e) traced to the sibling-
// certificate term, without touching the doubleRotation-profile greedy
// branch-selection gap the tests above already document.
// -----------------------------------------------------------------------

describe("estimateDistance4Refined never falls below the base estimate", () => {
  it("holds for pentatope across the validityQueries mix", () => {
    const transforms = pentatope();
    const de = buildSurfaceDE4(transforms);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(1),
    );
    for (const q of validityQueries(cloud)) {
      const base = estimateDistance4(de, q);
      const refined = estimateDistance4Refined(de, q);
      expect(refined).toBeGreaterThanOrEqual(base - 1e-12);
    }
  });
});

describe("estimateDistance4Refined validity (never exceeds the true distance to a sampled cloud)", () => {
  it("holds for pentatope across jittered/uniform/exact queries", () => {
    const transforms = pentatope();
    const de = buildSurfaceDE4(transforms);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(1),
    );
    for (const q of validityQueries(cloud)) {
      const nearest = nearestDistance4(cloud, q);
      expect(estimateDistance4Refined(de, q)).toBeLessThanOrEqual(
        nearest + 1e-9,
      );
    }
  });

  it("holds for sixteenCellFlake across jittered/uniform/exact queries", () => {
    const transforms = sixteenCellFlake();
    const de = buildSurfaceDE4(transforms);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(1),
    );
    for (const q of validityQueries(cloud)) {
      const nearest = nearestDistance4(cloud, q);
      expect(estimateDistance4Refined(de, q)).toBeLessThanOrEqual(
        nearest + 1e-9,
      );
    }
  });
});

describe("estimateDistance4Refined collapses a measured ghost point", () => {
  it("tightens a pentatope void probe that would false-hit a slice march at eps_hit=0.01R", () => {
    // Pinned from the fr-beck spike's (g2) run (`surface-de-4d.spike.test.ts`,
    // seeds: main cloud mulberry32(101)/500_000, w0 = 10th percentile of the
    // w-distribution, void probe mulberry32(31) index 3): a genuine void
    // (d3 = 0.2057 >> theta_vis = 0.05*R = 0.0516) where the base estimator
    // reads DE = 0.00562 — comfortably under the eps_hit = 0.01*R = 0.01032
    // a slice march would hit-test against, i.e. a measured false-hit
    // ("ghost") — while the refined estimator reads 0.1372, over 4x the
    // eps_hit and correctly signalling "no content here". Measured
    // (bit-exact to this system's boundingRadius, R = 1.03171):
    //   base    = 0.005624521216463618
    //   refined = 0.13723927851937934
    //   d3      = 0.20574953287596418  (true nearest slice distance)
    //   d4      = 0.20575046436319630  (true nearest 4D distance — d3 ≈ d4:
    //             the nearest attractor content is already in this slice,
    //             so this is exactly the base estimator's OWN slack, not
    //             off-slice content the base case could ever have reached)
    const transforms = pentatope();
    const de = buildSurfaceDE4(transforms);
    const p: Vec4 = [
      0.2012058828743044, -0.22083853166311757, 0.28312175332393863,
      -0.24930457323789598,
    ];
    const base = estimateDistance4(de, p);
    const refined = estimateDistance4Refined(de, p);
    expect(base).toBeLessThan(0.011);
    expect(refined).toBeGreaterThan(0.03);
  });
});

describe("estimateDistance4Refined does not repair the greedy branch-selection overshoot (doubleRotation)", () => {
  it("still violates somewhere on the same jitteredQueries(cloud, 20) set the base estimator violates on", () => {
    // Companion to "shows off-attractor jittered queries CAN exceed the
    // cloud-distance bound here" above: that test shows the BASE estimator
    // overshoots on doubleRotation via the greedy branch-selection heuristic
    // (not a certificate-tightness problem — see the module doc's SPIKE
    // VERDICT section). The certificate refinement only ever raises a
    // certificate; it cannot fix a wrong branch selection, so the same
    // overshoot survives refinement — this pins that the two mechanisms are
    // independent, not that refinement is broken.
    const transforms = doubleRotation();
    const de = buildSurfaceDE4(transforms);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(1),
    );
    const violatesSomewhere = jitteredQueries(cloud, 20).some((q) => {
      const nearest = nearestDistance4(cloud, q);
      return estimateDistance4Refined(de, q) > nearest + 1e-9;
    });
    expect(violatesSomewhere).toBe(true);
  });
});
