/**
 * The sphere-inversion family's POINTS representation: an EXACT boundary
 * sampler of the depth-D seed orbit `O_D` (`sphere-inversion.ts`'s object),
 * in 3D and native 4D. Every emitted point lies on `∂O_D` up to f64 rounding;
 * the DENSITY over that boundary is a stated choice, the SET is not. A random
 * orbit that drew a different set would not be this subject, which is why
 * the chaos game never runs for a document carrying the block.
 *
 * ONE MODULE FOR BOTH DIMENSIONS, like `sphere-inversion-oracle.ts`: the
 * arithmetic is a loop over `dim` rather than unrolled twins, because a
 * sample's cost is dominated by the per-generator scans (measured in
 * `docs/sphere-inversion-family.md`, not by vector width.
 *
 * THE BOUNDARY OF THE SEED PIECE `P0 = K ∩ F` is a union of PATCHES, each on
 * one sphere:
 *   - a SEED patch on a seed member's sphere, where every other seed member
 *     and every generator complement holds;
 *   - a WALL patch on a generator sphere `S_m`, where every seed member and
 *     every other generator complement holds.
 * Each patch is sampled EXACTLY: a uniform point on the spherical cap the
 * smallest bounded seed member cuts from the patch's sphere (every feasible
 * point lies in that ball), rejected against the patch's constraint list. The
 * cap's polar coordinate has density `∝ (1 − t²)^((n−3)/2)` — uniform in 3D,
 * `√(1 − t²)` in 4D, drawn by bounded rejection under its maximum on the
 * cap — and its tangential direction is a normalized Gaussian with the axis
 * projected out. A constraint list keeps only the generators whose open ball
 * meets both the patch's sphere and the bounding ball; the others cannot
 * exclude a cap point.
 *
 * WORDS. Inversion maps a generalized ball's sphere to a sphere exactly, so a
 * boundary point `x` of `P0` carried through a reduced word `g` of length
 * `k <= D` lies on `∂g(P0)`. Whether it lies on `∂O_D` is the one question the
 * union adds, and it has an exact answer, because pieces of distinct tiles
 * meet only on generator-sphere images:
 *   - a SEED patch point sits inside its tile, so `g(x) ∈ ∂O_D` for every `g`;
 *   - a WALL point on `S_m` is shared with the neighbouring piece
 *     `g∘I_m(P0)`. That neighbour is in `O_D` unless its reduced length
 *     exceeds `D`, so the wall is EXPOSED exactly when `k = D` and the first
 *     inversion applied is not `m`. Every other wall sample would draw an
 *     internal membrane across a window (all its points are members — a
 *     distance test cannot see it; the tests' two-sided check does).
 *
 * THE DISTRIBUTION (the choice, stated). The seed patch is picked with
 * probability `∝ capArea · acceptance · exposure`, where the acceptance is the
 * patch's pilot rejection rate (so `capArea · acceptance` estimates the patch
 * area) and the exposure is 1 for a seed patch. A seed-patch word is then a
 * STOP-OR-BRANCH walk evaluated at the sample's own position `y`: each
 * inversion `j` (not the one just applied) has the local area factor
 * `f_j = (r_j²/|y − c_j|²)^(n−1)` of the copy it would enter; the walk stops
 * with probability `1/(1 + Σf)` and otherwise inverts through `j` with
 * probability `f_j/Σf`, while fewer than `D` inversions are spent. Through
 * depth 1 that is area-proportional, so the dominant copies are not starved;
 * each deeper level ignores its own subtree's mass, which under-weights the
 * deep copies geometrically, so sub-pixel dust is not over-sampled. A wall
 * patch must reach depth `D`, so its walk is FORCED (branch `∝ f_j`, never
 * stop, first letter `≠ m`), and its selection weight carries the pilot's
 * mean product of the unforced walk's continue probabilities `Σf/(1 + Σf)`
 * along forced walks — an approximation of the unforced walk's chance of
 * exposing that wall, so walls get about the share rejection would give them
 * without the rejection's wasted draws.
 *
 * BOUNDED. A draw spends at most {@link SPHERE_INVERSION_SAMPLE_CAP_ATTEMPTS}
 * cap samples and a point at most {@link SPHERE_INVERSION_SAMPLE_DRAWS}
 * draws; a point that exhausts them is SKIPPED (the cloud's `count` then
 * falls short of the request, and `draws` reports the spend). A patch whose
 * pilot accepted nothing gets weight 0: a patch smaller than about
 * `1/SPHERE_INVERSION_SAMPLE_PILOT` of its cap can be missed. That drops
 * points from a sliver of the boundary; it never adds a point off the set.
 *
 * DETERMINISM. The pilot runs on its own fixed-seed stream, so the patch
 * weights are a pure function of the construction and the caller's `rng`
 * alone decides the cloud.
 */
