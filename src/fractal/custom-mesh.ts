/**
 * Strict local OBJ ingestion and deterministic content addressing.
 *
 * This module deliberately accepts a small language: UTF-8 text containing
 * comments, one optional `o` declaration, `v x y z` vertices and plain
 * positive-index `f a b c` triangles. Materials, normals, texture
 * coordinates, negative/relative indices and polygon triangulation stay out
 * of the trust boundary. Geometry is centred and uniformly scaled to a
 * longest AABB span of two, then deduplicated and sorted before hashing.
 */
import {
  MAX_LOCAL_MESH_TRIANGLES,
  MAX_LOCAL_MESH_VERTICES,
  MAX_CUSTOM_MESHES_PER_SCENE,
  ingestMeshAsset,
  type CustomMeshAssetId,
  type PreparedMeshAsset,
} from "./mesh-shapes";
import type { Vec3 } from "./types";

export { MAX_CUSTOM_MESHES_PER_SCENE } from "./mesh-shapes";

export const MAX_CUSTOM_MESH_OBJ_BYTES = 4 * 1024 * 1024;
export const MAX_CUSTOM_MESH_VERTICES = MAX_LOCAL_MESH_VERTICES;
export const MAX_CUSTOM_MESH_TRIANGLES = MAX_LOCAL_MESH_TRIANGLES;
export const CUSTOM_MESH_SDF_RESOLUTION = 64;
export const MAX_CUSTOM_MESH_SDF_VOXELS =
  MAX_CUSTOM_MESHES_PER_SCENE * CUSTOM_MESH_SDF_RESOLUTION ** 3;

const NUMBER_TOKEN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const INDEX_TOKEN = /^[1-9]\d*$/;
export const CUSTOM_MESH_CANONICAL_MAGIC = new TextEncoder().encode(
  "fractal-mesh-v1\0",
);
export const CUSTOM_MESH_CANONICAL_HEADER_BYTES =
  CUSTOM_MESH_CANONICAL_MAGIC.byteLength + 8;

export interface CanonicalMeshGeometry {
  readonly name: string;
  readonly vertices: readonly Vec3[];
  readonly triangles: readonly (readonly [number, number, number])[];
  readonly bytes: Uint8Array<ArrayBuffer>;
}

export interface PreparedCustomMesh {
  readonly id: CustomMeshAssetId;
  readonly geometry: CanonicalMeshGeometry;
  readonly asset: PreparedMeshAsset;
}

