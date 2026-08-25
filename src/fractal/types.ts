import type { ShapeSpec } from "./shapes";
import type { SurfacePattern } from "./surface-pattern";
export type {
  SurfacePattern,
  SurfacePatternAxis,
  SurfacePatternKind,
} from "./surface-pattern";

/** A 3-component vector: `[x, y, z]`. */
export type Vec3 = [number, number, number];

/** A 4-component vector: `[x, y, z, w]` (the 4D spike — see `affine4.ts`). */
export type Vec4 = [number, number, number, number];

/**
 * The nonlinear variation functions, in UI order. Borrowed from the fractal
 * flame algorithm: each warps space in a distinctive way *after* a transform's
 * affine part, turning the strictly self-similar IFS into flowing, organic
 * shapes. `linear` is the identity (the plain affine result), included so it can
 * be blended in alongside the others.
 *
 * This array is the single source of truth for both the {@link VariationType}
 * type and the persistence validator (`VALID_VARIATION_TYPES` in `persist.ts`)
 * *and* the function registry (`VARIATIONS` in `variations.ts`, a
 * `Record<VariationType, …>` so every name here must have an implementation), so
 * adding a variation is one edit and none of those can silently drift apart.
 */
export const VARIATION_TYPES = [
  "linear",
  "sinusoidal",
  "spherical",
  "swirl",
  "horseshoe",
  "polar",
  "handkerchief",
  "heart",
  "disc",
  "spiral",
  "bubble",
  "julia",
  // The Mandelbox fold family — append-only from here: the GPU kernels'
  // numeric ids (`KERNEL_VARIATION_INDEX` in `flame-gpu.ts`) follow this
  // order, so new types go at the END and existing entries never move.
  "boxfold",
  "spherefold",
  "mandelbox",
  // The quaternion square: `x` is the REAL part and `(y, z, w)` the
  // imaginary basis `(i, j, k)`, which is what makes the w = 0 restriction
  // bit-exact — `span{1, i, j}` is closed under squaring, so the 3D and 4D
  // registries agree at `w = 0` like every other entry. Authored with a
  // transform's translation as the Julia constant `c`, this is the map
  // `qjulia-de.ts`'s oracle estimates. NOTHING MARCHES IT ALONE: a renderer
  // of its own was refused by measurement, so authoring a `qsquare` map and
  // pressing Surface is refused — and that refusal at least NAMES the map,
  // appending a clause to the ordinary "uses variations" reason. What DOES
  // reach it is the escape-time CHAIN, where the map is a LINK rather than
  // an object of its own (`escape-de.ts`'s `ESCAPE_LINK_QSQUARE`). It
  // renders as a plain nonlinear warp in every other mode.
  "qsquare",
  // The White/Nylander triplex 8th power: the Mandelbulb's map,
  // `(r, θ, φ) ↦ (r⁸, 8θ, 8φ)` in spherical coordinates about the z axis
  // (`variations.ts`'s `triplexPow8`). Parameter-free on purpose — the power
  // is fixed at the iconic 8 and is NOT a document field, so this stays one
  // vocabulary entry rather than a knob every renderer, morph and persisted
  // scene would have to carry. Unlike `qsquare` it has NO 4D structure to
  // lift (triplex numbers are not an algebra), so the 4D twin warps `x, y, z`
  // and carries `w` through, exactly as the angular warps do. Iterated with
  // the query point re-added each step, its escape-time set is the Mandelbulb
  // (`bulb-de.ts`).
  "bulb",
] as const;

/** One nonlinear warp a transform can apply after its affine part. */
export type VariationType = (typeof VARIATION_TYPES)[number];

/**
 * A single weighted variation. A transform's post-affine point is the weighted
 * sum `Σ weight · V(type)` over its variations (flame-style blending), so a map
 * can mix, say, mostly `spherical` with a little `swirl`. Weight 0 disables the
 * variation; the weights are *not* normalised — they are free strengths.
 *
 * A list carries AT MOST ONE ENTRY PER TYPE — every producer treats it as a
 * type -> weight map: the editor's add-dropdown hides types the transform
 * already carries, `random-system.ts`/`mutate-system.ts` never roll or swap
 * onto a type already there, `flame-file.ts` reads one weight per (unique)
 * XML attribute name, `morph.ts` folds a union by type, and `persist.ts`
 * caps untrusted input at {@link VARIATION_TYPES}`.length`. That
 * makes the type vocabulary itself the bound on a blend's length, which is
 * what lets the GPU flame kernels give a Slot a fixed count of variation
 * lanes (`flame-gpu.ts`'s `MAX_SLOT_VARIATIONS`). Readers don't
 * depend on it — a repeated type simply adds, both on the CPU
 * (`composeVariations`) and in the kernels — so it is a budget convention,
 * not a parsing rule.
 *
 * THE FOLD RADII ARE THE FIRST PER-VARIATION PARAMETERS, and they
 * deliberately break the type -> weight mental model above rather than
 * pretending to fit it: `boxLimit` belongs to `boxfold` and `mandelbox`,
 * `minRadius`/`fixedRadius` to `spherefold` and `mandelbox`, and every other
 * type ignores all three. ABSENT MEANS THE CLASSIC MANDELBOX VALUES
 * (`variations.ts`'s `SPHERE_FOLD_MIN_RADIUS` 0.5, `SPHERE_FOLD_FIXED_RADIUS`
 * 1, `BOX_FOLD_LIMIT` 1) and renders BYTE-IDENTICALLY to a document that
 * predates them — the same convention `weight` and `colorIndex` follow, and
 * the thing that keeps every existing document, preset, morph and `.flame`
 * import unmoved. `variations.ts`'s {@link resolveFoldRadii} is the one place
 * that rule is written down; nothing else may re-derive it.
 *
 * WHY THERE ARE THREE AND NOT FOUR. The fold has exactly three lengths, and
 * only TWO dimensionless ratios of them are new shape: uniform pre-scale
 * is equivariant through both folds, so scaling all three together is what
 * the transform's own affine part already does. The two that survive
 * are the magnification `fixedRadius²/minRadius²` and the ball-vs-box ratio
 * `fixedRadius/boxLimit`. There is no size field, because size is not a
 * parameter.
 */
