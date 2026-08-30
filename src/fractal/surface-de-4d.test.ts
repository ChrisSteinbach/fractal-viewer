import {
  analyzeSurfaceSystem4,
  buildSurfaceDE4,
  deHasFolds4,
  estimateDistance4,
  estimateDistance4Refined,
  foldBranchCount4,
  radiusBandInvRange,
  setFoldFrontierTap4,
  singularValues4,
  slabExact4,
  surfaceNativeCarriers4,
  transformSigmas4,
} from "./surface-de-4d";
import type {
  FoldFrontierCandidate4,
  SurfaceDE4,
  SurfaceDE4Map,
} from "./surface-de-4d";
import {
  DEPTH_RESOLUTION,
  MAX_DESCENT_DEPTH,
  NEAR_ZERO_FOLD_WEIGHT,
  singularValues3,
  SPHEREFOLD_LIPSCHITZ,
  SURFACE_FOLD_BEAM_WIDTH,
  SURFACE_FOLD_BOXFOLD,
  SURFACE_FOLD_MANDELBOX,
  SURFACE_FOLD_NONE,
  SURFACE_FOLD_SPHEREFOLD,
} from "./surface-de";
import { composeAffine } from "./affine";
import {
  BOX_FOLD_LIMIT,
  SPHERE_FOLD_FIXED_RADIUS,
  SPHERE_FOLD_MIN_RADIUS,
} from "./variations";
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
  mandelboxKifs,
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
 * lower-bound property. Takes raw parallel arrays rather than a
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

// -----------------------------------------------------------------------
// Pure-fold base maps and pure-fold FINAL lenses, one dimension up
// from `surface-de.test.ts`'s own fold fixtures. Each pure-fold
// fixture below carries a live `w` block (position plus one w-mixing
// rotation plane) so the fold genuinely acts on all four axes rather than
// merely riding along at w = 0 — the 4D point of this port.
// -----------------------------------------------------------------------

/** Two-map pure-boxfold 4D system: both maps carry exactly one active
 * boxfold variation and nothing else — isometric branches only (sigma_c = 1
 * on every one of the 81) — mirroring 3D's `pureBoxfoldPair`
 * (surface-de.test.ts) with a live w block spliced onto each map. */
function pureBoxfoldPair4(): Transform[] {
  return [
    map4({
      position: [0.4, 0.1, 0],
      rotation: [0.3, 0.2, 0],
      scale: [0.45, 0.45, 0.45],
      w: { position: 0.3, rotation: { xw: 0.3 } },
      variations: [{ type: "boxfold", weight: 1 }],
    }),
    map4({
      id: 1,
      position: [-0.35, -0.2, 0.3],
      rotation: [0, 0.5, 0.1],
      scale: [0.5, 0.5, 0.5],
      w: { position: -0.3, rotation: { xw: 0.3 } },
      variations: [{ type: "boxfold", weight: 0.9 }],
    }),
  ];
}

/** Two-map pure-mandelbox 4D system — the widest fold class (243 branches
 * per map). Branch competitiveness (how many candidates stay in play before
 * one clearly escapes) turns out to track `foldInvW = 1/w`, not scale: a
 * smaller |w| (this file's first attempt used ~0.55/0.5, matched to 3D's
 * exact weight/scale rescaled) spreads u-space out and lets branches escape
 * too cleanly, so the width-12 frontier never actually saturates (measured
 * empirically — see the frontier-replay test below, which needs
 * genuine saturation to exercise the replacement path). Weight 1.3/1.2 (a
 * notch past 3D's 1.1/0.9) against a small scale restores saturation
 * (measured: candidate counts up to ~18 at some level) while a small SCALE
 * keeps the composite Lipschitz bound `|w| * 4 * sigma_max` (measured here:
 * ~0.62) comfortably under CONTRACTION_LIMIT and maxDepth shallow (~20) —
 * the 243-branch frontier is CPU-heavy, so depth stays well short of the
 * eligibility boundary the way `doubleRotation` sits for the plain affine
 * ladder. */
function pureMandelboxPair4(): Transform[] {
  return [
    map4({
      position: [0.3, -0.15, 0.1],
      rotation: [0.2, 0.4, 0],
      scale: [0.12, 0.12, 0.12],
      w: { position: 0.15, rotation: { xw: 0.25 } },
      variations: [{ type: "mandelbox", weight: 1.3 }],
    }),
    map4({
      id: 1,
      position: [-0.25, 0.2, -0.2],
      rotation: [0.1, 0, 0.3],
      scale: [0.13, 0.13, 0.13],
      w: { position: -0.15, rotation: { xw: 0.25 } },
      variations: [{ type: "mandelbox", weight: 1.2 }],
    }),
  ];
}

/** Two-map pure-spherefold 4D system — the query-dependent mid-branch sigma
 * case, folded through all four axes (`variations4.ts`'s spherefold reads
 * `x*x + y*y + z*z + w*w`). Mirrors 3D's inline spherefold-guard fixture
 * (surface-de.test.ts) with a live w block. */
function pureSpherefoldPair4(): Transform[] {
  return [
    map4({
      scale: [0.2, 0.2, 0.2],
      w: { position: 0.2, rotation: { yw: 0.2 } },
      variations: [{ type: "spherefold", weight: 1 }],
    }),
    map4({
      id: 1,
      position: [-0.1, 0.1, -0.05],
      scale: [0.22, 0.22, 0.22],
      w: { position: -0.2, rotation: { yw: 0.2 } },
      variations: [{ type: "spherefold", weight: 0.9 }],
    }),
  ];
}

/** A boxfold FINAL lens over an affine 4D base — the fold-lens
 * archetype one dimension up, mirroring 3D's `boxfoldFinal`
 * (surface-de.test.ts). The SMALL weight matters: `u = p/w` reaches past
 * the fold planes, so the non-identity branches carry real geometry rather
 * than the lens degenerating to its affine part alone. Live w block: the
 * lens itself has a genuine 4D pose. */
function boxfoldFinal4(): Transform {
  return map4({
    id: 99,
    position: [0.15, -0.1, 0.05],
    rotation: [0.2, 0.3, 0.1],
    scale: [0.9, 0.9, 0.9],
    w: { position: 0.1, rotation: { yw: 0.2 } },
    variations: [{ type: "boxfold", weight: 0.55 }],
  });
}

/** A mandelbox FINAL lens (243 branches — the region-floor stress case),
 * mirroring 3D's inline mandelbox-lens fixture (surface-de.test.ts). */
