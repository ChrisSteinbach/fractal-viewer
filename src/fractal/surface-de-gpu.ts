import {
  FOOTPRINT_DEPTH_FLOOR,
  SPHEREFOLD_MID_MIN_R,
  type SurfaceDE,
} from "./surface-de";
import type { Vec3 } from "./types";

/**
 * WebGPU (WGSL) fold-DE kernel — the fr-q1f8 spike for brief §3.7
 * (`docs/fold-de-performance-brief.md`), gated in by fr-ck0w's measured
 * verdict: the WebGL fold tracer is OCCUPANCY-bound (superlinear settle
 * time in frontier width: w4 400s → w6 1059s, w8+ unbounded on Iris Xe),
 * not ALU-bound (the full branch-and-bound cut bought ~14% at equal
 * width). The suspected mechanism is the `FOLD_W = 12` dynamically
 * indexed per-thread frontier (~672 bytes) spilling to scratch memory.
 *
 * This module carries the WGSL source generator and the buffer-packing
 * layer, following the `flame.ts` ↔ `flame-gpu.ts` oracle discipline one
 * render mode over: the kernel mirrors `surface-de.ts`'s
 * {@link estimateDistance} — the `descendFold` refine=FALSE path, exactly
 * the estimator the fold GLSL marches (surface-de.ts MIRROR NOTE) — term
 * for term, and `src/app/gpu-bench/` pins it against that CPU oracle on
 * real query points before any timing is trusted.
 *
 * TWO FRONTIER VARIANTS, selected at source-generation time so the bench
 * can A/B them with everything else held equal:
 *
 * - `sharedFrontier: false` — the frontier lives in function-scope
 *   (private) arrays, the direct WGSL analog of the GLSL variant whose
 *   occupancy collapse fr-ck0w measured. This is the CONTROL.
 * - `sharedFrontier: true` — the frontier lives in workgroup shared
 *   memory, banked per thread (no cross-thread sharing, no barriers),
 *   TRANSPOSED so slot `s` of thread `li` sits at `s*WG + li`:
 *   consecutive threads touch consecutive words, which keeps shared-local
 *   accesses conflict-friendly. This is brief §3.7's direct fix for
 *   factor C. Budget: 14 arrays × width × workgroupSize × 4 bytes
 *   ({@link surfaceGpuWorkgroupBytes}) — at width 12 × WG 32 that is
 *   21 504 bytes, above WebGPU's 16 384-byte default limit, so the bench
 *   must request `maxComputeWorkgroupStorageSize` at device acquisition
 *   (nothing else in this repo does; the flame backend's requiredLimits
 *   comment applies).
 *
 * STAGE-2 BRANCH-AND-BOUND (`bnbStage2`): the fr-kidj stage-2 skips are
 * deliberately CPU-only in the GLSL (every encoding tried pushed the
 * Mesa/Iris link over the watchdog cliff — fr-f21s). WGSL has no such
 * link cliff, so here they are a generation flag: `false` reproduces the
 * shipped GLSL body exactly; `true` adds the skips, which are VALUE
 * no-ops (bit-identical on the CPU gauntlet), so both variants pin
 * against the same oracle. The A/B answers fr-f21s's open question on a
 * compiler stack that can actually run it.
 *
 * MARCH MODE mirrors `scripts/erosion-repro.harness.ts`'s `march()` (the
 * canonical GLSL-march emulator), gridless: sphere gate at
 * `1.02 × visibleBoundingRadius` (origin-centered, like the GLSL), cone
 * eps `max(pixelEps·t, boundingRadius·SURFACE_GPU_HIT_FLOOR)`, hit on
 * `d < eps`, `t += d·stepScale`, full-tier budget. Ray state persists in
 * a storage buffer across bounded dispatches (`stepsThisPass` per pass),
 * and the host compacts the active list between passes — brief §3.7's
 * "compaction every N steps", which is also what keeps every submission
 * bounded (the i915 preemption-timeout lesson from fr-096u).
 *
 * IMAGE MODE (`marchShadeRays`, fr-tzdg) is march mode + terminal
 * shading: the march arithmetic is `marchRays`' verbatim, but the ray
 * direction comes from the GLSL tracer's unproject — near/far clip
 * points through `shade.invProjView`, with `params.ro` doubling as
 * uCamPos and the pose basis fields (right/up/fwd/tanHalf/aspect)
 * IGNORED — plus the tracer's march-start hash dither (flags bit0; off
 * for agreement runs). A ray that turns terminal in-dispatch writes its
 * pixel: misses and exhausted rays the background gradient, hits the
 * full `surface-material.ts` `main()` shade — greedy width-1 hit-info
 * descent (the fold shading overload's colors), tetrahedron normal,
 * soft shadow, AO, linear-space lighting, depth fog — term for term.
 *
 * Scope: BASE fold/affine maps + kaleidoscope sector sweep + affine
 * final lens. `foldFinal` lenses (descendLens) and the refined estimator
 * remain out of scope — {@link packSurfaceGpuParams} throws on
 * `foldFinal`. Modes "eval" and "march" are the fr-q1f8 bench baselines
 * (`src/app/gpu-bench/` pins them) and their generated source is
 * unchanged by the image work; mode "image" is the GLSL tracer's SHADING
 * mirror for the app integration program (fr-tzdg).
 *
 * BYTE LAYOUT CONTRACT (pinned by surface-de-gpu.test.ts):
 *
 * Params uniform — {@link SURFACE_GPU_PARAMS_BYTES} = 208 bytes:
 *   offset  0  vec3f boundCenter          12  f32 boundingRadius
 *          16  f32  escapeRadius          20  f32 stepScale
 *          24  f32  visibleRadius         28  f32 slowestSigma
 *          32  f32  stepCos               36  f32 stepSin
 *          40  u32  symOrder              44  u32 symAxis (0=x,1=y,2=z)
 *          48  u32  mapCount              52  u32 maxDepth
 *          56  u32  itemCount             60  u32 stepsThisPass
 *          64  f32  cutoff                68  f32 footprint (0 = off)
 *          72  u32  marchSteps            76  f32 pixelEps
 *          80  f32  hitFloorEps           84  u32 rasterWidth
 *          88  u32  rasterHeight          92  f32 (pad)
 *          96  vec3f finalM row0         108  f32 finalT.x
 *         112  vec3f finalM row1         124  f32 finalT.y
 *         128  vec3f finalM row2         140  f32 finalT.z
 *         144  vec3f ro                  156  f32 finalSigmaMin
 *         160  vec3f right               172  f32 tanHalf
 *         176  vec3f up                  188  f32 aspect
 *         192  vec3f fwd                 204  f32 (pad)
 *
 * Maps storage — {@link SURFACE_GPU_MAP_VEC4} vec4f per map ({@link
 * SURFACE_GPU_MAP_STRIDE_BYTES} bytes), matching WGSL `struct GpuMap`:
 *   r0  = invM row0 xyz, invT.x        r1 = invM row1 xyz, invT.y
 *   r2  = invM row2 xyz, invT.z
 *   p0  = sigmaMin, foldInvW, foldSigma, foldKind (0/1/2/3 as f32)
 *   bnb = bnbDir xyz, invTNorm
 *   p1  = invMSigmaMin, 0, 0, 0
 *
 * March state — one vec4f per ray: (t, status, steps, lastD), host-
 * initialized to `(-1, 0, 0, 0)`; `t < 0` means the sphere gate has not
 * run yet. Status vocabulary: {@link SURFACE_GPU_RAY_ACTIVE} /
 * `_HIT` / `_MISS` / `_EXHAUSTED`.
 *
 * Shade uniform (mode "image") — {@link SURFACE_GPU_SHADE_BYTES} = 128
 * bytes, WGSL `struct ShadeParams`:
 *   offset 0..63 mat4x4f invProjView (column-major, the exact
 *                THREE.Matrix4.elements scene.ts uploads as uInvProjView)
 *          64  vec3f lightDir          76  f32 ambient
 *          80  vec3f bgTop             92  f32 colorSpeed
 *          96  vec3f bgBottom         108  f32 tracePixelEps
 *         112  u32  colorSource       116  u32 shadowSteps
 *         120  u32  aoTaps            124  u32 flags (bit0 = dither)
 *
 * Shade maps storage (mode "image") — one vec4f per map slot:
 * (uMapColor rgb, uFoldParams.w trapIndex); one zero stride when empty,
 * like {@link packSurfaceGpuMaps}.
 *
 * Image bindings = march bindings plus:
 *   @binding(4) var<uniform> shade: ShadeParams
 *   @binding(5) var<storage, read> shadeMaps: array<vec4f>
 *   @binding(6) var<storage, read_write> colorOut: array<u32> — one RGBA8
 *               pixel per ray via pack4x8unorm (x lands in byte 0, so a
 *               readback Uint8Array is RGBA order). The HOST MUST PRE-FILL
 *               the buffer with the background: a ray still ACTIVE at
 *               frame abort writes nothing and keeps the prefill.
 *   @binding(7) var lutTex: texture_2d<f32> — the 256x1 rgba8unorm LUT
 *   @binding(8) var lutSamp: sampler — FILTERING, linear + clamp-to-edge,
 *               so textureSampleLevel(lutTex, lutSamp, vec2f(u, 0.5), 0.0)
 *               is exact parity with GLSL texture(uColorLUT, vec2(u, 0.5))
 *               on the same Uint8-quantized texture.
 */

