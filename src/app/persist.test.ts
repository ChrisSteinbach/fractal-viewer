// @vitest-environment jsdom
import {
  decodeScene,
  encodeScene,
  fromSnapshot,
  loadScene,
  toSnapshot,
} from "./persist";
import type { SceneSnapshot } from "./persist";
import { MAX_TRANSFORMS } from "../fractal/chaos-game";
import {
  MAX_CUSTOM_PALETTE_STOPS,
  MIN_CUSTOM_PALETTE_STOPS,
} from "../fractal/palette";
import { VOXEL_RESOLUTION_STEP } from "../fractal/voxel";
import { MAX_PHI, MAX_RADIUS, MIN_PHI, MIN_RADIUS } from "./orbit";
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
  DEFAULT_FOUR_D_COLOR,
  DEFAULT_GLOW_BRIGHTNESS,
  DEFAULT_RAMP_PALETTE,
  DEFAULT_SOLID_AMBIENT,
  DEFAULT_SOLID_ITERATIONS,
  DEFAULT_SOLID_LIGHT_AZIMUTH,
  DEFAULT_SOLID_LIGHT_ELEVATION,
  DEFAULT_SOLID_PALETTE,
  DEFAULT_SOLID_RESOLUTION,
  DEFAULT_SOLID_THRESHOLD,
  DEFAULT_SYMMETRY_AXIS,
  DEFAULT_SYMMETRY_ORDER,
  MAX_COLOR_GAMMA,
  MAX_ESTIMATOR_CURVE,
  MAX_ESTIMATOR_RADIUS,
  MAX_FLAME_EXPOSURE,
  MAX_FLAME_GAMMA,
  MAX_FLAME_ITERATIONS,
  MAX_FLAME_SUPERSAMPLE,
  MAX_GLOW_BRIGHTNESS,
  MAX_SOLID_RESOLUTION,
  MAX_SOLID_THRESHOLD,
  MAX_SYMMETRY_ORDER,
  MAX_W_ANGLE,
  MAX_W_POSITION,
  MAX_W_SCALE,
  MAX_W_SHEAR,
  MIN_COLOR_GAMMA,
  MIN_ESTIMATOR_MINIMUM_RADIUS,
  MIN_FLAME_EXPOSURE,
  MIN_FLAME_ITERATIONS,
  MIN_FLAME_VIBRANCY,
  MIN_GLOW_BRIGHTNESS,
  MIN_NUM_POINTS,
  MIN_SOLID_AMBIENT,
  MIN_SOLID_ITERATIONS,
  MIN_SOLID_RESOLUTION,
  MIN_SYMMETRY_ORDER,
  MIN_W_POSITION,
  MIN_W_SCALE,
  initialState,
} from "./state";
import type { AppState } from "./state";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Encode a string as base64url — lets tests construct raw payloads directly. */
function b64url(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/** Inverse of `b64url` (mirrors persist.ts's own `fromBase64url`), so a test
 * can inspect the raw encoded payload's keys directly. */
function decodePayload(encoded: string): Record<string, unknown> {
  const raw = encoded.replace(/^v1=/, "");
  const padded = raw + "=".repeat((4 - (raw.length % 4)) % 4);
  const parsed: unknown = JSON.parse(
    atob(padded.replace(/-/g, "+").replace(/_/g, "/")),
  );
  return parsed as Record<string, unknown>;
}

/** A minimal valid snapshot used as the starting point in every test. */
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
      resolution: DEFAULT_SOLID_RESOLUTION,
      iterations: DEFAULT_SOLID_ITERATIONS,
      threshold: DEFAULT_SOLID_THRESHOLD,
      lightAzimuth: DEFAULT_SOLID_LIGHT_AZIMUTH,
      lightElevation: DEFAULT_SOLID_LIGHT_ELEVATION,
      ambient: DEFAULT_SOLID_AMBIENT,
      paletteId: DEFAULT_SOLID_PALETTE,
    },
    symmetry: { order: DEFAULT_SYMMETRY_ORDER, axis: DEFAULT_SYMMETRY_AXIS },
    glowBrightness: DEFAULT_GLOW_BRIGHTNESS,
  };
}

// ---------------------------------------------------------------------------
// Round-trip
// ---------------------------------------------------------------------------

describe("encodeScene / decodeScene round-trip", () => {
  it("recovers all snapshot fields after encode → decode", () => {
    const s = baseSnapshot();
    const result = decodeScene(encodeScene(s));

    expect(result).not.toBeNull();
    expect(result!.transforms).toHaveLength(1);
    expect(result!.transforms[0].position).toEqual([0, 0, 0]);
    expect(result!.transforms[0].rotation).toEqual([0, 0, 0]);
    expect(result!.transforms[0].scale).toEqual([0.5, 0.5, 0.5]);
    expect(result!.numPoints).toBe(100_000);
    expect(result!.pointSize).toBe(1);
    expect(result!.colorMode).toBe("transform");
    expect(result!.renderStyle).toBe("depthFade");
    expect(result!.showGuides).toBe(true);
    expect(result!.flame).toEqual({
      exposure: DEFAULT_FLAME_EXPOSURE,
      iterations: DEFAULT_FLAME_ITERATIONS,
      gamma: DEFAULT_FLAME_GAMMA,
      vibrancy: DEFAULT_FLAME_VIBRANCY,
      supersample: DEFAULT_FLAME_SUPERSAMPLE,
      estimatorRadius: DEFAULT_ESTIMATOR_RADIUS,
      estimatorMinimumRadius: DEFAULT_ESTIMATOR_MINIMUM_RADIUS,
      estimatorCurve: DEFAULT_ESTIMATOR_CURVE,
      paletteId: DEFAULT_FLAME_PALETTE,
    });
    expect(result!.solid).toEqual({
      resolution: DEFAULT_SOLID_RESOLUTION,
      iterations: DEFAULT_SOLID_ITERATIONS,
      threshold: DEFAULT_SOLID_THRESHOLD,
      lightAzimuth: DEFAULT_SOLID_LIGHT_AZIMUTH,
      lightElevation: DEFAULT_SOLID_LIGHT_ELEVATION,
      ambient: DEFAULT_SOLID_AMBIENT,
      paletteId: DEFAULT_SOLID_PALETTE,
    });
  });

  it("reassigns transform ids from the array index, ignoring stored ids", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      transforms: [
        {
          id: 99,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
        },
        {
          id: 42,
          position: [1, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
        },
      ],
    };
    const result = decodeScene(encodeScene(s));
    expect(result!.transforms[0].id).toBe(0);
    expect(result!.transforms[1].id).toBe(1);
  });

  it("rounds floats to 4 decimal places in both transforms and pointSize", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      transforms: [
        {
          id: 0,
          position: [1.23456789, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
        },
      ],
      pointSize: 1.23456789,
    };
    const result = decodeScene(encodeScene(s));
    // 1.23456789 rounds to 1.2346 at 4 dp.
    expect(result!.transforms[0].position[0]).toBeCloseTo(1.2346, 4);
    expect(result!.pointSize).toBeCloseTo(1.2346, 4);
  });

  // history.ts dedupes undo checkpoints by comparing encoded strings with
  // `===` (see its checkpoint/undo), which only holds if encoding a snapshot,
  // decoding it, and re-encoding the result always reproduces the identical
  // string. Exercises every optional field in one snapshot — a transform with
  // weight, shear, variations, and a full w block, plus a finalTransform — so
  // this is pinned for more than just the empty-snapshot case.
  it("re-encodes to the identical string after a decode round-trip", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      transforms: [
        {
          id: 0,
          position: [0.1, 0.2, 0.3],
          rotation: [0.4, 0.5, 0.6],
          scale: [0.7, 0.8, 0.9],
          weight: 2.5,
          shear: [0.1, -0.2, 0.3],
          variations: [
            { type: "spherical", weight: 1 },
            { type: "swirl", weight: 0.4 },
          ],
          w: {
            position: 0.3,
            scale: 0.6,
            rotation: { zw: -0.75 },
            shear: { xw: 0.5 },
          },
        },
      ],
      finalTransform: {
        id: 0,
        position: [0.5, 0, -0.5],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        variations: [{ type: "bubble", weight: 0.8 }],
      },
    };
    const once = encodeScene(s);
    const twice = encodeScene(decodeScene(once)!);
    expect(twice).toBe(once);
  });
});

// ---------------------------------------------------------------------------
// Rejection of malformed input
// ---------------------------------------------------------------------------

