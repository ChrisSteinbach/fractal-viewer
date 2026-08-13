/**
 * fr-7u8t.8: which escape-time FORM should the mode render, and does the
 * document's `t` survive the answer?
 *
 * `escape-family-preview.harness.ts` established that the shipped Julia form
 * renders a near-sphere at the authored constant. This sheet decides the
 * question that bead left open — with pictures, per its own instruction —
 * and is the executable record of the verdict `escape-de.ts`'s module doc
 * carries:
 *
 *   1. Does the Mandelbrot form (`v <- w·V(Mv + t) + p`) resolve the classic
 *      objects through the REAL `estimateEscapeDistance`? (Row 1: yes — the
 *      fractal ball, the holed ball, the cube.)
 *   2. Is `t` still a live knob once the offset comes from the query point?
 *      It stays the PRE-fold offset — the fold's box/sphere centre — so it
 *      should deform rather than merely translate. (Row 2: it deforms.)
 *   3. Is the Julia form worth a persisted document flag to keep? (Row 3 and
 *      the scan below: NO. It is a sphere across the whole range a user
 *      would author, and its best constants are pitted BALLS where the
 *      Mandelbrot form at the same weights gives three distinct objects.)
 *
 * Because the mode now ships the Mandelbrot form alone, the Julia loop lives
 * here as a local — the rejected option's executable record, the same idiom
 * `escape-family-preview.harness.ts` used for prototypes it had not yet
 * paid six mirrors for. It is `estimateEscapeDistance` verbatim minus the
 * `+ p` term.
 *
 * Every Mandelbrot panel runs the SHIPPED estimator through `de-preview.ts`'s
 * identical shading, so the sheet compares OBJECTS and not lighting. The
 * sibling harness's caveat applies: no empty-space grid, no tier-pinned
 * acceptance epsilon, a 600-step budget — fold surfaces speckle where the
 * shipped tracer resolves them. STRUCTURE is the verdict here, not surface
 * quality; the speckle itself reads as filaments thinner than a pixel, which
 * is what the Julia panels conspicuously lack.
 *
 * The console table answers what the pictures cannot: how much of the
 * marching ball each form's non-escaping set fills, and how far it reaches
 * past `ESCAPE_TIME_RADIUS` — i.e. whether the shipped bounding radius still
 * contains the object once the offset moves. (It does: reach <= 1.00xR.)
 *
 * Run: npx vitest run --config scripts/vitest.harness.config.ts \
 *        scripts/escape-form-sweep.harness.ts
 * Writes: `scripts/out/escape-form-sweep.png`
 */
import {
  buildEscapeDE,
  estimateEscapeDistance,
  ESCAPE_STEP_SCALE,
  ESCAPE_TIME_ITERATIONS,
  ESCAPE_TIME_RADIUS,
} from "../src/fractal/escape-de";
import type { EscapeDE } from "../src/fractal/escape-de";
import {
  SURFACE_FOLD_BOXFOLD,
  SURFACE_FOLD_SPHEREFOLD,
} from "../src/fractal/surface-de";
import type { Transform, VariationType } from "../src/fractal/types";
import { renderPreview, writeContactSheet } from "./de-preview";
import type { DistanceEstimator, PanelStats, Vec3 } from "./de-preview";

const SIZE = 420;

/** A single pure-fold map, the shape `analyzeEscapeSystem` admits. */
function foldSystem(
  type: VariationType,
  weight: number,
  position: Vec3,
): Transform {
  return {
    id: 1,
    position,
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    variations: [{ type, weight }],
  };
}

function foldDE(type: VariationType, weight: number, t: Vec3): EscapeDE {
  return buildEscapeDE([foldSystem(type, weight, t)]);
}

/**
 * The REJECTED form (fr-kltj's, retired by fr-7u8t.8): `estimateEscapeDistance`
 * term for term with the query-point offset removed, so the per-iteration
 * offset is the document's `t` alone. Kept as a local because nothing in the
 * app computes it any more — the module doc's "why not both forms" paragraph
 * is what this function's panels measured.
 */
