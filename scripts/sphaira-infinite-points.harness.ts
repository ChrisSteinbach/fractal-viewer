/**
 * The fr-l0ma.7 record: HOW POINTS DRAWS THE INFINITE SPHAIRA FAMILIES'
 * LIMIT SETS, and why the shipped sampler is the WALK for finite
 * constructions and the COLUMN SWEEP for infinite ones.
 *
 * VERDICT (measured 2026-10-12, this sheet's tables). The walk keeps
 * nothing on the sphere-less tetra/tetra4/prism constructions (greedy fold
 * depths 0-4) and on the sphere-less cube1 draws a DEGENERATE SPECK: 97%
 * of a 40k-step budget kept, every point inside a ~0.1 box — an absorbing
 * deep-fold region, not a sample of the set. The DE-shell rejection
 * sampler (the menger family's arm) is REFUTED here: the union's
 * INTERNAL face images are also |de|-small (two-sided shells sample them
 * at 86-93% fog — the tiling skeleton below the plane), and even one-sided
 * on the complement side carries the pole fog at wider shells (41% at
 * 0.05), with 14-380 evals per kept point. The direct plane sampler is
 * the tetra's cost floor (1 eval/kept, exact) but is family-specific
 * code the sweep's own numbers make unnecessary. The SHIPPED SWEEP:
 * columns uniform in the bound ball's equatorial cross-section, the
 * estimate's first + → − sign flip bisected down the column — internal
 * faces are 0-touches (union on both sides, no sign flip), so only the
 * union's outer boundary, the limit set, flips. Measured: flips 99.5-100%
 * of columns on every infinite family, kept |de| mean 1e-11..2e-6 (max
 * 6.5e-3 on the capped-break columns), face slots spread across every
 * face, 20-43 evals/kept (~1-2 s per 100k-point draw). The tetra's own
 * divide plane is a CAPPED band — the 2D wall/disk fold cycles exactly on
 * it (verified: every generator leaves the plane fixed to 0 drift; points
 * just below read inside the union) — so the sweep treats a capped fold
 * as "no sign, advance past" and brackets between the clean neighbours.
 *
 * Rows per construction: the WALK (the finite arm, for the record), the
 * DIRECT plane sampler (the tetra's cost floor), the REJECTION variants
 * (the refuted arm), the COLUMN sweep (the shipped design), and the
 * SHIPPED `sampleSphairahedronCloud` itself at worker scale. Splat PNGs
 * land in scripts/out/: the shipped sweep per subject, plus the
 * two-sided rejection fog for contrast.
 *
 * Run: npx vitest run --config scripts/vitest.harness.config.ts \
 *        scripts/sphaira-infinite-points.harness.ts
 */
import { writeFileSync } from "node:fs";
import { mulberry32 } from "../src/fractal/rng";
import { encodePng } from "./de-preview";
import {
  SPHAIRAHEDRON_FUDGE,
  buildSphairahedron,
  foldSphairahedron,
  makeSphairahedronScratch,
  sphairahedronTileSDF,
  type SphairahedronConstruction,
} from "../src/fractal/sphairahedron";
import { sampleSphairahedronCloud } from "../src/fractal/sphairahedron-sample";

const FUDGE = SPHAIRAHEDRON_FUDGE;

// ----------------------------------------------------------- the subjects

interface Subject {
  key: string;
  construction: SphairahedronConstruction;
}

function build(
  key: string,
  family: "tetra333" | "tetra4" | "prism2" | "cube1",
  moduli: { za?: number; zb?: number; z2?: number } = {},
): Subject {
  return {
    key,
    construction: buildSphairahedron(family, moduli, null),
  };
}

interface Cloud {
  positions: Float32Array;
  evals: number;
  ms: number;
}

// ------------------------------------------------------------- the arms

interface Arm {
  key: string;
  accept: (
    tile: number,
    lambda: number,
    capped: boolean,
    skippedPole: boolean,
  ) => boolean;
}

function armR(
  side: "both" | "outside",
  shell: number,
  lambdaCap: number | null,
): Arm {
  return {
    key: `R(${side}, s=${shell}${lambdaCap ? `, λ<=${lambdaCap}` : ""})`,
    accept: (tile, lambda, capped, skippedPole) => {
      if (capped || skippedPole) return false;
      if (lambdaCap !== null && lambda > lambdaCap) return false;
      const de = (tile / Math.abs(lambda)) * FUDGE;
      if (side === "both") return Math.abs(de) <= shell;
      return de >= 0 && de <= shell;
    },
  };
}

