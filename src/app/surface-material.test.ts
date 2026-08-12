import type * as THREE from "three";
import {
  buildSurfaceFragment,
  createSurfaceMaterial,
  setSurfaceBalloon,
  setSurfaceSystem,
  surfaceFragmentFor,
  SURFACE_MAX_MAPS,
  SURFACE_SHADE_DE_WIDTH,
} from "./surface-material";
import type { SurfaceBalloonSpec } from "./surface-material";
import {
  BALLOON_FAR_CAP_RHO,
  BALLOON_RHO_MARGIN,
  balloonBall,
  buildBalloon,
} from "../fractal/balloon-de";
import { buildSurfaceDE, SURFACE_FOLD_BEAM_WIDTH } from "../fractal/surface-de";
import type { SurfaceDE, SurfaceDEMap } from "../fractal/surface-de";
import { defaultTransforms, sierpinskiTetrahedron } from "../fractal/presets";
import type { Vec3 } from "../fractal/types";

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
    expect(surfaceFragmentFor(0, 0, 0, 0, source)).not.toContain(
      "surfaceDEProbe",
    );
    expect(surfaceFragmentFor(0, 1, 0, 0, source)).not.toContain(
      "surfaceDEProbe",
    );
    expect(surfaceFragmentFor(1, 0, 0, 0, source)).not.toContain(
      "surfaceDEProbe",
    );
  });

  it("compiles exactly one width-1 probe, routed as the shading taps' value form", () => {
    const resolved = surfaceFragmentFor(0, 0, 0, 0, buildSurfaceFragment(1));
    expect(
      countOccurrences(resolved, "float surfaceDEProbe(vec3 p, float cutoff)"),
    ).toBe(1);
    expect(resolved).toContain("return surfaceDEProbe(p, 0.0);");
  });

  it("strips the probe body's comments and indentation, unlike the public descent body", () => {
    const resolved = surfaceFragmentFor(0, 0, 0, 0, buildSurfaceFragment(1));
    expect(resolved).toContain("\nvec3 fcQ[1];");
    expect(resolved).toContain("vec3 fcQ[FOLD_W];");
  });

  it("never changes the escape variant's source across probe widths", () => {
    const atWidth1 = surfaceFragmentFor(1, 0, 0, 0, buildSurfaceFragment(1));
    const atBeamWidth = surfaceFragmentFor(
      1,
      0,
      0,
      0,
      buildSurfaceFragment(SURFACE_FOLD_BEAM_WIDTH),
    );
    expect(atWidth1).toBe(atBeamWidth);
  });

  it("carries no probe under the fold lens, which keeps its surfaceDECore rename", () => {
    const resolved = surfaceFragmentFor(0, 1, 0, 0, buildSurfaceFragment(1));
    expect(resolved).not.toContain("surfaceDEProbe");
    expect(resolved).toContain("surfaceDECore");
  });

  it("adds the probe as a new name rather than another surfaceDE overload", () => {
    const needle = "float surfaceDE(vec3 p, float cutoff) {";
    const atWidth1 = surfaceFragmentFor(0, 0, 0, 0, buildSurfaceFragment(1));
    const atBeamWidth = surfaceFragmentFor(
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
