import * as THREE from "three";
import {
  configureVoxelTexture,
  createVoxelMaterial,
  emptyVoxelTexture,
  marchStepsForGrid,
  packVoxelBalloonPalette,
  packVoxelBalloonTint,
  sampleVoxelAlpha,
  setVoxelBalloon,
  solidBalloonCenterIsEmpty,
  SOLID_BALLOON_ECHO_WEIGHT,
  voxelFragmentFor,
} from "./voxel-material";

describe("marchStepsForGrid", () => {
  it("holds the 220-step floor below the 256³ tuning point", () => {
    expect(marchStepsForGrid(192)).toBe(220);
  });

  it("returns exactly the tuned 220 steps at 256³", () => {
    expect(marchStepsForGrid(256)).toBe(220);
  });

  it("scales past the tuning point so the stride stays ~1.16 voxels", () => {
    expect(marchStepsForGrid(320)).toBe(275);
  });

  it("doubles the steps when the grid doubles to 512³", () => {
    expect(marchStepsForGrid(512)).toBe(440);
  });
});

describe("createVoxelMaterial backdrop source", () => {
  it("keeps the gradient path as the default and binds an image sampler", () => {
    const background = new THREE.Texture();
    const material = createVoxelMaterial(emptyVoxelTexture(), background);

    expect(material.uniforms.uBgImage.value).toBe(background);
    expect(material.uniforms.uBgImageOn.value).toBe(0);
    expect(material.fragmentShader).toContain("uBgImageOn == 1");
    expect(material.fragmentShader).toContain("texture(uBgImage, vUv).rgb");
  });
});

describe("voxel balloon shader variant", () => {
  it("keeps the off program exact and free of balloon query code", () => {
    const material = createVoxelMaterial(emptyVoxelTexture());
    const off = voxelFragmentFor(false);

    expect(material.fragmentShader).toBe(off);
    expect(off).not.toContain("boundedVolumeSample");
    expect(off).not.toContain("uBalloonCenter");
    expect(off).toContain("for (int i = 0; i < uMarchSteps; i++)");
  });

  it("samples the same bounded volume at p and I(p), with strict shell attribution and echo-only tint", () => {
    const on = voxelFragmentFor(true);

    expect(on).toContain("vec4 boundedVolumeSample(vec3 p)");
    expect(on).toContain("return vec4(0.0)");
    expect(on).toContain("uBalloonCenter + (uBalloonR * uBalloonR / r2) * d");
    expect(on).toContain("return max(primary, echo)");
    expect(on).toContain(
      `${SOLID_BALLOON_ECHO_WEIGHT.toFixed(1)} * echo.a > primary.a`,
    );
    expect(on).toContain(
      "return mix(base, uBalloonTint, uBalloonTintStrength)",
    );
    expect(on.indexOf("base = texture(uBalloonColorLUT")).toBeLessThan(
      on.indexOf("return mix(base, uBalloonTint"),
    );
  });

  it("marches to the shared far horizon at the source-volume stride and lets only the fractal cast shadows", () => {
    const on = voxelFragmentFor(true);

    expect(on).toContain("densityAtFractal(ro + rd * primaryT)");
    expect(on).toContain("densityAtEcho(ro + rd * t)");
    expect(on).toContain("float hi = min(primaryHi, echoHi)");
    expect(on).toContain(
      "float tFar = length(ro - uBalloonCenter) + uBalloonFar",
    );
    expect(on).toContain("int marchSteps = min(");
    expect(on).toContain("for (int i = 0; i < marchSteps; i++)");
    expect(on).toContain("vec2 shadowRange = boxIntersect(sp, uLightDir)");
    expect(on).toContain("densityAtFractal(sp + uLightDir * shadowT)");
  });

  it("rebuilds only when the on/off program changes; radius and tint stay uniform-only", () => {
    const material = createVoxelMaterial(emptyVoxelTexture());
    const spec = {
      center: [1, 2, 3] as [number, number, number],
      radius: 4,
      rho: 4.08,
      R: 6.4,
    };
    const initialVersion = material.version;

    setVoxelBalloon(material, spec);
    expect(material.fragmentShader).toBe(voxelFragmentFor(true));
    expect(material.version).toBe(initialVersion + 1);
    expect(material.uniforms.uBalloonFar.value).toBeCloseTo(40.8);

    setVoxelBalloon(material, { ...spec, R: 2 });
    packVoxelBalloonTint(material, [0.2, 0.4, 0.6], 0.75);
    expect(material.version).toBe(initialVersion + 1);
    expect(material.uniforms.uBalloonR.value).toBe(2);
    expect(material.uniforms.uBalloonTintStrength.value).toBe(0.75);

    setVoxelBalloon(material, null);
    expect(material.fragmentShader).toBe(voxelFragmentFor(false));
    expect(material.version).toBe(initialVersion + 2);
  });

  it("binds the shared independent balloon palette without rebuilding", () => {
    const material = createVoxelMaterial(emptyVoxelTexture());
    const texture = new THREE.DataTexture(new Uint8Array(256 * 4), 256, 1);
    const initialVersion = material.version;

    packVoxelBalloonPalette(material, texture);
    expect(material.uniforms.uBalloonColorLUT.value).toBe(texture);
    expect(material.uniforms.uBalloonPaletteEnabled.value).toBe(1);
    packVoxelBalloonPalette(material, null);
    expect(material.uniforms.uBalloonPaletteEnabled.value).toBe(0);
    expect(material.version).toBe(initialVersion);
  });
});

describe("Solid balloon volume/refusal sampling", () => {
  it("keeps ClampToEdge sampler state explicit while the shader owns outside-zero", () => {
    const texture = new THREE.Data3DTexture(new Uint8Array(4), 1, 1, 1);
    configureVoxelTexture(texture);

    expect(texture.wrapS).toBe(THREE.ClampToEdgeWrapping);
    expect(texture.wrapT).toBe(THREE.ClampToEdgeWrapping);
    expect(texture.wrapR).toBe(THREE.ClampToEdgeWrapping);
  });

  it("trilinearly samples packed alpha at normalized texture coordinates and returns zero outside", () => {
    const data = new Uint8Array(2 * 2 * 2 * 4);
    for (let i = 0; i < 8; i++) data[i * 4 + 3] = i * 20;

    expect(
      sampleVoxelAlpha(data, 2, [0, 0, 0], [2, 2, 2], [1, 1, 1]),
    ).toBeCloseTo(70 / 255, 8);
    expect(sampleVoxelAlpha(data, 2, [0, 0, 0], [2, 2, 2], [-0.01, 1, 1])).toBe(
      0,
    );
  });

  it("refuses only a strict above-threshold centre (ties are not hits)", () => {
    expect(solidBalloonCenterIsEmpty(0.3, 0.3)).toBe(true);
    expect(solidBalloonCenterIsEmpty(0.301, 0.3)).toBe(false);
  });
});
