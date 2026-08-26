# Scalable mesh SDF delivery

Bundled meshes keep a runtime bake, accelerated by one deterministic BVH per
prepared mesh. This was chosen over shipping pre-baked volumes. A 64³ R32F
volume costs 1 MiB per asset before HTTP compression and would make a mesh-free
or analytic-only load pay catalog-size download/cache costs. The runtime path
allocates neither BVH nor volume until a consumer requests that prepared mesh.
Catalog geometry is also factory-backed and prepared on first use, and the
active-scene atlas holds only the requested slabs.

## Bundled geometry

Catalog ids remain append-only. After the original 22-vertex/40-triangle Star,
the bundled assets are:

| Asset           | Vertices | Triangles | Construction                                                      |
| --------------- | -------: | --------: | ----------------------------------------------------------------- |
| Faceted Crystal |       10 |        16 | octagonal bipyramid, long axis on screen-space y                  |
| Heart Prism     |       24 |        44 | explicit 12-point concave outline, deterministic ear-clipped caps |
| Crescent Moon   |       28 |        52 | broad 14-point no-hole crescent outline and prism walls           |
| Snowflake Prism |      144 |       284 | 72-point six-arm/twelve-branch outline and prism walls            |
| Trefoil Knot    |      720 |     1,440 | 72 centreline rings × 10 tube sides                               |

The three prisms share one first-ear CCW triangulator and extrusion helper.
Their top, bottom and wall triangles reuse the same perimeter vertices, so no
cap seam can drift from the sampled side wall. Snowflake branch cores remain
inside by at least 1.7 cell half-diagonals in the production 64³ bake.

The Trefoil uses a periodic projected-radial frame, tube radius 0.0992 after
normal-framing scale, and a closed indexed strip. Its numeric clearance gate
splits the certificate into local and nonlocal parts: the minimum discrete
curvature radius is 0.44954 (4.53 tube radii), while centreline strips more than
five path steps apart are at least 0.49306 apart. Subtracting two tube radii
leaves 0.29466 units of nonlocal surface clearance.

## Query and conservative contracts

Ingestion remains the single geometry identity for both consumers. The
surface-area CDF, exact-query triangle records and lazy BVH all come from the
same frozen `PreparedMeshAsset`; the bake cache is a `WeakMap` keyed by that
object rather than only by its catalog id.

The BVH recursively splits the widest triangle-centroid axis at its median,
ties by original triangle index, and uses eight-triangle leaves. Nearest queries
visit the closer child first and prune only when its AABB lower bound exceeds
the best exact triangle distance, with a floating-point comparison margin.
Sign queries run the existing three deterministic parity rays through the BVH;
edge/vertex hits still retry, then use the unchanged solid-angle fallback. The
linear exact distance and sign scans remain exported as explicitly named
test/benchmark oracles.

Acceleration does not alter the lower-bound argument. Every lattice value is
still the downward-f32 rounding of either `signedDistance(node) - cellRadius`
or the near-surface `-2 * cellRadius` fallback. Eight-node interpolation,
outside-box `max`, node ordering, 8..128 resolution validation, and CPU/GPU
sampling metadata are unchanged.

`MESH_SDF_BAKE_VERSION` is part of every in-memory bake key and is published on
the bake and atlas. Version 1 describes the current x-fastest node layout,
two-cell padding, conservative bias, and z-slab atlas ordering. Any change to
those bytes or their interpretation must bump it; a BVH-only change that is
proven identical to the exact oracle does not.

## Measured budget

The reproducible gate is `npm run bench:mesh-sdf`. It resolves the production
720-vertex/1,440-triangle `trefoil-knot-v1` asset, cold-bakes its 262,144-node
64³ volume, then compares 2,000 accelerated distance/sign queries and
conservative samples with the independent linear scans. The budget is
2,000 ms for the synchronous cold bake: below the multi-second UI stall that
motivated this work while leaving headroom for lower-clocked supported clients.

On 2026-08-26, Node 22.23.2 on an Intel i7-1165G7, five fresh-process production
asset runs took 658, 666, 681, 665 and 653 ms (median 665 ms); lazy geometry
generation plus ingestion took 7.6..9.1 ms. A representative run reported a
12.1x query speedup, zero distance delta, zero sign mismatch, and a worst sampled
conservative excess of -0.0219. The benchmark exits nonzero for a
budget miss, any oracle mismatch, or a conservative excess over the numerical
tolerance.

The tradeoff is a sub-second first use on the reference laptop instead of
catalog-proportional shipped volumes. Once cached, repeated consumers reuse the
same bake object and atlas upload; analytic-only startup still constructs no
BVH, lattice, or mesh texture.
