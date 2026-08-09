import {
  analyzeSurfaceSystem4,
  buildSurfaceDE4,
  estimateDistance4,
  estimateDistance4Refined,
  singularValues4,
  transformSigmas4,
} from "./surface-de-4d";
import type { SurfaceDE4, SurfaceDE4Map } from "./surface-de-4d";
import { singularValues3 } from "./surface-de";
import { composeAffine } from "./affine";
import {
  applyAffine4,
  composeAffine4,
  symmetryRotation4,
  toTransform4,
} from "./affine4";
import { symmetryRotation } from "./chaos-game";
import { runChaosGame4 } from "./chaos-game-4d";
import type { ChaosGame4Result } from "./chaos-game-4d";
import {
  doubleRotation,
  pentatope,
  sixteenCellFlake,
  tesseract,
  twentyFourCellFlake,
} from "./presets";
import { mulberry32 } from "./rng";
import type { SymmetryParams, Transform, Transform4, Vec4 } from "./types";
import { clamp } from "./vec";

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

/** Brute-force nearest 4D distance from the SEGMENT `{q + s·e : s in
 * [-1, 1]}` to any point of a sampled point set — the segment twin of
 * {@link nearestDistance4}, ground truth for the slab estimators'
 * lower-bound property (fr-wa6o). Takes raw parallel arrays rather than a
 * {@link ChaosGame4Result} so the same helper covers both a plain sampled
 * cloud (`cloud.positions, cloud.w, cloud.count`) and one pushed through a
 * final-transform lens, which has no `ChaosGame4Result` of its own to build.
 * Per point `a`, the segment's own closest-approach parameter is the
 * unconstrained minimizer of `|q + s·e - a|²`, `s = dot(a - q, e) /
 * dot(e, e)`, clamped to the segment's ends — the brute-force twin of the
 * module under test's own `segmentRadius`. */
function nearestSegmentDistance4(
  positions: Float32Array,
  w: Float32Array,
  count: number,
  q: Vec4,
  e: Vec4,
): number {
  const ee = e[0] * e[0] + e[1] * e[1] + e[2] * e[2] + e[3] * e[3];
  let best = Infinity;
  for (let i = 0; i < count; i++) {
    const ax = positions[i * 3] - q[0];
    const ay = positions[i * 3 + 1] - q[1];
    const az = positions[i * 3 + 2] - q[2];
    const aw = w[i] - q[3];
    const s =
      ee > 0
        ? clamp((ax * e[0] + ay * e[1] + az * e[2] + aw * e[3]) / ee, -1, 1)
        : 0;
    const dx = q[0] + s * e[0] - positions[i * 3];
    const dy = q[1] + s * e[1] - positions[i * 3 + 1];
    const dz = q[2] + s * e[2] - positions[i * 3 + 2];
    const dw = q[3] + s * e[3] - w[i];
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

  it("classifies the 24-map twentyFourCellFlake as eligible — the map count the tracer's raised cap admits (fr-dqlq)", () => {
    const transforms = twentyFourCellFlake();
    expect(transforms).toHaveLength(24);
    const analysis = analyzeSurfaceSystem4(transforms);
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

describe("estimateDistance4 descent depth stress (doubleRotation, maxDepth 127)", () => {
  it("holds validity for exact cloud-sample queries despite the deep descent", () => {
    const transforms = doubleRotation();
    const de = buildSurfaceDE4(transforms);
    // 127 = ceil(ln 1e-4 / ln 0.93): sigma 0.93 needs the full formula
    // depth, comfortably under the MAX_DESCENT_DEPTH ceiling of 128 that
    // fr-xok8 raised it to (the old 48 ceiling clamped this preset and
    // rendered its unresolved core as a solid ball).
    expect(de.maxDepth).toBe(127);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(1),
    );
    // Exact (unjittered) samples, not the jittered/uniform mix the other two
    // presets' validity tests use above — see the "known limitation" test
    // below for why. These stay governed by the terminal KIFS bound, which
    // is unconditionally valid at any depth (see the module doc), so this
    // still meaningfully exercises the 127-level descent itself. The
    // epsilon is looser than the other validity tests' 1e-9: up to 127
    // levels of accumulated 4x4 matrix-multiply rounding widens the
    // floating-point noise floor.
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

  it("holds under the width-2 beam: no query in jitteredQueries(cloud, 20) exceeds the cloud-distance bound (fr-v6yg fix)", () => {
    // doubleRotation has only two maps, weight 6:1, sigma 0.93 vs 0.22 (see
    // its preset doc) — a system this far from evenly-weighted/conformal is
    // exactly the profile fr-v6yg's width-2 descent beam was built to repair
    // (see this module's FR-V6YG RESOLUTION doc section): a second
    // simultaneous in-sphere branch, dropped uncounted at width 1, is
    // refined by the second chain instead of lost. Tolerance is 1e-6, not
    // the validity tests' 1e-9 above: this system descends 127 levels, and
    // the "holds validity for exact cloud-sample queries" test above
    // already documents the accumulated fp-noise floor at that depth.
    const transforms = doubleRotation();
    const de = buildSurfaceDE4(transforms);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(1),
    );
    const violatesSomewhere = jitteredQueries(cloud, 20).some((q) => {
      const nearest = nearestDistance4(cloud, q);
      return estimateDistance4(de, q) > nearest + 1e-6;
    });
    expect(violatesSomewhere).toBe(false);
  });

  it("still violates somewhere when forced back to beamWidth 1 — the single-chain mechanism the beam repairs", () => {
    // Forcing the built DE's beamWidth to 1 reproduces the OLD greedy
    // single-chain descent value-for-value (see the module doc): a second
    // simultaneous in-sphere branch is dropped uncounted instead of refined,
    // and doubleRotation's 2-map, weight-6:1, sigma-0.93/0.22 profile —
    // confirmed during fr-beck's development to be INHERITED from 3D
    // `estimateDistance`, not introduced by the 4D port — is exactly where
    // that drop measurably overshoots the cloud-distance bound. This is the
    // bug the width-2 beam test above fixes; both tests share the same
    // cloud and query set so the only variable is beamWidth.
    const transforms = doubleRotation();
    const de = buildSurfaceDE4(transforms);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(1),
    );
    const violatesSomewhere = jitteredQueries(cloud, 20).some((q) => {
      const nearest = nearestDistance4(cloud, q);
      return estimateDistance4({ ...de, beamWidth: 1 }, q) > nearest + 1e-9;
    });
    expect(violatesSomewhere).toBe(true);
  });
});

// -----------------------------------------------------------------------
// estimateDistance4Refined (fr-beck spike verdict — see the module doc's
// SPIKE VERDICT section): the certificate-refinement variant that measurably
// eliminates the slice-march ghosting section (e) traced to the sibling-
// certificate term. The doubleRotation-profile greedy branch-selection gap
// fr-beck also measured is a SEPARATE mechanism refinement never touches on
// its own (still reproducible by forcing beamWidth: 1, see the tests below);
// fr-v6yg's width-2 descent beam is what closes it in the built DE — see
// this module's FR-V6YG RESOLUTION doc section.
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

// -----------------------------------------------------------------------
// fr-jkpn validity slots (widths 3/4) — the 4D mirror of
// `surface-de.test.ts`'s "fr-jkpn validity slots on the sigma-0.96
// slow-map profile" describe block; see that file for the mechanism (a
// second insert-shift ladder holds each level's rank-3/4 candidates, which
// continue as extra chains ONLY while in-sphere). Same 2-map profile as the
// 3D test (sigma 0.96/0.22, weight 6:1) — one notch faster than this
// module's own `doubleRotation` preset (sigma 0.93/0.22), the notch where
// the 3D harness measured width 2 retaining a residual.
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
    // Same construction as the 3D mirror test (same profile, same cloud
    // seed/size); `jitteredQueries(cloud, 500)` reproduces that test's
    // inline stride-40 loop exactly (500 = 20000/40 points, same jitter RNG
    // and +-0.15/coord magnitude), plus a jittered w here.
    //
    // Measured (this build): UNLIKE 3D, forcing beamWidth 2 on this
    // jittered construction does NOT reveal a violation in 4D (0/500 at
    // tol 1e-9, vs 3D's reliable overshoot on the same construction) — in
    // 4D the drop surfaces on EXACT on-attractor queries instead, which is
    // what the width pair below pins. This test keeps the standard
    // jittered probe valid at the built width.
    const transforms = sigma096Profile();
    const de = buildSurfaceDE4(transforms);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(1),
    );
    for (const q of jitteredQueries(cloud, 500)) {
      const nearest = nearestDistance4(cloud, q);
      expect(estimateDistance4Refined(de, q)).toBeLessThanOrEqual(
        nearest + 1e-6,
      );
    }
  });

  it("covers every exact on-attractor query at the built width", () => {
    // Exact (unjittered) on-cloud queries — the "descent depth stress"
    // convention above: the query IS an attractor sample, so its true
    // distance is 0 and any estimate past the deep-descent fp-noise floor
    // (tolerance 1e-6; sigma 0.96 clamps at the 128-level
    // MAX_DESCENT_DEPTH ceiling) is fr-jkpn's dropped-branch overshoot
    // surfacing as clipped-away surface. Measured (this build): forced
    // width 2 reads positive on 17/50 of these, max 4.6e-3 (~0.4%R); the
    // built width's validity slots cover all 50 (max estimate 2.5e-8).
    const transforms = sigma096Profile();
    const de = buildSurfaceDE4(transforms);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(1),
    );
    for (let i = 0; i < cloud.count; i += 400) {
      const q: Vec4 = [
        cloud.positions[i * 3],
        cloud.positions[i * 3 + 1],
        cloud.positions[i * 3 + 2],
        cloud.w[i],
      ];
      expect(estimateDistance4Refined(de, q)).toBeLessThanOrEqual(1e-6);
    }
  });

  it("overshoots some of those exact queries when forced back to beamWidth 2 — the fr-jkpn drop the validity slots repair", () => {
    const transforms = sigma096Profile();
    const de = { ...buildSurfaceDE4(transforms), beamWidth: 2 as const };
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(1),
    );
    let violates = false;
    for (let i = 0; i < cloud.count; i += 400) {
      const q: Vec4 = [
        cloud.positions[i * 3],
        cloud.positions[i * 3 + 1],
        cloud.positions[i * 3 + 2],
        cloud.w[i],
      ];
      if (estimateDistance4Refined(de, q) > 1e-6) violates = true;
    }
    expect(violates).toBe(true);
  });
});

