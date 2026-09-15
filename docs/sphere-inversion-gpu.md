# Sphere-inversion shader routes (scoping plan)

The written plan for taking the sphere-inversion seed-orbit estimator
(`docs/sphere-inversion-family.md`, CPU core in `src/fractal/sphere-inversion*.ts`)
onto the Surface tracers in both dimensions. It fixes the WGSL core identity,
the frozen params wire growth, generator storage and the containing-ball search,
the f32 soundness argument, hit attribution, the GLSL fallback decision, the
`bench:surface` fixtures and the implementation order. No production code exists
yet; every figure below was measured on the CPU oracle or read from the current
generators, and the measurements that only a real driver can make are named as
bench obligations.

The plan consumes the RESOLVED construction and `buildSphereInversionTables`
output only. It is therefore independent of the concurrent vocabulary changes
(the 600-cell registry entry, the merged ball/cap seed kind, the pinned cutoff
contract): fixtures name whatever arrangement id lands.

## Measurements behind the plan

Three throwaway scripts, run on the CPU of the development machine, never
committed. They reuse `sphere-inversion-de*.ts` and `buildSphereInversionTables`
unchanged and re-implement only the counters and an f32 emulation (every
arithmetic result passed through `Math.fround`, tables rounded once from f64 —
the packer's transfer).

### Per-eval work on a tracer's own query distribution

A 48×48 step-1 sphere tracer marched each fixture and recorded every query it
evaluated. The CPU tracer is an approximation of the app's (its own camera and
footprint), so the figures are relative, not the shipped tier budgets. "Linear
fold dist" is what a GPU fold that scans every generator per test pays (no early
break); "cover sqrt" counts the covering-scan member evaluations the CPU oracle
performs.

| Fixture                                   | n   | µs/eval | fold k mean / max | fold tests / eval | radial reject / test | cover candidates / eval | cover sqrt / eval | linear fold dist / eval |
| ----------------------------------------- | --- | ------- | ----------------- | ----------------- | -------------------- | ----------------------- | ----------------- | ----------------------- |
| oct6 r .70, ball .28, D 8                 | 6   | 0.314   | 0.45 / 3          | 1.45              | 0.340                | 2.44                    | 24.1              | 15                      |
| oct6 kissing, ball .28, D 12              | 6   | 0.374   | 0.57 / 4          | 1.57              | 0.200                | 2.11                    | 21.8              | 15                      |
| cube8 kissing, ball .42, D 12             | 8   | 0.377   | 0.47 / 3          | 1.47              | 0.281                | 2.40                    | 30.6              | 20                      |
| ico12 .99, shell 1 ± .03, D 6             | 12  | 0.380   | 0.22 / 2          | 1.22              | 0.544                | 1.46                    | 34.5              | 27                      |
| 600-cell vault, D 5, xw .3 w0 .1 interior | 120 | 2.358   | 0.52 / 4          | 1.52              | 0.120                | 1.15                    | 263.9             | 303                     |
| 600-cell medallion, D 5, WKISS            | 120 | 2.416   | 0.05 / 1          | 1.05              | 0.736                | 1.32                    | 282.7             | 246                     |
| 600-cell snowflake .995, D 7, w0 .06      | 120 | 5.975   | 0.32 / 2          | 1.32              | 0.407                | 5.51                    | 787.9             | 278                     |
| `mandelboxKifs` `estimateDistance`        | —   | 45.2    | —                 | —                 | —                    | —                       | —                 | —                       |

Readings:

- **The fold is not the cost.** Marched queries fold shallowly (mean k at most
  0.57, max 4, even at D = 12), because deep copies are sub-pixel and rays stop
  on shallow ones. The "D × 120 × march steps" worst case does not describe the
  query distribution a tracer produces.
- **The cover is the cost at 120 generators.** 264–788 member evaluations per
  eval, against 22–35 in 3D. The snowflake is the worst row (5.5 candidates per
  eval), matching the family doc's costliest panel.
- **Per eval the family is cheap.** On the same CPU and harness the 3D rows cost
  0.31–0.38 µs against `mandelboxKifs`' 45.2 µs (about 120–145× cheaper), and the
  600-cell rows 2.4–6.0 µs (about 7.5–19× cheaper). Real-driver µs/ray is a bench
  obligation (below); the shipped fold core's recorded figure to set it beside
  is 49 µs/ray primary for `mandelboxKifs` at width 12 on Iris
  (`docs/surface-gpu-kernels.md`).
- **Nearest centre equals the containing-ball scan: 0 mismatches** over every
  fold test of every row, and the radial reject (below) never rejected a point
  that had a containing ball.

### f32 against f64

Two query sets per fixture: the marched points above, and a DEEP-WORD stress set
(40,000 points each: a point 10⁻⁶–10⁻¹ seed radii off a seed surface, carried
through a random reduced word of length 1..D, so the fold spends up to D
inversions). Compared on queries where both estimates are positive.

