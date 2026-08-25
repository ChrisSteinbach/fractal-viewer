/**
 * Visual evidence for the Gearworks condensation surface.
 *
 * Every panel uses a SHIPPED CPU estimator: {@link buildSurfaceDE} plus
 * {@link estimateDistanceRefined} for the 3D row, and
 * {@link buildSurfaceDE4} plus {@link estimateDistance4} at the exact w=0
 * point slice for the 4D row.
 * Rays, normals, lighting and PNG assembly all come from the ONE shared
 * `de-preview.ts` marcher. This harness contains no private estimator and no
 * second ray marcher, so differences across columns are only the production
 * condensation depth band:
 *
 *                 ALL LEVELS | ROOT 0 | LEVELS 1-2
 *                 --------------------------------
 *     3D solid       ...          ...       ...
 *     4D w=0 slice   ...          ...       ...
 *
 * The finite 1-2 arm is deliberately separate from root-only: root proves
 * the master cog is C0, 1-2 exposes the first recursive images without the
 * master, and all levels shows the recursive closure they build together.
 * The 4D row is a point slice, not a slab: condensation shapes are embedded
 * solids at local w=0 and the production estimator correctly refuses the
 * slab shortcut for them.
 *
 * VISUAL VERDICT (2026-08-25): condensation reads. At 196px, the 3D
 * ALL / ROOT / LEVELS 1-2 panels cover 23.6% / 22.1% / 22.0% of the frame;
 * the 4D w=0 point slices cover 24.6% / 23.9% / 23.8%. Every panel exhausts
 * zero rays at 700 steps. ROOT isolates the one large posed master cog over
 * the ordinary tetrahedral attractor; LEVELS 1-2 removes that master and
 * leaves its first recursive cog images at the tetrahedron cells; ALL puts
 * both together and continues the cog hierarchy into smaller cells. The 4D
 * embedded-solid slice independently resolves the same three distinctions,
 * including the gear holes and tooth silhouettes rather than a w-extruded
 * slab. Turning the preview's shadow proxy off makes those outlines readable;
 * camera, lighting and marcher settings remain identical across every panel.
 *
 * Run: npx vitest run --config scripts/vitest.harness.config.ts \
 *        scripts/condensation-surface.harness.ts
 * Writes: `scripts/out/condensation-surface.png`.
 */
import { gearworks } from "../src/fractal/presets";
import {
  buildSurfaceDE,
  estimateDistanceRefined,
} from "../src/fractal/surface-de";
import type { SurfaceDE } from "../src/fractal/surface-de";
import {
  buildSurfaceDE4,
  estimateDistance4,
} from "../src/fractal/surface-de-4d";
import type { SurfaceDE4 } from "../src/fractal/surface-de-4d";
import type { CondensationDepthBand } from "../src/fractal/condensation-de";
import type { SymmetryParams } from "../src/fractal/types";
import { renderPreview, writeLabeledContactSheet } from "./de-preview";
import type { PanelStats } from "./de-preview";

const SIZE = 196;
const MAX_STEPS = 700;
const EYE: [number, number, number] = [1.18, 0.82, 1.55];
const ZOOM = 0.51;
const NO_SYMMETRY: SymmetryParams = { order: 1, plane: "xz" };

interface BandSpec {
  label: string;
  shortLabel: string;
  band?: CondensationDepthBand;
}

const BANDS: BandSpec[] = [
  { label: "all levels", shortLabel: "ALL" },
  { label: "root only", shortLabel: "ROOT 0", band: { maxDepth: 0 } },
  {
    label: "levels 1-2",
    shortLabel: "LEVELS 1-2",
    band: { minDepth: 1, maxDepth: 2 },
  },
];

function pct(value: number): string {
  return `${(100 * value).toFixed(1)}%`;
}

