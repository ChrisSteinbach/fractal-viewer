/**
 * The sphere-inversion family's GPU half: the generator/seed table wire, the
 * ONE dimension-parameterized WGSL estimator body both compute cores emit
 * (`surface-de-gpu.ts`'s `core: "sphereInv"` and `"sphereInv4"`), and its f32
 * TypeScript twin. The plan and its confirmed decisions are
 * `docs/sphere-inversion-gpu.md`; the CPU oracle this mirrors term for term
 * is `sphere-inversion-de.ts` / `sphere-inversion-de-4d.ts`, whose covering
 * tables (`buildSphereInversionTables`) are the only input read here.
 *
 * THE TABLE WIRE (the maps binding, re-typed `array<vec4f>`): one entry per
 * generalized ball, 1 vec4 in 3D `(c.xyz, ±r)` and 2 in 4D `(c.xyzw)`,
 * `(±r, 0, 0, 0)`, the sign carrying the member's sign (radii are positive).
 * In order: the `n` generators, the `s` seed members, then per generator `j`
 * its `s` seed images followed by its `n − 1` gap balls `I_j(B_l)` in
 * gap-index order. DEDUPLICATED: `copies[j]`'s complement members are exactly
 * `gaps[j]`'s balls with the sign flipped, so each gap ball is stored once and
 * one pass serves both terms. Term `j` starts at `n + s + j·(s + n − 1)`.
 *
 * THE BODY mirrors the CPU estimator with four deliberate, recorded changes:
 *
 *   - THE CONTAINING-BALL SEARCH (decision 5) is the radial reject plus the
 *     nearest-centre test when the tables are a UNIT arrangement (centres at
 *     distance 1, one shared radius): `x ∈ B(c, r)` with `|c| = 1` implies
 *     `||x| − 1| < r`, and disjoint interiors make the containing ball the
 *     nearest centre, so a fold test is one dot-product scan and one radius
 *     test. VALUE-IDENTICAL to the CPU's lowest-index linear test (it can
 *     differ only on a tangency point, where no open ball holds `x`); the
 *     reject is widened by the slack so an f32-rounded unit centre never
 *     rejects a point the linear test admits. A non-unit construction takes
 *     the linear test in the same kernel.
 *   - AN ABSOLUTE SLACK (decision 4): a positive transported bound returns
 *     `max(0, v − slack)` with {@link SPHERE_INVERSION_GPU_SLACK}. The f32
 *     rounding the transport carries back is a sum of per-step roundings, each
 *     at its own step's scale and none amplified, so the world-space excess is
 *     flat in depth (measured at most 3.3e-7 on the CPU emulation). Never a
 *     relative factor. The params packers clamp the hit acceptance floor to at
 *     least the slack, so a ray can always accept where the slack zeroes the
 *     bound — the zoom floor this implies is a world-space acceptance of 1e-6.
 *   - THE f32 POLE FLOOR is `2^-20·r` ({@link SPHERE_INVERSION_GPU_POLE_FLOOR});
 *     the CPU's `1e-12·r` is below f32 resolution.
 *   - THE CUTOFF IS IGNORED (decision 7): every return is the cutoff-0 value,
 *     which satisfies `surface-de.ts`'s contract trivially.
 *
 * ATTRIBUTION (decision 6) comes out of the same evaluation: the winning
 * term's word length (GENERATION), the fold's closest normalized radial
 * approach, and the binding seed member — see {@link sphereInversionF32}.
 */
import { inversionDistanceShaderSource } from "./inversion";
import {
  SPHERE_INVERSION_FOLD_DOMAIN,
  SPHERE_INVERSION_FOLD_EXHAUSTED,
  SPHERE_INVERSION_FOLD_POLE,
  SPHERE_INVERSION_MAX_DEPTH,
} from "./sphere-inversion";
import type {
  SphereInversionFoldStatus,
  SphereInversionTables,
} from "./sphere-inversion";

/** The absolute f32 slack subtracted from a positive transported bound, in
 * world units (decision 4). Valid because every shipped arrangement is
 * unit-distance; it rides the params wire (`siRadii.w`) so a future
 * explicit-authoring arrangement can scale it without a layout change. */
export const SPHERE_INVERSION_GPU_SLACK = 1e-6;

/** The f32 pole floor, relative to the generator radius: `|x − c| <= 2^-20·r`
 * counts as AT the centre and returns 0. */
