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

Two resumption layers, both contract:

1. **Work chunks (CPU oracle and finite WebGPU transport).**
   `dielectricTraceStep` processes a bounded number of paths and leaves the
   live stack intact; a chunked run visits
   paths in exactly the uninterrupted order and reproduces it bit-for-bit.
   This is the randomized-chunking acceptance property. Finite WebGPU traces
   likewise pause between complete paths, preserving the stack, accumulators
   and counters in bounded batch storage at the same replay threshold. Other
   GPU backends retain their uninterrupted per-invocation trace.
2. **Replay passes (outer GPU refinement).** A sample that misses the per-sample
   budget keeps its pending identity and is re-traced FROM SCRATCH at the next
   pass's halved theta (`dielectricReplayTheta`). A sample whose trace FAILED —
   a guard or a boundary query's refusal — is final unresolved at that pass,
   not replayed: a halved theta keeps an ancestor-closed superset of the paths,
   in the same relative order, so it re-creates the failing path and fails
   again (`DIELECTRIC_REPLAY_PASSES` carries the argument; the measured saving
   is in `docs/sphere-inversion-family.md`, "The transport's cost"). Nothing
   crosses passes except the pending mask, the accumulated radiance/residual
   of accepted samples, and the invalid mask. This is what the qualified
   study kernel implements per tile pass; its cancellation probes establish
   that a fresh-device follow-up reproduces the baseline bytes. Production
   checks cancellation at each submitted batch's fence, including each finite
   continuation chunk. The frame token invalidates a canceled job; a separate
   renderer-wide batch generation validates finite slot identity and stays
   fixed across chunks. Neither generation is the replay-pass index.

**Continuation payload.** The oracle's `DielectricTraceState` is a plain data
record: per-live-path `origin`/`direction`/`throughput`/`inside`/`interfaces`/
`anchor`/`bound`, plus `radiance`, `residual`, `processedPaths`, `status`,
`failure`, `theta`, `limits`. The production GPU per-pixel record is two
`vec4f`: linear radiance.rgb plus residual, then status, failure kind, boundary
refusal reason and replay-pass index, each encoded as f32. A separate packed
u32 status per dispatched slot drives the host's pending list and terminal
counts; finite failures use its upper bytes for the failure kind and reason.
The frame token and finite batch generation are separate from that record.
The live stack remains shader-private for uninterrupted GPU traces; finite
chunks serialize it into bounded batch storage, and CPU chunks retain it in
the oracle state. A backend adopting the emitted optics must keep every threshold, bound and
compositing line in THIS module's text — no restated constants.

**Diagnostic readback.** `transportReadback: true` requests the completed
sample's eight raw u32 words per pixel, preserving the f32 bits. The existing
transport record buffer permits `COPY_SRC`; only a requested readback allocates
temporary `MAP_READ` staging, destroyed after copying or cancellation. Normal
rendering does not perform this readback. `onSample` observes each completed
AA sample before averaging; a multisample result carries only its last
sample's raw record. Canceled diagnostic jobs return null.

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
  radius BASE is scene-derived — the finite construction's root half extent,
  matching the selected study, or the session DE's `visibleBoundingRadius`
  for other families. Both are independent of the current 4D slice, so the
  tint does not pulse as the slice scrubs. The finite enclosing sphere remains
  a separate geometry bound. There is no scene-wide authored
  optical state. Weight-zero transforms and the final (plot-time) transform
  contribute no slot, so their authored optics resolve nowhere — the
  material's own invisibility rule, not a special case.
- **Units and defaults.** `scale` (the only authored numeric) is the Beer
  normalization radius as a DIMENSIONLESS MULTIPLIER of the derived radius —
  world-defined, stable under zoom, raster and rotor/slice motion. Absent ⇒
  1, matching the selected finite material's normalization; other families
  retain their existing radius-relative material. The resolver clamps into
  `[0.01, 100]` (`SURFACE_OPTICS_SCALE_FLOOR`/`_CEILING`), where the floor
  is tint saturation inside 1% of the ball and the ceiling is clear across
  the whole ball — both indistinguishable beyond, and the clamp keeps the
  oracle's `radius > 0` assertion satisfied. The resolved slot material IS
  the oracle's `DielectricMaterial` (`surface-optics.ts`'s
  `ResolvedSurfaceOptics` alias), so a backend hands it to the transport
  with no adapter.
