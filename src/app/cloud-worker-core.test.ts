import {
  canonicalColorSourceByteCeiling,
  cloudResultTransfers,
  generateCloud,
  MAX_CANONICAL_COLOR_SOURCE_BYTES,
} from "./cloud-worker-core";
import type {
  CloudRequest,
  CloudResult,
  CloudResult3D,
  CloudResult4D,
} from "./cloud-worker-core";
import { emitterSamplerCapability, runChaosGame } from "../fractal/chaos-game";
import { runChaosGame4 } from "../fractal/chaos-game-4d";
import { toTransform4 } from "../fractal/affine4";
import { buildColors } from "../fractal/color";
import type { PositionAxisColors } from "../fractal/color";
import { mulberry32 } from "../fractal/rng";
import {
  doubleRotation,
  pentatope,
  sierpinskiTetrahedron,
} from "../fractal/presets";
import { foldToChamber, TILING_GROUP_INFO } from "../fractal/tiling";
import {
  isResolvedLatticeTiling,
  type TilingGroup,
  type TilingSpec,
} from "../fractal/tiling";
import { resolvePointTilingSession } from "../fractal/point-tiling-session";
import {
  latticeCameraCarrierRadius4,
  latticeCameraFitBounds,
} from "../fractal/lattice-march";
import type { Transform, Vec3, Vec4 } from "../fractal/types";
import { framingBounds, framingRadius4 } from "./framing-bounds";
import { MAX_NUM_POINTS } from "./state";
import {
  hasMeshAsset,
  uninstallCustomMeshAsset,
  type CustomMeshAssetId,
  type SerializedPreparedMeshAsset,
} from "../fractal/mesh-shapes";

const CLOUD_MESH_ID: CustomMeshAssetId = `mesh-sha256-${"1".repeat(64)}`;

function meshSource(
  id: CustomMeshAssetId = CLOUD_MESH_ID,
): SerializedPreparedMeshAsset {
  return {
    id,
    name: "Worker tetra",
    vertices: new Float64Array([1, 1, 1, -1, -1, 1, -1, 1, -1, 1, -1, -1]),
    triangles: new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]),
  };
}

function customMeshTransform(id: CustomMeshAssetId = CLOUD_MESH_ID): Transform {
  return {
    id: 0,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [0.5, 0.5, 0.5],
    emitter: {
      parts: [
        {
          combine: "union",
          primitive: { kind: "mesh", meshId: id },
        },
      ],
    },
  };
}

/**
 * A minimal, fully-specified 3D `CloudRequest`, overridable per test so each
 * test states only what it actually varies. `replaced`/`fit` never affect
 * compute (see cloud-worker-core.ts's doc), so they default to `false`
 * everywhere.
 */
function cloudRequest(overrides: Partial<CloudRequest> = {}): CloudRequest {
  return {
    id: 1,
    transforms: sierpinskiTetrahedron(),
    finalTransform: null,
    numPoints: 500,
    seed: 42,
    symmetry: { order: 1, plane: "xz" },
    fourD: false,
    colorMode: "transform",
    colorGamma: 1,
    rampPalette: "legacy",
    schedule: null,
    replaced: false,
    fit: false,
    ...overrides,
  };
}

/** Narrow a `CloudResult` to its 3D shape, failing with a clear message if
 * `generateCloud` unexpectedly returned the 4D variant. */
function as3D(result: CloudResult): CloudResult3D {
  if (result.fourD) throw new Error("expected a 3D CloudResult");
  return result;
}

/** Narrow a `CloudResult` to its 4D shape (see {@link as3D}). */
function as4D(result: CloudResult): CloudResult4D {
  if (!result.fourD) throw new Error("expected a 4D CloudResult");
  return result;
}

function pointTilingFixture(fourD: boolean): {
  transforms: Transform[];
  tiling: TilingSpec;
} {
  return fourD
    ? { transforms: pentatope(), tiling: { group: "a4" } }
    : { transforms: sierpinskiTetrahedron(), tiling: { group: "a3" } };
}

