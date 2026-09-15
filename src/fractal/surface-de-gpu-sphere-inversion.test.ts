import { resolveSphereInversion } from "./sphere-inversion";
import type { SphereInversionAuthored } from "./sphere-inversion";
import { buildSphereInversionDE } from "./sphere-inversion-de";
import { buildSphereInversionDE4 } from "./sphere-inversion-de-4d";
import {
  packSphereInversion4GpuParams,
  packSphereInversionGpuParams,
  SURFACE_GPU_HIT_FLOOR,
  SURFACE_GPU_PARAMS4_PLANE_BYTES,
  SURFACE_GPU_PARAMS4_SPHERE_INV_BYTES,
  SURFACE_GPU_PARAMS_PLANE_BYTES,
  SURFACE_GPU_PARAMS_SPHERE_INV_BYTES,
  surfaceDeKernelWgsl,
} from "./surface-de-gpu";
import type {
  SurfaceGpuGroundPlane,
  SurfaceGpuKernelOptions,
} from "./surface-de-gpu";
import {
  packSphereInversionGpuTables,
  SPHERE_INVERSION_GPU_SLACK,
  sphereInversionWgslSource,
} from "./surface-sphere-inversion-gpu";

function tables3(authored: SphereInversionAuthored) {
  const r = resolveSphereInversion(authored);
  if (!r.ok) throw new Error(r.reasons.join("; "));
  return packSphereInversionGpuTables(buildSphereInversionDE(r.construction));
}

function tables4(authored: SphereInversionAuthored) {
  const r = resolveSphereInversion(authored);
  if (!r.ok) throw new Error(r.reasons.join("; "));
  return packSphereInversionGpuTables(buildSphereInversionDE4(r.construction));
}

const PLANE: SurfaceGpuGroundPlane = {
  y: -1.5,
  fadeStart: 3,
  fadeEnd: 6,
  ballCenter: [0, 0, 0],
  ballRadius: 1.4,
  albedo: [0.5, 0.4, 0.3],
};

const XW_ROTOR = (() => {
  const c = Math.cos(0.3);
  const s = Math.sin(0.3);
  return [c, 0, 0, -s, 0, 1, 0, 0, 0, 0, 1, 0, s, 0, 0, c];
})();

describe("packSphereInversionGpuParams (3D, core sphereInv)", () => {
  const gpu = tables3({
    arrangement: "ico12",
    seed: { kind: "cutShell" },
    depth: 5,
  });

  it("is 288 B plain and 336 B with a ground plane, whose block lands at the frozen 288", () => {
    expect(packSphereInversionGpuParams(gpu, { itemCount: 1 }).byteLength).toBe(
      SURFACE_GPU_PARAMS_SPHERE_INV_BYTES,
    );
    const buf = packSphereInversionGpuParams(gpu, { itemCount: 1 }, PLANE);
    expect(buf.byteLength).toBe(SURFACE_GPU_PARAMS_PLANE_BYTES);
    const v = new DataView(buf);
    expect(v.getFloat32(288, true)).toBe(-1.5);
    expect(v.getFloat32(320, true)).toBe(Math.fround(0.5));
  });

  it("writes the header at 208/224/240 and pads 256..287 with zeros", () => {
    const v = new DataView(packSphereInversionGpuParams(gpu, { itemCount: 7 }));
    expect([0, 4, 8, 12].map((o) => v.getUint32(208 + o, true))).toEqual([
      12, 3, 5, 14,
    ]);
    const r = gpu.uniformRadius;
    expect(v.getFloat32(224, true)).toBe(Math.fround(r));
    expect(v.getFloat32(228, true)).toBe(Math.fround(r * r));
    expect(v.getFloat32(232, true)).toBe(Math.fround(2 ** -40));
    expect(v.getFloat32(236, true)).toBe(
      Math.fround(SPHERE_INVERSION_GPU_SLACK),
    );
    expect(v.getUint32(240, true)).toBe(1);
    for (let o = 244; o < 288; o += 4) expect(v.getUint32(o, true)).toBe(0);
  });

  it("fills the frozen block: origin ball of the tables' radius, step 1, order 1, n and D, identity final", () => {
    const v = new DataView(packSphereInversionGpuParams(gpu, { itemCount: 7 }));
    const R = Math.fround(gpu.boundingRadius);
    expect([0, 4, 8].map((o) => v.getFloat32(o, true))).toEqual([0, 0, 0]);
    expect(v.getFloat32(12, true)).toBe(R);
    expect(v.getFloat32(20, true)).toBe(1);
    expect(v.getFloat32(24, true)).toBe(R);
    expect(v.getUint32(40, true)).toBe(1);
    expect(v.getUint32(48, true)).toBe(12);
    expect(v.getUint32(52, true)).toBe(5);
    expect(v.getUint32(56, true)).toBe(7);
    expect(v.getFloat32(96, true)).toBe(1);
    expect(v.getFloat32(156, true)).toBe(1);
  });

  it("ignores a preview maxDepth: the depth is the construction's", () => {
    const v = new DataView(
      packSphereInversionGpuParams(gpu, { itemCount: 1, maxDepth: 2 }),
    );
    expect(v.getUint32(52, true)).toBe(5);
    expect(v.getUint32(216, true)).toBe(5);
  });

  it("clamps the hit acceptance floor to at least the f32 slack", () => {
    const at = (hitFloor?: number) =>
      new DataView(
        packSphereInversionGpuParams(gpu, { itemCount: 1, hitFloor }),
      ).getFloat32(80, true);
    expect(at()).toBe(Math.fround(gpu.boundingRadius * SURFACE_GPU_HIT_FLOOR));
    expect(at(1e-9)).toBe(Math.fround(SPHERE_INVERSION_GPU_SLACK));
  });

  it("refuses 4D tables", () => {
    const g4 = tables4({ arrangement: "cell24", seed: { kind: "shell" } });
    expect(() => packSphereInversionGpuParams(g4, { itemCount: 1 })).toThrow(
      /3D/,
    );
  });
});