- **Not authored.** IOR and the per-channel absorption ride the qualified
  constants as defaults; the restrained optical distortion IS authored —
  `optics.distortion`, ONE dimensionless word (the virtual slab's thickness
  as a multiplier of the resolved optical radius), absent ⇒ 0 = straight
  transmission byte-identically, resolver-clamped into
  `[0, SURFACE_OPTICS_DISTORTION_CEILING]` (0.25) — and it rides the lane
  pair's first reserved word (see below). Work and chunk budgets (processed
  paths, interfaces, stack) stay OUT of material identity: they are the
  runtime's, not the document's.
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
absorption.g)`, lane 1 `(absorption.b, distortion, reserved,
reserved)` — zero-stride padded when no slot resolves optics, and thrown
  on a list that resolves optics non-uniformly. The distortion word is
  the restrained virtual slab's thickness multiplier (zero = the straight
  state); the two remaining reserved words belong to future approved
  fields — appends inside the frozen stride, never a relayout. The
  dimension-free layout is THE 4D half: one buffer, one lane order, both
  cores' backends.

### Capability and routing matrix (historical, before backend integration)

At this stage authored optics was DORMANT everywhere: no kernel or fragment
program consumed the model, so every session — whatever it authored — routed and
rendered exactly its pre-optics program, and an optics-only session compiled
the classic kernels with classic shadeMaps bytes (the shadeMaps packer's
materials argument stayed keyed on finish|pattern). The gate already existed
(`SurfaceMaterialSlots.optics`, the slots' resolved materials, the
force-frame key's `optics` block), ready for the later backends to consume
without redefining it. The following matrix records that earlier state;
the backend and routing sections below describe the current implementation.

| Core / wrapper                                | Transport status at that stage                         | Reason                                                                                  |
| --------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| compute `affine`, `fold` (3D)                 | Dormant; classic bytes unchanged                       | The resumable WebGPU transport is the next epic item                                    |
| compute `affine4`, `fold4` (4D)               | Dormant; same layout, same reason                      | The lane pair is dimension-free; the 4D backend adopts it in the same epic              |
| compute `escape`, `bulb`, `escape4` (forward) | Dormant                                                | Forward-orbit admission is a measured question for the backend work, not a free default |
| GLSL tracers (`surface-material*.ts`)         | Dormant; lanes ride classic values, defines unchanged  | The GLSL twins arrive after the compute backend (`dielectricOpticsSource` spliced then) |
| `lens` wrapper, both dimensions               | Dormant; zero transmission stays classic through it    | The wrapper composes whatever the wrapped core admits — nothing new to refuse yet       |
| `balloon` (3D/4D)                             | Dormant; the shell inherits the argmin slot's material | The forward-orbit echo stays plain until the backend's material attribution lands       |
| `ground plane`, `shape trap`, condensation    | Dormant; no change                                     | Scene furniture and attribution are the backend's business, already contract vocabulary |
| Surface applicability gates                   | Unchanged                                              | Authored optics adds NO new admission: eligibility is geometry, as before               |

Every planned capability above carried both dimensions. The panel UI was
still pending; the recorded placement was beside Finish/Pattern in the shared
Transforms editor (Scene / Look), per `docs/panel-ia.md`.

## The compute backend (shipped)

`surface-de-gpu.ts`'s `optics: true` (shade mode) emits the transport beside
the classic entries, and `surface-compute.ts` drives it as its own lane when
the session's wire gate is live. The decisions recorded here are the
delegated numeric working lines — each reversible with its evidence; the
appearance selection stays the owner's and is untouched.

### The estimator backend's boundary query

The qualified fixture's boundary query is EXACT (integer cell planes). The
production estimator backend's is a bounded march of the COMPOSED PUBLIC estimator —
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
  marching, and treats a crossing whose hit point lies within
  `DIELECTRIC_ANCHOR_ENVELOPE_REL` (4·eps) of the anchored point as the
  same boundary — MEDIUM-AWARE: suppressed only while the claimed medium
  continues beyond the landing (a union's corner region puts a DIFFERENT
  face within the envelope, and the distance test alone ate an honest exit
  crossing there, hopped the child outside with a stale medium and
  stranded it). Gaps narrower than the envelope merge optically; a long
  grazing stretch burns the step budget and refuses. Two earlier primary
  treatments were measured and discarded: a display-tolerance restart
  skip on the primary refracted child (the anchor-skip wire — it jumped
  the entry region and stranded edge hits of small cells outside their
  solid entirely; measured on the lone-box probe 19%→44% resolved when
  removed, and the wire is gone), and a secant re-landing of the primary
  child origin on the true surface (at an edge the smoothed normal faces
  away from the approach and the landing cannot fire; re-sampling the
  split normal at the landing re-drew the corner normals for a net loss).
- **The crossing lands ON the surface (the closed-solid backend).** The
  band touch advances by one secant step along the ray with the field's
  own gradient (`run = −f/dN`, clamped to the band's own scale), not the
  old band-edge advance (`max(f, 0)` along the ray), which left the hit
  short of the surface by `f·(1−cos)` for oblique approaches — the
  grazing TIR crawl's children drifted across their wall, whose phantom
  band crossings stalled into the caps or escaped the solid entirely. A
  touch whose zero is not ahead of the query point (heading deeper, or a
  tangency) is not a crossing: the query steps past the band and keeps
  marching.
- **The interface's media derive from the segment geometry (the
  closed-solid backend).** Each boundary event's from/to media come from
  which side of the surface the traversed segment started on
  (`dot(origin − childOrigin, n) < 0`), not the inherited medium flag —
  on every honest event the two agree exactly, and on a stale one the
  geometry re-anchors the split (the crawl's phantom events re-enter the
  glass instead of escaping as TIR children of a medium the field no
  longer agrees with). The path's `inside` flag stays the claimed medium
  the query cross-checks. The ONE exception to "an inside miss is
  unresolved": the primary refracted child (interfaces = 1) — the display
  march's acceptance band catches near-miss grazes at silhouettes and
  cell edges, whose refracted child misses the solid entirely; the ray
  slipped past the glass and the honest terminal is the rear scene
  behind it.
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

**The face-abutting control (2026-09-20).** The one arrangement the
separated-primitive fixtures could not reach: two half-unit boxes at
x = ∓0.5 sharing the plane x = 0, where the min-union field reads exactly
ZERO while the point is interior to the optical solid. Measured through
the CPU twin in BOTH dimensions (`condensation-abutting.test.ts`, the
4D canonical identity pose reproducing the 3D figures digit for digit):
every ray completes in the abutting system with the same status as the
one-spanning control of the same combined solid — no unresolved, no
refusal, complete accounting — and per-ray radiance agrees to ≤ 2.1e-5
(relative ~4e-5) on a uniform backdrop. The interior zero is NOT
invisible to the boundary query: the abutting traces record 18 boundary
events where the control records 4 — the shared plane's crossing band
fires, the tap gradient there is dominated by the deep member, and the
event reads as a glass→air interface whose reflected child recirculates
and escapes through another face — but the recirculated energy is
direction-independent against a uniform backdrop, so the optical result
carries no seam at the 1e-5 level. The transport legs carry the abutting
arm (`closedSolidAbutting3`/`4`) pinning the kernel to the same behavior
on the real driver; the limitation this control was built to catch —
phantom unresolved work or a radiance discontinuity at the shared plane —
did not reproduce.

**The abutting leg's analytic control found a real defect (2026-09-20,
same day).** The bench's first abutting run failed its shadow analytic
control — not a kernel↔twin disagreement (they agreed to 4e-8) but the
independent one-pair formula catching BOTH engines paying the same
interface pair TWICE. Mechanism: the shadow march's declared crossing
band is |f| < eps in FIELD value, but the SAFETY-scaled field's gradient
at a perpendicular face is 0.9, so the band is ±1.11·eps wide in SPACE —
wider than the fixed `2·eps` post-crossing skip; a fire on the band's
near side re-fired one sample later and paid a second (1−F0)² (measured
on the abutting through-box: one pair gives 0.8295, the march read
0.7740; the f64 twin reproduced both figures, so the kernel was faithfully
mirroring a twin defect). The same mis-pairing had been silently zeroing
the grazing TIR control at its ENTRY band — a spurious exit at grazing
incidence hit TIR and broke the ray before the sphere's interior — which
is why the 24-step budget "passed": it never had to carry an honest
grazing traversal. Fix, in all three texts and the twin (the WGSL
kernel, the shared GLSL `surfaceSolidShadowSource`, and
`transportShadowVisibilityCPU`): after firing a crossing, advance in
2·eps sub-steps until the sample reads |f| ≥ eps, bounded at four
sub-steps (a graze along a wall can hold |f| < eps indefinitely; the
guard surrenders to the march's own budget). The shadow step budget
rises 24 → 48, measured: the honest grazing TIR traversal spends 36
steps between its entry and exit bands. The bench leg's analytic control
now takes the chord from the leg's own fixture geometry (0.7 the
separated sphere, 1.0 the abutting through-box) — the transport formula
stays independent; the old condition keyed on the probe's shape, which
both fixtures match, and would have failed even correct abutting physics.
A regression test pins the one-pair value on the abutting fixture
(`surface-transport-fixture.test.ts`). Re-run verdict (quiet RX 7900 XTX,
same day): `surfaceDe` PASS — both abutting arms resolve in kernel↔twin
agreement (radiance 1.45e-8, residual ≤ 2.37e-8, normal ≤ 5.96e-8,
shadow 1.68e-4, displacement ≤ 4.39e-7, both dimensions), the analytic
controls green on their own fixture chords, and the finite envelopes are
unchanged (the finite backend never compiles this march).

### The rear-scene contract (delivered), and the straight shadow visibility

`transportRearRadiance(origin, direction)` is the rear scene's ONE seam, and
its terminal order is now CONTRACT, resolved in physical ray order:

1. **Later fractal hits** are the transport's own boundary events, resolved
   by the work-list BEFORE any miss — the union's other lobes enter and exit
   through `nextBoundary` with the trace's material, never through the rear
   scene. By the time a path reaches `rearRadiance`, its boundary query has
   proven the remaining finite scene interval (the domain
   `transportDomainExit` returns) free of the displayed object — for the
   closed-solid backend the signed field certifies it directly, and for the
   estimator backend the query's crossing test is LOOSER than a display hit
   (it crosses at the optical scale, strictly earlier), so a miss still
   certifies the interval empty at display resolution. Both shipped
   backends' misses therefore certify the interval: the rear march that a
   NOT-co-extensive backend would owe this seam is deliberately NOT emitted
   — dead machinery for both shipped backends — and the seam stays the one
   function that grows if a future backend's boundary query stops being
   co-extensive with the displayed object (per-slot mixed materials are the
   first candidate).
2. **The analytic plane** (when the session has a floor): the shade entry's
   own `shadeGroundPlane` floor shade, linearized by the file's 2.2
   convention. The plane lies below the whole session ball, so every
   downward transport path crosses it after the domain exit — the terminal
   order above is physical by geometry, not by extra marching. "A plane
   beats the environment where it intersects" is the floor's radial fade:
   inside the fade band the floor's own shading (albedo, checker pattern,
   emission) is the terminal; past it the floor IS the background.
3. **The procedural background**: the pixel's own backdrop — the same
   full-image `bg` the seed's miss path writes — linearized.

The four outcomes stay DISTINCT: a true miss (the interval certificate),
the plane terminal, the background, and an unresolved tail. Exhaustion is
never relabelled — the transport's own unresolved statuses keep the pixel
dark with the frame's counts disclosing them, and the corridor's bounded
admission (below) keeps its partial result rather than fabricating an
occluder or a clear sky.

**The plane terminal's shadow corridor now attenuates STRAIGHT through the
optical solid** (both engines, both dimensions, closed-solid only): the
corridor's penumbra march reads the DISPLAYED object as an opaque occluder,
which is the glass itself in a closed-solid session — the black slab
silhouette under the glass the rear-scene task calls the falsely-solid
defect. Under `opticsBackend: "closedSolid"` the corridor replaces the
penumbra march with `transportShadowVisibility(hp, lightDir, ballC, ballR,
visR)`: a bounded march of the SIGNED field along the UNREFRACTED shadow
ray, pairing the solid's crossings — each entry pays `(1 − Fresnel)` into a
per-channel transmittance, Beer attenuates over the traversed interior,
each exit pays `(1 − Fresnel)` again, and a total-internal-reflection exit
contributes nothing straight through (the light exits elsewhere — a caustic
this model does not promise). The crossing is the declared band
(`DIELECTRIC_CROSSING_EPS_REL`), with the anchor suppression's own 2·eps
skip past it; the strides step the certified field's |f| on both sides, so
no stride can overshoot the boundary and the band is always sampled. The
corridor's analytic gates (ball-behind, closest-approach clearing
1.05 R + 0.3·along) ride inside the helper as the fast path that certifies
transmittance 1 with zero field evals. Bounded work:
`SURFACE_GPU_TRANSPORT_SHADOW_STEPS` (24) paces the march, and an exhausted
march returns the transmittance accumulated so far — an over-report,
disclosed, never a fabricated occluder. The floor's AO stays geometric
(the glass occludes ambient like any body at its declared resolution — the
recorded approximation; making AO transmission-aware was measured worth
neither its cost nor its risk). The material is slot 0's resolved optics
lanes: a session's lobes may carry per-slot scales, and the corridor reads
the session's first slot — the recorded attribution approximation. The
floor's shadow is therefore Beer-TINTED, not scalar: the lighting line
multiplies the vec3 transmittance into the same lit term the classic
penumbra fed.

Deliberate lighting approximations, all recorded: shadow rays are STRAIGHT
(no refraction, no caustics, no multiple-bounce); a TIR exit reads as dark
along that ray; the corridor's material attribution is slot 0's; AO stays
geometric; budget exhaustion over-reports. "Ordinary and cinematic"
coverage follows the supported combinations: the transport is exclusive
with cinematic lighting (both entries own the hit path's output — the
refusal stands, unchanged), so the rear scene's shading is the ordinary
finish path's shared math (`shadeGroundPlane`, the shade entry's own
lighting), and the legacy gamma-space transmit fade stays confined to its
backward-compatible path — the cinematic path's linear-light fade is its
own convention, untouched.

**The rear-image contract, for the distortion task.** The rear scene has
NO screen-space state: the terminal's radiance and its terminal identity
(plane at distance `t`, or the background at infinity) are derivable at
the seam from `(origin, direction)` alone, and capture bands are
independent by construction (each band renders its own rays at their
full-image NDC positions; two decompositions of one raster agree
byte-for-byte). The FIRST-LOCAL-CONTRIBUTION separation is structural and
must not be blurred: the front interface's Fresnel split (the first local
contribution — the reflection term a compositor must not displace) is
carried by the path tree's THROUGHPUT, while every terminal composites
`throughput · rearRadiance` — so a rear-image distortion applies to the
terminal rear radiance only, and the front split survives it untouched.
The per-sample environment bound stays the qualified 4
(`DIELECTRIC_ENVIRONMENT_BOUND`), which bounds this rear scene with margin.

### The restrained rear-image distortion (shipped)

The accepted bounded distortion model is the bend study's WORLD-SPACE
DISPLACEMENT CONTRACT (`docs/surface-transmission-revision.md`), now owned
by the oracle: `dielectricSlabDisplacement` — the virtual parallel slab's
lateral offset `thickness·(eta/ct − 1/c)·v` in the smoothed interface's
tangent plane, smoothly saturated (`maxOffset·tanh(raw/maxOffset)`, the
tanh argument clamped at 40 so all three dialects agree), with the bound
TIED to the thickness so the lateral offset never exceeds the authored
slab. The bend study's own helper is a re-export of the oracle's (the
optics re-export proof discipline), so the study's panels and the
production transport run the same f64 arithmetic. IOR 1, zero thickness, a
zero normal, and a degenerate tangent (normal incidence) produce no
displacement — the deterministic fallback, never a NaN.

**Where it applies — the terminal seam only.** A path carries `exited`
(the kernel's `exitPresent`): true ONLY on the transmitted child of an
exit crossing, reset on every other child, so a mirror view at a later
entry never displaces. At a miss-while-outside terminal of an `exited`
path, the transport displaces the REAR QUERY's ORIGIN by the slab offset
computed at that exit point (the path's origin there IS the exit point —
the ray origin moves only at events) and evaluates `rearRadiance` from
the displaced origin, direction unchanged. The origin-only form is the
parallel slab's exact ray-space reading: a parallel slab translates the
emergent ray without bending it, so the direction-only background terminal
is shift-invariant (exactly unbent) and the structured plane terminal
carries the bend. The front Fresnel split rides the throughput and is
never touched; the geometry queries never saw the displacement; unresolved
tails stay dark. The smoothed normal is the displayed field's gradient by
the SAME tetrahedron-tap discipline as the crossing normals, at
`DIELECTRIC_DISTORTION_NORMAL_REL` (0.04) of the material's radius — the
study's coherence lesson, ~20× the declared crossing scale — read over the
SAME field the boundary query marches; a vanishing gradient or a
non-finite tap is the deterministic straight terminal.

**Capture bands stay independent BY CONSTRUCTION**: the displacement is a
pure function of per-path state, the per-slot material and the scene
field — no screen-space state exists to wrap, clamp or read. The app-level
tile-gate leg (distorted rays crossing every band edge in the built app)
has LANDED with the routing (2026-09-18, the app-routing section's export
tile: byte-exact in both dimensions with the distortion authored, the
transport pass lines asserted so it cannot pass vacuously).

**The zero byte-identity.** Distortion zero (the absent field's resolved
value) never executes the displacement: the branch is on the lane word,
dynamically uniform, and the straight terminal's arithmetic is unchanged —
pinned by unit tests (oracle radiance `toEqual`) and by the digest's
untouched non-optics keys.

Measured (quiet RX 7900 XTX / radeonsi, 2026-09-17): the agreement legs'
mode-3 terminal-displacement probes pin the kernel's smoothed normal and
slab offset against the oracle's helpers over the closed-solid fixtures —
`maxDisplacementDelta` 4.3e-7 (3D) / 8.2e-7 (4D) against the 3e-3 pin —
and the distortion-carrying trace probes keep the status/residual
agreement intact with the branch live. The envelope's closed-solid arms
now author the qualified working value (0.08) and resolve unchanged
(3D settle 710 ms, 5,769 resolved / 4D 759 ms, 7,856, byte-identical
repeats) — the distortion's per-exit cost (four field taps + scalar math)
prices below the frame's noise. The one-time kernel compile grew with the
transport text (closed-solid legs ~59→591 ms / 43→665 ms create-time;
never per-frame). The GLSL resolved sizes: the optics-on arms grow ~4.8 KB
(4D optics-est 92,485 B, optics-solid 104,901 B — already stripped; the
emitted form stays ~1/3 of that, far under the Mesa cliff); the OFF arms
are byte-unchanged (4D off exactly 64,679 B as recorded).

### Resumption, scheduling and truthfulness

- **The tally line is the lane's frame verdict.** `?surfacetrace`'s ring
  carries one `transport done final resolved=N unresolved=M (cumulative
…) passes=K` line per rendered AA sample. Accepted, unresolved and invalid
  rays leave the pending queue once, so cumulative terminal counts do not
  recount retries; the final and cumulative labels report the same terminal
  partition. Qualification requires every expected AA sample to be complete
  and untruncated; a pending retry is not an unresolved terminal sample.
  The invalidation sweep, envelope leg and resolve gate read this permanent
  ring vocabulary together with the sample's completion evidence.
- **Replay passes refine; finite chunks resume.** Per pixel the record is two
  vec4f (radiance.rgb + residual; status/failure/reason/replay-pass index); the
  seed zeroes it per AA sample. A pass dispatches batches of rays; each still-
  pending sample re-traces FROM SCRATCH at the halved theta; accepted
  samples (per-sample residual ≤ `DIELECTRIC_ERROR_BUDGET`) overwrite the
  pixel and never reprocess. Six passes and a still-pending sample is
  final UNRESOLVED, and so is a FAILED trace at the pass it fails (a guard
  or a refusal recurs under every smaller theta); a non-finite outcome is
  final INVALID; both go BLACK —
  never background — and the sample's counts disclose them. A finite trace
  may pause within a batch at the same theta; its ray list and batch generation
  remain fixed until all its slots finish. RUNNING is internal to those chunks,
  never a completed census or permission to advance the replay pass. Frame
  token invalidation cancels the whole job, independently of either index.
- **The lane is the dispatch discipline.** HIT rays take BOTH the classic
  shade queue (which skips optics slots after the one hit-info the slot
  attribution needs) and the transport queue (which skips classic slots
  after the same check) — the optical work is its own submissions, never
  buried inside a shade or march dispatch, priced by its own measured
  sizer. The estimator/closed-solid runtime caps
  (`SURFACE_GPU_TRANSPORT_MAX_PROCESSED_PATHS` and `MAX_INTERFACES`, both 2048) remain below the oracle's defaults because their boundary queries
  cost more per path. The exact finite DDA uses the already qualified
  `DIELECTRIC_MAX_PROCESSED_PATHS` allowance, 16384; applying the expensive
  estimator's lower guard to this backend truncated valid paths after the
  geometry correction. Explicit bench caps still override either default.
  These are work limits, independent of the unchanged per-sample optical
  error budget. A capped sample stays unresolved; cost and completion must
  both pass the relevant backend's measured envelope.
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

The routing has LANDED (2026-09-18) and these fixtures stay on the
ESTIMATOR query by its own rule — they are map-bearing IFS systems, not the
closed-solid vocabulary — so the sweep drives the estimator query: the lane
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

### The GLSL twins (fragment tracers)

Both fragment tracers splice ONE shared math text — `surfaceTransportSource`
in `surface-material.ts`, parameterized only by dimension — emitting the
optics body verbatim, the kernel's runtime vocabulary and caps, the domain
exit, the optical normal, the boundary query (both backends), the rear
scene and the oracle's work-list trace, after every public-DE redefinition
so the query marches the composed object (rotor/slice, lenses, balloon,
tiling compose as they do for the primary hit). The decisions recorded here
are the delegated working lines; the appearance selection is untouched.

- **The replay schedule runs INLINE per invocation.** The contract's replay
  shape — re-trace from scratch at the halved theta, accepted paints
  2.2-encode + the hit fog, invalid never retried, a failed trace final at
  its first failure, exhausted and invalid
  black never background — is driven per pixel inside one fragment
  invocation rather than across dispatches: the strip pump renders whole
  strips statelessly (every strip is a complete re-trace), so nothing needs
  to cross passes, and the cancellation boundary is the strip draw. The
  compute lane's cross-pass record pair stays COMPUTE-only state.
- **The per-slot lane pair.** 3D declares `uMapOptics[2 * MAX_MAPS]` in the
  default block, inside the arm (no other variant pays); 4D appends it as
  the std140 block's UNCONDITIONAL trailing member (the finish pair's
  discipline — no earlier offset can ever move), costing every 4D program
  ~1.9 KB raw, which pushed the plain+finish arm over the strip threshold;
  the tightest unstripped 4D margin is now the bare off arm at 64,686 B.
  `setSurfaceMaterials`/`setSurface4Materials` grow the wire's third gate
  with the packer's own rules: uniform slot coverage (a mixed wire is the
  packer's thrown error on every engine) and the fold-shaped descent's
  refusal — the kernel's measured frontier-spill timeout enforced at the
  gate that would compile it. A stale optics define cannot survive a system
  swap onto a fold shape or a forward arm.
- **The software-rasterizer strip.** On SwiftShader the 4D optics arm
  compiles and then KILLS the renderer on the first surface frame (the 3D
  arm happened to survive), so a WebGL-routed session on a software
  rasterizer re-derives its wire with the optics gate off at both route
  points — classic, disclosed, never a crashed page. A hardware-GL fallback
  keeps the lane; the compute route is untouched.
- **Measured.** Optics programs cost ~20.8 KB resolved / ~12.2 KB emitted
  over the 3D affine base (stripped, far under the Mesa cliff). Real-driver
  verification (RX 7900 XTX / radeonsi): the estimator-arm fixtures reach
  their first frame in ~2 s in both dimensions with the lane live, painting
  the disclosed vacuous-inside black; the closed-solid arms compile and
  render through the routing (2026-09-18: the app selects closedSolid on
  the admitted compositions, the section above). Absent optics resolves
  byte-identically against the pre-change module on every descent arm.
- **The real-browser gate rows.** `scripts/surface-optics-glsl.verify.mjs`
  (--display=:0, real driver) traces the settled ?surfacegl frame per
  dimension — the optics-authored fixture and its optics-stripped twin
  (derived in-script, round-trip checked) — and asserts the engine is
  WebGL on hardware, the live frame carries the lane's near-black
  signature, the stripped control renders classic, and the two frames
  differ STRUCTURALLY across the object. MEASURED (1024x640, settled):
  live near-black 14.08% (3D tetra) / 0.32% (4D w-slice) against stripped
  ~0; structural diff 16.5% / 8.0%, max delta 249. A near-black frame on
  IFS geometry is the estimator backend's disclosed vacuous state, not a
  glass render — the gate pins that the lane REACHES pixels, the same
  premise shape the sweep's compute census proves.
- **The invalidation sweep's WebGL lane.** The sweep's `--lane=webgl` runs
  the same arms (settle+reload byte identity, mid-trace edits, mode exit,
  restart storm) against the GLSL twins with engine=webgl asserted and the
  near-black signature as the lane-live observable; the device-failure arm
  stays compute-only (the GPU-process kill takes every GL context with it).
  MEASURED (all arms PASS, both dimensions): byte-identical reloads, live
  signatures after every edit/exit/storm (the 4D slice edits read 0.21% at
  the edited poses — the floor sits under it), no uncaught errors. The
  extension's earlier session had debugged an all-miss diversion on this
  path; the committed apparatus + committed fixtures do not reproduce it on
  either browser (bundled Chromium and system Chrome both render the full
  14.08% signature through the sweep's own newPage/settle path — the
  diversion was that session's unreverted overrides, and the
  software-crash finding is the reason the lane is INCONCLUSIVE, not
  failed, on software rasterizers).

### Capability matrix, updated

| Core / wrapper                                | Transport status now                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| compute `affine`, `affine4`, `fold4`          | LIVE as compiled and routed: the session-materials flow admits them — an optics-authored session compiles the transport, the lane and the buffers (agreement rows: radiance ≤ 1.1e-4, residual ≤ 3.2e-4, normals ≤ 6.6e-3 against the f64 twin). NOT optically resolving on IFS geometry with the estimator backend: every transport sample is unresolved on hits (the renderer envelope's finding — the estimator-march boundary query has no inside traversal), marked `vacuous-inside` per row. The CLOSED-SOLID backend (`opticsBackend: "closedSolid"`) over the condensation union RESOLVES in both dimensions — the envelope's closed-solid arms meet every delegated line with real resolved counts (3D 5,769 / 4D 7,856 at the settle), and the agreement legs pin the signed query against the f64 twin (`resolving` rows). ROUTED (2026-09-18): the app selects closedSolid wherever the composition admits it (`surface-optics-backend.ts`'s pure admission, the section below) and keeps the estimator everywhere else; emitter-only C0 sessions resolve in the built app in both dimensions                                                                                                                                    |
| compute `fold` (3D frontier)                  | MEASURED REFUSAL on real hardware: a fold transport invocation exceeds the kernel driver's GPU-job timeout at every budget that exercises the work-list (`ring gfx_0.0.0 timeout`, GPU reset, every attempt — the width-12 frontier's dynamic indexing spills to scratch inside the transport's deep call nesting, the kernel module's own frontier-spill precedent, and the spilled per-eval cost puts any full trace past ~10 s on the RX 7900 XTX). Routing strips the gate (`admitOptics: false`) so a fold session renders classic, disclosed. Reopens on a spill fix or a per-invocation time bound                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| compute `escape`, `bulb`, `escape4` (forward) | Kernel emitted and bench-pinned (the agreement legs); ROUTING does not admit the families — the slot resolver's `admitOptics: false` strips the gate, so an optics-authored forward session renders classic, disclosed. The estimators are heuristics, not certified lower bounds: the legs pin the kernel's arithmetic, not the material's optical soundness                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| GLSL tracers (`surface-material*.ts`)         | LIVE for the estimator backend, as compiled and routed: the shared `surfaceTransportSource` block splices the kernel's optics emission term for term over the composed public estimator, and the shade site routes optical hits through the SAME replay-pass schedule collapsed INLINE (stateless per strip; the strip draw is the cancellation boundary). A WebGL-routed session on a SOFTWARE rasterizer strips the gate at both route points — measured SwiftShader renderer crash — classic, disclosed. The closed-solid backend is ROUTED like the compute one (the same admission, one decision per session, stamped before the system install so the rebuild that carries the optics define compiles the signed query over the condensation shapes that install stamps; the inactive dimension's material is reset to the estimator because the tail's materials install flips both defines and only the active one carries shapes). Both starters settle with the closed-solid GLSL arm on a hardware rasterizer (`?surfacegl`), 3D and native 4D, error-free. A fold-shaped descent refuses the transport at the gate that would compile it (the kernel's measured frontier-spill timeout); the forward arms refuse at the resolver |
| `lens` wrapper, both dimensions               | Composes — the boundary query rides the wrapped estimator                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `balloon` (3D/4D)                             | Composes over the union estimator, disclosed envelope; the shell inherits the argmin slot's material                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `ground plane`                                | Composes — the floor is a rear-scene terminal whose shadow corridor attenuates STRAIGHT through the optical solid under the closed-solid backend (the corridor fix; the estimator backend's corridor stays the classic opaque penumbra, covered by the disclosed vacuous state). The slab query's own field reads the center plane (`transportSolidField` embeds `w0`), so a slab session's corridor is the center-plane field's — the backend's slab admission is the routing task's question, not this corridor's                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Cinematic lighting                            | EXCLUSIVE (throw)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Surface applicability gates                   | Unchanged — authored optics adds NO new admission                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

## The app routing, the panel material and the starter scenes (delivered, 2026-09-18)

The capability matrix's "live as compiled and routed" becomes literal: the
app now selects the backend.

### The routing admission (`surface-optics-backend.ts`)

`surfaceOpticsBackend` is the ONE pure decision, unit-tested, consumed by
both engines: the compute create's `opticsBackend` option and the GLSL
fallback's material stamp. It answers `"closedSolid"` only where the
qualified composition holds, `"estimator"` (the absent path's meaning,
byte-identically) everywhere else — because the backends' codegen refusals
throw at compile time, and a caller that passed closedSolid for an
unqualified session would fail the whole create instead of rendering
classic. It mirrors the codegen's own refusal list term for term and adds
the two qualifications the codegen cannot see:

- **The emitter-only shape.** The signed field is the condensation union at
  the root, so the displayed object must BE that union: `de.maps.length ===
