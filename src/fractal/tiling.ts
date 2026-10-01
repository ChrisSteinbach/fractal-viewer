import type { ShapeSpec } from "./shapes";
import {
  resolveLatticePresentation,
  type LatticePresentationPolicy,
  type ResolvedLatticePresentation,
} from "./lattice-march";
import type { Vec3, Vec4 } from "./types";

/**
 * The shared space-tiling vocabulary for both shipped constructions
 * (`docs/tiling-contract.md` is the frozen record). This module owns the
 * document-facing {@link TilingSpec}, the ONE resolver
 * ({@link resolveTiling}), the finite group tables
 * ({@link TILING_GROUP_INFO}), the reflection primitive
 * ({@link reflectAcrossWall}), the fold-to-chamber retraction
 * ({@link foldToChamber}) with its proven step bound, chamber distance
 * ({@link chamberDistance}), and the slow explicit orbit enumerator
 * ({@link enumerateOrbit}) that is the finite fold's TEST ORACLE, and the
 * mirrored affine-A1 scalar/vector folds.
 *
 * THE FINITE RENDERED SET is
 *
 *     T = G·S,   S = A ∩ C ∩ clip
 *
 * — `G` the group, `C` its fundamental chamber (a Coxeter orthoscheme,
 * the cell of the tiling), `A` the attractor (NOT this module's concern),
 * `clip` an optional narrowing {@link ShapeSpec} (intersection only
 * narrows, so an authored clip can never widen `S`). The soundness chain
 * is the NEAREST-COPY THEOREM (`docs/tiling-contract.md`): for `F` the
 * fold,
 *
 *     d(q, T) = d(F(q), S)
 *
 * — the copy nearest any query is always the one in the query's own
 * chamber, and the fold is a metric retraction toward `S` (each wall
 * reflection reduces the squared distance to every `s ∈ C` by
 * `4⟨m, n_i⟩⟨s, n_i⟩ ≥ 0`). The estimator composition is therefore
 * `max(DE(F(q)), clipDist(F(q)))`, the chamber entering ONLY through the
 * fold — the wall distance is deliberately not a term, and the contract
 * records why (unsound as a max, false geometry as a min).
 *
 * THE MIRRORED-LATTICE SET is `L·S`, with
 * `S = A ∩ ball(0,R) ∩ clip`. `L` mirrors attractor-frame x/z in 3D and
 * x/z/w in 4D, leaving y unchanged. The resolver requires an authored
 * `cellScale >= 1` and an estimator-owned, certified origin-centred visible
 * radius `R > 0`, then derives the half-cell `h = cellScale·R`. The public
 * estimator is `max(DE(F(q)), length(F(q)) - R, clipDist(F(q)))`. Product
 * reflections are isometries and metric retractions toward the closed cell,
 * so the same nearest-copy theorem applies to this infinite group. Cell walls
 * are NEVER distance terms: the mirrored value is continuous at a seam and
 * only its derivative changes sign. No default, narrower authored range,
 * presentation radius or veil ratio is implied here.
 *
 * THE FINITE FOLD'S BOUND IS PROVEN, not assumed. A point `q` in the chamber
 * `w(C)` that violates a simple wall `i` (`⟨q, n_i⟩ < 0`) satisfies
 * `l(s_i w) < l(w)` — the classical simple-root criterion, since a chamber
 * sits entirely on one side of every wall hyperplane — so every reflection
 * strictly shortens the chamber's word and the fold lands in `C` in at
 * most the group's `maxWordLength` steps (A3 6, B3 9, H3 15, A4 10, B4 16,
 * F4 24 — the sum of exponents, the longest element's length).
 * {@link MAX_TILING_FOLD_STEPS} is the 32 cap: the proven 24 plus an f32
 * wall-jitter margin (at a wall the pairings oscillate at f32 noise, so a
 * few extra bounces are possible). An expired fold returns null and the
 * caller's estimator reads 0 — fully conservative, never an overshoot, and
 * by the proof it never fires. The stop test accepts a small negative
 * tolerance (`⟨q, n_i⟩ ≥ −{@link FOLD_EPS}`, 1e-6 world units) so an
 * f32-folded point sitting ε-outside the chamber is accepted; the soundness
 * gap this opens is bounded by `2·FOLD_EPS` (sub-pixel), and the CPU oracle
 * shares the constant so CPU/GPU agree.
 *
 * FINITE ROOT CONVENTIONS, frozen: unit inward normals `n_i` with pairings
 * `⟨n_i, n_j⟩ = −cos(π/m_ij)` from the Coxeter diagram (m_ij = 3 → −1/2,
 * 4 → −√2/2, 5 → −φ/2 with φ the golden ratio; non-adjacent pairs have
 * m_ij = 2 → 0), so the closed chamber is exactly
 * `C = {x : ⟨x, n_i⟩ ≥ 0 ∀i}`. The tables are SOLVED, not hand-typed, in
 * a documented canonical form: `n_0 = e_1`, and each subsequent root's
 * first `k` coordinates are solved in order from its pairings with the
 * earlier roots — the Gram matrix is triangular in this orientation, so
 * forward substitution applies with no division by a zero diagonal — with
 * the NEW coordinate positive. That orientation is the one arbitrary
 * choice; it makes the table deterministic and lets the tests pin it
 * against an independent Cartan matrix. The 4D roots genuinely span all
 * four axes — F4's especially, whose fourth root carries `w` — because
 * the fold reads roots by name, exactly as the escape4 kernel core reads
 * its own plane index rather than the descents' w-collapsing one.
 *
 * REFUSALS, one line each (the full argument is the contract's legal-
 * combinations table):
 * - H4 (order 14400 — no real-time use) and the reducible products (the
 *   boxfold branch sweep is exactly the A1³ vocabulary this feature does
 *   not re-implement);
 * - 4D slab + LATTICE tiling (the affine-A1 product's walls need their own
 *   crossing enumeration and bounded work — the finite groups' proven
 *   `maxWordLength` root table is not that enumeration); a FINITE group's
 *   slab composes instead through the split vocabulary below
 *   ({@link tilingSlabPieces}), for systems whose inner estimator threads
 *   a segment exactly;
 * - balloon + infinite lattice (no finite enclosing ball certifies inversion).
 * Finite Balloon composition tiles first, then slices/projects, then inverts
 * the displayed set through its certified origin-centred enclosing ball.
 * Kaleidoscope composes: A is the already-symmetrized core set, and the
 * nearest-copy theorem needs no commuting between its maps and the tiling.
 * Proof, approximation limits and 3D/4D evidence: docs/tiling-contract.md.
 *
 * MIRRORED-LATTICE CONVENTION, frozen: one scalar fold uses the floor-based
 * mathematical modulo `h - abs(mod(x + h, 4h) - 2h)`. It performs fixed work
 * and exactly handles negative inputs and cell walls. The hot primitive has
 * no per-query validation: {@link resolveTiling} validates `h` once, and
 * finite marcher queries are an upstream invariant.
 */

