/**
 * Small perturbations of an existing IFS: the "mutation grid"
 * feature shows a handful of nudged variants of the system on screen next to
 * the original, Apophysis-mutation-window style, so a user can pick a
 * pleasing near neighbor instead of hand-tweaking sliders or rerolling a
 * whole new "Surprise Me" system from scratch. Where {@link randomSystem}
 * ("./random-system") draws a system from nothing, {@link mutateSystem}
 * nudges every numeric field of an EXISTING one by a small random amount —
 * small enough that a mutant reads as "the same system, nudged", not a
 * different attractor.
 *
 * Every jitter range is deliberately narrow (a few percent of the field's own
 * scale, or a few percent of radians) so the family resemblance survives the
 * nudge; every clamp mirrors the editor's own slider bounds (`ui.ts`'s
 * `CHANNELS`, `constants.ts`'s `MIN`/`MAX_GUIDE_SCALE`, `state.ts`'s
 * `MIN`/`MAX_W_*`) so a mutant can never land somewhere the manual editor
 * couldn't reach or express. A raw jitter can still land a dud (an
 * unlucky-signed nudge across several maps compounding into a thin or
 * escaping attractor), so candidates are quality-gated exactly like a fresh
 * roll: {@link scoreSystem} — the same probe machinery `randomSystem` uses —
 * judges a mutant against the identical "renders as a real shape" bar
 * ({@link MIN_OCCUPIED_CELLS}), on a few independent probes, before it's
 * handed back.
 */
import type { MorphSystem } from "./morph";
import { MIN_OCCUPIED_CELLS, scoreSystem } from "./random-system";
import type { Rng } from "./rng";
import { SURFACE_FINISH_SHININESS_FLOOR } from "./surface-finish";
import {
  SURFACE_PATTERN_SCALE_MAX,
  SURFACE_PATTERN_SCALE_MIN,
} from "./surface-pattern";
import { VARIATION_TYPES } from "./types";
import type {
  SurfaceFinish,
  SurfacePattern,
  SymmetryParams,
  Transform,
  Variation,
  Vec3,
  WExtension,
} from "./types";
import { CLASSIC_FOLD_RADII, isFoldVariationType } from "./variations";
import { clamp } from "./vec";

/**
 * One "wildcard" cell per mutation grid: every other cell is a
 * gentle nudge, but a grid of only-gentle nudges risks looking like the same
 * system eight times over at a glance. The wildcard cell widens every jitter
 * range ({@link WILDCARD_SPREAD}) AND adds one structural kick (a variation
 * swap, or — for a purely-affine map with nothing to swap — a full rotation
 * reroll) so at least one cell in the grid reads as a genuinely different
 * exploration direction, not just noise.
 */
export interface MutationOptions {
  /** One "wildcard" cell per grid: jitter scaled up plus one structural kick. */
  wildcard?: boolean;
}

const TWO_PI = Math.PI * 2;

/** Uniform draw in `[min, max)`, the same shape as `random-system.ts`'s
 * private helper of the same name — duplicated rather than imported since
 * that one isn't exported and this module stays a thin, self-contained
 * perturbation layer over `random-system.ts`'s public surface
 * ({@link scoreSystem}, {@link MIN_OCCUPIED_CELLS}). */
