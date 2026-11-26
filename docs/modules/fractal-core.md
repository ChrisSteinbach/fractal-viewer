# `src/fractal/` — core vocabulary, affine algebra, chaos game, colour, presets

The dependency-free core's shared vocabulary: types, affine maps (3D and 4D), the chaos-game iterators, variations, colour and palettes, morph/mutation/random generation, presets and their side tables, shapes, and the sphere-inversion identity.

These entries moved word for word out of `AGENTS.md`'s Architecture section
when the file was split to fit smaller context windows. `AGENTS.md` keeps the
rules and a one-line index pointing here; the per-module verdicts, invariants
and measured records live in this file and the module's own header.
Each module's header comment and its subsystem doc remain authoritative where
they say more.

- `affine.ts` — Euler-XYZ rotation matrix + TRS compose/apply, matched to
  Three.js conventions; owns the shared `multiply3x3`/`inverse3x3`/
  `isIdentityAffine`/`composeLinearAffine` arithmetic. `composeAffine`
  STAYS PRE-POST: its callers ask for the transform's own affine, while
  each engine applies `Transform.post` at its explicit post stage.
- `affine4.ts` — 4D affine group (4×4 + translation), the
  `multiply4x4`/`composeLinearAffine4` twins and `liftPostToPost4`
  (upper-left 3×3, identity w row/column); `toTransform4` (lift 3D→4D),
  `systemIsFlat`/`systemPartsAreNonFlat` derive dimensionality.