function render3(de: SurfaceDE): PanelStats {
  return renderPreview(
    {
      de: (p) => estimateDistanceRefined(de, p),
      // Enter just OUTSIDE the estimator's certified ball. Starting exactly
      // on a lower-bound sphere makes the shared previewer's hit epsilon see
      // that zero certificate before it has taken a step toward the object.
      boundingRadius: de.visibleBoundingRadius * 1.05,
      target: de.boundCenter,
      stepScale: de.stepScale,
      eyeOffset: EYE,
      zoom: ZOOM,
      maxSteps: MAX_STEPS,
      ao: false,
      shadow: false,
      collect: true,
    },
    SIZE,
  );
}

function render4(de: SurfaceDE4): PanelStats {
  return renderPreview(
    {
      // Exact POINT slice through the embedded 4D solid. No slab extent is
      // passed to estimateDistance4, matching its condensation contract.
      de: (p) => estimateDistance4(de, [p[0], p[1], p[2], 0]),
      boundingRadius: de.visibleBoundingRadius * 1.05,
      stepScale: de.stepScale,
      eyeOffset: EYE,
      zoom: ZOOM,
      maxSteps: MAX_STEPS,
      ao: false,
      shadow: false,
      collect: true,
    },
    SIZE,
  );
}

describe("Gearworks condensation surface visual evidence", () => {
  it("renders matched all-level, root-only and finite-level 3D/4D panels", () => {
    const transforms = gearworks();
    const rendered: Array<{
      stats: PanelStats;
      lines: [string, string];
    }> = [];
    const rows: Array<{ dimension: string; panels: PanelStats[] }> = [
      { dimension: "3D", panels: [] },
      { dimension: "4D W0", panels: [] },
    ];

    for (const spec of BANDS) {
      const de = buildSurfaceDE(
        transforms,
        null,
        NO_SYMMETRY,
        spec.band ? { condensationDepthBand: spec.band } : {},
      );
      expect(de.condensation?.emitters.length).toBe(1);
      rows[0].panels.push(render3(de));
    }
    for (const spec of BANDS) {
      const de = buildSurfaceDE4(
        transforms,
        null,
        NO_SYMMETRY,
        spec.band ? { condensationDepthBand: spec.band } : {},
      );
      expect(de.condensation?.emitters.length).toBe(1);
      rows[1].panels.push(render4(de));
    }

    for (const row of rows) {
      row.panels.forEach((stats, index) => {
        const rays = SIZE * SIZE;
        const hitFraction = stats.hits / rays;
        const exhaustedFraction = stats.exhausted / rays;
        console.log(
          `${row.dimension.padEnd(5)} ${BANDS[index].label.padEnd(11)} ` +
            `hits=${pct(hitFraction)} steps/ray=${(stats.steps / rays).toFixed(1)} ` +
            `exhausted=${pct(exhaustedFraction)} ${String(stats.ms)}ms`,
        );
        expect(hitFraction).toBeGreaterThan(0.002);
        // A lost beam-frontier sentinel once returned the invariant sphere
        // itself for future-enabled bands; the contact sheet made it obvious
        // as a frame-filling ball. Keep that failure loud in this harness.
        expect(hitFraction).toBeLessThan(0.5);
        expect(exhaustedFraction).toBeLessThan(0.01);
        rendered.push({
          stats,
          lines: [
            `${row.dimension} ${BANDS[index].shortLabel}`,
            `H${pct(hitFraction)} E${pct(exhaustedFraction)}`,
          ],
        });
      });
    }

    // Root is one posed master cog; adding the recursive closure must cover
    // materially more of the fixed frame in both estimators.
    expect(rows[0].panels[0].hits).toBeGreaterThan(rows[0].panels[1].hits);
    expect(rows[1].panels[0].hits).toBeGreaterThan(rows[1].panels[1].hits);

    const file = writeLabeledContactSheet(
      rendered,
      BANDS.length,
      "condensation-surface.png",
    );
    console.log(`wrote ${file}`);
  });
});
