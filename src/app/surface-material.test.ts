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
