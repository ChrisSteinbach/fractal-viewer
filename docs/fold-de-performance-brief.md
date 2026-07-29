# Fold-DE performance brief

Handover notes for a Claude Code session working on `fractal-viewer`
(`github.com/ChrisSteinbach/fractal-viewer`, deployed as fractal-4d.com).

**Problem statement.** Surface-mode DE rendering of systems containing pure-fold
maps (`boxfold` / `spherefold` / `mandelbox`, fr-p7nu / fr-5rvk) is unusably slow
and locks up browsers on anything visually interesting.

**Ground rules.** Everything below must preserve the validity argument in
`src/fractal/surface-de.ts`'s module doc: the DE must remain a certified **lower
bound** on distance to the attractor. An idea that trades soundness for speed is
not on this list, and anything that looks like it does should be rejected rather
than fudged. Follow the existing oracle discipline: change
`src/fractal/surface-de.ts` first, re-run `scripts/surface-beam.harness.ts`
(violations, void false hits, DE/D tightness, inverse applications), and only
then mirror into the GLSL in `src/app/surface-material.ts`.

---

## 1. Cost model — why this is a wall, not a slope

Three independent multiplicative factors. Establish which dominates _before_
committing to any rewrite.

### Factor A — branch count per descent step

The rest of the fractal-rendering world renders folds **forward**: one-valued,
~15 iterations, a scalar running derivative, no branching. This codebase does
inverse-map descent with certified `sigma_min` bounds, because that is what
generalises to an arbitrary IFS. The price is that a fold's inverse is
_multivalued_: 27 branches for `boxfold`, 3 for `spherefold`, 81 for `mandelbox`.

From the repo's own measured numbers (module doc, fr-5rvk MEASURED VERDICT):
`mandelboxKifs` costs ~1400–2040 map visits per DE call, each expanding 27–81
branches. That is on the order of 10^5 branch evaluations **per march step**.

### Factor B — bound looseness

Same doc: median DE/D of 0.13–0.20 on fold systems versus 0.61–0.84 on affine
presets. Roughly 4x more march steps, multiplying factor A.

### Factor C — GPU occupancy (suspected silent killer)

`src/app/surface-material.ts`, the `#if SURFACE_FOLDS` variant of `surfaceDE`,
declares ten **dynamically indexed** private arrays at `FOLD_W = 12`:

```
vec3  fcQ[12]; float fcScale[12]; float fcFloor[12]; float fcR[12];
float fnKey[12]; vec3 fnQ[12]; float fnScale[12];
float fnFloor[12]; float fnR[12]; float fnCert[12];
```

That is ~168 floats ≈ 672 bytes of indexed per-thread state. No GPU keeps that in
registers — it spills to scratch/local memory, and occupancy collapses to a
handful of warps. The recorded Mesa compiler failure on the inlined refinement
sweep is the same symptom from the compile side.

**This is cheap to test and should be tested first.** See §2.

---

## 2. Instrument before optimising

Two experiments, both roughly a day, that decide the rest of the plan.

1. **Spill probe.** Build with `SURFACE_FOLD_BEAM_WIDTH` at 12, 8, 6, and 4 and
   measure settled-frame trace time at a fixed pose on `mandelboxKifs`. If time
   drops _far more than linearly_ in width, factor C dominates and the answer is
   a WebGPU compute rewrite (§3.7), not a better search. If it drops roughly
   linearly, factor A dominates and §3.1 is the highest-value change.
   Cross-check with driver spill statistics where available.
2. **Step-count vs DE-cost split.** Add a debug output mode that visualises
   (a) march steps per pixel and (b) inverse applications per pixel. The ratio
   tells you whether to attack factor A (§3.1, §3.5, §3.6) or factor B
   (§3.2, §3.3).

Record both in a beads issue before changing anything.

---

## 3. Work items, ranked by leverage per unit of pain

### 3.1 Branch-and-bound the 27/81 instead of enumerating them

**Highest algorithmic value; local change; provably sound.**

