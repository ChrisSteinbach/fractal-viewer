/**
 * The GLASS SOLID's COMPOSITE on the GPU: `finite-solid-composite.ts`'s
 * opaque attractor term spliced into the finite general cores
 * (`core: "finite"` / `"finite4"` with `finiteSolid.composite`), beside the
 * glass-only word-tree walk (`FiniteSolidGeneralWire.glassOnly`).
 *
 * THE OPAQUE TERM IS A WRAPPER, never an edit of the descent: the kernel
 * carries the SHIPPED affine / affine4 refined ladder (`core: "affine"` /
 * `"affine4"`'s `surfaceDE` and `surfaceDEHitInfo`, the estimators
 * `estimateDistanceRefined` / `estimateDistance4Refined` pin) and calls it
 * once per surviving opaque branch, `σ_min(M_a) · DE(M_a⁻¹ q, cutoff/σ)`,
 * nearest certified ball first, pruned when the ball bound cannot beat the
 * running minimum — the oracle's `finiteSolidOpaqueDistance` term for term.
 *
 * THE DESCENT TEXT IS EXTRACTED, NOT RESTATED: the caller generates the
 * plain affine / affine4 shade kernel (`slabExt: false` in 4D — the finite
 * cores take no slab) and hands its text here; this module lifts out the
 * transitive closure of declarations `surfaceDE` (and, in shade mode,
 * `surfaceDEHitInfo`) reference, renames every one onto a `finOp_` prefix,
 * and renames its three foreign references:
 *
 * - `params.X` → `params.op_X`: the descent's frozen params block rides the
 *   finite struct as an appended OPAQUE-DESCENT block (the affine struct's
 *   own field list, renamed) at {@link SURFACE_GPU_PARAMS_FINITE_COMPOSITE_OFFSET}
 *   / {@link SURFACE_GPU_PARAMS4_FINITE_COMPOSITE_OFFSET} — past the frozen
 *   ground-plane block, so no older offset moves — and the packer copies
 *   the affine packer's own bytes into it (the finite frozen base keeps
 *   the CONSTRUCTION's ball, which the glass cells need and the
 *   attractor's probe-fit ball does not contain);
 * - `maps[j]` → `FIN_OP_MAPS[j]`: the attractor's maps BAKE into the source
 *   as a const array (the word tree's own discipline — the session freezes
 *   its construction at enter), so the finite cores stay bindingless and
 *   binding 1 stays the chunked transport's work buffer;
 * - in 4D, the descent's view lift `rotorInvApply4(vec4f(p, params.w0))`
 *   becomes the intrinsic argument itself, since the wrapper hands every
 *   branch its already-lifted, already-inverted 4D point.
 *
 * Every shipped kernel is untouched: the composite emits only under its
 * option (the digest pins hold), and the extracted text is the shipped
 * text up to the renames — pinned by this module's tests against the
 * generated affine kernels.
 */

import type { FiniteSolidOpaqueBranch } from "./finite-solid-composite";

/** Where the opaque-descent block starts in the finite params struct: past
 * the frozen ground-plane block (3D 288..335, 4D 576..623), which a
 * plane-less composite pads instead of declaring. */
export const SURFACE_GPU_PARAMS_FINITE_COMPOSITE_OFFSET = 336;
export const SURFACE_GPU_PARAMS4_FINITE_COMPOSITE_OFFSET = 624;
/** The copied block: the affine core's frozen params (3D 0..207, the 4D
 * base plus its tail 0..463). */
export const SURFACE_GPU_FINITE_COMPOSITE_BLOCK_BYTES = 208;
export const SURFACE_GPU_FINITE_COMPOSITE_BLOCK4_BYTES = 464;
/** The composite params buffer sizes. */
export const SURFACE_GPU_PARAMS_FINITE_COMPOSITE_BYTES =
  SURFACE_GPU_PARAMS_FINITE_COMPOSITE_OFFSET +
  SURFACE_GPU_FINITE_COMPOSITE_BLOCK_BYTES;
