import {
  DEFAULT_SURFACE_LIGHTING,
  cloneSurfaceLighting,
  resolveSurfaceLighting,
  surfaceLightingLanes,
  surfaceLightingRuntime,
} from "./surface-lighting";
import {
  packSurfaceGpuShade,
  surfaceDeKernelWgsl,
  SURFACE_GPU_SHADE_LIGHTING_BYTES,
  type SurfaceGpuShadeParams,
} from "./surface-de-gpu";

describe("authored Surface lighting", () => {
  it("clones authoring without changing finite values or sharing mutable vectors", () => {
    const authored = cloneSurfaceLighting(DEFAULT_SURFACE_LIGHTING);
    authored.roughness = 0;
    authored.lights[0].normal = [2, -3, 4];
    const copy = cloneSurfaceLighting(authored);
    expect(copy).toEqual(authored);
    copy.lights[0].position[0] = 999;
    copy.lights[0].color[0] = 0.9;
    expect(authored.lights[0].position[0]).not.toBe(999);
    expect(authored.lights[0].color[0]).not.toBe(0.9);
  });

  it("resolves render domains while preserving explicit zero flux", () => {
    const authored = cloneSurfaceLighting(DEFAULT_SURFACE_LIGHTING);
    authored.lights.push(authored.lights[0]);
    authored.lights[0].normal = [0, 0, 0];
    authored.lights[0].intensity = 0;
    authored.roughness = 0;
    const resolved = resolveSurfaceLighting(authored);
    expect(resolved.lights).toHaveLength(2);
    expect(resolved.lights[0].normal).toEqual([0, -1, 0]);
    expect(resolved.lights[0].intensity).toBe(0);
    expect(resolved.roughness).toBeGreaterThan(0);
  });

  it("keeps sample quality separate from authored look in both dimensions", () => {
    const three = surfaceLightingRuntime({
      dimension: 3,
      boundingRadius: 2,
      sampleIndex: 5,
    });
    const four = surfaceLightingRuntime({
      dimension: 4,
      boundingRadius: 2,
      sampleIndex: 5,
    });
    expect(three).toEqual({
      surfaceSamples: 1,
      shadowSteps: 128,
      epsilon: 0.0004,
      sampleIndex: 5,
    });
    expect(four).toEqual({
      surfaceSamples: 1,
      shadowSteps: 256,
      epsilon: 0.0004,
      sampleIndex: 5,
    });
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
      expect(next.byteLength).toBe(384);
      expect(SURFACE_GPU_SHADE_LIGHTING_BYTES).toBe(384);
      expect(new Uint8Array(next, 0, legacy.byteLength)).toEqual(
        new Uint8Array(legacy),
      );
      expect(new Float32Array(next, 240)).toEqual(
        surfaceLightingLanes(DEFAULT_SURFACE_LIGHTING),
      );
    }
  });

  it("packs the runtime budget lane without moving an authored one", () => {
    const packed = packSurfaceGpuShade({
      ...shade,
      lighting: DEFAULT_SURFACE_LIGHTING,
      lightingRuntime: surfaceLightingRuntime({
        dimension: 4,
        boundingRadius: 1,
        sampleIndex: 7,
      }),
    });
    // Lane 8 is the last one: one surface sample, 4D's 256 shadow steps,
    // the pass index the per-pixel seed reads, and a spare word.
    expect(Array.from(new Float32Array(packed, 240 + 8 * 16, 4))).toEqual([
      1, 256, 7, 0,
    ]);
    // Lane 6's authored ambient/specular is where it always was (f32).
    expect(Array.from(new Float32Array(packed, 240 + 6 * 16, 4))).toEqual(
      Array.from(
        new Float32Array([
          ...DEFAULT_SURFACE_LIGHTING.ambient,
          DEFAULT_SURFACE_LIGHTING.specular,
        ]),
      ),
    );
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
          expect(lit).toContain("cinematic: array<vec4f, 9>");
          expect(lit).toContain("@binding(12) var cinematicBackgroundTex");
          expect(lit).toContain("return surfaceDE(p, 0.0, u32(workIndex))");
        }
      }
    },
  );
});
