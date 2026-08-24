import { surfaceComputeForceFrameKey } from "./surface-force-frame-key";
import type { SurfaceComputeFrameSpec } from "./surface-compute";
import { CLASSIC_SURFACE_FINISH } from "../fractal/surface-finish";
import type { SurfaceMaterialSlots } from "../fractal/surface-material-wire";
import type {
  ResolvedSurfacePattern,
  SurfaceNativeCalibration,
} from "../fractal/surface-pattern";

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
        pattern: 1,
        tileScale: 0.64,
        emission: 1.4,
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
        pattern: 1,
        tileScale: 0.64,
        emission: 1.4,
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

  it("keys every authorable floor-appearance value", () => {
    const groundPlane = {
      y: -1,
      fadeStart: 2,
      fadeEnd: 6,
      ballCenter: [0, 0, 0] as [number, number, number],
      ballRadius: 3,
      albedo: [0.5, 0.5, 0.5] as [number, number, number],
      pattern: 1 as const,
      tileScale: 0.64,
      emission: 1.4,
    };
    const key = surfaceComputeForceFrameKey(baseSpec({ groundPlane }));
    for (const changed of [
      { ...groundPlane, pattern: 0 as const },
      { ...groundPlane, tileScale: 0.8 },
      { ...groundPlane, emission: 2 },
    ]) {
      expect(
        surfaceComputeForceFrameKey(baseSpec({ groundPlane: changed })),
      ).not.toBe(key);
    }
  });

  it("keys a balloon palette by its independent revision while null and absent both mean inherit", () => {
    const balloon = {
      center: [1, 2, 3] as [number, number, number],
      rho: 4,
      R: 5,
      far: 6,
    };
    const absent = surfaceComputeForceFrameKey(baseSpec({ balloon }));
    const explicitInherit = surfaceComputeForceFrameKey(
      baseSpec({ balloon, balloonLut: null, balloonLutVersion: 91 }),
    );
    expect(explicitInherit).toBe(absent);

    const lut = new Uint8Array(256 * 4).fill(127);
    const version7 = surfaceComputeForceFrameKey(
      baseSpec({ balloon, balloonLut: lut, balloonLutVersion: 7 }),
    );
    const version8 = surfaceComputeForceFrameKey(
      baseSpec({ balloon, balloonLut: lut, balloonLutVersion: 8 }),
    );
    expect(version7).not.toBe(absent);
    expect(version8).not.toBe(version7);
    // The revision is the upload/cache contract; the memo key deliberately
    // does not serialize a kilobyte of LUT bytes.
    expect(
      surfaceComputeForceFrameKey(
        baseSpec({
          balloon,
          balloonLut: new Uint8Array(256 * 4).fill(255),
          balloonLutVersion: 7,
        }),
      ),
    ).toBe(version7);
  });
});

describe("surfaceComputeForceFrameKey finishes block", () => {
  const chrome = {
    specular: 1,
    shininess: 128,
    metalness: 1,
    reflect: 0.8,
    transmit: 0,
    reflectionTint: 0,
  };
  const matte = {
    specular: 0,
    shininess: 32,
    metalness: 0,
    reflect: 0,
    transmit: 0,
    reflectionTint: 1,
  };
  const finishMaterials = (
    finishes: readonly (typeof chrome)[],
  ): SurfaceMaterialSlots => ({
    slots: finishes.map((finish) => ({
      finish,
      pattern: { kind: "none", axis: "y", scale: 1, strength: 0 },
    })),
    finish: true,
    pattern: false,
  });

  it("keys a finish change — a timeline leg re-authoring one slot under a parked camera must re-trace", () => {
    const a = surfaceComputeForceFrameKey(
      baseSpec({ materials: finishMaterials([chrome, matte]) }),
    );
    const b = surfaceComputeForceFrameKey(
      baseSpec({
        materials: finishMaterials([chrome, { ...matte, transmit: 0.5 }]),
      }),
    );
    expect(a).not.toBe(b);
  });

  it("keys Chrome's neutral reflection separately from colored Metal", () => {
    const neutral = surfaceComputeForceFrameKey(
      baseSpec({ materials: finishMaterials([chrome]) }),
    );
    const tinted = surfaceComputeForceFrameKey(
      baseSpec({
        materials: finishMaterials([{ ...chrome, reflectionTint: 1 }]),
      }),
    );
    expect(neutral).not.toBe(tinted);
  });

  it("keys presence itself: an authored session never collides with a classic one", () => {
    const classic = surfaceComputeForceFrameKey(baseSpec());
    const authored = surfaceComputeForceFrameKey(
      baseSpec({ materials: finishMaterials([matte]) }),
    );
    expect(classic).not.toBe(authored);
  });

  it("absent materials keys byte-identically to a spec predating the field — the packer's own absent default", () => {
    expect(
      surfaceComputeForceFrameKey(baseSpec({ materials: undefined })),
    ).toBe(surfaceComputeForceFrameKey(baseSpec()));
  });

  it("cannot be re-partitioned into its neighbor blocks: the slot count delimits it ahead of bgShape's tag", () => {
    // One slot of finishes followed by a bgShape block, against two slots
    // where the second slot's tuple could otherwise masquerade as the
    // shape block's opening fields — the tag + count prefix keeps the two
    // parses distinct.
    const a = surfaceComputeForceFrameKey(
      baseSpec({
        materials: finishMaterials([chrome]),
        bgShape: { kind: "radial", center: [0.5, 0.5], scale: [1, 1] },
      }),
    );
    const b = surfaceComputeForceFrameKey(
      baseSpec({ materials: finishMaterials([chrome, matte]) }),
    );
    expect(a).not.toBe(b);
  });

  it("keys slot ORDER — two sessions swapping the same two finishes differ", () => {
    const a = surfaceComputeForceFrameKey(
      baseSpec({ materials: finishMaterials([chrome, matte]) }),
    );
    const b = surfaceComputeForceFrameKey(
      baseSpec({ materials: finishMaterials([matte, chrome]) }),
    );
    expect(a).not.toBe(b);
  });
});

