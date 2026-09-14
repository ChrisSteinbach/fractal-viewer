/**
 * PROTOTYPE: the sphere-inversion SEED ORBIT, in any dimension (3 or 4), as
 * a membership oracle, a transported distance lower bound, the Bridges 2016
 * damped-derivative heuristic for comparison, and an explicit orbit
 * enumerator for sphere seeds. Harness-only by decision — no production
 * module exists until the owner's visual gate closes. The construction and
 * every argument below are written out in `docs/sphere-inversion-family.md`;
 * this header carries only what a reader of the code needs.
 *
 * THE OBJECT. Generators are closed balls `B_i = B(c_i, r_i)` with pairwise
 * disjoint interiors; `I_i(x) = c_i + r_i²(x − c_i)/|x − c_i|²`. The group
 * `G = <I_i>` has fundamental domain `F = R^n \ ∪ open B_i`. The SEED is
 * `K ∩ F` where `K` is an intersection of GENERALIZED BALLS (a ball or the
 * complement of one — the class inversion maps to itself exactly). The
 * rendered set is the DEPTH-D SEED ORBIT
 *
 *     O_D = ∪ { g(K ∩ F) : g a reduced word of length <= D }.
 *
 * It is NOT the limit set. `O_∞`'s closure accumulates on the limit set, and
 * nothing here depicts the limit set except in the loose sense that deep
 * copies shrink toward it.
 *
 * MEMBERSHIP. The Nakamura–Ahara IIS fold: while `x` lies in some open `B_i`
 * (other than the one just left) and fewer than `D` inversions have been
 * spent, invert through it. Disjoint interiors mean at most one ball holds
 * `x`, so GENERATOR ORDER IS NOT PART OF THE GEOMETRY; the lowest index wins
 * only on a tangency point. `x ∈ O_D` iff the fold reaches `F` within `D`
 * inversions and the folded point lies in `K ∩ F`.
 *
 * THE BOUND. In the folded coordinates `x` (after `k` inversions, last
 * generator `p`, remaining budget `m = D − k`) the image of `O_D` is covered
 * by `K∩F`, the one-step copies `I_j(K∩F)` and the depth-2 balls `I_j(B_l)`
 * (the tile identity `B_j = I_j(F) ∪ ∪_l I_j(B_l)`), with the depth budget
 * deciding which `j` may hold anything (`m = 0`: only the parent `p`;
 * `m = 1`: copies but no deeper balls). Exact generalized-ball SDFs give a
 * lower bound `L(x)`; an intersection's bound is the max of its members'.
 * `L` is carried back through each inversion by `inversion.ts`'s
 * `inversionDistanceLowerBound`, which for a ball is EXACT transport (the
 * doc carries the two-case algebra). Result: a CERTIFIED lower bound on the
 * Euclidean distance to `O_D`, modulo f64 rounding, for disjoint generators.
 * It stays positive on the invisible generator spheres (the depth-2 balls
 * sit strictly inside their parent ball) and degenerates at tangency
 * points and toward generator centres.
 */
import { inversionDistanceLowerBound } from "../src/fractal/inversion";

export type Dim = 3 | 4;

/** A generalized ball: `sign = +1` is the closed ball, `-1` its complement.
 * Its SDF is `sign · (|x − c| − r)`, exact in both cases. */
export interface GBall {
  c: number[];
  r: number;
  sign: 1 | -1;
}

export interface Generator {
  c: number[];
  r: number;
}

export interface InversionSceneSpec {
  dim: Dim;
  gens: Generator[];
  /** `K` as an intersection of generalized balls (at least one `+1`). */
  seed: GBall[];
  /** Inversion budget `D`. */
  depth: number;
}

export interface InversionScene extends InversionSceneSpec {
  n: number;
  gc: Float64Array;
  gr: Float64Array;
  gr2: Float64Array;
  /** `K ∩ F` as flat generalized balls (seed members then `ext(B_j)`). */
  kf: FlatBalls;
  /** Per generator `j`: `I_j(K ∩ F)` as an intersection. */
  copy: FlatBalls[];
  /** Per generator `j`: the depth-2 balls `I_j(B_l)`, `l != j`. */
  gap: FlatBalls[];
  /** Radius about the origin enclosing `O_D` for every `D`. */
  boundRadius: number;
  /** Smallest `|c_i − c_j| − r_i − r_j` (0 means a tangency). */
  minGenGap: number;
}