/** The shipped finite reflection groups, by dimension: A3/B3/H3 in 3D,
 * A4/B4/F4 in 4D. H4 and the reducible products are refused (module doc);
 * mirrored affine-A1 repetition is the discriminated non-finite arm of
 * {@link TilingSpec}, not another entry in this list. */
export const TILING_GROUPS = ["a3", "b3", "h3", "a4", "b4", "f4"] as const;

/** One of the shipped finite reflection groups. */
export type TilingGroup = (typeof TILING_GROUPS)[number];

/** The legacy finite-reflection arm of {@link TilingSpec}. Its wire shape is
 * deliberately unchanged: no discriminator is added to old documents. */
export interface FiniteTilingSpec {
  /** One of the shipped finite reflection groups. */
  group: TilingGroup;
  /** Optional narrowing clip — may only intersect away, never widen. */
  clip?: ShapeSpec;
}

/** The mirrored affine-A1 lattice arm. `cellScale = h/R` is authored
 * explicitly: phase 2 has certified only the mathematical domain `>= 1`, not
 * a default or a narrower UI range. The resolver derives world-unit `h` from
 * the estimator's certified full visible radius. */
export interface LatticeTilingSpec {
  kind: "lattice";
  cellScale: number;
  /** Optional narrowing clip, embedded exactly like the finite arm's. */
  clip?: ShapeSpec;
}

/** Scene-level tiling block, beside ShapeTrap and HybridSchedule.
 * ABSENT MEANS OFF, byte-identically. The finite arm retains its original
 * `{ group, clip? }` wire; the lattice arm is explicitly discriminated and
 * requires an authored `cellScale` because no default has been accepted. */
export type TilingSpec = FiniteTilingSpec | LatticeTilingSpec;

/** Immutable metadata for one {@link TilingGroup}: the dimension, the
 * group order, the fold's proven step bound, and the unit simple roots
 * (inward chamber-wall normals), row-major flattened with `dim*dim`
 * entries — root `i` occupies `roots[i*dim .. i*dim+dim)`. */
export interface TilingGroupInfo {
  id: TilingGroup;
  dim: 3 | 4;
  /** The group order: A3 24, B3 48, H3 120, A4 120, B4 384, F4 1152. */
  order: number;
  /** The fold's step bound — the longest element's word length (the sum
   * of the diagram's exponents): A3 6, B3 9, H3 15, A4 10, B4 16, F4 24. */
  maxWordLength: number;
  /** Unit simple roots (inward normals), row-major flattened,
   * `dim*dim` entries. */
  roots: number[];
}

/** What {@link resolveTiling} hands the wrapper: the group plus its frozen
 * {@link TilingGroupInfo} and the clip exactly as authored. There are no
 * defaults to own — the group is discrete and the clip is a
 * {@link ShapeSpec}, whose validation lives in `shapes.ts` — so the
 * resolved value is the resolved pairing, ready for the estimator. */
export interface ResolvedFiniteTiling {
  group: TilingGroup;
  info: TilingGroupInfo;
  clip?: ShapeSpec;
}

/** Resolved mirrored lattice geometry. `radius` is the estimator authority's
 * certified full visible radius (4D uses `visibleBoundingRadius`, never a
 * slice-adjusted value); `h = cellScale * radius` is the world-unit half-cell.
 */
export interface ResolvedLatticeTiling {
  kind: "lattice";
  cellScale: number;
  radius: number;
  h: number;
  /** Renderer-only finite observation/fade policy, resolved from the same
   * authority radius but never persisted into the authored tiling block. */
  presentation: ResolvedLatticePresentation;
  clip?: ShapeSpec;
}

/** The one resolved tiling union. Renderer modules that have not yet landed
 * the lattice arm continue to accept {@link ResolvedFiniteTiling}; the pure
 * CPU wrappers accept this complete union. */
export type ResolvedTiling = ResolvedFiniteTiling | ResolvedLatticeTiling;

/** Largest half-cell whose full `4h` mirror period is representable by the
 * frozen f32 shader wire. This is an implementation representation limit,
 * not an authored UI maximum: persistence keeps any finite `cellScale`, and
 * the resolver rejects only a particular scale/radius pairing that cannot be
 * evaluated by both CPU and GPU arithmetic. */
const MAX_LATTICE_HALF_CELL = 3.4028234663852886e38 / 4;

/** Whether a half-cell survives the f32 uniform wire and its shader-side
 * `4h` period without rounding to zero or infinity. The upper comparison
 * keeps the accepted boundary explicit; the f32 checks catch the symmetric
 * underflow case and pin what the GPU actually receives. */
function latticeHalfCellFitsShaderWire(h: number): boolean {
  const wireH = Math.fround(h);
  return (
    Number.isFinite(h) &&
    h > 0 &&
    h <= MAX_LATTICE_HALF_CELL &&
    wireH > 0 &&
    Number.isFinite(Math.fround(4 * wireH))
  );
}

/** Narrow a document block without re-deriving its vocabulary. */
export function isLatticeTilingSpec(
  tiling: TilingSpec,
): tiling is LatticeTilingSpec {
  return "kind" in tiling && tiling.kind === "lattice";
}

/** Narrow a resolved block. Finite resolved objects intentionally keep their
 * historical shape and therefore carry no `kind` field. */
export function isResolvedLatticeTiling(
  tiling: ResolvedTiling,
): tiling is ResolvedLatticeTiling {
  return "kind" in tiling && tiling.kind === "lattice";
}

/** Defensive structural check for values claiming to be resolver output.
 * Renderer seams use this instead of each growing its own approximation of
 * the lattice domain and f32 wire limits. */
export function isCanonicalResolvedLatticeTiling(
  tiling: ResolvedLatticeTiling,
): boolean {
  return (
    Number.isFinite(tiling.cellScale) &&
    tiling.cellScale >= 1 &&
    Number.isFinite(tiling.radius) &&
    tiling.radius > 0 &&
    tiling.h === tiling.cellScale * tiling.radius &&
    tiling.presentation.contentRadius === tiling.radius &&
    Number.isFinite(tiling.presentation.fadeStartRadius) &&
    tiling.presentation.fadeStartRadius >= 0 &&
    Number.isFinite(tiling.presentation.outerRadius) &&
    tiling.presentation.outerRadius >= tiling.radius &&
    tiling.presentation.fadeStartRadius <= tiling.presentation.outerRadius &&
    latticeHalfCellFitsShaderWire(tiling.h)
  );
}