describe("estimateDistance4 beam and estimateDistance4Refined both collapse a measured ghost point", () => {
  it("clears a pentatope void probe that would false-hit a slice march at eps_hit=0.01R — width-1 alone still ghosts", () => {
    // Pinned from the fr-beck spike's (g2) run (`surface-de-4d.spike.test.ts`,
    // seeds: main cloud mulberry32(101)/500_000, w0 = 10th percentile of the
    // w-distribution, void probe mulberry32(31) index 3): a genuine void
    // (d3 = 0.2057 >> theta_vis = 0.05*R = 0.0516) where the OLD single-chain
    // estimator — still reproduced by forcing beamWidth: 1 below — reads
    // DE = 0.00562, comfortably under the eps_hit = 0.01*R = 0.01032 a slice
    // march would hit-test against, i.e. a measured false-hit ("ghost").
    // fr-v6yg's width-2 beam (built DE, no forcing) ALSO clears this ghost —
    // not just the certificate refinement it was originally measured
    // against — though refinement stays the stronger of the two. Measured
    // (this build, this point, bit-exact to boundingRadius R = 1.03171):
    //   width-1 base    = 0.005624521216463618  (the historical ghost)
    //   width-2 base    = 0.06858950489971172   (built DE — clears eps_hit)
    //   width-2 refined = 0.1519913667366567    (clears it by a wider margin)
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
    const base1 = estimateDistance4({ ...de, beamWidth: 1 }, p);
    const base2 = estimateDistance4(de, p);
    const refined2 = estimateDistance4Refined(de, p);
    expect(base1).toBeLessThan(0.011);
    expect(base2).toBeGreaterThan(0.05);
    expect(refined2).toBeGreaterThan(0.03);
  });
});

describe("estimateDistance4Refined does not repair width-1's branch-selection overshoot; the width-2 beam does (doubleRotation)", () => {
  it("still violates somewhere at beamWidth 1 — certificate refinement and branch selection are independent mechanisms", () => {
    // Companion to the width-1 mechanism test in the descent-depth-stress
    // describe above: that test shows the BASE estimator overshoots on
    // doubleRotation, forced to beamWidth 1, via the greedy branch-selection
    // heuristic (not a certificate-tightness problem — see the module doc's
    // SPIKE VERDICT section). The certificate refinement only ever raises a
    // certificate; it cannot fix a wrong branch selection, so at width 1 the
    // same overshoot survives refinement — this pins that the two
    // mechanisms are independent, not that refinement is broken.
    const transforms = doubleRotation();
    const de = buildSurfaceDE4(transforms);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(1),
    );
    const violatesSomewhere = jitteredQueries(cloud, 20).some((q) => {
      const nearest = nearestDistance4(cloud, q);
      return (
        estimateDistance4Refined({ ...de, beamWidth: 1 }, q) > nearest + 1e-9
      );
    });
    expect(violatesSomewhere).toBe(true);
  });

  it("has no violations on the built (width-2) DE — the beam, not refinement, is what repairs branch selection", () => {
    // Same query set and the same 1e-6 depth-descent tolerance as the base
    // estimator's width-2 fix test above: fr-v6yg's width-2 beam is what
    // closes the branch-selection gap, independent of (and in addition to)
    // certificate refinement.
    const transforms = doubleRotation();
    const de = buildSurfaceDE4(transforms);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(1),
    );
    const violatesSomewhere = jitteredQueries(cloud, 20).some((q) => {
      const nearest = nearestDistance4(cloud, q);
      return estimateDistance4Refined(de, q) > nearest + 1e-6;
    });
    expect(violatesSomewhere).toBe(false);
  });
});

// -----------------------------------------------------------------------
// Final-transform lens (fr-vxoj, landed post-verdict): a straight port of
// 3D's `SurfaceDE.final` one dimension up — see the module doc's updated
// "WHAT THIS SPIKE DELIBERATELY LEAVES OUT" section. Mirrors
// `surface-de.test.ts`'s "buildSurfaceDE / estimateDistance with a final
// transform" describe block and its neighbors.
// -----------------------------------------------------------------------

describe("analyzeSurfaceSystem4 with a final transform", () => {
  it("flags a final transform with an active variation as ineligible", () => {
    const analysis = analyzeSurfaceSystem4(
      [map4()],
      map4({ variations: [{ type: "swirl", weight: 1 }] }),
    );
    expect(analysis.status).toBe("ineligible");
    expect(analysis.reasons).toHaveLength(1);
    expect(analysis.reasons[0]).toMatch(/final transform uses variations/);
  });

  it("flags a final transform with near-zero scale as ineligible", () => {
    const analysis = analyzeSurfaceSystem4(
      [map4()],
      map4({ scale: [1e-5, 1e-5, 1e-5] }),
    );
    expect(analysis.status).toBe("ineligible");
    expect(analysis.reasons).toHaveLength(1);
    expect(analysis.reasons[0]).toMatch(/final transform is nearly flat/);
  });

  it("does not gate a final transform that extends into 4D via its w block — unlike 3D's analyzeSurfaceSystem, which disqualifies a non-flat final transform", () => {
    const analysis = analyzeSurfaceSystem4(
      [map4()],
      map4({ w: { position: 0.6, rotation: { xw: 0.4 } } }),
    );
    expect(analysis.status).toBe("eligible");
    expect(analysis.reasons).toEqual([]);
  });

  it('degrades status to "degraded" for a strongly anisotropic (but invertible) final transform', () => {
    const analysis = analyzeSurfaceSystem4(
      [map4()],
      map4({ scale: [0.9, 0.05, 0.05] }),
    );
    expect(analysis.status).toBe("degraded");
    expect(analysis.reasons).toEqual([]);
  });
});

describe("buildSurfaceDE4 with a final transform", () => {
  it("has no lens and visibleBoundingRadius equal to boundingRadius when built without one", () => {
    const de = buildSurfaceDE4(pentatope());
    expect(de.final).toBeNull();
    expect(de.visibleBoundingRadius).toBe(de.boundingRadius);
  });

  it("populates the lens and derives visibleBoundingRadius from the lifted final transform's sigma_max and translation norm", () => {
    const transforms = pentatope();
    const finalTransform = map4({
      position: [0.2, -0.1, 0.05],
      scale: [0.6, 0.6, 0.6],
    });
    const de = buildSurfaceDE4(transforms, finalTransform);
    expect(de.final).not.toBeNull();
    expect(de.final?.invM).toHaveLength(16);
    expect(de.final?.sigmaMin).toBeGreaterThan(0);

    const lifted = toTransform4(finalTransform);
    const affine = composeAffine4(lifted);
    const sigmas = transformSigmas4(lifted);
    const expected =
      sigmas.max * de.boundingRadius +
      Math.hypot(affine.t[0], affine.t[1], affine.t[2], affine.t[3]);
    expect(de.visibleBoundingRadius).toBeCloseTo(expected, 9);
  });

  it("throws when the final transform makes the system ineligible", () => {
    const transforms = pentatope();
    const ineligibleFinal = map4({
      variations: [{ type: "swirl", weight: 1 }],
    });
    expect(() => buildSurfaceDE4(transforms, ineligibleFinal)).toThrow(
      /final transform uses variations/,
    );
  });
});

