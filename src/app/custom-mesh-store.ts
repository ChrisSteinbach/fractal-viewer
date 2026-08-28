/**
 * Durable, content-addressed custom-mesh storage.
 *
 * Source geometry is immutable: a content id may be inserted once, and a
 * later insert is accepted only when its canonical vertex/index bytes are
 * identical. SDF bakes are derived cache entries and are therefore keyed by
 * mesh id, bake-algorithm version and resolution. One import writes its
 * source and initial bake in the same IndexedDB transaction, so a failed
 * cache write can never leave a source-only half import behind.
 */
import {
  isCustomMeshAssetId,
  type CustomMeshAssetId,
  type SerializedMeshSdfBake,
  type SerializedPreparedMeshAsset,
} from "../fractal/mesh-shapes";
import {
  canonicalCustomMeshSourceBytes,
  customMeshContentIdFromBytes,
  MAX_CUSTOM_MESH_TRIANGLES,
  MAX_CUSTOM_MESH_VERTICES,
} from "../fractal/custom-mesh";

export const CUSTOM_MESH_DB_NAME = "fractal-viewer-assets";
export const CUSTOM_MESH_DB_VERSION = 1;
export const CUSTOM_MESH_SOURCE_STORE = "meshSources";
export const CUSTOM_MESH_BAKE_STORE = "meshBakes";

const SOURCE_RECORD_VERSION = 1;
const BAKE_RECORD_VERSION = 1;
const BAKE_MAGIC = new TextEncoder().encode("fractal-mesh-sdf-v1\0");
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

interface CustomMeshSourceRecord extends SerializedPreparedMeshAsset {
  readonly recordVersion: typeof SOURCE_RECORD_VERSION;
}

interface CustomMeshBakeRecord extends SerializedMeshSdfBake {
  readonly recordVersion: typeof BAKE_RECORD_VERSION;
  /** Durable compound-key spelling; mirrors the wire's `version`. */
  readonly algorithmVersion: number;
  readonly checksum: string;
}

export type CustomMeshReadResult<T> =
  | { readonly status: "found"; readonly value: T }
  | { readonly status: "missing" }
  | { readonly status: "corrupt"; readonly reason: string };

export type CustomMeshPutResult = "stored" | "already-stored";

export interface CustomMeshSourceAndBake {
  readonly source: SerializedPreparedMeshAsset;
  readonly bake: SerializedMeshSdfBake;
}

export class CustomMeshSourceConflictError extends Error {
  constructor(id: CustomMeshAssetId) {
    super(`custom mesh ${id} conflicts with its immutable stored source`);
    this.name = "CustomMeshSourceConflictError";
  }
}

export class CustomMeshStoreError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CustomMeshStoreError";
  }
}

export type CustomMeshDigest = (
  bytes: Uint8Array<ArrayBuffer>,
) => Promise<ArrayBuffer>;

export interface CustomMeshStoreDeps {
  /** Defaults to the browser global. Injected by unit tests and embedders. */
  indexedDB?: IDBFactory;
  /** SHA-256 implementation. The default is Web Crypto. */
  digest?: CustomMeshDigest;
}

function defaultDigest(bytes: Uint8Array<ArrayBuffer>): Promise<ArrayBuffer> {
  if (!globalThis.crypto?.subtle) {
    return Promise.reject(
      new CustomMeshStoreError("SHA-256 is unavailable in this browser"),
    );
  }
  return globalThis.crypto.subtle.digest("SHA-256", bytes);
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        request.error ?? new CustomMeshStoreError("IndexedDB request failed"),
      );
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(
        transaction.error ??
          new CustomMeshStoreError("IndexedDB transaction was aborted"),
      );
    transaction.onerror = () => {
      // The following abort event owns rejection. Waiting for it preserves a
      // caller-supplied conflict/corruption error when we abort explicitly.
    };
  });
}

async function readTransactionResult<T>(
  request: IDBRequest<T>,
  completion: Promise<void>,
): Promise<T> {
  try {
    const result = await requestResult(request);
    await completion;
    return result;
  } catch (error) {
    // A failed request normally aborts its transaction too. Observe that
    // second rejection before forwarding the request's more specific error.
    await completion.catch(() => {});
    throw error instanceof Error
      ? error
      : new CustomMeshStoreError("IndexedDB read failed", { cause: error });
  }
}