function parseNumber(token: string, line: number): number {
  if (!NUMBER_TOKEN.test(token)) {
    throw new RangeError(`OBJ line ${line}: invalid finite vertex number`);
  }
  const value = Number(token);
  if (!Number.isFinite(value)) {
    throw new RangeError(`OBJ line ${line}: invalid finite vertex number`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function cleanMeshName(name: string): string {
  const trimmed = name
    .trim()
    .replace(/\p{Cc}/gu, " ")
    .trim();
  return (trimmed || "Imported mesh").slice(0, 160);
}

function compareVec3(a: Vec3, b: Vec3): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function rotateTriangleMinimumFirst(
  triangle: readonly [number, number, number],
): [number, number, number] {
  const [a, b, c] = triangle;
  if (b < a && b < c) return [b, c, a];
  if (c < a && c < b) return [c, a, b];
  return [a, b, c];
}

function compareTriangle(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** Authoritative digest/source byte layout shared by OBJ ingestion, durable
 * storage, and portable bundles. Inputs may be prepared tuple arrays or their
 * structured-clone flat typed-array wire representation. */
export function canonicalCustomMeshSourceBytes(
  vertices: readonly Vec3[] | Float64Array,
  triangles: readonly (readonly [number, number, number])[] | Uint32Array,
): Uint8Array<ArrayBuffer> {
  const flatVertices = vertices instanceof Float64Array;
  const flatTriangles = triangles instanceof Uint32Array;
  if (
    (flatVertices && vertices.length % 3 !== 0) ||
    (flatTriangles && triangles.length % 3 !== 0)
  ) {
    throw new RangeError("canonical custom-mesh arrays are malformed");
  }
  const vertexCount = flatVertices ? vertices.length / 3 : vertices.length;
  const triangleCount = flatTriangles ? triangles.length / 3 : triangles.length;
  const byteLength =
    CUSTOM_MESH_CANONICAL_HEADER_BYTES + vertexCount * 24 + triangleCount * 12;
  const bytes = new Uint8Array(byteLength);
  bytes.set(CUSTOM_MESH_CANONICAL_MAGIC, 0);
  const view = new DataView(bytes.buffer);
  let offset = CUSTOM_MESH_CANONICAL_MAGIC.byteLength;
  view.setUint32(offset, vertexCount, true);
  offset += 4;
  view.setUint32(offset, triangleCount, true);
  offset += 4;
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = flatVertices
        ? vertices[vertex * 3 + axis]
        : vertices[vertex][axis];
      view.setFloat64(offset, Object.is(value, -0) ? 0 : value, true);
      offset += 8;
    }
  }
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    for (let corner = 0; corner < 3; corner += 1) {
      const index = flatTriangles
        ? triangles[triangle * 3 + corner]
        : triangles[triangle][corner];
      view.setUint32(offset, index, true);
      offset += 4;
    }
  }
  return bytes;
}

/** Parse, normalize and structurally canonicalize the accepted OBJ subset. */
export function canonicalizeCustomMeshObj(
  source: string,
  fallbackName = "Imported mesh",
): CanonicalMeshGeometry {
  const byteLength = new TextEncoder().encode(source).byteLength;
  if (byteLength > MAX_CUSTOM_MESH_OBJ_BYTES) {
    throw new RangeError(
      `OBJ exceeds the ${MAX_CUSTOM_MESH_OBJ_BYTES}-byte import limit`,
    );
  }

  const rawVertices: Vec3[] = [];
  const rawTriangles: [number, number, number][] = [];
  let objectName: string | null = null;
  const lines = source.replace(/^\uFEFF/, "").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    if (lines[index].length > 4096) {
      throw new RangeError(
        `OBJ line ${lineNumber}: line exceeds 4096 characters`,
      );
    }
    const body = lines[index].split("#", 1)[0].trim();
    if (body === "") continue;
    const tokens = body.split(/\s+/);
    const directive = tokens[0];
    if (directive === "o") {
      if (objectName !== null || rawTriangles.length > 0 || tokens.length < 2) {
        throw new RangeError(
          `OBJ line ${lineNumber}: exactly one object declaration is allowed before faces`,
        );
      }
      objectName = cleanMeshName(tokens.slice(1).join(" "));
      continue;
    }
    if (directive === "v") {
      if (rawTriangles.length > 0) {
        throw new RangeError(
          `OBJ line ${lineNumber}: all vertices must precede faces`,
        );
      }
      if (tokens.length !== 4) {
        throw new RangeError(
          `OBJ line ${lineNumber}: vertices must be exactly "v x y z"`,
        );
      }
      if (rawVertices.length >= MAX_CUSTOM_MESH_VERTICES) {
        throw new RangeError(
          `OBJ exceeds the ${MAX_CUSTOM_MESH_VERTICES}-vertex import limit`,
        );
      }
      rawVertices.push([
        parseNumber(tokens[1], lineNumber),
        parseNumber(tokens[2], lineNumber),
        parseNumber(tokens[3], lineNumber),
      ]);
      continue;
    }
    if (directive === "f") {
      if (
        tokens.length !== 4 ||
        !tokens.slice(1).every((t) => INDEX_TOKEN.test(t))
      ) {
        throw new RangeError(
          `OBJ line ${lineNumber}: faces must be positive-index triangles "f a b c"`,
        );
      }
      if (rawTriangles.length >= MAX_CUSTOM_MESH_TRIANGLES) {
        throw new RangeError(
          `OBJ exceeds the ${MAX_CUSTOM_MESH_TRIANGLES}-triangle import limit`,
        );
      }
      const triangle = tokens.slice(1).map((token) => Number(token) - 1) as [
        number,
        number,
        number,
      ];
      if (triangle.some((vertex) => vertex >= rawVertices.length)) {
        throw new RangeError(
          `OBJ line ${lineNumber}: faces may reference only earlier vertices`,
        );
      }
      rawTriangles.push(triangle);
      continue;
    }
    throw new RangeError(
      `OBJ line ${lineNumber}: unsupported directive "${directive}"`,
    );
  }
  if (rawVertices.length < 4 || rawTriangles.length < 4) {
    throw new RangeError("OBJ needs at least four vertices and four triangles");
  }

  const used = new Set(rawTriangles.flat());
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const index of used) {
    const vertex = rawVertices[index];
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], vertex[axis]);
      max[axis] = Math.max(max[axis], vertex[axis]);
    }
  }
  const span = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  if (!(span > 1e-12) || !Number.isFinite(span)) {
    throw new RangeError("OBJ bounds are degenerate");
  }
  const center: Vec3 = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ];
  const scale = 2 / span;

  const uniqueByValue = new Map<string, Vec3>();
  const originalKeys = new Map<number, string>();
  for (const index of used) {
    const sourceVertex = rawVertices[index];
    const vertex: Vec3 = [
      (sourceVertex[0] - center[0]) * scale,
      (sourceVertex[1] - center[1]) * scale,
      (sourceVertex[2] - center[2]) * scale,
    ].map((value) => (Object.is(value, -0) ? 0 : value)) as Vec3;
    const key = `${String(vertex[0])}\0${String(vertex[1])}\0${String(vertex[2])}`;
    uniqueByValue.set(key, vertex);
    originalKeys.set(index, key);
  }
  const vertices = [...uniqueByValue.values()].sort(compareVec3);
  const indexByKey = new Map<string, number>();
  vertices.forEach((vertex, index) => {
    indexByKey.set(
      `${String(vertex[0])}\0${String(vertex[1])}\0${String(vertex[2])}`,
      index,
    );
  });
  const triangles = rawTriangles
    .map((triangle): [number, number, number] => {
      const mapped = triangle.map((index) => {
        const key = originalKeys.get(index);
        const canonical = key === undefined ? undefined : indexByKey.get(key);
        if (canonical === undefined) {
          throw new RangeError("OBJ face references an unused vertex");
        }
        return canonical;
      }) as [number, number, number];
      return rotateTriangleMinimumFirst(mapped);
    })
    .sort(compareTriangle);

  const frozenVertices = Object.freeze(
    vertices.map((vertex) => Object.freeze(vertex) as Vec3),
  );
  const frozenTriangles = Object.freeze(
    triangles.map((triangle) => Object.freeze(triangle)),
  );
  return Object.freeze({
    name: cleanMeshName(objectName ?? fallbackName),
    vertices: frozenVertices,
    triangles: frozenTriangles,
    bytes: canonicalCustomMeshSourceBytes(frozenVertices, frozenTriangles),
  });
}

