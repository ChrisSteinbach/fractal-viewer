/**
 * fr-b72d attribution harness: the CPU oracle's OWN per-query cost curve
 * over kaleidoscope order, on EXACTLY the bench sweep leg's query mixes.
 *
 * The extended `--surface-aff4-sweep=1` leg measured (real Iris Xe,
 * 2026-08-11, /tmp/aff4-probe1) that the affine4 eval kernel's per-query
 * cost grows ~14.4x from order 1 to order 6 (naive sweep-work ratio: 6x)
 * and the fold4 kernel's ~76x — while the uniform-vs-storage maps A/B
 * moved NOTHING (0.99-1.02x on fold4, 0.79-1.02x on affine4), refuting the
 * maps-load hypothesis, and fold4 carries no `refinedCert` at all,
 * refuting the divergence-amplified-refinement hypothesis. SwiftShader
 * (CPU raster) reproduced both curve SHAPES (~21.8x / ~75x), which points
 * away from any Tint/ANV realization pathology and at the ALGORITHM doing
 * superlinear work per query as order grows.
 *
 * This harness closes the attribution: it times `estimateDistance4Refined`
 * (the affine4 kernel's oracle) and plain `estimateDistance4` (the fold4
 * kernel's refine=false oracle) on the SAME systems (the bench's
 * `surfaceAff4Kaleido` / `surfaceFold4Boxfold` fixtures under
 * `{ order, plane: "xz", twist: 1 }`), the SAME frozen view (identity
 * rotor, `w0 = 0.2 · boundingRadius`, zero slice thickness) and the SAME
 * 700-query mixes (seeds 900+order / 1900+order, the bench's
 * `affine4Queries` copied verbatim — 400 uniform-ball + 200 chord-bisected
 * near-boundary + 100 near-origin), per order in {1, 2, 3, 4, 6}.
 *
 * What the three possible outcomes would mean:
 *  - CPU mean/query grows ~linearly (≈ the 6x work ratio): the GPU
 *    superlinearity is realization-specific after all (SIMD lanes pay
 *    max-over-group where the CPU pays per-query cost) — the per-query
 *    DISTRIBUTION percentiles printed below then show whether the tail
 *    widens with order (E[max over lanes] bridges a linear mean to a
 *    superlinear group cost only if it does).
 *  - CPU mean/query grows like the GPU's curve (~14x/~76x at order 6):
 *    the superlinearity is ALGORITHMIC — higher order feeds the beam more
 *    candidate images per level, the kept-best chains track the attractor
 *    longer before escaping/pinning, and every extra level costs O(order)
 *    more sweep work on top (depth growth × per-level growth). PR #206's
 *    "the CPU oracle is flat across orders" claim was measured on
 *    different mixes and does not survive on these.
 *  - Something in between: both mechanisms are live; the printed
 *    mean-vs-p95-vs-max decomposition apportions them.
 *
 * MEASURED VERDICT (2026-08-11, Node f64, this machine — recorded on the
 * fr-b72d bead): the superlinearity is ALGORITHMIC. CPU mean/query,
 * normalized to each core's order-1 mean: affine4 x1.8 / x4.9 / x6.4 /
 * x13.5 at orders 2/3/4/6 (GPU measured x14.4 at order 6) — matching the
 * GPU curve almost exactly, far above the 6x naive sweep-work ratio;
 * fold4 x4.5 / x12.7 / x24.7 / x58.9 (GPU x76.4 — a ~30% realization
 * residual on top of the x59 algorithmic base, small beside it). The
 * p95 curve grows the same way (affine4 x16.7, fold4 x49.7 at order 6) —
 * the whole distribution shifts, not just a widening tail — so SIMD
 * max-over-lanes adds little and there is nothing
 * kernel-realization-shaped left to chase: the compute-vs-fragment
 * app-level gap at order 6 is NOT the eval kernel's own curve (both arms'
 * estimators pay this same algorithmic growth; the fragment arm settled
 * the same order-6 scene in 10.9s), it lives in the arms'
 * march-loop/query-distribution differences (fr-b8o5's territory; the
 * follow-up bead filed from this session).
 *
 * Run: npx vitest run --config scripts/vitest.harness.config.ts scripts/aff4-order-cpu.harness.ts
 */
import {
  analyzeSurfaceSystem4,
  buildSurfaceDE4,
} from "../src/fractal/surface-de-4d";
import {
  estimateDistance4,
  estimateDistance4Refined,
} from "../src/fractal/surface-de-4d";
import type { SurfaceDE4 } from "../src/fractal/surface-de-4d";
import { mulberry32 } from "../src/fractal/rng";
import type {
  SymmetryParams,
  Transform,
  Vec3,
  Vec4,
} from "../src/fractal/types";

