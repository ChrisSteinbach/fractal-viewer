# `src/fractal/` — Surface render CPU oracles

The Surface (sphere-traced) render's CPU oracles and the composable pieces that ride them: the IFS descent estimators (3D and 4D), the backdrop shape, the balloon, the empty-space grid, space tiling, finishes and fractal glass.

These entries moved word for word out of `AGENTS.md`'s Architecture section
when the file was split to fit smaller context windows. `AGENTS.md` keeps the
rules and a one-line index pointing here; the per-module verdicts, invariants
and measured records live in this file and the module's own header.
Each module's header comment and its subsystem doc remain authoritative where
they say more.

- `background-shape.ts` — the backdrop gradient's SHAPE: "given
  a pixel, what is the mix parameter between the two stops", as against
  `background.ts`'s "given a mode, what are the two stops". The ONE
  definition six mirrors used to hold independently — a canvas 2D
  gradient, three byte-identical GLSL `mix(uBgBottom, uBgTop,
clamp(vUv.y, 0, 1))` lines, the WGSL row form, its obliged-byte-exact
  TS prefill mirror, and `surfaceComputeBandStops`, the shape's AFFINE
  INVERSE. Emits `backgroundShapeT` from ONE body TEMPLATE in two shader
  dialects (dialect-parameterized — see below — but still
  ONE shared math text), and mirrors it in TS for the canvas and for
  `backgroundMeanColor` (the shape INTEGRATED AWAY — THREE.Fog carries
  one scalar colour). THE COORDINATE CONTRACT IS THE LOAD-BEARING PART:
  every mirror evaluates at FULL-IMAGE coordinates
  `(pixel + 0.5 + bgOffset) / bgExtent`, a DIVISION by the full extent
  and never a multiply by a precomputed reciprocal, so a capture BAND
  reports where it sits instead of remapping its stops — which is what
  retired `surfaceComputeBandStops` (a linear ramp restricted to a
  sub-rectangle is still a two-stop ramp; nothing else is) and what lets
  a non-linear shape exist at all. THE CONTRACT IS THE WHOLE FRAME'S
  NOW: the compute kernels derive the ray's NDC, the march-start DITHER
  and the cinematic pixel SEED from that same full-image pixel, and a
  capture band traces the WHOLE image's projection rather than a
  sub-frustum, so a banded export is BIT-EXACT and not merely close —
  the dither's per-raster hash phase cost a LIT export 0.408/255 mean;
  both tile gates assert byte equality. `"radial"` is the second
  entry in `BACKGROUND_SHAPES`: a smoothstep vignette reading a
  host-computed `center`/`scale` (`backgroundRadialScale`, per-axis so
  the shape stays circular in real pixels) through the SAME dialect
  `field` accessor (`uBgCenter`/`shade.bgCenter`) both shader mirrors
  and the WGSL `ShadeParams` tail carry — a SHAPE
  orthogonal to `background.ts`'s GRADIENT modes, so every gradient mode can
  be linear or radial and `BackgroundGradient` stays the two-stop pair it
  always was. The per-pixel `"flame"` mode keeps the authored shape dormant
  until a gradient mode is selected again.
  Full measurement record (byte sizes, the two-token dialect divergence,
  the viewport-vs-canvas scale distinction) in
  `docs/surface-glsl-tracers.md`.
