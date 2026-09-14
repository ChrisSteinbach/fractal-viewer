/**
 * WHAT AN ITERATED SPHERE-INVERSION SEED ORBIT LOOKS LIKE, AND WHETHER THE
 * APP ALREADY HAS A WAY TO SAY IT.
 *
 * The owner's visual gate for the sphere-inversion Surface family needs a
 * real DE-rendered sheet in 3D and native 4D, beside the shipped Mandelbox,
 * space-tiling and Balloon looks, before any production code exists. This
 * sheet is that evidence, plus the three measurements the construction's
 * definition leans on. The construction, the estimator's argument and every
 * figure quoted here are written out in `docs/sphere-inversion-family.md`;
 * the prototype math lives in `scripts/sphere-inversion-orbit.ts`.
 *
 * WHAT EACH PANEL DEPICTS: THE DEPTH-D SEED ORBIT `O_D`, never the limit set.
 * Deep copies shrink toward the limit set and the sub-pixel ones read as
 * lace, but no panel renders a limit-set approximation (no nested-ball
 * stand-in at the depth cap: an exhausted fold returns a POSITIVE bound).
 *
 * THE ESTIMATOR IS THE TRANSPORTED BOUND, marched at step scale 1.0 with no
 * damping factor. It is certified for disjoint generators modulo f64 (the
 * argument is in the doc), and section (c) measures it against the EXACT
 * explicit orbit. The Bridges 2016 form (own-copy SDF over the accumulated
 * derivative, times an empirical factor the paper puts "less than 0.08") is
 * rendered beside it and measured, labelled as the heuristic it is.
 *
 * INSTRUMENTS. Framing reach and fill go through `set-extent.ts` against the
 * fold's MEMBERSHIP oracle (`inversionOrbitContains`), never `de < eps`.
 * Every panel is `de-preview.ts`'s shared marcher and shading.
 *
 * Run: npx vitest run --config scripts/vitest.harness.config.ts \
 *        scripts/sphere-inversion.harness.ts
 * Writes, under `scripts/out/`:
 *   sphere-inversion-3d.png         (a) 3D beauty candidates
 *   sphere-inversion-estimator.png  (b) depth progression + estimator forms
 *   sphere-inversion-compare.png    (d) inversion vs Mandelbox / tiling /
 *                                       Balloon / the existing-vocabulary try
 *   sphere-inversion-4d.png         (e) native 4D rotor poses and slices
 * `SPHERE_INV_SIZE=N` overrides the panel size (a coarse pass while iterating).
 */
import {
  analyzeEscapeSystem,
  buildEscapeDE,
  ESCAPE_STEP_SCALE,
  ESCAPE_TIME_RADIUS,
  escapeSetContains,
  estimateEscapeDistance,
} from "../src/fractal/escape-de";
import {
  buildBalloon,
  estimateBalloonDistance,
} from "../src/fractal/balloon-de";
import {
  mandelboxCube,
  mengerSponge,
  octahedronFlake,
} from "../src/fractal/presets";
import { mulberry32 } from "../src/fractal/rng";
import {
  analyzeSurfaceSystem,
  buildSurfaceDE,
  deHasFolds,
  estimateDistance,
  estimateDistanceRefined,
} from "../src/fractal/surface-de";
import { resolveTiling } from "../src/fractal/tiling";
import { estimateDistanceRefinedTiled } from "../src/fractal/tiling-de";
import type { Transform } from "../src/fractal/types";
import { renderPreview, writeLabeledContactSheet } from "./de-preview";
import type { PanelStats, PreviewScene, Vec3 } from "./de-preview";
import { sampleSetExtent } from "./set-extent";
import {
  ballSeed,
  buildInversionScene,
  capSeed,
  cell24,
  cross8,
  cube8,
  enumerateSphereOrbit,
  estimateInversionDistance,
  estimateInversionDistancePaper,
  explicitOrbitDistance,
  foldQuery,
  icosahedral12,
  inversionOrbitContains,
  lift4,
  makeFoldScratch,
  octahedral6,
  shellSeed,
  tesseract16,
} from "./sphere-inversion-orbit";
import type {
  GBall,
  RotorPlane,
  InversionScene,
  InversionSceneSpec,
} from "./sphere-inversion-orbit";

const SIZE = Number(process.env.SPHERE_INV_SIZE ?? 320);

/** The orbit camera every exterior panel shares, in marching radii — close
 * enough that `de-preview.ts`'s absolute-distance fog leaves the far side
 * readable, wide enough to keep the silhouette in frame. */
const EYE_OFFSET: Vec3 = [1.1, 0.8, 1.3];
const ZOOM = 0.6;

/** Fill/reach budget for framing. Framing only — the doc's quoted fill
 * figures are re-measured at `set-extent.ts`'s full budget. */
const FRAME_POINTS = 32768;

interface Fixture {
  label: string;
  spec: InversionSceneSpec;
  /** Estimator form. Absent = the certified transported bound. */
  paperFactor?: number;
  eye?: Vec3;
  target?: Vec3;
  eyeOffset?: Vec3;
  zoom?: number;
  shadow?: boolean;
  /** `de-preview.ts` fogs on absolute ray distance; an open dome seen from
   * above puts its lit interior at ~2 radii and fog buries it. */
  fog?: boolean;
}