function farClipTiling(fourD: boolean): TilingSpec {
  return {
    group: fourD ? "a4" : "a3",
    clip: {
      parts: [
        {
          primitive: { kind: "sphere", radius: 0.1 },
          combine: "union",
          pose: { offset: [100, 100, 100] },
        },
      ],
    },
  };
}

function foldedPoint(group: TilingGroup, input: Vec3 | Vec4): Vec3 | Vec4 {
  const point = foldToChamber(
    TILING_GROUP_INFO[group],
    input,
    input.length === 4 ? [0, 0, 0, 0] : [0, 0, 0],
  );
  if (!point) throw new Error("test point did not fold into the chamber");
  return point;
}

/** A low-probability contractive map lands in a tiny authored chamber clip;
 * the dominant map lands outside it. The accepted rare source emits a full
 * finite orbit, but the shared 8N source cap expires before filling N. */
function underfilledPointTilingFixture(fourD: boolean): {
  transforms: Transform[];
  tiling: TilingSpec;
} {
  const group = fourD ? "a4" : "a3";
  const rare = foldedPoint(
    group,
    fourD ? [0.17, -0.31, 0.53, 0.71] : [0.17, -0.31, 0.53],
  );
  const common = foldedPoint(
    group,
    fourD ? [-0.61, 0.37, -0.23, 0.11] : [-0.61, 0.37, -0.23],
  );
  const contraction = 0.01;
  const translation = 1 - contraction;
  const rareWeight = 1;
  const commonWeight = fourD ? 1199 : 399;
  const transform = (
    id: number,
    fixed: Vec3 | Vec4,
    weight: number,
  ): Transform => ({
    id,
    position: [
      fixed[0] * translation,
      fixed[1] * translation,
      fixed[2] * translation,
    ],
    rotation: [0, 0, 0],
    scale: [contraction, contraction, contraction],
    weight,
    ...(fourD
      ? {
          w: {
            position: (fixed as Vec4)[3] * translation,
            scale: contraction,
          },
        }
      : {}),
  });
  return {
    transforms: [
      transform(0, common, commonWeight),
      transform(1, rare, rareWeight),
    ],
    tiling: {
      group,
      clip: {
        parts: [
          {
            primitive: { kind: "sphere", radius: 0.04 },
            combine: "union",
            pose: { offset: [rare[0], rare[1], rare[2]] },
          },
        ],
      },
    },
  };
}

