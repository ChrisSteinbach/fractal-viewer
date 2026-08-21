import {
  CLASSIC_SURFACE_FINISH,
  MARBLE_VEIN_DARKEN,
  MARBLE_VEIN_HALF_WIDTH,
  SURFACE_FINISH_GLSL,
  SURFACE_FINISH_SHININESS_FLOOR,
  SURFACE_FINISH_WGSL,
  SURFACE_PATTERN_MARBLE,
  SURFACE_PATTERN_NONE,
  SURFACE_PATTERN_WOOD,
  WOOD_LATEWOOD_DARKEN,
  finishShadeTs,
  isClassicSurfaceFinish,
  resolveSurfaceFinish,
  surfaceFinishLanes,
  surfaceFinishPatternAlbedo,
  surfaceFinishShadeSource,
  type SurfaceFinishShadeEnv,
} from "./surface-finish";
import type { Vec3 } from "./types";

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
        reflectionTint: NaN,
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

  it("defaults reflection tint to colored metal and clamps it into [0, 1]", () => {
    expect(resolveSurfaceFinish({}).reflectionTint).toBe(1);
    expect(resolveSurfaceFinish({ reflectionTint: -1 }).reflectionTint).toBe(0);
    expect(resolveSurfaceFinish({ reflectionTint: 2 }).reflectionTint).toBe(1);
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

  it("is false when reflection tint resolves away from classic", () => {
    expect(isClassicSurfaceFinish({ reflectionTint: 0 })).toBe(false);
  });
});

describe("surfaceFinishLanes", () => {
  it("packs a = (specular, shininess, metalness, reflect) and b = (transmit, reflectionTint, 0, 0)", () => {
    expect(
      surfaceFinishLanes({
        specular: 0.7,
        shininess: 96,
        metalness: 1,
        reflect: 0.6,
        transmit: 0.25,
        reflectionTint: 0.5,
      }),
    ).toEqual({ a: [0.7, 96, 1, 0.6], b: [0.25, 0.5, 0, 0] });
  });

  it("packs classic reflection tint and zero-fills the two reserved lanes", () => {
    const { b } = surfaceFinishLanes(CLASSIC_SURFACE_FINISH);
    expect(b[1]).toBe(1);
    expect(b[2]).toBe(0);
    expect(b[3]).toBe(0);
  });
});

describe("surfaceFinishShadeSource dialects", () => {
  it("emits identical function bodies in both dialects once the per-dialect tokens are normalized away", () => {
    // The same discipline background-shape.test.ts pins for its own shared
    // body: the two emissions may differ ONLY in the declaration keyword,
    // the vec3 spelling, and the lighting accessors — normalize those away
    // and the arithmetic must match character for character.
    const body = (src: string): string =>
      src.slice(src.indexOf("{") + 1, src.lastIndexOf("}"));
    const canon = (s: string): string =>
      s
        .replace(/\bshade\.lightDir\b/g, "LIGHTDIR")
        .replace(/\buLightDir\b/g, "LIGHTDIR")
        .replace(/\bshade\.ambient\b/g, "AMBIENT")
        .replace(/\buAmbient\b/g, "AMBIENT")
        .replace(/\bshade\.envStrength\b/g, "ENV")
        .replace(/\buEnvLight\b/g, "ENV")
        .replace(/\bshade\.bgTop\b/g, "BGTOP")
        .replace(/\buBgTop\b/g, "BGTOP")
        .replace(/\bshade\.bgBottom\b/g, "BGBOT")
        .replace(/\buBgBottom\b/g, "BGBOT")
        .replace(/\bvec3f\b/g, "vec3")
        .replace(/^(\s*)(?:let|vec3|float)\s+/gm, "$1DECL ");
    const glsl = canon(body(surfaceFinishShadeSource(SURFACE_FINISH_GLSL)));
    const wgsl = canon(body(surfaceFinishShadeSource(SURFACE_FINISH_WGSL)));
    expect(glsl).toBe(wgsl);
  });

  it("emits the dialect's own signature and reads only lane fields plus the dialect accessors", () => {
    const glsl = surfaceFinishShadeSource(SURFACE_FINISH_GLSL);
    expect(glsl).toContain(
      "vec3 finishShade(vec3 base, vec3 n, vec3 rd, float shadow, float ao, vec3 bg, vec4 fa, vec4 fb)",
    );
    expect(glsl).not.toContain("shade.");
    const wgsl = surfaceFinishShadeSource(SURFACE_FINISH_WGSL);
    expect(wgsl).toContain(
      "fn finishShade(base: vec3f, n: vec3f, rd: vec3f, shadow: f32, ao: f32, bg: vec3f, fa: vec4f, fb: vec4f) -> vec3f",
    );
    expect(wgsl).not.toContain("uLightDir");
  });

  it("emits the authorable room branch in world units, never pixels", () => {
    const glsl = surfaceFinishShadeSource(SURFACE_FINISH_GLSL, true);
    expect(glsl).toContain(
      "vec3 finishShade(vec3 base, vec3 pos, vec3 n, vec3 rd",
    );
    expect(glsl).toContain("uGroundBallR * uGroundTileScale");
    expect(glsl).toContain("floorP.xz - uGroundBallC.xz");
    expect(glsl).not.toContain("uPixelEps");

    const wgsl = surfaceFinishShadeSource(SURFACE_FINISH_WGSL, true);
    expect(wgsl).toContain(
      "fn finishShade(base: vec3f, pos: vec3f, n: vec3f, rd: vec3f",
    );
    expect(wgsl).toContain("params.groundBallR * shade.balloonTint.x");
    expect(wgsl).not.toContain("pixelEps");
  });
});