function sourceRecordReason(
  value: unknown,
  expectedId?: CustomMeshAssetId,
): string | null {
  if (typeof value !== "object" || value === null) return "not an object";
  const record = value as Partial<CustomMeshSourceRecord>;
  if (record.recordVersion !== SOURCE_RECORD_VERSION) {
    return "unsupported source-record version";
  }
  if (!isCustomMeshAssetId(record.id)) return "invalid content id";
  if (expectedId !== undefined && record.id !== expectedId) {
    return "record key/content id mismatch";
  }
  if (
    typeof record.name !== "string" ||
    record.name.length < 1 ||
    record.name.length > 160
  ) {
    return "invalid display name";
  }
  if (
    !(record.vertices instanceof Float64Array) ||
    !(record.vertices.buffer instanceof ArrayBuffer) ||
    record.vertices.length < 12 ||
    record.vertices.length % 3 !== 0 ||
    record.vertices.length / 3 > MAX_CUSTOM_MESH_VERTICES
  ) {
    return "malformed vertex array";
  }
  if (
    !(record.triangles instanceof Uint32Array) ||
    !(record.triangles.buffer instanceof ArrayBuffer) ||
    record.triangles.length < 12 ||
    record.triangles.length % 3 !== 0 ||
    record.triangles.length / 3 > MAX_CUSTOM_MESH_TRIANGLES
  ) {
    return "malformed triangle array";
  }
  for (const coordinate of record.vertices) {
    if (!Number.isFinite(coordinate)) return "non-finite vertex coordinate";
  }
  const vertexCount = record.vertices.length / 3;
  for (const index of record.triangles) {
    if (index >= vertexCount) return "triangle index is out of range";
  }
  return null;
}

function bakeRecordReason(
  value: unknown,
  expected?: {
    meshId: CustomMeshAssetId;
    algorithmVersion: number;
    resolution: number;
  },
): string | null {
  if (typeof value !== "object" || value === null) return "not an object";
  const record = value as Partial<CustomMeshBakeRecord>;
  if (record.recordVersion !== BAKE_RECORD_VERSION) {
    return "unsupported bake-record version";
  }
  if (
    typeof record.checksum !== "string" ||
    !SHA256_HEX_PATTERN.test(record.checksum)
  ) {
    return "invalid bake checksum";
  }
  if (!isCustomMeshAssetId(record.meshId)) return "invalid mesh id";
  if (
    !Number.isInteger(record.version) ||
    (record.version ?? 0) < 1 ||
    record.algorithmVersion !== record.version
  ) {
    return "invalid bake-algorithm version";
  }
  if (
    !Number.isInteger(record.resolution) ||
    (record.resolution ?? 0) < 8 ||
    (record.resolution ?? 0) > 128
  ) {
    return "invalid bake resolution";
  }
  if (
    expected &&
    (record.meshId !== expected.meshId ||
      record.algorithmVersion !== expected.algorithmVersion ||
      record.resolution !== expected.resolution)
  ) {
    return "record key/bake identity mismatch";
  }
  const resolution = record.resolution as number;
  if (
    !(record.values instanceof Float32Array) ||
    !(record.values.buffer instanceof ArrayBuffer) ||
    record.values.length !== resolution ** 3
  ) {
    return "malformed SDF value array";
  }
  for (const value of record.values) {
    if (!Number.isFinite(value)) return "non-finite SDF value";
  }
  if (!isFiniteTriple(record.min) || !isFiniteTriple(record.max)) {
    return "invalid bake bounds";
  }
  if (
    !Number.isFinite(record.cellSize) ||
    !(record.cellSize! > 0) ||
    !Number.isFinite(record.cellRadius) ||
    !(record.cellRadius! > 0)
  ) {
    return "invalid bake cell metrics";
  }
  for (let axis = 0; axis < 3; axis += 1) {
    if (record.max[axis] <= record.min[axis]) return "empty bake bounds";
  }
  return null;
}

function isFiniteTriple(value: unknown): value is Float64Array<ArrayBuffer> {
  return (
    value instanceof Float64Array &&
    value.buffer instanceof ArrayBuffer &&
    value.length === 3 &&
    value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
  );
}

