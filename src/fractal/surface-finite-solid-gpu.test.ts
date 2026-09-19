/**
 * The finite-solid cores' generated WGSL pins: the display DE and the DDA
 * transport emission, the refusals, and the packer wire. The oracle
 * arithmetic itself is pinned by `finite-solid.test.ts` (f64) and the
 * bench's transport agreement legs (f32 against that oracle).
 */
import {
  FINITE_SOLID_HALF_EXTENT,
  FINITE_SOLID_MAX_LEVEL,
} from "./finite-solid";
import {
  SURFACE_GPU_PARAMS4_FINITE_BYTES,
  SURFACE_GPU_PARAMS_FINITE_BYTES,
  finiteSolidDisplaySource,
  finiteSolidTransportSource,
} from "./surface-finite-solid-gpu";
import {
  SURFACE_GPU_PARAMS4_PLANE_BYTES,
  SURFACE_GPU_PARAMS_PLANE_BYTES,
} from "./surface-de-gpu";
import {
  packSurfaceGpuParamsFinite,
  packSurfaceGpuParamsFinite4,
  surfaceDeKernelWgsl,
  type SurfaceGpuKernelOptions,
} from "./surface-de-gpu";

const baseOpts = (
  core: "finite" | "finite4",
  overrides: Partial<SurfaceGpuKernelOptions> = {},
): SurfaceGpuKernelOptions => ({
  mode: "shade",
  width: 4,
  workgroupSize: 16,
  sharedFrontier: false,
  bnbStage2: false,
  core,
  finiteSolid: { level: 2 },
  ...overrides,
});

describe("finite-solid GPU sources", () => {
  it("emits the certified hybrid display DE for both dimensions", () => {
    for (const dim of [3, 4] as const) {
      const src = finiteSolidDisplaySource(dim);
      expect(src).toContain("fn surfaceDE(pIn: vec3f, cutoff: f32, li: u32)");
      expect(src).toContain("fn finiteDisplayDE(q: array<f32, 4>)");
      expect(src).toContain("params.finiteLevel == 0u");
      expect(src).toContain("params.finiteLevel > 1u && d1 < tau");
      expect(src).toContain("d1 < tau");
      // The refine trigger and the safety scaling are the oracle's own
      // constants, emitted as literals.
      expect(src).toMatch(/tau = half \* 0\.16666/);
      expect(src).toMatch(/result \* 0\.9/);
    }
    const src3 = finiteSolidDisplaySource(3);
    expect(src3).toContain("array<f32, 4>(p.x, p.y, p.z, 0.0)");
    const src4 = finiteSolidDisplaySource(4);
    expect(src4).toContain("params.rotorInvR0");
    expect(src4).toContain("params.w0");
  });

  it("emits the exact DDA with the full anchor contract for both dimensions", () => {
    for (const dim of [3, 4] as const) {
      const src = finiteSolidTransportSource(dim);
      expect(src).toContain("fn transportFiniteBoundary(");
      expect(src).toContain("fn finiteOccupied(idx: array<i32, 4>)");
      expect(src).toContain("fn finiteGridPlane(i: i32)");
      expect(src).toContain("fn finiteBoundaryNormal(");
      expect(src).toContain("fn finiteEvent(");
      expect(src).toContain("fn finiteRaySideIndex(");
      // The anchor contract: mask, planes, cells, intrinsic point.
      expect(src).toContain("anchorIntrinsic: vec4f");
      expect(src).toContain("anchorMask: u32");
      expect(src).toContain("anchorPlanes: vec4i");
      expect(src).toContain("anchorCells: vec4i");
      // No distance epsilon: the only tie test is exact equality.
      expect(src).toContain("crossingT[a] == nextT");
    }
    const src4 = finiteSolidTransportSource(4);
    expect(src4).toContain("params.rotorInvR0.xyz");
  });
});

