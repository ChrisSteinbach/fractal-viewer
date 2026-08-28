import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { FractalScene } from "./scene";

function bareScene(): FractalScene {
  return Object.create(FractalScene.prototype) as FractalScene;
}

describe("FractalScene Surface depth-of-field presentation", () => {
  it("marks only retained presentation dirty when the setting changes", () => {
    const scene = bareScene();
    Reflect.set(scene, "surfaceDepthOfField", false);
    Reflect.set(scene, "surfaceDisplayActive", true);
    Reflect.set(scene, "surfaceCompositePending", false);
    Reflect.set(scene, "renderNeeded", false);
    Reflect.set(scene, "surfacePresentation", {
      color: {},
      layer: {},
      background: {},
      metadataInSourceAlpha: false,
    });

    scene.setSurfaceDepthOfField(true);

    expect(Reflect.get(scene, "surfaceDepthOfField")).toBe(true);
    expect(scene.surfaceCompositeNeeded).toBe(true);
    expect(scene.needsRender).toBe(false);
  });

  it("does not dirty tracing before a Surface frame has been retained", () => {
    const scene = bareScene();
    Reflect.set(scene, "surfaceDepthOfField", false);
    Reflect.set(scene, "surfaceDisplayActive", true);
    Reflect.set(scene, "surfaceCompositePending", false);
    Reflect.set(scene, "surfacePresentation", null);
    Reflect.set(scene, "renderNeeded", false);

    scene.setSurfaceDepthOfField(true);
    scene.setSurfaceDepthOfField(true);

    expect(scene.surfaceCompositeNeeded).toBe(false);
    expect(scene.needsRender).toBe(false);
  });

  it("projects autofocus through the enclosing-ball centre along camera forward", () => {
    const scene = bareScene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(1, 2, 8);
    camera.lookAt(1, 2, 0);
    camera.updateMatrixWorld();
    Reflect.set(scene, "camera", camera);
    Reflect.set(scene, "surfaceFocusBall", {
      center: [1, 2, 2],
      radius: 3,
    });

    const focus = Reflect.apply(
      Reflect.get(scene, "surfaceFocusPlane") as (...args: never[]) => {
        forward: THREE.Vector3;
        depth: number;
      },
      scene,
      [],
    );

    expect(focus.forward.x).toBeCloseTo(0, 12);
    expect(focus.forward.y).toBeCloseTo(0, 12);
    expect(focus.forward.z).toBeCloseTo(-1, 12);
    expect(focus.depth).toBeCloseTo(6, 12);
  });

  it("re-presents retained metadata without touching the trace dirty bit", () => {
    const scene = bareScene();
    const blit = vi.fn();
    Reflect.set(scene, "blitSurface", blit);
    Reflect.set(scene, "surfaceCompositePending", true);
    Reflect.set(scene, "renderNeeded", false);
    const presentation = {
      color: {},
      layer: {},
      background: {},
      metadataInSourceAlpha: false,
    };
    Reflect.set(scene, "surfacePresentation", presentation);

    expect(scene.presentSurfaceComposite()).toBe(true);
    expect(blit).toHaveBeenCalledWith(
      presentation.color,
      null,
      presentation.layer,
      presentation.background,
      null,
      undefined,
      false,
    );
    expect(scene.surfaceCompositeNeeded).toBe(false);
    expect(scene.needsRender).toBe(false);
  });

  it("keeps the frontmost covered CoC through WebGL supersampling", () => {
    const scene = bareScene();
    const color = new Uint8Array(8);
    const layer = new Uint8Array(8);
    const layerPasses = [
      new Uint8Array([255, 20, 30, 200, 0, 0, 255, 255]),
      new Uint8Array([255, 40, 50, 40, 128, 20, 128, 180]),
    ];
    let pass = 0;
    Reflect.set(scene, "renderer", {
      readRenderTargetPixels: vi.fn(
        (
          _target: unknown,
          _x: number,
          _y: number,
          _width: number,
          _height: number,
          out: Uint8Array,
          _face?: number,
          attachment?: number,
        ) => {
          if (attachment === 1) out.set(layerPasses[pass++]);
          else out.set([0, 0, 0, 255, 0, 0, 0, 0]);
        },
      ),
    });
    Reflect.set(scene, "surfaceSettleTarget", {});
    Reflect.set(scene, "surfaceSampleAccum", new Float32Array(6));
    Reflect.set(scene, "surfaceSampleLayerAccum", new Float32Array(6));
    Reflect.set(scene, "surfaceSampleCoc", new Uint8Array([255, 255]));
    Reflect.set(scene, "surfaceSampleTexture", { image: { data: color } });
    Reflect.set(scene, "surfaceSampleLayerTexture", {
      image: { data: layer },
    });
    Reflect.set(scene, "surfaceSampleWidth", 2);
    Reflect.set(scene, "surfaceSampleHeight", 1);
    Reflect.set(scene, "surfaceSampleTaken", 0);

    const fold = Reflect.get(scene, "foldSurfaceSample") as () => void;
    Reflect.apply(fold, scene, []);
    Reflect.apply(fold, scene, []);
    const encode = Reflect.get(scene, "encodeSurfaceSampleMean") as () => void;
    Reflect.apply(encode, scene, []);

    expect(Array.from(layer)).toEqual([255, 30, 40, 40, 64, 10, 192, 180]);
  });
});
