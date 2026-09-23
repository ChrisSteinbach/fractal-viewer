import { resolveSphereInversion } from "./sphere-inversion";
import { DIELECTRIC_MAX_STACK } from "./surface-dielectric";
import {
  FINITE_TRANSPORT_BUFFER_HEADER_BYTES,
  FINITE_TRANSPORT_WORK_HEADER_BYTES,
  TRANSPORT_PATH_BYTES,
  transportWorkSlotBytes,
} from "./finite-transport-work";
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
  SURFACE_GPU_TRANSPORT_MEMBERSHIP_BISECT_STEPS,
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

  it("fills the frozen block: origin ball of the tables' radius, step 1, order 1, D + 3 slots and D, identity final", () => {
    const v = new DataView(packSphereInversionGpuParams(gpu, { itemCount: 7 }));
    const R = Math.fround(gpu.boundingRadius);
    expect([0, 4, 8].map((o) => v.getFloat32(o, true))).toEqual([0, 0, 0]);
    expect(v.getFloat32(12, true)).toBe(R);
    expect(v.getFloat32(20, true)).toBe(1);
    expect(v.getFloat32(24, true)).toBe(R);
    expect(v.getUint32(40, true)).toBe(1);
    expect(v.getUint32(48, true)).toBe(8);
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

  it("packs the generation slot count, not the generator count, where the shade entry clamps firstChoice", () => {
    // oct6 at depth 8: 6 generators but D + 3 = 11 generation colours. The
    // generator count at 48 clamped every generation past 4 to slot 5's hue.
    const oct6 = tables3({
      arrangement: "oct6",
      seed: { kind: "ball", size: 0.28 },
      depth: 8,
    });
    const v = new DataView(
      packSphereInversionGpuParams(oct6, { itemCount: 1 }),
    );
    expect(v.getUint32(48, true)).toBe(11);
    expect(v.getUint32(208, true)).toBe(6);
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

  it("packs the generation slot count, not the generator count, where the shade entry clamps firstChoice", () => {
    // cross8 at depth 8 (oct6 has no 4D form): 8 generators but D + 3 = 11
    // generation colours.
    const cross8 = tables4({
      arrangement: "cross8",
      seed: { kind: "ball", size: 0.28 },
      depth: 8,
    });
    const v = new DataView(
      packSphereInversion4GpuParams(cross8, view4, { itemCount: 1 }),
    );
    expect(v.getUint32(48, true)).toBe(11);
    expect(v.getUint32(464, true)).toBe(8);
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
      { optics: true, opticsBackend: "closedSolid" },
      { optics: true, opticsBackend: "finiteSolid" },
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

describe("the sphere-inversion glass backend (opticsBackend sphereInversion)", () => {
  const glass = (
    core: "sphereInv" | "sphereInv4",
    mode: "eval" | "march" | "shade" = "shade",
    extra: Partial<SurfaceGpuKernelOptions> = {},
  ): SurfaceGpuKernelOptions => ({
    core,
    mode,
    width: 4,
    workgroupSize: 16,
    sharedFrontier: false,
    bnbStage2: false,
    optics: true,
    opticsBackend: "sphereInversion",
    ...extra,
  });

  it("compiles in both cores, emitting the signed body and the family's field and membership predicate", () => {
    for (const [core, dim] of [
      ["sphereInv", 3],
      ["sphereInv4", 4],
    ] as const) {
      const src = surfaceDeKernelWgsl(glass(core));
      expect(src).toContain(sphereInversionWgslSource(dim, true));
      const lift = dim === 4 ? "liftSphereInv4(p)" : "p";
      expect(src).toContain(
        `fn transportSolidField(p: vec3f) -> f32 {\n  let res = siEstimate(${lift});\n  return select(res.d, -res.clear, res.clear >= 0.0);\n}`,
      );
      expect(src).toContain(
        `fn transportSolidContains(p: vec3f) -> bool {\n  return siEstimate(${lift}).clear >= 0.0;\n}`,
      );
      // The primary march and the hit-info still read the unsigned value.
      expect(src).toContain(
        `return siEstimate(${dim === 4 ? "liftSphereInv4(pIn)" : "pIn"}).d;`,
      );
    }
  });

  it("rides the closed-solid query, with the medium carried and cross-checked against exact membership", () => {
    const src = surfaceDeKernelWgsl(glass("sphereInv"));
    expect(src).toContain("path.anchorPoint, path.inside, eps, li);");
    expect(src).toContain(
      "fn transportSolidNormal(p: vec3f, dir: vec3f, eps: f32) -> vec3f {",
    );
    expect(src).toContain("transportSolidContains(p) != (inside == 1u)");
    expect(src).not.toContain("condensationTerm");
  });

  it("gates every crossing on a membership flip: the boundary landing re-anchors a phantom and keeps marching", () => {
    const src = surfaceDeKernelWgsl(glass("sphereInv"));
    expect(src).toContain(
      "if (transportSolidContains(hitP + dir * (2.0 * eps)) == (inside == 1u)) {",
    );
    expect(src).toContain(
      "anchorOn = 1u;\n          anchorAt = hitP;\n          continue;",
    );
    expect(src).toContain(
      "if (anchorOn == 1u &&\n            distance(hitP, anchorAt) <= TRANSPORT_ANCHOR_ENVELOPE_REL * eps) {",
    );
  });

  it("gates the straight shadow march's band fire, its band advance and its stride-crossed branch the same way", () => {
    const src = surfaceDeKernelWgsl(
      glass("sphereInv", "shade", { groundPlane: true }),
    );
    expect(src).toContain("fn transportShadowVisibility(");
    expect(src).toContain(
      "transportSolidContains(sp + dir * (2.0 * eps)) != inside) {",
    );
    expect(src).toContain(
      "if (transportSolidContains(origin + dir * ts) == inside) {\n          break;\n        }",
    );
    expect(src).toContain(
      "if ((f < 0.0) != inside && transportSolidContains(sp) != inside) {",
    );
    expect(src).toContain("var shadowV = transportShadowVisibility(");
  });

  it("reports a crossing the march stepped over, bisecting exact membership between the last two samples", () => {
    for (const core of ["sphereInv", "sphereInv4"] as const) {
      const src = surfaceDeKernelWgsl(glass(core));
      expect(src).toContain("var tPrev = t;");
      expect(src).toContain(
        "if (select((f < 0.0), (f > 0.0), inside == 1u) &&",
      );
      expect(src).toContain(
        `for (var k = 0u; k < ${SURFACE_GPU_TRANSPORT_MEMBERSHIP_BISECT_STEPS}u; k++) {`,
      );
      expect(src).toContain(
        "result.normal = transportSolidNormal(origin + dir * lo, dir, eps);",
      );
    }
  });

  it("splits the primary hit on the SIGNED field's normal, as the twin does", () => {
    // This core's surfaceDE is the unsigned estimator; its interior values
    // are folded member signals, so taps across the surface draw garbage.
    for (const core of ["sphereInv", "sphereInv4"] as const) {
      const src = surfaceDeKernelWgsl(glass(core));
      expect(src).toContain("let n0 = transportSolidNormal(origin, dir, eps);");
      expect(src).not.toContain(
        "let n0 = transportOpticalNormal(origin, dir, eps, li);",
      );
    }
  });

  it("is structurally inert outside shade mode, so the pair's march kernel is the opaque one", () => {
    for (const core of ["sphereInv", "sphereInv4"] as const) {
      for (const mode of ["eval", "march"] as const) {
        const plain = surfaceDeKernelWgsl(
          glass(core, mode, { optics: false, opticsBackend: undefined }),
        );
        expect(surfaceDeKernelWgsl(glass(core, mode))).toBe(plain);
      }
    }
  });

  it("leaves the closed-solid emission without the membership gate", () => {
    const closed = surfaceDeKernelWgsl({
      core: "affine",
      mode: "shade",
      width: 4,
      workgroupSize: 16,
      sharedFrontier: false,
      bnbStage2: false,
      optics: true,
      opticsBackend: "closedSolid",
      groundPlane: true,
      condensation: {
        mapCount: 0,
        emitters: [
          {
            shape: {
              parts: [
                {
                  primitive: { kind: "sphere", radius: 0.5 },
                  combine: "union",
                },
              ],
            },
            shadeIndex: 0,
          },
        ],
      },
    });
    expect(closed).not.toContain("transportSolidContains");
    expect(closed).not.toContain("anchorOn");
    expect(closed).not.toContain("tPrev");
  });

  it("is refused on every other core: the displayed set IS the optical solid", () => {
    for (const core of [
      "fold",
      "affine",
      "escape",
      "bulb",
      "affine4",
      "fold4",
      "escape4",
    ] as const) {
      expect(() =>
        surfaceDeKernelWgsl({ ...glass("sphereInv"), core }),
      ).toThrow(/needs the sphere-inversion cores/);
    }
  });

  it("composes with the ground plane and finishes, as the opaque family does", () => {
    for (const core of ["sphereInv", "sphereInv4"] as const) {
      expect(() =>
        surfaceDeKernelWgsl(
          glass(core, "shade", { groundPlane: true, finish: true }),
        ),
      ).not.toThrow();
    }
  });
});

describe("the sphere-inversion glass continuation (sphereInversionTransportChunkPaths)", () => {
  const glass = (
    core: "sphereInv" | "sphereInv4",
    extra: Partial<SurfaceGpuKernelOptions> = {},
  ): SurfaceGpuKernelOptions => ({
    core,
    mode: "shade",
    width: 4,
    workgroupSize: 16,
    sharedFrontier: false,
    bnbStage2: false,
    optics: true,
    opticsBackend: "sphereInversion",
    ...extra,
  });

  it("is absent by default: a zero quantum emits the uninterrupted kernel byte for byte", () => {
    for (const core of ["sphereInv", "sphereInv4"] as const) {
      const plain = surfaceDeKernelWgsl(glass(core));
      expect(
        surfaceDeKernelWgsl(
          glass(core, { sphereInversionTransportChunkPaths: 0 }),
        ),
      ).toBe(plain);
      expect(plain).not.toContain("TRANSPORT_CHUNK_PATHS");
      expect(plain).not.toContain("@binding(16)");
    }
  });

  it("emits the same-trace continuation at binding 16 under its own names, never a finite one", () => {
    for (const core of ["sphereInv", "sphereInv4"] as const) {
      const src = surfaceDeKernelWgsl(
        glass(core, { sphereInversionTransportChunkPaths: 32 }),
      );
      expect(src).toContain(
        "@group(0) @binding(16) var<storage, read_write> siWork: SiTransportBatch;",
      );
      expect(src).toContain("const TRANSPORT_CHUNK_PATHS = 32u;");
      expect(src).toContain("atomicAdd(&siWork.running, 1u);");
      expect(src).toContain("var<storage, read> siTable: array<vec4f>;");
      expect(src).not.toMatch(/finiteWork|FiniteTransport/);
      // Pause BEFORE popping, exactly the finite text's order.
      expect(src.indexOf("processed - chunkStartProcessed >=")).toBeLessThan(
        src.indexOf("var path = stack[sp - 1u];"),
      );
    }
  });

  it("packs the slot header at the shared offsets and the generic path at the host's stride", () => {
    const types = new Map([
      ["u32", { align: 4, size: 4 }],
      ["atomic<u32>", { align: 4, size: 4 }],
      ["f32", { align: 4, size: 4 }],
      ["vec3f", { align: 16, size: 12 }],
      ["vec2u", { align: 8, size: 8 }],
      [
        `array<TransportPath, ${DIELECTRIC_MAX_STACK}>`,
        { align: 16, size: DIELECTRIC_MAX_STACK * TRANSPORT_PATH_BYTES },
      ],
      ["array<SiTransportWork>", { align: 16, size: 0 }],
    ]);
    const src = surfaceDeKernelWgsl(
      glass("sphereInv4", { sphereInversionTransportChunkPaths: 32 }),
    );
    const layout = (name: string) => {
      const body = new RegExp(`struct ${name} \\{([^}]+)\\}`).exec(src)?.[1];
      expect(body).toBeDefined();
      let offset = 0;
      let alignment = 1;
      const offsets: Record<string, number> = {};
      for (const [, field, type] of (body ?? "")
        .replace(/\/\/[^\n]*/g, "")
        .matchAll(/^\s*(\w+): ([^\n]+),$/gm)) {
        const value = types.get(type);
        if (!value) throw new Error(`Unexpected storage field: ${type}`);
        alignment = Math.max(alignment, value.align);
        offset = Math.ceil(offset / value.align) * value.align;
        offsets[field] = offset;
        offset += value.size;
      }
      return { offsets, size: Math.ceil(offset / alignment) * alignment };
    };
    expect(layout("TransportPath").size).toBe(TRANSPORT_PATH_BYTES);
    expect(layout("SiTransportBatch").offsets.slots).toBe(
      FINITE_TRANSPORT_BUFFER_HEADER_BYTES,
    );
    const work = layout("SiTransportWork");
    expect(work.offsets.stack).toBe(FINITE_TRANSPORT_WORK_HEADER_BYTES);
    expect(work.size).toBe(transportWorkSlotBytes(TRANSPORT_PATH_BYTES));
  });
});