- **Absolute excess of the f32 estimate over f64: at most 3.3·10⁻⁷ world units on
  the marched sets and at most 1.1·10⁻⁷ on the deep-word sets — FLAT in fold depth**
  (oct6 kissing: 7.3·10⁻⁸ at k = 1, 6.1·10⁻⁸ at k = 12; cube8 kissing: 1.1·10⁻⁷
  at k = 6, 4.4·10⁻⁸ at k = 12; 600-cell snowflake D 10: 2.3·10⁻⁸ at k = 8).
  No query exceeded 10⁻⁶.
- **Relative excess is unbounded** (up to 10¹² at f64 distances of 10⁻²⁰, below
  anything f32 can represent). A relative margin cannot be the argument.

### Source sizes today

Measured with `surfaceDeKernelWgsl` (width 4, workgroup 16, private frontier,
stage 2 off) and `surfaceFragmentFor` / `surfaceFragmentResolvedFor` /
`surface4FragmentFor` at their defaults:

| Source                              | Bytes                                       |
| ----------------------------------- | ------------------------------------------- |
| WGSL escape4 eval / march / shade   | 8,784 / 13,262 / 20,169                     |
| WGSL fold4 eval / march / shade     | 23,309 / 27,787 / 58,013                    |
| WGSL bulb shade                     | 15,172                                      |
| Draft 4D sphere-inversion value fn  | 2,427                                       |
| GLSL 3D bulb (resolved = emitted)   | 40,520                                      |
| GLSL 3D escape (resolved = emitted) | 57,008                                      |
| GLSL 3D escape + finish             | 59,407                                      |
| GLSL 3D affine/fold plain           | 84,185 resolved → 29,971 emitted (stripped) |
| GLSL 4D plain / finish / plane      | 64,296 / 65,409 / 20,321 emitted            |

One incidental finding: the 4D finish arm sits 127 B under the 65,536 B
`SURFACE_GLSL_STRIP_BYTES` threshold, not the 1,658 B `docs/surface-glsl-tracers.md`
records. Benign (crossing only strips it), but that record is stale.

## 1. Core identity and routing

**Two new WGSL cores, `core: "sphereInv"` and `core: "sphereInv4"`, disclosed as
the eighth and ninth.** Not an extension of any existing core:

- The descent cores (`fold`, `affine`, `fold4`, `affine4`) invert transform
  maps inside a beam/frontier; the family's representation verdict already
  showed the per-map vocabulary draws a different object.
- The forward cores (`escape`, `bulb`, `escape4`) iterate `v <- f(v) + p`; the
  seed orbit has no `+ p` and no escape.
- A new `kind` inside `escape`'s link dispatch is the hazard the bulb core's own
  doc names (`kind != 2u` / `kind != 1u` negations).

**Why the seven existing cores stay byte-identical.** Every emitted text in
`surfaceDeKernelWgsl` is a function of `opts.core` through ternary chains
(`rawDescentBlock`, `rawCoreHitInfoText`, surface-de-gpu.ts:7680 and :12786)
and derived predicates (`core4`, `forward`, `mapsBinding`, `foldRadii`,
surface-de-gpu.ts:4272–4419). The new cores add one arm to each chain AHEAD of
the `"fold"` default and a new predicate `siCore`; `core4` gains `"sphereInv4"`
(it needs the 4D tail and the 4D shade normalizers). For each of the seven
existing values every predicate evaluates exactly as before, so their text is
unchanged by construction. This is PINNED against the pre-change module, not
argued: the first commit records SHA-256 digests of the generated source over a
sweep of the seven cores × three modes × every legal option combination the
existing tests already enumerate, before the new core exists; every later
commit asserts the digests unchanged.

**Target kinds.** `SurfaceComputeTarget` gains
`{ kind: "sphereInv"; de: SphereInversionDE; groundPlane?: boolean }` and
`{ kind: "sphereInv4"; de: SphereInversionDE; groundPlane?: boolean }`;
`SurfaceRouteKind` gains the same two names. `isFourDTarget` includes
`sphereInv4` (its rotor/slice is per-frame `view4` state). `isForwardTarget`
does NOT include either. That exposes a real hazard: surface-compute.ts has six
`!isForwardTarget(target)` sites and four `target.de.foldFinal` reads
(:2714, :2765, :3115, :4600) that treat "not forward" as "IFS descent". The
discriminated union turns each into a compile error for the new kinds (the DE
has no `foldFinal`), which is the intended catch; the fix is a named
`isDescentTarget` (`ifs`/`ifs4`) at those sites, not widening
`isForwardTarget`.

**Routing precedence.** A document carrying the scene-level sphere-inversion
block routes to this family REGARDLESS of its transform list — the block
replaces the transform system as the subject. The dimension comes from the
resolved arrangement. A resolver refusal is `ineligible` with the resolver's
reasons and never falls back to the transforms (that would render a different
object than the document names). `degraded` (tangency cusps) routes normally
with its disclosure.