export type MeshDigest = (
  bytes: Uint8Array<ArrayBuffer>,
) => Promise<ArrayBuffer>;

async function defaultDigest(
  bytes: Uint8Array<ArrayBuffer>,
): Promise<ArrayBuffer> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("SHA-256 is unavailable in this browser");
  }
  return globalThis.crypto.subtle.digest("SHA-256", bytes);
}

export async function customMeshContentId(
  geometry: CanonicalMeshGeometry,
  digest: MeshDigest = defaultDigest,
): Promise<CustomMeshAssetId> {
  return customMeshContentIdFromBytes(geometry.bytes, digest);
}

export async function customMeshContentIdFromBytes(
  bytes: Uint8Array<ArrayBuffer>,
  digest: MeshDigest = defaultDigest,
): Promise<CustomMeshAssetId> {
  const hash = new Uint8Array(await digest(bytes));
  if (hash.byteLength !== 32) {
    throw new Error("SHA-256 returned an invalid digest length");
  }
  const hex = [...hash]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return `mesh-sha256-${hex}`;
}

/** Canonicalize, content-address and run the shared prepared-mesh validator. */
export async function prepareCustomMeshObj(
  source: string,
  fallbackName = "Imported mesh",
  digest: MeshDigest = defaultDigest,
): Promise<PreparedCustomMesh> {
  const geometry = canonicalizeCustomMeshObj(source, fallbackName);
  const id = await customMeshContentId(geometry, digest);
  const asset = ingestMeshAsset(
    id,
    geometry.vertices,
    geometry.triangles,
    geometry.name,
  );
  return Object.freeze({ id, geometry, asset });
}