describe("finishShadeTs classic params", () => {
  // Today's fixed composition, spelled exactly as the three tracer sites
  // spell it (surface-material.ts ~3301, surface-material-4d.ts ~1902,
  // surface-de-gpu.ts shadeRays): the reference the classic-params claim is
  // pinned against.
  function classicReference(
    base: Vec3,
    n: Vec3,
    rd: Vec3,
    shadow: number,
    ao: number,
    env: SurfaceFinishShadeEnv,
  ): Vec3 {
    const mix = (x: number, y: number, t: number): number =>
      x * (1 - t) + y * t;
    const dot3 = (a: Vec3, b: Vec3): number =>
      a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const diffuse = Math.max(dot3(n, env.lightDir), 0);
    const halfRaw: Vec3 = [
      env.lightDir[0] - rd[0],
      env.lightDir[1] - rd[1],
      env.lightDir[2] - rd[2],
    ];
    const halfLen = Math.sqrt(dot3(halfRaw, halfRaw));
    const halfVec: Vec3 = [
      halfRaw[0] / halfLen,
      halfRaw[1] / halfLen,
      halfRaw[2] / halfLen,
    ];
    const specular = Math.pow(Math.max(dot3(n, halfVec), 0), 32.0) * 0.4;
    const envY = n[1] * 0.5 + 0.5;
    const envE: Vec3 = [
      mix(env.bgBottom[0], env.bgTop[0], envY),
      mix(env.bgBottom[1], env.bgTop[1], envY),
      mix(env.bgBottom[2], env.bgTop[2], envY),
    ];
    const envMax = Math.max(
      Math.max(envE[0], Math.max(envE[1], envE[2])),
      1e-4,
    );
    const out: Vec3 = [0, 0, 0];
    for (let i = 0 as 0 | 1 | 2; i < 3; i++) {
      const envTint = mix(1, envE[i] / envMax, env.envStrength);
      const lit =
        (env.ambient * ao + (1 - env.ambient) * diffuse * shadow) * envTint;
      const linBase = Math.pow(base[i], 2.2);
      out[i] = Math.pow(linBase * lit + specular * shadow, 1 / 2.2);
    }
    return out;
  }

  const norm = (v: Vec3): Vec3 => {
    const l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    return [v[0] / l, v[1] / l, v[2] / l];
  };

  it("reproduces today's fixed formula EXACTLY on a grid of poses, lights and backdrops", () => {
    const envs: SurfaceFinishShadeEnv[] = [
      {
        lightDir: norm([0.5, 0.8, 0.3]),
        ambient: 0.25,
        envStrength: 0,
        bgTop: [0.05, 0.05, 0.09],
        bgBottom: [0.12, 0.13, 0.22],
        floor: {
          y: -1,
          ballCenter: [0, 0, 0],
          ballRadius: 1,
          albedo: [0.6, 0.6, 0.6],
          pattern: 1,
          tileScale: 0.64,
          emission: 1.4,
        },
      },
      {
        lightDir: norm([-0.4, 0.6, -0.7]),
        ambient: 0.25,
        envStrength: 0.35,
        bgTop: [0.24, 0.29, 0.45],
        bgBottom: [0.36, 0.43, 0.61],
      },
      {
        lightDir: norm([0.1, -0.2, 0.97]),
        ambient: 0.4,
        envStrength: 1,
        bgTop: [0.9, 0.3, 0.1],
        bgBottom: [0.02, 0.4, 0.6],
      },
    ];
    const normals: Vec3[] = [
      norm([0, 1, 0]),
      norm([0.7, -0.2, 0.7]),
      norm([-0.3, 0.5, -0.8]),
    ];
    const rds: Vec3[] = [norm([0, -0.3, -1]), norm([0.6, -0.5, 0.6])];
    const bases: Vec3[] = [
      [1, 1, 1],
      [0.8, 0.2, 0.1],
      [0.1, 0.3, 0.9],
    ];
    const bg: Vec3 = [0.5, 0.6, 0.7];
    let cases = 0;
    for (const env of envs)
      for (const n of normals)
        for (const rd of rds)
          for (const base of bases)
            for (const shadow of [0, 0.37, 1])
              for (const ao of [0.15, 1]) {
                const got = finishShadeTs(
                  base,
                  n,
                  rd,
                  shadow,
                  ao,
                  bg,
                  CLASSIC_SURFACE_FINISH,
                  env,
                  [0, 1, 0],
                );
                const want = classicReference(base, n, rd, shadow, ao, env);
                expect(got[0]).toBe(want[0]);
                expect(got[1]).toBe(want[1]);
                expect(got[2]).toBe(want[2]);
                cases++;
              }
    expect(cases).toBe(324);
  });
});

