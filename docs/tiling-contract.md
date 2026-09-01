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

## Finite-reflection renderer matrix (frozen)

| route                                                            | finite reflection                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CPU oracles: affine, fold, affine4, fold4, escape, bulb, escape4 | in — the wrapper above                                                                                                                                                                                               |
| WGSL cores: affine, fold, affine4, fold4, escape, bulb, escape4  | in — compile-gated wrapper                                                                                                                                                                                           |
| GLSL tracers: 3D and 4D                                          | in — compile-gated arm; Mesa cliff measured before                                                                                                                                                                   |
| Points, Flame, Solid                                             | NOT in — a query-space fold has no chaos-game meaning. The authored block persists and those modes render the UNTILED attractor with the adjacent explanation; a document never silently renders a different object. |

### GLSL landing evidence

The 3D and 4D fragment tracers compile the wrapper only when a resolved
finite-reflection block is present. `tilingFoldSource` is the shared, dialect-parametric
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

The authoring/preset gate (`scripts/tiling-ui.verify.mjs`) drives the real
top-level panel and Systems menu rather than installing hashes. On verified
Iris, all five showcases exposed progress and reached a settled 8/8 frame:
B3 WebGL drew/differed from untiled by 40.22%/6.62%, A4 compute
40.18%/5.23%, F4 compute 38.99%/8.39%, lattice-3D WebGL 46.85%/13.23%, and
lattice-4D compute 37.42%/0.29%. The last uses a fixture-specific 0.20%
structural floor because its untiled projection fills almost the same
carrier. The same run pinned exact finite→lattice→finite→absent replacement,
the exact 2.4 numeric edit, finite and lattice app-produced Copy Link reloads,
and the lattice link's WebGL progress→settled render at 46.85%. It also pinned
three lattice-authored untiled-mode disclosures, Balloon/Symmetry recovery,
and whole-block fallback for three malformed wire shapes while preserving a
distinctive valid surrounding scene.

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
`docs/panel-ia.md`). Its kind selector converts between Reflection group and
Mirrored lattice while preserving their shared clip; group and cell scale are
arm-specific rows, and the group cell is NEVER presented as a free-form clip
or vice versa. The optional clip selector is shared by both arms and offers
only the three analytic catalog entries (Cog, Orbit Ring and Peace sign). The
six mesh-backed catalog entries are omitted because every offered value must
be eligible for Surface; a mesh clip arriving in an imported document remains
preserved and reads as Authored clip while the existing analytic-only refusal
stays in force.

The original clip editor was a measured dead end for two independent reasons.
Six of its nine offered entries were those refused mesh clips, so choosing one
disabled Surface. The remaining three were unit shapes at the origin, while
the folded chamber content of the shipped systems lay 0.4–1.6 world units
out: across the overlap probes, 0 of 399,000 content samples lay inside any
unposed analytic clip. The positive clip term then dominated
`max(DE, clipDist)` and the eligible choices rendered an empty or nearly empty
frame.

`chamber-content.ts` fixes the placement at the session boundary without
rewriting the document. For an inverse-descent system it runs a deterministic
20,000-point chaos game, folds every point through the renderer's own finite
or lattice fold, and fits the folded xyz centroid and radius; every part of an
entirely unposed flat clip receives that common offset and scale in the
session's resolved copy. If any part carries an authored offset, rotation or
scale, the whole composition remains authored and untouched.
Forward escape/bulb systems use their certified bailout ball at the origin
instead, because their chaos games sample reset debris rather than the set.
An authored pose always wins, and an automatic pose is derived again on every
Surface entry so morphs and randomize cannot leave it stale. The posed Cog
retained 12% of the measured B3 chamber content where the origin pose retained
none; on verified Mesa Intel Iris Xe the resulting frame drew 33.6% foreground
against 36.3% unclipped, where the pre-fix clipped frame was empty.

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
kind or clip remains a source-regenerating edit and restarts Surface. Cell
scale is absent from the source-regeneration key and updates the GLSL uniform
or WGSL params live per frame, without restarting the session; the adjacent
timing hint discloses the active arm's behavior.

**FROZEN authoring verdict:** the lattice panel range is 1.25–4.0, with step
0.05 and default 1.5. The mathematical domain remains `cellScale >= 1`, and
imported documents outside the panel range remain legal; the narrower range
is an authoring choice, not a resolver refusal. The 2026-08-31 verified Mesa
Intel Iris Xe sweep exercised these rows; all 14 sessions were eligible,
settled and drew with no page errors:

| `cellScale` | 3D foreground | 4D foreground |
| ----------: | ------------: | ------------: |
|        1.05 |         62.4% |         41.1% |
|        1.25 |         55.1% |         37.7% |
|        1.50 |         49.1% |         36.2% |
|        2.00 |         41.5% |         35.6% |
|        3.00 |         36.5% |         34.3% |
|        4.00 |         34.6% |         34.0% |
|        5.00 |         34.2% |         33.8% |

The frozen panel band lies inside the two tested guard rows (1.05 and 5.0),
while imported documents retain the resolver's wider mathematical domain. The
exact-numeric panel gate pins the range and the slider's target, trusted touch
and keyboard behavior. A post-wiring continuity probe on the same verified
Iris changed 1.6 to 3.5 in a 3D WebGL session and a 4D WebGPU compute session:
both retained the current first-frame gate (no session re-entry), invalidated,
settled again, and reported zero page errors.

### Landed CPU and document authority

`tiling.ts` now owns the complete discriminated union and resolver. The legacy
finite wire remains exactly `{ group, clip? }`; the lattice wire is
`{ kind: "lattice", cellScale, clip? }`. Lattice scale is required, finite and
at least one. The resolver does not invent a default or maximum: its caller
supplies the estimator's certified origin-centred visible radius and it derives
`h`. Persistence keeps the arms distinct and evolution validation requires
their exact field shapes. There is no authored maximum; resolution does reject
a particular scale/radius pairing when `h` rounds to zero or its full `4h`
period rounds to infinity on the frozen f32 shader wire, because accepting
CPU-only arithmetic would make the two renderer authorities disagree.
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

