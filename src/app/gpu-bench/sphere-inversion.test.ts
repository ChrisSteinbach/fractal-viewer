import { SPHERE_INVERSION_GPU_SLACK } from "../../fractal/surface-sphere-inversion-gpu";
import {
  packSphereInversionGpuTables,
  sphereInversionF32,
} from "../../fractal/surface-sphere-inversion-gpu";
import {
  SURFACE_GPU_RAY_HIT,
  SURFACE_GPU_RAY_MISS,
} from "../../fractal/surface-de-gpu";
import {
  SI_BENCH_DEEP_QUERIES,
  SI_BENCH_MARCH_QUERIES,
  SI_BENCH_UNIFORM_QUERIES,
  buildSphereInversionBenchRows,
  compareSphereInversionEval,
  compareSphereInversionFlat,
  compareSphereInversionMarch,
  liftSphereInversionQuery,
  sphereInversionBenchFixtures,
  sphereInversionBenchPose,
  sphereInversionCpuMarch,
  sphereInversionInvProjView,
  sphereInversionUnprojectRay,
} from "./sphere-inversion";
import type { SiBenchRow } from "./sphere-inversion";

// The section's own tolerance (gpu-bench/main.ts's surfaceEvalTol).
const tol = (cpu: number, R: number) =>
  Math.max(2e-4 * R, 2e-3 * Math.max(Math.abs(cpu), 0.05 * R));

let rows: SiBenchRow[] | null = null;
function benchRows(): SiBenchRow[] {
  rows ??= buildSphereInversionBenchRows();
  return rows;
}

describe("sphere-inversion bench fixtures", () => {
  it("builds every planned row with 700 deterministic queries in its query-space ball", () => {
    const a = benchRows();
    const b = buildSphereInversionBenchRows();
    expect(a.map((r) => r.fixture.name)).toEqual(
      sphereInversionBenchFixtures().map((f) => f.name),
    );
    const n =
      SI_BENCH_UNIFORM_QUERIES + SI_BENCH_DEEP_QUERIES + SI_BENCH_MARCH_QUERIES;
    for (let i = 0; i < a.length; i++) {
      expect(a[i].queries).toHaveLength(n);
      expect(b[i].queries).toEqual(a[i].queries);
      for (const p of a[i].queries) {
        expect(Math.hypot(...p)).toBeLessThanOrEqual(a[i].visR * 1.0201);
      }
    }
  });

  it("clears every row's own anti-vacuity floors on the CPU attribution", () => {
    for (const row of benchRows()) {
      const { census } = row;
      const { floors } = row.fixture;
      expect([row.fixture.name, census.foldK3 >= floors.foldK3]).toEqual([
        row.fixture.name,
        true,
      ]);
      expect([row.fixture.name, census.copyWins >= floors.copyWins]).toEqual([
        row.fixture.name,
        true,
      ]);
      expect([row.fixture.name, census.gapWins >= floors.gapWins]).toEqual([
        row.fixture.name,
        true,
      ]);
    }
  });

  it("the flat 4D reduction reuses the 3D pearls' queries and matches its oracle bit for bit", () => {
    const all = benchRows();
    const flat = all.find((r) => r.fixture.name === "siFlat4")!;
    const pearls = all.find((r) => r.fixture.name === "siOct6Pearls3")!;
    expect(flat.queries).toEqual(pearls.queries);
    expect(flat.cpu).toEqual(pearls.cpu);
  });

  it("the f32 twin on each row's packed tables passes the row's own gates (the kernel's logic without a device)", () => {
    for (const row of benchRows()) {
      const gpu = packSphereInversionGpuTables(row.de);
      const values = row.queries.map((p) => {
        const q = row.view4 ? liftF32(row, p) : p;
        return sphereInversionF32(gpu, q).d;
      });
      const result = compareSphereInversionEval(row, values, tol);
      expect([
        row.fixture.name,
        result.failures,
        result.oneSidedFailures,
      ]).toEqual([row.fixture.name, 0, 0]);
    }
  });
});

function liftF32(row: SiBenchRow, p: readonly number[]): number[] {
  const f = Math.fround;
  const rot = Array.from(row.view4!.rotor, f);
  const pv = [f(p[0]), f(p[1]), f(p[2]), f(row.view4!.w0)];
  return [0, 1, 2, 3].map((i) =>
    f(
      f(f(f(rot[i] * pv[0]) + f(rot[4 + i] * pv[1])) + f(rot[8 + i] * pv[2])) +
        f(rot[12 + i] * pv[3]),
    ),
  );
}