export const SPHERE_INVERSION_GPU_POLE_FLOOR = 2 ** -20;

/** The generator cap the kernel's per-eval distance scratch is sized to —
 * the registry maximum (the 600-cell). */
export const SPHERE_INVERSION_GPU_MAX_GENERATORS = 120;

/** How close to 1 every centre distance must be (and how exactly the radii
 * must agree) for the tables to take the unit-arrangement search. */
export const SPHERE_INVERSION_GPU_UNIT_TOLERANCE = 1e-9;

/** The packed table wire plus the header scalars the params packers write. */
export interface SphereInversionGpuTables {
  dim: 3 | 4;
  /** The flat `array<vec4f>` payload (module doc layout). */
  data: Float32Array;
  generatorCount: number;
  seedCount: number;
  depth: number;
  /** `s + n − 1`: entries per generator term. */
  termStride: number;
  /** Centres at distance 1 with one shared radius: the radial reject and
   * nearest-centre search are valid. */
  uniformUnit: boolean;
  /** The shared generator radius when {@link uniformUnit}, else 0. */
  uniformRadius: number;
  /** The origin-centred ball enclosing the orbit — the full 4D radius in 4D. */
  boundingRadius: number;
}

/** Pack `buildSphereInversionTables` output (a `SphereInversionDE` is one)
 * into the deduplicated table wire. Throws past the generator or depth cap,
 * and when a copy term's complement members are not its gap balls with the
 * sign flipped (the dedup's precondition). */
export function packSphereInversionGpuTables(
  tables: SphereInversionTables,
): SphereInversionGpuTables {
  const { dim, generatorCount: n, seedCount: s, depth } = tables;
  if (n < 1 || n > SPHERE_INVERSION_GPU_MAX_GENERATORS) {
    throw new RangeError(
      `sphere-inversion GPU: ${n} generators is outside [1, ${SPHERE_INVERSION_GPU_MAX_GENERATORS}]`,
    );
  }
  if (
    !Number.isInteger(depth) ||
    depth < 0 ||
    depth > SPHERE_INVERSION_MAX_DEPTH
  ) {
    throw new RangeError(`sphere-inversion GPU: bad depth ${depth}`);
  }
  const stride = s + n - 1;
  const entries = n + s + n * stride;
  const vecPer = dim === 3 ? 1 : 2;
  const data = new Float32Array(entries * vecPer * 4);
  const put = (
    entry: number,
    center: ArrayLike<number>,
    at: number,
    r: number,
  ) => {
    const o = entry * vecPer * 4;
    for (let a = 0; a < dim; a++) data[o + a] = center[at + a];
    data[o + (dim === 3 ? 3 : 4)] = r;
  };
  for (let j = 0; j < n; j++) {
    put(j, tables.generatorCenter, j * dim, tables.generatorRadius[j]);
  }
  const seedTable = tables.domainSeed;
  for (let i = 0; i < s; i++) {
    put(
      n + i,
      seedTable.center,
      i * dim,
      seedTable.sign[i] * seedTable.radius[i],
    );
  }
  for (let j = 0; j < n; j++) {
    const copy = tables.copies[j];
    const gap = tables.gaps[j];
    if (copy.count !== s + n || gap.count !== n - 1) {
      throw new Error(
        `sphere-inversion GPU: term ${j} has ${copy.count} copy / ${gap.count} gap members, expected ${s + n} / ${n - 1}`,
      );
    }
    const base = n + s + j * stride;
    for (let i = 0; i < s; i++) {
      put(base + i, copy.center, i * dim, copy.sign[i] * copy.radius[i]);
    }
    for (let i = 0; i < n - 1; i++) {
      const c = s + 1 + i;
      let same = copy.sign[c] === -1 && copy.radius[c] === gap.radius[i];
      for (let a = 0; a < dim; a++) {
        same &&= copy.center[c * dim + a] === gap.center[i * dim + a];
      }
      if (!same) {
        throw new Error(
          `sphere-inversion GPU: term ${j} complement member ${c} is not gap ball ${i} with its sign flipped`,
        );
      }
      put(base + s + i, gap.center, i * dim, gap.radius[i]);
    }
  }
  const r0 = tables.generatorRadius[0];
  let uniformUnit = true;
  for (let j = 0; j < n && uniformUnit; j++) {
    let d2 = 0;
    for (let a = 0; a < dim; a++)
      d2 += tables.generatorCenter[j * dim + a] ** 2;
    uniformUnit =
      Math.abs(Math.sqrt(d2) - 1) <= SPHERE_INVERSION_GPU_UNIT_TOLERANCE &&
      tables.generatorRadius[j] === r0;
  }
  return {
    dim,
    data,
    generatorCount: n,
    seedCount: s,
    depth,
    termStride: stride,
    uniformUnit,
    uniformRadius: uniformUnit ? r0 : 0,
    boundingRadius: tables.boundingRadius,
  };
}