describe("decodeScene rejects malformed input", () => {
  it("returns null for an empty string", () => {
    expect(decodeScene("")).toBeNull();
  });

  it("returns null for a non-v1 version prefix", () => {
    expect(decodeScene("v2=abc")).toBeNull();
  });

  it("returns null for a bare payload with no version prefix", () => {
    expect(decodeScene(b64url(JSON.stringify(baseSnapshot())))).toBeNull();
  });

  it("returns null for non-base64 garbage after the version prefix", () => {
    expect(decodeScene("v1=!!!")).toBeNull();
  });

  it("returns null for valid base64 that decodes to non-JSON", () => {
    expect(decodeScene("v1=" + b64url("not json at all"))).toBeNull();
  });

  it("returns null for JSON with 0 transforms", () => {
    const raw = { ...baseSnapshot(), transforms: [] };
    expect(decodeScene("v1=" + b64url(JSON.stringify(raw)))).toBeNull();
  });

  it("returns null when a transform position is not length-3", () => {
    const raw = {
      ...baseSnapshot(),
      transforms: [
        { position: [0, 0], rotation: [0, 0, 0], scale: [0.5, 0.5, 0.5] },
      ],
    };
    expect(decodeScene("v1=" + b64url(JSON.stringify(raw)))).toBeNull();
  });

  it("returns null for an unknown colorMode", () => {
    const raw = { ...baseSnapshot(), colorMode: "rainbow" };
    expect(decodeScene("v1=" + b64url(JSON.stringify(raw)))).toBeNull();
  });

  it("returns null for an unknown renderStyle", () => {
    const raw = { ...baseSnapshot(), renderStyle: "plasma" };
    expect(decodeScene("v1=" + b64url(JSON.stringify(raw)))).toBeNull();
  });

  it("returns null for more than the maximum number of transforms", () => {
    const tooMany = Array.from({ length: MAX_TRANSFORMS + 1 }, () => ({
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [0.5, 0.5, 0.5],
    }));
    const raw = { ...baseSnapshot(), transforms: tooMany };
    expect(decodeScene("v1=" + b64url(JSON.stringify(raw)))).toBeNull();
  });

  it("returns null when transforms is not an array", () => {
    const raw = { ...baseSnapshot(), transforms: "nope" };
    expect(decodeScene("v1=" + b64url(JSON.stringify(raw)))).toBeNull();
  });

  it("returns null when a transform entry is not an object", () => {
    const raw = { ...baseSnapshot(), transforms: [42] };
    expect(decodeScene("v1=" + b64url(JSON.stringify(raw)))).toBeNull();
  });

  it("returns null for a non-finite numPoints", () => {
    const raw = { ...baseSnapshot(), numPoints: "lots" };
    expect(decodeScene("v1=" + b64url(JSON.stringify(raw)))).toBeNull();
  });

  it("returns null for a non-finite pointSize", () => {
    const raw = { ...baseSnapshot(), pointSize: "big" };
    expect(decodeScene("v1=" + b64url(JSON.stringify(raw)))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Per-transform weight (optional field)
// ---------------------------------------------------------------------------

describe("decodeScene transform weight", () => {
  it("round-trips a non-default weight", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      transforms: [
        {
          id: 0,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          weight: 0.85,
        },
      ],
    };
    const result = decodeScene(encodeScene(s));
    expect(result!.transforms[0].weight).toBeCloseTo(0.85, 4);
  });

  it("leaves weight undefined for an old link that never carried the field", () => {
    // baseSnapshot() has no weight — exactly an old v1 payload.
    const result = decodeScene(encodeScene(baseSnapshot()));
    expect(result!.transforms[0].weight).toBeUndefined();
  });

  it("does not persist a weight of 1, decoding it back as undefined", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      transforms: [
        {
          id: 0,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          weight: 1,
        },
      ],
    };
    expect(decodeScene(encodeScene(s))!.transforms[0].weight).toBeUndefined();
  });

  it("returns null for a non-finite weight", () => {
    const raw = {
      ...baseSnapshot(),
      transforms: [
        {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          weight: "heavy",
        },
      ],
    };
    expect(decodeScene("v1=" + b64url(JSON.stringify(raw)))).toBeNull();
  });

  it("clamps a non-positive weight up to a positive value", () => {
    const raw = {
      ...baseSnapshot(),
      transforms: [
        {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          weight: -3,
        },
      ],
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.transforms[0].weight).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Per-transform shear (optional field)
// ---------------------------------------------------------------------------

describe("decodeScene transform shear", () => {
  it("round-trips a shear vector", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      transforms: [
        {
          id: 0,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          shear: [0.2, -0.1, 0.3],
        },
      ],
    };
    const result = decodeScene(encodeScene(s));
    expect(result!.transforms[0].shear).toEqual([0.2, -0.1, 0.3]);
  });

  it("does not persist a zero shear, decoding it back as undefined", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      transforms: [
        {
          id: 0,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          shear: [0, 0, 0],
        },
      ],
    };
    expect(decodeScene(encodeScene(s))!.transforms[0].shear).toBeUndefined();
  });

  it("leaves shear undefined for an old link that never carried the field", () => {
    expect(
      decodeScene(encodeScene(baseSnapshot()))!.transforms[0].shear,
    ).toBeUndefined();
  });

  it("returns null for a malformed shear (not a Vec3)", () => {
    const raw = {
      ...baseSnapshot(),
      transforms: [
        {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          shear: [1, 2],
        },
      ],
    };
    expect(decodeScene("v1=" + b64url(JSON.stringify(raw)))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Per-transform variations (optional field)
// ---------------------------------------------------------------------------

describe("decodeScene transform variations", () => {
  it("round-trips a variation blend", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      transforms: [
        {
          id: 0,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          variations: [
            { type: "spherical", weight: 1 },
            { type: "swirl", weight: 0.4 },
          ],
        },
      ],
    };
    const result = decodeScene(encodeScene(s));
    expect(result!.transforms[0].variations).toEqual([
      { type: "spherical", weight: 1 },
      { type: "swirl", weight: 0.4 },
    ]);
  });

  it("does not persist a zero-weight variation, dropping it on decode", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      transforms: [
        {
          id: 0,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          variations: [
            { type: "spherical", weight: 1 },
            { type: "swirl", weight: 0 },
          ],
        },
      ],
    };
    expect(decodeScene(encodeScene(s))!.transforms[0].variations).toEqual([
      { type: "spherical", weight: 1 },
    ]);
  });

  it("omits an all-zero blend entirely, decoding back as undefined", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      transforms: [
        {
          id: 0,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          variations: [{ type: "spherical", weight: 0 }],
        },
      ],
    };
    expect(
      decodeScene(encodeScene(s))!.transforms[0].variations,
    ).toBeUndefined();
  });

  it("leaves variations undefined for an old link that never carried the field", () => {
    expect(
      decodeScene(encodeScene(baseSnapshot()))!.transforms[0].variations,
    ).toBeUndefined();
  });

  it("returns null for an unknown variation type", () => {
    const raw = {
      ...baseSnapshot(),
      transforms: [
        {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          variations: [{ type: "wormhole", weight: 1 }],
        },
      ],
    };
    expect(decodeScene("v1=" + b64url(JSON.stringify(raw)))).toBeNull();
  });

  it("returns null for a non-finite variation weight", () => {
    const raw = {
      ...baseSnapshot(),
      transforms: [
        {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          variations: [{ type: "spherical", weight: "lots" }],
        },
      ],
    };
    expect(decodeScene("v1=" + b64url(JSON.stringify(raw)))).toBeNull();
  });

  it("returns null when variations is not an array", () => {
    const raw = {
      ...baseSnapshot(),
      transforms: [
        {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          variations: "spherical",
        },
      ],
    };
    expect(decodeScene("v1=" + b64url(JSON.stringify(raw)))).toBeNull();
  });

  it("returns null when a variation entry is not an object", () => {
    const raw = {
      ...baseSnapshot(),
      transforms: [
        {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          variations: [42],
        },
      ],
    };
    expect(decodeScene("v1=" + b64url(JSON.stringify(raw)))).toBeNull();
  });

  it("clamps an out-of-range variation weight into the allowed band", () => {
    const raw = {
      ...baseSnapshot(),
      transforms: [
        {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          variations: [{ type: "spherical", weight: 100000 }],
        },
      ],
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    const weight = result!.transforms[0].variations![0].weight;
    expect(weight).toBeGreaterThan(0);
    expect(weight).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// Final transform (optional field)
// ---------------------------------------------------------------------------

describe("decodeScene final transform", () => {
  it("round-trips a final transform with its own variation lens", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      finalTransform: {
        id: 0,
        position: [0.5, 0, -0.5],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        variations: [{ type: "spherical", weight: 1 }],
      },
    };
    const result = decodeScene(encodeScene(s));
    expect(result!.finalTransform).toEqual({
      id: 0,
      position: [0.5, 0, -0.5],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      variations: [{ type: "spherical", weight: 1 }],
    });
  });

  it("persists an enabled but unedited (identity) lens so it survives a reload", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      finalTransform: {
        id: 0,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
    };
    expect(decodeScene(encodeScene(s))!.finalTransform).toEqual({
      id: 0,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    });
  });

  it("leaves finalTransform undefined for a link that never carried one", () => {
    expect(
      decodeScene(encodeScene(baseSnapshot()))!.finalTransform,
    ).toBeUndefined();
  });

  it("returns null for a malformed final transform", () => {
    const raw = {
      ...baseSnapshot(),
      finalTransform: {
        position: [0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
    };
    expect(decodeScene("v1=" + b64url(JSON.stringify(raw)))).toBeNull();
  });

  it("returns null for a final transform carrying an unknown variation", () => {
    const raw = {
      ...baseSnapshot(),
      finalTransform: {
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        variations: [{ type: "wormhole", weight: 1 }],
      },
    };
    expect(decodeScene("v1=" + b64url(JSON.stringify(raw)))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Per-transform w (optional 4D extension, fr-bf6.1 — see fractal/types.ts's
// WExtension). Follows the weight/shear/variations discipline: absent stays
// quietly flat, present-but-malformed rejects the whole scene, finite values
// clamp into range, and an all-identity block is canonicalized away on encode
// (isFlatTransform-driven) so a flat system's bytes never change.
// ---------------------------------------------------------------------------

describe("decodeScene transform w (4D extension)", () => {
  it("round-trips all four w field kinds losslessly, including sparse absence", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      transforms: [
        {
          id: 0,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          w: { position: 0.3 },
        },
        {
          id: 1,
          position: [1, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          w: { rotation: { zw: -0.75 } },
        },
        {
          id: 2,
          position: [0, 1, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          w: { scale: 1.25, shear: { xw: 0.6 } },
        },
        {
          id: 3,
          position: [0, 0, 1],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
        },
      ],
    };
    const result = decodeScene(encodeScene(s));

    expect(result!.transforms[0].w).toStrictEqual({ position: 0.3 });
    expect(result!.transforms[1].w).toStrictEqual({
      rotation: { zw: -0.75 },
    });
    expect(result!.transforms[2].w).toStrictEqual({
      scale: 1.25,
      shear: { xw: 0.6 },
    });
    expect(result!.transforms[3]).not.toHaveProperty("w");
  });

  it("decodes a pre-4D payload (no w on any transform) with no w key at all", () => {
    // baseSnapshot() has no `w` on its transform — exactly today's wire
    // format, predating this feature entirely.
    const result = decodeScene(encodeScene(baseSnapshot()));
    expect(result!.transforms[0]).not.toHaveProperty("w");
  });

  it("returns null when w is present but not an object", () => {
    const raw = {
      ...baseSnapshot(),
      transforms: [
        {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          w: 5,
        },
      ],
    };
    expect(decodeScene("v1=" + b64url(JSON.stringify(raw)))).toBeNull();
  });

  it("returns null when w is present but null", () => {
    const raw = {
      ...baseSnapshot(),
      transforms: [
        {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          w: null,
        },
      ],
    };
    expect(decodeScene("v1=" + b64url(JSON.stringify(raw)))).toBeNull();
  });

  it("returns null when w.rotation is present but not an object", () => {
    const raw = {
      ...baseSnapshot(),
      transforms: [
        {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          w: { rotation: 3 },
        },
      ],
    };
    expect(decodeScene("v1=" + b64url(JSON.stringify(raw)))).toBeNull();
  });

  it("returns null when w.position is present but non-numeric (Number → NaN)", () => {
    const raw = {
      ...baseSnapshot(),
      transforms: [
        {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          w: { position: "abc" },
        },
      ],
    };
    expect(decodeScene("v1=" + b64url(JSON.stringify(raw)))).toBeNull();
  });

  it("returns null when w.scale is present but null", () => {
    const raw = {
      ...baseSnapshot(),
      transforms: [
        {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          w: { scale: null },
        },
      ],
    };
    expect(decodeScene("v1=" + b64url(JSON.stringify(raw)))).toBeNull();
  });

  it("clamps an out-of-range w.position above the maximum down to the max", () => {
    const raw = {
      ...baseSnapshot(),
      transforms: [
        {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          w: { position: 99 },
        },
      ],
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result!.transforms[0].w).toStrictEqual({
      position: MAX_W_POSITION,
    });
  });

  it("clamps an out-of-range w.position below the minimum up to the min", () => {
    const raw = {
      ...baseSnapshot(),
      transforms: [
        {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          w: { position: -99 },
        },
      ],
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result!.transforms[0].w).toStrictEqual({
      position: MIN_W_POSITION,
    });
  });

  it("clamps an out-of-range w.scale above the maximum down to the max", () => {
    const raw = {
      ...baseSnapshot(),
      transforms: [
        {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          w: { scale: 9 },
        },
      ],
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result!.transforms[0].w).toStrictEqual({ scale: MAX_W_SCALE });
  });

  it("clamps an out-of-range w.scale below the minimum up to the min", () => {
    const raw = {
      ...baseSnapshot(),
      transforms: [
        {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          w: { scale: 0.001 },
        },
      ],
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result!.transforms[0].w).toStrictEqual({ scale: MIN_W_SCALE });
  });

  it("clamps an out-of-range w.rotation.zw down to the max angle", () => {
    const raw = {
      ...baseSnapshot(),
      transforms: [
        {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          w: { rotation: { zw: 7 } },
        },
      ],
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result!.transforms[0].w).toStrictEqual({
      rotation: { zw: MAX_W_ANGLE },
    });
  });

  it("clamps an out-of-range w.shear.xw down to the max shear", () => {
    const raw = {
      ...baseSnapshot(),
      transforms: [
        {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          w: { shear: { xw: 5 } },
        },
      ],
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result!.transforms[0].w).toStrictEqual({
      shear: { xw: MAX_W_SHEAR },
    });
  });

  it("encodes an all-identity w block exactly like no w block at all (byte-identical)", () => {
    const flat = baseSnapshot();
    const withIdentityW: SceneSnapshot = {
      ...baseSnapshot(),
      transforms: [
        {
          ...baseSnapshot().transforms[0],
          w: { position: 0, rotation: {} },
        },
      ],
    };
    expect(encodeScene(withIdentityW)).toBe(encodeScene(flat));
  });

  it("round-trips a final transform carrying a w block (4D lens support comes free)", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      finalTransform: {
        id: 0,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        w: { position: 0.3, shear: { yw: -0.75 } },
      },
    };
    const result = decodeScene(encodeScene(s));
    expect(result!.finalTransform!.w).toStrictEqual({
      position: 0.3,
      shear: { yw: -0.75 },
    });
  });
});

// ---------------------------------------------------------------------------
// Flame render params (added after v1 shipped — same "absent defaults
// quietly, malformed rejects" contract as finalTransform/weight/shear)
// ---------------------------------------------------------------------------

describe("decodeScene flame params", () => {
  it("round-trips a non-default exposure and iteration budget", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      flame: {
        ...baseSnapshot().flame,
        exposure: 2.25,
        iterations: 42_000_000,
      },
    };
    const result = decodeScene(encodeScene(s));
    expect(result!.flame.exposure).toBeCloseTo(2.25, 4);
    expect(result!.flame.iterations).toBe(42_000_000);
  });

  it("defaults quietly for a link encoded before this feature existed", () => {
    // A hand-built payload with no `flame` key at all — exactly what every
    // v1 link looked like before this field was added.
    const raw = {
      transforms: baseSnapshot().transforms,
      numPoints: 100_000,
      pointSize: 1,
      colorMode: "transform",
      renderStyle: "depthFade",
      showGuides: true,
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.flame).toEqual({
      exposure: DEFAULT_FLAME_EXPOSURE,
      iterations: DEFAULT_FLAME_ITERATIONS,
      gamma: DEFAULT_FLAME_GAMMA,
      vibrancy: DEFAULT_FLAME_VIBRANCY,
      supersample: DEFAULT_FLAME_SUPERSAMPLE,
      estimatorRadius: DEFAULT_ESTIMATOR_RADIUS,
      estimatorMinimumRadius: DEFAULT_ESTIMATOR_MINIMUM_RADIUS,
      estimatorCurve: DEFAULT_ESTIMATOR_CURVE,
      // Deliberately "legacy", NOT DEFAULT_FLAME_PALETTE (a gradient since
      // fr-9mw): a pre-palette link must render as it did when written.
      paletteId: "legacy",
    });
  });

  it("returns null when flame is present but not an object", () => {
    const raw = { ...baseSnapshot(), flame: "bright" };
    expect(decodeScene("v1=" + b64url(JSON.stringify(raw)))).toBeNull();
  });

  it("returns null when flame is present but exposure is non-finite", () => {
    const raw = {
      ...baseSnapshot(),
      flame: { exposure: "lots", iterations: 20_000_000 },
    };
    expect(decodeScene("v1=" + b64url(JSON.stringify(raw)))).toBeNull();
  });

  it("returns null when flame is present but iterations is non-finite", () => {
    const raw = {
      ...baseSnapshot(),
      flame: { exposure: 1, iterations: "lots" },
    };
    expect(decodeScene("v1=" + b64url(JSON.stringify(raw)))).toBeNull();
  });

  it("clamps an out-of-range exposure into the allowed band", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      flame: {
        ...baseSnapshot().flame,
        exposure: 999,
        iterations: DEFAULT_FLAME_ITERATIONS,
      },
    };
    expect(decodeScene(encodeScene(s))!.flame.exposure).toBe(
      MAX_FLAME_EXPOSURE,
    );
  });

  it("clamps an out-of-range iteration budget into the allowed band", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      flame: { ...baseSnapshot().flame, exposure: 1, iterations: 1 },
    };
    expect(decodeScene(encodeScene(s))!.flame.iterations).toBe(
      MIN_FLAME_ITERATIONS,
    );
  });

  it("never rejects the scene for an exposure at the extreme but finite ends", () => {
    const raw = {
      ...baseSnapshot(),
      flame: { exposure: -1e9, iterations: 1e12 },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.flame.exposure).toBe(MIN_FLAME_EXPOSURE);
    expect(result!.flame.iterations).toBe(MAX_FLAME_ITERATIONS);
  });

  it("round-trips a non-default gamma, vibrancy, and supersample", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      flame: {
        ...baseSnapshot().flame,
        gamma: 3.5,
        vibrancy: 0.6,
        supersample: 3,
      },
    };
    const result = decodeScene(encodeScene(s));
    expect(result!.flame.gamma).toBeCloseTo(3.5, 4);
    expect(result!.flame.vibrancy).toBeCloseTo(0.6, 4);
    expect(result!.flame.supersample).toBe(3);
  });

  it("defaults gamma/vibrancy/supersample quietly for a link encoded before fr-ucs existed", () => {
    // A hand-built flame block carrying only the fr-o7s-era fields.
    const raw = {
      ...baseSnapshot(),
      flame: { exposure: 1.5, iterations: 30_000_000 },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.flame.exposure).toBeCloseTo(1.5, 4);
    expect(result!.flame.iterations).toBe(30_000_000);
    expect(result!.flame.gamma).toBe(DEFAULT_FLAME_GAMMA);
    expect(result!.flame.vibrancy).toBe(DEFAULT_FLAME_VIBRANCY);
    expect(result!.flame.supersample).toBe(DEFAULT_FLAME_SUPERSAMPLE);
  });

  it("returns null when gamma is present but non-finite", () => {
    const raw = {
      ...baseSnapshot(),
      flame: { ...baseSnapshot().flame, gamma: "bright" },
    };
    expect(decodeScene("v1=" + b64url(JSON.stringify(raw)))).toBeNull();
  });

  it("returns null when vibrancy is present but non-finite", () => {
    const raw = {
      ...baseSnapshot(),
      flame: { ...baseSnapshot().flame, vibrancy: "lots" },
    };
    expect(decodeScene("v1=" + b64url(JSON.stringify(raw)))).toBeNull();
  });

  it("returns null when supersample is present but non-finite", () => {
    const raw = {
      ...baseSnapshot(),
      flame: { ...baseSnapshot().flame, supersample: "big" },
    };
    expect(decodeScene("v1=" + b64url(JSON.stringify(raw)))).toBeNull();
  });

  it("clamps an out-of-range gamma and vibrancy into their allowed bands", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      flame: { ...baseSnapshot().flame, gamma: 999, vibrancy: -5 },
    };
    const result = decodeScene(encodeScene(s));
    expect(result!.flame.gamma).toBe(MAX_FLAME_GAMMA);
    expect(result!.flame.vibrancy).toBe(MIN_FLAME_VIBRANCY);
  });

  it("clamps an out-of-range supersample into its allowed band", () => {
    const raw = {
      ...baseSnapshot(),
      flame: { ...baseSnapshot().flame, supersample: 99 },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result!.flame.supersample).toBe(MAX_FLAME_SUPERSAMPLE);
  });

  it("rounds a fractional supersample to the nearest integer", () => {
    const raw = {
      ...baseSnapshot(),
      flame: { ...baseSnapshot().flame, supersample: 2.6 },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result!.flame.supersample).toBe(3);
  });

  it("round-trips non-default estimator params", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      flame: {
        ...baseSnapshot().flame,
        estimatorRadius: 9,
        estimatorMinimumRadius: 1.5,
        estimatorCurve: 1.2,
      },
    };
    const result = decodeScene(encodeScene(s));
    expect(result!.flame.estimatorRadius).toBeCloseTo(9, 4);
    expect(result!.flame.estimatorMinimumRadius).toBeCloseTo(1.5, 4);
    expect(result!.flame.estimatorCurve).toBeCloseTo(1.2, 4);
  });

  it("defaults estimator params quietly for a link encoded before fr-17t existed", () => {
    // A hand-built flame block carrying only pre-fr-17t fields.
    const raw = {
      ...baseSnapshot(),
      flame: {
        exposure: 1.5,
        iterations: 30_000_000,
        gamma: 3,
        vibrancy: 0.5,
        supersample: 2,
      },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.flame.estimatorRadius).toBe(DEFAULT_ESTIMATOR_RADIUS);
    expect(result!.flame.estimatorMinimumRadius).toBe(
      DEFAULT_ESTIMATOR_MINIMUM_RADIUS,
    );
    expect(result!.flame.estimatorCurve).toBe(DEFAULT_ESTIMATOR_CURVE);
  });

  it("returns null when estimatorRadius is present but non-finite", () => {
    const raw = {
      ...baseSnapshot(),
      flame: { ...baseSnapshot().flame, estimatorRadius: "wide" },
    };
    expect(decodeScene("v1=" + b64url(JSON.stringify(raw)))).toBeNull();
  });

  it("returns null when estimatorMinimumRadius is present but non-finite", () => {
    const raw = {
      ...baseSnapshot(),
      flame: { ...baseSnapshot().flame, estimatorMinimumRadius: "sharp" },
    };
    expect(decodeScene("v1=" + b64url(JSON.stringify(raw)))).toBeNull();
  });

  it("returns null when estimatorCurve is present but non-finite", () => {
    const raw = {
      ...baseSnapshot(),
      flame: { ...baseSnapshot().flame, estimatorCurve: "steep" },
    };
    expect(decodeScene("v1=" + b64url(JSON.stringify(raw)))).toBeNull();
  });

  it("clamps out-of-range estimator params into their allowed bands", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      flame: {
        ...baseSnapshot().flame,
        estimatorRadius: 999,
        estimatorMinimumRadius: -5,
        estimatorCurve: 999,
      },
    };
    const result = decodeScene(encodeScene(s));
    expect(result!.flame.estimatorRadius).toBe(MAX_ESTIMATOR_RADIUS);
    expect(result!.flame.estimatorMinimumRadius).toBe(
      MIN_ESTIMATOR_MINIMUM_RADIUS,
    );
    expect(result!.flame.estimatorCurve).toBe(MAX_ESTIMATOR_CURVE);
  });

  it("round-trips a non-default paletteId", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      flame: { ...baseSnapshot().flame, paletteId: "spectrum" },
    };
    expect(decodeScene(encodeScene(s))!.flame.paletteId).toBe("spectrum");
  });

  it("falls back to legacy for an unknown paletteId instead of rejecting the scene", () => {
    // Unlike every other flame field, an unknown palette does NOT nuke the
    // whole scene — a link from a future build carrying a palette this build
    // doesn't know still restores, just with the default coloring.
    const raw = {
      ...baseSnapshot(),
      flame: { ...baseSnapshot().flame, paletteId: "chartreuse" },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.flame.paletteId).toBe("legacy");
  });

  it("defaults paletteId to legacy for a link encoded before fr-6us existed", () => {
    // A flame block carrying every field except paletteId.
    const raw = {
      ...baseSnapshot(),
      flame: {
        exposure: 1.5,
        iterations: 30_000_000,
        gamma: 3,
        vibrancy: 0.5,
        supersample: 2,
      },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.flame.paletteId).toBe("legacy");
  });
});

