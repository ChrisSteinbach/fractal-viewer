# Dielectric transport: the production oracle and renderer contract

The owner-selected appearance is intrinsic dielectric glass on an explicitly
closed optical solid, in 3D and on the posed native-4D slice
([the study](surface-dielectric-study.md) records the selection, the qualified
harness and the decided envelope). Before any renderer path is built, the
accepted transport/event mathematics have ONE executable definition:
[`src/fractal/surface-dielectric.ts`](../src/fractal/surface-dielectric.ts).
This document is the contract that definition implements and that every
backend — the WebGPU compute kernels and the GLSL twins — must satisfy. The
qualified harness (`scripts/transmission-dielectric-*.ts`, pinned to the
owner-approved images) remains the reference implementation of the parts that
stay harness-side; where this document and the harness disagree, the harness's
measured behaviour wins and this document is wrong.

The optics re-export proof: `scripts/transmission-dielectric-solid.ts` no
longer owns its own Snell/Beer arithmetic — it re-exports the oracle's, so the
22 GPU controls and the scalar harness pin the GPU against the same f64
functions production will link.

## What the module owns

- The optics: exact unpolarized Fresnel, Snell refraction with total internal
  reflection, Beer attenuation, the branch-bound rule, the replay-theta rule
  and the weak-child stack derivation (`dielectricFresnel`,
  `dielectricRefact`/`dielectricRefract`, `dielectricBeerThroughput`,
  `dielectricBranchBound`, `dielectricReplayTheta`,
  `dielectricWeakChildStackBound`).
- The qualified constants: IOR 1.45, absorption (0.17, 0.055, 0.025) per
  optical radius, environment bound 4, per-sample budget 1/1024, initial
  branch theta 1/(1024·64), six replay passes, 16,384 processed paths
  (interface guard shares the ceiling), 24 live-stack entries (23 required).
- The event vocabulary and the work-list transport oracle over an injected
  scene (`DielectricScene`), including chunked resumption.
- The per-sample acceptance predicate (`dielectricSampleAccepted`).
- ONE emitted optics body in GLSL, WGSL and `js` dialects
  (`dielectricOpticsSource`): the GLSL and WGSL texts are token renames of
  each other; the `js` dialect executes bit-identically to the f64 oracle and
  is the test pin. Backends splice this source per engine; the qualified
  kernel keeps its own f32 mirrors until the backends adopt it.

What the module does NOT own: the boundary query. A backend implements
`DielectricScene` against the PUBLIC displayed object — rotor/slice, lenses,
Balloon and tiling within their existing applicability contracts — never a
convenient unposed inner estimator. The qualified finite-grid boundary query
(`transmission-dielectric-solid.ts`) is the fixture implementation; its
anchor/roundoff-envelope and exact-corner conventions are the reference for
production geometry backends.

## Event vocabulary

The transport recognises exactly these events, mapped from the acceptance
vocabulary:

| Event                                | Meaning                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Boundary (`DielectricBoundaryEvent`) | An interface of the optical solid. A camera ray's first boundary is the primary hit; every later boundary of the same path is the same-run next interface. Carries `t` (per-query segment length in the unit-direction parametrisation), `entering` (the medium AFTER the crossing), the displayed outward normal, the anchor, and the backend's `materialSlot` attribution.                    |
| Miss while outside                   | The ray leaves the declared domain with no further boundary — the TERMINAL event. The oracle composes `throughput · rearRadiance(origin, direction)`. Opaque termination, the floor terminal and the sky are the rear scene's business: the backend decides what the ray lands on and returns its linear radiance; per-hit material attribution for those terminals happens inside the backend. |
| Miss while inside                    | An inside miss — no valid exit in the arithmetic. Unresolved (`inside-miss`), never a background hit.                                                                                                                                                                                                                                                                                           |
| Refused                              | A query failure (visit cap, invalid input, state mismatch, ambiguous anchor, nonmonotone crossing, degenerate normal, …). Unresolved (`traversal`, with the reason).                                                                                                                                                                                                                            |
| Bounded-negligible                   | Any path whose contribution bound (max throughput channel × scene `radianceBound`) falls at or below theta: its full bound is summed into the residual instead of being traced.                                                                                                                                                                                                                 |
| Unresolved                           | A guard fired: processed paths, interfaces, live stack, traversal refusal, inside miss. The blocked work's bound is added to the residual, but the sample stays unresolved — a summed bound never upgrades a refused run to complete.                                                                                                                                                           |
| Invalid                              | Non-finite radiance. Never retried, never presented as background.                                                                                                                                                                                                                                                                                                                              |

