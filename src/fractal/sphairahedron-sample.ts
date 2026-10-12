/**
 * The sphairahedron family's Points sampler — the sphere-inversion family's
 * boundary-sampler role two families over (a present block replaces the
 * chaos game as the cloud's subject, so the explorer needs SOME draw of
 * the set; the limit set is not an IFS attractor and has no chaos game).
 * TWO ARMS, dispatched on the construction itself, because the limit set's
 * own geometry decides what converges onto it:
 *
 * - FINITE constructions (bounded quasi-spheres) draw by the study's
 *   inverse-iteration random walk, whose deep-fold acceptance is measured
 *   there (mean |de| 1.1e-9 against the estimator's zero set, the study's
 *   points sheet).
 * - INFINITE constructions (the sphere-less forms: the tetras' parabolic
 *   plane, the prism terrains, the sphere-less cubes' height fields) draw
 *   by the COLUMN SWEEP below. The walk keeps NOTHING here — the face
 *   group's action confines a walk point's greedy fold depth to single
 *   moves (measured on the infinite tetra: every fold reports 0–4 moves on
 *   either RNG stream, so the 24-move threshold never fires) or, worse,
 *   collapses to a single limit-set speck (measured on the sphere-less
 *   cube1: 97% of a 40k-step budget kept, every point inside a ~0.1 box —
 *   an absorbing deep-fold region, not a sample of the set). Both were the
 *   disclosed fr-l0ma.7 gap; the sweep is the measured fix.
 *
 * THE COLUMN SWEEP. The union of the group's tile images fills one side of
 * its boundary; the estimate `tileSDF(folded)/|λ|·fudge` is positive
 * outside that union and negative inside, and its zero set's INTERNAL face
 * images — where two tiles meet — are 0-TOUCHES (union on both sides), so
 * only the union's outer boundary, the limit set itself, changes the
 * estimate's sign. So: sample (x,z[,w]) uniform in the bound ball's
 * equatorial cross-section, clip a vertical column to the ball, walk it
 * down from the top — the top must read clean sky (positive estimate) —
 * and bisect the first + → − sign flip. The kept point sits ON the limit
 * set (measured |de| ≤ 1e-6 typical, coverage = every column that meets
 * the set). The tetra families' limit set is their divide plane exactly
 * (verified: every generator leaves the plane fixed to 0e+0 drift, and
 * points just below it read inside the union) — and that plane is itself a
 * CAPPED band: the 2D fold of wall reflections and the ball's disk
 * inversion cycles exactly on it, so the sweep treats a capped fold as "no
 * sign information, advance past", the flip bracketing between the clean
 * neighbours. Cost: one fold per scan step plus the bisection, 20–43
 * estimate evals per kept point measured (~1–2 s per 100k-point draw in
 * the worker, the walk's own order); the panel-child figures are
 * `scripts/sphaira-infinite-points.harness.ts`'s.
 *
 * THE COLOR SLOT is the fold's LAST-MOVE FACE (clamped to slot 0 when the
 * fold never moved) — the surface route's per-face slot rule (the
 * hit-info's last-move-face attribution) over the same foldFaces order, so
 * the two consumers cannot disagree about which face owns which hue. The
 * study's DEPTH-color arm stays the surface trap channel
 * (`SPHAIRAHEDRON_TRAP_NORM`).
 *
 * THE 4D HALF runs the same arms at n = 4 (the algebra is
 * dimension-free): the walk walks, the sweep's columns are the (x, z, w)
 * 3-ball cross-section with the flip bisected along y — and hands the
 * points to the standard 4D projection path (the explorer's own rotor +
 * w-ramp machinery) — no slice of its own, the projection being the
 * display; there is no echo to project (the family doc's 4D stance).
 *
 * RESOLUTION PATH: callers hand the CONSTRUCTION (the caller resolves the
 * document). A refused block never reaches here — the cloud request's
 * dispatcher draws nothing for one, except through the morph stance's
 * existence path (`buildSphairahedron`), which is the caller's decision to
 * make, not this module's.
 */
