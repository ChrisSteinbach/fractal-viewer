/**
 * The escape family's SHAPE-TRAP vocabulary — resolution and the ONE value
 * formula, in a home every consumer can import without a cycle: the three
 * CPU oracles (`escape-de.ts`, `escape-de-4d.ts`, `bulb-de.ts` — the bulb
 * module could not import this from `escape-de.ts`, which imports
 * `bulb-de.ts` itself), the WGSL codegen (`surface-de-gpu.ts`), the GLSL
 * resolver (`surface-material.ts`) and the app's wire/UI seams.
 *
 * THE DOCUMENT TYPE IS NOT HERE. `types.ts` owns {@link ShapeTrap} /
 * `SHAPE_TRAP_MODES` with the rest of the document vocabulary
 * (`HybridSchedule`'s home, and where every app-side importer already
 * reads it); this module owns what the fields MEAN — the
 * absent-means-classic resolution domain ({@link resolveShapeTrap}, the
 * `resolveFoldRadii` discipline) and the formula the shader mirrors copy:
 *
 *   candidate_i = sdShape((Rᵀ(z_i − pos)) / s) · invNorm · (1 + fade·i)
 *
 * z_i is the orbit point AFTER step i — the same point rings/sheets read —
 * the pose inverse is the exact similarity conjugation WITHOUT the
 * `scale ×` value factor, so distances are measured in the shape's own
 * LOCAL units, and dividing by the shape's bounding radius
 * ({@link shapeTrapInvNorm}) makes the channel scale-relative: scrubbing
 * the trap scale moves the stamps' SIZE, never the [0, 1] range. Two
 * accumulators run side by side — `best = min_i candidate_i` and the FIRST
 * candidate under `threshold` — and the mode picks which becomes the
 * palette coordinate ({@link shapeTrapValue}):
 *
 *   min        u = clamp(best, 0, 1)
 *   threshold  u = crossed ? clamp(first / threshold, 0, 1) : 1
 *
 * so `min` shades by closest weighted approach (0 = on the stamp) and
 * `threshold` paints ONLY the stamps, each swept by how deep its first
 * crossing landed, everything else at the ramp's top. Those three fields
 * (`mode`, `threshold`, `fade`) and `invNorm` are COLOR ONLY, which is what
 * lets that channel compose with the whole family.
 *
 * OPTIONAL GEOMETRY restores the similarity's distance factor and divides
 * by the derivative bound AFTER the link that produced the sampled point:
 *
 *   posed_i = sdShape((Rᵀ(z_i − pos)) / s) · s
 *   trapDE_i = SHAPE_MARCH_SAFETY · posed_i / drAfter_i
 *
 * Only inclusive zero-based levels `geometryLevelMin..geometryLevelMax`
 * contribute, and the production escape oracles return the union
 * `min(escapeDE, min_i trapDE_i)`. Geometry absent/false never enters that
 * arithmetic, keeping every classic estimate bit-identical. Eligibility is
 * deliberately not resolved here: the app/shader gate restricts this field
 * to fold-only chains, while color remains valid on non-conformal maps.
 *
 * WHERE THE ACCUMULATORS RUN is each oracle's business, not this
 * module's: every module's SHARED orbit runner (`runEscapeOrbit`,
 * `runEscapeOrbit4`, `runBulbOrbit`) takes an optional resolved trap and
 * feeds the factored {@link shapeTrapLocalSdf} per step, so color and
 * geometry cannot disagree about pose or evaluate a different orbit than
 * the estimate — the one-loop discipline those runners exist for.
 *
 * Pure: no Three.js, no DOM, no imports outside `src/fractal/`.
 */
import { rotationMatrixXYZ } from "./affine";
import { shapeBoundingRadius, shapeSdf } from "./shapes";
import type { ShapeSpec } from "./shapes";
import type { ShapeTrap, Vec3 } from "./types";

/** The `"threshold"` mode's default crossing bar, in normalized shape units
 * — a quarter of the shape's bounding radius, which reads as a stamp with a
 * visible interior sweep rather than a hairline. */
export const DEFAULT_SHAPE_TRAP_THRESHOLD = 0.25;

