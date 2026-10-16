/**
 * THE GENERAL CURVED SOLID'S KERNEL HALF: `condensation-solid.ts` and
 * `condensation-solid-4d.ts`'s word-tree field in WGSL, for the closed-solid
 * transport backend (`surface-de-gpu.ts`'s `opticsBackend: "closedSolid"`
 * with its `condensationSolid` option).
 *
 * WHAT CHANGES, AND WHAT DOES NOT. The closed-solid query, its anchored
 * suppression, crossing band, medium cross-check, normal taps and straight
 * shadow march are written once above `transportSolidField(p)`. Emitter-only
 * C0 reads that field as the root term. This module supplies the same
 * function over the depth band's word tree and changes nothing above it.
 * The emitter terms are the kernel's own `condensationShapeSdf` over the
 * emitters the maps binding already carries (after the recursive maps), so
 * the SHAPES are the primary march's, byte for byte.
 *
 * THE WIRE IS BAKED, NOT PACKED. The search needs every (base map, sector)
 * edge's composed inverse and its smallest singular value, the invariant
 * ball, and two ratios. They are session constants, so they bake into the
 * source as literals (the emitter shapes' and the tiling clip's
 * create-time-geometry precedent) and the frozen params wire moves by no
 * byte. The edges are a `switch` rather than a module-scope array: a
 * dynamically indexed constant array is copied into every invocation's
 * private memory, and a switch costs one branch. The depth band itself stays
 * the params' live `condDepthMin`/`condDepthMax`, the words the root term
 * already reads.
 *
 * THE SEARCH is the CPU's pre-order walk as an explicit stack (WGSL has no
 * recursion), visiting children in edge order, so the running minimum
 * evolves as the oracle's does and the prune fires on the same subtrees up
 * to rounding. Stack depth is `CONDENSATION_SOLID_MAX_DEPTH + 1`.
 *
 * THE F32 ARGUMENT (owed by the epic, stated here):
 *
 * - RELATIVE rounding in a term (the child chain's ~4 ulps per level, the
 *   shape SDF, the scale product) is at most ~1e-6 of the term, far inside
 *   the 0.9 `SHAPE_MARCH_SAFETY` factor every term already carries. So the
 *   exterior value stays a lower bound and the interior magnitude stays
 *   below the clearance, in f32, with the margin the root term has always
 *   relied on.
 * - ABSOLUTE rounding near the boundary is ~1e-7 of the ball radius, below
 *   the transport's crossing band (`DIELECTRIC_CROSSING_EPS_REL`), which is
 *   where a sign flip is allowed to land anyway. The bench's field probes
 *   gate membership outside that band.
 * - THE BALL PAD. The prune reads `δ = |child − c| − R` off an f32 child.
 *   The kernel's radius is padded by {@link CONDENSATION_SOLID_GPU_BALL_PAD}
 *   (relative), which dwarfs the child's rounding at depth 6, so a child
 *   the kernel reads as outside the padded ball is outside the true one by
 *   at least the kernel's `δ`. A larger ball is still invariant
 *   (`|f(c) − c| + σ_max·R' <= R'` holds for every `R' >= R`), so the
 *   certificate `s·δ` the prune rests on stays sound.
 * - THE PRUNE SLACK. The f64 slack (1e-12) is below f32 epsilon, so the
 *   kernel skips a subtree only when its bound clears the running minimum by
 *   {@link CONDENSATION_SOLID_GPU_PRUNE_SLACK}. Slack only prunes less. A
 *   pruned subtree's certified distance exceeds the running minimum, so
 *   pruning never makes the field larger than a true distance.
 *
 * So the kernel field agrees with the f64 oracle to f32 rounding of the
 * same terms, and the bench's agreement legs gate it there.
 */
import {
  CONDENSATION_SOLID_MAX_DEPTH,
  type CondensationSolid3,
} from "./condensation-solid";
import {
  condensationSolid3OfCanonical4,
  type CondensationSolid4,
} from "./condensation-solid-4d";
import { SHAPE_MARCH_SAFETY } from "./shapes";

/** Relative pad on the kernel's invariant radius (module doc's f32
 * argument): ~1e2 above the depth-6 child chain's rounding. */
export const CONDENSATION_SOLID_GPU_BALL_PAD = 1e-4;

/** The kernel's prune slack (module doc's f32 argument). */
export const CONDENSATION_SOLID_GPU_PRUNE_SLACK = 1e-5;

