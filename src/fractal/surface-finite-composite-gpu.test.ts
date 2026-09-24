import {
  analyzeFiniteSolidGeneral,
  finiteSolidGeneralBoundingRadius,
  type FiniteSolidGeneralConstruction,
} from "./finite-solid";
import { buildFiniteSolidOpaqueContent } from "./finite-solid-composite";
import { defaultTransforms, mengerSponge, pentatope } from "./presets";
import { buildSurfaceDE } from "./surface-de";
import { buildSurfaceDE4 } from "./surface-de-4d";
import {
  packSurface4GpuParams,
  packSurfaceGpuMaps,
  packSurfaceGpuMaps4,
  packSurfaceGpuParams,
  packSurfaceGpuParamsFinite,
  packSurfaceGpuParamsFinite4,
  surfaceDeKernelWgsl,
  type SurfaceGpuKernelOptions,
} from "./surface-de-gpu";
import {
  finiteCompositeDescentSource,
  SURFACE_GPU_FINITE_COMPOSITE_BLOCK4_BYTES,
  SURFACE_GPU_FINITE_COMPOSITE_BLOCK_BYTES,
  SURFACE_GPU_PARAMS4_FINITE_COMPOSITE_BYTES,
  SURFACE_GPU_PARAMS4_FINITE_COMPOSITE_OFFSET,
  SURFACE_GPU_PARAMS_FINITE_COMPOSITE_BYTES,
  SURFACE_GPU_PARAMS_FINITE_COMPOSITE_OFFSET,
  wgslTopLevelDecls,
} from "./surface-finite-composite-gpu";
import type { Transform } from "./types";

const NO_SYMMETRY = { order: 1, plane: "xz" as const };

function construction(
  maps: Transform[],
  level: number,
  dimension: 3 | 4,
): FiniteSolidGeneralConstruction {
  const analysis = analyzeFiniteSolidGeneral(
    maps,
    null,
    NO_SYMMETRY,
    level,
    dimension,
  );
  if (analysis.status !== "eligible" || !analysis.construction) {
    throw new Error(`fixture refused: ${analysis.reasons.join("; ")}`);
  }
  return analysis.construction;
}

function affineKernel(dim: 3 | 4): string {
  return surfaceDeKernelWgsl({
    mode: "shade",
    core: dim === 4 ? "affine4" : "affine",
    width: 4,
    workgroupSize: 64,
    sharedFrontier: false,
    bnbStage2: false,
    ...(dim === 4 ? { slabExt: false } : {}),
  });
}

/** A composite kernel's options: the Menger maps (3D) or the pentatope
 * (4D) with two glass corners, optics on the finite backend. */
function compositeOptions(
  dim: 3 | 4,
  mode: "march" | "shade" | "eval",
): SurfaceGpuKernelOptions {
  const maps = dim === 4 ? pentatope() : mengerSponge();
  const c = construction(maps, 2, dim);
  const media = maps.map((_, a) => (a === 0 || a === maps.length - 1 ? 1 : 0));
  const content = buildFiniteSolidOpaqueContent(
    c,
    media,
    dim === 4 ? buildSurfaceDE4(maps) : buildSurfaceDE(maps),
  );
  return {
    mode,
    core: dim === 4 ? "finite4" : "finite",
    width: 4,
    workgroupSize: 64,
    sharedFrontier: false,
    bnbStage2: false,
    ...(mode === "shade"
      ? { optics: true, opticsBackend: "finiteSolid" as const }
      : {}),
    finiteSolid: {
      level: 2,
      general: { ...c, media, glassOnly: true },
      composite: {
        maps:
          content.dimension === 4
            ? packSurfaceGpuMaps4(content.de)
            : packSurfaceGpuMaps(content.de),
        branches: content.branches,
      },
    },
  };
}

