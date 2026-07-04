import { ESCAPE_LIMIT, runChaosGame } from "./chaos-game";
import type { Rng } from "./rng";
import { VARIATION_TYPES } from "./types";
import type {
  Bounds,
  Transform,
  Variation,
  Vec3,
  VariationType,
} from "./types";

/** A freshly rolled system: the base maps, plus an optional final-transform
 * lens (see {@link Transform} and `AppState.finalTransform`). */
export interface RandomSystem {
  transforms: Transform[];
  finalTransform: Transform | null;
}

/** Map count is `MIN_MAP_COUNT + floor(rng() * MAP_COUNT_SPAN)`, i.e. 2..4 —
 * enough to read as a system without making the transform list unwieldy. */
const MIN_MAP_COUNT = 2;
const MAP_COUNT_SPAN = 3;

const POSITION_RANGE = 0.9;
/** Target similarity dimension: `n` maps at uniform scale `s` fill
 * D = log(n)/log(1/s), so drawing D and solving s = n^(-1/D) couples
 * contraction to map count. Independent scale draws let a 2-map system land
 * at D ≈ 1.2 — a mathematically fine attractor that renders as a wisp of
 * dust. Keeping D in roughly [1.9, 2.7] gives every roll enough "mass" to
 * read as a shape at the default camera. */
const TARGET_DIMENSION_MIN = 1.9;
const TARGET_DIMENSION_MAX = 2.7;
/** Per-map wobble around the system's base scale (±10%). */
const SCALE_JITTER = 0.1;
/** Extra per-axis wobble (±20%) for the anisotropic case. */
const AXIS_JITTER = 0.2;
const SCALE_MIN = 0.35;
const SCALE_MAX = 0.85;
const UNIFORM_SCALE_PROBABILITY = 0.7;
const SHEAR_RANGE = 0.3;
const ZERO_SHEAR_PROBABILITY = 0.7;
/** weight = floor(1 + WEIGHT_ROLL · rng() · rng()): the product of two
 * uniforms skews toward 0, so most maps land at a small weight and only
 * occasionally dominate the selection (barnsleyFern's skew, rolled instead
 * of authored). Capped at 25:1 — steeper skews starve the light maps'
 * regions of points and the cloud goes patchy. */
const WEIGHT_ROLL = 24;

const FIRST_VARIATION_PROBABILITY = 0.6;
const SECOND_VARIATION_PROBABILITY = 0.2;
const VARIATION_WEIGHT_MIN = 0.3;
const VARIATION_WEIGHT_MAX = 0.9;
/** Whenever a map rolls a nonlinear variation, it also gets a weighted
 * `linear` companion — mirrors swirlFlame's `{swirl: 1, linear: 0.2}` so the
 * map doesn't collapse into the variation's own degenerate shape. Weighted
 * high relative to the variation so the affine backbone keeps the attractor
 * cohesive — weaker companions let spherical/horseshoe shred it to dust. */
const LINEAR_COMPANION_WEIGHT_MIN = 0.4;
const LINEAR_COMPANION_WEIGHT_MAX = 0.8;
const NON_LINEAR_VARIATION_TYPES = VARIATION_TYPES.filter(
  (type) => type !== "linear",
);

const FINAL_TRANSFORM_NULL_PROBABILITY = 0.75;
const FINAL_VARIATION_WEIGHT_MIN = 0.6;
const FINAL_VARIATION_WEIGHT_MAX = 1.2;
const FINAL_VARIATION_TYPES: VariationType[] = [
  "spherical",
  "bubble",
  "disc",
  "julia",
];

/** Probe size for the quality gate: large enough for a candidate's bounds to
 * settle onto its attractor and to populate the occupancy grid, small enough
 * that rerolling is cheap. */
const PROBE_POINTS = 4000;
/** Total candidates tried before giving up and returning the last one. */
const MAX_ATTEMPTS = 40;
/** Below this, the second-largest per-axis extent reads as "no shape" (see
 * {@link isAcceptableSystem}). */
const DEGENERATE_EXTENT_THRESHOLD = 0.05;
/** Fraction of ESCAPE_LIMIT that counts as "hugging the escape wall" (see
 * {@link isAcceptableSystem}). */
const ESCAPE_WALL_FRACTION = 0.9;
/** Cells per axis for the {@link occupiedCellCount} voxelization. */
const OCCUPANCY_GRID = 24;
/** Minimum occupied 24³ cells for a probe to read as a structured cloud.
 * Calibrated against the presets (every one lands ≥ 350, the thinnest being
 * barnsleyFern) and against captured dusty rolls (≤ ~210): systems whose
 * orbit piles onto a handful of micro-clusters stop claiming new cells at
 * this resolution, while genuine fractal structure keeps resolving. */
export const MIN_OCCUPIED_CELLS = 280;

