import { describe, expect, it } from "vitest";
import { gearworks } from "../../fractal/presets";
import { buildSurfaceDE } from "../../fractal/surface-de";
import {
  packSurface4GpuParams,
  packSurfaceGpuMaps,
  packSurfaceGpuMaps4,
  packSurfaceGpuParams,
  surfaceDeKernelWgsl,
  SURFACE_GPU_MAP_VEC4,
  SURFACE_GPU_MAP4_VEC4,
} from "../../fractal/surface-de-gpu";
import { surfaceCondensationKernelSpec } from "./condensation";
import { surfaceEmitterOnlyFixtures } from "./condensation-emitter-only";
import { surfaceScheduleKernelSpec } from "./schedule";
import { surfaceChaosKernelSpec } from "./chaos";

describe("surface condensation bench fixture", () => {
  it("projects Gearworks onto four recursive maps and one gear emitter", () => {
    const de = buildSurfaceDE(gearworks());
    const spec = surfaceCondensationKernelSpec(de);

    expect(spec.mapCount).toBe(4);
    expect(spec.emitters).toHaveLength(1);
    expect(spec.emitters[0].shadeIndex).toBe(4);
    expect(spec.emitters[0].shape.parts).toHaveLength(1);
    expect(spec.emitters[0].shape.parts[0].primitive.kind).toBe("gear");
    expect(de.condensation?.depthBand).toEqual({
      minDepth: 0,
      maxDepth: Number.MAX_SAFE_INTEGER,
    });
  });

  it("refuses an emitter-free fixture instead of compiling the old kernel", () => {
    expect(() =>
      surfaceCondensationKernelSpec(buildSurfaceDE(gearworks().slice(0, 4))),
    ).toThrow("has no emitters");
  });
});

