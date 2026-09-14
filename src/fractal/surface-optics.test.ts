import {
  DIELECTRIC_ABSORPTION,
  DIELECTRIC_IOR,
  type DielectricMaterial,
} from "./surface-dielectric";
import {
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
});