function uniform(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

function randomVec3(rng: Rng, min: number, max: number): Vec3 {
  return [
    uniform(rng, min, max),
    uniform(rng, min, max),
    uniform(rng, min, max),
  ];
}

function clampScale(value: number): number {
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, value));
}

function randomScale(rng: Rng, baseScale: number): Vec3 {
  const s = clampScale(
    baseScale * uniform(rng, 1 - SCALE_JITTER, 1 + SCALE_JITTER),
  );
  if (rng() < UNIFORM_SCALE_PROBABILITY) return [s, s, s];
  return [
    clampScale(s * uniform(rng, 1 - AXIS_JITTER, 1 + AXIS_JITTER)),
    clampScale(s * uniform(rng, 1 - AXIS_JITTER, 1 + AXIS_JITTER)),
    clampScale(s * uniform(rng, 1 - AXIS_JITTER, 1 + AXIS_JITTER)),
  ];
}

function randomShear(rng: Rng): Vec3 {
  if (rng() < ZERO_SHEAR_PROBABILITY) return [0, 0, 0];
  return randomVec3(rng, -SHEAR_RANGE, SHEAR_RANGE);
}

function randomWeight(rng: Rng): number {
  return Math.floor(1 + WEIGHT_ROLL * rng() * rng());
}

function randomVariationType(rng: Rng): VariationType {
  return NON_LINEAR_VARIATION_TYPES[
    Math.floor(rng() * NON_LINEAR_VARIATION_TYPES.length)
  ];
}

/**
 * Roll a transform's variation blend: 60% chance of one nonlinear variation,
 * then (only if the first landed) a further 20% chance of a second, each at
 * a weight in `[0.3, 0.9]`. Whenever at least one landed, a `linear`
 * companion at `[0.4, 0.8]` is appended. Returns `undefined` when nothing was
 * rolled, matching how a plain preset transform carries no `variations` key
 * at all (see e.g. `defaultTransforms`).
 */
function randomVariations(rng: Rng): Variation[] | undefined {
  const variations: Variation[] = [];
  if (rng() < FIRST_VARIATION_PROBABILITY) {
    variations.push({
      type: randomVariationType(rng),
      weight: uniform(rng, VARIATION_WEIGHT_MIN, VARIATION_WEIGHT_MAX),
    });
    if (rng() < SECOND_VARIATION_PROBABILITY) {
      variations.push({
        type: randomVariationType(rng),
        weight: uniform(rng, VARIATION_WEIGHT_MIN, VARIATION_WEIGHT_MAX),
      });
    }
  }
  if (variations.length === 0) return undefined;
  variations.push({
    type: "linear",
    weight: uniform(
      rng,
      LINEAR_COMPANION_WEIGHT_MIN,
      LINEAR_COMPANION_WEIGHT_MAX,
    ),
  });
  return variations;
}

function randomTransform(rng: Rng, id: number, baseScale: number): Transform {
  const variations = randomVariations(rng);
  return {
    id,
    position: randomVec3(rng, -POSITION_RANGE, POSITION_RANGE),
    rotation: randomVec3(rng, -Math.PI, Math.PI),
    scale: randomScale(rng, baseScale),
    weight: randomWeight(rng),
    shear: randomShear(rng),
    ...(variations ? { variations } : {}),
  };
}

function randomTransforms(rng: Rng): Transform[] {
  const count = MIN_MAP_COUNT + Math.floor(rng() * MAP_COUNT_SPAN);
  const dimension = uniform(rng, TARGET_DIMENSION_MIN, TARGET_DIMENSION_MAX);
  const baseScale = Math.pow(count, -1 / dimension);
  return Array.from({ length: count }, (_, id) =>
    randomTransform(rng, id, baseScale),
  );
}

/**
 * Roll the optional final-transform lens: absent with probability
 * `FINAL_TRANSFORM_NULL_PROBABILITY`; otherwise the identity affine
 * (mirrors `defaultFinalTransform`) plus one variation from the four
 * "lens-flavored" types, at a weight in `[0.6, 1.2]`.
 */
function randomFinalTransform(rng: Rng): Transform | null {
  if (rng() < FINAL_TRANSFORM_NULL_PROBABILITY) return null;
  const type =
    FINAL_VARIATION_TYPES[Math.floor(rng() * FINAL_VARIATION_TYPES.length)];
  return {
    id: 0,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    variations: [
      {
        type,
        weight: uniform(
          rng,
          FINAL_VARIATION_WEIGHT_MIN,
          FINAL_VARIATION_WEIGHT_MAX,
        ),
      },
    ],
  };
}

function randomCandidate(rng: Rng): RandomSystem {
  return {
    transforms: randomTransforms(rng),
    finalTransform: randomFinalTransform(rng),
  };
}