/** The fold's stop-test tolerance: a folded point is accepted once every
 * pairing satisfies `⟨q, n_i⟩ ≥ −FOLD_EPS` (1e-6 world units), so an
 * f32-folded point sitting ε-outside the chamber is accepted; the
 * soundness gap is bounded by `2·FOLD_EPS` — sub-pixel (module doc). */
export const FOLD_EPS = 1e-6;

/** The fold's iteration cap — the proven 24 (F4) plus an f32 wall-jitter
 * margin (module doc). After the cap a still-violated point returns null
 * and the caller's estimator returns 0: fully conservative. */
export const MAX_TILING_FOLD_STEPS = 32;

/** One Coxeter-diagram edge: `[i, j, m]` means `m_ij = m`, i.e. the
 * pairings `⟨n_i, n_j⟩ = −cos(π/m)`. Non-listed pairs have m = 2
 * (pairing 0). */
type Diagram = readonly (readonly [number, number, number])[];

/**
 * Solve the simple roots of a diagram in the module doc's canonical form:
 * `n_0 = e_1`, and each subsequent root's first `k` coordinates solved in
 * order from its pairings with the earlier roots, new coordinate positive.
 * The Gram matrix is triangular in this orientation — root `i` has support
 * only in coordinates `0..i` — so the `k`-th root's equations are solved
 * by forward substitution, and every diagonal entry is the positive new
 * coordinate of an earlier root, so nothing divides by zero. The solved
 * prefix determines the final coordinate up to sign; positive is the
 * frozen choice.
 *
 * The construction is the contract's, so a transcription slip in a
 * hand-typed table is impossible by construction; the group-axiom tests
 * pin the result against an independent Cartan matrix anyway.
 */
function solveRoots(dim: number, diagram: Diagram): number[] {
  const pair = (i: number, j: number): number => {
    for (const [a, b, m] of diagram) {
      if ((a === i && b === j) || (a === j && b === i)) {
        return -Math.cos(Math.PI / m);
      }
    }
    return 0;
  };
  const roots = new Array<number>(dim * dim).fill(0);
  roots[0] = 1;
  for (let k = 1; k < dim; k++) {
    const base = k * dim;
    let sq = 0;
    for (let i = 0; i < k; i++) {
      // Σ_{j<i} n_i[j]·x_j + n_i[i]·x_i = pair(i, k), x_j already solved.
      let acc = -pair(i, k);
      for (let j = 0; j < i; j++) acc += roots[i * dim + j] * roots[base + j];
      const x = -acc / roots[i * dim + i];
      roots[base + i] = x;
      sq += x * x;
    }
    // Positive new coordinate; the max(0, …) only guards the final f64
    // rounding of a sum that is always strictly below 1 (the Gram matrix
    // is positive definite).
    roots[base + k] = Math.sqrt(Math.max(0, 1 - sq));
  }
  return roots;
}

/** The per-group seed data: dimension, order, fold bound, and the Coxeter
 * diagram (edge list). The orders and bounds are the contract's frozen
 * table; the diagrams are the classic path graphs — the 4-edge sits
 * between roots 1-2 for B3 and B4, 2-3 for F4, and the 5-edge between
 * 0-1 for H3. */
const GROUPS: Record<
  TilingGroup,
  { dim: 3 | 4; order: number; maxWordLength: number; diagram: Diagram }
> = {
  a3: {
    dim: 3,
    order: 24,
    maxWordLength: 6,
    diagram: [
      [0, 1, 3],
      [1, 2, 3],
    ],
  },
  b3: {
    dim: 3,
    order: 48,
    maxWordLength: 9,
    diagram: [
      [0, 1, 3],
      [1, 2, 4],
    ],
  },
  h3: {
    dim: 3,
    order: 120,
    maxWordLength: 15,
    diagram: [
      [0, 1, 5],
      [1, 2, 3],
    ],
  },
  a4: {
    dim: 4,
    order: 120,
    maxWordLength: 10,
    diagram: [
      [0, 1, 3],
      [1, 2, 3],
      [2, 3, 3],
    ],
  },
  b4: {
    dim: 4,
    order: 384,
    maxWordLength: 16,
    diagram: [
      [0, 1, 3],
      [1, 2, 3],
      [2, 3, 4],
    ],
  },
  f4: {
    dim: 4,
    order: 1152,
    maxWordLength: 24,
    diagram: [
      [0, 1, 3],
      [1, 2, 4],
      [2, 3, 3],
    ],
  },
};

function buildGroupInfo(id: TilingGroup): TilingGroupInfo {
  const g = GROUPS[id];
  const info: TilingGroupInfo = {
    id,
    dim: g.dim,
    order: g.order,
    maxWordLength: g.maxWordLength,
    roots: solveRoots(g.dim, g.diagram),
  };
  Object.freeze(info.roots);
  return Object.freeze(info);
}

/** The frozen group tables — the ONE source the fold, the resolver and
 * the wrapper read. Deep-frozen (record, entries and root arrays), so no
 * consumer can mutate the canonical roots. */
export const TILING_GROUP_INFO: Record<TilingGroup, TilingGroupInfo> =
  Object.freeze({
    a3: buildGroupInfo("a3"),
    b3: buildGroupInfo("b3"),
    h3: buildGroupInfo("h3"),
    a4: buildGroupInfo("a4"),
    b4: buildGroupInfo("b4"),
    f4: buildGroupInfo("f4"),
  });

/**
 * Stable shader-wire code for a finite reflection group. Zero is reserved
 * for "tiling off"; live groups are one-based in {@link TILING_GROUPS}'s
 * append-only order. Both shader engines use this authority rather than
 * restating an enum beside their independently frozen params layouts.
 */
export function tilingGroupCode(group: TilingGroup): number {
  return TILING_GROUPS.indexOf(group) + 1;
}

/** Stable shader-wire code for the mirrored affine-A1 lattice arm. Zero is
 * off and the six finite group codes remain frozen at 1..6, so the first
 * non-finite construction occupies the next append-only value. */
export const LATTICE_TILING_CODE = 7 as const;

/** A finite number as a shader float literal. `String` preserves the solved
 * roots' full f64 text; integral values gain `.0`, valid in both dialects. */
function shaderFloatLit(x: number): string {
  if (!Number.isFinite(x)) {
    throw new Error(`tiling: non-finite baked constant (${x})`);
  }
  const s = String(x);
  return /[.e]/.test(s) ? s : `${s}.0`;
}