export interface FlatBalls {
  count: number;
  c: Float64Array;
  r: Float64Array;
  sign: Float64Array;
}

function flatten(dim: Dim, balls: GBall[]): FlatBalls {
  const c = new Float64Array(balls.length * dim);
  const r = new Float64Array(balls.length);
  const sign = new Float64Array(balls.length);
  balls.forEach((b, i) => {
    for (let a = 0; a < dim; a++) c[i * dim + a] = b.c[a];
    r[i] = b.r;
    sign[i] = b.sign;
  });
  return { count: balls.length, c, r, sign };
}

/** Image of a generalized ball under inversion through `(C, R)`. Throws on
 * the degenerate case (sphere through the centre, image a plane) — a fixture
 * must not author one. */
export function invertGBall(g: Generator, b: GBall): GBall {
  const dim = b.c.length;
  let du2 = 0;
  for (let a = 0; a < dim; a++) du2 += (b.c[a] - g.c[a]) ** 2;
  const den = du2 - b.r * b.r;
  if (Math.abs(den) < 1e-9 * Math.max(1, b.r * b.r)) {
    throw new Error("seed sphere passes through a generator centre");
  }
  const s = (g.r * g.r) / den;
  const c = b.c.map((v, a) => g.c[a] + s * (v - g.c[a]));
  return {
    c,
    r: Math.abs(s) * b.r,
    sign: (den > 0 ? b.sign : -b.sign) as 1 | -1,
  };
}

export function buildInversionScene(spec: InversionSceneSpec): InversionScene {
  const { dim, gens, seed } = spec;
  const n = gens.length;
  let minGenGap = Infinity;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let d2 = 0;
      for (let a = 0; a < dim; a++) d2 += (gens[i].c[a] - gens[j].c[a]) ** 2;
      minGenGap = Math.min(minGenGap, Math.sqrt(d2) - gens[i].r - gens[j].r);
    }
  }
  if (minGenGap < -1e-12) throw new Error("generator balls overlap");
  const ext = (g: Generator): GBall => ({ c: g.c, r: g.r, sign: -1 });
  const kfBalls: GBall[] = [...seed, ...gens.map(ext)];
  const copy: FlatBalls[] = [];
  const gap: FlatBalls[] = [];
  gens.forEach((g, j) => {
    const imgSeed = seed.map((b) => invertGBall(g, b));
    const others = gens.filter((_, l) => l !== j);
    const imgBalls = others.map((o) =>
      invertGBall(g, { c: o.c, r: o.r, sign: 1 }),
    );
    copy.push(
      flatten(dim, [
        ...imgSeed,
        { c: g.c, r: g.r, sign: 1 },
        ...imgBalls.map((b) => ({ ...b, sign: -1 as const })),
      ]),
    );
    gap.push(flatten(dim, imgBalls));
  });
  let seedBound = Infinity;
  for (const b of seed) {
    if (b.sign === 1) seedBound = Math.min(seedBound, Math.hypot(...b.c) + b.r);
  }
  if (!Number.isFinite(seedBound)) throw new Error("seed must be bounded");
  let boundRadius = seedBound;
  for (const g of gens)
    boundRadius = Math.max(boundRadius, Math.hypot(...g.c) + g.r);
  const gc = new Float64Array(n * dim);
  const gr = new Float64Array(n);
  const gr2 = new Float64Array(n);
  gens.forEach((g, i) => {
    for (let a = 0; a < dim; a++) gc[i * dim + a] = g.c[a];
    gr[i] = g.r;
    gr2[i] = g.r * g.r;
  });
  return {
    ...spec,
    n,
    gc,
    gr,
    gr2,
    kf: flatten(dim, kfBalls),
    copy,
    gap,
    boundRadius,
    minGenGap,
  };
}