describe("composite descent extraction", () => {
  it("lifts the shipped affine/affine4 descent out verbatim up to the renames", () => {
    for (const dim of [3, 4] as const) {
      const kernel = affineKernel(dim);
      const decls = wgslTopLevelDecls(kernel);
      const descent = finiteCompositeDescentSource(dim, kernel, true);
      const extracted = wgslTopLevelDecls(descent.source);
      expect(extracted.has("finOp_surfaceDE")).toBe(true);
      expect(extracted.has("finOp_surfaceDEHitInfo")).toBe(true);
      // Undo the renames and every extracted declaration is the shipped
      // text (the 4D lift aside, which the next test pins).
      for (const [name, decl] of extracted) {
        const original = decls.get(name.replace(/^finOp_/, ""));
        expect(original).toBeDefined();
        const undone = decl.text
          .replace(/\bfinOp_/g, "")
          .replace(/params\.op_/g, "params.")
          .replace(/FIN_OP_MAPS\[/g, "maps[");
        if (dim === 4 && name.startsWith("finOp_surfaceDE")) {
          expect(undone).not.toBe(original!.text);
        } else {
          expect(undone).toBe(original!.text);
        }
      }
    }
  });

  it("hands the 4D descent its intrinsic point instead of the view lift", () => {
    const descent = finiteCompositeDescentSource(4, affineKernel(4), true);
    expect(descent.source).toContain(
      "fn finOp_surfaceDE(qIn: vec4f, cutoff: f32, li: u32) -> f32 {",
    );
    expect(descent.source).toContain(
      "fn finOp_surfaceDEHitInfo(qIn: vec4f, li: u32) -> SurfaceHitInfo {",
    );
    expect(descent.source).not.toContain("rotorInvApply4");
    expect(descent.source).not.toContain("params.op_w0");
  });

  it("reads params only through the opaque-descent block and maps only baked", () => {
    for (const dim of [3, 4] as const) {
      const descent = finiteCompositeDescentSource(
        dim,
        affineKernel(dim),
        true,
      );
      const code = descent.source.replace(/\/\/.*$/gm, "");
      expect(code).not.toMatch(/params\.(?!op_)/);
      expect(code).not.toMatch(/\bmaps\b/);
      expect(descent.mapVec4s).toBe(dim === 4 ? 14 : 10);
    }
  });

  it("declares the affine struct's own fields, so the byte copy lines up", () => {
    const fields3 = finiteCompositeDescentSource(
      3,
      affineKernel(3),
      false,
    ).structFields;
    const lines3 = fields3
      .trim()
      .split("\n")
      .map((l) => l.trim());
    expect(lines3[0]).toBe("op_boundCenter: vec3f,");
    expect(lines3.at(-1)).toBe("op_fogDensity: f32,");
    const fields4 = finiteCompositeDescentSource(
      4,
      affineKernel(4),
      false,
    ).structFields;
    expect(fields4.trim().split("\n").at(-1)?.trim()).toBe("op_pad4b: f32,");
  });
});

describe("composite kernel", () => {
  it("assembles in both dimensions and every mode with one public surfaceDE", () => {
    for (const dim of [3, 4] as const) {
      for (const mode of ["eval", "march", "shade"] as const) {
        const src = surfaceDeKernelWgsl(compositeOptions(dim, mode));
        expect(src.match(/\nfn surfaceDE\(/g)).toHaveLength(1);
        expect(src).toContain("fn finOpaqueDistance(");
        expect(src).toContain(
          dim === 4 ? "\n  op_pad4b: f32," : "\n  op_fogDensity: f32,",
        );
        if (mode === "shade") {
          expect(src.match(/\nfn surfaceDEHitInfo\(/g)).toHaveLength(1);
          expect(src).toContain("fn transportOpaqueMarch(");
          expect(src).toContain("transportOpaqueMarch(path.origin");
        }
        if (mode === "march") {
          expect(src).toContain("let tGlass = st.w;");
        }
      }
    }
  });

  it("shares the finite kernel's hit-info struct with the extracted descent", () => {
    for (const dim of [3, 4] as const) {
      const composite = wgslTopLevelDecls(
        surfaceDeKernelWgsl(compositeOptions(dim, "shade")),
      );
      const affine = wgslTopLevelDecls(affineKernel(dim));
      expect(composite.get("SurfaceHitInfo")?.text).toBe(
        affine.get("SurfaceHitInfo")?.text,
      );
    }
  });

  it("walks the glass maps alone and skips opaque maps at the tree's first level", () => {
    const src = surfaceDeKernelWgsl(compositeOptions(3, "shade"));
    expect(src).toContain("if (FIN_MEDIA[a0] == 0u) {");
    expect(src).toContain("if (FIN_MEDIA[a] == 0u) {");
  });

  it("refuses a composite without the glass-only walk", () => {
    const opts = compositeOptions(3, "march");
    const fs = opts.finiteSolid!;
    expect(() =>
      surfaceDeKernelWgsl({
        ...opts,
        finiteSolid: { ...fs, general: { ...fs.general!, glassOnly: false } },
      }),
    ).toThrow(/glass-only/);
  });

  it("refuses a branch that names a glass map", () => {
    const opts = compositeOptions(3, "march");
    const fs = opts.finiteSolid!;
    const branches = fs.composite!.branches.map((b, i) =>
      i === 0 ? { ...b, index: 0 } : b,
    );
    expect(() =>
      surfaceDeKernelWgsl({
        ...opts,
        finiteSolid: {
          ...fs,
          composite: { ...fs.composite!, branches },
        },
      }),
    ).toThrow(RangeError);
  });

  it("refuses baked maps that are not the construction's map count", () => {
    const opts = compositeOptions(3, "march");
    const fs = opts.finiteSolid!;
    expect(() =>
      surfaceDeKernelWgsl({
        ...opts,
        finiteSolid: {
          ...fs,
          composite: {
            ...fs.composite!,
            maps: fs.composite!.maps.subarray(40),
          },
        },
      }),
    ).toThrow(RangeError);
  });
});

describe("composite params", () => {
  it("copies the affine packer's frozen block into the 3D opaque-descent block", () => {
    const maps = defaultTransforms();
    const de = buildSurfaceDE(maps);
    const c = construction(maps, 2, 3);
    const run = { itemCount: 7, cutoff: 0, maxDepth: 9 };
    const buf = packSurfaceGpuParamsFinite(
      run,
      2,
      finiteSolidGeneralBoundingRadius(c),
      null,
      maps.length,
      de,
    );
    expect(buf.byteLength).toBe(SURFACE_GPU_PARAMS_FINITE_COMPOSITE_BYTES);
    const affine = new Uint8Array(packSurfaceGpuParams(de, run));
    const block = new Uint8Array(
      buf,
      SURFACE_GPU_PARAMS_FINITE_COMPOSITE_OFFSET,
      SURFACE_GPU_FINITE_COMPOSITE_BLOCK_BYTES,
    );
    expect([...block]).toEqual([
      ...affine.subarray(0, SURFACE_GPU_FINITE_COMPOSITE_BLOCK_BYTES),
    ]);
    // The frozen base keeps the construction's ball, not the attractor's.
    const plain = packSurfaceGpuParamsFinite(
      run,
      2,
      finiteSolidGeneralBoundingRadius(c),
      null,
      maps.length,
    );
    expect([...new Uint8Array(buf, 0, plain.byteLength)]).toEqual([
      ...new Uint8Array(plain),
    ]);
  });

  it("copies the affine4 packer's frozen block into the 4D opaque-descent block", () => {
    const maps = pentatope();
    const de = buildSurfaceDE4(maps);
    const c = construction(maps, 2, 4);
    const view4 = {
      rotor: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      w0: 0,
      sliceHalfW: 0,
    };
    const run = { itemCount: 3, cutoff: 0, maxDepth: 11 };
    const buf = packSurfaceGpuParamsFinite4(
      view4,
      run,
      2,
      finiteSolidGeneralBoundingRadius(c),
      null,
      maps.length,
      de,
    );
    expect(buf.byteLength).toBe(SURFACE_GPU_PARAMS4_FINITE_COMPOSITE_BYTES);
    const affine = new Uint8Array(packSurface4GpuParams(de, view4, run));
    expect([
      ...new Uint8Array(
        buf,
        SURFACE_GPU_PARAMS4_FINITE_COMPOSITE_OFFSET,
        SURFACE_GPU_FINITE_COMPOSITE_BLOCK4_BYTES,
      ),
    ]).toEqual([
      ...affine.subarray(0, SURFACE_GPU_FINITE_COMPOSITE_BLOCK4_BYTES),
    ]);
  });
});
