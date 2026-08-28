import { createHash } from "node:crypto";
import { prepareCustomMeshObj, type MeshDigest } from "../fractal/custom-mesh";
import {
  serializePreparedCustomMeshAsset,
  type CustomMeshAssetId,
  type SerializedPreparedMeshAsset,
} from "../fractal/mesh-shapes";
import {
  MAX_PORTABLE_MESH_ASSETS,
  PORTABLE_MESH_GEOMETRY_VERSION,
  PORTABLE_MESH_MANIFEST_VERSION,
  decodePortableMeshManifest,
  encodePortableMeshManifest,
  parsePortableMeshManifest,
  validatePortableMeshManifest,
  type PortableMeshGeometryWire,
  type PortableMeshManifestWire,
} from "./portable-mesh-manifest";
import { prepareCustomMeshWorkerRequest } from "./custom-mesh-worker-core";

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

const sha256: MeshDigest = async (bytes) =>
  Uint8Array.from(createHash("sha256").update(bytes).digest()).buffer;

async function sourceFixture(): Promise<SerializedPreparedMeshAsset> {
  const prepared = await prepareCustomMeshObj(
    TETRA_OBJ,
    "portable.obj",
    sha256,
  );
  return serializePreparedCustomMeshAsset(prepared.asset);
}

function decodeBase64url(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(
    Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64"),
  );
}

function encodeBase64url(value: Uint8Array<ArrayBuffer>): string {
  return Buffer.from(value).toString("base64url");
}

function cloneManifest(manifest: PortableMeshManifestWire): {
  version: number;
  geometries: Record<string, unknown>[];
} {
  return JSON.parse(JSON.stringify(manifest)) as {
    version: number;
    geometries: Record<string, unknown>[];
  };
}

