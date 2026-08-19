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

## Shared background shape (fr-xn9s)

Both tracers' `void main()` used to open with its own literal
`mix(uBgBottom, uBgTop, clamp(vUv.y, 0.0, 1.0))`. That line is now
`mix(uBgBottom, uBgTop, backgroundShapeT(vUv))`, where `backgroundShapeT`
is spliced in verbatim (beside `envTint`, declared before both the
ground-plane arm and `main()`) from `fractal/background-shape.ts` — the
one shape definition every mirror (these two GLSL tracers, the WGSL
compute kernel, the voxel raymarcher, the canvas 2D backdrop, and the fog
midpoint) now reads. `vUv` already IS the full-image UV for these
fragment tracers — a capture scissors strips out of a full-size target
rather than tracing a smaller one — so no `uBgOffset`/`uBgExtent`
uniforms were added here; the compute kernel, which traces capture BANDS
of a larger image, carries that pair instead (`docs/surface-gpu-kernels.md`).

### Radial vignette (fr-h3mp)

The second shape (`BACKGROUND_SHAPES[1]`, `"radial"`): a soft vignette,
smoothstep of the normalized distance from a centre, darkened corners with
a lighter glow behind the attractor on every shipped backdrop (the
`background-shape.ts` module doc's darker-top-lighter-bottom argument).
Three new uniforms carry it, declared right beside `uBgTop`/`uBgBottom` in
both tracers: `uBgShape` (int, 0 = linear / 1 = radial — the shipped
`backgroundShapeCode` mapping), `uBgCenter` (vec2, normalized image
coordinates, `(0.5, 0.5)` by every caller today), and `uBgScale` (vec2,
`background-shape.ts`'s `backgroundRadialScale` of whatever full image
`vUv` spans — the per-axis correction that keeps the vignette CIRCULAR in
real pixels rather than elliptical in normalized UV space on a non-square
viewport). `scene.ts`'s `setBackground` pushes all three to both tracers
(and to the voxel raymarcher) alongside the existing stops; a live viewport
resize re-derives `uBgScale` and re-pushes it even when neither the stops
nor the shape kind moved, since the correction is aspect-dependent.

The shared `backgroundShapeT` body itself is no longer LITERALLY
byte-identical between the GLSL and WGSL emissions once the radial branch
reads through `BackgroundShapeDialect.field` — GLSL's flat `uBgCenter`
cannot share a spelling with WGSL's `shade.bgCenter` struct field. The two
emitted bodies diverge in exactly four tokens (the field accessor prefix,
the local-declaration keyword — WGSL's `let r` has no GLSL equivalent, a
type-prefixed local declaration has no WGSL one — the `float`/`f32` type
spelling, and WGSL's mandatory `u` suffix on the `uBgShape == 1`
comparison) and are pinned identical everywhere else by
`background-shape.test.ts`'s own normalizing test — the shared math still
cannot drift between dialects, only its per-dialect spelling can differ.

## Environment-lit ambient (fr-ehcj)

The backdrop tints the light, hue-preserving, so the render sits IN its
background instead of floating in front of it. An additive backdrop light
is invisible against the default near-black backdrop, which is most
sessions — so instead the sampled backdrop is normalized to its own max
channel before blending, which moves HUE only and never brightness:

```
envTint(n) = mix(vec3(1.0), e / max(max(e.r, max(e.g, e.b)), 1.0e-4), uEnvLight)
   where e = mix(uBgBottom, uBgTop, n.y * 0.5 + 0.5)
```

REFUTED FIRST CUT: the tint originally scaled only the AMBIENT half —
`vec3 lit = uAmbient * ao * envTint(n) + vec3((1.0 - uAmbient) * diffuse *
shadow)` — and settled frames at strength 1, the MAXIMUM, were
indistinguishable from strength 0 on both built-in backdrops. That
refutation is a QUALITATIVE read of the two settled screenshots side by
side, not a pixel diff — the harness that produced them had not yet
cropped to the render pane, so a whole-window diff would have been
dominated by the control panel and worth nothing. It is stated as what it
is: a feature whose maximum cannot be seen has failed its own acceptance
("the backdrop VISIBLY grounds the render"), and no finer number was
needed to decide that.

A headless SwiftShader A/B of the SHIPPED whole-lit-term form
(`scripts/tmp-envlight-ab.mjs`, a throwaway harness modeled on
`surface-repro.verify.mjs`; deleted after this measurement, numbers kept
here) confirms the tint reads now: the fr-jmat boxfold PAIR (two
single-variation boxfold maps — the same fold-lens fragment fallback arm
`mandelboxKifs` would take, but settling on headless SwiftShader's software
rasterizer at 480x300, since the eight-corner `mandelboxKifs` preset never
reached a completed settle in 240s at any strength — stuck marching the
real settle pass, not merely slow to start), dark and haze backdrops,
strength 0 vs 0.35 vs 1, diffed against its own strength-0 baseline
(144,000 px/frame, canvas-only screenshot):

| backdrop | pair   | px differing         | meanAbs (all px) | meanAbs (changed px) | maxΔ | meanSigned R / G / B       |
| -------- | ------ | -------------------- | ---------------- | -------------------- | ---- | -------------------------- |
| dark     | 0→0.35 | 1204/144000 (0.836%) | 0.0307           | 3.6708               | 17   | −0.0498 / −0.0423 / 0.0000 |
| dark     | 0→1    | 1204/144000 (0.836%) | 0.0970           | 11.5988              | 54   | −0.1576 / −0.1334 / 0.0000 |
| haze     | 0→0.35 | 1200/144000 (0.833%) | 0.0241           | 2.8900               | 17   | −0.0447 / −0.0275 / 0.0000 |
| haze     | 0→1    | 1204/144000 (0.836%) | 0.0746           | 8.9280               | 52   | −0.1403 / −0.0837 / 0.0000 |

Every differing pixel is a lit surface HIT — this scene's thin dust is
~1200-1300 hit pixels out of 144,000, and essentially all of them move —
so `meanAbs (changed px)` is the number that answers "is this visible on
the geometry": 11.6/255 (4.5%) at full strength on dark, 8.9/255 (3.5%) on
haze, with individual channel swings up to 54/255 (21%) — plainly visible
on the lit surface, not a rounding wobble, which is what the ambient-only
cut never achieved even at strength 1.

MEANSIGNED B IS ZERO ON BOTH BACKDROPS, not a coincidence: both built-in
stops (`#0d0d18`/`#1f2039` dark, `#3c4a72`/`#5d6d9b` haze) have BLUE as
their brightest channel, so `envTint`'s own-max-channel normalization
divides by (approximately) the blue value at every sampled point —
`envTint`'s blue component comes out near 1 (identity) while red and green,
being smaller than blue in both stops, scale down. The tint therefore reads
as a cooling/darkening of red and green rather than a shift toward blue,
on EITHER shipped backdrop — an artifact of both backdrops sharing a
blue-dominant hue, not a general property of the formula (a red- or
green-dominant custom backdrop would move a different channel pair).

The reason the ambient-only cut failed travels rather than being a fluke of
that scene: ambient is a quarter of the light at the shipped default
(`uAmbient` 0.25), and this app's dark and haze stop pairs sit close
together in hue, so a directional sample mixed between them barely
varies — a small slice of a nearly-uniform color is imperceptible against
the diffuse three-quarters of the light staying neutral.

THE SHIPPED FORM multiplies the WHOLE `lit` term instead, ambient and
diffuse-times-shadow together:

```
OLD:  float lit = uAmbient * ao + (1.0 - uAmbient) * diffuse * shadow;
NEW:  vec3  lit = (uAmbient * ao + (1.0 - uAmbient) * diffuse * shadow) * envTint(n);
```

Specular is deliberately OUTSIDE the product at every call site — added to
`lit * linBase` after the fact, never multiplied through — because an
untinted highlight is what keeps a strongly tinted render from reading
monochrome instead of lit.

HUE-NORMALIZATION ITSELF is a decision worth recording alongside the
ambient-only refutation: an honest additive environment term (`lit +=
uEnvLight * e`) is invisible against this app's near-black default
backdrop — the one every new session and most saved links actually use —
so the physically honest form would be a feature nobody could see. Dividing
the sampled backdrop by its own max channel turns the knob into a hue
carrier instead, which is what makes it read at the default backdrop and
not just on haze.

STRENGTH 0 IS BIT-EXACT: `mix(a, b, 0)` returns `a` exactly regardless of
`b` (the `max(..., 1e-4)` guard keeps `e / …` finite so a zero-strength
blend never risks a NaN contaminating the result), so `envTint` reduces to
`vec3(1.0)` and `lit` reduces to the pre-fr-ehcj scalar formula — the
product of a scalar and `vec3(1.0)` is that scalar per component, same
operand order.

The `envTint` helper is declared once per file (GLSL needs declaration
before use, and each file's `main()` is a single template, so it cannot be
shared across `surface-material.ts` and `surface-material-4d.ts` as one
function) — a pinned test in `surface-material-4d.test.ts` asserts the two
bodies agree character for character (whitespace normalized, since the 3D
"off" variant strips while the 4D "off" variant does not) so the mirror
cannot drift.

A panel **Environment** slider (`surfaceEnvLightSlider`, `state.ts`'s
`envLight`, `DEFAULT_SURFACE_ENV_LIGHT`) exposes the strength, default
0.35 — deliberately non-zero, so existing shared links render with a
subtle environment tint now. It is a different knob from fr-5h5d's
**Tint** (which retargets the depth _fog_ by distance, not the light by
normal); the two compose additively and are worth checking by eye at both
extremes together before calling a look finished. `voxel-material.ts`
(the ◆ Solid raymarcher) is deliberately NOT environment-lit — see that
module's own doc comment for the reason.

Re-measured resolved 3D variant sizes after the whole-lit-term change (raw
resolved / what the driver actually gets, all under the 64KB
`SURFACE_GLSL_STRIP_BYTES` strip threshold once stripped): affine 82284 B
-> 28944 B (stripped), fold lens 85507 B -> 28708 B (stripped), balloon
88698 B -> 30305 B (stripped), plane 88532 B -> 31281 B (stripped),
lens+plane 91755 B -> 31045 B (stripped), escape 55114 B (53.8KB, NOT
stripped), bulb 38578 B (37.7KB, NOT stripped).

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

fr-xn9s's shared `backgroundShapeT` splice (one function, ~460B, spliced
beside `envTint` and read from `main()`'s background line) cost every
variant the same handful of bytes, measured raw / what the driver gets
(escape and bulb stay under 64KB, so for them "what the driver gets"
equals raw — unstripped, same as before this addition): affine 82939B /
29007B, lens 86170B / 28771B, balloon 89379B / 30368B, plane 89203B /
31344B, escape 55762B / 55762B, escape+balloon 62390B / 62390B, bulb
39161B / 39161B. Every arm stays far under the 82.2KB crash cliff, and
none crosses the 64KB strip threshold in either direction — nothing here
changes the strip/no-strip decision for any variant.

fr-h3mp's radial vignette grew `backgroundShapeT`'s body (a branch reading
three new uniforms, `uBgShape`/`uBgCenter`/`uBgScale`, declared beside
`uBgTop`/`uBgBottom`) and cost every 3D variant a further handful of
bytes, measured "what the driver gets": affine 29194B (+187), lens 28958B
(+187), balloon 30555B (+187), plane 31531B (+187), escape 56105B (+343),
escape+balloon 62707B (+317), bulb 39569B (+408). Every arm still stays
far under the 82.2KB crash cliff and no variant's strip/no-strip decision
moved.

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
(`?surfacegl` / no adapter / device loss — compute is 1.7x faster there).
Since fr-fniy it is the fallback for EVERY 4D system and the preferred
arm for none: it briefly held kaleidoscope 4D as its MEASURED HOME, and
lost it on a re-measurement.

That episode is worth keeping, because this arm was right for two
different reasons and then wrong. The compute arm never settled a
6-minute order-6 observation this arm settled in 10.9s (~35x). fr-b72d's
closure attributed the gap: the estimator's own cost is superlinear in
order for BOTH arms (algorithmic depth growth, CPU-oracle-matched —
`scripts/aff4-order-cpu.harness.ts`), so the residual was the compute
arm's host loop and not kernel codegen; the uniform-maps and
refinedCert-divergence kernel suspects were both refuted with data.
fr-b8o5 made both arms forceable and read 147s here against 179s there —
a 1.2x inside THIS arm's own 147/444/604/637s run-to-run spread, so the
rule then stood on a null result rather than a win. fr-fniy found the
compute arm's actual cost (a hit-shade batch width fixed by its own cost
model's attribution pivot rather than by the scene) and the row became
637.5s here against 53.1s there, with a ~5% spread against this arm's 4x
one. Nothing about this tracer regressed; the other arm stopped wasting
90% of its shade dispatches. The full record is in
`docs/surface-compute-renderer.md`.

### 4D variant arms and the resolution mechanism

TWO VARIANT ARMS exist since fr-qxxw/fr-h0c3 — the balloon inverted-union
and the ground plane, each mirroring its 3D original term for term — and
the MECHANISM is the one deviation, forced by measurement: this source is
62,804 B with 2,732 B of headroom under the 64KB strip threshold (fr-h3mp's
radial-vignette branch, re-measured after fr-xn9s's shared `backgroundShapeT`
splice — 62,711 B before fr-h3mp, 62,251 B before fr-xn9s, 61,751 B before
fr-ehcj), and the arms are ~5.4KB and ~7.8KB, so one monolithic `#if` source
would be ~75KB and EVERY 4D session would pay it, in the band where the 3D
fold program takes ~25s to link.

So the arms resolve JS-side, through `surfaceFragmentFor` ITSELF rather
than a second preprocessor (`surface4FragmentFor` is a two-line wrapper),
and the `defines` keys are `SURFACE4_*` while the GLSL directives stay
the 3D names — deliberate, called out at both sites, and renaming them
would break resolution.

Measured after fr-h3mp's radial-vignette branch: off, 62,804 B (under
threshold, so NOT stripped); balloon 68,176 -> 17,086 B stripped; plane
70,588 -> 18,159 B stripped.

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

