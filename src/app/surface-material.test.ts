import type * as THREE from "three";
import {
  buildSurfaceFragment,
  createSurfaceMaterial,
  setBulbSystem,
  setSurfaceBalloon,
  setSurfaceGroundPlane,
  setSurfaceSystem,
  surfaceFragmentFor,
  SURFACE_MAX_MAPS,
  SURFACE_SHADE_DE_WIDTH,
} from "./surface-material";
import {
  buildBulbDE,
  BULB_ITERATIONS,
  BULB_STEP_SCALE,
} from "../fractal/bulb-de";
import type {
  SurfaceBalloonSpec,
  SurfaceGroundPlaneSpec,
} from "./surface-material";
import {
  BALLOON_FAR_CAP_RHO,
  BALLOON_RHO_MARGIN,
  balloonBall,
  buildBalloon,
} from "../fractal/balloon-de";
import {
  buildSurfaceDE,
  CLASSIC_SURFACE_FOLD_RADII,
  SURFACE_FOLD_BEAM_WIDTH,
} from "../fractal/surface-de";
import type { SurfaceDE, SurfaceDEMap } from "../fractal/surface-de";
import { defaultTransforms, sierpinskiTetrahedron } from "../fractal/presets";
import type { Transform, Vec3 } from "../fractal/types";

/**
 * The tracer itself is verified by running the app, but its kaleidoscope
 * PACKER is pinned here (fr-x029). The descent sweeps symmetry sectors
 * instead of expanding them into map slots, so the whole kaleidoscope
 * crosses into GLSL as three scalars — an order, a PLANE CODE, and one
 * (cos, sin) step. A plane mapped to the wrong int, or a step of the wrong
 * sign, rotates the estimator's sectors away from the plotted attractor and
 * is invisible until someone loads a kaleidoscope in a browser. These are
 * pure uniform reads: no GL context involved.
 */

/** A minimal contracting inverse-map slot, merged with each test's
 * overrides (identity inverse unless a test cares about the matrix). */
function map3(overrides: Partial<SurfaceDEMap> = {}): SurfaceDEMap {
  return {
    invM: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    invT: [0, 0, 0],
    sigmaMin: 0.5,
    foldKind: 0,
    foldInvW: 1,
    foldSigma: 0.5,
    foldRadii: CLASSIC_SURFACE_FOLD_RADII,
    baseIndex: 0,
    invMSigmaMin: 1,
    invTNorm: 0,
    bnbDir: [0, 0, 0],
    ...overrides,
  };
}

/** The smallest DE the packer accepts, wrapped around the given slots. */
function de3(
  maps: SurfaceDEMap[],
  symmetry: SurfaceDE["symmetry"] = {
    order: 1,
    plane: "xz",
    stepCos: 1,
    stepSin: 0,
  },
): SurfaceDE {
  return {
    maps,
    symmetry,
    boundingRadius: 1,
    boundCenter: [0, 0, 0],
    visibleBoundingRadius: 1,
    escapeRadius: 2,
    maxDepth: 8,
    slowestSigma: 0.5,
    beamWidth: 4,
    stepScale: 1,
    final: null,
    foldFinal: null,
  };
}

const black: Vec3 = [0, 0, 0];