/** Validate a source-generated function name at the trust boundary. */
function shaderIdentifier(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`tiling: invalid shader function name "${name}"`);
  }
  return name;
}

/**
 * Emit the finite fold-to-chamber primitive from the SAME frozen group table
 * the CPU oracle reads. Roots are baked because a group change is already a
 * source-regenerating edit; the only runtime wire is the caller-owned group
 * id from {@link tilingGroupCode}. The result owns both the folded point and
 * success flag so the wrapper can turn the cap guard into estimator 0.
 *
 * The arithmetic is one generated body in two dialect spellings: start from
 * the query, select the most-negative pairing below `-FOLD_EPS`, reflect by
 * `q -= 2*dot*n`, and after {@link MAX_TILING_FOLD_STEPS} accept only if the
 * final point is within the same tolerance. The root comparisons are
 * unrolled from `info.roots`; this avoids dynamic local-array indexing on
 * GLSL drivers while leaving the mathematical source authoritative here.
 * `TilingFoldResult` is intentionally fixed: one compiled program carries
 * exactly one authored tiling group.
 */
export function tilingFoldSource(
  info: TilingGroupInfo,
  dialect: "glsl" | "wgsl",
  functionName = "tilingFold",
): string {
  const name = shaderIdentifier(functionName);
  const dim = info.dim;
  const vector = dialect === "glsl" ? `vec${dim}` : `vec${dim}f`;
  const roots = Array.from({ length: dim }, (_, i) =>
    info.roots.slice(i * dim, i * dim + dim).map(shaderFloatLit),
  );
  const pairings = roots
    .map(
      (root, i) =>
        `    ${dialect === "glsl" ? "float" : "let"} pairing${i} = dot(q, ${vector}(${root.join(", ")}));`,
    )
    .join("\n");
  const selections = roots
    .map(
      (_, i) =>
        `    if (pairing${i} < worstDot) { worstDot = pairing${i}; worst = ${i}; }`,
    )
    .join("\n");
  const reflections = roots
    .map(
      (root, i) =>
        `    ${i === 0 ? "if" : "else if"} (worst == ${i}) { q -= 2.0 * worstDot * ${vector}(${root.join(", ")}); }`,
    )
    .join("\n");
  const finalPairings = roots.map(
    (root) => `dot(q, ${vector}(${root.join(", ")}))`,
  );
  let minDot = finalPairings[finalPairings.length - 1];
  for (let i = finalPairings.length - 2; i >= 0; i--) {
    minDot = `min(${finalPairings[i]}, ${minDot})`;
  }
  const eps = shaderFloatLit(FOLD_EPS);
  if (dialect === "glsl") {
    return `struct TilingFoldResult {
  ${vector} point;
  bool ok;
};
TilingFoldResult ${name}(${vector} pIn) {
  ${vector} q = pIn;
  for (int step = 0; step < ${MAX_TILING_FOLD_STEPS}; step++) {
    int worst = -1;
    float worstDot = -${eps};
${pairings}
${selections}
    if (worst < 0) { return TilingFoldResult(q, true); }
${reflections}
  }
  float minDot = ${minDot};
  return TilingFoldResult(q, minDot >= -${eps});
}`;
  }
  return `struct TilingFoldResult {
  point: ${vector},
  ok: bool,
}
fn ${name}(pIn: ${vector}) -> TilingFoldResult {
  var q = pIn;
  for (var step = 0; step < ${MAX_TILING_FOLD_STEPS}; step++) {
    var worst: i32 = -1;
    var worstDot: f32 = -${eps};
${pairings}
${selections}
    if (worst < 0) { return TilingFoldResult(q, true); }
${reflections}
  }
  let minDot = ${minDot};
  return TilingFoldResult(q, minDot >= -${eps});
}`;
}

/**
 * Emit the mirrored affine-A1 lattice fold used by both shader dialects.
 * The scalar helper spells Euclidean modulo out with `floor`, exactly like
 * {@link mirrorLatticeCoordinate}; native modulo/remainder operators are not
 * interchangeable for negative cells. The vector fold mirrors x/z in 3D and
 * x/z/w in 4D, leaving the vertical y coordinate untouched.
 *
 * `h` is caller-owned runtime data resolved once by {@link resolveTiling}.
 * The generated function therefore has the signature `(point, h) -> point`
 * and introduces no second lattice-size authority in shader source.
 */
export function latticeFoldSource(
  dialect: "glsl" | "wgsl",
  dimension: 3 | 4,
  functionName = "latticeFold",
): string {
  const name = shaderIdentifier(functionName);
  const coordinateName = `${name}Coordinate`;
  const vector = dialect === "glsl" ? `vec${dimension}` : `vec${dimension}f`;
  const axes = dimension === 3 ? ["x", "z"] : ["x", "z", "w"];
  const assignments = axes
    .map((axis) => `  q.${axis} = ${coordinateName}(q.${axis}, h);`)
    .join("\n");

  if (dialect === "glsl") {
    return `float ${coordinateName}(float x, float h) {
  float period = 4.0 * h;
  float m = x + h - period * floor((x + h) / period);
  return h - abs(m - 2.0 * h);
}
${vector} ${name}(${vector} pIn, float h) {
  ${vector} q = pIn;
${assignments}
  return q;
}`;
  }
  return `fn ${coordinateName}(x: f32, h: f32) -> f32 {
  let period = 4.0 * h;
  let m = x + h - period * floor((x + h) / period);
  return h - abs(m - 2.0 * h);
}
fn ${name}(pIn: ${vector}, h: f32) -> ${vector} {
  var q = pIn;
${assignments}
  return q;
}`;
}

/**
 * The ONE authority over both tiling arms. Finite blocks resolve exactly as
 * before. A lattice block additionally requires the current estimator's
 * certified full visible radius and derives `h = cellScale * radius` here —
 * never in a renderer. No lattice default or upper range is invented:
 * `cellScale` must be explicitly authored and finite in the accepted domain
 * `[1, +∞)`. Persistence drops malformed blocks before this point; the throws
 * below are defensive bug signals for direct callers.
 */
