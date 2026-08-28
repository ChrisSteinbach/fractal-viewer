import { createHash } from "node:crypto";
import {
  bakePreparedMeshSdf,
  installCustomMeshAsset,
  installSerializedCustomMeshAsset,
  installSerializedMeshSdfBake,
  serializeCustomMeshAsset,
  serializeMeshSdfBake,
  uninstallCustomMeshAsset,
  type CustomMeshAssetId,
  type SerializedMeshSdfBake,
  type SerializedPreparedMeshAsset,
} from "../fractal/mesh-shapes";
import { prepareCustomMeshObj } from "../fractal/custom-mesh";
import {
  CUSTOM_MESH_BAKE_STORE,
  CUSTOM_MESH_DB_NAME,
  CUSTOM_MESH_DB_VERSION,
  CUSTOM_MESH_SOURCE_STORE,
  CustomMeshSourceConflictError,
  CustomMeshStore,
  type CustomMeshDigest,
} from "./custom-mesh-store";

const TETRA_OBJ = `
o Store tetra
v 1 1 1
v -1 -1 1
v -1 1 -1
v 1 -1 -1
f 1 3 2
f 1 2 4
f 1 4 3
f 2 3 4
`;

const sha256: CustomMeshDigest = async (bytes) => {
  const digest = createHash("sha256").update(bytes).digest();
  return Uint8Array.from(digest).buffer;
};

const zeroDigest: CustomMeshDigest = async () => new Uint8Array(32).buffer;
const ZERO_ID = `mesh-sha256-${"0".repeat(64)}`;

async function sourceFixture(
  digest: CustomMeshDigest = sha256,
): Promise<SerializedPreparedMeshAsset> {
  const prepared = await prepareCustomMeshObj(TETRA_OBJ, "tetra.obj", digest);
  installCustomMeshAsset(prepared.asset);
  try {
    return serializeCustomMeshAsset(prepared.id);
  } finally {
    uninstallCustomMeshAsset(prepared.id);
  }
}

function bakeFixture(
  meshId: CustomMeshAssetId,
  version: SerializedMeshSdfBake["version"] = 1,
  resolution = 8,
): SerializedMeshSdfBake {
  return {
    meshId,
    version,
    resolution,
    values: new Float32Array(resolution ** 3).fill(-0.125),
    min: new Float64Array([-1, -1, -1]),
    max: new Float64Array([1, 1, 1]),
    cellSize: 2 / (resolution - 1),
    cellRadius: Math.sqrt(3) / (resolution - 1),
  };
}

type KeyPath = string | string[];

interface FakeStoreState {
  keyPath: KeyPath;
  records: Map<string, unknown>;
}

function serializedKey(key: IDBValidKey): string {
  return JSON.stringify(key);
}

function recordKey(state: FakeStoreState, value: unknown): IDBValidKey {
  const record = value as Record<string, unknown>;
  if (Array.isArray(state.keyPath)) {
    const keys: IDBValidKey[] = state.keyPath.map(
      (part) => record[part] as IDBValidKey,
    );
    return keys;
  }
  return record[state.keyPath] as IDBValidKey;
}

function domStringList(values: () => string[]): DOMStringList {
  return {
    get length() {
      return values().length;
    },
    contains: (value) => values().includes(value),
    item: (index) => values()[index] ?? null,
    [Symbol.iterator]: () => values()[Symbol.iterator](),
  };
}

class FakeTransaction {
  error: DOMException | null = null;
  onabort: ((event: Event) => void) | null = null;
  oncomplete: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  private readonly working = new Map<string, FakeStoreState>();
  private pending = 0;
  private started = true;
  private aborted = false;
  private completionQueued = false;

  constructor(
    private readonly database: FakeDatabase,
    names: string[],
    private readonly mode: IDBTransactionMode,
  ) {
    for (const name of names) {
      const source = database.store(name);
      this.working.set(name, {
        keyPath: source.keyPath,
        records: new Map(
          [...source.records].map(([key, value]) => [
            key,
            structuredClone(value),
          ]),
        ),
      });
    }
    queueMicrotask(() => {
      this.started = false;
      this.maybeComplete();
    });
  }