`lattice-march.ts` owns the renderer-independent finite-presentation math and
the renderer-only normalized policy. Its carrier intersects the resolved
outer sphere with the attractor-y slab, including an arbitrary
inverse-rotated 4D slice, and exposes the same interval to primary marching,
normal/AO membership, finite shadow reach and fog distance-from-entry. Its
reference marcher has explicit hit, miss, exhausted and stalled terminals;
the independent membership oracle, not the scalar march status, detects false
zero seams. Tests pin tangent/inside/non-unit/parallel/near-parallel rays,
negative far intervals, carrier formulas and content/ground hit ordering.

### Landed shader evaluation and wire layer (routed)

The append-only shader code `7` selects the lattice arm after the six frozen
finite-group codes. `latticeFoldSource` emits the same floor-modulo body in
GLSL and WGSL, folding x/z or x/z/w as appropriate and never y. Both shader
families compile a separate lattice wrapper around the untouched estimator:
fold once, call the core once, max with the full-radius origin ball, then max
with the optional analytic clip. Folded coordinates own hit attribution;
visible-world normals and lighting retain their existing frame. Absent and
finite-reflection programs are SHA-pinned to their pre-lattice source.

All five WGSL params packers accept the resolved union and reuse the existing
16-byte tiling tail as `(code=7, h, presentationR, 0)` — the third word, zero
pad before the lattice arm, carries the frozen presentation-window radius
(`authority radius × LATTICE_PRESENTATION_RADIUS_MULT`), so the
established 560-byte 3D and 848-byte 4D maxima do not move. The pack and
GLSL-install seams require the canonical resolver geometry and the exact
estimator authority radius; a stale `h` or a block resolved against a
different radius throws rather than drawing a different canonical cell. On a
verified Mesa Intel Iris Xe display,
`npm run bench:surface -- --display=:0` compiled, bound and dispatched all
seven eval kernels and agreed with `tiling-de.ts` for all three exact/adjacent
seam probes in every core, including a 4D pose that maps visible x into
attractor w. The overall Surface bench verdict was pass.

The GLSL generators cover the inverse, fold, lens, floor, condensation,
schedule, chaos, escape and bulb arms in 3D and every legal 4D arm; actual
program-link evidence is recorded in `docs/surface-glsl-tracers.md`.

The shared carrier emitter spells the sphere/intersected attractor-y slab,
point membership and entry-relative fog coordinate once for both dialects.
Its 4D form accepts the inverse rotor's y row explicitly and evaluates
`(ro,w0)`, `(rd,0)` and `(p,w0)`. The renderer resolves the module's frozen
`8R -> 10R` policy; query-only diagnostics can replace both multipliers for
the executable candidate sweep without entering scene state.

THE CARRIER IS WIRED through both engines, both dimensions and every phase of
the live march: the primary interval's `tEnter`/`tFar`, the fog origin and its
R normalizer, each shadow ray's own carrier (fully lit past its own `tFar`),
the contains-guarded probe taps (a point outside the carrier is open space —
the window never becomes geometry, casts a shadow or contributes AO), the
ground plane's corridor and AO-reach certificates replaced by carrier tests
(an infinite lattice repeats content beyond the ball, so the single-ball
shortcuts are unsound there), and the canonical-cell camera fit. The 4D arm
assembles the inverse rotor's y row ACROSS COLUMNS in GLSL (`mat4` is
column-indexed; `uInvRotor[1]` is the second COLUMN) and passes the packed
`rotorInvR1` row in WGSL — the same semantic row, and the 4D hit fog
normalizes by the full certified radius, never the slice-adjusted slot.

Routing resolves lattice blocks PER-ARM against each DE's authority radius
(visible for the inverse descents, bounding for the forward orbits), never
against a guessed radius; a persisted lattice document now enters Surface on
both engines and settles on the mirrored cell. The empty-space grid is
refused for lattice sessions (its floors bound the attractor, not the
infinite mirror image). The panel exposes the lattice arm through the shared
kind and clip selectors plus its exact-numeric cell-scale slider. Kind and
clip edits restart an active Surface session; cell-scale edits are live, and
all tiling edits made in Points, Flame or Solid apply on the next Surface
entry. A tiled 4D session renders slice 0 only, on both engines.

Two Systems-menu landscape showcases make both dimensional halves reachable:
**Mirrored Lattice** uses Sierpinski Tetrahedron and **Mirrored Lattice 4D**
uses Pentatope. Both install `{ kind: "lattice", cellScale: 1.6 }` through
`PRESET_TILINGS` and carry the Surface render hint. On verified Iris both menu
entries exposed progress, installed their exact block, settled on the expected
engine and differed from their same-camera untiled control.

Surface eligibility no longer refuses the lattice arm: the shared refusals —
balloon, kaleidoscope, mesh clips, the 4D slab — are the boundary, exactly
as the legal-combinations table freezes. A persisted lattice document cannot
silently render the finite or untiled object because the shader selector,
the packer guards and the routing resolve one block through one answer.

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

The presentation policy is frozen at a `10R` carrier with smoothstep coverage
from `8R` to backdrop. Coverage is evaluated at the displayed 3D hit after
4D rotation/slicing; it is shading, never a DE term, shadow, or AO source.
The blend happens after ordinary depth fog and carries its fractional value
through the existing capture/DOF sidecar while hit alpha remains the terminal
status flag. Neither multiplier is document state. Query-only
`latticefade`/`latticewindow` diagnostics exist solely for the executable
candidate sheet.

MEASURED (`scripts/lattice-presentation.verify.mjs`, 800x500, verified Mesa
Intel Iris Xe): hard windows at 8/10/12R covered 45.17/47.99/49.02% in WebGL
and 45.16/47.99/49.02% in compute. Fade starts at 6/8/9R against the 10R
carrier covered 45.47/46.10/47.63%, making 6R nearly the 8R truncation and 9R
nearly the hard 10R edge. The selected 8R onset retained 0.93 percentage
points beyond hard 8R while removing 1.89 points from the hard edge; its
analytic carrier-boundary jump P95 fell from 48 to 9. All six candidates
agreed across engines (mean channel delta 0.013-0.014; at most 0.028% of
pixels over delta 8). The sheet passed 22/22 rows spanning 3D/4D,
inverse/forward, WebGL/WebGPU, ordinary and grazing carrier chords, ground
plane, depth fog and DoF over a radial backdrop. The 4D inverse cross-engine
mask IoU was 1.0; fog/no-fog pairs differed by mean 14.42 while retaining
carrier/plane edge P95s of 9/4 and 4/3. Nine Save PNGs were pixel-identical to
their closed-panel live frames; the tenth differed by mean 0.010 with no pixel
over delta 8.

