# Space Tiling — finite reflection and mirrored-lattice contract

The frozen record for both space-tiling constructions. The finite-reflection
phase fixes the group vocabulary, the fold-to-chamber algorithm and its bound,
the wrapper order and the exact composition, the renderer and wire matrix, the
legal-combination table and the refusals with their reasons. The lattice phase
selects affine A1 mirror repetition, fixes its 3D/4D and unbounded-march
semantics, and refuses classic translational opRep. Both extend the same
`TilingSpec` and resolver; there is no second landscape model.

## The rendered set and the soundness theorem

The rendered set is the group orbit

    T = G · S,   S = A ∩ C ∩ clip

where `A` is the attractor (or escape/bulb set), `C` the group's closed
fundamental chamber (a Coxeter orthoscheme, the cell of the tiling), and
`clip` an optional authored `ShapeSpec` that may only narrow `S` — by
construction, since intersection never widens.

**Theorem (nearest copy):** let `G` be a finite reflection group, `C` its
closed chamber, `F` the fold-to-chamber map, and `S ⊆ C` any closed set. Then
for every query `q`,

    d(q, T) = d(F(q), S).

_Proof._ (`≤`) `F(q) = w(q) ∈ C` with `q ∈ w⁻¹(C)`, so the copy `w⁻¹(S)`
sits in `q`'s chamber: `d(q, T) ≤ d(q, w⁻¹S) = d(wq, S) = d(F(q), S)`.
(`≥`) for any `g`, `d(q, gS) = d(g⁻¹q, S)`; the fold path of `g⁻¹q` is a
sequence of wall reflections each of which satisfies
`|m' − s|² = |m − s|² + 4⟨m, n_i⟩⟨s, n_i⟩` with `⟨m, n_i⟩ < 0` and
`s ∈ C ⟹ ⟨s, n_i⟩ ≥ 0`, so each step strictly reduces the distance to every
`s ∈ S` — the fold is a metric retraction toward `S`, and the copy nearest
`q` is always the one in `q`'s own chamber. ∎

**Composition.** With `q' = F(q)` the estimator is

    estimate(q) = max(DE(q'), clipDist(q'))

where `DE` is any untouched core estimator and `clipDist` the authored
clip's conservative SDF (absent clip: the term vanishes). Soundness is the
chain `DE(q') ≤ d(q', A) ≤ d(q', A∩C∩clip) = d(q', S) = d(q, T)` — the
first inequality is the core's own lower-bound guarantee, the second is set
inclusion, the equality is the theorem. **The chamber enters ONLY through
the fold.** The wall distance `d(q', Cᶜ)` is deliberately NOT a term: as a
max term it is unsound (a content point at distance 0.5 from a wall has
wall-distance 0.5 > 0), and as a min term it shades the wall as geometry.
The "intersect with the chamber" of the epic's design sketch is realised by
the fold + the estimator's own property, not by an explicit term.

**False chamber wall — the disclosed hazard.** At a chamber wall, the DE at
the folded point can be small because of attractor pieces on the far side of
the wall, which are not content. The marcher stops where the estimate is
below its epsilon, so a wall point can be rendered as geometry while the
content is far. The mitigation is the crossing-point argument: the attractor
is closed, so where its far-side pieces approach the wall its crossing points
`A ∩ wall` (which ARE content — the chamber is closed) are nearby, and the
stop is then correct. The residual case is an attractor piece that
approaches the wall without crossing — a long tentacle — and the authored
clip, whose term keeps the marcher marching toward the clip, is the in-hand
mitigant. The finite-tiling harness measures this on every ship fixture; any
false chamber wall on a fixture is a no-go that changes this contract, not a
tolerance to raise.

## The group vocabulary

Shipped finite reflection groups, by dimension. H4 is REFUSED (order 14400
— no real-time use; no fixture needs it) and the reducible products
(A1³ etc.) are REFUSED for phase 1 (the fold composes per-factor, so they
are a cheap later extension — the boxfold branch sweep is exactly the A1³
tiling vocabulary, which this feature deliberately does not re-implement).