// ---------------------------------------------------------------------------
// Solid render params (fr-v4f — same "absent defaults quietly, malformed
// rejects" contract as the flame block above)
// ---------------------------------------------------------------------------

describe("decodeScene solid params", () => {
  it("round-trips a fully customized solid block", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      solid: {
        resolution: 224,
        iterations: 42_000_000,
        threshold: 0.6,
        lightAzimuth: -45,
        lightElevation: 70,
        ambient: 0.5,
        paletteId: "spectrum",
      },
    };
    const result = decodeScene(encodeScene(s));
    expect(result!.solid).toEqual({
      resolution: 224,
      iterations: 42_000_000,
      threshold: 0.6,
      lightAzimuth: -45,
      lightElevation: 70,
      ambient: 0.5,
      paletteId: "spectrum",
    });
  });

  it("defaults quietly for a link encoded before this feature existed", () => {
    // A hand-built payload with no `solid` key at all — exactly what every
    // link looked like before fr-v4f.
    const raw = {
      transforms: baseSnapshot().transforms,
      numPoints: 100_000,
      pointSize: 1,
      colorMode: "transform",
      renderStyle: "depthFade",
      showGuides: true,
      flame: baseSnapshot().flame,
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.solid).toEqual({
      resolution: DEFAULT_SOLID_RESOLUTION,
      iterations: DEFAULT_SOLID_ITERATIONS,
      threshold: DEFAULT_SOLID_THRESHOLD,
      lightAzimuth: DEFAULT_SOLID_LIGHT_AZIMUTH,
      lightElevation: DEFAULT_SOLID_LIGHT_ELEVATION,
      ambient: DEFAULT_SOLID_AMBIENT,
      // Deliberately "legacy", NOT DEFAULT_SOLID_PALETTE (a gradient since
      // fr-9mw): a pre-palette link must render as it did when written.
      paletteId: "legacy",
    });
  });

  it("returns null when solid is present but not an object", () => {
    const raw = { ...baseSnapshot(), solid: "bright" };
    expect(decodeScene("v1=" + b64url(JSON.stringify(raw)))).toBeNull();
  });

  it("returns null when threshold is present but non-finite", () => {
    const raw = {
      ...baseSnapshot(),
      solid: { ...baseSnapshot().solid, threshold: "x" },
    };
    expect(decodeScene("v1=" + b64url(JSON.stringify(raw)))).toBeNull();
  });

  it("returns null when iterations is present but non-finite", () => {
    const raw = {
      ...baseSnapshot(),
      solid: { ...baseSnapshot().solid, iterations: "lots" },
    };
    expect(decodeScene("v1=" + b64url(JSON.stringify(raw)))).toBeNull();
  });

  it("clamps an out-of-range threshold and ambient into their allowed bands", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      solid: { ...baseSnapshot().solid, threshold: 999, ambient: -5 },
    };
    const result = decodeScene(encodeScene(s));
    expect(result!.solid.threshold).toBe(MAX_SOLID_THRESHOLD);
    expect(result!.solid.ambient).toBe(MIN_SOLID_AMBIENT);
  });

  it("clamps an out-of-range iteration budget into the allowed band", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      solid: { ...baseSnapshot().solid, iterations: 1 },
    };
    expect(decodeScene(encodeScene(s))!.solid.iterations).toBe(
      MIN_SOLID_ITERATIONS,
    );
  });

  it("snaps an off-step resolution to the nearest multiple of the voxel step", () => {
    const raw = {
      ...baseSnapshot(),
      solid: { ...baseSnapshot().solid, resolution: 100 },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result!.solid.resolution % VOXEL_RESOLUTION_STEP).toBe(0);
    expect(result!.solid.resolution).toBe(96);
  });

  it("clamps resolution above the maximum down to the max", () => {
    const raw = {
      ...baseSnapshot(),
      solid: { ...baseSnapshot().solid, resolution: 9999 },
    };
    expect(
      decodeScene("v1=" + b64url(JSON.stringify(raw)))!.solid.resolution,
    ).toBe(MAX_SOLID_RESOLUTION);
  });

  it("round-trips the raised 512 resolution ceiling (fr-8x7)", () => {
    // Before fr-8x7 raised MAX_SOLID_RESOLUTION from 256 to 512, this value
    // would have been clamped down to 256 on decode.
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      solid: { ...baseSnapshot().solid, resolution: 512 },
    };
    expect(decodeScene(encodeScene(s))!.solid.resolution).toBe(512);
  });

  it("clamps resolution below the minimum up to the min", () => {
    const raw = {
      ...baseSnapshot(),
      solid: { ...baseSnapshot().solid, resolution: 1 },
    };
    expect(
      decodeScene("v1=" + b64url(JSON.stringify(raw)))!.solid.resolution,
    ).toBe(MIN_SOLID_RESOLUTION);
  });

  it("round-trips a non-default paletteId", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      solid: { ...baseSnapshot().solid, paletteId: "spectrum" },
    };
    expect(decodeScene(encodeScene(s))!.solid.paletteId).toBe("spectrum");
  });

  it("falls back to legacy for an unknown paletteId instead of rejecting the scene", () => {
    // Unlike every other solid field, an unknown palette does NOT nuke the
    // whole scene — mirrors flame.paletteId's fallback-to-legacy behavior.
    const raw = {
      ...baseSnapshot(),
      solid: { ...baseSnapshot().solid, paletteId: "chartreuse" },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.solid.paletteId).toBe("legacy");
  });

  it("defaults paletteId to legacy for a link encoded before fr-1kt existed", () => {
    // A solid block carrying every field except paletteId.
    const raw = {
      ...baseSnapshot(),
      solid: {
        resolution: 192,
        iterations: 30_000_000,
        threshold: 0.4,
        lightAzimuth: 100,
        lightElevation: 60,
        ambient: 0.3,
      },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.solid.paletteId).toBe("legacy");
  });
});

