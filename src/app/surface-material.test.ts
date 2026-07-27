import type * as THREE from "three";
import {
  createSurfaceMaterial,
  setSurfaceSystem,
  SURFACE_MAX_MAPS,
} from "./surface-material";
import { buildSurfaceDE } from "../fractal/surface-de";
import type { SurfaceDE, SurfaceDEMap } from "../fractal/surface-de";
import { sierpinskiTetrahedron } from "../fractal/presets";
import type { Vec3 } from "../fractal/types";

/**
 * The tracer itself is verified by running the app, but its kaleidoscope
 * PACKER is pinned here (fr-x029). The descent sweeps symmetry sectors
 * instead of expanding them into map slots, so the whole kaleidoscope
 * crosses into GLSL as three scalars — an order, an AXIS CODE, and one
 * (cos, sin) step. An axis mapped to the wrong int, or a step of the wrong
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
    ...overrides,
  };
}

/** The smallest DE the packer accepts, wrapped around the given slots. */
function de3(
  maps: SurfaceDEMap[],
  symmetry: SurfaceDE["symmetry"] = {
    order: 1,
    axis: "y",
    stepCos: 1,
    stepSin: 0,
  },
): SurfaceDE {
  return {
    maps,
    symmetry,
    boundingRadius: 1,
    visibleBoundingRadius: 1,
    escapeRadius: 2,
    maxDepth: 8,
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

  it("codes the x axis as 0, y as 1 and z as 2", () => {
    const material = createSurfaceMaterial();
    for (const [axis, code] of [
      ["x", 0],
      ["y", 1],
      ["z", 2],
    ] as const) {
      setSurfaceSystem(
        material,
        de3([map3()], { order: 5, axis, stepCos: 1, stepSin: 0 }),
        [black],
      );
      expect(material.uniforms.uSymAxis.value).toBe(code);
    }
  });

  it("hands the shader the sector count and its one step, not an expansion", () => {
    const material = createSurfaceMaterial();
    const de = buildSurfaceDE(sierpinskiTetrahedron(), null, {
      order: 6,
      axis: "z",
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
      axis: "y",
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
