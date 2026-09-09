# Emitter-only Surface scenes

Surface accepts a scene consisting entirely of active shape emitters in both
3D and 4D when its condensation band includes depth 0. This is the finite
case of the existing condensation equation:

`A = C0 ∪ ⋃ f_j(A) = C0` when there are no recursive maps.

No new primitive, distance estimator, renderer or wire layout is needed.
The recursive-map count is zero, while emitter records, their analytic
enclosing ball and their distinct material slots remain present. The core
analyzers, production entry gate and capability-neutral document gate use
the same `emitterOnlySurfaceBandRefusal` rule.

## Geometry and composition

Each emitter resets the orbit to its authored solid under its pre-affine
pose. Its variations and its own post-affine are skipped, exactly as in
point consumers. Emitter scale need not contract; the existing nonsingular
pose requirement remains. Symmetry expands the posed shapes, with every
copy retaining its emitter's material slot.

For local query `q_i = M_i^-1(p - t_i)`, the root term is
`0.9 * min_i(sigma_min(M_i) * shapeSdf_i(q_i))` in 3D. In 4D it is
`0.9 * min_i(sigma_min(M_i) * hypot(max(shapeSdf_i(q_i.xyz), 0), q_i.w))`.
The 4D solid lies at local w=0; it is not extruded through w. Existing live
rotor and slice behavior remains available, and nonzero slice thickness
remains refused for condensation geometry.

The finite scheduled B prefix still composes: a depth-k schedule produces
the union of `B_word(C0)` over supported B words of length k, before the
final lens. The condensation band measures A depth, so a B prefix does not
create shapes at A depth 1. A positive minimum depth therefore describes an
empty set even when B is present.

An emitter-only schedule additionally requires `n^(k-1) <= 4`, where n is
the number of active supported B maps and k its depth. Every unfinished B
prefix then fits the affine frontier; the last expansion evaluates each C0
term before pruning. This admits any record-bounded depth-1 schedule,
single-map words through the supported depth 5, two maps through depth 3
and four maps at depth 2. Wider/deeper prefixes are refused with an
actionable reason rather than showing their unresolved enclosing balls.
Inactive schedules and recursive IFS scenes keep their existing rules.

Xaos cannot remove a root emitter: the root has no predecessor state, and
the scheduled prefix also carries that wildcard. Disconnected rows,
positive transition magnitudes and the all-zero-row fallback do not alter
this finite root union. Active weights still determine which authored
emitters exist; inactive ordinary maps do not supply recursion.

The existing final-lens, Balloon, tiling, mesh delivery and source-budget
rules continue to apply. The physical record budget remains 24 across
`A | B | symmetry-expanded emitters`; A occupies zero entries here. B adds
no material slots. Shader hit-info attributes a strict minimum to the
winning emitter, and ties retain the earlier shade slot.

## Defects found before opening the gate

The ordinary zero-child exit already folds C0 into the distance, finds no
recursive candidates and retires all chains. The audit found four ways to
lose the finite root's geometry or attribution:

1. A requested depth of zero left a live root-ball terminal. A short
   preview could likewise stop inside a scheduled B prefix. The shared
   `condensationTraversalDepth` now ensures at least `B.depth + 1` visits
   for an emitter-only descriptor. CPU estimators, WGSL params packers,
   GLSL material packers and both scene preview/settle producers use it.
   Recursive IFS depth budgets are unchanged.
2. An unbounded band was treated as proof of future recursive children.
   Five identity B maps exceed the retained affine frontier: a dropped
   in-ball branch could then contribute a false sphere certificate. With
   two radius-0.1 spheres at x=±0.4, the centre's exact clearance is 0.3
   and its damped shape distance is 0.27, yet that certificate could report
   an interior. All CPU/GLSL/WGSL future checks now distinguish a remaining
   B prefix from future A children; after reaching C0, zero A maps means
   no future children regardless of the band's upper endpoint.
3. Affine hit-info initialized an absent child certificate to zero. At a
   positive-distance C0 hit, its depth-zero attribution step could overwrite
   the winning emitter with slot 0. Both shader dialects now require a live
   candidate before that step. The targeted GPU probe caught four wrong
   material winners out of eight queries in its first 3D row before this
   correction; scalar distances alone had passed.
   Its recursive palette accumulator likewise read the placeholder map 0.
   Emitter-only hit-info now takes the palette coordinate from the winning
   emitter's shade slot. The production WebGL palette witness also exposed
   missing emitter palette-coordinate uploads in both material packers;
   those now accompany the emitter's RGB color. Recursive color blending
   is unchanged.
4. The 4D refined estimator exchanged rank-3/4 candidates without preserving
   the evicted candidate's key. An empty slot could inherit a live key and
   contribute a false negative certificate. The independent two-map,
   depth-3 finite oracle exposed this at the gap between shapes. Candidate
   swaps now preserve the key, matching the plain CPU and shader paths.

