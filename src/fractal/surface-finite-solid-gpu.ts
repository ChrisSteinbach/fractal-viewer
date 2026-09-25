/**
 * The finite-solid family's GPU half: the ONE dimension-parameterized WGSL
 * body both compute cores emit (`surface-de-gpu.ts`'s `core: "finite"` and
 * `"finite4"`) — the hierarchical display DE and the exact DDA boundary
 * query the optical transport's `opticsBackend: "finiteSolid"` emission
 * walks — plus the params constants the wire packs.
 *
 * The CPU oracle this mirrors term for term is `finite-solid.ts`: the
 * display DE is `finiteSolidDisplayDistance`'s certified hybrid (level-1
 * boxes refined within `FINITE_SOLID_DISPLAY_REFINE_REL · half` of their
 * boundary into their occupied children — the plain level-1 min would read
 * zero at the axis tunnels' mouth patches and seal them), and the boundary
 * query is `finiteSolidNextBoundary`/`finiteSolidNextBoundaryFromAnchor`'s
 * DDA (integer cells, analytic planes, NO distance epsilon, the anchor
 * contract with the tied-plane mask, post-incident cell indices and the
 * exact-corner normal convention). The module doc there carries the
 * soundness arguments; this file owns the f32 formulation and the wire.
 *
 * THE WIRE IS TINY because the ternary rule is pure integer arithmetic:
 * the grid needs no bitmap in-shader. The params tail is one 16-byte block
 * — `{half, level, grid, pad}` — appended at 208 (`core: "finite"`,
 * {@link SURFACE_GPU_PARAMS_FINITE_BYTES} 224) or at 464 (`core: "finite4"`,
 * {@link SURFACE_GPU_PARAMS4_FINITE_BYTES} 480) past the shared base (3D)
 * or the shared 4D tail (4D), whose `rotorInvR0..R3` rows and `w0` ARE the
 * 4D pose (`FiniteSolidPose`'s world→intrinsic rows + slice — the same
 * convention the descent prologue's `rotorInvApply4` already applies, so
 * the core packs no pose of its own). 3D sessions are the identity pose by
 * construction (`FINITE_SOLID_IDENTITY_POSE`), so the 3D tail carries no
 * rows. `sliceHalfW` stays 0 for the finite core (the DDA has no segment
 * form — the packer throws on a nonzero slab, the escape4 refusal).
 *
 * AGREEMENT DISCIPLINE: the bench's transport legs pin both emissions
 * against the f32 twin below, with independent geometry tests against
 * the f64 oracle. The DDA's exact-tie
 * crossings (an f64-equal crossing time on two axes) may split by ulps in
 * f32 into two sequential face events; the legs disclose that class the
 * way the escape legs disclose their ULP ensemble, and the optics effect
 * at a split corner is two refractions within one crossing scale.
 */

import {
  FINITE_SOLID_DISPLAY_REFINE_REL,
  FINITE_SOLID_GENERAL_MAX_ENUM_LEAVES,
  FINITE_SOLID_GENERAL_MAX_LEVEL,
  FINITE_SOLID_GENERAL_MAX_MAPS,
  FINITE_SOLID_GENERAL_NORMAL_DEPENDENT_REL,
  FINITE_SOLID_GENERAL_SNAP_REL,
  FINITE_SOLID_MEDIUM_OPAQUE,
  finiteSolidGeneralInverseMaps,
  finiteSolidGeneralRefineTau,
  type FiniteSolidAnchor,
  type FiniteSolidGeneralConstruction,
} from "./finite-solid";

// The leaf cap moved to the oracle (the f64 walk refuses past it too); the
// re-export keeps the harness's import path.
export { FINITE_SOLID_GENERAL_MAX_ENUM_LEAVES };
import { SHAPE_MARCH_SAFETY } from "./shapes";
import type { Vec3, Vec4 } from "./types";

/** The finite-solid params tail: 16 bytes appended past the shared base
 * (3D, offset 208) or the shared 4D tail (4D, offset 464). */
export const SURFACE_GPU_PARAMS_FINITE_BYTES = 224;
export const SURFACE_GPU_PARAMS4_FINITE_BYTES = 480;

/** The f32 envelope the DDA's reconstruction clamps within — the CPU
 * oracle's `COORDINATE_ENVELOPE_REL` (2·2^-23), relative to the half
 * extent; emitted as a literal so the WGSL reads the same number. */
const FINITE_ENVELOPE_REL = 2 * 2 ** -23;

// The middle ternary digit at each level of the nine-cell grid: coarse
// indices 3/4/5, fine indices 1/4/7. Shared by WGSL and its integer twin;
// the independent f64 oracle retains its generic ternary rule. The study
// qualification is recorded in docs/surface-dielectric-study.md.
const FINITE_D2_COARSE_MIDDLE_MASK = 0x38;
const FINITE_D2_FINE_MIDDLE_MASK = 0x92;

// The WGSL float-literal form `surface-de-gpu.ts`'s own wgslFloatLit emits
// (the plain shortest string, `.0`-suffixed when integral) — the same
// convention, restated locally because the dependency runs one way.
const floatLit = (x: number): string => {
  const s = String(x);
  return /[.e]/.test(s) ? s : `${s}.0`;
};
const finiteEnvelopeLiteral = floatLit(FINITE_ENVELOPE_REL);
const finiteRefineLiteral = floatLit(FINITE_SOLID_DISPLAY_REFINE_REL);
const finiteSafetyLiteral = floatLit(SHAPE_MARCH_SAFETY);

/**
 * The display half: the box-SDF helper, the certified hybrid DE and the
 * public `surfaceDE` the mode entries call. The cutoff is ignored — the
 * box bound is an exact-cost evaluation, not a descent, so the cutoff
 * contract is satisfied trivially (the sphere-inversion body's decision).
 */
export function finiteSolidDisplaySource(dim: 3 | 4): string {
  const dim4 = dim === 4;
  const axes = ["x", "y", "z", "w"].slice(0, dim);
  const lift = dim4
    ? `// The view lift: the 4D pose IS the shared 4D tail's rotor-inverse
// rows and w0 — the same world→intrinsic convention the descent
// prologue's rotorInvApply4 applies, so the finite core packs no pose.
fn finiteLift(p: vec3f) -> array<f32, 4> {
  let pv = vec4f(p, params.w0);
  return array<f32, 4>(
    dot(params.rotorInvR0, pv),
    dot(params.rotorInvR1, pv),
    dot(params.rotorInvR2, pv),
    dot(params.rotorInvR3, pv),
  );
}

fn finiteLiftDir(d: vec3f) -> array<f32, 4> {
  return array<f32, 4>(
    dot(params.rotorInvR0.xyz, d),
    dot(params.rotorInvR1.xyz, d),
    dot(params.rotorInvR2.xyz, d),
    dot(params.rotorInvR3.xyz, d),
  );
}

// The shared shade entry's radius source lifts through these two helpers
// on every core4 — the descent cores get them from the map-helpers block,
// which the bindingless finite core excludes (no GpuMap4 helpers), so the
// pair rides here. Same text, one emission per kernel.
fn rotorInvApply4(v: vec4f) -> vec4f {
  return vec4f(
    dot(params.rotorInvR0, v),
    dot(params.rotorInvR1, v),
    dot(params.rotorInvR2, v),
    dot(params.rotorInvR3, v),
  );
}

fn rotorInvWCol4() -> vec4f {
  return vec4f(
    params.rotorInvR0.w,
    params.rotorInvR1.w,
    params.rotorInvR2.w,
    params.rotorInvR3.w,
  );
}
`
    : `// 3D sessions are the identity pose by construction
// (FINITE_SOLID_IDENTITY_POSE): the intrinsic point is (p, 0), the
// intrinsic direction the direction itself.
fn finiteLift(p: vec3f) -> array<f32, 4> {
  return array<f32, 4>(p.x, p.y, p.z, 0.0);
}

fn finiteLiftDir(d: vec3f) -> array<f32, 4> {
  return array<f32, 4>(d.x, d.y, d.z, 0.0);
}
`;
  const boxSdf = `// One box's exact SDF over the construction's axes (finite-solid.ts's
// boxSdf): positive outside, the deepest gap's negation inside.
fn finiteBoxSdf(c: array<f32, 4>, h: f32, q: array<f32, 4>) -> f32 {
  var outsideSq = 0.0;
  var inside = -1.0e30;
  for (var a = 0; a < ${dim}; a++) {
    let gap = abs(q[a] - c[a]) - h;
    outsideSq = outsideSq + max(gap, 0.0) * max(gap, 0.0);
    inside = max(inside, gap);
  }
  return sqrt(outsideSq) + min(inside, 0.0);
}
`;
  // The nested 3^dim index loops, emitted per dimension. The level-1
  // grid center is (i − 1)·width1 and a child's is (3·i + o − 4)·width2 —
  // centred around zero to avoid subtracting the half extent after
  // scaling a positive grid coordinate. Non-binary widths still round.
  const loopNest = (vars: string[], body: string, indent: string): string => {
    if (vars.length === 0) {
      return body
        .split("\n")
        .map((line) => (line ? indent + line : line))
        .join("\n");
    }
    const [v, ...rest] = vars;
    const inner = loopNest(rest, body, indent + "  ");
    return `${indent}for (var ${v} = 0; ${v} < 3; ${v}++) {
${inner}
${indent}}`;
  };
  const middlesTest = (vars: string[], indent: string): string =>
    `${indent}let middles = ${vars.map((v) => `i32(${v} == 1)`).join(" + ")};
${indent}if (middles > 1) { continue; }`;
  const centerArray = (exprs: string[], indent: string): string =>
    `${indent}let c = array<f32, 4>(${exprs.join(", ")}${
      "0.0".repeat(4 - exprs.length)
        ? `, ${"0.0, ".repeat(4 - exprs.length - 1)}0.0`
        : ""
    });`.replace(", )", ")");
  const de = `// The shading field's certified hybrid (finite-solid.ts's
// finiteSolidDisplayDistance): the level-1 boxes' min, each refined into
// its occupied children within tau of its own boundary. The refinement is
// what keeps the axis tunnels' mouth patches from reading zero — the
// plain level-1 min would seal every tunnel at its mouth plane — and the
// min stays a certified lower bound of the distance to the union, so a
// outside march step can never skip the surface. The field also vanishes
// on interior shared child faces, so it is not a membership oracle.
// Primary and optical rays use the exact DDA below. Level 1 returns
// the plain min (the boxes ARE the union), level 0 the root box.
fn finiteDisplayDE(q: array<f32, 4>) -> f32 {
  let half = params.finiteHalf;
  if (params.finiteLevel == 0u) {
    return finiteBoxSdf(array<f32, 4>(0.0, 0.0, 0.0, 0.0), half, q);
  }
  let width1 = (2.0 * half) / 3.0;
  let half1 = width1 * 0.5;
  let width2 = (2.0 * half) / 9.0;
  let half2 = width2 * 0.5;
  let tau = half * ${finiteRefineLiteral};
  var result = 1.0e30;
${loopNest(
  axes.map((a) => `i${a}`),
  `${middlesTest(
    axes.map((a) => `i${a}`),
    "  ",
  )}
${centerArray(
  axes.map((a) => `(f32(i${a}) - 1.0) * width1`),
  "  ",
)}
  let d1 = finiteBoxSdf(c, half1, q);
  var term = d1;
  if (params.finiteLevel > 1u && d1 < tau) {
    var best2 = 1.0e30;
${loopNest(
  axes.map((a) => `o${a}`),
  `${middlesTest(
    axes.map((a) => `o${a}`),
    "    ",
  )}
${centerArray(
  axes.map((a) => `(f32(3 * i${a}) + f32(o${a}) - 4.0) * width2`),
  "    ",
)}
    let d2 = finiteBoxSdf(c, half2, q);
    if (d2 < best2) {
      best2 = d2;
    }`,
  "  ",
)}
    term = best2;
  }
  if (term < result) {
    result = term;
  }`,
  "  ",
)}
  return select(result, result * ${finiteSafetyLiteral}, result > 0.0);
}
`;
  return `${lift}
${boxSdf}
${de}
fn surfaceDE(pIn: vec3f, cutoff: f32, li: u32) -> f32 {
  return finiteDisplayDE(finiteLift(pIn));
}
`;
}

/**
 * The transport half: the exact DDA as the `opticsBackend: "finiteSolid"`
 * boundary query, with the full anchor contract in and out. One text for
 * both dimensions — the axis state rides fixed four-slot arrays and every
 * axis loop is bounded by the emitted dimension constant, the occupancy
 * rule and the normal's rows being the only dimension-conditional lines.
 *
 * The refusal reasons map onto the transport's reason vocabulary: 1
 * visit-cap, 2 invalid-input, 3 state-mismatch (the shared constants),
 * 4 ambiguous-anchor, 5 nonmonotone-crossing, 6 degenerate-projected-
 * normal (the DDA's own — `surface-de-gpu.ts` emits the matching
 * constants beside this body). A zero normal is the exact-corner
 * convention's rank-zero refusal sentinel; a legitimate displayed normal
 * is never zero.
 */
