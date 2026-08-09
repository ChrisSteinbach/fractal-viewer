import {
  ESCAPE_STEP_SCALE,
  ESCAPE_TIME_ITERATIONS,
  type EscapeDE,
} from "./escape-de";
import {
  FOOTPRINT_DEPTH_FLOOR,
  SPHEREFOLD_MID_MIN_R,
  SYM_PLANE_CODE,
  type SurfaceDE,
} from "./surface-de";
import type { SurfaceDE4 } from "./surface-de-4d";
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
 * FOUR KERNEL CORES (`core`; fr-55s1 stage A added the second, fr-dlxh
 * the third and — its 4D cut — the fourth). Which estimator a system is
 * entitled to is decided exactly as on the CPU — its BASE maps for the
 * two 3D descents, the escape gate for the forward loop, the 4D gate
 * (`analyzeSurfaceSystem4`) for the 4D ladder:
 *
 * - `core: "fold"` (the default, and every config that predates fr-55s1)
 *   emits the width-`width` fold frontier above — `descendFold` refine=
 *   false, the estimator the fold GLSL marches.
 * - `core: "affine"` emits the width-4 REFINED ladder instead: A/B beam
 *   chains plus fr-jkpn's V1/V2 validity slots, with fr-1z6p's
 *   `refinedCert` on every escaped sibling — `surface-de.ts`'s `descend`
 *   refine=TRUE, i.e. {@link estimateDistanceRefined}, which is what
 *   `surface-material.ts`'s affine arm (its `#else` body, the f32
 *   formulation this port follows line for line) marches. Reusing the
 *   fold frontier for affine maps would NOT be the same estimator (width
 *   12 vs the ladder's 4, no refinement), so a second body is the only
 *   shape that keeps the term-for-term discipline.
 * - `core: "escape"` (fr-dlxh) is not a descent at all: it emits
 *   `escape-de.ts`'s {@link estimateEscapeDistance} — the FORWARD fold
 *   orbit with the Buddhi/Rrrola scalar derivative, `DE = |v| / dr` —
 *   in the `SURFACE_ESCAPE` GLSL arm's f32 formulation, for exactly the
 *   systems `analyzeEscapeSystem` admits (single non-contracting pure
 *   fold; the IFS gate's complement). The one forward map rides the
 *   208..271 VARIANT block of the params uniform ({@link
 *   packEscapeGpuParams}); the maps storage binding is NOT DECLARED
 *   (a statically-unused binding would drop out of the auto layout
 *   anyway — hosts must skip buffer 1), `width`/`sharedFrontier`/
 *   `bnbStage2`/`shadeDeWidth` are all inert (no frontier, no branch
 *   fan, no probe — the GLSL arm's shape), `maxDepth` is the orbit's
 *   iteration budget (`ESCAPE_TIME_ITERATIONS` full, preview-clamped
 *   through the same `run.maxDepth` override the descents use), and a
 *   fold-final `lens` THROWS (the escape gate refuses final
 *   transforms; nothing pins that shape).
 * - `core: "affine4"` (fr-dlxh's 4D cut) is the affine ladder ONE
 *   DIMENSION UP: `surface-de-4d.ts`'s `estimateDistance4Refined` — the
 *   width-4 refined beam with fr-jkpn's validity slots over 4×4+t
 *   inverse maps — for the systems `analyzeSurfaceSystem4` admits, i.e.
 *   the estimator `surface-material-4d.ts` marches. The public
 *   signature stays `surfaceDE(pIn: vec3f, …)`: the VIEW LIFT lives in
 *   the body's own prologue (`q = rotorInv · vec4f(pIn, w0)`, the GLSL
 *   tracer's uInvRotor line), the fr-wa6o slab rides a per-chain
 *   half-extent vec4f seeded from rotorInv's w column × sliceHalfW, and
 *   the kaleidoscope sweeps ONE backward-step 4×4 (fr-u91x) instead of
 *   the 3D (cos, sin) pair. Pack with {@link packSurface4GpuParams}
 *   (the 208.. tail IS this core's variant block — rotor, sector step,
 *   4D final lens, w0/sliceHalfW — and `visibleRadius` packs the
 *   SLICE-ADJUSTED sliceVisR so the shared march entry's sphere gate is
 *   the 4D GLSL's, textually unchanged) and {@link packSurfaceGpuMaps4}
 *   (binding 1 is `array<GpuMap4>` here). Same inert options as
 *   "affine" (the ladder is fixed at the oracle's `beamWidth` 4; no
 *   frontier, no probe), `footprint` THROWS at pack (the 4D oracle has
 *   no cone-footprint cap; hosts pass 0), and a fold-final `lens`
 *   THROWS (4D fold finals are fr-rsp6's scope).
 *
 * All three bodies share the public signature — `surfaceDE(pIn, cutoff,
 * li)` — so the mode entry points below are textually identical
 * whichever core is picked. The two DESCENT cores additionally share the
 * descent PROLOGUE text (lens, sphere bound, bail threshold, fr-3c0k
 * depth cap) for the same reason `renameToProbe` exists: one text cannot
 * drift from itself. (The escape core deliberately has NO prologue —
 * those are inverse-descent concepts, and its GLSL arm replaces the
 * descent bodies wholesale.) `core: "affine"` IGNORES `width` (the
 * ladder is fixed at the oracle's production `beamWidth` 4),
 * `sharedFrontier` and `bnbStage2` (the unrolled ladder has no frontier
 * arrays and no fold branches to bound), and it declares no workgroup
 * storage ({@link surfaceGpuWorkgroupBytes} returns 0). fr-55s1 stage A
 * shipped it eval/march-only with a shade throw; stage C replaced the
 * throw with the affine hit-info descent below, so every mode serves
 * every core today.
 *
 * THE FOLD-LENS WRAPPER (`lens`, fr-55s1 stage B) lifts `descendLens` —
 * the CPU route for `foldFinal` systems (fr-g58b) — over EITHER core.
 * The chosen descent body is emitted with its declaration token-renamed
 * `fn surfaceDE(` → `fn surfaceDECore(` — {@link renameToProbe}'s
 * mechanism playing `surface-material.ts`'s `#define surfaceDE
 * surfaceDECore` move; neither body calls itself, so the declaration
 * site is the whole rename — and a new `surfaceDE` wrapper emitted
 * after it owns the public signature, so the mode entries' call sites
 * stay textually untouched. The wrapper enumerates the lens fold's
 * inverse branches (27 boxfold / 3 spherefold / 81 mandelbox — kind and
 * count are RUNTIME uniform reads, like the fold body's per-map kind
 * switch: one pipeline per session, the GLSL variant's shape) and seeds
 * one core descent per surviving branch; the region-floor prune, sphere-
 * certificate prune, visible-sphere pin, spherefold shell guard (with
 * the mandelbox `b += 26` box-expansion skip) and the
 * `min(best, cutoff) / factor` inner-cutoff contract are the oracle's,
 * value-exact, term for term — `SURFACE_FOLD_LENS`'s GLSL sweep is the
 * f32 formulation reference. The cores run their no-lens path verbatim:
 * `de.final` is null whenever `de.foldFinal` is set, so the packer's
 * identity-final fallback and `finalSigmaMin` 1 hold automatically, and
 * the REAL lens rides the appended params block below. Which core a
 * lens system wraps follows its BASE maps (`deHasFolds`), exactly the
 * CPU's inner routing — lens-over-affine mirrors
 * {@link estimateDistanceRefined} and lens-over-fold mirrors
 * {@link estimateDistance}, each still "the estimator the GLSL marches"
 * for its class. `lens: false` (and absent) generates byte-identical
 * source to the pre-lens generator for every config.
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
 * MARCH RAY DERIVATION (`rays`, march mode only): `"pose"` (default)
 * keeps the bench baseline — NDC pixel centers against the pose basis,
 * byte-identical output to the pre-shade-split generator. `"unproject"`
 * derives rays the GLSL tracer's way — near/far clip points through
 * `shade.invProjView` (ShadeParams binds at 4 in this variant), with
 * `params.ro` doubling as uCamPos and the pose basis fields
 * (right/up/fwd/tanHalf/aspect) IGNORED — plus the tracer's march-start
 * hash dither (flags bit0; off for agreement runs). That is the app
 * path, where inset/centered-projection parity matters. Either way the
 * march writes RAY STATES ONLY, never pixels.
 *
 * SHADE MODE (`shadeRays`, fr-tzdg) is the split's other half: one
 * dispatch over a host-compacted list of TERMINAL rays (status HIT /
 * MISS / EXHAUSTED; `itemCount` is the BATCH length, not the frame's ray
 * count). Misses and exhausted rays write the background gradient; hits
 * recompute the unproject + sphere gate for the fog origin and run the
 * full `surface-material.ts` `main()` shade — greedy width-1 hit-info
 * descent (the fold shading overload's colors), tetrahedron normal,
 * soft shadow, AO, linear-space lighting, depth fog — term for term.
 * Shading is the EXPENSIVE half (hit-info descent + 4 normal + up-to-32
 * shadow + 5 AO `surfaceDE` calls, all at on-surface positions): the
 * earlier march+shade megakernel rode it on whichever march pass a ray
 * terminated in, so a mass-hit pass became one unbounded submission —
 * measured 1.1-5.3 s per pass and LOST THE DEVICE at full depth/budgets
 * (the i915 ~7.5 s watchdog, fr-096u's failure class). Separate entry
 * points let the HOST size shade batches, so every shading submission is
 * bounded — the fr-096u lesson applied to shading, not just marching.
 *
 * SHADE PROBE WIDTH (`shadeDeWidth`, fr-p8bc): those on-surface probe
 * evals dominate END-TO-END fold frame cost (the fr-tzdg landing
 * verdict), yet normal/shadow/AO are QUALITATIVE effects — they light a
 * hit the full-width march already certified, never decide geometry. In
 * shade mode, `shadeDeWidth` (when set and ≠ `width`) emits a second
 * descent `surfaceDEProbe` at that frontier width — the identical body
 * derived from the same template by token rename, so the two descents
 * cannot drift; width 1 is the old greedy descent, `surface-de.ts`'s
 * kept-for-tests vocabulary — and the probe taps call it while the
 * hit-info descent (already greedy width-1) and every other mode stay
 * untouched. The probe frontier is ALWAYS function-scope private arrays
 * regardless of `sharedFrontier`: narrow arrays are registers, which is
 * the point, and workgroup budgets stay a main-descent-only concern
 * ({@link surfaceGpuWorkgroupBytes} is unchanged). Absent or equal to
 * `width`, the generated source is byte-identical to the pre-fr-p8bc
 * generator. Quality/timing A/B lives in `src/app/gpu-bench/`'s shade
 * A/B leg, images + march/shade split, since no CPU shading oracle
 * exists to pin against.
 *
 * Scope: BASE fold/affine maps + kaleidoscope sector sweep + affine
 * final lens; and, since fr-55s1 stage B, the FOLD final lens — `lens:
 * true` wraps either core in `descendLens`'s branch sweep (THE
 * FOLD-LENS WRAPPER above), with the lens fields appended to the params
 * uniform. Footprint under a lens stays out ({@link
 * packSurfaceGpuParams} throws — the app path always passes 0). Stage C
 * finished the shade half: a per-core hit-info descent (the affine one
 * ports its GLSL twin's TRAJECTORY, colors only — the value side never
 * steers the ladder), and under the lens the hit-info renames to
 * `surfaceDEHitInfoCore` behind an argmin-sweep wrapper while the probe
 * (fold core only — the affine core ignores `shadeDeWidth`, like its
 * GLSL arm) gets the same sweep text renamed onto `surfaceDEProbeCore`.
 * Modes "eval" and "march" (rays "pose") are the fr-q1f8
 * bench baselines (`src/app/gpu-bench/` pins them) and their generated
 * source is unchanged by the shade split; march rays "unproject" plus
 * mode "shade" are the GLSL tracer's mirror halves for the app
 * integration program (fr-tzdg).
 *
 * BYTE LAYOUT CONTRACT (pinned by surface-de-gpu.test.ts):
 *
 * Params uniform — {@link SURFACE_GPU_PARAMS_BYTES} = 272 bytes:
 *   offset  0  vec3f boundCenter          12  f32 boundingRadius
 *          16  f32  escapeRadius          20  f32 stepScale
 *          24  f32  visibleRadius         28  f32 slowestSigma
 *          32  f32  stepCos               36  f32 stepSin
 *          40  u32  symOrder              44  u32 symPlane (0=yz,1=xz,2=xy)
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
 *         208..271 — the VARIANT block, keyed on the kernel config
 *              (mutually exclusive by construction; zeros when neither
 *              variant is active, and the plain kernels' Params struct
 *              still ends at 208 — binding the larger buffer is valid,
 *              a struct never reads past its own size):
 *          · `lens: true` (fr-55s1 stage B):
 *              208 vec3f lensM row0   220 f32 lensT.x
 *              224 vec3f lensM row1   236 f32 lensT.y
 *              240 vec3f lensM row2   252 f32 lensT.z
 *              256 vec4f lensParams — (foldKind as f32, invW, absW,
 *                  sigmaMin), the GLSL `uLensParams` order.
 *          · `core: "escape"` (fr-dlxh) — the FORWARD map in the same
 *              interleave:
 *              208 vec3f escM row0    220 f32 escT.x
 *              224 vec3f escM row1    236 f32 escT.y
 *              240 vec3f escM row2    252 f32 escT.z
 *              256 vec4f escParams — (foldKind as f32, w, derivGrowth,
 *                  0), the GLSL `uEscParams` order plus the packed-zero
 *                  spare.
 *          · `core: "affine4"` (fr-dlxh's 4D cut) — the variant block
 *              GROWS: {@link SURFACE_GPU_PARAMS4_BYTES} = 432 bytes
 *              total. Every matrix is four row-vec4s holding the
 *              ROW-MAJOR bytes of the matrix the body APPLIES
 *              (`dot(rowN, v)` — no column-major reasoning anywhere;
 *              the packer performs the one real transpose, pose rotor →
 *              world-to-attractor, exactly `setSurfaceView4`'s dance):
 *              208 vec4f rotorInv row0..row3   (..271)
 *              272 vec4f stepBack4 row0..row3  (..335)
 *              336 vec4f final4M row0..row3    (..399) — identity when
 *                  no final, like the 3D finalM rows
 *              400 vec4f final4T
 *              416 f32 w0             420 f32 sliceHalfW
 *              424 f32 final4SigmaMin 428 f32 (pad)
 *              In this core the frozen block's `visibleRadius` carries
 *              the SLICE-ADJUSTED sliceVisR (the slab's widest 3D
 *              shadow, surface-material-4d.ts's march gate) and
 *              `boundCenter` packs the origin (the 4D oracle is
 *              origin-anchored by construction).
 *
 * Maps storage — {@link SURFACE_GPU_MAP_VEC4} vec4f per map ({@link
 * SURFACE_GPU_MAP_STRIDE_BYTES} bytes), matching WGSL `struct GpuMap`:
 *   r0  = invM row0 xyz, invT.x        r1 = invM row1 xyz, invT.y
 *   r2  = invM row2 xyz, invT.z
 *   p0  = sigmaMin, foldInvW, foldSigma, foldKind (0/1/2/3 as f32)
 *   bnb = bnbDir xyz, invTNorm
 *   p1  = invMSigmaMin, 0, 0, 0
 *
 * 4D maps storage (`core: "affine4"`) — {@link SURFACE_GPU_MAP4_VEC4}
 * vec4f per map (the same 96-byte stride by arithmetic coincidence),
 * matching WGSL `struct GpuMap4`:
 *   r0..r3 = invM rows 0..3 (row-major)    t = invT
 *   p0     = sigmaMin, 0, 0, 0
 *
 * March state — one vec4f per ray: (t, status, steps, lastD), host-
 * initialized to `(-1, 0, 0, 0)`; `t < 0` means the sphere gate has not
 * run yet. Status vocabulary: {@link SURFACE_GPU_RAY_ACTIVE} /
 * `_HIT` / `_MISS` / `_EXHAUSTED`.
 *
 * Shade uniform (march "unproject" + mode "shade") — {@link
 * SURFACE_GPU_SHADE_BYTES} = 128 bytes, WGSL `struct ShadeParams`:
 *   offset 0..63 mat4x4f invProjView (column-major, the exact
 *                THREE.Matrix4.elements scene.ts uploads as uInvProjView)
 *          64  vec3f lightDir          76  f32 ambient
 *          80  vec3f bgTop             92  f32 colorSpeed
 *          96  vec3f bgBottom         108  f32 tracePixelEps
 *         112  u32  colorSource       116  u32 shadowSteps
 *         120  u32  aoTaps            124  u32 flags (bit0 = dither)
 *
 * Shade maps storage (mode "shade") — one vec4f per map slot:
 * (uMapColor rgb, uFoldParams.w trapIndex); one zero stride when empty,
 * like {@link packSurfaceGpuMaps}.
 *
 * Bindings per mode — eval and march "pose" bind 0-3 (params, maps, the
 * mode's own pair at 2/3); march "unproject" binds 0-4, the march set
 * plus shade: ShadeParams (rays + dither inputs only — it declares none
 * of shadeMaps/colorOut/lutTex/lutSamp); mode "shade" binds 0-8. The
 * ESCAPE core never declares binding 1 (maps) in any mode — its one
 * forward map rides the params variant block — so escape hosts skip
 * that buffer; the AFFINE4 core declares binding 1 as
 * `array<GpuMap4>` (pack with {@link packSurfaceGpuMaps4}); every
 * other binding is identical. Mode "shade" binds:
 *   @binding(4) var<uniform> shade: ShadeParams
 *   @binding(5) var<storage, read> shadeMaps: array<vec4f>
 *   @binding(6) var<storage, read_write> colorOut: array<u32> — one RGBA8
 *               pixel per ray via pack4x8unorm (x lands in byte 0, so a
 *               readback Uint8Array is RGBA order). The HOST MUST PRE-FILL
 *               the buffer with the background: a ray still ACTIVE at
 *               frame abort is never queued into a shade batch, writes
 *               nothing, and keeps the prefill.
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

export const SURFACE_GPU_PARAMS_BYTES = 272;
/** Params size for `core: "affine4"` — the frozen 0..207 block plus the
 * 4D variant tail (layout contract in the module doc). The other cores'
 * structs still end at 208/272; binding the larger buffer to them would
 * be valid, but hosts size per core. */
export const SURFACE_GPU_PARAMS4_BYTES = 432;
export const SURFACE_GPU_MAP_VEC4 = 6;
export const SURFACE_GPU_MAP_STRIDE_BYTES = SURFACE_GPU_MAP_VEC4 * 16;
/** vec4f slots per 4D map (`struct GpuMap4`) — the same stride as the 3D
 * GpuMap by arithmetic coincidence (3+1+2 = 4+1+1), so shared host
 * sizing math keeps working; the field layout is its own contract. */
export const SURFACE_GPU_MAP4_VEC4 = 6;
/** Byte size of the ShadeParams uniform (march "unproject" + mode
 * "shade"; layout contract in the module doc). */
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
  mode: "eval" | "march" | "shade";
  /** Which CORE BODY to emit (fr-55s1; fr-dlxh; module doc). "fold" (the
   * default, and every pre-fr-55s1 config's byte-identical source) is the
   * width-`width` fold frontier mirroring `estimateDistance`; "affine" is
   * the fixed width-4 refined ladder mirroring `estimateDistanceRefined`
   * — the estimator a FOLD-FREE base map set is entitled to. Pick between
   * those two the way the CPU does, off `deHasFolds(de)`. Under "affine"
   * the `width`, `sharedFrontier`, `bnbStage2` and `shadeDeWidth` options
   * are all inert (the ladder has one width and no branch fan to cheapen
   * — the GLSL affine arm carries no probe either). "escape" (fr-dlxh)
   * is the forward escape-time loop mirroring `estimateEscapeDistance`
   * for `analyzeEscapeSystem` systems — pack with
   * {@link packEscapeGpuParams}, skip the maps buffer (binding 1 is not
   * declared), same inert options as "affine", and `lens` throws.
   * "affine4" (fr-dlxh's 4D cut) is the refined ladder ONE DIMENSION UP
   * — `surface-de-4d.ts`'s `estimateDistance4Refined` behind the view
   * lift (rotor + w0 + fr-wa6o slab) — for `analyzeSurfaceSystem4`
   * systems: pack with {@link packSurface4GpuParams} +
   * {@link packSurfaceGpuMaps4} (binding 1 is `array<GpuMap4>`), same
   * inert options as "affine", `lens` throws (4D fold finals are
   * fr-rsp6's scope) and a nonzero `footprint` throws at pack. */
  core?: "fold" | "affine" | "escape" | "affine4";
  /** Emit the FOLD FINAL-transform lens wrapper (fr-55s1 stage B —
   * `descendLens`, fr-g58b's vocabulary): the descent body (either core)
   * is renamed `surfaceDECore` and a new `surfaceDE` sweeps the lens's
   * inverse fold branches around it, each an affine-lensed core descent
   * — so the mode entries' call sites are untouched text. Absent or
   * false reproduces the no-lens source byte for byte. Branch kind and
   * count are RUNTIME params (one pipeline per session, GLSL parity).
   * In shade mode the hit-info descent gets the same treatment (renamed
   * core + argmin-sweep wrapper) and the probe, when emitted, its own
   * renamed sweep — fr-55s1 stage C. */
  lens?: boolean;
  /** March-mode ray derivation. "pose" (default) keeps the bench baseline:
   * NDC pixel centers against the pose basis — byte-identical output to
   * the pre-shade-split generator. "unproject" derives rays the GLSL
   * tracer's way (near/far clip points through shade.invProjView, with
   * params.ro as uCamPos) and adds the flag-gated march-start hash dither
   * — the app path, where inset/centered-projection parity matters.
   * Ignored outside march mode. */
  rays?: "pose" | "unproject";
  /** Frontier width — `SURFACE_FOLD_BEAM_WIDTH` for production parity;
   * the bench sweeps 12/8/6/4 to reproduce fr-ck0w's width curve.
   * IGNORED under `core: "affine"`, whose ladder is fixed at 4 (still
   * validated, so a bad value is caught wherever it came from). */
  width: number;
  /** Shade-mode only: frontier width for the shading PROBE evals — the
   * normal/shadow/AO taps in `shadeRays` (fr-p8bc; module doc). When set
   * and ≠ `width`, a second descent `surfaceDEProbe` is emitted at this
   * width (always private frontier arrays) and the probe taps call it.
   * Absent or equal to `width` reproduces the pre-fr-p8bc source byte
   * for byte. Ignored outside shade mode. */
  shadeDeWidth?: number;
  /** Threads per workgroup. */
  workgroupSize: number;
  /** Workgroup-shared (banked, transposed) frontier vs private arrays.
   * Inert under `core: "affine"` — the unrolled ladder keeps its four
   * chains in scalars, so there is no frontier to place. */
  sharedFrontier: boolean;
  /** Include the fr-kidj stage-2 branch-and-bound skips (value no-ops).
   * Inert under `core: "affine"` — the skips bound FOLD branch
   * enumeration, and the affine ladder enumerates none. */
  bnbStage2: boolean;
}

/** Workgroup shared-memory bytes the generated kernel declares — what the
 * bench must cover via `maxComputeWorkgroupStorageSize` when it exceeds
 * the 16 384-byte WebGPU default. Zero for the private variant, and zero
 * for every non-fold core at any `sharedFrontier` (the affine ladder
 * declares no frontier arrays at all — fr-55s1 — and the escape loop has
 * no frontier concept to begin with — fr-dlxh). */
export function surfaceGpuWorkgroupBytes(
  opts: Pick<
    SurfaceGpuKernelOptions,
    "width" | "workgroupSize" | "sharedFrontier" | "core"
  >,
): number {
  if (!opts.sharedFrontier || (opts.core ?? "fold") !== "fold") return 0;
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
 * Pack the params uniform for one dispatch. An absent affine final lens
 * packs as the identity, exactly like `setSurfaceSystem`; a `foldFinal`
 * lens fills the 208..271 block (fr-55s1 stage B) — and the cores' own
 * final slots still pack IDENTITY/1, because `buildSurfaceDE` keeps
 * `final` null whenever `foldFinal` is set: the cores run their no-lens
 * path verbatim and the wrapper alone applies the lens. Throws when a
 * footprint is combined with the lens: `descendLens` scales the
 * footprint per branch (`footprint / factor`), which would need a core
 * signature change — out of the fr-55s1 cut, and the app path always
 * passes footprint 0 (GLSL parity).
 */
export function packSurfaceGpuParams(
  de: SurfaceDE,
  run: SurfaceGpuRunParams,
): ArrayBuffer {
  if (de.foldFinal && de.final) {
    // buildSurfaceDE's invariant (surface-de.ts, `final` doc): the two
    // lens shapes are mutually exclusive, and the identity-final packing
    // below leans on it. Only a hand-built SurfaceDE can get here — loud
    // beats packing a shape no oracle or shader was ever pinned on.
    throw new Error("surface-de-gpu: foldFinal and final are exclusive");
  }
  if (de.foldFinal && (run.footprint ?? 0) > 0) {
    throw new Error(
      "surface-de-gpu: footprint under a foldFinal lens is out of the " +
        "fr-55s1 cut (per-branch innerFootprint needs a core signature " +
        "change; the app path always passes 0)",
    );
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
  view.setUint32(44, SYM_PLANE_CODE[de.symmetry.plane], true);
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
  // fr-55s1 stage B: the fold-lens block (zeros when no foldFinal — the
  // no-lens kernel's struct ends at 208 and never reads past it). Same
  // vec3f+f32 interleave as the finalM rows above; the tail vec4f is the
  // GLSL `uLensParams` order (kind, invW, absW, sigmaMin), so the
  // wrapper reads like its mirror line for line.
  const lens = de.foldFinal;
  if (lens) {
    writeVec3(view, 208, [lens.invM[0], lens.invM[1], lens.invM[2]]);
    view.setFloat32(220, lens.invT[0], true);
    writeVec3(view, 224, [lens.invM[3], lens.invM[4], lens.invM[5]]);
    view.setFloat32(236, lens.invT[1], true);
    writeVec3(view, 240, [lens.invM[6], lens.invM[7], lens.invM[8]]);
    view.setFloat32(252, lens.invT[2], true);
    view.setFloat32(256, lens.foldKind, true);
    view.setFloat32(260, lens.invW, true);
    view.setFloat32(264, lens.absW, true);
    view.setFloat32(268, lens.sigmaMin, true);
  }
  return buf;
}

/**
 * Pack the params uniform for the ESCAPE core (fr-dlxh). The frozen
 * offsets carry the escape session's marching quantities — the bailout
 * ball is both bounding and visible sphere, {@link ESCAPE_STEP_SCALE}
 * damps steps (the GLSL variant's `uStepScale`), and `maxDepth` is the
 * orbit's iteration budget ({@link ESCAPE_TIME_ITERATIONS} full,
 * preview-clamped by `run.maxDepth`) — and the 208..271 VARIANT block
 * carries the FORWARD map in the lens rows' interleave, tail vec4f in
 * the GLSL `uEscParams` order (foldKind, w, derivGrowth, 0). Symmetry
 * packs OFF and the final packs identity/1 (the escape gate refuses
 * both); `escapeRadius` packs the GLSL's dead `2R` so the wire never
 * carries an uninitialized word; `footprint` packs 0 — a forward loop
 * has no cone-footprint depth cap. The maps storage binding does not
 * exist in escape kernels, so there is no escape `packSurfaceGpuMaps`
 * twin.
 */
export function packEscapeGpuParams(
  de: EscapeDE,
  run: SurfaceGpuRunParams,
): ArrayBuffer {
  const buf = new ArrayBuffer(SURFACE_GPU_PARAMS_BYTES);
  const view = new DataView(buf);
  view.setFloat32(12, de.boundingRadius, true);
  view.setFloat32(16, de.boundingRadius * 2, true);
  view.setFloat32(20, ESCAPE_STEP_SCALE, true);
  view.setFloat32(24, de.boundingRadius, true);
  view.setFloat32(28, 1, true);
  view.setFloat32(32, 1, true);
  view.setUint32(40, 1, true);
  view.setUint32(44, 1, true);
  view.setUint32(48, 1, true);
  view.setUint32(52, run.maxDepth ?? ESCAPE_TIME_ITERATIONS, true);
  view.setUint32(56, run.itemCount, true);
  view.setUint32(60, run.stepsThisPass ?? 0, true);
  view.setFloat32(64, run.cutoff ?? 0, true);
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
  writeVec3(view, 96, [1, 0, 0]);
  writeVec3(view, 112, [0, 1, 0]);
  writeVec3(view, 128, [0, 0, 1]);
  writeVec3(view, 144, pose?.ro ?? [0, 0, 0]);
  view.setFloat32(156, 1, true);
  writeVec3(view, 160, pose?.right ?? [1, 0, 0]);
  view.setFloat32(172, pose?.tanHalf ?? 0, true);
  writeVec3(view, 176, pose?.up ?? [0, 1, 0]);
  view.setFloat32(188, pose?.aspect ?? 1, true);
  writeVec3(view, 192, pose?.fwd ?? [0, 0, 1]);
  writeVec3(view, 208, [de.m[0], de.m[1], de.m[2]]);
  view.setFloat32(220, de.t[0], true);
  writeVec3(view, 224, [de.m[3], de.m[4], de.m[5]]);
  view.setFloat32(236, de.t[1], true);
  writeVec3(view, 240, [de.m[6], de.m[7], de.m[8]]);
  view.setFloat32(252, de.t[2], true);
  view.setFloat32(256, de.foldKind, true);
  view.setFloat32(260, de.w, true);
  view.setFloat32(264, de.derivGrowth, true);
  return buf;
}

/** Per-frame 4D view for `core: "affine4"` — the same (rotor, w0,
 * sliceHalfW) triple `setSurfaceView4` receives: `rotor` is the
 * ROW-MAJOR pose rotor (`fourDView.matrix()`'s output), and the packer
 * stores its TRANSPOSE — the world→attractor rotation the body applies
 * — as the rotorInv rows (the exact `setSurfaceView4` dance); `w0` and
 * `sliceHalfW` are LITERAL world w (scene.ts's `wSupport` conversion,
 * fr-33yb, happens before this seam). */
export interface SurfaceGpu4View {
  rotor: ArrayLike<number>;
  w0: number;
  sliceHalfW: number;
}

/**
 * Pack the params uniform for the AFFINE4 core (fr-dlxh's 4D cut). The
 * frozen block carries the 4D session's marching quantities with two
 * core-specific meanings: `boundCenter` packs the ORIGIN (the 4D oracle
 * is origin-anchored by construction — `buildSurfaceDE4`'s probe) and
 * `visibleRadius` packs the SLICE-ADJUSTED sliceVisR — the slab's
 * widest 3D shadow, `surface-material-4d.ts`'s march gate — so the
 * shared march entry's sphere gate is the 4D GLSL's, textually
 * unchanged; repacked per pass, which is what keeps it live as the
 * rotor/slice move. The 208.. tail is the 4D variant block (layout
 * contract in the module doc): rotorInv/stepBack4/final4M as row-vec4
 * quartets holding the ROW-MAJOR bytes of the matrix the body applies,
 * the affine final lens packing identity/1 when absent (the 3D finalM
 * rows always pack identity here — the 4D lens rides the tail alone).
 * `slowestSigma`/`stepCos` pack benign 1s the body never reads (no
 * footprint cap, no (cos, sin) sector step — the escape packer's
 * never-uninitialized convention), and a nonzero `footprint` THROWS:
 * the 4D oracle takes no footprint argument, and the app path always
 * passes 0.
 */
export function packSurface4GpuParams(
  de: SurfaceDE4,
  view4: SurfaceGpu4View,
  run: SurfaceGpuRunParams,
): ArrayBuffer {
  if ((run.footprint ?? 0) > 0) {
    throw new Error(
      "surface-de-gpu: the affine4 core has no cone-footprint depth cap " +
        "(the 4D oracle takes no footprint argument; hosts pass 0)",
    );
  }
  const buf = new ArrayBuffer(SURFACE_GPU_PARAMS4_BYTES);
  const view = new DataView(buf);
  view.setFloat32(12, de.boundingRadius, true);
  view.setFloat32(16, de.escapeRadius, true);
  view.setFloat32(20, de.stepScale, true);
  const minW = Math.max(Math.abs(view4.w0) - view4.sliceHalfW, 0);
  const visR = de.visibleBoundingRadius;
  view.setFloat32(24, Math.sqrt(Math.max(visR * visR - minW * minW, 0)), true);
  view.setFloat32(28, 1, true);
  view.setFloat32(32, 1, true);
  view.setUint32(40, de.symmetry.order, true);
  view.setUint32(44, 1, true);
  view.setUint32(48, de.maps.length, true);
  view.setUint32(52, run.maxDepth ?? de.maxDepth, true);
  view.setUint32(56, run.itemCount, true);
  view.setUint32(60, run.stepsThisPass ?? 0, true);
  view.setFloat32(64, run.cutoff ?? 0, true);
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
  writeVec3(view, 96, [1, 0, 0]);
  writeVec3(view, 112, [0, 1, 0]);
  writeVec3(view, 128, [0, 0, 1]);
  writeVec3(view, 144, pose?.ro ?? [0, 0, 0]);
  view.setFloat32(156, 1, true);
  writeVec3(view, 160, pose?.right ?? [1, 0, 0]);
  view.setFloat32(172, pose?.tanHalf ?? 0, true);
  writeVec3(view, 176, pose?.up ?? [0, 1, 0]);
  view.setFloat32(188, pose?.aspect ?? 1, true);
  writeVec3(view, 192, pose?.fwd ?? [0, 0, 1]);
  // The 4D variant tail. rotorInv rows are the TRANSPOSE of the
  // row-major pose rotor — row i of Mᵀ is column i of M — the one real
  // transpose in the pipeline; stepBack4 and final4M are applied
  // row-major by the oracle already, so their rows pack sequentially.
  const rot = view4.rotor;
  for (let i = 0; i < 4; i++) {
    const at = 208 + i * 16;
    view.setFloat32(at, rot[i], true);
    view.setFloat32(at + 4, rot[4 + i], true);
    view.setFloat32(at + 8, rot[8 + i], true);
    view.setFloat32(at + 12, rot[12 + i], true);
  }
  const sb = de.symmetry.stepBack;
  for (let i = 0; i < 16; i++) {
    view.setFloat32(272 + i * 4, sb[i], true);
  }
  const f = de.final;
  const fm = f ? f.invM : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (let i = 0; i < 16; i++) {
    view.setFloat32(336 + i * 4, fm[i], true);
  }
  const ft = f ? f.invT : [0, 0, 0, 0];
  view.setFloat32(400, ft[0], true);
  view.setFloat32(404, ft[1], true);
  view.setFloat32(408, ft[2], true);
  view.setFloat32(412, ft[3], true);
  view.setFloat32(416, view4.w0, true);
  view.setFloat32(420, view4.sliceHalfW, true);
  view.setFloat32(424, f ? f.sigmaMin : 1, true);
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

/** Pack the per-map storage array for `core: "affine4"` (layout
 * contract above): invM rows row-major, then invT, then sigmaMin in
 * p0.x. Pads to one zero stride when empty, like
 * {@link packSurfaceGpuMaps}. */
export function packSurfaceGpuMaps4(de: SurfaceDE4): Float32Array {
  const out = new Float32Array(
    de.maps.length * SURFACE_GPU_MAP4_VEC4 * 4 || SURFACE_GPU_MAP4_VEC4 * 4,
  );
  de.maps.forEach((m, j) => {
    const base = j * SURFACE_GPU_MAP4_VEC4 * 4;
    for (let i = 0; i < 16; i++) {
      out[base + i] = m.invM[i];
    }
    out[base + 16] = m.invT[0];
    out[base + 17] = m.invT[1];
    out[base + 18] = m.invT[2];
    out[base + 19] = m.invT[3];
    out[base + 20] = m.sigmaMin;
  });
  return out;
}

/** The GLSL tracer's shading uniforms — bound whole by mode "shade" and,
 * for the ray/dither inputs only (invProjView, tracePixelEps, dither), by
 * march "unproject". `invProjView` is column-major (THREE.Matrix4.elements
 * order), the exact matrix scene.ts uploads as uInvProjView. */
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

/** Pack the ShadeParams uniform (march "unproject" + mode "shade";
 * layout contract in the module doc). flags = dither ? 1 : 0. */
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

/** Per-map shading storage for mode "shade": one vec4f per map slot,
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
  // fr-55s1: which descent body. Absent means "fold", so every config
  // that predates the option generates byte-identical source.
  const core = opts.core ?? "fold";
  // fr-55s1 stage B: absent means no lens, so every no-lens config
  // generates byte-identical source. Shade support for the affine core
  // and the lens (hit-info bodies + probe composition) landed with
  // stage C.
  const lens = opts.lens ?? false;
  if (core === "escape" && lens) {
    // analyzeEscapeSystem refuses final transforms, so no oracle or GLSL
    // arm pins a lensed escape shape — loud beats generating one.
    throw new Error(
      "surface-de-gpu: the escape core cannot take a fold-final lens",
    );
  }
  if (core === "affine4" && lens) {
    // analyzeSurfaceSystem4 blanket-refuses fold finals today — the 4D
    // fold-branch sweep is fr-rsp6's scope — so no oracle pins a lensed
    // 4D shape. Loud beats generating one.
    throw new Error(
      "surface-de-gpu: the affine4 core cannot take a fold-final lens " +
        "(4D fold finals are fr-rsp6's scope)",
    );
  }
  if (!Number.isInteger(width) || width < 1) {
    throw new Error(`surface-de-gpu: bad frontier width ${width}`);
  }
  if (
    opts.shadeDeWidth !== undefined &&
    (!Number.isInteger(opts.shadeDeWidth) || opts.shadeDeWidth < 1)
  ) {
    throw new Error(
      `surface-de-gpu: bad shade probe width ${opts.shadeDeWidth}`,
    );
  }
  if (!Number.isInteger(workgroupSize) || workgroupSize < 1) {
    throw new Error(`surface-de-gpu: bad workgroup size ${workgroupSize}`);
  }
  // fr-p8bc: an active probe width means shade mode's normal/shadow/AO
  // taps call a second, narrower descent (module doc). Equal widths stay
  // a single descent so the "off" state is byte-identical source. The
  // AFFINE core ignores it (fr-55s1 stage C): its ladder has one width
  // and no branch fan to cheapen — the GLSL affine arm carries no probe
  // either — so the taps ride the full descent there.
  const probeWidth =
    core === "fold" &&
    mode === "shade" &&
    opts.shadeDeWidth !== undefined &&
    opts.shadeDeWidth !== width
      ? opts.shadeDeWidth
      : null;
  const probeDe = probeWidth === null ? "surfaceDE" : "surfaceDEProbe";
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
  // The fold frontier's storage and its index helper. The non-fold cores
  // declare NEITHER — the affine ladder's four chains live in scalars
  // (fr-55s1) and the escape loop has no frontier concept (fr-dlxh) —
  // which is also why their kernels need no workgroup budget at any
  // `sharedFrontier` ({@link surfaceGpuWorkgroupBytes}).
  const frontierBlock =
    core !== "fold"
      ? ""
      : `
${frontierDecls}

fn frontierIx(slot: u32, li: u32) -> u32 {
  ${ixBody}
}
`;

  // "pose" (the default) keeps the march arm's bench-baseline bytes;
  // "unproject" swaps only the ray derivation + dither (module doc).
  const unproject = mode === "march" && opts.rays === "unproject";
  // march and shade share the ray-state I/O. march "unproject" adds the
  // ShadeParams block (binding 4) it reads rays and dither from — nothing
  // else — plus the hash2 helper; mode "shade" adds the full shading
  // interface on top (bindings 4-8, module doc), no hash2 (no dither).
  const rayIo = `
@group(0) @binding(2) var<storage, read> activeList: array<u32>;
@group(0) @binding(3) var<storage, read_write> states: array<vec4f>;`;
  const shadeParamsIo = `

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

@group(0) @binding(4) var<uniform> shade: ShadeParams;`;
  const hash2Io = `

// Per-pixel march-start dither — surface-material.ts's hash(), fed
// gl_FragCoord.xy parity inputs (pixel centers).
fn hash2(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.5453);
}`;
  const io =
    mode === "eval"
      ? `
@group(0) @binding(2) var<storage, read> queries: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> results: array<f32>;`
      : mode === "march"
        ? unproject
          ? `${rayIo}${shadeParamsIo}${hash2Io}`
          : rayIo
        : `${rayIo}${shadeParamsIo}
@group(0) @binding(5) var<storage, read> shadeMaps: array<vec4f>;
@group(0) @binding(6) var<storage, read_write> colorOut: array<u32>;
@group(0) @binding(7) var lutTex: texture_2d<f32>;
@group(0) @binding(8) var lutSamp: sampler;`;

  // March-arm interpolation points, so the "pose" bench baseline stays
  // byte-identical while "unproject" swaps in the GLSL tracer's ray.
  const marchRd = unproject
    ? `  let ndcX = ((f32(px) + 0.5) / f32(params.rasterWidth)) * 2.0 - 1.0;
  let ndcY = ((f32(py) + 0.5) / f32(params.rasterHeight)) * 2.0 - 1.0;
  // The GLSL tracer's unproject (main(): near/far clip points through
  // uInvProjView); params.ro doubles as uCamPos, and the pose basis
  // right/up/fwd/tanHalf/aspect fields are ignored in this mode.
  let nearP = shade.invProjView * vec4f(ndcX, ndcY, -1.0, 1.0);
  let farP = shade.invProjView * vec4f(ndcX, ndcY, 1.0, 1.0);
  let rd = normalize(farP.xyz / farP.w - nearP.xyz / nearP.w);
  let ro = params.ro;`
    : `  // poseRays mirror (scripts/fold-cost-split.harness.ts): NDC pixel
  // centers against the vertical-fov tangent.
  let ndcX = ((f32(px) + 0.5) / f32(params.rasterWidth)) * 2.0 - 1.0;
  let ndcY = ((f32(py) + 0.5) / f32(params.rasterHeight)) * 2.0 - 1.0;
  let rd = normalize(
    params.fwd +
      params.right * (ndcX * params.tanHalf * params.aspect) +
      params.up * (ndcY * params.tanHalf),
  );
  let ro = params.ro;`;
  const marchDither = unproject
    ? `
    // Tiny dithered start (main()'s hash line), flag-gated so agreement
    // runs stay deterministic against the CPU emulator.
    if ((shade.flags & 1u) != 0u) {
      t += hash2(vec2f(f32(px) + 0.5, f32(py) + 0.5)) *
        shade.tracePixelEps * max(t, 1.0);
    }`
    : "";

  // Hit-info descent bodies (fr-55s1 stage C): one per core, selected
  // like the value descents — and under the lens, renamed `…Core` with
  // the argmin sweep wrapper owning the public name, exactly the value
  // pair's move one function over.
  const foldHitInfoText = /* wgsl */ `// Fold hit-info descent (surface-material.ts's SURFACE_FOLDS shading
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
}`;

  // Affine hit-info descent (surface-material.ts's affine shading
  // overload, trajectory term for term): the width-4 refined ladder
  // WITHOUT its value side — `best`/`refinedCert` never steer the ladder
  // (keys route the beam, escape/bounding radii route the chains), and
  // the fold twin above set the convention: the shading descent feeds
  // colors only, so the value folds are trimmed rather than mirrored.
  // Plain params.maxDepth on purpose, like the fold twin.
  const affineHitInfoText = /* wgsl */ `// Affine hit-info descent (surface-material.ts's affine shading
// overload): the width-4 ladder's TRAJECTORY — top-2 beam + fr-jkpn
// rank-3/4 validity spill, sector-major enumeration — feeding colors
// only (the value side never steers it; see the generator comment).
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
  let R = params.boundingRadius;
  var aQ = q;
  var aScale = 1.0;
  var aLive = true;
  var bQ = vec3f(0.0);
  var bScale = 1.0;
  var bLive = false;
  var v1Q = vec3f(0.0);
  var v1Scale = 1.0;
  var v1Live = false;
  var v2Q = vec3f(0.0);
  var v2Scale = 1.0;
  var v2Live = false;
  for (var depth = 0u; depth < params.maxDepth; depth++) {
    if (!aLive && !bLive && !v1Live && !v2Live) {
      break;
    }
    var c1Key = 1e30;
    var c1Q = vec3f(0.0);
    var c1Scale = 1.0;
    var c1R = 0.0;
    var c1Map = 0u;
    var c2Key = 1e30;
    var c2Q = vec3f(0.0);
    var c2Scale = 1.0;
    var c2R = 0.0;
    var c3Key = 1e30;
    var c3Q = vec3f(0.0);
    var c3Scale = 1.0;
    var c3R = 0.0;
    var c4Key = 1e30;
    var c4Q = vec3f(0.0);
    var c4Scale = 1.0;
    var c4R = 0.0;
    for (var c = 0u; c < 4u; c++) {
      var pQ = vec3f(0.0);
      var pScale = 1.0;
      if (c == 0u) {
        if (!aLive) {
          continue;
        }
        pQ = aQ;
        pScale = aScale;
      } else if (c == 1u) {
        if (!bLive) {
          continue;
        }
        pQ = bQ;
        pScale = bScale;
      } else if (c == 2u) {
        if (!v1Live) {
          continue;
        }
        pQ = v1Q;
        pScale = v1Scale;
      } else {
        if (!v2Live) {
          continue;
        }
        pQ = v2Q;
        pScale = v2Scale;
      }
      // Sector sweep (fr-x029): sector-major enumeration, the expanded
      // slot list's order, so ladder tie-breaks match the oracle's.
      var sQ = pQ;
      for (var k = 0u; k < params.symOrder; k++) {
        if (k > 0u) {
          sQ = stepSector(sQ);
        }
        for (var j = 0u; j < params.mapCount; j++) {
          let m = maps[j];
          let img = mapApply(m, sQ);
          let r = length(img - params.boundCenter);
          let key = pScale * (r - R);
          let childScale = pScale * m.p0.x;
          // Top-2 insert-shift; the displaced tuple (or the candidate
          // itself) spills into the rank-3/4 ladder. Certificates are
          // value-side and trimmed; radii flow through — the spill
          // ladder routes on them.
          var eKey = key;
          var eQ = img;
          var eScale = childScale;
          var eR = r;
          if (key < c1Key) {
            eKey = c2Key;
            eQ = c2Q;
            eScale = c2Scale;
            eR = c2R;
            c2Key = c1Key;
            c2Q = c1Q;
            c2Scale = c1Scale;
            c2R = c1R;
            c1Key = key;
            c1Q = img;
            c1Scale = childScale;
            c1R = r;
            c1Map = j;
          } else if (key < c2Key) {
            eKey = c2Key;
            eQ = c2Q;
            eScale = c2Scale;
            eR = c2R;
            c2Key = key;
            c2Q = img;
            c2Scale = childScale;
            c2R = r;
          }
          if (eKey < c3Key) {
            c4Key = c3Key;
            c4Q = c3Q;
            c4Scale = c3Scale;
            c4R = c3R;
            c3Key = eKey;
            c3Q = eQ;
            c3Scale = eScale;
            c3R = eR;
          } else if (eKey < c4Key) {
            c4Key = eKey;
            c4Q = eQ;
            c4Scale = eScale;
            c4R = eR;
          }
        }
      }
    }
    if (depth == 0u) {
      info.firstChoice = i32(c1Map);
    }
    trapAcc += trapW * shadeMaps[c1Map].w;
    trapNorm += trapW;
    trapW *= shade.colorSpeed;
    info.rings = min(info.rings, c1R / R);
    info.sheets = min(info.sheets, abs(c1Q.y) / R);
    aLive = false;
    bLive = false;
    v1Live = false;
    v2Live = false;
    if (c1Key < 1e29) {
      if (c1R <= params.escapeRadius) {
        aQ = c1Q;
        aScale = c1Scale;
        aLive = true;
      }
    }
    if (c2Key < 1e29) {
      if (c2R <= params.escapeRadius) {
        bQ = c2Q;
        bScale = c2Scale;
        bLive = true;
      }
    }
    if (c3Key < 1e29) {
      if (c3R <= R) {
        v1Q = c3Q;
        v1Scale = c3Scale;
        v1Live = true;
      }
    }
    if (c4Key < 1e29) {
      if (c4R <= R) {
        v2Q = c4Q;
        v2Scale = c4Scale;
        v2Live = true;
      }
    }
  }
  info.trap = select(0.0, trapAcc / trapNorm, trapNorm > 0.0);
  info.rings = clamp(info.rings, 0.0, 1.0);
  info.sheets = clamp(info.sheets, 0.0, 1.0);
  return info;
}`;

  // 4D hit-info (fr-dlxh's 4D cut): surface-material-4d.ts's shading
  // hit-info overload, term for term — the greedy width-1 descent over
  // the 4D maps behind the same view lift as the value body, colors-only
  // convention. STUB until stage A2's body port lands: deliberately not
  // valid WGSL, so an accidental emission fails loudly at pipeline
  // creation instead of computing garbage.
  const affine4HitInfoText = /* wgsl */ `AFFINE4_HIT_INFO_BODY_NOT_YET_PORTED (fr-dlxh stage A2)`;

  // Escape hit-info (fr-dlxh — the GLSL SURFACE_ESCAPE shading overload,
  // term for term): the same forward orbit with the classic escape-time
  // extras — trap is the ESCAPE FRACTION escapedAt/maxDepth (the
  // canonical Mandelbox palette coordinate), rings/sheets the orbit's
  // closest radial / y-plane approaches — the same trap vocabulary the
  // descent variants feed the shared color sources. firstChoice is
  // always 0 (one map). Colors-only convention (the fold twin's): the
  // GLSL overload also returns the DE, so its dr accumulator is the one
  // value-side term trimmed here.
  const escapeHitInfoText = /* wgsl */ `fn surfaceDEHitInfo(p: vec3f, li: u32) -> SurfaceHitInfo {
  var info = SurfaceHitInfo(0, 0.0, 1.0, 1.0);
  var v = p;
  var r = length(v);
  let kind = u32(params.escParams.x);
  var escapedAt = params.maxDepth;
  for (var i = 0u; i < params.maxDepth; i++) {
    if (r > params.boundingRadius) {
      escapedAt = i;
      break;
    }
    var y = vec3f(
      dot(params.escM0, v) + params.escT0,
      dot(params.escM1, v) + params.escT1,
      dot(params.escM2, v) + params.escT2,
    );
    if (kind != 2u) {
      y = clamp(y, vec3f(-1.0), vec3f(1.0)) * 2.0 - y;
    }
    if (kind != 1u) {
      let f = 1.0 / clamp(dot(y, y), 0.25, 1.0);
      y *= f;
    }
    v = params.escParams.y * y;
    r = length(v);
    info.rings = min(info.rings, r / params.boundingRadius);
    info.sheets = min(info.sheets, abs(v.y) / params.boundingRadius);
  }
  info.trap = f32(escapedAt) / f32(params.maxDepth);
  info.rings = clamp(info.rings, 0.0, 1.0);
  info.sheets = clamp(info.sheets, 0.0, 1.0);
  return info;
}`;

  // Lens hit-info wrapper (fr-55s1 stage C — the GLSL lens hit overload
  // term for term): re-run the branch sweep with FULL-width zero-cutoff
  // core calls, tracking the ARGMIN branch's core query (identity-branch
  // fallback, so a fully pruned loop — only reachable off-surface —
  // still hands the core hit call a sane point), then fetch the shading
  // extras from ONE core hit-info call on the winner. The shell guard
  // plain-skips here: there is no caller cutoff and no visible pin in a
  // shading call, exactly the GLSL's shape.
  const lensHitWrapText = /* wgsl */ `fn surfaceDEHitInfo(p: vec3f, li: u32) -> SurfaceHitInfo {
  let kind = u32(params.lensParams.x);
  let absW = params.lensParams.z;
  let u = p * params.lensParams.y;
  var best = 1e30;
  var ru = 0.0;
  var pre0 = vec3f(0.0);
  var pre1 = vec3f(0.0);
  var pre2 = vec3f(0.0);
  var dUp = vec3f(0.0);
  var dDn = vec3f(0.0);
  var v = vec3f(0.0);
  var sfSigma = 1.0;
  var sfRd = 0.0;
  var bestQ = vec3f(
    dot(params.lensM0, u) + params.lensT0,
    dot(params.lensM1, u) + params.lensT1,
    dot(params.lensM2, u) + params.lensT2,
  );
  if (kind == 1u) {
    pre0 = u;
    pre1 = 2.0 - u;
    pre2 = -2.0 - u;
    dUp = max(u - 1.0, vec3f(0.0));
    dDn = max(-1.0 - u, vec3f(0.0));
  } else {
    ru = length(u);
  }
  var branchCount = 81u;
  if (kind == 1u) {
    branchCount = 27u;
  } else if (kind == 2u) {
    branchCount = 3u;
  }
  for (var b = 0u; b < branchCount; b++) {
    if (kind == 2u || (kind == 3u && b % 27u == 0u)) {
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
    var branchRd: f32;
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
    let flr = absW * branchRd;
    if (flr > 0.0 && flr >= best) {
      continue;
    }
    let q = vec3f(
      dot(params.lensM0, pre) + params.lensT0,
      dot(params.lensM1, pre) + params.lensT1,
      dot(params.lensM2, pre) + params.lensT2,
    );
    let factor = absW * sfSigma * params.lensParams.w;
    let rq = length(q - params.boundCenter);
    if (factor * (rq - params.boundingRadius) >= best) {
      continue;
    }
    var term = factor * surfaceDECore(q, 0.0, li);
    term = max(term, flr);
    if (term < best) {
      best = term;
      bestQ = q;
    }
  }
  return surfaceDEHitInfoCore(bestQ, li);
}`;

  const coreHitInfoText =
    core === "affine"
      ? affineHitInfoText
      : core === "escape"
        ? escapeHitInfoText
        : core === "affine4"
          ? affine4HitInfoText
          : foldHitInfoText;
  const hitInfoText = lens
    ? `${coreHitInfoText.replace(
        "fn surfaceDEHitInfo(",
        "fn surfaceDEHitInfoCore(",
      )}

// The lens hit-info argmin sweep (fr-55s1 stage C) — around the renamed
// core hit-info, like the value pair below.
${lensHitWrapText}`
    : coreHitInfoText;

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
${marchRd}
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
    t = max(-bq - sq, 0.0);${marchDither}
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
struct SurfaceHitInfo {
  firstChoice: i32,
  trap: f32,
  rings: f32,
  sheets: f32,
}

${hitInfoText}

@compute @workgroup_size(${workgroupSize})
fn shadeRays(
  @builtin(global_invocation_id) gid: vec3u,
  @builtin(local_invocation_index) li: u32,
) {
  let slotI = gid.x;
  if (slotI >= params.itemCount) {
    return;
  }
  let ray = activeList[slotI];
  let st = states[ray];
  if (st.y == ${SURFACE_GPU_RAY_ACTIVE}.0) {
    // The host queues TERMINAL rays only (HIT/MISS/EXHAUSTED), sized so
    // every shading submission stays bounded; an ACTIVE ray is never in
    // a batch — guard anyway, leaving its prefilled pixel alone.
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
  if (st.y != ${SURFACE_GPU_RAY_HIT}.0) {
    colorOut[ray] = pack4x8unorm(vec4f(bg, 1.0));
    return;
  }
  let ndcX = ((f32(px) + 0.5) / f32(params.rasterWidth)) * 2.0 - 1.0;
  let ndcY = ((f32(py) + 0.5) / f32(params.rasterHeight)) * 2.0 - 1.0;
  // The GLSL tracer's unproject (main(): near/far clip points through
  // uInvProjView); params.ro doubles as uCamPos, and the pose basis
  // right/up/fwd/tanHalf/aspect fields are ignored in this mode.
  let nearP = shade.invProjView * vec4f(ndcX, ndcY, -1.0, 1.0);
  let farP = shade.invProjView * vec4f(ndcX, ndcY, 1.0, 1.0);
  let rd = normalize(farP.xyz / farP.w - nearP.xyz / nearP.w);
  let ro = params.ro;
  // Sphere-gate recompute, only for tEnter (the fog origin) — cheaper
  // than persisting it in the march state.
  let radius = params.visibleRadius * 1.02;
  let bq = dot(ro, rd);
  let cq = dot(ro, ro) - radius * radius;
  let disc = bq * bq - cq;
  if (disc < 0.0) {
    // Defensive — a HIT ray always intersected the gate sphere.
    colorOut[ray] = pack4x8unorm(vec4f(bg, 1.0));
    return;
  }
  let sq = sqrt(disc);
  let t = st.x;
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
  let grad = e.xyy * ${probeDe}(pos + e.xyy * h, 0.0, li) +
    e.yyx * ${probeDe}(pos + e.yyx * h, 0.0, li) +
    e.yxy * ${probeDe}(pos + e.yxy * h, 0.0, li) +
    e.xxx * ${probeDe}(pos + e.xxx * h, 0.0, li);
  let n = select(-rd, normalize(grad), dot(grad, grad) > 1e-12);
  // Soft shadow: DE penumbra toward the light, started just off the
  // surface; near-black penumbras and leaving the sphere end early.
  var shadow = 1.0;
  var ts = h * 2.0;
  for (var i = 0u; i < shade.shadowSteps; i++) {
    let sp = pos + n * h * 2.0 + shade.lightDir * ts;
    let d = ${probeDe}(sp, 0.0, li);
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
    occ += wgt * clamp((hh - ${probeDe}(pos + n * hh, 0.0, li)) / hh, 0.0, 1.0);
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
  const stage2AffineSkipFor = (Wstr: string): string =>
    bnbStage2
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
            if (keptCount == ${Wstr}) {
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
  const stage2FoldSkipFor = (Wstr: string): string =>
    bnbStage2
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
              if (keptCount == ${Wstr}) {
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

  const headerText = /* wgsl */ `
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
  symPlane: u32,
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
  pad1: f32,${
    lens
      ? /* wgsl */ `
  lensM0: vec3f,
  lensT0: f32,
  lensM1: vec3f,
  lensT1: f32,
  lensM2: vec3f,
  lensT2: f32,
  lensParams: vec4f,`
      : core === "escape"
        ? /* wgsl */ `
  escM0: vec3f,
  escT0: f32,
  escM1: vec3f,
  escT1: f32,
  escM2: vec3f,
  escT2: f32,
  escParams: vec4f,`
        : core === "affine4"
          ? /* wgsl */ `
  rotorInvR0: vec4f,
  rotorInvR1: vec4f,
  rotorInvR2: vec4f,
  rotorInvR3: vec4f,
  stepBack4R0: vec4f,
  stepBack4R1: vec4f,
  stepBack4R2: vec4f,
  stepBack4R3: vec4f,
  final4MR0: vec4f,
  final4MR1: vec4f,
  final4MR2: vec4f,
  final4MR3: vec4f,
  final4T: vec4f,
  w0: f32,
  sliceHalfW: f32,
  final4SigmaMin: f32,
  pad4: f32,`
          : ""
  }
}${
    core === "escape"
      ? ""
      : core === "affine4"
        ? /* wgsl */ `

struct GpuMap4 {
  r0: vec4f,
  r1: vec4f,
  r2: vec4f,
  r3: vec4f,
  t: vec4f,
  p0: vec4f,
}`
        : /* wgsl */ `

struct GpuMap {
  r0: vec4f,
  r1: vec4f,
  r2: vec4f,
  p0: vec4f,
  bnb: vec4f,
  p1: vec4f,
}`
  }

@group(0) @binding(0) var<uniform> params: Params;${
    // The escape core reads its one forward map from the params variant
    // block and never touches per-map storage; a declared-but-unused
    // binding would drop out of the auto layout anyway (module doc), so
    // it is not declared and hosts skip buffer 1. The affine4 core's
    // maps are the 4D layout (GpuMap4).
    core === "escape"
      ? ""
      : core === "affine4"
        ? `
@group(0) @binding(1) var<storage, read> maps: array<GpuMap4>;`
        : `
@group(0) @binding(1) var<storage, read> maps: array<GpuMap>;`
  }
${io}
${frontierBlock}${
    core === "escape"
      ? ""
      : core === "affine4"
        ? /* wgsl */ `
// Row-major 4×4 apply — every matrix in this core's wire format stores
// the ROW-MAJOR bytes of the matrix the body applies (module doc), so
// application is always dot(row, v); translations ride separately and
// never touch a half-extent (fr-wa6o: extents transform by the LINEAR
// part alone).
fn mapApply4(m: GpuMap4, x: vec4f) -> vec4f {
  return vec4f(dot(m.r0, x), dot(m.r1, x), dot(m.r2, x), dot(m.r3, x)) + m.t;
}

fn mapApplyLinear4(m: GpuMap4, x: vec4f) -> vec4f {
  return vec4f(dot(m.r0, x), dot(m.r1, x), dot(m.r2, x), dot(m.r3, x));
}

fn stepSector4(v: vec4f) -> vec4f {
  return vec4f(
    dot(params.stepBack4R0, v),
    dot(params.stepBack4R1, v),
    dot(params.stepBack4R2, v),
    dot(params.stepBack4R3, v),
  );
}`
        : /* wgsl */ `
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
  if (params.symPlane == 0u) {
    return vec3f(v.x, c * v.y + s * v.z, -s * v.y + c * v.z);
  }
  if (params.symPlane == 1u) {
    return vec3f(c * v.x - s * v.z, v.y, s * v.x + c * v.z);
  }
  return vec3f(c * v.x + s * v.y, -s * v.x + c * v.y, v.z);
}`
  }`;

  // The descent PROLOGUE both cores open with (fr-55s1): the affine
  // final lens, the depth-0 sphere bound, the fr-55r5 bail threshold and
  // the fr-3c0k footprint depth cap are the same arithmetic on either
  // estimator — one text, interpolated twice, for renameToProbe's
  // reason: a body that is literally the same text cannot drift from
  // itself. (The GLSL affine arm omits the depth cap; that was a Mesa
  // link concession, not a semantic one — the CPU oracle caps both
  // descents identically, and at the GLSL-parity footprint 0 the block
  // is inert either way.)
  const descentPrologue = /* wgsl */ `  let q = vec3f(
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
  }`;

  // ONE descent body template (fr-p8bc): the main surfaceDE below is
  // this text verbatim; the probe descent is derived from the SAME text
  // by token rename ({@link renameToProbe}) so the two descents cannot
  // drift. Width is a REAL template parameter — small integer literals
  // ("2u", "3u") collide with body constants, so a post-hoc width rename
  // could never be safe.
  const descentFnText = (
    Wstr: string,
    decls: string,
  ): string => /* wgsl */ `fn surfaceDE(pIn: vec3f, cutoff: f32, li: u32) -> f32 {
${decls}
${descentPrologue}
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
              }${stage2AffineSkipFor(Wstr)}
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
              }${stage2FoldSkipFor(Wstr)}
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
            if (keptCount == ${Wstr} && key >= fnWorstKey) {
              evR = r;
              evCert = cert;
              evFloor = candFloor;
              evHas = true;
            } else {
              var slot = keptCount;
              if (keptCount == ${Wstr}) {
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
              if (keptCount == ${Wstr}) {
                fnWorstKey = -1e30;
                fnWorstIdx = 0u;
                for (var s2 = 0u; s2 < ${Wstr}; s2++) {
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
}`;

  // Probe derivation (fr-p8bc): rename the descent's identity tokens —
  // fn name, index helper, the 14 frontier array names ("f…" → "p…") —
  // over the SAME body text. Distinct names rather than shadowing, so a
  // workgroup-shared MAIN frontier and the always-private probe frontier
  // can never collide.
  const renameToProbe = (text: string): string => {
    let out = text.replace("fn surfaceDE(", "fn surfaceDEProbe(");
    out = out.replaceAll("frontierIx(", "probeIx(");
    for (const a of arrays) {
      out = out.replaceAll(a, `p${a.slice(1)}`);
    }
    return out;
  };
  const probeDeFns =
    probeWidth === null
      ? ""
      : `

// fr-p8bc: the CHEAP descent for the shading probe taps — normal,
// shadow and AO light a hit the full-width march already certified, so
// they ride a width-${probeWidth} frontier (width 1 = the old greedy
// descent) in function-scope private arrays: narrow arrays are
// registers, which is the point. Same body as surfaceDE, renamed.
fn probeIx(slot: u32, li: u32) -> u32 {
  return slot;
}

${renameToProbe(
  descentFnText(
    `${probeWidth}u`,
    arrays.map((a) => `  var ${a}: array<f32, ${probeWidth}>;`).join("\n"),
  ),
)}`;

  // The AFFINE core (fr-55s1 stage A): `descend`'s refine=TRUE path —
  // {@link estimateDistanceRefined}, the estimator a fold-free base map
  // set is entitled to — ported term for term from its GLSL mirror
  // (`surface-material.ts`'s `#else` arm, the f32 formulation reference).
  // FIXED width 4, exactly as that mirror hardcodes it: A/B are the beam
  // chains (fr-v6yg), V1/V2 fr-jkpn's validity slots, which hold the
  // level's rank-3/4 candidates ONLY while those stay in-sphere. Every
  // escaped sibling folds fr-1z6p's REFINED certificate, under the
  // oracle's laziness guard (refinement can only RAISE a certificate, so
  // a fold whose plain certificate already fails to beat the running min
  // is skipped whole — bit-exact). `opts.width`, `sharedFrontier` and
  // `bnbStage2` are all inert here.
  const affineDescentText = /* wgsl */ `// One extra Hutchinson level on a frozen escaped candidate's own
// inverse image (the oracle's refinedCertValue, fr-1z6p): the
// certificate becomes childScale * max(r - R, min_j sigmaMin_j *
// (|invMap_j(img)| - R)) — never below the plain childScale * (r - R).
// "Every map" means every (sector, base map) pair, which the fr-x029
// sweep spells out where the expanded slot list used to.
fn refinedCert(img: vec3f, r: f32, childScale: f32) -> f32 {
  var inner = 1e30;
  var sImg = img;
  for (var k = 0u; k < params.symOrder; k++) {
    if (k > 0u) {
      sImg = stepSector(sImg);
    }
    for (var j = 0u; j < params.mapCount; j++) {
      let m = maps[j];
      let jImg = mapApply(m, sImg);
      inner = min(
        inner,
        m.p0.x * (length(jImg - params.boundCenter) - params.boundingRadius),
      );
    }
  }
  return childScale * max(r - params.boundingRadius, inner);
}

fn surfaceDE(pIn: vec3f, cutoff: f32, li: u32) -> f32 {
${descentPrologue}
  // Chain A starts at the (lensed) query; B idles until beam selection
  // fills it. Each chain carries the contraction accumulated INCLUDING
  // its own map and the radius it was selected at — scale * (r - R) is
  // its terminal bound. The validity chains carry no R field: unlike A/B
  // they never fold a terminal (see past the loop), and expansion
  // re-derives every child radius.
  var aQ = q;
  var aScale = 1.0;
  var aR = startR;
  var aLive = true;
  var bQ = vec3f(0.0);
  var bScale = 1.0;
  var bR = 0.0;
  var bLive = false;
  var v1Q = vec3f(0.0);
  var v1Scale = 1.0;
  var v1Live = false;
  var v2Q = vec3f(0.0);
  var v2Scale = 1.0;
  var v2Live = false;
  for (var depth = 0u; depth < maxDepth; depth++) {
    if (!aLive && !bLive && !v1Live && !v2Live) {
      break;
    }
    // The four smallest-key candidates this level, key-ascending. The
    // sentinel r = 0 keeps empty slots out of every escaped-candidate
    // fold below.
    var c1Key = 1e30;
    var c1Q = vec3f(0.0);
    var c1Scale = 1.0;
    var c1R = 0.0;
    var c1Cert = 0.0;
    var c2Key = 1e30;
    var c2Q = vec3f(0.0);
    var c2Scale = 1.0;
    var c2R = 0.0;
    var c2Cert = 0.0;
    // Ranks 3/4, tracked the same way: a second insert-shift ladder fed
    // by everything the top-2 ladder evicts, so the pair holds exactly
    // the level's third- and fourth-smallest keys.
    var c3Key = 1e30;
    var c3Q = vec3f(0.0);
    var c3Scale = 1.0;
    var c3R = 0.0;
    var c3Cert = 0.0;
    var c4Key = 1e30;
    var c4Q = vec3f(0.0);
    var c4Scale = 1.0;
    var c4R = 0.0;
    var c4Cert = 0.0;
    for (var c = 0u; c < 4u; c++) {
      var pQ = vec3f(0.0);
      var pScale = 1.0;
      if (c == 0u) {
        if (!aLive) {
          continue;
        }
        pQ = aQ;
        pScale = aScale;
      } else if (c == 1u) {
        if (!bLive) {
          continue;
        }
        pQ = bQ;
        pScale = bScale;
      } else if (c == 2u) {
        if (!v1Live) {
          continue;
        }
        pQ = v1Q;
        pScale = v1Scale;
      } else {
        if (!v2Live) {
          continue;
        }
        pQ = v2Q;
        pScale = v2Scale;
      }
      // Sector sweep (fr-x029): the chain point turns one step per
      // kaleidoscope sector and every BASE map is applied to it there,
      // so the candidates — and their SECTOR-MAJOR enumeration order,
      // the order the expanded slot list was built in — are exactly the
      // ones the expansion produced, and the ladders below break ties
      // the same way.
      var sQ = pQ;
      for (var k = 0u; k < params.symOrder; k++) {
        if (k > 0u) {
          sQ = stepSector(sQ);
        }
        for (var j = 0u; j < params.mapCount; j++) {
          let m = maps[j];
          let img = mapApply(m, sQ);
          let r = length(img - params.boundCenter);
          let key = pScale * (r - R);
          let childScale = pScale * m.p0.x;
          let cert = childScale * (r - R);
          // Exactly one tuple leaves the top-2 ladder per candidate —
          // the displaced runner-up, or the candidate itself. It spills
          // into the rank-3/4 ladder or folds below; empty-slot
          // sentinels flow through both harmlessly (key 1e30 never
          // inserts, r = 0 never folds).
          var eKey = key;
          var eQ = img;
          var eScale = childScale;
          var eR = r;
          var eCert = cert;
          if (key < c1Key) {
            eKey = c2Key;
            eQ = c2Q;
            eScale = c2Scale;
            eR = c2R;
            eCert = c2Cert;
            c2Key = c1Key;
            c2Q = c1Q;
            c2Scale = c1Scale;
            c2R = c1R;
            c2Cert = c1Cert;
            c1Key = key;
            c1Q = img;
            c1Scale = childScale;
            c1R = r;
            c1Cert = cert;
          } else if (key < c2Key) {
            eKey = c2Key;
            eQ = c2Q;
            eScale = c2Scale;
            eR = c2R;
            eCert = c2Cert;
            c2Key = key;
            c2Q = img;
            c2Scale = childScale;
            c2R = r;
            c2Cert = cert;
          }
          // Spill into the rank-3/4 ladder (unconditional at width 4);
          // what THAT evicts — or the spilled tuple itself, when it
          // beats neither slot — falls through to the fold below. The
          // evicted KEY is dead past this point: only the folded fields
          // (point, scale, radius, certificate) survive, and width 4 is
          // fixed here, so there is no tKey.
          if (eKey < c3Key) {
            let tQ = c4Q;
            let tScale = c4Scale;
            let tR = c4R;
            let tCert = c4Cert;
            c4Key = c3Key;
            c4Q = c3Q;
            c4Scale = c3Scale;
            c4R = c3R;
            c4Cert = c3Cert;
            c3Key = eKey;
            c3Q = eQ;
            c3Scale = eScale;
            c3R = eR;
            c3Cert = eCert;
            eQ = tQ;
            eScale = tScale;
            eR = tR;
            eCert = tCert;
          } else if (eKey < c4Key) {
            let tQ = c4Q;
            let tScale = c4Scale;
            let tR = c4R;
            let tCert = c4Cert;
            c4Key = eKey;
            c4Q = eQ;
            c4Scale = eScale;
            c4R = eR;
            c4Cert = eCert;
            eQ = tQ;
            eScale = tScale;
            eR = tR;
            eCert = tCert;
          }
          // The tuple leaving the beam frontier: an escaped candidate
          // folds its REFINED certificate (fr-1z6p closes the
          // barely-escaped-sibling balloon), skipped whole when its
          // PLAIN certificate cannot beat the running min anyway (the
          // oracle's laziness guard, bit-exact); an in-sphere tuple
          // carries no positive certificate — it can only get here past
          // FOUR smaller keys, the shrunken fr-jkpn residual drop.
          if (eR > R && eCert < best) {
            best = min(best, refinedCert(eQ, eR, eScale));
            // Cutoff exit (fr-55r5) plus the sphere-floor pin (fr-zkt2):
            // the folded certificate is FINALIZED (already refined) and
            // best only falls from here, so once best is at or below
            // sphereBound the return is pinned no matter how much
            // further it falls, and short of that the settled verdict
            // against the caller's cutoff cannot be lifted back either.
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
    // Promote: the best candidate continues as chain A, the runner-up as
    // chain B; past the escape radius a candidate folds its terminal and
    // dies instead (deeper refinement cannot improve the min). Ranks 3/4
    // continue as validity chains ONLY while in-sphere; escaped, they
    // fold the same refined certificate they would have folded without
    // the slots.
    aLive = false;
    bLive = false;
    v1Live = false;
    v2Live = false;
    if (c1Key < 1e29) {
      if (c1R > params.escapeRadius) {
        best = min(best, c1Cert);
      } else {
        aQ = c1Q;
        aScale = c1Scale;
        aR = c1R;
        aLive = true;
      }
    }
    if (c2Key < 1e29) {
      if (c2R > params.escapeRadius) {
        best = min(best, c2Cert);
      } else {
        bQ = c2Q;
        bScale = c2Scale;
        bR = c2R;
        bLive = true;
      }
    }
    if (c3Key < 1e29) {
      if (c3R > R) {
        if (c3Cert < best) {
          best = min(best, refinedCert(c3Q, c3R, c3Scale));
        }
      } else {
        v1Q = c3Q;
        v1Scale = c3Scale;
        v1Live = true;
      }
    }
    if (c4Key < 1e29) {
      if (c4R > R) {
        if (c4Cert < best) {
          best = min(best, refinedCert(c4Q, c4R, c4Scale));
        }
      } else {
        v2Q = c4Q;
        v2Scale = c4Scale;
        v2Live = true;
      }
    }
    // The same two exits covering the four promote folds in one test:
    // each either wrote a SETTLED bound into best (refined at the two
    // validity-slot sites, the deliberately plain escape-radius bound at
    // the other two) or continued a chain. Deliberately NOT a break: the
    // terminal bounds past the loop are folds the FULL descent only
    // makes at the depth cap, and folding one here could drop best below
    // a value that descent never reaches.
    if (best <= sphereBound || best * params.finalSigmaMin < bailBelow) {
      return max(best, sphereBound) * params.finalSigmaMin;
    }
  }
  // Terminal bound of the chains alive at the depth cap (the KIFS
  // last-value formula): non-positive when the chain tracked the
  // attractor all the way down. Validity chains fold NO cap terminal —
  // deliberately asymmetric with A/B: in-sphere means inside the
  // bounding SPHERE, not near the attractor, so their cap terminal is a
  // vacuous negative bound (fr-jkpn measured folding them changing
  // nothing, so the omission is on principle, not cost).
  if (aLive) {
    best = min(best, aScale * (aR - R));
  }
  if (bLive) {
    best = min(best, bScale * (bR - R));
  }
  return max(best, sphereBound) * params.finalSigmaMin;
}`;

  // The AFFINE4 core (fr-dlxh's 4D cut): estimateDistance4Refined
  // (surface-de-4d.ts) behind the view lift — the 4D GLSL tracer's
  // estimator (surface-material-4d.ts) in WGSL. STUB until stage A2's
  // body port lands: deliberately not valid WGSL, so an accidental
  // emission fails loudly at pipeline creation instead of computing
  // garbage.
  const affine4DescentText = /* wgsl */ `AFFINE4_DESCENT_BODY_NOT_YET_PORTED (fr-dlxh stage A2)`;

  // The ESCAPE core (fr-dlxh): escape-de.ts's estimateEscapeDistance —
  // the forward fold orbit with the Buddhi/Rrrola scalar derivative,
  // DE = |v| / dr — in the SURFACE_ESCAPE GLSL arm's f32 formulation
  // (surface-material.ts, the variant this core replaces on the compute
  // route). No descent, no frontier, no prunes: the loop is fixed-cost,
  // so `cutoff` is accepted for signature parity and ignored (every
  // return IS the cutoff-0 result, trivially the fr-55r5 contract) and
  // `li` never indexes anything (the affine ladder's precedent). Plain
  // params.maxDepth — the orbit's iteration budget; no footprint cap,
  // like the GLSL arm.
  const escapeDescentText = /* wgsl */ `fn surfaceDE(pIn: vec3f, cutoff: f32, li: u32) -> f32 {
  var v = pIn;
  var dr = 1.0;
  var r = length(v);
  let kind = u32(params.escParams.x);
  for (var i = 0u; i < params.maxDepth; i++) {
    if (r > params.boundingRadius) {
      break;
    }
    var y = vec3f(
      dot(params.escM0, v) + params.escT0,
      dot(params.escM1, v) + params.escT1,
      dot(params.escM2, v) + params.escT2,
    );
    var localL = 1.0;
    if (kind != 2u) {
      // The box fold (boxfold + mandelbox): per-axis reflections,
      // local factor 1.
      y = clamp(y, vec3f(-1.0), vec3f(1.0)) * 2.0 - y;
    }
    if (kind != 1u) {
      // The sphere fold (spherefold + mandelbox): variations.ts's
      // sphereFoldFactor, which IS the local conformal factor.
      let f = 1.0 / clamp(dot(y, y), 0.25, 1.0);
      y *= f;
      localL = f;
    }
    v = params.escParams.y * y;
    dr = params.escParams.z * localL * dr + 1.0;
    r = length(v);
  }
  return r / dr;
}`;

  const descentBlock =
    core === "affine"
      ? `// descend's refine=true path (surface-de.ts) — the estimator the
// AFFINE GLSL marches, in that mirror's f32 formulation. Fixed width 4.
${affineDescentText}`
      : core === "escape"
        ? `// estimateEscapeDistance (escape-de.ts) — the forward-orbit
// escape-time estimator, the SURFACE_ESCAPE GLSL arm's twin (fr-dlxh).
${escapeDescentText}`
        : core === "affine4"
          ? `// estimateDistance4Refined (surface-de-4d.ts) behind the view lift —
// the estimator the 4D GLSL tracer marches (surface-material-4d.ts), in
// that mirror's f32 formulation. Fixed width 4 (fr-dlxh's 4D cut).
${affine4DescentText}`
          : `// descendFold's refine=false path (surface-de.ts), the estimator the
// fold GLSL marches, in that mirror's f32 formulation.
${descentFnText(W, privateDecls)}${probeDeFns}`;

  // The FOLD FINAL lens (fr-55s1 stage B): `descendLens` (surface-de.ts)
  // one level up — exactly the GLSL SURFACE_FOLD_LENS move
  // (surface-material.ts's `#define surfaceDE surfaceDECore`) in this
  // generator's own token-rename idiom: the descent body keeps its text
  // under the name `surfaceDECore`, the wrapper owns the public
  // `surfaceDE`, and the mode entries' call sites never change. The
  // wrapper enumerates the lens's inverse fold branches — kind and count
  // from the params uniform, like the fold body's per-map kind switch
  // (one pipeline per session, GLSL parity) — and seeds one core descent
  // per surviving branch. Every prune is the oracle's, value-exact: the
  // region floor, the scaled sphere certificate, the visible-sphere pin,
  // the fr-55r5 cutoff exits (inner descents get `min(best, cutoff) /
  // factor`, so inexact inner exits stay under the caller's cutoff), and
  // the spherefold mid-branch shell guard with the mandelbox `b += 26u`
  // box-expansion skip. The cores' own final slots are packed IDENTITY/1
  // under the lens ({@link packSurfaceGpuParams}), so they run their
  // no-lens path verbatim; `params.footprint` is 0 by the same packing
  // contract, keeping the cores' depth cap inert exactly like the CPU's
  // `innerFootprint = 0`.
  const lensWrapText = /* wgsl */ `fn surfaceDE(pIn: vec3f, cutoff: f32, li: u32) -> f32 {
  let visBound = length(pIn) - params.visibleRadius;
  let kind = u32(params.lensParams.x);
  let absW = params.lensParams.z;
  let u = pIn * params.lensParams.y;
  var best = 1e30;
  var ru = 0.0;
  var pre0 = vec3f(0.0);
  var pre1 = vec3f(0.0);
  var pre2 = vec3f(0.0);
  var dUp = vec3f(0.0);
  var dDn = vec3f(0.0);
  var v = vec3f(0.0);
  var sfSigma = 1.0;
  var sfRd = 0.0;
  if (kind == 1u) {
    pre0 = u;
    pre1 = 2.0 - u;
    pre2 = -2.0 - u;
    dUp = max(u - 1.0, vec3f(0.0));
    dDn = max(-1.0 - u, vec3f(0.0));
  } else {
    ru = length(u);
  }
  var branchCount = 81u;
  if (kind == 1u) {
    branchCount = 27u;
  } else if (kind == 2u) {
    branchCount = 3u;
  }
  for (var b = 0u; b < branchCount; b++) {
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
          // Shell guard (the oracle's): fold the settled shell bound,
          // skip the branch + its box expansion.
          let shellCert = absW * (1.0 - ru);
          if (shellCert < best) {
            best = shellCert;
            if (best <= visBound) {
              return visBound;
            }
            if (cutoff > 0.0 && best < cutoff) {
              return max(best, visBound);
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
    var branchRd: f32;
    if (kind == 2u) {
      pre = v;
      branchRd = sfRd;
    } else {
      // Box branch decode: per-axis preimage selectors, x fastest
      // (b = selX + 3*selY + 9*selZ).
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
    let flr = absW * branchRd;
    if (flr > 0.0 && flr >= best) {
      continue;
    }
    let q = vec3f(
      dot(params.lensM0, pre) + params.lensT0,
      dot(params.lensM1, pre) + params.lensT1,
      dot(params.lensM2, pre) + params.lensT2,
    );
    let factor = absW * sfSigma * params.lensParams.w;
    let rq = length(q - params.boundCenter);
    // The core never undercuts its own depth-0 sphere bound, so a branch
    // whose scaled sphere certificate reaches the running min cannot
    // advance it — an exact skip.
    if (factor * (rq - params.boundingRadius) >= best) {
      continue;
    }
    var innerCutoff = 0.0;
    if (cutoff > 0.0) {
      innerCutoff = min(best, cutoff) / factor;
    }
    var term = factor * surfaceDECore(q, innerCutoff, li);
    term = max(term, flr);
    if (term < best) {
      best = term;
      if (best <= visBound) {
        return visBound;
      }
      if (cutoff > 0.0 && best < cutoff) {
        return max(best, visBound);
      }
    }
  }
  return max(best, visBound);
}`;

  // Under the lens the probe descent (when emitted) gets the main
  // descent's exact treatment one name over: its body renames to
  // `surfaceDEProbeCore` and a probe lens wrapper — the SAME sweep text,
  // token-renamed like renameToProbe — owns `surfaceDEProbe` for the
  // shading taps (fr-p8bc's probe discipline through the lens, fr-55s1
  // stage C). One text, three names; none can drift.
  const probeLensWrapText = lensWrapText
    .replace("fn surfaceDE(", "fn surfaceDEProbe(")
    .replace(
      "surfaceDECore(q, innerCutoff, li)",
      "surfaceDEProbeCore(q, innerCutoff, li)",
    );
  const bodyBlock = lens
    ? `${descentBlock
        .replace("fn surfaceDE(", "fn surfaceDECore(")
        .replace("fn surfaceDEProbe(", "fn surfaceDEProbeCore(")}

// descendLens (surface-de.ts) — the fold FINAL lens's branch sweep
// around the untouched core (fr-g58b's vocabulary, fr-55s1 stage B).
${lensWrapText}${
        probeWidth === null
          ? ""
          : `

// The probe taps' own lens sweep (fr-55s1 stage C) — same text, renamed.
${probeLensWrapText}`
      }`
    : descentBlock;

  return /* wgsl */ `${headerText}

${bodyBlock}
${entry}
`;
}
