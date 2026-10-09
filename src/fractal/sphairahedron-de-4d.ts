/**
 * The sphairahedron family's 4D CPU estimator — `sphairahedron-de.ts` one
 * dimension up: the IIS fold + the accumulated-Jacobian estimate over
 * `xyzw`, duplicating only the arithmetic under the twin-file convention
 * (what a fold IS has one definition, in `sphairahedron.ts`'s module doc).
 * The shipped 4D family is the tetra lift (the 333 wall hyperplanes, the
 * unit 3-ball at the origin, the tile cut by the invariant hyperplane
 * y = 0); the machinery is dimension-free and admits any family the
 * vocabulary resolves at dim 4.
 *
 * THE 4D SPECIFICS. Walls lift the 2D cross-section normal and leave the
 * height axis (index 1) and the fourth axis (index 3) untouched, so the
 * fold's reflections never move `w`; the ball inversion is the full 4D
 * inversion. The estimator's zero set on a slice `w = w0` is the slice of
 * the limit set; the study measured the off-slice anchor EXACT (6.3e-16 —
 * the slice of the analytic 3-sphere recovered to machine precision) and
 * the in-slice one at the 3D anchor's tolerance. Discreteness for a 4D
 * cell is NOT claimed (the preprint's own 4D classification is open) — the
 * panel is exploration evidence that the loop lifts, disclosed wherever a
 * renderer admits the family.
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
import type { Vec4 } from "./types";

/** The flattened construction (4D tables). Face stride 6: sphere
 * `[c0..c3, r, solidInside]`, plane `[n0..n3, h, 0]`. Term stride 6:
 * sphere `[c0..c3, r, inside]`, plane `[n0..n3, h, above]`. */
