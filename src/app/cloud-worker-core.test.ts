import { cloudResultTransfers, generateCloud } from "./cloud-worker-core";
import type {
  CloudRequest,
  CloudResult,
  CloudResult3D,
  CloudResult4D,
} from "./cloud-worker-core";
import { runChaosGame } from "../fractal/chaos-game";
import { runChaosGame4 } from "../fractal/chaos-game-4d";
import { toTransform4 } from "../fractal/affine4";
import { buildColors } from "../fractal/color";
import type { PositionAxisColors } from "../fractal/color";
import { mulberry32 } from "../fractal/rng";
import { doubleRotation, sierpinskiTetrahedron } from "../fractal/presets";
import type { Transform } from "../fractal/types";

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
    symmetry: { order: 1, axis: "y" },
    fourD: false,
    colorMode: "transform",
    colorGamma: 1,
    rampPalette: "legacy",
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

describe("generateCloud 3D", () => {
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

  it("bakes the request's ramp palette into the height/radius colors (fr-3b6, oracle)", () => {
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

  it("bakes the request's custom position axis colors into the colors (fr-8k7, oracle)", () => {
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
    const req = cloudRequest({ symmetry: { order: 3, axis: "y" } });
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

  it("returns an empty result with no transforms", () => {
    const req = cloudRequest({ fourD: true, transforms: [] });
    const result = as4D(generateCloud(req));

    expect(result.count).toBe(0);
    expect(result.positions).toHaveLength(0);
    expect(result.w).toHaveLength(0);
    expect(result.transformIndices).toHaveLength(0);
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
});