0` (with maps, paths through the IFS part refuse `state-mismatch` — the
  honest refusal, but an all-dark material), no chaos, no schedule, no
  final transform of any kind (a plain-affine final warps the query before
  the condensation term, exactly like the fold-final lens it twins), no
  tiling, no balloon, and no mesh-bearing emitter shape.
- **The 4D canonical pose.** The 4D field is the intrinsic solid plus the
  shape flat's distance as a penalty, exact only where the displayed slice
  CARRIES every member's flat. The admission checks exactly that, in WORLD
  w units — the packer's `w0` is the normalized centre times the cloud's
  w-support (the same conversion `setSurface4View` performs; the document's
  own `sliceW` is preferred when the pose carries one, the same preference
  the decode gives it): zero slab thickness, a w-preserving rotor (both
  plane rotations avoid w), and per member a w-untouched inverse map whose
  flat lies in the slice — `invM[15]·w0 + invT[3] === 0`, the signed w
  distance from the slice to the flat. Members at ONE common world w with
  the slice on it are admitted (the penalty vanishes identically, exactly
  as at the w0 = 0 lift); the w0 = 0 lift is the one pose whose pack is
  exact at ANY cloud w-support, which is why the 4D starter pins it (a
  cloud whose members share one w has zero w-extent, and every other
  slice position's normalized round trip degenerates).

The decision is made ONCE per session in the IFS routing branches, landed
BEFORE the session's first system install so the rebuild that carries the
optics define compiles the same answer, and it never re-routes
mid-session. The 4D pose input is the view's pose at entry; scrubbing the
slice or turning a w-plane rotor afterward moves the displayed object off
the composition the field describes, and the transport degrades to its
own honest refusals — the panel's optics restriction note discloses the
coupling. A live optics wire prefers compute in 3D exactly like an
authored lighting rig, still gated on availability so `?surfacegl` stays
WebGL; on the GLSL route the admitted backend is stamped onto the ACTIVE
dimension's material before the system install (the inactive dimension's
material is reset to the estimator — the tail's materials install flips
both defines, and only the active one carries condensation shapes).

### The panel material

The Finish group's bundle select gains **Glass**, the model's selector:
picking it materializes `Transform.optics` ALONE (its finish values are
the classic set, so the document stays minimal — the transport replaces a
glass slot's shaded output and no finish number would be read), every
other bundle clears the optics, and a legacy Translucent document keeps
its thin-shell meaning untouched. Two rows follow the six finish sliders,
dormant until a model exists (the pattern rows' family gate):
**Distortion** (`0–0.25`, the resolver's own band, 0 = straight
byte-identically) and **Optical scale** (the resolver's whole `[0.01,
100]` band on a 53-point geometric grid whose centre is exactly the
qualified default 1 — the pattern scale row's construction one band
over). Both write through the per-field rule's own twin; the model is the
object's spine, never a leaf (a pure `{model: "dielectric"}` is the
qualified Glass default, and clearing happens through the bundle). The
group carries one scene-directed restriction note — the transmission
boundary as the CURRENT document sits on it (`surfaceOpticsOutlook`'s
document mirror of the routing admission): resolving finite-cell
constructions, resolving emitter scenes (naming the saved-slice coupling
in 4D), or classic everywhere else, rewritten on every eligibility
refresh so a user authoring Glass on an arbitrary system reads the
boundary before entering Surface, not after. State rides the finish
group's own timing (a row edit re-enters
Surface once at the editor's settlement boundary) and the finish codec's
wire; the transform list names the material (`Optics: Glass`).

### The starter scenes

Three whole-scene compositions ride the preset menu's one door under the
`glass:` prefix (`surface-transmission-starters.ts`, the Lit interiors'
split), all emitter-only C0 with the dielectric model and the
distortion working value 0.08 on every member and the checker floor on
(the bright rear structure the transmission and its distortion are for):

- **Glass garden (3D)** — stacked glass spheres and a posed box slab over
  the floor; the depth arrangement puts rear structure behind every
  sight line through the front glass.
- **Glass corner cells (3D)** — one emitter whose shape is the eight-box
  gapped corner cluster at ±0.28, scale 0.42: the closed-solid union's
  multi-cell traversal, deliberately labelled away from the recursive
  Menger (the adjacent Glass optgroup's **Glass Menger** preset, the
  finite-cell route).
- **Glass cells (4D)** — the hypertetrahedron's four corners, each member
  carrying a `w` scale (the non-flat degree of freedom that lifts the
  session onto the native 4D pipeline) parked at the value that keeps
  every flat in the displayed slice, with a saved w-preserving rotor
  pose (`yz` 0.42, slice `w = 0`).

A starter supports discovery; it cannot be the only scene on which the
material is correct. The unit pins each starter's eligibility, its
closed-solid admission at the saved pose (and the refusal off it), and
the share-link round trip of optics, `w`, floor and camera. The
composition review instrument is `scripts/transmission-starters.probe.mjs`
(real driver: enter from the real preset menu, settle on the latch,
screenshot).

### The app-level export-tile leg

`scripts/surface-export-tile.verify.mjs --scene=transmission` boots the
two starters' own documents untiled and under the pretended ceiling, in
3D and native 4D, with the `?surfacetrace` ring's `transport pass=` lines
asserted so the comparison cannot pass vacuously. MEASURED (quiet RX 7900
XTX, radeonsi, 900×560, 9 bands, distortion 0.08 authored): both pairs
byte-exact — 3D mean 0.0000/255 max 0, 4D mean 0.0000/255 max 0 — the
boxfold leg's bar, with the checker floor and members of several sizes
crossing band boundaries. The transport lane ran in both arms (3D
1022/726 passes untiled/tiled, 4D 1288/944). Run-to-run untiled exports
of the 3D starter are byte-identical (mean 0, max 0, three boots).

## The finite-solid optical oracle (landed, 2026-09-18)

The owner's scope correction the same day: rendering fractal shapes with a
glass finish is the only goal — the emitter-only compositions were
scaffolding. The attractor of a recursive IFS has no volume; glass is a
MEDIUM with an interior. The honest optical solid is this study's selected
object: the finite level-N cell decomposition, displayed CO-EXTENSIVELY
(the rear-scene rule's own demand), with the posed 4D hyper-Menger slice as
half the milestone, not a follow-up.

The production oracle for that object has LANDED as
[`src/fractal/finite-solid.ts`](../src/fractal/finite-solid.ts), one
construction and its query forms:

- **The construction** — the study's exact ternary grid (each axis split
  in thirds per level, a child kept when at most ONE of its coordinates is
  the middle third; 20 children/level 3D, 48 in 4D), an occupancy bitmap
  over the centred rational plane form. The 4D rule is the 3D rule one
  axis over, and the posed slice rides row-major world→intrinsic rows plus
  slice — the qualified fixture's frozen f32 pose contract.
- **The exact boundary query** — the qualified fixture's DDA (integer
  cells, analytic planes, NO distance epsilon, the anchor contract with
  the tied-plane mask and post-incident cell indices, the exact-corner
  normal convention). This is the STUDY'S oracle, not a marched min-SDF —
  the distinction the abutting-seam measurement made load-bearing: an
  interval query never marches a field, so the ~0 a min-combined union
  field reads at shared interior planes cannot produce phantom crossings.
- **The signed field** — min over occupied cells of the exact box SDF
  (outside scaled by the shared march-safety budget), for the display
  estimator and the shader mirrors; its interior-shared-plane zero is
  documented, and the transport never marches it.
- **The exact ray intervals** — per-cell slab clips derived from the
  CANONICAL grid planes (not center±half, whose 1-ulp noise splits
  touching intervals), unioned with NO optical epsilon.
- **The admission** (`analyzeFiniteSolidSystem`) — exactly the shipped
  level-1 map sets (composed through the shared affine twins; VALUES and
  signs both checked), no kaleidoscope above order 1, no warping final
  transform, level 0..2 (the proxy's certified band).

Pinned by `scripts/finite-solid.harness.ts`: the grid agrees exhaustively
with the qualified fixture's occupancy at level 2 in both dimensions; the
DDA replays the fixture's control rays and 24-ray event-chained interior
sweeps BIT-FOR-BIT (t, entering, normal, plane mask, plane/cell indices)
in 3D and posed 4D (the fixture's frozen f32 pose rows — re-deriving them
from f64 rotation arithmetic drifts by ULPs); the corner convention
reproduces the fixture's recorded tied-plane controls; the interval union
matches the proxy's box union by coverage (the proxy's own box-center
rounding splits ulp-adjacent intervals at shared planes; the plane-derived
union merges them). The display co-extension is a construction decision:
shape (A), the session renders the level-N cells, and the optical solid is
exactly what is displayed.

The following sections record the kernel emission and routing that subsequently
landed. The later geometry audit supersedes the initial termination diagnosis;
final built-app qualification and owner visual acceptance remain separate gates.

### The kernel emission (landed, 2026-09-19)

The kernel emission LANDED as `surface-finite-solid-gpu.ts` (one
dimension-parameterized source both cores emit) and the `core: "finite"` /
`"finite4"` pair in `surface-de-gpu.ts`:

- **The shading DE** is `finite-solid.ts`'s `finiteSolidDisplayDistance`
  mirrored: the CERTIFIED HYBRID — the level-1 boxes' min, each refined
  into its occupied children within `FINITE_SOLID_DISPLAY_REFINE_REL·half`
  of its own boundary. The refinement is load-bearing, not a refinement:
  the plain level-1 min reads ZERO at the axis tunnels' mouth patches
  (every wall's centre child is empty on both sides — the rule's symmetry)
  and the display march would SEAL every tunnel at its mouth plane; the
  unit tests pin the marched hit against `finiteSolidIntervals` on
  tunnel-axis rays (the exact oracle says MISS there) and on sampled rays
  in both dimensions. Both terms are certified lower bounds of the
  distance to the union, so an outside march step cannot skip the surface.
  Interior shared faces also read zero: this field is not a membership
  oracle. Primary rays now use the exact query below; the hybrid remains
  for normals and shading.
- **The primary and transport boundary query** is the exact DDA
  (`transportFiniteBoundary`), `opticsBackend: "finiteSolid"`: integer
  cells, analytic planes, NO distance epsilon, the FULL anchor contract
  (intrinsic point, tied-plane mask, plane/cell indices) carried IN and
  OUT on `TransportPath` — the anchored restart consumes the anchor,
  never a point. The medium claim is cross-checked at the anchored
  restart exactly as the closed-solid query's is. Refusal reasons map
  onto the transport's vocabulary (visit-cap/invalid/state-mismatch)
  plus the DDA's own (ambiguous-anchor, nonmonotone-crossing,
  degenerate-projected-normal).
- **The wire** is a 16-byte tail at 208 (`SURFACE_GPU_PARAMS_FINITE_BYTES` 224) or 464 (`SURFACE_GPU_PARAMS4_FINITE_BYTES` 480): `{half, level,
grid, pad}`. The grid needs NO bitmap in-shader — the ternary rule is
  pure integer arithmetic. The 4D pose IS the shared 4D tail's rotor rows
  - `w0` (the descent prologue's own convention); 3D is the identity
    pose. The cores are bindingless like bulb; the slab throws (the escape4
    refusal).
- **The agreement legs** pin the kernel against `finiteSolidDdaF32` (the
  module's own f32 TS twin — `sphereInversionF32`'s discipline one family
  over): the walk is DISCRETE, its cell sequence decided by exact tie
  tests an f64 twin cannot bracket, so the twin re-executes the WGSL with
  every result rounded to f32 over the same inputs (the probe hits are
  f32-quantized — the input contract, the frozen f32 pose rows' lesson).
  The first reported PASS allowed post-hoc decision flips, a one-cell anchor
  discrepancy, and termination-only trace checks. Those checks did not certify
  correct transport: the later driver witness found exactly the invalid anchor
  that the one-cell allowance excused. The corrected gate compares stable
  trace status, failure/reason, radiance and residual at the existing
  tolerances; requires stable resolved probes; and checks anchor masks, planes
  and cells exactly. Only the independently evaluated, pre-hoc ULP ensemble
  can exclude an unstable probe, within its existing cap. Independent f64
  continuation regressions additionally check the f32 query's mathematics.

## The general word tree's GPU half (landed, 2026-09-21)

The general construction's Phase 2 (the document's OWN maps as the cell
tree, the owner scope correction's deliverable) LANDED as
`finiteSolidGeneralDisplaySource` / `finiteSolidGeneralTransportSource` /
`finiteSolidGeneralDdaF32` in `surface-finite-solid-gpu.ts`, emitted by the
same `core: "finite"` / `"finite4"` pair under
`finiteSolid: { level, general }`:

- **The construction bakes into the source, not the wire.** The maps and
  root box ride `const` WGSL (the tiling clip's and `shapes.ts`'
  baked-constant pattern), so the params tail, the packers
  (`packSurfaceGpuParamsFinite`/`Finite4` reused verbatim) and the
  bindingless design are unchanged. A general session recompiles its
  kernels per enter (the session freezes its construction), the shipped
  cores' discipline; the shipped emissions stay byte for byte (the general
  path is an opt-in branch). The marching ball is the root box's farthest
  corner's norm (`finiteSolidGeneralBoundingRadius` — exact, not a bound;
  the root box need not be origin-centred).
- **The walk is the reference's endpoint sweep, pruned** (`finEnumerate` →
  stable insertion sort → greedy tie groups → coverage sweep): subtrees
  whose box the ray misses contribute no endpoints anywhere (a descendant's
  box nests inside its parent's), so the pruned enumeration equals the
  reference's unpruned one endpoint for endpoint. The sweep holds the
  first zero-crossing until the claim check has admitted the walk — the
  reference's order, so a mismatching claim refuses before any walk event
  is emitted. The anchor contract survives unchanged: the incident leaf's
  WORD rides `cellIndices`, the crossed faces ride LOCAL leaf sides {0,1}
  in `planeIndices`, the anchored restart snaps/clamps onto the leaf's
  canonical faces under the declared envelope. The anchor's word depth
  reads the params tail's LIVE `finiteLevel` lane (the shipped grid DDA's
  own convention) — one live params dependency in every kernel that
  includes the walk, which is what keeps the bench's auto-layout bind
  group complete for the 3D general core (a bindingless-everywhere walk
  silently drops binding 0 from it).
- **The enumeration is capped at
  `FINITE_SOLID_GENERAL_MAX_ENUM_LEAVES` (128)**, codegen-baked to the
  smaller of that and the construction's own worst case (K^level), so
  small constructions allocate exactly their own bound. A ray that clips
  more pruned leaves refuses visit-cap (the shipped DDA's own
  resource-refusal shape), never truncates — disclosed unresolved work,
  and a Phase 3 disclosure duty for dense documents.
- **The tie-edge class is disclosed, not absorbed**: the reference groups
  endpoints greedily from each group's first t in f64; the WGSL realizes
  the same arithmetic in f32, and two endpoints that tie in f64 can order
  differently in f32 (and across drivers, under fused multiply-add). The
  bench legs treat it the escape legs' way (the pre-hoc ULP ensemble
  excludes the probe and counts it), never a raised tolerance. The
  Sierpinski witness's dyadic arithmetic is exact in f32 and shows none.
- **The agreement legs** (the surface bench's transport section, real
  driver RX 7900 XTX, certified quiet, `--display=:0`): three general
  documents, each kernel against `finiteSolidGeneralDdaF32` — the owner's
  Sierpinski tetrahedron (4 maps, level 2, 16 leaves) 2 stable traces / 2
  resolved, maxRadianceDelta 1.52e-8, maxResidualDelta 1.01e-10,
  maxNormalDelta 0; the shipped Menger maps at level 1 as the
  cross-construction witness (the same object the grid construction
  renders, through the word tree) 4/4, maxRadianceDelta 2.83e-8,
  maxNormalDelta 0; the hyper-Menger maps at level 1 one dimension up 4/4,
  maxRadianceDelta 2.48e-8, maxNormalDelta 0. The f64 oracle stays the
  soundness record (pinned by the module's own tests: the twin against
  `finiteSolidGeneralNextBoundary`/`FromAnchor` on the hand-exact spine
  ray, its anchored continuation, honest exits, the contradicting-claim
  refusal, and the twin-vs-grid-twin cross-construction check).

## The general word tree's routing and panel (landed, 2026-09-21)

The general construction's Phase 3 (the shape-less block routed and
authored in the app, both dimensions) LANDED:

- **The block resolves two kinds.** `resolveFiniteSolid` admits the
  SHAPE-LESS block `{level}` alone as `kind: "general"` — the word tree
  built from the document's OWN maps — beside the shaped blocks'
  `kind: "shaped"` (`{shape, level}`, the presets' vocabulary). Unknown
  keys and out-of-band levels refuse with reasons, never clamp, and any
  refusal wins over any value. `PRESET_FINITE_SOLIDS` now carries
  `FiniteSolidAuthored` — the authored wire the resolver validates; its
  values are unchanged and `kind` never rides an authored block.
- **The gate branches.** `deriveFiniteSolidEligibility`: shape present →
  the shipped analyzer unchanged (the dimension-mismatch checks ride the
  shaped arm only); absent → `analyzeFiniteSolidGeneral` with the SCENE's
  dimension (the word tree is the document's own maps, so no construction
  can disagree with it), the same combination policy (tiling, shape trap,
  schedule), and its own degraded disclosure naming the word-tree route.
- **The target carries the construction.** `FiniteSolidComputeTarget`
  gains `general?: FiniteSolidGeneralWire` on both kinds; the
  `finiteSolid` option assembly threads it (only when present — the
  shipped cores' emissions and option objects stay byte-identical).
  main.ts's finite arm re-runs the admission at the session door (a
  gate/door flip throws), builds the wire from the analysis's
  construction, and derives the marching ball from the root box's
  farthest-corner norm and the material's H from the root box's largest
  per-axis half extent — the same "the solid's own scale" role the shipped
  construction's 0.75 plays for Beer distance and slab lengths.
- **The Glass solid panel section** (the owner's authoring control, asked
  for and confirmed with the owner): a checkbox that installs/clears the
  shape-less block (default depth 1) and a depth select over the
  certified band 0..2, in Scene / Look beside Sphere inversion. A SHAPED
  block reads checked but DISABLED beside its reason ("the glass preset
  authors this exact construction"), so a preset's exact wire is never
  silently converted to the capped word tree. Disclosures per the
  panel-IA contract: the timing hint names the recompile-per-enter edit
  timing, the section note names the admission's standing limits (every
  map must contract and stay axis-aligned), and the depth note derives
  the construction's own cell count — a dense document's K² cells
  disclose the enumeration cap's refusal shape beside the routing. The
  block is Surface-route state only: the effect refreshes the gate and
  restarts a live Surface session, and never regenerates the Points
  cloud. Per-document refusals flow through the existing eligibility
  note row (persistent, beside the mode switch — the transient-toast
  complaint's answer).
- **The app gate** (`scripts/glass-solid-panel.verify.mjs`, real driver
  RX 7900 XTX, certified quiet): the checkbox authored on the SIERPINSKI
  preset's document, `{level: 1}` decoded from the `#v1=` hash, the
  word-tree route named in the eligibility note, the compute session's
  settled first frame (estimator optics — no Glass authored), the depth
  rewrite's restart-and-re-settle with the depth note's own 16-cell
  count, and the shaped block's read-only state with the glassMenger
  preset's optics backend LIVE. The gate also witnesses the refusal
  disclosure working: checking the box on the default system's ROTATING
  maps refuses with the analyzer's reason in the note row — the route
  needs the document's own diagonal contractions, and the Surface button
  disables beside the reason until the block is cleared.

