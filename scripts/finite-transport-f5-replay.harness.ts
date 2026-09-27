/**
 * THE INSIDE-MISS REPLAY: the app's own failing rays, replayed through the
 * fixture. `?surfacetransportdump` makes the compute transport log one
 * 12-vec4 record per failing trace through the frame trace (the kernel's
 * own f32 view of the failing path); this sheet parses those lines from a
 * saved gate trace and re-queries each dumped (origin, dir, anchor, claim)
 * through the f64 oracle (`transportFiniteGeneralBoundaryQueryCPU`) and
 * the f32 twin (`finiteSolidGeneralDdaF32`) — the exclusion record's next
 * instrument, aimed exactly where the corner/random probes could not
 * reach: the trace's own mid-path states.
 *
 * Run:
 *   npx vitest run --config scripts/vitest.harness.config.ts \
 *     scripts/finite-transport-f5-replay.harness.ts
 * Env: F5_TRACE=path (default the boot-document leg's saved trace),
 *      F5_DEPTH (default 3), F5_ONLY=f5|all (default f5).
 */
import { readFileSync } from "node:fs";
import { defaultTransforms } from "../src/fractal/presets";
import {
  finiteSolidGeneralSlots,
  surfaceSlotMaterials,
} from "../src/app/surface-slots";
import {
  analyzeFiniteSolidGeneral,
  FINITE_SOLID_IDENTITY_POSE,
  finiteSolidGeneralBoundingRadius,
  finiteSolidGeneralOpticsRadius,
  type FiniteSolidAnchor,
  type FiniteSolidGeneralConstruction,
} from "../src/fractal/finite-solid";
import { finiteSolidGeneralDdaF32 } from "../src/fractal/surface-finite-solid-gpu";
import { buildSurfaceDE } from "../src/fractal/surface-de";
import { buildFiniteSolidOpaqueContent } from "../src/fractal/finite-solid-composite";
import {
  transportCompositeOpaqueMarch,
  transportFiniteGeneralBoundaryQueryCPU,
  transportOpaqueControlRadiance,
  transportTraceCPU,
} from "../src/app/gpu-bench/surface-transport-fixture";
import { DIELECTRIC_IOR } from "../src/fractal/surface-dielectric";
import type { Vec3, Vec4 } from "../src/fractal/types";

const TRACE_PATH =
  process.env.F5_TRACE ??
  "scripts/out/glass-media-rotating-boot-document-glass.trace.txt";
const DEPTH = Number(process.env.F5_DEPTH ?? 3);
/** The gate leg's glass maps: the default document's dielectric maps. */
const GLASS_MAPS = [0, 2];

/** The record carries u32s bitcast to f32: recover the bits from the
 * printed decimal's f32 value (toExponential(9) round-trips f32). */
const bitcast = (small: number): number => {
  const dv = new DataView(new ArrayBuffer(4));
  dv.setFloat32(0, small);
  return dv.getUint32(0);
};

