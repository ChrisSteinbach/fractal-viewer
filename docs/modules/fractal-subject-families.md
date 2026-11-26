# `src/fractal/` — escape-time and subject-block families

The forward-orbit (escape-time chain, Mandelbulb, quaternion Julia) estimators and the subject blocks that replace the transform system: twisted Menger, sphere inversion, sphairahedra.

These entries moved word for word out of `AGENTS.md`'s Architecture section
when the file was split to fit smaller context windows. `AGENTS.md` keeps the
rules and a one-line index pointing here; the per-module verdicts, invariants
and measured records live in this file and the module's own header.
Each module's header comment and its subsystem doc remain authoritative where
they say more.

- `menger-twist.ts` — the twisted mod-Menger family's ONE vocabulary: the
  authored `mengerTwist` block (a `w` extension lifts to the 4D
  hyper-Menger and decides the scene's dimension), resolved
  sphere-inversion style; defaults are the reference construction
  itself. NOT AN IFS — the twist sits BETWEEN levels, no per-map
  composition closes. The estimators (`menger-de.ts`/`-4d.ts`) are the
  single-chain carve oracles, sound at every twist (isometry), step
  scale 1.0 measured; the 4D term is max-of-mins. ROUTED: the block is
  the scene's subject after the sphere-inversion one; tiling/trap
  refused, menger4 compute-only, bench-pinned fail=0 by the M9/M10
  legs, no orbit classifier. Record: `docs/twisted-menger-family.md`.
- `sphere-inversion.ts` — the family's ONE vocabulary: an authored
  form resolved to an explicit construction; bad values and unknown keys
  REFUSE, never clamp. The optional
  `sphereInversion` block persists VERBATIM (refused included), REPLACES the
  transform system as the subject; its arrangement decides the scene's
  dimension (`scene-dimension.ts`). `-de.ts`/`-de-4d.ts` twins: the
  TRANSPORTED CERTIFIED BOUND on the depth-D SEED ORBIT (never the limit
  set), step scale 1, the cutoff contract; f64 only, pinned by
  `sphere-inversion-oracle.ts`. SURFACE routes to bench-pinned WGSL
  `sphereInv`/`sphereInv4`; `SURFACE_SPHERE_INVERSION` (3D GLSL fallback)
  admits PER CONSTRUCTION (WebGL2's block); 4D, `icosidodec30` and GLASS
  are COMPUTE-ONLY under one subject phrase. GLASS: per-GENERATION
  `materials`; backend `sphereInversion` (signed field + membership gate),
  ball/shell seeds to depth 8, any generator count (resumable trace):
  safe; 4D meets every envelope line, 3D all but preview.
  Kaleidoscope/lens/per-transform finishes DORMANT; tiling, balloon, trap,
  slab REFUSE. POINTS draws the same set; Flame/Solid REFUSE. CONTROLS:
  Scene / Look (`sphere-inversion-controls.ts`); replaced sections
  DISABLE. Record: docs/sphere-inversion-family.md + -gpu.md.
- `sphairahedron.ts` (+ `-de.ts`/`-de-4d.ts`/`-sample.ts`) — the
  SPHAIRAHEDRAL limit sets' ONE vocabulary — inversion in INTERSECTING
  spheres (sphairahedron.net-style), the third subject block after
  sphere-inversion and the Menger carve: an authored block (family ×
  moduli × the AUTHORED J) resolved to an explicit construction;
  out-of-region or unknown values REFUSE, never clamp, but a field the
  family does not read is IGNORED (a tetra keeps cube moduli harmlessly),
  and regions are OPEN — a threshold pair resolves, disclosed degraded.
  The region is NOT convex: morph midpoints resolve through
  `buildSphairahedron`, out-of-region intermediates render coherently.
  The estimator twins are the reference's pass-restart face scan,
  `tileSDF(folded)/|λ| · 0.2` with the fudge applied INSIDE the estimate
  and NO cutoff (λ is not monotone); the pass cap and fudge are BAKED
  numerics, never object parameters. Points draws by the sampler's TWO
  ARMS — the walk on finite constructions, the estimate's sign sweep on
  infinite ones (the family doc's Points section); the fold's last-move
  FACE is the color slot either way; Flame/Solid refuse at
  the mode doors; Surface routes to the bench-pinned WGSL
  `sphaira`/`sphaira4` with the `SURFACE_SPHAIRA` GLSL fallback (3D only;
  per-construction caps 6 faces / 8 terms / 2 pieces); Balloon, tiling,
  trap, slab and optics REFUSE; ground plane composes (the infinite
  families' limit set is their own parabolic fixed plane); NO camera
  refit (the Points cloud is an exact boundary sample). Presets on the
  `PRESET_SPHAIRAHEDRONS` side table carry the picker's PASTED J; the
  panel's moduli sliders scope DYNAMICALLY to the region interval given
  the other modulus. Per-face finishes author a DENSE list on the scan
  order (absent/null classic byte-identically; optics REFUSED; an edit
  RESTARTS; the finite flip re-orders the scan, so finishes re-map like
  the face colors). Record: docs/sphairahedron-family.md.
- `escape-de.ts` — escape-time fold render's CPU oracle, and now a HYBRID
  FORMULA CHAIN: the canonical Mandelbox/Juliabox object and its
  hybrids, for exactly the systems the IFS gate refuses (one or more
  flat maps of which at least one does NOT contract, no final transform,
  no kaleidoscope that rotates out of 3D — `analyzeEscapeSystem` is the
  deliberate COMPLEMENT of `analyzeSurfaceSystem`, which admits exactly
  when EVERY map contracts).
  THE LIST IS THE SEQUENCE (Mandelbulber2's `seq->GetSequence(i)`):
  orbit step `i` applies link `i mod n`, `+ p` and the bailout test
  after EACH link, and a PASS is one full cycle — so
  `ESCAPE_TIME_ITERATIONS`, the preview depth clamp and the GPU's
  `maxDepth` keep meaning "how many times is each link applied". The
  rejected alternative, CHAINING (all n links inside one pass), was
  measured fattening toward a solid ball as links were added — the
  near-sphere defect returning — and survives only as an executable local
  in `scripts/escape-chain.harness.ts`, the sheet the SHIPPED estimator
  draws.
  A LINK NEED NOT BE A FOLD: the chain admits the two
  POWER maps beside its three folds — the triplex 8th power (`bulb`)
  and the quaternion square (`qsquare`) — so one document can hold a
  Mandelbox and a Mandelbulb in ONE chain. A link contributes its
  forward map and its LOCAL Lipschitz factor (`8·|y|⁷` from
  `bulb-de.ts`, a heuristic; `2·|y|` from `qjulia-de.ts`, EXACT because
  quaternion norms multiply), inheriting each map's shipped status
  rather than adding a new one. A LONE power map is
  REFUSED — `bulb-de.ts`'s estimator is the better one for that shape —
  which keeps this gate DISJOINT from `analyzeBulbSystem` rather than
  merely ordered before it, and costs no range because two power links
  ARE a chain. A power link's WEIGHT is free (`dr` accounts for `w`
  exactly), unlike `analyzeBulbSystem`'s lone map. THE ORBIT STAYS IN
  `v` SPACE with the literal `+ 1`: the power modules work in `y` space
  and seed `dr` at `sigma_max(M)`, the same recurrence in different
  coordinates, but that factoring needs ONE `M` and a chain has n.
  THE ESTIMATE FORM FOLLOWS THE CHAIN'S ESCAPE LAW
  (`EscapeDE.logEstimate`, ONE flag per chain resolved at build and
  carried on both wires): folds escape exponentially and read the linear
  `r/dr`; a power link makes the chain super-exponential and it reads
  the Böttcher `0.5·r·ln r/dr`. That does NOT reopen the sweep that
  refused the log form for the FOLD family — uniform-rescale equivariance
  cannot reach a map with `V(λy) = λ^d V(y)`.
  THE PREDICTED STIFFNESS HAZARD DOES NOT REPRODUCE — the blank-frame
  figures were the PROTOTYPE's CHAINING arm's, and cycling re-tethers
  the query after every link (the story, the table and the figures:
  docs/escape-time-family.md). SO NO AUTO-SCALE AND NO NEW SIGNAL: the
  closed-form hint (`escapeLinkStiffnessLimit`) was written, measured
  firing on every row, and DELETED — it stays executable as the refuted
  prediction's record.
  TWO INSTRUMENT RULES. Ball fill is a seeded uniform sample against
  `escapeSetContains`, NEVER A GRID (a fold's structure sits on its own
  walls — the integers, at the classic `boxLimit` — so a grid's planes
  land there and over-sample them), and it bites THIN sets, which is
  why it is easy to miss. AND A DISTANCE THRESHOLD IS NOT A MEMBERSHIP
  ORACLE IN EITHER DIRECTION — a small estimate means "near a boundary"
  for an ESCAPER too.
  `estimateEscapeDistance` iterates the maps FORWARD with ONE shared
  scalar running derivative (Buddhi/Rrrola `DE = |v|/dr` — the field's
  standard heuristic, not a certified bound), mirrored by
  `surface-material.ts`'s `SURFACE_ESCAPE` variant and
  `surface-de-gpu.ts`'s `core:"escape"` kernel. `ESCAPE_STEP_SCALE` is
  the one marcher-damping definition both mirrors import, and it STAYS
  0.35 AT EVERY CHAIN LENGTH, MEASURED rather than assumed (refuting a
  prediction that chains would need heavier damping) — cycling floors
  `dr` after every link, so no two folds compound
  between floors and the slack per step is the single map's. BAILOUT
  STAYS 4 for the same measured reason it always was: raising it at a
  fixed budget inflates the set rather than revealing it. Phone-cheap
  by construction (the n-times budget is a ceiling only a non-escaping
  orbit pays, and every extra link is another chance to escape). f32 is
  safe on the GPU mirrors: the bailout test bounds `|v|` entering every
  link and the per-link `+ 1` floors `dr`.
  EMPTY CHAINS ARE REACHABLE inside the gate — a big enough pre-scale
  escapes everywhere on the first pass and the mode renders a blank
  frame — so `escapeSetContains` (membership) and `probeEscapeFill` (a
  seeded sample of the bailout ball) exist to say so. THE PROBE MEASURES
  VOLUME AND MUST NOT BE READ AS "WILL IT RENDER": thin sets render
  coherent objects at zero measured volume (a slice through shells is a
  set of surfaces no volume statistic sees). The signal fires off the
  FIRST completed settle's own hit count instead (main.ts's
  `surfaceBlankNotice`, off BOTH engines'); the bar is
  `SURFACE_BLANK_HIT_FRACTION` (0.001) and NOT zero (the marcher accepts
  at `uAcceptPixelEps`). It reports, never refuses, and neither probe is
  wired into `analyzeEscapeSystem`/`buildEscapeDE`, which stay cheap.
  KALEIDOSCOPE is a query-space wedge fold (`foldQueryIntoSector`), not
  an orbit operation: `g` is 1-Lipschitz and an isometry per sector,
  the orbit is seeded AND offset by `g(p)`, so the set is exactly
  `g^-1(M)` — dihedral rather than the chaos game's cyclic (a cyclic
  fold is discontinuous and would certify empty balls across the seam),
  free per orbit step, and `SymmetryParams.blend` is deliberately
  unread exactly as in `surface-de.ts`.
  THE CHAIN TWIST (`twist.ts`, the twisted Menger's block)
  is an orbit operation at every link: `v <- R(f(v) + q + off)` — an
  isometry (dr unchanged, bailout 4); live twists disclose and refuse
  tiling/traps; a `w` extension lifts a flat chain to escape4. Certified
  frozen, both dimensions. Record: the family doc.
  EACH LINK CARRIES its resolved fold lengths and optional
  `postM`/`postT`. The forward post runs after the weighted fold/power and
  before `+ p`; `derivGrowth` multiplies base/post sigma-max bounds around
  the nonlinear body. Different links may carry different fold apparatus,
  and `foldLipschitz` tests the real `fR²/mR²`, keeping this gate the IFS
  gate's exact complement. Pinned against an INDEPENDENT oracle:
  `scripts/spherefold-radius-sweep.harness.ts`'s own parameterized copy
  of `runEscapeOrbit` agrees bit-exactly including a two-link chain
  whose links carry DIFFERENT radii.
  ONE-LINK, UNSYMMETRISED SYSTEMS ARE BIT-IDENTICAL to the original
  single-fold loop (pinned in `escape-de.test.ts` against a frozen copy),
  and the cycle carries into both shader mirrors: GLSL has per-link
  `uEscM`/`uEscT`/`uEscParams` plus the shared post block, while WGSL uses
  one `GpuMap` per link. `EscapeDE extends EscapeLink`
  survives as the head link's
  flat wire, now frozen layout ballast nothing reads to render.
  The rendered set is the MANDELBROT-form set — the per-iteration
  offset is the QUERY POINT, which is what makes it the
  object published Mandelbox renders show; the original Julia form (offset
  = the document's `t`) rendered a near-SPHERE and lives on as a local
  in `scripts/escape-form-sweep.harness.ts`, not as the permanent
  document flag it would cost. `t` survives as the PRE-fold offset — a
  live deformation knob, classic Mandelbox at `t = 0` — so the mode
  adds NO document state and stays a render MODE over the existing
  vocabulary (morphs/mutations/persistence untouched).
  SHAPE-TRAP VERDICT: color only, one accumulator in the shared orbit
  runners, mirrored by both 3D GLSL arms and all three forward WGSL cores.
  Full record — including its agreement evidence — in
  `docs/escape-time-family.md`.
- `escape-de-4d.ts` — the escape-time chain's 4D half, for the
  systems whose maps reach out of the `w = 0` hyperplane. Everything
  structural in `escape-de.ts` is dimension-free and carries verbatim —
  cycling, the per-link `+ p`, the shared scalar `dr` with its `+ 1`
  floor, the bailout radius, `ESCAPE_STEP_SCALE`, both estimate forms —
  so this module duplicates only the maps' ARITHMETIC (`variations4.ts`'s,
  bit-exact against the 3D forms at `w = 0`) and IMPORTS every constant
  and link code from its twin: what a chain IS has one definition.
  `qsquare` becomes the FULL quaternion square, whose `2|q|` stays EXACT
  rather than heuristic because quaternion norms multiply on the whole
  algebra — which is the point of the lift, since `variations4.ts` calls
  that map "the only entry whose 4D form is the DEFINITION and whose 3D
  form is the restriction". THREE REFUSALS, each with its own reason: a
  `bulb` link (`bulb-de.ts`'s model refusal, unchanged by dimension —
  triplex numbers have no fourth component, so a lifted triplex power
  carries `w` untouched and its `dr` would be computed on the other
  three); a SYMMETRY twist (a double rotation's fundamental domain is
  not a wedge, so there is no sector retraction — the `w`-PLANE it
  admits, and `foldQueryIntoSector4` folds all six; the CHAIN twist
  composes and is the bullet above); and a SLAB at any thickness (a
  forward orbit has no branch enumeration, so a segment straddling a box
  fold's wall maps to a bent polyline in one step — `surface-de-4d.ts`'s
  `slabExact4` refusal for a stronger reason no fold kind escapes). The
  anchor is pinned with `toBe` and its one seam disclosed: the AFFINE
  composition paths agree to ULPs and not to the bit once a transform
  rotates, which is `affine4.ts`'s own rounding and predates this file.
  Oracle for `surface-de-gpu.ts`'s `core: "escape4"`; NO fragment
  mirror, so an escape-shaped 4D session is compute-only exactly as the
  4D fold-branch port made fold-shaped ones. THREE PRESETS reach it,
  from the 4D menu group: `mandelboxBrick`/`mandelboxColumn` (one map
  turned in `xw`/`yw` — the rotation plane picks the long axis) and
  `hybridChainShells` (the rotation on its POWER link, the cheapest
  position). Figures: `docs/escape-time-family.md`.
- `qjulia-de.ts` — the quaternion Julia set's CPU oracle. Its module doc
  carries every settled verdict: the conjugacy, the CERTIFIED estimate,
  the smooth-alone renderer refusal (CLOSED won't-do, measured), the
  hybrid-chain reuse, the cost figures; a nonidentity post is REFUSED.
- `bulb-de.ts` — the Mandelbulb CPU oracle. Its module doc carries every
  settled verdict: the Mandelbrot form and `y`-space orbit, the Böttcher
  estimate with the `dr` floor, measured step scale 1.0, the
  lone-bulb/escape-chain split, the post refusal, the mirrors' warning.
  THE CHAIN TWIST rides it as the chain's placement one factoring over
  (the y-space step constants composed onto the DE; recurrence, bailout
  and estimate untouched; the z-axis twist IS the commuting control;
  `w` refused, 3D-only). Record: bulb-de.ts's module doc.
