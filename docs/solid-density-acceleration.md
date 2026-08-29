# Solid density acceleration

This note records the proof, payload contract, and construction measurements
for Solid's conservative max-alpha hierarchy. The implementation is
`src/fractal/voxel-max-hierarchy.ts`; the executable measurement record is
`scripts/voxel-max-hierarchy.harness.ts`.

The hierarchy accelerates empty-space decisions only. It does not change the
RGBA8 density texture, the isosurface definition, or any Solid default. If the
hierarchy is absent, the existing unaccelerated density marcher remains the
complete rendering path.

## Why the maximum is conservative

Solid samples the packed texture's alpha with hardware trilinear filtering. A
trilinear sample is a convex combination of at most eight adjacent alpha
bytes. It can therefore never exceed the largest contributing byte. Testing a
region against the maximum byte in all texel support for that region cannot
skip a real `alpha > threshold` hit.

The texture domain needs slightly more care than a conventional disjoint texel
mip:

- An `N`-texel axis has `N + 1` interpolation cells. Cell 0 is the clamped
  half-cell from texture coordinate 0 to the first texel centre; cells 1
  through `N - 1` lie between neighbouring texel centres; cell `N` is the
  final clamped half-cell.
- Interior base cell `i` is supported by source texels `i - 1` and `i`.
  Boundary cells 0 and `N` are supported by source texels 0 and `N - 1`
  respectively.
- The first stored hierarchy level covers two base cells on each axis. Their
  union has at most three supporting source texels per axis, so each node
  directly scans at most 27 source alpha bytes. Pooling disjoint 2x2x2 source
  texels instead would be wrong: interpolation support crosses those seams.
- Every later node is the maximum of up to eight children from the preceding
  level. By induction, it is the maximum of every source alpha byte supporting
  its represented continuous region. Ceil-edged pooling retains the odd tail
  on each axis. The one-node root is therefore exactly the source volume's
  maximum alpha.

The hierarchy can be conservative in the useful direction: a node may remain
occupied because some alpha in its region is high even when a particular ray
misses that density. It cannot certify empty a region containing a threshold
hit. Unit coverage independently compares randomized trilinear samples to the
containing node at every level, including boundary half-cells and a last-corner
texel's interpolation halo.

## Threshold stays live

The hierarchy stores maximum alpha bytes, not threshold-specific occupancy
bits. Solid's hit test is strict: a sample is a hit only when normalized alpha
is strictly greater than the live threshold. A node is therefore safely empty
when

```text
float32(maxAlpha / 255) <= float32(threshold)
```

Equality is empty under the same strict rule. `voxelMaxHierarchyNodeIsEmpty`
uses the float32-rounded operands that an R8 sample and high-precision shader
uniform comparison see. Moving the Solid density threshold changes only this
comparison; it does not rebuild or retransfer the hierarchy. The same payload
supports the entire live threshold range.

## Payload layout and exact cost

The source RGBA8 volume remains the leaf representation. The hierarchy does
not duplicate the one-byte-per-base-cell level. Instead it concatenates every
stored alpha-only level into one transferable `Uint8Array`, with x varying
fastest inside each cubic level. Per-level metadata is:

```text
{ size, offset, length: size^3, cellSpan }
```

The first level has `cellSpan = 2`; each following level doubles it. `offset`
is the prefix sum of preceding lengths. The final level is the one-byte root.
The exact alpha payload for source size `N` is

```text
B(N) = sum(ceil((N + 1) / 2^k)^3), k = 1 ... root
```

where the series ends at size 1. The JavaScript metadata object and GPU-driver
bookkeeping are not included in `byteLength`; the transferable alpha sample
payload (and nominal R8 texel cost) is exact.

| Source | Stored level sizes  | Source RGBA8 | Hierarchy bytes |   MiB | Bytes/source voxel | Added vs RGBA8 |
| ------ | ------------------- | -----------: | --------------: | ----: | -----------------: | -------------: |
| 64³    | 33→17→9→5→3→2→1     |    1,048,576 |          41,740 | 0.040 |             0.1592 |          3.98% |
| 128³   | 65→33→17→9→5→3→2→1  |    8,388,608 |         316,365 | 0.302 |             0.1509 |          3.77% |
| 192³   | 97→49→25→13→7→4→2→1 |   28,311,552 |       1,048,560 | 1.000 |             0.1481 |          3.70% |

Content density does not affect these byte counts. At the production 192³
resolution the hierarchy adds about 0.148 alpha bytes per source voxel (close
to one seventh), or 1,048,560 bytes — 16 bytes shy of one MiB — beside the
27 MiB RGBA8 texture.

## Construction measurement

Run on 2026-08-29 with:

```bash
npx vitest run --config scripts/vitest.harness.config.ts scripts/voxel-max-hierarchy.harness.ts
```

Environment: Node v22.23.2; Linux 7.0.0-30-generic x64; 11th Gen Intel Core
i7-1165G7 at 2.80 GHz; 8 logical CPUs; 15.4 GiB RAM.

