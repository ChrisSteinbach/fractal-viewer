/**
 * Portable, source-only custom-mesh manifest codec.
 *
 * The surrounding scene-file envelope owns scenes and thumbnails. This
 * module owns only their content-addressed mesh dependencies. Geometry is a
 * deterministic little-endian binary blob encoded as canonical unpadded
 * base64url. Derived SDF bakes are deliberately not part of this format.
 *
 * Decoding is split in two. {@link parsePortableMeshManifest} performs cheap
 * synchronous shape, reference and budget checks. The asynchronous
 * {@link validatePortableMeshManifest} then verifies every SHA-256 key. Full
 * topology and self-intersection validation deliberately stays in the mesh
 * worker; a caller must publish neither scenes nor sources until that worker
 * has validated every returned source.
 */
import {
  canonicalCustomMeshSourceBytes,
  CUSTOM_MESH_CANONICAL_HEADER_BYTES,
  CUSTOM_MESH_CANONICAL_MAGIC,
  customMeshContentIdFromBytes,
  MAX_CUSTOM_MESH_TRIANGLES,
  MAX_CUSTOM_MESH_VERTICES,
  MAX_CUSTOM_MESHES_PER_SCENE,
  type MeshDigest,
} from "../fractal/custom-mesh";
import {
  isCustomMeshAssetId,
  type CustomMeshAssetId,
  type SerializedPreparedMeshAsset,
} from "../fractal/mesh-shapes";

export const PORTABLE_MESH_MANIFEST_VERSION = 1;
export const PORTABLE_MESH_GEOMETRY_VERSION = 1;

/** The same aggregate working-set cap enforced before collection/timeline
 * playback. Importing a portable bundle must not sidestep the runtime budget
 * by spreading distinct assets across many saved scenes. */
export const MAX_PORTABLE_MESH_ASSETS = MAX_CUSTOM_MESHES_PER_SCENE;
export const MAX_PORTABLE_MESH_VERTICES =
  MAX_PORTABLE_MESH_ASSETS * MAX_CUSTOM_MESH_VERTICES;
export const MAX_PORTABLE_MESH_TRIANGLES =
  MAX_PORTABLE_MESH_ASSETS * MAX_CUSTOM_MESH_TRIANGLES;
/** Four maximum-size canonical sources: 24 bytes per vertex, 12 per triangle,
 * plus a small versioned header for each geometry. */
export const MAX_PORTABLE_MESH_GEOMETRY_BYTES =
  MAX_PORTABLE_MESH_VERTICES * 24 +
  MAX_PORTABLE_MESH_TRIANGLES * 12 +
  MAX_PORTABLE_MESH_ASSETS * CUSTOM_MESH_CANONICAL_HEADER_BYTES;

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const DISPLAY_NAME_PATTERN = /^[^\p{Cc}]{1,160}$/u;

/** The array representation makes duplicate digest keys observable and
 * rejectable after JSON.parse; an object map cannot preserve that fact. */
export interface PortableMeshGeometryWire {
  readonly id: CustomMeshAssetId;
  readonly version: typeof PORTABLE_MESH_GEOMETRY_VERSION;
  readonly name: string;
  readonly geometry: string;
}

export interface PortableMeshManifestWire {
  readonly version: typeof PORTABLE_MESH_MANIFEST_VERSION;
  readonly geometries: readonly PortableMeshGeometryWire[];
}

export interface ParsedPortableMeshManifest {
  readonly version: typeof PORTABLE_MESH_MANIFEST_VERSION;
  readonly sources: readonly SerializedPreparedMeshAsset[];
}

export interface ValidatedPortableMeshManifest extends ParsedPortableMeshManifest {
  /** Marker preventing a merely structurally parsed manifest from being
   * mistaken for one whose content digests were validated. */
  readonly validated: true;
}

function defaultDigest(bytes: Uint8Array<ArrayBuffer>): Promise<ArrayBuffer> {
  if (!globalThis.crypto?.subtle) {
    return Promise.reject(new Error("SHA-256 is unavailable in this browser"));
  }
  return globalThis.crypto.subtle.digest("SHA-256", bytes);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function decodedBase64urlLength(text: string): number | null {
  if (!BASE64URL_PATTERN.test(text) || text.length % 4 === 1) return null;
  const remainder = text.length % 4;
  return (
    Math.floor(text.length / 4) * 3 +
    (remainder === 2 ? 1 : remainder === 3 ? 2 : 0)
  );
}

function encodeBase64url(bytes: Uint8Array<ArrayBuffer>): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}