Today `descendFold` enumerates every branch unconditionally, and only then applies
the floor-vs-best prune. The prune can be moved _ahead_ of the child computation
using an admissible lower bound on the branch's selection key.

`boxFold` preimages are separable per axis: for output component `u_a` the three
preimages are `{u_a, 2 - u_a, -2 - u_a}`. The child is
`inv(M) * pre + invT`, and

```
|child| = |inv(M)*pre + invT| >= |pre| / sigma_max(M) - |invT|
|pre|^2 = sum_a pre_a^2                                   <- separable
```

So:

- per axis, sort the three candidates by `pre_a^2` (3 elements, branchless);
- run the triple-nested loop in ascending order;
- `break` the inner loops as soon as the partial sum-of-squares implies a key
  `>= best`.

**Soundness.** Skipping a branch whose key provably cannot beat `best` drops a
term that could not have lowered the min. This is the existing floor-vs-best
prune applied one step earlier, with a different (cheaper) bound. Certificates of
skipped branches are lower bounds on distance to their own piece, and the bound
proves that piece is `>= best`, so not folding them cannot change the result.

`mandelbox` is `81 = 3 * 27` and inherits the box ordering inside each spherefold
branch. Expect 27 to collapse to ~2–5 in practice.

**Where.** `descendFold` in `src/fractal/surface-de.ts` (~line 1880 onward), then
the `#if SURFACE_FOLDS` body in `src/app/surface-material.ts` (~line 390 onward).
Note the GLSL currently precomputes `pre0/pre1/pre2`, `dUp`, `dDn` before the
branch loop — the sort fits naturally there.

**Verify.** `scripts/surface-beam.harness.ts` — inverse applications should fall
sharply; violations, void false hits and DE/D must be unchanged (this is a pure
work-skipping change, so values should be bit-identical or within fp noise).

---

### 3.2 Fix the base case — the bounding sphere is origin-centred

`buildSurfaceDE` sets `boundingRadius = probe.bounds.maxR * RADIUS_PAD + 1e-3`,
i.e. max `‖p‖` **from the origin**. The terminal bound `|q| - R` is then used at
every level of every chain. If the attractor is not centred on the origin, that
slack multiplies through the entire descent and shows up directly as factor B.