export function finiteSolidTransportSource(
  dim: 3 | 4,
  cacheCrossings = true,
): string {
  const dim4 = dim === 4;
  // Identical f32 expression at initialization and after a crossed axis
  // advances. In particular, never advance time by an accumulated delta.
  const crossingTime = `      let planeIndex = select(index[a], index[a] + 1, qd[a] > 0.0);
      let plane = finiteGridPlane(planeIndex);
      crossingT[a] = (plane - q[a]) / qd[a];
`;
  const rowsFn = dim4
    ? `fn finiteRowXyz(axis: i32) -> vec3f {
  var rows = array<vec3f, 4>(
    params.rotorInvR0.xyz,
    params.rotorInvR1.xyz,
    params.rotorInvR2.xyz,
    params.rotorInvR3.xyz,
  );
  return rows[axis];
}
`
    : `fn finiteRowXyz(axis: i32) -> vec3f {
  var rows = array<vec3f, 4>(
    vec3f(1.0, 0.0, 0.0),
    vec3f(0.0, 1.0, 0.0),
    vec3f(0.0, 0.0, 1.0),
    vec3f(0.0, 0.0, 0.0),
  );
  return rows[axis];
}
`;
  return `struct FiniteBoundary {
  // 1 boundary, 2 miss, 3 refused — TransportBoundary's vocabulary.
  kind: u32,
  reason: u32,
  t: f32,
  normal: vec3f,
  // The full anchor out (the DDA's continuation state): the snapped
  // intrinsic point, the tied-plane mask, the tied planes and the
  // post-incident cell indices. The next query consumes exactly these —
  // f32 reconstruction of cell identities is lossy, which is why the
  // anchor rides the path instead of a point+envelope.
  anchorIntrinsic: vec4f,
  anchorMask: u32,
  anchorPlanes: vec4i,
  anchorCells: vec4i,
}

// The centred rational grid plane — the oracle's finiteSolidGridPlane,
// chosen because it has no multiply-add cancellation site.
fn finiteGridPlane(i: i32) -> f32 {
  let half = params.finiteHalf;
  let g = i32(params.finiteGrid);
  if (i == 0) {
    return -half;
  }
  if (i == g) {
    return half;
  }
  return (half * (2.0 * f32(i) - f32(g))) / f32(g);
}

// The construction rule, directly (the bitmap's definition): a cell is
// occupied iff, at every level, at most one of its coordinates falls in
// the middle third. Out-of-range indices are empty.
fn finiteOccupied(idx: array<i32, 4>) -> bool {
  let g = i32(params.finiteGrid);
  for (var a = 0; a < ${dim}; a++) {
    if (idx[a] < 0 || idx[a] >= g) {
      return false;
    }
  }
  // At depth two the two ternary digits are exact nine-bit lookups.
  // Bounds precede shifts so outside cells cannot alias a valid bit.
  if (params.finiteLevel == 2u) {
    var coarseMiddles = 0u;
    var fineMiddles = 0u;
    for (var a = 0; a < ${dim}; a++) {
      let bit = u32(idx[a]);
      coarseMiddles += (${FINITE_D2_COARSE_MIDDLE_MASK}u >> bit) & 1u;
      fineMiddles += (${FINITE_D2_FINE_MIDDLE_MASK}u >> bit) & 1u;
    }
    return coarseMiddles <= 1u && fineMiddles <= 1u;
  }
  var div = g / 3;
  let level = i32(params.finiteLevel);
  for (var l = 0; l < level; l++) {
    var middles = 0;
    for (var a = 0; a < ${dim}; a++) {
      middles = middles + i32((idx[a] / div) % 3 == 1);
    }
    if (middles > 1) {
      return false;
    }
    div = div / 3;
  }
  return true;
}

${rowsFn}
// The exact-corner normal (finite-solid.ts's finiteSolidBoundaryNormal):
// reflect/refract against the incident ray's projection onto the span of
// every exactly tied displayed face normal, Gram-Schmidt in ascending
// intrinsic-axis order. A vec3f(0.0) return is the rank-zero refusal.
fn finiteBoundaryNormal(dir: vec3f, planeMask: u32, entering: bool) -> vec3f {
  if (planeMask > 0u && (planeMask & (planeMask - 1u)) == 0u) {
    var axis = 0;
    var m = planeMask;
    loop {
      if (m <= 1u) {
        break;
      }
      m = m >> 1u;
      axis = axis + 1;
    }
    let row = finiteRowXyz(axis);
    let magnitude = length(row);
    if (!(magnitude > 0.0)) {
      return vec3f(0.0);
    }
    let intrinsicDirection =
      row.x * dir.x + row.y * dir.y + row.z * dir.z;
    let directionSign = select(-1.0, 1.0, intrinsicDirection > 0.0);
    let faceSign = select(directionSign, -directionSign, entering);
    return (faceSign * row) / magnitude;
  }
  var basis: array<vec3f, 3>;
  var basisCount = 0;
  for (var axis = 0; axis < ${dim} && basisCount < 3; axis++) {
    if ((planeMask & (1u << u32(axis))) == 0u) {
      continue;
    }
    var vector = finiteRowXyz(axis);
    for (var bi = 0; bi < basisCount; bi++) {
      let projection = dot(vector, basis[bi]);
      vector = vector - projection * basis[bi];
    }
    let magnitude = length(vector);
    if (!(magnitude > 0.0)) {
      continue;
    }
    basis[basisCount] = vector / magnitude;
    basisCount = basisCount + 1;
  }
  var projected = vec3f(0.0);
  for (var bi = 0; bi < basisCount; bi++) {
    projected = projected + dot(dir, basis[bi]) * basis[bi];
  }
  let magnitude = length(projected);
  if (!(magnitude > 0.0)) {
    return vec3f(0.0);
  }
  let faceSign = select(1.0, -1.0, entering);
  return (faceSign * projected) / magnitude;
}

// One occupancy transition of the union along the ray (the oracle's
// boundaryFor): the tied axes' plane indices, the chosen axis (largest
// |qd|, ties to the first), the exact-corner normal, and the anchor —
// crossed coordinates snapped to their planes, unmasked ones clamped
// into their post-incident cell within the declared envelope.
fn finiteEvent(
  qOrigin: array<f32, 4>,
  qd: array<f32, 4>,
  dir: vec3f,
  t: f32,
  entering: bool,
  axes: array<i32, 4>,
  axisCount: i32,
  planeIndices: array<i32, 4>,
  cellIndices: array<i32, 4>,
) -> FiniteBoundary {
  var result: FiniteBoundary;
  result.kind = 1u;
  result.reason = 0u;
  result.t = t;
  result.normal = vec3f(0.0);
  result.anchorIntrinsic = vec4f(0.0);
  result.anchorMask = 0u;
  result.anchorPlanes = vec4i(-1);
  result.anchorCells = vec4i(-1);
  var axis = axes[0];
  var planeMask = 0u;
  for (var ai = 0; ai < axisCount; ai++) {
    let a = axes[ai];
    if (abs(qd[a]) > abs(qd[axis])) {
      axis = a;
    }
    planeMask = planeMask | (1u << u32(a));
  }
  let normal = finiteBoundaryNormal(dir, planeMask, entering);
  if (all(normal == vec3f(0.0))) {
    result.kind = 3u;
    result.reason = 6u;
    return result;
  }
  result.normal = normal;
  let half = params.finiteHalf;
  let envelope = half * ${finiteEnvelopeLiteral};
  var intrinsic: array<f32, 4>;
  var anchorPlanes: array<i32, 4> = array<i32, 4>(-1, -1, -1, -1);
  var anchorCells: array<i32, 4> = array<i32, 4>(-1, -1, -1, -1);
  for (var a = 0; a < ${dim}; a++) {
    intrinsic[a] = qOrigin[a] + t * qd[a];
    anchorCells[a] = cellIndices[a];
  }
  for (var ai = 0; ai < axisCount; ai++) {
    let a = axes[ai];
    anchorPlanes[a] = planeIndices[a];
    intrinsic[a] = finiteGridPlane(planeIndices[a]);
  }
  for (var a = 0; a < ${dim}; a++) {
    if ((planeMask & (1u << u32(a))) != 0u) {
      continue;
    }
    let lower = finiteGridPlane(anchorCells[a]);
    let upper = finiteGridPlane(anchorCells[a] + 1);
    if (intrinsic[a] < lower) {
      if (lower - intrinsic[a] > envelope) {
        result.kind = 3u;
        result.reason = 2u;
        return result;
      }
      intrinsic[a] = lower;
    } else if (intrinsic[a] > upper) {
      if (intrinsic[a] - upper > envelope) {
        result.kind = 3u;
        result.reason = 2u;
        return result;
      }
      intrinsic[a] = upper;
    }
  }
  result.anchorIntrinsic = vec4f(
    intrinsic[0],
    intrinsic[1],
    intrinsic[2],
    intrinsic[3],
  );
  result.anchorMask = planeMask;
  result.anchorPlanes = vec4i(
    anchorPlanes[0],
    anchorPlanes[1],
    anchorPlanes[2],
    anchorPlanes[3],
  );
  result.anchorCells = vec4i(
    anchorCells[0],
    anchorCells[1],
    anchorCells[2],
    anchorCells[3],
  );
  return result;
}

fn finiteRaySideIndex(value: f32, d: f32) -> i32 {
  let half = params.finiteHalf;
  let g = i32(params.finiteGrid);
  if (value < -half || (value == -half && d < 0.0)) {
    return -1;
  }
  if (value > half || (value == half && d > 0.0)) {
    return g;
  }
  // Compare the actual f32 planes: the normalized grid coordinate can
  // round to an integer while the point still lies on the other side.
  for (var planeIndex = 1; planeIndex < g; planeIndex++) {
    let plane = finiteGridPlane(planeIndex);
    if (value < plane || (value == plane && d < 0.0)) {
      return planeIndex - 1;
    }
  }
  // A ray coincident with a grid plane uses its upper half-open cell —
  // deterministic one-sided ownership, not closed membership.
  return g - 1;
}

// The exact DDA boundary query (the oracle's finiteSolidNextBoundary /
// finiteSolidNextBoundaryFromAnchor): integer cells, analytic planes, NO
// distance epsilon — only numerically equal crossing times tie, and all
// tied axes advance atomically. The anchored restart reconstructs the
// intrinsic point from the anchor (masked coordinates ON their planes,
// unmasked clamped into their cell) and takes the post-incident cells,
// refusing a medium whose occupancy contradicts the caller's claim.
fn transportFiniteBoundary(
  origin: vec3f,
  dir: vec3f,
  anchorPresent: u32,
  anchorIntrinsic: vec4f,
  anchorMask: u32,
  anchorPlanesIn: vec4i,
  anchorCellsIn: vec4i,
  inside: u32,
) -> FiniteBoundary {
  var result: FiniteBoundary;
  result.kind = 3u;
  result.reason = 1u;
  result.t = 0.0;
  result.normal = vec3f(0.0);
  result.anchorIntrinsic = vec4f(0.0);
  result.anchorMask = 0u;
  result.anchorPlanes = vec4i(-1);
  result.anchorCells = vec4i(-1);
  if (!all(abs(dir) <= vec3f(3.402823466e38)) || !(dot(dir, dir) > 0.0)) {
    result.reason = 2u;
    return result;
  }
  let half = params.finiteHalf;
  let g = i32(params.finiteGrid);
  let maxVisits = ${dim} * (g - 1) + 1;
  var q = array<f32, 4>(0.0, 0.0, 0.0, 0.0);
  var qd = finiteLiftDir(dir);
  if (anchorPresent == 1u) {
    // Validate the complete canonical continuation before trusting it.
    // Reuse each identical rounded plane for validation and reconstruction;
    // the displayed world origin is deliberately not read on this path.
    let envelope = half * ${finiteEnvelopeLiteral};
    if (anchorMask == 0u || (anchorMask & ~${(1 << dim) - 1}u) != 0u ||
        !all(abs(anchorIntrinsic) <= vec4f(3.402823466e38))) {
      result.reason = 2u;
      return result;
    }
    for (var a = 0; a < 4; a++) {
      let point = anchorIntrinsic[a];
      let planeIndex = anchorPlanesIn[a];
      let cell = anchorCellsIn[a];
      if ((anchorMask & (1u << u32(a))) != 0u) {
        if (planeIndex < 0 || planeIndex > g ||
            (cell != planeIndex - 1 && cell != planeIndex)) {
          result.reason = 2u;
          return result;
        }
        let plane = finiteGridPlane(planeIndex);
        if (abs(point - plane) > envelope) {
          result.reason = 2u;
          return result;
        }
        q[a] = plane;
      } else {
        if (planeIndex != -1) {
          result.reason = 2u;
          return result;
        }
        if (a >= ${dim}) {
          if (cell != -1) {
            result.reason = 2u;
            return result;
          }
          continue;
        }
        if (cell < 0 || cell >= g) {
          result.reason = 2u;
          return result;
        }
        let lower = finiteGridPlane(cell);
        let upper = finiteGridPlane(cell + 1);
        if (point < lower - envelope || point > upper + envelope) {
          result.reason = 2u;
          return result;
        }
        q[a] = point;
        if (q[a] < lower) {
          q[a] = lower;
        } else if (q[a] > upper) {
          q[a] = upper;
        }
      }
    }
  }
  var enter = -1.0e30;
  var enterAxes: array<i32, 4> = array<i32, 4>(0, 0, 0, 0);
  var enterAxisCount = 0;
  var start = 0.0;
  // A validated anchor reconstructs inside the closed root: every slab
  // contains zero, so enter <= 0 <= exit and max(0, enter) is exactly zero.
  // Only a new world ray needs the lift and original root clipping below.
  if (anchorPresent != 1u) {
    q = finiteLift(origin);
    var exitT = 1.0e30;
    for (var a = 0; a < ${dim}; a++) {
      if (qd[a] == 0.0) {
        if (q[a] < -half || q[a] > half) {
          result.kind = 2u;
          result.reason = 0u;
          return result;
        }
        continue;
      }
      let ta = (-half - q[a]) / qd[a];
      let tb = (half - q[a]) / qd[a];
      let near = min(ta, tb);
      let far = max(ta, tb);
      if (near > enter) {
        enter = near;
        enterAxes[0] = a;
        enterAxisCount = 1;
      } else if (near == enter) {
        enterAxes[enterAxisCount] = a;
        enterAxisCount = enterAxisCount + 1;
      }
      exitT = min(exitT, far);
      if (exitT < enter) {
        result.kind = 2u;
        result.reason = 0u;
        return result;
      }
    }
    start = max(0.0, enter);
    if (exitT < start || (anchorPresent == 0u && exitT == start)) {
      result.kind = 2u;
      result.reason = 0u;
      return result;
    }
  }
  var index: array<i32, 4> = array<i32, 4>(0, 0, 0, 0);
  // Canonical continuation supplies every cell below; only a new ray
  // needs coordinate classification and the root-entry identity override.
  if (anchorPresent == 0u) {
    for (var a = 0; a < ${dim}; a++) {
      index[a] = finiteRaySideIndex(q[a] + start * qd[a], qd[a]);
    }
    if (start == enter) {
      // Slab entry identities survive the rounded multiply-add at qStart.
      for (var ai = 0; ai < enterAxisCount; ai++) {
        let a = enterAxes[ai];
        index[a] = select(g - 1, 0, qd[a] > 0.0);
      }
    }
  }
  if (anchorPresent == 1u) {
    for (var a = 0; a < ${dim}; a++) {
      index[a] = anchorCellsIn[a];
      if ((anchorMask & (1u << u32(a))) == 0u) {
        continue;
      }
      if (qd[a] == 0.0) {
        result.kind = 3u;
        result.reason = 4u;
        return result;
      }
      index[a] = select(anchorPlanesIn[a] - 1, anchorPlanesIn[a], qd[a] > 0.0);
    }
  }
  var visits = 0;
  var sideInside = finiteOccupied(index);
  var inGridStart = true;
  for (var a = 0; a < ${dim}; a++) {
    inGridStart = inGridStart && index[a] >= 0 && index[a] < g;
  }
  if (inGridStart) {
    visits = visits + 1;
  }
  let mediumInside = inside == 1u;
  if (sideInside != mediumInside) {
    if (anchorPresent == 1u) {
      result.reason = 3u;
      return result;
    }
    var axes: array<i32, 4> = array<i32, 4>(0, 0, 0, 0);
    var axisCount = 0;
    if (start == enter) {
      axes = enterAxes;
      axisCount = enterAxisCount;
    } else {
      for (var a = 0; a < ${dim}; a++) {
        let at = q[a] + start * qd[a];
        let planeIndex = select(index[a] + 1, index[a], qd[a] > 0.0);
        if (at == finiteGridPlane(planeIndex) && qd[a] != 0.0) {
          axes[axisCount] = a;
          axisCount = axisCount + 1;
        }
      }
    }
    if (axisCount == 0) {
      result.reason = 3u;
      return result;
    }
    var planeIndices: array<i32, 4> = array<i32, 4>(-1, -1, -1, -1);
    for (var ai = 0; ai < axisCount; ai++) {
      let a = axes[ai];
      planeIndices[a] = select(index[a] + 1, index[a], qd[a] > 0.0);
    }
    return finiteEvent(
      q,
      qd,
      dir,
      start,
      sideInside,
      axes,
      axisCount,
      planeIndices,
      index,
    );
  }${
    cacheCrossings
      ? `
  // q and qd stay fixed throughout this query. An axis's crossing time
  // therefore changes only when its integer cell changes. Retain the same
  // rounded expression for unchanged axes; all min/tie scans keep their order.
  var crossingT: array<f32, 4> =
    array<f32, 4>(1.0e30, 1.0e30, 1.0e30, 1.0e30);
  for (var a = 0; a < ${dim}; a++) {
    if (qd[a] == 0.0) {
      continue;
    }
${crossingTime}  }`
      : ""
  }
  loop {
    var nextT = 1.0e30;${
      cacheCrossings
        ? ""
        : `
    var crossingT: array<f32, 4> =
      array<f32, 4>(1.0e30, 1.0e30, 1.0e30, 1.0e30);`
    }
    for (var a = 0; a < ${dim}; a++) {
      if (qd[a] == 0.0) {
        continue;
      }
${cacheCrossings ? "" : crossingTime}      nextT = min(nextT, crossingT[a]);
    }
    if (nextT >= 1.0e30) {
      result.kind = 2u;
      result.reason = 0u;
      return result;
    }
    if (nextT < start) {
      result.kind = 3u;
      result.reason = 5u;
      return result;
    }
    var axes: array<i32, 4> = array<i32, 4>(0, 0, 0, 0);
    var axisCount = 0;
    for (var a = 0; a < ${dim}; a++) {
      if (crossingT[a] == nextT) {
        axes[axisCount] = a;
        axisCount = axisCount + 1;
      }
    }
    for (var ai = 0; ai < axisCount; ai++) {
      let a = axes[ai];
      index[a] = index[a] + select(-1, 1, qd[a] > 0.0);
    }
    var inRoot = true;
    for (var a = 0; a < ${dim}; a++) {
      inRoot = inRoot && index[a] >= 0 && index[a] < g;
    }
    if (inRoot) {
      if (visits >= maxVisits) {
        result.kind = 3u;
        result.reason = 1u;
        return result;
      }
      visits = visits + 1;
    }
    let nextInside = inRoot && finiteOccupied(index);
    if (nextInside != sideInside) {
      var planeIndices: array<i32, 4> = array<i32, 4>(-1, -1, -1, -1);
      for (var ai = 0; ai < axisCount; ai++) {
        let a = axes[ai];
        // The crossed plane borders the post-crossing cell: its lower
        // side for positive travel, its upper side for negative travel.
        // Derive both identities from this one state instead of copying
        // a mutable array before advancing it.
        planeIndices[a] = select(index[a] + 1, index[a], qd[a] > 0.0);
      }
      let event = finiteEvent(
        q,
        qd,
        dir,
        nextT,
        nextInside,
        axes,
        axisCount,
        planeIndices,
        index,
      );
      if (event.kind == 3u) {
        return event;
      }
      if (sideInside != mediumInside) {
        result.kind = 3u;
        result.reason = 3u;
        return result;
      }
      return event;
    }
    sideInside = nextInside;
    if (!inRoot) {
      result.kind = 2u;
      result.reason = 0u;
      return result;
    }${
      cacheCrossings
        ? `
    // Only advanced cells have new planes; recompute from the original
    // origin, after the unchanged event/miss/visit guards have admitted it.
    for (var ai = 0; ai < axisCount; ai++) {
      let a = axes[ai];
${crossingTime}    }`
        : ""
    }
  }
}
`;
}