## The general word tree's Phase 4 record (landed, 2026-09-21)

The harness legs and the owner-authored app gate that close the general
word tree's qualification, plus the one defect they caught:

- **The harness's general legs** (`scripts/finite-solid.harness.ts`,
  32 tests): the word tree's f64 query forms pinned against an
  INDEPENDENT box union built in the harness — per-word leaf boxes by the
  outer-inward Horner fold (root bound folded in), where the production
  walk composes innermost first, so agreement pins the arithmetic, not
  one rounding of it — endpoint agreement 1e-12, the declared resolution
  (`FINITE_SOLID_GENERAL_TIE_REL`) grouped on both sides because it is
  the construction's contract. Legs: 24-ray sweeps on the Sierpinski
  document at levels 0/1/2 (24/24, 24/24, 21/24 of the rays hit); the
  hyper-Menger maps one dimension up under the fixture's frozen rotor
  pose (10/20 hit); a 12-map document whose level-2 word tree (144
  leaves) exceeds the device's 128-leaf enumeration cap — the f64
  reference is uncapped by decision, and that sweep keeps it honest.
  The event chain: anchor-to-anchor continuations must reconstruct the
  interval union event for event — enter/exit alternating, the first
  event's parameter BIT-IDENTICAL to the union's endpoint, the
  anchor-driven hops within the declared envelope (bound ~4.5e-6, tested
  at 1e-5), a miss to close, a refusal anywhere a failure — on the same
  four sweeps. Hand-exact dyadic controls: the spine's shared face
  merged bit-exactly (one interval [1.2, 3.6]); the four-leaf corner
  silent (one interval [0.875, 2.375], the corner's tied group netting
  −1, the chain two events, 0.875 + 1.5 = 2.375 exact); the
  state-mismatch refusal on a wrong medium claim. The cross-construction
  equivalence: the shipped Menger maps through the WORD TREE against the
  GRID construction at levels 1 and 2 (24 rays each) and the hyper-Menger
  maps under the posed 4D slice (20 rays), agreement 1e-9 (composed
  affines against canonical grid planes). The admission's CPU record:
  the boot document's rotating maps refuse with the diagonal-composition
  reason; the witness admits 0..2; the 12-map document admits level 2
  with 144 leaves — the admission does not enforce the device cap.
