/**
 * PROTOTYPE: sphairahedral limit sets — the Ahara–Nakamura construction
 * (inversion in INTERSECTING spheres at dihedral angles π/n), the Iterated
 * Inversion System (IIS) fold and the author-form distance estimate, in 3D
 * and 4D. Harness-only by decision: no production module exists until the
 * owner's visual gate closes. Every formula traces to Nakamura & Ahara,
 * Bridges 2018 (families), the 2020 preprint "Polyhedra with Spherical
 * Faces and Four-Dimensional Kleinian Groups" (Lemmas 3.3/3.5/3.6, Thm 4.3,
 * the appendix regions) and the JMA 2021 paper (the IIS algorithm). The
 * reference implementation (soma-arc/SphairahedronExperiment, GPL-3) was
 * read for STRUCTURE; the parameter regions used here are derived from the
 * preprint's appendix, and the reference's r/center formulas were used only
 * to validate the derivations (the harness re-checks every construction
 * against Lemmas 3.3/3.5 numerically instead of trusting either source).
 *
 * THE CONSTRUCTION. A wall system is 3 planes through the height axis; in
 * cross-section (x, z) they bound a triangle whose corner angles are the
 * wall-wall dihedral angles. Excavation balls sit at the corners: ball b's
 * ideal vertex is the corner point at the ball's own height (Lemma 3.3(1);
 * the ball is tangent to the vertical corner line there, Lemma 3.3(2)), and
 * its center sits at distance r_b along the direction making angle
 * θ_{b,wall} with that wall's solid-side normal (Lemma 3.3(3)). Radii solve
 * the Lemma 3.5 tangency equations — one per ball pair sharing a wall,
 * LINEAR in the radii — so the solver is exact elimination, no iteration.
 * The tile is the prism ∧ the divide plane (through the corner vertices)
 * minus the balls. A finite sphairahedron is the image of an infinite one
 * under one more inversion sphere (the free parameter that shapes the
 * quasi-sphere); every face maps to a sphere and each image's solid side is
 * fixed by mapping a probe point known to lie in the tile.
 *
 * THE OBJECT IS THE LIMIT SET Λ = ∂(∪ tiles) of G = ⟨face involutions⟩,
 * rendered through the author's IIS fold + sphere tracing: per query, fold
 * into the fundamental domain by inverting through any face sphere holding
 * the point and reflecting across any violated wall (scan order: balls then
 * walls, pass-restart — the reference implementation's order, which is part
 * of the algorithm once faces intersect), accumulate the conformal Jacobian
 * dr = Π R²/|p−c|² over the inversions, and return
 * tileSDF(folded)/|dr|·fudge. Positive outside the union of tiles, negative
 * inside; the zero set is the rendered surface. This is the KIFS heuristic
 * shape, NOT a certified bound — no disjointness, no covering argument.
 * The fold, the inversion algebra and the estimators are dimension-free
 * (n = 3 or 4); the 4D stance panel rides that with the tetra lift, whose
 * limit set is the image of an invariant hyperplane — an analytic sphere
 * once finite. Discreteness for a 4D cell is NOT claimed: the preprint's
 * own 4D classification is open.
 */
export type Dim = 3 | 4;

export interface HSphere {
  c: number[];
  r: number;
}

/** Half-space boundary `n·p = h`; the REMOVED side is `n·p > h`. */
export interface HPlane {
  n: number[];
  h: number;
}

export type HFace =
  { kind: "sphere"; sphere: HSphere } | { kind: "plane"; plane: HPlane };

/** One max-form term of a tile piece; the solid is where the SDF <= 0.
 * Sphere: `inside` = the solid includes the ball's interior (SDF
 * `dist − r`), else the solid excludes it (SDF `r − dist` — the reference's
 * `max(−DistSphere, d)` form). Plane: `above` = the solid side is
 * `n·p > h` (SDF `h − n·p`), else `n·p < h` (SDF `n·p − h`). */
export type Term =
  | { kind: "sphere"; c: number[]; r: number; inside: boolean }
  | { kind: "plane"; n: number[]; h: number; above: boolean };

export interface TilePiece {
  terms: Term[];
}

export interface VertInfo {
  p: number[];
  /** Indices into the combined face list (balls first, then walls). */
  faces: number[];
}

export interface SphScene {
  dim: Dim;
  kind: string;
  params: string;
  /** Fold generators in SCAN ORDER (balls then walls for the infinite
   * types; the reference's interleaved order for finite ones). A face whose
   * solid side is the sphere's INTERIOR inverts when the point is OUTSIDE
   * it; the flag names where the solid is. */
  foldFaces: { face: HFace; solidInside: boolean }[];
  pieces: TilePiece[];
  /** Combined face list for vertex bookkeeping: balls then walls. */
  faces: HFace[];
  vertices: VertInfo[];
  /** A point strictly inside the fundamental tile. */
  probe: number[];
  /** The tile's divide plane (the smooth carrier of the quasi-sphere). */
  divide: HPlane;
  /** Framing ball. Finite scenes: the convex sphere; infinite ones: a
   * generous ball the caller turns into a march interval. */
  bound: { center: number[]; radius: number };
  /** Maximum vertex balls (Thm 4.3) for the orbit-of-balls view. */
  seeds: HSphere[];
  foldCap: number;
}

export interface VerifyReport {
  problems: string[];
  maxTangentErr: number;
  maxAngleErr: number;
  /** Wall indices each ball actually crosses (beyond its corner pair). */
  extraCrossings: Record<string, number[]>;
}

