/**
 * Built-in triangle meshes for the shared shape vocabulary.
 *
 * Persistence carries only a stable {@link MeshAssetId}.  The catalog entry
 * is ingested once into one {@link PreparedMeshAsset}; its area CDF feeds the
 * point/Flame sampler and its triangles feed the conservative SDF bake.  The
 * two consumers therefore cannot accidentally render different revisions of
 * an asset.
 *
 * A bake stores a LOWER bound on the mesh's signed distance at every lattice
 * node.  For lattice spacing `h`, let `r = sqrt(3) h / 2`, the cell
 * half-diagonal.  A node farther than `r` from the surface stores
 * `floor_f32(sd(node) - r)`.  A nearer node stores `floor_f32(-2r)`, which is
 * below `sd(node) - r` regardless of which side an edge/vertex tie chooses.
 * Manual trilinear interpolation remains conservative: for weights `w_i`,
 *
 *   sum w_i stored_i <= sum w_i sd(v_i) - r
 *                     <= sd(p) + sum w_i |v_i-p| - r
 *                     <= sd(p).
 *
 * The last inequality is the weighted RMS bound inside a cube.  Hardware
 * filtering is deliberately not part of the contract; shader consumers use
 * the atlas metadata below and eight explicit texel loads, exactly as
 * {@link sampleMeshSdf} does on the CPU. Outside the bake cube, sampling
 * returns the max of the clamped interpolation and distance to the cube:
 * both independently lower-bound distance to the contained mesh, while the
 * box term keeps far-away marching from stalling on a small border value.
 */
import type { Rng } from "./rng";
import type { Vec3 } from "./types";

export const MESH_ASSET_IDS = [
  "star-prism-v1",
  "faceted-crystal-v1",
  "heart-prism-v1",
  "crescent-moon-v1",
  "snowflake-prism-v1",
  "trefoil-knot-v1",
] as const;
export type MeshAssetId = (typeof MESH_ASSET_IDS)[number];

/**
 * Version of the node-lattice encoding consumed by CPU and GPU samplers.
 * Include this in any durable pre-bake/cache key. BVH implementation changes
 * do not require a bump when they reproduce the same exact triangle queries;
 * the version changes when padding, conservative bias, ordering or layout does.
 */
export const MESH_SDF_BAKE_VERSION = 1;

export function isMeshAssetId(value: unknown): value is MeshAssetId {
  return (
    typeof value === "string" &&
    (MESH_ASSET_IDS as readonly string[]).includes(value)
  );
}

export interface PreparedMeshAsset {
  readonly id: MeshAssetId;
  /** Canonical local-space vertices. */
  readonly vertices: readonly Vec3[];
  /** Outward-oriented indexed triangles. */
  readonly triangles: readonly (readonly [number, number, number])[];
  /** Inclusive cumulative surface areas, one entry per triangle. */
  readonly triangleCumulativeAreas: readonly number[];
  readonly totalArea: number;
  readonly bounds: {
    readonly min: Vec3;
    readonly max: Vec3;
    readonly center: Vec3;
    /** Radius about the mesh's local origin, matching shapeBoundingRadius. */
    readonly radius: number;
  };
}

export interface MeshSdfBake {
  readonly version: typeof MESH_SDF_BAKE_VERSION;
  readonly mesh: PreparedMeshAsset;
  readonly resolution: number;
  /** x-fastest node lattice, `x + n * (y + n * z)`. */
  readonly values: Float32Array<ArrayBuffer>;
  readonly min: Vec3;
  readonly max: Vec3;
  readonly cellSize: number;
  readonly cellRadius: number;
}

export interface MeshSdfAtlasEntry {
  readonly meshId: MeshAssetId;
  readonly catalogIndex: number;
  readonly zOffset: number;
  readonly resolution: number;
  readonly min: Vec3;
  readonly max: Vec3;
  readonly cellSize: number;
  readonly cellRadius: number;
}

export interface MeshSdfAtlas {
  readonly version: typeof MESH_SDF_BAKE_VERSION;
  readonly resolution: number;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly values: Float32Array<ArrayBuffer>;
  readonly entries: readonly MeshSdfAtlasEntry[];
}

// ---------------------------------------------------------------- catalog

/**
 * A watertight non-convex five-point star prism.  The cap centres make a
 * deterministic triangle fan; the perimeter is counter-clockwise viewed
 * from +z, top faces point +z, bottom faces -z, and side faces point out.
 */
function starPrismRaw(): {
  vertices: Vec3[];
  triangles: [number, number, number][];
} {
  const vertices: Vec3[] = [];
  const ring = 10;
  const halfHeight = 0.28;
  for (const z of [-halfHeight, halfHeight]) {
    for (let i = 0; i < ring; i++) {
      const radius = i % 2 === 0 ? 1 : 0.42;
      const angle = Math.PI / 2 + (2 * Math.PI * i) / ring;
      vertices.push([radius * Math.cos(angle), radius * Math.sin(angle), z]);
    }
  }
  const bottomCenter = vertices.length;
  vertices.push([0, 0, -halfHeight]);
  const topCenter = vertices.length;
  vertices.push([0, 0, halfHeight]);

  const triangles: [number, number, number][] = [];
  for (let i = 0; i < ring; i++) {
    const j = (i + 1) % ring;
    const bi = i;
    const bj = j;
    const ti = ring + i;
    const tj = ring + j;
    triangles.push([bottomCenter, bj, bi]);
    triangles.push([topCenter, ti, tj]);
    triangles.push([bi, bj, tj]);
    triangles.push([bi, tj, ti]);
  }
  return { vertices, triangles };
}

type Vec2 = readonly [number, number];

function polygonSignedArea2(points: readonly Vec2[]): number {
  let area2 = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area2 += a[0] * b[1] - b[0] * a[1];
  }
  return area2;
}

function triangleCross2(a: Vec2, b: Vec2, c: Vec2): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function pointInTriangle2(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  const epsilon = 1e-12;
  return (
    triangleCross2(a, b, p) >= -epsilon &&
    triangleCross2(b, c, p) >= -epsilon &&
    triangleCross2(c, a, p) >= -epsilon
  );
}

