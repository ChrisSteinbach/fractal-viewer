/**
 * The sphere-inversion family's INDEPENDENT explicit-orbit oracle: the
 * depth-D seed orbit `O_D` written out as a finite list of exact pieces, and
 * the TRUE Euclidean distance to their union. It shares nothing with the
 * estimators' fold loop or covering tables (`sphere-inversion.ts`'s
 * `buildSphereInversionTables`) — only the construction vocabulary and the
 * primitive ball image from `inversion.ts`, which its own tests pin against
 * pointwise inversion — so a test that holds an estimator below this
 * distance checks the estimator against the object, not against itself.
 * Deliberately generic in the dimension (plain arrays, no unrolled
 * arithmetic), slow, and for tests and harness sheets only.
 *
 * PIECES. For a reduced word `w = (w_0, …, w_{k−1})` the piece is
 * `I_{w_0}(I_{w_1}(… I_{w_{k−1}}(K ∩ F)))`. `K ∩ F` is an intersection of
 * generalized balls (the seed members, then `ext(B_i)` for every
 * generator), and inversion maps each generalized ball to one exactly, so
 * every piece is again an intersection of generalized balls. Words are
 * extended by PREPENDING a letter different from the current first one. A
 * seed member mapped onto a plane at depth >= 2 (measure zero; the analyzer
 * refuses only depth 1) throws rather than being approximated.
 *
 * DISTANCE TO AN INTERSECTION `S` OF GENERALIZED BALLS, exactly. If `p ∉ S`
 * its nearest point `q*` lies on the spheres of an active member set `A`.
 * Where those spheres meet transversally at `q*`, `A` has at most `n`
 * members, their intersection is a round sphere `Σ` of dimension `n − |A|`
 * inside an affine subspace `V`, and `q*` is a critical point of `|p − ·|`
 * on `Σ`, i.e. one of `m ± ρ·unit(proj_V(p) − m)`. So the candidates are
 * those two points for every member subset of size <= `n`; the answer is
 * the nearest FEASIBLE candidate. Non-transversal cases are covered too:
 * tangent spheres meet in one point (`ρ = 0`), taken as a candidate; a
 * sphere that contains the current `Σ` adds no constraint, so the smaller
 * subset already carries its candidates; and when `proj_V(p) = m` every
 * point of `Σ` is equidistant, so one arbitrary point stands for them and
 * any feasible-region boundary on `Σ` is reached by a larger subset at the
 * same distance. Only spheres within the running best distance of `p` can
 * be active, which is the pruning that makes the enumeration affordable.
 *
 * `nearestPointOnPiece` also returns the feasible point attaining the
 * distance, so tests can confirm the value is attained (an upper bound) and
 * that no sampled feasible point beats it (the lower-bound evidence).
 */
import { signedInversionBallScale } from "./inversion";
import type {
  SphereInversionConstruction,
  SphereInversionGenerator,
} from "./sphere-inversion";

/** A generalized ball in plain arrays. */
export interface OracleBall {
  center: number[];
  radius: number;
  complement: boolean;
}

/** One piece `g(K ∩ F)`: its word (outermost letter first) and members. */
export interface OrbitPiece {
  word: number[];
  members: OracleBall[];
}

/** A seed image whose scale reaches this is a plane for the oracle's
 * purposes, and enumeration throws. */
const ORACLE_PLANE_SCALE = 1e9;