// ---------------------------------------------------------------------------
// Custom palette (fr-55k) — the one user-authored gradient slot. Absent,
// malformed, or an out-of-range stop count all quietly decode to `undefined`
// rather than rejecting the scene; flame.paletteId / solid.paletteId accept
// "custom" only when a valid payload decoded alongside it (see
// decodeCustomPalette).
// ---------------------------------------------------------------------------

describe("decodeScene customPalette", () => {
  it("round-trips custom palette stops and a custom flame paletteId selection", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      flame: { ...baseSnapshot().flame, paletteId: "custom" },
      customPalette: {
        stops: [
          [0.2, 0.4, 0.6],
          [0.8, 0.4, 0.2],
        ],
      },
    };
    const result = decodeScene(encodeScene(s));
    expect(result!.customPalette).toEqual({
      stops: [
        [0.2, 0.4, 0.6],
        [0.8, 0.4, 0.2],
      ],
    });
    expect(result!.flame.paletteId).toBe("custom");
  });

  it("round-trips a custom solid paletteId selection alongside the same payload", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      solid: { ...baseSnapshot().solid, paletteId: "custom" },
      customPalette: {
        stops: [
          [0.2, 0.4, 0.6],
          [0.8, 0.4, 0.2],
        ],
      },
    };
    const result = decodeScene(encodeScene(s));
    expect(result!.customPalette).toEqual({
      stops: [
        [0.2, 0.4, 0.6],
        [0.8, 0.4, 0.2],
      ],
    });
    expect(result!.solid.paletteId).toBe("custom");
  });

  it("omits customPalette from the encoded payload when the snapshot has none", () => {
    const payload = decodePayload(encodeScene(baseSnapshot()));
    expect("customPalette" in payload).toBe(false);
  });

  it("decodes back to an undefined customPalette when the snapshot has none", () => {
    const result = decodeScene(encodeScene(baseSnapshot()));
    expect(result!.customPalette).toBeUndefined();
  });

  it("falls back to legacy for a custom flame paletteId with no customPalette payload", () => {
    const raw = {
      ...baseSnapshot(),
      flame: { ...baseSnapshot().flame, paletteId: "custom" },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.flame.paletteId).toBe("legacy");
    expect(result!.customPalette).toBeUndefined();
  });

  it("falls back to legacy for a custom solid paletteId with no customPalette payload", () => {
    const raw = {
      ...baseSnapshot(),
      solid: { ...baseSnapshot().solid, paletteId: "custom" },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.solid.paletteId).toBe("legacy");
    expect(result!.customPalette).toBeUndefined();
  });

  it("drops the payload and demotes a custom paletteId when stops is not an array", () => {
    const raw = {
      ...baseSnapshot(),
      flame: { ...baseSnapshot().flame, paletteId: "custom" },
      customPalette: { stops: "not-an-array" },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.customPalette).toBeUndefined();
    expect(result!.flame.paletteId).toBe("legacy");
    // The rest of the scene survives — this is a quiet fallback, not a
    // whole-scene rejection.
    expect(result!.transforms).toHaveLength(1);
  });

  it("drops the payload and demotes a custom paletteId when there are too few stops", () => {
    const tooFew = Array.from(
      { length: MIN_CUSTOM_PALETTE_STOPS - 1 },
      () => "#ff0000",
    );
    const raw = {
      ...baseSnapshot(),
      flame: { ...baseSnapshot().flame, paletteId: "custom" },
      customPalette: { stops: tooFew },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.customPalette).toBeUndefined();
    expect(result!.flame.paletteId).toBe("legacy");
  });

  it("drops the payload and demotes a custom paletteId when there are too many stops", () => {
    const tooMany = Array.from(
      { length: MAX_CUSTOM_PALETTE_STOPS + 1 },
      () => "#ff0000",
    );
    const raw = {
      ...baseSnapshot(),
      flame: { ...baseSnapshot().flame, paletteId: "custom" },
      customPalette: { stops: tooMany },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.customPalette).toBeUndefined();
    expect(result!.flame.paletteId).toBe("legacy");
  });

  it("drops the payload when a stop entry is a short hex shorthand", () => {
    const raw = {
      ...baseSnapshot(),
      flame: { ...baseSnapshot().flame, paletteId: "custom" },
      customPalette: { stops: ["#ff00", "#00ff00"] },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.customPalette).toBeUndefined();
    expect(result!.flame.paletteId).toBe("legacy");
  });

  it("drops the payload when a stop entry is not a string", () => {
    const raw = {
      ...baseSnapshot(),
      flame: { ...baseSnapshot().flame, paletteId: "custom" },
      customPalette: { stops: [123, "#00ff00"] },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.customPalette).toBeUndefined();
    expect(result!.flame.paletteId).toBe("legacy");
  });

  it("drops the payload when it is not a plain object", () => {
    const raw = { ...baseSnapshot(), customPalette: "gradient" };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.customPalette).toBeUndefined();
  });

  it("drops a null customPalette payload", () => {
    const raw = { ...baseSnapshot(), customPalette: null };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.customPalette).toBeUndefined();
  });

  it("accepts uppercase hex digits in stop entries", () => {
    const raw = {
      ...baseSnapshot(),
      flame: { ...baseSnapshot().flame, paletteId: "custom" },
      customPalette: { stops: ["#FF0000", "#00FF00"] },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.customPalette).toEqual({
      stops: [
        [1, 0, 0],
        [0, 1, 0],
      ],
    });
    expect(result!.flame.paletteId).toBe("custom");
  });
});