interface Row {
  label: string;
  stats: PanelStats;
  reach: number;
  fill: number;
}

function pct(n: number, size: number): string {
  return ((100 * n) / (size * size)).toFixed(1);
}

function statLine(stats: PanelStats, size: number): string {
  return (
    `H${pct(stats.hits, size)} X${pct(stats.exhausted, size)} ` +
    `S${(stats.steps / size / size).toFixed(1)} ${(stats.ms / 1000).toFixed(1)}S`
  );
}

function printRows(title: string, rows: Row[], size: number): void {
  console.log(`\n  ${title} (${size}px; H hit%, X exhausted%, S steps/ray)`);
  for (const r of rows) {
    console.log(
      `    ${r.label.padEnd(34)} ${statLine(r.stats, size).padEnd(26)} ` +
        `reach ${r.reach.toFixed(3)} fill ${r.fill.toFixed(3)}%`,
    );
  }
}

/** Unit vector helper for authored camera/cut directions. */
function unit(v: Vec3): Vec3 {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
}

/**
 * A shell cut open by removing the cap a ball at `dir·dist` of radius `cut`
 * covers — still an intersection of generalized balls, so inversion keeps
 * every copy exact.
 */
function cutShellSeed(
  rho: number,
  tau: number,
  dir: Vec3,
  dist: number,
  cut: number,
): GBall[] {
  const u = unit(dir);
  return [
    ...shellSeed(rho, tau, 3),
    { c: [u[0] * dist, u[1] * dist, u[2] * dist], r: cut, sign: -1 },
  ];
}

/** Render one fixture in 3D, framed on its MEMBERSHIP reach. */
function renderFixture3(fx: Fixture, size: number): Row {
  const scene = buildInversionScene(fx.spec);
  const scratch = makeFoldScratch(scene);
  const extent = sampleSetExtent(
    (p) => inversionOrbitContains(scene, p, scratch),
    { fillRadius: scene.boundRadius, points: FRAME_POINTS },
  );
  const R = fx.eye ? scene.boundRadius : Math.max(0.2, extent.reachAbs * 1.06);
  const factor = fx.paperFactor;
  const preview: PreviewScene = {
    de:
      factor === undefined
        ? (p) => estimateInversionDistance(scene, p, scratch)
        : (p) => estimateInversionDistancePaper(scene, p, factor, scratch),
    boundingRadius: R,
    stepScale: 1,
    eyeOffset: fx.eyeOffset ?? EYE_OFFSET,
    zoom: fx.zoom ?? ZOOM,
    shadow: fx.shadow,
    fog: fx.fog,
  };
  if (fx.eye) {
    preview.eye = fx.eye;
    preview.target = fx.target;
    preview.boundingCenter = [0, 0, 0];
  }
  return {
    label: fx.label,
    stats: renderPreview(preview, size),
    reach: extent.reachAbs,
    fill: extent.fillPct,
  };
}

// ------------------------------------------------------------- fixtures

/** Cut direction for the vault panels: toward the camera and the light. */
const VAULT_DIR: Vec3 = [0.35, 1, 0.55];

const BEAUTY_3D: Fixture[] = [
  {
    label: "PEARLS OCT6 R.70 BALL.28 D8",
    spec: {
      dim: 3,
      gens: octahedral6(1, 0.7),
      seed: ballSeed(0.28, 3),
      depth: 8,
    },
  },
  {
    label: "PEARLS OCT6 KISS BALL.28 D10 AXIS",
    spec: {
      dim: 3,
      gens: octahedral6(1, Math.SQRT1_2),
      seed: ballSeed(0.28, 3),
      depth: 10,
    },
    eyeOffset: [0.35, 0.45, 1.9],
  },
  {
    label: "PEARLS CUBE8 R.57 BALL.41 D8",
    spec: { dim: 3, gens: cube8(1, 0.57), seed: ballSeed(0.41, 3), depth: 8 },
  },
  {
    label: "PEARLS ICO12 R.52 BALL.47 D6",
    spec: {
      dim: 3,
      gens: icosahedral12(1, 0.52),
      seed: ballSeed(0.47, 3),
      depth: 6,
    },
  },
  {
    label: "PEARLS CUBE8 KISS BALL.42 D12 TOP",
    spec: {
      dim: 3,
      gens: cube8(1, 1 / Math.sqrt(3)),
      seed: ballSeed(0.42, 3),
      depth: 12,
    },
    eyeOffset: [0.45, 1.85, 0.6],
  },
  {
    label: "LACE SHELL ICO12 R.52 S1 T.03 D6",
    spec: {
      dim: 3,
      gens: icosahedral12(1, 0.52),
      seed: shellSeed(1, 0.03, 3),
      depth: 6,
    },
  },
  {
    label: "LACE SHELL CUBE8 R.57 S1 T.03 D7",
    spec: {
      dim: 3,
      gens: cube8(1, 0.57),
      seed: shellSeed(1, 0.03, 3),
      depth: 7,
    },
  },
  {
    label: "CAP OCT6 R.66 C1.15 D6",
    spec: {
      dim: 3,
      gens: octahedral6(1, 0.66),
      seed: capSeed(1.15, 3),
      depth: 6,
    },
  },
  {
    label: "VAULT INSIDE OCT6 R.70 HALF SHELL D8",
    spec: {
      dim: 3,
      gens: octahedral6(1, 0.7),
      seed: cutShellSeed(1, 0.06, VAULT_DIR, 10.25, 10),
      depth: 8,
    },
    eye: [0.15, 0.3, 0.1],
    target: [-0.6, -1, 0.1],
    zoom: 0.85,
    shadow: false,
    fog: false,
  },
  {
    label: "DOME OCT6 R.66 HALF SHELL T.06 D6",
    spec: {
      dim: 3,
      gens: octahedral6(1, 0.66),
      seed: cutShellSeed(1, 0.06, VAULT_DIR, 10.25, 10),
      depth: 6,
    },
    eyeOffset: [0.5, 1.45, 0.85],
    fog: false,
  },
  {
    label: "VAULT INSIDE ICO12 HALF SHELL D5",
    spec: {
      dim: 3,
      gens: icosahedral12(1, 0.5),
      seed: cutShellSeed(1, 0.06, VAULT_DIR, 10.25, 10),
      depth: 5,
    },
    eye: [0.12, 0.35, 0.18],
    target: [-0.25, -1, -0.35],
    zoom: 0.85,
    shadow: false,
    fog: false,
  },
  {
    label: "VAULT INSIDE CUBE8 R.57 HALF SHELL D7",
    spec: {
      dim: 3,
      gens: cube8(1, 0.57),
      seed: cutShellSeed(1, 0.06, VAULT_DIR, 10.25, 10),
      depth: 7,
    },
    eye: [0.12, 0.35, 0.18],
    target: [-0.3, -1, -0.2],
    zoom: 0.85,
    shadow: false,
    fog: false,
  },
];

