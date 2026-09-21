/**
 * The finite-solid cores' generated WGSL pins: the display DE, exact primary
 * and DDA transport emission, the refusals, and the packer wire. The oracle
 * arithmetic itself is pinned by `finite-solid.test.ts` (f64) and the
 * bench's transport agreement legs (f32 against that oracle).
 */
import { createHash } from "node:crypto";
import {
  FINITE_SOLID_GENERAL_TIE_REL,
  FINITE_SOLID_HALF_EXTENT,
  FINITE_SOLID_IDENTITY_POSE,
  FINITE_SOLID_MAX_LEVEL,
  analyzeFiniteSolidGeneral,
  buildFiniteSolidConstruction,
  finiteSolidCellOccupiedByRule,
  finiteSolidGeneralNextBoundary,
  finiteSolidGeneralNextBoundaryFromAnchor,
  finiteSolidNextBoundary,
  finiteSolidNextBoundaryFromAnchor,
  type FiniteSolidAnchor,
  type FiniteSolidPose,
} from "./finite-solid";
import type { FiniteSolidGeneralConstruction } from "./finite-solid";
import {
  SURFACE_GPU_PARAMS4_FINITE_BYTES,
  SURFACE_GPU_PARAMS_FINITE_BYTES,
  type FiniteSolidGeneralWire,
  finiteSolidCellOccupiedF32,
  finiteSolidDdaF32,
  finiteSolidDisplaySource,
  finiteSolidGeneralDdaF32,
  finiteSolidGeneralDisplaySource,
  finiteSolidGeneralTransportSource,
  finiteSolidTransportSource,
} from "./surface-finite-solid-gpu";
import {
  SURFACE_GPU_PARAMS4_PLANE_BYTES,
  SURFACE_GPU_PARAMS_PLANE_BYTES,
} from "./surface-de-gpu";
import {
  DIELECTRIC_MAX_PROCESSED_PATHS,
  DIELECTRIC_MAX_STACK,
  dielectricRefract,
} from "./surface-dielectric";
import {
  FINITE_TRANSPORT_BUFFER_HEADER_BYTES,
  FINITE_TRANSPORT_CHUNK_PATHS,
  FINITE_TRANSPORT_PATH_BYTES,
  FINITE_TRANSPORT_RUNNING,
  FINITE_TRANSPORT_RUNNING_OFFSET,
  FINITE_TRANSPORT_WORK_BYTES,
  FINITE_TRANSPORT_WORK_HEADER_BYTES,
} from "./finite-transport-work";
import type { Vec3, Vec4 } from "./types";
import type { Transform } from "./types";
import { mengerSponge, sierpinskiTetrahedron } from "./presets";
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
  const chunkOptions = {
    optics: true,
    opticsBackend: "finiteSolid" as const,
    finiteTransportChunkPaths: FINITE_TRANSPORT_CHUNK_PATHS,
  };

  it("retains the original uncached query bytes and all traversal guards", () => {
    const legacyHashes = {
      3: "ee1559f5bd1a126b90d497c85a5a4aeb747ca99b1a3ec3d3080ef196390ec951",
      4: "a4c9ce1368b895bd2063b143f80570772b4b3f2d2baf3a19d0bb818c41b95739",
    };
    for (const dim of [3, 4] as const) {
      const legacy = finiteSolidTransportSource(dim, false);
      const cached = finiteSolidTransportSource(dim);
      // Frozen before introducing the cache: the diagnostic control must
      // not accidentally acquire the same algorithm change as the candidate.
      expect(createHash("sha256").update(legacy).digest("hex")).toBe(
        legacyHashes[dim],
      );
      const traversal = (source: string) =>
        source.slice(
          source.indexOf("    if (nextT >= 1.0e30)"),
          source.indexOf("    sideInside = nextInside;") +
            "    sideInside = nextInside;".length,
        );
      expect(traversal(cached)).toBe(traversal(legacy));
      expect(cached).toContain(`let maxVisits = ${dim} * (g - 1) + 1;`);
    }
  });

  it("packs resumable batch and slot storage at the shared host offsets", () => {
    const types = new Map([
      ["u32", { align: 4, size: 4 }],
      ["atomic<u32>", { align: 4, size: 4 }],
      ["f32", { align: 4, size: 4 }],
      ["vec3f", { align: 16, size: 12 }],
      ["vec2u", { align: 8, size: 8 }],
      [
        `array<TransportPath, ${DIELECTRIC_MAX_STACK}>`,
        { align: 16, size: DIELECTRIC_MAX_STACK * FINITE_TRANSPORT_PATH_BYTES },
      ],
      ["array<FiniteTransportWork>", { align: 16, size: 0 }],
    ]);
    for (const core of ["finite", "finite4"] as const) {
      const source = surfaceDeKernelWgsl(baseOpts(core, chunkOptions));
      const layout = (name: string) => {
        const body = new RegExp(`struct ${name} \\{([^}]+)\\}`).exec(
          source,
        )?.[1];
        expect(body).toBeDefined();
        let offset = 0;
        let alignment = 1;
        const offsets: Record<string, number> = {};
        for (const [, field, type] of (body ?? "").matchAll(
          /^\s*(\w+): ([^\n]+),$/gm,
        )) {
          const value = types.get(type);
          if (!value) throw new Error(`Unexpected storage field: ${type}`);
          alignment = Math.max(alignment, value.align);
          offset = Math.ceil(offset / value.align) * value.align;
          offsets[field] = offset;
          offset += value.size;
        }
        return { offsets, size: Math.ceil(offset / alignment) * alignment };
      };
      expect(layout("FiniteTransportBatch")).toEqual({
        offsets: {
          initialize: 0,
          running: FINITE_TRANSPORT_RUNNING_OFFSET,
          generation: 8,
          rayCount: 12,
          slots: FINITE_TRANSPORT_BUFFER_HEADER_BYTES,
        },
        size: FINITE_TRANSPORT_BUFFER_HEADER_BYTES,
      });
      expect(layout("FiniteTransportWork")).toEqual({
        offsets: {
          radiance: 0,
          residual: 12,
          sp: 16,
          processed: 20,
          done: 24,
          pixel: 28,
          replayPass: 32,
          generation: 36,
          pad: 40,
          stack: FINITE_TRANSPORT_WORK_HEADER_BYTES,
        },
        size: FINITE_TRANSPORT_WORK_BYTES,
      });
      const bindings = [
        ...source.matchAll(/@binding\((\d+)\) var<storage, [^>]+>/g),
      ].map((match) => Number(match[1]));
      expect(bindings).toHaveLength(9);
      expect(new Set(bindings).size).toBe(9);
      expect(source).toContain(
        "@binding(1) var<storage, read_write> finiteWork: FiniteTransportBatch;",
      );
      expect(source.indexOf("struct TransportPath")).toBeLessThan(
        source.indexOf("struct FiniteTransportWork"),
      );
      const plain = surfaceDeKernelWgsl(
        baseOpts(core, { ...chunkOptions, finiteTransportChunkPaths: 0 }),
      );
      expect(/struct TransportPath \{[^}]+\}/.exec(source)?.[0]).toBe(
        /struct TransportPath \{[^}]+\}/.exec(plain)?.[0],
      );
    }
  });

  it("pauses before popping and leaves the complete optical work loop unchanged", () => {
    for (const core of ["finite", "finite4"] as const) {
      const source = surfaceDeKernelWgsl(baseOpts(core, chunkOptions));
      const plain = surfaceDeKernelWgsl(
        baseOpts(core, { ...chunkOptions, finiteTransportChunkPaths: 0 }),
      );
      const opticalWork = (text: string) =>
        text.slice(
          text.indexOf("    let path = stack[sp - 1u];"),
          text.indexOf("    if (abort) {\n      break;\n    }\n  }") +
            "    if (abort) {\n      break;\n    }\n  }".length,
        );
      expect(opticalWork(source).length).toBeGreaterThan(6000);
      expect(opticalWork(source)).toBe(opticalWork(plain));
      expect(source).toContain(
        `const TRANSPORT_MAX_PROCESSED = ${DIELECTRIC_MAX_PROCESSED_PATHS}u;`,
      );
      expect(source).toContain(
        `const TRANSPORT_STATUS_RUNNING = ${FINITE_TRANSPORT_RUNNING}u;`,
      );
      const pause = source.slice(
        source.indexOf("    // Pause BEFORE popping:"),
        source.indexOf("    let path = stack[sp - 1u];"),
      );
      expect(pause).toContain(
        "processed - chunkStartProcessed >= TRANSPORT_CHUNK_PATHS",
      );
      for (const field of ["sp", "processed", "radiance", "residual"]) {
        expect(pause).toContain(
          `finiteWork.slots[workSlot].${field} = ${field};`,
        );
        expect(source).toContain(
          `${field} = finiteWork.slots[workSlot].${field};`,
        );
      }
      expect(pause).toContain("for (var i = 0u; i < sp; i++)");
      expect(pause).toContain(
        "finiteWork.slots[workSlot].stack[i] = stack[i];",
      );
      expect(source).toContain(
        "stack[i] = finiteWork.slots[workSlot].stack[i];",
      );
      expect(pause).toContain("atomicAdd(&finiteWork.running, 1u);");
      expect(pause).toContain(
        "out.status = TRANSPORT_STATUS_RUNNING;\n      return out;",
      );
      expect(pause).not.toMatch(
        /residual = residual \+|sp = sp -|transportState\[|colorOut\[/,
      );
      const running = source.slice(
        source.indexOf("  if (traced.status == TRANSPORT_STATUS_RUNNING)"),
        source.indexOf("  if (traced.status == TRANSPORT_STATUS_INVALID)"),
      );
      expect(running).toContain(
        "transportStatusOut[slotI] = TRANSPORT_STATUS_RUNNING;",
      );
      expect(running).not.toMatch(/transportState\[|colorOut\[|layerOut\[/);
    }
  });

  it("validates resumable slot identity and counters before every load or done-slot return", () => {
    for (const core of ["finite", "finite4"] as const) {
      const source = surfaceDeKernelWgsl(baseOpts(core, chunkOptions));
      const entry = source.slice(source.indexOf("fn transportRays("));
      for (const condition of [
        "finiteWork.rayCount != params.itemCount",
        "finiteWork.rayCount > arrayLength(&finiteWork.slots)",
        "finiteWork.initialize > 1u",
        "finiteWork.generation == 0u",
        "replayPass >= TRANSPORT_REPLAY_PASSES",
        "shade.transport[0] != f32(replayPass)",
        "finiteWork.slots[slotI].pixel != ray",
        "finiteWork.slots[slotI].replayPass != replayPass",
        "finiteWork.slots[slotI].generation != finiteWork.generation",
        "finiteWork.slots[slotI].done > 1u",
        "finiteWork.slots[slotI].sp > TRANSPORT_MAX_STACK",
        "finiteWork.slots[slotI].processed > TRANSPORT_MAX_PROCESSED",
        "finiteWork.slots[slotI].sp == 0u",
        "finiteWork.slots[slotI].processed == 0u",
        "transportStatusOut[slotI] != TRANSPORT_STATUS_RUNNING",
      ]) {
        expect(entry).toContain(condition);
        expect(entry.indexOf(condition)).toBeLessThan(
          entry.indexOf("let traced ="),
        );
      }
      expect(
        entry.indexOf("finiteWork.slots[slotI].generation !="),
      ).toBeLessThan(entry.indexOf("if (finiteWork.slots[slotI].done == 1u)"));
      expect(entry).toContain("finiteWorkReset(slotI, ray, replayPass);");
      // New-batch early returns are also terminal slots; a resumed active
      // trace encountering those routes refuses instead of losing its stack.
      for (const start of [
        "  if (prevStatus == TRANSPORT_STATUS_COMPLETE",
        "  if (st.y !=",
        "  if (lane0[0] <= 0.0)",
      ]) {
        const early = entry.slice(
          entry.indexOf(start),
          entry.indexOf(start) + 650,
        );
        expect(early).toContain("finiteWork.slots[slotI].done = 1u;");
        expect(early).toContain("finiteWorkReject(slotI, ray, replayPass);");
      }
    }
  });

  it("compile-gates resumable work to explicitly requested finite optics shade", () => {
    for (const core of ["finite", "finite4"] as const) {
      const implicit = surfaceDeKernelWgsl(
        baseOpts(core, {
          ...chunkOptions,
          finiteTransportChunkPaths: undefined,
        }),
      );
      expect(implicit).toBe(
        surfaceDeKernelWgsl(
          baseOpts(core, { ...chunkOptions, finiteTransportChunkPaths: 0 }),
        ),
      );
      expect(implicit).not.toContain("FiniteTransportWork");
      for (const mode of ["eval", "march"] as const)
        expect(
          surfaceDeKernelWgsl(baseOpts(core, { ...chunkOptions, mode })),
        ).toBe(
          surfaceDeKernelWgsl(
            baseOpts(core, {
              ...chunkOptions,
              mode,
              finiteTransportChunkPaths: 0,
            }),
          ),
        );
      expect(
        surfaceDeKernelWgsl(baseOpts(core, { finiteTransportChunkPaths: 1 })),
      ).toBe(surfaceDeKernelWgsl(baseOpts(core)));
      for (const paths of [-1, 0.5, Number.NaN, Infinity, 2 ** 32])
        expect(() =>
          surfaceDeKernelWgsl(
            baseOpts(core, {
              ...chunkOptions,
              finiteTransportChunkPaths: paths,
            }),
          ),
        ).toThrow(/chunk size/);
      expect(
        surfaceDeKernelWgsl(
          baseOpts(core, { ...chunkOptions, finiteTransportChunkPaths: 1 }),
        ),
      ).toContain("const TRANSPORT_CHUNK_PATHS = 1u;");
    }
    for (const core of ["fold", "fold4"] as const) {
      const options = { ...baseOpts("finite"), core, optics: true };
      expect(
        surfaceDeKernelWgsl({ ...options, finiteTransportChunkPaths: 1 }),
      ).toBe(surfaceDeKernelWgsl(options));
    }
  });

  it("packs every finite continuation field into a 112-byte private path", () => {
    const types = new Map([
      ["u32", { align: 4, size: 4 }],
      ["f32", { align: 4, size: 4 }],
      ["vec3f", { align: 16, size: 12 }],
      ["vec4f", { align: 16, size: 16 }],
      ["vec4i", { align: 16, size: 16 }],
    ]);
    for (const core of ["finite", "finite4"] as const) {
      const source = surfaceDeKernelWgsl(
        baseOpts(core, { optics: true, opticsBackend: "finiteSolid" }),
      );
      const body = /struct TransportPath \{([^}]+)\}/.exec(source)?.[1] ?? "";
      const fields = [...body.matchAll(/^\s*(\w+): (\w+),$/gm)];
      let offset = 0;
      let alignment = 1;
      const offsets: Record<string, number> = {};
      for (const [, name, type] of fields) {
        const layout = types.get(type);
        if (!layout) throw new Error(`Unexpected WGSL path type: ${type}`);
        alignment = Math.max(alignment, layout.align);
        offset = Math.ceil(offset / layout.align) * layout.align;
        offsets[name] = offset;
        offset += layout.size;
      }
      expect(offsets).toEqual({
        origin: 0,
        inside: 12,
        dir: 16,
        interfaces: 28,
        energy: 32,
        bound: 44,
        finiteIntrinsic: 48,
        finitePlanes: 64,
        finiteCells: 80,
        anchorPresent: 96,
        exitPresent: 100,
        finiteMask: 104,
      });
      expect(Math.ceil(offset / alignment) * alignment).toBe(112);
      const trace = source.slice(
        source.indexOf("fn transportTrace("),
        source.indexOf("// The transport pass: one ray per invocation"),
      );
      expect(trace).not.toMatch(/\.(?:anchorPoint|anchorPad2)\b/);
      for (const child of ["child", "trans", "refl"]) {
        for (const [field, anchor] of [
          ["finiteIntrinsic", "anchorIntrinsic"],
          ["finiteMask", "anchorMask"],
          ["finitePlanes", "anchorPlanes"],
          ["finiteCells", "anchorCells"],
        ])
          expect(trace).toContain(`${child}.${field} = hit.${anchor};`);
      }
    }
  });

  it("classifies coordinates only for unanchored finite rays", () => {
    for (const dim of [3, 4] as const) {
      const source = finiteSolidTransportSource(dim);
      const setup = source.slice(source.indexOf("var index: array<i32, 4>"));
      const root = setup.slice(0, setup.indexOf("if (anchorPresent == 1u)"));
      expect(root).toMatch(
        /if \(anchorPresent == 0u\) \{[\s\S]*finiteRaySideIndex\([\s\S]*if \(start == enter\)/,
      );
      expect(setup).toContain("index[a] = anchorCellsIn[a];");
      expect(setup).toContain(
        "index[a] = select(anchorPlanesIn[a] - 1, anchorPlanesIn[a], qd[a] > 0.0);",
      );
    }
  });

  it("reuses validated planes and clips the root only for world-origin queries", () => {
    for (const dim of [3, 4] as const) {
      const source = finiteSolidTransportSource(dim);
      const query = source.slice(source.indexOf("fn transportFiniteBoundary("));
      const canonical = query.slice(0, query.indexOf("  var enter ="));
      expect(canonical).not.toContain("finiteLift(origin)");
      expect(canonical.match(/finiteGridPlane\(/g)).toHaveLength(3);
      expect(query).toContain("var start = 0.0;");
      expect(query).toMatch(
        /if \(anchorPresent != 1u\) \{\s*q = finiteLift\(origin\);[\s\S]*start = max\(0\.0, enter\);/,
      );
    }
  });

  it("skips terminal displacement only when the finite rear scene ignores the origin", () => {
    for (const core of ["finite", "finite4"] as const) {
      const options = { optics: true, opticsBackend: "finiteSolid" as const };
      const floored = surfaceDeKernelWgsl(
        baseOpts(core, { ...options, groundPlane: true }),
      );
      expect(floored).toContain(
        "if (path.exitPresent == 1u && distortion > 0.0 && path.dir.y < -1.0e-6) {",
      );
      expect(floored).toContain(
        "if (origin.y > params.groundY && dir.y < -1.0e-6) {",
      );
      const plain = surfaceDeKernelWgsl(baseOpts(core, options));
      expect(plain).toContain(
        "if (false) {\n        let nS = transportSmoothedNormal(",
      );
      expect(plain).not.toContain("fn shadeGroundPlane(");
    }
  });

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

describe("finite GPU occupancy against the independent generic rule", () => {
  for (const dim of [3, 4] as const) {
    it(`${dim}D depth-two masks agree for all ${9 ** dim} cells`, () => {
      const mismatches: number[][] = [];
      let occupied = 0;
      for (let cell = 0; cell < 9 ** dim; cell++) {
        const idx = Array.from(
          { length: dim },
          (_, axis) => Math.floor(cell / 9 ** axis) % 9,
        );
        const actual = finiteSolidCellOccupiedF32(dim, 2, idx);
        if (actual !== finiteSolidCellOccupiedByRule(dim, 2, idx))
          mismatches.push(idx);
        if (actual) occupied++;
      }
      expect(mismatches).toEqual([]);
      expect(occupied).toBe(dim === 3 ? 400 : 2304);

      // The executable integer twin and the GPU emission use the same
      // masks, and the generic loop remains after the level-two branch.
      const source = finiteSolidTransportSource(dim);
      const start = source.indexOf("fn finiteOccupied(");
      const end = source.indexOf("fn finiteRowXyz(", start);
      const predicate = source.slice(start, end);
      const branch = predicate.indexOf("params.finiteLevel == 2u");
      expect(branch).toBeGreaterThan(predicate.indexOf("idx[a] >= g"));
      expect(predicate).toContain("coarseMiddles += (56u >> bit) & 1u;");
      expect(predicate).toContain("fineMiddles += (146u >> bit) & 1u;");
      expect(predicate.indexOf("var div = g / 3;")).toBeGreaterThan(branch);
    });

    it(`${dim}D rejects outside indices before bit shifts can wrap`, () => {
      for (let axis = 0; axis < dim; axis++) {
        for (const outside of [-33, -32, -1, 9, 31, 32, 33]) {
          const idx = Array<number>(dim).fill(0);
          idx[axis] = outside;
          expect(finiteSolidCellOccupiedByRule(dim, 2, idx)).toBe(false);
          expect(finiteSolidCellOccupiedF32(dim, 2, idx)).toBe(false);
        }
      }
      if (dim === 3)
        expect(finiteSolidCellOccupiedF32(dim, 2, [0, 0, 0, -32])).toBe(true);
    });

    it(`${dim}D retains generic occupancy for every level-zero and level-one cell`, () => {
      for (const level of [0, 1]) {
        const grid = 3 ** level;
        for (let cell = 0; cell < grid ** dim; cell++) {
          const idx = Array.from(
            { length: dim },
            (_, axis) => Math.floor(cell / grid ** axis) % grid,
          );
          expect(finiteSolidCellOccupiedF32(dim, level, idx)).toBe(
            finiteSolidCellOccupiedByRule(dim, level, idx),
          );
        }
        for (let axis = 0; axis < dim; axis++) {
          for (const outside of [-1, grid]) {
            const idx = Array<number>(dim).fill(0);
            idx[axis] = outside;
            expect(finiteSolidCellOccupiedF32(dim, level, idx)).toBe(false);
          }
        }
      }
    });
  }
});

describe("finite DDA cached crossings against the original f32 traversal", () => {
  for (const dim of [3, 4] as const) {
    it(
      `${dim}D preserves complete results from every cell at every supported level`,
      // The 4D sweep walks every cell of every level in both DDA forms;
      // its several seconds exceed the 5s default under any CPU contention.
      { timeout: 20000 },
      () => {
        const directions: Vec3[] = [
          [1, 0, 0],
          [-1, 0, 0],
          [0, 1, 0],
          [0, -1, 0],
          [0, 0, 1],
          [0, 0, -1],
          [1, 1, 1],
          [-1, -1, -1],
          [1, -1, 1],
          [-1, 1, -1],
          [1, Math.fround(1 + 2 ** -23), 1],
          [-1, -1, Math.fround(-1 + 2 ** -24)],
        ];
        let boundaries = 0;
        let misses = 0;
        for (const level of [0, 1, 2]) {
          const grid = 3 ** level;
          for (let cell = 0; cell < grid ** dim; cell++) {
            const indices = Array.from(
              { length: dim },
              (_, axis) => Math.floor(cell / grid ** axis) % grid,
            );
            const point = indices.map((index) =>
              Math.fround(-0.75 + ((index + 0.5) * 1.5) / grid),
            );
            const inside = finiteSolidCellOccupiedByRule(dim, level, indices);
            for (const direction of directions) {
              const args = [
                dim,
                level,
                0.75,
                dim === 4 ? FINITE_SOLID_IDENTITY_POSE.rows : null,
                dim === 4 ? point[3] : 0,
                point.slice(0, 3) as Vec3,
                direction,
                null,
                inside,
              ] as const;
              const actual = finiteSolidDdaF32(...args);
              expect(actual).toEqual(finiteSolidDdaF32(...args, false));
              expect(actual.kind).not.toBe(3);
              boundaries += Number(actual.kind === 1);
              misses += Number(actual.kind === 2);
            }
          }
        }
        expect(boundaries).toBeGreaterThan(1000);
        expect(misses).toBeGreaterThan(100);
      },
    );

    it(`${dim}D retains the visit-cap refusal for a nonadvancing malformed query`, () => {
      // A NaN origin produces NaN crossing times and no tied axis. This is
      // deliberately outside geometry admission, but must still terminate
      // through the existing visit guard rather than hang after caching.
      for (const level of [0, 1, 2]) {
        const args = [
          dim,
          level,
          0.75,
          dim === 4 ? FINITE_SOLID_IDENTITY_POSE.rows : null,
          -0.7,
          [Number.NaN, -0.7, -0.7] as Vec3,
          [1, 0, 0] as Vec3,
          null,
          true,
        ] as const;
        const actual = finiteSolidDdaF32(...args);
        expect(actual).toEqual(finiteSolidDdaF32(...args, false));
        expect(actual).toMatchObject({ kind: 3, reason: 1 });
      }
    });

    it(`${dim}D retains refusals for zero and nonfinite directions`, () => {
      const directions: Vec3[] = [
        [0, 0, 0],
        [Number.NaN, 0, 1],
        [1, Infinity, 0],
        [0, 1, -Infinity],
      ];
      for (const direction of directions) {
        const args = [
          dim,
          2,
          0.75,
          dim === 4 ? FINITE_SOLID_IDENTITY_POSE.rows : null,
          -0.7,
          [-2, -0.7, -0.7] as Vec3,
          direction,
          null,
          false,
        ] as const;
        const actual = finiteSolidDdaF32(...args);
        expect(actual).toEqual(finiteSolidDdaF32(...args, false));
        expect(actual).toMatchObject({ kind: 3, reason: 2 });
      }
    });
  }
});

describe("finite DDA geometry against the independent f64 oracle", () => {
  for (const dim of [3, 4] as const) {
    const shape = dim === 3 ? "menger" : "hyperMenger";
    const pose: FiniteSolidPose = {
      ...FINITE_SOLID_IDENTITY_POSE,
      slice: dim === 4 ? -0.5 : 0,
    };
    const rows = dim === 4 ? pose.rows : null;

    it(`${dim}D emits the first outer entry before the exit at every level`, () => {
      for (const level of [0, 1, 2]) {
        const c = buildFiniteSolidConstruction(shape, dim, level);
        const origin: Vec3 = [-2, -0.7, -0.7];
        const direction: Vec3 = [1, 0, 0];
        const expected = finiteSolidNextBoundary(c, pose, origin, direction, {
          inside: false,
        });
        const actual = finiteSolidDdaF32(
          dim,
          level,
          c.half,
          rows,
          pose.slice,
          origin,
          direction,
          null,
          false,
        );
        expect(expected.kind).toBe("boundary");
        if (expected.kind !== "boundary") throw new Error("Missing entry");
        expect(expected.entering).toBe(true);
        expect(actual.kind).toBe(1);
        expect(actual.t).toBe(expected.t);
        expect(actual.normal).toEqual(expected.outwardNormal);
        expect(actual.anchor?.planeIndices).toEqual(
          expected.anchor.planeIndices,
        );
      }
    });

    it(`${dim}D returns the exact first exit from an occupied opaque camera origin`, () => {
      const c = buildFiniteSolidConstruction(shape, dim, 0);
      const origin: Vec3 = [0, 0, 0];
      const direction: Vec3 = [1, 0, 0];
      const expected = finiteSolidNextBoundary(c, pose, origin, direction, {
        inside: true,
      });
      const actual = finiteSolidDdaF32(
        dim,
        0,
        c.half,
        rows,
        pose.slice,
        origin,
        direction,
        null,
        true,
      );
      expect(expected.kind).toBe("boundary");
      if (expected.kind !== "boundary")
        throw new Error("Missing interior exit");
      expect(expected.entering).toBe(false);
      expect(actual.kind).toBe(1);
      expect(actual.t).toBe(expected.t);
      expect(actual.t).toBe(c.half);
      expect(actual.normal).toEqual(expected.outwardNormal);
      // The optical camera contract remains outside: a false claim must
      // refuse this same occupied origin rather than inventing an entry.
      expect(
        finiteSolidDdaF32(
          dim,
          0,
          c.half,
          rows,
          pose.slice,
          origin,
          direction,
          null,
          false,
        ).kind,
      ).toBe(3);
    });

    it(`${dim}D preserves an exit closer than the reconstruction envelope to a different birth face`, () => {
      const c = buildFiniteSolidConstruction(shape, dim, 1);
      const origin: Vec3 = [-0.25, Math.fround(0.25 + 1e-7), 0];
      const direction: Vec3 = [-Math.SQRT1_2, -Math.SQRT1_2, 0];
      const anchor: FiniteSolidAnchor = {
        intrinsicPoint: [...origin, pose.slice],
        planeMask: 1,
        planeIndices: [1, -1, -1, -1],
        cellIndices: [1, 2, 1, dim === 4 ? 0 : -1],
      };
      const expected = finiteSolidNextBoundaryFromAnchor(c, pose, direction, {
        anchor,
        inside: true,
      });
      const actual = finiteSolidDdaF32(
        dim,
        1,
        c.half,
        rows,
        pose.slice,
        origin,
        direction,
        anchor,
        true,
      );
      expect(expected.kind).toBe("boundary");
      if (expected.kind !== "boundary") throw new Error("Missing short exit");
      expect(expected.entering).toBe(false);
      expect(actual.kind).toBe(1);
      expect(actual.t).toBeGreaterThan(0);
      expect(actual.t).toBeLessThan(c.half * 2 ** -22);
      expect(actual.t).toBeCloseTo(expected.t, 12);
      expect(actual.anchor?.planeMask).toBe(2);
      expect(actual.anchor?.planeIndices).toEqual(expected.anchor.planeIndices);
    });

    it(`${dim}D refuses malformed canonical anchors before reconstruction`, () => {
      const c = buildFiniteSolidConstruction(shape, dim, 1);
      const direction: Vec3 = [1, 0, 0];
      const valid: FiniteSolidAnchor = {
        intrinsicPoint: [-0.75, -0.7, -0.7, pose.slice],
        planeMask: 1,
        planeIndices: [0, -1, -1, -1],
        cellIndices: [0, 0, 0, dim === 4 ? 0 : -1],
      };
      const envelope = c.half * 2 ** -22;
      const corruptions: Array<(anchor: FiniteSolidAnchor) => void> = [
        (anchor) => {
          anchor.planeMask = 0;
        },
        (anchor) => {
          anchor.planeMask = 1 << dim;
        },
        (anchor) => {
          anchor.planeIndices[0] = -1;
        },
        (anchor) => {
          anchor.planeIndices[0] = c.gridSize + 1;
        },
        (anchor) => {
          anchor.cellIndices[0] = 2;
        },
        (anchor) => {
          anchor.planeIndices[1] = 0;
        },
        (anchor) => {
          anchor.cellIndices[1] = -1;
        },
        (anchor) => {
          anchor.cellIndices[1] = c.gridSize;
        },
        (anchor) => {
          anchor.intrinsicPoint[0] += 2 * envelope;
        },
        (anchor) => {
          anchor.intrinsicPoint[1] = -c.half - 2 * envelope;
        },
        (anchor) => {
          anchor.intrinsicPoint[1] = -0.25 + 2 * envelope;
        },
        (anchor) => {
          anchor.intrinsicPoint[1] = Number.NaN;
        },
        (anchor) => {
          anchor.intrinsicPoint[1] = Infinity;
        },
      ];
      if (dim === 3)
        corruptions.push(
          (anchor) => {
            anchor.cellIndices[3] = 0;
          },
          (anchor) => {
            anchor.intrinsicPoint[3] = Number.NaN;
          },
          (anchor) => {
            anchor.intrinsicPoint[3] = Infinity;
          },
        );
      for (const corrupt of corruptions) {
        const anchor = structuredClone(valid);
        corrupt(anchor);
        expect(
          finiteSolidNextBoundaryFromAnchor(c, pose, direction, {
            anchor,
            inside: true,
          }),
        ).toMatchObject({ kind: "refused", reason: "invalid-input" });
        expect(
          finiteSolidDdaF32(
            dim,
            1,
            c.half,
            rows,
            pose.slice,
            [0, 0, 0],
            direction,
            anchor,
            true,
          ),
        ).toMatchObject({ kind: 3, reason: 2 });
      }
      const rounded = structuredClone(valid);
      rounded.intrinsicPoint[0] += envelope / 2;
      rounded.intrinsicPoint[1] = -c.half - envelope / 2;
      expect(
        finiteSolidNextBoundaryFromAnchor(c, pose, direction, {
          anchor: rounded,
          inside: true,
        }).kind,
      ).toBe("boundary");
      expect(
        finiteSolidDdaF32(
          dim,
          1,
          c.half,
          rows,
          pose.slice,
          [0, 0, 0],
          direction,
          rounded,
          true,
        ).kind,
      ).toBe(1);
    });

    it(`${dim}D validates the canonical anchor independently of the unused world hit`, () => {
      const c = buildFiniteSolidConstruction(shape, dim, 1);
      const anchorPose: FiniteSolidPose =
        dim === 3
          ? pose
          : {
              rows: [
                [Math.fround(0.8), 0, 0, Math.fround(0.6)],
                [0, 1, 0, 0],
                [0, 0, 1, 0],
                [Math.fround(-0.6), 0, 0, Math.fround(0.8)],
              ],
              slice: Math.fround(0.1),
            };
      const direction: Vec3 = [1, 0, 0];
      const query = (
        origin: Vec3,
        anchor: FiniteSolidAnchor | null,
        inside: boolean,
      ) =>
        finiteSolidDdaF32(
          dim,
          1,
          c.half,
          dim === 4 ? anchorPose.rows : null,
          anchorPose.slice,
          origin,
          direction,
          anchor,
          inside,
        );
      const entry = query([-2, -0.7, -0.7], null, false);
      expect(entry.kind).toBe(1);
      if (!entry.anchor) throw new Error("Entry has no canonical anchor");
      const reference = query([0, 0, 0], entry.anchor, true);
      expect(reference.kind).toBe(1);
      expect(
        query([Number.NaN, Infinity, -Infinity], entry.anchor, true),
      ).toEqual(reference);
    });

    it(`${dim}D refuses degenerate and nonfinite directions before canonical traversal`, () => {
      const root = buildFiniteSolidConstruction(shape, dim, 0);
      const anchor: FiniteSolidAnchor = {
        intrinsicPoint: [-root.half, 0, 0, 0],
        planeMask: 1,
        planeIndices: [0, -1, -1, -1],
        cellIndices: [0, 0, 0, dim === 4 ? 0 : -1],
      };
      const invalidDirections: Vec3[] = [[0, 0, 0]];
      for (let axis = 0; axis < 3; axis++) {
        for (const value of [Number.NaN, Infinity, -Infinity]) {
          const direction: Vec3 = [1, 0, 0];
          direction[axis] = value;
          invalidDirections.push(direction);
        }
      }
      for (const direction of invalidDirections) {
        expect(
          finiteSolidNextBoundaryFromAnchor(
            root,
            FINITE_SOLID_IDENTITY_POSE,
            direction,
            { anchor, inside: true },
          ),
        ).toMatchObject({ kind: "refused", reason: "invalid-input" });
        expect(
          finiteSolidDdaF32(
            dim,
            0,
            root.half,
            dim === 4 ? FINITE_SOLID_IDENTITY_POSE.rows : null,
            0,
            [0, 0, 0],
            direction,
            anchor,
            true,
          ),
        ).toEqual({
          kind: 3,
          reason: 2,
          t: 0,
          normal: [0, 0, 0],
          anchor: null,
        });
      }
    });

    it(`${dim}D starts canonical root-face continuations at zero without reading a world origin`, () => {
      const root = buildFiniteSolidConstruction(shape, dim, 0);
      const unusedOrigin = new Proxy([0, 0, 0] as Vec3, {
        get() {
          throw new Error("A canonical query must not read its world origin");
        },
      });
      for (let axis = 0; axis < dim; axis++) {
        // The final 4D control swaps x/w, so a genuine fourth-axis face
        // has a displayed normal and is reachable in the current slice.
        const facePose: FiniteSolidPose =
          axis === 3
            ? {
                rows: [
                  [0, 0, 0, 1],
                  [0, 1, 0, 0],
                  [0, 0, 1, 0],
                  [1, 0, 0, 0],
                ],
                slice: 0,
              }
            : FINITE_SOLID_IDENTITY_POSE;
        for (const sign of [-1, 1]) {
          const point: Vec4 = [0, 0, 0, 0];
          point[axis] = sign * root.half;
          const planes: [number, number, number, number] = [-1, -1, -1, -1];
          planes[axis] = sign < 0 ? 0 : 1;
          const anchor: FiniteSolidAnchor = {
            intrinsicPoint: point,
            planeMask: 1 << axis,
            planeIndices: planes,
            cellIndices: [0, 0, 0, dim === 4 ? 0 : -1],
          };
          const inward = facePose.rows[axis]
            .slice(0, 3)
            .map((value) => -sign * value) as Vec3;
          const outward = inward.map((value) => -value) as Vec3;
          const tangent: Vec3 = [0, 0, 0];
          tangent[(inward.findIndex((value) => value !== 0) + 1) % 3] = 1;
          for (const [direction, inside, kind, reason] of [
            [inward, true, "boundary", 0],
            [outward, false, "miss", 0],
            [inward, false, "refused", 3],
            [tangent, true, "refused", 4],
          ] as const) {
            const expected = finiteSolidNextBoundaryFromAnchor(
              root,
              facePose,
              direction,
              { anchor, inside },
            );
            expect(expected.kind).toBe(kind);
            const actual = finiteSolidDdaF32(
              dim,
              0,
              root.half,
              dim === 4 ? facePose.rows : null,
              facePose.slice,
              unusedOrigin,
              direction,
              anchor,
              inside,
            );
            expect(actual).toEqual(
              finiteSolidDdaF32(
                dim,
                0,
                root.half,
                dim === 4 ? facePose.rows : null,
                facePose.slice,
                unusedOrigin,
                direction,
                anchor,
                inside,
                false,
              ),
            );
            expect(actual.kind).toBe(
              kind === "boundary" ? 1 : kind === "miss" ? 2 : 3,
            );
            expect(actual.reason).toBe(reason);
            if (expected.kind === "boundary") {
              expect(actual.t).toBe(2 * root.half);
              expect(actual.t).toBe(expected.t);
              expect(actual.normal).toEqual(expected.outwardNormal);
              expect(actual.anchor).toEqual(expected.anchor);
            }
          }
        }
      }
    });

    it(`${dim}D preserves the caller's medium and canonical anchor on reflected and refracted paths`, () => {
      const c = buildFiniteSolidConstruction(shape, dim, 2);
      const chainPose: FiniteSolidPose =
        dim === 3
          ? pose
          : {
              rows: [
                [Math.fround(0.8), 0, 0, Math.fround(0.6)],
                [0, 1, 0, 0],
                [0, 0, 1, 0],
                [Math.fround(-0.6), 0, 0, Math.fround(0.8)],
              ],
              slice: Math.fround(0.1),
            };
      let seed = 7381;
      const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 2 ** 32;
      };
      let boundaries = 0;
      for (let ray = 0; ray < 64; ray++) {
        let origin: Vec3 = [-2, (random() - 0.5) * 1.3, (random() - 0.5) * 1.3];
        let direction: Vec3 = [
          1,
          (random() - 0.5) * 0.2,
          (random() - 0.5) * 0.2,
        ];
        const length = Math.hypot(...direction);
        direction = direction.map((value) =>
          Math.fround(value / length),
        ) as Vec3;
        let inside = false;
        let anchor: FiniteSolidAnchor | null = null;
        for (let step = 0; step < 24; step++) {
          const expected = anchor
            ? finiteSolidNextBoundaryFromAnchor(c, chainPose, direction, {
                anchor,
                inside,
              })
            : finiteSolidNextBoundary(c, chainPose, origin, direction, {
                inside,
              });
          const actual = finiteSolidDdaF32(
            dim,
            2,
            c.half,
            dim === 4 ? chainPose.rows : null,
            chainPose.slice,
            origin,
            direction,
            anchor,
            inside,
          );
          expect(actual).toEqual(
            finiteSolidDdaF32(
              dim,
              2,
              c.half,
              dim === 4 ? chainPose.rows : null,
              chainPose.slice,
              origin,
              direction,
              anchor,
              inside,
              false,
            ),
          );
          expect(actual.kind).toBe(
            expected.kind === "boundary" ? 1 : expected.kind === "miss" ? 2 : 3,
          );
          expect(actual.kind).not.toBe(3);
          if (expected.kind !== "boundary") break;
          boundaries++;
          expect(actual.t).toBeCloseTo(expected.t, 5);
          expect(actual.anchor?.planeMask).toBe(expected.anchor.planeMask);
          expect(actual.anchor?.planeIndices).toEqual(
            expected.anchor.planeIndices,
          );
          expect(actual.anchor?.cellIndices).toEqual(
            expected.anchor.cellIndices,
          );
          if (!actual.anchor) throw new Error("Boundary has no anchor");
          for (let axis = 0; axis < dim; axis++) {
            if ((actual.anchor.planeMask & (1 << axis)) === 0) continue;
            const intrinsicDirection = chainPose.rows[axis]
              .slice(0, 3)
              .reduce(
                (sum, value, component) => sum + value * direction[component],
                0,
              );
            expect(actual.anchor.planeIndices[axis]).toBe(
              actual.anchor.cellIndices[axis] +
                (intrinsicDirection < 0 ? 1 : 0),
            );
          }
          const normal = actual.normal;
          origin = origin.map((value, axis) =>
            Math.fround(value + actual.t * direction[axis]),
          ) as Vec3;
          const refracted = dielectricRefract(
            direction,
            normal,
            inside ? 1.45 : 1,
            inside ? 1 : 1.45,
          );
          if (refracted.tir || random() < 0.3) {
            const dot = direction.reduce(
              (sum, value, axis) => sum + value * normal[axis],
              0,
            );
            direction = direction.map((value, axis) =>
              Math.fround(value - 2 * dot * normal[axis]),
            ) as Vec3;
          } else {
            direction = refracted.direction.map(Math.fround) as Vec3;
            inside = !inside;
          }
          anchor = actual.anchor;
        }
      }
      expect(boundaries).toBeGreaterThan(150);
    });
  }

  it("uses the 4D intrinsic direction when a displayed ray lies entirely on its fourth axis", () => {
    const rows: Vec4[] = [
      [0, 0, 0, 1],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [1, 0, 0, 0],
    ];
    const hit = finiteSolidDdaF32(
      4,
      0,
      0.75,
      rows,
      0,
      [-2, 0, 0],
      [1, 0, 0],
      null,
      false,
    );
    expect(hit.kind).toBe(1);
    expect(hit.t).toBe(1.25);
    expect(hit.anchor?.planeMask).toBe(8);
  });

  it("classifies a point below a grid plane even when its normalized coordinate rounds onto that plane", () => {
    const c = buildFiniteSolidConstruction("menger", 3, 2);
    const origin: Vec3 = [0.2499999850988388, 0, -0.7];
    const direction: Vec3 = [1, 0, 0];
    expect(
      Math.fround(Math.fround(origin[0] + 0.75) / Math.fround(1.5 / 9)),
    ).toBe(6);
    const expected = finiteSolidNextBoundary(
      c,
      FINITE_SOLID_IDENTITY_POSE,
      origin,
      direction,
      { inside: false },
    );
    const actual = finiteSolidDdaF32(
      3,
      2,
      c.half,
      null,
      0,
      origin,
      direction,
      null,
      false,
    );
    expect(expected.kind).toBe("boundary");
    expect(actual.kind).toBe(1);
    expect(actual.t).toBeGreaterThan(0);
    expect(actual.t).toBeLessThan(2e-8);
    expect(actual.anchor?.planeIndices[0]).toBe(6);
  });
});

describe("the finite cores' kernel emission", () => {
  it("uses the qualified finite work limit while preserving explicit bench limits in both dimensions", () => {
    for (const core of ["finite", "finite4"] as const) {
      const options = baseOpts(core, {
        optics: true,
        opticsBackend: "finiteSolid",
      });
      const runtime = surfaceDeKernelWgsl(options);
      const probe = surfaceDeKernelWgsl({ ...options, transportMaxPaths: 128 });
      for (const name of ["PROCESSED", "INTERFACES"]) {
        expect(runtime).toContain(
          `const TRANSPORT_MAX_${name} = ${DIELECTRIC_MAX_PROCESSED_PATHS}u;`,
        );
        expect(probe).toContain(`const TRANSPORT_MAX_${name} = 128u;`);
      }
    }
  });

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
    // The exact query owns the primary interface too, starting with the
    // camera ray and unsplit unit energy.
    expect(src).toContain("primary.finiteMask = 0u;");
    expect(src).toContain("primary.interfaces = 0u;");
    expect(src).toContain("primary.energy = vec3f(1.0);");
    expect(src).not.toContain("let preOrigin =");
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

  it("uses the same exact primary geometry for opaque and glass in both dimensions", () => {
    for (const core of ["finite", "finite4"] as const) {
      for (const rays of ["pose", "unproject"] as const) {
        const options = baseOpts(core, {
          mode: "march",
          rays,
          statusOut: true,
        });
        const src = surfaceDeKernelWgsl(options);
        expect(
          surfaceDeKernelWgsl({
            ...options,
            optics: true,
            opticsBackend: "finiteSolid",
          }),
        ).toBe(src);
        expect(src.match(/fn transportFiniteBoundary\(/g)).toHaveLength(1);
        expect(src).not.toContain("TransportPath");
        for (const binding of [13, 14, 15]) {
          expect(src).not.toContain(`@binding(${binding})`);
        }
        const march = src.slice(src.indexOf("fn marchRays("));
        expect(march).toContain("if (st.y != 0.0)");
        expect(march.indexOf("if (st.y != 0.0)")).toBeLessThan(
          march.indexOf("let primary = transportFiniteBoundary("),
        );
        // One authoritative camera query, with exact initial occupancy so
        // valid opaque interior cameras see the first exit.
        expect(march).toContain("let primaryOrigin = finiteLift(ro);");
        expect(march).toContain("let primaryDir = finiteLiftDir(rd);");
        expect(march).toContain("finiteOccupied(primaryCells)");
        expect(march).toContain(
          "ro, rd, 0u, vec4f(0.0), 0u, vec4i(-1), vec4i(-1), primaryInside,",
        );
        expect(march).toContain("st.x = primary.t;");
        expect(march).not.toContain("surfaceDE(");
        expect(march).not.toContain("params.stepsThisPass");
        expect(march).not.toContain("params.pixelEps");
        expect(march).not.toContain("hash2(");
        expect(march.match(/statusOut\[slotI\] = u32\(st.y\);/g)).toHaveLength(
          2,
        );
        if (rays === "unproject") {
          expect(march).toContain("let sub = shade.pixelJitter;");
          expect(march).toContain(
            "let full = vec2f(f32(px), f32(py)) + shade.bgOffset;",
          );
          expect(march).toContain("(full.x + sub.x) / shade.bgExtent.x");
          expect(march).toContain("(full.y + sub.y) / shade.bgExtent.y");
          expect(march).toContain(
            "normalize(farP.xyz / farP.w - nearP.xyz / nearP.w)",
          );
        }
      }
    }
  });

  it("selects the nearest eligible floor without hiding refused geometry", () => {
    for (const core of ["finite", "finite4"] as const) {
      const src = surfaceDeKernelWgsl(
        baseOpts(core, { mode: "march", groundPlane: true, statusOut: true }),
      );
      expect(src).toContain("ro.y <= params.groundY || rd.y >= -1.0e-6");
      expect(src).toContain(
        "dot(rel, rel) >= params.groundFadeEnd * params.groundFadeEnd",
      );
      const march = src.slice(src.indexOf("fn marchRays("));
      expect(march).toContain(
        "primary.kind != 3u && groundPlaneStatus(ro, rd) == 4.0",
      );
      expect(march).toContain("primary.kind == 2u || planeT < primary.t");
      expect(march).toContain("st.x = planeT;\n      st.y = 4.0;");
      expect(march).toContain("st.y = 3.0;\n    st.w = f32(primary.reason);");
      // A primary refusal remains visible in opaque and optical sessions;
      // the existing host exhausted census reports the failed sample.
      for (const optics of [false, true]) {
        const shade = surfaceDeKernelWgsl(
          baseOpts(core, { optics, opticsBackend: "finiteSolid" }),
        );
        const refused = shade.slice(shade.indexOf("if (st.y == 3.0)"));
        expect(refused.indexOf("return;")).toBeLessThan(
          refused.indexOf("if (st.y != 1.0)"),
        );
        expect(refused.slice(0, refused.indexOf("return;"))).toContain(
          "colorOut[ray] = pack4x8unorm(vec4f(0.0, 0.0, 0.0, 1.0));",
        );
      }
    }
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

// ---------------------------------------------------------------------------
// The general word tree's GPU half: the baked-construction emission and the
// f32 twin, pinned against the f64 oracle (`finite-solid.ts`'s general
// section) and — one cross-construction check — against the shipped grid
// twin on the grid's own maps. The WGSL-vs-twin agreement itself is the
// bench's transport legs (a device question, not a vitest one).
// ---------------------------------------------------------------------------

const noSymmetry = { order: 1, plane: "xz" as const };

const generalSierpinskiWire = (
  level: number,
): FiniteSolidGeneralConstruction => {
  const maps = sierpinskiTetrahedron();
  const analysis = analyzeFiniteSolidGeneral(maps, null, noSymmetry, level, 3);
  if (analysis.status !== "eligible" || !analysis.construction) {
    throw new Error("the Sierpinski fixture must admit");
  }
  return analysis.construction;
};

describe("general finite-solid GPU sources", () => {
  const construction1 = analyzeFiniteSolidGeneral(
    sierpinskiTetrahedron(),
    null,
    noSymmetry,
    1,
    3,
  );
  if (construction1.status !== "eligible" || !construction1.construction) {
    throw new Error("fixture admission failed");
  }
  const wire1 = construction1.construction;
  const wireOf = (
    c: FiniteSolidGeneralConstruction,
  ): FiniteSolidGeneralWire => ({
    mapScale: c.mapScale,
    mapOffset: c.mapOffset,
    rootMin: c.rootMin,
    rootMax: c.rootMax,
  });

  it("bakes the construction into the display source and keeps the shipped entry names", () => {
    for (const dim of [3, 4] as const) {
      const src = finiteSolidGeneralDisplaySource(dim, wireOf(wire1), 1);
      expect(src).toContain("fn surfaceDE(pIn: vec3f, cutoff: f32, li: u32)");
      expect(src).toContain("fn finiteDisplayDE(q: array<f32, 4>)");
      // The construction is baked, not parameterized: the maps and root box
      // ride the source, level and map count are consts.
      expect(src).toContain("const FIN_LEVEL = 1u;");
      expect(src).toContain(
        `const FIN_MAP_COUNT = ${String(wire1.mapCount)}u;`,
      );
      expect(src).toContain("const FIN_SCALE = array<vec4f, 4>(");
      // The certified hybrid's own constants, emitted as literals.
      expect(src).toContain("FIN_REFINE_REL = 0.16666666666666666");
      expect(src).toContain("result * FIN_SAFETY");
      expect(src).toContain("const FIN_TIE_REL = 2.384185791015625e-7");
      expect(src).toMatch(/select\(best, best \* FIN_SAFETY, best > 0\.0\)/);
      // The K-loops over the packed maps, not the ternary grid nests.
      expect(src).toContain("for (var a = 0u; a < FIN_MAP_COUNT; a++)");
      expect(src).not.toContain("params.finiteLevel");
    }
    const src4 = finiteSolidGeneralDisplaySource(4, wireOf(wire1), 1);
    expect(src4).toContain("params.rotorInvR0");
    expect(src4).toContain("params.w0");
    const src3 = finiteSolidGeneralDisplaySource(3, wireOf(wire1), 1);
    expect(src3).toContain("array<f32, 4>(p.x, p.y, p.z, 0.0)");
  });

  it("emits the word-tree walk under the shipped query's name, with the anchor contract and the enumeration cap", () => {
    for (const dim of [3, 4] as const) {
      const src = finiteSolidGeneralTransportSource(dim, wireOf(wire1), 1);
      // The SAME function name the mode-1 record body and march primary
      // call — the emission is either the grid DDA or this walk, never both.
      expect(src).toContain("fn transportFiniteBoundary(");
      expect(src).toContain("fn finEnumerate(");
      expect(src).toContain("fn finSweep(");
      expect(src).toContain("fn finEvent(");
      expect(src).toContain("fn finiteGeneralPointInside(");
      expect(src).toContain("fn finiteBoundaryNormal(");
      // The anchor contract: mask, planes, cells, intrinsic point.
      expect(src).toContain("anchorIntrinsic: vec4f");
      expect(src).toContain("anchorMask: u32");
      expect(src).toContain("anchorPlanes: vec4i");
      expect(src).toContain("anchorCells: vec4i");
      // The walk's declared resolution reads the display source's baked
      // const (the transport consumes it alongside the lift helpers).
      expect(src).toContain("FIN_TIE_REL");
      expect(src).toContain("FIN_TIE_REL * max(1.0, abs(groupT))");
      // The grid arithmetic is absent: no canonical plane formula, no
      // bitmap rule.
      expect(src).not.toContain("finiteGridPlane");
      expect(src).not.toContain("fn finiteOccupied(");
    }
    // The codegen bakes the SMALLER of the construction's own worst case
    // (K^level) and the walk's cap, so small constructions allocate exactly
    // their own bound.
    expect(finiteSolidGeneralTransportSource(3, wireOf(wire1), 1)).toContain(
      `array<vec2f, ${String(wire1.mapCount * 2)}>`,
    );
    expect(finiteSolidGeneralTransportSource(3, wireOf(wire1), 2)).toContain(
      `array<vec2f, ${String(wire1.mapCount ** 2 * 2)}>`,
    );
  });

  it("caps the enumeration at the walk's declared leaf cap", () => {
    const manyMaps: Transform[] = Array.from(
      { length: 40 },
      (_, i): Transform => ({
        id: i,
        position: [i * 0.01, 0, 0],
        rotation: [0, 0, 0],
        scale: [0.5, 0.5, 0.5],
      }),
    );
    const analysis = analyzeFiniteSolidGeneral(
      manyMaps,
      null,
      noSymmetry,
      1,
      3,
    );
    if (analysis.status !== "eligible" || !analysis.construction) {
      throw new Error("the 40-map fixture must admit");
    }
    const src = finiteSolidGeneralTransportSource(
      3,
      wireOf(analysis.construction),
      1,
    );
    // 40 leaves at level 1 — under the walk cap: the construction's own
    // worst case IS the baked cap.
    expect(src).toContain("const FIN_LEAF_CAP = 40u;");
  });
});

describe("general walk f32 twin against the f64 oracle", () => {
  const wire = (level: number): FiniteSolidGeneralWire => {
    const c = generalSierpinskiWire(level);
    return {
      mapScale: c.mapScale,
      mapOffset: c.mapOffset,
      rootMin: c.rootMin,
      rootMax: c.rootMax,
    };
  };
  const tie = (t: number): number =>
    FINITE_SOLID_GENERAL_TIE_REL * Math.max(1, Math.abs(t));

  it("agrees with the oracle on the hand-exact spine ray and its anchored continuation", () => {
    const wire2 = wire(2);
    const origin: Vec3 = [0.5, -2, 0];
    const dir: Vec3 = [0, 1, 0];
    const entry = finiteSolidGeneralDdaF32(
      3,
      2,
      wire2,
      null,
      0,
      origin,
      dir,
      null,
      false,
    );
    expect(entry.kind).toBe(1);
    if (entry.kind !== 1) return;
    const oracleEntry = finiteSolidGeneralNextBoundary(
      generalSierpinskiWire(2),
      FINITE_SOLID_IDENTITY_POSE,
      origin,
      dir,
      { inside: false },
    );
    expect(oracleEntry.kind).toBe("boundary");
    if (oracleEntry.kind !== "boundary") return;
    expect(Math.abs(entry.t - oracleEntry.t)).toBeLessThanOrEqual(1e-6);
    for (let c = 0; c < 3; c++) {
      expect(
        Math.abs(entry.normal[c] - oracleEntry.outwardNormal[c]),
      ).toBeLessThan(1e-6);
    }
    expect(entry.anchor?.planeMask).toBe(oracleEntry.anchor.planeMask);
    for (let a = 0; a < 4; a++) {
      expect(entry.anchor?.planeIndices[a]).toBe(
        oracleEntry.anchor.planeIndices[a],
      );
      expect(entry.anchor?.cellIndices[a]).toBe(
        oracleEntry.anchor.cellIndices[a],
      );
      expect(
        Math.abs(
          entry.anchor!.intrinsicPoint[a] -
            oracleEntry.anchor.intrinsicPoint[a],
        ),
      ).toBeLessThanOrEqual(tie(1));
    }
    // The anchored continuation crosses the interior shared faces SILENTLY
    // (level 2: the self-similar corner repeats twice more) to the true
    // exit — compared against the oracle's own chain, whose continuation
    // from the same anchor is the soundness record.
    const through = finiteSolidGeneralDdaF32(
      3,
      2,
      wire2,
      null,
      0,
      [0, 0, 0],
      dir,
      entry.anchor,
      true,
    );
    expect(through.kind).toBe(1);
    if (through.kind !== 1) return;
    const oracleThrough = finiteSolidGeneralNextBoundaryFromAnchor(
      generalSierpinskiWire(2),
      FINITE_SOLID_IDENTITY_POSE,
      dir,
      { inside: true, anchor: oracleEntry.anchor },
    );
    expect(oracleThrough.kind).toBe("boundary");
    if (oracleThrough.kind !== "boundary") return;
    expect(Math.abs(through.t - oracleThrough.t)).toBeLessThanOrEqual(1e-6);
    for (let c = 0; c < 3; c++) {
      expect(
        Math.abs(through.normal[c] - oracleThrough.outwardNormal[c]),
      ).toBeLessThan(1e-6);
    }
  });

  it("fires honest exits, misses past the solid, and refuses a contradicting claim", () => {
    const wire2 = wire(2);
    // The off-apex ray exits into air at y = 0.4 and never re-enters.
    const exit = finiteSolidGeneralDdaF32(
      3,
      2,
      wire2,
      null,
      0,
      [0.9, -2, 0],
      [0, 1, 0],
      null,
      false,
    );
    expect(exit.kind).toBe(1);
    if (exit.kind !== 1) return;
    expect(exit.t).toBeCloseTo(1.2, 5);
    // The fresh query from the exit point: the open side ahead, a miss —
    // and the claim must match (a fresh inside=true refuses).
    const fresh = finiteSolidGeneralDdaF32(
      3,
      2,
      wire2,
      null,
      0,
      [0.9, 2.4, 0],
      [0, 1, 0],
      null,
      false,
    );
    expect(fresh.kind).toBe(2);
    const wrongClaim = finiteSolidGeneralDdaF32(
      3,
      2,
      wire2,
      null,
      0,
      [0.9, -2, 0],
      [0, 1, 0],
      null,
      true,
    );
    expect(wrongClaim.kind).toBe(3);
    expect(wrongClaim.reason).toBe(3);
  });

  it("round-trips the twin's own anchor out through the anchored continuation, matching the oracle's chain", () => {
    const wire2 = wire(2);
    const dir: Vec3 = [0, 1, 0];
    const entry = finiteSolidGeneralDdaF32(
      3,
      2,
      wire2,
      null,
      0,
      [0.5, -2, 0],
      dir,
      null,
      false,
    );
    if (entry.kind !== 1 || !entry.anchor) throw new Error("entry expected");
    const after = finiteSolidGeneralDdaF32(
      3,
      2,
      wire2,
      null,
      0,
      [0, 0, 0],
      dir,
      entry.anchor,
      true,
    );
    expect(after.kind).toBe(1);
    // The oracle's own chain agrees.
    const oracleEntry = finiteSolidGeneralNextBoundary(
      generalSierpinskiWire(2),
      FINITE_SOLID_IDENTITY_POSE,
      [0.5, -2, 0],
      dir,
      { inside: false },
    );
    if (oracleEntry.kind !== "boundary")
      throw new Error("oracle entry expected");
    const oracleAfter = finiteSolidGeneralNextBoundaryFromAnchor(
      generalSierpinskiWire(2),
      FINITE_SOLID_IDENTITY_POSE,
      dir,
      { inside: true, anchor: oracleEntry.anchor },
    );
    expect(oracleAfter.kind).toBe("boundary");
    if (after.kind !== 1 || oracleAfter.kind !== "boundary") return;
    expect(Math.abs(after.t - oracleAfter.t)).toBeLessThanOrEqual(1e-6);
  });

  it("agrees with the shipped grid twin on the grid's own maps (the cross-construction witness)", () => {
    // The word tree with the shipped Menger maps reproduces the grid's
    // cells (the CPU tests pin the unions); here the two f32 twins agree
    // on sampled rays at level 1 — the same object through two
    // constructions.
    const maps = mengerSponge();
    const general = analyzeFiniteSolidGeneral(maps, null, noSymmetry, 1, 3);
    if (general.status !== "eligible" || !general.construction) {
      throw new Error("the Menger fixture must admit");
    }
    const wire1 = {
      mapScale: general.construction.mapScale,
      mapOffset: general.construction.mapOffset,
      rootMin: general.construction.rootMin,
      rootMax: general.construction.rootMax,
    };
    const rays: Array<[Vec3, Vec3]> = [
      [
        [0.1, -2, 0.05],
        [0, 1, 0],
      ],
      [
        [-0.6, 0.2, -0.3],
        [1, 0.1, 0.05],
      ],
      [
        [0.4, 0.4, -2],
        [0, 0, 1],
      ],
      [
        [-2, -0.75, -0.75],
        [1, 0, 0],
      ],
    ];
    for (const [origin, dir] of rays) {
      const grid = finiteSolidDdaF32(
        3,
        1,
        0.75,
        null,
        0,
        origin,
        dir,
        null,
        false,
      );
      const tree = finiteSolidGeneralDdaF32(
        3,
        1,
        wire1,
        null,
        0,
        origin,
        dir,
        null,
        false,
      );
      expect(tree.kind).toBe(grid.kind);
      expect(tree.reason).toBe(grid.reason);
      if (tree.kind === 1 && grid.kind === 1) {
        expect(Math.abs(tree.t - grid.t)).toBeLessThan(1e-6);
        for (let c = 0; c < 3; c++) {
          expect(Math.abs(tree.normal[c] - grid.normal[c])).toBeLessThan(1e-5);
        }
      }
    }
  });
});
