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
 * against the f64 oracle through `surface-transport-fixture.ts`'s finite
 * adapter, tolerance-based like every f32/f64 pair. The DDA's exact-tie
 * crossings (an f64-equal crossing time on two axes) may split by ulps in
 * f32 into two sequential face events; the legs disclose that class the
 * way the escape legs disclose their ULP ensemble, and the optics effect
 * at a split corner is two refractions within one crossing scale.
 */

import type { FiniteSolidAnchor } from "./finite-solid";
import type { Vec3, Vec4 } from "./types";

/** The finite-solid params tail: 16 bytes appended past the shared base
 * (3D, offset 208) or the shared 4D tail (4D, offset 464). */
export const SURFACE_GPU_PARAMS_FINITE_BYTES = 224;
export const SURFACE_GPU_PARAMS4_FINITE_BYTES = 480;

/** The f32 envelope the DDA's reconstruction clamps within — the CPU
 * oracle's `COORDINATE_ENVELOPE_REL` (2·2^-23), relative to the half
 * extent; emitted as a literal so the WGSL reads the same number. */
const FINITE_ENVELOPE_REL = 2 * 2 ** -23;

// The WGSL float-literal form `surface-de-gpu.ts`'s own wgslFloatLit emits
// (the plain shortest string, `.0`-suffixed when integral) — the same
// convention, restated locally because the dependency runs one way.
const floatLit = (x: number): string => {
  const s = String(x);
  return /[.e]/.test(s) ? s : `${s}.0`;
};
const finiteEnvelopeLiteral = floatLit(FINITE_ENVELOPE_REL);
const finiteRefineLiteral = floatLit(1 / 6);
const finiteSafetyLiteral = floatLit(0.9);

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
  // both exact in f32 (no multiply-add cancellation, the grid-plane
  // form's own property one multiplication over).
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
  const de = `// The display marcher's certified hybrid (finite-solid.ts's
// finiteSolidDisplayDistance): the level-1 boxes' min, each refined into
// its occupied children within tau of its own boundary. The refinement is
// what keeps the axis tunnels' mouth patches from reading zero — the
// plain level-1 min would seal every tunnel at its mouth plane — and the
// min stays a certified lower bound of the distance to the union, so a
// march step can never skip the surface. The zero set is exactly the
// union's boundary (interior shared child faces are unreachable from
// outside, the flat field's own documented convention). Level 1 returns
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
export function finiteSolidTransportSource(dim: 3 | 4): string {
  const dim4 = dim === 4;
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
  let width = (2.0 * half) / f32(params.finiteGrid);
  let u = (value + half) / width;
  let g = i32(params.finiteGrid);
  if (u <= 0.0) {
    return select(0, -1, d < 0.0);
  }
  if (u >= f32(g)) {
    return select(g - 1, g, d > 0.0);
  }
  let lower = i32(floor(u));
  if (u == floor(u) && d < 0.0) {
    return lower - 1;
  }
  // A ray coincident with a grid plane uses its upper half-open cell —
  // deterministic one-sided ownership, not closed membership.
  return lower;
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
  if (!(dot(dir, dir) > 0.0)) {
    result.reason = 2u;
    return result;
  }
  let half = params.finiteHalf;
  let g = i32(params.finiteGrid);
  let width = (2.0 * half) / f32(g);
  let maxVisits = ${dim} * (g - 1) + 1;
  var q = finiteLift(origin);
  var qd = finiteLiftDir(dir);
  if (anchorPresent == 1u) {
    for (var a = 0; a < ${dim}; a++) {
      if ((anchorMask & (1u << u32(a))) != 0u) {
        q[a] = finiteGridPlane(anchorPlanesIn[a]);
      } else {
        let lower = finiteGridPlane(anchorCellsIn[a]);
        let upper = finiteGridPlane(anchorCellsIn[a] + 1);
        if (q[a] < lower) {
          q[a] = lower;
        } else if (q[a] > upper) {
          q[a] = upper;
        }
      }
    }
  }
  // clipRoot: the per-axis slabs of the root box.
  var enter = -1.0e30;
  var exitT = 1.0e30;
  var enterAxes: array<i32, 4> = array<i32, 4>(0, 0, 0, 0);
  var enterAxisCount = 0;
  for (var a = 0; a < ${dim}; a++) {
    if (qd[a] == 0.0) {
      if (q[a] < -half || q[a] > half) {
        result.kind = 2u;
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
      return result;
    }
  }
  var start = max(0.0, enter);
  if (exitT < start || (anchorPresent == 0u && exitT == start)) {
    result.kind = 2u;
    return result;
  }
  var index: array<i32, 4> = array<i32, 4>(0, 0, 0, 0);
  for (var a = 0; a < ${dim}; a++) {
    index[a] = finiteRaySideIndex(q[a] + start * qd[a], qd[a]);
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
        let u = (q[a] + start * qd[a] + half) / width;
        if (u == round(u) && qd[a] != 0.0) {
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
      planeIndices[a] = i32(round((q[a] + start * qd[a] + half) / width));
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
  }
  loop {
    var nextT = 1.0e30;
    var crossingT: array<f32, 4> =
      array<f32, 4>(1.0e30, 1.0e30, 1.0e30, 1.0e30);
    for (var a = 0; a < ${dim}; a++) {
      if (qd[a] == 0.0) {
        continue;
      }
      let planeIndex = select(index[a], index[a] + 1, qd[a] > 0.0);
      let plane = finiteGridPlane(planeIndex);
      crossingT[a] = (plane - q[a]) / qd[a];
      nextT = min(nextT, crossingT[a]);
    }
    if (nextT >= 1.0e30) {
      result.kind = 2u;
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
    var oldIndex: array<i32, 4> = index;
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
        planeIndices[a] = select(oldIndex[a], oldIndex[a] + 1, qd[a] > 0.0);
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
      return result;
    }
  }
}
`;
}

