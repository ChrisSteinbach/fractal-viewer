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
  type FiniteSolidAnchor,
} from "./finite-solid";
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
// The GENERAL construction: the document's OWN maps as the word tree.
//
// The CPU oracle is `finite-solid.ts`'s general section (`analyzeFiniteSolidGeneral`
// through `finiteSolidGeneralDisplayDistance` / `finiteSolidGeneralNextBoundary`),
// landed one commit before this half. The construction rides the SOURCE, not
// the wire: the maps and the root box bake as `const` WGSL (the tiling clip's
// and `shapes.ts`'s baked-constant pattern), so the shipped params tail and
// the bindingless design survive untouched — a general session recompiles its
// kernels per enter (the session freezes its construction), exactly the
// discipline the shipped cores already carry. The packers are the shipped
// ones verbatim (`packSurfaceGpuParamsFinite` / `Finite4`): the params tail
// keeps the frozen 16-byte finite block (level live, half/grid unread) and
// the only new wire is the marching ball the packer already carries.
//
// THE WALK is the reference's endpoint sweep, pruned: the DFS descends only
// into subtrees whose box the ray clips (a descendant's box nests inside its
// parent's, so a pruned subtree contributes no endpoints anywhere), collects
// the hit leaves' intervals, sorts their endpoints by t (stable — the DFS
// order breaks ties, matching the reference's stable sort), and groups
// greedily from each group's first endpoint within
// FINITE_SOLID_GENERAL_TIE_REL — the reference's declared resolution. The
// enumeration is capped: a ray that clips more than
// `FINITE_SOLID_GENERAL_MAX_ENUM_LEAVES` pruned leaves refuses visit-cap
// (the shipped DDA's own resource-refusal shape), never truncates.
//
// TIE-EDGE DISCLOSURE: the reference groups endpoints greedily from each
// group's first t in f64; the WGSL realizes the same arithmetic in f32, and
// two endpoints that tie in f64 can order differently in f32 (and across
// drivers, under fused multiply-add). The bench legs treat that class the
// way the escape legs treat their chaos flips: a pre-hoc ULP ensemble
// excludes the probe and counts it, never a raised tolerance.
// ---------------------------------------------------------------------------

/** The general construction over the kernel wire: the document's own maps
 * as signed per-axis diagonal scales + offsets, and the maps' fixed
 * points' bounding box (verified invariant at admission). Plain number
 * arrays — the values are f64 on the CPU and quantize to f32 at bake. */
export interface FiniteSolidGeneralWire {
  mapScale: Vec4[];
  mapOffset: Vec4[];
  rootMin: Vec4;
  rootMax: Vec4;
}

/** The general construction's marching ball: the root box's farthest
 * corner's norm (the box need not be origin-centred — the fixed points'
 * bounding box is whatever the document's maps make it). The norm is
 * monotone in each |coordinate|, so the maximizing corner takes each
 * axis's larger magnitude — exact, not a bound. The packer's
 * bounding/visible pair and the fixture's domain gate read this ONE
 * number, the shipped construction's `finiteSolidBoundingRadius` role. */
export function finiteSolidGeneralBoundingRadius(wire: {
  rootMin: Vec4;
  rootMax: Vec4;
}): number {
  let sum = 0;
  for (let axis = 0; axis < 4; axis++) {
    const reach = Math.max(
      Math.abs(wire.rootMin[axis]),
      Math.abs(wire.rootMax[axis]),
    );
    sum += reach * reach;
  }
  return Math.sqrt(sum);
}

/** The pruned enumeration's leaf cap: the walk refuses past it (visit-cap)
 * rather than truncating. The codegen bakes the smaller of this and the
 * construction's own worst case (K^level), so small constructions allocate
 * exactly their own bound. */
export const FINITE_SOLID_GENERAL_MAX_ENUM_LEAVES = 128;

const generalVec4Lit = (v: Vec4): string =>
  `vec4f(${floatLit(v[0])}, ${floatLit(v[1])}, ${floatLit(v[2])}, ${floatLit(v[3])})`;

const generalConstBlock = (
  g: FiniteSolidGeneralWire,
  level: number,
): string => {
  const count = g.mapScale.length;
  const rows = (source: Vec4[]): string =>
    source.map((v) => `    ${generalVec4Lit(v)}`).join(",\n");
  return `// The construction, baked (the general admission's own maps — the
// session freezes its construction at enter, the shipped cores' discipline):
// signed per-axis diagonal scales + offsets, and the fixed points' root box.
const FIN_LEVEL = ${level}u;
const FIN_MAP_COUNT = ${count}u;
const FIN_ROOT_MIN = ${generalVec4Lit(g.rootMin)};
const FIN_ROOT_MAX = ${generalVec4Lit(g.rootMax)};
const FIN_SCALE = array<vec4f, ${count}>(
${rows(g.mapScale)}
);
const FIN_OFFSET = array<vec4f, ${count}>(
${rows(g.mapOffset)}
);
const FIN_TIE_REL = ${finiteEnvelopeLiteral};
const FIN_REFINE_REL = ${finiteRefineLiteral};
const FIN_SAFETY = ${finiteSafetyLiteral};
`;
};

/** The word's composed map — the reference's DFS accumulation, depth-major
 * (the FIRST map index most significant): offset accumulates against the
 * INCOMING scale, then the scale multiplies. Fresh per word (no undo
 * arithmetic) — the reference's undo-restored siblings differ from a fresh
 * compose only in the last ulp, which the declared tie absorbs. */
