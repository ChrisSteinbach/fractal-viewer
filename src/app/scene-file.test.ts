import {
  decodeImportFile,
  encodeCollectionFile,
  encodeSceneFile,
  encodeTimelineFile,
  MAX_IMPORT_THUMBNAIL_CHARS,
  PORTABLE_SCENE_FILE_VERSION,
  SCENE_FILE_VERSION,
  sanitizeThumbnailDataUrl,
} from "./scene-file";
import { decodeScene, encodeScene } from "./persist";
import type { SceneSnapshot } from "./persist";
import {
  COLLECTION_CAP,
  sanitizeThumbnailDataUrl as fromCollection,
} from "./collection";
import type { SavedScene } from "./collection";
import type { SampledSolidStatus } from "./solid-render-status";
import { TIMELINE_CAP } from "./timeline";
import { encodePortableMeshManifest } from "./portable-mesh-manifest";
import { prepareCustomMeshObj } from "../fractal/custom-mesh";
import {
  serializePreparedCustomMeshAsset,
  type CustomMeshAssetId,
  type SerializedPreparedMeshAsset,
} from "../fractal/mesh-shapes";
import {
  DEFAULT_COLOR_GAMMA,
  DEFAULT_ESTIMATOR_CURVE,
  DEFAULT_ESTIMATOR_MINIMUM_RADIUS,
  DEFAULT_ESTIMATOR_RADIUS,
  DEFAULT_FLAME_EXPOSURE,
  DEFAULT_FLAME_GAMMA,
  DEFAULT_FLAME_ITERATIONS,
  DEFAULT_FLAME_PALETTE,
  DEFAULT_FLAME_SUPERSAMPLE,
  DEFAULT_FLAME_VIBRANCY,
  DEFAULT_GLOW_BRIGHTNESS,
  DEFAULT_RAMP_PALETTE,
  DEFAULT_SOLID_AMBIENT,
  DEFAULT_SOLID_ITERATIONS,
  DEFAULT_SOLID_LIGHT_AZIMUTH,
  DEFAULT_SOLID_LIGHT_ELEVATION,
  DEFAULT_SOLID_PALETTE,
  DEFAULT_SOLID_RESOLUTION,
  DEFAULT_SOLID_THRESHOLD,
  DEFAULT_SURFACE_COLOR_SPEED,
  DEFAULT_SURFACE_ANTIALIAS_SAMPLES,
  DEFAULT_SURFACE_DEPTH_OF_FIELD,
  DEFAULT_SURFACE_ENV_LIGHT,
  DEFAULT_SYMMETRY_PLANE,
  DEFAULT_SYMMETRY_ORDER,
  initialState,
} from "./state";

/** A minimal valid snapshot used to build real `encodeScene` wire strings —
 * copied from persist.test.ts's own helper of the same name, since
 * `decodeImportFile` genuinely round-trips through `decodeScene` and needs a
 * string that survives it. */
function baseSnapshot(): SceneSnapshot {
  return {
    transforms: [
      {
        id: 0,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0.5],
      },
    ],
    numPoints: 100_000,
    pointSize: 1,
    colorMode: "transform",
    colorGamma: DEFAULT_COLOR_GAMMA,
    rampPaletteId: DEFAULT_RAMP_PALETTE,
    fourDColor: "wBlueOrange",
    fourDDepthFade: false,
    renderStyle: "depthFade",
    showGuides: true,
    flame: {
      exposure: DEFAULT_FLAME_EXPOSURE,
      iterations: DEFAULT_FLAME_ITERATIONS,
      gamma: DEFAULT_FLAME_GAMMA,
      vibrancy: DEFAULT_FLAME_VIBRANCY,
      supersample: DEFAULT_FLAME_SUPERSAMPLE,
      estimatorRadius: DEFAULT_ESTIMATOR_RADIUS,
      estimatorMinimumRadius: DEFAULT_ESTIMATOR_MINIMUM_RADIUS,
      estimatorCurve: DEFAULT_ESTIMATOR_CURVE,
      paletteId: DEFAULT_FLAME_PALETTE,
    },
    solid: {
      ...initialState(true).solid,
      resolution: DEFAULT_SOLID_RESOLUTION,
      iterations: DEFAULT_SOLID_ITERATIONS,
      threshold: DEFAULT_SOLID_THRESHOLD,
      lightAzimuth: DEFAULT_SOLID_LIGHT_AZIMUTH,
      lightElevation: DEFAULT_SOLID_LIGHT_ELEVATION,
      ambient: DEFAULT_SOLID_AMBIENT,
      paletteId: DEFAULT_SOLID_PALETTE,
    },
    surface: {
      antialiasSamples: DEFAULT_SURFACE_ANTIALIAS_SAMPLES,
      depthOfField: DEFAULT_SURFACE_DEPTH_OF_FIELD,
      lightAzimuth: DEFAULT_SOLID_LIGHT_AZIMUTH,
      lightElevation: DEFAULT_SOLID_LIGHT_ELEVATION,
      ambient: DEFAULT_SOLID_AMBIENT,
      colorSource: "transform",
      paletteId: DEFAULT_SOLID_PALETTE,
      colorSpeed: DEFAULT_SURFACE_COLOR_SPEED,
      envLight: DEFAULT_SURFACE_ENV_LIGHT,
      floorPattern: "solid",
      floorTileScale: 0.64,
      floorEmission: 0,
    },
    symmetry: { order: DEFAULT_SYMMETRY_ORDER, plane: DEFAULT_SYMMETRY_PLANE },
    glowBrightness: DEFAULT_GLOW_BRIGHTNESS,
    background: { mode: "dark" },
  };
}