export function resolveTiling(
  spec: FiniteTilingSpec | undefined,
): ResolvedFiniteTiling | null;
export function resolveTiling(
  spec: LatticeTilingSpec,
  radius: number,
  presentationPolicy?: LatticePresentationPolicy,
): ResolvedLatticeTiling;
export function resolveTiling(
  spec: TilingSpec | undefined,
  radius: number,
  presentationPolicy?: LatticePresentationPolicy,
): ResolvedTiling | null;
export function resolveTiling(
  spec: TilingSpec | undefined,
  radius?: number,
  presentationPolicy?: LatticePresentationPolicy,
): ResolvedTiling | null {
  if (!spec) return null;
  if (isLatticeTilingSpec(spec)) {
    if (!Number.isFinite(spec.cellScale) || spec.cellScale < 1) {
      throw new RangeError(
        "resolveTiling: lattice cellScale must be a finite number >= 1",
      );
    }
    if (radius === undefined || !Number.isFinite(radius) || radius <= 0) {
      throw new RangeError(
        "resolveTiling: lattice resolution requires a finite certified radius > 0",
      );
    }
    const h = spec.cellScale * radius;
    if (!latticeHalfCellFitsShaderWire(h)) {
      throw new RangeError(
        "resolveTiling: lattice half-cell overflowed or underflowed the finite f32 4h period representation",
      );
    }
    return {
      kind: "lattice",
      cellScale: spec.cellScale,
      radius,
      h,
      presentation: resolveLatticePresentation(radius, presentationPolicy),
      clip: spec.clip,
    };
  }
  if (!TILING_GROUPS.some((g) => g === spec.group)) {
    throw new Error(
      `resolveTiling: unknown tiling group "${String(spec.group)}" — ` +
        `expected one of ${TILING_GROUPS.join(", ")}`,
    );
  }
  return {
    group: spec.group,
    info: TILING_GROUP_INFO[spec.group],
    clip: spec.clip,
  };
}

/** Euclidean modulo with a non-negative result for every finite `x`. Kept
 * private so every lattice caller goes through the accepted mirror formula
 * rather than substituting JavaScript's negative-input remainder. */
function latticeMod(x: number, period: number): number {
  return x - period * Math.floor(x / period);
}

/** Affine-A1 fold into the closed chamber `[-h,h]`, with period `4h` and
 * alternating orientation in adjacent copies. This is the CPU arithmetic the
 * later shader bead must mirror literally (floor-based modulo, never `%`). */
export function mirrorLatticeCoordinate(x: number, h: number): number {
  return h - Math.abs(latticeMod(x + h, 4 * h) - 2 * h);
}

/** Mirror attractor-frame x/z and leave y vertical. `out` may alias `p`. */
export function foldLattice3(p: Vec3, h: number, out: Vec3): Vec3 {
  const x = mirrorLatticeCoordinate(p[0], h);
  const y = p[1];
  const z = mirrorLatticeCoordinate(p[2], h);
  out[0] = x;
  out[1] = y;
  out[2] = z;
  return out;
}

/** Mirror attractor-frame x/z/w and leave y vertical. The caller lifts and
 * inverse-rotates the view query before this function; folding view-space xyz
 * or omitting w would describe a different 4D lattice. `out` may alias `p`. */
export function foldLattice4(p: Vec4, h: number, out: Vec4): Vec4 {
  const x = mirrorLatticeCoordinate(p[0], h);
  const y = p[1];
  const z = mirrorLatticeCoordinate(p[2], h);
  const w = mirrorLatticeCoordinate(p[3], h);
  out[0] = x;
  out[1] = y;
  out[2] = z;
  out[3] = w;
  return out;
}

/**
 * Emit the slab split's baked constants and cut enumerator for one finite
 * group, in either shader dialect — the shader mirror of
 * {@link tilingSlabPieces}'s cut pass. The walls are
 * {@link tilingReflectionWalls}' table baked as literal vectors (a group
 * change is already a source-regenerating edit, exactly like the fold's
 * roots); the enumerator gathers each wall's crossing parameter of the
 * segment `q0 ± e`, keeps the ones strictly inside `(-1, 1)`, and
 * insertion-sorts them — at most one cut per wall, so the caller's array
 * of `2 + wallCount` entries cannot overflow and the piece loop reads the
 * pieces between consecutive cuts. Walls parallel to the segment (`dot ==
 * 0`) never cross; a cut exactly at an endpoint is dropped, matching the
 * CPU's `[-1, 1]` window.
 *
 * WGSL receives the cut list through a `ptr<function>` parameter (the
 * caller owns the fixed-size array); GLSL takes it `inout`. Both spell
 * Euclidean arithmetic the CPU oracle reads value for value at f64 — the
 * f32 shader rounding is the same wall-tolerance class the fold's
 * `FOLD_EPS` already prices.
 */
export function tilingSlabSource(
  info: TilingGroupInfo,
  dialect: "glsl" | "wgsl",
  names: { walls: string; cuts: string },
): string {
  const wallsName = shaderIdentifier(names.walls);
  const cutsName = shaderIdentifier(names.cuts);
  const walls = tilingReflectionWalls(info);
  const n = walls.length;
  const cap = n + 2;
  const literals = walls
    .map((wall) =>
      dialect === "glsl"
        ? `    vec4(${wall.map(shaderFloatLit).join(", ")})`
        : `    vec4f(${wall.map(shaderFloatLit).join(", ")})`,
    )
    .join(",\n");
  if (dialect === "glsl") {
    return `// The group's mirror walls (${wallsName}) and the slab split's
// crossing enumerator (${cutsName}) — tiling.ts's tilingSlabPieces cut
// pass, one cut per wall, insertion-sorted.
vec4 ${wallsName}[${n}] = vec4[${n}](
${literals}
);
int ${cutsName}(vec4 q0, vec4 e, inout float cuts[${cap}]) {
  int count = 2;
  cuts[0] = -1.0;
  cuts[1] = 1.0;
  for (int wi = 0; wi < ${n}; wi++) {
    float denom = dot(${wallsName}[wi], e);
    if (denom != 0.0) {
      float cut = -dot(${wallsName}[wi], q0) / denom;
      if (cut > -1.0 && cut < 1.0) {
        cuts[count] = cut;
        int j = count;
        while (j > 0 && cuts[j - 1] > cuts[j]) {
          float above = cuts[j - 1];
          cuts[j - 1] = cuts[j];
          cuts[j] = above;
          j--;
        }
        count++;
      }
    }
  }
  return count;
}`;
  }
  return `// The group's mirror walls (${wallsName}) and the slab split's
// crossing enumerator (${cutsName}) — tiling.ts's tilingSlabPieces cut
// pass, one cut per wall, insertion-sorted.
var<private> ${wallsName}: array<vec4f, ${n}> = array<vec4f, ${n}>(
${literals}
);

fn ${cutsName}(q0: vec4f, e: vec4f, cuts: ptr<function, array<f32, ${cap}>>) -> u32 {
  var count = 2u;
  (*cuts)[0] = -1.0;
  (*cuts)[1] = 1.0;
  for (var wi = 0u; wi < ${n}u; wi++) {
    let denom = dot(${wallsName}[wi], e);
    if (denom != 0.0) {
      let cut = -dot(${wallsName}[wi], q0) / denom;
      if (cut > -1.0 && cut < 1.0) {
        (*cuts)[count] = cut;
        var j = count;
        loop {
          if (j == 0u) {
            break;
          }
          let above = (*cuts)[j - 1u];
          if (above <= (*cuts)[j]) {
            break;
          }
          (*cuts)[j - 1u] = (*cuts)[j];
          (*cuts)[j] = above;
          j = j - 1u;
        }
        count = count + 1u;
      }
    }
  }
  return count;
}`;
}