import {
  SPHAIRAHEDRON_FUDGE,
  foldSphairahedron,
  invertPoint,
  makeSphairahedronScratch,
  sphairahedronTileSDF,
  type SphairahedronConstruction,
  type SphairahedronScratch,
} from "./sphairahedron";
import type { Rng } from "./rng";

/** Apply one face involution to `p` in place — the walk's step: the
 * inversion in a sphere face (`I(x) = c + R²(x−c)/|x−c|²`,
 * `sphairahedron.ts`'s shared `invertPoint`) or the reflection in a wall
 * plane. The face's own sense is already resolved into the construction's
 * `solidInside`/plane orientation, so the fold and the walk read the same
 * generator one layer apart. */
function applyFace(
  face: SphairahedronConstruction["foldFaces"][number]["face"],
  p: number[],
): void {
  if (face.kind === "sphere") {
    const q = invertPoint(face.sphere, p);
    for (let k = 0; k < p.length; k++) p[k] = q[k];
  } else {
    const pl = face.plane;
    let d = -pl.h;
    for (let k = 0; k < p.length; k++) d += pl.n[k] * p[k];
    if (d > 0) {
      for (let k = 0; k < p.length; k++) p[k] -= 2 * d * pl.n[k];
    }
  }
}

/** The most boundary samples one Points cloud draws, whatever the
 * document's point count asks — the menger/sphere-inversion cap class,
 * the same two-seconds-of-worker-time rule (one walk step costs one
 * inversion plus, for candidates, one fold probe; one sweep column costs
 * a couple dozen estimate evals). */
export const SPHAIRAHEDRON_POINTS_MAX = 500_000;

/** Minimum fold depth (moves) a kept point's own fold must report — the
 * study's acceptance threshold for the FINITE walk, measured: at 24 the
 * sampled cloud reads mean |de| 1.1e-9 against the estimator's zero set.
 * The sweep arm does not read it (its acceptance is the estimate's own
 * sign). */
export const SPHAIRAHEDRON_POINTS_MIN_FOLDS = 24;

/** Walk steps discarded before keeping begins — the study's warm-up. */
export const SPHAIRAHEDRON_WARMUP = 100;

/** The sweep's downward scan steps per column, before the flip bisects:
 * the flip must fall between two scan samples, so this bounds how far a
 * kept point can sit from the set when the column's band is uncertain —
 * 24 over columns up to twice the bound radius measured flips ≥ 99.5% on
 * every infinite family (the bounded-column geometry keeps one step small
 * near the set's own relief). */
export const SPHAIRAHEDRON_SWEEP_SCAN_STEPS = 24;

/** The sweep's bisection steps after a flip: 30 halvings take a column's
 * bracket to fp resolution, so the kept point's own estimate reads ~1e-11
 * (measured); a bisection step whose fold caps (the tetra plane's own
 * band) breaks with the current bracket — the kept point then sits within
 * half the bracket of the set, measured ≤ 6.5e-3 on the worst column. */
export const SPHAIRAHEDRON_SWEEP_BISECT_STEPS = 30;

/** Total walk-step budget per draw, beyond the warm-up: 8× the ask (the
 * study's 4× acceptance headroom doubled for the deep-threshold tail)
 * plus a floor so a tiny request still warms up meaningfully. A subject
 * that keeps nothing by then draws empty — the bounded-draw rule. The
 * sweep arm needs no such budget: every column either keeps or not, and
 * the column count IS the ask. */
function walkBudget(count: number): number {
  return SPHAIRAHEDRON_WARMUP + Math.max(count * 8, 4096);
}

export interface SphairahedronCloud3 {
  count: number;
  positions: Float32Array;
  /** The fold's last-move face index per point — the color slot. */
  faces: Uint8Array;
}

