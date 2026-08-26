/**
 * The shape library: ONE document-facing shape vocabulary with TWO
 * evaluators, so every consumer renders the same object.
 *
 * Three siblings consume shapes two different ways: the orbit-trap channels
 * (escape-family trap color, trap-as-geometry) and the beam-descent
 * condensation term need SIGNED DISTANCE FIELDS in TS + GLSL + WGSL, while
 * the chaos-game emitter needs uniform POINT SAMPLING of the same shapes.
 * This module owns the vocabulary ({@link ShapeSpec}), the CPU oracle
 * ({@link shapeSdf}), the sampler ({@link prepareShapeSampler}), the
 * conservative bound ({@link shapeBoundingRadius}) and the shader emission
 * ({@link shapeSdfSource}), so a shape cannot mean different things to
 * different renderers.
 *
 * THE SPEC IS A FLAT POSED-PART LIST, DELIBERATELY WITHOUT RECURSION. A CSG
 * tree would be more expressive, but every future GPU consumer must pack a
 * spec into fixed-size uniform/params blocks, and a flat list of at most
 * {@link MAX_SHAPE_PARTS} parts packs; a tree does not. The boolean fold is
 * left-to-right over the list: `d = min(d, part)` for `"union"`,
 * `max(d, part)` for `"intersect"` — so `[A, B∩, C]` reads `((A ∩ B) ∪ C)`.
 * Part 0 must be `"union"` (there is nothing yet for it to intersect), and
 * both structural rules throw `RangeError` (`chaos-game.ts`'s
 * `MAX_TRANSFORMS` precedent).
 *
 * THE SDF CONTRACT. Every analytic primitive body is the exact Euclidean
 * distance in its own frame (sphere, box, torus, capsule are the standard
 * exact forms; the gear is exact by the sector-fold argument below). A mesh
 * is the conservative manual-trilinear lower field proved in
 * `mesh-shapes.ts`. The pose is a
 * similarity, under which the exact conjugation
 * `d(p) = scale * sd(Rᵀ(p - offset) / scale)` stays exact. The boolean fold
 * is the standard conservative one: `min` is exact in the EXTERIOR of a
 * union (and understates interior depth where members overlap), `max` is a
 * LOWER bound on the distance to an intersection — so the composed field
 * never overestimates the distance to the surface, which is the whole
 * marching contract. Analytic fields are 1-Lipschitz by construction
 * (min/max of 1-Lipschitz fields, isometries and the exact similarity
 * conjugation preserve it); the mesh field instead lower-bounds the true
 * signed distance directly. {@link SHAPE_MARCH_SAFETY} is the one shared
 * step factor consumers march the shape term with anyway, because the
 * gear's sector fold is only piecewise smooth (its float-rounded seam at
 * the atan2 branch cut is a hairline, not a proof) — the
 * `sphereFoldLipschitz` discipline one family over, one exported number so
 * the trap, descent and geometry consumers cannot disagree on it.
 *
 * THE GEAR is the brief's `sdGear2D` construction verbatim: a body disc of
 * `radius` (the root circle), ONE tooth box of half-size
 * `tooth = [halfRadial, halfTangential]` centered at distance `radius` on
 * the +x axis, repeated by folding the query angle into one sector of
 * `2π/teeth` (so the outer radius is `radius + tooth[0]`), an axle hole as
 * `max(d, hole - |p.xy|)`, and extrusion along z to `±halfHeight`. The
 * sector fold is exact for the repeated tooth: the fold preserves radius,
 * the folded angle to the own-sector tooth never exceeds the angle to a
 * neighbour, and the tooth box is symmetric about the sector's mid-plane,
 * so the field is continuous across seams and equals the true distance.
 * THE FOLD'S OWN DOMAIN RIDES THAT ARGUMENT: it sees only the own-sector
 * tooth, so a tooth must FIT its sector — `tooth[1]` beyond the sector's
 * half-chord (`radius * sin(π/teeth)`) leaves neighbour teeth invisible
 * to the fold and the field OVERESTIMATES near them, which is the one
 * failure {@link SHAPE_MARCH_SAFETY} cannot absorb (a safety factor damps
 * a steep gradient, not a claim of empty space where a neighbour tooth
 * stands). Sane gear parameterizations sit well inside this; authoring UI
 * should keep them there.
 * `hole` 0 means NO hole, implemented by OMITTING the hole term rather
 * than evaluating it at 0: the literal `max(d, 0 - |p|)` at `hole = 0`
 * would rewrite the interior near the axis to `-|p.xy|` — a phantom
 * zero-radius bore whose field claims the axis itself is boundary — so
 * "none" must be the term's absence, in this evaluator and in the emitted
 * shader text alike (the codegen bakes per spec, so the emitted source
 * simply has no hole line).
 *
 * POSE DOMAIN. Absent fields are the identity, byte-identically (the
 * `weight?`/fold-length convention). Out-of-domain NUMBERS resolve rather
 * than throw, `resolveFoldRadii`'s discipline: `scale` that is non-finite
 * or `<= 0` resolves to 1 (a zero scale would divide the conjugation by
 * zero against this module's totality), and a gear's `teeth` resolves to a
 * positive integer (the sector fold divides by it). Structure throws,
 * numbers resolve — the same split the fold family settled on, and for the
 * same reason: shape specs are headed for document state, and a decoder's
 * job at that leaf is fidelity while the domain lives here. Other numeric
 * fields are taken as authored; {@link shapeSdfSource} additionally throws
 * on any non-finite baked constant rather than emit `NaN` into a shader.
 *
 * THE SAMPLER is uniform BY VOLUME on analytic solids: each part gets a
 * closed-form measure (sphere/box/torus/capsule) or a seeded fixed-budget
 * Monte Carlo one (the gear profile's area, deterministic at prepare
 * time), a part is picked proportionally, sampled exactly in its own
 * frame, and VOLUME overlap is handled by MIN-INDEX ACCEPTANCE: a candidate
 * drawn from volume part `i` is accepted iff no earlier VOLUME part `j < i`
 * contains it (posed `sdf <= 0`), else redrawn — which assigns every volume
 * overlap region to its lowest-index solid and renormalizes by rejection,
 * i.e. exactly uniform on the solid union with no double density. Surface-
 * measure candidates (mesh parts and `gearOutline` gear parts) are independent
 * authored styling measures: they are always accepted, neither contain nor
 * are shadowed by a volume candidate, and therefore contribute independently
 * of their position in the part list. Redraws are UNBOUNDED and that is
 * documented policy: the emitter consumer owns the derived-stream RNG
 * discipline, so a rejection loop here consumes however many draws it
 * needs from the caller's stream. An `"intersect"` part makes the spec
 * SDF-ONLY: {@link prepareShapeSampler} throws, because uniform sampling
 * of an intersection fold has no exact per-part scheme — a part's exact
 * sampler covers the part, and there is no per-part way to draw uniformly
 * from the subset another part carves out of it short of rejection against
 * the folded region, whose acceptance can be arbitrarily near zero.
 * `gearOutline` swaps gear parts to the 2D profile OUTLINE (the brief's
 * wireframe look): candidates are drawn from a thin exterior band of the
 * profile and projected onto the zero set (exact-distance projection plus
 * polish steps, redrawing any point that fails to converge at a corner),
 * with z uniform — arc-length-near-uniform, with a disclosed corner bias
 * of the band's own width; the WGSL half of the sampler deliberately waits
 * for the flame-kernel consumer, which carries it via host-precomputed
 * tables so device and host sample the same measure. Outline parts weigh
 * in by lateral area (perimeter × height) rather than volume — a mixed
 * outline/solid spec's balance is a styling choice, not a density claim —
 * and neither contain a solid candidate nor get shadowed by one (their
 * surface measure is independent of the solid union's volume measure).
 * Mesh parts likewise carry SURFACE measure: exact triangle-area CDF and
 * sqrt-barycentric draws from the same prepared catalog object as the SDF
 * bake. They weigh by `area * scale²`, never volume-shadow another part and
 * are never shadowed by one; a mixed mesh/solid spec therefore mixes area and
 * union volume as order-independent authored styling measures.
 *
 * SHADER EMISSION is per-spec BAKED-CONSTANT CODEGEN, `surface-de-gpu.ts`'s
 * house style: {@link shapeSdfSource} emits one complete function — pose
 * inverses with baked matrix entries, primitive bodies, the boolean fold —
 * from ONE body template shared across dialects,
 * `background-shape.ts`'s dialect-parameterization. There is deliberately
 * NO params wire in this module: consumers own their wire (a trap channel,
 * a descent term and an emitter kernel all pack differently). Analytic
 * functions are self-contained; a mesh arm calls the consumer's single
 * atlas-backed `shapeMeshSdf(catalogIndex, p)` helper. The template is
 * SCALAR — px/py/pz locals, no vector
 * operators — which is what makes the third dialect possible: `"js"` emits
 * the SAME template as a runnable JavaScript function, so the test suite
 * EXECUTES the shared template against {@link shapeSdf} over random
 * specs/poses/points instead of only diffing tokens; it is the pin's
 * dialect, not a production consumer. Dialect sharp edges the token table
 * carries: the two-argument arctangent is `atan(y, x)` in GLSL but
 * `atan2(y, x)` in WGSL (`Math.atan2` in js); the sector fold's floor-mod
 * is spelled out as `x - y * floor(x / y)` because GLSL `mod()` is
 * floor-mod while WGSL `%` is trunc-remainder, and the explicit form is
 * one template valid everywhere; every baked number is formatted as a
 * float literal valid in all three dialects (a trailing `.0` appended to
 * bare integers); locals declare as `float` in GLSL and `let` in
 * WGSL/js, SSA-style so no dialect needs a mutable local. Helper bodies
 * (`_box2` and friends) are emitted once per source, prefixed with the
 * caller's function name so two emitted shapes never collide in one
 * shader.
 *
 * 4D PARITY. The vocabulary is deliberately 3D: a shape is a 3D object
 * that BOTH dimensions' renders embed, and each consumer decides its own
 * slice/embedding — the escape-trap consumer already fixes "the 3D shape
 * applied to the orbit's xyz" for the 4D orbit, and the descent consumer
 * carries its own 4D term. A 4D shape vocabulary would be a different
 * feature, not this one's missing half; this sentence is the module's own
 * evidence under the dimensional-parity rule.
 *
 * Pure: no Three.js, no DOM, no imports outside `src/fractal/`.
 */
