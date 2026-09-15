/**
 * The sphere-inversion family's `bench:surface` section, pure half: the
 * fixture rows, their deterministic query mixes and CPU oracle values, the
 * agreement comparators, the app camera's f32 unproject and the f64 CPU
 * march emulator the device legs (`sphere-inversion-legs.ts`) gate the
 * `core: "sphereInv"` / `"sphereInv4"` kernels against. The plan and its
 * delegated decisions are `docs/sphere-inversion-gpu.md` (section 7); the
 * measured rows are recorded in `docs/gpu-bench-surface.md`.
 *
 * WHAT THE ROWS PIN. Each eval row compares the kernel against the f64 CPU
 * estimator (`sphere-inversion-de.ts` / `-de-4d.ts`, cutoff 0) on 700
 * queries: 300 uniform in the row's query-space ball, 250 DEEP-WORD points
 * (a point just off a seed sphere carried through a random reduced word, so
 * the fold spends several inversions) and 150 points a CPU sphere tracer
 * actually evaluated from the row's camera. Three gates per row:
 *
 *   - `surfaceEvalTol` agreement at `fail = 0` on the CLAMPED values
 *     `max(v, 0)` — the estimator is deterministic, not a chaotic forward
 *     orbit, so no flip classifier. Clamped because a return `<= 0` is the
 *     CPU module's MEMBER SIGNAL in folded coordinates, not a distance: at
 *     fold depth 6–7 the f32 fold's position error is magnified by the
 *     conformal scale in folded coordinates, so the member signal's size
 *     legitimately differs (measured on the f32 twin: 8 of 700 cube8 shell
 *     queries, `-1.6e-3` against `-1.1e-3`, one `+1.6e-8` against
 *     `-1.4e-3`), while both still read as "at or inside" to a marcher.
 *     Sign disagreements are counted and disclosed (`memberSignFlips`);
 *   - the ONE-SIDED f32 gate `max(gpu − cpu64) <= SPHERE_INVERSION_GPU_SLACK`
 *     over queries the CPU calls positive — the kernel subtracts that slack,
 *     so the margin it leaves is what a driver's fused multiply-add or
 *     reassociation may spend;
 *   - PER-ROW anti-vacuity floors on the CPU attribution (fold depth k >= 3,
 *     copy-term wins, gap-term wins). Per row, not one floor per class: the
 *     pearls and kissing rows measure no copy wins at all (the gap and seed
 *     terms dominate there), so a shared floor would either fail them or be
 *     too low to mean anything on the rows that do exercise copies.
 *
 * The 4D rows query 3D points through the kernel's own view lift
 * `q = rotorInv · (p, w0)` ({@link liftSphereInversionQuery}, the packer's
 * row convention); the CPU lifts the same point in f64.
 */
import { rotationMatrix4 } from "../../fractal/affine4";
import { resolveSphereInversion } from "../../fractal/sphere-inversion";
import type {
  SphereInversionAuthored,
  SphereInversionConstruction,
  SphereInversionDE,
  SphereInversionHit,
} from "../../fractal/sphere-inversion";
import {
  buildSphereInversionDE,
  estimateSphereInversionDistance,
  sphereInversionHitInfo,
} from "../../fractal/sphere-inversion-de";
import {
  buildSphereInversionDE4,
  estimateSphereInversionDistance4,
  sphereInversionHitInfo4,
} from "../../fractal/sphere-inversion-de-4d";
import { mulberry32 } from "../../fractal/rng";
import {
  SURFACE_GPU_HIT_FLOOR,
  SURFACE_GPU_RAY_EXHAUSTED,
  SURFACE_GPU_RAY_HIT,
  SURFACE_GPU_RAY_MISS,
} from "../../fractal/surface-de-gpu";
import type {
  SurfaceGpu4View,
  SurfaceGpuPose,
} from "../../fractal/surface-de-gpu";
import { SPHERE_INVERSION_GPU_SLACK } from "../../fractal/surface-sphere-inversion-gpu";
import type { Rotation4, Vec3, Vec4 } from "../../fractal/types";

/** Queries per eval row, by class (module doc). */
export const SI_BENCH_UNIFORM_QUERIES = 300;
export const SI_BENCH_DEEP_QUERIES = 250;
export const SI_BENCH_MARCH_QUERIES = 150;

/** The bench camera's vertical field of view and the cone-eps slope the
 * other surface legs use (`2·tan(fov/2)/720`, decoupled from the raster). */
export const SI_BENCH_FOV_DEG = 60;
export const SI_BENCH_PIXEL_EPS =
  (2 * Math.tan((SI_BENCH_FOV_DEG * Math.PI) / 360)) / 720;
/** The app's full-tier march budget (`SURFACE_MARCH_STEPS`). */
export const SI_BENCH_MARCH_STEPS = 160;

/** The 600-cell's kiss slice height `1/(4φ)` (the 4D search sheet's WKISS). */
export const SI_BENCH_W_KISS_600 = 1 / (4 * ((1 + Math.sqrt(5)) / 2));

