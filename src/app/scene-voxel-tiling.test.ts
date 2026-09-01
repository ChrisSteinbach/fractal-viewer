import { describe, expect, it, vi } from "vitest";
import { resolveTiling } from "../fractal/tiling";
import { FractalScene } from "./scene";
import {
  createVoxelMaterial,
  emptyVoxelTexture,
  finiteTilingPresentationRadius,
  materialVoxelTiling,
  setVoxelBalloon,
} from "./voxel-material";

describe("FractalScene Solid tiling lifecycle", () => {
  it("clears a stale balloon material arm before installing a tiled session", () => {
    const material = createVoxelMaterial(emptyVoxelTexture());
    setVoxelBalloon(material, {
      center: [0, 0, 0],
      radius: 1,
      rho: 1.02,
      R: 1.6,
    });
    expect(material.fragmentShader).toContain("densityAtEcho");

    const scene = Object.create(FractalScene.prototype) as FractalScene;
    Reflect.set(scene, "voxelMaterial", material);
    Reflect.set(scene, "renderNeeded", false);
    const tiling = resolveTiling({ group: "a3" })!;

    scene.setVoxelTiling(tiling);
    expect(material.fragmentShader).not.toContain("densityAtEcho");
    expect(materialVoxelTiling(material)).toBe(tiling);
    expect(Reflect.get(scene, "renderNeeded")).toBe(true);

    scene.setVoxelTiling(null);
    expect(materialVoxelTiling(material)).toBeNull();
    material.dispose();
  });

  it("re-derives the finite carrier radius from every grid's AABB", () => {
    const material = createVoxelMaterial(emptyVoxelTexture());
    const scene = Object.create(FractalScene.prototype) as FractalScene;
    Reflect.set(scene, "voxelMaterial", material);
    Reflect.set(scene, "renderNeeded", false);
    Reflect.set(scene, "voxelTexture", emptyVoxelTexture());
    Reflect.set(scene, "voxelMaxHierarchyTexture", null);
    Reflect.set(scene, "solidBalloonSourceSphere", {
      center: { x: 0, y: 0, z: 0 },
      radius: 1,
    });
    Reflect.set(scene, "solidBalloonSourceSphereReady", false);
    Reflect.set(scene, "solidBalloonCenterAlpha", 0);
    Reflect.set(scene, "syncSolidBalloonUniforms", vi.fn());
    Reflect.set(scene, "solidCapturePxCostMs", null);

    const tiling = resolveTiling({ group: "a3" })!;
    scene.setVoxelTiling(tiling);

    const boundsMin: [number, number, number] = [-1, -1, -1];
    const boundsMax: [number, number, number] = [1, 1, 1];
    scene.setVoxelGrid(
      new Uint8Array(32 ** 3 * 4),
      32,
      boundsMin,
      boundsMax,
      null,
    );
    expect(material.uniforms.uTilingPresentationR.value).toBeCloseTo(
      finiteTilingPresentationRadius(boundsMin, [2, 2, 2]),
      10,
    );
    material.dispose();
  });
});
