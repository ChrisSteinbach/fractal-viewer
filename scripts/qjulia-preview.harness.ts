/**
 * Visual proof: march `qjulia-de.ts`'s oracle on the CPU and write the
 * image out.
 *
 * The unit tests pin the estimator's SOUNDNESS (no overshoot at step scale
 * 1.0) and its CONJUGACY (the rendered set is the classic set translated by
 * `-c`), but neither answers the question that de-risks the rest of the
 * quaternion Julia investigation: does the estimator actually resolve a
 * quaternion Julia set that looks like the published ones? A wrong
 * real-part convention, a `|v|`/`|y|` mix-up, or a sign slip in the
 * quaternion square all survive the numeric tests as *some* consistent
 * object; they do not survive a picture.
 *
 * This is also the reference image the GPU cores are eyeballed against —
 * the `flame-gpu.ts` oracle discipline's visual half, the same role
 * `fold-phantom.harness.ts` plays for the fold descents.
 *
 * MEASURED VERDICT, and it is a product finding rather than a numeric one:
 * quaternion Julia sets of `q² + c` are SMOOTH. Every such set is a solid of
 * revolution — any quaternion `c` is carried to a COMPLEX `c` by a rotation
 * of the imaginary 3-space, which is an automorphism of the quaternions, so
 * membership depends only on `(x, y, |(z, w)|)` and no choice of constant
 * escapes the lathe. The classic renders (Hart 1989, Crane 2005) look like
 * turned wood for exactly this reason. That is worth knowing before the
 * investigation's later cuts: this object is fast, mathematically clean and
 * genuinely 4D, but it is NOT where the intricate "3D fractal landscape"
 * look comes from — that is the Mandelbulb/Mandelbox family. The panels
 * below are chosen to show the real range, dendrite constants included, so
 * the judgement is made from pictures rather than from a prior framing.
 *
 * Renders through `de-preview.ts`'s shared CPU tracer: this file predates
 * that module and had grown its own tracer and PNG encoder, with shading
 * constants that had drifted independently of the rest of the family, so
 * its sheet was not comparable to a sibling's (the supersampling work's
 * pre-merge review caught it). The camera still recentres per panel on `-c`,
 * matching where the set actually sits (see above) — `eyeOffset` is derived
 * from `boundingRadius` so the original framing survives unchanged. Only the
 * marching/shading numbers — epsilon, AO, shadow, step budget — are now the
 * ones every sibling sheet uses.
 *
 * Run: npx vitest run --config scripts/vitest.harness.config.ts \
 *        scripts/qjulia-preview.harness.ts
 * Writes: `scripts/out/qjulia-preview.png` (a contact sheet).
 */
import {
  buildQJuliaDE,
  estimateQJuliaDistance,
  QJULIA_STEP_SCALE,
} from "../src/fractal/qjulia-de";
import type { QJuliaDE } from "../src/fractal/qjulia-de";
import type { Transform, Vec4 } from "../src/fractal/types";
import { renderPreview, writeContactSheet } from "./de-preview";
import type { DistanceEstimator, PanelStats } from "./de-preview";

const SIZE = 420;

/** One pure quaternion square whose translation is the Julia constant. */
function qjuliaSystem(c: Vec4): Transform {
  return {
    id: 1,
    position: [c[0], c[1], c[2]],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    variations: [{ type: "qsquare", weight: 1 }],
    ...(c[3] === 0 ? {} : { w: { position: c[3], scale: 1 } }),
  };
}

/** Adapts the quaternion (4D) estimator to a fixed `w = w0` slice — the
 * `DistanceEstimator` shape `de-preview.ts` renders. */
function sliceEstimator(de: QJuliaDE, w0: number): DistanceEstimator {
  return (p) => estimateQJuliaDistance(de, [p[0], p[1], p[2], w0]);
}

interface Panel {
  label: string;
  c: Vec4;
  w0: number;
}

describe("quaternion Julia CPU preview", () => {
  it("marches the oracle and writes a contact sheet", () => {
    const entries: Panel[] = [
      // Interior constants: the smooth lathe form the module doc describes.
      {
        label: "c=(-0.2,0.6,0.2,0) w0=0 — interior constant",
        c: [-0.2, 0.6, 0.2, 0],
        w0: 0,
      },
      {
        label: "same c, w0=0.35 — a different 4D slice",
        c: [-0.2, 0.6, 0.2, 0],
        w0: 0.35,
      },
      // Douady rabbit: the most structured connected quadratic Julia set.
      {
        label: "c=(-0.123,0.745,0,0) — Douady rabbit",
        c: [-0.123, 0.745, 0, 0],
        w0: 0,
      },
      // On the boundary / outside: dendrites and dust, where the set is at
      // its most intricate and the smoothness claim is under most pressure.
      { label: "c=(0,1,0,0) — dendrite", c: [0, 1, 0, 0], w0: 0 },
      {
        label: "c=(-0.75,0.02,0,0) — San Marco (parabolic)",
        c: [-0.75, 0.02, 0, 0],
        w0: 0,
      },
      {
        label: "c=(-0.4,0.6,0,0.25) — 4D constant, sliced at w0=0.15",
        c: [-0.4, 0.6, 0, 0.25],
        w0: 0.15,
      },
    ];

    const panels: PanelStats[] = entries.map((entry) => {
      const de = buildQJuliaDE([qjuliaSystem(entry.c)]);
      // The set is the classic one translated by -c, so the camera still
      // recentres there; the fixed (2.1, 1.5, 2.4) offset is the original
      // framing, expressed in the boundingRadius-relative units
      // renderPreview's eyeOffset takes.
      const stats = renderPreview(
        {
          de: sliceEstimator(de, entry.w0),
          boundingRadius: de.boundingRadius,
          target: [-entry.c[0], -entry.c[1], -entry.c[2]],
          eyeOffset: [
            2.1 / de.boundingRadius,
            1.5 / de.boundingRadius,
            2.4 / de.boundingRadius,
          ],
          stepScale: QJULIA_STEP_SCALE,
        },
        SIZE,
      );
      console.log(
        `  ${entry.label}\n` +
          `    hits ${((stats.hits / (SIZE * SIZE)) * 100).toFixed(1)}%  ` +
          `DE evals ${stats.evals}  steps/ray ${(stats.steps / (SIZE * SIZE)).toFixed(1)}  ${stats.ms}ms`,
      );
      return stats;
    });

    const file = writeContactSheet(panels, 3, "qjulia-preview.png");
    console.log(`  wrote ${file}`);
    // Guard the guard: a blank panel would make the sheet meaningless.
    panels.forEach((p, i) => {
      expect(p.hits, `panel ${i} rendered nothing`).toBeGreaterThan(
        0.02 * SIZE * SIZE,
      );
    });
  });
});