describe("estimateDistance4 / estimateDistance4Refined with a final transform", () => {
  it("an identity final (scale 1, no rotation/translation) leaves both estimators unchanged", () => {
    const transforms = pentatope();
    const identityFinal = map4({ position: [0, 0, 0], scale: [1, 1, 1] });
    const withFinal = buildSurfaceDE4(transforms, identityFinal);
    const withoutFinal = buildSurfaceDE4(transforms);
    const points: Vec4[] = [
      [0.3, -0.2, 0.1, 0.05],
      [1.2, 0.4, -0.6, 0.2],
      [0, 0, 0, 0],
      [-0.5, 0.5, -0.5, 0.5],
    ];
    for (const p of points) {
      expect(estimateDistance4(withFinal, p)).toBeCloseTo(
        estimateDistance4(withoutFinal, p),
        12,
      );
      expect(estimateDistance4Refined(withFinal, p)).toBeCloseTo(
        estimateDistance4Refined(withoutFinal, p),
        12,
      );
    }
  });

  it("a pure uniform-scale final F scales both estimators by sigma_min(F): DE(F(q)) ≈ sigma_min(F) * DE(q)", () => {
    const transforms = pentatope();
    const finalTransform = map4({
      position: [0, 0, 0],
      scale: [0.5, 0.5, 0.5],
    });
    const withFinal = buildSurfaceDE4(transforms, finalTransform);
    const withoutFinal = buildSurfaceDE4(transforms);
    const forward = composeAffine4(toTransform4(finalTransform));
    const points: Vec4[] = [
      [0.3, -0.2, 0.1, 0.05],
      [1.2, 0.4, -0.6, 0.2],
      [-0.5, 0.5, -0.5, 0.5],
    ];
    for (const q of points) {
      const fq = applyAffine4(forward, q[0], q[1], q[2], q[3]);
      expect(estimateDistance4(withFinal, fq)).toBeCloseTo(
        0.5 * estimateDistance4(withoutFinal, q),
        9,
      );
      expect(estimateDistance4Refined(withFinal, fq)).toBeCloseTo(
        0.5 * estimateDistance4Refined(withoutFinal, q),
        9,
      );
    }
  });
});

describe("estimateDistance4Refined never falls below the base estimate, with a final transform in play", () => {
  it("holds for pentatope across the validityQueries mix", () => {
    const transforms = pentatope();
    const finalTransform = map4({
      position: [0.15, -0.1, 0.2],
      scale: [0.6, 0.4, 0.5],
      rotation: [0.3, -0.2, 0.5],
    });
    const de = buildSurfaceDE4(transforms, finalTransform);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(1),
    );
    for (const q of validityQueries(cloud)) {
      const base = estimateDistance4(de, q);
      const refined = estimateDistance4Refined(de, q);
      expect(refined).toBeGreaterThanOrEqual(base - 1e-9);
    }
  });
});

