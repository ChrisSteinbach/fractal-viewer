import { systemIsFlat, toTransform4 } from "./affine4";
import { ESCAPE_LIMIT, runChaosGame } from "./chaos-game";
import { runChaosGame4 } from "./chaos-game-4d";
import type { Rng } from "./rng";
import { VARIATION_TYPES } from "./types";
import type {
  Bounds,
  Bounds4,
  SymmetryParams,
  Transform,
  Variation,
  Vec3,
  VariationType,
  WExtension,
} from "./types";

/** A freshly rolled system: the base maps, plus an optional final-transform
 * lens (see {@link Transform} and `AppState.finalTransform`). Rare spice
 * (fr-bf6.5): roughly one roll in four ({@link FOUR_D_PROBABILITY}) also
 * gives some of the base maps a sparse `w` extension (see
 * {@link Transform.w}), landing a genuinely non-flat system that the app
 * renders through its tumbling 4D projection instead of the flat point
 * cloud. The final transform never carries a `w` block — see
 * {@link randomFinalTransform}.
 *
 * `symmetry` (fr-wti's follow-up, landed via fr-d61) is rolled for FLAT
 * systems only — see {@link randomSymmetry}. `null` means "no kaleidoscope",
 * and is also what every non-flat roll carries unconditionally (the 4D
 * pipeline has no symmetry parameter to roll one into). Like
 * `finalTransform`, the consumer must apply this field to the app's
 * symmetry state INCLUDING resetting it to order 1 on `null`, so a previous
 * session's kaleidoscope never survives a roll that landed on no symmetry. */
