# Surface GLSL tracers — `surface-material.ts` / `surface-material-4d.ts`

This is the full measurement record for the two GLSL3 fragment tracers.
CLAUDE.md's `surface-material.ts` and `surface-material-4d.ts` bullets are
condensed pointers into this document — read here for bead ids, byte
figures, and verdicts.

## The 3D tracer

`surface-material.ts` is a GLSL3 full-screen-quad sphere tracer mirroring
`surface-de.ts`'s `estimateDistanceRefined` line for line — the same oracle
discipline as `flame-gpu.ts`. BASE maps are packed into fixed-size (24-slot)
uniform arrays, with kaleidoscope sectors swept from three scalar uniforms
rather than expanded into slots (fr-x029), so symmetry order no longer
counts against the cap. Callers gate eligibility on the bare active-map
count first, so an over-cap count throws here rather than degrading
silently.

Orbit-trap color blends descent choices TOP-DOWN — depth-0 copy dominates,
flam3's convention (fr-gt9i). The per-level decay is now the Color speed
slider (default 0.5, which reproduces that original fixed behavior), and
the rings/sheets orbit-trap color sources ride the same hit-info descent
(fr-rl4b).

## Variant arms

**`SURFACE_FOLD_LENS`** (fr-g58b): compiles when a fold FINAL lens is
present. The preprocessor renames the descent bodies to `surfaceDECore`;
the wrapper owns the public `surfaceDE` overloads, mirroring
`descendLens`. The cores' own `uFinal*` lens uniforms are packed IDENTITY
— the wrapper applies the real lens from `uLens*`.

**`SURFACE_ESCAPE`** (fr-kltj): replaces the descent bodies wholesale with
`escape-de.ts`'s forward loop. `setEscapeSystem` packs it; main.ts routes
here when the IFS gate refuses but `analyzeEscapeSystem` admits. It has
been the FALLBACK since fr-dlxh, with `surface-compute.ts`'s WebGPU
renderer preferred whenever an adapter exists — same marcher, tiers,
strips, capture; no grid (its validity chain is IFS-specific).

Since fr-s04t it CYCLES the whole formula chain: `uEscM`/`uEscT`/
`uEscParams` are declared INSIDE the arm (the `SURFACE_BULB` precedent) as
one slot per link, `uMapCount` is the link count, and `uMaxDepth *
uMapCount` single-link steps keep `uMaxDepth` meaning PASSES.
`uSymOrder`/`uSymPlane` drive `foldQuerySector` — the kaleidoscope's
dihedral query-space wedge fold, applied once before the orbit. The
24-slot cap is the mode's cap: eligibility is one answer for both engines,
and the compute arm's storage list has none.

Since fr-j231 a link may be a POWER map, which cost the arm three things
and no layout change:

- The fold pair's `kind != 2` / `kind != 1` tests are exhaustive by
  NEGATION over {1, 2, 3}, so kinds 4 and 5 sit behind a `kind < 4` GUARD
  rather than beside them. Unguarded, kind 4 satisfies both tests and
  runs both folds — the hazard `surface-de-gpu.ts`'s doc cites as why the
  Mandelbulb became a sixth CORE there.
- `bulbPow8` is DUPLICATED from the `SURFACE_BULB` arm character for
  character, because the two arms are alternatives and neither can see a
  definition emitted inside the other. A test diffs the two bodies so the
  copy cannot drift.
- `uEscLogForm` is a scalar, not the params tail that comment once
  reserved, because the estimate form is ONE number per CHAIN read after
  the orbit — making it depend on which link happened to terminate would
  put a step across every boundary between the two forms.

The hit-info trap gained a second interpolant for the same reason it had
to: `log(r/R)/log(growth)` models constant-factor growth, and a
PRE-SCALED power link routinely has `growth < 1`, so the guard fired and
the trap fell back to fr-7u8t.8's raw integer confetti. A
power-terminated orbit instead reads `log(log r / log R)/log d`, off the
DEGREE tracked beside `growth`.

**`SURFACE_BULB`** (fr-7u8t.9): the escape arm's SIBLING and
`resolveVariantArms`' fifth JS-resolved key, nested inside
`SURFACE_ESCAPE`'s `#else` — the two are alternatives, each replacing the
descent bodies wholesale, so `surfaceFragmentFor` refuses the pair. It is
`bulb-de.ts`'s forward triplex-power loop, packed by `setBulbSystem`,
whose `uBulb*` uniforms are declared INSIDE the arm so no other variant
pays their bytes against the Mesa cliff. Since fr-tdin it is the FALLBACK
arm for bulb sessions exactly as `SURFACE_ESCAPE` is for fold ones
(`?surfacegl` / no adapter / device loss); the compute `core: "bulb"`
kernel is preferred.

**`SURFACE_GROUND_PLANE`** (fr-rhn5): `resolveVariantArms`' fourth
JS-resolved key. An infinite one-sided floor below the session ball, lit
by a `shadeGroundPlane` entry mirroring the WGSL arm term for term
(penumbra shadow + AO under two analytic ball certificates, matte
lighting, the shared fog formula), called from all three miss exits. It
composes with every other variant except `SURFACE_BALLOON` (throws — no
horizon inside the shell); off, it resolves byte-identical to the
pre-plane build.