describe("the finite cores' kernel emission", () => {
  it("emits a shade kernel carrying the DE, the hit-info and the DDA under the finiteSolid backend", () => {
    const src = surfaceDeKernelWgsl(
      baseOpts("finite", { optics: true, opticsBackend: "finiteSolid" }),
    );
    expect(src).toContain("fn surfaceDE(pIn: vec3f, cutoff: f32, li: u32)");
    expect(src).toContain("fn surfaceDEHitInfo(p: vec3f, li: u32)");
    expect(src).toContain("fn transportFiniteBoundary(");
    expect(src).toContain("finiteIntrinsic: vec4f");
    expect(src).toContain("transportFiniteBoundary(\n        path.origin,");
    // The children inherit the anchor out.
    expect(src).toContain("child.finiteIntrinsic = hit.anchorIntrinsic;");
    expect(src).toContain("trans.finiteIntrinsic = hit.anchorIntrinsic;");
    expect(src).toContain("refl.finiteIntrinsic = hit.anchorIntrinsic;");
    // The primary split's reflection child starts unanchored; the
    // refracted child seeds from the PRE-QUERY's located entry event (the
    // unanchored inside start refused state-mismatch on every eps-off
    // display hit — the measured app defect).
    expect(src).toContain("refl0.finiteMask = 0u;");
    expect(src).toContain("refr0.finiteIntrinsic = refrIntrinsic;");
    expect(src).toContain("refr0.anchorPresent = refrAnchorPresent;");
    expect(src).toContain("refrOrigin = preOrigin + dir * preHit.t;");
    // The pre-query is the unanchored OUTSIDE call from just before the
    // display hit.
    expect(src).toContain("preOrigin = origin - dir * (4.0 * eps);");
    // Bindingless: no maps declaration.
    expect(src).not.toContain("var<storage, read> maps");
    // The finite params tail.
    expect(src).toContain("finiteHalf: f32");
    expect(src).toContain("finiteLevel: u32");
    expect(src).toContain("finiteGrid: u32");
  });

  it("emits the 4D core with the shared tail and the posed DDA", () => {
    const src = surfaceDeKernelWgsl(
      baseOpts("finite4", { optics: true, opticsBackend: "finiteSolid" }),
    );
    expect(src).toContain("finiteHalf: f32");
    expect(src).toContain("w0: f32");
    expect(src).toContain("sliceHalfW: f32");
    expect(src).toContain("fn transportFiniteBoundary(");
    expect(src).toContain("params.rotorInvR0.xyz");
  });

  it("keeps the DDA out of a classic finite session (no optics)", () => {
    const src = surfaceDeKernelWgsl(baseOpts("finite", { mode: "march" }));
    expect(src).not.toContain("transportFiniteBoundary");
    expect(src).not.toContain("TransportPath");
    expect(src).toContain("fn surfaceDE(pIn: vec3f, cutoff: f32, li: u32)");
  });

  it("emits eval and march modes", () => {
    expect(() =>
      surfaceDeKernelWgsl(baseOpts("finite", { mode: "eval" })),
    ).not.toThrow();
    expect(() =>
      surfaceDeKernelWgsl(baseOpts("finite", { mode: "march" })),
    ).not.toThrow();
    expect(() =>
      surfaceDeKernelWgsl(baseOpts("finite4", { mode: "march" })),
    ).not.toThrow();
  });

  it("refuses every composition the admission does not certify", () => {
    const refusals: Array<[Partial<SurfaceGpuKernelOptions>, string]> = [
      [{ lens: true }, "lens"],
      [{ balloon: true }, "balloon"],
      [{ pattern: true }, "pattern"],
      [{ slabCover: true }, "slab cover"],
      [{ schedule: { mapCount: 0, scheduleMapCount: 2 } }, "schedule"],
      [{ chaos: { activeStateCount: 2, predecessorMasks: [0] } }, "xaos"],
    ];
    for (const [overrides, what] of refusals) {
      expect(() => surfaceDeKernelWgsl(baseOpts("finite", overrides))).toThrow(
        what,
      );
    }
    expect(() =>
      surfaceDeKernelWgsl(
        baseOpts("finite4", { tiling: { kind: "lattice" } as never }),
      ),
    ).toThrow(/tiling/);
    expect(() =>
      surfaceDeKernelWgsl(baseOpts("finite4", { finiteSolid: { level: 3 } })),
    ).toThrow(/level 0..2/);
    expect(() =>
      surfaceDeKernelWgsl(baseOpts("finite", { finiteSolid: null })),
    ).toThrow(/needs an authored level/);
  });

  it("refuses the finiteSolid backend on every other core", () => {
    expect(() =>
      surfaceDeKernelWgsl({
        mode: "shade",
        width: 4,
        workgroupSize: 16,
        sharedFrontier: false,
        bnbStage2: false,
        core: "affine4",
        optics: true,
        opticsBackend: "finiteSolid",
        finiteSolid: { level: 2 },
      }),
    ).toThrow(/needs the finite cores/);
    expect(() =>
      surfaceDeKernelWgsl({
        mode: "shade",
        width: 4,
        workgroupSize: 16,
        sharedFrontier: false,
        bnbStage2: false,
        core: "escape",
        optics: true,
        opticsBackend: "finiteSolid",
        finiteSolid: { level: 2 },
      }),
    ).toThrow(/needs the finite cores/);
  });
});

