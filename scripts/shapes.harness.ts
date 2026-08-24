/**
 * Visual + extent proof for the shape library (`src/fractal/shapes.ts`):
 * march the SDFs on the CPU and write the picture out, splat the samplers
 * beside them, and measure fill/reach with the shared instrument.
 *
 * The unit tests pin the algebra — fold order, pose exactness, the
 * emission's executable js pin, sampler membership and uniformity — but
 * none of them answers the questions this sheet exists for: does the peace
 * sign READ as the icon (the addendum's reference image), does the gear
 * read as a gear, and do the two evaluators (SDF marcher, point sampler)
 * draw the same object side by side. A sign slip or a wrong sector fold
 * survives every tolerance check as some consistent object; it does not
 * survive a picture.
 *
 * This sheet is ALSO the home of the fill/reach measurement
 * (`set-extent.ts`'s instrument, membership oracle = the exact SDF's
 * sign): the root tsconfig's `rootDir: "src"` refuses a `src/` test that
 * imports from `scripts/` (TS6059), so the instrument leg lives here,
 * where both sides import legally, and stays asserted rather than merely
 * printed.
 *
 * MEASURED VERDICT: the peace sign READS as the icon and every panel pair
 * agrees. Renders hit 39.1% / 29.9% / 28.5% of pixels (peace / gear /
 * die-and-ring) with ZERO exhausted rays at the default step budget under
 * SHAPE_MARCH_SAFETY; the sampled splats overlay the rendered silhouettes,
 * the outline splat drawing the full profile — tooth flanks included, the
 * piece a radial outline parametrization would have missed. Extent, by the
 * shared instrument: peace sign fill 7.36%, reach 1.1195 against bound
 * 1.1200 (the ring's outer edge — attained, ratio 1.000); gear fill
 * 19.99%, reach 1.2495 against 1.2556 (ratio 0.995, within two
 * shell-widths of the tooth-corner bound). Sampler cost: 5.93 / 4.58 /
 * 16.32 rng draws per accepted sample (peace / gear solid / gear
 * outline) — the outline's factor is the documented band rejection.
 *
 * Run: npx vitest run --config scripts/vitest.harness.config.ts \
 *        scripts/shapes.harness.ts
 * Writes: `scripts/out/shapes.png` (a labeled contact sheet).
 */
import {
  GEAR_SHAPE,
  PEACE_SIGN_SHAPE,
  SHAPE_MARCH_SAFETY,
  prepareShapeSampler,
  shapeBoundingRadius,
  shapeSdf,
} from "../src/fractal/shapes";
import type { ShapeSpec } from "../src/fractal/shapes";
import { mulberry32 } from "../src/fractal/rng";
import type { Rng } from "../src/fractal/rng";
import { renderPreview, writeLabeledContactSheet } from "./de-preview";
import type { PanelStats } from "./de-preview";
import { sampleSetExtent } from "./set-extent";

const SIZE = 420;
const SCATTER_POINTS = 60000;

/** A union+intersect composition: a rounded die (sphere ∩ box) with a
 * Saturn ring (posed torus) — one panel exercising both fold ops and a
 * rotation pose. */
const DIE_AND_RING: ShapeSpec = {
  parts: [
    { primitive: { kind: "sphere", radius: 1 }, combine: "union" },
    {
      primitive: { kind: "box", half: [0.72, 0.72, 0.72] },
      combine: "intersect",
    },
    {
      primitive: { kind: "torus", major: 1.15, minor: 0.09 },
      combine: "union",
      pose: { rotate: [Math.PI / 2, 0, 0] },
    },
  ],
};

/** Orthographic xy splat of sampled points as a PanelStats-shaped panel,
 * so the sampler sits on the sheet beside the marched SDF it must agree
 * with. */
function scatterPanel(
  spec: ShapeSpec,
  opts: { gearOutline?: boolean },
  seed: number,
): { stats: PanelStats; drawsPerSample: number } {
  const started = Date.now();
  const bound = shapeBoundingRadius(spec);
  const half = bound * 1.1;
  const base = mulberry32(seed);
  let draws = 0;
  const rng: Rng = () => {
    draws++;
    return base();
  };
  const sample = prepareShapeSampler(spec, opts);
  const counts = new Uint16Array(SIZE * SIZE);
  for (let i = 0; i < SCATTER_POINTS; i++) {
    const [x, y] = sample(rng);
    const px = Math.floor(((x + half) / (2 * half)) * SIZE);
    const py = Math.floor(((half - y) / (2 * half)) * SIZE);
    if (px < 0 || px >= SIZE || py < 0 || py >= SIZE) continue;
    counts[py * SIZE + px]++;
  }
  const rgb = new Uint8Array(SIZE * SIZE * 3);
  let lit = 0;
  for (let i = 0; i < counts.length; i++) {
    const c = counts[i];
    if (c === 0) {
      rgb[i * 3] = 10;
      rgb[i * 3 + 1] = 12;
      rgb[i * 3 + 2] = 16;
      continue;
    }
    lit++;
    const v = Math.min(255, 80 + c * 40);
    rgb[i * 3] = v;
    rgb[i * 3 + 1] = Math.min(255, 60 + c * 36);
    rgb[i * 3 + 2] = Math.min(255, 30 + c * 22);
  }
  return {
    stats: {
      rgb,
      width: SIZE,
      height: SIZE,
      hits: lit,
      evals: 0,
      steps: 0,
      exhausted: 0,
      ms: Date.now() - started,
    },
    drawsPerSample: draws / SCATTER_POINTS,
  };
}