export interface Variation {
  type: VariationType;
  weight: number;
  /**
   * The sphere fold's minimum radius `mR` — inside it the fold inflates by
   * the magnification `fixedRadius²/minRadius²`. Absent ⇒ 0.5.
   * `spherefold`/`mandelbox` only.
   */
  minRadius?: number;
  /**
   * The sphere fold's fixed radius `fR` — at and beyond it the fold is the
   * identity, and between the two radii it inverts. Absent ⇒ 1.
   * `spherefold`/`mandelbox` only.
   */
  fixedRadius?: number;
  /**
   * The box fold's reflection plane: each axis mirrors off `|t| = boxLimit`.
   * Absent ⇒ 1. `boxfold`/`mandelbox` only.
   */
  boxLimit?: number;
}

/**
 * Optional per-transform surface FINISH: how this map's part of the
 * attractor responds to light in Surface mode — a Blinn-Phong specular lobe
 * plus three physically-flavored knobs (metalness, image-based reflection,
 * thin-shell transmission) layered over it. Read by Surface mode's tracers
 * ONLY (`surface-material.ts`/`-4d.ts`, `surface-de-gpu.ts`'s shade entry);
 * every other render mode — points, flame, solid — never looks at it.
 *
 * Like the fold's three lengths ({@link Variation.minRadius} et al., one
 * feature over), `finish` deliberately breaks the "a transform's
 * per-variation data is a type -> weight map" model rather than pretending
 * to fit it — except it breaks a DIFFERENT model: these are per-TRANSFORM
 * shading parameters, not per-variation warp parameters, which is why the
 * field lives on {@link Transform} directly rather than inside a
 * {@link Variation} entry.
 *
 * ABSENT MEANS THE CLASSIC VALUES — today's hardcoded lighting formula
 * (specular 0.4, shininess 32, metalness/reflect/transmit all 0,
 * reflection tint 1) — BYTE-IDENTICALLY: an unauthored document, and every
 * document predating this field, renders exactly today's frame. Each field is independently
 * optional too, so a document may author `metalness` alone and leave the
 * rest classic. `surface-finish.ts`'s
 * {@link import("./surface-finish").resolveSurfaceFinish} is the one place
 * that rule is written down; nothing else may re-derive it.
 *
 * Procedural albedo is deliberately NOT here — this remains lighting response
 * only. {@link Transform.surfacePattern} is its document-level sibling.
 */
export interface SurfaceFinish {
  /**
   * Blinn-Phong specular strength, the highlight's brightness multiplier.
   * Absent ⇒ 0.4, today's fixed value. Clamped only from below (`>= 0`) at
   * resolve time — an overdriven highlight past the classic value is legal
   * authoring.
   */
  specular?: number;
  /**
   * Blinn-Phong specular exponent, the highlight's tightness (higher ⇒
   * smaller and sharper). Absent ⇒ 32, today's fixed value. Floored
   * strictly above 0 at resolve time — never at the classic value — so the
   * knob stays continuous down to a near-flat highlight instead of jumping.
   */
  shininess?: number;
  /**
   * How strongly this part of the surface reads as metal, `[0, 1]`. Absent
   * ⇒ 0, today's fully dielectric shading.
   */
  metalness?: number;
  /**
   * Image-based reflection weight, `[0, 1]`. Absent ⇒ 0 — today's shading
   * carries no reflection term at all.
   */
  reflect?: number;
  /**
   * Thin-shell transparency weight, `[0, 1]`. Absent ⇒ 0 — today's shading
   * is fully opaque.
   */
  transmit?: number;
  /**
   * How strongly a metal reflection inherits the transform's base color,
   * `[0, 1]`. Absent ⇒ 1, the colored-metal behavior that shipped before
   * this field. Chrome authors 0 so a red transform can still reflect an
   * achromatic room; Metal keeps 1 for deliberately colored metal.
   */
  reflectionTint?: number;
}