export const SURFACE_GPU_PARAMS4_FINITE_COMPOSITE_BYTES =
  SURFACE_GPU_PARAMS4_FINITE_COMPOSITE_OFFSET +
  SURFACE_GPU_FINITE_COMPOSITE_BLOCK4_BYTES;

/** The composite's kernel wire: the attractor's estimator maps (the
 * `packSurfaceGpuMaps` / `packSurfaceGpuMaps4` output for the SAME document
 * whose maps the construction bakes) and the opaque branches
 * (`buildFiniteSolidOpaqueContent`'s). */
export interface FiniteSolidCompositeWire {
  maps: Float32Array;
  branches: readonly FiniteSolidOpaqueBranch[];
}

const floatLit = (x: number): string => {
  const s = String(x);
  return /[.e]/.test(s) ? s : `${s}.0`;
};

const vec4Lit = (v: ArrayLike<number>): string =>
  `vec4f(${floatLit(v[0])}, ${floatLit(v[1])}, ${floatLit(v[2])}, ${floatLit(v[3])})`;

/** One top-level WGSL declaration of a generated kernel. */
interface WgslDecl {
  kind: "fn" | "struct" | "const";
  text: string;
}

/** The generated kernel's top-level `fn`/`struct`/`const` declarations by
 * name, each with its full text (brace- or semicolon-terminated, `//`
 * comments skipped while matching). The generator emits every top-level
 * declaration at column 0, which is what this reads. */
export function wgslTopLevelDecls(source: string): Map<string, WgslDecl> {
  const out = new Map<string, WgslDecl>();
  const lineStart = /^(fn|struct|const)\s+([A-Za-z_][A-Za-z0-9_]*)/gm;
  for (const m of source.matchAll(lineStart)) {
    const kind = m[1] as WgslDecl["kind"];
    const start = m.index;
    let depth = 0;
    let seen = false;
    let end = -1;
    for (let j = start; j < source.length; j++) {
      if (source.startsWith("//", j)) {
        const nl = source.indexOf("\n", j);
        if (nl < 0) break;
        j = nl;
        continue;
      }
      const c = source[j];
      if (kind === "const") {
        if (c === "(" || c === "[") depth++;
        else if (c === ")" || c === "]") depth--;
        else if (c === ";" && depth === 0) {
          end = j + 1;
          break;
        }
      } else if (c === "{") {
        depth++;
        seen = true;
      } else if (c === "}") {
        depth--;
        if (seen && depth === 0) {
          end = j + 1;
          break;
        }
      }
    }
    if (end < 0) {
      throw new Error(
        `surface-finite-composite-gpu: unterminated declaration ${m[2]}`,
      );
    }
    out.set(m[2], { kind, text: source.slice(start, end) });
  }
  return out;
}

/** The field lines of a struct declaration (comments and blanks dropped),
 * as `name: type` pairs in declaration order. */
function structFields(text: string): Array<{ name: string; type: string }> {
  const body = text.slice(text.indexOf("{") + 1, text.lastIndexOf("}"));
  const fields: Array<{ name: string; type: string }> = [];
  for (const raw of body.split("\n")) {
    const line = raw.replace(/\/\/.*$/, "").trim();
    if (line.length === 0) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+?),?$/.exec(line);
    if (!m) {
      throw new Error(
        `surface-finite-composite-gpu: unreadable struct field "${line}"`,
      );
    }
    fields.push({ name: m[1], type: m[2] });
  }
  return fields;
}

/** The declarations `roots` reach, transitively, by identifier. */
function closureOf(
  decls: Map<string, WgslDecl>,
  roots: readonly string[],
): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  const queue = [...roots];
  while (queue.length > 0) {
    const name = queue.shift()!;
    if (seen.has(name)) continue;
    const decl = decls.get(name);
    if (!decl) {
      throw new Error(
        `surface-finite-composite-gpu: the affine kernel lost ${name}`,
      );
    }
    seen.add(name);
    order.push(name);
    for (const token of decl.text.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) {
      if (!seen.has(token) && decls.has(token) && token !== "Params") {
        queue.push(token);
      }
    }
  }
  return order;
}

