/**
 * 4D Solid tiling representation decision sheet.
 *
 * QUESTION. 3D Solid tiling shipped with NO new voxel memory: the density
 * volume is camera-independent, so the material folds every query into the
 * canonical chamber/cell and samples the untouched texture. 4D Solid cannot
 * do that. `voxel-4d.ts`'s `accumulateVoxels4` deposits into a PROJECTED,
 * w-SLICED 3D grid — rows 0-2 of a `RotorProjection4` give xyz and row 3
 * gives `sRaw`, which becomes a Gaussian slice WEIGHT (floor 0), not a
 * coordinate. w is gone before the material ever sees the texture, so a
 * query-space fold over that texture folds the wrong space. What
 * representation renders `G·(A ∩ C ∩ clip)` and the mirrored x/z/w lattice
 * for a 4D document, faithfully and boundedly?
 *
 * CANDIDATES. Five, all reduced to the same displayed-3D density grid and
 * all mass-normalized before comparison so brightness cannot disguise
 * missing detail:
 *
 * - REF: exhaustive replication through `visitPointTilingImagesExhaustive`,
 *   projecting the IMAGE (never the source). The truth oracle.
 * - A0: direct weighted deposition through the SHIPPED estimator,
 *   `visitPointTilingAttemptBounded` at the frozen 32-image accumulation
 *   fanout cap, into today's 192³ displayed grid.
 * - A1: a Solid-only refinement of A0 — same acceptance/credit rule, but the
 *   K images are chosen by importance proportional to their PROJECTED SLICE
 *   VISIBILITY rather than by the source-independent cursor. Legal because
 *   the deposit stage owns the SETTLED rotor/slice; Points' and Flame's do
 *   not get to assume that in the same way. Implemented LOCALLY here; it
 *   does not touch `point-tiling.ts`.
 * - B: a raw-4D canonical volume over `[-R,R]^4` with NO tiling, NO
 *   projection and NO slice, rendered by a query-space 4D fold — the
 *   view-invariant, resolution-losing alternative.
 * - X: the REFUSED post-projection shortcut — fold the DISPLAYED query of
 *   today's untiled 4D volume. Measured, not argued.
 *
 * FIXTURE. `pentatope()` (the base system of the `tiledPentatope` and
 * `mirroredLattice4` presets), lifted with `toTransform4`, symmetry
 * {order 1, plane xz}, no final transform, no schedule. The certified
 * radius is `surfaceOriginVisibleRadius(buildSurfaceDE4(...))` — exactly
 * what `point-tiling-session.ts` computes for its 4D branch — and every
 * tiling block is resolved through the same
 * resolveTiling -> chamberContentFit -> poseTilingForContent ->
 * resolvePointTilingPlan chain the live sessions use. Four arms: a4 (order
 * 120), b4 (384), f4 (1152) and the shipped `mirroredLattice4` lattice at
 * cellScale 1.6.
 *
 * TWO POSES, both `composeRotorProjection4(rotor, [0,0,0,0])`: the tiled 4D
 * pivot is frozen at the origin, which is `flame-worker-core.ts`'s
 * `applyPointTilingViewPolicy` precedent, and `invWAmp = 1/radiusForAmplitude`
 * with `radiusForAmplitude` the lattice presentation `outerRadius` or the
 * finite plan's origin radius R — the carrier ball is rotation-invariant, so
 * its signed-w amplitude IS its radius at every rotor pose. P0 "identity" is
 * the identity rotor at sliceCenter 0; P1 "w-mixing" is a genuine xw rotation
 * of 0.63 rad (`rotationMatrix4({xw: 0.63})`) at sliceCenter 0.37 — the
 * adversarial pose the point-tiling decision sheet already pinned, reused for
 * continuity. Both use the app's shipped slice width, the literal 0.12
 * (`scene.ts`'s `FOUR_D_SLICE_WIDTH`; the constant is restated rather than
 * imported because that module pulls in Three.js). Slice weight is
 * `sliceWeight(s, center, width, 0)` everywhere — Solid's floor-0
 * convention, NOT the flame's 0.06 — with `s = clamp(sRaw*invWAmp, -1, 1)`,
 * and a deposit whose weight falls below `accumulateVoxels4`'s
 * `SKIP_WEIGHT` (1e-3) is skipped.
 *
 * PREDECLARED LIMITS. These constants are the decision, not values tuned
 * from the results below; they are printed as a PASS/FAIL matrix rather than
 * asserted, because a candidate failing a predeclared cap is a RESULT:
 *
 * - MEMORY_TEXTURE_CAP_BYTES 64 MiB (today's 192³ RGBA8 is 28.3 MB);
 * - MEMORY_WORKING_SET_CAP_BYTES 300 MiB (today's 192³ Float32
 *   density + RGB is 113 MB);
 * - MIN_VOXELS_PER_CONTENT_DIAMETER 32 — below this a copy is a blob, not a
 *   fold;
 * - MAX_NORMALIZED_L1 0.30 — the band the point-tiling sheet measured for
 *   its shipped lattice thinning (0.2242 / 0.2895);
 * - FANOUT_CAP 32 (`POINT_TILING_ACCUMULATION_FANOUT_CAP`), cumulative
 *   selected <= attempts, cumulative candidateTests <= attempts * 1.05;
 * - MAX_FETCH_MULTIPLIER 2 — a tiled 4D frame may not cost more than 2x the
 *   untiled per-ray texture fetches;
 * - MAX_REBUILD_MULTIPLIER 2 — a settled rotor/slice edit may not cost more
 *   than 2x today's untiled 4D Solid restart;
 * - A1 unbiasedness is accepted within a predeclared Monte-Carlo tolerance
 *   of 5% (finite) / 20% (lattice) relative total-mass agreement with REF on
 *   a SHARED source set.
 *
 * ASSERTED (structural invariants only, never a cap's verdict and never wall
 * clock): the projection round-trip `project(unproject(v)) == v` to 1e-12;
 * the finite `E <= R` claim, measured as the max displayed radius over each
 * finite REF run; credit accounting (`selected <= attempts`, per-acceptance
 * selection <= 32); A1's unbiasedness within the tolerance above; B's
 * pose-independence, byte-identical; and that no lattice source landed on a
 * mirror wall (A1's local lattice CDF is built over the plan's full live
 * cell list, i.e. wall-mask 0).
 *
 * COLUMN DEFINITIONS. `E` is the displayed grid's world half-extent: `R` for
 * the finite arms (images are 4D isometries fixing the origin and
 * orthographic projection of a rotation is non-expanding, so every displayed
 * image lies in ball(0,R) — verified empirically, not assumed) and the
 * presentation `outerRadius` (10R) for the lattice. `voxelsPerContentDiameter`
 * = 2R/(2E/N) is the detail column. `l1Native` is the normalized L1 against
 * REF deposited at the candidate's own resolution (estimator/noise error);
 * `l1Fine` is the normalized L1 on the shared fine grid (total error
 * INCLUDING resolution loss). `occupancy` is the fraction of fine-grid
 * voxels above a fixed normalized threshold (1e-7 of unit mass) and
 * `occupancyRetained` is that over REF's. `candidateTests` counts image
 * candidates ENUMERATED OR PROPOSED and not necessarily emitted: 0 for A0
 * finite (it indexes the coset representative directly), `selected` for
 * every CDF-proposing lattice arm, the full enumerated image list for A1
 * finite, and `emitted` for REF, which visits every candidate by definition.
 * `visibleFraction` is deposits surviving the 1e-3 skip gate over emitted.
 *
 * A NOTE ON THE FINE GRID. One fine resolution (default 128) is shared by
 * every arm, so on the LATTICE arm — whose E is 10R — the fine grid resolves
 * the content at only 12.8 voxels per content diameter, BELOW A's own 19.2.
 * `l1Fine` there therefore prices the carrier's dilution and cannot expose
 * fine detail; `voxelsPerContentDiameter` is the direct measure on that arm
 * and is the column the lattice decision turns on. On the finite arms the
 * fine grid is 128 per content diameter against A's native 192, so `l1Fine`
 * slightly UNDER-states A's advantage — the conservative direction.
 *
 * MEASURED VERDICT (Node 22, 2026-09-01, the production command below;
 * 345s total). R = 1.0317142958214038; plans 120/384/1152 matrices
 * (16442/52546/157634 B) and 171 lattice cells (h = 1.650743, outer =
 * 10.317143, 7834 B). Projection round-trip worst error 2.220e-16.
 *
 * ACCEPTANCE IS NOT 1/order ON A REAL ATTRACTOR: 3.0260% / 1.9550% /
 * 0.6978% for a4/b4/f4 against the uniform-point 0.833%/0.260%/0.087% the
 * point-tiling sheet measured, i.e. the pentatope is 3.6x/7.5x/8.0x
 * over-represented in these chambers. Exhaustive replication emits exactly
 * 120/384/1152 images per accepted source (128.995 mean on the lattice,
 * after the carrier rejection), and the finite `E <= R` claim held on every
 * finite REF run.
 *
 * A0, TODAY'S SHIPPED ESTIMATOR, SPENDS 30-43% OF ITS 32-IMAGE FANOUT ON
 * IMAGES THE SLICE THROWS AWAY: visibleFraction 0.9111/0.9453/0.9731/0.6649
 * at P0 and 0.6241/0.6675/0.7015/0.6435 at P1. A1 spends none of it
 * (1.0000 on all three finite arms; 0.9052/0.9124 on the lattice, where the
 * ceiling is a bound and not the actual value), and buys 1.4x-2.7x lower
 * l1Fine for it: A0 0.1657/0.3032/0.4269/0.0796 (P0) and
 * 0.1659/0.3213/0.5571/0.0875 (P1) against A1 0.1182/0.2230/0.3236/0.0470
 * and 0.0624/0.1798/0.3297/0.0529. A1's mass is unbiased to 3e-16..1e-14
 * (finite, exact by construction) and 1.6e-4/2.2e-4 (lattice, the
 * stratified-proposal estimator) on shared source sets. It is not free:
 * enumeration on acceptance costs candidateTests 3.63x/7.51x/8.04x attempts
 * — the candTest cap FAILS on every finite arm, where A0's direct coset
 * index tests 0 — and the rebuild cap FAILS on b4/f4 (3.05x-3.39x) and
 * marginally on a4 at P1 (2.036x), while A0 rebuilds at 0.82x-1.28x.
 * The convergence sweep prices that trade the other way round: A1 at 1x
 * beats A0 at 4x on a4 (0.0624 vs 0.1233), ties it on b4 (0.1798 vs 0.1856)
 * and f4 (0.3297 vs 0.2953), so A1's ~3x accumulate cost buys roughly A0's
 * 4x source budget.
 *
 * B IS VIEW-INVARIANT AND CANNOT DRAW THE OBJECT. Its raw volume reads no
 * pose at all (byte-identical rebuild and byte-identical render), so its
 * rotor/slice rebuild is 0 ms, and at N_B = 64 it lands EXACTLY on the
 * texture cap (67108864 B = 64 MiB) with a 256 MiB working set. But 64
 * voxels per content diameter against A's 192 shows up as l1Fine
 * 0.7432/0.7489/0.8290/0.9806 (P0) and 0.7976/0.7610/0.7392/1.0554 (P1) —
 * every one over the 0.30 cap, and the lattice arm at or above 1.0 — with
 * occupancyRetained 1.43-1.61 on the finite arms (it BLURS mass outward
 * rather than losing it) and 0.30-0.34 on the lattice. Its per-frame price
 * is the killer: the w-tap fan is 24 taps on the finite arms and 231 on the
 * lattice (where invWAmp is normalized by the 10R carrier, so one slice
 * width is 1.2R of world w), multiplying all seven folded query paths;
 * fetchMultiplier 24x / 231x against a cap of 2. A single CPU render pass
 * took 12.4-42.2 s.
 *
 * X, THE POST-PROJECTION SHORTCUT, IS CLOSED. l1Fine 1.8399-1.9976 on the
 * finite arms (the metric's ceiling is 2.0) and 1.5358/1.9650 on the
 * lattice, with occupancy symmetric-difference 1.65-2.52 of REF's occupied
 * set at both poses. Folding a query whose w has already been integrated
 * away does not render a different-quality picture of the same object; it
 * renders a different object.
 *
 * THE LATTICE ARM FAILS ON DETAIL, NOT ON ESTIMATOR ERROR. At the frozen
 * 10R carrier the displayed grid holds 19.20 voxels per content diameter
 * against the 32 floor, while A0/A1's l1Fine there is the best on the sheet
 * (0.0796/0.0470). The carrier sweep clears the detail floor at 6R (32.00)
 * and 4R (48.00) with l1Fine essentially flat (0.0875 / 0.0873 / 0.0791 /
 * 0.0987 at 10R/8R/6R/4R) and cell counts 171/81/33/19 — but every carrier
 * but 10R is REFUSED by `resolvePointTilingPlan` ("point-family lattice
 * presentation is frozen at 8R -> 10R"), so those three rows were measured
 * against this sheet's own local mirror of `buildLatticePlan`, pinned
 * cell-for-cell against the shipped builder at the 10R row.
 *
 * DECISION (the presentation-policy question this sheet left open): the
 * 8R -> 10R policy STAYS ONE frozen pair across every renderer, including
 * 4D Solid's volume extent, and the lattice arm's copy detail is DISCLOSED
 * rather than re-windowed. The 6R Solid-specific carrier is refused on the
 * cross-renderer one-object rule — the same document would draw 33 cells in
 * Solid and 171 in Points/Flame/Surface — with no measured advantage to
 * offset it (L1 flat across carriers; fewer, sharper copies is a
 * presentation preference against an already-qualified shared window, and
 * would re-qualify every `lattice-presentation.verify.mjs` row per
 * renderer). Raising the authored resolution cannot reach the floor it is
 * raised for: 32 voxels per content diameter at 10R needs 320^3 (~131 MiB
 * RGBA8 texture, ~524 MiB working set), past both predeclared memory caps,
 * so 256^3 buys 1.33x detail for a cap-breaking 2.33x texture. Full
 * rationale and figures in `docs/tiling-contract.md`'s 4D Solid
 * representation section; the shipped user-facing disclosure is the panel's
 * 4D Solid lattice note.
 *
 * Run (the recorded numbers):
 *   NODE_OPTIONS=--max-old-space-size=8192 \
 *   npx vitest run --config scripts/vitest.harness.config.ts \
 *     scripts/solid-tiling-4d.harness.ts
 *
 * Env knobs (defaults shown):
 *   SOLID4_ATTEMPTS=2000000  SOLID4_FINE=128  SOLID4_NATIVE=192
 *   SOLID4_NB=64             SOLID4_MARCH_W=48  SOLID4_MARCH_H=36
 * SOLID4_NB is the LARGEST entry of B's raw-resolution sweep; the headline
 * N_B is the largest swept entry that fits both memory caps.
 */