// estimateDistance4Refined's early-out cutoff (fr-55r5), the 3D twin's
// contract one dimension up. The slice march needs a HIT DECISION, not a
// distance, so it hands the DE its acceptance epsilon and the descent may
// stop once the value it would return is already below it. Two properties
// carry the contract, and every test below asserts both across a spread of
// probe distances:
//   (A) a returned value >= cutoff EQUALS the cutoff-0 result bit-for-bit
//       — step sizes above the hit threshold never drift;
//   (B) a returned value < cutoff implies the cutoff-0 result is < cutoff
//       — the hit verdict is identical: no false hit, no lost hit.
// The trap the exits are placed against: `best` must only ever be tested
// AFTER a fold settles it (refined, on this path). Exiting on a raw
// pre-refinement certificate would re-open the fr-beck ghost class, which
// the directed void test at the end of this section pins.
describe("estimateDistance4Refined early-out cutoff", () => {
  it("returns the full-descent value bit-for-bit when the cutoff is 0", () => {
    const de = buildSurfaceDE4(pentatope());
    const rng = mulberry32(11);
    for (let i = 0; i < 60; i++) {
      const p: Vec4 = [
        (rng() - 0.5) * 4,
        (rng() - 0.5) * 4,
        (rng() - 0.5) * 4,
        (rng() - 0.5) * 4,
      ];
      expect(estimateDistance4Refined(de, p, 0)).toBe(
        estimateDistance4Refined(de, p),
      );
    }
  });

  it("holds both properties on pentatope across on-surface, near and far probes", () => {
    const transforms = pentatope();
    const de = buildSurfaceDE4(transforms);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(1),
    );
    const rng = mulberry32(4242);
    const probes: Vec4[] = [];
    for (let i = 0; i < 40; i++) {
      const idx = Math.floor(rng() * cloud.count);
      const jitter = [0.004, 0.05, 0.4][i % 3];
      probes.push([
        cloud.positions[idx * 3] + (rng() - 0.5) * jitter,
        cloud.positions[idx * 3 + 1] + (rng() - 0.5) * jitter,
        cloud.positions[idx * 3 + 2] + (rng() - 0.5) * jitter,
        cloud.w[idx] + (rng() - 0.5) * jitter,
      ]);
    }
    for (let i = 0; i < 20; i++) {
      probes.push([
        (rng() - 0.5) * 4,
        (rng() - 0.5) * 4,
        (rng() - 0.5) * 4,
        (rng() - 0.5) * 4,
      ]);
    }
    const cutoffs = [1e-4, 1e-2, 5e-2, 2e-1].map((f) => f * de.boundingRadius);
    let earlyExits = 0;
    for (const p of probes) {
      const full = estimateDistance4Refined(de, p);
      for (const cutoff of cutoffs) {
        const value = estimateDistance4Refined(de, p, cutoff);
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

  it("holds both properties on sixteenCellFlake, whose 16 maps make every level's fold sweep wide", () => {
    const transforms = sixteenCellFlake();
    const de = buildSurfaceDE4(transforms);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(1),
    );
    const rng = mulberry32(909);
    const probes: Vec4[] = [];
    for (let i = 0; i < 30; i++) {
      const idx = Math.floor(rng() * cloud.count);
      const jitter = [0.004, 0.05, 0.4][i % 3];
      probes.push([
        cloud.positions[idx * 3] + (rng() - 0.5) * jitter,
        cloud.positions[idx * 3 + 1] + (rng() - 0.5) * jitter,
        cloud.positions[idx * 3 + 2] + (rng() - 0.5) * jitter,
        cloud.w[idx] + (rng() - 0.5) * jitter,
      ]);
    }
    for (let i = 0; i < 15; i++) {
      probes.push([
        (rng() - 0.5) * 4,
        (rng() - 0.5) * 4,
        (rng() - 0.5) * 4,
        (rng() - 0.5) * 4,
      ]);
    }
    const cutoffs = [1e-4, 1e-2, 5e-2, 2e-1].map((f) => f * de.boundingRadius);
    let earlyExits = 0;
    for (const p of probes) {
      const full = estimateDistance4Refined(de, p);
      for (const cutoff of cutoffs) {
        const value = estimateDistance4Refined(de, p, cutoff);
        expect(value).toBeGreaterThanOrEqual(full);
        if (value >= cutoff) expect(value).toBe(full);
        else expect(full).toBeLessThan(cutoff);
        if (value !== full) earlyExits++;
      }
    }
    expect(earlyExits).toBeGreaterThan(0);
  });

  it("holds both properties on doubleRotation, the profile whose branch selection the beam exists for", () => {
    const transforms = doubleRotation();
    const de = buildSurfaceDE4(transforms);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(1),
    );
    const rng = mulberry32(77);
    const probes: Vec4[] = [];
    for (let i = 0; i < 30; i++) {
      const idx = Math.floor(rng() * cloud.count);
      const jitter = [0.004, 0.05, 0.4][i % 3];
      probes.push([
        cloud.positions[idx * 3] + (rng() - 0.5) * jitter,
        cloud.positions[idx * 3 + 1] + (rng() - 0.5) * jitter,
        cloud.positions[idx * 3 + 2] + (rng() - 0.5) * jitter,
        cloud.w[idx] + (rng() - 0.5) * jitter,
      ]);
    }
    for (let i = 0; i < 15; i++) {
      probes.push([
        (rng() - 0.5) * 4,
        (rng() - 0.5) * 4,
        (rng() - 0.5) * 4,
        (rng() - 0.5) * 4,
      ]);
    }
    const cutoffs = [1e-4, 1e-2, 5e-2, 2e-1].map((f) => f * de.boundingRadius);
    let earlyExits = 0;
    for (const p of probes) {
      const full = estimateDistance4Refined(de, p);
      for (const cutoff of cutoffs) {
        const value = estimateDistance4Refined(de, p, cutoff);
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
    const transforms = pentatope();
    const finalTransform = map4({
      position: [0.15, -0.1, 0.2],
      scale: [0.6, 0.4, 0.5],
      rotation: [0.3, -0.2, 0.5],
    });
    const de = buildSurfaceDE4(transforms, finalTransform);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(1),
    );
    const rng = mulberry32(5150);
    const probes: Vec4[] = [];
    for (let i = 0; i < 30; i++) {
      const idx = Math.floor(rng() * cloud.count);
      const jitter = [0.004, 0.05, 0.4][i % 3];
      probes.push([
        cloud.positions[idx * 3] + (rng() - 0.5) * jitter,
        cloud.positions[idx * 3 + 1] + (rng() - 0.5) * jitter,
        cloud.positions[idx * 3 + 2] + (rng() - 0.5) * jitter,
        cloud.w[idx] + (rng() - 0.5) * jitter,
      ]);
    }
    for (let i = 0; i < 15; i++) {
      probes.push([
        (rng() - 0.5) * 4,
        (rng() - 0.5) * 4,
        (rng() - 0.5) * 4,
        (rng() - 0.5) * 4,
      ]);
    }
    const cutoffs = [1e-4, 1e-2, 5e-2, 2e-1].map((f) => f * de.boundingRadius);
    let earlyExits = 0;
    for (const p of probes) {
      const full = estimateDistance4Refined(de, p);
      for (const cutoff of cutoffs) {
        const value = estimateDistance4Refined(de, p, cutoff);
        expect(value).toBeGreaterThanOrEqual(full);
        if (value >= cutoff) expect(value).toBe(full);
        else expect(full).toBeLessThan(cutoff);
        if (value !== full) earlyExits++;
      }
    }
    expect(earlyExits).toBeGreaterThan(0);
  });

  it("does not false-hit the pentatope void probe at a cutoff above its plain-certificate dip", () => {
    // The ghost class fr-beck killed, aimed straight at the early-out: at
    // this void point (the fixture pinned earlier in this file) the plain
    // estimator reads 0.0686 while the refined descent settles at 0.1520. A
    // cutoff of 0.1 sits between them, so an exit that fired on a raw
    // pre-refinement certificate would return under 0.1 — a ghost membrane
    // in the slice march. Fully refined, the value is above the cutoff and
    // property (A) demands it be the full result, bit for bit.
    const de = buildSurfaceDE4(pentatope());
    const p: Vec4 = [
      0.2012058828743044, -0.22083853166311757, 0.28312175332393863,
      -0.24930457323789598,
    ];
    expect(estimateDistance4(de, p)).toBeLessThan(0.1);
    expect(estimateDistance4Refined(de, p, 0.1)).toBe(
      estimateDistance4Refined(de, p),
    );
    expect(estimateDistance4Refined(de, p, 0.1)).toBeGreaterThan(0.1);
  });
});

// The depth-0 sphere floor's own unconditional exit (fr-zkt2), the 3D
// twin's contract one dimension up: once `best` falls to or below
// `sphereBound`, descentValue's `max(best, sphereBound)` clamp is already
// pinned there, and `best` only ever falls further — so the descent may
// return the instant that happens, no cutoff required. Value-exact for
// EVERY caller (unlike the fr-55r5 cutoff exit, exact only at or above the
// cutoff), but also value-INVISIBLE: the returned number is identical
// whether or not the exit fired, so there is no "did it fire" counter
// below — the tests instead pin the invariant the exit leans on (the
// return never drops below the floor) and re-run the fr-55r5 cutoff
// contract over probe corpora biased into the region where the new exit
// actually triggers.
describe("estimateDistance4Refined sphere-floor pin (fr-zkt2)", () => {
  it("never returns below the depth-0 sphere floor on pentatope (no lens), for both estimateDistance4 and estimateDistance4Refined", () => {
    const transforms = pentatope();
    const de = buildSurfaceDE4(transforms);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(1),
    );
    const rng = mulberry32(7331);
    const probes: Vec4[] = [];
    // On-surface, jittered — the part-1 cloud+jitter pattern.
    for (let i = 0; i < 20; i++) {
      const idx = Math.floor(rng() * cloud.count);
      const jitter = [0.004, 0.05, 0.4][i % 3];
      probes.push([
        cloud.positions[idx * 3] + (rng() - 0.5) * jitter,
        cloud.positions[idx * 3 + 1] + (rng() - 0.5) * jitter,
        cloud.positions[idx * 3 + 2] + (rng() - 0.5) * jitter,
        cloud.w[idx] + (rng() - 0.5) * jitter,
      ]);
    }
    // Uniform hyper-box probes.
    for (let i = 0; i < 15; i++) {
      probes.push([
        (rng() - 0.5) * 4,
        (rng() - 0.5) * 4,
        (rng() - 0.5) * 4,
        (rng() - 0.5) * 4,
      ]);
    }
    // Outside the bounding hypersphere, 1.05-3x its radius, random
    // directions.
    for (let i = 0; i < 25; i++) {
      const dx = rng() - 0.5;
      const dy = rng() - 0.5;
      const dz = rng() - 0.5;
      const dw = rng() - 0.5;
      const n = Math.hypot(dx, dy, dz, dw) || 1;
      const radius = (1.05 + rng() * 1.95) * de.boundingRadius;
      probes.push([
        (dx / n) * radius,
        (dy / n) * radius,
        (dz / n) * radius,
        (dw / n) * radius,
      ]);
    }
    for (const p of probes) {
      // The exact prologue formula (both estimators' `startR`), not
      // Math.hypot — the assertion below is bit-exact, so it must match
      // the arithmetic the descent itself runs, not a merely-equivalent one.
      const floor =
        Math.sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2] + p[3] * p[3]) -
        de.boundingRadius;
      expect(estimateDistance4(de, p)).toBeGreaterThanOrEqual(floor);
      expect(estimateDistance4Refined(de, p)).toBeGreaterThanOrEqual(floor);
    }
  });

  it("computes the floor in lensed units when a final transform is present", () => {
    const transforms = pentatope();
    const finalTransform = map4({
      position: [0.15, -0.1, 0.2],
      scale: [0.6, 0.4, 0.5],
      rotation: [0.3, -0.2, 0.5],
    });
    const de = buildSurfaceDE4(transforms, finalTransform);
    const f = de.final;
    if (!f) throw new Error("expected a final-transform lens");
    const rng = mulberry32(24601);
    for (let i = 0; i < 12; i++) {
      const dx = rng() - 0.5;
      const dy = rng() - 0.5;
      const dz = rng() - 0.5;
      const dw = rng() - 0.5;
      const n = Math.hypot(dx, dy, dz, dw) || 1;
      const radius = (1.2 + rng() * 1.8) * de.visibleBoundingRadius;
      const p: Vec4 = [
        (dx / n) * radius,
        (dy / n) * radius,
        (dz / n) * radius,
        (dw / n) * radius,
      ];
      // The descend prologue's lens step, verbatim: row-major 4x4 invM
      // then invT, THEN the norm — matching order matters for bit-exactness.
      const im = f.invM;
      const it = f.invT;
      const qx =
        im[0] * p[0] + im[1] * p[1] + im[2] * p[2] + im[3] * p[3] + it[0];
      const qy =
        im[4] * p[0] + im[5] * p[1] + im[6] * p[2] + im[7] * p[3] + it[1];
      const qz =
        im[8] * p[0] + im[9] * p[1] + im[10] * p[2] + im[11] * p[3] + it[2];
      const qw =
        im[12] * p[0] + im[13] * p[1] + im[14] * p[2] + im[15] * p[3] + it[3];
      const lensedR = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw);
      const floor = (lensedR - de.boundingRadius) * f.sigmaMin;
      expect(estimateDistance4Refined(de, p)).toBeGreaterThanOrEqual(floor);
    }
  });

  it("keeps both cutoff properties on doubleRotation when probes are biased outside the bounding sphere", () => {
    const transforms = doubleRotation();
    const de = buildSurfaceDE4(transforms);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(1),
    );
    const rng = mulberry32(2718);
    const probes: Vec4[] = [];
    for (let i = 0; i < 24; i++) {
      const dx = rng() - 0.5;
      const dy = rng() - 0.5;
      const dz = rng() - 0.5;
      const dw = rng() - 0.5;
      const n = Math.hypot(dx, dy, dz, dw) || 1;
      const radius = (1.0 + rng() * 1.5) * de.boundingRadius;
      probes.push([
        (dx / n) * radius,
        (dy / n) * radius,
        (dz / n) * radius,
        (dw / n) * radius,
      ]);
    }
    for (let i = 0; i < 8; i++) {
      const idx = Math.floor(rng() * cloud.count);
      const jitter = [0.004, 0.05, 0.4][i % 3];
      probes.push([
        cloud.positions[idx * 3] + (rng() - 0.5) * jitter,
        cloud.positions[idx * 3 + 1] + (rng() - 0.5) * jitter,
        cloud.positions[idx * 3 + 2] + (rng() - 0.5) * jitter,
        cloud.w[idx] + (rng() - 0.5) * jitter,
      ]);
    }
    const cutoffs = [1e-4, 1e-2, 5e-2, 2e-1].map((f) => f * de.boundingRadius);
    let earlyExits = 0;
    for (const p of probes) {
      const full = estimateDistance4Refined(de, p);
      for (const cutoff of cutoffs) {
        const value = estimateDistance4Refined(de, p, cutoff);
        expect(value).toBeGreaterThanOrEqual(full);
        if (value >= cutoff) expect(value).toBe(full);
        else expect(full).toBeLessThan(cutoff);
        if (value !== full) earlyExits++;
      }
    }
    expect(earlyExits).toBeGreaterThan(0);
  });
});

// -----------------------------------------------------------------------
// Slab queries (fr-wa6o): both estimators take an optional `halfExtent`
// that turns the query point into the SEGMENT `p ± halfExtent`, marching a
// SLAB of half-thickness h rather than a zero-thickness hyperplane — see
// the module doc's SLAB QUERIES section. Same "conservative bound, exact
// zero set" contract as the point query, just looser; `halfExtent = null`
// (or all-zero) must reproduce the point-query path exactly.
// -----------------------------------------------------------------------