### Ground plane

The plane stays ordinary sliced-view 3D geometry, at the existing
origin/radius-derived height, and is never folded. Its intersection competes
with the lattice carrier's nearest hit and retains the existing radial fade.
It receives shadows and contact AO from repeated content through the same
mirrored estimator, clipped to the same presentation carriers. The single-ball
corridor and "too far from the ball for AO" shortcuts are INVALID for an
infinite lattice and are replaced by carrier tests in the lattice arm (both
engines): the shadow ray marches through its own carrier interval and is
fully lit past its own `tFar`, and the AO taps run unconditionally, each tap
reading open space outside the carrier through the guarded probe DE. This is
especially load-bearing in 4D: an arbitrary rotor tilts the attractor-frame
carrier relative to the world-space plane, but the plane itself stays
horizontal and unfurled.

MEASURED (verified Iris, `npm run bench:surface -- --display=:0`): the five
lattice carrier frame legs — 3D inverse, 3D escape, 4D inverse, 4D escape and
the 3D inverse with the ground plane — run through the PRODUCTION
`SurfaceComputeRenderer` against a strided CPU sanity march that uses the
same carrier gate and the family's tiled oracle. All five settled with
hit-rate gaps 0.001–0.012 and the plane row's plane-rate gap 0.012
(GPU 0.535 vs CPU 0.547, 19738 plane terminals). The durable browser gate
`scripts/surface-lattice.verify.mjs` passed the same display's full
thirteen-row route matrix with the shipped eight-pass settle: 3D/4D inverse
affine/fold and forward rows all exposed progress before settling, drew
33.03–74.65% of the frame on the expected hardware engine and retained the
lattice block. The 3D final-fold lens drew 47.48%/47.49% on WebGL/compute,
fold4 drew 33.03% on compute, the untiled/finite/lattice trio differed by
7.67%/25.09%/25.10%, and a persisted document reload reproduced its picture
within 4.15% under the 15% rerender ceiling. `tiling-ui.verify.mjs`
additionally reloads the app's clean Copy Link and enters/settles/draws its
unchanged hash under read-only instrumentation.

### Release qualification matrix

The final matrix keeps each stateful question in the gate that already owns
that lifecycle rather than building a second monolith:

| Contract                                                                                                     | Durable gate                                                                                                  | Recorded verdict / current coverage                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Finite/lattice presets, authoring, links, Points/Flame lifecycle and draw, disclosure and malformed decode   | `scripts/tiling-ui.verify.mjs`                                                                                | Surface/panel baseline plus scoped SwiftShader Points and Flame legs passed real Workers, copied links, latest-wins, negative frames, same-seed Off controls and 4D view-only restarts |
| Minimal inverse affine/fold and forward, 3D/4D, WebGL/compute, clip, plane, progress and structural controls | `scripts/surface-lattice.verify.mjs` and `scripts/surface-tiling.verify.mjs`                                  | Both real-Iris route matrices passed                                                                                                                                                   |
| Carrier choice, cross-engine fade, fog/DoF/radial background and completed Save PNG                          | `scripts/lattice-presentation.verify.mjs`                                                                     | 22/22 scene rows and ten capture comparisons passed                                                                                                                                    |
| Completed export, mid-drain cancellation, interaction and collection encoding with authored tiling           | `scripts/capture-export.verify.mjs --tiling=a3`                                                               | 15/15 on SwiftShader; exact A3 survived every phase                                                                                                                                    |
| Renderer teardown during submitted compute work                                                              | `scripts/surface-teardown.verify.mjs --lens --tiling=a3 --toggleId=__modeExit --toggles=20 --toggleGapMs=900` | 20/20 on real Firefox/Iris compute; exact A3 and hardware backend retained                                                                                                             |
| WebGPU-unavailable fallback and compute-only refusal with lattice authored                                   | `scripts/surface-fallback.verify.mjs https://localhost:5173 fg`                                               | 4D lattice painted through WebGL with visible disclosure; fold-4D lattice refused with WebGPU reason                                                                                   |
| Phone target/layout and exact-number interaction                                                             | `scripts/panel-numeric-control.verify.mjs`                                                                    | 87 slider companions over 84 states passed                                                                                                                                             |

The repository gates then passed 6,761 unit tests across 168 files, the two
tiling sheets (11/11), production build, WebGL smoke, and the real-Iris
surface bench. Presentation output itself did not change after that bench;
the later edits were confined to browser gates and this evidence record.

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

## Phase 3: point-space images

Surface answers a query by folding it into canonical content. The forward
renderers cannot do that: putting a reflection or mirror fold into the chaos
game changes the recurrence and therefore changes the attractor. Their exact
construction is instead

```text
ordinary orbit (including xaos/emitter/symmetry)
  -> scheduled affine post-word
  -> final lens
  -> canonical membership
  -> bounded finite/lattice images
  -> 4D rotor, projection and slice
  -> renderer deposit
```

The source point is filtered, never folded, and no emitted image is fed back.
Thus finite tiling draws `G · (A ∩ C ∩ clip)` and the lattice draws bounded
presentation images of `A ∩ ball(0,R) ∩ clip`. The analytic clip is tested
once on the canonical source, with its existing xyz embedding in 4D, and is
not retested on images. Schedule and the final lens precede membership because
they are already plot-stage maps. The point-image layer consumes no primary or
auxiliary chaos draw.

This construction applies to genuine IFS/source-orbit documents. The Points,
Flame and Solid views of a forward escape-time or bulb document are
escape-reset pilot debris rather than samples of the set rendered by Surface;
tiling those points would claim cross-renderer agreement where none exists, so
those combinations remain refused. This is distinct from Surface's genuine
forward estimator, whose tiled escape set remains supported.

### Shared radius and canonical membership

The point family reuses the IFS Surface build as its certified-bound authority;
a sampled cloud maximum is seed- and quality-dependent and is not a bound. The
one origin-visible radius is:

- 3D without a final lens: `|boundCenter| + boundingRadius`;
- 3D with either final lens: `visibleBoundingRadius`;
- 4D: the origin-anchored `visibleBoundingRadius` already produced by
  `buildSurfaceDE4`.