// ---------------------------------------------------------------------------
// The GENERAL construction: the document's OWN maps as the SIMPLICIAL word
// tree.
//
// The CPU oracle is `finite-solid.ts`'s general section
// (`analyzeFiniteSolidGeneral` through `finiteSolidGeneralDisplayDistance` /
// `finiteSolidGeneralNextBoundary` / `finiteSolidGeneralContains`); its
// module doc carries the construction and every soundness argument (the
// root cell, the level boxes the pruning rides, the branch-box display
// hybrid). The construction rides the SOURCE, not the wire: the maps, their
// f64 inverses, the root cell's vertices, the level boxes and the
// display's per-branch refine margins bake as `const` WGSL (the tiling
// clip's and `shapes.ts`'s baked-constant pattern), so the shipped params
// tail and the bindingless design survive untouched — a general session
// recompiles its kernels per enter (the session freezes its construction),
// the discipline the shipped cores already carry. The inverses are the
// ORACLE's f64 values rounded once at bake, never an f32 inversion.
//
// THE LEVEL IS BAKED INTO THE CODE SHAPE, not only a constant: the DFS is
// emitted as `level` explicit nests carrying the composed forward map and
// the composed inverse, and every const-array index the emission writes is
// in range for that level (WGSL refuses a constant out-of-range index at
// shader creation, so a runtime `if (FIN_LEVEL == ...)` guard around a
// `FIN_BOX_MIN[FIN_LEVEL - 2]` is not an option).
//
// THE ARITHMETIC ORDER IS THE ORACLE'S: every dot product and matrix step
// is written left-associated in the oracle's term order (`finDot`,
// `finRowTimes`), so the f32 twin below can mirror it op for op. A driver
// may still fuse multiply-adds; that is the tie-edge class disclosed next.
//
// TIE-EDGE DISCLOSURE: the reference groups endpoints greedily from each
// group's first t in f64; the WGSL realizes the same arithmetic in f32, and
// two endpoints that tie in f64 can order differently in f32 (and across
// drivers, under fused multiply-add). The bench legs treat that class the
// way the escape legs treat their chaos flips: a pre-hoc ULP ensemble
// excludes the probe and counts it, never a raised tolerance.
// ---------------------------------------------------------------------------

/** The general construction over the kernel wire — the admission's own
 * construction fields, read verbatim (a `FiniteSolidGeneralConstruction`
 * IS a wire). Plain number arrays: the values are f64 on the CPU and
 * quantize to f32 at bake. */
export type FiniteSolidGeneralWire = Pick<
  FiniteSolidGeneralConstruction,
  "mapMatrix" | "mapOffset" | "rootVertices" | "levelBoxes" | "rootKind"
> & {
  /** The per-map media codes (`FiniteSolidGeneralMedia`: 0 opaque, a glass
   * code >= 1, equal codes one material), baked beside the maps — the
   * session freezes its materials with its construction (the transform
   * editor hides for a Surface session's whole lifetime). Absent = every
   * map glass code 1, the single-material solid. */
  media?: readonly number[];
  /** THE COMPOSITE'S WALK (requires `media`): opaque maps drop out at the
   * tree's first level — `finite-solid.ts`'s `glassOnly` walk option — so
   * the display DE, the point medium and the boundary walk see the glass
   * subtrees alone, and an opaque map's subtree is left to the composite's
   * attractor term (`finite-solid-composite.ts`). Absent/false is
   * byte-identical source. */
  glassOnly?: boolean;
};

/** The root cell's vertex count: the hull simplex's `dim + 1`, or the
 * invariant box's `2^dim` corners. */
function generalRootCount(dim: 3 | 4, g: { rootKind: "hull" | "box" }): number {
  return g.rootKind === "box" ? 2 ** dim : dim + 1;
}

/** The cell's facet count: `dim + 1` for a simplex, `2·dim` for a box
 * (facet `2i` the axis-i min side, `2i + 1` the max side). */
function generalFacetCount(
  dim: 3 | 4,
  g: { rootKind: "hull" | "box" },
): number {
  return g.rootKind === "box" ? 2 * dim : dim + 1;
}

const generalVec4Lit = (v: readonly number[]): string =>
  `vec4f(${floatLit(v[0])}, ${floatLit(v[1])}, ${floatLit(v[2])}, ${floatLit(v[3])})`;

/** The wire's shape for `level` in `dim`: the codegen and the twin index
 * the level boxes by level and the root by dimension, so a malformed wire
 * throws here rather than emitting an out-of-range const index. */
function validateGeneralWire(
  dim: 3 | 4,
  g: FiniteSolidGeneralWire,
  level: number,
): void {
  const count = g.mapMatrix.length;
  if (
    !Number.isInteger(level) ||
    level < 0 ||
    level > FINITE_SOLID_GENERAL_MAX_LEVEL ||
    count < 1 ||
    count > FINITE_SOLID_GENERAL_MAX_MAPS ||
    g.mapOffset.length !== count ||
    (g.rootKind !== "hull" && g.rootKind !== "box") ||
    g.rootVertices.length !== generalRootCount(dim, g) ||
    g.levelBoxes.length !== level + 1 ||
    (g.media !== undefined &&
      (g.media.length !== count ||
        !g.media.every(
          (code) =>
            Number.isInteger(code) &&
            code >= 0 &&
            code <= FINITE_SOLID_GENERAL_MAX_MAPS,
        ))) ||
    (g.glassOnly === true && (g.media === undefined || level < 1))
  ) {
    throw new RangeError(
      `surface-finite-solid-gpu: a general wire needs 1..${FINITE_SOLID_GENERAL_MAX_MAPS} maps, a hull (${dim + 1} vertices) or box (${2 ** dim} corners) root, ${level + 1} level boxes at level ${level} (0..${FINITE_SOLID_GENERAL_MAX_LEVEL}) and, when present, one media code per map (the glass-only walk requires the media and a level of at least 1)`,
    );
  }
}

const generalConstBlock = (
  dim: 3 | 4,
  g: FiniteSolidGeneralWire,
  level: number,
): string => {
  validateGeneralWire(dim, g, level);
  const count = g.mapMatrix.length;
  const inverses = finiteSolidGeneralInverseMaps(g);
  const tau = finiteSolidGeneralRefineTau({
    dimension: dim,
    level,
    mapMatrix: g.mapMatrix,
    levelBoxes: g.levelBoxes,
  });
  const rows = (matrices: readonly (readonly number[])[]): string =>
    matrices
      .flatMap((m) =>
        [0, 1, 2, 3].map(
          (r) => `    ${generalVec4Lit(m.slice(r * 4, r * 4 + 4))}`,
        ),
      )
      .join(",\n");
  const vecs = (source: readonly (readonly number[])[]): string =>
    source.map((v) => `    ${generalVec4Lit(v)}`).join(",\n");
  return `// The construction, baked (the general admission's own maps — the
// session freezes its construction at enter, the shipped cores' discipline):
// row-major forward maps and their f64 inverses (four rows per map), the
// root cell, the level boxes (k = remaining depth) and the display's
// per-branch refine margins.
const FIN_LEVEL = ${level}u;
const FIN_MAP_COUNT = ${count}u;
const FIN_M = array<vec4f, ${4 * count}>(
${rows(g.mapMatrix)}
);
const FIN_T = array<vec4f, ${count}>(
${vecs(g.mapOffset)}
);
const FIN_IM = array<vec4f, ${4 * count}>(
${rows(inverses.map((inv) => inv.m))}
);
const FIN_IT = array<vec4f, ${count}>(
${vecs(inverses.map((inv) => inv.t))}
);
const FIN_ROOT = array<vec4f, ${g.rootVertices.length}>(
${vecs(g.rootVertices)}
);
const FIN_BOX_MIN = array<vec4f, ${level + 1}>(
${vecs(g.levelBoxes.map((box) => box.min))}
);
const FIN_BOX_MAX = array<vec4f, ${level + 1}>(
${vecs(g.levelBoxes.map((box) => box.max))}
);
const FIN_TAU = array<f32, ${count}>(
${tau.map((value) => `    ${floatLit(value)}`).join(",\n")}
);
// The per-map media (0 opaque, a glass code >= 1; equal codes one material)
// and the medium codes the walk reports (air 0, opaque the sentinel).
const FIN_MEDIA = array<u32, ${count}>(
${Array.from({ length: count }, (_, a) => `    ${String(g.media?.[a] ?? 1)}u`).join(",\n")}
);
const FIN_MEDIUM_OPAQUE = ${FINITE_SOLID_MEDIUM_OPAQUE}u;
// Per-branch coverage — the sweep's counts and the point medium's flags,
// read by the owner rule (finMediumOfCoverage). Private scratch, written
// before read.
var<private> finBranchCov: array<i32, ${count}>;
const FIN_TIE_REL = ${finiteEnvelopeLiteral};
const FIN_SNAP_REL = ${floatLit(FINITE_SOLID_GENERAL_SNAP_REL)};
const FIN_NORMAL_DEPENDENT_REL = ${floatLit(FINITE_SOLID_GENERAL_NORMAL_DEPENDENT_REL)};
const FIN_SAFETY = ${finiteSafetyLiteral};
`;
};

/** The affine algebra both general sources share, in the oracle's term
 * order: `finDot` is `finite-solid.ts`'s `m0·v0 + m1·v1 + m2·v2 + m3·v3`
 * left-associated, `finRowTimes` one row of `multiplyMatrix4`,
 * `finCompose` `composeWordStep` (the prefix ∘ map step), and
 * `finChildInverse` the walk's `childInverse` (M_a⁻¹ ∘ parent⁻¹). The 3D
 * maps carry the w row/column identity, so the fourth terms add exact
 * zeros. */
const generalAlgebraWgsl = (
  dim: 3 | 4,
  g: { rootKind: "hull" | "box"; rootVertices: readonly unknown[] },
): string => `
struct FinAff {
  r0: vec4f,
  r1: vec4f,
  r2: vec4f,
  r3: vec4f,
  t: vec4f,
}

fn finDot(a: vec4f, b: vec4f) -> f32 {
  return ((a.x * b.x + a.y * b.y) + a.z * b.z) + a.w * b.w;
}

fn finApply(m: FinAff, v: vec4f) -> vec4f {
  return vec4f(finDot(m.r0, v), finDot(m.r1, v), finDot(m.r2, v), finDot(m.r3, v));
}

fn finRowTimes(row: vec4f, m: FinAff) -> vec4f {
  return ((row.x * m.r0 + row.y * m.r1) + row.z * m.r2) + row.w * m.r3;
}

fn finIdentity() -> FinAff {
  return FinAff(
    vec4f(1.0, 0.0, 0.0, 0.0),
    vec4f(0.0, 1.0, 0.0, 0.0),
    vec4f(0.0, 0.0, 1.0, 0.0),
    vec4f(0.0, 0.0, 0.0, 1.0),
    vec4f(0.0),
  );
}

fn finMap(a: u32) -> FinAff {
  return FinAff(FIN_M[4u * a], FIN_M[4u * a + 1u], FIN_M[4u * a + 2u], FIN_M[4u * a + 3u], FIN_T[a]);
}

fn finInverseMap(a: u32) -> FinAff {
  return FinAff(FIN_IM[4u * a], FIN_IM[4u * a + 1u], FIN_IM[4u * a + 2u], FIN_IM[4u * a + 3u], FIN_IT[a]);
}

// The prefix ∘ map step (composeWordStep): the offset accumulates the map's
// translation through the INCOMING prefix, then the matrices multiply.
fn finCompose(acc: FinAff, a: u32) -> FinAff {
  let m = finMap(a);
  let offset = vec4f(
    finDot(acc.r0, m.t) + acc.t.x,
    finDot(acc.r1, m.t) + acc.t.y,
    finDot(acc.r2, m.t) + acc.t.z,
    finDot(acc.r3, m.t) + acc.t.w,
  );
  return FinAff(
    finRowTimes(acc.r0, m),
    finRowTimes(acc.r1, m),
    finRowTimes(acc.r2, m),
    finRowTimes(acc.r3, m),
    offset,
  );
}

// The child node's inverse (childInverse): (parent ∘ M_b)⁻¹ = M_b⁻¹ ∘
// parent⁻¹ — {invM_b·parentInvM, invM_b·(parentInvT − t_b)}.
fn finChildInverse(parent: FinAff, b: u32) -> FinAff {
  let im = finInverseMap(b);
  let d = parent.t - FIN_T[b];
  return FinAff(
    finRowTimes(im.r0, parent),
    finRowTimes(im.r1, parent),
    finRowTimes(im.r2, parent),
    finRowTimes(im.r3, parent),
    finApply(im, d),
  );
}

// A word's composed forward map, replayed from the identity in the DFS's
// own op sequence (generalLeafVertices) — the anchor's snap targets must
// be the clip's own planes bit for bit.
fn finWordAff(word: vec4i, depth: i32) -> FinAff {
  var acc = finIdentity();
  for (var slot = 0; slot < depth; slot++) {
    acc = finCompose(acc, u32(word[slot]));
  }
  return acc;
}

// The word's composed INVERSE, replayed the same way (generalLeafFrames):
// a box cell's facet planes are read off its rows.
fn finWordInverse(word: vec4i, depth: i32) -> FinAff {
  var acc = finIdentity();
  for (var slot = 0; slot < depth; slot++) {
    acc = finChildInverse(acc, u32(word[slot]));
  }
  return acc;
}

// The cell: the root cell's vertex set (the hull simplex's vertices or the
// invariant box's corners) through the composed word.
struct FinCell {
  v: array<vec4f, ${g.rootVertices.length}>,
}

fn finCell(m: FinAff) -> FinCell {
  var cell: FinCell;
  for (var i = 0; i < ${g.rootVertices.length}; i++) {
    cell.v[i] = finApply(m, FIN_ROOT[i]) + m.t;
  }
  return cell;
}

// The cell's facets (facetsFromVertices): facet k opposite vertex k, its
// vertices ascending, the normal the edge fan's (generalized) cross oriented
// AWAY from the opposite vertex and normalized. ok = false is the degenerate
// leaf the walk skips (a zero or non-finite cross, or the opposite vertex
// ON the facet plane).
struct FinFacets {
  ok: bool,
  n: array<vec4f, ${generalFacetCount(dim, g)}>,
  c: array<f32, ${generalFacetCount(dim, g)}>,
}

${
  dim === 4
    ? `// cross4's minor: the 3x3 of rows (a_i, b_i, c_i) over the kept axes.
fn finMinor(a: vec4f, b: vec4f, c: vec4f, i0: i32, i1: i32, i2: i32) -> f32 {
  return a[i0] * (b[i1] * c[i2] - b[i2] * c[i1])
    - b[i0] * (a[i1] * c[i2] - a[i2] * c[i1])
    + c[i0] * (a[i1] * b[i2] - a[i2] * b[i1]);
}

fn finCross(e1: vec4f, e2: vec4f, e3: vec4f) -> vec4f {
  return vec4f(
    -finMinor(e1, e2, e3, 1, 2, 3),
    finMinor(e1, e2, e3, 0, 2, 3),
    -finMinor(e1, e2, e3, 0, 1, 3),
    finMinor(e1, e2, e3, 0, 1, 2),
  );
}
`
    : `fn finCross(e1: vec4f, e2: vec4f) -> vec4f {
  return vec4f(
    e1.y * e2.z - e1.z * e2.y,
    e1.z * e2.x - e1.x * e2.z,
    e1.x * e2.y - e1.y * e2.x,
    0.0,
  );
}
`
}
fn finFacets(cell: FinCell) -> FinFacets {
  var out: FinFacets;
  out.ok = false;
  for (var k = 0; k < ${dim + 1}; k++) {
    var idx: array<i32, ${dim}>;
    var fill = 0;
    for (var i = 0; i < ${dim + 1}; i++) {
      if (i != k) {
        idx[fill] = i;
        fill = fill + 1;
      }
    }
    let a = cell.v[idx[0]];
    let e1 = cell.v[idx[1]] - a;
    let e2 = cell.v[idx[2]] - a;
    var n = ${dim === 4 ? "finCross(e1, e2, cell.v[idx[3]] - a)" : "finCross(e1, e2)"};
    let magnitude = sqrt(finDot(n, n));
    if (!(magnitude > 0.0) || !(magnitude <= 3.402823466e38)) {
      return out;
    }
    n = n / magnitude;
    let side = finDot(cell.v[k] - a, n);
    if (!(side < 0.0)) {
      if (side > 0.0) {
        n = -n;
      } else {
        return out;
      }
    }
    out.n[k] = n;
    out.c[k] = finDot(n, a);
  }
  out.ok = true;
  return out;
}

// A BOX cell's facets from its composed inverse (boxFacets): pre-image
// coordinate i is row_i·x + t_i, bounded by the root box FIN_BOX_*[0];
// facet 2i the min side (outward −row/|row|), 2i + 1 the max side.
fn finBoxFacets(inv: FinAff) -> FinFacets {
  var out: FinFacets;
  out.ok = false;
  var rows = array<vec4f, 4>(inv.r0, inv.r1, inv.r2, inv.r3);
  for (var axis = 0; axis < ${dim}; axis++) {
    let row = rows[axis];
    let len = sqrt(finDot(row, row));
    if (!(len > 0.0) || !(len <= 3.402823466e38)) {
      return out;
    }
    let unit = row / len;
    out.n[2 * axis] = -unit;
    out.c[2 * axis] = -(FIN_BOX_MIN[0][axis] - inv.t[axis]) / len;
    out.n[2 * axis + 1] = unit;
    out.c[2 * axis + 1] = (FIN_BOX_MAX[0][axis] - inv.t[axis]) / len;
  }
  out.ok = true;
  return out;
}

// A leaf cell's facets by root kind (cellFacets): the ${
  g.rootKind === "box"
    ? "BOX — read off the composed inverse"
    : "hull SIMPLEX — from its image vertices"
}.
fn finCellFacets(forward: FinAff, inverse: FinAff) -> FinFacets {
  return ${g.rootKind === "box" ? "finBoxFacets(inverse)" : "finFacets(finCell(forward))"};
}

// A word's facets, both frames replayed (the event's and the restart's).
fn finWordFacets(word: vec4i, depth: i32) -> FinFacets {
  return finCellFacets(finWordAff(word, depth), finWordInverse(word, depth));
}

// The cell's radius (generalCellRadius): the farthest vertex from the
// centroid — the anchor envelope's scale.
fn finCellRadius(cell: FinCell) -> f32 {
  var centroid = vec4f(0.0);
  for (var i = 0; i < ${g.rootVertices.length}; i++) {
    centroid = centroid + cell.v[i];
  }
  centroid = centroid / ${floatLit(g.rootVertices.length)};
  var radius = 0.0;
  for (var i = 0; i < ${g.rootVertices.length}; i++) {
    let d = cell.v[i] - centroid;
    radius = max(radius, sqrt(finDot(d, d)));
  }
  return radius;
}
`;