describe("sphere-inversion bench comparators", () => {
  it("fails the one-sided gate on an overshoot the value tolerance would absorb", () => {
    const row = benchRows()[0];
    const over = row.cpu.map((c) =>
      c > 0 ? c + 2 * SPHERE_INVERSION_GPU_SLACK : c,
    );
    const result = compareSphereInversionEval(row, over, tol);
    expect(result.failures).toBe(0);
    expect(result.oneSidedFailures).toBeGreaterThan(0);
    expect(result.pass).toBe(false);
    const under = row.cpu.map((c) =>
      c > 0 ? Math.max(0, c - SPHERE_INVERSION_GPU_SLACK) : c,
    );
    expect(compareSphereInversionEval(row, under, tol).pass).toBe(true);
  });

  it("reports the pre-slack f32 overshoot, not the clamp-pinned margin", () => {
    const row = benchRows()[0];
    // A kernel whose f32 bound ran 3e-7 over f64 before the slack.
    const gpu = row.cpu.map((c) =>
      Math.max(0, c + 3e-7 - SPHERE_INVERSION_GPU_SLACK),
    );
    const result = compareSphereInversionEval(row, gpu, tol);
    expect(result.maxRawExcess).toBeCloseTo(3e-7, 12);
    expect(result.rawExcessQueries).toBeGreaterThan(0);
    expect(result.maxPositiveExcess).toBeLessThanOrEqual(0);
  });

  it("names the floors a vacuous row misses", () => {
    const row = benchRows()[0];
    const result = compareSphereInversionEval(
      { ...row, census: { ...row.census, gapWins: -1 } },
      row.cpu,
      tol,
    );
    expect(result.vacuous).toEqual(["gapWins"]);
    expect(result.pass).toBe(false);
  });

  it("the flat cross-check counts deltas past its tolerance", () => {
    expect(compareSphereInversionFlat([0, 1, 2], [0, 1 + 5e-7, 2.1])).toEqual({
      n: 3,
      maxDelta: expect.closeTo(0.1, 9) as number,
      mismatches: 1,
    });
  });

  it("the 4D lift is the rotor's row convention: identity with w0 appends w0", () => {
    const row = benchRows().find(
      (r) => r.fixture.name === "si600Medallion4@WKISS",
    )!;
    expect(liftSphereInversionQuery(row.view4!, [0.1, 0.2, 0.3])).toEqual([
      0.1,
      0.2,
      0.3,
      row.view4!.w0,
    ]);
  });
});

describe("sphere-inversion bench camera and march emulator", () => {
  it("the centre pixel's unprojected ray points along the camera's forward axis", () => {
    const row = benchRows()[0];
    const pose = sphereInversionBenchPose(row, 97, 55);
    const inv = sphereInversionInvProjView(row, pose);
    const rd = sphereInversionUnprojectRay(inv, 48, 27, 97, 55);
    // f32 matrix entries at near = R·1e-3 cost a few ulps of the direction.
    for (let a = 0; a < 3; a++) expect(rd[a]).toBeCloseTo(pose.fwd[a], 4);
  });

  it("a march raster compared against its own emulator has no failures, and a flipped ray is caught", () => {
    const row = benchRows()[1];
    const pose = sphereInversionBenchPose(row, 24, 14);
    const inv = sphereInversionInvProjView(row, pose);
    const ro: [number, number, number] = [
      Math.fround(pose.ro[0]),
      Math.fround(pose.ro[1]),
      Math.fround(pose.ro[2]),
    ];
    const states = new Float32Array(24 * 14 * 4);
    for (let py = 0; py < 14; py++) {
      for (let px = 0; px < 24; px++) {
        const rd = sphereInversionUnprojectRay(inv, px, py, 24, 14);
        const m = sphereInversionCpuMarch(row, ro, rd, pose.pixelEps);
        states[(py * 24 + px) * 4] = m.t;
        states[(py * 24 + px) * 4 + 1] = m.status;
      }
    }
    const clean = compareSphereInversionMarch(row, pose, inv, states, tol);
    expect(clean.failures).toBe(0);
    expect(clean.cpuHits).toBeGreaterThan(0);
    expect(clean.cpuHits).toBeLessThan(clean.rays);
    // A decisive CPU hit (accepted well inside its epsilon) that the GPU
    // claims to have missed from far away is no rounding-side flip.
    let hitRay = -1;
    for (let i = 0; i < clean.rays && hitRay < 0; i++) {
      const px = i % 24;
      const py = Math.floor(i / 24);
      const rd = sphereInversionUnprojectRay(inv, px, py, 24, 14);
      const m = sphereInversionCpuMarch(row, ro, rd, pose.pixelEps);
      if (m.status === SURFACE_GPU_RAY_HIT && m.lastRatio < 0.5) hitRay = i;
    }
    expect(hitRay).toBeGreaterThanOrEqual(0);
    states[hitRay * 4 + 1] = SURFACE_GPU_RAY_MISS;
    states[hitRay * 4] = -1;
    expect(
      compareSphereInversionMarch(row, pose, inv, states, tol).failures,
    ).toBe(1);
  });
});