The first row also corrects a latent Surface lattice seam: a plain 3D DE can
carry a tighter off-origin ball, so passing `boundingRadius` alone to an
origin-centred lattice ball can exclude certified content. Every caller must
go through the shared origin-radius helper. As before, `h = cellScale · R` and
resolution rejects a non-positive/non-finite radius, a zero f32 half-cell, or
an unrepresentable `4h` period.

Finite membership is the closed chamber test
`dot(p, root_i) >= -FOLD_EPS` for every simple wall, then the optional analytic
clip. Lattice membership is `|p| <= R`, then that clip. Boundary points belong
to the set, but multiplicity is not brightness: a finite source on walls uses
one representative per right coset of its stabilizer, while a lattice source
on `|coordinate| = h` retains the even-index representative of each coincident
odd/even pair. The executable oracle found every simple-wall finite orbit to
be exactly half its group order (12/24 through 576/1152), with agreement to
`enumerateOrbit`; the 3D lattice wall fixture selected exactly the 39 distinct
in-carrier images rather than the 97-cell plan.

Finite matrices are generated deterministically from the canonical Coxeter
roots: reflection `S_i = I - 2 n_i n_i^T`, breadth-first closure from identity,
cached by group. `enumerateOrbit` stays the independently written slow oracle.
The largest runtime matrix table is F4's 1,152 f64 4x4 matrices, 147,456 bytes.

For a lattice cell index `k`, the exact scalar image is
`I_k(u) = (-1)^k u + 2hk`. It applies on x/z in 3D and x/z/w in 4D. A radial
cell plan is tighter than the surrounding Cartesian cube: retain integer
tuples satisfying

```text
sum(k_i^2) <= ((outerRadius + R) / (2h))^2.
```

At the mathematical minimum `cellScale = 1`, the 10R carrier needs 97 cells
in 3D and 739 in 4D, not the loose 1,331-cell 4D cube. At the authored scales
1.25 and 4 those counts are 61/5 and 365/7. The measured mean exact candidates
per accepted point were 77.34/48.76/5 in 3D and 514.51/261.39/7 in 4D.

### Finite presentation in 3D and 4D

Point-family lattice presentation uses the same measured 8R-to-10R smoothstep
coverage as Surface, but the carrier is evaluated in the source dimension:
an origin-centred 3-ball in 3D and origin-centred 4-ball in 4D. The tiled 4D
view pivot is therefore frozen at the origin. Only after carrier membership
and fade does the live/frozen renderer view rotate and project the image and
apply its ordinary soft slice.

This dimensional order is load-bearing. At the identity rotor, projection
drops raw w while the current 4D slice keeps a 0.06 ghost floor; widening a
raw-w test window from 4 to 8 to 16 cells therefore left 9, 17 and 33 projected
images visible, with minimum total ghost weight 0.54, 1.02 and 1.98. A
displayed-3D carrier is consequently not locally finite. The raw-4D carrier
changed membership zero times under the sheet's adversarial xw rotation and
its maximum fade-weight delta was `2.78e-15`. The measured 6R->8R, 8R->10R
and 10R->12R candidates at scale 1.25 required 179, 365 and 619 cells; the
middle pair is retained to agree with the already-qualified Surface edge.

The carrier fade is coverage, not source color. Points realizes that coverage
as spatial density through the proposal/thinning rule below, so it needs no
new per-vertex alpha, opacity, size or material specialization. Transform
index, structural color state, Height, Radius and Position remain properties
of the canonical source and are copied to every image. The 4D w-ramp,
slice-relative color, slice weight, lighting and fog remain properties of the
raw or displayed image and are evaluated after the relevant image/view
transform.

That provenance has one exact, output-aligned storage shape: three f32 source
coordinates (`12 B`) per emitted 3D point, or source `xyz+w` (`16 B`) per 4D
point. At the authored five-million-point ceiling the increment is therefore
exactly 60 MB / 80 MB. A deduplicated source table plus a u32 image-to-source
index is not a smaller worst-case representation: lattice Points may retain
only one image from each accepted source, making the table output-sized before
the extra 20 MB index exists. The worker strips the recorder's duplicate field
names into one `canonicalColorSource`, transfers each canonical buffer once,
and the main thread retains that source with the landed cloud for live
recoloring. A landing in the opposite dimension releases the stale cloud and
its provenance rather than caching both dimensional maxima.

### Bounded work and normalization

Exhaustive replication remains the oracle, not the production budget. The
runtime has two deliberately separate realizations because Points has no
per-vertex weight in any of its existing materials, while accumulators already
sum weighted deposits.

**Points uses equal-density output.** For a finite group of order `g`, a source
with `m` stabilizer-safe distinct images receives `m` dots when `g <= 256`.
For a larger group its mean integer quota is `256m/g`: carry the exact integer
remainder `remainder += 256m; K = floor(remainder/g); remainder %= g` across
accepted sources. Generic B4/F4 sources therefore receive exactly 256 dots,
while a simple-wall source receives 128; smaller stabilizers retain their
correct proportional mass even when their quota is below one dot per source.
A wrapping coprime image cursor chooses `K` distinct representatives and is
carried across chunks. Every emitted dot has weight one.

For lattice Points, precompute the source-independent ceiling
`u_k = V(max(0, |cellCenter_k| - R))`, its exact f64 CDF, and
`U = sum(u_k)`. Each accepted canonical source receives exactly one proposal:
a base-2 radical-inverse coordinate selects cell `k` with probability
`u_k/U`, and the paired base-3 coordinate retains its image iff it is below
`V(|image|)/u_k`. The unconditional retained density is therefore
`(u_k/U)(V/u_k) = V/U`, exactly the exhaustive fade-weighted image density,
without storing coverage. The wrapping-u32 proposal ordinal
is explicit state, never a chaos RNG draw, and makes arbitrary worker chunking
emit the identical sequence. One proposal per source maximizes source
diversity; a thin clip may consequently finish underfilled rather than borrow
brightness from a different source.

