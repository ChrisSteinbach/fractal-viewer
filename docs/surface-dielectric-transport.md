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

## The compute backend (shipped)

`surface-de-gpu.ts`'s `optics: true` (shade mode) emits the transport beside
the classic entries, and `surface-compute.ts` drives it as its own lane when
the session's wire gate is live. The decisions recorded here are the
delegated numeric working lines — each reversible with its evidence; the
appearance selection stays the owner's and is untouched.

### The production boundary query

The qualified fixture's boundary query is EXACT (integer cell planes). The
production backend's is a bounded march of the COMPOSED PUBLIC estimator —
the same `surfaceDE` the primary hit path marches, so lens, tiling, balloon,
ground plane and the rotor/slice lift compose exactly as they do for the
primary hit — with these rules, each owned by one definition:

- **Crossing scale** (`DIELECTRIC_CROSSING_EPS_REL`, 1/512 of the slot's
  optical radius): the query crosses where the estimator falls below this
  WORLD-defined scale — never a pixel, raster or display tolerance. It is
  the optical solid's declared resolution: features and gaps narrower than
  it merge optically.
- **Medium state is caller-carried; the flip is definitional.** The query
  never infers inside/outside from a distance sign — these estimators have
  no signed interior contract, and the gradient of an unsigned distance to
  the surface carries no reliable outward orientation. A crossing's
  `entering` is `!inside` BY DEFINITION (the geometric flip the caller's
  state implies); the refraction/reflection math is deliberately
  sign-agnostic in the normal (the reflector mirrors across the tangent
  plane, the refractor self-corrects its facing), so no orientation
  inference exists to get wrong. The fixture's exact-occupancy cross-check
  has no unsigned-distance analog; its DISCIPLINE survives as the checks
  the query CAN make: the crossing must lie ahead (non-negative, monotone),
  the normal must be finite and non-degenerate (a vanishing gradient falls
  back to the incident-facing normal, the shade entry's own fallback), and
  the march must stay within its step budget.
- **The anchor.** A child query restarts AT its boundary (the rounded f32
  hit point is the anchor — the transport never re-derives it). The query
  suppresses the anchored boundary by stepping `2·eps` past it before
  marching, and treats any crossing whose hit point lies within
  `DIELECTRIC_ANCHOR_ENVELOPE_REL` (4·eps) of the anchored point as the
  same boundary, stepping past it — the distance-field analog of the
  fixture's exact same-face rule. Gaps narrower than the envelope merge
  optically; a long grazing stretch burns the step budget and refuses.
- **Domain and caps.** Leaving the primary march's own gates (the visible
  sphere, the balloon far horizon, the lattice carrier — the same
  arithmetic, evaluated from the query's origin) is a miss; exceeding
  `DIELECTRIC_QUERY_MAX_STEPS` (192) estimator evaluations refuses
  `visit-cap`; a non-finite estimator answer refuses `invalid-input`.
  Every refusal is unresolved work, never a background hit.
- **The normal** is the DE gradient's tetrahedron taps at the crossing
  scale — the same estimator tapped at the scale that defines the optical
  surface. The visible surface's display-tolerance normal is untouched.

### The closed-solid boundary backend (`opticsBackend: "closedSolid"`)

The estimator march's scope wall is the renderer envelope's structural
finding: it can find a boundary only from OUTSIDE, so a refracted child —
which is what glass IS — either misses the domain without a crossing or
crawls its anchor suppression into the step cap. The closed-solid backend
swaps the query BODY, not the march structure: the SAME anchored
suppression (2·eps skip, the 4·eps envelope), the SAME crossing scale,
step budget, domain gates and refusal vocabulary, over the session's
SIGNED closed-solid field — the condensation union at the root, the term
the primary march itself reads, SAFETY-scaled — whose sign is what the
unsigned estimator never had:

- **Inside traversal.** Outside, the field understates the distance to
  the solid (the certified conservative bound) and the march steps it
  forward. Inside, `|f|` is the deepest containing part's certified
  depth, which bounds the distance to the union's complement — the merged
  interval along the ray ends at the LAST containing part's exit — so a
  step cannot cross the boundary without sampling its band, and the first
  small steps grow geometrically away from the entry wall (no crawl).
- **The medium cross-check.** The caller-carried medium is CHECKED at the
  anchored restart: beyond the anchor envelope, a field whose membership
  contradicts the caller's medium refuses `state-mismatch` (reason 3) —
  the qualified fixture's exact-occupancy discipline, made real by the
  sign. The estimator query cannot produce this refusal; the closed-solid
  one is the first backend that can.
- **The 4D field.** The 3D field is the condensation term. In 4D the
  term's hypot form is a distance to the shape flat {sd ≤ 0, w = 0} and
  reads ZERO throughout that interior — measured: the first 4D envelope
  arm resolved nothing off it, both engines crawling identically (the
  agreement vacuous). The 4D field is the intrinsic solid's field plus
  the flat's distance as a penalty (`sigmaMin · sdShape + |local w|`,
  `condensation-de.ts`'s `condensationSignedDistance4`, mirrored by the
  kernel's `transportSolidField`): where the displayed slice carries the
  flat (the canonical composition — w-untouched lifts, w0 = 0, a
  w-preserving rotor) the penalty vanishes identically and the field is
  exactly the 3D solid field; off it the penalty forms a lens-shaped slab
  around the flat whose failures are honest refusals, never the invented
  interior the bare 3D form would have traversed.
- **Admission.** The backend is the shape/condensation vocabulary's own
  closed-solid representation — the bead's "equivalent closed-solid
  representation" beside the qualified finite-grid reference, whose
  anchor/corner/roundoff conventions remain the reference the contract
  pins against. It REFUSES (loudly, at emission): no condensation
  emitters (the signed field IS their union), graph-directed selection,
  hybrid schedules, the fold-final lens, tiling, balloon (the wrapped
  displayed solid is no longer the base union the field describes — those
  sessions keep the estimator query and its disclosed vacuous-optics
  state), and mesh-bearing emitter shapes (the mesh lattice's interior
  band is not a certified stepping bound; the mesh's declared-resolution
  treatment is its own follow-up). Ground plane composes (rear-scene
  terminal, orthogonal). The estimator body's emitted text is unchanged;
  the absent path stays byte-identical across every mode/core/variant.

Measured (quiet RX 7900 XTX / radeonsi, 2026-09-15): the agreement legs
pin the closed-solid query and trace against the f64 twin in both
dimensions (radiance ≤ 7.7e-5, residual ≤ 4.4e-7, normals ≤ 1.5e-5 over
the emitter-only union fixtures); the envelope's closed-solid arms RESOLVE
— 3D settle 630 ms with 5,769 resolved / 1,959 unresolved, 4D settle
697 ms with 7,856 resolved / 2,703 unresolved, every delegated line met
(preview 163/177 ms, checkpoints 12.8/14.9 ms, cancel 1.1/0.8 ms,
retained 5.6 MiB, byte-identical repeats). The unresolved fractions are
grazing paths riding the declared resolution — disclosed per arm, never
absorbed.

### Rear radiance, and what this backend does not yet trace

`transportRearRadiance(origin, direction)` is the rear scene's ONE seam.
This backend's rear scene is the ENVIRONMENT ONLY: the pixel's backdrop in
linear light, plus the ground-plane terminal when the session has one (the
shade entry's own floor shade, linearized by the file's 2.2 convention).
Rear FRACTAL geometry — escaped rays re-marching the displayed object, the
study's "reflections of other lobes" — arrives with the rear-scene task and
grows this one function; the contract's compositing law, bounds and
residual accounting are unchanged by that growth. The per-sample
environment bound stays the qualified 4 (`DIELECTRIC_ENVIRONMENT_BOUND`),
which bounds this rear scene with margin.

### Resumption, scheduling and truthfulness

- **The replay-pass shape is the resumption.** Per pixel the record is two
  vec4f (radiance.rgb + residual; status/failure/reason/generation); the
  seed zeroes it per frame. A pass dispatches a batch of rays; each still-
  pending sample re-traces FROM SCRATCH at the halved theta; accepted
  samples (per-sample residual ≤ `DIELECTRIC_ERROR_BUDGET`) overwrite the
  pixel and never reprocess. Six passes and a still-pending sample is
  final UNRESOLVED; a non-finite outcome is final INVALID; both go BLACK —
  never background — and the frame's counts disclose them. Cancellation
  generations are pass indices; the frame token's invalidation rules are
  the renderer's own.
- **The lane is the dispatch discipline.** HIT rays take BOTH the classic
  shade queue (which skips optics slots after the one hit-info the slot
  attribution needs) and the transport queue (which skips classic slots
  after the same check) — the optical work is its own submissions, never
  buried inside a shade or march dispatch, priced by its own measured
  sizer. Runtime caps (`SURFACE_GPU_TRANSPORT_MAX_PROCESSED_PATHS`
  2048 / `MAX_INTERFACES` 2048) sit BELOW the oracle's defaults: the
  estimator boundary query costs an order of magnitude more per path than
  the qualified DDA, and a capped sample replays rather than lying. The
  caps are the runtime's, not the document's; never raised to make a
  failing row green.
- **Optics and cinematic lighting are exclusive** (codegen and packer
  throw): both entries own the hit path's output. An optics-authored
  slot's authored finish is dormant for that slot — the dielectric
  replaces the hit shading; classic slots keep their finish and pattern.

### The renderer envelope, and what it found

The kernel agreement legs pin arithmetic; they never drove an optics-authored
frame through the production renderer. The bench's renderer-envelope leg
(`runSurfaceTransportEnvelopeLeg`, real adapters only) does: an optics-authored
fixture document (`optics: { model: "dielectric" }` on every transform) through
`SurfaceComputeRenderer`'s own march → classify → shade-skip → replay-pass
lane → present loop, at the delegated rasters — preview 256×144 1-SPP at the
app's own 2 s budget, settle 512×288 at the qualified 4-SPP convention,
unbudgeted — one arm per admitted descent core (`affineTetra` 3D, `aff4Tetra`
4D at its identity-rotor canonical pose), plus a mid-flight cancel probe
through the public `cancel()` and a byte-identity repeat of the preview.
Gates: the decided envelope's lines (preview ≤ 1.5 s, cancellation
checkpoints ≤ 600 ms — the per-dispatch fence IS the checkpoint, so the
frame's max transport batch wall is the bound —, retained ≤ 128 MiB, settle
≤ 10 s).

