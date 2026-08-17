/**
 * fr-b8o5 — HOW LOOSE IS A 4D DE AS A BOUND ON THE SLICE IT MARCHES, AND
 * DOES AN OFF-CENTRE SLICE COST MORE TO MARCH?
 *
 * `surface-de-4d.ts`'s module doc has carried an open question since fr-beck
 * minted it (THE SLICE CAVEAT): the estimators certify distance to the whole
 * 4D attractor `A`, the tracer only ever meets the slice `A ∩ {w = w0}`, and
 *
 *     dist4((p, w0), A) <= dist3(p, A ∩ {w = w0})
 *
 * so the bound is SAFE but can fall short — "stalling the march or reading as
 * ghostly, oversized bulges", with "measuring exactly how loose — is the gap
 * small enough for a real render, or does it need slice-aware tightening" left
 * to a later session. fr-b8o5 is that session, because the bead's own
 * hypothesis for a measured 20-40x app cost cliff at off-centre slices was
 * exactly this gap.
 *
 * This sheet measures the gap against GROUND TRUTH rather than against another
 * bound. A big seeded 4D chaos game stands in for `A`, and per query point in
 * the slice it reports three numbers:
 *
 *   t4      = DE / dist4(query, cloud)                  — the bound's own
 *                                                         4D looseness
 *   tSlice  = DE / dist3(query, cloud ∩ slab)           — its looseness as
 *                                                         a SLICE bound
 *   penalty = tSlice / t4 = dist4 / dist3               — THE SLICE CAVEAT's
 *                                                         own quantity
 *
 * A `penalty` near 1 means the nearest 4D structure is in the slice anyway and
 * slice-aware tightening has nothing to win; a `penalty` that collapses toward
 * 0 as `w0` moves off centre is the bead's hypothesis. Both cloud distances
 * are sampled, so both are UPPER bounds on the true distances and every ratio
 * printed is a LOWER bound on the real looseness — the measurement can
 * understate the problem, never invent one.
 *
 * The slab half-thickness `h` matters and is swept: `A ∩ slab(h)` contains
 * `A ∩ plane`, so `dist3(·, slab)` UNDER-estimates the plane's distance and
 * the penalty printed at any `h > 0` is again the conservative reading. The
 * shipped slider position is `h = 0`, which no point cloud can sample.
 *
 * The second half is the app-facing one: the SHARED CPU marcher over the same
 * sweep, so the step counts, the exhausted-ray tally and the wall cost per ray
 * can be read against the same `w0` column. Its camera sits at the shared
 * marcher's default framing and is FIXED across a sweep — the app scrubs the
 * slice without moving the camera — so the panels are silhouettes rather than
 * the app's own screen coverage, and the app-realistic cost lives in
 * `scripts/slice-cliff.probe.mjs` instead. What this half is for is the
 * SHAPE across `w0` on identical rays, and for that the framing only has to
 * be constant.
 *
 * MEASURED VERDICT (2026-08-17, Node f64, this machine — tables below):
 *
 *  - THE SLICE CAVEAT IS EMPIRICALLY SMALL AND DOES NOT GROW OFF CENTRE.
 *    Median penalty, `w0 = 0` -> `0.5R`: plain4 0.91 -> 0.82 (p10 0.60 ->
 *    0.58), kaleido4 0.94 -> 0.85 (p10 0.80 -> 0.73). The 4D distance is
 *    already ~90% of the in-slice distance at the median, at EVERY offset —
 *    the 4D structure nearest a point in a slice is, at the median,
 *    structure that slice itself cuts. Shrinking the ground-truth slab 4x
 *    (h = 0.02R -> 0.005R) moves the medians by at most 0.03, so the h -> 0
 *    limit the app actually marches is the same picture.
 *  - THE ESTIMATOR'S OWN CONSERVATIVENESS DWARFS IT: `t4` (DE / dist4) sits
 *    at 0.66-0.72 on both scenes — the beam's sigma_min products and dropped
 *    branches cost a third of the distance, three times what the slice does,
 *    and that gap is flat in `w0` too.
 *  - THE MARCH AGREES: steps/ray 1.96-2.17 (plain4) and 2.42-2.86
 *    (kaleido4) across the WHOLE sweep, zero exhausted rays at every row,
 *    us/ray flat to falling. Nothing here reproduces a 20-40x cliff at any
 *    offset on either scene.
 *  - So slice-aware certificates (pruning the branches whose bounding ball
 *    cannot reach the marched slab, and pricing the rest against the disc the
 *    slab cuts) were BUILT AND MEASURED for this bead and NOT SHIPPED: on
 *    these systems they buy ~10% fewer march steps for 1.4-2.2x the work per
 *    evaluation. The bead carries the full A/B; this sheet carries the reason
 *    it was never needed.
 *  - The app-level cliff itself does not reproduce either — see
 *    `scripts/slice-cliff.probe.mjs`, which measures it in a real browser on
 *    the real driver: a `plain4` session settles in 12.1s at `w0 = 0` and
 *    9.1s at `w0 = 0.3` on the WebGL arm, 3.03s and 2.98s on the compute
 *    arm, flat across the whole offset sweep on both.
 *
 * Run: npx vitest run --config scripts/vitest.harness.config.ts scripts/slice-cost.harness.ts
 */