import { mulberry32 } from "./rng";
import type { Rng } from "./rng";
import type { SphereInversionConstruction } from "./sphere-inversion";

/** Cap samples per patch in the pilot that estimates each patch's area. */
export const SPHERE_INVERSION_SAMPLE_PILOT = 2048;
/** Forced walks per wall patch in the pilot's exposure estimate. */
export const SPHERE_INVERSION_SAMPLE_PILOT_WALKS = 64;
/** Cap samples one draw may reject before it gives up. */
export const SPHERE_INVERSION_SAMPLE_CAP_ATTEMPTS = 1024;
/** Draws one point may spend before it is skipped. */
export const SPHERE_INVERSION_SAMPLE_DRAWS = 8;

const PILOT_SEED = 0x5eed1a7e;

export type SphereInversionPatchKind = "seed" | "wall";

/** One boundary patch of the seed piece `K ∩ F` (module doc). */
export interface SphereInversionSeedPatch {
  kind: SphereInversionPatchKind;
  /** Seed-member index (`seed`) or generator index (`wall`). */
  member: number;
  center: Float64Array;
  radius: number;
  /** Cap axis (unit, from the sphere's centre toward the bounding ball's),
   * or `null` for the whole sphere. */
  axis: Float64Array | null;
  /** Cap polar threshold: cap points satisfy `v · axis >= t0`. */
  t0: number;
  constraintCount: number;
  constraintCenter: Float64Array;
  constraintRadius2: Float64Array;
  /** 1: the point must lie in the closed ball; 0: outside the open ball. */
  constraintInside: Uint8Array;
  /** Measure of the cap on the patch's sphere. */
  capArea: number;
  /** Pilot acceptance rate of cap samples. */
  acceptance: number;
  /** 1 for a seed patch; the pilot's exposure estimate for a wall. */
  exposure: number;
  weight: number;
}

/** A prepared sampler: patches, their cumulative weights and scratch. Single
 * threaded and non-reentrant, like the estimators. */
export interface SphereInversionSampler {
  construction: SphereInversionConstruction;
  dim: 3 | 4;
  depth: number;
  generatorCount: number;
  generatorCenter: Float64Array;
  generatorRadius2: Float64Array;
  patches: SphereInversionSeedPatch[];
  cumulative: Float64Array;
  totalWeight: number;
  /** Per-generator area-factor scratch. */
  factors: Float64Array;
  /** Vector scratch. */
  scratch: Float64Array;
}

/** Where one sample came from — the tests' provenance. */
export interface SphereInversionSampleDetail {
  patch: number;
  /** The boundary point of `K ∩ F` before any inversion. */
  seedPoint: number[];
  /** The outward unit normal of the patch's sphere at `seedPoint`. */
  seedNormal: number[];
  /** Generators in the order they were APPLIED (innermost letter first). */
  word: number[];
}

function capAreaOf(dim: 3 | 4, r: number, t0: number): number {
  if (dim === 3) return 2 * Math.PI * r * r * (1 - t0);
  const t = Math.max(-1, Math.min(1, t0));
  return 2 * Math.PI * r * r * r * (Math.acos(t) - t * Math.sqrt(1 - t * t));
}

