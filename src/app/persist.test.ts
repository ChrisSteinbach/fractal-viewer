// @vitest-environment jsdom
import {
  decodeScene,
  encodeScene,
  fromSnapshot,
  loadScene,
  saveScene,
  toSnapshot,
} from "./persist";
import type { SceneSnapshot } from "./persist";
import {
  DEFAULT_COLOR_SPEED,
  MAX_SCHEDULE_DEPTH,
  MAX_TRANSFORMS,
} from "../fractal/chaos-game";
import {
  MAX_CUSTOM_PALETTE_STOPS,
  MIN_CUSTOM_PALETTE_STOPS,
} from "../fractal/palette";
import { woodGrain } from "../fractal/presets";
import {
  CRESCENT_MOON_SHAPE,
  FACETED_CRYSTAL_SHAPE,
  HEART_PRISM_SHAPE,
  ORBIT_RING_SHAPE,
  PEACE_SIGN_SHAPE,
  SNOWFLAKE_PRISM_SHAPE,
  STAR_PRISM_SHAPE,
  TREFOIL_KNOT_SHAPE,
} from "../fractal/shapes";
import type { ShapeSpec } from "../fractal/shapes";
import { VARIATION_TYPES } from "../fractal/types";
import { VOXEL_RESOLUTION_STEP } from "../fractal/voxel";
import { MAX_PHI, MAX_RADIUS, MIN_PHI, MIN_RADIUS } from "./orbit";
import { bundledEmitterForShape } from "./bundled-shapes";
import {
  BALLOON_PALETTE_INHERIT,
  DEFAULT_BALLOON_PALETTE,
  DEFAULT_BALLOON_RADIUS,
  DEFAULT_BALLOON_TINT,
  DEFAULT_BALLOON_TINT_STRENGTH,
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
  DEFAULT_FOG_DENSITY,
  DEFAULT_FOG_TINT,
  DEFAULT_FOG_TINT_STRENGTH,
  DEFAULT_FOUR_D_COLOR,
  DEFAULT_GLOW_BRIGHTNESS,
  DEFAULT_RAMP_PALETTE,
  DEFAULT_SOLID_AMBIENT,
  DEFAULT_SOLID_ENV_LIGHT,
  DEFAULT_SOLID_FLOOR_EMISSION,
  DEFAULT_SOLID_FLOOR_ENABLED,
  DEFAULT_SOLID_FLOOR_PATTERN,
  DEFAULT_SOLID_FLOOR_TILE_SCALE,
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
  MAX_BALLOON_RADIUS,
  MAX_BALLOON_TINT_STRENGTH,
  MAX_COLOR_GAMMA,
  MAX_ESTIMATOR_CURVE,
  MAX_ESTIMATOR_RADIUS,
  MAX_FLAME_EXPOSURE,
  MAX_FLAME_GAMMA,
  MAX_FLAME_ITERATIONS,
  MAX_FLAME_SUPERSAMPLE,
  MAX_FOG_DENSITY,
  MAX_FOG_TINT_STRENGTH,
  MAX_GLOW_BRIGHTNESS,
  MAX_SOLID_LIGHT_AZIMUTH,
  MAX_SOLID_LIGHT_ELEVATION,
  MAX_SOLID_RESOLUTION,
  MAX_SOLID_THRESHOLD,
  MAX_SURFACE_COLOR_SPEED,
  MAX_SYMMETRY_ORDER,
  MAX_W_ANGLE,
  MAX_W_POSITION,
  MAX_W_SCALE,
  MAX_W_SHEAR,
  MIN_BALLOON_RADIUS,
  MIN_BALLOON_TINT_STRENGTH,
  MIN_COLOR_GAMMA,
  MIN_ESTIMATOR_MINIMUM_RADIUS,
  MIN_FLAME_EXPOSURE,
  MIN_FLAME_ITERATIONS,
  MIN_FLAME_VIBRANCY,
  MIN_FOG_DENSITY,
  MIN_FOG_TINT_STRENGTH,
  MIN_GLOW_BRIGHTNESS,
  MIN_NUM_POINTS,
  MIN_SOLID_AMBIENT,
  MIN_SOLID_ITERATIONS,
  MIN_SOLID_RESOLUTION,
  MIN_SYMMETRY_ORDER,
  MIN_W_POSITION,
  MIN_W_SCALE,
  PARAM,
  initialState,
  setSymmetryOrder,
  setSymmetryTwist,
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
      envLight: DEFAULT_SOLID_ENV_LIGHT,
      floorEnabled: DEFAULT_SOLID_FLOOR_ENABLED,
      floorPattern: DEFAULT_SOLID_FLOOR_PATTERN,
      floorTileScale: DEFAULT_SOLID_FLOOR_TILE_SCALE,
      floorEmission: DEFAULT_SOLID_FLOOR_EMISSION,
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
      envLight: DEFAULT_SOLID_ENV_LIGHT,
      floorEnabled: DEFAULT_SOLID_FLOOR_ENABLED,
      floorPattern: DEFAULT_SOLID_FLOOR_PATTERN,
      floorTileScale: DEFAULT_SOLID_FLOOR_TILE_SCALE,
      floorEmission: DEFAULT_SOLID_FLOOR_EMISSION,
      paletteId: DEFAULT_SOLID_PALETTE,
    });
    expect(result!.surface).toEqual({
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
    });
  });

  it("round-trips divergent Solid and Surface lighting independently", () => {
    const base = baseSnapshot();
    const result = decodeScene(
      encodeScene({
        ...base,
        solid: {
          ...base.solid,
          lightAzimuth: -45,
          lightElevation: 70,
          ambient: 0.2,
        },
        surface: {
          ...base.surface,
          lightAzimuth: 95,
          lightElevation: 30,
          ambient: 0.65,
          envLight: 0.8,
        },
      }),
    );

    expect(result?.solid).toMatchObject({
      lightAzimuth: -45,
      lightElevation: 70,
      ambient: 0.2,
    });
    expect(result?.surface).toMatchObject({
      lightAzimuth: 95,
      lightElevation: 30,
      ambient: 0.65,
      envLight: 0.8,
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

  it("leaves weight undefined when the payload never carried the field", () => {
    // baseSnapshot() has no weight.
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

  it("leaves shear undefined when the payload never carried the field", () => {
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

  it("leaves variations undefined when the payload never carried the field", () => {
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

  it("keeps a negative variation weight through encode/decode", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      transforms: [
        {
          id: 0,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          variations: [{ type: "mandelbox", weight: -1.5 }],
        },
      ],
    };
    const result = decodeScene(encodeScene(s));
    expect(result!.transforms[0].variations).toEqual([
      { type: "mandelbox", weight: -1.5 },
    ]);
  });

  it("clamps a wildly negative variation weight to the band's negative edge", () => {
    const raw = {
      ...baseSnapshot(),
      transforms: [
        {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          variations: [{ type: "spherical", weight: -100000 }],
        },
      ],
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    const weight = result!.transforms[0].variations![0].weight;
    expect(weight).toBe(-100);
  });

  it("accepts a blend as wide as the variation vocabulary — one entry per type", () => {
    const raw = {
      ...baseSnapshot(),
      transforms: [
        {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          variations: VARIATION_TYPES.map((type) => ({ type, weight: 0.5 })),
        },
      ],
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result!.transforms[0].variations).toHaveLength(
      VARIATION_TYPES.length,
    );
  });

  it("returns null for a blend longer than the variation vocabulary", () => {
    // No producer can author this — the editor's add-dropdown hides types the
    // transform already carries — and it is one lane more than the flame GPU
    // Slot carries, so the decoder refuses it rather than handing the packer
    // a list it must throw on.
    const raw = {
      ...baseSnapshot(),
      transforms: [
        {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          variations: Array.from(
            { length: VARIATION_TYPES.length + 1 },
            () => ({ type: "spherical", weight: 1 }),
          ),
        },
      ],
    };
    expect(decodeScene("v1=" + b64url(JSON.stringify(raw)))).toBeNull();
  });
});

describe("decodeScene transform variation fold radii", () => {
  it("round-trips a variation with all three fold lengths set", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      transforms: [
        {
          id: 0,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          variations: [
            {
              type: "mandelbox",
              weight: 2,
              minRadius: 0.3,
              fixedRadius: 1.4,
              boxLimit: 1.2,
            },
          ],
        },
      ],
    };
    const result = decodeScene(encodeScene(s));
    expect(result!.transforms[0].variations).toEqual([
      {
        type: "mandelbox",
        weight: 2,
        minRadius: 0.3,
        fixedRadius: 1.4,
        boxLimit: 1.2,
      },
    ]);
  });

  it("round-trips a variation with only one fold length set, leaving the other two absent", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      transforms: [
        {
          id: 0,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          variations: [{ type: "spherefold", weight: 1, minRadius: 0.3 }],
        },
      ],
    };
    const result = decodeScene(encodeScene(s));
    expect(result!.transforms[0].variations).toEqual([
      { type: "spherefold", weight: 1, minRadius: 0.3 },
    ]);
  });

  it("leaves fold lengths undefined when the payload never carried them", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      transforms: [
        {
          id: 0,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          variations: [{ type: "spherefold", weight: 1 }],
        },
      ],
    };
    const result = decodeScene(encodeScene(s));
    expect(result!.transforms[0].variations![0].minRadius).toBeUndefined();
    expect(result!.transforms[0].variations![0].fixedRadius).toBeUndefined();
    expect(result!.transforms[0].variations![0].boxLimit).toBeUndefined();
  });

  it("encodes byte-identically whether fold lengths are omitted or explicitly undefined", () => {
    const withoutFields: SceneSnapshot = {
      ...baseSnapshot(),
      transforms: [
        {
          id: 0,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          variations: [{ type: "spherefold", weight: 1 }],
        },
      ],
    };
    const withUndefinedFields: SceneSnapshot = {
      ...baseSnapshot(),
      transforms: [
        {
          id: 0,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          variations: [
            {
              type: "spherefold",
              weight: 1,
              minRadius: undefined,
              fixedRadius: undefined,
              boxLimit: undefined,
            },
          ],
        },
      ],
    };
    expect(encodeScene(withUndefinedFields)).toBe(encodeScene(withoutFields));
  });

  it("leaves fold lengths absent for non-numeric garbage, without rejecting the scene", () => {
    const raw = {
      ...baseSnapshot(),
      transforms: [
        {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          variations: [
            {
              type: "mandelbox",
              weight: 1,
              minRadius: "big",
              fixedRadius: "big",
              boxLimit: "big",
            },
          ],
        },
      ],
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.transforms[0].variations).toEqual([
      { type: "mandelbox", weight: 1 },
    ]);
  });

  it("leaves fold lengths absent for an explicit null, rather than decoding Number(null)'s 0", () => {
    const raw = {
      ...baseSnapshot(),
      transforms: [
        {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          variations: [
            {
              type: "mandelbox",
              weight: 1,
              minRadius: null,
              fixedRadius: null,
              boxLimit: null,
            },
          ],
        },
      ],
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.transforms[0].variations).toEqual([
      { type: "mandelbox", weight: 1 },
    ]);
  });

  it("leaves fold lengths absent for a boolean, without coercing true to 1", () => {
    const raw = {
      ...baseSnapshot(),
      transforms: [
        {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          variations: [
            {
              type: "mandelbox",
              weight: 1,
              minRadius: true,
              fixedRadius: false,
              boxLimit: true,
            },
          ],
        },
      ],
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.transforms[0].variations).toEqual([
      { type: "mandelbox", weight: 1 },
    ]);
  });

  it("leaves fold lengths absent for an array/object value, without rejecting the scene", () => {
    const raw = {
      ...baseSnapshot(),
      transforms: [
        {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          variations: [
            {
              type: "mandelbox",
              weight: 1,
              minRadius: [0.3],
              fixedRadius: { value: 1.4 },
              boxLimit: [1.2],
            },
          ],
        },
      ],
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.transforms[0].variations).toEqual([
      { type: "mandelbox", weight: 1 },
    ]);
  });

  it("keeps an out-of-domain but finite fold length through decode untouched, without clamping", () => {
    // resolveFoldRadii (variations.ts) owns the domain, not persist — so a
    // negative fixedRadius survives the decode exactly as authored rather
    // than being clamped or rejected.
    const raw = {
      ...baseSnapshot(),
      transforms: [
        {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          variations: [
            { type: "spherefold", weight: 1, minRadius: -5, fixedRadius: -2 },
          ],
        },
      ],
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.transforms[0].variations).toEqual([
      { type: "spherefold", weight: 1, minRadius: -5, fixedRadius: -2 },
    ]);
  });
});

describe("decodeScene transform finish", () => {
  it("round-trips a transform with a full finish", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      transforms: [
        {
          id: 0,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          finish: {
            specular: 0.8,
            shininess: 64,
            metalness: 0.5,
            reflect: 0.3,
            transmit: 0.1,
            reflectionTint: 0.2,
          },
        },
      ],
    };
    const result = decodeScene(encodeScene(s));
    expect(result!.transforms[0].finish).toEqual({
      specular: 0.8,
      shininess: 64,
      metalness: 0.5,
      reflect: 0.3,
      transmit: 0.1,
      reflectionTint: 0.2,
    });
  });

  it("round-trips a transform with only one finish field set, leaving the others absent", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      transforms: [
        {
          id: 0,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          finish: { metalness: 0.6 },
        },
      ],
    };
    const result = decodeScene(encodeScene(s));
    expect(result!.transforms[0].finish).toEqual({ metalness: 0.6 });
  });

  it("leaves finish absent when the payload never carried it", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      transforms: [
        {
          id: 0,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
        },
      ],
    };
    const result = decodeScene(encodeScene(s));
    expect(result!.transforms[0].finish).toBeUndefined();
  });

  it("leaves finish absent when decoding a document with no finish key at all", () => {
    // A hand-built payload, not one round-tripped through encodeScene — the
    // shape of a document written before this field existed.
    const raw = {
      ...baseSnapshot(),
      transforms: [
        { position: [0, 0, 0], rotation: [0, 0, 0], scale: [0.5, 0.5, 0.5] },
      ],
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.transforms[0].finish).toBeUndefined();
  });

  it("encodes with no finish key at all when the transform carries none", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      transforms: [
        {
          id: 0,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
        },
      ],
    };
    const payload = decodePayload(encodeScene(s));
    const transforms = payload.transforms as Record<string, unknown>[];
    expect("finish" in transforms[0]).toBe(false);
  });

  it("encodes byte-identically whether finish is omitted or every field is explicitly undefined", () => {
    const withoutField: SceneSnapshot = {
      ...baseSnapshot(),
      transforms: [
        {
          id: 0,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
        },
      ],
    };
    const withUndefinedFields: SceneSnapshot = {
      ...baseSnapshot(),
      transforms: [
        {
          id: 0,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          finish: {
            specular: undefined,
            shininess: undefined,
            metalness: undefined,
            reflect: undefined,
            transmit: undefined,
          },
        },
      ],
    };
    expect(encodeScene(withUndefinedFields)).toBe(encodeScene(withoutField));
  });

  it("leaves the whole finish absent for a non-object raw value — string, array, or null", () => {
    const buildRaw = (finish: unknown) => ({
      ...baseSnapshot(),
      transforms: [
        {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          finish,
        },
      ],
    });
    for (const finish of ["shiny", [0.4, 32, 0, 0, 0], null]) {
      const result = decodeScene(
        "v1=" + b64url(JSON.stringify(buildRaw(finish))),
      );
      expect(result, `finish = ${JSON.stringify(finish)}`).not.toBeNull();
      expect(
        result!.transforms[0].finish,
        `finish = ${JSON.stringify(finish)}`,
      ).toBeUndefined();
    }
  });

  it("leaves finish fields absent for non-numeric garbage, without rejecting the scene", () => {
    const raw = {
      ...baseSnapshot(),
      transforms: [
        {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          finish: {
            specular: "bright",
            shininess: "big",
            metalness: "half",
            reflect: "some",
            transmit: "none",
          },
        },
      ],
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.transforms[0].finish).toBeUndefined();
  });

  it("leaves finish fields absent for an explicit null, rather than decoding Number(null)'s 0", () => {
    const raw = {
      ...baseSnapshot(),
      transforms: [
        {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          finish: {
            specular: null,
            shininess: null,
            metalness: null,
            reflect: null,
            transmit: null,
          },
        },
      ],
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.transforms[0].finish).toBeUndefined();
  });

  it("leaves finish fields absent for a boolean, without coercing true to 1", () => {
    const raw = {
      ...baseSnapshot(),
      transforms: [
        {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          finish: {
            specular: true,
            shininess: false,
            metalness: true,
            reflect: false,
            transmit: true,
          },
        },
      ],
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.transforms[0].finish).toBeUndefined();
  });

  it("leaves finish fields absent for an array/object value, without rejecting the scene", () => {
    const raw = {
      ...baseSnapshot(),
      transforms: [
        {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          finish: {
            specular: [0.8],
            shininess: { value: 64 },
            metalness: [0.5],
            reflect: { value: 0.3 },
            transmit: [0.1],
          },
        },
      ],
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.transforms[0].finish).toBeUndefined();
  });

  it("keeps a sibling field intact when only some fields in an otherwise-valid finish are malformed", () => {
    const raw = {
      ...baseSnapshot(),
      transforms: [
        {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          finish: { specular: 0.9, shininess: "big", metalness: true },
        },
      ],
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.transforms[0].finish).toEqual({ specular: 0.9 });
  });

  it("keeps an out-of-domain but finite finish field through decode untouched, without clamping", () => {
    // resolveSurfaceFinish (surface-finish.ts) owns the domain, not persist —
    // so a negative specular and an out-of-range metalness survive the
    // decode exactly as authored rather than being clamped or rejected.
    const raw = {
      ...baseSnapshot(),
      transforms: [
        {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          finish: { specular: -5, metalness: 3 },
        },
      ],
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.transforms[0].finish).toEqual({
      specular: -5,
      metalness: 3,
    });
  });

  it("an all-fields-invalid finish encodes to no finish key at all", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      transforms: [
        {
          id: 0,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          finish: {
            specular: NaN,
            shininess: Infinity,
            metalness: NaN,
            reflect: -Infinity,
            transmit: NaN,
          },
        },
      ],
    };
    const payload = decodePayload(encodeScene(s));
    const transforms = payload.transforms as Record<string, unknown>[];
    expect("finish" in transforms[0]).toBe(false);
  });
});