**Engine per dimension.**

- **3D: PREFERRED compute, GLSL fallback arm** — the escape/bulb precedent. The
  tables fit a uniform block (section 6).
- **4D: COMPUTE-ONLY, disclosed.** Entry is refused without an adapter and a
  mid-session device loss exits the mode with the toast, exactly as fold-shaped
  and escape-shaped 4D sessions do (main.ts:5894, :6084). The reason is
  structural, not taste: the 600-cell's tables are 461 KiB, far past any
  guaranteed uniform block, and the 4D fragment tracer has no data-texture
  binding mechanism. The engine asymmetry has precedent (3D escape has a GLSL
  arm; `escape4` does not) and changes no capability: the family renders in both
  dimensions. The GLSL lift's shape is in section 6.

## 2. Generator storage and the containing-ball search

**Storage: the existing maps binding (1), re-typed by this core as a flat
`array<vec4f>`.** Every compute layout already declares binding 1 as read-only
storage (the bulb core binds a zero stride there, surface-compute.ts:3198), so
no bind-group or layout path forks. Uniform arrays are refused: they need a fixed
footprint, and the maps-uniform probe already measured no gain from them.

The packer transfers `buildSphereInversionTables` output (f64, rounded once),
DEDUPLICATED: `copies[j]`'s complement members `ext(I_j(B_l))` are exactly
`gaps[j]`'s balls with the sign flipped, so each gap ball is stored once and one
pass over it serves both terms (section 2's scan).

| Section            | 3D entry (1 vec4) | 4D entry (2 vec4)             | Count                 |
| ------------------ | ----------------- | ----------------------------- | --------------------- |
| generators         | `(c.xyz, r)`      | `(c.xyzw)`, `(r, 0, 0, 0)`    | n                     |
| seed members       | `(c.xyz, ±r)`     | `(c.xyzw)`, `(±r, 0, 0, 0)`   | s                     |
| per j: seed images | `(c'.xyz, ±r')`   | `(c'.xyzw)`, `(±r', 0, 0, 0)` | s                     |
| per j: gap balls   | `(c'.xyz, r')`    | `(c'.xyzw)`, `(r', 0, 0, 0)`  | n − 1, gapIndex order |

`±r` carries the member sign (radii are positive, so the sign is free). Term j
starts at `n + s + j·(s + n − 1)`. Sizes: oct6 ball seed 43 vec4 (688 B); ico12
with a three-member cut shell 183 vec4 (2,928 B); 600-cell with a cut shell
(120 + 3 + 120·122)·32 = 472,416 B.

**The containing-ball search — sound, value-identical acceleration.** For the
registry's UNIT arrangements (centres at distance 1, one shared radius r, which
the resolver guarantees), two facts hold, and the packer sets a `uniformUnit`
lane only when the tables satisfy both (a later explicit-authoring arrangement
without them takes the plain linear test, same kernel):

1. **Radial reject.** `x ∈ B(c, r)` with `|c| = 1` implies `||x| − 1| < r`. So
   `||x| − 1| >= r` proves no ball contains `x`: an O(1) exit from the fold.
   Measured: 12–74% of fold tests end here.
2. **Nearest centre.** If `x ∈ B_i` then for any `j ≠ i`,
   `|x − c_j| >= |c_i − c_j| − |x − c_i| > 2r − r > |x − c_i|` (disjointness).
   So the containing ball, if any, is the nearest centre — the largest
   `dot(x, c_j)` over non-parent `j`, since `|x − c|² = |x|² − 2x·c + 1` — and
   one radius test settles it. At a tangency point `x` lies in no open ball, so
   the CPU's lowest-index tie rule never engages. Measured: 0 mismatches.

That makes a fold test one dot-product scan plus one distance, with no square
roots. **Binning (a cubed-3-sphere cell table of candidate generators) is NOT
recommended for the first cut**: the fold is a small share of the work, and the
cover still needs every generator's distance for its prune.

**The covering scan.** One pass of n distances at the folded point serves three
things: the domain term's `max_i(r − |x − c_i|)` (equal to `r − min_i|x − c_i|`),
the per-generator prune `|x − c_j| − r >= best`, and candidate selection. For
each surviving candidate j, one pass over its s images and n − 1 gap balls gives
`minGap = min_l g_l`. The copy term is `max(images, |x − c_j| − r, −minGap)` and
the gap term is `minGap`, gated by the CPU's own budget rule (`isParent || m >= 1`
for the copy, `|| m >= 2` for gaps). Per eval that is about
`n + candidates·(s + n − 1)` square roots: roughly 260–790 at 120 generators by
the table above, 20–35 in 3D. If the real driver says the snowflake row is too
slow, the recorded lever is a two-level gap hierarchy per generator (the near
ring explicit, far gap balls under bounding balls whose `|x − C| − R` lower bound
skips them). It is value-exact because it can only skip a ball that cannot lower
`minGap`.