- **The corner-class defect** (caught by the owner-authored app gate:
  one unresolved path in ~127k glass hits, 2 of 8 antialias samples,
  failure f4/reason 3). The chain: an entry through one leaf's face, a
  grazing TIR exit through a neighbor's shared face, and the TIR child's
  restart — REFUSED state-mismatch. Two roots, both real:
  **(1) the leaf-box reconstruction does not round-trip** — the snap
  sites targeted `center ± half`, and `center + half` does not land back
  on the composed face bound (f32: `f32(−0.2) + f32(0.60000002)` rounds
  1 ulp above `hi`; f64 has the same latent defect for non-dyadic maps —
  the search `s=0.02, t=−0.283203125` shows it). An anchor 1 ulp off its
  own leaf's face makes the restart read that leaf 1 ulp outside — the
  tied start fails to merge and an honest re-entering continuation
  refuses. **Fix**: the anchor's snap/clamp and the event's snap target
  the COMPOSED face bounds (`offset + scale·root` — the clip's own
  values) in the f64 oracle (`generalLeafBounds`), the f32 twin
  (`leafFaceBounds`) and the WGSL (`finBoxBounds`/`finLeafBounds`); the
  center/half form stays only where a box SDF needs it (a bound either
  way). Pinned by the twin's chain test (replaying the transport's
  primary → Snell-bent refracted child → TIR mirror; pre-fix refused,
  post-fix resolves — verified to fail on a reverted twin).
  **(2) the transport's split children inherit the event's medium flag**,
  which rides the INCIDENT direction's coverage — at a shared-edge
  crossing the child's own sweep can honestly read the other side, and a
  driver-divergent rounding of the same near-tie (FMA vs the per-op
  twin) leaves a residue the twin cannot bracket: the app gate still
  showed 1 unresolved in 2 samples after fix (1). **Fix (2)**: the
  transport re-anchors the split — the closed-solid backend's own rule
  one query deeper: on a state-mismatch refusal of an ANCHORED query,
  re-query once with the flipped claim and adopt what the sweep says
  (kernel `transportTrace` + the bench model's twin loop, term for
  term); a query that refuses both ways stays the disclosed unresolved
  work, and an unanchored refusal stays loud. The shared transport body
  also takes `var path` (WGSL forbids member writes through a let) —
  the seven cores' `shade|optics` sources move by that one token and the
  digest record is re-frozen for it in its own commit.
- **The app gate's owner-authored leg** (the gate now runs FIVE legs,
  verdict pass, real driver RX 7900 XTX, certified quiet): the general
  block authored from the panel on the Sierpinski document, GLASS
  authored on the HEAD map through the Finish group's bundle — FROM THE
  APP, never a hand-built document (the `#v1=` hash carries
  `{level: 1}` plus exactly one dielectric map, decoded not read) — a
  reboot on the authored hash so the settled session is deterministic,
  Surface on compute with the word tree's OWN optical backend LIVE
  (`opticsBackend: "finiteSolid"`, covered ≥ 20%), COMPLETE transport in
  every antialias sample (the finite-glass gate's strict
  `completionFailures` over the `?surfacetrace` feed — zero unresolved,
  zero invalid, every sample complete and untruncated), and two Save-PNG
  exports byte for byte (30,020 bytes, 960×640, the export seam's
  determinism pinned for the general word tree). The gate's console
  listener also gains the capture-export filter's known
  service-worker/SSL preview-origin noise class and the leg-scoped
  `activeLeg` attribution the new leg needs for its trace capture.
- **The bench after the change** (real driver RX 7900 XTX, certified
  quiet, exit 0, verdict pass): the three general agreement legs
  unchanged at their Phase 2 figures — Sierpinski 2/2 traces,
  maxRadianceDelta 1.52e-8; Menger maps 4/4, 2.83e-8; hyper-Menger 4/4,
  2.48e-8 — and the grid finite legs, envelopes and chunk controls all
  green, so the snap fix and the retry are pinned by the same device
  agreement the GPU half shipped with.

## The finite routing (landed, 2026-09-19)

The finite-solid family's app routing LANDED: the document's optional
`finiteSolid` block `{shape, level}` (`finite-solid.ts`'s authored form,
stored verbatim and refused — never clamped — by `resolveFiniteSolid`)
reroutes Surface to the `finiteSolid`/`finiteSolid4` kinds. The block does
NOT replace the transform system (the sphere-inversion block's move): the
transforms REMAIN the subject and must BE the shipped construction
(`analyzeFiniteSolidSystem` refuses edited maps by values and signs), the
shape names the dimension (a mismatch refuses), tiling/shape-trap/schedule
refuse with their own reasons, and the route is COMPUTE-ONLY (no fragment
arm; the gate refuses without WebGPU rather than handing the solid to a
tracer that would draw the attractor). The gate discloses the routing on
the degraded channel: the level-N cell decomposition is the solid the
transport walks, not the transform system's IFS attractor.

THE WIRE: the session target (`FiniteSolidComputeTarget`, the
sphere-inversion precedent) carries ONLY the authored level — the cores
are bindingless and construction-carrying — and the packers take the
construction's origin-centred bound (the marching ball, `half·√dim`). The
packers' `mapCount = 1` is LOAD-BEARING: the shared shade entry's slot
clamp reads `params.mapCount`, and 0 degenerated the clamp to `[-1, 0]`,
so the opticsMaps lane read went out of bounds, read zero, and every
transport path skipped as a "classic slot" — the measured dark-glass
defect the bench's control entry cannot see (it passes ior as a probe
parameter and never walks the shade entry). The block persists verbatim,
and the maps' geometry rides the wire LOSSLESSLY while it is present
(the swirl-final precedent — the shipped third-contraction scale is 1/3,
which a 4-decimal wire turns into 0.3333, outside the analyzer's
exactness tolerance, so a shared link would refuse the very scene it
carries).