/** The most (base map, sector) edges a kernel bakes. The `switch` is one
 * case per edge, and the admitted subjects (a handful of maps, a small
 * kaleidoscope) sit far below it. The routing refuses past it. */
export const CONDENSATION_SOLID_GPU_MAX_EDGES = 64;

/** The kernel option: the solid's session constants, per dimension. */
export interface CondensationSolidWire {
  dim: 3 | 4;
  /** Row-major inverse (9 or 16 entries), inverse translation, and the
   * forward map's smallest singular value, per edge in the oracle's order. */
  edges: { invM: number[]; invT: number[]; sigmaMin: number }[];
  center: number[];
  radius: number;
  mapRatio: number;
  emitterRatio: number;
  /** The canonical-pose fast body's TRUE 3D quantities — the projected
   * restriction's own invariant ball and prune ratios
   * (`condensation-solid-4d.ts`'s `condensationSolid3OfCanonical4`), and
   * the per-edge projected forward σ_min the fast cases bake. The 4D
   * wire's own ratios are strictly weaker (a w scale below the xyz sigma
   * range lowers them, pruning less and never more — measured: the
   * starters' emitterRatio is 0.56 against the restriction's 1.0, which
   * ate the fast body's whole win), so the fast body bakes these instead.
   * Null when the composition is not w-untouched — no canonical pose
   * exists to restrict to, and the fast body never emits. */
  canonical3?: {
    sigmas: number[];
    center: [number, number, number];
    radius: number;
    mapRatio: number;
    emitterRatio: number;
  } | null;
}

/** The kernel wire for a built solid (either dimension). */
export function condensationSolidWire(
  solid: CondensationSolid3 | CondensationSolid4,
): CondensationSolidWire {
  const dim = solid.center.length === 4 ? 4 : 3;
  const restricted =
    dim === 4
      ? condensationSolid3OfCanonical4(solid as CondensationSolid4)
      : null;
  return {
    dim,
    edges: solid.maps.map((m) => ({
      invM: [...m.invM],
      invT: [...m.invT],
      sigmaMin: m.sigmaMin,
    })),
    center: [...solid.center],
    radius: solid.radius,
    mapRatio: solid.mapRatio,
    emitterRatio: solid.emitterRatio,
    canonical3: restricted
      ? {
          sigmas: restricted.maps.map((m) => m.sigmaMin),
          center: [...restricted.center] as [number, number, number],
          radius: restricted.radius,
          mapRatio: restricted.mapRatio,
          emitterRatio: restricted.emitterRatio,
        }
      : null,
  };
}

function lit(x: number): string {
  if (!Number.isFinite(x)) {
    throw new Error(`condensation-solid-gpu: non-finite baked constant (${x})`);
  }
  const s = String(Math.fround(x));
  return /[.e]/.test(s) ? s : `${s}.0`;
}

/** Throws on a wire the kernel cannot carry. */
export function validateCondensationSolidWire(
  wire: CondensationSolidWire,
): void {
  const n = wire.dim;
  if (wire.edges.length === 0) {
    throw new RangeError(
      "condensation-solid-gpu: the solid needs at least one map edge (emitter-only C0 is the root field's)",
    );
  }
  if (wire.edges.length > CONDENSATION_SOLID_GPU_MAX_EDGES) {
    throw new RangeError(
      `condensation-solid-gpu: ${wire.edges.length} edges exceed the ${CONDENSATION_SOLID_GPU_MAX_EDGES}-edge kernel ceiling`,
    );
  }
  for (const e of wire.edges) {
    if (e.invM.length !== n * n || e.invT.length !== n) {
      throw new RangeError("condensation-solid-gpu: edge shape mismatch");
    }
  }
  if (wire.center.length !== n) {
    throw new RangeError("condensation-solid-gpu: ball centre shape mismatch");
  }
  if (!(wire.radius > 0)) {
    throw new RangeError("condensation-solid-gpu: non-positive ball radius");
  }
}

