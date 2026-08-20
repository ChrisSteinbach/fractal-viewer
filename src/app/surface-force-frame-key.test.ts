import { surfaceComputeForceFrameKey } from "./surface-force-frame-key";
import type { SurfaceComputeFrameSpec } from "./surface-compute";

/** The smallest spec the key function reads every unconditional field from;
 * mirrors surface-compute.test.ts's own `frameSpec()` fixture. Every
 * optional field (fog/env/bgShape/view4/balloon/groundPlane) is absent
 * unless a test's `overrides` adds it. */
function baseSpec(
  overrides: Partial<SurfaceComputeFrameSpec> = {},
): SurfaceComputeFrameSpec {
  return {
    width: 4,
    height: 4,
    invProjView: new Float32Array(16),
    camPos: [0, 0, 3],
    acceptPixelEps: 1e-3,
    tracePixelEps: 1e-3,
    maxDepth: 8,
    marchSteps: 32,
    shadowSteps: 0,
    aoTaps: 0,
    hitFloor: 1e-4,
    lightDir: [0, 1, 0],
    ambient: 0.2,
    bgTop: [0, 0, 0],
    bgBottom: [0, 0, 0],
    colorSource: 0,
    colorSpeed: 0.5,
    lut: null,
    lutVersion: 0,
    dither: false,
    ...overrides,
  };
}

describe("surfaceComputeForceFrameKey", () => {
  it("keys two value-equal specs identically, even built as separate objects", () => {
    // Every optional field this fix adds, plus the pre-existing view4 and
    // groundPlane blocks, populated in full — two independently-built specs
    // (fresh arrays throughout, no shared references) must still key alike.
    const a = baseSpec({
      fogDensity: 1.25,
      fogTint: [1, 0.9, 0.8],
      fogTintStrength: 0.3,
      envLight: 0.6,
      bgShape: { kind: "radial", center: [0.4, 0.6], scale: [1.1, 0.9] },
      view4: { rotor: [1, 0, 0, 0, 1, 0, 0, 0], w0: 0.25, sliceHalfW: 0.1 },
      groundPlane: {
        y: -2,
        fadeStart: 4,
        fadeEnd: 10,
        ballCenter: [0, 1, 0],
        ballRadius: 5,
        albedo: [0.2, 0.2, 0.2],
      },
    });
    const b = baseSpec({
      fogDensity: 1.25,
      fogTint: [1, 0.9, 0.8],
      fogTintStrength: 0.3,
      envLight: 0.6,
      bgShape: { kind: "radial", center: [0.4, 0.6], scale: [1.1, 0.9] },
      view4: { rotor: [1, 0, 0, 0, 1, 0, 0, 0], w0: 0.25, sliceHalfW: 0.1 },
      groundPlane: {
        y: -2,
        fadeStart: 4,
        fadeEnd: 10,
        ballCenter: [0, 1, 0],
        ballRadius: 5,
        albedo: [0.2, 0.2, 0.2],
      },
    });
    expect(surfaceComputeForceFrameKey(a)).toBe(surfaceComputeForceFrameKey(b));
  });

  it("changes the key when fogDensity differs", () => {
    const low = surfaceComputeForceFrameKey(baseSpec({ fogDensity: 1 }));
    const high = surfaceComputeForceFrameKey(baseSpec({ fogDensity: 2 }));
    expect(low).not.toBe(high);
  });

  it("changes the key when fogTint differs", () => {
    const white = surfaceComputeForceFrameKey(baseSpec({ fogTint: [1, 1, 1] }));
    const red = surfaceComputeForceFrameKey(baseSpec({ fogTint: [1, 0, 0] }));
    expect(white).not.toBe(red);
  });

  it("changes the key when fogTintStrength differs", () => {
    const off = surfaceComputeForceFrameKey(baseSpec({ fogTintStrength: 0 }));
    const half = surfaceComputeForceFrameKey(
      baseSpec({ fogTintStrength: 0.5 }),
    );
    expect(off).not.toBe(half);
  });

  it("changes the key when envLight differs", () => {
    const off = surfaceComputeForceFrameKey(baseSpec({ envLight: 0 }));
    const on = surfaceComputeForceFrameKey(baseSpec({ envLight: 0.4 }));
    expect(off).not.toBe(on);
  });

  it("changes the key when the background shape's kind differs", () => {
    const linear = surfaceComputeForceFrameKey(
      baseSpec({ bgShape: { kind: "linear" } }),
    );
    const radial = surfaceComputeForceFrameKey(
      baseSpec({ bgShape: { kind: "radial" } }),
    );
    expect(linear).not.toBe(radial);
  });

  it("changes the key when the background shape's center differs", () => {
    const centered = surfaceComputeForceFrameKey(
      baseSpec({ bgShape: { kind: "radial", center: [0.5, 0.5] } }),
    );
    const offCenter = surfaceComputeForceFrameKey(
      baseSpec({ bgShape: { kind: "radial", center: [0.25, 0.75] } }),
    );
    expect(centered).not.toBe(offCenter);
  });

  it("changes the key when the background shape's scale differs", () => {
    const square = surfaceComputeForceFrameKey(
      baseSpec({ bgShape: { kind: "radial", scale: [1, 1] } }),
    );
    const stretched = surfaceComputeForceFrameKey(
      baseSpec({ bgShape: { kind: "radial", scale: [2, 1] } }),
    );
    expect(square).not.toBe(stretched);
  });

  // The collision hazard (named in the module doc): the key is a plain array
  // `.join("|")`, so a naive append could let two DIFFERENT optional-block
  // combinations read as the same string. bgShape (new) and view4
  // (pre-existing) are the closest-sized neighbors — bgShape contributes 4
  // elements tagged, view4 contributes 3 untagged — so they are exactly the
  // pairing a miscount would first collide on.
  it("does not collide when bgShape alone is present versus when view4 alone is present", () => {
    const withBgShape = surfaceComputeForceFrameKey(
      baseSpec({
        bgShape: { kind: "radial", center: [0.5, 0.5], scale: [1, 1] },
      }),
    );
    const withView4 = surfaceComputeForceFrameKey(
      baseSpec({
        view4: { rotor: [1, 0, 0, 0, 1, 0, 0, 0], w0: 0.5, sliceHalfW: 1 },
      }),
    );
    expect(withBgShape).not.toBe(withView4);
  });

  it("does not collide when bgShape joins an already-present groundPlane block", () => {
    const groundPlane = {
      y: -1,
      fadeStart: 2,
      fadeEnd: 6,
      ballCenter: [0, 0, 0] as [number, number, number],
      ballRadius: 3,
      albedo: [0.5, 0.5, 0.5] as [number, number, number],
    };
    const groundPlaneOnly = surfaceComputeForceFrameKey(
      baseSpec({ groundPlane }),
    );
    const bothPresent = surfaceComputeForceFrameKey(
      baseSpec({ bgShape: { kind: "linear" }, groundPlane }),
    );
    expect(groundPlaneOnly).not.toBe(bothPresent);
  });
});