describe("emitter-only surface agreement fixtures", () => {
  // The runner supplies the shared policy; this strict standalone tolerance
  // checks fixture construction without importing the browser entry point.
  const fixtures = () =>
    surfaceEmitterOnlyFixtures((distance, radius) =>
      Math.max(
        2e-4 * radius,
        2e-3 * Math.max(Math.abs(distance), 0.05 * radius),
      ),
    );

  it("requires finite-oracle agreement and two stable materials in all sixteen rows", () => {
    const rows = fixtures();
    expect(rows).toHaveLength(16);
    for (const row of rows) {
      expect(row.de.maps, row.name).toHaveLength(0);
      expect(row.queries, row.name).toHaveLength(8);
      expect(
        row.shades.filter((shade) => shade === 0),
        row.name,
      ).toHaveLength(4);
      expect(
        row.shades.filter((shade) => shade === 1),
        row.name,
      ).toHaveLength(4);
      // Slot 2 is exactly coincident with slot 0: each first material query
      // therefore also pins the first-emitter tie rule.
      expect(row.shades.includes(2), row.name).toBe(false);
      expect(
        row.cpu.every((distance) => Number.isFinite(distance) && distance > 0),
        row.name,
      ).toBe(true);
    }
  });

  it("packs zero A maps, complete B prefixes, emitter suffixes and finite minimum depths in both dimensions", () => {
    for (const row of fixtures()) {
      const run = {
        itemCount: row.queries.length,
        maxDepth: row.requestedDepth,
      };
      const params = new DataView(
        row.view4
          ? packSurface4GpuParams(row.de, row.view4, run)
          : packSurfaceGpuParams(row.de, run),
      );
      const maps = row.view4
        ? packSurfaceGpuMaps4(row.de)
        : packSurfaceGpuMaps(row.de);
      const stride =
        (row.view4 ? SURFACE_GPU_MAP4_VEC4 : SURFACE_GPU_MAP_VEC4) * 4;
      const paramStart = row.view4 ? 576 : 288;
      const p0 = row.view4 ? 20 : 12;
      const scheduleCount = row.de.schedule?.maps.length ?? 0;
      const emitters = row.de.condensation!.emitters;
      expect(params.getUint32(48, true), row.name).toBe(0);
      expect(params.getUint32(52, true), row.name).toBe(
        row.requestedDepth === undefined
          ? row.de.maxDepth
          : (row.de.schedule?.depth ?? 0) + 1,
      );
      expect(params.getUint32(paramStart, true), row.name).toBe(
        emitters.length,
      );
      expect(params.getUint32(paramStart + 12, true), row.name).toBe(3);
      expect(maps.length, row.name).toBe(
        (scheduleCount + emitters.length) * stride,
      );
      emitters.forEach((emitter, index) => {
        const start = (scheduleCount + index) * stride;
        expect(maps[start + p0 + 1], row.name).toBe(emitter.shadeIndex);
        expect(maps[start + p0 + 2], row.name).toBe(emitter.shadeIndex);
        expect(Array.from(maps.slice(start, start + 3)), row.name).toEqual(
          Array.from(new Float32Array(emitter.invM.slice(0, 3))),
        );
      });
      for (const mode of ["eval", "shade"] as const) {
        expect(
          () =>
            surfaceDeKernelWgsl({
              mode,
              core: row.core,
              width: 4,
              workgroupSize: 1,
              sharedFrontier: false,
              bnbStage2: false,
              condensation: surfaceCondensationKernelSpec(row.de),
              ...(row.de.schedule
                ? { schedule: surfaceScheduleKernelSpec(row.de) }
                : {}),
              ...(row.de.chaos
                ? { chaos: surfaceChaosKernelSpec(row.de) }
                : {}),
            }),
          row.name,
        ).not.toThrow();
      }
    }
  });

  it("counts every emitter and scheduled record against the 24-record cap with zero A maps", () => {
    for (const row of fixtures().filter((fixture) =>
      fixture.name.endsWith("schedule"),
    )) {
      const count = 24 - row.de.schedule!.maps.length;
      if (row.view4) {
        const condensation = row.de.condensation!;
        const capped = {
          ...row.de,
          condensation: {
            ...condensation,
            emitters: Array.from(
              { length: count },
              () => condensation.emitters[0],
            ),
          },
        };
        expect(packSurfaceGpuMaps4(capped)).toHaveLength(
          24 * SURFACE_GPU_MAP4_VEC4 * 4,
        );
        expect(() =>
          packSurface4GpuParams(capped, row.view4, { itemCount: 1 }),
        ).not.toThrow();
        capped.condensation.emitters.push(condensation.emitters[0]);
        expect(() => packSurfaceGpuMaps4(capped)).toThrow(/25.*cap is 24/);
        expect(() =>
          packSurface4GpuParams(capped, row.view4, { itemCount: 1 }),
        ).toThrow(/25.*cap is 24/);
      } else {
        const condensation = row.de.condensation!;
        const capped = {
          ...row.de,
          condensation: {
            ...condensation,
            emitters: Array.from(
              { length: count },
              () => condensation.emitters[0],
            ),
          },
        };
        expect(packSurfaceGpuMaps(capped)).toHaveLength(
          24 * SURFACE_GPU_MAP_VEC4 * 4,
        );
        expect(() =>
          packSurfaceGpuParams(capped, { itemCount: 1 }),
        ).not.toThrow();
        capped.condensation.emitters.push(condensation.emitters[0]);
        expect(() => packSurfaceGpuMaps(capped)).toThrow(/25.*cap is 24/);
        expect(() => packSurfaceGpuParams(capped, { itemCount: 1 })).toThrow(
          /25.*cap is 24/,
        );
      }
      expect(() =>
        surfaceDeKernelWgsl({
          mode: "eval",
          core: row.core,
          width: 4,
          workgroupSize: 1,
          sharedFrontier: false,
          bnbStage2: false,
          schedule: surfaceScheduleKernelSpec(row.de),
          condensation: {
            mapCount: 0,
            emitters: Array.from(
              { length: count + 1 },
              () => surfaceCondensationKernelSpec(row.de).emitters[0],
            ),
          },
        }),
      ).toThrow(/25.*cap is 24/);
    }
  });
});