function foldOnce(
  construction: SphairahedronConstruction,
  p: number[],
  scratch: ReturnType<typeof makeSphairahedronScratch>,
): number {
  foldSphairahedron(construction, p, scratch);
  return (
    (sphairahedronTileSDF(construction, scratch.x) / Math.abs(scratch.lambda)) *
    FUDGE
  );
}

/** Uniform in the construction's bound ball (cube-rejected); one fold per
 * attempt. */
function rejectionCloud(subject: Subject, attempts: number, arm: Arm): Cloud {
  const { construction } = subject;
  const dim = construction.dim;
  const { center, radius } = construction.bound;
  const scratch = makeSphairahedronScratch(dim, 1);
  const rng = mulberry32(0x5eed_e5ca);
  const pos: number[] = [];
  const p = new Array<number>(dim).fill(0);
  const t0 = performance.now();
  for (let i = 0; i < attempts; i++) {
    let d2 = 0;
    for (let k = 0; k < dim; k++) {
      p[k] = center[k] + (rng() * 2 - 1) * radius;
      d2 += (p[k] - center[k]) ** 2;
    }
    if (d2 > radius * radius) continue;
    foldSphairahedron(construction, p, scratch);
    const tile = sphairahedronTileSDF(construction, scratch.x);
    if (!arm.accept(tile, scratch.lambda, scratch.capped, scratch.skippedPole))
      continue;
    for (let k = 0; k < dim; k++) pos.push(p[k]);
  }
  return {
    positions: new Float32Array(pos),
    evals: attempts,
    ms: performance.now() - t0,
  };
}

/** The shipped walk arm (the sampler's own loop, ask 5000). */
function walkCloud(subject: Subject): Cloud {
  const { construction } = subject;
  const dim = construction.dim;
  const scratch = makeSphairahedronScratch(dim, 1);
  const rng = mulberry32(1);
  const ask = 5000;
  const budget = 100 + Math.max(ask * 8, 4096);
  const pos: number[] = [];
  const p = new Array<number>(dim).fill(0.2);
  const t0 = performance.now();
  for (let i = 0; i < budget; i++) {
    const { face } =
      construction.foldFaces[Math.floor(rng() * construction.foldFaces.length)];
    if (face.kind === "sphere") {
      const c = face.sphere.c;
      const r = face.sphere.r;
      let d2 = 0;
      for (let k = 0; k < dim; k++) {
        const t = p[k] - c[k];
        d2 += t * t;
      }
      const k = (r * r) / d2;
      for (let kk = 0; kk < dim; kk++) p[kk] = c[kk] + k * (p[kk] - c[kk]);
    } else {
      const pl = face.plane;
      let d = -pl.h;
      for (let k = 0; k < dim; k++) d += pl.n[k] * p[k];
      if (d > 0) for (let k = 0; k < dim; k++) p[k] -= 2 * d * pl.n[k];
    }
    if (i < 100) continue;
    foldSphairahedron(construction, p, scratch);
    if (scratch.moves < 24) continue;
    for (let k = 0; k < dim; k++) pos.push(p[k]);
  }
  return {
    positions: new Float32Array(pos),
    evals: budget,
    ms: performance.now() - t0,
  };
}

/** The tetra's direct plane arm: uniform on the divide plane (y = 0 for
 * both tetra families — asserted by the invariance check below), uniform
 * in the cross-section ball of the bound's radius; fold probe per point
 * for the face slot. */
function directPlaneCloud(subject: Subject, count: number): Cloud {
  const { construction } = subject;
  const dim = construction.dim;
  const { radius } = construction.bound;
  const scratch = makeSphairahedronScratch(dim, 1);
  const rng = mulberry32(0x5eed_e5ca);
  const pos: number[] = [];
  const p = new Array<number>(dim).fill(0);
  const t0 = performance.now();
  for (let i = 0; i < count; i++) {
    const rr = radius * Math.cbrt(rng());
    const a1 = rng() * Math.PI * 2;
    const cz = dim === 4 ? 2 * rng() - 1 : 0;
    const s2 = Math.sqrt(Math.max(0, 1 - cz * cz));
    p[0] = rr * s2 * Math.cos(a1);
    p[2] = rr * s2 * Math.sin(a1);
    p[1] = 0;
    if (dim === 4) p[3] = rr * cz;
    foldSphairahedron(construction, p, scratch);
    for (let k = 0; k < dim; k++) pos.push(p[k]);
  }
  return {
    positions: new Float32Array(pos),
    evals: count,
    ms: performance.now() - t0,
  };
}