// ---------------------------------------------------------------------------
// Ramp palette (fr-3b6) — the height/radius color-mode ramps' gradient
// selection. A top-level sibling of colorGamma, not nested under flame/solid,
// but sharing their exact quiet-fallback contract and the one customPalette
// slot (see decodeFlameParams / decodeCustomPalette).
// ---------------------------------------------------------------------------

describe("decodeScene rampPaletteId", () => {
  it("round-trips a non-default rampPaletteId", () => {
    const s: SceneSnapshot = { ...baseSnapshot(), rampPaletteId: "ember" };
    expect(decodeScene(encodeScene(s))!.rampPaletteId).toBe("ember");
  });

  it("defaults quietly to legacy for a link encoded before this feature existed", () => {
    // A hand-built payload with no `rampPaletteId` key at all — exactly what
    // every link looked like before fr-3b6.
    const raw = {
      transforms: baseSnapshot().transforms,
      numPoints: 100_000,
      pointSize: 1,
      colorMode: "transform",
      colorGamma: DEFAULT_COLOR_GAMMA,
      fourDColor: "wBlueOrange",
      fourDDepthFade: false,
      renderStyle: "depthFade",
      showGuides: true,
      flame: baseSnapshot().flame,
      solid: baseSnapshot().solid,
      symmetry: baseSnapshot().symmetry,
      glowBrightness: baseSnapshot().glowBrightness,
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.rampPaletteId).toBe("legacy");
  });

  it("falls back to legacy for an unknown rampPaletteId instead of rejecting the scene", () => {
    // Unlike every other top-level field, an unknown ramp palette does NOT
    // nuke the whole scene — mirrors flame.paletteId's fallback behavior.
    const raw = { ...baseSnapshot(), rampPaletteId: "chartreuse" };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.rampPaletteId).toBe("legacy");
  });

  it("falls back to legacy for a custom rampPaletteId with no customPalette payload", () => {
    const raw = { ...baseSnapshot(), rampPaletteId: "custom" };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.rampPaletteId).toBe("legacy");
    expect(result!.customPalette).toBeUndefined();
  });

  it("round-trips a custom rampPaletteId selection alongside its customPalette payload", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      rampPaletteId: "custom",
      customPalette: {
        stops: [
          [0.2, 0.4, 0.6],
          [0.8, 0.4, 0.2],
        ],
      },
    };
    const result = decodeScene(encodeScene(s));
    expect(result!.customPalette).toEqual({
      stops: [
        [0.2, 0.4, 0.6],
        [0.8, 0.4, 0.2],
      ],
    });
    expect(result!.rampPaletteId).toBe("custom");
  });
});

