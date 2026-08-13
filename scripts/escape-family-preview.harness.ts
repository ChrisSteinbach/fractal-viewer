/**
 * fr-7u8t: which escape-time formula is worth building next?
 *
 * fr-7u8t.4 established that quaternion Julia sets are provably solids of
 * revolution and therefore visually monotonous, which inverted the design
 * brief's priority ordering. This harness answers the follow-up with
 * pictures rather than argument: it renders what the app SHIPS TODAY (the
 * fr-kltj escape-time fold set, via the real `estimateEscapeDistance`)
 * beside prototypes of the Mandelbulb family, all through `de-preview.ts`'s
 * identical shading, so the sheet compares OBJECTS and not lighting.
 *
 * THE FINDING THIS HARNESS PRODUCED, and it was about code already shipped:
 * the escape-time mode's JULIA form rendered a near-SPHERE. Measured on the
 * project's own bench fixture (`escMandelbox`: mandelbox weight 2, position
 * (0.4, 0.3, 0.2)), 94% of the bounding ball was non-escaping — the
 * estimator returned 1e-10..1e-15 at every radius below 4 and jumped to |p|
 * outside it. The object genuinely WAS its own bounding ball, speckled where
 * the thin escaping filaments fell below a pixel. Nothing was wrong with the
 * estimator; the fixed-c fold map at a small constant is simply a fat blob.
 *
 * fr-7u8t.8 acted on that: the mode now marches the MANDELBROT form, the
 * offset taken from the SAMPLE POINT (`v <- w·V(Mv + t) + p`), so panels 0-2
 * below are the SHIPPED estimator and resolve the unmistakable Mandelbox.
 * The `+ 1` in the shipped `dr` recurrence turned out to belong to this form
 * all along — `escape-de.ts` could only call it "the Mandelbrot-form's
 * conservatism" — so the derivative needed no change, only the offset.
 * `escape-form-sweep.harness.ts` is that decision's own sheet, including the
 * measurements that retired the Julia form rather than making it a flag.
 *
 * The bulb estimators here are deliberately throwaway locals, not modules:
 * the point is to see the images before paying for six mirrors and a bench
 * leg. Promoting one is fr-7u8t.7's job.
 *
 * CAVEAT on reading the fold panels: this marcher has no empty-space grid,
 * no tier-pinned acceptance epsilon and a 600-step budget, so the fold
 * surfaces speckle where the shipped tracer would resolve them. The
 * STRUCTURE is the verdict here, not the surface quality. The bulb panels
 * need none of that and render clean, which is itself informative about how
 * much cheaper they are to march.
 *
 * Run: npx vitest run --config scripts/vitest.harness.config.ts \
 *        scripts/escape-family-preview.harness.ts
 * Writes: `scripts/out/escape-family.png`
 */
import {
  buildEscapeDE,
  estimateEscapeDistance,
  ESCAPE_STEP_SCALE,
} from "../src/fractal/escape-de";
import {
  buildQJuliaDE,
  estimateQJuliaDistance,
} from "../src/fractal/qjulia-de";
import type { Transform, Vec4 } from "../src/fractal/types";
import { renderPreview, writeContactSheet } from "./de-preview";
import type { PanelStats, Vec3 } from "./de-preview";

const SIZE = 460;

/**
 * The White/Nylander triplex power — the Mandelbulb's map. `julia` picks the
 * form: false is the Mandelbrot form (c = the sample point, the iconic
 * image), true the Julia form (c fixed, the app's existing escape-time
 * convention — see `escape-de.ts`'s module doc).
 *
 * The scalar running derivative is `dr <- n·r^(n-1)·dr (+1)`, which is the
 * SAME recurrence shape `escape-de.ts` already carries (`growth · localL ·
 * dr + 1`), and the estimate is the same Böttcher log form `qjulia-de.ts`
 * uses. The `+1` belongs to the Mandelbrot form only.
 */
