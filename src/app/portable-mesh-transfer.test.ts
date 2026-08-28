import {
  bakePreparedMeshSdf,
  hasMeshAsset,
  serializeMeshSdfBake,
  serializePreparedCustomMeshAsset,
  uninstallCustomMeshAsset,
  type CustomMeshAssetId,
  type SerializedPreparedMeshAsset,
} from "../fractal/mesh-shapes";
import {
  CUSTOM_MESH_SDF_RESOLUTION,
  prepareCustomMeshObj,
} from "../fractal/custom-mesh";
import {
  importPortableCustomMeshSources,
  PORTABLE_MESH_VALIDATION_CONCURRENCY,
  PortableMeshImportCancelledError,
  readPortableCustomMeshSources,
  type PortableMeshImportStore,
  type PortableMeshSourceValidator,
} from "./portable-mesh-transfer";

const TETRA_OBJ = `
o Portable tetra
v 1 1 1
v -1 -1 1
v -1 1 -1
v 1 -1 -1
f 1 3 2
f 1 2 4
f 1 4 3
f 2 3 4
`;

const installedIds = new Set<CustomMeshAssetId>();

let portableFixturePromise:
  | Promise<{
      source: SerializedPreparedMeshAsset;
      validate: PortableMeshSourceValidator;
    }>
  | undefined;

async function portableFixture(): Promise<{
  source: SerializedPreparedMeshAsset;
  validate: PortableMeshSourceValidator;
}> {
  portableFixturePromise ??= prepareCustomMeshObj(
    TETRA_OBJ,
    "portable.obj",
  ).then((prepared) => {
    const source = serializePreparedCustomMeshAsset(prepared.asset);
    const bake = serializeMeshSdfBake(
      bakePreparedMeshSdf(prepared.asset, CUSTOM_MESH_SDF_RESOLUTION),
    );
    return {
      source,
      validate: async () => ({ source: structuredClone(source), bake }),
    };
  });
  const fixture = await portableFixturePromise;
  installedIds.add(fixture.source.id);
  return fixture;
}

afterEach(() => {
  for (const id of installedIds) uninstallCustomMeshAsset(id);
  installedIds.clear();
});

