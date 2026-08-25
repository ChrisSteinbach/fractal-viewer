# Surface GLSL tracers — `surface-material.ts` / `surface-material-4d.ts`

This is the full measurement record for the two GLSL3 fragment tracers.
CLAUDE.md's `surface-material.ts` and `surface-material-4d.ts` bullets are
condensed pointers into this document — read here for the byte figures, the
measurements and the verdicts.

The tracers' separately retained background sidecar, its exact boundary, and
the decision not to split out retained re-shading state are recorded in
[`surface-background-layer.md`](surface-background-layer.md).

## The 3D tracer

`surface-material.ts` is a GLSL3 full-screen-quad sphere tracer mirroring
`surface-de.ts`'s `estimateDistanceRefined` line for line — the same oracle
discipline as `flame-gpu.ts`. BASE maps are packed into fixed-size (24-slot)
uniform arrays, with kaleidoscope sectors swept from three scalar uniforms
rather than expanded into slots, so symmetry order no longer counts against
the cap. Callers gate eligibility on the bare active-map count first, so an
over-cap count throws here rather than degrading silently.

Orbit-trap color blends descent choices TOP-DOWN — depth-0 copy dominates,
flam3's convention. The per-level decay is now the Color speed slider
(default 0.5, which reproduces that original fixed behavior), and the
rings/sheets orbit-trap color sources ride the same hit-info descent.

## Shared background shape

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

### Radial vignette

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

## Environment-lit ambient

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
indistinguishable from strength 0 on both built-in backdrops in a
side-by-side read. THE REFUSAL WAS ON PERCEPTIBILITY, NOT ON
MEASURABILITY, and the distinction is worth stating precisely because the
ambient-only cut does NOT measure zero. Its own A/B (mandelboxClassic, the
escape GLSL arm, 800x500, against each backdrop's strength-0 baseline)
reads:

| backdrop | pair  | px differing | meanAbs (changed px) | maxΔ | meanSigned R / G / B    |
| -------- | ----- | ------------ | -------------------- | ---- | ----------------------- |
| dark     | 0→0.4 | 7.277%       | 3.0401               | 11   | −0.516 / −0.148 / 0.000 |
| dark     | 0→1   | 7.277%       | 8.1941               | 30   | −1.394 / −0.395 / 0.000 |
| haze     | 0→0.4 | 7.277%       | 2.6866               | 11   | −0.486 / −0.101 / 0.000 |
| haze     | 0→1   | 7.277%       | 7.1971               | 30   | −1.305 / −0.266 / 0.000 |

DO NOT READ THAT TABLE AGAINST THE SHIPPED FORM'S BELOW: they are
DIFFERENT SCENES at different rasters (this one mandelboxClassic at
800x500, the other a boxfold pair at 480x300, chosen because
`mandelboxKifs` never settled), so the two `meanAbs` columns are not
comparable and no ratio between them means anything. What the ambient-only
table establishes on its own is the thing that mattered: at the MAXIMUM
the strongest single channel moves 30/255 on a small minority of pixels
and the frame reads the same. A feature whose maximum cannot be seen has
failed its own acceptance ("the backdrop VISIBLY grounds the render"),
which is a judgement about the render and not about a number — so the
number is recorded here rather than used to justify the call.

A headless SwiftShader A/B of the SHIPPED whole-lit-term form
(`scripts/tmp-envlight-ab.mjs`, a throwaway harness modeled on
`surface-repro.verify.mjs`; deleted after this measurement, numbers kept
here) confirms the tint reads now: the boxfold PAIR (two single-variation
boxfold maps — the same fold-lens fragment fallback arm `mandelboxKifs`
would take, but settling on headless SwiftShader's software rasterizer at
480x300, since the eight-corner `mandelboxKifs` preset never reached a
completed settle in 240s at any strength — stuck marching the real settle
pass, not merely slow to start), dark and haze backdrops, strength 0 vs 0.35
vs 1, diffed against its own strength-0 baseline (144,000 px/frame,
canvas-only screenshot):

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
`vec3(1.0)` and `lit` reduces to the scalar formula that predates the
environment light — the product of a scalar and `vec3(1.0)` is that scalar
per component, same operand order.

The `envTint` helper is declared once per file (GLSL needs declaration
before use, and each file's `main()` is a single template, so it cannot be
shared across `surface-material.ts` and `surface-material-4d.ts` as one
function) — a pinned test in `surface-material-4d.test.ts` asserts the two
bodies agree character for character (whitespace normalized, since the 3D
"off" variant strips while the 4D "off" variant does not) so the mirror
cannot drift.

A panel **Environment** slider (`surfaceEnvLightSlider`, `state.ts`'s
`envLight`, `DEFAULT_SURFACE_ENV_LIGHT`) exposes the strength, default 0.35
— deliberately non-zero, so existing shared links render with a subtle
environment tint now. It is a different knob from the fog's **Tint** (which
retargets the depth _fog_ by distance, not the light by normal); the two
compose additively and are worth checking by eye at both extremes together
before calling a look finished. `voxel-material.ts` (the ◆ Solid raymarcher)
is deliberately NOT environment-lit — see that module's own doc comment for
the reason.

Re-measured resolved 3D variant sizes after the whole-lit-term change (raw
resolved / what the driver actually gets, all under the 64KB
`SURFACE_GLSL_STRIP_BYTES` strip threshold once stripped): affine 82284 B
-> 28944 B (stripped), fold lens 85507 B -> 28708 B (stripped), balloon
88698 B -> 30305 B (stripped), plane 88532 B -> 31281 B (stripped),
lens+plane 91755 B -> 31045 B (stripped), escape 55114 B (53.8KB, NOT
stripped), bulb 38578 B (37.7KB, NOT stripped).

## Variant arms

**`SURFACE_FOLD_LENS`**: compiles when a fold FINAL lens is present. The
preprocessor renames the descent bodies to `surfaceDECore`; the wrapper owns
the public `surfaceDE` overloads, mirroring `descendLens`. The cores' own
`uFinal*` lens uniforms are packed IDENTITY — the wrapper applies the real
lens from `uLens*`.

**`SURFACE_ESCAPE`**: replaces the descent bodies wholesale with
`escape-de.ts`'s forward loop. `setEscapeSystem` packs it; main.ts routes
here when the IFS gate refuses but `analyzeEscapeSystem` admits. It has been
the FALLBACK since the escape compute port, with `surface-compute.ts`'s
WebGPU renderer preferred whenever an adapter exists — same marcher, tiers,
strips, capture; no grid (its validity chain is IFS-specific).

It CYCLES the whole formula chain: `uEscM`/`uEscT`/`uEscParams` are declared
INSIDE the arm (the `SURFACE_BULB` precedent) as one slot per link,
`uMapCount` is the link count, and `uMaxDepth * uMapCount` single-link steps
keep `uMaxDepth` meaning PASSES. `uSymOrder`/`uSymPlane` drive
`foldQuerySector` — the kaleidoscope's dihedral query-space wedge fold,
applied once before the orbit. The 24-slot cap is the mode's cap:
eligibility is one answer for both engines, and the compute arm's storage
list has none.

A link may be a POWER map, which cost the arm three things and no layout
change:

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

The hit-info trap gained a second interpolant for the same reason it had to:
`log(r/R)/log(growth)` models constant-factor growth, and a PRE-SCALED power
link routinely has `growth < 1`, so the guard fired and the trap fell back
to the raw integer count — the Mandelbrot form's palette confetti, through
the back door. A power-terminated orbit instead reads `log(log r / log
R)/log d`, off the DEGREE tracked beside `growth`.