import type { Vec3 } from "./types";
import { rotationMatrixXYZ } from "./affine";
import { mulberry32 } from "./rng";
import type { Rng } from "./rng";
import {
  bakeMeshSdf,
  isMeshAssetId,
  meshAsset,
  meshAssetCatalogIndex,
  sampleMeshSdf,
  sampleMeshSurface,
} from "./mesh-shapes";
import type { MeshAssetId } from "./mesh-shapes";

/** Most parts one spec may hold — the future GPU packers' fixed block size,
 * `MAX_TRANSFORMS`'s role one vocabulary over. */
export const MAX_SHAPE_PARTS = 8;

/**
 * The ONE marching safety factor every consumer steps a shape field with —
 * exported here so the trap channel, the descent term and the geometry
 * consumer share a number instead of each picking one (the
 * `sphereFoldLipschitz` discipline one family over). Analytic fields are
 * 1-Lipschitz by construction; mesh fields are conservative lower bounds.
 * The margin covers the gear seam's float-rounded hairline and GPU f32.
 */
export const SHAPE_MARCH_SAFETY = 0.9;

/** A primitive in its own frame, tagged on `kind`. */
export type ShapePrimitive =
  | { kind: "sphere"; radius: number }
  | { kind: "box"; half: Vec3 }
  /** Circle of radius `major` in the xy plane (axis z), tube radius
   * `minor`. `minor <= major` is the supported domain; a spindle torus
   * still evaluates but its sampler covers only the `major + ρcosφ > 0`
   * sheet. */
  | { kind: "torus"; major: number; minor: number }
  | { kind: "capsule"; a: Vec3; b: Vec3; radius: number }
  /** A stable built-in triangle mesh id. The document carries this id only;
   * geometry, sampler CDF and conservative SDF bake share the catalog entry
   * in `mesh-shapes.ts`. */
  | { kind: "mesh"; meshId: MeshAssetId }
  /** The brief's parametric gear: `teeth` boxes of half-size
   * `tooth = [halfRadial, halfTangential]` centered at distance `radius`
   * (the root circle) on a body disc of the same radius, axle `hole`
   * (0 = none), extruded to `±halfHeight`. Outer radius is
   * `radius + tooth[0]`. */
  | {
      kind: "gear";
      teeth: number;
      radius: number;
      tooth: [number, number];
      hole: number;
      halfHeight: number;
    };

/** A part's similarity pose. Absent fields are the identity. The posed
 * field is the exact conjugation `scale * sd(Rᵀ(p - offset) / scale)`,
 * with `R` = `affine.ts`'s `rotationMatrixXYZ` (orthonormal, so the
 * inverse is the transpose). */
export interface ShapePose {
  offset?: Vec3;
  /** Intrinsic Euler XYZ, radians — the `Transform.rotation` convention. */
  rotate?: Vec3;
  /** Uniform scale, `> 0`; non-finite or `<= 0` resolves to 1 (module
   * doc's pose-domain rule). */
  scale?: number;
}

export interface ShapePart {
  primitive: ShapePrimitive;
  /** How this part folds into the running distance: `min` / `max`.
   * Part 0 must be `"union"`. */
  combine: "union" | "intersect";
  pose?: ShapePose;
}

/** The document-facing shape: a flat posed-part list (module doc). */
export interface ShapeSpec {
  parts: ShapePart[];
}

/** Mesh ids used by one spec, de-duplicated in first-appearance order. */
export function shapeMeshIds(spec: ShapeSpec): MeshAssetId[] {
  validateShapeSpec(spec);
  const ids: MeshAssetId[] = [];
  const seen = new Set<MeshAssetId>();
  for (const part of spec.parts) {
    if (part.primitive.kind !== "mesh") continue;
    if (!seen.has(part.primitive.meshId)) {
      seen.add(part.primitive.meshId);
      ids.push(part.primitive.meshId);
    }
  }
  return ids;
}