import {
  buildSurfaceDE4,
  estimateDistance4Refined,
} from "../src/fractal/surface-de-4d";
import type { SurfaceDE4 } from "../src/fractal/surface-de-4d";
import { runChaosGame4 } from "../src/fractal/chaos-game-4d";
import { toTransform4 } from "../src/fractal/affine4";
import { mulberry32 } from "../src/fractal/rng";
import type { SymmetryParams, Transform, Vec4 } from "../src/fractal/types";
import { renderPreview, writeContactSheet } from "./de-preview";
import type { PanelStats } from "./de-preview";

/** `scripts/surface-4d.verify.mjs`'s `plain4` scene, transcribed from its
 * `#v1=` hash: three maps, one with a live `w` block, no kaleidoscope. */
function plain4(): Transform[] {
  return [
    {
      id: 0,
      position: [0.5, 0, 0],
      rotation: [0, 0, 0],
      scale: [0.5, 0.5, 0.5],
      w: { position: 0.5, rotation: { xw: 0.3 } },
    },
    {
      id: 1,
      position: [-0.25, 0.43, 0],
      rotation: [0, 0, 0],
      scale: [0.5, 0.5, 0.5],
    },
    {
      id: 2,
      position: [-0.25, -0.43, 0],
      rotation: [0, 0, 0],
      scale: [0.5, 0.5, 0.5],
    },
  ];
}

/** The same script's `kaleido4` — the scene fr-b8o5 measured in the app: two
 * maps with live `w` blocks under an order-6 `xz` kaleidoscope with a twist-1
 * double rotation. */
function kaleido4(): Transform[] {
  return [
    {
      id: 0,
      position: [0.4, 0.2, 0],
      rotation: [0, 0, 0],
      scale: [0.5, 0.5, 0.5],
      w: { position: 0.4, rotation: { xw: 0.3 } },
    },
    {
      id: 1,
      position: [-0.4, -0.2, 0],
      rotation: [0, 0, 0],
      scale: [0.5, 0.5, 0.5],
      w: { position: -0.4, rotation: { yw: 0.3 } },
    },
  ];
}

/** Slice offsets as a fraction of `de.boundingRadius`. The app's slider is
 * normalized rotated-w and `scene.ts` converts it through `wSupport`, so one
 * ArrowRight (0.01 of [-1, 1]) lands in the same class as `f = 0.01` here. */
const FRACTIONS = [0, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.3, 0.5];

/** Slab half-thicknesses the ground-truth membership window is sampled at,
 * as fractions of the bounding radius. The shipped slider position is 0,
 * which a point cloud cannot sample — these bracket it from above. */
const SLAB_FRACTIONS = [0.02, 0.005];