describe("decodeScene transform surface pattern", () => {
  it("round-trips every stable family/axis and sparse numeric leaves", () => {
    for (const kind of ["wood", "marble", "strata"] as const) {
      for (const axis of ["x", "y", "z"] as const) {
        const s: SceneSnapshot = {
          ...baseSnapshot(),
          transforms: [
            {
              id: 0,
              position: [0, 0, 0],
              rotation: [0, 0, 0],
              scale: [0.5, 0.5, 0.5],
              surfacePattern: { kind, axis, scale: 3.1256, strength: 0.625 },
            },
          ],
        };
        expect(
          decodeScene(encodeScene(s))!.transforms[0].surfacePattern,
        ).toEqual({ kind, axis, scale: 3.1256, strength: 0.625 });
      }
    }
    const sparse: SceneSnapshot = {
      ...baseSnapshot(),
      transforms: [
        {
          id: 0,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          surfacePattern: { kind: "marble", axis: "y" },
        },
      ],
    };
    expect(
      decodeScene(encodeScene(sparse))!.transforms[0].surfacePattern,
    ).toEqual({ kind: "marble", axis: "y" });
  });

  it("keeps absence byte-identical within the current wire and old payloads patternless", () => {
    const omitted: SceneSnapshot = {
      ...baseSnapshot(),
      transforms: [
        {
          id: 0,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
        },
      ],
    };
    const explicit = structuredClone(omitted);
    explicit.transforms[0].surfacePattern = undefined;
    const legacyGolden =
      "v1=eyJ0cmFuc2Zvcm1zIjpbeyJwb3NpdGlvbiI6WzAsMCwwXSwicm90YXRpb24iOlswLDAsMF0sInNjYWxlIjpbMC41LDAuNSwwLjVdfV0sIm51bVBvaW50cyI6MTAwMDAwLCJwb2ludFNpemUiOjEsImNvbG9yTW9kZSI6InRyYW5zZm9ybSIsImNvbG9yR2FtbWEiOjEsInJhbXBQYWxldHRlSWQiOiJsZWdhY3kiLCJmb3VyRENvbG9yIjoid0JsdWVPcmFuZ2UiLCJmb3VyRERlcHRoRmFkZSI6ZmFsc2UsInJlbmRlclN0eWxlIjoiZGVwdGhGYWRlIiwic2hvd0d1aWRlcyI6dHJ1ZSwiZmxhbWUiOnsiZXhwb3N1cmUiOjEsIml0ZXJhdGlvbnMiOjIwMDAwMDAwLCJnYW1tYSI6Mi40LCJ2aWJyYW5jeSI6MSwic3VwZXJzYW1wbGUiOjIsImVzdGltYXRvclJhZGl1cyI6NiwiZXN0aW1hdG9yTWluaW11bVJhZGl1cyI6MCwiZXN0aW1hdG9yQ3VydmUiOjAuNCwicGFsZXR0ZUlkIjoic3BlY3RydW0ifSwic29saWQiOnsicmVzb2x1dGlvbiI6MTkyLCJpdGVyYXRpb25zIjoyMDAwMDAwMCwidGhyZXNob2xkIjowLjMsImxpZ2h0QXppbXV0aCI6MTM1LCJsaWdodEVsZXZhdGlvbiI6NTAsImFtYmllbnQiOjAuMjUsInBhbGV0dGVJZCI6InNwZWN0cnVtIn0sInN1cmZhY2UiOnsibGlnaHRBemltdXRoIjoxMzUsImxpZ2h0RWxldmF0aW9uIjo1MCwiYW1iaWVudCI6MC4yNSwiY29sb3JTb3VyY2UiOiJ0cmFuc2Zvcm0iLCJwYWxldHRlSWQiOiJzcGVjdHJ1bSIsImNvbG9yU3BlZWQiOjAuNSwiZW52TGlnaHQiOjAuMzUsImZsb29yUGF0dGVybiI6InNvbGlkIiwiZmxvb3JUaWxlU2NhbGUiOjAuNjQsImZsb29yRW1pc3Npb24iOjB9LCJzeW1tZXRyeSI6eyJvcmRlciI6MSwicGxhbmUiOiJ4eiJ9LCJnbG93QnJpZ2h0bmVzcyI6MSwiYmFsbG9vbkVjaG8iOmZhbHNlLCJiYWxsb29uUmFkaXVzIjoxLjYsImJhbGxvb25UaW50IjoiIzAwMDAwMCIsImJhbGxvb25UaW50U3RyZW5ndGgiOjAsImZvZ0RlbnNpdHkiOjEsImZvZ1RpbnQiOiIjZmZmZmZmIiwiZm9nVGludFN0cmVuZ3RoIjowLCJncm91bmRQbGFuZSI6ZmFsc2V9";
    expect(encodeScene(explicit)).toBe(encodeScene(omitted));
    expect(
      decodeScene(encodeScene(omitted))!.transforms[0].surfacePattern,
    ).toBeUndefined();
    const payload = decodePayload(encodeScene(omitted));
    expect(
      "surfacePattern" in (payload.transforms as Record<string, unknown>[])[0],
    ).toBe(false);
    expect(
      decodeScene(legacyGolden)!.transforms[0].surfacePattern,
    ).toBeUndefined();
  });

  it("quietly drops malformed blocks and required discriminators", () => {
    const build = (surfacePattern: unknown) => ({
      ...baseSnapshot(),
      transforms: [
        {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          surfacePattern,
        },
      ],
    });
    for (const value of [
      null,
      "wood",
      ["wood", "y"],
      {},
      { kind: "plain", axis: "y" },
      { kind: "wood" },
      { kind: "wood", axis: "q" },
    ]) {
      const decoded = decodeScene("v1=" + b64url(JSON.stringify(build(value))));
      expect(decoded).not.toBeNull();
      expect(decoded!.transforms[0].surfacePattern).toBeUndefined();
    }
  });

  it("drops malformed optional leaves independently but preserves finite authored values", () => {
    const raw = {
      ...baseSnapshot(),
      transforms: [
        {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          surfacePattern: {
            kind: "strata",
            axis: "z",
            scale: -7,
            strength: "strong",
          },
        },
      ],
    };
    const decoded = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(decoded).not.toBeNull();
    expect(decoded!.transforms[0].surfacePattern).toEqual({
      kind: "strata",
      axis: "z",
      scale: -7,
    });
  });

  it("omits non-finite numeric leaves on encode while retaining the valid family", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      transforms: [
        {
          id: 0,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          surfacePattern: {
            kind: "wood",
            axis: "x",
            scale: NaN,
            strength: Infinity,
          },
        },
      ],
    };
    const payload = decodePayload(encodeScene(s));
    expect(
      (payload.transforms as Record<string, unknown>[])[0].surfacePattern,
    ).toEqual({ kind: "wood", axis: "x" });
  });

  it("uses the same codec for a final transform", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      finalTransform: {
        id: 0,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        surfacePattern: {
          kind: "marble",
          axis: "z",
          scale: 1.35,
          strength: 0.8,
        },
      },
    };
    expect(decodeScene(encodeScene(s))!.finalTransform!.surfacePattern).toEqual(
      s.finalTransform!.surfacePattern,
    );
  });

  it("stores only values for a material-starting-point document, never a preset name", () => {
    // Exactly what the panel's Wood starting point writes (ui.ts's
    // MATERIAL_PRESETS): the satin finish's three non-classic fields plus
    // the wood pattern at its own defaults. The wire has a `finish` block
    // and a `surfacePattern` block and NOTHING naming the preset — the
    // name is UI vocabulary, so retuning a preset later repaints no saved
    // scene.
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      transforms: [
        {
          id: 0,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          finish: { specular: 0.25, shininess: 8, reflect: 0.08 },
          surfacePattern: { kind: "wood", axis: "y" },
        },
      ],
    };
    const payload = decodePayload(encodeScene(s));
    const transform = (payload.transforms as Record<string, unknown>[])[0];
    expect(transform.finish).toEqual({
      specular: 0.25,
      shininess: 8,
      reflect: 0.08,
    });
    expect(transform.surfacePattern).toEqual({ kind: "wood", axis: "y" });
    expect("material" in transform).toBe(false);
    expect("preset" in transform).toBe(false);
    // And the round trip is identity: values in, values out.
    expect(decodeScene(encodeScene(s))!.transforms[0]).toMatchObject({
      finish: { specular: 0.25, shininess: 8, reflect: 0.08 },
      surfacePattern: { kind: "wood", axis: "y" },
    });
  });

  it("persists the Wood Grain showcase as accepted values, never its menu name", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      transforms: woodGrain(),
    };
    const encoded = encodeScene(s);
    const payload = decodePayload(encoded);
    const transforms = payload.transforms as Record<string, unknown>[];

    expect(transforms).toHaveLength(6);
    expect(transforms.map((transform) => transform.surfacePattern)).toEqual(
      (["y", "z", "x", "y", "z", "x"] as const).map((axis) => ({
        kind: "wood",
        axis,
        scale: 3,
        strength: 1,
      })),
    );
    for (const transform of transforms) {
      expect("finish" in transform).toBe(false);
      expect("material" in transform).toBe(false);
      expect("preset" in transform).toBe(false);
    }
    expect(decodeScene(encoded)!.transforms).toEqual(woodGrain());
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

  it("leaves finalTransform undefined when the payload never carried one", () => {
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
// Per-transform w (optional 4D extension — see fractal/types.ts's
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

  it("round-trips a negative w.scale (a 4D reflection) through encode/decode", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      transforms: [
        {
          ...baseSnapshot().transforms[0],
          w: { scale: -0.5 },
        },
      ],
    };
    const result = decodeScene(encodeScene(s));
    expect(result!.transforms[0].w).toStrictEqual({ scale: -0.5 });
  });

  it("clamps an oversized negative w.scale to the max magnitude, preserving the sign", () => {
    const raw = {
      ...baseSnapshot(),
      transforms: [
        {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          w: { scale: -9 },
        },
      ],
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result!.transforms[0].w).toStrictEqual({ scale: -MAX_W_SCALE });
  });

  it("clamps a tiny negative w.scale up to the min magnitude, preserving the sign", () => {
    const raw = {
      ...baseSnapshot(),
      transforms: [
        {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          w: { scale: -0.001 },
        },
      ],
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result!.transforms[0].w).toStrictEqual({ scale: -MIN_W_SCALE });
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
// Per-transform colorIndex / colorSpeed (flam3 xform color parity;
// see fractal/types.ts's Transform.colorIndex/colorSpeed doc comments and
// fractal/chaos-game.ts's DEFAULT_COLOR_SPEED/derivedColorIndex). colorSpeed
// follows the weight/shear discipline (omit-the-default on encode); colorIndex
// deliberately does NOT omit a default on encode — see encodeTransform's own
// doc comment for why there is nothing to compare against. Both fields diverge
// from weight/shear/variations/w on decode in one way: a malformed value never
// rejects the whole scene, it just leaves the field absent (see
// decodeTransform's colorIndex/colorSpeed block).
// ---------------------------------------------------------------------------

describe("decodeScene transform colorIndex / colorSpeed", () => {
  it("round-trips both fields with their exact authored values", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      transforms: [
        {
          id: 0,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          colorIndex: 0.75,
          colorSpeed: 0.9,
        },
      ],
    };
    const result = decodeScene(encodeScene(s));
    expect(result!.transforms[0].colorIndex).toBeCloseTo(0.75, 4);
    expect(result!.transforms[0].colorSpeed).toBeCloseTo(0.9, 4);
  });

  it("leaves both fields undefined when the payload never carried them", () => {
    // baseSnapshot() has neither field.
    const result = decodeScene(encodeScene(baseSnapshot()));
    expect(result!.transforms[0].colorIndex).toBeUndefined();
    expect(result!.transforms[0].colorSpeed).toBeUndefined();
  });

  it("does not persist a colorSpeed at the default, decoding it back as undefined", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      transforms: [
        {
          id: 0,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          colorSpeed: DEFAULT_COLOR_SPEED,
        },
      ],
    };
    expect(
      decodeScene(encodeScene(s))!.transforms[0].colorSpeed,
    ).toBeUndefined();
  });

  it("emits a colorIndex of 0 in the wire payload — a meaningful authored value, not a falsy no-op", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      transforms: [
        {
          id: 0,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          colorIndex: 0,
        },
      ],
    };
    const encoded = encodeScene(s);
    const encodedTransforms = decodePayload(encoded).transforms as Record<
      string,
      unknown
    >[];
    expect(encodedTransforms[0].colorIndex).toBe(0);
    expect(decodeScene(encoded)!.transforms[0].colorIndex).toBe(0);
  });

  it("clamps an out-of-range colorIndex/colorSpeed into [0, 1]", () => {
    const raw = {
      ...baseSnapshot(),
      transforms: [
        {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          colorIndex: -3,
          colorSpeed: 7,
        },
      ],
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.transforms[0].colorIndex).toBe(0);
    expect(result!.transforms[0].colorSpeed).toBe(1);
  });

  it("leaves colorIndex/colorSpeed absent for non-numeric garbage, without rejecting the scene", () => {
    const raw = {
      ...baseSnapshot(),
      transforms: [
        {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          colorIndex: "blue",
          colorSpeed: "blue",
        },
      ],
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.transforms[0].colorIndex).toBeUndefined();
    expect(result!.transforms[0].colorSpeed).toBeUndefined();
  });

  it("leaves colorIndex/colorSpeed absent for an explicit null, rather than decoding Number(null)'s 0", () => {
    const raw = {
      ...baseSnapshot(),
      transforms: [
        {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.5, 0.5, 0.5],
          colorIndex: null,
          colorSpeed: null,
        },
      ],
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.transforms[0].colorIndex).toBeUndefined();
    expect(result!.transforms[0].colorSpeed).toBeUndefined();
  });

  it("round-trips both fields on the final transform too", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      finalTransform: {
        id: 0,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        colorIndex: 0.25,
        colorSpeed: 0.1,
      },
    };
    const result = decodeScene(encodeScene(s));
    expect(result!.finalTransform!.colorIndex).toBeCloseTo(0.25, 4);
    expect(result!.finalTransform!.colorSpeed).toBeCloseTo(0.1, 4);
  });
});