/** Mesh ids used across several specs, with the same stable ordering. */
export function shapeSpecsMeshIds(specs: readonly ShapeSpec[]): MeshAssetId[] {
  const ids: MeshAssetId[] = [];
  const seen = new Set<MeshAssetId>();
  for (const spec of specs) {
    for (const id of shapeMeshIds(spec)) {
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
  }
  return ids;
}

/** The emission dialects. `"js"` exists so the shared template is
 * EXECUTABLE in tests against {@link shapeSdf} (the module doc's pin
 * story); production consumers pass `"glsl"` or `"wgsl"`. */
export type ShapeSdfDialect = "glsl" | "wgsl" | "js";

// --------------------------------------------------------------- validation

/** Structural validation (module doc: structure throws, numbers resolve). */
function validateShapeSpec(spec: ShapeSpec): void {
  const n = spec.parts.length;
  if (n < 1 || n > MAX_SHAPE_PARTS) {
    throw new RangeError(
      `shape spec must hold 1..${MAX_SHAPE_PARTS} parts, got ${n}`,
    );
  }
  if (spec.parts[0].combine !== "union") {
    throw new RangeError(
      `shape part 0 must combine as "union" (there is nothing yet to intersect), got "${spec.parts[0].combine}"`,
    );
  }
  for (const part of spec.parts) {
    if (
      part.primitive.kind === "mesh" &&
      !isMeshAssetId(part.primitive.meshId)
    ) {
      throw new RangeError(
        `unknown mesh asset id: ${String(part.primitive.meshId)}`,
      );
    }
  }
}

/** Non-finite or non-positive scale resolves to the identity (module doc). */
function resolvePoseScale(pose: ShapePose | undefined): number {
  const s = pose?.scale;
  return typeof s === "number" && Number.isFinite(s) && s > 0 ? s : 1;
}

/** An absent or all-zero offset is skipped — an exact no-op either way; one
 * predicate so the evaluator and the emitter skip identically. */
function poseOffset(pose: ShapePose | undefined): Vec3 | null {
  const o = pose?.offset;
  if (!o || (o[0] === 0 && o[1] === 0 && o[2] === 0)) return null;
  return o;
}

/** The pose's rotation matrix, or null when absent/zero (same skip rule —
 * `rotationMatrixXYZ(0, 0, 0)` is exactly the identity). */
function poseRotation(pose: ShapePose | undefined): number[] | null {
  const r = pose?.rotate;
  if (!r || (r[0] === 0 && r[1] === 0 && r[2] === 0)) return null;
  return rotationMatrixXYZ(r[0], r[1], r[2]);
}

/** The sector fold divides by `teeth`, so it resolves to a positive
 * integer (module doc's pose-domain rule; round, floored at 1). */
function resolveGearTeeth(teeth: number): number {
  return Number.isFinite(teeth) ? Math.max(1, Math.round(teeth)) : 1;
}

// ------------------------------------------------------------- SDF oracle

/** Mirror of the emitted `_box2` helper, operation for operation. */
function sdBox2(px: number, py: number, bx: number, by: number): number {
  const dx = Math.abs(px) - bx;
  const dy = Math.abs(py) - by;
  const ox = Math.max(dx, 0);
  const oy = Math.max(dy, 0);
  return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(dx, dy), 0);
}

/** The gear's 2D profile (body disc + folded tooth + hole), shared by the
 * 3D evaluator, the area probe and the samplers. */
function gearProfileSdf(
  prim: Extract<ShapePrimitive, { kind: "gear" }>,
  px: number,
  py: number,
): number {
  const seg = (2 * Math.PI) / resolveGearTeeth(prim.teeth);
  const lp = Math.sqrt(px * px + py * py);
  const a0 = Math.atan2(py, px) + seg * 0.5;
  const a1 = a0 - seg * Math.floor(a0 / seg) - seg * 0.5;
  const gx = Math.cos(a1) * lp - prim.radius;
  const gy = Math.sin(a1) * lp;
  let d = Math.min(
    lp - prim.radius,
    sdBox2(gx, gy, prim.tooth[0], prim.tooth[1]),
  );
  if (prim.hole > 0) d = Math.max(d, prim.hole - lp);
  return d;
}

/** One primitive's field in its own frame — exact for analytic kinds,
 * conservative for a baked mesh, and mirrored by emitted bodies. */
function primitiveSdf(
  prim: ShapePrimitive,
  x: number,
  y: number,
  z: number,
): number {
  switch (prim.kind) {
    case "sphere":
      return Math.sqrt(x * x + y * y + z * z) - prim.radius;
    case "box": {
      const dx = Math.abs(x) - prim.half[0];
      const dy = Math.abs(y) - prim.half[1];
      const dz = Math.abs(z) - prim.half[2];
      const ox = Math.max(dx, 0);
      const oy = Math.max(dy, 0);
      const oz = Math.max(dz, 0);
      return (
        Math.sqrt(ox * ox + oy * oy + oz * oz) +
        Math.min(Math.max(dx, Math.max(dy, dz)), 0)
      );
    }
    case "torus": {
      const lxy = Math.sqrt(x * x + y * y) - prim.major;
      return Math.sqrt(lxy * lxy + z * z) - prim.minor;
    }
    case "capsule": {
      const pax = x - prim.a[0];
      const pay = y - prim.a[1];
      const paz = z - prim.a[2];
      const bax = prim.b[0] - prim.a[0];
      const bay = prim.b[1] - prim.a[1];
      const baz = prim.b[2] - prim.a[2];
      // The 1e-12 floor keeps a degenerate (a == b) capsule an exact
      // sphere instead of a 0/0.
      const bb = Math.max(bax * bax + bay * bay + baz * baz, 1e-12);
      const h = Math.min(
        Math.max((pax * bax + pay * bay + paz * baz) / bb, 0),
        1,
      );
      const ex = pax - bax * h;
      const ey = pay - bay * h;
      const ez = paz - baz * h;
      return Math.sqrt(ex * ex + ey * ey + ez * ez) - prim.radius;
    }
    case "mesh":
      return sampleMeshSdf(bakeMeshSdf(prim.meshId), x, y, z);
    case "gear": {
      const g = gearProfileSdf(prim, x, y);
      const wz = Math.abs(z) - prim.halfHeight;
      const wa = Math.max(g, 0);
      const wb = Math.max(wz, 0);
      return Math.min(Math.max(g, wz), 0) + Math.sqrt(wa * wa + wb * wb);
    }
  }
}

/** One part's posed field: `scale * sd(Rᵀ(p - offset) / scale)`, with the
 * identity legs skipped (exact no-ops; same skip predicates as the
 * emitter, so the two texts compute identical values). */