/** The word-tree display DE (`finiteSolidGeneralDisplayDistance`): the
 * certified branch-box hybrid — each level-1 branch's oriented box
 * `M_a(levelBoxes[level − 1])`, REPLACED by its children's boxes within
 * that branch's own refine margin (the seal-hazard argument one box up).
 * Level 0 is the root cell's own facet SDF; level 1 the plain branch min. */
export function finiteSolidGeneralDisplaySource(
  dim: 3 | 4,
  g: FiniteSolidGeneralWire,
  level: number,
  /** The composite owns the public `surfaceDE` (the min of this display DE
   * and the attractor term), so it asks for the source without one. */
  publicSurfaceDE = true,
): string {
  const lift = generalLiftSource(dim);
  const glassOnly = g.glassOnly === true;
  // The glass-only walk's branch filter: an opaque branch is no cell.
  const skipOpaque = glassOnly
    ? `
    if (FIN_MEDIA[a] == 0u) {
      continue;
    }`
    : "";
  const body =
    level === 0
      ? `  let facets = finCellFacets(finIdentity(), finIdentity());
  if (!facets.ok) {
    return 1.0e30;
  }
  var d = -1.0e30;
  for (var k = 0; k < ${generalFacetCount(dim, g)}; k++) {
    d = max(d, finDot(facets.n[k], q) - facets.c[k]);
  }
  return select(d, d * FIN_SAFETY, d > 0.0);`
      : `  var result = 1.0e30;
  for (var a = 0u; a < FIN_MAP_COUNT; a++) {${skipOpaque}
    let inv = finInverseMap(a);
    let d = finOrientedBoxSdf(inv, FIN_BOX_MIN[${level - 1}], FIN_BOX_MAX[${level - 1}], q);
    var term = d;${
      level > 1
        ? `
    if (d < FIN_TAU[a]) {
      var refined = 1.0e30;
      for (var b = 0u; b < FIN_MAP_COUNT; b++) {
        let grand = finChildInverse(inv, b);
        refined = min(refined, finOrientedBoxSdf(grand, FIN_BOX_MIN[${level - 2}], FIN_BOX_MAX[${level - 2}], q));
      }
      term = refined;
    }`
        : ""
    }
    result = min(result, term);
  }
  return select(result, result * FIN_SAFETY, result > 0.0);`;
  return `${generalConstBlock(dim, g, level)}${lift}
${generalAlgebraWgsl(dim, g)}
// The oriented box M(box) as the max of its facet half-space distances
// (orientedBoxSdf): the i-th pre-image coordinate is row_i(invM)·q + invT_i,
// so each axis's two planes have normal row i (length |row|). A certified
// lower bound outside, the exact interior depth inside.
fn finOrientedBoxSdf(inv: FinAff, lo: vec4f, hi: vec4f, q: vec4f) -> f32 {
  var rows = array<vec4f, 4>(inv.r0, inv.r1, inv.r2, inv.r3);
  var best = -1.0e30;
  for (var axis = 0; axis < ${dim}; axis++) {
    let row = rows[axis];
    let scale = sqrt(${dim === 4 ? "finDot(row, row)" : "(row.x * row.x + row.y * row.y) + row.z * row.z"});
    if (!(scale > 0.0)) {
      return 1.0e30;
    }
    let value = finDot(row, q) + inv.t[axis];
    best = max(best, max((lo[axis] - value) / scale, (value - hi[axis]) / scale));
  }
  return best;
}

fn finiteDisplayDE(qa: array<f32, 4>) -> f32 {
  let q = vec4f(qa[0], qa[1], qa[2], qa[3]);
${body}
}

// The branch whose display term is least (the hit-info's fallback slot for
// a point the march accepted just OUTSIDE every leaf): the display DE's
// own argmin, unrefined.
fn finiteDisplayBranch(qa: array<f32, 4>) -> i32 {
${
  level === 0
    ? "  return 0;"
    : `  let q = vec4f(qa[0], qa[1], qa[2], qa[3]);
  var best = 1.0e30;
  var branch = 0;
  for (var a = 0u; a < FIN_MAP_COUNT; a++) {${skipOpaque}
    let d = finOrientedBoxSdf(finInverseMap(a), FIN_BOX_MIN[${level - 1}], FIN_BOX_MAX[${level - 1}], q);
    if (d < best) {
      best = d;
      branch = i32(a);
    }
  }
  return branch;`
}
}

// The owner rule (generalMediumOf) over finBranchCov: any covering OPAQUE
// branch owns the point, else the lowest-index covering glass branch, else
// air. Returns (medium code, owning branch; -1 in air).
fn finMediumOfCoverage() -> vec2i {
  var glass = -1;
  for (var a = 0; a < i32(FIN_MAP_COUNT); a++) {
    if (finBranchCov[a] <= 0) {
      continue;
    }
    if (FIN_MEDIA[a] == 0u) {
      return vec2i(i32(FIN_MEDIUM_OPAQUE), a);
    }
    if (glass < 0) {
      glass = a;
    }
  }
  if (glass < 0) {
    return vec2i(0, -1);
  }
  return vec2i(i32(FIN_MEDIA[glass]), glass);
}

// Closed membership helpers: the point in an axis box, the point in a
// leaf's facet half-spaces.
fn finBoxContains(lo: vec4f, hi: vec4f, p: vec4f) -> bool {
  for (var axis = 0; axis < ${dim}; axis++) {
    if (p[axis] < lo[axis] || p[axis] > hi[axis]) {
      return false;
    }
  }
  return true;
}

fn finFacetsContain(facets: FinFacets, q: vec4f) -> bool {
  if (!facets.ok) {
    return false;
  }
  for (var k = 0; k < ${generalFacetCount(dim, g)}; k++) {
    if (finDot(facets.n[k], q) - facets.c[k] > 0.0) {
      return false;
    }
  }
  return true;
}

// The point's medium and owning branch (finiteSolidGeneralMediumAt): each
// branch's covering flag by closed membership over the same pruned nests
// as the walk (a branch already found covering skips its remaining
// subtree), then the owner rule. The camera's medium claim and the hit's
// slot attribution both read this.
fn finiteGeneralPointMedium(qa: array<f32, 4>) -> vec2i {
  let q = vec4f(qa[0], qa[1], qa[2], qa[3]);
  for (var a = 0; a < i32(FIN_MAP_COUNT); a++) {
    finBranchCov[a] = 0;
  }
${
  level === 0
    ? `  if (finFacetsContain(finCellFacets(finIdentity(), finIdentity()), q)) {
    finBranchCov[0] = 1;
  }`
    : `  if (finBoxContains(FIN_BOX_MIN[${level}], FIN_BOX_MAX[${level}], q)) {
${generalNestSource(
  level,
  (inv, remaining) =>
    `finBranchCov[a0] == 0 && finBoxContains(FIN_BOX_MIN[${remaining}], FIN_BOX_MAX[${remaining}], finApply(${inv}, q) + ${inv}.t)`,
  (
    forwardVar,
    inverseVar,
  ) => `if (finBranchCov[a0] == 0 && finFacetsContain(finCellFacets(${forwardVar}, ${inverseVar}), q)) {
  finBranchCov[a0] = 1;
}
`,
  glassOnly,
)}  }`
}
  return finMediumOfCoverage();
}

// Point membership (finiteSolidGeneralContains): any medium but air.
fn finiteGeneralPointInside(qa: array<f32, 4>) -> bool {
  return finiteGeneralPointMedium(qa).x != 0;
}
${
  publicSurfaceDE
    ? `
fn surfaceDE(pIn: vec3f, cutoff: f32, li: u32) -> f32 {
  return finiteDisplayDE(finiteLift(pIn));
}
`
    : ""
}`;
}

/** The view lift both general sources share: the 4D pose IS the shared 4D
 * tail's rotor-inverse rows and w0 (the shipped finite core's convention);
 * 3D sessions are the identity pose by construction. Defined by the
 * display source, consumed by the transport's direction lift too. */
function generalLiftSource(dim: 3 | 4): string {
  return dim === 4
    ? `fn finiteLift(p: vec3f) -> array<f32, 4> {
  let pv = vec4f(p, params.w0);
  return array<f32, 4>(
    dot(params.rotorInvR0, pv),
    dot(params.rotorInvR1, pv),
    dot(params.rotorInvR2, pv),
    dot(params.rotorInvR3, pv),
  );
}

fn finiteLiftDir(d: vec3f) -> array<f32, 4> {
  return array<f32, 4>(
    dot(params.rotorInvR0.xyz, d),
    dot(params.rotorInvR1.xyz, d),
    dot(params.rotorInvR2.xyz, d),
    dot(params.rotorInvR3.xyz, d),
  );
}

// The shared shade entry's radius source lifts through these two helpers
// on every core4 — the descent cores get them from the map-helpers block,
// which the bindingless finite core excludes, so the pair rides here.
// Same text, one emission per kernel (the shipped display source's own
// comment, carried).
fn rotorInvApply4(v: vec4f) -> vec4f {
  return vec4f(
    dot(params.rotorInvR0, v),
    dot(params.rotorInvR1, v),
    dot(params.rotorInvR2, v),
    dot(params.rotorInvR3, v),
  );
}

fn rotorInvWCol4() -> vec4f {
  return vec4f(
    params.rotorInvR0.w,
    params.rotorInvR1.w,
    params.rotorInvR2.w,
    params.rotorInvR3.w,
  );
}
`
    : `// 3D sessions are the identity pose by construction
// (FINITE_SOLID_IDENTITY_POSE): the intrinsic point is (p, 0), the
// intrinsic direction the direction itself.
fn finiteLift(p: vec3f) -> array<f32, 4> {
  return array<f32, 4>(p.x, p.y, p.z, 0.0);
}

fn finiteLiftDir(d: vec3f) -> array<f32, 4> {
  return array<f32, 4>(d.x, d.y, d.z, 0.0);
}
`;
}

/** The pruned DFS as `level` explicit nests (the level is baked into the
 * code shape): each nest composes the child's forward map and — above the
 * leaves — its inverse, and prunes the subtree when the query misses the
 * child's word-image of its level box (`levelBoxes[level − depth]`). The
 * innermost nest is the leaf body, `leaf(forwardVar, wordExpr)`. */
function generalNestSource(
  level: number,
  nodeTest: (inverseVar: string, remaining: number) => string,
  leaf: (forwardVar: string, inverseVar: string, word: string) => string,
  glassOnly = false,
): string {
  const indent = (depth: number): string => "  ".repeat(depth + 1);
  const wordOf = (depth: number): string => {
    const slots = [0, 1, 2, 3].map((slot) =>
      slot < depth ? `i32(a${slot})` : "-1",
    );
    return `vec4i(${slots.join(", ")})`;
  };
  let open = "";
  let close = "";
  for (let depth = 0; depth < level; depth++) {
    const pad = indent(depth);
    const parentF = depth === 0 ? "finIdentity()" : `f${depth - 1}`;
    const parentI = depth === 0 ? "finIdentity()" : `i${depth - 1}`;
    const childDepth = depth + 1;
    open += `${pad}for (var a${depth} = 0u; a${depth} < FIN_MAP_COUNT; a${depth}++) {
${
  glassOnly && depth === 0
    ? `${pad}  // The glass-only walk: an opaque map's subtree is the composite's
${pad}  // attractor term, never a cell.
${pad}  if (FIN_MEDIA[a0] == 0u) {
${pad}    continue;
${pad}  }
`
    : ""
}${pad}  let f${depth} = finCompose(${parentF}, a${depth});
`;
    if (childDepth < level) {
      open += `${pad}  let i${depth} = finChildInverse(${parentI}, a${depth});
${pad}  if (!(${nodeTest(`i${depth}`, level - childDepth)})) {
${pad}    continue;
${pad}  }
`;
    } else {
      open += `${pad}  let i${depth} = finChildInverse(${parentI}, a${depth});
`;
      open += leaf(`f${depth}`, `i${depth}`, wordOf(level))
        .split("\n")
        .map((line) => (line.length > 0 ? `${pad}  ${line}` : line))
        .join("\n");
    }
    close = `${pad}}\n${close}`;
  }
  return `${open}${close}`;
}

/**
 * The general transport half: the simplicial word-tree boundary query as
 * the `opticsBackend: "finiteSolid"` emission, the full anchor contract in
 * and out — the reference's `finiteSolidGeneralNextBoundary` /
 * `NextBoundaryFromAnchor` endpoint sweep, pruned, in f32. The walk
 * consumes the display source's lift and algebra (always co-emitted — the
 * shipped transport's `finiteLiftDir` dependence, one tree up). The
 * anchor's word depth reads the PARAMS tail's live `finiteLevel` lane (the
 * shipped grid DDA's own convention), which keeps one live params
 * dependency in every kernel that includes this source — the bench's
 * control kernel derives its bind group from the auto layout, and a
 * bindingless-everywhere 3D walk silently drops binding 0 from it. The DFS
 * shape itself stays baked, since the codegen sizes the nests and the
 * private arrays from the level.
 *
 * The anchor's face vocabulary is the cell's FACET INDICES: the mask names
 * the incident leaf's crossed facets (5 bits in 4D), `planeIndices` stays
 * unused (all −1 — the facet identity rides the mask and the planes
 * recompute from the leaf's vertices), and `cellIndices` is the word.
 *
 * The refusal reasons are the transport's shared vocabulary, identical to
 * the shipped DDA's emission: 1 visit-cap (here: the pruned enumeration's
 * leaf cap), 2 invalid-input, 3 state-mismatch, 6
 * degenerate-projected-normal. A zero normal is the exact-corner
 * convention's rank-zero refusal sentinel.
 */