Measured 2026-09-14, quiet RX 7900 XTX / radeonsi (adapter `amd rdna-3`,
launcher quiet=YES), every delegated line met in both dimensions:

| Arm     | Preview wall | Settle wall | Max checkpoint | Cancel | Retained |
| ------- | -----------: | ----------: | -------------: | -----: | -------: |
| affine  |       397 ms |     2511 ms |        56.1 ms |  18 ms |  5.6 MiB |
| affine4 |       170 ms |      745 ms |        23.1 ms | 0.1 ms |  5.6 MiB |

Six replay passes ran in every frame; the preview repeat is byte-identical;
the settle sits at 2.5 s / 0.7 s against the 10 s line; the transport lane's
own two-term sizer learned per dispatch (~25-30 µs per ray·pass measured on
the production lane). Two create-path defects were found and fixed by this
leg's first runs — both invisible to the agreement legs, which compile the
emitted module directly instead of through `create()`:

- **The per-stage storage-buffer ceiling.** The transport lane's three
  buffers (13/14/15) take the shade stage's storage-buffer count to 9, past
  the spec-default 8 — the shade bind group layout failed validation and
  poisoned every derived layout ("[Invalid PipelineLayout] is invalid due to
  a previous error"). `create()` now requests the adapter's
  `maxStorageBuffersPerShaderStage` ceiling when the optics gate is live
  (this adapter: 10).
- **The shade uniform buffer's size.** The per-frame pack grows by the
  transport member (240 optics-alone / 256 with pattern) but the create-time
  `shadeBuf` still allocated the classic 224 — the `writeBuffer` failed, the
  uniform stayed un-staged, and EVERY dispatch binding it was silently
  invalidated: all rays stayed ACTIVE, the budget exhausted them, the frame
  rendered its seed backdrop. The buffer now allocates the optics top.

And the leg's structural finding, which qualifies every "LIVE" in the
matrix below to "live as compiled and routed":

- **Every transport sample resolves UNRESOLVED on hits.** The production
  boundary query marches the COMPOSED PUBLIC estimator — an unsigned
  estimate with no signed interior — and can find a boundary only from
  OUTSIDE. A refracted child (inside) either escapes the domain without
  ever sampling a crossing (inside-miss — the contract's own terminal for
  it) or, on a signed SDF, crawls its anchor suppression into the step
  cap. The CPU twin reproduces both failure codes exactly, which means the
  agreement legs' agreement on IFS fixtures was VACUOUS on this axis (both
  sides refused identically). Glass IS refraction IS an inside path, so the
  optical model has no resolving geometry on the production path yet: the
  qualified object was the finite-grid closed solid (exact DDA), and the
  closed-solid boundary backend is the recorded path to optical
  resolution. The envelope rows remain the standing TIMING gate — the lane
  pays its marches, fences and readbacks whatever the samples resolve —
  and the note marks a vacuous arm optically.

