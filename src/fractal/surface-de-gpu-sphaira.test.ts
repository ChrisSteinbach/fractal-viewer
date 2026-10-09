import { resolveSphairahedron } from "./sphairahedron";
import {
  SPHAIRAHEDRON_FOLD_CAP,
  SPHAIRAHEDRON_STEP_SCALE,
  SPHAIRAHEDRON_TRAP_NORM,
} from "./sphairahedron";
import type { SphairahedronAuthored } from "./sphairahedron";
import { buildSphairahedronDE } from "./sphairahedron-de";
import { buildSphairahedronDE4 } from "./sphairahedron-de-4d";
import {
  packSphaira4GpuParams,
  packSphairaGpuParams,
  packSphairaGpuTables,
  SURFACE_GPU_PARAMS4_PLANE_BYTES,
  SURFACE_GPU_PARAMS4_SPHAIRA_BYTES,
  SURFACE_GPU_PARAMS_PLANE_BYTES,
  SURFACE_GPU_PARAMS_SPHAIRA_BYTES,
  surfaceDeKernelWgsl,
} from "./surface-de-gpu";
import type {
  SurfaceGpuGroundPlane,
  SurfaceGpuKernelOptions,
} from "./surface-de-gpu";

function de3(authored: SphairahedronAuthored) {
  const r = resolveSphairahedron(authored);
  if (!r.ok) throw new Error(r.reasons.join("; "));
  return buildSphairahedronDE(r.construction);
}