const generalComposeWgsl = `
struct FinWord {
  scale: vec4f,
  offset: vec4f,
}

fn finCompose(w0: i32, w1: i32, depth: i32) -> FinWord {
  var scale = vec4f(1.0);
  var offset = vec4f(0.0);
  if (depth >= 1) {
    let s = FIN_SCALE[w0];
    let t = FIN_OFFSET[w0];
    offset = offset + scale * t;
    scale = scale * s;
  }
  if (depth >= 2) {
    let s = FIN_SCALE[w1];
    let t = FIN_OFFSET[w1];
    offset = offset + scale * t;
    scale = scale * s;
  }
  return FinWord(scale, offset);
}
`;

/** The word's box: lo/hi per axis from the composed map and the root, and
 * the center/half form the box SDF and the anchor snap read. The signed
 * scale keeps boxes axis-aligned through reflections. */
const generalBoxWgsl = (dim: number): string => `
struct FinBox {
  center: vec4f,
  half: vec4f,
}

fn finBoxCenterHalf(scale: vec4f, offset: vec4f) -> FinBox {
  var center: vec4f;
  var half: vec4f;
  for (var axis = 0; axis < ${dim}; axis++) {
    let lo = offset[axis] + scale[axis] * FIN_ROOT_MIN[axis];
    let hi = offset[axis] + scale[axis] * FIN_ROOT_MAX[axis];
    center[axis] = (lo + hi) * 0.5;
    half[axis] = abs(hi - lo) * 0.5;
  }
  return FinBox(center, half);
}

fn finBoxSdf(center: vec4f, half: vec4f, q: array<f32, 4>) -> f32 {
  var outsideSq = 0.0;
  var inside = -1.0e30;
  for (var axis = 0; axis < ${dim}; axis++) {
    let gap = abs(q[axis] - center[axis]) - half[axis];
    outsideSq = outsideSq + max(gap, 0.0) * max(gap, 0.0);
    inside = max(inside, gap);
  }
  return sqrt(outsideSq) + min(inside, 0.0);
}
`;

/** The word-tree display DE: the certified hybrid one tree up — the
 * level-1 boxes' min, the nearest refined into its K children within tau
 * of its own boundary (the seal-hazard argument carries: the level-1
 * boxes' own faces are their SDF's zero set, and the deeper structure
 * pierces those faces). Level 0 is the root box; level 1 the plain min. */
