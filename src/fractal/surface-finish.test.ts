import {
  CLASSIC_SURFACE_FINISH,
  SURFACE_FINISH_GLSL,
  SURFACE_FINISH_SHININESS_FLOOR,
  SURFACE_FINISH_WGSL,
  finishShadeTs,
  isClassicSurfaceFinish,
  resolveSurfaceFinish,
  surfaceFinishLanes,
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

describe("surfaceFinishLanes", () => {
  it("packs a = (specular, shininess, metalness, reflect) and b = (transmit, 0, 0, 0)", () => {
    expect(
      surfaceFinishLanes({
        specular: 0.7,
        shininess: 96,
        metalness: 1,
        reflect: 0.6,
        transmit: 0.25,
      }),
    ).toEqual({ a: [0.7, 96, 1, 0.6], b: [0.25, 0, 0, 0] });
  });

  it("zero-fills the reserved Tier-2 pattern lanes", () => {
    const { b } = surfaceFinishLanes(CLASSIC_SURFACE_FINISH);
    expect(b[1]).toBe(0);
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
    const upReflecting = finishShadeTs(
      dark,
      tilted,
      [-1, 0, 0],
      1,
      1,
      bg,
      chrome,
      { ...env, envStrength: 0 },
    );
    const sideReflecting = finishShadeTs(
      dark,
      tilted,
      [0, -1, 0],
      1,
      1,
      bg,
      chrome,
      { ...env, envStrength: 0 },
    );
    // Up-reflection reads the pure red top stop: red-dominant, and redder
    // than the midpoint the sideways reflection reads.
    expect(upReflecting[0]).toBeGreaterThan(upReflecting[2] + 0.05);
    expect(upReflecting[0]).toBeGreaterThan(sideReflecting[0] + 0.02);
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
});