/**
 * The WGSL: `csChild` (the baked edges), `transportSolidField` (the search)
 * and `transportSolidContains` (the field's sign, exact on the CPU). The
 * 3D body reads the query point directly, as the root field does; the 4D
 * body lifts it through the live rotor/slice first, as the 4D root field
 * does, and scores each node with the transport's penalty term.
 *
 * THE CANONICAL-POSE FAST BODY (`canonicalFast`, 4D only): beside the
 * general search the 4D emission also emits the 3D restriction's search —
 * vec3 stack, the edges' 3x3 blocks, an emitter term without the w row or
 * the `|local w|` penalty — and `transportSolidField` dispatches to it
 * when `shade.transport.z` says the LIVE pose is canonical
 * (`condensationSolidPoseAdmission4`'s answer, packed per pass). There the
 * 4D field IS the 3D field of the restriction (pinned in
 * `condensation-solid-4d.test.ts`), so the fast body renders the same
 * solid at the 3D search's cost — measured 1.68x of the 3D session's
 * transport, ~90% of the whole 4D glass session. The fast body reads the
 * 4D wire's own ball radius, sigma and ratios, every one of which is
 * weaker than its 3D twin (a smaller sigma and the full 4D ball prune
 * less, never more), so its prune stays a certified lower bound; its
 * values differ from the general body's by at most the pose admission's
 * own `W_COUPLE_EPS` dust. Absent, the source is byte-identical.
 */
export interface CondensationSolidWgslOptions {
  /** 4D only: emit the canonical-pose fast body beside the general
   * search. Absent/false is byte-identical. */
  canonicalFast?: boolean;
}