describe("the finite packers", () => {
  it("packs the 3D tail at 208 with the authored construction", () => {
    const buf = packSurfaceGpuParamsFinite(
      { itemCount: 7 },
      2,
      FINITE_SOLID_HALF_EXTENT * Math.sqrt(3),
    );
    expect(buf.byteLength).toBe(SURFACE_GPU_PARAMS_FINITE_BYTES);
    const view = new DataView(buf);
    expect(view.getFloat32(208, true)).toBe(FINITE_SOLID_HALF_EXTENT);
    expect(view.getUint32(212, true)).toBe(2);
    expect(view.getUint32(216, true)).toBe(9);
    // The frozen base: origin bound, order 1, ONE shade slot (the bulb
    // packer's bindingless mapCount precedent — the shared shade entry's
    // slot clamp reads this, and 0 would degenerate the clamp).
    expect(view.getFloat32(0, true)).toBe(0);
    expect(view.getFloat32(12, true)).toBeCloseTo(
      FINITE_SOLID_HALF_EXTENT * Math.sqrt(3),
      6,
    );
    expect(view.getUint32(40, true)).toBe(1);
    expect(view.getUint32(48, true)).toBe(1);
    expect(view.getUint32(52, true)).toBe(0);
  });

  it("packs the 4D tail with the live pose rows and the construction at 464", () => {
    const rotor = [1, 0, 0, 0, 0, 0.6, 0, -0.8, 0, 0, 1, 0, 0, 0.8, 0, 0.6];
    const buf = packSurfaceGpuParamsFinite4(
      { rotor, w0: 0.25, sliceHalfW: 0 },
      { itemCount: 3 },
      1,
      1.5,
    );
    expect(buf.byteLength).toBe(SURFACE_GPU_PARAMS4_FINITE_BYTES);
    const view = new DataView(buf);
    expect(view.getFloat32(464, true)).toBe(FINITE_SOLID_HALF_EXTENT);
    expect(view.getUint32(468, true)).toBe(1);
    expect(view.getUint32(472, true)).toBe(3);
    expect(view.getFloat32(416, true)).toBe(0.25);
    // The pose rows pack TRANSPOSED (every 4D packer's one real transpose):
    // row 0 of the packed rotor-inverse is column 0 of the row-major rotor.
    expect(view.getFloat32(208, true)).toBe(1);
    expect(view.getFloat32(212, true)).toBe(0);
    expect(view.getFloat32(216, true)).toBe(0);
    expect(view.getFloat32(220, true)).toBe(0);
    expect(view.getFloat32(224, true)).toBe(0);
    expect(view.getFloat32(228, true)).toBeCloseTo(0.6, 7);
    expect(view.getFloat32(236, true)).toBeCloseTo(0.8, 7);
  });

  it("refuses a nonzero slab and an out-of-band level", () => {
    expect(() =>
      packSurfaceGpuParamsFinite4(
        {
          rotor: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
          w0: 0,
          sliceHalfW: 0.1,
        },
        { itemCount: 1 },
        2,
        1.5,
      ),
    ).toThrow(/no slab/);
    expect(() =>
      packSurfaceGpuParamsFinite(
        { itemCount: 1 },
        FINITE_SOLID_MAX_LEVEL + 1,
        1,
      ),
    ).toThrow(/certified band/);
    expect(() =>
      packSurfaceGpuParamsFinite({ itemCount: 1, footprint: 0.1 }, 1, 1),
    ).toThrow(/footprint/);
  });

  it("packs the ground plane at the frozen shared offsets only when authored", () => {
    const gp = {
      y: -0.95,
      fadeStart: 0.5,
      fadeEnd: 4,
      ballRadius: 1.3,
      ballCenter: [0, 0, 0] as [number, number, number],
      albedo: [0.5, 0.5, 0.5] as [number, number, number],
    };
    const buf = packSurfaceGpuParamsFinite({ itemCount: 1 }, 2, 1.3, gp);
    expect(buf.byteLength).toBe(SURFACE_GPU_PARAMS_PLANE_BYTES);
    const view = new DataView(buf);
    expect(view.getFloat32(288, true)).toBeCloseTo(-0.95, 7);
    expect(view.getFloat32(292, true)).toBeCloseTo(0.5, 7);
    expect(view.getFloat32(296, true)).toBeCloseTo(4, 7);
    // The finite block itself is untouched past the pad.
    expect(view.getFloat32(208, true)).toBe(FINITE_SOLID_HALF_EXTENT);
    const buf4 = packSurfaceGpuParamsFinite4(
      {
        rotor: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        w0: 0,
        sliceHalfW: 0,
      },
      { itemCount: 1 },
      2,
      1.5,
      gp,
    );
    expect(buf4.byteLength).toBe(SURFACE_GPU_PARAMS4_PLANE_BYTES);
    const view4 = new DataView(buf4);
    expect(view4.getFloat32(576, true)).toBeCloseTo(-0.95, 7);
    expect(view4.getFloat32(580, true)).toBeCloseTo(0.5, 7);
    expect(view4.getFloat32(464, true)).toBe(FINITE_SOLID_HALF_EXTENT);
  });

  it("emits the plane pad and fields only under a floor, keeping the plain kernel byte-identical", () => {
    const plain = surfaceDeKernelWgsl(baseOpts("finite"));
    const floored = surfaceDeKernelWgsl(
      baseOpts("finite", { groundPlane: true }),
    );
    expect(plain).not.toContain("groundY");
    expect(plain).not.toContain("padFinA");
    expect(floored).toContain("padFinA");
    expect(floored).toContain("groundY");
    // The pad bridges exactly the finite block's end (224) to the shared
    // plane block (288): 64 bytes = four vec4 lanes.
    expect(floored.match(/padFin[ABCD]: vec4f/g)).toHaveLength(4);
    expect(floored.indexOf("padFinA")).toBeLessThan(floored.indexOf("groundY"));
    const plain4 = surfaceDeKernelWgsl(baseOpts("finite4"));
    const floored4 = surfaceDeKernelWgsl(
      baseOpts("finite4", { groundPlane: true }),
    );
    expect(plain4).not.toContain("padFin4");
    expect(floored4).toContain("padFin4");
    expect(floored4).toContain("groundY");
    // And the 4D shade path still names the radius-source helpers the
    // finite display source carries (theRotor helpers stay present).
    expect(floored4).toContain("rotorInvApply4");
  });
});