The harness constructs complete deterministic packed RGBA8 fixtures before it
starts the clock. The sparse fixture has approximately 1/64 nonzero alpha
texels, representing thin attractor support in a large cube. The dense fixture
has nonzero alpha everywhere. Both force one alpha-255 witness, independently
track the source maximum, and fill RGB with unrelated nonzero deterministic
data. Each hierarchy build runs twice. Assertions require:

- exact layout byte cost;
- the root equals the independently measured source maximum;
- both builds are byte-for-byte identical; and
- the reported fingerprint is identical for the duplicate payload.

Timing has deliberately no pass/fail threshold. The two wall-clock samples
are printed separately; `best` is descriptive only.

| Profile | Source | Nonzero alpha | Run 1 ms | Run 2 ms | Best ms | Root | Hierarchy fingerprint |
| ------- | -----: | ------------: | -------: | -------: | ------: | ---: | --------------------- |
| Sparse  |    64³ |         1.61% |     6.26 |     2.83 |    2.83 |  255 | `df17e145`            |
| Dense   |    64³ |       100.00% |     9.68 |     3.80 |    3.80 |  255 | `09c538e3`            |
| Sparse  |   128³ |         1.57% |    17.80 |    17.84 |   17.80 |  255 | `533302ff`            |
| Dense   |   128³ |       100.00% |    25.00 |    25.08 |   25.00 |  255 | `a5ab2511`            |
| Sparse  |   192³ |         1.57% |    61.27 |    61.58 |   61.27 |  255 | `64252a87`            |
| Dense   |   192³ |       100.00% |    84.54 |    86.14 |   84.54 |  255 | `1bde8580`            |

The 64³ first samples still show warm-up noise despite a small unreported
warm-up build, which is precisely why timing is evidence rather than a CI
gate. At the production size the repeated samples were stable: about 61 ms for
the sparse fixture and 85 ms for the dense fixture. The builder visits the
same source and hierarchy topology either way; the content labels characterize
representative payloads, not separate complexity classes or guaranteed future
timings.

## Progressive accumulation and rebuilds

A hierarchy belongs to one exact packed-alpha snapshot. Progressive Solid
accumulation changes hit counts, and `voxelTextureData` repacks alpha as

```text
round(log1p(voxelDensity) / log1p(maxDensity) * 255)
```

Although raw hit counts only increase, packed bytes are not monotone:
`maxDensity` can rise and renormalize previously packed voxels downward. An
incremental max-only update would retain stale high bounds. That would remain
conservative but progressively destroy skipping quality; attempting to lower
only locally could instead become unsafe because normalization is global.

The snapshot contract is consequently:

1. Accumulation chunks that do not publish a new packed texture do not rebuild
   the hierarchy.
2. Whenever the worker's existing pack throttle publishes a fresh RGBA8
   texture, build a fresh hierarchy from those exact bytes.
3. Deliver/install the texture and hierarchy as one matched snapshot. Never
   use a hierarchy derived from an earlier alpha payload with a newer texture.
4. The forced final texture publication gets the final hierarchy. Geometry,
   view, symmetry, palette, or resolution restarts discard the in-flight pair
   and follow the same rule for the new session.
5. Threshold-only edits remain live shader state and reuse the installed pair.

This pays construction on presentation refreshes, not on every chaos-game
chunk. It also preserves today's throttling behavior: a large grid cannot spend
nearly all worker time repeatedly packing and rebuilding between small amounts
of new accumulation.

## Worker, lifecycle, and memory integration

Each worker `grid` event carries the fresh RGBA8 texture plus exactly one of:

- a `present` hierarchy built from that texture's bytes; or
- an explicit `absent` marker selecting the unaccelerated marcher.

The worker transfers both backing buffers in the same `postMessage`. The main
thread installs or clears the hierarchy in the same synchronous scene call that
installs the texture, so a progressive update cannot retain acceleration from
an older normalization. A render entry owns one Worker. Its host detaches the
message and error handlers, closes a local live gate, and only then terminates;
even callback references already captured from an old worker become inert after
exit or re-entry.

The proactive resolution guard uses exact bytes rather than treating the
hierarchy as a fractional afterthought. `voxel-memory.ts` accounts

```text
M(N) = 4N³ density + 12N³ running RGB + 4N³ packed RGBA8 + B(N) hierarchy
```

at the point when all four worker payloads coexist. The coarse-pointer floor is
`M(256) = 338,007,374` bytes (322.349 MiB), preserving the shipped 256³ phone
ceiling. The desktop cap is `M(512) = 2,703,792,207` bytes (2578.537 MiB),
preserving the full 512³ slider endpoint for an 8-GiB report. Intermediate
desktop budgets scale linearly between the same device-memory signals and the
resolution clamp walks the existing 32-voxel steps using `M(N)` directly.
Reactive base-grid allocation failure still walks that same resolution ladder.

## Fixed-lattice GPU traversal