export function finiteSolidGeneralDisplaySource(
  dim: 3 | 4,
  g: FiniteSolidGeneralWire,
  level: number,
): string {
  const lift = generalLiftSource(dim);
  return `${generalConstBlock(g, level)}${lift}
${generalComposeWgsl}
${generalBoxWgsl(dim)}
fn finiteDisplayDE(q: array<f32, 4>) -> f32 {
  if (FIN_LEVEL == 0u) {
    let halfRoot = abs(FIN_ROOT_MAX - FIN_ROOT_MIN) * 0.5;
    let centerRoot = (FIN_ROOT_MAX + FIN_ROOT_MIN) * 0.5;
    let d = finBoxSdf(centerRoot, halfRoot, q);
    return select(d, d * FIN_SAFETY, d > 0.0);
  }
  var best = 1.0e30;
  var bestWord = 0u;
  for (var a = 0u; a < FIN_MAP_COUNT; a++) {
    let word = finCompose(i32(a), -1, 1);
    let box = finBoxCenterHalf(word.scale, word.offset);
    let d = finBoxSdf(box.center, box.half, q);
    if (d < best) {
      best = d;
      bestWord = a;
    }
  }
  if (FIN_LEVEL == 1u) {
    return select(best, best * FIN_SAFETY, best > 0.0);
  }
  // Refine the nearest level-1 box into its children when the estimate is
  // within the margin of that box's own surface (tau relative to its
  // largest half-extent — the shipped constant's role, per box).
  let nearWord = finCompose(i32(bestWord), -1, 1);
  let nearBox = finBoxCenterHalf(nearWord.scale, nearWord.offset);
  var halfMax = 0.0;
  for (var axis = 0; axis < ${dim}; axis++) {
    halfMax = max(halfMax, abs(nearBox.half[axis]));
  }
  if (best >= FIN_REFINE_REL * halfMax) {
    return select(best, best * FIN_SAFETY, best > 0.0);
  }
  var refined = 1.0e30;
  for (var a = 0u; a < FIN_MAP_COUNT; a++) {
    let word = finCompose(i32(bestWord), i32(a), 2);
    let box = finBoxCenterHalf(word.scale, word.offset);
    let d = finBoxSdf(box.center, box.half, q);
    if (d < refined) {
      refined = d;
    }
  }
  let result = min(best, refined);
  return select(result, result * FIN_SAFETY, result > 0.0);
}

fn surfaceDE(pIn: vec3f, cutoff: f32, li: u32) -> f32 {
  return finiteDisplayDE(finiteLift(pIn));
}
`;
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

/** One node's clip against the intrinsic ray: the box interval with the
 * binding axes at each end (the atomic-event candidates), empty when the
 * ray misses the box. The leaf's interval is the same arithmetic at
 * depth == FIN_LEVEL. */
const generalClipWgsl = (dim: number): string => `
struct FinClip {
  ok: bool,
  enter: f32,
  exit: f32,
  enterAxes: u32,
  exitAxes: u32,
}

fn finClipNode(scale: vec4f, offset: vec4f, q: array<f32, 4>, qd: array<f32, 4>) -> FinClip {
  var result: FinClip;
  result.ok = false;
  result.enter = -1.0e30;
  result.exit = 1.0e30;
  result.enterAxes = 0u;
  result.exitAxes = 0u;
  var enter = -1.0e30;
  var exit = 1.0e30;
  var enterAxes = 0u;
  var exitAxes = 0u;
  for (var axis = 0; axis < ${dim}; axis++) {
    let s = scale[axis];
    let lo0 = offset[axis] + s * FIN_ROOT_MIN[axis];
    let hi0 = offset[axis] + s * FIN_ROOT_MAX[axis];
    let lo = min(lo0, hi0);
    let hi = max(lo0, hi0);
    let d = qd[axis];
    if (d == 0.0) {
      if (q[axis] < lo || q[axis] > hi) {
        return result;
      }
      continue;
    }
    let ta = (lo - q[axis]) / d;
    let tb = (hi - q[axis]) / d;
    let near = min(ta, tb);
    let far = max(ta, tb);
    if (near > enter) {
      enter = near;
      enterAxes = 1u << u32(axis);
    } else if (near == enter) {
      enterAxes = enterAxes | (1u << u32(axis));
    }
    if (far < exit) {
      exit = far;
      exitAxes = 1u << u32(axis);
    } else if (far == exit) {
      exitAxes = exitAxes | (1u << u32(axis));
    }
  }
  if (!(exit > enter)) {
    return result;
  }
  result.ok = true;
  result.enter = enter;
  result.exit = exit;
  result.enterAxes = enterAxes;
  result.exitAxes = exitAxes;
  return result;
}
`;

/**
 * The general transport half: the word-tree boundary query as the
 * `opticsBackend: "finiteSolid"` emission, the full anchor contract in and
 * out — the reference's `finiteSolidGeneralNextBoundary` /
 * `NextBoundaryFromAnchor` endpoint sweep, pruned, in f32. The walk
 * consumes the display source's lift/compose/box helpers (always co-emitted
 * — the shipped transport's `finiteLiftDir` dependence, one tree up). The
 * anchor's word depth reads the PARAMS tail's live `finiteLevel` lane (the
 * shipped grid DDA's own convention), which keeps one live params
 * dependency in every kernel that includes this source — the bench's
 * control kernel derives its bind group from the auto layout, and a
 * bindingless-everywhere 3D walk silently drops binding 0 from it. The DFS
 * structure itself (the enumeration nests, the capacity) stays baked, since
 * the codegen sizes the private arrays from the level.
 *
 * The refusal reasons are the transport's shared vocabulary, identical to
 * the shipped DDA's emission: 1 visit-cap (here: the pruned enumeration's
 * leaf cap), 2 invalid-input, 3 state-mismatch, 4 ambiguous-anchor (the
 * anchor's zero-|qd| masked axis), 5 nonmonotone-crossing, 6
 * degenerate-projected-normal. A zero normal is the exact-corner
 * convention's rank-zero refusal sentinel.
 */
export function finiteSolidGeneralTransportSource(
  dim: 3 | 4,
  g: FiniteSolidGeneralWire,
  level: number,
): string {
  const count = g.mapScale.length;
  const leafCap = Math.min(
    count ** level,
    FINITE_SOLID_GENERAL_MAX_ENUM_LEAVES,
  );
  const endpointCap = leafCap * 2;
  return `struct FiniteBoundary {
  // 1 boundary, 2 miss, 3 refused — TransportBoundary's vocabulary.
  kind: u32,
  reason: u32,
  t: f32,
  normal: vec3f,
  // The full anchor out (the walk's continuation state): the snapped
  // intrinsic point, the crossed-axes mask, the crossed faces as LOCAL
  // leaf sides {0 = the leaf's min face, 1 = its max face}, and the
  // incident leaf's WORD. The next query reconstructs the leaf box from
  // the word and snaps/clamps onto it — the same contract the grid DDA's
  // anchor carries, one tree up.
  anchorIntrinsic: vec4f,
  anchorMask: u32,
  anchorPlanes: vec4i,
  anchorCells: vec4i,
}

${generalClipWgsl(dim)}

// The incident leaf's box, from the anchor's word (the event's snap target
// and the anchored restart's canonical faces). The word's depth is the
// PARAMS tail's level lane — the packer's live wire, read the way the
// shipped grid DDA reads its finite block, so the general core keeps one
// live params dependency and its uniform binding stays in the layout.
fn finLeafBox(w0: i32, w1: i32) -> FinBox {
  let word = finCompose(w0, w1, i32(params.finiteLevel));
  return finBoxCenterHalf(word.scale, word.offset);
}

fn finBoxHalfMax(box: FinBox) -> f32 {
  var halfMax = 0.0;
  for (var axis = 0; axis < ${dim}; axis++) {
    halfMax = max(halfMax, abs(box.half[axis]));
  }
  return halfMax;
}

${generalRowXyzSource(dim)}fn finiteBoundaryNormal(dir: vec3f, planeMask: u32, entering: bool) -> vec3f {
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

// The pruned enumeration's storage: one record per leaf ENDPOINT —
// (t, packed) with packed bit 0 the delta (1 enter / 0 exit), bits 1..6 the
// word's first map, bits 7..12 the second, bits 13..16 the endpoint's
// binding axes. Module-scope private: per-invocation state, written
// before read.
const FIN_LEAF_CAP = ${leafCap}u;
var<private> finE: array<vec2f, ${endpointCap}>;
var<private> finTotal = 0u;

fn finPushEndpoint(t: f32, delta: u32, w0: i32, w1: i32, axes: u32) {
  let packed = (delta & 1u) | ((u32(w0) & 63u) << 1u) | ((u32(w1) & 63u) << 7u) | ((axes & 15u) << 13u);
  finE[finTotal] = vec2f(t, bitcast<f32>(packed));
  finTotal = finTotal + 1u;
}

// One occupancy transition of the union along the ray (the reference's
// generalBoundaryEvent): the tied faces' span carries the projected
// normal; the entering side is the group's AFTER-coverage (the actual
// geometry, never the claim); the anchor names the INCIDENT leaf (the
// group's sorted-first endpoint's leaf), whose canonical faces the
// anchored restart snaps onto. A mixed group (one leaf's exit tied with
// another's entry) encodes every crossed face from the group's ONE
// entering and the per-axis ray sign — the reference's own convention.
fn finEvent(
  q: array<f32, 4>,
  qd: array<f32, 4>,
  dir: vec3f,
  t: f32,
  entering: bool,
  groupLo: u32,
  groupHi: u32,
  incidentWord0: i32,
  incidentWord1: i32,
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
  // The crossed axes, in the group's sorted-endpoint order (each face's
  // own axes ascending) — chooseAxis's tie-break reads that order: the
  // largest |qd| wins, ties keep the first.
  var planeMask = 0u;
  var axis = 0;
  var firstAxis = true;
  for (var m = groupLo; m < groupHi; m++) {
    let axes = (bitcast<u32>(finE[m].y) >> 13u) & 15u;
    for (var a = 0; a < ${dim}; a++) {
      if ((axes & (1u << u32(a))) == 0u) {
        continue;
      }
      planeMask = planeMask | (1u << u32(a));
      if (firstAxis) {
        axis = a;
        firstAxis = false;
      } else if (abs(qd[a]) > abs(qd[axis])) {
        axis = a;
      }
    }
  }
  let normal = finiteBoundaryNormal(dir, planeMask, entering);
  if (all(normal == vec3f(0.0))) {
    result.kind = 3u;
    result.reason = 6u;
    return result;
  }
  result.normal = normal;
  let box = finLeafBox(incidentWord0, incidentWord1);
  let envelope = FIN_TIE_REL * finBoxHalfMax(box);
  var intrinsic: array<f32, 4>;
  var anchorPlanes: array<i32, 4> = array<i32, 4>(-1, -1, -1, -1);
  var anchorCells: array<i32, 4> = array<i32, 4>(-1, -1, -1, -1);
  for (var a = 0; a < ${dim}; a++) {
    intrinsic[a] = q[a] + t * qd[a];
    if (a < i32(FIN_LEVEL)) {
      anchorCells[a] = select(incidentWord0, incidentWord1, a == 1);
    }
  }
  for (var a = 0; a < ${dim}; a++) {
    if ((planeMask & (1u << u32(a))) == 0u) {
      continue;
    }
    anchorPlanes[a] = select(0, 1, entering != (qd[a] > 0.0));
    intrinsic[a] = select(
      box.center[a] - box.half[a],
      box.center[a] + box.half[a],
      anchorPlanes[a] == 1,
    );
  }
  for (var a = 0; a < ${dim}; a++) {
    if ((planeMask & (1u << u32(a))) != 0u) {
      continue;
    }
    let lower = box.center[a] - box.half[a];
    let upper = box.center[a] + box.half[a];
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

// The walk's DFS in explicit nests (level <= 2): the word tree's leaves in
// lexicographic word order, each subtree pruned when the ray misses its
// box — a descendant's box nests inside its parent's, so the pruned
// subtree's leaves contribute no endpoints anywhere and the pruned
// enumeration equals the reference's unpruned one endpoint for endpoint.
fn finEnumerate(q: array<f32, 4>, qd: array<f32, 4>) -> bool {
  if (i32(FIN_LEVEL) == 0) {
    if (finTotal + 2u > ${endpointCap}u) {
      return false;
    }
    let clip = finClipNode(vec4f(1.0), vec4f(0.0), q, qd);
    if (clip.ok) {
      finPushEndpoint(clip.enter, 1u, -1, -1, clip.enterAxes);
      finPushEndpoint(clip.exit, 0u, -1, -1, clip.exitAxes);
    }
    return true;
  }
  for (var a0 = 0; a0 < i32(FIN_MAP_COUNT); a0++) {
    let word1 = finCompose(a0, -1, 1);
    if (i32(FIN_LEVEL) == 1) {
      let clip = finClipNode(word1.scale, word1.offset, q, qd);
      if (clip.ok) {
        if (finTotal + 2u > ${endpointCap}u) {
          return false;
        }
        finPushEndpoint(clip.enter, 1u, a0, -1, clip.enterAxes);
        finPushEndpoint(clip.exit, 0u, a0, -1, clip.exitAxes);
      }
      continue;
    }
    // Level 2: the level-1 box prunes its whole subtree.
    let node = finClipNode(word1.scale, word1.offset, q, qd);
    if (!node.ok) {
      continue;
    }
    for (var a1 = 0; a1 < i32(FIN_MAP_COUNT); a1++) {
      let word2 = finCompose(a0, a1, 2);
      let clip = finClipNode(word2.scale, word2.offset, q, qd);
      if (clip.ok) {
        if (finTotal + 2u > ${endpointCap}u) {
          return false;
        }
        finPushEndpoint(clip.enter, 1u, a0, a1, clip.enterAxes);
        finPushEndpoint(clip.exit, 0u, a0, a1, clip.exitAxes);
      }
    }
  }
  return true;
}

// Point membership for the primary ray's ray-side classification (the
// shipped march body's finiteRaySideIndex + finiteOccupied, one tree up):
// the coverage at a point is > 0 exactly when some leaf's box contains it
// (closed — a point on a shared face reads inside, and the boundary
// group's half-open sweep at that origin resolves the event either way).
fn finBoxContains(scale: vec4f, offset: vec4f, q: array<f32, 4>) -> bool {
  for (var axis = 0; axis < ${dim}; axis++) {
    let lo0 = offset[axis] + scale[axis] * FIN_ROOT_MIN[axis];
    let hi0 = offset[axis] + scale[axis] * FIN_ROOT_MAX[axis];
    let lo = min(lo0, hi0);
    let hi = max(lo0, hi0);
    if (q[axis] < lo || q[axis] > hi) {
      return false;
    }
  }
  return true;
}

fn finiteGeneralPointInside(q: array<f32, 4>) -> bool {
  if (i32(FIN_LEVEL) == 0) {
    return finBoxContains(vec4f(1.0), vec4f(0.0), q);
  }
  for (var a0 = 0; a0 < i32(FIN_MAP_COUNT); a0++) {
    let word1 = finCompose(a0, -1, 1);
    if (i32(FIN_LEVEL) == 1) {
      if (finBoxContains(word1.scale, word1.offset, q)) {
        return true;
      }
      continue;
    }
    // The level-1 box prunes its whole subtree.
    if (!finBoxContains(word1.scale, word1.offset, q)) {
      continue;
    }
    for (var a1 = 0; a1 < i32(FIN_MAP_COUNT); a1++) {
      let word2 = finCompose(a0, a1, 2);
      if (finBoxContains(word2.scale, word2.offset, q)) {
        return true;
      }
    }
  }
  return false;
}

// The stable sort (by t; ties keep the DFS enumeration order — the
// reference's stable sort, which is what makes the group's sorted-first
// endpoint and the axis order reproducible).
fn finSortEndpoints() {
  for (var i = 1u; i < finTotal; i++) {
    let key = finE[i];
    var j = i;
    loop {
      if (j == 0u) {
        break;
      }
      if (!(finE[j - 1u].x > key.x)) {
        break;
      }
      finE[j] = finE[j - 1u];
      j = j - 1u;
    }
    finE[j] = key;
  }
}

// The endpoint sweep (the reference's group walk): greedy groups from each
// group's first t within FIN_TIE_REL; the state at tMin (always 0 on the
// transport — the fresh and anchored queries both start there) is the last
// at-or-before group's AFTER-coverage; the first later zero-crossing of
// the coverage is the event. A net-zero group (an interior shared face)
// traverses silently. The flags capture the start group's own data for the
// claim-anticipation event and the sweep's next-flip search captures the
// group range for the event's faces.
fn finSweep(
  q: array<f32, 4>,
  qd: array<f32, 4>,
  dir: vec3f,
  inside: u32,
  anchored: bool,
) -> FiniteBoundary {
  var miss: FiniteBoundary;
  miss.kind = 2u;
  miss.reason = 0u;
  miss.t = 0.0;
  miss.normal = vec3f(0.0);
  miss.anchorIntrinsic = vec4f(0.0);
  miss.anchorMask = 0u;
  miss.anchorPlanes = vec4i(-1);
  miss.anchorCells = vec4i(-1);
  var coverage = 0;
  var idx = 0u;
  // The start group (the last group anchored at or before tMin): its
  // AFTER-coverage owns tMin (half-open, the entering side).
  var haveStart = false;
  var startAfter = 0;
  var startAtGroup = false;
  var startLo = 0u;
  var startHi = 0u;
  // The first zero-crossing AFTER the start, held until the claim check
  // has admitted the walk (the reference's order: a mismatching claim
  // refuses before any walk event is emitted).
  var haveFlip = false;
  var flipT = 0.0;
  var flipEntering = false;
  var flipLo = 0u;
  var flipHi = 0u;
  var started = false;
  while (idx < finTotal) {
    let groupT = finE[idx].x;
    let tie = FIN_TIE_REL * max(1.0, abs(groupT));
    var j = idx;
    var net = 0;
    while (j < finTotal && finE[j].x - groupT <= tie) {
      let delta = select(-1, 1, (bitcast<u32>(finE[j].y) & 1u) == 1u);
      net = net + delta;
      j = j + 1u;
    }
    let before = coverage;
    coverage = coverage + net;
    if (!started && groupT <= tie) {
      // Anchored at or before tMin: the start group (so far).
      haveStart = true;
      startAfter = coverage;
      startAtGroup = abs(groupT) <= tie;
      startLo = idx;
      startHi = j;
      idx = j;
      continue;
    }
    started = true;
    if (
      !haveFlip &&
      ((before == 0 && coverage > 0) || (before > 0 && coverage == 0))
    ) {
      haveFlip = true;
      flipT = groupT;
      flipEntering = coverage > 0;
      flipLo = idx;
      flipHi = j;
    }
    idx = j;
  }
  // The claim check: the geometry's state at tMin must match the caller's
  // medium, exactly the reference's rule — off a boundary the claim must
  // match; ON the start group the UNANCHORED query may anticipate the
  // crossing (the display march's primary hit); the anchored continuation
  // takes no liberty at all.
  let stateMatches = (startAfter > 0) == (inside == 1u);
  if (!stateMatches) {
    if (haveStart && startAtGroup && !anchored) {
      return finEvent(q, qd, dir, 0.0, startAfter > 0, startLo, startHi,
        i32((bitcast<u32>(finE[startLo].y) >> 1u) & 63u),
        i32((bitcast<u32>(finE[startLo].y) >> 7u) & 63u));
    }
    var result: FiniteBoundary;
    result.kind = 3u;
    result.reason = 3u;
    result.t = 0.0;
    result.normal = vec3f(0.0);
    result.anchorIntrinsic = vec4f(0.0);
    result.anchorMask = 0u;
    result.anchorPlanes = vec4i(-1);
    result.anchorCells = vec4i(-1);
    return result;
  }
  if (haveFlip) {
    let meta0 = bitcast<u32>(finE[flipLo].y);
    return finEvent(
      q,
      qd,
      dir,
      flipT,
      flipEntering,
      flipLo,
      flipHi,
      i32((meta0 >> 1u) & 63u),
      i32((meta0 >> 7u) & 63u),
    );
  }
  return miss;
}

// The word-tree boundary query (the reference's
// finiteSolidGeneralNextBoundary / NextBoundaryFromAnchor, pruned): the
// intrinsic anchor is authoritative (the rounded display coordinate cannot
// replace the canonical boundary origin); the anchor's word names the
// post-incident leaf and the masked axes its incident faces.
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
  var q = array<f32, 4>(0.0, 0.0, 0.0, 0.0);
  let qd = finiteLiftDir(dir);
  if (anchorPresent == 1u) {
    // The anchor's word must name real maps at the construction's depth,
    // the masked faces must be the leaf box's own sides, and at least one
    // face must be masked — the reference's validGeneralAnchor.
    if (anchorMask == 0u || (anchorMask & ~${(1 << dim) - 1}u) != 0u ||
        !all(abs(anchorIntrinsic) <= vec4f(3.402823466e38))) {
      result.reason = 2u;
      return result;
    }
    var depth = 0;
    for (var slot = 0; slot < 4; slot++) {
      let index = anchorCellsIn[slot];
      if (index == -1) {
        break;
      }
      if (index < 0 || index >= i32(FIN_MAP_COUNT)) {
        result.reason = 2u;
        return result;
      }
      depth = depth + 1;
    }
    if (depth != i32(params.finiteLevel)) {
      result.reason = 2u;
      return result;
    }
    for (var slot = depth; slot < 4; slot++) {
      if (anchorCellsIn[slot] != -1) {
        result.reason = 2u;
        return result;
      }
    }
    var masked = 0;
    for (var a = 0; a < 4; a++) {
      if ((anchorMask & (1u << u32(a))) == 0u) {
        if (anchorPlanesIn[a] != -1) {
          result.reason = 2u;
          return result;
        }
        continue;
      }
      masked = masked + 1;
      if (a >= ${dim} || (anchorPlanesIn[a] != 0 && anchorPlanesIn[a] != 1)) {
        result.reason = 2u;
        return result;
      }
    }
    if (masked == 0) {
      result.reason = 2u;
      return result;
    }
    // The anchor's intrinsic point seeds the reconstruction (the
    // reference's authoritative coordinate): snap the masked coordinates
    // onto the leaf's canonical face planes and clamp the rest into the
    // leaf box under the declared envelope.
    for (var a = 0; a < 4; a++) {
      q[a] = anchorIntrinsic[a];
    }
    let box = finLeafBox(anchorCellsIn[0], anchorCellsIn[1]);
    let envelope = FIN_TIE_REL * finBoxHalfMax(box);
    for (var a = 0; a < ${dim}; a++) {
      let lower = box.center[a] - box.half[a];
      let upper = box.center[a] + box.half[a];
      if ((anchorMask & (1u << u32(a))) != 0u) {
        q[a] = select(lower, upper, anchorPlanesIn[a] == 1);
      } else if (q[a] < lower) {
        if (lower - q[a] > envelope) {
          result.reason = 2u;
          return result;
        }
        q[a] = lower;
      } else if (q[a] > upper) {
        if (q[a] - upper > envelope) {
          result.reason = 2u;
          return result;
        }
        q[a] = upper;
      }
    }
  }
  finTotal = 0u;
  if (anchorPresent != 1u) {
    q = finiteLift(origin);
  }
  if (!finEnumerate(q, qd)) {
    // The pruned enumeration overflowed its cap: a disclosed refusal, the
    // shipped DDA's own resource-refusal shape — never a truncation.
    result.reason = 1u;
    return result;
  }
  finSortEndpoints();
  return finSweep(q, qd, dir, inside, anchorPresent == 1u);
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
// and clamped recompositions, which an f64 twin does not bracket. WGSL
// permits differences from this per-operation rounding, including fused
// arithmetic and division/square-root accuracy; the bench legs treat the
// tie-edge class the escape legs' way (an ensemble + a capped absolution),
// never a raised tolerance. Inputs are f32-quantized here — the control
// wire's own contract.
// ---------------------------------------------------------------------------

interface GeneralEndpointF32 {
  t: number;
  delta: number;
  w0: number;
  w1: number;
  axes: number;
}

/**
 * The WGSL general walk re-executed in TypeScript with every arithmetic
 * result rounded to f32 — the general bench legs' twin, mirroring
 * {@link finiteSolidGeneralTransportSource}'s emission term for term. The
 * f64 oracle (`finite-solid.ts`'s general section, pinned by its harness)
 * stays the soundness record.
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
  inside: boolean,
): FiniteSolidDdaF32Result {
  const f = Math.fround;
  const dir = dirIn.map(f) as Vec3;
  const poseRows = poseRowsIn?.map((row) => row.map(f) as Vec4) ?? null;
  const mapCount = g.mapScale.length;
  const mapScale = g.mapScale.map((v) => v.map(f));
  const mapOffset = g.mapOffset.map((v) => v.map(f));
  const rootMin = g.rootMin.map(f);
  const rootMax = g.rootMax.map(f);
  const tieRel = f(FINITE_ENVELOPE_REL);
  const leafCap = Math.min(
    mapCount ** level,
    FINITE_SOLID_GENERAL_MAX_ENUM_LEAVES,
  );
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
  // The lift: 3D exact; 4D the row dots (FMA-sensitive on a real driver —
  // the canonical identity pose the legs drive is exact).
  const q: number[] = [0, 0, 0, 0];
  const qd: number[] = [0, 0, 0, 0];
  if (poseRows) {
    const pv = anchor
      ? null
      : [f(origin[0]), f(origin[1]), f(origin[2]), f(w0)];
    for (let a = 0; a < 4; a++) {
      const row = poseRows[a];
      if (pv) {
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
  // The word's composed map (finCompose): offset accumulates against the
  // INCOMING scale, then the scale multiplies — per component, depth-major.
  const compose = (
    w0: number,
    w1: number,
    depth: number,
  ): { scale: number[]; offset: number[] } => {
    let scale = [1, 1, 1, 1];
    let offset = [0, 0, 0, 0];
    for (let slot = 0; slot < depth; slot++) {
      const w = slot === 0 ? w0 : w1;
      const nextScale: number[] = [];
      const nextOffset: number[] = [];
      for (let axis = 0; axis < 4; axis++) {
        nextOffset.push(f(offset[axis] + f(scale[axis] * mapOffset[w][axis])));
        nextScale.push(f(scale[axis] * mapScale[w][axis]));
      }
      scale = nextScale;
      offset = nextOffset;
    }
    return { scale, offset };
  };
  // One node's clip (finClipNode): the box interval with the binding axes.
  const clipNode = (
    scale: number[],
    offset: number[],
  ): {
    ok: boolean;
    enter: number;
    exit: number;
    enterAxes: number;
    exitAxes: number;
  } => {
    let enter = f(-1e30);
    let exit = f(1e30);
    let enterAxes = 0;
    let exitAxes = 0;
    for (let axis = 0; axis < dim; axis++) {
      const s = scale[axis];
      const lo0 = f(offset[axis] + f(s * rootMin[axis]));
      const hi0 = f(offset[axis] + f(s * rootMax[axis]));
      const lo = Math.min(lo0, hi0);
      const hi = Math.max(lo0, hi0);
      const d = qd[axis];
      if (d === 0) {
        if (q[axis] < lo || q[axis] > hi) {
          return { ok: false, enter, exit, enterAxes, exitAxes };
        }
        continue;
      }
      const ta = f(f(lo - q[axis]) / d);
      const tb = f(f(hi - q[axis]) / d);
      const near = f(Math.min(ta, tb));
      const far = f(Math.max(ta, tb));
      if (near > enter) {
        enter = near;
        enterAxes = 1 << axis;
      } else if (near === enter) {
        enterAxes |= 1 << axis;
      }
      if (far < exit) {
        exit = far;
        exitAxes = 1 << axis;
      } else if (far === exit) {
        exitAxes |= 1 << axis;
      }
    }
    if (!(exit > enter)) {
      return { ok: false, enter, exit, enterAxes, exitAxes };
    }
    return { ok: true, enter, exit, enterAxes, exitAxes };
  };
  // The leaf's box (finLeafBox / finBoxCenterHalf / finBoxHalfMax).
  const leafBox = (
    w0: number,
    w1: number,
  ): { center: number[]; half: number[]; halfMax: number } => {
    const { scale, offset } = compose(w0, w1, level);
    const center: number[] = [];
    const half: number[] = [];
    for (let axis = 0; axis < 4; axis++) {
      const lo = f(offset[axis] + f(scale[axis] * rootMin[axis]));
      const hi = f(offset[axis] + f(scale[axis] * rootMax[axis]));
      center.push(f(f(lo + hi) * 0.5));
      half.push(f(Math.abs(hi - lo) * 0.5));
    }
    let halfMax = 0;
    for (let axis = 0; axis < dim; axis++) {
      halfMax = Math.max(halfMax, Math.abs(half[axis]));
    }
    return { center, half, halfMax };
  };
  // The exact-corner normal — the WGSL finiteBoundaryNormal's own
  // arithmetic, fround per op (the shipped twin's text, one tree up).
  const rowXyz = (axis: number): Vec3 => {
    const row = poseRows
      ? poseRows[axis]
      : axis === 0
        ? [1, 0, 0, 0]
        : axis === 1
          ? [0, 1, 0, 0]
          : [0, 0, 1, 0];
    return [f(row[0]), f(row[1]), f(row[2])];
  };
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
  // The anchor's validation and reconstruction — validGeneralAnchor plus
  // the leaf-box snap/clamp, the WGSL anchor path term for term.
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
        if (plane !== 0 && plane !== 1) return refused(2);
        if (a >= dim) return refused(2);
      } else if (plane !== -1) {
        return refused(2);
      }
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
    let masked = 0;
    for (let a = 0; a < 4; a++) {
      if ((anchor.planeMask & (1 << a)) === 0) continue;
      masked++;
    }
    if (masked === 0) return refused(2);
    const box = leafBox(anchor.cellIndices[0], anchor.cellIndices[1]);
    const envelope = f(tieRel * box.halfMax);
    // The anchor's intrinsic point seeds the reconstruction (the
    // reference's authoritative coordinate) before the snap/clamp.
    for (let a = 0; a < 4; a++) {
      q[a] = f(anchor.intrinsicPoint[a]);
    }
    for (let a = 0; a < dim; a++) {
      const lower = f(box.center[a] - box.half[a]);
      const upper = f(box.center[a] + box.half[a]);
      if ((anchor.planeMask & (1 << a)) !== 0) {
        q[a] = anchor.planeIndices[a] === 0 ? lower : upper;
      } else if (q[a] < lower) {
        if (f(lower - q[a]) > envelope) return refused(2);
        q[a] = lower;
      } else if (q[a] > upper) {
        if (f(q[a] - upper) > envelope) return refused(2);
        q[a] = upper;
      }
    }
  } else if (!anchor) {
    if (!origin.every(Number.isFinite)) return refused(2);
  }
  // The pruned enumeration (finEnumerate): the leaves in lexicographic
  // word order, subtrees pruned when the ray misses their box, capped.
  const endpoints: GeneralEndpointF32[] = [];
  const pushLeaf = (
    w0: number,
    w1: number,
    clip: ReturnType<typeof clipNode>,
  ): boolean => {
    // The cap check precedes the pair, exactly the WGSL's.
    if (endpoints.length + 2 > leafCap * 2) return false;
    endpoints.push({ t: clip.enter, delta: 1, w0, w1, axes: clip.enterAxes });
    endpoints.push({ t: clip.exit, delta: 0, w0, w1, axes: clip.exitAxes });
    return true;
  };
  if (level === 0) {
    const clip = clipNode([1, 1, 1, 1], [0, 0, 0, 0]);
    if (clip.ok && !pushLeaf(-1, -1, clip)) return refused(1);
  } else {
    for (let a0 = 0; a0 < mapCount; a0++) {
      const word1 = compose(a0, -1, 1);
      if (level === 1) {
        const clip = clipNode(word1.scale, word1.offset);
        if (clip.ok && !pushLeaf(a0, -1, clip)) return refused(1);
        continue;
      }
      const node = clipNode(word1.scale, word1.offset);
      if (!node.ok) continue;
      for (let a1 = 0; a1 < mapCount; a1++) {
        const word2 = compose(a0, a1, 2);
        const clip = clipNode(word2.scale, word2.offset);
        if (clip.ok && !pushLeaf(a0, a1, clip)) return refused(1);
      }
    }
  }
  // The stable sort (finSortEndpoints): by t, ties keep the DFS order.
  for (let i = 1; i < endpoints.length; i++) {
    const key = endpoints[i];
    let j = i;
    while (j > 0 && endpoints[j - 1].t > key.t) {
      endpoints[j] = endpoints[j - 1];
      j--;
    }
    endpoints[j] = key;
  }
  // The event construction (finEvent), fround per op.
  const event = (
    t: number,
    entering: boolean,
    groupLo: number,
    groupHi: number,
  ): FiniteSolidDdaF32Result => {
    let planeMask = 0;
    let axis = 0;
    let firstAxis = true;
    for (let m = groupLo; m < groupHi; m++) {
      const axes = endpoints[m].axes;
      for (let a = 0; a < dim; a++) {
        if ((axes & (1 << a)) === 0) continue;
        planeMask |= 1 << a;
        if (firstAxis) {
          axis = a;
          firstAxis = false;
        } else if (Math.abs(qd[a]) > Math.abs(qd[axis])) {
          axis = a;
        }
      }
    }
    const normal = boundaryNormal(planeMask, entering);
    if (!normal) return refused(6);
    const incidentW0 = endpoints[groupLo].w0;
    const incidentW1 = endpoints[groupLo].w1;
    const box = leafBox(incidentW0, incidentW1);
    const envelope = f(tieRel * box.halfMax);
    const intrinsic = [0, 0, 0, 0];
    const anchorPlanes = [-1, -1, -1, -1];
    const anchorCells = [-1, -1, -1, -1];
    for (let a = 0; a < dim; a++) {
      intrinsic[a] = f(q[a] + f(t * qd[a]));
      if (a < level) {
        anchorCells[a] = a === 0 ? incidentW0 : incidentW1;
      }
    }
    for (let a = 0; a < dim; a++) {
      if ((planeMask & (1 << a)) === 0) continue;
      anchorPlanes[a] = entering !== qd[a] > 0 ? 1 : 0;
      intrinsic[a] =
        anchorPlanes[a] === 0
          ? f(box.center[a] - box.half[a])
          : f(box.center[a] + box.half[a]);
    }
    for (let a = 0; a < dim; a++) {
      if ((planeMask & (1 << a)) !== 0) continue;
      const lower = f(box.center[a] - box.half[a]);
      const upper = f(box.center[a] + box.half[a]);
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
  // The sweep (finSweep): greedy tie groups, the start state at tMin = 0,
  // the first later zero-crossing of the coverage.
  const total = endpoints.length;
  let coverage = 0;
  let idx = 0;
  let haveStart = false;
  let startAfter = 0;
  let startAtGroup = false;
  let startLo = 0;
  let startHi = 0;
  // The first zero-crossing AFTER the start, held until the claim check
  // has admitted the walk (the reference's order: a mismatching claim
  // refuses before any walk event is emitted).
  let haveFlip = false;
  let flipT = 0;
  let flipEntering = false;
  let flipLo = 0;
  let flipHi = 0;
  let started = false;
  while (idx < total) {
    const groupT = endpoints[idx].t;
    const tie = f(tieRel * Math.max(1, Math.abs(groupT)));
    let j = idx;
    let net = 0;
    while (j < total && f(endpoints[j].t - groupT) <= tie) {
      net += endpoints[j].delta === 1 ? 1 : -1;
      j++;
    }
    const before = coverage;
    coverage += net;
    if (!started && groupT <= tie) {
      haveStart = true;
      startAfter = coverage;
      startAtGroup = f(Math.abs(groupT)) <= tie;
      startLo = idx;
      startHi = j;
      idx = j;
      continue;
    }
    started = true;
    if (
      !haveFlip &&
      ((before === 0 && coverage > 0) || (before > 0 && coverage === 0))
    ) {
      haveFlip = true;
      flipT = groupT;
      flipEntering = coverage > 0;
      flipLo = idx;
      flipHi = j;
    }
    idx = j;
  }
  const stateMatches = startAfter > 0 === inside;
  if (!stateMatches) {
    if (haveStart && startAtGroup && !anchor) {
      return event(0, startAfter > 0, startLo, startHi);
    }
    return refused(3);
  }
  if (haveFlip) {
    return event(flipT, flipEntering, flipLo, flipHi);
  }
  return miss();
}
