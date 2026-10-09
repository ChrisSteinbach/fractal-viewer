/**
 * The sphairahedron family's 3D CPU estimator: the IIS fold + the
 * accumulated-Jacobian distance estimate (the author-form heuristic — the
 * KIFS shape, NOT a certified bound), the oracle every later shader mirror
 * is pinned to. The construction and its vocabulary live in
 * `sphairahedron.ts`; `sphairahedron-de-4d.ts` is this file one dimension
 * up, duplicating only the arithmetic. The written argument and the
 * measurements are in `docs/sphairahedron-family.md`.
 *
 * THE FOLD. Per pass, scan the faces in the construction's order (balls
 * then walls for the infinite types; the reference's interleaved
 * wall/ball order for finite ones — scan order is PART of the algorithm
 * once faces intersect, the geometry no longer decides it): a face sphere
 * holding the point on its REMOVED side inverts it (`λ ×= R²/|p−c|²`), a
 * violated wall reflects it (`λ` unchanged); the scan CONTINUES within the
 * pass and passes repeat until a clean one or the cap
 * ({@link SPHAIRAHEDRON_FOLD_CAP}, a numerical guard). Three outcomes:
 * DOMAIN (a clean pass), CAPPED (the cap was spent while moves were still
 * being made — a decision-unreliable value), POLE (the query sat at a face
 * sphere's centre within {@link SPHAIRAHEDRON_POLE_FLOOR}: the inversion is
 * undefined there; the estimator returns 0, not a member — the
 * sphere-inversion family's pole contract).
 *
 * THE ESTIMATE is `tileSDF(folded)/|λ| · SPHAIRAHEDRON_FUDGE` with the
 * fudge the measured 0.2 (the knee of the reference's own cost curve,
 * re-measured on the shared marcher in the pre-gate study). Positive
 * outside the union of tiles, negative inside; the zero set is the fold
 * faces plus their group images — the rendered surface.
 *
 * WHAT IS DISCLOSED, not advertised: this is a heuristic, not a lower
 * bound — the disjoint family's transported-covering argument leans on
 * disjointness and does not carry (faces here INTERSECT, and the scan
 * order is part of the algorithm). A negative return is a member signal in
 * folded coordinates, not a signed distance in the query's own; a capped
 * return is not a distance reading at all (the study's sign measurements
 * excluded capped folds). No cutoff contract is stated: the fold's `λ` is
 * not monotone (an inversion can shrink it), so there is no transportable
 * running minimum and no early exit that preserves a decision. The
 * marcher damps through the fudge at step scale
 * {@link SPHAIRAHEDRON_STEP_SCALE} (1), exactly the reference's marching
 * arithmetic.
 *
 * The estimator's zero set IS the analytic limit set where the family has
 * an analytic form: the infinite tetra's plane `y = 0`, the finite tetra's
 * image of that plane (a sphere through `J`'s centre), and the 4D lift's
 * slices of the same 3-sphere — pinned in the tests at the study's
 * measured tolerances (rms 7.7e-4 plane / 5.3e-5 sphere, machine precision
 * off-slice).
 */
import {
  SPHAIRAHEDRON_FOLD_CAPPED,
  SPHAIRAHEDRON_FOLD_DOMAIN,
  SPHAIRAHEDRON_FOLD_POLE,
  SPHAIRAHEDRON_FUDGE,
  SPHAIRAHEDRON_POLE_FLOOR,
} from "./sphairahedron";
import type {
  SphairahedronConstruction,
  SphairahedronFoldStatus,
} from "./sphairahedron";
import type { Vec3 } from "./types";

/** The flattened construction both estimator twins read. Face stride 5:
 * sphere `[c0, c1, c2, r, solidInside]`, plane `[n0, n1, n2, h, 0]`. Term
 * stride 5: sphere `[c0, c1, c2, r, inside]`, plane `[n0, n1, n2, h,
 * above]`. */
export interface SphairahedronDE {
  readonly foldCap: number;
  readonly faceCount: number;
  readonly faceKind: Int32Array;
  readonly faceData: Float64Array;
  readonly pieceCount: number;
  readonly pieceStart: Int32Array;
  readonly pieceLength: Int32Array;
  readonly termKind: Int32Array;
  readonly termData: Float64Array;
}

/** Build the 3D estimator. Throws for a 4D construction. */
export function buildSphairahedronDE(
  construction: SphairahedronConstruction,
): SphairahedronDE {
  if (construction.dim !== 3) {
    throw new Error(
      `sphairahedron-de: construction dimension ${construction.dim} is not 3`,
    );
  }
  return flatten(construction);
}