// ---------------------------------------------------------------------------
// Flame render params — same "absent defaults quietly, malformed rejects"
// contract as finalTransform/weight/shear
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

  it("defaults quietly when the flame block is absent entirely", () => {
    // A hand-built payload with no `flame` key at all.
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
      paletteId: DEFAULT_FLAME_PALETTE,
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

  it("defaults gamma/vibrancy/supersample when the flame block omits them", () => {
    // A hand-built flame block carrying only exposure/iterations.
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

  it("defaults estimator params when the flame block omits them", () => {
    // A hand-built flame block carrying only exposure/iterations/gamma/
    // vibrancy/supersample.
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

  it("falls back to the default for an unknown paletteId instead of rejecting the scene", () => {
    // Unlike every other flame field, an unknown palette does NOT nuke the
    // whole scene — a link carrying a palette this build doesn't know still
    // restores, just with the default coloring.
    const raw = {
      ...baseSnapshot(),
      flame: { ...baseSnapshot().flame, paletteId: "chartreuse" },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.flame.paletteId).toBe(DEFAULT_FLAME_PALETTE);
  });

  it("defaults paletteId when the flame block omits it", () => {
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
    expect(result!.flame.paletteId).toBe(DEFAULT_FLAME_PALETTE);
  });
});

// ---------------------------------------------------------------------------
// Solid render params (same "absent defaults quietly, malformed
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
        envLight: 0.7,
        floorEnabled: true,
        floorPattern: "checker",
        floorTileScale: 1.2,
        floorEmission: 1.5,
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
      envLight: 0.7,
      floorEnabled: true,
      floorPattern: "checker",
      floorTileScale: 1.2,
      floorEmission: 1.5,
      paletteId: "spectrum",
    });
  });

  it("defaults quietly when the solid block is absent entirely", () => {
    // A hand-built payload with no `solid` key at all.
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
      envLight: DEFAULT_SOLID_ENV_LIGHT,
      floorEnabled: DEFAULT_SOLID_FLOOR_ENABLED,
      floorPattern: DEFAULT_SOLID_FLOOR_PATTERN,
      floorTileScale: DEFAULT_SOLID_FLOOR_TILE_SCALE,
      floorEmission: DEFAULT_SOLID_FLOOR_EMISSION,
      paletteId: DEFAULT_SOLID_PALETTE,
    });
  });

  it("decodes a legacy Solid block with no presentation fields to compatibility defaults", () => {
    const raw = {
      ...baseSnapshot(),
      solid: {
        resolution: 224,
        iterations: 42_000_000,
        threshold: 0.6,
        lightAzimuth: -45,
        lightElevation: 70,
        ambient: 0.5,
        paletteId: "aurora",
      },
    };

    expect(decodeScene("v1=" + b64url(JSON.stringify(raw)))!.solid).toEqual({
      ...raw.solid,
      envLight: DEFAULT_SOLID_ENV_LIGHT,
      floorEnabled: DEFAULT_SOLID_FLOOR_ENABLED,
      floorPattern: DEFAULT_SOLID_FLOOR_PATTERN,
      floorTileScale: DEFAULT_SOLID_FLOOR_TILE_SCALE,
      floorEmission: DEFAULT_SOLID_FLOOR_EMISSION,
    });
  });

  it("quietly defaults malformed Solid floor bool and enum fields", () => {
    const raw = {
      ...baseSnapshot(),
      solid: {
        ...baseSnapshot().solid,
        floorEnabled: "yes",
        floorPattern: "stripes",
      },
    };
    const solid = decodeScene("v1=" + b64url(JSON.stringify(raw)))!.solid;

    expect(solid.floorEnabled).toBe(DEFAULT_SOLID_FLOOR_ENABLED);
    expect(solid.floorPattern).toBe(DEFAULT_SOLID_FLOOR_PATTERN);
  });

  it("coerces, clamps, and rejects Solid presentation numerics like the existing block", () => {
    const raw = {
      ...baseSnapshot(),
      solid: {
        ...baseSnapshot().solid,
        envLight: "0.8",
        floorTileScale: -99,
        floorEmission: 99,
      },
    };
    const solid = decodeScene("v1=" + b64url(JSON.stringify(raw)))!.solid;
    expect(solid.envLight).toBe(0.8);
    expect(solid.floorTileScale).toBe(PARAM.solidFloorTileScale.min);
    expect(solid.floorEmission).toBe(PARAM.solidFloorEmission.max);

    raw.solid.envLight = "bright";
    expect(decodeScene("v1=" + b64url(JSON.stringify(raw)))).toBeNull();
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

  it("round-trips the full 512 resolution ceiling", () => {
    // 512 is within MAX_SOLID_RESOLUTION, so it survives decode unclamped.
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

  it("falls back to the default for an unknown paletteId instead of rejecting the scene", () => {
    // Unlike every other solid field, an unknown palette does NOT nuke the
    // whole scene — mirrors flame.paletteId's fallback behavior.
    const raw = {
      ...baseSnapshot(),
      solid: { ...baseSnapshot().solid, paletteId: "chartreuse" },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.solid.paletteId).toBe(DEFAULT_SOLID_PALETTE);
  });

  it("defaults paletteId when the solid block omits it", () => {
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
    expect(result!.solid.paletteId).toBe(DEFAULT_SOLID_PALETTE);
  });
});

// ---------------------------------------------------------------------------
// Surface render params (same "absent defaults quietly, malformed
// numeric field rejects" contract as the flame/solid blocks above; unlike
// those numeric fields, `colorSource` is a QUIET-fallback enum, like
// symmetry.plane, not a reject-the-scene field)
// ---------------------------------------------------------------------------

describe("decodeScene surface params", () => {
  it("round-trips a fully customized surface block", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      surface: {
        antialiasSamples: 16,
        depthOfField: true,
        lightAzimuth: -45,
        lightElevation: 70,
        ambient: 0.5,
        colorSource: "radius",
        paletteId: "spectrum",
        colorSpeed: 0.8,
        envLight: 0.6,
        floorPattern: "checker",
        floorTileScale: 0.8,
        floorEmission: 1.5,
      },
    };
    const result = decodeScene(encodeScene(s));
    expect(result!.surface).toEqual({
      antialiasSamples: 16,
      depthOfField: true,
      lightAzimuth: -45,
      lightElevation: 70,
      ambient: 0.5,
      colorSource: "radius",
      paletteId: "spectrum",
      colorSpeed: 0.8,
      envLight: 0.6,
      floorPattern: "checker",
      floorTileScale: 0.8,
      floorEmission: 1.5,
    });
  });

  it("defaults quietly when the surface block is absent entirely", () => {
    // A hand-built payload with no `surface` key at all.
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
    expect(result!.surface).toEqual({
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
    });
  });

  it("defaults a legacy surface block that omits antialiasSamples to 8", () => {
    const base = baseSnapshot().surface;
    const raw = {
      ...baseSnapshot(),
      surface: {
        lightAzimuth: base.lightAzimuth,
        lightElevation: base.lightElevation,
        ambient: base.ambient,
        colorSource: base.colorSource,
        paletteId: base.paletteId,
        colorSpeed: base.colorSpeed,
        envLight: base.envLight,
        floorPattern: base.floorPattern,
        floorTileScale: base.floorTileScale,
        floorEmission: base.floorEmission,
      },
    };

    expect(
      decodeScene("v1=" + b64url(JSON.stringify(raw)))!.surface
        .antialiasSamples,
    ).toBe(DEFAULT_SURFACE_ANTIALIAS_SAMPLES);
  });

  it("defaults a legacy surface block that omits depthOfField to off", () => {
    const { depthOfField: _depthOfField, ...legacySurface } =
      baseSnapshot().surface;
    const raw = { ...baseSnapshot(), surface: legacySurface };

    expect(
      decodeScene("v1=" + b64url(JSON.stringify(raw)))!.surface.depthOfField,
    ).toBe(DEFAULT_SURFACE_DEPTH_OF_FIELD);
  });

  it("quietly defaults malformed depthOfField to off", () => {
    const raw = {
      ...baseSnapshot(),
      surface: { ...baseSnapshot().surface, depthOfField: "yes" },
    };

    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.surface.depthOfField).toBe(DEFAULT_SURFACE_DEPTH_OF_FIELD);
  });

  it("omits default-off depthOfField from the wire and writes enabled explicitly", () => {
    const defaultPayload = decodePayload(encodeScene(baseSnapshot()));
    expect(
      "depthOfField" in (defaultPayload.surface as Record<string, unknown>),
    ).toBe(false);

    const enabled = baseSnapshot();
    enabled.surface = { ...enabled.surface, depthOfField: true };
    const enabledPayload = decodePayload(encodeScene(enabled));
    expect(
      (enabledPayload.surface as Record<string, unknown>).depthOfField,
    ).toBe(true);
  });

  it("snaps a finite off-detent antialias sample count to the nearest supported choice", () => {
    const raw = {
      ...baseSnapshot(),
      surface: { ...baseSnapshot().surface, antialiasSamples: 7 },
    };

    expect(
      decodeScene("v1=" + b64url(JSON.stringify(raw)))!.surface
        .antialiasSamples,
    ).toBe(8);
  });

  it("rejects a non-finite antialias sample count", () => {
    const raw = {
      ...baseSnapshot(),
      surface: { ...baseSnapshot().surface, antialiasSamples: "many" },
    };

    expect(decodeScene("v1=" + b64url(JSON.stringify(raw)))).toBeNull();
  });

  it("returns null when surface is present but not an object", () => {
    const raw = { ...baseSnapshot(), surface: "bright" };
    expect(decodeScene("v1=" + b64url(JSON.stringify(raw)))).toBeNull();
  });

  it("returns null when lightAzimuth is present but non-finite", () => {
    const raw = {
      ...baseSnapshot(),
      surface: { ...baseSnapshot().surface, lightAzimuth: "x" },
    };
    expect(decodeScene("v1=" + b64url(JSON.stringify(raw)))).toBeNull();
  });

  it("returns null when ambient is present but non-finite", () => {
    const raw = {
      ...baseSnapshot(),
      surface: { ...baseSnapshot().surface, ambient: "murky" },
    };
    expect(decodeScene("v1=" + b64url(JSON.stringify(raw)))).toBeNull();
  });

  it("clamps out-of-range lightAzimuth/lightElevation/ambient into their allowed bands", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      surface: {
        ...baseSnapshot().surface,
        lightAzimuth: 999,
        lightElevation: 999,
        ambient: -5,
      },
    };
    const result = decodeScene(encodeScene(s));
    expect(result!.surface.lightAzimuth).toBe(MAX_SOLID_LIGHT_AZIMUTH);
    expect(result!.surface.lightElevation).toBe(MAX_SOLID_LIGHT_ELEVATION);
    expect(result!.surface.ambient).toBe(MIN_SOLID_AMBIENT);
  });

  it("clamps an out-of-range colorSpeed into its allowed band", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      surface: { ...baseSnapshot().surface, colorSpeed: 7 },
    };
    const result = decodeScene(encodeScene(s));
    expect(result!.surface.colorSpeed).toBe(MAX_SURFACE_COLOR_SPEED);
  });

  it("round-trips a non-default colorSource", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      surface: { ...baseSnapshot().surface, colorSource: "height" },
    };
    expect(decodeScene(encodeScene(s))!.surface.colorSource).toBe("height");
  });

  it('round-trips the "rings" colorSource', () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      surface: { ...baseSnapshot().surface, colorSource: "rings" },
    };
    expect(decodeScene(encodeScene(s))!.surface.colorSource).toBe("rings");
  });

  it('round-trips the "sheets" colorSource', () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      surface: { ...baseSnapshot().surface, colorSource: "sheets" },
    };
    expect(decodeScene(encodeScene(s))!.surface.colorSource).toBe("sheets");
  });

  it('falls back to "transform" for an unrecognized colorSource instead of rejecting the scene', () => {
    const raw = {
      ...baseSnapshot(),
      surface: { ...baseSnapshot().surface, colorSource: "psychedelic" },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.surface.colorSource).toBe("transform");
  });

  it("defaults colorSource when the surface block omits it", () => {
    const raw = {
      ...baseSnapshot(),
      surface: {
        lightAzimuth: 100,
        lightElevation: 60,
        ambient: 0.3,
        paletteId: "spectrum",
      },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.surface.colorSource).toBe("transform");
  });

  it("round-trips a non-default paletteId", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      surface: { ...baseSnapshot().surface, paletteId: "aurora" },
    };
    expect(decodeScene(encodeScene(s))!.surface.paletteId).toBe("aurora");
  });

  it("falls back to the default for an unknown paletteId instead of rejecting the scene", () => {
    // Unlike lightAzimuth/lightElevation/ambient, an unknown palette does
    // NOT nuke the whole scene — mirrors flame.paletteId/solid.paletteId's
    // fallback behavior.
    const raw = {
      ...baseSnapshot(),
      surface: { ...baseSnapshot().surface, paletteId: "chartreuse" },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.surface.paletteId).toBe(DEFAULT_SOLID_PALETTE);
  });

  it("defaults paletteId when the surface block omits it", () => {
    // A surface block carrying every field except paletteId.
    const raw = {
      ...baseSnapshot(),
      surface: {
        lightAzimuth: 100,
        lightElevation: 60,
        ambient: 0.3,
        colorSource: "radius",
      },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.surface.paletteId).toBe(DEFAULT_SOLID_PALETTE);
  });

  it("defaults colorSpeed when the surface block omits it", () => {
    // A surface block carrying every field except colorSpeed.
    const raw = {
      ...baseSnapshot(),
      surface: {
        lightAzimuth: 100,
        lightElevation: 60,
        ambient: 0.3,
        colorSource: "radius",
        paletteId: "spectrum",
      },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.surface.colorSpeed).toBe(DEFAULT_SURFACE_COLOR_SPEED);
  });
});

// ---------------------------------------------------------------------------
// Custom palette — the one user-authored gradient slot. Absent,
// malformed, or an out-of-range stop count all quietly decode to `undefined`
// rather than rejecting the scene; all five primary palette selections accept
// "custom" only when a valid payload decoded alongside it. Balloon has its
// own independent slot (see decodeCustomPalette).
// ---------------------------------------------------------------------------