/** The `"threshold"` accumulator's "never crossed" sentinel — FINITE and
 * f32-representable, because the shader mirrors carry the identical
 * literal. Strictly below any reachable candidate: a candidate is at least
 * `-1` in normalized units (the shape's deepest interior is within its own
 * bounding radius) times its fade weight, and {@link resolveShapeTrap}
 * caps `fade` so the weight stays orders of magnitude short of this. The
 * `best` accumulator initializes at the positive twin for the same
 * reason. */
export const SHAPE_TRAP_NO_CROSSING = -1e30;

/** Wire-safe stand-in for an unbounded geometry level range. Orbit levels
 * are zero-based integers, so no practical render budget reaches this. */
export const SHAPE_TRAP_GEOMETRY_LEVEL_MAX = 0x7fffffff;

/**
 * `1 / max(shapeBoundingRadius, floor)` — the trap's ONE normalizer, shared
 * by {@link resolveShapeTrap} and `surface-de-gpu.ts`'s codegen (which bakes
 * it as a literal beside the baked shape body) so the two cannot disagree.
 * The floor guards a degenerate spec (a zero-radius sphere) from dividing
 * by zero against this family's totality convention.
 */
export function shapeTrapInvNorm(spec: ShapeSpec): number {
  return 1 / Math.max(shapeBoundingRadius(spec), 1e-6);
}

/**
 * A {@link ShapeTrap} with every optional field resolved — the ONE
 * absent-means-classic domain (the `resolveFoldRadii` discipline), and the
 * exact numbers every wire packs: the GLSL uniforms
 * (`uTrapInvRot`/`uTrapPose`/`uTrapParams`) and the WGSL trap params block
 * both transfer THESE fields rather than re-deriving them.
 */
export interface ResolvedShapeTrap {
  /** The trapped shape — create-time geometry (the shader mirrors bake it
   * via `shapeSdfSource`; the CPU formula calls `shapeSdf`). */
  spec: ShapeSpec;
  /** Rᵀ of the pose rotation, row-major — world-to-shape. Identity when
   * the document omits `rotation`. */
  invRot: number[];
  /** Trap center in orbit space. Origin when absent. */
  position: Vec3;
  /** `1 / scale`, with non-finite/`<= 0` scales resolving to 1
   * (`shapes.ts`'s pose-domain rule, restated here because this block's
   * scale is not a `ShapePose`). */
  invScale: number;
  /** 0 = `"min"`, 1 = `"threshold"` — the numeric form both wires carry. */
  mode: number;
  /** The crossing bar in normalized units; floored at 1e-4 so the
   * `"threshold"` finalization's division is total. */
  threshold: number;
  /** Fade-by-index weight rate, floored at 0. */
  fade: number;
  /** {@link shapeTrapInvNorm} of `spec`. */
  invNorm: number;
  /** Whether the posed SDF also contributes a marching term. */
  geometry: boolean;
  /** First included zero-based post-link orbit level. */
  geometryLevelMin: number;
  /** Last included zero-based post-link orbit level. */
  geometryLevelMax: number;
}

/** Resolve a document trap block into the numbers the formula and every
 * wire read — absent fields take the classic values, out-of-domain numbers
 * resolve rather than throw (the fold lengths' discipline). */