describe("finishShadeTs parametric behavior", () => {
  const env: SurfaceFinishShadeEnv = {
    lightDir: [0, 1, 0],
    ambient: 0.25,
    envStrength: 0,
    bgTop: [0.8, 0.1, 0.1],
    bgBottom: [0.1, 0.1, 0.8],
  };
  const n: Vec3 = [0, 1, 0];
  const bg: Vec3 = [0.3, 0.3, 0.3];

  it("metalness 1 kills the diffuse body: a lit surface with no reflection and no highlight goes black", () => {
    // Graze the light (diffuse > 0) but aim the half-vector far off the
    // normal so the specular lobe is ~0; with metalness 1 the diffuse term
    // is damped to zero and nothing else contributes.
    const rd: Vec3 = [1, 0, 0];
    const got = finishShadeTs(
      [1, 1, 1],
      n,
      rd,
      1,
      1,
      bg,
      { ...CLASSIC_SURFACE_FINISH, metalness: 1, specular: 0 },
      env,
    );
    expect(got[0]).toBe(0);
    expect(got[1]).toBe(0);
    expect(got[2]).toBe(0);
  });

  it("reflect samples the backdrop along the REFLECTED direction, not the normal", () => {
    // One tilted normal, two view directions at the SAME incidence angle
    // (same fresnel weight): view A reflects straight UP (t = 1, the red
    // top stop), view B reflects sideways (t = 0.5, the stops' midpoint).
    // Only a reflected-direction sample moves between the two — the normal,
    // and hence any normal-keyed sample, is held fixed.
    const tilted = ((): Vec3 => {
      const l = Math.sqrt(2);
      return [1 / l, 1 / l, 0];
    })();
    const dark: Vec3 = [0, 0, 0];
    const chrome = { ...CLASSIC_SURFACE_FINISH, specular: 0, reflect: 1 };
    // The light points along +z here, AWAY from both reflected directions
    // below: the environment now carries a sun along the light, and the
    // first of these poses reflects straight up — which is where this
    // test used to put the light, so the sun swamped the very stop it
    // was checking. Aiming the light out of the way isolates the stops.
    const sideLit = { ...env, envStrength: 0, lightDir: [0, 0, 1] as Vec3 };
    const upReflecting = finishShadeTs(
      dark,
      tilted,
      [-1, 0, 0],
      1,
      1,
      bg,
      chrome,
      sideLit,
    );
    const sideReflecting = finishShadeTs(
      dark,
      tilted,
      [0, -1, 0],
      1,
      1,
      bg,
      chrome,
      sideLit,
    );
    // Up-reflection reads the pure red top stop: red-dominant, and redder
    // than the midpoint the sideways reflection reads.
    expect(upReflecting[0]).toBeGreaterThan(upReflecting[2] + 0.05);
    expect(upReflecting[0]).toBeGreaterThan(sideReflecting[0] + 0.02);
  });

  it("the reflected environment carries a SUN along the light — the structure that lets a metal read as metal", () => {
    // Two mirror surfaces differing ONLY in whether their reflected
    // direction points at the light. Against a near-black backdrop the
    // stops alone cannot tell them apart; the sun disc must.
    const dark: Vec3 = [0, 0, 0];
    const nearBlack: SurfaceFinishShadeEnv = {
      lightDir: [0, 1, 0],
      ambient: 0.25,
      envStrength: 0,
      bgTop: [0.05, 0.05, 0.09],
      bgBottom: [0.12, 0.13, 0.22],
    };
    const chrome = { ...CLASSIC_SURFACE_FINISH, specular: 0, reflect: 1 };
    // Facing up, viewed straight down: reflect(rd, n) is +y — the sun.
    const atSun = finishShadeTs(
      dark,
      [0, 1, 0],
      [0, -1, 0],
      1,
      1,
      [0, 0, 0],
      chrome,
      nearBlack,
    );
    // A tilted mirror whose reflection misses the sun entirely.
    const away = finishShadeTs(
      dark,
      [0.7071, 0.7071, 0],
      [0, -1, 0],
      1,
      1,
      [0, 0, 0],
      chrome,
      nearBlack,
    );
    expect(atSun[0]).toBeGreaterThan(0.5);
    expect(atSun[0]).toBeGreaterThan(away[0] + 0.3);
  });

  it("transmit 1 head-on approaches the pixel's own backdrop", () => {
    const rd: Vec3 = [0, -1, 0]; // head-on: dot(n, -rd) = 1, fresnel = f0
    const got = finishShadeTs(
      [1, 0.5, 0.25],
      n,
      rd,
      1,
      1,
      bg,
      { ...CLASSIC_SURFACE_FINISH, specular: 0, transmit: 1 },
      env,
    );
    // fresnel = 0.04 head-on at metalness 0, so 96% of the pixel is bg.
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(got[i] - bg[i])).toBeLessThan(0.08);
    }
  });

  it("fresnel rises toward grazing: transmit passes less backdrop at a shallow view than head-on", () => {
    const headOn = finishShadeTs(
      [0, 0, 0],
      n,
      [0, -1, 0],
      1,
      1,
      [1, 1, 1],
      { ...CLASSIC_SURFACE_FINISH, specular: 0, transmit: 1 },
      env,
    );
    const grazeRd = ((): Vec3 => {
      const l = Math.sqrt(1 + 0.02 * 0.02);
      return [1 / l, -0.02 / l, 0];
    })();
    const grazing = finishShadeTs(
      [0, 0, 0],
      n,
      grazeRd,
      1,
      1,
      [1, 1, 1],
      { ...CLASSIC_SURFACE_FINISH, specular: 0, transmit: 1 },
      env,
    );
    // Against a white bg through a black shell: more transmitted light =
    // brighter. Head-on transmits ~96%; grazing fresnel ~1 transmits ~0.
    expect(headOn[0]).toBeGreaterThan(0.9);
    expect(grazing[0]).toBeLessThan(0.4);
  });

  it("a metal's highlight carries its own albedo", () => {
    // Put the half-vector ON the normal so the specular lobe is 1: light
    // straight down the normal, view straight up it.
    const rd: Vec3 = [0, -1, 0];
    const got = finishShadeTs(
      [1, 0.2, 0.1],
      n,
      rd,
      1,
      0,
      bg,
      { ...CLASSIC_SURFACE_FINISH, metalness: 1, specular: 1, shininess: 4 },
      { ...env, ambient: 0 },
    );
    // Diffuse is metal-damped and ambient is 0, so only the tinted lobe
    // remains: red-dominant like the albedo, not white like the classic.
    expect(got[0]).toBeGreaterThan(got[1] * 1.5);
    expect(got[0]).toBeGreaterThan(got[2] * 1.5);
  });

  it("Chrome's zero tint makes a saturated transform's metal response achromatic", () => {
    const got = finishShadeTs(
      [1, 0.05, 0.02],
      n,
      [0, -1, 0],
      1,
      0,
      bg,
      {
        ...CLASSIC_SURFACE_FINISH,
        metalness: 1,
        specular: 1,
        reflect: 0,
        reflectionTint: 0,
      },
      { ...env, ambient: 0 },
    );
    expect(got[0]).toBeCloseTo(got[1], 12);
    expect(got[1]).toBeCloseTo(got[2], 12);
  });
});