**`SURFACE_BULB`**: the escape arm's SIBLING and `resolveVariantArms`' fifth
JS-resolved key, nested inside `SURFACE_ESCAPE`'s `#else` — the two are
alternatives, each replacing the descent bodies wholesale, so
`surfaceFragmentFor` refuses the pair. It is `bulb-de.ts`'s forward
triplex-power loop, packed by `setBulbSystem`, whose `uBulb*` uniforms are
declared INSIDE the arm so no other variant pays their bytes against the
Mesa cliff. It is the FALLBACK arm for bulb sessions exactly as
`SURFACE_ESCAPE` is for fold ones (`?surfacegl` / no adapter / device loss);
the compute `core: "bulb"` kernel is preferred.

**`SURFACE_GROUND_PLANE`**: `resolveVariantArms`' fourth JS-resolved key. An
infinite one-sided floor below the session ball, lit by a `shadeGroundPlane`
entry mirroring the WGSL arm term for term (penumbra shadow + AO under two
analytic ball certificates, matte lighting, the shared fog formula), called
from all three miss exits. It composes with every other variant except
`SURFACE_BALLOON` (throws — no horizon inside the shell); off, it resolves
byte-identical to the pre-plane build.

**`SURFACE_BALLOON`**: the inverted-union echo arm, mirrored one dimension
up by the balloon's 4D lift. It also carries the echo's OWN tint:
`uBalloonTint`/`uBalloonTintStrength` declare INSIDE the arm — the
`SURFACE_BULB` precedent, no other variant pays their bytes — packed by a
single shared `packSurfaceBalloonTint`, declared in this file and called by
`scene.ts` on BOTH `surfaceMaterial` and `surfaceMaterial4`, since the two
materials declare the identical uniform names. That is the established
direction of reuse this file already carries the other way —
`surface-material-4d.ts` imports `surfaceFragmentFor` and
`SurfaceBalloonSpec` from here — so one pack helper living here too is the
same rule, not a new one.

`surfaceDEBalloonHitInfo` gained an `out float shell` right after
`out vec3 colorPos` in both files' signatures; the 4D file's own trailing
`out float sStar` stays LAST, so the new parameter slots in before it, not
after. Both files mix at the identical base-albedo site — right after the
color source resolves `base`, before the normal is even sampled:
`base = mix(base, uBalloonTint, uBalloonTintStrength * shell)`, gated
`#if SURFACE_BALLOON`. That is before lighting, so the shell still shades
as geometry and the specular stays untinted (the `envTint` rule above).
Strength 0, the default, is `mix(x, y, 0.0)` = x exactly — today's frame
byte for byte — and `shell` (the same `dS < dF` argmin the hit-info
wrapper already computes) restricts the mix to the echo term alone, so a
fractal-term hit is untouched at any strength.

**`SURFACE_FINISH`**: `resolveVariantArms`' sixth JS-resolved key, the
per-transform surface FINISH — `fractal/surface-finish.ts`'s five fields
(specular, shininess, metalness, reflect, transmit) replacing the shading
site's FIXED Blinn-Phong lines. It is the first arm that composes with
EVERYTHING: `surfaceFragmentResolvedFor` refuses nothing new — escape,
bulb, lens, balloon and floor all take it — because it touches only the
lighting composition in `main()`, never the descent bodies. Three splice
points, identical in both files:

- `uniform vec4 uMapFinishA[MAX_MAPS]` / `uMapFinishB[MAX_MAPS]` — the
  two material wire lanes `surfaceMaterialLanes` defines, A = (specular,
  shininess, metalness, reflect) and B = (transmit, reflectionTint,
  patternConfig, scale). The pattern encoding now occupies the tail that the
  finish landing originally reserved. They are declared INSIDE either
  material arm (the `SURFACE_BULB`
  precedent, so an unfinished program pays no bytes) but in the SHARED
  uniform section right after `uMapColor`, so the forward-orbit arms,
  which replace the descent bodies wholesale, read them exactly as the
  descents do. In 3D they are default-block arrays; in 4D they are the
  std140 block's two TRAILING members, and UNCONDITIONAL — see the 4D
  section for why.
- `finishShade(...)`, spliced under the define right after `envTint` from
  `surfaceFinishShadeSource(SURFACE_FINISH_GLSL)` — the ONE body template
  the WGSL shade entry also emits, so the three mirrors cannot drift on
  the arithmetic. It reads `uLightDir`/`uAmbient`/`uEnvLight`/`uBgTop`/
  `uBgBottom`, all declared above it.
- The shading site: `int fSlot = clamp(firstChoice, 0, uMapCount - 1);`
  then `col` assigned from `finishShade` over the six locals, the pixel's
  `background`, and `uMapFinishA[fSlot]` / `uMapFinishB[fSlot]` in the
  arm's branch, today's fixed `diffuse`/`halfVec`/`specular`/`lit`/
  `linBase`/`col` lines in its `#else`. The fog lines after it and the
  balloon's `tEnter` clamp and base-albedo tint mix are untouched in both
  branches. `bg` is the pixel's own `background` — the backdrop its miss
  path would have written — which both tracers name identically, so the
  fetch line is character for character the same in 3D and 4D (a test
  pins it). The forward arms set `firstChoice` 0, so there the HEAD
  transform's finish is the scene's; the caller packs it as the one live
  slot.

IT IS DEFINE-GATED BECAUSE IT IS NOT A BYTE-IDENTITY: at the classic
lanes `finishShade` reproduces the fixed formula VALUE for value (every
extra term reduces to `* 1.0`, `+ 0.0` or `mix(x, y, 0.0)` —
`surface-finish.test.ts` pins the TS mirror exact in double precision),
but `pow(x, fa.y)` against a uniform is not `pow(x, 32.0)` against a
literal, and a driver may well compile them differently. So the
CALLER owns the gate: `setSurfaceFinishes`/`setSurface4Finishes` take
`null` whenever `isClassicSurfaceFinish` holds for every slotted
transform, and an unauthored document compiles literally today's program
text — with the arm OFF the resolved source is byte-identical to the
pre-finish build on every one of the twelve 3D pairings (a test sweeps
them). Every slot is written on every call, unlisted ones back to the
CLASSIC lanes, and the slot DEFAULTS are the classic lanes rather than
zero — a stray enabled read renders the fixed highlight, not matte
black. A lanes-only call (a finish slider's drag tick) never touches the
shader; only the define flip rebuilds, through `surfaceFragmentFor` with
the material's CURRENT arms. Every recompose site in both files —
`setSurfaceSystem`, `setEscapeSystem`, `setBulbSystem`,
`setSurfaceBalloon`, `setSurfaceGroundPlane`, and the 4D balloon and
plane setters — reads the finish define back and threads it, so no
system swap, mode flip or scene-arm toggle silently hands an authored
finish back to the fixed formula (one test per file walks all of them).

COMPILED, NOT JUST COMPOSED: every finish-on program — all twelve 3D
pairings under both `SURFACE_FOLDS` arms where the split exists, and the
three 4D arms — plus the finish-off controls, 42 programs, compile clean
as WebGL2 fragment shaders on headless Chromium's ANGLE (SwiftShader
Vulkan). A compile is not a render, and no caller packs a finish yet;
the in-app picture is the wiring slice's to verify.

## The Mesa link cliff and the source-size rule

Turning the ground plane on would have pushed the shared fold/affine source
past the Mesa crash cliff, so plane programs resolve through
`stripGlslSource` instead — a whole-source comment/indentation strip (the
mechanism the width-1 shade probe already used, extended) emitting the
identical token stream at a fraction of the raw size.

THE STRIP IS A SIZE RULE, not the plane arm's private habit:
`surfaceFragmentFor` strips any resolved source past
`SURFACE_GLSL_STRIP_BYTES` (64KB). A size threshold is the honest predicate
for a size cliff; a hand-kept list of which variants strip is what drifts
the next time one grows a paragraph.