THE GROUND PLANE composes with the finite cores: the shared plane block's
pads emit only under `groundPlane` (224→288 in 3D, 480→576 in 4D), so the
plain kernels' text — and the wires the bench legs pin — stay
byte-identical without a floor. The glass presets
(`glassMenger`/`glassMenger4`, the dielectric study's selected object)
install `PRESET_FINITE_SOLIDS`, author the Glass model on every map, and
land the checker floor through `PRESET_SURFACE_ROOMS`. Both also install
the bright studio backdrop through `app/preset-background.ts`'s
`PRESET_BACKGROUNDS`: a linear custom gradient from `#cdd6e1` to
`#949aa8`, shared with the Glass starters. The stops are authored in the
scene wire's RGB-byte precision, so the menu load and a share-link reload
resolve exactly the same colors. This is an ordinary undoable Scene / Look
edit, including the reset of an inherited radial shape; the generated Flame
backdrop's dormant palette survives. As with room/palette side tables,
unrelated presets leave the background alone. Both cameras match the selected
study: eye `[2.1, 1.4, 3.2]`, target origin, tan(vertical FOV / 2) `0.39`.
The 4D twin is the study's NATIVE posed hyper-Menger at world slice `0.18`,
with world→intrinsic rotation `R_xw(0.57) · R_yw(-0.31)`. The app's packer
transposes its view rotor, so `PRESET_VIEWS` authors the inverse as an xw
turn of `-0.57` followed by a yw turn of `0.31`. The packed rows and world
slice are pinned by `preset-view.test.ts`; copying the study's angle signs
straight into the view would render a different slice.

### Superseded initial app-gate result (historical)

The following record predates the geometry audit below. Both the claim-free
workaround and its percentage-based qualification were superseded; these
measurements do not certify the corrected implementation.

THE INITIAL APP GATE (`scripts/finite-glass.verify.mjs`, real driver): both
presets authored from the app, both dimensions routed
`engine=compute` + `opticsBackend=finiteSolid`, settled, and covered ~74.6%
of the frame with zero exhausted rays. INITIAL MEASURED FAILURE (before the
superseded workaround): the transport's resolved fraction was
~0.5% in both dimensions — the depth-2 anchored restarts refused
state-mismatch ON THE DRIVER where the f32 twin walked clean. The
dissection (twin-side chain walk validated bit-exact against the
fixture's trace; a driver-side diagnostic probe, reverted): the refusing
restarts were single-face anchors with honest normals and substantial
child-direction components, whose copied cell state contradicted the
walks that produced them — not the tied-corner diagonal of the
handover's hypothesis (refuted: perturbing every real chain's child
directions by ulps never flipped a restart's consistency, and an
explicit FMA-emulating mirror — `fround(a*b+c)` at every contractible
site — resolves the app camera 114/114). THE SUPERSEDED WORKAROUND, in both dimensions'
ONE DDA text and its f32 twin: the anchored restart consumes no anchor
state (the copied cells drove both the start cell and the position
clamp), classifies from the lifted world origin's own ray-side rule,
walks CLAIM-FREE (events fire at the occupancy transitions actually
crossed; the transport's medium claims stay segment-geometry-derived),
and suppresses the birth face by envelope — any first crossing within
the declared envelope of the ulp-off restart is that face again, not a
new boundary. Also fixed and unmasked by the fix: the DDA's miss sites
returned carrying the init's stale reason 1 (the twin's miss is reason 0) — masked while every anchored query refused state-mismatch, it
failed the bench's boundary leg the moment anchored queries started
missing; all miss sites now reset to reason 0. MEASURED (RX 7900 XTX,
the app gate): 3D resolved 137 720 / unresolved 4 292 (97.0%), 4D
resolved 116 352 / unresolved 516 (99.6%) — the glass Menger and its
native posed 4D counterpart render as glass over the checker floor;
`npm run bench:surface` PASS, both finite legs boundaryAgree/traceAgree. (The bench's boundary
agreement became real in both dimensions this session: the f32 twin's 3D
rows had been zeros — every 3D event refused degenerate-normal and the 3D
leg absolved itself vacuous through the decision-flip class; the identity
rows restored, the 3D leg's genuine near-tie count is 7 and the cap
recalibrated 4 → 8 on that.)
The initial residue classification was later disproven. The status side channel
reported `f5` inside-miss ×3907 and `f4/r5` nonmonotone ×3221 at 640×480;
raising path/interface limits to 16384, stack capacity to 64, and acceptance
budget eightfold did not change those counts. These observations locate
geometric failures, not trapped-path termination. The correction below
preserves them as historical evidence and supersedes the inference.

## Geometry audit: the apparent billiard residue was not a termination diagnosis

The earlier handover inferred a trapped-path termination problem because larger
path/interface/stack limits and a wider acceptance budget did not reduce the
unresolved count. That inference is invalid: the observed failures were
`inside-miss` and `nonmonotone-crossing`, both failed geometric continuations.
A trapped ray still produces valid interfaces; it reaches an energy cutoff or
an actual resource limit. Neither Russian roulette nor an energy-retirement
rule repairs a missing boundary.

Two independent CPU counterexamples exposed concrete regressions in the
claim-free finite query, even though its shared f32 bench twin agreed with the
shader source:

- An outside ray through the level-0 cube, origin `(-2,-0.5,-0.5)` and direction
  `(1,0,0)`, returned the exit at `t=2.75` with normal `(1,0,0)`. The independent
  f64 oracle returned the entry at `t=1.25` with normal `(-1,0,0)`. The latest
  restart edit had removed initial occupancy-transition handling, so clipping
  to an occupied root-entry cell silently skipped that first interface. This
  reproduced in 3D and 4D.
- At level 1, a reflected inside path starts at intrinsic
  `(-0.25, f32(0.25+1e-7), 0)` and travels along
  `(-sqrt(0.5),-sqrt(0.5),0)`. Its birth face is the x plane, while a distinct
  exit through the y plane lies only `1.2644054553e-7` ahead. The old envelope
  suppression erased that real positive interval and returned a miss. The
  corrected f32 query returns the y exit at `1.2644055403e-7`. A fourth outer
  coordinate gives the same 4D counterexample.

The corrected query restores canonical anchor continuation and checks the
caller-carried medium. It uses the anchor's intrinsic point, snaps only masked
coordinates to their integer planes, and takes unmasked cell ownership from
the anchor. It suppresses no distinct positive interval. Root entry is an
explicit boundary. Ray-side classification compares actual f32 grid planes;
a normalized grid quotient can round onto an integer while its coordinate
is still on the other side. Root slab identities survive rounded world-point
reconstruction. The f32 twin also validates the displayed direction rather
than only the first three intrinsic components, so a posed ray entirely along
the fourth intrinsic axis remains valid.

The production finite transport starts with one unsplit unit-energy camera
ray and lets the exact DDA own the first interface and all continuations.
At this correction stage the display march still scheduled covered pixels;
its footprint hit and smoothed normal no longer seeded an inconsistent
optical split. The subsequent performance correction replaces that primary
march with the same exact DDA. The CPU fixture uses
the same camera-ray convention. Other optical backends retain their existing
primary treatment.

Independent regression tests compare complete reflected/refracted finite
continuations against the separate f64 oracle in 3D and a genuinely posed
4D scene, as well as the two exact counterexamples above. These establish
geometric correctness of the CPU formulation, not driver qualification.
The first restored-anchor driver run still exhibited mass state mismatch.
The event/child/stack witness described next located that remaining defect;
final real-driver qualification must establish the corrected application
behavior separately from the CPU tests.

### Driver witness: inconsistent crossed plane, before any stack push

A driver-side witness located the mass failure before pushing the reflected
child, so the transport stack and its handoff were not the cause. One failing
primary had incident direction `(-0.45165,-0.17200,-0.87546)`, outward normal
`+z`, mask `4`, and post-incident cells `[1,8,0,-1]`; its emitted z plane was
`0` and canonical z coordinate `-0.75`. For negative z travel into cell 0,
the crossed plane must be cell 0's upper plane, `1` (`-0.583333...`). Plane 0
belongs to the wrong end of that cell. Reflection therefore restarted inside
the occupied cell instead of outside, and the canonical medium cross-check
correctly refused it.

The source had copied its mutable DDA index array into `oldIndex` before
advancing, then derived the crossed planes from that copy. The driver result
is consistent with the copy observing the advanced array. The exact compiler
stage causing that behavior is not established. The geometric identity needs
no snapshot: after advancing, the crossed plane is `index[a]` for positive
travel and `index[a]+1` for negative travel. Both WGSL and its f32 twin now
use that one post-crossing state for the emitted cell and plane identities.
Independent tests assert the identity on every reflected/refracted test
boundary. The old bench's one-cell anchor discrepancy allowance masked this
physically invalid mismatch and has been removed; it is not floating-point
slack.

### Work-limit alignment after the geometric correction

At the canonical 3D camera, all eight 960×640 antialias samples completed
geometric traversal without inside-miss, nonmonotone, or state-mismatch
failures after the plane correction. The remaining 3827–3891 unfinished
samples per pass were exclusively `processed-paths` (`f1/r0`), under the
production estimator's 2048 guard. This is a different, measured failure
class from the earlier geometric failures. The finite backend now selects
the exact-DDA oracle's existing 16384 allowance; the estimator and
closed-solid defaults, 128-path agreement probes, six replay passes, branch
cutoff schedule, live stack, and 1/1024 error budget are unchanged. No
Russian roulette or special energy retirement has been introduced.

### Preset persistence and qualification instruments

The preset's camera and 4D view land after its Points cloud arrives. The
original preset edit scheduled persistence before that later view application,
leaving the address-bar hash with stale framing while Copy Link captured the
correct live view. Applying the pending view now flushes the existing edit
session after the camera/rotor/slice update. It creates no extra undo entry.
The app gate compares the actual copied link with the authored hash.

`finite-glass.verify.mjs` now requires every antialias sample in the final
frame token, complete hit accounting, zero unresolved/invalid optical work,
zero march exhaustion, and a named hardware adapter. The prior gate only
logged optical counts; coverage included the floor and could pass a black
fractal. Its structured report retains documents, traces, failure classes,
renderer/raster metadata, and image hashes on failure too. The per-frame
trace identifies sample index, sample count and frame token. The finite
status side channel retains its status in bits 0–7 and carries final failure
and reason in bits 8–15 and 16–23; its allocation and binding stay unchanged.

The studio gradient improves the preset's readability but does **not** recreate
the study's directional softboxes, rear colored wall and floor radiance. The
canonical camera and native 4D slice make the geometry comparable; final
appearance still requires the owner's review of actual application images.

### Boundary-correction baseline, before exact primary rays (2026-09-19)

On quiet AMD RX 7900 XTX hardware (radeonsi, Chromium 151), the strict
`bench:surface` run passes every surface agreement leg. Finite boundary
normals agree exactly; maximum linear-radiance disagreement is
`1.89e-8` in 3D and `2.17e-8` in 4D. All four stable trace probes per
dimension are compared, including one resolved 3D trace and four resolved
4D traces under the deliberately smaller 128-path probe guard. Neither
one-cell anchor differences nor post-result status differences are waived.

The production renderer's canonical finite arms met the preview, settle and
cancellation lines before the subsequent primary-ray optimization:

| Measurement                                | 3D Menger | Native posed 4D |     Limit |
| ------------------------------------------ | --------: | --------------: | --------: |
| 256×144 preview                            |    700 ms |          807 ms |   1500 ms |
| Reused preview                             |    726 ms |          831 ms |   1500 ms |
| 512×288, four-sample settle                |   5237 ms |         6101 ms |  10000 ms |
| Maximum observed transport batch           |  178.1 ms |        285.9 ms |    600 ms |
| Mid-frame cancellation acknowledgement     |   16.5 ms |         32.9 ms |    600 ms |
| Optical samples resolved across the settle |    125843 |          126396 | Every hit |
| Unresolved / invalid / exhausted           | 0 / 0 / 0 |       0 / 0 / 0 |         0 |

The preview repeats are byte-identical. Every completed AA sample is observed
before averaging, so a successful last sample cannot conceal an earlier
failure or expensive batch. The computed additional transport allocation is
5.6 MiB at this raster; that allocation calculation is not a full-HD
process-retention measurement.

The separately built application passes the stricter preset gate at
960×640 with its authored eight AA samples. The 3D samples resolve
154680–154691 hits each, and both dimensions report zero unresolved,
invalid, active or exhausted work in every completed sample. Observed
first frames arrive in 1.26 s / 1.25 s, and full settles take 53.58 s /
107.85 s. These larger eight-sample settles are not the 512×288,
four-sample envelope rows above. Documents, exact copied links, trace
records and clean scene images are in
`scripts/out/finite-glass-pre-primary-dda/finite-glass-report.json`; the
strict hardware report is `strict-surface-bench-results.json` beside it.

The first benchmark completed numerically but crashed while attempting a
3025×240474 diagnostic page screenshot. Its launcher now bounds bitmap
allocation and falls back to a viewport capture; individual scene canvases
remain available at full resolution. The subsequent complete benchmark exits
successfully, including its artifact phase. Screenshot failures do not
replace or weaken the numeric verdict.

Full-HD four-AA exports exposed the remaining performance problem. Both
dimensions completed every optical sample with zero unresolved/invalid work,
and each 35-band PNG was byte-identical to its single-frame counterpart.
However, click-to-download times were 66.61 s / 121.37 s in 3D and
128.54 s / 235.25 s in 4D (single frame / 35 bands), against the unchanged
120 s line. These are failures despite correct images. The complete baseline
is retained under `scripts/out/finite-glass-pre-primary-dda/`.

### Exact primary rays

Both finite cores now use one exact DDA query for a primary ray as well as
for optical continuation. This removes the redundant hybrid-DE sphere march;
the hybrid remains available for normals, shadows and AO. Unprojection,
full-image coordinates, AA jitter, active-ray guards and all parameter/binding
layouts stay unchanged. A floor wins only when it is eligible and strictly
nearer than the finite hit, or the query certifies a miss. An ambiguous or
refused query stays exhausted and visibly unresolved, never background.

Initial ray-side occupancy is derived from the exact cells, so an opaque
camera inside an occupied cell sees its first exit. Optical paths retain the
outside-camera contract; an inside-camera glass path remains unresolved
rather than inventing a medium. The existing nonfinite emitted WGSL digests
remain unchanged. GPU primary agreement is checked through the ordinary
march entry and bindings against independent per-cell slab intervals,
including posed 4D, inside origins, floor ordering, empty rays and refusals.

The quiet Radeon run of the exact-primary build passes all six independent
GPU banks (174 checks, maximum depth difference 4.66e-7). At 256×144,
preview/repeat take 642/621 ms in 3D and 734/724 ms in 4D; the 512×288,
four-AA settles take 4.80/5.70 s. All complete optical samples resolve with
zero failures. The built-app gate at 960×640, eight AA samples resolves
152933–152940 hits per sample in 3D and 150530–150552 in 4D; completed
settles take 51.53/105.81 s. The smaller hit count is the removal of the
previous pixel-epsilon silhouette acceptance, now checked against actual
cell intersections.

This primary optimization alone does not certify the larger raster's cost.
Transport still consumes 93%/96% of each AA frame, and the 4D trace contains
individual transport batches up to 1.12 s, exceeding the 600 ms checkpoint
line. These failures remain failures even though every pixel completes.
The eight frozen study poses also complete in the built app with zero
unresolved, invalid or exhausted work. Exact-primary evidence is archived at
`scripts/out/finite-glass-exact-primary-baseline/`; pose records are at
`scripts/out/finite-glass-correction/poses/finite-glass-poses-report.json`.

### Finite material normalization correction

The selected study's Beer function divides interior distance by
`solid.shape.x`, packed from the construction's `halfExtent`: `H = 0.75` in
both dimensions. The production oracle's `DielectricMaterial` contract names
that same half extent. The original generic material vocabulary instead
specified `visibleBoundingRadius` while claiming it reproduced the selected
material. Finite routing inherited that contradiction: it passed the
enclosing sphere `H√dim`, giving normalization lengths of approximately
1.299 in 3D and 1.5 in 4D. No finite appearance qualification established
that material change. The selected source and scalar control are in
[`transmission-dielectric-gpu.page.ts`](../scripts/transmission-dielectric-gpu.page.ts),
[`packDielectricSolidFixture`](../scripts/transmission-dielectric-solid.ts)
and [`surface-dielectric.ts`](../src/fractal/surface-dielectric.ts).

Finite sessions now pass the existing `FINITE_SOLID_HALF_EXTENT` to the
material resolver. The enclosing radius still controls geometry, floor and
fog, and other scene families keep their previous normalization. Authored
optical scale continues to multiply the reference. This restores the selected
Beer coefficients per world length: the former exponent was smaller by
`1/√3` or `1/2`. The preset's authored distortion remains `0.08`, whose slab
length is now `0.08H = 0.06`; its normal-tap length is `0.04H = 0.03`.
Those lengths previously grew with the enclosing sphere too. This is a
material-units correction, with no branch, error, traversal or timing limit
changed. Lighting and the separately authored distortion still differ from
the original study; matching the Beer normalization does not assert final
appearance approval.

The finite renderer-envelope arms now retain the actual preset optics,
including distortion `0.08`, and use the same half-extent reference as the
app. Earlier finite envelope rows replaced the preset optics with the
straight model and therefore did not measure its smoothed-normal slab work;
those historical measurements above are retained, but do not qualify the
corrected material. Standalone boundary/trace agreement fixtures keep their
explicit probe material parameters. The existing slot-material tests pin both
presets' packed optical lanes and the selected study's independent Beer
control for a 0.5-world-unit interior segment. Actual browser and performance
qualification must be repeated for the corrected material.

Finite envelope scene parameters now also come from the preset room and the
app's shared fresh-session defaults: checker scale `0.64`, floor emission
`1.4`, directional light azimuth/elevation `135°/50°`, ambient `0.25`,
environment strength `0.35`, fog density `1`, zero fog-tint strength, and
transform color in both dimensions. The shared `lightDirection` and
`presentationFloorSpec` resolvers supply the actual vectors and floor payload.
Earlier finite rows instead used a non-emitting floor, no fog or environment
tint, a different light direction and radius coloring in 4D. They do not
qualify the corrected preset room. Both finite tier specs, including their
resolved materials and room, are retained in each benchmark row's
`finiteScene` evidence.

The envelope intentionally measures fixed 16:9 renderer rasters, not a full
browser session: 256×144 at one AA sample for preview, 512×288 at four samples
for settle (the app defaults to eight). Finite preview uses the app's shared
40-march/12-shadow/3-AO settings and `2e-4` hit floor; settle uses
160/32/5 and `1e-5`. The exact finite DDA still draws the complete level-two
construction in both tiers. Acceptance uses the native 288-pixel height in
both tiers, while shading footprints use each actual raster. No adaptive
preview governor, UI/presentation overhead, user-customized room, or export
encoding is included. The nonfinite envelope arms retain their earlier
fixture and quality conventions. Actual application, export and cancellation
gates remain necessary for their larger rasters and user-facing behavior.

### Frozen views and exact work removal

The original canonical capture gate restored a document but allowed ambient
motion during the brief Points interval before Surface entry. Automatic orbit
and tumble deliberately do not rewrite the URL every frame, so equal authored
hashes did not prove equal primary rays. The gate now records reduced-motion
media, captures the settled live document through Copy Link, and verifies its
physical camera, rotor, world slice, geometry, materials and background.
Normalized `sliceCenter` is diagnostic when the document carries `sliceW`:
resampling the point cloud can change that normalization without moving the
world slice. The lifecycle edit arms likewise read the live copied view while
retaining the address-bar document separately. A
`--reduced-motion=no-preference` diagnostic can reproduce moving boot with the
strict live-view check still active.

Guarded child-box pruning of the hybrid field was tried and removed: no useful
GPU speedup was observed. Its captures also exposed the missing motion control,
so they cannot establish an image-identity comparison. The discarded attempt
is recorded under `scripts/out/finite-glass-pruning-attempt/`.

A separate temporary build disabled only finite optical floor shadow/AO field
loops to isolate their cost. With frozen, verified live poses at 960×640 and
eight AA samples, it completed in 41.47 s / 69.68 s; maximum transport batches
were 293.0 ms / 628.4 ms. All samples completed, but lighting was deliberately
changed and the previous enclosing-radius material unit was still in use.
These are diagnostic rows, not an accepted appearance or a release gate.
Artifacts and the warning are in `scripts/out/finite-glass-floor-de-profile/`.
Full floor lighting was restored before subsequent qualification.

Two exact work reductions remain. Finite terminal displacement no longer
samples a smoothed normal when no floor is compiled or the escaped ray cannot
point toward it. Displacement changes only origin, so these terminals always
return the same background radiance. Every downward ray retains the previous
calculation, including origins below the plane because displacement may cross
its height. The CPU terminal controls pin exact RGB and field-call removal;
nonfinite shader digests stay unchanged. The depth-two DDA also uses the
study's exact ternary middle-digit masks, with bounds checked before shifts
and the generic rule retained for other levels. Exhaustive 729-cell and
6561-cell comparisons against the independent integer rule cover both
dimensions. Neither change alters a boundary, material value or error budget.

### Compact finite continuation

The finite `TransportPath` now uses a 112-byte shader-private layout in both
dimensions. WGSL gives each `vec3f` 16-byte alignment but 12-byte size, so
`origin/inside`, `dir/interfaces` and `energy/bound` occupy three consecutive
16-byte groups. The canonical intrinsic point, plane indices and cell indices
start at offsets 48, 64 and 80. `anchorPresent`, `exitPresent` and the plane
mask occupy offsets 96, 100 and 104; final alignment rounds the stride to 112.
Only the finite backend's unused generic displayed-anchor fields are removed.
Every canonical anchor field, branch, cut, guard and arithmetic operation is
preserved, as are the nonfinite emitted-source digests and GPU binding layouts.

The previous stride was 160 bytes. At the unchanged 24-entry stack this removes
1,152 logical private bytes per invocation; it does not establish a physical
driver-memory saving. The source tests calculate field offsets from WGSL type
alignment/size rules and require all three child kinds to inherit the complete
anchor. Anchored queries also skip coordinate classification and the root-entry
index override: their canonical continuation already supplies every cell.
Unanchored rays retain the previous classification arithmetic. The f32 twin
uses the same control flow, while the independent f64 restart/path comparisons
remain the geometric check. GPU image identity and performance are qualified
separately from these layout and CPU checks.

### Corrected application capture (2026-09-20)

With the half-extent material unit, exact primary query, frozen live views and
112-byte finite path state, the quiet RX 7900 XTX / radeonsi / Chromium 151
application gate completes all eight samples at 960×640 in both dimensions:

| Measurement                                    |     3D Menger | Native posed 4D |
| ---------------------------------------------- | ------------: | --------------: |
| First frame observed                           |       1.255 s |         1.254 s |
| Full eight-sample settle                       |      41.486 s |        74.648 s |
| Largest transport batch                        |      253.1 ms |        592.3 ms |
| Optical hits per sample                        | 153097–153102 |   150705–150726 |
| Unresolved / invalid / exhausted, every sample |     0 / 0 / 0 |       0 / 0 / 0 |

Both settled live documents match the authored physical view. Clean scene
PNGs are byte-identical to the preceding 160-byte path implementation with
the same corrected material and frozen view; compaction changes storage and
work, not the picture. The eight frozen difficult camera/rotor cases also
complete with positive optical work and no unresolved, invalid, active or
exhausted rays at their separate 256×144, one-sample convention.
The reports and images are under `scripts/out/finite-glass-correction/`, with
the comparison baseline in `scripts/out/finite-glass-material-baseline/`.
These larger application timings do not replace the frozen 512×288,
four-sample performance envelope, the full-HD export gate or owner review.

### Full-HD checkpoint finding

The same compact-path build saves complete 1920×1080 four-sample images in
52.733 s / 100.526 s for 3D / native 4D. Forced 60000-ray bands (35 per image)
take 93.652 s / 174.419 s and reproduce the respective default exports byte
for byte. Every sample in every band finishes without unresolved, invalid,
active or exhausted work.

These are **not a complete performance pass**: the default 4D export records
seven transport submissions above the unchanged 600 ms checkpoint limit,
with a 923.8 ms maximum (3D: 321.3 ms). The forced-band maxima are 235.4 ms /
613.1 ms. Each AA sample's longest submission is replay pass three with
only 73–80 rays, taking 893.7–923.8 ms; it is not a wide first batch that a
smaller dispatch ceiling would reliably cure. The export gate now records
every submission timing and enforces
the default full-HD checkpoint line, rather than relying on a cancellation
probe that may land before the expensive work. The complete baseline report
is in `scripts/out/finite-glass-path112-baseline/`.

The gate's original requirement that the artificial 35-band stress export
also finish within 120 seconds was extra scope. The selected study's
`Decided feasibility envelope` and canonical full-HD rows require normal
export delivery within 120 seconds, plus independent tile/window identity;
its smaller stress schedules explicitly miss 120 seconds. The corrected
gate preserves the default 120-second limit and exact identity, records
forced-band timing separately and retains the 300-second watchdog. This
scope correction was established from the study before the 4D stress timing
completed; it does not excuse the actual default-export checkpoint failure.

### Removing repeated continuation setup

A validated canonical anchor reconstructs every used coordinate either on
an indexed plane or inside an indexed cell, so its point lies in the closed
root. Every root slab therefore contains zero, and the previous
`max(0, enter)` start is exactly zero. Anchored queries now enter traversal
there directly; they neither lift the unused displayed origin nor repeat
root clipping. New primary rays keep their original clipping formulas and
order. Validation and reconstruction also reuse each identical rounded plane
value, with all envelope, cell-ownership and medium checks retained. For a
single-face anchor this removes five/seven repeated plane evaluations in
3D/4D and up to six/eight root slab divisions; native 4D additionally avoids
four discarded origin row dots.

Independent f64 cube controls cover every root-face axis and sign, including
a fourth-axis face, inward exit, outward miss, tangent refusal and medium
mismatch. A throwing origin accessor proves that a canonical query does not
read world coordinates. The existing random canonical continuations and
nonfinite shader digests remain pinned. A separate input-contract correction
explicitly rejects nonfinite directions: infinities could previously appear
as a plausible miss, so malformed input behavior is tightened, not claimed
byte-identical. Zero/NaN/infinite directions and the unused 3D anchor lane
have refusal controls. Geometry, material arithmetic, branch ordering and
all work/error limits remain unchanged for valid rays.

The GPU images remain byte-identical after this simplification, but it does
not solve the checkpoint tail. A native 4D default full-HD four-sample
early-capture diagnostic completes every sample and saves its PNG in
101.077 s, with a 926.8 ms maximum transport batch (pass three, 73 rays).
Its export-only trace ends at the actual tile-completion marker, excluding a
new live frame started after delivery. The corrected report and raw console
are `scripts/out/finite-glass-correction/native4d-early-export-report.json`
and the adjacent console file. Because capture started after the provisional
frame, this is a checkpoint diagnostic, not a normal export qualification.

### Pausing a finite trace between paths

The remaining long submission is work within individual rays. Finite 3D and
native 4D therefore share a scheduling quantum of 2048 processed paths. A
trace pauses before popping the next path, stores its live LIFO stack,
radiance, residual and cumulative processed count, and resumes at the same
replay threshold. No path is split, no accumulated term is rounded to an
image value, and no partial result is published. The 16384 processed/interface
guards, 24-entry stack, six replay thresholds and accepted residual budget
retain their previous meanings. A quantum of zero is an uninterrupted
diagnostic control, not a document setting.

Finite cores have no map array, so the shade pipeline reuses binding 1 for
one batch of continuation records without increasing the nine storage
bindings. The march pipeline retains its dummy map binding. A 16-byte batch
header carries initialization, an atomic running count, generation and ray
count. Each slot has a 48-byte header followed by the existing 24 × 112-byte
paths: a 2736-byte stride. Headers identify the pixel, replay pass and batch
generation; malformed or stale continuations refuse. Completed slots stay
done while their neighbors finish. The host holds the ray list and threshold
fixed, copies the four-byte running count alongside the existing status copy,
and checks cancellation or loss after every completing counter map. Because
that copy follows the dispatch and status copy in the same submission, its
map already fences the chunk; finite work needs no preceding queue-wide wait.

The allocation is bounded by 4096 rays and reused across batches, frames and
AA samples. At that capacity its declared storage plus counter staging is
11,206,676 bytes (10.688 MiB). Added to the full-HD optical buffers, the
modeled extra allocation is about 89.789 MiB; that is not a measurement of
driver-private memory or browser RSS. Every actual submission contributes
its own checkpoint timing, while the batch-size model learns the cumulative
work of the original ray batch. Source-layout checks and unchanged optical
loop text support the implementation; real-GPU raw-state equivalence,
performance, cancellation and independent memory measurements are still
required to qualify this scheduling change.

The initial 128-path quantum demonstrated both sides of the tradeoff on the
quiet RX 7900 XTX: native 4D full-HD four-sample export finished every sample
and reproduced the uninterrupted PNG byte for byte, with a maximum
submission of 69.4 ms instead of 926.8 ms. However, 7873 submissions raised
delivery time to 148.750 s, outside the unchanged 120-second line. Most
submissions (6116) were in the first replay pass. The scheduling quantum was
therefore increased to 512; this changes how often work pauses, not how much
optical work resolves. The 128-path diagnostic is preserved under
`scripts/out/finite-glass-resumption-128/` and is not a performance pass.

The 512-path diagnostic completed the same image in 117.828 s with a
154.5 ms maximum submission, again with complete samples and identical PNG
bytes. Its export headroom was only 2.2 seconds, while checkpoint headroom
remained large; the production quantum was therefore moved to 1024 for
final qualification. The 512-path record is preserved under
`scripts/out/finite-glass-resumption-512/`.

The full real-driver benchmark at quantum 1024 passes the strict boundary
and exact-primary controls and every raw-state scheduling comparison in both
dimensions. Quanta 0, 1, 17, 128, 512 and 1024 reproduce every individual AA
sample's eight-word optical records and RGBA, including intentional
processed-limit refusals at cap 2. Every positive quantum exercises an actual
pause. The 3D envelope settles in 6.727 s, but native 4D takes 10.697 s and
fails the unchanged 10-second line despite complete samples and a 277.2 ms
largest submission. This is a failed performance qualification, preserved at
`scripts/out/finite-glass-resumption-1024-baseline/results.json`.

The next implementation uses quantum 2048 and removes the redundant explicit
queue fence before the finite counter map. Timing now runs through that map's
completion, and cancellation still waits for submitted work. The diagnostic
uninterrupted and other backend lanes retain their original queue fence.
On the same quiet real driver, the frozen settle takes 6.283 s / 10.082 s
and the largest submissions take 140.9 ms / 501.2 ms. Native 4D still fails
the unchanged ten-second limit. Every raw comparison agrees, but the 8×8,
two-sample 4D control never pauses at quantum 2048 and therefore fails its
continuation-witness requirement. Neither failure is waived. This report is
preserved under `scripts/out/finite-glass-resumption-2048-map-baseline/`.

### Retaining unchanged axis crossings

Within one finite DDA query, the intrinsic origin and direction are fixed.
Only an axis whose integer cell advances needs a new crossing time. Both
dimensions now retain the other axes' already rounded values and recompute
advanced axes with the original `(plane - origin) / direction` expression.
There is no incremental time update or reciprocal substitution. The minimum
and tie scans retain their order, and event, medium, root-exit and visit
guards run before any next-iteration update.

An uncached diagnostic emission remains available for direct comparison.
Its emitted query bytes are pinned to the pre-cache source in both dimensions.
The f32 twin agrees over 88,800 queries covering every cell at levels zero
through two, signed/zero directions and exact/near ties. Independent f64
root-face and posed reflection/refraction controls also compare both f32
forms. Malformed-input and visit-cap refusals remain unchanged. The GPU gate
compares complete raw transport records and per-sample/final pixels on the
same adapter.
This removes repeated arithmetic on longer walks; it does not by itself
establish a speedup or satisfy the remaining performance gates.

### The cache-qualified real-driver run (2026-09-20)

Both mechanisms measured together on the quiet RX 7900 XTX
(`scripts/out/finite-glass-resumption-2048-cache/`, provenance naming the
measured tree):

| Core    | Preview | Repeat (byte-identical) | Four-AA settle | Max batch | Cancel ack | Production-quantum pauses (preview/settle) |
| ------- | ------: | ----------------------: | -------------: | --------: | ---------: | -----------------------------------------: |
| finite  | 0.726 s |                 0.716 s |        6.131 s |  138.7 ms |     9.1 ms |                                     9 / 13 |
| finite4 | 1.031 s |                 1.027 s |    **9.929 s** |  493.7 ms |   128.3 ms |                                      5 / 7 |

The crossing cache brings the native 4D four-AA settle under its 10-second
line for the first time (10.082 s → 9.929 s; ~0.7% headroom). Every envelope
line passes in both dimensions (preview ≤ 1.5 s, settle ≤ 10 s, batch ≤
600 ms, cancel ≤ 600 ms), every AA sample resolves (zero unresolved/invalid
everywhere), and the preview repeats are byte-identical.

The quota-2048 continuation witness changed shape, decided from the measured
row. The scheduling quantum is per-ray-chain — a pause needs ONE ray's chain
to cross the quantum inside a dispatch — so a larger diagnostic raster adds
rays, not chain depth, and cannot reach the witness. The 8×8 bank's 4D
chains never reach 2048 paths (chunk counts [quota 1: ~1568–2497/sample,
17: 91–146, 128: 11–19, 512: 2–4, 1024: 2/1/1/0, 2048: 0 every sample]),
while the 3D bank pauses at 2048 ([2,0,1,2]). The production-quantum 4D
witness therefore lives on the renderer-envelope legs, whose real
512×288×4 frames pause 5 (preview) / 7 (settle) times at 2048 — now a
REQUIRED gate row (`finiteEnvelopeEvidenceFailures`), so a scene whose
chains no longer reach the production quantum fails honestly instead of
silently running uninterrupted. The chunk bank's validator exempts exactly
finite4's production-quota control (it is the uninterrupted-equivalence
comparison it already was, still word-pinned against quota 0); every other
positive quota in both dimensions must still pause and match bit for bit.
No pause requirement was dropped.