describe("setSurfaceSystem kaleidoscope packing", () => {
  it("passes a symmetry-free system a single sector with no rotation", () => {
    const material = createSurfaceMaterial();
    setSurfaceSystem(material, de3([map3()]), [black]);
    const u = material.uniforms;
    expect(u.uSymOrder.value).toBe(1);
    expect((u.uSymStep.value as THREE.Vector2).x).toBe(1);
    expect((u.uSymStep.value as THREE.Vector2).y).toBe(0);
  });

  it("passes the bounding ball's center through (fr-pjqw)", () => {
    const material = createSurfaceMaterial();
    const de = de3([map3()]);
    setSurfaceSystem(material, { ...de, boundCenter: [0.5, -1.25, 2] }, [
      black,
    ]);
    const center = material.uniforms.uBoundCenter.value as THREE.Vector3;
    expect(center.x).toBe(0.5);
    expect(center.y).toBe(-1.25);
    expect(center.z).toBe(2);
    // The next system must not inherit it.
    setSurfaceSystem(material, de3([map3()]), [black]);
    expect(center.x).toBe(0);
    expect(center.y).toBe(0);
    expect(center.z).toBe(0);
  });

  it("codes the yz plane as 0, xz as 1 and xy as 2 — the frozen pre-fr-q0h6 axis codes", () => {
    const material = createSurfaceMaterial();
    for (const [plane, code] of [
      ["yz", 0],
      ["xz", 1],
      ["xy", 2],
    ] as const) {
      setSurfaceSystem(
        material,
        de3([map3()], { order: 5, plane, stepCos: 1, stepSin: 0 }),
        [black],
      );
      expect(material.uniforms.uSymPlane.value).toBe(code);
    }
  });

  it("hands the shader the sector count and its one step, not an expansion", () => {
    const material = createSurfaceMaterial();
    const de = buildSurfaceDE(sierpinskiTetrahedron(), null, {
      order: 6,
      plane: "xy",
    });
    setSurfaceSystem(material, de, [black, black, black, black]);
    const u = material.uniforms;
    // 4 base maps at order 6 would have been 24 expanded slots.
    expect(u.uMapCount.value).toBe(4);
    expect(u.uSymOrder.value).toBe(6);
    expect((u.uSymStep.value as THREE.Vector2).x).toBeCloseTo(
      Math.cos((2 * Math.PI) / 6),
      6,
    );
    expect((u.uSymStep.value as THREE.Vector2).y).toBeCloseTo(
      Math.sin((2 * Math.PI) / 6),
      6,
    );
  });

  it("accepts an order that would have overflowed the expanded slot budget", () => {
    const material = createSurfaceMaterial();
    // 4 base maps x order 9 = 36 copies: refused outright before fr-x029.
    const de = buildSurfaceDE(sierpinskiTetrahedron(), null, {
      order: 9,
      plane: "xz",
    });
    expect(() =>
      setSurfaceSystem(material, de, [black, black, black, black]),
    ).not.toThrow();
    expect(material.uniforms.uSymOrder.value).toBe(9);
  });

  it("still refuses more BASE maps than the uniform arrays carry", () => {
    const material = createSurfaceMaterial();
    const tooMany = Array.from({ length: SURFACE_MAX_MAPS + 1 }, () => map3());
    expect(() =>
      setSurfaceSystem(
        material,
        de3(tooMany),
        tooMany.map(() => black),
      ),
    ).toThrow(RangeError);
  });
});