const TETRA_OBJ = `
o Portable file tetra
v 1 1 1
v -1 -1 1
v -1 1 -1
v 1 -1 -1
f 1 3 2
f 1 2 4
f 1 4 3
f 2 3 4
`;

async function portableSource(): Promise<SerializedPreparedMeshAsset> {
  const prepared = await prepareCustomMeshObj(TETRA_OBJ, "portable-file.obj");
  return serializePreparedCustomMeshAsset(prepared.asset);
}

function snapshotWithMesh(id: CustomMeshAssetId): SceneSnapshot {
  const snapshot = baseSnapshot();
  snapshot.transforms[0] = {
    ...snapshot.transforms[0],
    emitter: {
      parts: [{ primitive: { kind: "mesh", meshId: id }, combine: "union" }],
    },
  };
  return snapshot;
}

describe("scene-file: single scene", () => {
  it("round-trips through encodeSceneFile/decodeImportFile", () => {
    const encoded = encodeScene(baseSnapshot());

    const file = encodeSceneFile(encoded, 123_456);
    const decoded = decodeImportFile(file);

    expect(decoded).toEqual({ kind: "scene", encoded });
  });

  it("round-trips a tiled scene — the encoded string carries the block through the envelope untouched", () => {
    const snapshot: SceneSnapshot = {
      ...baseSnapshot(),
      tiling: {
        group: "b4",
        clip: {
          parts: [
            {
              primitive: { kind: "sphere", radius: 0.75 },
              combine: "union",
            },
          ],
        },
      },
    };
    const encoded = encodeScene(snapshot);

    const file = encodeSceneFile(encoded, 123_456);
    const decoded = decodeImportFile(file);

    expect(decoded).toEqual({ kind: "scene", encoded });
    // And the carried string really decodes back to the authored tiling
    // block — the envelope never re-encodes or drops the scene field.
    expect(decoded !== null && decoded.kind).toBe("scene");
    if (decoded !== null && decoded.kind === "scene") {
      expect(decodeScene(decoded.encoded)!.tiling).toEqual(snapshot.tiling);
    }
  });

  it("exports the ordinary scene envelope without Evolution provenance", () => {
    const encoded = encodeScene(baseSnapshot());

    const file = encodeSceneFile(encoded, 555);
    const parsed = JSON.parse(file) as Record<string, unknown>;

    expect(parsed.app).toBe("fractal-viewer");
    expect(parsed.kind).toBe("scene");
    expect(parsed.version).toBe(SCENE_FILE_VERSION);
    expect(parsed.exportedAt).toBe(555);
    expect(parsed.scene).toBe(encoded);
    expect(Object.keys(parsed).sort()).toEqual([
      "app",
      "exportedAt",
      "kind",
      "scene",
      "version",
    ]);
  });
});

