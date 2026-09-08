import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
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
  it("can invert finite Solid content when the held Points cloud was empty", () => {
    const scene = Object.create(FractalScene.prototype) as FractalScene;
    const texture = emptyVoxelTexture();
    const material = createVoxelMaterial(texture);
    Reflect.set(scene, "voxelMaterial", material);
    Reflect.set(scene, "voxelTexture", texture);
    Reflect.set(
      scene,
      "solidBalloonSourceSphere",
      new THREE.Sphere(new THREE.Vector3(), 0),
    );
    Reflect.set(scene, "solidBalloonSourceSphereReady", false);
    Reflect.set(scene, "solidThreshold", 0.3);
    Reflect.set(scene, "balloonEchoEnabled", true);
    Reflect.set(scene, "balloonEchoRadius", 0.7);
    scene.setVoxelTiling(null, 2);
    expect(material.fragmentShader).toContain("densityAtEcho");
    expect(material.uniforms.uBalloonR.value).toBe(1.4);
    expect(scene.solidBalloonAvailable()).toBe(true);
    material.dispose();
    texture.dispose();
  });

  it("retains Balloon while installing finite tiling and its certified origin ball", () => {
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
    Reflect.set(scene, "voxelTexture", emptyVoxelTexture());
    Reflect.set(
      scene,
      "solidBalloonSourceSphere",
      new THREE.Sphere(new THREE.Vector3(1, 0, 0), 1),
    );
    Reflect.set(scene, "solidBalloonSourceSphereReady", true);
    Reflect.set(scene, "solidThreshold", 0.3);
    Reflect.set(scene, "balloonEchoEnabled", true);
    Reflect.set(scene, "balloonEchoRadius", 0.7);
    Reflect.set(scene, "renderNeeded", false);
    const tiling = resolveTiling({ group: "a3" })!;

    scene.setVoxelTiling(tiling, 2);
    expect(material.fragmentShader).toContain("densityAtEcho");
    expect(material.uniforms.uBalloonCenter.value.toArray()).toEqual([0, 0, 0]);
    expect(material.uniforms.uBalloonR.value).toBe(1.4);
    expect(materialVoxelTiling(material)).toBe(tiling);
    expect(Reflect.get(scene, "renderNeeded")).toBe(true);

    scene.setVoxelTiling(null);
    expect(materialVoxelTiling(material)).toBeNull();
    expect(material.uniforms.uBalloonCenter.value.toArray()).toEqual([1, 0, 0]);
    expect(material.fragmentShader).toContain("densityAtEcho");
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