  objectStore(name: string): IDBObjectStore {
    const state = this.working.get(name);
    if (!state)
      throw new DOMException("store not in transaction", "NotFoundError");
    return {
      keyPath: state.keyPath,
      get: (key: IDBValidKey) =>
        this.request(() => {
          const value = state.records.get(serializedKey(key));
          return value === undefined ? undefined : structuredClone(value);
        }),
      add: (value: unknown) =>
        this.request(() => {
          this.assertWritable();
          const key = serializedKey(recordKey(state, value));
          if (state.records.has(key)) {
            throw new DOMException("duplicate key", "ConstraintError");
          }
          state.records.set(key, structuredClone(value));
          return recordKey(state, value);
        }),
      put: (value: unknown) =>
        this.request(() => {
          this.assertWritable();
          if (
            name === CUSTOM_MESH_BAKE_STORE &&
            this.database.consumeBakePutFailure()
          ) {
            throw new DOMException(
              "injected bake failure",
              "QuotaExceededError",
            );
          }
          const key = recordKey(state, value);
          state.records.set(serializedKey(key), structuredClone(value));
          return key;
        }),
    } as IDBObjectStore;
  }

  abort(): void {
    if (this.aborted) return;
    this.aborted = true;
    queueMicrotask(() => this.onabort?.(new Event("abort")));
  }

  private assertWritable(): void {
    if (this.mode !== "readwrite") {
      throw new DOMException("readonly transaction", "ReadOnlyError");
    }
  }

  private request<T>(operation: () => T): IDBRequest<T> {
    const request = {
      result: undefined,
      error: null,
      onsuccess: null,
      onerror: null,
    } as unknown as IDBRequest<T>;
    this.pending += 1;
    queueMicrotask(() => {
      if (this.aborted) {
        this.pending -= 1;
        return;
      }
      try {
        (request as { result: T }).result = operation();
        request.onsuccess?.(new Event("success"));
      } catch (error) {
        const domError =
          error instanceof DOMException
            ? error
            : new DOMException(String(error), "UnknownError");
        (request as { error: DOMException }).error = domError;
        request.onerror?.(new Event("error"));
        this.error = domError;
        this.onerror?.(new Event("error"));
        this.abort();
      } finally {
        this.pending -= 1;
        this.maybeComplete();
      }
    });
    return request;
  }

  private maybeComplete(): void {
    if (
      this.started ||
      this.aborted ||
      this.pending !== 0 ||
      this.completionQueued
    ) {
      return;
    }
    this.completionQueued = true;
    queueMicrotask(() => {
      this.completionQueued = false;
      if (this.aborted || this.pending !== 0) return;
      if (this.mode === "readwrite") {
        for (const [name, state] of this.working) {
          this.database.replaceStore(name, state);
        }
      }
      this.oncomplete?.(new Event("complete"));
    });
  }
}

class FakeDatabase {
  readonly name = CUSTOM_MESH_DB_NAME;
  readonly version = CUSTOM_MESH_DB_VERSION;
  onversionchange: ((event: Event) => void) | null = null;
  private readonly stores = new Map<string, FakeStoreState>();
  private failBakePut = false;

  readonly objectStoreNames = domStringList(() => [...this.stores.keys()]);

  createObjectStore(
    name: string,
    options?: IDBObjectStoreParameters,
  ): IDBObjectStore {
    const keyPath = options?.keyPath;
    if (typeof keyPath !== "string" && !Array.isArray(keyPath)) {
      throw new Error("the fake requires a key path");
    }
    this.stores.set(name, { keyPath, records: new Map() });
    return { keyPath } as IDBObjectStore;
  }

  transaction(
    storeNames: string | Iterable<string>,
    mode: IDBTransactionMode = "readonly",
  ): IDBTransaction {
    const names =
      typeof storeNames === "string" ? [storeNames] : [...storeNames];
    return new FakeTransaction(this, names, mode) as unknown as IDBTransaction;
  }

  close(): void {}

  store(name: string): FakeStoreState {
    const state = this.stores.get(name);
    if (!state) throw new DOMException("missing store", "NotFoundError");
    return state;
  }

  replaceStore(name: string, state: FakeStoreState): void {
    this.stores.set(name, state);
  }

  failNextBakePut(): void {
    this.failBakePut = true;
  }

  consumeBakePutFailure(): boolean {
    const result = this.failBakePut;
    this.failBakePut = false;
    return result;
  }

  mutate(
    name: string,
    key: IDBValidKey,
    update: (value: unknown) => unknown,
  ): void {
    const state = this.store(name);
    const encoded = serializedKey(key);
    state.records.set(
      encoded,
      update(structuredClone(state.records.get(encoded))),
    );
  }