function canonicalBakeBytes(
  bake: SerializedMeshSdfBake,
): Uint8Array<ArrayBuffer> {
  const meshId = new TextEncoder().encode(bake.meshId);
  const bytes = new Uint8Array(
    BAKE_MAGIC.byteLength +
      4 +
      meshId.byteLength +
      8 +
      8 * Float64Array.BYTES_PER_ELEMENT +
      bake.values.length * Float32Array.BYTES_PER_ELEMENT,
  );
  bytes.set(BAKE_MAGIC);
  const view = new DataView(bytes.buffer);
  let offset = BAKE_MAGIC.byteLength;
  view.setUint32(offset, meshId.byteLength, true);
  offset += 4;
  bytes.set(meshId, offset);
  offset += meshId.byteLength;
  view.setUint32(offset, bake.version, true);
  offset += 4;
  view.setUint32(offset, bake.resolution, true);
  offset += 4;
  for (const value of [
    ...bake.min,
    ...bake.max,
    bake.cellSize,
    bake.cellRadius,
  ]) {
    view.setFloat64(offset, Object.is(value, -0) ? 0 : value, true);
    offset += 8;
  }
  for (const value of bake.values) {
    view.setFloat32(offset, value, true);
    offset += 4;
  }
  return bytes;
}

async function checksumHex(
  digest: CustomMeshDigest,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const hash = new Uint8Array(await digest(bytes));
  if (hash.byteLength !== 32) {
    throw new CustomMeshStoreError("SHA-256 returned an invalid digest length");
  }
  return [...hash].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function arraysEqual<T extends Float64Array | Uint32Array>(
  left: T,
  right: T,
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (!Object.is(left[index], right[index])) return false;
  }
  return true;
}

function sameSource(
  left: SerializedPreparedMeshAsset,
  right: SerializedPreparedMeshAsset,
): boolean {
  // `name` is local metadata and deliberately does not enter the content id.
  return (
    left.id === right.id &&
    arraysEqual(left.vertices, right.vertices) &&
    arraysEqual(left.triangles, right.triangles)
  );
}

function sourceRecord(
  source: SerializedPreparedMeshAsset,
): CustomMeshSourceRecord {
  return { recordVersion: SOURCE_RECORD_VERSION, ...source };
}

function bakeRecord(
  bake: SerializedMeshSdfBake,
  checksum: string,
): CustomMeshBakeRecord {
  return {
    recordVersion: BAKE_RECORD_VERSION,
    algorithmVersion: bake.version,
    checksum,
    ...bake,
  };
}

function publicSource(
  record: CustomMeshSourceRecord,
): SerializedPreparedMeshAsset {
  return {
    id: record.id,
    name: record.name,
    vertices: record.vertices,
    triangles: record.triangles,
  };
}

function publicBake(record: CustomMeshBakeRecord): SerializedMeshSdfBake {
  return {
    meshId: record.meshId,
    version: record.version,
    resolution: record.resolution,
    values: record.values,
    min: record.min,
    max: record.max,
    cellSize: record.cellSize,
    cellRadius: record.cellRadius,
  };
}

export class CustomMeshStore {
  private readonly factory: IDBFactory;
  private readonly digest: CustomMeshDigest;
  private databasePromise: Promise<IDBDatabase> | null = null;

  constructor(deps: CustomMeshStoreDeps = {}) {
    const factory = deps.indexedDB ?? globalThis.indexedDB;
    if (!factory) {
      throw new CustomMeshStoreError("IndexedDB is unavailable");
    }
    this.factory = factory;
    this.digest = deps.digest ?? defaultDigest;
  }