/** The column arm: (x,z[,w]) uniform in the bound ball's equatorial
 * cross-section, y clipped to the ball's interval; scan DOWN for the first
 * + → − flip of the DE's sign (internal faces are 0-touches — union on
 * both sides — so only the union's outer boundary Λ flips), then bisect
 * the flip. Kept points sit ON the zero set. A column whose top is not
 * clean sky, or that meets a capped/pole fold mid-scan, is skipped. */
function columnCloud(
  subject: Subject,
  columns: number,
  scan: number,
  bisect: number,
): Cloud & { flipped: number; cappedCols: number; faceHist: number[] } {
  const { construction } = subject;
  const dim = construction.dim;
  const { center, radius } = construction.bound;
  const scratch = makeSphairahedronScratch(dim, 1);
  const rng = mulberry32(0x5eed_e5ca);
  const pos: number[] = [];
  const faceHist = new Array<number>(construction.foldFaces.length).fill(0);
  let flipped = 0;
  let cappedCols = 0;
  let evals = 0;
  const p = new Array<number>(dim).fill(0);
  const t0 = performance.now();
  for (let i = 0; i < columns; i++) {
    // Uniform in the equatorial cross-section (a disk / 3-ball), then the
    // column's vertical extent clipped to the ball.
    let d2 = Infinity;
    while (d2 > radius * radius) {
      d2 = 0;
      for (let k = 0; k < dim; k++) {
        p[k] = k === 1 ? 0 : center[k] + (rng() * 2 - 1) * radius;
        d2 += (p[k] - center[k]) ** 2;
      }
    }
    const half = Math.sqrt(Math.max(0, radius * radius - d2));
    const yTop = center[1] + half;
    const yBot = center[1] - half;
    p[1] = yTop;
    const deTop = foldOnce(construction, p, scratch);
    evals++;
    if (scratch.capped || scratch.skippedPole || deTop <= 0) {
      if (scratch.capped || scratch.skippedPole) cappedCols++;
      continue;
    }
    let above = yTop;
    let found = false;
    for (let s = 1; s <= scan; s++) {
      const y = yTop - ((yTop - yBot) * s) / scan;
      p[1] = y;
      const de = foldOnce(construction, p, scratch);
      evals++;
      if (scratch.capped || scratch.skippedPole) {
        // A capped fold carries no sign; the tetra's divide plane itself is
        // such a band (the 2D wall/disk fold cycles exactly on it). Advance
        // past it: the flip bracket stays the last clean + and the first
        // clean −.
        cappedCols++;
        continue;
      }
      if (de > 0) {
        above = y;
        continue;
      }
      flipped++;
      let lo = above;
      let hi = y;
      for (let b = 0; b < bisect; b++) {
        const mid = (lo + hi) / 2;
        p[1] = mid;
        const deMid = foldOnce(construction, p, scratch);
        evals++;
        if (scratch.capped || scratch.skippedPole) break;
        if (deMid > 0) lo = mid;
        else hi = mid;
      }
      p[1] = (lo + hi) / 2;
      for (let k = 0; k < dim; k++) pos.push(p[k]);
      faceHist[Math.max(scratch.lastFace, 0)]++;
      found = true;
      break;
    }
    void found;
  }
  return {
    positions: new Float32Array(pos),
    evals,
    ms: performance.now() - t0,
    flipped,
    cappedCols,
    faceHist,
  };
}

// --------------------------------------------------------- the reports

function pct(sorted: number[], q: number): number {
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? NaN
  );
}

function strideOf(subject: Subject): number {
  return subject.construction.dim === 4 ? 4 : 3;
}