  count(name: string): number {
    return this.store(name).records.size;
  }
}

class FakeIDBFactory {
  readonly database = new FakeDatabase();
  lastOpen: { name: string; version?: number } | null = null;
  private opened = false;

  open(name: string, version?: number): IDBOpenDBRequest {
    this.lastOpen = { name, version };
    const request = {
      result: this.database,
      error: null,
      onblocked: null,
      onerror: null,
      onsuccess: null,
      onupgradeneeded: null,
    } as unknown as IDBOpenDBRequest;
    queueMicrotask(() => {
      if (!this.opened) {
        this.opened = true;
        request.onupgradeneeded?.(
          new Event("upgradeneeded") as IDBVersionChangeEvent & {
            target: IDBOpenDBRequest;
          },
        );
      }
      request.onsuccess?.(new Event("success"));
    });
    return request;
  }
}

function storeWith(
  factory: FakeIDBFactory,
  digest: CustomMeshDigest = sha256,
): CustomMeshStore {
  return new CustomMeshStore({
    indexedDB: factory as unknown as IDBFactory,
    digest,
  });
}

describe("CustomMeshStore", () => {
  it("creates the named version-1 source and compound-key bake stores", async () => {
    const factory = new FakeIDBFactory();
    await storeWith(factory).open();

    expect(factory.lastOpen).toEqual({
      name: CUSTOM_MESH_DB_NAME,
      version: CUSTOM_MESH_DB_VERSION,
    });
    expect(
      factory.database.objectStoreNames.contains(CUSTOM_MESH_SOURCE_STORE),
    ).toBe(true);
    expect(
      factory.database.objectStoreNames.contains(CUSTOM_MESH_BAKE_STORE),
    ).toBe(true);
    expect(factory.database.store(CUSTOM_MESH_SOURCE_STORE).keyPath).toBe("id");
    expect(factory.database.store(CUSTOM_MESH_BAKE_STORE).keyPath).toEqual([
      "meshId",
      "algorithmVersion",
      "resolution",
    ]);
  });

  it("atomically stores and reads one source and its versioned bake", async () => {
    const factory = new FakeIDBFactory();
    const store = storeWith(factory);
    const source = await sourceFixture();
    const bake = bakeFixture(source.id);

    await expect(store.putSourceAndInitialBake(source, bake)).resolves.toBe(
      "stored",
    );
    expect(await store.readSource(source.id)).toEqual({
      status: "found",
      value: source,
    });
    expect(await store.readBake(source.id, 1, 8)).toEqual({
      status: "found",
      value: bake,
    });
    await expect(store.readBake(source.id, 2, 8)).resolves.toEqual({
      status: "missing",
    });
  });

  it("treats exact geometry as idempotent and keeps the first display name", async () => {
    const factory = new FakeIDBFactory();
    const store = storeWith(factory);
    const source = await sourceFixture();
    const renamed = { ...source, name: "A different local filename" };

    await store.putSourceAndInitialBake(source, bakeFixture(source.id));
    await expect(
      store.putSourceAndInitialBake(renamed, bakeFixture(source.id)),
    ).resolves.toBe("already-stored");
    const read = await store.readSource(source.id);
    expect(read.status).toBe("found");
    if (read.status === "found") expect(read.value.name).toBe(source.name);
    expect(factory.database.count(CUSTOM_MESH_SOURCE_STORE)).toBe(1);
    expect(factory.database.count(CUSTOM_MESH_BAKE_STORE)).toBe(1);
  });

  it("rejects a conflicting same-id source and leaves the first bake intact", async () => {
    const factory = new FakeIDBFactory();
    const store = storeWith(factory, zeroDigest);
    const source = await sourceFixture(zeroDigest);
    expect(source.id).toBe(ZERO_ID);
    const firstBake = bakeFixture(source.id);
    await store.putSourceAndInitialBake(source, firstBake);
    const changed = {
      ...source,
      vertices: source.vertices.slice(),
    };
    changed.vertices[0] += 0.25;
    const replacementBake = {
      ...bakeFixture(source.id),
      values: new Float32Array(8 ** 3).fill(-9),
    };

    await expect(
      store.putSourceAndInitialBake(changed, replacementBake),
    ).rejects.toBeInstanceOf(CustomMeshSourceConflictError);
    await expect(store.readBake(source.id, 1, 8)).resolves.toEqual({
      status: "found",
      value: firstBake,
    });
  });

  it("rolls back the source when the initial bake write fails", async () => {
    const factory = new FakeIDBFactory();
    const store = storeWith(factory);
    const source = await sourceFixture();
    factory.database.failNextBakePut();

    await expect(
      store.putSourceAndInitialBake(source, bakeFixture(source.id)),
    ).rejects.toMatchObject({ name: "QuotaExceededError" });
    await expect(store.readSource(source.id)).resolves.toEqual({
      status: "missing",
    });
    await expect(store.readBake(source.id, 1, 8)).resolves.toEqual({
      status: "missing",
    });
  });

  it("distinguishes missing, structurally corrupt and digest-corrupt records", async () => {
    const factory = new FakeIDBFactory();
    const store = storeWith(factory);
    const source = await sourceFixture();

    await expect(store.readSource(source.id)).resolves.toEqual({
      status: "missing",
    });
    await store.putSourceAndInitialBake(source, bakeFixture(source.id));
    factory.database.mutate(CUSTOM_MESH_SOURCE_STORE, source.id, (raw) => ({
      ...(raw as object),
      vertices: new Float64Array([0, 1, 2]),
    }));
    await expect(store.readSource(source.id)).resolves.toMatchObject({
      status: "corrupt",
      reason: "malformed vertex array",
    });

    const secondFactory = new FakeIDBFactory();
    const secondStore = storeWith(secondFactory);
    await secondStore.putSourceAndInitialBake(source, bakeFixture(source.id));
    secondFactory.database.mutate(
      CUSTOM_MESH_SOURCE_STORE,
      source.id,
      (raw) => {
        const record = structuredClone(raw) as {
          vertices: Float64Array<ArrayBuffer>;
        };
        record.vertices[0] += 0.125;
        return record;
      },
    );
    await expect(secondStore.readSource(source.id)).resolves.toEqual({
      status: "corrupt",
      reason: "content digest mismatch",
    });
  });

  it("reports a corrupt bake independently from a valid immutable source", async () => {
    const factory = new FakeIDBFactory();
    const store = storeWith(factory);
    const source = await sourceFixture();
    await store.putSourceAndInitialBake(source, bakeFixture(source.id));
    factory.database.mutate(
      CUSTOM_MESH_BAKE_STORE,
      [source.id, 1, 8],
      (raw) => {
        const record = structuredClone(raw) as {
          values: Float32Array<ArrayBuffer>;
        };
        record.values[0] += 0.25;
        return record;
      },
    );

    await expect(store.readBake(source.id, 1, 8)).resolves.toEqual({
      status: "corrupt",
      reason: "bake checksum mismatch",
    });
    await expect(store.readSource(source.id)).resolves.toMatchObject({
      status: "found",
    });
  });

  it("reads shared wires that hydrate directly into the runtime cache", async () => {
    const factory = new FakeIDBFactory();
    const store = storeWith(factory);
    const prepared = await prepareCustomMeshObj(TETRA_OBJ, "tetra.obj", sha256);
    const bake = bakePreparedMeshSdf(prepared.asset, 8);
    const serialized = serializeMeshSdfBake(bake);
    installCustomMeshAsset(prepared.asset);
    const source = serializeCustomMeshAsset(prepared.id);
    uninstallCustomMeshAsset(prepared.id);

    expect(serialized.meshId).toBe(prepared.id);
    expect(serialized.version).toBe(bake.version);
    expect(serialized.values).toEqual(bake.values);
    expect(serialized.values).not.toBe(bake.values);

    await store.putSourceAndInitialBake(source, serialized);
    const storedSource = await store.readSource(prepared.id);
    const storedBake = await store.readBake(prepared.id, bake.version, 8);
    expect(storedSource.status).toBe("found");
    expect(storedBake.status).toBe("found");
    if (storedSource.status !== "found" || storedBake.status !== "found") {
      throw new Error("stored runtime wires unexpectedly unavailable");
    }
    installSerializedCustomMeshAsset(storedSource.value);
    try {
      const hydrated = installSerializedMeshSdfBake(storedBake.value);
      expect(hydrated.mesh.id).toBe(prepared.id);
      expect(hydrated.values).toEqual(bake.values);
    } finally {
      uninstallCustomMeshAsset(prepared.id);
    }
  });
});