// ---------------------------------------------------------------------------
// toSnapshot / fromSnapshot (fr-55k) — customPalette carry/clear. These two
// projection functions had no direct tests before this field; the second
// test pins the spread-overwrite behavior undo (edit-session.ts) relies on.
// ---------------------------------------------------------------------------

describe("toSnapshot / fromSnapshot customPalette", () => {
  it("toSnapshot carries the customPalette slot", () => {
    const state: AppState = {
      ...initialState(true),
      customPalette: {
        stops: [
          [0.2, 0.4, 0.6],
          [0.8, 0.4, 0.2],
        ],
      },
    };
    expect(toSnapshot(state).customPalette).toEqual({
      stops: [
        [0.2, 0.4, 0.6],
        [0.8, 0.4, 0.2],
      ],
    });
  });

  it("fromSnapshot clears a base state's customPalette when the snapshot carries none", () => {
    const base: AppState = {
      ...initialState(true),
      customPalette: {
        stops: [
          [0.2, 0.4, 0.6],
          [0.8, 0.4, 0.2],
        ],
      },
    };
    // toSnapshot always emits the `customPalette` key (possibly undefined) —
    // unlike an object that never mentions the field at all, this is what
    // makes the spread in fromSnapshot actually overwrite base's slot rather
    // than leave it untouched.
    const snapshot = toSnapshot(initialState(true));
    expect(fromSnapshot(snapshot, base).customPalette).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Symmetry params (fr-6im) — deliberately MORE lenient than flame/solid: a
// malformed field never rejects the scene, it just falls back to a default.
// ---------------------------------------------------------------------------

describe("decodeScene symmetry", () => {
  it("round-trips a non-default order and axis", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      symmetry: { order: 6, axis: "z" },
    };
    const result = decodeScene(encodeScene(s));
    expect(result!.symmetry).toEqual({ order: 6, axis: "z" });
  });

  it("defaults quietly for a link encoded before this feature existed", () => {
    // A hand-built payload with no `symmetry` key at all — exactly what
    // every link looked like before fr-6im.
    const raw = {
      transforms: baseSnapshot().transforms,
      numPoints: 100_000,
      pointSize: 1,
      colorMode: "transform",
      renderStyle: "depthFade",
      showGuides: true,
      flame: baseSnapshot().flame,
      solid: baseSnapshot().solid,
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.symmetry).toEqual({
      order: DEFAULT_SYMMETRY_ORDER,
      axis: DEFAULT_SYMMETRY_AXIS,
    });
  });

  it("does not reject the scene for a non-finite order, defaulting it instead", () => {
    // Unlike flame/solid's numeric fields, a malformed order is cosmetic
    // geometry, not corruption — the scene survives.
    const raw = {
      ...baseSnapshot(),
      symmetry: { order: "nonsense", axis: "y" },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.symmetry.order).toBe(DEFAULT_SYMMETRY_ORDER);
  });

  it("clamps an out-of-range order above the maximum down to the max", () => {
    const raw = { ...baseSnapshot(), symmetry: { order: 999, axis: "y" } };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result!.symmetry.order).toBe(MAX_SYMMETRY_ORDER);
  });

  it("clamps an out-of-range order below the minimum up to the min", () => {
    const raw = { ...baseSnapshot(), symmetry: { order: -5, axis: "y" } };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result!.symmetry.order).toBe(MIN_SYMMETRY_ORDER);
  });

  it("rounds a fractional order to the nearest integer", () => {
    const raw = { ...baseSnapshot(), symmetry: { order: 4.6, axis: "y" } };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result!.symmetry.order).toBe(5);
  });

  it("falls back to y for an unrecognized axis instead of rejecting the scene", () => {
    // Unlike every other block, an unknown axis does NOT nuke the whole
    // scene — mirrors flame.paletteId's fallback-to-legacy behavior.
    const raw = { ...baseSnapshot(), symmetry: { order: 3, axis: "w" } };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.symmetry.axis).toBe("y");
    expect(result!.transforms).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Glow brightness (fr-8b1) — same lenient, never-rejects contract as
// symmetry above: a malformed value falls back to the default instead of
// nuking the whole scene.
// ---------------------------------------------------------------------------

describe("decodeScene glow brightness", () => {
  it("round-trips a non-default glow brightness", () => {
    const s: SceneSnapshot = { ...baseSnapshot(), glowBrightness: 2.25 };
    const result = decodeScene(encodeScene(s));
    expect(result!.glowBrightness).toBeCloseTo(2.25, 4);
  });

  it("defaults quietly for a link encoded before this feature existed", () => {
    // A hand-built payload with no `glowBrightness` key at all — exactly
    // what every link looked like before fr-8b1.
    const raw = {
      transforms: baseSnapshot().transforms,
      numPoints: 100_000,
      pointSize: 1,
      colorMode: "transform",
      renderStyle: "depthFade",
      showGuides: true,
      flame: baseSnapshot().flame,
      solid: baseSnapshot().solid,
      symmetry: baseSnapshot().symmetry,
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.glowBrightness).toBe(DEFAULT_GLOW_BRIGHTNESS);
  });

  it("does not reject the scene for a non-finite value, defaulting it instead", () => {
    // Unlike flame/solid's numeric fields, a malformed glowBrightness is a
    // cosmetic override, not corruption — the scene survives.
    const raw = { ...baseSnapshot(), glowBrightness: "bright" };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.glowBrightness).toBe(DEFAULT_GLOW_BRIGHTNESS);
  });

  it("clamps an out-of-range value above the maximum down to the max", () => {
    const s: SceneSnapshot = { ...baseSnapshot(), glowBrightness: 999 };
    expect(decodeScene(encodeScene(s))!.glowBrightness).toBe(
      MAX_GLOW_BRIGHTNESS,
    );
  });

  it("clamps an out-of-range value below the minimum up to the min", () => {
    const s: SceneSnapshot = { ...baseSnapshot(), glowBrightness: -5 };
    expect(decodeScene(encodeScene(s))!.glowBrightness).toBe(
      MIN_GLOW_BRIGHTNESS,
    );
  });
});

// ---------------------------------------------------------------------------
// Color contrast (fr-8sk) — same lenient, never-rejects contract as
// glowBrightness above: a malformed value falls back to the default instead
// of nuking the whole scene.
// ---------------------------------------------------------------------------

describe("decodeScene color contrast", () => {
  it("round-trips a non-default color gamma", () => {
    const s: SceneSnapshot = { ...baseSnapshot(), colorGamma: 2.5 };
    const result = decodeScene(encodeScene(s));
    expect(result!.colorGamma).toBeCloseTo(2.5, 4);
  });

  it("defaults quietly for a link encoded before this feature existed", () => {
    // A hand-built payload with no `colorGamma` key at all — exactly what
    // every link looked like before fr-8sk.
    const raw = {
      transforms: baseSnapshot().transforms,
      numPoints: 100_000,
      pointSize: 1,
      colorMode: "transform",
      renderStyle: "depthFade",
      showGuides: true,
      flame: baseSnapshot().flame,
      solid: baseSnapshot().solid,
      symmetry: baseSnapshot().symmetry,
      glowBrightness: baseSnapshot().glowBrightness,
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.colorGamma).toBe(DEFAULT_COLOR_GAMMA);
  });

  it("does not reject the scene for a non-finite value, defaulting it instead", () => {
    // Like glowBrightness's numeric field, a malformed colorGamma is a
    // cosmetic tweak, not corruption — the scene survives.
    const raw = { ...baseSnapshot(), colorGamma: "contrasty" };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.colorGamma).toBe(DEFAULT_COLOR_GAMMA);
  });

  it("clamps an out-of-range value above the maximum down to the max", () => {
    const s: SceneSnapshot = { ...baseSnapshot(), colorGamma: 999 };
    expect(decodeScene(encodeScene(s))!.colorGamma).toBe(MAX_COLOR_GAMMA);
  });

  it("clamps an out-of-range value below the minimum up to the min", () => {
    const s: SceneSnapshot = { ...baseSnapshot(), colorGamma: -5 };
    expect(decodeScene(encodeScene(s))!.colorGamma).toBe(MIN_COLOR_GAMMA);
  });
});