function juliaFormDE(de: EscapeDE): DistanceEstimator {
  const m = de.m;
  const foldAxis = (t: number) => 2 * Math.max(-1, Math.min(1, t)) - t;
  return (p) => {
    let [vx, vy, vz] = p;
    let dr = 1;
    let r = Math.sqrt(vx * vx + vy * vy + vz * vz);
    for (
      let i = 0;
      i < ESCAPE_TIME_ITERATIONS && r <= ESCAPE_TIME_RADIUS;
      i++
    ) {
      let yx = m[0] * vx + m[1] * vy + m[2] * vz + de.t[0];
      let yy = m[3] * vx + m[4] * vy + m[5] * vz + de.t[1];
      let yz = m[6] * vx + m[7] * vy + m[8] * vz + de.t[2];
      let localL = 1;
      if (de.foldKind !== SURFACE_FOLD_SPHEREFOLD) {
        yx = foldAxis(yx);
        yy = foldAxis(yy);
        yz = foldAxis(yz);
      }
      if (de.foldKind !== SURFACE_FOLD_BOXFOLD) {
        const f = 1 / Math.max(0.25, Math.min(1, yx * yx + yy * yy + yz * yz));
        yx *= f;
        yy *= f;
        yz *= f;
        localL = f;
      }
      vx = de.w * yx;
      vy = de.w * yy;
      vz = de.w * yz;
      dr = de.derivGrowth * localL * dr + 1;
      r = Math.sqrt(vx * vx + vy * vy + vz * vz);
    }
    return r / dr;
  };
}

/**
 * How much of the marching ball the object fills, and how far it reaches.
 * "Interior" is the marcher's own view of inside — a DE collapsed to nothing
 * because `dr` ran away — sampled on a grid over a box twice the bounding
 * radius, so a set that outgrew `ESCAPE_TIME_RADIUS` shows up as reach > 1
 * rather than silently clipping against the sphere gate.
 */
function extent(de: DistanceEstimator): { fillPct: number; reach: number } {
  const N = 41;
  const R = 2 * ESCAPE_TIME_RADIUS;
  let inBall = 0;
  let interiorInBall = 0;
  let maxR = 0;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      for (let k = 0; k < N; k++) {
        const p: Vec3 = [
          -R + (2 * R * i) / (N - 1),
          -R + (2 * R * j) / (N - 1),
          -R + (2 * R * k) / (N - 1),
        ];
        const r = Math.hypot(p[0], p[1], p[2]);
        const interior = de(p) < 1e-3;
        if (r <= ESCAPE_TIME_RADIUS) {
          inBall++;
          if (interior) interiorInBall++;
        }
        if (interior) maxR = Math.max(maxR, r);
      }
    }
  }
  return {
    fillPct: (100 * interiorInBall) / inBall,
    reach: maxR / ESCAPE_TIME_RADIUS,
  };
}

interface Entry {
  label: string;
  de: DistanceEstimator;
}

function mandelbrot(label: string, de: EscapeDE): Entry {
  return {
    label: `MANDELBROT (ships) ${label}`,
    de: (p) => estimateEscapeDistance(de, p),
  };
}

function julia(label: string, de: EscapeDE): Entry {
  return { label: `JULIA (rejected)   ${label}`, de: juliaFormDE(de) };
}