export interface RandomSystem {
  transforms: Transform[];
  finalTransform: Transform | null;
  symmetry: SymmetryParams | null;
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
/**
 * Floor on a map's shared (pre-per-axis) scale, expressed as a similarity
 * dimension rather than a raw scale so it composes with whatever `n` the
 * roll picked. fr-d61: a validation failure surfaced a 2-map pure-affine
 * roll where both maps' ±{@link SCALE_JITTER} draws happened to land low,
 * dragging the effective similarity dimension to ≈1.7 — well under
 * {@link TARGET_DIMENSION_MIN} — and rendering as a thin squiggle that only
 * barely cleared the occupancy gate.
 *
 * The fix: after jitter, each map's shared scale is floored at
 * `count^(-1/EFFECTIVE_DIMENSION_FLOOR)`. By the Moran equation (`n` maps at
 * uniform scale `s` solve `n·s^D = 1`), that floor guarantees a uniform-scale
 * system can never land below D = 1.8, no matter which way the jitter
 * breaks.
 *
 * Set to 1.8 rather than {@link TARGET_DIMENSION_MIN}'s 1.9: a hair under the
 * target so downward jitter still has a visible effect on low-D draws — this
 * is a floor under the wisp zone, not a deletion of the jitter.
 */
const EFFECTIVE_DIMENSION_FLOOR = 1.8;
const SCALE_MIN = 0.35;
const SCALE_MAX = 0.85;
const UNIFORM_SCALE_PROBABILITY = 0.7;
/**
 * Per-map odds of rolling a MIRRORED map (fr-o1y): exactly one axis of the
 * rolled scale is negated, making the map orientation-reversing — the
 * handedness-flipping family the chiralLace preset celebrates, which the
 * all-positive {@link SCALE_MIN}..{@link SCALE_MAX} magnitudes could never
 * reach. One axis, never two: with `det R = det U = 1` in the engine's
 * `M = R · diag(scale) · U` decomposition, `det M` flips sign exactly when
 * an ODD number of scale entries are negative — negating two axes is just a
 * π-rotation about the third, territory the free ±π rotation roll already
 * covers.
 *
 * Applied AFTER {@link randomScale} (see {@link randomReflection}), so the
 * magnitude story — dimension floor, clamps, jitter — is untouched: a
 * mirror changes handedness, not contraction (`|det M|` is unchanged), so
 * the bounds/occupancy gates judge mirrored candidates on the same terms as
 * everything else, with no re-tuning. Kept the rarest of the per-map rolls:
 * at 0.1 roughly a quarter of returned systems carry at least one mirrored
 * map — the same order as the module's other rare-spice features
 * ({@link FOUR_D_PROBABILITY}, {@link SYMMETRY_PROBABILITY}).
 */
const REFLECTION_PROBABILITY = 0.1;
const SHEAR_RANGE = 0.3;
const ZERO_SHEAR_PROBABILITY = 0.7;
/** weight = floor(1 + WEIGHT_ROLL · rng() · rng()): the product of two
 * uniforms skews toward 0, so most maps land at a small weight and only
 * occasionally dominate the selection (barnsleyFern's skew, rolled instead
 * of authored). Capped at 25:1 — steeper skews starve the light maps'
 * regions of points and the cloud goes patchy. */
const WEIGHT_ROLL = 24;
/**
 * Cap on a 2-map system's weight ratio. fr-d61's validation fail had a
 * second ingredient alongside the thin scale draw: a 3:16 weight skew on a
 * 2-map roll, leaving the light branch only ~16% of the orbit's points —
 * starving half the structure. Applied deterministically to `weight` AFTER
 * both maps have rolled ({@link randomTransforms}), so it costs no extra rng
 * draws: the heavier map is clamped to at most `TWO_MAP_WEIGHT_RATIO_CAP`
 * times the lighter, guaranteeing the lighter map at least a fifth of the
 * selection.
 *
 * Scoped to `n = 2` only: with 3+ maps, a single starved map still leaves at
 * least two well-fed maps carrying the structure, so this failure mode
 * doesn't arise. Preset-style heavy skews are legitimate at that map count —
 * `barnsleyFern`'s frond ≈85% / leaflets ≈7% / stem ≈1% needs exactly that
 * kind of imbalance on a 4-map system — so 3+-map rolls keep
 * {@link WEIGHT_ROLL}'s full 25:1 reach.
 */
const TWO_MAP_WEIGHT_RATIO_CAP = 4;

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

/**
 * Rotational-symmetry roll: fr-wti's original follow-up idea, landed here
 * via fr-d61 now that fr-6im has shipped rotational/mirror symmetry —
 * random kaleidoscopes look disproportionately good for how cheap they are
 * to roll, so roughly 3 flat rolls in 10 also land one, at an integer order
 * of 2..6 ({@link SYMMETRY_ORDER_MIN} + `floor(rng() *`
 * {@link SYMMETRY_ORDER_SPAN}`)`), comfortably inside the UI slider's 1..9
 * range.
 *
 * The axis is ALWAYS `"y"`, never rolled: every rolled map already carries a
 * uniformly random rotation, so changing the world axis the kaleidoscope
 * turns about amounts to a global reorientation of the whole cloud — and the
 * free-orbiting camera erases any difference reorientation would make. It
 * would be a draw spent on no added variety.
 *
 * 4D candidates NEVER roll symmetry (see {@link randomCandidate}): the 4D
 * pipeline (`runChaosGame4` plus the projection view) has no symmetry
 * parameter at all, and the app hides the symmetry controls while a system
 * is non-flat, so a rolled order on a non-flat system would be a dial the
 * renderer ignores and the quality gate never probes.
 */
const SYMMETRY_PROBABILITY = 0.3;
const SYMMETRY_ORDER_MIN = 2;
const SYMMETRY_ORDER_SPAN = 5;

/**
 * Rare-spice roll (fr-bf6.5): one system-level draw deciding whether THIS
 * candidate gets a `w` extension at all — no UI dial, just an occasional
 * surprise. A miss costs exactly this one `rng()` draw: every subsequent
 * roll takes the same path, and consumes the rng identically, as before this
 * feature existed. A hit always yields a non-flat system (the force-
 * fallback in {@link randomTransforms} guarantees it), so this is also, in
 * practice, the fraction of "Surprise Me" rolls that land in the tumbling 4D
 * projection view instead of the flat cloud.
 */
const FOUR_D_PROBABILITY = 0.25;
/** Per-map odds of a rolled `w.position` (see {@link randomWExtension}) once
 * a candidate has hit {@link FOUR_D_PROBABILITY} — independent of the
 * rotation roll below and of the existing weight/variation rolls (fr-d61:
 * coupling a 4D roll to map weight would skew which maps get the
 * selection spotlight). */
const FOUR_D_POSITION_PROBABILITY = 0.6;
/** `w.position` uniform range: comfortably inside the editor's ±1.5 clamp,
 * so a hit's structure stays near the `w = 0` slice rather than flung to
 * the edge of the range. */
const FOUR_D_POSITION_RANGE = 0.5;
/** Per-map odds of a rolled w-rotation kick — one plane, occasionally two
 * (see {@link randomWExtension}). */
const FOUR_D_ROTATION_PROBABILITY = 0.6;
/** Odds of a SECOND, distinct w-rotation plane once the first has landed:
 * most hits stay single-plane, a double mix is the occasional extra
 * flourish (the same "mostly one, sometimes a second" shape as
 * {@link SECOND_VARIATION_PROBABILITY}). */
const FOUR_D_SECOND_ROTATION_PROBABILITY = 0.25;
/** w-rotation angle range (radians), tuned so a hit reliably clears the 4D
 * quality gate (see {@link isAcceptableSystem4} and random-system.test.ts):
 * wide enough to visibly mix `w` into the projection, narrow enough that a
 * rotation kick alone rarely pushes an otherwise-contractive system toward
 * the escape wall. */
const FOUR_D_ROTATION_RANGE = 0.7;
/** The three w-mixing rotation planes a hit can pick from (see
 * {@link WExtension}'s `rotation` field). */
const W_ROTATION_PLANES = ["xw", "yw", "zw"] as const;
/**
 * Fallback range for forcing map 0's `w.position` non-flat (see
 * {@link randomTransforms}), used on the rare roll where every map's
 * independent `w` sub-rolls miss — or land on exactly `0` — and a "hit"
 * candidate would otherwise come out flat despite paying for the roll.
 * Half-open away from `0` (unlike the free ±0.5 roll range) so the fallback
 * is non-flat BY CONSTRUCTION: it never depends on missing the one unlucky
 * value that would cancel it back to flat.
 */
const FOUR_D_FORCE_POSITION_MIN = 0.15;
const FOUR_D_FORCE_POSITION_MAX = 0.5;

/** Probe size for the quality gate: large enough for a candidate's bounds to
 * settle onto its attractor and to populate the occupancy grid, small enough
 * that rerolling is cheap — acceptance costs {@link STABILITY_PROBES} probes
 * of this size, one probe per {@link scoreCandidate} call (fr-b5x's
 * stability gate; see {@link randomSystem}). Shared by the flat
 * (`runChaosGame`) and non-flat (`runChaosGame4`) probes — a larger sample
 * was tried for the 4D branch during tuning and didn't meaningfully change the
 * gate's tail behavior (see {@link FOUR_D_RADIUS_CAP}'s doc for why), so
 * there was nothing 4D-specific to justify a separate budget here. */
const PROBE_POINTS = 4000;
/** Total candidates tried before giving up and returning the best-scoring
 * one seen (see {@link scoreCandidate}; fr-b5x — formerly the arbitrary
 * LAST one rolled). Measured over 20000 seeded rolls — with the
 * {@link STABILITY_PROBES} gate in place — not one burned through all 40,
 * so the exhaustion fallback is a backstop for pathological rng streams,
 * not a hot path; that is also why no test pins a specific exhausting seed
 * (none exists to pin at any reasonable scan size). */
const MAX_ATTEMPTS = 40;
/**
 * How many independent probes must ALL clear the gate before a candidate is
 * accepted (fr-b5x's stability gate — see {@link randomSystem} for why one
 * probe is not enough). Chosen from a measured ladder on the 2000-seed sweep
 * (scripts/surprise-residual.harness.ts): accepted flat systems re-probing
 * below the occupancy floor on one fresh stream went 39 → 27 → 14 → 8 for
 * 1 → 2 → 3 → 4 probes (and reliably-thin all-3-streams failures 10 → 6 →
 * 3 → 0). Stopped at 3: the step to 4 is inside the sweep's own sampling
 * noise (±4 on those counts), while every extra probe compounds the
 * acceptance odds AGAINST legitimately-sparse-but-STABLE systems
 * (barnsleyFern-class rolls pass each probe at roughly 0.85-0.9, so they
 * keep only that rate raised to this power) — pruning exactly the airy
 * rolls worth keeping, to chase a tail already far below fr-wti's manual
 * acceptance bar.
 */
const STABILITY_PROBES = 3;
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
 * this resolution, while genuine fractal structure keeps resolving. fr-d61
 * fixed its thin-roll causes at the source instead of raising this floor —
 * the scale floor ({@link EFFECTIVE_DIMENSION_FLOOR}) and 2-map weight cap
 * ({@link TWO_MAP_WEIGHT_RATIO_CAP}) — since barnsleyFern already probes at
 * ~350, leaving little headroom to raise it into. */
export const MIN_OCCUPIED_CELLS = 280;
/** Below this, a non-flat candidate's `w` extent reads as visually flat in
 * the projection view — no better than not rolling `w` at all — so
 * {@link isAcceptableSystem4} rejects it and a fresh candidate is rolled
 * instead (see {@link randomSystem}). */
const FOUR_D_MIN_W_EXTENT = 0.1;
/**
 * Sane upper bound on a 4D probe's `radius` (the exact Euclidean distance
 * from the cloud's center — see `chaos-game-4d.ts`'s `ChaosGame4Result`),
 * used by {@link isAcceptableSystem4} as the 4D boundedness signal.
 * `runChaosGame4` exposes no reset/escape counter to read directly, so —
 * mirroring the bounds/radius discipline the `doubleRotation` preset's own
 * acceptance test uses (presets.test.ts, `radius < 3`) — this catches a
 * candidate that never technically hugs the {@link ESCAPE_LIMIT} wall on any
 * single axis but is still too sprawling to read as a contained shape once
 * framed by that radius.
 *
 * Set to HALF of `ESCAPE_LIMIT` rather than something doubleRotation-sized:
 * unlike that hand-tuned preset, this generator's own contractive ranges
 * (position up to ±0.9, scale as weak as 0.35 — i.e. contraction ratio up to
 * 0.65) LEGITIMATELY produce bounded, non-escaping attractors with a radius
 * up to the high teens/low twenties fairly often (measured across a
 * 5000-seed sample: median ≈ 2, p90 ≈ 5, p99 ≈ 20) — a translation-heavy,
 * weakly-contracting map has a genuinely large fixed-point spread, not a
 * sampling fluke. A cap near `doubleRotation`'s 3 would reject a large slice
 * of perfectly good rolls. Half the hard escape threshold keeps this a
 * genuine backstop against outliers while comfortably covering the
 * generator's real range.
 *
 * No finite-sample cap fully closes the gap between "accepted at generation
 * time" and "would still look bounded under a differently-seeded probe" —
 * {@link PROBE_POINTS} is a small sample of a chaotic orbit, so a rare,
 * only-marginally-contractive candidate can occasionally pass on a lucky
 * draw and read larger on a fresh one. That is not new here: an equivalent
 * check against the EXISTING flat/3D gate (random-system.test.ts) shows the
 * same phenomenon at a higher rate (its escape-wall threshold is a much
 * more permissive `ESCAPE_LIMIT * ESCAPE_WALL_FRACTION` ≈ 45). This cap is
 * tuned to keep that already-inherent tail rare, not to eliminate it.
 */
const FOUR_D_RADIUS_CAP = ESCAPE_LIMIT * 0.5;

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

/**
 * Roll a map's scale: shared jitter around `baseScale`, floored at
 * `scaleFloor` ({@link EFFECTIVE_DIMENSION_FLOOR}) so a run of unlucky
 * downward jitter can't thin the map below the dimension floor — then, most
 * of the time, spread into independent per-axis wobble
 * ({@link AXIS_JITTER}).
 *
 * The floor applies to the shared `s` only, never to the per-axis draws
 * below: the axis jitter is mass-neutral in expectation (the geometric mean
 * of three independent `U[0.8, 1.2]` factors is ≈1), so it reshapes the map
 * rather than thinning it. The rare all-axes-down tail is left to the
 * occupancy gate, as it always was.
 */
function randomScale(rng: Rng, baseScale: number, scaleFloor: number): Vec3 {
  const s = clampScale(
    Math.max(
      scaleFloor,
      baseScale * uniform(rng, 1 - SCALE_JITTER, 1 + SCALE_JITTER),
    ),
  );
  if (rng() < UNIFORM_SCALE_PROBABILITY) return [s, s, s];
  return [
    clampScale(s * uniform(rng, 1 - AXIS_JITTER, 1 + AXIS_JITTER)),
    clampScale(s * uniform(rng, 1 - AXIS_JITTER, 1 + AXIS_JITTER)),
    clampScale(s * uniform(rng, 1 - AXIS_JITTER, 1 + AXIS_JITTER)),
  ];
}

/**
 * Maybe mirror a rolled scale (fr-o1y): with
 * {@link REFLECTION_PROBABILITY}, negate one uniformly-chosen axis.
 * Gate-first like {@link randomShear}, so a miss costs exactly one draw and
 * a hit exactly two.
 */
function randomReflection(rng: Rng, scale: Vec3): Vec3 {
  if (rng() >= REFLECTION_PROBABILITY) return scale;
  const mirrored: Vec3 = [...scale];
  const axis = Math.floor(rng() * 3);
  mirrored[axis] = -mirrored[axis];
  return mirrored;
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

/**
 * Roll a sparse per-map `w` extension for a system that hit
 * {@link FOUR_D_PROBABILITY}: independently, a `w.position` offset
 * ({@link FOUR_D_POSITION_PROBABILITY}) and a w-rotation kick — one plane,
 * occasionally two ({@link FOUR_D_ROTATION_PROBABILITY} /
 * {@link FOUR_D_SECOND_ROTATION_PROBABILITY}). Deliberately independent of
 * `weight`/`variations` (fr-d61's weight-skew caution: coupling a 4D roll to
 * either would bias which maps get chosen or how they're already warped).
 *
 * `w.scale` is NEVER rolled: left absent, `toTransform4` derives it as the
 * map's mean spatial contraction, which is already inside this generator's
 * contractive scale bounds — so there is no new escape risk from leaving it
 * derived, and nothing goes stale as the map's own scale is edited later.
 * `w.shear` is NEVER rolled either: it adds little visible variety in the
 * projection view for the extra sparse-roll complexity it would cost.
 *
 * Returns `undefined` when both sub-rolls miss, so a transform with no
 * genuine 4D degrees of freedom carries no `w` key at all — the same
 * absent-means-flat convention `affine4.ts`'s `isFlatTransform` relies on.
 */
function randomWExtension(rng: Rng): WExtension | undefined {
  const w: WExtension = {};
  if (rng() < FOUR_D_POSITION_PROBABILITY) {
    w.position = uniform(rng, -FOUR_D_POSITION_RANGE, FOUR_D_POSITION_RANGE);
  }
  if (rng() < FOUR_D_ROTATION_PROBABILITY) {
    const first =
      W_ROTATION_PLANES[Math.floor(rng() * W_ROTATION_PLANES.length)];
    const rotation: NonNullable<WExtension["rotation"]> = {
      [first]: uniform(rng, -FOUR_D_ROTATION_RANGE, FOUR_D_ROTATION_RANGE),
    };
    if (rng() < FOUR_D_SECOND_ROTATION_PROBABILITY) {
      const remaining = W_ROTATION_PLANES.filter((plane) => plane !== first);
      const second = remaining[Math.floor(rng() * remaining.length)];
      rotation[second] = uniform(
        rng,
        -FOUR_D_ROTATION_RANGE,
        FOUR_D_ROTATION_RANGE,
      );
    }
    w.rotation = rotation;
  }
  return Object.keys(w).length > 0 ? w : undefined;
}

function randomTransform(
  rng: Rng,
  id: number,
  baseScale: number,
  scaleFloor: number,
  fourD: boolean,
): Transform {
  const variations = randomVariations(rng);
  const w = fourD ? randomWExtension(rng) : undefined;
  return {
    id,
    position: randomVec3(rng, -POSITION_RANGE, POSITION_RANGE),
    rotation: randomVec3(rng, -Math.PI, Math.PI),
    scale: randomReflection(rng, randomScale(rng, baseScale, scaleFloor)),
    weight: randomWeight(rng),
    shear: randomShear(rng),
    ...(variations ? { variations } : {}),
    ...(w ? { w } : {}),
  };
}

/**
 * Roll the system's base maps. `fourD` (see {@link FOUR_D_PROBABILITY})
 * gates whether each map also rolls a sparse `w` extension
 * ({@link randomWExtension}); when it does and every map's independent w
 * rolls happen to miss (or land on exactly `0` — possible, if unlikely, with
 * a continuous uniform draw), the resulting system would come out flat
 * despite having paid for the roll, so map 0's `w.position` is force-set
 * into {@link FOUR_D_FORCE_POSITION_MIN}..{@link FOUR_D_FORCE_POSITION_MAX}
 * instead — a `fourD` hit always yields a non-flat system.
 */
function randomTransforms(rng: Rng, fourD: boolean): Transform[] {
  const count = MIN_MAP_COUNT + Math.floor(rng() * MAP_COUNT_SPAN);
  const dimension = uniform(rng, TARGET_DIMENSION_MIN, TARGET_DIMENSION_MAX);
  const baseScale = Math.pow(count, -1 / dimension);
  const scaleFloor = Math.pow(count, -1 / EFFECTIVE_DIMENSION_FLOOR);
  const transforms = Array.from({ length: count }, (_, id) =>
    randomTransform(rng, id, baseScale, scaleFloor, fourD),
  );
  if (transforms.length === 2) {
    const [a, b] = transforms;
    // `weight` is optional on Transform in general (omitted ⇒ 1), though
    // randomWeight() above always sets it concretely for a rolled map; the
    // `?? 1` here just satisfies the wider type, matching how chaos-game.ts
    // and chaos-game-4d.ts read this same optional field.
    const weightA = a.weight ?? 1;
    const weightB = b.weight ?? 1;
    const cap = TWO_MAP_WEIGHT_RATIO_CAP * Math.min(weightA, weightB);
    if (weightA > cap) transforms[0] = { ...a, weight: cap };
    if (weightB > cap) transforms[1] = { ...b, weight: cap };
  }
  if (fourD && systemIsFlat(transforms)) {
    transforms[0] = {
      ...transforms[0],
      w: {
        position: uniform(
          rng,
          FOUR_D_FORCE_POSITION_MIN,
          FOUR_D_FORCE_POSITION_MAX,
        ),
      },
    };
  }
  return transforms;
}

/**
 * Roll the optional final-transform lens: absent with probability
 * `FINAL_TRANSFORM_NULL_PROBABILITY`; otherwise the identity affine
 * (mirrors `defaultFinalTransform`) plus one variation from the four
 * "lens-flavored" types, at a weight in `[0.6, 1.2]`. Never carries a `w`
 * block (fr-bf6.5), even when the system it lenses is non-flat: a rolled
 * lens is rare enough already, and a non-flat lens would bend the WHOLE
 * cloud through an extra, hidden 4th-dimension feature the roll never
 * surfaces anywhere else.
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

/**
 * Roll an optional kaleidoscope for a flat candidate (see
 * {@link SYMMETRY_PROBABILITY}): a miss costs exactly one draw, a hit spends
 * one more on the order — the same sparse-roll discipline as this module's
 * other rare-spice rolls ({@link randomFinalTransform},
 * {@link randomWExtension}).
 */
function randomSymmetry(rng: Rng): SymmetryParams | null {
  if (rng() >= SYMMETRY_PROBABILITY) return null;
  return {
    order: SYMMETRY_ORDER_MIN + Math.floor(rng() * SYMMETRY_ORDER_SPAN),
    axis: "y",
  };
}

/**
 * Roll a full candidate: the base maps, the optional final-transform lens,
 * and (flat candidates only) an optional symmetry. Draw order is `fourD`
 * gate → `transforms` → `finalTransform` → `symmetry`. The
 * {@link FOUR_D_PROBABILITY} roll is deliberately the FIRST draw of a
 * candidate — a single leading `rng()` call — so a miss leaves every
 * subsequent roll's sequence (and the rng values it consumes) exactly as it
 * was before this feature existed; only a hit spends any further draws on
 * `w`. `symmetry` is rolled LAST, and only for a flat candidate (see
 * {@link randomSymmetry}): a `fourD` hit skips it for free (`null`, costing
 * no draw), matching that a non-flat system has nowhere to put a
 * kaleidoscope.
 */
function randomCandidate(rng: Rng): RandomSystem {
  const fourD = rng() < FOUR_D_PROBABILITY;
  return {
    transforms: randomTransforms(rng, fourD),
    finalTransform: randomFinalTransform(rng),
    symmetry: fourD ? null : randomSymmetry(rng),
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
 * The 4D analogue of {@link isAcceptableSystem}, probed via `runChaosGame4`
 * instead of `runChaosGame` for a non-flat candidate (see
 * {@link randomSystem}). `ChaosGame4Result` carries no reset/escape counter
 * to read directly, so boundedness is read from the two signals
 * `chaos-game-4d.ts` DOES expose:
 *
 * - the same per-axis wall-hugging check as {@link isAcceptableSystem},
 *   extended to the fourth axis (`bounds.minW`/`maxW` join the six 3D
 *   bounds against the same {@link ESCAPE_LIMIT} · {@link ESCAPE_WALL_FRACTION}
 *   threshold);
 * - a cap on `radius` ({@link FOUR_D_RADIUS_CAP}) — the exact Euclidean
 *   distance from the cloud's center — mirroring the pattern the
 *   `doubleRotation` preset's own acceptance test uses to assert "stays
 *   bounded" (presets.test.ts).
 *
 * The degenerate check is {@link isAcceptableSystem}'s unchanged (only the
 * second-largest of the x/y/z extents matters — a flat-in-3D system is
 * still a fine attractor). On top of it, a "4D surprise" also needs a
 * genuine w-extent: `maxW - minW` at or below {@link FOUR_D_MIN_W_EXTENT}
 * reads as visually flat in projection — no better than not rolling `w` at
 * all — so it is rejected here too.
 */
export function isAcceptableSystem4(bounds: Bounds4, radius: number): boolean {
  const extents = [
    bounds.maxX - bounds.minX,
    bounds.maxY - bounds.minY,
    bounds.maxZ - bounds.minZ,
  ].sort((a, b) => b - a);
  if (extents[1] < DEGENERATE_EXTENT_THRESHOLD) return false;

  if (bounds.maxW - bounds.minW <= FOUR_D_MIN_W_EXTENT) return false;

  const wall = ESCAPE_LIMIT * ESCAPE_WALL_FRACTION;
  const axisBounds4 = [
    bounds.minX,
    bounds.maxX,
    bounds.minY,
    bounds.maxY,
    bounds.minZ,
    bounds.maxZ,
    bounds.minW,
    bounds.maxW,
  ];
  if (axisBounds4.some((b) => Math.abs(b) >= wall)) return false;

  if (radius >= FOUR_D_RADIUS_CAP) return false;

  return true;
}

/**
 * The six axis-aligned fields {@link occupiedCellCount} actually reads.
 * {@link Bounds} and {@link Bounds4} both satisfy this structurally, so the
 * same occupancy grid serves the 3D probe and the 4D probe's projected-xyz
 * occupancy check (fr-bf6.5: the user judges structure by what shows up in
 * the projection, i.e. the xyz the 4D cloud carries) without
 * `occupiedCellCount` caring which result shape it was handed.
 */
type SpatialExtent = Pick<
  Bounds,
  "minX" | "maxX" | "minY" | "maxY" | "minZ" | "maxZ"
>;

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
  bounds: SpatialExtent,
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
 * {@link scoreCandidate}'s sentinel for a probe whose BOUNDS gate failed:
 * ranks strictly below every occupancy a real probe can produce (a
 * {@link PROBE_POINTS}-point probe always occupies at least one cell), so in
 * {@link randomSystem}'s best-candidate bookkeeping a degenerate,
 * escape-wall-hugging, or (4D) w-flat/over-sprawling candidate always loses
 * to a bounded-but-dusty one — dust at least renders as SOMETHING.
 */
const UNACCEPTABLE_BOUNDS_SCORE = -1;

/**
 * Probe a candidate once and score what came back:
 * {@link UNACCEPTABLE_BOUNDS_SCORE} when the probe's bounds gate failed,
 * otherwise the probe's occupied cell count. "This probe passed the gate" is
 * exactly `score >= MIN_OCCUPIED_CELLS`. The probe branches on the
 * candidate's flatness (`affine4.ts`'s `systemIsFlat`):
 *
 * - a FLAT candidate takes a short `runChaosGame` run — including any rolled
 *   `symmetry`, so the gate judges the kaleidoscoped cloud the user will
 *   actually see, bounds and occupancy alike — bounds-gated by
 *   {@link isAcceptableSystem} (sane bounds — not collapsed, not hugging the
 *   escape wall);
 * - a NON-FLAT candidate is instead probed by lifting every map through
 *   `toTransform4` and running `runChaosGame4`, bounds-gated by
 *   {@link isAcceptableSystem4} (the 4D analogue: bounded radius, and with a
 *   genuine w-extent), its occupancy counted over the result's projected xyz
 *   positions.
 *
 * Scores are comparable across the two branches — same grid, same floor —
 * so {@link randomSystem}'s best-candidate bookkeeping never needs to care
 * which kind of candidate it is holding.
 */
function scoreCandidate(candidate: RandomSystem, rng: Rng): number {
  if (systemIsFlat(candidate.transforms)) {
    const { positions, count, bounds } = runChaosGame(
      candidate.transforms,
      PROBE_POINTS,
      rng,
      candidate.finalTransform,
      candidate.symmetry ?? undefined,
    );
    if (!isAcceptableSystem(bounds)) return UNACCEPTABLE_BOUNDS_SCORE;
    return occupiedCellCount(positions, count, bounds);
  }
  const finalTransform4 = candidate.finalTransform
    ? toTransform4(candidate.finalTransform)
    : null;
  const { positions, count, bounds, radius } = runChaosGame4(
    candidate.transforms.map(toTransform4),
    PROBE_POINTS,
    rng,
    finalTransform4,
  );
  if (!isAcceptableSystem4(bounds, radius)) return UNACCEPTABLE_BOUNDS_SCORE;
  return occupiedCellCount(positions, count, bounds);
}

/**
 * Generate a random IFS: 2-4 affine maps with weighted selection, shear,
 * nonlinear variations, and an occasional single-axis mirror
 * ({@link REFLECTION_PROBABILITY} — fr-o1y), plus a chance of a
 * final-transform lens — everything the core supports, so "Surprise Me" can
 * reach anywhere the manual editor can — and, occasionally
 * ({@link FOUR_D_PROBABILITY}), a sparse `w` extension on some of the base
 * maps (fr-bf6.5), landing a genuinely 4D system. A flat candidate
 * additionally has a chance ({@link SYMMETRY_PROBABILITY}) of a rolled
 * rotational symmetry ({@link randomSymmetry}).
 *
 * Each candidate is probed ({@link scoreCandidate} — bounds sanity plus
 * {@link occupiedCellCount} ≥ `MIN_OCCUPIED_CELLS`) and must pass that gate
 * on {@link STABILITY_PROBES} consecutive, independently-seeded probes
 * before it's returned (fr-b5x). One probe is a {@link PROBE_POINTS}-point
 * finite sample of a chaotic orbit, and some otherwise-plausible variation
 * blends (spiral/handkerchief/swirl-heavy mixes especially) are multi-modal
 * at that sample size: which lobe the orbit favors is decided by stream
 * luck. Under a single-probe gate, a 2000-seed sweep found 39/1490 accepted
 * flat systems re-probing below the occupancy floor on a fresh stream —
 * every one an accepted-marginal system whose one generation-time probe had
 * caught a lucky draw (none were exhaustion fallbacks; the gate never
 * exhausted at all in that sweep). Each further probe — drawn from the
 * continued rng stream, which is statistically exactly the "fresh stream"
 * such a system fails on — must clear the same bar, turning the flaky-passer
 * class from a coin flip into a long shot raised to the probe count. Later
 * probes run only while every earlier one passed, so rejecting a bad
 * candidate stays as cheap as it always was.
 *
 * A rejected candidate is discarded and a fresh one rolled, for up to
 * `MAX_ATTEMPTS` candidates total. Always returns something — so the UI
 * never needs a failure path — and on exhaustion that is the BEST-scoring
 * candidate seen (each judged by its worst probe), not the arbitrary
 * last-rolled one (fr-b5x): the least-dusty near-miss beats whatever the
 * final roll happened to produce.
 *
 * Takes only an injected {@link Rng} and never touches `Math.random`, so a
 * fixed seed reproduces the exact same system, gate probes included.
 */
export function randomSystem(rng: Rng): RandomSystem {
  let candidate = randomCandidate(rng);
  let best = candidate;
  let bestScore = -Infinity;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) candidate = randomCandidate(rng);
    let score = scoreCandidate(candidate, rng);
    for (
      let probe = 1;
      probe < STABILITY_PROBES && score >= MIN_OCCUPIED_CELLS;
      probe++
    ) {
      // Stability gate (fr-b5x): the same bar, on further independent
      // probes. Folding each score in via min() also keeps the
      // best-candidate bookkeeping below judging by worst evidence seen.
      score = Math.min(score, scoreCandidate(candidate, rng));
    }
    if (score >= MIN_OCCUPIED_CELLS) return candidate;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}