import { rotationMatrix4, toTransform4 } from "../src/fractal/affine4";
import { WARMUP_ITERATIONS } from "../src/fractal/chaos-game";
import {
  prepareChaosGame4,
  plotPoint4,
  stepOrbit4,
  type PreparedChaosGame4,
} from "../src/fractal/chaos-game-4d";
import {
  chamberContentFit,
  poseTilingForContent,
} from "../src/fractal/chamber-content";
import {
  LATTICE_PRESENTATION_FADE_START_MULT,
  LATTICE_PRESENTATION_RADIUS_MULT,
  latticePresentationVisibility,
  type LatticePresentationPolicy,
} from "../src/fractal/lattice-march";
import {
  createPointTilingCursorState,
  POINT_TILING_ACCUMULATION_FANOUT_CAP,
  POINT_TILING_STABILIZER_REL_EPS,
  pointTilingContains,
  resolvePointTilingPlan,
  visitPointTilingAttemptBounded,
  visitPointTilingImagesExhaustive,
  type LatticePointTilingPlan,
  type PointTilingPlan,
} from "../src/fractal/point-tiling";
import { pentatope } from "../src/fractal/presets";
import {
  composeRotorProjection4,
  sliceWeight,
  type RotorProjection4,
} from "../src/fractal/project4";
import { mulberry32 } from "../src/fractal/rng";
import { surfaceOriginVisibleRadius } from "../src/fractal/surface-de";
import { buildSurfaceDE4 } from "../src/fractal/surface-de-4d";
import {
  foldToChamber,
  isResolvedLatticeTiling,
  mirrorLatticeCoordinate,
  resolveTiling,
  type LatticeTilingSpec,
  type ResolvedLatticeTiling,
  type ResolvedTiling,
  type TilingSpec,
} from "../src/fractal/tiling";
import type { SymmetryParams, Vec4 } from "../src/fractal/types";

// ------------------------------------------------------- predeclared limits

const MEMORY_TEXTURE_CAP_BYTES = 64 * 1024 * 1024;
const MEMORY_WORKING_SET_CAP_BYTES = 300 * 1024 * 1024;
const MIN_VOXELS_PER_CONTENT_DIAMETER = 32;
const MAX_NORMALIZED_L1 = 0.3;
const FANOUT_CAP = POINT_TILING_ACCUMULATION_FANOUT_CAP;
const MAX_CANDIDATE_TEST_FACTOR = 1.05;
const MAX_FETCH_MULTIPLIER = 2;
const MAX_REBUILD_MULTIPLIER = 2;
const UNBIAS_REL_TOLERANCE_FINITE = 0.05;
const UNBIAS_REL_TOLERANCE_LATTICE = 0.2;

// ------------------------------------------------------------ frozen policy

/** `accumulateVoxels4`'s own skip: below this a deposit rounds away to
 * nothing in the packed texture. */
const SKIP_WEIGHT = 1e-3;
/** `scene.ts`'s FOUR_D_SLICE_WIDTH, restated rather than imported (that
 * module pulls in Three.js). */
const SLICE_WIDTH = 0.12;
/** The adversarial pose the point-tiling decision sheet pinned. */
const POSE1_XW_ANGLE = 0.63;
const POSE1_SLICE_CENTER = 0.37;
/** Half-width of B's w-tap fan, in slice standard deviations. */
const TAP_SIGMAS = 3;
/** Normalized-mass threshold for the occupancy columns. */
const OCCUPANCY_THRESHOLD = 1e-7;
/** flam3-style golden u32 phase — `point-tiling.ts`'s own cursor constant,
 * restated because it is module-private there. */
const GOLDEN_U32 = 0x9e3779b1;
const U32_RANGE = 0x1_0000_0000;

const SYMMETRY: SymmetryParams = { order: 1, plane: "xz" };
const ORBIT_SEED = 0x501d4;
/** `voxel-material.ts`'s primary march budget rule, restated: 220 tuned for
 * 256³, scaled with the grid. */
const marchStepsForGrid = (size: number): number =>
  Math.max(220, Math.ceil((size * 220) / 256));
const REFINE_STEPS = 5;
const GRADIENT_FETCHES = 6;
const COLOR_FETCHES = 1;
const SHADOW_STEPS = 48;
const AO_STEPS = 4;
/** The seven query paths the 3D tiling arm folds through one wrapper. */
const TILED_QUERY_PATHS = [
  "primary",
  "refine",
  "gradient",
  "shadow",
  "AO",
  "floor shadow",
  "floor AO",
] as const;