const PEARL_SPEC = (depth: number): InversionSceneSpec => ({
  dim: 3,
  gens: octahedral6(1, 0.7),
  seed: ballSeed(0.28, 3),
  depth,
});

// ------------------------------------------------- existing vocabulary

/**
 * One generator's inversion spelled in the document's OWN vocabulary: a
 * `spherefold` (fixed radius 1, minimum radius 1e-3) conjugated by the
 * affine that takes `B(c, r)` to the unit ball and the post-affine that
 * takes it back. Inside the ball it IS `I(x)`; outside it is the identity —
 * the IIS fold's single step, which is exactly why this is the closest
 * existing expression and why neither gate can use it (doc).
 */
function spherefoldInversionLink(
  id: number,
  c: number[],
  r: number,
): Transform {
  return {
    id,
    position: [-c[0] / r, -c[1] / r, -c[2] / r],
    rotation: [0, 0, 0],
    scale: [1 / r, 1 / r, 1 / r],
    variations: [
      { type: "spherefold", weight: 1, minRadius: 1e-3, fixedRadius: 1 },
    ],
    post: { m: [r, 0, 0, 0, r, 0, 0, 0, r], t: [c[0], c[1], c[2]] },
  };
}

// ----------------------------------------------------------------- tests

describe("sphere-inversion seed orbits", () => {
  it("(a) renders the 3D beauty candidates", () => {
    const rows = BEAUTY_3D.map((fx) => renderFixture3(fx, SIZE));
    printRows("(a) 3D beauty candidates", rows, SIZE);
    const file = writeLabeledContactSheet(
      rows.map((r) => ({
        stats: r.stats,
        lines: [r.label, statLine(r.stats, SIZE)] as [string, string],
      })),
      4,
      "sphere-inversion-3d.png",
    );
    console.log(`  wrote ${file}`);
    for (const r of rows) {
      expect(r.stats.hits, `${r.label} rendered nothing`).toBeGreaterThan(
        0.01 * SIZE * SIZE,
      );
    }
  });

  it("(b) renders depth progression and the estimator forms", () => {
    const fixtures: Fixture[] = [
      ...[0, 1, 2, 4].map((depth) => ({
        label: `DEPTH ${depth} OCT6 R.70 CERTIFIED`,
        spec: PEARL_SPEC(depth),
      })),
      { label: "D8 CERTIFIED STEP 1.0", spec: PEARL_SPEC(8) },
      { label: "D8 PAPER FACTOR 1", spec: PEARL_SPEC(8), paperFactor: 1 },
      { label: "D8 PAPER FACTOR 0.08", spec: PEARL_SPEC(8), paperFactor: 0.08 },
      {
        label: "KISS CUBE8 D16 CERTIFIED",
        spec: {
          dim: 3,
          gens: cube8(1, 1 / Math.sqrt(3)),
          seed: ballSeed(0.42, 3),
          depth: 16,
        },
      },
    ];
    const rows = fixtures.map((fx) => renderFixture3(fx, SIZE));
    printRows("(b) depth progression + estimator forms", rows, SIZE);
    console.log(
      `  wrote ${writeLabeledContactSheet(
        rows.map((r) => ({
          stats: r.stats,
          lines: [r.label, statLine(r.stats, SIZE)] as [string, string],
        })),
        4,
        "sphere-inversion-estimator.png",
      )}`,
    );
  });

  it("(c) measures every estimator against the exact explicit orbit", () => {
    const cases: { label: string; spec: InversionSceneSpec }[] = [
      {
        label: "oct6 r.62 ball.30",
        spec: {
          dim: 3,
          gens: octahedral6(1, 0.62),
          seed: ballSeed(0.3, 3),
          depth: 4,
        },
      },
      { label: "oct6 r.70 ball.28", spec: { ...PEARL_SPEC(4) } },
      {
        label: "oct6 KISS ball.28",
        spec: {
          dim: 3,
          gens: octahedral6(1, Math.SQRT1_2),
          seed: ballSeed(0.28, 3),
          depth: 4,
        },
      },
      {
        label: "cube8 r.57 ball.41",
        spec: {
          dim: 3,
          gens: cube8(1, 0.57),
          seed: ballSeed(0.41, 3),
          depth: 4,
        },
      },
      {
        label: "ico12 r.52 ball.47",
        spec: {
          dim: 3,
          gens: icosahedral12(1, 0.52),
          seed: ballSeed(0.47, 3),
          depth: 3,
        },
      },
    ];
    const QUERIES = 3000;
    console.log(
      "\n  (c) estimate / exact distance to O_D over off-set queries " +
        "(uniform ball | near-copy shells at 1e-4..1e-1 copy radii)",
    );
    console.log(
      "    case                 copies  cert viol  cert p05/p50  " +
        "paper1 over% max  paper.08 over% max",
    );
    for (const { label, spec } of cases) {
      const scene = buildInversionScene(spec);
      const orbit = enumerateSphereOrbit(scene);
      const scratch = makeFoldScratch(scene);
      const rng = mulberry32(0x51e7e);
      const ratios: number[] = [];
      let viol = 0;
      let worstViol = 0;
      let over1 = 0;
      let max1 = 0;
      let over08 = 0;
      let max08 = 0;
      let n = 0;
      for (let q = 0; q < 2 * QUERIES; q++) {
        let p: Vec3;
        if (q < QUERIES) {
          p = [0, 0, 0].map(() => (2 * rng() - 1) * scene.boundRadius) as Vec3;
        } else {
          const i = Math.floor(rng() * orbit.count);
          const dir = unit([rng() - 0.5, rng() - 0.5, rng() - 0.5]);
          const off = orbit.r[i] * (1 + 10 ** (-4 + 3 * rng()));
          p = [0, 1, 2].map((a) => orbit.c[i * 3 + a] + dir[a] * off) as Vec3;
        }
        const ref = explicitOrbitDistance(3, orbit, p);
        if (ref <= 0) continue;
        n++;
        const est = estimateInversionDistance(scene, p, scratch);
        if (est > ref * (1 + 1e-9)) {
          viol++;
          worstViol = Math.max(worstViol, est / ref);
        }
        ratios.push(est / ref);
        const p1 = estimateInversionDistancePaper(scene, p, 1, scratch) / ref;
        const p08 =
          estimateInversionDistancePaper(scene, p, 0.08, scratch) / ref;
        if (p1 > 1) over1++;
        if (p08 > 1) over08++;
        max1 = Math.max(max1, p1);
        max08 = Math.max(max08, p08);
      }
      ratios.sort((a, b) => a - b);
      const q = (f: number) => ratios[Math.floor(f * (ratios.length - 1))];
      console.log(
        `    ${label.padEnd(20)} ${String(orbit.count).padStart(6)}  ` +
          `${String(viol).padStart(4)}/${n}  ` +
          `${q(0.05).toFixed(3)}/${q(0.5).toFixed(3)}  ` +
          `${((100 * over1) / n).toFixed(1).padStart(5)} ${max1.toFixed(1).padStart(6)}  ` +
          `${((100 * over08) / n).toFixed(1).padStart(5)} ${max08.toFixed(2)}`,
      );
      expect(viol, `${label}: certified bound exceeded ${worstViol}x`).toBe(0);
    }
  });

  it("(d) compares against Mandelbox, tiling, Balloon and the existing vocabulary", () => {
    // The existing-vocabulary attempt: the pearl arrangement's six
    // generators as spherefold-inversion links.
    const gens = octahedral6(1, 0.7);
    const links = gens.map((g, i) => spherefoldInversionLink(i, g.c, g.r));
    const ifs = analyzeSurfaceSystem(links);
    const withSeed = analyzeSurfaceSystem([
      ...links,
      {
        id: 99,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        variations: [],
        emitter: {
          parts: [
            { primitive: { kind: "sphere", radius: 0.28 }, combine: "union" },
          ],
        },
      },
    ]);
    const esc = analyzeEscapeSystem(links);
    console.log(
      `\n  (d) existing vocabulary, oct6 r.70 as spherefold links:\n` +
        `    IFS attractor gate:        ${ifs.status} — ${ifs.reasons.join("; ")}\n` +
        `    + sphere emitter (C0):     ${withSeed.status} — ${withSeed.reasons.join("; ")}\n` +
        `    escape-time chain gate:    ${esc.status} ${esc.reasons.join("; ")}`,
    );
    // Hard pin on the claim the doc makes: a pure-inversion document is
    // never a contractive IFS here.
    expect(ifs.status).toBe("ineligible");
    expect(withSeed.status).toBe("ineligible");

    const rows: Row[] = [];
    const inversion = (i: number) => renderFixture3(BEAUTY_3D[i], SIZE);
    rows.push(inversion(0), inversion(1), inversion(5), inversion(11));

    const frame = (
      label: string,
      de: (p: Vec3) => number,
      R: number,
      stepScale: number,
      target?: Vec3,
    ): Row => ({
      label,
      stats: renderPreview(
        {
          de,
          boundingRadius: R,
          stepScale,
          target,
          eyeOffset: EYE_OFFSET,
          zoom: ZOOM,
        },
        SIZE,
      ),
      reach: R,
      fill: NaN,
    });

    const cube = buildEscapeDE(mandelboxCube());
    rows.push(
      frame(
        "SHIPPED MANDELBOX CUBE",
        (p) => estimateEscapeDistance(cube, p),
        3.6,
        ESCAPE_STEP_SCALE,
      ),
    );

    const flake = buildSurfaceDE(octahedronFlake());
    const b3 = resolveTiling({ group: "b3" })!;
    rows.push(
      frame(
        "SHIPPED TILING B3 OCTAHEDRONFLAKE",
        (p) => estimateDistanceRefinedTiled(b3, flake, p),
        flake.boundingRadius,
        1,
      ),
    );

    const sponge = buildSurfaceDE(mengerSponge(), null);
    const raw = deHasFolds(sponge) ? estimateDistance : estimateDistanceRefined;
    const balloon = buildBalloon(sponge, 0.7);
    rows.push(
      frame(
        "SHIPPED BALLOON MENGER R0.7",
        (p) => estimateBalloonDistance(raw, sponge, balloon, p).d,
        sponge.visibleBoundingRadius * 2,
        sponge.stepScale,
        [...sponge.boundCenter] as Vec3,
      ),
    );

    if (esc.status !== "ineligible") {
      const chain = buildEscapeDE(links);
      const reach = sampleSetExtent((p) => escapeSetContains(chain, p), {
        fillRadius: ESCAPE_TIME_RADIUS,
        points: FRAME_POINTS,
      });
      const R = reach.reachAbs > 0 ? reach.reachAbs * 1.06 : ESCAPE_TIME_RADIUS;
      const row = frame(
        "EXISTING: SPHEREFOLD CHAIN OCT6",
        (p) => estimateEscapeDistance(chain, p),
        R,
        ESCAPE_STEP_SCALE,
      );
      row.reach = reach.reachAbs;
      row.fill = reach.fillPct;
      rows.push(row);
    }
    printRows("(d) comparison", rows, SIZE);
    console.log(
      `  wrote ${writeLabeledContactSheet(
        rows.map((r) => ({
          stats: r.stats,
          lines: [r.label, statLine(r.stats, SIZE)] as [string, string],
        })),
        4,
        "sphere-inversion-compare.png",
      )}`,
    );
  });

  it("(e0) the flat 4D embedding reproduces the 3D object bit for bit at w = 0", () => {
    const s3 = buildInversionScene(PEARL_SPEC(8));
    const s4 = buildInversionScene(FLAT_SPEC);
    const sc3 = makeFoldScratch(s3);
    const sc4 = makeFoldScratch(s4);
    const lift = lift4([], 0);
    const rng = mulberry32(0xf1a7);
    let estMismatch = 0;
    let memMismatch = 0;
    let n = 0;
    const check = (p: Vec3) => {
      n++;
      const d3 = estimateInversionDistance(s3, p, sc3);
      const d4 = estimateInversionDistance(s4, lift(p), sc4);
      if (!Object.is(d3, d4)) estMismatch++;
      if (
        inversionOrbitContains(s3, p, sc3) !==
        inversionOrbitContains(s4, lift(p), sc4)
      ) {
        memMismatch++;
      }
    };
    for (let i = 0; i < 40000; i++) {
      check([0, 0, 0].map(() => (2 * rng() - 1) * 0.8) as Vec3);
    }
    // A grid through the generator walls and centres as well: equality, not
    // volume, is the question, so alignment is an advantage here.
    for (let i = 0; i <= 32; i++) {
      for (let j = 0; j <= 32; j++) {
        for (let k = 0; k <= 32; k++) {
          check([(i - 16) / 16, (j - 16) / 16, (k - 16) / 16]);
        }
      }
    }
    const small = 120;
    const R = 0.755;
    const p3 = renderPreview(
      {
        de: (p) => estimateInversionDistance(s3, p, sc3),
        boundingRadius: R,
        stepScale: 1,
        eyeOffset: EYE_OFFSET,
        zoom: ZOOM,
      },
      small,
    );
    const p4 = renderPreview(
      {
        de: (p) => estimateInversionDistance(s4, lift(p), sc4),
        boundingRadius: R,
        stepScale: 1,
        eyeOffset: EYE_OFFSET,
        zoom: ZOOM,
      },
      small,
    );
    const bytesEqual = Buffer.from(p3.rgb).equals(Buffer.from(p4.rgb));
    console.log(
      `\n  (e0) flat embedding: ${n} queries, estimate mismatches ` +
        `${estMismatch}, membership mismatches ${memMismatch}, ` +
        `${small}px panel bytes identical: ${bytesEqual}`,
    );
    expect(estMismatch).toBe(0);
    expect(memMismatch).toBe(0);
    expect(bytesEqual).toBe(true);
  });

  it("(e) renders native 4D rotor poses and offset slices", () => {
    const groups = [FLAT_GROUP, CELL24_GROUP, CROSS8_GROUP, TESS16_GROUP];
    const results = new Map<string, Group4Result>();
    for (const g of groups) {
      const res = renderGroup4(g, SIZE);
      results.set(g.title, res);
      console.log(
        `\n  (e) ${g.title} — framed at ONE radius ${res.R.toFixed(3)}; ` +
          `IoU and pixel-status difference against the group's first pose`,
      );
      res.rows.forEach((r, i) => {
        console.log(
          `    ${g.poses[i].name.padEnd(18)} ${statLine(r.stats, SIZE).padEnd(26)} ` +
            `slice reach ${r.reach.toFixed(3)} fill ${r.fill.toFixed(3)}% ` +
            `IoU ${res.iou[i].toFixed(3)} contain ${res.contain[i].toFixed(3)} ` +
            `copies ${res.copyContain[i].toFixed(3)} ` +
            `px ${res.pxDiff[i].toFixed(1)}%`,
        );
      });
    }

    // The 3D twins of the two sub-arrangements a w = 0 slice meets, framed
    // at the 4D group's radius: does the off-slice half change the slice?
    const cell = results.get(CELL24_GROUP.title)!;
    const cross = results.get(CROSS8_GROUP.title)!;
    const cuboct = CELL24_GROUP.spec.gens
      .filter((g) => g.c[3] === 0)
      .map((g) => ({ c: g.c.slice(0, 3), r: g.r }));
    expect(cuboct).toHaveLength(12);
    const twin3 = (
      label: string,
      spec: InversionSceneSpec,
      res: Group4Result,
    ): Row & { pxDiff: number; iou: number } => {
      const scene = buildInversionScene(spec);
      const scratch = makeFoldScratch(scene);
      const stats = renderPreview(
        {
          de: (p) => estimateInversionDistance(scene, p, scratch),
          boundingRadius: res.R,
          stepScale: 1,
          eyeOffset: EYE_OFFSET,
          zoom: ZOOM,
          collect: true,
        },
        SIZE,
      );
      const mask = memberMask(
        (p) => inversionOrbitContains(scene, p, scratch),
        res.cloud,
      );
      return {
        label,
        stats,
        reach: res.R,
        fill: NaN,
        pxDiff: statusDiffPct(stats, res.rows[0].stats),
        iou: iou(mask, res.masks[0]),
      };
    };
    const cuboctRow = twin3(
      "3D TWIN: CUBOCT12 OF CELL24",
      {
        dim: 3,
        gens: cuboct,
        seed: shellSeed(1, 0.03, 3),
        depth: CELL24_GROUP.spec.depth,
      },
      cell,
    );
    const octRow = twin3(
      "3D TWIN: OCT6 OF CROSS8",
      {
        dim: 3,
        gens: octahedral6(1, Math.SQRT1_2),
        seed: ballSeed(0.28, 3),
        depth: CROSS8_GROUP.spec.depth,
      },
      cross,
    );
    console.log(
      `\n  (e) w = 0 slice vs its own w-free sub-arrangement in 3D:\n` +
        `    cell24 identity vs cuboct12 3D: IoU ${cuboctRow.iou.toFixed(3)}, ` +
        `pixel status differs ${cuboctRow.pxDiff.toFixed(1)}%\n` +
        `    cross8 identity vs oct6 3D:     IoU ${octRow.iou.toFixed(3)}, ` +
        `pixel status differs ${octRow.pxDiff.toFixed(1)}%`,
    );

    const label = (g: Group4, i: number) => {
      const res = results.get(g.title)!;
      const row = res.rows[i];
      return {
        stats: row.stats,
        lines: [
          `${g.short} ${g.poses[i].name}`,
          `${statLine(row.stats, SIZE)} I${res.iou[i].toFixed(2)} ` +
            `C${res.contain[i].toFixed(2)} K${res.copyContain[i].toFixed(2)}`,
        ] as [string, string],
      };
    };
    // An identity slice is PASSIVE BY CONSTRUCTION, not by this measurement:
    // inversions centred in the hyperplane preserve it, and a generator
    // whose ball misses it never folds a slice point, so the slice IS the
    // w-free sub-arrangement's 3D orbit. Pinned so a fixture change that
    // breaks the argument is caught rather than shown.
    expect(cuboctRow.iou).toBe(1);
    expect(octRow.iou).toBe(1);
    const file = writeLabeledContactSheet(
      [
        label(FLAT_GROUP, 0),
        label(FLAT_GROUP, 1),
        label(FLAT_GROUP, 2),
        label(TESS16_GROUP, 0),
        label(CROSS8_GROUP, 0),
        label(CROSS8_GROUP, 1),
        label(CROSS8_GROUP, 2),
        label(CROSS8_GROUP, 3),
        label(CROSS8_GROUP, 4),
        label(CROSS8_GROUP, 5),
        label(TESS16_GROUP, 1),
        label(TESS16_GROUP, 2),
        label(CELL24_GROUP, 0),
        label(CELL24_GROUP, 1),
        label(CELL24_GROUP, 2),
        label(CELL24_GROUP, 3),
        label(TESS16_GROUP, 3),
      ],
      4,
      "sphere-inversion-4d.png",
    );
    console.log(`  wrote ${file}`);
    // The non-flat fixtures must actually change under the rotor and the
    // slice (the epic's parity criterion), measured on membership: every
    // off-reference pose of the genuine groups must differ from its
    // reference (IoU) AND hold copies the reference lacks (copy containment)
    // — the second is what separates them from the passive offset.
    for (const g of [CELL24_GROUP, TESS16_GROUP]) {
      const res = results.get(g.title)!;
      for (let i = 1; i < g.poses.length; i++) {
        const what = `${g.title} ${g.poses[i].name}`;
        expect(res.iou[i], what).toBeLessThan(0.95);
        expect(res.copyContain[i], what).toBeLessThan(0.95);
      }
    }
    // The eight-hypersphere candidate is the MEASURED EXCEPTION, pinned as
    // one: its poses change membership (IoU) but its pearls stay 84-100%
    // contained in the identity slice's — erosion of the octahedral lace,
    // the flat embedding's behaviour, not new arrangement. A fixture change
    // that lifts it into genuine territory should fail here and be re-read.
    for (let i = 1; i < CROSS8_GROUP.poses.length; i++) {
      const what = `${CROSS8_GROUP.title} ${CROSS8_GROUP.poses[i].name}`;
      expect(cross.iou[i], what).toBeLessThan(0.95);
      expect(cross.copyContain[i], what).toBeGreaterThan(0.8);
    }
    const flat = results.get(FLAT_GROUP.title)!;
    expect(flat.contain[1], "the passive offset only erodes").toBeGreaterThan(
      0.99,
    );
  });
});