**Measure before adding the next paragraph** to any arm — two questions
against two thresholds, not one:
`surfaceFragmentResolvedFor(escape, lens, balloon, plane, bulb, finish).length`
against `SURFACE_GLSL_STRIP_BYTES` decides whether the strip engages, and
`surfaceFragmentFor(escape, lens, balloon, plane, bulb, finish).length`
against the ~80KB Mesa cliff decides whether the driver can walk it. The
4D wrapper pair, `surface4FragmentResolvedFor(balloon, plane, finish)` /
`surface4FragmentFor(balloon, plane, finish)`, asks the same two
questions of the 4D source through the same resolver.

NOTE: the 4D fragment tracer needed no fold mirror at all — it carries no
fold GLSL (the 4D fold-branch port made fold-shaped 4D sessions
compute-only), so the parameterized-fold mirroring work's list of mirrors
was one longer than the code.

## Measured sizes

The fold's authored lengths cost this file ~2.2KB — `uFoldRadii[MAX_MAPS]`
inside the folds arm, `uLensRadii` beside `uLensParams`,
`uEscRadii[MAX_MAPS]` inside the escape arm, a `foldRadiiOf` helper
mirroring `surfaceFoldRadii` field for field, and longer expressions at the
four inverse-branch sites and the escape arm's two forward folds — which
took the BALLOON variant from 80.9KB to 83.1KB, i.e. past the size that
crashed Mesa (82.2KB observed as the crash cliff). Measured after the strip
rule was applied: affine 74.6->28.0KB, lens 77.6->27.8KB, balloon
80.9->29.3KB, with escape (39.8KB) and bulb (34.1KB) keeping their comments
unstripped at the time.

The escape arm's power-map support (described above) cost the arm a further
8.3KB — escape 42.2 -> 50.5KB, escape+balloon 48.8 -> 57.1KB — so both still
kept their comments at that point.

The balloon pairing was flagged as the one to watch: another paragraph or
two would put it over the 64KB strip threshold. That is not a hazard in
itself — stripped, it comes down to ~15KB, far under the 82.2KB that crashed
Mesa — and balloon+escape is not even reachable in the app (balloon is
IFS-only), but crossing the threshold does mean the arm stops reading as
source in a driver log.

AND A PARAGRAPH DULY ARRIVED: the corrected clamp-cost record added ~1.7KB,
so the measured sizes at that point were escape 52.3KB and escape+balloon
58.7KB — 11.7KB and 5.3KB of headroom respectively. Measured at the same
time: the affine/lens/balloon variants were unaffected because they strip
unconditionally (28.1 / 27.8 / 29.4KB), and `bulb` sat at 36.3KB.
`SURFACE_BULB`'s own resolved source measured ~33KB, against the descent
variants' ~77KB.

Turning the ground plane on, before stripping, would have pushed the
shared fold/affine source (~76.5KB shipped) past the measured ~80KB Mesa
crash cliff (82.2KB observed). Stripped, plane programs emit the
identical token stream at ~30KB raw, the ~79KB lens variant included
(29.6KB with the floor).

The shared `backgroundShapeT` splice (one function, ~460B, spliced beside
`envTint` and read from `main()`'s background line) cost every variant the
same handful of bytes, measured raw / what the driver gets (escape and bulb
stay under 64KB, so for them "what the driver gets" equals raw — unstripped,
same as before this addition): affine 82939B / 29007B, lens 86170B / 28771B,
balloon 89379B / 30368B, plane 89203B / 31344B, escape 55762B / 55762B,
escape+balloon 62390B / 62390B, bulb 39161B / 39161B. Every arm stays far
under the 82.2KB crash cliff, and none crosses the 64KB strip threshold in
either direction — nothing here changes the strip/no-strip decision for any
variant.

The radial vignette grew `backgroundShapeT`'s body (a branch reading three
new uniforms, `uBgShape`/`uBgCenter`/`uBgScale`, declared beside
`uBgTop`/`uBgBottom`) and cost every 3D variant a further handful of bytes,
measured "what the driver gets": affine 29194B (+187), lens 28958B (+187),
balloon 30555B (+187), plane 31531B (+187), escape 56105B (+343),
escape+balloon 62707B (+317), bulb 39569B (+408). Every arm still stays far
under the 82.2KB crash cliff and no variant's strip/no-strip decision moved.

The balloon tint — `uBalloonTint`/`uBalloonTintStrength` declared inside the
arm, the `shell` out-param, and the base-albedo mix — cost every
BALLOON-carrying variant a fixed amount and every other variant nothing,
measured "what the driver gets" against the prior HEAD (d13264a): 3D balloon
30555B -> 30743B (+188), 3D balloon+lens 30371B -> 30559B (+188), 3D
escape+balloon 62707B -> 63913B (+1206), 4D balloon 17086B -> 17274B (+188).
Every non-balloon variant is unchanged: 3D plain 29194B, 3D lens 28958B, 3D
escape 56105B, 3D bulb 39569B, 3D plane 31531B, 4D plain 62804B, 4D plane
18159B.

The +188/+1206 split is the strip threshold, not the change itself. 3D
plain, 3D balloon, 3D balloon+lens and 4D balloon are all STRIPPED
(comments gone), so their resolved source gained only the ~188B of LIVE
TOKENS the change adds; 3D escape, 3D escape+balloon, 3D bulb and 4D plain
stay UNSTRIPPED (comments kept), so 3D escape+balloon — the one
balloon-carrying variant in that group — carries the new code's comments
too, the whole +1206.

That reading is measured, not inferred: 4D balloon's RAW pre-strip source
went 68176B -> 69399B, **+1223B** — the same ~1.2KB of source the
unstripped escape+balloon pairing shows as +1206. The change costs every
balloon-carrying arm the same ~1.2KB of text; the strip is simply
deleting most of it again wherever it engages, leaving the ~188B of live
tokens behind. (`surface-material-4d.ts`'s own pinned raw/stripped figure
above `surface4FragmentFor` carries that pair.)

That leaves 3D escape+balloon as the pairing to watch, per this doc's own
MEASURE-BEFORE-ADDING-THE-NEXT-PARAGRAPH rule: it now sits at 64667B, 869B
under the 65,536B (64KB) `SURFACE_GLSL_STRIP_BYTES` threshold. The margin
is SMALLER than the +1206B line above implies, and the gap is unexplained:
between that measurement and this one the variant grew ~1.3KB that nobody
recorded, and the tracker-id sweep then handed ~570B back. Trust the 869B,
not the arithmetic — which is the rule working, not a footnote to it. Crossing it
is NOT a cliff — the threshold is only where the STRIP engages, and a
stripped source runs a fraction of its raw size (the descent-family variants
measured earlier in this section stripped from ~83-92KB raw down to
~28-31KB, roughly a third) — the Mesa cliff is ~80KB and stripping is what
keeps every variant far below it. And it is a MEASUREMENT pairing only:
balloon is IFS-only, so no shipped session ever compiles this source.

A FULL RE-MEASUREMENT of every variant closes out three stale figures in
`surface-material.ts`'s own comments: the fold-lens variant was called
"~79KB" against the ~80KB Mesa cliff, the escape arm "escape ~40KB", the
bulb arm "bulb ~34KB". Per finding (a) below, all three were RESOLVED
sizes read as though the cliff — an EMITTED threshold — applied to them
directly.

RESOLVED is the source after the JS-side variant arms resolve, before the
strip decision — the quantity `SURFACE_GLSL_STRIP_BYTES` (65536 B) is
compared against. EMITTED is what `surfaceFragmentFor` returns, i.e. what
the driver walks — the quantity the Mesa cliff applies to. Measured today
at every variant, both numbers. Three pairings appear here for the first
time — 3D escape+plane, 3D bulb+balloon, 3D bulb+plane — and a fourth,
3D lens+balloon, has had its emitted size recorded before (as
`balloon+lens`, in the balloon-tint paragraph) but never its resolved
one:

| variant               | resolved B | emitted B | stripped |
| --------------------- | ---------- | --------- | -------- |
| 3D base (affine/fold) | 83022      | 29194     | yes      |
| 3D lens               | 86223      | 28958     | yes      |
| 3D escape             | 55845      | 55845     | no       |
| 3D bulb               | 39357      | 39357     | no       |
| 3D balloon            | 91670      | 30881     | yes      |
| 3D plane              | 89255      | 31531     | yes      |
| 3D lens+balloon       | 95281      | 30697     | yes      |
| 3D lens+plane         | 92456      | 31295     | yes      |
| 3D escape+balloon     | 64681      | 64681     | no       |
| 3D escape+plane       | 62078      | 12803     | yes      |
| 3D bulb+balloon       | 48572      | 48572     | no       |
| 3D bulb+plane         | 45590      | 10918     | yes      |
| 4D base               | 62388      | 62388     | no       |
| 4D balloon            | 68865      | 17274     | yes      |
| 4D plane              | 70150      | 18159     | yes      |

This table supersedes the three module comments above and the 64667 B /
869 B escape+balloon figure two paragraphs up: a comment correction inside
the escape and bulb arms' own GLSL template text cost each arm +14 B,
moving escape+balloon's watched margin to 64681 B, 855 B under the
threshold.

Every EMITTED size for a STRIPPED variant came back byte-identical across
that edit — 3D base 29194, lens 28958, balloon 30881, plane 31531,
lens+balloon 30697, lens+plane 31295, escape+plane 12803, bulb+plane
10918 — while only the two unstripped arms moved. The strip deletes
comments, so a comment-only edit cannot reach the driver at all;
`surface-material-4d.ts`'s own module doc states this as ONLY THE RAW SIDE
MOVES ON A COMMENT-ONLY EDIT, and this re-measurement is a second,
independent instance of it.

NO REAL-DRIVER RE-VERIFICATION IS OWED for that edit, and the reason is
checked rather than assumed: dumping every one of the fifteen variants
with comments and indentation removed, before and against after, gives
fifteen byte-identical files. The two unstripped arms hand the compiler
14 more bytes each, all of them comment; the token stream Mesa actually
parses is unchanged everywhere. Three findings follow.

**(a)** The stale figures were RESOLVED sizes read as if the cliff applied
to them. The cliff applies to the EMITTED source — what the driver walks.
The fold-lens variant resolves at 86223 B and reaches the driver at
28958 B; a reader checking "~79KB against an ~80KB cliff" was comparing
the wrong number to the wrong threshold, and would have concluded there
was about 1KB of room where the true emitted headroom is over 50KB. Every
figure in this family has to say which of the two sizes it is.

**(b)** The cliff is structurally out of reach, and the strip rule is why.
A resolved source under 65536 B is emitted whole; one over it is stripped
to roughly a THIRD (measured: 83022 B -> 29194 B, 86223 -> 28958, 95281 ->
30697). Two rows in the table above look like counterexamples and are
not: 3D escape+plane (62078 -> 12803) and 3D bulb+plane (45590 -> 10918)
strip despite resolving well under the threshold, because
`surfaceFragmentFor` strips unconditionally whenever `plane !== 0` — the
plane arm's own rule, sitting beside the size rule in the same return
expression, not a consequence of it. For the size-triggered rows, the
emitted size is capped near the strip threshold, and for an emitted
source to reach the 82.2KB that crashed Mesa the resolved source would
have to pass ~190KB — where the entire unresolved template, every arm's
text live at once, is 139164 B. The largest emitted source of any variant
today is 3D escape+balloon at 64681 B, unstripped precisely because it
sits under the threshold. "Roughly half", which this doc and the module
have both said, understates the strip: it is closer to a third.

**(c)** The gate that should have caught the drift could not fail.
`surface-material.test.ts` carried a test named "keeps every variant's
source under the Mesa compiler cliff this file has crashed into twice",
asserting `surfaceFragmentFor(...).length < 64 * 1024` — an assertion on
the EMITTED length against the STRIP threshold, which the strip rule
guarantees by construction. Worse, at the one moment it mattered it
INVERTED: an arm growing past the threshold turns stripping ON, dropping
the emitted length to a third, so the assertion passed MORE comfortably
exactly when the property it was meant to guard — escape and bulb keeping
their commentary — broke. It is renamed "the strip rule caps what the
driver walks below the threshold, which is what puts the Mesa cliff out
of reach" and kept for what it actually proves, now across all twelve
3D pairings rather than seven; a
redundant copy of the same assertion inside the `SURFACE_ESCAPE
cross-family links` suite is gone rather than left beside it. A second,
new test, "keeps the two shipped forward arms under the strip threshold,
so their commentary survives into a driver log", gates the RESOLVED
length of escape and bulb alone, through a new export,
`surfaceFragmentResolvedFor` (a 4D twin, `surface4FragmentResolvedFor`,
reuses it rather than restating it). Until now, reaching the resolved
length at all required a throwaway copy of the module with `export`
added to its privates — a measurement rule nobody could actually run,
which is how three figures drifted 4.4-14.5KB without a failing test. 3D
escape+balloon, at 64681 B and 855 B under the threshold, is deliberately
NOT gated this way: crossing is benign (stripped it comes down to
~15KB, nowhere near the cliff), and it is a measurement-only pairing —
balloon is IFS-only, escape is forward, so no shipped session compiles
it. A gate 855 B from firing would fail CI for a non-hazard.

THE CONFLATION HAD SPREAD OUTSIDE THESE TWO MODULES, which a sweep for
stale FIGURES would have missed and a sweep for the mistake found:
`src/fractal/background-shape.ts` justified keeping one comment short
because "`surface-material-4d.ts` has only ~2.8 KB of headroom under the
`SURFACE_GLSL_STRIP_BYTES` 64 KB source-size cliff". The headroom is
3,148 B, and the threshold is not a cliff — crossing it costs the 4D plain
arm its commentary in a driver log and nothing else. A file three
directories away was budgeting its prose against a hazard that does not
exist, which is the clearest evidence that "the 64KB cliff" had become the
project's working shorthand for two different numbers.

Two more figures in this doc's own 4D section were off by the same
re-measurement: the balloon and plane arms cost 6,477 B and 7,762 B over
the plain source, not the "~5.4KB and ~7.8KB" recorded — an arm understated
by about a kilobyte, though the ~75KB monolithic-source conclusion it
supports survives (76,627 B measured, and the argument was never close to
its margin).

### The shape-trap arm's sizes

The escape-family shape trap bakes its shape SDF into the program and keeps
the pose, mode, threshold and fade live. Its optional escape-only geometry
arm also keeps an inclusive post-link level band live, shares the hit-info
path's local SDF with color, and min-unions `0.9 * localSdf / (invScale * dr)`
with the ordinary escape estimate. Bulb traps stay color-only. Geometry-off
sources retain the pre-geometry hashes exactly. Measured resolved sizes
against the 65,536 B strip line:

| variant            | resolved B | headroom | result                       |
| ------------------ | ---------- | -------- | ---------------------------- |
| 3D escape          | 60412      | 5124     | unstripped                   |
| 3D escape + finish | 62811      | 2725     | unstripped; pairing to watch |
| 3D escape geometry | 60459      | 5077     | unstripped                   |
| geometry + finish  | 62858      | 2678     | unstripped; pairing to watch |
| 3D bulb            | 43752      | 21784    | unstripped                   |
| 3D escape + plane  | 67900      | —        | strips under the plane rule  |