function uniform(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

/**
 * Additive jitter half-range for rotation (radians) and the w-mixing
 * rotation planes alike: `U(-0.12, 0.12)` reads as a gentle tilt — visible on
 * close inspection, never enough to make a map's orientation unrecognizable.
 */
const ROTATION_JITTER = 0.12;
/** Additive jitter half-range for position: `U(-0.08, 0.08)`, small next to
 * the maps' own `[-0.9, 0.9]` roll range ({@link randomSystem}'s
 * `POSITION_RANGE`) so a mutant's maps stay near where the original put them. */
const POSITION_JITTER = 0.08;
/** Position clamp, mirroring the editor's position slider range (`ui.ts`'s
 * `CHANNELS.position`, `±3`) — a mutant's position can drift no further than
 * the manual editor could ever push it. */
const POSITION_CLAMP = 3;

/** Multiplicative jitter half-range for scale: `U(0.92, 1.08)` (a factor of
 * `1 ± 0.08`), the same order as {@link randomSystem}'s own `SCALE_JITTER`. */
const SCALE_JITTER_HALF_RANGE = 0.08;
/** Scale magnitude clamp, mirroring `constants.ts`'s `MIN`/`MAX_GUIDE_SCALE`
 * (the guide-box drag clamp `interactions.ts` and the editor's Scale slider
 * both already honor) — a mutant's scale can't land outside what the app can
 * otherwise express or drag to. */
const SCALE_CLAMP_MIN = 0.05;
const SCALE_CLAMP_MAX = 2;

/** Multiplicative jitter half-range for selection weight: `U(0.75, 1.25)` —
 * wider than the geometric jitters, since weight only reshapes the pick
 * distribution and can't push the attractor itself out of shape. */
const WEIGHT_JITTER_HALF_RANGE = 0.25;
/** Defensive floor so a mutated weight is always strictly positive: the
 * jitter factor itself never goes non-positive for any spread this module
 * uses (see {@link WILDCARD_SPREAD}), so this floor is a backstop, not a
 * value any real roll should ever hit. */
const MIN_WEIGHT = 1e-6;

/** Additive jitter half-range for shear: `U(-0.05, 0.05)`, matched to
 * {@link randomSystem}'s own shear roll being the gentlest-textured field. */
const SHEAR_JITTER = 0.05;
/** Shear clamp, mirroring the editor's Shear slider range (`ui.ts`'s
 * `CHANNELS.shear`, `±2`). */
const SHEAR_CLAMP = 2;

/** Multiplicative jitter half-range for a variation's weight: `U(0.8, 1.2)`.
 * A variation's weight is a free strength (not normalized), so a wider band
 * than the affine fields still reads as "the same blend, a bit stronger or
 * weaker" rather than a different look. */
const VARIATION_WEIGHT_JITTER_HALF_RANGE = 0.2;
/** Variation weight MAGNITUDE clamp, mirroring the editor's variation-weight
 * slider span (`ui.ts`'s `VARIATION_WEIGHT_MIN`/`MAX` is `[-2, 2]`).
 * The clamp acts on `|weight|` with the sign restored afterwards: the `0.05`
 * floor (not `0`) keeps a mutation from silently deleting a variation the
 * base system deliberately carried, and restoring the sign keeps it from
 * flipping one into a different object entirely (a negative-scale mandelbox
 * is not a nudged positive one) — both would be structural changes, not
 * nudges. The floor also stays far above the surface/escape DEs' `1e-4`
 * near-zero-fold refusal band, on either sign. */
const VARIATION_WEIGHT_CLAMP_MIN = 0.05;
const VARIATION_WEIGHT_CLAMP_MAX = 2;

/** Additive jitter half-range for `w.position`: `U(-0.08, 0.08)`, the same
 * order as the 3D position jitter. */
const W_POSITION_JITTER = 0.08;
/** `w.position` clamp, mirroring `state.ts`'s `MIN`/`MAX_W_POSITION` (the
 * Position W slider's own range). */
const W_POSITION_CLAMP = 1.5;

/** Additive jitter half-range for each present w-mixing rotation plane:
 * `U(-0.12, 0.12)`, matching the 3D rotation jitter. */
const W_ROTATION_JITTER = 0.12;

/** Multiplicative jitter half-range for `w.scale`: `U(0.92, 1.08)`, matching
 * the 3D scale jitter. */
const W_SCALE_JITTER_HALF_RANGE = 0.08;
/**
 * `w.scale` magnitude clamp, mirroring `state.ts`'s `MIN`/`MAX_W_SCALE` — the
 * Scale W slider's own `[0.05, 1.5]` span. Deliberately NOT the plain 3D
 * scale's `2` ceiling: the two sliders are independently ranged in the
 * editor (`ui.ts`), and this module mirrors each field's own control rather
 * than reusing a neighboring one.
 */
const W_SCALE_CLAMP_MIN = 0.05;
const W_SCALE_CLAMP_MAX = 1.5;

/** Additive jitter half-range for each present w-mixing shear plane:
 * `U(-0.05, 0.05)`, matching the 3D shear jitter. */
const W_SHEAR_JITTER = 0.05;
/** `w.shear` clamp, mirroring `state.ts`'s `MIN`/`MAX_W_SHEAR` (`±2`). */
const W_SHEAR_CLAMP = 2;

/** Additive jitter half-range for `colorIndex`: `U(-0.05, 0.05)` —
 * matching {@link SHEAR_JITTER}'s magnitude, the closest precedent for a
 * bounded `[0, 1]` authoring value rather than a free strength: a gentle
 * nudge along the palette ramp, never enough to jump a map to a visibly
 * different slot. */
const COLOR_INDEX_JITTER = 0.05;
/** `colorIndex` clamp: the field's own authored span, `[0, 1]` (see
 * `Transform.colorIndex`, and `persist.ts`'s decoder, which clamps the same
 * way) — not a UI slider constant, since the field's meaning (a position on
 * the palette ramp) fixes its range directly. */
const COLOR_INDEX_CLAMP_MIN = 0;
const COLOR_INDEX_CLAMP_MAX = 1;

/** Additive jitter half-range for `colorSpeed`: `U(-0.05, 0.05)`, matching
 * {@link COLOR_INDEX_JITTER} — both are `[0, 1]`-authored blend
 * controls, not free strengths, so the same small additive nudge fits
 * either. */
const COLOR_SPEED_JITTER = 0.05;
/** `colorSpeed` clamp: the field's own authored span, `[0, 1]` (see
 * `Transform.colorSpeed`), mirroring {@link COLOR_INDEX_CLAMP_MIN}/`_MAX`. */
const COLOR_SPEED_CLAMP_MIN = 0;
const COLOR_SPEED_CLAMP_MAX = 1;

/**
 * Multiplicative jitter half-range for a chaos-row entry: `U(0.75, 1.25)`,
 * matching {@link WEIGHT_JITTER_HALF_RANGE} — a chi entry is a selection
 * strength, exactly what `weight` is, one graph edge at a time.
 * Multiplicative ON PURPOSE, with no `MIN_WEIGHT`-style floor: an exact 0
 * stays exactly 0 under any multiplier, so a block-diagonal matrix's
 * isolation survives every mutation — a grid must stay a grid of the system
 * you brought it, and an additive nudge (or a floor) would leak two
 * deliberately separated systems into each other behind the user's back.
 * The only clamp is the consumption domain's own `>= 0`
 * ({@link Math.max} at the jitter site); like `weight`, a chi entry has no
 * authored upper bound.
 */
const CHAOS_JITTER_HALF_RANGE = 0.25;

/**
 * Multiplicative jitter half-range for a fold length (`minRadius`/
 * `fixedRadius`): `U(0.92, 1.08)`, the same order as
 * {@link SCALE_JITTER_HALF_RANGE} — both are positive lengths on the map's
 * own rough scale, and a fold radius is exactly that: a length, not a free
 * strength.
 */
const FOLD_RADIUS_JITTER_HALF_RANGE = 0.08;
/**
 * `minRadius`/`fixedRadius` magnitude clamp: mirrors {@link SCALE_CLAMP_MIN}/
 * {@link SCALE_CLAMP_MAX}, the closest existing precedent for a positive
 * length field in this file — there is no editor slider for either yet to
 * mirror instead. `minRadius` is additionally capped at the resolved
 * `fixedRadius` by {@link jitterVariationEntry} itself, mirroring
 * `variations.ts`'s `resolveFoldRadii` domain rule that the mid shell can
 * never invert backwards.
 */
const FOLD_RADIUS_CLAMP_MIN = 0.05;
const FOLD_RADIUS_CLAMP_MAX = 2;

/**
 * Additive jitter half-range for `boxLimit`: `U(-0.08, 0.08)`, matching
 * {@link POSITION_JITTER}'s magnitude. Additive rather than multiplicative
 * (unlike the two radii above) so an author's deliberate `boxLimit: 0` — the
 * point-reflection fold `resolveFoldRadii` keeps rather than replacing —
 * can still move under a mutation instead of multiplying to a permanent 0.
 */
const BOX_LIMIT_JITTER = 0.08;

/**
 * Multiplicative jitter half-range for `finish.specular`: `U(0.92, 1.08)`,
 * the same order as {@link FOLD_RADIUS_JITTER_HALF_RANGE} — both are
 * positive magnitudes on the map's own rough scale with no sign to
 * preserve, better nudged proportionally than additively.
 */
const FINISH_SPECULAR_JITTER_HALF_RANGE = 0.08;
/**
 * `finish.specular` magnitude clamp: mirrors {@link FOLD_RADIUS_CLAMP_MIN}/
 * {@link FOLD_RADIUS_CLAMP_MAX} — there is no editor slider for `specular`
 * yet to mirror instead, the same placeholder precedent those two set for
 * the fold radii. Floored at 0 rather than a small positive value: a
 * vanished highlight is a legitimate authored look, not a domain edge case.
 */
const FINISH_SPECULAR_CLAMP_MIN = 0;
const FINISH_SPECULAR_CLAMP_MAX = 2;

/**
 * Multiplicative jitter half-range for `finish.shininess`: matches
 * {@link FINISH_SPECULAR_JITTER_HALF_RANGE} — a specular exponent is also a
 * positive magnitude, nudged the same proportional way.
 */
const FINISH_SHININESS_JITTER_HALF_RANGE = 0.08;
/**
 * `finish.shininess` clamp: floored at `surface-finish.ts`'s own
 * {@link SURFACE_FINISH_SHININESS_FLOOR} — imported rather than re-typed, so
 * a mutation can never push a shininess value outside what the resolver
 * itself would accept — and ceiled at 256, a conventional Blinn-Phong
 * exponent ceiling past which a tighter highlight reads no differently at
 * this app's viewing distances.
 */
const FINISH_SHININESS_CLAMP_MIN = SURFACE_FINISH_SHININESS_FLOOR;
const FINISH_SHININESS_CLAMP_MAX = 256;

/**
 * Additive jitter half-range for `finish.metalness`/`reflect`/`transmit`:
 * `U(-0.05, 0.05)`, matching {@link COLOR_INDEX_JITTER} — all three, like
 * `colorIndex`/`colorSpeed`, are `[0, 1]`-authored blend controls, not free
 * strengths, so the same gentle additive nudge fits.
 */
const FINISH_UNIT_JITTER = 0.05;
/** `finish.metalness`/`reflect`/`transmit` clamp: the fields' own authored
 * span, `[0, 1]` (see `types.ts`'s `SurfaceFinish`), mirroring
 * {@link COLOR_INDEX_CLAMP_MIN}/`_MAX`. */
const FINISH_UNIT_CLAMP_MIN = 0;
const FINISH_UNIT_CLAMP_MAX = 1;
const SURFACE_PATTERN_SCALE_JITTER_HALF_RANGE = 0.08;
const SURFACE_PATTERN_STRENGTH_JITTER = 0.05;

/**
 * How much wider every jitter half-range above gets on the grid's one
 * "wildcard" cell ({@link MutationOptions.wildcard}): `2.5x` reads as a
 * clearly bolder nudge without being so wide it swamps the gentler cells'
 * whole reason for existing (a range of "how different" across the grid).
 * Rotation/w-rotation still wrap through {@link wrapAngle} at the wider
 * range, so a widened rotation jitter never silently escapes `(-π, π]`.
 */
const WILDCARD_SPREAD = 2.5;

/** Non-`linear` variation types the wildcard structural kick can swap into
 * (see {@link applyStructuralKick}) — the same "real warp, not the affine
 * identity" set `random-system.ts`'s own `NON_LINEAR_VARIATION_TYPES` rolls
 * from, duplicated here for the same reason {@link uniform} is: this module
 * only reaches into `random-system.ts` through its public exports. */
const NON_LINEAR_VARIATION_TYPES = VARIATION_TYPES.filter(
  (type) => type !== "linear",
);

/**
 * Candidates tried before giving up and returning the best-scoring one seen
 * (mirrors {@link randomSystem}'s `MAX_ATTEMPTS`, just smaller): a mutation
 * starts from an already-plausible system, so it needs far fewer rerolls to
 * clear the gate than a from-scratch roll does.
 */
const MUTATION_MAX_ATTEMPTS = 8;
/** Consecutive independent probes a candidate must clear (mirrors
 * {@link randomSystem}'s `STABILITY_PROBES`, at a smaller count for the same
 * reason as {@link MUTATION_MAX_ATTEMPTS}: a mutant starts closer to a
 * healthy attractor than a blind roll does, so it needs less convincing). */
const MUTATION_STABILITY_PROBES = 2;

/** Wrap `angle` into `(-π, π]`, the same convention `ui.ts`'s `wrapDegrees`
 * uses in degrees: a mutated rotation component must stay a legal Euler
 * angle, never accumulate past a full turn. Single-pass, not a modulo loop:
 * every angle this module wraps starts inside `[-π, π]` (or, for the
 * wildcard reroll, `[-π, π)`) and is nudged by at most
 * `{@link ROTATION_JITTER} * {@link WILDCARD_SPREAD}`, so it can cross a
 * `±π` boundary at most once. */
function wrapAngle(angle: number): number {
  if (angle > Math.PI) return angle - TWO_PI;
  if (angle <= -Math.PI) return angle + TWO_PI;
  return angle;
}

/** Jitter one scale axis: multiply the MAGNITUDE by a `U(1 ± halfRange)`
 * factor, clamp the magnitude, then reapply the original sign — a negative
 * axis is a mirror (`random-system.ts`'s `randomReflection`), and a mutation
 * must never flip or erase that handedness. */
function jitterScaleAxis(
  rng: Rng,
  value: number,
  halfRange: number,
  spread: number,
): number {
  const magnitude = clamp(
    Math.abs(value) *
      uniform(rng, 1 - halfRange * spread, 1 + halfRange * spread),
    SCALE_CLAMP_MIN,
    SCALE_CLAMP_MAX,
  );
  return value < 0 ? -magnitude : magnitude;
}

/** {@link jitterScaleAxis}'s `w.scale` twin: same sign-preserving magnitude
 * jitter, clamped to the Scale W slider's own span instead. */
function jitterWScale(rng: Rng, value: number, spread: number): number {
  const magnitude = clamp(
    Math.abs(value) *
      uniform(
        rng,
        1 - W_SCALE_JITTER_HALF_RANGE * spread,
        1 + W_SCALE_JITTER_HALF_RANGE * spread,
      ),
    W_SCALE_CLAMP_MIN,
    W_SCALE_CLAMP_MAX,
  );
  return value < 0 ? -magnitude : magnitude;
}

/** Jitter a variation's weight: multiply the MAGNITUDE by a `U(1 ± halfRange)`
 * factor, clamp the magnitude to `[{@link VARIATION_WEIGHT_CLAMP_MIN},
 * {@link VARIATION_WEIGHT_CLAMP_MAX}]`, then reapply the original sign —
 * {@link jitterWScale}'s sign-preserving shape, one module up: a mutation
 * nudges how strongly a variation acts, never which side of zero it acts
 * from. For `weight >= 0` this is bit-identical to the old
 * plain-clamp behavior, so every positive-weight mutation stream is
 * unchanged. Exactly one {@link uniform} draw per call, as before, so the
 * fixed-seed golden-snapshot test's rng-draw count doesn't shift. */
function jitterVariationWeight(
  rng: Rng,
  weight: number,
  spread: number,
): number {
  const magnitude = clamp(
    Math.abs(weight) *
      uniform(
        rng,
        1 - VARIATION_WEIGHT_JITTER_HALF_RANGE * spread,
        1 + VARIATION_WEIGHT_JITTER_HALF_RANGE * spread,
      ),
    VARIATION_WEIGHT_CLAMP_MIN,
    VARIATION_WEIGHT_CLAMP_MAX,
  );
  return weight < 0 ? -magnitude : magnitude;
}

/** Multiplicative jitter for a fold radius (`minRadius`/`fixedRadius`):
 * magnitude only, no sign game like {@link jitterScaleAxis} needs — a fold
 * radius is always positive — clamped into [{@link FOLD_RADIUS_CLAMP_MIN},
 * {@link FOLD_RADIUS_CLAMP_MAX}]. */
function jitterFoldRadius(rng: Rng, value: number, spread: number): number {
  return clamp(
    value *
      uniform(
        rng,
        1 - FOLD_RADIUS_JITTER_HALF_RANGE * spread,
        1 + FOLD_RADIUS_JITTER_HALF_RANGE * spread,
      ),
    FOLD_RADIUS_CLAMP_MIN,
    FOLD_RADIUS_CLAMP_MAX,
  );
}

/** Additive jitter for `boxLimit`, floored at exactly 0 — never {@link
 * FOLD_RADIUS_CLAMP_MIN}, see {@link BOX_LIMIT_JITTER} — and ceiled at
 * {@link FOLD_RADIUS_CLAMP_MAX} for the same repeated-re-mutation reason
 * every other field in this file has an upper bound. */
function jitterBoxLimit(rng: Rng, value: number, spread: number): number {
  return clamp(
    value + uniform(rng, -BOX_LIMIT_JITTER * spread, BOX_LIMIT_JITTER * spread),
    0,
    FOLD_RADIUS_CLAMP_MAX,
  );
}

/**
 * Jitter one variation entry: `weight` always moves (unchanged
 * rule), and — for the fold family only (`boxfold`/`spherefold`/
 * `mandelbox`, see `variations.ts`'s `isFoldVariationType`) — each of
 * `minRadius`/`fixedRadius`/`boxLimit` that is already PRESENT on `v` is
 * nudged and clamped (see {@link jitterFoldRadius}/{@link jitterBoxLimit}).
 * An absent length ALWAYS stays absent — a mutation never materializes one,
 * `wildcard` included.
 *
 * That is narrower than "a mutation nudges what the author has" would
 * otherwise suggest, and deliberately so. The rule first shipped as the
 * mitigation for a CPU/GPU divergence: every shader mirror was still frozen
 * at the classic 0.5 / 1 / 1, so a document carrying non-classic radii
 * rendered one object on the CPU estimators and a DIFFERENT one on every GPU
 * path, and no in-app producer was allowed to create such a document. That
 * divergence is CLOSED — `surface-material.ts`, `surface-de-gpu.ts` and both
 * flame kernels all read the authored lengths now, and
 * `surface-material-4d.ts` needed nothing, carrying no fold GLSL at all. The
 * rule stays anyway, now by CHOICE: a mutation grid must stay a grid of the
 * system you brought it, so a cell may perturb a length the author already
 * carries but must never invent shape parameters the base system never had.
 * Perturbing a length that is already present is fine: that document is
 * already in that state, and silently resetting an authored field would be
 * worse.
 *
 * `minRadius` is additionally capped at the resolved `fixedRadius` —
 * whether that came from this same call or, when `fixedRadius` is absent
 * (and so stays absent), the classic 1 — mirroring `resolveFoldRadii`'s own
 * domain rule that the mid shell can never invert backwards.
 *
 * The entry is COPIED rather than rebuilt from `type` and `weight`, so a
 * field this function has no rule for rides through untouched instead of
 * vanishing — the same shape `persist.ts` and `morph.ts` carry, and the
 * variation-level reading of this file's own "no key is ever invented or
 * dropped" promise. Today that only matters for a hand-authored fold length
 * on a NON-fold type, where the three fields are inert; it matters more the
 * next time `Variation` grows a field, because an explicit rebuild fails
 * CLOSED and drops it silently.
 */
function jitterVariationEntry(
  rng: Rng,
  v: Variation,
  spread: number,
): Variation {
  const result: Variation = {
    ...v,
    weight: jitterVariationWeight(rng, v.weight, spread),
  };
  if (!isFoldVariationType(v.type)) return result;

  let fixedRadius: number | undefined;
  if (v.fixedRadius !== undefined) {
    fixedRadius = jitterFoldRadius(rng, v.fixedRadius, spread);
    result.fixedRadius = fixedRadius;
  }

  if (v.minRadius !== undefined) {
    const ceiling = fixedRadius ?? CLASSIC_FOLD_RADII.fixedRadius;
    result.minRadius = Math.min(
      jitterFoldRadius(rng, v.minRadius, spread),
      ceiling,
    );
  }

  if (v.boxLimit !== undefined) {
    result.boxLimit = jitterBoxLimit(rng, v.boxLimit, spread);
  }

  return result;
}

/** Jitter a present `w.rotation`/`w.shear` sub-object: only the fields
 * actually present on `base` are touched, so a one-plane block stays
 * one-plane. `jitter` supplies the per-component rule — rotation's
 * wrap-through-π behavior ({@link jitterWRotationComponent}) vs. shear's
 * plain symmetric clamp ({@link jitterWShearComponent}). */
function jitterWPlanes(
  rng: Rng,
  base: { xw?: number; yw?: number; zw?: number },
  spread: number,
  jitter: (rng: Rng, value: number, spread: number) => number,
): { xw?: number; yw?: number; zw?: number } {
  const result: { xw?: number; yw?: number; zw?: number } = {};
  if (base.xw !== undefined) result.xw = jitter(rng, base.xw, spread);
  if (base.yw !== undefined) result.yw = jitter(rng, base.yw, spread);
  if (base.zw !== undefined) result.zw = jitter(rng, base.zw, spread);
  return result;
}

function jitterWRotationComponent(
  rng: Rng,
  value: number,
  spread: number,
): number {
  return wrapAngle(
    value +
      uniform(rng, -W_ROTATION_JITTER * spread, W_ROTATION_JITTER * spread),
  );
}

function jitterWShearComponent(
  rng: Rng,
  value: number,
  spread: number,
): number {
  return clamp(
    value + uniform(rng, -W_SHEAR_JITTER * spread, W_SHEAR_JITTER * spread),
    -W_SHEAR_CLAMP,
    W_SHEAR_CLAMP,
  );
}

/** Jitter a present `w` extension: only its present subfields move (absent
 * stays absent — a flat map's `w` stays absent entirely, see
 * {@link jitterTransform}), each per the field-specific rules documented on
 * this module's `W_*` constants. */
function jitterW(rng: Rng, base: WExtension, spread: number): WExtension {
  const w: WExtension = {};
  if (base.position !== undefined) {
    w.position = clamp(
      base.position +
        uniform(rng, -W_POSITION_JITTER * spread, W_POSITION_JITTER * spread),
      -W_POSITION_CLAMP,
      W_POSITION_CLAMP,
    );
  }
  if (base.rotation) {
    w.rotation = jitterWPlanes(
      rng,
      base.rotation,
      spread,
      jitterWRotationComponent,
    );
  }
  if (base.scale !== undefined) {
    w.scale = jitterWScale(rng, base.scale, spread);
  }
  if (base.shear) {
    w.shear = jitterWPlanes(rng, base.shear, spread, jitterWShearComponent);
  }
  return w;
}

/** Jitter a present `finish.specular`: multiplicative like a fold radius
 * ({@link jitterFoldRadius}) — a positive magnitude, no sign game needed —
 * clamped into [{@link FINISH_SPECULAR_CLAMP_MIN},
 * {@link FINISH_SPECULAR_CLAMP_MAX}]. */
function jitterFinishSpecular(rng: Rng, value: number, spread: number): number {
  return clamp(
    value *
      uniform(
        rng,
        1 - FINISH_SPECULAR_JITTER_HALF_RANGE * spread,
        1 + FINISH_SPECULAR_JITTER_HALF_RANGE * spread,
      ),
    FINISH_SPECULAR_CLAMP_MIN,
    FINISH_SPECULAR_CLAMP_MAX,
  );
}

/** Jitter a present `finish.shininess`: the identical multiplicative shape
 * as {@link jitterFinishSpecular}, clamped into
 * [{@link FINISH_SHININESS_CLAMP_MIN}, {@link FINISH_SHININESS_CLAMP_MAX}]. */
function jitterFinishShininess(
  rng: Rng,
  value: number,
  spread: number,
): number {
  return clamp(
    value *
      uniform(
        rng,
        1 - FINISH_SHININESS_JITTER_HALF_RANGE * spread,
        1 + FINISH_SHININESS_JITTER_HALF_RANGE * spread,
      ),
    FINISH_SHININESS_CLAMP_MIN,
    FINISH_SHININESS_CLAMP_MAX,
  );
}

/** Jitter a present `finish.metalness`/`reflect`/`transmit`: additive,
 * matching {@link jitterWShearComponent}'s shape — a `[0, 1]`-authored blend
 * control, not a free strength (the same reasoning
 * {@link COLOR_INDEX_JITTER} documents). */
function jitterFinishUnit(rng: Rng, value: number, spread: number): number {
  return clamp(
    value +
      uniform(rng, -FINISH_UNIT_JITTER * spread, FINISH_UNIT_JITTER * spread),
    FINISH_UNIT_CLAMP_MIN,
    FINISH_UNIT_CLAMP_MAX,
  );
}

/** Jitter a present `finish`: only its present fields move (absent stays
 * absent — a finish with only `metalness` authored stays a metalness-only
 * object, never gains the other four), each per the field-specific rules
 * documented on this module's `FINISH_*` constants above. Mirrors
 * {@link jitterW}'s "only present subfields move" shape, one field family
 * over, on {@link jitterVariationEntry}'s COPY-rather-than-rebuild
 * discipline: `finish` is spread first so a future lighting field this
 * function has no rule for rides through untouched instead of silently
 * vanishing. Patterned albedo remains the separate `surfacePattern` sibling. */
function jitterFinish(
  rng: Rng,
  base: SurfaceFinish,
  spread: number,
): SurfaceFinish {
  const finish: SurfaceFinish = { ...base };
  if (base.specular !== undefined) {
    finish.specular = jitterFinishSpecular(rng, base.specular, spread);
  }
  if (base.shininess !== undefined) {
    finish.shininess = jitterFinishShininess(rng, base.shininess, spread);
  }
  if (base.metalness !== undefined) {
    finish.metalness = jitterFinishUnit(rng, base.metalness, spread);
  }
  if (base.reflect !== undefined) {
    finish.reflect = jitterFinishUnit(rng, base.reflect, spread);
  }
  if (base.transmit !== undefined) {
    finish.transmit = jitterFinishUnit(rng, base.transmit, spread);
  }
  if (base.reflectionTint !== undefined) {
    finish.reflectionTint = jitterFinishUnit(rng, base.reflectionTint, spread);
  }
  return finish;
}

/** Copy a present pattern and perturb only authored numeric leaves. */
function jitterSurfacePattern(
  rng: Rng,
  base: SurfacePattern,
  spread: number,
): SurfacePattern {
  const pattern: SurfacePattern = { ...base };
  if (base.scale !== undefined) {
    pattern.scale = clamp(
      base.scale *
        uniform(
          rng,
          1 - SURFACE_PATTERN_SCALE_JITTER_HALF_RANGE * spread,
          1 + SURFACE_PATTERN_SCALE_JITTER_HALF_RANGE * spread,
        ),
      SURFACE_PATTERN_SCALE_MIN,
      SURFACE_PATTERN_SCALE_MAX,
    );
  }
  if (base.strength !== undefined) {
    pattern.strength = clamp(
      base.strength +
        uniform(
          rng,
          -SURFACE_PATTERN_STRENGTH_JITTER * spread,
          SURFACE_PATTERN_STRENGTH_JITTER * spread,
        ),
      0,
      1,
    );
  }
  return pattern;
}

/**
 * Jitter one base map: every field nudged per this module's documented
 * ranges, scaled by `spread` (`1` for a plain cell, {@link WILDCARD_SPREAD}
 * for the wildcard cell). `id` is preserved (never reassigned — the map
 * identity a mutation grid cell shows must trace back to the base system's
 * own map), and every optional field (`shear`/`variations`/`w`/`colorIndex`/
 * `colorSpeed`/`finish`/`surfacePattern`/`chaos`) stays exactly as present or absent as it is on
 * `base` — no key is ever invented or dropped, fold-family lengths included:
 * see {@link jitterVariationEntry} for why a mutation may perturb a present
 * `minRadius`/`fixedRadius`/`boxLimit` but never materializes an absent one,
 * {@link jitterFinish} for the identical rule applied field-by-field to
 * `finish`, and {@link jitterSurfacePattern} for the separate albedo sibling.
 */
function jitterTransform(rng: Rng, base: Transform, spread: number): Transform {
  const rotation: Vec3 = [
    wrapAngle(
      base.rotation[0] +
        uniform(rng, -ROTATION_JITTER * spread, ROTATION_JITTER * spread),
    ),
    wrapAngle(
      base.rotation[1] +
        uniform(rng, -ROTATION_JITTER * spread, ROTATION_JITTER * spread),
    ),
    wrapAngle(
      base.rotation[2] +
        uniform(rng, -ROTATION_JITTER * spread, ROTATION_JITTER * spread),
    ),
  ];
  const position: Vec3 = [
    clamp(
      base.position[0] +
        uniform(rng, -POSITION_JITTER * spread, POSITION_JITTER * spread),
      -POSITION_CLAMP,
      POSITION_CLAMP,
    ),
    clamp(
      base.position[1] +
        uniform(rng, -POSITION_JITTER * spread, POSITION_JITTER * spread),
      -POSITION_CLAMP,
      POSITION_CLAMP,
    ),
    clamp(
      base.position[2] +
        uniform(rng, -POSITION_JITTER * spread, POSITION_JITTER * spread),
      -POSITION_CLAMP,
      POSITION_CLAMP,
    ),
  ];
  const scale: Vec3 = [
    jitterScaleAxis(rng, base.scale[0], SCALE_JITTER_HALF_RANGE, spread),
    jitterScaleAxis(rng, base.scale[1], SCALE_JITTER_HALF_RANGE, spread),
    jitterScaleAxis(rng, base.scale[2], SCALE_JITTER_HALF_RANGE, spread),
  ];
  const weight = Math.max(
    MIN_WEIGHT,
    (base.weight ?? 1) *
      uniform(
        rng,
        1 - WEIGHT_JITTER_HALF_RANGE * spread,
        1 + WEIGHT_JITTER_HALF_RANGE * spread,
      ),
  );

  const result: Transform = { id: base.id, position, rotation, scale, weight };

  if (base.shear) {
    result.shear = [
      clamp(
        base.shear[0] +
          uniform(rng, -SHEAR_JITTER * spread, SHEAR_JITTER * spread),
        -SHEAR_CLAMP,
        SHEAR_CLAMP,
      ),
      clamp(
        base.shear[1] +
          uniform(rng, -SHEAR_JITTER * spread, SHEAR_JITTER * spread),
        -SHEAR_CLAMP,
        SHEAR_CLAMP,
      ),
      clamp(
        base.shear[2] +
          uniform(rng, -SHEAR_JITTER * spread, SHEAR_JITTER * spread),
        -SHEAR_CLAMP,
        SHEAR_CLAMP,
      ),
    ];
  }

  if (base.variations) {
    result.variations = base.variations.map((v) =>
      jitterVariationEntry(rng, v, spread),
    );
  }

  if (base.w) {
    result.w = jitterW(rng, base.w, spread);
  }

  // Placed AFTER every jitter above so a base map carrying neither field
  // draws the exact same RNG sequence as it did before these fields
  // existed — every existing mutation-grid output stays byte-identical.
  if (base.colorIndex !== undefined) {
    result.colorIndex = clamp(
      base.colorIndex +
        uniform(rng, -COLOR_INDEX_JITTER * spread, COLOR_INDEX_JITTER * spread),
      COLOR_INDEX_CLAMP_MIN,
      COLOR_INDEX_CLAMP_MAX,
    );
  }

  if (base.colorSpeed !== undefined) {
    result.colorSpeed = clamp(
      base.colorSpeed +
        uniform(rng, -COLOR_SPEED_JITTER * spread, COLOR_SPEED_JITTER * spread),
      COLOR_SPEED_CLAMP_MIN,
      COLOR_SPEED_CLAMP_MAX,
    );
  }

  // finish placed last for the identical reason colorIndex/colorSpeed sit
  // above shear/variations/w: an existing base map without a `finish` draws
  // no extra RNG here, so every RNG sequence recorded before this field
  // existed stays exactly as it was.
  if (base.finish) {
    result.finish = jitterFinish(rng, base.finish, spread);
  }

  // Pattern comes last and consumes no draws when absent, preserving every
  // pre-pattern fixed-seed mutation exactly.
  if (base.surfacePattern) {
    result.surfacePattern = jitterSurfacePattern(
      rng,
      base.surfacePattern,
      spread,
    );
  }

  // Chaos rows: a PRESENT row is perturbed entrywise (multiplicative, so an
  // exact 0 — a block boundary — stays exactly 0; see
  // CHAOS_JITTER_HALF_RANGE), an absent one is NEVER materialized —
  // the fold lengths' rule applied to selection, and the wildcard's
  // structural kick never invents chi either (it only swaps variation
  // types). Placed after every field above for the same
  // draws-when-present-only sequencing reason as finish/pattern.
  if (base.chaos) {
    result.chaos = base.chaos.map((entry) =>
      Math.max(
        0,
        entry *
          uniform(
            rng,
            1 - CHAOS_JITTER_HALF_RANGE * spread,
            1 + CHAOS_JITTER_HALF_RANGE * spread,
          ),
      ),
    );
  }

  // The emitter spec rides through UNTOUCHED, by reference: a mutation
  // perturbs the transform's OWN TRS — which IS the shape's pose — and
  // never the shape's internal parameters (the shape is the artwork's
  // fixed vocabulary, not a knob field; first-cut stance from the bead
  // that shipped it). Consumes no draws whether present or absent, so
  // every pre-emitter fixed-seed mutation stays byte-identical, and an
  // absent emitter is never materialized (the wildcard's structural kick
  // doesn't invent one either — it only swaps variation types).
  if (base.emitter) {
    result.emitter = base.emitter;
  }

  return result;
}

/**
 * The wildcard cell's structural kick (see {@link MutationOptions.wildcard}
 * and {@link WILDCARD_SPREAD}), applied to one uniformly-chosen map ON TOP
 * OF its already-widened field jitter:
 *
 * - if `baseMap` carries at least one non-`linear` variation, one
 *   uniformly-chosen non-linear entry's `type` is replaced by a type drawn
 *   uniformly from {@link NON_LINEAR_VARIATION_TYPES} minus every type the
 *   map ALREADY carries — its (already-jittered) weight is left alone, so
 *   only the warp changes, not its strength. The exclusion covers the
 *   entry's own current type and its siblings' alike: a blend is a
 *   type -> weight map (see `types.ts`'s `Variation`), so landing on a
 *   sibling's type would merge the two into one warp at the summed weight —
 *   a structural kick that changed nothing structural. The swapped entry
 *   also starts with none of the fold family's `minRadius`/`fixedRadius`/
 *   `boxLimit`, even if the old type had one jittered — a
 *   genuinely different warp carries none of the old one's shape
 *   parameters, exactly as picking a fresh type in the editor would (and
 *   {@link jitterVariationEntry} never materializes one here either, so a
 *   swap can't introduce a fold length the old type lacked);
 * - otherwise (a purely affine map, one with only a `linear` entry, or the
 *   degenerate map already carrying every non-linear warp — no unused type
 *   to swap TO) the map's rotation is rerolled ENTIRELY, uniform `±π` per
 *   axis — a bolder structural change than any additive jitter could read
 *   as, standing in for the variation swap this map has no variation to
 *   receive.
 *
 * Decided from `baseMap` (not the already-jittered `jitteredMap`) so the
 * branch taken reflects the base system's own structure, not an artifact of
 * this same kick.
 */
function applyStructuralKick(
  rng: Rng,
  baseMap: Transform,
  jitteredMap: Transform,
): Transform {
  const nonLinearIndices = (baseMap.variations ?? []).flatMap((v, i) =>
    v.type !== "linear" ? [i] : [],
  );
  if (nonLinearIndices.length > 0) {
    const pick = nonLinearIndices[Math.floor(rng() * nonLinearIndices.length)];
    const carried = new Set(baseMap.variations!.map((v) => v.type));
    const candidates = NON_LINEAR_VARIATION_TYPES.filter(
      (type) => !carried.has(type),
    );
    if (candidates.length > 0) {
      const newType = candidates[Math.floor(rng() * candidates.length)];
      const variations = jitteredMap.variations!.map((v, i) =>
        i === pick ? { type: newType, weight: v.weight } : v,
      );
      return { ...jitteredMap, variations };
    }
  }
  const rotation: Vec3 = [
    uniform(rng, -Math.PI, Math.PI),
    uniform(rng, -Math.PI, Math.PI),
    uniform(rng, -Math.PI, Math.PI),
  ];
  return { ...jitteredMap, rotation };
}

/** Jitter the optional final-transform lens: ONLY its variation weights and —
 * for a fold-family variation, its PRESENT fold lengths only, never a
 * materialized absent one — move (via {@link jitterVariationEntry}, the same
 * rule a base map's variations follow); its affine fields
 * (position/rotation/scale/shear), `id`, `colorIndex`/`colorSpeed`
 * (inert on a lens the chaos game never picks, see `morph.ts`'s
 * `lerpFinalTransform`), and `finish` all ride by reference, untouched — the
 * lens's warp can strengthen, weaken, or (for `boxfold`, the one fold type
 * the roll ever gives a lens — see `random-system.ts`'s
 * `FINAL_VARIATION_TYPES`) reshape an authored length, but a mutation never
 * relocates, resizes, recolors, or reshades it, and never gives it a fold
 * length it didn't already have. Absent `variations` stays absent. */
function jitterFinalTransform(
  rng: Rng,
  base: Transform,
  spread: number,
): Transform {
  const result: Transform = { ...base };
  if (base.surfacePattern) result.surfacePattern = { ...base.surfacePattern };
  if (base.variations) {
    result.variations = base.variations.map((v) =>
      jitterVariationEntry(rng, v, spread),
    );
  }
  return result;
}

/** Build one mutation candidate: every base map jittered ({@link
 * jitterTransform}), the wildcard cell's one structural kick applied on top
 * (see {@link applyStructuralKick}), the final-transform lens's variation
 * weights nudged (see {@link jitterFinalTransform}), and `symmetry` copied
 * through untouched (its order/axis are discrete design choices, not a
 * continuous field to jitter). */
function buildMutant(
  base: MorphSystem,
  rng: Rng,
  wildcard: boolean,
): MorphSystem {
  const spread = wildcard ? WILDCARD_SPREAD : 1;
  const transforms = base.transforms.map((t) =>
    jitterTransform(rng, t, spread),
  );
  if (wildcard) {
    const index = Math.floor(rng() * transforms.length);
    transforms[index] = applyStructuralKick(
      rng,
      base.transforms[index],
      transforms[index],
    );
  }
  const finalTransform = base.finalTransform
    ? jitterFinalTransform(rng, base.finalTransform, spread)
    : null;
  const symmetry: SymmetryParams = { ...base.symmetry };
  return { transforms, finalTransform, symmetry };
}

/**
 * Perturb `base` into a small variant: a mutation-grid cell. Every
 * numeric field of every base map is nudged by a small random amount (see
 * this module's `*_JITTER`/`*_CLAMP` constants for the exact range and clamp
 * per field — each clamp mirrors an editor slider's own bound, so a mutant
 * never lands outside what the manual editor could express). Maps are never
 * added or removed, and each keeps its base `id`; every optional field
 * (`shear`/`variations`/`w`, each of `w`'s own subfields, `colorIndex`/
 * `colorSpeed`, and `finish`, each of `finish`'s own subfields) stays
 * exactly as present or absent as it is on `base`, so a flat base system
 * stays flat, a purely-affine map stays purely affine, and an unshaded map
 * stays unshaded. A fold-family variation's `minRadius`/`fixedRadius`/
 * `boxLimit`, and a present `finish`'s own present fields, follow that same
 * rule strictly — perturbed when present, but NEVER materialized when
 * absent, `wildcard` included (see {@link jitterVariationEntry} and
 * {@link jitterFinish} for why: a mutation grid stays a grid of the system
 * you brought it). `symmetry` passes through unchanged, and the
 * final-transform lens
 * (if any) has its variations nudged the same way (its own `colorIndex`/
 * `colorSpeed`/`finish`, like its affine fields, ride by reference — see
 * {@link jitterFinalTransform}).
 *
 * `options.wildcard` widens every jitter range ({@link WILDCARD_SPREAD}) and
 * adds one structural kick on a single uniformly-chosen map (see
 * {@link applyStructuralKick}) — the grid's one cell that reads as a bolder
 * exploration rather than a gentle nudge.
 *
 * Like {@link randomSystem}, a raw jitter can land a dud (an unlucky
 * combination of per-map nudges thinning the attractor or pushing it toward
 * the escape wall), so candidates are quality-gated: up to
 * {@link MUTATION_MAX_ATTEMPTS} candidates are tried, each judged by
 * {@link scoreSystem} — the exact probe `randomSystem` itself uses — over
 * {@link MUTATION_STABILITY_PROBES} consecutive independent probes, folding
 * each score in via `Math.min` so the bookkeeping judges a candidate by its
 * worst evidence, not its luckiest. On exhaustion the best-scoring candidate
 * seen is returned — never `base` itself, and never a throw.
 *
 * Only ever draws from the injected {@link Rng}, so a fixed seed reproduces
 * the exact same mutant, gate probes included.
 */
export function mutateSystem(
  base: MorphSystem,
  rng: Rng,
  options?: MutationOptions,
): MorphSystem {
  const wildcard = options?.wildcard ?? false;
  let candidate = buildMutant(base, rng, wildcard);
  let best = candidate;
  let bestScore = -Infinity;
  for (let attempt = 0; attempt < MUTATION_MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) candidate = buildMutant(base, rng, wildcard);
    let score = scoreSystem(candidate, rng);
    for (
      let probe = 1;
      probe < MUTATION_STABILITY_PROBES && score >= MIN_OCCUPIED_CELLS;
      probe++
    ) {
      // Stability gate, mirroring randomSystem's: folding each score in via
      // min() keeps the best-candidate bookkeeping judging by worst evidence
      // seen.
      score = Math.min(score, scoreSystem(candidate, rng));
    }
    if (score >= MIN_OCCUPIED_CELLS) return candidate;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}