function de4(authored: SphairahedronAuthored) {
  const r = resolveSphairahedron(authored);
  if (!r.ok) throw new Error(r.reasons.join("; "));
  return buildSphairahedronDE4(r.construction);
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

const RUN = {
  itemCount: 64,
  pose: {
    ro: [0, 0, 4] as [number, number, number],
    right: [1, 0, 0] as [number, number, number],
    up: [0, 1, 0] as [number, number, number],
    fwd: [0, 0, -1] as [number, number, number],
    tanHalf: 0.5,
    aspect: 1,
    pixelEps: 1e-4,
    rasterWidth: 8,
    rasterHeight: 8,
  },
};

function kernel(opts: Partial<SurfaceGpuKernelOptions>): string {
  return surfaceDeKernelWgsl({
    mode: "eval",
    width: 4,
    workgroupSize: 16,
    sharedFrontier: false,
    bnbStage2: false,
    core: "sphaira",
    ...opts,
  });
}

describe("packSphairaGpuParams (3D, core sphaira)", () => {
  const de = de3({ family: "tetra333" });

  it("is 288 B plain and 336 B with a ground plane, whose block lands at the frozen 288", () => {
    expect(packSphairaGpuParams(de, RUN).byteLength).toBe(
      SURFACE_GPU_PARAMS_SPHAIRA_BYTES,
    );
    expect(packSphairaGpuParams(de, RUN, PLANE).byteLength).toBe(
      SURFACE_GPU_PARAMS_PLANE_BYTES,
    );
    const plane = packSphairaGpuParams(de, RUN, PLANE);
    const dv = new DataView(plane);
    expect(dv.getFloat32(288, true)).toBe(PLANE.y);
  });

  it("writes the counts vec4u at 208 and pads 224..287 with zeros", () => {
    const buf = packSphairaGpuParams(de, RUN);
    const dv = new DataView(buf);
    expect(dv.getUint32(208, true)).toBe(de.faceCount);
    expect(dv.getUint32(212, true)).toBe(de.termData.length / 5);
    expect(dv.getUint32(216, true)).toBe(de.pieceCount);
    expect(dv.getUint32(220, true)).toBe(0);
    for (let o = 224; o < 288; o += 4) {
      expect(dv.getFloat32(o, true)).toBe(0);
    }
  });

  it("fills the frozen block: the framing ball, step 1, order 1, faceCount slots and the full cap", () => {
    const buf = packSphairaGpuParams(de, RUN);
    const dv = new DataView(buf);
    expect(dv.getFloat32(0, true)).toBe(de.boundCenter[0]);
    expect(dv.getFloat32(4, true)).toBe(de.boundCenter[1]);
    expect(dv.getFloat32(8, true)).toBe(de.boundCenter[2]);
    expect(dv.getFloat32(12, true)).toBe(de.boundingRadius);
    expect(dv.getFloat32(16, true)).toBe(de.boundingRadius * 2);
    expect(dv.getFloat32(20, true)).toBe(SPHAIRAHEDRON_STEP_SCALE);
    expect(dv.getFloat32(24, true)).toBe(de.visibleBoundingRadius);
    expect(dv.getUint32(40, true)).toBe(1);
    expect(dv.getUint32(48, true)).toBe(de.faceCount);
    expect(dv.getUint32(52, true)).toBe(SPHAIRAHEDRON_FOLD_CAP);
  });

  it("ignores a preview maxDepth: the fold cap is a guard, not a knob", () => {
    const buf = packSphairaGpuParams(de, { ...RUN, maxDepth: 7 });
    expect(new DataView(buf).getUint32(52, true)).toBe(SPHAIRAHEDRON_FOLD_CAP);
  });

  it("refuses a footprint cap, a shape trap and space tiling, each with its reason", () => {
    expect(() => packSphairaGpuParams(de, { ...RUN, footprint: 0.5 })).toThrow(
      /footprint cap/,
    );
    expect(() =>
      packSphairaGpuParams(de, RUN, null, {
        geometry: false,
        geometryLevelMin: 0,
        geometryLevelMax: 0,
      } as never),
    ).toThrow(/shape trap/);
    expect(() =>
      packSphairaGpuParams(de, RUN, null, null, {
        group: "a3",
        info: { dim: 3, label: "a3" },
      } as never),
    ).toThrow(/tiling/);
  });
});

describe("packSphaira4GpuParams (4D, core sphaira4)", () => {
  const de = de4({ family: "tetra4" });

  it("is 576 B plain and 624 B with a ground plane at the frozen 576", () => {
    expect(packSphaira4GpuParams(de, XW_ROTOR_VIEW, RUN).byteLength).toBe(
      SURFACE_GPU_PARAMS4_SPHAIRA_BYTES,
    );
    expect(
      packSphaira4GpuParams(de, XW_ROTOR_VIEW, RUN, PLANE).byteLength,
    ).toBe(SURFACE_GPU_PARAMS4_PLANE_BYTES);
    const plane = packSphaira4GpuParams(de, XW_ROTOR_VIEW, RUN, PLANE);
    const dv = new DataView(plane);
    expect(dv.getFloat32(576, true)).toBe(PLANE.y);
  });

  it("writes the counts vec4u at 464 and pads 480..575 with zeros", () => {
    const buf = packSphaira4GpuParams(de, XW_ROTOR_VIEW, RUN);
    const dv = new DataView(buf);
    expect(dv.getUint32(464, true)).toBe(de.faceCount);
    expect(dv.getUint32(468, true)).toBe(de.termData.length / 6);
    expect(dv.getUint32(472, true)).toBe(de.pieceCount);
    for (let o = 480; o < 576; o += 4) {
      expect(dv.getFloat32(o, true)).toBe(0);
    }
  });

  it("carries the view: the rotor's transpose at 208, w0 at 416, the slice-adjusted radius at 24 and the full radius at 428", () => {
    const buf = packSphaira4GpuParams(de, XW_ROTOR_VIEW, RUN);
    const dv = new DataView(buf);
    const c = Math.cos(0.3);
    const s = Math.sin(0.3);
    // The packer stores the rotor's TRANSPOSE (the world→attractor matrix
    // the body applies): row i of the stored rows is column i of the pose
    // rotor.
    expect(dv.getFloat32(208, true)).toBe(Math.fround(c));
    expect(dv.getFloat32(212, true)).toBe(0);
    expect(dv.getFloat32(216, true)).toBe(0);
    // Row 0 of the stored transpose is the pose rotor's column 0:
    // (c, 0, 0, s) — the xw plane's rotation rides the stored rows' w.
    expect(dv.getFloat32(220, true)).toBe(Math.fround(s));
    expect(dv.getFloat32(416, true)).toBe(Math.fround(XW_ROTOR_VIEW.w0));
    expect(dv.getFloat32(420, true)).toBe(0);
    // The slice-ADJUSTED march ball at 24, the FULL radius at 428.
    expect(dv.getFloat32(24, true)).toBe(
      Math.fround(Math.sqrt(de.boundingRadius ** 2 - XW_ROTOR_VIEW.w0 ** 2)),
    );
    expect(dv.getFloat32(428, true)).toBe(de.boundingRadius);
  });

  it("refuses a slab and a footprint cap", () => {
    expect(() =>
      packSphaira4GpuParams(de, { ...XW_ROTOR_VIEW, sliceHalfW: 0.1 }, RUN),
    ).toThrow(/no slab/);
    expect(() =>
      packSphaira4GpuParams(de, XW_ROTOR_VIEW, { ...RUN, footprint: 0.5 }),
    ).toThrow(/footprint cap/);
  });
});

const XW_ROTOR_VIEW = { rotor: XW_ROTOR, w0: 0.15, sliceHalfW: 0 };

describe("packSphairaGpuTables (binding 1, sphTable)", () => {
  it("packs one vec4 pair per face in scan order: coords in A, (r, kind, sense) in B", () => {
    const de = de3({ family: "tetra333" });
    const t = packSphairaGpuTables(de);
    // 4 faces × 2 + 5 terms × 2 + 1 piece = 19 vec4s.
    expect(t.length).toBe(
      (de.faceCount * 2 + (de.termData.length / 5) * 2 + de.pieceCount) * 4,
    );
    // Face 0 is the ball: A = (0, 0, 0, 0-padded), B = (r, 0, sense 0, 0).
    expect(t[0]).toBe(de.faceData[0]);
    expect(t[1]).toBe(de.faceData[1]);
    expect(t[2]).toBe(de.faceData[2]);
    expect(t[3]).toBe(0);
    expect(t[4]).toBe(de.faceData[3]);
    expect(t[5]).toBe(0);
    expect(t[6]).toBe(de.faceData[4]);
    // Face 1 is a wall: kind 1, sense 0.
    expect(t[8 + 5]).toBe(1);
    expect(t[8 + 6]).toBe(0);
  });

  it("packs terms with their negation flags and the piece table at the tail", () => {
    const de = de3({ family: "cube1" });
    const t = packSphairaGpuTables(de);
    const termBase = de.faceCount * 2 * 4;
    // Term 0: a wall (kind 1), B = (h, 1, above, 0).
    expect(t[termBase + 4]).toBe(de.termData[3]);
    expect(t[termBase + 5]).toBe(de.termKind[0]);
    expect(t[termBase + 6]).toBe(de.termData[4]);
    // The piece table: one vec4 (start, length) after the terms.
    const pieceBase = (de.faceCount * 2 + (de.termData.length / 5) * 2) * 4;
    expect(t[pieceBase]).toBe(de.pieceStart[0]);
    expect(t[pieceBase + 1]).toBe(de.pieceLength[0]);
  });

  it("carries w on the 4D families' coordinate lanes and zero-pads the 3D ones", () => {
    const de3t = de3({ family: "tetra333" });
    const de4t = de4({ family: "tetra4" });
    // 3D face 0's A.w is 0; the wall normal's w lane too.
    expect(packSphairaGpuTables(de3t)[3]).toBe(0);
    // 4D walls lift with n = (a0, 0, a1, 0): the w lane IS the CPU's own
    // zero — carried verbatim, not padded.
    const t4 = packSphairaGpuTables(de4t);
    expect(t4[8 + 3]).toBe(de4t.faceData[1 * 6 + 3]);
    expect(t4[8 + 3]).toBe(0);
    // The B lanes read the ROW'S OWN TAIL (r at stride−2, sense at
    // stride−1), not fixed indices — the 4D rows' w coordinate lives at
    // lane 3, exactly where a fixed-index read would have taken the
    // radius from. Face 0 is the unit ball: B = (1, 0, 0, 0).
    expect(t4[4]).toBe(1);
    expect(t4[5]).toBe(0);
    expect(t4[6]).toBe(0);
    // And the walls' h: face 1's B = (h, 1, 0, 0).
    expect(t4[8 + 4]).toBe(de4t.faceData[1 * 6 + 4]);
    expect(t4[8 + 5]).toBe(1);
  });
});

describe("surfaceDeKernelWgsl sphaira cores", () => {
  it("emits the scan fold over the sphTable binding with no descent maps, frontier or GpuMap struct", () => {
    const src = kernel({});
    expect(src).toContain(
      "@binding(1) var<storage, read> sphTable: array<vec4f>",
    );
    expect(src).toContain("fn sphairaFold3(");
    expect(src).toContain("fn sphairaTileSDF3(");
    expect(src).not.toContain("struct GpuMap {");
    expect(src).not.toContain("var fcX");
    // The estimate's fudge and the baked cap are module constants.
    expect(src).toContain("0.2");
    expect(src).toContain(`${SPHAIRAHEDRON_FOLD_CAP}u`);
  });

  it("declares the counts at the variant block and keeps the plane block's frozen offset through the pads", () => {
    const src = kernel({});
    expect(src).toContain("sphCounts: vec4u,");
    expect(src).toContain("sphPad: array<vec4f, 4>,");
    const plane = kernel({ groundPlane: true });
    expect(plane).toContain("sphCounts: vec4u,");
    expect(plane).toContain("groundY: f32,");
  });

  it("4D emits the lifted fold and the counts at 464, with the shared plane block at 576", () => {
    const src = surfaceDeKernelWgsl({
      mode: "eval",
      width: 4,
      workgroupSize: 16,
      sharedFrontier: false,
      bnbStage2: false,
      core: "sphaira4",
    });
    expect(src).toContain("fn liftSphaira4(");
    expect(src).toContain("fn sphairaFold4(");
    expect(src).toContain("sph4Counts: vec4u,");
    expect(src).toContain("sph4Pad: array<vec4f, 6>,");
    const plane = surfaceDeKernelWgsl({
      mode: "eval",
      width: 4,
      workgroupSize: 16,
      sharedFrontier: false,
      bnbStage2: false,
      core: "sphaira4",
      groundPlane: true,
    });
    expect(plane).toContain("groundY: f32,");
  });

  it("attributes a hit by the fold's last-move face and the move count", () => {
    const src = kernel({ mode: "shade" });
    expect(src).toContain("info.firstChoice = max(f.lastFace, 0);");
    expect(src).toContain(
      `clamp(f32(f.moves) / ${SPHAIRAHEDRON_TRAP_NORM}.0, 0.0, 1.0)`,
    );
    // rings/sheets off the fold's closest approaches.
    expect(src).toContain("f.minR / params.boundingRadius");
    expect(src).toContain("f.minY / params.boundingRadius");
    const src4 = surfaceDeKernelWgsl({
      mode: "shade",
      width: 4,
      workgroupSize: 16,
      sharedFrontier: false,
      bnbStage2: false,
      core: "sphaira4",
    });
    expect(src4).toContain("info.firstChoice = max(f.lastFace, 0);");
  });

  it("treats the frontier, probe-width, slab-extent and maps-address options as inert", () => {
    const base = kernel({});
    for (const opts of [
      { width: 12 },
      { sharedFrontier: true, width: 12 },
      { bnbStage2: true, width: 12 },
      { shadeDeWidth: 1, mode: "shade" as const },
      { slabExt: false },
      { mapsUniform: true },
    ]) {
      expect(kernel(opts)).toBe(
        kernel(
          opts.mode !== undefined
            ? { mode: opts.mode, shadeDeWidth: undefined }
            : {},
        ),
      );
      void base;
    }
  });

  it("refuses every feature outside the composition matrix, naming the reason", () => {
    const refusals: [Partial<SurfaceGpuKernelOptions>, RegExp][] = [
      [{ lens: true }, /fold-final lens/],
      [{ balloon: true }, /balloon/],
      [{ slabCover: true }, /slab cover/],
    ];
    for (const [opts, why] of refusals) {
      expect(() => kernel(opts)).toThrow(why);
    }
  });
});