**Accumulation consumers retain the weighted estimator.** Every source attempt
earns one integer fanout credit. Rejection banks it; acceptance spends
`K = min(credit, distinctCandidates, rendererCap)` and advances the existing
cursor. Finite samples carry `m/K`; lattice samples carry
`(U/K) * V(|image|)/u_k`. Credit and cursor persist across chunks/dispatches,
cumulative candidate tests stay no greater than primary attempts, and the
existing completed-field normalization remains unchanged. The paired GPU lift
retains this estimator and pins its largest possible fixed-point add below u32
before the existing emulated-u64 histogram accumulation.

The frozen budgets are:

| Consumer                 | Budget and terminal behavior                                                                                                                                                                                                                                                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Points                   | SHIPPED — authored point count remains the maximum allocated/displayed output; finite: at most 256 equal dots from one accepted source; lattice: one proposal per accepted source, with at most `8N` source attempts and `8N` proposal tests for request `N`; returns `complete`, `underfilled`, or `empty`, never an untiled substitute |
| Flame CPU                | SHIPPED — authored iterations remain primary orbit steps; at most 32 weighted image deposits at one acceptance and no more selected candidates cumulatively than attempts; credit/cursor persist in the histogram across arbitrary worker chunks                                                                                         |
| Flame WebGPU             | SHIPPED in 3D and 4D — the shared binding-7 plan tail and binding-8 per-chain state drive the same 32-image weighted estimator; active tiling uses the normal GPU route with CPU fallback, never an untiled GPU substitute                                                                                                               |
| Generated Flame backdrop | SHIPPED — same 32-image rule inside its fixed one-million-step job; schedule, tiling and the balloon legality bit join the semantic snapshot; the existing untiled Balloon omission is not changed implicitly                                                                                                                            |
| 3D Solid                 | SHIPPED — no replicated voxel memory: the canonical density texture stays put and the material folds every query; the march budget scales with the presentation carrier at the source-voxel stride, capped at 8192 steps                                                                                                                 |
| 4D Solid                 | SHIPPED — at most 32 weighted pre-projection images per accepted source, deposited into the unchanged displayed volume; no new voxel memory and no material change. The representation, its two per-arm selection policies and the refused alternatives are the section below                                                            |

The sheet measured all six finite groups on a balanced 16,384-point acceptance
fixture and got exactly `1/order`. At ~262k output work, equal-density finite
Points matched the weighted F4 estimator exactly: 98.2% of exhaustive
histogram occupancy with normalized L1 0.0484. Complete-orbit budgeting
retained 97.5% at L1 0.1195 because it represented only 227 source motifs, and
one-image cycling retained 29.8% at L1 0.8885. A B4 simple-wall fixture emitted
128 equal dots against a generic source's 256, exactly its 192/384 orbit ratio.
The 32-image accumulation cap retained 89.5% at L1 0.1551.

At minimum lattice scale, proposal-CDF thinning filled 4,096 equal dots after
5,008 proposal tests in 3D and 5,555 in 4D, well below the 32,768 (`8N`) cap.
It retained 70.1%/63.7% of exhaustive occupancy at L1 0.2242/0.2895; the
weighted one-test comparators retained 74.4%/68.7% at L1 0.1903/0.2888.
Irregular chunk splits reproduced both the finite and lattice emission
sequences exactly. The deliberately nearly-empty F4+clip model still reaches
only about 5,555 outputs under a 100,000-point request and 800,000-attempt cap,
so `underfilled` is a first-class valid result. Zero accepted content installs
the renderer's normal empty output: zero Points geometry, transparent Flame,
dark composed backdrop, or zero-density Solid.

**Implementation verdict.** `point-tiling.ts` ships the Points-specific bounded
visitor beside the weighted accumulator visitor. Its callback passes
literal weight `1`; state is `{ cursor, quotaRemainder, attempts, accepted,
candidateTests, emitted }`. `runChaosGameTiledPoints` and
`runChaosGame4TiledPoints` preserve the ordinary hot-loop order and copy
canonical source coordinates plus transform attribution to every emitted
image. The 4D recorder emits raw `xyzw`, fixes the image-cloud centre at the
origin, and computes its exact maximum origin radius before view reduction.
The worker selects these recorders only for an active certified plan, stops
before point `N`, and exposes `complete`, `underfilled`, or `empty` beside the
point count. Refused sessions and absent tiling continue through the literal
historical recorder branch; neither constructs tiling state nor substitutes a
tiled empty result. Canonical color buffers are transferred only for the
active arm as `canonicalColorSource` and retained with the landed result for
live recoloring; landing the opposite dimension releases the stale cache.

`accumulateFlame` and `accumulateFlame4` consume that weighted visitor only at
the outer plot boundary. The orbit, xaos/emitter draws, schedule, final lens
and source color advance once per authored iteration; accepted images then
project and deposit with the visitor's finite multiplicity or lattice coverage
weight. Their `{ credit, cursor, attempts, accepted, selected, emitted }`
state rides `FlameHistogram`, so one-shot and irregularly chunked renders agree
without spending a chaos RNG draw. The 4D twin applies true raw-xyzw images
before its frozen rotor and soft slice; structural/transform/height/radius/
position/uniform colors stay source-owned while w-ramp and slice weight follow
the image. Empty accepted content completes as a transparent histogram.

The Flame worker resolves raw authored tiling before constructing the seeded
orbit, reports active/refused association to the panel, and passes an active
plan through the normal GPU route with CPU fallback. A tiling edit replaces the
worker from the same source seed and frozen camera/rotor/slice; detached old
hosts make rapid edits latest-wins, old deposits cannot survive, and a CPU
fallback already learned by that live session is retained rather than probed
again. Refused and absent plans keep the literal historical
accumulator/backend lifecycle.

### Flame WebGPU image specialization

Both dimension-specific kernels consume one shared point-image WGSL body and
keep their historical exports unchanged. An active plan appends an aligned
tail to binding 7's existing emitter float table: a 16-float header addresses
the analytic clip and either finite roots, matrices and wall-mask directories,
or lattice cells and proposal-CDF records. Binding 8 adds one zero-initialized
32-byte accumulator state per orbit chain for credit, cursor and diagnostics.
That separate buffer preserves both established 32-byte orbit-chain wires and
the 3D/4D Params layouts. Absent or refused tiling compiles the literal old
kernel and retains its old bind-group layout and allocations byte for byte.