export function condensationSolidWgslSource(
  wire: CondensationSolidWire,
  opts: CondensationSolidWgslOptions = {},
): string {
  validateCondensationSolidWire(wire);
  const four = wire.dim === 4;
  const canonicalFast = four && opts.canonicalFast === true;
  if (canonicalFast && !wire.canonical3) {
    throw new Error(
      "condensation-solid-gpu: canonicalFast needs the wire's projected 3D restriction (canonical3) — the composition is not w-untouched",
    );
  }
  const vec = four ? "vec4f" : "vec3f";
  const comps = four ? ["x", "y", "z", "w"] : ["x", "y", "z"];
  const n = comps.length;
  const edgeCases = (
    child: string,
    vecName: string,
    dims: number,
    sigmaOf: (i: number) => number,
  ): string =>
    wire.edges
      .map((e, i) => {
        const comps2 = ["x", "y", "z", "w"].slice(0, dims);
        const rows = comps2.map((_, r) => {
          const terms = comps2.map(
            (c, k) => `${lit(e.invM[r * n + k])} * q.${c}`,
          );
          return `${terms.join(" + ")} + ${lit(e.invT[r])}`;
        });
        return `    case ${i}u: {
      return ${child}(${vecName}(
        ${rows.join(",\n        ")},
      ), ${lit(sigmaOf(i))});
    }`;
      })
      .join("\n");
  const depthCap = CONDENSATION_SOLID_MAX_DEPTH + 1;
  const center = `${vec}(${wire.center.map(lit).join(", ")})`;
  const radius = lit(wire.radius * (1 + CONDENSATION_SOLID_GPU_BALL_PAD));
  const term = four
    ? `fn csTerm(q: vec4f) -> f32 {
  // The transport's 4D penalty term (condensation-de.ts's
  // condensationSignedDistance4), the root field's own loop.
  var best = 1e30;
  for (var e = 0u; e < params.condEmitterCount; e++) {
    let m = maps[params.mapCount + e];
    let local = mapApply4(m, q);
    let sd = condensationShapeSdf(u32(m.p0.z), local.xyz);
    let d = m.p0.x * sd + abs(local.w);
    if (d < best) {
      best = d;
    }
  }
  return best;
}`
    : `fn csTerm(q: vec3f) -> f32 {
  return condensationDistance(q).distance;
}`;
  /** One search body: the struct, the baked edge switch and the
   * branch-and-bounded walk. `suffix` names every identifier; `mid`
   * (the term definition) lands between the child fn and the field fn,
   * which WGSL's declaration-before-use order needs. The default call
   * reproduces the shipped text byte for byte. */
  const searchBody = (cfg: {
    suffix: string;
    vec: string;
    dims: number;
    term: string;
    center: string;
    root: string;
    sigmaOf: (i: number) => number;
    radius: string;
    mapRatio: number;
    emitterRatio: number;
    mid?: string;
    gate?: string;
  }): string => {
    const bodyCases = edgeCases(
      `CsChild${cfg.suffix}`,
      cfg.vec,
      cfg.dims,
      cfg.sigmaOf,
    );
    return `struct CsChild${cfg.suffix} {
  q: ${cfg.vec},
  sigma: f32,
}

fn csChild${cfg.suffix}(e: u32, q: ${cfg.vec}) -> CsChild${cfg.suffix} {
  switch e {
${bodyCases}
    default: {
      return CsChild${cfg.suffix}(${cfg.vec}(0.0), 0.0);
    }
  }
}
${cfg.mid ?? ""}
fn transportSolidField${cfg.suffix}(p: vec3f) -> f32 {
${cfg.gate ?? ""}  let root = ${cfg.root};
  let minDepth = params.condDepthMin;
  let maxDepth = min(params.condDepthMax, ${CONDENSATION_SOLID_MAX_DEPTH}u);
  var best = 1e30;
  if (minDepth == 0u) {
    best = ${lit(SHAPE_MARCH_SAFETY)} * ${cfg.term}(root);
  }
  var stackQ: array<${cfg.vec}, ${depthCap}>;
  var stackS: array<f32, ${depthCap}>;
  var stackE: array<u32, ${depthCap}>;
  stackQ[0] = root;
  stackS[0] = 1.0;
  stackE[0] = 0u;
  var top = 0u;
  loop {
    if (top >= maxDepth || stackE[top] >= ${wire.edges.length}u) {
      if (top == 0u) {
        break;
      }
      top -= 1u;
      continue;
    }
    let e = stackE[top];
    stackE[top] = e + 1u;
    let child = csChild${cfg.suffix}(e, stackQ[top]);
    let cs = stackS[top] * child.sigma;
    let delta = length(child.q - ${cfg.center}) - ${cfg.radius};
    if (delta > 0.0) {
      let below = f32(maxDepth - (top + 1u));
      let bound = ${lit(SHAPE_MARCH_SAFETY)} * cs * delta * pow(${lit(cfg.mapRatio)}, below) * ${lit(cfg.emitterRatio)};
      if (bound * ${lit(1 - CONDENSATION_SOLID_GPU_PRUNE_SLACK)} >= best) {
        continue;
      }
    }
    top += 1u;
    stackQ[top] = child.q;
    stackS[top] = cs;
    stackE[top] = 0u;
    if (top >= minDepth) {
      let t = cs * ${lit(SHAPE_MARCH_SAFETY)} * ${cfg.term}(child.q);
      if (t < best) {
        best = t;
      }
    }
  }
  return best;
}`;
  };
  const fastGate = `  if (shade.transport.z != 0.0) {
    return transportSolidFieldFast(p);
  }
`;
  const general = searchBody({
    suffix: "",
    vec,
    dims: n,
    term: "csTerm",
    center,
    root: four ? "rotorInvApply4(vec4f(p, params.w0))" : "p",
    sigmaOf: (i) => wire.edges[i].sigmaMin,
    radius,
    mapRatio: wire.mapRatio,
    emitterRatio: wire.emitterRatio,
    mid: `\n${term}\n`,
    gate: four && opts.canonicalFast ? fastGate : "",
  });
  let fast = "";
  if (canonicalFast && wire.canonical3) {
    const c3 = wire.canonical3;
    fast = `fn csTermFast(q: vec3f) -> f32 {
  // The canonical pose's emitter term: the penalty's |local w| vanishes on
  // the slice (the pose admission's own check), so the term is the
  // emitter scale over the shape SDF of the 3x3-restricted local point.
  var best = 1e30;
  for (var e = 0u; e < params.condEmitterCount; e++) {
    let m = maps[params.mapCount + e];
    let local = vec3f(dot(m.r0.xyz, q), dot(m.r1.xyz, q), dot(m.r2.xyz, q)) +
      m.t.xyz;
    let sd = condensationShapeSdf(u32(m.p0.z), local);
    let d = m.p0.x * sd;
    if (d < best) {
      best = d;
    }
  }
  return best;
}

${searchBody({
  suffix: "Fast",
  vec: "vec3f",
  dims: 3,
  term: "csTermFast",
  center: `vec3f(${c3.center.map(lit).join(", ")})`,
  root: "rotorInvApply4(vec4f(p, params.w0)).xyz",
  sigmaOf: (i) => c3.sigmas[i],
  radius: lit(c3.radius * (1 + CONDENSATION_SOLID_GPU_BALL_PAD)),
  mapRatio: c3.mapRatio,
  emitterRatio: c3.emitterRatio,
})}`;
  }
  return `// The general curved solid (condensation-solid${four ? "-4d" : ""}.ts): the
// closed-solid field over the depth band's word tree, branch-and-bounded
// against the invariant ball (condensation-solid-gpu.ts's module doc).
${fast}${general}

// Membership is the field's sign, EXACT on the CPU (every admitted shape
// SDF's sign is exact under the union fold).
fn transportSolidContains(p: vec3f) -> bool {
  return transportSolidField(p) <= 0.0;
}`;
}