// ------------------------------------------------------- native 4D support

type Plane = RotorPlane;

interface Pose4 {
  name: string;
  planes: [Plane, number][];
  w0: number;
}

interface Group4 {
  title: string;
  short: string;
  spec: InversionSceneSpec;
  poses: Pose4[];
}

interface Group4Result {
  R: number;
  rows: Row[];
  cloud: Float64Array;
  masks: Uint8Array[];
  iou: number[];
  /** Share of a pose's members that are also members at the group's first
   * pose. IoU cannot tell a genuine 4D slice from a passive one — an offset
   * slice of the FLAT embedding only erodes every pearl, which drops IoU as
   * hard as new structure does — but erosion is CONTAINED (reads ~1) and
   * new arrangement is not. */
  contain: number[];
  /** {@link contain} over COPIES only — members whose fold spent at least
   * one inversion. A ball seed's own slice is rotation-invariant and holds
   * most of the volume, so plain containment reads ~1 however much the
   * pearls around it change; this column asks about the pearls. */
  copyContain: number[];
  pxDiff: number[];
}

const CLOUD_POINTS = 131072;

function ballCloud(R: number): Float64Array {
  const rng = mulberry32(0x4d_c10d);
  const pts = new Float64Array(CLOUD_POINTS * 3);
  for (let i = 0; i < CLOUD_POINTS; i++) {
    const u = Math.cbrt(rng()) * R;
    const ct = 2 * rng() - 1;
    const st = Math.sqrt(Math.max(0, 1 - ct * ct));
    const ph = 2 * Math.PI * rng();
    pts[i * 3] = u * st * Math.cos(ph);
    pts[i * 3 + 1] = u * st * Math.sin(ph);
    pts[i * 3 + 2] = u * ct;
  }
  return pts;
}