function partSdf(part: ShapePart, x: number, y: number, z: number): number {
  const pose = part.pose;
  let qx = x;
  let qy = y;
  let qz = z;
  const off = poseOffset(pose);
  if (off) {
    qx -= off[0];
    qy -= off[1];
    qz -= off[2];
  }
  const rot = poseRotation(pose);
  if (rot) {
    const tx = qx;
    const ty = qy;
    const tz = qz;
    // Rᵀ · t — R is orthonormal (rotationMatrixXYZ), transpose = inverse.
    qx = rot[0] * tx + rot[3] * ty + rot[6] * tz;
    qy = rot[1] * tx + rot[4] * ty + rot[7] * tz;
    qz = rot[2] * tx + rot[5] * ty + rot[8] * tz;
  }
  const scale = resolvePoseScale(pose);
  if (scale !== 1) {
    qx /= scale;
    qy /= scale;
    qz /= scale;
  }
  const d = primitiveSdf(part.primitive, qx, qy, qz);
  return scale === 1 ? d : scale * d;
}

/**
 * The spec's signed-distance lower field at `(x, y, z)` — the CPU oracle
 * every shader emission pins to. Exact in the exterior of an analytic
 * all-union spec; conservative (never overestimating) everywhere.
 */
export function shapeSdf(
  spec: ShapeSpec,
  x: number,
  y: number,
  z: number,
): number {
  validateShapeSpec(spec);
  let d = partSdf(spec.parts[0], x, y, z);
  for (let i = 1; i < spec.parts.length; i++) {
    const part = spec.parts[i];
    const di = partSdf(part, x, y, z);
    d = part.combine === "intersect" ? Math.max(d, di) : Math.min(d, di);
  }
  return d;
}

// --------------------------------------------------------------- bounding

/** A primitive's own conservative radius about its local origin. */
function primitiveBound(prim: ShapePrimitive): number {
  switch (prim.kind) {
    case "sphere":
      return Math.max(prim.radius, 0);
    case "box":
      return Math.hypot(prim.half[0], prim.half[1], prim.half[2]);
    case "torus":
      return prim.major + prim.minor;
    case "capsule":
      return (
        Math.max(
          Math.hypot(prim.a[0], prim.a[1], prim.a[2]),
          Math.hypot(prim.b[0], prim.b[1], prim.b[2]),
        ) + prim.radius
      );
    case "mesh":
      return meshAsset(prim.meshId).bounds.radius;
    case "gear":
      // The farthest member is a tooth-box corner: radially radius + t0,
      // tangentially t1, axially halfHeight — attained, so this bound is
      // tight, not merely valid.
      return Math.hypot(
        prim.radius + prim.tooth[0],
        prim.tooth[1],
        prim.halfHeight,
      );
  }
}

/**
 * Conservative radius of a ball about the ORIGIN containing the whole
 * shape: the max over UNION parts of `scale * primitiveBound + |offset|`
 * (rotation preserves length; an `"intersect"` part only ever shrinks the
 * folded set, so union parts alone bound it).
 */
export function shapeBoundingRadius(spec: ShapeSpec): number {
  validateShapeSpec(spec);
  let best = 0;
  for (const part of spec.parts) {
    if (part.combine !== "union") continue;
    const scale = resolvePoseScale(part.pose);
    const off = part.pose?.offset;
    const reach =
      scale * primitiveBound(part.primitive) +
      (off ? Math.hypot(off[0], off[1], off[2]) : 0);
    if (reach > best) best = reach;
  }
  return best;
}

// ---------------------------------------------------------------- sampler

export interface ShapeSamplerOptions {
  /** Sample gear parts on the 2D profile OUTLINE (extruded — the brief's
   * wireframe look) instead of by area; other primitives unaffected. */
  gearOutline?: boolean;
}

/** Fixed budget/seed for the gear profile's prepare-time Monte Carlo
 * measures, so a given spec always builds the same tables
 * (`set-extent.ts`'s seeded-instrument discipline). */
const GEAR_MEASURE_SAMPLES = 65536;
const GEAR_MEASURE_SEED = 0x9ea2c0f5;
/** Width of the gear-outline rejection band, as a fraction of the outer
 * radius — also the scale of the outline sampler's disclosed corner bias. */
const GEAR_OUTLINE_BAND = 0.05;
/** A projected outline point must land this close (relative to the outer
 * radius) to the zero set or be redrawn, so the outline sampler's output
 * bound holds by construction. */
const GEAR_OUTLINE_TOL = 1e-9;

/** Uniform draw in the unit ball (cbrt radius, cos-uniform polar —
 * `set-extent.ts`'s own draw, term for term). */
function drawBall(rng: Rng): Vec3 {
  const r = Math.cbrt(rng());
  const ct = 2 * rng() - 1;
  const st = Math.sqrt(Math.max(0, 1 - ct * ct));
  const ph = 2 * Math.PI * rng();
  return [r * st * Math.cos(ph), r * st * Math.sin(ph), r * ct];
}

/** The gear profile's area (and, banded, its perimeter), by a seeded
 * fixed-budget Monte Carlo over the bounding annulus at prepare time. */
function gearProfileMeasures(prim: Extract<ShapePrimitive, { kind: "gear" }>): {
  area: number;
  perimeter: number;
} {
  const outer = prim.radius + prim.tooth[0];
  const hole = prim.hole > 0 ? prim.hole : 0;
  const band = outer * GEAR_OUTLINE_BAND;
  const rMax = outer + band;
  const rng = mulberry32(GEAR_MEASURE_SEED);
  let areaHits = 0;
  let bandHits = 0;
  for (let i = 0; i < GEAR_MEASURE_SAMPLES; i++) {
    // Area-uniform in the disc of radius rMax (covers the hole interior,
    // whose wall is part of the outline band too).
    const r = rMax * Math.sqrt(rng());
    const th = 2 * Math.PI * rng();
    const d = gearProfileSdf(prim, r * Math.cos(th), r * Math.sin(th));
    if (d <= 0 && r >= hole && r <= outer) areaHits++;
    if (d > 0 && d <= band) bandHits++;
  }
  const discArea = Math.PI * rMax * rMax;
  return {
    area: (areaHits / GEAR_MEASURE_SAMPLES) * discArea,
    // The one-sided exterior band has area ≈ perimeter · band.
    perimeter: ((bandHits / GEAR_MEASURE_SAMPLES) * discArea) / band,
  };
}

/** Exact local-frame draw for one solid primitive (module doc lists each
 * scheme). Unbounded redraws are policy — see the module doc. */