/**
 * The reflection primitive the fold is built from: `p' = p − 2⟨p, n⟩n`
 * across the wall `⟨·, n⟩ = 0` (n unit), writing into `out` so the
 * per-query path never allocates; `out` may alias `p` (the reflection
 * reads all of `p` before writing). An exact isometry, so `|p'| = |p|` and
 * every sphere gate the cores read is unchanged. The same formula serves
 * 3- and 4-vectors; the working dimension is `normal`'s length.
 */
export function reflectAcrossWall(
  p: Vec3 | Vec4,
  normal: Vec3 | Vec4,
  out: Vec3 | Vec4,
): Vec3 | Vec4 {
  let dot = 0;
  for (let j = 0; j < normal.length; j++) dot += p[j] * normal[j];
  const f = 2 * dot;
  for (let j = 0; j < normal.length; j++) out[j] = p[j] - f * normal[j];
  return out;
}

/**
 * The fold-to-chamber retraction `F`, counting its own steps — the
 * exported-for-test core {@link foldToChamber} is a thin wrapper over.
 * While any pairing is below `−FOLD_EPS`, reflect across the MOST violated
 * wall (the most negative pairing); deterministic, and every step strictly
 * shortens the chamber's word, so the fold lands in `C` in at most
 * `info.maxWordLength` steps (module doc's proof). After
 * {@link MAX_TILING_FOLD_STEPS} iterations a point still violating a wall
 * yields `null` — the caller's contract reads that as estimator 0, fully
 * conservative, and by the proof it never fires (the cap covers f32
 * wall-jitter only).
 *
 * Writes into `out` (which may alias `p` — the point is copied in before
 * any reflection) and returns `{ point: out, steps }` on success: the
 * step count is how the fold-bound test asserts the proof.
 */
export function foldToChamberWithSteps(
  info: TilingGroupInfo,
  p: Vec3 | Vec4,
  out: Vec3 | Vec4,
): { point: Vec3 | Vec4; steps: number } | null {
  const dim = info.dim;
  const roots = info.roots;
  for (let j = 0; j < dim; j++) out[j] = p[j];
  for (let step = 0; step < MAX_TILING_FOLD_STEPS; step++) {
    let worst = -1;
    let worstDot = -FOLD_EPS;
    for (let i = 0; i < dim; i++) {
      let dot = 0;
      const base = i * dim;
      for (let j = 0; j < dim; j++) dot += out[j] * roots[base + j];
      if (dot < worstDot) {
        worstDot = dot;
        worst = i;
      }
    }
    if (worst < 0) return { point: out, steps: step };
    const base = worst * dim;
    const f = 2 * worstDot;
    for (let j = 0; j < dim; j++) out[j] -= f * roots[base + j];
  }
  let minDot = Infinity;
  for (let i = 0; i < dim; i++) {
    let dot = 0;
    const base = i * dim;
    for (let j = 0; j < dim; j++) dot += out[j] * roots[base + j];
    if (dot < minDot) minDot = dot;
  }
  if (minDot >= -FOLD_EPS) return { point: out, steps: MAX_TILING_FOLD_STEPS };
  return null;
}

/**
 * The fold-to-chamber retraction `F` — the map the nearest-copy theorem
 * and the wrapper composition are written in terms of (module doc). Thin
 * wrapper over {@link foldToChamberWithSteps}; returns the folded point
 * (the `out` array) or `null` on cap expiry (never in practice — the
 * proof).
 */
export function foldToChamber(
  info: TilingGroupInfo,
  p: Vec3 | Vec4,
  out: Vec3 | Vec4,
): Vec3 | Vec4 | null {
  const r = foldToChamberWithSteps(info, p, out);
  return r === null ? null : r.point;
}

/**
 * The distance from `p` to the chamber's complement: `max(0, min_i
 * ⟨p, n_i⟩)` — 0 exactly when `p` is in (or within tolerance of) the
 * closed chamber. Needed by nothing in this module's public surface today;
 * it pins the vocabulary, and the estimator wrapper may read it.
 */
export function chamberDistance(info: TilingGroupInfo, p: Vec3 | Vec4): number {
  const dim = info.dim;
  const roots = info.roots;
  let min = Infinity;
  for (let i = 0; i < dim; i++) {
    let dot = 0;
    const base = i * dim;
    for (let j = 0; j < dim; j++) dot += p[j] * roots[base + j];
    if (dot < min) min = dot;
  }
  return Math.max(0, min);
}

/** Is `p` in the closed chamber, within the fold's own tolerance? —
 * `min_i ⟨p, n_i⟩ >= −FOLD_EPS`, exactly the predicate the fold's stop
 * test accepts, so "the fold landed in-chamber" and this agree. */
export function isInChamber(info: TilingGroupInfo, p: Vec3 | Vec4): boolean {
  const dim = info.dim;
  const roots = info.roots;
  let min = Infinity;
  for (let i = 0; i < dim; i++) {
    let dot = 0;
    const base = i * dim;
    for (let j = 0; j < dim; j++) dot += p[j] * roots[base + j];
    if (dot < min) min = dot;
  }
  return min >= -FOLD_EPS;
}

/** The orbit enumerator's dedupe tolerance: two images within this of each
 * other are the same image. It must sit comfortably ABOVE the f64 noise a
 * reflected point accumulates (~1e-13 · |point| per word) and comfortably
 * BELOW the separation of distinct images of any test point (the tests'
 * seeded points separate at ≥ 1e-6), so each image keeps exactly one
 * representative. */
const ORBIT_EPS = 1e-10;