describe("shape library sheet", () => {
  it("marches the reference shapes, splats the samplers beside them, and writes the sheet", () => {
    const renders: Array<{
      label: string;
      spec: ShapeSpec;
      eyeOffset?: [number, number, number];
    }> = [
      // Nearly down +z so the icon reads as the icon.
      {
        label: "peace sign sdf",
        spec: PEACE_SIGN_SHAPE,
        eyeOffset: [0.3, 0.22, 2.0],
      },
      { label: "gear sdf", spec: GEAR_SHAPE },
      { label: "die and ring sdf", spec: DIE_AND_RING },
    ];
    const panels: Array<{ stats: PanelStats; lines: [string, string] }> = [];
    for (const { label, spec, eyeOffset } of renders) {
      const stats = renderPreview(
        {
          de: (p) => shapeSdf(spec, p[0], p[1], p[2]),
          boundingRadius: shapeBoundingRadius(spec),
          stepScale: SHAPE_MARCH_SAFETY,
          eyeOffset,
        },
        SIZE,
      );
      const hitPct = (stats.hits / (SIZE * SIZE)) * 100;
      console.log(
        `  ${label}: hits ${hitPct.toFixed(1)}%  evals ${stats.evals}  ` +
          `exhausted ${stats.exhausted}  ${stats.ms}ms`,
      );
      expect(stats.hits, `${label} rendered nothing`).toBeGreaterThan(
        0.02 * SIZE * SIZE,
      );
      expect(stats.exhausted, `${label} starved its rays`).toBe(0);
      panels.push({
        stats,
        lines: [label, `hits ${hitPct.toFixed(1)}%  ex ${stats.exhausted}`],
      });
    }

    const scatters: Array<{
      label: string;
      spec: ShapeSpec;
      opts: { gearOutline?: boolean };
      seed: number;
    }> = [
      {
        label: "peace sign sampled",
        spec: PEACE_SIGN_SHAPE,
        opts: {},
        seed: 0x51a7,
      },
      { label: "gear sampled solid", spec: GEAR_SHAPE, opts: {}, seed: 0x51a8 },
      {
        label: "gear sampled outline",
        spec: GEAR_SHAPE,
        opts: { gearOutline: true },
        seed: 0x51a9,
      },
    ];
    for (const { label, spec, opts, seed } of scatters) {
      const { stats, drawsPerSample } = scatterPanel(spec, opts, seed);
      console.log(
        `  ${label}: lit px ${stats.hits}  rng draws/sample ${drawsPerSample.toFixed(2)}  ${stats.ms}ms`,
      );
      expect(stats.hits, `${label} splatted nothing`).toBeGreaterThan(
        0.01 * SIZE * SIZE,
      );
      panels.push({
        stats,
        lines: [label, `draws/sample ${drawsPerSample.toFixed(2)}`],
      });
    }

    const file = writeLabeledContactSheet(panels, 3, "shapes.png");
    console.log(`  wrote ${file}`);
  });

  it("measures fill and reach with the shared instrument: inside the bound, attaining it", () => {
    for (const { name, spec } of [
      { name: "peace sign", spec: PEACE_SIGN_SHAPE },
      { name: "gear", spec: GEAR_SHAPE },
    ]) {
      const bound = shapeBoundingRadius(spec);
      const extent = sampleSetExtent(
        (p) => shapeSdf(spec, p[0], p[1], p[2]) <= 0,
        // Scan past the bound so an escape would read as reach, not clip.
        { fillRadius: bound, scanRadius: bound * 1.25 },
      );
      console.log(
        `  ${name}: fill ${extent.fillPct.toFixed(2)}%  reach ${extent.reachAbs.toFixed(4)}  ` +
          `bound ${bound.toFixed(4)}  reach/bound ${(extent.reachAbs / bound).toFixed(3)}`,
      );
      expect(extent.fillPct).toBeGreaterThan(1);
      // The bound is conservative (nothing outside it)…
      expect(extent.reachAbs).toBeLessThanOrEqual(bound * (1 + 1e-9));
      // …and tight: both reference bounds are attained by real features
      // (ring edge, tooth corner), so the instrument must get close.
      expect(extent.reachAbs).toBeGreaterThan(0.85 * bound);
    }
  });
});