function memberMask(
  member: (p: Vec3) => boolean,
  cloud: Float64Array,
): Uint8Array {
  const mask = new Uint8Array(cloud.length / 3);
  for (let i = 0; i < mask.length; i++) {
    mask[i] = member([cloud[i * 3], cloud[i * 3 + 1], cloud[i * 3 + 2]])
      ? 1
      : 0;
  }
  return mask;
}

function iou(a: Uint8Array, b: Uint8Array): number {
  let inter = 0;
  let union = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] && b[i]) inter++;
    if (a[i] || b[i]) union++;
  }
  return union > 0 ? inter / union : 1;
}

function statusDiffPct(a: PanelStats, b: PanelStats): number {
  let diff = 0;
  const sa = a.status!;
  const sb = b.status!;
  for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) diff++;
  return (100 * diff) / sa.length;
}

function renderGroup4(g: Group4, size: number): Group4Result {
  const scene = buildInversionScene(g.spec);
  const scratch = makeFoldScratch(scene);
  const lifts = g.poses.map((p) => lift4(p.planes, p.w0));
  const member = (i: number) => (p: Vec3) =>
    inversionOrbitContains(scene, lifts[i](p), scratch);
  const extents = g.poses.map((_, i) =>
    sampleSetExtent(member(i), {
      fillRadius: scene.boundRadius,
      points: FRAME_POINTS,
    }),
  );
  const R = Math.max(0.2, Math.max(...extents.map((e) => e.reachAbs)) * 1.06);
  const cloud = ballCloud(R);
  const masks = g.poses.map((_, i) => memberMask(member(i), cloud));
  const copyMasks = g.poses.map((_, i) => {
    const mask = new Uint8Array(masks[i].length);
    for (let k = 0; k < mask.length; k++) {
      if (!masks[i][k]) continue;
      const q = lifts[i]([cloud[k * 3], cloud[k * 3 + 1], cloud[k * 3 + 2]]);
      mask[k] = foldQuery(scene, q, scratch).k > 0 ? 1 : 0;
    }
    return mask;
  });
  const containIn = (m: Uint8Array): number => {
    let inRef = 0;
    let count = 0;
    for (let i = 0; i < m.length; i++) {
      if (!m[i]) continue;
      count++;
      if (masks[0][i]) inRef++;
    }
    return count > 0 ? inRef / count : 1;
  };
  const rows: Row[] = g.poses.map((pose, i) => ({
    label: `${g.short} ${pose.name}`,
    stats: renderPreview(
      {
        de: (p) => estimateInversionDistance(scene, lifts[i](p), scratch),
        boundingRadius: R,
        stepScale: 1,
        eyeOffset: EYE_OFFSET,
        zoom: ZOOM,
        collect: true,
      },
      size,
    ),
    reach: extents[i].reachAbs,
    fill: extents[i].fillPct,
  }));
  return {
    R,
    rows,
    cloud,
    masks,
    iou: masks.map((m) => iou(m, masks[0])),
    contain: masks.map(containIn),
    copyContain: copyMasks.map(containIn),
    pxDiff: rows.map((r) => statusDiffPct(r.stats, rows[0].stats)),
  };
}