function primitiveDraw(prim: ShapePrimitive): (rng: Rng) => Vec3 {
  switch (prim.kind) {
    case "sphere":
      return (rng) => {
        const [x, y, z] = drawBall(rng);
        return [x * prim.radius, y * prim.radius, z * prim.radius];
      };
    case "box":
      return (rng) => [
        (2 * rng() - 1) * prim.half[0],
        (2 * rng() - 1) * prim.half[1],
        (2 * rng() - 1) * prim.half[2],
      ];
    case "torus":
      return (rng) => {
        for (;;) {
          const th = 2 * Math.PI * rng();
          const rho = prim.minor * Math.sqrt(rng());
          const phi = 2 * Math.PI * rng();
          const rad = prim.major + rho * Math.cos(phi);
          if (rad <= 0) continue;
          // The (R + ρcosφ) density weight: accept ∝ distance from the
          // axis, which is exactly the solid torus's volume element.
          if (rng() * (prim.major + prim.minor) >= rad) continue;
          return [rad * Math.cos(th), rad * Math.sin(th), rho * Math.sin(phi)];
        }
      };
    case "capsule": {
      const bax = prim.b[0] - prim.a[0];
      const bay = prim.b[1] - prim.a[1];
      const baz = prim.b[2] - prim.a[2];
      const len = Math.hypot(bax, bay, baz);
      const wz: Vec3 = len > 0 ? [bax / len, bay / len, baz / len] : [0, 0, 1];
      // Any orthonormal completion of wz.
      const pick: Vec3 = Math.abs(wz[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      const ux = wz[1] * pick[2] - wz[2] * pick[1];
      const uy = wz[2] * pick[0] - wz[0] * pick[2];
      const uz = wz[0] * pick[1] - wz[1] * pick[0];
      const ul = Math.hypot(ux, uy, uz);
      const u: Vec3 = [ux / ul, uy / ul, uz / ul];
      const v: Vec3 = [
        wz[1] * u[2] - wz[2] * u[1],
        wz[2] * u[0] - wz[0] * u[2],
        wz[0] * u[1] - wz[1] * u[0],
      ];
      const r = prim.radius;
      const vCyl = Math.PI * r * r * len;
      const vCaps = (4 / 3) * Math.PI * r * r * r;
      return (rng) => {
        if (rng() * (vCyl + vCaps) < vCyl) {
          // Cylinder body: axial uniform, disc cross-section.
          const t = rng() * len;
          const rho = r * Math.sqrt(rng());
          const phi = 2 * Math.PI * rng();
          const cx = rho * Math.cos(phi);
          const cy = rho * Math.sin(phi);
          return [
            prim.a[0] + wz[0] * t + u[0] * cx + v[0] * cy,
            prim.a[1] + wz[1] * t + u[1] * cx + v[1] * cy,
            prim.a[2] + wz[2] * t + u[2] * cx + v[2] * cy,
          ];
        }
        // The two caps together are one full ball, split by the axial
        // plane: attach the +axial half to b, the -axial half to a.
        const [sx, sy, sz] = drawBall(rng);
        const bx = sx * r;
        const by = sy * r;
        const bz = sz * r;
        const axial = bx * wz[0] + by * wz[1] + bz * wz[2];
        const end = axial >= 0 ? prim.b : prim.a;
        return [end[0] + bx, end[1] + by, end[2] + bz];
      };
    }
    case "mesh":
      return (rng) => sampleMeshSurface(meshAsset(prim.meshId), rng);
    case "gear": {
      const outer = prim.radius + prim.tooth[0];
      const hole = prim.hole > 0 ? prim.hole : 0;
      const lo2 = hole * hole;
      const span2 = outer * outer - lo2;
      return (rng) => {
        for (;;) {
          // Area-uniform in the bounding annulus [hole, outer].
          const r = Math.sqrt(lo2 + rng() * span2);
          const th = 2 * Math.PI * rng();
          const x = r * Math.cos(th);
          const y = r * Math.sin(th);
          if (gearProfileSdf(prim, x, y) > 0) continue;
          return [x, y, (2 * rng() - 1) * prim.halfHeight];
        }
      };
    }
  }
}

/** The gear-outline draw: an exterior band point projected onto the 2D
 * profile's zero set (module doc's scheme and disclosures). */
function gearOutlineDraw(
  prim: Extract<ShapePrimitive, { kind: "gear" }>,
): (rng: Rng) => Vec3 {
  const outer = prim.radius + prim.tooth[0];
  const band = outer * GEAR_OUTLINE_BAND;
  const rMax = outer + band;
  const h = outer * 1e-6;
  const tol = outer * GEAR_OUTLINE_TOL;
  return (rng) => {
    for (;;) {
      const r = rMax * Math.sqrt(rng());
      const th = 2 * Math.PI * rng();
      let x = r * Math.cos(th);
      let y = r * Math.sin(th);
      let d = gearProfileSdf(prim, x, y);
      // Exterior band only: there the min-union field is the exact
      // distance, so one gradient step lands on the boundary.
      if (d <= 0 || d > band) continue;
      for (let k = 0; k < 4 && Math.abs(d) > tol; k++) {
        const gx =
          (gearProfileSdf(prim, x + h, y) - gearProfileSdf(prim, x - h, y)) /
          (2 * h);
        const gy =
          (gearProfileSdf(prim, x, y + h) - gearProfileSdf(prim, x, y - h)) /
          (2 * h);
        const gl = Math.hypot(gx, gy);
        if (gl === 0) break;
        x -= (d * gx) / gl;
        y -= (d * gy) / gl;
        d = gearProfileSdf(prim, x, y);
      }
      // A corner straddle that failed to converge is redrawn, so the
      // |sdf| bound on delivered points holds by construction.
      if (Math.abs(d) > tol) continue;
      return [x, y, (2 * rng() - 1) * prim.halfHeight];
    }
  };
}

/** A primitive's closed-form volume (gear: measured — see
 * {@link gearProfileMeasures}); negative/degenerate params floor at 0. */
function primitiveVolume(prim: ShapePrimitive): number {
  switch (prim.kind) {
    case "sphere":
      return Math.max(0, (4 / 3) * Math.PI * prim.radius ** 3);
    case "box":
      return Math.max(0, 8 * prim.half[0] * prim.half[1] * prim.half[2]);
    case "torus":
      return Math.max(0, 2 * Math.PI * Math.PI * prim.major * prim.minor ** 2);
    case "capsule": {
      const len = Math.hypot(
        prim.b[0] - prim.a[0],
        prim.b[1] - prim.a[1],
        prim.b[2] - prim.a[2],
      );
      const r = Math.max(0, prim.radius);
      return Math.PI * r * r * len + (4 / 3) * Math.PI * r ** 3;
    }
    case "mesh":
      // Mesh parts use SURFACE measure in prepareShapeSampler, never this
      // volume path. Returning the native area keeps this total if a future
      // caller asks for the primitive's own authored measure directly.
      return meshAsset(prim.meshId).totalArea;
    case "gear":
      return Math.max(0, gearProfileMeasures(prim).area * 2 * prim.halfHeight);
  }
}

/**
 * Build the spec's point sampler (module doc: analytic solids use volume,
 * mesh/outline parts use surface measure, and overlap between volume parts
 * uses min-index acceptance). Surface candidates are always accepted and
 * never contain another candidate, so their contribution is independent of
 * authored part order. Throws on any `"intersect"` part (the spec is then
 * SDF-only; see the module doc for why no exact per-part scheme exists) and
 * on a spec with no measure. The returned closure draws from the caller's
 * `rng` — unboundedly, by documented policy.
 */
export function prepareShapeSampler(
  spec: ShapeSpec,
  opts?: ShapeSamplerOptions,
): (rng: Rng) => Vec3 {
  validateShapeSpec(spec);
  for (const part of spec.parts) {
    if (part.combine === "intersect") {
      throw new Error(
        'shape sampler: an "intersect" part makes the spec SDF-only — ' +
          "uniform sampling of an intersection fold has no exact per-part " +
          "scheme (see shapes.ts's module doc)",
      );
    }
  }
  const gearOutline = opts?.gearOutline === true;
  const parts = spec.parts.map((part) => {
    const primitive = part.primitive;
    const scale = resolvePoseScale(part.pose);
    const rot = poseRotation(part.pose);
    const off = part.pose?.offset;
    const outline = gearOutline && primitive.kind === "gear";
    const meshSurface = primitive.kind === "mesh";
    let weight: number;
    if (primitive.kind === "mesh") {
      weight = meshAsset(primitive.meshId).totalArea * scale * scale;
    } else if (outline) {
      const gear = part.primitive as Extract<ShapePrimitive, { kind: "gear" }>;
      const lateral = gearProfileMeasures(gear).perimeter * 2 * gear.halfHeight;
      weight = Math.max(0, lateral) * scale * scale;
    } else {
      weight = primitiveVolume(primitive) * scale ** 3;
    }
    const draw = outline
      ? gearOutlineDraw(
          part.primitive as Extract<ShapePrimitive, { kind: "gear" }>,
        )
      : primitiveDraw(primitive);
    const toWorld = (p: Vec3): Vec3 => {
      let x = p[0] * scale;
      let y = p[1] * scale;
      let z = p[2] * scale;
      if (rot) {
        const tx = x;
        const ty = y;
        const tz = z;
        x = rot[0] * tx + rot[1] * ty + rot[2] * tz;
        y = rot[3] * tx + rot[4] * ty + rot[5] * tz;
        z = rot[6] * tx + rot[7] * ty + rot[8] * tz;
      }
      if (off) {
        x += off[0];
        y += off[1];
        z += off[2];
      }
      return [x, y, z];
    };
    // Surface measures stay independent of the volume union: they neither
    // contain another candidate nor get shadowed by an earlier solid.
    const surfaceMeasure = outline || meshSurface;
    const contains = surfaceMeasure
      ? () => false
      : (x: number, y: number, z: number) => partSdf(part, x, y, z) <= 0;
    return { weight, draw, toWorld, contains, surfaceMeasure };
  });
  const total = parts.reduce((acc, p) => acc + p.weight, 0);
  if (!(total > 0)) {
    throw new Error("shape sampler: the spec has no measure to sample");
  }
  return (rng: Rng): Vec3 => {
    for (;;) {
      let pick = rng() * total;
      let index = 0;
      for (; index < parts.length - 1; index++) {
        pick -= parts[index].weight;
        if (pick < 0) break;
      }
      const candidate = parts[index].toWorld(parts[index].draw(rng));
      // A surface draw is one sample from an independent authored measure,
      // not volume that an earlier solid can own.
      if (parts[index].surfaceMeasure) return candidate;
      let shadowed = false;
      for (let j = 0; j < index; j++) {
        if (parts[j].contains(candidate[0], candidate[1], candidate[2])) {
          shadowed = true;
          break;
        }
      }
      if (!shadowed) return candidate;
    }
  };
}

// ---------------------------------------------------------------- emission

/** One dialect's token table — `background-shape.ts`'s discipline: the
 * math text is ONE template, only these spellings differ. */
interface ShapeDialect {
  language: ShapeSdfDialect;
  /** Immutable scalar local declaration keyword (bodies are SSA). */
  decl: string;
  /** Intrinsic spelling (js prefixes `Math.`). */
  call: (name: string) => string;
  /** The two-argument arctangent's NAME — the one intrinsic whose name
   * itself differs: GLSL `atan(y, x)`, WGSL `atan2(y, x)`. */
  atan2: string;
}

const SHAPE_DIALECTS: Record<ShapeSdfDialect, ShapeDialect> = {
  glsl: { language: "glsl", decl: "float", call: (n) => n, atan2: "atan" },
  wgsl: { language: "wgsl", decl: "let", call: (n) => n, atan2: "atan2" },
  js: {
    language: "js",
    decl: "let",
    call: (n) => `Math.${n}`,
    atan2: "Math.atan2",
  },
};

/** A baked constant as a float literal valid in every dialect: `String(x)`
 * round-trips f64 exactly, and a bare integer gains `.0` so GLSL/WGSL read
 * it as a float. Throws on non-finite rather than emit `NaN`. */
function lit(x: number): string {
  if (!Number.isFinite(x)) {
    throw new Error(`shape codegen: non-finite baked constant (${x})`);
  }
  const s = String(x);
  return /[.e]/.test(s) ? s : `${s}.0`;
}

function helperSignature(
  d: ShapeDialect,
  fnName: string,
  params: string[],
): string {
  switch (d.language) {
    case "glsl":
      return `float ${fnName}(${params.map((p) => `float ${p}`).join(", ")}) {`;
    case "wgsl":
      return `fn ${fnName}(${params.map((p) => `${p}: f32`).join(", ")}) -> f32 {`;
    case "js":
      return `function ${fnName}(${params.join(", ")}) {`;
  }
}

function emitBox2(d: ShapeDialect, name: string): string {
  const L = d.decl;
  const F = d.call;
  return [
    helperSignature(d, `${name}_box2`, ["px", "py", "bx", "by"]),
    `  ${L} dx = ${F("abs")}(px) - bx;`,
    `  ${L} dy = ${F("abs")}(py) - by;`,
    `  ${L} ox = ${F("max")}(dx, 0.0);`,
    `  ${L} oy = ${F("max")}(dy, 0.0);`,
    `  return ${F("sqrt")}(ox * ox + oy * oy) + ${F("min")}(${F("max")}(dx, dy), 0.0);`,
    `}`,
  ].join("\n");
}

function emitBox3(d: ShapeDialect, name: string): string {
  const L = d.decl;
  const F = d.call;
  return [
    helperSignature(d, `${name}_box3`, ["px", "py", "pz", "bx", "by", "bz"]),
    `  ${L} dx = ${F("abs")}(px) - bx;`,
    `  ${L} dy = ${F("abs")}(py) - by;`,
    `  ${L} dz = ${F("abs")}(pz) - bz;`,
    `  ${L} ox = ${F("max")}(dx, 0.0);`,
    `  ${L} oy = ${F("max")}(dy, 0.0);`,
    `  ${L} oz = ${F("max")}(dz, 0.0);`,
    `  return ${F("sqrt")}(ox * ox + oy * oy + oz * oz) + ${F("min")}(${F("max")}(dx, ${F("max")}(dy, dz)), 0.0);`,
    `}`,
  ].join("\n");
}

function emitTorus(d: ShapeDialect, name: string): string {
  const L = d.decl;
  const F = d.call;
  return [
    helperSignature(d, `${name}_torus`, ["px", "py", "pz", "ma", "mi"]),
    `  ${L} lxy = ${F("sqrt")}(px * px + py * py) - ma;`,
    `  return ${F("sqrt")}(lxy * lxy + pz * pz) - mi;`,
    `}`,
  ].join("\n");
}

function emitCapsule(d: ShapeDialect, name: string): string {
  const L = d.decl;
  const F = d.call;
  return [
    helperSignature(d, `${name}_capsule`, [
      "px",
      "py",
      "pz",
      "ax",
      "ay",
      "az",
      "bx",
      "by",
      "bz",
      "cr",
    ]),
    `  ${L} pax = px - ax;`,
    `  ${L} pay = py - ay;`,
    `  ${L} paz = pz - az;`,
    `  ${L} bax = bx - ax;`,
    `  ${L} bay = by - ay;`,
    `  ${L} baz = bz - az;`,
    `  ${L} bb = ${F("max")}(bax * bax + bay * bay + baz * baz, 1e-12);`,
    `  ${L} ch = ${F("min")}(${F("max")}((pax * bax + pay * bay + paz * baz) / bb, 0.0), 1.0);`,
    `  ${L} ex = pax - bax * ch;`,
    `  ${L} ey = pay - bay * ch;`,
    `  ${L} ez = paz - baz * ch;`,
    `  return ${F("sqrt")}(ex * ex + ey * ey + ez * ez) - cr;`,
    `}`,
  ].join("\n");
}

function emitGear2(d: ShapeDialect, name: string): string {
  const L = d.decl;
  const F = d.call;
  return [
    helperSignature(d, `${name}_gear2`, ["px", "py", "gr", "seg", "tr", "tt"]),
    `  ${L} lp = ${F("sqrt")}(px * px + py * py);`,
    `  ${L} a0 = ${d.atan2}(py, px) + seg * 0.5;`,
    // Explicit floor-mod: GLSL mod() floors but WGSL % truncates, so the
    // one template spells the fold out (module doc's sharp-edge table).
    `  ${L} a1 = a0 - seg * ${F("floor")}(a0 / seg) - seg * 0.5;`,
    `  ${L} gx = ${F("cos")}(a1) * lp - gr;`,
    `  ${L} gy = ${F("sin")}(a1) * lp;`,
    `  return ${F("min")}(lp - gr, ${name}_box2(gx, gy, tr, tt));`,
    `}`,
  ].join("\n");
}

/** One part's lines in the main body: baked pose prologue, primitive call,
 * scale-back — SSA locals suffixed by the part index. Returns the value
 * variable the fold reads. */
function emitPartLines(
  part: ShapePart,
  i: number,
  d: ShapeDialect,
  name: string,
): { lines: string[]; value: string } {
  const L = d.decl;
  const F = d.call;
  const lines: string[] = [];
  let X = "px";
  let Y = "py";
  let Z = "pz";
  const off = poseOffset(part.pose);
  if (off) {
    lines.push(`  ${L} tx${i} = ${X} - ${lit(off[0])};`);
    lines.push(`  ${L} ty${i} = ${Y} - ${lit(off[1])};`);
    lines.push(`  ${L} tz${i} = ${Z} - ${lit(off[2])};`);
    X = `tx${i}`;
    Y = `ty${i}`;
    Z = `tz${i}`;
  }
  const rot = poseRotation(part.pose);
  if (rot) {
    // Rᵀ baked entry for entry (partSdf's own multiply, same order).
    lines.push(
      `  ${L} rx${i} = ${lit(rot[0])} * ${X} + ${lit(rot[3])} * ${Y} + ${lit(rot[6])} * ${Z};`,
    );
    lines.push(
      `  ${L} ry${i} = ${lit(rot[1])} * ${X} + ${lit(rot[4])} * ${Y} + ${lit(rot[7])} * ${Z};`,
    );
    lines.push(
      `  ${L} rz${i} = ${lit(rot[2])} * ${X} + ${lit(rot[5])} * ${Y} + ${lit(rot[8])} * ${Z};`,
    );
    X = `rx${i}`;
    Y = `ry${i}`;
    Z = `rz${i}`;
  }
  const scale = resolvePoseScale(part.pose);
  if (scale !== 1) {
    lines.push(`  ${L} qx${i} = ${X} / ${lit(scale)};`);
    lines.push(`  ${L} qy${i} = ${Y} / ${lit(scale)};`);
    lines.push(`  ${L} qz${i} = ${Z} / ${lit(scale)};`);
    X = `qx${i}`;
    Y = `qy${i}`;
    Z = `qz${i}`;
  }
  const prim = part.primitive;
  switch (prim.kind) {
    case "sphere":
      lines.push(
        `  ${L} u${i} = ${F("sqrt")}(${X} * ${X} + ${Y} * ${Y} + ${Z} * ${Z}) - ${lit(prim.radius)};`,
      );
      break;
    case "box":
      lines.push(
        `  ${L} u${i} = ${name}_box3(${X}, ${Y}, ${Z}, ${lit(prim.half[0])}, ${lit(prim.half[1])}, ${lit(prim.half[2])});`,
      );
      break;
    case "torus":
      lines.push(
        `  ${L} u${i} = ${name}_torus(${X}, ${Y}, ${Z}, ${lit(prim.major)}, ${lit(prim.minor)});`,
      );
      break;
    case "capsule":
      lines.push(
        `  ${L} u${i} = ${name}_capsule(${X}, ${Y}, ${Z}, ${lit(prim.a[0])}, ${lit(prim.a[1])}, ${lit(prim.a[2])}, ${lit(prim.b[0])}, ${lit(prim.b[1])}, ${lit(prim.b[2])}, ${lit(prim.radius)});`,
      );
      break;
    case "mesh": {
      const catalogIndex = meshAssetCatalogIndex(prim.meshId);
      let call: string;
      switch (d.language) {
        case "glsl":
          call = `shapeMeshSdf(${catalogIndex}, vec3(${X}, ${Y}, ${Z}))`;
          break;
        case "wgsl":
          call = `shapeMeshSdf(${catalogIndex}u, vec3f(${X}, ${Y}, ${Z}))`;
          break;
        case "js":
          call = `shapeMeshSdf(${catalogIndex}, ${X}, ${Y}, ${Z})`;
          break;
      }
      lines.push(`  ${L} u${i} = ${call};`);
      break;
    }
    case "gear": {
      const seg = (2 * Math.PI) / resolveGearTeeth(prim.teeth);
      lines.push(
        `  ${L} g${i} = ${name}_gear2(${X}, ${Y}, ${lit(prim.radius)}, ${lit(seg)}, ${lit(prim.tooth[0])}, ${lit(prim.tooth[1])});`,
      );
      let g = `g${i}`;
      if (prim.hole > 0) {
        // Absent when hole = 0 — the term's omission IS "none" (module doc).
        lines.push(
          `  ${L} gh${i} = ${F("max")}(g${i}, ${lit(prim.hole)} - ${F("sqrt")}(${X} * ${X} + ${Y} * ${Y}));`,
        );
        g = `gh${i}`;
      }
      lines.push(
        `  ${L} wz${i} = ${F("abs")}(${Z}) - ${lit(prim.halfHeight)};`,
      );
      lines.push(`  ${L} wa${i} = ${F("max")}(${g}, 0.0);`);
      lines.push(`  ${L} wb${i} = ${F("max")}(wz${i}, 0.0);`);
      lines.push(
        `  ${L} u${i} = ${F("min")}(${F("max")}(${g}, wz${i}), 0.0) + ${F("sqrt")}(wa${i} * wa${i} + wb${i} * wb${i});`,
      );
      break;
    }
  }
  if (scale !== 1) {
    lines.push(`  ${L} s${i} = ${lit(scale)} * u${i};`);
    return { lines, value: `s${i}` };
  }
  return { lines, value: `u${i}` };
}

/**
 * Emit the spec's whole SDF as one self-contained function named `name` —
 * per-spec baked-constant codegen from ONE scalar template, in the given
 * dialect (module doc's emission section: no params wire, `"js"` is the
 * executable pin's dialect). Helpers are emitted once per source, prefixed
 * `${name}_`, so two emitted shapes cannot collide in one shader.
 */
export function shapeSdfSource(
  spec: ShapeSpec,
  dialect: ShapeSdfDialect,
  name: string,
): string {
  validateShapeSpec(spec);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`shape codegen: "${name}" is not a plain identifier`);
  }
  const d = SHAPE_DIALECTS[dialect];
  const L = d.decl;
  const used = {
    box2: false,
    box3: false,
    torus: false,
    capsule: false,
    gear2: false,
  };
  for (const part of spec.parts) {
    switch (part.primitive.kind) {
      case "box":
        used.box3 = true;
        break;
      case "torus":
        used.torus = true;
        break;
      case "capsule":
        used.capsule = true;
        break;
      case "mesh":
        // The consumer emits one shared shapeMeshSdf atlas helper. A shape
        // function only calls it with the baked catalog index.
        break;
      case "gear":
        used.box2 = true;
        used.gear2 = true;
        break;
      case "sphere":
        break;
    }
  }
  const chunks: string[] = [];
  if (used.box2) chunks.push(emitBox2(d, name));
  if (used.box3) chunks.push(emitBox3(d, name));
  if (used.torus) chunks.push(emitTorus(d, name));
  if (used.capsule) chunks.push(emitCapsule(d, name));
  if (used.gear2) chunks.push(emitGear2(d, name));

  const main: string[] = [];
  switch (d.language) {
    case "glsl":
      main.push(`float ${name}(vec3 p) {`);
      main.push(`  float px = p.x;`, `  float py = p.y;`, `  float pz = p.z;`);
      break;
    case "wgsl":
      main.push(`fn ${name}(p: vec3f) -> f32 {`);
      main.push(`  let px = p.x;`, `  let py = p.y;`, `  let pz = p.z;`);
      break;
    case "js":
      main.push(`function ${name}(px, py, pz) {`);
      break;
  }
  spec.parts.forEach((part, i) => {
    const { lines, value } = emitPartLines(part, i, d, name);
    main.push(...lines);
    if (i === 0) {
      main.push(`  ${L} d0 = ${value};`);
    } else {
      const fold = part.combine === "intersect" ? "max" : "min";
      main.push(`  ${L} d${i} = ${d.call(fold)}(d${i - 1}, ${value});`);
    }
  });
  main.push(`  return d${spec.parts.length - 1};`);
  main.push(`}`);
  chunks.push(main.join("\n"));
  return `${chunks.join("\n")}\n`;
}

