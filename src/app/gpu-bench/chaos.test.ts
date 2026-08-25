import { describe, expect, it } from "vitest";
import { presetTransforms } from "../../fractal/presets";
import { buildSurfaceDE } from "../../fractal/surface-de";
import { buildSurfaceDE4 } from "../../fractal/surface-de-4d";
import {
  SURFACE_GPU_MAP4_VEC4,
  SURFACE_GPU_MAP_VEC4,
  SURFACE_GPU_PARAMS4_CHAOS_BYTES,
  SURFACE_GPU_PARAMS_CHAOS_BYTES,
  packSurface4GpuParams,
  packSurfaceGpuMaps,
  packSurfaceGpuMaps4,
  packSurfaceGpuParams,
  surfaceDeKernelWgsl,
} from "../../fractal/surface-de-gpu";
import {
  surfaceChaosFrameAcceptance,
  surfaceChaosKernelSpec,
  surfaceChaosMarchAcceptance,
} from "./chaos";

describe("graph-directed Surface benchmark fixture", () => {
  it("projects the shipped isolated fern/sponge graph at the 24-state cap", () => {
    const transforms = presetTransforms("fernSponge");
    const de3 = buildSurfaceDE(transforms);
    const de4 = buildSurfaceDE4(transforms);
    const spec3 = surfaceChaosKernelSpec(de3);
    const spec4 = surfaceChaosKernelSpec(de4);

    expect(de3.maps).toHaveLength(24);
    expect(de4.maps).toHaveLength(24);
    expect(spec3.activeStateCount).toBe(24);
    expect(spec4.activeStateCount).toBe(24);
    expect(Array.from(spec3.predecessorMasks)).toEqual([
      ...new Array<number>(4).fill(0x00000f),
      ...new Array<number>(20).fill(0xfffff0),
    ]);
    expect(Array.from(spec4.predecessorMasks)).toEqual(
      Array.from(spec3.predecessorMasks),
    );
    expect(packSurfaceGpuMaps(de3).byteLength).toBe(
      24 * SURFACE_GPU_MAP_VEC4 * 16,
    );
    expect(packSurfaceGpuMaps4(de4).byteLength).toBe(
      24 * SURFACE_GPU_MAP4_VEC4 * 16,
    );
    expect(packSurfaceGpuParams(de3, { itemCount: 1 }).byteLength).toBe(
      SURFACE_GPU_PARAMS_CHAOS_BYTES,
    );
    expect(
      packSurface4GpuParams(
        de4,
        {
          rotor: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
          w0: 0,
          sliceHalfW: 0,
        },
        { itemCount: 1 },
      ).byteLength,
    ).toBe(SURFACE_GPU_PARAMS4_CHAOS_BYTES);

    for (const [core, spec] of [
      ["affine", spec3],
      ["affine4", spec4],
    ] as const) {
      const wgsl = surfaceDeKernelWgsl({
        mode: "eval",
        core,
        width: 4,
        workgroupSize: 64,
        sharedFrontier: false,
        bnbStage2: false,
        chaos: spec,
      });
      expect(wgsl).toContain("fn chaosAllows(source: u32, current: u32)");
      expect(wgsl).toContain("source < 24u");
      expect(wgsl).toContain("params.chaosMask5[lane]");
    }
  });

  it("refuses to let an xaos row silently compile the classic kernel", () => {
    expect(() =>
      surfaceChaosKernelSpec(buildSurfaceDE(presetTransforms("sierpinski"))),
    ).toThrow("has no active chaos graph");
  });

  it("requires a completed, dispatched, agreeing mixed ray result", () => {
    const useful = {
      rays: 100,
      gpuHits: 24,
      cpuHits: 25,
      passes: 3,
      failures: 0,
      truncated: false,
    };
    expect(surfaceChaosMarchAcceptance(useful)).toMatchObject({
      ok: true,
      activated: true,
      completed: true,
      agreed: true,
      gpuUseful: true,
      cpuUseful: true,
    });
    expect(surfaceChaosMarchAcceptance({ ...useful, passes: 0 }).ok).toBe(
      false,
    );
    expect(
      surfaceChaosMarchAcceptance({ ...useful, gpuHits: 0, cpuHits: 0 }).ok,
    ).toBe(false);
    expect(
      surfaceChaosMarchAcceptance({
        ...useful,
        gpuHits: useful.rays,
        cpuHits: useful.rays,
      }).ok,
    ).toBe(false);
    expect(surfaceChaosMarchAcceptance({ ...useful, truncated: true }).ok).toBe(
      false,
    );
    expect(surfaceChaosMarchAcceptance({ ...useful, failures: 1 }).ok).toBe(
      false,
    );
  });

  it("requires useful geometry and clean real-adapter terminal statuses", () => {
    const useful = {
      passes: 4,
      truncated: false,
      counts: { hit: 30, miss: 70, exhausted: 0, active: 0 },
    };
    expect(surfaceChaosFrameAcceptance(useful, false)).toEqual({
      ok: true,
      activated: true,
      geometry: true,
      settled: true,
    });
    expect(
      surfaceChaosFrameAcceptance({ ...useful, passes: 0 }, false).ok,
    ).toBe(false);
    expect(
      surfaceChaosFrameAcceptance(
        { ...useful, counts: { ...useful.counts, hit: 0 } },
        false,
      ).ok,
    ).toBe(false);
    expect(
      surfaceChaosFrameAcceptance(
        {
          passes: 1,
          truncated: false,
          counts: { hit: 1, miss: 0, exhausted: 2, active: 0 },
        },
        true,
      ).ok,
    ).toBe(true);
    expect(
      surfaceChaosFrameAcceptance(
        { ...useful, counts: { ...useful.counts, miss: 0 } },
        false,
      ).ok,
    ).toBe(false);
    expect(
      surfaceChaosFrameAcceptance(
        { ...useful, counts: { ...useful.counts, exhausted: 1 } },
        false,
      ).ok,
    ).toBe(false);
    expect(
      surfaceChaosFrameAcceptance(
        {
          passes: 1,
          truncated: true,
          counts: { hit: 1, miss: 0, exhausted: 0, active: 99 },
        },
        true,
      ).ok,
    ).toBe(true);
    expect(
      surfaceChaosFrameAcceptance(
        {
          passes: 1,
          truncated: true,
          counts: { hit: 1, miss: 0, exhausted: 0, active: 99 },
        },
        false,
      ).ok,
    ).toBe(false);
  });
});