RESOLVED for the closed-solid path (2026-09-15): the envelope leg now
drives FOUR arms — the two estimator arms above, plus two CLOSED-SOLID
arms (`emitterOnlyUnion3`/`4`, the emitter-only union the backend serves,
driven with `opticsBackend: "closedSolid"` through the same production
renderer). The closed-solid arms RESOLVE (3D settle: 5,769 resolved /
1,959 unresolved; 4D settle: 7,856 / 2,703) with every delegated line met
in both dimensions, and the row-failure gate reads their settle's
resolved count — a zero-resolution closed-solid settle is a failure, not
a disclosure. The estimator arms keep the vacuous note (it flips itself
off when the resolved counts go nonzero); the agreement legs carry the
per-row `opticsSoundness` marker (`vacuous-inside` for the estimator rows
— all-refused agreement certifies nothing about optical soundness —
`resolving` for the closed-solid rows), and their anchored-arm t
tolerance carries the declared-resolution granularity of the anchored
same-boundary suppression (2·eps quantization; f32-vs-f64 field rounding
near the band's edge moves the band exit by one step — disclosed, not
absorbed).

### The real-app invalidation sweep

The envelope leg's mid-flight cancel probe is one renderer-level datum; the
real-app question — do the app's own invalidation and teardown paths drain
the transport state correctly — is its own sweep:
`scripts/surface-transport-invalidation.verify.mjs` drives the BUILT app
(`npm run build && npm run preview &`) through every path, entered FROM THE
UI, on transmission-live sessions in BOTH dimensions — the Sierpinski tetra
(`?surfacecompute` forces the compute tracer past the plain-affine WebGL
verdict) and the w-lifted pentatope (4D routes compute on its own), the
dielectric authored on every transform, pinned cameras, `reducedMotion:
reduce` so the pinned pose is the only view mover (a camera glide is
rAF-sampled; without the emulation its settled endpoint's last bits differ
per boot and ~0.1% of grazing pixels flip hit/miss, which eats the identity
claim). THE PREMISE IS ASSERTED PER RUN: `engine === "compute"` AND
`?surfacetrace`'s ring carries `transport pass=` lines — otherwise exit 2.