function bulbDE(
  power: number,
  julia: boolean,
  c: Vec3,
  bailout = 2.5,
  iterations = 14,
): (p: Vec3) => number {
  return (p) => {
    let [x, y, z] = p;
    let dr = 1;
    let r = Math.hypot(x, y, z);
    for (let i = 0; i < iterations && r <= bailout; i++) {
      const theta = Math.acos(Math.max(-1, Math.min(1, z / (r || 1e-12))));
      const phi = Math.atan2(y, x);
      dr = power * Math.pow(r, power - 1) * dr + (julia ? 0 : 1);
      const zr = Math.pow(r, power);
      const th = theta * power;
      const ph = phi * power;
      const st = Math.sin(th);
      x = zr * st * Math.cos(ph) + (julia ? c[0] : p[0]);
      y = zr * st * Math.sin(ph) + (julia ? c[1] : p[1]);
      z = zr * Math.cos(th) + (julia ? c[2] : p[2]);
      r = Math.hypot(x, y, z);
    }
    return r <= 1 ? 0 : (0.5 * r * Math.log(r)) / dr;
  };
}

/** A single pure-fold map, the shape `analyzeEscapeSystem` admits. */
function foldSystem(weight: number, extra: Partial<Transform> = {}): Transform {
  return {
    id: 1,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    variations: [{ type: "mandelbox", weight }],
    ...extra,
  };
}

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

interface Entry {
  label: string;
  de: (p: Vec3) => number;
  radius: number;
  stepScale: number;
  zoom?: number;
  eyeOffset?: Vec3;
}

describe("fr-7u8t escape-family visual comparison", () => {
  it("renders the shipped fold set beside the bulb prototypes", () => {
    const mbox = buildEscapeDE([foldSystem(2, { position: [0.4, 0.3, 0.2] })]);
    const ball = buildEscapeDE([foldSystem(2)]);
    const shell = buildEscapeDE([foldSystem(3)]);
    const qj = buildQJuliaDE([qjuliaSystem([0, 1, 0, 0])]);

    const entries: Entry[] = [
      {
        label: "SHIPS TODAY — Mandelbox at the escMandelbox fixture's offset",
        de: (p) => estimateEscapeDistance(mbox, p),
        radius: mbox.boundingRadius,
        stepScale: ESCAPE_STEP_SCALE,
        zoom: 0.5,
      },
      {
        label: "SHIPS TODAY — Mandelbox weight 2, no offset",
        de: (p) => estimateEscapeDistance(ball, p),
        radius: ball.boundingRadius,
        stepScale: ESCAPE_STEP_SCALE,
        zoom: 0.5,
      },
      {
        label: "SHIPS TODAY — Mandelbox weight 3, no offset",
        de: (p) => estimateEscapeDistance(shell, p),
        radius: shell.boundingRadius,
        stepScale: ESCAPE_STEP_SCALE,
        zoom: 0.5,
      },
      {
        label: "PROTOTYPE — Mandelbulb power 8 (Mandelbrot form)",
        de: bulbDE(8, false, [0, 0, 0]),
        radius: 1.25,
        stepScale: 1,
        zoom: 0.5,
      },
      {
        label: "PROTOTYPE — Juliabulb power 8, c = (0.28, 0.42, 0.18)",
        de: bulbDE(8, true, [0.28, 0.42, 0.18]),
        radius: 1.35,
        stepScale: 1,
        zoom: 0.5,
      },
      {
        label: "fr-7u8t.4 — quaternion Julia, dendrite c = i (for scale)",
        de: (p) => estimateQJuliaDistance(qj, [p[0], p[1], p[2], 0]),
        radius: qj.boundingRadius,
        stepScale: 1,
        zoom: 0.5,
      },
    ];

    const panels: PanelStats[] = entries.map((entry, i) => {
      const panel = renderPreview(
        {
          de: entry.de,
          boundingRadius: entry.radius,
          stepScale: entry.stepScale,
          zoom: entry.zoom,
          eyeOffset: entry.eyeOffset,
        },
        SIZE,
      );
      console.log(
        `  ${i}. ${entry.label}\n` +
          `     hits ${((panel.hits / (SIZE * SIZE)) * 100).toFixed(1)}%  ` +
          `steps/ray ${(panel.steps / (SIZE * SIZE)).toFixed(1)}  ` +
          `evals ${panel.evals}  ${panel.ms}ms  stepScale ${entry.stepScale}`,
      );
      return panel;
    });

    const file = writeContactSheet(panels, 3, "escape-family.png");
    console.log(`  wrote ${file}`);
    // Guard the guard: an empty panel would make the sheet meaningless.
    panels.forEach((p, i) => {
      expect(p.hits, `panel ${i} rendered nothing`).toBeGreaterThan(
        0.01 * SIZE * SIZE,
      );
    });
  });
});