/** The bench's `surfaceAff4Kaleido` fixture, copied verbatim (gpu-bench
 * main.ts) — two contracting maps with live w blocks. */
function surfaceAff4Kaleido(): Transform[] {
  return [
    {
      id: 0,
      position: [0.45, 0.1, 0.2],
      rotation: [0, 0.2, 0],
      scale: [0.55, 0.55, 0.55],
      w: { position: 0.3, rotation: { xw: 0.35 } },
    },
    {
      id: 1,
      position: [-0.2, 0.4, -0.3],
      rotation: [0.15, 0, 0.1],
      scale: [0.5, 0.5, 0.5],
      w: { position: -0.2, rotation: { zw: 0.25 } },
    },
  ];
}

/** The bench's `surfaceFold4Boxfold` fixture, copied verbatim (gpu-bench
 * main.ts; `surface-de-4d.test.ts`'s `pureBoxfoldPair4`). */
function surfaceFold4Boxfold(): Transform[] {
  return [
    {
      id: 0,
      position: [0.4, 0.1, 0],
      rotation: [0.3, 0.2, 0],
      scale: [0.45, 0.45, 0.45],
      w: { position: 0.3, rotation: { xw: 0.3 } },
      variations: [{ type: "boxfold", weight: 1 }],
    },
    {
      id: 1,
      position: [-0.35, -0.2, 0.3],
      rotation: [0, 0.5, 0.1],
      scale: [0.5, 0.5, 0.5],
      w: { position: -0.3, rotation: { xw: 0.3 } },
      variations: [{ type: "boxfold", weight: 0.9 }],
    },
  ];
}

interface FrozenView {
  rotor: number[];
  w0: number;
  sliceHalfW: number;
}

/** The sweep leg's frozen view recipe: identity rotor, w0 at 20% of the
 * bounding radius, zero thickness. */
function buildSystem(
  transforms: Transform[],
  order: number,
): { de: SurfaceDE4; view4: FrozenView } {
  const symmetry: SymmetryParams = { order, plane: "xz", twist: 1 };
  const eligibility = analyzeSurfaceSystem4(transforms, null);
  if (eligibility.status === "ineligible") {
    throw new Error(
      `order ${String(order)} ineligible: ${eligibility.reasons.join("; ")}`,
    );
  }
  const de = buildSurfaceDE4(transforms, null, symmetry);
  return {
    de,
    view4: {
      rotor: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      w0: 0.2 * de.boundingRadius,
      sliceHalfW: 0,
    },
  };
}

/** The bench's `estimateSurface4Composed`, copied verbatim: view lift
 * (rotor transpose · (q, w0)) then the inner estimator at cutoff 0 —
 * `refined` picks the affine4 kernel's oracle, `false` the fold4 one. */
function estimateComposed(
  de: SurfaceDE4,
  view4: FrozenView,
  q: Vec3,
  refined: boolean,
): number {
  const rot = view4.rotor;
  const p: Vec4 = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    p[i] =
      rot[i] * q[0] +
      rot[4 + i] * q[1] +
      rot[8 + i] * q[2] +
      rot[12 + i] * view4.w0;
  }
  return refined
    ? estimateDistance4Refined(de, p, 0, null)
    : estimateDistance4(de, p, null);
}

/** The bench's `affine4Queries` mix, copied verbatim (400 uniform-ball +
 * 200 chord-bisected near-boundary + 100 near-origin; `surface4ToleranceR`
 * inlined — these fixtures carry no final/foldFinal, so it is
 * `boundingRadius`). */