export function finiteSolidGeneralTransportSource(
  dim: 3 | 4,
  g: FiniteSolidGeneralWire,
  level: number,
): string {
  validateGeneralWire(dim, g, level);
  const count = g.mapMatrix.length;
  const leafCap = Math.min(
    count ** level,
    FINITE_SOLID_GENERAL_MAX_ENUM_LEAVES,
  );
  const endpointCap = leafCap * 2;
  const facetCount = generalFacetCount(dim, g);
  const facetRange = (1 << facetCount) - 1;
  const pushLeaf = (
    forwardVar: string,
    inverseVar: string,
    word: string,
  ): string =>
    `let facets = finCellFacets(${forwardVar}, ${inverseVar});
if (facets.ok) {
  let clip = finClipSimplex(facets, q, qd, select(0u, finAnchorMask, all(${word} == finAnchorWord)));
  if (clip.ok) {
    if (finTotal + 2u > ${endpointCap}u) {
      return false;
    }
    finPushEndpoint(clip.enter, 1u, ${word}, clip.enterMask);
    finPushEndpoint(clip.exit, 0u, ${word}, clip.exitMask);
  }
}
`;
  const enumerate =
    level === 0
      ? `  ${pushLeaf("finIdentity()", "finIdentity()", "vec4i(-1)").split("\n").join("\n  ")}
  return true;`
      : `  // The entry prune: the whole tree sits inside levelBoxes[level].
  if (!finClipAxisBox(FIN_BOX_MIN[${level}], FIN_BOX_MAX[${level}], q, qd)) {
    return true;
  }
${generalNestSource(
  level,
  (inv, remaining) =>
    `finClipAxisBox(FIN_BOX_MIN[${remaining}], FIN_BOX_MAX[${remaining}], finApply(${inv}, q) + ${inv}.t, finApply(${inv}, qd))`,
  pushLeaf,
  g.glassOnly === true,
)}  return true;`;
  return `struct FiniteBoundary {
  // 1 boundary, 2 miss, 3 refused — TransportBoundary's vocabulary.
  kind: u32,
  reason: u32,
  t: f32,
  normal: vec3f,
  // The full anchor out (the walk's continuation state): the snapped
  // intrinsic point, the incident leaf's crossed FACETS, the unused plane
  // slots (all −1) and the incident leaf's WORD. The next query rebuilds
  // the leaf's facets from the word and snaps/clamps onto them — the grid
  // DDA's anchor contract, one tree up.
  anchorIntrinsic: vec4f,
  anchorMask: u32,
  anchorPlanes: vec4i,
  anchorCells: vec4i,
  // The MEDIA transition (finiteSolidGeneralNextBoundary's from/to): the
  // medium codes before and after the event (air 0, a glass code, or
  // FIN_MEDIUM_OPAQUE) and the branch owning the medium after it (-1 in
  // air). On a state-mismatch refusal toMedium carries the medium the
  // GEOMETRY reads at the start (the refusal's geometryMedium).
  fromMedium: u32,
  toMedium: u32,
  toBranch: i32,
}

// The axis-aligned slab clip (clipAxisAlignedBox) — the node prune. The
// ray's parameter survives the inverse transform, so the node's line
// interval contains its subtree's leaf intervals exactly.
fn finClipAxisBox(lo: vec4f, hi: vec4f, p: vec4f, d: vec4f) -> bool {
  var enter = -1.0e30;
  var exit = 1.0e30;
  for (var axis = 0; axis < ${dim}; axis++) {
    let da = d[axis];
    if (da == 0.0) {
      if (p[axis] < lo[axis] || p[axis] > hi[axis]) {
        return false;
      }
      continue;
    }
    let ta = (lo[axis] - p[axis]) / da;
    let tb = (hi[axis] - p[axis]) / da;
    enter = max(enter, min(ta, tb));
    exit = min(exit, max(ta, tb));
    if (exit < enter) {
      return false;
    }
  }
  return exit > enter;
}

struct FinClip {
  ok: bool,
  enter: f32,
  exit: f32,
  enterMask: u32,
  exitMask: u32,
}

// Ray ∩ cell by its facet half-spaces (clipGeneralCell): a crossing
// is an entry when the ray moves inward, an exit when outward; a parallel
// facet requires the ray inside its half-space. No epsilon — only equal
// crossing times tie, and the binding facets ride the masks. onPlane
// names the facets an anchored restart's own leaf sits ON: their residual
// reads exactly zero (the oracle's rule — the snap's rounding, amplified
// by a grazing denominator, would otherwise move the leaf's own crossing
// off t = 0 and the restart would misread its starting side).
fn finClipSimplex(f: FinFacets, q: vec4f, qd: vec4f, onPlane: u32) -> FinClip {
  // (Facet-generic: a simplex's dim + 1 facets or a box's 2·dim.)
  var result: FinClip;
  result.ok = false;
  result.enter = -1.0e30;
  result.exit = 1.0e30;
  result.enterMask = 0u;
  result.exitMask = 0u;
  var enter = -1.0e30;
  var exit = 1.0e30;
  var enterMask = 0u;
  var exitMask = 0u;
  for (var k = 0; k < ${facetCount}; k++) {
    let denom = finDot(f.n[k], qd);
    let s = select(finDot(f.n[k], q) - f.c[k], 0.0, (onPlane & (1u << u32(k))) != 0u);
    if (denom == 0.0) {
      if (s > 0.0) {
        return result;
      }
      continue;
    }
    let t = -s / denom;
    if (denom > 0.0) {
      if (t < exit) {
        exit = t;
        exitMask = 1u << u32(k);
      } else if (t == exit) {
        exitMask = exitMask | (1u << u32(k));
      }
    } else {
      if (t > enter) {
        enter = t;
        enterMask = 1u << u32(k);
      } else if (t == enter) {
        enterMask = enterMask | (1u << u32(k));
      }
    }
  }
  if (!(exit > enter)) {
    return result;
  }
  result.ok = true;
  result.enter = enter;
  result.exit = exit;
  result.enterMask = enterMask;
  result.exitMask = exitMask;
  return result;
}

${generalRowXyzSource(dim)}
// The pruned enumeration's storage: one record per leaf ENDPOINT —
// (bits(t), packed) with packed bit 0 the delta (1 enter / 0 exit), bits
// 1..23 the word as a mixed-radix index, bits 24..31 the endpoint's
// binding facets (a 4D box has eight). Integer storage: the packed word is never
// routed through an f32 (a denormal or NaN pattern could be canonicalized).
// Module-scope private: per-invocation state, written before read.
var<private> finE: array<vec2u, ${endpointCap}>;
var<private> finTotal = 0u;
// The anchored restart's own leaf (its word and masked facets; mask 0 on a
// fresh query) — the enumeration's exact-zero residuals.
var<private> finAnchorWord = vec4i(-1);
var<private> finAnchorMask = 0u;

fn finPushEndpoint(t: f32, delta: u32, word: vec4i, facets: u32) {
  // The word as ONE mixed-radix index (first map most significant): at
  // most 48^4 - 1 < 2^23, so bit 0 the delta, bits 1..23 the word, bits
  // 24..31 the facets (a 4D box's eight).
  var index = 0u;
  for (var slot = 0; slot < i32(FIN_LEVEL); slot++) {
    index = index * FIN_MAP_COUNT + u32(max(word[slot], 0));
  }
  let packed = (delta & 1u) | (index << 1u) | ((facets & 255u) << 24u);
  finE[finTotal] = vec2u(bitcast<u32>(t), packed);
  finTotal = finTotal + 1u;
}

fn finEndpointT(i: u32) -> f32 {
  return bitcast<f32>(finE[i].x);
}

fn finEndpointWord(i: u32) -> vec4i {
  var index = (finE[i].y >> 1u) & 0x7fffffu;
  var word = vec4i(-1);
  for (var slot = i32(FIN_LEVEL) - 1; slot >= 0; slot--) {
    word[slot] = i32(index % FIN_MAP_COUNT);
    index = index / FIN_MAP_COUNT;
  }
  return word;
}

fn finEndpointFacets(i: u32) -> u32 {
  return (finE[i].y >> 24u) & 255u;
}

// The anchor reconstruction (the event's snap and the anchored restart's):
// snap the point onto the leaf's masked COMPOSED facet planes, then clamp
// the rest into the leaf by the bounded violated-facet projection, every
// move within the declared envelope — FIN_SNAP_REL of the larger of 1, the
// cell's radius and the SCALE of the arithmetic that produced the point
// (FINITE_SOLID_GENERAL_SNAP_REL's argument). ok = false is the
// invalid-input refusal.
// The ∞-norm over the construction's axes (intrinsicMagnitude).
fn finMagnitude(p: vec4f) -> f32 {
  var magnitude = 0.0;
  for (var axis = 0; axis < ${dim}; axis++) {
    magnitude = max(magnitude, abs(p[axis]));
  }
  return magnitude;
}

struct FinSnap {
  ok: bool,
  p: vec4f,
}

fn finSnapToLeaf(word: vec4i, mask: u32, pIn: vec4f, scale: f32) -> FinSnap {
  var out: FinSnap;
  out.ok = false;
  out.p = pIn;
  let cell = finCell(finWordAff(word, i32(params.finiteLevel)));
  let facets = finWordFacets(word, i32(params.finiteLevel));
  if (!facets.ok) {
    return out;
  }
  let envelope = FIN_SNAP_REL * max(max(1.0, finCellRadius(cell)), scale);
  var p = pIn;
  for (var k = 0; k < ${facetCount}; k++) {
    if ((mask & (1u << u32(k))) == 0u) {
      continue;
    }
    let correction = facets.c[k] - finDot(facets.n[k], p);
    if (abs(correction) > envelope) {
      return out;
    }
    p = p + correction * facets.n[k];
  }
  for (var sweep = 0; sweep <= ${facetCount}; sweep++) {
    var worst = -1;
    var worstS = 0.0;
    for (var k = 0; k < ${facetCount}; k++) {
      if ((mask & (1u << u32(k))) != 0u) {
        continue;
      }
      let s = finDot(facets.n[k], p) - facets.c[k];
      if (s > worstS) {
        worstS = s;
        worst = k;
      }
    }
    if (worst < 0) {
      break;
    }
    if (worstS > envelope) {
      return out;
    }
    p = p - worstS * facets.n[worst];
  }
  out.ok = true;
  out.p = p;
  return out;
}

// The exact-corner normal (simplicialBoundaryNormal): reflect/refract
// against the incident ray's projection onto the span of every tied face's
// DISPLAYED facet normal, Gram-Schmidt in the group's sorted-endpoint order
// (each face's masked facets ascending), a facet dependent below the
// declared rank ratio. A zero vector is the rank-zero refusal sentinel.
fn finGroupNormal(dir: vec3f, groupLo: u32, groupHi: u32, entering: bool) -> vec3f {
  var basis: array<vec3f, 3>;
  var basisCount = 0;
  for (var m = groupLo; m < groupHi && basisCount < 3; m++) {
    let mask = finEndpointFacets(m);
    let facets = finWordFacets(finEndpointWord(m), i32(FIN_LEVEL));
    if (!facets.ok) {
      return vec3f(0.0);
    }
    for (var k = 0; k < ${facetCount} && basisCount < 3; k++) {
      if ((mask & (1u << u32(k))) == 0u) {
        continue;
      }
      let n = facets.n[k];
      var vector = ((finiteRowXyz(0) * n.x + finiteRowXyz(1) * n.y) + finiteRowXyz(2) * n.z) + finiteRowXyz(3) * n.w;
      let full = length(vector);
      for (var bi = 0; bi < basisCount; bi++) {
        let projection = dot(vector, basis[bi]);
        vector = vector - projection * basis[bi];
      }
      let magnitude = length(vector);
      if (!(magnitude > FIN_NORMAL_DEPENDENT_REL * full)) {
        continue;
      }
      basis[basisCount] = vector / magnitude;
      basisCount = basisCount + 1;
    }
  }
  var projected = vec3f(0.0);
  for (var bi = 0; bi < basisCount; bi++) {
    projected = projected + dot(dir, basis[bi]) * basis[bi];
  }
  let magnitude = length(projected);
  if (!(magnitude > 0.0)) {
    return vec3f(0.0);
  }
  let faceSign = select(1.0, -1.0, entering);
  return (faceSign * projected) / magnitude;
}

fn finRefusal(reason: u32) -> FiniteBoundary {
  var result: FiniteBoundary;
  result.kind = 3u;
  result.reason = reason;
  result.t = 0.0;
  result.normal = vec3f(0.0);
  result.anchorIntrinsic = vec4f(0.0);
  result.anchorMask = 0u;
  result.anchorPlanes = vec4i(-1);
  result.anchorCells = vec4i(-1);
  result.fromMedium = 0u;
  result.toMedium = 0u;
  result.toBranch = -1;
  return result;
}

// One medium transition along the ray
// (simplicialBoundaryEvent): the tied faces' span carries the projected
// normal, facing against the ray unless the medium after is air; the anchor
// names the INCIDENT leaf — the group's sorted-first endpoint's leaf — whose
// own crossed facets are the mask and whose composed facet planes are the
// snap targets.
fn finEvent(
  q: vec4f,
  qd: vec4f,
  dir: vec3f,
  t: f32,
  before: u32,
  after: u32,
  afterBranch: i32,
  groupLo: u32,
  groupHi: u32,
) -> FiniteBoundary {
  let entering = after != 0u;
  let normal = finGroupNormal(dir, groupLo, groupHi, entering);
  if (all(normal == vec3f(0.0))) {
    return finRefusal(6u);
  }
  let word = finEndpointWord(groupLo);
  let mask = finEndpointFacets(groupLo);
  let snap = finSnapToLeaf(word, mask, q + t * qd, max(finMagnitude(q), abs(t)));
  if (!snap.ok) {
    return finRefusal(2u);
  }
  var result: FiniteBoundary;
  result.kind = 1u;
  result.reason = 0u;
  result.t = t;
  result.normal = normal;
  result.anchorIntrinsic = snap.p;
  result.anchorMask = mask;
  result.anchorPlanes = vec4i(-1);
  result.anchorCells = word;
  result.fromMedium = before;
  result.toMedium = after;
  result.toBranch = afterBranch;
  return result;
}

// The walk's DFS in explicit nests (the level baked): the word tree's
// leaves in lexicographic word order, each subtree pruned when the ray
// misses its word-image of the level box — the box contains the subtree by
// construction, so the pruned enumeration equals the reference's unpruned
// one endpoint for endpoint. Capped: past the leaf cap the walk refuses.
fn finEnumerate(q: vec4f, qd: vec4f) -> bool {
${enumerate}
}

// The stable sort (by t; ties keep the DFS enumeration order — the
// reference's stable sort, which is what makes the group's sorted-first
// endpoint and the facet order reproducible).
fn finSortEndpoints() {
  for (var i = 1u; i < finTotal; i++) {
    let key = finE[i];
    let keyT = bitcast<f32>(key.x);
    var j = i;
    loop {
      if (j == 0u) {
        break;
      }
      if (!(finEndpointT(j - 1u) > keyT)) {
        break;
      }
      finE[j] = finE[j - 1u];
      j = j - 1u;
    }
    finE[j] = key;
  }
}

// The endpoint sweep (the reference's group walk): greedy groups from each
// group's first t within FIN_TIE_REL, coverage counted PER BRANCH and the
// medium after each group the owner rule's; the state at tMin (always 0 on
// the transport — the fresh and anchored queries both start there) is the
// last at-or-before group's AFTER-medium; the first later MEDIUM CHANGE is
// the event. A group that leaves the medium unchanged (a shared face, an
// overlap's interior face, a crossing between equal-material glass
// subtrees) traverses silently. The claim is a medium code — the
// single-material solid's 0/1 is its glass-code-1 case.
fn finSweep(q: vec4f, qd: vec4f, dir: vec3f, claim: u32, anchored: bool) -> FiniteBoundary {
  for (var a = 0; a < i32(FIN_MAP_COUNT); a++) {
    finBranchCov[a] = 0;
  }
  var medium = 0u;
  var idx = 0u;
  var haveStart = false;
  var startMedium = 0u;
  var startBranch = -1;
  var startAtGroup = false;
  var startLo = 0u;
  var startHi = 0u;
  // The first medium change AFTER the start, held until the claim check
  // has admitted the walk (the reference's order: a mismatching claim
  // refuses before any walk event is emitted).
  var haveFlip = false;
  var flipT = 0.0;
  var flipBefore = 0u;
  var flipAfter = 0u;
  var flipBranch = -1;
  var flipLo = 0u;
  var flipHi = 0u;
  var started = false;
  while (idx < finTotal) {
    let groupT = finEndpointT(idx);
    let tie = FIN_TIE_REL * max(1.0, abs(groupT));
    var j = idx;
    while (j < finTotal && finEndpointT(j) - groupT <= tie) {
      let branch = max(finEndpointWord(j)[0], 0);
      finBranchCov[branch] = finBranchCov[branch] + select(-1, 1, (finE[j].y & 1u) == 1u);
      j = j + 1u;
    }
    let before = medium;
    let owner = finMediumOfCoverage();
    medium = u32(owner.x);
    if (!started && groupT <= tie) {
      haveStart = true;
      startMedium = medium;
      startBranch = owner.y;
      startAtGroup = abs(groupT) <= tie;
      startLo = idx;
      startHi = j;
      idx = j;
      continue;
    }
    started = true;
    if (!haveFlip && before != medium) {
      haveFlip = true;
      flipT = groupT;
      flipBefore = before;
      flipAfter = medium;
      flipBranch = owner.y;
      flipLo = idx;
      flipHi = j;
    }
    idx = j;
  }
  // The claim check: off a boundary the claim must match; ON the start
  // group the UNANCHORED query may anticipate the crossing (the display
  // march's primary hit), FROM the claimed medium; the anchored
  // continuation takes no liberty.
  if (startMedium != claim) {
    if (haveStart && startAtGroup && !anchored) {
      return finEvent(q, qd, dir, 0.0, claim, startMedium, startBranch, startLo, startHi);
    }
    var mismatch = finRefusal(3u);
    mismatch.toMedium = startMedium;
    return mismatch;
  }
  if (haveFlip) {
    return finEvent(q, qd, dir, flipT, flipBefore, flipAfter, flipBranch, flipLo, flipHi);
  }
  var miss = finRefusal(0u);
  miss.kind = 2u;
  return miss;
}

// The word-tree boundary query (finiteSolidGeneralNextBoundary /
// NextBoundaryFromAnchor, pruned): the intrinsic anchor is authoritative
// (the rounded display coordinate cannot replace the canonical boundary
// origin); the anchor's word names the incident leaf and its mask the
// crossed facets.
fn transportFiniteBoundary(
  origin: vec3f,
  dir: vec3f,
  anchorPresent: u32,
  anchorIntrinsic: vec4f,
  anchorMask: u32,
  anchorPlanesIn: vec4i,
  anchorCellsIn: vec4i,
  claim: u32,
) -> FiniteBoundary {
  if (!all(abs(dir) <= vec3f(3.402823466e38)) || !(dot(dir, dir) > 0.0)) {
    return finRefusal(2u);
  }
  let qdA = finiteLiftDir(dir);
  let qd = vec4f(qdA[0], qdA[1], qdA[2], qdA[3]);
  var q: vec4f;
  if (anchorPresent == 1u) {
    // validGeneralAnchor: the mask within the cell's facet range and
    // nonzero, every plane slot unused, the word naming real maps at the
    // construction's depth.
    if (anchorMask == 0u || (anchorMask & ~${facetRange}u) != 0u ||
        !all(abs(anchorIntrinsic) <= vec4f(3.402823466e38)) ||
        any(anchorPlanesIn != vec4i(-1))) {
      return finRefusal(2u);
    }
    var depth = 0;
    for (var slot = 0; slot < 4; slot++) {
      let index = anchorCellsIn[slot];
      if (index == -1) {
        break;
      }
      if (index < 0 || index >= i32(FIN_MAP_COUNT)) {
        return finRefusal(2u);
      }
      depth = depth + 1;
    }
    if (depth != i32(params.finiteLevel)) {
      return finRefusal(2u);
    }
    for (var slot = depth; slot < 4; slot++) {
      if (anchorCellsIn[slot] != -1) {
        return finRefusal(2u);
      }
    }
    let snap = finSnapToLeaf(anchorCellsIn, anchorMask, anchorIntrinsic, finMagnitude(anchorIntrinsic));
    if (!snap.ok) {
      return finRefusal(2u);
    }
    q = snap.p;
  } else {
    let qA = finiteLift(origin);
    q = vec4f(qA[0], qA[1], qA[2], qA[3]);
  }
  finTotal = 0u;
  finAnchorWord = anchorCellsIn;
  finAnchorMask = select(0u, anchorMask, anchorPresent == 1u);
  if (!finEnumerate(q, qd)) {
    // The pruned enumeration overflowed its cap: a disclosed refusal, the
    // shipped DDA's own resource-refusal shape — never a truncation.
    return finRefusal(1u);
  }
  finSortEndpoints();
  return finSweep(q, qd, dir, claim, anchorPresent == 1u);
}
`;
}