/** Mirror of `surface-material.ts`'s `SURFACE_FULL_HIT_FLOOR` (1e-5) —
 * duplicated like the harness emulators do, because `src/fractal/` must
 * stay free of `src/app/` imports. */
export const SURFACE_GPU_HIT_FLOOR = 1.0e-5;

export const SURFACE_GPU_PARAMS_BYTES = 208;
export const SURFACE_GPU_MAP_VEC4 = 6;
export const SURFACE_GPU_MAP_STRIDE_BYTES = SURFACE_GPU_MAP_VEC4 * 16;
/** Byte size of mode "image"'s ShadeParams uniform (layout contract in
 * the module doc). */
export const SURFACE_GPU_SHADE_BYTES = 128;

/** Ray-state status codes (the `y` component of a march state vec4). */
export const SURFACE_GPU_RAY_ACTIVE = 0;
export const SURFACE_GPU_RAY_HIT = 1;
export const SURFACE_GPU_RAY_MISS = 2;
export const SURFACE_GPU_RAY_EXHAUSTED = 3;

/** How many f32 words of frontier state one descent keeps per thread:
 * the oracle's 14 scratch arrays (6 current-frontier + 8 next-level). */
export const SURFACE_GPU_FRONTIER_ARRAYS = 14;

export interface SurfaceGpuKernelOptions {
  /** Which entry point (and binding interface) to generate. */
  mode: "eval" | "march" | "image";
  /** Frontier width — `SURFACE_FOLD_BEAM_WIDTH` for production parity;
   * the bench sweeps 12/8/6/4 to reproduce fr-ck0w's width curve. */
  width: number;
  /** Threads per workgroup. */
  workgroupSize: number;
  /** Workgroup-shared (banked, transposed) frontier vs private arrays. */
  sharedFrontier: boolean;
  /** Include the fr-kidj stage-2 branch-and-bound skips (value no-ops). */
  bnbStage2: boolean;
}

/** Workgroup shared-memory bytes the generated kernel declares — what the
 * bench must cover via `maxComputeWorkgroupStorageSize` when it exceeds
 * the 16 384-byte WebGPU default. Zero for the private variant. */
export function surfaceGpuWorkgroupBytes(
  opts: Pick<
    SurfaceGpuKernelOptions,
    "width" | "workgroupSize" | "sharedFrontier"
  >,
): number {
  if (!opts.sharedFrontier) return 0;
  return SURFACE_GPU_FRONTIER_ARRAYS * opts.width * opts.workgroupSize * 4;
}

/** Camera/raster description for march mode — the bench packs the
 * fold-cost-split harness pose (`poseRays`) into this shape. */
export interface SurfaceGpuPose {
  ro: Vec3;
  right: Vec3;
  up: Vec3;
  fwd: Vec3;
  /** `tan(fovRadians / 2)` for the vertical fov. */
  tanHalf: number;
  /** `rasterWidth / rasterHeight`. */
  aspect: number;
  rasterWidth: number;
  rasterHeight: number;
  /** Cone-eps slope — `2·tan(fov/2) / fullResHeightPx`, decoupled from
   * the bench raster exactly like the harness emulators. */
  pixelEps: number;
}

export interface SurfaceGpuRunParams {
  /** eval: query count. march: entries in the active list this pass. */
  itemCount: number;
  /** march: DE steps one dispatch may advance a ray (bounded work). */
  stepsThisPass?: number;
  /** eval: the oracle's `cutoff` argument (march derives eps per step). */
  cutoff?: number;
  /** fr-3c0k cone-footprint depth cap; 0 (default) = off, matching the
   * GLSL tracer. */
  footprint?: number;
  /** march: whole-ray analytic step budget (SURFACE_FULL_MARCH_STEPS). */
  marchSteps?: number;
  /** Overrides the packed maxDepth (offset 52). Default `de.maxDepth`.
   * The app passes render-tier.ts's previewMaxDepth for preview frames. */
  maxDepth?: number;
  /** Overrides the hit-floor fraction in the offset-80 derivation
   * (`boundingRadius * (run.hitFloor ?? SURFACE_GPU_HIT_FLOOR)`).
   * The app passes the preview tier's coarser floor. */
  hitFloor?: number;
  pose?: SurfaceGpuPose;
}

function writeVec3(view: DataView, offset: number, v: Vec3): void {
  view.setFloat32(offset, v[0], true);
  view.setFloat32(offset + 4, v[1], true);
  view.setFloat32(offset + 8, v[2], true);
}

/**
 * Pack the params uniform for one dispatch. Throws on `foldFinal` systems
 * (the fold-lens wrapper is out of spike scope); an absent affine final
 * lens packs as the identity, exactly like `setSurfaceSystem`.
 */
