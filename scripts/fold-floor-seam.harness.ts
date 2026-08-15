/**
 * fr-uec4: the sheet that EXONERATED the authored fold lengths.
 *
 * The reported crash was Firefox dying outright while the Min/Fixed radius and
 * Box limit sliders were dragged on a Sierpinski tetra with a mandelbox map and
 * the Floor option on, which pointed straight at fr-s9ll. This asks the
 * cheapest version of that question — no browser, no GPU: does the ESTIMATOR
 * itself blow up anywhere inside the region the sliders can reach?
 *
 * MEASURED VERDICT: no. Across the whole admissible band and both box-limit
 * extremes, every DE value is finite, the bounding radius never moves off
 * 1.77, per-eval cost stays inside a factor of ~10 with no trend toward the
 * seam, and maxDepth saturates politely at MAX_DESCENT_DEPTH (128) from
 * mR/fR ~ 0.73 down. The real defect was elsewhere entirely — a synchronous
 * device.destroy() under an in-flight compute frame; see
 * scripts/fold-floor-crash.repro.mjs. This stays as the executable record of
 * why the radii were ruled out, and as a map of the seam itself.
 *
 * NOTE the UI reaches less of this space than the sheet sweeps: ui.ts clamps
 * minRadius to [0.01, fixedRadius], fixedRadius to [0.01, 3] and boxLimit to
 * [0, 3], so the wilder rows here are document-level values only.
 *
 * The seam is exact arithmetic. A tetra map has sigma_max = 0.5, so a pure
 * mandelbox map's composite Lipschitz bound is |w| · (fR²/mR²) · 0.5, and
 * `analyzeSurfaceSystem` admits while that stays under CONTRACTION_LIMIT
 * (0.999) — i.e. while mR/fR > sqrt(0.5/0.999) ≈ 0.7075. The UI clamps
 * mR <= fR, so the whole admissible window is a narrow band of the slider's
 * travel, and its lower edge is where the certified per-level shrink factor
 * approaches 1.
 */
import { describe, it } from "vitest";

import { sierpinskiTetrahedron } from "../src/fractal/presets";
import {
  analyzeSurfaceSystem,
  buildSurfaceDE,
  estimateDistanceRefined,
} from "../src/fractal/surface-de";
import { analyzeEscapeSystem } from "../src/fractal/escape-de";
import { mulberry32 } from "../src/fractal/rng";
import type { Transform, Vec3 } from "../src/fractal/types";

/** The tetra with map 0 turned into a pure mandelbox fold carrying the three
 * authored lengths — the shape the reporter was editing. */
function foldedTetra(
  minRadius: number,
  fixedRadius: number,
  boxLimit: number,
): Transform[] {
  const maps = sierpinskiTetrahedron();
  maps[0] = {
    ...maps[0],
    variations: [
      { type: "mandelbox", weight: 1, minRadius, fixedRadius, boxLimit },
    ],
  };
  return maps;
}

/** Queries spread over the bounding ball, seeded so every row prices the
 * same work. */
function probePoints(radius: number, n: number): Vec3[] {
  const rng = mulberry32(0x51a6);
  const pts: Vec3[] = [];
  while (pts.length < n) {
    const p: Vec3 = [
      (rng() * 2 - 1) * radius * 1.5,
      (rng() * 2 - 1) * radius * 1.5,
      (rng() * 2 - 1) * radius * 1.5,
    ];
    pts.push(p);
  }
  return pts;
}

interface Row {
  label: string;
  ifs: string;
  escape: string;
  slowestSigma: number | null;
  maxDepth: number | null;
  boundingRadius: number | null;
  usPerEval: number | null;
  worstUs: number | null;
  nonFinite: number;
}

function measure(
  label: string,
  minRadius: number,
  fixedRadius: number,
  boxLimit: number,
): Row {
  const maps = foldedTetra(minRadius, fixedRadius, boxLimit);
  const ifs = analyzeSurfaceSystem(maps, null);
  const escape = analyzeEscapeSystem(maps, null);
  const row: Row = {
    label,
    ifs: ifs.status === "ineligible" ? `no (${ifs.reasons[0]})` : ifs.status,
    escape:
      escape.status === "ineligible" ? `no (${escape.reasons[0]})` : "eligible",
    slowestSigma: null,
    maxDepth: null,
    boundingRadius: null,
    usPerEval: null,
    worstUs: null,
    nonFinite: 0,
  };
  if (ifs.status === "ineligible") return row;

  const de = buildSurfaceDE(maps, null);
  row.slowestSigma = de.slowestSigma;
  row.maxDepth = de.maxDepth;
  row.boundingRadius = de.boundingRadius;

  const pts = probePoints(de.boundingRadius, 300);
  let worst = 0;
  const t0 = performance.now();
  for (const p of pts) {
    const s = performance.now();
    const d = estimateDistanceRefined(de, p);
    const dt = performance.now() - s;
    if (dt > worst) worst = dt;
    if (!Number.isFinite(d)) row.nonFinite++;
  }
  const total = performance.now() - t0;
  row.usPerEval = (total / pts.length) * 1000;
  row.worstUs = worst * 1000;
  return row;
}

describe("fr-uec4: the fold-radii eligibility seam on a Sierpinski tetra", () => {
  it("prices the DE across the Min Radius slider's travel", () => {
    const rows: Row[] = [];
    // fR and boxLimit at their classic values; walk mR down from its ceiling
    // (mR = fR) toward the seam at mR/fR ≈ 0.7075.
    for (const ratio of [
      1.0, 0.95, 0.9, 0.85, 0.8, 0.78, 0.76, 0.75, 0.74, 0.73, 0.72, 0.715,
      0.71, 0.708, 0.7075, 0.707, 0.7, 0.6, 0.5,
    ]) {
      rows.push(measure(`mR/fR = ${ratio.toFixed(4)}`, ratio, 1, 1));
    }
    // The same ratios reached by moving fR instead, to confirm the seam is the
    // RATIO and not either length (fr-qi9c's dimensionless-ratio claim).
    rows.push(measure("mR 1.4 / fR 2 (ratio 0.700)", 1.4, 2, 1));
    rows.push(measure("mR 1.5 / fR 2 (ratio 0.750)", 1.5, 2, 1));
    // Box limit sweep at a fixed, admissible radius ratio.
    for (const wall of [0.001, 0.01, 0.1, 0.5, 1, 2, 8, 64]) {
      rows.push(measure(`boxLimit ${wall} (mR/fR 0.75)`, 0.75, 1, wall));
    }

    const fmt = (v: number | null, digits = 3): string =>
      v === null ? "—" : v.toFixed(digits);
    console.log(
      "\n" +
        [
          "case".padEnd(30),
          "IFS gate".padEnd(34),
          "sigma".padEnd(8),
          "depth".padEnd(6),
          "R".padEnd(8),
          "us/eval".padEnd(10),
          "worst us".padEnd(11),
          "nonfinite",
        ].join(" "),
    );
    for (const r of rows) {
      console.log(
        [
          r.label.padEnd(30),
          r.ifs.padEnd(34),
          fmt(r.slowestSigma).padEnd(8),
          (r.maxDepth === null ? "—" : String(r.maxDepth)).padEnd(6),
          fmt(r.boundingRadius, 2).padEnd(8),
          fmt(r.usPerEval, 1).padEnd(10),
          fmt(r.worstUs, 1).padEnd(11),
          String(r.nonFinite),
        ].join(" "),
      );
    }
  });
});