| group                  | order | simple-root pairings      | max word length (fold bound) |
| ---------------------- | ----- | ------------------------- | ---------------------------- |
| A3 (tetrahedral)       | 24    | path, all `-1/2`          | 6                            |
| B3 (octahedral)        | 48    | `-1/2, -√2/2` chain       | 9                            |
| H3 (icosahedral)       | 120   | `-φ/2, -1/2` chain        | 15                           |
| A4 (pentatope)         | 120   | path, all `-1/2`          | 10                           |
| B4 (16-cell/tesseract) | 384   | `-1/2, -√2/2` chain       | 16                           |
| F4 (24-cell)           | 1152  | `-1/2, -√2/2, -1/2` chain | 24                           |

Root conventions, frozen: simple roots `n_i` are unit vectors with pairings
`⟨n_i, n_j⟩ = −cos(π/m_ij)` (the Cartan matrix of the diagram), chosen as the
inward normals of the chamber walls, so the closed chamber is exactly
`C = {x : ⟨x, n_i⟩ ≥ 0 for all i}`. The exact literal root tables live in
`tiling.ts` and are pinned by group-axiom tests: pairwise inner
products, reflection closure (the orbit of each root is the full root
system), the orbit count = group order, and the max word length. The 4D
tables use real named 4D axes — the F4 roots genuinely use `w` — and the
fold reads roots by name, exactly as the escape4 core reads
`SYM_PLANE_CODE4` and NOT the descents' `SYM_PLANE_CODE` (which collapses
`xw`/`yw`/`zw` onto their w-free twins — sound for a swept matrix, wrong
for a fold).

## The fold-to-chamber algorithm and its bound

`F(q)`: while any simple wall is violated (`⟨q, n_i⟩ < 0`), reflect across
the MOST violated wall: `q ← q − 2⟨q, n_i⟩ n_i`. Deterministic; every step
is an exact isometry, so `|F(q)| = |q|` and every sphere gate the cores
read is unchanged.

Termination is proven, not assumed: for `q ∈ w(C)` the classical simple-root
criterion gives `l(s_i w) < l(w)` for every violated wall `i`, so the fold
path strictly reduces the chamber's word length and lands in `C` in at most
the group's maximum word length — the last column above, F4's 24.

**The bound is 32 everywhere, with a conservative guard.** `MAX_TILING_FOLD_STEPS
= 32` (the proven 24 plus f32 wall-jitter margin: at a wall the pairings
oscillate at f32 noise, so a few extra bounces are possible and covered).
After the cap, if any pairing is still negative the estimator returns 0 —
fully conservative, never an overshoot. The stop test uses a small negative
tolerance (`⟨q, n_i⟩ ≥ −FOLD_EPS`, `1e-6` world units) so a f32-folded point
sitting ε-outside the chamber is accepted; the soundness gap this opens is
bounded by `2·FOLD_EPS` (the fold retraction property), i.e. sub-pixel, and
the CPU oracle uses the same constant so CPU/GPU agree.

## Wrapper order and the estimator composition

The tiling wrapper owns the public estimator entry names and calls the
untouched cores, the `descendLens`/`descendLens4` idiom (cores stay
byte-identical when tiling is absent; the wrapper token-renames and the
wrapper owns the public names). Evaluation order, frozen:

1. **Tiling fold** — `q' = F(q)` into the chamber. Once, before anything
   else in the estimator path.
