import * as THREE from "three";
import {
  configureVoxelMaxHierarchyTexture,
  configureVoxelTexture,
  createVoxelMaterial,
  emptyVoxelMaxHierarchyTexture,
  emptyVoxelTexture,
  marchStepsForGrid,
  packVoxelBalloonPalette,
  packVoxelBalloonTint,
  packVoxelPresentation,
  sampleVoxelAlpha,
  setVoxelBalloon,
  solidBalloonCenterIsEmpty,
  SOLID_BALLOON_ECHO_WEIGHT,
  updateVoxelMaxHierarchyTexture,
  voxelMaxHierarchyLevelTexture,
  voxelFragmentFor,
} from "./voxel-material";
import { presentationFloorSpec } from "../fractal/presentation-floor";
import { buildVoxelMaxHierarchy } from "../fractal/voxel-max-hierarchy";
import { VOXEL_MAX_HIERARCHY_TRAVERSAL_CELL_SPAN } from "../fractal/voxel-max-hierarchy";

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

describe("Solid environment and floor presentation programs", () => {
  const floor = presentationFloorSpec(
    { center: [1, 2, 3], radius: 4 },
    { pattern: "checker", tileScale: 0.8, emission: 1.5 },
  )!;

  it("preserves every legacy source exactly when both features are off", () => {
    const plain = voxelFragmentFor(false);
    const accelerated = voxelFragmentFor(false, true);
    const balloon = voxelFragmentFor(true);
    const balloonAccelerated = voxelFragmentFor(true, true);

    expect(voxelFragmentFor(false, false, false, false)).toBe(plain);
    expect(voxelFragmentFor(false, true, false, false)).toBe(accelerated);
    expect(voxelFragmentFor(true, false, false, false)).toBe(balloon);
    expect(voxelFragmentFor(true, true, false, false)).toBe(balloonAccelerated);
    for (const source of [plain, accelerated, balloon, balloonAccelerated]) {
      expect(source).not.toContain("uEnvLight");
      expect(source).not.toContain("shadeVoxelFloor");
      expect(source).not.toContain("uGroundY");
    }
  });

  it("uses Surface's normalized two-stop hue convention on every geometry/acceleration arm", () => {
    for (const balloon of [false, true]) {
      for (const accelerated of [false, true]) {
        const source = voxelFragmentFor(balloon, accelerated, true, false);
        expect(source).toContain(
          "vec3 e = mix(uBgBottom, uBgTop, n.y * 0.5 + 0.5)",
        );
        expect(source).toContain("e / max(max(e.r, max(e.g, e.b)), 1.0e-4)");
        expect(source).toContain("voxelEnvTint(n)");
        expect(source).toContain(
          balloon ? "densityAtEcho(ro + rd * t)" : "vec2 tRange = boxIntersect",
        );
        if (accelerated) {
          expect(source).toContain("maxHierarchyNode");
        }
      }
    }
  });

  it("shades only misses with the one-sided, faded, bounded-read floor", () => {
    const source = voxelFragmentFor(false, true, true, true);

    expect(source.match(/shadeVoxelFloor\(ro, rd, background\)/g)).toHaveLength(
      2,
    );
    expect(source).toContain("if (ro.y <= uGroundY || rd.y >= -1.0e-6)");
    expect(source).toContain(
      "1.0 - smoothstep(\n      uGroundFadeStart,\n      uGroundFadeEnd",
    );
    expect(source).toContain(
      "vec2 shadowRange = boxIntersect(shadowOrigin, uLightDir)",
    );
    expect(source).toContain("for (int i = 0; i < SHADOW_STEPS; i++)");
    expect(source).toContain("all(greaterThanEqual(uvw, vec3(0.0)))");
    expect(source).toContain("if (uGroundPattern == 1)");
    expect(source).toContain("uGroundBallR * uGroundTileScale");
    expect(source).toContain("floorLinear * (lit + vec3(uGroundEmission))");
    expect(source).toContain("vec3 floorLinear = pow(floorAlbedo, vec3(2.2))");
    expect(source).toContain("vec3(1.0 / 2.2)");
    expect(source).toContain("dist * uFogDensity / max(uGroundBallR, 1.0e-6)");
    expect(source).toContain("maxHierarchyNode");
  });

  it("packs every scalar and recompiles only across effective axes", () => {
    const material = createVoxelMaterial(emptyVoxelTexture());
    const original = material.fragmentShader;
    const originalVersion = material.version;

    packVoxelPresentation(material, { envLight: 0, floor: null });
    expect(material.fragmentShader).toBe(original);
    expect(material.version).toBe(originalVersion);

    packVoxelPresentation(material, { envLight: 0.25, floor });
    expect(material.fragmentShader).toBe(
      voxelFragmentFor(false, false, true, true),
    );
    expect(material.version).toBe(originalVersion + 1);
    expect(material.uniforms.uEnvLight.value).toBe(0.25);
    expect(material.uniforms.uGroundY.value).toBeCloseTo(-2.08);
    expect(material.uniforms.uGroundFadeStart.value).toBe(16);
    expect(material.uniforms.uGroundFadeEnd.value).toBe(40);
    expect(material.uniforms.uGroundBallR.value).toBe(4);
    expect(material.uniforms.uGroundBallC.value.toArray()).toEqual([1, 2, 3]);
    expect(material.uniforms.uGroundAlbedo.value.toArray()).toEqual([
      0.62, 0.62, 0.62,
    ]);
    expect(material.uniforms.uGroundPattern.value).toBe(1);
    expect(material.uniforms.uGroundTileScale.value).toBe(0.8);
    expect(material.uniforms.uGroundEmission.value).toBe(1.5);

    packVoxelPresentation(material, {
      envLight: 0.75,
      floor: { ...floor, tileScale: 1.2, emission: 0.4 },
    });
    expect(material.version).toBe(originalVersion + 1);
    expect(material.uniforms.uEnvLight.value).toBe(0.75);
    expect(material.uniforms.uGroundTileScale.value).toBe(1.2);
    expect(material.uniforms.uGroundEmission.value).toBe(0.4);

    packVoxelPresentation(material, { envLight: 0, floor });
    expect(material.fragmentShader).toBe(
      voxelFragmentFor(false, false, false, true),
    );
    expect(material.version).toBe(originalVersion + 2);
    packVoxelPresentation(material, { envLight: 0, floor: null });
    expect(material.fragmentShader).toBe(original);
    expect(material.version).toBe(originalVersion + 3);
  });

  it("lets Balloon suppress the horizon and restores the requested floor", () => {
    const material = createVoxelMaterial(emptyVoxelTexture());
    const balloon = {
      center: [0, 0, 0] as [number, number, number],
      radius: 1,
      rho: 1.02,
      R: 1.6,
    };
    packVoxelPresentation(material, { envLight: 0, floor });
    const floorVersion = material.version;

    setVoxelBalloon(material, balloon);
    expect(material.fragmentShader).toBe(voxelFragmentFor(true));
    expect(material.fragmentShader).not.toContain("shadeVoxelFloor");
    expect(material.version).toBe(floorVersion + 1);

    const revised = { ...floor, tileScale: 1.25, emission: 0.7 };
    packVoxelPresentation(material, { envLight: 0, floor: revised });
    expect(material.fragmentShader).toBe(voxelFragmentFor(true));
    expect(material.version).toBe(floorVersion + 1);
    expect(material.uniforms.uGroundTileScale.value).toBe(1.25);

    setVoxelBalloon(material, null);
    expect(material.fragmentShader).toBe(
      voxelFragmentFor(false, false, false, true),
    );
    expect(material.fragmentShader).toContain("shadeVoxelFloor");
    expect(material.uniforms.uGroundEmission.value).toBe(0.7);
    expect(material.version).toBe(floorVersion + 2);
  });

  it("keeps the active presentation axes across hierarchy uploads and fallback", () => {
    const material = createVoxelMaterial(emptyVoxelTexture());
    packVoxelPresentation(material, { envLight: 0.4, floor });
    const packed = new Uint8Array(32 ** 3 * 4);
    for (let i = 0; i < 32 ** 3; i++) packed[i * 4 + 3] = i & 0xff;

    const texture = updateVoxelMaxHierarchyTexture(
      material,
      null,
      buildVoxelMaxHierarchy(packed, 32),
    );
    expect(material.fragmentShader).toBe(
      voxelFragmentFor(false, true, true, true),
    );
    expect(material.fragmentShader).toContain("maxHierarchyNode");
    expect(material.fragmentShader).toContain("shadeVoxelFloor");
    expect(material.fragmentShader).toContain("voxelEnvTint(n)");

    updateVoxelMaxHierarchyTexture(material, texture, null);
    expect(material.fragmentShader).toBe(
      voxelFragmentFor(false, false, true, true),
    );
  });

  it("never admits a Balloon+Floor program, including accelerated variants", () => {
    expect(voxelFragmentFor(true, false, false, true)).toBe(
      voxelFragmentFor(true, false, false, false),
    );
    expect(voxelFragmentFor(true, true, true, true)).toBe(
      voxelFragmentFor(true, true, true, false),
    );
  });
});

