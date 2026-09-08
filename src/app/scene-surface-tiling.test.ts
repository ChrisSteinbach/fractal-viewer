import { describe, expect, it, vi } from "vitest";
import { defaultTransforms, pentatope } from "../fractal/presets";
import { buildSurfaceDE4 } from "../fractal/surface-de-4d";
import {
  buildBalloonFromBall,
  BALLOON_FAR_CAP_RHO,
} from "../fractal/balloon-de";
import {
  buildSurfaceDE,
  surfaceOriginVisibleRadius,
} from "../fractal/surface-de";
import { resolveTiling } from "../fractal/tiling";
import { FractalScene } from "./scene";
import {
  createSurfaceMaterial,
  setSurfaceBalloon as packSurfaceBalloon,
  setSurfaceSystem as packSurfaceSystem,
} from "./surface-material";
import {
  createSurfaceMaterial4,
  setSurfaceSystem4 as packSurfaceSystem4,
} from "./surface-material-4d";

describe("FractalScene Space tiling lifecycle", () => {
  it.each([3, 4] as const)(
    "keeps a dormant %iD lattice material untouched during finite Balloon compute, then installs the fallback",
    (dimension) => {
      const de = buildSurfaceDE(defaultTransforms());
      const de4 = buildSurfaceDE4(pentatope());
      const material = createSurfaceMaterial();
      const material4 = createSurfaceMaterial4();
      const installed = dimension === 3 ? material : material4;
      const oldRadius = surfaceOriginVisibleRadius(dimension === 3 ? de : de4);
      const lattice = resolveTiling(
        { kind: "lattice", cellScale: 1.5 },
        oldRadius,
      );
      if (dimension === 3) {
        packSurfaceSystem(
          material,
          de,
          de.maps.map(() => [0.2, 0.4, 0.6]),
          undefined,
          lattice,
        );
      } else {
        packSurfaceSystem4(
          material4,
          de4,
          de4.maps.map(() => [0.2, 0.4, 0.6]),
          undefined,
          lattice,
        );
      }
      const source = installed.fragmentShader;
      const version = installed.version;
      const scene = Object.create(FractalScene.prototype) as FractalScene;
      Reflect.set(scene, "surfaceMaterial", material);
      Reflect.set(scene, "surfaceMaterial4", material4);
      Reflect.set(scene, "activeSurfaceMaterial", installed);
      Reflect.set(scene, "surfaceQuad", { material: installed });
      Reflect.set(scene, "surfaceBalloonOn", false);
      Reflect.set(scene, "surfaceBalloonRMult", 1.6);
      Reflect.set(scene, "surfaceGridHalfExtent", null);
      Reflect.set(scene, "dropSurfaceGridTexture", vi.fn());
      Reflect.set(scene, "applySurfaceGroundPlane", vi.fn());
      Reflect.set(scene, "installSurfaceDepth", vi.fn());
      Reflect.set(scene, "surfacePreviewGovernor", { reset: vi.fn() });
      Reflect.set(scene, "stripEvidence", { reset: vi.fn() });
      Reflect.set(scene, "flushStripBacklog", vi.fn());
      const finite = resolveTiling({ group: dimension === 3 ? "a3" : "a4" })!;
      if (dimension === 3)
        scene.enterSurfaceComputeSession(de, true, false, finite);
      else scene.enterSurfaceCompute4Session(de4, true, false);

      // Main applies stored Balloon intent after choosing the compute target;
      // a radius drag follows the same dormant-material path.
      expect(() => scene.setSurfaceBalloon(true, 0.9)).not.toThrow();
      expect(() => scene.setSurfaceBalloonRadius(1.2)).not.toThrow();
      expect(installed.fragmentShader).toBe(source);
      expect(installed.version).toBe(version);
      const liveSpec = Reflect.get(
        scene,
        "surfaceBalloonSpec",
      ) as () => unknown;
      expect(liveSpec.call(scene)).toEqual({
        ...buildBalloonFromBall({ center: [0, 0, 0], radius: oldRadius }, 1.2),
        far: BALLOON_FAR_CAP_RHO * oldRadius,
      });

      // The fallback re-entry installs real finite geometry before applying
      // the same stored intent, so its actual material must compile Balloon.
      Reflect.set(scene, "surfaceComputeActive", false);
      if (dimension === 3) {
        scene.setSurfaceSystem(
          de,
          de.maps.map(() => [0.2, 0.4, 0.6]),
          de.maps.map(() => 0),
          finite,
        );
      } else {
        scene.setSurfaceSystem4(
          de4,
          de4.maps.map(() => [0.2, 0.4, 0.6]),
          de4.maps.map(() => 0),
          finite,
        );
      }
      expect(installed.fragmentShader).toContain("surfaceTilingFold");
      expect(installed.fragmentShader).toContain("balloonInvert");
      expect(
        installed.defines[
          dimension === 3 ? "SURFACE_BALLOON" : "SURFACE4_BALLOON"
        ],
      ).toBe(1);
      material.dispose();
      material4.dispose();
    },
  );

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

    const shifted = defaultTransforms().map((t) => ({
      ...t,
      position: [t.position[0] + 2, t.position[1], t.position[2]] as [
        number,
        number,
        number,
      ],
    }));
    const de = buildSurfaceDE(shifted, null, {
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
    const originBall = {
      center: [0, 0, 0],
      radius: surfaceOriginVisibleRadius(de),
    };
    expect(Reflect.get(scene, "surfaceBalloonBall")).toEqual(originBall);
    expect(originBall.radius).toBeGreaterThan(de.boundingRadius);
    scene.enterSurfaceComputeSession(de, true, false, tiling);
    expect(Reflect.get(scene, "surfaceBalloonBall")).toEqual(originBall);
    material.dispose();
  });
});
