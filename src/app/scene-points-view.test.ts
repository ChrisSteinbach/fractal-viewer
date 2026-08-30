// @vitest-environment jsdom
import * as THREE from "three";
import { FractalScene } from "./scene";

function fourViewScene(): {
  scene: FractalScene;
  renderer: {
    setScissorTest: ReturnType<typeof vi.fn>;
    setViewport: ReturnType<typeof vi.fn>;
    setScissor: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
    render: ReturnType<typeof vi.fn>;
    getPixelRatio: ReturnType<typeof vi.fn>;
    domElement: HTMLCanvasElement;
  };
  cameras: Record<"x" | "y" | "z", THREE.PerspectiveCamera>;
  nativePointMaterials: THREE.PointsMaterial[];
  backdropQuad: { render: ReturnType<typeof vi.fn> };
} {
  const scene = Object.create(FractalScene.prototype) as FractalScene;
  const domElement = document.createElement("canvas");
  const renderer = {
    setScissorTest: vi.fn(),
    setViewport: vi.fn(),
    setScissor: vi.fn(),
    clear: vi.fn(),
    render: vi.fn(),
    getPixelRatio: vi.fn(() => 2),
    domElement,
  };
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  camera.position.set(5, 4, 5);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const cameras = {
    x: new THREE.PerspectiveCamera(),
    y: new THREE.PerspectiveCamera(),
    z: new THREE.PerspectiveCamera(),
  };
  cameras.y.up.set(0, 0, -1);
  const nativePointMaterials = [4, 6, 8, 10].map(
    (size) => new THREE.PointsMaterial({ size }),
  );
  const backdropQuad = { render: vi.fn() };

  Reflect.set(scene, "renderer", renderer);
  Reflect.set(scene, "scene", new THREE.Scene());
  Reflect.set(scene, "camera", camera);
  Reflect.set(scene, "axisCameras", cameras);
  Reflect.set(scene, "pointsViewLayout", "four");
  Reflect.set(scene, "viewportWidth", 1000);
  Reflect.set(scene, "viewportHeight", 600);
  Reflect.set(scene, "rightInsetPx", 200);
  Reflect.set(scene, "lastCameraPose", [5, 4, 5, 0, 0, 0, 50, 0.1]);
  Reflect.set(scene, "renderNeeded", true);
  Reflect.set(scene, "fourDActive", false);
  Reflect.set(scene, "renderStyle", "depthFade");
  Reflect.set(scene, "pointGeometry", { boundingSphere: null });
  Reflect.set(scene, "backdropQuad", backdropQuad);
  Reflect.set(scene, "baseMaterial", nativePointMaterials[0]);
  Reflect.set(scene, "discMaterial", nativePointMaterials[1]);
  Reflect.set(scene, "glowMaterial", nativePointMaterials[2]);
  Reflect.set(scene, "replayCursor", {
    material: nativePointMaterials[3],
  });
  Reflect.set(scene, "dofMaterial", {
    uniforms: { uHalfHeight: { value: 0 } },
  });
  Reflect.set(scene, "fourDMaterial", {
    uniforms: { uHalfHeight: { value: 0 } },
  });
  Reflect.set(scene, "balloonEchoMaterial", {
    uniforms: { uHalfHeight: { value: 0 } },
  });
  return { scene, renderer, cameras, nativePointMaterials, backdropQuad };
}