**Cutoff.** The first cut IGNORES the cutoff and returns the full value, which
satisfies `surface-de.ts`'s contract trivially (a full value at or above the
cutoff is the cutoff-0 result; one below it is below). The CPU's early exit is a
work saving worth at most the 1.2–5.5 candidates measured, so it is a lever, not
a requirement.

## 3. Frozen params wire growth

Verified in code: 3D frozen 0–207 (surface-de-gpu.ts:523–544), variant block
208–271, lens fold / pad 272–287, plane/balloon 288 (`SURFACE_GPU_PARAMS_PLANE_BYTES`
336), trap 336–399 (`SURFACE_GPU_PARAMS_TRAP_BYTES` 400). 4D: affine4 tail
208–463 (`SURFACE_GPU_PARAMS4_BYTES` 464), lens4/escape4 variant 464–575
(`SURFACE_GPU_PARAMS4_LENS_BYTES` 576, `lens4Fold` at 560), plane/balloon 576
(`SURFACE_GPU_PARAMS4_PLANE_BYTES` 624), trap 624–687
(`SURFACE_GPU_PARAMS4_TRAP_BYTES` 688).

**The new blocks occupy the variant regions only — the escape and bulb
precedent — so no frozen offset moves, and the plane block keeps its one offset
per dimension.** Mutual exclusion with lens/escape/bulb is by core, as theirs is.

3D, `core: "sphereInv"` (struct 288 B plain, 336 B with the ground plane):

| Offset | Field                                                                               |
| ------ | ----------------------------------------------------------------------------------- |
| 208    | `vec4u siCounts` — (generatorCount n, seedCount s, depth D, termStride = s + n − 1) |
| 224    | `vec4f siRadii` — (r, r², f32 pole floor², f32 slack)                               |
| 240    | `vec4u siFlags` — (uniformUnit, 0, 0, 0)                                            |
| 256    | `vec4f` pad (packed zero)                                                           |
| 272    | `vec4f padF` — the escape/bulb pad, so the plane block lands at 288                 |
| 288    | ground-plane block when `groundPlane` (existing layout)                             |

Frozen-block usage: `boundCenter` 0 = origin; `boundingRadius` 12 and
`visibleRadius` 24 = `tables.boundingRadius`; `stepScale` 20 = 1
(`SPHERE_INVERSION_STEP_SCALE`); `symOrder` 40 = 1; `mapCount` 48 = n (so host
code that reads it sees the generator count); `maxDepth` 52 = D; `finalM`
identity; `finalSigmaMin` 1.

4D, `core: "sphereInv4"` (struct 576 B plain, 624 B with the ground plane):

| Offset  | Field                                                                                                                                                                                                                                                                                                   |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 208–463 | the affine4 tail: `rotorInv` rows live; `stepBack4`/`final4` identity; `w0` 416 live; `sliceHalfW` 420 = 0 (packer THROWS otherwise); `final4SigmaMin` 424 = 1; `visRadius4` 428 = full `boundingRadius`; `radiusCenter4` 432 = origin; `radiusMinD` 448 = 0; `radiusInvRange` 452 = 1/`boundingRadius` |
| 464     | `vec4u siCounts` (as 3D)                                                                                                                                                                                                                                                                                |
| 480     | `vec4f siRadii` (as 3D)                                                                                                                                                                                                                                                                                 |
| 496     | `vec4u siFlags` (as 3D)                                                                                                                                                                                                                                                                                 |
| 512–575 | pad (packed zero) — the escape4 argument: the region is the lens4 block's, so the plane block keeps 576                                                                                                                                                                                                 |
| 576     | ground-plane block when `groundPlane` (existing layout)                                                                                                                                                                                                                                                 |

The frozen `visibleRadius` 24 packs the slice-adjusted
`sqrt(max(0, R² − w0²))` (the rotor is orthogonal, so the query hyperplane's
distance from the origin is `|w0|`); `visRadius4` keeps the full R so HEIGHT does
not swim with the slice. The 4D HEIGHT/RADIUS normalizers are therefore the
shared shade entry's existing `core4` text, unchanged.

**Composition policy** (codegen and packer both enforce; each throw carries its
reason):