describe("decodeScene customPalette", () => {
  it("round-trips one shared payload backing all five primary Custom selections", () => {
    const base = baseSnapshot();
    const snapshot: SceneSnapshot = {
      ...base,
      rampPaletteId: "custom",
      background: { mode: "flame", flamePaletteId: "custom" },
      flame: { ...base.flame, paletteId: "custom" },
      solid: { ...base.solid, paletteId: "custom" },
      surface: { ...base.surface, paletteId: "custom" },
      customPalette: {
        stops: [
          [1, 0, 0],
          [0, 0, 1],
        ],
      },
    };

    const encoded = encodeScene(snapshot);
    const payload = decodePayload(encoded);
    const result = decodeScene(encoded)!;

    expect(payload.customPalette).toEqual({
      stops: ["#ff0000", "#0000ff"],
    });
    expect(payload).not.toHaveProperty("rampCustomPalette");
    expect(payload).not.toHaveProperty("flameCustomPalette");
    expect(payload).not.toHaveProperty("solidCustomPalette");
    expect(payload).not.toHaveProperty("surfaceCustomPalette");
    expect(payload).not.toHaveProperty("backgroundCustomPalette");
    expect(result.customPalette).toEqual(snapshot.customPalette);
    expect(result.rampPaletteId).toBe("custom");
    expect(result.flame.paletteId).toBe("custom");
    expect(result.solid.paletteId).toBe("custom");
    expect(result.surface.paletteId).toBe("custom");
    expect(result.background.flamePaletteId).toBe("custom");
    expect(result.balloonCustomPalette).toBeUndefined();
  });

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

  it("falls back to the default for a custom flame paletteId with no customPalette payload", () => {
    const raw = {
      ...baseSnapshot(),
      flame: { ...baseSnapshot().flame, paletteId: "custom" },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.flame.paletteId).toBe(DEFAULT_FLAME_PALETTE);
    expect(result!.customPalette).toBeUndefined();
  });

  it("falls back to the default for a custom solid paletteId with no customPalette payload", () => {
    const raw = {
      ...baseSnapshot(),
      solid: { ...baseSnapshot().solid, paletteId: "custom" },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.solid.paletteId).toBe(DEFAULT_SOLID_PALETTE);
    expect(result!.customPalette).toBeUndefined();
  });

  it("round-trips a custom surface paletteId selection alongside the same payload", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      surface: { ...baseSnapshot().surface, paletteId: "custom" },
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
    expect(result!.surface.paletteId).toBe("custom");
  });

  it("falls back to the default for a custom surface paletteId with no customPalette payload", () => {
    const raw = {
      ...baseSnapshot(),
      surface: { ...baseSnapshot().surface, paletteId: "custom" },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.surface.paletteId).toBe(DEFAULT_SOLID_PALETTE);
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
    expect(result!.flame.paletteId).toBe(DEFAULT_FLAME_PALETTE);
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
    expect(result!.flame.paletteId).toBe(DEFAULT_FLAME_PALETTE);
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
    expect(result!.flame.paletteId).toBe(DEFAULT_FLAME_PALETTE);
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
    expect(result!.flame.paletteId).toBe(DEFAULT_FLAME_PALETTE);
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
    expect(result!.flame.paletteId).toBe(DEFAULT_FLAME_PALETTE);
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
// Position axis colors — the "by position" color mode's three
// user-picked axis colors. Optional like customPalette, and shares its
// quiet-fallback decode contract; see color.ts's PositionAxisColors.
// ---------------------------------------------------------------------------

describe("decodeScene positionAxisColors", () => {
  it("round-trips the three axis colors", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      positionAxisColors: {
        x: [0.2, 0.4, 0.6],
        y: [1, 0, 0],
        z: [0, 0.4, 1],
      },
    };
    const result = decodeScene(encodeScene(s));
    expect(result!.positionAxisColors).toEqual({
      x: [0.2, 0.4, 0.6],
      y: [1, 0, 0],
      z: [0, 0.4, 1],
    });
  });

  it("omits positionAxisColors from the encoded payload when the snapshot has none", () => {
    const payload = decodePayload(encodeScene(baseSnapshot()));
    expect("positionAxisColors" in payload).toBe(false);
  });

  it("decodes back to undefined when the snapshot has none", () => {
    const result = decodeScene(encodeScene(baseSnapshot()));
    expect(result!.positionAxisColors).toBeUndefined();
  });

  it("quietly drops a malformed positionAxisColors instead of rejecting the scene", () => {
    const raw = {
      ...baseSnapshot(),
      positionAxisColors: { x: "#ff00", y: "#00ff00", z: "#0000ff" },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.positionAxisColors).toBeUndefined();
    // The rest of the scene survives — this is a quiet fallback, not a
    // whole-scene rejection.
    expect(result!.transforms).toHaveLength(1);
  });

  it("quietly drops a positionAxisColors payload missing an axis", () => {
    const raw = {
      ...baseSnapshot(),
      positionAxisColors: { x: "#ff0000", y: "#00ff00" },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.positionAxisColors).toBeUndefined();
  });

  it("quietly drops a non-object positionAxisColors", () => {
    const raw = { ...baseSnapshot(), positionAxisColors: "red" };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.positionAxisColors).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Ramp palette — the height/radius color-mode ramps' gradient
// selection. A top-level sibling of colorGamma, not nested under flame/solid,
// but sharing their exact quiet-fallback contract and the one customPalette
// slot (see decodeFlameParams / decodeCustomPalette).
// ---------------------------------------------------------------------------

describe("decodeScene rampPaletteId", () => {
  it("round-trips a non-default rampPaletteId", () => {
    const s: SceneSnapshot = { ...baseSnapshot(), rampPaletteId: "ember" };
    expect(decodeScene(encodeScene(s))!.rampPaletteId).toBe("ember");
  });

  it("defaults quietly to legacy when rampPaletteId is absent", () => {
    // A hand-built payload with no `rampPaletteId` key at all.
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
// toSnapshot / fromSnapshot — customPalette carry/clear. These two
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
// toSnapshot / fromSnapshot — positionAxisColors carry/clear, the
// same pairing as the customPalette block above. Unlike that block's
// "clears" test, this one builds the incoming snapshot from the bare
// baseSnapshot() helper rather than routing it through toSnapshot, so it
// also pins that fromSnapshot clears the field even when the snapshot
// object never declares the key at all (see fromSnapshot's own doc comment).
// ---------------------------------------------------------------------------

describe("toSnapshot / fromSnapshot positionAxisColors", () => {
  it("toSnapshot carries the positionAxisColors slot", () => {
    const state: AppState = {
      ...initialState(true),
      positionAxisColors: {
        x: [0.2, 0.4, 0.6],
        y: [1, 0, 0],
        z: [0, 0.4, 1],
      },
    };
    expect(toSnapshot(state).positionAxisColors).toEqual({
      x: [0.2, 0.4, 0.6],
      y: [1, 0, 0],
      z: [0, 0.4, 1],
    });
  });

  it("fromSnapshot clears positionAxisColors when the snapshot lacks it", () => {
    const base: AppState = {
      ...initialState(true),
      positionAxisColors: {
        x: [0.2, 0.4, 0.6],
        y: [1, 0, 0],
        z: [0, 0.4, 1],
      },
    };
    expect(
      fromSnapshot(baseSnapshot(), base).positionAxisColors,
    ).toBeUndefined();
  });

  it("fromSnapshot lands positionAxisColors on the state when the snapshot carries it", () => {
    const snapshot: SceneSnapshot = {
      ...baseSnapshot(),
      positionAxisColors: {
        x: [0.2, 0.4, 0.6],
        y: [1, 0, 0],
        z: [0, 0.4, 1],
      },
    };
    const next = fromSnapshot(snapshot, initialState(true));
    expect(next.positionAxisColors).toEqual({
      x: [0.2, 0.4, 0.6],
      y: [1, 0, 0],
      z: [0, 0.4, 1],
    });
  });
});

// ---------------------------------------------------------------------------
// Symmetry params — deliberately MORE lenient than flame/solid: a
// malformed field never rejects the scene, it just falls back to a default.
// ---------------------------------------------------------------------------

describe("decodeScene symmetry", () => {
  it("round-trips a non-default order and axis", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      symmetry: { order: 6, plane: "xy" },
    };
    const result = decodeScene(encodeScene(s));
    expect(result!.symmetry).toEqual({ order: 6, plane: "xy" });
  });

  it("defaults quietly when the symmetry block is absent entirely", () => {
    // A hand-built payload with no `symmetry` key at all.
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
      plane: DEFAULT_SYMMETRY_PLANE,
    });
  });

  it("does not reject the scene for a non-finite order, defaulting it instead", () => {
    // Unlike flame/solid's numeric fields, a malformed order is cosmetic
    // geometry, not corruption — the scene survives.
    const raw = {
      ...baseSnapshot(),
      symmetry: { order: "nonsense", plane: "xz" },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.symmetry.order).toBe(DEFAULT_SYMMETRY_ORDER);
  });

  it("clamps an out-of-range order above the maximum down to the max", () => {
    const raw = { ...baseSnapshot(), symmetry: { order: 999, plane: "xz" } };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result!.symmetry.order).toBe(MAX_SYMMETRY_ORDER);
  });

  it("clamps an out-of-range order below the minimum up to the min", () => {
    const raw = { ...baseSnapshot(), symmetry: { order: -5, plane: "xz" } };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result!.symmetry.order).toBe(MIN_SYMMETRY_ORDER);
  });

  it("rounds a fractional order to the nearest integer", () => {
    const raw = { ...baseSnapshot(), symmetry: { order: 4.6, plane: "xz" } };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result!.symmetry.order).toBe(5);
  });

  it("falls back to xz for an unrecognized legacy axis instead of rejecting the scene", () => {
    // Unlike every other block, an unknown axis does NOT nuke the whole
    // scene — mirrors flame.paletteId's fallback behavior.
    const raw = { ...baseSnapshot(), symmetry: { order: 3, axis: "w" } };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.symmetry.plane).toBe("xz");
    expect(result!.transforms).toHaveLength(1);
  });

  // ——— the axis -> plane migration ———

  it("reads a legacy axis: y document as the xz plane", () => {
    const raw = { ...baseSnapshot(), symmetry: { order: 3, axis: "y" } };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result!.symmetry).toEqual({ order: 3, plane: "xz" });
  });

  it("reads the other two legacy axes as the planes they named", () => {
    for (const [axis, plane] of [
      ["x", "yz"],
      ["z", "xy"],
    ] as const) {
      const raw = { ...baseSnapshot(), symmetry: { order: 4, axis } };
      const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
      expect(result!.symmetry.plane).toBe(plane);
    }
  });

  it("prefers a modern plane over a legacy axis when both are present", () => {
    const raw = {
      ...baseSnapshot(),
      symmetry: { order: 3, plane: "yz", axis: "z" },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result!.symmetry.plane).toBe("yz");
  });

  it("falls back to xz for an unrecognized plane", () => {
    const raw = { ...baseSnapshot(), symmetry: { order: 3, plane: "qq" } };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result!.symmetry.plane).toBe("xz");
  });

  it("defaults a document carrying no symmetry block at all", () => {
    const raw = { ...baseSnapshot() };
    delete (raw as Record<string, unknown>).symmetry;
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result!.symmetry).toEqual({
      order: DEFAULT_SYMMETRY_ORDER,
      plane: DEFAULT_SYMMETRY_PLANE,
    });
  });

  it("round-trips a nonzero twist", () => {
    const decoded = decodeScene(
      encodeScene({
        ...baseSnapshot(),
        symmetry: { order: 5, plane: "yz", twist: 2 },
      }),
    );
    expect(decoded!.symmetry).toEqual({ order: 5, plane: "yz", twist: 2 });
  });

  it("round-trips the symmetry an order drop leaves behind", () => {
    // Reached through the REAL reducers, not a hand-built payload —
    // order 12, twist 7, then order 3. The decoder caps a twist at `order - 1`,
    // so if `setSymmetryOrder` let the stale 7 stand, the reloaded scene would
    // draw a different attractor than the live one.
    const live = setSymmetryOrder(
      setSymmetryTwist(setSymmetryOrder(initialState(true), 12), 7),
      3,
    );
    expect(live.symmetry.twist).toBe(2);
    expect(decodeScene(encodeScene(toSnapshot(live)))!.symmetry).toEqual(
      live.symmetry,
    );
  });

  it("writes plane, and omits twist from the encoded form when it is zero", () => {
    const payload = decodePayload(
      encodeScene({ ...baseSnapshot(), symmetry: { order: 5, plane: "yz" } }),
    );
    expect(payload.symmetry).toEqual({ order: 5, plane: "yz" });
  });

  it("clamps a twist into [0, order) and coerces it to an integer", () => {
    const raw = {
      ...baseSnapshot(),
      symmetry: { order: 4, plane: "xz", twist: 9.6 },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result!.symmetry.twist).toBe(3);
  });

  it("drops a malformed twist to a simple rotation", () => {
    const raw = {
      ...baseSnapshot(),
      symmetry: { order: 4, plane: "xz", twist: "nope" },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect("twist" in result!.symmetry).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Glow brightness — same lenient, never-rejects contract as
// symmetry above: a malformed value falls back to the default instead of
// nuking the whole scene.
// ---------------------------------------------------------------------------

describe("decodeScene glow brightness", () => {
  it("round-trips a non-default glow brightness", () => {
    const s: SceneSnapshot = { ...baseSnapshot(), glowBrightness: 2.25 };
    const result = decodeScene(encodeScene(s));
    expect(result!.glowBrightness).toBeCloseTo(2.25, 4);
  });

  it("defaults quietly when glowBrightness is absent", () => {
    // A hand-built payload with no `glowBrightness` key at all.
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
// Color contrast — same lenient, never-rejects contract as
// glowBrightness above: a malformed value falls back to the default instead
// of nuking the whole scene.
// ---------------------------------------------------------------------------

describe("decodeScene color contrast", () => {
  it("round-trips a non-default color gamma", () => {
    const s: SceneSnapshot = { ...baseSnapshot(), colorGamma: 2.5 };
    const result = decodeScene(encodeScene(s));
    expect(result!.colorGamma).toBeCloseTo(2.5, 4);
  });

  it("defaults quietly when colorGamma is absent", () => {
    // A hand-built payload with no `colorGamma` key at all.
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
// 4D projection color mode
// ---------------------------------------------------------------------------

describe("decodeScene fourDColor", () => {
  it("round-trips a non-default fourDColor", () => {
    const s: SceneSnapshot = { ...baseSnapshot(), fourDColor: "wCyanMagenta" };
    const result = decodeScene(encodeScene(s));
    expect(result!.fourDColor).toBe("wCyanMagenta");
  });

  it.each(["height", "position", "uniform"] as const)(
    "round-trips the lifted 4D %s color mode",
    (fourDColor) => {
      const s: SceneSnapshot = { ...baseSnapshot(), fourDColor };
      expect(decodeScene(encodeScene(s))!.fourDColor).toBe(fourDColor);
    },
  );

  it("defaults quietly when fourDColor is absent", () => {
    // A hand-built payload with no `fourDColor` key at all.
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
    // Like symmetry.plane / flame.paletteId, an unrecognized value does NOT
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

  it("defaults to off when fourDDepthFade is absent", () => {
    // A hand-built payload with no `fourDDepthFade` key at all. Boolean
    // coercion (showGuides's contract) turns the absent key into the off
    // default, never a rejection.
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

  // The decode boundary is deliberately WIDER than the UI slider: a crafted
  // payload may carry a count below MIN_NUM_POINTS (the slider's floor), and
  // it must survive decode unchanged rather than being snapped up — the
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
// saveScene — history + storage writes (history is injectable via
// PersistDeps, mirroring location/storage)
// ---------------------------------------------------------------------------

describe("saveScene", () => {
  it("writes the encoded scene to storage under the module's key", () => {
    const setItem = vi.fn();
    const storage = { getItem: () => null, setItem };
    const history = { replaceState: vi.fn() };
    const s = baseSnapshot();

    saveScene(s, { history, storage });

    expect(setItem).toHaveBeenCalledWith(
      "fractal-viewer:scene",
      encodeScene(s),
    );
  });

  it("calls history.replaceState with '#' + encoded", () => {
    const replaceState = vi.fn();
    const history = { replaceState };
    const storage = { getItem: () => null, setItem: vi.fn() };
    const s = baseSnapshot();

    saveScene(s, { history, storage });

    expect(replaceState).toHaveBeenCalledWith(null, "", "#" + encodeScene(s));
  });

  it("swallows a throwing replaceState and still writes storage", () => {
    const setItem = vi.fn();
    const storage = { getItem: () => null, setItem };
    const history = {
      replaceState: () => {
        throw new Error("SecurityError");
      },
    };

    expect(() => saveScene(baseSnapshot(), { history, storage })).not.toThrow();
    expect(setItem).toHaveBeenCalled();
  });

  it("swallows a throwing setItem without throwing", () => {
    const history = { replaceState: vi.fn() };
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };

    expect(() => saveScene(baseSnapshot(), { history, storage })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Camera pose — the optional orbit-camera view a saved/shared/
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
    // A hand-built payload with no `camera` key at all.
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

  it("preserves session and local UI fields while restoring the authored snapshot", () => {
    const base = {
      ...initialState(true),
      renderMode: "solid" as const,
      autoUpdate: false,
      morphDetail: "full" as const,
      adaptiveResolution: false,
      exportScale: 4 as const,
      selectedTransform: 2,
      panelOpen: true,
    };

    const result = fromSnapshot(baseSnapshot(), base);

    expect(result.renderMode).toBe("solid");
    expect(result.autoUpdate).toBe(false);
    expect(result.morphDetail).toBe("full");
    expect(result.adaptiveResolution).toBe(false);
    expect(result.exportScale).toBe(4);
    expect(result.selectedTransform).toBe(2);
    expect(result.panelOpen).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4D view pose — the optional tumble rotor + soft w-slice window a
// saved/shared/collection document was framed with (see SceneSnapshot.fourD's
// doc): the 4D sibling of the camera-pose block above. Same quiet-fallback
// decode policy as camera: anything malformed drops ONLY the pose, never the
// whole scene, and the numeric fields don't coerce from strings either. The
// rotor pair goes one step further than camera's plain clamp — a valid but
// non-unit pair is renormalized (rotor4.ts's normalizeRotorPair), so the
// decoded pair is always directly usable as a view rotation.
// ---------------------------------------------------------------------------

describe("decodeScene fourD", () => {
  it("round-trips a 4D view pose, keeping the rotor unit-length and near the original components", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      fourD: {
        pair: {
          p: [0.9689, 0.2474, 0, 0],
          q: [0.9689, 0, 0, 0.2474],
        },
        sliceOn: true,
        sliceCenter: 0.35,
        sliceThickness: 0,
        sliceRelColor: true,
      },
    };
    const result = decodeScene(encodeScene(s));

    expect(result!.fourD).not.toBeUndefined();
    expect(result!.fourD!.sliceOn).toBe(true);
    expect(result!.fourD!.sliceCenter).toBeCloseTo(0.35, 4);
    expect(result!.fourD!.sliceRelColor).toBe(true);

    const { p, q } = result!.fourD!.pair;
    expect(Math.hypot(...p)).toBeCloseTo(1, 6);
    expect(Math.hypot(...q)).toBeCloseTo(1, 6);
    expect(p[0]).toBeCloseTo(0.9689, 3);
    expect(p[1]).toBeCloseTo(0.2474, 3);
    expect(p[2]).toBeCloseTo(0, 3);
    expect(p[3]).toBeCloseTo(0, 3);
    expect(q[0]).toBeCloseTo(0.9689, 3);
    expect(q[1]).toBeCloseTo(0, 3);
    expect(q[2]).toBeCloseTo(0, 3);
    expect(q[3]).toBeCloseTo(0.2474, 3);
  });

  it("omits fourD from the encoded payload and decodes back to undefined when the snapshot has none", () => {
    const payload = decodePayload(encodeScene(baseSnapshot()));
    expect("fourD" in payload).toBe(false);
    expect(decodeScene(encodeScene(baseSnapshot()))!.fourD).toBeUndefined();
  });

  it("encodes byte-identically whether fourD is left absent or explicitly set to undefined", () => {
    const without = baseSnapshot();
    expect(encodeScene(without)).toBe(
      encodeScene({ ...without, fourD: undefined }),
    );
  });

  it("keeps decoding a scene with no fourD field at all as a valid, non-null scene", () => {
    // A hand-built payload with no `fourD` key at all.
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
    expect(result!.fourD).toBeUndefined();
  });

  it("drops the pose when fourD is not an object", () => {
    const raw = { ...baseSnapshot(), fourD: "tumbling" };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.fourD).toBeUndefined();
    // The rest of the scene survives — this is a quiet fallback, not a
    // whole-scene rejection.
    expect(result!.transforms).toHaveLength(1);
  });

  it("drops the pose when fourD is null", () => {
    const raw = { ...baseSnapshot(), fourD: null };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.fourD).toBeUndefined();
  });

  it("drops the pose when p is a string instead of an array", () => {
    const raw = {
      ...baseSnapshot(),
      fourD: {
        p: "not-an-array",
        q: [1, 0, 0, 0],
        sliceOn: false,
        sliceCenter: 0,
        sliceRelColor: false,
      },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.fourD).toBeUndefined();
  });

  it("drops the pose when p has fewer than 4 components", () => {
    const raw = {
      ...baseSnapshot(),
      fourD: {
        p: [1, 0, 0],
        q: [1, 0, 0, 0],
        sliceOn: false,
        sliceCenter: 0,
        sliceRelColor: false,
      },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.fourD).toBeUndefined();
  });

  it("drops the pose when p contains a string entry instead of a number", () => {
    const raw = {
      ...baseSnapshot(),
      fourD: {
        p: ["1", 0, 0, 0],
        q: [1, 0, 0, 0],
        sliceOn: false,
        sliceCenter: 0,
        sliceRelColor: false,
      },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.fourD).toBeUndefined();
  });

  it("drops the pose when p contains a non-finite entry (NaN serializes to null)", () => {
    const raw = {
      ...baseSnapshot(),
      fourD: {
        p: [NaN, 0, 0, 0],
        q: [1, 0, 0, 0],
        sliceOn: false,
        sliceCenter: 0,
        sliceRelColor: false,
      },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.fourD).toBeUndefined();
  });

  it("drops the pose when a rotor half is all-zero (norm below the normalizable threshold)", () => {
    const raw = {
      ...baseSnapshot(),
      fourD: {
        p: [0, 0, 0, 0],
        q: [1, 0, 0, 0],
        sliceOn: false,
        sliceCenter: 0,
        sliceRelColor: false,
      },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.fourD).toBeUndefined();
  });

  it("drops the pose when sliceCenter is a numeric string instead of a number", () => {
    // Unlike most other fields in this file, fourD does NOT coerce with
    // Number(x) — a string like "0.5" must not sneak past as a valid center.
    const raw = {
      ...baseSnapshot(),
      fourD: {
        p: [1, 0, 0, 0],
        q: [1, 0, 0, 0],
        sliceOn: false,
        sliceCenter: "0.5",
        sliceRelColor: false,
      },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.fourD).toBeUndefined();
  });

  it("drops the pose when sliceCenter is not finite (Infinity serializes to null)", () => {
    const raw = {
      ...baseSnapshot(),
      fourD: {
        p: [1, 0, 0, 0],
        q: [1, 0, 0, 0],
        sliceOn: false,
        sliceCenter: null,
        sliceRelColor: false,
      },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.fourD).toBeUndefined();
  });

  it("clamps an out-of-range sliceCenter above the maximum down to 1", () => {
    const raw = {
      ...baseSnapshot(),
      fourD: {
        p: [1, 0, 0, 0],
        q: [1, 0, 0, 0],
        sliceOn: true,
        sliceCenter: 5,
        sliceRelColor: false,
      },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result!.fourD).not.toBeUndefined();
    expect(result!.fourD!.sliceCenter).toBe(1);
  });

  it("clamps an out-of-range sliceCenter below the minimum up to -1", () => {
    const raw = {
      ...baseSnapshot(),
      fourD: {
        p: [1, 0, 0, 0],
        q: [1, 0, 0, 0],
        sliceOn: true,
        sliceCenter: -5,
        sliceRelColor: false,
      },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result!.fourD).not.toBeUndefined();
    expect(result!.fourD!.sliceCenter).toBe(-1);
  });

  it("coerces absent sliceOn/sliceRelColor to false while still keeping the pose", () => {
    const raw = {
      ...baseSnapshot(),
      fourD: {
        p: [1, 0, 0, 0],
        q: [1, 0, 0, 0],
        sliceCenter: 0.2,
      },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result!.fourD).not.toBeUndefined();
    expect(result!.fourD!.sliceOn).toBe(false);
    expect(result!.fourD!.sliceRelColor).toBe(false);
    expect(result!.fourD!.sliceCenter).toBeCloseTo(0.2, 4);
  });

  // Slab thickness is the one field in this block that does NOT
  // follow sliceCenter's all-or-nothing rule: every document written before
  // the slider existed carries no such key, so absent/malformed defaults to
  // 0 — the zero-thickness cross-section those documents were framed with —
  // instead of dropping the whole pose.
  it("round-trips the slice slab's thickness", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      fourD: {
        pair: { p: [1, 0, 0, 0], q: [1, 0, 0, 0] },
        sliceOn: false,
        sliceCenter: 0,
        sliceThickness: 0.28,
        sliceRelColor: false,
      },
    };
    const result = decodeScene(encodeScene(s));

    expect(result!.fourD!.sliceThickness).toBeCloseTo(0.28, 4);
  });

  it("keeps a pose saved before the thickness slider existed, reading it as a zero-thickness slice", () => {
    // The regression that matters: a hand-built payload with every 4D-pose
    // field but no `sliceThickness` key at all — exactly what every shared
    // link and saved scene from before that slider existed looks like.
    const raw = {
      ...baseSnapshot(),
      fourD: {
        p: [1, 0, 0, 0],
        q: [1, 0, 0, 0],
        sliceOn: true,
        sliceCenter: 0.4,
        sliceRelColor: true,
      },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));

    expect(result!.fourD).not.toBeUndefined();
    expect(result!.fourD!.sliceThickness).toBe(0);
    expect(result!.fourD!.sliceCenter).toBeCloseTo(0.4, 4);
  });

  it("defaults a non-numeric sliceThickness to 0 rather than dropping the pose", () => {
    const raw = {
      ...baseSnapshot(),
      fourD: {
        p: [1, 0, 0, 0],
        q: [1, 0, 0, 0],
        sliceOn: false,
        sliceCenter: 0,
        sliceThickness: "thick",
        sliceRelColor: false,
      },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));

    expect(result!.fourD).not.toBeUndefined();
    expect(result!.fourD!.sliceThickness).toBe(0);
  });

  it("clamps an out-of-range sliceThickness down to the slider's 0.5 maximum", () => {
    const raw = {
      ...baseSnapshot(),
      fourD: {
        p: [1, 0, 0, 0],
        q: [1, 0, 0, 0],
        sliceOn: false,
        sliceCenter: 0,
        sliceThickness: 9,
        sliceRelColor: false,
      },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));

    expect(result!.fourD!.sliceThickness).toBe(0.5);
  });

  it("clamps a negative sliceThickness up to 0 — a slab has no negative half-width", () => {
    const raw = {
      ...baseSnapshot(),
      fourD: {
        p: [1, 0, 0, 0],
        q: [1, 0, 0, 0],
        sliceOn: false,
        sliceCenter: 0,
        sliceThickness: -3,
        sliceRelColor: false,
      },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));

    expect(result!.fourD!.sliceThickness).toBe(0);
  });

  it("renormalizes a non-unit rotor pair to unit length", () => {
    const raw = {
      ...baseSnapshot(),
      fourD: {
        p: [2, 0, 0, 0],
        q: [0, 0, 2, 0],
        sliceOn: false,
        sliceCenter: 0,
        sliceRelColor: false,
      },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result!.fourD).not.toBeUndefined();
    const { p, q } = result!.fourD!.pair;
    expect(p).toEqual([1, 0, 0, 0]);
    expect(q).toEqual([0, 0, 1, 0]);
  });
});

describe("fromSnapshot fourD", () => {
  it("does not leak a fourD key into the returned AppState", () => {
    const snapshot: SceneSnapshot = {
      ...baseSnapshot(),
      fourD: {
        pair: { p: [1, 0, 0, 0], q: [1, 0, 0, 0] },
        sliceOn: true,
        sliceCenter: 0.2,
        sliceThickness: 0,
        sliceRelColor: false,
      },
    };
    const result = fromSnapshot(snapshot, initialState(true));
    expect("fourD" in result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Background — the scene backdrop. Omitted from the wire payload
// while pristine (dark, nothing authored) EXCEPT under the aerial render
// style, where an absent field is what a document predating the field looks
// like, and decodes through the legacy migration (aerial forced haze). See
// background.ts / decodeBackground's own doc comments.
// ---------------------------------------------------------------------------

describe("decodeScene background", () => {
  it("round-trips the haze mode", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      background: { mode: "haze" },
    };
    expect(decodeScene(encodeScene(s))!.background).toEqual({ mode: "haze" });
  });

  it("round-trips custom colors exactly, with no float rounding", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      background: {
        mode: "custom",
        custom: { top: [0.2, 0.4, 0.6], bottom: [0.8, 1, 0] },
      },
    };
    const result = decodeScene(encodeScene(s));
    expect(result!.background).toEqual({
      mode: "custom",
      custom: { top: [0.2, 0.4, 0.6], bottom: [0.8, 1, 0] },
    });
  });

  it("keeps the authored custom payload even while haze is selected", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      background: {
        mode: "haze",
        custom: { top: [0.2, 0.4, 0.6], bottom: [0.8, 1, 0] },
      },
    };
    const result = decodeScene(encodeScene(s));
    expect(result!.background).toEqual({
      mode: "haze",
      custom: { top: [0.2, 0.4, 0.6], bottom: [0.8, 1, 0] },
    });
  });

  it("round-trips the auto mode with no baked colors in the wire form", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      background: { mode: "auto" },
    };
    const payload = decodePayload(encodeScene(s));
    expect(payload.background).toEqual({ mode: "auto" });
    expect(decodeScene(encodeScene(s))!.background).toEqual({ mode: "auto" });
  });

  it("round-trips flame as the bare mode with no generated image state", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      background: { mode: "flame" },
    };

    const payload = decodePayload(encodeScene(s));

    expect(payload.background).toEqual({ mode: "flame" });
    expect(decodeScene(encodeScene(s))!.background).toEqual({ mode: "flame" });
  });

  it("round-trips a backdrop-owned Flame palette", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      background: { mode: "flame", flamePaletteId: "aurora" },
    };

    const encoded = encodeScene(s);

    expect(decodePayload(encoded).background).toEqual({
      mode: "flame",
      flamePaletteId: "aurora",
    });
    expect(decodeScene(encoded)!.background).toEqual(s.background);
  });

  it("keeps a non-default Flame palette dormant outside Flame backdrop mode", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      background: { mode: "haze", flamePaletteId: "ember" },
    };

    expect(decodeScene(encodeScene(s))!.background).toEqual(s.background);
  });

  it("omits the default Spectrum Flame palette from the background wire form", () => {
    const withExplicitDefault: SceneSnapshot = {
      ...baseSnapshot(),
      background: { mode: "flame", flamePaletteId: "spectrum" },
    };
    const withAbsentDefault: SceneSnapshot = {
      ...baseSnapshot(),
      background: { mode: "flame" },
    };

    expect(encodeScene(withExplicitDefault)).toBe(
      encodeScene(withAbsentDefault),
    );
    expect(decodePayload(encodeScene(withExplicitDefault)).background).toEqual({
      mode: "flame",
    });
  });

  it("round-trips a Custom Flame backdrop palette with its shared stops", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      background: { mode: "flame", flamePaletteId: "custom" },
      customPalette: {
        stops: [
          [0.2, 0.4, 0.6],
          [0.8, 1, 0],
        ],
      },
    };

    const result = decodeScene(encodeScene(s));

    expect(result!.background).toEqual(s.background);
    expect(result!.customPalette).toEqual(s.customPalette);
  });

  it("falls back to Spectrum shorthand for an unknown or payload-less Custom Flame backdrop palette", () => {
    for (const flamePaletteId of ["future-palette", "custom"]) {
      const raw = {
        ...baseSnapshot(),
        background: { mode: "flame", flamePaletteId },
      };

      const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));

      expect(result).not.toBeNull();
      expect(result!.background).toEqual({ mode: "flame" });
    }
  });

  it("keeps authored gradient slots dormant while flame is selected", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      background: {
        mode: "flame",
        custom: { top: [0.2, 0.4, 0.6], bottom: [0.8, 1, 0] },
        shape: "radial",
      },
    };

    const once = encodeScene(s);

    expect(decodePayload(once).background).toEqual({
      mode: "flame",
      top: "#336699",
      bottom: "#ccff00",
      shape: "radial",
    });
    expect(decodeScene(once)!.background).toEqual(s.background);
  });

  it("keeps the authored custom payload even while auto is selected", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      background: {
        mode: "auto",
        custom: { top: [1, 0, 0], bottom: [0, 0, 1] },
      },
    };
    const result = decodeScene(encodeScene(s));
    expect(result!.background).toEqual({
      mode: "auto",
      custom: { top: [1, 0, 0], bottom: [0, 0, 1] },
    });
  });

  it("omits the background key from the encoded payload for the pristine default", () => {
    const payload = decodePayload(encodeScene(baseSnapshot()));
    expect("background" in payload).toBe(false);
  });

  it("writes the pristine default explicitly under the aerial style, and round-trips it", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      renderStyle: "aerial",
      background: { mode: "dark" },
    };
    const payload = decodePayload(encodeScene(s));
    expect(payload.background).toEqual({ mode: "dark" });
    expect(decodeScene(encodeScene(s))!.background).toEqual({ mode: "dark" });
  });

  // ——— the pre-existing-document legacy migration ———

  it("decodes a document with no background key as dark under a non-aerial style", () => {
    const raw = { ...baseSnapshot() };
    delete (raw as Record<string, unknown>).background;
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result!.background).toEqual({ mode: "dark" });
  });

  it("decodes a document with no background key as haze under the aerial style", () => {
    const raw = { ...baseSnapshot(), renderStyle: "aerial" };
    delete (raw as Record<string, unknown>).background;
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result!.background).toEqual({ mode: "haze" });
  });

  it("falls back to dark for an unrecognized mode under a non-aerial style", () => {
    const raw = { ...baseSnapshot(), background: { mode: "nebula" } };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result!.background).toEqual({ mode: "dark" });
  });

  it("falls back to haze for an unrecognized mode under the aerial style", () => {
    const raw = {
      ...baseSnapshot(),
      renderStyle: "aerial",
      background: { mode: "nebula" },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result!.background).toEqual({ mode: "haze" });
  });

  it('decodes a wire-form "auto" mode with no payload as auto, not the legacy fallback', () => {
    const raw = { ...baseSnapshot(), background: { mode: "auto" } };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result!.background).toEqual({ mode: "auto" });
  });

  it("falls back to the legacy resolution for custom mode with no surviving payload", () => {
    const raw = { ...baseSnapshot(), background: { mode: "custom" } };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result!.background).toEqual({ mode: "dark" });
  });

  it("drops a malformed hex custom payload without rejecting the scene", () => {
    const raw = {
      ...baseSnapshot(),
      background: { mode: "haze", top: "#12", bottom: "#336699" },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.background).toEqual({ mode: "haze" });
  });

  it("drops a non-string hex value the same way", () => {
    const raw = {
      ...baseSnapshot(),
      background: { mode: "haze", top: 123, bottom: "#336699" },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.background).toEqual({ mode: "haze" });
  });

  it("falls back entirely for custom mode with a malformed hex payload", () => {
    const raw = {
      ...baseSnapshot(),
      background: { mode: "custom", top: "#12", bottom: "#336699" },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result!.background).toEqual({ mode: "dark" });
  });

  it("falls back without rejecting the scene when background is entirely the wrong type", () => {
    const raw = { ...baseSnapshot(), background: 42 };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.background).toEqual({ mode: "dark" });
    expect(result!.transforms).toHaveLength(1);
  });

  it("re-encodes to the identical string for a haze document", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      background: { mode: "haze" },
    };
    const once = encodeScene(s);
    expect(encodeScene(decodeScene(once)!)).toBe(once);
  });

  it("re-encodes to the identical string for a custom document", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      background: {
        mode: "custom",
        custom: { top: [0.2, 0.4, 0.6], bottom: [0.8, 1, 0] },
      },
    };
    const once = encodeScene(s);
    expect(encodeScene(decodeScene(once)!)).toBe(once);
  });
});

