# Layered transmission with world-space bending

This is the next experiment selected in the
[transmission review](surface-transmission.md#candidate-comparison-and-review-status):
preserve fractal detail and reveal internal/rear geometry in both dimensions,
with visible bending required. The desktop research targets are 1 second for
256 × 144, 10 seconds for 512 × 288, and 120 seconds for 1920 × 1080, with
correct completion and at most 128 MiB of additional state. These are targets,
not achieved performance or production approval.

The previous hard World bands and screen-space warp remain intact as
controls. Their gap-phase, fallback, and GPU agreement failures remain in
the [original study](surface-transmission.md) and
[feasibility record](surface-transmission-feasibility.md).

## Smooth layer weight

`scripts/transmission-layer-field.ts` defines a smooth clearance signal:

```
s = clamp((.003R - DE(p)) / (.003R - .002R), 0, 1)
h = s²(3 - 2s)
weight = max(0, h - previousH)
throughput *= baseTau ** weight
previousH = h
```

`R` is the full scene ball, including the unsliced ball for 4D. The default
world lattice is still `.001R`. The previous signal survives work chunks
and starts at zero at analytic entry. A complete monotone rise contributes
one interface weight; a plateau and an outward fall contribute zero; a
partial rise contributes fractional weight. An opaque material has zero
throughput at any positive weight and remains inert at zero weight.

This is positive variation of a sampled clearance signal. It is not a
signed membership test, true solid thickness, or Beer absorption per unit
length. Repeating the same sample cannot manufacture density, but an
oscillating field can add multiple rises to one apparent layer. Both the
TypeScript and small WGSL mirror use this definition; their arithmetic has
different precision and requires measured comparison.

## Exact gap and noise controls

`scripts/transmission-layer-field.harness.ts` uses the independent finite-box
interval oracle for a central ray through two closed solids in 3D and a
posed 4D slice. On these chosen axis-parallel rays, distance to the interval
union is the exact unsigned box distance. The continuous positive variation
is independently `2 - h(gap/2)`. This identity does not extend an interval
oracle into a general estimator or infer membership from a generic DE.

At base throughput `.864`, the measured throughput range over grid phases
0, .25, .5, .75 is identical in both dimensions:

| Gap / R | Spacing / R | Throughput range across phases |
| ------: | ----------: | -----------------------------: |
|    .006 |        .001 |                        .056606 |
|    .006 |      .00025 |                        .004704 |
|  .00625 |        .001 |                        .017247 |
|  .00625 |      .00025 |                        < 2e-15 |

The `.004R` gap remains one layer; the `.008R` gap gives two on all tested
phases and spacings. Nested phase-zero refinement cannot lose positive
variation and is checked against the continuous oracle. Smoothing reduces
the old `.00625R` all-or-nothing split, but material phase sensitivity
remains at the default spacing. This is not a phase-independent optical
definition.

A separate deterministic spatial-noise control samples
`DE/R = .0025 + .00005 cos(2π cycles s)` on 16,384 subdivisions. Without
noise, positive variation is .5 and throughput is .929516. At 64 cycles,
variation rises to 9.99325 and throughput falls to .232042. Fixed-amplitude
noise can therefore make the field substantially more opaque. The harness
also checks plateaus, repeated identical samples, homothetic scale, opaque
limits, invalid inputs, and exact chunk equality for sizes 1, 37, and 1200.

No public Menger or Pentatope estimator currently provides a certificate
bounding its returned DE over a skipped segment. A map-level distance or
Lipschitz bound does not certify finite-depth branch selection. The pilot
therefore evaluates the fixed lattice; it cannot safely skip work merely
because the current sample is far from a layer.

Reproduce these scalar controls independently of a GPU timing window:

```bash
npx vitest run --config scripts/vitest.harness.config.ts \
  scripts/transmission-layer-field.harness.ts --disableConsoleIntercept
```

The gap and noise records land in
`scripts/out/transmission-layer-field-report.json` and
`scripts/out/transmission-layer-noise-report.json`. Generated evidence stays
under ignored `scripts/out/`; the harness and this interpretation are
versioned. World-space bending and device continuation need their own
image, correctness, and measured cost evidence before qualification.