describe("generateCloud 3D", () => {
  it.each([false, true])(
    "installs a custom mesh emitter payload for the %s path",
    (fourD) => {
      const request = cloudRequest({
        transforms: [customMeshTransform()],
        numPoints: 40,
        fourD,
      });

      try {
        const result = generateCloud({
          ...request,
          meshAssets: [meshSource()],
        });
        expect(result.count).toBe(40);
        expect(result.fourD).toBe(fourD);
        expect(
          emitterSamplerCapability(request.transforms[0].emitter).status,
        ).toBe("sampleable");
      } finally {
        uninstallCustomMeshAsset(CLOUD_MESH_ID);
      }
    },
  );

  it("rejects a malformed batch without partially installing earlier wires", () => {
    const malformedId: CustomMeshAssetId = `mesh-sha256-${"2".repeat(64)}`;
    const malformed = {
      ...meshSource(malformedId),
      vertices: new Float64Array([0]),
    };

    expect(() =>
      generateCloud(
        cloudRequest({
          transforms: [customMeshTransform()],
          meshAssets: [meshSource(), malformed],
        }),
      ),
    ).toThrow(/malformed/);
    expect(hasMeshAsset(CLOUD_MESH_ID)).toBe(false);
  });

  it("accepts a two-scene transient set and rejects a ninth source", () => {
    const ids = Array.from(
      { length: 9 },
      (_, index) =>
        `mesh-sha256-${index.toString(16).padStart(64, "0")}` as const,
    );
    try {
      expect(
        generateCloud(
          cloudRequest({
            transforms: [],
            meshAssets: ids.slice(0, 8).map(meshSource),
          }),
        ).count,
      ).toBe(0);
      expect(() =>
        generateCloud(
          cloudRequest({
            meshAssets: ids.map(meshSource),
          }),
        ),
      ).toThrow(/too many custom mesh sources/);
    } finally {
      for (const id of ids) uninstallCustomMeshAsset(id);
    }
  });

  it("rejects a conflicting wire for an id already installed in the worker", () => {
    const request = cloudRequest({
      transforms: [customMeshTransform()],
      numPoints: 20,
      meshAssets: [meshSource()],
    });
    try {
      generateCloud(request);
      const source = meshSource();
      const conflicting = {
        ...source,
        vertices: source.vertices.map((value) => value * 2),
      };
      expect(() =>
        generateCloud({ ...request, meshAssets: [conflicting] }),
      ).toThrow(/conflicts with installed source/);
      expect(
        generateCloud({
          ...request,
          meshAssets: undefined,
          meshAssetIds: [CLOUD_MESH_ID],
        }).count,
      ).toBe(20);
    } finally {
      uninstallCustomMeshAsset(CLOUD_MESH_ID);
    }
  });

  it("matches runChaosGame for positions/indices/count/bounds and echoes fourD/id (oracle)", () => {
    const req = cloudRequest({ id: 7 });
    const result = as3D(generateCloud(req));

    const direct = runChaosGame(
      req.transforms,
      req.numPoints,
      mulberry32(req.seed),
      req.finalTransform,
      req.symmetry,
    );

    expect(result.positions).toEqual(direct.positions);
    expect(result.transformIndices).toEqual(direct.transformIndices);
    expect(result.count).toBe(direct.count);
    expect(result.bounds).toEqual(direct.bounds);
    expect(result.fourD).toBe(false);
    expect(result.id).toBe(7);
  });

  it("bakes outlier-robust framing bounds from the delivered cloud (oracle)", () => {
    const req = cloudRequest({ id: 9 });
    const result = as3D(generateCloud(req));

    const direct = runChaosGame(
      req.transforms,
      req.numPoints,
      mulberry32(req.seed),
      req.finalTransform,
      req.symmetry,
    );
    const expectedFrameBounds = framingBounds(direct.positions, direct.count);

    expect(result.frameBounds).toEqual(expectedFrameBounds);
  });

  it("bakes colors matching buildColors for the request's mode and gamma (oracle)", () => {
    const req = cloudRequest({ colorMode: "height", colorGamma: 1.4 });
    const result = as3D(generateCloud(req));

    const direct = runChaosGame(
      req.transforms,
      req.numPoints,
      mulberry32(req.seed),
      req.finalTransform,
      req.symmetry,
    );
    const expectedColors = buildColors(direct, req.transforms, "height", 1.4);

    expect(result.colors).toEqual(expectedColors);
  });

  it("bakes the request's ramp palette into the height/radius colors (oracle)", () => {
    const req = cloudRequest({ colorMode: "radius", rampPalette: "spectrum" });
    const result = as3D(generateCloud(req));

    const direct = runChaosGame(
      req.transforms,
      req.numPoints,
      mulberry32(req.seed),
      req.finalTransform,
      req.symmetry,
    );
    const expectedColors = buildColors(
      direct,
      req.transforms,
      "radius",
      1,
      "spectrum",
    );

    expect(result.colors).toEqual(expectedColors);
    // And the palette genuinely changed the bake — guards against the
    // parameter silently not reaching buildColors.
    expect(result.colors).not.toEqual(
      buildColors(direct, req.transforms, "radius", 1),
    );
  });

  it("bakes the request's custom position axis colors into the colors (oracle)", () => {
    const axes: PositionAxisColors = {
      x: [1, 0.5, 0],
      y: [0, 0.5, 1],
      z: [1, 1, 1],
    };
    const req = cloudRequest({
      colorMode: "position",
      positionAxisColors: axes,
    });
    const result = as3D(generateCloud(req));

    const direct = runChaosGame(
      req.transforms,
      req.numPoints,
      mulberry32(req.seed),
      req.finalTransform,
      req.symmetry,
    );
    const expectedColors = buildColors(
      direct,
      req.transforms,
      "position",
      1,
      "legacy",
      axes,
    );

    expect(result.colors).toEqual(expectedColors);
    // And the axis colors genuinely changed the bake — guards against the
    // parameter silently not reaching buildColors.
    expect(result.colors).not.toEqual(
      buildColors(direct, req.transforms, "position"),
    );
  });

  it("passes symmetry through to runChaosGame, differing from the order-1 output", () => {
    const req = cloudRequest({ symmetry: { order: 3, plane: "xz" } });
    const result = as3D(generateCloud(req));

    const direct = runChaosGame(
      req.transforms,
      req.numPoints,
      mulberry32(req.seed),
      req.finalTransform,
      req.symmetry,
    );
    expect(result.positions).toEqual(direct.positions);
    expect(result.transformIndices).toEqual(direct.transformIndices);
    expect(result.bounds).toEqual(direct.bounds);

    const orderOne = as3D(generateCloud(cloudRequest()));
    expect(Array.from(result.positions)).not.toEqual(
      Array.from(orderOne.positions),
    );
  });

  it("passes the final transform through to runChaosGame, differing from the unlensed output", () => {
    const finalTransform: Transform = {
      id: 0,
      position: [0.2, -0.1, 0],
      rotation: [0, 0.3, 0],
      scale: [1.2, 1.2, 1.2],
    };
    const req = cloudRequest({ finalTransform });
    const result = as3D(generateCloud(req));

    const direct = runChaosGame(
      req.transforms,
      req.numPoints,
      mulberry32(req.seed),
      req.finalTransform,
      req.symmetry,
    );
    expect(result.positions).toEqual(direct.positions);
    expect(result.transformIndices).toEqual(direct.transformIndices);
    expect(result.bounds).toEqual(direct.bounds);

    const unlensed = as3D(generateCloud(cloudRequest()));
    expect(Array.from(result.positions)).not.toEqual(
      Array.from(unlensed.positions),
    );
  });

  it("returns an empty result with no transforms", () => {
    const req = cloudRequest({ transforms: [] });
    const result = as3D(generateCloud(req));

    expect(result.count).toBe(0);
    expect(result.positions).toHaveLength(0);
    expect(result.transformIndices).toHaveLength(0);
    expect(result.colors).toHaveLength(0);
    expect(result.frameBounds).toEqual({
      minX: 0,
      maxX: 0,
      minY: 0,
      maxY: 0,
      minZ: 0,
      maxZ: 0,
      minR: 0,
      maxR: 0,
    });
  });

  it("isolates iteration-local randomness from the pick stream, keeping ε-different same-seed requests correspondent", () => {
    // The morph streams per-frame requests that differ only by a tiny
    // parameter step, under ONE pinned seed (morph-tween.ts). This system
    // exercises every desynchronization source: a non-1 weight (weighted
    // pick path, so an ε weight change flips occasional picks), a `julia`
    // map (stochastic per-application draws), and a `spherical` map that
    // diverges near the origin (occasional escape reseeds). On a shared RNG
    // stream, one differing draw would shift every later transform pick and
    // re-roll the whole remaining cloud (~90% of points displaced on this
    // fixture; ~2% with iteration-local draws).
    const gauntletSystem = (weight0: number, aPosX: number): Transform[] => [
      {
        id: 0,
        position: [aPosX, 0.5, 0.5],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0.5],
        weight: weight0,
      },
      {
        id: 1,
        position: [-0.5, -0.5, -0.5],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0.5],
        variations: [
          { type: "linear", weight: 1 },
          { type: "julia", weight: 0.3 },
        ],
      },
      {
        id: 2,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [0.6, 0.6, 0.6],
        variations: [{ type: "spherical", weight: 1 }],
      },
    ];
    const numPoints = 20_000;
    const a = as3D(
      generateCloud(
        cloudRequest({ transforms: gauntletSystem(2, 0.5), numPoints }),
      ),
    );
    const b = as3D(
      generateCloud(
        cloudRequest({ transforms: gauntletSystem(2.01, 0.502), numPoints }),
      ),
    );

    let jumped = 0;
    for (let i = 0; i < numPoints; i++) {
      const dx = a.positions[i * 3] - b.positions[i * 3];
      const dy = a.positions[i * 3 + 1] - b.positions[i * 3 + 1];
      const dz = a.positions[i * 3 + 2] - b.positions[i * 3 + 2];
      if (Math.hypot(dx, dy, dz) > 0.3) jumped++;
    }
    expect(jumped / numPoints).toBeLessThan(0.15);

    // And the isolation genuinely engaged: a run whose local draws share
    // the pick stream diverges from generateCloud's output — which also
    // guards this fixture against silently going tame (the two would then
    // be identical).
    const sharedStream = runChaosGame(
      gauntletSystem(2, 0.5),
      numPoints,
      mulberry32(cloudRequest({}).seed),
      null,
      cloudRequest({}).symmetry,
    );
    expect(a.positions).not.toEqual(sharedStream.positions);
  });
});