// ------------------------------------------------------- reference shapes

/**
 * Orbit Ring: a deliberately chunky analytic torus that stays legible in the
 * compact transform picker workflows and low-resolution previews. Its outer
 * radius is 1.04 and its inner radius is 0.52, keeping it on the same roughly
 * unit scale as the other bundled shapes without collapsing the central hole.
 */
export const ORBIT_RING_SHAPE: ShapeSpec = {
  parts: [
    {
      primitive: { kind: "torus", major: 0.78, minor: 0.26 },
      combine: "union",
    },
  ],
};

/**
 * The reference composition: the addendum's peace sign — the ring, the
 * full vertical bar, and the two lower diagonal legs, all tubes of one
 * radius in the xy plane so the icon faces +z. The diagonal legs run from
 * the center to the ring at ±45° below the horizontal, and every capsule
 * end lies ON the ring's centerline circle, so the caps finish flush with
 * the ring's own outer edge.
 */
export const PEACE_SIGN_SHAPE: ShapeSpec = {
  parts: [
    {
      primitive: { kind: "torus", major: 1, minor: 0.12 },
      combine: "union",
    },
    {
      primitive: { kind: "capsule", a: [0, -1, 0], b: [0, 1, 0], radius: 0.12 },
      combine: "union",
    },
    {
      primitive: {
        kind: "capsule",
        a: [0, 0, 0],
        b: [-Math.SQRT1_2, -Math.SQRT1_2, 0],
        radius: 0.12,
      },
      combine: "union",
    },
    {
      primitive: {
        kind: "capsule",
        a: [0, 0, 0],
        b: [Math.SQRT1_2, -Math.SQRT1_2, 0],
        radius: 0.12,
      },
      combine: "union",
    },
  ],
};