2. **Kaleidoscope** — see the refusal below; phase 1 never combines them.
3. **Lens** (descent cores' `foldFinal`): internal to the estimator, applied
   after the tiling fold. A query-space PRE-fold (tiling) and a plot-time
   POST-fold (lens) compose by construction.
4. **The estimator core** — `descend`/`descendFold`/`descendLens`,
   `descend4`/`descendFold4`/`descendLens4`, or the forward
   `estimateEscapeDistance`/`estimateBulbDistance`/`estimateEscapeDistance4`.
5. **Max with the clip** — `clipDist(q')` (absent clip: no term).

The empty-space grid, the shading probe taps (normal/shadow/AO), the
march-epsilon cutoff and the visible/bounding sphere contracts all ride the
wrapper — every estimator evaluation, probe included, folds first.

## Renderer matrix (frozen)

| route                                                            | tiling                                                                                                                                                                                                               |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CPU oracles: affine, fold, affine4, fold4, escape, bulb, escape4 | in — the wrapper above                                                                                                                                                                                               |
| WGSL cores: affine, fold, affine4, fold4, escape, bulb, escape4  | in — compile-gated wrapper                                                                                                                                                                                           |
| GLSL tracers: 3D and 4D                                          | in — compile-gated arm; Mesa cliff measured before                                                                                                                                                                   |
| Points, Flame, Solid                                             | NOT in — a query-space fold has no chaos-game meaning. The authored block persists and those modes render the UNTILED attractor with the adjacent explanation; a document never silently renders a different object. |

### GLSL landing evidence

The 3D and 4D fragment tracers compile the wrapper only when a resolved
tiling block is present. `tilingFoldSource` is the shared, dialect-parametric
source authority over the frozen roots and fold arithmetic; the material arm
token-renames the existing estimator entries and owns their public overloads.
The one live GLSL uniform is the one-based group code (`0` remains off), while
the roots and analytic `tilingClipSdf` are source-baked. Material installation
also requires the canonical `TILING_GROUP_INFO[group]` object by identity, so
a forged or stale resolved record cannot compile a different root table under
the same group word.

Hit attribution follows the folded source copy for height, radius and
object-attached pattern. Normals, lighting, the ground plane, finish position,
reflection and fog deliberately retain the visible world position: those
describe where the replicated copy is drawn, not which chamber copy supplied
its material. In 4D the outer wrapper folds the true
`uInvRotor * vec4(p, uW0)` query, then hands that folded vec4 to the untouched
sliced estimator through the same token-rename adapter; a nonzero slab remains
refused.

Source-generation tests enumerate every legal source option combination,
including clip absent/present: 336 in 3D and 128 in 4D, plus all six compatible
group/dimension pairings. Every emitted source remains below the unchanged
65,536-byte strip ceiling. Measurements on the landed generator, in resolved /
emitted bytes:

| compiled arm                                 | resolved | emitted |
| -------------------------------------------- | -------: | ------: |
| 3D A3 plain                                  |   86,521 |  32,025 |
| 3D A3 + sphere clip                          |   86,794 |  32,285 |
| 3D A3 + lens                                 |   89,792 |  31,849 |
| 3D A3 + plane                                |   94,387 |  35,498 |
| 3D A3 escape                                 |   59,324 |  59,324 |
| 3D A3 bulb                                   |   42,836 |  42,836 |
| 3D A3 + finish + pattern                     |  100,480 |  42,325 |
| 3D A3 + condensation + schedule + chaos      |  101,560 |  42,693 |
| 4D F4 plain                                  |   67,056 |  19,229 |
| 4D F4 + sphere clip                          |   67,341 |  19,501 |
| 4D F4 + plane                                |   75,892 |  22,702 |
| 4D F4 + finish + pattern                     |   79,800 |  29,488 |
| 4D F4 + condensation + schedule + chaos      |   76,575 |  26,526 |
| 3D H3 clip + every descent arm               |  127,771 |  56,373 |
| 3D H3 clip + escape + finish + geometry trap |   64,650 |  64,650 |
| 4D F4 clip + every legal arm                 |   99,661 |  41,464 |

The tightest emitted row has 886 bytes of headroom under the strip ceiling;
real-driver link/render qualification is serialized with the integrated
routing build rather than run beside concurrent shader work.

The 2026-08-31 Iris production-browser run exercised eight hash-authored legs:
forced WebGL and WebGPU for inverse 3D, forward 3D and inverse 4D; compute for
forward 4D; and a second WebGL inverse-3D leg with an analytic clip. Every leg
entered through the real Surface button, chose the requested engine, settled,
preserved the tiling block in the document hash and drew foreground on a
hardware backend. The final clip leg changed 8.40% of the comparison image
against a
1% floor. The first run caught a GLSL-only wrapper typo in the clip arm—an
out-of-scope local left over from the fold-result spelling—which source-text
tests had asserted rather than compiled; the corrected generated source and
the browser verifier now pin that path. The runnable record is
`scripts/surface-tiling.verify.mjs`.

The finite authoring/preset gate (`scripts/tiling-ui.verify.mjs`) then drives
the real top-level panel and Systems menu rather than installing hashes. On a
verified Iris display, all three showcases reached a settled 8/8 frame and
their same-camera untiled negative controls differed structurally: B3
Octahedron 5.75% on WebGL, A4 Pentatope 5.19% on compute, and F4 24-Cell 8.47%
on compute. The same run pinned preset absence clearing, 44px targets, trusted
keyboard group/clip edits, exact undo/redo, the app-produced Copy Link reload,
Points/Flame/Solid disclosures, and Balloon/Symmetry dormant-detail recovery.
The executable header carries the complete coverage rows and software-run
qualification.

Forward cores get the fold free (they are in) — their kaleidoscope already
is a query-space wedge fold by `escape-de.ts`'s own argument, and the same
1-Lipschitz/pre-fold reasoning applies to the tiling fold with the
composition chain above.

## Legal combinations and refusals (frozen)

| combination                                                      | verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| tiling + ground plane                                            | composes — the landscape case; the plane is world-space in the sliced 3D space, the fold never touches it                                                                                                                                                                                                                                                                                                                                                    |
| tiling + lens (`foldFinal`)                                      | composes — pre-fold vs post-fold                                                                                                                                                                                                                                                                                                                                                                                                                             |
| tiling + condensation / schedule / chaos / shape trap / finishes | compose — they live at the estimator/orbit level                                                                                                                                                                                                                                                                                                                                                                                                             |
| tiling + balloon                                                 | REFUSED, adjacent reason — the sphere-inversion echo of an orbit is not the orbit of the echo; no certified composition, and a filled solid's interior reaching the ball centre swallows the camera (the balloon's own IFS-only verdict)                                                                                                                                                                                                                     |
| tiling + kaleidoscope                                            | REFUSED, adjacent reason — both are query-space folds and the composition argument differs per family (the descent cores sweep the rotation INSIDE the descent, after the tiling fold — the estimate then has no certified lower-bound order; the forward cores' foldK-then-foldT composition IS sound, but one uniform routing rule beats a per-family matrix). The fixtures never combine them; a later certified order requires its own measured delivery |
| tiling + 4D slab (`halfExtent > 0`)                              | REFUSED, adjacent reason — the fold of a segment is a bent polyline (per-point reflection sequences), and the slab's conservative-bound contract does not survive it. Tiled 4D sessions run slice 0 (the shipped default)                                                                                                                                                                                                                                    |
| tiling + H4 / reducible groups                                   | REFUSED — vocabulary above                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| tiling + escape4                                                 | in — no slab, no lens, no kaleidoscope by the refusals above; the forward orbit is seeded at the folded point exactly as its kaleidoscope seeds at the sector-folded point                                                                                                                                                                                                                                                                                   |

## Finite wire placement (frozen rule)

The tiling block is ONE `u32` (the group id; it also keys the compile gate —
a stale buffer from a different group is refused at pack). The roots are
baked constants in the emitted source per group (the `shapeSdfSource`
discipline — group switches are source-regenerating edits, restarting
through the established lifecycle), and the clip is entirely source-generated
from `shapeSdfSource`, so the wire carries no clip data. A clip whose parts
include a catalog MESH is refused until the mesh-SDF delivery extends to
the tiling clip (analytic specs only in phase 1).

Placement: the block appends at the END of every legal combination — after
the frozen variant/lens/plane-balloon/trap tails and after the
condensation/schedule/chaos tails that follow them, so every existing
combination constant gains a `_TILING` twin with a **16-byte aligned tail**,
not a four-byte tail. In the finite arm the first word is the one live `u32`
and the remaining 12 bytes are zero padding. The largest pre-tiling 3D
combination ends at 544 (`PLANE_SCHEDULE_CONDENSATION_CHAOS`) and grows to
560; the 4D maximum grows from 832 to 848. The tiling word therefore lands at
544/832 in those maximum combinations and at each smaller combination's own
aligned tail otherwise. Every combination constant is exported and test-
pinned; the standing hazard note applies verbatim (a block appended blind at
4D offset 560 lands INSIDE the `lens4Fold` quartet).

## Document vocabulary and applicability

`TilingSpec { group, clip? }` — scene-level, one per document, beside
ShapeTrap and HybridSchedule — is the finite arm; the lattice arm is defined
below. ABSENT MEANS OFF byte-identically: no block, no arithmetic, every
emitted shader byte for byte the pre-tiling build.
`resolveTiling` is the ONE authority for defaults and domains (the
`resolveFoldRadii`/`resolveShapeTrap` precedent); persistence carries
authored values at fidelity and the resolver owns the clamps. The group is
discrete — morphs never interpolate it (the target's block pops at the leg's
first push, the HybridSchedule precedent); the clip follows the ShapeTrap
morph precedent. A malformed block decodes to undefined, never rejects the
scene. The panel family is authored scene geometry (placed under the rules in
`docs/panel-ia.md`); the group cell is NEVER presented as a
free-form clip and vice versa.

## Evidence owed (summary)

The finite harness sheet (`scripts/tiling.harness.ts`) measures, with the
SHARED instruments only:
zero overshoot against membership and explicit orbit-enumerator oracles on
every ship fixture (the explicit enumerator is the test oracle of
`tiling.ts`, never a runtime path); the fold-step distribution; per-query
cost; visual distinctness; and the pre-tiling resolved/emitted GLSL lengths
for the largest 3D and 4D combinations against `SURFACE_GLSL_STRIP_BYTES`
and the real Mesa link cliff — MEASURE BEFORE ADDING THE PARAGRAPH.
`npm run bench:surface` on a verified Iris display pins the kernels
(glxinfo must say `Mesa Intel(R) Iris(R) Xe`, never SwiftShader). The
fixtures ship at least one 3D and two genuinely 4D groups from the table
above, entering Surface unaided, settling, drawing distinct tiled geometry
and taking the expected engine.

## Phase 2: mirrored affine A1 lattice

**Decision: ship mirrored repetition; defer certified translation and refuse
unclamped translational opRep.** The executable argument is
`scripts/lattice-tiling.harness.ts`; its measured rows are catalogued in
`docs/harness-sheets.md`.

### Cell, content and fold

The cell has one scalar half-width `h`, is centred at the canonical origin,
and has no separately authored pose. In 3D it repeats attractor-frame `x` and
`z` and leaves `y` vertical. In 4D it repeats attractor-frame `x`, `z` and `w`
and leaves `y` vertical. One scalar fold is

    mirror(x, h) = h - abs(mod(x + h, 4h) - 2h),  h > 0

with `mod(a,b) = a - b floor(a/b)`. Its closed chamber is `[-h,h]`, its full
period is `4h`, and adjacent periods alternate orientation. The CPU, GLSL and
WGSL bodies use this exact floor formulation; shader copies do not substitute
a remainder operator whose negative-input convention differs. The vector
folds are

    F3(x,y,z)   = (mirror(x,h), y, mirror(z,h))
    F4(x,y,z,w) = (mirror(x,h), y, mirror(z,h), mirror(w,h)).

The content is `S = A ∩ ball(0,R) ∩ clip`, where `R` is the estimator's
certified full visible radius (the full 4D `visibleBoundingRadius` in 4D,
never the slice-adjusted radius). The resolver must enforce `h >= R`; this
puts `S` inside the closed chamber. The public estimate is

    max(coreDE(F(q)), length(F(q)) - R, clipDist(F(q))).

The ball and clip terms are absent only when their authorities prove them
redundant. Product reflections are isometries and the fold is a metric
retraction toward every point of the rectangular chamber, so the finite
nearest-copy theorem applies to this infinite affine reflection group:
`d(q, G·S) = d(F(q), S)`. One core evaluation follows two fixed scalar folds
in 3D or three in 4D; there is no data-dependent fold loop.

The cell walls are not geometry. The fold value is continuous there (only its
derivative changes sign), and a wall query evaluates the ordinary content DE;
it returns zero only when real content reaches the wall. Primary marches,
normal taps, shadow rays and AO taps all call the same scalar wrapper. There is
no wall-distance min, zero-seam status, epsilon nudge, or special shading path.
The finite presentation window below also bounds query magnitudes, so shader
arithmetic never relies on preserving a modulo phase thousands of cells from
the origin.

The document model becomes a discriminated union with a lattice arm beside
the existing finite `{ group, clip? }` arm. Its authored cell size is a
dimensionless `cellScale = h/R`; the resolver alone derives world-unit `h`
from the current estimator. Absent tiling stays byte-identically off. A
lattice program uses the same 16-byte WGSL tail: the first word is the lattice
kind code, the next `f32` is resolved `h`, and the final eight bytes remain
zero. GLSL receives the same `h` through its lattice-only uniform. Changing
kind remains a source-regenerating edit; changing cell scale is a geometry
edit and restarts accumulation without recompiling the formula.

**PROVISIONAL, not gated by this sheet:** `cellScale` default 1.5 and authored
range 1.25–4.0. The mathematical gate proves only `cellScale >= 1`; the
default and narrower minimum/maximum require real renderer fixtures and a UI
range gate before they can be frozen.

### Landed CPU and document authority

`tiling.ts` now owns the complete discriminated union and resolver. The legacy
finite wire remains exactly `{ group, clip? }`; the lattice wire is
`{ kind: "lattice", cellScale, clip? }`. Lattice scale is required, finite and
at least one. The resolver does not invent a default or maximum: its caller
supplies the estimator's certified origin-centred visible radius and it derives
`h`. Persistence keeps the arms distinct and evolution validation requires
their exact field shapes. There is no authored maximum; resolution does reject
a particular scale/radius pairing when its full `4h` period cannot fit the
frozen f32 shader representation, because accepting a CPU-only period would
make the two renderer authorities disagree.
Morphing two lattice blocks with the same clip linearly interpolates authored
`cellScale`; finite-to-lattice, lattice-to-finite and incompatible clips pop to
the target block at the leg's first push, matching the discrete global-block
rule.

`tiling-de.ts` is the dependency-free CPU estimator authority for all seven
inverse and forward families in 3D and 4D. It performs one mirrored fold, one
unchanged core call, the mandatory certified-ball max and the optional clip
max. Exact seams, negative and large-period coordinates, x/z versus x/z/w,
inverse-rotated 4D queries and both plain/refined entries are unit-pinned. The
deterministic decision sheet now calls the production scalar fold; its exact
orbit, seam, overshoot, false-wall and preview rows reproduce the recorded
mirrored-repetition verdict.

`lattice-march.ts` owns the renderer-independent finite-presentation math but
chooses no presentation ratio. A caller must supply an explicit outer radius.
It intersects that sphere with the attractor-y slab, including an arbitrary
inverse-rotated 4D slice, and exposes the same interval to primary marching,
normal/AO membership, finite shadow reach and fog distance-from-entry. Its
reference marcher has explicit hit, miss, exhausted and stalled terminals;
the independent membership oracle, not the scalar march status, detects false
zero seams. Tests pin tangent/inside/non-unit/parallel/near-parallel rays,
negative far intervals, carrier formulas and content/ground hit ordering.

Surface eligibility currently refuses the lattice arm with an adjacent reason.
That is deliberate rather than a renderer verdict: GLSL/WGSL emission, live
carrier/fog/shadow/AO use, ground composition, capture/strip limits and camera
wiring remain gated together so a persisted lattice document cannot silently
render the finite or untiled object.

### Genuine 4D meaning

The view query is lifted and inverse-rotated first,
`q4 = invRotor * vec4(p, w0)`, then `F4` folds its attractor-frame `x/z/w`.
Thus the live rotor rotates the whole lattice with the object, while moving
the slice changes the phase and cross-section of the same fixed 4D lattice.
Folding in view 3D or omitting `w` would draw a different object and is
refused. The decision sheet pins an xw rotation of 0.63 at `w0 = 0.37`
against an explicit 4D orbit (zero violations in 20,000 queries). A thick 4D
slab remains refused: folding a segment point-by-point makes a bent,
multi-cell path and the existing segment bound does not survive it.

### Finite presentation of an unbounded set

The visible sphere can no longer mean “the object ends here.” A lattice ray
instead intersects two analytic presentation carriers:

1. the origin-centred 3D presentation window; and
2. the unrepeated-axis slab `abs(q.y) <= R` in attractor space (in 4D,
   `q = invRotor * vec4(p,w0)`, so this is still a linear ray/slab
   intersection at an arbitrary rotor pose).

Their intersection supplies `tEnter` and `tFar`; a camera already inside
starts at zero. A miss goes directly to the backdrop or ground plane. Every
primary, preview and capture ray retains the existing full-DE step budget and
cancellation points, but it stops at this finite `tFar`; no loop searches for
the “end” of an infinite set. Fog measures distance from this `tEnter` and
uses `R` as its scale. Capture bands use the same world-space carriers and
full-image background coordinates as the live frame, so resolution, strip
height and supersampling never change which cells exist. The camera fits the
canonical cell carrier — conservatively `sqrt(2h^2 + R^2)` in 3D and
`sqrt(3h^2 + R^2)` before the 4D slice — targets the canonical origin, and
never tries to fit the lattice's global extent.

Normal and AO taps outside the carriers are treated as open space. Shadow
rays intersect the same carrier pair and become fully lit after their own
`tFar`; both use the mirrored DE inside. This prevents the artificial hard
window from casting a shadow or contributing AO. The existing step/tap caps,
capture raster limits, strip pump and abort/cancellation behavior remain the
runtime limits.

**PROVISIONAL, not gated by this sheet:** fade lattice coverage/fog to the
backdrop from radius `8R` and stop at the hard `10R` presentation window. The
sheet's preview uses a fixed radius of ten _cell half-widths_ only to compare
the candidates; it does not gate the 8R/10R choice. Those constants require
live GLSL/WGSL capture and grazing-ray measurements before freezing.

### Ground plane

The plane stays ordinary sliced-view 3D geometry, at the existing
origin/radius-derived height, and is never folded. Its intersection competes
with the lattice carrier's nearest hit and retains the existing radial fade.
It receives shadows and contact AO from repeated content through the same
mirrored estimator, clipped to the same presentation carriers. The current
single-ball corridor and “too far from the ball for AO” shortcuts are invalid
for an infinite lattice and must be disabled or replaced by carrier tests in
the lattice arm. This is especially load-bearing in 4D: an arbitrary rotor
tilts the attractor-frame carrier relative to the world-space plane, but the
plane itself stays horizontal and unfurled.

### Translation refusal

Classic half-open opRep chooses one cell discontinuously. For asymmetric
cell-contained content the selected representative need not contain the
nearest translated copy, so the returned DE can exceed the true union
distance; the sheet measured 12,753 overshoots in 50,000 probes, up to
0.760348. It is refused outright.

Taking `min(opRepDE, distanceToCellWall)` repairs the lower bound but makes
every wall exactly zero. The sheet found 1,407 false-zero samples out of
1,407 wall probes while true geometry stayed at least 0.504497 away, and the
shared marcher shaded all 25,600 pixels as false walls. Making those zeros
non-geometry requires a two-channel distance/cell-crossing result through the
primary march, normals, shadows and AO; a scalar epsilon skip is not a proof.
Exact neighbour union avoids the seam, but even the directional minimum needs
four core evaluations per 3D query and eight per 4D query (the deliberately
simple sheet oracle uses nine in 3D). Certified translation is therefore
deferred until one of those complete contracts earns its cost. It must never
be approximated by unclamped opRep or by shading a wall clamp.