/** An exterior orbit camera (the other surface legs' pose) or an absolute
 * interior eye/target. */
export type SiBenchCamera =
  | { kind: "orbit"; distFactor: number; theta: number; phi: number }
  | { kind: "interior"; eye: Vec3; target: Vec3 };

export interface SiBenchFixture {
  name: string;
  /** The authored block, or an explicit construction (the flat reduction). */
  construction: SphereInversionConstruction;
  /** 4D rows: the rotor planes and the slice offset. */
  view?: { planes: Rotation4; w0: number };
  camera: SiBenchCamera;
  /** Per-row anti-vacuity floors on the CPU attribution of the 700
   * queries — about half the measured counts (the measured counts are
   * recorded in `docs/gpu-bench-surface.md`), 0 where the row measured
   * none. */
  floors: { foldK3: number; copyWins: number; gapWins: number };
  /** Reuse another row's queries verbatim (the flat 4D reduction). */
  queriesFrom?: string;
}

function resolved(
  authored: SphereInversionAuthored,
): SphereInversionConstruction {
  const r = resolveSphereInversion(authored);
  if (!r.ok) {
    throw new Error(`sphere-inversion bench fixture: ${r.reasons.join("; ")}`);
  }
  return r.construction;
}

const ORBIT: SiBenchCamera = {
  kind: "orbit",
  distFactor: 2.4,
  theta: 0.9,
  phi: 1.2,
};
/** The 600-cell vault's interior view (the 4D search sheet's VAULT_A). */
const VAULT_INTERIOR: SiBenchCamera = {
  kind: "interior",
  eye: [0.35, -0.05, 0.06],
  target: [-0.99, 0.15, -0.18],
};

/** oct6 at the default 0.99 fraction (r ≈ .70), the pearls ball seed, D 8. */
function pearls3(): SphereInversionConstruction {
  return resolved({ arrangement: "oct6", depth: 8 });
}

/** The eval rows (docs/sphere-inversion-gpu.md section 7), in run order. */
export function sphereInversionBenchFixtures(): SiBenchFixture[] {
  const flat3 = pearls3();
  const flat4: SphereInversionConstruction = {
    dim: 4,
    generators: flat3.generators.map((g) => ({
      center: [...g.center, 0],
      radius: g.radius,
    })),
    seed: flat3.seed.map((m) => ({ ...m, center: [...m.center, 0] })),
    depth: flat3.depth,
  };
  const cell600Vault = resolved({
    arrangement: "cell600",
    seed: { kind: "cutShell", size: 0.9, thickness: 0.04 },
    depth: 5,
  });
  const cell600Medallion = resolved({
    arrangement: "cell600",
    seed: { kind: "shell", size: 1.1, thickness: 0.03 },
    depth: 5,
  });
  return [
    {
      name: "siOct6Pearls3",
      construction: pearls3(),
      camera: ORBIT,
      floors: { foldK3: 88, copyWins: 0, gapWins: 214 },
    },
    {
      name: "siOct6Kiss3",
      construction: resolved({
        arrangement: "oct6",
        radiusFraction: 1,
        depth: 12,
      }),
      camera: ORBIT,
      floors: { foldK3: 94, copyWins: 0, gapWins: 212 },
    },
    {
      name: "siCube8Shell3",
      construction: resolved({
        arrangement: "cube8",
        seed: { kind: "shell" },
        depth: 7,
      }),
      camera: ORBIT,
      floors: { foldK3: 96, copyWins: 122, gapWins: 19 },
    },
    {
      name: "siIco12Vault3",
      construction: resolved({
        arrangement: "ico12",
        seed: { kind: "cutShell" },
        depth: 5,
      }),
      camera: ORBIT,
      floors: { foldK3: 107, copyWins: 137, gapWins: 89 },
    },
    {
      name: "siFlat4",
      construction: flat4,
      view: { planes: {}, w0: 0 },
      camera: ORBIT,
      floors: { foldK3: 88, copyWins: 0, gapWins: 214 },
      queriesFrom: "siOct6Pearls3",
    },
    {
      name: "siCell24Shell4",
      construction: resolved({
        arrangement: "cell24",
        radiusFraction: 0.98,
        seed: { kind: "shell" },
        depth: 5,
      }),
      view: { planes: { xw: 0.3 }, w0: 0.15 },
      camera: ORBIT,
      floors: { foldK3: 11, copyWins: 99, gapWins: 112 },
    },
    {
      name: "si600Vault4@W.08",
      construction: cell600Vault,
      view: { planes: {}, w0: 0.08 },
      camera: VAULT_INTERIOR,
      floors: { foldK3: 20, copyWins: 95, gapWins: 133 },
    },
    {
      name: "si600Vault4@XW.3W.1",
      construction: cell600Vault,
      view: { planes: { xw: 0.3 }, w0: 0.1 },
      camera: VAULT_INTERIOR,
      floors: { foldK3: 14, copyWins: 98, gapWins: 137 },
    },
    {
      name: "si600Medallion4@WKISS",
      construction: cell600Medallion,
      view: { planes: {}, w0: SI_BENCH_W_KISS_600 },
      camera: ORBIT,
      floors: { foldK3: 20, copyWins: 61, gapWins: 162 },
    },
    {
      name: "si600Medallion4@XW.4YW.3ZW.2",
      construction: cell600Medallion,
      view: { planes: { xw: 0.4, yw: 0.3, zw: 0.2 }, w0: 0 },
      camera: ORBIT,
      floors: { foldK3: 12, copyWins: 66, gapWins: 185 },
    },
    {
      name: "si600Snowflake4@W.06",
      construction: resolved({
        arrangement: "cell600",
        radiusFraction: 0.995,
        seed: { kind: "ball", size: 0.2 },
        depth: 7,
      }),
      view: { planes: {}, w0: 0.06 },
      camera: ORBIT,
      floors: { foldK3: 25, copyWins: 0, gapWins: 331 },
    },
  ];
}

