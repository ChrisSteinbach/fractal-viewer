// @vitest-environment jsdom
import { decodeScene, encodeScene, loadScene } from "./persist";
import type { SceneSnapshot } from "./persist";
import { MAX_TRANSFORMS } from "../fractal/chaos-game";
import {
  DEFAULT_FLAME_EXPOSURE,
  DEFAULT_FLAME_GAMMA,
  DEFAULT_FLAME_ITERATIONS,
  DEFAULT_FLAME_SUPERSAMPLE,
  DEFAULT_FLAME_VIBRANCY,
  MAX_FLAME_EXPOSURE,
  MAX_FLAME_GAMMA,
  MAX_FLAME_ITERATIONS,
  MAX_FLAME_SUPERSAMPLE,
  MIN_FLAME_EXPOSURE,
  MIN_FLAME_ITERATIONS,
  MIN_FLAME_VIBRANCY,
} from "./state";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Encode a string as base64url — lets tests construct raw payloads directly. */
function b64url(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
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
    renderStyle: "depthFade",
    showGuides: true,
    flame: {
      exposure: DEFAULT_FLAME_EXPOSURE,
      iterations: DEFAULT_FLAME_ITERATIONS,
      gamma: DEFAULT_FLAME_GAMMA,
      vibrancy: DEFAULT_FLAME_VIBRANCY,
      supersample: DEFAULT_FLAME_SUPERSAMPLE,
    },
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
});

// ---------------------------------------------------------------------------
// Clamping
// ---------------------------------------------------------------------------

describe("decodeScene clamping", () => {
  it("clamps numPoints above 500 000 down to 500 000", () => {
    const result = decodeScene(
      encodeScene({ ...baseSnapshot(), numPoints: 1_000_000 }),
    );
    expect(result!.numPoints).toBe(500_000);
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