describe("packSphereInversion4GpuParams (4D, core sphereInv4)", () => {
  const gpu = tables4({
    arrangement: "cell600",
    seed: { kind: "cutShell", size: 0.9, thickness: 0.04 },
    depth: 5,
  });
  const view4 = { rotor: XW_ROTOR, w0: 0.1, sliceHalfW: 0 };

  it("is 576 B plain and 624 B with a ground plane at the frozen 576", () => {
    expect(
      packSphereInversion4GpuParams(gpu, view4, { itemCount: 1 }).byteLength,
    ).toBe(SURFACE_GPU_PARAMS4_SPHERE_INV_BYTES);
    const buf = packSphereInversion4GpuParams(
      gpu,
      view4,
      { itemCount: 1 },
      PLANE,
    );
    expect(buf.byteLength).toBe(SURFACE_GPU_PARAMS4_PLANE_BYTES);
    expect(new DataView(buf).getFloat32(576, true)).toBe(-1.5);
  });

  it("writes the header at 464/480/496 and pads 500..575 with zeros", () => {
    const v = new DataView(
      packSphereInversion4GpuParams(gpu, view4, { itemCount: 1 }),
    );
    expect([0, 4, 8, 12].map((o) => v.getUint32(464 + o, true))).toEqual([
      120, 3, 5, 122,
    ]);
    expect(v.getFloat32(492, true)).toBe(
      Math.fround(SPHERE_INVERSION_GPU_SLACK),
    );
    expect(v.getUint32(496, true)).toBe(1);
    for (let o = 500; o < 576; o += 4) expect(v.getUint32(o, true)).toBe(0);
  });

  it("carries the view: rotor rows at 208, w0 at 416, the slice-adjusted visible radius at 24 and the full radius at 428", () => {
    const v = new DataView(
      packSphereInversion4GpuParams(gpu, view4, { itemCount: 1 }),
    );
    const R = gpu.boundingRadius;
    expect(v.getFloat32(208 + 12, true)).toBe(Math.fround(XW_ROTOR[12]));
    expect(v.getFloat32(416, true)).toBe(Math.fround(0.1));
    expect(v.getFloat32(24, true)).toBe(Math.fround(Math.sqrt(R * R - 0.01)));
    expect(v.getFloat32(428, true)).toBe(Math.fround(R));
    expect(v.getFloat32(452, true)).toBe(Math.fround(1 / R));
    // stepBack4 and final4 pack identity.
    expect(v.getFloat32(272, true)).toBe(1);
    expect(v.getFloat32(336 + 60, true)).toBe(1);
  });

  it("refuses a slab", () => {
    expect(() =>
      packSphereInversion4GpuParams(
        gpu,
        { ...view4, sliceHalfW: 0.02 },
        { itemCount: 1 },
      ),
    ).toThrow(/no slab/);
  });
});

