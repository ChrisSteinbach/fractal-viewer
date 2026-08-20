import {
  CLASSIC_SURFACE_FINISH,
  SURFACE_FINISH_SHININESS_FLOOR,
  isClassicSurfaceFinish,
  resolveSurfaceFinish,
} from "./surface-finish";

describe("resolveSurfaceFinish absent input", () => {
  it("resolves an absent finish to the classic values", () => {
    expect(resolveSurfaceFinish(undefined)).toEqual(CLASSIC_SURFACE_FINISH);
  });

  it("resolves an empty finish object to the classic values", () => {
    expect(resolveSurfaceFinish({})).toEqual(CLASSIC_SURFACE_FINISH);
  });

  it("resolves every field to classic when every field is NaN or Infinity", () => {
    expect(
      resolveSurfaceFinish({
        specular: NaN,
        shininess: Infinity,
        metalness: -Infinity,
        reflect: NaN,
        transmit: Infinity,
      }),
    ).toEqual(CLASSIC_SURFACE_FINISH);
  });
});

describe("resolveSurfaceFinish domain", () => {
  it("clamps specular to >= 0 with no ceiling", () => {
    expect(resolveSurfaceFinish({ specular: -3 }).specular).toBe(0);
    expect(resolveSurfaceFinish({ specular: 50 }).specular).toBe(50);
  });

  it("floors a non-positive shininess strictly above zero rather than falling back to classic", () => {
    expect(resolveSurfaceFinish({ shininess: 0 }).shininess).toBe(
      SURFACE_FINISH_SHININESS_FLOOR,
    );
    expect(resolveSurfaceFinish({ shininess: -10 }).shininess).toBe(
      SURFACE_FINISH_SHININESS_FLOOR,
    );
  });

  it("leaves an in-domain shininess untouched", () => {
    expect(resolveSurfaceFinish({ shininess: 4 }).shininess).toBe(4);
  });

  it("clamps metalness into [0, 1]", () => {
    expect(resolveSurfaceFinish({ metalness: -1 }).metalness).toBe(0);
    expect(resolveSurfaceFinish({ metalness: 2 }).metalness).toBe(1);
    expect(resolveSurfaceFinish({ metalness: 0.7 }).metalness).toBe(0.7);
  });

  it("clamps reflect into [0, 1]", () => {
    expect(resolveSurfaceFinish({ reflect: -1 }).reflect).toBe(0);
    expect(resolveSurfaceFinish({ reflect: 2 }).reflect).toBe(1);
    expect(resolveSurfaceFinish({ reflect: 0.3 }).reflect).toBe(0.3);
  });

  it("clamps transmit into [0, 1]", () => {
    expect(resolveSurfaceFinish({ transmit: -1 }).transmit).toBe(0);
    expect(resolveSurfaceFinish({ transmit: 2 }).transmit).toBe(1);
    expect(resolveSurfaceFinish({ transmit: 0.9 }).transmit).toBe(0.9);
  });

  it("resolves one authored field independently, leaving the rest classic", () => {
    expect(resolveSurfaceFinish({ metalness: 0.6 })).toEqual({
      ...CLASSIC_SURFACE_FINISH,
      metalness: 0.6,
    });
  });
});

describe("isClassicSurfaceFinish", () => {
  it("is true for an absent finish", () => {
    expect(isClassicSurfaceFinish(undefined)).toBe(true);
  });

  it("is true for an empty finish object", () => {
    expect(isClassicSurfaceFinish({})).toBe(true);
  });

  it("is true when every field is spelled out at its own classic value", () => {
    expect(
      isClassicSurfaceFinish({
        specular: 0.4,
        shininess: 32,
        metalness: 0,
        reflect: 0,
        transmit: 0,
      }),
    ).toBe(true);
  });

  it("is true when a field is non-finite, since it resolves to classic anyway", () => {
    expect(isClassicSurfaceFinish({ specular: NaN })).toBe(true);
    expect(isClassicSurfaceFinish({ metalness: Infinity })).toBe(true);
  });

  it("is false when specular resolves away from classic", () => {
    expect(isClassicSurfaceFinish({ specular: 0.8 })).toBe(false);
  });

  it("is false when shininess resolves away from classic", () => {
    expect(isClassicSurfaceFinish({ shininess: 8 })).toBe(false);
  });

  it("is false when metalness resolves away from classic", () => {
    expect(isClassicSurfaceFinish({ metalness: 1 })).toBe(false);
  });

  it("is false when reflect resolves away from classic", () => {
    expect(isClassicSurfaceFinish({ reflect: 0.5 })).toBe(false);
  });

  it("is false when transmit resolves away from classic", () => {
    expect(isClassicSurfaceFinish({ transmit: 0.5 })).toBe(false);
  });
});