function mandelboxFinal4(): Transform {
  return map4({
    id: 99,
    position: [0.05, 0.1, 0],
    rotation: [0.3, 0, 0.2],
    scale: [0.85, 0.85, 0.85],
    variations: [{ type: "mandelbox", weight: 0.6 }],
  });
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

  it("classifies the 24-map twentyFourCellFlake as eligible — the map count the tracer's raised cap admits", () => {
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
    expect(de.slowestSigma).toBeCloseTo(0.5, 12);
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

describe("SurfaceDE4 native-pattern calibration", () => {
  function expectFiniteUnitCarriers(
    carriers: ReturnType<typeof surfaceNativeCarriers4>,
  ): void {
    expect(Number.isFinite(carriers.rings)).toBe(true);
    expect(Number.isFinite(carriers.sheets)).toBe(true);
    expect(carriers.rings).toBeGreaterThanOrEqual(0);
    expect(carriers.rings).toBeLessThanOrEqual(1);
    expect(carriers.sheets).toBeGreaterThanOrEqual(0);
    expect(carriers.sheets).toBeLessThanOrEqual(1);
  }

  function expectFiniteCalibration(de: SurfaceDE4): void {
    const calibration = de.patternCalibration;
    expect(Number.isFinite(calibration.ringsLow)).toBe(true);
    expect(Number.isFinite(calibration.ringsInvSpan)).toBe(true);
    expect(Number.isFinite(calibration.sheetsLow)).toBe(true);
    expect(Number.isFinite(calibration.sheetsInvSpan)).toBe(true);
    expect(calibration.ringsLow).toBeGreaterThanOrEqual(0);
    expect(calibration.ringsLow).toBeLessThanOrEqual(1);
    expect(calibration.sheetsLow).toBeGreaterThanOrEqual(0);
    expect(calibration.sheetsLow).toBeLessThanOrEqual(1);
    expect(calibration.ringsInvSpan).toBeGreaterThanOrEqual(0);
    expect(calibration.sheetsInvSpan).toBeGreaterThanOrEqual(0);
  }

  it("produces finite affine4 and fold4 carriers plus compact calibration", () => {
    const affine = buildSurfaceDE4(pentatope());
    const fold = buildSurfaceDE4(pureBoxfoldPair4());

    expectFiniteUnitCarriers(
      surfaceNativeCarriers4(affine, [0.1, -0.2, 0.3, 0.4]),
    );
    expectFiniteUnitCarriers(
      surfaceNativeCarriers4(fold, [-0.25, 0.15, 0.35, -0.45]),
    );
    expectFiniteCalibration(affine);
    expectFiniteCalibration(fold);
  });

  it("is exactly repeatable for the same seeded raw probe", () => {
    const transforms = pentatope();
    const first = buildSurfaceDE4(transforms);
    const second = buildSurfaceDE4(transforms);

    expect(second.patternCalibration).toEqual(first.patternCalibration);
  });

  it("is invariant across affine and fold final lenses", () => {
    const transforms = pentatope();
    const raw = buildSurfaceDE4(transforms);
    const affineFinal = buildSurfaceDE4(
      transforms,
      map4({
        id: 98,
        position: [1.5, -0.7, 0.4],
        rotation: [0.2, -0.3, 0.4],
        scale: [0.8, 0.9, 0.7],
        w: { position: 0.6, scale: 0.85, rotation: { xw: 0.35 } },
      }),
    );
    const foldFinal = buildSurfaceDE4(transforms, boxfoldFinal4());

    expect(affineFinal.patternCalibration).toEqual(raw.patternCalibration);
    expect(foldFinal.patternCalibration).toEqual(raw.patternCalibration);
  });

  it("is repeatable and lens-invariant for a fold4 base", () => {
    const transforms = pureBoxfoldPair4();
    const raw = buildSurfaceDE4(transforms);
    const repeated = buildSurfaceDE4(transforms);
    const affineFinal = buildSurfaceDE4(
      transforms,
      map4({
        id: 97,
        position: [-0.8, 0.6, 0.2],
        rotation: [-0.2, 0.3, 0.1],
        scale: [0.75, 0.85, 0.8],
        w: { position: -0.4, scale: 0.9, rotation: { yw: 0.25 } },
      }),
    );
    const foldFinal = buildSurfaceDE4(transforms, boxfoldFinal4());

    expect(repeated.patternCalibration).toEqual(raw.patternCalibration);
    expect(affineFinal.patternCalibration).toEqual(raw.patternCalibration);
    expect(foldFinal.patternCalibration).toEqual(raw.patternCalibration);
  });

  // A fixed wall-clock threshold is deliberately not enforceable here: the
  // widest build measures ~0.55-0.62 s CPU in isolation but ~1.7-2.0 s under
  // the 120-file parallel suite, and scheduler preemption plus memory-latency
  // and main-thread IPC-flush bursts inflate single measurement windows
  // unpredictably. The gate therefore samples min-of-3 widest and min-of-2
  // reference CPU windows (the min rejects any burst-hit window) and compares
  // them as a work ratio: the reference shares the widest build's fold
  // families at half scale and its memory-latency behaviour, so steady
  // contention inflates both windows together and cancels out of the ratio,
  // while a fold-path compute regression hits the widest build but not the
  // reference. The ratio measured 2.08-2.32 across quiet, noisy, and
  // full-suite runs; the normalized budget reading stayed 0.62-0.70 s across
  // all of them. GitHub still runs the suite under coverage and CPU
  // contention (measured 4.1 s for a 0.55-0.66 s cold local build), so the
  // whole gate stays skipped on CI.
  it.skipIf(process.env.CI === "true")(
    "keeps a widest-supported 4D fold pilot within the session-entry budget",
    // The five sampled builds take ~7-11 s wall under full-suite load, so the
    // default 5 s vitest timeout is far too short for the sampling protocol.
    { timeout: 30_000 },
    () => {
      const lift = (transform: Transform, index: number): Transform => ({
        ...transform,
        w: {
          position: ((index % 3) - 1) * 0.05,
          scale: transform.scale[0],
          rotation: { xw: 0.1 },
        },
      });
      const widestTransforms = mandelboxKifs().map(lift);
      // Reference: four mandelbox + two boxfold maps — the same fold families
      // at half scale, sharing the 8,192-point extent probe and native
      // calibration, so the work ratio is a pure property of the code.
      const referenceTransforms = mandelboxKifs()
        .slice(0, 4)
        .concat(mandelboxKifs().slice(8, 10))
        .map(lift);

      const cpuMs = (cpu: { user: number; system: number }): number =>
        (cpu.user + cpu.system) / 1000;
      const widestSamples = [0, 1, 2].map(() => {
        const start = process.cpuUsage();
        const de = buildSurfaceDE4(widestTransforms);
        return { de, cpuMs: cpuMs(process.cpuUsage(start)) };
      });
      const referenceSamples = [0, 1].map(() => {
        const start = process.cpuUsage();
        const de = buildSurfaceDE4(referenceTransforms);
        return { de, cpuMs: cpuMs(process.cpuUsage(start)) };
      });
      const widestCpuMs = Math.min(...widestSamples.map((s) => s.cpuMs));
      const refCpuMs = Math.min(...referenceSamples.map((s) => s.cpuMs));
      // The builds are seeded and deterministic, so any sample serves the
      // functional checks.
      const widest = widestSamples[0].de;
      const reference = referenceSamples[0].de;

      expect(widest.maps).toHaveLength(12);
      expect(widest.maxDepth).toBeGreaterThanOrEqual(100);
      expectFiniteCalibration(widest);
      expect(reference.maps).toHaveLength(6);

      // Work-share gate: the widest build must stay within a bounded factor
      // of the reference's work. The ratio measured 2.08-2.32 in quiet,
      // noisy, and full-suite-loaded runs, so the 2.7 bound carries ~16%
      // headroom and trips on any fold-path regression of ~1.2x or more —
      // the supported 243-branch, 12-map, depth-100 corner that simpler
      // affine fixtures miss.
      expect(widestCpuMs / refCpuMs).toBeLessThan(2.7);

      // Production budget, as uncontended-equivalent work: the reference
      // measures ~0.26-0.30 s CPU on the development host, so normalizing the
      // widest window by the reference's own rate cancels steady contention.
      // The 2.5 s ceiling then guards the session-entry budget itself — it
      // still includes the 8,192-point extent probe and native calibration.
      const referenceBaselineMs = 300;
      expect(widestCpuMs * (referenceBaselineMs / refCpuMs)).toBeLessThan(
        2_500,
      );
    },
  );
});

describe("SurfaceDE4.radiusBand", () => {
  it("carries a sane band on pentatope: 0 <= minD < maxD, a finite center, and maxD within a loose sanity ceiling", () => {
    const de = buildSurfaceDE4(pentatope());
    const { center, minD, maxD } = de.radiusBand;
    expect(minD).toBeGreaterThanOrEqual(0);
    expect(minD).toBeLessThan(maxD);
    for (const c of center) expect(Number.isFinite(c)).toBe(true);
    // Loose sanity ceiling: no probe point can sit more than a diameter past
    // the (padded) bounding sphere from any center inside it.
    expect(maxD).toBeLessThanOrEqual(de.boundingRadius * 2 + 1);
  });

  it("is deterministic: two builds of the same system return byte-identical bands (the probe is seeded)", () => {
    const transforms = pentatope();
    const de1 = buildSurfaceDE4(transforms);
    const de2 = buildSurfaceDE4(transforms);
    expect(de2.radiusBand.center).toEqual(de1.radiusBand.center);
    expect(de2.radiusBand.minD).toBe(de1.radiusBand.minD);
    expect(de2.radiusBand.maxD).toBe(de1.radiusBand.maxD);
  });

  it("moves the band to the visible set: a large pure-translation final transform shifts the center by roughly the translation", () => {
    const transforms = pentatope();
    const noFinal = buildSurfaceDE4(transforms);
    // Identity rotation/scale, translation alone — large relative to
    // pentatope's ~1-radius attractor, so the shift is unmistakable.
    const finalTransform = map4({ position: [5, 0, 0], scale: [1, 1, 1] });
    const withFinal = buildSurfaceDE4(transforms, finalTransform);
    // The no-final center sits near the raw attractor's own origin-region
    // extent (pentatope's bounding radius is ~1), anchoring the shift below
    // as meaningful rather than vacuous.
    expect(Math.abs(noFinal.radiusBand.center[0])).toBeLessThan(1);
    expect(
      withFinal.radiusBand.center[0] - noFinal.radiusBand.center[0],
    ).toBeCloseTo(5, 0);
  });
});

describe("radiusBandInvRange", () => {
  it("returns 1/(maxD - minD) for a normal band", () => {
    const band: SurfaceDE4["radiusBand"] = {
      center: [0, 0, 0, 0],
      minD: 0.5,
      maxD: 2.5,
    };
    expect(radiusBandInvRange(band)).toBe(0.5);
  });

  it("returns 1 for a degenerate band (minD === maxD)", () => {
    const band: SurfaceDE4["radiusBand"] = {
      center: [0, 0, 0, 0],
      minD: 1,
      maxD: 1,
    };
    expect(radiusBandInvRange(band)).toBe(1);
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
    // it was raised to (the old 48 ceiling clamped this preset and
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

  it("holds under the width-2 beam: no query in jitteredQueries(cloud, 20) exceeds the cloud-distance bound", () => {
    // doubleRotation has only two maps, weight 6:1, sigma 0.93 vs 0.22 (see
    // its preset doc) — a system this far from evenly-weighted/conformal is
    // exactly the profile the width-2 descent beam was built to repair
    // (see the module doc's THAT EXCLUSION'S RESOLUTION section): a second
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
    // confirmed during the 4D spike's development to be INHERITED from 3D
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
// estimateDistance4Refined (the spike verdict — see the module doc's
// SPIKE VERDICT section): the certificate-refinement variant that measurably
// eliminates the slice-march ghosting section (e) traced to the sibling-
// certificate term. The doubleRotation-profile greedy branch-selection gap
// the spike also measured is a SEPARATE mechanism refinement never touches on
// its own (still reproducible by forcing beamWidth: 1, see the tests below);
// the width-2 descent beam is what closes it in the built DE — see the
// module doc's THAT EXCLUSION'S RESOLUTION section.
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
// Rank-3/4 validity slots (widths 3/4) — the 4D mirror of
// `surface-de.test.ts`'s "validity slots on the sigma-0.96
// slow-map profile" describe block; see that file for the mechanism (a
// second insert-shift ladder holds each level's rank-3/4 candidates, which
// continue as extra chains ONLY while in-sphere). Same 2-map profile as the
// 3D test (sigma 0.96/0.22, weight 6:1) — one notch faster than this
// module's own `doubleRotation` preset (sigma 0.93/0.22), the notch where
// the 3D harness measured width 2 retaining a residual.
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
    // MAX_DESCENT_DEPTH ceiling) is the dropped-branch overshoot
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

  it("overshoots some of those exact queries when forced back to beamWidth 2 — the drop the validity slots repair", () => {
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
    // Pinned from the spike's (g2) run (`surface-de-4d.spike.test.ts`,
    // seeds: main cloud mulberry32(101)/500_000, w0 = 10th percentile of the
    // w-distribution, void probe mulberry32(31) index 3): a genuine void
    // (d3 = 0.2057 >> theta_vis = 0.05*R = 0.0516) where the OLD single-chain
    // estimator — still reproduced by forcing beamWidth: 1 below — reads
    // DE = 0.00562, comfortably under the eps_hit = 0.01*R = 0.01032 a slice
    // march would hit-test against, i.e. a measured false-hit ("ghost").
    // The width-2 beam (built DE, no forcing) ALSO clears this ghost —
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
    // estimator's width-2 fix test above: the width-2 beam is what
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
// Final-transform lens (landed post-verdict): a straight port of
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

// estimateDistance4Refined's early-out cutoff, the 3D twin's
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
// pre-refinement certificate would re-open the spike's ghost class, which
// the directed void test at the end of this section pins.
describe("estimateDistance4Refined early-out cutoff", () => {
  it("runs the full descent for a cutoff too small to fire, bit-for-bit", () => {
    // The 3D twin's test one dimension up: the claim the `cutoff = 0`
    // default makes, stated against a DIFFERENT call. Every exit is guarded
    // `cutoff > 0 && best < cutoff`, so a cutoff below every value the
    // descent can report has to be a no-op; comparing the default-arg call
    // against an explicit `0` would be the identical call on both sides and
    // could not fail.
    const de = buildSurfaceDE4(pentatope());
    const rng = mulberry32(11);
    const tiny = 1e-12 * de.boundingRadius;
    for (let i = 0; i < 60; i++) {
      const p: Vec4 = [
        (rng() - 0.5) * 4,
        (rng() - 0.5) * 4,
        (rng() - 0.5) * 4,
        (rng() - 0.5) * 4,
      ];
      const full = estimateDistance4Refined(de, p);
      // Keeps the equality below from passing vacuously off an exit that
      // COULD have fired: no probe here sits within `tiny` of the set.
      expect(full).toBeGreaterThan(tiny);
      expect(estimateDistance4Refined(de, p, tiny)).toBe(full);
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
    // The ghost class refinement killed, aimed straight at the early-out: at
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

// The depth-0 sphere floor's own unconditional exit, the 3D
// twin's contract one dimension up: once `best` falls to or below
// `sphereBound`, descentValue's `max(best, sphereBound)` clamp is already
// pinned there, and `best` only ever falls further — so the descent may
// return the instant that happens, no cutoff required. Value-exact for
// EVERY caller (unlike the cutoff exit, exact only at or above the
// cutoff), but also value-INVISIBLE: the returned number is identical
// whether or not the exit fired, so there is no "did it fire" counter
// below — the tests instead pin the invariant the exit leans on (the
// return never drops below the floor) and re-run the cutoff
// contract over probe corpora biased into the region where the new exit
// actually triggers.
describe("estimateDistance4Refined sphere-floor pin", () => {
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
// Slab queries: both estimators take an optional `halfExtent`
// that turns the query point into the SEGMENT `p ± halfExtent`, marching a
// SLAB of half-thickness h rather than a zero-thickness hyperplane — see
// the module doc's SLAB QUERIES section. Same "conservative bound, exact
// zero set" contract as the point query, just looser; `halfExtent = null`
// (or all-zero) must reproduce the point-query path exactly.
// -----------------------------------------------------------------------

describe("slab queries: a null or all-zero half-extent matches the point-query path exactly (the gate-in guarantee)", () => {
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

describe("slab validity: the estimate never exceeds the true distance from the segment to the attractor", () => {
  // Thicknesses as originally proposed; measured (this suite): 0
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

describe("slab queries: the zero-thickness estimate misses off-slice content the slab captures", () => {
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

describe("estimateDistance4Refined never falls below the base estimate, with a slab", () => {
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

describe("the final-transform lens carries the half-extent through its inverse linear part", () => {
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

describe("estimateDistance4Refined early-out cutoff holds with a slab", () => {
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
// The 4D kaleidoscope sector sweep — 3D's sweep shape one
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
      const [gx, gy, gz, gw] = base.bnbDir;
      maps.push({
        invM: multiply4x4(base.invM, rotT),
        invT: base.invT,
        sigmaMin: base.sigmaMin,
        baseIndex: base.baseIndex,
        // Copied through for type completeness exactly like 3D's
        // expandedReference: fold slots are never run through this
        // expansion oracle (a fold does not commute with the copy
        // rotation, so an expanded fold slot would be algebraically
        // wrong — fold-kaleidoscope agreement is tested against clouds
        // and frontier replays instead).
        foldKind: base.foldKind,
        foldInvW: base.foldInvW,
        foldSigma: base.foldSigma,
        foldRadii: base.foldRadii,
        // Rotations leave singular values (and invT) alone; the
        // directional bound rotates with the matrix:
        // (invM·rotT)^T · d = rot · (invM^T · d).
        invMSigmaMin: base.invMSigmaMin,
        invTNorm: base.invTNorm,
        bnbDir: [
          rot[0] * gx + rot[1] * gy + rot[2] * gz + rot[3] * gw,
          rot[4] * gx + rot[5] * gy + rot[6] * gz + rot[7] * gw,
          rot[8] * gx + rot[9] * gy + rot[10] * gz + rot[11] * gw,
          rot[12] * gx + rot[13] * gy + rot[14] * gz + rot[15] * gw,
        ],
      });
    }
  }
  return { ...de, maps, symmetry: { order: 1, stepBack: IDENTITY_STEP4 } };
}

describe("buildSurfaceDE4 with kaleidoscope symmetry", () => {
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

describe("sector sweep agreement with the symmetry expansion", () => {
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

describe("estimateDistance4 with kaleidoscope symmetry", () => {
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
    // zw-rotated copies separate cleanly, so the >= 5-simultaneous
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

describe("kaleidoscope order 1 is the identity", () => {
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

describe("slab queries rotate the carried half-extent through the sectors", () => {
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

describe("symmetry never affects surface eligibility", () => {
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

describe("twisted symmetry on an off-origin attractor stays conservative (the fixed-subspace two-case)", () => {
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
    // Tolerance is the KALEIDOSCOPE residual band, not fp noise:
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

// -----------------------------------------------------------------------
// The fold port, one dimension up from `surface-de.test.ts`'s
// pure-fold base-map and pure-fold FINAL lens suites.
// Every describe below mirrors a named group in that file; see each one's
// doc comment for its 3D template.
// -----------------------------------------------------------------------

describe("analyzeSurfaceSystem4 eligibility for pure-fold maps", () => {
  it("classifies a pure-boxfold map with a live w block (plus a plain affine map) as not ineligible", () => {
    const analysis = analyzeSurfaceSystem4([
      map4({
        w: { position: 0.3, rotation: { xw: 0.3 } },
        variations: [{ type: "boxfold", weight: 1 }],
      }),
      map4({ id: 1 }),
    ]);
    expect(analysis.status).not.toBe("ineligible");
    expect(analysis.reasons).toEqual([]);
  });

  it("keeps a blended fold+linear map ineligible, naming it a variations map — blends stay out forever", () => {
    const analysis = analyzeSurfaceSystem4([
      map4({
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
    const analysis = analyzeSurfaceSystem4([
      map4({
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
    const analysis = analyzeSurfaceSystem4([
      map4({
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
    const analysis = analyzeSurfaceSystem4([
      map4({
        scale: [0.3, 0.3, 0.3],
        variations: [{ type: "spherefold", weight: 1.2 }],
      }),
    ]);
    expect(analysis.status).toBe("ineligible");
    expect(analysis.reasons).toEqual(["map 1 does not contract"]);
  });

  it("lets a boxfold map at the same weight and scale contract, since its Lipschitz bound is 1 not 4", () => {
    const analysis = analyzeSurfaceSystem4([
      map4({
        scale: [0.3, 0.3, 0.3],
        variations: [{ type: "boxfold", weight: 1.2 }],
      }),
    ]);
    expect(analysis.status).not.toBe("ineligible");
    expect(analysis.reasons).toEqual([]);
  });

  it("lets a small fold weight rescue an affine part that alone would expand", () => {
    const analysis = analyzeSurfaceSystem4([
      map4({
        scale: [5, 5, 5],
        variations: [{ type: "boxfold", weight: 0.1 }],
      }),
    ]);
    expect(analysis.status).not.toBe("ineligible");
    expect(analysis.reasons).toEqual([]);
  });

  it("admits a pure-fold final transform — the lens expands into one round of branch root descents, one dimension up", () => {
    const analysis = analyzeSurfaceSystem4(
      [map4()],
      map4({ id: 99, variations: [{ type: "boxfold", weight: 1 }] }),
    );
    expect(analysis.status).not.toBe("ineligible");
    expect(analysis.reasons).toEqual([]);
  });

  it("puts no contraction gate on a pure-fold final — an un-iterated lens needs none", () => {
    // Weight 2 mandelbox: iterated it would need sigma_max < 0.125; as a
    // lens it is applied once and any weight is admissible.
    const analysis = analyzeSurfaceSystem4(
      [map4()],
      map4({ id: 99, variations: [{ type: "mandelbox", weight: 2 }] }),
    );
    expect(analysis.status).not.toBe("ineligible");
    expect(analysis.reasons).toEqual([]);
  });

  it("keeps a BLENDED final transform ineligible — a weighted sum has no branch decomposition", () => {
    const analysis = analyzeSurfaceSystem4(
      [map4()],
      map4({
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

  it("refuses a fold map whose 4D LIFT breaks contraction even though its 3D part alone would contract — the composite gate prices the lifted sigmas", () => {
    // Boxfold Lipschitz is 1, so the composite bound is |w| * sigma_max: the
    // 3D part (scale 0.3) contracts comfortably, but an explicit w.scale of
    // 1.5 makes the LIFTED sigma_max 1.5, past CONTRACTION_LIMIT — exactly
    // the "sigmas here are the LIFTED map's" guarantee in the module doc.
    const analysis = analyzeSurfaceSystem4([
      map4({
        scale: [0.3, 0.3, 0.3],
        w: { scale: 1.5 },
        variations: [{ type: "boxfold", weight: 1 }],
      }),
    ]);
    expect(analysis.status).toBe("ineligible");
    expect(analysis.reasons).toEqual(["map 1 does not contract"]);
  });
});

describe("reasons-array hygiene", () => {
  it("still names a fold+swirl blend map with 'uses variations', matching the plain-swirl and fold+linear pins above", () => {
    const analysis = analyzeSurfaceSystem4([
      map4({
        variations: [
          { type: "boxfold", weight: 1 },
          { type: "swirl", weight: 0.4 },
        ],
      }),
    ]);
    expect(analysis.status).toBe("ineligible");
    expect(analysis.reasons).toEqual(["map 1 uses variations"]);
  });
});

describe("fold-weight eligibility floor", () => {
  it("refuses a boxfold map whose weight is just under the floor, though the composite Lipschitz gate alone would pass", () => {
    // A smaller |w| only ever HELPS the composite contraction bound (it
    // shrinks as w -> 0), so nothing here fails on that gate — the descent
    // divides the chain point by w instead, and NEAR_ZERO_FOLD_WEIGHT is the
    // only thing standing between this and that division blowing up.
    const analysis = analyzeSurfaceSystem4([
      map4({ variations: [{ type: "boxfold", weight: 5e-5 }] }),
    ]);
    expect(analysis.status).toBe("ineligible");
    expect(analysis.reasons).toEqual(["map 1 fold weight ≈ 0"]);
  });

  it("refuses the same weight negated — the floor is on |w|; folds are odd, so negative weights are otherwise legal above it", () => {
    const analysis = analyzeSurfaceSystem4([
      map4({ variations: [{ type: "boxfold", weight: -5e-5 }] }),
    ]);
    expect(analysis.status).toBe("ineligible");
    expect(analysis.reasons).toEqual(["map 1 fold weight ≈ 0"]);
  });

  it("admits a weight exactly at the floor — the gate is a strict less-than", () => {
    const analysis = analyzeSurfaceSystem4([
      map4({
        variations: [{ type: "boxfold", weight: NEAR_ZERO_FOLD_WEIGHT }],
      }),
    ]);
    expect(analysis.status).not.toBe("ineligible");
    expect(analysis.reasons).toEqual([]);
  });

  it("refuses a pure-fold FINAL transform at a near-zero weight — the lens has no contraction gate to catch it otherwise", () => {
    const analysis = analyzeSurfaceSystem4(
      [map4()],
      map4({ id: 99, variations: [{ type: "mandelbox", weight: 5e-5 }] }),
    );
    expect(analysis.status).toBe("ineligible");
    expect(analysis.reasons).toEqual(["final transform fold weight ≈ 0"]);
  });

  it("leaves a weight-0 fold variation inert rather than naming it near-zero — it is not a fold map at all", () => {
    // composeVariations' active filter drops weight-0 entries outright, so
    // pureFoldVariation sees no active variation here; the floor must never
    // misfire on an entry that was never a fold map to begin with.
    const analysis = analyzeSurfaceSystem4([
      map4({ variations: [{ type: "boxfold", weight: 0 }] }),
    ]);
    expect(analysis.status).not.toBe("ineligible");
    expect(analysis.reasons).toEqual([]);
  });

  it("makes buildSurfaceDE4 throw for a near-zero-weight fold system", () => {
    const ineligible = [
      map4({ variations: [{ type: "boxfold", weight: 5e-5 }] }),
    ];
    expect(() => buildSurfaceDE4(ineligible)).toThrow(/fold weight/);
  });
});

describe("buildSurfaceDE4 fold fields and depth sizing", () => {
  it("gives a plain affine map the inert fold defaults and a pure-fold map its signed weight and branch kind", () => {
    const transforms: Transform[] = [
      map4(),
      map4({
        id: 1,
        scale: [0.16, 0.16, 0.16],
        variations: [{ type: "mandelbox", weight: -1.25 }],
      }),
    ];
    const de = buildSurfaceDE4(transforms);
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
      map4({ scale: [0.2, 0.2, 0.2] }),
      map4({
        id: 1,
        scale: [0.24, 0.24, 0.24],
        variations: [{ type: "spherefold", weight: 0.9 }],
      }),
    ];
    const de = buildSurfaceDE4(transforms);
    // The spherefold branch factor (|w| * sigmaMin * SPHEREFOLD_LIPSCHITZ)
    // beats the affine map's plain sigmaMin (0.2), so it drives the cap.
    const slowest = 0.9 * 0.24 * SPHEREFOLD_LIPSCHITZ;
    const expected = Math.min(
      MAX_DESCENT_DEPTH,
      Math.max(8, Math.ceil(Math.log(DEPTH_RESOLUTION) / Math.log(slowest))),
    );
    expect(de.maxDepth).toBe(expected);
    expect(de.slowestSigma).toBeCloseTo(slowest, 12);
  });
});

describe("foldBranchCount4", () => {
  it("maps each fold kind to its branch count: 1 affine, 81 boxfold, 3 spherefold, 243 mandelbox", () => {
    expect(foldBranchCount4(SURFACE_FOLD_NONE)).toBe(1);
    expect(foldBranchCount4(SURFACE_FOLD_BOXFOLD)).toBe(81);
    expect(foldBranchCount4(SURFACE_FOLD_SPHEREFOLD)).toBe(3);
    expect(foldBranchCount4(SURFACE_FOLD_MANDELBOX)).toBe(243);
  });
});

describe("deHasFolds4", () => {
  it("is false for an affine-only system", () => {
    expect(deHasFolds4(buildSurfaceDE4(pentatope()))).toBe(false);
  });

  it("is true once any map carries a fold", () => {
    expect(deHasFolds4(buildSurfaceDE4(pureBoxfoldPair4()))).toBe(true);
  });
});

describe("slabExact4 truth table", () => {
  it("reads true for an affine-only system", () => {
    expect(slabExact4(buildSurfaceDE4(pentatope()))).toBe(true);
  });

  it("reads true for a boxfold-only system", () => {
    expect(slabExact4(buildSurfaceDE4(pureBoxfoldPair4()))).toBe(true);
  });

  it("reads false for a spherefold system", () => {
    expect(slabExact4(buildSurfaceDE4(pureSpherefoldPair4()))).toBe(false);
  });

  it("reads false for a mandelbox system", () => {
    expect(slabExact4(buildSurfaceDE4(pureMandelboxPair4()))).toBe(false);
  });

  it("reads true for a boxfold map mixed with a plain affine map", () => {
    const de = buildSurfaceDE4([
      map4({ variations: [{ type: "boxfold", weight: 1 }] }),
      map4({ id: 1 }),
    ]);
    expect(slabExact4(de)).toBe(true);
  });

  it("reads true for an affine base under a boxfold FINAL lens", () => {
    const de = buildSurfaceDE4([map4()], boxfoldFinal4());
    expect(slabExact4(de)).toBe(true);
  });

  it("reads false for an affine base under a mandelbox FINAL lens", () => {
    const de = buildSurfaceDE4([map4()], mandelboxFinal4());
    expect(slabExact4(de)).toBe(false);
  });
});

describe("estimateDistance4 / estimateDistance4Refined validity on a pure-boxfold-4D system", () => {
  it("keeps both estimators below the brute-force nearest cloud distance, jittered and uniform probes alike", () => {
    const transforms = pureBoxfoldPair4();
    const de = buildSurfaceDE4(transforms);
    expect(de.maps[0].foldKind).toBe(SURFACE_FOLD_BOXFOLD);
    expect(de.maps[1].foldKind).toBe(SURFACE_FOLD_BOXFOLD);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(101),
    );
    const R = de.boundingRadius;
    const rng = mulberry32(202);
    const probes: Vec4[] = [];
    for (let i = 0; i < 150; i++) {
      const idx = Math.floor(rng() * cloud.count);
      probes.push([
        cloud.positions[idx * 3] + (rng() - 0.5) * 0.3,
        cloud.positions[idx * 3 + 1] + (rng() - 0.5) * 0.3,
        cloud.positions[idx * 3 + 2] + (rng() - 0.5) * 0.3,
        cloud.w[idx] + (rng() - 0.5) * 0.3,
      ]);
    }
    for (let i = 0; i < 100; i++) {
      probes.push([
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
      ]);
    }
    for (const p of probes) {
      const nearest = nearestDistance4(cloud, p);
      expect(estimateDistance4(de, p)).toBeLessThanOrEqual(nearest + 1e-9);
      expect(estimateDistance4Refined(de, p)).toBeLessThanOrEqual(
        nearest + 1e-9,
      );
    }
  });

  it("stays within 0.02R of the attractor for points sampled exactly on it (no erosion)", () => {
    const transforms = pureBoxfoldPair4();
    const de = buildSurfaceDE4(transforms);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(101),
    );
    const R = de.boundingRadius;
    for (let i = 0; i < 50; i++) {
      const idx = (i * 337) % cloud.count;
      const p: Vec4 = [
        cloud.positions[idx * 3],
        cloud.positions[idx * 3 + 1],
        cloud.positions[idx * 3 + 2],
        cloud.w[idx],
      ];
      expect(estimateDistance4Refined(de, p)).toBeLessThanOrEqual(0.02 * R);
    }
  });

  it("has zero void false hits: the refined estimate never dips below 0.01R once the true distance clears 0.15R", () => {
    const transforms = pureBoxfoldPair4();
    const de = buildSurfaceDE4(transforms);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(101),
    );
    const R = de.boundingRadius;
    const rng = mulberry32(303);
    let voidProbes = 0;
    for (let i = 0; i < 150; i++) {
      const p: Vec4 = [
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
      ];
      const nearest = nearestDistance4(cloud, p);
      if (nearest <= 0.15 * R) continue;
      voidProbes++;
      expect(estimateDistance4Refined(de, p)).toBeGreaterThanOrEqual(0.01 * R);
    }
    expect(voidProbes).toBeGreaterThan(0);
  });

  it("never has the refined estimate fall below the base estimate", () => {
    const transforms = pureBoxfoldPair4();
    const de = buildSurfaceDE4(transforms);
    const R = de.boundingRadius;
    const rng = mulberry32(404);
    for (let i = 0; i < 100; i++) {
      const p: Vec4 = [
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
      ];
      expect(estimateDistance4Refined(de, p)).toBeGreaterThanOrEqual(
        estimateDistance4(de, p) - 1e-12,
      );
    }
  });
});

describe("estimateDistance4Refined on a pure-mandelbox-4D system", () => {
  it("never falls below the base estimate", () => {
    const transforms = pureMandelboxPair4();
    const de = buildSurfaceDE4(transforms);
    const R = de.boundingRadius;
    const rng = mulberry32(404);
    for (let i = 0; i < 60; i++) {
      const p: Vec4 = [
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
      ];
      expect(estimateDistance4Refined(de, p)).toBeGreaterThanOrEqual(
        estimateDistance4(de, p) - 1e-12,
      );
    }
  }, 20000);

  it("honors the early-out cutoff contract on a fold system: clearing the cutoff matches the full descent bit-for-bit, dipping under it implies the full descent does too", () => {
    const transforms = pureMandelboxPair4();
    const de = buildSurfaceDE4(transforms);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(101),
    );
    const R = de.boundingRadius;
    const cutoff = 0.02 * R;
    const rng = mulberry32(505);
    const probes: Vec4[] = [];
    for (let i = 0; i < 40; i++) {
      const idx = Math.floor(rng() * cloud.count);
      const jitter = [0.004, 0.05, 0.3][i % 3];
      probes.push([
        cloud.positions[idx * 3] + (rng() - 0.5) * jitter,
        cloud.positions[idx * 3 + 1] + (rng() - 0.5) * jitter,
        cloud.positions[idx * 3 + 2] + (rng() - 0.5) * jitter,
        cloud.w[idx] + (rng() - 0.5) * jitter,
      ]);
    }
    for (let i = 0; i < 20; i++) {
      probes.push([
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
      ]);
    }
    let cleared = 0;
    let dipped = 0;
    for (const q of probes) {
      const full = estimateDistance4Refined(de, q);
      const cut = estimateDistance4Refined(de, q, cutoff);
      if (cut >= cutoff) {
        cleared++;
        expect(cut).toBe(full);
      } else {
        dipped++;
        expect(full).toBeLessThan(cutoff);
      }
    }
    expect(cleared).toBeGreaterThan(0);
    expect(dipped).toBeGreaterThan(0);
  }, 20000);

  it("keeps both estimators below the brute-force nearest cloud distance (validity spot check)", () => {
    const transforms = pureMandelboxPair4();
    const de = buildSurfaceDE4(transforms);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(101),
    );
    const R = de.boundingRadius;
    const rng = mulberry32(606);
    for (let i = 0; i < 60; i++) {
      const p: Vec4 = [
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
      ];
      const nearest = nearestDistance4(cloud, p);
      expect(estimateDistance4(de, p)).toBeLessThanOrEqual(nearest + 1e-9);
      expect(estimateDistance4Refined(de, p)).toBeLessThanOrEqual(
        nearest + 1e-9,
      );
    }
  }, 20000);
});

describe("spherefold mid-branch guard", () => {
  it("returns a finite estimate at and near the sector origin, where the mid branch's inversion would otherwise overflow", () => {
    const de = buildSurfaceDE4(pureSpherefoldPair4());
    expect(de.maps[0].foldKind).toBe(SURFACE_FOLD_SPHEREFOLD);
    expect(de.maps[1].foldKind).toBe(SURFACE_FOLD_SPHEREFOLD);
    const points: Vec4[] = [
      [0, 0, 0, 0],
      [1e-9, 0, 0, 0],
    ];
    for (const p of points) {
      expect(Number.isFinite(estimateDistance4Refined(de, p))).toBe(true);
    }
  });
});

describe("fold-branch sweep interactions: kaleidoscope and beamWidth", () => {
  it("stays a sound bound under a kaleidoscope sweep combined with pure-fold maps", () => {
    const transforms = pureBoxfoldPair4();
    const symmetry: SymmetryParams = { order: 3, plane: "zw", twist: 1 };
    const de = buildSurfaceDE4(transforms, null, symmetry);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(101),
      null,
      symmetry,
    );
    const R = de.boundingRadius;
    const rng = mulberry32(606);
    for (let i = 0; i < 60; i++) {
      const p: Vec4 = [
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
      ];
      const nearest = nearestDistance4(cloud, p);
      expect(estimateDistance4(de, p)).toBeLessThanOrEqual(nearest + 1e-9);
      expect(estimateDistance4Refined(de, p)).toBeLessThanOrEqual(
        nearest + 1e-9,
      );
    }
  });

  it("returns identical estimates whether the DE reports beamWidth 4 or is forced to 1 — the fold frontier ignores it", () => {
    const transforms = pureBoxfoldPair4();
    const de = buildSurfaceDE4(transforms);
    expect(de.beamWidth).toBe(4);
    const narrow = { ...de, beamWidth: 1 as const };
    const R = de.boundingRadius;
    const rng = mulberry32(707);
    for (let i = 0; i < 20; i++) {
      const p: Vec4 = [
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
      ];
      expect(estimateDistance4(narrow, p)).toBe(estimateDistance4(de, p));
    }
  });
});

// -----------------------------------------------------------------------
// The 4D mirror of `surface-de.test.ts`'s "descendFold frontier kept
// set": a direct pin on the KEPT SET itself, not just estimator
// validity — a dropped candidate always folds a VALID (if looser) bound, so
// the validity suites above would stay green through a kept-set regression.
// -----------------------------------------------------------------------

describe("descendFold4 frontier kept set", () => {
  // The tap reports every candidate that reaches frontier insertion
  // (arrival order) and each completed level's kept slots (slot order);
  // replayFrontier4 below is a brute-force model of the CONTRACT — fill in
  // arrival order; once full, replace the FIRST-scanned worst slot (strict
  // `>` scan from index 0) only when a STRICTLY smaller key arrives; ties
  // evict the newcomer — and the tests below demand slot-exact agreement.

  function replayFrontier4(candidates: FoldFrontierCandidate4[]): {
    slots: FoldFrontierCandidate4[];
    replacements: number;
  } {
    const slots: FoldFrontierCandidate4[] = [];
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

  /** Installs the tap for one `estimateDistance4` call and hands back every
   * candidate seen (by depth) alongside every completed level's kept slots. */
  function tapDescent4(
    de: SurfaceDE4,
    p: Vec4,
  ): {
    candidates: Map<number, FoldFrontierCandidate4[]>;
    levels: Map<number, FoldFrontierCandidate4[]>;
  } {
    const candidates = new Map<number, FoldFrontierCandidate4[]>();
    const levels = new Map<number, FoldFrontierCandidate4[]>();
    setFoldFrontierTap4({
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
      estimateDistance4(de, p);
    } finally {
      setFoldFrontierTap4(null);
    }
    return { candidates, levels };
  }

  it("agrees slot-for-slot with the replay on a pure-boxfold pair (81-branch isometries)", () => {
    const transforms = pureBoxfoldPair4();
    const de = buildSurfaceDE4(transforms);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(2101),
    );
    const R = de.boundingRadius;
    const probes: Vec4[] = [];
    for (let i = 0; i < 8; i++) {
      const idx = (i * 337) % cloud.count;
      probes.push([
        cloud.positions[idx * 3],
        cloud.positions[idx * 3 + 1],
        cloud.positions[idx * 3 + 2],
        cloud.w[idx],
      ]);
    }
    const rng = mulberry32(2102);
    for (let i = 0; i < 16; i++) {
      probes.push([
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
      ]);
    }

    let levelsChecked = 0;
    for (const p of probes) {
      const { candidates, levels } = tapDescent4(de, p);
      for (const [depth, kept] of levels) {
        const atDepth = candidates.get(depth) ?? [];
        const replay = replayFrontier4(atDepth);
        expect(kept).toEqual(replay.slots);
        levelsChecked++;
      }
    }
    expect(levelsChecked).toBeGreaterThan(0);
  });

  it("agrees slot-for-slot with the replay on a pure-mandelbox pair (243-branch worst case, saturation guaranteed)", () => {
    const transforms = pureMandelboxPair4();
    const de = buildSurfaceDE4(transforms);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(2201),
    );
    const R = de.boundingRadius;
    const probes: Vec4[] = [];
    for (let i = 0; i < 8; i++) {
      const idx = (i * 337) % cloud.count;
      probes.push([
        cloud.positions[idx * 3],
        cloud.positions[idx * 3 + 1],
        cloud.positions[idx * 3 + 2],
        cloud.w[idx],
      ]);
    }
    const rng = mulberry32(2202);
    for (let i = 0; i < 16; i++) {
      probes.push([
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
      ]);
    }

    let levelsChecked = 0;
    let saturated = false;
    let replacements = 0;
    for (const p of probes) {
      const { candidates, levels } = tapDescent4(de, p);
      for (const [depth, kept] of levels) {
        const atDepth = candidates.get(depth) ?? [];
        const replay = replayFrontier4(atDepth);
        expect(kept).toEqual(replay.slots);
        levelsChecked++;
        replacements += replay.replacements;
        if (atDepth.length > SURFACE_FOLD_BEAM_WIDTH) saturated = true;
      }
    }
    expect(levelsChecked).toBeGreaterThan(0);
    expect(saturated).toBe(true);
    expect(replacements).toBeGreaterThan(0);
  }, 20000);

  it("agrees slot-for-slot with the replay under a kaleidoscope sweep over a pure-boxfold pair", () => {
    const transforms = pureBoxfoldPair4();
    const symmetry: SymmetryParams = { order: 3, plane: "zw", twist: 1 };
    const de = buildSurfaceDE4(transforms, null, symmetry);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(2301),
      null,
      symmetry,
    );
    const R = de.boundingRadius;
    const probes: Vec4[] = [];
    for (let i = 0; i < 8; i++) {
      const idx = (i * 337) % cloud.count;
      probes.push([
        cloud.positions[idx * 3],
        cloud.positions[idx * 3 + 1],
        cloud.positions[idx * 3 + 2],
        cloud.w[idx],
      ]);
    }
    const rng = mulberry32(2302);
    for (let i = 0; i < 16; i++) {
      probes.push([
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
      ]);
    }

    let levelsChecked = 0;
    let saturated = false;
    let replacements = 0;
    for (const p of probes) {
      const { candidates, levels } = tapDescent4(de, p);
      for (const [depth, kept] of levels) {
        const atDepth = candidates.get(depth) ?? [];
        const replay = replayFrontier4(atDepth);
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
      map4({ variations: [{ type: "boxfold", weight: 1 }] }),
      map4({ id: 1, position: [0.1001, 0.2, 0.3] }),
    ];
    const de = buildSurfaceDE4(transforms);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(2401),
    );
    const R = de.boundingRadius;
    const probes: Vec4[] = [];
    for (let i = 0; i < 8; i++) {
      const idx = (i * 337) % cloud.count;
      probes.push([
        cloud.positions[idx * 3],
        cloud.positions[idx * 3 + 1],
        cloud.positions[idx * 3 + 2],
        cloud.w[idx],
      ]);
    }
    const rng = mulberry32(2402);
    for (let i = 0; i < 16; i++) {
      probes.push([
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
      ]);
    }

    let levelsChecked = 0;
    let saturated = false;
    let replacements = 0;
    for (const p of probes) {
      const { candidates, levels } = tapDescent4(de, p);
      for (const [depth, kept] of levels) {
        const atDepth = candidates.get(depth) ?? [];
        const replay = replayFrontier4(atDepth);
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

// -----------------------------------------------------------------------
// The pure-fold FINAL lens, one dimension up from
// `surface-de.test.ts`'s own lens suites ("buildSurfaceDE with a pure-fold
// final lens" and "estimateDistance / estimateDistanceRefined with a fold
// final lens"). Base transforms are `pentatope()` throughout (5 maps,
// affine-only) — 4D's analogue of 3D's `sierpinskiTetrahedron()` base.
// -----------------------------------------------------------------------

describe("buildSurfaceDE4 with a pure-fold final lens", () => {
  it("builds foldFinal (and no affine final) with the lens's kind, weight and affine part", () => {
    const final = boxfoldFinal4();
    const de = buildSurfaceDE4(pentatope(), final);
    expect(de.final).toBeNull();
    expect(de.foldFinal).not.toBeNull();
    expect(de.foldFinal!.foldKind).toBe(SURFACE_FOLD_BOXFOLD);
    expect(de.foldFinal!.invW).toBeCloseTo(1 / 0.55, 12);
    expect(de.foldFinal!.absW).toBeCloseTo(0.55, 12);
    expect(de.foldFinal!.sigmaMin).toBeCloseTo(0.9, 12);
  });

  it("bounds the visible set: every plotted point of a lensed boxfold cloud sits inside visibleBoundingRadius", () => {
    const transforms = pentatope();
    const final = boxfoldFinal4();
    const de = buildSurfaceDE4(transforms, final);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(11),
      toTransform4(final),
    );
    let maxR = 0;
    for (let i = 0; i < cloud.count; i++) {
      const x = cloud.positions[i * 3];
      const y = cloud.positions[i * 3 + 1];
      const z = cloud.positions[i * 3 + 2];
      const w = cloud.w[i];
      const r = Math.sqrt(x * x + y * y + z * z + w * w);
      if (r > maxR) maxR = r;
    }
    expect(maxR).toBeLessThanOrEqual(de.visibleBoundingRadius);
  });

  it("bounds the visible set of a mandelbox lens the same way (the sqrt(r^2 + 4) bound)", () => {
    const transforms = pentatope();
    const final = mandelboxFinal4();
    const de = buildSurfaceDE4(transforms, final);
    expect(de.foldFinal!.foldKind).toBe(SURFACE_FOLD_MANDELBOX);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(11),
      toTransform4(final),
    );
    let maxR = 0;
    for (let i = 0; i < cloud.count; i++) {
      const x = cloud.positions[i * 3];
      const y = cloud.positions[i * 3 + 1];
      const z = cloud.positions[i * 3 + 2];
      const w = cloud.w[i];
      const r = Math.sqrt(x * x + y * y + z * z + w * w);
      if (r > maxR) maxR = r;
    }
    expect(maxR).toBeLessThanOrEqual(de.visibleBoundingRadius);
  });
});

describe("estimateDistance4 / estimateDistance4Refined with a fold final lens", () => {
  it("keeps both estimators below the brute-force nearest distance to the LENSED cloud, jittered and uniform probes alike", () => {
    const transforms = pentatope();
    const final = boxfoldFinal4();
    const de = buildSurfaceDE4(transforms, final);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      60000,
      mulberry32(101),
      toTransform4(final),
    );
    const R = de.visibleBoundingRadius;
    const rng = mulberry32(202);
    const probes: Vec4[] = [];
    for (let i = 0; i < 60; i++) {
      const idx = Math.floor(rng() * cloud.count);
      probes.push([
        cloud.positions[idx * 3] + (rng() - 0.5) * 0.3,
        cloud.positions[idx * 3 + 1] + (rng() - 0.5) * 0.3,
        cloud.positions[idx * 3 + 2] + (rng() - 0.5) * 0.3,
        cloud.w[idx] + (rng() - 0.5) * 0.3,
      ]);
    }
    for (let i = 0; i < 30; i++) {
      probes.push([
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
      ]);
    }
    for (const p of probes) {
      const nearest = nearestDistance4(cloud, p);
      expect(estimateDistance4(de, p)).toBeLessThanOrEqual(nearest + 1e-9);
      expect(estimateDistance4Refined(de, p)).toBeLessThanOrEqual(
        nearest + 1e-9,
      );
    }
  });

  it("absorbs a negative lens weight through |w| — both estimators stay sound", () => {
    const transforms = pentatope();
    const final = map4({
      id: 99,
      position: [0.1, 0, -0.1],
      rotation: [0, 0.4, 0.2],
      scale: [0.8, 0.8, 0.8],
      variations: [{ type: "boxfold", weight: -0.6 }],
    });
    const de = buildSurfaceDE4(transforms, final);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      40000,
      mulberry32(31),
      toTransform4(final),
    );
    const R = de.visibleBoundingRadius;
    const rng = mulberry32(32);
    for (let i = 0; i < 60; i++) {
      const p: Vec4 = [
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
      ];
      const nearest = nearestDistance4(cloud, p);
      expect(estimateDistance4(de, p)).toBeLessThanOrEqual(nearest + 1e-9);
      expect(estimateDistance4Refined(de, p)).toBeLessThanOrEqual(
        nearest + 1e-9,
      );
    }
  });

  it("stays sound with a boxfold lens OVER a pure-fold base — lens branches seeding fold-frontier root descents", () => {
    const transforms = pureBoxfoldPair4();
    const final = map4({
      id: 99,
      position: [0.1, -0.05, 0.1],
      rotation: [0.15, 0.25, 0],
      scale: [0.9, 0.9, 0.9],
      variations: [{ type: "boxfold", weight: 0.6 }],
    });
    const de = buildSurfaceDE4(transforms, final);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      40000,
      mulberry32(51),
      toTransform4(final),
    );
    const R = de.visibleBoundingRadius;
    const rng = mulberry32(52);
    for (let i = 0; i < 40; i++) {
      const p: Vec4 = [
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
      ];
      const nearest = nearestDistance4(cloud, p);
      expect(estimateDistance4(de, p)).toBeLessThanOrEqual(nearest + 1e-9);
      expect(estimateDistance4Refined(de, p)).toBeLessThanOrEqual(
        nearest + 1e-9,
      );
    }
  }, 20000);

  it("stays sound under a kaleidoscope sweep beneath the lens", () => {
    const transforms = pentatope();
    const symmetry: SymmetryParams = { order: 3, plane: "xw" };
    const final = boxfoldFinal4();
    const de = buildSurfaceDE4(transforms, final, symmetry);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      40000,
      mulberry32(61),
      toTransform4(final),
      symmetry,
    );
    const R = de.visibleBoundingRadius;
    const rng = mulberry32(62);
    for (let i = 0; i < 40; i++) {
      const p: Vec4 = [
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
        (rng() - 0.5) * 2.4 * R,
      ];
      const nearest = nearestDistance4(cloud, p);
      expect(estimateDistance4(de, p)).toBeLessThanOrEqual(nearest + 1e-9);
      expect(estimateDistance4Refined(de, p)).toBeLessThanOrEqual(
        nearest + 1e-9,
      );
    }
  });

  it("honors the cutoff contract: values at or above the cutoff equal the full result, values below imply the full result is below too", () => {
    const transforms = pentatope();
    const final = boxfoldFinal4();
    const de = buildSurfaceDE4(transforms, final);
    const R = de.visibleBoundingRadius;
    const rng = mulberry32(72);
    for (let i = 0; i < 100; i++) {
      const p: Vec4 = [
        (rng() - 0.5) * 2.6 * R,
        (rng() - 0.5) * 2.6 * R,
        (rng() - 0.5) * 2.6 * R,
        (rng() - 0.5) * 2.6 * R,
      ];
      const cutoff = rng() * 0.2 * R;
      const full = estimateDistance4Refined(de, p);
      const cut = estimateDistance4Refined(de, p, cutoff);
      if (cut >= cutoff) {
        expect(cut).toBe(full);
      } else {
        expect(full).toBeLessThan(cutoff);
      }
    }
  });

  it("reports positive distance across deep voids of the lensed set — the region floors close vacuous branch terms", () => {
    const transforms = pentatope();
    const final = boxfoldFinal4();
    const de = buildSurfaceDE4(transforms, final);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      80000,
      mulberry32(81),
      toTransform4(final),
    );
    const R = de.visibleBoundingRadius;
    const rng = mulberry32(82);
    let deepVoidProbes = 0;
    for (let i = 0; i < 150; i++) {
      const p: Vec4 = [
        (rng() - 0.5) * 2.2 * R,
        (rng() - 0.5) * 2.2 * R,
        (rng() - 0.5) * 2.2 * R,
        (rng() - 0.5) * 2.2 * R,
      ];
      const nearest = nearestDistance4(cloud, p);
      if (nearest <= 0.15 * R) continue;
      deepVoidProbes++;
      expect(estimateDistance4Refined(de, p)).toBeGreaterThanOrEqual(0.01 * R);
    }
    expect(deepVoidProbes).toBeGreaterThan(10);
  });
});

// -----------------------------------------------------------------------
// The slab query (`halfExtent`) crossed with the fold
// port. No 3D template exists — `halfExtent` is a 4D-only concept (it
// thickens a `w = w0` SLICE, and 3D never slices a hyperplane) — so these
// tests are new, exercising exactly the interaction `slabExact4`'s doc
// describes: boxfold branch inverses are per-axis reflections (affine, so
// segment-exact), while spherefold/mandelbox's inversion branch takes a
// segment to an ARC and is refused outright.
// -----------------------------------------------------------------------

describe("slab queries through the fold frontier", () => {
  it("keeps both estimators sound against the segment-sampled nearest on a pure-boxfold pair", () => {
    const transforms = pureBoxfoldPair4();
    const de = buildSurfaceDE4(transforms);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(101),
    );
    const R = de.boundingRadius;
    const halfExtent: Vec4 = [0, 0, 0, 0.1 * R];
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
  });

  // Full-suite V8 coverage runs this 20k-cloud/property probe alongside the
  // other heavy estimator files; the same 10s allowance used below keeps
  // shared-runner contention from masquerading as a math failure.
  it("never returns a slab value greater than the point-query value at the same center — enlarging the query set can only shrink the infimum", () => {
    const transforms = pureBoxfoldPair4();
    const de = buildSurfaceDE4(transforms);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(101),
    );
    const R = de.boundingRadius;
    const halfExtent: Vec4 = [0, 0, 0, 0.1 * R];
    for (const q of validityQueries(cloud)) {
      const pointBase = estimateDistance4(de, q);
      const pointRefined = estimateDistance4Refined(de, q);
      expect(estimateDistance4(de, q, halfExtent)).toBeLessThanOrEqual(
        pointBase + 1e-9,
      );
      expect(
        estimateDistance4Refined(de, q, 0, halfExtent),
      ).toBeLessThanOrEqual(pointRefined + 1e-9);
    }
  }, 10_000);

  it("matches the point-query path bit-for-bit at a null or all-zero half-extent, through the fold frontier", () => {
    const transforms = pureBoxfoldPair4();
    const de = buildSurfaceDE4(transforms);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      20000,
      mulberry32(101),
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

  it("throws on a nonzero half-extent for a spherefold system", () => {
    const de = buildSurfaceDE4(pureSpherefoldPair4());
    const halfExtent: Vec4 = [0, 0, 0, 0.05];
    expect(() => estimateDistance4(de, [0.2, 0, 0, 0], halfExtent)).toThrow(
      /slab queries are unsound/,
    );
    expect(() =>
      estimateDistance4Refined(de, [0.2, 0, 0, 0], 0, halfExtent),
    ).toThrow(/slab queries are unsound/);
  });

  it("throws on a nonzero half-extent for a mandelbox system", () => {
    const de = buildSurfaceDE4(pureMandelboxPair4());
    const halfExtent: Vec4 = [0, 0, 0, 0.05];
    expect(() => estimateDistance4(de, [0.2, 0, 0, 0], halfExtent)).toThrow(
      /slab queries are unsound/,
    );
    expect(() =>
      estimateDistance4Refined(de, [0.2, 0, 0, 0], 0, halfExtent),
    ).toThrow(/slab queries are unsound/);
  }, 20000);

  it("keeps both estimators sound against the segment-sampled nearest through a boxfold FINAL lens", () => {
    const transforms = pentatope();
    const final = boxfoldFinal4();
    const de = buildSurfaceDE4(transforms, final);
    expect(slabExact4(de)).toBe(true);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      40000,
      mulberry32(17),
      toTransform4(final),
    );
    const rng = mulberry32(18);
    const halfExtent: Vec4 = [0, 0, 0, 0.08];
    for (let i = 0; i < 30; i++) {
      const idx = Math.floor(rng() * cloud.count);
      const q: Vec4 = [
        cloud.positions[idx * 3] + (rng() - 0.5) * 0.3,
        cloud.positions[idx * 3 + 1] + (rng() - 0.5) * 0.3,
        cloud.positions[idx * 3 + 2] + (rng() - 0.5) * 0.3,
        cloud.w[idx] + (rng() - 0.5) * 0.3,
      ];
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
  });
});

describe("fold-radius rescale equivariance in 4D", () => {
  // 3D's equivariance check one dimension up, and it is here for the same
  // reason: conjugating a system by `p = k·q` divides every translation and
  // every fold LENGTH by k and leaves the attractor at `A/k`, so `DE'(q)`
  // must equal `DE(k q)/k`. It is an EQUALITY, so it fails in both
  // directions where a conservatism bound only catches overshoot — and in
  // 4D it also covers the fourth box axis, which has no 3D counterpart to
  // have been checked against.
  //
  // The magnification `fR²/mR²` is held at the classic 4 in every fixture
  // below: it is invariant under the rescale (a ratio), so varying it would
  // add nothing here, and holding it keeps these systems inside the
  // contraction gate that the pairs were tuned for.
  //
  // DISCLOSED LIMIT, measured by mutating each substituted constant and
  // re-running: every length is pinned EXCEPT the fourth box axis's
  // fold-from-above preimage `pw1` and its `dwUp` region distance — the
  // `selW === 1` branch never wins the min on these fixtures, and widening
  // the query span to cover w = ±4 did not change that. Its three siblings
  // `px1`/`py1`/`pz1` and the fourth axis's own `pw2`/`dwDn` are pinned, and
  // all four axes are the same three lines of code repeated, so this is a
  // fixture gap rather than an unchecked expression. The magnification
  // `fR²/mR²` is likewise invisible HERE by construction (a ratio survives
  // conjugation), and is pinned by 3D's conservatism rows instead, off the
  // same shared `SurfaceFoldRadii` field.
  const K = 2.5;
  /** Same relative tolerance and same reason as 3D's: `buildSurfaceDE4`
   * fits its ball from a seeded probe whose first point is not rescaled,
   * so the two balls agree to ~1e-3 rather than exactly. */
  const RELATIVE_TOLERANCE = 0.01;

  /** Non-classic lengths at the CLASSIC magnification — every radius the
   * branch algebra reads has moved, the one ratio it cannot see has not. */
  const WIDE = { minRadius: 0.7, fixedRadius: 1.4, boxLimit: 0.75 };

  function withRadii(t: Transform): Transform {
    return { ...t, variations: t.variations?.map((v) => ({ ...v, ...WIDE })) };
  }

  function rescale(t: Transform, k: number): Transform {
    return {
      ...t,
      position: [t.position[0] / k, t.position[1] / k, t.position[2] / k],
      w: t.w ? { ...t.w, position: (t.w.position ?? 0) / k } : t.w,
      variations: t.variations?.map((v) => ({
        ...v,
        // The transform's OWN lengths divided by k — reading WIDE here
        // instead would silently give the rescaled system different base
        // maps than the original whenever a fixture mixes authored and
        // default radii, which is exactly what the lens case does.
        minRadius: (v.minRadius ?? SPHERE_FOLD_MIN_RADIUS) / k,
        fixedRadius: (v.fixedRadius ?? SPHERE_FOLD_FIXED_RADIUS) / k,
        boxLimit: (v.boxLimit ?? BOX_FOLD_LIMIT) / k,
      })),
    };
  }

  function expectEquivariant4(
    transforms: Transform[],
    lens: Transform | null,
    seed: number,
    span: number,
  ): void {
    const de = buildSurfaceDE4(transforms, lens);
    const deK = buildSurfaceDE4(
      transforms.map((t) => rescale(t, K)),
      lens ? rescale(lens, K) : null,
    );
    const rng = mulberry32(seed);
    let compared = 0;
    for (let i = 0; i < 150; i++) {
      const q: Vec4 = [
        (rng() - 0.5) * span,
        (rng() - 0.5) * span,
        (rng() - 0.5) * span,
        (rng() - 0.5) * span,
      ];
      const scaled: Vec4 = [q[0] * K, q[1] * K, q[2] * K, q[3] * K];
      const pairs: [number, number][] = [
        [estimateDistance4(deK, q), estimateDistance4(de, scaled) / K],
        [
          estimateDistance4Refined(deK, q),
          estimateDistance4Refined(de, scaled) / K,
        ],
      ];
      for (const [small, large] of pairs) {
        if (Math.abs(large) <= 1e-3) continue;
        expect(
          Math.abs(small - large) / Math.abs(large),
          `q=[${q.join(", ")}] ${small} vs ${large}`,
        ).toBeLessThan(RELATIVE_TOLERANCE);
        compared++;
      }
    }
    // Not vacuous: the queries must actually reach the descent.
    expect(compared).toBeGreaterThan(80);
  }

  // Native calibration now runs during both builds. Coverage runners are
  // much slower than an interactive session but the mathematical oracle is
  // unchanged, so give this existing exhaustive check deterministic room.
  it("holds for the mandelbox pair, whose 243 branches read every length at once", () => {
    expectEquivariant4(pureMandelboxPair4().map(withRadii), null, 0x5f31, 3);
  }, 10_000);

  it("holds for the spherefold pair, where only the radial lengths are in play", () => {
    expectEquivariant4(pureSpherefoldPair4().map(withRadii), null, 0x5f32, 3);
  });

  it("holds for the boxfold pair, where only the wall is in play — including the fourth axis", () => {
    expectEquivariant4(pureBoxfoldPair4().map(withRadii), null, 0x5f33, 3);
  });

  it("holds through a 4D fold LENS, whose branches are swept at the query rather than iterated", () => {
    expectEquivariant4(
      pureBoxfoldPair4(),
      withRadii(mandelboxFinal4()),
      0x5f34,
      3,
    );
  });
});

describe("analyzeSurfaceSystem4 chaos rows", () => {
  it("admits a chi-carrying 4D document and builds reverse support", () => {
    const transforms = pentatope().map((t, i) =>
      i === 0 ? { ...t, chaos: [1, 0, 1, 1, 1] } : t,
    );
    const analysis = analyzeSurfaceSystem4(transforms);
    expect(analysis.status).toBe("eligible");
    expect(buildSurfaceDE4(transforms).chaos).toBeDefined();
    expect(
      analyzeSurfaceSystem4(
        pentatope().map((t) => ({ ...t, chaos: [1, 1, 1, 1, 1] })),
      ).status,
    ).toBe("eligible");
  });
});

describe("analyzeSurfaceSystem4 shape emitters", () => {
  it("admits a shape emitter, splits it from recursive maps, and refuses slabs", () => {
    const emitter = {
      parts: [
        {
          primitive: { kind: "sphere" as const, radius: 0.5 },
          combine: "union" as const,
        },
      ],
    };
    const base = pentatope();
    expect(analyzeSurfaceSystem4(base).status).toBe("eligible");
    const withEmitter = base.map((t, i) => (i === 1 ? { ...t, emitter } : t));
    const analysis = analyzeSurfaceSystem4(withEmitter);
    expect(analysis.status).toBe("eligible");
    const de = buildSurfaceDE4(withEmitter);
    expect(de.maps.map((m) => m.baseIndex)).toEqual([0, 2, 3, 4]);
    expect(de.condensation?.emitters[0]).toMatchObject({
      baseIndex: 1,
      shadeIndex: 4,
    });
    expect(slabExact4(de)).toBe(false);
    expect(() => estimateDistance4(de, [0, 0, 0, 0], [0, 0, 0, 0.1])).toThrow(
      /condensation shape/,
    );
    expect(() =>
      estimateDistance4Refined(de, [0, 0, 0, 0], 0, [0, 0, 0, 0.1]),
    ).toThrow(/condensation shape/);
  });

  it("refuses a pure-emitter 4D system but admits an SDF-only intersection beside recursion", () => {
    const emitter = {
      parts: [
        {
          primitive: { kind: "sphere" as const, radius: 0.5 },
          combine: "union" as const,
        },
      ],
    };
    const analysis = analyzeSurfaceSystem4([map4({ emitter })]);
    expect(analysis.status).toBe("ineligible");
    expect(analysis.reasons).toContain(
      "shape emitters leave no recursive maps",
    );

    const intersectionSystem = [
      map4(),
      map4({
        id: 1,
        emitter: {
          parts: [
            emitter.parts[0],
            {
              primitive: { kind: "sphere" as const, radius: 0.25 },
              combine: "intersect" as const,
            },
          ],
        },
      }),
    ];
    expect(analyzeSurfaceSystem4(intersectionSystem).status).toBe("eligible");
    const intersectionDE = buildSurfaceDE4(intersectionSystem);
    expect(intersectionDE.maps.map((entry) => entry.baseIndex)).toEqual([0]);
    expect(intersectionDE.condensation?.emitters).toHaveLength(1);
    expect(intersectionDE.condensation?.emitters[0].shape).toBe(
      intersectionSystem[1].emitter,
    );

    const inactiveUnsamplable = [
      map4(),
      map4({
        id: 2,
        weight: 0,
        emitter: {
          parts: [
            emitter.parts[0],
            {
              primitive: { kind: "sphere", radius: 0.25 },
              combine: "intersect",
            },
          ],
        },
      }),
    ];
    expect(analyzeSurfaceSystem4(inactiveUnsamplable).status).toBe("eligible");
    expect(buildSurfaceDE4(inactiveUnsamplable).condensation).toBeUndefined();

    const finalEmitter = analyzeSurfaceSystem4(
      [map4()],
      map4({ id: 3, emitter }),
    );
    expect(finalEmitter.status).toBe("ineligible");
    expect(finalEmitter.reasons).toContain(
      "final transform has a shape emitter",
    );
  });

  it("proves a 4D invariant closure sphere for a rare translated recursive map", () => {
    const emitter = {
      parts: [
        {
          primitive: { kind: "sphere" as const, radius: 1 },
          combine: "union" as const,
        },
      ],
    };
    const transforms = [
      map4({
        position: [100, 0, 0],
        scale: [0.5, 0.5, 0.5],
        w: { position: 20, scale: 0.5 },
        weight: 1e-12,
      }),
      map4({
        id: 1,
        position: [0, 0, 0],
        scale: [0.5, 0.5, 0.5],
        w: { position: 0, scale: 0.5 },
        weight: 1,
        emitter,
      }),
    ];
    const de = buildSurfaceDE4(transforms);
    let x = 0;
    let w = 0;
    for (let i = 0; i < 48; i++) {
      x = 0.5 * x + 100;
      w = 0.5 * w + 20;
    }
    expect(Math.hypot(x, w)).toBeLessThanOrEqual(de.boundingRadius);
    expect(de.boundingRadius).toBeGreaterThan(203);
    const first: Vec4 = [100, 0, 0, 20];
    expect(estimateDistance4(de, first)).toBeLessThanOrEqual(0);
    expect(estimateDistance4Refined(de, first)).toBeLessThanOrEqual(0);

    const affineFinal = map4({
      id: 2,
      position: [3, 0, 0],
      scale: [1.5, 1.5, 1.5],
      w: { position: 2, scale: 1.25 },
    });
    const affineDE = buildSurfaceDE4(transforms, affineFinal);
    const affinePoint = applyAffine4(
      composeAffine4(toTransform4(affineFinal)),
      x,
      0,
      0,
      w,
    );
    expect(Math.hypot(...affinePoint)).toBeLessThanOrEqual(
      affineDE.visibleBoundingRadius,
    );
    expect(estimateDistance4(affineDE, affinePoint)).toBeLessThanOrEqual(0);

    const foldFinal = map4({
      id: 3,
      position: [0, 0, 0],
      scale: [1, 1, 1],
      w: { position: 0, scale: 1 },
      variations: [{ type: "boxfold", weight: 1 }],
    });
    const foldDE = buildSurfaceDE4(transforms, foldFinal);
    const axis = (value: number) => 2 * clamp(value, -1, 1) - value;
    const foldedPoint: Vec4 = [axis(x), 0, 0, axis(w)];
    expect(Math.hypot(...foldedPoint)).toBeLessThanOrEqual(
      foldDE.visibleBoundingRadius,
    );
    expect(estimateDistance4(foldDE, foldedPoint)).toBeLessThanOrEqual(0);
  });

  it("evaluates pruned 4D child shapes and bounds evicted future-band subtrees", () => {
    const emitter = {
      parts: [
        {
          primitive: { kind: "sphere" as const, radius: 0.1 },
          combine: "union" as const,
        },
      ],
    };
    const duplicateMaps = Array.from({ length: 4 }, (_, id) =>
      map4({
        id,
        position: [0, 0, 0],
        scale: [0.5, 0.5, 0.5],
        w: { scale: 0.5 },
      }),
    );
    const buildAdversary = (translation: number, depth: number) =>
      buildSurfaceDE4(
        [
          ...duplicateMaps,
          map4({
            id: 4,
            position: [translation, 0, 0],
            scale: [0.5, 0.5, 0.5],
            w: { scale: 0.5 },
          }),
          map4({
            id: 5,
            position: [10, 0, 0],
            scale: [1, 1, 1],
            w: { scale: 1 },
            emitter,
          }),
        ],
        null,
        { order: 1, plane: "xz" },
        { condensationDepthBand: { minDepth: depth, maxDepth: depth } },
      );
    const immediate = buildAdversary(-5, 1);
    const future = buildAdversary(-2.49, 2);
    expect(immediate.beamWidth).toBe(4);
    expect(future.beamWidth).toBe(4);
    for (const candidate of [immediate, future]) {
      const query: Vec4 = [0.01, 0, 0, 0];
      expect(estimateDistance4(candidate, query)).toBeLessThanOrEqual(0);
      expect(estimateDistance4Refined(candidate, query)).toBeLessThanOrEqual(0);
    }
  });

  it("keeps plain and refined 4D estimates below an independent condensation cloud", () => {
    const emitter = {
      parts: [
        {
          primitive: { kind: "sphere" as const, radius: 0.3 },
          combine: "union" as const,
        },
      ],
    };
    const transforms = pentatope().map((t, i) =>
      i === 1 ? { ...t, emitter } : t,
    );
    const de = buildSurfaceDE4(transforms);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      12000,
      mulberry32(0x4c01),
    );
    const rng = mulberry32(0x4d01);
    for (let i = 0; i < 10; i++) {
      const p: Vec4 = [
        (rng() - 0.5) * 3,
        (rng() - 0.5) * 3,
        (rng() - 0.5) * 3,
        (rng() - 0.5) * 2,
      ];
      const nearest = nearestDistance4(cloud, p) + 1e-6;
      expect(estimateDistance4(de, p)).toBeLessThanOrEqual(nearest);
      expect(estimateDistance4Refined(de, p)).toBeLessThanOrEqual(nearest);
    }

    const affineFinal = map4({
      position: [0.2, -0.1, 0.1],
      scale: [1.1, 0.9, 1],
      w: { position: 0.25, scale: 1.05 },
    });
    const foldFinal = map4({
      scale: [0.7, 0.7, 0.7],
      w: { scale: 0.7 },
      variations: [{ type: "boxfold", weight: 1 }],
    });
    expect(buildSurfaceDE4(transforms, affineFinal).final).not.toBeNull();
    expect(buildSurfaceDE4(transforms, foldFinal).foldFinal).not.toBeNull();
  });

  it("folds condensation through the 4D fold frontier and keeps emitter-free builds exact", () => {
    const transforms = [
      ...pureBoxfoldPair4(),
      map4({
        id: 8,
        position: [0.6, 0, 0],
        scale: [0.3, 0.3, 0.3],
        w: { position: 0.2, scale: 0.4 },
        emitter: {
          parts: [
            {
              primitive: { kind: "sphere", radius: 0.35 },
              combine: "union",
            },
          ],
        },
      }),
    ];
    const de = buildSurfaceDE4(transforms);
    expect(de.maps).toHaveLength(2);
    const cloud = runChaosGame4(
      transforms.map(toTransform4),
      8000,
      mulberry32(0x4f01),
    );
    const p: Vec4 = [1.1, -0.3, 0.4, 0.2];
    const nearest = nearestDistance4(cloud, p) + 1e-6;
    expect(estimateDistance4(de, p)).toBeLessThanOrEqual(nearest);
    expect(estimateDistance4Refined(de, p)).toBeLessThanOrEqual(nearest);

    const base = pentatope();
    const classic = buildSurfaceDE4(base);
    const option = buildSurfaceDE4(
      base,
      null,
      { order: 1, plane: "xz" },
      {
        condensationDepthBand: { minDepth: 1, maxDepth: 1 },
      },
    );
    expect(option).toEqual(classic);
    const q: Vec4 = [0.2, -0.4, 0.7, 0.1];
    expect(estimateDistance4(option, q)).toBe(estimateDistance4(classic, q));
    expect(estimateDistance4Refined(option, q)).toBe(
      estimateDistance4Refined(classic, q),
    );

    const pruned = buildSurfaceDE4(
      [
        map4({
          position: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          w: { scale: 0.5 },
          variations: [{ type: "boxfold", weight: 0.5 }],
        }),
        map4({
          id: 1,
          position: [10, 0, 0],
          scale: [1, 1, 1],
          w: { scale: 1 },
          emitter: {
            parts: [
              {
                primitive: { kind: "sphere", radius: 0.1 },
                combine: "union",
              },
            ],
          },
        }),
      ],
      null,
      { order: 1, plane: "xz" },
      { condensationDepthBand: { minDepth: 1, maxDepth: 1 } },
    );
    const foldQuery: Vec4 = [-1.5, 0, 0, 0];
    expect(estimateDistance4(pruned, foldQuery)).toBeLessThanOrEqual(0);
    expect(estimateDistance4Refined(pruned, foldQuery)).toBeLessThanOrEqual(0);
  });

  it("applies root/depth-1/all bands in the 4D affine descent", () => {
    const emitter = {
      parts: [
        {
          primitive: { kind: "sphere" as const, radius: 0.3 },
          combine: "union" as const,
        },
      ],
    };
    const transforms = [
      map4({
        position: [0, 0, 0],
        scale: [0.5, 0.5, 0.5],
        w: { scale: 0.5 },
      }),
      map4({
        id: 1,
        position: [1, 0, 0],
        scale: [0.4, 0.4, 0.4],
        w: { scale: 0.4 },
        emitter,
      }),
    ];
    const symmetry = { order: 1, plane: "xz" as const };
    const root = buildSurfaceDE4(transforms, null, symmetry, {
      condensationDepthBand: { maxDepth: 0 },
    });
    const depth1 = buildSurfaceDE4(transforms, null, symmetry, {
      condensationDepthBand: { minDepth: 1, maxDepth: 1 },
    });
    const all = buildSurfaceDE4(transforms);
    const p: Vec4 = [0.5, 0, 0, 0];
    expect(estimateDistance4(root, p)).toBeCloseTo(0.342, 12);
    expect(estimateDistance4(depth1, p)).toBe(0);
    expect(estimateDistance4(all, p)).toBe(estimateDistance4(depth1, p));
  });
});