describe("fr-7u8t.8 escape-time form sweep", () => {
  it("renders both forms of the fold escape-time set", () => {
    const entries: Entry[] = [
      // Row 1 — the shipped form at t = 0: the canonical objects.
      mandelbrot(
        "mandelbox w=2,    t=0 (the fractal ball)",
        foldDE("mandelbox", 2, [0, 0, 0]),
      ),
      mandelbrot(
        "mandelbox w=3,    t=0 (the holed ball)",
        foldDE("mandelbox", 3, [0, 0, 0]),
      ),
      mandelbrot(
        "mandelbox w=-1.5, t=0 (the cube)",
        foldDE("mandelbox", -1.5, [0, 0, 0]),
      ),
      // Row 2 — t is still a live deformation knob, and the spherefold shape
      // renders empty in BOTH forms (see the it() below).
      mandelbrot(
        "mandelbox w=2, t=(0.4,0.3,0.2) — escMandelbox's t",
        foldDE("mandelbox", 2, [0.4, 0.3, 0.2]),
      ),
      mandelbrot("mandelbox w=2, t=(1,0,0)", foldDE("mandelbox", 2, [1, 0, 0])),
      mandelbrot(
        "spherefold w=2, t=0 — escSpherefold's shape",
        foldDE("spherefold", 2, [0, 0, 0]),
      ),
      // Row 3 — the retired form: the bug, then its two best constants.
      julia(
        "mandelbox w=2,    t=(0.4,0.3,0.2) — THE BUG",
        foldDE("mandelbox", 2, [0.4, 0.3, 0.2]),
      ),
      julia(
        "mandelbox w=2,    t=(2.5,0,0) — thinnest at w=2",
        foldDE("mandelbox", 2, [2.5, 0, 0]),
      ),
      julia(
        "mandelbox w=-1.5, t=(2.5,0,0) — the best Juliabox found",
        foldDE("mandelbox", -1.5, [2.5, 0, 0]),
      ),
    ];

    const panels: PanelStats[] = entries.map((e, i) => {
      const { fillPct, reach } = extent(e.de);
      const panel = renderPreview(
        {
          de: e.de,
          boundingRadius: ESCAPE_TIME_RADIUS,
          stepScale: ESCAPE_STEP_SCALE,
          zoom: 0.5,
        },
        SIZE,
      );
      console.log(
        `  ${i}. ${e.label}\n` +
          `     hits ${((panel.hits / (SIZE * SIZE)) * 100).toFixed(1)}%  ` +
          `ball fill ${fillPct.toFixed(1)}%  ` +
          `reach ${reach.toFixed(2)}xR  ` +
          `steps/ray ${(panel.steps / (SIZE * SIZE)).toFixed(1)}  ${panel.ms}ms`,
      );
      return panel;
    });

    console.log(
      `  wrote ${writeContactSheet(panels, 3, "escape-form-sweep.png")}`,
    );
    // Guard the guard: a blank panel would make the sheet meaningless. Panel
    // 5 is deliberately exempt — the spherefold shape renders empty in both
    // forms, which is itself one of this sheet's findings.
    panels.forEach((p, i) => {
      if (i === 5) return;
      expect(p.hits, `panel ${i} rendered nothing`).toBeGreaterThan(
        0.01 * SIZE * SIZE,
      );
    });
  });

  it("checks ESCAPE_STEP_SCALE still fits the object the form changed", () => {
    // fr-7u8t.8 turned a 94%-solid blob into a 10%-solid filamented set, and
    // ESCAPE_STEP_SCALE (0.7) was picked against the blob. If 0.7 now
    // OVERSHOOTS thin features, damping further recovers surface a coarser
    // march was stepping past — visible as hits climbing as the scale falls.
    // A flat hit count means 0.7 is not the limiting factor and any residual
    // speckle is sampling, not step damping.
    const de = foldDE("mandelbox", 2, [0, 0, 0]);
    const panels = [1, ESCAPE_STEP_SCALE, 0.5, 0.35, 0.2, 0.1].map(
      (stepScale) => {
        const panel = renderPreview(
          {
            de: (p) => estimateEscapeDistance(de, p),
            boundingRadius: ESCAPE_TIME_RADIUS,
            stepScale,
            zoom: 0.28,
          },
          SIZE,
        );
        console.log(
          `  stepScale ${stepScale}  hits ${((panel.hits / (SIZE * SIZE)) * 100).toFixed(2)}%  ` +
            `steps/ray ${(panel.steps / (SIZE * SIZE)).toFixed(1)}  ${panel.ms}ms`,
        );
        return panel;
      },
    );
    console.log(
      `  wrote ${writeContactSheet(panels, 3, "escape-step-scale.png")}`,
    );
  });

  it("scans the Julia form's constant space for a reason to keep it", () => {
    // The numbers behind the module doc's "only stops being a sphere past
    // |t| ~ 2.5": ball fill against |t| along one axis, per fold weight. The
    // band between blob and nothing is narrow at every weight, and the
    // Mandelbrot column beside it needs no constant at all.
    for (const w of [2, 3, -1.5]) {
      const row = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5].map((mag) => {
        const fill = extent(
          juliaFormDE(foldDE("mandelbox", w, [mag, 0, 0])),
        ).fillPct;
        return `${mag}:${fill.toFixed(1)}%`;
      });
      const m = extent((p) =>
        estimateEscapeDistance(foldDE("mandelbox", w, [0, 0, 0]), p),
      );
      console.log(
        `  w=${w}  julia fill by |t|  ${row.join("  ")}` +
          `   |   mandelbrot t=0: ${m.fillPct.toFixed(1)}%`,
      );
    }
  });
});