The generated adapter replaces only the active PLOT color/deposit block.
Orbit stepping, xaos and emitter draws are unchanged; schedule and final lens
still precede canonical membership, and image selection never feeds the orbit
or consumes its RNG. The 4D adapter acts on raw xyzw before the frozen rotor,
projection and slice. Structural/transform/radius/height/position/uniform
colors belong to the canonical source; w-ramp and soft-slice weight are
recomputed per raw 4D image, whose image weight multiplies the slice weight.
Balloon is refused before packing, so the tiled specialization has no echo
deposit. Warmup remains outside this arm through the existing `PLOT=false`
specialization.

The lattice CDF packer quantizes every positive interval without collapse:
endpoint and mass are exact f32 high/low-16 pairs, endpoints are strictly
increasing, and the final endpoint is exactly 2^32. Selection and importance
weight both read that quantized mass, so rounding cannot bias the estimator or
turn a tiny ideal ceiling into a division by zero. Every scalar is rejected if
it cannot remain finite on the f32 wire. Stabilizer tests retain the canonical
tight relative epsilon and add only a four-ULP f32 input/dot-product envelope,
which keeps all six groups' generic/wall/edge/vertex masks intact.

F4 bounds a finite splat at 1,152; the x256 weight scale therefore caps one
weight add at 294,912, and the additional x256 color scale caps one color add
at 75,497,472. Both fit u32 before the existing emulated-u64 accumulation;
every packed lattice plan is additionally checked below its 740 weight
ceiling. Even the adversarial 2B-iteration, 4x-area export with a conservative
2x dispatch overshoot puts at most 4,831,838,208,000,000,000 in one color
lane, below 2^64.

MEASURED (targeted agreement, verified Mesa Intel Iris Xe): finite 3D passed
at MAE 0.0065 and density TV 0.0163; minimum-scale lattice 3D passed at MAE
0.940 and TV 0.0375 under its scenario threshold 2; the F4 chamber 4D fixture
passed at MAE 0.000657 and TV 0.00636; and minimum-scale lattice 4D passed at
MAE 2.790 and TV 0.0471 with near-zero signed bias under threshold 5. These
four rows exercise finite matrices, lattice CDF selection, source-owned color,
true raw-4D action, image-owned w-ramp and the soft slice on the production
backend.

The same verified-Iris sweep gates the remaining seams: maximum-scale lattice
3D passed at MAE 0.132 / TV 0.0154; an excluding analytic clip completed with
zero hits on both engines; and the legal emitter + xaos + schedule + final-lens
composition passed at MAE 0.00695 / TV 0.00523 while sharing binding 7's real
emitter prefix with the appended plan.

### 3D Solid landing

Solid's density volume is camera-independent and the tiling is pure
query-space material state, so the lift shipped with NO new voxel memory and
NO worker restart: `voxel-material.ts`'s compile-gated tiling arms fold every
density/color query — primary, refine, gradient, shadow, AO, floor shadow and
floor AO — through one shared wrapper, so no path can draw a different object.
The canonical density texture, the worker, and every untiled program stay
byte-identical; the max-density hierarchy is suspended while tiled (a straight
visible ray maps to reflected source segments, so its node skip is not valid
across them) and restored exactly when tiling clears. Tiling edits are live:
kind/clip/scale re-resolve the session and recompile the material only.