/**
 * One affine map in the iterated function system. Position, rotation (Euler
 * angles in radians, applied in XYZ order), and per-axis scale together define
 * a 4x4 transform — see {@link composeAffine}.
 */
export interface Transform {
  id: number;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  /**
   * Relative selection weight for the chaos game. The iterator picks each map
   * with probability proportional to its weight, so a frond map at weight 12 is
   * drawn ~12× as often as a leaflet at weight 1. Omitted ⇒ 1, and a system
   * whose weights are all 1 samples uniformly exactly as before.
   */
  weight?: number;
  /**
   * Optional palette index in `[0, 1]` — flam3's per-xform `color`.
   * The gradient slot a flame render's structural color coordinate is pulled
   * toward whenever this map is picked (see `flame.ts`'s `accumulateFlame`).
   * Omitted ⇒ DERIVED: `chaos-game.ts`'s `derivedColorIndex` spreads map
   * `i` of `n` evenly across the ramp (`i / (n - 1)`, or `0.5` when `n === 1`)
   * — exactly the hard-derived slot every flame rendered before this field
   * existed, so an absent value is byte-for-byte the old behaviour. Read by
   * the flame (`flame.ts`/`flame-4d.ts` and their WGSL twins) and the solid
   * voxel grid (`voxel.ts`/`voxel-4d.ts`), the two renders that walk a
   * structural color coordinate, and the surface tracer's orbit-trap
   * coordinate under its "Palette" color source, which reads this
   * slot rather than walking it (`src/app/surface-slots.ts`'s
   * `surfaceTrapIndices`, whose own fallback spread agrees with
   * `derivedColorIndex` at every `n > 1` but parks a lone map at the ramp
   * start rather than mid-ramp). All three read it only with a gradient
   * palette active, and in all three an absent value renders exactly as it
   * did before this field existed.
   *
   * The IDENTITY-hue palette (`color.ts`'s `transformColors`) reads it
   * too — a second, independent mechanism: a map's `colorIndex`
   * picks its position on the hue wheel instead of the even `i / count`
   * spread (note the different derived fallback from the structural readers
   * above — `i / count`, not `derivedColorIndex`'s `i / (n - 1)` — the two
   * were already independent conventions before this field existed, and stay
   * that way). This is the "By Transform" identity color read everywhere a
   * map needs one consistent color across views, gradient palette or not:
   * the explorer's point-cloud and solid "By Transform" modes, the legend
   * and transform-list swatches, the surface tracers' By Transform slot
   * colors (`surfaceSlotColors`, alongside `surfaceTrapIndices` above), and
   * mutation-grid thumbnails. Absent renders exactly as it did before this
   * field existed here too, so no scene repaints until one authors
   * `colorIndex`.
   */
  colorIndex?: number;
  /**
   * Optional color speed in `[0, 1]` — flam3's per-xform `color_speed` (the
   * legacy `symmetry` attribute is `1 - 2·speed`). How far the structural
   * color coordinate moves toward {@link colorIndex} on each pick:
   * `c ← c·(1 - speed) + colorIndex·speed`. `0` pins the coordinate (flam3's
   * "symmetry" xforms, which shade without recoloring), `1` snaps it straight
   * to the slot. Omitted ⇒ `chaos-game.ts`'s `DEFAULT_COLOR_SPEED` (`0.5`), the halfway
   * blend every flame used before this field existed. Unlike {@link colorIndex},
   * this has no surface-tracer counterpart, since the surface descends a map
   * rather than picking one, leaving no per-pick coordinate for a speed to
   * move (see `src/app/surface-slots.ts`).
   */
  colorSpeed?: number;
  /**
   * Optional shear `[xy, xz, yz]`, a unit upper-triangular factor `U` applied as
   * `M = R · diag(scale) · U`. Rotation + per-axis scale alone can only produce
   * orthogonal-column maps; shear supplies the remaining 3 degrees of freedom,
   * so position/rotation/scale/shear together express *any* affine map. Omitted
   * ⇒ no shear, leaving existing systems unchanged.
   */
  shear?: Vec3;
  /**
   * Optional nonlinear variations blended in after the affine part (see
   * {@link Variation} and `variations.ts`). Omitted or empty ⇒ the map stays
   * purely affine, leaving every existing system byte-for-byte unchanged.
   */
  variations?: Variation[];
  /**
   * Optional 4D extension (see {@link WExtension}): the degrees of freedom
   * that let this map act in 4-space — a `w` position, an independent `w`
   * scale, and the three w-mixing rotation/shear planes — without promoting
   * the map to a full {@link Transform4}. This is what makes "4D" a property
   * of a SYSTEM (some transform's `w` block is present and non-trivial)
   * rather than a separate mode the whole system opts into. Omitted (or
   * present with every field absent/exactly `0`) ⇒ the map lives flat in the
   * `w = 0` slice, leaving existing systems byte-for-byte unchanged — the
   * same absent-means-identity convention as {@link Transform.weight}/
   * {@link Transform.shear}/{@link Transform.variations}. See `affine4.ts`'s
   * `isFlatTransform`/`systemIsFlat` (the flatness predicates) and
   * `toTransform4` (the lift that splices these overrides onto
   * `embedTransform3`'s embedding).
   */
  w?: WExtension;
  /**
   * Optional chaos row (flam3's "xaos", Mauldin–Williams graph-directed
   * selection): `chaos[j]` scales the probability of picking BASE transform
   * `j` (document order) when the PREVIOUSLY APPLIED base map was THIS one —
   * flam3's row convention: the row is the FROM side, each entry the TOWARD
   * side. The chaos game's next pick is then drawn with probability
   * ∝ `weight_j · chaos[j]` instead of `weight_j` alone, so a block-diagonal
   * matrix keeps two sub-systems as separate objects in one space and small
   * off-block entries leak them into each other in a controlled way.
   *
   * ABSENT ROW, ABSENT TAIL ENTRIES, AND ALL-1s ROWS ALL MEAN 1,
   * byte-identically (rows are padded/truncated to the base-transform count
   * at consumption — flam3's rule): a document carrying no non-trivial row
   * renders exactly as before this field existed, the `weight?`/`colorIndex?`
   * convention. `chaos-game.ts`'s {@link import("./chaos-game").systemHasChaos}
   * /`chaosRowIsNonTrivial` are the ONE definition of "non-trivial" and of
   * the consumption domain (entries clamp to `>= 0`; a non-finite entry
   * reads as 1 — defense only, `persist.ts` drops malformed rows); nothing
   * else may re-derive either. The final transform never carries one: it
   * sits outside selection entirely (it is plot-time), exactly as in flam3.
   *
   * Read by every chaos-game consumer (points, both Flame backends, solid)
   * and by Surface's inverse descent, which transposes positive weighted
   * support into predecessor masks. A Surface inverse-analysis refusal is
   * terminal: routing such a document into a chi-blind forward escape core
   * would march the unconstrained — wrong — object.
   */
  chaos?: number[];
  /**
   * Optional per-transform surface finish (see {@link SurfaceFinish}): how
   * this map's part of the attractor responds to light in Surface mode.
   * Omitted (or present with every field absent) ⇒ the classic hardcoded
   * Blinn-Phong formula, leaving every existing system byte-for-byte
   * unchanged — the same absent-means-identity convention as
   * {@link Transform.weight}/{@link Transform.shear}/
   * {@link Transform.variations}. Read by Surface mode's tracers only;
   * every other render mode ignores it.
   */
  finish?: SurfaceFinish;
  /**
   * Optional per-transform procedural albedo. Omitted means no pattern and is
   * an exact albedo identity; see `surface-pattern.ts` for the sole resolver,
   * domains, defaults, stable wire ids, and accepted CPU arithmetic. This is a
   * sibling of {@link finish}, never a field inside the lighting response.
   */
  surfacePattern?: SurfacePattern;
  /**
   * Optional shape EMITTER — Barnsley's IFS-with-condensation as a
   * transform kind: `H(S) = C₀ ∪ ⋃ f_j(S)`, with this shape as the fixed
   * compact set `C₀`. When the chaos game's selection picks a slot whose
   * base transform carries one, the step IGNORES the incoming orbit point
   * and emits a fresh uniform sample of the shape instead, posed by this
   * transform's OWN affine TRS (position/rotation/scale/shear — the
   * existing sliders are the shape's pose; the spec's internal part poses
   * stay reserved for shape authoring). The plotted cloud is then the union
   * of `f_w(C₀)` over all composition words `w` — "a 3D fractal of cog
   * wheels". {@link weight} doubles as the emission probability and
   * {@link colorIndex} as the emitter's own palette slot, both through the
   * unchanged selection/coloring machinery.
   *
   * The transform's {@link variations} are SKIPPED on emitter steps — a
   * condensation set is a fixed compact shape, and warping each sample
   * would render some other set (`chaos-game.ts`'s `stepOrbit` states the
   * rule where it acts). ABSENT MEANS TODAY'S BEHAVIOR byte-identically —
   * same stream, same output, zero extra draws (the `weight?`/`chaos?`
   * convention); `chaos-game.ts`'s `transformHasEmitter`/
   * `systemHasEmitters` are the ONE presence predicates every seam keys
   * on. The final transform never carries one — it sits outside selection
   * (plot-time), so nothing ever builds a sampler for it.
   *
   * Read by every chaos-game consumer (points, flame CPU, solid). The
   * flame WGSL kernels do NOT know it yet, so an emitter document forces
   * the flame CPU backend (disclosed in the backend note), and all five
   * surface/escape/bulb estimator gates refuse emitter documents outright:
   * condensation makes the attractor a SUPERSET of the plain one, and an
   * estimator without the shape term would march the wrong object.
   */
  emitter?: ShapeSpec;
}

