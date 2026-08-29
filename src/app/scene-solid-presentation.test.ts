import * as THREE from "three";
import { FractalScene } from "./scene";
import { initialState } from "./state";
import {
  createVoxelMaterial,
  emptyVoxelTexture,
  voxelFragmentFor,
} from "./voxel-material";

function bareSolidScene(): {
  scene: FractalScene;
  material: THREE.ShaderMaterial;
} {
  const scene = Object.create(FractalScene.prototype) as FractalScene;
  const material = createVoxelMaterial(emptyVoxelTexture());
  Reflect.set(scene, "voxelMaterial", material);
  Reflect.set(scene, "solidBalloonSourceSphere", new THREE.Sphere());
  Reflect.set(scene, "solidBalloonSourceSphereReady", false);
  Reflect.set(scene, "solidThreshold", 0.3);
  Reflect.set(scene, "solidBalloonCenterAlpha", 0);
  Reflect.set(scene, "balloonEchoEnabled", false);
  Reflect.set(scene, "renderNeeded", false);
  Reflect.set(scene, "solidCapturePxCostMs", null);
  return { scene, material };
}

describe("FractalScene Solid presentation", () => {
  it("derives a 3D floor from the uploaded cloud sphere", () => {
    const { scene, material } = bareSolidScene();
    const geometry = new THREE.BufferGeometry();
    Reflect.set(scene, "pointGeometry", geometry);
    Reflect.set(scene, "balloonEchoSourceSphere", new THREE.Sphere());
    Reflect.set(scene, "setDrawCount", vi.fn());
    Reflect.set(scene, "setReplayCursor", vi.fn());
    Reflect.set(scene, "syncBalloonEchoUniforms", vi.fn());
    Reflect.set(scene, "syncSolidBalloonUniforms", vi.fn());
    const base = initialState(true).solid;
    scene.setSolidParams({
      ...base,
      floorEnabled: true,
      floorPattern: "checker",
      floorTileScale: 0.8,
      floorEmission: 1.25,
    });

    scene.setPoints(
      new Float32Array([-2, 0, 0, 2, 0, 0]),
      new Float32Array([1, 0, 0, 0, 1, 0]),
    );

    expect(material.uniforms.uGroundBallC.value.toArray()).toEqual([0, 0, 0]);
    expect(material.uniforms.uGroundBallR.value).toBe(2);
    expect(material.uniforms.uGroundY.value).toBeCloseTo(-2.04);
    expect(material.uniforms.uGroundPattern.value).toBe(1);
  });

  it("uses the 4D origin/full-radius sphere and leaves it stable across rotor and slice edits", () => {
    const { scene, material } = bareSolidScene();
    const geometry = new THREE.BufferGeometry();
    Reflect.set(scene, "pointGeometry", geometry);
    Reflect.set(scene, "balloonEchoSourceSphere", new THREE.Sphere());
    Reflect.set(scene, "setDrawCount", vi.fn());
    Reflect.set(scene, "setReplayCursor", vi.fn());
    Reflect.set(scene, "syncBalloonEchoUniforms", vi.fn());
    Reflect.set(scene, "syncSolidBalloonUniforms", vi.fn());
    Reflect.set(scene, "updateWAmp4", vi.fn());
    Reflect.set(scene, "updateFourDScaffoldPositions", vi.fn());
    const fourDMaterial = {
      uniforms: {
        uCenter4: { value: new THREE.Vector4() },
        uRot4: { value: new THREE.Matrix4() },
        uSliceOn: { value: 0 },
        uSliceCenter: { value: 0 },
        uSliceColorShift: { value: 0 },
        uSliceColorInvScale: { value: 1 },
      },
    };
    Reflect.set(scene, "fourDMaterial", fourDMaterial);
    Reflect.set(
      scene,
      "fourDRot",
      [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    );
    scene.setSolidParams({
      ...initialState(true).solid,
      floorEnabled: true,
    });

    scene.setPoints4(
      new Float32Array([1, 2, 3]),
      new Float32Array([4]),
      [9, 8, 7, 6],
      5,
      12,
      [1, 2, 3, 4],
    );
    const before = {
      center: material.uniforms.uGroundBallC.value.toArray(),
      radius: material.uniforms.uGroundBallR.value,
      y: material.uniforms.uGroundY.value,
    };

    scene.setRot4([0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    scene.setFourDSlice(true, 0.6, true);

    expect(before).toEqual({ center: [0, 0, 0], radius: 12, y: -12.24 });
    expect(material.uniforms.uGroundBallC.value.toArray()).toEqual(
      before.center,
    );
    expect(material.uniforms.uGroundBallR.value).toBe(before.radius);
    expect(material.uniforms.uGroundY.value).toBe(before.y);
  });

  it("keeps scalar look edits uniform-only and Balloon suppresses/restores authored floor intent", () => {
    const { scene, material } = bareSolidScene();
    const sphere = Reflect.get(
      scene,
      "solidBalloonSourceSphere",
    ) as THREE.Sphere;
    sphere.center.set(1, 2, 3);
    sphere.radius = 4;
    Reflect.set(scene, "solidBalloonSourceSphereReady", true);
    const base = initialState(true).solid;
    scene.setSolidParams({
      ...base,
      envLight: 0.25,
      floorEnabled: true,
    });
    const version = material.version;

    scene.setSolidParams({
      ...base,
      envLight: 0.75,
      floorEnabled: true,
      floorTileScale: 1.3,
      floorEmission: 0.8,
    });
    expect(material.version).toBe(version);
    expect(material.uniforms.uEnvLight.value).toBe(0.75);
    expect(material.uniforms.uGroundTileScale.value).toBe(1.3);
    expect(material.uniforms.uGroundEmission.value).toBe(0.8);

    Reflect.set(scene, "balloonEchoEnabled", true);
    Reflect.set(scene, "solidBalloonCenterAlpha", 0);
    Reflect.apply(Reflect.get(scene, "syncSolidBalloonUniforms"), scene, []);
    expect(material.fragmentShader).toBe(voxelFragmentFor(true, false, true));
    expect(material.fragmentShader).not.toContain("shadeVoxelFloor");

    Reflect.set(scene, "balloonEchoEnabled", false);
    Reflect.apply(Reflect.get(scene, "syncSolidBalloonUniforms"), scene, []);
    expect(material.fragmentShader).toBe(
      voxelFragmentFor(false, false, true, true),
    );
  });
});
