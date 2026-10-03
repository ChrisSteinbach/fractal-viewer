import { describe, expect, it } from "vitest";
import { FractalScene } from "./scene";

function bareScene(): FractalScene {
  return Object.create(FractalScene.prototype) as FractalScene;
}

describe("FractalScene surfaceGridInfo", () => {
  it("is null while no grid is installed", () => {
    const scene = bareScene();
    Reflect.set(scene, "surfaceGridTexture", null);
    Reflect.set(scene, "surfaceGridResolution", null);
    Reflect.set(scene, "surfaceGridHalfExtent", null);
    expect(scene.surfaceGridInfo).toBeNull();
  });

  it("reports the built resolution, half extent and the live enable flag", () => {
    const scene = bareScene();
    Reflect.set(scene, "surfaceGridTexture", { dispose() {} });
    Reflect.set(scene, "surfaceGridResolution", 48);
    Reflect.set(scene, "surfaceGridHalfExtent", 1.03);
    Reflect.set(scene, "surfaceMaterial", {
      uniforms: { uGridEnabled: { value: 1 } },
    });

    expect(scene.surfaceGridInfo).toEqual({
      resolution: 48,
      halfExtent: 1.03,
      enabled: true,
    });

    // A balloon session whose shell does not clear the cube marches
    // gridless over the installed grid — `enabled` is the march's live
    // answer, not a property of the grid.
    Reflect.set(scene, "surfaceMaterial", {
      uniforms: { uGridEnabled: { value: 0 } },
    });
    expect(scene.surfaceGridInfo).toEqual({
      resolution: 48,
      halfExtent: 1.03,
      enabled: false,
    });
  });
});
