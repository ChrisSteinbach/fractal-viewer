import {
  DEFAULT_SURFACE_LIGHTING,
  cloneSurfaceLighting,
  resolveSurfaceLighting,
  surfaceHenyeyGreenstein,
  surfaceLightingLanes,
  surfaceLightingRuntime,
  surfaceMediumTransmittance,
} from "./surface-lighting";
import {
  packSurfaceGpuShade,
  surfaceDeKernelWgsl,
  SURFACE_GPU_SHADE_LIGHTING_BYTES,
  SURFACE_GPU_SHADE_LIGHTING_PHASE_OFFSET,
  type SurfaceGpuShadeParams,
} from "./surface-de-gpu";

describe("authored Surface lighting", () => {
  it("clones authoring without changing finite values or sharing mutable vectors", () => {
    const authored = cloneSurfaceLighting(DEFAULT_SURFACE_LIGHTING);
    authored.roughness = 0;
    authored.lights[0].normal = [2, -3, 4];
    authored.medium = {
      center: [1, 2, 3],
      radius: 2,
      density: 0,
      tint: [0.2, 0.3, 0.4],
      anisotropy: 0.98,
    };
    const copy = cloneSurfaceLighting(authored);
    expect(copy).toEqual(authored);
    copy.lights[0].position[0] = 999;
    copy.medium!.tint[0] = 0.9;
    expect(authored.lights[0].position[0]).not.toBe(999);
    expect(authored.medium.tint[0]).toBe(0.2);
  });

  it("resolves render domains while preserving explicit zero density and flux", () => {
    const authored = cloneSurfaceLighting(DEFAULT_SURFACE_LIGHTING);
    authored.lights.push(authored.lights[0]);
    authored.lights[0].normal = [0, 0, 0];
    authored.lights[0].intensity = 0;
    authored.roughness = 0;
    authored.medium = {
      center: [0, 0, 0],
      radius: 0,
      density: 0,
      tint: [-1, 0.5, 2],
      anisotropy: 1,
    };
    const resolved = resolveSurfaceLighting(authored);
    expect(resolved.lights).toHaveLength(2);
    expect(resolved.lights[0].normal).toEqual([0, -1, 0]);
    expect(resolved.lights[0].intensity).toBe(0);
    expect(resolved.roughness).toBeGreaterThan(0);
    expect(resolved.medium).toMatchObject({
      density: 0,
      tint: [0, 0.5, 1],
      anisotropy: 0.95,
    });
    expect(authored.medium.radius).toBe(0);
  });

  it("keeps sample quality separate from authored look in both dimensions", () => {
    const lighting = cloneSurfaceLighting(DEFAULT_SURFACE_LIGHTING);
    lighting.medium = {
      center: [0, 0, 0],
      radius: 3,
      density: 0.4,
      tint: [1, 1, 1],
      anisotropy: 0.4,
    };
    const preview = surfaceLightingRuntime(lighting, {
      interaction: true,
      dimension: 3,
      boundingRadius: 2,
      sampleIndex: 5,
    });
    const settled4 = surfaceLightingRuntime(lighting, {
      interaction: false,
      dimension: 4,
      boundingRadius: 2,
      sampleIndex: 5,
    });
    expect(preview).toMatchObject({
      surfaceSamples: 1,
      mediumSamples: 8,
      shadowSteps: 128,
      epsilon: 0.0004,
      sampleIndex: 5,
    });
    expect(settled4).toMatchObject({
      surfaceSamples: 1,
      mediumSamples: 32,
      shadowSteps: 256,
      epsilon: 0.0004,
      sampleIndex: 5,
    });
    lighting.medium.density = 0;
    expect(
      surfaceLightingRuntime(lighting, {
        interaction: false,
        dimension: 4,
        boundingRadius: 2,
      }).mediumSamples,
    ).toBe(0);
  });
});

