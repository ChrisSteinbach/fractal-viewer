# The twisted mod-Menger family

The "Menger Sponge with rotation applied to point p" —
[KentaYoshii/Raymarcher](https://github.com/KentaYoshii/Raymarcher)'s
`output/fractals/mengersponge1.png` — as a first-class render family: the
classic mod-based carve SDF with a fixed rigid twist applied to the query
point between carve levels. This page is the family's evidence record; the
rules live in `AGENTS.md`, the vocabulary in `src/fractal/menger-twist.ts`,
and the estimators in `menger-de.ts`/`menger-de-4d.ts`.

## The construction, source-verified

Their `resources/raymarch.frag`:

```glsl
const mat3 ma = mat3(0.60, 0.00, 0.80,   // column-major; a fixed ~53.13°
                     0.00, 1.00, 0.00,   // rotation about Y
                    -0.80, 0.00, 0.60);
...
for (int m = 0; m < 4; m++) {
    p = mix(p, ma*(p+off), ani);   // rotate + offset the QUERY POINT, every level
    vec3 a = mod(p*s, 2.0) - 1.0;  // the classic sawtooth cell fold
    s *= 3.0;
    vec3 r = abs(1.0 - 3.0*abs(a));
    ...                            // the cross carve, running max
}
```

`ani` and `off` animate over `iTime`: `ani` is 1 (full twist) for
`t ∈ [3.54+4πk, 9.02+4πk]`, and `off = 1.5·sin(0.01·t)` broadcast to all
three axes reaches ≈1.4 per axis at the `t ≈ 192s` capture era. The README
image is the fully-twisted state at a capture-era offset.

## Why no IFS or per-map rotation expresses it

The level-m carve pattern is the standard pattern rotated by the FULL
accumulated `R^m`, with every rotation sitting outside the child
compositions: the level-m pieces are `R^-m·T_c1·…·T_cm(box)`. Any finite
composition of per-map transforms interleaves (`T·R·T·R·…`), and since a
fixed rotation does not commute with the child translations, no per-map
placement — rotation in each map's linear part, a twist composed on either
side of each map, per-map post-affines — reproduces the set. The twisted
sponge is a twisted-KIFS carve, not a self-similar attractor.

Measured refusals of the cheap approximations (CPU sheets through the
shared marcher, 2026-10-05):

| Approximation                                                   | Verdict                                                                                         |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Per-map Euler rotations `k·t` (the ChatGPT-conversation recipe) | `k ≥ 0.25` scrambles the sponge into crust; `k ≤ 0.08` keeps cells but barely bends             |
| All 20 maps sharing one Ry(53°)                                 | Cells stay legible (columnar twist) but the outline cannot bend — child positions stay standard |
| Menger + spherefold final lens                                  | Curled, cell-tiled ball — the closest _look_; shipped as the `twistedSponge` presets            |

The exact construction ships as its own family instead.

## Soundness and exactness

The twist `q ← R(q + b)` is an isometry, so each level's carve term is the
true world distance from the query to that level's removed pattern, whose
open interior the set avoids: the running max over levels is a genuine
lower bound at EVERY twist — no damping machinery needed. Exactness at
level 0 is the field-standard Menger SDF's, lifted level by level by the
same isometry: `r_i = |1−3|a_i|| > 1` exactly on a coordinate's middle
third, so the 3D term `(median(r) − 1)/s` reads the exact bar-wall
distance, and the 4D term is its mirror image — `max-of-mins` over the six
coordinate pairs (the second-largest of four indicators; at three axes
both forms are the median, at four only max-of-mins reads "at least two of
four middles").

Pinned in `menger-de.test.ts` / `menger-de-4d.test.ts`:

- Exact wall distances at the classic points (`1/3` at the box center,
  exact wall distances inside removed bars, `1/9` at the corner cell's own
  level-1 void — every cell's center void is carved).
- Carve-symmetric twists (90° axis rotations in 3D, the xy-plane
  permutation in 4D) reproduce the plain construction's estimates to 1e-10
  across random queries — the executable form of the twist-composition
  argument.
- Lower-bound sweeps: membership points read ≤ 0 beyond rounding, 3D and
  4D, over hundreds of sampled set points.
- The 4D w row of a purely-3D twist stays exactly `(0,0,0,1)`.

## Step scale — measured

`scripts/twisted-menger.harness.ts` sweeps the march step against a deep
membership oracle: boundary-shell queries (estimate in `(0.004, 0.05)`),
24 random directions each, the endpoint's membership consulted.

| k   | overshoot |
| --- | --------- |
| 1.0 | 0/62,400  |
| 0.9 | 0/62,400  |
| 0.8 | 0/62,400  |
| 0.7 | 0/62,400  |
| 0.6 | 0/62,400  |
| 0.5 | 0/62,400  |

`MENGER_STEP_SCALE` is 1.0 — the estimate is exact at the tested boundary
shell, as the isometry argument predicts. The constant is only changed
with this sheet re-run.

## The family's parameter face

The sheet renders four constructions: the default twist (4 levels, the
`ma` rotation, no offset), the repo's capture-era frame (`off ≈ 1.4` per
axis — the chunky displaced-carve look), a general non-axis twist (the
churning crust), and a depth-7 carve. Output: `scripts/out/twisted-menger.png`.

## Status and remaining work

Landed: the vocabulary and resolver, both CPU estimators, their tests, the
sheet, and the `twistedSponge`/`twistedSponge4` presets (the lens-based
approximation, which is a plot-time composition over ordinary IFS
machinery — `PRESET_FINALS`). Also landed, as the carve family's own
routing stage: the `mengerTwist` block's AppState field, verbatim
persistence and scene-dimension wiring (the block REPLACES the transform
system as the subject, the `sphereInversion` precedent, checked after it);
the Surface gate's `menger`/`menger4` kinds (tiling and shape traps
refused, the ground plane composing, the transform system's kaleidoscope /
lens / finishes and a co-present chain twist disclosed dormant, the 4D
route compute-only); the `core:"menger"`/`core:"menger4"` WGSL cores beside
escape/bulb — bindingless, the construction riding the frozen variant
blocks (3D: the escape head-link interleave at 208..255 plus the
(levels, flag, 0, 0) word at 256; 4D: the lens4 region's word + SO(4)
rows + offset), bench-pinned by the M9/M10 legs; the tiny
`SURFACE_MENGER` GLSL fallback arm (3D only — 4D has no fragment mirror,
the escape4 verdict); the Scene/Look panel section (enabled checkbox +
eleven sliders + the 4D rows) with the transform sections dormant beside
their reason; and the `mengerCarve`/`mengerCarve4` presets
(`PRESET_MENGER_TWISTS`, absent-means-clear). The bench's menger legs gate
fail=0 with NO chaotic-orbit classifier — the carve is certified sound and
not an orbit — and the f32 twins' twin-vs-oracle agreement is its own gate.

## Points: the carve-sampler decision

The family is not an IFS (above), so the explorer has no attractor to
chaos-game; the carve-SAMPLER is the shipped answer (the sphere-inversion
family's exact-boundary-sampler role, one family over, by the same
plumbing — a present block replaces the cloud's subject,
`cloud-worker-core.ts` routes on it): `menger-sample.ts` rejection-samples
the construction's own box and keeps points inside the
`MENGER_SAMPLE_SHELL` (0.012) band around the surface, where the certified
DE vanishes — the set boundary is exactly the zero level set, and unlike
the escape chains the box contributes its own walls at every setting, so
there is no empty-set hole. Measured on the reference construction (4
levels, the `ma` rotation): **1.2M points/s placed** (50k in ~41 ms), all
sampled points within the shell, level histogram
2.7k/4.1k/11.6k/31.6k over 50k — the surface area concentrates in the deep
carves, as the construction says it must. The color slot is the winning
carve level (the surface trap's own channel, one slot per level via
`generationCount`); the 4D half samples the hyper-Menger's boundary in R⁴
and rides the standard 4D projection path (no slice of its own — the
projection IS the display, and Points never balloons the carve). The
sampler is capped at `MENGER_POINTS_MAX` (500k), the sphere-inversion
family's own two-seconds class.

## The shared twist vocabulary

The authored block's rotation/offset/`w` fields, the resolver's validation
body and the matrix composition now live in `twist.ts` as the ONE shared
twist vocabulary, and `menger-twist.ts` is the family layer on top of it:
the carve-depth ceiling, the reference-construction defaults (the family
pre-fills its ~53° Y rotation before the shared resolver runs — the shared
vocabulary's own neutral default is the identity, which is what the escape
chain's absence wants), and the dimension verdict. The second consumer is
the escape-time chain, which applies the same block to its orbit at every
link (`v <- R(f(v) + q + off)` — see `docs/escape-time-family.md`'s chain
twist section for the soundness argument and the certification): one
authored semantics, two consumers, and the composition
(`multiply4x4(planes, euler4)` — `affine4.ts`'s convention, the embedded
upper-left reproducing the 3D matrix exactly) has one definition rather
than the two a re-derivation would have minted.