The app does not yet select the closed-solid backend (that routing is the
starter-scene task's), so the sweep drives the ESTIMATOR query — the lane
pays its buffers, dispatches, replay passes and cancellation generations
whatever the samples resolve, and on IFS geometry every inside path refuses
(the disclosed vacuous state). That is the right subject for THIS criterion:
it is the invalidation/drain of the transport STATE under test, not optical
resolution. The arms, all green on the quiet RX 7900 XTX (2026-09-15,
launcher quiet=YES):

- **settle + reload identity** (both dimensions): the transmission-live
  session settles, draws, runs the lane; two fresh RELOADS of the same
  document reproduce each other BYTE FOR BYTE (`maxDelta === 0`). The
  identity claim is deliberately reload-vs-reload, not first-boot-vs-reload:
  the first boot's surface entry auto-fits the camera once (the pinned pose
  wins from the second boot on, measured as a ~0.3% edge-flip delta between
  boot #1 and every later boot) — the camera-tween's concern, not the
  transport state's. What the pair proves is the criterion's question: a
  restart re-seeds the transport state, and a replay lane that retained
  anything across sessions would show it.
- **mid-trace edits** (camera drags in 3D; slice-toggle + slice-position in
  4D), two rounds per page, fired while `previewActive || settleActive`:
  each edit observably invalidates (`settled` goes false), the following
  settle completes, and the lane runs again — the frame-token discard that
  stops old-camera transport work from landing after an edit.
- **mode exit mid-settle** (both dimensions): Points clicked while the
  settle is in flight; the session exits (`RenderSession.terminate` — the
  teardown the Floor checkbox reaches too), re-enters, settles again with
  the lane live.
- **restart storm** (3D): the Floor checkbox toggled 6x mid-settle — every
  toggle lands against a renderer with transport buffers allocated;
  post-storm settle completes with the lane live, no page errors.
- **device failure** (3D): the browser's GPU process is SIGKILLed
  mid-settle (found by ppid ancestry — the desktop's own browser runs one
  too), a REAL `device.lost`. The page survives, the renderer's lost path
  fires ("Surface compute device lost"; the onLost re-enter lands back in
  surface mode), no uncaught errors. The WebGL fallback's CANVAS liveness
  after a GPU-process death is deliberately NOT asserted: the main GL
  context is lost with the same process and the app does not handle WebGL
  context restoration.

Exit codes: 0 pass, 3 fail, 2 inconclusive (the lane never went live), 1
harness failure.

### Capability matrix, updated

| Core / wrapper                                | Transport status now                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| compute `affine`, `affine4`, `fold4`          | LIVE as compiled and routed: the session-materials flow admits them — an optics-authored session compiles the transport, the lane and the buffers (agreement rows: radiance ≤ 1.1e-4, residual ≤ 3.2e-4, normals ≤ 6.6e-3 against the f64 twin). NOT optically resolving on IFS geometry with the estimator backend: every transport sample is unresolved on hits (the renderer envelope's finding — the estimator-march boundary query has no inside traversal), marked `vacuous-inside` per row. The CLOSED-SOLID backend (`opticsBackend: "closedSolid"`) over the condensation union RESOLVES in both dimensions — the envelope's closed-solid arms meet every delegated line with real resolved counts (3D 5,769 / 4D 7,856 at the settle), and the agreement legs pin the signed query against the f64 twin (`resolving` rows) |
| compute `fold` (3D frontier)                  | MEASURED REFUSAL on real hardware: a fold transport invocation exceeds the kernel driver's GPU-job timeout at every budget that exercises the work-list (`ring gfx_0.0.0 timeout`, GPU reset, every attempt — the width-12 frontier's dynamic indexing spills to scratch inside the transport's deep call nesting, the kernel module's own frontier-spill precedent, and the spilled per-eval cost puts any full trace past ~10 s on the RX 7900 XTX). Routing strips the gate (`admitOptics: false`) so a fold session renders classic, disclosed. Reopens on a spill fix or a per-invocation time bound                                                                                                                                                                                                                            |
| compute `escape`, `bulb`, `escape4` (forward) | Kernel emitted and bench-pinned (the agreement legs); ROUTING does not admit the families — the slot resolver's `admitOptics: false` strips the gate, so an optics-authored forward session renders classic, disclosed. The estimators are heuristics, not certified lower bounds: the legs pin the kernel's arithmetic, not the material's optical soundness                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| GLSL tracers (`surface-material*.ts`)         | Dormant; the GLSL twins arrive after the compute backend (a no-compute device's fallback renders classic, disclosed)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `lens` wrapper, both dimensions               | Composes — the boundary query rides the wrapped estimator                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `balloon` (3D/4D)                             | Composes over the union estimator, disclosed envelope; the shell inherits the argmin slot's material                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `ground plane`                                | Composes — the floor is a rear-scene terminal                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Cinematic lighting                            | EXCLUSIVE (throw)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Surface applicability gates                   | Unchanged — authored optics adds NO new admission                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## What is not yet qualified

