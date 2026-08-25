# Multi-system IFS: xaos, scheduled hybrids, and condensation shapes — options brief

**Purpose.** Design-conversation handoff (2026-08-15) exploring three related feature directions for
fractal-4d.com: (1) several IFSs sharing one space ("a fern and a Menger sponge, offset"), (2) scheduled
hybrids ("a Menger sponge _made of_ ferns"), and (3) IFS fractals built from arbitrary shapes ("a 3D
fractal of cog wheels"). All three have established mathematical frameworks and all three map cleanly onto
the existing architecture. This brief is grounded in the repo as of today (`main`) and in the flam3 source
(`scottdraves/flam3`, `master`) — file and function references below are real, not guessed.

**Addendum (2026-08-16).** Option C′ folds in the follow-up shape-trap discussion (a Mandelbrot render
with peace signs stamped at every scale): orbit traps as a palette channel in the escape-time modes,
orbit traps as geometry in the fold family, Liouville conformality guidance on which systems keep 3D
shapes faithful, and the shared 3D shape supply chain.

**Implementation status (2026-08-25).** The shared shape library, xaos selection and `.flame`
interop, the xaos construction/editor UI, scheduled post-words in every point consumer, emitter
transforms, both xaos and emitter Flame GPU paths, and the escape-family shape-trap COLOR channel have
landed. Condensation now also reaches the 3D and 4D inverse-beam Surface paths, including the WebGL and
WebGPU tracers, an inclusive level band, 3D grid acceleration and balloon composition. Shape-trap
GEOMETRY now reaches conformal forward fold chains in both dimensions. Scheduled and graph-directed
inverse descent now reach both Surface shader families. Tier-3 mesh shapes have landed as a stable
built-in catalog id: one prepared watertight mesh supplies both its area-weighted triangle sampler and
a conservative 64³ R32F SDF atlas for the GLSL and WGSL Surface consumers. The sections below keep the
original design argument, with landed paragraphs updated to describe the implementation rather than a
proposal.

Companion docs already in `docs/`: `quaternion-julia-brief.md`, `fold-de-performance-brief.md`,
`flame-interop.md`.

---

## 0. Theory in one page

**Merging alphabets is not the feature.** Concatenating the fern's maps and the sponge's maps into one
transform list gives an attractor C satisfying C = ⋃fᵢ(C) ∪ ⋃sⱼ(C): every map applies to _everything_, so
you get shrunken sponges budding along fern fronds, ferns inside every sponge sub-cube, hybrids of hybrids
at all scales. Sometimes beautiful, never "two neat objects." (This needs no code — users can already
paste two presets into one system — so it's the baseline to differentiate against, not a deliverable.)

Three constructions do what the questions actually ask:

1. **Graph-directed IFS** (Mauldin–Williams 1988; "recurrent IFS", Barnsley–Elton–Hardin): symbol
   sequences are constrained to paths in a weighted digraph over the transforms. flam3 calls this
   **xaos**. Block-diagonal graph → systems stay separate objects in one space; small off-block weights →
   controlled cross-infection. This one mechanism spans "side by side" through "everything-hybrid"
   continuously.
2. **Scheduled words**: fix the _order_ of alphabets — k sponge letters, then fern letters forever. The
   attractor is ⋃_{|w|=k} s_w(Fern): a depth-k sponge arrangement of whole ferns. Finite k **is** the
   artwork (as k→∞ the ferns shrink into invisibility and the plain sponge returns). Periodic schedules
   give genuinely new attractors; both are special cases of (1).
3. **IFS with condensation** (Barnsley, _Fractals Everywhere_): add a fixed compact shape C₀ to the
   Hutchinson operator, H(S) = C₀ ∪ ⋃fⱼ(S). The attractor is the closure of ⋃_w f_w(C₀) — every image of
   the shape under every composition. This is precisely "a fractal of cog wheels."

---

## Option A — xaos / graph-directed chaos game

### flam3 ground truth (verified in source)

- Genome carries `double **chaos` plus `chaos_enable`; `flam3_check_unity_chaos()` disables the machinery
  when the matrix is all 1s (`flam3.h`, `flam3.c`).
- Selection is precomputed: `flam3_create_xform_distrib()` builds one `CHOOSE_XFORM_GRAIN`-sized row **per
  from-xform** (each row's entries distributed ∝ xform weight × chaos scalar). The iterate loop then does
  `fn = xform_distrib[lastxf*CHOOSE_XFORM_GRAIN + (irand & MASK)]` when chaos is enabled, else uses row 0.
- XML: each `<xform>` may carry `chaos="s0 s1 s2 ..."` — whitespace-separated scalars toward each standard
  xform **in document order**; missing entries default to 1. Final xforms sit outside the selection
  machinery entirely (they are plot-time, matching our lens).

### Current repo state

- `.flame` import/export now reads and writes each xform's `chaos` row, sanitizes at the trust boundary,
  reindexes rows and columns around dropped unsupported xforms, omits unity rows, and excludes the final
  xform from selection. The old “Xaos … was ignored” warning is retired; the detailed codec contract is
  in [flame-interop.md](flame-interop.md#xaos-per-transform-chaos-rows).
- `src/fractal/chaos-game.ts` prepares cumulative rows over base transforms, including the global-table
  fallback for an all-zero row. Kaleidoscope copies inherit their base map's row, and long xaos runs
  periodically re-fuse a new sub-orbit so every isolated block receives samples.

### Landed engine shape

- The CPU iterator threads `prevBase` through every pick. Xaos, a degenerate-row fallback and the classic
  weighted/uniform path each consume exactly one primary draw, preserving the absent-feature stream.
- Both Flame WGSL kernels transfer the CPU oracle's cumulative rows and row totals into one row-major
  storage table. Per-chain previous-base state lives in a spare chain lane, so the chain stride stays 32
  bytes and continuation/re-fuse semantics survive dispatch boundaries.
- 4D uses the identical selection layer; its only extra agreement fixture combines xaos with a
  kaleidoscope so expanded-slot indexing is live.
- Surface transposes the effective support graph into predecessor masks. A reverse chain begins as a
  wildcard (including any scheduled B prefix), then carries the first A map's compact state and admits
  only predecessors whose forward edge reaches it. Positive matrix magnitudes change measure, not
  geometry; degenerate rows use the same global fallback. CPU, GLSL and WGSL implementations cover
  affine/fold, 3D/4D, lens/slab, schedule and condensation combinations under one global bound.

### Import/export, UI, tests

- **Add system as isolated block** is the construction gesture: choose a preset, saved scene or duplicate,
  seat it apart using measured extents, optionally balance block weights, and write the off-block zeroes
  automatically. Derived block-pair leak dials cover isolated through merged before the full matrix is
  needed.
- The n×n numeric matrix remains behind **Advanced**, rows FROM and columns TO, with index/color headers,
  an all-zero fallback warning and a scroll container. Non-uniform hand edits report **Customized** on
  the corresponding leak dial. The two fern/sponge presets remain the reachability and agreement cases.
- Transition histograms, block isolation, `.flame` round-trip/reindexing and three GPU agreement scenarios
  are automated. A reference-renderer pixel diff was unavailable in the development environment, so the
  hand-authored golden fixture's imported rows are the standing interop assertion.

**Status: landed across CPU/4D, both Flame GPU kernels, both Surface shader families, `.flame` interop and the editor.**

---

## Option B — scheduled hybrids ("a Menger sponge made of ferns")

### Point/flame modes first (≈30 lines of engine)

Add a **post-word stage** to the chaos game: after each plotted attractor point of system A (and before
the final-transform lens), apply k independently random maps drawn from a second transform list B. Output
distribution = level-k B-arrangement of A's attractor. Concretely: fern point → 3 random `mengerSponge()`
maps → "sponge (3 levels deep) of ferns."

- Controls: system-B picker (any preset/saved system) + integer depth k (0–5). k=0 = today's behavior.
- Cost: k affine applications per plotted point — negligible next to variation blends.
- Works identically in cloud, flame, and solid/voxel modes since all consume chaos-game points; the 4D
  path reuses `affine4`.
- Once Option A exists, general periodic schedules can be expressed as layered transform copies with a
  directed χ — but the post-word stage is trivially small and ships first.

### Surface mode (landed)

`src/fractal/surface-de.ts` descends inverse maps with per-map σ_min certificates. A schedule is a
_level-dependent alphabet_: levels < k descend only B's inverse maps, deeper levels only A's. Certificates
are per-map, so validity is untouched; the implementation carries a certified bounding ball for every
remaining B suffix, disables A's symmetry and condensation terms during the B prefix, and starts A's
material attribution at the transition. Caveat: the fern's maps are strongly anisotropic, so σ_min bounds
are loose and Surface-mode ferns march slowly regardless. Barnsley's canonical stem is also exactly
singular, so the scheduled showcase alone widens that stem to an explicit, visually negligible 0.001
scale; the standalone Barnsley preset remains exact.

**Effort: S (point modes), M (surface). Test: k=0 bit-identical to current renderer.**

---

## Option C — condensation shapes ("a 3D fractal with cog wheels")

### Point/flame/solid modes: the emitter transform (landed)

Chaos game with condensation is a standard two-line variant: with probability proportional to its weight,
a step **ignores the incoming point and emits a random sample of the shape C₀**; otherwise apply a normal
map. Plotted points then fill ⋃_w f_w(C₀). (Flame culture already does this unknowingly — `gaussian_blur`
and friends are input-ignoring "condensation sets in disguise.")

- `Transform.emitter` carries the shared `ShapeSpec`. When picked, it ignores the incoming point,
  samples the shape, and applies that transform's own pose; variations are skipped, while color, xaos,
  schedule and final-lens stages behave like any other slot. Exactly one primary draw seeds a derived
  sampler stream per emitter step, keeping selection and emitter-free documents in lockstep.
- Cloud, Flame and Solid work in 3D and 4D. Both Flame GPU kernels use bounded, rejection-free samplers
  that reproduce the CPU sampler's measure rather than its draw sequence: exact closed forms for sphere,
  box and capsule, conditional-CDF inversion for torus, and area-weighted triangles for gear. `Gearworks`
  is the single-part reachability preset.
- The device does not perform the CPU sampler's overlap correction for multi-part shapes, and its gear
  arcs use a fixed triangle fan. Neither caveat is author-reachable today: there is no emitter-authoring
  UI and the shipped gear has one part. Resolve overlap before adding such an editor.
- `.flame` has no faithful emitter equivalent, so export warns and writes the ordinary map. The optional
  lossy disc-to-`gaussian_blur` conversion remains deferred.

### Surface mode: shape trap inside the certified beam DE (landed)

The condensation attractor satisfies A = C₀ ∪ ⋃fⱼ(A), so the descent in `surface-de.ts` gains one term:
at **every visited node** (including the root), fold `σ_acc · sdShape(q_node)` into the running min, where
`σ_acc` is the accumulated σ_min product along that chain and `q_node` the inverse-mapped query point.
Pruned-sibling sphere certificates keep working provided the bounding radius R bounds the _condensation_
attractor. The implementation uses the certified fixed-point inequality
`R(c) = max(r₀(c), maxⱼ ||fⱼ(c)-c||/(1-Lⱼ))`, including fold/symmetry copies, rather than an empirical
chaos-game fit. This is the classic "orbit traps define the geometry" construction (Syntopia part VIII)
transplanted into the beam-descent estimator. The **Cog levels** control supplies an inclusive word-depth
band `[a,b]` (root = 0, ordinary-map children = 1); the classic setting is all depths, and finite bands
give "cogs at one scale only."

The shape term is evaluated at the root, every generated child, every retained or terminal frontier
node, and every fold/lens branch the estimator visits. Its `0.9` safety factor is applied after the
emitter pose's `sigma_min` and the accumulated chain scale. In 3D this is the ordinary posed solid SDF.
In 4D the same 3D solid is embedded at local `w = 0`, with distance
`hypot(max(sdShape(xyz), 0), w)` — an embedded solid, not an extrusion through w — and nonzero slice
thickness is refused because a segment query has no certified condensation counterpart.

Emitter transforms are reset events, not recursive maps: their variations are skipped, symmetry copies
share one shade/material slot, and ordinary maps remain the only descent alphabet. Surface refuses an
unsamplable or nearly-flat emitter, an emitter-only document, and an emitter on the final transform. The
shader wire admits at most 24 ordinary-map plus symmetry-expanded emitter records and at most 24 unique
shade slots. Escape/bulb forward cores remain a different construction and refuse this condensation
term; their shape-trap color channel and the separate trap-as-geometry work below are not aliases for it.

The public estimator already contains the full condensation term and its invariant ball, so the existing
3D refined surface grid composes without a special estimator fork, while the balloon inverted-union
wrapper composes in both dimensions. Grid build/sampling stays on the 3D affine system's refined price
path; balloon applies the same public-estimator union proof one wrapper farther out.

GLSL gear SDF for the mirror in `src/app/surface-material.ts` (2D profile, then extrude):

```glsl
float sdBox2(vec2 p, vec2 b){ vec2 d = abs(p)-b; return length(max(d,0.0)) + min(max(d.x,d.y),0.0); }

// N teeth on a body disc of radius r, tooth half-size `tooth`, axle hole rHole.
float sdGear2D(vec2 p, float r, float N, vec2 tooth, float rHole){
    float d   = length(p) - r;                       // body
    float seg = 6.28318530718 / N;
    float a   = mod(atan(p.y, p.x) + 0.5*seg, seg) - 0.5*seg;
    vec2  q   = vec2(cos(a), sin(a)) * length(p);    // fold into one sector
    d = min(d, sdBox2(q - vec2(r, 0.0), tooth));     // one tooth, repeated N times
    return max(d, rHole - length(p));                // axle hole
}

float sdGear(vec3 p, float h /*half-height*/, ...){  // extrusion
    vec2 w = vec2(sdGear2D(p.xy, ...), abs(p.z) - h);
    return min(max(w.x, w.y), 0.0) + length(max(w, 0.0));
}
```

Note: the sector fold makes the field slightly non-Lipschitz at sector seams — march the shape term with
a 0.9 safety factor (the codebase already has the analogous `sphereFoldLipschitz` discipline).

Non-goal worth writing down: _meshing_ gears (interlocking teeth across scales) is a constraint problem on
top of the IFS — constant tooth module forces rational similarity ratios so tooth counts stay integers.
Fun, out of scope.

**Status: landed in point, Flame, Solid and Surface consumers, CPU and both shader dialects.**

---

## Option C′ — orbit-trap channels for the escape-time modes + 3D shape guidance

_(Addendum. Reference image: a parameter-plane Mandelbrot render with peace signs stamped at every scale
— Pickover-stalk shape trapping. Goal: the same construction with 3D shapes and 3D systems.)_

### C′-color: trap as a palette channel (landed)

The live escape-time modes (`bulb-de.ts`, the `escape-de.ts` fold stacks including Mandelbox, and their
4D escape-chain twin) run the orbit at every shaded point. The landed channel adds one accumulator inside that loop —
`trap = min(trap, sdShape(z_i))` — and expose `trap` as a new input to the existing color modes /
palettes. No change to marching or DE validity: it is coloring only. The existing post-hit orbit re-run
evaluates the channel at the accepted point, independent of intermediate marching noise. Its document
state carries an orbit-space shape pose, closest-vs-first-threshold mode, and iteration fade. The 4D
path evaluates the shared 3D shape on xyz, preserving one shape vocabulary across dimensions.

A Mandelbox or quaternion-power hybrid shaded by distance-to-peace-sign reproduces the reference image
style, fully volumetric. `sdPeace3D(p) = min(sdTorus(p), three capsules)` — Tier-1 shapes below suffice.

The implementation shares `shape-trap.ts` across thin CPU wrappers over the escape, escape4 and bulb
orbit runners, then mirrors it in all three WGSL cores and both 3D GLSL forward arms. Real-Iris
agreement passed with fail=0 on all three fixtures; the menu-driven 14-preset gate measured 7.79% of
pixels changing with the channel on versus off. `Mandelbox Peace` is the reachability preset. Geometry
remains unchanged at every setting.

### C′-geometry: trap as geometry in the escape/fold family (landed)

The dual of Option C's beam-DE trap, for the _other_ estimator family in the codebase:
`d = min_i sdShape(z_i)/dr_i` inside the forward fold/escape iteration (Syntopia Part VIII's "orbit traps
define geometry"). Same level-band option as Option C. Between them the two constructions cover both
estimator families: beam descent over affine inverse maps (`surface-de.ts`) and forward fold/escape
iteration (`escape-de.ts` and friends).

The production construction is `min(escapeDE, trapDE)`, preserving the familiar escape object and
unioning the trapped copies into it. Each admitted zero-based post-link level contributes
`0.9 * posedSdf(z_i) / drAfter_i`; the derivative includes the link that produced the sampled point, and
the logarithmic escape form applies only to the ordinary escape term. The same all/root/custom inclusive
band vocabulary as condensation controls which orbit levels stamp geometry. Outside a finite band the
orbit pays only the band check, not a shape-SDF evaluation.

The decision contact sheet crosses Mandelbox / two-link fold chain, peace sign / gear, full / root-only,
and base / min-union / rejected trap-only. Min-union keeps the recognizable anchor while trap-only turns
finite bands into sparse fragments. The isolated damping sweep found no reason to invent a second safety
constant, so the shape library's shared `0.9` factor remains the local term and composes with the existing
escape marcher step scale.

The app admits geometry only for fold-only escape chains; triplex and quaternion power links, the
Mandelbulb and inverse-descent routes refuse it explicitly rather than ignoring it, while the same trap
remains usable as color on every forward family. In 4D the existing 3D shape vocabulary measures xyz,
i.e. its signed-distance extrusion through w, and the full 4D derivative still scales the term. Real-Iris
agreement passed with fail=0 while the geometry term won 113/700 3D and 125/700 4D samples; the
menu-driven on/off render differed on 23.26% of pixels. `Fold Chain Gear` is the menu-reachable geometry
preset; `Mandelbox Peace` remains color-only.

### Which systems keep 3D shapes faithful (the Liouville constraint)

The 2D reference image keeps every tiny copy a perfect peace sign because z² + c is conformal. In ℝ³,
Liouville's theorem shrinks the conformal family to Möbius maps only: similarities (rotations,
reflections, uniform scales, translations) and sphere inversions. Read against the codebase:

- **Shape-faithful:** the fold family — box folds, uniform scales, sphere inversions; i.e. the
  Menger/KIFS stacks, the mandelbox, the balloon inversion. Every trapped copy is a rigid or scaled copy.
- **Deliberate distortion:** anisotropic affine systems (the fern) shear trapped shapes progressively —
  legitimate as an aesthetic for point-mode emitters; the σ_min Surface bound stays valid but loose.
- **Coloring-only recommended:** triplex/bulb powers and the quaternion square are not conformal in 3D/4D
  — trapped _geometry_ smears along their stretching directions, while the C′-color channel is
  unaffected and works everywhere.

Slogan for the roadmap: shape-faithful geometry trapping lives exactly where the site already lives — in
the conformal fold family.

### 3D shape supply (shared by Option C's emitter/beam trap and C′)

- **Tier 1 — composed primitives:** sphere / box / torus / capsule plus boolean min/max. Covers the peace
  sign and most iconography.
- **Tier 2 — extruded/revolved 2D profiles:** the gear class (`sdGear2D` above + opExtrusion /
  opRevolution).
- **Tier 3 — catalog meshes (landed first cut):** a stable built-in id resolves to one validated,
  watertight prepared mesh. Its exact triangle-area CDF feeds the CPU and both Flame GPU emitters; its
  triangles bake a conservative 64³ single-channel SDF atlas consumed through one `sampler3D` in GLSL
  and binding 11 in WGSL. Both shader families manually interpolate eight R32F nodes, preserving the
  CPU bake's lower-bound contract. Share links persist only the id; upload storage and its link/backup
  story remain a separate design.
- Keep shape fields ≈Lipschitz-1 and march their term with the 0.9 safety factor noted in Option C.

---

## Delivery sequence

The shape library, C′-color, conformal forward trap-geometry, xaos, C-point, C-surface, B-point,
scheduled descent, graph-directed descent and the built-in Tier-3 mesh path are landed, including their
CPU, GLSL and WGSL mirrors. Surface interprets the post-word as a finite level-dependent inverse
alphabet: B alone for the first _k_ global levels, then A with its authored symmetry, using a bound for
every remaining suffix, and then transposes xaos support into per-chain predecessor masks. Mesh shapes
reuse those same shape, selection and schedule vocabularies; only user-uploaded mesh asset storage is
left for a separate design.

## Validation strategy

Keep the existing oracle discipline: every GPU/GLSL change mirrors a dependency-free CPU implementation
under `src/fractal/` with property tests (`surface-de.ts` ↔ `surface-material.ts`, `flame.ts` ↔
`flame-gpu.ts`). New properties: transition-matrix histograms (A), k=0 identity and finite-word inverse
order (B), certified-lower-bound checks against scheduled point clouds (B), and the same bound with the
shape term folded in (C) — sampled `dist(p, pointCloud)` must never be _below_ the estimator's claim.

## References

- flam3 source: `flam3.h` (`chaos`, `chaos_enable`), `flam3.c` (`flam3_create_xform_distrib`,
  `flam3_check_unity_chaos`, iterate loop), `parser.c` (`chaos` attribute) — github.com/scottdraves/flam3.
- Mauldin & Williams, "Hausdorff dimension in graph directed constructions", Trans. AMS, 1988.
- Barnsley, Elton & Hardin, "Recurrent iterated function systems", Constr. Approx., 1989.
- Barnsley, _Fractals Everywhere_ (IFS with condensation); Barnsley, _SuperFractals_ (V-variable fractals
  — the general theory of multiple IFSs sharing a space).
- Syntopia (M. H. Christensen), "Distance Estimated 3D Fractals": Part I (overview),
  Part III "Folding Space" (kaleidoscopic IFS), Part VIII "Epilogue" (hybrids; orbit traps as geometry) —
  blog.hvidtfeldts.net.
- Inigo Quilez, 2D SDFs and `opExtrusion` articles — iquilezles.org.
- C. Pickover — orbit traps ("Pickover stalks"), the construction behind the reference image.
- Liouville's rigidity theorem (conformal maps of ℝⁿ, n ≥ 3, are Möbius) — any conformal-geometry text.

## Appendix — pseudocode

```ts
// A: xaos-aware selection (CPU sketch; GPU mirrors with a CDF texture)
function buildChaosRows(weights: number[], chi: number[][]): Float64Array[] {
  return chi.map((row) => cumulative(row.map((s, j) => s * weights[j]))); // guard all-zero rows
}
let prevBase = uniformPick();
for (let it = 0; it < n; it++) {
  const base = chaosRows ? pickFromRow(chaosRows[prevBase]) : pickIndex();
  const slot = expandToSlot(base); // kaleidoscope
  p = applySlot(slot, p);
  if (it > FUSE) plot(lens ? lens(p) : p, colorOf(base));
  prevBase = base;
}

// C: condensation step — an emitter is just a "map" that ignores its input
p = isEmitter(base) ? shapeSampler.sample(rng) : applySlot(slot, p);

// B: post-word stage (after attractor point, before lens)
for (let d = 0; d < k; d++) p = applyRandom(systemB, p);
```