The low-level schedule packer and code generator also required at least one
A map. They now admit zero A only with a nonempty condensation suffix,
retaining the empty-scene and combined-record refusals.

The established beam approximation for a deeper branching B prefix is not
an adequate admission argument for this finite case. With the same two
spheres and five identity B maps at depth 2, both All levels and Root only
retain a negative unresolved-B certificate at the gap. Agreement between
those two bands alone would hide the error. The new finite-prefix admission
bound excludes this composition; widening it needs a separately qualified
suffix evaluator or representation. Ordinary recursive IFS estimation is
unchanged. Distances can still be conservative rather than exact outside
the relevant enclosing balls; no claim of exact global SDF evaluation is
made.

## Authoring and recovery

Shape copies remains a document-owned Renderer control consumed by 3D/4D
inverse Surface sessions. Its adjacent note discloses that changing levels
restarts Surface and that emitter-only scenes require level 0.

An edit excluding that root is refused before the document, undo checkpoint
or renderer changes. This includes the Custom band's default [1,1] and a
first-level edit from 0 to 1. A normalized custom band with an omitted
minimum displays 0 in both the range and its exact numeric companion.

A loaded root-excluding band remains authored and disables Surface with a
specific reason. The adjacent **Use root shapes** action changes the band
to Root only through the ordinary undoable scalar edit. It is offered only
when that action restores a supported route; other refusals stay visible.
The status and recovery action are reachable before entering Surface.

## Reproducing the qualification

The independent finite posed-shape tests live beside both CPU estimators.
They construct their own world-space box/sphere distances and 4D embeddings,
including shape poses, emitter poses, symmetry, xaos, B words and depth
overrides. The GPU leg in
`src/app/gpu-bench/condensation-emitter-only.ts` uses the production eval,
hit-info and shade bodies with independent finite-shape and material
expectations. It is mandatory in `npm run bench:surface`.

```bash
npx vitest run src/fractal/surface-de.test.ts src/fractal/surface-de-4d.test.ts \
  src/fractal/condensation-de.test.ts src/fractal/surface-de-gpu.test.ts \
  src/app/surface-eligibility.test.ts src/app/control-spec.test.ts \
  src/app/surface-material.test.ts src/app/surface-material-4d.test.ts \
  src/app/gpu-bench/condensation.test.ts
npm run bench:surface -- --display=:0
npm run build
npm run preview
# In a separate shell, with the display credential described in AGENTS.md:
node scripts/surface-emitter-only.verify.mjs --mode=x11::0
```

The production browser gate drives both WebGL and WebGPU in both
dimensions. It requires completed settles and screenshot evidence of drawn
geometry, compares root-containing bands, activates the scheduled prefix
and material palette, and checks entry recovery, refused live edits and
record/prefix caps. Its screenshots and report are regenerated under
`scripts/out/surface-emitter-only/`; they are not committed.

The final hardware qualification on 2026-09-09 used an AMD Radeon RX 7900 XTX
(radeonsi/navi31, WebGPU `amd` / `rdna-3`), verified on authenticated display
`:0`. This host's hardware differs from the standing Iris machine note; no
Iris result is claimed. Chrome 151 passed the complete Surface benchmark:
105 agreement rows, 13 cross-check rows and 10 timing rows, with 26 clean
device-canary checks of 128 samples each. Its mandatory 16 emitter-only rows
covered 128 eval queries, 128 hit-info queries and 256 production-shade
queries across By Transform and Palette. Maximum scalar error was
`1.060e-7`, with zero material-slot mismatches and zero shade-byte error for
either color source. The full report is
`scripts/out/emitter-only-surface-gpu/results.json`.

The final production browser run on that hardware passed 34 captures and
20 image comparisons across 3D/4D and WebGL/WebGPU, plus eight loaded-scene
refusals and eight live-edit refusals. Every captured frame completed its
settle with zero exhausted rays; geometry occupied 0.8275%–5.5087% of the
canvas. Root-containing bands were byte-identical, and each of the four
palette witnesses repainted only the second shape, with zero change on the
first. The run reported zero page errors and zero GPU-process errors. Its
report, screenshots and stderr are in
`scripts/out/surface-emitter-only-release/`.

That browser qualification also exposed a pre-existing background-seeding
feedback loop in the shared strip renderer. A classic affine control
reproduced it, and rebinding the inactive samplers removed the GPU errors
without changing its final geometry; the separate evidence is in
[Surface strip pipeline](surface-strip-pipeline.md#seeding-an-unfinished-frame).

The final tree also passed all 7,356 unit tests in 181 files, `npm run lint`
(all three TypeScript programs, ESLint, Stylelint and formatting) and the
production build.