  /** Open and, on first use, create the version-1 database schema. */
  open(): Promise<IDBDatabase> {
    this.databasePromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.factory.open(
        CUSTOM_MESH_DB_NAME,
        CUSTOM_MESH_DB_VERSION,
      );
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(CUSTOM_MESH_SOURCE_STORE)) {
          database.createObjectStore(CUSTOM_MESH_SOURCE_STORE, {
            keyPath: "id",
          });
        }
        if (!database.objectStoreNames.contains(CUSTOM_MESH_BAKE_STORE)) {
          database.createObjectStore(CUSTOM_MESH_BAKE_STORE, {
            keyPath: ["meshId", "algorithmVersion", "resolution"],
          });
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        if (
          !database.objectStoreNames.contains(CUSTOM_MESH_SOURCE_STORE) ||
          !database.objectStoreNames.contains(CUSTOM_MESH_BAKE_STORE)
        ) {
          database.close();
          this.databasePromise = null;
          reject(new CustomMeshStoreError("custom-mesh database is corrupt"));
          return;
        }
        database.onversionchange = () => {
          database.close();
          this.databasePromise = null;
        };
        resolve(database);
      };
      request.onerror = () => {
        this.databasePromise = null;
        reject(
          request.error ??
            new CustomMeshStoreError("could not open custom-mesh database"),
        );
      };
      request.onblocked = () => {
        this.databasePromise = null;
        reject(
          new CustomMeshStoreError("custom-mesh database upgrade blocked"),
        );
      };
    });
    return this.databasePromise;
  }

  close(): void {
    if (!this.databasePromise) return;
    void this.databasePromise.then(
      (database) => database.close(),
      () => {},
    );
    this.databasePromise = null;
  }

  /**
   * Atomically add immutable source geometry and its first derived bake.
   * Re-inserting byte-identical geometry is idempotent and refreshes the
   * derived bake. A same-id/different-geometry record aborts both writes.
   */
  async putSourceAndInitialBake(
    source: SerializedPreparedMeshAsset,
    bake: SerializedMeshSdfBake,
  ): Promise<CustomMeshPutResult> {
    const [outcome] = await this.putSourcesAndInitialBakes([{ source, bake }]);
    return outcome;
  }

  /**
   * Atomically add a complete portable import's immutable sources and freshly
   * derived bakes. Every digest and wire is checked before opening the write
   * transaction; then every existing-source comparison and every write shares
   * that one transaction. A conflict, corrupt resident record, quota failure,
   * or failed bake write therefore leaves the whole imported asset set absent.
   */
  async putSourcesAndInitialBakes(
    entries: readonly CustomMeshSourceAndBake[],
  ): Promise<readonly CustomMeshPutResult[]> {
    if (entries.length === 0) return [];
    const ids = new Set<CustomMeshAssetId>();
    const durable = await Promise.all(
      entries.map(async ({ source, bake }) => {
        if (ids.has(source.id)) {
          throw new CustomMeshStoreError(
            `duplicate custom-mesh source: ${source.id}`,
          );
        }
        ids.add(source.id);
        const sourceReason = sourceRecordReason(
          sourceRecord(source),
          source.id,
        );
        if (sourceReason) {
          throw new CustomMeshStoreError(
            `invalid custom-mesh source: ${sourceReason}`,
          );
        }
        const expectedId = await customMeshContentIdFromBytes(
          canonicalCustomMeshSourceBytes(source.vertices, source.triangles),
          this.digest,
        );
        if (expectedId !== source.id) {
          throw new CustomMeshStoreError(
            "custom-mesh source does not match its content id",
          );
        }
        const bakeChecksum = await checksumHex(
          this.digest,
          canonicalBakeBytes(bake),
        );
        const durableBake = bakeRecord(bake, bakeChecksum);
        const bakeReason = bakeRecordReason(durableBake, {
          meshId: source.id,
          algorithmVersion: bake.version,
          resolution: bake.resolution,
        });
        if (bakeReason) {
          throw new CustomMeshStoreError(
            `invalid custom-mesh bake: ${bakeReason}`,
          );
        }
        if (bake.meshId !== source.id) {
          throw new CustomMeshStoreError("source and bake mesh ids differ");
        }
        return { source, bake: durableBake };
      }),
    );

    const database = await this.open();
    const transaction = database.transaction(
      [CUSTOM_MESH_SOURCE_STORE, CUSTOM_MESH_BAKE_STORE],
      "readwrite",
    );
    const completion = transactionDone(transaction);
    const sources = transaction.objectStore(CUSTOM_MESH_SOURCE_STORE);
    const bakes = transaction.objectStore(CUSTOM_MESH_BAKE_STORE);
    const outcomes: CustomMeshPutResult[] = entries.map(() => "stored");
    const failure: { error: Error | null } = { error: null };

    durable.forEach(({ source, bake }, index) => {
      const existingRequest = sources.get(source.id);
      existingRequest.onsuccess = () => {
        if (failure.error) return;
        try {
          const existing: unknown = existingRequest.result;
          if (existing === undefined) {
            sources.add(sourceRecord(source));
          } else {
            const reason = sourceRecordReason(existing, source.id);
            if (reason) {
              throw new CustomMeshStoreError(
                `stored custom-mesh source is corrupt: ${reason}`,
              );
            }
            if (
              !sameSource(
                publicSource(existing as CustomMeshSourceRecord),
                source,
              )
            ) {
              throw new CustomMeshSourceConflictError(source.id);
            }
            outcomes[index] = "already-stored";
          }
          bakes.put(bake);
        } catch (error) {
          failure.error =
            error instanceof Error
              ? error
              : new CustomMeshStoreError("custom-mesh transaction failed");
          transaction.abort();
        }
      };
      existingRequest.onerror = () => {
        // IndexedDB aborts the transaction; completion below reports the error.
      };
    });

    try {
      await completion;
    } catch (error) {
      if (failure.error) throw failure.error;
      if (error instanceof DOMException && error.name === "ConstraintError") {
        throw new CustomMeshStoreError(
          "custom-mesh import conflicts with stored sources",
          { cause: error },
        );
      }
      throw error instanceof Error
        ? error
        : new CustomMeshStoreError("custom-mesh transaction failed", {
            cause: error,
          });
    }
    return outcomes;
  }

  /** Refresh one derived bake without changing its immutable source. Used
   * after a version miss or corrupt cache entry is regenerated off-thread. */
  async putBake(bake: SerializedMeshSdfBake): Promise<void> {
    const checksum = await checksumHex(this.digest, canonicalBakeBytes(bake));
    const durableBake = bakeRecord(bake, checksum);
    const reason = bakeRecordReason(durableBake, {
      meshId: bake.meshId,
      algorithmVersion: bake.version,
      resolution: bake.resolution,
    });
    if (reason) {
      throw new CustomMeshStoreError(`invalid custom-mesh bake: ${reason}`);
    }
    const database = await this.open();
    const transaction = database.transaction(
      [CUSTOM_MESH_SOURCE_STORE, CUSTOM_MESH_BAKE_STORE],
      "readwrite",
    );
    const completion = transactionDone(transaction);
    const sourceRequest = transaction
      .objectStore(CUSTOM_MESH_SOURCE_STORE)
      .get(bake.meshId);
    sourceRequest.onsuccess = () => {
      const source: unknown = sourceRequest.result;
      const sourceReason = sourceRecordReason(source, bake.meshId);
      if (source === undefined || sourceReason) {
        transaction.abort();
        return;
      }
      transaction.objectStore(CUSTOM_MESH_BAKE_STORE).put(durableBake);
    };
    await completion;
  }

  async readSource(
    id: CustomMeshAssetId,
  ): Promise<CustomMeshReadResult<SerializedPreparedMeshAsset>> {
    if (!isCustomMeshAssetId(id))
      throw new RangeError("invalid custom mesh id");
    const database = await this.open();
    const transaction = database.transaction(
      CUSTOM_MESH_SOURCE_STORE,
      "readonly",
    );
    const completion = transactionDone(transaction);
    const raw: unknown = await readTransactionResult(
      transaction.objectStore(CUSTOM_MESH_SOURCE_STORE).get(id),
      completion,
    );
    if (raw === undefined) return { status: "missing" };
    const reason = sourceRecordReason(raw, id);
    if (reason) return { status: "corrupt", reason };
    const value = publicSource(raw as CustomMeshSourceRecord);
    const expectedId = await customMeshContentIdFromBytes(
      canonicalCustomMeshSourceBytes(value.vertices, value.triangles),
      this.digest,
    );
    if (expectedId !== id) {
      return { status: "corrupt", reason: "content digest mismatch" };
    }
    return { status: "found", value };
  }

  async readBake(
    meshId: CustomMeshAssetId,
    algorithmVersion: number,
    resolution: number,
  ): Promise<CustomMeshReadResult<SerializedMeshSdfBake>> {
    if (!isCustomMeshAssetId(meshId))
      throw new RangeError("invalid custom mesh id");
    const database = await this.open();
    const transaction = database.transaction(
      CUSTOM_MESH_BAKE_STORE,
      "readonly",
    );
    const completion = transactionDone(transaction);
    const raw: unknown = await readTransactionResult(
      transaction
        .objectStore(CUSTOM_MESH_BAKE_STORE)
        .get([meshId, algorithmVersion, resolution]),
      completion,
    );
    if (raw === undefined) return { status: "missing" };
    const reason = bakeRecordReason(raw, {
      meshId,
      algorithmVersion,
      resolution,
    });
    if (reason) return { status: "corrupt", reason };
    const record = raw as CustomMeshBakeRecord;
    const checksum = await checksumHex(
      this.digest,
      canonicalBakeBytes(publicBake(record)),
    );
    if (checksum !== record.checksum) {
      return { status: "corrupt", reason: "bake checksum mismatch" };
    }
    return {
      status: "found",
      value: publicBake(record),
    };
  }
}