- **Cheap version.** Compute a proper smallest-enclosing ball `(c, R)` from the
  probe cloud (Welzl, or Larsson's fast approximate fitting) and use
  `|q - c| - R`. One extra `vec3` uniform; the validity argument is unchanged
  because a tighter enclosing ball is still an enclosing ball.
- **Stronger version.** Precompute a per-map — and per-fold-branch — bounding
  sphere for `f_j(A)` from the chaos-game cloud the app already generates, and
  use it instead of transporting the _global_ sphere through `sigma_min`. This is
  where the 0.13 DE/D lives: `regionDist` bounds a branch's output _region_,
  which is far larger than the piece of the attractor actually in it.

**Caution.** Per-branch spheres derived from a finite point cloud need an outward
pad that is itself certified, or the bound stops being a lower bound. Derive the
pad from the level-`k` Hutchinson contraction (`R * prod sigma_max`), not from the
sampling density.

**Literature.** Martyn, _Tight bounding ball for affine IFS attractor_, Computers
& Graphics 27(4), 2003 — this exact problem. Also Rice (GI 1996), Canright
(C&G 1994), Edalat/Sharp/While (Imperial College TR, 1996).

---

### 3.3 Make descent depth a function of cone radius, per march step

`uMaxDepth` is a per-frame uniform, clamped per tier by `previewMaxDepth` in
`src/app/render-tier.ts`. But a chain at depth `d` tracks a piece of diameter
`<= 2R * sigma_max^d`. Once that is below the ray's own footprint
(`uAcceptPixelEps * t`), descending further resolves detail smaller than the
pixel.

With `MAX_DESCENT_DEPTH = 128` (raised from 48 by fr-xok8), far rays are running
~100 levels to resolve features orders of magnitude under their footprint.

**Change.** Compute the depth cap inside the march loop from the current `t`:

```
dMax(t) = min(uMaxDepth, ceil(log(coneRadius(t) / (2R)) / log(sigmaMaxSlowest)))
```

**Soundness.** This is the same argument `previewMaxDepth` already rests on —
treating "chain still in-sphere at depth `d`" as a hit is correct _at that
resolution_ once the tracked piece is sub-footprint. Keep the fr-ttg5
contraction-aware clamp semantics; the change is making `t` an input rather than
using a single frame-wide value. Watch specifically for the return of the
"core-ball" artefact at the slowest map's fixed point (fr-xok8) — that is the
failure mode if the coupling is got wrong.

---

### 3.4 Build the empty-space grid on the GPU

`src/fractal/surface-grid.ts` currently runs a CPU worker with a 3-second budget,
downshifting a 64/48/32 ladder, and buys 8–13%. That is the tell that the
structure is too coarse, not that the idea is weak — a 32^3 grid over a fractal is
almost no information.

- The project already has WebGPU kernels (`flame-gpu.ts`, `flame-gpu-4d.ts`) and
  a device-acquisition/fallback ladder in `flame-worker-core.ts`. Reuse it.
- Evaluating the DE at 256^3 cell centres is embarrassingly parallel: seconds of
  CPU becomes milliseconds of GPU, and `pickSurfaceGridResolution`'s pilot-slab
  downshift ladder mostly stops being needed.
- Then add a **mip pyramid of the floors** and do hierarchical DDA (NanoVDB /
  ESVO style) rather than single-level `NEAREST` reads bounded by
  `SURFACE_GRID_SKIP_CAP = 256`. The skip cap exists precisely because
  single-level traversal takes many small steps through gaps.

Keep the existing f32-floor discipline (quantisation must never round a bound
_up_) and the "no-sync-fallback, pure enhancement" session semantics.

---

### 3.5 Specialise the branch set per spatial region (MPR's real trick)

This is the two-orders-of-magnitude idea.

Most of the 27/81 branches are irrelevant in any given region of space — the
module doc already notes that a branch whose cell the attractor never occupies
"just contributes a loose-but-true term". Today that term is still _computed_.

**Change.** During the grid build (§3.4), run interval arithmetic over each cell
to determine which branches can possibly matter there, and store a per-cell
**live-branch bitmask** alongside the distance floor. The shader iterates only
live branches.

- The grid build already visits every cell, so this is extra output from a pass
  already being paid for.
- 27 branches fits a `uint32` mask directly; 81 needs three, or a two-level
  scheme (3-bit spherefold mask + 27-bit box mask).
- Dropping a provably-empty branch is sound for the same reason as §3.1: an empty
  cell contributes `+inf` to the min.

**Reference.** Keeter, _Massively Parallel Rendering of Complex Closed-Form
Implicit Surfaces_, SIGGRAPH 2020 (`github.com/mkeeter/mpr`). Interval arithmetic
is used both to skip empty regions **and** to build reduced expressions for each
region; the paper reports expression complexity falling by two orders of
magnitude between the original and reduced forms, and identifies that reduction
as the thing that makes the method practical. The mapping onto this codebase is
almost one-to-one, with the fold-branch set playing the role of the expression
tape.

---

### 3.6 Precompute the descent tree (the structural move)

Biggest payoff, biggest rewrite. Makes fold branch count almost free by moving it
from per-query to per-system.

Adaptive-cut the Hutchinson expansion offline into a **sphere hierarchy**: each
node is `f_w(B)` with a centre and radius `R * prod sigma_max` over the word `w`.
Prune empty fold branches at build time. Stop subdividing when a node's sphere is
sub-pixel at the target scale. Then the per-pixel DE becomes a BVH nearest-sphere
query — on the order of 20–40 node visits, versus ~10^5 branch evaluations.

`dist(p, A) >= min_w (|p - c_w| - r_w)` over any _cover_ of the attractor, so
validity is inherited from the cover being complete. The build must therefore be
conservative about which branches it prunes.

Can be made view-dependent (expand deeper near the camera) — which is what the
uniform grid in §3.4 is a crude, non-adaptive approximation of. The two are
complementary: the grid handles empty-space skipping, the hierarchy handles the
near field.

**Literature.** Hart & DeFanti, _Efficient antialiased rendering of 3-D linear
fractals_, SIGGRAPH 1991 (unbounding volumes); Hart, Sandin & Kauffman, _Ray
tracing deterministic 3-D fractals_, SIGGRAPH 1989; Martyn, _Realistic rendering
3D IFS fractals in real-time with graphics accelerators_, Computers & Graphics
34(2), 2010 (adaptive-cut convex hulls of fractal subsets, self-similarity
exploited via hardware instancing to keep hundreds of fractals in VRAM).

---

### 3.7 Move the tracer to a WebGPU compute wavefront

Fixes factor C from the other end, and factor A's divergence.

A fragment-shader marcher forces every pixel in a warp to pay the **maximum**
step count and descent depth in that warp. Fold systems have brutal variance
(some rays terminate in 5 steps, some in 400), so the average pixel pays close to
the worst case.

**Change.** Ray queue in a storage buffer, compaction every N steps
("megakernels considered harmful", Laine et al. 2013 / wavefront path tracing).
Two consequences:

- divergence collapses to the compaction granularity;
- the frontier arrays can live in **workgroup shared memory** instead of private
  scratch, which is the direct fix for §1 factor C.

This also subsumes much of what `strip-planner.ts` does by hand, since compute
dispatches are naturally bounded.

**Prerequisite.** WebGPU availability is not universal; the WebGL2 fragment path
has to stay as a fallback, which means two tracer implementations against one
oracle. Weigh that against the measured win from §2 experiment 1 before
committing.

---

### 3.8 Cheap wins worth folding in opportunistically

- **Over-relaxation sphere tracing.** Keinert, Schäfer, Korndörfer, Ganse &
  Stamminger, _Enhanced Sphere Tracing_, STAG 2014 — safe over-relaxation with
  fallback on overshoot, plus a screen-space metric for choosing the intersection
  candidate. Typically ~2x, well-trodden, orthogonal to everything above.
- **Segment tracing.** Galin, Guérin, Paris & Peytavie, _Segment Tracing Using
  Local Lipschitz Bounds_, CGF 39(2), 2020 — computes the Lipschitz bound locally
  over a ray segment rather than globally, significantly reducing field-function
  queries with no extra acceleration structure. Attacks factor B directly.
- **Generalised Lipschitz tracing.** Bán & Valasek, CGF 2025 — a precomputed
  Lipschitz-field voxel hierarchy for _black-box_ fields, with ray intervals
  aligned to voxel boundaries. This codebase's DE is exactly a black-box field
  with wildly varying local Lipschitz behaviour, so this is a close fit and it
  composes with §3.4.
- **Screen-space beam prepass.** Laine & Karras, _Efficient Sparse Voxel
  Octrees_, I3D 2010 — trace at 1/8 resolution first to get a conservative
  per-tile start depth, then start full-res rays from there. Cheap, and it stacks
  with the existing tier system.
- **Interval/affine arithmetic for implicit surfaces.** Knoll, Hijazi, Kensler,
  Schott, Hansen & Hagen, CGF 28, 2009 — background for §3.5.

---

## 4. Recommended order

1. §2 — both instrumentation experiments. Do not skip; they decide 3 vs 7.
2. §3.1 — branch-and-bound ordering. CPU oracle, harness, then GLSL mirror.
3. §3.2 cheap version — centred enclosing ball.
4. §3.3 — per-step LOD depth.
5. Re-measure. If factor A is now under control, go to §3.4 + §3.5.
   If factor C dominated all along, go to §3.7.
6. §3.6 only if the above leaves it still short, and only with a written
   validity argument in the module doc first.

## 5. Things not to do

- Do not weaken the lower-bound guarantee to buy speed. The existing disclosed
  residuals (the `mandelboxKifs` 0.22%R erosion tail, `repro2+sym4y`'s ~9.8%R)
  are documented and bounded; new unbounded ones are not acceptable.
- Do not scale hit **acceptance** with tier or buffer resolution — fr-7xgi
  already established that this renders the fold DE's plateau band as phantom box
  faces. A preview may coarsen sampling, never acceptance.
- Do not lower `MAX_DESCENT_DEPTH` as a blunt speed fix — fr-xok8 documents the
  solid-ball artefact that causes. §3.3 is the correct form of that idea.
- Do not let the CPU oracle and the GLSL mirror drift. Any change here lands in
  `surface-de.ts` first with harness numbers attached.

## 6. Post-brief measured outcomes (2026-07-28 addendum)

The §3.7 compute-port hypothesis was spiked (fr-q1f8), measured, and shipped
as the fold surface session's preferred tracer (fr-tzdg,
`src/app/surface-compute.ts`) — though with the OPPOSITE internal shape to
§3.7's sketch: private per-thread frontiers beat the workgroup-shared layout
2-3.3x, and wavefront-style stage-2 compaction stayed off (1.4-1.6x slower).
The march itself landed at 49µs/ray where the fragment tracer was unbounded.

That victory moved the wall: with marching bounded, SHADING dominated
end-to-end frame cost — every hit paid ~40 zero-cutoff on-surface `surfaceDE`
evals (4 normal + up-to-32 shadow + 5 AO) through the full width-12 beam,
measured 740s for a 96x54 frame's 660 hits on Iris (unable to converge a
900s budget at a hit-dominated pose). This cost class is invisible to §1's
per-eval model because it is per-HIT, not per-march-step. fr-p8bc resolved
it: probe evals light a hit the full-width march already certified, never
decide geometry, so they ride a width-1 greedy descent — 23.8x cheaper
shading, eyeball-identical frames (a slight lightening of deep-crease
shadow/AO from the greedy overshoot; quality A/B leg in
`npm run bench:surface -- --surface-shade-width=N`).