function decodeBase64url(
  text: string,
  expectedLength: number,
): Uint8Array<ArrayBuffer> | null {
  try {
    const standard = text.replace(/-/g, "+").replace(/_/g, "/");
    const padded = standard + "=".repeat((4 - (standard.length % 4)) % 4);
    const binary = atob(padded);
    if (binary.length !== expectedLength) return null;
    const bytes = new Uint8Array(expectedLength);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    // Reject alternate/non-canonical spellings, even if the platform's atob
    // happens to accept them.
    return encodeBase64url(bytes) === text ? bytes : null;
  } catch {
    return null;
  }
}

function compareVertexAt(
  vertices: Float64Array<ArrayBuffer>,
  left: number,
  right: number,
): number {
  const a = left * 3;
  const b = right * 3;
  return (
    vertices[a] - vertices[b] ||
    vertices[a + 1] - vertices[b + 1] ||
    vertices[a + 2] - vertices[b + 2]
  );
}

function compareTriangleAt(
  triangles: Uint32Array<ArrayBuffer>,
  left: number,
  right: number,
): number {
  const a = left * 3;
  const b = right * 3;
  return (
    triangles[a] - triangles[b] ||
    triangles[a + 1] - triangles[b + 1] ||
    triangles[a + 2] - triangles[b + 2]
  );
}

interface GeometryHeader {
  readonly vertexCount: number;
  readonly triangleCount: number;
  readonly byteLength: number;
}

function geometryHeader(bytes: Uint8Array<ArrayBuffer>): GeometryHeader | null {
  if (bytes.byteLength < CUSTOM_MESH_CANONICAL_HEADER_BYTES) return null;
  for (let index = 0; index < CUSTOM_MESH_CANONICAL_MAGIC.length; index += 1) {
    if (bytes[index] !== CUSTOM_MESH_CANONICAL_MAGIC[index]) return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const vertexCount = view.getUint32(
    CUSTOM_MESH_CANONICAL_MAGIC.byteLength,
    true,
  );
  const triangleCount = view.getUint32(
    CUSTOM_MESH_CANONICAL_MAGIC.byteLength + 4,
    true,
  );
  if (
    vertexCount < 4 ||
    vertexCount > MAX_CUSTOM_MESH_VERTICES ||
    triangleCount < 4 ||
    triangleCount > MAX_CUSTOM_MESH_TRIANGLES
  ) {
    return null;
  }
  const byteLength =
    CUSTOM_MESH_CANONICAL_HEADER_BYTES + vertexCount * 24 + triangleCount * 12;
  return bytes.byteLength === byteLength
    ? { vertexCount, triangleCount, byteLength }
    : null;
}

function decodeGeometry(
  bytes: Uint8Array<ArrayBuffer>,
  id: CustomMeshAssetId,
  name: string,
  header: GeometryHeader,
): SerializedPreparedMeshAsset | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const vertices = new Float64Array(header.vertexCount * 3);
  const triangles = new Uint32Array(header.triangleCount * 3);
  let offset = CUSTOM_MESH_CANONICAL_HEADER_BYTES;
  for (let index = 0; index < vertices.length; index += 1) {
    const value = view.getFloat64(offset, true);
    if (!Number.isFinite(value) || Object.is(value, -0)) return null;
    vertices[index] = value;
    offset += 8;
  }
  for (let index = 0; index < triangles.length; index += 1) {
    triangles[index] = view.getUint32(offset, true);
    offset += 4;
  }

  // Canonical OBJ ingestion sorts unique vertices and minimum-rotated faces.
  // Enforcing that order keeps one authoritative byte representation rather
  // than accepting many digests for equivalent indexed geometry.
  for (let index = 1; index < header.vertexCount; index += 1) {
    if (compareVertexAt(vertices, index - 1, index) >= 0) return null;
  }
  for (let index = 0; index < header.triangleCount; index += 1) {
    const at = index * 3;
    const a = triangles[at];
    const b = triangles[at + 1];
    const c = triangles[at + 2];
    if (
      a >= header.vertexCount ||
      b >= header.vertexCount ||
      c >= header.vertexCount
    ) {
      return null;
    }
    if (a > b || a > c) return null;
    if (index > 0 && compareTriangleAt(triangles, index - 1, index) >= 0) {
      return null;
    }
  }
  return { id, name, vertices, triangles };
}