function sub(a: readonly number[], b: readonly number[]): number[] {
  return a.map((x, i) => x - b[i]);
}
function dot(a: readonly number[], b: readonly number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
function norm(a: readonly number[]): number {
  return Math.sqrt(dot(a, a));
}

/** The signed distance of `p` to a generalized ball's boundary: negative
 * inside the member's set. */
export function oracleMemberSdf(b: OracleBall, p: readonly number[]): number {
  const v = norm(sub(p, b.center)) - b.radius;
  return b.complement ? -v : v;
}

/** Image of a generalized ball under inversion through generator `g`.
 * Throws on a (near-)plane image. */
export function invertGeneralizedBall(
  g: SphereInversionGenerator,
  b: OracleBall,
): OracleBall {
  const d = norm(sub(b.center, g.center));
  const R2 = g.radius * g.radius;
  const s = signedInversionBallScale(d, b.radius, R2);
  if (s === 0 || Math.abs(s) >= ORACLE_PLANE_SCALE) {
    throw new Error("generalized ball maps to a plane");
  }
  return {
    center: b.center.map((v, a) => g.center[a] + s * (v - g.center[a])),
    radius: Math.abs(s) * b.radius,
    complement: s > 0 ? b.complement : !b.complement,
  };
}

/** Invert one point through generator `g` (the raw definition). */
export function invertPoint(
  g: SphereInversionGenerator,
  x: readonly number[],
): number[] {
  const u = sub(x, g.center);
  const s = (g.radius * g.radius) / dot(u, u);
  return u.map((v, a) => g.center[a] + s * v);
}

/** Every piece of `O_depth`, shallow words first. */
export function enumerateSeedOrbit(
  construction: SphereInversionConstruction,
  depth: number = construction.depth,
): OrbitPiece[] {
  const { generators, seed } = construction;
  const root: OrbitPiece = {
    word: [],
    members: [
      ...seed.map((m) => ({
        center: [...m.center],
        radius: m.radius,
        complement: m.complement,
      })),
      ...generators.map((g) => ({
        center: [...g.center],
        radius: g.radius,
        complement: true,
      })),
    ],
  };
  const out: OrbitPiece[] = [root];
  let level = [root];
  for (let k = 1; k <= depth; k++) {
    const next: OrbitPiece[] = [];
    for (const piece of level) {
      generators.forEach((g, j) => {
        if (piece.word.length > 0 && piece.word[0] === j) return;
        next.push({
          word: [j, ...piece.word],
          members: piece.members.map((b) => invertGeneralizedBall(g, b)),
        });
      });
    }
    out.push(...next);
    level = next;
  }
  return out;
}

/** Feasibility slack for a candidate point on member `b`: f64 rounding in
 * `|q − c| − r` scales with the lengths involved. */
function feasibleTol(b: OracleBall, q: readonly number[]): number {
  return 1e-11 * (1 + b.radius + norm(sub(q, b.center)));
}

function pieceFeasible(members: OracleBall[], q: readonly number[]): boolean {
  for (const b of members) {
    if (oracleMemberSdf(b, q) > feasibleTol(b, q)) return false;
  }
  return true;
}

/** Is `p` in the piece (every member SDF <= 0)? */
export function pieceContains(
  piece: OrbitPiece,
  p: readonly number[],
): boolean {
  return piece.members.every((b) => oracleMemberSdf(b, p) <= 0);
}

interface SphereSection {
  m: number[];
  basis: number[][];
  rho2: number;
}

/** Intersect section `S` with the sphere of member `b`; null when empty or
 * non-transversal (see module doc for why skipping the latter is exact). */
function intersectSection(
  S: SphereSection,
  b: OracleBall,
): SphereSection | null {
  const full = sub(b.center, S.m);
  const coords = S.basis.map((e) => dot(full, e));
  const u = full.map((_, a) =>
    S.basis.reduce((acc, e, i) => acc + coords[i] * e[a], 0),
  );
  const uu = dot(u, u);
  const scale = Math.max(S.rho2, dot(full, full), b.radius * b.radius, 1e-300);
  if (uu <= 1e-24 * scale) return null;
  const beta = (S.rho2 + dot(full, full) - b.radius * b.radius) / 2;
  let rho2 = S.rho2 - (beta * beta) / uu;
  if (rho2 < -1e-10 * Math.max(S.rho2, 1e-300)) return null;
  // Snap a rounding-sized circle to its centre: at a tangency the computed
  // radius² is ±(f64 noise), and its ± candidates would fail feasibility.
  if (rho2 <= 1e-14 * S.rho2) rho2 = 0;
  const m = S.m.map((v, a) => v + (beta / uu) * u[a]);
  const un = Math.sqrt(uu);
  const uhat = u.map((v) => v / un);
  const basis: number[][] = [];
  for (const e of S.basis) {
    let v = e.map((x, a) => x - dot(e, uhat) * uhat[a]);
    for (const k of basis) {
      const t = dot(v, k);
      v = v.map((x, a) => x - t * k[a]);
    }
    const l = norm(v);
    if (l > 1e-8 && basis.length < S.basis.length - 1) {
      basis.push(v.map((x) => x / l));
    }
  }
  return { m, basis, rho2 };
}

function candidates(S: SphereSection, p: readonly number[]): number[][] {
  const rho = Math.sqrt(S.rho2);
  if (rho === 0) return [S.m];
  const off = sub(p, S.m);
  const v = S.m.map((_, a) =>
    S.basis.reduce((acc, e) => acc + dot(off, e) * e[a], 0),
  );
  const l = norm(v);
  if (l <= 1e-14 * (1 + rho)) {
    if (S.basis.length === 0) return [S.m];
    return [S.m.map((x, a) => x + rho * S.basis[0][a])];
  }
  return [1, -1].map((sg) => S.m.map((x, a) => x + (sg * rho * v[a]) / l));
}

/**
 * The exact distance from `p` to one piece and a feasible point attaining
 * it (module doc). Returns distance 0 and `p` itself when `p` is inside;
 * `Infinity` and `null` when the piece is empty or provably no nearer than
 * `bestSoFar`.
 */
export function nearestPointOnPiece(
  piece: OrbitPiece,
  p: readonly number[],
  bestSoFar = Infinity,
): { distance: number; point: number[] | null } {
  const { members } = piece;
  const n = p.length;
  const sdf = members.map((b) => oracleMemberSdf(b, p));
  const lb = Math.max(...sdf);
  if (lb <= 0) return { distance: 0, point: [...p] };
  let best = bestSoFar;
  let bestPoint: number[] | null = null;
  if (lb >= best) return { distance: Infinity, point: null };
  const consider = (q: number[]) => {
    const d = norm(sub(p, q));
    if (d < best && pieceFeasible(members, q)) {
      best = d;
      bestPoint = q;
    }
  };
  const identity: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (__, j) => (i === j ? 1 : 0)),
  );
  // Phase 1: single spheres, which settle `best` quickly.
  const sections: (SphereSection | null)[] = members.map((b, i) => {
    if (Math.abs(sdf[i]) >= best) return null;
    const S = { m: [...b.center], basis: identity, rho2: b.radius * b.radius };
    for (const q of candidates(S, p)) consider(q);
    return S;
  });
  // Phase 2: subsets of size 2..n, depth-first in increasing member index.
  const walk = (S: SphereSection, last: number, size: number) => {
    if (size === n) return;
    for (let i = last + 1; i < members.length; i++) {
      if (Math.abs(sdf[i]) >= best) continue;
      const T = intersectSection(S, members[i]);
      if (!T) continue;
      for (const q of candidates(T, p)) consider(q);
      walk(T, i, size + 1);
    }
  };
  sections.forEach((S, i) => {
    if (S && Math.abs(sdf[i]) < best) walk(S, i, 1);
  });
  return bestPoint
    ? { distance: best, point: bestPoint }
    : { distance: Infinity, point: null };
}

/** The TRUE distance from `p` to the union of `pieces` (0 inside). */
export function explicitOrbitDistance(
  pieces: readonly OrbitPiece[],
  p: readonly number[],
): number {
  const order = pieces
    .map((piece) => ({
      piece,
      lb: Math.max(
        0,
        Math.max(...piece.members.map((b) => oracleMemberSdf(b, p))),
      ),
    }))
    .sort((a, b) => a.lb - b.lb);
  let best = Infinity;
  for (const { piece, lb } of order) {
    if (lb >= best) break;
    const r = nearestPointOnPiece(piece, p, best);
    if (r.distance < best) best = r.distance;
    if (best === 0) break;
  }
  return best;
}

/** Explicit membership in the union of `pieces`. */
export function explicitOrbitContains(
  pieces: readonly OrbitPiece[],
  p: readonly number[],
): boolean {
  return pieces.some((piece) => pieceContains(piece, p));
}