function gaussian(rng: Rng): number {
  const u = 1 - rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** A uniform point on the patch's cap, written to `out`. False only when the
 * bounded direction or polar draws all degenerate (never in practice). */
function sampleCapPoint(
  dim: 3 | 4,
  patch: SphereInversionSeedPatch,
  rng: Rng,
  out: Float64Array,
  scratch: Float64Array,
): boolean {
  const { center, radius, axis, t0 } = patch;
  for (let tries = 0; tries < 16; tries++) {
    let len2 = 0;
    for (let a = 0; a < dim; a++) {
      scratch[a] = gaussian(rng);
    }
    if (axis !== null) {
      let dot = 0;
      for (let a = 0; a < dim; a++) dot += scratch[a] * axis[a];
      for (let a = 0; a < dim; a++) scratch[a] -= dot * axis[a];
    }
    for (let a = 0; a < dim; a++) len2 += scratch[a] * scratch[a];
    if (!(len2 > 1e-18)) continue;
    const inv = 1 / Math.sqrt(len2);
    if (axis === null) {
      for (let a = 0; a < dim; a++) {
        out[a] = center[a] + radius * scratch[a] * inv;
      }
      return true;
    }
    let t = 0;
    let ok = dim === 3;
    if (dim === 3) {
      t = t0 + (1 - t0) * rng();
    } else {
      const envelope = t0 <= 0 ? 1 : Math.sqrt(1 - t0 * t0);
      for (let k = 0; k < 64; k++) {
        t = t0 + (1 - t0) * rng();
        if (rng() * envelope <= Math.sqrt(Math.max(0, 1 - t * t))) {
          ok = true;
          break;
        }
      }
    }
    if (!ok) continue;
    const s = Math.sqrt(Math.max(0, 1 - t * t)) * inv;
    for (let a = 0; a < dim; a++) {
      out[a] = center[a] + radius * (t * axis[a] + s * scratch[a]);
    }
    return true;
  }
  return false;
}

function feasible(
  dim: 3 | 4,
  patch: SphereInversionSeedPatch,
  x: Float64Array,
): boolean {
  const cc = patch.constraintCenter;
  for (let i = 0; i < patch.constraintCount; i++) {
    const o = i * dim;
    let d2 = 0;
    for (let a = 0; a < dim; a++) {
      const v = x[a] - cc[o + a];
      d2 += v * v;
    }
    if (patch.constraintInside[i] === 1) {
      if (d2 > patch.constraintRadius2[i]) return false;
    } else if (d2 < patch.constraintRadius2[i]) {
      return false;
    }
  }
  return true;
}

/** Fill `sampler.factors` for the candidates at `y` and return their sum.
 * `last` is excluded (reduced words); `forbid` too, when `k = 0`. */
function areaFactors(
  sampler: SphereInversionSampler,
  y: Float64Array,
  last: number,
  forbid: number,
): number {
  const { dim, generatorCount: n, generatorCenter: gc } = sampler;
  const f = sampler.factors;
  let sum = 0;
  for (let j = 0; j < n; j++) {
    if (j === last || j === forbid) {
      f[j] = 0;
      continue;
    }
    const o = j * dim;
    let d2 = 0;
    for (let a = 0; a < dim; a++) {
      const v = y[a] - gc[o + a];
      d2 += v * v;
    }
    const lambda = sampler.generatorRadius2[j] / d2;
    const area = dim === 3 ? lambda * lambda : lambda * lambda * lambda;
    f[j] = area;
    sum += area;
  }
  return sum;
}

function pickFactor(sampler: SphereInversionSampler, sum: number, rng: Rng) {
  const f = sampler.factors;
  let u = rng() * sum;
  let pick = -1;
  for (let j = 0; j < sampler.generatorCount; j++) {
    if (f[j] <= 0) continue;
    pick = j;
    u -= f[j];
    if (u < 0) break;
  }
  return pick;
}

function invertInPlace(
  sampler: SphereInversionSampler,
  j: number,
  y: Float64Array,
): void {
  const { dim, generatorCenter: gc } = sampler;
  const o = j * dim;
  let d2 = 0;
  for (let a = 0; a < dim; a++) {
    const v = y[a] - gc[o + a];
    d2 += v * v;
  }
  const s = sampler.generatorRadius2[j] / d2;
  for (let a = 0; a < dim; a++) {
    y[a] = gc[o + a] + s * (y[a] - gc[o + a]);
  }
}

/**
 * Carry `y` through a random reduced word (module doc) and return its length,
 * or −1 when a forced walk cannot continue. `forbid` is the wall's generator
 * (never the first letter), −1 for a seed patch.
 */
function walk(
  sampler: SphereInversionSampler,
  y: Float64Array,
  forced: boolean,
  forbid: number,
  rng: Rng,
  word: number[] | null,
): number {
  let last = -1;
  let k = 0;
  while (k < sampler.depth) {
    const sum = areaFactors(sampler, y, last, k === 0 ? forbid : -1);
    if (!forced && rng() * (1 + sum) < 1) break;
    if (!(sum > 0)) return forced ? -1 : k;
    const j = pickFactor(sampler, sum, rng);
    invertInPlace(sampler, j, y);
    word?.push(j);
    last = j;
    k++;
  }
  return k;
}

/** The pilot's exposure term for one wall point: the product of the unforced
 * walk's continue probabilities along one forced walk. */
function forcedExposure(
  sampler: SphereInversionSampler,
  x: Float64Array,
  forbid: number,
  rng: Rng,
): number {
  const y = Float64Array.from(x);
  let last = -1;
  let cont = 1;
  for (let k = 0; k < sampler.depth; k++) {
    const sum = areaFactors(sampler, y, last, k === 0 ? forbid : -1);
    if (!(sum > 0)) return 0;
    cont *= sum / (1 + sum);
    const j = pickFactor(sampler, sum, rng);
    invertInPlace(sampler, j, y);
    last = j;
  }
  return cont;
}

/**
 * Prepare the boundary sampler for a resolved construction (module doc):
 * enumerate the seed piece's patches, bound each by the smallest bounded seed
 * member's cap, and weight them by a fixed-seed pilot.
 */
export function prepareSphereInversionSampler(
  construction: SphereInversionConstruction,
): SphereInversionSampler {
  const { dim, generators, seed, depth } = construction;
  const n = generators.length;
  const generatorCenter = new Float64Array(n * dim);
  const generatorRadius2 = new Float64Array(n);
  generators.forEach((g, j) => {
    for (let a = 0; a < dim; a++) generatorCenter[j * dim + a] = g.center[a];
    generatorRadius2[j] = g.radius * g.radius;
  });
  const sampler: SphereInversionSampler = {
    construction,
    dim,
    depth,
    generatorCount: n,
    generatorCenter,
    generatorRadius2,
    patches: [],
    cumulative: new Float64Array(0),
    totalWeight: 0,
    factors: new Float64Array(n),
    scratch: new Float64Array(dim),
  };
  const bounded = seed.filter((m) => !m.complement);
  if (bounded.length === 0) return sampler;
  const bound = bounded.reduce((a, b) => (b.radius < a.radius ? b : a));
  const dist = (a: readonly number[], b: ArrayLike<number>) => {
    let s = 0;
    for (let i = 0; i < dim; i++) s += (a[i] - b[i]) ** 2;
    return Math.sqrt(s);
  };

  const candidates: {
    kind: SphereInversionPatchKind;
    member: number;
    center: readonly number[];
    radius: number;
  }[] = [
    ...seed.map((m, i) => ({
      kind: "seed" as const,
      member: i,
      center: m.center,
      radius: m.radius,
    })),
    ...generators.map((g, j) => ({
      kind: "wall" as const,
      member: j,
      center: g.center,
      radius: g.radius,
    })),
  ];
  const pilotRng = mulberry32(PILOT_SEED);
  const point = new Float64Array(dim);
  for (const cand of candidates) {
    const { center, radius: r } = cand;
    let axis: Float64Array | null = null;
    let t0 = -1;
    if (!(cand.kind === "seed" && seed[cand.member] === bound)) {
      const d = dist(bound.center, center);
      const rb = bound.radius;
      if (d >= r + rb) continue;
      if (d + rb <= r) continue;
      if (d + r > rb) {
        axis = new Float64Array(dim);
        for (let a = 0; a < dim; a++) {
          axis[a] = (bound.center[a] - center[a]) / d;
        }
        t0 = Math.max(-1, Math.min(1, (r * r + d * d - rb * rb) / (2 * r * d)));
      }
    }
    const cCenter: number[] = [];
    const cRadius2: number[] = [];
    const cInside: number[] = [];
    seed.forEach((m, i) => {
      if (cand.kind === "seed" && i === cand.member) return;
      cCenter.push(...m.center);
      cRadius2.push(m.radius * m.radius);
      cInside.push(m.complement ? 0 : 1);
    });
    generators.forEach((g, j) => {
      if (cand.kind === "wall" && j === cand.member) return;
      const meetsSphere = Math.abs(dist(g.center, center) - r) < g.radius;
      const meetsBound = dist(g.center, bound.center) < bound.radius + g.radius;
      if (!meetsSphere || !meetsBound) return;
      cCenter.push(...g.center);
      cRadius2.push(g.radius * g.radius);
      cInside.push(0);
    });
    const patch: SphereInversionSeedPatch = {
      kind: cand.kind,
      member: cand.member,
      center: Float64Array.from(center),
      radius: r,
      axis,
      t0,
      constraintCount: cRadius2.length,
      constraintCenter: Float64Array.from(cCenter),
      constraintRadius2: Float64Array.from(cRadius2),
      constraintInside: Uint8Array.from(cInside),
      capArea: capAreaOf(dim, r, t0),
      acceptance: 0,
      exposure: 1,
      weight: 0,
    };
    let accepted = 0;
    const walls: Float64Array[] = [];
    for (let s = 0; s < SPHERE_INVERSION_SAMPLE_PILOT; s++) {
      if (!sampleCapPoint(dim, patch, pilotRng, point, sampler.scratch)) {
        continue;
      }
      if (!feasible(dim, patch, point)) continue;
      accepted++;
      if (
        cand.kind === "wall" &&
        walls.length < SPHERE_INVERSION_SAMPLE_PILOT_WALKS
      ) {
        walls.push(Float64Array.from(point));
      }
    }
    patch.acceptance = accepted / SPHERE_INVERSION_SAMPLE_PILOT;
    if (cand.kind === "wall" && depth > 0 && walls.length > 0) {
      let sum = 0;
      for (const x of walls) {
        sum += forcedExposure(sampler, x, cand.member, pilotRng);
      }
      patch.exposure = sum / walls.length;
    }
    patch.weight = patch.capArea * patch.acceptance * patch.exposure;
    if (patch.weight > 0) sampler.patches.push(patch);
  }
  const cumulative = new Float64Array(sampler.patches.length);
  let total = 0;
  sampler.patches.forEach((p, i) => {
    total += p.weight;
    cumulative[i] = total;
  });
  sampler.cumulative = cumulative;
  sampler.totalWeight = total;
  return sampler;
}

/**
 * Draw one boundary point of `O_D` into `out` (length `dim`) and return its
 * GENERATION — the reduced word length — or −1 when the point's bounded
 * budget ran out (module doc). `detail`, when given, receives its provenance.
 */
export function sampleSphereInversionPoint(
  sampler: SphereInversionSampler,
  rng: Rng,
  out: Float64Array,
  detail?: SphereInversionSampleDetail,
): number {
  const { dim, patches, cumulative, totalWeight } = sampler;
  if (!(totalWeight > 0)) return -1;
  for (let draw = 0; draw < SPHERE_INVERSION_SAMPLE_DRAWS; draw++) {
    const u = rng() * totalWeight;
    let index = 0;
    while (index < patches.length - 1 && cumulative[index] <= u) index++;
    const patch = patches[index];
    let found = false;
    for (let a = 0; a < SPHERE_INVERSION_SAMPLE_CAP_ATTEMPTS; a++) {
      if (!sampleCapPoint(dim, patch, rng, out, sampler.scratch)) continue;
      if (feasible(dim, patch, out)) {
        found = true;
        break;
      }
    }
    if (!found) continue;
    let seedPoint: number[] | null = null;
    if (detail) seedPoint = Array.from(out);
    const word: number[] | null = detail ? [] : null;
    const wall = patch.kind === "wall";
    const k = walk(sampler, out, wall, wall ? patch.member : -1, rng, word);
    if (k < 0) continue;
    if (detail && seedPoint && word) {
      detail.patch = index;
      detail.seedPoint = seedPoint;
      detail.seedNormal = seedPoint.map(
        (v, a) => (v - patch.center[a]) / patch.radius,
      );
      detail.word = word;
    }
    return k;
  }
  return -1;
}

/** A sampled cloud: xyz positions (and `w` in 4D) as the explorer uploads
 * them, with each point's generation. */
export interface SphereInversionCloud {
  positions: Float32Array;
  /** The fourth coordinate per point in 4D; `null` in 3D. */
  w: Float32Array | null;
  generations: Uint8Array;
  count: number;
  /** Points requested. */
  requested: number;
}

/**
 * Sample `numPoints` boundary points (module doc). Points whose bounded budget
 * runs out are skipped, so `count <= numPoints`; the arrays are exactly
 * `count` long.
 */
export function sampleSphereInversionCloud(
  sampler: SphereInversionSampler,
  numPoints: number,
  rng: Rng,
): SphereInversionCloud {
  const { dim } = sampler;
  const requested = Math.max(0, Math.floor(numPoints));
  const positions = new Float32Array(requested * 3);
  const w = dim === 4 ? new Float32Array(requested) : null;
  const generations = new Uint8Array(requested);
  const point = new Float64Array(dim);
  let count = 0;
  for (let i = 0; i < requested; i++) {
    const k = sampleSphereInversionPoint(sampler, rng, point);
    if (k < 0) {
      if (!(sampler.totalWeight > 0)) break;
      continue;
    }
    positions[count * 3] = point[0];
    positions[count * 3 + 1] = point[1];
    positions[count * 3 + 2] = point[2];
    if (w) w[count] = point[3];
    generations[count] = k;
    count++;
  }
  if (count === requested) {
    return { positions, w, generations, count, requested };
  }
  return {
    positions: positions.slice(0, count * 3),
    w: w ? w.slice(0, count) : null,
    generations: generations.slice(0, count),
    count,
    requested,
  };
}

/** Apply `word` (innermost letter first) to `x`: the tests' way to carry an
 * offset seed point through a sample's own word. */
export function applySphereInversionWord(
  sampler: SphereInversionSampler,
  word: readonly number[],
  x: readonly number[],
): number[] {
  const y = Float64Array.from(x);
  for (const j of word) invertInPlace(sampler, j, y);
  return Array.from(y);
}