/** Deterministic first-ear triangulation for the small, authored CCW outlines. */
function triangulateSimplePolygon(
  points: readonly Vec2[],
): [number, number, number][] {
  if (points.length < 3 || !(polygonSignedArea2(points) > 1e-12)) {
    throw new RangeError(
      "mesh extrusion outline must be a nondegenerate CCW polygon",
    );
  }
  const remaining = Array.from({ length: points.length }, (_, i) => i);
  const triangles: [number, number, number][] = [];
  while (remaining.length > 3) {
    let found = false;
    for (let i = 0; i < remaining.length; i++) {
      const previous = remaining[(i + remaining.length - 1) % remaining.length];
      const current = remaining[i];
      const next = remaining[(i + 1) % remaining.length];
      if (
        triangleCross2(points[previous], points[current], points[next]) <= 1e-12
      ) {
        continue;
      }
      let containsOther = false;
      for (const candidate of remaining) {
        if (
          candidate === previous ||
          candidate === current ||
          candidate === next
        ) {
          continue;
        }
        if (
          pointInTriangle2(
            points[candidate],
            points[previous],
            points[current],
            points[next],
          )
        ) {
          containsOther = true;
          break;
        }
      }
      if (containsOther) continue;
      triangles.push([previous, current, next]);
      remaining.splice(i, 1);
      found = true;
      break;
    }
    if (!found) {
      throw new RangeError("mesh extrusion outline is not a simple polygon");
    }
  }
  triangles.push([remaining[0], remaining[1], remaining[2]]);
  return triangles;
}

/** Extrude one simple CCW silhouette. Cap and wall faces share the exact same
 * perimeter vertices, making the result manifold without a centre-fan seam. */
function extrudePolygonRaw(
  points: readonly Vec2[],
  halfHeight: number,
): { vertices: Vec3[]; triangles: [number, number, number][] } {
  const capTriangles = triangulateSimplePolygon(points);
  const vertices: Vec3[] = [];
  for (const z of [-halfHeight, halfHeight]) {
    for (const point of points) vertices.push([point[0], point[1], z]);
  }
  const n = points.length;
  const triangles: [number, number, number][] = [];
  for (const [a, b, c] of capTriangles) {
    triangles.push([c, b, a]);
    triangles.push([n + a, n + b, n + c]);
  }
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    triangles.push([i, next, n + next]);
    triangles.push([i, n + next, n + i]);
  }
  return { vertices, triangles };
}

/** An elongated octagonal bipyramid: deliberately low-poly so its triangular
 * faces remain legible rather than approximating a smooth ellipsoid. */
function facetedCrystalRaw(): {
  vertices: Vec3[];
  triangles: [number, number, number][];
} {
  const ring = 8;
  const vertices: Vec3[] = [];
  for (let i = 0; i < ring; i++) {
    const angle = (2 * Math.PI * i) / ring;
    vertices.push([0.62 * Math.cos(angle), 0, 0.62 * Math.sin(angle)]);
  }
  const bottom = vertices.length;
  vertices.push([0, -1.15, 0]);
  const top = vertices.length;
  vertices.push([0, 1.15, 0]);
  const triangles: [number, number, number][] = [];
  for (let i = 0; i < ring; i++) {
    const next = (i + 1) % ring;
    triangles.push([top, next, i]);
    triangles.push([bottom, i, next]);
  }
  return { vertices, triangles };
}

/** Broad lobes, a deliberately resolvable notch and a nondegenerate tip. */
function heartPrismRaw(): {
  vertices: Vec3[];
  triangles: [number, number, number][];
} {
  const outline: Vec2[] = [
    [0, -1],
    [0.7, -0.38],
    [0.95, 0.05],
    [0.96, 0.5],
    [0.72, 0.85],
    [0.36, 1],
    [0, 0.7],
    [-0.36, 1],
    [-0.72, 0.85],
    [-0.96, 0.5],
    [-0.95, 0.05],
    [-0.7, -0.38],
  ];
  return extrudePolygonRaw(outline, 0.3);
}

/** One simple crescent outline: the inner arc returns to the upper tip, so
 * there is no boolean subtraction, hole or disconnected inner wall. */
function crescentMoonRaw(): {
  vertices: Vec3[];
  triangles: [number, number, number][];
} {
  const outline: Vec2[] = [
    [0.55, 0.82],
    [0, 1],
    [-0.58, 0.82],
    [-0.92, 0.4],
    [-1, 0],
    [-0.92, -0.4],
    [-0.58, -0.82],
    [0, -1],
    [0.55, -0.82],
    [0.14, -0.53],
    [-0.18, -0.42],
    [-0.4, 0],
    [-0.18, 0.42],
    [0.14, 0.53],
  ];
  return extrudePolygonRaw(outline, 0.28);
}

/** Six main arms with two broad side branches each. The narrowest authored
 * branch is 0.15 units wide, over four lattice cells at the 64^3 bake. */
function snowflakePrismRaw(): {
  vertices: Vec3[];
  triangles: [number, number, number][];
} {
  const valleyY = 0.35 / Math.sqrt(3);
  const arm: Vec2[] = [
    [0.35, -valleyY],
    [0.48, -0.2],
    [0.62, -0.31],
    [0.7, -0.25],
    [0.64, -0.14],
    [0.82, -0.1],
    [1.05, 0],
    [0.82, 0.1],
    [0.64, 0.14],
    [0.7, 0.25],
    [0.62, 0.31],
    [0.48, 0.2],
  ];
  const outline: Vec2[] = [];
  for (let sector = 0; sector < 6; sector++) {
    const angle = (sector * Math.PI) / 3;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    for (const [x, y] of arm) {
      outline.push([x * cosine - y * sine, x * sine + y * cosine]);
    }
  }
  return extrudePolygonRaw(outline, 0.24);
}