The 67,900 B plane row crossing is benign: plane-bearing variants always
strip independently of size, so no shipped driver program approaches the
Mesa cliff. The live margin to watch is geometry + finish's 2,678 B; measure
again before extending either forward arm.

The forced `?surfacegl` real-Iris menu check compiled and settled `Fold Chain
Gear` through this arm with zero exhausted rays; Geometry on versus off
changed 23.28% of its 1024×640 pixels (the compute arm measured 23.26%).

### The finish arm's sizes

The per-transform finish arm (`SURFACE_FINISH`, above) is the first
addition measured across EVERY pairing in BOTH states at once — fifteen
variants, arm off and arm on, resolved and emitted, against the
previous table's figures. "Off" is the column every shipped session
compiles until a document authors a finish; "on" is what it compiles
then.

| variant               | off resolved | off emitted | stripped | on resolved | on emitted | stripped | Δ resolved | Δ emitted |
| --------------------- | ------------ | ----------- | -------- | ----------- | ---------- | -------- | ---------- | --------- |
| 3D base (affine/fold) | 83022        | 29194       | yes      | 85055       | 30049      | yes      | +2033      | +855      |
| 3D lens               | 86223        | 28958       | yes      | 88256       | 29813      | yes      | +2033      | +855      |
| 3D escape             | 55845        | 55845       | no       | 57878       | 57878      | no       | +2033      | +2033     |
| 3D bulb               | 39357        | 39357       | no       | 41390       | 41390      | no       | +2033      | +2033     |
| 3D balloon            | 91670        | 30881       | yes      | 93703       | 31736      | yes      | +2033      | +855      |
| 3D plane              | 89255        | 31531       | yes      | 91288       | 32386      | yes      | +2033      | +855      |
| 3D lens+balloon       | 95281        | 30697       | yes      | 97314       | 31552      | yes      | +2033      | +855      |
| 3D lens+plane         | 92456        | 31295       | yes      | 94489       | 32150      | yes      | +2033      | +855      |
| 3D escape+balloon     | 64681        | 64681       | no       | 66714       | 13180      | **yes**  | +2033      | −51501    |
| 3D escape+plane       | 62078        | 12803       | yes      | 64111       | 13658      | yes      | +2033      | +855      |
| 3D bulb+balloon       | 48572        | 48572       | no       | 50605       | 50605      | no       | +2033      | +2033     |
| 3D bulb+plane         | 45590        | 10918       | yes      | 47623       | 11773      | yes      | +2033      | +855      |
| 4D base               | 62765        | 62765       | no       | 63464       | 63464      | no       | +699       | +699      |
| 4D balloon            | 69242        | 17330       | yes      | 69941       | 18113      | yes      | +699       | +783      |
| 4D plane              | 70527        | 18215       | yes      | 71226       | 18998      | yes      | +699       | +783      |

Five things the table says, in the order they matter.

**(1) The 3D "off" column is the previous table to the byte.** All
twelve 3D rows — 83022, 86223, 55845, 39357, 91670, 89255, 95281, 92456,
64681, 62078, 48572, 45590 — are the figures recorded before the arm
existed, resolved AND emitted, which is the JS-side resolution doing
what it is for: with the arm off not one byte of finish text reaches the
resolved source, and a test asserts the omitted argument, the explicit
0, and the pre-finish build are the same string across the sweep.

**(2) The 3D "off" column is NOT what the 4D "off" column is.** The 4D
rows moved without the arm: base 62388 → 62765 B (+377 raw), balloon
68865 → 69242 B resolved and 17274 → 17330 B emitted (+56), plane 70150
→ 70527 B and 18159 → 18215 B (+56). That +56 B of live tokens in every
4D program is the two `vec4 uMapFinishA[MAX_MAPS]` /
`uMapFinishB[MAX_MAPS]` block members, which are declared
UNCONDITIONALLY — the 4D section below carries the layout argument — and
the rest of the +377 is their four-line doc, which the strip deletes
where it engages. The unfinished 4D program's VALUES are untouched
(two dead declarations read by nothing), which is the envTint /
backgroundShapeT growth precedent rather than the byte-identity the 3D
default-block arrays keep; and it is the one place this slice spends
the 4D plain arm's headroom on purpose, 3148 → 2771 B.

**(3) The arm costs every 3D variant the same 2033 B of source and the
same 855 B of live tokens.** The +2033/+855 split is the strip threshold
again, exactly as the balloon tint's +1206/+188 was: `finishShade`'s
body, the two uniform declarations, the fetch, and three comment
paragraphs total 2033 B raw, of which the strip leaves 855 B of tokens
wherever it engages. The unstripped arms — escape, bulb, bulb+balloon —
carry the whole 2033 B, comments included. The delta is identical on
all twelve rows because the arm lives entirely in the shared section
and `main()`, which every variant emits once; nothing about it is
per-variant.

**(4) Exactly ONE pairing flips strip status, and it is the one this
doc said would.** 3D escape+balloon, the "pairing to watch" at 64681 B
with 855 B of headroom, crosses the 65536 B threshold with the arm on —
66714 B resolved — and so reaches the driver STRIPPED at 13180 B, a
fifth of its off size (the −51501 B in the emitted column is that
crossing, not a saving). The crossing is benign in every way the
previous record said it would be: stripped it is nowhere near the
cliff, the token stream is identical, and the only thing lost is its
commentary in a driver log — for a measurement-only pairing no shipped
session compiles (balloon is IFS-only, escape is forward). A test pins
the crossing as the contract (over the threshold, therefore stripped,
therefore under a quarter of the threshold emitted) rather than as the
figure. No other row changes column: every 3D descent variant stripped
before and strips after; escape (7658 B of headroom left), bulb
(24146 B) and bulb+balloon (14931 B) stay unstripped with the arm on;
escape+plane and bulb+plane strip under the plane rule regardless. The 4D
figures in this paragraph are the historical finish landing before patterned
materials existed: the plain arm was 63464 B with 2072 B of headroom. The
current finish-only baseline is 63878 B with 1658 raw bytes of headroom; the
pattern-on 4D plain arm crosses the strip threshold as recorded below.

**(5) Nothing approaches the emitted cliff.** The largest program any
driver is handed is still 3D escape+balloon with the arm OFF at 64681 B;
with it on the largest is 3D escape at 57878 B, then 3D bulb+balloon at
50605 B. Every stripped variant sits between 10.9 and 32.4 KB. The whole
UNRESOLVED 3D template, every arm's text live at once, grew 139164 →
142130 B, still well under the ~190 KB a resolved source would need for
its stripped third to reach the 82.2 KB that crashed Mesa.

THE PAIRING TO WATCH, updated. With the arm off it is still 3D
escape+balloon at 64681 B, 855 B under — unchanged, because the arm is
off. With the arm on, escape+balloon has already crossed and there is
nothing left to watch there; the current nearest unstripped margin is
**4D plain + finish at 1658 B** (63878 B, a shipped pairing). The old 2072 B
figure was the pre-pattern finish landing. Patterned 4D plain crosses and
strips, as measured in the next section; this is benign and costs only source
comments in the driver diagnostic.
Crossing there is as benign as every other crossing in this section
(strip, not cliff), but it is the first time a crossing would cost a
SHIPPED 4D session its commentary, where escape+balloon's never cost a
session anything.

### The pattern arm's sizes

The per-transform pattern arm (`SURFACE_PATTERN`, fr-cmtl.5) is the
second additively-independent arm measured across every pairing in both
states: the same fifteen variants as the finish table, pattern off and
on, against the previous table's figures. "Off" is byte-identical to
the pre-pattern build — pinned by commit-hash baselines in
`src/app/surface-pattern-baseline.ts`, generated from the pre-.5 tree
(8f5fb4d) — and "on" is what a document authors a pattern from then.

