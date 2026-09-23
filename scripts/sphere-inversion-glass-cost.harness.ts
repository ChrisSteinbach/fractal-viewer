/**
 * WHERE THE CURVED-GLASS TRANSPORT SPENDS ITS FIELD EVALUATIONS — a CPU
 * profile of the kernel's schedule, taken through the f64 transport twin
 * (`surface-transport-fixture.ts`, which mirrors the WGSL boundary query and
 * trace term for term) over the `glassPearls` starter at its saved view.
 *
 * It prices nothing a GPU pays in milliseconds. What it measures is the
 * SCHEDULE: how many signed-field and membership evaluations each replay
 * pass, each query outcome and each medium costs, and how many of them are
 * repeats at a point already evaluated. The GPU runs the same schedule, so
 * the shares transfer even where the absolute cost does not.
 *
 * Run: npx vitest run --config scripts/vitest.harness.config.ts \
 *        scripts/sphere-inversion-glass-cost.harness.ts
 */
import { PREVIEW_HIT, renderPreview, type Vec3 } from "./de-preview";
import { resolveSphereInversion } from "../src/fractal/sphere-inversion";
import {
  buildSphereInversionDE,
  estimateSphereInversionDistance,
  sphereInversionContains,
  sphereInversionSignedDistance,
} from "../src/fractal/sphere-inversion-de";
import {
  DIELECTRIC_ABSORPTION,
  DIELECTRIC_ERROR_BUDGET,
  DIELECTRIC_INITIAL_BRANCH_THETA,
  DIELECTRIC_IOR,
  DIELECTRIC_REPLAY_PASSES,
  type DielectricMaterial,
} from "../src/fractal/surface-dielectric";
import {
  transportSolidBoundaryQueryCPU,
  transportTraceCPU,
  type TransportFixtureSystem,
} from "../src/app/gpu-bench/surface-transport-fixture";
import { PRESET_SPHERE_INVERSIONS, PRESET_VIEWS } from "../src/fractal/presets";

const SIZE = Number(process.env.SIGC_SIZE ?? 64);

interface Tally {
  fieldIn: number;
  fieldOut: number;
  contains: number;
  /** Field or membership evaluations at the point the previous
   * evaluation (of either kind) was taken — the repeats a fused
   * field+membership sample would not pay. */
  repeat: number;
  fieldNsIn: number;
  fieldNsOut: number;
  containsNs: number;
}

function zero(): Tally {
  return {
    fieldIn: 0,
    fieldOut: 0,
    contains: 0,
    repeat: 0,
    fieldNsIn: 0,
    fieldNsOut: 0,
    containsNs: 0,
  };
}