/** The flagship parametric: an eight-tooth gear with an axle hole —
 * root circle 1, outer radius 1.22, bore 0.35, thickness 0.5. */
export const GEAR_SHAPE: ShapeSpec = {
  parts: [
    {
      primitive: {
        kind: "gear",
        teeth: 8,
        radius: 1,
        tooth: [0.22, 0.16],
        hole: 0.35,
        halfHeight: 0.25,
      },
      combine: "union",
    },
  ],
};

/** The built-in five-point star prism mesh. The document carries only this
 * stable catalog id; triangle data and the conservative SDF bake remain in
 * `mesh-shapes.ts`. Kept beside {@link GEAR_SHAPE} so presets and authoring
 * controls share one canonical ShapeSpec instead of recreating it. */
export const STAR_PRISM_SHAPE: ShapeSpec = {
  parts: [
    {
      primitive: { kind: "mesh", meshId: "star-prism-v1" },
      combine: "union",
    },
  ],
};

/** The bundled low-poly crystal, referenced only by its stable catalog id. */
export const FACETED_CRYSTAL_SHAPE: ShapeSpec = {
  parts: [
    {
      primitive: { kind: "mesh", meshId: "faceted-crystal-v1" },
      combine: "union",
    },
  ],
};

/** The bundled extruded heart, referenced only by its stable catalog id. */
export const HEART_PRISM_SHAPE: ShapeSpec = {
  parts: [
    {
      primitive: { kind: "mesh", meshId: "heart-prism-v1" },
      combine: "union",
    },
  ],
};

/** The bundled crescent moon, referenced only by its stable catalog id. */
export const CRESCENT_MOON_SHAPE: ShapeSpec = {
  parts: [
    {
      primitive: { kind: "mesh", meshId: "crescent-moon-v1" },
      combine: "union",
    },
  ],
};

/** The bundled snowflake prism, referenced only by its stable catalog id. */
export const SNOWFLAKE_PRISM_SHAPE: ShapeSpec = {
  parts: [
    {
      primitive: { kind: "mesh", meshId: "snowflake-prism-v1" },
      combine: "union",
    },
  ],
};

/** The bundled trefoil knot, referenced only by its stable catalog id. */
export const TREFOIL_KNOT_SHAPE: ShapeSpec = {
  parts: [
    {
      primitive: { kind: "mesh", meshId: "trefoil-knot-v1" },
      combine: "union",
    },
  ],
};