// ---------------------------------------------------------------------------
// Background shape: orthogonal to mode, absent means "linear".
// ---------------------------------------------------------------------------

describe("decodeScene background shape", () => {
  it("encodes byte-identically to a document predating the shape field when the shape is the default linear", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      background: { mode: "haze", shape: "linear" },
    };
    const withoutShape: SceneSnapshot = {
      ...baseSnapshot(),
      background: { mode: "haze" },
    };
    expect(encodeScene(s)).toBe(encodeScene(withoutShape));
  });

  it("round-trips the radial shape", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      background: { mode: "haze", shape: "radial" },
    };
    const result = decodeScene(encodeScene(s));
    expect(result!.background).toEqual({ mode: "haze", shape: "radial" });
  });

  it("writes the shape key alongside mode/custom", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      background: {
        mode: "custom",
        custom: { top: [0.2, 0.4, 0.6], bottom: [0.8, 1, 0] },
        shape: "radial",
      },
    };
    const payload = decodePayload(encodeScene(s));
    expect(payload.background).toEqual({
      mode: "custom",
      top: "#336699",
      bottom: "#ccff00",
      shape: "radial",
    });
  });

  it("omits shape from the encoded payload when it is the pristine linear default", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      background: { mode: "haze", shape: "linear" },
    };
    const payload = decodePayload(encodeScene(s));
    expect(payload.background).toEqual({ mode: "haze" });
  });

  it("falls back to linear for an unrecognized shape id", () => {
    const raw = {
      ...baseSnapshot(),
      background: { mode: "haze", shape: "swirl" },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result!.background).toEqual({ mode: "haze" });
  });

  it("falls back to linear when shape is entirely the wrong type", () => {
    const raw = {
      ...baseSnapshot(),
      background: { mode: "haze", shape: 42 },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result!.background).toEqual({ mode: "haze" });
  });

  it("decodes a document with no shape key as linear (the legacy migration)", () => {
    const raw = { ...baseSnapshot(), background: { mode: "haze" } };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result!.background).toEqual({ mode: "haze" });
  });
});

// ---------------------------------------------------------------------------
// Balloon palette — an independent document slot whose compact default is
// Inherit. Its Custom payload remains persisted even when dormant.
// ---------------------------------------------------------------------------

describe("decodeScene balloon palette", () => {
  it("omits the default selection from the wire and decodes absence to Inherit", () => {
    const payload = decodePayload(
      encodeScene({
        ...baseSnapshot(),
        balloonPaletteId: DEFAULT_BALLOON_PALETTE,
      }),
    );
    expect(payload).not.toHaveProperty("balloonPaletteId");

    const result = decodeScene("v1=" + b64url(JSON.stringify(baseSnapshot())));
    expect(result).not.toBeNull();
    expect(result!.balloonPaletteId).toBe(BALLOON_PALETTE_INHERIT);
  });

  it("round-trips a built-in balloon palette", () => {
    const result = decodeScene(
      encodeScene({ ...baseSnapshot(), balloonPaletteId: "aurora" }),
    );
    expect(result!.balloonPaletteId).toBe("aurora");
  });

  it("round-trips Custom only with its independent payload", () => {
    const snapshot: SceneSnapshot = {
      ...baseSnapshot(),
      balloonPaletteId: "custom",
      balloonCustomPalette: {
        stops: [
          [1, 0, 0],
          [0, 0, 1],
        ],
      },
    };
    const payload = decodePayload(encodeScene(snapshot));
    expect(payload.balloonPaletteId).toBe("custom");
    expect(payload.balloonCustomPalette).toEqual({
      stops: ["#ff0000", "#0000ff"],
    });

    const result = decodeScene(encodeScene(snapshot));
    expect(result!.balloonPaletteId).toBe("custom");
    expect(result!.balloonCustomPalette).toEqual(snapshot.balloonCustomPalette);
  });

  it("round-trips primary and balloon Custom payloads independently", () => {
    const snapshot: SceneSnapshot = {
      ...baseSnapshot(),
      customPalette: {
        stops: [
          [1, 1, 0],
          [0, 1, 0],
        ],
      },
      balloonPaletteId: "custom",
      balloonCustomPalette: {
        stops: [
          [1, 0, 1],
          [0, 1, 1],
        ],
      },
    };
    const result = decodeScene(encodeScene(snapshot));
    expect(result!.customPalette).toEqual(snapshot.customPalette);
    expect(result!.balloonCustomPalette).toEqual(snapshot.balloonCustomPalette);
  });

  it("preserves valid dormant balloon stops while omitting Inherit", () => {
    const snapshot: SceneSnapshot = {
      ...baseSnapshot(),
      balloonPaletteId: BALLOON_PALETTE_INHERIT,
      balloonCustomPalette: {
        stops: [
          [1, 0, 0],
          [0, 1, 0],
        ],
      },
    };
    const encoded = encodeScene(snapshot);
    const payload = decodePayload(encoded);
    expect(payload).not.toHaveProperty("balloonPaletteId");
    expect(payload.balloonCustomPalette).toEqual({
      stops: ["#ff0000", "#00ff00"],
    });

    const result = decodeScene(encoded);
    expect(result!.balloonPaletteId).toBe(BALLOON_PALETTE_INHERIT);
    expect(result!.balloonCustomPalette).toEqual(snapshot.balloonCustomPalette);
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["non-string", 42],
    ["unknown", "chartreuse"],
    ["primary legacy sentinel", "legacy"],
  ])("falls back to Inherit for a %s selection", (_label, selection) => {
    const raw = { ...baseSnapshot(), balloonPaletteId: selection };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.balloonPaletteId).toBe(BALLOON_PALETTE_INHERIT);
  });

  it("falls back to Inherit for Custom without a payload", () => {
    const raw = { ...baseSnapshot(), balloonPaletteId: "custom" };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result!.balloonPaletteId).toBe(BALLOON_PALETTE_INHERIT);
    expect(result!.balloonCustomPalette).toBeUndefined();
  });

  it("falls back to Inherit for Custom with a malformed payload", () => {
    const raw = {
      ...baseSnapshot(),
      balloonPaletteId: "custom",
      balloonCustomPalette: { stops: ["#ff0000", "not-a-color"] },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.balloonPaletteId).toBe(BALLOON_PALETTE_INHERIT);
    expect(result!.balloonCustomPalette).toBeUndefined();
  });

  it("keeps a valid built-in while quietly dropping a malformed dormant payload", () => {
    const raw = {
      ...baseSnapshot(),
      balloonPaletteId: "moss",
      balloonCustomPalette: { stops: ["#ff0000"] },
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.balloonPaletteId).toBe("moss");
    expect(result!.balloonCustomPalette).toBeUndefined();
  });
});

describe("toSnapshot / fromSnapshot balloon palette", () => {
  it("toSnapshot carries both the selection and independent payload", () => {
    const balloonCustomPalette = {
      stops: [
        [1, 0, 0],
        [0, 0, 1],
      ],
    } as const;
    const snapshot = toSnapshot({
      ...initialState(true),
      balloonPaletteId: "custom",
      balloonCustomPalette,
    });
    expect(snapshot.balloonPaletteId).toBe("custom");
    expect(snapshot.balloonCustomPalette).toBe(balloonCustomPalette);
  });

  it("legacy restore defaults to Inherit and clears a stale base payload", () => {
    const base: AppState = {
      ...initialState(true),
      balloonPaletteId: "custom",
      balloonCustomPalette: {
        stops: [
          [1, 0, 0],
          [0, 0, 1],
        ],
      },
    };
    const result = fromSnapshot(baseSnapshot(), base);
    expect(result.balloonPaletteId).toBe(BALLOON_PALETTE_INHERIT);
    expect(result.balloonCustomPalette).toBeUndefined();
  });

  it("lands both fields when the restored snapshot carries them", () => {
    const balloonCustomPalette = {
      stops: [
        [1, 0, 0],
        [0, 1, 0],
      ],
    } as const;
    const result = fromSnapshot(
      {
        ...baseSnapshot(),
        balloonPaletteId: "custom",
        balloonCustomPalette,
      },
      initialState(true),
    );
    expect(result.balloonPaletteId).toBe("custom");
    expect(result.balloonCustomPalette).toBe(balloonCustomPalette);
  });
});