/** The pose rows the exact-corner normal reads, one per intrinsic axis,
 * xyz only: the 4D pose IS the shared tail's rotor-inverse rows; 3D is the
 * identity. Same emission the shipped transport's rowsFn makes. */
function generalRowXyzSource(dim: 3 | 4): string {
  const rows =
    dim === 4
      ? `    params.rotorInvR0.xyz,
    params.rotorInvR1.xyz,
    params.rotorInvR2.xyz,
    params.rotorInvR3.xyz,`
      : `    vec3f(1.0, 0.0, 0.0),
    vec3f(0.0, 1.0, 0.0),
    vec3f(0.0, 0.0, 1.0),
    vec3f(0.0, 0.0, 0.0),`;
  return `fn finiteRowXyz(axis: i32) -> vec3f {
  var rows = array<vec3f, 4>(
${rows}
  );
  return rows[axis];
}
`;
}

/** Integer occupancy predicate used by the f32 DDA twin. The depth-two
 * masks mirror the GPU hot path; other levels keep the generic rule. */
export function finiteSolidCellOccupiedF32(
  dim: 3 | 4,
  level: number,
  idx: readonly number[],
): boolean {
  const grid = 3 ** level;
  for (let a = 0; a < dim; a++) {
    if (!Number.isInteger(idx[a]) || idx[a] < 0 || idx[a] >= grid) return false;
  }
  if (level === 2) {
    let coarseMiddles = 0;
    let fineMiddles = 0;
    for (let a = 0; a < dim; a++) {
      coarseMiddles += (FINITE_D2_COARSE_MIDDLE_MASK >>> idx[a]) & 1;
      fineMiddles += (FINITE_D2_FINE_MIDDLE_MASK >>> idx[a]) & 1;
    }
    return coarseMiddles <= 1 && fineMiddles <= 1;
  }
  let div = Math.floor(grid / 3);
  for (let l = 0; l < level; l++) {
    let middles = 0;
    for (let a = 0; a < dim; a++) {
      if (Math.floor(Math.floor(idx[a] / div) % 3) === 1) middles++;
    }
    if (middles > 1) return false;
    div = Math.floor(div / 3);
  }
  return true;
}

/**
 * The WGSL DDA re-executed in TypeScript with every arithmetic result
 * rounded to f32 (`sphereInversionF32`'s discipline one family over) —
 * the bench legs' twin for a DISCRETE walk. The f64 oracle stays the
 * soundness record (`finite-solid.ts`, pinned by its harness); this twin
 * exists because the DDA's cell sequence is decided by exact tie tests
 * and integer-adjacent classifications, which an f64 twin does not
 * bracket: the kernel's f32 crossing times can order two near-equal
 * axes differently than f64, and the walks then genuinely diverge. WGSL
 * permits differences from this per-operation rounding, including fused
 * arithmetic and division/square-root accuracy. The agreement leg checks
 * decisions and canonical identities independently from numeric tolerances;
 * a different cell at the same crossing is not rounding slack.
 * Inputs are f32-quantized here (the control wire's own contract): the
 * caller may pass f64, the twin rounds first. The carried
 * `inside` is checked against the canonical start cell. A disagreement
 * refuses instead of silently changing the medium or discarding a face.
 *
 * `poseRows` is the 4D world→intrinsic pose (row-major, one Vec4 per
 * row) and `w0` the slice; 3D passes null (the identity pose, the
 * lift exact). `anchor` null is the non-anchored world-origin call.
 */
export interface FiniteSolidDdaF32Result {
  kind: 1 | 2 | 3;
  reason: number;
  t: number;
  normal: Vec3;
  anchor: FiniteSolidAnchor | null;
  /** The general walk's media transition (the WGSL FiniteBoundary's
   * fields; absent from the grid DDA's twin). On a state-mismatch refusal
   * `toMedium` is the geometry's own start medium. */
  fromMedium?: number;
  toMedium?: number;
  toBranch?: number;
}

