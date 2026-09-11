import { buildBalloon, estimateBalloonDistance } from "../fractal/balloon-de";
import { buildSurfaceDE, estimateDistanceRefined } from "../fractal/surface-de";
import type { Vec3 } from "../fractal/types";
import { sphericalToCartesian } from "./orbit";
import { decodeScene, encodeScene } from "./persist";
import {
  createSurfaceLightingStarter,
  SURFACE_LIGHTING_STARTERS,
} from "./surface-lighting-starters";

describe("accepted Surface lighting starting scenes", () => {
  it("offers only the two owner-accepted interiors", () => {
    expect(SURFACE_LIGHTING_STARTERS.map((entry) => entry.id)).toEqual([
      "cathedral",
      "balloon-cavern",
    ]);
  });

  it.each([
    ["cathedral", [0.065, -0.17, 0.72], 0.6, 7, 1.35],
    ["balloon-cavern", [1.05, -0.2, 0.95], 0.65, 40, 5.2],
  ] as const)(
    "preserves %s's approved camera, light and geometry clearance",
    (id, eye, zoom, flux, mediumRadius) => {
      const scene = createSurfaceLightingStarter(id);
      const camera = scene.camera!;
      const offset = sphericalToCartesian(camera);
      const actual: Vec3 = [
        offset[0] + camera.target[0],
        offset[1] + camera.target[1],
        offset[2] + camera.target[2],
      ];
      for (let i = 0; i < 3; i++) expect(actual[i]).toBeCloseTo(eye[i], 12);
      expect(Math.tan((camera.fov! * Math.PI) / 360)).toBeCloseTo(zoom, 12);
      expect(scene.transforms).toHaveLength(20);
      const de = buildSurfaceDE(scene.transforms);
      const clearance = scene.balloonEcho
        ? estimateBalloonDistance(
            estimateDistanceRefined,
            de,
            buildBalloon(de, scene.balloonRadius!),
            actual,
          ).d
        : estimateDistanceRefined(de, actual);
      expect(clearance).toBeGreaterThan(0.02);
      expect(scene.surface.lighting!.lights[0].intensity).toBe(flux);
      expect(scene.surface.lighting!.medium!.radius).toBe(mediumRadius);
      expect(scene.groundPlane).toBe(false);
      expect(scene.fogDensity).toBe(0);
      expect(scene.surface.antialiasSamples).toBe(8);
      expect(decodeScene(encodeScene(scene))?.camera?.fov).toBeCloseTo(
        camera.fov!,
        8,
      );
    },
  );

  it("owns every returned composition independently", () => {
    const first = createSurfaceLightingStarter("balloon-cavern");
    const second = createSurfaceLightingStarter("balloon-cavern");
    first.transforms[0].position[0] = 8;
    first.camera!.target[0] = 8;
    first.surface.lighting!.lights[0].color[0] = 8;
    first.surface.lighting!.medium!.center[0] = 8;
    expect(second).toEqual(createSurfaceLightingStarter("balloon-cavern"));
    expect(second.customPalette).not.toBe(first.customPalette);
    expect(second.background).not.toBe(first.background);
  });
});