/**
 * THE SLOW EXPLICIT ORBIT ENUMERATOR — TEST ORACLE ONLY. Nothing in the
 * runtime path may call this: the wrapper folds and never enumerates (the
 * group order for a generic point and the orbit of a wall point are both
 * far too big for a per-query walk). It exists so the tests can check the
 * fold against something that is not the fold: the distinct images of
 * `point` under the whole group, by walking the Cayley graph — every group
 * element is a product of the simple reflections, so BFS from the identity
 * applying each simple reflection to every newly seen image exhausts the
 * orbit.
 *
 * DEDUPE IS A TOLERANCE SCAN, NOT AN EXACT KEY. The same group element
 * reached through different words produces f64 images that differ in the
 * last ulps, and an exact key would treat those as distinct forever — the
 * BFS would never terminate. Every visited image is within `ORBIT_EPS` of
 * a TRUE image `g(point)` (the reflections are exact isometries, so
 * reflecting an ε-close point stays ε-close), and the distinct images of a
 * test point separate by far more than `ORBIT_EPS`, so the scan keeps
 * exactly one representative per image: a point fixed by a subgroup yields
 * exactly its (smaller) orbit, and the returned count — the number of
 * stored images, which is also written into `out` as fresh arrays
 * (allocation is fine here, this is the slow oracle) — equals
 * `info.order` exactly when the point is generic.
 */
export function enumerateOrbit(
  info: TilingGroupInfo,
  point: Vec3 | Vec4,
  out: number[][],
): number {
  out.length = 0;
  const dim = info.dim;
  const roots = info.roots;
  const start = new Array<number>(dim);
  let startNorm = 0;
  for (let j = 0; j < dim; j++) {
    start[j] = point[j];
    startNorm += point[j] * point[j];
  }
  const eps = ORBIT_EPS * Math.max(1, Math.sqrt(startNorm));
  const eps2 = eps * eps;
  out.push(start);
  const distinct = (v: number[]): boolean => {
    for (const existing of out) {
      let d2 = 0;
      for (let j = 0; j < dim; j++) {
        const d = v[j] - existing[j];
        d2 += d * d;
      }
      if (d2 <= eps2) return false;
    }
    return true;
  };
  for (let head = 0; head < out.length; head++) {
    const current = out[head];
    for (let i = 0; i < dim; i++) {
      const next = new Array<number>(dim);
      const base = i * dim;
      let dot = 0;
      for (let j = 0; j < dim; j++) dot += current[j] * roots[base + j];
      const f = 2 * dot;
      for (let j = 0; j < dim; j++) next[j] = current[j] - f * roots[base + j];
      if (distinct(next)) out.push(next);
    }
  }
  return out.length;
}

/**
 * THE SLAB SPLIT — the folded-piece vocabulary that carries a slice-thickness
 * (segment) query through a finite reflection tiling. The nearest-copy
 * theorem is a POINT statement; a segment crossing walls folds to a BENT
 * polyline, which is why tiled slabs were refused. This vocabulary restores
 * the slab by splitting the segment so the fold is one isometry on each
 * piece:
 *
 * Every mirror hyperplane is the image of a simple root's wall under the
 * group, and antipodal normals describe the same hyperplane, so a finite
 * group owns exactly its `maxWordLength` distinct walls (the positive roots:
 * A3 6, B3 9, H3 15, A4 10, B4 16, F4 24 —
 * {@link tilingReflectionWalls} builds and asserts that table). A straight
 * segment meets each such hyperplane at most once, so sorting the crossing
 * parameters divides it into at most `maxWordLength + 1` pieces on which the
 * sign pattern against ALL walls — the fold's actual cell decomposition — is
 * constant. The fold therefore restricts to ONE isometry `g_j` per piece:
 * the chamber copy of a point is unique, `g_j` maps the piece's cell to the
 * fundamental chamber, and an isometry takes the straight piece to the
 * straight folded segment `{@link TilingSlabPiece.center} ±
 * {@link TilingSlabPiece.extent}`.
 *
 * An ENDPOINT lying on its wall is fixed by the crossing reflection
 * (`s_H(a) = a` for `a` on the wall), so the previous and next cells' copies
 * coincide there and folding endpoints — rather than interior points —
 * still yields `g_j`'s image of the closed piece. The residual disagreement
 * is the fold's own `FOLD_EPS` wall tolerance, the same allowance the point
 * fold already prices. A piece whose endpoint fold expires the cap (never,
 * by the fold's proof) reports `null` and the caller returns 0 — fully
 * conservative, the point path's own convention.
 *
 * THE ESTIMATOR COMPOSITION this vocabulary exists for, per piece `j` with
 * `F_j = g_j(S_j)`:
 *
 *     d(S, T) = min_j d(S_j, T) = min_j d(F_j, S)
 *             >= min_j max(coreDE(F_j), clipSdf(mid_j) - halfLen_j)
 *
 * — `coreDE(F_j)` the inner core's own segment/cover certificate on the
 * straight folded piece, and the clip term the triangle inequality on the
 * TRUE distance field (`d(y, clip) >= d(mid, clip) - |y - mid| >=
 * clipSdf(mid) - halfLen`, the raw signed SDF lower-bounding the true
 * distance). Combining DE and clip PER PIECE keeps the intersection at one
 * segment parameter: minimizing the two terms separately can pair a DE
 * winner from one W position with a clip winner from another and falsely
 * admit geometry. `d(F_j, S)` lower-bounds via the intersection because
 * `S = A ∩ clip`: distance to an intersection is at least the distance to
 * each factor.
 */

/** One folded straight piece of a split segment: the image segment
 * `center ± extent` in the fundamental chamber, with the piece's
 * `start`/`end` parameters on the ORIGINAL segment (in `[-1, 1]`), so a
 * winning piece's hit parameter remaps back exactly
 * (`s = start + (sLocal + 1) / 2 * (end - start)`). */
export interface TilingSlabPiece<P extends Vec3 | Vec4 = Vec3 | Vec4> {
  center: P;
  extent: P;
  start: number;
  end: number;
}

/** The distinct mirror normals of one finite group, cached per frozen
 * {@link TilingGroupInfo} singleton. Images of the simple roots under the
 * whole group (the orbit enumerator — build-time work, never per-query),
 * each sign-fixed by its first significant component so antipodal images
 * collapse, deduped within 1e-9 (comfortably above f64 reflection noise,
 * comfortably below any distinct test images' separation). The count MUST
 * be `maxWordLength` — a missing wall would leave a piece crossing it, and
 * the fold of that piece would bend, silently breaking the slab bound — so
 * a wrong count throws instead of degrading. */
const TILING_WALL_CACHE = new Map<
  TilingGroupInfo,
  readonly (readonly number[])[]
>();

