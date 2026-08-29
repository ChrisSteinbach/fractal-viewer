# Solid voxel payload decision

Status: **no voxel payload extension for the sampled Solid upgrade**.

This records the audit of Solid's accumulation and presentation boundary. A new
deterministic forward-itinerary or orbit-trap channel is justified only if a
concrete user-visible consumer needs it. None of the planned Solid work does.

## Current contract

Both dimensional accumulators write the same `VoxelGrid`:

- `density: Float32Array` stores one hit count per voxel in 3D. The 4D path
  stores the soft-slice-weighted count in the same channel.
- `avgRGB: Float32Array` stores three interleaved running-mean color channels.
  The 4D path uses the weighted running mean, reducing to the 3D update when
  slice weight is one.
- `maxDensity` anchors density normalization. `orbit`, `orbitW`, `orbitColor`,
  `orbitPrevBase`, and `orbitChaosLeft` are accumulation-continuation state;
  they are not presentation channels.

`voxelTextureData` is the only presentation packer. It emits one RGBA8 3D
texture: running RGB in RGB and log-normalized density in alpha. The worker's
`grid` event transfers exactly that texture plus size, world bounds, and
progress. `FractalScene.setVoxelGrid` uploads it as one `Data3DTexture`.
`voxel-material.ts` reads alpha for the primary march, refinement, gradient
normal, shadows, ambient occlusion, balloon density, and centre-occupancy
probe; it reads RGB for the hit albedo.

The current color contract already reaches that running RGB in both dimensions:

- legacy By Transform;
- Height and Radius ramps, including the selected shared ramp palette;
- Position, including custom axis colors and contrast;
- Uniform;
- the structural orbit palette (`orbitColor` is retained only so progressive
  chunks continue that color walk exactly);
- 4D signed-w ramps and the 4D forms of Transform, Height, Radius, Position,
  Uniform, and structural coloring.

Changing color dispatch does not change the orbit or density. Changing a color
that is baked into `avgRGB` restarts accumulation, as it does today.

## Presentation consumers

The sampled Solid upgrade adds three kinds of presentation work:

1. The acceleration hierarchy is a separate conservative max-alpha hierarchy.
   Its source is the packed density alpha. It neither shades nor needs an orbit
   identifier.
2. Environment integration and the floor are query-time presentation. The
   environment combines the existing hit RGB, normal, backdrop/environment
   sample, and live strength. The floor is analytic plane geometry shaded from
   its own albedo/pattern, the existing light/environment inputs, and Solid's
   existing density for fractal shadows. Neither operation asks which forward
   map produced a voxel or what orbit-trap value reached it.
3. Status, effective resolution, and convergence disclosure consume worker
   progress and resolution metadata, which are already outside the voxel
   texture.

There is no requested Solid color source, material control, legend, export
mode, or debug view that exposes forward-itinerary or orbit-trap metadata.
Adding a channel without such a consumer would be speculative state, not a
presentation capability.

It would also be material rather than free. At the default `192^3` grid,
`density + avgRGB` occupy 16 bytes per voxel, about 108 MiB, and the transient
RGBA8 transfer occupies another 27 MiB. One extra Float32 accumulation channel
alone adds 27 MiB (25% to the retained grid), before its worker transfer or GPU
representation is counted. The existing memory clamp therefore is another
reason to require a real consumer before widening the payload.

## Decision and reopen condition

Keep `VoxelGrid` at density plus running RGB and keep its primary GPU payload at
one RGBA8 volume. Build the separate, derived acceleration hierarchy from
alpha; do not treat it as an authored accumulator/worker color channel.
Implement environment and floor in the shader/presentation layer, and keep
disclosure in the existing worker metadata path.

Reopen this decision only with a named user-visible feature whose result cannot
be derived from density, running RGB, world position, normal, view/light/
environment state, or independent analytic floor data. Examples would be a
selectable last-map/itinerary material or a genuine orbit-trap color source.
Such a proposal must also specify accumulation semantics for mixed hits,
3D/4D parity, progressive chunk continuation, worker transfer format, GPU
format/filtering, memory budget, persistence/UI, and legacy color stability.