- `chaos-game.ts` — IFS iterator: warm-up, escape-reset, bounds tracking.
  Injected RNG for reproducibility; optional `IterationRng` keeps morphs
  point-for-point correspondent. `SymmetryParams.blend` fades kaleidoscope
  weights continuously; optional multi-system layers are byte-identical
  to classic when absent.
  `Transform.chaos` (flam3's xaos, graph-directed selection): row = FROM
  map, entry j scales the pick of base j next, `systemHasChaos`/
  `chaosRowIsNonTrivial`/`resolveChaosEntry` the ONE definitions; picks
  stay one draw on every path; chi runs re-fuse each
  `CHAOS_SUB_ORBIT_POINTS` (a block-diagonal orbit never leaves its
  block); both Flame WGSL kernels transfer the oracle's row-major rows
  and keep `prevBase` across dispatches, so xaos never forces CPU; the
  fern|sponge preset pair is the reachability proof. `Transform.emitter`
  resets to a shape with exactly one primary draw in every point consumer.
  Surface admits emitter-only C0 in 3D/4D with root depth 0 and B
  prefixes over DISTINCT maps (`dedupeScheduleTransforms`); empty bands
  refuse. Proof:
  `docs/emitter-only-surface.md`. `HybridSchedule`:
  scene-level `{transforms, depth}`, B
  AFFINE-ONLY and stripped at every producer, applied at PLOT time —
  post-word THEN lens, `depth` primary-stream draws exactly when live,
  never fed back — in all four inlined mirrors AND both flame WGSL
  kernels (bench-pinned agreement scenarios); morphs never interpolate
  it (target's block pops at the leg's first push); `spongeOfFerns` +
  `PRESET_SCHEDULES` side table are its reachability. `Transform.post` is
  the THIRD point-consumer layer: after the variation sum and before the
  symmetry rotation, skipped by emitter steps. All eight CPU steppers and
  both Flame WGSL kernels carry it, forced by oracle tests.
- `chaos-game-4d.ts` — 4D twin (`runChaosGame4`), same loop unrolled to four
  coords. Kaleidoscope copies rotate in a PLANE, optionally with a `twist`
  (a double rotation — `affine4.ts`'s `symmetryRotation4`, which reproduces
  the 3D `symmetryRotation` entry for entry on the w-free planes).
- `color.ts` — HSL→RGB and five color-mode palettes.
  `buildColorModeLUT`/`writePaletteRampColor` is the ONE ramp definition the
  explorer, solid render, and legend share (4D radius mode included).
  `writePositionColor` is the ONE custom-position definition `buildColors`
  and `accumulateVoxels` share.
- `inversion.ts` — sphere inversion's ONE shared identity:
  `inversionBallScale`, the Möbius factor `R²/(|c|² − r²)` that takes a
  ball to a ball exactly, returning 0 — "no information", so a caller's
  bound degrades conservatively — when the region swallows the centre.
  `signedInversionBallScale` keeps the sign for generalized balls (a ball
  holding the centre maps to a complement).
- `morph.ts` — pure interpolation (`lerpSystem`): endpoint-exact at t=0/1,
  rotation lerped nearest-turn, transform-count mismatches fade surplus by
  weight, flat↔4D continuous via derived w-scale, kaleidoscope crossfade
  (identity tuple = order/plane/twist; twist never interpolates). Optional
  fold lengths lerp against their CLASSIC defaults; `Transform.post` lerps
  entrywise against IDENTITY. In both families both-absent stays absent.
- `mutate-system.ts` — mutation grid perturbation (`mutateSystem`): seeded
  nudge of every field, clamps mirror sliders, optional keys preserved;
  `wildcard` adds structural kicks. `SEEDED_MUTATION_ALGORITHM_VERSION` is
  4 for the widened type pool and present-only bipolar/PDJ parameter jitter;
  PDJ is excluded from wildcard type swaps because its zero-default map is
  constant, but an authored PDJ still mutates. Quality-gated by `scoreSystem`.
- `palette.ts` — Iq cosine-gradient palettes (`buildPaletteLUT` → 256×3 LUT)
  - user-authored `CustomPalette` (2–8 stops) and imported full-resolution
    `RampPalette` (`{kind:"ramp"}`, up to `MAX_RAMP_ENTRIES` — the shape a
    `.flame` palette lands in, so narrow bands and hue jumps survive; first
    editor edit converts it forward-only, disclosed). `PaletteSelection` =
    UI/state, `PaletteSpec` = worker/GPU wire, `resolvePalette` = bridge.
- `presets.ts` — default + named systems (`fourFinishes` is the FINISH
  showcase: four corner maps under a boxfold lens, three finishes and
  one deliberately UNAUTHORED control, since a showcase that authors
  every map cannot show what absence renders) + add-transform, plus
  nine
  `Partial<Record<Preset, …>>` SIDE TABLES main.ts's preset handler
  consumes: `PRESET_SCAFFOLDS` (4D wireframes), `PRESET_RENDER_HINTS`
  (the renderer a preset was authored for), and `PRESET_FINALS`
  (the plot-time lens a composition is built around;
  ABSENT MEANS CLEAR, so no lens survives a preset load into a system
  whose gate refuses one) and `PRESET_PALETTES` (the flame palette a
  composition was chosen with — built-in ids only, flame-hinted presets
  only); and `PRESET_SYMMETRIES` (the kaleidoscope a
  composition IS — today only `foldChainFlower`, whose subject is the
  five-fold query fold — on `PRESET_FINALS`'s ABSENT-MEANS-OFF rule,
  load-bearing in both directions since `analyzeBulbSystem` refuses any
  order above 1 and `analyzeEscapeSystem` refuses one that rotates into
  4D; main.ts also clears the twist, and no entry may carry one),
  `PRESET_TRAPS` (absent means CLEAR), `PRESET_SURFACE_PALETTES`
  (set-never-clear), `PRESET_SPHERE_INVERSIONS` (absent means CLEAR) and
  `PRESET_VIEWS` (saved camera + 4D rotor/slice landed with the cloud;
  absent means AUTO-FIT). Side tables rather than a wider `PRESETS` signature
  keep every preset from declaring what it does not carry.
- `project4.ts` — SO(4) rotor→matrix + camera projection, `FourDView`,
  `sliceWeight`, `SLICE_GHOST_FLOOR` (`0.06`).
- `random-system.ts` — "Surprise Me" generator: rolls random IFS (2–4 maps,
  optional kaleidoscope, 25% 4D), quality-gated by chaos-game probes,
  rerolls up to 40×. Injected `Rng`; never rolls the optional post-affine,
  whose absence stays identity. PDJ is excluded from type rolls: this
  generator authors no parameters, and PDJ's zero defaults are constant.
- `rng.ts` — seedable mulberry32 PRNG.
- `shapes.ts` — the multi-system epic's shape library: ONE document-facing
  `ShapeSpec` vocabulary (flat posed-part list, max 8 parts — no
  recursion, GPU packers need fixed blocks; Tier-1 primitives + the
  parametric gear) with TWO evaluators so every consumer renders the same
  object: `shapeSdf` (exact f64 SDF oracle, conservative under the
  min/max fold) and `prepareShapeSampler` (uniform-by-volume, min-index
  overlap acceptance; intersect parts are SDF-only, it throws).
  `shapeSdfSource` emits per-spec baked-constant code from ONE scalar
  template in glsl/wgsl/js dialects — the js dialect EXECUTES the shared
  template in tests against the oracle; the GPU-side executable pin lands
  with the first shader consumer. `SHAPE_MARCH_SAFETY` (0.9) is the one
  marching factor every consumer shares; the gear sector fold's domain
  (tooth must fit its sector, or the field overestimates) is disclosed in
  the module doc. Measured worst Lipschitz 1.000000 on both reference
  shapes; `scripts/shapes.harness.ts` is the visual + extent proof. The
  vocabulary is deliberately 3D — each consumer decides its embedding
  (stated in the module doc under the parity rule). Consumers own their
  persistence, while `app/bundled-shapes.ts` is the ONE registry for the
  shipped authoring choices (canonical spec, stable UI kind, label/icon,
  and emitter/trap eligibility); imported non-catalog specs remain Authored.
  Catalog meshes are prepared lazily and their exact nearest/sign queries
  use a deterministic identity-cached BVH; Surface atlases contain only the
  active scene's canonical id set, preserving stable catalog dispatch while
  analytic scenes allocate and upload nothing. Two-scene cache proof:
  `docs/mesh-sdf-delivery.md`.
- `types.ts` — type vocabulary: `Transform`/`Transform4`, `Vec3`/`Vec4`,
  `Bounds`/`Bounds4`, `WExtension`; `VARIATION_TYPES`/`COLOR_MODES`/
  `FOUR_D_COLOR_MODES`/`SYMMETRY_PLANES` const arrays (single source of
  truth). `Transform.post`/`Transform4.post4` are optional general affines,
  applied after the variation sum and before symmetry; ABSENT MEANS
  IDENTITY, and the 3D→4D lift embeds the post with w untouched.
  `Variation` adds only type-owned optional fields: fold radii; julian/
  juliascope/curl params; `bipolarShift`; and `pdjA/B/C/D`. Shared
  resolvers own every absent default; bipolar shift and all PDJ coefficients
  default to 0. Uniform fold size remains the transform affine's job.
- `variations.ts` — 25 append-only types: 20 flam3 names with its formulas,
  plus project-only `boxfold`/`spherefold`/`mandelbox`/`qsquare`/`bulb`.
  The measured five are frozen as follows (`r=hypot(x,y)`): bipolar is
  `(.5/π·ln(A+/A-), 2/π·wrapπ(.5·atan2(2y,r²-1)-π·shift/2))`,
  `A±=r²+1±2x`; diamond is `(x/r·cos(r),y/r·sin(r))`; ex uses
  `a=atan2(x,y)`, `u=r·sin(a+r)^3`, `v=r·cos(a-r)^3`, then `(u+v,u-v)`;
  PDJ is `(sin(a·y)-cos(b·x),sin(c·x)-cos(d·y))`; rings binds the LIVE
  COMPOSED pre-affine x translation `tx`, with `d=tx²+1e-10`,
  `R=fmod(r+d,2d)-d+r(1-d)`, output `(yR/r,xR/r)`. The finite extensions
  are also frozen: bipolar replaces only non-positive `A±` by `1e-30`,
  diamond/rings return planar zero at `r=0`, and curl keeps its EPS divisor.
  `resolveBipolarShift`/`resolvePdjParams` are the shared zero-default rules.
  All Surface/escape/bulb/quaternion analyzers name these eight flam3-batch
  types when refusing them. Power maps remain escape-chain links.
  Fold authoring is still governed solely by `resolveFoldRadii`: defaults
  `mR/fR/wall=.5/1/1`, `mR∈[fR·1e-6,fR]`, wall 0 kept; classic params return
  the shared function and `sphereFoldLipschitz=fR²/mR²`. `triplexPow8`
  remains the trig-free White/Nylander form; triplex powers are not repeated
  squaring. `composeVariations(list,preTranslateX)` binds rings once.
- `variations4.ts` — same 25 types, bit-exact at `w=0`; the measured five
  apply the identical xy form and carry z/w. Fold arithmetic is twinned but
  its resolvers are imported so authored/default meaning cannot diverge.
- `vec.ts` — `clamp`, `clone3`, `to255` helpers.