// ------------------------------------------------------------ the view

/** The kernel's view record for a fixture's pose (identity + w0 0 in 3D is
 * never packed). */
export function sphereInversionBenchView4(
  fixture: SiBenchFixture,
): SurfaceGpu4View {
  const view = fixture.view ?? { planes: {}, w0: 0 };
  return {
    rotor: rotationMatrix4(view.planes),
    w0: view.w0,
    sliceHalfW: 0,
  };
}

/** The kernel's `liftSphereInv4`, in f64: row `i` of the packed rotor is
 * `(rot[i], rot[4+i], rot[8+i], rot[12+i])` (`packSphereInversion4GpuParams`). */
export function liftSphereInversionQuery(
  view4: SurfaceGpu4View,
  p: Vec3,
): Vec4 {
  const rot = view4.rotor;
  const pv = [p[0], p[1], p[2], view4.w0];
  const out: Vec4 = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    out[i] =
      rot[i] * pv[0] +
      rot[4 + i] * pv[1] +
      rot[8 + i] * pv[2] +
      rot[12 + i] * pv[3];
  }
  return out;
}

/** The lift's inverse restricted to the slice: the 3D point whose lift is
 * the orthogonal projection of `q` onto the slice hyperplane (the rotor is
 * orthogonal, so its inverse is its transpose). */
function projectToSlice(view4: SurfaceGpu4View, q: Vec4): Vec3 {
  const rot = view4.rotor;
  const out: Vec3 = [0, 0, 0];
  for (let j = 0; j < 3; j++) {
    let acc = 0;
    for (let i = 0; i < 4; i++) acc += rot[4 * j + i] * q[i];
    out[j] = acc;
  }
  return out;
}

/** A built row: the DE, its view, its march radius and its CPU oracle. */
export interface SiBenchRow {
  fixture: SiBenchFixture;
  de: SphereInversionDE;
  dim: 3 | 4;
  /** 4D rows only. */
  view4: SurfaceGpu4View | null;
  /** The full bounding radius (tolerance scale, `visRadius4`). */
  R: number;
  /** The query-space sphere-gate radius: R in 3D, `sqrt(R² − w0²)` in 4D
   * (the packer's slice-adjusted `visibleRadius`). */
  visR: number;
  queries: Vec3[];
  cpu: number[];
  census: SiBenchCensus;
}

export interface SiBenchCensus {
  /** Queries whose fold spent at least three inversions. */
  foldK3: number;
  /** Queries a one-step copy term set. */
  copyWins: number;
  /** Queries a depth-2 gap term set. */
  gapWins: number;
  /** Queries the CPU calls positive (the one-sided gate's population). */
  positive: number;
  /** Queries whose f64 fold passed within 1e-5 of a visited generator
   * sphere — where a rounding-side flip is a legitimate disagreement.
   * Disclosed only (no exclusion is applied). Unit arrangements only. */
  wallProximity: number;
}

function cpuEstimate(
  row: Pick<SiBenchRow, "de" | "dim" | "view4">,
  p: Vec3,
): number {
  return row.dim === 3
    ? estimateSphereInversionDistance(row.de, p)
    : estimateSphereInversionDistance4(
        row.de,
        liftSphereInversionQuery(row.view4!, p),
      );
}

function cpuHit(
  row: Pick<SiBenchRow, "de" | "dim" | "view4">,
  p: Vec3,
): SphereInversionHit {
  return row.dim === 3
    ? sphereInversionHitInfo(row.de, p)
    : sphereInversionHitInfo4(row.de, liftSphereInversionQuery(row.view4!, p));
}

function randomUnit(rng: () => number, dim: number): number[] {
  for (;;) {
    const v = Array.from({ length: dim }, () => 2 * rng() - 1);
    const l = Math.hypot(...v);
    if (l > 1e-3 && l <= 1) return v.map((x) => x / l);
  }
}

