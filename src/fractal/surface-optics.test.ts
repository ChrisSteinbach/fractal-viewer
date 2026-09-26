import {
  DIELECTRIC_ABSORPTION,
  DIELECTRIC_IOR,
  type DielectricMaterial,
} from "./surface-dielectric";
import {
  SURFACE_OPTICS_DISTORTION_CEILING,
  SURFACE_OPTICS_IOR_CEILING,
  SURFACE_OPTICS_IOR_FLOOR,
  SURFACE_OPTICS_SCALE_CEILING,
  SURFACE_OPTICS_SCALE_FLOOR,
  resolveSurfaceOptics,
} from "./surface-optics";

describe("surface optics vocabulary", () => {
  it("resolves an absent or unknown-model block to no optics at all", () => {
    expect(resolveSurfaceOptics(undefined, 1)).toBeUndefined();
    expect(resolveSurfaceOptics({ model: "dielectric" }, 1)).toBeDefined();
    // A future model id on an old binary means "no optics here" — the same
    // quiet fallback the finish decoder's unknown-field rule gives.
    expect(
      resolveSurfaceOptics({ model: "layered" as "dielectric", scale: 2 }, 1),
    ).toBeUndefined();
  });

  it("rides the qualified constants as defaults and multiplies the derived radius", () => {
    const resolved = resolveSurfaceOptics({ model: "dielectric" }, 1.34);
    expect(resolved).toEqual({
      ior: DIELECTRIC_IOR,
      absorption: [...DIELECTRIC_ABSORPTION],
      radius: 1.34,
      distortion: 0,
    });
    const scaled = resolveSurfaceOptics(
      { model: "dielectric", scale: 2 },
      1.34,
    );
    expect(scaled?.radius).toBe(2.68);
  });

  it("keeps the resolved shape a DielectricMaterial verbatim", () => {
    const resolved = resolveSurfaceOptics(
      { model: "dielectric", scale: 0.5 },
      2,
    );
    const material: DielectricMaterial | undefined = resolved;
    expect(material).toEqual({
      ior: DIELECTRIC_IOR,
      absorption: [...DIELECTRIC_ABSORPTION],
      radius: 1,
      distortion: 0,
    });
  });

  it("defaults a non-finite scale to the qualified 1 and clamps finite ones into the band", () => {
    expect(
      resolveSurfaceOptics({ model: "dielectric", scale: Number.NaN }, 2)
        ?.radius,
    ).toBe(2);
    expect(
      resolveSurfaceOptics(
        { model: "dielectric", scale: Number.POSITIVE_INFINITY },
        2,
      )?.radius,
    ).toBe(2);
    expect(
      resolveSurfaceOptics({ model: "dielectric", scale: 1e-9 }, 2)?.radius,
    ).toBe(2 * SURFACE_OPTICS_SCALE_FLOOR);
    expect(
      resolveSurfaceOptics({ model: "dielectric", scale: 1e9 }, 2)?.radius,
    ).toBe(2 * SURFACE_OPTICS_SCALE_CEILING);
    expect(
      resolveSurfaceOptics({ model: "dielectric", scale: 0.5 }, 2)?.radius,
    ).toBe(1);
  });

  it("refuses a broken derived radius only when a slot actually authors optics", () => {
    // Absent optics never reads the radius — the common session is total.
    expect(resolveSurfaceOptics(undefined, Number.NaN)).toBeUndefined();
    expect(() =>
      resolveSurfaceOptics({ model: "dielectric" }, Number.NaN),
    ).toThrow(TypeError);
    expect(() => resolveSurfaceOptics({ model: "dielectric" }, 0)).toThrow(
      TypeError,
    );
    expect(() => resolveSurfaceOptics({ model: "dielectric" }, -1)).toThrow(
      TypeError,
    );
  });

  it("resolves the distortion through its own band — absent/invalid means the straight 0", () => {
    // Absent and non-finite resolve to the straight 0.
    expect(resolveSurfaceOptics({ model: "dielectric" }, 2)?.distortion).toBe(
      0,
    );
    expect(
      resolveSurfaceOptics({ model: "dielectric", distortion: Number.NaN }, 2)
        ?.distortion,
    ).toBe(0);
    // Negative clamps to 0; past the ceiling clamps down; an authored value
    // inside the band rides.
    expect(
      resolveSurfaceOptics({ model: "dielectric", distortion: -0.5 }, 2)
        ?.distortion,
    ).toBe(0);
    expect(
      resolveSurfaceOptics({ model: "dielectric", distortion: 1e9 }, 2)
        ?.distortion,
    ).toBe(SURFACE_OPTICS_DISTORTION_CEILING);
    expect(
      resolveSurfaceOptics({ model: "dielectric", distortion: 0.08 }, 2)
        ?.distortion,
    ).toBe(0.08);
  });

  it("resolves the authored glass index inside its band and defaults outside", () => {
    // Absent and non-finite resolve to the qualified default byte-identically.
    expect(resolveSurfaceOptics({ model: "dielectric" }, 2)?.ior).toBe(
      DIELECTRIC_IOR,
    );
    expect(
      resolveSurfaceOptics({ model: "dielectric", ior: Number.NaN }, 2)?.ior,
    ).toBe(DIELECTRIC_IOR);
    // The band's own edges ride; the bench's two-glass index is inside.
    expect(
      resolveSurfaceOptics(
        { model: "dielectric", ior: SURFACE_OPTICS_IOR_FLOOR },
        2,
      )?.ior,
    ).toBe(SURFACE_OPTICS_IOR_FLOOR);
    expect(
      resolveSurfaceOptics(
        { model: "dielectric", ior: SURFACE_OPTICS_IOR_CEILING },
        2,
      )?.ior,
    ).toBe(SURFACE_OPTICS_IOR_CEILING);
    expect(
      resolveSurfaceOptics({ model: "dielectric", ior: 1.7 }, 2)?.ior,
    ).toBe(1.7);
  });

  it("refuses an out-of-band glass index rather than clamping it", () => {
    // Below the floor (faster than light at 1; air at exactly 1) and past
    // the ceiling, the block is garbage — the unknown-model rule: the WHOLE
    // block drops to the classic state, never a clamped different medium.
    // A clamp would silently merge two authored media (the per-map media
    // codes key on the resolved lanes), so the bend the author asked for
    // would vanish without a trace; a refused block renders its map opaque
    // and visibly so.
    for (const bad of [1, 0.9, SURFACE_OPTICS_IOR_CEILING + 0.01, 1e9]) {
      expect(
        resolveSurfaceOptics({ model: "dielectric", ior: bad }, 2),
      ).toBeUndefined();
    }
    // The refusal is the block's, not the leaf's: no partial optics with a
    // substituted index ever resolves.
    expect(
      resolveSurfaceOptics(
        { model: "dielectric", ior: 0.9, scale: 2, distortion: 0.1 },
        2,
      ),
    ).toBeUndefined();
  });
});