/**
 * The color modes, in UI order. This array is the single source of truth for
 * both the {@link ColorMode} type and the persistence validator
 * (`VALID_COLOR_MODES` in `persist.ts`), so adding a mode is one edit and the
 * runtime guard can never silently drift from the type.
 */
export const COLOR_MODES = [
  "transform",
  "height",
  "radius",
  "position",
  "uniform",
] as const;

/** How point colors are derived from the generated cloud. */
export type ColorMode = (typeof COLOR_MODES)[number];

/**
 * How the 4D projection view colors points, in UI order. Same
 * single-source pattern as {@link COLOR_MODES}: this array drives the
 * {@link FourDColorMode} type and the persistence validator
 * (`VALID_FOUR_D_COLOR_MODES` in `persist.ts`), so adding a mode is one edit.
 * The `w…` entries are diverging palettes on the signed rotated 4th
 * coordinate, colored purely in-shader (see `color.ts`'s `W_SIDE_PALETTES`
 * and scene.ts's `FOUR_D_VERTEX`); `transform` and `radius` bake a
 * rotation-invariant per-point color attribute instead (`color.ts`'s
 * `buildColors4`).
 */
export const FOUR_D_COLOR_MODES = [
  "wBlueOrange",
  "wPurpleGreen",
  "wCyanMagenta",
  "transform",
  "radius",
] as const;