// ---------------------------------------------------------------------------
// 4D projection color mode (fr-d47)
// ---------------------------------------------------------------------------

describe("decodeScene fourDColor", () => {
  it("round-trips a non-default fourDColor", () => {
    const s: SceneSnapshot = { ...baseSnapshot(), fourDColor: "wCyanMagenta" };
    const result = decodeScene(encodeScene(s));
    expect(result!.fourDColor).toBe("wCyanMagenta");
  });

  it("defaults quietly for a link encoded before this feature existed", () => {
    // A hand-built payload with no `fourDColor` key at all — exactly what
    // every link looked like before fr-d47.
    const raw = {
      transforms: baseSnapshot().transforms,
      numPoints: 100_000,
      pointSize: 1,
      colorMode: "transform",
      colorGamma: DEFAULT_COLOR_GAMMA,
      renderStyle: "depthFade",
      showGuides: true,
      flame: baseSnapshot().flame,
      solid: baseSnapshot().solid,
      symmetry: baseSnapshot().symmetry,
      glowBrightness: baseSnapshot().glowBrightness,
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.fourDColor).toBe(DEFAULT_FOUR_D_COLOR);
  });

  it("falls back to wBlueOrange for an unrecognized fourDColor instead of rejecting the scene", () => {
    // Like symmetry.axis / flame.paletteId, an unrecognized value does NOT
    // nuke the whole scene — a 4D palette choice is cosmetic, not worth
    // losing an otherwise-valid shared link over.
    const raw = { ...baseSnapshot(), fourDColor: "neon" };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.fourDColor).toBe(DEFAULT_FOUR_D_COLOR);
  });
});