// ---------------------------------------------------------------------------
// Balloon pair — the balloon echo/surface-balloon on-flag and its
// normalized radius, persisted since the balloon epic's "mode persists"
// acceptance. decodeScene follows camera/fourD's exact quiet-drop contract
// (malformed or absent drops ONLY the field to undefined, never the whole
// scene), but — unlike camera/fourD, which have no AppState counterpart at
// all — both fields DO have one, so fromSnapshot supplies a real default
// (false / DEFAULT_BALLOON_RADIUS) instead of merely clearing to undefined.
// ---------------------------------------------------------------------------

describe("decodeScene balloon", () => {
  it("round-trips the balloon pair, rounding the radius to 4 decimal places", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      balloonEcho: true,
      balloonRadius: 1.23456,
    };
    const result = decodeScene(encodeScene(s));
    expect(result!.balloonEcho).toBe(true);
    expect(result!.balloonRadius).toBeCloseTo(1.2346, 4);
  });

  it("round-trips balloonEcho false alongside the default radius", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      balloonEcho: false,
      balloonRadius: DEFAULT_BALLOON_RADIUS,
    };
    const result = decodeScene(encodeScene(s));
    expect(result!.balloonEcho).toBe(false);
    expect(result!.balloonRadius).toBe(DEFAULT_BALLOON_RADIUS);
  });

  it("keeps decoding a scene with no balloon fields at all as a valid, non-null scene", () => {
    // A hand-built payload with no balloonEcho/balloonRadius keys — what
    // every link predating the pair looks like.
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
    expect(result!.balloonEcho).toBeUndefined();
    expect(result!.balloonRadius).toBeUndefined();
  });

  it("drops balloonEcho when it is not a real boolean", () => {
    // Unlike showGuides/fourDDepthFade, balloonEcho does NOT coerce with
    // Boolean(x) — a truthy non-boolean must not silently turn it on.
    const raw = { ...baseSnapshot(), balloonEcho: "true" };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.balloonEcho).toBeUndefined();
  });

  it("drops balloonEcho when it is null", () => {
    const raw = { ...baseSnapshot(), balloonEcho: null };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.balloonEcho).toBeUndefined();
  });

  it("drops balloonRadius when it is non-finite", () => {
    const raw = { ...baseSnapshot(), balloonRadius: "not a number" };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.balloonRadius).toBeUndefined();
  });

  it("clamps balloonRadius below the minimum up to MIN_BALLOON_RADIUS", () => {
    const raw = { ...baseSnapshot(), balloonEcho: true, balloonRadius: -5 };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result!.balloonRadius).toBe(MIN_BALLOON_RADIUS);
  });

  it("clamps balloonRadius above the maximum down to MAX_BALLOON_RADIUS", () => {
    const raw = { ...baseSnapshot(), balloonEcho: true, balloonRadius: 50 };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result!.balloonRadius).toBe(MAX_BALLOON_RADIUS);
  });

  it("does not reject the whole scene over a malformed balloon pair", () => {
    const raw = { ...baseSnapshot(), balloonEcho: 42, balloonRadius: "nope" };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.transforms).toHaveLength(1);
    expect(result!.balloonEcho).toBeUndefined();
    expect(result!.balloonRadius).toBeUndefined();
  });
});

describe("toSnapshot / fromSnapshot balloon", () => {
  it("toSnapshot carries the balloon pair", () => {
    const state: AppState = {
      ...initialState(true),
      balloonEcho: true,
      balloonRadius: 2,
    };
    expect(toSnapshot(state).balloonEcho).toBe(true);
    expect(toSnapshot(state).balloonRadius).toBe(2);
  });

  it("fromSnapshot defaults balloonEcho/balloonRadius when the snapshot lacks them", () => {
    // baseSnapshot() carries neither key at all — what a snapshot predating
    // the pair (or a decode of one) looks like — so this also pins that
    // fromSnapshot supplies the real default rather than merely clearing.
    const base: AppState = {
      ...initialState(true),
      balloonEcho: true,
      balloonRadius: 2,
    };
    const result = fromSnapshot(baseSnapshot(), base);
    expect(result.balloonEcho).toBe(false);
    expect(result.balloonRadius).toBe(DEFAULT_BALLOON_RADIUS);
  });

  it("fromSnapshot lands the balloon pair on the state when the snapshot carries it", () => {
    const snapshot: SceneSnapshot = {
      ...baseSnapshot(),
      balloonEcho: true,
      balloonRadius: 2,
    };
    const result = fromSnapshot(snapshot, initialState(true));
    expect(result.balloonEcho).toBe(true);
    expect(result.balloonRadius).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Balloon tint — persisted alongside the balloon pair the
// identical way: optional on SceneSnapshot, always written by
// toSnapshot/encodeScene, quiet-drop/clamp on decode, with fromSnapshot
// supplying the real defaults.
// ---------------------------------------------------------------------------

describe("decodeScene balloon tint", () => {
  it("round-trips balloonTint and rounds balloonTintStrength to 4 decimal places", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      balloonTint: "#336699",
      balloonTintStrength: 0.123456,
    };
    const result = decodeScene(encodeScene(s));
    expect(result!.balloonTint).toBe("#336699");
    expect(result!.balloonTintStrength).toBeCloseTo(0.1235, 4);
  });

  it("keeps decoding a scene with no balloon tint fields at all as a valid, non-null scene", () => {
    // A hand-built payload with no balloonTint/balloonTintStrength keys —
    // what every link predating the tint pair looks like.
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
    expect(result!.balloonTint).toBeUndefined();
    expect(result!.balloonTintStrength).toBeUndefined();
  });

  it("drops balloonTint when it is not a string", () => {
    const raw = { ...baseSnapshot(), balloonTint: 12345 };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.balloonTint).toBeUndefined();
  });

  it("drops balloonTint when it does not match the #rrggbb hex pattern", () => {
    const raw = { ...baseSnapshot(), balloonTint: "not-a-color" };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.balloonTint).toBeUndefined();
  });

  it("accepts an uppercase hex balloonTint verbatim (decode does not normalize case)", () => {
    const raw = { ...baseSnapshot(), balloonTint: "#AABBCC" };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result!.balloonTint).toBe("#AABBCC");
  });

  it("drops balloonTintStrength when it is non-finite", () => {
    const raw = { ...baseSnapshot(), balloonTintStrength: "not a number" };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.balloonTintStrength).toBeUndefined();
  });

  it("clamps balloonTintStrength below the minimum up to MIN_BALLOON_TINT_STRENGTH", () => {
    const raw = { ...baseSnapshot(), balloonTintStrength: -5 };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result!.balloonTintStrength).toBe(MIN_BALLOON_TINT_STRENGTH);
  });

  it("clamps balloonTintStrength above the maximum down to MAX_BALLOON_TINT_STRENGTH", () => {
    const raw = { ...baseSnapshot(), balloonTintStrength: 50 };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result!.balloonTintStrength).toBe(MAX_BALLOON_TINT_STRENGTH);
  });

  it("does not reject the whole scene over a malformed balloon tint pair", () => {
    const raw = {
      ...baseSnapshot(),
      balloonTint: "nope",
      balloonTintStrength: "nope",
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.transforms).toHaveLength(1);
    expect(result!.balloonTint).toBeUndefined();
    expect(result!.balloonTintStrength).toBeUndefined();
  });
});

describe("toSnapshot / fromSnapshot balloon tint", () => {
  it("toSnapshot carries balloonTint and balloonTintStrength", () => {
    const state: AppState = {
      ...initialState(true),
      balloonTint: "#336699",
      balloonTintStrength: 0.5,
    };
    expect(toSnapshot(state).balloonTint).toBe("#336699");
    expect(toSnapshot(state).balloonTintStrength).toBe(0.5);
  });

  it("fromSnapshot defaults the balloon tint pair when the snapshot lacks it", () => {
    // baseSnapshot() carries no balloonTint/balloonTintStrength keys at
    // all — what a snapshot predating the tint pair (or a decode of one)
    // looks like.
    const base: AppState = {
      ...initialState(true),
      balloonTint: "#336699",
      balloonTintStrength: 0.5,
    };
    const result = fromSnapshot(baseSnapshot(), base);
    expect(result.balloonTint).toBe(DEFAULT_BALLOON_TINT);
    expect(result.balloonTintStrength).toBe(DEFAULT_BALLOON_TINT_STRENGTH);
  });

  it("fromSnapshot lands the balloon tint pair on the state when the snapshot carries it", () => {
    const snapshot: SceneSnapshot = {
      ...baseSnapshot(),
      balloonTint: "#336699",
      balloonTintStrength: 0.5,
    };
    const result = fromSnapshot(snapshot, initialState(true));
    expect(result.balloonTint).toBe("#336699");
    expect(result.balloonTintStrength).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// Fog density — persisted alongside the balloon pair the identical
// way: optional on SceneSnapshot, always written by toSnapshot/encodeScene,
// quiet-drop/clamp on decode, with fromSnapshot supplying the real default.
// ---------------------------------------------------------------------------

describe("decodeScene fog", () => {
  it("round-trips fogDensity, rounding to 4 decimal places", () => {
    const s: SceneSnapshot = { ...baseSnapshot(), fogDensity: 1.23456 };
    const result = decodeScene(encodeScene(s));
    expect(result!.fogDensity).toBeCloseTo(1.2346, 4);
  });

  it("keeps decoding a scene with no fogDensity field at all as a valid, non-null scene", () => {
    // A hand-built payload with no fogDensity key — what every link
    // predating the fog controls looks like.
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
    expect(result!.fogDensity).toBeUndefined();
  });

  it("drops fogDensity when it is non-finite", () => {
    const raw = { ...baseSnapshot(), fogDensity: "not a number" };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.fogDensity).toBeUndefined();
  });

  it("clamps fogDensity below the minimum up to MIN_FOG_DENSITY", () => {
    const raw = { ...baseSnapshot(), fogDensity: -5 };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result!.fogDensity).toBe(MIN_FOG_DENSITY);
  });

  it("clamps fogDensity above the maximum down to MAX_FOG_DENSITY", () => {
    const raw = { ...baseSnapshot(), fogDensity: 50 };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result!.fogDensity).toBe(MAX_FOG_DENSITY);
  });

  it("does not reject the whole scene over a malformed fogDensity", () => {
    const raw = { ...baseSnapshot(), fogDensity: "nope" };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.transforms).toHaveLength(1);
    expect(result!.fogDensity).toBeUndefined();
  });
});

describe("toSnapshot / fromSnapshot fog", () => {
  it("toSnapshot carries fogDensity", () => {
    const state: AppState = { ...initialState(true), fogDensity: 0.5 };
    expect(toSnapshot(state).fogDensity).toBe(0.5);
  });

  it("fromSnapshot defaults fogDensity when the snapshot lacks it", () => {
    // baseSnapshot() carries no fogDensity key at all — what a snapshot
    // predating the fog controls (or a decode of one) looks like — so this
    // also pins that fromSnapshot supplies the real default rather than
    // merely clearing.
    const base: AppState = { ...initialState(true), fogDensity: 0.5 };
    const result = fromSnapshot(baseSnapshot(), base);
    expect(result.fogDensity).toBe(DEFAULT_FOG_DENSITY);
  });

  it("fromSnapshot lands fogDensity on the state when the snapshot carries it", () => {
    const snapshot: SceneSnapshot = { ...baseSnapshot(), fogDensity: 0.5 };
    const result = fromSnapshot(snapshot, initialState(true));
    expect(result.fogDensity).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// Fog tint — persisted alongside fogDensity the identical way:
// optional on SceneSnapshot, always written by toSnapshot/encodeScene,
// quiet-drop/clamp on decode, with fromSnapshot supplying the real defaults.
// ---------------------------------------------------------------------------

describe("decodeScene fog tint", () => {
  it("round-trips fogTint and rounds fogTintStrength to 4 decimal places", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      fogTint: "#336699",
      fogTintStrength: 0.123456,
    };
    const result = decodeScene(encodeScene(s));
    expect(result!.fogTint).toBe("#336699");
    expect(result!.fogTintStrength).toBeCloseTo(0.1235, 4);
  });

  it("keeps decoding a scene with no fog tint fields at all as a valid, non-null scene", () => {
    // A hand-built payload with no fogTint/fogTintStrength keys — what
    // every link predating the fog controls looks like.
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
    expect(result!.fogTint).toBeUndefined();
    expect(result!.fogTintStrength).toBeUndefined();
  });

  it("drops fogTint when it is not a string", () => {
    const raw = { ...baseSnapshot(), fogTint: 12345 };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.fogTint).toBeUndefined();
  });

  it("drops fogTint when it does not match the #rrggbb hex pattern", () => {
    const raw = { ...baseSnapshot(), fogTint: "not-a-color" };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.fogTint).toBeUndefined();
  });

  it("accepts an uppercase hex fogTint verbatim (decode does not normalize case)", () => {
    const raw = { ...baseSnapshot(), fogTint: "#AABBCC" };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result!.fogTint).toBe("#AABBCC");
  });

  it("drops fogTintStrength when it is non-finite", () => {
    const raw = { ...baseSnapshot(), fogTintStrength: "not a number" };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.fogTintStrength).toBeUndefined();
  });

  it("clamps fogTintStrength below the minimum up to MIN_FOG_TINT_STRENGTH", () => {
    const raw = { ...baseSnapshot(), fogTintStrength: -5 };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result!.fogTintStrength).toBe(MIN_FOG_TINT_STRENGTH);
  });

  it("clamps fogTintStrength above the maximum down to MAX_FOG_TINT_STRENGTH", () => {
    const raw = { ...baseSnapshot(), fogTintStrength: 50 };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result!.fogTintStrength).toBe(MAX_FOG_TINT_STRENGTH);
  });

  it("does not reject the whole scene over a malformed fog tint pair", () => {
    const raw = {
      ...baseSnapshot(),
      fogTint: "nope",
      fogTintStrength: "nope",
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.transforms).toHaveLength(1);
    expect(result!.fogTint).toBeUndefined();
    expect(result!.fogTintStrength).toBeUndefined();
  });
});