describe("sphere-inversion glass: the transport's evaluation profile", () => {
  it("profiles glassPearls at its saved view", () => {
    const authored = PRESET_SPHERE_INVERSIONS.glassPearls!();
    const resolved = resolveSphereInversion(authored);
    if (!resolved.ok || resolved.construction.dim !== 3)
      throw new Error("glassPearls did not resolve to a 3D construction");
    const de = buildSphereInversionDE(resolved.construction);
    const radius = de.boundingRadius;
    // |f| in crossing eps: < 1 (the band and its taps), 1-4, 4-32, >= 32.
    const magIn = [0, 0, 0, 0];
    const magOut = [0, 0, 0, 0];
    const ring: ({ p: Vec3; v: number } | undefined)[] = [];
    let ringAt = 0;
    let cur = zero();
    let last: Vec3 | null = null;
    const same = (p: Vec3) =>
      last !== null && p[0] === last[0] && p[1] === last[1] && p[2] === last[2];
    const system: TransportFixtureSystem = {
      estimate: (p) => {
        // The twin's normal recomputes each tetrahedron tap per gradient
        // component (twelve calls); the kernel evaluates four. A call at
        // the point four estimate calls back is exactly such a duplicate:
        // answer it without counting, so the tally is the kernel's.
        const back = ring[ringAt % 4];
        if (
          back !== undefined &&
          back.p[0] === p[0] &&
          back.p[1] === p[1] &&
          back.p[2] === p[2]
        ) {
          ring[ringAt % 4] = back;
          ringAt++;
          return back.v;
        }
        if (same(p)) cur.repeat++;
        last = [p[0], p[1], p[2]];
        const t0 = process.hrtime.bigint();
        const v = sphereInversionSignedDistance(de, p);
        const ns = Number(process.hrtime.bigint() - t0);
        const r = Math.abs(v) / (radius / 512);
        const b = r < 1 ? 0 : r < 4 ? 1 : r < 32 ? 2 : 3;
        (v < 0 ? magIn : magOut)[b]++;
        ring[ringAt % 4] = { p: [p[0], p[1], p[2]], v };
        ringAt++;
        if (v < 0) {
          cur.fieldIn++;
          cur.fieldNsIn += ns;
        } else {
          cur.fieldOut++;
          cur.fieldNsOut += ns;
        }
        return v;
      },
      contains: (p) => {
        if (same(p)) cur.repeat++;
        last = [p[0], p[1], p[2]];
        const t0 = process.hrtime.bigint();
        const v = sphereInversionContains(de, p);
        cur.containsNs += Number(process.hrtime.bigint() - t0);
        cur.contains++;
        return v;
      },
      stepScale: 1,
      visibleRadius: radius,
    };
    const material: DielectricMaterial = {
      ior: DIELECTRIC_IOR,
      absorption: DIELECTRIC_ABSORPTION,
      radius,
    };
    // Per query outcome × medium, and per replay pass.
    const byQuery = new Map<string, Tally & { queries: number }>();
    const byPass: (Tally & { traces: number; paths: number })[] = [];
    for (let i = 0; i < DIELECTRIC_REPLAY_PASSES; i++)
      byPass.push({ ...zero(), traces: 0, paths: 0 });
    let passIndex = 0;
    const add = (a: Tally, b: Tally) => {
      for (const k of Object.keys(b) as (keyof Tally)[]) a[k] += b[k];
    };
    const query = (
      origin: Vec3,
      dir: Vec3,
      anchorPresent: boolean,
      anchorPoint: Vec3,
      inside: boolean,
      eps: number,
    ) => {
      const outer = cur;
      cur = zero();
      const r = transportSolidBoundaryQueryCPU(
        system,
        origin,
        dir,
        anchorPresent,
        anchorPoint,
        inside,
        eps,
      );
      const key = `${r.kind}${r.kind === "refused" ? `:${String(r.reason)}` : ""} ${inside ? "inside" : "outside"}`;
      const row = byQuery.get(key) ?? { ...zero(), queries: 0 };
      add(row, cur);
      row.queries++;
      byQuery.set(key, row);
      add(outer, cur);
      cur = outer;
      byPass[passIndex].paths++;
      return r;
    };
    const unresolvedByReason = new Map<string, number>();
    let glass = 0;
    // The replay-monotonicity check: a trace that FAILED (unresolved) at
    // some pass and was accepted at a later one.
    let acceptedAfterFailure = 0;
    // Evaluations spent re-tracing a trace that had already failed — what
    // the failure-is-final rule removes.
    let wastedEvals = 0;
    const firstFailure = new Map<number, number>();
    let resolvedCount = 0;
    const view = PRESET_VIEWS.glassPearls!;
    renderPreview(
      {
        de: (p) => estimateSphereInversionDistance(de, p, 0),
        boundingRadius: radius,
        stepScale: 1,
        eye: [...view.camera.eye] as Vec3,
        target: [...view.camera.target] as Vec3,
        zoom: Math.tan((view.camera.fov * Math.PI) / 360),
        maxSteps: 400,
        ao: false,
        shadow: false,
        rayLinear: (ray) => {
          if (ray.status !== PREVIEW_HIT) return [0, 0, 0];
          glass++;
          const start: Vec3 = [
            ray.origin[0] + ray.rd[0] * ray.distance,
            ray.origin[1] + ray.rd[1] * ray.distance,
            ray.origin[2] + ray.rd[2] * ray.distance,
          ];
          let theta = DIELECTRIC_INITIAL_BRANCH_THETA;
          let failedAt = -1;
          for (
            passIndex = 0;
            passIndex < DIELECTRIC_REPLAY_PASSES;
            passIndex++
          ) {
            cur = zero();
            last = null;
            const res = transportTraceCPU(
              system,
              start,
              ray.rd,
              theta,
              material,
              [0.2, 0.2, 0.2],
              undefined,
              query,
            );
            const row = byPass[passIndex];
            add(row, cur);
            if (failedAt >= 0)
              wastedEvals += cur.fieldIn + cur.fieldOut + cur.contains;
            row.traces++;
            if (res.status === "complete" || res.status === "residual") {
              if (res.residual <= DIELECTRIC_ERROR_BUDGET) {
                if (failedAt >= 0) acceptedAfterFailure++;
                resolvedCount++;
                return [0, 0, 0];
              }
            } else {
              // The kernel retries an unresolved trace at the next pass
              // too; only the last pass's status is final.
              if (failedAt < 0) {
                failedAt = passIndex;
                firstFailure.set(
                  passIndex,
                  (firstFailure.get(passIndex) ?? 0) + 1,
                );
              }
              if (passIndex + 1 >= DIELECTRIC_REPLAY_PASSES) {
                const why = `${res.status} f${String(res.failure)}/r${String(res.reason)}`;
                unresolvedByReason.set(
                  why,
                  (unresolvedByReason.get(why) ?? 0) + 1,
                );
                return [0, 0, 0];
              }
            }
            theta *= 0.5;
          }
          unresolvedByReason.set(
            "residual f0/r0",
            (unresolvedByReason.get("residual f0/r0") ?? 0) + 1,
          );
          return [0, 0, 0];
        },
      },
      SIZE,
    );
    const evals = (t: Tally) => t.fieldIn + t.fieldOut + t.contains;
    const ns = (t: Tally) => t.fieldNsIn + t.fieldNsOut + t.containsNs;
    const all = zero();
    for (const p of byPass) add(all, p);
    const pct = (a: number, b: number) =>
      b > 0 ? `${((100 * a) / b).toFixed(1)}%` : "-";
    console.log(
      `glassPearls ${String(SIZE)}px: glass hits ${String(glass)}, resolved ${String(resolvedCount)}`,
    );
    console.log(
      `unresolved: ${[...unresolvedByReason].map(([k, v]) => `${k} ${String(v)}`).join(", ")}`,
    );
    console.log(
      `evaluations ${String(evals(all))}: field inside ${pct(all.fieldIn, evals(all))}, field outside ${pct(all.fieldOut, evals(all))}, membership ${pct(all.contains, evals(all))}; repeats at the previous point ${pct(all.repeat, evals(all))}`,
    );
    console.log(
      `CPU time: field inside ${pct(all.fieldNsIn, ns(all))}, field outside ${pct(all.fieldNsOut, ns(all))}, membership ${pct(all.containsNs, ns(all))}; ns/eval inside ${(all.fieldNsIn / Math.max(1, all.fieldIn)).toFixed(0)}, outside ${(all.fieldNsOut / Math.max(1, all.fieldOut)).toFixed(0)}, membership ${(all.containsNs / Math.max(1, all.contains)).toFixed(0)}`,
    );
    console.log(
      `first failure by pass: ${[...firstFailure].map(([k, v]) => `pass ${String(k)} ${String(v)}`).join(", ")}; accepted after a failure: ${String(acceptedAfterFailure)}; re-tracing failed traces ${pct(wastedEvals, evals(all))} of evaluations`,
    );
    console.log(
      `|f|/eps buckets <1, 1-4, 4-32, >=32: inside ${magIn.join(" / ")}, outside ${magOut.join(" / ")}`,
    );
    for (let i = 0; i < byPass.length; i++) {
      const p = byPass[i];
      console.log(
        `pass ${String(i)}: traces ${String(p.traces)}, paths ${String(p.paths)}, evals ${String(evals(p))} (${pct(evals(p), evals(all))}), CPU ${pct(ns(p), ns(all))}`,
      );
    }
    for (const [k, r] of [...byQuery].sort((a, b) => ns(b[1]) - ns(a[1]))) {
      console.log(
        `query ${k}: ${String(r.queries)} queries, ${(evals(r) / r.queries).toFixed(1)} evals/query (field ${((r.fieldIn + r.fieldOut) / r.queries).toFixed(1)}, membership ${(r.contains / r.queries).toFixed(1)}), CPU ${pct(ns(r), ns(all))}`,
      );
    }
    expect(glass).toBeGreaterThan(0);
  });
});