function encodeGeometry(
  source: SerializedPreparedMeshAsset,
): Uint8Array<ArrayBuffer> {
  if (source.vertices.length % 3 !== 0 || source.triangles.length % 3 !== 0) {
    throw new RangeError("portable mesh arrays are malformed");
  }
  const vertexCount = source.vertices.length / 3;
  const triangleCount = source.triangles.length / 3;
  if (
    vertexCount < 4 ||
    vertexCount > MAX_CUSTOM_MESH_VERTICES ||
    triangleCount < 4 ||
    triangleCount > MAX_CUSTOM_MESH_TRIANGLES
  ) {
    throw new RangeError("portable mesh exceeds the per-geometry budget");
  }
  for (const value of source.vertices) {
    if (!Number.isFinite(value)) {
      throw new RangeError("portable mesh contains a non-finite vertex");
    }
  }
  return canonicalCustomMeshSourceBytes(source.vertices, source.triangles);
}

function exactReferenceSet(
  ids: readonly CustomMeshAssetId[],
): Set<CustomMeshAssetId> | null {
  const unique = new Set<CustomMeshAssetId>();
  for (const id of ids) {
    if (!isCustomMeshAssetId(id)) return null;
    unique.add(id);
    if (unique.size > MAX_PORTABLE_MESH_ASSETS) return null;
  }
  return unique.size > 0 ? unique : null;
}

/**
 * Cheap fail-closed trust-boundary stage. The manifest must be nonempty and
 * its unique digest keys must exactly equal all custom-mesh references from
 * the already-decoded scene(s): missing and unused entries reject the whole
 * bundle. No source is installed here.
 */
export function parsePortableMeshManifest(
  value: unknown,
  referencedIds: readonly CustomMeshAssetId[],
): ParsedPortableMeshManifest | null {
  try {
    const references = exactReferenceSet(referencedIds);
    if (references === null || !isRecord(value)) return null;
    if (!hasExactKeys(value, ["geometries", "version"])) return null;
    if (value.version !== PORTABLE_MESH_MANIFEST_VERSION) return null;
    if (!Array.isArray(value.geometries)) return null;
    if (
      value.geometries.length < 1 ||
      value.geometries.length > MAX_PORTABLE_MESH_ASSETS ||
      value.geometries.length !== references.size
    ) {
      return null;
    }

    let totalVertices = 0;
    let totalTriangles = 0;
    let totalBytes = 0;
    const seen = new Set<CustomMeshAssetId>();
    const sources: SerializedPreparedMeshAsset[] = [];
    let previousId: CustomMeshAssetId | null = null;
    for (const raw of value.geometries) {
      if (!isRecord(raw)) return null;
      if (!hasExactKeys(raw, ["geometry", "id", "name", "version"])) {
        return null;
      }
      const { id, version, name, geometry } = raw;
      if (
        !isCustomMeshAssetId(id) ||
        version !== PORTABLE_MESH_GEOMETRY_VERSION ||
        typeof name !== "string" ||
        !DISPLAY_NAME_PATTERN.test(name) ||
        typeof geometry !== "string" ||
        !references.has(id) ||
        seen.has(id) ||
        (previousId !== null && id.localeCompare(previousId) <= 0)
      ) {
        return null;
      }
      seen.add(id);
      previousId = id;
      const byteLength = decodedBase64urlLength(geometry);
      if (
        byteLength === null ||
        byteLength > MAX_PORTABLE_MESH_GEOMETRY_BYTES
      ) {
        return null;
      }
      totalBytes += byteLength;
      if (totalBytes > MAX_PORTABLE_MESH_GEOMETRY_BYTES) return null;
      const bytes = decodeBase64url(geometry, byteLength);
      if (bytes === null) return null;
      const header = geometryHeader(bytes);
      if (header === null) return null;
      totalVertices += header.vertexCount;
      totalTriangles += header.triangleCount;
      if (
        totalVertices > MAX_PORTABLE_MESH_VERTICES ||
        totalTriangles > MAX_PORTABLE_MESH_TRIANGLES
      ) {
        return null;
      }
      const source = decodeGeometry(bytes, id, name, header);
      if (source === null) return null;
      sources.push(source);
    }
    if (seen.size !== references.size) return null;
    sources.sort((left, right) => left.id.localeCompare(right.id));
    return Object.freeze({
      version: PORTABLE_MESH_MANIFEST_VERSION,
      sources: Object.freeze(sources),
    });
  } catch {
    return null;
  }
}