The fragment-path port (fr-zqu8, `?surfshadewidth` runtime A/B in
`scripts/shade-width-ab.mjs`) then measured a second, unanticipated
inversion: the width-1 probe didn't grow the ~25s Mesa link the gate feared
— it CUT it 17.9x (cold links 25.5-26.4s -> 1.42-1.53s, n=3/arm,
`MESA_SHADER_CACHE_DISABLE=true`, Iris Xe). Mesa force-inlines GLSL calls,
so the pre-change program inlined the width-12 body at all ~7 `surfaceDE`
call sites (march + 4 normal taps + shadow + AO); with the value form
routed to a width-1 `surfaceDEProbe` (one template, two instantiations —
the WGSL twin's derivation discipline adapted to the fragment source), only
the march still inlines the monster. fr-5rvk's "a second full frontier body
pushed Mesa's compiler over the edge" was the same mechanism seen from the
other side — §1's cost model missed that COMPILE cost, like shading cost,
scales with call sites x width, not just per-eval work. The link collapse
also dissolved fr-f21s's link-watchdog session-death lottery (the A/B's
only context losses were baseline-arm, kernel silent throughout). Runtime:
boxfold-pair settles 509-987ms vs baseline 695-1296ms with settled frames
identical within session noise; mandelboxKifs's parked entry pose stays
unconverged-in-minutes in BOTH arms (its crease pixels are march-bound on the
fragment path — the width-12 march the probe deliberately leaves untouched;
fr-24to below discloses that grind as progress instead of bounding it —
the pose still grinds, legibly), but equal 210s windows resolve ~2.3x more
of the frame at width 1 (the shipped width). The fold-lens variant
deliberately carries no probe: its ~79KB source sits at the
resolveVariantArms-measured cliff, though the inlining discovery
suggests a lens probe might SHRINK its link too — an open follow-up, not
a shipped claim.

