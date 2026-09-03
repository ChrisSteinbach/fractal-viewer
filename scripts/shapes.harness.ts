/**
 * Visual + extent proof for the shape library (`src/fractal/shapes.ts`):
 * march the SDFs on the CPU and write the picture out, splat the samplers
 * beside them, and measure fill/reach with the shared instrument.
 *
 * The unit tests pin the algebra — fold order, pose exactness, the
 * emission's executable js pin, sampler membership and uniformity — but
 * none of them answers the questions this sheet exists for: does the peace
 * sign READ as the icon (the addendum's reference image), does Orbit Ring
 * keep a clearly open center, does the gear read as a gear, do the catalog
 * meshes retain their authored silhouette/depth, and do the two evaluators
 * (SDF marcher, point sampler) draw the same object side by side. A sign slip
 * or a wrong sector fold survives every tolerance check as some consistent
 * object; it does not survive a picture.
 *
 * This sheet is ALSO the home of the fill/reach measurement
 * (`set-extent.ts`'s instrument, membership oracle = the exact analytic
 * SDF's sign or exact catalog-mesh containment): the conservative mesh SDF
 * intentionally has negative padding outside the triangles, so ITS sign is
 * not a membership oracle. The root tsconfig's `rootDir: "src"` refuses a
 * `src/` test that imports from `scripts/` (TS6059), so the instrument leg
 * lives here, where both sides import legally, and stays asserted rather
 * than merely printed.
 *
 * MEASURED VERDICT: the peace sign READS as the icon, Orbit Ring keeps its
 * open center, the heart notch and crescent bite stay open, every snowflake
 * branch survives, the crystal facets read, the oblique trefoil has real
 * over/under depth, and every SDF/sampler pair agrees. Renders hit 39.1 /
 * 52.0 / 29.9 / 28.5 / 35.8 / 14.7 / 56.7 / 46.0 / 46.7 / 27.1% of
 * pixels (peace / orbit / gear / die-and-ring / star / crystal / heart /
 * crescent / snowflake / trefoil), with ZERO exhausted rays under
 * SHAPE_MARCH_SAFETY. Exact-membership fill / reach / bound for the meshes:
 * star 14.73% / 1.0229 / 1.0385; crystal 13.18% / 1.1155 / 1.1500; heart
 * 24.77% / 1.1447 / 1.1536; crescent 18.28% / 1.0277 / 1.0427; snowflake
 * 15.71% / 1.0587 / 1.0771; trefoil 6.16% / 1.0206 / 1.0292. Analytic
 * extent remains peace 7.36% / 1.1195 / 1.1200, Orbit 22.06% / 1.0398 /
 * 1.0400, gear 19.99% / 1.2495 / 1.2556. Sampler cost is 5.93 / 6.34 /
 * 4.58 / 16.32 rng draws per accepted sample for peace / orbit / gear solid
 * / gear outline and 4.00 for every mesh; the outline's factor is the
 * documented band rejection.
 *
 * Peace's deliberately overlapping torus/capsules exercise the shared
 * multi-part correction. The corrected 50.3M equal-N SwiftShader
 * bench (after the device emitter sampler's min-index overlap fix)
 * measured density TV 0.005883 in 3D and 0.005872 in 4D against its
 * 0.03 gate using overlapping-sphere fixtures; those figures validate the
 * device correction, not Peace specifically. Focused production tests pin
 * canonical Peace's CPU/packed 3D/4D inputs and overlap-adjacent behavior
 * directly: their coarse density TV was 0.029350 / 0.028950 with 7,369 /
 * 7,258 real junction rejections and zero bounded fallbacks. Those are
 * deterministic packed-adjacent tests, not a live GPU claim. This sheet
 * supplies the complementary visual/extent proof without rerunning the long
 * GPU bench.
 *
 * Run: npx vitest run --config scripts/vitest.harness.config.ts \
 *        scripts/shapes.harness.ts
 * Writes: `scripts/out/shapes.png` (a labeled contact sheet).
 */