/** The deliberate FLAT embedding: the 3D pearl arrangement with every
 * centre at `w = 0` and a 4-ball seed. */
const FLAT_SPEC: InversionSceneSpec = {
  dim: 4,
  gens: octahedral6(1, 0.7, 4),
  seed: ballSeed(0.28, 4),
  depth: 8,
};

const FLAT_GROUP: Group4 = {
  title: "FLAT oct6-in-R4 r.70 ball.28 D8",
  short: "FLAT",
  spec: FLAT_SPEC,
  poses: [
    { name: "ID W0 0", planes: [], w0: 0 },
    { name: "ID W0 .15 PASSIVE", planes: [], w0: 0.15 },
    { name: "XW .40", planes: [["xw", 0.4]], w0: 0 },
  ],
};

/** The eight-hypersphere candidate: the 16-cell's vertices, KISSING (the
 * near-tangent version the coarse 4D exploration found keeps its lace arches
 * under small `w` rotations, where `r = 0.70` scattered into dust). */
const CROSS8_GROUP: Group4 = {
  title: "CROSS8 KISS ball.28 D10",
  short: "X8K",
  spec: {
    dim: 4,
    gens: cross8(1, Math.SQRT1_2),
    seed: ballSeed(0.28, 4),
    depth: 10,
  },
  poses: [
    { name: "ID W0 0", planes: [], w0: 0 },
    { name: "XW .15", planes: [["xw", 0.15]], w0: 0 },
    { name: "XW .30", planes: [["xw", 0.3]], w0: 0 },
    {
      name: "YW.6 ZW.3",
      planes: [
        ["yw", 0.6],
        ["zw", 0.3],
      ],
      w0: 0,
    },
    { name: "ID W0 .10", planes: [], w0: 0.1 },
    { name: "XW.3 W0 .15", planes: [["xw", 0.3]], w0: 0.15 },
  ],
};