/**
 * The WGSL estimator body for dimension `dim` (module doc). Emits
 * `inversionDistanceLowerBound` (verbatim, the shared transport), the
 * `SiResult` record, the table accessors, `siEstimate(q)` — value plus the
 * fold/term bookkeeping — and the two attribution helpers `siGeneration` and
 * `siSeedMember`. It reads `params.siCounts` (n, s, D, termStride),
 * `params.siRadii` (r, r², pole floor², slack), `params.siFlags` (uniformUnit)
 * and `siTable`, the table binding; the host kernel declares all of them and
 * owns the public `surfaceDE`/`surfaceDEHitInfo` wrappers.
 */
export function sphereInversionWgslSource(dim: 3 | 4): string {
  const V = dim === 3 ? "vec3f" : "vec4f";
  const center = dim === 3 ? "siTable[i].xyz" : "siTable[2u * i]";
  const radius = dim === 3 ? "siTable[i].w" : "siTable[2u * i + 1u].x";
  const MAXD = SPHERE_INVERSION_MAX_DEPTH;
  const MAXG = SPHERE_INVERSION_GPU_MAX_GENERATORS;
  return /* wgsl */ `// The shared empty-ball transport (inversion.ts), verbatim.
${inversionDistanceShaderSource("wgsl")}

struct SiResult {
  d: f32,
  x: ${V},
  k: u32,
  status: u32,
  parent: i32,
  first: i32,
  termJ: i32,
  termGap: i32,
  ring: f32,
}

fn siCenter(i: u32) -> ${V} {
  return ${center};
}

// Signed radius: the member's sign rides the radius lane.
fn siRadius(i: u32) -> f32 {
  return ${radius};
}

// A generalized ball's exact SDF: +(|x - c| - r) for a ball, the negation
// for the complement of an open ball.
fn siMember(x: ${V}, i: u32) -> f32 {
  let rs = siRadius(i);
  let v = length(x - siCenter(i)) - abs(rs);
  return select(v, -v, rs < 0.0);
}

// sphere-inversion-de${dim === 4 ? "-4d" : ""}.ts's evaluate${dim} in f32, cutoff ignored.
fn siEstimate(q: ${V}) -> SiResult {
  let n = params.siCounts.x;
  let s = params.siCounts.y;
  let depth = params.siCounts.z;
  let stride = params.siCounts.w;
  let slack = params.siRadii.w;
  var x = q;
  var k = 0u;
  var parent = -1;
  var first = -1;
  var status = ${SPHERE_INVERSION_FOLD_DOMAIN}u;
  var foldR: array<f32, ${MAXD}>;
  var foldR2: array<f32, ${MAXD}>;
  var ring = 1.0;
  // THE FOLD. Each pass either breaks or spends one inversion, and the
  // budget D <= ${MAXD}, so the structural bound never binds.
  for (var it = 0u; it <= ${MAXD}u; it++) {
    var found = -1;
    var foundD2 = 0.0;
    if (params.siFlags.x != 0u) {
      // Unit arrangement: the radial reject, then the nearest centre (the
      // largest x.c over non-parent generators) settles containment with
      // one radius test.
      if (abs(length(x) - 1.0) < params.siRadii.x + slack) {
        var bestDot = -3.0e38;
        var bestJ = -1;
        for (var j = 0u; j < n; j++) {
          if (i32(j) == parent) {
            continue;
          }
          let dd = dot(x, siCenter(j));
          if (dd > bestDot) {
            bestDot = dd;
            bestJ = i32(j);
          }
        }
        if (bestJ >= 0) {
          let dv = x - siCenter(u32(bestJ));
          let d2 = dot(dv, dv);
          let rj = siRadius(u32(bestJ));
          if (d2 < rj * rj) {
            found = bestJ;
            foundD2 = d2;
          }
        }
      }
    } else {
      // The CPU's own linear test: the lowest-index open ball.
      for (var j = 0u; j < n; j++) {
        if (i32(j) == parent) {
          continue;
        }
        let dv = x - siCenter(j);
        let d2 = dot(dv, dv);
        let rj = siRadius(j);
        if (d2 < rj * rj) {
          found = i32(j);
          foundD2 = d2;
          break;
        }
      }
    }
    if (found < 0) {
      break;
    }
    if (k == depth) {
      status = ${SPHERE_INVERSION_FOLD_EXHAUSTED}u;
      break;
    }
    let c = siCenter(u32(found));
    let rf = siRadius(u32(found));
    let r2 = rf * rf;
    if (foundD2 <= params.siRadii.z * r2) {
      status = ${SPHERE_INVERSION_FOLD_POLE}u;
      break;
    }
    x = c + (r2 / foundD2) * (x - c);
    foldR[k] = sqrt(foundD2);
    foldR2[k] = r2;
    ring = min(ring, foldR[k] / rf);
    if (k == 0u) {
      first = found;
    }
    k++;
    parent = found;
  }
  var res = SiResult(0.0, x, k, status, parent, first, -1, -1, ring);
  if (status == ${SPHERE_INVERSION_FOLD_POLE}u) {
    return res;
  }
  let m = depth - k;
  // THE COVER. The folded seed K ∩ F: seed members, then ext(B_i), whose
  // distances the per-generator prune below reuses.
  var best = -3.0e38;
  for (var i = 0u; i < s; i++) {
    best = max(best, siMember(x, n + i));
  }
  var gd: array<f32, ${MAXG}>;
  for (var i = 0u; i < n; i++) {
    let di = length(x - siCenter(i));
    gd[i] = di;
    best = max(best, siRadius(i) - di);
  }
  var termJ = -1;
  var termGap = -1;
  if (best > 0.0) {
    for (var j = 0u; j < n; j++) {
      let isParent = i32(j) == parent;
      if (!isParent && m < 1u) {
        continue;
      }
      let rj = siRadius(j);
      // Everything this generator's ball can hold lies inside it.
      if (gd[j] - rj >= best) {
        continue;
      }
      let base = n + s + j * stride;
      // The one-step copy I_j(K ∩ F): its seed images, B_j itself, and the
      // complements of its gap balls — whose plain distances are the depth-2
      // gap term, so one pass serves both.
      var copy = gd[j] - rj;
      for (var i = 0u; i < s; i++) {
        copy = max(copy, siMember(x, base + i));
      }
      var minGap = 3.0e38;
      var gapArg = 0u;
      for (var i = 0u; i + 1u < n; i++) {
        let e = base + s + i;
        let v = length(x - siCenter(e)) - siRadius(e);
        if (v < minGap) {
          minGap = v;
          gapArg = i;
        }
      }
      copy = max(copy, -minGap);
      if (copy < best) {
        best = copy;
        termJ = i32(j);
        termGap = -1;
      }
      if (best <= 0.0) {
        break;
      }
      if ((isParent || m >= 2u) && minGap < best) {
        best = minGap;
        termJ = i32(j);
        termGap = i32(gapArg);
      }
    }
  }
  // THE TRANSPORT, innermost first, then the absolute f32 slack. A return
  // <= 0 is the folded member signal, untransported, as on the CPU.
  var v = best;
  if (best > 0.0) {
    for (var i = k; i > 0u; i--) {
      v = inversionDistanceLowerBound(foldR[i - 1u], foldR2[i - 1u], v);
    }
    v = max(0.0, v - slack);
  }
  res.d = v;
  res.termJ = termJ;
  res.termGap = termGap;
  return res;
}

// The winning term's word length: the fold depth for the folded seed, +1 for
// a one-step copy, +2 for a depth-2 gap ball.
fn siGeneration(res: SiResult) -> u32 {
  if (res.termJ < 0) {
    return res.k;
  }
  if (res.termGap < 0) {
    return res.k + 1u;
  }
  return res.k + 2u;
}

// The binding (max-SDF, lowest index on a tie) member of the winning
// intersection when it is a seed member, else -1 (a generator wall, a gap
// ball or a pole).
fn siSeedMember(res: SiResult) -> i32 {
  if (res.status == ${SPHERE_INVERSION_FOLD_POLE}u || res.termGap >= 0) {
    return -1;
  }
  let n = params.siCounts.x;
  let s = params.siCounts.y;
  let x = res.x;
  var seedBase = n;
  var rest = -3.0e38;
  if (res.termJ < 0) {
    for (var i = 0u; i < n; i++) {
      rest = max(rest, siRadius(i) - length(x - siCenter(i)));
    }
  } else {
    let j = u32(res.termJ);
    seedBase = n + s + j * params.siCounts.w;
    rest = length(x - siCenter(j)) - siRadius(j);
    for (var i = 0u; i + 1u < n; i++) {
      let e = seedBase + s + i;
      rest = max(rest, siRadius(e) - length(x - siCenter(e)));
    }
  }
  var seedMax = -3.0e38;
  var seedArg = -1;
  for (var i = 0u; i < s; i++) {
    let v = siMember(x, seedBase + i);
    if (v > seedMax) {
      seedMax = v;
      seedArg = i32(i);
    }
  }
  return select(-1, seedArg, seedMax >= rest);
}`;
}