// ------------------------------------------------------------------- knobs

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer, not ${raw}`);
  }
  return value;
}

const ATTEMPTS = positiveInt("SOLID4_ATTEMPTS", 2_000_000);
const FINE = positiveInt("SOLID4_FINE", 128);
const NATIVE = positiveInt("SOLID4_NATIVE", 192);
const NB_MAX = positiveInt("SOLID4_NB", 64);
const MARCH_W = positiveInt("SOLID4_MARCH_W", 48);
const MARCH_H = positiveInt("SOLID4_MARCH_H", 36);
/** Exhaustive replication over ~171 lattice cells costs `cells` deposits per
 * source; the lattice REF therefore runs on a reduced source budget so its
 * deposit count stays comparable to the finite arms'. Every table reports
 * the attempts each row actually spent. */
const REF_LATTICE_ATTEMPT_DIVISOR = 8;

const NB_SWEEP = [32, 48, 56, NB_MAX].filter(
  (n, i, all) => all.indexOf(n) === i,
);
NB_SWEEP.sort((a, b) => a - b);

// -------------------------------------------------------------- fixture

const TRANSFORMS = pentatope();
const TRANSFORMS4 = TRANSFORMS.map(toTransform4);
const SURFACE_DE4 = buildSurfaceDE4(TRANSFORMS, null, SYMMETRY, {});
const R = surfaceOriginVisibleRadius(SURFACE_DE4);

interface Pose {
  label: string;
  rotor: number[];
  sliceCenter: number;
}

// prettier-ignore
const IDENTITY_ROTOR = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

const POSES: Pose[] = [
  { label: "P0 identity", rotor: IDENTITY_ROTOR, sliceCenter: 0 },
  {
    label: "P1 w-mixing",
    rotor: rotationMatrix4({ xw: POSE1_XW_ANGLE }),
    sliceCenter: POSE1_SLICE_CENTER,
  },
];

interface Arm {
  label: string;
  spec: TilingSpec;
  resolved: ResolvedTiling;
  plan: PointTilingPlan;
  /** Displayed-grid world half-extent. */
  E: number;
  /** The carrier ball whose radius IS the signed-w amplitude at every pose. */
  radiusForAmplitude: number;
}

function buildArm(
  label: string,
  spec: TilingSpec,
  policy?: LatticePresentationPolicy,
): Arm {
  const raw = resolveTiling(spec, R, policy);
  if (!raw) throw new Error(`arm ${label}: tiling resolved to null`);
  const fit = chamberContentFit(TRANSFORMS, null, raw, true, SYMMETRY, null);
  const resolved = poseTilingForContent(raw, fit);
  const plan = resolvePointTilingPlan(resolved, 4);
  if (!plan) throw new Error(`arm ${label}: no point tiling plan`);
  const lattice = isResolvedLatticeTiling(resolved);
  const radiusForAmplitude = lattice ? resolved.presentation.outerRadius : R;
  return {
    label,
    spec,
    resolved,
    plan,
    E: lattice ? resolved.presentation.outerRadius : R,
    radiusForAmplitude,
  };
}

const LATTICE_SPEC: LatticeTilingSpec = { kind: "lattice", cellScale: 1.6 };

/**
 * A LOCAL mirror of `point-tiling.ts`'s private `buildLatticePlan`, for the
 * carrier sweep alone.
 *
 * `resolvePointTilingPlan` REFUSES any presentation but the frozen 8R -> 10R
 * pair ("point tiling: point-family lattice presentation is frozen at
 * 8R -> 10R"), so pricing the bead's "smaller renderer-specific carrier"
 * alternative is not reachable through the shipped builder at all. This
 * rebuilds the same cell walk, the same lower-radius coverage ceiling and
 * the same ascending-sum CDF against an alternative policy, and the sweep
 * PINS it against the production builder at the shipped 10R row before
 * trusting any other row. The wall-mask table is filled with the mask-0 CDF
 * throughout: the sheet separately asserts that no source lands on a mirror
 * wall, so no other entry is ever indexed.
 */
function buildLocalLatticePlan(
  tiling: ResolvedLatticeTiling,
): LatticePointTilingPlan {
  const repeated = 3;
  const { radius, h, presentation } = tiling;
  const indexRadius = (presentation.outerRadius + radius) / (2 * h);
  const maxIndex = Math.floor(indexRadius);
  const tuples: number[] = [];
  for (let a = -maxIndex; a <= maxIndex; a++) {
    for (let b = -maxIndex; b <= maxIndex; b++) {
      for (let c = -maxIndex; c <= maxIndex; c++) {
        if (a * a + b * b + c * c <= indexRadius * indexRadius) {
          tuples.push(a, b, c);
        }
      }
    }
  }
  const liveCells: number[] = [];
  const liveUpper: number[] = [];
  for (let cell = 0; cell < tuples.length / repeated; cell++) {
    let squared = 0;
    for (let axis = 0; axis < repeated; axis++) {
      const index = tuples[cell * repeated + axis];
      squared += index * index;
    }
    const centerRadius = 2 * h * Math.sqrt(squared);
    const lowerRadius = Math.max(0, centerRadius - radius);
    const upper = latticePresentationVisibility(
      lowerRadius,
      presentation.fadeStartRadius,
      presentation.outerRadius,
    );
    if (upper <= 0) continue;
    for (let axis = 0; axis < repeated; axis++) {
      liveCells.push(tuples[cell * repeated + axis]);
    }
    liveUpper.push(upper);
  }
  const cells = Int16Array.from(liveCells);
  const upper = Float64Array.from(liveUpper);
  const ordinals = upper
    .reduce<number[]>((all, _value, index) => {
      all.push(index);
      return all;
    }, [])
    .sort((a, b) => upper[a] - upper[b] || a - b);
  let upperTotal = 0;
  for (const cell of ordinals) upperTotal += upper[cell];
  const cumulative = new Float64Array(ordinals.length);
  let running = 0;
  for (let index = 0; index < ordinals.length; index++) {
    running += upper[ordinals[index]];
    cumulative[index] = running / upperTotal;
  }
  const cdf = {
    cellOrdinals: Uint16Array.from(ordinals),
    cumulative,
    upperTotal,
  };
  return {
    kind: "lattice",
    dimension: 4,
    tiling,
    repeatedAxes: repeated,
    cells,
    upper,
    cdfByWallMask: Object.freeze(Array.from({ length: 8 }, () => cdf)),
    memoryBytes:
      cells.byteLength +
      upper.byteLength +
      8 * (cdf.cellOrdinals.byteLength + cdf.cumulative.byteLength),
  };
}

/** The carrier sweep's arm: the same resolve/fit/pose chain, then the local
 * plan builder above (the shipped one refuses every non-10R carrier). */
function buildCarrierArm(
  label: string,
  policy: LatticePresentationPolicy,
): Arm {
  const raw = resolveTiling(LATTICE_SPEC, R, policy);
  const fit = chamberContentFit(TRANSFORMS, null, raw, true, SYMMETRY, null);
  const resolved = poseTilingForContent(raw, fit) as ResolvedLatticeTiling;
  return {
    label,
    spec: LATTICE_SPEC,
    resolved,
    plan: buildLocalLatticePlan(resolved),
    E: resolved.presentation.outerRadius,
    radiusForAmplitude: resolved.presentation.outerRadius,
  };
}

const ARMS: Arm[] = [
  buildArm("a4", { group: "a4" }),
  buildArm("b4", { group: "b4" }),
  buildArm("f4", { group: "f4" }),
  buildArm("lattice1.6", LATTICE_SPEC),
];

// ---------------------------------------------------------------- grids

interface Grid {
  n: number;
  e: number;
  data: Float64Array;
}

function makeGrid(n: number, e: number): Grid {
  return { n, e, data: new Float64Array(n * n * n) };
}

/** Displayed-3D bucketing, x-fastest — `voxel.ts`'s
 * `vz*size*size + vy*size + vx` order exactly. */
function depositGrid(
  grid: Grid,
  x: number,
  y: number,
  z: number,
  weight: number,
): boolean {
  const { n, e } = grid;
  const inv = n / (2 * e);
  const vx = Math.floor((x + e) * inv);
  if (vx < 0 || vx >= n) return false;
  const vy = Math.floor((y + e) * inv);
  if (vy < 0 || vy >= n) return false;
  const vz = Math.floor((z + e) * inv);
  if (vz < 0 || vz >= n) return false;
  grid.data[vz * n * n + vy * n + vx] += weight;
  return true;
}

function gridMass(grid: Grid): number {
  let sum = 0;
  for (let i = 0; i < grid.data.length; i++) sum += grid.data[i];
  return sum;
}

/** Mass-preserving box resample between two grids sharing the same world
 * half-extent. Works in both directions; zero source voxels cost nothing. */
function resampleGrid(src: Grid, n: number): Grid {
  if (src.n === n) return src;
  const out = makeGrid(n, src.e);
  const srcN = src.n;
  const scale = n / srcN;
  // Per-axis overlap lists: source cell i covers [i*scale, (i+1)*scale) in
  // destination units.
  const starts = new Int32Array(srcN);
  const counts = new Int32Array(srcN);
  const weightsByAxis: Float64Array[] = [];
  for (let i = 0; i < srcN; i++) {
    const lo = i * scale;
    const hi = (i + 1) * scale;
    const first = Math.max(0, Math.floor(lo));
    const last = Math.min(n - 1, Math.ceil(hi) - 1);
    const count = Math.max(1, last - first + 1);
    starts[i] = first;
    counts[i] = count;
    const w = new Float64Array(count);
    let total = 0;
    for (let k = 0; k < count; k++) {
      const cellLo = first + k;
      const overlap = Math.min(hi, cellLo + 1) - Math.max(lo, cellLo);
      w[k] = Math.max(0, overlap);
      total += w[k];
    }
    if (total <= 0) {
      w[0] = 1;
      total = 1;
    }
    for (let k = 0; k < count; k++) w[k] /= total;
    weightsByAxis.push(w);
  }
  const data = src.data;
  for (let sz = 0; sz < srcN; sz++) {
    for (let sy = 0; sy < srcN; sy++) {
      const rowBase = sz * srcN * srcN + sy * srcN;
      for (let sx = 0; sx < srcN; sx++) {
        const value = data[rowBase + sx];
        if (value === 0) continue;
        const wz = weightsByAxis[sz];
        const wy = weightsByAxis[sy];
        const wx = weightsByAxis[sx];
        for (let kz = 0; kz < counts[sz]; kz++) {
          const dz = starts[sz] + kz;
          const vz = wz[kz] * value;
          for (let ky = 0; ky < counts[sy]; ky++) {
            const dy = starts[sy] + ky;
            const vy = wy[ky] * vz;
            const base = dz * n * n + dy * n + starts[sx];
            for (let kx = 0; kx < counts[sx]; kx++) {
              out.data[base + kx] += wx[kx] * vy;
            }
          }
        }
      }
    }
  }
  return out;
}

interface Comparison {
  l1: number;
  occupancy: number;
  occupancyRetained: number;
  occSymDiff: number;
}

function compareGrids(actual: Grid, reference: Grid): Comparison {
  if (actual.data.length !== reference.data.length) {
    throw new Error("compareGrids: mismatched resolutions");
  }
  const sumA = gridMass(actual);
  const sumR = gridMass(reference);
  let l1 = 0;
  let occA = 0;
  let occR = 0;
  let symDiff = 0;
  for (let i = 0; i < actual.data.length; i++) {
    const a = sumA > 0 ? actual.data[i] / sumA : 0;
    const r = sumR > 0 ? reference.data[i] / sumR : 0;
    l1 += Math.abs(a - r);
    const oa = a > OCCUPANCY_THRESHOLD;
    const or = r > OCCUPANCY_THRESHOLD;
    if (oa) occA++;
    if (or) occR++;
    if (oa !== or) symDiff++;
  }
  return {
    l1,
    occupancy: occA / actual.data.length,
    occupancyRetained: occR > 0 ? occA / occR : 1,
    occSymDiff: occR > 0 ? symDiff / occR : 0,
  };
}

// ----------------------------------------------------------------- orbit

/** The ordinary 4D chaos game, warmed up exactly like `accumulateVoxels4`'s
 * fresh-grid path (a random seed point then WARMUP_ITERATIONS unrecorded
 * steps through the real, non-inlined `stepOrbit4`). Every consumer here
 * plots through the real `plotPoint4`. */
function runOrbit(
  prepared: PreparedChaosGame4,
  seed: number,
  iterations: number,
  plot: (px: number, py: number, pz: number, pw: number) => void,
): void {
  const rng = mulberry32(seed);
  let x = rng() - 0.5;
  let y = rng() - 0.5;
  let z = rng() - 0.5;
  let w = rng() - 0.5;
  for (let i = 0; i < WARMUP_ITERATIONS; i++) {
    const step = stepOrbit4(prepared, x, y, z, w, rng, rng, -1);
    x = step.x;
    y = step.y;
    z = step.z;
    w = step.w;
  }
  for (let i = 0; i < iterations; i++) {
    const step = stepOrbit4(prepared, x, y, z, w, rng, rng, -1);
    x = step.x;
    y = step.y;
    z = step.z;
    w = step.w;
    const p = plotPoint4(prepared, x, y, z, w, rng);
    plot(p[0], p[1], p[2], p[3]);
  }
}

const PREPARED = prepareChaosGame4(TRANSFORMS4, null, SYMMETRY, null);

// ------------------------------------------------------------- projection

interface View {
  rotorProj: RotorProjection4;
  invWAmp: number;
  sliceCenter: number;
  sliceWidth: number;
}

function viewFor(arm: Arm, pose: Pose): View {
  return {
    rotorProj: composeRotorProjection4(pose.rotor, [0, 0, 0, 0]),
    invWAmp: 1 / arm.radiusForAmplitude,
    sliceCenter: pose.sliceCenter,
    sliceWidth: SLICE_WIDTH,
  };
}

/** Scratch for one projected image: projX, projY, projZ, sliceWeight. */
const PROJ = new Float64Array(4);

function projectImage(
  view: View,
  x: number,
  y: number,
  z: number,
  w: number,
): void {
  const rp = view.rotorProj;
  PROJ[0] = rp[0] * x + rp[1] * y + rp[2] * z + rp[3] * w + rp[4];
  PROJ[1] = rp[5] * x + rp[6] * y + rp[7] * z + rp[8] * w + rp[9];
  PROJ[2] = rp[10] * x + rp[11] * y + rp[12] * z + rp[13] * w + rp[14];
  const sRaw = rp[15] * x + rp[16] * y + rp[17] * z + rp[18] * w + rp[19];
  const scaled = sRaw * view.invWAmp;
  const s = scaled < -1 ? -1 : scaled > 1 ? 1 : scaled;
  PROJ[3] = sliceWeight(s, view.sliceCenter, view.sliceWidth, 0);
}

// --------------------------------------------------------------- run stats

interface RunStats {
  attempts: number;
  accepted: number;
  candidateTests: number;
  selected: number;
  emitted: number;
  deposits: number;
  maxDisplayedRadius: number;
  maxSelectionPerAcceptance: number;
  accumulateMs: number;
}

function emptyStats(): RunStats {
  return {
    attempts: 0,
    accepted: 0,
    candidateTests: 0,
    selected: 0,
    emitted: 0,
    deposits: 0,
    maxDisplayedRadius: 0,
    maxSelectionPerAcceptance: 0,
    accumulateMs: 0,
  };
}

interface CandidateRun {
  fine: Grid;
  native: Grid;
  stats: RunStats;
}

/** The shared image visitor: project the IMAGE, weigh by the floor-0 slice,
 * skip below SKIP_WEIGHT, deposit into both grids. */
function makeVisitor(
  view: View,
  fine: Grid,
  native: Grid,
  stats: RunStats,
): (x: number, y: number, z: number, w: number, imageWeight: number) => void {
  return (x, y, z, w, imageWeight) => {
    projectImage(view, x, y, z, w);
    stats.emitted++;
    const radius = Math.hypot(PROJ[0], PROJ[1], PROJ[2]);
    if (radius > stats.maxDisplayedRadius) stats.maxDisplayedRadius = radius;
    const weight = imageWeight * PROJ[3];
    if (weight < SKIP_WEIGHT) return;
    stats.deposits++;
    depositGrid(fine, PROJ[0], PROJ[1], PROJ[2], weight);
    depositGrid(native, PROJ[0], PROJ[1], PROJ[2], weight);
  };
}

// ----------------------------------------------------------------- REF

function runReference(arm: Arm, pose: Pose, attempts: number): CandidateRun {
  const view = viewFor(arm, pose);
  const fine = makeGrid(FINE, arm.E);
  const native = makeGrid(NATIVE, arm.E);
  const stats = emptyStats();
  const visit = makeVisitor(view, fine, native, stats);
  const start = Date.now();
  runOrbit(PREPARED, ORBIT_SEED, attempts, (px, py, pz, pw) => {
    stats.attempts++;
    const emitted = visitPointTilingImagesExhaustive(
      arm.plan,
      px,
      py,
      pz,
      pw,
      (x, y, z, w, weight) => visit(x, y, z, w, weight),
    );
    if (emitted > 0) stats.accepted++;
  });
  stats.accumulateMs = Date.now() - start;
  // REF visits every candidate by definition.
  stats.candidateTests = stats.emitted;
  stats.selected = stats.emitted;
  return { fine, native, stats };
}

// ------------------------------------------------------------------- A0

function runA0(arm: Arm, pose: Pose, attempts: number): CandidateRun {
  const view = viewFor(arm, pose);
  const fine = makeGrid(FINE, arm.E);
  const native = makeGrid(NATIVE, arm.E);
  const stats = emptyStats();
  const visit = makeVisitor(view, fine, native, stats);
  const cursor = createPointTilingCursorState();
  const lattice = arm.plan.kind === "lattice";
  let previousSelected = 0;
  const start = Date.now();
  runOrbit(PREPARED, ORBIT_SEED, attempts, (px, py, pz, pw) => {
    visitPointTilingAttemptBounded(
      arm.plan,
      px,
      py,
      pz,
      pw,
      FANOUT_CAP,
      cursor,
      (x, y, z, w, weight) => visit(x, y, z, w, weight),
    );
    const delta = cursor.selected - previousSelected;
    previousSelected = cursor.selected;
    if (delta > stats.maxSelectionPerAcceptance) {
      stats.maxSelectionPerAcceptance = delta;
    }
  });
  stats.accumulateMs = Date.now() - start;
  stats.attempts = cursor.attempts;
  stats.accepted = cursor.accepted;
  stats.selected = cursor.selected;
  // A0's finite arm indexes the coset representative directly; its lattice
  // arm locates one CDF proposal per selection, each of which may be
  // rejected before the visitor is called.
  stats.candidateTests = lattice ? cursor.selected : 0;
  return { fine, native, stats };
}

// ------------------------------------------------------------------- A1

/** `point-tiling.ts`'s own u32 golden phase, restated (module-private
 * there): the deterministic stratification offset. No RNG is consulted. */
function u32Phase(cursor: number): number {
  return (Math.imul(cursor, GOLDEN_U32) >>> 0) / U32_RANGE;
}

/** Systematic (stratified) resampling of `count` indices from a cumulative
 * weight array whose last entry is the total. Deterministic. */
function systematicPick(
  cumulative: Float64Array,
  length: number,
  total: number,
  count: number,
  cursor: number,
  out: Int32Array,
): void {
  const phase = u32Phase(cursor);
  let index = 0;
  for (let j = 0; j < count; j++) {
    const target = ((j + phase) / count) * total;
    while (index < length - 1 && cumulative[index] < target) index++;
    out[j] = index;
  }
}

const A1_MAX_IMAGES = 1152;
const A1_COORDS = new Float64Array(A1_MAX_IMAGES * 4);
const A1_WEIGHTS = new Float64Array(A1_MAX_IMAGES);
const A1_VALUES = new Float64Array(A1_MAX_IMAGES);
const A1_CUMULATIVE = new Float64Array(A1_MAX_IMAGES);
const A1_PICKS = new Int32Array(FANOUT_CAP);

/**
 * A1's finite arm. On acceptance it enumerates every stabilizer-safe image
 * of that source through the SAME `visitPointTilingImagesExhaustive` the REF
 * oracle uses, so the image set cannot differ; computes each image's
 * projected slice visibility `v_i` (zeroed below SKIP_WEIGHT, exactly where
 * REF would skip the deposit, so the two estimators share a target); and
 * spends its banked credit on K = min(credit, candidates, FANOUT_CAP)
 * systematic draws with `p_i = v_i/V`, depositing `imageWeight_i * V/K`.
 *
 * Unbiasedness: systematic resampling gives E[times i is drawn] = K*p_i, so
 * E[total deposit] = sum_i K*p_i*(V/K) = sum_i v_i — exactly REF's
 * per-source contribution, image for image.
 */
function runA1Finite(arm: Arm, pose: Pose, attempts: number): CandidateRun {
  const view = viewFor(arm, pose);
  const fine = makeGrid(FINE, arm.E);
  const native = makeGrid(NATIVE, arm.E);
  const stats = emptyStats();
  let credit = 0;
  let cursor = 0;
  const start = Date.now();
  runOrbit(PREPARED, ORBIT_SEED, attempts, (px, py, pz, pw) => {
    stats.attempts++;
    credit++;
    if (!pointTilingContains(arm.plan, px, py, pz, pw)) return;
    stats.accepted++;
    let count = 0;
    visitPointTilingImagesExhaustive(
      arm.plan,
      px,
      py,
      pz,
      pw,
      (x, y, z, w, weight) => {
        const base = count * 4;
        A1_COORDS[base] = x;
        A1_COORDS[base + 1] = y;
        A1_COORDS[base + 2] = z;
        A1_COORDS[base + 3] = w;
        A1_WEIGHTS[count] = weight;
        count++;
      },
    );
    stats.candidateTests += count;
    if (count === 0) return;
    const selected = Math.min(credit, count, FANOUT_CAP);
    credit -= selected;
    stats.selected += selected;
    if (selected > stats.maxSelectionPerAcceptance) {
      stats.maxSelectionPerAcceptance = selected;
    }
    let total = 0;
    for (let i = 0; i < count; i++) {
      const base = i * 4;
      projectImage(
        view,
        A1_COORDS[base],
        A1_COORDS[base + 1],
        A1_COORDS[base + 2],
        A1_COORDS[base + 3],
      );
      const radius = Math.hypot(PROJ[0], PROJ[1], PROJ[2]);
      if (radius > stats.maxDisplayedRadius) stats.maxDisplayedRadius = radius;
      const contribution = A1_WEIGHTS[i] * PROJ[3];
      const value = contribution < SKIP_WEIGHT ? 0 : contribution;
      A1_VALUES[i] = value;
      total += value;
      A1_CUMULATIVE[i] = total;
    }
    cursor = (cursor + selected) >>> 0;
    if (total <= 0) return;
    systematicPick(A1_CUMULATIVE, count, total, selected, cursor, A1_PICKS);
    const share = total / selected;
    for (let j = 0; j < selected; j++) {
      const i = A1_PICKS[j];
      const base = i * 4;
      projectImage(
        view,
        A1_COORDS[base],
        A1_COORDS[base + 1],
        A1_COORDS[base + 2],
        A1_COORDS[base + 3],
      );
      stats.emitted++;
      stats.deposits++;
      depositGrid(fine, PROJ[0], PROJ[1], PROJ[2], share);
      depositGrid(native, PROJ[0], PROJ[1], PROJ[2], share);
    }
  });
  stats.accumulateMs = Date.now() - start;
  return { fine, native, stats };
}

interface LatticeCeilings {
  /** Live cell ordinals whose `u_k * v_k` clears SKIP_WEIGHT. */
  ordinals: Int32Array;
  /** Cumulative `u_k * v_k` over `ordinals`. */
  cumulative: Float64Array;
  /** `sum_k u_k v_k`. */
  total: number;
  /** `u_k * v_k` per entry of `ordinals`. */
  product: Float64Array;
}

/**
 * The per-cell slice-visibility CEILING, computed ONCE per (plan, pose).
 *
 * A cell k's image is `T_k + D_k*source`, where `T_k = (2h*kx, 0, 2h*kz,
 * 2h*kw)` and `D_k = diag(+/-1, +1, +/-1, +/-1)` — the mirror's alternating
 * orientation. The rotor projection's row 3 is a UNIT vector (a row of an
 * SO(4) matrix) and its constant is zero here (the tiled 4D pivot is the
 * origin), so
 *
 *     sRaw(image) = row3 . T_k + row3 . (D_k source),
 *     |row3 . (D_k source)| <= |D_k source| = |source| <= R
 *
 * because lattice membership is exactly `|source| <= R`. Hence
 * `s in [s_k - R*invWAmp, s_k + R*invWAmp]` with `s_k = (row3 . T_k)*invWAmp`,
 * and after the same clamp to [-1,1] the ceiling is 1 when the interval
 * straddles the slice centre and the endpoint nearer the centre otherwise
 * (sliceWeight is unimodal at `center`).
 *
 * Since `coverage_k <= plan.upper[k] = u_k` and `slice <= v_k`, every image
 * of a cell whose `u_k*v_k` falls below SKIP_WEIGHT is a deposit REF itself
 * skips — so dropping those cells from the proposal CDF is exact, not an
 * approximation, and every retained cell keeps a strictly positive
 * proposal probability.
 */
function latticeCeilings(
  plan: LatticePointTilingPlan,
  view: View,
): LatticeCeilings {
  const rp = view.rotorProj;
  const h = plan.tiling.h;
  const repeated = plan.repeatedAxes;
  const halfWidth = R * view.invWAmp;
  const ordinals: number[] = [];
  const products: number[] = [];
  for (let cell = 0; cell < plan.upper.length; cell++) {
    const kx = plan.cells[cell * repeated];
    const kz = plan.cells[cell * repeated + 1];
    const kw = repeated === 3 ? plan.cells[cell * repeated + 2] : 0;
    const sRawCenter =
      rp[15] * (2 * h * kx) +
      rp[17] * (2 * h * kz) +
      rp[18] * (2 * h * kw) +
      rp[19];
    const center = sRawCenter * view.invWAmp;
    let lo = center - halfWidth;
    let hi = center + halfWidth;
    lo = lo < -1 ? -1 : lo > 1 ? 1 : lo;
    hi = hi < -1 ? -1 : hi > 1 ? 1 : hi;
    let ceiling: number;
    if (view.sliceCenter >= lo && view.sliceCenter <= hi) {
      ceiling = 1;
    } else {
      const nearest =
        Math.abs(lo - view.sliceCenter) < Math.abs(hi - view.sliceCenter)
          ? lo
          : hi;
      ceiling = sliceWeight(nearest, view.sliceCenter, view.sliceWidth, 0);
    }
    const product = plan.upper[cell] * ceiling;
    if (product < SKIP_WEIGHT) continue;
    ordinals.push(cell);
    products.push(product);
  }
  const cumulative = new Float64Array(ordinals.length);
  let total = 0;
  for (let i = 0; i < ordinals.length; i++) {
    total += products[i];
    cumulative[i] = total;
  }
  return {
    ordinals: Int32Array.from(ordinals),
    cumulative,
    total,
    product: Float64Array.from(products),
  };
}

/** `point-tiling.ts`'s private `latticeCoordinate`, restated. */
function latticeCoordinate(source: number, index: number, h: number): number {
  return 2 * h * index + (Math.abs(index) % 2 === 0 ? source : -source);
}

/** `latticeStabilizerMask`'s predicate, restated so the sheet can COUNT the
 * measure-zero wall sources its full-cell CDF would mishandle. */
function onLatticeWall(
  plan: LatticePointTilingPlan,
  x: number,
  z: number,
  w: number,
): boolean {
  const h = plan.tiling.h;
  const tolerance = POINT_TILING_STABILIZER_REL_EPS * Math.abs(h);
  return (
    Math.abs(Math.abs(x) - h) <= tolerance ||
    Math.abs(Math.abs(z) - h) <= tolerance ||
    Math.abs(Math.abs(w) - h) <= tolerance
  );
}

interface LatticeA1Run extends CandidateRun {
  wallSources: number;
}

/**
 * A1's lattice arm. Per-source enumeration is not affordable (acceptance is
 * ~100%), so one stratified proposal per accepted source is drawn from the
 * per-(plan, pose) CDF over `u_k * v_k`, and the deposit is reweighted by
 * `S / (u_k * v_k * K)`.
 *
 * Unbiasedness: with `q_k = u_k v_k / S`, the per-draw estimator
 * `contribution_k / q_k` has expectation `sum_k contribution_k`, which is
 * REF's per-source contribution `sum_k coverage_k * slice_k` cell for cell
 * (with the same SKIP_WEIGHT gate on both sides). Averaging K stratified
 * draws divides by K. The one caveat this inherits from production is the
 * DETERMINISTIC phase grid in place of a uniform draw, whose mass
 * discrepancy is bounded by `cells / 2^32` per stratum — the same bound
 * `POINT_TILING_MAX_LATTICE_CURSOR_MASS_ERROR` states for the shipped
 * lattice selector.
 */
function runA1Lattice(arm: Arm, pose: Pose, attempts: number): LatticeA1Run {
  const plan = arm.plan as LatticePointTilingPlan;
  const view = viewFor(arm, pose);
  const ceilings = latticeCeilings(plan, view);
  const fine = makeGrid(FINE, arm.E);
  const native = makeGrid(NATIVE, arm.E);
  const stats = emptyStats();
  const h = plan.tiling.h;
  const repeated = plan.repeatedAxes;
  const fade = plan.tiling.presentation.fadeStartRadius;
  const outer = plan.tiling.presentation.outerRadius;
  let credit = 0;
  let cursor = 0;
  let wallSources = 0;
  const picks = new Int32Array(FANOUT_CAP);
  const start = Date.now();
  runOrbit(PREPARED, ORBIT_SEED, attempts, (px, py, pz, pw) => {
    stats.attempts++;
    credit++;
    if (!pointTilingContains(plan, px, py, pz, pw)) return;
    stats.accepted++;
    if (onLatticeWall(plan, px, pz, pw)) wallSources++;
    const candidates = ceilings.ordinals.length;
    if (candidates === 0 || ceilings.total <= 0) return;
    const selected = Math.min(credit, candidates, FANOUT_CAP);
    credit -= selected;
    stats.selected += selected;
    stats.candidateTests += selected;
    if (selected > stats.maxSelectionPerAcceptance) {
      stats.maxSelectionPerAcceptance = selected;
    }
    cursor = (cursor + selected) >>> 0;
    systematicPick(
      ceilings.cumulative,
      candidates,
      ceilings.total,
      selected,
      cursor,
      picks,
    );
    for (let j = 0; j < selected; j++) {
      const entry = picks[j];
      const cell = ceilings.ordinals[entry];
      const x = latticeCoordinate(px, plan.cells[cell * repeated], h);
      const y = py;
      const z = latticeCoordinate(pz, plan.cells[cell * repeated + 1], h);
      const w =
        repeated === 3
          ? latticeCoordinate(pw, plan.cells[cell * repeated + 2], h)
          : 0;
      stats.emitted++;
      const radial = Math.hypot(x, y, z, w);
      if (radial > outer) continue;
      const coverage = latticePresentationVisibility(radial, fade, outer);
      if (coverage <= 0) continue;
      projectImage(view, x, y, z, w);
      const displayed = Math.hypot(PROJ[0], PROJ[1], PROJ[2]);
      if (displayed > stats.maxDisplayedRadius) {
        stats.maxDisplayedRadius = displayed;
      }
      const contribution = coverage * PROJ[3];
      if (contribution < SKIP_WEIGHT) continue;
      const weight =
        (contribution * ceilings.total) / (ceilings.product[entry] * selected);
      stats.deposits++;
      depositGrid(fine, PROJ[0], PROJ[1], PROJ[2], weight);
      depositGrid(native, PROJ[0], PROJ[1], PROJ[2], weight);
    }
  });
  stats.accumulateMs = Date.now() - start;
  return { fine, native, stats, wallSources };
}

function runA1(arm: Arm, pose: Pose, attempts: number): CandidateRun {
  return arm.plan.kind === "lattice"
    ? runA1Lattice(arm, pose, attempts)
    : runA1Finite(arm, pose, attempts);
}

// -------------------------------------------------------------------- B

interface RawVolume {
  n: number;
  data: Float32Array;
  deposits: number;
  occupied: number;
  buildMs: number;
}

/** The raw, VIEW-INVARIANT 4D canonical volume over `[-R,R]^4`: the ordinary
 * 4D orbit with NO tiling, NO projection and NO slice, weight 1 per plotted
 * point. Every swept resolution is filled in ONE orbit pass. */
function buildRawVolumes(resolutions: number[], attempts: number): RawVolume[] {
  const volumes = resolutions.map((n) => ({
    n,
    data: new Float32Array(n * n * n * n),
    deposits: 0,
    occupied: 0,
    buildMs: 0,
  }));
  const start = Date.now();
  runOrbit(PREPARED, ORBIT_SEED, attempts, (px, py, pz, pw) => {
    for (const volume of volumes) {
      const { n, data } = volume;
      const inv = n / (2 * R);
      const ix = Math.floor((px + R) * inv);
      if (ix < 0 || ix >= n) continue;
      const iy = Math.floor((py + R) * inv);
      if (iy < 0 || iy >= n) continue;
      const iz = Math.floor((pz + R) * inv);
      if (iz < 0 || iz >= n) continue;
      const iw = Math.floor((pw + R) * inv);
      if (iw < 0 || iw >= n) continue;
      data[((iw * n + iz) * n + iy) * n + ix] += 1;
      volume.deposits++;
    }
  });
  const elapsed = Date.now() - start;
  for (const volume of volumes) {
    volume.buildMs = elapsed / volumes.length;
    let occupied = 0;
    for (let i = 0; i < volume.data.length; i++) {
      if (volume.data[i] > 0) occupied++;
    }
    volume.occupied = occupied;
  }
  return volumes;
}

interface BRender {
  grid: Grid;
  taps: number;
  renderMs: number;
  folds: number;
}

/**
 * B's render: at each displayed voxel centre, K w-taps spanning the slice
 * support, each unprojected through the rotor's TRANSPOSE (the rotation part
 * is orthogonal and the tiled pivot is the origin, so the inverse IS the
 * transpose), folded in the RAW 4D space, and sampled NEAREST out of the raw
 * volume. Tap spacing is at most one raw voxel (`2R/N_B`).
 */
function renderB(arm: Arm, pose: Pose, volume: RawVolume, n: number): BRender {
  const view = viewFor(arm, pose);
  const rp = view.rotorProj;
  const grid = makeGrid(n, arm.E);
  const rawVoxel = (2 * R) / volume.n;
  const sRawSpan = (2 * TAP_SIGMAS * view.sliceWidth) / view.invWAmp;
  const taps = Math.max(1, Math.ceil(sRawSpan / rawVoxel));
  const dS = sRawSpan / taps;
  const sRaws = new Float64Array(taps);
  const sliceWeights = new Float64Array(taps);
  for (let j = 0; j < taps; j++) {
    const s =
      view.sliceCenter +
      (((j + 0.5) / taps) * 2 - 1) * TAP_SIGMAS * view.sliceWidth;
    sRaws[j] = s / view.invWAmp;
    const clamped = s < -1 ? -1 : s > 1 ? 1 : s;
    sliceWeights[j] = sliceWeight(
      clamped,
      view.sliceCenter,
      view.sliceWidth,
      0,
    );
  }
  const latticePlan = arm.plan.kind === "lattice" ? arm.plan : null;
  const finitePlan = arm.plan.kind === "finite" ? arm.plan : null;
  const lattice = latticePlan !== null;
  const finiteInfo = finitePlan === null ? null : finitePlan.tiling.info;
  if (arm.resolved.clip) {
    throw new Error("renderB: the sheet's arms carry no clip");
  }
  const fade = latticePlan?.tiling.presentation.fadeStartRadius ?? 0;
  const outer = latticePlan?.tiling.presentation.outerRadius ?? 0;
  const h = latticePlan?.tiling.h ?? 0;
  const cell = (2 * arm.E) / n;
  const rawInv = volume.n / (2 * R);
  const scratch: Vec4 = [0, 0, 0, 0];
  const folded: Vec4 = [0, 0, 0, 0];
  let folds = 0;
  const start = Date.now();
  for (let iz = 0; iz < n; iz++) {
    const pz = -arm.E + (iz + 0.5) * cell;
    for (let iy = 0; iy < n; iy++) {
      const py = -arm.E + (iy + 0.5) * cell;
      for (let ix = 0; ix < n; ix++) {
        const px = -arm.E + (ix + 0.5) * cell;
        const pNorm2 = px * px + py * py + pz * pz;
        let acc = 0;
        for (let j = 0; j < taps; j++) {
          const vs = sRaws[j];
          const radius2 = pNorm2 + vs * vs;
          if (lattice) {
            if (radius2 > outer * outer) continue;
          } else if (radius2 > R * R) {
            continue;
          }
          // Unproject: q4 = R4^T * (px, py, pz, sRaw).
          const qx = rp[0] * px + rp[5] * py + rp[10] * pz + rp[15] * vs;
          const qy = rp[1] * px + rp[6] * py + rp[11] * pz + rp[16] * vs;
          const qz = rp[2] * px + rp[7] * py + rp[12] * pz + rp[17] * vs;
          const qw = rp[3] * px + rp[8] * py + rp[13] * pz + rp[18] * vs;
          let fx: number;
          let fy: number;
          let fz: number;
          let fw: number;
          let coverage: number;
          if (finiteInfo === null) {
            const radial = Math.sqrt(radius2);
            coverage = latticePresentationVisibility(radial, fade, outer);
            if (coverage <= 0) continue;
            fx = mirrorLatticeCoordinate(qx, h);
            fy = qy;
            fz = mirrorLatticeCoordinate(qz, h);
            fw = mirrorLatticeCoordinate(qw, h);
            folds++;
            if (fx * fx + fy * fy + fz * fz + fw * fw > R * R) continue;
          } else {
            scratch[0] = qx;
            scratch[1] = qy;
            scratch[2] = qz;
            scratch[3] = qw;
            const result = foldToChamber(finiteInfo, scratch, folded);
            folds++;
            if (result === null) continue;
            fx = folded[0];
            fy = folded[1];
            fz = folded[2];
            fw = folded[3];
            coverage = 1;
          }
          const rx = Math.floor((fx + R) * rawInv);
          if (rx < 0 || rx >= volume.n) continue;
          const ry = Math.floor((fy + R) * rawInv);
          if (ry < 0 || ry >= volume.n) continue;
          const rz = Math.floor((fz + R) * rawInv);
          if (rz < 0 || rz >= volume.n) continue;
          const rw = Math.floor((fw + R) * rawInv);
          if (rw < 0 || rw >= volume.n) continue;
          const sample =
            volume.data[((rw * volume.n + rz) * volume.n + ry) * volume.n + rx];
          if (sample === 0) continue;
          acc += coverage * sliceWeights[j] * sample * dS;
        }
        if (acc > 0) grid.data[iz * n * n + iy * n + ix] = acc;
      }
    }
  }
  return { grid, taps, renderMs: Date.now() - start, folds };
}

// -------------------------------------------------------------------- X

interface UntiledVolume {
  grid: Grid;
  eUntiled: number;
  deposits: number;
  buildMs: number;
}

/**
 * Today's untiled 4D displayed volume, reimplemented locally: the ordinary
 * orbit projected and slice-weighted exactly like `accumulateVoxels4`, over
 * a cube whose half-extent is the measured maximum displayed radius of the
 * same (seeded, therefore identical) run.
 */
function buildUntiled(pose: Pose, attempts: number, n: number): UntiledVolume {
  const view: View = {
    rotorProj: composeRotorProjection4(pose.rotor, [0, 0, 0, 0]),
    invWAmp: 1 / R,
    sliceCenter: pose.sliceCenter,
    sliceWidth: SLICE_WIDTH,
  };
  const start = Date.now();
  let maxRadius = 0;
  runOrbit(PREPARED, ORBIT_SEED, attempts, (px, py, pz, pw) => {
    projectImage(view, px, py, pz, pw);
    if (PROJ[3] < SKIP_WEIGHT) return;
    const radius = Math.hypot(PROJ[0], PROJ[1], PROJ[2]);
    if (radius > maxRadius) maxRadius = radius;
  });
  const eUntiled = Math.max(maxRadius, 1e-6);
  const grid = makeGrid(n, eUntiled);
  let deposits = 0;
  runOrbit(PREPARED, ORBIT_SEED, attempts, (px, py, pz, pw) => {
    projectImage(view, px, py, pz, pw);
    if (PROJ[3] < SKIP_WEIGHT) return;
    if (depositGrid(grid, PROJ[0], PROJ[1], PROJ[2], PROJ[3])) deposits++;
  });
  return { grid, eUntiled, deposits, buildMs: Date.now() - start };
}

function sampleGridNearest(
  grid: Grid,
  x: number,
  y: number,
  z: number,
): number {
  const { n, e } = grid;
  const inv = n / (2 * e);
  const ix = Math.floor((x + e) * inv);
  if (ix < 0 || ix >= n) return 0;
  const iy = Math.floor((y + e) * inv);
  if (iy < 0 || iy >= n) return 0;
  const iz = Math.floor((z + e) * inv);
  if (iz < 0 || iz >= n) return 0;
  return grid.data[iz * n * n + iy * n + ix];
}

/**
 * X: the refused post-projection shortcut. The DISPLAYED query `p` is
 * embedded at the slice's own world w (`sliceCenter / invWAmp` — the most
 * charitable reading, since the displayed volume IS that slice), folded with
 * the same 4D group / lattice, and the untiled displayed volume is sampled
 * at the folded xyz.
 */
function renderX(
  arm: Arm,
  pose: Pose,
  untiled: UntiledVolume,
  n: number,
): { grid: Grid; renderMs: number } {
  const view = viewFor(arm, pose);
  const grid = makeGrid(n, arm.E);
  const latticePlan = arm.plan.kind === "lattice" ? arm.plan : null;
  const finitePlan = arm.plan.kind === "finite" ? arm.plan : null;
  const finiteInfo = finitePlan === null ? null : finitePlan.tiling.info;
  const fade = latticePlan?.tiling.presentation.fadeStartRadius ?? 0;
  const outer = latticePlan?.tiling.presentation.outerRadius ?? 0;
  const h = latticePlan?.tiling.h ?? 0;
  const w0 = view.sliceCenter / view.invWAmp;
  const cell = (2 * arm.E) / n;
  const scratch: Vec4 = [0, 0, 0, 0];
  const folded: Vec4 = [0, 0, 0, 0];
  const start = Date.now();
  for (let iz = 0; iz < n; iz++) {
    const pz = -arm.E + (iz + 0.5) * cell;
    for (let iy = 0; iy < n; iy++) {
      const py = -arm.E + (iy + 0.5) * cell;
      for (let ix = 0; ix < n; ix++) {
        const px = -arm.E + (ix + 0.5) * cell;
        const radial = Math.hypot(px, py, pz, w0);
        let coverage = 1;
        let fx: number;
        let fy: number;
        let fz: number;
        if (finiteInfo === null) {
          if (radial > outer) continue;
          coverage = latticePresentationVisibility(radial, fade, outer);
          if (coverage <= 0) continue;
          fx = mirrorLatticeCoordinate(px, h);
          fy = py;
          fz = mirrorLatticeCoordinate(pz, h);
          const fw = mirrorLatticeCoordinate(w0, h);
          if (fx * fx + fy * fy + fz * fz + fw * fw > R * R) continue;
        } else {
          if (radial > R) continue;
          scratch[0] = px;
          scratch[1] = py;
          scratch[2] = pz;
          scratch[3] = w0;
          if (foldToChamber(finiteInfo, scratch, folded) === null) continue;
          fx = folded[0];
          fy = folded[1];
          fz = folded[2];
        }
        const sample = sampleGridNearest(untiled.grid, fx, fy, fz);
        if (sample === 0) continue;
        grid.data[iz * n * n + iy * n + ix] = coverage * sample;
      }
    }
  }
  return { grid, renderMs: Date.now() - start };
}

// ------------------------------------------------------------ march price

interface MarchPrice {
  rays: number;
  hitPct: number;
  meanSteps: number;
  meanFetches: number;
}

/** Work accounting for the material's box march over a displayed grid: one
 * texture fetch per density query, exactly as the untiled 4D material does.
 * The candidate-A arms change no query path, so this is measured for the
 * untiled baseline and for A's tiled grid and reported as a ratio. */
function marchPrice(grid: Grid, threshold: number): MarchPrice {
  let maxDensity = 0;
  for (let i = 0; i < grid.data.length; i++) {
    if (grid.data[i] > maxDensity) maxDensity = grid.data[i];
  }
  const invLogMax = maxDensity > 0 ? 1 / Math.log1p(maxDensity) : 0;
  const alphaAt = (x: number, y: number, z: number): number => {
    const value = sampleGridNearest(grid, x, y, z);
    return value <= 0 ? 0 : Math.log1p(value) * invLogMax;
  };
  const limit = marchStepsForGrid(grid.n);
  const fovY = Math.PI / 3;
  const aspect = MARCH_W / MARCH_H;
  const distance = (grid.e * 1.6) / Math.tan(fovY / 2);
  const tanY = Math.tan(fovY / 2);
  let hits = 0;
  let steps = 0;
  let fetches = 0;
  let rays = 0;
  for (let y = 0; y < MARCH_H; y++) {
    for (let x = 0; x < MARCH_W; x++) {
      rays++;
      const sx = (((x + 0.5) / MARCH_W) * 2 - 1) * tanY * aspect;
      const sy = (1 - ((y + 0.5) / MARCH_H) * 2) * tanY;
      const invLength = 1 / Math.hypot(sx, sy, 1);
      const rd = [sx * invLength, sy * invLength, -invLength];
      const ro = [0, 0, distance];
      // Slab intersection with the displayed cube.
      let near = -Infinity;
      let far = Infinity;
      for (let axis = 0; axis < 3; axis++) {
        const t0 = (-grid.e - ro[axis]) / rd[axis];
        const t1 = (grid.e - ro[axis]) / rd[axis];
        near = Math.max(near, Math.min(t0, t1));
        far = Math.min(far, Math.max(t0, t1));
      }
      if (near > far || far <= 0) continue;
      let t = Math.max(near, 0);
      const dt = (far - t) / limit;
      t += dt * 0.5;
      let hit = false;
      let rayFetches = 0;
      let raySteps = 0;
      for (let step = 0; step < limit; step++, t += dt) {
        raySteps++;
        rayFetches++;
        if (
          alphaAt(ro[0] + rd[0] * t, ro[1] + rd[1] * t, ro[2] + rd[2] * t) >
          threshold
        ) {
          hit = true;
          break;
        }
      }
      if (hit) {
        hits++;
        rayFetches += REFINE_STEPS + GRADIENT_FETCHES + COLOR_FETCHES;
        raySteps += REFINE_STEPS;
        // Hard shadow ray and the four AO taps, both bounded.
        rayFetches += SHADOW_STEPS + AO_STEPS;
        raySteps += SHADOW_STEPS + AO_STEPS;
      }
      steps += raySteps;
      fetches += rayFetches;
    }
  }
  return {
    rays,
    hitPct: (100 * hits) / Math.max(rays, 1),
    meanSteps: steps / Math.max(rays, 1),
    meanFetches: fetches / Math.max(rays, 1),
  };
}

// ------------------------------------------------------------------ report

const fixed = (value: number, digits = 4): string =>
  Number.isFinite(value) ? value.toFixed(digits) : "n/a";
const verdict = (ok: boolean): string => (ok ? "PASS" : "FAIL");

function memoryFor(cells: number): { texture: number; working: number } {
  return { texture: cells * 4, working: cells * 16 };
}

const MB = (bytes: number): string => (bytes / (1024 * 1024)).toFixed(1);

function voxelsPerContentDiameter(n: number, e: number): number {
  return (2 * R) / ((2 * e) / n);
}

function occupiedCount(grid: Grid): number {
  const mass = gridMass(grid);
  if (mass <= 0) return 0;
  let count = 0;
  for (let i = 0; i < grid.data.length; i++) {
    if (grid.data[i] / mass > OCCUPANCY_THRESHOLD) count++;
  }
  return count;
}

// -------------------------------------------------------------------- tests

describe("4D Solid tiling representation sheet", () => {
  it("pins the fixture, the plans and the projection round-trip", () => {
    const rows = ARMS.map((arm) => {
      const lattice = isResolvedLatticeTiling(arm.resolved);
      return {
        arm: arm.label,
        kind: arm.plan.kind,
        order: lattice
          ? ""
          : (arm.plan as { tiling: { info: { order: number } } }).tiling.info
              .order,
        cells: lattice ? (arm.plan as LatticePointTilingPlan).upper.length : "",
        h: lattice ? fixed((arm.resolved as { h: number }).h, 6) : "",
        E: fixed(arm.E, 6),
        radiusForAmplitude: fixed(arm.radiusForAmplitude, 6),
        planBytes: arm.plan.memoryBytes,
        nativeVoxelsPerContentDia: fixed(
          voxelsPerContentDiameter(NATIVE, arm.E),
          2,
        ),
        fineVoxelsPerContentDia: fixed(
          voxelsPerContentDiameter(FINE, arm.E),
          2,
        ),
      };
    });
    console.log(
      `[solid-tiling-4d] fixture: pentatope, R=${R}, attempts=${ATTEMPTS}, native=${NATIVE}, fine=${FINE}, sliceWidth=${SLICE_WIDTH}`,
    );
    console.table(rows);

    // The unprojection B relies on: with the tiled pivot at the origin the
    // rotor projection IS the rotation, so its inverse is the transpose.
    let worst = 0;
    for (const pose of POSES) {
      const rp = composeRotorProjection4(pose.rotor, [0, 0, 0, 0]);
      const rng = mulberry32(0xb0b);
      for (let trial = 0; trial < 256; trial++) {
        const v = [rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1];
        const p0 = rp[0] * v[0] + rp[1] * v[1] + rp[2] * v[2] + rp[3] * v[3];
        const p1 = rp[5] * v[0] + rp[6] * v[1] + rp[7] * v[2] + rp[8] * v[3];
        const p2 =
          rp[10] * v[0] + rp[11] * v[1] + rp[12] * v[2] + rp[13] * v[3];
        const ps =
          rp[15] * v[0] + rp[16] * v[1] + rp[17] * v[2] + rp[18] * v[3];
        const q = [
          rp[0] * p0 + rp[5] * p1 + rp[10] * p2 + rp[15] * ps,
          rp[1] * p0 + rp[6] * p1 + rp[11] * p2 + rp[16] * ps,
          rp[2] * p0 + rp[7] * p1 + rp[12] * p2 + rp[17] * ps,
          rp[3] * p0 + rp[8] * p1 + rp[13] * p2 + rp[18] * ps,
        ];
        for (let i = 0; i < 4; i++) {
          worst = Math.max(worst, Math.abs(q[i] - v[i]));
        }
      }
    }
    console.log(
      `[solid-tiling-4d] projection round-trip worst |project(unproject(v)) - v| = ${worst.toExponential(3)}`,
    );
    expect(worst).toBeLessThan(1e-12);
  });

  it("measures every candidate against exhaustive replication at both poses", () => {
    const rawVolumes = buildRawVolumes(NB_SWEEP, ATTEMPTS);
    const sweepRows = rawVolumes.map((volume) => {
      const cells = volume.n ** 4;
      const memory = memoryFor(cells);
      return {
        N_B: volume.n,
        rawCells: cells,
        rawVoxelsPerContentDia: volume.n,
        occupiedRawCells: volume.occupied,
        depositsPerOccupiedRawCell: fixed(
          volume.deposits / Math.max(volume.occupied, 1),
          2,
        ),
        textureMB: MB(memory.texture),
        textureCap: verdict(memory.texture <= MEMORY_TEXTURE_CAP_BYTES),
        workingMB: MB(memory.working),
        workingCap: verdict(memory.working <= MEMORY_WORKING_SET_CAP_BYTES),
      };
    });
    console.log(
      `[solid-tiling-4d] B raw-4D volume sweep over [-R,R]^4, ${ATTEMPTS} orbit points, one shared pass`,
    );
    console.table(sweepRows);

    const headline =
      rawVolumes
        .filter((volume) => {
          const memory = memoryFor(volume.n ** 4);
          return (
            memory.texture <= MEMORY_TEXTURE_CAP_BYTES &&
            memory.working <= MEMORY_WORKING_SET_CAP_BYTES
          );
        })
        .at(-1) ?? rawVolumes[0];
    console.log(
      `[solid-tiling-4d] B headline N_B = ${headline.n} (largest swept resolution inside both memory caps)`,
    );

    const untiledByPose = POSES.map((pose) =>
      buildUntiled(pose, ATTEMPTS, NATIVE),
    );
    console.table(
      POSES.map((pose, index) => ({
        pose: pose.label,
        E_untiled: fixed(untiledByPose[index].eUntiled, 6),
        deposits: untiledByPose[index].deposits,
        restartMs: untiledByPose[index].buildMs,
      })),
    );

    const rows: Record<string, string | number>[] = [];
    const caps: Record<string, string | number>[] = [];
    const rebuildRows: Record<string, string | number>[] = [];
    const fetchRows: Record<string, string | number>[] = [];

    const untiledPrice = marchPrice(untiledByPose[1].grid, 0.3);

    for (const arm of ARMS) {
      const lattice = arm.plan.kind === "lattice";
      for (let poseIndex = 0; poseIndex < POSES.length; poseIndex++) {
        const pose = POSES[poseIndex];
        const refAttempts = lattice
          ? Math.max(1, Math.floor(ATTEMPTS / REF_LATTICE_ATTEMPT_DIVISOR))
          : ATTEMPTS;
        const ref = runReference(arm, pose, refAttempts);
        if (!lattice) {
          expect(ref.stats.maxDisplayedRadius).toBeLessThanOrEqual(
            R * (1 + 1e-9),
          );
        }
        const refOccupied = occupiedCount(ref.fine);

        const record = (
          label: string,
          run: {
            fine: Grid;
            native: Grid | null;
            stats: RunStats;
            renderMs?: number;
            taps?: number;
            memoryCells: number;
            detailN: number;
            depositsPerOccupied: number;
            isRef?: boolean;
          },
        ): void => {
          const fineMetric = compareGrids(run.fine, ref.fine);
          const nativeMetric = run.native
            ? compareGrids(run.native, ref.native)
            : null;
          const memory = memoryFor(run.memoryCells);
          const detail = voxelsPerContentDiameter(run.detailN, arm.E);
          const stats = run.stats;
          rows.push({
            candidate: label,
            arm: arm.label,
            pose: pose.label,
            E: fixed(arm.E, 4),
            nativeRes: run.detailN,
            voxPerContentDia: fixed(detail, 2),
            l1Native: nativeMetric ? fixed(nativeMetric.l1) : "n/a",
            l1Fine: fixed(fineMetric.l1),
            occupancy: fineMetric.occupancy.toExponential(3),
            occRetained: fixed(fineMetric.occupancyRetained, 4),
            occSymDiff: fixed(fineMetric.occSymDiff, 4),
            attempts: stats.attempts,
            accepted: stats.accepted,
            acceptRate: fixed(stats.accepted / Math.max(stats.attempts, 1), 6),
            candTests: stats.candidateTests,
            selected: stats.selected,
            emitted: stats.emitted,
            imgPerAccepted: fixed(
              stats.emitted / Math.max(stats.accepted, 1),
              3,
            ),
            visibleFraction: fixed(
              stats.deposits / Math.max(stats.emitted, 1),
              4,
            ),
            depositsPerOccVoxel: fixed(run.depositsPerOccupied, 2),
            textureMB: MB(memory.texture),
            workingMB: MB(memory.working),
            accumulateMs: stats.accumulateMs,
            renderMs: run.renderMs ?? "",
            taps: run.taps ?? "",
          });
          caps.push({
            candidate: label,
            arm: arm.label,
            pose: pose.label,
            textureCap: verdict(memory.texture <= MEMORY_TEXTURE_CAP_BYTES),
            workingCap: verdict(memory.working <= MEMORY_WORKING_SET_CAP_BYTES),
            detailCap: verdict(detail >= MIN_VOXELS_PER_CONTENT_DIAMETER),
            l1Cap: verdict(fineMetric.l1 <= MAX_NORMALIZED_L1),
            selectedCap: run.isRef
              ? "ref"
              : verdict(stats.selected <= stats.attempts),
            candTestCap: run.isRef
              ? "ref"
              : verdict(
                  stats.candidateTests <=
                    stats.attempts * MAX_CANDIDATE_TEST_FACTOR,
                ),
            fanoutCap: run.isRef
              ? "ref"
              : verdict(stats.maxSelectionPerAcceptance <= FANOUT_CAP),
          });
        };

        record("REF", {
          fine: ref.fine,
          native: ref.native,
          stats: ref.stats,
          memoryCells: NATIVE ** 3,
          detailN: NATIVE,
          depositsPerOccupied: ref.stats.deposits / Math.max(refOccupied, 1),
          isRef: true,
        });

        const a0 = runA0(arm, pose, ATTEMPTS);
        expect(a0.stats.selected).toBeLessThanOrEqual(a0.stats.attempts);
        expect(a0.stats.maxSelectionPerAcceptance).toBeLessThanOrEqual(
          FANOUT_CAP,
        );
        record("A0 shipped", {
          fine: a0.fine,
          native: a0.native,
          stats: a0.stats,
          memoryCells: NATIVE ** 3,
          detailN: NATIVE,
          depositsPerOccupied:
            a0.stats.deposits / Math.max(occupiedCount(a0.native), 1),
        });

        const a1 = runA1(arm, pose, ATTEMPTS);
        expect(a1.stats.selected).toBeLessThanOrEqual(a1.stats.attempts);
        expect(a1.stats.maxSelectionPerAcceptance).toBeLessThanOrEqual(
          FANOUT_CAP,
        );
        if ("wallSources" in a1) {
          expect((a1 as LatticeA1Run).wallSources).toBe(0);
        }
        record("A1 slice-aware", {
          fine: a1.fine,
          native: a1.native,
          stats: a1.stats,
          memoryCells: NATIVE ** 3,
          detailN: NATIVE,
          depositsPerOccupied:
            a1.stats.deposits / Math.max(occupiedCount(a1.native), 1),
        });

        rebuildRows.push({
          arm: arm.label,
          pose: pose.label,
          candidate: "A0 shipped",
          rebuildMs: a0.stats.accumulateMs,
          untiledRestartMs: untiledByPose[poseIndex].buildMs,
          rebuildMultiplier: fixed(
            a0.stats.accumulateMs /
              Math.max(untiledByPose[poseIndex].buildMs, 1),
            3,
          ),
          rebuildCap: verdict(
            a0.stats.accumulateMs /
              Math.max(untiledByPose[poseIndex].buildMs, 1) <=
              MAX_REBUILD_MULTIPLIER,
          ),
        });
        rebuildRows.push({
          arm: arm.label,
          pose: pose.label,
          candidate: "A1 slice-aware",
          rebuildMs: a1.stats.accumulateMs,
          untiledRestartMs: untiledByPose[poseIndex].buildMs,
          rebuildMultiplier: fixed(
            a1.stats.accumulateMs /
              Math.max(untiledByPose[poseIndex].buildMs, 1),
            3,
          ),
          rebuildCap: verdict(
            a1.stats.accumulateMs /
              Math.max(untiledByPose[poseIndex].buildMs, 1) <=
              MAX_REBUILD_MULTIPLIER,
          ),
        });

        const b = renderB(arm, pose, headline, FINE);
        const bStats = emptyStats();
        bStats.attempts = ATTEMPTS;
        bStats.accepted = ATTEMPTS;
        bStats.emitted = headline.deposits;
        bStats.deposits = headline.deposits;
        bStats.accumulateMs = Math.round(headline.buildMs);
        const bNative = resampleGrid(b.grid, NATIVE);
        record(`B raw4D N_B=${headline.n}`, {
          fine: b.grid,
          native: bNative,
          stats: bStats,
          renderMs: b.renderMs,
          taps: b.taps,
          memoryCells: headline.n ** 4,
          detailN: (headline.n * arm.E) / R,
          depositsPerOccupied:
            headline.deposits / Math.max(headline.occupied, 1),
        });
        rebuildRows.push({
          arm: arm.label,
          pose: pose.label,
          candidate: `B raw4D N_B=${headline.n}`,
          rebuildMs: 0,
          untiledRestartMs: untiledByPose[poseIndex].buildMs,
          rebuildMultiplier: "0.000",
          rebuildCap: "PASS",
        });
        fetchRows.push({
          arm: arm.label,
          pose: pose.label,
          candidate: `B raw4D N_B=${headline.n}`,
          wTaps: b.taps,
          foldedQueryPaths: TILED_QUERY_PATHS.length,
          fetchMultiplier: b.taps,
          fetchCap: verdict(b.taps <= MAX_FETCH_MULTIPLIER),
        });

        const x = renderX(arm, pose, untiledByPose[poseIndex], FINE);
        const xStats = emptyStats();
        xStats.attempts = ATTEMPTS;
        xStats.accepted = ATTEMPTS;
        xStats.emitted = untiledByPose[poseIndex].deposits;
        xStats.deposits = untiledByPose[poseIndex].deposits;
        xStats.accumulateMs = untiledByPose[poseIndex].buildMs;
        const xNative = resampleGrid(x.grid, NATIVE);
        record("X post-projection", {
          fine: x.grid,
          native: xNative,
          stats: xStats,
          renderMs: x.renderMs,
          memoryCells: NATIVE ** 3,
          detailN: NATIVE,
          depositsPerOccupied:
            untiledByPose[poseIndex].deposits /
            Math.max(occupiedCount(x.grid), 1),
        });

        if (poseIndex === 1) {
          const price = marchPrice(a0.native, 0.3);
          fetchRows.push({
            arm: arm.label,
            pose: pose.label,
            candidate: "A (untiled box march)",
            wTaps: 1,
            foldedQueryPaths: 0,
            fetchMultiplier: fixed(
              price.meanFetches / Math.max(untiledPrice.meanFetches, 1e-9),
              3,
            ),
            fetchCap: verdict(
              price.meanFetches / Math.max(untiledPrice.meanFetches, 1e-9) <=
                MAX_FETCH_MULTIPLIER,
            ),
            meanFetchesPerRay: fixed(price.meanFetches, 2),
            meanStepsPerRay: fixed(price.meanSteps, 2),
            hitPct: fixed(price.hitPct, 2),
          });
        }
      }
    }

    console.log(
      "[solid-tiling-4d] candidate x arm x pose matrix (l1 vs exhaustive replication; every grid mass-normalized)",
    );
    console.table(rows);
    console.log("[solid-tiling-4d] predeclared caps, PASS/FAIL");
    console.table(caps);
    console.log(
      `[solid-tiling-4d] settled rotor/slice edit cost against today's untiled 4D restart (cap ${MAX_REBUILD_MULTIPLIER}x)`,
    );
    console.table(rebuildRows);
    console.log(
      `[solid-tiling-4d] per-ray texture work; untiled baseline mean fetches/ray ${untiledPrice.meanFetches.toFixed(2)}, steps/ray ${untiledPrice.meanSteps.toFixed(2)}, hit ${untiledPrice.hitPct.toFixed(2)}%; B multiplies EVERY one of the ${TILED_QUERY_PATHS.length} folded query paths (${TILED_QUERY_PATHS.join(", ")}) by its w-tap count`,
    );
    console.table(fetchRows);
  });

  it("proves B is pose-independent", () => {
    const n = 40;
    const attempts = Math.max(1, Math.floor(ATTEMPTS / 8));
    const atP0 = buildRawVolumes([n], attempts)[0];
    const rebuilt = buildRawVolumes([n], attempts)[0];
    let identical = true;
    for (let i = 0; i < atP0.data.length; i++) {
      if (atP0.data[i] !== rebuilt.data[i]) {
        identical = false;
        break;
      }
    }
    expect(identical).toBe(true);

    const arm = ARMS[0];
    const fromP0Volume = renderB(arm, POSES[1], atP0, 48);
    const fromRebuilt = renderB(arm, POSES[1], rebuilt, 48);
    let renderIdentical = true;
    for (let i = 0; i < fromP0Volume.grid.data.length; i++) {
      if (fromP0Volume.grid.data[i] !== fromRebuilt.grid.data[i]) {
        renderIdentical = false;
        break;
      }
    }
    console.log(
      `[solid-tiling-4d] B pose-independence: raw volume built at P0 (${attempts} points, N_B=${n}) is byte-identical to the P1 rebuild, and the P1 render off each is byte-identical (${renderIdentical}). The raw volume reads no pose at all, which is the proof.`,
    );
    expect(renderIdentical).toBe(true);
  });

  it("prices A1's unbiasedness against REF on a shared source set", () => {
    const attempts = Math.max(1, Math.floor(ATTEMPTS / 8));
    const rows = ARMS.flatMap((arm) =>
      POSES.map((pose) => {
        const ref = runReference(arm, pose, attempts);
        const a1 = runA1(arm, pose, attempts);
        const refMass = gridMass(ref.fine);
        const a1Mass = gridMass(a1.fine);
        const relative = (a1Mass - refMass) / Math.max(refMass, 1e-12);
        const tolerance =
          arm.plan.kind === "lattice"
            ? UNBIAS_REL_TOLERANCE_LATTICE
            : UNBIAS_REL_TOLERANCE_FINITE;
        return {
          arm: arm.label,
          pose: pose.label,
          attempts,
          refMass: refMass.toExponential(6),
          a1Mass: a1Mass.toExponential(6),
          relativeDeviation: relative.toExponential(3),
          tolerance,
          verdict: verdict(Math.abs(relative) <= tolerance),
        };
      }),
    );
    console.log(
      "[solid-tiling-4d] A1 unbiasedness: total deposited mass against exhaustive replication on the SAME seeded source set",
    );
    console.table(rows);
    for (const row of rows) {
      expect(Math.abs(Number(row.relativeDeviation))).toBeLessThanOrEqual(
        Number(row.tolerance),
      );
    }
  });

  it("sweeps the source budget for A0 and A1", () => {
    const rows: Record<string, string | number>[] = [];
    const pose = POSES[1];
    for (const arm of ARMS) {
      const lattice = arm.plan.kind === "lattice";
      const refAttempts = lattice
        ? Math.max(1, Math.floor(ATTEMPTS / REF_LATTICE_ATTEMPT_DIVISOR))
        : ATTEMPTS;
      const ref = runReference(arm, pose, refAttempts);
      for (const factor of [0.25, 1, 4]) {
        const attempts = Math.max(1, Math.round(ATTEMPTS * factor));
        for (const [label, run] of [
          ["A0 shipped", runA0(arm, pose, attempts)],
          ["A1 slice-aware", runA1(arm, pose, attempts)],
        ] as [string, CandidateRun][]) {
          const metric = compareGrids(run.fine, ref.fine);
          rows.push({
            arm: arm.label,
            candidate: label,
            budget: `${factor}x`,
            attempts,
            accepted: run.stats.accepted,
            emitted: run.stats.emitted,
            deposits: run.stats.deposits,
            visibleFraction: fixed(
              run.stats.deposits / Math.max(run.stats.emitted, 1),
              4,
            ),
            l1Fine: fixed(metric.l1),
            occRetained: fixed(metric.occupancyRetained, 4),
            accumulateMs: run.stats.accumulateMs,
          });
        }
      }
    }
    console.log(
      `[solid-tiling-4d] convergence sweep at ${pose.label} (0.25x / 1x / 4x the ${ATTEMPTS} source budget)`,
    );
    console.table(rows);
  });

  it("prices the lattice carrier", () => {
    // Pin the local plan builder against the shipped one at the frozen
    // carrier before trusting any alternative row.
    const shipped = ARMS[3].plan as LatticePointTilingPlan;
    const localAtShipped = buildLocalLatticePlan(
      ARMS[3].resolved as ResolvedLatticeTiling,
    );
    expect(localAtShipped.upper.length).toBe(shipped.upper.length);
    expect(Array.from(localAtShipped.cells)).toEqual(Array.from(shipped.cells));
    expect(Array.from(localAtShipped.upper)).toEqual(Array.from(shipped.upper));
    expect(Array.from(localAtShipped.cdfByWallMask[0].cellOrdinals)).toEqual(
      Array.from(shipped.cdfByWallMask[0].cellOrdinals),
    );

    const rows: Record<string, string | number>[] = [];
    const pose = POSES[1];
    for (const outerMult of [LATTICE_PRESENTATION_RADIUS_MULT, 8, 6, 4]) {
      const policy: LatticePresentationPolicy = {
        outerRadiusMult: outerMult,
        fadeStartRadiusMult: outerMult * 0.8,
      };
      const arm = buildCarrierArm(`lattice@${outerMult}R`, policy);
      const plan = arm.plan as LatticePointTilingPlan;
      const refAttempts = Math.max(
        1,
        Math.floor(ATTEMPTS / REF_LATTICE_ATTEMPT_DIVISOR),
      );
      const ref = runReference(arm, pose, refAttempts);
      const a0 = runA0(arm, pose, ATTEMPTS);
      const metric = compareGrids(a0.fine, ref.fine);
      const detail = voxelsPerContentDiameter(NATIVE, arm.E);
      rows.push({
        carrier: `${outerMult}R`,
        shippedPolicy:
          outerMult === LATTICE_PRESENTATION_RADIUS_MULT
            ? "yes"
            : "REFUSED by resolvePointTilingPlan",
        fadeStart: fixed(
          (arm.resolved as ResolvedLatticeTiling).presentation.fadeStartRadius,
          4,
        ),
        E: fixed(arm.E, 4),
        cells: plan.upper.length,
        voxPerContentDia: fixed(detail, 2),
        detailCap: verdict(detail >= MIN_VOXELS_PER_CONTENT_DIAMETER),
        refAttempts,
        refEmitted: ref.stats.emitted,
        a0Emitted: a0.stats.emitted,
        a0VisibleFraction: fixed(
          a0.stats.deposits / Math.max(a0.stats.emitted, 1),
          4,
        ),
        l1Fine: fixed(metric.l1),
        l1Cap: verdict(metric.l1 <= MAX_NORMALIZED_L1),
      });
    }
    console.log(
      `[solid-tiling-4d] lattice carrier sweep at ${pose.label} (fade start = 0.8x outer, the shipped ${LATTICE_PRESENTATION_FADE_START_MULT}/${LATTICE_PRESENTATION_RADIUS_MULT} ratio); each row's REF is built at the SAME carrier. Only the 10R row is reachable through the shipped plan builder — every other row needed this sheet's local mirror of it.`,
    );
    console.table(rows);
  });
});