const TREFOIL_PATH_SEGMENTS = 72;
const TREFOIL_TUBE_SIDES = 10;
const TREFOIL_TUBE_RADIUS = 0.32;
const TREFOIL_SCALE = 0.31;

/** Thick polygonal tube around a periodic (2,3) torus-knot centreline. The
 * projected radial frame is periodic, so the final and first rings share the
 * same twist without a closure discontinuity. */
function trefoilKnotRaw(): {
  vertices: Vec3[];
  triangles: [number, number, number][];
} {
  const vertices: Vec3[] = [];
  const triangles: [number, number, number][] = [];
  const normalize = (v: Vec3): Vec3 => {
    const length = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / length, v[1] / length, v[2] / length];
  };
  for (let i = 0; i < TREFOIL_PATH_SEGMENTS; i++) {
    const t = (2 * Math.PI * i) / TREFOIL_PATH_SEGMENTS;
    const c2 = Math.cos(2 * t);
    const s2 = Math.sin(2 * t);
    const c3 = Math.cos(3 * t);
    const s3 = Math.sin(3 * t);
    const center: Vec3 = [(2 + c3) * c2, (2 + c3) * s2, s3];
    const tangent = normalize([
      -3 * s3 * c2 - 2 * (2 + c3) * s2,
      -3 * s3 * s2 + 2 * (2 + c3) * c2,
      3 * c3,
    ]);
    const radialDot = tangent[0] * c2 + tangent[1] * s2;
    const normal = normalize([
      c2 - radialDot * tangent[0],
      s2 - radialDot * tangent[1],
      -radialDot * tangent[2],
    ]);
    const binormal: Vec3 = [
      tangent[1] * normal[2] - tangent[2] * normal[1],
      tangent[2] * normal[0] - tangent[0] * normal[2],
      tangent[0] * normal[1] - tangent[1] * normal[0],
    ];
    for (let j = 0; j < TREFOIL_TUBE_SIDES; j++) {
      const angle = (2 * Math.PI * j) / TREFOIL_TUBE_SIDES;
      const normalWeight = TREFOIL_TUBE_RADIUS * Math.cos(angle);
      const binormalWeight = TREFOIL_TUBE_RADIUS * Math.sin(angle);
      vertices.push([
        TREFOIL_SCALE *
          (center[0] + normalWeight * normal[0] + binormalWeight * binormal[0]),
        TREFOIL_SCALE *
          (center[1] + normalWeight * normal[1] + binormalWeight * binormal[1]),
        TREFOIL_SCALE *
          (center[2] + normalWeight * normal[2] + binormalWeight * binormal[2]),
      ]);
    }
  }
  for (let i = 0; i < TREFOIL_PATH_SEGMENTS; i++) {
    const nextI = (i + 1) % TREFOIL_PATH_SEGMENTS;
    for (let j = 0; j < TREFOIL_TUBE_SIDES; j++) {
      const nextJ = (j + 1) % TREFOIL_TUBE_SIDES;
      const a = i * TREFOIL_TUBE_SIDES + j;
      const b = nextI * TREFOIL_TUBE_SIDES + j;
      const c = nextI * TREFOIL_TUBE_SIDES + nextJ;
      const d = i * TREFOIL_TUBE_SIDES + nextJ;
      triangles.push([a, c, b], [a, d, c]);
    }
  }
  return { vertices, triangles };
}

function freezeVertices(vertices: readonly Vec3[]): readonly Vec3[] {
  return Object.freeze(
    vertices.map((v) => Object.freeze([v[0], v[1], v[2]]) as Vec3),
  );
}

function freezeTriangles(
  triangles: readonly (readonly [number, number, number])[],
): readonly (readonly [number, number, number])[] {
  return Object.freeze(
    triangles.map((t): readonly [number, number, number] =>
      Object.freeze([t[0], t[1], t[2]]),
    ),
  );
}

function triangleCross(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const acx = c[0] - a[0];
  const acy = c[1] - a[1];
  const acz = c[2] - a[2];
  return [aby * acz - abz * acy, abz * acx - abx * acz, abx * acy - aby * acx];
}

/** Scalar triangle geometry cached by prepared-object identity. The bake's
 * hot path performs tens of millions of triangle probes at 64³; keeping
 * these edges here avoids both repeated subtraction and per-probe arrays. */
interface PreparedTriangleGeometry {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  cx: number;
  cy: number;
  cz: number;
  abx: number;
  aby: number;
  abz: number;
  acx: number;
  acy: number;
  acz: number;
}

interface MeshBvhNode {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  /** Children for an internal node; -1 for a leaf. */
  left: number;
  right: number;
  /** Half-open range into `triangleOrder` for a leaf. */
  start: number;
  end: number;
}

interface PreparedMeshAcceleration {
  readonly triangles: readonly PreparedTriangleGeometry[];
  readonly triangleOrder: Int32Array<ArrayBuffer>;
  readonly nodes: readonly MeshBvhNode[];
}

const TRIANGLE_GEOMETRY = new WeakMap<
  PreparedMeshAsset,
  readonly PreparedTriangleGeometry[]
>();

const MESH_ACCELERATION = new WeakMap<
  PreparedMeshAsset,
  PreparedMeshAcceleration
>();

const BVH_LEAF_TRIANGLES = 8;

function prepareTriangleGeometry(
  vertices: readonly Vec3[],
  triangles: readonly (readonly [number, number, number])[],
): readonly PreparedTriangleGeometry[] {
  return triangles.map((tri) => {
    const a = vertices[tri[0]];
    const b = vertices[tri[1]];
    const c = vertices[tri[2]];
    return {
      ax: a[0],
      ay: a[1],
      az: a[2],
      bx: b[0],
      by: b[1],
      bz: b[2],
      cx: c[0],
      cy: c[1],
      cz: c[2],
      abx: b[0] - a[0],
      aby: b[1] - a[1],
      abz: b[2] - a[2],
      acx: c[0] - a[0],
      acy: c[1] - a[1],
      acz: c[2] - a[2],
    };
  });
}