describe("FractalScene four-view Points rendering", () => {
  it("renders one shared scene through X/Y/Z/current scissored cameras", () => {
    const { scene, renderer, cameras, backdropQuad } = fourViewScene();

    scene.render();

    expect(backdropQuad.render).toHaveBeenCalledWith(renderer);
    expect(renderer.clear).not.toHaveBeenCalled();
    expect(renderer.setScissorTest.mock.calls).toEqual([
      [false],
      [true],
      [false],
    ]);
    expect(renderer.setScissor.mock.calls).toEqual([
      [0, 300, 400, 300],
      [400, 300, 400, 300],
      [0, 0, 400, 300],
      [400, 0, 400, 300],
    ]);
    const renderedCameras = renderer.render.mock.calls.map(
      (call) => call[1] as THREE.Camera,
    );
    expect(renderedCameras).toEqual([
      cameras.x,
      cameras.y,
      cameras.z,
      scene.camera,
    ]);
    expect(
      renderer.render.mock.calls.every((call) => call[0] === scene.scene),
    ).toBe(true);
    expect(renderer.setViewport.mock.calls).toEqual([
      [0, 0, 1000, 600],
      [0, 300, 400, 300],
      [400, 300, 400, 300],
      [0, 0, 400, 300],
      [400, 0, 400, 300],
      [0, 0, 1000, 600],
    ]);
    expect(Reflect.get(scene, "renderNeeded")).toBe(false);
  });

  it("keeps fixed directions while sharing the Current target/radius/lens", () => {
    const { scene, cameras } = fourViewScene();
    const target = new THREE.Vector3(2, -1, 3);
    scene.camera.position.set(7, 3, 8);
    scene.camera.lookAt(target);
    scene.camera.updateMatrixWorld();
    Reflect.set(scene, "lastCameraPose", [7, 3, 8, 2, -1, 3, 50, 0.1]);

    scene.render();

    const radius = scene.camera.position.distanceTo(target);
    expect(cameras.x.position.toArray()).toEqual([2 + radius, -1, 3]);
    expect(cameras.y.position.toArray()).toEqual([2, -1 + radius, 3]);
    expect(cameras.z.position.toArray()).toEqual([2, -1, 3 + radius]);
    for (const camera of Object.values(cameras)) {
      expect(camera.fov).toBe(scene.camera.fov);
      expect(camera.aspect).toBeCloseTo(4 / 3);
    }
  });

  it("counter-scales native point sprites per pane and restores authored sizes", () => {
    const { scene, renderer, nativePointMaterials } = fourViewScene();
    const renderedSizes: number[][] = [];
    renderer.render.mockImplementation(() => {
      renderedSizes.push(nativePointMaterials.map((material) => material.size));
    });

    scene.render();

    expect(renderedSizes).toEqual([
      [2, 3, 4, 5],
      [2, 3, 4, 5],
      [2, 3, 4, 5],
      [2, 3, 4, 5],
    ]);
    expect(nativePointMaterials.map((material) => material.size)).toEqual([
      4, 6, 8, 10,
    ]);
  });

  it("routes scaled client coordinates to production pane cameras and rejects the panel strip", () => {
    const { scene, renderer, cameras } = fourViewScene();
    vi.spyOn(renderer.domElement, "getBoundingClientRect").mockReturnValue({
      x: 20,
      y: 40,
      left: 20,
      top: 40,
      right: 520,
      bottom: 340,
      width: 500,
      height: 300,
      toJSON: () => ({}),
    });

    expect(scene.pointsInteractionView(21, 41)).toMatchObject({
      kind: "x",
      camera: cameras.x,
      rect: { left: 20, top: 40, width: 200, height: 150 },
      adjustable: false,
    });
    expect(scene.pointsInteractionView(220, 41)).toMatchObject({
      kind: "y",
      camera: cameras.y,
      rect: { left: 220, top: 40, width: 200, height: 150 },
      adjustable: false,
    });
    expect(scene.pointsInteractionView(21, 190)).toMatchObject({
      kind: "z",
      camera: cameras.z,
      rect: { left: 20, top: 190, width: 200, height: 150 },
      adjustable: false,
    });
    expect(scene.pointsInteractionView(220, 190)).toMatchObject({
      kind: "current",
      camera: scene.camera,
      rect: { left: 220, top: 190, width: 200, height: 150 },
      adjustable: true,
    });
    expect(scene.pointsInteractionView(420, 190)).toBeNull();
  });
});