describe("generateCloud 4D", () => {
  it("matches runChaosGame4 for positions/w/indices/count/bounds/center/radius and echoes fourD/id (oracle)", () => {
    const transforms = doubleRotation(); // both maps carry a `w` extension
    const req = cloudRequest({ id: 12, fourD: true, transforms });
    const result = as4D(generateCloud(req));

    const final4 = req.finalTransform ? toTransform4(req.finalTransform) : null;
    const direct = runChaosGame4(
      transforms.map(toTransform4),
      req.numPoints,
      mulberry32(req.seed),
      final4,
    );

    expect(result.positions).toEqual(direct.positions);
    expect(result.w).toEqual(direct.w);
    expect(result.transformIndices).toEqual(direct.transformIndices);
    expect(result.count).toBe(direct.count);
    expect(result.bounds).toEqual(direct.bounds);
    expect(result.center).toEqual(direct.center);
    expect(result.radius).toBe(direct.radius);
    expect(result.fourD).toBe(true);
    expect(result.id).toBe(12);
  });

  it("bakes an outlier-robust framing radius from the delivered cloud (oracle)", () => {
    const transforms = doubleRotation(); // both maps carry a `w` extension
    const req = cloudRequest({ id: 14, fourD: true, transforms });
    const result = as4D(generateCloud(req));

    const final4 = req.finalTransform ? toTransform4(req.finalTransform) : null;
    const direct = runChaosGame4(
      transforms.map(toTransform4),
      req.numPoints,
      mulberry32(req.seed),
      final4,
    );
    const expectedFrameRadius = framingRadius4(
      direct.positions,
      direct.w,
      direct.count,
      direct.center,
    );

    expect(result.frameRadius).toBe(expectedFrameRadius);
  });

  it("returns an empty result with no transforms", () => {
    const req = cloudRequest({ fourD: true, transforms: [] });
    const result = as4D(generateCloud(req));

    expect(result.count).toBe(0);
    expect(result.positions).toHaveLength(0);
    expect(result.w).toHaveLength(0);
    expect(result.transformIndices).toHaveLength(0);
    expect(result.frameRadius).toBe(0);
  });
});