/** Invert `x` through generator `j` of the DE's tables. */
function invertThrough(
  de: SphereInversionDE,
  j: number,
  x: number[],
): number[] {
  const dim = de.dim;
  const c = Array.from(
    { length: dim },
    (_, a) => de.generatorCenter[j * dim + a],
  );
  let d2 = 0;
  for (let a = 0; a < dim; a++) d2 += (x[a] - c[a]) ** 2;
  const s = de.generatorRadius2[j] / Math.max(d2, 1e-300);
  return x.map((v, a) => c[a] + s * (v - c[a]));
}

/**
 * The DEEP-WORD class: a point `δ·r` off a random seed member's sphere
 * (δ log-uniform in [1e-4, 1e-1], either side) carried through a random
 * reduced word of length 1..min(D, 6), so the query lands next to a deep
 * copy and the fold spends inversions to reach it. 4D points are projected
 * onto the row's slice hyperplane.
 */
function deepWordQueries(row: SiBenchRow, count: number, seed: number): Vec3[] {
  const { de } = row;
  const rng = mulberry32(seed);
  const dim = de.dim;
  const seedMembers = row.fixture.construction.seed;
  const maxLen = Math.max(1, Math.min(de.depth, 6));
  const out: Vec3[] = [];
  while (out.length < count) {
    const m = seedMembers[Math.floor(rng() * seedMembers.length)];
    const u = randomUnit(rng, dim);
    const delta = 10 ** (-4 + 3 * rng()) * (rng() < 0.5 ? -1 : 1);
    let x = m.center.map((c, a) => c + u[a] * m.radius * (1 + delta));
    const len = 1 + Math.floor(rng() * maxLen);
    let prev = -1;
    for (let i = 0; i < len; i++) {
      let j = Math.floor(rng() * (de.generatorCount - 1));
      if (prev >= 0 && j >= prev) j++;
      x = invertThrough(de, j, x);
      prev = j;
    }
    const p: Vec3 =
      dim === 3 ? [x[0], x[1], x[2]] : projectToSlice(row.view4!, x as Vec4);
    if (p.every(Number.isFinite) && Math.hypot(...p) <= row.visR * 1.02) {
      out.push(p);
    }
  }
  return out;
}

function uniformQueries(row: SiBenchRow, count: number, seed: number): Vec3[] {
  const rng = mulberry32(seed);
  const out: Vec3[] = [];
  while (out.length < count) {
    const p: Vec3 = [0, 1, 2].map(() => (2 * rng() - 1) * row.visR) as Vec3;
    if (Math.hypot(...p) <= row.visR) out.push(p);
  }
  return out;
}

/** The MARCH class: points a CPU sphere tracer evaluated on a 32×18 raster
 * from the row's camera, drawn from each ray's last three evaluations (the
 * near-surface steps a tracer's queries concentrate on). */
function marchQueries(row: SiBenchRow, count: number, seed: number): Vec3[] {
  const width = 32;
  const height = 18;
  const pose = sphereInversionBenchPose(row, width, height);
  const inv = sphereInversionInvProjView(row, pose);
  const pool: Vec3[] = [];
  const ro: Vec3 = [pose.ro[0], pose.ro[1], pose.ro[2]];
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const rd = sphereInversionUnprojectRay(inv, px, py, width, height);
      const trace = sphereInversionCpuMarch(row, ro, rd, pose.pixelEps, 48);
      pool.push(...trace.tail);
    }
  }
  const rng = mulberry32(seed);
  const out: Vec3[] = [];
  if (pool.length === 0) return out;
  while (out.length < count) {
    out.push(pool[Math.floor(rng() * pool.length)]);
  }
  return out;
}

/** Build one row: DE, view, queries (uniform, deep-word, march) and the f64
 * oracle with its attribution census. `queriesFrom` rows copy the named
 * row's queries verbatim. */