/** Max of the members' SDFs: a lower bound on the intersection's distance. */
function sdfIntersection(dim: Dim, f: FlatBalls, x: Float64Array): number {
  let best = -Infinity;
  for (let i = 0; i < f.count; i++) {
    let d2 = 0;
    const o = i * dim;
    for (let a = 0; a < dim; a++) {
      const t = x[a] - f.c[o + a];
      d2 += t * t;
    }
    const v = f.sign[i] * (Math.sqrt(d2) - f.r[i]);
    if (v > best) best = v;
  }
  return best;
}

/** How a query ended: in `F`, out of budget inside a ball, or at a pole. */
export const FOLD_DOMAIN = 0;
export const FOLD_EXHAUSTED = 1;
export const FOLD_POLE = 2;

export interface FoldResult {
  x: Float64Array;
  k: number;
  parent: number;
  status: typeof FOLD_DOMAIN | typeof FOLD_EXHAUSTED | typeof FOLD_POLE;
  /** `|x_{i} − c|` before inversion `i`, for transport. */
  radii: Float64Array;
  /** `R²` of inversion `i`. */
  r2s: Float64Array;
  /** Accumulated conformal factor of the fold, `Π R²/|x − c|²` (>= 1). */
  lambda: number;
}

/** Relative floor under which a query counts as AT a generator centre. */
export const POLE_FLOOR = 1e-12;

export function makeFoldScratch(scene: InversionScene): FoldResult {
  return {
    x: new Float64Array(scene.dim),
    k: 0,
    parent: -1,
    status: FOLD_DOMAIN,
    radii: new Float64Array(scene.depth + 1),
    r2s: new Float64Array(scene.depth + 1),
    lambda: 1,
  };
}

/** The IIS fold (module doc), into caller-owned scratch. */
export function foldQuery(
  scene: InversionScene,
  p: ArrayLike<number>,
  out: FoldResult,
): FoldResult {
  const { dim, n, gc, gr2, depth } = scene;
  const x = out.x;
  for (let a = 0; a < dim; a++) x[a] = p[a];
  let k = 0;
  let parent = -1;
  let lambda = 1;
  out.status = FOLD_DOMAIN;
  for (;;) {
    let found = -1;
    let foundD2 = 0;
    for (let j = 0; j < n; j++) {
      if (j === parent) continue;
      let d2 = 0;
      const o = j * dim;
      for (let a = 0; a < dim; a++) {
        const t = x[a] - gc[o + a];
        d2 += t * t;
      }
      if (d2 < gr2[j]) {
        found = j;
        foundD2 = d2;
        break;
      }
    }
    if (found < 0) break;
    if (k === depth) {
      out.status = FOLD_EXHAUSTED;
      break;
    }
    const R2 = gr2[found];
    if (foundD2 <= POLE_FLOOR * POLE_FLOOR * R2) {
      out.status = FOLD_POLE;
      break;
    }
    const o = found * dim;
    const s = R2 / foundD2;
    for (let a = 0; a < dim; a++) x[a] = gc[o + a] + s * (x[a] - gc[o + a]);
    out.radii[k] = Math.sqrt(foundD2);
    out.r2s[k] = R2;
    lambda *= s;
    k++;
    parent = found;
  }
  out.k = k;
  out.parent = parent;
  out.lambda = lambda;
  return out;
}

/** `L(x)` in the folded coordinates (module doc's depth-budget rule). */
export function foldedLowerBound(scene: InversionScene, f: FoldResult): number {
  const { dim, n, gc, gr, depth } = scene;
  const x = f.x;
  const m = depth - f.k;
  let best = sdfIntersection(dim, scene.kf, x);
  if (best <= 0) return best;
  for (let j = 0; j < n; j++) {
    const isParent = j === f.parent;
    if (!isParent && m < 1) continue;
    let d2 = 0;
    const o = j * dim;
    for (let a = 0; a < dim; a++) {
      const t = x[a] - gc[o + a];
      d2 += t * t;
    }
    // Everything this generator's ball can hold lies inside it.
    if (Math.sqrt(d2) - gr[j] >= best) continue;
    const dc = sdfIntersection(dim, scene.copy[j], x);
    if (dc < best) best = dc;
    if (best <= 0) return best;
    if (isParent || m >= 2) {
      const g = scene.gap[j];
      for (let i = 0; i < g.count; i++) {
        let e2 = 0;
        const oo = i * dim;
        for (let a = 0; a < dim; a++) {
          const t = x[a] - g.c[oo + a];
          e2 += t * t;
        }
        const v = Math.sqrt(e2) - g.r[i];
        if (v < best) best = v;
      }
    }
  }
  return best;
}

