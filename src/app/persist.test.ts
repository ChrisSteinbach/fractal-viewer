// @vitest-environment jsdom
import { decodeScene, encodeScene, loadScene } from "./persist";
import type { SceneSnapshot } from "./persist";

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