| Feature                                                                          | Decision                                                                                                                                                      |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ground plane                                                                     | COMPOSES — plane block at 288/576; the analytic ball certificates use the origin and full R, like escape4                                                     |
| finishes (`finish`)                                                              | COMPOSES — shade-mode only, stride-3 shadeMaps, slot 0 (section 5)                                                                                            |
| lighting rig (`lighting`)                                                        | COMPOSES — shade-entry only, no params change; one production-frame bench leg runs it                                                                         |
| supersampling, `statusOut`, `rays`, `evalStride`                                 | COMPOSE — host/entry generic (`evalStride` returns the value, since stride and acceptance coincide here)                                                      |
| `width`, `shadeDeWidth`, `sharedFrontier`, `bnbStage2`, `slabExt`, `mapsUniform` | INERT (validated), as for the forward cores                                                                                                                   |
| balloon                                                                          | REFUSED — an inversion-group orbit under a further inversion is untested for the echo's clearance and far-cap rules; no measured subject asks for it          |
| lens (`lens`, `lensPost`)                                                        | REFUSED — the scene block has no final transform                                                                                                              |
| tiling (finite and lattice)                                                      | REFUSED — plausible for the finite arm (the bound ball is certified), but no fixture or look call exists; lattice has no finite ball                          |
| kaleidoscope                                                                     | REFUSED at eligibility — the arrangement IS the symmetry; a wedge fold over it is a different object                                                          |
| slab (`sliceHalfW > 0`, `slabCover`)                                             | REFUSED — the CPU refusal (`sphere-inversion-de-4d.ts`); the app holds thickness at 0 exactly as escape4 does (`surface4SlabAvailable = false`, main.ts:5934) |
| shape trap (colour and geometry)                                                 | REFUSED — the escape family's forward-orbit channel                                                                                                           |
| condensation, schedule, xaos (`chaos`)                                           | REFUSED — transform-system features                                                                                                                           |
| pattern, optics                                                                  | REFUSED for the first cut — pattern needs a `source4` convention and the release gate's own evidence; optics ships dormant everywhere                         |

## 4. f32 soundness argument

**Argument.** Let `x_i` be the fold point after i inversions and `x̃_i` its f32
value. Inversion about `c` with radius R is conformal with local scale
`s = R²/|x − c|²`, so a position error propagates as
`δ_{i+1} ≈ s_{i+1}·δ_i + ε_{i+1}`, with `ε` one step's rounding (a few ulps of
`|x_{i+1}|`). Every covering member is a 1-Lipschitz SDF, so the folded bound is
off by at most `δ_k` plus its own rounding. The transport multiplies a folded
distance by `r_i/(s'_i + d)`, which for small `d` is `1/s_i` — the exact inverse
of the scale that step applied. Carried back, each rounding contributes about
`ε_i / Π_{j<=i} s_j <= ε_i`: a sum of per-step roundings, each at its own step's
scale and none amplified. For unit arrangements the coordinates stay O(1), so the
world-space error is O(10⁻⁷) and FLAT in depth. That is what the emulation
measured (at most 3.3·10⁻⁷, flat from k = 0 to 12). Near a centre `|x'|` grows
like `R²/d` but `s` grows like `R²/d²`, so `ulp(|x'|)/s ≈ 1.2·10⁻⁷·d` shrinks.
Near a tangency the gap terms go to 0 in both precisions: a stall, never an
overshoot. `inversionDistanceLowerBound`'s `1 + 2⁻²⁰` covers only its own
expression's relative rounding, as its doc says, and stays as emitted by
`inversionDistanceShaderSource` — unchanged.

**Proposal.**