function report(
  subject: Subject,
  armKey: string,
  cloud: Cloud,
  extra?: string,
): void {
  const stride = strideOf(subject);
  const n = cloud.positions.length / stride;
  const scratch = makeSphairahedronScratch(subject.construction.dim, 1);
  const p = new Array<number>(subject.construction.dim).fill(0);
  const abs: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < stride; k++) p[k] = cloud.positions[i * stride + k];
    abs.push(Math.abs(foldOnce(subject.construction, p, scratch)));
  }
  abs.sort((a, b) => a - b);
  const mean = abs.reduce((s, v) => s + v, 0) / Math.max(1, n);
  console.log(
    `    ${armKey.padEnd(28)} kept ${String(n).padStart(7)}` +
      ` (${((100 * n) / Math.max(1, cloud.evals)).toFixed(2)}% of ${cloud.evals})` +
      (Number.isFinite(cloud.ms) ? ` ${cloud.ms.toFixed(0)}ms` : "") +
      `  |de| mean ${mean.toExponential(2)} p99 ${pct(abs, 0.99).toExponential(2)} max ${(pct(abs, 1) || 0).toExponential(2)}` +
      `  ${(cloud.evals / Math.max(1, n)).toFixed(1)} evals/kept` +
      (extra ? `  ${extra}` : ""),
  );
}

function yProfile(subject: Subject, pos: Float32Array): string {
  const stride = strideOf(subject);
  const ys: number[] = [];
  for (let i = 0; i < pos.length / stride; i++)
    ys.push(Math.abs(pos[i * stride + 1]));
  ys.sort((a, b) => a - b);
  const fog = ys.filter((v) => v > 0.15).length / Math.max(1, ys.length);
  return (
    `|y| p50 ${pct(ys, 0.5).toExponential(1)} p99 ${pct(ys, 0.99).toExponential(1)} max ${pct(ys, 1).toExponential(1)}` +
    ` fog(|y|>0.15) ${(fog * 100).toFixed(2)}%`
  );
}

function bboxProfile(subject: Subject, pos: Float32Array): string {
  const stride = strideOf(subject);
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length / stride; i++)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], pos[i * stride + k]);
      hi[k] = Math.max(hi[k], pos[i * stride + k]);
    }
  return `bbox x[${lo[0].toFixed(1)},${hi[0].toFixed(1)}] y[${lo[1].toFixed(1)},${hi[1].toFixed(1)}] z[${lo[2].toFixed(1)},${hi[2].toFixed(1)}]`;
}

function splat(subject: Subject, pos: Float32Array, name: string): void {
  const stride = strideOf(subject);
  const size = 288;
  const rgb = new Uint8Array(size * size * 3);
  let lo = Infinity;
  let hi = -Infinity;
  const n = pos.length / stride;
  for (let i = 0; i < n; i++) {
    lo = Math.min(
      lo,
      pos[i * stride],
      pos[i * stride + 1],
      pos[i * stride + 2],
    );
    hi = Math.max(
      hi,
      pos[i * stride],
      pos[i * stride + 1],
      pos[i * stride + 2],
    );
  }
  const scale = (size * 0.42) / Math.max(1e-9, Math.abs(hi - lo) / 2 || 1);
  const cx = (lo + hi) / 2;
  const density = new Float32Array(size * size);
  for (let i = 0; i < n; i++) {
    const x = Math.round((pos[i * stride] - cx) * scale + size / 2);
    const y = Math.round((pos[i * stride + 2] - cx) * scale + size / 2);
    if (x < 0 || y < 0 || x >= size || y >= size) continue;
    density[y * size + x] += 1;
  }
  let max = 0;
  for (const v of density) max = Math.max(max, v);
  for (let i = 0; i < size * size; i++) {
    const g = Math.pow(density[i] / max, 0.35);
    rgb[i * 3] = Math.round(255 * g);
    rgb[i * 3 + 1] = Math.round(255 * g * 0.92);
    rgb[i * 3 + 2] = Math.round(255 * g * 0.75);
  }
  writeFileSync(`scripts/out/${name}`, encodePng(size, size, rgb));
}

// ============================================================== the tests