The ray interval is independent of the source AABB. The FINITE arm marches
the exact ball of the AABB's farthest corner norm — every chamber wall passes
through the origin and the fold preserves |p|, so all copies of the box lie in
`ball(0, maxCorner)` and the carrier is exact, never an artificial window. The
LATTICE arm marches the shared `sphere(0, 10R) ∩ attractor-y slab` carrier and
applies the mandatory `|F(q)| <= R` content ball plus the 8R→10R smoothstep
coverage fade at the displayed hit (never geometry, shadow or AO; hit alpha
stays terminal). Step budgets scale with the carrier at the source-voxel
stride (the untiled 220's ~1.16 voxel face-on stride) capped at 8192, so a
larger visible window never silently under-samples cells; the shadow and floor
rays march their own carrier intervals and are fully lit past them. The
optional analytic clip is baked from the authored ShapeSpec and narrows the
folded source; the session poses an unposed clip on the measured chamber
content exactly like the surface arms. Fog keeps the source box half-diagonal
unit and measures from the carrier entry.

The frozen combination matrix and edit timing: Balloon and kaleidoscope
order > 1 refuse (the volume bakes the kaleidoscope into the attractor, so
only order 1 is canonical chamber content), mesh clips refuse, forward
escape/bulb volumes refuse as reset debris, and the floor/environment
presentation compose. A 4D document does not take the query-space fold —
its volume is a projected slice no 4D fold can act on — it takes the
worker-baked pre-projection arm below. `resolveSolidTilingSession` is the
ONE derivation (off/refused/active, mirrors `point-tiling-session.ts`,
dimension-resolved per arm); `installVoxelTiling` is the 3D material compile
gate (canonical records by identity, mirroring `installSurfaceTiling`). The
panel's Solid rows read the ACTIVE session's status like Flame's read their
worker outcome, so a held session discloses its entry dimension even after
the authored document crosses 3D/4D.

### 4D Solid representation

**Decision: deposit bounded pre-projection images into the UNCHANGED
displayed volume.** No new voxel memory, no new buffer shape, and no shader
work at all: the whole lift is the voxel worker's plot boundary, taken
exactly the way `accumulateFlame4` took it one renderer over. The executable
argument is `scripts/solid-tiling-4d.harness.ts`.

SHIPPED along exactly that line (2026-09-01). `VoxelGrid` carries an
optional lazily-allocated `pointTiling` cursor (untiled storage and wire
byte-identical, pinned by the omitted-vs-explicit-undefined test);
`accumulateVoxels4` visits the shared bounded visitor on raw post-schedule/
post-lens `xyzw` and deposits the PROJECTED image — coverage and importance
into density, importance into the running RGB mean — while structural/
Transform/Height/Radius/Position/Uniform color provenance stays owned by the
canonical source and only the w-ramp is recomputed from the emitted image.
Finite A4/B4/F4 keep the bounded 32-image estimator; lattice uses the
settled-pose `u_k v_k` proposal with the shared `1e-3` omission gate and the
A1 POST-spend cursor phase `(cursor + selected) >>> 0` (pinned against A0's
pre-spend phase by a multi-cell test the one-cell coverage test cannot
distinguish). The tiled view policy pivots at the ORIGIN with
`invWAmp = 1/carrierRadius`; active tiled bounds are the EXACT carrier cube
(finite `ball(0,R)`, lattice the presentation outer radius) consuming no
orbit RNG. The worker resolves tiling before the seeded orbit, rebuilds the
lattice proposal per settled view, and keeps the max-density hierarchy
ENABLED; an entry carrier radius (`entryCarrierRadius`) keeps an
Active→Off/refused replacement from deriving rotation-invariant support from
a tiled cube AABB, and color normalization keeps its own
`colorCenter`/`colorHalfExtents` frame so canonical colors survive the
geometry pivot. The browser record is `scripts/tiling-ui.verify.mjs
--scope=solid4`; the settlement's representative figures are in that
header and in the edit-timing paragraph below.

The obstruction is mechanical rather than aesthetic. `accumulateVoxels4`
deposits into a rotor-projected, w-sliced 3D grid — rows 0-2 of a
`RotorProjection4` give xyz, row 3 gives `sRaw`, which becomes a Gaussian
slice WEIGHT (floor 0) and never a coordinate — so w is gone before the
material sees the texture. 3D Solid's query-space fold cannot be lifted onto
that texture; it would fold the displayed space instead of the attractor's.

**The selected architecture.** Buffers, wire and material are literally
today's. `VoxelGrid` stays `size³` Float32 density plus Float32 3-channel
weighted mean; the wire stays the RGBA8 `size³` texture plus a `Vec3`
min/max; `voxel-material.ts` is untouched, so there is no `tilingFoldQuery`,
no carrier interval, no coverage fade and no `installVoxelTiling` in the 4D
arm. Two consequences invert 3D's rules and must be stated rather than
inherited: the max-density hierarchy STAYS ENABLED (a straight visible ray
maps to no reflected source segments, because nothing folds), and tiling
edits RESTART the worker instead of recompiling a material, because the
images are baked into the density.

At the plot boundary the worker resolves the raw authored tiling before
constructing its seeded orbit, then calls the shared bounded visitor on raw
post-schedule/post-lens `xyzw` and projects the IMAGE — never the source —
through the frozen `rotorProj`, weighting by `sliceWeight(s, ·, ·, 0)`,
Solid's floor-0 convention rather than the flame's 0.06, under the existing
`SKIP_WEIGHT` gate. Cursor state rides `VoxelGrid` the way it rides
`FlameHistogram`, so chunk boundaries stay irrelevant. The tiled 4D view
pivot is frozen at the ORIGIN and `invWAmp` is `1/carrierRadius` — the
carrier ball is rotation-invariant, so its signed-w amplitude IS its radius
at every rotor pose (the Flame precedent). Bounds: the pilot must be tiled
too or the cube crops the copies. The finite cube is `ball(0,R)` — images are
4D isometries fixing the origin and orthographic projection of a rotation is
non-expanding — MEASURED rather than assumed, as the max displayed radius
over every finite reference run. The lattice cube is the presentation
`outerRadius`. Coverage is realized as DENSITY, the Points precedent: Solid
has no per-voxel coverage channel, and the reference the sheet measures
against realizes it the same way.

**Two per-arm selection policies, and the asymmetry is structural.** The
FINITE arms keep the shipped `visitPointTilingAttemptBounded` at the frozen
32-image cap. The LATTICE arm keeps the same credit rule but re-weights its
proposal CDF by a per-cell slice-visibility ceiling `v_k`, derived once per
settled pose from the cell centre's `s_k` widened by `±R·invWAmp` (row 3 of
the rotor is a unit vector, so the mirrored source part moves `s` by at most
`R·invWAmp`; a cell whose `u_k·v_k` falls under `SKIP_WEIGHT` cannot
contribute, since coverage is at most `u_k` and slice weight at most `v_k`,
so dropping it from the CDF is exact, not an approximation). Sampling cell
`k` with probability `u_k v_k / S` and depositing
`coverage·slice·S/(u_k v_k K)` is unbiased cell for cell against exhaustive
replication.

That refinement is legal only because Solid's deposit stage owns the SETTLED
rotor and slice, and affordable only on the lattice, where the ceiling is
source-INDEPENDENT. The finite groups' per-image visibility is
source-DEPENDENT, so the same idea costs a full orbit enumeration per
acceptance; it is REFUSED on measurement, below.

**MEASURED** (`scripts/solid-tiling-4d.harness.ts`, Node 22, 2026-09-01;
`pentatope` at R = 1.0317, 2,000,000 source attempts, 192³ native / 128³
shared fine grid, slice width 0.12, at an identity pose and a genuine xw
rotation of 0.63 rad at slice centre 0.37; every grid mass-normalized).
Normalized L1 against exhaustive replication, at the w-mixing pose:

| Arm         | A0 shipped | A1 slice-aware | B raw-4D N=64 | X post-projection |
| ----------- | ---------- | -------------- | ------------- | ----------------- |
| A4 (120)    | 0.1659     | 0.0624         | 0.7976        | 1.8399            |
| B4 (384)    | 0.3213     | 0.1798         | 0.7610        | 1.8241            |
| F4 (1152)   | 0.5571     | 0.3297         | 0.7392        | 1.9476            |
| lattice 1.6 | 0.0875     | 0.0529         | 1.0554        | 1.9650            |

The selected architecture costs nothing it did not already cost: 27.0 MB of
texture and 108.0 MB of working set at 192³, identical to untiled, and a
measured per-ray fetch multiplier of 0.968-1.000 against the untiled
baseline's mean 162.64 fetches/ray — slightly BELOW one, because a tiled
volume terminates rays marginally sooner. A settled rotor/slice edit costs
0.82x-1.28x today's untiled 4D restart.