/** A perforated 3-sphere SHELL through the 24-cell's hyperspheres: twelve
 * centres at w = 0, twelve at w = ±0.707, the clearest NEW-membership slices
 * the exploration measured. */
const CELL24_GROUP: Group4 = {
  title: "CELL24 r.49 SHELL s1 t.03 D5",
  short: "C24SH",
  spec: {
    dim: 4,
    gens: cell24(1, 0.49),
    seed: shellSeed(1, 0.03, 4),
    depth: 5,
  },
  poses: [
    { name: "ID W0 0", planes: [], w0: 0 },
    { name: "XW .30", planes: [["xw", 0.3]], w0: 0 },
    { name: "ID W0 .30", planes: [], w0: 0.3 },
    { name: "ID W0 .60", planes: [], w0: 0.6 },
  ],
};

/** Tesseract, TANGENT: no centre lies in w = 0 and the balls just miss it,
 * so the identity slice would be the bare seed; every pose is off it. */
const TESS16_GROUP: Group4 = {
  title: "TESS16 KISS ball.50 D7",
  short: "T16K",
  spec: {
    dim: 4,
    gens: tesseract16(1, 0.5),
    seed: ballSeed(0.5, 4),
    depth: 7,
  },
  poses: [
    { name: "ID W0 .30", planes: [], w0: 0.3 },
    { name: "ID W0 .45", planes: [], w0: 0.45 },
    { name: "XW.5 W0 .10", planes: [["xw", 0.5]], w0: 0.1 },
    {
      name: "XW.5 YW.4 ZW.3",
      planes: [
        ["xw", 0.5],
        ["yw", 0.4],
        ["zw", 0.3],
      ],
      w0: 0,
    },
  ],
};