describe("sphaira infinite-family Points arms", () => {
  it("measures the arms", () => {
    const subjects: Subject[] = [
      build("tetra333", "tetra333"),
      build("tetra4", "tetra4"),
      build("prism2 z2=2", "prism2"),
      build("prism2 z2=1.5", "prism2", { z2: 1.5 }),
      build("cube1 no-J", "cube1"),
    ];

    for (const s of subjects) {
      const c = s.construction;
      if (c.family !== "tetra333" && c.family !== "tetra4") continue;
      const rng = mulberry32(5);
      // Divide-plane invariance: every generator leaves the plane's points
      // on it.
      let worst = 0;
      for (let i = 0; i < 200; i++) {
        const p = [rng() * 4 - 2, 0, rng() * 4 - 2];
        if (c.dim === 4) p.push(rng() * 4 - 2);
        for (const { face } of c.foldFaces) {
          if (face.kind === "sphere") {
            const cc = face.sphere.c;
            const r = face.sphere.r;
            let d2 = 0;
            for (let k = 0; k < c.dim; k++) {
              const t = p[k] - cc[k];
              d2 += t * t;
            }
            const k = (r * r) / d2;
            worst = Math.max(worst, Math.abs(cc[1] + k * (p[1] - cc[1])));
          } else {
            const pl = face.plane;
            let d = -pl.h;
            for (let k = 0; k < c.dim; k++) d += pl.n[k] * p[k];
            worst = Math.max(
              worst,
              Math.abs(p[1] - (d > 0 ? 2 * d * pl.n[1] : 0)),
            );
          }
        }
      }
      console.log(
        `\n  [${s.key}] divide-plane invariance: max |y drift| ${worst.toExponential(2)}`,
      );

      // The DE's sign just below the plane: tiles fill y<0, so the union's
      // interior reads de<0 there.
      let below = 0;
      let belowN = 0;
      for (let i = 0; i < 500; i++) {
        const p = [rng() * 4 - 2, -0.02, rng() * 4 - 2];
        if (c.dim === 4) p.push(0);
        const scratch = makeSphairahedronScratch(c.dim, 1);
        const de = foldOnce(c, p, scratch);
        if (!scratch.capped) {
          belowN++;
          if (de < 0) below++;
        }
      }
      console.log(
        `  [${s.key}] 0.02 below the plane: ${below}/${belowN} read inside the union (de<0)`,
      );
    }

    for (const s of subjects) {
      const c = s.construction;
      console.log(
        `\n  [${s.key}] dim ${c.dim} bound r=${c.bound.radius.toFixed(2)} faces ${c.foldFaces.length}`,
      );
      const walk = walkCloud(s);
      report(s, "W walk (ask 5000)", walk, bboxProfile(s, walk.positions));
      const direct = directPlaneCloud(s, 3000);
      report(s, "D direct plane (3000)", direct, yProfile(s, direct.positions));
      for (const shell of [0.01, 0.02, 0.05]) {
        const both = rejectionCloud(s, 200_000, armR("both", shell, null));
        report(
          s,
          `R both s=${shell} (200k)`,
          both,
          yProfile(s, both.positions),
        );
        const out = rejectionCloud(s, 200_000, armR("outside", shell, null));
        report(s, `R out s=${shell} (200k)`, out, yProfile(s, out.positions));
      }
      const capped = rejectionCloud(s, 200_000, armR("outside", 0.05, 1e3));
      report(
        s,
        "R out s=0.05 λ<=1e3 (200k)",
        capped,
        yProfile(s, capped.positions),
      );
      const col = columnCloud(s, 200_000, 24, 30);
      report(
        s,
        `C column scan=24 b=30 (200k)`,
        col,
        `flips ${((100 * col.flipped) / 200_000).toFixed(1)}% cappedCols ${col.cappedCols} ` +
          `faceSlots [${col.faceHist.join(",")}] ` +
          yProfile(s, col.positions),
      );
      const shipped = sampleSphairahedronCloud(
        s.construction,
        30_000,
        mulberry32(0x5eed_e5ca),
      );
      report(
        s,
        "SHIPPED sampler (ask 30k)",
        { positions: shipped.positions, evals: 30_000, ms: NaN },
        yProfile(s, shipped.positions),
      );
    }

    const prism = build("prism2 z2=2", "prism2");
    splat(
      prism,
      sampleSphairahedronCloud(
        prism.construction,
        120_000,
        mulberry32(0x5eed_e5ca),
      ).positions,
      "sphaira-points-terrain-col.png",
    );
    const tetra = build("tetra333", "tetra333");
    splat(
      tetra,
      sampleSphairahedronCloud(
        tetra.construction,
        120_000,
        mulberry32(0x5eed_e5ca),
      ).positions,
      "sphaira-points-tetra-col.png",
    );
    const cube = build("cube1 no-J", "cube1");
    splat(
      cube,
      sampleSphairahedronCloud(
        cube.construction,
        120_000,
        mulberry32(0x5eed_e5ca),
      ).positions,
      "sphaira-points-cube1-col.png",
    );
    splat(
      tetra,
      rejectionCloud(tetra, 400_000, armR("both", 0.02, null)).positions,
      "sphaira-points-tetra-fog.png",
    );
  }, 900_000);
});