describe("toSnapshot / fromSnapshot fog tint", () => {
  it("toSnapshot carries fogTint and fogTintStrength", () => {
    const state: AppState = {
      ...initialState(true),
      fogTint: "#336699",
      fogTintStrength: 0.5,
    };
    expect(toSnapshot(state).fogTint).toBe("#336699");
    expect(toSnapshot(state).fogTintStrength).toBe(0.5);
  });

  it("fromSnapshot defaults the fog tint pair when the snapshot lacks it", () => {
    // baseSnapshot() carries no fogTint/fogTintStrength keys at all — what
    // a snapshot predating the fog controls (or a decode of one) looks like.
    const base: AppState = {
      ...initialState(true),
      fogTint: "#336699",
      fogTintStrength: 0.5,
    };
    const result = fromSnapshot(baseSnapshot(), base);
    expect(result.fogTint).toBe(DEFAULT_FOG_TINT);
    expect(result.fogTintStrength).toBe(DEFAULT_FOG_TINT_STRENGTH);
  });

  it("fromSnapshot lands the fog tint pair on the state when the snapshot carries it", () => {
    const snapshot: SceneSnapshot = {
      ...baseSnapshot(),
      fogTint: "#336699",
      fogTintStrength: 0.5,
    };
    const result = fromSnapshot(snapshot, initialState(true));
    expect(result.fogTint).toBe("#336699");
    expect(result.fogTintStrength).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// Ground plane — persisted alongside the balloon pair the
// identical way: optional on SceneSnapshot, always written by
// toSnapshot/encodeScene, quiet-drop on decode (no clamping — a plain
// boolean, not a PARAM-backed numeric like balloonRadius), with
// fromSnapshot supplying the real default (`false`).
// ---------------------------------------------------------------------------

describe("decodeScene ground plane", () => {
  it.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ] as const)(
    "round-trips Balloon=%s and Floor=%s as independent flags",
    (balloonEcho, groundPlane) => {
      const result = decodeScene(
        encodeScene({
          ...baseSnapshot(),
          balloonEcho,
          groundPlane,
        }),
      );
      expect(result!.balloonEcho).toBe(balloonEcho);
      expect(result!.groundPlane).toBe(groundPlane);
    },
  );

  it("round-trips groundPlane true", () => {
    const s: SceneSnapshot = { ...baseSnapshot(), groundPlane: true };
    const result = decodeScene(encodeScene(s));
    expect(result!.groundPlane).toBe(true);
  });

  it("round-trips groundPlane false", () => {
    const s: SceneSnapshot = { ...baseSnapshot(), groundPlane: false };
    const result = decodeScene(encodeScene(s));
    expect(result!.groundPlane).toBe(false);
  });

  it("keeps decoding a scene with no groundPlane field at all as a valid, non-null scene", () => {
    // A hand-built payload with no groundPlane key — what every link
    // predating the ground plane looks like.
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
    expect(result!.groundPlane).toBeUndefined();
  });

  it("drops groundPlane when it is not a real boolean", () => {
    // Unlike showGuides/fourDDepthFade, groundPlane does NOT coerce with
    // Boolean(x) — a truthy non-boolean must not silently turn it on.
    const raw = { ...baseSnapshot(), groundPlane: "true" };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.groundPlane).toBeUndefined();
  });

  it("does not reject the whole scene over a malformed groundPlane", () => {
    const raw = { ...baseSnapshot(), groundPlane: 42 };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(result).not.toBeNull();
    expect(result!.transforms).toHaveLength(1);
    expect(result!.groundPlane).toBeUndefined();
  });
});

describe("toSnapshot / fromSnapshot ground plane", () => {
  it("toSnapshot carries groundPlane", () => {
    const state: AppState = { ...initialState(true), groundPlane: true };
    expect(toSnapshot(state).groundPlane).toBe(true);
  });

  it("fromSnapshot defaults groundPlane to false when the snapshot lacks it", () => {
    // baseSnapshot() carries no groundPlane key at all — what a snapshot
    // predating the ground plane (or a decode of one) looks like.
    const base: AppState = { ...initialState(true), groundPlane: true };
    const result = fromSnapshot(baseSnapshot(), base);
    expect(result.groundPlane).toBe(false);
  });

  it("fromSnapshot lands groundPlane on the state when the snapshot carries it", () => {
    const snapshot: SceneSnapshot = { ...baseSnapshot(), groundPlane: true };
    const result = fromSnapshot(snapshot, initialState(true));
    expect(result.groundPlane).toBe(true);
  });
});

describe("decodeScene transform chaos rows", () => {
  function chiTransforms(): SceneSnapshot["transforms"] {
    return [0, 1, 2].map((id) => ({
      id,
      position: [0.2 * id, 0, 0] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      scale: [0.5, 0.5, 0.5] as [number, number, number],
    }));
  }

  /** Encode a valid 3-map scene, splice `chaos` RAW into transform 0's wire
   * form, and decode — the untrusted-input door the quiet-drop rules guard. */
  function decodeWithRawChaos(chaos: unknown): SceneSnapshot | null {
    const s: SceneSnapshot = { ...baseSnapshot(), transforms: chiTransforms() };
    const encoded = encodeScene(s);
    const b64 = encoded
      .slice("v1=".length)
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const json = JSON.parse(atob(padded)) as {
      transforms: Record<string, unknown>[];
    };
    json.transforms[0].chaos = chaos;
    return decodeScene("v1=" + b64url(JSON.stringify(json)));
  }

  it("round-trips a non-trivial row verbatim — zeros, >1 scales, and out-of-domain negatives included", () => {
    const transforms = chiTransforms();
    transforms[0] = { ...transforms[0], chaos: [1, 0, 2.5] };
    const s: SceneSnapshot = { ...baseSnapshot(), transforms };
    const result = decodeScene(encodeScene(s));
    expect(result!.transforms[0].chaos).toEqual([1, 0, 2.5]);
    expect(result!.transforms[1].chaos).toBeUndefined();
  });

  it("drops trivial rows at encode — explicit all-1s, and all-1s-by-padding/truncation", () => {
    const transforms = chiTransforms();
    transforms[0] = { ...transforms[0], chaos: [1, 1, 1] };
    transforms[1] = { ...transforms[1], chaos: [1, 1] };
    // Trivial at the base count 3 — the deviation sits past it (truncated).
    transforms[2] = { ...transforms[2], chaos: [1, 1, 1, 9] };
    const s: SceneSnapshot = { ...baseSnapshot(), transforms };
    const result = decodeScene(encodeScene(s));
    expect(result!.transforms[0].chaos).toBeUndefined();
    expect(result!.transforms[1].chaos).toBeUndefined();
    expect(result!.transforms[2].chaos).toBeUndefined();
    // And byte-identity: the encoded string equals a never-authored scene's.
    expect(encodeScene(s)).toBe(
      encodeScene({ ...baseSnapshot(), transforms: chiTransforms() }),
    );
  });

  it("never encodes a chaos row on the final transform (a lens sits outside selection)", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      transforms: chiTransforms(),
      finalTransform: {
        id: 0,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        chaos: [0, 2, 0],
      },
    };
    const result = decodeScene(encodeScene(s));
    expect(result!.finalTransform!.chaos).toBeUndefined();
  });

  it("decodes only whole well-formed rows — a malformed entry or shape quietly drops the row, never the scene", () => {
    // A numeric string must NOT coerce (the fold-length rule), and one bad
    // entry drops the WHOLE row — a row is one distribution.
    expect(
      decodeWithRawChaos([1, "0.5", 1])!.transforms[0].chaos,
    ).toBeUndefined();
    expect(
      decodeWithRawChaos([1, null, 1])!.transforms[0].chaos,
    ).toBeUndefined();
    expect(
      decodeWithRawChaos([1, true, 1])!.transforms[0].chaos,
    ).toBeUndefined();
    expect(decodeWithRawChaos({ 0: 1 })!.transforms[0].chaos).toBeUndefined();
    expect(decodeWithRawChaos("1 1 1")!.transforms[0].chaos).toBeUndefined();
    // An untrusted array longer than MAX_TRANSFORMS can never mean anything
    // — dropped whole rather than carried verbatim.
    expect(
      decodeWithRawChaos(new Array(MAX_TRANSFORMS + 1).fill(1.5))!.transforms[0]
        .chaos,
    ).toBeUndefined();
    // A well-formed but out-of-domain row survives untouched — no clamp,
    // fidelity at the leaf (the domain lives in resolveChaosEntry).
    expect(decodeWithRawChaos([-1, 1, 1])!.transforms[0].chaos).toEqual([
      -1, 1, 1,
    ]);
  });
});

describe("decodeScene / encodeScene schedule (scheduled-hybrid block)", () => {
  function scheduled(): SceneSnapshot {
    return {
      ...baseSnapshot(),
      schedule: {
        transforms: [
          {
            id: 0,
            position: [-0.5, 0, 0],
            rotation: [0, 0, 0],
            scale: [0.5, 0.5, 0.5],
          },
          {
            id: 1,
            position: [0.5, 0.25, 0],
            rotation: [0, 0, 0.4],
            scale: [0.5, 0.5, 0.5],
            shear: [0.1, 0, 0],
            weight: 3,
          },
        ],
        depth: 3,
      },
    };
  }

  it("round-trips a live block both ways (affine fields, weight, shear, depth)", () => {
    const result = decodeScene(encodeScene(scheduled()));
    expect(result).not.toBeNull();
    const schedule = result!.schedule!;
    expect(schedule.depth).toBe(3);
    expect(schedule.transforms).toHaveLength(2);
    expect(schedule.transforms[0]).toEqual({
      id: 0,
      position: [-0.5, 0, 0],
      rotation: [0, 0, 0],
      scale: [0.5, 0.5, 0.5],
    });
    expect(schedule.transforms[1]).toEqual({
      id: 1,
      position: [0.5, 0.25, 0],
      rotation: [0, 0, 0.4],
      scale: [0.5, 0.5, 0.5],
      shear: [0.1, 0, 0],
      weight: 3,
    });
    // A second trip is a fixed point (round4 already applied).
    expect(encodeScene(result!)).toBe(encodeScene(scheduled()));
  });

  it("an unauthored scene's encoding is byte-identical to one predating the field", () => {
    const withoutKey = encodeScene(baseSnapshot());
    expect(encodeScene({ ...baseSnapshot(), schedule: undefined })).toBe(
      withoutKey,
    );
    // A dead block (depth 0) never reaches the wire either.
    expect(
      encodeScene({
        ...baseSnapshot(),
        schedule: { transforms: scheduled().schedule!.transforms, depth: 0 },
      }),
    ).toBe(withoutKey);
    // And a decoded unauthored scene carries no block.
    expect(decodeScene(withoutKey)!.schedule).toBeUndefined();
  });

  it("drops the WHOLE block (never the scene) on malformed input — no coercion anywhere", () => {
    const base = JSON.parse(
      Buffer.from(
        encodeScene(scheduled()).slice(3).replace(/-/g, "+").replace(/_/g, "/"),
        "base64",
      ).toString(),
    ) as Record<string, unknown>;
    const rehash = (payload: unknown): string =>
      "v1=" +
      Buffer.from(JSON.stringify(payload))
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");
    const withSchedule = (schedule: unknown): string =>
      rehash({ ...base, schedule });

    const good = base.schedule as {
      transforms: Record<string, unknown>[];
      depth: number;
    };

    // Malformed shapes: block dropped, scene survives.
    for (const bad of [
      "3-deep",
      [good],
      { ...good, depth: "3" },
      { ...good, depth: Number.NaN },
      { ...good, depth: 0 },
      { ...good, transforms: [] },
      { ...good, transforms: "sponge" },
      {
        ...good,
        transforms: [{ ...good.transforms[0], position: [1, 2] }],
      },
      {
        ...good,
        transforms: [{ ...good.transforms[0], weight: "3" }],
      },
      {
        ...good,
        transforms: [{ ...good.transforms[0], shear: [1, "0", 0] }],
      },
    ]) {
      const result = decodeScene(withSchedule(bad));
      expect(result).not.toBeNull();
      expect(result!.schedule).toBeUndefined();
    }
  });

  it("clamps depth into 1..MAX_SCHEDULE_DEPTH and weight into the main list's band; ignores non-affine fields", () => {
    const base = JSON.parse(
      Buffer.from(
        encodeScene(scheduled()).slice(3).replace(/-/g, "+").replace(/_/g, "/"),
        "base64",
      ).toString(),
    ) as Record<string, unknown>;
    const rehash = (payload: unknown): string =>
      "v1=" +
      Buffer.from(JSON.stringify(payload))
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");
    const good = base.schedule as {
      transforms: Record<string, unknown>[];
      depth: number;
    };

    const clamped = decodeScene(
      rehash({ ...base, schedule: { ...good, depth: 99 } }),
    )!.schedule!;
    expect(clamped.depth).toBe(MAX_SCHEDULE_DEPTH);
    expect(
      decodeScene(rehash({ ...base, schedule: { ...good, depth: 2.9 } }))!
        .schedule!.depth,
    ).toBe(2);

    const smuggled = decodeScene(
      rehash({
        ...base,
        schedule: {
          depth: 2,
          transforms: [
            {
              position: [0, 0, 0],
              rotation: [0, 0, 0],
              scale: [0.5, 0.5, 0.5],
              weight: 1e9,
              variations: [{ type: "julia", weight: 1 }],
              w: { position: 0.5 },
              chaos: [0, 1],
            },
          ],
        },
      }),
    )!.schedule!;
    // The affine-only leg REBUILDS entries: nothing but the admitted
    // fields survives, and the weight clamps like the main list's.
    expect(smuggled.transforms[0]).toEqual({
      id: 0,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [0.5, 0.5, 0.5],
      weight: 10000,
    });
  });
});

describe("condensationDepthBand codec", () => {
  it("round-trips a normalized inclusive band and keeps the classic range byte-identically absent", () => {
    const base = encodeScene(baseSnapshot());
    const encoded = encodeScene({
      ...baseSnapshot(),
      condensationDepthBand: { minDepth: 5.9, maxDepth: 2.2 },
    });
    expect(decodeScene(encoded)!.condensationDepthBand).toEqual({
      minDepth: 2,
      maxDepth: 5,
    });
    expect(
      encodeScene({
        ...baseSnapshot(),
        condensationDepthBand: { minDepth: 0 },
      }),
    ).toBe(base);
    expect(decodeScene(base)!.condensationDepthBand).toBeUndefined();
  });

  it("quietly drops malformed endpoint leaves without rejecting the scene", () => {
    const raw = JSON.parse(
      Buffer.from(
        encodeScene(baseSnapshot())
          .slice(3)
          .replace(/-/g, "+")
          .replace(/_/g, "/"),
        "base64",
      ).toString(),
    ) as Record<string, unknown>;
    raw.condensationDepthBand = { minDepth: "2", maxDepth: 5 };
    const encoded =
      "v1=" +
      Buffer.from(JSON.stringify(raw))
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");
    const decoded = decodeScene(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded!.condensationDepthBand).toBeUndefined();
  });
});