/**
 * Whether a probed system's point-cloud bounds look like a genuine
 * attractor: not collapsed to a point/line, and not stuck bouncing off the
 * chaos game's escape wall.
 *
 * Degenerate check: only the SECOND-largest per-axis extent is tested. A
 * point has every extent near zero (so the second-largest is too); a line
 * has only one axis with real extent (so the second-largest is still near
 * zero). A planar system — two large extents, one near zero — has a
 * healthy second-largest extent and is correctly ACCEPTED: plenty of good
 * IFS attractors are flat.
 *
 * Divergent check: `stepOrbit` reseeds a coordinate the instant it exceeds
 * `ESCAPE_LIMIT`, so a genuinely unbounded system never reports a bound past
 * that threshold — instead its bounds hug just under it, as the orbit
 * repeatedly grows toward the wall before being reset. Any axis bound at or
 * past `ESCAPE_WALL_FRACTION` of the limit is that signature.
 */
export function isAcceptableSystem(bounds: Bounds): boolean {
  const extents = [
    bounds.maxX - bounds.minX,
    bounds.maxY - bounds.minY,
    bounds.maxZ - bounds.minZ,
  ].sort((a, b) => b - a);
  if (extents[1] < DEGENERATE_EXTENT_THRESHOLD) return false;

  const wall = ESCAPE_LIMIT * ESCAPE_WALL_FRACTION;
  const axisBounds = [
    bounds.minX,
    bounds.maxX,
    bounds.minY,
    bounds.maxY,
    bounds.minZ,
    bounds.maxZ,
  ];
  if (axisBounds.some((b) => Math.abs(b) >= wall)) return false;

  return true;
}

/**
 * How many cells of a 24³ grid stretched over `bounds` (each axis normalized
 * to its own extent, so flat systems aren't penalized) contain at least one
 * probe point. This is a box-count at a single scale: a healthy attractor
 * spreads its orbit over hundreds of cells, while a "dust" system — one whose
 * maps contract so hard the orbit piles onto a few dozen micro-clusters —
 * saturates early no matter how many points are thrown at it. Sane bounds
 * alone can't tell those apart; this can.
 */
export function occupiedCellCount(
  positions: Float32Array,
  count: number,
  bounds: Bounds,
): number {
  const minExtent = 1e-9;
  const spanX = Math.max(bounds.maxX - bounds.minX, minExtent);
  const spanY = Math.max(bounds.maxY - bounds.minY, minExtent);
  const spanZ = Math.max(bounds.maxZ - bounds.minZ, minExtent);
  const last = OCCUPANCY_GRID - 1;
  const cells = new Set<number>();
  for (let i = 0; i < count; i++) {
    const cx = Math.min(
      last,
      Math.floor(((positions[i * 3] - bounds.minX) / spanX) * OCCUPANCY_GRID),
    );
    const cy = Math.min(
      last,
      Math.floor(
        ((positions[i * 3 + 1] - bounds.minY) / spanY) * OCCUPANCY_GRID,
      ),
    );
    const cz = Math.min(
      last,
      Math.floor(
        ((positions[i * 3 + 2] - bounds.minZ) / spanZ) * OCCUPANCY_GRID,
      ),
    );
    cells.add((cx * OCCUPANCY_GRID + cy) * OCCUPANCY_GRID + cz);
  }
  return cells.size;
}

/**
 * Generate a random IFS: 2-4 affine maps with weighted selection, shear, and
 * nonlinear variations, plus a chance of a final-transform lens — everything
 * the core supports, so "Surprise Me" can reach anywhere the manual editor
 * can. Each candidate is probed with a short `runChaosGame` run and must
 * pass two checks: {@link isAcceptableSystem} (sane bounds — not collapsed,
 * not hugging the escape wall) and {@link occupiedCellCount} ≥
 * `MIN_OCCUPIED_CELLS` (enough spatial detail to read as a shape rather than
 * dust). A rejected candidate is discarded and a fresh one rolled, for up to
 * `MAX_ATTEMPTS` candidates total. Always returns something — the
 * last-rolled candidate survives even if every one failed the gate — so the
 * UI never needs a failure path.
 *
 * Takes only an injected {@link Rng} and never touches `Math.random`, so a
 * fixed seed reproduces the exact same system, gate probes included.
 */
export function randomSystem(rng: Rng): RandomSystem {
  let candidate = randomCandidate(rng);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) candidate = randomCandidate(rng);
    const { positions, count, bounds } = runChaosGame(
      candidate.transforms,
      PROBE_POINTS,
      rng,
      candidate.finalTransform,
    );
    if (
      isAcceptableSystem(bounds) &&
      occupiedCellCount(positions, count, bounds) >= MIN_OCCUPIED_CELLS
    )
      return candidate;
  }
  return candidate;
}