export function buildSphereInversionBenchRow(
  fixture: SiBenchFixture,
  borrowed: Vec3[] | null = null,
): SiBenchRow {
  const c = fixture.construction;
  const de =
    c.dim === 3 ? buildSphereInversionDE(c) : buildSphereInversionDE4(c);
  const view4 = c.dim === 4 ? sphereInversionBenchView4(fixture) : null;
  const R = de.boundingRadius;
  const w0 = view4?.w0 ?? 0;
  const row: SiBenchRow = {
    fixture,
    de,
    dim: c.dim,
    view4,
    R,
    visR: Math.sqrt(Math.max(R * R - w0 * w0, 0)),
    queries: [],
    cpu: [],
    census: {
      foldK3: 0,
      copyWins: 0,
      gapWins: 0,
      positive: 0,
      wallProximity: 0,
    },
  };
  const seed = [...fixture.name].reduce(
    (h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0,
    7,
  );
  row.queries = borrowed
    ? borrowed.map((p) => [p[0], p[1], p[2]] as Vec3)
    : [
        ...uniformQueries(row, SI_BENCH_UNIFORM_QUERIES, seed ^ 0x11),
        ...deepWordQueries(row, SI_BENCH_DEEP_QUERIES, seed ^ 0x22),
        ...marchQueries(row, SI_BENCH_MARCH_QUERIES, seed ^ 0x33),
      ];
  const unitR = de.generatorRadius[0];
  for (const p of row.queries) {
    const hit = cpuHit(row, p);
    row.cpu.push(hit.d);
    if (hit.foldDepth >= 3) row.census.foldK3++;
    if (hit.depth - hit.foldDepth === 1) row.census.copyWins++;
    if (hit.depth - hit.foldDepth === 2) row.census.gapWins++;
    if (hit.d > 0) row.census.positive++;
    for (let i = 0; i < hit.foldDepth; i++) {
      if (Math.abs(de.foldRadius[i] - unitR) < 1e-5) {
        row.census.wallProximity++;
        break;
      }
    }
  }
  return row;
}

/** Every fixture row, the `queriesFrom` borrowers after their lenders. */
export function buildSphereInversionBenchRows(
  fixtures: SiBenchFixture[] = sphereInversionBenchFixtures(),
): SiBenchRow[] {
  const rows: SiBenchRow[] = [];
  for (const fixture of fixtures) {
    const lender = fixture.queriesFrom
      ? rows.find((r) => r.fixture.name === fixture.queriesFrom)
      : undefined;
    if (fixture.queriesFrom && !lender) {
      throw new Error(
        `sphere-inversion bench: ${fixture.name} borrows queries from missing row ${fixture.queriesFrom}`,
      );
    }
    rows.push(buildSphereInversionBenchRow(fixture, lender?.queries ?? null));
  }
  return rows;
}

// ------------------------------------------------------------ comparators

export interface SiEvalRow {
  system: string;
  core: "sphereInv" | "sphereInv4";
  n: number;
  failures: number;
  failuresOver: number;
  maxAbsErr: number;
  p99AbsErr: number;
  minGpuMinusCpu: number;
  maxGpuMinusCpu: number;
  /** `max(gpu − cpu64)` over CPU-positive queries (the one-sided gate). */
  maxPositiveExcess: number;
  /** `slack − maxPositiveExcess`: what the f32 slack has left. */
  oneSidedMargin: number;
  oneSidedFailures: number;
  /** Queries where exactly one side returned a positive value (the member
   * signal's sign; disclosed, gated only through the clamped values). */
  memberSignFlips: number;
  census: SiBenchCensus;
  floors: SiBenchFixture["floors"];
  /** Floors the census missed, by name (empty = non-vacuous). */
  vacuous: string[];
  /** GPU hit-info attribution against the CPU hit record on queries whose
   * value agreed within tolerance: generation (word length) and seed member
   * mismatches. Absent until the hit-info probe runs. */
  attributionCompared?: number;
  generationMismatches?: number;
  seedMemberMismatches?: number;
  gpuMs?: number;
  /** Whether the row's gates passed. */
  pass: boolean;
}

/** Compare one row's GPU values (and optional attribution) against its CPU
 * oracle. `tol` is `surfaceEvalTol` (the section owns its definition). */
export function compareSphereInversionEval(
  row: SiBenchRow,
  gpu: ArrayLike<number>,
  tol: (cpu: number, R: number) => number,
): SiEvalRow {
  let failures = 0;
  let failuresOver = 0;
  let maxAbsErr = 0;
  let minSigned = Infinity;
  let maxSigned = -Infinity;
  let maxPositiveExcess = -Infinity;
  let oneSidedFailures = 0;
  const abs: number[] = [];
  let memberSignFlips = 0;
  for (let i = 0; i < row.cpu.length; i++) {
    const cpuRaw = row.cpu[i];
    if (cpuRaw > 0 !== gpu[i] > 0) memberSignFlips++;
    // The member signal's size is not a distance (module doc).
    const cpu = Math.max(cpuRaw, 0);
    const signed = Math.max(gpu[i], 0) - cpu;
    const err = Math.abs(signed);
    abs.push(err);
    maxAbsErr = Math.max(maxAbsErr, err);
    minSigned = Math.min(minSigned, signed);
    maxSigned = Math.max(maxSigned, signed);
    if (!(err <= tol(cpu, row.R))) {
      failures++;
      if (signed > 0) failuresOver++;
    }
    if (cpu > 0) {
      maxPositiveExcess = Math.max(maxPositiveExcess, signed);
      if (!(signed <= SPHERE_INVERSION_GPU_SLACK)) oneSidedFailures++;
    }
  }
  abs.sort((a, b) => a - b);
  const { census } = row;
  const floors = row.fixture.floors;
  const vacuous = (["foldK3", "copyWins", "gapWins"] as const).filter(
    (k) => census[k] < floors[k],
  );
  const finite = (v: number) => (Number.isFinite(v) ? v : 0);
  return {
    system: row.fixture.name,
    core: row.dim === 3 ? "sphereInv" : "sphereInv4",
    n: row.cpu.length,
    failures,
    failuresOver,
    maxAbsErr,
    p99AbsErr: abs.length
      ? abs[Math.min(abs.length - 1, Math.floor(0.99 * abs.length))]
      : 0,
    minGpuMinusCpu: finite(minSigned),
    maxGpuMinusCpu: finite(maxSigned),
    maxPositiveExcess: finite(maxPositiveExcess),
    oneSidedMargin: SPHERE_INVERSION_GPU_SLACK - finite(maxPositiveExcess),
    oneSidedFailures,
    memberSignFlips,
    census: { ...census },
    floors: { ...floors },
    vacuous,
    pass: failures === 0 && oneSidedFailures === 0 && vacuous.length === 0,
  };
}

/** Fold the GPU hit-info probe's attribution into an eval row: generation
 * and seed member against the CPU hit record, on queries whose value agreed
 * within tolerance AND whose CPU record is not a pole (attribution at a
 * term tie is a legitimate rounding-side choice, which the value gate
 * already bounds). Mismatches fail the row. */
export function compareSphereInversionAttribution(
  row: SiBenchRow,
  result: SiEvalRow,
  gpu: ArrayLike<number>,
  generation: ArrayLike<number>,
  seedMember: ArrayLike<number>,
  tol: (cpu: number, R: number) => number,
): void {
  let compared = 0;
  let generationMismatches = 0;
  let seedMemberMismatches = 0;
  for (let i = 0; i < row.queries.length; i++) {
    const cpu = row.cpu[i];
    // Attribution is compared where both sides report a positive value
    // that agrees: inside the set the winning term is the member signal's,
    // whose folded-coordinate rounding may pick either side of a tie.
    if (!(cpu > 0 && gpu[i] > 0 && Math.abs(gpu[i] - cpu) <= tol(cpu, row.R))) {
      continue;
    }
    const hit = cpuHit(row, row.queries[i]);
    if (hit.status === 2) continue;
    compared++;
    if (generation[i] !== hit.depth) generationMismatches++;
    if (seedMember[i] !== hit.seedMember) seedMemberMismatches++;
  }
  result.attributionCompared = compared;
  result.generationMismatches = generationMismatches;
  result.seedMemberMismatches = seedMemberMismatches;
}

/** The flat 4D reduction's cross-check: the 4D kernel on the flat embedding
 * against the 3D kernel on the same queries, within {@link
 * SI_BENCH_FLAT_TOL} (WGSL's `length` summation order makes bit identity
 * unpromisable on a GPU). */
export const SI_BENCH_FLAT_TOL = 1e-6;
export function compareSphereInversionFlat(
  gpu3: ArrayLike<number>,
  gpu4: ArrayLike<number>,
): { n: number; maxDelta: number; mismatches: number } {
  let maxDelta = 0;
  let mismatches = 0;
  for (let i = 0; i < gpu3.length; i++) {
    const d = Math.abs(gpu3[i] - gpu4[i]);
    if (!(d <= SI_BENCH_FLAT_TOL)) mismatches++;
    if (Number.isFinite(d)) maxDelta = Math.max(maxDelta, d);
  }
  return { n: gpu3.length, maxDelta, mismatches };
}

// ------------------------------------------------------------ camera + march

function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/** The kernel pose for a row's camera at a raster size. */
export function sphereInversionBenchPose(
  row: Pick<SiBenchRow, "visR" | "fixture">,
  rasterWidth: number,
  rasterHeight: number,
  camera: SiBenchCamera = row.fixture.camera,
): SurfaceGpuPose {
  let ro: Vec3;
  let target: Vec3;
  if (camera.kind === "orbit") {
    const radius = camera.distFactor * row.visR;
    ro = [
      radius * Math.sin(camera.phi) * Math.sin(camera.theta),
      radius * Math.cos(camera.phi),
      radius * Math.sin(camera.phi) * Math.cos(camera.theta),
    ];
    target = [0, 0, 0];
  } else {
    ro = [...camera.eye];
    target = [...camera.target];
  }
  const fwd = normalize([
    target[0] - ro[0],
    target[1] - ro[1],
    target[2] - ro[2],
  ]);
  const right = normalize(cross(fwd, [0, 1, 0]));
  const up = cross(right, fwd);
  return {
    ro,
    right,
    up,
    fwd,
    tanHalf: Math.tan((SI_BENCH_FOV_DEG * Math.PI) / 360),
    aspect: rasterWidth / rasterHeight,
    rasterWidth,
    rasterHeight,
    pixelEps: SI_BENCH_PIXEL_EPS,
  };
}

/**
 * The inverse projection-view matrix, column-major, exactly as the other
 * surface legs build it with three.js (`makePerspective` symmetric frustum,
 * near `R·1e-3`, far `R·10`, camera basis `(right, up, −fwd)` at `ro`) —
 * written out in closed form so this module stays three-free.
 */
export function sphereInversionInvProjView(
  row: Pick<SiBenchRow, "R">,
  pose: SurfaceGpuPose,
): Float32Array {
  const near = row.R * 1e-3;
  const far = row.R * 10;
  const top = near * pose.tanHalf;
  const rightExt = top * pose.aspect;
  const x = near / rightExt;
  const y = near / top;
  const c = -(far + near) / (far - near);
  const d = (-2 * far * near) / (far - near);
  // inverse(P), row-major.
  const q = [1 / x, 0, 0, 0, 0, 1 / y, 0, 0, 0, 0, 0, -1, 0, 0, 1 / d, c / d];
  // camera-to-world, row-major.
  const w = [
    pose.right[0],
    pose.up[0],
    -pose.fwd[0],
    pose.ro[0],
    pose.right[1],
    pose.up[1],
    -pose.fwd[1],
    pose.ro[1],
    pose.right[2],
    pose.up[2],
    -pose.fwd[2],
    pose.ro[2],
    0,
    0,
    0,
    1,
  ];
  const out = new Float32Array(16);
  for (let r = 0; r < 4; r++) {
    for (let col = 0; col < 4; col++) {
      let acc = 0;
      for (let k = 0; k < 4; k++) acc += w[r * 4 + k] * q[k * 4 + col];
      out[col * 4 + r] = acc;
    }
  }
  return out;
}

/** The unproject kernel's per-pixel ray in f32 (the other surface legs'
 * `surfaceUnprojectRay`, verbatim arithmetic). */
export function sphereInversionUnprojectRay(
  inv: Float32Array,
  px: number,
  py: number,
  rasterWidth: number,
  rasterHeight: number,
): Vec3 {
  const f = Math.fround;
  const ndcX = f(f(f(f(px + 0.5) / rasterWidth) * 2) - 1);
  const ndcY = f(f(f(f(py + 0.5) / rasterHeight) * 2) - 1);
  const mul = (z: number): number[] => {
    const out = [0, 0, 0, 0];
    for (let r = 0; r < 4; r++) {
      let acc = f(inv[r] * ndcX);
      acc = f(acc + f(inv[4 + r] * ndcY));
      acc = f(acc + f(inv[8 + r] * z));
      acc = f(acc + inv[12 + r]);
      out[r] = acc;
    }
    return out;
  };
  const nearP = mul(-1);
  const farP = mul(1);
  const dx = f(f(farP[0] / farP[3]) - f(nearP[0] / nearP[3]));
  const dy = f(f(farP[1] / farP[3]) - f(nearP[1] / nearP[3]));
  const dz = f(f(farP[2] / farP[3]) - f(nearP[2] / nearP[3]));
  const len = f(Math.sqrt(f(f(f(dx * dx) + f(dy * dy)) + f(dz * dz))));
  return [f(dx / len), f(dy / len), f(dz / len)];
}

/** The kernel's hit acceptance floor for a row: `max(R·hitFloor, slack)`
 * as the packer writes it (f32). */
export function sphereInversionBenchHitFloorEps(
  row: Pick<SiBenchRow, "R">,
): number {
  return Math.fround(
    Math.max(row.R * SURFACE_GPU_HIT_FLOOR, SPHERE_INVERSION_GPU_SLACK),
  );
}

export interface SiCpuMarch {
  status: number;
  t: number;
  /** Smallest `d/eps` along the ray and the `t` it happened at. */
  minRatio: number;
  tAtMin: number;
  /** `d/eps` at the last evaluation (below 1 on a hit). */
  lastRatio: number;
  /** The last three evaluated points (the march query class). */
  tail: Vec3[];
}

/**
 * The march kernel's loop in f64 over the CPU estimator: the
 * `visibleRadius · 1.02` sphere gate, `eps = max(pixelEps·t, hitFloorEps)`,
 * check order sphere exit, budget, eval, and `t += d` (step scale 1). Pre-
 * gate misses report `t = −1`, the kernel's untouched state.
 */
export function sphereInversionCpuMarch(
  row: Pick<SiBenchRow, "de" | "dim" | "view4" | "visR" | "R">,
  ro: Vec3,
  rd: Vec3,
  pixelEps: number,
  maxSteps: number = SI_BENCH_MARCH_STEPS,
): SiCpuMarch {
  const radius = row.visR * 1.02;
  const b = ro[0] * rd[0] + ro[1] * rd[1] + ro[2] * rd[2];
  const c = ro[0] * ro[0] + ro[1] * ro[1] + ro[2] * ro[2] - radius * radius;
  const disc = b * b - c;
  const out: SiCpuMarch = {
    status: SURFACE_GPU_RAY_MISS,
    t: -1,
    minRatio: Infinity,
    tAtMin: -1,
    lastRatio: Infinity,
    tail: [],
  };
  if (disc < 0) return out;
  const sq = Math.sqrt(disc);
  const tFar = -b + sq;
  if (tFar <= 0) return out;
  const hitFloorEps = sphereInversionBenchHitFloorEps(row);
  let t = Math.max(-b - sq, 0);
  let steps = 0;
  for (;;) {
    out.t = t;
    if (t > tFar) {
      out.status = SURFACE_GPU_RAY_MISS;
      return out;
    }
    if (steps >= maxSteps) {
      out.status = SURFACE_GPU_RAY_EXHAUSTED;
      return out;
    }
    const eps = Math.max(pixelEps * t, hitFloorEps);
    const p: Vec3 = [ro[0] + rd[0] * t, ro[1] + rd[1] * t, ro[2] + rd[2] * t];
    const d = cpuEstimate(row, p);
    out.tail.push(p);
    if (out.tail.length > 3) out.tail.shift();
    steps++;
    const ratio = d / eps;
    out.lastRatio = ratio;
    if (ratio < out.minRatio) {
      out.minRatio = ratio;
      out.tAtMin = t;
    }
    if (d < eps) {
      out.status = SURFACE_GPU_RAY_HIT;
      return out;
    }
    t += d;
  }
}

export interface SiMarchRow {
  system: string;
  core: "sphereInv" | "sphereInv4";
  rasterWidth: number;
  rasterHeight: number;
  rays: number;
  gpuHits: number;
  cpuHits: number;
  gpuExhausted: number;
  cpuExhausted: number;
  statusMismatches: number;
  /** Status mismatches with `|tGpu − tCpu|` within tolerance (the same
   * trajectory, its terminal event reclassified by rounding). */
  boundaryFlips: number;
  /** One-side-hit mismatches decided by rounding at acceptance: a GPU hit
   * where the CPU's closest approach came within 1.5× of acceptance at the
   * GPU's `t`, or a CPU hit accepted within 1.5× of its epsilon that the GPU
   * marched past. */
  silhouetteFlips: number;
  /** Cap on the two exclusions together (1% of the rays). */
  flipCap: number;
  bothHits: number;
  hitTFailures: number;
  maxAbsT: number;
  failures: number;
  passes: number;
  gpuMs: number;
  compileMs: number;
  truncated: boolean;
  pass: boolean;
}

/** Compare a march raster's GPU states (4 f32 per ray: t, status, steps, d)
 * against the CPU emulator per ray. */
export function compareSphereInversionMarch(
  row: SiBenchRow,
  pose: SurfaceGpuPose,
  inv: Float32Array,
  states: Float32Array,
  tol: (cpu: number, R: number) => number,
): Omit<SiMarchRow, "passes" | "gpuMs" | "compileMs" | "truncated" | "pass"> {
  const { rasterWidth: width, rasterHeight: height } = pose;
  const rays = width * height;
  const ro: Vec3 = [
    Math.fround(pose.ro[0]),
    Math.fround(pose.ro[1]),
    Math.fround(pose.ro[2]),
  ];
  const res: Omit<
    SiMarchRow,
    "passes" | "gpuMs" | "compileMs" | "truncated" | "pass"
  > = {
    system: row.fixture.name,
    core: row.dim === 3 ? "sphereInv" : "sphereInv4",
    rasterWidth: width,
    rasterHeight: height,
    rays,
    gpuHits: 0,
    cpuHits: 0,
    gpuExhausted: 0,
    cpuExhausted: 0,
    statusMismatches: 0,
    boundaryFlips: 0,
    silhouetteFlips: 0,
    flipCap: Math.max(1, Math.floor(rays / 100)),
    bothHits: 0,
    hitTFailures: 0,
    maxAbsT: 0,
    failures: 0,
  };
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const ray = py * width + px;
      const rd = sphereInversionUnprojectRay(inv, px, py, width, height);
      const cpu = sphereInversionCpuMarch(row, ro, rd, pose.pixelEps);
      const gT = states[ray * 4];
      const gS = states[ray * 4 + 1];
      if (gS === SURFACE_GPU_RAY_HIT) res.gpuHits++;
      if (cpu.status === SURFACE_GPU_RAY_HIT) res.cpuHits++;
      if (gS === SURFACE_GPU_RAY_EXHAUSTED) res.gpuExhausted++;
      if (cpu.status === SURFACE_GPU_RAY_EXHAUSTED) res.cpuExhausted++;
      const tTol = tol(Math.max(cpu.t, 0), row.R);
      if (gS !== cpu.status) {
        res.statusMismatches++;
        if (cpu.t >= 0 && Math.abs(gT - cpu.t) <= tTol) {
          res.boundaryFlips++;
        } else if (
          (gS === SURFACE_GPU_RAY_HIT &&
            cpu.minRatio <= 1.5 &&
            Math.abs(cpu.tAtMin - gT) <= tTol) ||
          (cpu.status === SURFACE_GPU_RAY_HIT &&
            cpu.lastRatio >= 1 / 1.5 &&
            gT >= cpu.t - tTol)
        ) {
          res.silhouetteFlips++;
        } else {
          res.failures++;
        }
        continue;
      }
      if (gS === SURFACE_GPU_RAY_HIT) {
        res.bothHits++;
        const dt = Math.abs(gT - cpu.t);
        res.maxAbsT = Math.max(res.maxAbsT, dt);
        if (!(dt <= tTol)) {
          res.hitTFailures++;
          res.failures++;
        }
      }
    }
  }
  if (res.boundaryFlips + res.silhouetteFlips > res.flipCap) {
    res.failures += res.boundaryFlips + res.silhouetteFlips - res.flipCap;
  }
  return res;
}