// ------------------------------------------------------------- f32 twin

/** The f32 twin's full record: the value plus the attribution the kernel's
 * hit-info derives from it. */
export interface SphereInversionF32Result {
  d: number;
  status: SphereInversionFoldStatus;
  /** Inversions the fold spent. */
  k: number;
  termJ: number;
  termGap: number;
  /** Word length of the winning term (see `siGeneration`). */
  generation: number;
  /** Binding seed member, −1 for a wall, gap ball or pole. */
  seedMember: number;
  /** Closest normalized radial approach of the fold, 1 at k = 0. */
  ring: number;
}

const f = Math.fround;

/**
 * The WGSL body re-executed in TypeScript with every arithmetic result
 * rounded to f32, over the SAME packed table — the bench's stability twin and
 * the unit tests' way of pinning the kernel's logic and its wire without a
 * device. A real driver may fuse or reassociate; what this cannot see is
 * exactly what the bench's one-sided real-GPU check is for. `forceLinear`
 * takes the CPU's linear containing-ball test regardless of the unit flag,
 * which is how the search acceleration's value identity is tested.
 */
export function sphereInversionF32(
  gpu: SphereInversionGpuTables,
  query: readonly number[],
  forceLinear = false,
): SphereInversionF32Result {
  const { dim, data, generatorCount: n, seedCount: s, depth } = gpu;
  const stride = gpu.termStride;
  const vecPer = dim === 3 ? 1 : 2;
  const slack = f(SPHERE_INVERSION_GPU_SLACK);
  const poleFloor2 = f(SPHERE_INVERSION_GPU_POLE_FLOOR ** 2);
  const unitR = f(gpu.uniformRadius);
  const cOf = (i: number, a: number) => data[i * vecPer * 4 + a];
  const rOf = (i: number) => data[i * vecPer * 4 + (dim === 3 ? 3 : 4)];
  const dot = (u: readonly number[], v: readonly number[]) => {
    let acc = f(u[0] * v[0]);
    for (let a = 1; a < dim; a++) acc = f(acc + f(u[a] * v[a]));
    return acc;
  };
  const sub = (x: readonly number[], i: number) =>
    x.map((xa, a) => f(xa - cOf(i, a)));
  const len = (v: readonly number[]) => f(Math.sqrt(dot(v, v)));
  const member = (x: readonly number[], i: number) => {
    const rs = rOf(i);
    const v = f(len(sub(x, i)) - Math.abs(rs));
    return rs < 0 ? -v : v;
  };

  let x = query.slice(0, dim).map(f);
  let k = 0;
  let parent = -1;
  let first = -1;
  let status: SphereInversionFoldStatus = SPHERE_INVERSION_FOLD_DOMAIN;
  const foldR: number[] = [];
  const foldR2: number[] = [];
  let ring = 1;
  for (let it = 0; it <= SPHERE_INVERSION_MAX_DEPTH; it++) {
    let found = -1;
    let foundD2 = 0;
    if (gpu.uniformUnit && !forceLinear) {
      if (Math.abs(f(len(x) - 1)) < f(unitR + slack)) {
        let bestDot = -3.0e38;
        let bestJ = -1;
        for (let j = 0; j < n; j++) {
          if (j === parent) continue;
          const c = [0, 1, 2, 3].slice(0, dim).map((a) => cOf(j, a));
          const dd = dot(x, c);
          if (dd > bestDot) {
            bestDot = dd;
            bestJ = j;
          }
        }
        if (bestJ >= 0) {
          const dv = sub(x, bestJ);
          const d2 = dot(dv, dv);
          const rj = rOf(bestJ);
          if (d2 < f(rj * rj)) {
            found = bestJ;
            foundD2 = d2;
          }
        }
      }
    } else {
      for (let j = 0; j < n; j++) {
        if (j === parent) continue;
        const dv = sub(x, j);
        const d2 = dot(dv, dv);
        const rj = rOf(j);
        if (d2 < f(rj * rj)) {
          found = j;
          foundD2 = d2;
          break;
        }
      }
    }
    if (found < 0) break;
    if (k === depth) {
      status = SPHERE_INVERSION_FOLD_EXHAUSTED;
      break;
    }
    const rf = rOf(found);
    const r2 = f(rf * rf);
    if (foundD2 <= f(poleFloor2 * r2)) {
      status = SPHERE_INVERSION_FOLD_POLE;
      break;
    }
    const sc = f(r2 / foundD2);
    x = x.map((xa, a) => f(cOf(found, a) + f(sc * f(xa - cOf(found, a)))));
    foldR[k] = f(Math.sqrt(foundD2));
    foldR2[k] = r2;
    ring = Math.min(ring, f(foldR[k] / rf));
    if (k === 0) first = found;
    k++;
    parent = found;
  }
  void first;
  const out: SphereInversionF32Result = {
    d: 0,
    status,
    k,
    termJ: -1,
    termGap: -1,
    generation: k,
    seedMember: -1,
    ring,
  };
  if (status === SPHERE_INVERSION_FOLD_POLE) return out;
  const m = depth - k;
  let best = -3.0e38;
  for (let i = 0; i < s; i++) best = Math.max(best, member(x, n + i));
  const gd: number[] = [];
  for (let i = 0; i < n; i++) {
    gd[i] = len(sub(x, i));
    best = Math.max(best, f(rOf(i) - gd[i]));
  }
  let termJ = -1;
  let termGap = -1;
  if (best > 0) {
    for (let j = 0; j < n; j++) {
      const isParent = j === parent;
      if (!isParent && m < 1) continue;
      const rj = rOf(j);
      if (f(gd[j] - rj) >= best) continue;
      const base = n + s + j * stride;
      let copy = f(gd[j] - rj);
      for (let i = 0; i < s; i++) copy = Math.max(copy, member(x, base + i));
      let minGap = 3.0e38;
      let gapArg = 0;
      for (let i = 0; i + 1 < n; i++) {
        const e = base + s + i;
        const v = f(len(sub(x, e)) - rOf(e));
        if (v < minGap) {
          minGap = v;
          gapArg = i;
        }
      }
      copy = Math.max(copy, -minGap);
      if (copy < best) {
        best = copy;
        termJ = j;
        termGap = -1;
      }
      if (best <= 0) break;
      if ((isParent || m >= 2) && minGap < best) {
        best = minGap;
        termJ = j;
        termGap = gapArg;
      }
    }
  }
  let v = best;
  if (best > 0) {
    const margin = f(1 + 2 ** -20);
    for (let i = k; i > 0; i--) {
      const qr = foldR[i - 1];
      v =
        qr <= 0 || v <= 0
          ? 0
          : f(f(qr * v) / f(f(f(foldR2[i - 1] / qr) + v) * margin));
    }
    v = Math.max(0, f(v - slack));
  }
  out.d = v;
  out.termJ = termJ;
  out.termGap = termGap;
  out.generation = termJ < 0 ? k : termGap < 0 ? k + 1 : k + 2;
  if (termGap < 0) {
    let seedBase = n;
    let rest = -3.0e38;
    if (termJ < 0) {
      for (let i = 0; i < n; i++) {
        rest = Math.max(rest, f(rOf(i) - len(sub(x, i))));
      }
    } else {
      seedBase = n + s + termJ * stride;
      rest = f(len(sub(x, termJ)) - rOf(termJ));
      for (let i = 0; i + 1 < n; i++) {
        const e = seedBase + s + i;
        rest = Math.max(rest, f(rOf(e) - len(sub(x, e))));
      }
    }
    let seedMax = -3.0e38;
    let seedArg = -1;
    for (let i = 0; i < s; i++) {
      const mv = member(x, seedBase + i);
      if (mv > seedMax) {
        seedMax = mv;
        seedArg = i;
      }
    }
    out.seedMember = seedMax >= rest ? seedArg : -1;
  }
  return out;
}
