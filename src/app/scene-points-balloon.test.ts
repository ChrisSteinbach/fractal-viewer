import * as THREE from "three";
import { BALLOON_ECHO_VERTEX, FractalScene } from "./scene";
import { BALLOON_RHO_MARGIN } from "../fractal/balloon-de";

type TestUniform = { value: unknown };

function sceneWithoutRenderer(
  enabled: boolean,
  usePalette = 0,
): {
  scene: FractalScene;
  uniforms: Record<string, TestUniform>;
  voxelUniforms: Record<string, TestUniform>;
  setAttribute: ReturnType<typeof vi.fn>;
} {
  const scene = Object.create(FractalScene.prototype) as FractalScene;
  const uniforms: Record<string, TestUniform> = {
    uEchoUsePalette: { value: usePalette },
    uEchoPalette: { value: null },
  };
  const setAttribute = vi.fn();
  Reflect.set(scene, "balloonEchoMaterial", { uniforms });
  Reflect.set(scene, "balloonEchoPaletteTexture", null);
  Reflect.set(scene, "balloonPaletteEnabled", usePalette > 0);
  Reflect.set(scene, "balloonPaletteLUTVersion", 0);
  Reflect.set(scene, "balloonEchoEnabled", enabled);
  Reflect.set(scene, "surfaceBalloonOn", false);
  Reflect.set(scene, "renderNeeded", false);
  Reflect.set(scene, "pointGeometry", { setAttribute });
  const surfaceUniforms = {
    uBalloonColorLUT: { value: null },
    uBalloonPaletteEnabled: { value: 0 },
  };
  Reflect.set(scene, "surfaceMaterial", { uniforms: surfaceUniforms });
  Reflect.set(scene, "surfaceMaterial4", {
    uniforms: {
      uBalloonColorLUT: { value: null },
      uBalloonPaletteEnabled: { value: 0 },
    },
  });
  const voxelUniforms = {
    uBalloonColorLUT: { value: null },
    uBalloonPaletteEnabled: { value: usePalette },
  };
  Reflect.set(scene, "voxelMaterial", { uniforms: voxelUniforms });
  return { scene, uniforms, voxelUniforms, setAttribute };
}

function ramp(): Float32Array {
  const lut = new Float32Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    lut[i * 3] = i / 255;
    lut[i * 3 + 1] = 0.5;
    lut[i * 3 + 2] = 1 - i / 255;
  }
  return lut;
}

describe("shared scene balloon palette upload", () => {
  it("uses null as explicit inherit without allocating or touching primary colors", () => {
    const { scene, uniforms, voxelUniforms, setAttribute } =
      sceneWithoutRenderer(true, 1);

    scene.setBalloonPalette(null);

    expect(uniforms.uEchoUsePalette.value).toBe(0);
    expect(voxelUniforms.uBalloonPaletteEnabled.value).toBe(0);
    expect(uniforms.uEchoPalette.value).toBeNull();
    expect(Reflect.get(scene, "balloonEchoPaletteTexture")).toBeNull();
    expect(setAttribute).not.toHaveBeenCalled();
    expect(Reflect.get(scene, "renderNeeded")).toBe(true);
  });

  it("uploads a balloon-only 256-entry texture and leaves primary geometry untouched", () => {
    const { scene, uniforms, voxelUniforms, setAttribute } =
      sceneWithoutRenderer(true);
    const lut = ramp();

    scene.setBalloonPalette(lut);

    expect(uniforms.uEchoUsePalette.value).toBe(1);
    const texture = uniforms.uEchoPalette.value as THREE.DataTexture;
    expect(texture).toBeInstanceOf(THREE.DataTexture);
    expect(texture.minFilter).toBe(THREE.NearestFilter);
    expect(texture.magFilter).toBe(THREE.NearestFilter);
    expect(voxelUniforms.uBalloonColorLUT.value).toBe(texture);
    expect(voxelUniforms.uBalloonPaletteEnabled.value).toBe(1);
    const bytes = texture.image.data as Uint8Array;
    expect(Array.from(bytes.slice(0, 4))).toEqual([0, 128, 255, 255]);
    expect(Array.from(bytes.slice(-4))).toEqual([255, 128, 0, 255]);
    expect(setAttribute).not.toHaveBeenCalled();
    expect(Reflect.get(scene, "renderNeeded")).toBe(true);
  });

  it("does not dirty a frame while the echo draw is disabled", () => {
    const { scene } = sceneWithoutRenderer(false);

    scene.setBalloonPalette(ramp());

    expect(Reflect.get(scene, "renderNeeded")).toBe(false);
  });

  it("rejects malformed LUT lengths before allocating", () => {
    const { scene, uniforms } = sceneWithoutRenderer(true);

    expect(() => scene.setBalloonPalette(new Float32Array(3))).toThrow(
      /768 channels/,
    );
    expect(uniforms.uEchoPalette.value).toBeNull();
  });
});