/** How the 4D projection derives point colors. */
export type FourDColorMode = (typeof FOUR_D_COLOR_MODES)[number];

/** The {@link FourDColorMode}s that color in-shader from the signed rotated
 * w — the diverging "w depth" palettes (see `color.ts`'s `W_SIDE_PALETTES`). */
export type WDepthColorMode = Exclude<FourDColorMode, "transform" | "radius">;

/** The {@link FourDColorMode}s that bake a rotation-invariant per-point color
 * attribute on the CPU (see `color.ts`'s `buildColors4`) — the complement of
 * {@link WDepthColorMode}. */
export type FourDAttributeColorMode = Extract<
  FourDColorMode,
  "transform" | "radius"
>;

/**
 * The scheduled-hybrid post-word block — "a Menger sponge MADE OF ferns":
 * after each plotted attractor point of system A (and BEFORE the
 * final-transform lens), the chaos game applies {@link depth} independently
 * random maps drawn from this second transform list B, so the plotted
 * distribution is the depth-k B-arrangement of A's attractor — the union of
 * `s_w(A)` over all words `w` of length k. Finite k IS the artwork: as k
 * grows the A-copies shrink into invisibility and the plain B-attractor
 * returns.
 *
 * SCENE-LEVEL, not per-transform: the block rides the scene document (and
 * `AppState`) beside `finalTransform`, never inside a {@link Transform}.
 * ABSENT MEANS TODAY'S BEHAVIOR byte-identically — no block, no extra RNG
 * draws, same stream, same output (the `weight?`/`colorIndex?` convention at
 * scene scope). The UI removes the block at depth 0 (the classic-removal
 * rule), so a present block always has `depth` in 1..`MAX_SCHEDULE_DEPTH`
 * and a non-empty list; `chaos-game.ts`'s `prepareSchedule` is the one
 * consumption-domain owner and degrades anything else to absent.
 *
 * B IS AFFINE-ONLY, STORED STRIPPED: entries carry only
 * position/rotation/scale/shear and weight — no variations, no `w` block, no
 * chaos rows, no finish/color fields. The natural Bs (sponge/sierpinski
 * arrangements) are pure affine, and running B's variation blends would
 * multiply the mirror surface (CPU + GPU, 3D + 4D — every hand-inlined plot
 * seam and both WGSL kernels) for no demonstrated composition. The picker
 * strips at snapshot time and `persist.ts`'s decoder accepts only the affine
 * fields, so the engine (`chaos-game.ts`'s `prepareSchedule`) composes
 * affines alone and never consults the rest.
 */
export interface HybridSchedule {
  /** System B's maps — affine-only (see above), weighted like any transform
   * list ({@link Transform.weight}, absent ⇒ 1). */
  transforms: Transform[];
  /** How many random B-maps bend each plotted point — the word length k,
   * an integer in 1..`MAX_SCHEDULE_DEPTH` for a present block. */
  depth: number;
}

/**
 * How a {@link ShapeTrap} turns its per-step candidates into ONE palette
 * coordinate: `"min"` keeps the orbit's closest weighted approach to the
 * shape (Pickover's classic), `"threshold"` keeps the FIRST weighted
 * candidate that dips under {@link ShapeTrap.threshold} — the stamps alone,
 * each shaded by how deep the crossing landed, everything else at the ramp's
 * top. Single source of truth for the type and the persistence validator,
 * the {@link COLOR_MODES} discipline.
 */
export const SHAPE_TRAP_MODES = ["min", "threshold"] as const;
export type ShapeTrapMode = (typeof SHAPE_TRAP_MODES)[number];