## The general curved solid: the signed field and its look gate (2026-09-24)

The closed-solid backend admits emitter-only C0, because with recursive maps
its field describes only the root term. The GENERAL curved solid is the
condensation set over a finite depth band: every word of length in the band
applied to every emitter shape, so an ordinary IFS stamping a sphere, a torus
or a gear becomes a glass fractal. This work landed its CPU field and
rendered its look gate. Nothing is wired: no kernel, wire, routing or panel
change.

THE FIELD (`src/fractal/condensation-solid.ts`, 3D). It is the min over the
word tree's band nodes of the root term the descent already evaluates, scaled
by the word's product of smallest singular values. It is signed and
certified in both directions, and its SIGN IS EXACT: a term is negative only
inside its member, because every shape SDF's sign is exact under the CSG
min/max fold. Membership is therefore `field <= 0`, with no tangency cusp of
the kind the sphere-inversion family's bound has. The search is a
branch-and-bound against one invariant ball `B(c, R)` that every map carries
into itself and that holds every emitter. A child sitting `δ` outside it
certifies its whole subtree at world distance `s·δ`, which is sound for any
shape SDF. The prune fires on the weaker threshold
`S·s·δ·ρ^k·ρ_e`, which lower-bounds every term of the subtree when the shape
SDFs are exact. So the pruned field EQUALS the brute-force union for exact
shapes, pinned against an independent brute-force walk built from the
transforms themselves (sphere and box emitters, similarity and non-uniform
maps, a band that skips the root; relative 1e-12). A conservative shape (a
sphere cut by a box) makes it never smaller than that union while keeping
the sign exact. Sphere emitters under similarities reproduce the
safety-scaled exact distance to the union of balls. Admission refuses a band
without a finite ceiling at most `CONDENSATION_SOLID_MAX_DEPTH` (6), folds,
graph-directed selection, hybrid schedules, any final but the identity, an
emitter outside the exact-SDF rule below, and a map with `σ_max >= 1`. It admits kaleidoscope copies and
per-map posts, folded into each edge's inverse.