## The Mesa link cliff and the source-size rule

Turning the ground plane on would have pushed the shared fold/affine
source past the Mesa crash cliff, so plane programs resolve through
`stripGlslSource` instead — a whole-source comment/indentation strip (the
fr-zqu8 probe instance's mechanism, extended) emitting the identical
token stream at a fraction of the raw size.

SINCE fr-s9ll THE STRIP IS A SIZE RULE, not the plane arm's private habit:
`surfaceFragmentFor` strips any resolved source past
`SURFACE_GLSL_STRIP_BYTES` (64KB). A size threshold is the honest
predicate for a size cliff; a hand-kept list of which variants strip is
what drifts the next time one grows a paragraph.

**Measure before adding the next paragraph** to any arm:
`surfaceFragmentFor(escape, lens, balloon, plane, bulb).length` against
`SURFACE_GLSL_STRIP_BYTES`.

NOTE: the 4D fragment tracer needed no fold mirror at all — it carries no
fold GLSL (fr-rsp6 made fold-shaped 4D sessions compute-only), so
fr-3pcu's list of mirrors was one longer than the code.

## Measured sizes

The fold's authored lengths (fr-s9ll) cost this file ~2.2KB —
`uFoldRadii[MAX_MAPS]` inside the folds arm, `uLensRadii` beside
`uLensParams`, `uEscRadii[MAX_MAPS]` inside the escape arm, a
`foldRadiiOf` helper mirroring `surfaceFoldRadii` field for field, and
longer expressions at the four inverse-branch sites and the escape arm's
two forward folds — which took the BALLOON variant from 80.9KB to
83.1KB, i.e. past the size that crashed Mesa (82.2KB observed as the
crash cliff). Measured after the strip rule was applied: affine
74.6->28.0KB, lens 77.6->27.8KB, balloon 80.9->29.3KB, with escape
(39.8KB) and bulb (34.1KB) keeping their comments unstripped at the time.

The escape arm's power-map support (fr-j231, described above) cost the
arm a further 8.3KB — escape 42.2 -> 50.5KB, escape+balloon 48.8 ->
57.1KB — so both still kept their comments at that point.

The balloon pairing was flagged as the one to watch: another paragraph or
two would put it over the 64KB strip threshold. That is not a hazard in
itself — stripped, it comes down to ~15KB, far under the 82.2KB that
crashed Mesa — and balloon+escape is not even reachable in the app
(balloon is IFS-only, fr-5wlv.4), but crossing the threshold does mean
the arm stops reading as source in a driver log.

AND A PARAGRAPH DULY ARRIVED: fr-8fii's corrected clamp-cost record added
~1.7KB, so the measured sizes at that point were escape 52.3KB and
escape+balloon 58.7KB — 11.7KB and 5.3KB of headroom respectively.
Measured at the same time: the affine/lens/balloon variants were
unaffected because they strip unconditionally (28.1 / 27.8 / 29.4KB), and
`bulb` sat at 36.3KB. `SURFACE_BULB`'s own resolved source measured
~33KB, against the descent variants' ~77KB.

Turning the ground plane on, before stripping, would have pushed the
shared fold/affine source (~76.5KB shipped) past the measured ~80KB Mesa
crash cliff (82.2KB observed). Stripped, plane programs emit the
identical token stream at ~30KB raw, the ~79KB lens variant included
(29.6KB with the floor).

## The probe-width verdict

The three shading taps (normal/shadow/AO) ride the value form, which fold
systems route to `surfaceDEProbe` — a width-1 instantiation of the SAME
fold-descent template (fr-zqu8, fr-p8bc's verdict on the fragment path:
one text, two names; march/hit acceptance stay width 12).

Measured on Iris (cold cache, `scripts/shade-width-ab.mjs`,
`?surfshadewidth=N` A/B — N=12 disables the probe and reproduces the
pre-change source byte for byte): the probe CUT the fold program's ~25s
Mesa link 17.9x, to ~1.45s. Mesa inlines the width-12 body per call site;
with the probe, only the march still does. This dissolved fr-f21s's
link-watchdog session-death lottery along with it, settled boxfold pairs
in 509-987ms (baseline 695-1296ms) with frames identical within session
noise, and resolved ~2.3x more mandelboxKifs frame per equal window
(crease pixels stay march-bound; compute owns fold AND fold-lens sessions
where an adapter exists, fr-tzdg + fr-55s1).

The fold-lens variant deliberately carries no probe — its ~79KB source
sits at the `resolveVariantArms` cliff. fr-otkf tracks the lens port; the
stakes are lower now that `SURFACE_FOLD_LENS` is the no-adapter/
`?surfacegl` fallback rather than the lens session's primary tracer.

## Grid sampling and step budgets

The march samples `surface-grid.ts`'s floors (a NEAREST 3D texture)
before paying a descent (fr-55r5 part 2): a floor above the pixel epsilon
(`uAcceptPixelEps`, fr-7xgi's tier-pinned acceptance eps — NOT the
buffer-scaled `uPixelEps`) is both a no-hit proof and a safe stride,
damped by the same `uStepScale` as analytic steps. Gridless marching
stays the always-correct fallback.

Skips drain their own whole-ray cap (`SURFACE_GRID_SKIP_CAP`), never the
analytic march budget, and the full-tier budget is 160 (fr-z70m):
charging cheap conservative skips against 96 march steps starved rays
that thread gaps or graze faces, dissolving far/threaded geometry into
view-dependent dropout speckle — measured and healed in
`scripts/erosion-repro.harness.ts`.

## The 4D tracer

`surface-material-4d.ts` is the 4D twin (fr-vxoj): it sphere-traces the
`w = w0` slice of the rotor-posed 4D attractor, mirroring
`surface-de-4d.ts`'s `estimateDistance4Refined` line for line — refined
certificates plus the width-4 beam (the fr-beck-measured ghost
eliminator, plus fr-jkpn's validity slots).

The slice has THICKNESS since fr-wa6o: `uSliceHalfW > 0` makes every
descent query the SEGMENT spanning `|w - uW0| <= h` instead of the point
`(p, uW0)`, so the mode renders a SLAB's projected shadow rather than a
cross-section. This mirrors the oracle's `halfExtent` line for line — one
`vec4` per chain/candidate, `segmentRadius` in place of every `length`,
and the visible-ball gate widened to `max(0, |uW0| - h)`. `segment` is a
dynamically-uniform branch, so `h = 0` — the shipped default — costs
nothing beyond the extra live registers and renders today's frame value
for value.

Rotor + w-slice are LIVE per-frame view uniforms (`setSurfaceView4`),
unlike flame/solid-4D's frozen snapshot. The slider is normalized
rotated-w; `scene.ts`'s `setSurface4View` converts it to the tracer's
world `uW0` through `wSupport` (fr-33yb), so one slider position is one
hyperplane across every mode. The 24-map cap matches 3D's — the per-map
arrays ride a std140 uniform BLOCK (fr-dqlq: 2688 bytes of the guaranteed
16KB, where default-block arrays would have taken 192 of the guaranteed
224 fragment uniform vectors) — and the kaleidoscope SWEEPS like 3D's
(fr-u91x), so 24 slots means 24 transforms at any order.

Since fr-dlxh's 4D cut, this tracer is the PLAIN-4D fallback arm
(`?surfacegl` / no adapter / device loss — compute is 1.7x faster there)
and also the kaleidoscope-4D MEASURED HOME: the compute arm never
settled a 6-minute order-6 observation that this arm settled in 10.9s
(~35x), so order > 1 routes here by verdict, caveat-free.

fr-b72d's closure attributed that gap: the estimator's own cost is
superlinear in order for BOTH arms (algorithmic depth growth,
CPU-oracle-matched — `scripts/aff4-order-cpu.harness.ts`), and the
compute arm's additional collapse is its march-loop scheduling under that
regime (fr-fniy), not kernel codegen. The uniform-maps and
refinedCert-divergence kernel suspects were both refuted with data.

### 4D variant arms and the resolution mechanism

TWO VARIANT ARMS exist since fr-qxxw/fr-h0c3 — the balloon inverted-union
and the ground plane, each mirroring its 3D original term for term — and
the MECHANISM is the one deviation, forced by measurement: this source is
61,751 B with 3,785 B of headroom under the 64KB strip threshold, and the
arms are ~5.3KB and ~7.7KB, so one monolithic `#if` source would be
~74KB and EVERY 4D session would pay it, in the band where the 3D fold
program takes ~25s to link.

So the arms resolve JS-side, through `surfaceFragmentFor` ITSELF rather
than a second preprocessor (`surface4FragmentFor` is a two-line wrapper),
and the `defines` keys are `SURFACE4_*` while the GLSL directives stay
the 3D names — deliberate, called out at both sites, and renaming them
would break resolution.

Measured: off, 61,751 B (byte-identical to the pre-lift source); balloon
67,123 -> 16,664 B stripped; plane 69,497 -> 17,705 B stripped.

## What could not be copied

Three things could not be carried over from the 3D balloon/plane arms
verbatim:

- `balloonInnerDE`'s far-field clamp: it exists for 3D's FORWARD cores,
  whose zero-iteration far value is not a distance to anything. This
  tracer's core has a value-exact sphere floor that already is the
  bound — the arm records that a future 4D forward core still owes this
  clamp.
- `shadeGroundPlane`'s normalizer: it uses the FULL 4D radius, not
  `sliceVisR`, because `sliceVisR` collapses at the slab edges and would
  make the floor breathe as the slider scrubs.
- The post-march miss's sphere-exit/exhaustion split, which had to be
  ADDED rather than copied: 3D splits it because it has a floor to
  classify into, and EXHAUSTED never planes.