describe("surfaceFinishPatternAlbedo", () => {
  const base: Vec3 = [0.72, 0.5, 0.3];
  const q = { rings: 0.37, sheets: 0.61, p: [0.1, -0.2, 0.3] as Vec3 };

  it("kind none returns the base exactly", () => {
    const got = surfaceFinishPatternAlbedo(
      base,
      { kind: SURFACE_PATTERN_NONE, scale: 12, strength: 1 },
      q,
    );
    expect(got[0]).toBe(base[0]);
    expect(got[1]).toBe(base[1]);
    expect(got[2]).toBe(base[2]);
  });

  it("an unrecognized kind reads as none", () => {
    expect(
      surfaceFinishPatternAlbedo(base, { kind: 7, scale: 12, strength: 1 }, q),
    ).toEqual(base);
  });

  it("strength 0 returns the base exactly for both kinds", () => {
    for (const kind of [SURFACE_PATTERN_WOOD, SURFACE_PATTERN_MARBLE]) {
      // Pick the trap value that lands ON the darkest part of the period, so
      // the patterned albedo is as far from base as the kind allows and the
      // identity is carried by the mix's spelling alone.
      const dark =
        kind === SURFACE_PATTERN_WOOD
          ? { rings: 0.85 / 12, sheets: 0, p: q.p }
          : { rings: 0, sheets: 0.5 / 12, p: q.p };
      const got = surfaceFinishPatternAlbedo(
        base,
        { kind, scale: 12, strength: 0 },
        dark,
      );
      expect(got[0]).toBe(base[0]);
      expect(got[1]).toBe(base[1]);
      expect(got[2]).toBe(base[2]);
    }
  });

  it("stays inside [0, 1] for in-range inputs", () => {
    const bases: Vec3[] = [
      [0, 0, 0],
      [1, 1, 1],
      [0.72, 0.5, 0.3],
      [0.05, 0.9, 0.4],
    ];
    let cases = 0;
    for (const kind of [SURFACE_PATTERN_WOOD, SURFACE_PATTERN_MARBLE])
      for (const scale of [0, 1, 7.3, 40])
        for (const strength of [0, 0.5, 1])
          for (const b of bases)
            for (let i = 0; i <= 40; i++) {
              const u = i / 40;
              const got = surfaceFinishPatternAlbedo(
                b,
                { kind, scale, strength },
                { rings: u, sheets: 1 - u, p: [0, 0, 0] },
              );
              for (const c of got) {
                expect(c).toBeGreaterThanOrEqual(0);
                expect(c).toBeLessThanOrEqual(1);
                expect(Number.isFinite(c)).toBe(true);
              }
              cases++;
            }
    expect(cases).toBe(2 * 4 * 3 * 4 * 41);
  });

  it("scale sets the band frequency: wood is periodic in rings with period 1/scale", () => {
    const at = (rings: number, scale: number): Vec3 =>
      surfaceFinishPatternAlbedo(
        base,
        { kind: SURFACE_PATTERN_WOOD, scale, strength: 1 },
        { rings, sheets: 0, p: [0, 0, 0] },
      );
    // One period on: the same albedo (up to fract's rounding).
    for (const rings of [0.03, 0.2, 0.41, 0.77]) {
      const a = at(rings, 8);
      const b = at(rings + 1 / 8, 8);
      expect(a[0]).toBeCloseTo(b[0], 9);
      expect(a[1]).toBeCloseTo(b[1], 9);
    }
    // Two scales disagree at a fixed query: 0.41 * 8 sits in the dark ramp
    // (fract 0.28), 0.41 * 12 sits at the ring's bright start (fract 0.92,
    // past the fall).
    const s8 = at(0.41, 8);
    const s12 = at(0.41, 12);
    expect(Math.abs(s8[0] - s12[0])).toBeGreaterThan(0.01);
  });

  it("wood: earlywood is the untouched base, latewood is the base times the darken factor", () => {
    const early = surfaceFinishPatternAlbedo(
      base,
      { kind: SURFACE_PATTERN_WOOD, scale: 10, strength: 1 },
      { rings: 0.05 / 10, sheets: 0, p: [0, 0, 0] },
    );
    expect(early).toEqual(base);
    const late = surfaceFinishPatternAlbedo(
      base,
      { kind: SURFACE_PATTERN_WOOD, scale: 10, strength: 1 },
      { rings: 0.85 / 10, sheets: 0, p: [0, 0, 0] },
    );
    expect(late[0]).toBeCloseTo(base[0] * WOOD_LATEWOOD_DARKEN, 12);
    expect(late[1]).toBeCloseTo(base[1] * WOOD_LATEWOOD_DARKEN, 12);
    expect(late[2]).toBeCloseTo(base[2] * WOOD_LATEWOOD_DARKEN, 12);
  });

  it("wood: the ring edge is sharp and the earlywood ramp is gradual", () => {
    const factor = (t: number): number =>
      surfaceFinishPatternAlbedo(
        [1, 1, 1],
        { kind: SURFACE_PATTERN_WOOD, scale: 1, strength: 1 },
        { rings: t, sheets: 0, p: [0, 0, 0] },
      )[0];
    // Across the 10% fall the factor recovers the whole latewood drop...
    expect(factor(0.9) - factor(0.999)).toBeCloseTo(
      WOOD_LATEWOOD_DARKEN - 1,
      3,
    );
    // ...while the same 10% of period inside the rise moves it far less.
    expect(Math.abs(factor(0.45) - factor(0.35))).toBeLessThan(0.2);
  });

  it("marble: a vein darkens the band centre and leaves the rest of the period exactly untouched", () => {
    const pat = { kind: SURFACE_PATTERN_MARBLE, scale: 5, strength: 1 };
    const centre = surfaceFinishPatternAlbedo(base, pat, {
      rings: 0,
      sheets: 0.5 / 5,
      p: [0, 0, 0],
    });
    expect(centre[0]).toBeCloseTo(base[0] * MARBLE_VEIN_DARKEN, 12);
    // Past the half-width the smoothstep saturates and the weight is 0
    // exactly, so the mix returns base bit for bit — the off-vein field of
    // a marble is the plain albedo, not a faintly tinted one.
    const off = surfaceFinishPatternAlbedo(base, pat, {
      rings: 0,
      sheets: (0.5 + MARBLE_VEIN_HALF_WIDTH * 1.5) / 5,
      p: [0, 0, 0],
    });
    expect(off).toEqual(base);
    const wrap = surfaceFinishPatternAlbedo(base, pat, {
      rings: 0,
      sheets: 0.01 / 5,
      p: [0, 0, 0],
    });
    expect(wrap).toEqual(base);
  });

  it("strength scales the darkening linearly between base and the full pattern", () => {
    const pat = (strength: number) => ({
      kind: SURFACE_PATTERN_WOOD,
      scale: 10,
      strength,
    });
    const dark = { rings: 0.85 / 10, sheets: 0, p: [0, 0, 0] as Vec3 };
    const half = surfaceFinishPatternAlbedo(base, pat(0.5), dark);
    const full = surfaceFinishPatternAlbedo(base, pat(1), dark);
    expect(half[0]).toBeCloseTo((base[0] + full[0]) / 2, 12);
  });
});