export function packSurfaceGpuParams(
  de: SurfaceDE,
  run: SurfaceGpuRunParams,
): ArrayBuffer {
  if (de.foldFinal) {
    throw new Error("surface-de-gpu: foldFinal lens systems are out of scope");
  }
  const buf = new ArrayBuffer(SURFACE_GPU_PARAMS_BYTES);
  const view = new DataView(buf);
  writeVec3(view, 0, de.boundCenter);
  view.setFloat32(12, de.boundingRadius, true);
  view.setFloat32(16, de.escapeRadius, true);
  view.setFloat32(20, de.stepScale, true);
  view.setFloat32(24, de.visibleBoundingRadius, true);
  view.setFloat32(28, de.slowestSigma, true);
  view.setFloat32(32, de.symmetry.stepCos, true);
  view.setFloat32(36, de.symmetry.stepSin, true);
  view.setUint32(40, de.symmetry.order, true);
  view.setUint32(
    44,
    de.symmetry.axis === "x" ? 0 : de.symmetry.axis === "y" ? 1 : 2,
    true,
  );
  view.setUint32(48, de.maps.length, true);
  view.setUint32(52, run.maxDepth ?? de.maxDepth, true);
  view.setUint32(56, run.itemCount, true);
  view.setUint32(60, run.stepsThisPass ?? 0, true);
  view.setFloat32(64, run.cutoff ?? 0, true);
  view.setFloat32(68, run.footprint ?? 0, true);
  view.setUint32(72, run.marchSteps ?? 0, true);
  const pose = run.pose;
  view.setFloat32(76, pose?.pixelEps ?? 0, true);
  view.setFloat32(
    80,
    de.boundingRadius * (run.hitFloor ?? SURFACE_GPU_HIT_FLOOR),
    true,
  );
  view.setUint32(84, pose?.rasterWidth ?? 0, true);
  view.setUint32(88, pose?.rasterHeight ?? 0, true);
  const f = de.final;
  const fm = f ? f.invM : [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const ft = f ? f.invT : ([0, 0, 0] as Vec3);
  writeVec3(view, 96, [fm[0], fm[1], fm[2]]);
  view.setFloat32(108, ft[0], true);
  writeVec3(view, 112, [fm[3], fm[4], fm[5]]);
  view.setFloat32(124, ft[1], true);
  writeVec3(view, 128, [fm[6], fm[7], fm[8]]);
  view.setFloat32(140, ft[2], true);
  writeVec3(view, 144, pose?.ro ?? [0, 0, 0]);
  view.setFloat32(156, f ? f.sigmaMin : 1, true);
  writeVec3(view, 160, pose?.right ?? [1, 0, 0]);
  view.setFloat32(172, pose?.tanHalf ?? 0, true);
  writeVec3(view, 176, pose?.up ?? [0, 1, 0]);
  view.setFloat32(188, pose?.aspect ?? 1, true);
  writeVec3(view, 192, pose?.fwd ?? [0, 0, 1]);
  view.setFloat32(204, 0, true);
  return buf;
}

/** Pack the per-map storage array (layout contract above). */
export function packSurfaceGpuMaps(de: SurfaceDE): Float32Array {
  const out = new Float32Array(
    de.maps.length * SURFACE_GPU_MAP_VEC4 * 4 || SURFACE_GPU_MAP_VEC4 * 4,
  );
  de.maps.forEach((m, j) => {
    const base = j * SURFACE_GPU_MAP_VEC4 * 4;
    out[base + 0] = m.invM[0];
    out[base + 1] = m.invM[1];
    out[base + 2] = m.invM[2];
    out[base + 3] = m.invT[0];
    out[base + 4] = m.invM[3];
    out[base + 5] = m.invM[4];
    out[base + 6] = m.invM[5];
    out[base + 7] = m.invT[1];
    out[base + 8] = m.invM[6];
    out[base + 9] = m.invM[7];
    out[base + 10] = m.invM[8];
    out[base + 11] = m.invT[2];
    out[base + 12] = m.sigmaMin;
    out[base + 13] = m.foldInvW;
    out[base + 14] = m.foldSigma;
    out[base + 15] = m.foldKind;
    out[base + 16] = m.bnbDir[0];
    out[base + 17] = m.bnbDir[1];
    out[base + 18] = m.bnbDir[2];
    out[base + 19] = m.invTNorm;
    out[base + 20] = m.invMSigmaMin;
  });
  return out;
}

/** Shading inputs for mode "image" — the GLSL tracer's shading uniforms.
 * `invProjView` is column-major (THREE.Matrix4.elements order), the exact
 * matrix scene.ts uploads as uInvProjView. */
export interface SurfaceGpuShadeParams {
  invProjView: ArrayLike<number>; // 16 floats, column-major
  lightDir: Vec3; // unit, toward the light (uLightDir)
  ambient: number; // uAmbient
  bgTop: Vec3; // uBgTop
  bgBottom: Vec3; // uBgBottom
  colorSpeed: number; // uColorSpeed (hit-info per-level decay)
  /** TRACE-resolution cone slope: dither + normal h (uPixelEps analog) —
   * distinct from the pose's pixelEps, which is the ACCEPTANCE slope
   * (uAcceptPixelEps semantics). */
  tracePixelEps: number;
  /** 0 transform, 1 palette/trap, 2 height, 3 radius, 4 rings, 5 sheets. */
  colorSource: number;
  shadowSteps: number; // uShadowSteps (per tier)
  aoTaps: number; // uAoTaps (per tier)
  dither: boolean; // march-start hash dither (off for bench agreement)
}

/** Pack the mode-"image" ShadeParams uniform (layout contract in the
 * module doc). flags = dither ? 1 : 0. */
export function packSurfaceGpuShade(shade: SurfaceGpuShadeParams): ArrayBuffer {
  const buf = new ArrayBuffer(SURFACE_GPU_SHADE_BYTES);
  const view = new DataView(buf);
  for (let k = 0; k < 16; k++) {
    view.setFloat32(k * 4, shade.invProjView[k], true);
  }
  writeVec3(view, 64, shade.lightDir);
  view.setFloat32(76, shade.ambient, true);
  writeVec3(view, 80, shade.bgTop);
  view.setFloat32(92, shade.colorSpeed, true);
  writeVec3(view, 96, shade.bgBottom);
  view.setFloat32(108, shade.tracePixelEps, true);
  view.setUint32(112, shade.colorSource, true);
  view.setUint32(116, shade.shadowSteps, true);
  view.setUint32(120, shade.aoTaps, true);
  view.setUint32(124, shade.dither ? 1 : 0, true);
  return buf;
}

/** Per-map shading storage for mode "image": one vec4f per map slot,
 * (color.r, color.g, color.b, trapIndex) — uMapColor + the uFoldParams .w
 * trap component, which GpuMap does not carry. Pads to one zero stride
 * when empty, like packSurfaceGpuMaps. */
export function packSurfaceGpuShadeMaps(
  colors: Vec3[],
  trapIndices: number[],
): Float32Array {
  const out = new Float32Array(Math.max(colors.length, 1) * 4);
  colors.forEach((c, j) => {
    out[j * 4 + 0] = c[0];
    out[j * 4 + 1] = c[1];
    out[j * 4 + 2] = c[2];
    out[j * 4 + 3] = trapIndices[j] ?? 0;
  });
  return out;
}

/**
 * Generate the WGSL source for one kernel configuration. The descent body
 * is `descendFold`'s refine=false path term for term (surface-de.ts) in
 * the GLSL mirror's f32 formulation (surface-material.ts `#if
 * SURFACE_FOLDS`): same enumeration order, same prunes, same unsorted
 * frontier with tracked-worst rescan, same early exits — so the CPU
 * estimator, the GLSL tracer and this kernel stay in lockstep term for
 * term, and any disagreement the bench finds is a bug, not a design gap.
 */
export function surfaceDeKernelWgsl(opts: SurfaceGpuKernelOptions): string {
  const { mode, width, workgroupSize, sharedFrontier, bnbStage2 } = opts;
  if (!Number.isInteger(width) || width < 1) {
    throw new Error(`surface-de-gpu: bad frontier width ${width}`);
  }
  if (!Number.isInteger(workgroupSize) || workgroupSize < 1) {
    throw new Error(`surface-de-gpu: bad workgroup size ${workgroupSize}`);
  }
  const W = `${width}u`;
  const arrays = [
    "fcX",
    "fcY",
    "fcZ",
    "fcScale",
    "fcFloor",
    "fcR",
    "fnKey",
    "fnX",
    "fnY",
    "fnZ",
    "fnScale",
    "fnFloor",
    "fnR",
    "fnCert",
  ];
  const frontierDecls = sharedFrontier
    ? arrays
        .map(
          (a) => `var<workgroup> ${a}: array<f32, ${width * workgroupSize}>;`,
        )
        .join("\n")
    : "";
  const privateDecls = sharedFrontier
    ? ""
    : arrays.map((a) => `  var ${a}: array<f32, ${width}>;`).join("\n");
  // Transposed banking: slot-major stride keeps consecutive threads on
  // consecutive shared words. The private variant ignores `li`.
  const ixBody = sharedFrontier
    ? `return slot * ${workgroupSize}u + li;`
    : `return slot;`;

  // march and image share the ray-state I/O; image adds the shading
  // interface on top (ShadeParams block + bindings 4-8, module doc).
  const rayIo = `
@group(0) @binding(2) var<storage, read> activeList: array<u32>;
@group(0) @binding(3) var<storage, read_write> states: array<vec4f>;`;
  const imageIo = `${rayIo}

struct ShadeParams {
  invProjView: mat4x4f,
  lightDir: vec3f,
  ambient: f32,
  bgTop: vec3f,
  colorSpeed: f32,
  bgBottom: vec3f,
  tracePixelEps: f32,
  colorSource: u32,
  shadowSteps: u32,
  aoTaps: u32,
  flags: u32,
}

@group(0) @binding(4) var<uniform> shade: ShadeParams;
@group(0) @binding(5) var<storage, read> shadeMaps: array<vec4f>;
@group(0) @binding(6) var<storage, read_write> colorOut: array<u32>;
@group(0) @binding(7) var lutTex: texture_2d<f32>;
@group(0) @binding(8) var lutSamp: sampler;`;
  const io =
    mode === "eval"
      ? `
@group(0) @binding(2) var<storage, read> queries: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> results: array<f32>;`
      : mode === "march"
        ? rayIo
        : imageIo;

  const entry =
    mode === "eval"
      ? `
@compute @workgroup_size(${workgroupSize})
fn evalQueries(
  @builtin(global_invocation_id) gid: vec3u,
  @builtin(local_invocation_index) li: u32,
) {
  let i = gid.x;
  if (i >= params.itemCount) {
    return;
  }
  results[i] = surfaceDE(queries[i].xyz, params.cutoff, li);
}`
      : mode === "march"
        ? `
@compute @workgroup_size(${workgroupSize})
fn marchRays(
  @builtin(global_invocation_id) gid: vec3u,
  @builtin(local_invocation_index) li: u32,
) {
  let slotI = gid.x;
  if (slotI >= params.itemCount) {
    return;
  }
  let ray = activeList[slotI];
  var st = states[ray];
  if (st.y != ${SURFACE_GPU_RAY_ACTIVE}.0) {
    return;
  }
  let px = ray % params.rasterWidth;
  let py = ray / params.rasterWidth;
  // poseRays mirror (scripts/fold-cost-split.harness.ts): NDC pixel
  // centers against the vertical-fov tangent.
  let ndcX = ((f32(px) + 0.5) / f32(params.rasterWidth)) * 2.0 - 1.0;
  let ndcY = ((f32(py) + 0.5) / f32(params.rasterHeight)) * 2.0 - 1.0;
  let rd = normalize(
    params.fwd +
      params.right * (ndcX * params.tanHalf * params.aspect) +
      params.up * (ndcY * params.tanHalf),
  );
  let ro = params.ro;
  // Sphere gate, origin-centered like the GLSL marcher (the emulator's
  // exact arithmetic; recomputed per pass — cheaper than persisting).
  let radius = params.visibleRadius * 1.02;
  let bq = dot(ro, rd);
  let cq = dot(ro, ro) - radius * radius;
  let disc = bq * bq - cq;
  if (disc < 0.0) {
    st.y = ${SURFACE_GPU_RAY_MISS}.0;
    states[ray] = st;
    return;
  }
  let sq = sqrt(disc);
  let tFar = -bq + sq;
  if (tFar <= 0.0) {
    st.y = ${SURFACE_GPU_RAY_MISS}.0;
    states[ray] = st;
    return;
  }
  var t = st.x;
  if (t < 0.0) {
    t = max(-bq - sq, 0.0);
  }
  var steps = u32(st.z);
  for (var sIt = 0u; sIt < params.stepsThisPass; sIt++) {
    if (t > tFar) {
      st.y = ${SURFACE_GPU_RAY_MISS}.0;
      break;
    }
    if (steps >= params.marchSteps) {
      st.y = ${SURFACE_GPU_RAY_EXHAUSTED}.0;
      break;
    }
    let eps = max(params.pixelEps * t, params.hitFloorEps);
    let d = surfaceDE(ro + rd * t, eps, li);
    steps++;
    if (d < eps) {
      st.y = ${SURFACE_GPU_RAY_HIT}.0;
      break;
    }
    t += d * params.stepScale;
    st.w = d;
  }
  st.x = t;
  st.z = f32(steps);
  states[ray] = st;
}`
        : `
// Per-pixel march-start dither — surface-material.ts's hash(), fed
// gl_FragCoord.xy parity inputs (pixel centers).
fn hash2(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.5453);
}

struct SurfaceHitInfo {
  firstChoice: i32,
  trap: f32,
  rings: f32,
  sheets: f32,
}

// Fold hit-info descent (surface-material.ts's SURFACE_FOLDS shading
// overload, term for term): a GREEDY width-1 chain — at each level the
// smallest floored-key candidate over every (sector, map, branch) triple
// — feeding colors only, so no frontier arrays and no prunes. Plain
// params.maxDepth on purpose: the GLSL reads uMaxDepth, never the
// footprint cap.
fn surfaceDEHitInfo(p: vec3f, li: u32) -> SurfaceHitInfo {
  let q = vec3f(
    dot(params.finalM0, p) + params.finalT0,
    dot(params.finalM1, p) + params.finalT1,
    dot(params.finalM2, p) + params.finalT2,
  );
  var info = SurfaceHitInfo(0, 0.0, 1.0, 1.0);
  var trapAcc = 0.0;
  var trapNorm = 0.0;
  var trapW = 1.0;
  var chQ = q;
  var chScale = 1.0;
  var chFloor = 0.0;
  var live = true;
  let R = params.boundingRadius;
  for (var depth = 0u; depth < params.maxDepth; depth++) {
    if (!live) {
      break;
    }
    var lbKey = 1e30;
    var lbMap = 0u;
    var lbR = 0.0;
    var lbAbsY = 0.0;
    var lbQ = vec3f(0.0);
    var lbScale = 1.0;
    var lbFloor = 0.0;
    let pScale = chScale;
    let pFloor = chFloor;
    var sQ = chQ;
    for (var k = 0u; k < params.symOrder; k++) {
      if (k > 0u) {
        sQ = stepSector(sQ);
      }
      for (var j = 0u; j < params.mapCount; j++) {
        let m = maps[j];
        let kind = u32(m.p0.w);
        var branchCount = 1u;
        if (kind == 1u) {
          branchCount = 27u;
        } else if (kind == 2u) {
          branchCount = 3u;
        } else if (kind == 3u) {
          branchCount = 81u;
        }
        let mapSigma = m.p0.x;
        let absW = m.p0.z / mapSigma;
        var u = vec3f(0.0);
        var ru = 0.0;
        var pre0 = vec3f(0.0);
        var pre1 = vec3f(0.0);
        var pre2 = vec3f(0.0);
        var dUp = vec3f(0.0);
        var dDn = vec3f(0.0);
        var v = vec3f(0.0);
        var sfSigma = 1.0;
        var sfRd = 0.0;
        if (kind != 0u) {
          u = sQ * m.p0.y;
          if (kind == 1u) {
            pre0 = u;
            pre1 = 2.0 - u;
            pre2 = -2.0 - u;
            dUp = max(u - 1.0, vec3f(0.0));
            dDn = max(-1.0 - u, vec3f(0.0));
          } else {
            ru = length(u);
          }
        }
        for (var b = 0u; b < branchCount; b++) {
          var img: vec3f;
          var branchSigma: f32;
          var branchRd = 0.0;
          if (kind == 0u) {
            img = mapApply(m, sQ);
            branchSigma = mapSigma;
          } else {
            if (kind == 2u || (kind == 3u && (b % 27u) == 0u)) {
              var s = b;
              if (kind == 3u) {
                s = b / 27u;
              }
              if (s == 0u) {
                v = u;
                sfSigma = 1.0;
                sfRd = max(1.0 - ru, 0.0);
              } else if (s == 1u) {
                v = 0.25 * u;
                sfSigma = 4.0;
                sfRd = max(ru - 2.0, 0.0);
              } else {
                if (ru < ${SPHEREFOLD_MID_MIN_R}) {
                  // GLSL parity: plain skip — the shading chain folds no
                  // shell certificate (there is no best to fold it into).
                  if (kind == 3u) {
                    b += 26u;
                  }
                  continue;
                }
                let invR2 = 1.0 / (ru * ru);
                v = u * invR2;
                sfSigma = ru;
                sfRd = max(max(1.0 - ru, ru - 2.0), 0.0);
              }
              if (kind == 3u) {
                pre0 = v;
                pre1 = 2.0 - v;
                pre2 = -2.0 - v;
                dUp = max(v - 1.0, vec3f(0.0));
                dDn = max(-1.0 - v, vec3f(0.0));
              }
            }
            var pre: vec3f;
            if (kind == 2u) {
              pre = v;
              branchRd = sfRd;
            } else {
              var bb = b;
              if (kind == 3u) {
                bb = b % 27u;
              }
              let selX = bb % 3u;
              let selY = (bb / 3u) % 3u;
              let selZ = bb / 9u;
              pre = vec3f(
                select(select(pre2.x, pre1.x, selX == 1u), pre0.x, selX == 0u),
                select(select(pre2.y, pre1.y, selY == 1u), pre0.y, selY == 0u),
                select(select(pre2.z, pre1.z, selZ == 1u), pre0.z, selZ == 0u),
              );
              let dd = vec3f(
                select(
                  select(dDn.x, dUp.x, selX == 1u),
                  max(dUp.x, dDn.x),
                  selX == 0u,
                ),
                select(
                  select(dDn.y, dUp.y, selY == 1u),
                  max(dUp.y, dDn.y),
                  selY == 0u,
                ),
                select(
                  select(dDn.z, dUp.z, selZ == 1u),
                  max(dUp.z, dDn.z),
                  selZ == 0u,
                ),
              );
              let boxRd = length(dd);
              if (kind == 1u) {
                branchRd = boxRd;
              } else {
                branchRd = max(sfRd, sfSigma * boxRd);
              }
            }
            img = mapApply(m, pre);
            branchSigma = m.p0.z * sfSigma;
          }
          let r = length(img - params.boundCenter);
          var candFloor = pFloor;
          if (branchRd > 0.0) {
            candFloor = max(candFloor, pScale * absW * branchRd);
          }
          var key = pScale * (r - R);
          if (candFloor > 0.0 && candFloor > key) {
            key = candFloor;
          }
          if (key < lbKey) {
            lbKey = key;
            lbMap = j;
            lbR = r;
            lbAbsY = abs(img.y);
            lbQ = img;
            lbScale = pScale * branchSigma;
            lbFloor = candFloor;
          }
        }
      }
    }
    if (lbKey >= 1e29) {
      break;
    }
    if (depth == 0u) {
      info.firstChoice = i32(lbMap);
    }
    trapAcc += trapW * shadeMaps[lbMap].w;
    trapNorm += trapW;
    trapW *= shade.colorSpeed;
    info.rings = min(info.rings, lbR / R);
    info.sheets = min(info.sheets, lbAbsY / R);
    if (lbR > params.escapeRadius) {
      live = false;
    } else {
      chQ = lbQ;
      chScale = lbScale;
      chFloor = lbFloor;
    }
  }
  info.trap = select(0.0, trapAcc / trapNorm, trapNorm > 0.0);
  info.rings = clamp(info.rings, 0.0, 1.0);
  info.sheets = clamp(info.sheets, 0.0, 1.0);
  return info;
}

@compute @workgroup_size(${workgroupSize})
fn marchShadeRays(
  @builtin(global_invocation_id) gid: vec3u,
  @builtin(local_invocation_index) li: u32,
) {
  let slotI = gid.x;
  if (slotI >= params.itemCount) {
    return;
  }
  let ray = activeList[slotI];
  var st = states[ray];
  if (st.y != ${SURFACE_GPU_RAY_ACTIVE}.0) {
    return;
  }
  let px = ray % params.rasterWidth;
  let py = ray / params.rasterWidth;
  // main()'s background gradient at this pixel's vUv.y (pixel center).
  let bg = mix(
    shade.bgBottom,
    shade.bgTop,
    clamp((f32(py) + 0.5) / f32(params.rasterHeight), 0.0, 1.0),
  );
  let ndcX = ((f32(px) + 0.5) / f32(params.rasterWidth)) * 2.0 - 1.0;
  let ndcY = ((f32(py) + 0.5) / f32(params.rasterHeight)) * 2.0 - 1.0;
  // The GLSL tracer's unproject (main(): near/far clip points through
  // uInvProjView); params.ro doubles as uCamPos, and the pose basis
  // right/up/fwd/tanHalf/aspect fields are ignored in this mode.
  let nearP = shade.invProjView * vec4f(ndcX, ndcY, -1.0, 1.0);
  let farP = shade.invProjView * vec4f(ndcX, ndcY, 1.0, 1.0);
  let rd = normalize(farP.xyz / farP.w - nearP.xyz / nearP.w);
  let ro = params.ro;
  // Sphere gate, origin-centered like the GLSL marcher (the emulator's
  // exact arithmetic; recomputed per pass — cheaper than persisting).
  let radius = params.visibleRadius * 1.02;
  let bq = dot(ro, rd);
  let cq = dot(ro, ro) - radius * radius;
  let disc = bq * bq - cq;
  if (disc < 0.0) {
    st.y = ${SURFACE_GPU_RAY_MISS}.0;
    states[ray] = st;
    colorOut[ray] = pack4x8unorm(vec4f(bg, 1.0));
    return;
  }
  let sq = sqrt(disc);
  let tFar = -bq + sq;
  if (tFar <= 0.0) {
    st.y = ${SURFACE_GPU_RAY_MISS}.0;
    states[ray] = st;
    colorOut[ray] = pack4x8unorm(vec4f(bg, 1.0));
    return;
  }
  var t = st.x;
  if (t < 0.0) {
    t = max(-bq - sq, 0.0);
    // Tiny dithered start (main()'s hash line), flag-gated so agreement
    // runs stay deterministic against the CPU emulator.
    if ((shade.flags & 1u) != 0u) {
      t += hash2(vec2f(f32(px) + 0.5, f32(py) + 0.5)) *
        shade.tracePixelEps * max(t, 1.0);
    }
  }
  var steps = u32(st.z);
  for (var sIt = 0u; sIt < params.stepsThisPass; sIt++) {
    if (t > tFar) {
      st.y = ${SURFACE_GPU_RAY_MISS}.0;
      break;
    }
    if (steps >= params.marchSteps) {
      st.y = ${SURFACE_GPU_RAY_EXHAUSTED}.0;
      break;
    }
    let eps = max(params.pixelEps * t, params.hitFloorEps);
    let d = surfaceDE(ro + rd * t, eps, li);
    steps++;
    if (d < eps) {
      st.y = ${SURFACE_GPU_RAY_HIT}.0;
      break;
    }
    t += d * params.stepScale;
    st.w = d;
  }
  st.x = t;
  st.z = f32(steps);
  states[ray] = st;
  if (st.y == ${SURFACE_GPU_RAY_ACTIVE}.0) {
    // Out of pass budget: write nothing — the host prefilled colorOut
    // with the background, and a later pass finishes this ray.
    return;
  }
  if (st.y != ${SURFACE_GPU_RAY_HIT}.0) {
    colorOut[ray] = pack4x8unorm(vec4f(bg, 1.0));
    return;
  }
  // --- shade: surface-material.ts main()'s hit path, term for term ---
  let pos = ro + rd * t;
  // The PRE-dither sphere entry — exactly main()'s tEnter fog origin.
  let tEnter = max(-bq - sq, 0.0);
  let R = params.boundingRadius;
  let visR = params.visibleRadius;
  let hi = surfaceDEHitInfo(pos, li);
  // Base color by source; sources 1-5 sample the CPU-built LUT.
  var base: vec3f;
  if (shade.colorSource == 0u) {
    base = shadeMaps[clamp(hi.firstChoice, 0, i32(params.mapCount) - 1)].rgb;
  } else {
    var u: f32;
    if (shade.colorSource == 1u) {
      u = hi.trap;
    } else if (shade.colorSource == 2u) {
      u = clamp(pos.y / visR * 0.5 + 0.5, 0.0, 1.0);
    } else if (shade.colorSource == 3u) {
      u = clamp(length(pos) / visR, 0.0, 1.0);
    } else if (shade.colorSource == 4u) {
      u = hi.rings;
    } else {
      u = hi.sheets;
    }
    base = textureSampleLevel(lutTex, lutSamp, vec2f(u, 0.5), 0.0).rgb;
  }
  // Normal from the DE gradient (tetrahedron taps), probed at the hit's
  // own resolution scale; a vanishing gradient faces the camera instead
  // of dividing by ~zero.
  let h = max(shade.tracePixelEps * t, R * 2.0e-4);
  let e = vec2f(1.0, -1.0) * 0.5773;
  let grad = e.xyy * surfaceDE(pos + e.xyy * h, 0.0, li) +
    e.yyx * surfaceDE(pos + e.yyx * h, 0.0, li) +
    e.yxy * surfaceDE(pos + e.yxy * h, 0.0, li) +
    e.xxx * surfaceDE(pos + e.xxx * h, 0.0, li);
  let n = select(-rd, normalize(grad), dot(grad, grad) > 1e-12);
  // Soft shadow: DE penumbra toward the light, started just off the
  // surface; near-black penumbras and leaving the sphere end early.
  var shadow = 1.0;
  var ts = h * 2.0;
  for (var i = 0u; i < shade.shadowSteps; i++) {
    let sp = pos + n * h * 2.0 + shade.lightDir * ts;
    let d = surfaceDE(sp, 0.0, li);
    shadow = min(shadow, 8.0 * d / ts);
    ts += clamp(d, R * 2.0e-4, visR * 0.1);
    if (shadow < 0.02 || length(sp) > visR * 1.05) {
      break;
    }
  }
  shadow = clamp(shadow, 0.0, 1.0);
  // Ambient occlusion: short DE probes along the normal, geometrically
  // down-weighted (1-based inclusive taps, the GLSL loop verbatim).
  var occ = 0.0;
  var wgt = 1.0;
  var norm = 0.0;
  for (var i = 1u; i <= shade.aoTaps; i++) {
    let hh = R * 0.02 * f32(i);
    occ += wgt * clamp((hh - surfaceDE(pos + n * hh, 0.0, li)) / hh, 0.0, 1.0);
    norm += wgt;
    wgt *= 0.6;
  }
  let ao = clamp(1.0 - 0.85 * occ / norm, 0.0, 1.0);
  let diffuse = max(dot(n, shade.lightDir), 0.0);
  let halfVec = normalize(shade.lightDir - rd);
  let specular = pow(max(dot(n, halfVec), 0.0), 32.0) * 0.4;
  let lit = shade.ambient * ao + (1.0 - shade.ambient) * diffuse * shadow;
  // Light in linear space (fr-8id): decode the sRGB base, apply the
  // light/specular product there, re-encode for the canvas.
  let linBase = pow(base, vec3f(2.2));
  var col = pow(linBase * lit + vec3f(specular * shadow), vec3f(1.0 / 2.2));
  // Depth fog toward the backdrop: squared-exponential in the distance
  // traveled inside the bounding sphere.
  let fog = 1.0 - exp(-0.12 * pow((t - tEnter) / max(visR, 1.0e-6), 2.0));
  col = mix(col, bg, clamp(fog, 0.0, 1.0));
  colorOut[ray] = pack4x8unorm(vec4f(col, 1.0));
}`;

  // fr-kidj stage-2 branch-and-bound (surface-de.ts descendFold, the
  // in-loop case analysis): value no-ops, generated only on request.
  const stage2ChainHoist = bnbStage2
    ? `
      let chainNormSq = dot(sQ0, sQ0);
      let invPScale = 1.0 / pScale;`
    : "";
  const stage2MapHoist = bnbStage2
    ? `
          let bnbSigma = m.p1.x;
          let bnbSigmaSq = bnbSigma * bnbSigma;
          let bnbT = m.bnb.w;
          let needE = params.escapeRadius + bnbT;
          let needESq = needE * needE;
          let bnbG = m.bnb.xyz;
          var invChildScale = 1.0 / (pScale * mapSigma);
          if (kind != 0u) {
            invChildScale = 1.0 / (pScale * m.p0.z);
          }`
    : "";
  const stage2AffineSkip = bnbStage2
    ? `
            let rDir = dot(bnbG, sQ) + bnbT;
            let rEsc = R + best * invChildScale;
            if (rDir > params.escapeRadius && rDir >= rEsc) {
              continue;
            }
            let sTerm = chainNormSq * bnbSigmaSq;
            if (sTerm > needESq) {
              let needC = rEsc + bnbT;
              if (needC <= 0.0 || sTerm >= needC * needC) {
                continue;
              }
            }
            if (keptCount == ${W}) {
              let qReq =
                R + max(0.0, max(best * invChildScale, fnWorstKey * invPScale));
              if (rDir >= qReq) {
                continue;
              }
              let need = qReq + bnbT;
              if (sTerm >= need * need) {
                continue;
              }
            }`
    : "";
  const stage2SphereRescale = bnbStage2
    ? `
                invChildScale = 1.0 / (pScale * m.p0.z * sfSigma);`
    : "";
  const stage2FoldSkip = bnbStage2
    ? `
              let rDir = dot(bnbG, pre) + bnbT;
              let rEsc = R + best * invChildScale;
              if (rDir > params.escapeRadius && rDir >= rEsc) {
                continue;
              }
              let sTerm = dot(pre, pre) * bnbSigmaSq;
              if (sTerm > needESq) {
                let needC = rEsc + bnbT;
                if (needC <= 0.0 || sTerm >= needC * needC) {
                  continue;
                }
              }
              if (keptCount == ${W}) {
                let qReq =
                  R +
                  max(0.0, max(best * invChildScale, fnWorstKey * invPScale));
                if (rDir >= qReq) {
                  continue;
                }
                let need = qReq + bnbT;
                if (sTerm >= need * need) {
                  continue;
                }
              }`
    : "";

  return /* wgsl */ `
struct Params {
  boundCenter: vec3f,
  boundingRadius: f32,
  escapeRadius: f32,
  stepScale: f32,
  visibleRadius: f32,
  slowestSigma: f32,
  stepCos: f32,
  stepSin: f32,
  symOrder: u32,
  symAxis: u32,
  mapCount: u32,
  maxDepth: u32,
  itemCount: u32,
  stepsThisPass: u32,
  cutoff: f32,
  footprint: f32,
  marchSteps: u32,
  pixelEps: f32,
  hitFloorEps: f32,
  rasterWidth: u32,
  rasterHeight: u32,
  pad0: f32,
  finalM0: vec3f,
  finalT0: f32,
  finalM1: vec3f,
  finalT1: f32,
  finalM2: vec3f,
  finalT2: f32,
  ro: vec3f,
  finalSigmaMin: f32,
  right: vec3f,
  tanHalf: f32,
  up: vec3f,
  aspect: f32,
  fwd: vec3f,
  pad1: f32,
}

struct GpuMap {
  r0: vec4f,
  r1: vec4f,
  r2: vec4f,
  p0: vec4f,
  bnb: vec4f,
  p1: vec4f,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> maps: array<GpuMap>;
${io}

${frontierDecls}

fn frontierIx(slot: u32, li: u32) -> u32 {
  ${ixBody}
}

fn mapApply(m: GpuMap, x: vec3f) -> vec3f {
  return vec3f(
    dot(m.r0.xyz, x) + m.r0.w,
    dot(m.r1.xyz, x) + m.r1.w,
    dot(m.r2.xyz, x) + m.r2.w,
  );
}

fn stepSector(v: vec3f) -> vec3f {
  let c = params.stepCos;
  let s = params.stepSin;
  if (params.symAxis == 0u) {
    return vec3f(v.x, c * v.y + s * v.z, -s * v.y + c * v.z);
  }
  if (params.symAxis == 1u) {
    return vec3f(c * v.x - s * v.z, v.y, s * v.x + c * v.z);
  }
  return vec3f(c * v.x + s * v.y, -s * v.x + c * v.y, v.z);
}

// descendFold's refine=false path (surface-de.ts), the estimator the
// fold GLSL marches, in that mirror's f32 formulation.
fn surfaceDE(pIn: vec3f, cutoff: f32, li: u32) -> f32 {
${privateDecls}
  let q = vec3f(
    dot(params.finalM0, pIn) + params.finalT0,
    dot(params.finalM1, pIn) + params.finalT1,
    dot(params.finalM2, pIn) + params.finalT2,
  );
  let R = params.boundingRadius;
  let startR = length(q - params.boundCenter);
  let sphereBound = startR - R;
  var best = 1e30;
  var bailBelow = -1e30;
  if (cutoff > 0.0 && sphereBound * params.finalSigmaMin < cutoff) {
    bailBelow = cutoff;
  }
  // fr-3c0k cone-footprint depth cap; footprint <= 0 disables (the
  // GLSL-parity default).
  var maxDepth = params.maxDepth;
  if (params.footprint > 0.0) {
    let capF = ceil(
      log(params.footprint / (2.0 * R)) / log(params.slowestSigma),
    );
    let floored = max(capF, ${FOOTPRINT_DEPTH_FLOOR}.0);
    maxDepth = min(params.maxDepth, u32(floored));
  }
  var chainCount = 1u;
  fcX[frontierIx(0u, li)] = q.x;
  fcY[frontierIx(0u, li)] = q.y;
  fcZ[frontierIx(0u, li)] = q.z;
  fcScale[frontierIx(0u, li)] = 1.0;
  fcFloor[frontierIx(0u, li)] = 0.0;
  fcR[frontierIx(0u, li)] = startR;
  for (var depth = 0u; depth < maxDepth; depth++) {
    if (chainCount == 0u) {
      break;
    }
    var keptCount = 0u;
    var fnWorstKey = -1e30;
    var fnWorstIdx = 0u;
    for (var c = 0u; c < chainCount; c++) {
      let pScale = fcScale[frontierIx(c, li)];
      let pFloor = fcFloor[frontierIx(c, li)];
      let sQ0 = vec3f(
        fcX[frontierIx(c, li)],
        fcY[frontierIx(c, li)],
        fcZ[frontierIx(c, li)],
      );
      var sQ = sQ0;${stage2ChainHoist}
      for (var k = 0u; k < params.symOrder; k++) {
        if (k > 0u) {
          sQ = stepSector(sQ);
        }
        for (var j = 0u; j < params.mapCount; j++) {
          let m = maps[j];
          let kind = u32(m.p0.w);
          var branchCount = 1u;
          if (kind == 1u) {
            branchCount = 27u;
          } else if (kind == 2u) {
            branchCount = 3u;
          } else if (kind == 3u) {
            branchCount = 81u;
          }
          let mapSigma = m.p0.x;
          let absW = m.p0.z / mapSigma;${stage2MapHoist}
          var u = vec3f(0.0);
          var ru = 0.0;
          var pre0 = vec3f(0.0);
          var pre1 = vec3f(0.0);
          var pre2 = vec3f(0.0);
          var dUp = vec3f(0.0);
          var dDn = vec3f(0.0);
          var v = vec3f(0.0);
          var sfSigma = 1.0;
          var sfRd = 0.0;
          if (kind != 0u) {
            u = sQ * m.p0.y;
            if (kind == 1u) {
              pre0 = u;
              pre1 = 2.0 - u;
              pre2 = -2.0 - u;
              dUp = max(u - 1.0, vec3f(0.0));
              dDn = max(-1.0 - u, vec3f(0.0));
            } else {
              ru = length(u);
            }
          }
          for (var b = 0u; b < branchCount; b++) {
            var img: vec3f;
            var branchSigma: f32;
            // The candidate's floor is knowable BEFORE the child
            // transform (fr-kidj stage 1), so the floor-vs-best prune
            // runs first and only surviving branches pay the inverse
            // application — the oracle's exact order.
            var candFloor = pFloor;
            if (kind == 0u) {
              if (candFloor > 0.0 && candFloor >= best) {
                continue;
              }${stage2AffineSkip}
              img = mapApply(m, sQ);
              branchSigma = mapSigma;
            } else {
              var branchRd: f32;
              if (kind == 2u || (kind == 3u && (b % 27u) == 0u)) {
                // (Re)compute the spherefold branch this b enters, with
                // its distance to the branch's OUTPUT region.
                var s = b;
                if (kind == 3u) {
                  s = b / 27u;
                }
                if (s == 0u) {
                  v = u;
                  sfSigma = 1.0;
                  sfRd = max(1.0 - ru, 0.0);
                } else if (s == 1u) {
                  v = 0.25 * u;
                  sfSigma = 4.0;
                  sfRd = max(ru - 2.0, 0.0);
                } else {
                  if (ru < ${SPHEREFOLD_MID_MIN_R}) {
                    // f32 overflow guard: fold the unit-shell bound and
                    // skip the branch + its box expansion.
                    var shellCert = pScale * absW * (1.0 - ru);
                    shellCert = max(shellCert, pFloor);
                    if (shellCert < best) {
                      best = shellCert;
                      if (
                        best <= sphereBound ||
                        best * params.finalSigmaMin < bailBelow
                      ) {
                        return max(best, sphereBound) * params.finalSigmaMin;
                      }
                    }
                    if (kind == 3u) {
                      b += 26u;
                    }
                    continue;
                  }
                  let invR2 = 1.0 / (ru * ru);
                  v = u * invR2;
                  sfSigma = ru;
                  sfRd = max(max(1.0 - ru, ru - 2.0), 0.0);
                }${stage2SphereRescale}
                if (kind == 3u) {
                  pre0 = v;
                  pre1 = 2.0 - v;
                  pre2 = -2.0 - v;
                  dUp = max(v - 1.0, vec3f(0.0));
                  dDn = max(-1.0 - v, vec3f(0.0));
                }
              }
              var pre: vec3f;
              if (kind == 2u) {
                pre = v;
                branchRd = sfRd;
              } else {
                // Box branch decode: per-axis preimage selectors, x
                // fastest (b = selX + 3*selY + 9*selZ).
                var bb = b;
                if (kind == 3u) {
                  bb = b % 27u;
                }
                let selX = bb % 3u;
                let selY = (bb / 3u) % 3u;
                let selZ = bb / 9u;
                pre = vec3f(
                  select(select(pre2.x, pre1.x, selX == 1u), pre0.x, selX == 0u),
                  select(select(pre2.y, pre1.y, selY == 1u), pre0.y, selY == 0u),
                  select(select(pre2.z, pre1.z, selZ == 1u), pre0.z, selZ == 0u),
                );
                let dd = vec3f(
                  select(
                    select(dDn.x, dUp.x, selX == 1u),
                    max(dUp.x, dDn.x),
                    selX == 0u,
                  ),
                  select(
                    select(dDn.y, dUp.y, selY == 1u),
                    max(dUp.y, dDn.y),
                    selY == 0u,
                  ),
                  select(
                    select(dDn.z, dUp.z, selZ == 1u),
                    max(dUp.z, dDn.z),
                    selZ == 0u,
                  ),
                );
                let boxRd = length(dd);
                if (kind == 1u) {
                  branchRd = boxRd;
                } else {
                  branchRd = max(sfRd, sfSigma * boxRd);
                }
              }
              if (branchRd > 0.0) {
                candFloor = max(candFloor, pScale * absW * branchRd);
              }
              // Floor-vs-best prune: the subtree's every fold is >= its
              // floor, which already cannot advance the min.
              if (candFloor > 0.0 && candFloor >= best) {
                continue;
              }${stage2FoldSkip}
              img = mapApply(m, pre);
              branchSigma = m.p0.z * sfSigma;
            }
            let r = length(img - params.boundCenter);
            let childScale = pScale * branchSigma;
            var key = pScale * (r - R);
            if (candFloor > 0.0 && candFloor > key) {
              key = candFloor;
            }
            var cert = childScale * (r - R);
            if (candFloor > 0.0 && candFloor > cert) {
              cert = candFloor;
            }
            // Past the escape radius deeper refinement cannot improve
            // the min: fold the (floor-raised) certificate plain.
            if (r > params.escapeRadius) {
              if (cert < best) {
                best = cert;
                if (
                  best <= sphereBound ||
                  best * params.finalSigmaMin < bailBelow
                ) {
                  return max(best, sphereBound) * params.finalSigmaMin;
                }
              }
              continue;
            }
            // Frontier insertion: unsorted storage, worst-slot replace
            // (the oracle's structure, term for term). Whatever leaves
            // the kept set folds plain: escaped tuples their
            // (floor-raised) certificate, in-sphere tuples their floor.
            var evR = 0.0;
            var evCert = 0.0;
            var evFloor = 0.0;
            var evHas = false;
            if (keptCount == ${W} && key >= fnWorstKey) {
              evR = r;
              evCert = cert;
              evFloor = candFloor;
              evHas = true;
            } else {
              var slot = keptCount;
              if (keptCount == ${W}) {
                slot = fnWorstIdx;
                evR = fnR[frontierIx(slot, li)];
                evCert = fnCert[frontierIx(slot, li)];
                evFloor = fnFloor[frontierIx(slot, li)];
                evHas = true;
              } else {
                keptCount++;
              }
              fnKey[frontierIx(slot, li)] = key;
              fnX[frontierIx(slot, li)] = img.x;
              fnY[frontierIx(slot, li)] = img.y;
              fnZ[frontierIx(slot, li)] = img.z;
              fnScale[frontierIx(slot, li)] = childScale;
              fnFloor[frontierIx(slot, li)] = candFloor;
              fnR[frontierIx(slot, li)] = r;
              fnCert[frontierIx(slot, li)] = cert;
              // Recompute the worst kept key once the frontier is full
              // — a fixed-bound scan of reads, first max wins.
              if (keptCount == ${W}) {
                fnWorstKey = -1e30;
                fnWorstIdx = 0u;
                for (var s2 = 0u; s2 < ${W}; s2++) {
                  if (fnKey[frontierIx(s2, li)] > fnWorstKey) {
                    fnWorstKey = fnKey[frontierIx(s2, li)];
                    fnWorstIdx = s2;
                  }
                }
              }
            }
            if (evHas) {
              if (evR > R) {
                if (evCert < best) {
                  best = evCert;
                  if (
                    best <= sphereBound ||
                    best * params.finalSigmaMin < bailBelow
                  ) {
                    return max(best, sphereBound) * params.finalSigmaMin;
                  }
                }
              } else if (evFloor > 0.0 && evFloor < best) {
                best = evFloor;
                if (
                  best <= sphereBound ||
                  best * params.finalSigmaMin < bailBelow
                ) {
                  return max(best, sphereBound) * params.finalSigmaMin;
                }
              }
            }
          }
        }
      }
    }
    // The kept tuples become the next frontier (key/cert are selection
    // artifacts; the chains carry point, scale, floor and radius).
    for (var i2 = 0u; i2 < keptCount; i2++) {
      fcX[frontierIx(i2, li)] = fnX[frontierIx(i2, li)];
      fcY[frontierIx(i2, li)] = fnY[frontierIx(i2, li)];
      fcZ[frontierIx(i2, li)] = fnZ[frontierIx(i2, li)];
      fcScale[frontierIx(i2, li)] = fnScale[frontierIx(i2, li)];
      fcFloor[frontierIx(i2, li)] = fnFloor[frontierIx(i2, li)];
      fcR[frontierIx(i2, li)] = fnR[frontierIx(i2, li)];
    }
    chainCount = keptCount;
  }
  // Floor-raised KIFS terminals for every chain alive at the depth cap.
  for (var cc = 0u; cc < chainCount; cc++) {
    var terminal = fcScale[frontierIx(cc, li)] * (fcR[frontierIx(cc, li)] - R);
    let tFloor = fcFloor[frontierIx(cc, li)];
    if (tFloor > 0.0 && tFloor > terminal) {
      terminal = tFloor;
    }
    best = min(best, terminal);
  }
  return max(best, sphereBound) * params.finalSigmaMin;
}
${entry}
`;
}
