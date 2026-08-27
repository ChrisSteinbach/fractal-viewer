import * as THREE from "three";
import { FOUR_D_FRAGMENT, FOUR_D_VERTEX, FractalScene } from "./scene";
import type { RenderStyle } from "./state";

type TestUniform = { value: unknown };

function sceneWithoutRenderer(): {
  scene: FractalScene;
  fourDUniforms: Record<string, TestUniform>;
  rendererRender: ReturnType<typeof vi.fn>;
  composerRender: ReturnType<typeof vi.fn>;
  updateFourDFade: ReturnType<typeof vi.fn>;
} {
  const scene = Object.create(FractalScene.prototype) as FractalScene;
  const fourDUniforms: Record<string, TestUniform> = {
    uDepthStyle: { value: 0 },
    uGlowExposure: { value: 1 },
    uFocus: { value: -1 },
  };
  const rendererRender = vi.fn();
  const composerRender = vi.fn();
  const updateFourDFade = vi.fn();
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(3, 4, 0);

  Reflect.set(scene, "scene", new THREE.Scene());
  Reflect.set(scene, "camera", camera);
  Reflect.set(scene, "renderer", { render: rendererRender });
  Reflect.set(scene, "composer", { render: composerRender });
  Reflect.set(scene, "fourDMaterial", { uniforms: fourDUniforms });
  Reflect.set(scene, "dofMaterial", { uniforms: { uFocus: { value: -1 } } });
  Reflect.set(scene, "glowMaterial", { opacity: 0.28 });
  Reflect.set(scene, "pointGeometry", {
    boundingSphere: new THREE.Sphere(new THREE.Vector3(), 2),
  });
  Reflect.set(scene, "fourDActive", true);
  Reflect.set(scene, "renderStyle", "depthFade");
  Reflect.set(scene, "renderNeeded", true);
  Reflect.set(scene, "updateFourDFade", updateFourDFade);

  return {
    scene,
    fourDUniforms,
    rendererRender,
    composerRender,
    updateFourDFade,
  };
}

describe("4D point depth styles", () => {
  it.each([
    ["depthFade", 0],
    ["glow", 1],
    ["dof", 2],
    // These are deliberate refusals, not accidental pass selections: a
    // coloured fog contribution cannot be repeated per additive layer, and
    // EDL's one depth sample cannot describe projected w-layer overlap.
    ["aerial", 0],
    ["edl", 0],
  ] satisfies [RenderStyle, number][])(
    "maps %s to the dedicated 4D material mode %i",
    (style, expected) => {
      const { scene, fourDUniforms } = sceneWithoutRenderer();
      const material = Reflect.get(scene, "fourDMaterial");
      Reflect.set(scene, "pointCloud", { material });

      scene.setRenderStyle(style);

      expect(fourDUniforms.uDepthStyle.value).toBe(expected);
      expect(Reflect.get(scene, "pointCloud").material).toBe(material);
      expect(Reflect.get(scene, "renderStyle")).toBe(style);
    },
  );

  it("routes 4D glow through bloom while keeping the additive 4D material installed", () => {
    const { scene, rendererRender, composerRender, updateFourDFade } =
      sceneWithoutRenderer();
    const material = Reflect.get(scene, "fourDMaterial");
    Reflect.set(scene, "pointCloud", { material });
    scene.setRenderStyle("glow");

    scene.render();

    expect(updateFourDFade).toHaveBeenCalledOnce();
    expect(composerRender).toHaveBeenCalledOnce();
    expect(rendererRender).not.toHaveBeenCalled();
    expect(Reflect.get(scene, "pointCloud").material).toBe(material);
  });

  it("focuses 4D DOF on the projected cloud ball and renders without a depth pass", () => {
    const { scene, fourDUniforms, rendererRender, composerRender } =
      sceneWithoutRenderer();
    scene.setRenderStyle("dof");

    scene.render();

    expect(fourDUniforms.uFocus.value).toBe(5);
    expect(rendererRender).toHaveBeenCalledOnce();
    expect(composerRender).not.toHaveBeenCalled();
  });

  it.each(["aerial", "edl"] satisfies RenderStyle[])(
    "keeps the %s refusal on the plain additive render path",
    (style) => {
      const { scene, fourDUniforms, rendererRender, composerRender } =
        sceneWithoutRenderer();
      scene.setRenderStyle(style);

      scene.render();

      expect(fourDUniforms.uDepthStyle.value).toBe(0);
      expect(fourDUniforms.uFocus.value).toBe(-1);
      expect(rendererRender).toHaveBeenCalledOnce();
      expect(composerRender).not.toHaveBeenCalled();
    },
  );

  it("threads glow exposure into the 4D shader as well as flat glow", () => {
    const { scene, fourDUniforms } = sceneWithoutRenderer();

    scene.setGlowExposure(1.75);

    expect(fourDUniforms.uGlowExposure.value).toBe(1.75);
    expect(Reflect.get(scene, "glowMaterial").opacity).toBeCloseTo(0.49);
    expect(Reflect.get(scene, "renderNeeded")).toBe(true);
  });
});

describe("4D point depth shader", () => {
  it("computes DOF after 4D projection from camera-space depth and conserves additive energy", () => {
    const project = FOUR_D_VERTEX.indexOf(
      "projectPoint4(projected, vColor, slice);",
    );
    const cameraDepth = FOUR_D_VERTEX.indexOf("float dist = -mv.z;");
    const coc = FOUR_D_VERTEX.indexOf("float coc = min(uMaxBlur");
    const correction = FOUR_D_VERTEX.indexOf("vAlpha /= coc * coc;");

    expect(project).toBeGreaterThan(-1);
    expect(cameraDepth).toBeGreaterThan(project);
    expect(coc).toBeGreaterThan(cameraDepth);
    expect(correction).toBeGreaterThan(coc);
  });

  it("gives glow and DOF soft sprites without changing RGB layer colours", () => {
    expect(FOUR_D_FRAGMENT).toContain("uniform float uDepthStyle;");
    expect(FOUR_D_FRAGMENT).toContain(
      "float r = length(2.0 * gl_PointCoord - 1.0);",
    );
    expect(FOUR_D_FRAGMENT).toContain("a *= glow;");
    expect(FOUR_D_FRAGMENT).toContain("a *= smoothstep(1.0, 0.25, r);");
    expect(FOUR_D_FRAGMENT).toContain("gl_FragColor = vec4(vColor, a);");
  });
});