/** Verify every content id without mutating the registry. Full solid
 * validation belongs to the custom-mesh worker, never this main-thread
 * codec. */
export async function validatePortableMeshManifest(
  parsed: ParsedPortableMeshManifest,
  digest: MeshDigest = defaultDigest,
): Promise<ValidatedPortableMeshManifest | null> {
  try {
    for (const source of parsed.sources) {
      const bytes = encodeGeometry(source);
      if ((await customMeshContentIdFromBytes(bytes, digest)) !== source.id) {
        return null;
      }
    }
    return Object.freeze({
      version: PORTABLE_MESH_MANIFEST_VERSION,
      sources: parsed.sources,
      validated: true as const,
    });
  } catch {
    return null;
  }
}

/** Convenience composition of the two fail-closed decode stages. */
export async function decodePortableMeshManifest(
  value: unknown,
  referencedIds: readonly CustomMeshAssetId[],
  digest: MeshDigest = defaultDigest,
): Promise<ValidatedPortableMeshManifest | null> {
  const parsed = parsePortableMeshManifest(value, referencedIds);
  return parsed === null ? null : validatePortableMeshManifest(parsed, digest);
}

/**
 * Build a canonical source-only manifest. References and supplied sources
 * must be an exact set; duplicates, dangling sources, budget excesses,
 * digest mismatches and structurally invalid geometry throw before any wire
 * is returned. Full solid validation has already happened for normal runtime
 * sources and is repeated in the worker on import.
 */
export async function encodePortableMeshManifest(
  sources: readonly SerializedPreparedMeshAsset[],
  referencedIds: readonly CustomMeshAssetId[],
  digest: MeshDigest = defaultDigest,
): Promise<PortableMeshManifestWire> {
  const references = exactReferenceSet(referencedIds);
  if (references === null || sources.length !== references.size) {
    throw new RangeError("portable mesh sources do not match scene references");
  }
  const byId = new Map<CustomMeshAssetId, SerializedPreparedMeshAsset>();
  for (const source of sources) {
    if (
      !isCustomMeshAssetId(source.id) ||
      !references.has(source.id) ||
      byId.has(source.id) ||
      !DISPLAY_NAME_PATTERN.test(source.name)
    ) {
      throw new RangeError("portable mesh sources are invalid or duplicated");
    }
    byId.set(source.id, source);
  }

  let totalVertices = 0;
  let totalTriangles = 0;
  let totalBytes = 0;
  const geometries: PortableMeshGeometryWire[] = [];
  for (const id of [...references].sort()) {
    const source = byId.get(id);
    if (source === undefined) {
      throw new RangeError("portable mesh source is missing");
    }
    const bytes = encodeGeometry(source);
    const header = geometryHeader(bytes);
    if (
      header === null ||
      decodeGeometry(bytes, source.id, source.name, header) === null
    ) {
      throw new RangeError("portable mesh geometry is not canonical");
    }
    if ((await customMeshContentIdFromBytes(bytes, digest)) !== id) {
      throw new RangeError("portable mesh content id does not match geometry");
    }
    totalVertices += source.vertices.length / 3;
    totalTriangles += source.triangles.length / 3;
    totalBytes += bytes.byteLength;
    if (
      totalVertices > MAX_PORTABLE_MESH_VERTICES ||
      totalTriangles > MAX_PORTABLE_MESH_TRIANGLES ||
      totalBytes > MAX_PORTABLE_MESH_GEOMETRY_BYTES
    ) {
      throw new RangeError("portable mesh manifest exceeds aggregate budgets");
    }
    geometries.push({
      id,
      version: PORTABLE_MESH_GEOMETRY_VERSION,
      name: source.name,
      geometry: encodeBase64url(bytes),
    });
  }
  return Object.freeze({
    version: PORTABLE_MESH_MANIFEST_VERSION,
    geometries: Object.freeze(geometries),
  });
}