// ---------------------------------------------------------------- vector ops

function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function norm(a: number[]): number {
  return Math.sqrt(dot(a, a));
}

function dist(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

function cross3(a: number[], b: number[]): number[] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/** The inversion `I(x) = c + R²(x−c)/|x−c|²` in the sphere `j`. */
export function invertPoint(j: HSphere, p: number[]): number[] {
  const d2 = dist(p, j.c) ** 2;
  const k = (j.r * j.r) / d2;
  return j.c.map((v, i) => v + k * (p[i] - v));
}

export type HImage =
  { kind: "sphere"; sphere: HSphere } | { kind: "plane"; plane: HPlane };

/** Image of a sphere: a sphere, or a plane when the surface passes through
 * the inversion center. */
export function invertSphere(j: HSphere, s: HSphere): HImage {
  const dc: number[] = s.c.map((v, i) => v - j.c[i]);
  const d2 = dot(dc, dc);
  const den = d2 - s.r * s.r;
  if (Math.abs(den) < 1e-9 * Math.max(1, d2)) {
    const len = Math.sqrt(d2);
    const n = dc.map((v) => v / len);
    return {
      kind: "plane",
      plane: { n, h: dot(j.c, n) + (j.r * j.r) / (2 * len) },
    };
  }
  const k = (j.r * j.r) / den;
  return {
    kind: "sphere",
    sphere: { c: j.c.map((v, i) => v + k * dc[i]), r: Math.abs(k) * s.r },
  };
}

/** Image of a plane: a sphere through the inversion center, or the plane
 * itself when the center lies on it. */
export function invertPlane(j: HSphere, pl: HPlane): HImage {
  const d = dot(pl.n, j.c) - pl.h;
  if (Math.abs(d) < 1e-12 * Math.max(1, j.r)) {
    return { kind: "plane", plane: { n: [...pl.n], h: pl.h } };
  }
  const k = (j.r * j.r) / (2 * d);
  return {
    kind: "sphere",
    sphere: { c: j.c.map((v, i) => v - k * pl.n[i]), r: Math.abs(k) },
  };
}

// ------------------------------------------------------------- wall systems

export interface WallLine {
  /** 2D unit normal of the cross-section line, pointing to the REMOVED
   * side; the wall hyperplane lifts it to (a0, 0, a1, 0…). */
  a: [number, number];
  h: number;
}

export interface WallCorner {
  i: number;
  j: number;
  q: [number, number];
  angle: number;
}

export interface WallSystem {
  lines: WallLine[];
  corners: WallCorner[];
  /** Per wall: the distance between its two corners (Lemma 3.5's w_i). */
  width: number[];
}

const RT3 = Math.sqrt(3);
const RT2 = Math.sqrt(2);

function widths(corners: WallCorner[]): number[] {
  const d = (p: [number, number], q: [number, number]) =>
    Math.hypot(p[0] - q[0], p[1] - q[1]);
  return [
    d(corners[0].q, corners[1].q),
    d(corners[0].q, corners[2].q),
    d(corners[1].q, corners[2].q),
  ];
}

/** The equilateral system: removed sides x·½ ± √3z/2 ≥ h, −x ≥ h. Corner
 * angles π/3; corner(0,1) = (2h, 0), corner(0,2) = (−h, √3h), corner(1,2) =
 * (−h, −√3h). `h` is the inradius. */
export function wallSystem333(h = 0.5): WallSystem {
  const corners: WallCorner[] = [
    { i: 0, j: 1, q: [2 * h, 0], angle: Math.PI / 3 },
    { i: 0, j: 2, q: [-h, RT3 * h], angle: Math.PI / 3 },
    { i: 1, j: 2, q: [-h, -RT3 * h], angle: Math.PI / 3 },
  ];
  return {
    lines: [
      { a: [0.5, RT3 / 2], h },
      { a: [0.5, -RT3 / 2], h },
      { a: [-1, 0], h },
    ],
    corners,
    width: widths(corners),
  };
}

/** (π/2, π/3, π/6) at corners (0,1), (0,2), (1,2). */
export function wallSystem236(): WallSystem {
  const corners: WallCorner[] = [
    { i: 0, j: 1, q: [1, 0], angle: Math.PI / 2 },
    { i: 0, j: 2, q: [0.5, RT3 / 2], angle: Math.PI / 3 },
    { i: 1, j: 2, q: [-0.5, -RT3 / 2], angle: Math.PI / 6 },
  ];
  return {
    lines: [
      { a: [RT3 / 2, 0.5], h: RT3 / 2 },
      { a: [0.5, -RT3 / 2], h: 0.5 },
      { a: [-RT3 / 2, 0.5], h: 0 },
    ],
    corners,
    width: widths(corners),
  };
}

/** (π/2, π/4, π/4) at corners (0,1), (0,2), (1,2). */
export function wallSystem244(): WallSystem {
  const corners: WallCorner[] = [
    { i: 0, j: 1, q: [1, 0], angle: Math.PI / 2 },
    { i: 0, j: 2, q: [0, 1], angle: Math.PI / 4 },
    { i: 1, j: 2, q: [0, -1], angle: Math.PI / 4 },
  ];
  return {
    lines: [
      { a: [1 / RT2, 1 / RT2], h: 1 / RT2 },
      { a: [1 / RT2, -1 / RT2], h: 1 / RT2 },
      { a: [-1, 0], h: 0 },
    ],
    corners,
    width: widths(corners),
  };
}

/** The wall hyperplane in n dims: cross-section normal lifted; the height
 * axis (index 1) and any extra axis (index 3) untouched. */
export function wallPlane(line: WallLine, dim: Dim): HPlane {
  const n = new Array<number>(dim).fill(0);
  n[0] = line.a[0];
  n[2] = line.a[1];
  return { n, h: line.h };
}

// ------------------------------------------------------------- ball solving

export interface BallSpec {
  /** The two walls meeting at this ball's ideal vertex. */
  corner: [number, number];
  /** Absolute height of the vertex (and center). */
  height: number;
  /** Dihedral angle to wall `corner[0]`, then to wall `corner[1]`. */
  theta: [number, number];
  /** Pinned radius; absent, the tangency system solves for it. */
  radius?: number;
  name: string;
}

/** Unit direction from the corner making angle theta[0] with wall
 * corner[0]'s solid normal and theta[1] with the other's — the unique
 * direction inside the solid wedge (Lemma 3.3(3), solid-side reading). */
function ballDirection(ws: WallSystem, spec: BallSpec): [number, number] {
  const [i, j] = spec.corner;
  const si: [number, number] = [-ws.lines[i].a[0], -ws.lines[i].a[1]];
  const sj: [number, number] = [-ws.lines[j].a[0], -ws.lines[j].a[1]];
  const proj = sj[0] * si[0] + sj[1] * si[1];
  let t: [number, number] = [sj[0] - proj * si[0], sj[1] - proj * si[1]];
  const tl = Math.hypot(t[0], t[1]);
  t = [t[0] / tl, t[1] / tl];
  const cosT = Math.cos(spec.theta[0]);
  const sinT = Math.sin(spec.theta[0]);
  const u: [number, number] = [
    si[0] * cosT + t[0] * sinT,
    si[1] * cosT + t[1] * sinT,
  ];
  const aJ = Math.acos(Math.max(-1, Math.min(1, u[0] * sj[0] + u[1] * sj[1])));
  if (Math.abs(aJ - spec.theta[1]) > 1e-9) {
    throw new Error(
      `ball ${spec.name}: direction angles (${spec.theta[0]}, ${aJ}) do ` +
        `not close the vertex`,
    );
  }
  return u;
}

/**
 * Solve the Lemma 3.5 tangency system for the radii. One equation per ball
 * pair sharing a wall:
 *   r1·sin θ1w + r2·sin θ2w = (w² + Δh²) / (2w),
 * linear in the unpinned radii; pinned ones substitute.
 */
export function solveBalls(
  ws: WallSystem,
  specs: BallSpec[],
  dim: Dim,
): { radii: number[]; centers: number[][] } {
  const dirs = specs.map((s) => ballDirection(ws, s));
  const unpinned = specs.map((s) => s.radius === undefined);
  const unknowns = unpinned.filter(Boolean).length;
  const eqs: { a: number; b: number; w: number; rhs: number }[] = [];
  for (let a = 0; a < specs.length; a++) {
    for (let b = a + 1; b < specs.length; b++) {
      const shared = specs[a].corner.filter((w) => specs[b].corner.includes(w));
      if (shared.length !== 1) continue;
      const w = shared[0];
      const ww = ws.width[w];
      const dh = specs[a].height - specs[b].height;
      eqs.push({ a, b, w, rhs: (ww * ww + dh * dh) / (2 * ww) });
    }
  }
  if (eqs.length !== unknowns) {
    throw new Error(
      `tangency system has ${eqs.length} equations for ${unknowns} unknowns`,
    );
  }
  const col = new Map<number, number>();
  let next = 0;
  for (let i = 0; i < specs.length; i++) if (unpinned[i]) col.set(i, next++);
  const sinOf = (i: number, w: number) =>
    Math.sin(specs[i].theta[specs[i].corner.indexOf(w)]);
  const m: number[][] = eqs.map((e) => {
    const row = new Array<number>(unknowns + 1).fill(0);
    if (unpinned[e.a]) row[col.get(e.a) as number] += sinOf(e.a, e.w);
    else row[unknowns] -= specs[e.a].radius! * sinOf(e.a, e.w);
    if (unpinned[e.b]) row[col.get(e.b) as number] += sinOf(e.b, e.w);
    else row[unknowns] -= specs[e.b].radius! * sinOf(e.b, e.w);
    row[unknowns] += e.rhs;
    return row;
  });
  for (let i = 0; i < unknowns; i++) {
    let piv = i;
    for (let r = i + 1; r < m.length; r++)
      if (Math.abs(m[r][i]) > Math.abs(m[piv][i])) piv = r;
    [m[i], m[piv]] = [m[piv], m[i]];
    if (Math.abs(m[i][i]) < 1e-12)
      throw new Error("tangency system is singular");
    for (let r = 0; r < m.length; r++) {
      if (r === i) continue;
      const f = m[r][i] / m[i][i];
      for (let c = i; c <= unknowns; c++) m[r][c] -= f * m[i][c];
    }
  }
  const radii = specs.map((s, i) =>
    s.radius !== undefined
      ? s.radius
      : m[col.get(i) as number][unknowns] / m[col.get(i) as number][i],
  );
  const centers = specs.map((s, i) => {
    const corner = ws.corners.find(
      (c) => c.i === s.corner[0] && c.j === s.corner[1],
    );
    if (!corner) throw new Error(`no corner for ball ${s.name}`);
    const c = new Array<number>(dim).fill(0);
    c[0] = corner.q[0] + radii[i] * dirs[i][0];
    c[1] = s.height;
    c[2] = corner.q[1] + radii[i] * dirs[i][1];
    return c;
  });
  return { radii, centers };
}

// -------------------------------------------------------------- the tile SDF

function termSDF(t: Term, p: ArrayLike<number>): number {
  if (t.kind === "sphere") {
    const d = dist(p, t.c) - t.r;
    return t.inside ? d : -d;
  }
  const d = dot(t.n, p) - t.h;
  return t.above ? -d : d;
}

export function tileSDF(scene: SphScene, p: ArrayLike<number>): number {
  let best = Infinity;
  for (const piece of scene.pieces) {
    let d = -Infinity;
    for (const t of piece.terms) {
      const v = termSDF(t, p);
      if (v > d) d = v;
    }
    if (d < best) best = d;
  }
  return best;
}

// ----------------------------------------------------------------- the fold

export interface SphScratch {
  x: Float64Array;
  moves: number;
  inversions: number;
  reflections: number;
  passes: number;
  checks: number;
  capped: boolean;
  lambda: number;
  word: Int32Array;
}

export function makeSphScratch(dim: Dim, cap: number): SphScratch {
  return {
    x: new Float64Array(dim),
    moves: 0,
    inversions: 0,
    reflections: 0,
    passes: 0,
    checks: 0,
    capped: false,
    lambda: 1,
    word: new Int32Array(cap + 1),
  };
}

/**
 * The IIS fold: per pass, scan the faces in order; a face sphere holding
 * the point inverts it, a violated wall reflects it; the scan continues
 * within the pass (the reference implementation's semantics) and passes
 * repeat until a clean one or the cap. The cap is a numerical guard, not
 * an object parameter — queries on the limit set never fold in.
 */
export function foldQuery(
  scene: SphScene,
  p: ArrayLike<number>,
  s: SphScratch,
): SphScratch {
  const dim = scene.dim;
  for (let i = 0; i < dim; i++) s.x[i] = p[i];
  s.moves = 0;
  s.inversions = 0;
  s.reflections = 0;
  s.passes = 0;
  s.checks = 0;
  s.capped = false;
  s.lambda = 1;
  for (;;) {
    let moved = false;
    for (let fi = 0; fi < scene.foldFaces.length; fi++) {
      const { face: f, solidInside } = scene.foldFaces[fi];
      s.checks++;
      if (f.kind === "sphere") {
        const c = f.sphere.c;
        const r = f.sphere.r;
        let d2 = 0;
        for (let i = 0; i < dim; i++) {
          const t = s.x[i] - c[i];
          d2 += t * t;
        }
        const onRemovedSide = solidInside ? d2 > r * r : d2 < r * r;
        if (onRemovedSide) {
          if (d2 < 1e-300) continue;
          const k = (r * r) / d2;
          for (let i = 0; i < dim; i++) s.x[i] = c[i] + k * (s.x[i] - c[i]);
          s.lambda *= k;
          if (s.moves < s.word.length) s.word[s.moves] = fi;
          s.inversions++;
          s.moves++;
          moved = true;
        }
      } else {
        const pl = f.plane;
        let d = -pl.h;
        for (let i = 0; i < dim; i++) d += pl.n[i] * s.x[i];
        if (d > 0) {
          for (let i = 0; i < dim; i++) s.x[i] -= 2 * d * pl.n[i];
          s.reflections++;
          s.moves++;
          moved = true;
        }
      }
    }
    s.passes++;
    if (!moved) break;
    if (s.passes >= scene.foldCap) {
      s.capped = true;
      break;
    }
  }
  return s;
}

/**
 * The author-form estimate: tileSDF(folded)/|dr|·fudge. Positive outside
 * the union of tiles, negative inside; the zero set is the fold faces plus
 * their group images — the rendered surface.
 */
export function estimateSph(
  scene: SphScene,
  p: ArrayLike<number>,
  fudge: number,
  s: SphScratch,
): number {
  foldQuery(scene, p, s);
  return (tileSDF(scene, s.x) / Math.abs(s.lambda)) * fudge;
}

/** Membership in the union of tiles: the fold terminates within the cap
 * AND the folded point satisfies the tile's own conditions (the fold does
 * not test the divide plane, so termination alone is weaker). */
export function sphContains(
  scene: SphScene,
  p: ArrayLike<number>,
  s: SphScratch,
): boolean {
  foldQuery(scene, p, s);
  return !s.capped && tileSDF(scene, s.x) <= 0;
}

/** The orbit-of-balls estimate: min over seed spheres, folded — the
 * reference's renderMode-1 form and the tile cross-check's instrument. */
export function estimateSeedOrbit(
  scene: SphScene,
  seeds: HSphere[],
  p: ArrayLike<number>,
  fudge: number,
  s: SphScratch,
): number {
  foldQuery(scene, p, s);
  let best = Infinity;
  for (const b of seeds) {
    const d = (dist(s.x, b.c) - b.r) / Math.abs(s.lambda);
    if (d < best) best = d;
  }
  return best * fudge;
}

// ------------------------------------------------------------ constructions

export interface BuildOptions {
  dim: Dim;
  kind: string;
  params: string;
  ws: WallSystem;
  balls: BallSpec[];
  /** Explicit divide hyperplane; absent, the plane through the corner
   * vertices (one per ball, plus any extra corner-line contacts). */
  divide?: HPlane;
  /** A second piece: prism ∧ this half-space's complement side… given as
   * the plane whose NON-solid side (n·p > h) is the second piece. */
  semiSecond?: HPlane;
  foldCap?: number;
}

/**
 * Assemble an infinite sphairahedron: solve the radii, verify Lemmas
 * 3.3/3.5 numerically, build the vertices, the divide plane, the tile and
 * the maximum vertex balls. Throws on a construction that fails
 * verification when `strict` (default) — the harness renders only verified
 * constructions and records outside-region cases with `strict: false`.
 */
export function buildSphairahedron(opts: BuildOptions & { strict?: boolean }): {
  scene: SphScene;
  report: VerifyReport;
} {
  const { dim, ws, balls } = opts;
  const { radii, centers } = solveBalls(ws, balls, dim);
  const ballCount = radii.length;
  const problems: string[] = [];
  let maxTangentErr = 0;
  let maxAngleErr = 0;
  const extraCrossings: Record<string, number[]> = {};

  // Lemma 3.3(2): the ball is tangent to its corner line.
  balls.forEach((spec, i) => {
    const corner = ws.corners.find(
      (c) => c.i === spec.corner[0] && c.j === spec.corner[1],
    )!;
    const d = Math.hypot(
      centers[i][0] - corner.q[0],
      centers[i][2] - corner.q[1],
    );
    maxTangentErr = Math.max(maxTangentErr, Math.abs(d - radii[i]));
    if (radii[i] <= 0)
      problems.push(`ball ${spec.name}: radius ${radii[i]} <= 0`);
    // Lemma 3.3(3) read as the plane/sphere dihedral: cos θ = δ/r.
    spec.corner.forEach((w, k) => {
      const pl = wallPlane(ws.lines[w], dim);
      const delta = Math.abs(dot(pl.n, centers[i]) - pl.h);
      const angle = Math.acos(Math.max(-1, Math.min(1, delta / radii[i])));
      maxAngleErr = Math.max(maxAngleErr, Math.abs(angle - spec.theta[k]));
    });
    // Any wall the ball additionally crosses is reported (the prism's
    // second vertex lives on one).
    const extra: number[] = [];
    for (let w = 0; w < ws.lines.length; w++) {
      if (spec.corner.includes(w)) continue;
      const pl = wallPlane(ws.lines[w], dim);
      const delta = Math.abs(dot(pl.n, centers[i]) - pl.h);
      if (delta < radii[i] * (1 - 1e-12)) extra.push(w);
    }
    if (extra.length > 0) extraCrossings[spec.name] = extra;
  });

  // Vertices: each ball's corner vertex, plus any extra corner-line
  // contacts (the prism family's second vertex lives on one).
  const vertices: VertInfo[] = [];
  balls.forEach((spec, i) => {
    const corner = ws.corners.find(
      (c) => c.i === spec.corner[0] && c.j === spec.corner[1],
    )!;
    const p = new Array<number>(dim).fill(0);
    p[0] = corner.q[0];
    p[1] = spec.height;
    p[2] = corner.q[1];
    vertices.push({
      p,
      faces: [i, ballCount + spec.corner[0], ballCount + spec.corner[1]],
    });
    for (const w of extraCrossings[spec.name] ?? []) {
      for (const cc of ws.corners.filter((c) => c.i === w || c.j === w)) {
        const d = Math.hypot(centers[i][0] - cc.q[0], centers[i][2] - cc.q[1]);
        if (Math.abs(d - radii[i]) <= 1e-9 * Math.max(1, radii[i])) {
          const p2 = new Array<number>(dim).fill(0);
          p2[0] = cc.q[0];
          p2[1] = spec.height;
          p2[2] = cc.q[1];
          vertices.push({
            p: p2,
            faces: [i, ballCount + cc.i, ballCount + cc.j],
          });
        }
      }
    }
  });

  // Lemma 3.5: tangency of the wall circles per sharing pair. The circles
  // live in the wall plane with centers at the feet of the ball centers.
  const foot = (i: number, pl: HPlane): number[] => {
    const d = dot(pl.n, centers[i]) - pl.h;
    return centers[i].map((v, k) => v - d * pl.n[k]);
  };
  for (let a = 0; a < balls.length; a++) {
    for (let b = a + 1; b < balls.length; b++) {
      const shared = balls[a].corner.find((w) => balls[b].corner.includes(w));
      if (shared === undefined) continue;
      const pl = wallPlane(ws.lines[shared], dim);
      const ra = Math.sqrt(
        Math.max(0, radii[a] ** 2 - dist(centers[a], foot(a, pl)) ** 2),
      );
      const rb = Math.sqrt(
        Math.max(0, radii[b] ** 2 - dist(centers[b], foot(b, pl)) ** 2),
      );
      const gap = dist(foot(a, pl), foot(b, pl)) - (ra + rb);
      maxTangentErr = Math.max(maxTangentErr, Math.abs(gap));
      if (Math.abs(gap) > 1e-7 * Math.max(1, ra + rb)) {
        problems.push(
          `balls ${balls[a].name}/${balls[b].name}: wall circles not tangent ` +
            `(gap ${gap.toExponential(2)})`,
        );
        continue;
      }
      vertices.push({
        p: wallCircleTangentPoint(foot(a, pl), foot(b, pl), ra, rb),
        faces: [a, b, ballCount + shared],
      });
    }
  }

  // The three-ball vertex: the balls' common point where their pairwise
  // circles are mutually tangent (P246 for the cube).
  if (balls.length === 3) {
    const triple = tripleBallVertex(centers, radii);
    if (triple) vertices.push({ p: triple, faces: [0, 1, 2] });
    else problems.push("no common point of the three balls (P246 missing)");
  }

  // The divide plane.
  let divide: HPlane | undefined = opts.divide;
  if (!divide) {
    const pts = vertices.filter((v) => v.faces.length === 3);
    if (pts.length < 3)
      throw new Error("need three corner vertices for the divide plane");
    divide = planeThrough3(pts[0].p, pts[1].p, pts[2].p, dim);
  }

  // Tile pieces.
  const terms: Term[] = [
    ...ws.lines.map((l): Term => ({
      kind: "plane",
      n: wallPlane(l, dim).n,
      h: l.h,
      above: false,
    })),
    ...radii.map((r, i): Term => ({
      kind: "sphere",
      c: centers[i],
      r,
      inside: false,
    })),
  ];
  const probe = new Array<number>(dim).fill(0);
  probe[1] = Math.min(...balls.map((b) => b.height)) - 2;
  // Orient the divide's solid side by the probe.
  const dVal = dot(divide.n, probe) - divide.h;
  terms.push({
    kind: "plane",
    n: [...divide.n],
    h: divide.h,
    above: dVal > 0,
  });
  const pieces: TilePiece[] = [{ terms }];
  if (opts.semiSecond) {
    const s = opts.semiSecond;
    const sVal = dot(s.n, probe) - s.h;
    pieces.push({
      terms: [
        ...ws.lines.map((l): Term => ({
          kind: "plane",
          n: wallPlane(l, dim).n,
          h: l.h,
          above: false,
        })),
        ...radii.map((r, i): Term => ({
          kind: "sphere",
          c: centers[i],
          r,
          inside: false,
        })),
        { kind: "plane", n: [...s.n], h: s.h, above: sVal > 0 },
      ],
    });
  }

  const faces: HFace[] = [
    ...radii.map((r, i) => ({
      kind: "sphere" as const,
      sphere: { c: centers[i], r },
    })),
    ...ws.lines.map((l) => ({
      kind: "plane" as const,
      plane: wallPlane(l, dim),
    })),
  ];
  const scene: SphScene = {
    dim,
    kind: opts.kind,
    params: opts.params,
    foldFaces: [
      ...radii.map((r, i) => ({
        face: {
          kind: "sphere" as const,
          sphere: { c: centers[i], r },
        },
        solidInside: false,
      })),
      ...ws.lines.map((l) => ({
        face: {
          kind: "plane" as const,
          plane: wallPlane(l, dim),
        },
        solidInside: false,
      })),
    ],
    pieces,
    faces,
    vertices,
    probe,
    divide,
    bound: frameBound(dim, balls, radii, centers),
    seeds: maxVertexBalls(faces, vertices, pieces),
    foldCap: opts.foldCap ?? 50,
  };
  const report: VerifyReport = {
    problems,
    maxTangentErr,
    maxAngleErr,
    extraCrossings,
  };
  if ((opts.strict ?? true) && problems.length > 0) {
    throw new Error(`construction failed verification: ${problems.join("; ")}`);
  }
  return { scene, report };
}

/** The tangency point of two circles lying in the wall plane, with centers
 * `fa`, `fb` (the feet) and radii `ra`, `rb`: the point on the segment
 * between the centers at the circles' touch. */
function wallCircleTangentPoint(
  fa: number[],
  fb: number[],
  ra: number,
  rb: number,
): number[] {
  const t = ra / (ra + rb);
  return fa.map((v, i) => v + t * (fb[i] - v));
}

/** One of the two common points of three spheres, chosen where their
 * pairwise circles are mutually tangent; null when they have no common
 * point or are not mutually tangent at either. */
export function tripleBallVertex(
  centers: number[][],
  radii: number[],
): number[] | null {
  const [c0, c1, c2] = centers;
  const [r0, r1, r2] = radii;
  const l1 = c1.map((v, i) => 2 * (v - c0[i]));
  const l2 = c2.map((v, i) => 2 * (v - c0[i]));
  const k1 = dot(c1, c1) - r1 * r1 - (dot(c0, c0) - r0 * r0);
  const k2 = dot(c2, c2) - r2 * r2 - (dot(c0, c0) - r0 * r0);
  // Closest point to c0 on the radical line (the two equations' solution
  // set): p* = c0 + Lᵀ(LLᵀ)⁻¹(k − Lc0); the tangent circles touch at
  // p* ± √(r0² − |p*−c0|²) along the line's direction.
  const dim = c0.length;
  const a00 = dot(l1, l1);
  const a01 = dot(l1, l2);
  const a11 = dot(l2, l2);
  const det = a00 * a11 - a01 * a01;
  if (Math.abs(det) < 1e-30) return null;
  const r1v = k1 - dot(l1, c0);
  const r2v = k2 - dot(l2, c0);
  const wa = (a11 * r1v - a01 * r2v) / det;
  const wb = (a00 * r2v - a01 * r1v) / det;
  const pStar = c0.map((v, i) => v + wa * l1[i] + wb * l2[i]);
  let dir: number[];
  if (dim === 3) {
    dir = cross3(l1, l2);
  } else {
    // 4D: only the tetra lift uses this module in 4D today and it has a
    // single ball — unreachable; kept explicit rather than wrong.
    return null;
  }
  const dl = dot(dir, dir);
  if (dl < 1e-30) return null;
  const gap = dist(pStar, c0);
  let disc = r0 * r0 - gap * gap;
  // The common point can be a tangency (the two candidates merged): the
  // radical line touches the sphere and the vertex IS the closest point.
  if (disc < 0) {
    if (disc < -1e-9 * r0 * r0) return null;
    disc = 0;
  }
  const t = Math.sqrt(disc) / dl;
  const parallel = (p: number[]): number => {
    const t01 = cross3(
      p.map((v, i) => v - c0[i]),
      p.map((v, i) => v - c1[i]),
    );
    const t02 = cross3(
      p.map((v, i) => v - c0[i]),
      p.map((v, i) => v - c2[i]),
    );
    const t12 = cross3(
      p.map((v, i) => v - c1[i]),
      p.map((v, i) => v - c2[i]),
    );
    const u = norm(t01);
    if (u < 1e-15) return Infinity;
    const n01 = t01.map((v) => v / u);
    const n02 = t02.map((v) => v / (norm(t02) || 1));
    const n12 = t12.map((v) => v / (norm(t12) || 1));
    return Math.max(1 - Math.abs(dot(n01, n02)), 1 - Math.abs(dot(n01, n12)));
  };
  const pPlus = dir.map((v, i) => pStar[i] + t * v);
  const pMinus = dir.map((v, i) => pStar[i] - t * v);
  const ePlus = parallel(pPlus);
  const eMinus = parallel(pMinus);
  if (Math.min(ePlus, eMinus) > 1e-6) return null;
  return ePlus <= eMinus ? pPlus : pMinus;
}

function planeThrough3(
  a: number[],
  b: number[],
  c: number[],
  dim: Dim,
): HPlane {
  const n = cross3(
    b.map((v, i) => v - a[i]),
    c.map((v, i) => v - a[i]),
  );
  const l = norm(n);
  const u = n.map((v) => v / l);
  if (dim === 4) {
    // The 3D cross product of the two difference vectors lies in the
    // hyperplane spanned by them; for axis-aligned constructions the
    // normal needs no w component — assert rather than guess.
    if (Math.abs(u[3]) > 1e-9)
      throw new Error("divide plane needs a w component; pass it explicitly");
    u.pop();
  }
  return { n: u, h: dot(u, a) };
}

function frameBound(
  dim: Dim,
  balls: BallSpec[],
  radii: number[],
  centers: number[][],
): { center: number[]; radius: number } {
  const center = new Array<number>(dim).fill(0);
  let reach = 0;
  let lo = Infinity;
  let hi = -Infinity;
  balls.forEach((b, i) => {
    center[1] += b.height / balls.length;
    lo = Math.min(lo, centers[i][1] - radii[i]);
    hi = Math.max(hi, centers[i][1] + radii[i]);
    for (let k = 0; k < dim; k++)
      reach = Math.max(reach, Math.abs(centers[i][k]) + radii[i]);
  });
  reach = Math.max(reach, 3, (hi - lo) * 1.5 + 4);
  return { center, radius: reach };
}

// --------------------------------------------------- maximum vertex balls

/**
 * The maximum vertex balls (preprint Def 4.1): per vertex X, the open ball
 * whose boundary passes through X, is orthogonal to every edge there (its
 * center on the common edge-tangent line), contains no other vertex, and
 * is maximal — the ball touching the nearest other vertex along its
 * center line. Side chosen toward the tile interior; a vertex whose ball
 * would be a half-space (the ∞ vertex) yields no seed.
 */
export function maxVertexBalls(
  faces: HFace[],
  vertices: VertInfo[],
  pieces: TilePiece[],
): HSphere[] {
  const inTile = (p: number[]): boolean => {
    for (const piece of pieces) {
      let d = -Infinity;
      for (const t of piece.terms) d = Math.max(d, termSDF(t, p));
      if (d <= 0) return true;
    }
    return false;
  };
  const seeds: HSphere[] = [];
  for (const v of vertices) {
    const normals = v.faces.map((fi) => faceNormalAt(faces[fi], v.p));
    const raw = cross3(normals[0], normals[1]);
    const tl = norm(raw);
    if (tl < 1e-12) continue;
    // Ideality: the third edge's tangent is parallel.
    const t2 = cross3(normals[0], normals[2]);
    const t2l = norm(t2);
    if (t2l < 1e-12) continue;
    if (1 - Math.abs(dot(raw, t2) / (tl * t2l)) > 1e-6) continue;
    const unit = raw.map((x) => x / tl);
    // Both sides along the tangent line; the ball must poke into the tile.
    for (const side of [1, -1]) {
      const tangent = unit.map((x) => x * side);
      let tStar = Infinity;
      for (const o of vertices) {
        if (o === v) continue;
        const dy: number[] = o.p.map((x, i) => x - v.p[i]);
        const along = dot(dy, tangent);
        if (along <= 1e-12) continue;
        const t = dot(dy, dy) / (2 * along);
        if (t < tStar) tStar = t;
      }
      if (!Number.isFinite(tStar) || tStar <= 1e-12) continue;
      const c = v.p.map((x, i) => x + tStar * tangent[i]);
      // The ball must intersect the tile: test its inner half's midpoint.
      const test = v.p.map((x, i) => x + tangent[i] * tStar * 0.5);
      if (!inTile(test)) continue;
      seeds.push({ c, r: tStar });
      break;
    }
  }
  return seeds;
}

function faceNormalAt(f: HFace, p: number[]): number[] {
  if (f.kind === "sphere") {
    const d = dist(p, f.sphere.c);
    return f.sphere.c.map((v, i) => (p[i] - v) / d);
  }
  return [...f.plane.n];
}

// ----------------------------------------------------- finite construction

/**
 * The finite sphairahedron: every face, tile term, vertex and seed of the
 * infinite scene mapped through the inversion sphere `j`; each image's
 * solid side fixed by mapping the probe. The fold order interleavees walls
 * and balls (the reference's gSpheres order). The framing ball becomes the
 * divide plane's image — the quasi-sphere's smooth carrier.
 */
export function makeFinite(
  scene: SphScene,
  j: HSphere,
  foldCap?: number,
): SphScene {
  if (scene.dim !== 3 && scene.dim !== 4) throw new Error("bad dim");
  const q0 = invertPoint(j, scene.probe);
  const mapImage = (img: HImage, planeAbove: boolean | null): Term => {
    if (img.kind === "sphere") {
      const d = dist(q0, img.sphere.c) - img.sphere.r;
      return {
        kind: "sphere",
        c: img.sphere.c,
        r: img.sphere.r,
        inside: d < 0,
      };
    }
    const v = dot(img.plane.n, q0) - img.plane.h;
    return {
      kind: "plane",
      n: [...img.plane.n],
      h: img.plane.h,
      above: planeAbove === null ? v > 0 : planeAbove,
    };
  };
  const imageOfFace = (f: HFace): HImage =>
    f.kind === "sphere" ? invertSphere(j, f.sphere) : invertPlane(j, f.plane);

  // Combined faces: balls first, then walls — the finite faces keep that
  // indexing for the vertices.
  const mappedFaces = scene.faces.map(imageOfFace);
  const toFace = (img: HImage): HFace =>
    img.kind === "sphere"
      ? { kind: "sphere", sphere: img.sphere }
      : { kind: "plane", plane: img.plane };

  // Tile pieces.
  const pieces: TilePiece[] = scene.pieces.map((piece) => ({
    terms: piece.terms.map((t) => {
      if (t.kind === "sphere")
        return mapImage(invertSphere(j, { c: t.c, r: t.r }), null);
      return mapImage(invertPlane(j, { n: t.n, h: t.h }), null);
    }),
  }));

  // Fold order: walls and balls interleaved (wall0, ball0, wall1, ball1,
  // wall2, ball2 …) when the counts match — the reference's order. Every
  // face's solid side is fixed by q0 (the probe's image lies in the tile):
  // spheres get solidInside = "q0 inside"; planes are re-normalized so the
  // solid side is n·p < h and the fold reflects on the other side.
  const senseOf = (img: HImage): { face: HFace; solidInside: boolean } => {
    if (img.kind === "sphere") {
      return {
        face: { kind: "sphere", sphere: img.sphere },
        solidInside: dist(q0, img.sphere.c) < img.sphere.r,
      };
    }
    const pl = img.plane;
    if (dot(pl.n, q0) - pl.h > 0) {
      return {
        face: { kind: "plane", plane: { n: pl.n.map((v) => -v), h: -pl.h } },
        solidInside: false,
      };
    }
    return {
      face: { kind: "plane", plane: { n: [...pl.n], h: pl.h } },
      solidInside: false,
    };
  };
  const wallSensed = mappedFaces
    .filter((_, i) => scene.faces[i].kind === "plane")
    .map((img) => senseOf(img));
  const ballSensed = mappedFaces
    .filter((_, i) => scene.faces[i].kind === "sphere")
    .map((img) => senseOf(img));
  const foldFaces: { face: HFace; solidInside: boolean }[] = [];
  const nb = ballSensed.length;
  const nw = wallSensed.length;
  for (let k = 0; k < Math.max(nb, nw); k++) {
    if (k < nw) foldFaces.push(wallSensed[k]);
    if (k < nb) foldFaces.push(ballSensed[k]);
  }

  // Framing: the divide plane's image — the quasi-sphere's smooth carrier —
  // grown to hold the dent spheres, which poke outside it (the craters).
  const divideImage = invertPlane(j, scene.divide);
  let bound = { center: [...j.c], radius: j.r * 3 };
  if (divideImage.kind === "sphere") {
    const cv = divideImage.sphere.c;
    let radius = divideImage.sphere.r;
    for (const { face: f } of foldFaces) {
      if (f.kind !== "sphere") continue;
      radius = Math.max(radius, dist(f.sphere.c, cv) + f.sphere.r);
    }
    bound = { center: [...cv], radius: radius * 1.04 };
  }

  return {
    dim: scene.dim,
    kind: `${scene.kind} finite`,
    params: scene.params,
    foldFaces,
    pieces,
    faces: mappedFaces.map(toFace),
    vertices: scene.vertices.map((v) => ({
      p: invertPoint(j, v.p),
      faces: v.faces,
    })),
    probe: q0,
    divide: scene.divide,
    bound,
    seeds: scene.seeds
      .map((b) => invertSphere(j, b))
      .map((img) => {
        if (img.kind !== "sphere")
          throw new Error(
            "seed ball image degenerate; move the inversion sphere",
          );
        return img.sphere;
      }),
    foldCap: foldCap ?? scene.foldCap,
  };
}