| variant               | off resolved | off emitted | on resolved | on emitted | Δ resolved |
| --------------------- | ------------ | ----------- | ----------- | ---------- | ---------- |
| 3D base (affine/fold) | 83022        | 29194       | 95243       | 38365      | +12221     |
| 3D lens               | 86223        | 28958       | 99062       | 38149      | +12839     |
| 3D escape             | 55845        | 55845       | 68066       | 19637      | +12221     |
| 3D bulb               | 39357        | 39357       | 51578       | 51578      | +12221     |
| 3D balloon            | 91670        | 30881       | 103948      | 40095      | +12278     |
| 3D plane              | 89724        | 31939       | 101945      | 41110      | +12221     |
| 3D lens+balloon       | 95281        | 30697       | 108120      | 39888      | +12839     |
| 3D lens+plane         | 92925        | 31703       | 105764      | 40894      | +12839     |
| 3D escape+balloon     | 64681        | 64681       | 76959       | 21539      | +12278     |
| 3D escape+plane       | 62547        | 13211       | 74768       | 22382      | +12221     |
| 3D bulb+balloon       | 48572        | 48572       | 60850       | 60850      | +12278     |
| 3D bulb+plane         | 46059        | 11326       | 58280       | 20497      | +12221     |
| 4D base               | 62765        | 62765       | 74312       | 25031      | +11547     |
| 4D balloon            | 69242        | 17330       | 80880       | 26560      | +11638     |
| 4D plane              | 70996        | 18623       | 82543       | 27776      | +11547     |

Four things the table says.

**(1) The off column is the pre-pattern tree to the byte.** Every row
matches the hash baselines in `src/app/surface-pattern-baseline.ts` —
generated from the actual pre-.5 tree (8f5fb4d) — resolved AND emitted,
across every 3D pairing × finish and every 4D arm × finish. (The finish
table above this one shows slightly smaller plane rows: those figures
predate the balloon-tint and pattern-calibration scaffolding, and the
baseline hash is what pins the current tree, not this doc's earlier
prose.) The pattern arm lives entirely inside resolver-owned
`#if SURFACE_PATTERN` blocks (body, routing, fold-lens handoff), so with
the flag off not one new token reaches the resolved source — pinned three
ways: the finish-identity tests, token-absence sweeps, and the committed
baselines.

**(2) The arm costs every variant a ~9.6KB shared body plus a routing
splice.** The patternShade body — noise, macro ramps, scale-stable
detail, albedo, decode — is 9598 B of nearly comment-free GLSL emitted
once per file (the "one template, both dimensions" rule), and the
routing (main()'s splice plus the fold-lens handoff and the shared
A/B-gate declarations) adds ~1.5-2.6KB depending on the scene arms (the
balloon cpos branch and the fold-lens handoff are the larger ones).
Because the body has almost no comments, the strip deletes little:
stripped variants grow by ~9-12KB emitted, not the finish arm's 855B.
The 4D rows' resolved deltas are smaller because their source is shorter
to begin with.