const CLOUD_POINTS = 600000;
const QUERIES = 200;
const SIZE = 96;
/** The app's full-tier march budget (`render-tier.ts`'s top rung). */
const MAX_STEPS = 160;

interface Cloud {
  xyz: Float32Array;
  w: Float32Array;
  count: number;
}

function buildCloud(transforms: Transform[], symmetry?: SymmetryParams): Cloud {
  const r = runChaosGame4(
    transforms.map(toTransform4),
    CLOUD_POINTS,
    mulberry32(20250817),
    null,
    symmetry,
  );
  return { xyz: r.positions, w: r.w, count: r.count };
}

/** Seeded uniform points of a ball of radius `r`, as 4D queries at `w0`
 * (identity view rotor, so a marched 3D point lifts straight to `(p, w0)`). */
function sliceQueries(
  r: number,
  w0: number,
  count: number,
  seed: number,
): Vec4[] {
  const rng = mulberry32(seed);
  const out: Vec4[] = [];
  while (out.length < count) {
    const x = (rng() - 0.5) * 2;
    const y = (rng() - 0.5) * 2;
    const z = (rng() - 0.5) * 2;
    if (x * x + y * y + z * z > 1) continue;
    out.push([x * r, y * r, z * r, w0]);
  }
  return out;
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

interface SystemDef {
  label: string;
  fileTag: string;
  transforms: Transform[];
  symmetry?: SymmetryParams;
}

const SYSTEMS: SystemDef[] = [
  {
    label: "plain4 (3 maps, one live w block, no kaleidoscope)",
    fileTag: "plain4",
    transforms: plain4(),
  },
  {
    label: "kaleido4 (2 maps, order 6 xz twist 1 — the bead's own scene)",
    fileTag: "kaleido4",
    transforms: kaleido4(),
    symmetry: { order: 6, plane: "xz", twist: 1 },
  },
];

describe("fr-b8o5 4D slice tightness and march cost", () => {
  it("measures the slice bound's gap against a chaos-game ground truth", () => {
    console.log(
      "fr-b8o5 A: how loose is the 4D DE as a bound on the slice it marches?",
    );
    console.log(
      `${String(CLOUD_POINTS)}-point seeded cloud as ground truth, ${String(QUERIES)} uniform-ball`,
    );
    console.log(
      "queries per row. t4 = DE/dist4, tSlice = DE/dist3(slab), penalty = dist4/dist3.",
    );
    console.log(
      "Both truths are SAMPLED, so every ratio is a lower bound on the real looseness.",
    );
    for (const sys of SYSTEMS) {
      const de = sys.symmetry
        ? buildSurfaceDE4(sys.transforms, null, sys.symmetry)
        : buildSurfaceDE4(sys.transforms);
      const cloud = buildCloud(sys.transforms, sys.symmetry);
      console.log(
        `\n${sys.label}  (R = ${de.boundingRadius.toFixed(4)}, cloud ${String(cloud.count)})`,
      );
      for (const hf of SLAB_FRACTIONS) {
        const h = hf * de.boundingRadius;
        console.log(`  slab half-thickness h = ${hf.toFixed(3)}R`);
        for (const f of FRACTIONS) {
          const w0 = f * de.boundingRadius;
          // Members of the marched slab, gathered once per row.
          const mx: number[] = [];
          for (let i = 0; i < cloud.count; i++) {
            if (Math.abs(cloud.w[i] - w0) <= h) {
              mx.push(
                cloud.xyz[i * 3],
                cloud.xyz[i * 3 + 1],
                cloud.xyz[i * 3 + 2],
              );
            }
          }
          const t4s: number[] = [];
          const tss: number[] = [];
          const pens: number[] = [];
          for (const p of sliceQueries(de.boundingRadius, w0, QUERIES, 5100)) {
            const est = estimateDistance4Refined(de, p, 0);
            let best4 = Infinity;
            for (let i = 0; i < cloud.count; i++) {
              const dx = p[0] - cloud.xyz[i * 3];
              const dy = p[1] - cloud.xyz[i * 3 + 1];
              const dz = p[2] - cloud.xyz[i * 3 + 2];
              const dw = p[3] - cloud.w[i];
              const dd = dx * dx + dy * dy + dz * dz + dw * dw;
              if (dd < best4) best4 = dd;
            }
            let best3 = Infinity;
            for (let i = 0; i < mx.length; i += 3) {
              const dx = p[0] - mx[i];
              const dy = p[1] - mx[i + 1];
              const dz = p[2] - mx[i + 2];
              const dd = dx * dx + dy * dy + dz * dz;
              if (dd < best3) best3 = dd;
            }
            const d4 = Math.sqrt(best4);
            const d3 = Math.sqrt(best3);
            if (!(d4 > 1e-9) || !(d3 > 1e-9) || !Number.isFinite(d3)) continue;
            t4s.push(est / d4);
            tss.push(est / d3);
            pens.push(d4 / d3);
          }
          t4s.sort((a, b) => a - b);
          tss.sort((a, b) => a - b);
          pens.sort((a, b) => a - b);
          if (pens.length === 0) {
            console.log(
              `   f=${f.toFixed(3)} w0=${w0.toFixed(4)} slab members ${String(mx.length / 3)} — EMPTY SLICE, no ground truth`,
            );
            continue;
          }
          console.log(
            `   f=${f.toFixed(3)} w0=${w0.toFixed(4)} members ${String(mx.length / 3).padStart(6)}` +
              `  t4 p50 ${percentile(t4s, 0.5).toFixed(2)} p10 ${percentile(t4s, 0.1).toFixed(2)}` +
              `  tSlice p50 ${percentile(tss, 0.5).toFixed(2)} p10 ${percentile(tss, 0.1).toFixed(2)}` +
              `  penalty p50 ${percentile(pens, 0.5).toFixed(2)} p10 ${percentile(pens, 0.1).toFixed(2)} min ${pens[0].toFixed(2)}`,
          );
        }
      }
    }
    expect(SYSTEMS.length).toBe(2);
  });

  it("marches the same sweep and reports the step/exhaustion split", () => {
    console.log(
      `\nfr-b8o5 B: the shared CPU marcher over the same sweep. ${String(SIZE)}px panels,`,
    );
    console.log(
      "maxSteps 160 (the app's full tier), camera FIXED at de.boundingRadius across",
    );
    console.log(
      "each sweep — the app scrubs the slice without moving the camera.",
    );
    for (const sys of SYSTEMS) {
      const de: SurfaceDE4 = sys.symmetry
        ? buildSurfaceDE4(sys.transforms, null, sys.symmetry)
        : buildSurfaceDE4(sys.transforms);
      console.log(`\n${sys.label}`);
      const panels: PanelStats[] = [];
      let base = 0;
      for (const f of FRACTIONS) {
        const w0 = f * de.boundingRadius;
        const panel = renderPreview(
          {
            de: (p) => estimateDistance4Refined(de, [p[0], p[1], p[2], w0], 0),
            boundingRadius: de.boundingRadius,
            stepScale: de.stepScale,
            maxSteps: MAX_STEPS,
            ao: false,
            shadow: false,
            collect: true,
          },
          SIZE,
        );
        const rays = SIZE * SIZE;
        const usPerRay = (panel.ms * 1000) / rays;
        if (f === 0) base = usPerRay;
        console.log(
          `   f=${f.toFixed(3)} w0=${w0.toFixed(4)}` +
            ` hits ${String(panel.hits).padStart(5)}` +
            ` exhausted ${String(panel.exhausted).padStart(5)}` +
            ` steps/ray ${(panel.steps / rays).toFixed(2).padStart(6)}` +
            ` us/ray ${usPerRay.toFixed(1).padStart(7)}` +
            ` x ${(usPerRay / base).toFixed(2).padStart(5)}`,
        );
        panels.push(panel);
      }
      writeContactSheet(panels, 3, `slice-cost-${sys.fileTag}.png`);
      expect(panels.length).toBe(FRACTIONS.length);
    }
  });
});