describe("inside-miss replay: the kernel's own failing paths", () => {
  const build = () => {
    const maps = defaultTransforms().map((t, i) => ({
      ...t,
      optics: GLASS_MAPS.includes(i)
        ? { model: "dielectric" as const }
        : undefined,
    }));
    const analysis = analyzeFiniteSolidGeneral(
      maps,
      null,
      { order: 1, plane: "xz" },
      DEPTH,
      3,
    );
    if (analysis.status !== "eligible" || !analysis.construction) {
      throw new Error(`refused: ${analysis.reasons.join("; ")}`);
    }
    const construction: FiniteSolidGeneralConstruction = analysis.construction;
    const opticsRadius = finiteSolidGeneralOpticsRadius(construction);
    const slots = finiteSolidGeneralSlots(maps);
    const materials = surfaceSlotMaterials(
      maps,
      slots,
      undefined,
      opticsRadius,
      true,
    );
    if (!materials?.optics) throw new Error("no optics");
    return { construction, materials };
  };

  it(
    "resolves (or reproduces) every dumped failing query on both engines",
    { timeout: 600_000 },
    () => {
      const { construction, materials } = build();
      // The boot leg's own wire: glass on the dielectric maps, code 1, the
      // rest opaque (code 0) — mediaCodes [1,0,1,0] on the session probe.
      const media = defaultTransforms().map((_, i) =>
        GLASS_MAPS.includes(i) ? 1 : 0,
      );
      void materials;
      const lines = readFileSync(TRACE_PATH, "utf8").split("\n");
      const records: {
        ray: number;
        origin: Vec3;
        dir: Vec3;
        theta: number;
        pass: number;
        path: number[];
        anchor: number[];
      }[] = [];
      for (const line of lines) {
        const m =
          /transport f5 ray=(\d+) primary=\[([^\]]+)\] dir=\[([^\]]+)\] theta=(\S+) pass=(\S+) path=\[([^\]]+)\] anchor=\[([^\]]+)\]/.exec(
            line,
          );
        if (!m) continue;
        const num = (s: string) => s.split(",").map(Number);
        records.push({
          ray: Number(m[1]),
          origin: num(m[2]) as unknown as Vec3,
          dir: num(m[3]) as unknown as Vec3,
          theta: Number(m[4]),
          pass: Number(m[5]),
          path: num(m[6]),
          anchor: num(m[7]),
        });
      }
      console.log(`parsed ${records.length} f5 record(s) from ${TRACE_PATH}`);
      expect(records.length).toBeGreaterThan(0);

      let f64Miss = 0;
      let f32Miss = 0;
      let bothResolve = 0;
      let reproduced = 0;
      const opaqueContent = buildFiniteSolidOpaqueContent(
        construction,
        media,
        buildSurfaceDE(defaultTransforms()),
      );
      const material = {
        ior: DIELECTRIC_IOR,
        absorption: [0.02, 0.02, 0.02] as Vec3,
        radius: finiteSolidGeneralOpticsRadius(construction),
      };
      for (const r of records) {
        const inside = bitcast(r.path[3]);
        const interfaces = bitcast(r.path[7]);
        // The record's anchor window (24 words): R4 the intrinsic point,
        // R5/R6 plane/cell indices, R7 anchorPresent/exitPresent/mask/eps,
        // R8 the walk's miss answer, R9 the miss's own anchor-intrinsic.
        const anchor: FiniteSolidAnchor = {
          intrinsicPoint: r.anchor.slice(0, 3).concat(0) as Vec4,
          planeMask: bitcast(r.anchor[14]),
          planeIndices: r.anchor.slice(4, 8) as unknown as [
            number,
            number,
            number,
            number,
          ],
          cellIndices: r.anchor.slice(8, 12) as unknown as [
            number,
            number,
            number,
            number,
          ],
        };
        const claim = inside;
        const f64 = transportFiniteGeneralBoundaryQueryCPU(
          construction,
          FINITE_SOLID_IDENTITY_POSE,
          media,
          true,
          r.path.slice(0, 3) as Vec3,
          r.path.slice(4, 7) as Vec3,
          anchor,
          claim,
        );
        const rows: Vec4[] = [
          [1, 0, 0, 0],
          [0, 1, 0, 0],
          [0, 0, 1, 0],
          [0, 0, 0, 1],
        ];
        const wire = { ...construction, media };
        const f32 = finiteSolidGeneralDdaF32(
          3,
          DEPTH,
          wire,
          rows,
          0,
          r.path.slice(0, 3) as Vec3,
          r.path.slice(4, 7) as Vec3,
          anchor,
          claim,
        );
        const f64Kind = f64.kind;
        const f32Kind =
          f32.kind === 1 ? "boundary" : f32.kind === 2 ? "miss" : "refused";
        // The kernel's own retry arm: the UNANCHORED re-query from the same
        // origin with the same claim — what the work-list's miss-retry sees.
        const u64 = transportFiniteGeneralBoundaryQueryCPU(
          construction,
          FINITE_SOLID_IDENTITY_POSE,
          media,
          true,
          r.path.slice(0, 3) as Vec3,
          r.path.slice(4, 7) as Vec3,
          null,
          claim,
        );
        const u32r = finiteSolidGeneralDdaF32(
          3,
          DEPTH,
          wire,
          rows,
          0,
          r.path.slice(0, 3) as Vec3,
          r.path.slice(4, 7) as Vec3,
          null,
          claim,
        );
        const u32Kind =
          u32r.kind === 1 ? "boundary" : u32r.kind === 2 ? "miss" : "refused";
        console.log(
          `ray=${r.ray} claim=${claim} interfaces=${interfaces} anchorPresent=${bitcast(r.anchor[12])} ` +
            `mask=${bitcast(r.anchor[14])} | f64=${f64Kind}${f64.kind === "refused" ? `:${f64.reason}` : ""} ` +
            `f32=${f32Kind}${f32Kind === "refused" ? `:${f32.reason}` : ""}` +
            ` geometryMedium=${f64.kind === "refused" ? f64.toMedium : "-"}` +
            ` | unanchored f64=${u64.kind}${u64.kind === "refused" ? `:${u64.reason}` : ""} f32=${u32Kind}`,
        );
        if (f64.kind === "miss" || f64.kind === "refused") f64Miss++;
        if (f32Kind === "miss" || f32Kind === "refused") f32Miss++;
        if (f64.kind === "boundary" && f32Kind === "boundary") bothResolve++;
        // THE FULL-TRACE REPLAY from the primary (the camera ray): the
        // fixture's own transport, whose per-path query log reconstructs
        // the walk's route to the failing state.
        const traceMedia = {
          material: () => ({
            ior: DIELECTRIC_IOR,
            absorption: [0.02, 0.02, 0.02] as Vec3,
            radius: finiteSolidGeneralOpticsRadius(construction),
          }),
          opaque: transportOpaqueControlRadiance,
          opaqueMarch: transportCompositeOpaqueMarch(
            opaqueContent,
            FINITE_SOLID_IDENTITY_POSE,
            finiteSolidGeneralBoundingRadius(construction),
          ),
        };
        const trace = transportTraceCPU(
          { estimate: () => 1, stepScale: 1, visibleRadius: 4 },
          r.origin,
          r.dir,
          r.theta,
          material,
          [0.1, 0.1, 0.1],
          undefined,
          undefined,
          (origin, dir, anchor, claim) => {
            const q = transportFiniteGeneralBoundaryQueryCPU(
              construction,
              FINITE_SOLID_IDENTITY_POSE,
              media,
              true,
              origin,
              dir,
              anchor,
              claim,
            );
            console.log(
              `  [ray=${r.ray}] o=(${origin.map((v) => v.toFixed(9)).join(",")}) d=(${dir.map((v) => v.toFixed(6)).join(",")}) ` +
                `anc=${anchor ? 1 : 0} claim=${typeof claim === "number" ? claim : claim ? 1 : 0} -> ${q.kind}` +
                `${q.kind === "refused" ? `:${q.reason}` : ""}${q.kind === "boundary" ? ` t=${q.t.toExponential(6)}` : ""}`,
            );
            return q;
          },
          traceMedia,
        );
        console.log(
          `  trace ray=${r.ray}: ${JSON.stringify({ status: trace.status, failure: (trace as { failure?: number }).failure })}`,
        );
        if (
          trace.status === "unresolved" &&
          (trace as { failure?: number }).failure === 5
        )
          reproduced++;
      }
      console.log(
        `f64 misses=${f64Miss} f32 misses=${f32Miss} both-resolve=${bothResolve} ` +
          `full-trace-reproduced=${reproduced} of ${records.length}`,
      );
      // Every record is accounted for on BOTH engines: a twin that silently
      // resolved where the kernel missed would hide the divergence this
      // sheet exists to catch. The reproduced count is the twin's own
      // full-trace verdict on the same primary rays.
      expect(f64Miss + bothResolve).toBe(records.length);
      expect(f32Miss + bothResolve + 0).toBe(records.length);
    },
  );
});