describe("scene-file: portable version-2 mesh bundles", () => {
  it("keeps asset-free export on the unchanged version-1 envelope", () => {
    const encoded = encodeScene(baseSnapshot());
    const parsed = JSON.parse(encodeSceneFile(encoded, 123)) as Record<
      string,
      unknown
    >;

    expect(parsed.version).toBe(SCENE_FILE_VERSION);
    expect("assets" in parsed).toBe(false);
  });

  it("round-trips one strict asset-bearing scene envelope", async () => {
    const source = await portableSource();
    const encoded = encodeScene(snapshotWithMesh(source.id));
    const assets = await encodePortableMeshManifest([source], [source.id]);
    const text = encodeSceneFile(encoded, 123, assets);

    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      kind: "scene",
      version: PORTABLE_SCENE_FILE_VERSION,
    });
    expect(Object.keys(parsed).sort()).toEqual([
      "app",
      "assets",
      "exportedAt",
      "kind",
      "scene",
      "version",
    ]);
    const decoded = decodeImportFile(text);
    expect(decoded?.kind).toBe("scene");
    expect(decoded?.assets?.sources).toHaveLength(1);
    expect(decoded?.assets?.sources[0].id).toBe(source.id);
  });

  it("stores a repeated collection mesh once and validates every scene", async () => {
    const source = await portableSource();
    const encoded = encodeScene(snapshotWithMesh(source.id));
    const assets = await encodePortableMeshManifest(
      [source],
      [source.id, source.id],
    );
    const scenes: SavedScene[] = [
      {
        id: "one",
        encoded,
        createdAt: 1,
        thumbnail: "",
      },
      {
        id: "two",
        encoded,
        createdAt: 2,
        thumbnail: "",
      },
    ];
    const text = encodeCollectionFile(scenes, 123, assets);
    const raw = JSON.parse(text) as { assets: { geometries: unknown[] } };

    expect(raw.assets.geometries).toHaveLength(1);
    const decoded = decodeImportFile(text);
    expect(decoded?.kind).toBe("collection");
    if (decoded?.kind !== "collection") throw new Error("expected collection");
    expect(decoded.scenes).toHaveLength(2);

    const tampered = JSON.parse(text) as {
      scenes: Array<Record<string, unknown>>;
    };
    tampered.scenes[1].encoded = "v1=garbage";
    expect(decodeImportFile(JSON.stringify(tampered))).toBeNull();
  });

  it("round-trips timeline assets and rejects unknown version-2 fields", async () => {
    const source = await portableSource();
    const encoded = encodeScene(snapshotWithMesh(source.id));
    const assets = await encodePortableMeshManifest([source], [source.id]);
    const text = encodeTimelineFile(
      [
        {
          id: "step",
          encoded,
          thumbnail: "",
          morphMs: 1000,
          holdMs: 500,
        },
      ],
      7,
      123,
      assets,
    );
    const decoded = decodeImportFile(text);
    expect(decoded?.kind).toBe("timeline");
    expect(decoded?.assets?.sources[0].id).toBe(source.id);

    const extra = JSON.parse(text) as Record<string, unknown>;
    extra.derivedBake = "forbidden";
    expect(decodeImportFile(JSON.stringify(extra))).toBeNull();
  });
});

describe("scene-file: collection backup", () => {
  const solidStatus: SampledSolidStatus = {
    kind: "sampled-solid",
    phase: "complete",
    requestedResolution: 192,
    effectiveResolution: 128,
    iterationsDone: 10,
    iterationsBudget: 10,
  };

  it("round-trips two scenes, preserving encoded/createdAt/mode/thumbnail", () => {
    const encodedA = encodeScene(baseSnapshot());
    const encodedB = encodeScene({ ...baseSnapshot(), numPoints: 250_000 });
    const scenes: SavedScene[] = [
      {
        id: "seed-1",
        encoded: encodedA,
        thumbnail: "data:image/jpeg;base64,aa",
        createdAt: 100,
        mode: "flame",
      },
      {
        id: "seed-2",
        encoded: encodedB,
        thumbnail: "",
        createdAt: 200,
      },
    ];

    const file = encodeCollectionFile(scenes, 999);
    const decoded = decodeImportFile(file);

    expect(decoded).toEqual({
      kind: "collection",
      scenes: [
        {
          encoded: encodedA,
          createdAt: 100,
          mode: "flame",
          thumbnail: "data:image/jpeg;base64,aa",
        },
        {
          encoded: encodedB,
          createdAt: 200,
          mode: undefined,
          thumbnail: "",
        },
      ],
    });
  });

  it("exports only the ordinary SavedScene fields, without ancestry", () => {
    const scenes: SavedScene[] = [
      {
        id: "should-not-appear",
        encoded: encodeScene(baseSnapshot()),
        thumbnail: "",
        createdAt: 1,
      },
    ];

    const file = encodeCollectionFile(scenes, 1);
    const parsed = JSON.parse(file) as {
      scenes: Record<string, unknown>[];
      [key: string]: unknown;
    };

    expect("id" in parsed.scenes[0]).toBe(false);
    expect(Object.keys(parsed).sort()).toEqual([
      "app",
      "exportedAt",
      "kind",
      "scenes",
      "version",
    ]);
    expect(Object.keys(parsed.scenes[0]).sort()).toEqual([
      "createdAt",
      "encoded",
      "thumbnail",
    ]);
  });

  it("round-trips optional sampled Solid metadata without changing renderMode codecs", () => {
    const encoded = encodeScene(baseSnapshot());
    const file = encodeCollectionFile(
      [
        {
          id: "solid",
          encoded,
          thumbnail: "",
          createdAt: 1,
          mode: "solid",
          solidStatus,
        },
      ],
      2,
    );
    expect(decodeImportFile(file)).toEqual({
      kind: "collection",
      scenes: [
        {
          encoded,
          createdAt: 1,
          mode: "solid",
          solidStatus,
          thumbnail: "",
        },
      ],
    });
  });
});

