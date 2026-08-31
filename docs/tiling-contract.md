# Space Tiling — the opening contract (fr-sq8y)

The frozen record for the finite-reflection tiling feature (epic fr-b84r, phase
1). Everything a later bead must not re-decide lives here: the group
vocabulary, the fold-to-chamber algorithm and its bound, the wrapper order and
the exact composition, the renderer and wire matrix, the legal-combination
table and the refusals with their reasons. Phase-2 lattice semantics are
explicitly NOT decided here — fr-mbfp owns that door; this contract only
requires that phase 2 extend the same `TilingSpec` union rather than inventing
a second model.

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
mitigant. The harness bead measures this on every ship fixture; any false
chamber wall on a fixture is a no-go that changes this contract, not a
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
`tiling.ts` (fr-nr7w) and are pinned by group-axiom tests: pairwise inner
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
| WGSL cores: affine, fold, affine4, fold4, escape, bulb, escape4  | in — compile-gated wrapper, fr-eser                                                                                                                                                                                  |
| GLSL tracers: 3D and 4D                                          | in — compile-gated arm, fr-fn9j; Mesa cliff measured before                                                                                                                                                          |
| Points, Flame, Solid                                             | NOT in — a query-space fold has no chaos-game meaning. The authored block persists and those modes render the UNTILED attractor with the adjacent explanation; a document never silently renders a different object. |

Forward cores get the fold free (they are in) — their kaleidoscope already
is a query-space wedge fold by `escape-de.ts`'s own argument, and the same
1-Lipschitz/pre-fold reasoning applies to the tiling fold with the
composition chain above.

## Legal combinations and refusals (frozen)

| combination                                                      | verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| tiling + ground plane                                            | composes — the landscape case; the plane is world-space in the sliced 3D space, the fold never touches it                                                                                                                                                                                                                                                                                                                                              |
| tiling + lens (`foldFinal`)                                      | composes — pre-fold vs post-fold                                                                                                                                                                                                                                                                                                                                                                                                                       |
| tiling + condensation / schedule / chaos / shape trap / finishes | compose — they live at the estimator/orbit level                                                                                                                                                                                                                                                                                                                                                                                                       |
| tiling + balloon                                                 | REFUSED, adjacent reason — the sphere-inversion echo of an orbit is not the orbit of the echo; no certified composition, and a filled solid's interior reaching the ball centre swallows the camera (the balloon's own IFS-only verdict)                                                                                                                                                                                                               |
| tiling + kaleidoscope                                            | REFUSED in phase 1, adjacent reason — both are query-space folds and the composition argument differs per family (the descent cores sweep the rotation INSIDE the descent, after the tiling fold — the estimate then has no certified lower-bound order; the forward cores' foldK-then-foldT composition IS sound, but one uniform routing rule beats a per-family matrix). The fixtures never combine them; a later certified order is a phase-2 door |
| tiling + 4D slab (`halfExtent > 0`)                              | REFUSED, adjacent reason — the fold of a segment is a bent polyline (per-point reflection sequences), and the slab's conservative-bound contract does not survive it. Tiled 4D sessions run slice 0 (the shipped default)                                                                                                                                                                                                                              |
| tiling + H4 / reducible groups                                   | REFUSED — vocabulary above                                                                                                                                                                                                                                                                                                                                                                                                                             |
| tiling + escape4                                                 | in — no slab, no lens, no kaleidoscope by the refusals above; the forward orbit is seeded at the folded point exactly as its kaleidoscope seeds at the sector-folded point                                                                                                                                                                                                                                                                             |

## Wire placement (frozen rule; byte table is fr-eser's audit)

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
combination constant gains a `_TILING` twin = existing + 4 bytes. The 3D
maximum combination today ends at 544 (`PLANE_SCHEDULE_CONDENSATION_CHAOS`),
the 4D at 832; the tiling u32 lands at 544/832 in those combinations and at
each combination's own end otherwise. The fr-eser bead enumerates and
exports every combination constant and pins them by test; the standing
hazard note applies verbatim (a block appended blind at 4D offset 560 lands
INSIDE the `lens4Fold` quartet).

## Document vocabulary and applicability

`TilingSpec { group, clip? }` — scene-level, one per document, beside
ShapeTrap and HybridSchedule. ABSENT MEANS OFF byte-identically: no block,
no arithmetic, every emitted shader byte for byte the pre-tiling build.
`resolveTiling` is the ONE authority for defaults and domains (the
`resolveFoldRadii`/`resolveShapeTrap` precedent); persistence carries
authored values at fidelity and the resolver owns the clamps. The group is
discrete — morphs never interpolate it (the target's block pops at the leg's
first push, the HybridSchedule precedent); the clip follows the ShapeTrap
morph precedent. A malformed block decodes to undefined, never rejects the
scene. The panel family is authored scene geometry (its home is decided in
fr-zpg4 per `docs/panel-ia.md`); the group cell is NEVER presented as a
free-form clip and vice versa.

## Evidence owed (summary)

The harness sheet (fr-7db3) measures, with the SHARED instruments only:
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

## Phase 2 door (not decided here)

Lattice repetition (fr-mbfp) extends the SAME `TilingSpec` union with its
own kind, cell geometry and seam semantics; the mirrored-lattice route is
covered by the same inequality as phase 1 (free), the cell-contained
translation route needs its wall clamp, and unclamped translational opRep
is refused outright — but those are fr-mbfp's decisions, preserved here
only as the requirement that phase 2 not invent a second model.