export interface SphairahedronCloud4 {
  count: number;
  positions: Float32Array;
  /** The fourth coordinate per point, in world w. */
  w: Float32Array;
  /** The fold's last-move face index per point — the color slot. */
  faces: Uint8Array;
}

function emptyCloud(dim: 3 | 4): SphairahedronCloud3 | SphairahedronCloud4 {
  return dim === 4
    ? {
        count: 0,
        positions: new Float32Array(0),
        faces: new Uint8Array(0),
        w: new Float32Array(0),
      }
    : { count: 0, positions: new Float32Array(0), faces: new Uint8Array(0) };
}

function packCloud(
  dim: 3 | 4,
  positions: Float32Array,
  w: Float32Array | null,
  faces: Uint8Array,
  written: number,
): SphairahedronCloud3 | SphairahedronCloud4 {
  if (w) {
    return {
      count: written,
      positions: positions.subarray(0, written * 3),
      w: w.subarray(0, written),
      faces: faces.subarray(0, written),
    };
  }
  return {
    count: written,
    positions: positions.subarray(0, written * 3),
    faces: faces.subarray(0, written),
  };
}

/** The FINITE arm: the study's inverse-iteration random walk. Start at a
 * fixed seed point; one step applies a random FACE's involution — the
 * inversion in a sphere face, or the reflection in a wall plane (the
 * group is generated by ALL the face involutions; the study's walk
 * filtered to spheres because its finite subjects' faces are all spheres
 * under `J` — for any face set the filter would leave a single-generator
 * 2-cycle); keep the current point when its own fold from there is at
 * least {@link SPHAIRAHEDRON_POINTS_MIN_FOLDS} moves deep (the fold's move
 * count is the "distance" to the limit set in moves — points the deep
 * fold cannot improve are already on the set's in-neighborhood). The
 * first {@link SPHAIRAHEDRON_WARMUP} steps are discarded so the seed's
 * transient is gone; the budget is bounded so a measure-zero subject
 * (nothing keeps) draws an EMPTY cloud in bounded time rather than
 * spinning. Deterministic in (construction, count, rng). */
function walkCloud(
  construction: SphairahedronConstruction,
  cap: number,
  rng: Rng,
  scratch: SphairahedronScratch,
): {
  positions: Float32Array;
  w: Float32Array | null;
  faces: Uint8Array;
  written: number;
} {
  const dim = construction.dim;
  const positions = new Float32Array(cap * 3);
  const w = dim === 4 ? new Float32Array(cap) : null;
  const faces = new Uint8Array(cap);
  // The study's seed (0.2, 0.2, 0.2) — the walk's transient is discarded
  // anyway; the value only has to avoid a face centre.
  const p: number[] = new Array<number>(dim).fill(0.2);
  let written = 0;
  const budget = walkBudget(cap);
  for (let i = 0; i < budget && written < cap; i++) {
    const fi = Math.floor(rng() * construction.foldFaces.length);
    applyFace(construction.foldFaces[fi].face, p);
    if (i < SPHAIRAHEDRON_WARMUP) continue;
    // Keep points near the limit set: the fold from here must be deep.
    foldSphairahedron(construction, p, scratch);
    if (scratch.moves < SPHAIRAHEDRON_POINTS_MIN_FOLDS) continue;
    for (let k = 0; k < 3; k++) positions[written * 3 + k] = p[k];
    if (w) w[written] = p[3];
    faces[written] = fi;
    written++;
  }
  return { positions, w, faces, written };
}

/** The INFINITE arm: the column sweep (module doc). Returns the same
 * shaped buffers; a column without a clean sky top or without a flip
 * keeps nothing, so the draw can come back partial for constructions
 * whose limit set the columns miss. */