/**
 * The WGSL DDA re-executed in TypeScript with every arithmetic result
 * rounded to f32 (`sphereInversionF32`'s discipline one family over) —
 * the bench legs' twin for a DISCRETE walk. The f64 oracle stays the
 * soundness record (`finite-solid.ts`, pinned by its harness); this twin
 * exists because the DDA's cell sequence is decided by exact tie tests
 * and integer-adjacent classifications, which an f64 twin does not
 * bracket: the kernel's f32 crossing times can order two near-equal
 * axes differently than f64, and the walks then genuinely diverge. The
 * DDA uses only IEEE-exact operations (add, sub, mul, div, min, max,
 * abs, floor, round, sqrt on small ints) in matching order, so the twin
 * and a conforming driver agree to driver FMA contraction alone — the
 * leg pins kind/reason/t/indices bit-exactly and the normal to a tight
 * tolerance. Inputs are f32-quantized here (the control wire's own
 * contract): the caller may pass f64, the twin rounds first.
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
  half: number,
  poseRows: readonly Vec4[] | null,
  w0: number,
  origin: Vec3,
  dir: Vec3,
  anchor: FiniteSolidAnchor | null,
  inside: boolean,
): FiniteSolidDdaF32Result {
  const f = Math.fround;
  const grid = 3 ** level;
  const envelope = f(half * FINITE_ENVELOPE_REL);
  const finiteGridPlane = (i: number): number => {
    if (i === 0) return f(-half);
    if (i === grid) return f(half);
    return f(f(f(half * f(2 * i - grid))) / grid);
  };
  const finiteOccupied = (idx: number[]): boolean => {
    for (let a = 0; a < dim; a++) {
      if (idx[a] < 0 || idx[a] >= grid) return false;
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
  };
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
    const pv = [f(origin[0]), f(origin[1]), f(origin[2]), f(w0)];
    for (let a = 0; a < 4; a++) {
      const row = poseRows[a];
      q[a] = f(
        f(f(f(row[0] * pv[0]) + f(row[1] * pv[1])) + f(row[2] * pv[2])) +
          f(row[3] * pv[3]),
      );
      qd[a] = f(
        f(f(row[0] * dir[0]) + f(row[1] * dir[1])) + f(row[2] * dir[2]),
      );
    }
  } else {
    q[0] = f(origin[0]);
    q[1] = f(origin[1]);
    q[2] = f(origin[2]);
    q[3] = 0;
    qd[0] = f(dir[0]);
    qd[1] = f(dir[1]);
    qd[2] = f(dir[2]);
    qd[3] = 0;
  }
  const width = f(f(2 * half) / grid);
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
  if (!(f(f(qd[0] * qd[0]) + f(f(qd[1] * qd[1]) + f(qd[2] * qd[2]))) > 0)) {
    return refused(2);
  }
  if (anchor) {
    for (let a = 0; a < dim; a++) {
      if ((anchor.planeMask & (1 << a)) !== 0) {
        q[a] = finiteGridPlane(anchor.planeIndices[a]);
      } else {
        const lower = finiteGridPlane(anchor.cellIndices[a]);
        const upper = finiteGridPlane(anchor.cellIndices[a] + 1);
        if (q[a] < lower) q[a] = lower;
        else if (q[a] > upper) q[a] = upper;
      }
    }
  }
  let enter = f(-1e30);
  let exitT = f(1e30);
  let enterAxes: number[] = [];
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
  const start = f(Math.max(0, enter));
  if (exitT < start || (!anchor && exitT === start)) return miss();
  const raySideIndex = (value: number, d: number): number => {
    const u = f(f(value + half) / width);
    if (u <= 0) return d < 0 ? -1 : 0;
    if (u >= grid) return d > 0 ? grid : grid - 1;
    const lower = Math.floor(u);
    if (u === lower && d < 0) return lower - 1;
    return lower;
  };
  const index: number[] = [0, 0, 0, 0];
  for (let a = 0; a < dim; a++) {
    index[a] = raySideIndex(f(q[a] + f(start * qd[a])), qd[a]);
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
        const u = f(f(f(q[a] + f(start * qd[a])) + half) / width);
        if (u === Math.round(u) && qd[a] !== 0) axes.push(a);
      }
    }
    if (axes.length === 0) return refused(3);
    const planeIndices = [-1, -1, -1, -1];
    for (const a of axes) {
      planeIndices[a] = Math.round(
        f(f(f(q[a] + f(start * qd[a])) + half) / width),
      );
    }
    return event(start, sideInside, axes, planeIndices, index);
  }
  for (;;) {
    let nextT = 1e30;
    const crossingT = [1e30, 1e30, 1e30, 1e30];
    for (let a = 0; a < dim; a++) {
      if (qd[a] === 0) continue;
      const planeIndex = qd[a] > 0 ? index[a] + 1 : index[a];
      const plane = finiteGridPlane(planeIndex);
      crossingT[a] = f(f(plane - q[a]) / qd[a]);
      nextT = f(Math.min(nextT, crossingT[a]));
    }
    if (nextT >= 1e30) return miss();
    if (nextT < start) return refused(5);
    const axes: number[] = [];
    for (let a = 0; a < dim; a++) {
      if (crossingT[a] === nextT) axes.push(a);
    }
    const oldIndex = [...index];
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
        planeIndices[a] = qd[a] > 0 ? oldIndex[a] + 1 : oldIndex[a];
      }
      const result = event(nextT, nextInside, axes, planeIndices, index);
      if (result.kind === 3) return result;
      if (sideInside !== mediumInside) return refused(3);
      return result;
    }
    sideInside = nextInside;
    if (!inRoot) return miss();
  }
}