describe("slab queries: a null or all-zero half-extent matches the point-query path exactly (fr-wa6o gate-in guarantee)", () => {
  it("holds for both estimators across the validityQueries mix on pentatope", () => {
    const transforms = pentatope();
    const de = buildSurfaceDE4(transforms);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(1),
    );
    for (const q of validityQueries(cloud)) {
      const base = estimateDistance4(de, q);
      expect(estimateDistance4(de, q, null)).toBe(base);
      expect(estimateDistance4(de, q, [0, 0, 0, 0])).toBe(base);

      const refined = estimateDistance4Refined(de, q);
      expect(estimateDistance4Refined(de, q, 0, null)).toBe(refined);
      expect(estimateDistance4Refined(de, q, 0, [0, 0, 0, 0])).toBe(refined);
    }
  });

  it("holds through doubleRotation's 127-level descent, where any accumulated drift in the carried extent would show up first", () => {
    const transforms = doubleRotation();
    const de = buildSurfaceDE4(transforms);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(1),
    );
    for (const q of jitteredQueries(cloud, 30)) {
      const base = estimateDistance4(de, q);
      expect(estimateDistance4(de, q, null)).toBe(base);
      expect(estimateDistance4(de, q, [0, 0, 0, 0])).toBe(base);

      const refined = estimateDistance4Refined(de, q);
      expect(estimateDistance4Refined(de, q, 0, null)).toBe(refined);
      expect(estimateDistance4Refined(de, q, 0, [0, 0, 0, 0])).toBe(refined);
    }
  });
});

describe("slab validity: the estimate never exceeds the true distance from the segment to the attractor (fr-wa6o)", () => {
  // Thicknesses as suggested on the bead; measured (this suite): 0
  // violations for both estimators across all four systems below, over 120
  // (query, thickness) combinations each.
  it("holds for pentatope across three thicknesses", () => {
    const transforms = pentatope();
    const de = buildSurfaceDE4(transforms);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(1),
    );
    for (const h of [0.02, 0.08, 0.25]) {
      const halfExtent: Vec4 = [0, 0, 0, h];
      for (const q of jitteredQueries(cloud, 40)) {
        const truth = nearestSegmentDistance4(
          cloud.positions,
          cloud.w,
          cloud.count,
          q,
          halfExtent,
        );
        expect(estimateDistance4(de, q, halfExtent)).toBeLessThanOrEqual(
          truth + 1e-9,
        );
        expect(
          estimateDistance4Refined(de, q, 0, halfExtent),
        ).toBeLessThanOrEqual(truth + 1e-9);
      }
    }
  });

  it("holds for tesseract across three thicknesses", () => {
    const transforms = tesseract();
    const de = buildSurfaceDE4(transforms);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(1),
    );
    for (const h of [0.02, 0.08, 0.25]) {
      const halfExtent: Vec4 = [0, 0, 0, h];
      for (const q of jitteredQueries(cloud, 40)) {
        const truth = nearestSegmentDistance4(
          cloud.positions,
          cloud.w,
          cloud.count,
          q,
          halfExtent,
        );
        expect(estimateDistance4(de, q, halfExtent)).toBeLessThanOrEqual(
          truth + 1e-9,
        );
        expect(
          estimateDistance4Refined(de, q, 0, halfExtent),
        ).toBeLessThanOrEqual(truth + 1e-9);
      }
    }
  });

  it("holds for sixteenCellFlake across three thicknesses", () => {
    const transforms = sixteenCellFlake();
    const de = buildSurfaceDE4(transforms);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(1),
    );
    for (const h of [0.02, 0.08, 0.25]) {
      const halfExtent: Vec4 = [0, 0, 0, h];
      for (const q of jitteredQueries(cloud, 40)) {
        const truth = nearestSegmentDistance4(
          cloud.positions,
          cloud.w,
          cloud.count,
          q,
          halfExtent,
        );
        expect(estimateDistance4(de, q, halfExtent)).toBeLessThanOrEqual(
          truth + 1e-9,
        );
        expect(
          estimateDistance4Refined(de, q, 0, halfExtent),
        ).toBeLessThanOrEqual(truth + 1e-9);
      }
    }
  });

  it("holds for doubleRotation across three thicknesses, tolerance widened for the 127-level descent", () => {
    const transforms = doubleRotation();
    const de = buildSurfaceDE4(transforms);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(1),
    );
    for (const h of [0.02, 0.08, 0.25]) {
      const halfExtent: Vec4 = [0, 0, 0, h];
      for (const q of jitteredQueries(cloud, 40)) {
        const truth = nearestSegmentDistance4(
          cloud.positions,
          cloud.w,
          cloud.count,
          q,
          halfExtent,
        );
        expect(estimateDistance4(de, q, halfExtent)).toBeLessThanOrEqual(
          truth + 1e-6,
        );
        expect(
          estimateDistance4Refined(de, q, 0, halfExtent),
        ).toBeLessThanOrEqual(truth + 1e-6);
      }
    }
  });
});

describe("slab queries: the zero-thickness estimate misses off-slice content the slab captures (fr-wa6o)", () => {
  // Query centred 0.9h off the sample's own w, so the point query looks away
  // from it while the segment (spanning +-h in w) still reaches it exactly,
  // at the segment's own parameter s = 0.9. Measured (this suite, h = 0.08,
  // sampleCount = 60): pentatope missed the point query on 58/60 samples,
  // doubleRotation on 60/60 — comfortably over the `> half` floor asserted
  // below, which is deliberately looser than the measured numbers so the
  // test isn't brittle to unrelated changes shifting the fraction slightly.
  it("holds for pentatope", () => {
    const transforms = pentatope();
    const de = buildSurfaceDE4(transforms);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(1),
    );
    const eps = 0.005 * de.boundingRadius;
    const h = 0.08;
    const halfExtent: Vec4 = [0, 0, 0, h];
    const rng = mulberry32(99);
    const sampleCount = 60;
    let missedByPointQuery = 0;
    for (let i = 0; i < sampleCount; i++) {
      const idx = Math.floor(rng() * cloud.count);
      const a: Vec4 = [
        cloud.positions[idx * 3],
        cloud.positions[idx * 3 + 1],
        cloud.positions[idx * 3 + 2],
        cloud.w[idx],
      ];
      const p: Vec4 = [a[0], a[1], a[2], a[3] - 0.9 * h];
      expect(estimateDistance4Refined(de, p, 0, halfExtent)).toBeLessThan(eps);
      if (estimateDistance4Refined(de, p) >= eps) missedByPointQuery++;
    }
    expect(missedByPointQuery).toBeGreaterThan(sampleCount / 2);
  });

  it("holds for doubleRotation, whose depth-capped DE bottoms out slightly above 0 rather than at it", () => {
    // doubleRotation's slab reading here is a tiny POSITIVE ~2.4e-8 (the
    // DEPTH_RESOLUTION*R floor from its 127-level cap), not exactly 0 the
    // way pentatope's shallower descent reads — exactly why this test (like
    // the one above) compares against an acceptance epsilon rather than
    // asserting <= 0.
    const transforms = doubleRotation();
    const de = buildSurfaceDE4(transforms);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(1),
    );
    const eps = 0.005 * de.boundingRadius;
    const h = 0.08;
    const halfExtent: Vec4 = [0, 0, 0, h];
    const rng = mulberry32(99);
    const sampleCount = 60;
    let missedByPointQuery = 0;
    for (let i = 0; i < sampleCount; i++) {
      const idx = Math.floor(rng() * cloud.count);
      const a: Vec4 = [
        cloud.positions[idx * 3],
        cloud.positions[idx * 3 + 1],
        cloud.positions[idx * 3 + 2],
        cloud.w[idx],
      ];
      const p: Vec4 = [a[0], a[1], a[2], a[3] - 0.9 * h];
      expect(estimateDistance4Refined(de, p, 0, halfExtent)).toBeLessThan(eps);
      if (estimateDistance4Refined(de, p) >= eps) missedByPointQuery++;
    }
    expect(missedByPointQuery).toBeGreaterThan(sampleCount / 2);
  });
});

describe("estimateDistance4Refined never falls below the base estimate, with a slab (fr-wa6o)", () => {
  it("holds for pentatope across the validityQueries mix at two thicknesses", () => {
    const transforms = pentatope();
    const de = buildSurfaceDE4(transforms);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(1),
    );
    for (const h of [0.05, 0.2]) {
      const halfExtent: Vec4 = [0, 0, 0, h];
      for (const q of validityQueries(cloud)) {
        const base = estimateDistance4(de, q, halfExtent);
        const refined = estimateDistance4Refined(de, q, 0, halfExtent);
        expect(refined).toBeGreaterThanOrEqual(base - 1e-12);
      }
    }
  });
});