The runtime-mode verdict (fr-24to) resolved what to do when a monster
fold pose (mandelboxKifs's entry pose) makes even the bounded WebGL
preview unaffordable: crease pixels there cost ~272-287ms/px,
march-bound, and the floor-rung preview ran past 210s for a 4500px
frame with no terminal state, so it ground forever and the settle
behind it never armed. Bailing out of the render mode was rejected:
cost is pose-local, the WebGL path is already the fallback, and
post-fr-zqu8 entry now compiles in ~1.45s, so a bail-and-return would
only thrash. A preview rung below the shipped floor was rejected too:
each rung buys only ~2x while the gap at a monster pose is >=50-150x,
and the crease pixels that dominate cost stay march-bound at any
rung. A truncation contract shipped instead, in two calibration rounds, and both
were REVERTED. Round one ported the compute path's flat GPU-spend budget
onto the WebGL pump — past 4000ms of measured spend, stop refilling and
complete TRUNCATED, retiring the evidence raise-only (fr-id9r semantics)
— and clipped a completable heavy-lens preview on first contact: a 20-map
Menger sponge under a mandelbox final lens measured 62% traced with ~2.5s
left at the check, and truncating it swapped a complete whole-image blur
for a black top band the bottom-up settle would only repair minutes later
(fr-zx34). Round two switched the check from spend to PREDICTED remaining
work — remaining px times the max of the traced average and the pump's
marginal estimate, a band-vs-wobble spike factor meant to catch a preview
sliding into a newly-discovered expensive band without over-reacting to
ordinary per-strip noise — giving up only past another budget's worth of
predicted work, a 3x grace cap against estimate-lagging bands. It still
misfired, at zoomed poses on the same Menger-lens system: those poses
measured an honest ~14-19ms/px with correctly-predicted 53-83s remaining
— comfortably worth finishing by any reasonable eye — while the true
monster's early check averaged a MISLEADING ~47s remaining against a true
preview running past 210s, because its cost is banded (mostly cheap traced
pixels, a handful of multi-second crease pixels not yet sampled) rather than
uniform. The two classes are INVERTED on average cost at any early check:
the pose that should finish predicts more expensive than the pose that should
give up. That inversion is why prediction kept misfiring — no threshold
on one early-check number can rank both directions correctly at once.

The final verdict is the user's: no automatic truncation. An
automatic give-up decides for the user what only the user can weigh, so
`surfaceRenderProgress()` reports honest traced-px coverage of the in-flight
preview/settle job — no time predictions, by design — and a surface
progress row renders it ("Preview 43%" / "Full detail 0.4%", one decimal
under 10% because a monster settle advances ~1%/min and an integer row parked
at 0% reads as stuck, hidden entirely when nothing is grinding). The user
reads the rate and decides whether the pose is worth the wait.

Measured after (Iris Xe, real driver): the Menger-lens mid pose climbs
Preview 1.2% -> 5.3% -> 16% -> 93% -> complete at 16.4s spentMs, settle arms
on completed evidence, then Full detail 0% -> 0.1% and climbing; the preset
monster pose parked for 60s logs 120/120 responsiveness pings, ~0s stalled,
0 errors, kernel silent, and never arms a settle at all — by decision, not
by bug, on the same bounded-strip machinery (fr-096u/fr-id9r) that made the
grind safe to begin with. Truncation was never load-bearing for that safety.

What survives from the branch, orthogonal to truncation and unaffected
by its reversion: the capture cost ceilings (a predict-ceiling refusal,
and a spend ceiling on the drain itself) and save-PNG's "Render anyway"
opt-in — a single consented escalation that skips the predict ceiling
and raises the spend ceiling to `SURFACE_CAPTURE_OPTIN_SPEND_CEILING_MS`
(300s). Offline export stays loud-fail, thumbnails keep the silent explorer
fallback, and `formatGpuMinutes`' hours tier — needed once truncated-monster
evidence started putting hour-scale predictions into refusal messages —
is module-private again.