function triangleGeometry(
  mesh: PreparedMeshAsset,
): readonly PreparedTriangleGeometry[] {
  let prepared = TRIANGLE_GEOMETRY.get(mesh);
  if (!prepared) {
    prepared = prepareTriangleGeometry(mesh.vertices, mesh.triangles);
    TRIANGLE_GEOMETRY.set(mesh, prepared);
  }
  return prepared;
}

/** Build a deterministic median-split BVH. Stable triangle-index tie breaks
 * make the tree and all query results independent of engine sort stability. */
function buildMeshAcceleration(
  mesh: PreparedMeshAsset,
): PreparedMeshAcceleration {
  const triangles = triangleGeometry(mesh);
  const order = Array.from({ length: triangles.length }, (_, i) => i);
  const nodes: MeshBvhNode[] = [];

  const build = (start: number, end: number): number => {
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    let centroidMinX = Infinity;
    let centroidMinY = Infinity;
    let centroidMinZ = Infinity;
    let centroidMaxX = -Infinity;
    let centroidMaxY = -Infinity;
    let centroidMaxZ = -Infinity;
    for (let i = start; i < end; i++) {
      const tri = triangles[order[i]];
      minX = Math.min(minX, tri.ax, tri.bx, tri.cx);
      minY = Math.min(minY, tri.ay, tri.by, tri.cy);
      minZ = Math.min(minZ, tri.az, tri.bz, tri.cz);
      maxX = Math.max(maxX, tri.ax, tri.bx, tri.cx);
      maxY = Math.max(maxY, tri.ay, tri.by, tri.cy);
      maxZ = Math.max(maxZ, tri.az, tri.bz, tri.cz);
      const centroidX = tri.ax + tri.bx + tri.cx;
      const centroidY = tri.ay + tri.by + tri.cy;
      const centroidZ = tri.az + tri.bz + tri.cz;
      centroidMinX = Math.min(centroidMinX, centroidX);
      centroidMinY = Math.min(centroidMinY, centroidY);
      centroidMinZ = Math.min(centroidMinZ, centroidZ);
      centroidMaxX = Math.max(centroidMaxX, centroidX);
      centroidMaxY = Math.max(centroidMaxY, centroidY);
      centroidMaxZ = Math.max(centroidMaxZ, centroidZ);
    }

    const nodeIndex = nodes.length;
    const node: MeshBvhNode = {
      minX,
      minY,
      minZ,
      maxX,
      maxY,
      maxZ,
      left: -1,
      right: -1,
      start,
      end,
    };
    nodes.push(node);
    if (end - start <= BVH_LEAF_TRIANGLES) return nodeIndex;

    const spans = [
      centroidMaxX - centroidMinX,
      centroidMaxY - centroidMinY,
      centroidMaxZ - centroidMinZ,
    ];
    let axis = 0;
    if (spans[1] > spans[axis]) axis = 1;
    if (spans[2] > spans[axis]) axis = 2;
    const centroid = (triangleIndex: number): number => {
      const tri = triangles[triangleIndex];
      if (axis === 0) return tri.ax + tri.bx + tri.cx;
      if (axis === 1) return tri.ay + tri.by + tri.cy;
      return tri.az + tri.bz + tri.cz;
    };
    const sorted = order.slice(start, end).sort((a, b) => {
      const delta = centroid(a) - centroid(b);
      return delta === 0 ? a - b : delta;
    });
    order.splice(start, end - start, ...sorted);
    const middle = start + ((end - start) >> 1);
    node.left = build(start, middle);
    node.right = build(middle, end);
    node.start = -1;
    node.end = -1;
    return nodeIndex;
  };

  build(0, order.length);
  return {
    triangles,
    triangleOrder: Int32Array.from(order),
    nodes,
  };
}

function meshAcceleration(mesh: PreparedMeshAsset): PreparedMeshAcceleration {
  let acceleration = MESH_ACCELERATION.get(mesh);
  if (!acceleration) {
    acceleration = buildMeshAcceleration(mesh);
    MESH_ACCELERATION.set(mesh, acceleration);
  }
  return acceleration;
}

/**
 * Validate and prepare indexed geometry.  Exported for ingestion tests; the
 * production path calls it only while constructing the built-in catalog.
 */