describe("the final-transform lens carries the half-extent through its inverse linear part (fr-wa6o)", () => {
  it("keeps slab validity on pentatope with a non-translation (rotate + scale) final transform", () => {
    const transforms = pentatope();
    const finalTransform = map4({
      position: [0.15, -0.1, 0.2],
      scale: [0.6, 0.4, 0.5],
      rotation: [0.3, -0.2, 0.5],
    });
    const de = buildSurfaceDE4(transforms, finalTransform);
    const rawCloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(1),
    );
    // The DE marches the VISIBLE (lensed) attractor F(raw attractor); ground
    // truth needs every raw sample pushed through the same forward
    // transform, so the check exercises the lens's inverse-linear-part
    // handling of the extent rather than assuming it away.
    const forward = composeAffine4(toTransform4(finalTransform));
    const visiblePositions = new Float32Array(rawCloud.count * 3);
    const visibleW = new Float32Array(rawCloud.count);
    for (let i = 0; i < rawCloud.count; i++) {
      const v = applyAffine4(
        forward,
        rawCloud.positions[i * 3],
        rawCloud.positions[i * 3 + 1],
        rawCloud.positions[i * 3 + 2],
        rawCloud.w[i],
      );
      visiblePositions[i * 3] = v[0];
      visiblePositions[i * 3 + 1] = v[1];
      visiblePositions[i * 3 + 2] = v[2];
      visibleW[i] = v[3];
    }
    const rng = mulberry32(17);
    for (const h of [0.02, 0.08, 0.25]) {
      const halfExtent: Vec4 = [0, 0, 0, h];
      for (let i = 0; i < 30; i++) {
        const idx = Math.floor(rng() * rawCloud.count);
        const q: Vec4 = [
          visiblePositions[idx * 3] + (rng() - 0.5) * 0.3,
          visiblePositions[idx * 3 + 1] + (rng() - 0.5) * 0.3,
          visiblePositions[idx * 3 + 2] + (rng() - 0.5) * 0.3,
          visibleW[idx] + (rng() - 0.5) * 0.3,
        ];
        const truth = nearestSegmentDistance4(
          visiblePositions,
          visibleW,
          rawCloud.count,
          q,
          halfExtent,
        );
        expect(estimateDistance4(de, q, halfExtent)).toBeLessThanOrEqual(
          truth + 1e-9,
        );
        expect(
          estimateDistance4Refined(de, q, 0, halfExtent),
        ).toBeLessThanOrEqual(truth + 1e-9);
      }
    }
  });
});

describe("estimateDistance4Refined early-out cutoff holds with a slab (fr-wa6o)", () => {
  it("pins both cutoff properties on pentatope with a nonzero half-extent", () => {
    const transforms = pentatope();
    const de = buildSurfaceDE4(transforms);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(1),
    );
    const halfExtent: Vec4 = [0, 0, 0, 0.08];
    const rng = mulberry32(4242);
    const probes: Vec4[] = [];
    for (let i = 0; i < 40; i++) {
      const idx = Math.floor(rng() * cloud.count);
      const jitter = [0.004, 0.05, 0.4][i % 3];
      probes.push([
        cloud.positions[idx * 3] + (rng() - 0.5) * jitter,
        cloud.positions[idx * 3 + 1] + (rng() - 0.5) * jitter,
        cloud.positions[idx * 3 + 2] + (rng() - 0.5) * jitter,
        cloud.w[idx] + (rng() - 0.5) * jitter,
      ]);
    }
    for (let i = 0; i < 20; i++) {
      probes.push([
        (rng() - 0.5) * 4,
        (rng() - 0.5) * 4,
        (rng() - 0.5) * 4,
        (rng() - 0.5) * 4,
      ]);
    }
    const cutoffs = [1e-4, 1e-2, 5e-2, 2e-1].map((f) => f * de.boundingRadius);
    let earlyExits = 0;
    for (const p of probes) {
      const full = estimateDistance4Refined(de, p, 0, halfExtent);
      for (const cutoff of cutoffs) {
        const value = estimateDistance4Refined(de, p, cutoff, halfExtent);
        expect(value).toBeGreaterThanOrEqual(full);
        if (value >= cutoff) expect(value).toBe(full);
        else expect(full).toBeLessThan(cutoff);
        if (value !== full) earlyExits++;
      }
    }
    // Pins the mechanism as live: measured 104 early exits on this probe set.
    expect(earlyExits).toBeGreaterThan(0);
  });
});

// -----------------------------------------------------------------------
// fr-u91x: the 4D kaleidoscope sector sweep — 3D's fr-x029 shape one
// dimension up. The sweep re-associates `inv(M_i) . g_k^T . q` into
// `inv(M_i) . (g_k^T . q)` and walks the sectors incrementally off ONE
// backward-step matrix, so it is the SAME candidate set in the SAME
// (sector-major, `k*n + i`) order as an explicit expansion — only the
// floating-point association differs. These tests mirror the 3D suite's
// sweep section: agreement with the expansion (which lives below as
// `expandedReference4`), the strict lower-bound direction separately, the
// slab query's rotated half-extent, and the 4D novelties a blind mirror
// would get wrong (w-planes, the twist's double rotation, and the
// origin-anchored ball where 3D projects a fitted centre).
// -----------------------------------------------------------------------
const SWEEP4_FP_TOLERANCE = 1e-9;

/** Row-major 4x4 identity — the no-kaleidoscope backward step. */
const IDENTITY_STEP4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Row-major 4x4 transpose, independent of the module under test. */
function transpose4x4(m: number[]): number[] {
  const out = new Array<number>(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) out[r * 4 + c] = m[c * 4 + r];
  }
  return out;
}

/**
 * The symmetry EXPANSION the sweep replaces, preserved here and only here as
 * the reference oracle (the 3D suite's `expandedReference`, one dimension
 * up): materialise every kaleidoscope copy `g_k . f_i` into its own composed
 * inverse slot (`inv(M_i) . g_k^T`, sector-major, copy 0 unrotated first —
 * exactly `chaos-game-4d.ts`'s `k*n + i` slot order, with `g_k` the same
 * `symmetryRotation4` matrices `prepareChaosGame4` rotates copies by) and
 * hand back a symmetry-FREE {@link SurfaceDE4}. The composed copy's `invT`
 * is the base map's exactly: `-(inv(M_i) g_k^T)(g_k t_i) = -inv(M_i) t_i`.
 */
function expandedReference4(
  de: SurfaceDE4,
  symmetry: SymmetryParams,
): SurfaceDE4 {
  const { order } = de.symmetry;
  const maps: SurfaceDE4Map[] = [];
  for (let k = 0; k < order; k++) {
    const rot = symmetryRotation4(
      symmetry.plane,
      (2 * Math.PI * k) / order,
      symmetry.twist ?? 0,
    );
    const rotT = transpose4x4(rot);
    for (const base of de.maps) {
      maps.push({
        invM: multiply4x4(base.invM, rotT),
        invT: base.invT,
        sigmaMin: base.sigmaMin,
        baseIndex: base.baseIndex,
      });
    }
  }
  return { ...de, maps, symmetry: { order: 1, stepBack: IDENTITY_STEP4 } };
}

describe("buildSurfaceDE4 with kaleidoscope symmetry (fr-u91x)", () => {
  it("keeps the maps array base-sized and carries the kaleidoscope as sector data", () => {
    const de = buildSurfaceDE4(pentatope(), null, { order: 3, plane: "xy" });
    expect(de.maps).toHaveLength(5);
    expect(de.symmetry.order).toBe(3);
  });

  it("derives the backward step by transposing the exact forward rotation the chaos game rotates copies by", () => {
    const de = buildSurfaceDE4(pentatope(), null, {
      order: 5,
      plane: "yw",
      twist: 2,
    });
    const forward = symmetryRotation4("yw", (2 * Math.PI) / 5, 2);
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        // Bit-equal, not merely close: the transpose is an element copy of
        // the same symmetryRotation4 entries, never a re-derivation.
        expect(de.symmetry.stepBack[r * 4 + c]).toBe(forward[c * 4 + r]);
      }
    }
  });

  it("reproduces the 3D kaleidoscope's backward step on a w-free plane at twist 0", () => {
    // The flat-correspondence guarantee: on the three w-free planes,
    // symmetryRotation4 reproduces chaos-game.ts's 3D symmetryRotation
    // entry for entry (PLANE_SIGN's xz flip included), so the 4D backward
    // step's upper-left 3x3 is the 3D sweep's rotation transposed, with
    // the w row/column exactly [0, 0, 0, 1].
    const de = buildSurfaceDE4(pentatope(), null, { order: 6, plane: "xz" });
    const forward3 = symmetryRotation("xz", (2 * Math.PI) / 6);
    const sb = de.symmetry.stepBack;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        expect(sb[r * 4 + c]).toBeCloseTo(forward3[c * 3 + r], 12);
      }
    }
    expect([sb[3], sb[7], sb[11], sb[12], sb[13], sb[14]]).toEqual([
      0, 0, 0, 0, 0, 0,
    ]);
    expect(sb[15]).toBe(1);
  });

  it("reports a single sector for a system built without symmetry", () => {
    const de = buildSurfaceDE4(pentatope());
    expect(de.symmetry.order).toBe(1);
  });

  it("clamps the effective order against the transform-count budget exactly as prepareChaosGame4 does", () => {
    // 5 base maps against the 256-slot Uint8 cap: floor(256 / 5) = 51
    // sectors at most, however large the ask.
    const de = buildSurfaceDE4(pentatope(), null, { order: 999, plane: "zw" });
    expect(de.symmetry.order).toBe(51);
  });
});