The renderer uploads only the existing level whose nodes span 16 base
interpolation cells per axis. At 192³ it is a 13³, 2.15-KiB nearest-filtered
R8 texture; at the 512³ ceiling it is 33³. A single additional `sampler3D`
stays within WebGL2's guaranteed fragment-sampler limit and avoids a dynamic
sampler array or a second full hierarchy atlas.

At a primary-ray lattice point the shader maps normalized texture coordinates
to the same base cell as the builder, reads that node's maximum, and computes
the ray's exit from the node's continuous half-texel bounds. If the node is
empty, it advances by a whole number of the original fixed strides and leaves
the next point at an exact boundary for reclassification. If the node is
occupied, its exit is cached and ordinary RGBA8 samples continue until the ray
leaves it, amortizing the R8 read. The loop still consumes at least one original
lattice index per iteration and retains the existing `uMarchSteps` ceiling.
The outside/inside pair is refined with the same five strict-threshold
trilinear samples as the fallback. Its final bracket is therefore no wider
than one original stride divided by 32 (about 0.036 voxel at the tuned
1.16-voxel stride).

`voxel-raymarch-accelerated.ts` is the independent CPU oracle. Adversarial and
seeded property tests require exact hit/miss, first-inside, last-outside, five
bisections, refined position, and density agreement with the unaccelerated
oracle across boundary halos, thin diagonals, phase changes, sparse/dense
volumes, and threshold equality. The GPU may regroup a multi-stride f32
advance; real rendered comparison permits at most one output-byte difference
in at most 0.1% of channels and requires identical coverage.

Only straight source-volume primary rays use node-exit skipping. Balloon's
source-AABB primary loop is straight and uses the same traversal. Its inverted
echo is a curved path in source texture space, so linear node exits are not a
valid bound and its existing march remains unchanged. The 48-sample shadow,
four-tap AO, six-tap gradient, and one color read all start in occupied
neighborhoods where an additional hierarchy query has no measured case; they
also remain unchanged.

## Traversal measurement

`scripts/voxel-hierarchy-traversal.harness.ts` compares span 8, 16, and 32 on
3,072 deterministic 192³ rays per profile, preserving the production
220-sample lattice and asserting zero first-hit mismatches. `total fetch ratio`
counts one nearest R8 lookup and one trilinear RGBA8 lookup equally; it is a
stable work-count comparison, not a claim that the two reads have identical
hardware cost.

| Profile   | Span | Baseline RGBA8 | Accelerated RGBA8 | Hierarchy R8 | RGBA8 saved | Total fetch ratio | Mismatches |
| --------- | ---: | -------------: | ----------------: | -----------: | ----------: | ----------------: | ---------: |
| Sparse    |   16 |        672,237 |             6,118 |       38,476 |       99.1% |             0.066 |          0 |
| Dense     |   16 |          3,072 |             3,072 |        3,072 |        0.0% |             2.000 |          0 |
| Nonlinear |   16 |        651,559 |            26,892 |       37,335 |       95.9% |             0.099 |          0 |

Span 16 is the best combined count: span 8 scored 0.114/0.126 for
sparse/nonlinear, and span 32 scored 0.074/0.138. The deliberately full dense
profile hits on its first sample, so its bound is one extra tiny R8 read rather
than a longer ray.

`scripts/solid-hierarchy.verify.mjs` drives the production app through
SwiftShader WebGL2, captures matched hierarchy-present and event-forced-absent
192³ renders through the app's own PNG path, and compiles both Balloon variants.
The recorded run had no browser errors, changed four of 16,384 readback
channels by one byte (mean delta 0.000244), and measured median capture latency
137.20 ms accelerated versus 326.22 ms fallback (2.38x fallback/accelerated).
Timing is descriptive and ungated; coverage and the tight pixel tolerance are
gated.

## Allocation failure and fallback

Construction is pure and all-or-nothing. The builder computes its checked
layout and then allocates one concatenated byte array; it never mutates the
source texture or returns a partial hierarchy. The integration boundary must
treat hierarchy allocation as optional acceleration:

- catch an allocation failure and latch acceleration off for the remainder of
  that accumulation session, avoiding repeated allocation pressure on every
  progressive publication;
- omit the hierarchy for that snapshot;
- still transfer and install the already-valid RGBA8 texture; and
- march through the existing unaccelerated path with identical image
  semantics.

A failed hierarchy must not lower Solid resolution, abort accumulated
progress, change the density threshold, or install a partial/stale hierarchy.
A new render session may try again (notably after a lower effective resolution
is selected), but correctness never depends on success. This is distinct from
failure to allocate the base voxel grid or pack the RGBA8 texture: without the
base presentation payload there is nothing for either accelerated or
unaccelerated Solid to render, so the worker's existing grid/pack failure
handling still applies.

At 192³ the optional allocation is 1,048,560 bytes. The harness holds duplicate
hierarchies only to prove determinism; production construction needs one new
hierarchy payload per published texture snapshot.