import {
  CRESCENT_MOON_SHAPE,
  FACETED_CRYSTAL_SHAPE,
  GEAR_SHAPE,
  HEART_PRISM_SHAPE,
  ORBIT_RING_SHAPE,
  PEACE_SIGN_SHAPE,
  SHAPE_MARCH_SAFETY,
  SNOWFLAKE_PRISM_SHAPE,
  STAR_PRISM_SHAPE,
  TREFOIL_KNOT_SHAPE,
  prepareShapeSampler,
  shapeBoundingRadius,
  shapeSdf,
} from "../src/fractal/shapes";
import type { ShapeSpec } from "../src/fractal/shapes";
import {
  meshAsset,
  meshContainsPoint,
  type MeshAssetId,
} from "../src/fractal/mesh-shapes";
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
      {
        // Near-front view proves the central hole remains legible while a
        // little tilt keeps the torus volume apparent.
        label: "orbit ring sdf",
        spec: ORBIT_RING_SHAPE,
        eyeOffset: [0.3, 0.22, 2.0],
      },
      { label: "gear sdf", spec: GEAR_SHAPE },
      { label: "die and ring sdf", spec: DIE_AND_RING },
      {
        label: "star sdf",
        spec: STAR_PRISM_SHAPE,
        eyeOffset: [0.3, 0.22, 2.0],
      },
      { label: "faceted crystal sdf", spec: FACETED_CRYSTAL_SHAPE },
      {
        label: "heart prism sdf",
        spec: HEART_PRISM_SHAPE,
        eyeOffset: [0.3, 0.22, 2.0],
      },
      {
        label: "crescent moon sdf",
        spec: CRESCENT_MOON_SHAPE,
        eyeOffset: [0.3, 0.22, 2.0],
      },
      {
        label: "snowflake prism sdf",
        spec: SNOWFLAKE_PRISM_SHAPE,
        eyeOffset: [0.3, 0.22, 2.0],
      },
      {
        label: "trefoil knot sdf",
        spec: TREFOIL_KNOT_SHAPE,
        eyeOffset: [1.45, 0.9, 1.8],
      },
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
      {
        label: "orbit ring sampled",
        spec: ORBIT_RING_SHAPE,
        opts: {},
        seed: 0x51aa,
      },
      { label: "gear sampled solid", spec: GEAR_SHAPE, opts: {}, seed: 0x51a8 },
      {
        label: "gear sampled outline",
        spec: GEAR_SHAPE,
        opts: { gearOutline: true },
        seed: 0x51a9,
      },
      {
        label: "star sampled",
        spec: STAR_PRISM_SHAPE,
        opts: {},
        seed: 0x51ab,
      },
      {
        label: "faceted crystal sampled",
        spec: FACETED_CRYSTAL_SHAPE,
        opts: {},
        seed: 0x51ac,
      },
      {
        label: "heart prism sampled",
        spec: HEART_PRISM_SHAPE,
        opts: {},
        seed: 0x51ad,
      },
      {
        label: "crescent moon sampled",
        spec: CRESCENT_MOON_SHAPE,
        opts: {},
        seed: 0x51ae,
      },
      {
        label: "snowflake prism sampled",
        spec: SNOWFLAKE_PRISM_SHAPE,
        opts: {},
        seed: 0x51af,
      },
      {
        label: "trefoil knot sampled",
        spec: TREFOIL_KNOT_SHAPE,
        opts: {},
        seed: 0x51b0,
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

    const file = writeLabeledContactSheet(panels, 5, "shapes.png");
    console.log(`  wrote ${file}`);
  });

  it("measures fill and reach with the shared instrument: inside the bound, attaining it", () => {
    const extentCases: readonly {
      name: string;
      spec: ShapeSpec;
      meshId?: MeshAssetId;
    }[] = [
      { name: "peace sign", spec: PEACE_SIGN_SHAPE },
      { name: "orbit ring", spec: ORBIT_RING_SHAPE },
      { name: "gear", spec: GEAR_SHAPE },
      { name: "star", spec: STAR_PRISM_SHAPE, meshId: "star-prism-v1" },
      {
        name: "faceted crystal",
        spec: FACETED_CRYSTAL_SHAPE,
        meshId: "faceted-crystal-v1",
      },
      {
        name: "heart prism",
        spec: HEART_PRISM_SHAPE,
        meshId: "heart-prism-v1",
      },
      {
        name: "crescent moon",
        spec: CRESCENT_MOON_SHAPE,
        meshId: "crescent-moon-v1",
      },
      {
        name: "snowflake prism",
        spec: SNOWFLAKE_PRISM_SHAPE,
        meshId: "snowflake-prism-v1",
      },
      {
        name: "trefoil knot",
        spec: TREFOIL_KNOT_SHAPE,
        meshId: "trefoil-knot-v1",
      },
    ];
    for (const { name, spec, meshId } of extentCases) {
      const bound = shapeBoundingRadius(spec);
      const mesh = meshId === undefined ? undefined : meshAsset(meshId);
      const extent = sampleSetExtent(
        (p) =>
          mesh === undefined
            ? shapeSdf(spec, p[0], p[1], p[2]) <= 0
            : meshContainsPoint(mesh, p),
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
      // …and tight: every canonical bound is attained by real features, so
      // the instrument must get close.
      expect(extent.reachAbs).toBeGreaterThan(0.85 * bound);
    }

    // Numeric readability guard: the canonical ring is a ring rather than
    // a visually similar solid puck. Its center must stay outside the set.
    expect(shapeSdf(ORBIT_RING_SHAPE, 0, 0, 0)).toBeGreaterThan(0);

    // Concavity guards: the open notches stay outside while a neighbouring
    // lobe/body point remains solid. These catch the two silhouettes turning
    // into their convex hulls even if their overall extent remains unchanged.
    expect(shapeSdf(HEART_PRISM_SHAPE, 0, 0.94, 0)).toBeGreaterThan(0);
    expect(shapeSdf(HEART_PRISM_SHAPE, 0.36, 0.9, 0)).toBeLessThan(0);
    expect(shapeSdf(CRESCENT_MOON_SHAPE, 0.25, 0, 0)).toBeGreaterThan(0);
    expect(shapeSdf(CRESCENT_MOON_SHAPE, -0.7, 0, 0)).toBeLessThan(0);

    // The mesh catalog's exact/bake tests already prove the twelve authored
    // snowflake branches survive. Probe those same production-shape points
    // here so the sheet cannot silently render a branchless atlas revision.
    for (let sector = 0; sector < 6; sector++) {
      const angle = (sector * Math.PI) / 3;
      for (const side of [-1, 1]) {
        const x = 0.62;
        const y = side * 0.24;
        expect(
          shapeSdf(
            SNOWFLAKE_PRISM_SHAPE,
            x * Math.cos(angle) - y * Math.sin(angle),
            x * Math.sin(angle) + y * Math.cos(angle),
            0,
          ),
        ).toBeLessThan(0);
      }
    }

    // Two opposite-height torus-knot centreline points must remain inside:
    // an accidentally flattened trefoil can keep its xy reach and still pass
    // a silhouette-only gate.
    expect(
      shapeSdf(TREFOIL_KNOT_SHAPE, 0.31, 0.31 * Math.sqrt(3), 0.31),
    ).toBeLessThan(0);
    expect(shapeSdf(TREFOIL_KNOT_SHAPE, -0.62, 0, -0.31)).toBeLessThan(0);
  });
});