describe("scene-file: timeline file", () => {
  it("round-trips steps and seed through encodeTimelineFile/decodeImportFile", () => {
    const encodedA = encodeScene(baseSnapshot());
    const encodedB = encodeScene({ ...baseSnapshot(), numPoints: 250_000 });

    const file = encodeTimelineFile(
      [
        {
          id: "step-1",
          encoded: encodedA,
          thumbnail: "data:image/jpeg;base64,aa",
          morphMs: 1000,
          holdMs: 500,
        },
        {
          id: "step-2",
          encoded: encodedB,
          thumbnail: "data:image/jpeg;base64,bb",
          morphMs: 4000,
          holdMs: 2000,
          mode: "flame",
        },
      ],
      777,
      999,
    );
    const decoded = decodeImportFile(file);
    if (decoded === null || decoded.kind !== "timeline") {
      throw new Error("expected a decoded timeline file");
    }

    expect(decoded).toEqual({
      kind: "timeline",
      seed: 777,
      steps: [
        {
          encoded: encodedA,
          thumbnail: "data:image/jpeg;base64,aa",
          morphMs: 1000,
          holdMs: 500,
          mode: undefined,
        },
        {
          encoded: encodedB,
          thumbnail: "data:image/jpeg;base64,bb",
          morphMs: 4000,
          holdMs: 2000,
          mode: "flame",
        },
      ],
    });
    expect(decoded.steps[0].encoded).toBe(encodedA);
    expect(decoded.steps[1].encoded).toBe(encodedB);
  });

  it("omits id from every step in an exported timeline file", () => {
    const file = encodeTimelineFile(
      [
        {
          id: "should-not-appear-1",
          encoded: encodeScene(baseSnapshot()),
          thumbnail: "",
          morphMs: 1000,
          holdMs: 500,
        },
        {
          id: "should-not-appear-2",
          encoded: encodeScene(baseSnapshot()),
          thumbnail: "",
          morphMs: 2000,
          holdMs: 1000,
        },
      ],
      1,
      1,
    );
    const parsed = JSON.parse(file) as { steps: Record<string, unknown>[] };

    expect(parsed.steps.every((s) => !("id" in s))).toBe(true);
  });

  it("round-trips a timeline keyframe's sampled Solid disclosure", () => {
    const encoded = encodeScene(baseSnapshot());
    const solidStatus: SampledSolidStatus = {
      kind: "sampled-solid",
      phase: "active",
      requestedResolution: 224,
      effectiveResolution: 192,
      iterationsDone: 5,
      iterationsBudget: 10,
    };
    const decoded = decodeImportFile(
      encodeTimelineFile(
        [
          {
            id: "solid-step",
            encoded,
            thumbnail: "",
            morphMs: 1000,
            holdMs: 500,
            mode: "solid",
            solidStatus,
          },
        ],
        7,
        9,
      ),
    );
    expect(decoded).toEqual({
      kind: "timeline",
      seed: 7,
      steps: [
        {
          encoded,
          thumbnail: "",
          morphMs: 1000,
          holdMs: 500,
          mode: "solid",
          solidStatus,
        },
      ],
    });
  });

  it("writes app/kind/version/exportedAt/seed into the exported file", () => {
    const file = encodeTimelineFile(
      [
        {
          id: "1",
          encoded: encodeScene(baseSnapshot()),
          thumbnail: "",
          morphMs: 1000,
          holdMs: 500,
        },
      ],
      4242,
      555,
    );
    const parsed = JSON.parse(file) as Record<string, unknown>;

    expect(parsed.app).toBe("fractal-viewer");
    expect(parsed.kind).toBe("timeline");
    expect(parsed.version).toBe(SCENE_FILE_VERSION);
    expect(parsed.exportedAt).toBe(555);
    expect(parsed.seed).toBe(4242);
  });
});