/** Names the composite shares with the finite kernel instead of renaming:
 * the shade entry's hit-info struct is ONE definition per kernel, and the
 * extracted hit-info must return the finite kernel's own type. */
const SHARED_DECLS = new Set(["SurfaceHitInfo"]);

/** The spliced descent: the extracted, renamed declarations and the
 * params-struct fields the opaque-descent block declares. */
export interface FiniteCompositeDescent {
  /** The `op_`-renamed affine params fields, in the affine struct's order
   * (the packer copies that struct's bytes verbatim). */
  structFields: string;
  /** The descent declarations, renamed onto `finOp_`. */
  source: string;
  /** The extracted maps struct's name after renaming and its vec4 count. */
  mapStruct: string;
  mapVec4s: number;
}

/**
 * Extract the affine / affine4 refined descent from `affineKernel` (the
 * plain affine shade kernel's text; `slabExt: false` in 4D) for the
 * composite. `hitInfo` also carries `surfaceDEHitInfo` (shade mode). The
 * result is renamed per the module doc: `finOp_` declarations, `params.op_`
 * fields, `FIN_OP_MAPS` baked maps, and in 4D an intrinsic `vec4f`
 * argument in place of the view lift.
 */
export function finiteCompositeDescentSource(
  dim: 3 | 4,
  affineKernel: string,
  hitInfo: boolean,
): FiniteCompositeDescent {
  const decls = wgslTopLevelDecls(affineKernel);
  const params = decls.get("Params");
  if (!params || params.kind !== "struct") {
    throw new Error("surface-finite-composite-gpu: no Params struct");
  }
  if (dim === 4) {
    // The wrapper lifts and inverts; the descent opens on that 4D point.
    const lifts: Array<[string, string, string, string]> = [
      [
        "surfaceDE",
        "fn surfaceDE(pIn: vec3f, cutoff: f32, li: u32) -> f32 {",
        "fn surfaceDE(qIn: vec4f, cutoff: f32, li: u32) -> f32 {",
        "rotorInvApply4(vec4f(pIn, params.w0))",
      ],
      [
        "surfaceDEHitInfo",
        "fn surfaceDEHitInfo(p: vec3f, li: u32) -> SurfaceHitInfo {",
        "fn surfaceDEHitInfo(qIn: vec4f, li: u32) -> SurfaceHitInfo {",
        "rotorInvApply4(vec4f(p, params.w0))",
      ],
    ];
    for (const [name, sig, sigOut, lift] of lifts) {
      const decl = decls.get(name);
      if (!decl) {
        throw new Error(`surface-finite-composite-gpu: no ${name}`);
      }
      if (
        decl.text.split(sig).length !== 2 ||
        decl.text.split(lift).length !== 2
      ) {
        throw new Error(
          `surface-finite-composite-gpu: the affine4 ${name} lost its view lift`,
        );
      }
      decls.set(name, {
        kind: decl.kind,
        text: decl.text.replace(sig, sigOut).replace(lift, "qIn"),
      });
    }
  }
  const roots = hitInfo ? ["surfaceDE", "surfaceDEHitInfo"] : ["surfaceDE"];
  const names = closureOf(decls, roots).filter((n) => !SHARED_DECLS.has(n));
  const mapStructName = dim === 4 ? "GpuMap4" : "GpuMap";
  const mapDecl = decls.get(mapStructName);
  if (!names.includes(mapStructName) || !mapDecl) {
    throw new Error(
      `surface-finite-composite-gpu: the descent no longer reads ${mapStructName}`,
    );
  }
  const mapFields = structFields(mapDecl.text);
  if (!mapFields.every((f) => f.type === "vec4f")) {
    throw new Error(
      `surface-finite-composite-gpu: ${mapStructName} is no longer all vec4f`,
    );
  }
  const renameDecl = new RegExp(`\\b(${names.join("|")})\\b`, "g");
  const source = names
    .map((n) => decls.get(n)!.text)
    // Emission order: structs first (the generator's own order is
    // dependency-safe; WGSL is order-independent at module scope anyway).
    .join("\n\n")
    .replace(renameDecl, "finOp_$1")
    .replace(/\bparams\.([A-Za-z_][A-Za-z0-9_]*)/g, "params.op_$1")
    .replace(/\bmaps\[/g, "FIN_OP_MAPS[");
  if (/\bmaps\b/.test(source.replace(/\/\/.*$/gm, ""))) {
    throw new Error(
      "surface-finite-composite-gpu: the descent reads maps other than by index",
    );
  }
  const fields = structFields(params.text);
  const structFieldsText = fields
    .map((f) => `\n  op_${f.name}: ${f.type},`)
    .join("");
  return {
    structFields: structFieldsText,
    source,
    mapStruct: `finOp_${mapStructName}`,
    mapVec4s: mapFields.length,
  };
}

/** The composite's struct tail: a pad up to the opaque-descent block when
 * the frozen plane block is not declared, then the block itself. */
export function finiteCompositeStructFields(
  dim: 3 | 4,
  descent: FiniteCompositeDescent,
  planeDeclared: boolean,
): string {
  // Without a floor the finite tail ends at 224 / 480; the plane block's
  // region (and the pad before it) is declared as padding so the
  // opaque-descent block keeps ONE offset per dimension.
  const padVec4s = dim === 4 ? 9 : 7;
  const pad = planeDeclared
    ? ""
    : `
  // ${dim === 4 ? "480..623" : "224..335"}, PAD — the finite pad and the frozen plane block's
  // region, so the opaque-descent block lands at one offset.
  padFinComposite: array<vec4f, ${padVec4s}>,`;
  return `${pad}
  // ${dim === 4 ? SURFACE_GPU_PARAMS4_FINITE_COMPOSITE_OFFSET : SURFACE_GPU_PARAMS_FINITE_COMPOSITE_OFFSET}.., the OPAQUE-DESCENT block (surface-finite-composite-gpu.ts): the
  // affine${dim === 4 ? "4" : ""} core's own frozen params, copied byte for byte from its
  // packer for the attractor the opaque maps render.${descent.structFields}`;
}

/** Validate a composite wire against its construction's map count and
 * media: every branch an opaque map, finite numbers throughout, the maps
 * a whole number of the descent's map structs. */
export function validateFiniteCompositeWire(
  dim: 3 | 4,
  wire: FiniteSolidCompositeWire,
  mapCount: number,
  media: readonly number[],
  mapVec4s: number,
): void {
  const fail = (why: string): never => {
    throw new RangeError(`surface-finite-composite-gpu: ${why}`);
  };
  if (wire.branches.length < 1) fail("a composite needs an opaque branch");
  if (wire.maps.length !== mapCount * mapVec4s * 4) {
    fail(
      `the baked maps carry ${String(wire.maps.length)} floats, not ${String(mapCount)} maps of ${String(mapVec4s)} vec4`,
    );
  }
  if (!wire.maps.every(Number.isFinite)) fail("a baked map is not finite");
  let previous = -1;
  for (const b of wire.branches) {
    if (
      !Number.isInteger(b.index) ||
      b.index <= previous ||
      b.index >= mapCount ||
      media[b.index] !== 0
    ) {
      fail(
        "every branch must name an opaque map, in ascending construction order",
      );
    }
    previous = b.index;
    const numbers = [
      ...b.invM,
      ...b.invT,
      b.sigmaMin,
      ...b.ballCenter,
      b.ballRadius,
    ];
    if (
      b.invM.length !== 16 ||
      b.invT.length !== 4 ||
      b.ballCenter.length !== 4 ||
      !numbers.every(Number.isFinite) ||
      !(b.sigmaMin > 0) ||
      !(b.ballRadius >= 0)
    ) {
      fail("a branch carries a non-finite or degenerate term");
    }
    if (dim === 3 && (b.ballCenter[3] !== 0 || b.invT[3] !== 0)) {
      fail("a 3D branch leaves the w = 0 hyperplane");
    }
  }
}

/**
 * The wrapper: the baked branch table and maps, the masked opaque distance
 * (`finiteSolidOpaqueDistance`) and the public `surfaceDE` (the min of the
 * glass-only display DE and the opaque term). Requires the general display
 * source (glass-only, without its own `surfaceDE`) and the extracted
 * descent in the same kernel.
 */
export function finiteCompositeWrapperSource(
  dim: 3 | 4,
  wire: FiniteSolidCompositeWire,
  descent: FiniteCompositeDescent,
): string {
  const k = wire.branches.length;
  const n = wire.maps.length / (descent.mapVec4s * 4);
  const mapLits: string[] = [];
  for (let m = 0; m < n; m++) {
    const vecs: string[] = [];
    for (let v = 0; v < descent.mapVec4s; v++) {
      const at = (m * descent.mapVec4s + v) * 4;
      vecs.push(`      ${vec4Lit(wire.maps.subarray(at, at + 4))}`);
    }
    mapLits.push(`    ${descent.mapStruct}(\n${vecs.join(",\n")},\n    )`);
  }
  const rows = wire.branches
    .flatMap((b) =>
      [0, 1, 2, 3].map((r) => `    ${vec4Lit(b.invM.slice(r * 4, r * 4 + 4))}`),
    )
    .join(",\n");
  const list = (values: readonly string[]): string =>
    values.map((v) => `    ${v}`).join(",\n");
  const local = dim === 4 ? "local" : "local.xyz";
  return `// The composite's opaque branches (finite-solid-composite.ts's
// buildFiniteSolidOpaqueContent), baked: construction index, row-major
// inverse, smallest singular value and the certified image ball of the
// invariant box. And the attractor's maps, baked for the descent.
const FIN_OP_BRANCHES = ${k}u;
const FIN_OP_INDEX = array<i32, ${k}>(
${list(wire.branches.map((b) => `${b.index}`))}
);
const FIN_OP_IM = array<vec4f, ${4 * k}>(
${rows}
);
const FIN_OP_IT = array<vec4f, ${k}>(
${list(wire.branches.map((b) => vec4Lit(b.invT)))}
);
const FIN_OP_SIGMA = array<f32, ${k}>(
${list(wire.branches.map((b) => floatLit(b.sigmaMin)))}
);
const FIN_OP_BALL = array<vec4f, ${k}>(
${list(wire.branches.map((b) => vec4Lit(b.ballCenter)))}
);
const FIN_OP_BALL_R = array<f32, ${k}>(
${list(wire.branches.map((b) => floatLit(b.ballRadius)))}
);
const FIN_OP_MAPS = array<${descent.mapStruct}, ${n}>(
${mapLits.join(",\n")},
);

struct FinOpaque {
  d: f32,
  // The winning construction index (-1 before any branch) and its row in
  // the branch table.
  branch: i32,
  slot: i32,
}

// The branch's local point M_a⁻¹ q (the 3D maps carry the identity w
// row/column, so a 3D query's w stays 0).
fn finOpLocal(k: u32, q: vec4f) -> vec4f {
  let b = 4u * k;
  return vec4f(
    dot(FIN_OP_IM[b], q),
    dot(FIN_OP_IM[b + 1u], q),
    dot(FIN_OP_IM[b + 2u], q),
    dot(FIN_OP_IM[b + 3u], q),
  ) + FIN_OP_IT[k];
}

// The masked opaque distance at the INTRINSIC point q
// (finiteSolidOpaqueDistance): min over the opaque branches of
// sigma_min(M_a) * DE(M_a⁻¹ q, cutoff / sigma), branches visited nearest
// certified ball first — repeated selection, strict < in table order, is
// the oracle's stable sort with ties to the lower index — and the walk
// stops once no remaining ball can beat the running min, or the running
// min already settles the caller's cutoff.
fn finOpaqueDistance(q: vec4f, cutoff: f32, li: u32) -> FinOpaque {
  var bounds: array<f32, ${k}>;
  for (var k = 0u; k < FIN_OP_BRANCHES; k++) {
    bounds[k] = length(q - FIN_OP_BALL[k]) - FIN_OP_BALL_R[k];
  }
  var out = FinOpaque(1.0e30, -1, -1);
  loop {
    var pick = -1;
    var pickBound = 3.0e38;
    for (var k = 0u; k < FIN_OP_BRANCHES; k++) {
      if (bounds[k] < pickBound) {
        pickBound = bounds[k];
        pick = i32(k);
      }
    }
    if (pick < 0 || pickBound >= out.d) {
      break;
    }
    if (cutoff > 0.0 && out.d < cutoff) {
      break;
    }
    let k = u32(pick);
    bounds[k] = 3.0e38;
    let sigma = FIN_OP_SIGMA[k];
    let inner = select(0.0, cutoff / sigma, cutoff > 0.0);
    let local = finOpLocal(k, q);
    let d = sigma * finOp_surfaceDE(${local}, inner, li);
    if (d < out.d) {
      out.d = d;
      out.branch = FIN_OP_INDEX[k];
      out.slot = pick;
    }
  }
  return out;
}

fn finOpaqueAt(p: vec3f, cutoff: f32, li: u32) -> FinOpaque {
  let qa = finiteLift(p);
  return finOpaqueDistance(vec4f(qa[0], qa[1], qa[2], qa[3]), cutoff, li);
}

// The composite's displayed field: the glass-only cells' certified hybrid
// and the opaque attractor term, each a certified lower bound honouring
// the cutoff contract, so their min is both.
fn surfaceDE(pIn: vec3f, cutoff: f32, li: u32) -> f32 {
  let qa = finiteLift(pIn);
  return min(
    finiteDisplayDE(qa),
    finOpaqueDistance(vec4f(qa[0], qa[1], qa[2], qa[3]), cutoff, li).d,
  );
}
`;
}

/** The composite's shade-mode hit-info (the kernel's `surfaceDEHitInfo`),
 * over the wrapper and the extracted descent's own hit-info. */
export function finiteCompositeHitInfoSource(dim: 3 | 4): string {
  const local = dim === 4 ? "local" : "local.xyz";
  return `// The composite's hit-info: a point inside (or on) a glass leaf is that
// glass branch's (the glass-only owner rule); otherwise the nearer term
// owns it — a glass branch's box by the display argmin, or the opaque
// branch the wrapper's min names, whose own descent supplies the
// trap/rings/sheets and whose slot is the construction index (the depth-0
// map, exactly the ordinary IFS Surface render's first choice).
fn surfaceDEHitInfo(p: vec3f, li: u32) -> SurfaceHitInfo {
  let qa = finiteLift(p);
  let owner = finiteGeneralPointMedium(qa).y;
  if (owner >= 0) {
    var info = SurfaceHitInfo(0, 0.0, 1.0, 1.0, 0.0);
    info.firstChoice = owner;
    return info;
  }
  let q = vec4f(qa[0], qa[1], qa[2], qa[3]);
  let op = finOpaqueDistance(q, 0.0, li);
  if (op.slot < 0 || finiteDisplayDE(qa) < op.d) {
    var info = SurfaceHitInfo(0, 0.0, 1.0, 1.0, 0.0);
    info.firstChoice = finiteDisplayBranch(qa);
    return info;
  }
  let local = finOpLocal(u32(op.slot), q);
  var info = finOp_surfaceDEHitInfo(${local}, li);
  info.firstChoice = op.branch;
  return info;
}`;
}

/** Copy the affine packer's frozen block into a composite params buffer
 * at the dimension's opaque-descent offset. */
export function writeFiniteCompositeBlock(
  dim: 3 | 4,
  target: ArrayBuffer,
  affineParams: ArrayBuffer,
): void {
  const offset =
    dim === 4
      ? SURFACE_GPU_PARAMS4_FINITE_COMPOSITE_OFFSET
      : SURFACE_GPU_PARAMS_FINITE_COMPOSITE_OFFSET;
  const bytes =
    dim === 4
      ? SURFACE_GPU_FINITE_COMPOSITE_BLOCK4_BYTES
      : SURFACE_GPU_FINITE_COMPOSITE_BLOCK_BYTES;
  if (affineParams.byteLength < bytes || target.byteLength < offset + bytes) {
    throw new RangeError(
      "surface-finite-composite-gpu: the composite block does not fit",
    );
  }
  new Uint8Array(target, offset, bytes).set(
    new Uint8Array(affineParams, 0, bytes),
  );
}

/**
 * The composite's transport half: one segment's OPAQUE MARCH — the
 * estimator backend's `transportNextBoundary`, unanchored (an opaque
 * terminal ends its path, so no segment restarts on the opaque surface),
 * over the masked opaque distance: the same step budget, domain exit,
 * crossing epsilon and tetrahedron-tap normal, stepping the full estimate
 * (the fixture's step scale 1). The fixture twin is
 * `transportCompositeOpaqueMarch`. Emitted inside the transport block,
 * whose constants and domain exit it reads.
 */
export function finiteCompositeTransportSource(): string {
  return `
// The composite's opaque march (surface-finite-composite-gpu.ts): a hit
// carries the owning opaque branch — the wrapper's min at the landing.
struct FinOpaqueHit {
  // 1 hit, 2 miss, 3 refused — TransportBoundary's vocabulary.
  kind: u32,
  reason: u32,
  t: f32,
  normal: vec3f,
  branch: i32,
}

// The opaque term's gradient: transportOpticalNormal's tetrahedron taps
// at the crossing scale, over the opaque term alone (the glass cells are
// the walk's, never this surface's).
fn transportOpaqueNormal(p: vec3f, dir: vec3f, eps: f32, li: u32) -> vec3f {
  let e = vec2f(1.0, -1.0) * 0.5773;
  let grad = e.xyy * finOpaqueAt(p + e.xyy * eps, 0.0, li).d +
    e.yyx * finOpaqueAt(p + e.yyx * eps, 0.0, li).d +
    e.yxy * finOpaqueAt(p + e.yxy * eps, 0.0, li).d +
    e.xxx * finOpaqueAt(p + e.xxx * eps, 0.0, li).d;
  return select(-dir, normalize(grad), dot(grad, grad) > 1.0e-12);
}

// The march ends at \`tLimit\` (the glass walk's next boundary; negative on
// a walk miss, which leaves the domain exit): only a hit strictly before
// that boundary is a terminal, so marching past it bought nothing — and
// could spend the step budget into a refusal the path never needed.
fn transportOpaqueMarch(origin: vec3f, dir: vec3f, eps: f32, li: u32, tLimit: f32) -> FinOpaqueHit {
  var result: FinOpaqueHit;
  result.kind = 3u;
  result.reason = TRANSPORT_REASON_VISIT_CAP;
  result.t = 0.0;
  result.normal = vec3f(0.0);
  result.branch = -1;
  var p = origin;
  var t = 0.0;
  let tExit = transportDomainExit(origin, dir);
  let tFar = select(tExit, min(tExit, tLimit), tLimit >= 0.0);
  for (var i = 0u; i < TRANSPORT_QUERY_MAX_STEPS; i++) {
    if (tFar < 0.0 || t >= tFar) {
      result.kind = 2u;
      result.reason = 0u;
      result.t = t;
      return result;
    }
    let d = finOpaqueAt(p, 0.0, li).d;
    if (!(d > -1.0e30)) {
      result.kind = 3u;
      result.reason = TRANSPORT_REASON_INVALID_INPUT;
      return result;
    }
    let dd = max(d, 0.0);
    if (dd < eps) {
      let hitP = p + dir * dd;
      result.kind = 1u;
      result.reason = 0u;
      result.t = t + dd;
      result.normal = transportOpaqueNormal(hitP, dir, eps, li);
      result.branch = finOpaqueAt(hitP, 0.0, li).branch;
      return result;
    }
    p = p + dir * d;
    t = t + d;
  }
  return result;
}
`;
}
