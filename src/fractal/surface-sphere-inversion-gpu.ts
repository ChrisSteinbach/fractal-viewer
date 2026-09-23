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
  sphereInversionGenerationSlots,
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

/**
 * The generator cap the WGSL kernel's per-eval distance scratch
 * (`var gd: array<f32, N>`) is sized to — the registry maximum, the
 * 600-cell's 120 vertices.
 *
 * HELD AT THE REGISTRY MAXIMUM, deliberately, while the fragment arm's cap
 * moved off it. The two caps answer different questions: the fragment arm's
 * is a uniform BLOCK's capacity, a fixed external budget with a ceiling
 * worth taking in full, whereas this one is per-invocation scratch in a
 * compute kernel, where the only thing a raise buys is a construction that
 * does not exist. Nothing plausible sits between 120 and the next regular
 * 4D candidate (the 120-cell's 600 vertices), which is five times this and
 * would need its own cost argument long before its scratch mattered. The
 * look study is what would name a set past it; raise this then, with that
 * set to measure against, and not before.
 */
export const SPHERE_INVERSION_GPU_MAX_GENERATORS = 120;

/** How close to 1 every centre distance must be (and how exactly the radii
 * must agree) for the tables to take the unit-arrangement search. */
export const SPHERE_INVERSION_GPU_UNIT_TOLERANCE = 1e-9;

// ------------------------------------------ table size and the two caps

/**
 * How many generalized balls the table wire holds for `n` generators and `s`
 * seed members: the `n` generators, the `s` seed members, then per generator
 * its `s` seed images and `n − 1` gap balls. THE ONE DEFINITION — the packer
 * allocates from it and the fragment arm sizes its uniform block from it, so
 * the two cannot disagree about what fits. Monotone in both arguments, which
 * is what lets a single check at the caps stand for every construction
 * beneath them.
 */
export function sphereInversionTableEntries(n: number, s: number): number {
  return n + s + n * (s + n - 1);
}

/**
 * THE 3D FRAGMENT ARM'S CAPS, and why they live in this module rather than
 * beside the GLSL that reads them: the Surface gate must decide whether a
 * construction has a WebGL fallback BEFORE anything Three.js-tied loads, and
 * `surface-eligibility.ts` imports only pure modules. The arm reads this
 * file's table wire, so what fits its block is a fact about the wire.
 *
 * Distinguish them from {@link SPHERE_INVERSION_GPU_MAX_GENERATORS}, which
 * caps the WGSL kernel's per-eval distance scratch at the registry maximum:
 * these cap a std140 UNIFORM BLOCK, a far smaller budget.
 *
 * THE GENERATOR CAP IS THE BLOCK'S CEILING, NOT THE REGISTRY'S. It shipped
 * at 12 — `ico12`, the largest 3D arrangement — which made "3D always has a
 * fragment arm" true by COINCIDENCE rather than by construction, and that
 * coincidence is what let a per-dimension routing predicate look correct
 * (`surface-eligibility.ts`'s `sphereInversionComputeOnlySubject` records
 * the defect). It is now what {@link sphereInversionGlslGeneratorCeiling}
 * admits at the three-member seed: 931 table vec4 plus 35 colour vec4 =
 * 15,456 B against WebGL2's guaranteed 16,384, where 30 generators would
 * need 16,448. MEASURED before raising it, because the cost is real and
 * lands on the shipped presets rather than on a beneficiary: the block grows
 * 4.4x and the per-eval `float gd[]` scratch from 12 floats to 29.
 * `sphere-inversion-family.verify.mjs --phases=presets,gl` on a quiet AMD
 * RDNA-3 (`:0`, ANGLE/OpenGL 4.6, two runs each) read the WebGL settle for
 * `inversionPearls` at 4.5/3.9 s before and 4.6/3.8 s after, and
 * `inversionCubePearls` at 3.8 s in all four, with coverage IoU 1.0000 and
 * mean covered difference 0.040/255 against compute unmoved: no cost above
 * run-to-run noise, and the rendering identical. That is ONE machine's
 * verdict, and a weak GPU — the fallback's actual population, since the arm
 * exists for machines without WebGPU — stays unmeasured.
 */
export const SPHERE_INVERSION_GLSL_MAX_GENERATORS = 29;

/** The seed-member cap: the largest seed kind (`cutShell`'s outer ball,
 * inner complement and cutting complement). */
export const SPHERE_INVERSION_GLSL_MAX_SEED_MEMBERS = 3;

/** WebGL2's guaranteed `MAX_FRAGMENT_UNIFORM_BLOCK_SIZE`. The arm's block
 * must fit this, not the driver's actual limit: the fallback exists for the
 * machines least likely to exceed a guarantee. */