describe("generateCloud point tiling integration", () => {
  it.each([false, true] as const)(
    "returns a complete active finite tiled cloud with canonical provenance in %sD",
    (fourD) => {
      const fixture = pointTilingFixture(fourD);
      const requested = fourD ? 240 : 96;
      const request = cloudRequest({
        ...fixture,
        id: fourD ? 42 : 41,
        fourD,
        numPoints: requested,
        colorMode: "height",
      });
      const result = generateCloud(request);

      expect(result.count).toBe(requested);
      expect(result.pointTiling).toEqual(
        expect.objectContaining({
          availability: "active",
          kind: "finite",
          fill: "complete",
          requested,
        }),
      );
      if (result.pointTiling?.availability !== "active") {
        throw new Error("expected an active point-tiling outcome");
      }
      expect(result.pointTiling.attempts).toBeGreaterThan(0);
      expect(result.pointTiling.attempts).toBeLessThanOrEqual(requested * 8);
      expect(result.pointTiling.accepted).toBeGreaterThan(0);
      expect(result.canonicalColorSource).toBeDefined();

      if (result.fourD) {
        const source = result.canonicalColorSource!;
        expect(source.positions).toHaveLength(requested * 3);
        expect(source.w).toHaveLength(requested);
        expect(source.center).not.toEqual(result.center);
        expect(source.positions.byteLength + source.w.byteLength).toBe(
          canonicalColorSourceByteCeiling(result.count, true),
        );
      } else {
        const source = result.canonicalColorSource!;
        expect(source.positions).toHaveLength(requested * 3);
        expect(source.positions).not.toEqual(result.positions);
        expect(result.colors).toEqual(
          buildColors(
            result,
            request.transforms,
            request.colorMode,
            request.colorGamma,
            request.rampPalette,
            request.positionAxisColors,
            source,
          ),
        );
        expect(source.positions.byteLength).toBe(
          canonicalColorSourceByteCeiling(result.count, false),
        );
      }
    },
  );

  it.each([
    ["a3", false],
    ["b3", false],
    ["h3", false],
    ["a4", true],
    ["b4", true],
    ["f4", true],
  ] as const)(
    "routes finite group %s through the active worker path within both caps",
    (group, fourD) => {
      const requested = 12;
      const result = generateCloud(
        cloudRequest({
          transforms: fourD ? pentatope() : sierpinskiTetrahedron(),
          tiling: { group },
          fourD,
          numPoints: requested,
          seed: 101,
        }),
      );

      expect(result.pointTiling).toEqual(
        expect.objectContaining({
          availability: "active",
          kind: "finite",
          requested,
        }),
      );
      if (result.pointTiling?.availability !== "active") {
        throw new Error(`expected active point tiling for ${group}`);
      }
      expect(result.count).toBeLessThanOrEqual(requested);
      expect(result.pointTiling.attempts).toBeLessThanOrEqual(requested * 8);
      expect(result.pointTiling.candidateTests).toBeLessThanOrEqual(
        requested * 8,
      );
      expect(result.positions).toHaveLength(result.count * 3);
      expect(result.transformIndices).toHaveLength(result.count);
      expect(result.canonicalColorSource?.positions).toHaveLength(
        result.count * 3,
      );
      if (result.fourD) {
        expect(result.w).toHaveLength(result.count);
        expect(result.canonicalColorSource?.w).toHaveLength(result.count);
      } else {
        expect(result.colors).toHaveLength(result.count * 3);
      }
    },
  );

  it.each([false, true] as const)(
    "runs the active mirrored-lattice path and frames its canonical cell in %sD",
    (fourD) => {
      const transforms = fourD ? pentatope() : sierpinskiTetrahedron();
      const tiling: TilingSpec = { kind: "lattice", cellScale: 1 };
      const request = cloudRequest({
        transforms,
        tiling,
        fourD,
        numPoints: 64,
      });
      const session = resolvePointTilingSession(
        transforms,
        null,
        request.symmetry,
        null,
        tiling,
        false,
        fourD,
      );
      if (
        session.status !== "active" ||
        !isResolvedLatticeTiling(session.resolved)
      ) {
        throw new Error("expected an active resolved lattice fixture");
      }

      const result = generateCloud(request);

      expect(result.count).toBe(request.numPoints);
      expect(result.pointTiling).toEqual(
        expect.objectContaining({
          availability: "active",
          kind: "lattice",
          fill: "complete",
          requested: request.numPoints,
        }),
      );
      expect(result.canonicalColorSource).toBeDefined();
      if (result.fourD) {
        expect(result.frameRadius).toBe(
          latticeCameraCarrierRadius4(
            session.resolved.h,
            session.resolved.radius,
          ),
        );
      } else {
        expect(result.frameBounds).toEqual(
          latticeCameraFitBounds(
            session.resolved.h,
            session.resolved.radius,
            false,
          ),
        );
      }
    },
  );

  it.each([false, true] as const)(
    "keeps a refused %sD request on the byte-identical ordinary path",
    (fourD) => {
      const fixture = pointTilingFixture(fourD);
      const request = cloudRequest({
        ...fixture,
        fourD,
        numPoints: 80,
        balloonEcho: true,
      });
      const refused = generateCloud(request);
      const ordinary = generateCloud({
        ...request,
        tiling: null,
        balloonEcho: false,
      });

      expect(refused.count).toBe(request.numPoints);
      expect(refused.positions).toEqual(ordinary.positions);
      expect(refused.transformIndices).toEqual(ordinary.transformIndices);
      expect(refused.bounds).toEqual(ordinary.bounds);
      expect(refused.canonicalColorSource).toBeUndefined();
      expect(refused.pointTiling).toEqual({
        availability: "refused",
        note: "Point tiling is unavailable with Balloon; turn Balloon off.",
      });
      if (refused.fourD && ordinary.fourD) {
        expect(refused.w).toEqual(ordinary.w);
        expect(refused.center).toEqual(ordinary.center);
        expect(refused.radius).toBe(ordinary.radius);
      } else if (!refused.fourD && !ordinary.fourD) {
        expect(refused.colors).toEqual(ordinary.colors);
        expect(refused.frameBounds).toEqual(ordinary.frameBounds);
      } else {
        throw new Error("refused and ordinary result dimensions disagreed");
      }
    },
  );

  it.each([false, true] as const)(
    "returns an explicit empty active %sD result at 8N with no ordinary fallback",
    (fourD) => {
      const fixture = pointTilingFixture(fourD);
      const requested = 7;
      const result = generateCloud(
        cloudRequest({
          transforms: fixture.transforms,
          tiling: farClipTiling(fourD),
          fourD,
          numPoints: requested,
        }),
      );

      expect(result.count).toBe(0);
      expect(result.positions).toHaveLength(0);
      expect(result.transformIndices).toHaveLength(0);
      expect(result.canonicalColorSource?.positions).toHaveLength(0);
      expect(result.pointTiling).toEqual({
        availability: "active",
        kind: "finite",
        fill: "empty",
        requested,
        attempts: requested * 8,
        accepted: 0,
        candidateTests: 0,
      });
      if (result.fourD) {
        expect(result.w).toHaveLength(0);
        expect(result.canonicalColorSource?.w).toHaveLength(0);
      } else {
        expect(result.colors).toHaveLength(0);
      }
    },
  );

  it.each([false, true] as const)(
    "reports a capped underfilled active finite cloud in %sD",
    (fourD) => {
      const fixture = underfilledPointTilingFixture(fourD);
      const requested = fourD ? 300 : 100;
      const result = generateCloud(
        cloudRequest({
          ...fixture,
          fourD,
          numPoints: requested,
          seed: fourD ? 73 : 71,
        }),
      );

      expect(result.count).toBeGreaterThan(0);
      expect(result.count).toBeLessThan(requested);
      expect(result.pointTiling).toEqual(
        expect.objectContaining({
          availability: "active",
          kind: "finite",
          fill: "underfilled",
          requested,
          attempts: requested * 8,
        }),
      );
      expect(result.canonicalColorSource?.positions).toHaveLength(
        result.count * 3,
      );
      if (result.fourD) {
        const source = result.canonicalColorSource!;
        expect(source.w).toHaveLength(result.count);
        expect(
          source.positions.buffer.byteLength + source.w.buffer.byteLength,
        ).toBe(canonicalColorSourceByteCeiling(requested, true));
      } else {
        expect(result.canonicalColorSource!.positions.buffer.byteLength).toBe(
          canonicalColorSourceByteCeiling(requested, false),
        );
      }
    },
  );
});