**(3) Most pattern-on variants cross the strip threshold; the bulb family
stays under.** The 4D plain arm — the table the previous section called
"where it should measure first" — crosses at 74312 B resolved (from
62765 B), exactly the benign event that section predicted: stripped to
25031 B emitted, and the crossing costs a SHIPPED 4D session its
commentary in a driver log (the first time any crossing did; the pattern
arm has no comments, so only the surrounding arms' prose is lost). 3D
escape (68066 B), 3D balloon (103948 B), and 3D escape+balloon (76959 B)
also cross. The three BULB rows stay under the threshold — 51578 B
(bulb), 60850 B (bulb+balloon) and 58280 B resolved (bulb+plane; it
strips anyway under the plane rule) — so bulb sessions remain the
pattern-on variants that still read as source in a driver log.

**(4) Nothing approaches the emitted cliff.** The largest program any
driver is handed with the pattern on is 3D bulb+balloon at 60850 B
(unstripped), then 3D bulb at 51578 B; every stripped variant sits
between 17.9 and 42.9 KB — far under the 82.2 KB that crashed Mesa. The
whole UNRESOLVED 3D template grew to ~155 KB, still under the ~190 KB a
resolved source would need for its stripped third to reach the crash.

REAL-BROWSER COMPILE + RENDER (fr-cmtl.5's `scripts/pattern.verify.mjs`,
640x360): every leg forces the WebGL arm (`?surfacegl`) — the WGSL
compute kernel's pattern math is fr-cmtl.6's, so a compute leg would
render unpatterned by design — and the compared captures assert
engine=webgl. Three routes, each three legs (none, patterned, strength-0
control): lens3 (3D fold-FINAL lens, wood on transform 0)
patterned-vs-none 3.80% central-region structural and strength-0-vs-none
0.000%; ifs4plane (4D IFS + floor, marble on all four transforms — its
transform 0's xw rotation puts map 0's copy outside the visible slice,
so a single-slot pattern never fires there) 1.06% / 0.000%; escape3 (3D
escape-time Mandelbox + floor, strata on the head transform) 9.19% /
0.000%. The strength-0 rows are the strongest form of the identity
claim: the SAME program compiled (pattern gate on), the same
calibration, only the mix coefficient at 0 — pixel-exact against the
pattern-absent document. On headless SwiftShader the lens3/ifs4plane
pairs are compared at stage 1 (the pre-supersampling frame) and escape3
reaches the SETTLED 8-pass latch; on the REAL DRIVER (--mode=x11::0,
Intel Iris Xe / Mesa via ANGLE) all three routes settle: lens3 3.81%,
ifs4plane 1.13%, escape3 9.19%, strength-0 0.000% everywhere.

THE WGSL TWIN (fr-cmtl.6) renders the SAME documents on the compute path
with the same effect: `scripts/pattern.compute.verify.mjs` (no
`?surfacegl`, engine=compute asserted at capture time) measures lens3
3.81%, ifs4plane 1.13%, escape3 9.19% — byte-for-byte the WebGL rows —
plus the compute-only escape4 Mandelbox Brick at 5.13%, strength-0
0.000% everywhere, on the real driver at the settled 8-pass latch. The
WGSL-side wiring is documented in `surface-gpu-kernels.md`'s pattern
lanes section.

## The probe-width verdict

The three shading taps (normal/shadow/AO) ride the value form, which fold
systems route to `surfaceDEProbe` — a width-1 instantiation of the SAME
fold-descent template (the probe-width verdict on the fragment path: one
text, two names; march/hit acceptance stay width 12).

Measured on Iris (cold cache, `scripts/shade-width-ab.mjs`,
`?surfshadewidth=N` A/B — N=12 disables the probe and reproduces the
pre-change source byte for byte): the probe CUT the fold program's ~25s Mesa
link 17.9x, to ~1.45s. Mesa inlines the width-12 body per call site; with
the probe, only the march still does. This dissolved the link-watchdog
session-death lottery along with it, settled boxfold pairs in 509-987ms
(baseline 695-1296ms) with frames identical within session noise, and
resolved ~2.3x more mandelboxKifs frame per equal window (crease pixels stay
march-bound; compute owns fold AND fold-lens sessions where an adapter
exists).

The fold-lens variant deliberately carries no probe: its taps keep
full-width cores through the public wrapper, and the compute probe-width
verdict never covered lenses (the twin renders no foldFinal systems). A
size-cliff reason this exclusion once carried has RETIRED — the source
resolves at 86223 B and reaches the driver STRIPPED at 28958 B, nowhere
near the ~80KB EMITTED cliff (full re-measurement above, under "Measured
sizes") — so reinstating it needs a fresh measurement of the emitted
source, not the resolved one. The port itself was left UNDONE when the
surface-optimization seam closed by decision: two independent attempts to
trade cheap arithmetic for skipped descent work were both refuted on the
real GPU, and the stakes were lower by then anyway, since
`SURFACE_FOLD_LENS` had become the no-adapter/`?surfacegl` fallback rather
than the lens session's primary tracer.

## Grid sampling and step budgets

The march samples `surface-grid.ts`'s floors (a NEAREST 3D texture) before
paying a descent (the empty-space-skip half of the march-epsilon cutoff
work): a floor above the pixel epsilon (`uAcceptPixelEps`, the tier-pinned
acceptance eps — NOT the buffer-scaled `uPixelEps`) is both a no-hit proof
and a safe stride, damped by the same `uStepScale` as analytic steps.
Gridless marching stays the always-correct fallback.

Skips drain their own whole-ray cap (`SURFACE_GRID_SKIP_CAP`), never the
analytic march budget, and the full-tier budget is 160: charging cheap
conservative skips against 96 march steps starved rays that thread gaps or
graze faces, dissolving far/threaded geometry into view-dependent dropout
speckle — measured and healed in `scripts/erosion-repro.harness.ts`.

### The balloon reads the grid IN THE BOX ONLY

Balloon mode shipped gridless: the stored floors bound the FRACTAL, the
balloon marches the UNION of the fractal and its inverted echo, and the
shell can be nearer to a sample than any fractal-only floor admits. They are
re-enabled under a per-frame validity gate (`surface-grid.ts`'s
`balloonClearsGridBox`, `R^2/rho > |c| + sqrt(3)*halfExtent`, whose module
doc carries the derivation and the six-system measurement), written to
`uGridEnabled` by `setSurfaceGridEnabled` — the texture stays installed, so
a radius sweep costs a uniform write and the grid REQUEST stays a
once-per-session decision.

The march needed one change beside the flag, and it is a consequence of
balloon rays not being sphere-bounded. A balloon ray starts at the CAMERA
and runs to `uBalloonFar` past the balloon centre instead of crossing the
visible sphere, so most of its samples land OUTSIDE the grid cube — where
the sampler's edge clamp hands back a BORDER cell's floor. That floor is
still a valid FRACTAL bound there (the cube is convex and contains the
attractor, so clamping is a projection onto it and cannot increase the
distance to the set), but it bounds nothing about the SHELL, which at every
radius the gate admits lies entirely outside the cube. So the balloon arm
refuses the skip outright when the sample's texture coordinate leaves
`[0,1]^3`, which is exactly the in-box restriction the gate's coverage
measurement modelled: its 18.6-33.2% of a balloon march's steps skipped
(48.7-76.3% of what the same grid buys the plain march over the same rays)
is the rate AFTER it. The guard is compiled into the `SURFACE_BALLOON` arm
alone — every other variant's march is confined to the `1.02 *
uVisibleRadius` sphere inscribed in the `1.03` cube and can never meet it,
so their sources stay byte-identical.

## Condensation shape arm

Emitter-enabled IFS documents compile a resolved `SURFACE_CONDENSATION` arm
instead of sending a universal shape library to the driver. One SDF body per
unique authored emitter shape is baked into the program; `uCondShape` selects
it for each symmetry-expanded emitter record. The fixed inverse arrays hold
ordinary maps first and emitter records second, while `uMapCount` stays the
recursive count. `uCondCount`, inclusive `uCondMinDepth`/`uCondMaxDepth`,
`uCondShade` and `uShadeCount` describe the suffix and its material slots.
Feature-off resolution remains byte-identical to the pre-condensation source.

Both fragment tracers fold the shape term at the root and every visited
descendant, including retained, terminal and fold/lens paths. The 3D arm uses
the posed solid SDF; the 4D arm uses
`length(vec2(max(sdShape(local.xyz), 0.0), local.w))`, embedding that solid at
local w=0 rather than extruding it. A nonzero 4D slice thickness is refused.
Hit-info carries the winning emitter's shade index, so base color, pattern and
finish all read the emitter slot that actually supplied the minimum.

The uniform wire is capped at 24 total ordinary-map plus symmetry-expanded
emitter records and 24 unique shade slots. Unsamplable/nearly-flat emitters,
emitter-only documents and final-transform emitters are rejected before this
arm; escape and bulb use the separate forward-orbit construction and cannot
compile it. Balloon and the surface grid remain admissible because both wrap
or sample the same condensation-aware public estimator.

Source-size verification on the landed generator (resolved / emitted bytes):
3D condensation 90,873 / 35,304; 3D condensation + finish 93,274 / 36,415;
4D condensation 68,213 / 20,573; 4D condensation + finish 69,328 / 21,612.
Every emitted program stays below 65,536 bytes. As a feature-off control,
escape + finish remains 59,134 / 59,134 bytes.

## The 4D tracer

`surface-material-4d.ts` is the 4D twin: it sphere-traces the `w = w0` slice
of the rotor-posed 4D attractor, mirroring `surface-de-4d.ts`'s
`estimateDistance4Refined` line for line — refined certificates plus the
width-4 beam (the 4D spike's measured ghost eliminator, plus the rank-3/4
validity slots).

The slice has THICKNESS: `uSliceHalfW > 0` makes every descent query the
SEGMENT spanning `|w - uW0| <= h` instead of the point `(p, uW0)`, so the
mode renders a SLAB's projected shadow rather than a cross-section. This
mirrors the oracle's `halfExtent` line for line — one `vec4` per
chain/candidate, `segmentRadius` in place of every `length`, and the
visible-ball gate widened to `max(0, |uW0| - h)`. `segment` is a
dynamically-uniform branch, so `h = 0` — the shipped default — costs nothing
beyond the extra live registers and renders today's frame value for value.

Rotor + w-slice are LIVE per-frame view uniforms (`setSurfaceView4`), unlike
flame/solid-4D's frozen snapshot. The slider is normalized rotated-w;
`scene.ts`'s `setSurface4View` converts it to the tracer's world `uW0`
through `wSupport`, so one slider position is one hyperplane across every
mode. The 24-map cap matches 3D's — the per-map arrays ride a std140 uniform
BLOCK (2688 bytes of the guaranteed 16KB, where default-block arrays would
have taken 192 of the guaranteed 224 fragment uniform vectors) — and the
kaleidoscope SWEEPS like 3D's, so 24 slots means 24 transforms at any order.

Since the 4D cut, this tracer is the PLAIN-4D fallback arm (`?surfacegl` /
no adapter / device loss — compute is 1.7x faster there). Since the
shade-sizer width fix it is the fallback for EVERY 4D system and the
preferred arm for none: it briefly held kaleidoscope 4D as its MEASURED
HOME, and lost it on a re-measurement.

That episode is worth keeping, because this arm was right for two different
reasons and then wrong. The compute arm never settled a 6-minute order-6
observation this arm settled in 10.9s (~35x). The 4D kernel-cost
investigation attributed the gap: the estimator's own cost is superlinear in
order for BOTH arms (algorithmic depth growth, CPU-oracle-matched —
`scripts/aff4-order-cpu.harness.ts`), so the residual was the compute arm's
host loop and not kernel codegen; the uniform-maps and
refinedCert-divergence kernel suspects were both refuted with data. The
off-centre-slice investigation made both arms forceable and read 147s here
against 179s there — a 1.2x inside THIS arm's own 147/444/604/637s
run-to-run spread, so the rule then stood on a null result rather than a
win. The shade-sizer width fix found the compute arm's actual cost (a
hit-shade batch width fixed by its own cost model's attribution pivot rather
than by the scene) and the row became 637.5s here against 53.1s there, with
a ~5% spread against this arm's 4x one. Nothing about this tracer regressed;
the other arm stopped wasting 90% of its shade dispatches. The full record
is in `docs/surface-compute-renderer.md`.

### 4D variant arms and the resolution mechanism

THREE VARIANT ARMS exist — the balloon inverted-union and the ground plane,
each lifted from its 3D original and mirroring it term for term, and the
per-transform finish, which is the SAME arm as 3D's rather than a lift
(one `#if SURFACE_FINISH` over one shared shading site, see the variant
arms above) — and the MECHANISM is the one deviation, forced by
measurement: this source was 62,388 B with 3,148 B of headroom under the
64KB strip threshold when the two scene arms landed (62,804 B with the
radial-vignette branch, re-measured after the shared `backgroundShapeT`
splice — 62,711 B before the vignette, 62,251 B before the splice, 61,751 B
before the environment light; 62,765 B with 2,771 B of headroom since the
finish lanes' two unconditional block members), and the arms cost 6,477 B
and 7,762 B over the plain source (measured as resolved-with-arm minus
resolved-without, the "~5.4KB and ~7.8KB" this paragraph carried until
the full re-measurement above — the balloon figure understated its arm by
about a kilobyte), so one monolithic `#if` source would be ~76,600 B and
EVERY 4D session would pay it, in the band where the 3D fold program
takes ~25s to link.

So the arms resolve JS-side, through `surfaceFragmentFor` ITSELF rather
than a second preprocessor (`surface4FragmentFor` is a three-argument
wrapper, `(balloon, plane, finish)`, threading each to the 3D resolver's
own slot), and the `defines` keys are `SURFACE4_*` — `SURFACE4_FINISH`
now the third — while the GLSL directives stay the 3D names — deliberate,
called out at both sites, and renaming them would break resolution.

Measured after the radial-vignette branch: off, 62,804 B (under threshold,
so NOT stripped); balloon 68,176 -> 17,086 B stripped; plane 70,588 ->
18,159 B stripped. The finish arm's own rows — off and on, all three
arms — are in the finish table above.

THE FINISH LANES ARE UNCONDITIONAL BLOCK MEMBERS, where 3D's are
define-gated arrays, and the reason is the std140 contract this file has
always carried: the `SurfaceMaps4` block's MEMBER ORDER is the layout the
`THREE.UniformsGroup` derives its offsets from (three walks the group's
uniform list in order, each typed-array member at a 16-byte boundary with
its own byte length as storage), so a member that came and went with the
define would move every offset on every finish toggle, and a group built
for one layout bound to a program compiled for the other is SILENT offset
corruption — the wrong floats in the wrong lanes, no error. Declaring
`vec4 uMapFinishA[MAX_MAPS]` / `uMapFinishB[MAX_MAPS]` unconditionally,
APPENDED at the END of the block (after `uMapTrap`) and appended in the
same A-then-B order at the end of the group, means the layout is one
layout in both states; only the READ is define-gated. The price is
measured, not estimated: 768 B of the 16 KB block (2688 → 3456 B, 24 × 2
× 16), ZERO default-block uniform vectors, +56 B of live tokens in every
4D program (the two declarations; +377 B raw with their doc before the
strip), and the plain arm's headroom 3148 → 2771 B — against the
value-identity of the unfinished program, which is untouched, since
nothing reads the two members until the arm is compiled. The
placeholders are the CLASSIC lanes (`(0.4, 32, 0, 0)` / `(0, 0, 0, 0)`),
written by the same placeholder loop that seeds `colorSigma`'s unit
sigma and for the same reason: a stray read of an unwritten slot
renders the fixed highlight rather than a black one. A test pins the
member list — all six, in order, A then B last — against the block
text, and the group's length at six.

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

## The coverage-alpha leak

The tracers' output alpha is the COVERAGE flag — 1 where the frame drew
something (hit, lit ground plane), 0 where it shows only its backdrop —
counted by scene.ts's settle fold so the WebGL arm can answer the
blank-frame question the WebGPU arm answers from its per-ray status tally.
It shipped on the claim that the channel was invisible ("blitted with
NoBlending into a canvas created alpha:false").

THAT CLAIM WAS WRONG, and the failure it caused was the two 4D arms drawing
measurably different frames: three r163+ creates the canvas WebGL context
with `alpha: true` UNCONDITIONALLY — the `WebGLRenderer` constructor's
`alpha` param only picks the default CLEAR alpha (verified in three r185's
source, `WebGLRenderer.js`'s `contextAttributes`). With `premultipliedAlpha:
true` (the default), the compositor treats canvas RGB as premultiplied, so a
coverage-0 pixel with nonzero RGB composites as `canvas_rgb + page_bg · (1 −
0)` — the page's own background ADDED to the pane. The app's page background
is `--bg: #0f1018` = (15, 16, 24).

MEASURED, on the settled PNGs of `scripts/surface-4d.verify.mjs`'s two IoU
scenes (real Iris, 1024x640, identity rotor, centred slice — the frames
behind the gate's IoU 0.240/0.354 FAIL): the `?surfacegl` arm's miss pixels
read exactly `DARK backdrop + (15, 16, 24)` — the delta was (15, 16, 24) on
98.3-98.9% of 146,414 clean background samples per channel on plain4 (the
stragglers one count lower, quantization), the same on kaleido4,
height-independent to ±0.02 — while HIT pixels matched the compute arm byte
for byte and the compute arm's backdrop matched `resolveBackground`'s DARK
pair exactly (its DataTexture carries alpha 255 everywhere, so its pane
never composited). The `#vignette` DOM overlay darkens both arms' pane edges
multiplicatively and cancels in the comparison. The two candidates the
original report's own WHERE-TO-START named are hereby REFUTED as the driver:
the strip pump's linear-light supersample averaging and
`buildSurfaceComputeBackground`'s Math.round quantization each bound at
~1/255 on a constant backdrop, two orders under the measured offset.

The leak began at the coverage flag itself (e502afe, the `1.0 -> 0.0`
miss-alpha flip) — the 4D cut's IoU 0.996 predates it — and reached every
WebGL surface present since: live previews, settles, and the Save-PNG
capture path, whose present-then-`toBlob` snapshot read the same alpha-0
canvas (an exported miss pixel carried alpha 0 into the PNG). The 3D
fallback arms (escape, bulb, fold-lens under `?surfacegl`/no-adapter) leaked
the same way; it was FOUND on the 4D gate only because that is the one gate
that compares the two engines' frames.

THE FIX IS AT THE PRESENT BOUNDARY, one line: `BLIT_FRAGMENT` copies RGB
verbatim and FORCES ALPHA TO 1. The blit is every surface present's last hop
— settle target, preview target, the compute frame's DataTexture, and the
capture path's present-then-toBlob — so the coverage flag stays a private
channel of the trace targets, which is where the coverage flag's two
readbacks (`foldSurfaceSample`, `measureSurfaceCoverage`) read it; no reader
consumes alpha from a blit DESTINATION (the one target-to-target blit, the
preview -> settle seed, is fully overwritten by strips before any
pass-completion readback). The WGSL kernels already write alpha 1.0 on every
path, so the fix also makes the two engines' presented alpha identical.
RE-MEASURED at the fix, same gate, same protocol (real Iris, dev server,
both scenes): plain4 IoU 0.240 -> 1.000 (compute 52,506 object px, surfacegl
52,505, intersection 52,505) and kaleido4 0.354 -> 0.990 (90,070 / 90,173 /
89,674), both arms settled, liveness passed, no page errors, VERDICT: PASS —
and a direct pixel diff of the two plain4 settles reads delta (0, 0, 0) on
100% of the same 146,414 clean background samples that measured (15, 16, 24)
before. The gate's own

> = 0.5 bar was deliberately left FAILING through the investigation and
> needed no adjustment.