describe("Points balloon palette shader", () => {
  it("keeps inherit on the old sourceColor path and recolors only the echo-local source", () => {
    expect(BALLOON_ECHO_VERTEX).toContain("vec3 sourceColor = color;");
    expect(BALLOON_ECHO_VERTEX).toContain("if (uEchoUsePalette > 0.5) {");
    expect(BALLOON_ECHO_VERTEX).toContain(
      "sourceColor = texture2D(uEchoPalette, vec2(paletteU, 0.5)).rgb;",
    );
    expect(BALLOON_ECHO_VERTEX).toContain(
      "vColor = mix(sourceColor, uEchoTint, uEchoTintStrength) *",
    );
    expect(BALLOON_ECHO_VERTEX).not.toContain("attribute vec3 balloonColor");
  });

  it("uses the shared pre-inversion source/rho coordinate in 3D and after 4D projection", () => {
    const project = BALLOON_ECHO_VERTEX.indexOf(
      "projectPoint4(source, sourceColor, slice);",
    );
    const branchEnd = BALLOON_ECHO_VERTEX.indexOf(
      "vec3 d = source - uEchoCenter;",
    );
    const coordinate = BALLOON_ECHO_VERTEX.indexOf(
      "clamp(length(d) / uEchoRho, 0.0, 1.0)",
    );
    const invert = BALLOON_ECHO_VERTEX.indexOf(
      "vec3 inv = uEchoCenter + (uEchoR * uEchoR / r2) * d;",
    );

    expect(project).toBeGreaterThan(-1);
    expect(branchEnd).toBeGreaterThan(project);
    expect(coordinate).toBeGreaterThan(branchEnd);
    expect(invert).toBeGreaterThan(coordinate);
    expect(BALLOON_ECHO_VERTEX.match(/texture2D\(uEchoPalette/g)).toHaveLength(
      1,
    );
  });

  it("looks up the palette before tint and applies dim/fade/magnification afterward", () => {
    const lookup = BALLOON_ECHO_VERTEX.indexOf(
      "sourceColor = texture2D(uEchoPalette",
    );
    const tint = BALLOON_ECHO_VERTEX.indexOf(
      "mix(sourceColor, uEchoTint, uEchoTintStrength)",
    );
    const intensity = BALLOON_ECHO_VERTEX.indexOf(
      "sourceIntensity * uEchoDim / max(mag, 1.0)",
    );
    const fade = BALLOON_ECHO_VERTEX.indexOf("* fade;", intensity);

    expect(lookup).toBeGreaterThan(-1);
    expect(tint).toBeGreaterThan(lookup);
    expect(intensity).toBeGreaterThan(tint);
    expect(fade).toBeGreaterThan(intensity);
  });
});

describe("landed finite Points Balloon ball", () => {
  function uploadScene() {
    const scene = Object.create(FractalScene.prototype) as FractalScene;
    const uniforms = {
      uEchoCenter: { value: new THREE.Vector3() },
      uEchoR: { value: 0 },
      uEchoRho: { value: 0 },
      uEchoFloor2: { value: 0 },
      uEchoFadeEnd: { value: 0 },
      uEchoFadeStart: { value: 0 },
    };
    const echo = { visible: false };
    Reflect.set(scene, "balloonEchoMaterial", { uniforms });
    Reflect.set(scene, "balloonEchoPoints", echo);
    Reflect.set(scene, "balloonEchoEnabled", true);
    Reflect.set(scene, "balloonEchoRadius", 0.7);
    Reflect.set(scene, "fogDensity", 1);
    Reflect.set(scene, "pointGeometry", new THREE.BufferGeometry());
    Reflect.set(scene, "balloonEchoSourceSphere", new THREE.Sphere());
    Reflect.set(scene, "solidBalloonSourceSphere", new THREE.Sphere());
    Reflect.set(scene, "fourDMaterial", {
      uniforms: {
        uCenter4: { value: new THREE.Vector4() },
      },
    });
    for (const method of [
      "setDrawCount",
      "setReplayCursor",
      "applySolidPresentation",
      "syncSolidBalloonUniforms",
      "updateWAmp4",
      "updateFourDScaffoldPositions",
    ]) {
      Reflect.set(scene, method, vi.fn());
    }
    return { scene, uniforms, echo };
  }

  it.each([false, true])(
    "uses the certified origin radius before an enabled echo becomes visible (4D=%s)",
    (fourD) => {
      const { scene, uniforms, echo } = uploadScene();
      const positions = new Float32Array([0.5, 0.3, 0.1, -0.2, 0.7, -0.1]);
      if (fourD) {
        scene.setPoints4(
          positions,
          new Float32Array([0.1, -0.2]),
          [0, 0, 0, 0],
          0.8,
          0.8,
          [1, 1, 1, 1],
          2,
          "finite",
        );
      } else {
        scene.setPoints(positions, new Float32Array(6), 2, "finite");
      }
      expect(uniforms.uEchoCenter.value.toArray()).toEqual([0, 0, 0]);
      expect(uniforms.uEchoR.value).toBeCloseTo(1.4, 12);
      expect(uniforms.uEchoRho.value).toBe(2 * BALLOON_RHO_MARGIN);
      expect(scene.flameBalloon(0.7)).toMatchObject({
        center: [0, 0, 0],
        R: 1.4,
        rho: 2 * BALLOON_RHO_MARGIN,
      });
      expect(echo.visible).toBe(true);
    },
  );

  it("holds a landed lattice echo off until finite replacement installs its own ball", () => {
    const { scene, uniforms, echo } = uploadScene();
    const positions = new Float32Array([0.5, 0.3, 0.1]);
    scene.setPoints(positions, new Float32Array(3), 2, "lattice");
    scene.setBalloonEchoRadius(0.9);
    expect(echo.visible).toBe(false);
    scene.setPoints(positions, new Float32Array(3), 3, "finite");
    expect(uniforms.uEchoR.value).toBe(2.7);
    expect(echo.visible).toBe(true);
    scene.setPoints(new Float32Array(), new Float32Array(), 3, "finite");
    expect(echo.visible).toBe(false);
    expect(scene.flameBalloon(0.9)).toBeNull();
  });
});