describe("canonical color source memory ceiling", () => {
  it("caps canonical provenance at 60 MB in 3D and 80 MB in 4D at the authored 5M maximum", () => {
    expect(MAX_NUM_POINTS).toBe(5_000_000);
    expect(MAX_CANONICAL_COLOR_SOURCE_BYTES).toBe(80_000_000);
    expect(canonicalColorSourceByteCeiling(MAX_NUM_POINTS, false)).toBe(
      60_000_000,
    );
    expect(canonicalColorSourceByteCeiling(MAX_NUM_POINTS, true)).toBe(
      MAX_CANONICAL_COLOR_SOURCE_BYTES,
    );
  });

  it("rejects an oversized active 4D tiled wire before reading transforms or allocating its cloud", () => {
    const request = cloudRequest({
      transforms: pentatope(),
      tiling: { group: "a4" },
      fourD: true,
      numPoints: MAX_NUM_POINTS + 1,
    });
    let transformsRead = false;
    Object.defineProperty(request, "transforms", {
      get: () => {
        transformsRead = true;
        return pentatope();
      },
    });

    expect(() => generateCloud(request)).toThrow(
      /80000016 bytes, exceeding the 80000000-byte worker ceiling/,
    );
    expect(transformsRead).toBe(false);
  });

  it("rejects invalid capacities instead of returning an unsafe byte budget", () => {
    expect(() => canonicalColorSourceByteCeiling(-1, false)).toThrow(
      /non-negative safe integer/,
    );
    expect(() =>
      canonicalColorSourceByteCeiling(Number.MAX_SAFE_INTEGER, true),
    ).toThrow(/byte ceiling is unsafe/);
  });
});