describe("surfaceDeKernelWgsl sphere-inversion cores", () => {
  const opts = (
    core: "sphereInv" | "sphereInv4",
    mode: "eval" | "march" | "shade",
    extra: Partial<SurfaceGpuKernelOptions> = {},
  ): SurfaceGpuKernelOptions => ({
    core,
    mode,
    width: 4,
    workgroupSize: 16,
    sharedFrontier: false,
    bnbStage2: false,
    ...extra,
  });

  it("emits the shared estimator body over a vec4f table at binding 1, with no descent maps or frontier", () => {
    for (const [core, dim] of [
      ["sphereInv", 3],
      ["sphereInv4", 4],
    ] as const) {
      for (const mode of ["eval", "march", "shade"] as const) {
        const src = surfaceDeKernelWgsl(opts(core, mode));
        expect(src).toContain(sphereInversionWgslSource(dim));
        expect(src).toContain(
          "@group(0) @binding(1) var<storage, read> siTable: array<vec4f>;",
        );
        expect(src).not.toContain("struct GpuMap");
        expect(src).not.toContain("frontierIx");
        expect(src).toContain(
          "fn surfaceDE(pIn: vec3f, cutoff: f32, li: u32) -> f32",
        );
      }
    }
    expect(surfaceDeKernelWgsl(opts("sphereInv4", "eval"))).toContain(
      "return siEstimate(liftSphereInv4(pIn)).d;",
    );
  });

  it("declares the header at the variant block and keeps the plane block's frozen offset through the pads", () => {
    const plane3 = surfaceDeKernelWgsl(
      opts("sphereInv", "shade", { groundPlane: true }),
    );
    expect(plane3).toMatch(
      /fogDensity: f32,\s*\/\/[^\n]*\n\s*siCounts: vec4u,\s*\/\/[^\n]*\n\s*siRadii: vec4f,\s*\/\/[^\n]*\n\s*siFlags: vec4u,[\s\S]*?siPad: vec4f,\s*padF: vec4f,\s*groundY/,
    );
    const plane4 = surfaceDeKernelWgsl(
      opts("sphereInv4", "shade", { groundPlane: true }),
    );
    expect(plane4).toMatch(
      /pad4b: f32,[\s\S]*?siFlags: vec4u,[\s\S]*?siPad4: array<vec4f, 4>,\s*groundY/,
    );
    // Without a floor nothing needs to land past the header.
    expect(surfaceDeKernelWgsl(opts("sphereInv4", "shade"))).not.toContain(
      "siPad4",
    );
  });

  it("attributes a hit by generation, closest radial approach and seed member", () => {
    const src = surfaceDeKernelWgsl(opts("sphereInv", "shade"));
    expect(src).toContain("info.firstChoice = i32(generation);");
    expect(src).toContain(
      "info.trap = clamp(f32(generation) / f32(params.siCounts.z + 2u), 0.0, 1.0);",
    );
    expect(src).toContain("info.rings = clamp(res.ring, 0.0, 1.0);");
    // The 4D radius colour ramp lifts through this core's own view lift.
    expect(surfaceDeKernelWgsl(opts("sphereInv4", "shade"))).toContain(
      "let q4c = liftSphereInv4(pos);",
    );
  });

  it("treats the frontier, probe-width, slab-extent and maps-address options as inert", () => {
    for (const core of ["sphereInv", "sphereInv4"] as const) {
      const base = surfaceDeKernelWgsl(opts(core, "shade"));
      for (const extra of [
        { width: 12 },
        { shadeDeWidth: 1 },
        { sharedFrontier: true },
        { bnbStage2: true },
        { slabExt: false },
        { mapsUniform: true },
      ]) {
        expect(surfaceDeKernelWgsl(opts(core, "shade", extra))).toBe(base);
      }
    }
  });

  it("refuses every feature outside the first cut's composition, naming the reason", () => {
    const refused: Partial<SurfaceGpuKernelOptions>[] = [
      { lens: true },
      { balloon: true },
      { pattern: true },
      { optics: true },
      { slabCover: true },
      { schedule: { mapCount: 1, scheduleMapCount: 1 } },
      { chaos: { activeStateCount: 2, predecessorMasks: [3, 3] } },
    ];
    for (const core of ["sphereInv", "sphereInv4"] as const) {
      for (const extra of refused) {
        expect(() => surfaceDeKernelWgsl(opts(core, "shade", extra))).toThrow(
          new RegExp(`the ${core} core refuses`),
        );
      }
      for (const extra of [
        { groundPlane: true, finish: true },
        { lighting: true },
      ]) {
        expect(() =>
          surfaceDeKernelWgsl(opts(core, "shade", extra)),
        ).not.toThrow();
      }
    }
  });
});