## The coverage-alpha leak (fr-1wbv)

The tracers' output alpha is the fr-7k0o COVERAGE flag — 1 where the frame
drew something (hit, lit ground plane), 0 where it shows only its backdrop
— counted by scene.ts's settle fold so the WebGL arm can answer the
blank-frame question the WebGPU arm answers from its per-ray status tally.
fr-7k0o shipped it on the claim that the channel was invisible ("blitted
with NoBlending into a canvas created alpha:false").

THAT CLAIM WAS WRONG, and the failure it caused is fr-1wbv: three r163+
creates the canvas WebGL context with `alpha: true` UNCONDITIONALLY — the
`WebGLRenderer` constructor's `alpha` param only picks the default CLEAR
alpha (verified in three r185's source, `WebGLRenderer.js`'s
`contextAttributes`). With `premultipliedAlpha: true` (the default), the
compositor treats canvas RGB as premultiplied, so a coverage-0 pixel with
nonzero RGB composites as `canvas_rgb + page_bg · (1 − 0)` — the page's
own background ADDED to the pane. The app's page background is
`--bg: #0f1018` = (15, 16, 24).

MEASURED, on the settled PNGs of `scripts/surface-4d.verify.mjs`'s two
IoU scenes (real Iris, 1024x640, identity rotor, centred slice — the
frames behind the bead's IoU 0.240/0.354 FAIL): the `?surfacegl` arm's
miss pixels read exactly `DARK backdrop + (15, 16, 24)` — the delta was
(15, 16, 24) on 98.3-98.9% of 146,414 clean background samples per
channel on plain4 (the stragglers one count lower, quantization), the
same on kaleido4, height-independent to ±0.02 — while HIT pixels matched
the compute arm byte for byte and the compute arm's backdrop matched
`resolveBackground`'s DARK pair exactly (its DataTexture carries alpha
255 everywhere, so its pane never composited). The `#vignette` DOM
overlay darkens both arms' pane edges multiplicatively and cancels in
the comparison. The two candidates the bead's own WHERE-TO-START named
are hereby REFUTED as the driver: the strip pump's linear-light
supersample averaging and `buildSurfaceComputeBackground`'s Math.round
quantization each bound at ~1/255 on a constant backdrop, two orders
under the measured offset.

The leak began at fr-7k0o itself (e502afe, the `1.0 -> 0.0` miss-alpha
flip) — fr-dlxh's IoU 0.996 predates it — and reached every WebGL
surface present since: live previews, settles, and the Save-PNG capture
path, whose present-then-`toBlob` snapshot read the same alpha-0 canvas
(an exported miss pixel carried alpha 0 into the PNG). The 3D fallback
arms (escape, bulb, fold-lens under `?surfacegl`/no-adapter) leaked the
same way; it was FOUND on the 4D gate only because that is the one gate
that compares the two engines' frames.

THE FIX IS AT THE PRESENT BOUNDARY, one line: `BLIT_FRAGMENT` copies RGB
verbatim and FORCES ALPHA TO 1. The blit is every surface present's last
hop — settle target, preview target, the compute frame's DataTexture,
and the capture path's present-then-toBlob — so the coverage flag stays
a private channel of the trace targets, which is where fr-7k0o's two
readbacks (`foldSurfaceSample`, `measureSurfaceCoverage`) read it; no
reader consumes alpha from a blit DESTINATION (the one target-to-target
blit, the preview -> settle seed, is fully overwritten by strips before
any pass-completion readback). The WGSL kernels already write alpha 1.0
on every path, so the fix also makes the two engines' presented alpha
identical. RE-MEASURED at the fix, same gate, same protocol (real Iris,
dev server, both scenes): plain4 IoU 0.240 -> 1.000 (compute 52,506
object px, surfacegl 52,505, intersection 52,505) and kaleido4 0.354 ->
0.990 (90,070 / 90,173 / 89,674), both arms settled, liveness passed,
no page errors, VERDICT: PASS — and a direct pixel diff of the two
plain4 settles reads delta (0, 0, 0) on 100% of the same 146,414 clean
background samples that measured (15, 16, 24) before. The gate's own

> = 0.5 bar was deliberately left FAILING through the investigation and
> needed no adjustment.