describe("decodeImportFile: envelope validation", () => {
  it("rejects non-JSON text", () => {
    expect(decodeImportFile("not json{")).toBeNull();
  });

  it("rejects a JSON array", () => {
    expect(decodeImportFile("[]")).toBeNull();
  });

  it("rejects a JSON string", () => {
    expect(decodeImportFile('"hello"')).toBeNull();
  });

  it("rejects the wrong app marker", () => {
    const file = JSON.stringify({
      app: "some-other-app",
      kind: "scene",
      version: SCENE_FILE_VERSION,
      exportedAt: 1,
      scene: encodeScene(baseSnapshot()),
    });
    expect(decodeImportFile(file)).toBeNull();
  });

  it("rejects an unrecognized kind", () => {
    const file = JSON.stringify({
      app: "fractal-viewer",
      kind: "bogus",
      version: SCENE_FILE_VERSION,
      exportedAt: 1,
      scene: encodeScene(baseSnapshot()),
    });
    expect(decodeImportFile(file)).toBeNull();
  });

  it("rejects a newer version than this build writes", () => {
    const file = JSON.stringify({
      app: "fractal-viewer",
      kind: "scene",
      version: 2,
      exportedAt: 1,
      scene: encodeScene(baseSnapshot()),
    });
    expect(decodeImportFile(file)).toBeNull();
  });

  it("rejects a missing version field", () => {
    const file = JSON.stringify({
      app: "fractal-viewer",
      kind: "scene",
      exportedAt: 1,
      scene: encodeScene(baseSnapshot()),
    });
    expect(decodeImportFile(file)).toBeNull();
  });
});

describe("decodeImportFile: scene kind", () => {
  it("rejects a file with no scene field", () => {
    const file = JSON.stringify({
      app: "fractal-viewer",
      kind: "scene",
      version: SCENE_FILE_VERSION,
      exportedAt: 1,
    });
    expect(decodeImportFile(file)).toBeNull();
  });

  it("rejects a non-string scene field", () => {
    const file = JSON.stringify({
      app: "fractal-viewer",
      kind: "scene",
      version: SCENE_FILE_VERSION,
      exportedAt: 1,
      scene: 12345,
    });
    expect(decodeImportFile(file)).toBeNull();
  });

  it('rejects a scene string decodeScene rejects ("v1=garbage")', () => {
    const file = JSON.stringify({
      app: "fractal-viewer",
      kind: "scene",
      version: SCENE_FILE_VERSION,
      exportedAt: 1,
      scene: "v1=garbage",
    });
    expect(decodeImportFile(file)).toBeNull();
  });

  it('rejects a scene string with no v1= prefix ("not-encoded")', () => {
    const file = JSON.stringify({
      app: "fractal-viewer",
      kind: "scene",
      version: SCENE_FILE_VERSION,
      exportedAt: 1,
      scene: "not-encoded",
    });
    expect(decodeImportFile(file)).toBeNull();
  });
});