Resource caps are blind refusals by design (the qualified harness's rule):
even when the summed omitted bound would fit the budget, a capped sample is
unresolved.

## Conventions

- **Coordinates and units.** All optics happen in displayed 3D coordinates in
  world units. `t` values are Euclidean distances along a unit direction; an
  anchored continuation query restarts at its boundary, so each event's `t` is
  the traversed segment's length — exactly what the Beer term needs.
  Accumulated path depth is the caller's bookkeeping, not the query's.
- **Displayed 3D, both dimensions.** A posed 4D scene reduces to displayed 3D
  before the transport sees it (slice-then-operate):
  `dielectricIntrinsicPoint` embeds `(x, y, z, slice)` through the row-major
  world→intrinsic rows; `dielectricIntrinsicDirection` embeds with `w = 0`;
  `dielectricSliceNormal` derives the displayed normal from the crossed face's
  matrix row (normalized xyz part, outward sign; the slice column is dropped).
  There is no second transport half for 4D — the same oracle, the same
  constants, the same events.
- **Medium state is caller-carried.** The oracle never infers "inside" from a
  distance sign; it passes `inside` to the query and the query cross-checks it
  against its own exact membership logic, refusing `state-mismatch` on
  disagreement. Medium flips ride the event's `entering`: the transmitted
  child takes `entering`, the reflected and TIR children keep the incident
  medium.
- **The anchor contract.** A boundary event may carry an anchor — backend-owned
  continuation state, opaque to the transport, handed back verbatim on the
  child queries. It must identify the boundary canonically (so the next query
  suppresses the same face and only that face, exactly at its own origin),
  survive f32 rounding within a declared envelope (reconstructing masked
  coordinates from the anchor's integer identities is allowed and expected;
  beyond the envelope the query refuses `invalid-input`), and refuse cleanly
  rather than guess when inconsistent. The qualified finite-grid anchor
  carries the intrinsic intersection, the tied-plane mask, the plane indices
  and the post-incident cell indices; at exactly tied faces its corner
  convention (projection onto the span of the tied displayed normals,
  Gram-Schmidt in ascending intrinsic-axis order, rank-zero refusal) is the
  reference. Child query origins are the rounded displayed hit points; an
  anchored backend must prefer the anchor — re-transforming a rounded hit
  loses the boundary identity.
- **Refusals are disclosed.** Every unresolved sample keeps its failure kind
  (and the query's refusal reason); diagnostics may summarise them, but no
  path may relabel unresolved work as background or as bounded completion.

## Transport laws (one definition)

- Beer over each interior segment, before the Fresnel split:
  `throughput *= exp(-absorption · t / radius)` per linear channel.
- Fresnel weights are the exact unpolarized dielectric form; the refraction
  test uses strict `sinT2 > 1`, Fresnel's full-reflectance test `>= 1` — the
  measured-harmless asymmetry (at `sinT2 = 1` the transmitted child's energy
  is zero and its bound is cut before it is pushed).
- TIR produces one child with the full (Beer-damped) energy and the reflected
  direction; otherwise the split is `reflected = f`, `transmitted = 1 − f`
  per channel.
- Push the stronger child first, so the weaker actual-throughput child is
  processed first (LIFO); Fresnel is not assumed below 0.5. This bounds the
  live stack at 23 entries for the qualified constants
  (`dielectricWeakChildStackBound(4, 2^-21)`); capacity 24 carries one spare.
- Compositing law: `radiance += throughput · L` in LINEAR light, accumulated
  at terminal events only. Tone mapping/encoding stays the application's
  existing output path; the oracle never produces display-referred values.
- The residual is the sum of every omitted branch's FULL bound
  (`maxChannel(throughput) · radianceBound`, the environment bound appearing
  once per bound). It bounds discarded optical branches in the largest linear
  channel — not floating-point, antialiasing or appearance error. Image-wide
  totals are instruments; the per-sample budget is the gate.

## Resumption, cancellation, and capture

Two resumption shapes, both contract:

1. **Work chunks (CPU oracle).** `dielectricTraceStep` processes a bounded
   number of paths and leaves the live stack intact; a chunked run visits
   paths in exactly the uninterrupted order and reproduces it bit-for-bit.
   This is the randomized-chunking acceptance property.
2. **Replay passes (the GPU shape).** A sample that misses the per-sample
   budget (or hits a guard) keeps its pending identity and is re-traced FROM
   SCRATCH at the next pass's halved theta (`dielectricReplayTheta`). Nothing
   crosses passes except the pending mask, the accumulated radiance/residual
   of accepted samples, and the invalid mask. This is what the qualified
   kernel implements per tile pass, and it is the cancellation boundary:
   cancellation generations are replay-pass indices; a cancelled pixel keeps
   its pending identity and a fresh-device follow-up reproduces the baseline
   bytes (measured in the study's cancellation probes).

**Continuation payload.** The oracle's `DielectricTraceState` is a plain data
record: per-live-path `origin`/`direction`/`throughput`/`inside`/`interfaces`/
`anchor`/`bound`, plus `radiance`, `residual`, `processedPaths`, `status`,
`failure`, `theta`, `limits`. The per-pixel record a production scheduler
owns is: linear radiance (3×f32), residual (f32), status and failure kind
(u32), pending/invalid/accepted masks (u32 each), the replay-pass generation
(u32), and the sample identity below. The live stack itself stays
shader-private in the GPU shape (the qualified kernel's accounting treats it
as logical private state); the CPU chunk shape serialises it verbatim. A
backend adopting the emitted optics must keep every threshold, bound and
compositing line in THIS module's text — no restated constants.

**Sample identity and full-image coordinates.** A sample is identified by its
full-image pixel (absolute x, y) and its sub-pixel sample index; sub-pixel
jitter is the deterministic 2×2 grid at ±0.25 for four samples per pixel. Ray
NDC derives from the FULL raster extent — never the tile or window — with
positive camera-up at PNG row zero. These are the qualified harness's
tile/window byte-identity invariants; production capture inherits them
unchanged.

**Capture bands and the rear-image contract.** The selected model has no
screen-space state: reflections and refractions query the scene directly, and
the rear-image warp that needed screen-space rear samples was rejected with
the layered candidate. Capture bands are therefore independent BY CONSTRUCTION:
each band renders its own rays at their full-image NDC positions, and two
decompositions of the same raster must agree byte-for-byte (the harness's
tile/window gate proves it for the qualified kernel). No halo, no rear-image
history, no cross-band continuation. The rear-image/depth contract of the
earlier layered design is vacated and must not be revived by a backend.

## Zero transmission stays classic

A document without authored transmission never constructs a
`DielectricScene` or a trace; the classic finish path — including its
gamma-space blend-toward-backdrop convention and its compile gate — is
untouched. The document vocabulary, persistence and routing arrive with the
persistence task; this module takes IOR/absorption as parameters so the
qualified numbers can ride in as defaults
(`DIELECTRIC_IOR`, `DIELECTRIC_ABSORPTION`).

## The document vocabulary (shipped, dormant)

The authored state is `surface-optics.ts`'s, on `Transform.optics` — the
THIRD material sibling beside `finish` and `surfacePattern`, keyed on the
same `baseIndex` slot list. The rules, each owned by one definition:

- **The selector is the field.** `optics.model` — `"dielectric"` is the only
  admitted model (`types.ts`'s `SURFACE_OPTICS_MODELS`, the single source of
  truth persist validates against). Absence of the whole field is the
  classic state byte-identically: a legacy `finish.transmit` of .35 or .90
  keeps rendering the thin-shell backdrop blend and is NEVER reinterpreted
  as refraction merely because its number is stored. Opting in is the
  selector's own presence, never a stored numeric value — no silent
  migration on open/save, and a future "Glass"-style panel bundle, when one
  is authored, will SET this field through the per-field write rule and
  never store the bundle's name.
- **Scope.** The optical material is PER-SLOT; the optical normalization
  radius BASE is scene-derived — the session DE's `visibleBoundingRadius`,
  the FULL unsliced value in 4D (the balloon ball's own rule, so the tint
  does not pulse as the slice scrubs). There is no scene-wide authored
  optical state. Weight-zero transforms and the final (plot-time) transform
  contribute no slot, so their authored optics resolve nowhere — the
  material's own invisibility rule, not a special case.
- **Units and defaults.** `scale` (the only authored numeric) is the Beer
  normalization radius as a DIMENSIONLESS MULTIPLIER of the derived radius —
  world-defined, stable under zoom, raster and rotor/slice motion. Absent ⇒
  1, exactly the qualified appearance; the resolver clamps into
  `[0.01, 100]` (`SURFACE_OPTICS_SCALE_FLOOR`/`_CEILING`), where the floor
  is tint saturation inside 1% of the ball and the ceiling is clear across
  the whole ball — both indistinguishable beyond, and the clamp keeps the
  oracle's `radius > 0` assertion satisfied. The resolved slot material IS
  the oracle's `DielectricMaterial` (`surface-optics.ts`'s
  `ResolvedSurfaceOptics` alias), so a backend hands it to the transport
  with no adapter.
- **Not authored.** IOR and the per-channel absorption ride the qualified
  constants as defaults; the restrained optical distortion is NOT in the
  vocabulary yet — its model is unqualified until the distortion task owns
  it ("do not promote the prototype's IOR/thickness constants to product
  defaults without review"), and the transport lane below leaves a reserved
  word so that decision appends rather than relayouts. Work and chunk
  budgets (processed paths, interfaces, stack) stay OUT of material
  identity: they are the runtime's, not the document's.
- **Persistence** (`persist.ts`) mirrors the finish codec: fidelity only —
  finite values survive the wire untouched (round4 on `scale`), no clamp;
  an unknown model id drops the WHOLE block (the scale alone has no meaning
  without the model that interprets it); a non-finite scale drops only the
  scale; an all-garbage block decodes to no optics. A legacy document
  re-encodes byte-identically. The evolution crossover treats optics as an
  appearance field; its snapshot validator enumerates `model` against the
  vocabulary.
- **Morph** (`morph.ts`'s `lerpSurfaceOptics`): same model on both sides —
  including both absent — lerps `scale` continuously through the default-1
  fallback (endpoint-exact, sparse when both sides omit it); a model CHANGE
  pops the whole block at t = 0.5 (the surface pattern's own family-change
  rule, minus the strength ramp it has and optics has no use for — the
  transport has no per-slot weight to fade). **Mutation** perturbs a PRESENT
  `scale` multiplicatively (`U(0.92, 1.08)`), clamped into the resolver's
  band, and never materializes the block; the model field is discrete and
  rides through untouched. **Random generation** never authors the field
  (pinned).
- **Material transport** (`surface-material-wire.ts`). The A/B lanes are
  UNTOUCHED — B.x stays `transmit`, B.y `reflectionTint`, B.z/w the pattern
  config/scale, and a slot resolving optics with no authored finish/pattern
  packs classic A/B values. The optical data rides a DEDICATED append-only
  storage buffer (`opticsMaps`): ONE vec4 pair per slot, laid out by
  `surfaceMaterialOpticsLanes` — lane 0 `(ior, radius, absorption.r,
absorption.g)`, lane 1 `(absorption.b, reserved, reserved, reserved)` —
  zero-stride padded when no slot resolves optics, and thrown on a list
  that resolves optics non-uniformly. `surface-de-gpu.ts`'s
  `packSurfaceGpuOpticsMaps` pins the layout; the three reserved words
  belong to the distortion task (one authored word) and future approved
  fields — appends inside the frozen stride, never a relayout. The
  dimension-free layout is THE 4D half: one buffer, one lane order, both
  cores' backends.

### Capability and routing matrix (all current cores and wrappers)

Authored optics is DORMANT everywhere today: no kernel or fragment program
consumes the model, so every session — whatever it authors — routes and
renders exactly its pre-optics program, and an optics-only session compiles
the classic kernels with classic shadeMaps bytes (the shadeMaps packer's
materials argument stays keyed on finish|pattern). The gate is real state
already (`SurfaceMaterialSlots.optics`, the slots' resolved materials, the
force-frame key's `optics` block), so the backends that arrive next consume
it without redefining any of it:

| Core / wrapper                                | Transport status now                                   | Reason                                                                                  |
| --------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| compute `affine`, `fold` (3D)                 | Dormant; classic bytes unchanged                       | The resumable WebGPU transport is the next epic item                                    |
| compute `affine4`, `fold4` (4D)               | Dormant; same layout, same reason                      | The lane pair is dimension-free; the 4D backend adopts it in the same epic              |
| compute `escape`, `bulb`, `escape4` (forward) | Dormant                                                | Forward-orbit admission is a measured question for the backend work, not a free default |
| GLSL tracers (`surface-material*.ts`)         | Dormant; lanes ride classic values, defines unchanged  | The GLSL twins arrive after the compute backend (`dielectricOpticsSource` spliced then) |
| `lens` wrapper, both dimensions               | Dormant; zero transmission stays classic through it    | The wrapper composes whatever the wrapped core admits — nothing new to refuse yet       |
| `balloon` (3D/4D)                             | Dormant; the shell inherits the argmin slot's material | The forward-orbit echo stays plain until the backend's material attribution lands       |
| `ground plane`, `shape trap`, condensation    | Dormant; no change                                     | Scene furniture and attribution are the backend's business, already contract vocabulary |
| Surface applicability gates                   | Unchanged                                              | Authored optics adds NO new admission: eligibility is geometry, as before               |

Every capability claim above carries both dimensions. The panel task owns
the UI later; the recorded placement is beside Finish/Pattern in the shared
Transforms editor (Scene / Look), per `docs/panel-ia.md`.

## What is not yet qualified

This contract is the model's definition, not a production capability: no
renderer reads the oracle yet. The document vocabulary, persistence, slot
resolution and force-frame keying have now shipped (dormant — see above).
Remaining work, in order — the resumable WebGPU compute path across the
admitted cores (adopting `dielectricOpticsSource` and the frozen
`opticsMaps` buffer); the GLSL twins; rear-scene radiance and transparent
visibility; distortion and capture integration; panel material and starter
scenes; built-app qualification. Shader changes require the corresponding
CPU/GPU agreement gate even before production routing is enabled; the 22
GPU controls are the pattern. Applicability refusals
(slab/forward/balloon/engine admissions) are preserved unchanged by this
work.

## Reproduce

```bash
npx vitest run src/fractal/surface-dielectric.test.ts
npx vitest run --config scripts/vitest.harness.config.ts \
  scripts/transmission-dielectric-solid.harness.ts \
  scripts/transmission-dielectric-tree.harness.ts
```

The unit suite pins the optics (including the emitted `js` dialect executing
bit-identically to the f64 oracle), the transport oracle over analytic
interval/shell/posed-4D scenes, chunked bit-identity, the replay schedule and
the emission canon. The harness runs re-verify the qualified scalar pins
against the re-exported optics.