export interface SphairahedronDE4 {
  readonly boundingRadius: number;
  readonly visibleBoundingRadius: number;
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

/** Build the 4D estimator. Throws for a 3D construction. */
export function buildSphairahedronDE4(
  construction: SphairahedronConstruction,
): SphairahedronDE4 {
  if (construction.dim !== 4) {
    throw new Error(
      `sphairahedron-de-4d: construction dimension ${construction.dim} is not 4`,
    );
  }
  return flatten4(construction);
}

function flatten4(construction: SphairahedronConstruction): SphairahedronDE4 {
  const faceCount = construction.foldFaces.length;
  const faceKind = new Int32Array(faceCount);
  const faceData = new Float64Array(faceCount * 6);
  construction.foldFaces.forEach((f, i) => {
    if (f.face.kind === "sphere") {
      const s = f.face.sphere;
      faceKind[i] = 0;
      for (let k = 0; k < 4; k++) faceData[i * 6 + k] = s.c[k];
      faceData[i * 6 + 4] = s.r;
      faceData[i * 6 + 5] = f.solidInside ? 1 : 0;
    } else {
      const p = f.face.plane;
      faceKind[i] = 1;
      for (let k = 0; k < 4; k++) faceData[i * 6 + k] = p.n[k];
      faceData[i * 6 + 4] = p.h;
    }
  });
  let termTotal = 0;
  for (const piece of construction.pieces) termTotal += piece.terms.length;
  const pieceCount = construction.pieces.length;
  const pieceStart = new Int32Array(pieceCount);
  const pieceLength = new Int32Array(pieceCount);
  const termKind = new Int32Array(termTotal);
  const termData = new Float64Array(termTotal * 6);
  let t = 0;
  construction.pieces.forEach((piece, pi) => {
    pieceStart[pi] = t;
    pieceLength[pi] = piece.terms.length;
    piece.terms.forEach((term) => {
      if (term.kind === "sphere") {
        termKind[t] = 0;
        for (let k = 0; k < 4; k++) termData[t * 6 + k] = term.c[k];
        termData[t * 6 + 4] = term.r;
        termData[t * 6 + 5] = term.inside ? 1 : 0;
      } else {
        termKind[t] = 1;
        for (let k = 0; k < 4; k++) termData[t * 6 + k] = term.n[k];
        termData[t * 6 + 4] = term.h;
        termData[t * 6 + 5] = term.above ? 1 : 0;
      }
      t++;
    });
  });
  return {
    boundingRadius: construction.bound.radius,
    visibleBoundingRadius: construction.bound.radius,
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

// Fold results, read immediately after `fold4` by its callers.
let foldX = 0;
let foldY = 0;
let foldZ = 0;
let foldW = 0;
let foldLambda = 1;
let foldMoves = 0;
let foldInversions = 0;
let foldReflections = 0;
let foldPasses = 0;
let foldCapped = false;
let foldPole = false;
/** The face index of the fold's last move — the 3D twin's per-face
 * attribution one dimension up. −1 when the fold never moved. */
let foldLastFace = -1;

function fold4(de: SphairahedronDE4, p: Vec4): void {
  let x = p[0];
  let y = p[1];
  let z = p[2];
  let w = p[3];
  let lambda = 1;
  let moves = 0;
  let inversions = 0;
  let reflections = 0;
  let passes = 0;
  let capped = false;
  let pole = false;
  let lastFace = -1;
  const fk = de.faceKind;
  const fd = de.faceData;
  const poleFloor2 = SPHAIRAHEDRON_POLE_FLOOR * SPHAIRAHEDRON_POLE_FLOOR;
  for (;;) {
    let moved = false;
    for (let fi = 0; fi < de.faceCount; fi++) {
      const o = fi * 6;
      if (fk[fi] === 0) {
        const dx = x - fd[o];
        const dy = y - fd[o + 1];
        const dz = z - fd[o + 2];
        const dw = w - fd[o + 3];
        const r = fd[o + 4];
        const d2 = dx * dx + dy * dy + dz * dz + dw * dw;
        const r2 = r * r;
        const onRemovedSide = fd[o + 5] === 1 ? d2 > r2 : d2 < r2;
        if (onRemovedSide) {
          if (d2 < poleFloor2 * r2) {
            pole = true;
            continue;
          }
          const k = r2 / d2;
          x = fd[o] + k * dx;
          y = fd[o + 1] + k * dy;
          z = fd[o + 2] + k * dz;
          w = fd[o + 3] + k * dw;
          lambda *= k;
          inversions++;
          moves++;
          moved = true;
          lastFace = fi;
        }
      } else {
        const d =
          fd[o] * x + fd[o + 1] * y + fd[o + 2] * z + fd[o + 3] * w - fd[o + 4];
        if (d > 0) {
          x -= 2 * d * fd[o];
          y -= 2 * d * fd[o + 1];
          z -= 2 * d * fd[o + 2];
          w -= 2 * d * fd[o + 3];
          reflections++;
          moves++;
          moved = true;
          lastFace = fi;
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
  foldW = w;
  foldLambda = lambda;
  foldMoves = moves;
  foldInversions = inversions;
  foldReflections = reflections;
  foldPasses = passes;
  foldCapped = capped;
  foldPole = pole;
  foldLastFace = lastFace;
}

function pieceSDF4(
  de: SphairahedronDE4,
  piece: number,
  x: number,
  y: number,
  z: number,
  w: number,
): number {
  const td = de.termData;
  const tk = de.termKind;
  let best = -Infinity;
  const start = de.pieceStart[piece];
  const end = start + de.pieceLength[piece];
  for (let t = start; t < end; t++) {
    const o = t * 6;
    let v: number;
    if (tk[t] === 0) {
      const dx = x - td[o];
      const dy = y - td[o + 1];
      const dz = z - td[o + 2];
      const dw = w - td[o + 3];
      v = Math.sqrt(dx * dx + dy * dy + dz * dz + dw * dw) - td[o + 4];
      if (td[o + 5] === 0) v = -v;
    } else {
      v = td[o] * x + td[o + 1] * y + td[o + 2] * z + td[o + 3] * w - td[o + 4];
      if (td[o + 5] === 1) v = -v;
    }
    if (v > best) best = v;
  }
  return best;
}

function tileSDF4(
  de: SphairahedronDE4,
  x: number,
  y: number,
  z: number,
  w: number,
): number {
  let best = Infinity;
  for (let piece = 0; piece < de.pieceCount; piece++) {
    const d = pieceSDF4(de, piece, x, y, z, w);
    if (d < best) best = d;
  }
  return best;
}

function evaluate4(
  de: SphairahedronDE4,
  p: Vec4,
  hit: SphairahedronHit4 | null,
): number {
  fold4(de, p);
  if (foldPole) {
    if (hit) {
      hit.d = 0;
      hit.status = SPHAIRAHEDRON_FOLD_POLE;
      hit.moves = foldMoves;
      hit.inversions = foldInversions;
      hit.reflections = foldReflections;
      hit.passes = foldPasses;
      hit.capped = false;
      hit.lastFace = foldLastFace;
    }
    return 0;
  }
  const v =
    (tileSDF4(de, foldX, foldY, foldZ, foldW) / Math.abs(foldLambda)) *
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
    hit.lastFace = foldLastFace;
  }
  return v;
}

/**
 * The author-form estimate one dimension up (module doc of the 3D twin
 * carries the heuristic disclosure; the 4D-specific stance is above).
 */
export function estimateSphairahedronDistance4(
  de: SphairahedronDE4,
  p: Vec4,
): number {
  return evaluate4(de, p, null);
}

export interface SphairahedronHit4 {
  d: number;
  status: SphairahedronFoldStatus;
  moves: number;
  inversions: number;
  reflections: number;
  passes: number;
  capped: boolean;
  /** The face index of the fold's last move — the 3D twin's attribution
   * one dimension up. −1 when the fold never moved. */
  lastFace: number;
}

export function makeSphairahedronHit4(): SphairahedronHit4 {
  return {
    d: 0,
    status: SPHAIRAHEDRON_FOLD_DOMAIN,
    moves: 0,
    inversions: 0,
    reflections: 0,
    passes: 0,
    capped: false,
    lastFace: -1,
  };
}

/** {@link estimateSphairahedronDistance4} plus the fold's counters, written
 * into `out` (a fresh record when omitted). `out.d` is bit-identical to the
 * plain estimate. */
export function sphairahedronHitInfo4(
  de: SphairahedronDE4,
  p: Vec4,
  out: SphairahedronHit4 = makeSphairahedronHit4(),
): SphairahedronHit4 {
  evaluate4(de, p, out);
  return out;
}

/** MEMBERSHIP in the union of tiles at dim 4. */
export function sphairahedronContains4(de: SphairahedronDE4, p: Vec4): boolean {
  fold4(de, p);
  if (foldPole || foldCapped) return false;
  return tileSDF4(de, foldX, foldY, foldZ, foldW) <= 0;
}