export function ingestMeshAsset(
  id: MeshAssetId,
  inputVertices: readonly Vec3[],
  inputTriangles: readonly (readonly [number, number, number])[],
): PreparedMeshAsset {
  if (!isMeshAssetId(id))
    throw new RangeError(`unknown mesh asset id: ${String(id)}`);
  if (inputVertices.length < 4) {
    throw new RangeError("mesh asset needs at least four vertices");
  }
  if (inputTriangles.length < 4) {
    throw new RangeError("mesh asset needs at least four triangles");
  }
  const vertices = freezeVertices(inputVertices);
  for (const v of vertices) {
    if (
      !Number.isFinite(v[0]) ||
      !Number.isFinite(v[1]) ||
      !Number.isFinite(v[2])
    ) {
      throw new RangeError("mesh asset contains a non-finite vertex");
    }
  }
  const triangles = freezeTriangles(inputTriangles);
  const cumulative = new Array<number>(triangles.length);
  const edges = new Map<string, { count: number; direction: number }>();
  let totalArea = 0;
  let signedVolume6 = 0;
  for (let i = 0; i < triangles.length; i++) {
    const tri = triangles[i];
    const [ia, ib, ic] = tri;
    for (const index of tri) {
      if (!Number.isInteger(index) || index < 0 || index >= vertices.length) {
        throw new RangeError(`mesh triangle ${i} has an out-of-range index`);
      }
    }
    if (ia === ib || ib === ic || ic === ia) {
      throw new RangeError(`mesh triangle ${i} repeats a vertex`);
    }
    const a = vertices[ia];
    const b = vertices[ib];
    const c = vertices[ic];
    const cross = triangleCross(a, b, c);
    const twiceArea = Math.hypot(cross[0], cross[1], cross[2]);
    if (!(twiceArea > 1e-12)) {
      throw new RangeError(`mesh triangle ${i} is degenerate`);
    }
    totalArea += twiceArea / 2;
    cumulative[i] = totalArea;
    signedVolume6 +=
      a[0] * (b[1] * c[2] - b[2] * c[1]) +
      a[1] * (b[2] * c[0] - b[0] * c[2]) +
      a[2] * (b[0] * c[1] - b[1] * c[0]);
    for (const [from, to] of [
      [ia, ib],
      [ib, ic],
      [ic, ia],
    ] as const) {
      const lo = Math.min(from, to);
      const hi = Math.max(from, to);
      const key = `${lo}:${hi}`;
      const edge = edges.get(key) ?? { count: 0, direction: 0 };
      edge.count++;
      edge.direction += from === lo ? 1 : -1;
      edges.set(key, edge);
    }
  }
  for (const [key, edge] of edges) {
    if (edge.count !== 2) {
      throw new RangeError(`mesh is not watertight at edge ${key}`);
    }
    if (edge.direction !== 0) {
      throw new RangeError(`mesh orientation disagrees at edge ${key}`);
    }
  }
  if (!(signedVolume6 > 1e-12)) {
    throw new RangeError("mesh faces must have outward, positive orientation");
  }

  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  let radius = 0;
  for (const v of vertices) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], v[axis]);
      max[axis] = Math.max(max[axis], v[axis]);
    }
    radius = Math.max(radius, Math.hypot(v[0], v[1], v[2]));
  }
  const center: Vec3 = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ];
  Object.freeze(cumulative);
  Object.freeze(min);
  Object.freeze(max);
  Object.freeze(center);
  const prepared: PreparedMeshAsset = {
    id,
    vertices,
    triangles,
    triangleCumulativeAreas: cumulative,
    totalArea,
    bounds: {
      min,
      max,
      center,
      radius,
    },
  };
  Object.freeze(prepared.bounds);
  Object.freeze(prepared);
  TRIANGLE_GEOMETRY.set(
    prepared,
    prepareTriangleGeometry(prepared.vertices, prepared.triangles),
  );
  return prepared;
}

function prepareCatalogAsset(
  id: MeshAssetId,
  factory: () => {
    vertices: Vec3[];
    triangles: [number, number, number][];
  },
): PreparedMeshAsset {
  const raw = factory();
  return ingestMeshAsset(id, raw.vertices, raw.triangles);
}

const CATALOG_FACTORIES: Record<MeshAssetId, () => PreparedMeshAsset> = {
  "star-prism-v1": () => prepareCatalogAsset("star-prism-v1", starPrismRaw),
  "faceted-crystal-v1": () =>
    prepareCatalogAsset("faceted-crystal-v1", facetedCrystalRaw),
  "heart-prism-v1": () => prepareCatalogAsset("heart-prism-v1", heartPrismRaw),
  "crescent-moon-v1": () =>
    prepareCatalogAsset("crescent-moon-v1", crescentMoonRaw),
  "snowflake-prism-v1": () =>
    prepareCatalogAsset("snowflake-prism-v1", snowflakePrismRaw),
  "trefoil-knot-v1": () =>
    prepareCatalogAsset("trefoil-knot-v1", trefoilKnotRaw),
};
const CATALOG = new Map<MeshAssetId, PreparedMeshAsset>();

export function meshAsset(id: MeshAssetId): PreparedMeshAsset {
  if (!isMeshAssetId(id))
    throw new RangeError(`unknown mesh asset id: ${String(id)}`);
  let asset = CATALOG.get(id);
  if (!asset) {
    asset = CATALOG_FACTORIES[id]();
    CATALOG.set(id, asset);
  }
  return asset;
}

export function meshAssetCatalogIndex(id: MeshAssetId): number {
  if (!isMeshAssetId(id))
    throw new RangeError(`unknown mesh asset id: ${String(id)}`);
  return MESH_ASSET_IDS.indexOf(id);
}

export function meshAssetIdAtCatalogIndex(index: number): MeshAssetId {
  const id = MESH_ASSET_IDS[index];
  if (id === undefined)
    throw new RangeError(`unknown mesh catalog index: ${index}`);
  return id;
}

// ------------------------------------------------------------- sampling

export function sampleMeshSurface(mesh: PreparedMeshAsset, rng: Rng): Vec3 {
  const needle = rng() * mesh.totalArea;
  const cdf = mesh.triangleCumulativeAreas;
  let lo = 0;
  let hi = cdf.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (needle < cdf[mid]) hi = mid;
    else lo = mid + 1;
  }
  const tri = mesh.triangles[lo];
  const a = mesh.vertices[tri[0]];
  const b = mesh.vertices[tri[1]];
  const c = mesh.vertices[tri[2]];
  const su = Math.sqrt(rng());
  const v = rng();
  const aw = 1 - su;
  const bw = (1 - v) * su;
  const cw = v * su;
  return [
    a[0] * aw + b[0] * bw + c[0] * cw,
    a[1] * aw + b[1] * bw + c[1] * cw,
    a[2] * aw + b[2] * bw + c[2] * cw,
  ];
}

// ------------------------------------------------------------- exact SDF