describe("portable custom-mesh manifest", () => {
  it("round-trips canonical geometry once per referenced digest", async () => {
    const source = await sourceFixture();

    const manifest = await encodePortableMeshManifest(
      [source],
      [source.id, source.id],
      sha256,
    );
    expect(manifest.version).toBe(PORTABLE_MESH_MANIFEST_VERSION);
    expect(manifest.geometries).toHaveLength(1);
    expect(manifest.geometries[0]).toMatchObject({
      id: source.id,
      version: PORTABLE_MESH_GEOMETRY_VERSION,
      name: "Portable tetra",
    });
    expect(manifest.geometries[0].geometry).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(manifest.geometries[0].geometry).not.toContain("=");
    expect(JSON.stringify(manifest)).not.toMatch(/sdf|bake|values/i);

    const decoded = await decodePortableMeshManifest(
      JSON.parse(JSON.stringify(manifest)),
      [source.id, source.id],
      sha256,
    );
    expect(decoded?.validated).toBe(true);
    expect(decoded?.sources).toHaveLength(1);
    expect(decoded?.sources[0].id).toBe(source.id);
    expect(Array.from(decoded?.sources[0].vertices ?? [])).toEqual(
      Array.from(source.vertices),
    );
    expect(Array.from(decoded?.sources[0].triangles ?? [])).toEqual(
      Array.from(source.triangles),
    );
  });

  it("keeps structural parsing separate from digest validation", async () => {
    const source = await sourceFixture();
    const manifest = await encodePortableMeshManifest(
      [source],
      [source.id],
      sha256,
    );

    const parsed = parsePortableMeshManifest(manifest, [source.id]);
    expect(parsed).not.toBeNull();
    expect("validated" in (parsed ?? {})).toBe(false);
    expect(await validatePortableMeshManifest(parsed!, sha256)).toMatchObject({
      validated: true,
    });
  });

  it("requires a nonempty exact set of references, with no duplicates or unused sources", async () => {
    const source = await sourceFixture();
    const manifest = await encodePortableMeshManifest(
      [source],
      [source.id],
      sha256,
    );
    const other: CustomMeshAssetId = `mesh-sha256-${"0".repeat(64)}`;

    expect(parsePortableMeshManifest(manifest, [])).toBeNull();
    expect(parsePortableMeshManifest(manifest, [other])).toBeNull();
    expect(
      parsePortableMeshManifest(
        {
          ...manifest,
          geometries: [...manifest.geometries, manifest.geometries[0]],
        },
        [source.id],
      ),
    ).toBeNull();
    expect(
      parsePortableMeshManifest({ ...manifest, geometries: [] }, [source.id]),
    ).toBeNull();

    const low: CustomMeshAssetId = `mesh-sha256-${"0".repeat(64)}`;
    const high: CustomMeshAssetId = `mesh-sha256-${"f".repeat(64)}`;
    expect(
      parsePortableMeshManifest(
        {
          ...manifest,
          geometries: [
            { ...manifest.geometries[0], id: high },
            { ...manifest.geometries[0], id: low },
          ],
        },
        [low, high],
      ),
    ).toBeNull();
  });

  it("rejects unknown fields, including derived cache payloads", async () => {
    const source = await sourceFixture();
    const manifest = cloneManifest(
      await encodePortableMeshManifest([source], [source.id], sha256),
    );
    manifest.geometries[0].bake = { resolution: 64, values: "forbidden" };

    expect(parsePortableMeshManifest(manifest, [source.id])).toBeNull();
  });

  it("rejects noncanonical base64url before asynchronous validation", async () => {
    const source = await sourceFixture();
    const manifest = cloneManifest(
      await encodePortableMeshManifest([source], [source.id], sha256),
    );
    manifest.geometries[0].geometry =
      String(manifest.geometries[0].geometry) + "=";

    expect(parsePortableMeshManifest(manifest, [source.id])).toBeNull();
  });

  it("rejects a tampered geometry digest atomically", async () => {
    const source = await sourceFixture();
    const manifest = cloneManifest(
      await encodePortableMeshManifest([source], [source.id], sha256),
    );
    const geometry = decodeBase64url(String(manifest.geometries[0].geometry));
    // Change one finite coordinate without changing shape, counts or length.
    const view = new DataView(geometry.buffer);
    const firstVertexOffset =
      new TextEncoder().encode("fractal-mesh-v1\0").length + 8;
    view.setFloat64(
      firstVertexOffset,
      view.getFloat64(firstVertexOffset, true) - 0.125,
      true,
    );
    manifest.geometries[0].geometry = encodeBase64url(geometry);

    // This edit can also violate canonical vertex ordering; either the cheap
    // stage or the digest stage must reject it, and no validated sources leak.
    const parsed = parsePortableMeshManifest(manifest, [source.id]);
    const decoded =
      parsed === null
        ? null
        : await validatePortableMeshManifest(parsed, sha256);
    expect(decoded).toBeNull();
  });

  it("leaves digest-correct topology validation to the import worker", async () => {
    const source = await sourceFixture();
    const manifest = await encodePortableMeshManifest(
      [source],
      [source.id],
      sha256,
    );
    const geometry = decodeBase64url(manifest.geometries[0].geometry);
    const magicBytes = new TextEncoder().encode("fractal-mesh-v1\0").length;
    const view = new DataView(geometry.buffer);
    const vertexCount = view.getUint32(magicBytes, true);
    const triangleCount = view.getUint32(magicBytes + 4, true);
    const triangleOffset = magicBytes + 8 + vertexCount * 24;
    const triangles: [number, number, number][] = [];
    for (let triangle = 0; triangle < triangleCount; triangle += 1) {
      const offset = triangleOffset + triangle * 12;
      const a = view.getUint32(offset, true);
      const b = view.getUint32(offset + 4, true);
      const c = view.getUint32(offset + 8, true);
      const inward: [number, number, number] = [a, c, b];
      if (inward[1] < inward[0] && inward[1] < inward[2]) {
        triangles.push([inward[1], inward[2], inward[0]]);
      } else if (inward[2] < inward[0] && inward[2] < inward[1]) {
        triangles.push([inward[2], inward[0], inward[1]]);
      } else {
        triangles.push(inward);
      }
    }
    triangles.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    triangles.flat().forEach((index, position) => {
      view.setUint32(triangleOffset + position * 4, index, true);
    });
    const inwardId: CustomMeshAssetId = `mesh-sha256-${createHash("sha256")
      .update(geometry)
      .digest("hex")}`;
    const inwardWire: PortableMeshGeometryWire = {
      ...manifest.geometries[0],
      id: inwardId,
      geometry: encodeBase64url(geometry),
    };
    const inwardManifest: PortableMeshManifestWire = {
      version: PORTABLE_MESH_MANIFEST_VERSION,
      geometries: [inwardWire],
    };

    const parsed = parsePortableMeshManifest(inwardManifest, [inwardId]);
    expect(parsed).not.toBeNull();
    const validated = await validatePortableMeshManifest(parsed!, sha256);
    expect(validated).toMatchObject({ validated: true });
    await expect(
      prepareCustomMeshWorkerRequest({
        type: "bake",
        jobId: 1,
        source: validated!.sources[0],
        resolution: 8,
      }),
    ).rejects.toThrow(/outward|orientation|volume/i);
  });

  it("enforces count and binary geometry budgets before decoding entries", async () => {
    const source = await sourceFixture();
    const manifest = await encodePortableMeshManifest(
      [source],
      [source.id],
      sha256,
    );
    const repeated = Array.from(
      { length: MAX_PORTABLE_MESH_ASSETS + 1 },
      () => manifest.geometries[0],
    );
    expect(
      parsePortableMeshManifest(
        { version: PORTABLE_MESH_MANIFEST_VERSION, geometries: repeated },
        [source.id],
      ),
    ).toBeNull();

    const badCounts = cloneManifest(manifest);
    const geometry = decodeBase64url(String(badCounts.geometries[0].geometry));
    const magicBytes = new TextEncoder().encode("fractal-mesh-v1\0").length;
    new DataView(geometry.buffer).setUint32(magicBytes, 25_001, true);
    badCounts.geometries[0].geometry = encodeBase64url(geometry);
    expect(parsePortableMeshManifest(badCounts, [source.id])).toBeNull();
  });

  it("refuses to encode missing, duplicate, or digest-mismatched inputs", async () => {
    const source = await sourceFixture();
    const other: CustomMeshAssetId = `mesh-sha256-${"0".repeat(64)}`;

    await expect(
      encodePortableMeshManifest([], [source.id], sha256),
    ).rejects.toThrow(/do not match/);
    await expect(
      encodePortableMeshManifest([source, source], [source.id], sha256),
    ).rejects.toThrow(/do not match|duplicated/);
    await expect(
      encodePortableMeshManifest([{ ...source, id: other }], [other], sha256),
    ).rejects.toThrow(/content id/);
  });
});