describe("sector sweep agreement with the symmetry expansion (fr-u91x)", () => {
  it("reproduces the expansion's estimate for an order-3 xy kaleidoscope — a w-free plane at twist 0", () => {
    const symmetry: SymmetryParams = { order: 3, plane: "xy" };
    const de = buildSurfaceDE4(pentatope(), null, symmetry);
    const reference = expandedReference4(de, symmetry);
    expect(de.maps).toHaveLength(5);
    expect(reference.maps).toHaveLength(15);
    const rng = mulberry32(1234);
    for (let i = 0; i < 120; i++) {
      const p: Vec4 = [
        (rng() - 0.5) * 3,
        (rng() - 0.5) * 3,
        (rng() - 0.5) * 3,
        (rng() - 0.5) * 3,
      ];
      expect(estimateDistance4Refined(de, p)).toBeCloseTo(
        estimateDistance4Refined(reference, p),
        9,
      );
    }
  });

  it("reproduces the expansion's estimate for an order-4 zw kaleidoscope — a w-plane", () => {
    const symmetry: SymmetryParams = { order: 4, plane: "zw" };
    const de = buildSurfaceDE4(pentatope(), null, symmetry);
    const reference = expandedReference4(de, symmetry);
    const rng = mulberry32(99);
    for (let i = 0; i < 120; i++) {
      const p: Vec4 = [
        (rng() - 0.5) * 3,
        (rng() - 0.5) * 3,
        (rng() - 0.5) * 3,
        (rng() - 0.5) * 3,
      ];
      expect(estimateDistance4Refined(de, p)).toBeCloseTo(
        estimateDistance4Refined(reference, p),
        9,
      );
    }
  });

  it("reproduces the expansion's estimate for an order-5 xy double rotation (twist 1) — the 4D novelty", () => {
    const symmetry: SymmetryParams = { order: 5, plane: "xy", twist: 1 };
    const de = buildSurfaceDE4(pentatope(), null, symmetry);
    const reference = expandedReference4(de, symmetry);
    expect(reference.maps).toHaveLength(25);
    const rng = mulberry32(2024);
    for (let i = 0; i < 100; i++) {
      const p: Vec4 = [
        (rng() - 0.5) * 3,
        (rng() - 0.5) * 3,
        (rng() - 0.5) * 3,
        (rng() - 0.5) * 3,
      ];
      expect(estimateDistance4Refined(de, p)).toBeCloseTo(
        estimateDistance4Refined(reference, p),
        9,
      );
    }
  });

  it("keeps the width-1 greedy descent on the expansion's numbers too", () => {
    // The legacy estimator shares the descent body, so it sweeps sectors on
    // exactly the same code path — pinned separately because its single
    // chain reaches different branches than the production beam does.
    const symmetry: SymmetryParams = { order: 5, plane: "xw" };
    const de = buildSurfaceDE4(pentatope(), null, symmetry);
    const narrow = { ...de, beamWidth: 1 } as const;
    const reference = {
      ...expandedReference4(de, symmetry),
      beamWidth: 1,
    } as const;
    const rng = mulberry32(555);
    for (let i = 0; i < 100; i++) {
      const p: Vec4 = [
        (rng() - 0.5) * 4,
        (rng() - 0.5) * 4,
        (rng() - 0.5) * 4,
        (rng() - 0.5) * 4,
      ];
      expect(estimateDistance4(narrow, p)).toBeCloseTo(
        estimateDistance4(reference, p),
        9,
      );
    }
  });

  it("never over-estimates the expansion's bound in any supported plane or twist", () => {
    // The direction that matters: an estimate ABOVE the reference's is a
    // march that steps through a surface. Asserted one-sided across every
    // plane, twists included, on both estimators.
    const table: SymmetryParams[] = [
      { order: 2, plane: "xy" },
      { order: 3, plane: "xz", twist: 1 },
      { order: 4, plane: "yz" },
      { order: 3, plane: "xw" },
      { order: 5, plane: "yw", twist: 2 },
      { order: 6, plane: "zw", twist: 1 },
    ];
    for (const symmetry of table) {
      const de = buildSurfaceDE4(pentatope(), null, symmetry);
      const reference = expandedReference4(de, symmetry);
      const rng = mulberry32(17);
      for (let i = 0; i < 60; i++) {
        const p: Vec4 = [
          (rng() - 0.5) * 3,
          (rng() - 0.5) * 3,
          (rng() - 0.5) * 3,
          (rng() - 0.5) * 3,
        ];
        expect(estimateDistance4Refined(de, p)).toBeLessThanOrEqual(
          estimateDistance4Refined(reference, p) + SWEEP4_FP_TOLERANCE,
        );
        expect(estimateDistance4(de, p)).toBeLessThanOrEqual(
          estimateDistance4(reference, p) + SWEEP4_FP_TOLERANCE,
        );
      }
    }
  });

  it("sweeps every sector at any blend, exactly as the expansion included every copy", () => {
    // SymmetryParams.blend fades the rotated copies' SELECTION WEIGHTS, not
    // their geometry — a DE built at blend 0 still describes the full
    // kaleidoscope, not the bare base system (the 3D module doc's BLEND
    // rule, dimension-free).
    for (const blend of [0, 0.35, 1]) {
      const symmetry: SymmetryParams = { order: 4, plane: "zw", blend };
      const de = buildSurfaceDE4(pentatope(), null, symmetry);
      expect(de.symmetry.order).toBe(4);
      const reference = expandedReference4(de, symmetry);
      const rng = mulberry32(1010);
      for (let i = 0; i < 40; i++) {
        const p: Vec4 = [
          (rng() - 0.5) * 3,
          (rng() - 0.5) * 3,
          (rng() - 0.5) * 3,
          (rng() - 0.5) * 3,
        ];
        expect(estimateDistance4Refined(de, p)).toBeCloseTo(
          estimateDistance4Refined(reference, p),
          9,
        );
      }
    }
  });
});

describe("estimateDistance4 with kaleidoscope symmetry (fr-u91x)", () => {
  it("reads near zero for points sampled on the symmetric attractor, rotated copies included", () => {
    // An xw kaleidoscope turns base structure INTO w, so these samples
    // cover copies a 3D sweep could never produce; the true-ancestor-branch
    // argument (a point ON the attractor can never earn a positive bound)
    // holds for the swept candidate set exactly as for the expanded one.
    const transforms = pentatope();
    const symmetry: SymmetryParams = { order: 3, plane: "xw" };
    const de = buildSurfaceDE4(transforms, null, symmetry);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(42),
      null,
      symmetry,
    );
    for (let i = 0; i < 200; i++) {
      const idx = (i * 61) % cloud.count;
      const p: Vec4 = [
        cloud.positions[idx * 3],
        cloud.positions[idx * 3 + 1],
        cloud.positions[idx * 3 + 2],
        cloud.w[idx],
      ];
      expect(estimateDistance4Refined(de, p)).toBeLessThanOrEqual(0.08);
    }
  });

  it("stays conservative against the sampled symmetric attractor for off-attractor queries on a w-plane kaleidoscope", () => {
    // Strict fp tolerance holds here (measured, this suite): pentatope's
    // zw-rotated copies separate cleanly, so the fr-jkpn >= 5-simultaneous
    // in-sphere drops that loosen dense kaleidoscopes never fire on this
    // probe set — contrast the off-origin twisted suite at the end of this
    // file, which needs (and documents) the disclosed residual band.
    const transforms = pentatope();
    const symmetry: SymmetryParams = { order: 4, plane: "zw" };
    const de = buildSurfaceDE4(transforms, null, symmetry);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(1),
      null,
      symmetry,
    );
    for (const q of validityQueries(cloud)) {
      const truth = nearestDistance4(cloud, q);
      expect(estimateDistance4(de, q)).toBeLessThanOrEqual(truth + 1e-9);
      expect(estimateDistance4Refined(de, q)).toBeLessThanOrEqual(truth + 1e-9);
    }
  });
});

describe("kaleidoscope order 1 is the identity (fr-u91x)", () => {
  it("returns bit-identical estimates to a build without symmetry, for any plane and twist", () => {
    const transforms = pentatope();
    const plain = buildSurfaceDE4(transforms);
    const identities: SymmetryParams[] = [
      { order: 1, plane: "xy" },
      { order: 1, plane: "zw", twist: 1 },
    ];
    for (const symmetry of identities) {
      const de = buildSurfaceDE4(transforms, null, symmetry);
      // The probe is byte-identical at order 1 (prepareChaosGame4's order-1
      // expansion is a no-op), so the whole build matches, radius included.
      expect(de.boundingRadius).toBe(plain.boundingRadius);
      const rng = mulberry32(11);
      for (let i = 0; i < 60; i++) {
        const p: Vec4 = [
          (rng() - 0.5) * 4,
          (rng() - 0.5) * 4,
          (rng() - 0.5) * 4,
          (rng() - 0.5) * 4,
        ];
        expect(estimateDistance4(de, p)).toBe(estimateDistance4(plain, p));
        expect(estimateDistance4Refined(de, p)).toBe(
          estimateDistance4Refined(plain, p),
        );
      }
    }
  });
});