/** Squared distance to a triangle (Ericson's Voronoi-region algorithm). */
function pointTriangleDistanceSquared(
  px: number,
  py: number,
  pz: number,
  tri: PreparedTriangleGeometry,
): number {
  const apx = px - tri.ax;
  const apy = py - tri.ay;
  const apz = pz - tri.az;
  const d1 = tri.abx * apx + tri.aby * apy + tri.abz * apz;
  const d2 = tri.acx * apx + tri.acy * apy + tri.acz * apz;
  if (d1 <= 0 && d2 <= 0) return apx * apx + apy * apy + apz * apz;
  const bpx = px - tri.bx;
  const bpy = py - tri.by;
  const bpz = pz - tri.bz;
  const d3 = tri.abx * bpx + tri.aby * bpy + tri.abz * bpz;
  const d4 = tri.acx * bpx + tri.acy * bpy + tri.acz * bpz;
  if (d3 >= 0 && d4 <= d3) return bpx * bpx + bpy * bpy + bpz * bpz;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    const dx = apx - v * tri.abx;
    const dy = apy - v * tri.aby;
    const dz = apz - v * tri.abz;
    return dx * dx + dy * dy + dz * dz;
  }
  const cpx = px - tri.cx;
  const cpy = py - tri.cy;
  const cpz = pz - tri.cz;
  const d5 = tri.abx * cpx + tri.aby * cpy + tri.abz * cpz;
  const d6 = tri.acx * cpx + tri.acy * cpy + tri.acz * cpz;
  if (d6 >= 0 && d5 <= d6) return cpx * cpx + cpy * cpy + cpz * cpz;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    const dx = apx - w * tri.acx;
    const dy = apy - w * tri.acy;
    const dz = apz - w * tri.acz;
    return dx * dx + dy * dy + dz * dz;
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + d5 - d6);
    const dx = bpx + w * (tri.cx - tri.bx);
    const dy = bpy + w * (tri.cy - tri.by);
    const dz = bpz + w * (tri.cz - tri.bz);
    return dx * dx + dy * dy + dz * dz;
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  const dx = apx - tri.abx * v - tri.acx * w;
  const dy = apy - tri.aby * v - tri.acy * w;
  const dz = apz - tri.abz * v - tri.acz * w;
  return dx * dx + dy * dy + dz * dz;
}