export const SPHERE_INVERSION_GLSL_BLOCK_BYTES = 16384;

/** Table entries at both caps, in the 3D wire's one vec4 per entry. */
export const SPHERE_INVERSION_GLSL_TABLE_ENTRIES = sphereInversionTableEntries(
  SPHERE_INVERSION_GLSL_MAX_GENERATORS,
  SPHERE_INVERSION_GLSL_MAX_SEED_MEMBERS,
);

/** One "By Transform" colour per generation at the deepest legal depth. Past
 * the 24 `uMapColor` slots, which is why the colours ride the block too. */
export const SPHERE_INVERSION_GLSL_COLOR_SLOTS = sphereInversionGenerationSlots(
  SPHERE_INVERSION_MAX_DEPTH,
);

/** What the arm's std140 block costs at `n` generators and `s` seed members:
 * the table plus the generation colours, one vec4 (16 B) each. */
export function sphereInversionGlslBlockBytes(n: number, s: number): number {
  return (
    (sphereInversionTableEntries(n, s) + SPHERE_INVERSION_GLSL_COLOR_SLOTS) * 16
  );
}

/** The largest generator count whose block still fits
 * {@link SPHERE_INVERSION_GLSL_BLOCK_BYTES} at `s` seed members — the
 * arithmetic the caps above are chosen against, kept executable so raising
 * one is a measurement rather than a re-derivation. */
export function sphereInversionGlslGeneratorCeiling(s: number): number {
  let n = 0;
  while (
    sphereInversionGlslBlockBytes(n + 1, s) <= SPHERE_INVERSION_GLSL_BLOCK_BYTES
  ) {
    n++;
  }
  return n;
}

/** Which of the fragment arm's limits a construction's shape exceeds. A
 * UNION rather than a boolean so the caller that must WORD the refusal
 * switches exhaustively: a cap added here without a sentence beside it fails
 * to compile rather than shipping a wrong reason. */
export type SphereInversionFragmentArmLimit =
  "dimension" | "generators" | "seedMembers";

/**
 * WHY the 3D fragment arm cannot carry these tables, or null when it can —
 * the ONE capacity answer the Surface gate, main.ts's routing and the
 * material's own guard share. `"dimension"` is 4D, which has no fragment arm
 * at all; the other two are the std140 block's caps.
 */
export function sphereInversionFragmentArmLimit(
  tables: Pick<SphereInversionTables, "dim" | "generatorCount" | "seedCount">,
): SphereInversionFragmentArmLimit | null {
  if (tables.dim !== 3) return "dimension";
  if (tables.generatorCount > SPHERE_INVERSION_GLSL_MAX_GENERATORS) {
    return "generators";
  }
  if (tables.seedCount > SPHERE_INVERSION_GLSL_MAX_SEED_MEMBERS) {
    return "seedMembers";
  }
  return null;
}