function flatten(construction: SphairahedronConstruction): SphairahedronDE {
  const dim = construction.dim;
  const faceCount = construction.foldFaces.length;
  const faceKind = new Int32Array(faceCount);
  const faceData = new Float64Array(faceCount * 5);
  construction.foldFaces.forEach((f, i) => {
    if (f.face.kind === "sphere") {
      const s = f.face.sphere;
      faceKind[i] = 0;
      for (let k = 0; k < dim; k++) faceData[i * 5 + k] = s.c[k];
      faceData[i * 5 + 3] = s.r;
      faceData[i * 5 + 4] = f.solidInside ? 1 : 0;
    } else {
      const p = f.face.plane;
      faceKind[i] = 1;
      for (let k = 0; k < dim; k++) faceData[i * 5 + k] = p.n[k];
      faceData[i * 5 + 3] = p.h;
    }
  });
  let termTotal = 0;
  for (const piece of construction.pieces) termTotal += piece.terms.length;
  const pieceCount = construction.pieces.length;
  const pieceStart = new Int32Array(pieceCount);
  const pieceLength = new Int32Array(pieceCount);
  const termKind = new Int32Array(termTotal);
  const termData = new Float64Array(termTotal * 5);
  let t = 0;
  construction.pieces.forEach((piece, pi) => {
    pieceStart[pi] = t;
    pieceLength[pi] = piece.terms.length;
    piece.terms.forEach((term) => {
      if (term.kind === "sphere") {
        termKind[t] = 0;
        for (let k = 0; k < dim; k++) termData[t * 5 + k] = term.c[k];
        termData[t * 5 + 3] = term.r;
        termData[t * 5 + 4] = term.inside ? 1 : 0;
      } else {
        termKind[t] = 1;
        for (let k = 0; k < dim; k++) termData[t * 5 + k] = term.n[k];
        termData[t * 5 + 3] = term.h;
        termData[t * 5 + 4] = term.above ? 1 : 0;
      }
      t++;
    });
  });
  return {
    foldCap: construction.foldCap,
    faceCount,
    faceKind,
    faceData,
    pieceCount,
    pieceStart,
    pieceLength,
    termKind,
    termData,
  };
}

// Fold results, read immediately after `fold3` by its callers.
let foldX = 0;
let foldY = 0;
let foldZ = 0;
let foldLambda = 1;
let foldMoves = 0;
let foldInversions = 0;
let foldReflections = 0;
let foldPasses = 0;
let foldCapped = false;
let foldPole = false;

function fold3(de: SphairahedronDE, p: Vec3): void {
  let x = p[0];
  let y = p[1];
  let z = p[2];
  let lambda = 1;
  let moves = 0;
  let inversions = 0;
  let reflections = 0;
  let passes = 0;
  let capped = false;
  let pole = false;
  const fk = de.faceKind;
  const fd = de.faceData;
  const poleFloor2 = SPHAIRAHEDRON_POLE_FLOOR * SPHAIRAHEDRON_POLE_FLOOR;
  for (;;) {
    let moved = false;
    for (let fi = 0; fi < de.faceCount; fi++) {
      const o = fi * 5;
      if (fk[fi] === 0) {
        const dx = x - fd[o];
        const dy = y - fd[o + 1];
        const dz = z - fd[o + 2];
        const r = fd[o + 3];
        const d2 = dx * dx + dy * dy + dz * dz;
        const r2 = r * r;
        const onRemovedSide = fd[o + 4] === 1 ? d2 > r2 : d2 < r2;
        if (onRemovedSide) {
          if (d2 < poleFloor2 * r2) {
            pole = true;
            continue;
          }
          const k = r2 / d2;
          x = fd[o] + k * dx;
          y = fd[o + 1] + k * dy;
          z = fd[o + 2] + k * dz;
          lambda *= k;
          inversions++;
          moves++;
          moved = true;
        }
      } else {
        const d = fd[o] * x + fd[o + 1] * y + fd[o + 2] * z - fd[o + 3];
        if (d > 0) {
          x -= 2 * d * fd[o];
          y -= 2 * d * fd[o + 1];
          z -= 2 * d * fd[o + 2];
          reflections++;
          moves++;
          moved = true;
        }
      }
    }
    passes++;
    if (!moved) break;
    if (passes >= de.foldCap) {
      capped = true;
      break;
    }
  }
  foldX = x;
  foldY = y;
  foldZ = z;
  foldLambda = lambda;
  foldMoves = moves;
  foldInversions = inversions;
  foldReflections = reflections;
  foldPasses = passes;
  foldCapped = capped;
  foldPole = pole;
}