- `balloon-de.ts` — the balloon inverted-union DE: the scene as
  the UNION of the attractor and its sphere-inverted echo
  `I(p) = c + R²(p−c)/|p−c|²`, bounded by
  `min(DE(p), (|p−c|/rho)·DE(I(p)))` over the UNTOUCHED public
  estimators — the `descendLens` idiom one wrapper further out,
  conservative at every R (the measured verdict; module doc carries the
  certification argument against the DE's own probe-fit ball, margined
  by `BALLOON_RHO_MARGIN`). The march-epsilon cutoff contract survives
  through the inverse-scaled inner cutoff; `BALLOON_FAR_CAP_RHO` is the
  march-entry far cap every arm shares (capped rays fall to background;
  the grid is clearance-gated: 5/6 rest rows pass, spherefold refuses).
  CPU oracle for the `SURFACE_BALLOON` GLSL variant
  (`surface-material.ts`) and the `balloon: true` WGSL kernels
  (`surface-de-gpu.ts`, bench-pinned by `balloonEval`/`balloonMarch`
  legs); the explorer echo (`scene.ts`'s shared-geometry echo Points)
  reuses only the inversion + the far-cap vocabulary. IFS systems only:
  both FORWARD-ORBIT modes render plain — a filled solid's interior
  reaches the ball center, so its echo swallows the camera (the measured
  verdict for the escape folds; the Mandelbulb's own routing re-measured
  it rather than inheriting it — the figures are balloon-de.ts's module
  doc's) — and the estimator composed under
  the union must be far-field SOUND (a true lower bound outside the
  ball; the escape heuristic's `|q|` is not).
  Balloon on/`R` persist in the scene document; `R` is authored NORMALIZED
  (multiples of the raw ball radius, `buildBalloon`'s `rMult`), one
  continuous parameter across the explorer echo and the surface balloon.
  THE 4D LIFTS are semantic decisions and ball choices, no new algebra.
  The surface arm inverts in the SLICED 3D space and hands the
  estimator `(q, w0)` on both terms — SLICE THEN INVERT, so the echo is the
  inversion of exactly what is drawn, where inverting in 4D and slicing the
  result would draw the echo of a DIFFERENT slice (`I₄({w = w0})` is a
  3-sphere; the two agree exactly at `w0 = 0` for this origin-anchored
  ball). The Points arm applies the same reduction-first rule as
  PROJECT THEN INVERT: rotate/project the stored 4D point, preserve its
  w-ramp and soft-slice weight, then invert that visible 3D point through
  the full rotation-invariant 4D enclosing ball. Projection of a 4D
  inversion would not be the echo of the cloud on screen. The 3D bound then
  applies word for word, because a 4D estimate lower-bounds the 4D
  distance and hence the IN-SLICE one. `balloonBall4` takes the ORIGIN
  (`SurfaceDE4` has no `boundCenter` — it is origin-anchored, and
  `buildSurfaceDE4`'s own comment warns against copying 3D's centred fit
  blindly) and the FULL `visibleBoundingRadius`, not a slice-adjusted
  one: the slice sits inside `ball(0, R4)`, so the bound stays certified
  and the shell does not pulse as the slider scrubs. A `halfExtent` rides
  both terms untouched — the inversion never touches `w` — so the
  Möbius-ball helper this lift and the 4D slab work agreed to share was
  NOT needed here; it shipped anyway (`inversion.ts`), against a
  spherefold slab port that stays refused. The WGSL 4D wrapper is the 3D
  text UNCHANGED, which is the same decision seen from the kernel side.
  THE ECHO'S COLOUR IS AUTHORED, as ONE pair across both
  arms: `balloonTint`/`balloonTintStrength` mix the SHELL's base albedo
  toward an authored colour BEFORE lighting (`mix(base, tint, strength)`),
  so the shell still shades as geometry and the specular stays untinted.
  Strength 0 — the default and the absent-field value — is `mix(x, y, 0)`
  = x exactly, so every document predating it renders byte for byte. The
  surface arms gate it on the oracle's OWN `BalloonDistance.shell`
  attribution, which all three shader mirrors had been dropping: the WGSL
  hit-info now carries it as a balloon-only `shell` member beside
  `colorPos`, both GLSL arms as an out-param, ties to the fractal term in
  every mirror. The pair rides `ShadeParams` (208/220, struct 224) and NOT
  the frozen balloon DE params block — it LIGHTS a hit, it does not move
  geometry — and `surface-de-gpu.ts`'s shade entry being SHARED across all
  seven cores is what made the 4D half one emission rather than a lift.
  THE INDEPENDENT BALLOON PALETTE is likewise one authored LUT consumed by
  Points, Flame, Solid and Surface in both dimensions. Solid samples it only
  for a strict echo-attributed inverted-volume query, before balloon tint;
  changing it is a live material-texture update and never restarts the voxel
  worker or rebuilds its density volume.
  NO SECOND BRIGHTNESS KNOB, and `BALLOON_ECHO_DIM` stays a module
  constant: the default tint is BLACK, so the strength slider alone reads
  as a dimmer (`mix(base, black, s)` = `base·(1−s)`), where one shared dim
  field would have had to carry two different "today" values — 0.5 in the
  additive-points echo, 1.0 in the lit-surface shell — and so could not be
  byte-identical in both arms.
- `surface-de.ts` — surface render's CPU oracle: `analyzeSurfaceSystem`
  (eligibility gate: eligible/degraded/ineligible + reasons),
  `buildSurfaceDE` (BASE inverse maps + the kaleidoscope the descent
  SWEEPS around them — the sector sweep replaced the old symmetry
  expansion, so slots are base maps at any order; the module doc carries
  the validity argument and why a single wedge FOLD is unsound here — +
  seeded bounding-radius probe), `estimateDistance` (width-4 beam
  inverse-map descent + sibling certificates: the paired A/B chains —
  width 1 = the old greedy descent, measured overshooting, kept for
  tests — plus two validity slots, rank-3/4 chains live only while
  in-sphere, closing the 3+-simultaneous-branch drops; tables in
  `scripts/surface-beam.harness.ts`) + production
  `estimateDistanceRefined` (the 4D spike's extra Hutchinson level on
  folded sibling certificates, ported down from 4D — kills the balloon
  ghosts plain certificates rendered across voids; lazily guarded,
  measured void-false-hits 0 on every preset; the march-epsilon
  cutoff + the value-exact sphere-floor pin exit the descent
  early, both mirrored in the GLSL bodies; branch-and-bounding
  the fold branch enumeration adds dual bit-identical no-op skips —
  floor prune moved ahead of the child transform, then sigma-form +
  directional child-radius lower bounds — measured 75x fewer
  transforms/call on mandelboxKifs; the descent takes a probe-fit
  centered bounding ball where it beats the origin ball, axis-projected
  under kaleidoscope; an optional cone-footprint parameter caps descent
  depth per query, previewMaxDepth's argument per-step). Fold FINALs wrap
  untouched cores via `descendLens`, with floors/prunes and no contraction
  gate. Pure-swirl FINALs (tag 4) keep global-G hit acceptance and full
  epsilon compensation while echo strides compose certified local and
  Balloon empty-ball bounds with a damped approach in 3D/4D; radius and
  nonlinear-slab refusals remain. Proof: `docs/swirl-surface-lens.md`.
  POST BOUNDS: affine uses the exact composite; folds keep base/post
  singular bounds separate around V and return branch floors through
  `sigma_min(post)`; final visible radius includes post matrix+t.
  THE FOLD'S RADII ARE AUTHORED, NOT BAKED IN: the branch algebra's
  constants became expressions of the map's own lengths (inner inverse
  `×0.25 -> ×mR²/fR²` and its sigma `4 -> fR²/mR²`, inner output region
  `r <= 2 -> r <= fR²/mR`, mid shell `[1,2] -> [fR, fR²/mR]` with
  inversion `u/|u|² -> fR²u/|u|²` and certified factor `|u| -> |u|/fR`,
  box preimages `±2 − u -> ±2·wall − u` and in-box region
  `[-1,1] -> [-wall, wall]`), derived ONCE per map into
  `SurfaceFoldRadii` (these sit inside a per-candidate, per-branch loop)
  and carried on `SurfaceDEMap.foldRadii` and the lens.
  `SPHEREFOLD_LIPSCHITZ` survives only as the CLASSIC value the docs and
  tests quote — the live bound is `variations.ts`'s
  `sphereFoldLipschitz`, which the contraction gate and the depth cap
  read, so the knob moves the Surface/escape-time seam (exactly one
  shipped system, `mandelboxKifs`, is close enough to cross it).
  `SPHEREFOLD_MID_MIN_R` SCALES WITH `fR`, NOT `fR²` — it guards the mid
  inversion's image `fR²/|u|`, so holding that to `1e3·fR` makes the
  threshold `1e-3·fR`; `fR²` would be a length² where a length belongs
  and would break the uniform-rescale equivariance the fold family has
  (the two are indistinguishable at the classic `fR = 1`, which is why
  the first sketch of the change proposed the wrong one).
  Byte-identity at the defaults is by CONSTRUCTION — at the classic
  lengths every expression reduces to the literal that shipped. Oracle
  for `surface-material.ts`, the `flame.ts` <-> `flame-gpu.ts`
  discipline one render mode over — and EVERY GPU MIRROR NOW READS THE
  AUTHORED LENGTHS, so the CPU/GPU divergence is closed and the feature
  is reachable: `ui.ts` gives each fold variation the lengths that fold
  actually reads. The wire is the three AUTHORED lengths everywhere, not
  this struct's eight derived fields — three numbers a reader can check
  against the document beat eight combinations, which would be eight
  chances to disagree — and each kernel re-derives the branch algebra
  from them (`foldRadiiOf`, this file's `surfaceFoldRadii` field for
  field). Two producers still leave the fields alone, now by CHOICE
  rather than as that divergence's mitigation: `random-system.ts` does
  not roll them (no evidence they improve the generator, and rolling
  `minRadius` would move systems across the eligibility seam behind the
  user's back), and `mutate-system.ts` perturbs a present one but never
  materializes an absent one (so a mutation grid stays a grid of the
  system you brought it).
- `surface-de-4d.ts` — `surface-de.ts` one dimension up (born as the 4D
  surface DE spike): Jacobi `singularValues4`, `analyzeSurfaceSystem4`,
  `buildSurfaceDE4` (final-transform lens included; also derives
  `radiusBand` — the visible set's probe-seeded 4D center + [minD,
  maxD] distance band: the radius color source's normalizer,
  matching `buildColors4`'s radius convention so the full ramp is in
  play, slice/rotor-invariant), beam
  `estimateDistance4` + ghost-free `estimateDistance4Refined` — the 4D
  surface render's CPU oracle, mirrored by `surface-material-4d.ts`.
  Reads the fold's authored radii at all three of its own branch sites
  SHARING `SurfaceFoldRadii`/`surfaceFoldRadii` with 3D
  rather than redefining them (the resolved lengths are dimension-free,
  and two copies of "what does an absent field mean" is how a 3D system
  and its 4D lift start rendering different objects); the one genuinely
  new part is the FOURTH box axis, whose `pw0/pw1/pw2` and `dwUp/dwDn`
  take the same treatment as x/y/z and whose visible-radius bound's `+ 4`
  — the axis COUNT — becomes `4·wall²`.
  Measured verdict + numbers in the module doc (the SLICE CAVEAT's ~10%
  flat `w0` cost; its 20-40x off-centre cliff does not reproduce on
  either engine).
  Slab queries (`halfExtent`) route three ways — exact segment arithmetic
  (boxfold/affine), the BOUNDED MIDPOINT COVER (`SLAB_COVER_PIECES` 16,
  sound at any count) for nonlinear folds and final lenses, refusal only
  for swirl/condensation — mirrored by `surface-de-gpu.ts`'s
  `slabCover`, routed by the app, both gates green in both browsers;
  under a FINITE group the cover composes with the wall split per piece
  (the Mandelbox-plus-tiling acceptance case, live), the lattice arm
  still refuses. Proof:
  `docs/surface-slice-thickness.md`.
- `surface-grid.ts` — empty-space skip grid for the 3D surface march:
  conservative distance floors, priced per-system by
  `surfaceGridEstimator`, sampled by the 3D march before paying a
  descent; `pickSurfaceGridResolution` sizes the build from a measured
  pilot slab against a 3s budget. Module doc carries the validity chain
  (floor semantics, the pricing classes) and the 3D-only refusal.
- `tiling.ts` — the ONE space-tiling vocabulary and resolver. The legacy
  finite arm stays `{group, clip?}`; mirrored affine-A1 repetition is
  `{kind: "lattice", cellScale, clip?}` with required finite
  `cellScale >= 1`, no core-authored default/max, `h = cellScale·R`
  from the core's certified origin-centred visible radius. The
  finite arm owns A3/B3/H3 and A4/B4/F4, their proven fold bound (32
  including jitter guard), roots and explicit-orbit test oracle; its estimate is
  `max(DE(fold(q)), clipDist(fold(q)))`. The lattice folds attractor-frame
  x/z in 3D and x/z/w in 4D with fixed work (resolution refuses an `h`
  or `4h` period the frozen f32 wire cannot represent);
  `tiling-de.ts` is the one-core-call CPU authority for all seven inverse/forward families and
  maxes the mandatory certified ball. Walls/seams are NEVER distance terms.
  `latticeFoldSource` is the ONE GLSL/WGSL floor-modulo emitter; code 7 + h
  reuse the 16-byte tail as `(7, h, 10R, 0)`; all seven WGSL and both GLSL
  wrappers are driver-qualified, with canonical resolver/full-radius seams.
  `lattice-march.ts` owns exact sphere∩attractor-y-slab intervals, probe/shadow
  membership, entry-relative fog, the shared carrier-source
  emitter and a bounded reference march against an EXPLICIT outer radius.
  THE CARRIER IS WIRED: the live lattice session marches only inside
  sphere(10R) ∩ slab(|attractor-y| ≤ R) on both engines/dimensions — the
  window never becomes geometry, shadow or AO, and the 8R→10R presentation
  stays ONE policy across every renderer, not a per-renderer lattice
  window. Renderer-only, real-Iris gated, not document state. The panel
  family is SPACE TILING (Scene / Look, every render mode): arm kind,
  analytic clip on either arm, lattice cell scale over the FROZEN 1.25–4
  range (default 1.5), per-mode edit timing disclosed beside the controls.
  An entirely unposed clip
  composition gets one shared per-entry pose from the folded-content fit
  (the bailout ball for forward families), never changing the document;
  any authored part pose preserves the whole composition. Routing resolves
  lattice blocks PER-ARM against each DE's authority radius (visible for
  the descents, bounding for the forward orbits — resolveTiling throws
  without it), refuses the empty-space grid (its floors bound the
  attractor, not the infinite mirror image), and frames the camera on
  the canonical cell (`latticeCameraFitBounds`).
  KALEIDOSCOPE COMPOSES in both dimensions: the nearest-copy theorem takes
  the already-symmetrized set as content; no commuting is needed. Source
  symmetry and schedule also govern the shared automatic clip fit.
  Point consumers preserve symmetry → schedule → lens → membership →
  images → 4D view → deposit, with unchanged bounded work and primary RNG.
  FINITE BALLOON COMPOSES: tile, slice/project, then invert the displayed
  set through its certified origin ball; lattice Balloon stays refused.
  Solid folds live in 3D (hierarchy off) and bakes before 4D projection
  (hierarchy kept, restarts from entry seed). Budgets, timing, backdrop and
  refusals live in the contract's consumer matrix. Absent/refused stays
  literal legacy; `scripts/tiling-symmetry.harness.ts` and its browser gate
  certify the widened combination without improving the core approximation.
  Finite WGSL wire is one
  live u32 in a 16-byte tail (12 zero pad; maxima 560 B/848 B). Bench-pinned
  on verified Iris and browser-gated by `scripts/surface-lattice.verify.mjs`;
  authoring and teardown gates are catalogued in the contract;
  `scripts/tiling-balloon.verify.mjs` gates all modes, both Surface engines,
  reload/export and held Points. The Flame proposal-CDF refusal's sheet is
  `scripts/flame-tiling-4d.harness.ts`. Full contract and proof:
  `docs/tiling-contract.md`.
- `surface-finish.ts` owns the finish domain, absent-means-classic
  (the fixed formula's values; shininess floor 0.01), the compile
  predicate, ONE both-dialect shader body; classic bytes pinned.
  Finish persists/morphs/mutates like fold lengths; random-system
  never rolls it. TRANSMISSION: finite-solid 3D/4D glass; envelope
  DECIDED. `surface-dielectric.ts` is the ONE transport oracle;
  contract: `docs/surface-dielectric-transport.md` (which owns the
  backend routing, panel, starters and distortion records). Optics
  (`surface-optics.ts`) is LIVE on compute affine/affine4/fold4; the
  closed-solid backend (the SIGNED condensation-union query) RESOLVES
  and is ROUTED (`surface-optics-backend.ts`) where the composition
  admits it — one decision per session, both engines. Mesh-bearing
  emitter shapes ADMIT through the declared-resolution treatment: the
  optical solid IS the mesh lattice's declared wall (the same surface
  the display draws), membership the field's sign exact by
  declaration, interior strides capped at the declared cell radius;
  its bench legs are real-driver-gated (the atlas-bearing control
  compile kills SwiftShader's GPU process). Record:
  `docs/surface-dielectric-transport.md`'s declared-resolution section.
  Cinematic rigs (`surface-lighting.ts`): ONE both-dialect emitter,
  unresolved rays dark;
  NO PARTICIPATING MEDIUM (measured cost; a look call). Record:
  `docs/cinematic-surface-lighting.md`.
- `finite-solid.ts` — the FRACTAL GLASS oracle: the displayed optical
  solid IS the level-N cell set. The optional `finiteSolid`
  block routes to compute-only cores; primary and transport share the
  walk — the grid's ternary DDA for `{shape, level}`, `{level}`
  alone (0..4) as the document's OWN maps' word tree (any contracting
  affine; root: an invariant hull simplex, else the invariant box; stops
  at the first medium change (fused); the
  prune rides level boxes; the 128-leaf cap refuses, disclosed);
  the hybrid DE shades. PER-MAP MEDIA: Glass maps'
  subtrees are glass cells; others render as the TRUE
  ATTRACTOR (the composite kernel, <=24 maps), else opaque cells; opaque
  owns overlaps; each glass medium's INDEX is authored
  (`optics.ior`, [1.01,3]; absent = the default byte-identically;
  out-of-band REFUSES). Anchors snap to the clip's planes; a split
  child's stale medium re-anchors once. Gates pin every AA sample,
  copied pose, export identity; the word tree's reference is an
  independent union.
  Evidence: `docs/surface-dielectric-transport.md`.
