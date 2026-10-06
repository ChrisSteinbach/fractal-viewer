/**
 * The twisted mod-Menger family's picture and its step-scale verdict.
 *
 * The CPU estimators (`menger-de.ts`/`menger-de-4d.ts`) are unit-pinned
 * for arithmetic; this sheet answers what they cannot:
 *
 *   1. WHAT DOES IT LOOK LIKE. Four constructions through the shared
 *      marcher — the default twist (the reference construction: 4 levels,
 *      the KentaYoshii `ma` rotation, no offset), the repo's capture-era
 *      frame (their animated `off` near 1.4 per axis — the README image's
 *      swollen, curled state), a general non-axis twist, and a deep
 *      level-7 carve — so the family's own parameter face is on record
 *      beside the reference look.
 *
 *   2. STEP SCALE, measured not assumed — the bulb sheet's sweep design:
 *      queries in the boundary shell (estimate in (0.004, 0.05)), 24
 *      random directions each, a step of `estimate·k` marched, and the
 *      deep membership oracle consulted at the endpoint. A step that lands
 *      inside the set is an overshoot. The verdict against
 *      `MENGER_STEP_SCALE` lives in the table's commentary; the constant
 *      is only changed with this sheet re-run and its numbers recorded in
 *      `docs/twisted-menger-family.md`.
 *
 * Run: npx vitest run --config scripts/vitest.harness.config.ts \
 *        scripts/twisted-menger.harness.ts
 * Writes: `scripts/out/twisted-menger.png`
 */
import {
  buildMengerDE,
  estimateMengerDistance,
  MENGER_STEP_SCALE,
  mengerSetContains,
} from "../src/fractal/menger-de";
import type { MengerDE } from "../src/fractal/menger-de";
import { resolveMengerTwist } from "../src/fractal/menger-twist";
import type { MengerTwistAuthored } from "../src/fractal/menger-twist";
import { renderPreview, writeContactSheet } from "./de-preview";
import type { PanelStats, Vec3 } from "./de-preview";
import { mulberry32 } from "../src/fractal/rng";

const SIZE = 420;

function deFor(authored: MengerTwistAuthored): MengerDE {
  const resolution = resolveMengerTwist(authored);
  if (!resolution.ok) throw new Error(resolution.reasons.join("; "));
  return buildMengerDE(resolution.construction);
}

interface Entry {
  label: string;
  de: MengerDE;
}

describe("twisted menger — picture and step scale", () => {
  it("renders the family's parameter face and sweeps the step scale", () => {
    const entries: Entry[] = [
      {
        label: "DEFAULT — 4 levels, the ma twist, no offset",
        de: deFor({}),
      },
      {
        label: "CAPTURE ERA — the repo's off ~ 1.4 per axis",
        de: deFor({ offset: [1.4, 1.4, 1.4] }),
      },
      {
        label: "GENERAL TWIST — Euler (0.9, 0.7, 0.4), off 0.15",
        de: deFor({ rotation: [0.9, 0.7, 0.4], offset: [0.15, 0.15, 0.15] }),
      },
      {
        label: "DEPTH 7 — the default twist carved deeper",
        de: deFor({ levels: 7 }),
      },
    ];

    const panels: PanelStats[] = entries.map((entry, i) => {
      const panel = renderPreview(
        {
          de: (p) => estimateMengerDistance(entry.de, p),
          boundingRadius: entry.de.boundingRadius,
          stepScale: entry.de.stepScale,
          zoom: 0.5,
          eyeOffset: [1.5, 0.9, 1.7],
        },
        SIZE,
      );
      console.log(
        `  ${i}. ${entry.label}\n` +
          `     hits ${((panel.hits / (SIZE * SIZE)) * 100).toFixed(1)}%  ` +
          `steps/ray ${(panel.steps / (SIZE * SIZE)).toFixed(1)}`,
      );
      return panel;
    });

    const file = writeContactSheet(panels, 2, "twisted-menger.png");
    console.log(`  wrote ${file}`);
    panels.forEach((p, i) => {
      expect(p.hits, `panel ${i} rendered nothing`).toBeGreaterThan(
        0.01 * SIZE * SIZE,
      );
    });

    // ---- the step-scale sweep -------------------------------------------
    // Boundary-shell queries, 24 random directions each; a step of
    // `estimate·k` that lands inside the set is an overshoot.
    const probe = entries[0].de;
    const rng = mulberry32(0x57e9d);
    const queries: { p: Vec3; d: number }[] = [];
    for (let i = 0; i < 400000 && queries.length < 2600; i++) {
      const p: Vec3 = [rng() * 2.4 - 1.2, rng() * 2.4 - 1.2, rng() * 2.4 - 1.2];
      const d = estimateMengerDistance(probe, p);
      if (d > 0.004 && d < 0.05) queries.push({ p, d });
    }
    expect(queries.length).toBeGreaterThan(1500);
    console.log(
      `  step-scale sweep over ${queries.length} boundary-shell queries`,
    );
    for (const k of [1, 0.9, 0.8, 0.7, 0.6, 0.5]) {
      let overshoot = 0;
      let total = 0;
      for (const { p, d } of queries) {
        for (let dir = 0; dir < 24; dir++) {
          const theta = Math.acos(2 * rng() - 1);
          const phi = 2 * Math.PI * rng();
          const st = Math.sin(theta);
          const step = d * k;
          const q: Vec3 = [
            p[0] + step * st * Math.cos(phi),
            p[1] + step * Math.cos(theta),
            p[2] + step * st * Math.sin(phi),
          ];
          total++;
          if (mengerSetContains(probe, q)) overshoot++;
        }
      }
      const pct = (100 * overshoot) / total;
      console.log(
        `    k=${k.toFixed(1)}: overshoot ${pct.toFixed(2)}%  ` +
          `(${overshoot}/${total})`,
      );
      if (k === MENGER_STEP_SCALE) {
        expect(pct).toBeLessThan(3);
      }
    }
  });
});