/**
 * The escape-time family's shape-trap block — Pickover shape-trapping as a
 * scene-level color channel, with an optional fold-chain geometry use. At
 * every step of the forward orbit the trap measures the orbit point's
 * distance to this posed shape. The shade paths can paint the accumulated
 * value through the surface palette; when {@link ShapeTrap.geometry} is true,
 * fold-only escape estimators can also union the pulled-back shape with the
 * escape set. The geometry eligibility gate lives at the app/shader seam;
 * the low-level document vocabulary only records the intent and level band.
 *
 * SCENE-LEVEL, beside {@link HybridSchedule}: one trap per document, riding
 * `AppState`/the scene document rather than a transform. ABSENT MEANS OFF
 * byte-identically — no block, no trap arithmetic anywhere, every emitted
 * shader byte-identical to the pre-trap build (the `weight?`/`chaos?`
 * convention at scene scope). Every OTHER field is optional with the
 * absent-means-classic rule: pose fields default to the identity
 * ({@link ShapePose}'s treatment), `mode` to `"min"`, `threshold` to
 * `shape-trap.ts`'s `DEFAULT_SHAPE_TRAP_THRESHOLD`, `fade` to 0. The
 * resolution domain — every default and floor — lives in ONE place,
 * `shape-trap.ts`'s `resolveShapeTrap`, exactly as the fold lengths' lives
 * in `resolveFoldRadii`; persistence carries pose/color numbers with
 * fidelity, while state and persistence canonicalize geometry's integer
 * band through that resolver.
 *
 * THE POSE IS IN ORBIT SPACE — the space the forward orbit's points live in
 * (`v` space for a chain, `y` space for the Mandelbulb), whose scale is the
 * family's bailout ball. The trap VALUE is scale-relative by construction
 * (distances are measured in the shape's own local units and normalized by
 * its bounding radius), so scrubbing `scale` moves the stamps' SIZE without
 * blowing the channel's [0, 1] range.
 */
export interface ShapeTrap {
  /** The trapped shape ({@link ShapeSpec} — `shapes.ts`'s vocabulary). */
  shape: ShapeSpec;
  /** Trap center in orbit space. Absent ⇒ the origin. */
  position?: Vec3;
  /** Intrinsic Euler XYZ, radians — the {@link ShapePose.rotate}
   * convention. Absent ⇒ no rotation. */
  rotation?: Vec3;
  /** Uniform scale, `> 0`; absent/non-finite/`<= 0` resolves to 1
   * (`resolveShapeTrap`). */
  scale?: number;
  /** Accumulation rule — see {@link SHAPE_TRAP_MODES}. Absent ⇒ `"min"`. */
  mode?: ShapeTrapMode;
  /** The `"threshold"` mode's crossing bar, in NORMALIZED shape units
   * (fractions of the shape's own bounding radius, so it composes with
   * `scale`). Read only under that mode. Absent ⇒ the classic default. */
  threshold?: number;
  /** Fade-by-iteration-index: step `i`'s candidate is weighted by
   * `1 + fade·i` before the min/threshold rule, so a positive fade biases
   * the channel toward the orbit's EARLY (large) stamps. Absent ⇒ 0. */
  fade?: number;
  /** Use the posed shape as fold-chain geometry as well as a color trap.
   * Absent/false ⇒ classic color-only behavior, byte-identically. Geometry
   * reads only `shape` and the pose fields: `mode`, `threshold`, and `fade`
   * remain color-channel controls. */
  geometry?: boolean;
  /** First eligible post-link orbit level, inclusive and zero-based.
   * Absent ⇒ 0. Finite values resolve to nonnegative integers. */
  geometryLevelMin?: number;
  /** Last eligible post-link orbit level, inclusive and zero-based.
   * Absent ⇒ unbounded. Finite values resolve to nonnegative integers;
   * reversed endpoints are sorted by `resolveShapeTrap`. */
  geometryLevelMax?: number;
}

/** Axis-aligned extent of a point cloud, plus radial extent from the origin. */
export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  minR: number;
  maxR: number;
}

/**
 * Coordinate planes {@link SymmetryParams} can rotate copies IN. This array is
 * the single source of truth for both the {@link SymmetryPlane} type and the
 * persistence validator (`VALID_SYMMETRY_PLANES` in `persist.ts`), so the
 * runtime guard can never silently drift from the type.
 *
 * The names — and their index pairs — are exactly {@link Rotation4}'s six
 * planes: in 4D you rotate IN a plane, not ABOUT an axis (a simple rotation
 * fixes the orthogonal complement, an axis in 3D but a whole plane in 4D).
 * The three w-free planes (`xy`/`xz`/`yz`) are the ones that also have a 3x3,
 * and they are what the `SymmetryAxis` they replaced named from the other
 * side: axis `x` = plane `yz`, axis `y` = plane `xz`, axis `z` = plane `xy`.
 * See `chaos-game.ts`'s `symmetryRotation` for the migration's exact matrices
 * (including the one sign the `R_ab` convention does NOT share with
 * "rotation about +y").
 */
export const SYMMETRY_PLANES = ["xy", "xz", "yz", "xw", "yw", "zw"] as const;

/** One coordinate plane a kaleidoscope's rotated copies turn in. */
export type SymmetryPlane = (typeof SYMMETRY_PLANES)[number];