describe("cloudResultTransfers", () => {
  it("lists positions, transformIndices, and colors buffers for a 3D result", () => {
    const result = as3D(generateCloud(cloudRequest()));

    const transfers = cloudResultTransfers(result);

    expect(transfers).toHaveLength(3);
    expect(transfers[0]).toBe(result.positions.buffer);
    expect(transfers[1]).toBe(result.transformIndices.buffer);
    expect(transfers[2]).toBe(result.colors.buffer);
  });

  it("lists positions, transformIndices, and w buffers for a 4D result", () => {
    const req = cloudRequest({ fourD: true, transforms: doubleRotation() });
    const result = as4D(generateCloud(req));

    const transfers = cloudResultTransfers(result);

    expect(transfers).toHaveLength(3);
    expect(transfers[0]).toBe(result.positions.buffer);
    expect(transfers[1]).toBe(result.transformIndices.buffer);
    expect(transfers[2]).toBe(result.w.buffer);
  });

  it.each([false, true] as const)(
    "adds each canonical provenance buffer exactly once for an active tiled %sD result",
    (fourD) => {
      const fixture = pointTilingFixture(fourD);
      const result = generateCloud(
        cloudRequest({ ...fixture, fourD, numPoints: fourD ? 240 : 96 }),
      );

      const transfers = cloudResultTransfers(result);

      expect(new Set(transfers).size).toBe(transfers.length);
      if (result.fourD) {
        expect(transfers).toEqual([
          result.positions.buffer,
          result.transformIndices.buffer,
          result.w.buffer,
          result.canonicalColorSource!.positions.buffer,
          result.canonicalColorSource!.w.buffer,
        ]);
      } else {
        expect(transfers).toEqual([
          result.positions.buffer,
          result.transformIndices.buffer,
          result.colors.buffer,
          result.canonicalColorSource!.positions.buffer,
        ]);
      }
    },
  );
});
