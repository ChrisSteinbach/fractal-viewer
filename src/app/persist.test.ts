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
import { DEFAULT_COLOR_SPEED, MAX_TRANSFORMS } from "../fractal/chaos-game";
import {
  MAX_CUSTOM_PALETTE_STOPS,
  MIN_CUSTOM_PALETTE_STOPS,
} from "../fractal/palette";
import { VARIATION_TYPES } from "../fractal/types";
import { VOXEL_RESOLUTION_STEP } from "../fractal/voxel";
import { MAX_PHI, MAX_RADIUS, MIN_PHI, MIN_RADIUS } from "./orbit";
import {
  DEFAULT_BALLOON_RADIUS,
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
  DEFAULT_SOLID_ITERATIONS,
  DEFAULT_SOLID_LIGHT_AZIMUTH,
  DEFAULT_SOLID_LIGHT_ELEVATION,
  DEFAULT_SOLID_PALETTE,
  DEFAULT_SOLID_RESOLUTION,
  DEFAULT_SOLID_THRESHOLD,
  DEFAULT_SURFACE_COLOR_SPEED,
  DEFAULT_SURFACE_ENV_LIGHT,
  DEFAULT_SYMMETRY_PLANE,
  DEFAULT_SYMMETRY_ORDER,
  MAX_BALLOON_RADIUS,
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
      paletteId: DEFAULT_SOLID_PALETTE,
    },
    surface: {
      lightAzimuth: DEFAULT_SOLID_LIGHT_AZIMUTH,
      lightElevation: DEFAULT_SOLID_LIGHT_ELEVATION,
      ambient: DEFAULT_SOLID_AMBIENT,
      colorSource: "transform",
      paletteId: DEFAULT_SOLID_PALETTE,
      colorSpeed: DEFAULT_SURFACE_COLOR_SPEED,
      envLight: DEFAULT_SURFACE_ENV_LIGHT,
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
      paletteId: DEFAULT_SOLID_PALETTE,
    });
    expect(result!.surface).toEqual({
      lightAzimuth: DEFAULT_SOLID_LIGHT_AZIMUTH,
      lightElevation: DEFAULT_SOLID_LIGHT_ELEVATION,
      ambient: DEFAULT_SOLID_AMBIENT,
      colorSource: "transform",
      paletteId: DEFAULT_SOLID_PALETTE,
      colorSpeed: DEFAULT_SURFACE_COLOR_SPEED,
      envLight: DEFAULT_SURFACE_ENV_LIGHT,
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

  it("returns null for a blend longer than the variation vocabulary (fr-qgxi)", () => {
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

describe("decodeScene transform variation fold radii (fr-s9ll)", () => {
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
// Per-transform colorIndex / colorSpeed (fr-hiyu — flam3 xform color parity;
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
      paletteId: DEFAULT_SOLID_PALETTE,
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

  it("round-trips the full 512 resolution ceiling (fr-8x7)", () => {
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
// Surface render params (fr-7jlk — same "absent defaults quietly, malformed
// numeric field rejects" contract as the flame/solid blocks above; unlike
// those numeric fields, `colorSource` is a QUIET-fallback enum, like
// symmetry.plane, not a reject-the-scene field)
// ---------------------------------------------------------------------------

describe("decodeScene surface params", () => {
  it("round-trips a fully customized surface block", () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      surface: {
        lightAzimuth: -45,
        lightElevation: 70,
        ambient: 0.5,
        colorSource: "radius",
        paletteId: "spectrum",
        colorSpeed: 0.8,
        envLight: 0.6,
      },
    };
    const result = decodeScene(encodeScene(s));
    expect(result!.surface).toEqual({
      lightAzimuth: -45,
      lightElevation: 70,
      ambient: 0.5,
      colorSource: "radius",
      paletteId: "spectrum",
      colorSpeed: 0.8,
      envLight: 0.6,
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
      lightAzimuth: DEFAULT_SOLID_LIGHT_AZIMUTH,
      lightElevation: DEFAULT_SOLID_LIGHT_ELEVATION,
      ambient: DEFAULT_SOLID_AMBIENT,
      colorSource: "transform",
      paletteId: DEFAULT_SOLID_PALETTE,
      colorSpeed: DEFAULT_SURFACE_COLOR_SPEED,
      envLight: DEFAULT_SURFACE_ENV_LIGHT,
    });
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

  it('round-trips the "rings" colorSource (fr-rl4b)', () => {
    const s: SceneSnapshot = {
      ...baseSnapshot(),
      surface: { ...baseSnapshot().surface, colorSource: "rings" },
    };
    expect(decodeScene(encodeScene(s))!.surface.colorSource).toBe("rings");
  });

  it('round-trips the "sheets" colorSource (fr-rl4b)', () => {
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
// Position axis colors (fr-8k7) — the "by position" color mode's three
// user-picked axis colors. Optional like customPalette, and shares its
// quiet-fallback decode contract; see color.ts's PositionAxisColors.
// ---------------------------------------------------------------------------

describe("decodeScene positionAxisColors (fr-8k7)", () => {
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
// toSnapshot / fromSnapshot (fr-8k7) — positionAxisColors carry/clear, the
// same pairing as the customPalette block above. Unlike that block's
// "clears" test, this one builds the incoming snapshot from the bare
// baseSnapshot() helper rather than routing it through toSnapshot, so it
// also pins that fromSnapshot clears the field even when the snapshot
// object never declares the key at all (see fromSnapshot's own doc comment).
// ---------------------------------------------------------------------------

describe("toSnapshot / fromSnapshot positionAxisColors (fr-8k7)", () => {
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
// Symmetry params (fr-6im) — deliberately MORE lenient than flame/solid: a
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

  // ——— fr-q0h6: the axis -> plane migration ———

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
    // fr-4jyg: reached through the REAL reducers, not a hand-built payload —
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
// 4D projection color mode (fr-d47)
// ---------------------------------------------------------------------------

describe("decodeScene fourDColor", () => {
  it("round-trips a non-default fourDColor", () => {
    const s: SceneSnapshot = { ...baseSnapshot(), fourDColor: "wCyanMagenta" };
    const result = decodeScene(encodeScene(s));
    expect(result!.fourDColor).toBe("wCyanMagenta");
  });

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
// saveScene — history + storage writes (fr-532t: history is injectable via
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
});

// ---------------------------------------------------------------------------
// 4D view pose (fr-pnek) — the optional tumble rotor + soft w-slice window a
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

  // Slab thickness (fr-wa6o) is the one field in this block that does NOT
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
    // The regression that matters: a hand-built payload with every fr-pnek
    // field but no `sliceThickness` key at all — exactly what every shared
    // link and saved scene from before fr-wa6o looks like.
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
// Background (fr-5ps1) — the scene backdrop. Omitted from the wire payload
// while pristine (dark, nothing authored) EXCEPT under the aerial render
// style, where an absent field is what a pre-fr-5ps1 document looks like and
// decodes through the legacy migration (aerial forced haze). See
// background.ts / decodeBackground's own doc comments.
// ---------------------------------------------------------------------------

describe("decodeScene background (fr-5ps1)", () => {
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

  // ——— fr-5ps1: the pre-existing-document legacy migration ———

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
// Balloon pair (fr-5wlv.6) — the balloon echo/surface-balloon on-flag and its
// normalized radius, persisted since epic fr-5wlv's "mode persists"
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
    // every pre-fr-5wlv.6 link looks like.
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

describe("toSnapshot / fromSnapshot balloon (fr-5wlv.6)", () => {
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
    // baseSnapshot() carries neither key at all — what a pre-fr-5wlv.6
    // snapshot (or a decode of one) looks like — so this also pins that
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
// Fog density (fr-5h5d) — persisted alongside the balloon pair the identical
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
    // A hand-built payload with no fogDensity key — what every pre-fr-5h5d
    // link looks like.
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

describe("toSnapshot / fromSnapshot fog (fr-5h5d)", () => {
  it("toSnapshot carries fogDensity", () => {
    const state: AppState = { ...initialState(true), fogDensity: 0.5 };
    expect(toSnapshot(state).fogDensity).toBe(0.5);
  });

  it("fromSnapshot defaults fogDensity when the snapshot lacks it", () => {
    // baseSnapshot() carries no fogDensity key at all — what a pre-fr-5h5d
    // snapshot (or a decode of one) looks like — so this also pins that
    // fromSnapshot supplies the real default rather than merely clearing.
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
// Fog tint (fr-5h5d) — persisted alongside fogDensity the identical way:
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
    // every pre-fr-5h5d link looks like.
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

describe("toSnapshot / fromSnapshot fog tint (fr-5h5d)", () => {
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
    // a pre-fr-5h5d snapshot (or a decode of one) looks like.
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
// Ground plane (fr-rhn5) — persisted alongside the balloon pair the
// identical way: optional on SceneSnapshot, always written by
// toSnapshot/encodeScene, quiet-drop on decode (no clamping — a plain
// boolean, not a PARAM-backed numeric like balloonRadius), with
// fromSnapshot supplying the real default (`false`).
// ---------------------------------------------------------------------------

describe("decodeScene ground plane", () => {
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
    // A hand-built payload with no groundPlane key — what every
    // pre-fr-rhn5 link looks like.
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

describe("toSnapshot / fromSnapshot ground plane (fr-rhn5)", () => {
  it("toSnapshot carries groundPlane", () => {
    const state: AppState = { ...initialState(true), groundPlane: true };
    expect(toSnapshot(state).groundPlane).toBe(true);
  });

  it("fromSnapshot defaults groundPlane to false when the snapshot lacks it", () => {
    // baseSnapshot() carries no groundPlane key at all — what a
    // pre-fr-rhn5 snapshot (or a decode of one) looks like.
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