describe("surfaceComputeForceFrameKey pattern blocks", () => {
  const pattern: ResolvedSurfacePattern = {
    kind: "wood",
    axis: "y",
    scale: 3,
    strength: 0.5,
  };
  const calibration: SurfaceNativeCalibration = {
    ringsLow: 0.1,
    ringsInvSpan: 2,
    sheetsLow: 0.2,
    sheetsInvSpan: 3,
  };
  const materials = (
    value: ResolvedSurfacePattern = pattern,
    native: SurfaceNativeCalibration = calibration,
  ): SurfaceMaterialSlots => ({
    slots: [{ finish: { ...CLASSIC_SURFACE_FINISH }, pattern: { ...value } }],
    finish: false,
    pattern: true,
    patternCalibration: { ...native },
  });

  it("keys value-equal pattern sessions identically across fresh objects", () => {
    expect(
      surfaceComputeForceFrameKey(baseSpec({ materials: materials() })),
    ).toBe(surfaceComputeForceFrameKey(baseSpec({ materials: materials() })));
  });

  it("invalidates on every resolved pattern field and the pixel footprint", () => {
    const key = surfaceComputeForceFrameKey(
      baseSpec({ materials: materials(), tracePixelEps: 0.001 }),
    );
    for (const changed of [
      { ...pattern, kind: "marble" as const },
      { ...pattern, axis: "z" as const },
      { ...pattern, strength: 0.51 },
      { ...pattern, scale: 4 },
    ]) {
      expect(
        surfaceComputeForceFrameKey(
          baseSpec({ materials: materials(changed), tracePixelEps: 0.001 }),
        ),
      ).not.toBe(key);
    }
    expect(
      surfaceComputeForceFrameKey(
        baseSpec({ materials: materials(), tracePixelEps: 0.002 }),
      ),
    ).not.toBe(key);
  });

  it("invalidates on every per-DE native calibration lane", () => {
    const key = surfaceComputeForceFrameKey(
      baseSpec({ materials: materials() }),
    );
    for (const changed of [
      { ...calibration, ringsLow: 0.11 },
      { ...calibration, ringsInvSpan: 2.1 },
      { ...calibration, sheetsLow: 0.21 },
      { ...calibration, sheetsInvSpan: 3.1 },
    ]) {
      expect(
        surfaceComputeForceFrameKey(
          baseSpec({ materials: materials(pattern, changed) }),
        ),
      ).not.toBe(key);
    }
  });

  it("keys pattern presence even at strength zero, without perturbing the absent-material legacy key", () => {
    const absent = surfaceComputeForceFrameKey(baseSpec());
    const zero = surfaceComputeForceFrameKey(
      baseSpec({ materials: materials({ ...pattern, strength: 0 }) }),
    );
    expect(zero).not.toBe(absent);
    expect(
      surfaceComputeForceFrameKey(baseSpec({ materials: undefined })),
    ).toBe(absent);
  });
});