The compute kernel emission and the host buffer contracts are real state;
the capability matrix above records exactly how far each consumer has come.
The boundary query's INSIDE traversal has LANDED for the closed-solid
backend — the envelope's closed-solid arms resolve in both dimensions with
every delegated line met — so the first blocker is cleared. What remains,
in order: the fold core's transport (the measured timeout, three recorded
paths — the closed-solid backend is now DOUBLY motivated for the
finite-construction path, being its own recorded scope); the GLSL twins
(`.7`, inheriting the transport and the same disclosure); rear-scene
radiance and transparent visibility (`.8`, gated on reflections that
re-enter the object — the closed-solid query now provides the inside
traversal those need); distortion and capture integration; panel material
and starter scenes (`.10` — whose app routing must carry the closed-solid
backend's pose admission: the 4D field is exact where the displayed slice
carries the flat, and the wiring must pin the canonical composition or
derive it); built-app qualification (`.11`). The estimator arms' IFS
vacuity is disclosed, not solved — IFS geometry has no closed solid for
the signed field to describe. Shader changes require the corresponding
CPU/GPU agreement gate even before production routing is enabled; the 22
GPU controls are the pattern. Applicability refusals
(slab/forward/balloon/engine admissions) are preserved unchanged by this
work.

## Reproduce