function queryMix(
  de: SurfaceDE4,
  view4: FrozenView,
  seed: number,
  refined: boolean,
): Vec3[] {
  const R4 = de.boundingRadius;
  const visR = R4;
  const minW = Math.max(Math.abs(view4.w0) - view4.sliceHalfW, 0);
  const sliceVisRRaw = Math.sqrt(Math.max(visR * visR - minW * minW, 0));
  const sliceVisR = sliceVisRRaw > 0 ? sliceVisRRaw : 0.5 * R4;
  const rq = 1.2 * Math.max(sliceVisR, 0.25 * R4);
  const rng = mulberry32(seed);
  const out: Vec3[] = [];
  const uniformBallPoint = (): Vec3 => {
    for (;;) {
      const x = (rng() - 0.5) * 2;
      const y = (rng() - 0.5) * 2;
      const z = (rng() - 0.5) * 2;
      if (x * x + y * y + z * z <= 1) {
        return [x * rq, y * rq, z * rq];
      }
    }
  };
  for (let i = 0; i < 400; i++) {
    const p = uniformBallPoint();
    out.push([Math.fround(p[0]), Math.fround(p[1]), Math.fround(p[2])]);
  }
  const threshold = 0.02 * R4;
  const nearBoundary = (p: Vec3): boolean =>
    estimateComposed(de, view4, p, refined) < threshold;
  for (let i = 0; i < 200; i++) {
    let a: Vec3 = [
      (rng() - 0.5) * 0.5 * rq,
      (rng() - 0.5) * 0.5 * rq,
      (rng() - 0.5) * 0.5 * rq,
    ];
    let b = uniformBallPoint();
    const pa = nearBoundary(a);
    for (let step = 0; step < 24; step++) {
      const mid: Vec3 = [
        (a[0] + b[0]) / 2,
        (a[1] + b[1]) / 2,
        (a[2] + b[2]) / 2,
      ];
      if (nearBoundary(mid) === pa) {
        a = mid;
      } else {
        b = mid;
      }
    }
    out.push([Math.fround(a[0]), Math.fround(a[1]), Math.fround(a[2])]);
  }
  for (let i = 0; i < 100; i++) {
    const s = rng() * 0.5 * rq;
    out.push([
      Math.fround((rng() - 0.5) * s),
      Math.fround((rng() - 0.5) * s),
      Math.fround((rng() - 0.5) * s),
    ]);
  }
  return out;
}

const ORDERS = [1, 2, 3, 4, 6];

interface OrderStats {
  order: number;
  meanUs: number;
  p50Us: number;
  p95Us: number;
  maxUs: number;
}

function timeCore(
  name: "affine4" | "fold4",
  transforms: Transform[],
  refined: boolean,
  seedBase: number,
): OrderStats[] {
  const stats: OrderStats[] = [];
  for (const order of ORDERS) {
    const { de, view4 } = buildSystem(transforms, order);
    const queries = queryMix(de, view4, seedBase + order, refined);
    // One untimed pass warms JIT/caches; the timed pass stamps each query.
    for (const q of queries) estimateComposed(de, view4, q, refined);
    const perQueryUs: number[] = [];
    for (const q of queries) {
      const t0 = process.hrtime.bigint();
      estimateComposed(de, view4, q, refined);
      const t1 = process.hrtime.bigint();
      perQueryUs.push(Number(t1 - t0) / 1000);
    }
    const sorted = [...perQueryUs].sort((a, b) => a - b);
    const mean = perQueryUs.reduce((a, b) => a + b, 0) / perQueryUs.length;
    stats.push({
      order,
      meanUs: mean,
      p50Us: sorted[Math.floor(sorted.length * 0.5)],
      p95Us: sorted[Math.floor(sorted.length * 0.95)],
      maxUs: sorted[sorted.length - 1],
    });
    console.log(
      `${name} order ${String(order)}: mean=${mean.toFixed(2)}us ` +
        `p50=${stats[stats.length - 1].p50Us.toFixed(2)} ` +
        `p95=${stats[stats.length - 1].p95Us.toFixed(2)} ` +
        `max=${stats[stats.length - 1].maxUs.toFixed(2)} (n=${String(queries.length)})`,
    );
  }
  const base = stats[0].meanUs;
  console.log(
    `${name} mean growth vs order 1: ` +
      stats
        .map((s) => `o${String(s.order)}=x${(s.meanUs / base).toFixed(1)}`)
        .join(" "),
  );
  const p95Base = stats[0].p95Us;
  console.log(
    `${name} p95 growth vs order 1:  ` +
      stats
        .map((s) => `o${String(s.order)}=x${(s.p95Us / p95Base).toFixed(1)}`)
        .join(" "),
  );
  return stats;
}

describe("fr-b72d aff4 order-curve CPU attribution harness", () => {
  it("times both CPU oracles on the bench sweep mixes across kaleidoscope orders", () => {
    console.log(
      "fr-b72d CPU attribution: per-query cost of the kernels' own oracles",
    );
    console.log(
      "on the bench sweep leg's exact systems/views/mixes (see file doc).",
    );
    const affine4 = timeCore("affine4", surfaceAff4Kaleido(), true, 900);
    const fold4 = timeCore("fold4", surfaceFold4Boxfold(), false, 1900);
    // The harness's only assertion: it ran to completion on every order.
    expect(affine4.length).toBe(ORDERS.length);
    expect(fold4.length).toBe(ORDERS.length);
  });
});