describe("decodeImportFile: collection kind", () => {
  it("rejects a non-array scenes field", () => {
    const file = JSON.stringify({
      app: "fractal-viewer",
      kind: "collection",
      version: SCENE_FILE_VERSION,
      exportedAt: 1,
      scenes: "not-an-array",
    });
    expect(decodeImportFile(file)).toBeNull();
  });

  it("drops invalid entries individually, keeping only the valid one", () => {
    const validEncoded = encodeScene(baseSnapshot());
    const file = JSON.stringify({
      app: "fractal-viewer",
      kind: "collection",
      version: SCENE_FILE_VERSION,
      exportedAt: 1,
      scenes: [
        { encoded: validEncoded, thumbnail: "", createdAt: 1 },
        null,
        { encoded: 5, createdAt: 1 },
        { encoded: validEncoded }, // no createdAt
        { encoded: "v1=garbage", createdAt: 1 },
      ],
    });

    const decoded = decodeImportFile(file);
    if (decoded === null || decoded.kind !== "collection") {
      throw new Error("expected a decoded collection file");
    }

    expect(decoded.scenes).toHaveLength(1);
    expect(decoded.scenes[0].encoded).toBe(validEncoded);
  });

  it("caps entries at COLLECTION_CAP even when the file holds more", () => {
    const encoded = encodeScene(baseSnapshot());
    const scenes = Array.from({ length: COLLECTION_CAP + 5 }, (_, i) => ({
      encoded,
      createdAt: i,
      thumbnail: "",
    }));
    const file = JSON.stringify({
      app: "fractal-viewer",
      kind: "collection",
      version: SCENE_FILE_VERSION,
      exportedAt: 1,
      scenes,
    });

    const decoded = decodeImportFile(file);
    if (decoded === null || decoded.kind !== "collection") {
      throw new Error("expected a decoded collection file");
    }

    expect(decoded.scenes).toHaveLength(COLLECTION_CAP);
  });

  it("stops after the sanitize-attempt budget, still importing the valid entries collected so far", () => {
    const encoded = encodeScene(baseSnapshot());
    const invalid = Array.from({ length: 10 * COLLECTION_CAP }, () => ({
      encoded: "v1=garbage",
      createdAt: 1,
      thumbnail: "",
    }));
    const file = JSON.stringify({
      app: "fractal-viewer",
      kind: "collection",
      version: SCENE_FILE_VERSION,
      exportedAt: 1,
      scenes: [
        { encoded, createdAt: 1, thumbnail: "" },
        { encoded, createdAt: 2, thumbnail: "" },
        { encoded, createdAt: 3, thumbnail: "" },
        ...invalid,
        { encoded, createdAt: 4, thumbnail: "" },
      ],
    });

    const decoded = decodeImportFile(file);
    if (decoded === null || decoded.kind !== "collection") {
      throw new Error("expected a decoded collection file");
    }

    // The three leading valid entries land; the trailing valid one sits
    // beyond the attempt budget and is dropped rather than hung on.
    expect(decoded.scenes).toEqual([
      { encoded, createdAt: 1, mode: undefined, thumbnail: "" },
      { encoded, createdAt: 2, mode: undefined, thumbnail: "" },
      { encoded, createdAt: 3, mode: undefined, thumbnail: "" },
    ]);
  });

  it("does not dedupe repeated encodeds — that's importScenes's job", () => {
    const encoded = encodeScene(baseSnapshot());
    const file = JSON.stringify({
      app: "fractal-viewer",
      kind: "collection",
      version: SCENE_FILE_VERSION,
      exportedAt: 1,
      scenes: [
        { encoded, createdAt: 1, thumbnail: "" },
        { encoded, createdAt: 2, thumbnail: "" },
      ],
    });

    const decoded = decodeImportFile(file);
    if (decoded === null || decoded.kind !== "collection") {
      throw new Error("expected a decoded collection file");
    }

    expect(decoded.scenes).toHaveLength(2);
  });
});

