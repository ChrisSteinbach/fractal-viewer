import {
  BACKGROUND_SHAPE_WGSL,
  backgroundShapeSource,
} from "./background-shape";
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
  SHAPE_TRAP_GEOMETRY_LEVEL_MAX,
  SHAPE_TRAP_NO_CROSSING,
  shapeTrapInvNorm,
  type ResolvedShapeTrap,
} from "./shape-trap";
import { SYM_PLANE_CODE4, type EscapeDE4 } from "./escape-de-4d";
import {
  SHAPE_MARCH_SAFETY,
  shapeMeshIds,
  shapeSdfSource,
  shapeSpecsMeshIds,
  type ShapeSpec,
} from "./shapes";
import {
  activeMeshSdfAtlas,
  meshSdfAtlasShaderIndex,
} from "./mesh-sdf-atlas-cache";
import type { MeshAssetId } from "./mesh-shapes";
import {
  ESCAPE_FACTOR,
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
import {
  SURFACE_FINISH_WGSL,
  surfaceFinishShadeSource,
} from "./surface-finish";
import { surfacePatternShadeSourceWgsl } from "./surface-pattern-shade";
import {
  isResolvedLatticeTiling,
  isCanonicalResolvedLatticeTiling,
  latticeFoldSource,
  LATTICE_TILING_CODE,
  TILING_GROUP_INFO,
  tilingFoldSource,
  tilingGroupCode,
  type ResolvedFiniteTiling,
  type ResolvedLatticeTiling,
  type ResolvedTiling,
} from "./tiling";
import {
  LATTICE_PRESENTATION_RADIUS_MULT,
  latticePresentationCarrierSource,
} from "./lattice-march";
import {
  surfaceMaterialLanes,
  type ResolvedSurfaceMaterial,
} from "./surface-material-wire";
import type { Vec3 } from "./types";

/**
 * WebGPU (WGSL) fold-DE kernel — the wavefront spike for brief §3.7
 * (`docs/fold-de-performance-brief.md`), gated in by the fold-DE cost
 * instrumentation's measured verdict: the WebGL fold tracer is
 * OCCUPANCY-bound (superlinear settle time in frontier width: w4 400s →
 * w6 1059s, w8+ unbounded on Iris Xe), not ALU-bound (the full
 * branch-and-bound cut bought ~14% at equal width). The suspected
 * mechanism is the `FOLD_W = 12` dynamically indexed per-thread frontier
 * (~672 bytes) spilling to scratch memory.
 *
 * This module carries the WGSL source generator and the buffer-packing
 * layer, following the `flame.ts` ↔ `flame-gpu.ts` oracle discipline one
 * render mode over: the kernel mirrors `surface-de.ts`'s
 * {@link estimateDistance} — the `descendFold` refine=FALSE path, exactly
 * the estimator the fold GLSL marches (surface-de.ts MIRROR NOTE) — term
 * for term, and `src/app/gpu-bench/` pins it against that CPU oracle on
 * real query points before any timing is trusted.
 *
 * SEVEN KERNEL CORES (`core`; the fold-lens compute port added the
 * second, the escape port the third and — its 4D cut — the fourth, the
 * 4D fold-branch sweep the fifth, the bulb kernel the sixth, the 4D
 * escape lift the seventh).
 * Which estimator a system is entitled to is decided exactly as on the
 * CPU — its BASE maps for the two 3D descents AND for the two 4D ones
 * (`deHasFolds` / `deHasFolds4`), the escape gate for the forward fold
 * loop and the bulb gate for the forward triplex-power one,
 * with the 4D gate (`analyzeSurfaceSystem4`) admitting the pair:
 *
 * - `core: "fold"` (the default, and every config that predates the
 *   fold-lens port) emits the width-`width` fold frontier above —
 *   `descendFold` refine=false, the estimator the fold GLSL marches.
 * - `core: "affine"` emits the width-4 REFINED ladder instead: A/B beam
 *   chains plus the rank-3/4 V1/V2 validity slots, with the refined sibling
 *   certificate `refinedCert` on every escaped sibling — `surface-de.ts`'s
 *   `descend` refine=TRUE, i.e. {@link estimateDistanceRefined}, which is
 *   what `surface-material.ts`'s affine arm (its `#else` body, the f32
 *   formulation this port follows line for line) marches. Reusing the fold
 *   frontier for affine maps would NOT be the same estimator (width 12 vs
 *   the ladder's 4, no refinement), so a second body is the only shape that
 *   keeps the term-for-term discipline.
 * - `core: "escape"` is not a descent at all: it emits
 *   `escape-de.ts`'s {@link estimateEscapeDistance} — the FORWARD fold
 *   orbit with the Buddhi/Rrrola scalar derivative, `DE = |v| / dr` —
 *   in the `SURFACE_ESCAPE` GLSL arm's f32 formulation, for exactly the
 *   systems `analyzeEscapeSystem` admits (one or more non-contracting
 *   pure folds; the IFS gate's complement). The orbit CYCLES through
 *   the document's whole formula chain — link `i mod n`,
 *   `+ p` and the bailout test after EACH link, one `GpuMap` per link on
 *   the maps storage binding ({@link packEscapeGpuMaps}), `mapCount` the
 *   link count and `maxDepth` still PASSES (`maxDepth * n` single-link
 *   steps) — with the kaleidoscope a query-space wedge fold off
 *   `symOrder`/`symPlane`. A link may also be a POWER map:
 *   `EscapeLinkKind` 4 is the triplex 8th power (this file's own
 *   `bulbPow8`, shared with the bulb core rather than copied) and 5 the
 *   quaternion square, so the fold pair's `kind != 2` / `kind != 1`
 *   dispatch — exhaustive by NEGATION over {1, 2, 3} alone — sits behind a
 *   `kind < 4u` GUARD in both the value and hit-info bodies; a kind that
 *   reached it unguarded would silently run both folds, which is the same
 *   hazard the bulb core's own bullet cites. The head link still rides the
 *   208..271 VARIANT block of the params uniform ({@link
 *   packEscapeGpuParams}) as frozen layout ballast the bodies no longer
 *   read — with ONE live word in it: `escParams.w` carries
 *   `EscapeDE.logEstimate`, the chain-level choice between `r / dr` and
 *   the Böttcher `0.5·r·ln r / dr` a power link's super-exponential
 *   escape needs. Its hit-info trap gained the matching second
 *   interpolant, picked by the DEGREE of the link that produced the
 *   terminal radius.
 *   `width`/`sharedFrontier`/
 *   `bnbStage2`/`shadeDeWidth` are all inert (no frontier, no branch
 *   fan, no probe — the GLSL arm's shape), and a
 *   fold-final `lens` THROWS (the escape gate refuses final
 *   transforms; nothing pins that shape).
 * - `core: "bulb"` is the escape core's SIBLING, one
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
 * - `core: "affine4"` (that 4D cut) is the affine ladder ONE
 *   DIMENSION UP: `surface-de-4d.ts`'s `estimateDistance4Refined` — the
 *   width-4 refined beam with the rank-3/4 validity slots over 4×4+t
 *   inverse maps — for the systems `analyzeSurfaceSystem4` admits, i.e.
 *   the estimator `surface-material-4d.ts` marches. The public
 *   signature stays `surfaceDE(pIn: vec3f, …)`: the VIEW LIFT lives in
 *   the body's own prologue (`q = rotorInv · vec4f(pIn, w0)`, the GLSL
 *   tracer's uInvRotor line), the slice-thickness slab rides a per-chain
 *   half-extent vec4f seeded from rotorInv's w column × sliceHalfW, and
 *   the kaleidoscope sweeps ONE backward-step 4×4 instead of
 *   the 3D (cos, sin) pair. Pack with {@link packSurface4GpuParams}
 *   (the 208.. tail IS this core's variant block — rotor, sector step,
 *   4D final lens, w0/sliceHalfW — and `visibleRadius` packs the
 *   SLICE-ADJUSTED sliceVisR so the shared march entry's sphere gate is
 *   the 4D GLSL's, textually unchanged) and {@link packSurfaceGpuMaps4}
 *   (binding 1 is `array<GpuMap4>` here). Same inert options as
 *   "affine" (the ladder is fixed at the oracle's `beamWidth` 4; no
 *   frontier, no probe), `footprint` THROWS at pack (the 4D oracle has
 *   no cone-footprint cap; hosts pass 0), and a fold-final `lens`
 *   wraps it in `descendLens4`'s branch sweep at refine=TRUE (the 4D
 *   lens arm: this core IS the refined estimator, so its root descents
 *   take the inner cutoff — THE FOLD-LENS WRAPPER below).
 * - `core: "fold4"` (the 4D fold-branch sweep) is the FOLD frontier one
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
 *   every radius is `segmentRadius4` (the slice-thickness slab, per-axis
 *   region-distance relaxation included); the kaleidoscope sweeps ONE
 *   backward-step 4x4; and there is NO bound centre and NO cone-
 *   footprint depth cap (the loop runs plain `params.maxDepth`). Pack
 *   exactly like "affine4". `width` and `shadeDeWidth` are LIVE (the
 *   frontier and its width-1 shading probe); `sharedFrontier` and
 *   `bnbStage2` are inert by 3D's measured verdicts — shared frontier
 *   2-3.3x slower, stage-2 skips 1.4-1.6x slower — so this core emits the
 *   private frontier and the stage-1 floor prune ALONE. The skips are value
 *   no-ops, so agreement against the oracle is untouched by their
 *   absence. `lens` wraps it in the SAME `descendLens4` sweep at
 *   refine=FALSE: the wrapper hands this core cutoff
 *   0, exactly the CPU's `refine ? innerCutoff : 0`.
 * - `core: "escape4"` is the FORWARD escape-time orbit one
 *   dimension up — `escape-de-4d.ts`'s `estimateEscapeDistance4`, for
 *   exactly the systems `analyzeEscapeSystem4` admits (a non-flat chain
 *   of folds and quaternion squares that does not all contract; the 4D
 *   IFS gate's complement). It is BOTH a 4D core and a FORWARD one, and
 *   that combination is the whole of its novelty: it takes the 4D tail's
 *   rotor prologue (`rotorInv · vec4f(p, w0)`) and the `GpuMap4` maps
 *   layout from the descent cores, and its orbit, its params-block
 *   scalars and its colors-only hit-info from the 3D escape core. Three
 *   things fall away with the dimension: no `bulbPow8` (a triplex power
 *   has no fourth component, so `analyzeEscapeSystem4` refuses a `bulb`
 *   link and the `kind` dispatch is folds + the FULL quaternion square),
 *   no slab (a forward orbit cannot thread a segment — `sliceHalfW`
 *   packs 0), and no lens (an escape chain has no final transform, which
 *   is what lets its params block reuse lens4's region). The
 *   kaleidoscope is the query-space wedge fold, generalised to all six
 *   planes — the one place this core reads a `symPlane` the 3D one
 *   cannot. `width`/`sharedFrontier`/`bnbStage2`/`shadeDeWidth` are
 *   inert, `lens` and `balloon` throw, and `groundPlane` composes.
 *
 * All seven bodies share the public signature — `surfaceDE(pIn, cutoff,
 * li)` — so the mode entry points below are textually identical
 * whichever core is picked. The two 3D DESCENT cores additionally share the
 * descent PROLOGUE text (lens, sphere bound, bail threshold, the
 * cone-footprint depth cap) for the same reason `renameToProbe` exists: one
 * text cannot drift from itself; the two 4D cores share the same prologue
 * SHAPE (view lift, slab seed, 4D lens, sphere bound, bail threshold)
 * written per body, since only one of them carries a frontier to seed.
 * (The two FORWARD cores deliberately have NO prologue — those are
 * inverse-descent concepts, and their GLSL arms
 * replace the descent bodies wholesale.) `core: "affine"` IGNORES `width` (the
 * ladder is fixed at the oracle's production `beamWidth` 4),
 * `sharedFrontier` and `bnbStage2` (the unrolled ladder has no frontier
 * arrays and no fold branches to bound), and it declares no workgroup
 * storage ({@link surfaceGpuWorkgroupBytes} returns 0). The fold-lens
 * port's stage A shipped it eval/march-only with a shade throw; its stage C
 * replaced the throw with the affine hit-info descent below, so every mode
 * serves every core today.
 *
 * THE FOLD-LENS WRAPPER (`lens`, that port's stage B) lifts `descendLens` —
 * the CPU route for `foldFinal` systems — over EITHER core. The chosen
 * descent body is emitted with its declaration token-renamed `fn
 * surfaceDE(` → `fn surfaceDECore(` — {@link renameToProbe}'s
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
 * THE 4D ARM lifts the same wrapper to `core:
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
 *   march-epsilon inner cutoff `min(best, cutoff) / factor`; "fold4" is the
 *   PLAIN frontier, so it takes 0. Swapping them would silently mirror an
 *   estimator no oracle pins.
 * - THE 4D QUANTITIES. 81/3/243 branch fans with the four-digit box code
 *   (mandelbox sphere branch every 81st index, shell guard skipping
 *   `b += 80u`), `segmentRadius4` in place of every `length` so a
 *   slice-thickness slab rides through the lens (boxfold lenses only —
 *   `slabExact4`, which the packer now enforces), and an ORIGIN-anchored
 *   visible ball at the FULL 4D radius `params.visRadius4`, NOT the
 *   frozen `visibleRadius` slot this core fills with the slice-adjusted
 *   march gate. The lens itself rides the params block APPENDED past the
 *   4D tail ({@link SURFACE_GPU_PARAMS4_LENS_BYTES}), declared in the
 *   `Params` struct only under the lens, so every no-lens 4D kernel's
 *   text stays byte-identical.
 *
 * THE BALLOON WRAPPER (`balloon`) composes `balloon-de.ts`'s
 * `estimateBalloonDistance` — the inverted-union scene
 * `min(DE(p), (|p−c|/rho)·DE(I(p)))`, the SURFACE_BALLOON GLSL arm's
 * WGSL twin — over the compiled variant's PUBLIC names: the lens
 * mechanism one level further out. After the (optional) lens composition
 * produces the block owning `surfaceDE`/`surfaceDEProbe`/
 * `surfaceDEHitInfo`, those publics rename `…Fractal` and an appended
 * wrapper owns the public names, so the mode entries' call sites stay
 * textually untouched and ANY 3D descent variant (fold/affine, lens or not)
 * composes. The shell term's inner cutoff scales by the inverse of its
 * value factor (`cutoff / scale`), preserving the march-epsilon cutoff
 * contract verbatim (the oracle's module doc carries the argument). Tap
 * routing is the GLSL arm's: march/normal/AO ride the union, the SHADOW tap
 * calls `…Fractal` directly (the balloon receives shadows, never casts
 * them), and the hit-info wrapper argmin-routes to the winning term's
 * own query point (ties → fractal), reporting it as `colorPos` for the
 * height/radius color sources. Balloon mode also swaps the march
 * entry's visible-sphere gate for the oracle's far cap and the shade
 * entry's defensive no-intersection miss for a clamped fog origin
 * (march-entry semantics decided on the oracle). Balloon
 * params ride the appended {@link SURFACE_GPU_PARAMS_BALLOON_BYTES}
 * block — {@link packSurfaceGpuParams}'s third argument. The two FORWARD
 * cores THROW (a forward-orbit solid's interior reaches the ball center,
 * so its echo swallows the camera — the measured verdict for the escape
 * folds, re-measured on the Mandelbulb rather than inherited; those
 * sessions render plain, `core: "escape4"` included), and balloon +
 * nonzero footprint throws at pack. Absent or false generates
 * byte-identical source to the pre-balloon generator for every config.
 *
 * THE 4D DESCENT CORES COMPOSE WITH IT, and the wrapper
 * text is unchanged to do so — which is the semantic decision, not an
 * implementation convenience. Every core shares the public
 * `surfaceDE(pIn, cutoff, li)` signature over a MARCHED 3D point, and a
 * 4D core's body lifts that point to `(p, w0)` and applies the rotor in
 * its own prologue. So wrapping it inverts in the sliced 3D space and the
 * echo is the inversion of exactly what is drawn — SLICE-THEN-INVERT,
 * following the explorer echo's precedent, rather than the slice of a 4D
 * inversion (the two agree wherever the ball's centre lies on the slice,
 * which for this origin-anchored ball is `w0 = 0`). Its params ride the
 * appended {@link SURFACE_GPU_PARAMS4_BALLOON_BYTES} block.
 *
 * TWO FRONTIER VARIANTS, selected at source-generation time so the bench
 * can A/B them with everything else held equal:
 *
 * - `sharedFrontier: false` — the frontier lives in function-scope
 *   (private) arrays, the direct WGSL analog of the GLSL variant whose
 *   occupancy collapse the fold-DE cost instrumentation measured. This
 *   is the CONTROL.
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
 * STAGE-2 BRANCH-AND-BOUND (`bnbStage2`): the fold descent's stage-2
 * skips are deliberately CPU-only in the GLSL (every encoding tried
 * pushed the Mesa/Iris link over the watchdog cliff). WGSL has no such
 * link cliff, so here they are a generation flag: `false` reproduces the
 * shipped GLSL body exactly; `true` adds the skips, which are VALUE
 * no-ops (bit-identical on the CPU gauntlet), so both variants pin
 * against the same oracle. The A/B answers the GLSL attempt's open
 * question on a compiler stack that can actually run it.
 *
 * MARCH MODE mirrors `scripts/erosion-repro.harness.ts`'s `march()` (the
 * canonical GLSL-march emulator), gridless: sphere gate at
 * `1.02 × visibleBoundingRadius` (origin-centered, like the GLSL), cone
 * eps `max(pixelEps·t, boundingRadius·SURFACE_GPU_HIT_FLOOR)`, hit on
 * `d < eps`, `t += d·stepScale`, full-tier budget. Ray state persists in
 * a storage buffer across bounded dispatches (`stepsThisPass` per pass),
 * and the host compacts the active list between passes — brief §3.7's
 * "compaction every N steps", which is also what keeps every submission
 * bounded (the kernel-confirmed i915 preemption-timeout lesson).
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
 * MARCH STATUS SIDE-CHANNEL (`statusOut`): the host compacts the
 * active list from ONE field of the ray state — the status — so reading
 * the whole `states` buffer back to get it costs 16 B per FRAME ray a
 * sweep where 4 B per ACTIVE ray would do. With the flag set the march
 * additionally writes each dispatched ray's post-pass status as a `u32`
 * at its own SLOT in the active list (binding 5) — the array the host is
 * rebuilding — from every exit, the two sphere-gate early-outs and the
 * defensive non-ACTIVE guard included. A pure side channel: nothing
 * reads it back on the device, so the ray states, the pixels and every
 * measured quantity are what they were, which is what lets the bench
 * baselines stay byte-identical with the flag off.
 *
 * SHADE MODE (`shadeRays`) is the split's other half: one
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
 * (the i915 ~7.5 s watchdog, the preemption hang's failure class).
 * Separate entry points let the HOST size shade batches, so every
 * shading submission is bounded — that lesson applied to shading, not
 * just marching.
 *
 * SHADE PROBE WIDTH (`shadeDeWidth`): those on-surface probe evals
 * dominate END-TO-END fold frame cost (the compute path's landing
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
 * `width`, the generated source is byte-identical to the pre-probe-split
 * generator. Quality/timing A/B lives in `src/app/gpu-bench/`'s shade
 * A/B leg, images + march/shade split, since no CPU shading oracle
 * exists to pin against.
 *
 * Scope: BASE fold/affine maps + kaleidoscope sector sweep + affine
 * final lens; and the FOLD final lens — `lens: true` wraps any DESCENT core
 * in `descendLens`'s branch sweep (both 3D cores; both 4D cores as
 * `descendLens4` — THE FOLD-LENS WRAPPER above), with the lens fields
 * appended to the params uniform. Footprint under a lens stays out ({@link
 * packSurfaceGpuParams} throws for 3D; the 4D packer refuses ANY
 * footprint already — the app path always passes 0). Stage C
 * finished the shade half: a per-core hit-info descent (the affine one
 * ports its GLSL twin's TRAJECTORY, colors only — the value side never
 * steers the ladder), and under the lens the hit-info renames to
 * `surfaceDEHitInfoCore` behind an argmin-sweep wrapper while the probe
 * (fold core only — the affine core ignores `shadeDeWidth`, like its
 * GLSL arm) gets the same sweep text renamed onto `surfaceDEProbeCore`.
 * Modes "eval" and "march" (rays "pose") are the original spike's
 * bench baselines (`src/app/gpu-bench/` pins them) and their generated
 * source is unchanged by the shade split; march rays "unproject" plus
 * mode "shade" are the GLSL tracer's mirror halves for the app
 * integration program.
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
 *          88  u32  rasterHeight          92  f32 focusDepth
 *          96  vec3f finalM row0         108  f32 finalT.x
 *         112  vec3f finalM row1         124  f32 finalT.y
 *         128  vec3f finalM row2         140  f32 finalT.z
 *         144  vec3f ro                  156  f32 finalSigmaMin
 *         160  vec3f right               172  f32 tanHalf
 *         176  vec3f up                  188  f32 aspect
 *         192  vec3f fwd                 204  f32 fogDensity (former
 *              pad1 — the depth-fog density multiplier every core's
 *              shade entry reads, {@link SurfaceGpuRunParams.fogDensity}
 *              defaulting to 1 when the caller omits it)
 *         208..287 — the VARIANT block, keyed on the kernel config
 *              (mutually exclusive by construction; zeros when neither
 *              variant is active, and the plain kernels' Params struct
 *              still ends at 208 — binding the larger buffer is valid,
 *              a struct never reads past its own size):
 *          · `lens: true`:
 *              208 vec3f lensM row0   220 f32 lensT.x
 *              224 vec3f lensM row1   236 f32 lensT.y
 *              240 vec3f lensM row2   252 f32 lensT.z
 *              256 vec4f lensParams — (foldKind as f32, invW, absW,
 *                  sigmaMin), the GLSL `uLensParams` order.
 *              272 vec4f lensFold — the lens fold's three
 *                  AUTHORED lengths (minRadius, fixedRadius, boxLimit)
 *                  plus a packed-zero spare, `resolveFoldRadii`'s own
 *                  output. The wrapper re-derives the branch algebra
 *                  through the generated `foldRadiiOf`, which is
 *                  `surfaceFoldRadii` field for field; zeros when there
 *                  is no lens, which the wrapper never reads.
 *          · `core: "escape"` — the HEAD LINK's forward map in
 *              the same interleave:
 *              208 vec3f escM row0    220 f32 escT.x
 *              224 vec3f escM row1    236 f32 escT.y
 *              240 vec3f escM row2    252 f32 escT.z
 *              256 vec4f escParams — (kind as f32, w, derivGrowth,
 *                  logEstimate as f32), the GLSL `uEscParams` order plus
 *                  the slot that spare word was reserved for. `escT` is
 *                  the map's PRE-fold offset; the per-iteration offset is
 *                  the query point itself (the Mandelbrot form),
 *                  so no wire field carries it. The `.w` lane is the ONE
 *                  live word of this block — 0 reads the
 *                  terminal radius as `r / dr`, 1 as the Böttcher
 *                  `0.5·r·ln r / dr` (`EscapeDE.logEstimate`, true
 *                  exactly when some link is a POWER map). It belongs
 *                  HERE and not on the maps binding because it is one
 *                  number per CHAIN, read once after the orbit: making it
 *                  depend on which link happened to terminate would put a
 *                  step across every boundary between the two forms.
 *              272 vec4f padF — the lens block's fold-lengths slot, PAD
 *                  here: this core's links carry their own lengths on the
 *                  maps binding, and the slot exists so the shared
 *                  plane/balloon block below lands at ONE offset across
 *                  every 3D core.
 *              The KERNEL reads every link — the head
 *              included — from the maps storage binding below, and this
 *              block is layout ballast: its offsets are frozen (the
 *              ground-plane block lands at 288 behind it) and it cannot
 *              drift from the list, `EscapeDE`'s flat fields being
 *              `links[0]`'s by construction. `symOrder`/`symPlane` in the
 *              frozen block carry the query-space wedge fold (not a
 *              sector sweep — the `stepCos`/`stepSin` pair stays inert),
 *              and `mapCount` the LINK COUNT the orbit cycles through.
 *          · `core: "bulb"` — the escape block's interleave
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
 *          · `balloon: true` — the 3D block GROWS: {@link
 *              SURFACE_GPU_PARAMS_BALLOON_BYTES} = 320 bytes total. The
 *              struct declares the lens variant block UNCONDITIONALLY
 *              (zero-filled by the packer when no lens — the buffer was
 *              always the full base size; only the struct declaration
 *              ended early), so these land at the FROZEN offset 288
 *              (the lensFold quartet moved it up from 272):
 *              288 vec3f balloonCenter
 *              300 f32  balloonRho — MARGINED (`buildBalloon`'s divisor)
 *              304 f32  balloonR — world units
 *              308 f32  balloonFar — BALLOON_FAR_CAP_RHO · raw ball
 *                  radius (the march far cap past the center)
 *              312 f32  padB0        316 f32 padB1   (packed zero)
 *              Never combined with the escape or 4D variants (codegen
 *              throws).
 *          · `core: "affine4"` (the 4D cut) — the variant block
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
 *              432 vec4f radiusCenter4
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
 *              on the wire (the RADIUS color source normalizes
 *              the hit's center-relative 4D distance over the visible
 *              set's own [minD, maxD] band, `buildColors4`'s radius
 *              convention — still slice/rotor-invariant, the band is an
 *              attractor-frame constant), and `boundCenter` packs
 *              the origin (the 4D oracle is origin-anchored by
 *              construction).
 *          · a 4D core under `lens: true` — the tail
 *              GROWS again, APPENDED past 464: {@link
 *              SURFACE_GPU_PARAMS4_LENS_BYTES} = 576 bytes total, and
 *              {@link packSurface4GpuParams} returns exactly this size
 *              when (and only when) the DE carries a `foldFinal`:
 *              464 vec4f lens4M row0..row3   (..527)
 *              528 vec4f lens4T
 *              544 vec4f lens4Params — (foldKind as f32, invW, absW,
 *                  sigmaMin), the GLSL `uLensParams` order again.
 *              560 vec4f lens4Fold — the 3D `lensFold` quartet
 *                  at the 4D block's own offset.
 *              The cores' own final4M/final4T rows still pack
 *              IDENTITY/0 here (`final` is null whenever `foldFinal` is
 *              set), so the core bodies run their no-lens arithmetic
 *              and the wrapper alone applies the lens.
 *          · `core: "escape4"` — the SAME 464..575 region, the
 *              4D VARIANT block's other occupant, {@link
 *              SURFACE_GPU_PARAMS4_ESCAPE_BYTES} = 576 bytes total:
 *              464 vec4f esc4Params — (logEstimate as f32, 0, 0, 0). One
 *                  number per CHAIN, read once after the orbit, exactly
 *                  as the 3D core's `escParams.w` is; the links
 *                  themselves ride the maps binding
 *                  ({@link packEscape4GpuMaps}) and nothing is packed
 *                  here as head-link ballast, because this block was
 *                  written after the chain reached the shader mirrors
 *                  rather than frozen before it.
 *              480..575 pad (packed zero) — the block's tail, so the
 *                  shared plane block below lands at ONE offset across
 *                  every 4D core, the `padF` argument of the 3D cores
 *                  one dimension up. Mutually exclusive with lens4 by
 *                  construction: an escape chain has no final transform.
 *              In this core the tail's `stepBack4` rows and
 *              `final4M`/`final4T` pack IDENTITY (no sector sweep — the
 *              kaleidoscope is a query-space wedge fold off
 *              `symOrder`/`symPlane` in the frozen block — and no final
 *              lens), and `sliceHalfW` packs 0: a forward orbit cannot
 *              thread a segment, so the app clamps the slice thickness
 *              for these sessions (`escape-de-4d.ts`'s NO SLAB
 *              paragraph). `visibleRadius` and `visRadius4` both carry
 *              the bailout ball, slice-adjusted and full respectively,
 *              exactly as they do for a descent core.
 *          · `balloon: true` on a 4D core — the 3D balloon
 *              block at the 4D block's own offset, {@link
 *              SURFACE_GPU_PARAMS4_BALLOON_BYTES} = 608 bytes total,
 *              with the variant block above declared UNCONDITIONALLY
 *              (zero-filled by the packer when there is no lens) so it
 *              lands at the frozen 576:
 *              576 vec3f balloonCenter   588 f32 balloonRho
 *              592 f32  balloonR         596 f32 balloonFar
 *              600 f32  padB0            604 f32 padB1
 *              The inversion is a 3D operation on the MARCHED point,
 *              before the body's rotor lift — the slice-then-invert
 *              semantics the 4D lift decided on (the explorer echo's),
 *              which is also why the wrapper text is the 3D one
 *              unchanged.
 *          · `groundPlane: true` on a 4D core — the 3D plane
 *              block at that same frozen 576, {@link
 *              SURFACE_GPU_PARAMS4_PLANE_BYTES} = 624 bytes total, and
 *              sharing the offset with the balloon block exactly as in
 *              3D (the pair throws). The floor is a world-space plane in
 *              the SLICED 3D space, so every 3D certificate holds
 *              verbatim once a ball is chosen; the app chooses the
 *              origin and the FULL 4D visible radius, so the floor does
 *              not slide as the slice scrubs.
 *          · `shapeTrap` (the escape family's shape-trap color channel,
 *              FORWARD cores only — descent cores throw) — the trap's
 *              LIVE pose/mode block, appended past the PLANE block at ONE
 *              offset per dimension: 336 for the 3D forward cores
 *              (escape, bulb), 624 for escape4. The plane block region is
 *              declared UNCONDITIONALLY under the trap (zero-filled by
 *              the packer when there is no floor) so the trap keeps that
 *              one offset — the lens4-under-balloon rule again — and the
 *              4D chain additionally forces the whole 464..575 variant
 *              region declared (`tail4Block`) for the same reason.
 *              Layout, both dimensions (offsets 336.. / 624..):
 *              +0  vec4f trapR0 — Rᵀ row0, .w = trap position.x
 *              +16 vec4f trapR1 — Rᵀ row1, .w = trap position.y
 *              +32 vec4f trapR2 — Rᵀ row2, .w = trap position.z
 *              +48 vec4f trapP — (invScale, mode, threshold, fade),
 *                  `resolveShapeTrap`'s own fields. The shape SPEC is
 *                  never on this wire: it is BAKED at codegen
 *                  (`shapeSdfSource`), with the normalizer `invNorm` a
 *                  baked literal beside it (`shapeTrapInvNorm` — the ONE
 *                  definition the resolver shares). Optional trap geometry
 *                  reuses this pose block; its inclusive level band is baked
 *                  by `shapeTrapGeometry`, so the frozen wire does not grow.
 *                  Totals: {@link
 *                  SURFACE_GPU_PARAMS_TRAP_BYTES} = 400, {@link
 *                  SURFACE_GPU_PARAMS4_TRAP_BYTES} = 688. COLOR ONLY: the
 *                  march/eval bodies never read the block when geometry is
 *                  off (their structs
 *                  merely declare it, so one options object builds a
 *                  session's pair); only the shade hit-info orbits do.
 *
 * Maps storage — {@link SURFACE_GPU_MAP_VEC4} vec4f per map ({@link
 * SURFACE_GPU_MAP_STRIDE_BYTES} bytes), matching WGSL `struct GpuMap`:
 *   r0  = invM row0 xyz, invT.x        r1 = invM row1 xyz, invT.y
 *   r2  = invM row2 xyz, invT.z
 *   p0  = sigmaMin, foldInvW, foldSigma, foldKind (0/1/2/3 as f32)
 *   bnb = bnbDir xyz, invTNorm
 *   p1  = invMSigmaMin, 0, 0, 0
 *   fold = minRadius, fixedRadius, boxLimit, 0 — the map's
 *          three AUTHORED fold lengths, `resolveFoldRadii`'s output. The
 *          body re-derives the branch algebra from them through the
 *          generated `foldRadiiOf` (`surfaceFoldRadii` field for field)
 *          rather than reading eight packed combinations; a plain-affine
 *          slot carries the classic (0.5, 1, 1) and never reads them.
 * `core: "escape"` shares that layout for its formula CHAIN
 * ({@link packEscapeGpuMaps}) — one entry per LINK in document order,
 * carrying FORWARD affines in r0/r1/r2 and the GLSL `uEscParams` quartet
 * (kind, w, derivGrowth, 0) in p0 — `kind` being `escape-de.ts`'s
 * `EscapeLinkKind`, the three folds plus the two POWER maps at 4
 * and 5, where a descent core's own `p0.w` carries a `SurfaceFoldKind`
 * that never leaves {0, 1, 2, 3} — with bnb/p1 zero: the same
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
 *            field means
 * ONE layout for all three 4D cores, exactly as the 3D GpuMap carries the
 * fold lanes for a core ("affine") that never reads them: the affine4 body
 * reads `p0.x` alone, the fold4 body reads the whole `p0`, and NEITHER
 * reads `bnb`/`p1` — those are packed for layout parity with 3D and for the
 * stage-2 branch-and-bound work the fold4 kernel deliberately does not emit
 * (the stage-2 skips measured 1.4-1.6x SLOWER GPU-side in 3D). `core:
 * "escape4"` shares it for its formula CHAIN the way `core: "escape"`
 * shares the 3D one ({@link packEscape4GpuMaps}) — one entry per LINK in
 * document order, r0..r3/t carrying the FORWARD 4x4 affine, `p0` the (kind,
 * w, derivGrowth, 0) quartet and `fold` the SQUARED sphere radii (mR², fR²,
 * wall, 0), each divergence being its 3D twin's.
 *
 * March state — one vec4f per ray: (t, status, steps, lastD), host-
 * initialized to `(-1, 0, 0, 0)`; `t < 0` means the sphere gate has not
 * run yet. Status vocabulary: {@link SURFACE_GPU_RAY_ACTIVE} /
 * `_HIT` / `_MISS` / `_EXHAUSTED`, plus `_PLANE` in `groundPlane: true`
 * kernels — a MISS the march classified as crossing the
 * ground plane inside its fade band, shaded by the shade entry's plane
 * arm and priced host-side WITH the hits (it pays a hit's shadow/AO
 * probe evals). Ground-plane params ride the {@link
 * SURFACE_GPU_PARAMS_PLANE_BYTES} block (layout on the constant's doc).
 *
 * Shade uniform (march "unproject" + mode "shade") — {@link
 * SURFACE_GPU_SHADE_BYTES} = 224 bytes, WGSL `struct ShadeParams`:
 *   offset 0..63 mat4x4f invProjView (column-major, the exact
 *                THREE.Matrix4.elements scene.ts uploads as uInvProjView)
 *          64  vec3f lightDir          76  f32 ambient
 *          80  vec3f bgTop             92  f32 colorSpeed
 *          96  vec3f bgBottom         108  f32 tracePixelEps
 *         112  u32  colorSource       116  u32 shadowSteps
 *         120  u32  aoTaps            124  u32 flags (bit0 = dither,
 *                                             bit1 = balloon palette)
 *         128  vec3f fogTint          140  f32 fogTintStrength
 *         144  vec2f pixelJitter      152  f32 envStrength
 *         160  vec2f bgOffset         168  vec2f bgExtent
 *         176  vec2f bgCenter         184  vec2f bgScale
 *         192  u32  bgShape (+ a 196..207 pad no vec3f can use)
 *         208  vec3f balloonTint      220  f32 balloonTintStrength
 * fogTint/fogTintStrength retarget the shade entry's fog blend
 * to mix(bg, fogTint, fogTintStrength) — strength 0 (the default) is the
 * identity (fog blends toward bg alone), and misses never read it.
 * pixelJitter is the sub-pixel position every ray derivation
 * aims at inside its pixel; its default (0.5, 0.5) is the pixel centre
 * those derivations used to spell as a literal, so an unset jitter is the
 * pre-supersampling kernel value for value.
 * envStrength landed in the FORMER alignment pad at 152 — the
 * struct's byte size at the time (160) was unchanged. It is how far the
 * shade entry's AMBIENT term is tinted toward the backdrop sampled along
 * the shading normal (`envTint` at both `lit` sites): default/absent 0 is
 * the bit-exact pre-environment-light identity (mix returns `vec3f(1.0)`
 * at t=0).
 * bgOffset/bgExtent are the shared background shape's pixel
 * offset within, and pixel size of, the FULL image being traced —
 * `background-shape.ts`'s coordinate contract, read by the emitted
 * `backgroundShapeT` — REQUIRED on {@link SurfaceGpuShadeParams} (no safe
 * default exists: an absent extent divides by zero or by one). An
 * ordinary frame packs offset (0, 0) and extent (rasterWidth,
 * rasterHeight); a capture band packs offset (0, bandBottom) and extent
 * (fullWidth, fullHeight) — see `surface-compute.ts`.
 * bgCenter/bgScale/bgShape are the shared background shape's own
 * geometry, appended past bgExtent following the SAME required-no-default
 * precedent: bgShape 0 selects "linear" (bgCenter/bgScale unread), 1
 * selects "radial", whose center/scale the host must have already
 * resolved through `background-shape.ts`'s `backgroundRadialScale` for
 * whatever full image bgExtent names — there is no safe default for a
 * shape-dependent scale either. All three ride the shared emitted
 * `backgroundShapeT` (`BACKGROUND_SHAPE_WGSL`'s `field` accessor reads
 * them as `shade.bgCenter`/`shade.bgScale`/`shade.bgShape`).
 *  balloonTint/balloonTintStrength are the ECHO's own colour: the
 *  shade entry mixes `base = mix(base, balloonTint, strength * hi.shell)`
 *  at the base-albedo site, BEFORE lighting — so the shell still shades as
 *  geometry and the specular stays untinted (the `envTint` note's rule) —
 *  and `hi.shell` restricts it to the rays the union's argmin gave to the
 *  inverted term, leaving a fractal-term hit untouched at any strength.
 *  Strength 0, the default and the absent-field value, is `mix(x, y, 0)` =
 *  x exactly: today's frame byte for byte. The pair rides THIS struct and
 *  NOT the frozen balloon DE params block (288 in 3D, 576 in 4D) because it
 *  LIGHTS a hit rather than moving geometry — the block those offsets
 *  belong to is read by the march, which must stay untouched, and the
 *  struct is declared unconditionally so a `balloon: false` kernel's own
 *  shade text is unchanged.
 *  The pattern calibration quartet (`patternCalibration`, at 224, closing
 *  the struct at 240 — {@link SURFACE_GPU_SHADE_PATTERN_BYTES}) is the
 *  pattern arm's native-carrier clamp `(ringsLow, ringsInvSpan,
 *  sheetsLow, sheetsInvSpan)`, the GLSL `uPatternCalibration` order. It is
 *  declared ONLY under shade mode + the pattern gate: a pattern-enabled
 *  MARCH kernel's text must stay byte-identical (the acceptance sweep),
 *  and the march never reads the member — its struct still ends at 224
 *  while the shade kernel's is 240, which is a legal pair because the host
 *  binds one 240-byte buffer to both pipelines of a patterned session (a
 *  struct never reads past its own size). Absent — every caller predating
 *  the pattern bead — keeps the 224-byte layout byte for byte.
 *
 * A balloon shade kernel also declares binding 10, a second 256x1 RGBA8
 * LUT for the balloon alone. Non-balloon targets do not create, bind, or
 * declare it; explicit inherit clears flags bit1, so even a balloon kernel
 * retains the existing base-colour path without sampling it.
 *
 * Shade maps storage (mode "shade") — one vec4f per map slot:
 * (uMapColor rgb, uFoldParams.w trapIndex); one zero stride when empty,
 * like {@link packSurfaceGpuMaps}. Under `finish: true` OR `pattern: true` the stride is
 * THREE vec4f per slot instead — `[0]` the pair above unchanged, `[1]` =
 * (specular, shininess, metalness, reflect) and `[2]` = (transmit,
 * reflectionTint, patternConfig, scale), `surfaceMaterialLanes`' A/B order
 * — packed by {@link packSurfaceGpuShadeMaps}' `materials` argument, whose
 * presence must match the OR of the two kernel flags (the
 * binding stays a runtime-sized `array<vec4f>`, so the stride is a
 * convention the two sides keep in sync, `slabExt`'s host-contract
 * shape).
 *
 * Bindings per mode — eval and march "pose" bind 0-3 (params, maps, the
 * mode's own pair at 2/3); march "unproject" binds 0-4, the march set
 * plus shade: ShadeParams (rays + dither inputs only — it declares none
 * of shadeMaps/colorOut/lutTex/lutSamp/layerOut); mode "shade" binds 0-9,
 * plus binding 10 only for a balloon target's independent LUT. A kernel
 * whose trap/condensation shape contains a catalog mesh also declares
 * binding 11 in every mode that evaluates that shape: an unfilterable
 * R32F `texture_3d` sampled through eight explicit loads. It appends no
 * params bytes. The
 * BULB core never declares binding 1 (maps) in any mode — its one forward
 * map rides the params variant block — so its hosts skip that buffer;
 * the ESCAPE core DOES declare it (its chain is a list of forward maps,
 * one `GpuMap` per link); the AFFINE4 core declares binding 1 as
 * `array<GpuMap4>` (pack with {@link packSurfaceGpuMaps4}), and under
 * `mapsUniform: true` (the refuted 4D maps-uniform probe, option doc)
 * that binding becomes a fixed-size UNIFORM array — `array<GpuMap4, `{@link
 * SURFACE_GPU_UNIFORM_MAP_SLOTS}`>` — with the matching host-side
 * usage/layout/size obligations; every other binding is identical. Mode
 * "shade" binds:
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
 *   @binding(9) var<storage, read_write> layerOut: array<u32> — the
 *               background-composite sidecar packed as RGBA8: R coverage,
 *               G fog, B beta = 1 - coverage + coverage * fog *
 *               (1 - fogTintStrength), A 1. `colorOut` remains the immutable
 *               legacy reference; the sidecar lets presentation apply a
 *               backdrop delta without changing those bytes.
 *   @binding(10) var balloonLutTex: texture_2d<f32> — BALLOON SHADE ONLY;
 *                the independent 256x1 RGBA8 gradient, sampled at the
 *                pre-inversion source-radius coordinate when flags bit1 is
 *                set. Non-balloon targets neither declare nor bind it.
 *   @binding(11) var shapeMeshSdfTex: texture_3d<f32> — MESH SHAPES ONLY;
 *                the conservative R32F active-scene atlas (shader dispatch
 *                still uses stable catalog ids), manually interpolated so
 *                filtering support cannot change its lower-bound contract.
 */

/** Mirror of `surface-material.ts`'s `SURFACE_FULL_HIT_FLOOR` (1e-5) —
 * duplicated like the harness emulators do, because `src/fractal/` must
 * stay free of `src/app/` imports. */
export const SURFACE_GPU_HIT_FLOOR = 1.0e-5;

export const SURFACE_GPU_PARAMS_BYTES = 288;
/** Params size under `balloon: true`: the 288-byte 3D block
 * — variant members declared unconditionally, zero-filled when no lens —
 * plus the appended balloon block at the frozen offset 288 (layout
 * contract in the module doc). {@link packSurfaceGpuParams} returns THIS
 * size exactly when its `balloon` argument is non-null, and the 288-byte
 * buffer byte for byte when it is null — a no-balloon kernel's struct
 * ends at 208/288 and never reads past it, but a BALLOON kernel's struct
 * is 320 bytes, so its hosts must bind a buffer packed with the balloon
 * argument. */
export const SURFACE_GPU_PARAMS_BALLOON_BYTES = 320;
/** Params size under `groundPlane: true`: the 288-byte 3D
 * block — variant members declared unconditionally, zero-filled when no
 * lens (or carrying the escape core's forward map) — plus the appended
 * plane block at the frozen offset 288, which the plane and balloon
 * blocks SHARE (the escape/lens 208..271 precedent: the two features are
 * mutually exclusive by construction — both the codegen and the packers
 * throw on the pair). Layout: y 288, fadeStart 292, fadeEnd 296,
 * ballRadius 300, ballCenter vec3f 304, albedo vec3f 320.
 * {@link packSurfaceGpuParams}/{@link packEscapeGpuParams} return THIS
 * size exactly when their `groundPlane` argument is non-null, and their
 * usual buffer byte for byte when it is null. */
export const SURFACE_GPU_PARAMS_PLANE_BYTES = 336;
/** Params sizes when condensation appends its four-u32 control block after
 * the last enabled 3D feature block. The pre-existing prefixes and their
 * frozen offsets are unchanged. */
export const SURFACE_GPU_PARAMS_CONDENSATION_BYTES = 304;
export const SURFACE_GPU_PARAMS_BALLOON_CONDENSATION_BYTES = 336;
export const SURFACE_GPU_PARAMS_PLANE_CONDENSATION_BYTES = 352;
/** A hybrid-prefix schedule appends one vec4u control lane and five
 * vec4f inner bounds after every pre-existing feature tail. The root
 * bound remains in the frozen 0..31 prefix. */
export const SURFACE_GPU_SCHEDULE_MAX_DEPTH = 5;
export const SURFACE_GPU_PARAMS_SCHEDULE_BYTES = 384;
export const SURFACE_GPU_PARAMS_BALLOON_SCHEDULE_BYTES = 416;
export const SURFACE_GPU_PARAMS_PLANE_SCHEDULE_BYTES = 432;
export const SURFACE_GPU_PARAMS_SCHEDULE_CONDENSATION_BYTES = 400;
export const SURFACE_GPU_PARAMS_BALLOON_SCHEDULE_CONDENSATION_BYTES = 432;
export const SURFACE_GPU_PARAMS_PLANE_SCHEDULE_CONDENSATION_BYTES = 448;
/** Graph-directed Surface appends 24 predecessor masks as six `vec4u`
 * lanes after every other enabled params tail. Only the first
 * `activeStateCount` words are live; the fixed 24-word footprint keeps one
 * WGSL struct shape for every eligible system while preserving every
 * chaos-absent byte and offset. */
export const SURFACE_GPU_CHAOS_BYTES = 24 * 4;
export const SURFACE_GPU_PARAMS_CHAOS_BYTES =
  SURFACE_GPU_PARAMS_BYTES + SURFACE_GPU_CHAOS_BYTES;
export const SURFACE_GPU_PARAMS_BALLOON_CHAOS_BYTES =
  SURFACE_GPU_PARAMS_BALLOON_BYTES + SURFACE_GPU_CHAOS_BYTES;
export const SURFACE_GPU_PARAMS_PLANE_CHAOS_BYTES =
  SURFACE_GPU_PARAMS_PLANE_BYTES + SURFACE_GPU_CHAOS_BYTES;
export const SURFACE_GPU_PARAMS_CONDENSATION_CHAOS_BYTES =
  SURFACE_GPU_PARAMS_CONDENSATION_BYTES + SURFACE_GPU_CHAOS_BYTES;
export const SURFACE_GPU_PARAMS_BALLOON_CONDENSATION_CHAOS_BYTES =
  SURFACE_GPU_PARAMS_BALLOON_CONDENSATION_BYTES + SURFACE_GPU_CHAOS_BYTES;
export const SURFACE_GPU_PARAMS_PLANE_CONDENSATION_CHAOS_BYTES =
  SURFACE_GPU_PARAMS_PLANE_CONDENSATION_BYTES + SURFACE_GPU_CHAOS_BYTES;
export const SURFACE_GPU_PARAMS_SCHEDULE_CHAOS_BYTES =
  SURFACE_GPU_PARAMS_SCHEDULE_BYTES + SURFACE_GPU_CHAOS_BYTES;
export const SURFACE_GPU_PARAMS_BALLOON_SCHEDULE_CHAOS_BYTES =
  SURFACE_GPU_PARAMS_BALLOON_SCHEDULE_BYTES + SURFACE_GPU_CHAOS_BYTES;
export const SURFACE_GPU_PARAMS_PLANE_SCHEDULE_CHAOS_BYTES =
  SURFACE_GPU_PARAMS_PLANE_SCHEDULE_BYTES + SURFACE_GPU_CHAOS_BYTES;
export const SURFACE_GPU_PARAMS_SCHEDULE_CONDENSATION_CHAOS_BYTES =
  SURFACE_GPU_PARAMS_SCHEDULE_CONDENSATION_BYTES + SURFACE_GPU_CHAOS_BYTES;
export const SURFACE_GPU_PARAMS_BALLOON_SCHEDULE_CONDENSATION_CHAOS_BYTES =
  SURFACE_GPU_PARAMS_BALLOON_SCHEDULE_CONDENSATION_BYTES +
  SURFACE_GPU_CHAOS_BYTES;
export const SURFACE_GPU_PARAMS_PLANE_SCHEDULE_CONDENSATION_CHAOS_BYTES =
  SURFACE_GPU_PARAMS_PLANE_SCHEDULE_CONDENSATION_BYTES +
  SURFACE_GPU_CHAOS_BYTES;
/** Params size for `core: "affine4"` — the frozen 0..207 block plus the
 * 4D variant tail (layout contract in the module doc). The other cores'
 * structs still end at 208/288; binding the larger buffer to them would
 * be valid, but hosts size per core. */
export const SURFACE_GPU_PARAMS4_BYTES = 464;
/** Params size for a 4D core under `lens: true`: the
 * 464-byte tail above plus the appended lens4 block (layout contract in
 * the module doc). {@link packSurface4GpuParams} returns THIS size exactly
 * when the DE carries a `foldFinal`, and the 464-byte buffer byte for byte
 * when it does not — a no-lens kernel's struct ends at 464 and never reads
 * past it. */
export const SURFACE_GPU_PARAMS4_LENS_BYTES = 576;
/** Params size for `core: "escape4"` — the 464-byte 4D tail plus
 * the 4D VARIANT block, which is the lens4 block's own 464..575 region
 * carrying the chain's scalars instead. The two are mutually exclusive by
 * construction (`analyzeEscapeSystem4` refuses a final transform, so an
 * escape chain never has a lens), exactly as the 3D escape core shares the
 * lens's 208..271 block — and sizing it identically is what keeps the
 * shared plane/balloon block at ONE offset (576) across every 4D core. */
export const SURFACE_GPU_PARAMS4_ESCAPE_BYTES = SURFACE_GPU_PARAMS4_LENS_BYTES;
/** Params size for a 4D core under `balloon: true`: the 576-byte
 * 4D block — variant members declared unconditionally, zero-filled by the
 * packer when there is no lens — plus the appended balloon block at the
 * frozen offset 576. The 3D pattern one dimension up, and the same host
 * contract: a balloon kernel's struct is this size, so its hosts must bind
 * a buffer packed with the balloon argument. */
export const SURFACE_GPU_PARAMS4_BALLOON_BYTES =
  SURFACE_GPU_PARAMS4_LENS_BYTES + 32;
/** Params size for a 4D core under `groundPlane: true`: the
 * 576-byte 4D block plus the appended plane block at 576, which the plane
 * and balloon blocks SHARE one dimension up exactly as they do in 3D (the
 * pair throws at codegen and at pack). Layout is the 3D plane block's,
 * offset by 288: y 576, fadeStart 580, fadeEnd 584, ballRadius 588,
 * ballCenter vec3f 592, albedo vec3f 608. */
export const SURFACE_GPU_PARAMS4_PLANE_BYTES =
  SURFACE_GPU_PARAMS4_LENS_BYTES + 48;
/** 4D condensation sizes: its four-u32 control block follows the forced
 * 576-byte variant prefix, or the existing balloon/plane feature tail. */
export const SURFACE_GPU_PARAMS4_CONDENSATION_BYTES = 592;
export const SURFACE_GPU_PARAMS4_BALLOON_CONDENSATION_BYTES = 624;
export const SURFACE_GPU_PARAMS4_PLANE_CONDENSATION_BYTES = 640;
export const SURFACE_GPU_PARAMS4_SCHEDULE_BYTES = 672;
export const SURFACE_GPU_PARAMS4_BALLOON_SCHEDULE_BYTES = 704;
export const SURFACE_GPU_PARAMS4_PLANE_SCHEDULE_BYTES = 720;
export const SURFACE_GPU_PARAMS4_SCHEDULE_CONDENSATION_BYTES = 688;
export const SURFACE_GPU_PARAMS4_BALLOON_SCHEDULE_CONDENSATION_BYTES = 720;
export const SURFACE_GPU_PARAMS4_PLANE_SCHEDULE_CONDENSATION_BYTES = 736;
export const SURFACE_GPU_PARAMS4_CHAOS_BYTES =
  SURFACE_GPU_PARAMS4_LENS_BYTES + SURFACE_GPU_CHAOS_BYTES;
export const SURFACE_GPU_PARAMS4_BALLOON_CHAOS_BYTES =
  SURFACE_GPU_PARAMS4_BALLOON_BYTES + SURFACE_GPU_CHAOS_BYTES;
export const SURFACE_GPU_PARAMS4_PLANE_CHAOS_BYTES =
  SURFACE_GPU_PARAMS4_PLANE_BYTES + SURFACE_GPU_CHAOS_BYTES;
export const SURFACE_GPU_PARAMS4_CONDENSATION_CHAOS_BYTES =
  SURFACE_GPU_PARAMS4_CONDENSATION_BYTES + SURFACE_GPU_CHAOS_BYTES;
export const SURFACE_GPU_PARAMS4_BALLOON_CONDENSATION_CHAOS_BYTES =
  SURFACE_GPU_PARAMS4_BALLOON_CONDENSATION_BYTES + SURFACE_GPU_CHAOS_BYTES;
export const SURFACE_GPU_PARAMS4_PLANE_CONDENSATION_CHAOS_BYTES =
  SURFACE_GPU_PARAMS4_PLANE_CONDENSATION_BYTES + SURFACE_GPU_CHAOS_BYTES;
export const SURFACE_GPU_PARAMS4_SCHEDULE_CHAOS_BYTES =
  SURFACE_GPU_PARAMS4_SCHEDULE_BYTES + SURFACE_GPU_CHAOS_BYTES;
export const SURFACE_GPU_PARAMS4_BALLOON_SCHEDULE_CHAOS_BYTES =
  SURFACE_GPU_PARAMS4_BALLOON_SCHEDULE_BYTES + SURFACE_GPU_CHAOS_BYTES;
export const SURFACE_GPU_PARAMS4_PLANE_SCHEDULE_CHAOS_BYTES =
  SURFACE_GPU_PARAMS4_PLANE_SCHEDULE_BYTES + SURFACE_GPU_CHAOS_BYTES;
export const SURFACE_GPU_PARAMS4_SCHEDULE_CONDENSATION_CHAOS_BYTES =
  SURFACE_GPU_PARAMS4_SCHEDULE_CONDENSATION_BYTES + SURFACE_GPU_CHAOS_BYTES;
export const SURFACE_GPU_PARAMS4_BALLOON_SCHEDULE_CONDENSATION_CHAOS_BYTES =
  SURFACE_GPU_PARAMS4_BALLOON_SCHEDULE_CONDENSATION_BYTES +
  SURFACE_GPU_CHAOS_BYTES;
export const SURFACE_GPU_PARAMS4_PLANE_SCHEDULE_CONDENSATION_CHAOS_BYTES =
  SURFACE_GPU_PARAMS4_PLANE_SCHEDULE_CONDENSATION_BYTES +
  SURFACE_GPU_CHAOS_BYTES;
/** Params size for a 3D FORWARD core (escape, bulb) under `shapeTrap`: the
 * 336-byte plane-bearing block — the plane region declared unconditionally
 * under the trap and zero-filled when there is no floor, which is what
 * keeps the trap block at ONE offset (336) whether or not the session has
 * one — plus the appended 64-byte trap pose/mode block (layout contract in
 * the module doc). {@link packEscapeGpuParams}/{@link packBulbGpuParams}
 * return THIS size exactly when their `shapeTrap` argument is non-null. */
export const SURFACE_GPU_PARAMS_TRAP_BYTES =
  SURFACE_GPU_PARAMS_PLANE_BYTES + 64;
/** Params size for `core: "escape4"` under `shapeTrap`: the 624-byte
 * plane-bearing 4D block — variant region and plane block both declared
 * unconditionally under the trap, zero-filled when absent — plus the same
 * 64-byte trap block at the frozen 624. {@link packEscape4GpuParams}
 * returns THIS size exactly when its `shapeTrap` argument is non-null.
 * (A block appended at 576 would land INSIDE the plane region exactly the
 * way the recorded lens4Fold corruption landed inside that quartet —
 * the offset is 624 and the pads under it are the guarantee.) */
export const SURFACE_GPU_PARAMS4_TRAP_BYTES =
  SURFACE_GPU_PARAMS4_PLANE_BYTES + 64;
/** Finite tiling appends one live group-id `u32` after EVERY existing legal
 * params tail, plus the 12 zero bytes required to round the uniform struct's
 * size back to its 16-byte alignment. Roots and the optional analytic clip
 * are baked into the compiled source; the word is a stale-source/wire guard,
 * with 0 reserved for the absent case. Balloon has deliberately NO tiling
 * twin: the two are refused (an orbit's echo is not the echo's orbit). */
export const SURFACE_GPU_TILING_BYTES = 16;

// 3D legal-combination audit: plane x condensation x schedule x chaos,
// plus the forward trap tail. Lens shares the base 288-byte prefix.
export const SURFACE_GPU_PARAMS_TILING_BYTES =
  SURFACE_GPU_PARAMS_BYTES + SURFACE_GPU_TILING_BYTES;
export const SURFACE_GPU_PARAMS_PLANE_TILING_BYTES =
  SURFACE_GPU_PARAMS_PLANE_BYTES + SURFACE_GPU_TILING_BYTES;
export const SURFACE_GPU_PARAMS_CONDENSATION_TILING_BYTES =
  SURFACE_GPU_PARAMS_CONDENSATION_BYTES + SURFACE_GPU_TILING_BYTES;
export const SURFACE_GPU_PARAMS_PLANE_CONDENSATION_TILING_BYTES =
  SURFACE_GPU_PARAMS_PLANE_CONDENSATION_BYTES + SURFACE_GPU_TILING_BYTES;
export const SURFACE_GPU_PARAMS_SCHEDULE_TILING_BYTES =
  SURFACE_GPU_PARAMS_SCHEDULE_BYTES + SURFACE_GPU_TILING_BYTES;
export const SURFACE_GPU_PARAMS_PLANE_SCHEDULE_TILING_BYTES =
  SURFACE_GPU_PARAMS_PLANE_SCHEDULE_BYTES + SURFACE_GPU_TILING_BYTES;
export const SURFACE_GPU_PARAMS_SCHEDULE_CONDENSATION_TILING_BYTES =
  SURFACE_GPU_PARAMS_SCHEDULE_CONDENSATION_BYTES + SURFACE_GPU_TILING_BYTES;
export const SURFACE_GPU_PARAMS_PLANE_SCHEDULE_CONDENSATION_TILING_BYTES =
  SURFACE_GPU_PARAMS_PLANE_SCHEDULE_CONDENSATION_BYTES +
  SURFACE_GPU_TILING_BYTES;
export const SURFACE_GPU_PARAMS_CHAOS_TILING_BYTES =
  SURFACE_GPU_PARAMS_CHAOS_BYTES + SURFACE_GPU_TILING_BYTES;
export const SURFACE_GPU_PARAMS_PLANE_CHAOS_TILING_BYTES =
  SURFACE_GPU_PARAMS_PLANE_CHAOS_BYTES + SURFACE_GPU_TILING_BYTES;
export const SURFACE_GPU_PARAMS_CONDENSATION_CHAOS_TILING_BYTES =
  SURFACE_GPU_PARAMS_CONDENSATION_CHAOS_BYTES + SURFACE_GPU_TILING_BYTES;
export const SURFACE_GPU_PARAMS_PLANE_CONDENSATION_CHAOS_TILING_BYTES =
  SURFACE_GPU_PARAMS_PLANE_CONDENSATION_CHAOS_BYTES + SURFACE_GPU_TILING_BYTES;
export const SURFACE_GPU_PARAMS_SCHEDULE_CHAOS_TILING_BYTES =
  SURFACE_GPU_PARAMS_SCHEDULE_CHAOS_BYTES + SURFACE_GPU_TILING_BYTES;
export const SURFACE_GPU_PARAMS_PLANE_SCHEDULE_CHAOS_TILING_BYTES =
  SURFACE_GPU_PARAMS_PLANE_SCHEDULE_CHAOS_BYTES + SURFACE_GPU_TILING_BYTES;
export const SURFACE_GPU_PARAMS_SCHEDULE_CONDENSATION_CHAOS_TILING_BYTES =
  SURFACE_GPU_PARAMS_SCHEDULE_CONDENSATION_CHAOS_BYTES +
  SURFACE_GPU_TILING_BYTES;
export const SURFACE_GPU_PARAMS_PLANE_SCHEDULE_CONDENSATION_CHAOS_TILING_BYTES =
  SURFACE_GPU_PARAMS_PLANE_SCHEDULE_CONDENSATION_CHAOS_BYTES +
  SURFACE_GPU_TILING_BYTES;
export const SURFACE_GPU_PARAMS_TRAP_TILING_BYTES =
  SURFACE_GPU_PARAMS_TRAP_BYTES + SURFACE_GPU_TILING_BYTES;

// 4D legal-combination audit. A plain descent appends at 464; a lens and
// escape4 append at their frozen 576-byte variant tail; later blocks keep
// their existing forced-576 layout. The names intentionally mirror 3D.
export const SURFACE_GPU_PARAMS4_TILING_BYTES =
  SURFACE_GPU_PARAMS4_BYTES + SURFACE_GPU_TILING_BYTES;
export const SURFACE_GPU_PARAMS4_LENS_TILING_BYTES =
  SURFACE_GPU_PARAMS4_LENS_BYTES + SURFACE_GPU_TILING_BYTES;
export const SURFACE_GPU_PARAMS4_ESCAPE_TILING_BYTES =
  SURFACE_GPU_PARAMS4_ESCAPE_BYTES + SURFACE_GPU_TILING_BYTES;
export const SURFACE_GPU_PARAMS4_PLANE_TILING_BYTES =
  SURFACE_GPU_PARAMS4_PLANE_BYTES + SURFACE_GPU_TILING_BYTES;
export const SURFACE_GPU_PARAMS4_CONDENSATION_TILING_BYTES =
  SURFACE_GPU_PARAMS4_CONDENSATION_BYTES + SURFACE_GPU_TILING_BYTES;
export const SURFACE_GPU_PARAMS4_PLANE_CONDENSATION_TILING_BYTES =
  SURFACE_GPU_PARAMS4_PLANE_CONDENSATION_BYTES + SURFACE_GPU_TILING_BYTES;
export const SURFACE_GPU_PARAMS4_SCHEDULE_TILING_BYTES =
  SURFACE_GPU_PARAMS4_SCHEDULE_BYTES + SURFACE_GPU_TILING_BYTES;
export const SURFACE_GPU_PARAMS4_PLANE_SCHEDULE_TILING_BYTES =
  SURFACE_GPU_PARAMS4_PLANE_SCHEDULE_BYTES + SURFACE_GPU_TILING_BYTES;
export const SURFACE_GPU_PARAMS4_SCHEDULE_CONDENSATION_TILING_BYTES =
  SURFACE_GPU_PARAMS4_SCHEDULE_CONDENSATION_BYTES + SURFACE_GPU_TILING_BYTES;
export const SURFACE_GPU_PARAMS4_PLANE_SCHEDULE_CONDENSATION_TILING_BYTES =
  SURFACE_GPU_PARAMS4_PLANE_SCHEDULE_CONDENSATION_BYTES +
  SURFACE_GPU_TILING_BYTES;
export const SURFACE_GPU_PARAMS4_CHAOS_TILING_BYTES =
  SURFACE_GPU_PARAMS4_CHAOS_BYTES + SURFACE_GPU_TILING_BYTES;
export const SURFACE_GPU_PARAMS4_PLANE_CHAOS_TILING_BYTES =
  SURFACE_GPU_PARAMS4_PLANE_CHAOS_BYTES + SURFACE_GPU_TILING_BYTES;
export const SURFACE_GPU_PARAMS4_CONDENSATION_CHAOS_TILING_BYTES =
  SURFACE_GPU_PARAMS4_CONDENSATION_CHAOS_BYTES + SURFACE_GPU_TILING_BYTES;
export const SURFACE_GPU_PARAMS4_PLANE_CONDENSATION_CHAOS_TILING_BYTES =
  SURFACE_GPU_PARAMS4_PLANE_CONDENSATION_CHAOS_BYTES + SURFACE_GPU_TILING_BYTES;
export const SURFACE_GPU_PARAMS4_SCHEDULE_CHAOS_TILING_BYTES =
  SURFACE_GPU_PARAMS4_SCHEDULE_CHAOS_BYTES + SURFACE_GPU_TILING_BYTES;
export const SURFACE_GPU_PARAMS4_PLANE_SCHEDULE_CHAOS_TILING_BYTES =
  SURFACE_GPU_PARAMS4_PLANE_SCHEDULE_CHAOS_BYTES + SURFACE_GPU_TILING_BYTES;
export const SURFACE_GPU_PARAMS4_SCHEDULE_CONDENSATION_CHAOS_TILING_BYTES =
  SURFACE_GPU_PARAMS4_SCHEDULE_CONDENSATION_CHAOS_BYTES +
  SURFACE_GPU_TILING_BYTES;
export const SURFACE_GPU_PARAMS4_PLANE_SCHEDULE_CONDENSATION_CHAOS_TILING_BYTES =
  SURFACE_GPU_PARAMS4_PLANE_SCHEDULE_CONDENSATION_CHAOS_BYTES +
  SURFACE_GPU_TILING_BYTES;
export const SURFACE_GPU_PARAMS4_TRAP_TILING_BYTES =
  SURFACE_GPU_PARAMS4_TRAP_BYTES + SURFACE_GPU_TILING_BYTES;
export const SURFACE_GPU_MAP_VEC4 = 7;
export const SURFACE_GPU_MAP_STRIDE_BYTES = SURFACE_GPU_MAP_VEC4 * 16;
/** vec4f slots per 4D map (`struct GpuMap4`): four invM rows, invT, and
 * the three parameter lanes p0/bnb/p1 (the 4D fold-branch sweep grew it
 * from 6 — the fold lanes the fold4 core decodes, plus the stage-2 lanes
 * both 4D cores leave unread). The field layout is its own contract;
 * nothing shares sizing math with the 3D {@link SURFACE_GPU_MAP_VEC4}. */
export const SURFACE_GPU_MAP4_VEC4 = 9;
/** Byte size of the ShadeParams uniform (march "unproject" + mode
 * "shade"; layout contract in the module doc). 144 through the fog tint
 * pair, then 160 with `pixelJitter` at 144 — a WGSL uniform struct rounds
 * to its largest member's 16-byte alignment, so the vec2f costs a full
 * stride, leaving a 152..159 pad `envStrength` filled at 152 — then 176
 * with the `bgOffset`/`bgExtent` vec2f pair appended at 160/168, then 208
 * with the `bgCenter`/`bgScale` vec2f pair at 176/184 plus `bgShape` u32 at
 * 192: 192 + 4 = 196, rounded up to the next 16-byte multiple. And now 224
 * with the `balloonTint`/`balloonTintStrength` pair. That 196 tail is where
 * the growth comes from: the 12 bytes it left are unusable by a `vec3f`
 * (AlignOf 16, and 196 % 16 != 0 — the `envStrength` trick of filling a pad
 * in place does not repeat here), so the tint lands at the next 16-aligned
 * offset, 208, with its f32 strength at 220 closing the struct exactly
 * at 224 with no pad at all. Under shade + the pattern gate a fourth
 * vec4f (`patternCalibration`) appends at 224, closing at 240 — see
 * {@link SURFACE_GPU_SHADE_PATTERN_BYTES}. */
export const SURFACE_GPU_SHADE_BYTES = 224;
/** Map slots a `mapsUniform: true` 4D kernel declares (the refuted
 * maps-uniform probe): uniform-address-space arrays need a
 * creation-fixed footprint, so the binding becomes
 * `array<GpuMap4, 24>` and the HOST must bind a buffer of
 * at least `SURFACE_GPU_UNIFORM_MAP_SLOTS * SURFACE_GPU_MAP4_VEC4 * 16`
 * = 3456 bytes (WebGPU validates the full type size at bind-group
 * creation; slots past `params.mapCount` are never read, and WebGPU
 * zero-fills fresh buffers, so a short `packSurfaceGpuMaps4` write into a
 * full-size buffer is complete). 24 matches the app's 4D eligibility cap
 * (`SURFACE4_MAX_MAPS`, surface-material-4d.ts — enforced for every 4D
 * surface entry in main.ts, compute-only fold shapes included), so no
 * eligible system can overflow the fixed array. */
export const SURFACE_GPU_UNIFORM_MAP_SLOTS = 24;

interface CondensationWireEmitter {
  shadeIndex: number;
}

interface CondensationWireDE {
  maps: readonly unknown[];
  schedule?: SurfaceScheduleWire | null;
  chaos?: SurfaceChaosWire | null;
  condensation?: {
    emitters: readonly CondensationWireEmitter[];
    depthBand: { minDepth: number; maxDepth: number };
  };
}

interface SurfaceChaosWire {
  predecessorMasks: ArrayLike<number>;
  activeStateCount: number;
}

interface SurfaceChaosWireInfo {
  predecessorMasks: Uint32Array;
  activeStateCount: number;
}

function surfaceChaosWireInfo(de: {
  chaos?: SurfaceChaosWire | null;
}): SurfaceChaosWireInfo | null {
  const chaos = de.chaos;
  if (!chaos || chaos.activeStateCount === 0) return null;
  if (
    !Number.isInteger(chaos.activeStateCount) ||
    chaos.activeStateCount < 1 ||
    chaos.activeStateCount > SURFACE_GPU_UNIFORM_MAP_SLOTS
  ) {
    throw new RangeError(
      `surface-de-gpu: chaos activeStateCount ${chaos.activeStateCount} is outside 1..${SURFACE_GPU_UNIFORM_MAP_SLOTS}`,
    );
  }
  if (chaos.predecessorMasks.length !== chaos.activeStateCount) {
    throw new RangeError(
      `surface-de-gpu: chaos needs exactly ${chaos.activeStateCount} predecessor masks; ` +
        `found ${chaos.predecessorMasks.length}`,
    );
  }
  const validBits =
    chaos.activeStateCount === 32
      ? 0xffffffff
      : (2 ** chaos.activeStateCount - 1) >>> 0;
  const predecessorMasks = new Uint32Array(chaos.activeStateCount);
  for (let i = 0; i < chaos.activeStateCount; i++) {
    const mask = chaos.predecessorMasks[i];
    if (!Number.isInteger(mask) || mask < 0 || mask > 0xffffffff) {
      throw new RangeError(
        `surface-de-gpu: chaos predecessor mask ${i} is not a u32 (${mask})`,
      );
    }
    const u32 = mask >>> 0;
    if ((u32 & ~validBits) !== 0) {
      throw new RangeError(
        `surface-de-gpu: chaos predecessor mask ${i} references a state outside 0..${chaos.activeStateCount - 1}`,
      );
    }
    predecessorMasks[i] = u32;
  }
  return { predecessorMasks, activeStateCount: chaos.activeStateCount };
}

interface SurfaceScheduleWireMap3 {
  invM: ArrayLike<number>;
  invT: ArrayLike<number>;
  sigmaMin: number;
  foldRadii?: { minR: number; fixedR: number; wall: number };
}

interface SurfaceScheduleWireBound3 {
  center: Vec3;
  radius: number;
  escapeRadius: number;
}

interface SurfaceScheduleWireBound4 {
  radius: number;
  escapeRadius: number;
}

interface SurfaceScheduleWire {
  maps: readonly SurfaceScheduleWireMap3[];
  depth: number;
  bounds: readonly (SurfaceScheduleWireBound3 | SurfaceScheduleWireBound4)[];
}

interface SurfaceScheduleWireInfo {
  mapCount: number;
  depth: number;
  bounds: SurfaceScheduleWire["bounds"];
}

function surfaceScheduleWireInfo(de: {
  maps: readonly unknown[];
  schedule?: SurfaceScheduleWire | null;
}): SurfaceScheduleWireInfo | null {
  const schedule = de.schedule;
  // Prepared zero-depth/empty schedules are the identity representation.
  // Treating them as absent is what preserves the old buffers byte for byte.
  if (!schedule || schedule.depth === 0 || schedule.maps.length === 0) {
    return null;
  }
  if (de.maps.length < 1) {
    throw new RangeError(
      "surface-de-gpu: a hybrid schedule requires at least one recursive A map",
    );
  }
  if (
    !Number.isInteger(schedule.depth) ||
    schedule.depth < 1 ||
    schedule.depth > SURFACE_GPU_SCHEDULE_MAX_DEPTH
  ) {
    throw new RangeError(
      `surface-de-gpu: schedule depth ${schedule.depth} is outside 1..${SURFACE_GPU_SCHEDULE_MAX_DEPTH}`,
    );
  }
  if (schedule.bounds.length < schedule.depth + 1) {
    throw new RangeError(
      `surface-de-gpu: schedule depth ${schedule.depth} needs bounds[0..${schedule.depth}]; ` +
        `found ${schedule.bounds.length}`,
    );
  }
  return {
    mapCount: schedule.maps.length,
    depth: schedule.depth,
    bounds: schedule.bounds,
  };
}

function validateSurfacePhysicalMapCount(
  de: { maps: readonly unknown[]; schedule?: SurfaceScheduleWire | null },
  emitterCount = 0,
): void {
  const scheduleCount = surfaceScheduleWireInfo(de)?.mapCount ?? 0;
  const recordCount = de.maps.length + scheduleCount + emitterCount;
  if (recordCount > SURFACE_GPU_UNIFORM_MAP_SLOTS) {
    throw new RangeError(
      `surface-de-gpu: surface needs ${recordCount} physical map/emitter records; ` +
        `the low-level cap is ${SURFACE_GPU_UNIFORM_MAP_SLOTS}`,
    );
  }
}

interface CondensationWireInfo {
  emitterCount: number;
  shadeCount: number;
  depthMin: number;
  depthMax: number;
}

/** Validate the compact low-level wire shared by params and map packing.
 * Emitters themselves are symmetry-expanded records, while shade slots are
 * unique by base emitter and must be the contiguous suffix after maps. */
function condensationWireInfo(
  de: CondensationWireDE,
): CondensationWireInfo | null {
  const condensation = de.condensation;
  if (!condensation || condensation.emitters.length === 0) return null;
  validateSurfacePhysicalMapCount(de, condensation.emitters.length);
  const shadeIndices = new Set<number>();
  for (const emitter of condensation.emitters) {
    if (!Number.isInteger(emitter.shadeIndex)) {
      throw new RangeError(
        `surface-de-gpu: condensation shade index ${emitter.shadeIndex} is not an integer`,
      );
    }
    shadeIndices.add(emitter.shadeIndex);
  }
  const sortedShades = [...shadeIndices].sort((a, b) => a - b);
  for (let i = 0; i < sortedShades.length; i++) {
    const expected = de.maps.length + i;
    if (sortedShades[i] !== expected) {
      throw new RangeError(
        `surface-de-gpu: condensation shade slots must be the contiguous ` +
          `suffix [${de.maps.length}, ${de.maps.length + sortedShades.length}); ` +
          `found ${sortedShades.join(", ")}`,
      );
    }
  }
  const shadeCount = de.maps.length + sortedShades.length;
  if (shadeCount > SURFACE_GPU_UNIFORM_MAP_SLOTS) {
    throw new RangeError(
      `surface-de-gpu: condensation needs ${shadeCount} unique shade slots; ` +
        `the low-level cap is ${SURFACE_GPU_UNIFORM_MAP_SLOTS}`,
    );
  }
  return {
    emitterCount: condensation.emitters.length,
    shadeCount,
    depthMin: Math.min(
      0xffffffff,
      Math.max(0, condensation.depthBand.minDepth),
    ),
    depthMax: Math.min(
      0xffffffff,
      Math.max(0, condensation.depthBand.maxDepth),
    ),
  };
}

function writeSurfaceScheduleBlock(
  view: DataView,
  offset: number,
  schedule: SurfaceScheduleWireInfo,
  dimension: 3 | 4,
): void {
  view.setUint32(offset, schedule.mapCount, true);
  view.setUint32(offset + 4, schedule.depth, true);
  for (let level = 1; level <= SURFACE_GPU_SCHEDULE_MAX_DEPTH; level++) {
    const bound = schedule.bounds[Math.min(level, schedule.depth)];
    const at = offset + 16 + (level - 1) * 16;
    if (dimension === 3) {
      const bound3 = bound as SurfaceScheduleWireBound3;
      writeVec3(view, at, bound3.center);
      view.setFloat32(at + 12, bound3.radius, true);
    } else {
      // 4D scheduled bounds remain origin-centred, like the classic 4D
      // certificate. Use the same xyz+radius representation as 3D so the
      // WGSL helper is dimension-agnostic.
      view.setFloat32(at + 12, bound.radius, true);
    }
  }
}

function writeCondensationBlock(
  view: DataView,
  offset: number,
  info: CondensationWireInfo,
): void {
  view.setUint32(offset, info.emitterCount, true);
  view.setUint32(offset + 4, info.depthMin, true);
  view.setUint32(offset + 8, info.depthMax, true);
  view.setUint32(offset + 12, info.shadeCount, true);
}

function writeSurfaceChaosBlock(
  view: DataView,
  offset: number,
  chaos: SurfaceChaosWireInfo,
): void {
  for (let i = 0; i < chaos.predecessorMasks.length; i++) {
    view.setUint32(offset + i * 4, chaos.predecessorMasks[i], true);
  }
}

type SurfaceTilingWireInfo =
  | {
      kind: "finite";
      code: number;
      tiling: ResolvedFiniteTiling;
    }
  | {
      kind: "lattice";
      code: typeof LATTICE_TILING_CODE;
      h: number;
      tiling: ResolvedLatticeTiling;
    };

/** Validate and transfer the resolver's tiling answer. The packer and source
 * generator both call this ONE defensive seam. The finite branch retains its
 * canonical-table and dimension checks; the lattice branch instead pins the
 * resolver-owned `h = cellScale * radius` invariant. Both reject mesh clips
 * because this compile-gated source path has no mesh-atlas binding. Codes come
 * from `tiling.ts`; no GPU mirror re-derives the document mapping. */
function surfaceTilingWireInfo(
  tiling: ResolvedTiling | null | undefined,
  dimension: 3 | 4,
): SurfaceTilingWireInfo | null {
  if (!tiling) return null;
  if (tiling.clip && shapeMeshIds(tiling.clip).length > 0) {
    throw new Error(
      "surface-de-gpu: mesh-bearing tiling clips are unsupported; tiling " +
        "accepts analytic ShapeSpecs only",
    );
  }
  if (isResolvedLatticeTiling(tiling)) {
    if (!isCanonicalResolvedLatticeTiling(tiling)) {
      throw new Error(
        "surface-de-gpu: lattice tiling must be the canonical resolveTiling result",
      );
    }
    return {
      kind: "lattice",
      code: LATTICE_TILING_CODE,
      h: tiling.h,
      tiling,
    };
  }
  if (
    tiling.info !== TILING_GROUP_INFO[tiling.group] ||
    tiling.info.id !== tiling.group
  ) {
    throw new Error(
      "surface-de-gpu: tiling must be the canonical resolveTiling result",
    );
  }
  if (tiling.info.dim !== dimension) {
    throw new Error(
      `surface-de-gpu: tiling group ${tiling.group} is ${tiling.info.dim}D, ` +
        `but this is a ${dimension}D core`,
    );
  }
  return {
    kind: "finite",
    code: tilingGroupCode(tiling.group),
    tiling,
  };
}

/** The lattice resolver's radius must be the exact estimator authority whose
 * corresponding params field the generated wrapper reads. Otherwise `h` and
 * the mandatory ball term would describe different canonical cells. */
function validateSurfaceLatticeRadius(
  info: SurfaceTilingWireInfo | null,
  authorityRadius: number,
): void {
  if (info?.kind === "lattice" && info.tiling.radius !== authorityRadius) {
    throw new Error(
      `surface-de-gpu: lattice radius ${info.tiling.radius} does not match ` +
        `the estimator authority ${authorityRadius}`,
    );
  }
}

function writeSurfaceTilingBlock(
  view: DataView,
  offset: number,
  tiling: SurfaceTilingWireInfo,
): void {
  view.setUint32(offset, tiling.code, true);
  if (tiling.kind === "lattice") {
    view.setFloat32(offset + 4, tiling.h, true);
    // The provisional presentation window radius, in world units: the
    // authority radius times LATTICE_PRESENTATION_RADIUS_MULT — the ONE
    // value both engines and the camera derive from. The tail's third
    // word was zero pad before the lattice arm existed; finite tails
    // still leave it zero.
    view.setFloat32(
      offset + 8,
      tiling.tiling.radius * LATTICE_PRESENTATION_RADIUS_MULT,
      true,
    );
  }
}

/** Shade uniform size under the pattern gate (shade mode): the 224-byte
 * layout plus the calibration quartet at the frozen offset 224 (layout
 * contract in the module doc). Only a shade kernel generated with
 * `pattern: true` declares the member, so a patterned session's host binds
 * THIS size to BOTH pipelines of the pair (a march struct ending at 224
 * reading a 240-byte buffer is valid WebGPU). {@link packSurfaceGpuShade}
 * returns this size exactly when its `patternCalibration` argument is
 * present, and the 224-byte buffer byte for byte when it is absent. */
export const SURFACE_GPU_SHADE_PATTERN_BYTES = 240;

/** Ray-state status codes (the `y` component of a march state vec4).
 * PLANE exists only in `groundPlane: true` kernels: a MISS
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
  /** Which CORE BODY to emit (module doc). "fold" (the default, and
   * every config predating the second core, byte-identical source) is the
   * width-`width` fold frontier mirroring `estimateDistance`; "affine" is
   * the fixed width-4 refined ladder mirroring `estimateDistanceRefined`
   * — the estimator a FOLD-FREE base map set is entitled to. Pick between
   * those two the way the CPU does, off `deHasFolds(de)`. Under "affine"
   * the `width`, `sharedFrontier`, `bnbStage2` and `shadeDeWidth` options
   * are all inert (the ladder has one width and no branch fan to cheapen
   * — the GLSL affine arm carries no probe either). "escape" is the
   * forward escape-time loop mirroring `estimateEscapeDistance` for
   * `analyzeEscapeSystem` systems, CYCLING through its formula chain
   * — pack with {@link packEscapeGpuParams} AND
   * {@link packEscapeGpuMaps} (binding 1 carries one `GpuMap` per link),
   * same inert options as "affine", and `lens` throws.
   * "affine4" is the refined ladder ONE DIMENSION UP
   * — `surface-de-4d.ts`'s `estimateDistance4Refined` behind the view
   * lift (rotor + w0 + slice-thickness slab) — for `analyzeSurfaceSystem4`
   * systems: pack with {@link packSurface4GpuParams} +
   * {@link packSurfaceGpuMaps4} (binding 1 is `array<GpuMap4>`), same
   * inert options as "affine", and a nonzero `footprint` throws at pack.
   * `lens` is LIVE — `descendLens4`'s branch sweep around this REFINED
   * core, i.e. `descendLens4(refine=true)`.
   * "fold4" is the FOLD frontier one dimension up —
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
   * "bulb" is the escape core's SIBLING — `bulb-de.ts`'s
   * `estimateBulbDistance`, the forward triplex-power orbit — for
   * `analyzeBulbSystem` systems: pack with {@link packBulbGpuParams},
   * skip the maps buffer (binding 1 is not declared), same inert
   * options as "escape", and `lens`/`balloon` throw for the same
   * reasons. Deliberately NOT a fourth `foldKind` on the escape core:
   * those bodies dispatch on `kind != 2` / `kind != 1`, so an
   * unrecognized kind would silently run both folds.
   * "escape4" is the escape core ONE DIMENSION UP —
   * `escape-de-4d.ts`'s `estimateEscapeDistance4` behind the 4D cores'
   * view lift — for `analyzeEscapeSystem4` systems: pack with
   * {@link packEscape4GpuParams} AND {@link packEscape4GpuMaps} (binding
   * 1 is `array<GpuMap4>` carrying one FORWARD 4x4 per link), same inert
   * options as "escape", `lens`/`balloon` throw, `groundPlane` composes,
   * and a nonzero `footprint` or `sliceHalfW` throws at pack. */
  core?:
    "fold" | "affine" | "escape" | "affine4" | "fold4" | "bulb" | "escape4";
  /** Emit the FOLD FINAL-transform lens wrapper (`descendLens`, the
   * pure-fold final lens's vocabulary; the 4D arm lifts it to the 4D
   * cores as `descendLens4`): the descent body (any core but
   * "escape") is renamed `surfaceDECore` and a new `surfaceDE` sweeps
   * the lens's inverse fold branches around it, each an affine-lensed
   * core descent — so the mode entries' call sites are untouched text.
   * Absent or false reproduces the no-lens source byte for byte. Branch
   * kind and count are RUNTIME params (one pipeline per session, GLSL
   * parity). In shade mode the hit-info descent gets the same treatment
   * (renamed core + argmin-sweep wrapper) and the probe, when emitted, its
   * own renamed sweep — the fold-lens port's stage C. Under the 4D cores
   * the wrapper additionally OWNS THE VIEW LIFT — a documented deviation
   * from 3D's untouched-core signatures, forced by where the lift lives
   * (THE FOLD-LENS WRAPPER in the module doc) — and the lens rides the
   * appended {@link SURFACE_GPU_PARAMS4_LENS_BYTES} params block. */
  lens?: boolean;
  /** Wrap the compiled variant in the BALLOON inverted-union
   * (`balloon-de.ts`'s `estimateBalloonDistance`, the SURFACE_BALLOON
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
   * no-balloon source byte for byte. Every FORWARD core THROWS — a
   * forward-orbit solid's interior reaches the ball center, so its echo
   * swallows the camera (the measured verdict for the escape folds,
   * re-measured on the Mandelbulb rather than inherited); those sessions
   * render plain. The 4D DESCENT cores compose, on the appended {@link
   * SURFACE_GPU_PARAMS4_BALLOON_BYTES} block ({@link
   * packSurface4GpuParams}'s `balloon` argument) — the wrapper text is
   * unchanged, which is what makes the semantics slice-then-invert (THE
   * BALLOON WRAPPER in the module doc). */
  balloon?: boolean;
  /** Ground plane: an infinite one-sided floor below the
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
   * floor to sit on — the GLSL arm refuses the same pair); EVERY core is
   * supported — both FORWARD cores (the classic Mandelbox/Mandelbulb
   * floor) and the three 4D ones, whose plane block
   * rides the appended {@link SURFACE_GPU_PARAMS4_PLANE_BYTES} instead —
   * and `lens` composes exactly as the GLSL side's stripped lens+plane
   * program does. Inert in eval mode (no rays terminate). */
  groundPlane?: boolean;
  /** Space tiling, resolved by `tiling.ts` before this seam. Finite group
   * roots and either arm's optional analytic clip bake into the source; the
   * exact 16-byte tail carries a construction code plus lattice `h` when
   * live. Both wrappers fold the query FIRST and call the otherwise untouched
   * compiled core/lens once. Finite then maxes with the clip; lattice maxes
   * with its mandatory origin ball and the clip — `tiling-de.ts` exactly.
   * Null/absent emits the pre-tiling source byte for byte, and the finite arm
   * retains its already-shipped source byte for byte. All seven cores compose;
   * `balloon`, kaleidoscope and a real 4D slab remain refused. Mesh-bearing
   * clips are refused until tiling owns a mesh-atlas binding. */
  tiling?: ResolvedTiling | null;
  /** Per-slot surface FINISHES (surface-finish.ts): replace the shade
   * entry's fixed Blinn-Phong lines with the emitted `finishShade`
   * (`surfaceFinishShadeSource(SURFACE_FINISH_WGSL)`) reading each hit
   * slot's authored lanes. Absent or false reproduces today's source
   * BYTE FOR BYTE across every mode/core/variant — and that is the
   * feature's byte-identity MECHANISM, not a convenience: `pow(x, 32.0)`
   * literal -> a per-slot uniform value is NOT an exact identity, so the
   * parametric path is compile-gated and an unauthored document compiles
   * literally today's program text (`foldVariationFn`'s
   * same-function-object philosophy applied to shaders; the classic
   * params reproduce the fixed formula's VALUES, never its bytes).
   * `finish: true` changes SHADE-MODE emission alone: march/eval kernels
   * never read `shadeMaps`, so their source stays byte-identical even
   * with the flag on — one options object can build a session's march
   * and shade kernels. Under shade + finish the `shadeMaps` stride grows
   * 1 -> 3 vec4f per slot: `[0]` (rgb, trapIndex) unchanged, `[1]` =
   * (specular, shininess, metalness, reflect), `[2]` = (transmit,
   * reflectionTint, patternConfig, scale); finish-only materials keep B.zw
   * zero, byte-identical to the pre-pattern stride. The lane order is
   * `surfaceMaterialLanes`' — the ONE definition, shared with the GLSL
   * uniform pair. Pack the buffer with {@link packSurfaceGpuShadeMaps}'
   * material slots, present exactly when finish OR pattern is set.
   * Deliberately NO `ShadeParams` append ({@link SURFACE_GPU_SHADE_BYTES}
   * stays 224) and NO frozen params-block change at any offset in either
   * dimension — the wire is the per-slot shadeMaps lane alone. The
   * FORWARD cores (escape/bulb/escape4) leave `hi.firstChoice` at its
   * constructed 0, so slot 0 IS their wire: the shared host selector's
   * first positive-weight transform, deterministic and disclosed. Under
   * `balloon` a shell
   * hit's `firstChoice` comes from the hit-info descent at the INVERTED
   * point, so the echo inherits its source map's finish for free —
   * `balloonTint`'s albedo-side mix and its ordering are unchanged (the
   * tint applies to `base` BEFORE `finishShade` sees it). The ground
   * plane stays MATTE: `shadeGroundPlane` is untouched by this flag (its
   * own recorded "lighting minus specular" decision). Composes with
   * every core and with lens/balloon/groundPlane — no new throws. */
  finish?: boolean;
  /** Independent per-slot patterned-albedo gate. Under shade mode it makes
   * shadeMaps stride 3, fetches the shared A/B lanes even when `finish` is
   * false (pattern-only keeps the fixed classic lighting lines), carries
   * the hit's raw attractor-frame source point on the hit-info (the
   * `source4` member), and splices the ONE shared pattern body
   * (surface-pattern-shade.ts's WGSL twin) plus the pattern arm's call
   * into the shade entry — the document's order: color source -> balloon
   * palette -> tint -> pattern -> lighting -> fog. The 224-byte ShadeParams layout
   * grows to 240 under shade+pattern with the calibration quartet
   * (`shade.patternCalibration`); march/eval kernels stay byte-identical,
   * and so does every pattern-absent shade kernel. */
  pattern?: boolean;
  /** The escape family's SHAPE-TRAP color channel (`types.ts`'s ShapeTrap;
   * the formula is `escape-de.ts`'s, defined once): bake this spec's SDF
   * into the kernel (`shapeSdfSource`, the create-time-geometry decision —
   * the finish flag's compile-gate precedent), run the trap's two
   * accumulators inside the shade hit-info orbit, carry the value as the
   * hit-info's `shapeTrap` member, and let the shade entry's color-source
   * dispatch read it at source 6. The LIVE pose/mode/threshold/fade
   * quantities ride the appended trap params block (module doc's layout;
   * {@link SURFACE_GPU_PARAMS_TRAP_BYTES} /
   * {@link SURFACE_GPU_PARAMS4_TRAP_BYTES}) — pack with the packers'
   * `shapeTrap` argument. FORWARD cores only (escape, bulb, escape4):
   * every descent core THROWS — the channel is the escape family's, and
   * the descent hit-info is a branch sweep with no forward orbit for the
   * accumulator to ride. Absent or null reproduces the trap-free source
   * BYTE FOR BYTE across every mode/core/variant. COLOR ONLY: march/eval
   * bodies never read the block (their structs declare it so one options
   * object builds a session's kernel pair), and no marching quantity
   * changes at any color setting. Geometry is the independent gate below. */
  shapeTrap?: ShapeSpec | null;
  /** Optional marching use of {@link shapeTrap}. Pass the SAME resolved trap
   * used by the params packer (it is accepted structurally, but only the flag
   * and these two endpoints are read). `geometry: true` compiles the
   * fold-chain term into `core: "escape"` / `"escape4"`; the posed SDF keeps
   * reading the existing live inverse pose/scale block, while the inclusive
   * zero-based band is a create-time constant. Omitted/null/false keeps the
   * color-only source byte-identical. `core: "bulb"` throws when enabled: its
   * power orbit is not eligible geometry and must never change silently. */
  shapeTrapGeometry?: Pick<
    ResolvedShapeTrap,
    "geometry" | "geometryLevelMin" | "geometryLevelMax"
  > | null;
  /** Condensation codegen input. Pass the DE's recursive map count plus its
   * symmetry-expanded emitters directly; codegen validates the same 24-record
   * and unique-shade suffix contract as the packers, then bakes one ShapeSpec
   * per unique base-emitter shade. Absent, null, or an empty emitter list
   * emits the pre-condensation source byte for byte. Descent cores only. */
  condensation?: {
    mapCount: number;
    emitters: readonly { shape: ShapeSpec; shadeIndex: number }[];
  } | null;
  /** Hybrid alphabet codegen gate. `mapCount` is the recursive A count;
   * `scheduleMapCount` is the affine B suffix packed immediately after A.
   * A missing/null/zero-B value emits the legacy source byte for byte. */
  schedule?: {
    mapCount: number;
    scheduleMapCount: number;
  } | null;
  /** Graph-directed inverse-chain gate. `predecessorMasks[current]` has
   * bit `source` set exactly when the forward edge source -> current is
   * effective after weight support and the chaos game's degenerate-row
   * fallback. Recursive A states occupy the first map slots; unique
   * condensation emitters follow them and symmetry copies share a state.
   * Missing/null/zero-state input emits the classic source byte for byte. */
  chaos?: {
    activeStateCount: number;
    predecessorMasks: ArrayLike<number>;
  } | null;
  /** March-mode ray derivation. "pose" (default) keeps the bench baseline:
   * NDC pixel centers against the pose basis — byte-identical output to
   * the pre-shade-split generator. "unproject" derives rays the GLSL
   * tracer's way (near/far clip points through shade.invProjView, with
   * params.ro as uCamPos) and adds the flag-gated march-start hash dither
   * — the app path, where inset/centered-projection parity matters.
   * Ignored outside march mode. */
  rays?: "pose" | "unproject";
  /** March-mode STATUS side-channel (module doc): also write each
   * dispatched ray's post-pass status as a `u32` at its own slot in the
   * active list — `@group(0) @binding(5) statusOut: array<u32>` — so the
   * host can rebuild the active list from 4 B per ACTIVE ray instead of
   * reading the whole 16 B/ray `states` buffer back per sweep. The value
   * is `u32(st.y)`, the {@link SURFACE_GPU_RAY_ACTIVE} vocabulary; every
   * exit of `marchRays` writes it, so a slot's word is always this pass's
   * answer and never a stale one. Absent or false reproduces the
   * pre-side-channel source byte for byte — which is what keeps the bench's
   * march baselines the same kernel they have always been — and THROWS
   * outside march mode (a host that binds a status buffer to an eval or
   * shade pipeline has a contract bug worth hearing about). HOST
   * CONTRACT: bind a `rays`-long `array<u32>` at binding 5 with the
   * pipeline layout declaring it `storage`; the kernel writes only slots
   * `[0, itemCount)`, so a slice's answers land at the slice's own
   * offsets and everything past `itemCount` keeps whatever was there. */
  statusOut?: boolean;
  /** Frontier width — `SURFACE_FOLD_BEAM_WIDTH` for production parity;
   * the bench sweeps 12/8/6/4 to reproduce the measured width curve. LIVE
   * under `core: "fold"` and `core: "fold4"`. IGNORED under the fixed
   * width-4 ladders `core: "affine"`/`"affine4"` (still validated, so a
   * bad value is caught wherever it came from). */
  width: number;
  /** Shade-mode only: frontier width for the shading PROBE evals — the
   * normal/shadow/AO taps in `shadeRays` (module doc). When set
   * and ≠ `width`, a second descent `surfaceDEProbe` is emitted at this
   * width (always private frontier arrays) and the probe taps call it.
   * Absent or equal to `width` reproduces the pre-probe-split source byte
   * for byte. Honored by both FRONTIER cores ("fold" and "fold4" — same
   * one-text-two-names derivation). Ignored outside shade mode. */
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
  /** Include the stage-2 branch-and-bound skips (value no-ops).
   * Inert under `core: "affine"`/`"affine4"` — the skips bound FOLD
   * branch enumeration, and the ladders enumerate none — and under
   * `core: "fold4"`, which does not emit them at all: 3D measured them
   * 1.4-1.6x slower GPU-side at both far-field and near-surface poses,
   * and they are value no-ops, so their absence costs the 4D kernel
   * nothing against its oracle (the 4D oracle additionally bypasses them
   * whole under a slab query — `descendFold4`'s SEGMENT BYPASS note). */
  bnbStage2: boolean;
  /** The slab's register-pressure probe (module doc): the
   * order-6 kaleidoscope-4D sweep runs ~35x slower on compute than the
   * same estimator's fragment GLSL, and the suspected mechanism is the
   * extra live `ext` vec4f registers the slice-thickness slab threads
   * through every beam-ladder tuple. Meaningful ONLY under the 4D cores
   * `"affine4"` and `"fold4"` — inert everywhere
   * else, exactly like `width`/`sharedFrontier`/
   * `bnbStage2` under `core: "affine"`. Absent or `true` reproduces
   * today's slab source byte for byte. `false` emits the
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
   * at 0 — identically no slab influence), so the body would
   * silently render the h=0 slice; the packer cannot see kernel
   * options, so keeping the two in sync is the caller's obligation. */
  slabExt?: boolean;
  /** The 4D maps-load probe: move the per-map data from the
   * runtime-sized STORAGE buffer to a fixed-size UNIFORM array —
   * `var<uniform> maps: array<GpuMap4, `{@link
   * SURFACE_GPU_UNIFORM_MAP_SLOTS}`>` — leaving every body byte-identical
   * (`maps[j]` is address-space-agnostic in WGSL). The fragment-GLSL 4D
   * tracer this kernel lost to at kaleidoscope order 6 reads its maps
   * from a std140 uniform BLOCK, which Mesa serves from the
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
 * ladders declare no frontier arrays at all, the two forward loops have
 * no frontier concept to begin with (escape and bulb), and the fold4
 * frontier is private BY CONSTRUCTION (3D measured shared 2-3.3x slower,
 * so the option is inert there). */
export function surfaceGpuWorkgroupBytes(
  opts: Pick<
    SurfaceGpuKernelOptions,
    "width" | "workgroupSize" | "sharedFrontier" | "core" | "chaos"
  >,
): number {
  if (!opts.sharedFrontier || (opts.core ?? "fold") !== "fold") return 0;
  const arrays =
    SURFACE_GPU_FRONTIER_ARRAYS + (opts.chaos?.activeStateCount ? 2 : 0);
  return arrays * opts.width * opts.workgroupSize * 4;
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
  /** Cone-footprint depth cap; 0 (default) = off, matching the
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
  /** Camera-space depth of the Surface focal plane, packed at the frozen
   * offset 92 formerly reserved as padding. The shade kernel compares each
   * covered hit against it along {@link SurfaceGpuPose.fwd}; default 0 keeps
   * the historical packers' optional-run contract for eval/march callers. */
  focusDepth?: number;
  /** Depth-fog density multiplier, packed at the frozen offset
   * 204 (module doc) by every params packer. Default 1 — the fixed fog
   * that preceded the density control — when omitted, matching the GLSL
   * tracers' own uFogDensity default; 0 disables depth fog in the shade
   * entry's fog term. */
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
 * lens fills the 208..271 block — and the cores' own
 * final slots still pack IDENTITY/1, because `buildSurfaceDE` keeps
 * `final` null whenever `foldFinal` is set: the cores run their no-lens
 * path verbatim and the wrapper alone applies the lens. Throws when a
 * footprint is combined with the lens: `descendLens` scales the
 * footprint per branch (`footprint / factor`), which would need a core
 * signature change — out of the fold-lens cut, and the app path always
 * passes footprint 0 (GLSL parity).
 *
 * `balloon`: null — the default — returns today's 288-byte
 * buffer byte for byte; non-null returns {@link
 * SURFACE_GPU_PARAMS_BALLOON_BYTES} bytes with the balloon block packed
 * at the frozen offset 288 (module-doc contract) — `center`/`rho`/`R`
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
  tiling: ResolvedTiling | null = null,
): ArrayBuffer {
  const schedule = surfaceScheduleWireInfo(de);
  const condensation = condensationWireInfo(de);
  const chaos = surfaceChaosWireInfo(de);
  const tilingInfo = surfaceTilingWireInfo(tiling, 3);
  validateSurfaceLatticeRadius(tilingInfo, de.visibleBoundingRadius);
  validateSurfacePhysicalMapCount(de, condensation?.emitterCount ?? 0);
  if (balloon && groundPlane) {
    throw new Error(
      "surface-de-gpu: groundPlane+balloon: excluded — the two " +
        "blocks share the frozen offset 288 and the kernels refuse the " +
        "pair",
    );
  }
  if (balloon && tilingInfo) {
    throw new Error(
      "surface-de-gpu: tiling+balloon is excluded — an orbit's echo is " +
        "not the echo's orbit, so there is no certified composition",
    );
  }
  if (tilingInfo && de.symmetry.order > 1) {
    throw new Error(
      "surface-de-gpu: tiling+kaleidoscope is excluded — both are " +
        "query-space folds and phase 1 has no certified order",
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
        "fold-lens cut (per-branch innerFootprint needs a core signature " +
        "change; the app path always passes 0)",
    );
  }
  if (balloon && (run.footprint ?? 0) > 0) {
    throw new Error(
      "surface-de-gpu: footprint under the balloon wrapper is out of the " +
        "balloon cut (the wrapper cannot scale the cores' uniform " +
        "footprint read per term; the app path always passes 0)",
    );
  }
  if (schedule && (run.footprint ?? 0) > 0) {
    throw new Error(
      "surface-de-gpu: footprint under a hybrid schedule is excluded " +
        "until the cap accounts for the non-stationary B prefix",
    );
  }
  const baseBytes = schedule
    ? condensation
      ? balloon
        ? SURFACE_GPU_PARAMS_BALLOON_SCHEDULE_CONDENSATION_BYTES
        : groundPlane
          ? SURFACE_GPU_PARAMS_PLANE_SCHEDULE_CONDENSATION_BYTES
          : SURFACE_GPU_PARAMS_SCHEDULE_CONDENSATION_BYTES
      : balloon
        ? SURFACE_GPU_PARAMS_BALLOON_SCHEDULE_BYTES
        : groundPlane
          ? SURFACE_GPU_PARAMS_PLANE_SCHEDULE_BYTES
          : SURFACE_GPU_PARAMS_SCHEDULE_BYTES
    : condensation
      ? balloon
        ? SURFACE_GPU_PARAMS_BALLOON_CONDENSATION_BYTES
        : groundPlane
          ? SURFACE_GPU_PARAMS_PLANE_CONDENSATION_BYTES
          : SURFACE_GPU_PARAMS_CONDENSATION_BYTES
      : balloon
        ? SURFACE_GPU_PARAMS_BALLOON_BYTES
        : groundPlane
          ? SURFACE_GPU_PARAMS_PLANE_BYTES
          : SURFACE_GPU_PARAMS_BYTES;
  const buf = new ArrayBuffer(
    baseBytes +
      (chaos ? SURFACE_GPU_CHAOS_BYTES : 0) +
      (tilingInfo ? SURFACE_GPU_TILING_BYTES : 0),
  );
  const view = new DataView(buf);
  const rootBound = schedule ? de.schedule?.bounds[0] : undefined;
  writeVec3(view, 0, rootBound?.center ?? de.boundCenter);
  view.setFloat32(12, rootBound?.radius ?? de.boundingRadius, true);
  view.setFloat32(16, rootBound?.escapeRadius ?? de.escapeRadius, true);
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
    (rootBound?.radius ?? de.boundingRadius) *
      (run.hitFloor ?? SURFACE_GPU_HIT_FLOOR),
    true,
  );
  view.setUint32(84, pose?.rasterWidth ?? 0, true);
  view.setUint32(88, pose?.rasterHeight ?? 0, true);
  view.setFloat32(92, run.focusDepth ?? 0, true);
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
  // The former pad1 slot, now the fog density multiplier the shared
  // shade entry reads — default 1 (the fixed fog that preceded it).
  view.setFloat32(204, run.fogDensity ?? 1, true);
  // The fold-lens block (zeros when no foldFinal — the
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
    // The lens fold's three AUTHORED lengths at 272, the wire
    // `foldRadiiOf` re-derives the branch algebra from. `SurfaceFoldRadii`
    // keeps `minR` for exactly this — every other field of it is already a
    // combination, and shipping combinations is how a mirror drifts.
    view.setFloat32(272, lens.foldRadii.minR, true);
    view.setFloat32(276, lens.foldRadii.fixedR, true);
    view.setFloat32(280, lens.foldRadii.wall, true);
  }
  // The balloon block at the frozen offset 288 (module-doc
  // contract) — the GLSL uBalloon* quantities in buildBalloon's
  // convention. The variant block above stays zero-filled when no lens,
  // exactly what the balloon kernel's unconditional struct members read.
  if (balloon) {
    writeVec3(view, 288, balloon.center);
    view.setFloat32(300, balloon.rho, true);
    view.setFloat32(304, balloon.R, true);
    view.setFloat32(308, balloon.far, true);
  }
  // The ground-plane block at the frozen offset 288 it SHARES
  // with the balloon block (mutually exclusive — the throw above) — the
  // GLSL uGround* quantities in scene.ts's surfaceGroundPlaneSpec
  // convention.
  if (groundPlane) {
    writeGroundPlane(view, groundPlane);
  }
  if (condensation) {
    writeCondensationBlock(
      view,
      balloon ? 320 : groundPlane ? 336 : 288,
      condensation,
    );
  }
  if (schedule) {
    const scheduleOffset = condensation
      ? balloon
        ? 336
        : groundPlane
          ? 352
          : 304
      : balloon
        ? 320
        : groundPlane
          ? 336
          : 288;
    writeSurfaceScheduleBlock(view, scheduleOffset, schedule, 3);
  }
  if (chaos) {
    writeSurfaceChaosBlock(view, baseBytes, chaos);
  }
  if (tilingInfo) {
    writeSurfaceTilingBlock(
      view,
      baseBytes + (chaos ? SURFACE_GPU_CHAOS_BYTES : 0),
      tilingInfo,
    );
  }
  return buf;
}

/** The ground plane's wire block — scene.ts's
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
  pattern?: 0 | 1;
  tileScale?: number;
  emission?: number;
}

/** Write the plane block at its frozen offset (module-doc layout: y 288,
 * fadeStart 292, fadeEnd 296, ballRadius 300, ballCenter 304, albedo
 * 320) — one definition for both 3D packers, which is what keeps the block
 * at ONE offset across cores whose 208..287 blocks say different things
 * (the lens fold's authored lengths moved it from 272, and
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
 * Pack the params uniform for the ESCAPE core and its formula CHAIN.
 * The frozen offsets carry the escape session's marching
 * quantities — the bailout ball is both bounding and visible sphere,
 * {@link ESCAPE_STEP_SCALE} damps steps (the GLSL variant's
 * `uStepScale`), `maxDepth` is the orbit's iteration budget in PASSES
 * ({@link ESCAPE_TIME_ITERATIONS} full, preview-clamped by
 * `run.maxDepth`), `mapCount` is the LINK COUNT the cycle wraps at, and
 * `symOrder`/`symPlane` are the query-space wedge fold's own order and
 * plane (the `stepCos`/`stepSin` sector-sweep pair stays inert — that is
 * a descent concept) — and the 208..271 VARIANT block carries the HEAD
 * link in the lens rows' interleave, tail vec4f in the GLSL `uEscParams`
 * order (kind, w, derivGrowth, logEstimate).
 *
 * That head-link block is the wire's ONE redundancy, kept
 * deliberately: the bodies read every link — the head included — from the
 * maps storage binding ({@link packEscapeGpuMaps}), but the block's
 * offsets are frozen (the ground-plane block lands at 288 behind it) and
 * a struct member cannot be left undeclared without moving that. It
 * cannot drift, since `EscapeDE`'s flat fields ARE `links[0]`'s.
 *
 * Its LAST word is the exception, and the only thing here the kernel
 * reads: offset 268 carries `EscapeDE.logEstimate` — 0 for the
 * fold family's linear `r / dr`, 1 for the Böttcher `0.5·r·ln r / dr` a
 * chain holding a POWER link needs. One number per chain, so it rides the
 * params block rather than the per-link maps binding.
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
  shapeTrap: ResolvedShapeTrap | null = null,
  tiling: ResolvedTiling | null = null,
): ArrayBuffer {
  const tilingInfo = surfaceTilingWireInfo(tiling, 3);
  validateSurfaceLatticeRadius(tilingInfo, de.boundingRadius);
  if (tilingInfo && de.symmetryOrder > 1) {
    throw new Error(
      "surface-de-gpu: tiling+kaleidoscope is excluded — both are " +
        "query-space folds and phase 1 has no certified order",
    );
  }
  const baseBytes = shapeTrap
    ? SURFACE_GPU_PARAMS_TRAP_BYTES
    : groundPlane
      ? SURFACE_GPU_PARAMS_PLANE_BYTES
      : SURFACE_GPU_PARAMS_BYTES;
  const buf = new ArrayBuffer(
    baseBytes + (tilingInfo ? SURFACE_GPU_TILING_BYTES : 0),
  );
  const view = new DataView(buf);
  view.setFloat32(12, de.boundingRadius, true);
  view.setFloat32(16, de.boundingRadius * 2, true);
  view.setFloat32(20, ESCAPE_STEP_SCALE, true);
  view.setFloat32(24, de.boundingRadius, true);
  view.setFloat32(28, 1, true);
  view.setFloat32(32, 1, true);
  // The kaleidoscope's wedge fold — the same two slots the
  // descent's sector sweep reads, meaning the same thing here.
  view.setUint32(40, de.symmetryOrder, true);
  view.setUint32(44, SYM_PLANE_CODE[de.symmetryPlane], true);
  // The LINK COUNT the orbit's cycle wraps at.
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
  view.setFloat32(92, run.focusDepth ?? 0, true);
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
  // The former pad1 slot — see packSurfaceGpuParams's identical
  // line. The escape shade path reads it through the same shared
  // shadeRays fn as every other core.
  view.setFloat32(204, run.fogDensity ?? 1, true);
  writeVec3(view, 208, [de.m[0], de.m[1], de.m[2]]);
  view.setFloat32(220, de.t[0], true);
  writeVec3(view, 224, [de.m[3], de.m[4], de.m[5]]);
  view.setFloat32(236, de.t[1], true);
  writeVec3(view, 240, [de.m[6], de.m[7], de.m[8]]);
  view.setFloat32(252, de.t[2], true);
  view.setFloat32(256, de.kind, true);
  view.setFloat32(260, de.w, true);
  view.setFloat32(264, de.derivGrowth, true);
  // The CHAIN's estimate form — 0 linear, 1 the Böttcher/
  // Green's form (escape-de.ts's ESTIMATE FORM paragraph). The one
  // live value in the 208..271 variant block, whose other rows stay
  // frozen head-link ballast; this is the slot the
  // layout has reserved since the block was first written.
  view.setFloat32(268, de.logEstimate ? 1 : 0, true);
  // The ground-plane block appends past the escape variant
  // block at the same frozen 288 as the descent cores' — the classic
  // Mandelbox floor is exactly this mode's look.
  if (groundPlane) {
    writeGroundPlane(view, groundPlane);
  }
  // The shape trap's live block past the plane region (zero-filled when no
  // floor — the unconditional-pad contract that keeps ONE offset).
  if (shapeTrap) {
    writeShapeTrap(view, 336, shapeTrap);
  }
  if (tilingInfo) {
    writeSurfaceTilingBlock(view, baseBytes, tilingInfo);
  }
  return buf;
}

/** The trap's live pose/mode block — ONE writer for both dimensions
 * (module doc's layout row): Rᵀ rows with the trap position in the `.w`
 * lanes, then (invScale, mode, threshold, fade) — `resolveShapeTrap`'s own
 * fields, transferred rather than recomputed. */
function writeShapeTrap(
  view: DataView,
  base: number,
  trap: ResolvedShapeTrap,
): void {
  const m = trap.invRot;
  writeVec3(view, base, [m[0], m[1], m[2]]);
  view.setFloat32(base + 12, trap.position[0], true);
  writeVec3(view, base + 16, [m[3], m[4], m[5]]);
  view.setFloat32(base + 28, trap.position[1], true);
  writeVec3(view, base + 32, [m[6], m[7], m[8]]);
  view.setFloat32(base + 44, trap.position[2], true);
  view.setFloat32(base + 48, trap.invScale, true);
  view.setFloat32(base + 52, trap.mode, true);
  view.setFloat32(base + 56, trap.threshold, true);
  view.setFloat32(base + 60, trap.fade, true);
}

/**
 * Pack the ESCAPE core's formula chain into the per-map storage array —
 * {@link packSurfaceGpuMaps}' forward-orbit twin, in the
 * SAME `GpuMap` layout and stride, because a chain of maps is exactly
 * what that binding is for and a second struct would be a second thing
 * to keep in step. Per LINK, in document order (the orbit applies
 * `links[step mod n]`):
 *   r0/r1/r2 = the FORWARD linear part's rows, `t` in the `.w` lanes
 *              (the params variant block's own interleave)
 *   p0       = (kind, w, derivGrowth, 0) — the GLSL `uEscParams`
 *              order, so the WGSL body and the GLSL arm read the same
 *              quartet in the same lanes. `kind` is `EscapeLinkKind`:
 *              the three folds, plus the triplex power (4) and
 *              quaternion square (5), which the bodies dispatch past
 *              their fold pair's `kind < 4u` guard
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
    out[base + 12] = link.kind;
    out[base + 13] = link.w;
    out[base + 14] = link.derivGrowth;
    // fold = this LINK's own AUTHORED fold lengths, SQUARED for the two
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
 * Pack the params uniform for the BULB core —
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
  shapeTrap: ResolvedShapeTrap | null = null,
  tiling: ResolvedTiling | null = null,
): ArrayBuffer {
  if (shapeTrap?.geometry) {
    throw new Error(
      "surface-de-gpu: shape-trap geometry is excluded from the bulb/power core",
    );
  }
  const tilingInfo = surfaceTilingWireInfo(tiling, 3);
  validateSurfaceLatticeRadius(tilingInfo, de.boundingRadius);
  const baseBytes = shapeTrap
    ? SURFACE_GPU_PARAMS_TRAP_BYTES
    : groundPlane
      ? SURFACE_GPU_PARAMS_PLANE_BYTES
      : SURFACE_GPU_PARAMS_BYTES;
  const buf = new ArrayBuffer(
    baseBytes + (tilingInfo ? SURFACE_GPU_TILING_BYTES : 0),
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
  view.setFloat32(92, run.focusDepth ?? 0, true);
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
  // The former pad1 slot — see packSurfaceGpuParams's identical
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
  // The ground-plane block appends past the bulb variant block
  // at the same frozen 288 the descent cores use — the Mandelbulb on a
  // floor is the same classic look the fold arm carries it for.
  if (groundPlane) {
    writeGroundPlane(view, groundPlane);
  }
  // The shape trap's live block at the same frozen 336 as the escape
  // packer's — one offset across the 3D forward cores.
  if (shapeTrap) {
    writeShapeTrap(view, 336, shapeTrap);
  }
  if (tilingInfo) {
    writeSurfaceTilingBlock(view, baseBytes, tilingInfo);
  }
  return buf;
}

/** Per-frame 4D view for `core: "affine4"` — the same (rotor, w0,
 * sliceHalfW) triple `setSurfaceView4` receives: `rotor` is the
 * ROW-MAJOR pose rotor (`fourDView.matrix()`'s output), and the packer
 * stores its TRANSPOSE — the world→attractor rotation the body applies
 * — as the rotorInv rows (the exact `setSurfaceView4` dance); `w0` and
 * `sliceHalfW` are LITERAL world w (scene.ts's `wSupport` conversion
 * happens before this seam). */
export interface SurfaceGpu4View {
  rotor: ArrayLike<number>;
  w0: number;
  sliceHalfW: number;
}

/**
 * Pack the params uniform for the AFFINE4 core. The
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
 * A `foldFinal` DE APPENDS the lens4 block and returns
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
 * `balloon` and `groundPlane` append their blocks at
 * the frozen 576 — the 3D packer's frozen-288 pair one dimension up,
 * mutually exclusive by the same throw — and force the lens4 region to be
 * written (zero-filled when there is no lens) so that offset holds
 * whether or not a lens is present. The balloon's `center`/`rho` are 3D
 * quantities in the MARCHED space: the wrapper inverts before the body's
 * rotor lift, which is the 4D lift's slice-then-invert semantics.
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
  balloon: { center: Vec3; rho: number; R: number; far: number } | null = null,
  groundPlane: SurfaceGpuGroundPlane | null = null,
  tiling: ResolvedTiling | null = null,
): ArrayBuffer {
  const schedule = surfaceScheduleWireInfo(de);
  const condensation = condensationWireInfo(de);
  const chaos = surfaceChaosWireInfo(de);
  const tilingInfo = surfaceTilingWireInfo(tiling, 4);
  validateSurfaceLatticeRadius(tilingInfo, de.visibleBoundingRadius);
  validateSurfacePhysicalMapCount(de, condensation?.emitterCount ?? 0);
  if (balloon && groundPlane) {
    throw new Error(
      "surface-de-gpu: groundPlane+balloon: excluded — the two " +
        "blocks share the frozen offset 576 in 4D exactly as they share " +
        "288 in 3D, and the kernels refuse the pair",
    );
  }
  if (balloon && tilingInfo) {
    throw new Error(
      "surface-de-gpu: tiling+balloon is excluded — an orbit's echo is " +
        "not the echo's orbit, so there is no certified composition",
    );
  }
  if (tilingInfo && de.symmetry.order > 1) {
    throw new Error(
      "surface-de-gpu: tiling+kaleidoscope is excluded — both are " +
        "query-space folds and phase 1 has no certified order",
    );
  }
  if (tilingInfo && view4.sliceHalfW !== 0) {
    throw new Error(
      "surface-de-gpu: tiling+4D slab is excluded — the fold of a " +
        "segment is a bent polyline; tiled 4D sessions run slice 0",
    );
  }
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
  // The appended blocks force the lens4 region to exist (zero-filled
  // without a lens), which is what keeps their own offset at 576 for
  // every 4D core — the 3D packer's frozen-288 rule one dimension up.
  const baseBytes = schedule
    ? condensation
      ? balloon
        ? SURFACE_GPU_PARAMS4_BALLOON_SCHEDULE_CONDENSATION_BYTES
        : groundPlane
          ? SURFACE_GPU_PARAMS4_PLANE_SCHEDULE_CONDENSATION_BYTES
          : SURFACE_GPU_PARAMS4_SCHEDULE_CONDENSATION_BYTES
      : balloon
        ? SURFACE_GPU_PARAMS4_BALLOON_SCHEDULE_BYTES
        : groundPlane
          ? SURFACE_GPU_PARAMS4_PLANE_SCHEDULE_BYTES
          : SURFACE_GPU_PARAMS4_SCHEDULE_BYTES
    : condensation
      ? balloon
        ? SURFACE_GPU_PARAMS4_BALLOON_CONDENSATION_BYTES
        : groundPlane
          ? SURFACE_GPU_PARAMS4_PLANE_CONDENSATION_BYTES
          : SURFACE_GPU_PARAMS4_CONDENSATION_BYTES
      : balloon
        ? SURFACE_GPU_PARAMS4_BALLOON_BYTES
        : groundPlane
          ? SURFACE_GPU_PARAMS4_PLANE_BYTES
          : lens4
            ? SURFACE_GPU_PARAMS4_LENS_BYTES
            : chaos
              ? SURFACE_GPU_PARAMS4_LENS_BYTES
              : SURFACE_GPU_PARAMS4_BYTES;
  const buf = new ArrayBuffer(
    baseBytes +
      (chaos ? SURFACE_GPU_CHAOS_BYTES : 0) +
      (tilingInfo ? SURFACE_GPU_TILING_BYTES : 0),
  );
  const view = new DataView(buf);
  const rootBound = schedule ? de.schedule?.bounds[0] : undefined;
  view.setFloat32(12, rootBound?.radius ?? de.boundingRadius, true);
  view.setFloat32(16, rootBound?.escapeRadius ?? de.escapeRadius, true);
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
    (rootBound?.radius ?? de.boundingRadius) *
      (run.hitFloor ?? SURFACE_GPU_HIT_FLOOR),
    true,
  );
  view.setUint32(84, pose?.rasterWidth ?? 0, true);
  view.setUint32(88, pose?.rasterHeight ?? 0, true);
  view.setFloat32(92, run.focusDepth ?? 0, true);
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
  // The former pad1 slot — see packSurfaceGpuParams's identical
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
  // Radius-ramp band: center + minD + the core's ONE
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
  // The appended lens4 block, present exactly when the
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
    // The 4D lens fold's authored lengths, the 3D `lensFold`
    // quartet at this block's own offset.
    view.setFloat32(560, lens4.foldRadii.minR, true);
    view.setFloat32(564, lens4.foldRadii.fixedR, true);
    view.setFloat32(568, lens4.foldRadii.wall, true);
  }
  // The balloon/plane shared block at 576, the 3D packer's frozen
  // 288 one dimension up. The lens4 region above stays zero-filled when
  // there is no lens, which is exactly what a balloon/plane 4D kernel's
  // unconditionally-declared struct members read.
  if (balloon) {
    writeVec3(view, 576, balloon.center);
    view.setFloat32(588, balloon.rho, true);
    view.setFloat32(592, balloon.R, true);
    view.setFloat32(596, balloon.far, true);
  }
  if (groundPlane) {
    writeGroundPlane4(view, groundPlane);
  }
  if (condensation) {
    writeCondensationBlock(
      view,
      balloon ? 608 : groundPlane ? 624 : 576,
      condensation,
    );
  }
  if (schedule) {
    const scheduleOffset = condensation
      ? balloon
        ? 624
        : groundPlane
          ? 640
          : 592
      : balloon
        ? 608
        : groundPlane
          ? 624
          : 576;
    writeSurfaceScheduleBlock(view, scheduleOffset, schedule, 4);
  }
  if (chaos) {
    writeSurfaceChaosBlock(view, baseBytes, chaos);
  }
  if (tilingInfo) {
    writeSurfaceTilingBlock(
      view,
      baseBytes + (chaos ? SURFACE_GPU_CHAOS_BYTES : 0),
      tilingInfo,
    );
  }
  return buf;
}

/** {@link writeGroundPlane}'s 4D twin — the same block at the 4D cores'
 * own shared offset. Two writers rather than one offset
 * argument, so each dimension's frozen offset is a literal a reader can
 * check against the module doc. */
function writeGroundPlane4(view: DataView, gp: SurfaceGpuGroundPlane): void {
  view.setFloat32(576, gp.y, true);
  view.setFloat32(580, gp.fadeStart, true);
  view.setFloat32(584, gp.fadeEnd, true);
  view.setFloat32(588, gp.ballRadius, true);
  writeVec3(view, 592, gp.ballCenter);
  writeVec3(view, 608, gp.albedo);
}

/**
 * Pack the params uniform for the ESCAPE4 core — the 3D escape
 * packer and the 4D one crossed, which is what this core is.
 *
 * From the escape packer: the bailout ball in `boundingRadius`,
 * {@link ESCAPE_STEP_SCALE}, the LINK COUNT in `mapCount`, `maxDepth` as
 * the orbit's PASS budget, and `symOrder`/`symPlane` carrying the
 * query-space wedge fold — with `symPlane` in {@link SYM_PLANE_CODE4}'s
 * six-plane code rather than the descents' collapsed one, because the
 * fold picks its two axes by name.
 *
 * From the 4D packer: the rotor rows, `w0`, and the slice-ADJUSTED
 * `visibleRadius` so the shared march entry's sphere gate is textually
 * unchanged. `sliceHalfW` packs 0 — a forward orbit cannot thread a
 * segment ({@link import("./escape-de-4d").estimateEscapeDistance4}), so
 * a nonzero one THROWS rather than rendering a slab it cannot bound;
 * `stepBack4` and `final4M`/`final4T` pack IDENTITY (no sector sweep, no
 * lens), and the radius band packs `(0, 0, 1/visRadius4)` so the radius
 * colour ramp is `|q4|` over the bailout ball — an escape chain has no
 * probe-fit band.
 *
 * The 464..575 VARIANT block holds ONE live word, the chain's estimate
 * form; it is sized to the lens4 block ({@link
 * SURFACE_GPU_PARAMS4_ESCAPE_BYTES}) so the shared plane block below
 * lands at 576 for every 4D core.
 */
export function packEscape4GpuParams(
  de: EscapeDE4,
  view4: SurfaceGpu4View,
  run: SurfaceGpuRunParams,
  groundPlane: SurfaceGpuGroundPlane | null = null,
  shapeTrap: ResolvedShapeTrap | null = null,
  tiling: ResolvedTiling | null = null,
): ArrayBuffer {
  const tilingInfo = surfaceTilingWireInfo(tiling, 4);
  validateSurfaceLatticeRadius(tilingInfo, de.boundingRadius);
  if (tilingInfo && de.symmetryOrder > 1) {
    throw new Error(
      "surface-de-gpu: tiling+kaleidoscope is excluded — both are " +
        "query-space folds and phase 1 has no certified order",
    );
  }
  if (tilingInfo && view4.sliceHalfW !== 0) {
    throw new Error(
      "surface-de-gpu: tiling+4D slab is excluded — the fold of a " +
        "segment is a bent polyline; tiled 4D sessions run slice 0",
    );
  }
  if (view4.sliceHalfW > 0) {
    throw new Error(
      "surface-de-gpu: the escape4 core takes no slab — a forward orbit " +
        "cannot thread a segment (escape-de-4d.ts's NO SLAB paragraph); " +
        "clamp sliceHalfW to 0 for this session",
    );
  }
  const baseBytes = shapeTrap
    ? SURFACE_GPU_PARAMS4_TRAP_BYTES
    : groundPlane
      ? SURFACE_GPU_PARAMS4_PLANE_BYTES
      : SURFACE_GPU_PARAMS4_ESCAPE_BYTES;
  const buf = new ArrayBuffer(
    baseBytes + (tilingInfo ? SURFACE_GPU_TILING_BYTES : 0),
  );
  const view = new DataView(buf);
  const R = de.boundingRadius;
  view.setFloat32(12, R, true);
  view.setFloat32(16, R * 2, true);
  view.setFloat32(20, ESCAPE_STEP_SCALE, true);
  // The slice-adjusted marching ball: |(p, w0)| <= R implies |p| <= this,
  // the affine4 packer's own line at sliceHalfW 0.
  const minW = Math.abs(view4.w0);
  const sliceR = Math.sqrt(Math.max(R * R - minW * minW, 0));
  view.setFloat32(24, sliceR, true);
  view.setFloat32(28, 1, true);
  view.setFloat32(32, 1, true);
  view.setUint32(40, de.symmetryOrder, true);
  view.setUint32(44, SYM_PLANE_CODE4[de.symmetryPlane], true);
  view.setUint32(48, de.links.length, true);
  view.setUint32(52, run.maxDepth ?? ESCAPE_TIME_ITERATIONS, true);
  view.setUint32(56, run.itemCount, true);
  view.setUint32(60, run.stepsThisPass ?? 0, true);
  view.setFloat32(64, run.cutoff ?? 0, true);
  view.setUint32(72, run.marchSteps ?? 0, true);
  const pose = run.pose;
  view.setFloat32(76, pose?.pixelEps ?? 0, true);
  view.setFloat32(80, R * (run.hitFloor ?? SURFACE_GPU_HIT_FLOOR), true);
  view.setUint32(84, pose?.rasterWidth ?? 0, true);
  view.setUint32(88, pose?.rasterHeight ?? 0, true);
  view.setFloat32(92, run.focusDepth ?? 0, true);
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
  view.setFloat32(204, run.fogDensity ?? 1, true);
  const rot = view4.rotor;
  for (let i = 0; i < 4; i++) {
    const at = 208 + i * 16;
    view.setFloat32(at, rot[i], true);
    view.setFloat32(at + 4, rot[4 + i], true);
    view.setFloat32(at + 8, rot[8 + i], true);
    view.setFloat32(at + 12, rot[12 + i], true);
  }
  // stepBack4 and final4M pack IDENTITY: this core sweeps no sectors and
  // carries no lens, and the packers' never-uninitialized convention says
  // a slot the body might read holds the value that makes it a no-op.
  for (let i = 0; i < 4; i++) {
    view.setFloat32(272 + i * 20, 1, true);
    view.setFloat32(336 + i * 20, 1, true);
  }
  view.setFloat32(416, view4.w0, true);
  view.setFloat32(424, 1, true);
  view.setFloat32(428, R, true);
  view.setFloat32(452, 1 / R, true);
  // The one live word of the 464..575 variant block.
  view.setFloat32(464, de.logEstimate ? 1 : 0, true);
  if (groundPlane) {
    writeGroundPlane4(view, groundPlane);
  }
  // The trap's live block at the frozen 624 — past the plane region, which
  // stays zero-filled when there is no floor (a block at 576 would land
  // INSIDE it: the lens4Fold corruption's shape, one append later).
  if (shapeTrap) {
    writeShapeTrap(view, 624, shapeTrap);
  }
  if (tilingInfo) {
    writeSurfaceTilingBlock(view, baseBytes, tilingInfo);
  }
  return buf;
}

/**
 * Pack the ESCAPE4 core's formula CHAIN into the `GpuMap4` layout —
 * {@link packEscapeGpuMaps} one dimension up, and the same
 * two divergences from the descent lanes: `p0` is the
 * (kind, w, derivGrowth, 0) quartet rather than the descent's sigma set,
 * and `fold` carries the SQUARED sphere radii the forward orbit's
 * `fR²/clamp(r², mR², fR²)` wants. Every other lane is zero — the same
 * "one layout, lanes a core may ignore" contract the 4D descent cores
 * already ride.
 */
export function packEscape4GpuMaps(de: EscapeDE4): Float32Array {
  const out = new Float32Array(
    de.links.length * SURFACE_GPU_MAP4_VEC4 * 4 || SURFACE_GPU_MAP4_VEC4 * 4,
  );
  de.links.forEach((link, j) => {
    const base = j * SURFACE_GPU_MAP4_VEC4 * 4;
    for (let i = 0; i < 16; i++) {
      out[base + i] = link.m[i];
    }
    out[base + 16] = link.t[0];
    out[base + 17] = link.t[1];
    out[base + 18] = link.t[2];
    out[base + 19] = link.t[3];
    out[base + 20] = link.kind;
    out[base + 21] = link.w;
    out[base + 22] = link.derivGrowth;
    out[base + 32] = link.minRadius2;
    out[base + 33] = link.fixedRadius2;
    out[base + 34] = link.boxLimit;
  });
  return out;
}

/** Pack the per-map storage array (layout contract above). */
export function packSurfaceGpuMaps(de: SurfaceDE): Float32Array {
  const schedule = surfaceScheduleWireInfo(de);
  const condensation = condensationWireInfo(de);
  const emitterCount = condensation?.emitterCount ?? 0;
  validateSurfacePhysicalMapCount(de, emitterCount);
  const scheduleMapCount = schedule?.mapCount ?? 0;
  const out = new Float32Array(
    (de.maps.length + scheduleMapCount + emitterCount) *
      SURFACE_GPU_MAP_VEC4 *
      4 || SURFACE_GPU_MAP_VEC4 * 4,
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
    // fold = the map's three AUTHORED lengths. Absent fields
    // resolved to the classic set by `resolveFoldRadii` long before here,
    // so a plain-affine slot carries (0.5, 1, 1) and never reads them.
    out[base + 24] = m.foldRadii.minR;
    out[base + 25] = m.foldRadii.fixedR;
    out[base + 26] = m.foldRadii.wall;
  });
  if (schedule) {
    const scheduleMaps = de.schedule?.maps ?? [];
    scheduleMaps.forEach((raw, j) => {
      const m = raw;
      const base = (de.maps.length + j) * SURFACE_GPU_MAP_VEC4 * 4;
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
      // B is an affine-only alphabet. The fold lanes stay zero even if a
      // hand-built object carries stray fields, so the shader cannot fan it.
      out[base + 15] = 0;
      out[base + 24] = m.foldRadii?.minR ?? 0.5;
      out[base + 25] = m.foldRadii?.fixedR ?? 1;
      out[base + 26] = m.foldRadii?.wall ?? 1;
    });
  }
  de.condensation?.emitters.forEach((emitter, j) => {
    if (!condensation) return;
    const base =
      (de.maps.length + scheduleMapCount + j) * SURFACE_GPU_MAP_VEC4 * 4;
    out[base + 0] = emitter.invM[0];
    out[base + 1] = emitter.invM[1];
    out[base + 2] = emitter.invM[2];
    out[base + 3] = emitter.invT[0];
    out[base + 4] = emitter.invM[3];
    out[base + 5] = emitter.invM[4];
    out[base + 6] = emitter.invM[5];
    out[base + 7] = emitter.invT[1];
    out[base + 8] = emitter.invM[6];
    out[base + 9] = emitter.invM[7];
    out[base + 10] = emitter.invM[8];
    out[base + 11] = emitter.invT[2];
    out[base + 12] = emitter.sigmaMin;
    out[base + 13] = emitter.shadeIndex;
    out[base + 14] = emitter.shadeIndex - de.maps.length;
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
  const schedule = surfaceScheduleWireInfo(de);
  const condensation = condensationWireInfo(de);
  const emitterCount = condensation?.emitterCount ?? 0;
  validateSurfacePhysicalMapCount(de, emitterCount);
  const scheduleMapCount = schedule?.mapCount ?? 0;
  const out = new Float32Array(
    (de.maps.length + scheduleMapCount + emitterCount) *
      SURFACE_GPU_MAP4_VEC4 *
      4 || SURFACE_GPU_MAP4_VEC4 * 4,
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
    // bnb/p1 — stage-2 branch-and-bound data, packed for layout parity and
    // read by no kernel today (module doc).
    out[base + 24] = m.bnbDir[0];
    out[base + 25] = m.bnbDir[1];
    out[base + 26] = m.bnbDir[2];
    out[base + 27] = m.bnbDir[3];
    out[base + 28] = m.invTNorm;
    out[base + 29] = m.invMSigmaMin;
    // The 3D `fold` lane one dimension up — SAME three lengths, because
    // `SurfaceFoldRadii` is shared by the two oracles (two copies
    // of "what does an absent field mean" is how a 3D system and its 4D
    // lift start rendering different objects).
    out[base + 32] = m.foldRadii.minR;
    out[base + 33] = m.foldRadii.fixedR;
    out[base + 34] = m.foldRadii.wall;
  });
  if (schedule) {
    const scheduleMaps = de.schedule?.maps ?? [];
    scheduleMaps.forEach((raw, j) => {
      const m = raw;
      const base = (de.maps.length + j) * SURFACE_GPU_MAP4_VEC4 * 4;
      for (let i = 0; i < 16; i++) {
        out[base + i] = m.invM[i];
      }
      out[base + 16] = m.invT[0];
      out[base + 17] = m.invT[1];
      out[base + 18] = m.invT[2];
      out[base + 19] = m.invT[3];
      out[base + 20] = m.sigmaMin;
      out[base + 23] = 0;
      out[base + 32] = m.foldRadii?.minR ?? 0.5;
      out[base + 33] = m.foldRadii?.fixedR ?? 1;
      out[base + 34] = m.foldRadii?.wall ?? 1;
    });
  }
  de.condensation?.emitters.forEach((emitter, j) => {
    if (!condensation) return;
    const base =
      (de.maps.length + scheduleMapCount + j) * SURFACE_GPU_MAP4_VEC4 * 4;
    for (let i = 0; i < 16; i++) {
      out[base + i] = emitter.invM[i];
    }
    out[base + 16] = emitter.invT[0];
    out[base + 17] = emitter.invT[1];
    out[base + 18] = emitter.invT[2];
    out[base + 19] = emitter.invT[3];
    out[base + 20] = emitter.sigmaMin;
    out[base + 21] = emitter.shadeIndex;
    out[base + 22] = emitter.shadeIndex - de.maps.length;
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
  /** Whether a balloon shade kernel samples its independent LUT. Packed in
   * flags bit1; false/absent is explicit inherit and preserves the existing
   * base-colour path. Ignored by non-balloon kernels. */
  balloonPalette?: boolean;
  /** Fog tint color, packed at offset 128 (module doc): what
   * the shade entry's fog blends toward is mix(bg, fogTint,
   * fogTintStrength). Default [1, 1, 1] when omitted, matching the GLSL
   * tracers' uFogTint default; inert while fogTintStrength is 0. */
  fogTint?: Vec3;
  /** Fog tint strength, packed at offset 140 (module doc).
   * Default 0 — the identity, fog toward the pixel's own backdrop color
   * alone — when omitted, matching the GLSL tracers' uFogTintStrength
   * default; misses never read it. */
  fogTintStrength?: number;
  /**
   * Sub-pixel sample position, packed at offset 144 — where
   * inside pixel `(px, py)` this frame's ray is aimed. The DEFAULT
   * `[0.5, 0.5]` is the pixel centre, i.e. every ray derivation's former
   * literal, so an omitted jitter resolves the pre-supersampling kernel
   * value for value and every bench agreement leg is unmoved.
   *
   * Supersampling is N FRAMES at N offsets averaged by the host, not N
   * rays inside one frame: a frame's raster is bounded by the device's
   * own buffer limits, and multiplying the ray count would hit
   * that ceiling N times sooner for an image the compute path already
   * renders progressively. The march-start dither reads the jittered
   * coordinate too, so the samples do not share a `t` offset.
   */
  pixelJitter?: [number, number];
  /**
   * Environment-light strength, packed at offset 152 — the
   * former ShadeParams alignment pad, so {@link SURFACE_GPU_SHADE_BYTES}
   * is unchanged. How far the shade entry's AMBIENT term is tinted
   * toward the backdrop sampled along the shading normal, hue only
   * (`envTint` normalizes the sampled backdrop to its own max channel).
   * Default/absent 0 is the bit-exact pre-environment-light identity: the tint
   * resolves to `vec3f(1.0)` and `lit` reduces to the old scalar formula
   * replicated per component.
   */
  envStrength?: number;
  /**
   * The traced raster's pixel offset within the FULL image, packed at
   * offset 160 — `background-shape.ts`'s coordinate contract.
   * REQUIRED, not defaulted: there is no safe fallback, since an absent
   * offset would silently shift every non-full-frame trace's backdrop.
   * `[0, 0]` for an ordinary frame; `[0, bandBottom]` for a capture band.
   */
  bgOffset: [number, number];
  /**
   * The FULL image's pixel size, packed at offset 168 — the
   * divisor in `background-shape.ts`'s `imageUv`. REQUIRED: an absent
   * extent divides by zero (or, defaulted to 1, silently renders the
   * wrong shape) rather than failing loudly, and a caller mid-band-trace
   * is exactly the caller most likely to already have this value. Equal
   * to the raster's own size for an ordinary frame; the full image's size
   * for a capture band.
   */
  bgExtent: [number, number];
  /**
   * The shared background shape's normalized-image centre, packed at
   * offset 176 — `background-shape.ts`'s `BackgroundShapeSpec.
   * center`. REQUIRED, same precedent as `bgOffset`/`bgExtent`: unread by
   * `bgShape === 0` ("linear") but there is no universally-safe default
   * for a field whose meaning depends on a sibling field's value.
   */
  bgCenter: [number, number];
  /**
   * The shared background shape's per-axis scale, packed at
   * offset 184 — `background-shape.ts`'s `backgroundRadialScale` of
   * whatever full image `bgExtent` names. REQUIRED for the same reason as
   * `bgCenter`; unread by `bgShape === 0`.
   */
  bgScale: [number, number];
  /**
   * The shared background shape's numeric kind, packed at
   * offset 192 — `background-shape.ts`'s `backgroundShapeCode` (0 =
   * "linear", 1 = "radial"). REQUIRED, no safe default: an absent shape
   * is not "linear" by convention here the way an absent `envStrength` is
   * 0 — the host always knows which shape it resolved.
   */
  bgShape: number;
  /** The balloon echo's tint colour, packed at offset 208
   * (module doc): what a SHELL hit's base albedo mixes toward, before
   * lighting. Default `[0, 0, 0]` when omitted — the document's own
   * `DEFAULT_BALLOON_TINT`, black, which makes the strength slider alone
   * a dimmer (`mix(base, black, s)` is `base * (1 - s)`); inert while
   * balloonTintStrength is 0, and read by no kernel compiled without a
   * balloon. */
  balloonTint?: Vec3;
  /** The balloon echo's tint strength, 0..1, packed at offset
   * 220 (module doc). Default 0 when omitted — the identity, `mix(x, y,
   * 0)` = x, so an unset pair renders the pre-tint frame byte for
   * byte. It is gated per-ray by the union argmin's `hi.shell`, so a
   * FRACTAL-term hit is untouched at any strength. */
  balloonTintStrength?: number;
  /** The pattern calibration quartet `(ringsLow, ringsInvSpan,
   * sheetsLow, sheetsInvSpan)`, packed at offset 224 — the pattern arm's
   * native-carrier clamp (GLSL `uPatternCalibration` order). Present
   * EXACTLY when the shade kernel was generated with the pattern gate:
   * the buffer becomes {@link SURFACE_GPU_SHADE_PATTERN_BYTES} bytes and
   * the host binds it to both pipelines of the patterned session. Absent —
   * every caller predating the pattern bead — keeps the 224-byte buffer
   * byte for byte. */
  patternCalibration?: [number, number, number, number];
}

/** Pack the ShadeParams uniform (march "unproject" + mode "shade";
 * layout contract in the module doc). flags bit0 is dither and bit1 enables
 * the independent balloon LUT. A present
 * `patternCalibration` grows the buffer to
 * {@link SURFACE_GPU_SHADE_PATTERN_BYTES} with the quartet at 224;
 * absent, the 224-byte buffer is byte for byte what it was. */
export function packSurfaceGpuShade(shade: SurfaceGpuShadeParams): ArrayBuffer {
  const calibration = shade.patternCalibration;
  const buf = new ArrayBuffer(
    calibration ? SURFACE_GPU_SHADE_PATTERN_BYTES : SURFACE_GPU_SHADE_BYTES,
  );
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
  view.setUint32(
    124,
    (shade.dither ? 1 : 0) | (shade.balloonPalette ? 2 : 0),
    true,
  );
  writeVec3(view, 128, shade.fogTint ?? [1, 1, 1]);
  view.setFloat32(140, shade.fogTintStrength ?? 0, true);
  const jitter = shade.pixelJitter ?? [0.5, 0.5];
  view.setFloat32(144, jitter[0], true);
  view.setFloat32(148, jitter[1], true);
  view.setFloat32(152, shade.envStrength ?? 0, true);
  view.setFloat32(160, shade.bgOffset[0], true);
  view.setFloat32(164, shade.bgOffset[1], true);
  view.setFloat32(168, shade.bgExtent[0], true);
  view.setFloat32(172, shade.bgExtent[1], true);
  view.setFloat32(176, shade.bgCenter[0], true);
  view.setFloat32(180, shade.bgCenter[1], true);
  view.setFloat32(184, shade.bgScale[0], true);
  view.setFloat32(188, shade.bgScale[1], true);
  view.setUint32(192, shade.bgShape, true);
  // The balloon echo's tint pair, at the next 16-aligned offset
  // past bgShape's 196 tail (a vec3f cannot sit in that pad). Defaults —
  // black at zero strength — are the identity the mix reduces to, so a
  // host that never heard of the tint packs the pre-tint uniform.
  writeVec3(view, 208, shade.balloonTint ?? [0, 0, 0]);
  view.setFloat32(220, shade.balloonTintStrength ?? 0, true);
  // The pattern calibration quartet at the frozen 224 — present exactly
  // when the kernel was generated with the pattern gate (the struct's own
  // conditional member), growing the buffer to 240.
  if (calibration) {
    view.setFloat32(224, calibration[0], true);
    view.setFloat32(228, calibration[1], true);
    view.setFloat32(232, calibration[2], true);
    view.setFloat32(236, calibration[3], true);
  }
  return buf;
}

/** Per-map shading storage for mode "shade": one vec4f per map slot,
 * (color.r, color.g, color.b, trapIndex) — uMapColor + the uFoldParams .w
 * trap component, which GpuMap does not carry. Pads to one zero stride
 * when empty, like packSurfaceGpuMaps.
 *
 * `materials` — present exactly when the kernel was generated with finish OR
 * pattern true — grows the stride to THREE vec4f per slot: the vec4 above
 * unchanged at `[0]`, then the slot's two lanes in `surfaceMaterialLanes`'
 * order — `[1]` = (specular, shininess, metalness, reflect), `[2]` =
 * (transmit, reflectionTint, patternConfig, scale). Absent — every caller
 * predating the material wire — returns the 1-vec4-stride buffer byte for
 * byte. Empty colors
 * still pad one zero stride (12 floats here); the shader's slot clamp
 * keeps reads inside real slots, so zero-filled padding is safe. Throws
 * `RangeError` when `materials` is present but does not cover every color
 * slot — a caller bug, like the module's other pack throws. */
export function packSurfaceGpuShadeMaps(
  colors: Vec3[],
  trapIndices: number[],
  materials?: readonly ResolvedSurfaceMaterial[],
): Float32Array {
  if (!materials) {
    const out = new Float32Array(Math.max(colors.length, 1) * 4);
    colors.forEach((c, j) => {
      out[j * 4 + 0] = c[0];
      out[j * 4 + 1] = c[1];
      out[j * 4 + 2] = c[2];
      out[j * 4 + 3] = trapIndices[j] ?? 0;
    });
    return out;
  }
  if (materials.length !== colors.length) {
    throw new RangeError(
      `surface-de-gpu: ${materials.length} materials for ${colors.length} ` +
        "map colors — a material list must cover every slot",
    );
  }
  const out = new Float32Array(Math.max(colors.length, 1) * 12);
  colors.forEach((c, j) => {
    out[j * 12 + 0] = c[0];
    out[j * 12 + 1] = c[1];
    out[j * 12 + 2] = c[2];
    out[j * 12 + 3] = trapIndices[j] ?? 0;
    const lanes = surfaceMaterialLanes(materials[j]);
    out.set(lanes.a, j * 12 + 4);
    out.set(lanes.b, j * 12 + 8);
  });
  return out;
}

/**
 * `variations.ts`'s `triplexPow8` in WGSL — ONE definition for the two
 * FORWARD cores that need it. It was the bulb core's private
 * text until an escape-time chain LINK could be a triplex power
 * (`ESCAPE_LINK_BULB`), and two copies of the map both cores' oracles
 * share is exactly the drift `renameToProbe` and the shared descent
 * prologue exist to prevent.
 *
 * Emitted for `core: "bulb"` and `core: "escape"` and for nothing else, so
 * every affine/fold kernel's source stays byte-identical. An escape kernel
 * whose chain holds no power link still emits it — dead code the compiler
 * drops, and DELIBERATELY not narrowed: the source is memoized on the
 * codegen config alone, so a maps-dependent term in the text would key
 * two different kernels to one cache entry. Do not "fix" it by reading
 * the link list here.
 */
const bulbPow8Text = /* wgsl */ `// variations.ts's triplexPow8, the White/Nylander 8th power in its
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
}`;

/**
 * Generate the WGSL source for one kernel configuration. The descent body
 * is `descendFold`'s refine=false path term for term (surface-de.ts) in
 * the GLSL mirror's f32 formulation (surface-material.ts `#if
 * SURFACE_FOLDS`): same enumeration order, same prunes, same unsorted
 * frontier with tracked-worst rescan, same early exits — so the CPU
 * estimator, the GLSL tracer and this kernel stay in lockstep term for
 * term, and any disagreement the bench finds is a bug, not a design gap.
 */
/** A finite number as a WGSL float literal — `shapes.ts`'s `lit` rule
 * (String round-trips f64 exactly; a bare integer gains `.0` so the token
 * reads as a float). Used for the trap's baked normalizer. */
function wgslFloatLit(x: number): string {
  if (!Number.isFinite(x)) {
    throw new Error(`surface-de-gpu: non-finite baked constant (${x})`);
  }
  const s = String(x);
  return /[.e]/.test(s) ? s : `${s}.0`;
}

/**
 * One binding and one manual-trilinear sampler for the active mesh SDF atlas.
 * Shape bodies emitted by `shapeSdfSource` call `shapeMeshSdf` with the stable
 * CATALOG index, while each active entry's z offset addresses its compact
 * slab. Keeping the resource declaration here means a shader containing
 * several trap/condensation shapes still declares the texture exactly once.
 * `textureLoad` is deliberate: R32F is not guaranteed filterable, and the CPU
 * oracle's conservative proof is over these exact eight node loads.
 */
export function surfaceMeshSdfWgslSource(
  activeIds: readonly MeshAssetId[],
): string {
  const atlas = activeMeshSdfAtlas(activeIds);
  const bodies = atlas.entries
    .map((entry) => {
      const n = entry.resolution;
      const hi = n - 1;
      const fn = `shapeMeshSdf${entry.shaderIndex}`;
      return /* wgsl */ `fn ${fn}(p: vec3f) -> f32 {
  let lo = vec3f(${wgslFloatLit(entry.min[0])}, ${wgslFloatLit(entry.min[1])}, ${wgslFloatLit(entry.min[2])});
  let hi = vec3f(${wgslFloatLit(entry.max[0])}, ${wgslFloatLit(entry.max[1])}, ${wgslFloatLit(entry.max[2])});
  let g = clamp((p - lo) / ${wgslFloatLit(entry.cellSize)}, vec3f(0.0), vec3f(${hi}.0));
  let i0 = vec3i(floor(g));
  let i1 = min(i0 + vec3i(1), vec3i(${hi}));
  let f = fract(g);
  let z0 = ${entry.zOffset} + i0.z;
  let z1 = ${entry.zOffset} + i1.z;
  let x00 = mix(
    textureLoad(shapeMeshSdfTex, vec3i(i0.x, i0.y, z0), 0).x,
    textureLoad(shapeMeshSdfTex, vec3i(i1.x, i0.y, z0), 0).x,
    f.x,
  );
  let x10 = mix(
    textureLoad(shapeMeshSdfTex, vec3i(i0.x, i1.y, z0), 0).x,
    textureLoad(shapeMeshSdfTex, vec3i(i1.x, i1.y, z0), 0).x,
    f.x,
  );
  let x01 = mix(
    textureLoad(shapeMeshSdfTex, vec3i(i0.x, i0.y, z1), 0).x,
    textureLoad(shapeMeshSdfTex, vec3i(i1.x, i0.y, z1), 0).x,
    f.x,
  );
  let x11 = mix(
    textureLoad(shapeMeshSdfTex, vec3i(i0.x, i1.y, z1), 0).x,
    textureLoad(shapeMeshSdfTex, vec3i(i1.x, i1.y, z1), 0).x,
    f.x,
  );
  let interpolated = mix(mix(x00, x10, f.y), mix(x01, x11, f.y), f.z);
  let outside = max(max(lo - p, p - hi), vec3f(0.0));
  let boxDistance = length(outside);
  if (boxDistance > 0.0) {
    return max(interpolated, boxDistance);
  }
  return interpolated;
}`;
    })
    .join("\n\n");
  const choices = atlas.entries
    .map(
      (entry) => `    case ${entry.shaderIndex}u: {
      return shapeMeshSdf${entry.shaderIndex}(p);
    }`,
    )
    .join("\n");
  return /* wgsl */ `@group(0) @binding(11) var shapeMeshSdfTex: texture_3d<f32>;

${bodies}

fn shapeMeshSdf(meshIndex: u32, p: vec3f) -> f32 {
  switch meshIndex {
${choices}
    default: {
      return 1e30;
    }
  }
}
`;
}

export function surfaceDeKernelWgsl(opts: SurfaceGpuKernelOptions): string {
  const {
    mode,
    width,
    workgroupSize,
    sharedFrontier,
    bnbStage2: requestedBnbStage2,
  } = opts;
  // Which descent body. Absent means "fold", so every config
  // that predates the option generates byte-identical source.
  const core = opts.core ?? "fold";
  // Absent means no lens, so every no-lens config generates
  // byte-identical source. Shade support for the affine core and the
  // lens (hit-info bodies + probe composition) landed with the
  // fold-lens port's stage C.
  const lens = opts.lens ?? false;
  if (core === "escape" && lens) {
    // analyzeEscapeSystem refuses final transforms, so no oracle or GLSL
    // arm pins a lensed escape shape — loud beats generating one.
    throw new Error(
      "surface-de-gpu: the escape core cannot take a fold-final lens",
    );
  }
  if (core === "bulb" && lens) {
    // analyzeBulbSystem refuses final transforms for the same reason —
    // the escape arm's throw, one formula over.
    throw new Error(
      "surface-de-gpu: the bulb core cannot take a fold-final lens",
    );
  }
  if (core === "escape4" && lens) {
    // analyzeEscapeSystem4 refuses final transforms exactly as its 3D
    // twin does — and here the refusal is load-bearing beyond taste: the
    // escape4 params block IS the lens4 block's region.
    throw new Error(
      "surface-de-gpu: the escape4 core cannot take a fold-final lens",
    );
  }
  // The 4D cores: one view lift, one params tail, one maps layout. The
  // shared header/entry interpolations below key on this, so an eighth
  // core cannot forget one of them.
  const core4 = core === "affine4" || core === "fold4" || core === "escape4";
  // The FORWARD cores (escape, bulb and escape4): a forward orbit
  // rather than a descent, so none of the
  // descent helpers and no frontier. The shared header/entry
  // interpolations below key on this the way they key on `core4`, so an
  // eighth core cannot forget one of them. `escape4` is the first core
  // that is BOTH — it takes the 4D tail and the `GpuMap4` layout from the
  // descent cores and the orbit from the 3D escape one.
  const forward = core === "escape" || core === "bulb" || core === "escape4";
  // Tiling is a compile gate: finite roots and either arm's analytic clip
  // bake into the source, while the params tail carries the construction code
  // and lattice h. Validate resolver authority before any body text is
  // assembled so malformed options fail before pipeline submission.
  const tilingInfo = surfaceTilingWireInfo(opts.tiling, core4 ? 4 : 3);
  const tiling = tilingInfo?.tiling ?? null;
  const latticeTiling = tilingInfo?.kind === "lattice";
  let schedule: NonNullable<SurfaceGpuKernelOptions["schedule"]> | null = null;
  if (opts.schedule && opts.schedule.scheduleMapCount !== 0) {
    if (
      !Number.isInteger(opts.schedule.mapCount) ||
      opts.schedule.mapCount < 1 ||
      !Number.isInteger(opts.schedule.scheduleMapCount) ||
      opts.schedule.scheduleMapCount < 1
    ) {
      throw new RangeError(
        `surface-de-gpu: bad hybrid schedule counts A=${opts.schedule.mapCount}, ` +
          `B=${opts.schedule.scheduleMapCount}`,
      );
    }
    if (
      opts.schedule.mapCount + opts.schedule.scheduleMapCount >
      SURFACE_GPU_UNIFORM_MAP_SLOTS
    ) {
      throw new RangeError(
        `surface-de-gpu: hybrid schedule needs ${
          opts.schedule.mapCount + opts.schedule.scheduleMapCount
        } physical map records; the low-level cap is ${SURFACE_GPU_UNIFORM_MAP_SLOTS}`,
      );
    }
    schedule = opts.schedule;
  }
  if (schedule && forward) {
    throw new Error(
      "surface-de-gpu: hybrid schedules are supported only by the " +
        "affine/fold/affine4/fold4 descent cores",
    );
  }
  let chaos: NonNullable<SurfaceGpuKernelOptions["chaos"]> | null = null;
  if (opts.chaos && opts.chaos.activeStateCount !== 0) {
    // Reuse the packer's one validation rule so codegen and the wire cannot
    // disagree about mask length, u32 range, or live-state bits.
    const info = surfaceChaosWireInfo({
      chaos: {
        activeStateCount: opts.chaos.activeStateCount,
        predecessorMasks: opts.chaos.predecessorMasks,
      },
    });
    chaos = info
      ? {
          activeStateCount: info.activeStateCount,
          predecessorMasks: Array.from(info.predecessorMasks),
        }
      : null;
  }
  if (chaos && forward) {
    throw new Error(
      "surface-de-gpu: graph-directed selection is supported only by the " +
        "affine/fold/affine4/fold4 descent cores",
    );
  }
  // Stage-2's packed center-specific metadata and stationary-root radii do
  // not certify B levels. Keep the known-safe stage-1 path for schedules.
  const bnbStage2 = requestedBnbStage2 && schedule === null;
  let condensationShapes: readonly ShapeSpec[] | null = null;
  if (opts.condensation && opts.condensation.emitters.length > 0) {
    const codegenCondensation = opts.condensation;
    if (
      !Number.isInteger(codegenCondensation.mapCount) ||
      codegenCondensation.mapCount < 0
    ) {
      throw new RangeError(
        `surface-de-gpu: bad condensation map count ${codegenCondensation.mapCount}`,
      );
    }
    if (schedule && codegenCondensation.mapCount !== schedule.mapCount) {
      throw new RangeError(
        `surface-de-gpu: condensation A count ${codegenCondensation.mapCount} ` +
          `does not match schedule A count ${schedule.mapCount}`,
      );
    }
    const physicalCount =
      codegenCondensation.mapCount +
      (schedule?.scheduleMapCount ?? 0) +
      codegenCondensation.emitters.length;
    if (physicalCount > SURFACE_GPU_UNIFORM_MAP_SLOTS) {
      throw new RangeError(
        `surface-de-gpu: schedule+condensation needs ${physicalCount} physical ` +
          `map/emitter records; the low-level cap is ${SURFACE_GPU_UNIFORM_MAP_SLOTS}`,
      );
    }
    const info = condensationWireInfo({
      maps: new Array(codegenCondensation.mapCount),
      condensation: {
        emitters: codegenCondensation.emitters,
        depthBand: { minDepth: 0, maxDepth: 0 },
      },
    })!;
    // Size by the validated shade suffix, not the symmetry-expanded record
    // count, then make every copy agree on its base shape.
    const shapes = new Array<ShapeSpec>(
      info.shadeCount - codegenCondensation.mapCount,
    );
    for (const emitter of codegenCondensation.emitters) {
      const selector = emitter.shadeIndex - codegenCondensation.mapCount;
      const prior = shapes[selector];
      if (prior && prior !== emitter.shape) {
        throw new RangeError(
          `surface-de-gpu: condensation shade ${emitter.shadeIndex} points ` +
            "at multiple ShapeSpecs",
        );
      }
      shapes[selector] = emitter.shape;
    }
    condensationShapes = shapes;
  }
  if (condensationShapes && forward) {
    throw new Error(
      "surface-de-gpu: condensation is supported only by the " +
        "affine/fold/affine4/fold4 descent cores; forward cores refuse it",
    );
  }
  // ...but the escape cores' formula CHAIN rides the maps
  // storage binding — one `GpuMap`/`GpuMap4` per LINK, the descent cores'
  // own layout carrying FORWARD affines (packed by {@link
  // packEscapeGpuMaps} / {@link packEscape4GpuMaps}), because a list is
  // exactly what that binding is for. Bulb is the one bindingless core
  // left: its single map still rides the params variant block.
  const mapsBinding = !forward || core === "escape" || core === "escape4";
  // Does any body in this kernel enumerate the fold's INVERSE
  // branches, and so need `foldRadiiOf`? The fold cores do, and so does the
  // lens wrapper around ANY descent core (a fold FINAL is still a fold).
  // The forward cores read their links' lengths straight off the wire —
  // `escape-de.ts` keeps them SQUARED, which is what its orbit wants — so
  // they never derive the branch algebra. Affine kernels stay byte-identical
  // to the source that predates the authored lengths, which is what makes
  // that claim testable.
  const foldRadii = core === "fold" || core === "fold4" || lens;
  // The balloon inverted-union wrapper (THE BALLOON WRAPPER,
  // module doc). Absent means no balloon, so every no-balloon config
  // generates byte-identical source.
  const balloon = opts.balloon ?? false;
  if (balloon && tiling) {
    throw new Error(
      "surface-de-gpu: tiling+balloon is excluded — an orbit's echo is " +
        "not the echo's orbit, so there is no certified composition",
    );
  }
  if (balloon && core === "escape") {
    throw new Error(
      "surface-de-gpu: balloon+escape: excluded — the escape solid's " +
        "interior reaches the ball center, so its echo swallows the " +
        "camera (the escape folds' measured verdict); escape sessions " +
        "render plain",
    );
  }
  if (balloon && core === "bulb") {
    throw new Error(
      "surface-de-gpu: balloon+bulb: excluded — the Mandelbulb's interior " +
        "reaches the ball center exactly as the escape solid's does, so " +
        "its echo swallows the camera (the escape folds' measured " +
        "verdict); bulb sessions render plain",
    );
  }
  if (balloon && core === "escape4") {
    throw new Error(
      "surface-de-gpu: balloon+escape4: excluded — a forward-orbit " +
        "solid's interior reaches the ball center whatever its dimension, " +
        "so its echo swallows the camera (the escape folds' measured " +
        "verdict); escape sessions render plain",
    );
  }
  // The march's status side-channel (option doc). Absent means
  // no side channel, so every config predating it — the bench's march
  // baselines included — generates byte-identical source.
  const statusOut = opts.statusOut ?? false;
  if (statusOut && mode !== "march") {
    throw new Error(
      "surface-de-gpu: statusOut is a march-mode output — only the march " +
        "advances a ray's status, and only the host's active-list rebuild " +
        "reads one",
    );
  }
  // The ground plane — an analytic floor MISS rays classify
  // against in the march (status PLANE inside the fade band) and the
  // shade entry lights with the hit path's penumbra/AO machinery.
  // Absent means no plane, so every config predating it generates
  // byte-identical source.
  const groundPlane = opts.groundPlane ?? false;
  if (groundPlane && balloon) {
    throw new Error(
      "surface-de-gpu: groundPlane+balloon: excluded — the enclosing " +
        "shell has no horizon for a floor to sit on (the GLSL " +
        "arm refuses the same pair)",
    );
  }
  // The escape family's shape-trap color channel (option doc). Absent
  // means no trap, so every trap-free config generates byte-identical
  // source — the compile-gate mechanism, exactly the finish flag's.
  const shapeTrap = opts.shapeTrap ?? null;
  // Geometry is a SECOND compile gate on the same trap. Its band is baked
  // because geometry edits restart the Surface session; the pose and inverse
  // scale remain live in the existing trap block. Keeping this separate from
  // `shapeTrap` is load-bearing for color-only source identity.
  const shapeTrapGeometry =
    opts.shapeTrapGeometry?.geometry === true ? opts.shapeTrapGeometry : null;
  if (shapeTrapGeometry && !shapeTrap) {
    throw new Error(
      "surface-de-gpu: shapeTrapGeometry requires shapeTrap geometry",
    );
  }
  if (shapeTrapGeometry && core === "bulb") {
    throw new Error(
      "surface-de-gpu: shape-trap geometry is excluded from the bulb/power core",
    );
  }
  if (shapeTrapGeometry) {
    const { geometryLevelMin, geometryLevelMax } = shapeTrapGeometry;
    if (
      !Number.isInteger(geometryLevelMin) ||
      !Number.isInteger(geometryLevelMax) ||
      geometryLevelMin < 0 ||
      geometryLevelMax < geometryLevelMin ||
      geometryLevelMax > SHAPE_TRAP_GEOMETRY_LEVEL_MAX
    ) {
      throw new Error(
        `surface-de-gpu: bad shape-trap geometry band ${geometryLevelMin}..${geometryLevelMax}`,
      );
    }
  }
  if (shapeTrap && condensationShapes) {
    throw new Error(
      "surface-de-gpu: condensation+shapeTrap is excluded — condensation " +
        "belongs to descent cores and shapeTrap belongs to forward cores",
    );
  }
  if (shapeTrap && !forward) {
    throw new Error(
      "surface-de-gpu: shapeTrap is the escape family's color channel " +
        "(cores escape/bulb/escape4) — a descent hit-info is a branch " +
        "sweep with no forward orbit for the accumulator to ride",
    );
  }
  // Mesh resources are selected entirely by the baked shape vocabulary,
  // never by a params-wire flag. Trap and condensation are currently
  // exclusive, but derive across both so this seam stays explicit.
  // Source generation itself is eager: the shade-only trap helper is built
  // while assembling every kernel variant, even when that helper is not
  // spliced into eval/march output. Keep a complete slot map for that eager
  // pass, while only declaring/uploading resources in variants that actually
  // evaluate the mesh SDF.
  const sourceMeshIds = [
    ...(shapeTrap ? shapeMeshIds(shapeTrap) : []),
    ...(condensationShapes ? shapeSpecsMeshIds(condensationShapes) : []),
  ];
  const meshIds = [
    ...(shapeTrap && (mode === "shade" || shapeTrapGeometry)
      ? shapeMeshIds(shapeTrap)
      : []),
    ...(condensationShapes ? shapeSpecsMeshIds(condensationShapes) : []),
  ];
  const meshSdfHelperText =
    meshIds.length > 0 ? `${surfaceMeshSdfWgslSource(meshIds)}\n` : "";
  const meshIndex = (id: MeshAssetId): number =>
    meshSdfAtlasShaderIndex(sourceMeshIds, id);
  const tilingFoldText = tiling
    ? latticeTiling
      ? `${latticeFoldSource("wgsl", core4 ? 4 : 3, "tilingFold")}\n`
      : `${tilingFoldSource(
          (tiling as ResolvedFiniteTiling).info,
          "wgsl",
          "tilingFold",
        )}\n`
    : "";
  // The lattice arm's finite-presentation carrier — the SAME emitted text
  // the GLSL tracers carry (lattice-march.ts's carrier source): the
  // world-3D observation sphere intersected with the attractor-y slab.
  // The interval bounds the march; the contains predicate makes
  // out-of-carrier probe taps open space so the artificial window never
  // becomes geometry, casts a shadow or contributes AO. Inert (absent)
  // for every non-lattice program, which keeps their text byte-identical.
  const latticeCarrierText = latticeTiling
    ? `${latticePresentationCarrierSource(core4 ? 4 : 3, "wgsl")}\n`
    : "";
  const tilingClipText = tiling?.clip
    ? `${shapeSdfSource(tiling.clip, "wgsl", "tilingClipSdf")}\n`
    : "";
  // Per-slot finish lighting (option doc). Absent means the fixed
  // Blinn-Phong lines, so every config predating the option generates
  // byte-identical source; no throw anywhere — the flag composes with
  // every core and wrapper, and is STRUCTURALLY inert outside shade mode
  // (every splice below lands in shade-emitted text alone).
  const finish = opts.finish ?? false;
  // The independent pattern gate (option doc): the shared pattern body,
  // the hit-info's source4 member, and the calibration quartet's
  // ShadeParams member all key on this flag alone.
  const pattern = opts.pattern ?? false;
  const material = finish || pattern;
  // The hit-info constructor's pattern member: WGSL value constructors
  // are all-or-none, so under the pattern gate every core's full-member
  // constructor gains the source4 placeholder (zeroed — the core fills it
  // before returning, and the balloon rename extends the SAME text).
  const source4CtorArg = pattern ? ", vec4f(0.0)" : "";
  // The shape trap's hit-info constructor member, appended LAST (after the
  // pattern member; the balloon members never co-exist with it — every
  // forward core throws under balloon — so the balloon rename strings stay
  // untouched text). 1.0 is the far value; the bodies overwrite it.
  const trapCtorArg = shapeTrap ? ", 1.0" : "";
  // Tiling-only shading attribution: the outer wrapper fills the folded
  // chamber point so height/radius/pattern repeat with the chamber content,
  // while normals, lighting and fog keep using the visible world position.
  const tilingCtorArg = tiling ? ", vec4f(0.0)" : "";
  // The trap's per-body splices — the ONE formula (`escape-de.ts`'s
  // shapeTrapCandidate/shapeTrapValue) in its f32 formulation, emitted only
  // into the three forward hit-info orbits. `-1e+30` is
  // SHAPE_TRAP_NO_CROSSING, interpolated so the two sides cannot drift.
  const trapDecl = shapeTrap
    ? /* wgsl */ `
  var trapBest = 1.0e30;
  var trapCross = ${SHAPE_TRAP_NO_CROSSING};`
    : "";
  // (pointExpr, indexExpr) -> the per-step accumulator lines, placed right
  // after the rings/sheets min-tracks so the trap reads exactly the orbit
  // points they read.
  const trapStep = (point: string, idx: string): string =>
    shapeTrap
      ? /* wgsl */ `
    let tCand = trapCandidate(${point}, ${idx});
    trapBest = min(trapBest, tCand);
    if (trapCross <= ${SHAPE_TRAP_NO_CROSSING} && tCand < params.trapP.z) {
      trapCross = tCand;
    }`
      : "";
  const trapFinal = shapeTrap
    ? /* wgsl */ `
  info.shapeTrap = trapValue(trapBest, trapCross);`
    : "";
  // Geometry's one posed local-SDF helper. It is emitted beside the value
  // body in every mode so eval/march can use it; shade's color accumulator
  // calls the SAME helper, keeping the pose transform and SDF evaluation in
  // one definition. Color-only keeps its historical helper text below
  // untouched and never emits this block.
  const trapGeometryHelperText =
    shapeTrap && shapeTrapGeometry
      ? `${shapeSdfSource(shapeTrap, "wgsl", "trapShapeSdf", { meshIndex })}
// Shared posed local SDF for shape-trap color and geometry. The similarity's
// value factor is deliberately NOT restored here: color normalizes this local
// value, while geometry divides it by invScale at the post-link dr.
fn trapLocalSdf(pOrbit: vec3f) -> f32 {
  let td = pOrbit - vec3f(params.trapR0.w, params.trapR1.w, params.trapR2.w);
  let tl = vec3f(
    dot(params.trapR0.xyz, td),
    dot(params.trapR1.xyz, td),
    dot(params.trapR2.xyz, td),
  ) * params.trapP.x;
  return trapShapeSdf(tl);
}

`
      : "";
  const trapGeometryDecl = shapeTrapGeometry
    ? /* wgsl */ `
  var trapDistance = 1.0e30;`
    : "";
  const trapGeometryStep = (point: string, idx: string): string =>
    shapeTrapGeometry
      ? /* wgsl */ `
    if (${idx} >= ${shapeTrapGeometry.geometryLevelMin}u && ${idx} <= ${shapeTrapGeometry.geometryLevelMax}u) {
      let trapLocalDistance = trapLocalSdf(${point});
      trapDistance = min(
        trapDistance,
        (${wgslFloatLit(SHAPE_MARCH_SAFETY)} * trapLocalDistance) / (params.trapP.x * dr),
      );
    }`
      : "";
  // The trap's shade-mode helpers: the BAKED shape SDF (per-spec codegen,
  // `shapes.ts`'s shapeSdfSource — the create-time-geometry decision) plus
  // the candidate/finalize pair mirroring `escape-de.ts`'s
  // shapeTrapCandidate/shapeTrapValue term for term. The normalizer is a
  // baked literal from the ONE shared definition (`shapeTrapInvNorm`), so
  // the kernel and the resolver cannot disagree; everything LIVE rides the
  // appended trap params block.
  const trapHelperText = shapeTrap
    ? `${shapeTrapGeometry ? "" : shapeSdfSource(shapeTrap, "wgsl", "trapShapeSdf", { meshIndex })}
// Step stepIdx's trap candidate at orbit point pOrbit — escape-de.ts's
// shapeTrapCandidate in f32: pose inverse WITHOUT the value factor
// (distances in the shape's own local units), normalized by the baked
// bounding radius so the channel is scale-relative, then the
// fade-by-index weight.
fn trapCandidate(pOrbit: vec3f, stepIdx: u32) -> f32 {
${
  shapeTrapGeometry
    ? `  return trapLocalSdf(pOrbit) * ${wgslFloatLit(shapeTrapInvNorm(shapeTrap))} *
    (1.0 + params.trapP.w * f32(stepIdx));`
    : `  let td = pOrbit - vec3f(params.trapR0.w, params.trapR1.w, params.trapR2.w);
  let tl = vec3f(
    dot(params.trapR0.xyz, td),
    dot(params.trapR1.xyz, td),
    dot(params.trapR2.xyz, td),
  ) * params.trapP.x;
  return trapShapeSdf(tl) * ${wgslFloatLit(shapeTrapInvNorm(shapeTrap))} *
    (1.0 + params.trapP.w * f32(stepIdx));`
}
}

// escape-de.ts's shapeTrapValue: min mode clamps the closest weighted
// approach; threshold mode sweeps the first crossing over [0, threshold]
// and reads 1.0 when no candidate ever dipped under the bar (the
// resolver floors the threshold, so the division is total).
fn trapValue(best: f32, cross: f32) -> f32 {
  if (params.trapP.y < 0.5) {
    return clamp(best, 0.0, 1.0);
  }
  if (cross <= ${SHAPE_TRAP_NO_CROSSING}) {
    return 1.0;
  }
  return clamp(cross / params.trapP.z, 0.0, 1.0);
}

`
    : "";
  const condensationHelperText = condensationShapes
    ? `${condensationShapes
        .map((shape, i) =>
          shapeSdfSource(shape, "wgsl", `condensationShape${i}`, {
            meshIndex,
          }),
        )
        .join("\n")}
struct CondensationHit {
  distance: f32,
  shade: i32,
}

fn condensationShapeSdf(selector: u32, p: vec3f) -> f32 {
  switch selector {
${condensationShapes
  .map(
    (_, i) => `    case ${i}u: {
      return condensationShape${i}(p);
    }`,
  )
  .join("\n")}
    default: {
      return 1e30;
    }
  }
}

fn condensationDistance(q: ${core4 ? "vec4f" : "vec3f"}${
        chaos ? ", currentState: u32" : ""
      }) -> CondensationHit {
  var best = 1e30;
  var shade = 0;
  for (var e = 0u; e < params.condEmitterCount; e++) {
    let m = maps[params.mapCount${schedule ? " + params.scheduleMapCount" : ""} + e];
${
  chaos
    ? `    if (!chaosAllows(u32(m.p0.y), currentState)) {
      continue;
    }
`
    : ""
}
    let local = ${core4 ? "mapApply4(m, q)" : "mapApply(m, q)"};
    let shapeDistance = condensationShapeSdf(u32(m.p0.z), local.xyz);
    let embeddedDistance = ${
      core4
        ? "length(vec2f(max(shapeDistance, 0.0), local.w))"
        : "shapeDistance"
    };
    let d = m.p0.x * embeddedDistance;
    if (d < best) {
      best = d;
      shade = i32(m.p0.y);
    }
  }
  return CondensationHit(best, shade);
}

fn condensationTerm(q: ${core4 ? "vec4f" : "vec3f"}, scale: f32, depth: u32${
        chaos ? ", currentState: u32" : ""
      }) -> f32 {
${
  schedule
    ? `  if (depth < params.scheduleDepth) {
    return 1e30;
  }
  let aDepth = depth - params.scheduleDepth;
`
    : ""
}  if (${schedule ? "aDepth" : "depth"} < params.condDepthMin || ${schedule ? "aDepth" : "depth"} > params.condDepthMax) {
    return 1e30;
  }
  return scale * ${wgslFloatLit(SHAPE_MARCH_SAFETY)} * condensationDistance(q${
    chaos ? ", currentState" : ""
  }).distance;
}
${
  mode === "shade"
    ? `
fn condensationTermHit(q: ${core4 ? "vec4f" : "vec3f"}, scale: f32, depth: u32${
        chaos ? ", currentState: u32" : ""
      }) -> CondensationHit {
${
  schedule
    ? `  if (depth < params.scheduleDepth) {
    return CondensationHit(1e30, -1);
  }
  let aDepth = depth - params.scheduleDepth;
`
    : ""
}  if (${schedule ? "aDepth" : "depth"} < params.condDepthMin || ${schedule ? "aDepth" : "depth"} > params.condDepthMax) {
    return CondensationHit(1e30, -1);
  }
  let hit = condensationDistance(q${chaos ? ", currentState" : ""});
  return CondensationHit(
    scale * ${wgslFloatLit(SHAPE_MARCH_SAFETY)} * hit.distance,
    hit.shade,
  );
}
`
    : ""
}

// Whether a strict descendant of this already-generated child can still
// carry an enabled C0. The call sites pass depth + 1, matching the CPU's
// condensationHasFutureDepth(band, depth + 1) exactly.
fn condensationHasFuture(childDepth: u32) -> bool {
${
  schedule
    ? `  if (childDepth < params.scheduleDepth) {
    return true;
  }
  let aChildDepth = childDepth - params.scheduleDepth;
  return max(aChildDepth + 1u, params.condDepthMin) <= params.condDepthMax;`
    : "  return max(childDepth + 1u, params.condDepthMin) <= params.condDepthMax;"
}
}
`
    : "";
  // Shade-only descents must carry the winning C0 emitter's shade slot,
  // not merely reproduce its distance. A lexical block makes the helper
  // safe to interpolate more than once in one WGSL scope while preserving
  // the strict `<` tie convention of condensationFoldHit in the GLSL path.
  const condensationHitFold = (
    q: string,
    scale: string,
    depth: string,
    best: string,
    state: string,
  ): string =>
    condensationShapes
      ? `    {
      let condensationHit = condensationTermHit(${q}, ${scale}, ${depth}${
        chaos ? `, ${state}` : ""
      });
      if (condensationHit.distance < ${best}) {
        ${best} = condensationHit.distance;
        info.firstChoice = condensationHit.shade;
      }
    }
`
      : "";
  const condensationLiveHitFold = (
    live: string,
    q: string,
    scale: string,
    depth: string,
    best: string,
    state: string,
  ): string =>
    condensationShapes
      ? `    if (${live}) {
${condensationHitFold(q, scale, depth, best, state)}    }
`
      : "";
  // The shadeMaps stride token: under either material feature the buffer is 3
  // vec4f per slot ([0] rgb+trap unchanged, [1]/[2] the shared lanes), so EVERY
  // shadeMaps read site's index gains " * 3" through this one string —
  // the four hit-info trap reads and the shade entry's base-color read.
  // Empty when off, keeping the stride-1 text character-identical; a new
  // read site spelled without the token silently reads a finish lane as
  // a trap index, which is what the emitted-source stride test scans for.
  const shadeStride = material ? " * 3" : "";
  // The 4D tail's VARIANT block (464..575) is declared whenever
  // anything is appended past it, so the shared
  // plane/balloon block lands at ONE offset (576) across every 4D core —
  // the 3D `lens || balloon || groundPlane` rule one dimension up. The
  // packer zero-fills it when there is no lens, exactly as 3D's does.
  // The shape trap appends past THAT (escape4's own 624), so it forces the
  // chain too.
  const tail4Block =
    core4 &&
    (lens ||
      balloon ||
      groundPlane ||
      shapeTrap !== null ||
      condensationShapes !== null ||
      schedule !== null ||
      chaos !== null ||
      (tiling !== null && core === "escape4"));
  // The slab's register-pressure probe (option doc).
  // Meaningful only under the 4D DESCENT cores — every other core reads
  // `true` unconditionally, so `opts.slabExt` is never even consulted for
  // them and the inertness is structural, not just documented. The
  // escape4 core is 4D and takes no slab at all (a forward orbit cannot
  // thread a segment), so it sits with the 3D cores here.
  const slabExt = core4 && !forward ? (opts.slabExt ?? true) : true;
  // A 4D fold/lens wrapper must run before the core's affine-final prologue.
  // Both the lens and finite tiling therefore hoist the view lift and hand an
  // already-lifted vec4 into the otherwise shared core body.
  const core4ExternalLift = core4 && (lens || tiling !== null);
  // The maps-load probe (option doc). Same structural inertness
  // as slabExt — only the 4D descent cores ever consult it.
  const mapsUniform = core4 && !forward ? (opts.mapsUniform ?? false) : false;
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
  // An active probe width means shade mode's normal/shadow/AO
  // taps call a second, narrower descent (module doc). Equal widths stay
  // a single descent so the "off" state is byte-identical source. The
  // AFFINE cores ignore it: their ladders have one width and no branch
  // fan to cheapen — the GLSL affine arms carry no probe either — so the
  // taps ride the full descent there. Both FRONTIER cores honor it
  // ("fold4" included).
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
    ...(chaos ? ["fcState", "fnState"] : []),
  ];
  const frontierArrayType = (name: string): "f32" | "u32" =>
    name.endsWith("State") ? "u32" : "f32";
  const frontierDecls = sharedFrontier
    ? arrays
        .map(
          (a) =>
            `var<workgroup> ${a}: array<${frontierArrayType(a)}, ${width * workgroupSize}>;`,
        )
        .join("\n")
    : "";
  const privateDecls = sharedFrontier
    ? ""
    : arrays
        .map((a) => `  var ${a}: array<${frontierArrayType(a)}, ${width}>;`)
        .join("\n");
  // Transposed banking: slot-major stride keeps consecutive threads on
  // consecutive shared words. The private variant ignores `li`.
  const ixBody = sharedFrontier
    ? `return slot * ${workgroupSize}u + li;`
    : `return slot;`;
  // The 3D fold frontier's MODULE-SCOPE storage and its index helper.
  // No other core declares either — the affine ladders' four chains live
  // in scalars, the two forward loops have no frontier concept, and
  // fold4's frontier is function-scope private by construction, declared
  // inside its own body — which is also why none of them needs a
  // workgroup budget at any `sharedFrontier` ({@link
  // surfaceGpuWorkgroupBytes}).
  const frontierBlock =
    core !== "fold"
      ? ""
      : `
${frontierDecls}

fn frontierIx(slot: u32, li: u32) -> u32 {
  ${ixBody}
}`;

  // "pose" (the default) keeps the march arm's bench-baseline bytes;
  // "unproject" swaps only the ray derivation + dither (module doc).
  const unproject = mode === "march" && opts.rays === "unproject";
  // march and shade share the ray-state I/O. march "unproject" adds the
  // ShadeParams block (binding 4) it reads rays and dither from — nothing
  // else — plus the hash2 helper; mode "shade" adds the full shading
  // interface on top (bindings 4-9, module doc), no hash2 (no dither).
  const rayIo = `
@group(0) @binding(2) var<storage, read> activeList: array<u32>;
@group(0) @binding(3) var<storage, read_write> states: array<vec4f>;`;
  // The march's status side-channel, one u32 per ACTIVE-LIST
  // SLOT. Binding 5 whether or not the "unproject" arm claimed 4 for
  // ShadeParams, so one host layout serves both march arms.
  const statusIo = statusOut
    ? `
@group(0) @binding(5) var<storage, read_write> statusOut: array<u32>;`
    : "";
  // The ShadeParams struct, shared by march "unproject" and shade. Its
  // calibration member exists ONLY under shade mode + the pattern gate
  // (module doc): a pattern-enabled MARCH kernel's text must stay
  // byte-identical, and the march never reads the member — the host binds
  // one 240-byte buffer to both pipelines of a patterned session, and a
  // struct never reads past its own size.
  const shadePatternCalibrationMember =
    mode === "shade" && pattern
      ? `
  // The pattern calibration quartet (ringsLow, ringsInvSpan, sheetsLow,
  // sheetsInvSpan), at 224 — the pattern arm's native-carrier clamp
  // (GLSL uPatternCalibration order). Declared ONLY under shade + the
  // pattern gate: it closes the struct at 240 there
  // (SURFACE_GPU_SHADE_PATTERN_BYTES), while every other kernel's struct
  // still ends at 224, byte for byte.
  patternCalibration: vec4f,`
      : "";
  const shadeParamsIo = (patternMember: string): string => `

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
  envStrength: f32,
  bgOffset: vec2f,
  bgExtent: vec2f,
  bgCenter: vec2f,
  bgScale: vec2f,
  bgShape: u32,
  // The balloon echo's tint pair, declared UNCONDITIONALLY — a
  // uniform struct is one layout across every kernel, and only a balloon
  // shade entry reads it. WGSL lands the vec3f at 208 (AlignOf 16 past
  // bgShape's 196), the f32 at 220, closing the struct at 224.
  balloonTint: vec3f,
  balloonTintStrength: f32,${patternMember}
}

@group(0) @binding(4) var<uniform> shade: ShadeParams;`;
  const balloonLutIo =
    mode === "shade" && balloon
      ? `
@group(0) @binding(10) var balloonLutTex: texture_2d<f32>;`
      : "";
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
          ? `${rayIo}${shadeParamsIo("")}${statusIo}${hash2Io}`
          : `${rayIo}${statusIo}`
        : `${rayIo}${shadeParamsIo(shadePatternCalibrationMember)}${balloonLutIo}
@group(0) @binding(5) var<storage, read> shadeMaps: array<vec4f>;
@group(0) @binding(6) var<storage, read_write> colorOut: array<u32>;
@group(0) @binding(7) var lutTex: texture_2d<f32>;
@group(0) @binding(8) var lutSamp: sampler;
@group(0) @binding(9) var<storage, read_write> layerOut: array<u32>;`;

  // March-arm interpolation points, so the "pose" bench baseline stays
  // byte-identical while "unproject" swaps in the GLSL tracer's ray.
  const marchRd = unproject
    ? `  // The sub-pixel sample position, shade.pixelJitter, in place
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
    // coordinate so supersampling's passes do not all share one
    // start offset — at the default centre this is the shipped input.
    if ((shade.flags & 1u) != 0u) {
      t += hash2(vec2f(f32(px) + sub.x, f32(py) + sub.y)) *
        shade.tracePixelEps * max(t, 1.0);
    }`
    : "";

  // The lattice carrier's content radius — the SAME estimator authority
  // expression the mandatory ball max reads (the module doc's
  // guard rule): inverse cores use the full visible radius, forward cores
  // the bailout marching ball. The carrier's outer radius is the
  // PROVISIONAL presentation multiplier times that same authority.
  const latticeRadiusExpr = core4
    ? forward
      ? "params.boundingRadius"
      : "params.visRadius4"
    : forward
      ? "params.boundingRadius"
      : "params.visibleRadius";
  // The 4D slab coordinate needs the inverse rotor's y row. The packed
  // rotorInv rows ARE the inverse rotor's rows (rotorInvApply4 applies
  // them), so the y row is rotorInvR1 itself — never an assembled column:
  // the GLSL arm assembles across columns because its mat4 is
  // column-indexed; here the row fields already are rows.
  const latticeCarrierArgs = core4
    ? `ro, rd, params.w0, params.rotorInvR1, ${latticeRadiusExpr}, params.tilingPresentationR`
    : `ro, rd, ${latticeRadiusExpr}, params.tilingPresentationR`;
  const latticeContainsCall = (p: string): string =>
    core4
      ? `latticePresentationContains(${p}, params.w0, params.rotorInvR1, ${latticeRadiusExpr}, params.tilingPresentationR)`
      : `latticePresentationContains(${p}, ${latticeRadiusExpr}, params.tilingPresentationR)`;

  // Hit-info descent bodies: one per core, selected
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
  var info = SurfaceHitInfo(0, 0.0, 1.0, 1.0, 0.0${source4CtorArg}${trapCtorArg}${tilingCtorArg});
  var trapAcc = 0.0;
  var trapNorm = 0.0;
  var trapW = 1.0;
  var chQ = q;
  var chScale = 1.0;
  var chFloor = 0.0;
${chaos ? "  var chState = CHAOS_WILDCARD;\n" : ""}
  var live = true;
  let R = params.boundingRadius;
${condensationShapes ? "  var condensationBest = 1e30;\n" : ""}  for (var depth = 0u; depth < params.maxDepth; depth++) {
    if (!live) {
      break;
    }
${condensationHitFold("chQ", "chScale", "depth", "condensationBest", "chState")}    var lbKey = 1e30;
    var lbMap = 0u;
    var lbR = 0.0;
    var lbAbsY = 0.0;
    var lbQ = vec3f(0.0);
    var lbScale = 1.0;
    var lbFloor = 0.0;
${chaos ? "    var lbState = CHAOS_WILDCARD;\n" : ""}
    let pScale = chScale;
    let pFloor = chFloor;
${chaos ? "    let pState = chState;\n" : ""}
    var sQ = chQ;
    for (var k = 0u; k < params.symOrder; k++) {
      if (k > 0u) {
        sQ = stepSector(sQ);
      }
      for (var j = 0u; j < params.mapCount; j++) {
${
  chaos
    ? `        if (!chaosAllows(j, pState)) {
          continue;
        }
`
    : ""
}
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
${chaos ? "          let childState = chaosChildState(depth, j);\n" : ""}
${condensationHitFold(
  "img",
  "pScale * branchSigma",
  "depth + 1u",
  "condensationBest",
  "childState",
)}          var candFloor = pFloor;
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
${chaos ? "            lbState = childState;\n" : ""}
          }
        }
      }
    }
    if (lbKey >= 1e29) {
      break;
    }
    if (depth == 0u${
      condensationShapes ? " && lbScale * (lbR - R) < condensationBest" : ""
    }) {
      info.firstChoice = i32(lbMap);
    }
    trapAcc += trapW * shadeMaps[lbMap${shadeStride}].w;
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
${chaos ? "      chState = lbState;\n" : ""}
    }
  }
${
  condensationShapes
    ? `  if (live) {
${condensationHitFold("chQ", "chScale", "params.maxDepth", "condensationBest", "chState")}  }
`
    : ""
}  info.trap = select(0.0, trapAcc / trapNorm, trapNorm > 0.0);
  info.rings = clamp(info.rings, 0.0, 1.0);
  info.sheets = clamp(info.sheets, 0.0, 1.0);
${pattern ? `  info.source4 = vec4f(q, 0.0);` : ""}
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
// overload): the width-4 ladder's TRAJECTORY — top-2 beam + rank-3/4
// validity spill, sector-major enumeration — feeding colors
// only (the value side never steers it; see the generator comment).
fn surfaceDEHitInfo(p: vec3f, li: u32) -> SurfaceHitInfo {
  let q = vec3f(
    dot(params.finalM0, p) + params.finalT0,
    dot(params.finalM1, p) + params.finalT1,
    dot(params.finalM2, p) + params.finalT2,
  );
  var info = SurfaceHitInfo(0, 0.0, 1.0, 1.0, 0.0${source4CtorArg}${trapCtorArg}${tilingCtorArg});
  var trapAcc = 0.0;
  var trapNorm = 0.0;
  var trapW = 1.0;
  let R = params.boundingRadius;
${
  condensationShapes
    ? `  var best = 1e30;
  var aR = length(q - params.boundCenter);
`
    : ""
}  var aQ = q;
  var aScale = 1.0;
${chaos ? "  var aState = CHAOS_WILDCARD;\n" : ""}
  var aLive = true;
  var bQ = vec3f(0.0);
  var bScale = 1.0;
${chaos ? "  var bState = CHAOS_WILDCARD;\n" : ""}
${condensationShapes ? "  var bR = 0.0;\n" : ""}  var bLive = false;
  var v1Q = vec3f(0.0);
  var v1Scale = 1.0;
${chaos ? "  var v1State = CHAOS_WILDCARD;\n" : ""}
  var v1Live = false;
  var v2Q = vec3f(0.0);
  var v2Scale = 1.0;
${chaos ? "  var v2State = CHAOS_WILDCARD;\n" : ""}
  var v2Live = false;
  for (var depth = 0u; depth < params.maxDepth; depth++) {
    if (!aLive && !bLive && !v1Live && !v2Live) {
      break;
    }
${
  condensationShapes
    ? `${condensationLiveHitFold("aLive", "aQ", "aScale", "depth", "best", "aState")}${condensationLiveHitFold("bLive", "bQ", "bScale", "depth", "best", "bState")}${condensationLiveHitFold("v1Live", "v1Q", "v1Scale", "depth", "best", "v1State")}${condensationLiveHitFold("v2Live", "v2Q", "v2Scale", "depth", "best", "v2State")}    let futureCondensation = condensationHasFuture(depth + 1u);
`
    : ""
}    var c1Key = 1e30;
    var c1Q = vec3f(0.0);
    var c1Scale = 1.0;
    var c1R = 0.0;
${condensationShapes ? "    var c1Cert = 0.0;\n" : ""}    var c1Map = 0u;
${chaos ? "    var c1State = CHAOS_WILDCARD;\n" : ""}
    var c2Key = 1e30;
    var c2Q = vec3f(0.0);
    var c2Scale = 1.0;
    var c2R = 0.0;
${condensationShapes ? "    var c2Cert = 0.0;\n" : ""}    var c3Key = 1e30;
${chaos ? "    var c2State = CHAOS_WILDCARD;\n" : ""}
    var c3Q = vec3f(0.0);
    var c3Scale = 1.0;
    var c3R = 0.0;
${condensationShapes ? "    var c3Cert = 0.0;\n" : ""}    var c4Key = 1e30;
${chaos ? "    var c3State = CHAOS_WILDCARD;\n" : ""}
    var c4Q = vec3f(0.0);
    var c4Scale = 1.0;
    var c4R = 0.0;
${condensationShapes ? "    var c4Cert = 0.0;\n" : ""}${chaos ? "    var c4State = CHAOS_WILDCARD;\n" : ""}    for (var c = 0u; c < 4u; c++) {
      var pQ = vec3f(0.0);
      var pScale = 1.0;
${chaos ? "      var pState = CHAOS_WILDCARD;\n" : ""}
      if (c == 0u) {
        if (!aLive) {
          continue;
        }
        pQ = aQ;
        pScale = aScale;
${chaos ? "        pState = aState;\n" : ""}
      } else if (c == 1u) {
        if (!bLive) {
          continue;
        }
        pQ = bQ;
        pScale = bScale;
${chaos ? "        pState = bState;\n" : ""}
      } else if (c == 2u) {
        if (!v1Live) {
          continue;
        }
        pQ = v1Q;
        pScale = v1Scale;
${chaos ? "        pState = v1State;\n" : ""}
      } else {
        if (!v2Live) {
          continue;
        }
        pQ = v2Q;
        pScale = v2Scale;
${chaos ? "        pState = v2State;\n" : ""}
      }
      // Sector sweep: sector-major enumeration, the expanded
      // slot list's order, so ladder tie-breaks match the oracle's.
      var sQ = pQ;
      for (var k = 0u; k < params.symOrder; k++) {
        if (k > 0u) {
          sQ = stepSector(sQ);
        }
        for (var j = 0u; j < params.mapCount; j++) {
${
  chaos
    ? `          if (!chaosAllows(j, pState)) {
            continue;
          }
`
    : ""
}
          let m = maps[j];
          let img = mapApply(m, sQ);
          let r = length(img - params.boundCenter);
          let key = pScale * (r - R);
          let childScale = pScale * m.p0.x;
${chaos ? "          let childState = chaosChildState(depth, j);\n" : ""}${condensationHitFold("img", "childScale", "depth + 1u", "best", "childState")}${condensationShapes ? "          let cert = childScale * (r - R);\n" : ""}          // Top-2 insert-shift; the displaced tuple (or the candidate
          // itself) spills into the rank-3/4 ladder. Certificates are
          // value-side and trimmed; radii flow through — the spill
          // ladder routes on them.
          var eKey = key;
          var eQ = img;
          var eScale = childScale;
          var eR = r;
${chaos ? "          var eState = childState;\n" : ""}
${condensationShapes ? "          var eCert = cert;\n" : ""}          if (key < c1Key) {
            eKey = c2Key;
            eQ = c2Q;
            eScale = c2Scale;
            eR = c2R;
${chaos ? "            eState = c2State;\n" : ""}
${condensationShapes ? "            eCert = c2Cert;\n" : ""}            c2Key = c1Key;
            c2Q = c1Q;
            c2Scale = c1Scale;
            c2R = c1R;
${chaos ? "            c2State = c1State;\n" : ""}
${condensationShapes ? "            c2Cert = c1Cert;\n" : ""}            c1Key = key;
            c1Q = img;
            c1Scale = childScale;
            c1R = r;
${chaos ? "            c1State = childState;\n" : ""}
${condensationShapes ? "            c1Cert = cert;\n" : ""}            c1Map = j;
          } else if (key < c2Key) {
            eKey = c2Key;
            eQ = c2Q;
            eScale = c2Scale;
            eR = c2R;
${chaos ? "            eState = c2State;\n" : ""}
${condensationShapes ? "            eCert = c2Cert;\n" : ""}            c2Key = key;
            c2Q = img;
            c2Scale = childScale;
            c2R = r;
${chaos ? "            c2State = childState;\n" : ""}
${condensationShapes ? "            c2Cert = cert;\n" : ""}          }
          if (eKey < c3Key) {
${
  condensationShapes
    ? `            let tKey = c4Key;
            let tQ = c4Q;
            let tScale = c4Scale;
            let tR = c4R;
${chaos ? "            let tState = c4State;\n" : ""}
            let tCert = c4Cert;
`
    : ""
}            c4Key = c3Key;
            c4Q = c3Q;
            c4Scale = c3Scale;
            c4R = c3R;
${chaos ? "            c4State = c3State;\n" : ""}
${condensationShapes ? "            c4Cert = c3Cert;\n" : ""}            c3Key = eKey;
            c3Q = eQ;
            c3Scale = eScale;
            c3R = eR;
${chaos ? "            c3State = eState;\n" : ""}
${
  condensationShapes
    ? `            c3Cert = eCert;
            eKey = tKey;
            eQ = tQ;
            eScale = tScale;
            eR = tR;
${chaos ? "            eState = tState;\n" : ""}
            eCert = tCert;
`
    : ""
}          } else if (eKey < c4Key) {
${
  condensationShapes
    ? `            let tKey = c4Key;
            let tQ = c4Q;
            let tScale = c4Scale;
            let tR = c4R;
${chaos ? "            let tState = c4State;\n" : ""}
            let tCert = c4Cert;
`
    : ""
}            c4Key = eKey;
            c4Q = eQ;
            c4Scale = eScale;
            c4R = eR;
${chaos ? "            c4State = eState;\n" : ""}
${
  condensationShapes
    ? `            c4Cert = eCert;
            eKey = tKey;
            eQ = tQ;
            eScale = tScale;
            eR = tR;
${chaos ? "            eState = tState;\n" : ""}
            eCert = tCert;
`
    : ""
}          }
${
  condensationShapes
    ? `          if (eR > R && eCert < best) {
            best = min(best, refinedCert(eQ, eR, eScale, depth + 1u${chaos ? ", eState" : ""}));
          } else if (eKey < 1e30 && futureCondensation && eR <= R) {
            best = min(best, eScale * (eR - R));
          }
`
    : ""
}        }
      }
    }
    if (depth == 0u${condensationShapes ? " && c1Cert < best" : ""}) {
      info.firstChoice = i32(c1Map);
    }
    trapAcc += trapW * shadeMaps[c1Map${shadeStride}].w;
    trapNorm += trapW;
    trapW *= shade.colorSpeed;
    info.rings = min(info.rings, c1R / R);
    info.sheets = min(info.sheets, abs(c1Q.y) / R);
    aLive = false;
    bLive = false;
    v1Live = false;
    v2Live = false;
    if (c1Key < 1e29) {
${
  condensationShapes
    ? `      if (c1R > params.escapeRadius) {
        best = min(best, c1Cert);
      } else {
`
    : `      if (c1R <= params.escapeRadius) {
`
}        aQ = c1Q;
        aScale = c1Scale;
${chaos ? "        aState = c1State;\n" : ""}
${condensationShapes ? "        aR = c1R;\n" : ""}        aLive = true;
      }
    }
    if (c2Key < 1e29) {
${
  condensationShapes
    ? `      if (c2R > params.escapeRadius) {
        best = min(best, c2Cert);
      } else {
`
    : `      if (c2R <= params.escapeRadius) {
`
}        bQ = c2Q;
        bScale = c2Scale;
${chaos ? "        bState = c2State;\n" : ""}
${condensationShapes ? "        bR = c2R;\n" : ""}        bLive = true;
      }
    }
    if (c3Key < 1e29) {
${
  condensationShapes
    ? `      if (c3R > R) {
        if (c3Cert < best) {
          best = min(best, refinedCert(c3Q, c3R, c3Scale, depth + 1u${chaos ? ", c3State" : ""}));
        }
      } else {
`
    : `      if (c3R <= R) {
`
}        v1Q = c3Q;
        v1Scale = c3Scale;
${chaos ? "        v1State = c3State;\n" : ""}
        v1Live = true;
      }
    }
    if (c4Key < 1e29) {
${
  condensationShapes
    ? `      if (c4R > R) {
        if (c4Cert < best) {
          best = min(best, refinedCert(c4Q, c4R, c4Scale, depth + 1u${chaos ? ", c4State" : ""}));
        }
      } else {
`
    : `      if (c4R <= R) {
`
}        v2Q = c4Q;
        v2Scale = c4Scale;
${chaos ? "        v2State = c4State;\n" : ""}
        v2Live = true;
      }
    }
  }
${
  condensationShapes
    ? `${condensationLiveHitFold("aLive", "aQ", "aScale", "params.maxDepth", "best", "aState")}${condensationLiveHitFold("bLive", "bQ", "bScale", "params.maxDepth", "best", "bState")}${condensationLiveHitFold("v1Live", "v1Q", "v1Scale", "params.maxDepth", "best", "v1State")}${condensationLiveHitFold("v2Live", "v2Q", "v2Scale", "params.maxDepth", "best", "v2State")}  if (aLive) {
    best = min(best, aScale * (aR - R));
  }
  if (bLive) {
    best = min(best, bScale * (bR - R));
  }
`
    : ""
}  info.trap = select(0.0, trapAcc / trapNorm, trapNorm > 0.0);
  info.rings = clamp(info.rings, 0.0, 1.0);
  info.sheets = clamp(info.sheets, 0.0, 1.0);
${pattern ? `  info.source4 = vec4f(q, 0.0);` : ""}
  return info;
}`;

  // THE 4D CORES' PROLOGUE — one text, four bodies (the affine4 ladder,
  // the fold4 frontier and both hit-info twins), for renameToProbe's
  // reason: view -> attractor frame (the 4D GLSL's uInvRotor line), the
  // slice-thickness slab seed, then the affine final lens.
  //
  // Under the LENS the wrapper owns that lift instead
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
  // under a slab), so the core opens on the 4D point it would
  // otherwise derive. The affine final lens below is the packer's
  // IDENTITY under a foldFinal, left in place so the rest of this body
  // stays the no-lens body's own text.
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

  // 4D hit-info: surface-material-4d.ts's shading
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
// width-4 ladder's TRAJECTORY — top-2 beam + rank-3/4 validity
// spill, sector-major enumeration, one vec4f half-extent per register —
// behind the value body's view lift, feeding colors only
// (the value side never steers it; see the generator comment).
`
      : `// 4D hit-info descent (surface-material-4d.ts's shading overload): the
// width-4 ladder's TRAJECTORY — top-2 beam + rank-3/4 validity
// spill, sector-major enumeration — behind the value body's view lift,
// feeding colors only (the value side never steers it; see the
// generator comment). Under slabExt=false (the register-pressure probe):
// no half-extent registers — every radius below is a plain length.
`
  }fn surfaceDEHitInfo(${core4Params(
    "p",
    slabExt,
    core4ExternalLift,
  )}, li: u32) -> SurfaceHitInfo {
${lift4Text("p", "", slabExt, core4ExternalLift)}  var info = SurfaceHitInfo(0, 0.0, 1.0, 1.0, 0.0${source4CtorArg}${trapCtorArg}${tilingCtorArg});
  var trapAcc = 0.0;
  var trapNorm = 0.0;
  var trapW = 1.0;
  let R = params.boundingRadius;
${
  condensationShapes
    ? `  var best = 1e30;
  var aR = ${slabExt ? "segmentRadius4(q, ext)" : "length(q)"};
`
    : ""
}  var aQ = q;
${
  slabExt
    ? `  var aExt = ext;
`
    : ``
}  var aScale = 1.0;
${chaos ? "  var aState = CHAOS_WILDCARD;\n" : ""}
  var aLive = true;
  var bQ = vec4f(0.0);
${
  slabExt
    ? `  var bExt = vec4f(0.0);
`
    : ``
}  var bScale = 1.0;
${chaos ? "  var bState = CHAOS_WILDCARD;\n" : ""}
${condensationShapes ? "  var bR = 0.0;\n" : ""}  var bLive = false;
  var v1Q = vec4f(0.0);
${
  slabExt
    ? `  var v1Ext = vec4f(0.0);
`
    : ``
}  var v1Scale = 1.0;
${chaos ? "  var v1State = CHAOS_WILDCARD;\n" : ""}
  var v1Live = false;
  var v2Q = vec4f(0.0);
${
  slabExt
    ? `  var v2Ext = vec4f(0.0);
`
    : ``
}  var v2Scale = 1.0;
${chaos ? "  var v2State = CHAOS_WILDCARD;\n" : ""}
  var v2Live = false;
  for (var depth = 0u; depth < params.maxDepth; depth++) {
    if (!aLive && !bLive && !v1Live && !v2Live) {
      break;
    }
${
  condensationShapes
    ? `${condensationLiveHitFold("aLive", "aQ", "aScale", "depth", "best", "aState")}${condensationLiveHitFold("bLive", "bQ", "bScale", "depth", "best", "bState")}${condensationLiveHitFold("v1Live", "v1Q", "v1Scale", "depth", "best", "v1State")}${condensationLiveHitFold("v2Live", "v2Q", "v2Scale", "depth", "best", "v2State")}    let futureCondensation = condensationHasFuture(depth + 1u);
`
    : ""
}    var c1Key = 1e30;
    var c1Q = vec4f(0.0);
${
  slabExt
    ? `    var c1Ext = vec4f(0.0);
`
    : ``
}    var c1Scale = 1.0;
    var c1R = 0.0;
${condensationShapes ? "    var c1Cert = 0.0;\n" : ""}    var c1Map = 0u;
${chaos ? "    var c1State = CHAOS_WILDCARD;\n" : ""}
    var c2Key = 1e30;
    var c2Q = vec4f(0.0);
${
  slabExt
    ? `    var c2Ext = vec4f(0.0);
`
    : ``
}    var c2Scale = 1.0;
    var c2R = 0.0;
${condensationShapes ? "    var c2Cert = 0.0;\n" : ""}    var c3Key = 1e30;
${chaos ? "    var c2State = CHAOS_WILDCARD;\n" : ""}
    var c3Q = vec4f(0.0);
${
  slabExt
    ? `    var c3Ext = vec4f(0.0);
`
    : ``
}    var c3Scale = 1.0;
    var c3R = 0.0;
${condensationShapes ? "    var c3Cert = 0.0;\n" : ""}    var c4Key = 1e30;
${chaos ? "    var c3State = CHAOS_WILDCARD;\n" : ""}
    var c4Q = vec4f(0.0);
${
  slabExt
    ? `    var c4Ext = vec4f(0.0);
`
    : ``
}    var c4Scale = 1.0;
    var c4R = 0.0;
${condensationShapes ? "    var c4Cert = 0.0;\n" : ""}${chaos ? "    var c4State = CHAOS_WILDCARD;\n" : ""}    for (var c = 0u; c < 4u; c++) {
      var pQ = vec4f(0.0);
${
  slabExt
    ? `      var pExt = vec4f(0.0);
`
    : ``
}      var pScale = 1.0;
${chaos ? "      var pState = CHAOS_WILDCARD;\n" : ""}
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
${chaos ? "        pState = aState;\n" : ""}
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
${chaos ? "        pState = bState;\n" : ""}
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
${chaos ? "        pState = v1State;\n" : ""}
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
${chaos ? "        pState = v2State;\n" : ""}
      }
${
  slabExt
    ? `      // Sector sweep: sector-major enumeration, the
      // expansion's order, so ladder tie-breaks match the oracle's; the
      // half-extent turns through the same backward step (an isometry
      // maps segments to segments).
`
    : `      // Sector sweep: sector-major enumeration, the
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
${
  chaos
    ? `          if (!chaosAllows(j, pState)) {
            continue;
          }
`
    : ""
}
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
${chaos ? "          let childState = chaosChildState(depth, j);\n" : ""}
${
  condensationShapes
    ? `${condensationHitFold("img", "childScale", "depth + 1u", "best", "childState")}          let cert = childScale * (r - R);
`
    : ""
}${
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
${chaos ? "          var eState = childState;\n" : ""}
${condensationShapes ? "          var eCert = cert;\n" : ""}          if (key < c1Key) {
            eKey = c2Key;
            eQ = c2Q;
${
  slabExt
    ? `            eExt = c2Ext;
`
    : ``
}            eScale = c2Scale;
            eR = c2R;
${chaos ? "            eState = c2State;\n" : ""}
${condensationShapes ? "            eCert = c2Cert;\n" : ""}            c2Key = c1Key;
            c2Q = c1Q;
${
  slabExt
    ? `            c2Ext = c1Ext;
`
    : ``
}            c2Scale = c1Scale;
            c2R = c1R;
${chaos ? "            c2State = c1State;\n" : ""}
${condensationShapes ? "            c2Cert = c1Cert;\n" : ""}            c1Key = key;
            c1Q = img;
${
  slabExt
    ? `            c1Ext = imgExt;
`
    : ``
}            c1Scale = childScale;
            c1R = r;
${chaos ? "            c1State = childState;\n" : ""}
${condensationShapes ? "            c1Cert = cert;\n" : ""}            c1Map = j;
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
${chaos ? "            eState = c2State;\n" : ""}
${condensationShapes ? "            eCert = c2Cert;\n" : ""}            c2Key = key;
            c2Q = img;
${
  slabExt
    ? `            c2Ext = imgExt;
`
    : ``
}            c2Scale = childScale;
            c2R = r;
${chaos ? "            c2State = childState;\n" : ""}
${condensationShapes ? "            c2Cert = cert;\n" : ""}          }
          if (eKey < c3Key) {
${
  condensationShapes
    ? `            let tKey = c4Key;
            let tQ = c4Q;
${slabExt ? "            let tExt = c4Ext;\n" : ""}            let tScale = c4Scale;
            let tR = c4R;
${chaos ? "            let tState = c4State;\n" : ""}
            let tCert = c4Cert;
`
    : ""
}            c4Key = c3Key;
            c4Q = c3Q;
${
  slabExt
    ? `            c4Ext = c3Ext;
`
    : ``
}            c4Scale = c3Scale;
            c4R = c3R;
${chaos ? "            c4State = c3State;\n" : ""}
${condensationShapes ? "            c4Cert = c3Cert;\n" : ""}            c3Key = eKey;
            c3Q = eQ;
${
  slabExt
    ? `            c3Ext = eExt;
`
    : ``
}            c3Scale = eScale;
            c3R = eR;
${chaos ? "            c3State = eState;\n" : ""}
${
  condensationShapes
    ? `            c3Cert = eCert;
            eKey = tKey;
            eQ = tQ;
${slabExt ? "            eExt = tExt;\n" : ""}            eScale = tScale;
            eR = tR;
${chaos ? "            eState = tState;\n" : ""}
            eCert = tCert;
`
    : ""
}          } else if (eKey < c4Key) {
${
  condensationShapes
    ? `            let tKey = c4Key;
            let tQ = c4Q;
${slabExt ? "            let tExt = c4Ext;\n" : ""}            let tScale = c4Scale;
            let tR = c4R;
${chaos ? "            let tState = c4State;\n" : ""}
            let tCert = c4Cert;
`
    : ""
}            c4Key = eKey;
            c4Q = eQ;
${
  slabExt
    ? `            c4Ext = eExt;
`
    : ``
}            c4Scale = eScale;
            c4R = eR;
${chaos ? "            c4State = eState;\n" : ""}
${
  condensationShapes
    ? `            c4Cert = eCert;
            eKey = tKey;
            eQ = tQ;
${slabExt ? "            eExt = tExt;\n" : ""}            eScale = tScale;
            eR = tR;
${chaos ? "            eState = tState;\n" : ""}
            eCert = tCert;
`
    : ""
}          }
${
  condensationShapes
    ? `          if (eR > R && eCert < best) {
            best = min(best, refinedCert(eQ, ${slabExt ? "eExt, " : ""}eR, eScale, depth + 1u${chaos ? ", eState" : ""}));
          } else if (eKey < 1e30 && futureCondensation && eR <= R) {
            best = min(best, eScale * (eR - R));
          }
`
    : ""
}        }
      }
    }
    if (depth == 0u${condensationShapes ? " && c1Cert < best" : ""}) {
      info.firstChoice = i32(c1Map);
    }
    trapAcc += trapW * shadeMaps[c1Map${shadeStride}].w;
    trapNorm += trapW;
    trapW *= shade.colorSpeed;
${
  slabExt
    ? `    // Under a slab query rings rides the SEGMENT radius (c1R is one);
    // sheets keeps reading the segment's CENTRE y by design — a shading
    // extra, and a coordinate is what the plane trap wants.
`
    : ``
}    info.rings = min(info.rings, c1R / R);
    info.sheets = min(info.sheets, abs(c1Q.y) / R);
${
  slabExt
    ? `    // Overwritten, not min-tracked: the deepest level's winner is the
    // honest place along the slab segment (the GLSL twin's rule).
    info.sStar = segmentS4(c1Q, c1Ext);
`
    : ``
}    aLive = false;
    bLive = false;
    v1Live = false;
    v2Live = false;
    if (c1Key < 1e29) {
${
  condensationShapes
    ? `      if (c1R > params.escapeRadius) {
        best = min(best, c1Cert);
      } else {
`
    : `      if (c1R <= params.escapeRadius) {
`
}        aQ = c1Q;
${
  slabExt
    ? `        aExt = c1Ext;
`
    : ``
}        aScale = c1Scale;
${chaos ? "        aState = c1State;\n" : ""}
${condensationShapes ? "        aR = c1R;\n" : ""}        aLive = true;
      }
    }
    if (c2Key < 1e29) {
${
  condensationShapes
    ? `      if (c2R > params.escapeRadius) {
        best = min(best, c2Cert);
      } else {
`
    : `      if (c2R <= params.escapeRadius) {
`
}        bQ = c2Q;
${
  slabExt
    ? `        bExt = c2Ext;
`
    : ``
}        bScale = c2Scale;
${chaos ? "        bState = c2State;\n" : ""}
${condensationShapes ? "        bR = c2R;\n" : ""}        bLive = true;
      }
    }
    if (c3Key < 1e29) {
${
  condensationShapes
    ? `      if (c3R > R) {
        if (c3Cert < best) {
          best = min(best, refinedCert(c3Q, ${slabExt ? "c3Ext, " : ""}c3R, c3Scale, depth + 1u${chaos ? ", c3State" : ""}));
        }
      } else {
`
    : `      if (c3R <= R) {
`
}        v1Q = c3Q;
${
  slabExt
    ? `        v1Ext = c3Ext;
`
    : ``
}        v1Scale = c3Scale;
${chaos ? "        v1State = c3State;\n" : ""}
        v1Live = true;
      }
    }
    if (c4Key < 1e29) {
${
  condensationShapes
    ? `      if (c4R > R) {
        if (c4Cert < best) {
          best = min(best, refinedCert(c4Q, ${slabExt ? "c4Ext, " : ""}c4R, c4Scale, depth + 1u${chaos ? ", c4State" : ""}));
        }
      } else {
`
    : `      if (c4R <= R) {
`
}        v2Q = c4Q;
${
  slabExt
    ? `        v2Ext = c4Ext;
`
    : ``
}        v2Scale = c4Scale;
${chaos ? "        v2State = c4State;\n" : ""}
        v2Live = true;
      }
    }
  }
${
  condensationShapes
    ? `${condensationLiveHitFold("aLive", "aQ", "aScale", "params.maxDepth", "best", "aState")}${condensationLiveHitFold("bLive", "bQ", "bScale", "params.maxDepth", "best", "bState")}${condensationLiveHitFold("v1Live", "v1Q", "v1Scale", "params.maxDepth", "best", "v1State")}${condensationLiveHitFold("v2Live", "v2Q", "v2Scale", "params.maxDepth", "best", "v2State")}  if (aLive) {
    best = min(best, aScale * (aR - R));
  }
  if (bLive) {
    best = min(best, bScale * (bR - R));
  }
`
    : ""
}  info.trap = select(0.0, trapAcc / trapNorm, trapNorm > 0.0);
  info.rings = clamp(info.rings, 0.0, 1.0);
  info.sheets = clamp(info.sheets, 0.0, 1.0);
${pattern && !lens ? `  info.source4 = finalApply4(rotorInvApply4(vec4f(p, params.w0 + info.sStar * params.sliceHalfW)));` : ""}
  return info;
}`;

  // 4D FOLD hit-info descent: the 3D fold twin's
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
// half-extent riding beside the chain point, feeding colors
// only. Branch fans 81/3/243 (foldBranchCount4).
`
      : `// 4D fold hit-info descent (surface-de-4d.ts's descendFold4
// trajectory, the 3D fold hit-info's shape one dimension up): a greedy
// width-1 chain over every (sector, map, branch) triple, feeding colors
// only. Branch fans 81/3/243 (foldBranchCount4). Under slabExt=false
// (the register-pressure probe): no half-extent registers — every radius
// below is a plain length.
`
  }fn surfaceDEHitInfo(${core4Params(
    "p",
    slabExt,
    core4ExternalLift,
  )}, li: u32) -> SurfaceHitInfo {
${lift4Text("p", "", slabExt, core4ExternalLift)}  var info = SurfaceHitInfo(0, 0.0, 1.0, 1.0, 0.0${source4CtorArg}${trapCtorArg}${tilingCtorArg});
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
${chaos ? "  var chState = CHAOS_WILDCARD;\n" : ""}
  var live = true;
  let R = params.boundingRadius;
${condensationShapes ? "  var condensationBest = 1e30;\n" : ""}  for (var depth = 0u; depth < params.maxDepth; depth++) {
    if (!live) {
      break;
    }
${condensationHitFold("chQ", "chScale", "depth", "condensationBest", "chState")}    var lbKey = 1e30;
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
${chaos ? "    var lbState = CHAOS_WILDCARD;\n" : ""}
    let pScale = chScale;
    let pFloor = chFloor;
${chaos ? "    let pState = chState;\n" : ""}
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
${
  chaos
    ? `        if (!chaosAllows(j, pState)) {
          continue;
        }
`
    : ""
}
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
}${chaos ? "          let childState = chaosChildState(depth, j);\n" : ""}${condensationHitFold(
    "img",
    "pScale * branchSigma",
    "depth + 1u",
    "condensationBest",
    "childState",
  )}          var candFloor = pFloor;
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
${chaos ? "            lbState = childState;\n" : ""}
          }
        }
      }
    }
    if (lbKey >= 1e29) {
      break;
    }
    if (depth == 0u${
      condensationShapes ? " && lbScale * (lbR - R) < condensationBest" : ""
    }) {
      info.firstChoice = i32(lbMap);
    }
    trapAcc += trapW * shadeMaps[lbMap${shadeStride}].w;
    trapNorm += trapW;
    trapW *= shade.colorSpeed;
${
  slabExt
    ? `    // Under a slab query rings rides the SEGMENT radius (lbR is one);
    // sheets keeps reading the segment's CENTRE y by design — a shading
    // extra, and a coordinate is what the plane trap wants.
`
    : ``
}    info.rings = min(info.rings, lbR / R);
    info.sheets = min(info.sheets, lbAbsY / R);
${
  slabExt
    ? `    // Overwritten, not min-tracked: the deepest level's winner is the
    // honest place along the slab segment (the GLSL twin's rule).
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
${chaos ? "      chState = lbState;\n" : ""}
    }
  }
${
  condensationShapes
    ? `  if (live) {
${condensationHitFold("chQ", "chScale", "params.maxDepth", "condensationBest", "chState")}  }
`
    : ""
}  info.trap = select(0.0, trapAcc / trapNorm, trapNorm > 0.0);
  info.rings = clamp(info.rings, 0.0, 1.0);
  info.sheets = clamp(info.sheets, 0.0, 1.0);
${pattern && !lens ? `  info.source4 = finalApply4(rotorInvApply4(vec4f(p, params.w0 + info.sStar * params.sliceHalfW)));` : ""}
  return info;
}`;

  // Escape hit-info (the GLSL SURFACE_ESCAPE shading overload, term for
  // term): the same forward orbit with the classic escape-time
  // extras — trap is the CONTINUOUS ESCAPE FRACTION (the
  // canonical Mandelbox palette coordinate), rings/sheets the orbit's
  // closest radial / y-plane approaches — the same trap vocabulary the
  // descent variants feed the shared color sources. firstChoice is
  // always 0 (one map). Colors-only convention (the fold twin's): the
  // GLSL overload also returns the DE, so its dr accumulator is the one
  // value-side term trimmed here.
  const escapeHitInfoText = /* wgsl */ `fn surfaceDEHitInfo(p: vec3f, li: u32) -> SurfaceHitInfo {
  var info = SurfaceHitInfo(0, 0.0, 1.0, 1.0, 0.0${source4CtorArg}${trapCtorArg}${tilingCtorArg});
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
  // And its DEGREE, 0 until a step has run — which is also what a
  // FOLD leaves here, so a fold-only chain reads the constant-factor arm
  // below at every step exactly as it did before.
  var lastPower = 0.0;${trapDecl}
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
    // The FOLD family, GUARDED. The two tests below are
    // exhaustive by NEGATION over {1, 2, 3} alone, so a power kind has to
    // be kept out of them rather than added beside them — kind 4u
    // satisfies both \`!= 2u\` and \`!= 1u\` and would silently run both
    // folds. That hazard is this module's own doc's reason for making the
    // Mandelbulb a sixth CORE rather than a fourth kind; the guard is what
    // makes a fourth and fifth kind safe on the chain core.
    if (kind < 4u) {
      if (kind != 2u) {
        // The link's own AUTHORED box wall — escape-de.ts's foldAxis(t, wall).
        y = clamp(y, vec3f(-L.fold.z), vec3f(L.fold.z)) * 2.0 - y;
      }
      if (kind != 1u) {
        // ...and its own sphere shell, SQUARED on the wire exactly as
        // EscapeLink keeps it: fR2 / clamp(r2, mR2, fR2).
        let f = L.fold.y / clamp(dot(y, y), L.fold.x, L.fold.y);
        y *= f;
      }
    } else if (kind == 4u) {
      // The triplex 8th power — the value body's branch minus its localL,
      // which this colors-only body does not track.
      y = bulbPow8(y, dot(y, y));
    } else {
      // The quaternion square on span{1, i, j}, closed there because the
      // \`v x v\` term drops.
      y = vec3f(y.x * y.x - y.y * y.y - y.z * y.z, 2.0 * y.x * y.y, 2.0 * y.x * y.z);
    }
    v = L.p0.y * y + q;
    r = length(v);
    growth = L.p0.z;
    // The DEGREE of the link that produced this r — 0 for a
    // fold, which is asymptotically affine and has no exponent to
    // multiply.
    lastPower = select(select(0.0, 2.0, kind == 5u), ${BULB_POWER}.0, kind == 4u);
    info.rings = min(info.rings, r / params.boundingRadius);
    info.sheets = min(info.sheets, abs(v.y) / params.boundingRadius);${trapStep(
      "v",
      "i",
    )}
    link++;
    if (link == n) {
      link = 0u;
    }
  }
  // The CONTINUOUS escape count — the GLSL arm's escFrac term for
  // term (see surface-material.ts for why the raw integer reads as confetti).
  // Normalized by params.maxDepth, NOT by the chain's maxDepth * n step
  // budget, which would confine a long chain to the bottom of its palette
  // ramp; the GLSL arm carries the argument.
  //
  // Which interpolant reads the terminal radius depends on the
  // link that produced it. A fold grows by a constant factor, so the
  // ratio of logs linearises it; a power map multiplies the exponent,
  // so the count is \`log(log r / log R) / log d\` — the bulb core's own
  // expression, with the link's degree in place of its 8.
  var escFrac = 0.0;
  if (escapedAt < steps) {
    if (lastPower > 1.0) {
      escFrac = clamp(log(log(r) / log(params.boundingRadius)) / log(lastPower), 0.0, 1.0);
    } else if (growth > 1.0) {
      escFrac = clamp(log(r / params.boundingRadius) / log(growth), 0.0, 1.0);
    }
  }
  info.trap =
    clamp((f32(escapedAt) - escFrac) / f32(params.maxDepth), 0.0, 1.0);
  info.rings = clamp(info.rings, 0.0, 1.0);
  info.sheets = clamp(info.sheets, 0.0, 1.0);${trapFinal}
${pattern ? `  info.source4 = vec4f(p, 0.0);` : ""}
  return info;
}`;

  // Escape4 hit-info: the escape hit-info over vec4f, behind
  // the same lift its value body uses. Every shading quantity is the 3D
  // one's — the continuous escape fraction with its two interpolants,
  // rings and sheets off the orbit's closest radial / y-plane approaches
  // — with the bulb branch gone (the gate refuses a triplex power) and
  // the quaternion square in its FULL form. `sheets` still reads `v.y`:
  // the orbit runs in the ATTRACTOR frame, exactly as the 4D descents'
  // colour sources do.
  const escape4HitInfoText = /* wgsl */ `fn surfaceDEHitInfo(${tiling ? "qIn: vec4f" : "p: vec3f"}, li: u32) -> SurfaceHitInfo {
  var info = SurfaceHitInfo(0, 0.0, 1.0, 1.0, 0.0${source4CtorArg}${trapCtorArg}${tilingCtorArg});
  let q = foldQuerySector4(${tiling ? "qIn" : "liftEscape4(p)"});
  var v = q;
  var r = length(v);
  let n = params.mapCount;
  let steps = params.maxDepth * n;
  var link = 0u;
  var escapedAt = steps;
  var growth = maps[0].p0.z;
  var lastPower = 0.0;${trapDecl}
  for (var i = 0u; i < steps; i++) {
    if (r > params.boundingRadius) {
      escapedAt = i;
      break;
    }
    let L = maps[link];
    let kind = u32(L.p0.x);
    var y = vec4f(dot(L.r0, v), dot(L.r1, v), dot(L.r2, v), dot(L.r3, v)) + L.t;
    if (kind < 4u) {
      if (kind != 2u) {
        y = clamp(y, vec4f(-L.fold.z), vec4f(L.fold.z)) * 2.0 - y;
      }
      if (kind != 1u) {
        let f = L.fold.y / clamp(dot(y, y), L.fold.x, L.fold.y);
        y *= f;
      }
    } else {
      y = vec4f(
        y.x * y.x - y.y * y.y - y.z * y.z - y.w * y.w,
        2.0 * y.x * y.y,
        2.0 * y.x * y.z,
        2.0 * y.x * y.w,
      );
    }
    v = L.p0.y * y + q;
    r = length(v);
    growth = L.p0.z;
    lastPower = select(0.0, 2.0, kind == 5u);
    info.rings = min(info.rings, r / params.boundingRadius);
    info.sheets = min(info.sheets, abs(v.y) / params.boundingRadius);${trapStep(
      "v.xyz",
      "i",
    )}
    link++;
    if (link == n) {
      link = 0u;
    }
  }
  var escFrac = 0.0;
  if (escapedAt < steps) {
    if (lastPower > 1.0) {
      escFrac = clamp(log(log(r) / log(params.boundingRadius)) / log(lastPower), 0.0, 1.0);
    } else if (growth > 1.0) {
      escFrac = clamp(log(r / params.boundingRadius) / log(growth), 0.0, 1.0);
    }
  }
  info.trap =
    clamp((f32(escapedAt) - escFrac) / f32(params.maxDepth), 0.0, 1.0);
  info.rings = clamp(info.rings, 0.0, 1.0);
  info.sheets = clamp(info.sheets, 0.0, 1.0);${trapFinal}
${pattern ? `  info.source4 = ${tiling ? "q" : "liftEscape4(p)"};` : ""}
  return info;
}`;

  // Bulb hit-info (the GLSL SURFACE_BULB shading overload, term for
  // term): the same forward triplex-power orbit with the escape
  // family's shading extras — trap is the CONTINUOUS escape count in the
  // POWER-map form (see the value body's derivation), rings/sheets the
  // orbit's closest radial / y-plane approaches, normalized by the ORBIT's
  // own ball (the bailout) rather than the query-space marching radius the
  // escape arm could use for both. firstChoice is always 0 (one map).
  // Colors-only convention (every hit-info body's): the estimate's dr
  // accumulator is the one value-side term trimmed here.
  const bulbHitInfoText = /* wgsl */ `fn surfaceDEHitInfo(p: vec3f, li: u32) -> SurfaceHitInfo {
  var info = SurfaceHitInfo(0, 0.0, 1.0, 1.0, 0.0${source4CtorArg}${trapCtorArg}${tilingCtorArg});
  let bail = params.bulbParams.y;
  let c = vec3f(
    dot(params.bulbM0, p) + params.bulbT0,
    dot(params.bulbM1, p) + params.bulbT1,
    dot(params.bulbM2, p) + params.bulbT2,
  );
  var y = c;
  var r2 = dot(y, y);
  var r = sqrt(r2);
  var escapedAt = params.maxDepth;${trapDecl}
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
    info.sheets = min(info.sheets, abs(y.y) / bail);${trapStep("y", "i")}
  }
  // The continuous escape count for a POWER map, the GLSL
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
  info.sheets = clamp(info.sheets, 0.0, 1.0);${trapFinal}
${pattern ? `  info.source4 = vec4f(p, 0.0);` : ""}
  return info;
}`;

  // Lens hit-info wrapper (the GLSL lens hit overload
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

  // The 4D lens hit-info wrapper: the sweep above one
  // dimension up, sharing every 4D delta the value wrapper's comment
  // lists (81/3/243 fans, the four-digit box code, segmentRadius4) and
  // the same hoisted VIEW LIFT — the core hit-info takes the lifted 4D
  // query here, exactly like the value core. Shading conventions are the
  // 3D wrapper's: FULL-width zero-cutoff core calls, no visible pin and
  // no cutoff exits (a shading call has neither), the shell guard plain-
  // skipping, and an identity-branch fallback so a fully pruned loop
  // still hands the core hit call a sane point.
  const lens4HitParams = tiling
    ? slabExt
      ? "pFolded: vec4f, pFoldedExt: vec4f"
      : "pFolded: vec4f"
    : "p: vec3f";
  const lens4HitLiftText = tiling
    ? slabExt
      ? `  let pq = pFolded;
  let segment = params.sliceHalfW > 0.0;
  var pExt = pFoldedExt;
`
      : `  let pq = pFolded;
`
    : `  let pq = rotorInvApply4(vec4f(p, params.w0));
${
  slabExt
    ? `  let segment = params.sliceHalfW > 0.0;
  var pExt = vec4f(0.0);
  if (segment) {
    pExt = rotorInvWCol4() * params.sliceHalfW;
  }
`
    : ``
}`;
  const lens4HitWrapText = /* wgsl */ `fn surfaceDEHitInfo(${lens4HitParams}, li: u32) -> SurfaceHitInfo {
${lens4HitLiftText}  let kind = u32(params.lens4Params.x);
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
${
  pattern
    ? slabExt
      ? `  // Pattern only: the fold-final source is the WINNING BRANCH TUPLE
  // (the frame oracle's bestQ + sStar * bestExt — the branch centre plus
  // the hit's place along the transported segment; inverse maps preserve
  // the segment parameterization). The core's own fill ran at its query
  // with the slab centre w, so the wrapper overwrites it with the
  // branch's transported tuple.
  var hi = surfaceDEHitInfoCore(bestQ, bestExt, li);
  hi.source4 = bestQ + hi.sStar * bestExt;
  return hi;`
      : `  var hi = surfaceDEHitInfoCore(bestQ, li);
  hi.source4 = bestQ;
  return hi;`
    : `  return surfaceDEHitInfoCore(bestQ, ${slabExt ? "bestExt, " : ""}li);`
}
}`;

  const scheduleCoreSource = (source: string, hitInfo: boolean): string => {
    if (!schedule) return source;
    const terminalDepth = hitInfo
      ? "params.maxDepth"
      : core4
        ? "params.maxDepth"
        : "maxDepth";
    let out = source
      .replaceAll(
        "for (var k = 0u; k < params.symOrder; k++)",
        "for (var k = 0u; k < scheduleSymOrder(depth); k++)",
      )
      .replaceAll(
        "for (var j = 0u; j < params.mapCount; j++)",
        "for (var j = scheduleMapStart(depth); j < scheduleMapEnd(depth); j++)",
      )
      .replaceAll(
        "length(img - params.boundCenter)",
        "length(img - scheduleBound(depth + 1u).xyz)",
      )
      .replaceAll(
        "length(jImg - params.boundCenter) - params.boundingRadius",
        "length(jImg - scheduleBound(depth + 1u).xyz) - scheduleBound(depth + 1u).w",
      )
      .replaceAll(
        "segmentRadius4(jImg, jExt) - params.boundingRadius",
        "segmentRadius4(jImg, jExt) - scheduleBound(depth + 1u).w",
      )
      .replaceAll(
        "length(jImg) - params.boundingRadius",
        "length(jImg) - scheduleBound(depth + 1u).w",
      )
      .replaceAll(
        "return childScale * max(r - params.boundingRadius, inner);",
        "return childScale * max(r - scheduleBound(depth).w, inner);",
      )
      .replaceAll("r - R", "r - scheduleBound(depth + 1u).w")
      .replaceAll("eR > R", "eR > scheduleBound(depth + 1u).w")
      .replaceAll("eR <= R", "eR <= scheduleBound(depth + 1u).w")
      .replaceAll("eR - R", "eR - scheduleBound(depth + 1u).w")
      .replaceAll("evR > R", "evR > scheduleBound(depth + 1u).w")
      .replaceAll("evR - R", "evR - scheduleBound(depth + 1u).w")
      .replaceAll("c3R > R", "c3R > scheduleBound(depth + 1u).w")
      .replaceAll("c3R <= R", "c3R <= scheduleBound(depth + 1u).w")
      .replaceAll("c4R > R", "c4R > scheduleBound(depth + 1u).w")
      .replaceAll("c4R <= R", "c4R <= scheduleBound(depth + 1u).w")
      .replaceAll(
        "r > params.escapeRadius",
        "r > scheduleEscapeRadius(depth + 1u)",
      )
      .replaceAll(
        "lbR > params.escapeRadius",
        "lbR > scheduleEscapeRadius(depth + 1u)",
      )
      .replaceAll(
        "c1R > params.escapeRadius",
        "c1R > scheduleEscapeRadius(depth + 1u)",
      )
      .replaceAll(
        "c1R <= params.escapeRadius",
        "c1R <= scheduleEscapeRadius(depth + 1u)",
      )
      .replaceAll(
        "c2R > params.escapeRadius",
        "c2R > scheduleEscapeRadius(depth + 1u)",
      )
      .replaceAll(
        "c2R <= params.escapeRadius",
        "c2R <= scheduleEscapeRadius(depth + 1u)",
      )
      .replaceAll("lbR - R", "lbR - scheduleBound(depth + 1u).w")
      .replaceAll("lbR / R", "lbR / scheduleBound(depth + 1u).w")
      .replaceAll("lbAbsY / R", "lbAbsY / scheduleBound(depth + 1u).w")
      .replaceAll("c1R / R", "c1R / scheduleBound(depth + 1u).w")
      .replaceAll("abs(c1Q.y) / R", "abs(c1Q.y) / scheduleBound(depth + 1u).w")
      .replaceAll("if (depth == 0u", "if (depth == params.scheduleDepth")
      .replaceAll(
        `    trapAcc += trapW * shadeMaps[lbMap${shadeStride}].w;
    trapNorm += trapW;
    trapW *= shade.colorSpeed;`,
        `    if (depth >= params.scheduleDepth) {
      trapAcc += trapW * shadeMaps[lbMap${shadeStride}].w;
      trapNorm += trapW;
      trapW *= shade.colorSpeed;
    }`,
      )
      .replaceAll(
        `    trapAcc += trapW * shadeMaps[c1Map${shadeStride}].w;
    trapNorm += trapW;
    trapW *= shade.colorSpeed;`,
        `    if (depth >= params.scheduleDepth) {
      trapAcc += trapW * shadeMaps[c1Map${shadeStride}].w;
      trapNorm += trapW;
      trapW *= shade.colorSpeed;
    }`,
      );
    out = out
      .replaceAll(
        "fcR[frontierIx(cc, li)] - R",
        `fcR[frontierIx(cc, li)] - scheduleBound(${terminalDepth}).w`,
      )
      .replaceAll("fcR[cc] - R", `fcR[cc] - scheduleBound(${terminalDepth}).w`)
      .replaceAll("aR - R", `aR - scheduleBound(${terminalDepth}).w`)
      .replaceAll("bR - R", `bR - scheduleBound(${terminalDepth}).w`);
    return out;
  };

  const rawCoreHitInfoText =
    core === "affine"
      ? affineHitInfoText
      : core === "escape"
        ? escapeHitInfoText
        : core === "escape4"
          ? escape4HitInfoText
          : core === "bulb"
            ? bulbHitInfoText
            : core === "affine4"
              ? affine4HitInfoText(slabExt, core4ExternalLift)
              : core === "fold4"
                ? fold4HitInfoText(slabExt, core4ExternalLift)
                : foldHitInfoText;
  const coreHitInfoText = scheduleCoreSource(rawCoreHitInfoText, true);
  const lensedHitInfoText = lens
    ? `${coreHitInfoText.replace(
        "fn surfaceDEHitInfo(",
        "fn surfaceDEHitInfoCore(",
      )}

// The lens hit-info argmin sweep — around the renamed
// core hit-info, like the value pair below.
${core4 ? lens4HitWrapText : lensHitWrapText}`
    : coreHitInfoText;

  // THE BALLOON WRAPPER (module doc): rename exactly one
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
  // color sources, while `shell` carries WHICH term that was,
  // so the shade entry's echo tint reaches shell hits alone. The value
  // form is the probe under fold shade configs (GLSL parity: its balloon
  // hit-info rides the no-cutoff value form, which folds route to the
  // probe — the width-1 probe's 23.8x shading verdict).
  const balloonValueDe =
    probeWidth === null ? "surfaceDEFractal" : "surfaceDEProbeFractal";
  const balloonHitWrapText = /* wgsl */ `fn surfaceDEHitInfo(p: vec3f, li: u32) -> SurfaceHitInfo {
  let dF = ${balloonValueDe}(p, 0.0, li);
  let inv = balloonInvert(p);
  let dS = inv.w * ${balloonValueDe}(inv.xyz, 0.0, li);
  if (dS < dF) {
    var hi = surfaceDEHitInfoFractal(inv.xyz, li);
    hi.colorPos = inv.xyz;
    hi.shell = 1.0;
    return hi;
  }
  var hi = surfaceDEHitInfoFractal(p, li);
  hi.colorPos = p;
  hi.shell = 0.0;
  return hi;
}`;
  const hitInfoText = balloon
    ? `${balloonRename(
        // WGSL value constructors are all-or-none, so the balloon-only
        // colorPos and shell members (struct below) must join the core's
        // full-member constructor too — zeroed there; only the wrapper
        // writes them. A zero `shell` there also reads as the fractal
        // term, which is the safe direction: an untinted hit.
        balloonRename(
          lensedHitInfoText,
          `SurfaceHitInfo(0, 0.0, 1.0, 1.0, 0.0${source4CtorArg}${trapCtorArg})`,
          `SurfaceHitInfo(0, 0.0, 1.0, 1.0, 0.0${source4CtorArg}${trapCtorArg}, vec3f(0.0), 0.0)`,
        ),
        "fn surfaceDEHitInfo(",
        "fn surfaceDEHitInfoFractal(",
      )}

// The balloon hit-info argmin wrapper — around the renamed
// public, the lens sweep's mechanism one level further out.
${balloonHitWrapText}`
    : lensedHitInfoText;
  const tilingLiftExpression = core4
    ? core === "escape4"
      ? "liftEscape4(p)"
      : "rotorInvApply4(vec4f(p, params.w0))"
    : "p";
  const tilingHitFoldedPoint = latticeTiling ? "folded" : "folded.point";
  const tilingHitCoreArgs = core4
    ? `${tilingHitFoldedPoint}${!forward && slabExt ? ", vec4f(0.0)" : ""}, li`
    : `${tilingHitFoldedPoint}, li`;
  const tilingHitPoint4 = core4
    ? tilingHitFoldedPoint
    : `vec4f(${tilingHitFoldedPoint}, 0.0)`;
  const tilingRawPoint4 = core4
    ? "rawTilingPoint"
    : "vec4f(rawTilingPoint, 0.0)";
  const finiteTiledHitInfoText =
    tiling && !latticeTiling
      ? `${balloonRename(
          hitInfoText,
          "fn surfaceDEHitInfo(",
          "fn surfaceDEHitInfoTilingCore(",
        )}

// Finite tiling hit attribution: fold FIRST, then ask the untouched
// core/lens trajectory at that folded point. The optional clip moves only
// the distance max; it has no transform-slot trajectory of its own.
fn surfaceDEHitInfo(p: vec3f, li: u32) -> SurfaceHitInfo {
  let rawTilingPoint = ${tilingLiftExpression};
  var failed = SurfaceHitInfo(0, 0.0, 1.0, 1.0, 0.0${source4CtorArg}${trapCtorArg}${tilingCtorArg});
  failed.tilingPoint = ${tilingRawPoint4};
  if (params.tilingGroup != ${tilingInfo!.code}u) {
    return failed;
  }
  let folded = tilingFold(rawTilingPoint);
  if (!folded.ok) {
    return failed;
  }
  var info = surfaceDEHitInfoTilingCore(${tilingHitCoreArgs});
  info.tilingPoint = ${tilingHitPoint4};
  return info;
}`
      : "";
  const latticeTiledHitInfoText = latticeTiling
    ? `${balloonRename(
        hitInfoText,
        "fn surfaceDEHitInfo(",
        "fn surfaceDEHitInfoTilingCore(",
      )}

// Mirrored lattice hit attribution: fold FIRST, then ask the untouched
// core/lens trajectory once at that canonical-cell point. The mandatory ball
// and optional clip move only the distance max; neither owns a transform-slot
// trajectory of its own.
fn surfaceDEHitInfo(p: vec3f, li: u32) -> SurfaceHitInfo {
  let rawTilingPoint = ${tilingLiftExpression};
  var failed = SurfaceHitInfo(0, 0.0, 1.0, 1.0, 0.0${source4CtorArg}${trapCtorArg}${tilingCtorArg});
  failed.tilingPoint = ${tilingRawPoint4};
  if (params.tilingGroup != ${LATTICE_TILING_CODE}u) {
    return failed;
  }
  let folded = tilingFold(rawTilingPoint, params.tilingH);
  var info = surfaceDEHitInfoTilingCore(${tilingHitCoreArgs});
  info.tilingPoint = ${tilingHitPoint4};
  return info;
}`
    : "";
  const tiledHitInfoText = tiling
    ? latticeTiling
      ? latticeTiledHitInfoText
      : finiteTiledHitInfoText
    : hitInfoText;

  // The two LUT color sources whose NORMALIZER is dimension-specific
  // (every other shade term reconciles under the packing contract).
  // The 3D cores read the visible radius straight —
  // for the 4D cores that slot carries the slice-adjusted march gate,
  // which is what the sphere gate/shadow clamp/fog want but would make
  // these two colorings SWIM as w0 slides — so the 4D arm mirrors
  // surface-material-4d.ts instead: HEIGHT normalizes by the FULL 4D
  // visible radius (params.visRadius4), and RADIUS lifts the hit
  // through the rotor for the TRUE 4D radius, then normalizes its
  // center-relative distance over the visible set's own [minD, maxD]
  // band (params.radiusCenter4/radiusMinD/radiusInvRange —
  // buildColors4's radius convention; still rotor/slice-invariant, the
  // band is an attractor-frame constant) — at the slab hit's OWN w:
  // hit-info's sStar places the hit along the query
  // segment, and stays 0 wherever no slab is descended (h = 0, the
  // noslab kernels, every 3D core), which keeps hitW equal to w0 there
  // bit for bit.
  //
  // Under BALLOON both dimensions' sources read the winning term's SOURCE
  // point `hi.colorPos` instead of `pos`. The 4D radius source additionally
  // pairs that point with the same source descent's sStar before the rotor
  // lift, matching the GLSL arm's cpos routing.
  const shadeHeightU = core4
    ? tiling
      ? `let tiledViewY = dot(
        vec4f(
          params.rotorInvR0.y,
          params.rotorInvR1.y,
          params.rotorInvR2.y,
          params.rotorInvR3.y,
        ),
        hi.tilingPoint,
      );
      u = clamp(tiledViewY / params.visRadius4 * 0.5 + 0.5, 0.0, 1.0);`
      : `u = clamp(${balloon ? "hi.colorPos" : "pos"}.y / params.visRadius4 * 0.5 + 0.5, 0.0, 1.0);`
    : balloon
      ? `u = clamp(hi.colorPos.y / visR * 0.5 + 0.5, 0.0, 1.0);`
      : tiling
        ? `u = clamp(hi.tilingPoint.y / visR * 0.5 + 0.5, 0.0, 1.0);`
        : `u = clamp(pos.y / visR * 0.5 + 0.5, 0.0, 1.0);`;
  const shadeRadiusU =
    core === "escape4"
      ? // The same attractor-frame radius ramp, through this
        // core's own lift (it emits none of the descents' 4D helpers, and
        // its slab is pinned to 0 so there is no sStar term to add). The
        // packer fills the band with (0, 0, 1/visRadius4), so the ramp is
        // |q4| over the bailout ball — an escape chain has no probe-fit
        // band to normalize against.
        tiling
        ? `let q4c = hi.tilingPoint;
      u = clamp(
        (length(q4c - params.radiusCenter4) - params.radiusMinD) *
          params.radiusInvRange,
        0.0, 1.0);`
        : `let q4c = liftEscape4(pos);
      u = clamp(
        (length(q4c - params.radiusCenter4) - params.radiusMinD) *
          params.radiusInvRange,
        0.0, 1.0);`
      : core4
        ? tiling
          ? `let q4c = hi.tilingPoint;
      u = clamp(
        (length(q4c - params.radiusCenter4) - params.radiusMinD) *
          params.radiusInvRange,
        0.0, 1.0);`
          : `let hitW = params.w0 + hi.sStar * params.sliceHalfW;
      let q4c = rotorInvApply4(vec4f(${balloon ? "hi.colorPos" : "pos"}, hitW));
      u = clamp(
        (length(q4c - params.radiusCenter4) - params.radiusMinD) *
          params.radiusInvRange,
        0.0, 1.0);`
        : balloon
          ? `u = clamp(length(hi.colorPos) / visR, 0.0, 1.0);`
          : tiling
            ? `u = clamp(length(hi.tilingPoint.xyz) / visR, 0.0, 1.0);`
            : `u = clamp(length(pos) / visR, 0.0, 1.0);`;

  // Independent balloon palette first, then the orthogonal tint. The
  // coordinate is balloon-de.ts's renderer-neutral normalized radius of
  // the exact pre-inversion source query whose shell image won. flags bit1
  // is explicit non-inherit; fractal-term hits and inherit retain the
  // existing base path without a second sample.
  const shadeBalloonPalette = balloon
    ? `
  if ((shade.flags & 2u) != 0u && hi.shell > 0.5) {
    let balloonU = clamp(
      length(hi.colorPos - params.balloonCenter) / params.balloonRho,
      0.0,
      1.0,
    );
    let balloonIndex = min(floor(balloonU * 256.0), 255.0);
    base = textureSampleLevel(
      balloonLutTex,
      lutSamp,
      vec2f((balloonIndex + 0.5) / 256.0, 0.5),
      0.0,
    ).rgb;
  }`
    : "";

  // The echo's own tint (balloon only), at the BASE-ALBEDO site
  // — after the colour source resolves `base`, before the sRGB decode and
  // the lighting product — so the inverted copy reads as an echo rather
  // than as more of the same object, while the shell still shades as
  // geometry and the specular stays untinted (the `envTint` rule two
  // paragraphs down). `hi.shell` is the union argmin's attribution, so a
  // FRACTAL-term hit is untouched at ANY strength; and strength 0 — the
  // packer's default and the document's absent-field value — is
  // `mix(x, y, 0)` = x exactly, today's frame byte for byte. A
  // non-balloon kernel emits NOTHING here: it has no `shell` member to
  // read, and its shade text must stay the shipped one.
  const shadeBalloonTint = balloon
    ? `
  base = mix(base, shade.balloonTint, shade.balloonTintStrength * hi.shell);`
    : "";

  // The pattern arm's call, at the base-albedo site — AFTER the colour
  // source and the balloon palette/tint, BEFORE lighting and fog (the
  // document's order: color source -> balloon palette -> tint -> pattern ->
  // lighting -> fog).
  // The pattern is object-attached, so the albedo reads the RAW attractor
  // point the hit-info resolved into `hi.source4` (the frame oracle's
  // source4: visible hit -> balloon source query -> inverse 4D view ->
  // final inverse; a fold final is the winning branch's already-resolved
  // tuple). Normalization splits by dimension exactly like the height/
  // radius colour sources: 3D reuses the shared bound centre, 4D the raw
  // bounding radius with the implicit zero centre. The hit's own slot
  // picks its material from the shared B lane (already fetched as `fb`);
  // the footprint is the tier-INDEPENDENT acceptance epsilon at the hit
  // depth — params.pixelEps, the march's own acceptance slope the host
  // packs from the native-height acceptPixelEps — normalized by the raw
  // bounding radius, the GLSL `uAcceptPixelEps * t / uBoundingRadius`
  // twin, so preview and settle tiers cannot change the material detail.
  const shadePattern = pattern
    ? core4
      ? `
  let objectP = ${tiling ? "hi.tilingPoint" : "hi.source4"}.xyz / params.boundingRadius;
  let patternFootprint = params.pixelEps * t / params.boundingRadius;
  base = patternShade(base, objectP, fb, shade.patternCalibration, hi.sheets, patternFootprint);`
      : `
  let objectP = (${tiling ? "hi.tilingPoint" : "hi.source4"}.xyz - params.boundCenter) / params.boundingRadius;
  let patternFootprint = params.pixelEps * t / params.boundingRadius;
  base = patternShade(base, objectP, fb, shade.patternCalibration, hi.sheets, patternFootprint);`
    : "";

  // The march entry's gate: balloon mode drops the
  // visible-sphere gate (every ray can hit the enclosing shell) and caps
  // at the oracle's far horizon `|ro − c| + far`; capped rays keep the
  // same MISS path (background). The dither applies at t = 0, where its
  // max(t, 1.0) scale is exactly the GLSL arm's. The non-balloon arm is
  // the shipped text, byte for byte.
  // What a sphere-gate/sphere-exit MISS terminates as. With the
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
  // The status side-channel write. Emitted at EVERY exit of
  // marchRays — both sphere-gate early-outs, the defensive non-ACTIVE
  // guard and the fall-through — so a slot's word is this pass's answer
  // and never a stale one; empty, and so byte-identical, without the flag.
  const statusStore = (indent: string): string =>
    statusOut ? `\n${indent}statusOut[slotI] = u32(st.y);` : "";
  const marchGate = balloon
    ? `  // No visible-sphere gate in balloon mode — the enclosing
  // shell can be hit from anywhere, so every ray marches from the
  // camera, capped at the oracle's far horizon.
  let tFar = length(ro - params.balloonCenter) + params.balloonFar;
  var t = st.x;
  if (t < 0.0) {
    t = 0.0;${marchDither}
  }`
    : latticeTiling
      ? `  // Lattice presentation gate: intersect the world observation
  // sphere with the attractor-y slab ONCE, then march only inside the
  // carrier — the finite presentation of an unbounded set (the GLSL
  // arm's entry, one text the host never has to explain). A ray that
  // never enters the carrier is a miss, exactly like the sphere gate.
  let carrier = latticePresentationInterval(${latticeCarrierArgs});
  if (!carrier.ok || params.tilingGroup != ${LATTICE_TILING_CODE}u${
    core4 ? " || params.sliceHalfW > 0.0" : ""
  }) {
    st.y = ${marchMissStatus};
    states[ray] = st;${statusStore("    ")}
    return;
  }
  let tFar = carrier.tFar;
  if (tFar <= 0.0) {
    st.y = ${marchMissStatus};
    states[ray] = st;${statusStore("    ")}
    return;
  }
  var t = st.x;
  if (t < 0.0) {
    t = carrier.tEnter;${marchDither}
  }`
      : `  // Sphere gate, origin-centered like the GLSL marcher (the emulator's
  // exact arithmetic; recomputed per pass — cheaper than persisting).
  let radius = params.visibleRadius * 1.02;
  let bq = dot(ro, rd);
  let cq = dot(ro, ro) - radius * radius;
  let disc = bq * bq - cq;
  if (disc < 0.0) {
    st.y = ${marchMissStatus};
    states[ray] = st;${statusStore("    ")}
    return;
  }
  let sq = sqrt(disc);
  let tFar = -bq + sq;
  if (tFar <= 0.0) {
    st.y = ${marchMissStatus};
    states[ray] = st;${statusStore("    ")}
    return;
  }
  var t = st.x;
  if (t < 0.0) {
    t = max(-bq - sq, 0.0);${marchDither}
  }`;
  // The shade entry's fog-origin gate: balloon mode keeps
  // the sphere-entry recompute but drops the defensive no-intersection
  // miss — a shell hit can sit entirely outside the visible sphere, and
  // that early-out would paint a real hit as background — and clamps
  // tEnter to t so the fog pow never sees a negative base (the GLSL
  // arm's guard); shell hits nearer than the entry read fog-free. The
  // non-balloon arm is the shipped text, byte for byte.
  const shadeGate = balloon
    ? `  // Sphere-gate recompute, only for tEnter (the fog origin) —
  // no defensive no-intersection miss (a shell hit can sit
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
    : latticeTiling
      ? `  // Carrier recompute, only for tEnter (the fog origin) — the
  // lattice march's own interval, recomputed exactly as the GLSL arm
  // recomputes the sphere entry. Defensive: a HIT ray always intersected
  // the carrier; a non-ok interval (stale pack or a slab guard) reads
  // fog-free.
  let carrier = latticePresentationInterval(${latticeCarrierArgs});
  let t = st.x;
  // --- shade: surface-material.ts main()'s hit path, term for term ---
  let pos = ro + rd * t;
  // The pre-dither carrier entry — exactly main()'s tEnter fog origin.
  let tEnter = carrier.ok ? max(carrier.tEnter, 0.0) : t;`
      : `  // Sphere-gate recompute, only for tEnter (the fog origin) — cheaper
  // than persisting it in the march state.
  let radius = params.visibleRadius * 1.02;
  let bq = dot(ro, rd);
  let cq = dot(ro, ro) - radius * radius;
  let disc = bq * bq - cq;
  if (disc < 0.0) {
    // Defensive — a HIT ray always intersected the gate sphere.
    colorOut[ray] = pack4x8unorm(vec4f(bg, 1.0));
    layerOut[ray] = packSurfaceLayer(0.0, 0.0, 1.0);
    return;
  }
  let sq = sqrt(disc);
  let t = st.x;
  // --- shade: surface-material.ts main()'s hit path, term for term ---
  let pos = ro + rd * t;
  // The PRE-dither sphere entry — exactly main()'s tEnter fog origin.
  let tEnter = max(-bq - sq, 0.0);`;
  // The shadow tap: the balloon receives shadows, never
  // casts them — shadow rays test the FRACTAL alone, so the enclosing
  // shell cannot black out the scene it wraps. Normal + AO stay on the
  // public union names.
  const shadowDe = balloon ? `${probeDe}Fractal` : probeDe;

  // Per-slot finish lighting (option doc) — these splices stay
  // independent of the material-wire/pattern gate. ONE finishShade emission serves all seven cores: the
  // shade entry below is shared text, which is why the 4D half of this
  // feature costs no extra emission.
  const finishFnText = finish
    ? `
// Per-slot finish lighting — surface-finish.ts's surfaceFinishShadeSource,
// ONE emission shared by every core (the shade entry is shared text).
${surfaceFinishShadeSource(SURFACE_FINISH_WGSL, groundPlane)}`
    : "";
  // The pattern body (surface-pattern-shade.ts's WGSL twin), ONE emission
  // shared by every core — the GLSL tracers' SURFACE_PATTERN arm in the
  // shade kernel's dialect. Spliced into the shade entry alone, exactly
  // like finishFnText, so march/eval kernels stay byte-identical under
  // the flag. Every function reads only its parameters and builtins; the
  // call site supplies the frame reconstruction and the calibration.
  const patternFnText = pattern
    ? `
// Patterned albedo — surface-pattern-shade.ts's surfacePatternShadeSourceWgsl,
// ONE emission shared by every core (the shade entry is shared text).
${surfacePatternShadeSourceWgsl()}`
    : "";
  // The hit slot's two material lanes, hoisted ahead of the color-source
  // branch: the stride-3 slot index the base read used to spell inline,
  // now needed by three reads. The FORWARD cores' hit-info leaves
  // firstChoice at its constructed 0, so slot 0 — the host-selected first
  // positive-weight transform — is their wire (option doc); under balloon,
  // firstChoice comes from
  // the descent at the INVERTED point, so a shell hit inherits its
  // source map's finish for free.
  const shadeSlotCount = condensationShapes
    ? "params.condShadeCount"
    : "params.mapCount";
  const finishLanesFetch = material
    ? `
  // The hit slot's shared material lanes (surfaceMaterialLanes' a/b order).
  let fSlot = clamp(hi.firstChoice, 0, i32(${shadeSlotCount}) - 1);
  let fa = shadeMaps[fSlot * 3 + 1];
  let fb = shadeMaps[fSlot * 3 + 2];`
    : "";
  const shadeBaseRead = material
    ? `base = shadeMaps[fSlot * 3].rgb;`
    : `base = shadeMaps[clamp(hi.firstChoice, 0, i32(${shadeSlotCount}) - 1)].rgb;`;
  // The lighting composition: under finish, the emitted finishShade over
  // the hit slot's lanes (fa/fb fetched above; base already carries
  // shadeBalloonTint's albedo-side mix, so the echo tint's ordering is
  // unchanged); otherwise the fixed Blinn-Phong lines, byte for byte.
  // The fog lines after it are shared — they read col/t/tEnter/bg only.
  const shadeLighting = finish
    ? `  // Parametric finish lighting — surface-finish.ts's finishShade.
  var col = finishShade(base, ${groundPlane ? "pos, " : ""}n, rd, shadow, ao, bg, fa, fb);`
    : `  let diffuse = max(dot(n, shade.lightDir), 0.0);
  let halfVec = normalize(shade.lightDir - rd);
  let specular = pow(max(dot(n, halfVec), 0.0), 32.0) * 0.4;
  // Environment tint: the whole light, toward the backdrop
  // sampled along the shading normal, hue-normalized so strength moves
  // color and never brightness; strength 0 is vec3f(1.0), the bit-exact
  // identity (surface-material.ts's envTint, inlined here rather than
  // as a helper). SPECULAR STAYS UNTINTED — the highlight is what keeps
  // a strongly-tinted render from reading monochrome.
  let envE = mix(shade.bgBottom, shade.bgTop, n.y * 0.5 + 0.5);
  let envTint =
    mix(vec3f(1.0), envE / max(max(envE.r, max(envE.g, envE.b)), 1.0e-4), shade.envStrength);
  let lit = (shade.ambient * ao + (1.0 - shade.ambient) * diffuse * shadow) * envTint;
  // Light in linear space: decode the sRGB base, apply the
  // light/specular product there, re-encode for the canvas.
  let linBase = pow(base, vec3f(2.2));
  var col = pow(linBase * lit + vec3f(specular * shadow), vec3f(1.0 / 2.2));`;

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
  // Classify a sphere MISS against the floor — PLANE only for
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
  if (st.y != ${SURFACE_GPU_RAY_ACTIVE}.0) {${statusStore("    ")}
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
  states[ray] = st;${statusStore("  ")}
}`
        : `
struct SurfaceHitInfo {
  firstChoice: i32,
  trap: f32,
  rings: f32,
  sheets: f32,
  // The slab hit's own place along the query segment,
  // in [-1, 1] of |w - w0| <= sliceHalfW. Written only by the 4D cores'
  // slabExt bodies — every other core (and the noslab variant) leaves
  // the constructor's 0, which pins the radius color to the slice plane
  // exactly as before.
  sStar: f32,${
    pattern
      ? `
  // Pattern only: the hit's raw attractor-frame SOURCE
  // point — the frame oracle's \`source4\` (surface-pattern-frame.ts's
  // frozen name), reconstructed by reversing the render's remaps in its
  // order (visible hit -> balloon source query -> inverse 4D view ->
  // final inverse; a fold final is the winning branch's already-resolved
  // tuple). Each core's hit-info fills it; the shade entry's pattern arm
  // is the one reader. Shading extras only, never part of distance
  // evaluation.
  source4: vec4f,`
      : ""
  }${
    shapeTrap
      ? `
  // Shape trap only: the [0, 1] palette coordinate the trap
  // accumulators produced (escape-de.ts's ONE formula) — the forward
  // hit-info orbits fill it, and the shade entry's color source 6 is the
  // one reader. Shading extras only, never part of distance evaluation.
  shapeTrap: f32,`
      : ""
  }${
    tiling
      ? `
  // Finite tiling only: the folded chamber point which supplied this
  // repeated copy's authored material. Height/radius/pattern use it;
  // normals, lighting and fog deliberately stay in visible world space.
  tilingPoint: vec4f,`
      : ""
  }${
    balloon
      ? `
  // Balloon only: the winning union term's SOURCE query
  // point — the pre-inversion geometry the height/radius color sources
  // read (the GLSL arm's cpos). Cores zero it; only the balloon
  // hit-info wrapper writes it.
  colorPos: vec3f,
  // Balloon only: WHICH union term won — the oracle's
  // \`BalloonDistance.shell\` attribution, 1.0 when the echo term took
  // the min STRICTLY (\`dS < dF\`) and 0.0 otherwise, so a tie goes to
  // the fractal exactly as the CPU convention does. Cores zero it; only
  // the balloon hit-info wrapper writes it, and the shade entry's tint
  // mix is the one reader.
  shell: f32,`
      : ""
  }
}

${trapHelperText}${tiledHitInfoText}
${backgroundShapeSource(BACKGROUND_SHAPE_WGSL)}
fn surfaceCoc(cameraDepth: f32) -> f32 {
  let signedCoc = clamp(
    (cameraDepth - params.focusDepth) / max(params.visibleRadius, 1.0e-6),
    -1.0,
    1.0
  );
  // UNORM midpoint is byte 128: the exact focal-plane sentinel the
  // presentation filter treats as zero circle of confusion.
  return (128.0 + 127.0 * signedCoc) / 255.0;
}

fn packSurfaceLayer(coverage: f32, fog: f32, coc: f32) -> u32 {
  let beta = 1.0 - coverage +
    coverage * fog * (1.0 - shade.fogTintStrength);
  return pack4x8unorm(vec4f(coverage, fog, beta, coc));
}
${
  groundPlane
    ? `
struct GroundPlaneShade {
  color: vec3f,
  coverage: f32,
  fog: f32,
  coc: f32,
}

fn shadeGroundPlane(ro: vec3f, rd: vec3f, bg: vec3f, li: u32) -> GroundPlaneShade {
  // Ground plane — the SURFACE_GROUND_PLANE GLSL arm's
  // shadeGroundPlane, term for term. The march only queues PLANE rays,
  // but the geometry re-derives from scratch so the guards keep this
  // total on any input.
  if (ro.y <= params.groundY || rd.y >= -1.0e-6) {
    return GroundPlaneShade(bg, 0.0, 0.0, 1.0);
  }
  let tp = (params.groundY - ro.y) / rd.y;
  let hp = ro + rd * tp;
  let rel = hp.xz - params.groundBallC.xz;
  // Scene-anchored radial fade to the pixel's own backdrop color.
  let fade =
    1.0 - smoothstep(params.groundFadeStart, params.groundFadeEnd, length(rel));
  if (fade <= 0.0) {
    return GroundPlaneShade(bg, 0.0, 0.0, 1.0);
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
  var shadow = 1.0;${
    latticeTiling
      ? `  // Lattice: the single-ball corridor certificate is invalid
  // (content repeats beyond the ball — the contract's ground paragraph),
  // so the shadow ray marches through its own presentation carrier
  // instead; out-of-carrier probes read open space through the guarded
  // probe DE, and past the carrier's tFar the ray is fully lit.
  let gShadowCarrier = latticePresentationInterval(hp, shade.lightDir${
    core4 ? ", params.w0, params.rotorInvR1" : ""
  }, ${latticeRadiusExpr}, params.tilingPresentationR);
  if (gShadowCarrier.ok) {`
      : `  let toC = params.groundBallC - hp;
  let along = dot(toC, shade.lightDir);
  let perp2 = dot(toC, toC) - along * along;
  let corridor = gR * 1.05 + 0.3 * along;
  if (along > 0.0 && perp2 < corridor * corridor) {`
  }
    var ts = gR * 4.0e-4;
    for (var i = 0u; i < shade.shadowSteps; i++) {
      let sp = hp + shade.lightDir * ts;
      let d = ${probeDe}(sp, 0.0, li);
      shadow = min(shadow, 8.0 * d / ts);
      ts += clamp(d, gR * 2.0e-4, visR * 0.1);
      if (shadow < 0.02${
        latticeTiling
          ? " || ts > gShadowCarrier.tFar"
          : ` ||
          (dot(sp - params.groundBallC, shade.lightDir) > 0.0 &&
            length(sp - params.groundBallC) > gR * 1.05)`
      }) {
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
  var ao = 1.0;${
    latticeTiling
      ? `  // Lattice: the ball-reach AO certificate is invalid for an
  // infinite lattice — the taps run unconditionally and the guarded
  // probe DE reads any out-of-carrier tap as open space.
  {`
      : `  let reach = gR * (1.02 + 0.04 * f32(shade.aoTaps));
  let relC = hp - params.groundBallC;
  if (dot(relC, relC) < reach * reach) {`
  }
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
  // linear space (gamma-correct lighting): n is +y, so diffuse is just
  // lightDir.y.
  let diffuse = max(shade.lightDir.y, 0.0);
  // Environment tint: the whole light, toward the backdrop
  // sampled along the floor's +y normal, hue-normalized so strength
  // moves color and never brightness; strength 0 is vec3f(1.0), the
  // bit-exact identity (surface-material.ts's envTint, inlined here
  // rather than as a helper).
  let envE = mix(shade.bgBottom, shade.bgTop, vec3f(0.0, 1.0, 0.0).y * 0.5 + 0.5);
  let envTint =
    mix(vec3f(1.0), envE / max(max(envE.r, max(envE.g, envE.b)), 1.0e-4), shade.envStrength);
  let lit = (shade.ambient * ao + (1.0 - shade.ambient) * diffuse * shadow) * envTint;
  var floorAlbedo = params.groundAlbedo;
  if (shade.balloonTint.z >= 0.5) {
    let cell = max(params.groundBallR * shade.balloonTint.x, 1.0e-4);
    let tile = floor((hp.xz - params.groundBallC.xz) / cell);
    let checker = ((i32(tile.x) + i32(tile.y)) % 2 + 2) % 2;
    floorAlbedo *= mix(0.035, 1.0, f32(checker));
  }
  let floorLinear = pow(floorAlbedo, vec3f(2.2));
  var col = pow(
    floorLinear * (lit + vec3f(shade.balloonTint.y)),
    vec3f(1.0 / 2.2)
  );
  // Depth fog, the hit path's formula at the plane distance; the fog
  // origin is the ray's closest approach to the ball center (clamped to
  // the segment), so the floor under the fractal stays as crisp as the
  // fractal and the fade band fogs like the far wall it is.
  let dist = tp - clamp(dot(params.groundBallC - ro, rd), 0.0, tp);
  let fog = 1.0 - exp(-0.12 * pow(dist * params.fogDensity / max(visR, 1.0e-6), 2.0));
  col = mix(col, mix(bg, shade.fogTint, shade.fogTintStrength), clamp(fog, 0.0, 1.0));
  let coc = surfaceCoc(dot(hp - ro, params.fwd));
  return GroundPlaneShade(
    mix(bg, col, fade),
    fade,
    clamp(fog, 0.0, 1.0),
    coc
  );
}
`
    : ""
}${finishFnText}${patternFnText}
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
  // This pass's sub-pixel sample position, the march entry's own
  // (default (0.5, 0.5), the pixel centre these lines used to spell out).
  let sub = shade.pixelJitter;
  // The shared background shape at this pixel's FULL-IMAGE coordinates.
  // Deliberately NOT jittered: the backdrop shape has nothing to alias, it
  // must agree with the host's own backgroundRows prefill, and holding it
  // fixed keeps supersampling a no-op wherever the object is absent. For
  // an ordinary frame bgOffset is (0,0) and bgExtent is (rasterWidth,
  // rasterHeight), so the .y term is (f32(py) + 0.5 + 0.0) / f32(rasterHeight)
  // — adding an exact 0.0 changes nothing — the shipping expression value
  // for value.
  let imageUv =
    (vec2f(f32(px), f32(py)) + vec2f(0.5) + shade.bgOffset) / shade.bgExtent;
  let bg = mix(shade.bgBottom, shade.bgTop, backgroundShapeT(imageUv));
${
  groundPlane
    ? `  if (st.y == ${SURFACE_GPU_RAY_PLANE}.0) {
    // Ground plane: the march classified this miss as
    // crossing the floor inside the fade band — unproject the ray (the
    // hit path's exact lines below) and light the analytic crossing.
    let ndcX = ((f32(px) + sub.x) / f32(params.rasterWidth)) * 2.0 - 1.0;
    let ndcY = ((f32(py) + sub.y) / f32(params.rasterHeight)) * 2.0 - 1.0;
    let nearP = shade.invProjView * vec4f(ndcX, ndcY, -1.0, 1.0);
    let farP = shade.invProjView * vec4f(ndcX, ndcY, 1.0, 1.0);
    let rd = normalize(farP.xyz / farP.w - nearP.xyz / nearP.w);
    let ground = shadeGroundPlane(params.ro, rd, bg, li);
    colorOut[ray] = pack4x8unorm(vec4f(ground.color, 1.0));
    layerOut[ray] = packSurfaceLayer(ground.coverage, ground.fog, ground.coc);
    return;
  }
`
    : ""
}  if (st.y != ${SURFACE_GPU_RAY_HIT}.0) {
    colorOut[ray] = pack4x8unorm(vec4f(bg, 1.0));
    layerOut[ray] = packSurfaceLayer(0.0, 0.0, 1.0);
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
  let hi = surfaceDEHitInfo(pos, li);${finishLanesFetch}
  // Base color by source; sources 1-5 sample the CPU-built LUT.
  var base: vec3f;
  if (shade.colorSource == 0u) {
    ${shadeBaseRead}
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
    } else ${
      shapeTrap
        ? /* wgsl */ `if (shade.colorSource == 5u) {
      u = hi.sheets;
    } else {
      u = hi.shapeTrap;
    }`
        : /* wgsl */ `{
      u = hi.sheets;
    }`
    }
    base = textureSampleLevel(lutTex, lutSamp, vec2f(u, 0.5), 0.0).rgb;
  }${shadeBalloonPalette}${shadeBalloonTint}${shadePattern}
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
  // surface; near-black penumbras and leaving the sphere end early.${
    latticeTiling
      ? ` The lattice shadow ray computes its OWN presentation carrier:
  content exists only inside it, so past its own tFar the ray is fully
  lit (the contract's shadow rule), and a ray that never enters it stays
  lit.`
      : ""
  }
  var shadow = 1.0;
  var ts = h * 2.0;${
    latticeTiling
      ? `
  let shadowCarrier = latticePresentationInterval(pos + n * h * 2.0, shade.lightDir${
    core4 ? ", params.w0, params.rotorInvR1" : ""
  }, ${latticeRadiusExpr}, params.tilingPresentationR);`
      : ""
  }
  for (var i = 0u; i < shade.shadowSteps; i++) {
    let sp = pos + n * h * 2.0 + shade.lightDir * ts;
    let d = ${shadowDe}(sp, 0.0, li);
    shadow = min(shadow, 8.0 * d / ts);
    ts += clamp(d, R * 2.0e-4, visR * 0.1);
    if (shadow < 0.02${
      latticeTiling
        ? " || !shadowCarrier.ok || ts > shadowCarrier.tFar"
        : " || length(sp) > visR * 1.05"
    }) {
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
  var ao = 1.0;
  if (norm > 0.0) {
    ao = clamp(1.0 - 0.85 * occ / norm, 0.0, 1.0);
  }
${shadeLighting}
  // Depth fog toward the backdrop: squared-exponential in the distance
  // traveled inside the bounding sphere. params.fogDensity scales the
  // traveled distance, mirroring the GLSL tracers' uFogDensity
  // line for line. shade.fogTint/fogTintStrength retarget the
  // blend to mix(bg, fogTint, strength) — strength 0 is the identity.${
    latticeTiling && core4
      ? `
  // A lattice 4D hit normalizes by the FULL certified radius
  // (params.visRadius4), never the slice-adjusted visibleRadius slot —
  // the contract's "normalized by R" rule, and the GLSL arm's own split.`
      : ""
  }
  let fog = 1.0 - exp(-0.12 * pow((t - tEnter) * params.fogDensity / max(${
    latticeTiling && core4 ? "params.visRadius4" : "visR"
  }, 1.0e-6), 2.0));
  col = mix(col, mix(bg, shade.fogTint, shade.fogTintStrength), clamp(fog, 0.0, 1.0));
  colorOut[ray] = pack4x8unorm(vec4f(col, 1.0));
  let coc = surfaceCoc(dot(pos - ro, params.fwd));
  layerOut[ray] = packSurfaceLayer(1.0, clamp(fog, 0.0, 1.0), coc);
}`;

  // Stage-2 branch-and-bound (surface-de.ts descendFold, the
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

  // The ground-plane params block at the frozen offset 288 (576
  // under a 4D core) — SHARED with the balloon block (they
  // are mutually exclusive by the throw above, the escape/lens 208..271
  // precedent). Appended after the escape variant block for the escape
  // cores, and after the unconditionally-declared lens block (the
  // balloon's frozen-offset move) for the descent cores. ONE text for
  // both dimensions: the offsets follow from where it is spliced, and
  // the block's own layout is dimension-free.
  const planeStructFields = /* wgsl */ `
  groundY: f32,
  groundFadeStart: f32,
  groundFadeEnd: f32,
  groundBallR: f32,
  groundBallC: vec3f,
  padG0: f32,
  groundAlbedo: vec3f,
  padG1: f32,`;
  // The balloon block, at that same shared offset — extracted
  // beside the plane's when the 4D cores grew a second splice
  // site, for the reason the plane's was extracted first.
  const balloonStructFields = /* wgsl */ `
  balloonCenter: vec3f,
  balloonRho: f32,
  balloonR: f32,
  balloonFar: f32,
  padB0: f32,
  padB1: f32,`;
  // The shape trap's LIVE pose/mode block, appended past the plane block —
  // which is declared UNCONDITIONALLY under the trap (zero-filled when no
  // floor) so this lands at ONE offset per dimension: 336 for the 3D
  // forward cores, 624 for escape4 (module doc's layout row). ONE text for
  // both dimensions, exactly like the plane's.
  const trapStructFields = /* wgsl */ `
  trapR0: vec4f,
  trapR1: vec4f,
  trapR2: vec4f,
  trapP: vec4f,`;
  const condensationStructFields = /* wgsl */ `
  condEmitterCount: u32,
  condDepthMin: u32,
  condDepthMax: u32,
  condShadeCount: u32,`;
  const scheduleStructFields = /* wgsl */ `
  scheduleMapCount: u32,
  scheduleDepth: u32,
  schedulePad0: u32,
  schedulePad1: u32,
  scheduleBound1: vec4f,
  scheduleBound2: vec4f,
  scheduleBound3: vec4f,
  scheduleBound4: vec4f,
  scheduleBound5: vec4f,`;
  const chaosStructFields = /* wgsl */ `
  chaosMask0: vec4u,
  chaosMask1: vec4u,
  chaosMask2: vec4u,
  chaosMask3: vec4u,
  chaosMask4: vec4u,
  chaosMask5: vec4u,`;
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
  // Camera-space focal-plane depth for the presentation sidecar's signed
  // circle of confusion. This claims the frozen offset-92 padding word, so
  // every Params ABI size and every following field remain unchanged.
  focusDepth: f32,
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
  // The frozen block's former pad1 slot, claimed for the fog
  // density multiplier — packed by every params packer
  // (packSurfaceGpuParams / packEscapeGpuParams / packSurface4GpuParams)
  // from run.fogDensity ?? 1, module doc's offset-204 row. Read only by
  // the shading pass's fog term below (the pure-eval/march bodies never
  // touch it, keeping their generated source textually unchanged).
  fogDensity: f32,${
    // The 4D tail comes FIRST in this chain: a lensed
    // 4D kernel needs both the tail AND its own appended lens4 block, so
    // core4 owns the variant block and the 3D lens fields stay the 3D
    // cores' alone. Every no-lens branch below is textually what it was.
    // The balloon members land at the FROZEN offset 288 (576
    // under a 4D core) by declaring the variant block UNCONDITIONALLY
    // under balloon — zero-filled by the packer when no lens, the
    // module-doc contract, and that rule runs in
    // both dimensions off `tail4Block`.
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
    // The escape4 core's own occupant of the 464..575 VARIANT
    // block. One live word — the chain's estimate form — and then the
    // pad that keeps the shared plane block at 576 for every 4D core,
    // which is the 3D cores' `padF` argument one dimension up.
    core === "escape4"
      ? /* wgsl */ `
  // (logEstimate, 0, 0, 0) — the chain-level estimate form, 0
  // linear and 1 Bottcher. One number per CHAIN, read once after the
  // orbit, which is why it rides here and not the maps binding. Nothing
  // else: this block was written after the chain reached the shader
  // mirrors, so it carries no frozen
  // head-link ballast the way the 3D escape core's does.
  esc4Params: vec4f,${
    tail4Block
      ? /* wgsl */ `
  // 480..575, PAD — the lens4 block's remaining region, which this core
  // can never use (escape4+lens throws) and which exists so the shared
  // plane block below lands at ONE offset across every 4D core.
  padE4: array<vec4f, 6>,`
      : ""
  }`
      : // The lens4 block, APPENDED past the 4D tail
        // (464..575). Declared under the lens, and under anything
        // appended past it, so the shared
        // block keeps one offset. A smaller struct reading a larger
        // buffer is valid WebGPU, so keeping it struct-conditional
        // otherwise is what keeps every plain 4D kernel's text
        // byte-identical.
        lens || tail4Block
        ? /* wgsl */ `
  lens4MR0: vec4f,
  lens4MR1: vec4f,
  lens4MR2: vec4f,
  lens4MR3: vec4f,
  lens4T: vec4f,
  lens4Params: vec4f,
  // The lens's AUTHORED lengths, the 3D lensFold one dimension up — the fold's
  // radii are dimension-free (SurfaceFoldRadii is SHARED by the two
  // oracles), so this is the same quartet at the 4D block's own offset.
  lens4Fold: vec4f,`
        : ""
  }${balloon ? balloonStructFields : ""}${
    groundPlane || shapeTrap ? planeStructFields : ""
  }${shapeTrap ? trapStructFields : ""}${
    condensationShapes ? condensationStructFields : ""
  }${schedule ? scheduleStructFields : ""}${chaos ? chaosStructFields : ""}`
      : core === "escape"
        ? /* wgsl */ `
  escM0: vec3f,
  escT0: f32,
  escM1: vec3f,
  escT1: f32,
  escM2: vec3f,
  escT2: f32,
  // (kind, w, derivGrowth, logEstimate) — the head link's quartet, frozen
  // ballast the bodies read no link from EXCEPT its .w lane:
  // the chain-level estimate form, 0 linear and 1 Bottcher. One
  // number per CHAIN, which is why it rides here and not the maps binding.
  escParams: vec4f,
  // The fold-lens lengths' 272..287 slot, PAD here. This core has
  // no lens (escape+lens throws) and its links carry their own lengths on
  // the maps binding — the slot exists so the shared plane/balloon block
  // lands at ONE offset (288) across every 3D core, the same layout-parity
  // argument the 4D map struct's unread lanes already ride.
  padF: vec4f,${groundPlane || shapeTrap ? planeStructFields : ""}${
    shapeTrap ? trapStructFields : ""
  }`
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
  padF: vec4f,${groundPlane || shapeTrap ? planeStructFields : ""}${
    shapeTrap ? trapStructFields : ""
  }`
          : lens ||
              balloon ||
              groundPlane ||
              condensationShapes ||
              schedule ||
              chaos ||
              tiling
            ? /* wgsl */ `
  lensM0: vec3f,
  lensT0: f32,
  lensM1: vec3f,
  lensT1: f32,
  lensM2: vec3f,
  lensT2: f32,
  lensParams: vec4f,
  // The lens fold's three AUTHORED lengths — (minRadius,
  // fixedRadius, boxLimit, 0), surfaceFoldRadii's own inputs. The
  // wrapper re-derives the branch algebra from them through foldRadiiOf,
  // exactly as the per-map lanes do; packed zero when there is no lens,
  // which the wrapper never reads.
  lensFold: vec4f,${balloon ? balloonStructFields : ""}${
    groundPlane ? planeStructFields : ""
  }${condensationShapes ? condensationStructFields : ""}${
    schedule ? scheduleStructFields : ""
  }${chaos ? chaosStructFields : ""}`
            : ""
  }
${
  tiling
    ? latticeTiling
      ? "  tilingGroup: u32,\n  tilingH: f32,\n  tilingPresentationR: f32,\n"
      : "  tilingGroup: u32,\n"
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
    // (its formula chain is a LIST of forward maps in the same
    // GpuMap layout). Both 4D cores' maps are the 4D layout (GpuMap4) —
    // one binding text for the pair, in the address space `mapsUniform`
    // picks (the maps-load probe, option doc): the bodies index `maps[j]`
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
// never touch a half-extent (extents transform by the LINEAR
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
// direction.
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
// ball certificate (the oracle's segmentRadius in the 4D
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
// argmin of the helper above, shared guard and all. Inverse
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
    // The WGSL mirror of surface-de.ts's `surfaceFoldRadii`, field
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

  const scheduleHelperText = schedule
    ? /* wgsl */ `
// Hybrid schedule helpers. The lens wrappers remain outside these cores,
// so their inverse is applied before global depth zero reaches this switch.
fn scheduleBound(depth: u32) -> vec4f {
  if (depth == 0u) {
    return vec4f(params.boundCenter, params.boundingRadius);
  }
  switch min(depth, params.scheduleDepth) {
    case 1u: { return params.scheduleBound1; }
    case 2u: { return params.scheduleBound2; }
    case 3u: { return params.scheduleBound3; }
    case 4u: { return params.scheduleBound4; }
    default: { return params.scheduleBound5; }
  }
}

fn scheduleEscapeRadius(depth: u32) -> f32 {
  return ${ESCAPE_FACTOR}.0 * scheduleBound(depth).w;
}

fn scheduleMapStart(depth: u32) -> u32 {
  return select(0u, params.mapCount, depth < params.scheduleDepth);
}

fn scheduleMapEnd(depth: u32) -> u32 {
  return select(params.mapCount, params.mapCount + params.scheduleMapCount,
    depth < params.scheduleDepth);
}

fn scheduleSymOrder(depth: u32) -> u32 {
  return select(params.symOrder, 1u, depth < params.scheduleDepth);
}
`
    : "";

  const chaosHelperText = chaos
    ? /* wgsl */ `
const CHAOS_WILDCARD: u32 = 0xffffffffu;

fn chaosPredecessorMask(current: u32) -> u32 {
  let lane = current & 3u;
  switch current >> 2u {
    case 0u: { return params.chaosMask0[lane]; }
    case 1u: { return params.chaosMask1[lane]; }
    case 2u: { return params.chaosMask2[lane]; }
    case 3u: { return params.chaosMask3[lane]; }
    case 4u: { return params.chaosMask4[lane]; }
    default: { return params.chaosMask5[lane]; }
  }
}

// Reverse-chain convention: predecessorMasks[current] carries source bits
// for the effective forward edges source -> current. Root and scheduled B
// levels carry the wildcard, so the first A inverse is unconstrained.
fn chaosAllows(source: u32, current: u32) -> bool {
  return current == CHAOS_WILDCARD ||
    (source < ${chaos.activeStateCount}u &&
      (chaosPredecessorMask(current) & (1u << source)) != 0u);
}

fn chaosChildState(depth: u32, source: u32) -> u32 {
  return ${schedule ? "select(source, CHAOS_WILDCARD, depth < params.scheduleDepth)" : "source"};
}
`
    : "";

  // The descent PROLOGUE both cores open with: the affine
  // final lens, the depth-0 sphere bound, the march-epsilon bail
  // threshold and the cone-footprint depth cap are the same arithmetic on either
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
  // Cone-footprint depth cap; footprint <= 0 disables (the
  // GLSL-parity default).
  var maxDepth = params.maxDepth;
${
  schedule
    ? ""
    : `  if (params.footprint > 0.0) {
    let capF = ceil(
      log(params.footprint / (2.0 * R)) / log(params.slowestSigma),
    );
    let floored = max(capF, ${FOOTPRINT_DEPTH_FLOOR}.0);
    maxDepth = min(params.maxDepth, u32(floored));
  }`
}
`;

  // ONE descent body template: the main surfaceDE below is
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
${chaos ? "  fcState[frontierIx(0u, li)] = CHAOS_WILDCARD;\n" : ""}
  for (var depth = 0u; depth < maxDepth; depth++) {
    if (chainCount == 0u) {
      break;
    }${
      condensationShapes
        ? `
    for (var rootC = 0u; rootC < chainCount; rootC++) {
      let rootQ = vec3f(
        fcX[frontierIx(rootC, li)],
        fcY[frontierIx(rootC, li)],
        fcZ[frontierIx(rootC, li)],
      );
      best = min(
        best,
        condensationTerm(rootQ, fcScale[frontierIx(rootC, li)], depth${chaos ? ", fcState[frontierIx(rootC, li)]" : ""}),
      );
    }
    if (best <= sphereBound || best * params.finalSigmaMin < bailBelow) {
      return max(best, sphereBound) * params.finalSigmaMin;
    }
    let futureCondensation = condensationHasFuture(depth + 1u);`
        : ""
    }
    var keptCount = 0u;
    var fnWorstKey = -1e30;
    var fnWorstIdx = 0u;
    for (var c = 0u; c < chainCount; c++) {
      let pScale = fcScale[frontierIx(c, li)];
      let pFloor = fcFloor[frontierIx(c, li)];
${chaos ? "      let pState = fcState[frontierIx(c, li)];\n" : ""}
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
${
  chaos
    ? `          if (!chaosAllows(j, pState)) {
            continue;
          }
`
    : ""
}
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
            // transform (branch-and-bound stage 1), so the floor-vs-best prune
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
${chaos ? "            let childState = chaosChildState(depth, j);\n" : ""}
${
  condensationShapes
    ? `            best = min(best, condensationTerm(img, childScale, depth + 1u${chaos ? ", childState" : ""}));
`
    : ""
}            var key = pScale * (r - R);
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
${condensationShapes ? "            var evScale = 0.0;\n" : ""}            var evCert = 0.0;
            var evFloor = 0.0;
            var evHas = false;
            if (keptCount == ${Wstr} && key >= fnWorstKey) {
              evR = r;
${condensationShapes ? "              evScale = childScale;\n" : ""}              evCert = cert;
              evFloor = candFloor;
              evHas = true;
            } else {
              var slot = keptCount;
              if (keptCount == ${Wstr}) {
                slot = fnWorstIdx;
                evR = fnR[frontierIx(slot, li)];
${
  condensationShapes
    ? "                evScale = fnScale[frontierIx(slot, li)];\n"
    : ""
}                evCert = fnCert[frontierIx(slot, li)];
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
${chaos ? "              fnState[frontierIx(slot, li)] = childState;\n" : ""}
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
              }${
                condensationShapes
                  ? ` else if (futureCondensation) {
                best = min(best, evScale * (evR - R));
                if (
                  best <= sphereBound ||
                  best * params.finalSigmaMin < bailBelow
                ) {
                  return max(best, sphereBound) * params.finalSigmaMin;
                }
              }`
                  : ""
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
${chaos ? "      fcState[frontierIx(i2, li)] = fnState[frontierIx(i2, li)];\n" : ""}
    }
    chainCount = keptCount;
  }
  // Floor-raised KIFS terminals for every chain alive at the depth cap.
  for (var cc = 0u; cc < chainCount; cc++) {
${
  condensationShapes
    ? `    let terminalQ = vec3f(
      fcX[frontierIx(cc, li)],
      fcY[frontierIx(cc, li)],
      fcZ[frontierIx(cc, li)],
    );
    best = min(
      best,
      condensationTerm(
        terminalQ,
        fcScale[frontierIx(cc, li)],
        maxDepth,
${chaos ? "        fcState[frontierIx(cc, li)],\n" : ""}
      ),
    );
`
    : ""
}    var terminal = fcScale[frontierIx(cc, li)] * (fcR[frontierIx(cc, li)] - R);
    let tFloor = fcFloor[frontierIx(cc, li)];
    if (tFloor > 0.0 && tFloor > terminal) {
      terminal = tFloor;
    }
    best = min(best, terminal);
  }
  return max(best, sphereBound) * params.finalSigmaMin;
}`;

  // Probe derivation: rename the descent's identity tokens —
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

// The CHEAP descent for the shading probe taps — normal,
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
    arrays
      .map((a) => `  var ${a}: array<${frontierArrayType(a)}, ${probeWidth}>;`)
      .join("\n"),
  ),
)}`;

  // The AFFINE core: `descend`'s refine=TRUE path —
  // {@link estimateDistanceRefined}, the estimator a fold-free base map
  // set is entitled to — ported term for term from its GLSL mirror
  // (`surface-material.ts`'s `#else` arm, the f32 formulation reference).
  // FIXED width 4, exactly as that mirror hardcodes it: A/B are the beam
  // chains, V1/V2 the rank-3/4 validity slots, which hold the
  // level's rank-3/4 candidates ONLY while those stay in-sphere. Every
  // escaped sibling folds the REFINED sibling certificate, under the
  // oracle's laziness guard (refinement can only RAISE a certificate, so
  // a fold whose plain certificate already fails to beat the running min
  // is skipped whole — bit-exact). `opts.width`, `sharedFrontier` and
  // `bnbStage2` are all inert here.
  const affineDescentText = /* wgsl */ `// One extra Hutchinson level on a frozen escaped candidate's own
// inverse image (the oracle's refinedCertValue): the
// certificate becomes childScale * max(r - R, min_j sigmaMin_j *
// (|invMap_j(img)| - R)) — never below the plain childScale * (r - R).
// "Every map" means every (sector, base map) pair, which the sector
// sweep spells out where the expanded slot list used to.
fn refinedCert(img: vec3f, r: f32, childScale: f32${
    condensationShapes || schedule || chaos ? ", depth: u32" : ""
  }${chaos ? ", currentState: u32" : ""}) -> f32 {
  var inner = ${
    condensationShapes
      ? `condensationTerm(img, 1.0, depth${chaos ? ", currentState" : ""})`
      : "1e30"
  };
  var sImg = img;
  for (var k = 0u; k < params.symOrder; k++) {
    if (k > 0u) {
      sImg = stepSector(sImg);
    }
    for (var j = 0u; j < params.mapCount; j++) {
${
  chaos
    ? `      if (!chaosAllows(j, currentState)) {
        continue;
      }
`
    : ""
}
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
${chaos ? "  var aState = CHAOS_WILDCARD;\n" : ""}
  var aLive = true;
  var bQ = vec3f(0.0);
  var bScale = 1.0;
  var bR = 0.0;
${chaos ? "  var bState = CHAOS_WILDCARD;\n" : ""}
  var bLive = false;
  var v1Q = vec3f(0.0);
  var v1Scale = 1.0;
${chaos ? "  var v1State = CHAOS_WILDCARD;\n" : ""}
  var v1Live = false;
  var v2Q = vec3f(0.0);
  var v2Scale = 1.0;
${chaos ? "  var v2State = CHAOS_WILDCARD;\n" : ""}
  var v2Live = false;
  for (var depth = 0u; depth < maxDepth; depth++) {
    if (!aLive && !bLive && !v1Live && !v2Live) {
      break;
    }${
      condensationShapes
        ? `
    if (aLive) {
      best = min(best, condensationTerm(aQ, aScale, depth${chaos ? ", aState" : ""}));
    }
    if (bLive) {
      best = min(best, condensationTerm(bQ, bScale, depth${chaos ? ", bState" : ""}));
    }
    if (v1Live) {
      best = min(best, condensationTerm(v1Q, v1Scale, depth${chaos ? ", v1State" : ""}));
    }
    if (v2Live) {
      best = min(best, condensationTerm(v2Q, v2Scale, depth${chaos ? ", v2State" : ""}));
    }
    if (best <= sphereBound || best * params.finalSigmaMin < bailBelow) {
      return max(best, sphereBound) * params.finalSigmaMin;
    }
    let futureCondensation = condensationHasFuture(depth + 1u);`
        : ""
    }
    // The four smallest-key candidates this level, key-ascending. The
    // sentinel r = 0 keeps empty slots out of every escaped-candidate
    // fold below.
    var c1Key = 1e30;
    var c1Q = vec3f(0.0);
    var c1Scale = 1.0;
    var c1R = 0.0;
    var c1Cert = 0.0;
${chaos ? "    var c1State = CHAOS_WILDCARD;\n" : ""}
    var c2Key = 1e30;
    var c2Q = vec3f(0.0);
    var c2Scale = 1.0;
    var c2R = 0.0;
    var c2Cert = 0.0;
${chaos ? "    var c2State = CHAOS_WILDCARD;\n" : ""}
    // Ranks 3/4, tracked the same way: a second insert-shift ladder fed
    // by everything the top-2 ladder evicts, so the pair holds exactly
    // the level's third- and fourth-smallest keys.
    var c3Key = 1e30;
    var c3Q = vec3f(0.0);
    var c3Scale = 1.0;
    var c3R = 0.0;
    var c3Cert = 0.0;
${chaos ? "    var c3State = CHAOS_WILDCARD;\n" : ""}
    var c4Key = 1e30;
    var c4Q = vec3f(0.0);
    var c4Scale = 1.0;
    var c4R = 0.0;
    var c4Cert = 0.0;
${chaos ? "    var c4State = CHAOS_WILDCARD;\n" : ""}
    for (var c = 0u; c < 4u; c++) {
      var pQ = vec3f(0.0);
      var pScale = 1.0;
${chaos ? "      var pState = CHAOS_WILDCARD;\n" : ""}
      if (c == 0u) {
        if (!aLive) {
          continue;
        }
        pQ = aQ;
        pScale = aScale;
${chaos ? "        pState = aState;\n" : ""}
      } else if (c == 1u) {
        if (!bLive) {
          continue;
        }
        pQ = bQ;
        pScale = bScale;
${chaos ? "        pState = bState;\n" : ""}
      } else if (c == 2u) {
        if (!v1Live) {
          continue;
        }
        pQ = v1Q;
        pScale = v1Scale;
${chaos ? "        pState = v1State;\n" : ""}
      } else {
        if (!v2Live) {
          continue;
        }
        pQ = v2Q;
        pScale = v2Scale;
${chaos ? "        pState = v2State;\n" : ""}
      }
      // Sector sweep: the chain point turns one step per
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
${
  chaos
    ? `          if (!chaosAllows(j, pState)) {
            continue;
          }
`
    : ""
}
          let m = maps[j];
          let img = mapApply(m, sQ);
          let r = length(img - params.boundCenter);
          let key = pScale * (r - R);
          let childScale = pScale * m.p0.x;
${chaos ? "          let childState = chaosChildState(depth, j);\n" : ""}
${
  condensationShapes
    ? `          best = min(best, condensationTerm(img, childScale, depth + 1u${chaos ? ", childState" : ""}));
`
    : ""
}          let cert = childScale * (r - R);
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
${chaos ? "          var eState = childState;\n" : ""}
          if (key < c1Key) {
            eKey = c2Key;
            eQ = c2Q;
            eScale = c2Scale;
            eR = c2R;
            eCert = c2Cert;
${chaos ? "            eState = c2State;\n" : ""}
            c2Key = c1Key;
            c2Q = c1Q;
            c2Scale = c1Scale;
            c2R = c1R;
            c2Cert = c1Cert;
${chaos ? "            c2State = c1State;\n" : ""}
            c1Key = key;
            c1Q = img;
            c1Scale = childScale;
            c1R = r;
            c1Cert = cert;
${chaos ? "            c1State = childState;\n" : ""}
          } else if (key < c2Key) {
            eKey = c2Key;
            eQ = c2Q;
            eScale = c2Scale;
            eR = c2R;
            eCert = c2Cert;
${chaos ? "            eState = c2State;\n" : ""}
            c2Key = key;
            c2Q = img;
            c2Scale = childScale;
            c2R = r;
            c2Cert = cert;
${chaos ? "            c2State = childState;\n" : ""}
          }
          // Spill into the rank-3/4 ladder (unconditional at width 4);
          // what THAT evicts — or the spilled tuple itself, when it
          // beats neither slot — falls through to the fold below. The
          // evicted KEY is dead past this point: only the folded fields
          // (point, scale, radius, certificate) survive, and width 4 is
          // fixed here, so there is no tKey.
          if (eKey < c3Key) {
${condensationShapes ? "            let tKey = c4Key;\n" : ""}            let tQ = c4Q;
            let tScale = c4Scale;
            let tR = c4R;
            let tCert = c4Cert;
${chaos ? "            let tState = c4State;\n" : ""}
            c4Key = c3Key;
            c4Q = c3Q;
            c4Scale = c3Scale;
            c4R = c3R;
            c4Cert = c3Cert;
${chaos ? "            c4State = c3State;\n" : ""}
            c3Key = eKey;
            c3Q = eQ;
            c3Scale = eScale;
            c3R = eR;
            c3Cert = eCert;
${chaos ? "            c3State = eState;\n" : ""}
${condensationShapes ? "            eKey = tKey;\n" : ""}            eQ = tQ;
            eScale = tScale;
            eR = tR;
            eCert = tCert;
${chaos ? "            eState = tState;\n" : ""}
          } else if (eKey < c4Key) {
${condensationShapes ? "            let tKey = c4Key;\n" : ""}            let tQ = c4Q;
            let tScale = c4Scale;
            let tR = c4R;
            let tCert = c4Cert;
${chaos ? "            let tState = c4State;\n" : ""}
            c4Key = eKey;
            c4Q = eQ;
            c4Scale = eScale;
            c4R = eR;
            c4Cert = eCert;
${chaos ? "            c4State = eState;\n" : ""}
${condensationShapes ? "            eKey = tKey;\n" : ""}            eQ = tQ;
            eScale = tScale;
            eR = tR;
            eCert = tCert;
${chaos ? "            eState = tState;\n" : ""}
          }
          // The tuple leaving the beam frontier: an escaped candidate
          // folds its REFINED certificate (which closes the
          // barely-escaped-sibling balloon), skipped whole when its
          // PLAIN certificate cannot beat the running min anyway (the
          // oracle's laziness guard, bit-exact); an in-sphere tuple
          // carries no positive certificate — it can only get here past
          // FOUR smaller keys, the shrunken validity-slot residual drop.
          if (eR > R && eCert < best) {
            best = min(best, refinedCert(eQ, eR, eScale${
              condensationShapes || schedule || chaos ? ", depth + 1u" : ""
            }${chaos ? ", eState" : ""}));
            // Cutoff exit plus the value-exact sphere-floor pin:
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
          }${
            condensationShapes
              ? ` else if (eKey < 1e30 && futureCondensation && eR <= R) {
            best = min(best, eScale * (eR - R));
          }`
              : ""
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
${chaos ? "        aState = c1State;\n" : ""}
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
${chaos ? "        bState = c2State;\n" : ""}
        bLive = true;
      }
    }
    if (c3Key < 1e29) {
      if (c3R > R) {
        if (c3Cert < best) {
          best = min(best, refinedCert(c3Q, c3R, c3Scale${
            condensationShapes || schedule || chaos ? ", depth + 1u" : ""
          }${chaos ? ", c3State" : ""}));
        }
      } else {
        v1Q = c3Q;
        v1Scale = c3Scale;
${chaos ? "        v1State = c3State;\n" : ""}
        v1Live = true;
      }
    }
    if (c4Key < 1e29) {
      if (c4R > R) {
        if (c4Cert < best) {
          best = min(best, refinedCert(c4Q, c4R, c4Scale${
            condensationShapes || schedule || chaos ? ", depth + 1u" : ""
          }${chaos ? ", c4State" : ""}));
        }
      } else {
        v2Q = c4Q;
        v2Scale = c4Scale;
${chaos ? "        v2State = c4State;\n" : ""}
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
  // vacuous negative bound (folding them was measured to change
  // nothing, so the omission is on principle, not cost).
${
  condensationShapes
    ? `  if (aLive) {
    best = min(best, condensationTerm(aQ, aScale, maxDepth${chaos ? ", aState" : ""}));
  }
  if (bLive) {
    best = min(best, condensationTerm(bQ, bScale, maxDepth${chaos ? ", bState" : ""}));
  }
  if (v1Live) {
    best = min(best, condensationTerm(v1Q, v1Scale, maxDepth${chaos ? ", v1State" : ""}));
  }
  if (v2Live) {
    best = min(best, condensationTerm(v2Q, v2Scale, maxDepth${chaos ? ", v2State" : ""}));
  }
`
    : ""
}  if (aLive) {
    best = min(best, aScale * (aR - R));
  }
  if (bLive) {
    best = min(best, bScale * (bR - R));
  }
  return max(best, sphereBound) * params.finalSigmaMin;
}`;

  // The AFFINE4 core: estimateDistance4Refined
  // (surface-de-4d.ts) behind the view lift — the 4D GLSL tracer's
  // estimator (surface-material-4d.ts's plain surfaceDE overload, the
  // f32 formulation this port follows line for line) in WGSL. Section
  // for section it is the AFFINE ladder above one dimension up, at the
  // oracle's FIXED width 4 (`wide` true, `extra` 2 — its width
  // conditionals collapse exactly as the GLSL's): A/B beam chains +
  // V1/V2 validity slots, the 4D spike's refined certificate under
  // the laziness guard at every refined fold site. New here:
  // the view-lift prologue (rotor + w0, the GLSL's uInvRotor line), the
  // slice-thickness slab query — one vec4f half-extent register beside every
  // point, moved by LINEAR parts alone and gated on the dynamically
  // uniform `segment` flag, segmentRadius4 in place of every |q| — and
  // the sector sweep stepping one whole backward 4x4. NO
  // footprint depth cap (the 4D oracle takes none; the packer throws on
  // one), so the loop runs plain params.maxDepth. `opts.width`,
  // `sharedFrontier` and `bnbStage2` are all inert here, like "affine".
  const affine4DescentText = (
    slabExt: boolean,
    lens: boolean,
  ): string => /* wgsl */ `${
    slabExt
      ? `// One extra Hutchinson level on a frozen escaped candidate's own
// inverse image (the oracle's refinedCert closure — the 4D spike's
// measured ghost-eliminator, with its laziness guard riding at every
// call site): the certificate becomes childScale * max(r - R,
// min_j sigmaMin_j * (segmentRadius(invMap_j(img)) - R)) — never below
// the plain childScale * (r - R). "Every map" means every (sector, base
// map) pair, the candidate's half-extent sweeping alongside by
// LINEAR parts alone; segment is recomputed from
// params.sliceHalfW — the 4D GLSL's free-function move, dynamically
// uniform, so both branches cost nothing across a dispatch.
`
      : `// One extra Hutchinson level on a frozen escaped candidate's own
// inverse image (the oracle's refinedCert closure — the 4D spike's
// measured ghost-eliminator, with its laziness guard riding at every
// call site): the certificate becomes childScale * max(r - R,
// min_j sigmaMin_j * (length(invMap_j(img)) - R)) — never below the
// plain childScale * (r - R). "Every map" means every (sector, base
// map) pair. Under slabExt=false (the register-pressure probe): no
// half-extent register — img is a point, not a segment.
`
  }${
    slabExt
      ? `fn refinedCert(img: vec4f, imgExt: vec4f, r: f32, childScale: f32${
          condensationShapes || schedule || chaos ? ", depth: u32" : ""
        }${chaos ? ", currentState: u32" : ""}) -> f32 {
`
      : `fn refinedCert(img: vec4f, r: f32, childScale: f32${
          condensationShapes || schedule || chaos ? ", depth: u32" : ""
        }${chaos ? ", currentState: u32" : ""}) -> f32 {
`
  }${
    slabExt
      ? `  let segment = params.sliceHalfW > 0.0;
`
      : ``
  }  var inner = ${
    condensationShapes
      ? `condensationTerm(img, 1.0, depth${chaos ? ", currentState" : ""})`
      : "1e30"
  };
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
${
  chaos
    ? `      if (!chaosAllows(j, currentState)) {
        continue;
      }
`
    : ""
}
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
  // prologue. The slab query's half-extent is the rotor's w
  // column times sliceHalfW — a view-frame w displacement lifted into
  // the attractor frame — and the lens moves it by its LINEAR part
  // alone (a translation slides a segment's centre, never its extent).
`
    : `  // View -> attractor frame (the 4D GLSL's uInvRotor line): a rotation
  // is an isometry, so distances, steps and gradients survive the lift
  // unchanged; then the affine final lens, exactly as the oracle's
  // prologue. Under slabExt=false (the register-pressure probe): no
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
${chaos ? "  var aState = CHAOS_WILDCARD;\n" : ""}
  var aLive = true;
  var bQ = vec4f(0.0);
${
  slabExt
    ? `  var bExt = vec4f(0.0);
`
    : ``
}  var bScale = 1.0;
  var bR = 0.0;
${chaos ? "  var bState = CHAOS_WILDCARD;\n" : ""}
  var bLive = false;
  var v1Q = vec4f(0.0);
${
  slabExt
    ? `  var v1Ext = vec4f(0.0);
`
    : ``
}  var v1Scale = 1.0;
${chaos ? "  var v1State = CHAOS_WILDCARD;\n" : ""}
  var v1Live = false;
  var v2Q = vec4f(0.0);
${
  slabExt
    ? `  var v2Ext = vec4f(0.0);
`
    : ``
}  var v2Scale = 1.0;
${chaos ? "  var v2State = CHAOS_WILDCARD;\n" : ""}
  var v2Live = false;
  // NO cone-footprint depth cap in this core — the 4D oracle takes
  // none (packSurface4GpuParams throws on a nonzero footprint), so the
  // loop runs plain params.maxDepth.
  for (var depth = 0u; depth < params.maxDepth; depth++) {
    if (!aLive && !bLive && !v1Live && !v2Live) {
      break;
    }${
      condensationShapes
        ? `
    if (aLive) {
      best = min(best, condensationTerm(aQ, aScale, depth${chaos ? ", aState" : ""}));
    }
    if (bLive) {
      best = min(best, condensationTerm(bQ, bScale, depth${chaos ? ", bState" : ""}));
    }
    if (v1Live) {
      best = min(best, condensationTerm(v1Q, v1Scale, depth${chaos ? ", v1State" : ""}));
    }
    if (v2Live) {
      best = min(best, condensationTerm(v2Q, v2Scale, depth${chaos ? ", v2State" : ""}));
    }
    if (best <= sphereBound || best * params.final4SigmaMin < bailBelow) {
      return max(best, sphereBound) * params.final4SigmaMin;
    }
    let futureCondensation = condensationHasFuture(depth + 1u);`
        : ""
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
${chaos ? "    var c1State = CHAOS_WILDCARD;\n" : ""}
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
${chaos ? "    var c2State = CHAOS_WILDCARD;\n" : ""}
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
${chaos ? "    var c3State = CHAOS_WILDCARD;\n" : ""}
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
${chaos ? "    var c4State = CHAOS_WILDCARD;\n" : ""}
    for (var c = 0u; c < 4u; c++) {
      var pQ = vec4f(0.0);
${
  slabExt
    ? `      var pExt = vec4f(0.0);
`
    : ``
}      var pScale = 1.0;
${chaos ? "      var pState = CHAOS_WILDCARD;\n" : ""}
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
${chaos ? "        pState = aState;\n" : ""}
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
${chaos ? "        pState = bState;\n" : ""}
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
${chaos ? "        pState = v1State;\n" : ""}
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
${chaos ? "        pState = v2State;\n" : ""}
      }
${
  slabExt
    ? `      // Sector sweep (the 3D shape one dimension up): the
      // chain point — and, under a slab query, its half-extent, since
      // the backward step is an isometry taking segments to segments —
      // turns one step per kaleidoscope sector and every BASE map is
      // applied to it there, SECTOR-MAJOR (the expansion's k*n + i slot
      // order), so the candidate stream and the ladders' tie-breaks are
      // exactly the expansion's.
`
    : `      // Sector sweep (the 3D shape one dimension up): the
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
${
  chaos
    ? `          if (!chaosAllows(j, pState)) {
            continue;
          }
`
    : ""
}
          let m = maps[j];
          let img = mapApply4(m, sQ);
${
  slabExt
    ? `          // GpuMap4 keeps translation in its own t field, so the
          // linear apply IS the inverse map's linear part — all a
          // segment's half-extent ever sees.
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
${chaos ? "          let childState = chaosChildState(depth, j);\n" : ""}
${
  condensationShapes
    ? `          best = min(best, condensationTerm(img, childScale, depth + 1u${chaos ? ", childState" : ""}));
`
    : ""
}          let cert = childScale * (r - R);
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
${chaos ? "          var eState = childState;\n" : ""}
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
${chaos ? "            eState = c2State;\n" : ""}
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
${chaos ? "            c2State = c1State;\n" : ""}
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
${chaos ? "            c1State = childState;\n" : ""}
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
${chaos ? "            eState = c2State;\n" : ""}
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
${chaos ? "            c2State = childState;\n" : ""}
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
${condensationShapes ? "            let tKey = c4Key;\n" : ""}            let tQ = c4Q;
${
  slabExt
    ? `            let tExt = c4Ext;
`
    : ``
}            let tScale = c4Scale;
            let tR = c4R;
            let tCert = c4Cert;
${chaos ? "            let tState = c4State;\n" : ""}
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
${chaos ? "            c4State = c3State;\n" : ""}
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
${chaos ? "            c3State = eState;\n" : ""}
${condensationShapes ? "            eKey = tKey;\n" : ""}            eQ = tQ;
${
  slabExt
    ? `            eExt = tExt;
`
    : ``
}            eScale = tScale;
            eR = tR;
            eCert = tCert;
${chaos ? "            eState = tState;\n" : ""}
          } else if (eKey < c4Key) {
${condensationShapes ? "            let tKey = c4Key;\n" : ""}            let tQ = c4Q;
${
  slabExt
    ? `            let tExt = c4Ext;
`
    : ``
}            let tScale = c4Scale;
            let tR = c4R;
            let tCert = c4Cert;
${chaos ? "            let tState = c4State;\n" : ""}
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
${chaos ? "            c4State = eState;\n" : ""}
${condensationShapes ? "            eKey = tKey;\n" : ""}            eQ = tQ;
${
  slabExt
    ? `            eExt = tExt;
`
    : ``
}            eScale = tScale;
            eR = tR;
            eCert = tCert;
${chaos ? "            eState = tState;\n" : ""}
          }
          // The tuple leaving the beam frontier: an escaped candidate
          // folds its REFINED certificate (which closes the
          // barely-escaped-sibling ghost), skipped whole when its PLAIN
          // certificate cannot beat the running min anyway (the
          // oracle's laziness guard, bit-exact); an in-sphere
          // tuple carries no positive certificate — it can only get
          // here past FOUR smaller keys, the shrunken validity-slot
          // residual drop.
          if (eR > R && eCert < best) {
${
  slabExt
    ? `            best = min(best, refinedCert(eQ, eExt, eR, eScale${
        condensationShapes || schedule || chaos ? ", depth + 1u" : ""
      }${chaos ? ", eState" : ""}));
`
    : `            best = min(best, refinedCert(eQ, eR, eScale${
        condensationShapes || schedule || chaos ? ", depth + 1u" : ""
      }${chaos ? ", eState" : ""}));
`
}            // Cutoff exit plus the value-exact sphere-floor pin:
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
          }${
            condensationShapes
              ? ` else if (eKey < 1e30 && futureCondensation && eR <= R) {
            best = min(best, eScale * (eR - R));
          }`
              : ""
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
${chaos ? "        aState = c1State;\n" : ""}
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
${chaos ? "        bState = c2State;\n" : ""}
        bLive = true;
      }
    }
    if (c3Key < 1e29) {
      if (c3R > R) {
        if (c3Cert < best) {
${
  slabExt
    ? `          best = min(best, refinedCert(c3Q, c3Ext, c3R, c3Scale${
        condensationShapes || schedule || chaos ? ", depth + 1u" : ""
      }${chaos ? ", c3State" : ""}));
`
    : `          best = min(best, refinedCert(c3Q, c3R, c3Scale${
        condensationShapes || schedule || chaos ? ", depth + 1u" : ""
      }${chaos ? ", c3State" : ""}));
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
${chaos ? "        v1State = c3State;\n" : ""}
        v1Live = true;
      }
    }
    if (c4Key < 1e29) {
      if (c4R > R) {
        if (c4Cert < best) {
${
  slabExt
    ? `          best = min(best, refinedCert(c4Q, c4Ext, c4R, c4Scale${
        condensationShapes || schedule || chaos ? ", depth + 1u" : ""
      }${chaos ? ", c4State" : ""}));
`
    : `          best = min(best, refinedCert(c4Q, c4R, c4Scale${
        condensationShapes || schedule || chaos ? ", depth + 1u" : ""
      }${chaos ? ", c4State" : ""}));
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
${chaos ? "        v2State = c4State;\n" : ""}
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
  // vacuous negative bound (folding them was measured to change
  // nothing, so the omission is on principle, not cost).
${
  condensationShapes
    ? `  if (aLive) {
    best = min(best, condensationTerm(aQ, aScale, params.maxDepth${chaos ? ", aState" : ""}));
  }
  if (bLive) {
    best = min(best, condensationTerm(bQ, bScale, params.maxDepth${chaos ? ", bState" : ""}));
  }
  if (v1Live) {
    best = min(best, condensationTerm(v1Q, v1Scale, params.maxDepth${chaos ? ", v1State" : ""}));
  }
  if (v2Live) {
    best = min(best, condensationTerm(v2Q, v2Scale, params.maxDepth${chaos ? ", v2State" : ""}));
  }
`
    : ""
}  if (aLive) {
    best = min(best, aScale * (aR - R));
  }
  if (bLive) {
    best = min(best, bScale * (bR - R));
  }
  return max(best, sphereBound) * params.final4SigmaMin;
}`;

  // The FOLD4 core: `descendFold4`'s refine=FALSE
  // path (surface-de-4d.ts) — the 3D fold core's width-parameterized
  // frontier ONE DIMENSION UP, behind the affine4 core's view lift.
  // refine=false is the fold cores' standing precedent (the fold GLSL
  // marches the plain estimator; phase 1 measured refinement a value
  // no-op on pure-fold systems), so `refinedCert` has no counterpart
  // here and an evicted tuple's POINT is dead — only its radius,
  // certificate and floor ever fold. Width is a REAL template parameter
  // (small integer literals collide with body constants, so a post-hoc
  // rename could never be safe), the frontier is ALWAYS function-scope
  // private (3D measured shared 2-3.3x slower), and the stage-2
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
${
  chaos
    ? `  var fcState: array<u32, ${w}>;
`
    : ""
}
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
${
  chaos
    ? `  var fnState: array<u32, ${w}>;
`
    : ""
}
${lift4Text(
  "pIn",
  slabExt
    ? `  // View -> attractor frame (the 4D GLSL's uInvRotor line): a rotation
  // is an isometry, so distances, steps and gradients survive the lift
  // unchanged; then the affine final lens, exactly as the oracle's
  // prologue (a fold-BASE system may still carry an affine final; a fold
  // FINAL routes through the lens wrapper, which owns this lift).
  // The slab query's half-extent is the rotor's w column times
  // sliceHalfW, and the lens moves it by its LINEAR part alone.
`
    : `  // View -> attractor frame (the 4D GLSL's uInvRotor line): a rotation
  // is an isometry, so distances, steps and gradients survive the lift
  // unchanged; then the affine final lens, exactly as the oracle's
  // prologue (a fold-BASE system may still carry an affine final; a fold
  // FINAL routes through the lens wrapper, which owns this lift).
  // Under slabExt=false (the register-pressure probe): no half-extent
  // register — q is a point, not a segment.
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
${chaos ? "  fcState[0] = CHAOS_WILDCARD;\n" : ""}
  // NO cone-footprint depth cap in this core — the 4D oracle takes
  // none (packSurface4GpuParams throws on a nonzero footprint), so the
  // loop runs plain params.maxDepth.
  for (var depth = 0u; depth < params.maxDepth; depth++) {
    if (chainCount == 0u) {
      break;
    }${
      condensationShapes
        ? `
    for (var rootC = 0u; rootC < chainCount; rootC++) {
      best = min(best, condensationTerm(fcQ[rootC], fcScale[rootC], depth${chaos ? ", fcState[rootC]" : ""}));
    }
    if (best <= sphereBound || best * params.final4SigmaMin < bailBelow) {
      return max(best, sphereBound) * params.final4SigmaMin;
    }
    let futureCondensation = condensationHasFuture(depth + 1u);`
        : ""
    }
    var keptCount = 0u;
    var fnWorstKey = -1e30;
    var fnWorstIdx = 0u;
    for (var c = 0u; c < chainCount; c++) {
      let pScale = fcScale[c];
      let pFloor = fcFloor[c];
${chaos ? "      let pState = fcState[c];\n" : ""}
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
${
  chaos
    ? `          if (!chaosAllows(j, pState)) {
            continue;
          }
`
    : ""
}
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
    ? `              // REGION DISTANCES UNDER A SEGMENT (the slab through
              // the 4D fold branches):
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
            // transform (branch-and-bound stage 1), so the floor-vs-best prune
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
${chaos ? "            let childState = chaosChildState(depth, j);\n" : ""}
${
  condensationShapes
    ? `            best = min(best, condensationTerm(img, childScale, depth + 1u${chaos ? ", childState" : ""}));
`
    : ""
}            var key = pScale * (r - R);
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
${condensationShapes ? "            var evScale = 0.0;\n" : ""}            var evCert = 0.0;
            var evFloor = 0.0;
            var evHas = false;
            if (keptCount == ${w}u && key >= fnWorstKey) {
              evR = r;
${condensationShapes ? "              evScale = childScale;\n" : ""}              evCert = cert;
              evFloor = candFloor;
              evHas = true;
            } else {
              var slot = keptCount;
              if (keptCount == ${w}u) {
                slot = fnWorstIdx;
                evR = fnR[slot];
${
  condensationShapes ? "                evScale = fnScale[slot];\n" : ""
}                evCert = fnCert[slot];
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
${chaos ? "              fnState[slot] = childState;\n" : ""}
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
              }${
                condensationShapes
                  ? ` else if (futureCondensation) {
                best = min(best, evScale * (evR - R));
                if (
                  best <= sphereBound ||
                  best * params.final4SigmaMin < bailBelow
                ) {
                  return max(best, sphereBound) * params.final4SigmaMin;
                }
              }`
                  : ""
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
${chaos ? "      fcState[i2] = fnState[i2];\n" : ""}
    }
    chainCount = keptCount;
  }
  // Floor-raised KIFS terminals for every chain alive at the depth cap.
  for (var cc = 0u; cc < chainCount; cc++) {
${
  condensationShapes
    ? `    best = min(
      best,
      condensationTerm(fcQ[cc], fcScale[cc], params.maxDepth${chaos ? ", fcState[cc]" : ""}),
    );
`
    : ""
}    var terminal = fcScale[cc] * (fcR[cc] - R);
    let tFloor = fcFloor[cc];
    if (tFloor > 0.0 && tFloor > terminal) {
      terminal = tFloor;
    }
    best = min(best, terminal);
  }
  return max(best, sphereBound) * params.final4SigmaMin;
}`;

  // The fold4 probe (the width-1 probe's discipline in 4D): the SAME body text at
  // the probe width under a second name. Both instantiations keep their
  // frontier in function-scope arrays — distinct scopes, so unlike 3D
  // there is nothing to rename but the declaration itself.
  const renameToProbe4 = (text: string): string =>
    text.replace("fn surfaceDE(", "fn surfaceDEProbe(");
  const probe4DeFns =
    probeWidth === null || core !== "fold4"
      ? ""
      : `

// The CHEAP descent for the shading probe taps — normal,
// shadow and AO light a hit the full-width march already certified, so
// they ride a width-${probeWidth} frontier (width 1 = the greedy
// descent). Same body as surfaceDE, renamed.
${renameToProbe4(fold4DescentFnText(probeWidth, slabExt, core4ExternalLift))}`;

  // The ESCAPE core: escape-de.ts's estimateEscapeDistance —
  // the forward fold orbit with the Buddhi/Rrrola scalar derivative,
  // DE = |v| / dr — in the SURFACE_ESCAPE GLSL arm's f32 formulation
  // (surface-material.ts, the variant this core replaces on the compute
  // route). No descent, no frontier, no prunes: the loop is fixed-cost,
  // so `cutoff` is accepted for signature parity and ignored (every
  // return IS the cutoff-0 result, trivially the cutoff contract) and
  // `li` never indexes anything (the affine ladder's precedent). Plain
  // params.maxDepth — the orbit's iteration budget; no footprint cap,
  // like the GLSL arm.
  //
  // THE CHAIN: the orbit CYCLES through `params.mapCount` links
  // read from the maps storage binding — slot `i mod n`, Mandelbulber2's
  // `seq->GetSequence(i)`, with `+ q` and the bailout test after EACH link
  // (chaining them fattens the set to 37.1% of the bailout ball at six
  // links against cycling's 0.2%, which is the Mandelbrot form's "the
  // object WAS its own bounding sphere" returning). A PASS is one full
  // cycle, so the loop runs `maxDepth * n` single-link steps and `maxDepth`
  // keeps meaning "how many times is each link applied" — the preview
  // clamp's contract at any chain length. Every link contributes its own
  // factor to the ONE shared `dr`, whose `+ 1` (the per-link offset's own
  // derivative) floors it once per link.
  const escapeDescentText = /* wgsl */ `${bulbPow8Text}

// escape-de.ts's foldQueryIntoSector — the kaleidoscope as a
// QUERY-SPACE wedge fold applied ONCE before the orbit, never as an orbit
// operation (the escape set of v <- F(v) + p inherits a rotation only
// where F commutes with it). DIHEDRAL, and forced rather than chosen: the
// chaos game's cyclic fold jumps across sector seams, and a discontinuous
// map has no Lipschitz bound, so the estimate would certify empty balls
// through the seam. g is 1-Lipschitz and an isometry per sector, so the
// marching ball does not move and dr needs no new term. symOrder <= 1
// returns the point untouched — what keeps an unsymmetrised document
// bit-identical to the pre-chain kernel's. Plane codes are SYM_PLANE_CODE's
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
  var link = 0u;${trapGeometryDecl}
  for (var i = 0u; i < steps; i++) {
    if (r > params.boundingRadius) {
      break;
    }
    // The chain's cycle: link i mod n, which is the single map itself at
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
    // The FOLD family, GUARDED. The two tests below are
    // exhaustive by NEGATION over {1, 2, 3} alone, so a power kind has to
    // be kept out of them rather than added beside them — kind 4u
    // satisfies both \`!= 2u\` and \`!= 1u\` and would silently run both
    // folds. That hazard is this module's own doc's reason for making the
    // Mandelbulb a sixth CORE rather than a fourth kind; the guard is what
    // makes a fourth and fifth kind safe on the chain core.
    if (kind < 4u) {
      if (kind != 2u) {
        // The box fold (boxfold + mandelbox): per-axis reflections,
        // local factor 1.
        // The link's own AUTHORED box wall — escape-de.ts's foldAxis(t, wall).
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
    } else if (kind == 4u) {
      // The triplex 8th power. 8*r^7 is its radial/polar stretch —
      // bulb-de.ts's HEURISTIC factor, under-reading the azimuthal
      // stretch by up to 8x at the poles, the same class of slack the
      // folds contribute.
      let r2y = dot(y, y);
      localL = ${BULB_POWER}.0 * (r2y * r2y * r2y * sqrt(r2y));
      y = bulbPow8(y, r2y);
    } else {
      // The quaternion square on span{1, i, j}, closed there because the
      // \`v x v\` term drops. Its 2*|y| is EXACT rather than a bound
      // (quaternion norms multiply) — qjulia-de.ts's certified factor,
      // and the one certified term in the chain's product.
      localL = 2.0 * length(y);
      y = vec3f(y.x * y.x - y.y * y.y - y.z * y.z, 2.0 * y.x * y.y, 2.0 * y.x * y.z);
    }
    // The Mandelbrot form's offset — the QUERY POINT (folded before the
    // orbit), not the document's t (which stays the pre-fold offset
    // inside y above).
    v = L.p0.y * y + q;
    dr = L.p0.z * localL * dr + 1.0;
    r = length(v);${trapGeometryStep("v", "i")}
    link++;
    if (link == n) {
      link = 0u;
    }
  }
  // The Bottcher/Green's form for a chain that escapes
  // super-exponentially (escape-de.ts's ESTIMATE FORM paragraph),
  // selected by the chain-level flag on escParams.w. \`ln r\` goes
  // NEGATIVE below r = 1, which a converging orbit reaches, and a
  // negative estimate would march the tracer BACKWARDS — returning 0
  // there is the inside signal and is safe in the direction a sphere
  // tracer needs. The bulb core takes the identical exit.
${
  shapeTrapGeometry
    ? `  var escapeDistance = r / dr;
  if (params.escParams.w != 0.0) {
    if (r <= 1.0) {
      escapeDistance = 0.0;
    } else {
      escapeDistance = 0.5 * r * log(r) / dr;
    }
  }
  return min(escapeDistance, trapDistance);`
    : `  if (params.escParams.w == 0.0) {
    return r / dr;
  }
  if (r <= 1.0) {
    return 0.0;
  }
  return 0.5 * r * log(r) / dr;`
}
}`;

  // The ESCAPE4 core: escape-de-4d.ts's
  // estimateEscapeDistance4 — the 3D escape body's orbit over vec4f,
  // behind the 4D cores' rotor lift. Three things fall away with the
  // dimension and nothing is added: no bulbPow8 (analyzeEscapeSystem4
  // refuses a triplex power — it has no fourth component), no slab (a
  // forward orbit cannot thread a segment, and the packer pins
  // sliceHalfW to 0), and no lens (an escape chain has no final
  // transform). The two axis helpers exist because this core's
  // kaleidoscope picks its plane by NAME out of all six, where the
  // descents sweep a matrix and never need the axes.
  const escape4DescentText = /* wgsl */ `fn axisAt4(p: vec4f, i: u32) -> f32 {
  if (i == 0u) {
    return p.x;
  }
  if (i == 1u) {
    return p.y;
  }
  if (i == 2u) {
    return p.z;
  }
  return p.w;
}

fn setAxis4(p: vec4f, i: u32, v: f32) -> vec4f {
  var q = p;
  if (i == 0u) {
    q.x = v;
  } else if (i == 1u) {
    q.y = v;
  } else if (i == 2u) {
    q.z = v;
  } else {
    q.w = v;
  }
  return q;
}

// escape-de-4d.ts's foldQueryIntoSector4 — the 3D wedge fold generalised
// to all six coordinate planes, the two coordinates outside the plane
// riding through untouched. Still a composition of half-space folds,
// hence 1-Lipschitz and an isometry per sector, so the marching ball does
// not move. Plane codes are SYM_PLANE_CODE4's (the index into
// SYMMETRY_PLANES) and NOT the descents' SYM_PLANE_CODE, which
// deliberately collapses the w-planes onto their w-free twins.
fn foldQuerySector4(p: vec4f) -> vec4f {
  if (params.symOrder <= 1u) {
    return p;
  }
  let code = params.symPlane;
  var ia = 0u;
  var ib = 1u;
  if (code == 1u) {
    ia = 0u;
    ib = 2u;
  } else if (code == 2u) {
    ia = 1u;
    ib = 2u;
  } else if (code == 3u) {
    ia = 0u;
    ib = 3u;
  } else if (code == 4u) {
    ia = 1u;
    ib = 3u;
  } else if (code == 5u) {
    ia = 2u;
    ib = 3u;
  }
  let a = axisAt4(p, ia);
  let b = axisAt4(p, ib);
  let sector = 6.283185307179586 / f32(params.symOrder);
  // Rotate BACK by the nearest whole sector, then mirror across the
  // plane's first axis: the reflection group's fundamental-domain
  // retraction, the 3D body's own two steps.
  let turn = round(atan2(b, a) / sector) * sector;
  let c = cos(turn);
  let s = sin(turn);
  var q = setAxis4(p, ia, a * c + b * s);
  return setAxis4(q, ib, abs(b * c - a * s));
}

// The view lift, INLINED rather than reaching for rotorInvApply4: that
// helper is emitted for the 4D DESCENT cores only, and this core is the
// first that is both 4D and forward. A rotation is an isometry, so the
// estimate survives the lift untouched. No half-extent register — the
// packer pins sliceHalfW to 0 for this core.
fn liftEscape4(pIn: vec3f) -> vec4f {
  let pv = vec4f(pIn, params.w0);
  return vec4f(
    dot(params.rotorInvR0, pv),
    dot(params.rotorInvR1, pv),
    dot(params.rotorInvR2, pv),
    dot(params.rotorInvR3, pv),
  );
}

fn surfaceDE(${tiling ? "qIn: vec4f" : "pIn: vec3f"}, cutoff: f32, li: u32) -> f32 {
  let q = foldQuerySector4(${tiling ? "qIn" : "liftEscape4(pIn)"});
  var v = q;
  var dr = 1.0;
  var r = length(v);
  let n = params.mapCount;
  let steps = params.maxDepth * n;
  var link = 0u;${trapGeometryDecl}
  for (var i = 0u; i < steps; i++) {
    if (r > params.boundingRadius) {
      break;
    }
    // The chain's cycle: link i mod n. GpuMap4 rows carry the FORWARD
    // 4x4 here (row j in r{j}, the translation in t) and p0 is the
    // (kind, w, derivGrowth, 0) quartet — each divergence from the
    // descent lanes being its 3D twin's.
    let L = maps[link];
    let kind = u32(L.p0.x);
    var y = vec4f(dot(L.r0, v), dot(L.r1, v), dot(L.r2, v), dot(L.r3, v)) + L.t;
    var localL = 1.0;
    // The FOLD family, GUARDED exactly as in 3D: the two tests below are
    // exhaustive by NEGATION over {1, 2, 3} alone, so the quaternion
    // square has to be kept out of them rather than added beside them.
    // The guard reads \`kind < 4u\` and not \`kind != 5u\` on purpose —
    // it is the 3D body's line, and kind 4 (the triplex power) is
    // refused by the gate rather than unreachable by accident.
    if (kind < 4u) {
      if (kind != 2u) {
        // The box fold, now reflecting the fourth axis too — the link's
        // own AUTHORED box wall.
        y = clamp(y, vec4f(-L.fold.z), vec4f(L.fold.z)) * 2.0 - y;
      }
      if (kind != 1u) {
        // The sphere fold through the FULL 4-radius, its own sphere
        // shell SQUARED on the wire exactly as EscapeLink4 keeps it.
        let f = L.fold.y / clamp(dot(y, y), L.fold.x, L.fold.y);
        y *= f;
        localL = f;
      }
    } else {
      // The FULL quaternion square — variations4.ts's qsquare, whose 4D
      // form is the DEFINITION and whose 3D form is the restriction. Its
      // 2*|y| stays EXACT rather than a bound: quaternion norms multiply
      // on the whole algebra, not merely on span{1, i, j}.
      localL = 2.0 * length(y);
      y = vec4f(
        y.x * y.x - y.y * y.y - y.z * y.z - y.w * y.w,
        2.0 * y.x * y.y,
        2.0 * y.x * y.z,
        2.0 * y.x * y.w,
      );
    }
    // The Mandelbrot form's offset — the QUERY POINT, folded and lifted.
    v = L.p0.y * y + q;
    dr = L.p0.z * localL * dr + 1.0;
    r = length(v);${trapGeometryStep("v.xyz", "i")}
    link++;
    if (link == n) {
      link = 0u;
    }
  }
  // The chain-level estimate form, on this core's own variant
  // slot: 0 linear, 1 the Bottcher/Green's form. \`ln r\` goes NEGATIVE
  // below r = 1, which a converging orbit reaches, and a negative
  // estimate would march the tracer BACKWARDS — 0 there is the inside
  // signal and is safe in the direction a sphere tracer needs.
${
  shapeTrapGeometry
    ? `  var escapeDistance = r / dr;
  if (params.esc4Params.x != 0.0) {
    if (r <= 1.0) {
      escapeDistance = 0.0;
    } else {
      escapeDistance = 0.5 * r * log(r) / dr;
    }
  }
  return min(escapeDistance, trapDistance);`
    : `  if (params.esc4Params.x == 0.0) {
    return r / dr;
  }
  if (r <= 1.0) {
    return 0.0;
  }
  return 0.5 * r * log(r) / dr;`
}
}`;

  // The BULB core: bulb-de.ts's estimateBulbDistance — the
  // forward triplex-power orbit with the Boettcher log estimate,
  // DE = 0.5 * |y| * ln|y| / dr — in the SURFACE_BULB GLSL arm's f32
  // formulation (surface-material.ts, the variant this core replaces on
  // the compute route). Structurally the escape core: no descent, no
  // frontier, no prunes, so cutoff is accepted for signature parity and
  // ignored (every return IS the cutoff-0 result, trivially the cutoff
  // contract) and li never indexes anything. Plain params.maxDepth — the
  // orbit's iteration budget; no footprint cap, like the GLSL arm.
  const bulbDescentText = /* wgsl */ `${bulbPow8Text}

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

  const rawDescentBlock =
    core === "affine"
      ? `// descend's refine=true path (surface-de.ts) — the estimator the
// AFFINE GLSL marches, in that mirror's f32 formulation. Fixed width 4.
${affineDescentText}`
      : core === "escape"
        ? `// estimateEscapeDistance (escape-de.ts) — the forward-orbit
// escape-time estimator, the SURFACE_ESCAPE GLSL arm's twin.
${escapeDescentText}`
        : core === "escape4"
          ? `// estimateEscapeDistance4 (escape-de-4d.ts) behind the 4D cores'
// view lift — the forward escape-time orbit one dimension up. No
// fragment mirror: an escape-shaped 4D session is compute-only, the
// standing verdict for fold-shaped ones.
${escape4DescentText}`
          : core === "bulb"
            ? `// estimateBulbDistance (bulb-de.ts) — the forward triplex-power
// orbit's Mandelbulb estimator, the SURFACE_BULB GLSL arm's twin.
${bulbDescentText}`
            : core === "affine4"
              ? `// estimateDistance4Refined (surface-de-4d.ts) behind the view lift —
// the estimator the 4D GLSL tracer marches (surface-material-4d.ts), in
// that mirror's f32 formulation. Fixed width 4.
${affine4DescentText(slabExt, core4ExternalLift)}`
              : core === "fold4"
                ? `// descendFold4's refine=false path (surface-de-4d.ts) behind the same
// view lift — the 4D fold-branch frontier, f32.
${fold4DescentFnText(width, slabExt, core4ExternalLift)}${probe4DeFns}`
                : `// descendFold's refine=false path (surface-de.ts), the estimator the
// fold GLSL marches, in that mirror's f32 formulation.
${descentFnText(W, privateDecls)}${probeDeFns}`;
  const descentBlock = scheduleCoreSource(rawDescentBlock, false);

  // The FOLD FINAL lens: `descendLens` (surface-de.ts)
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
  // the march-epsilon cutoff exits (inner descents get `min(best, cutoff) /
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

  // THE 4D FOLD FINAL LENS: `descendLens4`
  // (surface-de-4d.ts) — the wrapper above one dimension up, with every
  // dimension-sensitive quantity the 4D one: 81/3/243 branches decoded
  // `b = selX + 3*selY + 9*selZ + 27*selW` (the mandelbox's sphere branch
  // turning over every 81st index, its shell guard skipping `b += 80u`),
  // `segmentRadius4` in place of every `length` so a slice-thickness slab rides
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
  // march-epsilon inner cutoff `min(best, cutoff) / factor`; "fold4" is the
  // PLAIN frontier (refine=false), so it takes cutoff 0 and the inner
  // cutoff is never even computed. Swapping them would silently mirror a
  // different estimator than the oracle the bench pins against.
  const lens4Refined = core === "affine4";
  const lens4CoreCall = `surfaceDECore(q, ${slabExt ? "qExt, " : ""}${
    lens4Refined ? "innerCutoff" : "0.0"
  }, li)`;
  const lens4WrapParams = tiling
    ? slabExt
      ? "pFolded: vec4f, pFoldedExt: vec4f"
      : "pFolded: vec4f"
    : "pIn: vec3f";
  const lens4LiftText = tiling
    ? slabExt
      ? `  // The tiling wrapper already lifted and folded the point before
  // this plot-time lens. Tiled 4D sessions pin sliceHalfW to zero, so the
  // transported extent is the explicit zero passed by that wrapper.
  let p = pFolded;
  let segment = params.sliceHalfW > 0.0;
  var pExt = pFoldedExt;
`
      : `  // The tiling wrapper already lifted and folded the point before
  // this plot-time lens.
  let p = pFolded;
`
    : `  // The cores' view lift, hoisted: ONE rotor apply for the whole sweep
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
`
    : ``
}`;
  const lens4WrapText = /* wgsl */ `fn surfaceDE(${lens4WrapParams}, cutoff: f32, li: u32) -> f32 {
${lens4LiftText}${
    slabExt
      ? `  let visBound = segmentRadius4(p, pExt) - params.visRadius4;
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
  // shading taps (the probe discipline carried through the lens). One
  // text, three names; none can drift.
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
          ? "descendLens4 (surface-de-4d.ts) — the 4D fold FINAL lens's\n// branch sweep around the core, whose view lift it now owns."
          : "descendLens (surface-de.ts) — the fold FINAL lens's branch sweep\n// around the untouched core (the pure-fold final lens's vocabulary)."
      }
${core4 ? lens4WrapText : lensWrapText}${
        probeWidth === null
          ? ""
          : `

// The probe taps' own lens sweep — same text, renamed.
${core4 ? probeLens4WrapText : probeLensWrapText}`
      }`
    : descentBlock;

  // THE BALLOON WRAPPER (module doc): the union DE over the
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

// The balloon inverted-union (fractal/balloon-de.ts's
// estimateBalloonDistance, the GLSL SURFACE_BALLOON block's WGSL twin):
// min(DE(p), (|p-c|/rho)*DE(I(p))) over the compiled variant's public DE,
// conservative at every R; the shell cutoff scales by the inverse of its
// value factor so the cutoff contract survives verbatim. No far-field
// clamp here, unlike the GLSL arm's balloonInnerDE: both FORWARD cores
// are refused at codegen (their solids swallow the camera), and
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

// The probe taps' own balloon union — same text, renamed.
${balloonProbeWrapText}`
      }`
    : lensedBodyBlock;

  const tilingValueLiftExpression = core4
    ? core === "escape4"
      ? "liftEscape4(pIn)"
      : "rotorInvApply4(vec4f(pIn, params.w0))"
    : "pIn";
  const tilingValueFoldedPoint = latticeTiling ? "folded" : "folded.point";
  const tilingValueCoreArgs = core4
    ? `${tilingValueFoldedPoint}${!forward && slabExt ? ", vec4f(0.0)" : ""}`
    : tilingValueFoldedPoint;
  const tilingClipReturn = tiling?.clip
    ? `return max(inner, tilingClipSdf(${tilingValueFoldedPoint}${
        core4 ? ".xyz" : ""
      }));`
    : "return inner;";
  const tilingDeWrapText =
    tiling && !latticeTiling
      ? /* wgsl */ `fn surfaceDE(pIn: vec3f, cutoff: f32, li: u32) -> f32 {
  if (params.tilingGroup != ${tilingInfo!.code}u) {
    return 0.0;
  }
  let folded = tilingFold(${tilingValueLiftExpression});
  if (!folded.ok) {
    return 0.0;
  }
  let inner = surfaceDETilingCore(${tilingValueCoreArgs}, cutoff, li);
  ${tilingClipReturn}
}`
      : "";
  const latticeClipReturn = tiling?.clip
    ? `return max(bounded, tilingClipSdf(folded${core4 ? ".xyz" : ""}));`
    : "return bounded;";
  const latticeDeWrapText = latticeTiling
    ? /* wgsl */ `fn surfaceDE(pIn: vec3f, cutoff: f32, li: u32) -> f32 {
  if (params.tilingGroup != ${LATTICE_TILING_CODE}u) {
    return 0.0;
  }
  // Probe taps outside the finite presentation carrier are OPEN SPACE:
  // the window boundary must never read as geometry, cast a shadow or
  // contribute AO (lattice-march.ts's contract). The march itself never
  // samples outside the interval, so the guard only ever fires on
  // normal/AO/shadow probes and the bench's in-domain evals.
  if (!${latticeContainsCall("pIn")}) {
    return 2.0 * params.tilingPresentationR;
  }
  let folded = tilingFold(${tilingValueLiftExpression}, params.tilingH);
  let inner = surfaceDETilingCore(${tilingValueCoreArgs}, cutoff, li);
  let bounded = max(inner, length(folded) - ${latticeRadiusExpr});
  ${latticeClipReturn}
}`
    : "";
  const tilingProbeWrapText = tiling
    ? (latticeTiling ? latticeDeWrapText : tilingDeWrapText)
        .replace("fn surfaceDE(", "fn surfaceDEProbe(")
        .replaceAll("surfaceDETilingCore(", "surfaceDEProbeTilingCore(")
    : "";
  const finiteTiledBodyBlock =
    tiling && !latticeTiling
      ? `${balloonRename(
          probeWidth === null
            ? bodyBlock
            : balloonRename(
                bodyBlock,
                "fn surfaceDEProbe(",
                "fn surfaceDEProbeTilingCore(",
              ),
          "fn surfaceDE(",
          "fn surfaceDETilingCore(",
        )}

// Finite reflection tiling: fold once, evaluate the untouched compiled
// core/lens, then intersect with the optional authored analytic clip through
// max(core, signed SDF). The group word refuses stale source/params pairings.
${tilingDeWrapText}${
          probeWidth === null
            ? ""
            : `

// The shade taps' probe width gets the identical outer composition.
${tilingProbeWrapText}`
        }`
      : "";
  const latticeTiledBodyBlock = latticeTiling
    ? `${balloonRename(
        probeWidth === null
          ? bodyBlock
          : balloonRename(
              bodyBlock,
              "fn surfaceDEProbe(",
              "fn surfaceDEProbeTilingCore(",
            ),
        "fn surfaceDE(",
        "fn surfaceDETilingCore(",
      )}

// Mirrored affine-A1 lattice: fold once, evaluate the untouched compiled
// core/lens once, then intersect with the mandatory origin-centred authority
// ball and optional authored analytic clip. The code word refuses stale
// source/params pairings; h is the resolver-owned half-cell.
${latticeDeWrapText}${
        probeWidth === null
          ? ""
          : `

// The shade taps' probe width gets the identical outer composition.
${tilingProbeWrapText}`
      }`
    : "";
  const tiledBodyBlock = tiling
    ? latticeTiling
      ? latticeTiledBodyBlock
      : finiteTiledBodyBlock
    : bodyBlock;

  return /* wgsl */ `${headerText}${tilingFoldText}${latticeCarrierText}${tilingClipText}${scheduleHelperText}${chaosHelperText}

${meshSdfHelperText}${trapGeometryHelperText}${condensationHelperText}${tiledBodyBlock}
${entry}
`;
}