describe("decodeScene transform shape emitters", () => {
  const GEAR: ShapeSpec = {
    parts: [
      {
        primitive: {
          kind: "gear",
          teeth: 8,
          radius: 1,
          tooth: [0.22, 0.16],
          hole: 0.35,
          halfHeight: 0.25,
        },
        combine: "union",
        pose: { offset: [0.1, -0.2, 0], rotate: [0.5, 0, 0.25], scale: 0.5 },
      },
      { primitive: { kind: "sphere", radius: 0.4 }, combine: "union" },
    ],
  };
  const BUNDLED_MESHES = [
    ["star", "star-prism-v1", STAR_PRISM_SHAPE],
    ["faceted-crystal", "faceted-crystal-v1", FACETED_CRYSTAL_SHAPE],
    ["heart-prism", "heart-prism-v1", HEART_PRISM_SHAPE],
    ["crescent-moon", "crescent-moon-v1", CRESCENT_MOON_SHAPE],
    ["snowflake-prism", "snowflake-prism-v1", SNOWFLAKE_PRISM_SHAPE],
    ["trefoil-knot", "trefoil-knot-v1", TREFOIL_KNOT_SHAPE],
  ] as const;
  const COMPACT_ANALYTIC_SHAPES: [string, ShapeSpec, unknown][] = [
    [
      "sphere",
      {
        parts: [
          {
            primitive: { kind: "sphere", radius: 0.7312 },
            combine: "union",
          },
        ],
      },
      ["s", 0.7312],
    ],
    [
      "box",
      {
        parts: [
          {
            primitive: { kind: "box", half: [0.7, 0.5, 0.3] },
            combine: "union",
          },
        ],
      },
      ["b", 0.7, 0.5, 0.3],
    ],
    [
      "torus",
      {
        parts: [
          {
            primitive: { kind: "torus", major: 0.78, minor: 0.26 },
            combine: "union",
          },
        ],
      },
      ["t", 0.78, 0.26],
    ],
    [
      "capsule",
      {
        parts: [
          {
            primitive: {
              kind: "capsule",
              a: [-0.5, 0, 0],
              b: [0.5, 0, 0],
              radius: 0.2,
            },
            combine: "union",
          },
        ],
      },
      ["c", -0.5, 0, 0, 0.5, 0, 0, 0.2],
    ],
    [
      "gear",
      {
        parts: [
          {
            primitive: {
              kind: "gear",
              teeth: 8,
              radius: 1,
              tooth: [0.22, 0.16],
              hole: 0.35,
              halfHeight: 0.25,
            },
            combine: "union",
          },
        ],
      },
      ["g", 8, 1, 0.22, 0.16, 0.35, 0.25],
    ],
  ];

  it("round-trips an authored emitter spec exactly (4-decimal values)", () => {
    const s = baseSnapshot();
    s.transforms[0] = { ...s.transforms[0], emitter: GEAR };
    const result = decodeScene(encodeScene(s));
    expect(result!.transforms[0].emitter).toEqual(GEAR);
    const wire = (
      decodePayload(encodeScene(s)).transforms as Record<string, unknown>[]
    )[0].emitter;
    expect(wire).toEqual(GEAR);
    expect(Array.isArray(wire)).toBe(false);
  });

  it.each(COMPACT_ANALYTIC_SHAPES)(
    "encodes and round-trips a single %s union as its compact tuple",
    (_kind, shape, expectedWire) => {
      const s = baseSnapshot();
      s.transforms[0] = { ...s.transforms[0], emitter: shape };
      const encoded = encodeScene(s);
      const wire = (
        decodePayload(encoded).transforms as Record<string, unknown>[]
      )[0].emitter;

      expect(wire).toEqual(expectedWire);
      expect(decodeScene(encoded)!.transforms[0].emitter).toEqual(shape);
    },
  );

  it("keeps a valid gear sector boundary valid after compact round4", () => {
    const radius = 1.00004;
    const teeth = 8;
    const tangential = radius * Math.sin(Math.PI / teeth);
    const s = baseSnapshot();
    s.transforms[0] = {
      ...s.transforms[0],
      emitter: {
        parts: [
          {
            primitive: {
              kind: "gear",
              teeth,
              radius,
              tooth: [0.22, tangential],
              hole: 0.35,
              halfHeight: 0.25,
            },
            combine: "union",
          },
        ],
      },
    };

    const encoded = encodeScene(s);
    const wire = (
      decodePayload(encoded).transforms as Record<string, unknown>[]
    )[0].emitter;
    expect(wire).toEqual(["g", 8, 1, 0.22, 0.3826, 0.35, 0.25]);

    const primitive =
      decodeScene(encoded)!.transforms[0].emitter!.parts[0].primitive;
    if (primitive.kind !== "gear") throw new Error("expected gear");
    expect(primitive.tooth[1]).toBeLessThanOrEqual(
      primitive.radius * Math.sin(Math.PI / primitive.teeth),
    );
  });

  it("does not sector-clamp an already-invalid imported gear", () => {
    const radius = 1.00004;
    const teeth = 8;
    const tangential = radius * Math.sin(Math.PI / teeth) + 0.00001;
    const s = baseSnapshot();
    s.transforms[0] = {
      ...s.transforms[0],
      emitter: {
        parts: [
          {
            primitive: {
              kind: "gear",
              teeth,
              radius,
              tooth: [0.22, tangential],
              hole: 0.35,
              halfHeight: 0.25,
            },
            combine: "union",
          },
        ],
      },
    };

    const encoded = encodeScene(s);
    const wire = (
      decodePayload(encoded).transforms as Record<string, unknown>[]
    )[0].emitter;
    expect(wire).toEqual(["g", 8, 1, 0.22, 0.3827, 0.35, 0.25]);
  });

  it("rounds and round-trips the compact part pose without materializing absent keys", () => {
    const s = baseSnapshot();
    s.transforms[0] = {
      ...s.transforms[0],
      emitter: {
        parts: [
          {
            primitive: { kind: "sphere", radius: 0.123456 },
            combine: "union",
            pose: {
              offset: [0.123456, -0.2, 0],
              rotate: [0.5, 0, 0.250067],
              scale: 0.500067,
            },
          },
        ],
      },
    };

    const encoded = encodeScene(s);
    const wire = (
      decodePayload(encoded).transforms as Record<string, unknown>[]
    )[0].emitter;
    expect(wire).toEqual([
      "s",
      0.1235,
      { o: [0.1235, -0.2, 0], r: [0.5, 0, 0.2501], s: 0.5001 },
    ]);
    expect(decodeScene(encoded)!.transforms[0].emitter).toEqual({
      parts: [
        {
          primitive: { kind: "sphere", radius: 0.1235 },
          combine: "union",
          pose: {
            offset: [0.1235, -0.2, 0],
            rotate: [0.5, 0, 0.2501],
            scale: 0.5001,
          },
        },
      ],
    });
  });

  it("decodes a legacy single-part object and preserves its authored spec when canonicalizing compactly", () => {
    const authored: ShapeSpec = {
      parts: [
        {
          primitive: { kind: "sphere", radius: 0.7312 },
          combine: "union",
          pose: { scale: 0.8 },
        },
      ],
    };
    const raw = JSON.parse(JSON.stringify(baseSnapshot())) as Record<
      string,
      unknown
    >;
    (raw.transforms as Record<string, unknown>[])[0].emitter = authored;

    const decoded = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    expect(decoded!.transforms[0].emitter).toEqual(authored);
    const canonical = (
      decodePayload(encodeScene(decoded!)).transforms as Record<
        string,
        unknown
      >[]
    )[0].emitter;
    expect(canonical).toEqual(["s", 0.7312, { s: 0.8 }]);
  });

  it("shares Orbit Ring and Peace without persisting catalog kinds", () => {
    for (const [kind, shape] of [
      ["orbit-ring", ORBIT_RING_SHAPE],
      ["peace", PEACE_SIGN_SHAPE],
    ] as const) {
      const s = baseSnapshot();
      s.transforms[0] = { ...s.transforms[0], emitter: shape };
      const encoded = encodeScene(s);
      const decoded = decodeScene(encoded)!.transforms[0].emitter!;
      expect(bundledEmitterForShape(decoded)?.kind).toBe(kind);

      const wireEmitter = (
        decodePayload(encoded).transforms as Record<string, unknown>[]
      )[0].emitter;
      const wireText = JSON.stringify(wireEmitter);
      expect(wireText).not.toContain("orbit-ring");
      expect(wireText).not.toContain('"kind":"peace"');
      if (kind === "orbit-ring") {
        expect(wireEmitter).toEqual(["t", 0.78, 0.26]);
      } else {
        expect(decoded.parts[2].primitive).toMatchObject({
          kind: "capsule",
          b: [-0.7071, -0.7071, 0],
        });
      }
    }
  });

  it.each(BUNDLED_MESHES)(
    "round-trips the %s mesh by stable id without asset data on the v1 wire",
    (kind, meshId, shape) => {
      const s = baseSnapshot();
      s.transforms[0] = { ...s.transforms[0], emitter: shape };
      const encoded = encodeScene(s);
      const decoded = decodeScene(encoded)!.transforms[0].emitter!;
      expect(decoded).toEqual(shape);
      expect(bundledEmitterForShape(decoded)?.kind).toBe(kind);

      const payload = decodePayload(encoded);
      const wireEmitter = (payload.transforms as Record<string, unknown>[])[0]
        .emitter;
      expect(wireEmitter).toEqual(shape);
      // Exact wire bytes remain one catalog id, never triangles, a sampling
      // table, a catalog index, or the baked SDF texture.
      expect(JSON.stringify(wireEmitter)).toBe(
        `{"parts":[{"primitive":{"kind":"mesh","meshId":"${meshId}"},"combine":"union"}]}`,
      );
    },
  );

  it("omits a live mesh emitter carrying an unknown catalog id", () => {
    const s = baseSnapshot();
    s.transforms[0] = {
      ...s.transforms[0],
      emitter: {
        parts: [
          {
            primitive: {
              kind: "mesh",
              meshId: "not-in-this-build",
            },
            combine: "union",
          },
        ],
      } as unknown as ShapeSpec,
    };
    const encoded = encodeScene(s);
    expect(
      "emitter" in
        (decodePayload(encoded).transforms as Record<string, unknown>[])[0],
    ).toBe(false);
    expect(decodeScene(encoded)!.transforms[0].emitter).toBeUndefined();
  });

  it("omits a foreign live primitive kind without throwing", () => {
    const s = baseSnapshot();
    s.transforms[0] = {
      ...s.transforms[0],
      emitter: {
        parts: [
          {
            primitive: { kind: "cone", radius: 1 },
            combine: "union",
          },
        ],
      } as unknown as ShapeSpec,
    };

    let encoded = "";
    expect(() => {
      encoded = encodeScene(s);
    }).not.toThrow();
    expect(
      "emitter" in
        (decodePayload(encoded).transforms as Record<string, unknown>[])[0],
    ).toBe(false);
    expect(decodeScene(encoded)!.transforms[0].emitter).toBeUndefined();
  });

  it("writes NO emitter key for an unauthored document (absent byte-identity)", () => {
    const encoded = encodeScene(baseSnapshot());
    const payload = decodePayload(encoded);
    expect(JSON.stringify(payload).includes("emitter")).toBe(false);
    const transforms = payload.transforms as Record<string, unknown>[];
    expect("emitter" in transforms[0]).toBe(false);
  });

  it("rounds numeric leaves to 4 decimals on the wire, fold-length style", () => {
    const s = baseSnapshot();
    s.transforms[0] = {
      ...s.transforms[0],
      emitter: {
        parts: [
          {
            primitive: { kind: "sphere", radius: 0.123456789 },
            combine: "union",
          },
        ],
      },
    };
    const result = decodeScene(encodeScene(s));
    const prim = result!.transforms[0].emitter!.parts[0].primitive;
    expect(prim.kind).toBe("sphere");
    expect((prim as { radius: number }).radius).toBe(0.1235);
  });

  it("rebuilds parts from admitted fields only — foreign keys never reach the document", () => {
    const raw = JSON.parse(JSON.stringify(baseSnapshot())) as Record<
      string,
      unknown
    >;
    (raw.transforms as Record<string, unknown>[])[0].emitter = {
      parts: [
        {
          primitive: { kind: "sphere", radius: 0.5, smuggled: 1 },
          combine: "union",
          pose: { scale: 2, contraband: true },
          extra: "nope",
        },
      ],
      alien: 42,
    };
    const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
    const emitter = result!.transforms[0].emitter!;
    expect(emitter).toEqual({
      parts: [
        {
          primitive: { kind: "sphere", radius: 0.5 },
          combine: "union",
          pose: { scale: 2 },
        },
      ],
    });
  });

  it("drops the WHOLE field quietly on any malformation, keeping the scene", () => {
    const malformed: unknown[] = [
      "not an object",
      { parts: "nope" },
      { parts: [] },
      {
        parts: Array.from({ length: 9 }, () => ({
          primitive: { kind: "sphere", radius: 1 },
          combine: "union",
        })),
      },
      { parts: [{ primitive: { kind: "cone", radius: 1 }, combine: "union" }] },
      {
        parts: [
          { primitive: { kind: "sphere", radius: "1" }, combine: "union" },
        ],
      },
      {
        parts: [
          { primitive: { kind: "sphere", radius: Infinity }, combine: "union" },
        ],
      },
      {
        parts: [
          { primitive: { kind: "sphere", radius: 1 }, combine: "subtract" },
        ],
      },
      {
        parts: [
          {
            primitive: {
              kind: "gear",
              teeth: 8,
              radius: 1,
              tooth: [0.2],
              hole: 0,
              halfHeight: 0.2,
            },
            combine: "union",
          },
        ],
      },
      {
        parts: [
          {
            primitive: { kind: "mesh", meshId: "not-in-this-build" },
            combine: "union",
          },
        ],
      },
      {
        parts: [
          {
            primitive: { kind: "mesh", meshId: 17 },
            combine: "union",
          },
        ],
      },
      {
        parts: [{ primitive: { kind: "box", half: [1, 1] }, combine: "union" }],
      },
      {
        parts: [
          {
            primitive: { kind: "sphere", radius: 1 },
            combine: "union",
            pose: { scale: null },
          },
        ],
      },
      [],
      ["future", 1],
      ["s"],
      ["s", "1"],
      ["s", 1, null],
      ["s", 1, { o: [1, 2] }],
      ["s", 1, {}, "extra"],
      ["b", 1, 2, Infinity],
    ];
    for (const emitter of malformed) {
      const raw = JSON.parse(JSON.stringify(baseSnapshot())) as Record<
        string,
        unknown
      >;
      (raw.transforms as Record<string, unknown>[])[0].emitter = emitter;
      const result = decodeScene("v1=" + b64url(JSON.stringify(raw)));
      expect(result).not.toBeNull();
      expect(result!.transforms[0].emitter).toBeUndefined();
    }
  });

  it("keeps fidelity at out-of-domain but finite numbers (no clamp — the domain lives in shapes.ts)", () => {
    const s = baseSnapshot();
    s.transforms[0] = {
      ...s.transforms[0],
      emitter: {
        parts: [
          {
            primitive: { kind: "sphere", radius: -2 },
            combine: "union",
            pose: { scale: -1 },
          },
        ],
      },
    };
    const result = decodeScene(encodeScene(s));
    const part = result!.transforms[0].emitter!.parts[0];
    expect((part.primitive as { radius: number }).radius).toBe(-2);
    expect(part.pose!.scale).toBe(-1);
  });
});

describe("shapeTrap codec (the shape-trap color/geometry block)", () => {
  it("round-trips the composer's maximum eight analytic parts, poses, and flat boolean fold", () => {
    const shape: ShapeSpec = {
      parts: [
        {
          primitive: { kind: "sphere", radius: 0.75 },
          combine: "union",
          pose: { offset: [-1, 0, 0] },
        },
        {
          primitive: { kind: "box", half: [0.4, 0.5, 0.6] },
          combine: "intersect",
          pose: { rotate: [0, 0, 0.25] },
        },
        {
          primitive: { kind: "torus", major: 0.8, minor: 0.2 },
          combine: "union",
          pose: { scale: 1.2 },
        },
        {
          primitive: {
            kind: "capsule",
            a: [0, -0.5, 0],
            b: [0, 0.5, 0],
            radius: 0.15,
          },
          combine: "intersect",
          pose: { offset: [0.2, 0, 0], rotate: [0.1, 0.2, 0.3] },
        },
        {
          primitive: {
            kind: "gear",
            teeth: 8,
            radius: 0.7,
            tooth: [0.12, 0.1],
            hole: 0.2,
            halfHeight: 0.18,
          },
          combine: "union",
        },
        {
          primitive: { kind: "sphere", radius: 0.3 },
          combine: "intersect",
          pose: { offset: [0, 0.4, 0], scale: 0.8 },
        },
        {
          primitive: { kind: "box", half: [0.2, 0.25, 0.3] },
          combine: "union",
          pose: { offset: [0, 0, 0.5] },
        },
        {
          primitive: { kind: "torus", major: 0.4, minor: 0.1 },
          combine: "intersect",
          pose: { rotate: [0.5, 0, 0], scale: 0.6 },
        },
      ],
    };

    const encoded = encodeScene({
      ...baseSnapshot(),
      shapeTrap: { shape },
    });
    const wire = decodePayload(encoded).shapeTrap as Record<string, unknown>;

    expect(Array.isArray(wire.shape)).toBe(false);
    expect((wire.shape as ShapeSpec).parts).toHaveLength(8);
    expect(decodeScene(encoded)!.shapeTrap?.shape).toEqual(shape);
  });

  it("uses the shared compact shape tuple while keeping the trap's outer pose separate", () => {
    const shape: ShapeSpec = {
      parts: [
        {
          primitive: { kind: "box", half: [0.7, 0.5, 0.3] },
          combine: "union",
          pose: { offset: [0.1, 0.2, 0.3], scale: 0.8 },
        },
      ],
    };
    const encoded = encodeScene({
      ...baseSnapshot(),
      shapeTrap: { shape, position: [-0.25, 0, 0.5], scale: 1.5 },
    });
    const wire = decodePayload(encoded).shapeTrap as Record<string, unknown>;

    expect(wire.shape).toEqual([
      "b",
      0.7,
      0.5,
      0.3,
      { o: [0.1, 0.2, 0.3], s: 0.8 },
    ]);
    expect(wire.position).toEqual([-0.25, 0, 0.5]);
    expect(wire.scale).toBe(1.5);
    expect(decodeScene(encoded)!.shapeTrap).toEqual({
      shape,
      position: [-0.25, 0, 0.5],
      scale: 1.5,
    });
  });

  it("round-trips a known built-in mesh id through the shared shape codec", () => {
    const mesh: ShapeSpec = {
      parts: [
        {
          primitive: { kind: "mesh", meshId: "star-prism-v1" },
          combine: "union",
        },
      ],
    };
    const result = decodeScene(
      encodeScene({ ...baseSnapshot(), shapeTrap: { shape: mesh } }),
    );
    expect(result!.shapeTrap).toEqual({ shape: mesh });
  });

  it("round-trips a full block, round4'd, and drops nothing authored", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      shapeTrap: {
        shape: PEACE_SIGN_SHAPE,
        position: [0.31234567, -0.2, 0.5],
        rotation: [0.2, 0, 0.4],
        scale: 0.5,
        mode: "threshold",
        threshold: 0.3,
        fade: 0.05,
        geometry: true,
        geometryLevelMin: 7.9,
        geometryLevelMax: 2.1,
      },
    };
    const result = decodeScene(encodeScene(s));
    expect(result).not.toBeNull();
    expect(result!.shapeTrap).toBeDefined();
    expect(result!.shapeTrap!.position).toEqual([0.3123, -0.2, 0.5]);
    expect(result!.shapeTrap!.rotation).toEqual([0.2, 0, 0.4]);
    expect(result!.shapeTrap!.scale).toBe(0.5);
    expect(result!.shapeTrap!.mode).toBe("threshold");
    expect(result!.shapeTrap!.threshold).toBe(0.3);
    expect(result!.shapeTrap!.fade).toBe(0.05);
    expect(result!.shapeTrap!.geometry).toBe(true);
    expect(result!.shapeTrap!.geometryLevelMin).toBe(2);
    expect(result!.shapeTrap!.geometryLevelMax).toBe(7);
    // The shape survives through the emitter spec codec — one vocabulary,
    // one codec.
    expect(result!.shapeTrap!.shape.parts).toHaveLength(4);
    expect(result!.shapeTrap!.shape.parts[0].primitive.kind).toBe("torus");
  });

  it("writes nothing without a block — an unauthored scene stays byte-identical to one predating the field", () => {
    const plain = encodeScene(baseSnapshot());
    const payload = JSON.parse(
      Buffer.from(
        plain.slice("v1=".length).replace(/-/g, "+").replace(/_/g, "/"),
        "base64",
      ).toString("utf8"),
    ) as Record<string, unknown>;
    expect("shapeTrap" in payload).toBe(false);
    const decoded = decodeScene(plain);
    expect(decoded!.shapeTrap).toBeUndefined();
  });

  it("writes each optional field only when present — a shape-only block carries the shape alone", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      shapeTrap: { shape: PEACE_SIGN_SHAPE },
    };
    const decoded = decodeScene(encodeScene(s));
    expect(decoded!.shapeTrap).toBeDefined();
    expect(decoded!.shapeTrap!.position).toBeUndefined();
    expect(decoded!.shapeTrap!.rotation).toBeUndefined();
    expect(decoded!.shapeTrap!.scale).toBeUndefined();
    expect(decoded!.shapeTrap!.mode).toBeUndefined();
    expect(decoded!.shapeTrap!.threshold).toBeUndefined();
    expect(decoded!.shapeTrap!.fade).toBeUndefined();
    expect(decoded!.shapeTrap!.geometry).toBeUndefined();
    expect(decoded!.shapeTrap!.geometryLevelMin).toBeUndefined();
    expect(decoded!.shapeTrap!.geometryLevelMax).toBeUndefined();
    expect(Object.keys(decoded!.shapeTrap!)).toEqual(["shape"]);
  });

  it("keeps geometry-off wire output byte-identical and omits dormant level fields", () => {
    const plain = encodeScene({
      ...baseSnapshot(),
      shapeTrap: { shape: PEACE_SIGN_SHAPE, fade: 0.2 },
    });
    const explicitlyOff = encodeScene({
      ...baseSnapshot(),
      shapeTrap: {
        shape: PEACE_SIGN_SHAPE,
        fade: 0.2,
        geometry: false,
        geometryLevelMin: 9,
        geometryLevelMax: 3,
      },
    });
    expect(explicitlyOff).toBe(plain);
  });

  it("round-trips geometry with a canonical inclusive band and keeps all-level defaults absent", () => {
    const bounded = decodeScene(
      encodeScene({
        ...baseSnapshot(),
        shapeTrap: {
          shape: PEACE_SIGN_SHAPE,
          geometry: true,
          geometryLevelMin: 6.8,
          geometryLevelMax: 1.2,
        },
      }),
    )!.shapeTrap;
    expect(bounded).toMatchObject({
      geometry: true,
      geometryLevelMin: 1,
      geometryLevelMax: 6,
    });

    const allLevels = decodeScene(
      encodeScene({
        ...baseSnapshot(),
        shapeTrap: {
          shape: PEACE_SIGN_SHAPE,
          geometry: true,
          geometryLevelMin: -2,
          geometryLevelMax: Number.POSITIVE_INFINITY,
        },
      }),
    )!.shapeTrap;
    expect(allLevels?.geometry).toBe(true);
    expect(allLevels?.geometryLevelMin).toBeUndefined();
    expect(allLevels?.geometryLevelMax).toBeUndefined();
  });

  it("drops a malformed block WHOLE — never rejecting the scene, never salvaging leaves", () => {
    const mangle = (patch: object): SceneSnapshot | null => {
      const raw = JSON.parse(
        Buffer.from(
          encodeScene({
            ...baseSnapshot(),
            shapeTrap: { shape: PEACE_SIGN_SHAPE, scale: 0.5 },
          })
            .slice("v1=".length)
            .replace(/-/g, "+")
            .replace(/_/g, "/"),
          "base64",
        ).toString("utf8"),
      ) as Record<string, unknown>;
      raw.shapeTrap = { ...(raw.shapeTrap as object), ...patch };
      const b64 = Buffer.from(JSON.stringify(raw), "utf8")
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
      return decodeScene(`v1=${b64}`);
    };
    // A numeric-string scale (no coercion), an unknown mode, a non-Vec3
    // position, a corrupt shape: each drops the ENTIRE block and keeps the
    // scene.
    for (const patch of [
      { scale: "2" },
      { mode: "nearest" },
      { position: [1, 2] },
      { shape: { parts: "x" } },
      { shape: ["s", 1, { r: [0, 1] }] },
      { geometry: 1 },
      { geometryLevelMin: "2" },
      { geometryLevelMax: Number.POSITIVE_INFINITY },
    ]) {
      const decoded = mangle(patch);
      expect(decoded).not.toBeNull();
      expect(decoded!.shapeTrap).toBeUndefined();
    }
  });

  it("fromSnapshot clears a base session's block when the snapshot has none (the schedule's explicit-read rule)", () => {
    const withTrap = fromSnapshot(
      { ...baseSnapshot(), shapeTrap: { shape: PEACE_SIGN_SHAPE } },
      initialState(false),
    );
    expect(withTrap.shapeTrap).toBeDefined();
    const cleared = fromSnapshot(baseSnapshot(), withTrap);
    expect(cleared.shapeTrap).toBeUndefined();
  });
});