/**
 * Rotational/mirror symmetry: replicate the whole transform set
 * `order` times, each copy rotated by an additional `2π / order` in
 * `plane`, producing a kaleidoscope — see `chaos-game.ts`'s
 * `prepareChaosGame`. `order: 1` is the identity regardless of
 * `plane`/`twist`: today's system, unreplicated — which is why
 * `affine4.ts`'s {@link import("./affine4").symmetryIsNonFlat} can never
 * force an order-1 system into 4D.
 */
export interface SymmetryParams {
  /** Number of rotated copies, including the unrotated original. `1` = off. */
  order: number;
  /** Coordinate plane the copies are rotated in. */
  plane: SymmetryPlane;
  /**
   * The SECOND angle of a 4D double rotation, as an integer number of
   * sectors: copy `k` additionally turns by `2π·k·twist / order` in the
   * plane ORTHOGONAL to {@link plane} (`xy`↔`zw`, `xz`↔`yw`, `xw`↔`yz`) —
   * implied by the choice of `plane`, never a second field. `0` (and absent,
   * the default) is a SIMPLE rotation, which is what every document
   * predating the 4D kaleidoscope has and what the 3D paths are the only
   * consumers of; `1` and `order - 1` are the left/right ISOCLINIC cases.
   * Holding the first angle at exactly `2π / order` is WLOG — reindexing `k`
   * reaches every cyclic subgroup of order `n` — so one integer covers the
   * whole family.
   *
   * A nonzero twist rotates the attractor OUT of the `w = 0` hyperplane, so
   * it makes the SYSTEM non-flat (`affine4.ts`'s `symmetryIsNonFlat`) exactly
   * as a `w`-plane does.
   */
  twist?: number;
  /**
   * Strength of the rotated copies, `0..1`: a weight multiplier on
   * every copy-`k>0` slot's selection probability (`prepareChaosGame`), so
   * `1` — and absent, the default — is the full kaleidoscope, `0` renders
   * bit-identically to `order: 1`, and values between thin the copies out.
   * Exists so a system morph can CROSSFADE a kaleidoscope instead of
   * snapping the discrete order (`morph.ts`'s symmetry rules): only ever set
   * on a morph's intermediate samples — the document, the UI, and
   * `persist.ts` never carry it.
   */
  blend?: number;
}

/**
 * Rotation of a 4D map, one optional angle in radians per coordinate
 * plane. A 4D rotation has SIX independent planes (vs. three axes in
 * 3D — in 4D you rotate *in a plane*, not *about an axis*): the three planes of
 * the embedded 3D space (`xy`, `xz`, `yz`) plus the three that mix in the fourth
 * coordinate (`xw`, `yw`, `zw`). Each field is the angle of `R_ab` as defined in
 * `affine4.ts` (rotating the `+a` axis toward `+b`). A missing/undefined field is
 * exactly 0 — see {@link Transform4}. All absent ⇒ the identity rotation.
 */
export interface Rotation4 {
  xy?: number;
  xz?: number;
  yz?: number;
  xw?: number;
  yw?: number;
  zw?: number;
}

/**
 * Shear of a 4D map: the six above-diagonal entries of a 4x4 unit
 * upper-triangular matrix `U`, the direct 4D extension of {@link Transform.shear}
 * (a `Vec3` `[xy, xz, yz]` in 3D). Each field `ab` sits at row `index(a)`, column
 * `index(b)` of `U` (with `x=0, y=1, z=2, w=3`), row-major:
 *
 *     U = | 1 xy xz xw |
 *         | 0  1 yz yw |
 *         | 0  0  1 zw |
 *         | 0  0  0  1 |
 *
 * The three 3D-plane entries (`xy`, `xz`, `yz`) occupy exactly the slots
 * `affine.ts`'s `shearMatrix` fills from a `Vec3`; the three `w`-column entries
 * (`xw`, `yw`, `zw`) are the new degrees of freedom the fourth coordinate adds.
 * A missing/undefined field is exactly 0 — mirroring {@link Rotation4}. All
 * absent ⇒ the identity (no shear). `U` is right-multiplied into `R·diag(scale)`
 * — see `affine4.ts` (`composeAffine4`).
 */
export interface Shear4 {
  xy?: number;
  xz?: number;
  yz?: number;
  xw?: number;
  yw?: number;
  zw?: number;
}

/**
 * Optional 4D extension a {@link Transform} can carry (its `w` field): the
 * degrees of freedom that let a 3D map act in 4-space — a translation along
 * `w`, an independent `w` scale, and the three w-mixing rotation/shear planes
 * — without promoting the map to a full {@link Transform4}. This is what lets
 * "4D" be a property of a SYSTEM (some transform's `w` block is present and
 * non-trivial) rather than a separate mode the whole system opts into — see
 * `affine4.ts`'s `isFlatTransform`/`systemIsFlat` (the flatness predicates)
 * and `toTransform4` (the lift that applies these overrides on top of
 * `embedTransform3`'s `w = 0` embedding).
 *
 * The rotation/shear fields are literally `Pick`s of {@link Rotation4}'s and
 * {@link Shear4}'s w-mixing entries, so their meaning is exactly the `R_ab`/
 * `U` convention documented there — this block never invents its own angle or
 * shear semantics, it just exposes the three w-planes each already defines.
 * Every field is independently optional, and absent ⇒ its embed default (see
 * each field below); a block with every field absent, or present and exactly
 * `0`, is equivalent to no block at all.
 */