export function resolveShapeTrap(trap: ShapeTrap): ResolvedShapeTrap {
  const r = trap.rotation;
  const scale =
    typeof trap.scale === "number" &&
    Number.isFinite(trap.scale) &&
    trap.scale > 0
      ? trap.scale
      : 1;
  const threshold =
    typeof trap.threshold === "number" && Number.isFinite(trap.threshold)
      ? Math.max(trap.threshold, 1e-4)
      : DEFAULT_SHAPE_TRAP_THRESHOLD;
  // Floored at 0 and capped well below the no-crossing sentinel's reach:
  // a candidate is >= -1 normalized times its weight, so the cap keeps
  // every reachable candidate orders of magnitude above the sentinel.
  const fade =
    typeof trap.fade === "number" && Number.isFinite(trap.fade)
      ? Math.min(Math.max(trap.fade, 0), 1e6)
      : 0;
  const authoredLevelMin = resolveGeometryLevel(trap.geometryLevelMin, 0);
  const authoredLevelMax = resolveGeometryLevel(
    trap.geometryLevelMax,
    SHAPE_TRAP_GEOMETRY_LEVEL_MAX,
  );
  return {
    spec: trap.shape,
    invRot:
      r && (r[0] !== 0 || r[1] !== 0 || r[2] !== 0)
        ? // rotationMatrixXYZ is orthonormal, so the inverse is the
          // transpose — transposed HERE, once, so every consumer applies
          // its rows directly (`surface-de.ts`'s invM convention).
          transpose3(rotationMatrixXYZ(r[0], r[1], r[2]))
        : [1, 0, 0, 0, 1, 0, 0, 0, 1],
    position: trap.position
      ? [trap.position[0], trap.position[1], trap.position[2]]
      : [0, 0, 0],
    invScale: 1 / scale,
    mode: trap.mode === "threshold" ? 1 : 0,
    threshold,
    fade,
    invNorm: shapeTrapInvNorm(trap.shape),
    geometry: trap.geometry === true,
    geometryLevelMin: Math.min(authoredLevelMin, authoredLevelMax),
    geometryLevelMax: Math.max(authoredLevelMin, authoredLevelMax),
  };
}

/** Resolve one authored inclusive geometry-band endpoint. */
function resolveGeometryLevel(
  value: number | undefined,
  fallback: number,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(SHAPE_TRAP_GEOMETRY_LEVEL_MAX, Math.max(0, Math.floor(value)))
    : fallback;
}

/** Row-major 3x3 transpose, for {@link resolveShapeTrap}'s pose inverse. */
function transpose3(m: number[]): number[] {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

/**
 * Step `i`'s trap candidate at orbit point `(x, y, z)` — the formula's one
 * per-step term, fed by every oracle's shared orbit runner so the shader
 * mirrors have exactly one text to copy.
 */
export function shapeTrapCandidate(
  rt: ResolvedShapeTrap,
  x: number,
  y: number,
  z: number,
  step: number,
): number {
  return shapeTrapLocalSdf(rt, x, y, z) * rt.invNorm * (1 + rt.fade * step);
}

/** The shape SDF in its own local frame. Color and geometry both enter
 * through this helper so their pose inverse cannot drift apart. */
export function shapeTrapLocalSdf(
  rt: ResolvedShapeTrap,
  x: number,
  y: number,
  z: number,
): number {
  const dx = x - rt.position[0];
  const dy = y - rt.position[1];
  const dz = z - rt.position[2];
  const m = rt.invRot;
  const lx = (m[0] * dx + m[1] * dy + m[2] * dz) * rt.invScale;
  const ly = (m[3] * dx + m[4] * dy + m[5] * dz) * rt.invScale;
  const lz = (m[6] * dx + m[7] * dy + m[8] * dz) * rt.invScale;
  return shapeSdf(rt.spec, lx, ly, lz);
}

/** World/orbit-space distance of the posed shape. Uniform similarity
 * conjugation is `scale * localSdf`, spelled as `/ invScale` because the
 * resolved trap stores the inverse scale used by the pose transform. */
export function shapeTrapPosedSdf(
  rt: ResolvedShapeTrap,
  x: number,
  y: number,
  z: number,
): number {
  return shapeTrapLocalSdf(rt, x, y, z) / rt.invScale;
}

/**
 * The two accumulators' finalization onto the [0, 1] palette coordinate
 * (the module doc's mode rule). `best` is the running min over candidates;
 * `cross` is the FIRST candidate that dipped under `rt.threshold`, or
 * {@link SHAPE_TRAP_NO_CROSSING} when none did.
 */
export function shapeTrapValue(
  rt: ResolvedShapeTrap,
  best: number,
  cross: number,
): number {
  if (rt.mode === 0) return Math.max(0, Math.min(1, best));
  if (cross <= SHAPE_TRAP_NO_CROSSING) return 1;
  return Math.max(0, Math.min(1, cross / rt.threshold));
}