/** Max of a tile piece's member SDFs at `(x, y, z)` — negative inside that
 * piece's solid. */
function pieceSDF(
  de: SphairahedronDE,
  piece: number,
  x: number,
  y: number,
  z: number,
): number {
  const td = de.termData;
  const tk = de.termKind;
  let best = -Infinity;
  const start = de.pieceStart[piece];
  const end = start + de.pieceLength[piece];
  for (let t = start; t < end; t++) {
    const o = t * 5;
    let v: number;
    if (tk[t] === 0) {
      const dx = x - td[o];
      const dy = y - td[o + 1];
      const dz = z - td[o + 2];
      v = Math.sqrt(dx * dx + dy * dy + dz * dz) - td[o + 3];
      if (td[o + 4] === 0) v = -v;
    } else {
      v = td[o] * x + td[o + 1] * y + td[o + 2] * z - td[o + 3];
      if (td[o + 4] === 1) v = -v;
    }
    if (v > best) best = v;
  }
  return best;
}

/** The tile SDF at the folded point: min over pieces of the max-form
 * intersections. Negative inside the union of tiles. */
function tileSDF3(
  de: SphairahedronDE,
  x: number,
  y: number,
  z: number,
): number {
  let best = Infinity;
  for (let piece = 0; piece < de.pieceCount; piece++) {
    const d = pieceSDF(de, piece, x, y, z);
    if (d < best) best = d;
  }
  return best;
}

function evaluate3(
  de: SphairahedronDE,
  p: Vec3,
  hit: SphairahedronHit | null,
): number {
  fold3(de, p);
  if (foldPole) {
    if (hit) {
      hit.d = 0;
      hit.status = SPHAIRAHEDRON_FOLD_POLE;
      hit.moves = foldMoves;
      hit.inversions = foldInversions;
      hit.reflections = foldReflections;
      hit.passes = foldPasses;
      hit.capped = false;
    }
    return 0;
  }
  const v =
    (tileSDF3(de, foldX, foldY, foldZ) / Math.abs(foldLambda)) *
    SPHAIRAHEDRON_FUDGE;
  if (hit) {
    hit.d = v;
    hit.status = foldCapped
      ? SPHAIRAHEDRON_FOLD_CAPPED
      : SPHAIRAHEDRON_FOLD_DOMAIN;
    hit.moves = foldMoves;
    hit.inversions = foldInversions;
    hit.reflections = foldReflections;
    hit.passes = foldPasses;
    hit.capped = foldCapped;
  }
  return v;
}

/**
 * The author-form estimate (module doc): positive outside the union of
 * tiles, negative inside, zero on the limit set. A CAPPED fold's value is
 * decision-unreliable — read {@link sphairahedronHitInfo}'s status when
 * the reading matters.
 */
export function estimateSphairahedronDistance(
  de: SphairahedronDE,
  p: Vec3,
): number {
  return evaluate3(de, p, null);
}

export interface SphairahedronHit {
  d: number;
  status: SphairahedronFoldStatus;
  moves: number;
  inversions: number;
  reflections: number;
  passes: number;
  capped: boolean;
}

export function makeSphairahedronHit(): SphairahedronHit {
  return {
    d: 0,
    status: SPHAIRAHEDRON_FOLD_DOMAIN,
    moves: 0,
    inversions: 0,
    reflections: 0,
    passes: 0,
    capped: false,
  };
}

/** {@link estimateSphairahedronDistance} plus the fold's counters, written
 * into `out` (a fresh record when omitted). `out.d` is bit-identical to the
 * plain estimate. */
export function sphairahedronHitInfo(
  de: SphairahedronDE,
  p: Vec3,
  out: SphairahedronHit = makeSphairahedronHit(),
): SphairahedronHit {
  evaluate3(de, p, out);
  return out;
}

/** MEMBERSHIP in the union of tiles: the fold reaches a clean pass, skips
 * no pole, and the folded point satisfies the tile's own conditions. Never
 * a threshold on a distance. */
export function sphairahedronContains(de: SphairahedronDE, p: Vec3): boolean {
  fold3(de, p);
  if (foldPole || foldCapped) return false;
  return tileSDF3(de, foldX, foldY, foldZ) <= 0;
}
