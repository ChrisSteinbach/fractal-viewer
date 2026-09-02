import { describe, expect, it, vi } from "vitest";
import { defaultTransforms } from "../fractal/presets";
import { buildSurfaceDE } from "../fractal/surface-de";
import { resolveTiling } from "../fractal/tiling";
import { FractalScene } from "./scene";
import {
  createSurfaceMaterial,
  setSurfaceBalloon as packSurfaceBalloon,
} from "./surface-material";

describe("FractalScene Space tiling lifecycle", () => {
  it("clears a stale balloon material arm before installing a tiled replacement session", () => {
    const material = createSurfaceMaterial();
    packSurfaceBalloon(material, {
      center: [0, 0, 0],
      rho: 1,
      R: 0.5,
      far: 8,
    });
    expect(material.defines.SURFACE_BALLOON).toBe(1);

    const scene = Object.create(FractalScene.prototype) as FractalScene;
    Reflect.set(scene, "surfaceMaterial", material);
    Reflect.set(scene, "surfaceQuad", { material: null });
    Reflect.set(scene, "dropSurfaceGridTexture", vi.fn());
    Reflect.set(scene, "applySurfaceBalloon", vi.fn());
    Reflect.set(scene, "applySurfaceGroundPlane", vi.fn());
    Reflect.set(scene, "installSurfaceDepth", vi.fn());
    Reflect.set(scene, "surfacePreviewGovernor", { reset: vi.fn() });
    Reflect.set(scene, "stripEvidence", { reset: vi.fn() });
    Reflect.set(scene, "flushStripBacklog", vi.fn());

    const de = buildSurfaceDE(defaultTransforms(), null, {
      order: 1,
      plane: "xz",
    });
    const tiling = resolveTiling({
      group: "a3",
      clip: {
        parts: [
          {
            primitive: { kind: "sphere", radius: 0.4 },
            combine: "union",
          },
        ],
      },
    });

    expect(() =>
      scene.setSurfaceSystem(
        de,
        de.maps.map(() => [0.2, 0.4, 0.6]),
        de.maps.map(() => 0),
        tiling,
      ),
    ).not.toThrow();
    expect(material.defines.SURFACE_BALLOON).toBe(0);
    expect(material.fragmentShader).toContain("surfaceTilingFold");
    expect(material.fragmentShader).toContain("tilingClipSdf");
    expect(Reflect.get(scene, "activeSurfaceMaterial")).toBe(material);
    material.dispose();
  });
});