describe("decodeImportFile: timeline kind", () => {
  it("rejects a non-array steps field", () => {
    const file = JSON.stringify({
      app: "fractal-viewer",
      kind: "timeline",
      version: SCENE_FILE_VERSION,
      exportedAt: 1,
      seed: 1,
      steps: "nope",
    });
    expect(decodeImportFile(file)).toBeNull();
  });

  it("drops a step whose encoded doesn't decode, keeping valid neighbors in order", () => {
    const encodedA = encodeScene(baseSnapshot());
    const encodedC = encodeScene({ ...baseSnapshot(), numPoints: 250_000 });
    const file = JSON.stringify({
      app: "fractal-viewer",
      kind: "timeline",
      version: SCENE_FILE_VERSION,
      exportedAt: 1,
      seed: 1,
      steps: [
        { encoded: encodedA, thumbnail: "", morphMs: 1000, holdMs: 500 },
        { encoded: "v1=garbage", thumbnail: "", morphMs: 1000, holdMs: 500 },
        { encoded: encodedC, thumbnail: "", morphMs: 1000, holdMs: 500 },
      ],
    });

    const decoded = decodeImportFile(file);
    if (decoded === null || decoded.kind !== "timeline") {
      throw new Error("expected a decoded timeline file");
    }

    expect(decoded.steps.map((s) => s.encoded)).toEqual([encodedA, encodedC]);
  });

  it("drops a step with a non-number morphMs", () => {
    const encoded = encodeScene(baseSnapshot());
    const file = JSON.stringify({
      app: "fractal-viewer",
      kind: "timeline",
      version: SCENE_FILE_VERSION,
      exportedAt: 1,
      seed: 1,
      steps: [
        { encoded, thumbnail: "", morphMs: 1000, holdMs: 500 },
        { encoded, thumbnail: "", morphMs: "4000", holdMs: 500 },
      ],
    });

    const decoded = decodeImportFile(file);
    if (decoded === null || decoded.kind !== "timeline") {
      throw new Error("expected a decoded timeline file");
    }

    expect(decoded.steps).toHaveLength(1);
  });

  it("keeps a step whose timing is a raw JSON overflow literal (1e999 → Infinity) — clamping is the store's job", () => {
    const encoded = encodeScene(baseSnapshot());
    const file =
      `{"app":"fractal-viewer","kind":"timeline","version":${SCENE_FILE_VERSION},` +
      `"exportedAt":1,"seed":1,"steps":[{"encoded":${JSON.stringify(encoded)},` +
      `"thumbnail":"","morphMs":1e999,"holdMs":500}]}`;

    const decoded = decodeImportFile(file);
    if (decoded === null || decoded.kind !== "timeline") {
      throw new Error("expected a decoded timeline file");
    }

    expect(decoded.steps).toHaveLength(1);
    expect(decoded.steps[0].morphMs).toBe(Infinity);
  });

  it("caps steps at TIMELINE_CAP even when the file holds more", () => {
    const encoded = encodeScene(baseSnapshot());
    const steps = Array.from({ length: TIMELINE_CAP + 5 }, () => ({
      encoded,
      thumbnail: "",
      morphMs: 1000,
      holdMs: 500,
    }));
    const file = JSON.stringify({
      app: "fractal-viewer",
      kind: "timeline",
      version: SCENE_FILE_VERSION,
      exportedAt: 1,
      seed: 1,
      steps,
    });

    const decoded = decodeImportFile(file);
    if (decoded === null || decoded.kind !== "timeline") {
      throw new Error("expected a decoded timeline file");
    }

    expect(decoded.steps).toHaveLength(TIMELINE_CAP);
  });

  it("yields seed undefined when the file's seed is missing", () => {
    const encoded = encodeScene(baseSnapshot());
    const file = JSON.stringify({
      app: "fractal-viewer",
      kind: "timeline",
      version: SCENE_FILE_VERSION,
      exportedAt: 1,
      steps: [{ encoded, thumbnail: "", morphMs: 1000, holdMs: 500 }],
    });

    const decoded = decodeImportFile(file);
    if (decoded === null || decoded.kind !== "timeline") {
      throw new Error("expected a decoded timeline file");
    }

    expect(decoded.seed).toBeUndefined();
    expect(decoded.steps).toHaveLength(1);
  });

  it("yields seed undefined when the seed is non-finite (null / string)", () => {
    const encoded = encodeScene(baseSnapshot());
    const makeFile = (seed: unknown) =>
      JSON.stringify({
        app: "fractal-viewer",
        kind: "timeline",
        version: SCENE_FILE_VERSION,
        exportedAt: 1,
        seed,
        steps: [{ encoded, thumbnail: "", morphMs: 1000, holdMs: 500 }],
      });

    const decodedNull = decodeImportFile(makeFile(null));
    const decodedString = decodeImportFile(makeFile("7"));
    if (decodedNull === null || decodedNull.kind !== "timeline") {
      throw new Error("expected a decoded timeline file");
    }
    if (decodedString === null || decodedString.kind !== "timeline") {
      throw new Error("expected a decoded timeline file");
    }

    expect(decodedNull.seed).toBeUndefined();
    expect(decodedString.seed).toBeUndefined();
  });

  it("accepts an empty steps array as an empty timeline file", () => {
    const file = JSON.stringify({
      app: "fractal-viewer",
      kind: "timeline",
      version: SCENE_FILE_VERSION,
      exportedAt: 1,
      seed: 1,
      steps: [],
    });

    expect(decodeImportFile(file)).toEqual({
      kind: "timeline",
      seed: 1,
      steps: [],
    });
  });

  it('replaces a non-"data:image/" step thumbnail with ""', () => {
    const encoded = encodeScene(baseSnapshot());
    const file = JSON.stringify({
      app: "fractal-viewer",
      kind: "timeline",
      version: SCENE_FILE_VERSION,
      exportedAt: 1,
      seed: 1,
      steps: [
        {
          encoded,
          thumbnail: "https://evil.example/x.png",
          morphMs: 1000,
          holdMs: 500,
        },
      ],
    });

    const decoded = decodeImportFile(file);

    expect(decoded).toEqual({
      kind: "timeline",
      seed: 1,
      steps: [
        {
          encoded,
          thumbnail: "",
          morphMs: 1000,
          holdMs: 500,
          mode: undefined,
        },
      ],
    });
  });

  it("replaces an unrecognized step mode with undefined", () => {
    const encoded = encodeScene(baseSnapshot());
    const file = JSON.stringify({
      app: "fractal-viewer",
      kind: "timeline",
      version: SCENE_FILE_VERSION,
      exportedAt: 1,
      seed: 1,
      steps: [
        {
          encoded,
          thumbnail: "",
          morphMs: 1000,
          holdMs: 500,
          mode: "banana",
        },
      ],
    });

    const decoded = decodeImportFile(file);

    expect(decoded).toEqual({
      kind: "timeline",
      seed: 1,
      steps: [
        {
          encoded,
          thumbnail: "",
          morphMs: 1000,
          holdMs: 500,
          mode: undefined,
        },
      ],
    });
  });
});