describe("Solid max-density hierarchy GPU payload", () => {
  function hierarchy(size: number, seed = 0) {
    const packed = new Uint8Array(size ** 3 * 4);
    for (let i = 0; i < size ** 3; i++) {
      packed[i * 4 + 3] = (i * 47 + seed) & 0xff;
    }
    return buildVoxelMaxHierarchy(packed, size);
  }

  it("selects only the fixed cellSpan-16 level as a no-copy R8 cube", () => {
    const source = hierarchy(32);
    const level = source.levels.find(
      ({ cellSpan }) => cellSpan === VOXEL_MAX_HIERARCHY_TRAVERSAL_CELL_SPAN,
    )!;
    const upload = voxelMaxHierarchyLevelTexture(source);

    expect(upload).toMatchObject({
      size: 3,
      cellSpan: VOXEL_MAX_HIERARCHY_TRAVERSAL_CELL_SPAN,
    });
    expect(upload.data).toHaveLength(27);
    expect(upload.data.buffer).toBe(source.data.buffer);
    expect(upload.data.byteOffset).toBe(source.data.byteOffset + level.offset);
    expect(upload.data).toEqual(
      source.data.subarray(level.offset, level.offset + level.length),
    );
  });

  it("configures an exact nearest-neighbour R8 sampler", () => {
    const texture = emptyVoxelMaxHierarchyTexture();
    configureVoxelMaxHierarchyTexture(texture);

    expect(texture.format).toBe(THREE.RedFormat);
    expect(texture.type).toBe(THREE.UnsignedByteType);
    expect(texture.minFilter).toBe(THREE.NearestFilter);
    expect(texture.magFilter).toBe(THREE.NearestFilter);
    expect(texture.wrapS).toBe(THREE.ClampToEdgeWrapping);
    expect(texture.wrapT).toBe(THREE.ClampToEdgeWrapping);
    expect(texture.wrapR).toBe(THREE.ClampToEdgeWrapping);
    expect(texture.generateMipmaps).toBe(false);
    expect(texture.unpackAlignment).toBe(1);
  });

  it("starts explicitly absent without changing the unaccelerated shader source", () => {
    const material = createVoxelMaterial(emptyVoxelTexture());

    expect(material.fragmentShader).toBe(voxelFragmentFor(false));
    expect(material.uniforms.uMaxHierarchyEnabled.value).toBe(0);
    expect(material.uniforms.uMaxHierarchyLevelSize.value).toBe(1);
    expect(material.uniforms.uMaxHierarchyCellSpan.value).toBe(
      VOXEL_MAX_HIERARCHY_TRAVERSAL_CELL_SPAN,
    );
    expect(material.uniforms.uMaxHierarchy.value).toBeInstanceOf(
      THREE.Data3DTexture,
    );
    expect(material.uniforms.uMaxHierarchy.value.image).toMatchObject({
      width: 1,
      height: 1,
      depth: 1,
    });
  });

  it("uses the bounded fixed-lattice program only while acceleration is present", () => {
    const material = createVoxelMaterial(emptyVoxelTexture());
    const fallbackSource = voxelFragmentFor(false);

    const texture = updateVoxelMaxHierarchyTexture(
      material,
      null,
      hierarchy(32),
    );
    const accelerated = voxelFragmentFor(false, true);
    expect(material.fragmentShader).toBe(accelerated);
    expect(accelerated).toContain("texelFetch(uMaxHierarchy, node, 0).r");
    expect(accelerated).toContain("int latticeIndex = 0");
    expect(accelerated).toContain("float occupiedUntil = -1.0e30");
    expect(accelerated).toContain("nodeMaxAlpha <= uThreshold");
    expect(accelerated).toContain("tPrev = t + dt * float(advance - 1)");

    updateVoxelMaxHierarchyTexture(material, texture, null);
    expect(material.fragmentShader).toBe(fallbackSource);
    expect(fallbackSource).not.toContain("uMaxHierarchy");
  });

  it("accelerates only Balloon's straight primary loop and keeps its inverted echo loop", () => {
    const material = createVoxelMaterial(emptyVoxelTexture());
    const texture = updateVoxelMaxHierarchyTexture(
      material,
      null,
      hierarchy(32),
    );
    setVoxelBalloon(material, {
      center: [0, 0, 0],
      radius: 1,
      rho: 1.02,
      R: 1.6,
    });

    const source = voxelFragmentFor(true, true);
    expect(material.fragmentShader).toBe(source);
    expect(source).toContain("int primaryLatticeIndex = 0");
    expect(source).toContain("maxHierarchyNode(ro, rd, primaryT, nodeExitT)");
    expect(source).toContain("densityAtEcho(ro + rd * t)");
    expect(source).toContain("for (int i = 0; i < marchSteps; i++)");
    expect(source).toContain("densityAtFractal(sp + uLightDir * shadowT)");

    updateVoxelMaxHierarchyTexture(material, texture, null);
    expect(material.fragmentShader).toBe(voxelFragmentFor(true));
  });

  it("reuses same-sized progressive uploads and replaces changed dimensions", () => {
    const material = createVoxelMaterial(emptyVoxelTexture());
    const first = updateVoxelMaxHierarchyTexture(material, null, hierarchy(32));
    expect(first).not.toBeNull();
    expect(material.uniforms.uMaxHierarchy.value).toBe(first);
    expect(material.uniforms.uMaxHierarchyEnabled.value).toBe(1);
    expect(material.fragmentShader).toBe(voxelFragmentFor(false, true));
    expect(first!.image).toMatchObject({ width: 3, height: 3, depth: 3 });
    expect(material.uniforms.uMaxHierarchyLevelSize.value).toBe(3);
    expect(material.uniforms.uMaxHierarchyCellSpan.value).toBe(16);

    const firstDispose = vi.spyOn(first!, "dispose");
    const second = updateVoxelMaxHierarchyTexture(
      material,
      first,
      hierarchy(32, 1),
    );
    expect(second).toBe(first);
    expect(firstDispose).not.toHaveBeenCalled();

    const third = updateVoxelMaxHierarchyTexture(
      material,
      second,
      hierarchy(64),
    );
    expect(third).not.toBe(first);
    expect(third!.image).toMatchObject({ width: 5, height: 5, depth: 5 });
    expect(firstDispose).toHaveBeenCalledOnce();
  });

  it("disposes and resets every shader-facing field on explicit absence", () => {
    const material = createVoxelMaterial(emptyVoxelTexture());
    const texture = updateVoxelMaxHierarchyTexture(
      material,
      null,
      hierarchy(32),
    );
    const dispose = vi.spyOn(texture!, "dispose");

    expect(updateVoxelMaxHierarchyTexture(material, texture, null)).toBeNull();
    expect(dispose).toHaveBeenCalledOnce();
    expect(material.uniforms.uMaxHierarchy.value).not.toBe(texture);
    expect(material.uniforms.uMaxHierarchyEnabled.value).toBe(0);
    expect(material.uniforms.uMaxHierarchyLevelSize.value).toBe(1);
    expect(material.uniforms.uMaxHierarchyCellSpan.value).toBe(
      VOXEL_MAX_HIERARCHY_TRAVERSAL_CELL_SPAN,
    );
  });

  it("owns and disposes the material's permanent absent-state texture", () => {
    const material = createVoxelMaterial(emptyVoxelTexture());
    const fallback = material.uniforms.uMaxHierarchy
      .value as THREE.Data3DTexture;
    const dispose = vi.spyOn(fallback, "dispose");

    material.dispose();
    expect(dispose).toHaveBeenCalledOnce();
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