/**
 * CERTIFIED (modulo f64) lower bound on the distance from `p` to `O_D`.
 * A pole query returns 0, a member returns a value <= 0.
 */
export function estimateInversionDistance(
  scene: InversionScene,
  p: ArrayLike<number>,
  scratch: FoldResult = makeFoldScratch(scene),
): number {
  const f = foldQuery(scene, p, scratch);
  if (f.status === FOLD_POLE) return 0;
  let d = foldedLowerBound(scene, f);
  if (d <= 0) return d;
  for (let i = f.k - 1; i >= 0; i--) {
    d = inversionDistanceLowerBound(f.radii[i], f.r2s[i], d);
  }
  return d;
}

/**
 * The Bridges 2016 Algorithm 2 shape, generalized to this seed: the own
 * copy's SDF in folded coordinates divided by the accumulated derivative,
 * times an empirical `factor` (the paper's example needs "less than 0.08").
 * A HEURISTIC — it sees only the query's own tile, so it can overshoot
 * into a neighbouring copy; kept to measure exactly that.
 */
export function estimateInversionDistancePaper(
  scene: InversionScene,
  p: ArrayLike<number>,
  factor: number,
  scratch: FoldResult = makeFoldScratch(scene),
): number {
  const f = foldQuery(scene, p, scratch);
  if (f.status === FOLD_POLE) return 0;
  return (factor * sdfIntersection(scene.dim, scene.kf, f.x)) / f.lambda;
}

/** MEMBERSHIP in `O_D` — the fold, then the seed test. Never a threshold on
 * a distance. */
export function inversionOrbitContains(
  scene: InversionScene,
  p: ArrayLike<number>,
  scratch: FoldResult = makeFoldScratch(scene),
): boolean {
  const f = foldQuery(scene, p, scratch);
  if (f.status !== FOLD_DOMAIN) return false;
  return sdfIntersection(scene.dim, scene.kf, f.x) <= 0;
}

/**
 * EXPLICIT ORBIT (sphere seeds only): every copy `g(K)` for reduced words of
 * length <= D, as exact spheres. Words are built outermost-last:
 * `I_j(S)` for each copy `S` whose outermost letter is not `j`, which keeps
 * `c_j` outside `S` (S lies in another generator's ball, or is `K ⊂ F`).
 * The reference `min |p − c| − r` is the EXACT distance to `O_D`.
 */
export function enumerateSphereOrbit(scene: InversionScene): FlatBalls {
  const { dim, gens, seed, depth } = scene;
  if (seed.length !== 1 || seed[0].sign !== 1) {
    throw new Error("explicit orbit needs a single ball seed");
  }
  const k0 = seed[0];
  for (const g of gens) {
    const d = Math.hypot(...k0.c.map((v, a) => v - g.c[a]));
    if (d < k0.r + g.r) throw new Error("ball seed must lie in F");
  }
  const out: GBall[] = [k0];
  let level: { b: GBall; last: number }[] = [{ b: k0, last: -1 }];
  for (let lvl = 1; lvl <= depth; lvl++) {
    const next: { b: GBall; last: number }[] = [];
    for (const { b, last } of level) {
      gens.forEach((g, j) => {
        if (j === last) return;
        const img = invertGBall(g, b);
        next.push({ b: img, last: j });
        out.push(img);
      });
    }
    level = next;
  }
  return flatten(dim, out);
}

export function explicitOrbitDistance(
  dim: Dim,
  orbit: FlatBalls,
  p: ArrayLike<number>,
): number {
  let best = Infinity;
  for (let i = 0; i < orbit.count; i++) {
    let d2 = 0;
    const o = i * dim;
    for (let a = 0; a < dim; a++) {
      const t = p[a] - orbit.c[o + a];
      d2 += t * t;
    }
    const v = Math.sqrt(d2) - orbit.r[i];
    if (v < best) best = v;
  }
  return best;
}

// ------------------------------------------------------------ arrangements

const PHI = (1 + Math.sqrt(5)) / 2;

