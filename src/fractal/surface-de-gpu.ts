import {
  BULB_ITERATIONS,
  BULB_POWER,
  BULB_STEP_SCALE,
  type BulbDE,
} from "./bulb-de";
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
import {
  radiusBandInvRange,
  slabExact4,
  type SurfaceDE4,
} from "./surface-de-4d";
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
 * SIX KERNEL CORES (`core`; fr-55s1 stage A added the second, fr-dlxh
 * the third and — its 4D cut — the fourth, fr-rsp6 phase 2A the fifth,
 * fr-7u8t.9 the sixth).
 * Which estimator a system is entitled to is decided exactly as on the
 * CPU — its BASE maps for the two 3D descents AND for the two 4D ones
 * (`deHasFolds` / `deHasFolds4`), the escape gate for the forward fold
 * loop and the bulb gate for the forward triplex-power one,
 * with the 4D gate (`analyzeSurfaceSystem4`) admitting the pair:
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
 *   systems `analyzeEscapeSystem` admits (one or more non-contracting
 *   pure folds; the IFS gate's complement). Since fr-s04t the orbit
 *   CYCLES through the document's whole formula chain — link `i mod n`,
 *   `+ p` and the bailout test after EACH link, one `GpuMap` per link on
 *   the maps storage binding ({@link packEscapeGpuMaps}), `mapCount` the
 *   link count and `maxDepth` still PASSES (`maxDepth * n` single-link
 *   steps) — with the kaleidoscope a query-space wedge fold off
 *   `symOrder`/`symPlane`. The head link also still rides the 208..271
 *   VARIANT block of the params uniform ({@link packEscapeGpuParams}) as
 *   frozen layout ballast the bodies no longer read.
 *   `width`/`sharedFrontier`/
 *   `bnbStage2`/`shadeDeWidth` are all inert (no frontier, no branch
 *   fan, no probe — the GLSL arm's shape), and a
 *   fold-final `lens` THROWS (the escape gate refuses final
 *   transforms; nothing pins that shape).
 * - `core: "bulb"` (fr-7u8t.9) is the escape core's SIBLING, one
 *   formula over: `bulb-de.ts`'s {@link estimateBulbDistance} — the
 *   FORWARD triplex-power orbit `y <- M V(y) + y_0` with the Böttcher
 *   log estimate `0.5·|y|·ln|y| / dr` — for exactly the systems
 *   `analyzeBulbSystem` admits (single pure `bulb` map at weight 1,
 *   flat, non-singular, no final, no kaleidoscope). A SIXTH core rather
 *   than a fourth `foldKind` on the escape one: the escape bodies
 *   dispatch on `kind != 2` / `kind != 1`, so a new kind value would
 *   silently run BOTH folds. Everything structural is the escape core's:
 *   the one forward map rides the 208..271 VARIANT block ({@link
 *   packBulbGpuParams}), the maps storage binding is NOT DECLARED,
 *   `width`/`sharedFrontier`/`bnbStage2`/`shadeDeWidth` are inert,
 *   `maxDepth` is the orbit's iteration budget (`BULB_ITERATIONS` full,
 *   preview-clamped through the same `run.maxDepth` door), and a
 *   fold-final `lens` THROWS (the bulb gate refuses final transforms
 *   too). THREE terms carry more than their weight and every one of
 *   them is invisible to an identity-or-rotation fixture, so the bench
 *   pins them with a uniformly SCALED system: `dr` seeds at
 *   `sigma_max(M)` (not 1 — `dy_0/dp` IS `M`), the recurrence's
 *   trailing `+ sigma_max(M)` is `escape-de.ts`'s `+ 1` carried through
 *   `M` (and FLOORS `dr`, which matters here because `8|y|⁷` shrinks
 *   wherever `|y| < 1`), and the estimate reads `|y|` — the PRE-power
 *   vector — never `|v|`. Its hit-info trap is the continuous escape
 *   count in the power-map form (the classic
 *   `log(log r / log R) / log n`, not the fold arm's constant-factor
 *   `log(r/R)/log(growth)`).
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
 *   wraps it in `descendLens4`'s branch sweep at refine=TRUE (fr-rsp6
 *   phase 2B: this core IS the refined estimator, so its root descents
 *   take the inner cutoff — THE FOLD-LENS WRAPPER below).
 * - `core: "fold4"` (fr-rsp6 phase 2A) is the FOLD frontier one
 *   dimension up — `surface-de-4d.ts`'s `descendFold4` refine=FALSE,
 *   behind the identical view lift — for the 4D systems whose BASE maps
 *   fold (`deHasFolds4`, the CPU's own routing key). refine=false is
 *   3D's fold-core precedent, not a shortcut: the fold GLSL marches the
 *   plain estimator, and phase 1 measured refinement a value no-op on
 *   pure-fold systems. FOUR DELTAS from the 3D fold core, all the
 *   oracle's: the branch fans are 81 boxfold / 3 spherefold / 243
 *   mandelbox (`b = selX + 3·selY + 9·selZ + 27·selW`, mandelbox
 *   `b = boxIndex + 81·sphereIndex`, so the sphere branch turns over
 *   every 81st index and the mid-branch shell guard skips `b += 80`);
 *   every radius is `segmentRadius4` (the fr-wa6o slab, per-axis
 *   region-distance relaxation included); the kaleidoscope sweeps ONE
 *   backward-step 4x4; and there is NO bound centre and NO fr-3c0k
 *   footprint cap (the loop runs plain `params.maxDepth`). Pack exactly
 *   like "affine4". `width` and `shadeDeWidth` are LIVE (the frontier
 *   and its fr-p8bc probe); `sharedFrontier` and `bnbStage2` are inert
 *   by 3D's measured verdicts — shared frontier 2-3.3x slower,
 *   stage-2 skips 1.4-1.6x slower — so this core emits the private
 *   frontier and the stage-1 floor prune ALONE. The skips are value
 *   no-ops, so agreement against the oracle is untouched by their
 *   absence. `lens` wraps it in the SAME `descendLens4` sweep at
 *   refine=FALSE (fr-rsp6 phase 2B): the wrapper hands this core cutoff
 *   0, exactly the CPU's `refine ? innerCutoff : 0`.
 *
 * All six bodies share the public signature — `surfaceDE(pIn, cutoff,
 * li)` — so the mode entry points below are textually identical
 * whichever core is picked. The two 3D DESCENT cores additionally share
 * the descent PROLOGUE text (lens, sphere bound, bail threshold, fr-3c0k
 * depth cap) for the same reason `renameToProbe` exists: one text cannot
 * drift from itself; the two 4D cores share the same prologue SHAPE
 * (view lift, slab seed, 4D lens, sphere bound, bail threshold) written
 * per body, since only one of them carries a frontier to seed. (The two FORWARD cores deliberately have NO
 * prologue — those are inverse-descent concepts, and their GLSL arms
 * replace the descent bodies wholesale.) `core: "affine"` IGNORES `width` (the
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
 * THE 4D ARM (fr-rsp6 phase 2B) lifts the same wrapper to `core:
 * "affine4"`/`"fold4"` as `descendLens4` (surface-de-4d.ts), with three
 * deltas the 3D text has no room for:
 *
 * - THE WRAPPER OWNS THE VIEW LIFT. 3D's cores take world points and
 *   keep their signatures untouched under the lens; the 4D cores derive
 *   their 4D query in their own PROLOGUE, so the sweep would redo the
 *   rotor apply per branch and — worse — could not hand a branch its
 *   transported preimage at all. Under the lens the prologue's lift and
 *   slab seed hoist into the wrapper, once, and the core's signature
 *   becomes `surfaceDECore(qIn: vec4f[, qExt: vec4f], cutoff, li)` (the
 *   hit-info and probe twins likewise). Everything after that line is
 *   the no-lens body's own text: the cores keep their `finalApply4`
 *   lines, which the packer's IDENTITY final rows make a bit-exact
 *   no-op ({@link packSurface4GpuParams}, `final` null whenever
 *   `foldFinal` is set — 3D's invariant one dimension up).
 * - THE REFINE SEAM. `descendLens4` routes its root descents
 *   `hasFolds ? descendFold4(…, refine ? innerCutoff : 0) : refine ?
 *   descend4Refined(…, innerCutoff) : descend4(…)`, and each kernel core
 *   mirrors ONE arm: "affine4" is the REFINED estimator, so it takes the
 *   fr-55r5 inner cutoff `min(best, cutoff) / factor`; "fold4" is the
 *   PLAIN frontier, so it takes 0. Swapping them would silently mirror
 *   an estimator no oracle pins.
 * - THE 4D QUANTITIES. 81/3/243 branch fans with the four-digit box code
 *   (mandelbox sphere branch every 81st index, shell guard skipping
 *   `b += 80u`), `segmentRadius4` in place of every `length` so a
 *   fr-wa6o slab rides through the lens (boxfold lenses only —
 *   `slabExact4`, which the packer now enforces), and an ORIGIN-anchored
 *   visible ball at the FULL 4D radius `params.visRadius4`, NOT the
 *   frozen `visibleRadius` slot this core fills with the slice-adjusted
 *   march gate. The lens itself rides the params block APPENDED past the
 *   4D tail ({@link SURFACE_GPU_PARAMS4_LENS_BYTES}), declared in the
 *   `Params` struct only under the lens, so every no-lens 4D kernel's
 *   text stays byte-identical.
 *
 * THE BALLOON WRAPPER (`balloon`, fr-5wlv.5) composes
 * `balloon-de.ts`'s `estimateBalloonDistance` — the inverted-union scene
 * `min(DE(p), (|p−c|/rho)·DE(I(p)))`, the SURFACE_BALLOON GLSL arm's
 * WGSL twin — over the compiled variant's PUBLIC names: the lens
 * mechanism one level further out. After the (optional) lens composition
 * produces the block owning `surfaceDE`/`surfaceDEProbe`/
 * `surfaceDEHitInfo`, those publics rename `…Fractal` and an appended
 * wrapper owns the public names, so the mode entries' call sites stay
 * textually untouched and ANY 3D descent variant (fold/affine, lens or
 * not) composes. The shell term's inner cutoff scales by the inverse of
 * its value factor (`cutoff / scale`), preserving the fr-55r5 contract
 * verbatim (the oracle's module doc carries the argument). Tap routing
 * is the GLSL arm's: march/normal/AO ride the union, the SHADOW tap
 * calls `…Fractal` directly (the balloon receives shadows, never casts
 * them), and the hit-info wrapper argmin-routes to the winning term's
 * own query point (ties → fractal), reporting it as `colorPos` for the
 * height/radius color sources. Balloon mode also swaps the march
 * entry's visible-sphere gate for the oracle's far cap and the shade
 * entry's defensive no-intersection miss for a clamped fog origin
 * (march-entry semantics decided on the oracle, fr-5wlv.3). Balloon
 * params ride the appended {@link SURFACE_GPU_PARAMS_BALLOON_BYTES}
 * block — {@link packSurfaceGpuParams}'s third argument. `core:
 * "escape"` THROWS (the escape solid's interior reaches the ball
 * center, so its echo swallows the camera — fr-5wlv.4's measured
 * verdict; escape sessions render plain), the 4D cores throw (the 4D
 * lift is a later fr-5wlv child), and balloon + nonzero footprint
 * throws at pack. Absent or false generates byte-identical source to
 * the pre-balloon generator for every config.
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
 * true` wraps any DESCENT core in `descendLens`'s branch sweep (both 3D
 * cores; both 4D cores as `descendLens4` since fr-rsp6 phase 2B — THE
 * FOLD-LENS WRAPPER above), with the lens fields appended to the params
 * uniform. Footprint under a lens stays out ({@link
 * packSurfaceGpuParams} throws for 3D; the 4D packer refuses ANY
 * footprint already — the app path always passes 0). Stage C
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
 * Params uniform — {@link SURFACE_GPU_PARAMS_BYTES} = 288 bytes:
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
 *         192  vec3f fwd                 204  f32 fogDensity (fr-5h5d;
 *              former pad1 — the depth-fog density multiplier every core's
 *              shade entry reads, {@link SurfaceGpuRunParams.fogDensity}
 *              defaulting to 1 when the caller omits it)
 *         208..287 — the VARIANT block, keyed on the kernel config
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
 *              272 vec4f lensFold (fr-s9ll) — the lens fold's three
 *                  AUTHORED lengths (minRadius, fixedRadius, boxLimit)
 *                  plus a packed-zero spare, `resolveFoldRadii`'s own
 *                  output. The wrapper re-derives the branch algebra
 *                  through the generated `foldRadiiOf`, which is
 *                  `surfaceFoldRadii` field for field; zeros when there
 *                  is no lens, which the wrapper never reads.
 *          · `core: "escape"` (fr-dlxh) — the HEAD LINK's forward map in
 *              the same interleave:
 *              208 vec3f escM row0    220 f32 escT.x
 *              224 vec3f escM row1    236 f32 escT.y
 *              240 vec3f escM row2    252 f32 escT.z
 *              256 vec4f escParams — (foldKind as f32, w, derivGrowth,
 *                  0), the GLSL `uEscParams` order plus the packed-zero
 *                  spare. `escT` is the map's PRE-fold offset; the
 *                  per-iteration offset is the query point itself
 *                  (fr-7u8t.8's Mandelbrot form), so no wire field
 *                  carries it — and the spare stays reserved for the
 *                  1-or-0 form scale a Julia arm would need.
 *              272 vec4f padF — the lens block's fold-lengths slot, PAD
 *                  here: this core's links carry their own lengths on the
 *                  maps binding, and the slot exists so the shared
 *                  plane/balloon block below lands at ONE offset across
 *                  every 3D core (fr-s9ll).
 *              Since fr-s04t the KERNEL reads every link — the head
 *              included — from the maps storage binding below, and this
 *              block is layout ballast: its offsets are frozen (the
 *              ground-plane block lands at 272 behind it) and it cannot
 *              drift from the list, `EscapeDE`'s flat fields being
 *              `links[0]`'s by construction. `symOrder`/`symPlane` in the
 *              frozen block carry the query-space wedge fold (not a
 *              sector sweep — the `stepCos`/`stepSin` pair stays inert),
 *              and `mapCount` the LINK COUNT the orbit cycles through.
 *          · `core: "bulb"` (fr-7u8t.9) — the escape block's interleave
 *              one formula over, and the whole `BulbDE` fits it: the
 *              map is `m`/`t` and everything else is two scalars, so
 *              the block ends at the frozen 272 exactly like escape's:
 *              208 vec3f bulbM row0   220 f32 bulbT.x
 *              224 vec3f bulbM row1   236 f32 bulbT.y
 *              240 vec3f bulbM row2   252 f32 bulbT.z
 *              256 vec4f bulbParams — (sigmaMax, bailout, 0, 0), the
 *                  GLSL `uBulbParams` order plus two packed-zero
 *                  spares. `bulbT` is the map's PRE-power offset (the
 *                  textbook Mandelbulb is `t = 0`); the per-iteration
 *                  offset is `y_0 = M p + t`, derived in the body from
 *                  the query point itself (the Mandelbrot form), so no
 *                  wire field carries it. `bailout` is the ORBIT's ball
 *                  and is NOT the frozen block's `boundingRadius`,
 *                  which stays the query-space marching ball
 *                  (`BulbDE.boundingRadius`, ~1.1-1.35) — the one place
 *                  this core's wire differs from escape's, where the
 *                  two happened to be the same number. `BULB_POWER` is
 *                  baked into the body, never packed (triplex
 *                  multiplication is not associative, so every power
 *                  needs its own closed form — bulb-de.ts's
 *                  `BULB_POWER` doc).
 *              272 vec4f padF — the escape core's pad again; the bulb has
 *                  no fold at all.
 *          · `balloon: true` (fr-5wlv.5) — the 3D block GROWS: {@link
 *              SURFACE_GPU_PARAMS_BALLOON_BYTES} = 320 bytes total. The
 *              struct declares the lens variant block UNCONDITIONALLY
 *              (zero-filled by the packer when no lens — the buffer was
 *              always the full base size; only the struct declaration
 *              ended early), so these land at the FROZEN offset 288
 *              (fr-s9ll moved it from 272 for the lensFold quartet):
 *              288 vec3f balloonCenter
 *              300 f32  balloonRho — MARGINED (`buildBalloon`'s divisor)
 *              304 f32  balloonR — world units
 *              308 f32  balloonFar — BALLOON_FAR_CAP_RHO · raw ball
 *                  radius (the march far cap past the center)
 *              312 f32  padB0        316 f32 padB1   (packed zero)
 *              Never combined with the escape or 4D variants (codegen
 *              throws).
 *          · `core: "affine4"` (fr-dlxh's 4D cut) — the variant block
 *              GROWS: {@link SURFACE_GPU_PARAMS4_BYTES} = 464 bytes
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
 *              424 f32 final4SigmaMin 428 f32 visRadius4
 *              432 vec4f radiusCenter4 (fr-skhv)
 *              448 f32 radiusMinD     452 f32 radiusInvRange
 *              456 f32 pad4a          460 f32 pad4b   (packed zero)
 *              In this core the frozen block's `visibleRadius` carries
 *              the SLICE-ADJUSTED sliceVisR (the slab's widest 3D
 *              shadow, surface-material-4d.ts's march gate — what the
 *              sphere gate, shadow clamp and fog want), `visRadius4`
 *              keeps the FULL 4D visible radius (the HEIGHT color
 *              source's slice-INVARIANT normalizer, and
 *              `descendLens4`'s visible ball), the radiusCenter4/
 *              radiusMinD/radiusInvRange trio is `SurfaceDE4.radiusBand`
 *              on the wire (fr-skhv: the RADIUS color source normalizes
 *              the hit's center-relative 4D distance over the visible
 *              set's own [minD, maxD] band, `buildColors4`'s radius
 *              convention — still slice/rotor-invariant, the band is an
 *              attractor-frame constant), and `boundCenter` packs
 *              the origin (the 4D oracle is origin-anchored by
 *              construction).
 *          · a 4D core under `lens: true` (fr-rsp6 phase 2B) — the tail
 *              GROWS again, APPENDED past 464: {@link
 *              SURFACE_GPU_PARAMS4_LENS_BYTES} = 576 bytes total, and
 *              {@link packSurface4GpuParams} returns exactly this size
 *              when (and only when) the DE carries a `foldFinal`:
 *              464 vec4f lens4M row0..row3   (..527)
 *              528 vec4f lens4T
 *              544 vec4f lens4Params — (foldKind as f32, invW, absW,
 *                  sigmaMin), the GLSL `uLensParams` order again.
 *              560 vec4f lens4Fold (fr-s9ll) — the 3D `lensFold` quartet
 *                  at the 4D block's own offset; nothing follows the
 *                  lens4 block, so it grows in place.
 *              The cores' own final4M/final4T rows still pack
 *              IDENTITY/0 here (`final` is null whenever `foldFinal` is
 *              set), so the core bodies run their no-lens arithmetic
 *              and the wrapper alone applies the lens.
 *
 * Maps storage — {@link SURFACE_GPU_MAP_VEC4} vec4f per map ({@link
 * SURFACE_GPU_MAP_STRIDE_BYTES} bytes), matching WGSL `struct GpuMap`:
 *   r0  = invM row0 xyz, invT.x        r1 = invM row1 xyz, invT.y
 *   r2  = invM row2 xyz, invT.z
 *   p0  = sigmaMin, foldInvW, foldSigma, foldKind (0/1/2/3 as f32)
 *   bnb = bnbDir xyz, invTNorm
 *   p1  = invMSigmaMin, 0, 0, 0
 *   fold = minRadius, fixedRadius, boxLimit, 0 (fr-s9ll) — the map's
 *          three AUTHORED fold lengths, `resolveFoldRadii`'s output. The
 *          body re-derives the branch algebra from them through the
 *          generated `foldRadiiOf` (`surfaceFoldRadii` field for field)
 *          rather than reading eight packed combinations; a plain-affine
 *          slot carries the classic (0.5, 1, 1) and never reads them.
 * `core: "escape"` shares that layout for its formula CHAIN (fr-s04t,
 * {@link packEscapeGpuMaps}) — one entry per LINK in document order,
 * carrying FORWARD affines in r0/r1/r2 and the GLSL `uEscParams` quartet
 * (foldKind, w, derivGrowth, 0) in p0, with bnb/p1 zero: the same
 * "one layout, lanes a core may ignore" contract the affine cores already
 * ride. Its `fold` lane says something DIFFERENT from the descent cores' —
 * (minRadius², fixedRadius², boxLimit, 0), the form `EscapeLink` keeps and
 * the form the forward orbit's `fR²/clamp(r², mR², fR²)` wants — exactly
 * as its `p0` already differs from theirs. Each packer transfers its own
 * oracle's numbers rather than recomputing them, which is the whole reason
 * a lane may mean two things here.
 *
 * 4D maps storage (`core: "affine4"` / `core: "fold4"`) — {@link
 * SURFACE_GPU_MAP4_VEC4} vec4f per map, matching WGSL `struct GpuMap4`:
 *   r0..r3 = invM rows 0..3 (row-major)    t = invT
 *   p0     = sigmaMin, foldInvW, foldSigma, foldKind (0/1/2/3 as f32)
 *   bnb    = bnbDir (a whole vec4 up here — 3D squeezes invTNorm into
 *            its .w; in 4D the direction fills the lane)
 *   p1     = invTNorm, invMSigmaMin, 0, 0
 *   fold   = the 3D lane exactly (minRadius, fixedRadius, boxLimit, 0):
 *            `SurfaceFoldRadii` is SHARED by the two oracles, so a 3D
 *            system and its 4D lift cannot disagree about what an absent
 *            field means (fr-s9ll)
 * ONE layout for both 4D cores, exactly as the 3D GpuMap carries the
 * fold lanes for a core ("affine") that never reads them (fr-rsp6
 * phase 2A): the affine4 body reads `p0.x` alone, the fold4 body reads
 * the whole `p0`, and NEITHER reads `bnb`/`p1` — those are packed for
 * layout parity with 3D and for the stage-2 branch-and-bound work the
 * fold4 kernel deliberately does not emit (fr-kidj's skips measured
 * 1.4-1.6x SLOWER GPU-side in 3D).
 *
 * March state — one vec4f per ray: (t, status, steps, lastD), host-
 * initialized to `(-1, 0, 0, 0)`; `t < 0` means the sphere gate has not
 * run yet. Status vocabulary: {@link SURFACE_GPU_RAY_ACTIVE} /
 * `_HIT` / `_MISS` / `_EXHAUSTED`, plus `_PLANE` in `groundPlane: true`
 * kernels (fr-rhn5) — a MISS the march classified as crossing the
 * ground plane inside its fade band, shaded by the shade entry's plane
 * arm and priced host-side WITH the hits (it pays a hit's shadow/AO
 * probe evals). Ground-plane params ride the {@link
 * SURFACE_GPU_PARAMS_PLANE_BYTES} block (layout on the constant's doc).
 *
 * Shade uniform (march "unproject" + mode "shade") — {@link
 * SURFACE_GPU_SHADE_BYTES} = 144 bytes, WGSL `struct ShadeParams`:
 *   offset 0..63 mat4x4f invProjView (column-major, the exact
 *                THREE.Matrix4.elements scene.ts uploads as uInvProjView)
 *          64  vec3f lightDir          76  f32 ambient
 *          80  vec3f bgTop             92  f32 colorSpeed
 *          96  vec3f bgBottom         108  f32 tracePixelEps
 *         112  u32  colorSource       116  u32 shadowSteps
 *         120  u32  aoTaps            124  u32 flags (bit0 = dither)
 *         128  vec3f fogTint          140  f32 fogTintStrength
 *         144  vec2f pixelJitter     (152..159 struct alignment pad)
 * fogTint/fogTintStrength (fr-5h5d) retarget the shade entry's fog blend
 * to mix(bg, fogTint, fogTintStrength) — strength 0 (the default) is the
 * identity (fog blends toward bg alone), and misses never read it.
 * pixelJitter (fr-vpbq) is the sub-pixel position every ray derivation
 * aims at inside its pixel; its default (0.5, 0.5) is the pixel centre
 * those derivations used to spell as a literal, so an unset jitter is the
 * pre-supersampling kernel value for value.
 *
 * Shade maps storage (mode "shade") — one vec4f per map slot:
 * (uMapColor rgb, uFoldParams.w trapIndex); one zero stride when empty,
 * like {@link packSurfaceGpuMaps}.
 *
 * Bindings per mode — eval and march "pose" bind 0-3 (params, maps, the
 * mode's own pair at 2/3); march "unproject" binds 0-4, the march set
 * plus shade: ShadeParams (rays + dither inputs only — it declares none
 * of shadeMaps/colorOut/lutTex/lutSamp); mode "shade" binds 0-8. The
 * BULB core never declares binding 1 (maps) in any mode — its one forward
 * map rides the params variant block — so its hosts skip that buffer;
 * the ESCAPE core DOES declare it (fr-s04t: its chain is a list of
 * forward maps, one `GpuMap` per link); the AFFINE4 core declares binding 1 as
 * `array<GpuMap4>` (pack with {@link packSurfaceGpuMaps4}), and under
 * `mapsUniform: true` (fr-b72d probe, option doc) that binding becomes
 * a fixed-size UNIFORM array — `array<GpuMap4, `{@link
 * SURFACE_GPU_UNIFORM_MAP_SLOTS}`>` — with the matching host-side
 * usage/layout/size obligations; every
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

export const SURFACE_GPU_PARAMS_BYTES = 288;
/** Params size under `balloon: true` (fr-5wlv.5): the 272-byte 3D block
 * — variant members declared unconditionally, zero-filled when no lens —
 * plus the appended balloon block at the frozen offset 272 (layout
 * contract in the module doc). {@link packSurfaceGpuParams} returns THIS
 * size exactly when its `balloon` argument is non-null, and the 272-byte
 * buffer byte for byte when it is null — a no-balloon kernel's struct
 * ends at 208/272 and never reads past it, but a BALLOON kernel's struct
 * is 304 bytes, so its hosts must bind a buffer packed with the balloon
 * argument. */
export const SURFACE_GPU_PARAMS_BALLOON_BYTES = 320;
/** Params size under `groundPlane: true` (fr-rhn5): the 272-byte 3D
 * block — variant members declared unconditionally, zero-filled when no
 * lens (or carrying the escape core's forward map) — plus the appended
 * plane block at the frozen offset 272, which the plane and balloon
 * blocks SHARE (the escape/lens 208..271 precedent: the two features are
 * mutually exclusive by construction — both the codegen and the packers
 * throw on the pair). Layout: y 272, fadeStart 276, fadeEnd 280,
 * ballRadius 284, ballCenter vec3f 288, albedo vec3f 304.
 * {@link packSurfaceGpuParams}/{@link packEscapeGpuParams} return THIS
 * size exactly when their `groundPlane` argument is non-null, and their
 * usual buffer byte for byte when it is null. */
export const SURFACE_GPU_PARAMS_PLANE_BYTES = 336;
/** Params size for `core: "affine4"` — the frozen 0..207 block plus the
 * 4D variant tail (layout contract in the module doc). The other cores'
 * structs still end at 208/272; binding the larger buffer to them would
 * be valid, but hosts size per core. */
export const SURFACE_GPU_PARAMS4_BYTES = 464;
/** Params size for a 4D core under `lens: true` (fr-rsp6 phase 2B): the
 * 464-byte tail above plus the appended lens4 block (layout contract in
 * the module doc). {@link packSurface4GpuParams} returns THIS size exactly
 * when the DE carries a `foldFinal`, and the 464-byte buffer byte for byte
 * when it does not — a no-lens kernel's struct ends at 464 and never reads
 * past it. */
export const SURFACE_GPU_PARAMS4_LENS_BYTES = 576;
export const SURFACE_GPU_MAP_VEC4 = 7;
export const SURFACE_GPU_MAP_STRIDE_BYTES = SURFACE_GPU_MAP_VEC4 * 16;
/** vec4f slots per 4D map (`struct GpuMap4`): four invM rows, invT, and
 * the three parameter lanes p0/bnb/p1 (fr-rsp6 phase 2A grew it from 6 —
 * the fold lanes the fold4 core decodes, plus the stage-2 lanes both 4D
 * cores leave unread). The field layout is its own contract; nothing
 * shares sizing math with the 3D {@link SURFACE_GPU_MAP_VEC4}. */
export const SURFACE_GPU_MAP4_VEC4 = 9;
/** Byte size of the ShadeParams uniform (march "unproject" + mode
 * "shade"; layout contract in the module doc). 144 through fr-5h5d's fog
 * tint pair, then 160 with fr-vpbq's `pixelJitter` at 144 — a WGSL
 * uniform struct rounds to its largest member's 16-byte alignment, so the
 * vec2f costs a full stride. */
export const SURFACE_GPU_SHADE_BYTES = 160;
/** Map slots a `mapsUniform: true` 4D kernel declares (fr-b72d probe):
 * uniform-address-space arrays need a creation-fixed footprint, so the
 * binding becomes `array<GpuMap4, 24>` and the HOST must bind a buffer of
 * at least `SURFACE_GPU_UNIFORM_MAP_SLOTS * SURFACE_GPU_MAP4_VEC4 * 16`
 * = 3456 bytes (WebGPU validates the full type size at bind-group
 * creation; slots past `params.mapCount` are never read, and WebGPU
 * zero-fills fresh buffers, so a short `packSurfaceGpuMaps4` write into a
 * full-size buffer is complete). 24 matches the app's 4D eligibility cap
 * (`SURFACE4_MAX_MAPS`, surface-material-4d.ts — enforced for every 4D
 * surface entry in main.ts, compute-only fold shapes included), so no
 * eligible system can overflow the fixed array. */
export const SURFACE_GPU_UNIFORM_MAP_SLOTS = 24;

/** Ray-state status codes (the `y` component of a march state vec4).
 * PLANE (fr-rhn5) exists only in `groundPlane: true` kernels: a MISS
 * whose ray crosses the ground plane inside the fade band — the host
 * prices these WITH the hits (they pay the shadow/AO probe evals a hit
 * pays), where plain misses stay one background write. */
export const SURFACE_GPU_RAY_ACTIVE = 0;
export const SURFACE_GPU_RAY_HIT = 1;
export const SURFACE_GPU_RAY_MISS = 2;
export const SURFACE_GPU_RAY_EXHAUSTED = 3;
export const SURFACE_GPU_RAY_PLANE = 4;

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
   * for `analyzeEscapeSystem` systems, CYCLING through its formula chain
   * since fr-s04t — pack with {@link packEscapeGpuParams} AND
   * {@link packEscapeGpuMaps} (binding 1 carries one `GpuMap` per link),
   * same inert options as "affine", and `lens` throws.
   * "affine4" (fr-dlxh's 4D cut) is the refined ladder ONE DIMENSION UP
   * — `surface-de-4d.ts`'s `estimateDistance4Refined` behind the view
   * lift (rotor + w0 + fr-wa6o slab) — for `analyzeSurfaceSystem4`
   * systems: pack with {@link packSurface4GpuParams} +
   * {@link packSurfaceGpuMaps4} (binding 1 is `array<GpuMap4>`), same
   * inert options as "affine", and a nonzero `footprint` throws at pack.
   * `lens` is LIVE since fr-rsp6 phase 2B — `descendLens4`'s branch
   * sweep around this REFINED core, i.e. `descendLens4(refine=true)`.
   * "fold4" (fr-rsp6 phase 2A) is the FOLD frontier one dimension up —
   * `surface-de-4d.ts`'s `descendFold4` refine=FALSE (3D's fold-core
   * precedent: refinement measured a value no-op on pure-fold systems)
   * behind the same view lift — for 4D systems whose base maps fold.
   * Pack it exactly like "affine4" (same params tail, same `GpuMap4`
   * maps, same footprint throw); `width` is LIVE here as it is under
   * "fold", `shadeDeWidth` emits the same probe descent, and
   * `sharedFrontier`/`bnbStage2` are inert by measured 3D verdict (see
   * their own docs). `lens` wraps it in the same sweep at
   * `descendLens4(refine=FALSE)` — the core cutoff the wrapper hands
   * down is the CPU's `refine ? innerCutoff : 0`, so this arm passes 0.
   * "bulb" (fr-7u8t.9) is the escape core's SIBLING — `bulb-de.ts`'s
   * `estimateBulbDistance`, the forward triplex-power orbit — for
   * `analyzeBulbSystem` systems: pack with {@link packBulbGpuParams},
   * skip the maps buffer (binding 1 is not declared), same inert
   * options as "escape", and `lens`/`balloon` throw for the same
   * reasons. Deliberately NOT a fourth `foldKind` on the escape core:
   * those bodies dispatch on `kind != 2` / `kind != 1`, so an
   * unrecognized kind would silently run both folds. */
  core?: "fold" | "affine" | "escape" | "affine4" | "fold4" | "bulb";
  /** Emit the FOLD FINAL-transform lens wrapper (fr-55s1 stage B —
   * `descendLens`, fr-g58b's vocabulary; fr-rsp6 phase 2B lifts it to
   * the 4D cores as `descendLens4`): the descent body (any core but
   * "escape") is renamed `surfaceDECore` and a new `surfaceDE` sweeps
   * the lens's inverse fold branches around it, each an affine-lensed
   * core descent — so the mode entries' call sites are untouched text.
   * Absent or false reproduces the no-lens source byte for byte. Branch
   * kind and count are RUNTIME params (one pipeline per session, GLSL
   * parity). In shade mode the hit-info descent gets the same treatment
   * (renamed core + argmin-sweep wrapper) and the probe, when emitted,
   * its own renamed sweep — fr-55s1 stage C. Under the 4D cores the
   * wrapper additionally OWNS THE VIEW LIFT — a documented deviation
   * from 3D's untouched-core signatures, forced by where the lift lives
   * (THE FOLD-LENS WRAPPER in the module doc) — and the lens rides the
   * appended {@link SURFACE_GPU_PARAMS4_LENS_BYTES} params block. */
  lens?: boolean;
  /** Wrap the compiled variant in the BALLOON inverted-union (fr-5wlv.5
   * — `balloon-de.ts`'s `estimateBalloonDistance`, the SURFACE_BALLOON
   * GLSL arm's WGSL twin): after the (optional) lens composition
   * produces the block owning the public names — core, or lens wrapper
   * over core — those publics rename one level out to
   * `surfaceDE*Fractal` and an appended wrapper owns the public
   * `surfaceDE`/`surfaceDEProbe`/`surfaceDEHitInfo`, evaluating
   * `min(DE(p), (|p−c|/rho)·DE(I(p)))` over them — the lens's
   * token-rename mechanism one level further out, composing over ANY 3D
   * descent variant (fold/affine, lens or not), so the mode entries'
   * call sites stay textually untouched (THE BALLOON WRAPPER in the
   * module doc). Balloon params ride the appended {@link
   * SURFACE_GPU_PARAMS_BALLOON_BYTES} params block ({@link
   * packSurfaceGpuParams}'s third argument — a balloon kernel must be
   * fed a balloon-packed buffer). Absent or false reproduces the
   * no-balloon source byte for byte. `core: "escape"` THROWS — the
   * escape solid's interior reaches the ball center, so its echo
   * swallows the camera (fr-5wlv.4's measured verdict); escape sessions
   * render plain — and the 4D cores throw (the 4D lift is a later
   * fr-5wlv child). */
  balloon?: boolean;
  /** Ground plane (fr-rhn5): an infinite one-sided floor below the
   * session ball that MISS rays classify against in the march — a ray
   * crossing the floor inside the fade band terminates {@link
   * SURFACE_GPU_RAY_PLANE} instead of MISS (both sphere-gate early-outs
   * and the step loop's sphere exit; EXHAUSTED never planes) — and the
   * shade entry lights at the analytic crossing with the hit path's
   * penumbra-shadow/AO loops (probe-width discipline included), fog and
   * a radial fade into the pixel's own backdrop, mirroring the
   * SURFACE_GROUND_PLANE GLSL arm term for term. Plane quantities ride
   * the appended {@link SURFACE_GPU_PARAMS_PLANE_BYTES} params block
   * ({@link packSurfaceGpuParams}/{@link packEscapeGpuParams}'s
   * `groundPlane` argument — a plane kernel must be fed a plane-packed
   * buffer). Absent or false reproduces the no-plane source byte for
   * byte. `balloon` THROWS (the enclosing shell has no horizon for a
   * floor to sit on — the GLSL arm refuses the same pair) and the 4D
   * cores throw (fr-rhn5 is 3D-scoped); both FORWARD cores are supported
   * — the classic Mandelbox/Mandelbulb floor — and `lens` composes exactly as the
   * GLSL side's stripped lens+plane program does. Inert in eval mode
   * (no rays terminate). */
  groundPlane?: boolean;
  /** March-mode ray derivation. "pose" (default) keeps the bench baseline:
   * NDC pixel centers against the pose basis — byte-identical output to
   * the pre-shade-split generator. "unproject" derives rays the GLSL
   * tracer's way (near/far clip points through shade.invProjView, with
   * params.ro as uCamPos) and adds the flag-gated march-start hash dither
   * — the app path, where inset/centered-projection parity matters.
   * Ignored outside march mode. */
  rays?: "pose" | "unproject";
  /** Frontier width — `SURFACE_FOLD_BEAM_WIDTH` for production parity;
   * the bench sweeps 12/8/6/4 to reproduce fr-ck0w's width curve. LIVE
   * under `core: "fold"` and `core: "fold4"`. IGNORED under the fixed
   * width-4 ladders `core: "affine"`/`"affine4"` (still validated, so a
   * bad value is caught wherever it came from). */
  width: number;
  /** Shade-mode only: frontier width for the shading PROBE evals — the
   * normal/shadow/AO taps in `shadeRays` (fr-p8bc; module doc). When set
   * and ≠ `width`, a second descent `surfaceDEProbe` is emitted at this
   * width (always private frontier arrays) and the probe taps call it.
   * Absent or equal to `width` reproduces the pre-fr-p8bc source byte
   * for byte. Honored by both FRONTIER cores ("fold" and, since fr-rsp6
   * phase 2A, "fold4" — same one-text-two-names derivation). Ignored
   * outside shade mode. */
  shadeDeWidth?: number;
  /** Threads per workgroup. */
  workgroupSize: number;
  /** Workgroup-shared (banked, transposed) frontier vs private arrays.
   * Inert under `core: "affine"`/`"affine4"` — the unrolled ladders keep
   * their four chains in scalars, so there is no frontier to place — and
   * under `core: "fold4"`, whose frontier is ALWAYS function-scope
   * private: 3D measured the workgroup-shared variant 2-3.3x SLOWER, so
   * the 4D port ships the winner alone rather than re-emitting a banked
   * body no one would select ({@link surfaceGpuWorkgroupBytes} stays 0
   * there). */
  sharedFrontier: boolean;
  /** Include the fr-kidj stage-2 branch-and-bound skips (value no-ops).
   * Inert under `core: "affine"`/`"affine4"` — the skips bound FOLD
   * branch enumeration, and the ladders enumerate none — and under
   * `core: "fold4"`, which does not emit them at all: 3D measured them
   * 1.4-1.6x slower GPU-side at both far-field and near-surface poses,
   * and they are value no-ops, so their absence costs the 4D kernel
   * nothing against its oracle (the 4D oracle additionally bypasses them
   * whole under a slab query — `descendFold4`'s SEGMENT BYPASS note). */
  bnbStage2: boolean;
  /** fr-d0nn's register-pressure probe for fr-b72d (module doc): the
   * order-6 kaleidoscope-4D sweep runs ~35x slower on compute than the
   * same estimator's fragment GLSL, and the suspected mechanism is the
   * extra live `ext` vec4f registers the fr-wa6o slab threads through
   * every beam-ladder tuple. Meaningful ONLY under the 4D cores
   * `"affine4"` and `"fold4"` (fr-rsp6 phase 2A) — inert everywhere
   * else, exactly like `width`/`sharedFrontier`/
   * `bnbStage2` under `core: "affine"`. Absent or `true` reproduces
   * today's fr-wa6o slab source byte for byte. `false` emits the
   * 4D descent and hit-info bodies WITHOUT the half-extent
   * machinery: every `segmentRadius4(x, xExt)` call becomes `length(x)`,
   * and the `ext`/`aExt`/…/`imgExt`/`jExt` registers plus their
   * `if (params.sliceHalfW > 0.0)` propagation disappear — under
   * "fold4" that set is `ext`/`sExt`/`eu`/`preExt`/`imgExt` plus the
   * `fcExt`/`fnExt` frontier arrays and the u-space region-distance
   * relaxation the segment needs — the h=0-only kernel. The shared helpers `segmentRadius4`/
   * `mapApplyLinear4`/`finalApplyLinear4`/`rotorInvWCol4` stay declared
   * either way (a struct/function never reads past its own use; Tint
   * DCEs the unused ones). HOST CONTRACT: a `slabExt: false` pipeline
   * must never be fed a packed `sliceHalfW > 0` — the params struct
   * still declares the field, unread by the descent (the shade entry's
   * radius color multiplies it by a hit-info `sStar` this variant pins
   * at 0, fr-9c9e — identically no slab influence), so the body would
   * silently render the h=0 slice; the packer cannot see kernel
   * options, so keeping the two in sync is the caller's obligation. */
  slabExt?: boolean;
  /** fr-b72d's maps-load probe: move the per-map data from the
   * runtime-sized STORAGE buffer to a fixed-size UNIFORM array —
   * `var<uniform> maps: array<GpuMap4, `{@link
   * SURFACE_GPU_UNIFORM_MAP_SLOTS}`>` — leaving every body byte-identical
   * (`maps[j]` is address-space-agnostic in WGSL). The fragment-GLSL 4D
   * tracer this kernel lost to at kaleidoscope order 6 reads its maps
   * from a std140 uniform BLOCK (fr-dqlq), which Mesa serves from the
   * constant cache / push space; the WGSL storage loads sit in the
   * innermost sector-sweep loop AND inside every `refinedCert` re-sweep,
   * behind Tint's runtime-sized-array robustness clamp — the suspected
   * per-iteration tax this option A/Bs. MEASURED VERDICT (real Iris Xe,
   * 2026-08-11, the extended `--surface-aff4-sweep=1` leg): REFUTED —
   * uniform-vs-storage moved nothing at any kaleidoscope order (fold4
   * 0.99x flat, affine4 0.79-1.02x with the regressions at the extremes),
   * values bit-identical throughout, so ANV already serves the
   * dynamically-uniform-index storage loads well and PRODUCTION NEVER
   * SETS THIS. The order-6 superlinearity the probe chased turned out
   * ALGORITHMIC, not realization-specific — the CPU oracle reproduces the
   * kernel's own curve on the same mixes (x13.5 affine4 / x58.9 fold4 at
   * order 6 vs the 6x naive work ratio;
   * `scripts/aff4-order-cpu.harness.ts`). The option stays as the
   * refutation's executable record, pinned by the sweep leg's
   * uniform-vs-storage agreement gates and the codegen tests' one-line-
   * swap equivalence. Meaningful ONLY under the 4D cores
   * (`"affine4"`/`"fold4"`) — structurally inert everywhere else, exactly
   * like `slabExt`. Absent or `false` reproduces the storage binding byte
   * for byte. HOST CONTRACT: a `mapsUniform: true` pipeline needs its
   * maps buffer created with UNIFORM (not STORAGE) usage and sized to the
   * full 24-slot footprint ({@link SURFACE_GPU_UNIFORM_MAP_SLOTS}'s doc),
   * and a bind-group layout whose binding 1 is
   * `{ buffer: { type: "uniform" } }`. */
  mapsUniform?: boolean;
}

/** Workgroup shared-memory bytes the generated kernel declares — what the
 * bench must cover via `maxComputeWorkgroupStorageSize` when it exceeds
 * the 16 384-byte WebGPU default. Zero for the private variant, and zero
 * for every non-`"fold"` core at any `sharedFrontier`: the affine
 * ladders declare no frontier arrays at all (fr-55s1, fr-dlxh's 4D cut),
 * the two forward loops have no frontier concept to begin with (fr-dlxh's
 * escape, fr-7u8t.9's bulb), and
 * the fold4 frontier is private BY CONSTRUCTION (fr-rsp6 phase 2A — 3D
 * measured shared 2-3.3x slower, so the option is inert there). */
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
  /** Depth-fog density multiplier (fr-5h5d), packed at the frozen offset
   * 204 (module doc) by every params packer. Default 1 — the pre-fr-5h5d
   * fixed fog — when omitted, matching the GLSL tracers' own uFogDensity
   * default; 0 disables depth fog in the shade entry's fog term. */
  fogDensity?: number;
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
 *
 * `balloon` (fr-5wlv.5): null — the default — returns today's 272-byte
 * buffer byte for byte; non-null returns {@link
 * SURFACE_GPU_PARAMS_BALLOON_BYTES} bytes with the balloon block packed
 * at the frozen offset 272 (module-doc contract) — `center`/`rho`/`R`
 * in `buildBalloon`'s convention (`rho` MARGINED, the bound's divisor;
 * `R` world units) and `far` the march cap past the center
 * (`BALLOON_FAR_CAP_RHO · raw ball radius`, the GLSL `uBalloonFar`).
 * Balloon + nonzero footprint throws: the wrapper cannot scale the
 * cores' uniform footprint read per term (the oracle's conformal
 * scaling would need a core signature change), and the app path always
 * passes 0.
 */
export function packSurfaceGpuParams(
  de: SurfaceDE,
  run: SurfaceGpuRunParams,
  balloon: { center: Vec3; rho: number; R: number; far: number } | null = null,
  groundPlane: SurfaceGpuGroundPlane | null = null,
): ArrayBuffer {
  if (balloon && groundPlane) {
    throw new Error(
      "surface-de-gpu: groundPlane+balloon: excluded (fr-rhn5) — the two " +
        "blocks share the frozen offset 272 and the kernels refuse the " +
        "pair",
    );
  }
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
  if (balloon && (run.footprint ?? 0) > 0) {
    throw new Error(
      "surface-de-gpu: footprint under the balloon wrapper is out of the " +
        "fr-5wlv.5 cut (the wrapper cannot scale the cores' uniform " +
        "footprint read per term; the app path always passes 0)",
    );
  }
  const buf = new ArrayBuffer(
    balloon
      ? SURFACE_GPU_PARAMS_BALLOON_BYTES
      : groundPlane
        ? SURFACE_GPU_PARAMS_PLANE_BYTES
        : SURFACE_GPU_PARAMS_BYTES,
  );
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
  // fr-5h5d: the former pad1 slot, now the fog density multiplier the
  // shared shade entry reads — default 1 (the pre-fr-5h5d fixed fog).
  view.setFloat32(204, run.fogDensity ?? 1, true);
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
    // fr-s9ll: the lens fold's three AUTHORED lengths at 272, the wire
    // `foldRadiiOf` re-derives the branch algebra from. `SurfaceFoldRadii`
    // keeps `minR` for exactly this — every other field of it is already a
    // combination, and shipping combinations is how a mirror drifts.
    view.setFloat32(272, lens.foldRadii.minR, true);
    view.setFloat32(276, lens.foldRadii.fixedR, true);
    view.setFloat32(280, lens.foldRadii.wall, true);
  }
  // fr-5wlv.5: the balloon block at the frozen offset 288 (module-doc
  // contract) — the GLSL uBalloon* quantities in buildBalloon's
  // convention. The variant block above stays zero-filled when no lens,
  // exactly what the balloon kernel's unconditional struct members read.
  if (balloon) {
    writeVec3(view, 288, balloon.center);
    view.setFloat32(300, balloon.rho, true);
    view.setFloat32(304, balloon.R, true);
    view.setFloat32(308, balloon.far, true);
  }
  // fr-rhn5: the ground-plane block at the frozen offset 288 it SHARES
  // with the balloon block (mutually exclusive — the throw above) — the
  // GLSL uGround* quantities in scene.ts's surfaceGroundPlaneSpec
  // convention.
  if (groundPlane) {
    writeGroundPlane(view, groundPlane);
  }
  return buf;
}

/** The ground plane's wire block (fr-rhn5) — scene.ts's
 * surfaceGroundPlaneSpec convention, all world units: floor height,
 * radial fade band from the session ball's xz center, the ball the
 * shadow/AO gates certify against, and the sRGB floor albedo. */
export interface SurfaceGpuGroundPlane {
  y: number;
  fadeStart: number;
  fadeEnd: number;
  ballCenter: Vec3;
  ballRadius: number;
  albedo: Vec3;
}

/** Write the plane block at its frozen offset (module-doc layout: y 288,
 * fadeStart 292, fadeEnd 296, ballRadius 300, ballCenter 304, albedo
 * 320) — one definition for both 3D packers, which is what keeps the block
 * at ONE offset across cores whose 208..287 blocks say different things
 * (fr-s9ll moved it from 272 to make room for the lens fold's lengths, and
 * the escape/bulb cores declare a matching pad rather than let the shared
 * block land in two places). */
function writeGroundPlane(view: DataView, gp: SurfaceGpuGroundPlane): void {
  view.setFloat32(288, gp.y, true);
  view.setFloat32(292, gp.fadeStart, true);
  view.setFloat32(296, gp.fadeEnd, true);
  view.setFloat32(300, gp.ballRadius, true);
  writeVec3(view, 304, gp.ballCenter);
  writeVec3(view, 320, gp.albedo);
}

/**
 * Pack the params uniform for the ESCAPE core (fr-dlxh; its formula CHAIN
 * since fr-s04t). The frozen offsets carry the escape session's marching
 * quantities — the bailout ball is both bounding and visible sphere,
 * {@link ESCAPE_STEP_SCALE} damps steps (the GLSL variant's
 * `uStepScale`), `maxDepth` is the orbit's iteration budget in PASSES
 * ({@link ESCAPE_TIME_ITERATIONS} full, preview-clamped by
 * `run.maxDepth`), `mapCount` is the LINK COUNT the cycle wraps at, and
 * `symOrder`/`symPlane` are the query-space wedge fold's own order and
 * plane (the `stepCos`/`stepSin` sector-sweep pair stays inert — that is
 * a descent concept) — and the 208..271 VARIANT block carries the HEAD
 * link in the lens rows' interleave, tail vec4f in the GLSL `uEscParams`
 * order (foldKind, w, derivGrowth, 0).
 *
 * That head-link block is the wire's ONE redundancy since fr-s04t, kept
 * deliberately: the bodies read every link — the head included — from the
 * maps storage binding ({@link packEscapeGpuMaps}), but the block's
 * offsets are frozen (the ground-plane block lands at 272 behind it) and
 * a struct member cannot be left undeclared without moving that. It
 * cannot drift, since `EscapeDE`'s flat fields ARE `links[0]`'s.
 *
 * The final packs identity/1 (the escape gate refuses final transforms);
 * `escapeRadius` packs the GLSL's dead `2R` so the wire never carries an
 * uninitialized word; `footprint` packs 0 — a forward loop has no
 * cone-footprint depth cap.
 */
export function packEscapeGpuParams(
  de: EscapeDE,
  run: SurfaceGpuRunParams,
  groundPlane: SurfaceGpuGroundPlane | null = null,
): ArrayBuffer {
  const buf = new ArrayBuffer(
    groundPlane ? SURFACE_GPU_PARAMS_PLANE_BYTES : SURFACE_GPU_PARAMS_BYTES,
  );
  const view = new DataView(buf);
  view.setFloat32(12, de.boundingRadius, true);
  view.setFloat32(16, de.boundingRadius * 2, true);
  view.setFloat32(20, ESCAPE_STEP_SCALE, true);
  view.setFloat32(24, de.boundingRadius, true);
  view.setFloat32(28, 1, true);
  view.setFloat32(32, 1, true);
  // The kaleidoscope's wedge fold (fr-s04t) — the same two slots the
  // descent's sector sweep reads, meaning the same thing here.
  view.setUint32(40, de.symmetryOrder, true);
  view.setUint32(44, SYM_PLANE_CODE[de.symmetryPlane], true);
  // The LINK COUNT the orbit's cycle wraps at (fr-s04t).
  view.setUint32(48, de.links.length, true);
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
  // fr-5h5d: the former pad1 slot — see packSurfaceGpuParams's identical
  // line. The escape shade path reads it through the same shared
  // shadeRays fn as every other core.
  view.setFloat32(204, run.fogDensity ?? 1, true);
  writeVec3(view, 208, [de.m[0], de.m[1], de.m[2]]);
  view.setFloat32(220, de.t[0], true);
  writeVec3(view, 224, [de.m[3], de.m[4], de.m[5]]);
  view.setFloat32(236, de.t[1], true);
  writeVec3(view, 240, [de.m[6], de.m[7], de.m[8]]);
  view.setFloat32(252, de.t[2], true);
  view.setFloat32(256, de.foldKind, true);
  view.setFloat32(260, de.w, true);
  view.setFloat32(264, de.derivGrowth, true);
  // fr-rhn5: the ground-plane block appends past the escape variant
  // block at the same frozen 272 as the descent cores' — the classic
  // Mandelbox floor is exactly this mode's look.
  if (groundPlane) {
    writeGroundPlane(view, groundPlane);
  }
  return buf;
}

/**
 * Pack the ESCAPE core's formula chain into the per-map storage array
 * (fr-s04t) — {@link packSurfaceGpuMaps}' forward-orbit twin, in the
 * SAME `GpuMap` layout and stride, because a chain of maps is exactly
 * what that binding is for and a second struct would be a second thing
 * to keep in step. Per LINK, in document order (the orbit applies
 * `links[step mod n]`):
 *   r0/r1/r2 = the FORWARD linear part's rows, `t` in the `.w` lanes
 *              (the params variant block's own interleave)
 *   p0       = (foldKind, w, derivGrowth, 0) — the GLSL `uEscParams`
 *              order, so the WGSL body and the GLSL arm read the same
 *              quartet in the same lanes
 *   bnb/p1   = zero: branch-and-bound and the descent's sigma lanes are
 *              inverse-descent concepts, packed for layout parity the
 *              way the affine cores pack the fold lanes they never read
 * A chain always has at least one link (the gate refuses zero active
 * maps), but the empty case still pads to one zero stride like every
 * other packer here.
 */
export function packEscapeGpuMaps(de: EscapeDE): Float32Array {
  const out = new Float32Array(
    de.links.length * SURFACE_GPU_MAP_VEC4 * 4 || SURFACE_GPU_MAP_VEC4 * 4,
  );
  de.links.forEach((link, j) => {
    const base = j * SURFACE_GPU_MAP_VEC4 * 4;
    out[base + 0] = link.m[0];
    out[base + 1] = link.m[1];
    out[base + 2] = link.m[2];
    out[base + 3] = link.t[0];
    out[base + 4] = link.m[3];
    out[base + 5] = link.m[4];
    out[base + 6] = link.m[5];
    out[base + 7] = link.t[1];
    out[base + 8] = link.m[6];
    out[base + 9] = link.m[7];
    out[base + 10] = link.m[8];
    out[base + 11] = link.t[2];
    out[base + 12] = link.foldKind;
    out[base + 13] = link.w;
    out[base + 14] = link.derivGrowth;
    // fold = this LINK's own fold lengths (fr-s9ll), SQUARED for the two
    // sphere radii because that is the form `EscapeLink` keeps and the
    // form the forward orbit's `fR2 / clamp(r2, mR2, fR2)` wants. The
    // descent cores' `fold` lane carries the raw lengths instead — the
    // same per-core divergence `p0` already has, and each packer transfers
    // its own oracle's numbers rather than recomputing them.
    out[base + 24] = link.minRadius2;
    out[base + 25] = link.fixedRadius2;
    out[base + 26] = link.boxLimit;
  });
  return out;
}

/**
 * Pack the params uniform for the BULB core (fr-7u8t.9) —
 * {@link packEscapeGpuParams}'s twin one formula over. The frozen offsets
 * carry the bulb session's marching quantities: `boundingRadius` and
 * `visibleRadius` are the QUERY-space marching ball (`BulbDE`'s own —
 * NOT the orbit bailout, which rides the variant block, and which is the
 * one asymmetry against the escape packer, where the two were the same
 * number), {@link BULB_STEP_SCALE} damps steps (the GLSL variant's
 * `uStepScale`), and `maxDepth` is the orbit's iteration budget
 * ({@link BULB_ITERATIONS} full, preview-clamped by `run.maxDepth`). The
 * 208..271 VARIANT block carries the FORWARD map in the escape rows'
 * interleave, tail vec4f in the GLSL `uBulbParams` order (sigmaMax,
 * bailout, 0, 0). Symmetry packs OFF and the final packs identity/1 (the
 * bulb gate refuses both); `escapeRadius` packs the GLSL's dead `2R` so
 * the wire never carries an uninitialized word; `footprint` packs 0 — a
 * forward loop has no cone-footprint depth cap. The maps storage binding
 * does not exist in bulb kernels, so there is no bulb
 * `packSurfaceGpuMaps` twin.
 */
export function packBulbGpuParams(
  de: BulbDE,
  run: SurfaceGpuRunParams,
  groundPlane: SurfaceGpuGroundPlane | null = null,
): ArrayBuffer {
  const buf = new ArrayBuffer(
    groundPlane ? SURFACE_GPU_PARAMS_PLANE_BYTES : SURFACE_GPU_PARAMS_BYTES,
  );
  const view = new DataView(buf);
  view.setFloat32(12, de.boundingRadius, true);
  view.setFloat32(16, de.boundingRadius * 2, true);
  view.setFloat32(20, BULB_STEP_SCALE, true);
  view.setFloat32(24, de.boundingRadius, true);
  view.setFloat32(28, 1, true);
  view.setFloat32(32, 1, true);
  view.setUint32(40, 1, true);
  view.setUint32(44, 1, true);
  view.setUint32(48, 1, true);
  view.setUint32(52, run.maxDepth ?? BULB_ITERATIONS, true);
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
  // fr-5h5d: the former pad1 slot — see packSurfaceGpuParams's identical
  // line. The bulb shade path reads it through the same shared shadeRays
  // fn as every other core.
  view.setFloat32(204, run.fogDensity ?? 1, true);
  writeVec3(view, 208, [de.m[0], de.m[1], de.m[2]]);
  view.setFloat32(220, de.t[0], true);
  writeVec3(view, 224, [de.m[3], de.m[4], de.m[5]]);
  view.setFloat32(236, de.t[1], true);
  writeVec3(view, 240, [de.m[6], de.m[7], de.m[8]]);
  view.setFloat32(252, de.t[2], true);
  view.setFloat32(256, de.sigmaMax, true);
  view.setFloat32(260, de.bailout, true);
  // fr-rhn5: the ground-plane block appends past the bulb variant block
  // at the same frozen 272 the descent cores use — the Mandelbulb on a
  // floor is the same classic look the fold arm carries it for.
  if (groundPlane) {
    writeGroundPlane(view, groundPlane);
  }
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
 *
 * A `foldFinal` DE (fr-rsp6 phase 2B) APPENDS the lens4 block and returns
 * {@link SURFACE_GPU_PARAMS4_LENS_BYTES} bytes — the 4D twin of the 3D
 * packer's 208..271 lens block, one dimension up: `invM` as four
 * row-vec4s, `invT`, then `(foldKind, invW, absW, sigmaMin)` in the GLSL
 * `uLensParams` order. Without one the buffer is the 432-byte block
 * unchanged, byte for byte. The cores' own final4M/final4T slots still
 * pack IDENTITY/0/1 there, because `buildSurfaceDE4` keeps `final` null
 * whenever `foldFinal` is set (3D's invariant one dimension up): the
 * cores run their no-lens arithmetic verbatim and the wrapper alone
 * applies the lens.
 *
 * HOST CONTRACT for that growth: size the uniform buffer from the
 * RETURNED `byteLength` (or from {@link SURFACE_GPU_PARAMS4_LENS_BYTES}
 * whenever `de.foldFinal` is set — the two agree) and generate the
 * kernel with `lens: true` for the same DE. A host that sizes 432
 * unconditionally will fail validation the moment a 4D fold FINAL
 * reaches it, and one that packs the block into a no-lens kernel simply
 * renders without the lens (the struct ends at 432 and never reads it).
 * `src/app/gpu-bench/` already sizes off `byteLength`.
 *
 * A slab query (`sliceHalfW > 0`) THROWS for a system whose fold set
 * breaks segment exactness ({@link slabExact4}) — the kernel-side belt
 * for the CPU entries' own refusal (a spherefold branch takes a segment
 * to an ARC, so the certificate is unsound, not merely loose). The app
 * clamps `sliceHalfW` to 0 for such sessions.
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
  if (view4.sliceHalfW > 0 && !slabExact4(de)) {
    throw new Error(
      "surface-de-gpu: slab queries are unsound under spherefold/mandelbox " +
        "branches (segment -> arc under inversion) — clamp sliceHalfW to 0 " +
        "for this system (slabExact4)",
    );
  }
  const lens4 = de.foldFinal;
  const buf = new ArrayBuffer(
    lens4 ? SURFACE_GPU_PARAMS4_LENS_BYTES : SURFACE_GPU_PARAMS4_BYTES,
  );
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
  // fr-5h5d: the former pad1 slot — see packSurfaceGpuParams's identical
  // line. The 4D cores' shade path reads it through the same shared
  // shadeRays fn as the 3D cores.
  view.setFloat32(204, run.fogDensity ?? 1, true);
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
  // The FULL 4D visible radius — the height color source's
  // slice-invariant normalizer (the frozen visibleRadius slot carries
  // the slice-ADJUSTED march gate above), and descendLens4's visible
  // ball.
  view.setFloat32(428, de.visibleBoundingRadius, true);
  // Radius-ramp band (fr-skhv): center + minD + the core's ONE
  // inverse-range definition (shared with the GLSL packer), so the
  // radius color source maps the visible set's own [minD, maxD] onto
  // the whole ramp the way buildColors4's radius mode does.
  const band = de.radiusBand;
  view.setFloat32(432, band.center[0], true);
  view.setFloat32(436, band.center[1], true);
  view.setFloat32(440, band.center[2], true);
  view.setFloat32(444, band.center[3], true);
  view.setFloat32(448, band.minD, true);
  view.setFloat32(452, radiusBandInvRange(band), true);
  // fr-rsp6 phase 2B: the appended lens4 block, present exactly when the
  // DE carries a fold FINAL (a no-lens 4D kernel's struct ends at 464 and
  // never reads past it, so its buffer simply stops here). Same row-major
  // convention as every other 4D matrix on this wire, and the tail vec4f
  // is the GLSL uLensParams order (kind, invW, absW, sigmaMin), so the
  // wrapper reads like descendLens4 line for line.
  if (lens4) {
    for (let i = 0; i < 16; i++) {
      view.setFloat32(464 + i * 4, lens4.invM[i], true);
    }
    view.setFloat32(528, lens4.invT[0], true);
    view.setFloat32(532, lens4.invT[1], true);
    view.setFloat32(536, lens4.invT[2], true);
    view.setFloat32(540, lens4.invT[3], true);
    view.setFloat32(544, lens4.foldKind, true);
    view.setFloat32(548, lens4.invW, true);
    view.setFloat32(552, lens4.absW, true);
    view.setFloat32(556, lens4.sigmaMin, true);
    // fr-s9ll: the 4D lens fold's authored lengths, the 3D `lensFold`
    // quartet at this block's own offset — nothing follows the lens4 block,
    // so it grows in place.
    view.setFloat32(560, lens4.foldRadii.minR, true);
    view.setFloat32(564, lens4.foldRadii.fixedR, true);
    view.setFloat32(568, lens4.foldRadii.wall, true);
  }
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
    // fold = the map's three AUTHORED lengths (fr-s9ll). Absent fields
    // resolved to the classic set by `resolveFoldRadii` long before here,
    // so a plain-affine slot carries (0.5, 1, 1) and never reads them.
    out[base + 24] = m.foldRadii.minR;
    out[base + 25] = m.foldRadii.fixedR;
    out[base + 26] = m.foldRadii.wall;
  });
  return out;
}

/** Pack the per-map storage array for the 4D cores (`core: "affine4"` /
 * `core: "fold4"`; layout contract above): invM rows row-major, then
 * invT, then the p0/bnb/p1 parameter lanes. ONE layout for both cores —
 * the fold lanes ride along inert under "affine4" exactly as they do for
 * the 3D "affine" core. Pads to one zero stride when empty, like
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
    // p0 = the 3D lane order (sigmaMin, foldInvW, foldSigma, foldKind),
    // so the fold4 kernel's decode is the 3D one's text.
    out[base + 20] = m.sigmaMin;
    out[base + 21] = m.foldInvW;
    out[base + 22] = m.foldSigma;
    out[base + 23] = m.foldKind;
    // bnb/p1 — fr-kidj stage-2 bound data, packed for layout parity and
    // read by no kernel today (module doc).
    out[base + 24] = m.bnbDir[0];
    out[base + 25] = m.bnbDir[1];
    out[base + 26] = m.bnbDir[2];
    out[base + 27] = m.bnbDir[3];
    out[base + 28] = m.invTNorm;
    out[base + 29] = m.invMSigmaMin;
    // The 3D `fold` lane one dimension up — SAME three lengths, because
    // `SurfaceFoldRadii` is shared by the two oracles (fr-s9ll: two copies
    // of "what does an absent field mean" is how a 3D system and its 4D
    // lift start rendering different objects).
    out[base + 32] = m.foldRadii.minR;
    out[base + 33] = m.foldRadii.fixedR;
    out[base + 34] = m.foldRadii.wall;
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
  /** Fog tint color (fr-5h5d), packed at offset 128 (module doc): what
   * the shade entry's fog blends toward is mix(bg, fogTint,
   * fogTintStrength). Default [1, 1, 1] when omitted, matching the GLSL
   * tracers' uFogTint default; inert while fogTintStrength is 0. */
  fogTint?: Vec3;
  /** Fog tint strength (fr-5h5d), packed at offset 140 (module doc).
   * Default 0 — the identity, fog toward the pixel's own backdrop color
   * alone — when omitted, matching the GLSL tracers' uFogTintStrength
   * default; misses never read it. */
  fogTintStrength?: number;
  /**
   * Sub-pixel sample position (fr-vpbq), packed at offset 144 — where
   * inside pixel `(px, py)` this frame's ray is aimed. The DEFAULT
   * `[0.5, 0.5]` is the pixel centre, i.e. every ray derivation's former
   * literal, so an omitted jitter resolves the pre-supersampling kernel
   * value for value and every bench agreement leg is unmoved.
   *
   * Supersampling is N FRAMES at N offsets averaged by the host, not N
   * rays inside one frame: fr-biox bounds a frame's raster by the
   * device's own buffer limits, and multiplying the ray count would hit
   * that ceiling N times sooner for an image the compute path already
   * renders progressively. The march-start dither reads the jittered
   * coordinate too, so the samples do not share a `t` offset.
   */
  pixelJitter?: [number, number];
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
  writeVec3(view, 128, shade.fogTint ?? [1, 1, 1]);
  view.setFloat32(140, shade.fogTintStrength ?? 0, true);
  const jitter = shade.pixelJitter ?? [0.5, 0.5];
  view.setFloat32(144, jitter[0], true);
  view.setFloat32(148, jitter[1], true);
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
  if (core === "bulb" && lens) {
    // analyzeBulbSystem refuses final transforms for the same reason
    // (fr-7u8t.9) — the escape arm's throw, one formula over.
    throw new Error(
      "surface-de-gpu: the bulb core cannot take a fold-final lens",
    );
  }
  // The 4D cores: one view lift, one params tail, one maps layout. The
  // shared header/entry interpolations below key on this, so a fifth
  // core cannot forget one of them.
  const core4 = core === "affine4" || core === "fold4";
  // The two FORWARD cores (fr-dlxh's escape, fr-7u8t.9's bulb): a forward
  // orbit rather than a descent, so none of the descent helpers and no
  // frontier. The shared header/entry interpolations below key on this the
  // way they key on `core4`, so a seventh core cannot forget one of them.
  const forward = core === "escape" || core === "bulb";
  // ...but the escape core's formula CHAIN (fr-s04t) rides the maps
  // storage binding — one `GpuMap` per LINK, the descent cores' own
  // layout carrying FORWARD affines (packed by {@link
  // packEscapeGpuMaps}), because a list is exactly what that binding is
  // for. Bulb is the one bindingless core left: its single map still
  // rides the params variant block.
  const mapsBinding = !forward || core === "escape";
  // fr-s9ll: does any body in this kernel enumerate the fold's INVERSE
  // branches, and so need `foldRadiiOf`? The fold cores do, and so does the
  // lens wrapper around ANY descent core (a fold FINAL is still a fold).
  // The forward cores read their links' lengths straight off the wire —
  // `escape-de.ts` keeps them SQUARED, which is what its orbit wants — so
  // they never derive the branch algebra. Affine kernels stay byte-identical
  // to the pre-fr-s9ll source, which is what makes that claim testable.
  const foldRadii = core === "fold" || core === "fold4" || lens;
  // fr-5wlv.5: the balloon inverted-union wrapper (THE BALLOON WRAPPER,
  // module doc). Absent means no balloon, so every no-balloon config
  // generates byte-identical source.
  const balloon = opts.balloon ?? false;
  if (balloon && core === "escape") {
    throw new Error(
      "surface-de-gpu: balloon+escape: excluded — the escape solid's " +
        "interior reaches the ball center, so its echo swallows the " +
        "camera (fr-5wlv.4's measured verdict); escape sessions render " +
        "plain",
    );
  }
  if (balloon && core === "bulb") {
    throw new Error(
      "surface-de-gpu: balloon+bulb: excluded — the Mandelbulb's interior " +
        "reaches the ball center exactly as the escape solid's does, so " +
        "its echo swallows the camera (fr-5wlv.4's measured verdict); " +
        "bulb sessions render plain",
    );
  }
  if (balloon && core4) {
    throw new Error(
      "surface-de-gpu: balloon is 3D-only (the 4D lift is a later " +
        "fr-5wlv child)",
    );
  }
  // fr-rhn5: the ground plane — an analytic floor MISS rays classify
  // against in the march (status PLANE inside the fade band) and the
  // shade entry lights with the hit path's penumbra/AO machinery.
  // Absent means no plane, so every pre-fr-rhn5 config generates
  // byte-identical source.
  const groundPlane = opts.groundPlane ?? false;
  if (groundPlane && balloon) {
    throw new Error(
      "surface-de-gpu: groundPlane+balloon: excluded — the enclosing " +
        "shell has no horizon for a floor to sit on (fr-rhn5; the GLSL " +
        "arm refuses the same pair)",
    );
  }
  if (groundPlane && core4) {
    throw new Error(
      "surface-de-gpu: groundPlane is 3D-only (fr-rhn5's scope — the 4D " +
        "lift would need the slab/rotor treatment)",
    );
  }
  // fr-d0nn: the fr-wa6o slab register-pressure probe (option doc).
  // Meaningful only under the 4D cores — every other core reads `true`
  // unconditionally, so `opts.slabExt` is never even consulted for them
  // and the inertness is structural, not just documented.
  const slabExt = core4 ? (opts.slabExt ?? true) : true;
  // fr-b72d: the maps-load probe (option doc). Same structural inertness
  // as slabExt — only the 4D cores ever consult it.
  const mapsUniform = core4 ? (opts.mapsUniform ?? false) : false;
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
  // AFFINE cores ignore it (fr-55s1 stage C): their ladders have one
  // width and no branch fan to cheapen — the GLSL affine arms carry no
  // probe either — so the taps ride the full descent there. Both
  // FRONTIER cores honor it (fr-rsp6 phase 2A adds "fold4").
  const probeWidth =
    (core === "fold" || core === "fold4") &&
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
  // The 3D fold frontier's MODULE-SCOPE storage and its index helper.
  // No other core declares either — the affine ladders' four chains live
  // in scalars (fr-55s1, fr-dlxh's 4D cut), the two forward loops have no
  // frontier concept (fr-dlxh, fr-7u8t.9), and fold4's frontier is function-scope
  // private by construction, declared inside its own body (fr-rsp6 phase
  // 2A) — which is also why none of them needs a workgroup budget at any
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
  fogTint: vec3f,
  fogTintStrength: f32,
  pixelJitter: vec2f,
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
    ? `  // fr-vpbq: the sub-pixel sample position, shade.pixelJitter, in place
  // of the pixel centre this line used to spell as 0.5 — its default.
  let sub = shade.pixelJitter;
  let ndcX = ((f32(px) + sub.x) / f32(params.rasterWidth)) * 2.0 - 1.0;
  let ndcY = ((f32(py) + sub.y) / f32(params.rasterHeight)) * 2.0 - 1.0;
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
    // runs stay deterministic against the CPU emulator. Fed the JITTERED
    // coordinate (fr-vpbq) so supersampling's passes do not all share one
    // start offset — at the default centre this is the shipped input.
    if ((shade.flags & 1u) != 0u) {
      t += hash2(vec2f(f32(px) + sub.x, f32(py) + sub.y)) *
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
  var info = SurfaceHitInfo(0, 0.0, 1.0, 1.0, 0.0);
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
        let fr = foldRadiiOf(m.fold);
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
            pre1 = fr.wall2 - u;
            pre2 = -fr.wall2 - u;
            dUp = max(u - fr.wall, vec3f(0.0));
            dDn = max(-fr.wall - u, vec3f(0.0));
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
                sfRd = max(fr.fixedR - ru, 0.0);
              } else if (s == 1u) {
                v = fr.innerScale * u;
                sfSigma = fr.innerSigma;
                sfRd = max(ru - fr.outputR, 0.0);
              } else {
                if (ru < fr.midMinR) {
                  // GLSL parity: plain skip — the shading chain folds no
                  // shell certificate (there is no best to fold it into).
                  if (kind == 3u) {
                    b += 26u;
                  }
                  continue;
                }
                let invR2 = fr.fixedR2 / (ru * ru);
                v = u * invR2;
                sfSigma = ru * fr.invFixedR;
                sfRd = max(max(fr.fixedR - ru, ru - fr.outputR), 0.0);
              }
              if (kind == 3u) {
                pre0 = v;
                pre1 = fr.wall2 - v;
                pre2 = -fr.wall2 - v;
                dUp = max(v - fr.wall, vec3f(0.0));
                dDn = max(-fr.wall - v, vec3f(0.0));
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
  var info = SurfaceHitInfo(0, 0.0, 1.0, 1.0, 0.0);
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

  // THE 4D CORES' PROLOGUE — one text, four bodies (the affine4 ladder,
  // the fold4 frontier and both hit-info twins), for renameToProbe's
  // reason: view -> attractor frame (the 4D GLSL's uInvRotor line), the
  // fr-wa6o slab seed, then the affine final lens.
  //
  // Under the fr-rsp6 phase 2B LENS the wrapper owns that lift instead
  // (module doc, THE FOLD-LENS WRAPPER): the sweep lifts ONCE and hands
  // each branch's transported query straight in, so the core's signature
  // takes the 4D point (and, under a slab, its half-extent) rather than
  // the view-frame vec3f. The final-lens lines STAY — `buildSurfaceDE4`
  // keeps `final` null whenever `foldFinal` is set, so the packer packs
  // final4M/final4T IDENTITY/0 and these dot-products reproduce their
  // arguments bit for bit — which keeps the rest of every body the
  // no-lens body's own text.
  const core4Params = (arg: string, slabExt: boolean, lens: boolean): string =>
    !lens
      ? `${arg}: vec3f`
      : slabExt
        ? "qIn: vec4f, qExt: vec4f"
        : "qIn: vec4f";
  const lift4Text = (
    arg: string,
    comment: string,
    slabExt: boolean,
    lens: boolean,
  ): string =>
    lens
      ? `  // The lens wrapper lifted this query into the attractor frame and
  // transported it through ONE inverse fold branch (its half-extent too,
  // under a slab — fr-wa6o), so the core opens on the 4D point it would
  // otherwise derive. The affine final lens below is the packer's
  // IDENTITY under a foldFinal, left in place so the rest of this body
  // stays the no-lens body's own text (fr-rsp6 phase 2B).
  var q = qIn;
${
  slabExt
    ? `  let segment = params.sliceHalfW > 0.0;
  var ext = qExt;
`
    : ``
}  q = finalApply4(q);
${
  slabExt
    ? `  if (segment) {
    ext = finalApplyLinear4(ext);
  }
`
    : ``
}`
      : `${comment}  var q = rotorInvApply4(vec4f(${arg}, params.w0));
${
  slabExt
    ? `  let segment = params.sliceHalfW > 0.0;
  var ext = vec4f(0.0);
  if (segment) {
    ext = rotorInvWCol4() * params.sliceHalfW;
  }
`
    : ``
}  q = finalApply4(q);
${
  slabExt
    ? `  if (segment) {
    ext = finalApplyLinear4(ext);
  }
`
    : ``
}`;

  // 4D hit-info (fr-dlxh's 4D cut): surface-material-4d.ts's shading
  // overload (the out-param surfaceDE), trajectory term for term — the
  // width-4 refined ladder behind the SAME view lift as the value body,
  // under the colors-only convention the fold/affine twins set: best and
  // refinedCert never steer the ladder (keys route the beam,
  // escape/bounding radii route the chains), and the GLSL overload's
  // returned distance is exactly the value side trimmed here. Plain
  // params.maxDepth on purpose, like the other twins.
  const affine4HitInfoText = (
    slabExt: boolean,
    lens: boolean,
  ): string => /* wgsl */ `${
    slabExt
      ? `// 4D hit-info descent (surface-material-4d.ts's shading overload): the
// width-4 ladder's TRAJECTORY — top-2 beam + fr-jkpn rank-3/4 validity
// spill, sector-major enumeration, one vec4f half-extent per register
// (fr-wa6o) — behind the value body's view lift, feeding colors only
// (the value side never steers it; see the generator comment).
`
      : `// 4D hit-info descent (surface-material-4d.ts's shading overload): the
// width-4 ladder's TRAJECTORY — top-2 beam + fr-jkpn rank-3/4 validity
// spill, sector-major enumeration — behind the value body's view lift,
// feeding colors only (the value side never steers it; see the
// generator comment). fr-d0nn slabExt=false (fr-b72d probe): no
// fr-wa6o half-extent registers — every radius below is a plain length.
`
  }fn surfaceDEHitInfo(${core4Params(
    "p",
    slabExt,
    lens,
  )}, li: u32) -> SurfaceHitInfo {
${lift4Text("p", "", slabExt, lens)}  var info = SurfaceHitInfo(0, 0.0, 1.0, 1.0, 0.0);
  var trapAcc = 0.0;
  var trapNorm = 0.0;
  var trapW = 1.0;
  let R = params.boundingRadius;
  var aQ = q;
${
  slabExt
    ? `  var aExt = ext;
`
    : ``
}  var aScale = 1.0;
  var aLive = true;
  var bQ = vec4f(0.0);
${
  slabExt
    ? `  var bExt = vec4f(0.0);
`
    : ``
}  var bScale = 1.0;
  var bLive = false;
  var v1Q = vec4f(0.0);
${
  slabExt
    ? `  var v1Ext = vec4f(0.0);
`
    : ``
}  var v1Scale = 1.0;
  var v1Live = false;
  var v2Q = vec4f(0.0);
${
  slabExt
    ? `  var v2Ext = vec4f(0.0);
`
    : ``
}  var v2Scale = 1.0;
  var v2Live = false;
  for (var depth = 0u; depth < params.maxDepth; depth++) {
    if (!aLive && !bLive && !v1Live && !v2Live) {
      break;
    }
    var c1Key = 1e30;
    var c1Q = vec4f(0.0);
${
  slabExt
    ? `    var c1Ext = vec4f(0.0);
`
    : ``
}    var c1Scale = 1.0;
    var c1R = 0.0;
    var c1Map = 0u;
    var c2Key = 1e30;
    var c2Q = vec4f(0.0);
${
  slabExt
    ? `    var c2Ext = vec4f(0.0);
`
    : ``
}    var c2Scale = 1.0;
    var c2R = 0.0;
    var c3Key = 1e30;
    var c3Q = vec4f(0.0);
${
  slabExt
    ? `    var c3Ext = vec4f(0.0);
`
    : ``
}    var c3Scale = 1.0;
    var c3R = 0.0;
    var c4Key = 1e30;
    var c4Q = vec4f(0.0);
${
  slabExt
    ? `    var c4Ext = vec4f(0.0);
`
    : ``
}    var c4Scale = 1.0;
    var c4R = 0.0;
    for (var c = 0u; c < 4u; c++) {
      var pQ = vec4f(0.0);
${
  slabExt
    ? `      var pExt = vec4f(0.0);
`
    : ``
}      var pScale = 1.0;
      if (c == 0u) {
        if (!aLive) {
          continue;
        }
        pQ = aQ;
${
  slabExt
    ? `        pExt = aExt;
`
    : ``
}        pScale = aScale;
      } else if (c == 1u) {
        if (!bLive) {
          continue;
        }
        pQ = bQ;
${
  slabExt
    ? `        pExt = bExt;
`
    : ``
}        pScale = bScale;
      } else if (c == 2u) {
        if (!v1Live) {
          continue;
        }
        pQ = v1Q;
${
  slabExt
    ? `        pExt = v1Ext;
`
    : ``
}        pScale = v1Scale;
      } else {
        if (!v2Live) {
          continue;
        }
        pQ = v2Q;
${
  slabExt
    ? `        pExt = v2Ext;
`
    : ``
}        pScale = v2Scale;
      }
${
  slabExt
    ? `      // Sector sweep (fr-u91x): sector-major enumeration, the
      // expansion's order, so ladder tie-breaks match the oracle's; the
      // half-extent turns through the same backward step (an isometry
      // maps segments to segments).
`
    : `      // Sector sweep (fr-u91x): sector-major enumeration, the
      // expansion's order, so ladder tie-breaks match the oracle's.
`
}      var sQ = pQ;
${
  slabExt
    ? `      var sExt = pExt;
`
    : ``
}      for (var k = 0u; k < params.symOrder; k++) {
        if (k > 0u) {
          sQ = stepSector4(sQ);
${
  slabExt
    ? `          if (segment) {
            sExt = stepSector4(sExt);
          }
`
    : ``
}        }
        for (var j = 0u; j < params.mapCount; j++) {
          let m = maps[j];
          let img = mapApply4(m, sQ);
${
  slabExt
    ? `          var imgExt = vec4f(0.0);
          if (segment) {
            imgExt = mapApplyLinear4(m, sExt);
          }
          let r = segmentRadius4(img, imgExt);
`
    : `          let r = length(img);
`
}          let key = pScale * (r - R);
          let childScale = pScale * m.p0.x;
${
  slabExt
    ? `          // Top-2 insert-shift; the displaced tuple (or the candidate
          // itself) spills into the rank-3/4 ladder. Certificates are
          // value-side and trimmed; radii and extents flow through —
          // the spill ladder routes on radii, the chains descend the
          // extents.
`
    : `          // Top-2 insert-shift; the displaced tuple (or the candidate
          // itself) spills into the rank-3/4 ladder. Certificates are
          // value-side and trimmed; radii flow through — the spill
          // ladder routes on radii.
`
}          var eKey = key;
          var eQ = img;
${
  slabExt
    ? `          var eExt = imgExt;
`
    : ``
}          var eScale = childScale;
          var eR = r;
          if (key < c1Key) {
            eKey = c2Key;
            eQ = c2Q;
${
  slabExt
    ? `            eExt = c2Ext;
`
    : ``
}            eScale = c2Scale;
            eR = c2R;
            c2Key = c1Key;
            c2Q = c1Q;
${
  slabExt
    ? `            c2Ext = c1Ext;
`
    : ``
}            c2Scale = c1Scale;
            c2R = c1R;
            c1Key = key;
            c1Q = img;
${
  slabExt
    ? `            c1Ext = imgExt;
`
    : ``
}            c1Scale = childScale;
            c1R = r;
            c1Map = j;
          } else if (key < c2Key) {
            eKey = c2Key;
            eQ = c2Q;
${
  slabExt
    ? `            eExt = c2Ext;
`
    : ``
}            eScale = c2Scale;
            eR = c2R;
            c2Key = key;
            c2Q = img;
${
  slabExt
    ? `            c2Ext = imgExt;
`
    : ``
}            c2Scale = childScale;
            c2R = r;
          }
          if (eKey < c3Key) {
            c4Key = c3Key;
            c4Q = c3Q;
${
  slabExt
    ? `            c4Ext = c3Ext;
`
    : ``
}            c4Scale = c3Scale;
            c4R = c3R;
            c3Key = eKey;
            c3Q = eQ;
${
  slabExt
    ? `            c3Ext = eExt;
`
    : ``
}            c3Scale = eScale;
            c3R = eR;
          } else if (eKey < c4Key) {
            c4Key = eKey;
            c4Q = eQ;
${
  slabExt
    ? `            c4Ext = eExt;
`
    : ``
}            c4Scale = eScale;
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
${
  slabExt
    ? `    // Under a slab query rings rides the SEGMENT radius (c1R is one);
    // sheets keeps reading the segment's CENTRE y by design — a shading
    // extra, and a coordinate is what the plane trap wants (fr-wa6o).
`
    : ``
}    info.rings = min(info.rings, c1R / R);
    info.sheets = min(info.sheets, abs(c1Q.y) / R);
${
  slabExt
    ? `    // Overwritten, not min-tracked: the deepest level's winner is the
    // honest place along the slab segment (fr-9c9e; the GLSL twin's rule).
    info.sStar = segmentS4(c1Q, c1Ext);
`
    : ``
}    aLive = false;
    bLive = false;
    v1Live = false;
    v2Live = false;
    if (c1Key < 1e29) {
      if (c1R <= params.escapeRadius) {
        aQ = c1Q;
${
  slabExt
    ? `        aExt = c1Ext;
`
    : ``
}        aScale = c1Scale;
        aLive = true;
      }
    }
    if (c2Key < 1e29) {
      if (c2R <= params.escapeRadius) {
        bQ = c2Q;
${
  slabExt
    ? `        bExt = c2Ext;
`
    : ``
}        bScale = c2Scale;
        bLive = true;
      }
    }
    if (c3Key < 1e29) {
      if (c3R <= R) {
        v1Q = c3Q;
${
  slabExt
    ? `        v1Ext = c3Ext;
`
    : ``
}        v1Scale = c3Scale;
        v1Live = true;
      }
    }
    if (c4Key < 1e29) {
      if (c4R <= R) {
        v2Q = c4Q;
${
  slabExt
    ? `        v2Ext = c4Ext;
`
    : ``
}        v2Scale = c4Scale;
        v2Live = true;
      }
    }
  }
  info.trap = select(0.0, trapAcc / trapNorm, trapNorm > 0.0);
  info.rings = clamp(info.rings, 0.0, 1.0);
  info.sheets = clamp(info.sheets, 0.0, 1.0);
  return info;
}`;

  // 4D FOLD hit-info descent (fr-rsp6 phase 2A): the 3D fold twin's
  // GREEDY width-1 chain — at each level the smallest floored-key
  // candidate over every (sector, map, BRANCH) triple — one dimension
  // up, behind the value body's view lift. Colors only (the value side
  // never steers it), so no frontier, no prunes and no shell
  // certificate on the mid-branch guard, exactly the 3D fold hit-info's
  // conventions; plain params.maxDepth, like every other hit-info body.
  const fold4HitInfoText = (
    slabExt: boolean,
    lens: boolean,
  ): string => /* wgsl */ `${
    slabExt
      ? `// 4D fold hit-info descent (surface-de-4d.ts's descendFold4
// trajectory, the 3D fold hit-info's shape one dimension up): a greedy
// width-1 chain over every (sector, map, branch) triple, one vec4f
// half-extent riding beside the chain point (fr-wa6o), feeding colors
// only. Branch fans 81/3/243 (foldBranchCount4).
`
      : `// 4D fold hit-info descent (surface-de-4d.ts's descendFold4
// trajectory, the 3D fold hit-info's shape one dimension up): a greedy
// width-1 chain over every (sector, map, branch) triple, feeding colors
// only. Branch fans 81/3/243 (foldBranchCount4). fr-d0nn slabExt=false
// (fr-b72d probe): no fr-wa6o half-extent registers — every radius
// below is a plain length.
`
  }fn surfaceDEHitInfo(${core4Params(
    "p",
    slabExt,
    lens,
  )}, li: u32) -> SurfaceHitInfo {
${lift4Text("p", "", slabExt, lens)}  var info = SurfaceHitInfo(0, 0.0, 1.0, 1.0, 0.0);
  var trapAcc = 0.0;
  var trapNorm = 0.0;
  var trapW = 1.0;
  var chQ = q;
${
  slabExt
    ? `  var chExt = ext;
`
    : ``
}  var chScale = 1.0;
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
    var lbQ = vec4f(0.0);
${
  slabExt
    ? `    var lbExt = vec4f(0.0);
`
    : ``
}    var lbScale = 1.0;
    var lbFloor = 0.0;
    let pScale = chScale;
    let pFloor = chFloor;
    var sQ = chQ;
${
  slabExt
    ? `    var sExt = chExt;
`
    : ``
}    for (var k = 0u; k < params.symOrder; k++) {
      if (k > 0u) {
        sQ = stepSector4(sQ);
${
  slabExt
    ? `        if (segment) {
          sExt = stepSector4(sExt);
        }
`
    : ``
}      }
      for (var j = 0u; j < params.mapCount; j++) {
        let m = maps[j];
        let kind = u32(m.p0.w);
        var branchCount = 1u;
        if (kind == 1u) {
          branchCount = 81u;
        } else if (kind == 2u) {
          branchCount = 3u;
        } else if (kind == 3u) {
          branchCount = 243u;
        }
        let mapSigma = m.p0.x;
        let absW = m.p0.z / mapSigma;
        let fr = foldRadiiOf(m.fold);
        var u = vec4f(0.0);
${
  slabExt
    ? `        var eu = vec4f(0.0);
`
    : ``
}        var ru = 0.0;
        var pre0 = vec4f(0.0);
        var pre1 = vec4f(0.0);
        var pre2 = vec4f(0.0);
        var dUp = vec4f(0.0);
        var dDn = vec4f(0.0);
        var v = vec4f(0.0);
        var sfSigma = 1.0;
        var sfRd = 0.0;
        if (kind != 0u) {
          u = sQ * m.p0.y;
${
  slabExt
    ? `          if (segment) {
            eu = sExt * m.p0.y;
          }
`
    : ``
}          if (kind == 1u) {
            pre0 = u;
            pre1 = fr.wall2 - u;
            pre2 = -fr.wall2 - u;
            dUp = max(u - fr.wall, vec4f(0.0));
            dDn = max(-fr.wall - u, vec4f(0.0));
${
  slabExt
    ? `            if (segment) {
              let ae = abs(eu);
              dUp = max(dUp - ae, vec4f(0.0));
              dDn = max(dDn - ae, vec4f(0.0));
            }
`
    : ``
}          } else {
            ru = length(u);
          }
        }
        for (var b = 0u; b < branchCount; b++) {
          var img: vec4f;
${
  slabExt
    ? `          var imgExt = vec4f(0.0);
`
    : ``
}          var branchSigma: f32;
          var branchRd = 0.0;
          if (kind == 0u) {
            img = mapApply4(m, sQ);
${
  slabExt
    ? `            if (segment) {
              imgExt = mapApplyLinear4(m, sExt);
            }
`
    : ``
}            branchSigma = mapSigma;
          } else {
            if (kind == 2u || (kind == 3u && (b % 81u) == 0u)) {
              var s = b;
              if (kind == 3u) {
                s = b / 81u;
              }
              if (s == 0u) {
                v = u;
                sfSigma = 1.0;
                sfRd = max(fr.fixedR - ru, 0.0);
              } else if (s == 1u) {
                v = fr.innerScale * u;
                sfSigma = fr.innerSigma;
                sfRd = max(ru - fr.outputR, 0.0);
              } else {
                if (ru < fr.midMinR) {
                  // GLSL parity: plain skip — the shading chain folds no
                  // shell certificate (there is no best to fold it into).
                  // The mandelbox box expansion is 81 wide up here.
                  if (kind == 3u) {
                    b += 80u;
                  }
                  continue;
                }
                let invR2 = fr.fixedR2 / (ru * ru);
                v = u * invR2;
                sfSigma = ru * fr.invFixedR;
                sfRd = max(max(fr.fixedR - ru, ru - fr.outputR), 0.0);
              }
              if (kind == 3u) {
                pre0 = v;
                pre1 = fr.wall2 - v;
                pre2 = -fr.wall2 - v;
                dUp = max(v - fr.wall, vec4f(0.0));
                dDn = max(-fr.wall - v, vec4f(0.0));
              }
            }
            var pre: vec4f;
${
  slabExt
    ? `            var preExt = vec4f(0.0);
`
    : ``
}            if (kind == 2u) {
              pre = v;
              branchRd = sfRd;
            } else {
              // Box branch decode: per-axis preimage selectors, x
              // fastest, FOUR digits
              // (b = selX + 3*selY + 9*selZ + 27*selW).
              var bb = b;
              if (kind == 3u) {
                bb = b % 81u;
              }
              let selX = bb % 3u;
              let selY = (bb / 3u) % 3u;
              let selZ = (bb / 9u) % 3u;
              let selW = bb / 27u;
              pre = vec4f(
                select(select(pre2.x, pre1.x, selX == 1u), pre0.x, selX == 0u),
                select(select(pre2.y, pre1.y, selY == 1u), pre0.y, selY == 0u),
                select(select(pre2.z, pre1.z, selZ == 1u), pre0.z, selZ == 0u),
                select(select(pre2.w, pre1.w, selW == 1u), pre0.w, selW == 0u),
              );
${
  slabExt
    ? `              if (segment) {
                preExt = vec4f(
                  select(-eu.x, eu.x, selX == 0u),
                  select(-eu.y, eu.y, selY == 0u),
                  select(-eu.z, eu.z, selZ == 0u),
                  select(-eu.w, eu.w, selW == 0u),
                );
              }
`
    : ``
}              let dd = vec4f(
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
                select(
                  select(dDn.w, dUp.w, selW == 1u),
                  max(dUp.w, dDn.w),
                  selW == 0u,
                ),
              );
              let boxRd = length(dd);
              if (kind == 1u) {
                branchRd = boxRd;
              } else {
                branchRd = max(sfRd, sfSigma * boxRd);
              }
            }
            img = mapApply4(m, pre);
${
  slabExt
    ? `            if (segment) {
              imgExt = mapApplyLinear4(m, preExt);
            }
`
    : ``
}            branchSigma = m.p0.z * sfSigma;
          }
${
  slabExt
    ? `          let r = segmentRadius4(img, imgExt);
`
    : `          let r = length(img);
`
}          var candFloor = pFloor;
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
${
  slabExt
    ? `            lbExt = imgExt;
`
    : ``
}            lbScale = pScale * branchSigma;
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
${
  slabExt
    ? `    // Under a slab query rings rides the SEGMENT radius (lbR is one);
    // sheets keeps reading the segment's CENTRE y by design — a shading
    // extra, and a coordinate is what the plane trap wants (fr-wa6o).
`
    : ``
}    info.rings = min(info.rings, lbR / R);
    info.sheets = min(info.sheets, lbAbsY / R);
${
  slabExt
    ? `    // Overwritten, not min-tracked: the deepest level's winner is the
    // honest place along the slab segment (fr-9c9e; the GLSL twin's rule).
    info.sStar = segmentS4(lbQ, lbExt);
`
    : ``
}    if (lbR > params.escapeRadius) {
      live = false;
    } else {
      chQ = lbQ;
${
  slabExt
    ? `      chExt = lbExt;
`
    : ``
}      chScale = lbScale;
      chFloor = lbFloor;
    }
  }
  info.trap = select(0.0, trapAcc / trapNorm, trapNorm > 0.0);
  info.rings = clamp(info.rings, 0.0, 1.0);
  info.sheets = clamp(info.sheets, 0.0, 1.0);
  return info;
}`;

  // Escape hit-info (fr-dlxh — the GLSL SURFACE_ESCAPE shading overload,
  // term for term): the same forward orbit with the classic escape-time
  // extras — trap is the CONTINUOUS ESCAPE FRACTION (fr-7u8t.8; the
  // canonical Mandelbox palette coordinate), rings/sheets the orbit's
  // closest radial / y-plane approaches — the same trap vocabulary the
  // descent variants feed the shared color sources. firstChoice is
  // always 0 (one map). Colors-only convention (the fold twin's): the
  // GLSL overload also returns the DE, so its dr accumulator is the one
  // value-side term trimmed here.
  const escapeHitInfoText = /* wgsl */ `fn surfaceDEHitInfo(p: vec3f, li: u32) -> SurfaceHitInfo {
  var info = SurfaceHitInfo(0, 0.0, 1.0, 1.0, 0.0);
  let q = foldQuerySector(p);
  var v = q;
  var r = length(v);
  let n = params.mapCount;
  let steps = params.maxDepth * n;
  var link = 0u;
  var escapedAt = steps;
  // The growth factor of the link whose application produced the current
  // r — the head link's until a step has run, so a one-link document
  // reads maps[0].p0.z at every step exactly as it did before the chain.
  var growth = maps[0].p0.z;
  for (var i = 0u; i < steps; i++) {
    if (r > params.boundingRadius) {
      escapedAt = i;
      break;
    }
    let L = maps[link];
    let kind = u32(L.p0.x);
    var y = vec3f(
      dot(L.r0.xyz, v) + L.r0.w,
      dot(L.r1.xyz, v) + L.r1.w,
      dot(L.r2.xyz, v) + L.r2.w,
    );
    if (kind != 2u) {
      // fr-s9ll: the link's own box wall — escape-de.ts's foldAxis(t, wall).
      y = clamp(y, vec3f(-L.fold.z), vec3f(L.fold.z)) * 2.0 - y;
    }
    if (kind != 1u) {
      // ...and its own sphere shell, SQUARED on the wire exactly as
      // EscapeLink keeps it: fR2 / clamp(r2, mR2, fR2).
      let f = L.fold.y / clamp(dot(y, y), L.fold.x, L.fold.y);
      y *= f;
    }
    v = L.p0.y * y + q;
    r = length(v);
    growth = L.p0.z;
    info.rings = min(info.rings, r / params.boundingRadius);
    info.sheets = min(info.sheets, abs(v.y) / params.boundingRadius);
    link++;
    if (link == n) {
      link = 0u;
    }
  }
  // fr-7u8t.8: the CONTINUOUS escape count — the GLSL arm's escFrac term for
  // term (see surface-material.ts for why the raw integer reads as confetti).
  // Normalized by params.maxDepth, NOT by the step budget — fr-byxb, and the
  // GLSL arm carries the argument.
  var escFrac = 0.0;
  if (escapedAt < steps && growth > 1.0) {
    escFrac = clamp(log(r / params.boundingRadius) / log(growth), 0.0, 1.0);
  }
  info.trap =
    clamp((f32(escapedAt) - escFrac) / f32(params.maxDepth), 0.0, 1.0);
  info.rings = clamp(info.rings, 0.0, 1.0);
  info.sheets = clamp(info.sheets, 0.0, 1.0);
  return info;
}`;

  // Bulb hit-info (fr-7u8t.9 — the GLSL SURFACE_BULB shading overload,
  // term for term): the same forward triplex-power orbit with the escape
  // family's shading extras — trap is the CONTINUOUS escape count in the
  // POWER-map form (see the value body's derivation), rings/sheets the
  // orbit's closest radial / y-plane approaches, normalized by the ORBIT's
  // own ball (the bailout) rather than the query-space marching radius the
  // escape arm could use for both. firstChoice is always 0 (one map).
  // Colors-only convention (every hit-info body's): the estimate's dr
  // accumulator is the one value-side term trimmed here.
  const bulbHitInfoText = /* wgsl */ `fn surfaceDEHitInfo(p: vec3f, li: u32) -> SurfaceHitInfo {
  var info = SurfaceHitInfo(0, 0.0, 1.0, 1.0, 0.0);
  let bail = params.bulbParams.y;
  let c = vec3f(
    dot(params.bulbM0, p) + params.bulbT0,
    dot(params.bulbM1, p) + params.bulbT1,
    dot(params.bulbM2, p) + params.bulbT2,
  );
  var y = c;
  var r2 = dot(y, y);
  var r = sqrt(r2);
  var escapedAt = params.maxDepth;
  for (var i = 0u; i < params.maxDepth; i++) {
    if (r > bail) {
      escapedAt = i;
      break;
    }
    let v = bulbPow8(y, r2);
    y = vec3f(dot(params.bulbM0, v), dot(params.bulbM1, v), dot(params.bulbM2, v)) + c;
    r2 = dot(y, y);
    r = sqrt(r2);
    info.rings = min(info.rings, r / bail);
    info.sheets = min(info.sheets, abs(y.y) / bail);
  }
  // The continuous escape count for a POWER map (fr-7u8t.9), the GLSL
  // arm's escFrac term for term: r grows as r^n, not by a constant
  // factor, so the fold arm's log(r/R)/log(growth) is the wrong
  // interpolant here and the classic log(log r / log R)/log n is the
  // right one. Guarded on having escaped at all and on a bailout above 1
  // (BULB_BAILOUT_FLOOR is 4, so log(bail) is comfortably positive).
  var escFrac = 0.0;
  if (escapedAt < params.maxDepth && bail > 1.0) {
    escFrac = clamp(log(log(r) / log(bail)) / log(${BULB_POWER}.0), 0.0, 1.0);
  }
  info.trap = clamp((f32(escapedAt) - escFrac) / f32(params.maxDepth), 0.0, 1.0);
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
  let fr = foldRadiiOf(params.lensFold);
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
    pre1 = fr.wall2 - u;
    pre2 = -fr.wall2 - u;
    dUp = max(u - fr.wall, vec3f(0.0));
    dDn = max(-fr.wall - u, vec3f(0.0));
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
        sfRd = max(fr.fixedR - ru, 0.0);
      } else if (s == 1u) {
        v = fr.innerScale * u;
        sfSigma = fr.innerSigma;
        sfRd = max(ru - fr.outputR, 0.0);
      } else {
        if (ru < fr.midMinR) {
          if (kind == 3u) {
            b += 26u;
          }
          continue;
        }
        let invR2 = fr.fixedR2 / (ru * ru);
        v = u * invR2;
        sfSigma = ru * fr.invFixedR;
        sfRd = max(max(fr.fixedR - ru, ru - fr.outputR), 0.0);
      }
      if (kind == 3u) {
        pre0 = v;
        pre1 = fr.wall2 - v;
        pre2 = -fr.wall2 - v;
        dUp = max(v - fr.wall, vec3f(0.0));
        dDn = max(-fr.wall - v, vec3f(0.0));
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

  // The 4D lens hit-info wrapper (fr-rsp6 phase 2B): the sweep above one
  // dimension up, sharing every 4D delta the value wrapper's comment
  // lists (81/3/243 fans, the four-digit box code, segmentRadius4) and
  // the same hoisted VIEW LIFT — the core hit-info takes the lifted 4D
  // query here, exactly like the value core. Shading conventions are the
  // 3D wrapper's: FULL-width zero-cutoff core calls, no visible pin and
  // no cutoff exits (a shading call has neither), the shell guard plain-
  // skipping, and an identity-branch fallback so a fully pruned loop
  // still hands the core hit call a sane point.
  const lens4HitWrapText = /* wgsl */ `fn surfaceDEHitInfo(p: vec3f, li: u32) -> SurfaceHitInfo {
  let pq = rotorInvApply4(vec4f(p, params.w0));
${
  slabExt
    ? `  let segment = params.sliceHalfW > 0.0;
  var pExt = vec4f(0.0);
  if (segment) {
    pExt = rotorInvWCol4() * params.sliceHalfW;
  }
`
    : ``
}  let kind = u32(params.lens4Params.x);
  let absW = params.lens4Params.z;
  let u = pq * params.lens4Params.y;
  let fr = foldRadiiOf(params.lens4Fold);
${
  slabExt
    ? `  var eu = vec4f(0.0);
  if (segment) {
    eu = pExt * params.lens4Params.y;
  }
`
    : ``
}  var best = 1e30;
  var ru = 0.0;
  var pre0 = vec4f(0.0);
  var pre1 = vec4f(0.0);
  var pre2 = vec4f(0.0);
  var dUp = vec4f(0.0);
  var dDn = vec4f(0.0);
  var v = vec4f(0.0);
  var sfSigma = 1.0;
  var sfRd = 0.0;
  var bestQ = vec4f(
    dot(params.lens4MR0, u),
    dot(params.lens4MR1, u),
    dot(params.lens4MR2, u),
    dot(params.lens4MR3, u),
  ) + params.lens4T;
${
  slabExt
    ? `  var bestExt = vec4f(0.0);
  if (segment) {
    bestExt = vec4f(
      dot(params.lens4MR0, eu),
      dot(params.lens4MR1, eu),
      dot(params.lens4MR2, eu),
      dot(params.lens4MR3, eu),
    );
  }
`
    : ``
}  if (kind == 1u) {
    pre0 = u;
    pre1 = fr.wall2 - u;
    pre2 = -fr.wall2 - u;
    dUp = max(u - fr.wall, vec4f(0.0));
    dDn = max(-fr.wall - u, vec4f(0.0));
${
  slabExt
    ? `    if (segment) {
      let ae = abs(eu);
      dUp = max(dUp - ae, vec4f(0.0));
      dDn = max(dDn - ae, vec4f(0.0));
    }
`
    : ``
}  } else {
    ru = length(u);
  }
  var branchCount = 243u;
  if (kind == 1u) {
    branchCount = 81u;
  } else if (kind == 2u) {
    branchCount = 3u;
  }
  for (var b = 0u; b < branchCount; b++) {
    if (kind == 2u || (kind == 3u && (b % 81u) == 0u)) {
      var s = b;
      if (kind == 3u) {
        s = b / 81u;
      }
      if (s == 0u) {
        v = u;
        sfSigma = 1.0;
        sfRd = max(fr.fixedR - ru, 0.0);
      } else if (s == 1u) {
        v = fr.innerScale * u;
        sfSigma = fr.innerSigma;
        sfRd = max(ru - fr.outputR, 0.0);
      } else {
        if (ru < fr.midMinR) {
          if (kind == 3u) {
            b += 80u;
          }
          continue;
        }
        let invR2 = fr.fixedR2 / (ru * ru);
        v = u * invR2;
        sfSigma = ru * fr.invFixedR;
        sfRd = max(max(fr.fixedR - ru, ru - fr.outputR), 0.0);
      }
      if (kind == 3u) {
        pre0 = v;
        pre1 = fr.wall2 - v;
        pre2 = -fr.wall2 - v;
        dUp = max(v - fr.wall, vec4f(0.0));
        dDn = max(-fr.wall - v, vec4f(0.0));
      }
    }
    var pre: vec4f;
${
  slabExt
    ? `    var preExt = vec4f(0.0);
`
    : ``
}    var branchRd: f32;
    if (kind == 2u) {
      pre = v;
      branchRd = sfRd;
    } else {
      var bb = b;
      if (kind == 3u) {
        bb = b % 81u;
      }
      let selX = bb % 3u;
      let selY = (bb / 3u) % 3u;
      let selZ = (bb / 9u) % 3u;
      let selW = bb / 27u;
      pre = vec4f(
        select(select(pre2.x, pre1.x, selX == 1u), pre0.x, selX == 0u),
        select(select(pre2.y, pre1.y, selY == 1u), pre0.y, selY == 0u),
        select(select(pre2.z, pre1.z, selZ == 1u), pre0.z, selZ == 0u),
        select(select(pre2.w, pre1.w, selW == 1u), pre0.w, selW == 0u),
      );
${
  slabExt
    ? `      if (segment) {
        preExt = vec4f(
          select(-eu.x, eu.x, selX == 0u),
          select(-eu.y, eu.y, selY == 0u),
          select(-eu.z, eu.z, selZ == 0u),
          select(-eu.w, eu.w, selW == 0u),
        );
      }
`
    : ``
}      let dd = vec4f(
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
        select(
          select(dDn.w, dUp.w, selW == 1u),
          max(dUp.w, dDn.w),
          selW == 0u,
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
    let q = vec4f(
      dot(params.lens4MR0, pre),
      dot(params.lens4MR1, pre),
      dot(params.lens4MR2, pre),
      dot(params.lens4MR3, pre),
    ) + params.lens4T;
${
  slabExt
    ? `    var qExt = vec4f(0.0);
    if (segment) {
      qExt = vec4f(
        dot(params.lens4MR0, preExt),
        dot(params.lens4MR1, preExt),
        dot(params.lens4MR2, preExt),
        dot(params.lens4MR3, preExt),
      );
    }
`
    : ``
}    let factor = absW * sfSigma * params.lens4Params.w;
${
  slabExt
    ? `    let rq = segmentRadius4(q, qExt);
`
    : `    let rq = length(q);
`
}    if (factor * (rq - params.boundingRadius) >= best) {
      continue;
    }
    var term = factor * surfaceDECore(q, ${slabExt ? "qExt, " : ""}0.0, li);
    term = max(term, flr);
    if (term < best) {
      best = term;
      bestQ = q;
${
  slabExt
    ? `      bestExt = qExt;
`
    : ``
}    }
  }
  return surfaceDEHitInfoCore(bestQ, ${slabExt ? "bestExt, " : ""}li);
}`;

  const coreHitInfoText =
    core === "affine"
      ? affineHitInfoText
      : core === "escape"
        ? escapeHitInfoText
        : core === "bulb"
          ? bulbHitInfoText
          : core === "affine4"
            ? affine4HitInfoText(slabExt, lens)
            : core === "fold4"
              ? fold4HitInfoText(slabExt, lens)
              : foldHitInfoText;
  const lensedHitInfoText = lens
    ? `${coreHitInfoText.replace(
        "fn surfaceDEHitInfo(",
        "fn surfaceDEHitInfoCore(",
      )}

// The lens hit-info argmin sweep (fr-55s1 stage C) — around the renamed
// core hit-info, like the value pair below.
${core4 ? lens4HitWrapText : lensHitWrapText}`
    : coreHitInfoText;

  // fr-5wlv.5 (THE BALLOON WRAPPER, module doc): rename exactly one
  // PUBLIC definition one level out — under a lens the public names are
  // the lens wrappers, and the `(` anchor keeps the …Core/…Fractal
  // names untouched — throwing on structural surprises rather than
  // emitting a half-wrapped kernel.
  const balloonRename = (src: string, from: string, to: string): string => {
    const at = src.indexOf(from);
    if (at < 0 || src.includes(from, at + from.length)) {
      throw new Error(
        `surface-de-gpu: balloon rename expected exactly one "${from}"`,
      );
    }
    return src.replace(from, to);
  };
  // The balloon hit-info wrapper (the GLSL arm's surfaceDEBalloonHitInfo
  // term for term): argmin over the two terms' VALUE form picks which
  // query point's hit-info descent runs — ties to the fractal term
  // (`dS < dF` strict, the oracle's attribution convention) — and
  // colorPos carries the winner's own query point to the height/radius
  // color sources. The value form is the probe under fold shade configs
  // (GLSL parity: its balloon hit-info rides the no-cutoff value form,
  // which folds route to the probe — fr-p8bc's 23.8x shading verdict).
  const balloonValueDe =
    probeWidth === null ? "surfaceDEFractal" : "surfaceDEProbeFractal";
  const balloonHitWrapText = /* wgsl */ `fn surfaceDEHitInfo(p: vec3f, li: u32) -> SurfaceHitInfo {
  let dF = ${balloonValueDe}(p, 0.0, li);
  let inv = balloonInvert(p);
  let dS = inv.w * ${balloonValueDe}(inv.xyz, 0.0, li);
  if (dS < dF) {
    var hi = surfaceDEHitInfoFractal(inv.xyz, li);
    hi.colorPos = inv.xyz;
    return hi;
  }
  var hi = surfaceDEHitInfoFractal(p, li);
  hi.colorPos = p;
  return hi;
}`;
  const hitInfoText = balloon
    ? `${balloonRename(
        // WGSL value constructors are all-or-none, so the balloon-only
        // colorPos member (struct below) must join the core's full-member
        // constructor too — zeroed there; only the wrapper writes it.
        balloonRename(
          lensedHitInfoText,
          "SurfaceHitInfo(0, 0.0, 1.0, 1.0, 0.0)",
          "SurfaceHitInfo(0, 0.0, 1.0, 1.0, 0.0, vec3f(0.0))",
        ),
        "fn surfaceDEHitInfo(",
        "fn surfaceDEHitInfoFractal(",
      )}

// The balloon hit-info argmin wrapper (fr-5wlv.5) — around the renamed
// public, the lens sweep's mechanism one level further out.
${balloonHitWrapText}`
    : lensedHitInfoText;

  // The two LUT color sources whose NORMALIZER is dimension-specific
  // (fr-dlxh's 4D cut; every other shade term reconciles under the
  // packing contract). The 3D cores read the visible radius straight —
  // for the 4D cores that slot carries the slice-adjusted march gate,
  // which is what the sphere gate/shadow clamp/fog want but would make
  // these two colorings SWIM as w0 slides — so the 4D arm mirrors
  // surface-material-4d.ts instead: HEIGHT normalizes by the FULL 4D
  // visible radius (params.visRadius4), and RADIUS lifts the hit
  // through the rotor for the TRUE 4D radius, then normalizes its
  // center-relative distance over the visible set's own [minD, maxD]
  // band (params.radiusCenter4/radiusMinD/radiusInvRange — fr-skhv,
  // buildColors4's radius convention; still rotor/slice-invariant, the
  // band is an attractor-frame constant) — at the slab hit's OWN w
  // since fr-9c9e: hit-info's sStar places the hit along the fr-wa6o
  // segment, and stays 0 wherever no slab is descended (h = 0, the
  // noslab kernels, every 3D core), which keeps hitW equal to w0 there
  // bit for bit.
  //
  // Under BALLOON (fr-5wlv.5, 3D only) both read the winning term's
  // SOURCE point `hi.colorPos` instead of `pos` — a shell hit reads its
  // pre-inversion geometry, so the ramps sweep the same range as the
  // fractal's own instead of clamping at the far wall (the GLSL arm's
  // cpos routing).
  const shadeHeightU = core4
    ? `u = clamp(pos.y / params.visRadius4 * 0.5 + 0.5, 0.0, 1.0);`
    : balloon
      ? `u = clamp(hi.colorPos.y / visR * 0.5 + 0.5, 0.0, 1.0);`
      : `u = clamp(pos.y / visR * 0.5 + 0.5, 0.0, 1.0);`;
  const shadeRadiusU = core4
    ? `let hitW = params.w0 + hi.sStar * params.sliceHalfW;
      let q4c = rotorInvApply4(vec4f(pos, hitW));
      u = clamp(
        (length(q4c - params.radiusCenter4) - params.radiusMinD) *
          params.radiusInvRange,
        0.0, 1.0);`
    : balloon
      ? `u = clamp(length(hi.colorPos) / visR, 0.0, 1.0);`
      : `u = clamp(length(pos) / visR, 0.0, 1.0);`;

  // The march entry's gate (fr-5wlv.5): balloon mode drops the
  // visible-sphere gate (every ray can hit the enclosing shell) and caps
  // at the oracle's far horizon `|ro − c| + far`; capped rays keep the
  // same MISS path (background). The dither applies at t = 0, where its
  // max(t, 1.0) scale is exactly the GLSL arm's. The non-balloon arm is
  // the shipped text, byte for byte.
  // fr-rhn5: what a sphere-gate/sphere-exit MISS terminates as. With the
  // ground plane compiled in, the march classifies the miss against the
  // floor (PLANE inside the fade band, MISS past it — beyond fadeEnd the
  // shade would return pure background anyway, so those rays keep the
  // one-write miss path); without it, the literal MISS status — the
  // shipped text, byte for byte. Balloon never composes (throw above),
  // so the step loop's shared sphere-exit write — the balloon gate
  // itself has no early-outs — keeps the literal there too.
  const marchMissStatus = groundPlane
    ? "groundPlaneStatus(ro, rd)"
    : `${SURFACE_GPU_RAY_MISS}.0`;
  const marchGate = balloon
    ? `  // fr-5wlv.5: no visible-sphere gate in balloon mode — the enclosing
  // shell can be hit from anywhere, so every ray marches from the
  // camera, capped at the oracle's far horizon.
  let tFar = length(ro - params.balloonCenter) + params.balloonFar;
  var t = st.x;
  if (t < 0.0) {
    t = 0.0;${marchDither}
  }`
    : `  // Sphere gate, origin-centered like the GLSL marcher (the emulator's
  // exact arithmetic; recomputed per pass — cheaper than persisting).
  let radius = params.visibleRadius * 1.02;
  let bq = dot(ro, rd);
  let cq = dot(ro, ro) - radius * radius;
  let disc = bq * bq - cq;
  if (disc < 0.0) {
    st.y = ${marchMissStatus};
    states[ray] = st;
    return;
  }
  let sq = sqrt(disc);
  let tFar = -bq + sq;
  if (tFar <= 0.0) {
    st.y = ${marchMissStatus};
    states[ray] = st;
    return;
  }
  var t = st.x;
  if (t < 0.0) {
    t = max(-bq - sq, 0.0);${marchDither}
  }`;
  // The shade entry's fog-origin gate (fr-5wlv.5): balloon mode keeps
  // the sphere-entry recompute but drops the defensive no-intersection
  // miss — a shell hit can sit entirely outside the visible sphere, and
  // that early-out would paint a real hit as background — and clamps
  // tEnter to t so the fog pow never sees a negative base (the GLSL
  // arm's guard); shell hits nearer than the entry read fog-free. The
  // non-balloon arm is the shipped text, byte for byte.
  const shadeGate = balloon
    ? `  // Sphere-gate recompute, only for tEnter (the fog origin) —
  // fr-5wlv.5: no defensive no-intersection miss (a shell hit can sit
  // entirely outside the visible sphere).
  let radius = params.visibleRadius * 1.02;
  let bq = dot(ro, rd);
  let cq = dot(ro, ro) - radius * radius;
  let disc = bq * bq - cq;
  let sq = sqrt(max(disc, 0.0));
  let t = st.x;
  // --- shade: surface-material.ts main()'s hit path, term for term ---
  let pos = ro + rd * t;
  // The sphere entry when one exists — and the closest-approach depth
  // max(-bq, 0) for rays that MISS the sphere, NOT 0: both forms meet at
  // the silhouette (disc -> 0 collapses the entry to -bq), so the fog
  // origin is CONTINUOUS across the frame (the GLSL arm's fix — seeding
  // misses from the camera painted the sphere's silhouette as a lighter
  // disc over the shell). Clamped to t: a shell hit can land NEARER than
  // the origin, and the fog pow below must never see a negative base —
  // such hits read fog-free.
  let tEnter = min(max(-bq - sq, 0.0), t);`
    : `  // Sphere-gate recompute, only for tEnter (the fog origin) — cheaper
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
  let tEnter = max(-bq - sq, 0.0);`;
  // The shadow tap (fr-5wlv.5): the balloon receives shadows, never
  // casts them — shadow rays test the FRACTAL alone, so the enclosing
  // shell cannot black out the scene it wraps. Normal + AO stay on the
  // public union names.
  const shadowDe = balloon ? `${probeDe}Fractal` : probeDe;

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
${
  groundPlane
    ? `fn groundPlaneStatus(ro: vec3f, rd: vec3f) -> f32 {
  // fr-rhn5: classify a sphere MISS against the floor — PLANE only for
  // downward rays crossing y = groundY inside the fade band (past the
  // band the fade is 1 and the pixel is pure background, so it keeps
  // the one-write MISS path). One-sided: below the floor, background.
  if (ro.y <= params.groundY || rd.y >= -1.0e-6) {
    return ${SURFACE_GPU_RAY_MISS}.0;
  }
  let tp = (params.groundY - ro.y) / rd.y;
  let rel = (ro + rd * tp).xz - params.groundBallC.xz;
  if (dot(rel, rel) >= params.groundFadeEnd * params.groundFadeEnd) {
    return ${SURFACE_GPU_RAY_MISS}.0;
  }
  return ${SURFACE_GPU_RAY_PLANE}.0;
}

`
    : ""
}@compute @workgroup_size(${workgroupSize})
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
${marchGate}
  var steps = u32(st.z);
  for (var sIt = 0u; sIt < params.stepsThisPass; sIt++) {
    if (t > tFar) {
      st.y = ${marchMissStatus};
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
  // The slab hit's own place along the fr-wa6o query segment (fr-9c9e),
  // in [-1, 1] of |w - w0| <= sliceHalfW. Written only by the 4D cores'
  // slabExt bodies — every other core (and the noslab variant) leaves
  // the constructor's 0, which pins the radius color to the slice plane
  // exactly as before.
  sStar: f32,${
    balloon
      ? `
  // fr-5wlv.5 (balloon only): the winning union term's SOURCE query
  // point — the pre-inversion geometry the height/radius color sources
  // read (the GLSL arm's cpos). Cores zero it; only the balloon
  // hit-info wrapper writes it.
  colorPos: vec3f,`
      : ""
  }
}

${hitInfoText}
${
  groundPlane
    ? `
fn shadeGroundPlane(ro: vec3f, rd: vec3f, bg: vec3f, li: u32) -> vec3f {
  // Ground plane (fr-rhn5) — the SURFACE_GROUND_PLANE GLSL arm's
  // shadeGroundPlane, term for term. The march only queues PLANE rays,
  // but the geometry re-derives from scratch so the guards keep this
  // total on any input.
  if (ro.y <= params.groundY || rd.y >= -1.0e-6) {
    return bg;
  }
  let tp = (params.groundY - ro.y) / rd.y;
  let hp = ro + rd * tp;
  let rel = hp.xz - params.groundBallC.xz;
  // Scene-anchored radial fade to the pixel's own backdrop color.
  let fade =
    1.0 - smoothstep(params.groundFadeStart, params.groundFadeEnd, length(rel));
  if (fade <= 0.0) {
    return bg;
  }
  let gR = params.groundBallR;
  let visR = params.visibleRadius;
  // Penumbra shadow toward the light: the hit path's DE loop, adapted
  // for a start OUTSIDE the certified ball. Two analytic gates make the
  // infinite floor affordable — cost proportional to the shadow
  // CORRIDOR, not the floor area (certificates in the GLSL arm's doc):
  // ball-behind (along <= 0, exact once the floor sits >= 1.02 R below
  // the center) and a closest approach clearing 1.05 R + 0.3 * along.
  // Inside the corridor the loop's exit is outside-AND-receding — the
  // hit path's |sp| > 1.05 R alone would fire immediately down here.
  var shadow = 1.0;
  let toC = params.groundBallC - hp;
  let along = dot(toC, shade.lightDir);
  let perp2 = dot(toC, toC) - along * along;
  let corridor = gR * 1.05 + 0.3 * along;
  if (along > 0.0 && perp2 < corridor * corridor) {
    var ts = gR * 4.0e-4;
    for (var i = 0u; i < shade.shadowSteps; i++) {
      let sp = hp + shade.lightDir * ts;
      let d = ${probeDe}(sp, 0.0, li);
      shadow = min(shadow, 8.0 * d / ts);
      ts += clamp(d, gR * 2.0e-4, visR * 0.1);
      if (shadow < 0.02 ||
          (dot(sp - params.groundBallC, shade.lightDir) > 0.0 &&
            length(sp - params.groundBallC) > gR * 1.05)) {
        break;
      }
    }
    shadow = clamp(shadow, 0.0, 1.0);
  }
  // Contact occlusion: the hit path's AO taps straight up from the
  // floor, skipped once the floor point is provably beyond every tap's
  // reach of the ball (each tap needs DE < tap height, and DE is at
  // least |hp - C| - hh - R — so |hp - C| >= R + 2 hh_max certifies
  // occlusion 0; 0.02 R of margin on top).
  var ao = 1.0;
  let reach = gR * (1.02 + 0.04 * f32(shade.aoTaps));
  let relC = hp - params.groundBallC;
  if (dot(relC, relC) < reach * reach) {
    var occ = 0.0;
    var wgt = 1.0;
    var norm = 0.0;
    for (var i = 1u; i <= shade.aoTaps; i++) {
      let hh = gR * 0.02 * f32(i);
      occ += wgt *
        clamp((hh - ${probeDe}(hp + vec3f(0.0, hh, 0.0), 0.0, li)) / hh, 0.0, 1.0);
      norm += wgt;
      wgt *= 0.6;
    }
    ao = clamp(1.0 - 0.85 * occ / norm, 0.0, 1.0);
  }
  // The hit path's lighting minus specular (a matte floor), in the same
  // linear space (fr-8id): n is +y, so diffuse is just lightDir.y.
  let diffuse = max(shade.lightDir.y, 0.0);
  let lit = shade.ambient * ao + (1.0 - shade.ambient) * diffuse * shadow;
  var col = pow(pow(params.groundAlbedo, vec3f(2.2)) * lit, vec3f(1.0 / 2.2));
  // Depth fog, the hit path's formula at the plane distance; the fog
  // origin is the ray's closest approach to the ball center (clamped to
  // the segment), so the floor under the fractal stays as crisp as the
  // fractal and the fade band fogs like the far wall it is.
  let dist = tp - clamp(dot(params.groundBallC - ro, rd), 0.0, tp);
  let fog = 1.0 - exp(-0.12 * pow(dist * params.fogDensity / max(visR, 1.0e-6), 2.0));
  col = mix(col, mix(bg, shade.fogTint, shade.fogTintStrength), clamp(fog, 0.0, 1.0));
  return mix(bg, col, fade);
}
`
    : ""
}
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
  // fr-vpbq: this pass's sub-pixel sample position, the march entry's own
  // (default (0.5, 0.5), the pixel centre these lines used to spell out).
  let sub = shade.pixelJitter;
  // main()'s background gradient at this pixel's vUv.y (pixel center).
  // Deliberately NOT jittered: the backdrop is a smooth vertical ramp with
  // nothing to alias, it must agree with the host's own backgroundRows
  // prefill, and holding it fixed keeps supersampling a no-op wherever the
  // object is absent.
  let bg = mix(
    shade.bgBottom,
    shade.bgTop,
    clamp((f32(py) + 0.5) / f32(params.rasterHeight), 0.0, 1.0),
  );
${
  groundPlane
    ? `  if (st.y == ${SURFACE_GPU_RAY_PLANE}.0) {
    // Ground plane (fr-rhn5): the march classified this miss as
    // crossing the floor inside the fade band — unproject the ray (the
    // hit path's exact lines below) and light the analytic crossing.
    let ndcX = ((f32(px) + sub.x) / f32(params.rasterWidth)) * 2.0 - 1.0;
    let ndcY = ((f32(py) + sub.y) / f32(params.rasterHeight)) * 2.0 - 1.0;
    let nearP = shade.invProjView * vec4f(ndcX, ndcY, -1.0, 1.0);
    let farP = shade.invProjView * vec4f(ndcX, ndcY, 1.0, 1.0);
    let rd = normalize(farP.xyz / farP.w - nearP.xyz / nearP.w);
    colorOut[ray] =
      pack4x8unorm(vec4f(shadeGroundPlane(params.ro, rd, bg, li), 1.0));
    return;
  }
`
    : ""
}  if (st.y != ${SURFACE_GPU_RAY_HIT}.0) {
    colorOut[ray] = pack4x8unorm(vec4f(bg, 1.0));
    return;
  }
  let ndcX = ((f32(px) + sub.x) / f32(params.rasterWidth)) * 2.0 - 1.0;
  let ndcY = ((f32(py) + sub.y) / f32(params.rasterHeight)) * 2.0 - 1.0;
  // The GLSL tracer's unproject (main(): near/far clip points through
  // uInvProjView); params.ro doubles as uCamPos, and the pose basis
  // right/up/fwd/tanHalf/aspect fields are ignored in this mode.
  let nearP = shade.invProjView * vec4f(ndcX, ndcY, -1.0, 1.0);
  let farP = shade.invProjView * vec4f(ndcX, ndcY, 1.0, 1.0);
  let rd = normalize(farP.xyz / farP.w - nearP.xyz / nearP.w);
  let ro = params.ro;
${shadeGate}
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
      ${shadeHeightU}
    } else if (shade.colorSource == 3u) {
      ${shadeRadiusU}
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
    let d = ${shadowDe}(sp, 0.0, li);
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
  // traveled inside the bounding sphere. params.fogDensity (fr-5h5d)
  // scales the traveled distance, mirroring the GLSL tracers' uFogDensity
  // line for line. shade.fogTint/fogTintStrength (fr-5h5d) retarget the
  // blend to mix(bg, fogTint, strength) — strength 0 is the identity.
  let fog = 1.0 - exp(-0.12 * pow((t - tEnter) * params.fogDensity / max(visR, 1.0e-6), 2.0));
  col = mix(col, mix(bg, shade.fogTint, shade.fogTintStrength), clamp(fog, 0.0, 1.0));
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

  // fr-rhn5: the ground-plane params block at the frozen offset 272 —
  // SHARED with the balloon block (they are mutually exclusive by the
  // throw above, the escape/lens 208..271 precedent). Appended after
  // the escape variant block for the escape core, and after the
  // unconditionally-declared lens block (the balloon's frozen-offset
  // move) for the descent cores.
  const planeStructFields = /* wgsl */ `
  groundY: f32,
  groundFadeStart: f32,
  groundFadeEnd: f32,
  groundBallR: f32,
  groundBallC: vec3f,
  padG0: f32,
  groundAlbedo: vec3f,
  padG1: f32,`;
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
  // fr-5h5d: the frozen block's former pad1 slot, claimed for the fog
  // density multiplier — packed by every params packer
  // (packSurfaceGpuParams / packEscapeGpuParams / packSurface4GpuParams)
  // from run.fogDensity ?? 1, module doc's offset-204 row. Read only by
  // the shading pass's fog term below (the pure-eval/march bodies never
  // touch it, keeping their generated source textually unchanged).
  fogDensity: f32,${
    // The 4D tail comes FIRST in this chain (fr-rsp6 phase 2B): a lensed
    // 4D kernel needs both the tail AND its own appended lens4 block, so
    // core4 owns the variant block and the 3D lens fields stay the 3D
    // cores' alone. Every no-lens branch below is textually what it was.
    // The balloon members (fr-5wlv.5) live in the NON-core4 arm only
    // (balloon+core4 throws above) and land at the FROZEN offset 272 by
    // declaring the lens variant block UNCONDITIONALLY under balloon —
    // zero-filled by the packer when no lens, the module-doc contract.
    core4
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
  visRadius4: f32,
  radiusCenter4: vec4f,
  radiusMinD: f32,
  radiusInvRange: f32,
  pad4a: f32,
  pad4b: f32,${
    // fr-rsp6 phase 2B: the lens4 block, APPENDED past the 4D tail
    // (432..527) and declared only under the lens. A smaller struct
    // reading a larger buffer is valid WebGPU, so keeping it
    // struct-conditional is what keeps every no-lens 4D kernel's text
    // byte-identical.
    lens
      ? /* wgsl */ `
  lens4MR0: vec4f,
  lens4MR1: vec4f,
  lens4MR2: vec4f,
  lens4MR3: vec4f,
  lens4T: vec4f,
  lens4Params: vec4f,
  // fr-s9ll's lens lengths, the 3D lensFold one dimension up — the fold's
  // radii are dimension-free (SurfaceFoldRadii is SHARED by the two
  // oracles), so this is the same quartet at the 4D block's own offset.
  lens4Fold: vec4f,`
      : ""
  }`
      : core === "escape"
        ? /* wgsl */ `
  escM0: vec3f,
  escT0: f32,
  escM1: vec3f,
  escT1: f32,
  escM2: vec3f,
  escT2: f32,
  escParams: vec4f,
  // fr-s9ll: the fold-lens lengths' 272..287 slot, PAD here. This core has
  // no lens (escape+lens throws) and its links carry their own lengths on
  // the maps binding — the slot exists so the shared plane/balloon block
  // lands at ONE offset (288) across every 3D core, the same layout-parity
  // argument the 4D map struct's unread lanes already ride.
  padF: vec4f,${groundPlane ? planeStructFields : ""}`
        : core === "bulb"
          ? /* wgsl */ `
  bulbM0: vec3f,
  bulbT0: f32,
  bulbM1: vec3f,
  bulbT1: f32,
  bulbM2: vec3f,
  bulbT2: f32,
  bulbParams: vec4f,
  // The 272..287 fold-lens slot again, PAD: the bulb has no fold at all.
  padF: vec4f,${groundPlane ? planeStructFields : ""}`
          : lens || balloon || groundPlane
            ? /* wgsl */ `
  lensM0: vec3f,
  lensT0: f32,
  lensM1: vec3f,
  lensT1: f32,
  lensM2: vec3f,
  lensT2: f32,
  lensParams: vec4f,
  // fr-s9ll: the lens fold's three AUTHORED lengths — (minRadius,
  // fixedRadius, boxLimit, 0), surfaceFoldRadii's own inputs. The
  // wrapper re-derives the branch algebra from them through foldRadiiOf,
  // exactly as the per-map lanes do; packed zero when there is no lens,
  // which the wrapper never reads.
  lensFold: vec4f,${
    balloon
      ? /* wgsl */ `
  balloonCenter: vec3f,
  balloonRho: f32,
  balloonR: f32,
  balloonFar: f32,
  padB0: f32,
  padB1: f32,`
      : ""
  }${groundPlane ? planeStructFields : ""}`
            : ""
  }
}${
    !mapsBinding
      ? ""
      : core4
        ? /* wgsl */ `

struct GpuMap4 {
  r0: vec4f,
  r1: vec4f,
  r2: vec4f,
  r3: vec4f,
  t: vec4f,
  p0: vec4f,
  bnb: vec4f,
  p1: vec4f,
  fold: vec4f,
}`
        : /* wgsl */ `

struct GpuMap {
  r0: vec4f,
  r1: vec4f,
  r2: vec4f,
  p0: vec4f,
  bnb: vec4f,
  p1: vec4f,
  fold: vec4f,
}`
  }

@group(0) @binding(0) var<uniform> params: Params;${
    // The BULB core reads its one map from the params variant block and
    // never touches per-map storage; a declared-but-unused binding would
    // drop out of the auto layout anyway (module doc), so it is not
    // declared and hosts skip buffer 1. The ESCAPE core does declare it
    // (fr-s04t: its formula chain is a LIST of forward maps in the same
    // GpuMap layout). Both 4D cores' maps are the 4D layout (GpuMap4) —
    // one binding text for the pair, in the address space `mapsUniform`
    // picks (fr-b72d probe, option doc): the bodies index `maps[j]`
    // identically either way, so the variant is exactly this one line.
    !mapsBinding
      ? ""
      : core4
        ? mapsUniform
          ? `
@group(0) @binding(1) var<uniform> maps: array<GpuMap4, ${SURFACE_GPU_UNIFORM_MAP_SLOTS}>;`
          : `
@group(0) @binding(1) var<storage, read> maps: array<GpuMap4>;`
        : `
@group(0) @binding(1) var<storage, read> maps: array<GpuMap>;`
  }
${io}
${frontierBlock}${
    forward
      ? ""
      : core4
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
}

// The view lift's rotor half — the 4D GLSL's uInvRotor * v: world ->
// attractor frame through the transposed pose rotor (the packer stores
// the transpose's ROWS, so this dot-of-rows IS that product).
fn rotorInvApply4(v: vec4f) -> vec4f {
  return vec4f(
    dot(params.rotorInvR0, v),
    dot(params.rotorInvR1, v),
    dot(params.rotorInvR2, v),
    dot(params.rotorInvR3, v),
  );
}

// The rotor matrix's w COLUMN — the GLSL's uInvRotor[3], i.e. the pose
// rotor's w ROW read out of the packed transpose rows: what a
// view-frame w displacement of 1 lifts to, the slab half-extent's
// direction (fr-wa6o).
fn rotorInvWCol4() -> vec4f {
  return vec4f(
    params.rotorInvR0.w,
    params.rotorInvR1.w,
    params.rotorInvR2.w,
    params.rotorInvR3.w,
  );
}

// The affine final lens (identity/zero when none — the packer's
// contract, like the 3D finalM rows), and its LINEAR part alone for the
// half-extent — a translation slides a segment's centre, never its
// extent.
fn finalApply4(v: vec4f) -> vec4f {
  return vec4f(
    dot(params.final4MR0, v),
    dot(params.final4MR1, v),
    dot(params.final4MR2, v),
    dot(params.final4MR3, v),
  ) + params.final4T;
}

fn finalApplyLinear4(v: vec4f) -> vec4f {
  return vec4f(
    dot(params.final4MR0, v),
    dot(params.final4MR1, v),
    dot(params.final4MR2, v),
    dot(params.final4MR3, v),
  );
}

// Distance from the origin to the segment q + s*e, s in [-1, 1] — the
// slab query's stand-in for length(q) at every radius, escape test and
// ball certificate (fr-wa6o; the oracle's segmentRadius in the 4D
// GLSL's f32 formulation). At e = 0 the guarded s = 0 branch returns
// length(q) bit for bit, which is what keeps the shipped sliceHalfW 0
// the point query value for value.
fn segmentRadius4(q: vec4f, e: vec4f) -> f32 {
  let ee = dot(e, e);
  var s = 0.0;
  if (ee > 0.0) {
    s = clamp(-dot(q, e) / ee, -1.0, 1.0);
  }
  return length(q + s * e);
}

// The segment parameter s in [-1, 1] at that same closest approach — the
// argmin of the helper above, shared guard and all (fr-9c9e). Inverse
// maps preserve the segment parameterization, so a chain tuple's s lives
// on the ORIGINAL query segment at any depth; the shade entry lifts the
// radius color through w0 + sStar * sliceHalfW. 0 at e = 0.
fn segmentS4(q: vec4f, e: vec4f) -> f32 {
  let ee = dot(e, e);
  var s = 0.0;
  if (ee > 0.0) {
    s = clamp(-dot(q, e) / ee, -1.0, 1.0);
  }
  return s;
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
  }${
    // fr-s9ll: the WGSL mirror of surface-de.ts's `surfaceFoldRadii`, field
    // for field. The wire carries the three AUTHORED lengths (the packers'
    // own `resolveFoldRadii` output) and the branch algebra is re-derived
    // here rather than packed: three numbers a reader can check against the
    // document beat eight derived ones, which would be eight chances to
    // disagree with the oracle. Cost is a handful of divides ONCE per map
    // per descent level, outside a branch loop that runs up to 81 times.
    // At the classic (0.5, 1, 1) every expression is exactly the literal
    // that shipped — `wall`/`wall2` 1/2, `fixedR`/`invFixedR`/`fixedR2` 1,
    // `innerScale` 0.25, `innerSigma` 4, `outputR` 2 — so an unparameterized
    // document traces bit-identically. Emitted only where a fold branch
    // reads it (the fold cores, or ANY core under the fold-lens wrapper),
    // which keeps every affine kernel's source textually unchanged.
    foldRadii
      ? /* wgsl */ `

struct FoldRadii {
  wall: f32,
  wall2: f32,
  fixedR: f32,
  invFixedR: f32,
  fixedR2: f32,
  innerScale: f32,
  innerSigma: f32,
  outputR: f32,
  midMinR: f32,
}

fn foldRadiiOf(f: vec4f) -> FoldRadii {
  let mR = f.x;
  let fR = f.y;
  let fR2 = fR * fR;
  let mR2 = mR * mR;
  return FoldRadii(
    f.z,
    2.0 * f.z,
    fR,
    1.0 / fR,
    fR2,
    mR2 / fR2,
    fR2 / mR2,
    fR2 / mR,
    ${SPHEREFOLD_MID_MIN_R} * fR,
  );
}`
      : ""
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
          let absW = m.p0.z / mapSigma;
          let fr = foldRadiiOf(m.fold);${stage2MapHoist}
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
              pre1 = fr.wall2 - u;
              pre2 = -fr.wall2 - u;
              dUp = max(u - fr.wall, vec3f(0.0));
              dDn = max(-fr.wall - u, vec3f(0.0));
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
                  sfRd = max(fr.fixedR - ru, 0.0);
                } else if (s == 1u) {
                  v = fr.innerScale * u;
                  sfSigma = fr.innerSigma;
                  sfRd = max(ru - fr.outputR, 0.0);
                } else {
                  if (ru < fr.midMinR) {
                    // f32 overflow guard: fold the unit-shell bound and
                    // skip the branch + its box expansion.
                    var shellCert = pScale * absW * (fr.fixedR - ru);
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
                  let invR2 = fr.fixedR2 / (ru * ru);
                  v = u * invR2;
                  sfSigma = ru * fr.invFixedR;
                  sfRd = max(max(fr.fixedR - ru, ru - fr.outputR), 0.0);
                }${stage2SphereRescale}
                if (kind == 3u) {
                  pre0 = v;
                  pre1 = fr.wall2 - v;
                  pre2 = -fr.wall2 - v;
                  dUp = max(v - fr.wall, vec3f(0.0));
                  dDn = max(-fr.wall - v, vec3f(0.0));
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
  // estimator (surface-material-4d.ts's plain surfaceDE overload, the
  // f32 formulation this port follows line for line) in WGSL. Section
  // for section it is the AFFINE ladder above one dimension up, at the
  // oracle's FIXED width 4 (`wide` true, `extra` 2 — its width
  // conditionals collapse exactly as the GLSL's): A/B beam chains +
  // fr-jkpn V1/V2 validity slots, fr-beck's refined certificate under
  // the fr-1z6p laziness guard at every refined fold site. New here:
  // the view-lift prologue (rotor + w0, the GLSL's uInvRotor line), the
  // fr-wa6o slab query — one vec4f half-extent register beside every
  // point, moved by LINEAR parts alone and gated on the dynamically
  // uniform `segment` flag, segmentRadius4 in place of every |q| — and
  // the fr-u91x sector sweep stepping one whole backward 4x4. NO
  // footprint depth cap (the 4D oracle takes none; the packer throws on
  // one), so the loop runs plain params.maxDepth. `opts.width`,
  // `sharedFrontier` and `bnbStage2` are all inert here, like "affine".
  const affine4DescentText = (
    slabExt: boolean,
    lens: boolean,
  ): string => /* wgsl */ `${
    slabExt
      ? `// One extra Hutchinson level on a frozen escaped candidate's own
// inverse image (the oracle's refinedCert closure — fr-beck's measured
// ghost-eliminator, with fr-1z6p's guard riding at every call site):
// the certificate becomes childScale * max(r - R, min_j sigmaMin_j *
// (segmentRadius(invMap_j(img)) - R)) — never below the plain
// childScale * (r - R). "Every map" means every (sector, base map)
// pair (fr-u91x), the candidate's half-extent sweeping alongside by
// LINEAR parts alone (fr-wa6o); segment is recomputed from
// params.sliceHalfW — the 4D GLSL's free-function move, dynamically
// uniform, so both branches cost nothing across a dispatch.
`
      : `// One extra Hutchinson level on a frozen escaped candidate's own
// inverse image (the oracle's refinedCert closure — fr-beck's measured
// ghost-eliminator, with fr-1z6p's guard riding at every call site):
// the certificate becomes childScale * max(r - R, min_j sigmaMin_j *
// (length(invMap_j(img)) - R)) — never below the plain childScale *
// (r - R). "Every map" means every (sector, base map) pair (fr-u91x).
// fr-d0nn slabExt=false (fr-b72d probe): no fr-wa6o half-extent
// register — img is a point, not a segment.
`
  }${
    slabExt
      ? `fn refinedCert(img: vec4f, imgExt: vec4f, r: f32, childScale: f32) -> f32 {
`
      : `fn refinedCert(img: vec4f, r: f32, childScale: f32) -> f32 {
`
  }${
    slabExt
      ? `  let segment = params.sliceHalfW > 0.0;
`
      : ``
  }  var inner = 1e30;
  var sImg = img;
${
  slabExt
    ? `  var sExt = imgExt;
`
    : ``
}  for (var k = 0u; k < params.symOrder; k++) {
    if (k > 0u) {
      sImg = stepSector4(sImg);
${
  slabExt
    ? `      if (segment) {
        sExt = stepSector4(sExt);
      }
`
    : ``
}    }
    for (var j = 0u; j < params.mapCount; j++) {
      let m = maps[j];
      let jImg = mapApply4(m, sImg);
${
  slabExt
    ? `      var jExt = vec4f(0.0);
      if (segment) {
        jExt = mapApplyLinear4(m, sExt);
      }
`
    : ``
}      inner = min(
        inner,
${
  slabExt
    ? `        m.p0.x * (segmentRadius4(jImg, jExt) - params.boundingRadius),
`
    : `        m.p0.x * (length(jImg) - params.boundingRadius),
`
}      );
    }
  }
  return childScale * max(r - params.boundingRadius, inner);
}

fn surfaceDE(${core4Params("pIn", slabExt, lens)}, cutoff: f32, li: u32) -> f32 {
${lift4Text(
  "pIn",
  slabExt
    ? `  // View -> attractor frame (the 4D GLSL's uInvRotor line): a rotation
  // is an isometry, so distances, steps and gradients survive the lift
  // unchanged; then the affine final lens, exactly as the oracle's
  // prologue. The slab query's half-extent (fr-wa6o) is the rotor's w
  // column times sliceHalfW — a view-frame w displacement lifted into
  // the attractor frame — and the lens moves it by its LINEAR part
  // alone (a translation slides a segment's centre, never its extent).
`
    : `  // View -> attractor frame (the 4D GLSL's uInvRotor line): a rotation
  // is an isometry, so distances, steps and gradients survive the lift
  // unchanged; then the affine final lens, exactly as the oracle's
  // prologue. fr-d0nn slabExt=false (fr-b72d probe): no fr-wa6o
  // half-extent register — q is a point, not a segment.
`,
  slabExt,
  lens,
)}  let R = params.boundingRadius;
${
  slabExt
    ? `  let startR = segmentRadius4(q, ext);
`
    : `  let startR = length(q);
`
}  let sphereBound = startR - R;
  var best = 1e30;
  var bailBelow = -1e30;
  if (cutoff > 0.0 && sphereBound * params.final4SigmaMin < cutoff) {
    bailBelow = cutoff;
  }
${
  slabExt
    ? `  // Chain A starts at the (lifted, lensed) query; B idles until beam
  // selection fills it. Each chain carries the contraction accumulated
  // INCLUDING its own map, the radius it was selected at — scale *
  // (r - R) is its terminal bound — and its own segment half-extent,
  // one vec4f where the oracle unrolls a 4-element buffer. The validity
  // chains carry no R field: unlike A/B they never fold a terminal (see
  // past the loop), and expansion re-derives every child radius.
`
    : `  // Chain A starts at the (lifted, lensed) query; B idles until beam
  // selection fills it. Each chain carries the contraction accumulated
  // INCLUDING its own map and the radius it was selected at — scale *
  // (r - R) is its terminal bound. The validity chains carry no R
  // field: unlike A/B they never fold a terminal (see past the loop),
  // and expansion re-derives every child radius.
`
}  var aQ = q;
${
  slabExt
    ? `  var aExt = ext;
`
    : ``
}  var aScale = 1.0;
  var aR = startR;
  var aLive = true;
  var bQ = vec4f(0.0);
${
  slabExt
    ? `  var bExt = vec4f(0.0);
`
    : ``
}  var bScale = 1.0;
  var bR = 0.0;
  var bLive = false;
  var v1Q = vec4f(0.0);
${
  slabExt
    ? `  var v1Ext = vec4f(0.0);
`
    : ``
}  var v1Scale = 1.0;
  var v1Live = false;
  var v2Q = vec4f(0.0);
${
  slabExt
    ? `  var v2Ext = vec4f(0.0);
`
    : ``
}  var v2Scale = 1.0;
  var v2Live = false;
  // NO fr-3c0k footprint depth cap in this core — the 4D oracle takes
  // none (packSurface4GpuParams throws on a nonzero footprint), so the
  // loop runs plain params.maxDepth.
  for (var depth = 0u; depth < params.maxDepth; depth++) {
    if (!aLive && !bLive && !v1Live && !v2Live) {
      break;
    }
    // The four smallest-key candidates this level, key-ascending. The
    // sentinel r = 0 keeps empty slots out of every escaped-candidate
    // fold below.
    var c1Key = 1e30;
    var c1Q = vec4f(0.0);
${
  slabExt
    ? `    var c1Ext = vec4f(0.0);
`
    : ``
}    var c1Scale = 1.0;
    var c1R = 0.0;
    var c1Cert = 0.0;
    var c2Key = 1e30;
    var c2Q = vec4f(0.0);
${
  slabExt
    ? `    var c2Ext = vec4f(0.0);
`
    : ``
}    var c2Scale = 1.0;
    var c2R = 0.0;
    var c2Cert = 0.0;
    // Ranks 3/4, tracked the same way: a second insert-shift ladder fed
    // by everything the top-2 ladder evicts, so the pair holds exactly
    // the level's third- and fourth-smallest keys.
    var c3Key = 1e30;
    var c3Q = vec4f(0.0);
${
  slabExt
    ? `    var c3Ext = vec4f(0.0);
`
    : ``
}    var c3Scale = 1.0;
    var c3R = 0.0;
    var c3Cert = 0.0;
    var c4Key = 1e30;
    var c4Q = vec4f(0.0);
${
  slabExt
    ? `    var c4Ext = vec4f(0.0);
`
    : ``
}    var c4Scale = 1.0;
    var c4R = 0.0;
    var c4Cert = 0.0;
    for (var c = 0u; c < 4u; c++) {
      var pQ = vec4f(0.0);
${
  slabExt
    ? `      var pExt = vec4f(0.0);
`
    : ``
}      var pScale = 1.0;
      if (c == 0u) {
        if (!aLive) {
          continue;
        }
        pQ = aQ;
${
  slabExt
    ? `        pExt = aExt;
`
    : ``
}        pScale = aScale;
      } else if (c == 1u) {
        if (!bLive) {
          continue;
        }
        pQ = bQ;
${
  slabExt
    ? `        pExt = bExt;
`
    : ``
}        pScale = bScale;
      } else if (c == 2u) {
        if (!v1Live) {
          continue;
        }
        pQ = v1Q;
${
  slabExt
    ? `        pExt = v1Ext;
`
    : ``
}        pScale = v1Scale;
      } else {
        if (!v2Live) {
          continue;
        }
        pQ = v2Q;
${
  slabExt
    ? `        pExt = v2Ext;
`
    : ``
}        pScale = v2Scale;
      }
${
  slabExt
    ? `      // Sector sweep (fr-u91x, fr-x029's shape one dimension up): the
      // chain point — and, under a slab query, its half-extent, since
      // the backward step is an isometry taking segments to segments —
      // turns one step per kaleidoscope sector and every BASE map is
      // applied to it there, SECTOR-MAJOR (the expansion's k*n + i slot
      // order), so the candidate stream and the ladders' tie-breaks are
      // exactly the expansion's.
`
    : `      // Sector sweep (fr-u91x, fr-x029's shape one dimension up): the
      // chain point turns one step per kaleidoscope sector and every
      // BASE map is applied to it there, SECTOR-MAJOR (the expansion's
      // k*n + i slot order), so the candidate stream and the ladders'
      // tie-breaks are exactly the expansion's.
`
}      var sQ = pQ;
${
  slabExt
    ? `      var sExt = pExt;
`
    : ``
}      for (var k = 0u; k < params.symOrder; k++) {
        if (k > 0u) {
          sQ = stepSector4(sQ);
${
  slabExt
    ? `          if (segment) {
            sExt = stepSector4(sExt);
          }
`
    : ``
}        }
        for (var j = 0u; j < params.mapCount; j++) {
          let m = maps[j];
          let img = mapApply4(m, sQ);
${
  slabExt
    ? `          // GpuMap4 keeps translation in its own t field, so the
          // linear apply IS the inverse map's linear part — all a
          // segment's half-extent ever sees (fr-wa6o).
          var imgExt = vec4f(0.0);
          if (segment) {
            imgExt = mapApplyLinear4(m, sExt);
          }
          let r = segmentRadius4(img, imgExt);
`
    : `          let r = length(img);
`
}          let key = pScale * (r - R);
          let childScale = pScale * m.p0.x;
          let cert = childScale * (r - R);
          // Exactly one tuple leaves the top-2 ladder per candidate —
          // the displaced runner-up, or the candidate itself. It spills
          // into the rank-3/4 ladder or folds below; empty-slot
          // sentinels flow through both harmlessly (key 1e30 never
          // inserts, r = 0 never folds).
          var eKey = key;
          var eQ = img;
${
  slabExt
    ? `          var eExt = imgExt;
`
    : ``
}          var eScale = childScale;
          var eR = r;
          var eCert = cert;
          if (key < c1Key) {
            eKey = c2Key;
            eQ = c2Q;
${
  slabExt
    ? `            eExt = c2Ext;
`
    : ``
}            eScale = c2Scale;
            eR = c2R;
            eCert = c2Cert;
            c2Key = c1Key;
            c2Q = c1Q;
${
  slabExt
    ? `            c2Ext = c1Ext;
`
    : ``
}            c2Scale = c1Scale;
            c2R = c1R;
            c2Cert = c1Cert;
            c1Key = key;
            c1Q = img;
${
  slabExt
    ? `            c1Ext = imgExt;
`
    : ``
}            c1Scale = childScale;
            c1R = r;
            c1Cert = cert;
          } else if (key < c2Key) {
            eKey = c2Key;
            eQ = c2Q;
${
  slabExt
    ? `            eExt = c2Ext;
`
    : ``
}            eScale = c2Scale;
            eR = c2R;
            eCert = c2Cert;
            c2Key = key;
            c2Q = img;
${
  slabExt
    ? `            c2Ext = imgExt;
`
    : ``
}            c2Scale = childScale;
            c2R = r;
            c2Cert = cert;
          }
${
  slabExt
    ? `          // Spill into the rank-3/4 ladder (unconditional at width 4);
          // what THAT evicts — or the spilled tuple itself, when it
          // beats neither slot — falls through to the fold below. The
          // evicted KEY is dead past this point: only the folded fields
          // (point, extent, scale, radius, certificate) survive, and
          // width 4 is fixed here, so there is no tKey.
`
    : `          // Spill into the rank-3/4 ladder (unconditional at width 4);
          // what THAT evicts — or the spilled tuple itself, when it
          // beats neither slot — falls through to the fold below. The
          // evicted KEY is dead past this point: only the folded fields
          // (point, scale, radius, certificate) survive, and width 4 is
          // fixed here, so there is no tKey.
`
}          if (eKey < c3Key) {
            let tQ = c4Q;
${
  slabExt
    ? `            let tExt = c4Ext;
`
    : ``
}            let tScale = c4Scale;
            let tR = c4R;
            let tCert = c4Cert;
            c4Key = c3Key;
            c4Q = c3Q;
${
  slabExt
    ? `            c4Ext = c3Ext;
`
    : ``
}            c4Scale = c3Scale;
            c4R = c3R;
            c4Cert = c3Cert;
            c3Key = eKey;
            c3Q = eQ;
${
  slabExt
    ? `            c3Ext = eExt;
`
    : ``
}            c3Scale = eScale;
            c3R = eR;
            c3Cert = eCert;
            eQ = tQ;
${
  slabExt
    ? `            eExt = tExt;
`
    : ``
}            eScale = tScale;
            eR = tR;
            eCert = tCert;
          } else if (eKey < c4Key) {
            let tQ = c4Q;
${
  slabExt
    ? `            let tExt = c4Ext;
`
    : ``
}            let tScale = c4Scale;
            let tR = c4R;
            let tCert = c4Cert;
            c4Key = eKey;
            c4Q = eQ;
${
  slabExt
    ? `            c4Ext = eExt;
`
    : ``
}            c4Scale = eScale;
            c4R = eR;
            c4Cert = eCert;
            eQ = tQ;
${
  slabExt
    ? `            eExt = tExt;
`
    : ``
}            eScale = tScale;
            eR = tR;
            eCert = tCert;
          }
          // The tuple leaving the beam frontier: an escaped candidate
          // folds its REFINED certificate (fr-beck closes the
          // barely-escaped-sibling ghost), skipped whole when its PLAIN
          // certificate cannot beat the running min anyway (the
          // oracle's fr-1z6p laziness guard, bit-exact); an in-sphere
          // tuple carries no positive certificate — it can only get
          // here past FOUR smaller keys, the shrunken fr-jkpn residual
          // drop.
          if (eR > R && eCert < best) {
${
  slabExt
    ? `            best = min(best, refinedCert(eQ, eExt, eR, eScale));
`
    : `            best = min(best, refinedCert(eQ, eR, eScale));
`
}            // Cutoff exit (fr-55r5) plus the sphere-floor pin (fr-zkt2):
            // the folded certificate is FINALIZED (already refined) and
            // best only falls from here, so once best is at or below
            // sphereBound the return is pinned no matter how much
            // further it falls, and short of that the settled verdict
            // against the caller's cutoff cannot be lifted back either.
            if (
              best <= sphereBound ||
              best * params.final4SigmaMin < bailBelow
            ) {
              return max(best, sphereBound) * params.final4SigmaMin;
            }
          }
        }
      }
    }
    // Promote: the best candidate continues as chain A, the runner-up as
    // chain B; past the escape radius a candidate folds its PLAIN
    // terminal and dies instead (deeper refinement cannot improve the
    // min). Ranks 3/4 continue as validity chains ONLY while in-sphere;
    // escaped, they fold the same refined certificate they would have
    // folded without the slots.
    aLive = false;
    bLive = false;
    v1Live = false;
    v2Live = false;
    if (c1Key < 1e29) {
      if (c1R > params.escapeRadius) {
        best = min(best, c1Cert);
      } else {
        aQ = c1Q;
${
  slabExt
    ? `        aExt = c1Ext;
`
    : ``
}        aScale = c1Scale;
        aR = c1R;
        aLive = true;
      }
    }
    if (c2Key < 1e29) {
      if (c2R > params.escapeRadius) {
        best = min(best, c2Cert);
      } else {
        bQ = c2Q;
${
  slabExt
    ? `        bExt = c2Ext;
`
    : ``
}        bScale = c2Scale;
        bR = c2R;
        bLive = true;
      }
    }
    if (c3Key < 1e29) {
      if (c3R > R) {
        if (c3Cert < best) {
${
  slabExt
    ? `          best = min(best, refinedCert(c3Q, c3Ext, c3R, c3Scale));
`
    : `          best = min(best, refinedCert(c3Q, c3R, c3Scale));
`
}        }
      } else {
        v1Q = c3Q;
${
  slabExt
    ? `        v1Ext = c3Ext;
`
    : ``
}        v1Scale = c3Scale;
        v1Live = true;
      }
    }
    if (c4Key < 1e29) {
      if (c4R > R) {
        if (c4Cert < best) {
${
  slabExt
    ? `          best = min(best, refinedCert(c4Q, c4Ext, c4R, c4Scale));
`
    : `          best = min(best, refinedCert(c4Q, c4R, c4Scale));
`
}        }
      } else {
        v2Q = c4Q;
${
  slabExt
    ? `        v2Ext = c4Ext;
`
    : ``
}        v2Scale = c4Scale;
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
    if (best <= sphereBound || best * params.final4SigmaMin < bailBelow) {
      return max(best, sphereBound) * params.final4SigmaMin;
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
  return max(best, sphereBound) * params.final4SigmaMin;
}`;

  // The FOLD4 core (fr-rsp6 phase 2A): `descendFold4`'s refine=FALSE
  // path (surface-de-4d.ts) — the 3D fold core's width-parameterized
  // frontier ONE DIMENSION UP, behind the affine4 core's view lift.
  // refine=false is the fold cores' standing precedent (the fold GLSL
  // marches the plain estimator; phase 1 measured refinement a value
  // no-op on pure-fold systems), so `refinedCert` has no counterpart
  // here and an evicted tuple's POINT is dead — only its radius,
  // certificate and floor ever fold. Width is a REAL template parameter
  // (small integer literals collide with body constants, so a post-hoc
  // rename could never be safe), the frontier is ALWAYS function-scope
  // private (3D measured shared 2-3.3x slower), and the fr-kidj stage-2
  // skips are NOT emitted (3D measured them 1.4-1.6x slower GPU-side;
  // they are value no-ops, so the oracle agreement is untouched) — the
  // stage-1 floor prune, priced before the child transform, is the
  // whole branch-and-bound story in this body.
  const fold4DescentFnText = (
    w: number,
    slabExt: boolean,
    lens: boolean,
  ): string => /* wgsl */ `fn surfaceDE(${core4Params(
    "pIn",
    slabExt,
    lens,
  )}, cutoff: f32, li: u32) -> f32 {
  // The width-${w} frontier, in FUNCTION-SCOPE PRIVATE arrays: this core
  // emits no workgroup-shared variant, so sharedFrontier is inert and
  // li — kept for signature parity with every other core — indexes
  // nothing.
  var fcQ: array<vec4f, ${w}>;
${
  slabExt
    ? `  var fcExt: array<vec4f, ${w}>;
`
    : ``
}  var fcScale: array<f32, ${w}>;
  var fcFloor: array<f32, ${w}>;
  var fcR: array<f32, ${w}>;
  var fnKey: array<f32, ${w}>;
  var fnQ: array<vec4f, ${w}>;
${
  slabExt
    ? `  var fnExt: array<vec4f, ${w}>;
`
    : ``
}  var fnScale: array<f32, ${w}>;
  var fnFloor: array<f32, ${w}>;
  var fnR: array<f32, ${w}>;
  var fnCert: array<f32, ${w}>;
${lift4Text(
  "pIn",
  slabExt
    ? `  // View -> attractor frame (the 4D GLSL's uInvRotor line): a rotation
  // is an isometry, so distances, steps and gradients survive the lift
  // unchanged; then the affine final lens, exactly as the oracle's
  // prologue (a fold-BASE system may still carry an affine final; a fold
  // FINAL routes through the lens wrapper, which owns this lift —
  // fr-rsp6 phase 2B). The slab
  // query's half-extent (fr-wa6o) is the rotor's w column times
  // sliceHalfW, and the lens moves it by its LINEAR part alone.
`
    : `  // View -> attractor frame (the 4D GLSL's uInvRotor line): a rotation
  // is an isometry, so distances, steps and gradients survive the lift
  // unchanged; then the affine final lens, exactly as the oracle's
  // prologue (a fold-BASE system may still carry an affine final; a fold
  // FINAL routes through the lens wrapper, which owns this lift —
  // fr-rsp6 phase 2B). fr-d0nn
  // slabExt=false (fr-b72d probe): no fr-wa6o half-extent register — q
  // is a point, not a segment.
`,
  slabExt,
  lens,
)}  let R = params.boundingRadius;
${
  slabExt
    ? `  let startR = segmentRadius4(q, ext);
`
    : `  let startR = length(q);
`
}  let sphereBound = startR - R;
  var best = 1e30;
  var bailBelow = -1e30;
  if (cutoff > 0.0 && sphereBound * params.final4SigmaMin < cutoff) {
    bailBelow = cutoff;
  }
  var chainCount = 1u;
  fcQ[0] = q;
${
  slabExt
    ? `  fcExt[0] = ext;
`
    : ``
}  fcScale[0] = 1.0;
  fcFloor[0] = 0.0;
  fcR[0] = startR;
  // NO fr-3c0k footprint depth cap in this core — the 4D oracle takes
  // none (packSurface4GpuParams throws on a nonzero footprint), so the
  // loop runs plain params.maxDepth.
  for (var depth = 0u; depth < params.maxDepth; depth++) {
    if (chainCount == 0u) {
      break;
    }
    var keptCount = 0u;
    var fnWorstKey = -1e30;
    var fnWorstIdx = 0u;
    for (var c = 0u; c < chainCount; c++) {
      let pScale = fcScale[c];
      let pFloor = fcFloor[c];
      var sQ = fcQ[c];
${
  slabExt
    ? `      var sExt = fcExt[c];
`
    : ``
}      for (var k = 0u; k < params.symOrder; k++) {
        if (k > 0u) {
          sQ = stepSector4(sQ);
${
  slabExt
    ? `          if (segment) {
            sExt = stepSector4(sExt);
          }
`
    : ``
}        }
        for (var j = 0u; j < params.mapCount; j++) {
          let m = maps[j];
          let kind = u32(m.p0.w);
          // Fold-branch fans ONE DIMENSION UP (foldBranchCount4): the
          // boxfold folds four axes (3^4 = 81), the spherefold stays
          // radial (3), the mandelbox chains them (3 * 81 = 243).
          var branchCount = 1u;
          if (kind == 1u) {
            branchCount = 81u;
          } else if (kind == 2u) {
            branchCount = 3u;
          } else if (kind == 3u) {
            branchCount = 243u;
          }
          let mapSigma = m.p0.x;
          let absW = m.p0.z / mapSigma;
          let fr = foldRadiiOf(m.fold);
          var u = vec4f(0.0);
${
  slabExt
    ? `          var eu = vec4f(0.0);
`
    : ``
}          var ru = 0.0;
          var pre0 = vec4f(0.0);
          var pre1 = vec4f(0.0);
          var pre2 = vec4f(0.0);
          var dUp = vec4f(0.0);
          var dDn = vec4f(0.0);
          var v = vec4f(0.0);
          var sfSigma = 1.0;
          var sfRd = 0.0;
          if (kind != 0u) {
            u = sQ * m.p0.y;
${
  slabExt
    ? `            // u-space is a SCALAR multiple of world space, so the
            // half-extent scales with the point and stays a segment.
            if (segment) {
              eu = sExt * m.p0.y;
            }
`
    : ``
}            if (kind == 1u) {
              pre0 = u;
              pre1 = fr.wall2 - u;
              pre2 = -fr.wall2 - u;
              dUp = max(u - fr.wall, vec4f(0.0));
              dDn = max(-fr.wall - u, vec4f(0.0));
${
  slabExt
    ? `              // REGION DISTANCES UNDER A SEGMENT (fr-wa6o x fr-rsp6):
              // each per-axis distance is 1-Lipschitz in its own axis,
              // so relaxing it by |e_a| bounds the whole segment from
              // below, and the cell distance composes those bounds
              // independently. Relaxing HERE — before any selector reads
              // them — also covers the in-box selector's max(dUp, dDn),
              // since relaxation is monotone. Only BOXFOLD branches ever
              // transport a segment (slabExact4), so the mandelbox
              // refresh below needs no counterpart.
              if (segment) {
                let ae = abs(eu);
                dUp = max(dUp - ae, vec4f(0.0));
                dDn = max(dDn - ae, vec4f(0.0));
              }
`
    : ``
}            } else {
              ru = length(u);
            }
          }
          for (var b = 0u; b < branchCount; b++) {
            var img: vec4f;
${
  slabExt
    ? `            // Zeroed per BRANCH where the oracle keeps one module
            // scratch vector across them: the two differ only for a
            // spherefold/mandelbox branch under a segment query, and
            // slabExact4 refuses that system outright (the CPU entries
            // throw), so no reachable query separates them.
            var imgExt = vec4f(0.0);
`
    : ``
}            var branchSigma: f32;
            // The candidate's floor is knowable BEFORE the child
            // transform (fr-kidj stage 1), so the floor-vs-best prune
            // runs first and only surviving branches pay the inverse
            // application — the oracle's exact order. Stage 2 is
            // deliberately not emitted (option doc).
            var candFloor = pFloor;
            if (kind == 0u) {
              if (candFloor > 0.0 && candFloor >= best) {
                continue;
              }
              img = mapApply4(m, sQ);
${
  slabExt
    ? `              if (segment) {
                imgExt = mapApplyLinear4(m, sExt);
              }
`
    : ``
}              branchSigma = mapSigma;
            } else {
              var branchRd: f32;
              if (kind == 2u || (kind == 3u && (b % 81u) == 0u)) {
                // (Re)compute the spherefold branch this b enters, with
                // its distance to the branch's OUTPUT region. Every one
                // of those is a RADIAL statement, so the 3D constants
                // carry up unchanged — only ru gained a term. The
                // mandelbox's box expansion is 81 wide here, so its
                // sphere branch turns over every 81st index (3D: 27th).
                var s = b;
                if (kind == 3u) {
                  s = b / 81u;
                }
                if (s == 0u) {
                  v = u;
                  sfSigma = 1.0;
                  sfRd = max(fr.fixedR - ru, 0.0);
                } else if (s == 1u) {
                  v = fr.innerScale * u;
                  sfSigma = fr.innerSigma;
                  sfRd = max(ru - fr.outputR, 0.0);
                } else {
                  if (ru < fr.midMinR) {
                    // f32 overflow guard: fold the unit-shell bound and
                    // skip the branch + its box expansion (81 wide up
                    // here). A settled fold, so the standard exits apply.
                    var shellCert = pScale * absW * (fr.fixedR - ru);
                    shellCert = max(shellCert, pFloor);
                    if (shellCert < best) {
                      best = shellCert;
                      if (
                        best <= sphereBound ||
                        best * params.final4SigmaMin < bailBelow
                      ) {
                        return max(best, sphereBound) * params.final4SigmaMin;
                      }
                    }
                    if (kind == 3u) {
                      b += 80u;
                    }
                    continue;
                  }
                  let invR2 = fr.fixedR2 / (ru * ru);
                  v = u * invR2;
                  sfSigma = ru * fr.invFixedR;
                  sfRd = max(max(fr.fixedR - ru, ru - fr.outputR), 0.0);
                }
                if (kind == 3u) {
${
  slabExt
    ? `                  // No segment relaxation on this refresh — a mandelbox
                  // map never transports one (slabExact4).
`
    : ``
}                  pre0 = v;
                  pre1 = fr.wall2 - v;
                  pre2 = -fr.wall2 - v;
                  dUp = max(v - fr.wall, vec4f(0.0));
                  dDn = max(-fr.wall - v, vec4f(0.0));
                }
              }
              var pre: vec4f;
${
  slabExt
    ? `              var preExt = vec4f(0.0);
`
    : ``
}              if (kind == 2u) {
                pre = v;
                branchRd = sfRd;
              } else {
                // Box branch decode: per-axis preimage selectors, x
                // fastest, FOUR digits
                // (b = selX + 3*selY + 9*selZ + 27*selW).
                var bb = b;
                if (kind == 3u) {
                  bb = b % 81u;
                }
                let selX = bb % 3u;
                let selY = (bb / 3u) % 3u;
                let selZ = (bb / 9u) % 3u;
                let selW = bb / 27u;
                pre = vec4f(
                  select(select(pre2.x, pre1.x, selX == 1u), pre0.x, selX == 0u),
                  select(select(pre2.y, pre1.y, selY == 1u), pre0.y, selY == 0u),
                  select(select(pre2.z, pre1.z, selZ == 1u), pre0.z, selZ == 0u),
                  select(select(pre2.w, pre1.w, selW == 1u), pre0.w, selW == 0u),
                );
${
  slabExt
    ? `                // The branch's own derivative is diag(+-1): the in-box
                // preimage is u (+1), both folded ones are +-2 - u (-1).
                // A reflection takes a segment to a segment, so the
                // half-extent just picks up those signs.
                if (segment) {
                  preExt = vec4f(
                    select(-eu.x, eu.x, selX == 0u),
                    select(-eu.y, eu.y, selY == 0u),
                    select(-eu.z, eu.z, selZ == 0u),
                    select(-eu.w, eu.w, selW == 0u),
                  );
                }
`
    : ``
}                let dd = vec4f(
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
                  select(
                    select(dDn.w, dUp.w, selW == 1u),
                    max(dUp.w, dDn.w),
                    selW == 0u,
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
              }
              img = mapApply4(m, pre);
${
  slabExt
    ? `              if (segment) {
                imgExt = mapApplyLinear4(m, preExt);
              }
`
    : ``
}              branchSigma = m.p0.z * sfSigma;
            }
${
  slabExt
    ? `            let r = segmentRadius4(img, imgExt);
`
    : `            let r = length(img);
`
}            let childScale = pScale * branchSigma;
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
                  best * params.final4SigmaMin < bailBelow
                ) {
                  return max(best, sphereBound) * params.final4SigmaMin;
                }
              }
              continue;
            }
            // Frontier insertion: unsorted storage, worst-slot replace,
            // ties evicting the newcomer (the oracle's structure, term
            // for term). Whatever leaves the kept set folds plain:
            // escaped tuples their (floor-raised) certificate, in-sphere
            // tuples their floor — the drop-fold rule.
            var evR = 0.0;
            var evCert = 0.0;
            var evFloor = 0.0;
            var evHas = false;
            if (keptCount == ${w}u && key >= fnWorstKey) {
              evR = r;
              evCert = cert;
              evFloor = candFloor;
              evHas = true;
            } else {
              var slot = keptCount;
              if (keptCount == ${w}u) {
                slot = fnWorstIdx;
                evR = fnR[slot];
                evCert = fnCert[slot];
                evFloor = fnFloor[slot];
                evHas = true;
              } else {
                keptCount++;
              }
              fnKey[slot] = key;
              fnQ[slot] = img;
${
  slabExt
    ? `              fnExt[slot] = imgExt;
`
    : ``
}              fnScale[slot] = childScale;
              fnFloor[slot] = candFloor;
              fnR[slot] = r;
              fnCert[slot] = cert;
              // Recompute the worst kept key once the frontier is full
              // — a fixed-bound scan of reads, first max wins.
              if (keptCount == ${w}u) {
                fnWorstKey = -1e30;
                fnWorstIdx = 0u;
                for (var s2 = 0u; s2 < ${w}u; s2++) {
                  if (fnKey[s2] > fnWorstKey) {
                    fnWorstKey = fnKey[s2];
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
                    best * params.final4SigmaMin < bailBelow
                  ) {
                    return max(best, sphereBound) * params.final4SigmaMin;
                  }
                }
              } else if (evFloor > 0.0 && evFloor < best) {
                best = evFloor;
                if (
                  best <= sphereBound ||
                  best * params.final4SigmaMin < bailBelow
                ) {
                  return max(best, sphereBound) * params.final4SigmaMin;
                }
              }
            }
          }
        }
      }
    }
${
  slabExt
    ? `    // The kept tuples become the next frontier (key/cert are selection
    // artifacts; the chains carry point, half-extent, scale, floor and
    // radius).
`
    : `    // The kept tuples become the next frontier (key/cert are selection
    // artifacts; the chains carry point, scale, floor and radius).
`
}    for (var i2 = 0u; i2 < keptCount; i2++) {
      fcQ[i2] = fnQ[i2];
${
  slabExt
    ? `      fcExt[i2] = fnExt[i2];
`
    : ``
}      fcScale[i2] = fnScale[i2];
      fcFloor[i2] = fnFloor[i2];
      fcR[i2] = fnR[i2];
    }
    chainCount = keptCount;
  }
  // Floor-raised KIFS terminals for every chain alive at the depth cap.
  for (var cc = 0u; cc < chainCount; cc++) {
    var terminal = fcScale[cc] * (fcR[cc] - R);
    let tFloor = fcFloor[cc];
    if (tFloor > 0.0 && tFloor > terminal) {
      terminal = tFloor;
    }
    best = min(best, terminal);
  }
  return max(best, sphereBound) * params.final4SigmaMin;
}`;

  // The fold4 probe (fr-p8bc's discipline in 4D): the SAME body text at
  // the probe width under a second name. Both instantiations keep their
  // frontier in function-scope arrays — distinct scopes, so unlike 3D
  // there is nothing to rename but the declaration itself.
  const renameToProbe4 = (text: string): string =>
    text.replace("fn surfaceDE(", "fn surfaceDEProbe(");
  const probe4DeFns =
    probeWidth === null || core !== "fold4"
      ? ""
      : `

// fr-p8bc: the CHEAP descent for the shading probe taps — normal,
// shadow and AO light a hit the full-width march already certified, so
// they ride a width-${probeWidth} frontier (width 1 = the greedy
// descent). Same body as surfaceDE, renamed.
${renameToProbe4(fold4DescentFnText(probeWidth, slabExt, lens))}`;

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
  //
  // THE CHAIN (fr-s04t): the orbit CYCLES through `params.mapCount` links
  // read from the maps storage binding — slot `i mod n`, Mandelbulber2's
  // `seq->GetSequence(i)`, with `+ q` and the bailout test after EACH link
  // (chaining them fattens the set to 72.8% of the bailout ball at six
  // links, which is fr-7u8t.8's "the object WAS its own bounding sphere"
  // returning). A PASS is one full cycle, so the loop runs
  // `maxDepth * n` single-link steps and `maxDepth` keeps meaning "how
  // many times is each link applied" — the preview clamp's contract at any
  // chain length. Every link contributes its own factor to the ONE shared
  // `dr`, whose `+ 1` (the per-link offset's own derivative) floors it
  // once per link.
  const escapeDescentText = /* wgsl */ `// escape-de.ts's foldQueryIntoSector (fr-s04t) — the kaleidoscope as a
// QUERY-SPACE wedge fold applied ONCE before the orbit, never as an orbit
// operation (the escape set of v <- F(v) + p inherits a rotation only
// where F commutes with it). DIHEDRAL, and forced rather than chosen: the
// chaos game's cyclic fold jumps across sector seams, and a discontinuous
// map has no Lipschitz bound, so the estimate would certify empty balls
// through the seam. g is 1-Lipschitz and an isometry per sector, so the
// marching ball does not move and dr needs no new term. symOrder <= 1
// returns the point untouched — what keeps an unsymmetrised document
// bit-identical to fr-dlxh's. Plane codes are SYM_PLANE_CODE's
// (0 = yz, 1 = xz, 2 = xy), axes the oracle's own ia/ib.
fn foldQuerySector(p: vec3f) -> vec3f {
  if (params.symOrder <= 1u) {
    return p;
  }
  let a = select(p.x, p.y, params.symPlane == 0u);
  let b = select(p.z, p.y, params.symPlane == 2u);
  let sector = 6.283185307179586 / f32(params.symOrder);
  // Rotate BACK by the nearest whole sector, then mirror across the first
  // axis: the reflection group's fundamental-domain retraction. A tie
  // exactly on a boundary is consistent either way it rounds (the two
  // roundings differ by a reflection the mirror undoes).
  let turn = round(atan2(b, a) / sector) * sector;
  let c = cos(turn);
  let s = sin(turn);
  let fa = a * c + b * s;
  let fb = abs(b * c - a * s);
  if (params.symPlane == 0u) {
    return vec3f(p.x, fa, fb);
  }
  if (params.symPlane == 1u) {
    return vec3f(fa, p.y, fb);
  }
  return vec3f(fa, fb, p.z);
}

fn surfaceDE(pIn: vec3f, cutoff: f32, li: u32) -> f32 {
  let q = foldQuerySector(pIn);
  var v = q;
  var dr = 1.0;
  var r = length(v);
  let n = params.mapCount;
  let steps = params.maxDepth * n;
  var link = 0u;
  for (var i = 0u; i < steps; i++) {
    if (r > params.boundingRadius) {
      break;
    }
    // The fr-za0n cycle: link i mod n, which is the single map itself at
    // n = 1. GpuMap rows carry the FORWARD affine here (M row j in
    // r{j}.xyz, t.{xyz} in the .w lanes) and p0 is the GLSL uEscParams
    // quartet (foldKind, w, derivGrowth, 0).
    let L = maps[link];
    let kind = u32(L.p0.x);
    var y = vec3f(
      dot(L.r0.xyz, v) + L.r0.w,
      dot(L.r1.xyz, v) + L.r1.w,
      dot(L.r2.xyz, v) + L.r2.w,
    );
    var localL = 1.0;
    if (kind != 2u) {
      // The box fold (boxfold + mandelbox): per-axis reflections,
      // local factor 1.
      // fr-s9ll: the link's own box wall — escape-de.ts's foldAxis(t, wall).
      y = clamp(y, vec3f(-L.fold.z), vec3f(L.fold.z)) * 2.0 - y;
    }
    if (kind != 1u) {
      // The sphere fold (spherefold + mandelbox): variations.ts's
      // sphereFoldFactor, which IS the local conformal factor.
      // ...and its own sphere shell, SQUARED on the wire exactly as
      // EscapeLink keeps it: fR2 / clamp(r2, mR2, fR2).
      let f = L.fold.y / clamp(dot(y, y), L.fold.x, L.fold.y);
      y *= f;
      localL = f;
    }
    // fr-7u8t.8: the Mandelbrot form's offset — the QUERY POINT (folded,
    // fr-s04t), not the document's t (which stays the pre-fold offset
    // inside y above).
    v = L.p0.y * y + q;
    dr = L.p0.z * localL * dr + 1.0;
    r = length(v);
    link++;
    if (link == n) {
      link = 0u;
    }
  }
  return r / dr;
}`;

  // The BULB core (fr-7u8t.9): bulb-de.ts's estimateBulbDistance — the
  // forward triplex-power orbit with the Boettcher log estimate,
  // DE = 0.5 * |y| * ln|y| / dr — in the SURFACE_BULB GLSL arm's f32
  // formulation (surface-material.ts, the variant this core replaces on
  // the compute route). Structurally the escape core: no descent, no
  // frontier, no prunes, so cutoff is accepted for signature parity and
  // ignored (every return IS the cutoff-0 result, trivially the fr-55r5
  // contract) and li never indexes anything. Plain params.maxDepth — the
  // orbit's iteration budget; no footprint cap, like the GLSL arm.
  const bulbDescentText = /* wgsl */ `// variations.ts's triplexPow8, the White/Nylander 8th power in its
// trig-free form: Chebyshev T8/U7 for the polar angle, three complex
// squarings (de Moivre) for the azimuth. The power is BAKED IN — triplex
// multiplication is not associative, so p^8 is not ((p^2)^2)^2 and every
// power needs its own closed form (bulb-de.ts's BULB_POWER doc). r2 is
// passed in because every caller already has it.
fn bulbPow8(y: vec3f, r2: f32) -> vec3f {
  let a = y.x * y.x + y.y * y.y;
  let z2 = y.z * y.z;
  let r4 = r2 * r2;
  let vz = 128.0 * z2 * z2 * z2 * z2 - 256.0 * z2 * z2 * z2 * r2 + 160.0 * z2 * z2 * r4 - 32.0 * z2 * r4 * r2 + r4 * r4;
  let s = 128.0 * z2 * z2 * z2 * y.z - 192.0 * z2 * z2 * y.z * r2 + 80.0 * z2 * y.z * r4 - 8.0 * y.z * r4 * r2;
  let rho = sqrt(a);
  var inv = 0.0;
  if (rho > 0.0) {
    inv = 1.0 / rho;
  }
  let u1 = y.x * inv;
  let v1 = y.y * inv;
  let u2 = u1 * u1 - v1 * v1;
  let v2 = 2.0 * u1 * v1;
  let u4 = u2 * u2 - v2 * v2;
  let v4 = 2.0 * u2 * v2;
  let u8 = u4 * u4 - v4 * v4;
  let v8 = 2.0 * u4 * v4;
  return vec3f(rho * s * u8, rho * s * v8, vz);
}

fn surfaceDE(pIn: vec3f, cutoff: f32, li: u32) -> f32 {
  let sigma = params.bulbParams.x;
  let bail = params.bulbParams.y;
  // y_0 = M p + t — the point the power is applied to, and the
  // Mandelbrot form's per-iteration offset in y space.
  let c = vec3f(
    dot(params.bulbM0, pIn) + params.bulbT0,
    dot(params.bulbM1, pIn) + params.bulbT1,
    dot(params.bulbM2, pIn) + params.bulbT2,
  );
  var y = c;
  // dr bounds |d y_n / d p|, so it starts at |M| rather than 1.
  var dr = sigma;
  var r2 = dot(y, y);
  var r = sqrt(r2);
  for (var i = 0u; i < params.maxDepth; i++) {
    if (r > bail) {
      break;
    }
    // 8*r^7 is the triplex power's radial/polar stretch, then M's
    // operator norm, then the offset's own derivative — which also
    // FLOORS dr at sigma, load-bearing wherever |y| < 1 (bulb-de.ts).
    dr = ${BULB_POWER}.0 * (r2 * r2 * r2 * r) * sigma * dr + sigma;
    let v = bulbPow8(y, r2);
    y = vec3f(dot(params.bulbM0, v), dot(params.bulbM1, v), dot(params.bulbM2, v)) + c;
    r2 = dot(y, y);
    r = sqrt(r2);
  }
  // ln|y| goes NEGATIVE below |y| = 1, which a converging orbit reaches,
  // and a negative estimate marches the tracer BACKWARDS. Returning 0
  // there is the inside signal and is safe in the direction a sphere
  // tracer needs (bulb-de.ts's closing comment).
  if (r <= 1.0) {
    return 0.0;
  }
  return 0.5 * r * log(r) / dr;
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
        : core === "bulb"
          ? `// estimateBulbDistance (bulb-de.ts) — the forward triplex-power
// orbit's Mandelbulb estimator, the SURFACE_BULB GLSL arm's twin
// (fr-7u8t.9).
${bulbDescentText}`
          : core === "affine4"
            ? `// estimateDistance4Refined (surface-de-4d.ts) behind the view lift —
// the estimator the 4D GLSL tracer marches (surface-material-4d.ts), in
// that mirror's f32 formulation. Fixed width 4 (fr-dlxh's 4D cut).
${affine4DescentText(slabExt, lens)}`
            : core === "fold4"
              ? `// descendFold4's refine=false path (surface-de-4d.ts) behind the same
// view lift — the 4D fold-branch frontier, f32 (fr-rsp6 phase 2A).
${fold4DescentFnText(width, slabExt, lens)}${probe4DeFns}`
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
  let fr = foldRadiiOf(params.lensFold);
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
    pre1 = fr.wall2 - u;
    pre2 = -fr.wall2 - u;
    dUp = max(u - fr.wall, vec3f(0.0));
    dDn = max(-fr.wall - u, vec3f(0.0));
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
        sfRd = max(fr.fixedR - ru, 0.0);
      } else if (s == 1u) {
        v = fr.innerScale * u;
        sfSigma = fr.innerSigma;
        sfRd = max(ru - fr.outputR, 0.0);
      } else {
        if (ru < fr.midMinR) {
          // Shell guard (the oracle's): fold the settled shell bound,
          // skip the branch + its box expansion.
          let shellCert = absW * (fr.fixedR - ru);
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
        let invR2 = fr.fixedR2 / (ru * ru);
        v = u * invR2;
        sfSigma = ru * fr.invFixedR;
        sfRd = max(max(fr.fixedR - ru, ru - fr.outputR), 0.0);
      }
      if (kind == 3u) {
        pre0 = v;
        pre1 = fr.wall2 - v;
        pre2 = -fr.wall2 - v;
        dUp = max(v - fr.wall, vec3f(0.0));
        dDn = max(-fr.wall - v, vec3f(0.0));
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

  // THE 4D FOLD FINAL LENS (fr-rsp6 phase 2B): `descendLens4`
  // (surface-de-4d.ts) — the wrapper above one dimension up, with every
  // dimension-sensitive quantity the 4D one: 81/3/243 branches decoded
  // `b = selX + 3*selY + 9*selZ + 27*selW` (the mandelbox's sphere branch
  // turning over every 81st index, its shell guard skipping `b += 80u`),
  // `segmentRadius4` in place of every `length` so a fr-wa6o slab rides
  // through the lens (boxfold lenses only — `slabExact4` refuses the
  // rest, and {@link packSurface4GpuParams} throws rather than pack one),
  // and an ORIGIN-anchored visible ball at the FULL 4D radius
  // `params.visRadius4` — NOT the frozen `visibleRadius` slot, which
  // carries this core's slice-adjusted march gate (packing contract).
  //
  // The wrapper also owns the VIEW LIFT: the 4D cores keep theirs in
  // their own prologue, so under the lens it is hoisted here and each
  // branch hands the core an already-lifted 4D query — the documented
  // deviation from 3D's untouched-core signatures (module doc, THE
  // FOLD-LENS WRAPPER).
  //
  // THE REFINE SEAM. `descendLens4` routes its inner descent
  // `hasFolds ? descendFold4(…, refine ? innerCutoff : 0) : refine ?
  // descend4Refined(…, innerCutoff) : descend4(…)`, and each kernel core
  // mirrors ONE arm: "affine4" IS the refined estimator, so it takes the
  // fr-55r5 inner cutoff `min(best, cutoff) / factor`; "fold4" is the
  // PLAIN frontier (refine=false), so it takes cutoff 0 and the inner
  // cutoff is never even computed. Swapping them would silently mirror a
  // different estimator than the oracle the bench pins against.
  const lens4Refined = core === "affine4";
  const lens4CoreCall = `surfaceDECore(q, ${slabExt ? "qExt, " : ""}${
    lens4Refined ? "innerCutoff" : "0.0"
  }, li)`;
  const lens4WrapText = /* wgsl */ `fn surfaceDE(pIn: vec3f, cutoff: f32, li: u32) -> f32 {
  // The cores' view lift, hoisted: ONE rotor apply for the whole sweep
  // (and one half-extent seed under a slab), where the no-lens bodies do
  // it per call.
  let p = rotorInvApply4(vec4f(pIn, params.w0));
${
  slabExt
    ? `  let segment = params.sliceHalfW > 0.0;
  var pExt = vec4f(0.0);
  if (segment) {
    pExt = rotorInvWCol4() * params.sliceHalfW;
  }
  let visBound = segmentRadius4(p, pExt) - params.visRadius4;
`
    : `  let visBound = length(p) - params.visRadius4;
`
}  let kind = u32(params.lens4Params.x);
  let absW = params.lens4Params.z;
  let u = p * params.lens4Params.y;
  let fr = foldRadiiOf(params.lens4Fold);
${
  slabExt
    ? `  // u-space is a SCALAR multiple of world space, so the half-extent
  // scales with the point and stays a segment.
  var eu = vec4f(0.0);
  if (segment) {
    eu = pExt * params.lens4Params.y;
  }
`
    : ``
}  var best = 1e30;
  var ru = 0.0;
  var pre0 = vec4f(0.0);
  var pre1 = vec4f(0.0);
  var pre2 = vec4f(0.0);
  var dUp = vec4f(0.0);
  var dDn = vec4f(0.0);
  var v = vec4f(0.0);
  var sfSigma = 1.0;
  var sfRd = 0.0;
  if (kind == 1u) {
    pre0 = u;
    pre1 = fr.wall2 - u;
    pre2 = -fr.wall2 - u;
    dUp = max(u - fr.wall, vec4f(0.0));
    dDn = max(-fr.wall - u, vec4f(0.0));
${
  slabExt
    ? `    // Per-axis segment relaxation, applied BEFORE any selector reads
    // them (the frontier body's argument verbatim): each per-axis
    // distance is 1-Lipschitz in its own axis, so relaxing it by |e_a|
    // bounds the whole segment from below, and monotonicity carries it
    // into the in-box max(dUp, dDn). Only a BOXFOLD lens ever transports
    // a segment (slabExact4), so the mandelbox refresh below needs no
    // counterpart.
    if (segment) {
      let ae = abs(eu);
      dUp = max(dUp - ae, vec4f(0.0));
      dDn = max(dDn - ae, vec4f(0.0));
    }
`
    : ``
}  } else {
    ru = length(u);
  }
  var branchCount = 243u;
  if (kind == 1u) {
    branchCount = 81u;
  } else if (kind == 2u) {
    branchCount = 3u;
  }
  for (var b = 0u; b < branchCount; b++) {
    if (kind == 2u || (kind == 3u && (b % 81u) == 0u)) {
      var s = b;
      if (kind == 3u) {
        s = b / 81u;
      }
      if (s == 0u) {
        v = u;
        sfSigma = 1.0;
        sfRd = max(fr.fixedR - ru, 0.0);
      } else if (s == 1u) {
        v = fr.innerScale * u;
        sfSigma = fr.innerSigma;
        sfRd = max(ru - fr.outputR, 0.0);
      } else {
        if (ru < fr.midMinR) {
          // Shell guard (the oracle's): fold the settled shell bound,
          // skip the branch + its 81-wide box expansion.
          let shellCert = absW * (fr.fixedR - ru);
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
            b += 80u;
          }
          continue;
        }
        let invR2 = fr.fixedR2 / (ru * ru);
        v = u * invR2;
        sfSigma = ru * fr.invFixedR;
        sfRd = max(max(fr.fixedR - ru, ru - fr.outputR), 0.0);
      }
      if (kind == 3u) {
        pre0 = v;
        pre1 = fr.wall2 - v;
        pre2 = -fr.wall2 - v;
        dUp = max(v - fr.wall, vec4f(0.0));
        dDn = max(-fr.wall - v, vec4f(0.0));
      }
    }
    var pre: vec4f;
${
  slabExt
    ? `    var preExt = vec4f(0.0);
`
    : ``
}    var branchRd: f32;
    if (kind == 2u) {
      pre = v;
      branchRd = sfRd;
    } else {
      // Box branch decode: per-axis preimage selectors, x fastest, FOUR
      // digits (b = selX + 3*selY + 9*selZ + 27*selW).
      var bb = b;
      if (kind == 3u) {
        bb = b % 81u;
      }
      let selX = bb % 3u;
      let selY = (bb / 3u) % 3u;
      let selZ = (bb / 9u) % 3u;
      let selW = bb / 27u;
      pre = vec4f(
        select(select(pre2.x, pre1.x, selX == 1u), pre0.x, selX == 0u),
        select(select(pre2.y, pre1.y, selY == 1u), pre0.y, selY == 0u),
        select(select(pre2.z, pre1.z, selZ == 1u), pre0.z, selZ == 0u),
        select(select(pre2.w, pre1.w, selW == 1u), pre0.w, selW == 0u),
      );
${
  slabExt
    ? `      // The branch's own derivative is diag(+-1): the in-box preimage
      // is u (+1), both folded ones are +-2 - u (-1). A reflection takes
      // a segment to a segment, so the half-extent picks up those signs.
      if (segment) {
        preExt = vec4f(
          select(-eu.x, eu.x, selX == 0u),
          select(-eu.y, eu.y, selY == 0u),
          select(-eu.z, eu.z, selZ == 0u),
          select(-eu.w, eu.w, selW == 0u),
        );
      }
`
    : ``
}      let dd = vec4f(
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
        select(
          select(dDn.w, dUp.w, selW == 1u),
          max(dUp.w, dDn.w),
          selW == 0u,
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
    let q = vec4f(
      dot(params.lens4MR0, pre),
      dot(params.lens4MR1, pre),
      dot(params.lens4MR2, pre),
      dot(params.lens4MR3, pre),
    ) + params.lens4T;
${
  slabExt
    ? `    // The lens's AFFINE part carries the branch half-extent by its
    // LINEAR part alone (a translation slides a segment's centre, never
    // its extent).
    var qExt = vec4f(0.0);
    if (segment) {
      qExt = vec4f(
        dot(params.lens4MR0, preExt),
        dot(params.lens4MR1, preExt),
        dot(params.lens4MR2, preExt),
        dot(params.lens4MR3, preExt),
      );
    }
`
    : ``
}    let factor = absW * sfSigma * params.lens4Params.w;
${
  slabExt
    ? `    let rq = segmentRadius4(q, qExt);
`
    : `    let rq = length(q);
`
}    // The core never undercuts its own depth-0 sphere bound, so a branch
    // whose scaled sphere certificate reaches the running min cannot
    // advance it — an exact skip.
    if (factor * (rq - params.boundingRadius) >= best) {
      continue;
    }
${
  lens4Refined
    ? `    var innerCutoff = 0.0;
    if (cutoff > 0.0) {
      innerCutoff = min(best, cutoff) / factor;
    }
`
    : `    // refine=false arm (see THE REFINE SEAM): the plain frontier core
    // takes cutoff 0, exactly the oracle's \`refine ? innerCutoff : 0\`.
`
}    var term = factor * ${lens4CoreCall};
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
  const probeLens4WrapText = lens4WrapText
    .replace("fn surfaceDE(", "fn surfaceDEProbe(")
    .replace(
      lens4CoreCall,
      lens4CoreCall.replace("surfaceDECore(", "surfaceDEProbeCore("),
    );
  const lensedBodyBlock = lens
    ? `${descentBlock
        .replace("fn surfaceDE(", "fn surfaceDECore(")
        .replace("fn surfaceDEProbe(", "fn surfaceDEProbeCore(")}

// ${
        core4
          ? "descendLens4 (surface-de-4d.ts) — the 4D fold FINAL lens's\n// branch sweep around the core, whose view lift it now owns\n// (fr-rsp6 phase 2B)."
          : "descendLens (surface-de.ts) — the fold FINAL lens's branch sweep\n// around the untouched core (fr-g58b's vocabulary, fr-55s1 stage B)."
      }
${core4 ? lens4WrapText : lensWrapText}${
        probeWidth === null
          ? ""
          : `

// The probe taps' own lens sweep (fr-55s1 stage C) — same text, renamed.
${core4 ? probeLens4WrapText : probeLensWrapText}`
      }`
    : descentBlock;

  // THE BALLOON WRAPPER (fr-5wlv.5, module doc): the union DE over the
  // composed variant's public value descent, derived by .replace from
  // one template string so the probe twin cannot drift (the
  // probeLensWrapText discipline).
  const balloonDeWrapText = /* wgsl */ `fn surfaceDE(pIn: vec3f, cutoff: f32, li: u32) -> f32 {
  let dF = surfaceDEFractal(pIn, cutoff, li);
  let inv = balloonInvert(pIn);
  let innerCutoff = select(0.0, cutoff / inv.w, cutoff > 0.0);
  let dS = inv.w * surfaceDEFractal(inv.xyz, innerCutoff, li);
  return min(dS, dF);
}`;
  const balloonProbeWrapText = balloonDeWrapText
    .replace("fn surfaceDE(", "fn surfaceDEProbe(")
    .replaceAll("surfaceDEFractal(", "surfaceDEProbeFractal(");
  const bodyBlock = balloon
    ? `${
        probeWidth === null
          ? balloonRename(
              lensedBodyBlock,
              "fn surfaceDE(",
              "fn surfaceDEFractal(",
            )
          : balloonRename(
              balloonRename(
                lensedBodyBlock,
                "fn surfaceDE(",
                "fn surfaceDEFractal(",
              ),
              "fn surfaceDEProbe(",
              "fn surfaceDEProbeFractal(",
            )
      }

// fr-5wlv.5: the balloon inverted-union (fractal/balloon-de.ts's
// estimateBalloonDistance, the GLSL SURFACE_BALLOON block's WGSL twin):
// min(DE(p), (|p-c|/rho)*DE(I(p))) over the compiled variant's public DE,
// conservative at every R; the shell cutoff scales by the inverse of its
// value factor so the fr-55r5 contract survives verbatim. No far-field
// clamp here, unlike the GLSL arm's balloonInnerDE: both FORWARD cores
// are refused at codegen (their solids swallow the camera — fr-5wlv.4), and
// the IFS descents' far field is the value-exact sphere floor, already
// a true bound.
fn balloonInvert(p: vec3f) -> vec4f {
  let d = p - params.balloonCenter;
  // f32 floor: 1e-6 * rho (the GLSL arm's choice; the CPU oracle's 1e-12
  // would drown in f32 rounding near c).
  let fl = 1e-6 * params.balloonRho;
  let r2 = max(dot(d, d), fl * fl);
  let r = max(length(d), fl);
  return vec4f(
    params.balloonCenter + (params.balloonR * params.balloonR / r2) * d,
    r / params.balloonRho,
  );
}
${balloonDeWrapText}${
        probeWidth === null
          ? ""
          : `

// The probe taps' own balloon union (fr-5wlv.5) — same text, renamed.
${balloonProbeWrapText}`
      }`
    : lensedBodyBlock;

  return /* wgsl */ `${headerText}

${bodyBlock}
${entry}
`;
}
