#!/usr/bin/env node
/**
 * Deterministic cold-bake benchmark for the scaled conservative mesh-SDF
 * delivery: procedural geometry, ingestion, lazy BVH construction and the
 * complete conservative 64^3 bake of the production catalog trefoil,
 * against the measured sub-2-second cold-bake budget.
 */
import { performance } from "node:perf_hooks";
import {
  MESH_SDF_BAKE_VERSION,
  bakeMeshSdf,
  meshAsset,
  meshContainsPoint,
  meshContainsPointExact,
  meshUnsignedDistance,
  meshUnsignedDistanceExact,
  sampleMeshSdf,
} from "../src/fractal/mesh-shapes.ts";
import { mulberry32 } from "../src/fractal/rng.ts";
import type { Vec3 } from "../src/fractal/types.ts";

const COLD_BAKE_BUDGET_MS = 2_000;
const RESOLUTION = 64;
const ingestStarted = performance.now();
const mesh = meshAsset("trefoil-knot-v1");
const ingestMs = performance.now() - ingestStarted;
const bakeStarted = performance.now();
const bake = bakeMeshSdf("trefoil-knot-v1", RESOLUTION);
const bakeMs = performance.now() - bakeStarted;

let worstDistanceDelta = 0;
let worstConservativeExcess = -Infinity;
let signMismatches = 0;
const rng = mulberry32(0xb71f0a11);
const points: Vec3[] = [];
for (let i = 0; i < 2_000; i++) {
  points.push([
    bake.min[0] + rng() * (bake.max[0] - bake.min[0]),
    bake.min[1] + rng() * (bake.max[1] - bake.min[1]),
    bake.min[2] + rng() * (bake.max[2] - bake.min[2]),
  ]);
}
const acceleratedStarted = performance.now();
const accelerated = points.map((p) => ({
  distance: meshUnsignedDistance(mesh, p),
  inside: meshContainsPoint(mesh, p),
}));
const acceleratedQueryMs = performance.now() - acceleratedStarted;
const exactStarted = performance.now();
const exact = points.map((p) => ({
  distance: meshUnsignedDistanceExact(mesh, p),
  inside: meshContainsPointExact(mesh, p),
}));
const exactQueryMs = performance.now() - exactStarted;
for (let i = 0; i < points.length; i++) {
  const p = points[i];
  worstDistanceDelta = Math.max(
    worstDistanceDelta,
    Math.abs(accelerated[i].distance - exact[i].distance),
  );
  if (accelerated[i].inside !== exact[i].inside) signMismatches++;
  const exactSigned = exact[i].inside ? -exact[i].distance : exact[i].distance;
  worstConservativeExcess = Math.max(
    worstConservativeExcess,
    sampleMeshSdf(bake, p[0], p[1], p[2]) - exactSigned,
  );
}

const report = {
  version: MESH_SDF_BAKE_VERSION,
  node: process.version,
  asset: {
    id: mesh.id,
    vertices: mesh.vertices.length,
    triangles: mesh.triangles.length,
    resolution: RESOLUTION,
    latticeNodes: bake.values.length,
  },
  budgetMs: COLD_BAKE_BUDGET_MS,
  ingestMs: Number(ingestMs.toFixed(1)),
  coldBakeMs: Number(bakeMs.toFixed(1)),
  acceleratedQueries2000Ms: Number(acceleratedQueryMs.toFixed(1)),
  exactQueries2000Ms: Number(exactQueryMs.toFixed(1)),
  querySpeedup: Number((exactQueryMs / acceleratedQueryMs).toFixed(1)),
  worstDistanceDelta,
  signMismatches,
  worstConservativeExcess,
  withinBudget: bakeMs <= COLD_BAKE_BUDGET_MS,
};
console.log(JSON.stringify(report, null, 2));
if (
  bakeMs > COLD_BAKE_BUDGET_MS ||
  worstDistanceDelta !== 0 ||
  signMismatches !== 0 ||
  worstConservativeExcess > 3e-7
) {
  process.exitCode = 1;
}