function pad(v: number[], dim: Dim): number[] {
  return dim === 4 && v.length === 3 ? [...v, 0] : v;
}

/** Six generators on the coordinate axes of xyz (`dim = 4` embeds FLAT,
 * every centre at `w = 0`). Tangent at `r = d/√2`. */
export function octahedral6(d: number, r: number, dim: Dim = 3): Generator[] {
  const out: Generator[] = [];
  for (let a = 0; a < 3; a++) {
    for (const s of [1, -1]) {
      const c = [0, 0, 0];
      c[a] = s * d;
      out.push({ c: pad(c, dim), r });
    }
  }
  return out;
}

/** Eight generators on cube vertices at distance `d`. Tangent at `d/√3`. */
export function cube8(d: number, r: number): Generator[] {
  const out: Generator[] = [];
  const k = d / Math.sqrt(3);
  for (const x of [1, -1]) {
    for (const y of [1, -1]) {
      for (const z of [1, -1]) out.push({ c: [x * k, y * k, z * k], r });
    }
  }
  return out;
}

/** Twelve generators on icosahedron vertices at distance `d`. Tangent at
 * `0.5257·d`. */
export function icosahedral12(d: number, r: number): Generator[] {
  const k = d / Math.hypot(1, PHI);
  const out: Generator[] = [];
  for (const a of [1, -1]) {
    for (const b of [1, -1]) {
      out.push({ c: [0, a * k, b * PHI * k], r });
      out.push({ c: [a * k, b * PHI * k, 0], r });
      out.push({ c: [b * PHI * k, 0, a * k], r });
    }
  }
  return out;
}

/** 4D: eight hyperspheres on the 16-cell's vertices `±d·e_k`, k = x,y,z,w.
 * Tangent at `d/√2`. Its `w = 0` slice meets only the six xyz generators. */
export function cross8(d: number, r: number): Generator[] {
  const out: Generator[] = [];
  for (let a = 0; a < 4; a++) {
    for (const s of [1, -1]) {
      const c = [0, 0, 0, 0];
      c[a] = s * d;
      out.push({ c, r });
    }
  }
  return out;
}

/** 4D: twenty-four hyperspheres on the 24-cell's vertices, the permutations
 * of `(±1, ±1, 0, 0)·d/√2`. Tangent at `d/2`. Twelve centres lie at `w = 0`
 * (a cuboctahedron) and twelve at `w = ±d/√2`, whose images reach the
 * `w = 0` slice only through the first twelve's inversions. */
export function cell24(d: number, r: number): Generator[] {
  const out: Generator[] = [];
  const k = d / Math.SQRT2;
  for (let a = 0; a < 4; a++) {
    for (let b = a + 1; b < 4; b++) {
      for (const sa of [1, -1]) {
        for (const sb of [1, -1]) {
          const c = [0, 0, 0, 0];
          c[a] = sa * k;
          c[b] = sb * k;
          out.push({ c, r });
        }
      }
    }
  }
  return out;
}

/** 4D: sixteen hyperspheres on the tesseract's vertices `(±1,±1,±1,±1)·d/2`.
 * Tangent at `d/2`. No centre lies in `w = 0`. */
export function tesseract16(d: number, r: number): Generator[] {
  const out: Generator[] = [];
  const k = d / 2;
  for (let m = 0; m < 16; m++) {
    out.push({
      c: [0, 1, 2, 3].map((a) => ((m >> a) & 1 ? k : -k)),
      r,
    });
  }
  return out;
}

/** Seeds. `ball`: `B(0, ρ)`. `shell`: `ρ − τ <= |x| <= ρ + τ`. `cap`: the
 * fundamental domain capped by `B(0, ρ)` (the implicit `∩ F` does the rest). */
export function ballSeed(rho: number, dim: Dim): GBall[] {
  return [{ c: new Array(dim).fill(0), r: rho, sign: 1 }];
}
export function shellSeed(rho: number, tau: number, dim: Dim): GBall[] {
  const o = new Array(dim).fill(0);
  return [
    { c: o, r: rho + tau, sign: 1 },
    { c: o, r: rho - tau, sign: -1 },
  ];
}
export const capSeed = ballSeed;