export function finiteSolidDdaF32(
  dim: 3 | 4,
  level: number,
  halfIn: number,
  poseRowsIn: readonly Vec4[] | null,
  w0: number,
  origin: Vec3,
  dirIn: Vec3,
  anchor: FiniteSolidAnchor | null,
  inside: boolean,
  cacheCrossings = true,
): FiniteSolidDdaF32Result {
  const f = Math.fround;
  const half = f(halfIn);
  const dir = dirIn.map(f) as Vec3;
  const poseRows = poseRowsIn?.map((row) => row.map(f) as Vec4) ?? null;
  const grid = 3 ** level;
  const envelope = f(half * FINITE_ENVELOPE_REL);
  const finiteGridPlane = (i: number): number => {
    if (i === 0) return f(-half);
    if (i === grid) return f(half);
    return f(f(f(half * f(2 * i - grid))) / grid);
  };
  const finiteOccupied = (idx: number[]): boolean =>
    finiteSolidCellOccupiedF32(dim, level, idx);
  const rowXyz = (axis: number): Vec3 => {
    // 3D (poseRows null) IS the identity pose — the WGSL 3D rowsFn emits
    // the identity rows, so the twin must too. Returning zeros here made
    // every 3D event's normal degenerate (reason 6) and vacuously
    // absolved the bench's 3D finite leg through the decision-flip class.
    const row = poseRows
      ? poseRows[axis]
      : axis === 0
        ? [1, 0, 0, 0]
        : axis === 1
          ? [0, 1, 0, 0]
          : [0, 0, 1, 0];
    return [f(row[0]), f(row[1]), f(row[2])];
  };
  // The lift: 3D exact; 4D the row dots (FMA-sensitive on a real driver —
  // the canonical identity pose the legs drive is exact).
  const q: number[] = [0, 0, 0, 0];
  const qd: number[] = [0, 0, 0, 0];
  if (poseRows) {
    const pv = anchor ? [] : [f(origin[0]), f(origin[1]), f(origin[2]), f(w0)];
    for (let a = 0; a < 4; a++) {
      const row = poseRows[a];
      if (!anchor) {
        q[a] = f(
          f(f(f(row[0] * pv[0]) + f(row[1] * pv[1])) + f(row[2] * pv[2])) +
            f(row[3] * pv[3]),
        );
      }
      qd[a] = f(
        f(f(row[0] * dir[0]) + f(row[1] * dir[1])) + f(row[2] * dir[2]),
      );
    }
  } else {
    if (!anchor) {
      q[0] = f(origin[0]);
      q[1] = f(origin[1]);
      q[2] = f(origin[2]);
      q[3] = 0;
    }
    qd[0] = f(dir[0]);
    qd[1] = f(dir[1]);
    qd[2] = f(dir[2]);
    qd[3] = 0;
  }
  const maxVisits = dim * (grid - 1) + 1;
  const miss = (): FiniteSolidDdaF32Result => ({
    kind: 2,
    reason: 0,
    t: 0,
    normal: [0, 0, 0],
    anchor: null,
  });
  const refused = (reason: number): FiniteSolidDdaF32Result => ({
    kind: 3,
    reason,
    t: 0,
    normal: [0, 0, 0],
    anchor: null,
  });
  if (
    !dir.every(Number.isFinite) ||
    !(f(f(dir[0] * dir[0]) + f(f(dir[1] * dir[1]) + f(dir[2] * dir[2]))) > 0)
  ) {
    return refused(2);
  }
  if (anchor) {
    if (
      !Number.isInteger(anchor.planeMask) ||
      anchor.planeMask <= 0 ||
      (anchor.planeMask & ~((1 << dim) - 1)) !== 0 ||
      anchor.intrinsicPoint.length !== 4 ||
      anchor.planeIndices.length !== 4 ||
      anchor.cellIndices.length !== 4
    ) {
      return refused(2);
    }
    for (let a = 0; a < 4; a++) {
      const point = f(anchor.intrinsicPoint[a]);
      const plane = anchor.planeIndices[a];
      const cell = anchor.cellIndices[a];
      if (
        !Number.isFinite(point) ||
        !Number.isInteger(plane) ||
        !Number.isInteger(cell)
      ) {
        return refused(2);
      }
      if ((anchor.planeMask & (1 << a)) !== 0) {
        if (
          plane < 0 ||
          plane > grid ||
          (cell !== plane - 1 && cell !== plane)
        ) {
          return refused(2);
        }
        const planeValue = finiteGridPlane(plane);
        if (Math.abs(f(point - planeValue)) > envelope) return refused(2);
        q[a] = planeValue;
      } else {
        if (plane !== -1) return refused(2);
        if (a >= dim) {
          if (cell !== -1) return refused(2);
          continue;
        }
        if (cell < 0 || cell >= grid) return refused(2);
        const lower = finiteGridPlane(cell);
        const upper = finiteGridPlane(cell + 1);
        if (point < f(lower - envelope) || point > f(upper + envelope)) {
          return refused(2);
        }
        q[a] = point;
        if (q[a] < lower) q[a] = lower;
        else if (q[a] > upper) q[a] = upper;
      }
    }
  }
  let enter = f(-1e30);
  let enterAxes: number[] = [];
  let start = 0;
  if (!anchor) {
    let exitT = f(1e30);
    for (let a = 0; a < dim; a++) {
      if (qd[a] === 0) {
        if (q[a] < f(-half) || q[a] > f(half)) return miss();
        continue;
      }
      const ta = f(f(f(-half) - q[a]) / qd[a]);
      const tb = f(f(half - q[a]) / qd[a]);
      const near = f(Math.min(ta, tb));
      const far = f(Math.max(ta, tb));
      if (near > enter) {
        enter = near;
        enterAxes = [a];
      } else if (near === enter) {
        enterAxes.push(a);
      }
      exitT = f(Math.min(exitT, far));
      if (exitT < enter) return miss();
    }
    start = f(Math.max(0, enter));
    if (exitT < start || (!anchor && exitT === start)) return miss();
  }
  const raySideIndex = (value: number, d: number): number => {
    if (value < f(-half) || (value === f(-half) && d < 0)) return -1;
    if (value > f(half) || (value === f(half) && d > 0)) return grid;
    for (let planeIndex = 1; planeIndex < grid; planeIndex++) {
      const plane = finiteGridPlane(planeIndex);
      if (value < plane || (value === plane && d < 0)) {
        return planeIndex - 1;
      }
    }
    return grid - 1;
  };
  const index: number[] = [0, 0, 0, 0];
  if (!anchor) {
    for (let a = 0; a < dim; a++) {
      index[a] = raySideIndex(f(q[a] + f(start * qd[a])), qd[a]);
    }
    if (start === enter) {
      for (const a of enterAxes) index[a] = qd[a] > 0 ? 0 : grid - 1;
    }
  }
  if (anchor) {
    for (let a = 0; a < dim; a++) {
      index[a] = anchor.cellIndices[a];
      if ((anchor.planeMask & (1 << a)) === 0) continue;
      if (qd[a] === 0) return refused(4);
      index[a] =
        qd[a] > 0 ? anchor.planeIndices[a] : anchor.planeIndices[a] - 1;
    }
  }
  let visits = 0;
  let sideInside = finiteOccupied(index);
  let inGridStart = true;
  for (let a = 0; a < dim; a++) {
    inGridStart = inGridStart && index[a] >= 0 && index[a] < grid;
  }
  if (inGridStart) visits++;
  const mediumInside = inside;
  const boundaryNormal = (
    planeMask: number,
    entering: boolean,
  ): Vec3 | null => {
    if (planeMask > 0 && (planeMask & (planeMask - 1)) === 0) {
      let axis = 0;
      let m = planeMask;
      while (m > 1) {
        m = m >> 1;
        axis++;
      }
      const row = rowXyz(axis);
      const magnitude = f(
        Math.sqrt(
          f(f(f(row[0] * row[0]) + f(row[1] * row[1])) + f(row[2] * row[2])),
        ),
      );
      if (!(magnitude > 0)) return null;
      const intrinsicDirection = f(
        f(f(row[0] * dir[0]) + f(row[1] * dir[1])) + f(row[2] * dir[2]),
      );
      const directionSign = intrinsicDirection > 0 ? 1 : -1;
      const faceSign = entering ? -directionSign : directionSign;
      return [
        f(f(faceSign * row[0]) / magnitude),
        f(f(faceSign * row[1]) / magnitude),
        f(f(faceSign * row[2]) / magnitude),
      ];
    }
    const basis: Vec3[] = [];
    for (let axis = 0; axis < dim && basis.length < 3; axis++) {
      if ((planeMask & (1 << axis)) === 0) continue;
      let vector = [...rowXyz(axis)];
      for (const unit of basis) {
        const projection = f(
          f(f(vector[0] * unit[0]) + f(vector[1] * unit[1])) +
            f(vector[2] * unit[2]),
        );
        vector = [
          f(vector[0] - f(projection * unit[0])),
          f(vector[1] - f(projection * unit[1])),
          f(vector[2] - f(projection * unit[2])),
        ];
      }
      const magnitude = f(
        Math.sqrt(
          f(
            f(f(vector[0] * vector[0]) + f(vector[1] * vector[1])) +
              f(vector[2] * vector[2]),
          ),
        ),
      );
      if (!(magnitude > 0)) continue;
      basis.push([
        f(vector[0] / magnitude),
        f(vector[1] / magnitude),
        f(vector[2] / magnitude),
      ]);
    }
    const projected: Vec3 = [0, 0, 0];
    for (const unit of basis) {
      const amount = f(
        f(f(dir[0] * unit[0]) + f(dir[1] * unit[1])) + f(dir[2] * unit[2]),
      );
      projected[0] = f(projected[0] + f(amount * unit[0]));
      projected[1] = f(projected[1] + f(amount * unit[1]));
      projected[2] = f(projected[2] + f(amount * unit[2]));
    }
    const magnitude = f(
      Math.sqrt(
        f(
          f(f(projected[0] * projected[0]) + f(projected[1] * projected[1])) +
            f(projected[2] * projected[2]),
        ),
      ),
    );
    if (!(magnitude > 0)) return null;
    const sign = entering ? -1 : 1;
    return [
      f(f(sign * projected[0]) / magnitude),
      f(f(sign * projected[1]) / magnitude),
      f(f(sign * projected[2]) / magnitude),
    ];
  };
  const event = (
    t: number,
    entering: boolean,
    axes: number[],
    planeIndices: number[],
    cells: number[],
  ): FiniteSolidDdaF32Result => {
    let axis = axes[0];
    let planeMask = 0;
    for (const a of axes) {
      if (Math.abs(qd[a]) > Math.abs(qd[axis])) axis = a;
      planeMask |= 1 << a;
    }
    const normal = boundaryNormal(planeMask, entering);
    if (!normal) return refused(6);
    const intrinsic = [0, 0, 0, 0];
    const anchorPlanes = [-1, -1, -1, -1];
    const anchorCells = [-1, -1, -1, -1];
    for (let a = 0; a < dim; a++) {
      intrinsic[a] = f(q[a] + f(t * qd[a]));
      anchorCells[a] = cells[a];
    }
    for (const a of axes) {
      anchorPlanes[a] = planeIndices[a];
      intrinsic[a] = finiteGridPlane(planeIndices[a]);
    }
    for (let a = 0; a < dim; a++) {
      if ((planeMask & (1 << a)) !== 0) continue;
      const lower = finiteGridPlane(anchorCells[a]);
      const upper = finiteGridPlane(anchorCells[a] + 1);
      if (intrinsic[a] < lower) {
        if (f(lower - intrinsic[a]) > envelope) return refused(2);
        intrinsic[a] = lower;
      } else if (intrinsic[a] > upper) {
        if (f(intrinsic[a] - upper) > envelope) return refused(2);
        intrinsic[a] = upper;
      }
    }
    return {
      kind: 1,
      reason: 0,
      t,
      normal,
      anchor: {
        intrinsicPoint: [
          intrinsic[0],
          intrinsic[1],
          intrinsic[2],
          intrinsic[3],
        ] as Vec4,
        planeMask,
        planeIndices: anchorPlanes as [number, number, number, number],
        cellIndices: anchorCells as [number, number, number, number],
      },
    };
  };
  if (sideInside !== mediumInside) {
    if (anchor) return refused(3);
    let axes: number[];
    if (start === enter) {
      axes = enterAxes;
    } else {
      axes = [];
      for (let a = 0; a < dim; a++) {
        const at = f(q[a] + f(start * qd[a]));
        const planeIndex = qd[a] > 0 ? index[a] : index[a] + 1;
        if (at === finiteGridPlane(planeIndex) && qd[a] !== 0) axes.push(a);
      }
    }
    if (axes.length === 0) return refused(3);
    const planeIndices = [-1, -1, -1, -1];
    for (const a of axes) {
      planeIndices[a] = qd[a] > 0 ? index[a] : index[a] + 1;
    }
    return event(start, sideInside, axes, planeIndices, index);
  }
  const cachedCrossingT = [1e30, 1e30, 1e30, 1e30];
  if (cacheCrossings) {
    for (let a = 0; a < dim; a++) {
      if (qd[a] === 0) continue;
      const planeIndex = qd[a] > 0 ? index[a] + 1 : index[a];
      const plane = finiteGridPlane(planeIndex);
      cachedCrossingT[a] = f(f(plane - q[a]) / qd[a]);
    }
  }
  for (;;) {
    let nextT = 1e30;
    const crossingT = cacheCrossings
      ? cachedCrossingT
      : [1e30, 1e30, 1e30, 1e30];
    for (let a = 0; a < dim; a++) {
      if (qd[a] === 0) continue;
      if (!cacheCrossings) {
        const planeIndex = qd[a] > 0 ? index[a] + 1 : index[a];
        const plane = finiteGridPlane(planeIndex);
        crossingT[a] = f(f(plane - q[a]) / qd[a]);
      }
      nextT = f(Math.min(nextT, crossingT[a]));
    }
    if (nextT >= 1e30) return miss();
    if (nextT < start) return refused(5);
    const axes: number[] = [];
    for (let a = 0; a < dim; a++) {
      if (crossingT[a] === nextT) axes.push(a);
    }
    for (const a of axes) index[a] += qd[a] > 0 ? 1 : -1;
    let inRoot = true;
    for (let a = 0; a < dim; a++) {
      inRoot = inRoot && index[a] >= 0 && index[a] < grid;
    }
    if (inRoot) {
      if (visits >= maxVisits) return refused(1);
      visits++;
    }
    const nextInside = inRoot && finiteOccupied(index);
    if (nextInside !== sideInside) {
      const planeIndices = [-1, -1, -1, -1];
      for (const a of axes) {
        planeIndices[a] = qd[a] > 0 ? index[a] : index[a] + 1;
      }
      const result = event(nextT, nextInside, axes, planeIndices, index);
      if (result.kind === 3) return result;
      if (sideInside !== mediumInside) return refused(3);
      return result;
    }
    sideInside = nextInside;
    if (!inRoot) return miss();
    if (cacheCrossings) {
      for (const a of axes) {
        const planeIndex = qd[a] > 0 ? index[a] + 1 : index[a];
        const plane = finiteGridPlane(planeIndex);
        crossingT[a] = f(f(plane - q[a]) / qd[a]);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The general walk's f32 twin — `finiteSolidDdaF32`'s discipline one tree
// up. The WGSL walk re-executes in TypeScript with every arithmetic result
// rounded to f32 (`sphereInversionF32`'s discipline): the sweep's group
// formation and the event's anchor reconstruction are decided by tie tests
// and clamped projections, which an f64 twin does not bracket. WGSL
// permits differences from this per-operation rounding, including fused
// arithmetic and division/square-root accuracy; the bench legs treat the
// tie-edge class the escape legs' way (an ensemble + a capped absolution),
// never a raised tolerance. Inputs are f32-quantized here — the control
// wire's own contract.
// ---------------------------------------------------------------------------

type F32Vec4 = [number, number, number, number];

interface F32Aff {
  r: [F32Vec4, F32Vec4, F32Vec4, F32Vec4];
  t: F32Vec4;
}

interface GeneralEndpointF32 {
  t: number;
  delta: number;
  word: [number, number, number, number];
  facets: number;
}

/**
 * The WGSL general walk re-executed in TypeScript with every arithmetic
 * result rounded to f32 — the general bench legs' twin, mirroring
 * {@link finiteSolidGeneralTransportSource}'s emission term for term (the
 * `finDot`/`finRowTimes`/`finCompose`/`finChildInverse` algebra, the facet
 * construction, the pruned nests, the stable sort, the sweep and the
 * snap). The f64 oracle (`finite-solid.ts`'s general section, pinned by
 * its harness) stays the soundness record.
 *
 * `poseRows` is the 4D world→intrinsic pose (row-major, one Vec4 per row)
 * and `w0` the slice; 3D passes null (the identity pose, the lift exact).
 * `anchor` null is the non-anchored world-origin call.
 */
export function finiteSolidGeneralDdaF32(
  dim: 3 | 4,
  level: number,
  g: FiniteSolidGeneralWire,
  poseRowsIn: readonly Vec4[] | null,
  w0: number,
  origin: Vec3,
  dirIn: Vec3,
  anchor: FiniteSolidAnchor | null,
  /** The claimed medium: a medium code, or the single-material form's
   * inside flag (true = glass code 1). */
  inside: boolean | number,
): FiniteSolidDdaF32Result {
  const claim = typeof inside === "number" ? inside : inside ? 1 : 0;
  validateGeneralWire(dim, g, level);
  const f = Math.fround;
  const v4 = (v: readonly number[]): F32Vec4 => [
    f(v[0]),
    f(v[1]),
    f(v[2]),
    f(v[3]),
  ];
  const dir = dirIn.map(f) as Vec3;
  const poseRows = poseRowsIn?.map(v4) ?? null;
  const mapCount = g.mapMatrix.length;
  const inverses = finiteSolidGeneralInverseMaps(g);
  const affOf = (m: readonly number[], t: readonly number[]): F32Aff => ({
    r: [
      v4(m.slice(0, 4)),
      v4(m.slice(4, 8)),
      v4(m.slice(8, 12)),
      v4(m.slice(12, 16)),
    ],
    t: v4(t),
  });
  const maps = g.mapMatrix.map((m, i) => affOf(m, g.mapOffset[i]));
  const inverseMaps = inverses.map((inv) => affOf(inv.m, inv.t));
  const root = g.rootVertices.map(v4);
  const boxMin = g.levelBoxes.map((box) => v4(box.min));
  const boxMax = g.levelBoxes.map((box) => v4(box.max));
  const tieRel = f(FINITE_ENVELOPE_REL);
  const dependentRel = f(FINITE_SOLID_GENERAL_NORMAL_DEPENDENT_REL);
  const snapRel = f(FINITE_SOLID_GENERAL_SNAP_REL);
  const magnitude = (p: readonly number[]): number => {
    let value = 0;
    for (let axis = 0; axis < dim; axis++) {
      value = Math.max(value, Math.abs(p[axis]));
    }
    return value;
  };
  const leafCap = Math.min(
    mapCount ** level,
    FINITE_SOLID_GENERAL_MAX_ENUM_LEAVES,
  );
  // The cell's facet count by root kind (a simplex's dim + 1, a box's
  // 2·dim); the simplex construction's own vertex count stays dim + 1.
  const facetCount = generalFacetCount(dim, g);
  const simplexCount = dim + 1;
  const miss = (): FiniteSolidDdaF32Result => ({
    kind: 2,
    reason: 0,
    t: 0,
    normal: [0, 0, 0],
    anchor: null,
  });
  const refused = (reason: number): FiniteSolidDdaF32Result => ({
    kind: 3,
    reason,
    t: 0,
    normal: [0, 0, 0],
    anchor: null,
    fromMedium: 0,
    toMedium: 0,
    toBranch: -1,
  });
  // The owner rule over per-branch coverage (finMediumOfCoverage).
  const media = Array.from({ length: mapCount }, (_, a) => g.media?.[a] ?? 1);
  const mediumOf = (
    coverage: readonly number[],
  ): { medium: number; branch: number } => {
    let glass = -1;
    for (let a = 0; a < mapCount; a++) {
      if (coverage[a] <= 0) continue;
      if (media[a] === 0) {
        return { medium: FINITE_SOLID_MEDIUM_OPAQUE, branch: a };
      }
      if (glass < 0) glass = a;
    }
    return glass < 0
      ? { medium: 0, branch: -1 }
      : { medium: media[glass], branch: glass };
  };

  // The algebra (finDot / finApply / finRowTimes / finCompose /
  // finChildInverse), left-associated in the oracle's term order.
  const dot4 = (a: readonly number[], b: readonly number[]): number =>
    f(f(f(f(a[0] * b[0]) + f(a[1] * b[1])) + f(a[2] * b[2])) + f(a[3] * b[3]));
  const add4 = (a: readonly number[], b: readonly number[]): F32Vec4 => [
    f(a[0] + b[0]),
    f(a[1] + b[1]),
    f(a[2] + b[2]),
    f(a[3] + b[3]),
  ];
  const sub4 = (a: readonly number[], b: readonly number[]): F32Vec4 => [
    f(a[0] - b[0]),
    f(a[1] - b[1]),
    f(a[2] - b[2]),
    f(a[3] - b[3]),
  ];
  const scale4 = (s: number, a: readonly number[]): F32Vec4 => [
    f(s * a[0]),
    f(s * a[1]),
    f(s * a[2]),
    f(s * a[3]),
  ];
  const apply = (m: F32Aff, v: readonly number[]): F32Vec4 => [
    dot4(m.r[0], v),
    dot4(m.r[1], v),
    dot4(m.r[2], v),
    dot4(m.r[3], v),
  ];
  const rowTimes = (row: readonly number[], m: F32Aff): F32Vec4 =>
    add4(
      add4(
        add4(scale4(row[0], m.r[0]), scale4(row[1], m.r[1])),
        scale4(row[2], m.r[2]),
      ),
      scale4(row[3], m.r[3]),
    );
  const identity = (): F32Aff => ({
    r: [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ],
    t: [0, 0, 0, 0],
  });
  const compose = (acc: F32Aff, a: number): F32Aff => {
    const m = maps[a];
    return {
      r: [
        rowTimes(acc.r[0], m),
        rowTimes(acc.r[1], m),
        rowTimes(acc.r[2], m),
        rowTimes(acc.r[3], m),
      ],
      t: [
        f(dot4(acc.r[0], m.t) + acc.t[0]),
        f(dot4(acc.r[1], m.t) + acc.t[1]),
        f(dot4(acc.r[2], m.t) + acc.t[2]),
        f(dot4(acc.r[3], m.t) + acc.t[3]),
      ],
    };
  };
  const childInverse = (parent: F32Aff, b: number): F32Aff => {
    const im = inverseMaps[b];
    const d = sub4(parent.t, maps[b].t);
    return {
      r: [
        rowTimes(im.r[0], parent),
        rowTimes(im.r[1], parent),
        rowTimes(im.r[2], parent),
        rowTimes(im.r[3], parent),
      ],
      t: apply(im, d),
    };
  };
  const wordAff = (word: readonly number[], depth: number): F32Aff => {
    let acc = identity();
    for (let slot = 0; slot < depth; slot++) acc = compose(acc, word[slot]);
    return acc;
  };
  const wordInverse = (word: readonly number[], depth: number): F32Aff => {
    let acc = identity();
    for (let slot = 0; slot < depth; slot++) {
      acc = childInverse(acc, word[slot]);
    }
    return acc;
  };
  const cellOf = (m: F32Aff): F32Vec4[] =>
    root.map((v) => add4(apply(m, v), m.t));

  // The facets (finFacets / finCross / finMinor).
  const cross = (e1: F32Vec4, e2: F32Vec4, e3: F32Vec4 | null): F32Vec4 => {
    if (!e3) {
      return [
        f(f(e1[1] * e2[2]) - f(e1[2] * e2[1])),
        f(f(e1[2] * e2[0]) - f(e1[0] * e2[2])),
        f(f(e1[0] * e2[1]) - f(e1[1] * e2[0])),
        0,
      ];
    }
    const minor = (i0: number, i1: number, i2: number): number =>
      f(
        f(
          f(e1[i0] * f(f(e2[i1] * e3[i2]) - f(e2[i2] * e3[i1]))) -
            f(e2[i0] * f(f(e1[i1] * e3[i2]) - f(e1[i2] * e3[i1]))),
        ) + f(e3[i0] * f(f(e1[i1] * e2[i2]) - f(e1[i2] * e2[i1]))),
      );
    return [-minor(1, 2, 3), minor(0, 2, 3), -minor(0, 1, 3), minor(0, 1, 2)];
  };
  const facetsOf = (
    cell: readonly F32Vec4[],
  ): { n: F32Vec4[]; c: number[] } | null => {
    const n: F32Vec4[] = [];
    const c: number[] = [];
    for (let k = 0; k < simplexCount; k++) {
      const idx: number[] = [];
      for (let i = 0; i < simplexCount; i++) if (i !== k) idx.push(i);
      const a = cell[idx[0]];
      const e1 = sub4(cell[idx[1]], a);
      const e2 = sub4(cell[idx[2]], a);
      let normal = cross(e1, e2, dim === 4 ? sub4(cell[idx[3]], a) : null);
      const magnitude = f(Math.sqrt(dot4(normal, normal)));
      if (!(magnitude > 0) || !(magnitude <= 3.402823466e38)) return null;
      normal = [
        f(normal[0] / magnitude),
        f(normal[1] / magnitude),
        f(normal[2] / magnitude),
        f(normal[3] / magnitude),
      ];
      const side = dot4(sub4(cell[k], a), normal);
      if (!(side < 0)) {
        if (side > 0) {
          normal = [-normal[0], -normal[1], -normal[2], -normal[3]];
        } else {
          return null;
        }
      }
      n.push(normal);
      c.push(dot4(normal, a));
    }
    return { n, c };
  };
  // A box cell's facets from its composed inverse (finBoxFacets).
  const boxFacetsOf = (inv: F32Aff): { n: F32Vec4[]; c: number[] } | null => {
    const n: F32Vec4[] = [];
    const c: number[] = [];
    for (let axis = 0; axis < dim; axis++) {
      const row = inv.r[axis];
      const len = f(Math.sqrt(dot4(row, row)));
      if (!(len > 0) || !(len <= 3.402823466e38)) return null;
      const unit: F32Vec4 = [
        f(row[0] / len),
        f(row[1] / len),
        f(row[2] / len),
        f(row[3] / len),
      ];
      n.push([-unit[0], -unit[1], -unit[2], -unit[3]]);
      c.push(f(-f(boxMin[0][axis] - inv.t[axis]) / len));
      n.push(unit);
      c.push(f(f(boxMax[0][axis] - inv.t[axis]) / len));
    }
    return { n, c };
  };
  // A leaf cell's facets by root kind (finCellFacets).
  const facetsFor = (
    forward: F32Aff,
    inverse: F32Aff,
  ): { n: F32Vec4[]; c: number[] } | null =>
    g.rootKind === "box" ? boxFacetsOf(inverse) : facetsOf(cellOf(forward));
  const cellRadius = (cell: readonly F32Vec4[]): number => {
    let centroid: F32Vec4 = [0, 0, 0, 0];
    for (const v of cell) centroid = add4(centroid, v);
    centroid = [
      f(centroid[0] / cell.length),
      f(centroid[1] / cell.length),
      f(centroid[2] / cell.length),
      f(centroid[3] / cell.length),
    ];
    let radius = 0;
    for (const v of cell) {
      const d = sub4(v, centroid);
      radius = Math.max(radius, f(Math.sqrt(dot4(d, d))));
    }
    return radius;
  };

  // The lift: 3D exact; 4D the row dots (FMA-sensitive on a real driver —
  // the canonical identity pose the legs drive is exact).
  let q: F32Vec4 = [0, 0, 0, 0];
  const qd: F32Vec4 = [0, 0, 0, 0];
  if (
    !dir.every(Number.isFinite) ||
    !(f(f(f(dir[0] * dir[0]) + f(dir[1] * dir[1])) + f(dir[2] * dir[2])) > 0)
  ) {
    return refused(2);
  }
  if (poseRows) {
    for (let a = 0; a < 4; a++) {
      const row = poseRows[a];
      qd[a] = f(
        f(f(row[0] * dir[0]) + f(row[1] * dir[1])) + f(row[2] * dir[2]),
      );
    }
  } else {
    qd[0] = dir[0];
    qd[1] = dir[1];
    qd[2] = dir[2];
  }

  // The snap (finSnapToLeaf): masked facets snapped, the rest clamped by
  // the bounded violated-facet projection, all within the envelope.
  const snapToLeaf = (
    word: readonly number[],
    mask: number,
    pIn: F32Vec4,
    scale: number,
  ): F32Vec4 | null => {
    const cell = cellOf(wordAff(word, level));
    const facets = facetsFor(wordAff(word, level), wordInverse(word, level));
    if (!facets) return null;
    const envelope = f(snapRel * Math.max(1, cellRadius(cell), scale));
    let p = pIn;
    for (let k = 0; k < facetCount; k++) {
      if ((mask & (1 << k)) === 0) continue;
      const correction = f(facets.c[k] - dot4(facets.n[k], p));
      if (Math.abs(correction) > envelope) return null;
      p = add4(p, scale4(correction, facets.n[k]));
    }
    for (let pass = 0; pass <= facetCount; pass++) {
      let worst = -1;
      let worstS = 0;
      for (let k = 0; k < facetCount; k++) {
        if ((mask & (1 << k)) !== 0) continue;
        const s = f(dot4(facets.n[k], p) - facets.c[k]);
        if (s > worstS) {
          worstS = s;
          worst = k;
        }
      }
      if (worst < 0) break;
      if (worstS > envelope) return null;
      p = sub4(p, scale4(worstS, facets.n[worst]));
    }
    return p;
  };

  if (anchor) {
    // validGeneralAnchor, then the anchored reconstruction.
    if (
      !Number.isInteger(anchor.planeMask) ||
      anchor.planeMask <= 0 ||
      (anchor.planeMask & ~((1 << facetCount) - 1)) !== 0 ||
      anchor.intrinsicPoint.length !== 4 ||
      anchor.planeIndices.length !== 4 ||
      anchor.cellIndices.length !== 4 ||
      !anchor.intrinsicPoint.every((value) => Number.isFinite(f(value))) ||
      !anchor.planeIndices.every((value) => value === -1) ||
      !anchor.cellIndices.every((value) => Number.isInteger(value))
    ) {
      return refused(2);
    }
    let depth = 0;
    for (let slot = 0; slot < 4; slot++) {
      const index = anchor.cellIndices[slot];
      if (index === -1) break;
      if (index < 0 || index >= mapCount) return refused(2);
      depth++;
    }
    if (depth !== level) return refused(2);
    for (let slot = depth; slot < 4; slot++) {
      if (anchor.cellIndices[slot] !== -1) return refused(2);
    }
    const anchorPoint = v4(anchor.intrinsicPoint);
    const snapped = snapToLeaf(
      anchor.cellIndices,
      anchor.planeMask,
      anchorPoint,
      magnitude(anchorPoint),
    );
    if (!snapped) return refused(2);
    q = snapped;
  } else if (poseRows) {
    const pv = [f(origin[0]), f(origin[1]), f(origin[2]), f(w0)];
    for (let a = 0; a < 4; a++) {
      const row = poseRows[a];
      q[a] = f(
        f(f(f(row[0] * pv[0]) + f(row[1] * pv[1])) + f(row[2] * pv[2])) +
          f(row[3] * pv[3]),
      );
    }
  } else {
    q = [f(origin[0]), f(origin[1]), f(origin[2]), 0];
  }

  // The node clip as an ENTER (finClipAxisBoxEnter): the box image's entry
  // t, or FIN_FAR on a miss — the fused walk's sort key and its frontier
  // bound, one number.
  const finFar = f(3.402823466e38);
  const clipAxisBoxEnter = (
    lo: readonly number[],
    hi: readonly number[],
    p: readonly number[],
    d: readonly number[],
  ): number => {
    let enter = f(-1e30);
    let exit = f(1e30);
    for (let axis = 0; axis < dim; axis++) {
      const da = d[axis];
      if (da === 0) {
        if (p[axis] < lo[axis] || p[axis] > hi[axis]) return finFar;
        continue;
      }
      const ta = f(f(lo[axis] - p[axis]) / da);
      const tb = f(f(hi[axis] - p[axis]) / da);
      enter = f(Math.max(enter, Math.min(ta, tb)));
      exit = f(Math.min(exit, Math.max(ta, tb)));
      if (exit < enter) return finFar;
    }
    return exit > enter ? enter : finFar;
  };
  // The fused front-to-back walk's state (the oracle's shapes, f32): the
  // consumed endpoints in group order (closed windows then the open one),
  // the pending pool, the per-level frontier keys and the medium chain.
  const consumed: GeneralEndpointF32[] = [];
  const pending: GeneralEndpointF32[] = [];
  let groupOpen = false;
  let groupLo = 0;
  let groupT = 0;
  let produced = 0;
  let aborted: FiniteSolidDdaF32Result | null = null;
  const nextKey: number[] = Array.from({ length: level }, () => finFar);
  const coverage = new Array<number>(mapCount).fill(0);
  let medium = 0;
  let started = false;
  let haveStart = false;
  let startMedium = 0;
  let startBranch = -1;
  let startAtGroup = false;
  let startLo = 0;
  let startHi = 0;
  const tieOf = (t: number): number => f(tieRel * Math.max(1, Math.abs(t)));
  // The word's mixed-radix index (the WGSL's packed compare — first map
  // most significant), the window sort's second key.
  const wordKey = (word: readonly number[]): number => {
    let index = 0;
    for (let slot = 0; slot < level; slot++) {
      index = index * mapCount + Math.max(word[slot], 0);
    }
    return index;
  };
  const pendingMin = (): number => {
    let best = -1;
    for (let i = 0; i < pending.length; i++) {
      if (best < 0 || pending[i].t < pending[best].t) best = i;
    }
    return best;
  };
  const pendingRemove = (i: number): void => {
    pending[i] = pending[pending.length - 1];
    pending.pop();
  };
  const frontierMin = (): number => {
    let value = finFar;
    for (let d = 0; d < level; d++) {
      if (nextKey[d] < value) value = nextKey[d];
    }
    return value;
  };
  const resolveFlip = (
    t: number,
    before: number,
    after: number,
    branch: number,
    lo: number,
    hi: number,
  ): void => {
    if (startMedium !== claim) {
      if (haveStart && startAtGroup && !anchor) {
        aborted = event(0, claim, startMedium, startBranch, startLo, startHi);
      } else {
        aborted = { ...refused(3), toMedium: startMedium };
      }
    } else {
      aborted = event(t, before, after, branch, lo, hi);
    }
  };
  const closeGroup = (): void => {
    // The window sort (finSortWindow): by t, then the word — the stable
    // sort's tie order, which fixes the group's sorted-first endpoint.
    for (let i = groupLo + 1; i < consumed.length; i++) {
      const key = consumed[i];
      const keyW = wordKey(key.word);
      let j = i;
      while (j > groupLo) {
        const prev = consumed[j - 1];
        if (!(
          prev.t > key.t ||
          (prev.t === key.t && wordKey(prev.word) > keyW)
        )) {
          break;
        }
        consumed[j] = consumed[j - 1];
        j--;
      }
      consumed[j] = key;
    }
    const hi = consumed.length;
    for (let i = groupLo; i < consumed.length; i++) {
      coverage[Math.max(consumed[i].word[0], 0)] +=
        consumed[i].delta === 1 ? 1 : -1;
    }
    const before = medium;
    const owner = mediumOf(coverage);
    medium = owner.medium;
    const t = groupT;
    const tie = tieOf(t);
    if (!started && t <= tie) {
      haveStart = true;
      startMedium = medium;
      startBranch = owner.branch;
      startAtGroup = Math.abs(t) <= tie;
      startLo = groupLo;
      startHi = hi;
      return;
    }
    started = true;
    if (before === medium) return;
    resolveFlip(t, before, medium, owner.branch, groupLo, hi);
  };
  const drain = (): void => {
    for (;;) {
      if (aborted) return;
      const frontier = frontierMin();
      if (!groupOpen) {
        const i = pendingMin();
        if (i < 0) return;
        const t = pending[i].t;
        if (frontier < t) return;
        groupOpen = true;
        groupLo = consumed.length;
        groupT = t;
        consumed.push(pending[i]);
        pendingRemove(i);
      }
      const tie = tieOf(groupT);
      for (;;) {
        const i = pendingMin();
        if (i < 0 || f(pending[i].t - groupT) > tie) break;
        consumed.push(pending[i]);
        pendingRemove(i);
      }
      let nextT = finFar;
      for (const endpoint of pending) {
        if (endpoint.t < nextT) nextT = endpoint.t;
      }
      if (Math.min(nextT, frontier) > f(groupT + tie)) {
        closeGroup();
        groupOpen = false;
        continue;
      }
      return;
    }
  };
  // The leaf visit (pushLeaf): clip the cell, cap the PRODUCED leaves,
  // push the endpoint pair and drain.
  const pushLeaf = (m: F32Aff, inv: F32Aff, word: number[]): void => {
    const facets = facetsFor(m, inv);
    if (!facets) return;
    // The anchor's own leaf reads its masked residuals as exact zeros
    // (enumerateGeneralLeaves's rule, finClipSimplex's `onPlane`).
    const forced =
      anchor && word.every((w, slot) => w === anchor.cellIndices[slot])
        ? anchor.planeMask
        : 0;
    let enter = f(-1e30);
    let exit = f(1e30);
    let enterMask = 0;
    let exitMask = 0;
    for (let k = 0; k < facetCount; k++) {
      const denom = dot4(facets.n[k], qd);
      const s =
        (forced & (1 << k)) !== 0 ? 0 : f(dot4(facets.n[k], q) - facets.c[k]);
      if (denom === 0) {
        if (s > 0) return;
        continue;
      }
      const t = f(-s / denom);
      if (denom > 0) {
        if (t < exit) {
          exit = t;
          exitMask = 1 << k;
        } else if (t === exit) {
          exitMask |= 1 << k;
        }
      } else if (t > enter) {
        enter = t;
        enterMask = 1 << k;
      } else if (t === enter) {
        enterMask |= 1 << k;
      }
    }
    if (!(exit > enter)) return;
    if (produced >= leafCap) {
      aborted = refused(1);
      return;
    }
    produced++;
    const slots: [number, number, number, number] = [-1, -1, -1, -1];
    for (let slot = 0; slot < word.length; slot++) slots[slot] = word[slot];
    pending.push({ t: enter, delta: 1, word: [...slots], facets: enterMask });
    pending.push({ t: exit, delta: 0, word: [...slots], facets: exitMask });
    drain();
  };
  // The fused nests (finEnumerate): per level, every child's level-box
  // entry t (the node prune's own clip; a leaf child keys on its level-0
  // box image), sorted ascending, visited in order; the leaf level's
  // frontier term rides the same keys.
  const word: number[] = [];
  const walk = (forward: F32Aff, inverse: F32Aff, depth: number): void => {
    const order: number[] = [];
    const keys: number[] = new Array<number>(mapCount).fill(finFar);
    for (let a = 0; a < mapCount; a++) {
      // The glass-only walk (generalNestSource's depth-0 filter).
      if (g.glassOnly === true && depth === 0 && media[a] === 0) continue;
      const childInverse_ = childInverse(inverse, a);
      const remaining = level - (depth + 1);
      keys[a] = clipAxisBoxEnter(
        boxMin[depth + 1 < level ? remaining : 0],
        boxMax[depth + 1 < level ? remaining : 0],
        add4(apply(childInverse_, q), childInverse_.t),
        apply(childInverse_, qd),
      );
      let slot = order.length;
      while (slot > 0 && keys[order[slot - 1]] > keys[a]) slot--;
      order.splice(slot, 0, a);
    }
    for (let i = 0; i < order.length; i++) {
      const a = order[i];
      nextKey[depth] = i + 1 < order.length ? keys[order[i + 1]] : finFar;
      if (keys[a] >= finFar) break;
      const childForward = compose(forward, a);
      const childInverse_ = childInverse(inverse, a);
      word.push(a);
      if (depth + 1 < level) {
        walk(childForward, childInverse_, depth + 1);
      } else {
        pushLeaf(childForward, childInverse_, word);
      }
      word.pop();
      if (aborted) return;
    }
    nextKey[depth] = finFar;
  };

  // The rows the displayed normal reads (finiteRowXyz).
  const rowXyz = (axis: number): Vec3 => {
    if (poseRows) {
      const row = poseRows[axis];
      return [row[0], row[1], row[2]];
    }
    return axis === 0
      ? [1, 0, 0]
      : axis === 1
        ? [0, 1, 0]
        : axis === 2
          ? [0, 0, 1]
          : [0, 0, 0];
  };
  const dot3 = (a: readonly number[], b: readonly number[]): number =>
    f(f(f(a[0] * b[0]) + f(a[1] * b[1])) + f(a[2] * b[2]));
  const length3 = (a: readonly number[]): number => f(Math.sqrt(dot3(a, a)));
  const madd3 = (acc: Vec3, s: number, v: readonly number[]): Vec3 => [
    f(acc[0] + f(v[0] * s)),
    f(acc[1] + f(v[1] * s)),
    f(acc[2] + f(v[2] * s)),
  ];
  // The exact-corner normal (finGroupNormal).
  const groupNormal = (
    groupLo: number,
    groupHi: number,
    entering: boolean,
  ): Vec3 | null => {
    const basis: Vec3[] = [];
    for (let m = groupLo; m < groupHi && basis.length < 3; m++) {
      const facets = facetsFor(
        wordAff(consumed[m].word, level),
        wordInverse(consumed[m].word, level),
      );
      if (!facets) return null;
      for (let k = 0; k < facetCount && basis.length < 3; k++) {
        if ((consumed[m].facets & (1 << k)) === 0) continue;
        const n = facets.n[k];
        let vector: Vec3 = [
          f(rowXyz(0)[0] * n[0]),
          f(rowXyz(0)[1] * n[0]),
          f(rowXyz(0)[2] * n[0]),
        ];
        vector = madd3(vector, n[1], rowXyz(1));
        vector = madd3(vector, n[2], rowXyz(2));
        vector = madd3(vector, n[3], rowXyz(3));
        const full = length3(vector);
        for (const unit of basis) {
          const projection = dot3(vector, unit);
          vector = [
            f(vector[0] - f(projection * unit[0])),
            f(vector[1] - f(projection * unit[1])),
            f(vector[2] - f(projection * unit[2])),
          ];
        }
        const magnitude = length3(vector);
        if (!(magnitude > f(dependentRel * full))) continue;
        basis.push([
          f(vector[0] / magnitude),
          f(vector[1] / magnitude),
          f(vector[2] / magnitude),
        ]);
      }
    }
    let projected: Vec3 = [0, 0, 0];
    for (const unit of basis) {
      projected = madd3(projected, dot3(dir, unit), unit);
    }
    const magnitude = length3(projected);
    if (!(magnitude > 0)) return null;
    const sign = entering ? -1 : 1;
    return [
      f(f(sign * projected[0]) / magnitude),
      f(f(sign * projected[1]) / magnitude),
      f(f(sign * projected[2]) / magnitude),
    ];
  };
  // The event (finEvent).
  const event = (
    t: number,
    before: number,
    after: number,
    afterBranch: number,
    groupLo: number,
    groupHi: number,
  ): FiniteSolidDdaF32Result => {
    const entering = after !== 0;
    const normal = groupNormal(groupLo, groupHi, entering);
    if (!normal) return refused(6);
    const incident = consumed[groupLo];
    const snapped = snapToLeaf(
      incident.word,
      incident.facets,
      add4(q, scale4(t, qd)),
      Math.max(magnitude(q), Math.abs(t)),
    );
    if (!snapped) return refused(2);
    return {
      kind: 1,
      reason: 0,
      t,
      normal,
      anchor: {
        intrinsicPoint: [snapped[0], snapped[1], snapped[2], snapped[3]],
        planeMask: incident.facets,
        planeIndices: [-1, -1, -1, -1],
        cellIndices: [...incident.word] as [number, number, number, number],
      },
      fromMedium: before,
      toMedium: after,
      toBranch: afterBranch,
    };
  };
  // The fused walk: the fused nests, then the walk's end (finFinish) —
  // close everything (the frontier is exhausted), then the claim check —
  // a mismatching claim refuses or emits the start event, a matching one
  // reports the miss.
  if (level === 0) {
    pushLeaf(identity(), identity(), word);
  } else if (clipAxisBoxEnter(boxMin[level], boxMax[level], q, qd) < finFar) {
    walk(identity(), identity(), 0);
  }
  if (!aborted) {
    for (let d = 0; d < level; d++) nextKey[d] = finFar;
    drain();
  }
  if (aborted) return aborted;
  if (startMedium !== claim) {
    if (haveStart && startAtGroup && !anchor) {
      return event(0, claim, startMedium, startBranch, startLo, startHi);
    }
    return { ...refused(3), toMedium: startMedium };
  }
  return miss();
}
