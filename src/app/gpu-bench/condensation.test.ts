import { describe, expect, it } from "vitest";
import { gearworks } from "../../fractal/presets";
import { buildSurfaceDE } from "../../fractal/surface-de";
import { surfaceCondensationKernelSpec } from "./condensation";

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