describe("Surface medium arithmetic", () => {
  it("composes camera and light extinction without depending on segmentation", () => {
    expect(surfaceMediumTransmittance(0, Infinity)).toBe(1);
    const whole = surfaceMediumTransmittance(0.7, 2);
    const parts =
      surfaceMediumTransmittance(0.7, 0.8) *
      surfaceMediumTransmittance(0.7, 1.2);
    expect(parts).toBeCloseTo(whole, 14);
    expect(whole).toBeCloseTo(0.2465969639416065, 14);
  });

  it("normalizes HG and defines positive g as forward photon propagation", () => {
    for (const g of [-0.6, 0, 0.6]) {
      let integral = 0;
      for (let i = 0; i < 10_000; i++) {
        integral +=
          (surfaceHenyeyGreenstein(-1 + (i + 0.5) / 5000, g) * 4 * Math.PI) /
          10_000;
      }
      expect(integral).toBeCloseTo(1, 5);
    }
    expect(surfaceHenyeyGreenstein(1, 0.4)).toBeGreaterThan(
      surfaceHenyeyGreenstein(-1, 0.4),
    );
    for (const g of [1 - 1e-9, -1 + 1e-9]) {
      expect(Number.isFinite(surfaceHenyeyGreenstein(Math.sign(g), g))).toBe(
        true,
      );
    }
  });
});

const shade: SurfaceGpuShadeParams = {
  invProjView: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  lightDir: [0, 1, 0],
  ambient: 0.2,
  bgTop: [0.1, 0.2, 0.3],
  bgBottom: [0.01, 0.02, 0.03],
  colorSpeed: 0.5,
  tracePixelEps: 0.001,
  colorSource: 0,
  shadowSteps: 32,
  aoTaps: 5,
  dither: false,
  bgOffset: [0, 0],
  bgExtent: [80, 60],
  bgCenter: [0.5, 0.5],
  bgScale: [1, 1],
  bgShape: 0,
};

describe("Surface lighting append-only wire and compile gate", () => {
  it("preserves the full legacy and pattern prefixes before appending lighting", () => {
    for (const patternCalibration of [
      undefined,
      [0.1, 2, 0.3, 4] as [number, number, number, number],
    ]) {
      const legacy = packSurfaceGpuShade({ ...shade, patternCalibration });
      const next = packSurfaceGpuShade({
        ...shade,
        patternCalibration,
        lighting: DEFAULT_SURFACE_LIGHTING,
      });
      expect(next.byteLength).toBe(432);
      expect(SURFACE_GPU_SHADE_LIGHTING_BYTES).toBe(432);
      expect(new Uint8Array(next, 0, legacy.byteLength)).toEqual(
        new Uint8Array(legacy),
      );
      expect(new Float32Array(next, 240)).toEqual(
        surfaceLightingLanes(DEFAULT_SURFACE_LIGHTING),
      );
    }
  });

  it("lets compute patch only the phase quartet without moving authored lanes", () => {
    const runtime = {
      ...surfaceLightingRuntime(DEFAULT_SURFACE_LIGHTING, {
        interaction: false,
        dimension: 3,
        boundingRadius: 1,
      }),
      cellStart: 7,
      cellCount: 1,
      phase: 1 as const,
      lightIndex: 1,
    };
    const packed = packSurfaceGpuShade({
      ...shade,
      lighting: DEFAULT_SURFACE_LIGHTING,
      lightingRuntime: runtime,
    });
    expect(SURFACE_GPU_SHADE_LIGHTING_PHASE_OFFSET).toBe(416);
    expect(Array.from(new Float32Array(packed, 416, 4))).toEqual([7, 1, 1, 1]);
  });

  it.each([
    "affine",
    "fold",
    "affine4",
    "fold4",
    "escape",
    "escape4",
    "bulb",
  ] as const)(
    "keeps %s legacy shaders literal and adds transport only to shade",
    (core) => {
      for (const mode of ["eval", "march", "shade"] as const) {
        const base = {
          mode,
          core,
          width: 4,
          workgroupSize: 32,
          sharedFrontier: false,
          bnbStage2: false,
        };
        const absent = surfaceDeKernelWgsl(base);
        expect(surfaceDeKernelWgsl({ ...base, lighting: false })).toBe(absent);
        const lit = surfaceDeKernelWgsl({ ...base, lighting: true });
        if (mode !== "shade") expect(lit).toBe(absent);
        else {
          expect(lit).toContain("colorOut: array<vec4f>");
          expect(lit).toContain("cinematic: array<vec4f, 12>");
          expect(lit).toContain("@binding(12) var cinematicBackgroundTex");
          expect(lit).toContain("return surfaceDE(p, 0.0, u32(workIndex))");
        }
      }
    },
  );
});