describe("surfaceComputeForceFrameKey finishes block", () => {
  const chrome = {
    specular: 1,
    shininess: 128,
    metalness: 1,
    reflect: 0.8,
    transmit: 0,
  };
  const matte = {
    specular: 0,
    shininess: 32,
    metalness: 0,
    reflect: 0,
    transmit: 0,
  };

  it("keys a finish change — a timeline leg re-authoring one slot under a parked camera must re-trace", () => {
    const a = surfaceComputeForceFrameKey(
      baseSpec({ finishes: [chrome, matte] }),
    );
    const b = surfaceComputeForceFrameKey(
      baseSpec({ finishes: [chrome, { ...matte, transmit: 0.5 }] }),
    );
    expect(a).not.toBe(b);
  });

  it("keys presence itself: an authored session never collides with a classic one", () => {
    const classic = surfaceComputeForceFrameKey(baseSpec());
    const authored = surfaceComputeForceFrameKey(
      baseSpec({ finishes: [matte] }),
    );
    expect(classic).not.toBe(authored);
  });

  it("absent finishes keys byte-identically to a spec predating the field — the packer's own absent default", () => {
    expect(surfaceComputeForceFrameKey(baseSpec({ finishes: undefined }))).toBe(
      surfaceComputeForceFrameKey(baseSpec()),
    );
  });

  it("cannot be re-partitioned into its neighbor blocks: the slot count delimits it ahead of bgShape's tag", () => {
    // One slot of finishes followed by a bgShape block, against two slots
    // where the second slot's tuple could otherwise masquerade as the
    // shape block's opening fields — the tag + count prefix keeps the two
    // parses distinct.
    const a = surfaceComputeForceFrameKey(
      baseSpec({
        finishes: [chrome],
        bgShape: { kind: "radial", center: [0.5, 0.5], scale: [1, 1] },
      }),
    );
    const b = surfaceComputeForceFrameKey(
      baseSpec({ finishes: [chrome, matte] }),
    );
    expect(a).not.toBe(b);
  });

  it("keys slot ORDER — two sessions swapping the same two finishes differ", () => {
    const a = surfaceComputeForceFrameKey(
      baseSpec({ finishes: [chrome, matte] }),
    );
    const b = surfaceComputeForceFrameKey(
      baseSpec({ finishes: [matte, chrome] }),
    );
    expect(a).not.toBe(b);
  });
});