- **An ABSOLUTE slack, never a relative factor:** after transport, a positive
  value returns `max(0, v − slack)` with `slack = 1e-6` world units. That is
  about 3× the worst marched excess and 9× the worst deep-word excess, and 10×
  under `SURFACE_GPU_HIT_FLOOR` (10⁻⁵), so the fattening it adds is invisible
  under acceptance. It is valid BECAUSE the arrangements are unit-distance by
  construction (the resolver's UNIT ARRANGEMENTS rule). The slack rides
  `siRadii.w` rather than a literal, so a future explicit-authoring arrangement
  scales it by its own coordinate magnitude without a layout change. If the
  real-driver gate below fails, raise it toward 4·10⁻⁶ (still 2.5× under the hit
  floor). Never introduce a multiplicative factor — the family's damping verdict
  applies to f32 as much as to f64.
- **f32 pole floor:** `|x − c|² <= (2⁻²⁰·r)²` returns 0 with pole status
  (the CPU uses 10⁻¹²·r, which is below f32 resolution). Its world footprint at
  fold depth k is at most `2⁻²⁰·r/Π s`, under 3·10⁻⁷, so a false "hit" there is
  sub-hit-floor. `s = R²/d²` then stays at most 2⁴⁰ and `|x'|` finite.
- **Exhaustion:** no special code. The CPU's "drop the stuck ball" is the budget
  rule with m = 0, which the scan already applies.

**What the bench must measure** (section 7): on every positive CPU row, the
ONE-SIDED excess `max(gpu − cpu64) <= 0` after the slack, reported per row on
`--display=:0` — a driver's fused multiply-add or reassociation is exactly what
the emulation cannot see. Also the pole-exclusion count (expected 0), and a
wall-proximity census (below).

## 5. Material attribution and shading

The CPU hit record (`sphereInversionHitInfo`, `sphere-inversion.ts:847`) maps onto
the existing `SurfaceHitInfo` members (surface-de-gpu.ts:8859), with no new
member:

| Hit-info member | Sphere-inversion meaning                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `firstChoice`   | 0 — one material slot, the forward cores' convention, so finishes compose as slot 0 unchanged                                                                      |
| `trap`          | GENERATION: `hit.depth / (D + 2)` in [0, 1] — the word length of the winning term, the family's defining attribution (seed, first copies, gap balls, deeper)       |
| `rings`         | closest normalized radial approach of the fold, `min_i(foldRadius_i / r)` (1 when k = 0) — concentric rings inside each pearl, from values the fold already stores |
| `sheets`        | seed surface: `(seedMember + 1)/(s + 1)`, 0 for a generator wall, gap ball or pole — outer shell, inner shell and cut face read apart in the vaults                |
| `sStar`         | 0 (no slab)                                                                                                                                                        |

`firstGenerator`/`lastGenerator` are not read by the first cut; they are the
input for a later "By generator" slot table (up to 120 slots; the shadeMaps
binding is runtime-sized in WGSL). Whether "By Transform" should mean
GENERATION slots instead of one slot is a persistence/UI decision, because the
finish vocabulary is per transform today and this block has no transforms
(Decisions requested). There is no balloon, so no `shell`/`colorPos`
attribution.

**Probes.** The core emits no probe body: `shadeDeWidth` is a frontier width and
this core has no frontier, so the shared shade entry's taps call `surfaceDE`
(`probeDe`, surface-de-gpu.ts:5004–5005). Normal, shadow and AO taps take
central differences of the certified bound. Near a hit the winning term is an
exact sphere SDF transported conformally, so its gradient is the surface normal;
the pre-gate and 4D search sheets rendered with the same finite-difference taps
(`de-preview.ts`) and read correctly. The recorded lever, not in the first cut,
is an analytic normal: the winning member's sphere normal carried out through
the fold's k reflections (`I − 2uuᵀ` per inversion), which saves the normal taps
and is exact at sub-pixel lace. It changes the SHARED entry, so it needs its own
byte-identity pin.

**Ground plane.** MISS classification and the plane shade arm are shared text;
the certificates use origin + full R, so the floor does not slide as the slice
scrubs (the escape4 decision).

**4D view.** The body's prologue is the escape4/affine4 lift
`q = rotorInvApply4(vec4f(pIn, params.w0))` (surface-de-gpu.ts:9910). The rotor
and slice are per-frame `view4` spec state repacked per pass. A slice's distance
is at least the 4D distance, so the certified 4D bound is a certified in-slice
bound at every pose (the CPU module's argument).

## 6. GLSL fallback feasibility

**3D: an arm, `SURFACE_SPHERE_INV`, replacing the descent bodies wholesale** —
an ALTERNATIVE to `SURFACE_ESCAPE` and `SURFACE_BULB` (`surfaceFragmentFor`
refuses the pairs), composing with `SURFACE_GROUND_PLANE` and `SURFACE_FINISH`,
refusing `SURFACE_BALLOON`.

- **Storage:** a std140 uniform block `SurfaceSphereInv3` at a fixed
  `SPHERE_INV_GLSL_MAX_GENERATORS = 12` (the 3D registry maximum) and 3 seed
  members: 12 + 3 + 12·(3 + 11) = 183 vec4 = 2,928 B plus a header vec4, far under
  WebGL2's guaranteed 16 KiB block (the `SurfacePosts3` precedent). A
  construction past the cap routes compute-only with its reason.
- **Loops:** the tracers' `for (int j = 0; j < MAX; j++) { if (j >= uCount) break; }`
  form over the fixed caps; the fold loop is bounded by
  `SPHERE_INVERSION_MAX_DEPTH`.
- **Size:** the WGSL draft value function measured 2,427 B. Value, hit-info and
  uniforms together should cost roughly 5–7 KB of GLSL, putting the resolved
  source near the bulb arm's 40,520 B plus that — about 46–48 KB, unstripped, with
  ~17 KB of headroom under the 64 KiB strip threshold and far under the 82.2 KB
  Mesa crash. The arm's test asserts `surfaceFragmentResolvedFor(...).length`
  and `surfaceFragmentFor(...).length` against both, per the file's
  measure-before-adding rule.
- **No grid** (gridless by decision, like the escape/bulb sessions): a floor
  table would need its own soundness argument for this family, and the estimator
  is cheap.

**4D: no arm in the first cut — compute-only, disclosed.** The 120-generator
tables (461 KiB) cannot ride a uniform block; the smaller 4D arrangements
(cross8/tess16/cell24, up to 24 generators) could, but the subjects that met the
4D bar are the 600-cell's. Adding an arm to `SURFACE4_FRAGMENT` is not blocked
on size: the 4D plain source is 64,296 B and a resolved arm would simply strip,
landing far under the cliff. The shape of that later lift, recorded so it costs
no rediscovery:

- an RGBA32F data texture read with `texelFetch` (legal in WebGL2 without
  float-filtering extensions), one texel per 4D ball, plus a small header block;
- a `SURFACE4_SPHERE_INV` define resolved JS-side through `surfaceFragmentFor`
  (the 3D directive name inside the source, as the balloon and plane arms do);
- the same shared emitter's GLSL 4D dialect;
- the gate: `scripts/surface-4d.verify.mjs`-style compute-vs-WebGL IoU on the
  vault and medallion.

Its cost on the fragment path (about 260–790 square roots per eval inside the
strip pump) is the open question that lift would measure.

## 7. Bench fixtures (`bench:surface`)

A new section module `src/app/gpu-bench/sphere-inversion.ts`, with a unit test,
beside `schedule.ts`/`chaos.ts`. It appends rows and moves no existing fixture or
cap.

**Eval agreement rows** (700 queries each: half uniform in the bound ball, half on
shells 10⁻⁴–10⁻¹ copy radii outside random copies, the oracle sheet's design):

| Row               | Construction                     | Pose                     | Pins                                                                                                                                                            |
| ----------------- | -------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `siOct6Pearls3`   | oct6 r .70, ball .28, D 8        | —                        | the baseline                                                                                                                                                    |
| `siOct6Kiss3`     | oct6 kissing, ball .28, D 12     | —                        | tangency cusps (degraded), deep folds                                                                                                                           |
| `siCube8Shell3`   | cube8 .99, shell 1 ± .03, D 7    | —                        | two-member seed, `sheets`                                                                                                                                       |
| `siIco12Vault3`   | ico12 .99, cut shell, D 5        | —                        | three-member seed, 12 generators (GLSL cap)                                                                                                                     |
| `siFlat4`         | oct6 r .70 at w = 0, 4-ball, D 8 | identity                 | 4D kernel against the 3D kernel on the same queries, within 10⁻⁶, plus CPU agreement (WGSL `length` summation order makes bit identity unpromisable on the GPU) |
| `siCell24Shell4`  | cell24 shell                     | xw .3, w0 .15            | the CPU unit fixture, 24 generators                                                                                                                             |
| `si600Vault4`     | 600-cell vault, D 5              | w0 .08; xw .3 w0 .1      | 120 generators, the cut member                                                                                                                                  |
| `si600Medallion4` | 600-cell medallion, D 5          | WKISS; xw .4 yw .3 zw .2 | double rotation                                                                                                                                                 |
| `si600Snowflake4` | 600-cell .995, ball .20, D 7     | w0 .06                   | the cost ceiling (most candidates)                                                                                                                              |

**Comparators.**

- Plain `surfaceEvalTol` agreement (gpu-bench/main.ts:9584) at `fail = 0`. The
  estimator is deterministic, not a chaotic forward orbit, so the escape rows'
  `forwardQueryStable` / flip classifier is NOT needed.
- The one-sided f32 gate from section 4 on positive rows.
- A CPU-side wall-proximity census, per row: queries within 10⁻⁵ of a generator
  sphere the f64 fold visits. The estimator can jump across a wall, because the
  budget and parent change, so a rounding-side flip there is a legitimate
  disagreement. The census is knowable without a GPU (the power-link fixtures'
  method). Exclusion is added ONLY if the first run's failures cluster there,
  with the count disclosed and capped per row.
- Anti-vacuity, per row: at least 32 queries with fold k ≥ 3, at least 32 where
  a copy term wins and at least 32 where a gap term wins (the trap-geometry
  activation count).
- Hit-info rows compare the integer attribution (`depth`, `firstGenerator`,
  `seedMember`) on queries whose winning-term margin exceeds the tolerance.

**March rows.** `marchUnprojectSphereInv3` (oct6 kissing pearls) and
`marchUnprojectSphereInv4` (600-cell vault interior camera at xw .3 w0 .1): the
bounded 96×54 app-ray march against the CPU emulator, `fail = 0`, no truncation,
at least one pass, and CPU and GPU hit counts strictly between zero and the ray
count.

**Production-frame rows.** `computeFrameSphereInv3` (with ground plane and a
finish) and `computeFrameSphereInv4` (with the lighting rig) through
`SurfaceComputeRenderer`. A real adapter must complete with a HIT/MISS mix and
zero EXHAUSTED/ACTIVE rays; only a software diagnostic may truncate.

**Timing rows** on `--display=:0`, with the renderer line checked for a real
hardware driver and the machine-quiet baseline certified: µs/ray for the 3D
pearls and each 600-cell row, beside the existing `mandelboxKifs` width-12 and
escape4 rows. That turns the CPU ratios above into the real-driver claim.

## 8. Offline export, force frames, capture tiling, teardown

- **Force-frame key: no change.** The construction and depth are CREATE-TIME in
  the first cut: an edit restarts the session, and `teardownSurfaceCompute`
  clears `surfaceComputeForceKey` (main.ts:4706). Ground plane, finishes, the
  lighting rig and `view4` are already keyed. If a later cut makes any
  sphere-inversion quantity a live per-frame spec field, it must join
  `surfaceComputeForceFrameKey` with a tag literal, per that module's collision
  argument.
- **Capture tiling: no change.** Rays derive from full-image pixels in the shared
  entry, and the tables are per-session rather than per-ray, so `maxFrameRays`
  and `surfaceComputeTileRows` are unaffected.
- **Teardown: no new lifecycle.** The larger maps buffer (up to about 461 KiB)
  is created with the session inside the existing error-scoped creation path and
  released by the deferred `device.destroy()`.
- **Offline export:** no grid worker to settle; the session is gridless.

## 9. Work split and order

The WGSL route item lands first; the GLSL item consumes its emitter.

**WGSL route (3D and 4D, pinned by `bench:surface`):**

1. **Pin the pre-change sources.** A test with SHA-256 digests of
   `surfaceDeKernelWgsl` over the seven cores × modes × legal option sweep,
   recorded before any core change. Commit.
2. **Shared algebra, once.** A new `src/fractal/sphere-inversion-gpu.ts`:
   - the dialect- and dimension-parameterized emitter
     `sphereInversionShaderSource(dialect, dim)` (fold with radial reject and
     nearest centre, deduplicated cover, transport via
     `inversionDistanceShaderSource` verbatim, slack, f32 pole floor);
   - the f32 TS twin `estimateSphereInversionDistanceF32` (bench stability twin;
     a unit test holds its excess over f64 at or below the slack on the oracle's
     queries);
   - `packSphereInversionGpuTables` and the 3D/4D params packers, with offsets
     pinned by test.
     Commit.
3. **`core: "sphereInv"`** — eval/march/shade, hit-info mapping, the
   composition throws; digests unchanged. Commit.
4. **`core: "sphereInv4"`** — the lift, `sliceHalfW` throw, 4D normalizers;
   digests unchanged. Commit.
5. **Renderer.** `SurfaceComputeTarget` kinds, `isDescentTarget` at the six
   negation sites, params sizing (288/336, 576/624), the maps buffer, and
   `surface-compute.test.ts` expected bytes. Commit.
6. **App routing.** The session start consumes the eligibility `kind`; 4D
   refuses entry without an adapter and exits on loss with the toast; 3D is
   compute-only until the GLSL item lands, disclosed as such in that interim.
   Commit.
7. **Bench.** Rows and comparators, a SwiftShader run, then a `--display=:0` run
   on a certified quiet machine; record the verdicts and µs/ray in
   `docs/gpu-bench-surface.md` and this doc. Commit.

**GLSL route (3D arm, 4D refusal disclosed):**

1. **Pin the pre-change GLSL.** Digests of `surfaceFragmentFor` /
   `surface4FragmentFor` over their legal arm sweep. Commit.
2. **The arm.** The emitter's GLSL 3D dialect, `SURFACE_SPHERE_INV` in
   `surface-material.ts`, the `SurfaceSphereInv3` block, the pair refusals, and
   the size assertions against the strip threshold and cliff. Commit.
3. **Fallback wiring.** 3D switches from compute-only to PREFERRED with fallback
   (`?surfacegl` forces it); the 4D compute-only disclosure copy stays. Commit.
4. **Browser gate.** A `scripts/sphere-inversion-surface.verify.mjs` that enters
   from the UI; 3D compute vs WebGL object-mask IoU on pearls and vault; 4D
   refused under `?surfacegl` with its reason; settle latch and DRAW. Commit.
5. **Docs.** Measured sizes into `docs/surface-glsl-tracers.md` (including the
   corrected 4D finish headroom), and the 4D GLSL lift's shape recorded as open
   work. Commit.

## Decisions requested

1. **Two new cores**, `sphereInv` and `sphereInv4`, disclosed as such, with
   byte-identity of the existing seven pinned by a digest fixture recorded first.
2. **Engines:** 3D compute-preferred with a GLSL arm; 4D compute-only, disclosed,
   with the data-texture lift recorded rather than built.
3. **First-cut composition:** ground plane, finishes (slot 0), lighting rig and
   supersampling compose; balloon, lens, tiling, kaleidoscope, slab, shape trap,
   condensation/schedule/xaos, pattern and optics are refused with reasons.
4. **f32:** an absolute slack of 10⁻⁶ world units (unit-arrangement invariant,
   carried on the wire) plus a 2⁻²⁰·r pole floor, gated one-sided on the real
   driver. No relative or multiplicative factor.
5. **Search:** linear scans with the radial reject and nearest-centre test
   (value-identical, 0 measured mismatches); binning and the gap hierarchy stay
   levers, pulled only if real-driver timing asks.
6. **Colour mapping:** trap = generation, rings = closest radial approach,
   sheets = seed surface, one material slot. Whether "By Transform" should
   become per-generation slots (and where a block-level finish lives) goes to
   the persistence/UI owner.
7. **Cutoff ignored** in the first cut (contract-trivial).
8. **Construction is create-time** (restart on edit), so the force-frame key
   does not change.