THE 4D HALF (`src/fractal/condensation-solid-4d.ts`). A 4D emitter is a 3D
solid embedded at local `w = 0`, a flat piece of 4D. A 3D slice meets a flat
piece in zero volume unless the flat lies in the slice, so the only 4D pose
holding a glass solid is the canonical one the C0 backend already admits.
The 4D field is the 3D search over the C0 backend's own penalty term
(`σ_min·sd + |local w|`) at every node, origin-anchored like the 4D descent,
with the 3D twin's constants, depth ceiling and emitter rule imported rather
than restated. `condensationSolidPoseAdmission4` states the pose: zero slab,
a w-preserving rotor, every composed map (kaleidoscope copies and posts
included) w-untouched and fixing `w0`, and every emitter's flat in the
slice. The lift of a 3D document at `w0 = 0` passes it. There every node
keeps `w = w0`, the penalty vanishes identically, and the tests pin the 4D
field on the slice to the 3D field of the restriction (plain, a band
skipping the root, and an order-3 kaleidoscope; relative 1e-12) and to an
independent 4D brute-force walk. Off the pose the penalty is a lens-shaped
slab, neither a lower bound nor an exact sign, and a prune can drop a lens
term the brute-force union keeps. That is the C0 backend's own off-pose
state, and the transport answers it the same way, with honest refusals.

THE LOOK GATE (`scripts/condensation-glass.harness.ts`, through the shared
`scripts/glass-preview.ts` renderer the sphere-inversion sheet now also uses,
its PNGs byte-identical). 160 px, the transport oracle at the sheet's
192-path budget and R/512 optical resolution:

| Subject (Sierpinski corners + emitter) |                 Resolved | Paths/trace | Word nodes per evaluation (full tree)   | Look                               |
| -------------------------------------- | -----------------------: | ----------: | --------------------------------------- | ---------------------------------- |
| Glass beads (sphere), D2               |                     100% |        14.4 | 4.9 (21)                                | clean refracting pearls            |
| Glass rings (torus), D2                |                    97.6% |        19.3 | 4.9 (21)                                | clean, a few unresolved rims       |
| Gearworks (the shipped gear), D2       |                    52.3% |        47.6 | 3.8 (21)                                | black speckle across the gears     |
| Glass beads, D0 / D1 / D2 / D3         | 100 / 99.9 / 100 / 99.9% |   11.2–16.5 | 1.0 / 3.0 / 4.9 / 7.4 (1 / 5 / 21 / 85) | the recursion reads at every level |

Three findings:

- ANALYTIC CURVED EMITTERS READ AS GLASS at every depth, resolving
  essentially every hit. The branch-and-bound keeps the word search at a
  small, slowly growing number of nodes per evaluation (7.4 of 85 at D3).
- THE GEAR DOES NOT. 47.7% of its glass hits fail, `inside-miss` 3,439 of
  them. The gear's SDF is conservative (a sector fold over an extruded
  profile), and the closed-solid query's crossing band trusts the field as a
  distance near walls. The membership gate removes most phantom crossings
  (1.7 per trace) but not all. Which emitter shapes admit glass is therefore
  a real admission question for the routing child: exact-SDF primitives
  (sphere, box, torus, capsule) and their unions, or a gear-specific remedy.
- THE LOOK WAS APPROVED, EXACT-SDF EMITTERS ONLY (decided 2026-09-24 on
  the owner's delegation). The bead and ring sheets read as curved glass in
  the same register as the approved sphere-inversion pearls, so the rest of
  the production work goes ahead. The emitter rule follows from the gear
  row: an admitted emitter is a UNION of analytic primitives with exact
  SDFs (sphere, box, torus with `minor <= major`, capsule). Intersect
  parts (exact sign, conservative distance), the gear and meshes refuse
  with named reasons (`condensationSolidShapeRefusal`, shared by both
  dimensions). No gear remedy is scheduled. The look sheet still renders
  its gear panel, as the rule's evidence, through the module's explicit
  `admitConservativeShapes` instrument option, which routing never passes.

THE ROUTING PREDICATE (`surface-optics-backend.ts`'s
`surfaceCondensationSolidAdmitted`) reads both admissions and, in 4D, the
pose at entry, plus the router's own tiling and balloon refusals. It is
DISJOINT from `surfaceClosedSolidAdmitted` by the map count: emitter-only
C0 stays the closed-solid backend's. Nothing selects it yet. It waits on
the kernel mirror.

## What is not yet qualified

The backend and routing sections above record the current implementation;
the earlier capability matrix records its pre-integration state.
The boundary query's INSIDE traversal has LANDED for the closed-solid
backend — the envelope's closed-solid arms resolve in both dimensions with
every delegated line met — so the first blocker is cleared. The rear-scene
contract, the corridor's straight shadow visibility and the restrained
rear-image distortion have LANDED (the sections above — the agreement
legs' mode-2 shadow probes pin the corridor against the f64 twin, and the
mode-3 displacement probes pin the accepted slab model). The app-level
routing and the panel material have LANDED (2026-09-18, the section
below): the app selects the closed-solid backend wherever the
composition admits it, the panel authors the model, and the two Glass
starters carry it in both dimensions; the export-tile gate's
transmission leg is byte-exact in both dimensions with the distortion
authored. The finite routing has LANDED (2026-09-19, the section above),
with the subsequent geometry correction recorded above. Final qualification
uses complete optical samples, not a resolved-pixel percentage.
What remains:
the fold core's transport (the measured timeout, three recorded paths —
the closed-solid backend is now DOUBLY motivated for the finite-construction
path, being its own recorded scope); built-app qualification (the final
visual review; the delegated preview/settle/cancel envelope itself is
MEASURED and passing in both dimensions since the 2026-09-20 run above —
what remains unmeasured there is the larger-raster tier: the 960×640
eight-AA settles and the full-HD export rows, whose pre-cache 120-second
failures the resumption/cache work is expected to move but has not yet
re-measured).
The estimator arms' IFS
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

# The app routing's export-tile leg (byte-exact both dimensions, closed
# solid + distortion): the transmission scenes are the two starters.
node scripts/surface-export-tile.verify.mjs --display=:0 --scene=transmission

# The finite presets' complete optical samples and actual Save-PNG identity:
node scripts/finite-glass.verify.mjs --display=:0
node scripts/surface-export-tile.verify.mjs --display=:0 --scene=finite

# The starters' composition screenshots (real driver, real preset menu):
node scripts/transmission-starters.probe.mjs --display=:0

# The same arms against the GLSL twins (?surfacegl, real driver):
node scripts/surface-transport-invalidation.verify.mjs --display=:0 --lane=webgl

# The GLSL twins' gate rows: the lane reaches the settled frame, per
# dimension, authored-vs-stripped (built app, quiet real driver):
node scripts/surface-optics-glsl.verify.mjs --display=:0
```

The unit suite pins the optics (including the emitted `js` dialect executing
bit-identically to the f64 oracle), the transport oracle over analytic
interval/shell/posed-4D scenes, chunked bit-identity, the replay schedule and
the emission canon — plus the corridor fix's own pins: the fixture twin's
analytic controls (normal-incidence chord, both gate exits, the TIR dark
ray) and the emitted corridor branches' byte-identity when the backend is
absent. The bench's `transportAgreement` rows are
the compute backend's per-core record: the kernel's own
`transportNextBoundary`/`transportTrace` against `surface-transport-fixture.ts`'s
f64 twin, fail-closed, with the forward cores' chaos exclusions disclosed
per row (the ULP-ensemble classifier, escape legs' treatment), the fold
core's measured device-loss skip recorded in the run's notes, and each
row's `backend`/`opticsSoundness` pair naming what the agreement
certifies (the closed-solid rows pin the signed query in both
dimensions, and now carry `maxShadowDelta` — the mode-2 shadow probes'
straight-visibility agreement, with the through-lobe probe's analytic
`(1 − F0)²·Beer(0.7)` control and the two gate exits' exact-1 pin; and
`maxDisplacementDelta` — the mode-3 terminal-displacement probes' pin of
the accepted slab model against the oracle's own helpers; the corridor's
shadow work is bounded by its own runtime budget and is
counted apart from the primary rays the way the lane's tallies always
were). Measured
2026-09-14 on the RX 7900 XTX / radeonsi: six of seven cores agree
(radiance ≤ 1.1e-4, residual ≤ 3.2e-4, normals ≤ 6.6e-3); pristine main
reproduces the SwiftShader device-loss at an unrelated early leg, so that
finding is environmental. The `transportEnvelope` rows are the renderer
lane's record (the section above): the production renderer at the
delegated preview/settle rasters against the decided envelope's lines,
plus the mid-flight cancel probe and the byte-identity repeat — skipped
on software adapters, gating on real ones.