describe("slab queries rotate the carried half-extent through the sectors (fr-u91x x fr-wa6o)", () => {
  it("matches the expansion with a nonzero half-extent on a w-plane kaleidoscope", () => {
    // The expansion's composed inverse rotates the extent through its own
    // matrix product, so this equality pins the sweep's per-sector extent
    // rotation — an unrotated extent would march the wrong segment in
    // every k > 0 sector and break it.
    const symmetry: SymmetryParams = { order: 4, plane: "xw" };
    const de = buildSurfaceDE4(pentatope(), null, symmetry);
    const reference = expandedReference4(de, symmetry);
    const halfExtent: Vec4 = [0, 0, 0, 0.08];
    const rng = mulberry32(88);
    for (let i = 0; i < 80; i++) {
      const p: Vec4 = [
        (rng() - 0.5) * 3,
        (rng() - 0.5) * 3,
        (rng() - 0.5) * 3,
        (rng() - 0.5) * 3,
      ];
      expect(estimateDistance4Refined(de, p, 0, halfExtent)).toBeCloseTo(
        estimateDistance4Refined(reference, p, 0, halfExtent),
        9,
      );
      expect(estimateDistance4(de, p, halfExtent)).toBeCloseTo(
        estimateDistance4(reference, p, halfExtent),
        9,
      );
    }
  });

  it("matches the expansion with a nonzero half-extent under a double rotation (twist 1)", () => {
    const symmetry: SymmetryParams = { order: 3, plane: "yz", twist: 1 };
    const de = buildSurfaceDE4(pentatope(), null, symmetry);
    const reference = expandedReference4(de, symmetry);
    const halfExtent: Vec4 = [0, 0, 0, 0.08];
    const rng = mulberry32(313);
    for (let i = 0; i < 80; i++) {
      const p: Vec4 = [
        (rng() - 0.5) * 3,
        (rng() - 0.5) * 3,
        (rng() - 0.5) * 3,
        (rng() - 0.5) * 3,
      ];
      expect(estimateDistance4Refined(de, p, 0, halfExtent)).toBeCloseTo(
        estimateDistance4Refined(reference, p, 0, halfExtent),
        9,
      );
      expect(estimateDistance4(de, p, halfExtent)).toBeCloseTo(
        estimateDistance4(reference, p, halfExtent),
        9,
      );
    }
  });

  it("sees a rotated copy that only the slab's rotated segment can reach", () => {
    // FLAT base maps (their own attractor pins to w = 0) under an xw
    // kaleidoscope: any sample with |w| clearly off zero sits on a ROTATED
    // copy. A slab query centred 0.9h short of such a sample in w reaches
    // it only through the carried segment, which the descent must turn
    // through the sectors along with the point (design point D); the point
    // query at the same centre misses the copy for most samples, which is
    // what makes the segment's reach observable. Scale 0.4 keeps the
    // 8-copy attractor sparse enough for that contrast (measured, this
    // suite: slab reads under eps on 40/40 samples while the point query
    // misses 31/40 — scale-0.5 maps left it a near-space-filling dust the
    // point query found other content in, 9/40).
    const flat = [
      map4({ position: [0.6, 0.2, -0.1], scale: [0.4, 0.4, 0.4] }),
      map4({ id: 1, position: [-0.4, 0.35, 0.3], scale: [0.4, 0.4, 0.4] }),
    ];
    const symmetry: SymmetryParams = { order: 4, plane: "xw" };
    const de = buildSurfaceDE4(flat, null, symmetry);
    const cloud = runChaosGame4(
      flat.map(toTransform4),
      20000,
      mulberry32(1),
      null,
      symmetry,
    );
    const eps = 0.005 * de.boundingRadius;
    const h = 0.12;
    const halfExtent: Vec4 = [0, 0, 0, h];
    let checked = 0;
    let missedByPointQuery = 0;
    for (let i = 0; i < cloud.count && checked < 40; i++) {
      if (Math.abs(cloud.w[i]) < 0.25) continue;
      const p: Vec4 = [
        cloud.positions[i * 3],
        cloud.positions[i * 3 + 1],
        cloud.positions[i * 3 + 2],
        cloud.w[i] - 0.9 * h,
      ];
      expect(estimateDistance4Refined(de, p, 0, halfExtent)).toBeLessThan(eps);
      if (estimateDistance4Refined(de, p) >= eps) missedByPointQuery++;
      checked++;
    }
    expect(checked).toBe(40);
    expect(missedByPointQuery).toBeGreaterThan(checked / 2);
  });
});

describe("symmetry never affects surface eligibility (fr-u91x)", () => {
  it("keeps the bare system's verdict and step scale, and cannot rescue an ineligible one", () => {
    // analyzeSurfaceSystem4 takes no symmetry at all — mirrored from 3D's
    // stance (copies are rotations of maps already analyzed, twist
    // included) — so the build's derived analysis quantities match the
    // bare system's under any kaleidoscope, and an ineligible system
    // stays ineligible under one.
    const anisotropic = [map4({ scale: [0.8, 0.4, 0.4] })];
    const bare = analyzeSurfaceSystem4(anisotropic);
    expect(bare.status).toBe("degraded");
    const symmetry: SymmetryParams = { order: 6, plane: "yw", twist: 1 };
    const de = buildSurfaceDE4(anisotropic, null, symmetry);
    expect(de.stepScale).toBe(bare.stepScale);
    const ineligible = [map4({ variations: [{ type: "swirl", weight: 1 }] })];
    expect(() => buildSurfaceDE4(ineligible, null, symmetry)).toThrow(
      /no surface distance estimator/,
    );
  });
});

describe("twisted symmetry on an off-origin attractor stays conservative (fr-u91x's fixed-subspace two-case)", () => {
  // The one place a blind 3D mirror would go wrong: 3D recentres its
  // probe-fit ball by zeroing the two IN-PLANE coordinates (projection onto
  // the rotation axis, the group-fixed subspace). Under a twist the
  // generator fixes ONLY the origin — both angles are nonzero multiples of
  // 2π/order inside (0, 2π) — so that same projection would leave a
  // NON-invariant centre and an unsound certificate. The 4D ball is
  // origin-anchored (surface-de-4d.ts never adopted the centred fit), which
  // every generator fixes; these tests make that observable by driving the
  // base attractor far off-origin inside the twist plane, where an invalid
  // recentred bound would overshoot near the rotated copies.
  const offOrigin = () => [
    map4({ position: [0.5, 0.35, 0.2], rotation: [0.4, 0.2, -0.3] }),
    map4({ id: 1, position: [0.65, 0.15, -0.1], rotation: [-0.2, 0.5, 0.1] }),
    map4({ id: 2, position: [0.45, 0.5, 0.05], rotation: [0.1, -0.3, 0.6] }),
  ];

  it("never exceeds the sampled distance under a twist-1 kaleidoscope whose base attractor sits far off-origin, within the disclosed kaleidoscope residual", () => {
    // Tolerance is the fr-jkpn KALEIDOSCOPE residual band, not fp noise:
    // orders >= 3 multiply every branch, so the >= 5 simultaneous
    // in-sphere drops that break strict beam validity get common (the 3D
    // module doc discloses ~2.6%R for fast-map kaleidoscopes). Measured on
    // THIS system (probe-overshoot harness, 520 queries): 3 overshoots,
    // worst 1.66%R, and the sweep matches the EXPANSION to 6.1e-16 at
    // every one of them — the residual is the beam's, present under the
    // old expansion too, not the sweep's or the origin-anchored ball's. A
    // wrongly recentred ball (the complement-plane projection a blind 3D
    // mirror would apply, invalid under a twist) would overshoot by the
    // centre offset's scale — tens of %R — so the 3%R band still
    // discriminates exactly the failure this test exists to catch.
    const transforms = offOrigin();
    const symmetry: SymmetryParams = { order: 3, plane: "xy", twist: 1 };
    const de = buildSurfaceDE4(transforms, null, symmetry);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(1),
      null,
      symmetry,
    );
    const residual = 0.03 * de.boundingRadius;
    for (const q of validityQueries(cloud)) {
      const truth = nearestDistance4(cloud, q);
      expect(estimateDistance4(de, q)).toBeLessThanOrEqual(truth + residual);
      expect(estimateDistance4Refined(de, q)).toBeLessThanOrEqual(
        truth + residual,
      );
    }
  });

  it("matches the expansion on that same off-origin twisted system", () => {
    const transforms = offOrigin();
    const symmetry: SymmetryParams = { order: 3, plane: "xy", twist: 1 };
    const de = buildSurfaceDE4(transforms, null, symmetry);
    const reference = expandedReference4(de, symmetry);
    const rng = mulberry32(747);
    for (let i = 0; i < 80; i++) {
      const p: Vec4 = [
        (rng() - 0.5) * 4,
        (rng() - 0.5) * 4,
        (rng() - 0.5) * 4,
        (rng() - 0.5) * 4,
      ];
      expect(estimateDistance4Refined(de, p)).toBeCloseTo(
        estimateDistance4Refined(reference, p),
        9,
      );
    }
  });
});
