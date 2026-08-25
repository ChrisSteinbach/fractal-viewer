import { describe, expect, it } from "vitest";
import { PRESET_SCHEDULES, presetTransforms } from "../../fractal/presets";
import { buildSurfaceDE } from "../../fractal/surface-de";
import { buildSurfaceDE4 } from "../../fractal/surface-de-4d";
import {
  SURFACE_GPU_MAP4_VEC4,
  SURFACE_GPU_MAP_VEC4,
  packSurfaceGpuMaps,
  packSurfaceGpuMaps4,
  surfaceDeKernelWgsl,
} from "../../fractal/surface-de-gpu";
import {
  surfaceScheduleFrameAcceptance,
  surfaceScheduleKernelSpec,
  surfaceScheduleMarchAcceptance,
} from "./schedule";

function spongeOfFernsSchedule() {
  const schedule = PRESET_SCHEDULES.spongeOfFerns?.();
  if (!schedule) throw new Error("missing Sponge of Ferns schedule fixture");
  return schedule;
}

describe("scheduled Surface benchmark fixture", () => {
  it("projects the shipped 4-map fern plus 20-map sponge at the physical cap", () => {
    const transforms = presetTransforms("spongeOfFerns");
    const schedule = spongeOfFernsSchedule();
    const de3 = buildSurfaceDE(transforms, null, undefined, { schedule });
    const de4 = buildSurfaceDE4(transforms, null, undefined, { schedule });

    expect(surfaceScheduleKernelSpec(de3)).toEqual({
      mapCount: 4,
      scheduleMapCount: 20,
    });
    expect(surfaceScheduleKernelSpec(de4)).toEqual({
      mapCount: 4,
      scheduleMapCount: 20,
    });
    expect(de3.maps.length + (de3.schedule?.maps.length ?? 0)).toBe(24);
    expect(de4.maps.length + (de4.schedule?.maps.length ?? 0)).toBe(24);
    expect(de3.schedule?.depth).toBe(2);
    expect(de4.schedule?.depth).toBe(2);
    expect(packSurfaceGpuMaps(de3).byteLength).toBe(
      24 * SURFACE_GPU_MAP_VEC4 * 16,
    );
    expect(packSurfaceGpuMaps4(de4).byteLength).toBe(
      24 * SURFACE_GPU_MAP4_VEC4 * 16,
    );

    const wgsl3 = surfaceDeKernelWgsl({
      mode: "eval",
      core: "affine",
      width: 4,
      workgroupSize: 64,
      sharedFrontier: false,
      bnbStage2: false,
      schedule: surfaceScheduleKernelSpec(de3),
    });
    const wgsl4 = surfaceDeKernelWgsl({
      mode: "eval",
      core: "affine4",
      width: 4,
      workgroupSize: 64,
      sharedFrontier: false,
      bnbStage2: false,
      schedule: surfaceScheduleKernelSpec(de4),
    });
    expect(wgsl3).toContain("depth < params.scheduleDepth");
    expect(wgsl4).toContain("depth < params.scheduleDepth");
  });

  it("refuses to let a scheduled row silently compile the classic kernel", () => {
    expect(() =>
      surfaceScheduleKernelSpec(
        buildSurfaceDE(presetTransforms("spongeOfFerns")),
      ),
    ).toThrow("has no schedule maps");
  });

  it("requires a completed, dispatched, agreeing ray mix with real hits", () => {
    const useful = {
      rays: 100,
      gpuHits: 24,
      cpuHits: 25,
      passes: 3,
      failures: 0,
      truncated: false,
    };
    expect(surfaceScheduleMarchAcceptance(useful)).toMatchObject({
      ok: true,
      activated: true,
      completed: true,
      agreed: true,
      gpuUseful: true,
      cpuUseful: true,
    });

    expect(surfaceScheduleMarchAcceptance({ ...useful, passes: 0 }).ok).toBe(
      false,
    );
    expect(
      surfaceScheduleMarchAcceptance({ ...useful, gpuHits: 0, cpuHits: 0 }).ok,
    ).toBe(false);
    expect(
      surfaceScheduleMarchAcceptance({
        ...useful,
        gpuHits: useful.rays,
        cpuHits: useful.rays,
      }).ok,
    ).toBe(false);
    expect(
      surfaceScheduleMarchAcceptance({ ...useful, truncated: true }).ok,
    ).toBe(false);
    expect(surfaceScheduleMarchAcceptance({ ...useful, failures: 1 }).ok).toBe(
      false,
    );
  });

  it("requires production-frame activation and settled real-adapter statuses", () => {
    const useful = {
      passes: 4,
      truncated: false,
      counts: { hit: 30, miss: 70, exhausted: 0, active: 0 },
    };
    expect(surfaceScheduleFrameAcceptance(useful, false)).toEqual({
      ok: true,
      activated: true,
      geometry: true,
      settled: true,
    });
    expect(
      surfaceScheduleFrameAcceptance({ ...useful, passes: 0 }, false).ok,
    ).toBe(false);
    expect(
      surfaceScheduleFrameAcceptance(
        { ...useful, counts: { ...useful.counts, hit: 0 } },
        false,
      ).ok,
    ).toBe(false);
    expect(
      surfaceScheduleFrameAcceptance(
        { ...useful, counts: { ...useful.counts, miss: 0 } },
        false,
      ).ok,
    ).toBe(false);
    expect(
      surfaceScheduleFrameAcceptance(
        { ...useful, counts: { ...useful.counts, exhausted: 1 } },
        false,
      ).ok,
    ).toBe(false);

    // Existing software convention: truncation is allowed, but the frame
    // must still have dispatched and found scheduled geometry.
    expect(
      surfaceScheduleFrameAcceptance(
        {
          passes: 1,
          truncated: true,
          counts: { hit: 1, miss: 0, exhausted: 0, active: 99 },
        },
        true,
      ).ok,
    ).toBe(true);
    expect(
      surfaceScheduleFrameAcceptance(
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