describe("decodeScene fourDDepthFade", () => {
  it("round-trips an enabled 4D camera-depth fade", () => {
    const s: SceneSnapshot = { ...baseSnapshot(), fourDDepthFade: true };
    const result = decodeScene(encodeScene(s));
    expect(result).not.toBeNull();
    expect(result!.fourDDepthFade).toBe(true);
  });

  it("defaults to off for a link encoded before this feature existed", () => {
    // A hand-built payload with no `fourDDepthFade` key at all — exactly what
    // every link looked like before fr-3e0. Boolean coercion (showGuides's
    // contract) turns the absent key into the off default, never a rejection.
    const raw: Partial<SceneSnapshot> = { ...baseSnapshot() };
    delete raw.fourDDepthFade;
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.fourDDepthFade).toBe(false);
  });

  it("coerces a non-boolean fourDDepthFade by truthiness instead of rejecting the scene", () => {
    // Same spirit as the other cosmetic fields: a hand-crafted payload's
    // sloppy value must not nuke an otherwise-valid shared link.
    const raw = { ...baseSnapshot(), fourDDepthFade: 1 };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.fourDDepthFade).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Clamping
// ---------------------------------------------------------------------------

describe("decodeScene clamping", () => {
  it("clamps numPoints above 5 000 000 down to 5 000 000", () => {
    const result = decodeScene(
      encodeScene({ ...baseSnapshot(), numPoints: 10_000_000 }),
    );
    expect(result!.numPoints).toBe(5_000_000);
  });

  it("clamps numPoints below 0 up to 0", () => {
    const result = decodeScene(
      encodeScene({ ...baseSnapshot(), numPoints: -100 }),
    );
    expect(result!.numPoints).toBe(0);
  });

  it("clamps pointSize above 4 down to 4", () => {
    const result = decodeScene(
      encodeScene({ ...baseSnapshot(), pointSize: 10 }),
    );
    expect(result!.pointSize).toBe(4);
  });

  it("clamps pointSize below 0.25 up to 0.25", () => {
    const result = decodeScene(
      encodeScene({ ...baseSnapshot(), pointSize: 0.1 }),
    );
    expect(result!.pointSize).toBe(0.25);
  });

  // The decode boundary is deliberately WIDER than the UI slider: a crafted or
  // legacy link may carry a count below MIN_NUM_POINTS (the slider's floor),
  // and it must survive decode unchanged rather than being snapped up — the
  // same way an off-detent flame iteration count survives. Only < 0 clamps (to
  // 0) and > 5M clamps (to 5M), pinned by the two tests above.
  it("keeps a numPoints below the UI slider floor unchanged", () => {
    expect(500).toBeLessThan(MIN_NUM_POINTS);
    const result = decodeScene(
      encodeScene({ ...baseSnapshot(), numPoints: 500 }),
    );
    expect(result!.numPoints).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// loadScene — source priority and fallback
// ---------------------------------------------------------------------------

describe("loadScene", () => {
  it("prefers the URL hash over localStorage", () => {
    const hashSnapshot = { ...baseSnapshot(), colorMode: "height" as const };
    const storageSnapshot = { ...baseSnapshot(), colorMode: "radius" as const };
    const storage = {
      getItem: vi.fn().mockReturnValue(encodeScene(storageSnapshot)),
      setItem: vi.fn(),
    };

    const result = loadScene({
      location: { hash: "#" + encodeScene(hashSnapshot) },
      storage,
    });

    expect(result?.colorMode).toBe("height");
    // Storage should not have been consulted when the hash was valid.
    expect(storage.getItem).not.toHaveBeenCalled();
  });

  it("falls back to localStorage when the hash is absent", () => {
    const storage = {
      getItem: vi.fn().mockReturnValue(encodeScene(baseSnapshot())),
      setItem: vi.fn(),
    };

    const result = loadScene({ location: { hash: "" }, storage });

    expect(result?.colorMode).toBe("transform");
    expect(storage.getItem).toHaveBeenCalledWith("fractal-viewer:scene");
  });

  it("falls back to localStorage when the hash holds an invalid scene", () => {
    const storage = {
      getItem: vi.fn().mockReturnValue(encodeScene(baseSnapshot())),
      setItem: vi.fn(),
    };

    const result = loadScene({ location: { hash: "#v1=invalid!!!" }, storage });

    expect(result?.colorMode).toBe("transform");
  });

  it("returns null when both the hash and localStorage have nothing", () => {
    const storage = {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
    };

    const result = loadScene({ location: { hash: "" }, storage });

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Camera pose (fr-1k4) — the optional orbit-camera view a saved/shared/
// collection document was framed with. Deliberately absent from undo-history
// snapshots (see SceneSnapshot.camera's doc), so `fromSnapshot` must strip it
// rather than let it leak into AppState. Its decode policy is even more
// lenient than customPalette's: a malformed camera drops ONLY the camera —
// never the whole scene — because an optional view must never cost the user
// their scene.
// ---------------------------------------------------------------------------

describe("decodeScene camera", () => {
  it("round-trips a camera pose, rounding each field to 4 decimal places", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      camera: {
        target: [1.23456, -2, 0.5],
        radius: 6.24619,
        theta: 0.30671,
        phi: 1.05599,
      },
    };
    const result = decodeScene(encodeScene(s));
    expect(result!.camera).not.toBeUndefined();
    expect(result!.camera!.target[0]).toBeCloseTo(1.2346, 4);
    expect(result!.camera!.target[1]).toBeCloseTo(-2, 4);
    expect(result!.camera!.target[2]).toBeCloseTo(0.5, 4);
    expect(result!.camera!.radius).toBeCloseTo(6.2462, 4);
    expect(result!.camera!.theta).toBeCloseTo(0.3067, 4);
    expect(result!.camera!.phi).toBeCloseTo(1.056, 4);
  });

  it("omits camera from the encoded payload and decodes back to undefined when the snapshot has none", () => {
    const payload = decodePayload(encodeScene(baseSnapshot()));
    expect("camera" in payload).toBe(false);
    expect(decodeScene(encodeScene(baseSnapshot()))!.camera).toBeUndefined();
  });

  it("keeps decoding a scene with no camera field at all as a valid, non-null scene", () => {
    // A hand-built payload with no `camera` key at all — exactly what every
    // link looked like before fr-1k4.
    const raw = {
      transforms: baseSnapshot().transforms,
      numPoints: 100_000,
      pointSize: 1,
      colorMode: "transform",
      renderStyle: "depthFade",
      showGuides: true,
      flame: baseSnapshot().flame,
      solid: baseSnapshot().solid,
      symmetry: baseSnapshot().symmetry,
      glowBrightness: baseSnapshot().glowBrightness,
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.camera).toBeUndefined();
  });

  it("drops the camera when the field is not an object", () => {
    const raw = { ...baseSnapshot(), camera: 5 };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.camera).toBeUndefined();
  });

  it("drops the camera when target does not have exactly 3 components", () => {
    const raw = {
      ...baseSnapshot(),
      camera: { target: [1, 2], radius: 5, theta: 0.5, phi: 1 },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.camera).toBeUndefined();
  });

  it("drops the camera when a target component is non-finite", () => {
    const raw = {
      ...baseSnapshot(),
      camera: { target: [0, NaN, 0], radius: 5, theta: 0.5, phi: 1 },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.camera).toBeUndefined();
  });

  it("drops the camera when radius is a numeric string instead of a number", () => {
    // Unlike most other fields in this file, camera does NOT coerce with
    // Number(x) — a string like "7" must not sneak past as a valid radius.
    const raw = {
      ...baseSnapshot(),
      camera: { target: [1, 2, 3], radius: "7", theta: 0.5, phi: 1 },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.camera).toBeUndefined();
  });

  it("drops the camera when phi is infinite", () => {
    const raw = {
      ...baseSnapshot(),
      camera: { target: [1, 2, 3], radius: 5, theta: 0.5, phi: Infinity },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.camera).toBeUndefined();
  });

  it("drops the camera when a target component exceeds the sanity bound", () => {
    const raw = {
      ...baseSnapshot(),
      camera: { target: [2000, 0, 0], radius: 5, theta: 0.5, phi: 1 },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.camera).toBeUndefined();
  });

  it("clamps radius below the minimum up to MIN_RADIUS", () => {
    const raw = {
      ...baseSnapshot(),
      camera: { target: [1, 2, 3], radius: 0.5, theta: 0.5, phi: 1 },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result!.camera!.radius).toBe(MIN_RADIUS);
  });

  it("clamps radius above the maximum down to MAX_RADIUS", () => {
    const raw = {
      ...baseSnapshot(),
      camera: { target: [1, 2, 3], radius: 500, theta: 0.5, phi: 1 },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result!.camera!.radius).toBe(MAX_RADIUS);
  });

  it("clamps phi below the minimum up to MIN_PHI", () => {
    const raw = {
      ...baseSnapshot(),
      camera: { target: [1, 2, 3], radius: 5, theta: 0.5, phi: -1 },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result!.camera!.phi).toBe(MIN_PHI);
  });

  it("clamps phi above the maximum down to MAX_PHI", () => {
    const raw = {
      ...baseSnapshot(),
      camera: { target: [1, 2, 3], radius: 5, theta: 0.5, phi: 9 },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result!.camera!.phi).toBe(MAX_PHI);
  });
});

describe("fromSnapshot camera", () => {
  it("does not leak a camera key into the returned AppState", () => {
    const snapshot: SceneSnapshot = {
      ...baseSnapshot(),
      camera: { target: [1, 2, 3], radius: 5, theta: 0.5, phi: 1 },
    };
    const result = fromSnapshot(snapshot, initialState(true));
    expect("camera" in result).toBe(false);
  });
});