export interface WExtension {
  /** The fourth position coordinate, `t_w`. Absent ⇒ `0`, the `w = 0` slice. */
  position?: number;
  /**
   * The fourth scale factor, `scale_w`. Absent ⇒ DERIVED — recomputed at lift
   * time as the map's mean spatial contraction `(|sx|+|sy|+|sz|)/3` (the same
   * value a plain 3D embed gets), rather than materialised once, so `scale_w`
   * keeps tracking later scale-X/Y/Z edits instead of freezing a stale mean.
   * Set it explicitly to pin `scale_w` independent of the 3D scale.
   */
  scale?: number;
  /**
   * The three w-mixing rotation planes (`R_ab` convention — see
   * {@link Rotation4}): rotating `+x`/`+y`/`+z` toward `+w`. A missing field
   * is exactly 0, matching {@link Rotation4} itself.
   */
  rotation?: Pick<Rotation4, "xw" | "yw" | "zw">;
  /**
   * The three w-column entries of {@link Shear4}'s unit upper-triangular `U`.
   * A missing field is exactly 0, matching {@link Shear4} itself.
   */
  shear?: Pick<Shear4, "xw" | "yw" | "zw">;
}

/**
 * One affine map of a 4D IFS. With shear and variations it now
 * parameterizes the FULL 20-dimensional affine group of R⁴ — 4 position +
 * 4 scale + 6 rotation ({@link Rotation4}) + 6 shear ({@link Shear4}) — the
 * exact `M = R · diag(scale) · U` (QR-style) picture of the 3D
 * {@link Transform} one dimension up, plus the same post-affine nonlinear
 * {@link Variation} blend. Every field but `position`/`scale` is optional and
 * absent ⇒ its identity, so a plain contraction stays a two-field object and
 * embeds/composes bit-identically. See `affine4.ts` (`composeAffine4`) and
 * `chaos-game-4d.ts`.
 */
export interface Transform4 {
  position: Vec4;
  scale: Vec4;
  /** Plane rotation; omitted ⇒ no rotation (identity linear part before scale). */
  rotation?: Rotation4;
  /**
   * Unit upper-triangular shear factor `U`, right-multiplied as
   * `M = R · diag(scale) · U` (see {@link Shear4}); omitted ⇒ no shear. The 4D
   * analogue of {@link Transform.shear}, completing the affine parameterization.
   */
  shear?: Shear4;
  /**
   * Nonlinear variations blended in after the affine part, same
   * weighted-sum semantics as {@link Transform.variations} (see
   * `variations4.ts`). Omitted or empty ⇒ the map stays purely affine.
   */
  variations?: Variation[];
  /**
   * Relative selection weight for the 4D chaos game, mirroring
   * {@link Transform.weight}. Omitted ⇒ 1.
   */
  weight?: number;
  /**
   * Palette index for the 4D flame's structural coloring, mirroring
   * {@link Transform.colorIndex} exactly. Omitted ⇒ the derived
   * even spread. Carried across the 3D → 4D lift by `affine4.ts`'s
   * `embedTransform3`, so a `Transform` that authors one keeps it in every
   * 4D render.
   */
  colorIndex?: number;
  /**
   * Color speed for the 4D flame's structural coloring, mirroring
   * {@link Transform.colorSpeed} exactly. Omitted ⇒ `chaos-game.ts`'s
   * `DEFAULT_COLOR_SPEED`.
   */
  colorSpeed?: number;
  /**
   * Chaos row for graph-directed selection, mirroring
   * {@link Transform.chaos} exactly — selection is dimension-agnostic, so
   * the meaning, the absent-means-1 rule and the consumption domain are all
   * `chaos-game.ts`'s one definition. Carried across the 3D → 4D lift by
   * `affine4.ts`'s `embedTransform3`, so a `Transform` that authors rows
   * keeps its graph in every 4D render.
   */
  chaos?: number[];
  /**
   * Shape emitter, mirroring {@link Transform.emitter} exactly — the shape
   * vocabulary is deliberately 3D (`shapes.ts`'s own parity statement), so
   * the 4D step samples the shape AT `w = 0` and lets this transform's 4D
   * affine pose the lifted `(x, y, z, 0)` sample; see `chaos-game-4d.ts`'s
   * `stepOrbit4` for the one place that choice acts. Meant to be carried
   * across the 3D → 4D lift by `affine4.ts`'s `embedTransform3` exactly as
   * {@link chaos} is.
   */
  emitter?: ShapeSpec;
}

/** Axis-aligned extent of a 4D point cloud (the 4D analogue of {@link Bounds}). */
export interface Bounds4 {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  minW: number;
  maxW: number;
}