**The lattice arm misses its own detail bar, and the bar is the carrier, not
the representation.** At the frozen 10R carrier a 192³ volume resolves the
canonical content at 19.20 voxels per content diameter, against a
predeclared floor of 32 and against the untiled 4D volume's 205 — the
order-of-magnitude loss the decision predicted, now measured. That number is
NOT an argument for a raw-4D volume: candidate B bought 64 voxels per content
diameter and lost the object, at L1 1.0554 with only 30.1% of the reference
occupancy. Two levers exist and neither is a representation change — the
authored Solid resolution (256³ gives 25.6) and a Solid-specific carrier. The
carrier sweep at the w-mixing pose, each row referenced against its own
exhaustive run, measured 10R/8R/6R/4R at 171/81/33/19 cells, 19.20/24.00/
32.00/48.00 voxels per content diameter and L1 0.0875/0.0873/0.0791/0.0987:
6R is the first row that clears the floor and also carries the best measured
L1. `resolvePointTilingPlan` refuses every presentation but 8R->10R, so that
is a presentation-policy decision with its own evidence, deliberately left
open here rather than settled by a renderer that wanted a smaller number.

**REFUSED: a raw-4D canonical volume with a query-space 4D fold.** It is the
only candidate that keeps a 4D fold, and it is the architecture that would
have made rotor and slice edits free — proven pose-independent, byte-identical
between a volume built at one pose and rendered at another, because the raw
volume reads no pose at all. It still fails, on two independent grounds. At
N = 64, the largest resolution inside both memory caps and exactly at the
64 MiB texture cap with a 256 MB working set, the 4D grid holds 22,017
occupied cells out of 16,777,216 — 0.13% — and a 3-plane through a grid that
sparse misses most of what it should intersect: occupancy retained is
1.43-1.61 on the finite arms (an over-filled blur) and 0.30-0.34 on the
lattice (under-filled), with L1 0.739-1.055 everywhere. Depositing and then
slicing integrates the slice exactly, from continuous orbit points;
voxelizing in 4D and then slicing loses it. And its per-query cost multiplies
EVERY one of the seven folded query paths by its w-tap count — 24 taps on the
finite arms and 231 on the lattice, against a 2x fetch cap. Sparse or bricked
4D storage would move the memory number, not either of those two.

**REFUSED: the post-projection displayed-3D fold**, at L1 1.82-1.97 with an
occupancy symmetric difference of 0.83-2.52 against exhaustive replication.
It draws a different object, and a different wrong one at each pose.

**REFUSED for the finite arms: slice-aware importance selection.** It is
strictly better per ATTEMPT (L1 0.5571 -> 0.3297 on F4, and every emitted
image lands in the visible slice: visible fraction 0.62-0.70 -> 1.0000), but
it is not better per SECOND above A4 — at matched wall clock its F4 row
(0.3297 in 2.44 s) loses to simply spending the same time on more attempts
(A0 at 4x: 0.2953 in 2.41 s) — and it breaks two frozen bounds: cumulative
candidate tests reach 3.63x-8.04x attempts, and the settled-edit rebuild
reaches 1.84x-3.39x the untiled restart.

**A measured correction to this contract's own acceptance figure.** Canonical
finite acceptance is `1/order` only for a fixture balanced against the
CANONICAL chamber, which is what the point-family sheet used. An authored
system's attractor sits in its own frame, unrelated to the canonical Coxeter
roots, so its acceptance is whatever that misalignment makes it: pentatope
measured 3.026%/1.955%/0.698% under A4/B4/F4, i.e. 3.63x/7.51x/8.04x the
`1/order` prediction. Nothing downstream breaks — every comparison is
mass-normalized and the credit rule is defined on attempts, not on a
predicted acceptance — but any cost bound written in terms of `1/order` is
not a bound, which is exactly what retired the finite slice-aware arm above.

### Legal combinations and edit timing

| Layer                                                                                      | Point-family verdict                                                |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| matching-dimension finite group or 3D/4D lattice                                           | supported                                                           |
| analytic clip                                                                              | supported; canonical-source membership before images                |
| schedule, final lens, xaos, emitter/condensation                                           | supported in their existing plot order                              |
| soft 4D view slice                                                                         | supported after true 4D images; not Surface's refused thick DE slab |
| Balloon, kaleidoscope order > 1, mesh-backed clip, dimension mismatch, H4/reducible groups | preserve the existing authored-state refusal with adjacent reason   |
| escape-time/bulb debris in Points, Flame or Solid                                          | refused; it is not a sampler for Surface's set                      |

Points tiling edits follow Auto-update and the existing latest-wins one-shot
regeneration. An active Flame edit restarts accumulation from the same source
seed and frozen view; the panel shows Preparing/Applying until the replacement
frame lands. The generated Flame backdrop follows every tiling and schedule
edit through `trackAutoBackground` — even with Points' Auto-update off, where
the pane keeps the stale cloud while the replacement backdrop renders —
while 3D Solid applies tiling edits live (material-only) and Surface keeps
its existing restart-on-kind/clip and live lattice-scale behavior. 4D Solid
RESTARTS the voxel worker on every tiling edit, always from the entry seed,
and on every settled rotor/slice endpoint that needs a rebuild — the images
are baked into density — while an inert color-only endpoint stages over the
still-valid frame without advancing its revision; the replacement retains the
entry geometry frame and the canonical color provenance separately, so an
Active→Off or refused replacement can never adopt tiled support as untiled
geometry. Stale worker replies never publish: a grid whose `viewRevision` is
not the active endpoint's is dropped, and the worker may legitimately finish
an old endpoint's chunk after a newer command is queued. Browser-gated by
`scripts/tiling-ui.verify.mjs --scope=solid4`: real-worker entry with the
hierarchy present, same-seed worker replacement on an authored edit, in-worker
revisioned view endpoints, and structurally distinct same-seed tiled/Off
frames (Iris 18.53%/35.50%; SwiftShader 19.50%/35.47%; the 3D scope on the
same build keeps its material-only 1→1 worker contract, Iris diffs
11.11%/24.69%). Browser-gated for the backdrop by
`scripts/tiling-ui.verify.mjs --scope=backdrop`: the frozen-cloud fixture
isolates the backdrop's tiled/untiled pixel difference (measured 44.01% /
30.66% on Iris, 40.82% / 32.45% on SwiftShader).

The complete executable record, including timings and the carrier alternatives,
is `scripts/point-tiling.harness.ts`. Deterministic unit/worker/UI tests own the
deliberately empty and underfilled terminal fixtures; the browser gate uses
complete showcase clouds so it can instead qualify the real Worker boundary,
copied-link restoration, stale/latest-wins labeling, visible tiled/untiled
frames, and 4D view-only interaction without an expensive near-empty scene.