describe("setSurfaceSystem fold final lens packing (fr-g58b)", () => {
  it("packs the lens uniforms, flips SURFACE_FOLD_LENS, and keeps the cores' uFinal* at identity", () => {
    const material = createSurfaceMaterial();
    const de = de3([map3()]);
    de.foldFinal = {
      invM: [1, 0, 0, 0, 2, 0, 0, 0, 4],
      invT: [0.1, -0.2, 0.3],
      sigmaMin: 0.7,
      foldKind: 1,
      invW: 1 / 1.4,
      absW: 1.4,
      foldRadii: CLASSIC_SURFACE_FOLD_RADII,
    };
    setSurfaceSystem(material, de, [black]);
    const u = material.uniforms;
    expect(material.defines.SURFACE_FOLD_LENS).toBe(1);
    const params = u.uLensParams.value as THREE.Vector4;
    expect(params.x).toBe(1);
    expect(params.y).toBeCloseTo(1 / 1.4, 12);
    expect(params.z).toBeCloseTo(1.4, 12);
    expect(params.w).toBeCloseTo(0.7, 12);
    const lensT = u.uLensInvT.value as THREE.Vector3;
    expect([lensT.x, lensT.y, lensT.z]).toEqual([0.1, -0.2, 0.3]);
    // The cores must run their no-lens arithmetic: identity / zero / 1.
    const finalM = u.uFinalInvM.value as THREE.Matrix3;
    expect(Array.from(finalM.elements)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(u.uFinalSigmaMin.value).toBe(1);
  });

  it("keeps every variant's fragment source free of the other variants' text", () => {
    // The measured Mesa edge (fr-kltj follow-up): the fold variant's
    // compiler crashed when the source merely GREW past ~80KB with
    // preprocessor-dead lens/escape arms — so the arms are resolved
    // JS-side and each variant's source carries only its own bodies.
    const material = createSurfaceMaterial();
    // Default: no lens wrapper, no escape loop, SURFACE_FOLDS still a
    // driver-side conditional.
    expect(material.fragmentShader).not.toContain("surfaceDECore");
    expect(material.fragmentShader).not.toContain("uEscParams.y * y");
    expect(material.fragmentShader).toContain("#if SURFACE_FOLDS");

    const withLens = de3([map3()]);
    withLens.foldFinal = {
      invM: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      invT: [0, 0, 0],
      sigmaMin: 1,
      foldKind: 1,
      invW: 1,
      absW: 1,
      foldRadii: CLASSIC_SURFACE_FOLD_RADII,
    };
    setSurfaceSystem(material, withLens, [black]);
    expect(material.fragmentShader).toContain("surfaceDECore");
    expect(material.fragmentShader).not.toContain("uEscParams.y * y");
  });

  it("resets the lens uniforms and the define when the next system has no fold final", () => {
    const material = createSurfaceMaterial();
    const withLens = de3([map3()]);
    withLens.foldFinal = {
      invM: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      invT: [0, 0, 0],
      sigmaMin: 1,
      foldKind: 3,
      invW: 1,
      absW: 1,
      foldRadii: CLASSIC_SURFACE_FOLD_RADII,
    };
    setSurfaceSystem(material, withLens, [black]);
    expect(material.defines.SURFACE_FOLD_LENS).toBe(1);

    setSurfaceSystem(material, de3([map3()]), [black]);
    expect(material.defines.SURFACE_FOLD_LENS).toBe(0);
    const params = material.uniforms.uLensParams.value as THREE.Vector4;
    expect([params.x, params.y, params.z, params.w]).toEqual([0, 1, 1, 1]);
  });
});

/** Counts non-overlapping occurrences of a literal substring. */
function countOccurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

describe("buildSurfaceFragment shade probe (fr-zqu8)", () => {
  it("keeps every variant free of the probe when built at the beam width (A/A)", () => {
    const source = buildSurfaceFragment(SURFACE_FOLD_BEAM_WIDTH);
    expect(surfaceFragmentFor(0, 0, 0, 0, 0, source)).not.toContain(
      "surfaceDEProbe",
    );
    expect(surfaceFragmentFor(0, 1, 0, 0, 0, source)).not.toContain(
      "surfaceDEProbe",
    );
    expect(surfaceFragmentFor(1, 0, 0, 0, 0, source)).not.toContain(
      "surfaceDEProbe",
    );
  });

  it("compiles exactly one width-1 probe, routed as the shading taps' value form", () => {
    const resolved = surfaceFragmentFor(0, 0, 0, 0, 0, buildSurfaceFragment(1));
    expect(
      countOccurrences(resolved, "float surfaceDEProbe(vec3 p, float cutoff)"),
    ).toBe(1);
    expect(resolved).toContain("return surfaceDEProbe(p, 0.0);");
  });

  it("strips the probe body's comments and indentation, unlike the public descent body", () => {
    const resolved = surfaceFragmentFor(0, 0, 0, 0, 0, buildSurfaceFragment(1));
    expect(resolved).toContain("\nvec3 fcQ[1];");
    expect(resolved).toContain("vec3 fcQ[FOLD_W];");
  });

  it("never changes the escape variant's source across probe widths", () => {
    const atWidth1 = surfaceFragmentFor(1, 0, 0, 0, 0, buildSurfaceFragment(1));
    const atBeamWidth = surfaceFragmentFor(
      1,
      0,
      0,
      0,
      0,
      buildSurfaceFragment(SURFACE_FOLD_BEAM_WIDTH),
    );
    expect(atWidth1).toBe(atBeamWidth);
  });

  it("carries no probe under the fold lens, which keeps its surfaceDECore rename", () => {
    const resolved = surfaceFragmentFor(0, 1, 0, 0, 0, buildSurfaceFragment(1));
    expect(resolved).not.toContain("surfaceDEProbe");
    expect(resolved).toContain("surfaceDECore");
  });

  it("adds the probe as a new name rather than another surfaceDE overload", () => {
    const needle = "float surfaceDE(vec3 p, float cutoff) {";
    const atWidth1 = surfaceFragmentFor(0, 0, 0, 0, 0, buildSurfaceFragment(1));
    const atBeamWidth = surfaceFragmentFor(
      0,
      0,
      0,
      0,
      0,
      buildSurfaceFragment(SURFACE_FOLD_BEAM_WIDTH),
    );
    expect(countOccurrences(atWidth1, needle)).toBe(
      countOccurrences(atBeamWidth, needle),
    );
  });

  it("ships width 1 by default, so the module's own fragment source carries the probe", () => {
    expect(SURFACE_SHADE_DE_WIDTH).toBe(1);
    const material = createSurfaceMaterial();
    expect(material.fragmentShader).toContain("surfaceDEProbe");
  });
});

describe("SURFACE_BALLOON variant (fr-5wlv.4)", () => {
  /** The spec scene.ts builds — fractal/balloon-de.ts's buildBalloon
   * convention (margined rho, world-unit R) plus the oracle's far cap. */
  function specFor(de: SurfaceDE, rMult: number): SurfaceBalloonSpec {
    const ball = balloonBall(de);
    return {
      center: ball.center,
      rho: ball.radius * BALLOON_RHO_MARGIN,
      R: rMult * ball.radius,
      far: BALLOON_FAR_CAP_RHO * ball.radius,
    };
  }

  it("strips every balloon token from every variant while the flag is off — the byte-identity mechanism", () => {
    // With balloon 0 the resolved source must be byte-identical to the
    // pre-balloon build: every added line lives in a resolver-owned
    // SURFACE_BALLOON arm, so no "Balloon"/"uBalloon" token may survive
    // (the shipped shader's own lowercase "balloon ghost" commentary
    // predates the feature and stays).
    for (const [escape, lens] of [
      [0, 0],
      [0, 1],
      [1, 0],
    ] as const) {
      const resolved = surfaceFragmentFor(escape, lens, 0);
      expect(resolved).not.toContain("Balloon");
      expect(resolved).not.toContain("uBalloon");
    }
  });

  it("compiles the wrapper over every variant with the flag on, leaving no unresolved variant conditionals", () => {
    for (const [escape, lens] of [
      [0, 0],
      [0, 1],
      [1, 0],
    ] as const) {
      const resolved = surfaceFragmentFor(escape, lens, 1);
      // The wrapper and its rename are in.
      expect(resolved).toContain("#define surfaceDE surfaceDEFractal");
      expect(resolved).toContain("vec3 balloonInvert(vec3 p, out float scale)");
      expect(resolved).toContain("surfaceDEBalloonHitInfo");
      // All three JS-resolved names are gone; only the driver-side
      // SURFACE_FOLDS conditionals may remain.
      expect(resolved).not.toContain("#if SURFACE_BALLOON");
      expect(resolved).not.toContain("#if SURFACE_ESCAPE");
      expect(resolved).not.toContain("#if SURFACE_FOLD_LENS");
    }
    // The affine/folds split stays a driver-side conditional under the
    // balloon, exactly as without it.
    expect(surfaceFragmentFor(0, 0, 1)).toContain("#if SURFACE_FOLDS");
  });

  it("balances the rename chain per variant: one #undef plain/escape, three under the lens", () => {
    // Under balloon+lens the surfaceDEFractal rename is #undef'd before
    // the core rename (a bare re-#define would be a redefinition error),
    // re-established at the lens wrapper head, and #undef'd once more
    // where the balloon wrapper takes the public name.
    expect(
      countOccurrences(surfaceFragmentFor(0, 0, 1), "#undef surfaceDE"),
    ).toBe(1);
    expect(
      countOccurrences(surfaceFragmentFor(1, 0, 1), "#undef surfaceDE"),
    ).toBe(1);
    expect(
      countOccurrences(surfaceFragmentFor(0, 1, 1), "#undef surfaceDE"),
    ).toBe(3);
    // Without the balloon the lens keeps its single shipped #undef.
    expect(
      countOccurrences(surfaceFragmentFor(0, 1, 0), "#undef surfaceDE"),
    ).toBe(1);
    // The core rename survives the balloon exactly once.
    expect(
      countOccurrences(
        surfaceFragmentFor(0, 1, 1),
        "#define surfaceDE surfaceDECore",
      ),
    ).toBe(1);
  });

  it("packs uniforms matching buildBalloon's numbers for a real DE, margined rho and far cap included", () => {
    const de = buildSurfaceDE(defaultTransforms(), null, {
      order: 1,
      plane: "xz",
    });
    const ball = balloonBall(de);
    const oracle = buildBalloon(de, 1.6);
    const spec = specFor(de, 1.6);
    // The spec-building convention IS the oracle's: same center, same
    // margined divisor, same world-unit R.
    expect(spec.center).toEqual(oracle.center);
    expect(spec.rho).toBe(oracle.rho);
    expect(spec.R).toBe(oracle.R);
    expect(spec.far).toBe(BALLOON_FAR_CAP_RHO * ball.radius);

    const material = createSurfaceMaterial();
    setSurfaceSystem(
      material,
      de,
      de.maps.map((): Vec3 => [0, 0, 0]),
    );
    setSurfaceBalloon(material, spec);
    expect(material.defines.SURFACE_BALLOON).toBe(1);
    expect(material.fragmentShader).toContain("balloonInvert");
    const u = material.uniforms;
    const center = u.uBalloonCenter.value as THREE.Vector3;
    expect([center.x, center.y, center.z]).toEqual([...oracle.center]);
    expect(u.uBalloonRho.value).toBe(oracle.rho);
    expect(u.uBalloonR.value).toBe(oracle.R);
    expect(u.uBalloonFar.value).toBe(BALLOON_FAR_CAP_RHO * ball.radius);
  });

  it("rewrites uniforms without touching the shader on an R-only change", () => {
    const de = buildSurfaceDE(defaultTransforms(), null, {
      order: 1,
      plane: "xz",
    });
    const material = createSurfaceMaterial();
    setSurfaceSystem(
      material,
      de,
      de.maps.map((): Vec3 => [0, 0, 0]),
    );
    const spec = specFor(de, 1.6);
    setSurfaceBalloon(material, spec);
    const shader = material.fragmentShader;

    setSurfaceBalloon(material, { ...spec, R: spec.R * 0.5 });

    // Same string identity — the radius slider's per-drag-tick guarantee.
    expect(material.fragmentShader).toBe(shader);
    expect(material.uniforms.uBalloonR.value).toBe(spec.R * 0.5);
    expect(material.defines.SURFACE_BALLOON).toBe(1);
  });

  it("survives a system swap: the define-comparison blocks preserve the current balloon flag", () => {
    const de = buildSurfaceDE(defaultTransforms(), null, {
      order: 1,
      plane: "xz",
    });
    const material = createSurfaceMaterial();
    setSurfaceSystem(
      material,
      de,
      de.maps.map((): Vec3 => [0, 0, 0]),
    );
    setSurfaceBalloon(material, specFor(de, 1.6));

    // A lens system forces a variant rebuild — the balloon must ride it.
    const withLens = de3([map3()]);
    withLens.foldFinal = {
      invM: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      invT: [0, 0, 0],
      sigmaMin: 1,
      foldKind: 1,
      invW: 1,
      absW: 1,
      foldRadii: CLASSIC_SURFACE_FOLD_RADII,
    };
    setSurfaceSystem(material, withLens, [black]);
    expect(material.defines.SURFACE_BALLOON).toBe(1);
    expect(material.fragmentShader).toContain("balloonInvert");
    expect(material.fragmentShader).toContain("surfaceDECore");

    // And null clears it back to the byte-identical pre-balloon source.
    setSurfaceBalloon(material, null);
    expect(material.defines.SURFACE_BALLOON).toBe(0);
    expect(material.fragmentShader).not.toContain("uBalloon");
  });
});

describe("SURFACE_GROUND_PLANE variant (fr-rhn5)", () => {
  it("strips every ground-plane token from every variant while the flag is off — the byte-identity mechanism", () => {
    for (const [escape, lens, balloon] of [
      [0, 0, 0],
      [0, 1, 0],
      [1, 0, 0],
      [0, 0, 1],
      [0, 1, 1],
      [1, 0, 1],
    ] as const) {
      const withPlaneOff = surfaceFragmentFor(escape, lens, balloon, 0);
      expect(withPlaneOff).not.toContain("uGround");
      expect(withPlaneOff).not.toContain("shadeGroundPlane");
      expect(withPlaneOff).not.toContain("SURFACE_GROUND_PLANE");
      // The plane arg omitted must resolve to the same explicit-0 source.
      expect(surfaceFragmentFor(escape, lens, balloon)).toBe(withPlaneOff);
    }
  });

  it("compiles the floor arm with the flag on — comment-stripped whole-source, and far under the fold source's Mesa-cliff budget", () => {
    const resolved = surfaceFragmentFor(0, 0, 0, 1);
    expect(resolved).toContain("vec3 shadeGroundPlane(");
    expect(resolved).toContain("uniform float uGroundY;");
    // The driver-side SURFACE_FOLDS conditional survives the strip.
    expect(resolved).toContain("#if SURFACE_FOLDS");
    // Plane programs are comment-stripped whole-source — raw size is what
    // Mesa prices — so no comment marker of either style survives.
    expect(resolved).not.toContain("//");
    expect(resolved).not.toContain("/*");
    expect(resolved.length).toBeLessThan(40 * 1024);
  });

  it("composes under the lens and escape variants, both staying far under the Mesa-cliff budget", () => {
    const lensed = surfaceFragmentFor(0, 1, 0, 1);
    expect(lensed).toContain("surfaceDECore");
    expect(lensed).toContain("shadeGroundPlane");
    expect(lensed.length).toBeLessThan(40 * 1024);

    const escaped = surfaceFragmentFor(1, 0, 0, 1);
    expect(escaped).toContain("shadeGroundPlane");
  });

  it("refuses to compile into the balloon variant — no horizon inside the shell", () => {
    expect(() => surfaceFragmentFor(0, 0, 1, 1)).toThrow(RangeError);
  });

  it("setSurfaceGroundPlane packs the spec into uniforms and flips the define; null resets both to the inert byte-identical off state", () => {
    const material = createSurfaceMaterial();
    const spec: SurfaceGroundPlaneSpec = {
      y: -1.2,
      fadeStart: 4,
      fadeEnd: 10,
      ballCenter: [0, 0, 0],
      ballRadius: 1,
      albedo: [0.62, 0.62, 0.62],
    };
    setSurfaceGroundPlane(material, spec);
    expect(material.defines.SURFACE_GROUND_PLANE).toBe(1);
    const u = material.uniforms;
    expect(u.uGroundY.value).toBe(-1.2);
    expect(u.uGroundFadeStart.value).toBe(4);
    expect(u.uGroundFadeEnd.value).toBe(10);
    expect(u.uGroundBallR.value).toBe(1);
    const ballC = u.uGroundBallC.value as THREE.Vector3;
    expect([ballC.x, ballC.y, ballC.z]).toEqual([0, 0, 0]);
    const albedo = u.uGroundAlbedo.value as THREE.Vector3;
    expect([albedo.x, albedo.y, albedo.z]).toEqual([0.62, 0.62, 0.62]);
    expect(material.fragmentShader).toContain("shadeGroundPlane");

    setSurfaceGroundPlane(material, null);
    expect(material.defines.SURFACE_GROUND_PLANE).toBe(0);
    expect(u.uGroundY.value).toBe(0);
    expect(u.uGroundFadeStart.value).toBe(0);
    expect(u.uGroundFadeEnd.value).toBe(0);
    expect(u.uGroundBallR.value).toBe(1);
    expect([ballC.x, ballC.y, ballC.z]).toEqual([0, 0, 0]);
    expect([albedo.x, albedo.y, albedo.z]).toEqual([1, 1, 1]);
    expect(material.fragmentShader).not.toContain("uGround");
  });

  it("survives a system swap into the lens variant: the define-comparison block preserves the current ground-plane flag", () => {
    const material = createSurfaceMaterial();
    setSurfaceGroundPlane(material, {
      y: -1.2,
      fadeStart: 4,
      fadeEnd: 10,
      ballCenter: [0, 0, 0],
      ballRadius: 1,
      albedo: [0.62, 0.62, 0.62],
    });
    expect(material.defines.SURFACE_GROUND_PLANE).toBe(1);

    const withLens = de3([map3()]);
    withLens.foldFinal = {
      invM: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      invT: [0, 0, 0],
      sigmaMin: 1,
      foldKind: 1,
      invW: 1,
      absW: 1,
      foldRadii: CLASSIC_SURFACE_FOLD_RADII,
    };
    setSurfaceSystem(material, withLens, [black]);
    expect(material.defines.SURFACE_GROUND_PLANE).toBe(1);
    expect(material.fragmentShader).toContain("surfaceDECore");
    expect(material.fragmentShader).toContain("shadeGroundPlane");
  });

  it("yields seniority to the balloon: enabling the balloon drops the ground plane, and re-enabling the plane over the balloon throws", () => {
    const material = createSurfaceMaterial();
    const spec: SurfaceGroundPlaneSpec = {
      y: -1.2,
      fadeStart: 4,
      fadeEnd: 10,
      ballCenter: [0, 0, 0],
      ballRadius: 1,
      albedo: [0.62, 0.62, 0.62],
    };
    setSurfaceGroundPlane(material, spec);
    expect(material.defines.SURFACE_GROUND_PLANE).toBe(1);

    // The spec-building convention IS the SURFACE_BALLOON describe's
    // specFor helper, inlined: buildBalloon's margined rho, world-unit R.
    const de = de3([map3()]);
    const ball = balloonBall(de);
    const balloonSpec: SurfaceBalloonSpec = {
      center: ball.center,
      rho: ball.radius * BALLOON_RHO_MARGIN,
      R: 1.6 * ball.radius,
      far: BALLOON_FAR_CAP_RHO * ball.radius,
    };
    setSurfaceBalloon(material, balloonSpec);
    expect(material.defines.SURFACE_GROUND_PLANE).toBe(0);
    expect(material.fragmentShader).toContain("uBalloon");
    expect(material.fragmentShader).not.toContain("shadeGroundPlane");

    // The balloon is senior: the plane cannot compile back in over it.
    expect(() => setSurfaceGroundPlane(material, spec)).toThrow(RangeError);
  });
});

describe("SURFACE_ESCAPE orbit trap (fr-byxb)", () => {
  it("normalizes the escape count by the PASS budget, so a chain reaches the same ramp a single map does", () => {
    const resolved = surfaceFragmentFor(1, 0);
    // uMaxDepth, never uMaxDepth * uMapCount: escapedAt counts single-link
    // steps and an orbit escapes after a handful of them however long the
    // chain is, so a step-budget denominator shrank the reachable slice of
    // the palette with every link added.
    expect(resolved).toContain(
      "trap = clamp((float(escapedAt) - escFrac) / float(uMaxDepth), 0.0, 1.0);",
    );
    expect(resolved).not.toContain("escFrac) / float(steps)");
  });

  it("keeps the step BUDGET as the loop bound and the escaped test, which are per-link quantities", () => {
    const resolved = surfaceFragmentFor(1, 0);
    // Only the trap's denominator moved: the orbit still runs uMaxDepth
    // passes of the whole chain, and "did it escape" still compares against
    // that same step count.
    expect(resolved).toContain("int steps = uMaxDepth * n;");
    expect(resolved).toContain("if (escapedAt < steps && growth > 1.0) {");
  });

  it("normalizes the same way the bulb arm always has — one convention across both forward-orbit variants", () => {
    const escape = surfaceFragmentFor(1, 0);
    const bulb = surfaceFragmentFor(0, 0, 0, 0, 1);
    const line =
      "trap = clamp((float(escapedAt) - escFrac) / float(uMaxDepth), 0.0, 1.0);";
    expect(escape).toContain(line);
    expect(bulb).toContain(line);
  });
});

describe("SURFACE_BULB variant (fr-7u8t.9)", () => {
  /** The classic Mandelbulb shape `analyzeBulbSystem` admits, with a
   * NON-UNIT uniform scale so `sigmaMax` is a value distinguishable from
   * 1 — dropping either of the estimator's two `sigma_max(M)` terms is a
   * bit-exact no-op on an identity or rotation map. */
  function scaledBulb(): Transform {
    return {
      id: 0,
      position: [0.05, -0.1, 0.02],
      rotation: [0, 0, 0],
      scale: [1.3, 1.3, 1.3],
      variations: [{ type: "bulb", weight: 1 }],
    };
  }

  it("strips every bulb token from every other variant while the flag is off — the byte-identity mechanism", () => {
    for (const [escape, lens, balloon] of [
      [0, 0, 0],
      [0, 1, 0],
      [1, 0, 0],
      [0, 0, 1],
      [1, 0, 1],
    ] as const) {
      const resolved = surfaceFragmentFor(escape, lens, balloon, 0, 0);
      expect(resolved).not.toContain("uBulb");
      expect(resolved).not.toContain("bulbPow8");
      // The arm is resolved away entirely — only the shipped shader's own
      // "closes SURFACE_BULB's #else arm" commentary names it.
      expect(resolved).not.toContain("#if SURFACE_BULB");
      // The bulb arg omitted must resolve to the same explicit-0 source.
      expect(surfaceFragmentFor(escape, lens, balloon, 0)).toBe(resolved);
    }
  });

  it("replaces the descent bodies wholesale with the forward power orbit, leaving no unresolved variant conditional and a source far under the Mesa cliff", () => {
    const resolved = surfaceFragmentFor(0, 0, 0, 0, 1);
    expect(resolved).toContain("vec3 bulbPow8(vec3 y, float r2)");
    expect(resolved).toContain("uniform vec4 uBulbParams;");
    // Three overloads (cutoff form, no-arg form, hit form) and none of
    // the inverse-descent machinery.
    expect(countOccurrences(resolved, "float surfaceDE(")).toBe(3);
    expect(resolved).not.toContain("fcQ");
    expect(resolved).not.toContain("surfaceDECore");
    // The escape variant's own forward loop is gone too — the uEsc*
    // uniforms are declared unconditionally, its BODY is not.
    expect(resolved).not.toContain("uEscParams.z * localL * dr");
    expect(resolved).not.toContain("#if SURFACE_BULB");
    expect(resolved).not.toContain("#if SURFACE_ESCAPE");
    expect(resolved).not.toContain("#if SURFACE_FOLD_LENS");
    // The affine/folds split stays a driver-side conditional.
    expect(resolved).toContain("#if SURFACE_FOLDS");
    expect(resolved.length).toBeLessThan(40 * 1024);
  });

  it("carries the three terms an identity-map fixture cannot see: the sigma seed, the sigma floor, and the ln|y| clamp", () => {
    const resolved = surfaceFragmentFor(0, 0, 0, 0, 1);
    // dr seeds at sigma_max(M), not 1 — dy0/dp IS M.
    expect(resolved).toContain("float dr = sigma;");
    // ...and the recurrence's trailing + sigma is escape-de.ts's + 1
    // carried through M, which also floors dr.
    expect(resolved).toContain(
      "dr = 8.0 * (r2 * r2 * r2 * r) * sigma * dr + sigma;",
    );
    // A converging orbit reaches |y| < 1, where ln|y| is negative and a
    // negative estimate marches the tracer backwards.
    expect(
      countOccurrences(resolved, "r <= 1.0 ? 0.0 : 0.5 * r * log(r) / dr"),
    ).toBe(2);
  });

  it("interpolates the escape count the POWER map's way, never the fold arm's constant-factor way", () => {
    const resolved = surfaceFragmentFor(0, 0, 0, 0, 1);
    // r -> r^n each step, so the smooth iteration count's fraction is
    // log(log r / log R)/log n — the fold arm's log(r/R)/log(growth)
    // models a constant expansion factor and is wrong here.
    expect(resolved).toContain(
      "escFrac = clamp(log(log(r) / log(bail)) / log(8.0), 0.0, 1.0);",
    );
    expect(resolved).not.toContain("log(r / uBoundingRadius)");
    expect(resolved).toContain(
      "trap = clamp((float(escapedAt) - escFrac) / float(uMaxDepth), 0.0, 1.0);",
    );
  });

  it("refuses to compile alongside the escape variant — each replaces the descent bodies wholesale", () => {
    expect(() => surfaceFragmentFor(1, 0, 0, 0, 1)).toThrow(RangeError);
  });

  it("composes with the ground plane, the classic floor an escape-family object sits on", () => {
    const resolved = surfaceFragmentFor(0, 0, 0, 1, 1);
    expect(resolved).toContain("shadeGroundPlane");
    expect(resolved).toContain("uBulbParams");
    expect(resolved.length).toBeLessThan(40 * 1024);
  });

  it("setBulbSystem packs the DE onto the bulb uniforms and flips the variant, with the ORBIT bailout kept off the marching radius", () => {
    const material = createSurfaceMaterial();
    const de = buildBulbDE([scaledBulb()]);
    setBulbSystem(material, de, [0.2, 0.4, 0.6]);

    expect(material.defines.SURFACE_BULB).toBe(1);
    expect(material.defines.SURFACE_ESCAPE).toBe(0);
    expect(material.defines.SURFACE_FOLDS).toBe(0);
    expect(material.fragmentShader).toContain("bulbPow8");

    const u = material.uniforms;
    const params = u.uBulbParams.value as THREE.Vector4;
    expect(params.x).toBeCloseTo(de.sigmaMax, 12);
    expect(params.y).toBeCloseTo(de.bailout, 12);
    // A uniformly scaled map has sigmaMax = the scale, so the fixture
    // actually exercises the terms the identity map hides.
    expect(de.sigmaMax).toBeCloseTo(1.3, 12);
    // The marching ball is the QUERY-space radius, NOT the orbit's
    // bailout — the one place this wire differs from the escape mode's,
    // where the two were the same number.
    expect(u.uBoundingRadius.value).toBeCloseTo(de.boundingRadius, 12);
    expect(u.uVisibleRadius.value).toBeCloseTo(de.boundingRadius, 12);
    expect(de.bailout).toBeGreaterThan(de.boundingRadius * 2);
    expect(u.uMaxDepth.value).toBe(BULB_ITERATIONS);
    expect(u.uStepScale.value).toBe(BULB_STEP_SCALE);
    expect(u.uMapCount.value).toBe(1);
    expect(u.uSymOrder.value).toBe(1);
  });

  it("hands the descent bodies back when a later system installs over it", () => {
    const material = createSurfaceMaterial();
    setBulbSystem(material, buildBulbDE([scaledBulb()]), [0, 0, 0]);
    expect(material.defines.SURFACE_BULB).toBe(1);

    setSurfaceSystem(material, de3([map3()]), [black]);
    expect(material.defines.SURFACE_BULB).toBe(0);
    expect(material.fragmentShader).not.toContain("bulbPow8");
  });
});