/** {@link sphereInversionFragmentArmLimit} as the guard's boolean. */
export function sphereInversionFitsFragmentArm(
  tables: Pick<SphereInversionTables, "dim" | "generatorCount" | "seedCount">,
): boolean {
  return sphereInversionFragmentArmLimit(tables) === null;
}

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
  const entries = sphereInversionTableEntries(n, s);
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
 *
 * `signed` adds the INTERIOR HALF for the optical transport's
 * sphere-inversion backend: an `SiResult.clear` member carrying a member's
 * transported clearance (−1 for a non-member, so it is also the membership
 * bit) — {@link sphereInversionSignedF32}'s arithmetic. Nothing else moves:
 * `d` keeps its unsigned meaning, so the primary march and hit-info read the
 * same value, and absent/false emits the shipped body byte for byte.
 *
 * `recordFold` (requires `signed`) makes the fold RECORD its word — the
 * generator each inversion went through — in the module-scope private
 * `siFoldGen`, which the exact Möbius normal reads back innermost first
 * (`sphereInversionFoldedNormal`'s reflections). One store per inversion;
 * absent/false emits the body byte for byte.
 *
 * `shape` sizes the per-evaluation PRIVATE arrays (the fold's radii and
 * word, the cover's generator distances) and the fold loop's structural
 * bound to ONE construction's generator count and depth instead of the
 * registry maxima ({@link SPHERE_INVERSION_GPU_MAX_GENERATORS},
 * `SPHERE_INVERSION_MAX_DEPTH`): 3 + 3 + 6 words for a depth-3 six-generator
 * arrangement where the maxima declare 32 + 32 + 120 (+32 recorded). No
 * index can reach past the smaller bound — the fold spends at most `depth`
 * inversions and the cover indexes generators below `n` — so the arithmetic
 * is unchanged; only where the arrays live moves (the "glass latency"
 * record in `docs/sphere-inversion-family.md`). The kernel it is emitted
 * into must be run only against that construction's table: the host builds
 * one per session, whose construction is frozen. Absent emits the body byte
 * for byte.
 *
 * `workgroupTable` reads the table from a workgroup-memory copy instead of
 * the storage binding. The estimator's table loads are dependent, and a
 * glass trace's tail runs a few dozen lanes that cannot hide a cache
 * round trip, so the copy's lower latency is what it buys. The same values,
 * so the arithmetic is unchanged. Absent emits the body byte for byte.
 */
/** One construction's generator count and fold depth, for
 * {@link sphereInversionWgslSource}'s `shape`. */
export interface SphereInversionWgslShape {
  generators: number;
  depth: number;
}

export function sphereInversionWgslSource(
  dim: 3 | 4,
  signed = false,
  recordFold = false,
  shape?: SphereInversionWgslShape,
  /** The construction's table in WORKGROUP memory: `vec4s` entries, copied
   * by each entry's `siLoadTable(li)` prologue with `stride` = the
   * workgroup size, and every accessor reads the copy. Every entry of the
   * module must call the prologue first, in uniform control flow. */
  workgroupTable?: { vec4s: number; stride: number },
): string {
  if (recordFold && !signed)
    throw new Error("sphereInversionWgslSource: recordFold requires signed");
  if (
    shape &&
    !(
      Number.isInteger(shape.generators) &&
      shape.generators >= 1 &&
      shape.generators <= SPHERE_INVERSION_GPU_MAX_GENERATORS &&
      Number.isInteger(shape.depth) &&
      shape.depth >= 0 &&
      shape.depth <= SPHERE_INVERSION_MAX_DEPTH
    )
  )
    throw new RangeError("sphereInversionWgslSource: shape out of range");
  const V = dim === 3 ? "vec3f" : "vec4f";
  const T = workgroupTable ? "siTableWg" : "siTable";
  const center = dim === 3 ? `${T}[i].xyz` : `${T}[2u * i]`;
  const radius = dim === 3 ? `${T}[i].w` : `${T}[2u * i + 1u].x`;
  // A zero-length WGSL array is invalid; a depth-0 fold never stores.
  const MAXD = shape ? Math.max(1, shape.depth) : SPHERE_INVERSION_MAX_DEPTH;
  const MAXG = shape ? shape.generators : SPHERE_INVERSION_GPU_MAX_GENERATORS;
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
  ring: f32,${
    signed
      ? `
  // The SIGNED field's interior half: the transported clearance of a
  // member, or -1 for a non-member (a pole, an exhausted fold, or a folded
  // point outside the seed) — so it doubles as the membership bit.
  clear: f32,`
      : ""
  }
}

${
  workgroupTable
    ? `var<workgroup> siTableWg: array<vec4f, ${workgroupTable.vec4s}>;

// Every entry's first statement, in uniform control flow: the workgroup
// copies the construction's table once, then reads it from there.
fn siLoadTable(li: u32) {
  for (var e = li; e < ${workgroupTable.vec4s}u; e += ${workgroupTable.stride}u) {
    siTableWg[e] = siTable[e];
  }
  workgroupBarrier();
}

`
    : ""
}fn siCenter(i: u32) -> ${V} {
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

${
  recordFold
    ? `// The last siEstimate's fold word: the generator inversion i went through.
var<private> siFoldGen: array<u32, ${MAXD}>;

`
    : ""
}// sphere-inversion-de${dim === 4 ? "-4d" : ""}.ts's evaluate${dim} in f32, cutoff ignored.
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
    foldR2[k] = r2;${recordFold ? "\n    siFoldGen[k] = u32(found);" : ""}
    ring = min(ring, foldR[k] / rf);
    if (k == 0u) {
      first = found;
    }
    k++;
    parent = found;
  }
  var res = SiResult(0.0, x, k, status, parent, first, -1, -1, ring${signed ? ", -1.0" : ""});
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
  }${
    signed
      ? `
  // THE INTERIOR HALF (sphere-inversion-de${dim === 4 ? "-4d" : ""}.ts's sphereInversionSignedDistance${dim === 4 ? "4" : ""}):
  // at DOMAIN a non-positive best IS membership, and -best the exact folded
  // clearance of the seed intersection; the full-ball law is the empty-ball
  // law, so the same transport carries it out, then the same absolute f32
  // slack comes off the MAGNITUDE (sphereInversionSignedF32's doc).
  if (status == ${SPHERE_INVERSION_FOLD_DOMAIN}u && best <= 0.0) {
    var c = -best;
    for (var i = k; i > 0u; i--) {
      c = inversionDistanceLowerBound(foldR[i - 1u], foldR2[i - 1u], c);
    }
    res.clear = max(0.0, c - slack);
  }`
      : ""
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
}${
    recordFold
      ? `

// THE EXACT MÖBIUS NORMAL (sphere-inversion.ts's sphereInversionFoldedNormal
// in f32): the binding member's outward gradient in folded coordinates —
// the member the cover scan's winning term binds on, table order and strict
// improvement as on the CPU — reflected back through the recorded fold,
// innermost first. Unnormalized; zero where no gradient exists (a pole or an
// exhausted fold, a zero-length offset), and the caller falls back.
fn siExactNormal(q: ${V}) -> ${V} {
  let res = siEstimate(q);
  if (res.status != ${SPHERE_INVERSION_FOLD_DOMAIN}u) {
    return ${V}(0.0);
  }
  let n = params.siCounts.x;
  let s = params.siCounts.y;
  let x = res.x;
  var g = ${V}(0.0);
  if (res.termGap >= 0) {
    // A depth-2 gap ball: +(|x - c| - r).
    g = x - siCenter(n + s + u32(res.termJ) * params.siCounts.w + s + u32(res.termGap));
  } else {
    // An intersection: its seed members first, then (the folded seed) the
    // generator exteriors or (a one-step copy) B_j and its gap complements.
    let base = select(n, n + s + u32(res.termJ) * params.siCounts.w, res.termJ >= 0);
    var bestV = -3.0e38;
    for (var i = 0u; i < s; i++) {
      let e = base + i;
      let v = siMember(x, e);
      if (v > bestV) {
        bestV = v;
        g = select(x - siCenter(e), siCenter(e) - x, siRadius(e) < 0.0);
      }
    }
    if (res.termJ < 0) {
      for (var i = 0u; i < n; i++) {
        let v = siRadius(i) - length(x - siCenter(i));
        if (v > bestV) {
          bestV = v;
          g = siCenter(i) - x;
        }
      }
    } else {
      let j = u32(res.termJ);
      let vj = length(x - siCenter(j)) - siRadius(j);
      if (vj > bestV) {
        bestV = vj;
        g = x - siCenter(j);
      }
      for (var i = 0u; i + 1u < n; i++) {
        let e = base + s + i;
        let v = siRadius(e) - length(x - siCenter(e));
        if (v > bestV) {
          bestV = v;
          g = siCenter(e) - x;
        }
      }
    }
  }
  let gl = length(g);
  if (!(gl > 0.0)) {
    return ${V}(0.0);
  }
  g = g / gl;
  // Each inversion's Jacobian is a positive scale times the reflection
  // along the ray from its centre, and symmetric: reflect, then walk the
  // point back out along the same inversion.
  var y = x;
  for (var i = res.k; i > 0u; i--) {
    let gen = siFoldGen[i - 1u];
    let c = siCenter(gen);
    let v = y - c;
    let u2 = dot(v, v);
    if (!(u2 > 0.0)) {
      return ${V}(0.0);
    }
    g = g - (2.0 * dot(g, v) / u2) * v;
    let rg = siRadius(gen);
    y = c + (rg * rg / u2) * v;
  }
  return g;
}`
      : ""
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

/** The last {@link sphereInversionF32} evaluation's fold record and folded
 * decision value — the module-scratch idiom `sphere-inversion-de.ts` uses
 * for its own fold (`foldStatus`/`foldK`), so the signed twin reads the SAME
 * evaluation instead of restating it. `best` is NaN at a pole. */
const f32Last: {
  status: SphereInversionFoldStatus;
  k: number;
  foldR: number[];
  foldR2: number[];
  best: number;
} = {
  status: SPHERE_INVERSION_FOLD_DOMAIN,
  k: 0,
  foldR: [],
  foldR2: [],
  best: NaN,
};

/** `inversionDistanceLowerBound` in f32, innermost first — the WGSL body's
 * transport loop, margin included. */
function transportF32(
  foldR: readonly number[],
  foldR2: readonly number[],
  k: number,
  d: number,
): number {
  const margin = f(1 + 2 ** -20);
  let v = d;
  for (let i = k; i > 0; i--) {
    const qr = foldR[i - 1];
    v =
      qr <= 0 || v <= 0
        ? 0
        : f(f(qr * v) / f(f(f(foldR2[i - 1] / qr) + v) * margin));
  }
  return v;
}

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
  f32Last.status = status;
  f32Last.k = k;
  f32Last.foldR = foldR;
  f32Last.foldR2 = foldR2;
  f32Last.best = NaN;
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
  f32Last.best = best;
  let v = best;
  if (best > 0) {
    v = Math.max(0, f(transportF32(foldR, foldR2, k, best) - slack));
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

/** The signed twin's record: the field value the optical transport marches
 * and the membership bit its crossing gate asks. */
export interface SphereInversionSignedF32Result {
  /** `sphereInversionSignedDistance`'s value in f32: the unsigned `d`
   * outside, `−clear` for a member, the untransported folded value at a
   * (by-construction unreachable) negative non-DOMAIN status. */
  field: number;
  /** Membership: DOMAIN and a non-positive folded decision value — exactly
   * `sphereInversionContains`, read off the same evaluation. */
  member: boolean;
  /** The member's transported clearance after the slack, −1 otherwise (the
   * kernel's `SiResult.clear`). */
  clear: number;
}

/**
 * The SIGNED field in f32 — the `signed` WGSL body's interior half re-executed
 * over the same packed table, the twin the kernel is pinned against. It is
 * {@link sphereInversionF32}'s evaluation plus one transport of the folded
 * clearance; the f64 authority is `sphereInversionSignedDistance` /
 * `sphereInversionSignedDistance4`.
 *
 * THE f32 ARGUMENT FOR THE INTERIOR HALF, written out rather than inherited.
 *
 * WHICH DENOMINATOR. The worry the interior half raises is the Möbius ball
 * factor `R²/(|c|² − r²)`, which cancels catastrophically where a ball nearly
 * swallows the inversion centre. That form is NOT what either half emits. The
 * transport is `inversionDistanceLowerBound`'s distance form,
 * `qr·v / ((R²/qr + v)·(1 + 2^-20))`, whose one division is by a SUM of two
 * positives — no subtraction, so no cancellation at any ratio of `v` to
 * `R²/qr`, including a clearance ball that swallows the centre (`v >= R²/qr`),
 * where the image is a ball's complement and the distance form is still the
 * nearest boundary along the centre line. The only small quantity it divides
 * by is `qr` itself, inside `R²/qr`, and THAT IS GUARDED: the fold refuses to
 * invert once `qr² <= 2^-40·R²` (the POLE floor,
 * {@link SPHERE_INVERSION_GPU_POLE_FLOOR}), so `R²/qr < 2^20·R` is finite and
 * a pole never reaches the transport — the interior half inherits that guard
 * rather than adding a second one, and at a pole the record is a non-member
 * (`clear` −1) with `field` 0, the family's defined outcome.
 *
 * WHY THE SAME SLACK SUFFICES. Per step, the transport's own rounding (three
 * multiplications/divisions and one positive sum, ≲ 4 ulp = 2^-22 relative)
 * sits under its `1 + 2^-20` margin, so each step is one-sided given exact
 * inputs, in both halves. The inputs are not exact: the folded point carries
 * the fold's absolute rounding, magnified by each inversion exactly as the
 * transport later demagnifies it, so the folded decision value's error comes
 * back to world space at its own step's scale, unamplified — the argument that
 * made the exterior's world-space excess FLAT IN DEPTH (measured at most
 * 3.3e-7). Nothing in it reads the sign of the folded value, so the interior
 * magnitude carries the same world-space excess and the same absolute
 * {@link SPHERE_INVERSION_GPU_SLACK} comes off it. Never a relative factor.
 *
 * THE DISCLOSED THRESHOLD. A member whose transported clearance is at most the
 * slack (1e-6 world units) reads `field` 0 — inside the transport's crossing
 * band, never on the wrong side of it — and so does the exterior's slack-
 * zeroed rim. The band is the only place f32 and f64 may disagree about the
 * SIGN of membership, and the crossing gate asks the membership bit, not the
 * sign of a value in that band. The acceptance floor the packers already clamp
 * to the slack makes this the same 1e-6 world-space zoom floor the opaque
 * family has.
 */
export function sphereInversionSignedF32(
  gpu: SphereInversionGpuTables,
  query: readonly number[],
): SphereInversionSignedF32Result {
  const res = sphereInversionF32(gpu, query);
  const { status, k, foldR, foldR2, best } = f32Last;
  if (status === SPHERE_INVERSION_FOLD_DOMAIN && best <= 0) {
    const clear = Math.max(
      0,
      f(transportF32(foldR, foldR2, k, -best) - f(SPHERE_INVERSION_GPU_SLACK)),
    );
    return { field: clear === 0 ? 0 : -clear, member: true, clear };
  }
  return { field: res.d, member: false, clear: -1 };
}