function sweepCloud(
  construction: SphairahedronConstruction,
  cap: number,
  rng: Rng,
  scratch: SphairahedronScratch,
): {
  positions: Float32Array;
  w: Float32Array | null;
  faces: Uint8Array;
  written: number;
} {
  const dim = construction.dim;
  const positions = new Float32Array(cap * 3);
  const w = dim === 4 ? new Float32Array(cap) : null;
  const faces = new Uint8Array(cap);
  const { center, radius } = construction.bound;
  const r2 = radius * radius;
  const p = new Array<number>(dim).fill(0);
  let written = 0;
  // The estimate at p, from the fold's own scratch (the estimator twins'
  // form; only its SIGN is read here).
  const estimateAt = (): number =>
    (sphairahedronTileSDF(construction, scratch.x) / Math.abs(scratch.lambda)) *
    SPHAIRAHEDRON_FUDGE;
  for (let i = 0; i < cap && written < cap; i++) {
    // Uniform in the equatorial cross-section (the bound ball's shadow):
    // cube-rejected, the height axis pinned to the centre's height.
    let d2 = Infinity;
    while (d2 > r2) {
      d2 = 0;
      for (let k = 0; k < dim; k++) {
        if (k === 1) {
          p[k] = center[k];
          continue;
        }
        p[k] = center[k] + (rng() * 2 - 1) * radius;
        d2 += (p[k] - center[k]) ** 2;
      }
    }
    // The column's vertical extent, clipped to the ball.
    const half = Math.sqrt(Math.max(0, r2 - d2));
    const yTop = center[1] + half;
    const yBot = center[1] - half;
    p[1] = yTop;
    foldSphairahedron(construction, p, scratch);
    if (scratch.capped || scratch.skippedPole || estimateAt() <= 0) {
      continue; // the top is not clean sky; the boundary is not below it
    }
    let above = yTop;
    for (let s = 1; s <= SPHAIRAHEDRON_SWEEP_SCAN_STEPS; s++) {
      const y = yTop - ((yTop - yBot) * s) / SPHAIRAHEDRON_SWEEP_SCAN_STEPS;
      p[1] = y;
      foldSphairahedron(construction, p, scratch);
      if (scratch.capped || scratch.skippedPole) continue; // no sign; advance
      if (estimateAt() > 0) {
        above = y;
        continue;
      }
      // The flip brackets [above, y]; bisect it.
      let lo = above;
      let hi = y;
      for (let b = 0; b < SPHAIRAHEDRON_SWEEP_BISECT_STEPS; b++) {
        const mid = (lo + hi) / 2;
        p[1] = mid;
        foldSphairahedron(construction, p, scratch);
        if (scratch.capped || scratch.skippedPole) break;
        if (estimateAt() > 0) lo = mid;
        else hi = mid;
      }
      p[1] = (lo + hi) / 2;
      for (let k = 0; k < 3; k++) positions[written * 3 + k] = p[k];
      if (w) w[written] = p[3];
      faces[written] = Math.max(scratch.lastFace, 0);
      written++;
      break;
    }
  }
  return { positions, w, faces, written };
}

/** Sample the construction's limit set. Deterministic in (construction,
 * count, rng). Finite constructions walk (the study's arm); infinite ones
 * sweep columns down the estimate's sign (module doc). An empty cloud
 * (count 0) when the construction carries no fold face, the ask is not
 * positive, or — sweep — no column met the set: the caller's gate
 * discloses what that means. */
export function sampleSphairahedronCloud(
  construction: SphairahedronConstruction,
  count: number,
  rng: Rng,
): SphairahedronCloud3 | SphairahedronCloud4 {
  const dim = construction.dim;
  const faceCount = construction.foldFaces.length;
  if (faceCount === 0 || count <= 0) {
    return emptyCloud(dim);
  }
  const cap = Math.min(count, SPHAIRAHEDRON_POINTS_MAX);
  const scratch = makeSphairahedronScratch(dim, 1);
  const { positions, w, faces, written } = construction.finite
    ? walkCloud(construction, cap, rng, scratch)
    : sweepCloud(construction, cap, rng, scratch);
  return packCloud(dim, positions, w, faces, written);
}