/** Exact O(triangle-count) oracle retained for acceleration verification. */
export function meshUnsignedDistanceExact(
  mesh: PreparedMeshAsset,
  p: Vec3,
): number {
  let best = Infinity;
  for (const tri of triangleGeometry(mesh)) {
    const d = pointTriangleDistanceSquared(p[0], p[1], p[2], tri);
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

function pointBoundsDistanceSquared(
  px: number,
  py: number,
  pz: number,
  node: MeshBvhNode,
): number {
  const dx =
    px < node.minX ? node.minX - px : px > node.maxX ? px - node.maxX : 0;
  const dy =
    py < node.minY ? node.minY - py : py > node.maxY ? py - node.maxY : 0;
  const dz =
    pz < node.minZ ? node.minZ - pz : pz > node.maxZ ? pz - node.maxZ : 0;
  return dx * dx + dy * dy + dz * dz;
}

function nearestDistanceSquared(
  acceleration: PreparedMeshAcceleration,
  nodeIndex: number,
  px: number,
  py: number,
  pz: number,
  initialBest: number,
): number {
  let best = initialBest;
  const node = acceleration.nodes[nodeIndex];
  const lowerBound = pointBoundsDistanceSquared(px, py, pz, node);
  // The slack makes pruning conservative with respect to floating-point
  // roundoff in the AABB lower bound. Leaf results still use the exact oracle
  // primitive, so acceleration cannot invent a smaller triangle distance.
  const slack = 64 * Number.EPSILON * Math.max(1, lowerBound, best);
  if (lowerBound > best + slack) return best;

  if (node.left < 0) {
    for (let i = node.start; i < node.end; i++) {
      const tri = acceleration.triangles[acceleration.triangleOrder[i]];
      const distance = pointTriangleDistanceSquared(px, py, pz, tri);
      if (distance < best) best = distance;
    }
    return best;
  }

  const leftBound = pointBoundsDistanceSquared(
    px,
    py,
    pz,
    acceleration.nodes[node.left],
  );
  const rightBound = pointBoundsDistanceSquared(
    px,
    py,
    pz,
    acceleration.nodes[node.right],
  );
  if (leftBound <= rightBound) {
    best = nearestDistanceSquared(acceleration, node.left, px, py, pz, best);
    return nearestDistanceSquared(acceleration, node.right, px, py, pz, best);
  }
  best = nearestDistanceSquared(acceleration, node.right, px, py, pz, best);
  return nearestDistanceSquared(acceleration, node.left, px, py, pz, best);
}

/** Exact triangle distance accelerated by the mesh's deterministic BVH. */
export function meshUnsignedDistance(mesh: PreparedMeshAsset, p: Vec3): number {
  const acceleration = meshAcceleration(mesh);
  return Math.sqrt(
    nearestDistanceSquared(acceleration, 0, p[0], p[1], p[2], Infinity),
  );
}

function triangleRayCrossing(
  p: Vec3,
  direction: Vec3,
  tri: PreparedTriangleGeometry,
): 0 | 1 | null {
  const hx = direction[1] * tri.acz - direction[2] * tri.acy;
  const hy = direction[2] * tri.acx - direction[0] * tri.acz;
  const hz = direction[0] * tri.acy - direction[1] * tri.acx;
  const det = tri.abx * hx + tri.aby * hy + tri.abz * hz;
  if (Math.abs(det) < 1e-12) return 0;
  const invDet = 1 / det;
  const sx = p[0] - tri.ax;
  const sy = p[1] - tri.ay;
  const sz = p[2] - tri.az;
  const u = (sx * hx + sy * hy + sz * hz) * invDet;
  if (u < 0 || u > 1) return 0;
  const qx = sy * tri.abz - sz * tri.aby;
  const qy = sz * tri.abx - sx * tri.abz;
  const qz = sx * tri.aby - sy * tri.abx;
  const v =
    (direction[0] * qx + direction[1] * qy + direction[2] * qz) * invDet;
  if (v < 0 || u + v > 1) return 0;
  const t = (tri.acx * qx + tri.acy * qy + tri.acz * qz) * invDet;
  if (t <= 1e-12) return 0;
  // A hit on a shared edge/vertex is deliberately undecided rather than
  // double-counted. The caller retries a different irrational direction.
  if (Math.min(u, v, 1 - u - v) < 1e-10) return null;
  return 1;
}

function rayParityExact(
  mesh: PreparedMeshAsset,
  p: Vec3,
  direction: Vec3,
): boolean | null {
  let crossings = 0;
  for (const tri of triangleGeometry(mesh)) {
    const crossing = triangleRayCrossing(p, direction, tri);
    if (crossing === null) return null;
    crossings += crossing;
  }
  return (crossings & 1) === 1;
}

function rayIntersectsBounds(
  p: Vec3,
  direction: Vec3,
  node: MeshBvhNode,
): boolean {
  let tMin = -Infinity;
  let tMax = Infinity;
  for (let axis = 0; axis < 3; axis++) {
    const origin = p[axis];
    const delta = direction[axis];
    const lo = axis === 0 ? node.minX : axis === 1 ? node.minY : node.minZ;
    const hi = axis === 0 ? node.maxX : axis === 1 ? node.maxY : node.maxZ;
    if (delta === 0) {
      if (origin < lo || origin > hi) return false;
      continue;
    }
    let near = (lo - origin) / delta;
    let far = (hi - origin) / delta;
    if (near > far) [near, far] = [far, near];
    tMin = Math.max(tMin, near);
    tMax = Math.min(tMax, far);
  }
  const threshold = Math.max(tMin, 1e-12);
  const slack =
    64 * Number.EPSILON * Math.max(1, Math.abs(tMax), Math.abs(threshold));
  return tMax + slack >= threshold;
}

function rayCrossingsAccelerated(
  acceleration: PreparedMeshAcceleration,
  nodeIndex: number,
  p: Vec3,
  direction: Vec3,
): number | null {
  const node = acceleration.nodes[nodeIndex];
  if (!rayIntersectsBounds(p, direction, node)) return 0;
  if (node.left >= 0) {
    const left = rayCrossingsAccelerated(acceleration, node.left, p, direction);
    if (left === null) return null;
    const right = rayCrossingsAccelerated(
      acceleration,
      node.right,
      p,
      direction,
    );
    return right === null ? null : left + right;
  }
  let crossings = 0;
  for (let i = node.start; i < node.end; i++) {
    const tri = acceleration.triangles[acceleration.triangleOrder[i]];
    const crossing = triangleRayCrossing(p, direction, tri);
    if (crossing === null) return null;
    crossings += crossing;
  }
  return crossings;
}

function rayParityAccelerated(
  mesh: PreparedMeshAsset,
  p: Vec3,
  direction: Vec3,
): boolean | null {
  const crossings = rayCrossingsAccelerated(
    meshAcceleration(mesh),
    0,
    p,
    direction,
  );
  return crossings === null ? null : (crossings & 1) === 1;
}

/** Solid-angle fallback for the vanishingly rare all-rays-hit-an-edge case. */
function windingContainsPoint(mesh: PreparedMeshAsset, p: Vec3): boolean {
  let omega = 0;
  for (const tri of mesh.triangles) {
    const a = mesh.vertices[tri[0]];
    const b = mesh.vertices[tri[1]];
    const c = mesh.vertices[tri[2]];
    const ax = a[0] - p[0];
    const ay = a[1] - p[1];
    const az = a[2] - p[2];
    const bx = b[0] - p[0];
    const by = b[1] - p[1];
    const bz = b[2] - p[2];
    const cx = c[0] - p[0];
    const cy = c[1] - p[1];
    const cz = c[2] - p[2];
    const la = Math.hypot(ax, ay, az);
    const lb = Math.hypot(bx, by, bz);
    const lc = Math.hypot(cx, cy, cz);
    const numerator =
      ax * (by * cz - bz * cy) +
      ay * (bz * cx - bx * cz) +
      az * (bx * cy - by * cx);
    const denominator =
      la * lb * lc +
      (ax * bx + ay * by + az * bz) * lc +
      (bx * cx + by * cy + bz * cz) * la +
      (cx * ax + cy * ay + cz * az) * lb;
    omega += 2 * Math.atan2(numerator, denominator);
  }
  return Math.abs(omega) > 2 * Math.PI;
}

const SIGN_RAY_DIRECTIONS: readonly Vec3[] = [
  [1, 0.3713906763541037, 0.127831245441423],
  [0.193741, 1, 0.417239],
  [0.293117, 0.173891, 1],
];

/** Exact O(triangle-count) sign oracle retained for acceleration tests. */
export function meshContainsPointExact(
  mesh: PreparedMeshAsset,
  p: Vec3,
): boolean {
  for (const direction of SIGN_RAY_DIRECTIONS) {
    const parity = rayParityExact(mesh, p, direction);
    if (parity !== null) return parity;
  }
  return windingContainsPoint(mesh, p);
}

/** Robust parity sign accelerated by the mesh's deterministic BVH. */
export function meshContainsPoint(mesh: PreparedMeshAsset, p: Vec3): boolean {
  for (const direction of SIGN_RAY_DIRECTIONS) {
    const parity = rayParityAccelerated(mesh, p, direction);
    if (parity !== null) return parity;
  }
  return windingContainsPoint(mesh, p);
}

const F32 = new Float32Array(1);
const U32 = new Uint32Array(F32.buffer);

/** Largest finite float32 `<= value`, including negative values and -0. */
export function floorMeshValueToF32(value: number): number {
  if (!Number.isFinite(value))
    throw new RangeError("cannot floor non-finite mesh value");
  const rounded = Math.fround(value);
  if (rounded <= value) return rounded;
  F32[0] = rounded;
  // Positive f32 bit patterns increase with value; negative sign-magnitude
  // patterns run the other way.  -0 follows the negative arm.
  if (rounded > 0) U32[0] -= 1;
  else U32[0] += 1;
  return F32[0];
}

const BAKE_CACHE = new WeakMap<PreparedMeshAsset, Map<string, MeshSdfBake>>();

/** Bake one prepared object, preserving sampler/SDF geometry identity. */
export function bakePreparedMeshSdf(
  mesh: PreparedMeshAsset,
  resolution: number = 64,
): MeshSdfBake {
  if (!Number.isInteger(resolution) || resolution < 8 || resolution > 128) {
    throw new RangeError("mesh SDF resolution must be an integer in 8..128");
  }
  let meshCache = BAKE_CACHE.get(mesh);
  if (!meshCache) {
    meshCache = new Map<string, MeshSdfBake>();
    BAKE_CACHE.set(mesh, meshCache);
  }
  const key = `${MESH_SDF_BAKE_VERSION}:${resolution}`;
  const cached = meshCache.get(key);
  if (cached) return cached;
  const sourceSpan = Math.max(
    mesh.bounds.max[0] - mesh.bounds.min[0],
    mesh.bounds.max[1] - mesh.bounds.min[1],
    mesh.bounds.max[2] - mesh.bounds.min[2],
  );
  // Exactly two lattice spacings of padding on each side.
  const span = (sourceSpan * (resolution - 1)) / (resolution - 5);
  const cellSize = span / (resolution - 1);
  const cellRadius = (Math.sqrt(3) * cellSize) / 2;
  const min: Vec3 = [
    mesh.bounds.center[0] - span / 2,
    mesh.bounds.center[1] - span / 2,
    mesh.bounds.center[2] - span / 2,
  ];
  const max: Vec3 = [min[0] + span, min[1] + span, min[2] + span];
  Object.freeze(min);
  Object.freeze(max);
  const values = new Float32Array(resolution ** 3);
  const p: Vec3 = [0, 0, 0];
  for (let z = 0; z < resolution; z++) {
    p[2] = min[2] + z * cellSize;
    for (let y = 0; y < resolution; y++) {
      p[1] = min[1] + y * cellSize;
      for (let x = 0; x < resolution; x++) {
        p[0] = min[0] + x * cellSize;
        const unsigned = meshUnsignedDistance(mesh, p);
        let stored: number;
        if (unsigned < cellRadius) {
          // Safe on either side of an edge/vertex sign tie.
          stored = -2 * cellRadius;
        } else {
          const signed = meshContainsPoint(mesh, p) ? -unsigned : unsigned;
          stored = signed - cellRadius;
        }
        values[x + resolution * (y + resolution * z)] =
          floorMeshValueToF32(stored);
      }
    }
  }
  const bake: MeshSdfBake = {
    version: MESH_SDF_BAKE_VERSION,
    mesh,
    resolution,
    values,
    min,
    max,
    cellSize,
    cellRadius,
  };
  Object.freeze(bake);
  meshCache.set(key, bake);
  return bake;
}

export function bakeMeshSdf(
  id: MeshAssetId,
  resolution: number = 64,
): MeshSdfBake {
  return bakePreparedMeshSdf(meshAsset(id), resolution);
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

/** Manual trilinear sample of the conservative node lattice. */
export function sampleMeshSdf(
  bake: MeshSdfBake,
  x: number,
  y: number,
  z: number,
): number {
  const n = bake.resolution;
  const coords = [x, y, z] as Vec3;
  const i0 = [0, 0, 0] as Vec3;
  const i1 = [0, 0, 0] as Vec3;
  const f = [0, 0, 0] as Vec3;
  for (let axis = 0; axis < 3; axis++) {
    const g =
      (clamp(coords[axis], bake.min[axis], bake.max[axis]) - bake.min[axis]) /
      bake.cellSize;
    const base = Math.min(Math.floor(g), n - 1);
    i0[axis] = base;
    i1[axis] = Math.min(base + 1, n - 1);
    f[axis] = base === n - 1 ? 0 : g - base;
  }
  const at = (ix: number, iy: number, iz: number): number =>
    bake.values[ix + n * (iy + n * iz)];
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  const x00 = lerp(at(i0[0], i0[1], i0[2]), at(i1[0], i0[1], i0[2]), f[0]);
  const x10 = lerp(at(i0[0], i1[1], i0[2]), at(i1[0], i1[1], i0[2]), f[0]);
  const x01 = lerp(at(i0[0], i0[1], i1[2]), at(i1[0], i0[1], i1[2]), f[0]);
  const x11 = lerp(at(i0[0], i1[1], i1[2]), at(i1[0], i1[1], i1[2]), f[0]);
  const interpolated = lerp(lerp(x00, x10, f[1]), lerp(x01, x11, f[1]), f[2]);
  // The bake cube contains the whole mesh. Outside it, distance to that
  // containing box is itself a lower bound on distance to the mesh. The
  // clamped interpolation is also a lower bound (coordinate projection
  // toward any point in the box can only shorten distance), so their max is
  // conservative and prevents a far query from inheriting one tiny border
  // texel forever.
  const ox = Math.max(bake.min[0] - x, 0, x - bake.max[0]);
  const oy = Math.max(bake.min[1] - y, 0, y - bake.max[1]);
  const oz = Math.max(bake.min[2] - z, 0, z - bake.max[2]);
  const boxDistance = Math.hypot(ox, oy, oz);
  return boxDistance > 0 ? Math.max(interpolated, boxDistance) : interpolated;
}

/** Build one z-slab atlas; callers use entry metadata for manual loads. */
export function meshSdfAtlas(
  ids: readonly MeshAssetId[] = MESH_ASSET_IDS,
  resolution: number = 64,
): MeshSdfAtlas {
  const unique = [...new Set(ids)];
  const bakes = unique.map((id) => bakeMeshSdf(id, resolution));
  const values = new Float32Array(Math.max(1, unique.length) * resolution ** 3);
  const entries = bakes.map((bake, slabIndex): MeshSdfAtlasEntry => {
    values.set(bake.values, slabIndex * resolution ** 3);
    return Object.freeze({
      meshId: bake.mesh.id,
      catalogIndex: meshAssetCatalogIndex(bake.mesh.id),
      zOffset: slabIndex * resolution,
      resolution,
      min: bake.min,
      max: bake.max,
      cellSize: bake.cellSize,
      cellRadius: bake.cellRadius,
    });
  });
  return Object.freeze({
    version: MESH_SDF_BAKE_VERSION,
    resolution,
    width: resolution,
    height: resolution,
    depth: Math.max(1, unique.length) * resolution,
    values,
    entries: Object.freeze(entries),
  });
}