describe("portable custom-mesh transfer", () => {
  it("deduplicates and sorts durable export reads", async () => {
    const a: CustomMeshAssetId = `mesh-sha256-${"a".repeat(64)}`;
    const b: CustomMeshAssetId = `mesh-sha256-${"b".repeat(64)}`;
    const calls: CustomMeshAssetId[] = [];
    const source = (id: CustomMeshAssetId): SerializedPreparedMeshAsset => ({
      id,
      name: id,
      vertices: new Float64Array(12),
      triangles: new Uint32Array(12),
    });

    const result = await readPortableCustomMeshSources([b, a, b], {
      readSource: async (id) => {
        calls.push(id);
        return { status: "found", value: source(id) };
      },
    });

    expect(calls).toEqual([a, b]);
    expect(result.map(({ id }) => id)).toEqual([a, b]);
  });

  it("refuses missing, corrupt, and oversized export dependency sets", async () => {
    const ids: CustomMeshAssetId[] = Array.from(
      { length: 5 },
      (_, index): CustomMeshAssetId =>
        `mesh-sha256-${index.toString(16).repeat(64)}`,
    );
    const neverRead = {
      readSource: async () => ({ status: "missing" as const }),
    };
    await expect(readPortableCustomMeshSources(ids, neverRead)).rejects.toThrow(
      "4-mesh asset budget",
    );
    await expect(
      readPortableCustomMeshSources([ids[0]], neverRead),
    ).rejects.toThrow("source geometry is missing");
    await expect(
      readPortableCustomMeshSources([ids[0]], {
        readSource: async () => ({
          status: "corrupt" as const,
          reason: "digest mismatch",
        }),
      }),
    ).rejects.toThrow("source geometry is corrupt: digest mismatch");
  });

  it("does not persist or install anything until every worker succeeds", async () => {
    const { source } = await portableFixture();
    const second: SerializedPreparedMeshAsset = {
      ...source,
      id: `mesh-sha256-${"f".repeat(64)}`,
    };
    let writes = 0;
    const store: PortableMeshImportStore = {
      putSourcesAndInitialBakes: async () => {
        writes += 1;
        return [];
      },
    };

    await expect(
      importPortableCustomMeshSources([source, second], store, async (wire) => {
        if (wire.id === second.id) throw new Error("bad solid");
        throw new Error("the other worker may also fail without publishing");
      }),
    ).rejects.toThrow();
    expect(writes).toBe(0);
    expect(hasMeshAsset(source.id)).toBe(false);
    expect(hasMeshAsset(second.id)).toBe(false);
  });

  it("bounds parallel worker validation and stops before persistence on failure", async () => {
    const sources: SerializedPreparedMeshAsset[] = Array.from(
      { length: 4 },
      (_, index): SerializedPreparedMeshAsset => ({
        id: `mesh-sha256-${index.toString(16).repeat(64)}`,
        name: `mesh-${index}`,
        vertices: new Float64Array(12),
        triangles: new Uint32Array(12),
      }),
    );
    let active = 0;
    let peak = 0;
    let calls = 0;
    let writes = 0;

    await expect(
      importPortableCustomMeshSources(
        sources,
        {
          putSourcesAndInitialBakes: async () => {
            writes += 1;
            return [];
          },
        },
        async (source) => {
          const call = ++calls;
          active += 1;
          peak = Math.max(peak, active);
          await Promise.resolve();
          active -= 1;
          if (call === sources.length) throw new Error("last source failed");
          return {
            source,
            bake: {
              meshId: source.id,
              version: 1,
              resolution: 8,
              values: new Float32Array(8 ** 3),
              min: new Float64Array([-1, -1, -1]),
              max: new Float64Array([1, 1, 1]),
              cellSize: 2 / 7,
              cellRadius: Math.sqrt(3) / 7,
            },
          };
        },
      ),
    ).rejects.toThrow("last source failed");
    expect(peak).toBe(PORTABLE_MESH_VALIDATION_CONCURRENCY);
    expect(writes).toBe(0);
  });

  it("honors a supersession check before the durable commit", async () => {
    const { source, validate } = await portableFixture();
    let checks = 0;
    let writes = 0;

    await expect(
      importPortableCustomMeshSources(
        [source],
        {
          putSourcesAndInitialBakes: async () => {
            writes += 1;
            return [];
          },
        },
        validate,
        () => ++checks < 3,
      ),
    ).rejects.toBeInstanceOf(PortableMeshImportCancelledError);
    expect(writes).toBe(0);
    expect(hasMeshAsset(source.id)).toBe(false);
  });

  it("rejects a worker result at the wrong production bake resolution", async () => {
    const { source, validate } = await portableFixture();

    await expect(
      importPortableCustomMeshSources(
        [source],
        { putSourcesAndInitialBakes: async () => ["stored"] },
        async (wire) => {
          const result = await validate(wire);
          return { ...result, bake: { ...result.bake, resolution: 8 } };
        },
      ),
    ).rejects.toThrow(/wrong portable bake format/);
    expect(hasMeshAsset(source.id)).toBe(false);
  });

  it("leaves the runtime untouched when the atomic durable commit fails", async () => {
    const { source, validate } = await portableFixture();

    await expect(
      importPortableCustomMeshSources(
        [source],
        {
          putSourcesAndInitialBakes: async () => {
            throw new DOMException("full", "QuotaExceededError");
          },
        },
        validate,
      ),
    ).rejects.toMatchObject({ name: "QuotaExceededError" });
    expect(hasMeshAsset(source.id)).toBe(false);
  });

  it("installs only after the complete durable commit succeeds", async () => {
    const { source, validate } = await portableFixture();
    const events: string[] = [];

    await importPortableCustomMeshSources(
      [source],
      {
        putSourcesAndInitialBakes: async (entries) => {
          events.push(`stored:${entries[0].source.id}`);
          expect(hasMeshAsset(source.id)).toBe(false);
          return ["stored"];
        },
      },
      async (wire) => {
        events.push(`validated:${wire.id}`);
        return validate(wire);
      },
    );

    expect(events).toEqual([`validated:${source.id}`, `stored:${source.id}`]);
    expect(hasMeshAsset(source.id)).toBe(true);
  });
});