```bash
npx vitest run src/fractal/surface-dielectric.test.ts
npx vitest run src/app/gpu-bench/surface-transport-fixture.test.ts
npx vitest run --config scripts/vitest.harness.config.ts \
  scripts/transmission-dielectric-solid.harness.ts \
  scripts/transmission-dielectric-tree.harness.ts

# The compute backend's agreement legs (quiet real driver, X cookie):
export XAUTHORITY=$(ls -t /run/user/$(id -u)/.mutter-Xwaylandauth.* | head -1)
export DISPLAY=:0
glxinfo -B | grep "OpenGL renderer"   # must NOT be SwiftShader/llvmpipe
npm run bench:surface -- --display=:0

# The real-app invalidation sweep (built app, quiet real driver):
npm run build && npm run preview &
node scripts/surface-transport-invalidation.verify.mjs --display=:0
```

The unit suite pins the optics (including the emitted `js` dialect executing
bit-identically to the f64 oracle), the transport oracle over analytic
interval/shell/posed-4D scenes, chunked bit-identity, the replay schedule and
the emission canon. The harness runs re-verify the qualified scalar pins
against the re-exported optics. The bench's `transportAgreement` rows are
the compute backend's per-core record: the kernel's own
`transportNextBoundary`/`transportTrace` against `surface-transport-fixture.ts`'s
f64 twin, fail-closed, with the forward cores' chaos exclusions disclosed
per row (the ULP-ensemble classifier, escape legs' treatment), the fold
core's measured device-loss skip recorded in the run's notes, and each
row's `backend`/`opticsSoundness` pair naming what the agreement
certifies (the closed-solid rows pin the signed query in both
dimensions). Measured
2026-09-14 on the RX 7900 XTX / radeonsi: six of seven cores agree
(radiance ≤ 1.1e-4, residual ≤ 3.2e-4, normals ≤ 6.6e-3); pristine main
reproduces the SwiftShader device-loss at an unrelated early leg, so that
finding is environmental. The `transportEnvelope` rows are the renderer
lane's record (the section above): the production renderer at the
delegated preview/settle rasters against the decided envelope's lines,
plus the mid-flight cancel probe and the byte-identity repeat — skipped
on software adapters, gating on real ones.