describe("decodeImportFile: thumbnail sanitizing", () => {
  it("re-exports collection.ts's sanitizeThumbnailDataUrl — one definition across the import and storage load paths", () => {
    // scene-file.ts re-exports the validator `collection.ts` owns (its
    // storage loader cannot import this module without a cycle), so the
    // import path and the localStorage loads cannot drift apart. This pin
    // fails the moment the re-export becomes a copy.
    expect(sanitizeThumbnailDataUrl).toBe(fromCollection);
    expect(sanitizeThumbnailDataUrl("data:image/png;base64,aa")).toBe(
      "data:image/png;base64,aa",
    );
    expect(sanitizeThumbnailDataUrl("https://evil.example/x.png")).toBe("");
  });

  it('replaces a non-"data:image/" thumbnail with ""', () => {
    const encoded = encodeScene(baseSnapshot());
    const file = JSON.stringify({
      app: "fractal-viewer",
      kind: "collection",
      version: SCENE_FILE_VERSION,
      exportedAt: 1,
      scenes: [
        { encoded, createdAt: 1, thumbnail: "https://evil.example/x.png" },
      ],
    });

    const decoded = decodeImportFile(file);

    expect(decoded).toEqual({
      kind: "collection",
      scenes: [{ encoded, createdAt: 1, mode: undefined, thumbnail: "" }],
    });
  });

  it('replaces an oversized thumbnail with ""', () => {
    const encoded = encodeScene(baseSnapshot());
    const oversized =
      "data:image/png;base64," + "a".repeat(MAX_IMPORT_THUMBNAIL_CHARS);
    const file = JSON.stringify({
      app: "fractal-viewer",
      kind: "collection",
      version: SCENE_FILE_VERSION,
      exportedAt: 1,
      scenes: [{ encoded, createdAt: 1, thumbnail: oversized }],
    });

    const decoded = decodeImportFile(file);

    expect(decoded).toEqual({
      kind: "collection",
      scenes: [{ encoded, createdAt: 1, mode: undefined, thumbnail: "" }],
    });
  });

  it("keeps a normal data:image/ thumbnail", () => {
    const encoded = encodeScene(baseSnapshot());
    const file = JSON.stringify({
      app: "fractal-viewer",
      kind: "collection",
      version: SCENE_FILE_VERSION,
      exportedAt: 1,
      scenes: [
        { encoded, createdAt: 1, thumbnail: "data:image/jpeg;base64,abcd" },
      ],
    });

    const decoded = decodeImportFile(file);

    expect(decoded).toEqual({
      kind: "collection",
      scenes: [
        {
          encoded,
          createdAt: 1,
          mode: undefined,
          thumbnail: "data:image/jpeg;base64,abcd",
        },
      ],
    });
  });
});

describe("decodeImportFile: mode sanitizing", () => {
  it('replaces an unrecognized mode ("banana") with undefined', () => {
    const encoded = encodeScene(baseSnapshot());
    const file = JSON.stringify({
      app: "fractal-viewer",
      kind: "collection",
      version: SCENE_FILE_VERSION,
      exportedAt: 1,
      scenes: [{ encoded, createdAt: 1, thumbnail: "", mode: "banana" }],
    });

    const decoded = decodeImportFile(file);

    expect(decoded).toEqual({
      kind: "collection",
      scenes: [{ encoded, createdAt: 1, mode: undefined, thumbnail: "" }],
    });
  });

  it('keeps a "solid" mode', () => {
    const encoded = encodeScene(baseSnapshot());
    const file = JSON.stringify({
      app: "fractal-viewer",
      kind: "collection",
      version: SCENE_FILE_VERSION,
      exportedAt: 1,
      scenes: [{ encoded, createdAt: 1, thumbnail: "", mode: "solid" }],
    });

    const decoded = decodeImportFile(file);

    expect(decoded).toEqual({
      kind: "collection",
      scenes: [{ encoded, createdAt: 1, mode: "solid", thumbnail: "" }],
    });
  });
});