export function tilingReflectionWalls(
  info: TilingGroupInfo,
): readonly (readonly number[])[] {
  const cached = TILING_WALL_CACHE.get(info);
  if (cached) return cached;
  const dim = info.dim;
  const walls: number[][] = [];
  const orbit: number[][] = [];
  for (let i = 0; i < dim; i++) {
    const root = info.roots.slice(i * dim, (i + 1) * dim) as Vec3 | Vec4;
    enumerateOrbit(info, root, orbit);
    for (const image of orbit) {
      let sign = 1;
      for (const n of image) {
        if (Math.abs(n) > 1e-10) {
          sign = n < 0 ? -1 : 1;
          break;
        }
      }
      const normal = image.map((n) => sign * n);
      if (
        !walls.some((wall) =>
          wall.every((n, j) => Math.abs(n - normal[j]) < 1e-9),
        )
      ) {
        walls.push(normal);
      }
    }
  }
  if (walls.length !== info.maxWordLength) {
    throw new Error(
      `tiling: group ${info.id} derived ${walls.length} reflection walls, ` +
        `expected ${info.maxWordLength} (the positive roots) — the slab ` +
        "split's completeness depends on the full wall table",
    );
  }
  const frozen = walls.map((wall) => Object.freeze(wall.slice()));
  TILING_WALL_CACHE.set(info, Object.freeze(frozen));
  return TILING_WALL_CACHE.get(info)!;
}

/** Split capacity: the two segment endpoints plus every wall crossing —
 * F4's 24 walls make 26 the largest cut list. */
const TILING_SLAB_CUTS_MAX = 26;

/** Piece capacity: `maxWordLength + 1` pieces, 25 for F4. */
const TILING_SLAB_PIECES_MAX = 25;

/** Module scratch for {@link tilingSlabPieces}: the crossing parameters and
 * one reused piece pool per dimension (the piece records with their
 * vectors). Reused across calls like the `FOLDED` convention — the
 * estimator is synchronous and single-threaded, and every consumer reads a
 * piece before the next {@link tilingSlabPieces} call. */
const SLAB_CUTS = new Float64Array(TILING_SLAB_CUTS_MAX);
const SLAB_ENDPOINT_3A: Vec3 = [0, 0, 0];
const SLAB_ENDPOINT_3B: Vec3 = [0, 0, 0];
const SLAB_ENDPOINT_4A: Vec4 = [0, 0, 0, 0];
const SLAB_ENDPOINT_4B: Vec4 = [0, 0, 0, 0];
const SLAB_PIECES_3: TilingSlabPiece<Vec3>[] = [];
const SLAB_PIECES_4: TilingSlabPiece<Vec4>[] = [];
for (let i = 0; i < TILING_SLAB_PIECES_MAX; i++) {
  SLAB_PIECES_3.push({
    center: [0, 0, 0],
    extent: [0, 0, 0],
    start: 0,
    end: 0,
  });
  SLAB_PIECES_4.push({
    center: [0, 0, 0, 0],
    extent: [0, 0, 0, 0],
    start: 0,
    end: 0,
  });
}

/**
 * Split `center ± extent` at every wall crossing and fold each piece into
 * the fundamental chamber, returning the straight folded pieces with their
 * original-segment parameters — or `null` when an endpoint's fold expires
 * the cap (never, by the proof; the caller's contract reads that as
 * estimator 0, fully conservative).
 *
 * The returned array and its piece vectors are MODULE SCRATCH, reused by
 * the next call: consume every piece before calling again (the estimator
 * wrappers do — the cores copy their inputs). `info.dim` must match the
 * vectors' length; 3D and 4D share the construction verbatim, and the 3D
 * groups' coverage is the oracle that the shared algebra is honest even
 * though Surface thickness itself is a 4D view feature.
 */
export function tilingSlabPieces(
  info: TilingGroupInfo,
  center: Vec3,
  extent: Vec3,
): TilingSlabPiece<Vec3>[] | null;
export function tilingSlabPieces(
  info: TilingGroupInfo,
  center: Vec4,
  extent: Vec4,
): TilingSlabPiece<Vec4>[] | null;
export function tilingSlabPieces(
  info: TilingGroupInfo,
  center: Vec3 | Vec4,
  extent: Vec3 | Vec4,
): TilingSlabPiece<Vec3 | Vec4>[] | null {
  const dim = info.dim;
  if (center.length !== dim || extent.length !== dim) {
    throw new Error(
      `tiling: slab split for ${info.id} needs ${dim}-vectors, got ` +
        `${center.length}/${extent.length}`,
    );
  }
  const walls = tilingReflectionWalls(info);
  // Crossing parameters, insertion-sorted: a segment meets each wall at
  // most once, so at most `maxWordLength + 2` cuts and
  // `maxWordLength + 1` pieces.
  let cutCount = 2;
  SLAB_CUTS[0] = -1;
  SLAB_CUTS[1] = 1;
  for (const wall of walls) {
    let denominator = 0;
    let numerator = 0;
    for (let j = 0; j < dim; j++) {
      denominator += wall[j] * extent[j];
      numerator += wall[j] * center[j];
    }
    if (denominator === 0) continue;
    const cut = -numerator / denominator;
    if (cut <= -1 || cut >= 1) continue;
    let slot = cutCount;
    SLAB_CUTS[slot] = cut;
    while (slot > 0 && SLAB_CUTS[slot - 1] > SLAB_CUTS[slot]) {
      const above = SLAB_CUTS[slot - 1];
      SLAB_CUTS[slot - 1] = SLAB_CUTS[slot];
      SLAB_CUTS[slot] = above;
      slot--;
    }
    cutCount++;
  }
  const endpointA = dim === 3 ? SLAB_ENDPOINT_3A : SLAB_ENDPOINT_4A;
  const endpointB = dim === 3 ? SLAB_ENDPOINT_3B : SLAB_ENDPOINT_4B;
  const pool = dim === 3 ? SLAB_PIECES_3 : SLAB_PIECES_4;
  let count = 0;
  for (let k = 0; k + 1 < cutCount; k++) {
    const start = SLAB_CUTS[k];
    const end = SLAB_CUTS[k + 1];
    // Equal adjacent cuts — two walls crossed at one parameter, or a
    // crossing landing on an endpoint — bound an empty piece.
    if (end <= start) continue;
    for (let j = 0; j < dim; j++) {
      endpointA[j] = center[j] + start * extent[j];
      endpointB[j] = center[j] + end * extent[j];
    }
    const fa = foldToChamber(info, endpointA, endpointA);
    const fb = foldToChamber(info, endpointB, endpointB);
    if (fa === null || fb === null) return null;
    const piece = pool[count];
    for (let j = 0; j < dim; j++) {
      piece.center[j] = 0.5 * (fa[j] + fb[j]);
      piece.extent[j] = 0.5 * (fb[j] - fa[j]);
    }
    piece.start = start;
    piece.end = end;
    count++;
  }
  return pool.slice(0, count);
}
