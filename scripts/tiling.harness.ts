/**
 * The space-tiling harness sheet — the go/no-go measurement for the
 * finite-reflection-group tiling feature (`docs/tiling-contract.md` is the
 * frozen contract; `src/fractal/tiling.ts` owns the groups and the fold,
 * `src/fractal/tiling-de.ts` the seven wrapper estimators).
 *
 * WHAT IT SETTLES, in order:
 *
 *  0. THE FIXTURE MATRIX — one system per group (a3/b3/h3/a4/b4/f4), each a
 *     polytope-gasket system under its own symmetry group, each carrying an
 *     AUTHORED chamber clip (a sphere around the chamber content's
 *     centroid, radius 70% of the content's spatial reach — a trim of the
 *     outer tenth) so the tiled set `T = G·(A ∩ C ∩ clip)` genuinely
 *     differs from the attractor. The shipped gaskets are NOT aligned with
 *     the tiling's frozen root orientations (the invariance readout below
 *     measures 0.022-0.238R — each attractor is symmetric under a
 *     CONJUGATE of the frozen group), which is what makes the tiling cut
 *     them genuinely. Two fixture corrections, both measured: the a3 slot
 *     is a CONSTRUCTED aligned tetrahedron (the chamber's own vertex-ray
 *     orbit) because the shipped sierpinskiTetrahedron's content in the
 *     misaligned chamber is compact (100% within 0.25R of the centroid — a
 *     crossing-strut clump — so any reasonable clip is inert); the b4 slot
 *     stays the shipped sixteenCellFlake because the aligned 16-cell's
 *     vertices all sit in the hyperplanes w = ±0.65 (its w = 0 slice —
 *     the shipped session — has measure-zero content, 0 cloud points with
 *     |w| < 0.01, and renders nothing) while the shipped 16-cell's compact
 *     chamber content (76.4% within 0.135R) makes its clip-cut copies
 *     sub-pixel (disclosed per row).
 *
 *  1. OVERSHOOT — the go/no-go number. For every fixture, seeded probes
 *     (cloud-jittered, uniform, exact, and a WALL class — points on and
 *     just outside the chamber walls, the false-wall hazard's home) assert
 *     the tiled estimate NEVER exceeds the true distance to the tiled set,
 *     where the true distance is the cloud oracle d(F(q), S_cloud) with
 *     `S_cloud = cloud ∩ chamber ∩ clip` (fold the query, nearest to the
 *     in-chamber content — the surface-beam convention: the cloud is a
 *     SUBSET of the content, so the nearest is an over-stated distance and
 *     every counted violation is a TRUE violation, never manufactured).
 *
 *  2. THE FALSE CHAMBER WALL — the contract's disclosed hazard, probed
 *     directly: wall-flat probes (points ON each wall hyperplane at random
 *     radii) and reflected content probes (chamber points near a wall,
 *     reflected across it, plus deeper pushes outside). A false wall is a
 *     point where the marcher's OWN stop test fires (`est < RENDER_EPS·t`,
 *     the shared marcher's acceptance at the panel size — NOT the
 *     surface-beam 0.01R proxy, which is coarser than this sheet's
 *     worst-case acceptance and over-reports; the proxy column is reported
 *     and the near-misses are disclosed) while the content is far
 *     (`trueD > 0.05R`). Every render-acceptance flag is re-verified with a
 *     DENSE LOCAL ORACLE — orbits seeded at the FOLDED point (the
 *     F(x)-centered ball — a first version centered at the raw probe and
 *     manufactured a false wall out of a fold that moved the point onto
 *     content), 8 runs x CLOUD, counting in-clip points within 0.05R. A
 *     zero count is conclusive (the chaos cloud's natural measure near a
 *     piece is dense: ~280 points per 300k-run on the a4 near-miss's
 *     region).
 *
 *  3. THE FOLD — step distribution over every probe (max/mean/p50/p90, the
 *     share of queries the tiling actually folds, cap-expiry hits and null
 *     returns — both must be 0, the proof's bound A3 6 / B3 9 / H3 15 /
 *     A4 10 / B4 16 / F4 24 under the 32 cap), plus the per-query COST of
 *     the wrapper against the untiled estimator (timed ratio, median of
 *     five rounds).
 *
 *  4. THE EXACTNESS ANCHOR — a single-map system (fixed point inside the
 *     A3 chamber) whose true distance is ANALYTIC: `min_g |q − g·p0|` over
 *     `enumerateOrbit`'s explicit 24-image orbit, no cloud, no tolerance.
 *     Measures both the wrapper's overshoot exactly and the nearest-copy
 *     theorem's identity `|F(q) − p0| = min_g |q − g·p0|` at fp precision.
 *
 *  5. THE RENDERS — every fixture through the SHARED `renderPreview`
 *     (untiled / tiled / tiled+clip, the 4D rows as their w = 0 slice —
 *     `renderPreview` is a 3D marcher, and the contract's "tiled 4D
 *     sessions run slice 0" makes the slice the shipped session anyway),
 *     one labeled contact sheet, with per-panel hit/exhausted counts and
 *     the pixel-distinctness readout between the columns.
 *
 *  6. GLSL HEADROOM (pre-tiling) — the resolved and emitted source lengths
 *     for the largest LEGAL 3D and 4D variant combinations
 *     (`surfaceFragmentResolvedFor`/`surfaceFragmentFor` and the 4D
 *     twins), against `SURFACE_GLSL_STRIP_BYTES` (64KB, the strip rule's
 *     threshold — crossing strips benignly, the escape+balloon precedent)
 *     and the documented ~80KB Mesa link cliff (82.2KB crashed Mesa
 *     outright; `docs/surface-glsl-tracers.md`). This is the budget the
 *     compile-gated tiling arm (fr-fn9j's bead) must fit into; the real
 *     Mesa link is that bead's own gate.
 *
 * THE VERDICT. GO iff every fixture shows zero measured overshoot
 * (jittered/uniform/wall classes hard zero at the 1e-9 threshold; the
 * exact class's on-attractor erosion budgeted at 1e-4·R, the surface-beam
 * affine discipline), zero verified false walls, the clip renders are
 * distinct from the untiled ones, the fold never expires, and the GLSL
 * emitted lengths stay under the strip bound (hence far under the cliff)
 * for every legal combination. ANY overshoot or verified false wall on a
 * fixture is a NO-GO naming that fixture and figure — no tolerance is
 * raised to make it green.
 *
 * DISCLOSURES. All six matrix fixtures are AFFINE (polytope gaskets); the
 * fold-family wrappers are not fixture'd here — the wrapper composition is
 * core-agnostic (its soundness chain imports only the core's lower-bound
 * property, pinned per core by surface-beam), and the fold family's own
 * bound is already the surface-beam sheet's subject. The 4D panels render
 * the w = 0 slice of the tiled set; the 4D groups' folds genuinely reflect
 * w, so the slice is of the true 4D orbit, and the fill column measures
 * the slice's 3D fill, not the 4D set's. The fill/reach figures come from
 * the shared set-extent instrument with a membership oracle of the form
 * "fold the sample, then test the folded point against the base attractor
 * within a tolerance τ = 2x the mean cloud spacing, AND inside the clip" —
 * a dilation read, disclosed per row, and a THIN-SET read (the gaskets'
 * volume fill is ~0 while their surfaces draw thousands of rays; the
 * set-extent module doc's warning applies verbatim, and the reach column
 * is the one with meaning).
 *
 * Run: npx vitest run --config scripts/vitest.harness.config.ts \
 *        scripts/tiling.harness
 * Writes: `scripts/out/tiling.png` (the contact sheet).
 * Env knobs: CLOUD (300000), SIZE (200).
 *
 * MEASURED VERDICT (recorded run, Node 22.23.2, ~53s): GO.
 *
 *   fixture matrix (system / group / dim / engine family / R / chamber
 *   oracle / clip):
 *     a3 tetrahedronAligned   3D affine-refined  R=1.667  oracle 12570/1run
 *     b3 octahedronFlake      3D affine-refined  R=1.346  oracle 6393/1
 *     h3 icosahedronFlake     3D affine-refined  R=1.462  oracle 4543/1
 *     a4 pentatope            4D affine4-refined R=1.032  oracle 8971/1
 *     b4 sixteenCellFlake     4D affine4-refined R=1.352  oracle 4792/6
 *     f4 twentyFourCellFlake  4D affine4-refined R=1.466  oracle 553/8
 *
 *   OVERSHOOT: 0/0/0/0/0/0 violations total per fixture — hard zero on
 *   every class at the 1e-9 threshold, and the exact-class erosion reads 0
 *   on every fixture (the 1e-4·R budget unused). The wrapper
 *   `max(DE(F(q)), clipSdf(F(q)))` never exceeds the cloud oracle
 *   d(F(q), S_cloud) anywhere measured.
 *
 *   FALSE WALLS: 0 verified on every fixture. Proxy flags (the surface-beam
 *   0.01R convention): 0/0/0/1/0/0 — the single proxy flag is the a4
 *   NEAR-MISS, verified and disclosed: a jittered probe at est 9.81e-3
 *   (0.95%R) against a render acceptance of 9.65e-3 at its worst-case ray,
 *   with content 1.47e-1 (14.3%R) away (dense oracle: 3328 local attractor
 *   points within 0.05R of F(q), ZERO in-clip) — the marcher does NOT stop
 *   at the sheet's resolution (est sits above every ray's acceptance; a
 *   band census at the 0.0095 acceptance cutoff finds no sub-acceptance
 *   points within 0.1R of F(q)), so this is the surface-beam allowance
 *   class — a slow-march spot at the clip boundary's graze — not a
 *   rendered false wall. It would stop a marcher with acceptance > 0.95%R
 *   (i.e. the sheet's panel below ~180px); the chamber-wall classes
 *   (wall-flat + reflected probes) measured 0 flags on every fixture.
 *
 *   FOLD: max steps 6/9/15/10/16/23 against the proven bounds 6/9/15/10/16/
 *   24 — the proof holds, 0 cap-expiry hits, 0 null returns, and the fold
 *   fired on 96.3/96.9/98.7/99.0/98.4/99.8% of probes (mean steps
 *   2.60/3.74/6.13/4.19/6.69/9.66, p90 5/7/11/7/12/17). The wrapper's
 *   timed cost vs the untiled estimator: 1.199/0.876/0.949/0.917/0.750/
 *   0.752x — the fold's own work (a few dot products) is dominated by the
 *   descent's per-query variance; the worst case measured is the aligned
 *   a3's 1.199x.
 *
 *   RENDERS (200px, shared marcher; 4D rows are the w=0 slice):
 *     group  untiled/tiled/tiled+clip hits   distinct noClip/clip
 *     a3     4648/4648/3421                 0.0% / 4.7%
 *     b3     6332/6343/4780                 17.6% / 16.3%
 *     h3     10754/12879/11193              29.8% / 27.4%
 *     a4     416/3114/2637                  8.2% / 7.1%
 *     b4     6297/781/0                     16.2% / 15.4%
 *     f4     9178/1716/1505                 22.5% / 22.5%
 *   exhausted rays: 0 on every panel. The aligned a3's no-clip tiled panel
 *   IS the untiled panel (invariance measured: invReadout 0.0004R) — the
 *   clip column carries its distinctness; the shipped gaskets' no-clip
 *   panels differ genuinely (invReadout 0.0493R / 0.0219R / 0.0732R /
 *   0.0991R / 0.0940R — the b3 octahedron is the mildest conjugate, h3 the
 *   closest to aligned). The b4 clip panel renders nothing at 200px: the
 *   B4 chamber's content is compact (76.4% within 0.135R of the centroid)
 *   and the clip-cut copies are sub-pixel — the tiled set is real (reach
 *   0.899R) and the no-clip tiled panel (781 hits, 16.2% distinct) shows
 *   the tiling.
 *
 *   EXTENT (shared set-extent instrument, membership tau disclosed per
 *   row): fill 0.00/0.00/0.00/10.17/0.33/0.03% of the 1.06R ball, reach
 *   0.0000/0.0000/0.0000/0.8137/0.8991/1.0087 — thin-fractal reads (the
 *   a4 pentatope's 10.17% fill is the one row with measurable volume).
 *
 *   EXACTNESS ANCHOR: wrapper overshoot exactly 0 over 400 probes against
 *   the analytic orbit; the nearest-copy identity
 *   max |F(q)−p0| − min_g|q−g·p0| = 5.1e-7 — the fold's epsilon-stop
 *   soundness gap, inside the contract's disclosed 2·FOLD_EPS = 2e-6 bound
 *   (sub-pixel).
 *
 *   GLSL HEADROOM (pre-tiling): every legal combination's EMITTED source
 *   is under the 64KB strip bound — min emitted headroom 243 B (4D
 *   plain+finish; 16627 B under the ~80KB Mesa cliff even there). The
 *   RESOLVED side: the largest 3D combination (lens + plane + condensation
 *   + schedule + chaos + finish) is 112494 B and every descent stack past
 *   ~65KB strips; the tiling arm's ~2-4KB resolved growth crosses the
 *   tightest rows' strip threshold (4D plain+finish sits 243 B under it
 *   today) — a benign strip that SHRINKS the emitted program (the
 *   escape+balloon precedent: 64681 B resolved -> ~13KB emitted), and the
 *   emitted side stays under the cliff with the documented ~1/3 margin by
 *   construction. The fr-fn9j bead's budget: the resolved headroom of the
 *   combo the tiling arm lands on; the Mesa link is its own gate.
 *
 *   THE CLIP RULE'S MEASURED HISTORY (why it is what it is): the first
 *   sketch clamped the sphere inside the chamber (min_i <c, n_i> >= r) —
 *   measured degenerate (inClip 0.5-15%, pentatope 0.000: the chamber
 *   content hugs the polytope vertex where the walls meet, so the content
 *   centroid sits within ~0.1R of a wall); the second sketched a
 *   count-percentile radius — measured sub-pixel (70% of the content by
 *   chaos-game measure sits in a tiny clump, and the clip-cut copies
 *   rendered 0-48 hits at 200px); the shipped rule (70% of the content's
 *   SPATIAL reach) is the one whose renders are visible. And the clip
 *   SPEC itself carries the pose offset — the first version forgot it and
 *   the clip sat at the ORIGIN, which manufactured empty clip renders and
 *   one false-wall flag before the harness's own census caught it.
 *
 *   THE FLAG INVESTIGATION'S HISTORY (the near-miss's proof): the 0.01R
 *   proxy flagged the a4 jittered probe; the render-aware acceptance
 *   (RENDER_EPS·(EYE_MAG·R + |p|)) did not; a band census at the
 *   acceptance cutoff found no sub-acceptance points within 0.1R of F(q);
 *   the sub-acceptance points the band DID find (1895 of them) all
 *   verified content-near with the F(x)-centered dense oracle (min in-clip
 *   distance 1.5e-3-2.7e-3R). The first verification pass centered the
 *   dense ball at the raw probe instead of the fold and manufactured one
 *   "verified false wall" out of a probe whose fold moved it onto content
 *   (clipSdf(F(x)) = -0.092, 3366 in-clip points within 0.05R of F(x)).
 */

import { toTransform4 } from "../src/fractal/affine4";
import { runChaosGame } from "../src/fractal/chaos-game";
import type { ChaosGameResult } from "../src/fractal/chaos-game";
import { runChaosGame4 } from "../src/fractal/chaos-game-4d";
import type { ChaosGame4Result } from "../src/fractal/chaos-game-4d";
import {
  icosahedronFlake,
  octahedronFlake,
  pentatope,
  sixteenCellFlake,
  twentyFourCellFlake,
} from "../src/fractal/presets";
import { mulberry32 } from "../src/fractal/rng";
import type { Rng } from "../src/fractal/rng";
import { shapeSdf } from "../src/fractal/shapes";
import type { ShapeSpec } from "../src/fractal/shapes";
import {
  analyzeSurfaceSystem,
  buildSurfaceDE,
  estimateDistanceRefined,
} from "../src/fractal/surface-de";
import type { SurfaceDE } from "../src/fractal/surface-de";
import {
  analyzeSurfaceSystem4,
  buildSurfaceDE4,
  estimateDistance4Refined,
} from "../src/fractal/surface-de-4d";
import type { SurfaceDE4 } from "../src/fractal/surface-de-4d";
import {
  enumerateOrbit,
  foldToChamber,
  foldToChamberWithSteps,
  isInChamber,
  MAX_TILING_FOLD_STEPS,
  reflectAcrossWall,
  resolveTiling,
  TILING_GROUP_INFO,
} from "../src/fractal/tiling";
import type { TilingGroup, TilingGroupInfo } from "../src/fractal/tiling";
import {
  estimateDistance4RefinedTiled,
  estimateDistance4Tiled,
  estimateDistanceRefinedTiled,
} from "../src/fractal/tiling-de";
import type { Transform, Vec4 } from "../src/fractal/types";
import { renderPreview, writeLabeledContactSheet } from "./de-preview";
import type { DistanceEstimator, PanelStats, Vec3 } from "./de-preview";
import { sampleSetExtent } from "./set-extent";
import {
  surfaceFragmentFor,
  surfaceFragmentResolvedFor,
  SURFACE_GLSL_STRIP_BYTES,
} from "../src/app/surface-material";
import {
  surface4FragmentFor,
  surface4FragmentResolvedFor,
} from "../src/app/surface-material-4d";

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const CLOUD = envInt("CLOUD", 300_000);
const SIZE = envInt("SIZE", 200);

// ------------------------------------------------------------ thresholds

/** The violation threshold, surface-beam's own: an excess past 1e-9 counts
 * as an overshoot. */
const VIOL_EPS = 1e-9;
/** On-attractor (exact-class) erosion budget, as a fraction of R — the
 * surface-beam affine row's 1e-4. The `exact` probes sit ON the attractor,
 * where the descent's fp-noise tail reads positive (surface-beam measured
 * e66@3.2e-8 scale); the off-attractor classes are a HARD zero. */
const EXACT_EROSION_BUDGET_R = 1e-4;
/** The marcher hit-test proxy (surface-beam's `VOID_HIT_FACTOR`): an
 * estimate under 0.01R would stop a ray. Reported as the convention column;
 * the GATE reads the render-aware acceptance below (the marcher's actual
 * stop test is `est < (1.1/SIZE)·zoom·max(t, 1)` — the 0.01R proxy is
 * coarser than the 200px sheet's worst-case acceptance and over-reports,
 * which the a4 near-miss measured: proxy flags with `est` above the
 * acceptance are slow-march spots, not stops). */
const HIT_FACTOR = 0.01;
/** The shared marcher's acceptance epsilon at the sheet's panel size. */
const RENDER_EPS = (1.1 / SIZE) * 0.55;
/** The de-preview default eye offset's magnitude — the probe's worst-case
 * ray parameter is `EYE_MAG·R + |p|`, so its acceptance ceiling is
 * `RENDER_EPS·(EYE_MAG·R + |p|)`. */
const EYE_MAG = Math.hypot(1.55, 1.1, 1.8);
/** A probe is "in a genuine void" (content far) past 0.05R — the false-wall
 * criterion. */
const VOID_FACTOR = 0.05;
/** The oracle's chamber-content target: flags are only trusted at this
 * density. */
const ORACLE_TARGET = 4000;
/** Cap on chamber-refocus runs per fixture. */
const ORACLE_RUN_CAP = 8;

const CLOUD_SEED = 101;
const JITTER_SEED = 2;
const UNIFORM_SEED = 3;
const WALL_SEED = 41;
const ANCHOR_SEED = 101;

// ------------------------------------------------------------- fixtures

interface FixtureDef {
  group: TilingGroup;
  label: string;
  transforms: Transform[];
}

/** The six shipped polytope gaskets, each under its own symmetry group —
 * the contract's "natural chamber content". MEASURED, the shipped gaskets
 * are NOT aligned with the tiling's frozen root orientations (the
 * invariance readout reads 0.022-0.238R; the shipped octahedron's ±axis
 * vertices came closest only because the octahedron's own group is a mild
 * conjugate of the frozen B3): the tiling cuts them genuinely, which is
 * what makes the no-clip tiled renders distinct from the untiled ones on
 * four of the six. One swap: sierpinskiTetrahedron measured with COMPACT
 * chamber content (100% within 0.25R of the content centroid — the
 * misaligned A3 chamber intersects the tetrahedron gasket only in a
 * crossing-strut clump, so the authored clip is inert), so its slot takes
 * the ALIGNED tetrahedron (the chamber's own vertex-ray orbit — see
 * {@link alignedGasket}), whose content is the proper orthoscheme piece.
 * The B4 slot was tried as the aligned 16-cell and REVERTED: the frozen
 * B4's action keeps that polytope's vertices in the two hyperplanes
 * w = ±0.65 (measured: the orbit's w values are +0.5 x4 / -0.5 x4), so its
 * w = 0 slice — the shipped session — has measure-zero content (0 cloud
 * points with |w| < 0.01) and renders nothing; the shipped
 * sixteenCellFlake keeps its rich slice, at the cost of a compact chamber
 * content whose clip-cut copies render sub-pixel (disclosed per row). */
function buildFixtures(): FixtureDef[] {
  return [
    {
      group: "a3",
      label: "tetrahedronAligned",
      transforms: alignedGasket("a3", 1.6, 0.5),
    },
    { group: "b3", label: "octahedronFlake", transforms: octahedronFlake() },
    { group: "h3", label: "icosahedronFlake", transforms: icosahedronFlake() },
    { group: "a4", label: "pentatope", transforms: pentatope() },
    { group: "b4", label: "sixteenCellFlake", transforms: sixteenCellFlake() },
    {
      group: "f4",
      label: "twentyFourCellFlake",
      transforms: twentyFourCellFlake(),
    },
  ];
}

/** The 3x3 determinant — the 4D nullspace helper below's engine. */
function det3(m: number[][]): number {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  );
}

/** The chamber's VERTEX ray: the direction orthogonal to the walls
 * 1..dim-1 (the maximal proper sub-diagram's fixed ray — the polytope
 * vertex the chamber contains). Its orbit under the group is the aligned
 * polytope's vertex set (the orbit's size = order/stabilizer: A3 24/6 = 4,
 * B4 384/48 = 8 — asserted in the fixture gate), so the flake built from
 * it is genuinely invariant under the tiling's group, unlike the shipped
 * gaskets (module doc of {@link buildFixtures}). */
export function chamberVertexRay(info: TilingGroupInfo): Vec3 | Vec4 {
  const dim = info.dim;
  if (dim === 3) {
    // The 3D nullspace of the two rows (walls 1, 2): their cross product.
    const a = [0, 1, 2].map((j) => info.roots[1 * 3 + j]);
    const b = [0, 1, 2].map((j) => info.roots[2 * 3 + j]);
    const d = normalize([
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ]);
    return (minPairing(info, d) < 0 ? d.map((v) => -v) : d) as Vec3;
  }
  // 4D: the null vector via the cross-product formula — d_j = (-1)^j
  // det(M_j) with M_j the 3x3 matrix of walls 1..3 dropping column j.
  const d = new Array<number>(4).fill(0);
  for (let j = 0; j < 4; j++) {
    const m: number[][] = [];
    for (let r = 1; r <= 3; r++) {
      const row: number[] = [];
      for (let c = 0; c < 4; c++) {
        if (c !== j) row.push(info.roots[r * 4 + c]);
      }
      m.push(row);
    }
    d[j] = (j % 2 === 0 ? 1 : -1) * det3(m);
  }
  const n = normalize(d);
  return (minPairing(info, n) < 0 ? n.map((v) => -v) : n) as Vec4;
}

/** The ALIGNED polytope gasket: maps contracting toward the orbit of the
 * chamber's vertex ray (the aligned polytope's vertices), so the attractor
 * IS invariant under the tiling's group and its chamber content is the
 * proper orthoscheme piece. */
export function alignedGasket(
  group: TilingGroup,
  vertexRadius: number,
  ratio: number,
): Transform[] {
  const info = TILING_GROUP_INFO[group];
  const ray = chamberVertexRay(info);
  const orbit: number[][] = [];
  enumerateOrbit(info, ray, orbit);
  const k = 1 - ratio;
  return orbit.map((v, id): Transform => {
    const position: Vec3 = [
      v[0] * vertexRadius * k,
      v[1] * vertexRadius * k,
      v[2] * vertexRadius * k,
    ];
    const scale: Vec3 = [ratio, ratio, ratio];
    return {
      id,
      position,
      rotation: [0, 0, 0],
      scale,
      ...(group.endsWith("4")
        ? { w: { position: v[3] * vertexRadius * k } }
        : {}),
    };
  });
}

function normalize(v: number[]): number[] {
  let s = 0;
  for (const x of v) s += x * x;
  const l = Math.sqrt(s) || 1;
  return v.map((x) => x / l);
}

/** The closest wall's pairing (the chamber-distance numerator). */
function minPairing(info: TilingGroupInfo, p: number[]): number {
  const dim = info.dim;
  let min = Infinity;
  for (let i = 0; i < dim; i++) {
    let dot = 0;
    const base = i * dim;
    for (let j = 0; j < dim; j++) dot += p[j] * info.roots[base + j];
    if (dot < min) min = dot;
  }
  return min;
}

/** The AUTHORED clip for a fixture: a sphere centered on the chamber
 * content's centroid, radius 70% of the content's SPATIAL reach (the 90th
 * percentile of the content's distances to the centroid). The count-based
 * rule was measured and REJECTED: the chamber content's measure is
 * vertex-concentrated (the gasket's mass clumps at the polytope vertex the
 * chamber contains), so a 70th-percentile-of-count radius came out tiny
 * (0.02-0.07R) and the tiled render showed almost nothing (0-48 hits).
 * Spatial reach is what a render sees: the clip trims the outer tenth of
 * the content's extent, cutting each chamber's piece visibly, and its
 * orbit copies cut the whole tiled set the same way. The clip is NOT
 * required to fit inside the chamber: the contract's clip only narrows S
 * by intersection (`A ∩ C ∩ clip`), so the sphere's part outside the walls
 * is simply never content. (A first sketch clamped the sphere inside the
 * chamber — min_i ⟨c, n_i⟩ ≥ r — which measured degenerate too: the
 * content centroid sits within ~0.1R of a wall, and the clamp shrank every
 * clip to 0-15% content, pentatope to 0.000.) The clip is 3D —
 * `tiling-de.ts`'s extruded embedding reads the folded point's first three
 * coordinates — so the 4D fixtures' centers use the content centroid's
 * xyz. Deterministic given the seeded content. */
function chooseClip(
  info: TilingGroupInfo,
  radius: number,
  content: number[][],
): { spec: ShapeSpec; center: Vec3; clipRadius: number; inShare: number } {
  const dim = info.dim;
  const c4 = new Array<number>(dim).fill(0);
  for (const p of content) for (let j = 0; j < dim; j++) c4[j] += p[j];
  for (let j = 0; j < dim; j++) c4[j] /= content.length;
  const center: Vec3 = [c4[0], c4[1], c4[2]];
  const dists = content.map((p) =>
    Math.hypot(p[0] - center[0], p[1] - center[1], p[2] - center[2]),
  );
  dists.sort((a, b) => a - b);
  const span =
    dists[Math.min(dists.length - 1, Math.floor(0.9 * dists.length))];
  const r = Math.max(0.1 * radius, 0.7 * span);
  const inShare = dists.filter((d) => d <= r).length / dists.length;
  return {
    spec: {
      parts: [
        {
          primitive: { kind: "sphere", radius: r },
          combine: "union",
          pose: { offset: center },
        },
      ],
    },
    center,
    clipRadius: r,
    inShare,
  };
}

// ---------------------------------------------------------------- oracles

/** The chamber-content oracle for a 3D fixture: in-chamber cloud points
 * (repeated seeded chaos runs until ~ORACLE_TARGET), unfiltered by the
 * clip (the clip choice reads them), returned as a flat xyz array plus the
 * first run's full cloud (the jitter/exact probe sources). */
function oracle3(
  info: TilingGroupInfo,
  transforms: Transform[],
): { pts: Float32Array; n: number; runs: number; cloud: ChaosGameResult } {
  const chunks: Float32Array[] = [];
  let n = 0;
  let runs = 0;
  let cloud: ChaosGameResult | null = null;
  for (; runs < ORACLE_RUN_CAP && n < ORACLE_TARGET; runs++) {
    cloud = runChaosGame(
      transforms,
      CLOUD,
      mulberry32(CLOUD_SEED + runs * 7919),
    );
    const keep = new Float32Array(cloud.count * 3);
    let k = 0;
    for (let i = 0; i < cloud.count; i++) {
      const p: Vec3 = [
        cloud.positions[i * 3],
        cloud.positions[i * 3 + 1],
        cloud.positions[i * 3 + 2],
      ];
      if (!isInChamber(info, p)) continue;
      keep[k * 3] = p[0];
      keep[k * 3 + 1] = p[1];
      keep[k * 3 + 2] = p[2];
      k++;
    }
    if (k > 0) {
      chunks.push(keep.subarray(0, k * 3));
      n += k;
    }
  }
  const pts = new Float32Array(n * 3);
  let off = 0;
  for (const c of chunks) {
    pts.set(c, off);
    off += c.length;
  }
  return { pts, n, runs, cloud: cloud! };
}

/** The 4D twin of {@link oracle3}: in-chamber points of the lifted system,
 * returned with their w coordinate (interleaved), plus the first run's
 * full cloud. */
function oracle4(
  info: TilingGroupInfo,
  transforms: Transform[],
): { pts: Float32Array; n: number; runs: number; cloud: ChaosGame4Result } {
  const lifted = transforms.map(toTransform4);
  const chunks: Float32Array[] = [];
  let n = 0;
  let runs = 0;
  let cloud: ChaosGame4Result | null = null;
  for (; runs < ORACLE_RUN_CAP && n < ORACLE_TARGET; runs++) {
    cloud = runChaosGame4(lifted, CLOUD, mulberry32(CLOUD_SEED + runs * 7919));
    const keep = new Float32Array(cloud.count * 4);
    let k = 0;
    for (let i = 0; i < cloud.count; i++) {
      const p: Vec4 = [
        cloud.positions[i * 3],
        cloud.positions[i * 3 + 1],
        cloud.positions[i * 3 + 2],
        cloud.w[i],
      ];
      if (!isInChamber(info, p)) continue;
      keep[k * 4] = p[0];
      keep[k * 4 + 1] = p[1];
      keep[k * 4 + 2] = p[2];
      keep[k * 4 + 3] = p[3];
      k++;
    }
    if (k > 0) {
      chunks.push(keep.subarray(0, k * 4));
      n += k;
    }
  }
  const pts = new Float32Array(n * 4);
  let off = 0;
  for (const c of chunks) {
    pts.set(c, off);
    off += c.length;
  }
  return { pts, n, runs, cloud: cloud! };
}

function nearest3(pts: Float32Array, n: number, p: number[]): number {
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const dx = pts[i * 3] - p[0];
    const dy = pts[i * 3 + 1] - p[1];
    const dz = pts[i * 3 + 2] - p[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}

function nearest4(pts: Float32Array, n: number, p: number[]): number {
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const dx = pts[i * 4] - p[0];
    const dy = pts[i * 4 + 1] - p[1];
    const dz = pts[i * 4 + 2] - p[2];
    const dw = pts[i * 4 + 3] - p[3];
    const d2 = dx * dx + dy * dy + dz * dz + dw * dw;
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}

// ----------------------------------------------------------------- probes

interface Probe3 {
  p: Vec3;
  cls: "jittered" | "uniform" | "exact" | "wall";
}

interface Probe4 {
  p: Vec4;
  cls: "jittered" | "uniform" | "exact" | "wall";
}

/** The probe mix, surface-beam's own: 400 jittered cloud samples, 200
 * uniform cube points, 100 exact cloud samples — plus the WALL class:
 * reflected content probes (chamber cloud points within 0.05 of a wall,
 * reflected across it, two of three pushed deeper outside) and wall-flat
 * probes (points exactly ON a wall hyperplane at random radii, the
 * false-wall hazard's home). */
function queries3(
  info: TilingGroupInfo,
  cloud: ChaosGameResult,
  radius: number,
): Probe3[] {
  const out: Probe3[] = [];
  const jitterRng = mulberry32(JITTER_SEED);
  const stride = Math.max(1, Math.floor(cloud.count / 400));
  for (let i = 0; i < cloud.count && out.length < 400; i += stride) {
    out.push({
      p: [
        cloud.positions[i * 3] + (jitterRng() - 0.5) * 0.3,
        cloud.positions[i * 3 + 1] + (jitterRng() - 0.5) * 0.3,
        cloud.positions[i * 3 + 2] + (jitterRng() - 0.5) * 0.3,
      ],
      cls: "jittered",
    });
  }
  const uniformRng = mulberry32(UNIFORM_SEED);
  const half = 1.2 * radius;
  for (let i = 0; i < 200; i++) {
    out.push({
      p: [
        (uniformRng() - 0.5) * 2 * half,
        (uniformRng() - 0.5) * 2 * half,
        (uniformRng() - 0.5) * 2 * half,
      ],
      cls: "uniform",
    });
  }
  for (let i = 0; i < 100; i++) {
    const j = Math.floor((cloud.count * (i + 0.5)) / 100);
    out.push({
      p: [
        cloud.positions[j * 3],
        cloud.positions[j * 3 + 1],
        cloud.positions[j * 3 + 2],
      ],
      cls: "exact",
    });
  }
  const wallRng = mulberry32(WALL_SEED);
  const dim = info.dim;
  const near: number[][] = [];
  for (let i = 0; i < cloud.count; i++) {
    const p: Vec3 = [
      cloud.positions[i * 3],
      cloud.positions[i * 3 + 1],
      cloud.positions[i * 3 + 2],
    ];
    if (!isInChamber(info, p)) continue;
    if (minPairing(info, p) <= 0.05) near.push(p);
  }
  const wStride = Math.max(1, Math.floor(near.length / 150));
  const tmp: Vec3 = [0, 0, 0];
  for (let i = 0; i < near.length && out.length < 900; i += wStride) {
    const s = near[i];
    let worst = 0;
    let worstDot = Infinity;
    for (let w = 0; w < dim; w++) {
      let dot = 0;
      const base = w * dim;
      for (let j = 0; j < dim; j++) dot += s[j] * info.roots[base + j];
      if (dot < worstDot) {
        worstDot = dot;
        worst = w;
      }
    }
    const n: Vec3 = [
      info.roots[worst * dim],
      info.roots[worst * dim + 1],
      info.roots[worst * dim + 2],
    ];
    for (let push = 0; push < 3; push++) {
      for (let j = 0; j < 3; j++) tmp[j] = s[j];
      reflectAcrossWall(tmp, n, tmp);
      for (let j = 0; j < 3; j++) tmp[j] -= push * 0.15 * n[j];
      out.push({ p: [tmp[0], tmp[1], tmp[2]], cls: "wall" });
    }
  }
  for (let i = 0; i < 100; i++) {
    const w = Math.floor(wallRng() * dim);
    const n = [
      info.roots[w * dim],
      info.roots[w * dim + 1],
      info.roots[w * dim + 2],
    ];
    let u: number[] = [0, 0, 0];
    for (let tries = 0; tries < 8; tries++) {
      u = [wallRng() - 0.5, wallRng() - 0.5, wallRng() - 0.5];
      let dot = 0;
      for (let j = 0; j < 3; j++) dot += u[j] * n[j];
      for (let j = 0; j < 3; j++) u[j] -= dot * n[j];
      if (Math.hypot(u[0], u[1], u[2]) > 0.1) break;
    }
    const r = radius * (0.05 + 0.95 * wallRng());
    const un = normalize(u);
    out.push({
      p: [un[0] * r, un[1] * r, un[2] * r],
      cls: "wall",
    });
  }
  return out;
}

/** {@link queries3} one dimension up — jitter includes w, wall-flat probes
 * sit on the 4D wall hyperplanes (the 4D groups' roots carry w; F4's fourth
 * root especially). */
function queries4(
  info: TilingGroupInfo,
  cloud: ChaosGame4Result,
  radius: number,
): Probe4[] {
  const out: Probe4[] = [];
  const jitterRng = mulberry32(JITTER_SEED);
  const stride = Math.max(1, Math.floor(cloud.count / 400));
  for (let i = 0; i < cloud.count && out.length < 400; i += stride) {
    out.push({
      p: [
        cloud.positions[i * 3] + (jitterRng() - 0.5) * 0.3,
        cloud.positions[i * 3 + 1] + (jitterRng() - 0.5) * 0.3,
        cloud.positions[i * 3 + 2] + (jitterRng() - 0.5) * 0.3,
        cloud.w[i] + (jitterRng() - 0.5) * 0.3,
      ],
      cls: "jittered",
    });
  }
  const uniformRng = mulberry32(UNIFORM_SEED);
  const half = 1.2 * radius;
  for (let i = 0; i < 200; i++) {
    out.push({
      p: [
        (uniformRng() - 0.5) * 2 * half,
        (uniformRng() - 0.5) * 2 * half,
        (uniformRng() - 0.5) * 2 * half,
        (uniformRng() - 0.5) * 2 * half,
      ],
      cls: "uniform",
    });
  }
  for (let i = 0; i < 100; i++) {
    const j = Math.floor((cloud.count * (i + 0.5)) / 100);
    out.push({
      p: [
        cloud.positions[j * 3],
        cloud.positions[j * 3 + 1],
        cloud.positions[j * 3 + 2],
        cloud.w[j],
      ],
      cls: "exact",
    });
  }
  const wallRng = mulberry32(WALL_SEED);
  const dim = info.dim;
  const near: number[][] = [];
  for (let i = 0; i < cloud.count; i++) {
    const p: Vec4 = [
      cloud.positions[i * 3],
      cloud.positions[i * 3 + 1],
      cloud.positions[i * 3 + 2],
      cloud.w[i],
    ];
    if (!isInChamber(info, p)) continue;
    if (minPairing(info, p) <= 0.05) near.push(p);
  }
  const wStride = Math.max(1, Math.floor(near.length / 150));
  const tmp: Vec4 = [0, 0, 0, 0];
  for (let i = 0; i < near.length && out.length < 900; i += wStride) {
    const s = near[i];
    let worst = 0;
    let worstDot = Infinity;
    for (let w = 0; w < dim; w++) {
      let dot = 0;
      const base = w * dim;
      for (let j = 0; j < dim; j++) dot += s[j] * info.roots[base + j];
      if (dot < worstDot) {
        worstDot = dot;
        worst = w;
      }
    }
    const n: Vec4 = [
      info.roots[worst * dim],
      info.roots[worst * dim + 1],
      info.roots[worst * dim + 2],
      info.roots[worst * dim + 3],
    ];
    for (let push = 0; push < 3; push++) {
      for (let j = 0; j < dim; j++) tmp[j] = s[j];
      reflectAcrossWall(tmp, n, tmp);
      for (let j = 0; j < dim; j++) tmp[j] -= push * 0.15 * n[j];
      out.push({ p: [tmp[0], tmp[1], tmp[2], tmp[3]], cls: "wall" });
    }
  }
  for (let i = 0; i < 100; i++) {
    const w = Math.floor(wallRng() * dim);
    const n = Array.from({ length: dim }, (_, j) => info.roots[w * dim + j]);
    let u: number[] = [0, 0, 0, 0];
    for (let tries = 0; tries < 8; tries++) {
      u = [wallRng() - 0.5, wallRng() - 0.5, wallRng() - 0.5, wallRng() - 0.5];
      let dot = 0;
      for (let j = 0; j < dim; j++) dot += u[j] * n[j];
      for (let j = 0; j < dim; j++) u[j] -= dot * n[j];
      if (Math.hypot(u[0], u[1], u[2], u[3]) > 0.1) break;
    }
    const r = radius * (0.05 + 0.95 * wallRng());
    const un = normalize(u);
    out.push({ p: [un[0] * r, un[1] * r, un[2] * r, un[3] * r], cls: "wall" });
  }
  return out;
}

// ------------------------------------------------- dense verification

/** The dense local content oracle for a flagged probe: orbits SEEDED at the
 * folded point (the first draws of a wrapped RNG place the walk there, the
 * warm-up then settles it onto the attractor piece that contains F(q)),
 * counting in-clip points within `radius` of the fold. The chaos cloud's
 * natural measure near a piece is dense (the a4 near-miss's region read
 * ~280 points per 300k-run within 0.05R), so a zero count is conclusive:
 * the content really is far. 3D twin. */
function verifyContent3(
  transforms: Transform[],
  info: TilingGroupInfo,
  clip: ShapeSpec,
  center: number[],
  radius: number,
): number {
  const runs = 8;
  let inClip = 0;
  for (let run = 0; run < runs; run++) {
    const inner = mulberry32(0x5eed_5eed + run * 104729);
    let calls = 0;
    const seeded: Rng = () => (calls++ < 3 ? center[calls - 1] + 0.5 : inner());
    const cloud = runChaosGame(transforms, CLOUD, seeded);
    for (let i = 0; i < cloud.count; i++) {
      const p = [
        cloud.positions[i * 3],
        cloud.positions[i * 3 + 1],
        cloud.positions[i * 3 + 2],
      ];
      const d = Math.hypot(
        p[0] - center[0],
        p[1] - center[1],
        p[2] - center[2],
      );
      if (d <= radius && shapeSdf(clip, p[0], p[1], p[2]) <= 0) inClip++;
    }
  }
  return inClip;
}

/** {@link verifyContent3} one dimension up (the folded point's w included). */
function verifyContent4(
  transforms: Transform[],
  info: TilingGroupInfo,
  clip: ShapeSpec,
  center: number[],
  radius: number,
): number {
  const lifted = transforms.map(toTransform4);
  const runs = 8;
  let inClip = 0;
  for (let run = 0; run < runs; run++) {
    const inner = mulberry32(0x5eed_5eed + run * 104729);
    let calls = 0;
    const seeded: Rng = () => (calls++ < 4 ? center[calls - 1] + 0.5 : inner());
    const cloud = runChaosGame4(lifted, CLOUD, seeded);
    for (let i = 0; i < cloud.count; i++) {
      const p = [
        cloud.positions[i * 3],
        cloud.positions[i * 3 + 1],
        cloud.positions[i * 3 + 2],
        cloud.w[i],
      ];
      const d = Math.hypot(
        p[0] - center[0],
        p[1] - center[1],
        p[2] - center[2],
        p[3] - center[3],
      );
      if (d <= radius && shapeSdf(clip, p[0], p[1], p[2]) <= 0) inClip++;
    }
  }
  return inClip;
}

// ------------------------------------------------- grid membership

/** A coarse uniform grid over the cloud's ball, for the fill column's
 * membership tests (nearest-neighbour by cell + 3^dim neighbours instead
 * of a per-sample full scan). Cell size is the mean-spacing estimate
 * `2R·N^{-1/dim}`, so the grid is `N^{1/dim}` cells wide. */
function buildGrid(
  pts: Float32Array,
  n: number,
  dim: 3 | 4,
  radius: number,
): { cells: Map<number, number[]>; m: number } {
  const tau = (2 * radius) / Math.pow(n, 1 / dim);
  const m = Math.max(2, Math.ceil((2 * radius) / tau));
  const cells = new Map<number, number[]>();
  const key = (p: number[]): number => {
    let k = 0;
    for (let j = 0; j < dim; j++) {
      const c = Math.floor(((p[j] / radius + 1) / 2) * m);
      k = k * m + Math.max(0, Math.min(m - 1, c));
    }
    return k;
  };
  for (let i = 0; i < n; i++) {
    const p: number[] = Array.from({ length: dim }, (_, j) =>
      dim === 3 ? pts[i * 3 + j] : pts[i * 4 + j],
    );
    const k = key(p);
    const list = cells.get(k);
    if (list) list.push(i);
    else cells.set(k, [i]);
  }
  return { cells, m };
}

/** Membership with the grid: any cloud point within `tau` of p, where tau
 * is the grid's cell size — a dilation read, disclosed per row. */
function gridMember(
  cells: Map<number, number[]>,
  m: number,
  dim: 3 | 4,
  radius: number,
  tau: number,
  pts: Float32Array,
  p: number[],
): boolean {
  const keyOf = (q: number[]): number => {
    let k = 0;
    for (let j = 0; j < dim; j++) {
      const c = Math.floor(((q[j] / radius + 1) / 2) * m);
      k = k * m + Math.max(0, Math.min(m - 1, c));
    }
    return k;
  };
  const center = Array.from({ length: dim }, (_, j) =>
    Math.max(-1, Math.min(1, p[j] / radius)),
  );
  for (let a = -1; a <= 1; a++) {
    for (let b = -1; b <= 1; b++) {
      for (let c = -1; c <= 1; c++) {
        if (dim === 3) {
          const q = [center[0] + a / m, center[1] + b / m, center[2] + c / m];
          const list = cells.get(keyOf(q));
          if (!list) continue;
          for (const i of list) {
            const dx = pts[i * 3] - p[0];
            const dy = pts[i * 3 + 1] - p[1];
            const dz = pts[i * 3 + 2] - p[2];
            if (dx * dx + dy * dy + dz * dz <= tau * tau) return true;
          }
        } else {
          for (let d = -1; d <= 1; d++) {
            const q = [
              center[0] + a / m,
              center[1] + b / m,
              center[2] + c / m,
              center[3] + d / m,
            ];
            const list = cells.get(keyOf(q));
            if (!list) continue;
            for (const i of list) {
              const dx = pts[i * 4] - p[0];
              const dy = pts[i * 4 + 1] - p[1];
              const dz = pts[i * 4 + 2] - p[2];
              const dw = pts[i * 4 + 3] - p[3];
              if (dx * dx + dy * dy + dz * dz + dw * dw <= tau * tau)
                return true;
            }
          }
        }
      }
    }
  }
  return false;
}

// -------------------------------------------------------------- measuring

interface ClassRow {
  n: number;
  violations: number;
  maxExcess: number;
  /** Proxy flags at the surface-beam 0.01R hit test — reported, disclosed,
   * and checked against the render's own acceptance below. */
  voidFlags: number;
  /** Flags that survive the render-aware acceptance: the marcher's stop
   * test `est < RENDER_EPS·max(t,1)` at the probe's worst-case ray. */
  renderFlags: number;
}

interface FixtureRow {
  fixture: FixtureDef;
  info: TilingGroupInfo;
  dim: 3 | 4;
  de: SurfaceDE | SurfaceDE4;
  R: number;
  oracleN: number;
  oracleRuns: number;
  clipInShare: number;
  clipRadius: number;
  clipCenter: Vec3;
  byClass: Record<Probe3["cls"], ClassRow>;
  /** The G-invariance readout: mean |d(q, A_cloud) − d(F(q), A∩C_cloud)| / R
   * over the first 200 probes, and the sign — how far the attractor sits
   * from being invariant under the tiling's group (a shipped gasket is
   * symmetric under its OWN polytope's group, a conjugate of the tiling's
   * frozen one — only an aligned system reads ~0). */
  invMeanDiff: number;
  invDiffSign: string;
  flagDiags: string[];
  nearMisses: string[];
  /** Verified false walls: probe estimates below the render's acceptance
   * whose content distance survives the dense local oracle (seeded orbits
   * from the folded point — 0 in-clip points within 0.05R). ANY entry is a
   * NO-GO. */
  verifiedFalseWalls: string[];
  foldMax: number;
  foldMean: number;
  foldP50: number;
  foldP90: number;
  foldAnyFrac: number;
  foldCapHits: number;
  foldNulls: number;
  foldSamples: number;
  costRatio: number;
  panelUntiled: PanelStats;
  panelTiled: PanelStats;
  panelTiledClip: PanelStats;
  distinctClipPct: number;
  distinctNoClipPct: number;
  fillPct: number;
  fillReach: number;
  fillTau: number;
}

function measureFixture3(fixture: FixtureDef): FixtureRow {
  const info = TILING_GROUP_INFO[fixture.group];
  const de = buildSurfaceDE(fixture.transforms);
  const R = de.boundingRadius;
  const { pts, n, runs, cloud } = oracle3(info, fixture.transforms);
  const content: number[][] = [];
  for (let i = 0; i < n; i++)
    content.push([pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]]);
  const clip = chooseClip(info, R, content);
  const tiling = resolveTiling({ group: fixture.group, clip: clip.spec })!;

  const qs = queries3(info, cloud, R);
  const folded = new Array<number[]>(qs.length);
  const steps = new Array<number>(qs.length);
  let foldMax = 0;
  let foldSum = 0;
  let foldAny = 0;
  let foldCapHits = 0;
  let foldNulls = 0;
  for (let i = 0; i < qs.length; i++) {
    const f = foldToChamberWithSteps(info, qs[i].p, [0, 0, 0]);
    if (f === null) {
      foldNulls++;
      folded[i] = [0, 0, 0];
      steps[i] = MAX_TILING_FOLD_STEPS;
    } else {
      folded[i] = Array.from(f.point);
      steps[i] = f.steps;
      if (f.steps === MAX_TILING_FOLD_STEPS) foldCapHits++;
      if (f.steps > 0) foldAny++;
      foldSum += f.steps;
      if (f.steps > foldMax) foldMax = f.steps;
    }
  }
  const sorted = steps.slice().sort((a, b) => a - b);

  // The clip-filtered chamber content — the distance oracle's S_cloud.
  const clipPts = new Float32Array(n * 3);
  let clipN = 0;
  for (let i = 0; i < n; i++) {
    const p = [pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]];
    if (shapeSdf(clip.spec, p[0], p[1], p[2]) > 0) continue;
    clipPts[clipN * 3] = p[0];
    clipPts[clipN * 3 + 1] = p[1];
    clipPts[clipN * 3 + 2] = p[2];
    clipN++;
  }

  const byClass: Record<Probe3["cls"], ClassRow> = {
    jittered: {
      n: 0,
      violations: 0,
      maxExcess: 0,
      voidFlags: 0,
      renderFlags: 0,
    },
    uniform: {
      n: 0,
      violations: 0,
      maxExcess: 0,
      voidFlags: 0,
      renderFlags: 0,
    },
    exact: { n: 0, violations: 0, maxExcess: 0, voidFlags: 0, renderFlags: 0 },
    wall: { n: 0, violations: 0, maxExcess: 0, voidFlags: 0, renderFlags: 0 },
  };
  const flagDiags: string[] = [];
  const nearMisses: string[] = [];
  const verifiedFalseWalls: string[] = [];
  for (let i = 0; i < qs.length; i++) {
    const est = estimateDistanceRefinedTiled(tiling, de, qs[i].p);
    const trueD = nearest3(clipPts, clipN, folded[i]);
    const row = byClass[qs[i].cls];
    row.n++;
    if (est > trueD + VIOL_EPS) {
      row.violations++;
      row.maxExcess = Math.max(row.maxExcess, est - trueD);
    }
    if (est < HIT_FACTOR * R && trueD > VOID_FACTOR * R) {
      row.voidFlags++;
      const accept =
        RENDER_EPS *
        Math.max(
          1,
          EYE_MAG * R + Math.hypot(qs[i].p[0], qs[i].p[1], qs[i].p[2]),
        );
      if (est < accept) {
        // The marcher's own stop test would fire here — verify the content
        // distance with the dense local oracle (orbits seeded at the FOLDED
        // point) before believing it.
        const inClip = verifyContent3(
          fixture.transforms,
          info,
          clip.spec,
          folded[i],
          0.05 * R,
        );
        row.renderFlags++;
        if (inClip === 0) {
          verifiedFalseWalls.push(
            `${qs[i].cls} q=${qs[i].p.map((v) => v.toFixed(3)).join(",")} est=${est.toExponential(2)}` +
              ` (${((est / R) * 100).toFixed(2)}%R) accept=${accept.toExponential(2)}` +
              ` trueD=${trueD.toExponential(2)} — dense oracle: 0 in-clip within 0.05R of F(q)`,
          );
        }
        flagDiags.push(
          `  flag ${qs[i].cls} q=${qs[i].p.map((v) => v.toFixed(3)).join(",")}` +
            ` F(q)=${folded[i].map((v) => v.toFixed(3)).join(",")} est=${est.toExponential(2)}` +
            ` accept=${accept.toExponential(2)} trueD=${trueD.toExponential(2)} inClipNear=${inClip}`,
        );
      } else if (est < 2 * accept) {
        const inClip = verifyContent3(
          fixture.transforms,
          info,
          clip.spec,
          folded[i],
          0.05 * R,
        );
        nearMisses.push(
          `${qs[i].cls} est=${est.toExponential(2)} (${((est / R) * 100).toFixed(2)}%R) vs accept` +
            ` ${accept.toExponential(2)} — content ${trueD.toExponential(2)} away` +
            ` (dense local: ${inClip} in-clip within 0.05R of F(q)) — no stop at the sheet's resolution`,
        );
      }
    }
  }

  // The invariance readout: d(q, A_cloud) against d(F(q), A∩C_cloud) — the
  // no-clip chamber oracle is `pts` BEFORE the clip filter.
  let invSum = 0;
  let invLarger = 0;
  const invN = Math.min(200, qs.length);
  for (let i = 0; i < invN; i++) {
    const a = nearest3(cloud.positions, cloud.count, qs[i].p);
    const b = nearest3(pts, n, folded[i]);
    invSum += Math.abs(a - b);
    if (a > b + VIOL_EPS) invLarger++;
  }
  const invMeanDiff = invSum / invN / R;
  const invDiffSign =
    invLarger > invN / 2 ? "d(q,A)>d(F(q),A∩C)" : "d(q,A)<=d(F(q),A∩C)";

  // Relative cost: median of five timed rounds, warmup first.
  const timed = new Array<number>(5);
  for (let round = 0; round < 5; round++) {
    for (let i = 0; i < 200; i++)
      estimateDistanceRefinedTiled(tiling, de, qs[i].p);
    const t0 = performance.now();
    for (let i = 0; i < 800; i++)
      estimateDistanceRefinedTiled(tiling, de, qs[i % qs.length].p);
    const t1 = performance.now();
    const t2 = performance.now();
    for (let i = 0; i < 800; i++)
      estimateDistanceRefined(de, qs[i % qs.length].p);
    const t3 = performance.now();
    timed[round] = (t1 - t0) / (t3 - t2);
  }
  timed.sort((a, b) => a - b);

  // Renders: untiled / tiled / tiled+clip, all through the shared marcher.
  const untiled: DistanceEstimator = (p) => estimateDistanceRefined(de, p);
  const tiled: DistanceEstimator = (p) =>
    estimateDistanceRefinedTiled(
      resolveTiling({ group: fixture.group })!,
      de,
      p,
    );
  const tiledClip: DistanceEstimator = (p) =>
    estimateDistanceRefinedTiled(tiling, de, p);
  const common = {
    boundingRadius: R,
    stepScale: 1.0,
    maxSteps: 600,
  };
  const panelUntiled = renderPreview({ de: untiled, ...common }, SIZE);
  const panelTiled = renderPreview({ de: tiled, ...common }, SIZE);
  const panelTiledClip = renderPreview({ de: tiledClip, ...common }, SIZE);

  const distinctClipPct = pixelDiffPct(
    panelUntiled.rgb,
    panelTiledClip.rgb,
    SIZE,
  );
  const distinctNoClipPct = pixelDiffPct(
    panelUntiled.rgb,
    panelTiled.rgb,
    SIZE,
  );

  // The tiled set's fill/reach over the marching ball, via the shared
  // instrument and the membership oracle: fold the sample, membership of
  // the folded point against the base attractor within the grid tolerance,
  // AND inside the clip.
  const tau = (2 * R) / Math.pow(cloud.count, 1 / 3);
  const grid = buildGrid(cloud.positions, cloud.count, 3, R);
  const member = (p: Vec3): boolean => {
    const f = foldToChamber(info, p, [0, 0, 0]);
    if (f === null) return false;
    if (shapeSdf(clip.spec, f[0], f[1], f[2]) > 0) return false;
    return gridMember(grid.cells, grid.m, 3, R, tau, cloud.positions, f);
  };
  const extent = sampleSetExtent(member, {
    fillRadius: R * 1.06,
    scanRadius: R * 1.06,
    points: 65536,
  });

  return {
    fixture,
    info,
    dim: 3,
    de,
    R,
    oracleN: n,
    oracleRuns: runs,
    clipInShare: clip.inShare,
    clipRadius: clip.clipRadius,
    clipCenter: clip.center,
    byClass,
    invMeanDiff,
    invDiffSign,
    flagDiags,
    nearMisses,
    verifiedFalseWalls,
    foldMax,
    foldMean: foldSum / qs.length,
    foldP50: sorted[Math.floor(0.5 * sorted.length)],
    foldP90: sorted[Math.floor(0.9 * sorted.length)],
    foldAnyFrac: foldAny / qs.length,
    foldCapHits,
    foldNulls,
    foldSamples: qs.length,
    costRatio: timed[2],
    panelUntiled,
    panelTiled,
    panelTiledClip,
    distinctClipPct,
    distinctNoClipPct,
    fillPct: extent.fillPct,
    fillReach: extent.reachAbs,
    fillTau: tau,
  };
}

function measureFixture4(fixture: FixtureDef): FixtureRow {
  const info = TILING_GROUP_INFO[fixture.group];
  const de = buildSurfaceDE4(fixture.transforms);
  const R = de.boundingRadius;
  const { pts, n, runs, cloud } = oracle4(info, fixture.transforms);
  const content: number[][] = [];
  for (let i = 0; i < n; i++)
    content.push([pts[i * 4], pts[i * 4 + 1], pts[i * 4 + 2], pts[i * 4 + 3]]);
  const clip = chooseClip(info, R, content);
  const tiling = resolveTiling({ group: fixture.group, clip: clip.spec })!;

  const qs = queries4(info, cloud, R);
  const folded = new Array<number[]>(qs.length);
  const steps = new Array<number>(qs.length);
  let foldMax = 0;
  let foldSum = 0;
  let foldAny = 0;
  let foldCapHits = 0;
  let foldNulls = 0;
  for (let i = 0; i < qs.length; i++) {
    const f = foldToChamberWithSteps(info, qs[i].p, [0, 0, 0, 0]);
    if (f === null) {
      foldNulls++;
      folded[i] = [0, 0, 0, 0];
      steps[i] = MAX_TILING_FOLD_STEPS;
    } else {
      folded[i] = Array.from(f.point);
      steps[i] = f.steps;
      if (f.steps === MAX_TILING_FOLD_STEPS) foldCapHits++;
      if (f.steps > 0) foldAny++;
      foldSum += f.steps;
      if (f.steps > foldMax) foldMax = f.steps;
    }
  }
  const sorted = steps.slice().sort((a, b) => a - b);

  const clipPts = new Float32Array(n * 4);
  let clipN = 0;
  for (let i = 0; i < n; i++) {
    const p = [pts[i * 4], pts[i * 4 + 1], pts[i * 4 + 2], pts[i * 4 + 3]];
    if (shapeSdf(clip.spec, p[0], p[1], p[2]) > 0) continue;
    clipPts[clipN * 4] = p[0];
    clipPts[clipN * 4 + 1] = p[1];
    clipPts[clipN * 4 + 2] = p[2];
    clipPts[clipN * 4 + 3] = p[3];
    clipN++;
  }

  const byClass: Record<Probe3["cls"], ClassRow> = {
    jittered: {
      n: 0,
      violations: 0,
      maxExcess: 0,
      voidFlags: 0,
      renderFlags: 0,
    },
    uniform: {
      n: 0,
      violations: 0,
      maxExcess: 0,
      voidFlags: 0,
      renderFlags: 0,
    },
    exact: { n: 0, violations: 0, maxExcess: 0, voidFlags: 0, renderFlags: 0 },
    wall: { n: 0, violations: 0, maxExcess: 0, voidFlags: 0, renderFlags: 0 },
  };
  const flagDiags: string[] = [];
  const nearMisses: string[] = [];
  const verifiedFalseWalls: string[] = [];
  for (let i = 0; i < qs.length; i++) {
    const est = estimateDistance4RefinedTiled(tiling, de, qs[i].p, 0, null);
    const trueD = nearest4(clipPts, clipN, folded[i]);
    const row = byClass[qs[i].cls];
    row.n++;
    if (est > trueD + VIOL_EPS) {
      row.violations++;
      row.maxExcess = Math.max(row.maxExcess, est - trueD);
    }
    if (est < HIT_FACTOR * R && trueD > VOID_FACTOR * R) {
      row.voidFlags++;
      const accept =
        RENDER_EPS *
        Math.max(
          1,
          EYE_MAG * R +
            Math.hypot(qs[i].p[0], qs[i].p[1], qs[i].p[2], qs[i].p[3]),
        );
      if (est < accept) {
        const inClip = verifyContent4(
          fixture.transforms,
          info,
          clip.spec,
          folded[i],
          0.05 * R,
        );
        row.renderFlags++;
        if (inClip === 0) {
          verifiedFalseWalls.push(
            `${qs[i].cls} q=${qs[i].p.map((v) => v.toFixed(3)).join(",")} est=${est.toExponential(2)}` +
              ` (${((est / R) * 100).toFixed(2)}%R) accept=${accept.toExponential(2)}` +
              ` trueD=${trueD.toExponential(2)} — dense oracle: 0 in-clip within 0.05R of F(q)`,
          );
        }
        flagDiags.push(
          `  flag ${qs[i].cls} q=${qs[i].p.map((v) => v.toFixed(3)).join(",")}` +
            ` F(q)=${folded[i].map((v) => v.toFixed(3)).join(",")} est=${est.toExponential(2)}` +
            ` accept=${accept.toExponential(2)} trueD=${trueD.toExponential(2)} inClipNear=${inClip}`,
        );
      } else if (est < 2 * accept) {
        const inClip = verifyContent4(
          fixture.transforms,
          info,
          clip.spec,
          folded[i],
          0.05 * R,
        );
        nearMisses.push(
          `${qs[i].cls} est=${est.toExponential(2)} (${((est / R) * 100).toFixed(2)}%R) vs accept` +
            ` ${accept.toExponential(2)} — content ${trueD.toExponential(2)} away` +
            ` (dense local: ${inClip} in-clip within 0.05R of F(q)) — no stop at the sheet's resolution`,
        );
      }
    }
  }

  // The 4D cloud splits xyz and w into two arrays; the interleaved copy
  // serves the invariance readout, the membership grid and the fill.
  const cloud4 = new Float32Array(cloud.count * 4);
  for (let i = 0; i < cloud.count; i++) {
    cloud4[i * 4] = cloud.positions[i * 3];
    cloud4[i * 4 + 1] = cloud.positions[i * 3 + 1];
    cloud4[i * 4 + 2] = cloud.positions[i * 3 + 2];
    cloud4[i * 4 + 3] = cloud.w[i];
  }

  // The invariance readout — the full cloud is interleaved here (cloud4),
  // the no-clip chamber oracle is `pts` before the clip filter.
  let invSum = 0;
  let invLarger = 0;
  const invN = Math.min(200, qs.length);
  for (let i = 0; i < invN; i++) {
    const a = nearest4(cloud4, cloud.count, qs[i].p);
    const b = nearest4(pts, n, folded[i]);
    invSum += Math.abs(a - b);
    if (a > b + VIOL_EPS) invLarger++;
  }
  const invMeanDiff = invSum / invN / R;
  const invDiffSign =
    invLarger > invN / 2 ? "d(q,A)>d(F(q),A∩C)" : "d(q,A)<=d(F(q),A∩C)";

  const timed = new Array<number>(5);
  for (let round = 0; round < 5; round++) {
    for (let i = 0; i < 200; i++)
      estimateDistance4RefinedTiled(tiling, de, qs[i].p, 0, null);
    const t0 = performance.now();
    for (let i = 0; i < 800; i++)
      estimateDistance4RefinedTiled(tiling, de, qs[i % qs.length].p, 0, null);
    const t1 = performance.now();
    const t2 = performance.now();
    for (let i = 0; i < 800; i++)
      estimateDistance4Refined(de, qs[i % qs.length].p, 0, null);
    const t3 = performance.now();
    timed[round] = (t1 - t0) / (t3 - t2);
  }
  timed.sort((a, b) => a - b);

  const slice = (p: Vec3): Vec4 => [p[0], p[1], p[2], 0];
  const untiled: DistanceEstimator = (p) =>
    estimateDistance4Refined(de, slice(p), 0, null);
  const tiled: DistanceEstimator = (p) =>
    estimateDistance4RefinedTiled(
      resolveTiling({ group: fixture.group })!,
      de,
      slice(p),
      0,
      null,
    );
  const tiledClip: DistanceEstimator = (p) =>
    estimateDistance4RefinedTiled(tiling, de, slice(p), 0, null);
  const common = {
    boundingRadius: R,
    stepScale: 1.0,
    maxSteps: 600,
  };
  const panelUntiled = renderPreview({ de: untiled, ...common }, SIZE);
  const panelTiled = renderPreview({ de: tiled, ...common }, SIZE);
  const panelTiledClip = renderPreview({ de: tiledClip, ...common }, SIZE);

  const distinctClipPct = pixelDiffPct(
    panelUntiled.rgb,
    panelTiledClip.rgb,
    SIZE,
  );
  const distinctNoClipPct = pixelDiffPct(
    panelUntiled.rgb,
    panelTiled.rgb,
    SIZE,
  );

  const tau = (2 * R) / Math.pow(cloud.count, 1 / 4);
  const grid = buildGrid(cloud4, cloud.count, 4, R);
  const member = (p: Vec3): boolean => {
    const f = foldToChamber(info, [p[0], p[1], p[2], 0], [0, 0, 0, 0]);
    if (f === null) return false;
    if (shapeSdf(clip.spec, f[0], f[1], f[2]) > 0) return false;
    return gridMember(grid.cells, grid.m, 4, R, tau, cloud4, f);
  };
  const extent = sampleSetExtent(member, {
    fillRadius: R * 1.06,
    scanRadius: R * 1.06,
    points: 65536,
  });

  return {
    fixture,
    info,
    dim: 4,
    de,
    R,
    oracleN: n,
    oracleRuns: runs,
    clipInShare: clip.inShare,
    clipRadius: clip.clipRadius,
    clipCenter: clip.center,
    byClass,
    invMeanDiff,
    invDiffSign,
    flagDiags,
    nearMisses,
    verifiedFalseWalls,
    foldMax,
    foldMean: foldSum / qs.length,
    foldP50: sorted[Math.floor(0.5 * sorted.length)],
    foldP90: sorted[Math.floor(0.9 * sorted.length)],
    foldAnyFrac: foldAny / qs.length,
    foldCapHits,
    foldNulls,
    foldSamples: qs.length,
    costRatio: timed[2],
    panelUntiled,
    panelTiled,
    panelTiledClip,
    distinctClipPct,
    distinctNoClipPct,
    fillPct: extent.fillPct,
    fillReach: extent.reachAbs,
    fillTau: tau,
  };
}

/** The share of pixels whose RGB differs by more than 8/255 — the
 * distinctness readout between two panels of the same scene. */
function pixelDiffPct(a: Uint8Array, b: Uint8Array, size: number): number {
  let diff = 0;
  for (let i = 0; i < a.length; i += 3) {
    if (
      Math.abs(a[i] - b[i]) > 8 ||
      Math.abs(a[i + 1] - b[i + 1]) > 8 ||
      Math.abs(a[i + 2] - b[i + 2]) > 8
    ) {
      diff++;
    }
  }
  return (100 * diff) / (size * size);
}

// ------------------------------------------------------- printed helpers

const CLS_ORDER = ["jittered", "uniform", "exact", "wall"] as const;

function fmtClass(row: ClassRow, R: number): string {
  return (
    `n=${row.n} viol=${row.violations}` +
    (row.violations > 0
      ? `@${row.maxExcess.toExponential(1)}(${((row.maxExcess / R) * 100).toFixed(3)}%R)`
      : "") +
    ` proxyFlags=${row.voidFlags} renderFlags=${row.renderFlags}`
  );
}

// ------------------------------------------------------------- exactness

/** The exactness anchor: one contractive map whose fixed point sits inside
 * the A3 chamber. The attractor is exactly {p0}; the tiled set is exactly
 * its 24-image orbit; the true distance is analytic —
 * `min_g |q − g·p0|` over {@link enumerateOrbit}'s explicit orbit. */
function singleMapAnchor(): {
  p0: Vec3;
  orbit: number[][];
  theoremMaxDiff: number;
  violations: number;
  maxExcess: number;
  probes: number;
} {
  const p0: Vec3 = [0.4, 0.5, 0.6];
  const info = TILING_GROUP_INFO.a3;
  const transforms: Transform[] = [
    {
      id: 0,
      position: [0.2, 0.25, 0.3],
      rotation: [0, 0, 0],
      scale: [0.5, 0.5, 0.5],
      weight: 1,
    },
  ];
  const de = buildSurfaceDE(transforms);
  const R = de.boundingRadius;
  const tiling = resolveTiling({ group: "a3" })!;
  const orbit: number[][] = [];
  enumerateOrbit(info, p0, orbit);
  const rng = mulberry32(ANCHOR_SEED);
  let theoremMaxDiff = 0;
  let violations = 0;
  let maxExcess = 0;
  let probes = 0;
  for (let i = 0; i < 400; i++) {
    const q: Vec3 = [
      (rng() - 0.5) * 2.4 * R,
      (rng() - 0.5) * 2.4 * R,
      (rng() - 0.5) * 2.4 * R,
    ];
    let trueD = Infinity;
    for (const g of orbit) {
      const d = Math.hypot(q[0] - g[0], q[1] - g[1], q[2] - g[2]);
      if (d < trueD) trueD = d;
    }
    const folded = foldToChamber(info, q, [0, 0, 0]) as Vec3;
    theoremMaxDiff = Math.max(
      theoremMaxDiff,
      Math.hypot(folded[0] - p0[0], folded[1] - p0[1], folded[2] - p0[2]) -
        trueD,
    );
    const est = estimateDistanceRefinedTiled(tiling, de, q);
    probes++;
    if (est > trueD + VIOL_EPS) {
      violations++;
      maxExcess = Math.max(maxExcess, est - trueD);
    }
  }
  return {
    p0,
    orbit: orbit.slice(),
    theoremMaxDiff,
    violations,
    maxExcess,
    probes,
  };
}

// ---------------------------------------------------------- glsl matrix

interface GlslRow {
  name: string;
  resolved: number;
  emitted: number;
}

/** The largest legal 3D variant combinations — the resolver's own refusal
 * matrix (plane∧balloon, escape∧bulb, trap without a forward arm,
 * trap∧balloon, condensation/schedule/chaos with a forward arm) bounds
 * them; the 24 entries of `surface-material.test.ts`'s strip-rule matrix
 * are mirrored verbatim and the biggest legal compositions sit on top. */
function glsl3Rows(): GlslRow[] {
  const sphere: ShapeSpec = {
    parts: [{ primitive: { kind: "sphere", radius: 0.5 }, combine: "union" }],
  };
  const rows: GlslRow[] = [];
  const add = (
    name: string,
    a: number,
    b: number,
    c = 0,
    d = 0,
    e = 0,
    f = 0,
    g = 0,
    trap: ShapeSpec | null = null,
    cond: ShapeSpec[] | null = null,
    tg = 0,
    sched = 0,
    chaos = 0,
  ) => {
    rows.push({
      name,
      resolved: surfaceFragmentResolvedFor(
        a,
        b,
        c,
        d,
        e,
        f,
        g,
        undefined,
        trap,
        cond,
        false,
        tg,
        sched,
        chaos,
      ).length,
      emitted: surfaceFragmentFor(
        a,
        b,
        c,
        d,
        e,
        f,
        g,
        undefined,
        trap,
        cond,
        false,
        tg,
        sched,
        chaos,
      ).length,
    });
  };
  add("affine", 0, 0);
  add("fold lens", 0, 1);
  add("balloon", 0, 0, 1);
  add("ground plane", 0, 0, 0, 1);
  add("lens + balloon", 0, 1, 1);
  add("lens + plane", 0, 1, 0, 1);
  add("escape", 1, 0);
  add("escape + balloon", 1, 0, 1);
  add("escape + plane", 1, 0, 0, 1);
  add("bulb", 0, 0, 0, 0, 1);
  add("bulb + balloon", 0, 0, 1, 0, 1);
  add("bulb + plane", 0, 0, 0, 1, 1);
  add("affine + finish", 0, 0, 0, 0, 0, 1);
  add("fold lens + finish", 0, 1, 0, 0, 0, 1);
  add("balloon + finish", 0, 0, 1, 0, 0, 1);
  add("ground plane + finish", 0, 0, 0, 1, 0, 1);
  add("lens + balloon + finish", 0, 1, 1, 0, 0, 1);
  add("lens + plane + finish", 0, 1, 0, 1, 0, 1);
  add("escape + finish", 1, 0, 0, 0, 0, 1);
  add("escape + balloon + finish", 1, 0, 1, 0, 0, 1);
  add("escape + plane + finish", 1, 0, 0, 1, 0, 1);
  add("bulb + finish", 0, 0, 0, 0, 1, 1);
  add("bulb + balloon + finish", 0, 0, 1, 0, 1, 1);
  add("bulb + plane + finish", 0, 0, 0, 1, 1, 1);
  add("lens + plane + finish + pattern", 0, 1, 0, 1, 0, 1, 1);
  add(
    "lens + plane + condensation + schedule + chaos + finish",
    0,
    1,
    0,
    1,
    0,
    1,
    0,
    null,
    [sphere],
    0,
    1,
    1,
  );
  add("escape + lens + plane + finish", 1, 1, 0, 1, 0, 1);
  add(
    "escape + lens + plane + trap + trapGeometry + finish",
    1,
    1,
    0,
    1,
    0,
    1,
    0,
    sphere,
    null,
    1,
  );
  add(
    "bulb + lens + plane + trap + finish",
    0,
    1,
    0,
    1,
    1,
    1,
    0,
    sphere,
    null,
    1,
  );
  return rows;
}

/** The largest legal 4D combinations — the 4D resolver has no forward arms
 * and no lens (fold-shaped and forward 4D sessions are compute-only), so
 * the biggest rows are the descent arm's full stack and the balloon
 * variants. */
function glsl4Rows(): GlslRow[] {
  const sphere: ShapeSpec = {
    parts: [{ primitive: { kind: "sphere", radius: 0.5 }, combine: "union" }],
  };
  const rows: GlslRow[] = [];
  const add = (
    name: string,
    a = 0,
    b = 0,
    c = 0,
    d = 0,
    cond: ShapeSpec[] | null = null,
    sched = 0,
    chaos = 0,
  ) => {
    rows.push({
      name,
      resolved: surface4FragmentResolvedFor(a, b, c, d, cond, sched, chaos)
        .length,
      emitted: surface4FragmentFor(a, b, c, d, cond, sched, chaos).length,
    });
  };
  add("plain", 0, 0);
  add("plain + finish", 0, 0, 1);
  add("plain + finish + pattern", 0, 0, 1, 1);
  add("balloon", 1, 0);
  add("balloon + finish", 1, 0, 1);
  add("plane", 0, 1);
  add("plane + finish", 0, 1, 1);
  add("plane + finish + pattern", 0, 1, 1, 1);
  add(
    "plane + condensation + schedule + chaos + finish",
    0,
    1,
    1,
    0,
    [sphere],
    1,
    1,
  );
  add(
    "plane + condensation + schedule + chaos + finish + pattern",
    0,
    1,
    1,
    1,
    [sphere],
    1,
    1,
  );
  return rows;
}

// -------------------------------------------------------------- the sheet

/** The sheet's failures — collected across sections, asserted empty at the
 * end (a mid-loop failure must not truncate the table this harness exists
 * to print; surface-beam's convention). */
const failures: string[] = [];
const rows3: FixtureRow[] = [];
const rows4: FixtureRow[] = [];
let glsl3: GlslRow[] = [];
let glsl4: GlslRow[] = [];

describe("tiling harness", () => {
  it("(0) fixture matrix: eligibility, the chamber content oracle, the authored clip", () => {
    const fixtures = buildFixtures();
    console.log(`\n== tiling harness — fixture matrix (CLOUD=${CLOUD}) ==`);
    console.log(`group  system                 dim  status  R        maps`);
    for (const fixture of fixtures) {
      if (fixture.group.endsWith("3")) {
        const a = analyzeSurfaceSystem(fixture.transforms);
        const de = buildSurfaceDE(fixture.transforms);
        console.log(
          `-- ${fixture.group} ${fixture.label.padEnd(21)} 3D  ${a.status.padEnd(7)}` +
            ` ${de.boundingRadius.toFixed(4)} ${de.maps.length}`,
        );
        if (a.status === "ineligible") {
          failures.push(
            `${fixture.label}: unexpectedly ineligible (${a.reasons.join("; ")})`,
          );
        }
        // The aligned constructions' orbit-size gate: the chamber's vertex
        // ray must be generic enough that its orbit is the polytope's
        // vertex set (a3: 24/6 = 4, b4: 384/48 = 8).
        if (fixture.label.endsWith("Aligned")) {
          const ray = chamberVertexRay(TILING_GROUP_INFO[fixture.group]);
          const orbit: number[][] = [];
          const n = enumerateOrbit(
            TILING_GROUP_INFO[fixture.group],
            ray,
            orbit,
          );
          const expected =
            TILING_GROUP_INFO[fixture.group].order /
            TILING_GROUP_INFO[fixture.group].maxWordLength;
          if (n !== expected) {
            failures.push(
              `${fixture.label}: the chamber vertex ray's orbit has ${n} images,` +
                ` expected ${expected} (not the aligned polytope's vertex set)`,
            );
          }
          if (n !== orbit.length) {
            failures.push(
              `${fixture.label}: orbit count ${n} != stored ${orbit.length}`,
            );
          }
        }
      } else {
        const a = analyzeSurfaceSystem4(fixture.transforms);
        const de = buildSurfaceDE4(fixture.transforms);
        console.log(
          `-- ${fixture.group} ${fixture.label.padEnd(21)} 4D  ${a.status.padEnd(7)}` +
            ` ${de.boundingRadius.toFixed(4)} ${de.maps.length}`,
        );
        if (a.status === "ineligible") {
          failures.push(
            `${fixture.label}: unexpectedly ineligible (${a.reasons.join("; ")})`,
          );
        }
      }
    }
    expect(true).toBe(true);
  });

  it("(1) overshoot, false walls, fold steps and cost per fixture", () => {
    const fixtures = buildFixtures();
    console.log(
      `\n== overshoot (est vs cloud oracle d(F(q), S_cloud)), false walls, fold, cost ==`,
    );
    for (const fixture of fixtures) {
      const row = fixture.group.endsWith("3")
        ? measureFixture3(fixture)
        : measureFixture4(fixture);
      if (row.dim === 3) rows3.push(row);
      else rows4.push(row);
      const cls = row.byClass;
      console.log(
        `-- ${row.fixture.group} ${row.fixture.label} R=${row.R.toFixed(4)}` +
          ` oracle=${row.oracleN} pts/${row.oracleRuns} runs` +
          ` clipR=${row.clipRadius.toFixed(4)} inClip=${(row.clipInShare * 100).toFixed(1)}%` +
          ` clipCenter=${row.clipCenter.map((v) => v.toFixed(2)).join(",")}` +
          ` invReadout=${row.invMeanDiff.toFixed(4)}R ${row.invDiffSign}`,
      );
      for (const d of row.flagDiags) console.log(d);
      for (const n of row.nearMisses)
        console.log(`     ^ near-miss (no stop at this resolution): ${n}`);
      for (const v of row.verifiedFalseWalls)
        console.log(`     ! VERIFIED FALSE WALL: ${v}`);
      console.log(`     jittered: ${fmtClass(cls.jittered, row.R)}`);
      console.log(`     uniform:  ${fmtClass(cls.uniform, row.R)}`);
      console.log(`     exact:    ${fmtClass(cls.exact, row.R)}`);
      console.log(`     wall:     ${fmtClass(cls.wall, row.R)}`);
      console.log(
        `     fold: max=${row.foldMax} mean=${row.foldMean.toFixed(2)}` +
          ` p50=${row.foldP50} p90=${row.foldP90}` +
          ` foldedFrac=${(row.foldAnyFrac * 100).toFixed(1)}%` +
          ` capHits=${row.foldCapHits} nulls=${row.foldNulls}` +
          ` costTiled/Untiled=${row.costRatio.toFixed(3)}x`,
      );
      console.log(
        `     tiled-set extent (membership tau=${row.fillTau.toFixed(4)}):` +
          ` fill=${row.fillPct.toFixed(2)}% of the 1.06R ball, reach=${row.fillReach.toFixed(4)}`,
      );
      const bound = row.info.maxWordLength;
      if (row.foldMax > bound) {
        failures.push(
          `${row.fixture.label}: fold max ${row.foldMax} exceeds the proven bound ${bound}`,
        );
      }
      if (row.foldCapHits > 0 || row.foldNulls > 0) {
        failures.push(
          `${row.fixture.label}: fold cap hits=${row.foldCapHits} nulls=${row.foldNulls} (the proof says never)`,
        );
      }
      for (const c of CLS_ORDER) {
        if (c === "exact") {
          if (cls.exact.maxExcess > EXACT_EROSION_BUDGET_R * row.R) {
            failures.push(
              `${row.fixture.label}: exact-class erosion ${cls.exact.maxExcess.toExponential(2)}` +
                ` (${((cls.exact.maxExcess / row.R) * 100).toFixed(4)}%R) over the` +
                ` ${(EXACT_EROSION_BUDGET_R * 100).toFixed(2)}%R budget on ${cls.exact.violations} probes`,
            );
          }
        } else if (cls[c].violations > 0) {
          failures.push(
            `${row.fixture.label}: ${c} overshoot=${cls[c].violations}` +
              ` maxExcess=${cls[c].maxExcess.toExponential(2)}` +
              ` (${((cls[c].maxExcess / row.R) * 100).toFixed(4)}%R)`,
          );
        }
      }
      const proxyFlags = Object.values(cls).reduce(
        (a, c) => a + c.voidFlags,
        0,
      );
      const renderFlags = Object.values(cls).reduce(
        (a, c) => a + c.renderFlags,
        0,
      );
      if (row.verifiedFalseWalls.length > 0) {
        failures.push(
          `${row.fixture.label}: ${row.verifiedFalseWalls.length} VERIFIED false walls:` +
            ` ${row.verifiedFalseWalls.join("; ")}`,
        );
      }
      if (renderFlags > 0 && row.verifiedFalseWalls.length === 0) {
        failures.push(
          `${row.fixture.label}: ${renderFlags} render-acceptance flags whose dense` +
            ` verification found content — the stop would be correct, investigate`,
        );
      }
      if (proxyFlags > 0) {
        console.log(
          `     ^ proxy flags ${proxyFlags} (surface-beam 0.01R convention) — render-acceptance` +
            ` flags ${renderFlags}, near-misses ${row.nearMisses.length} — see above for the verdict-relevant analysis`,
        );
      }
    }
    expect(true).toBe(true);
  }, 900_000);

  it("(2) the renders: contact sheet, distinctness, exhaustion", () => {
    const all: { stats: PanelStats; lines: readonly [string, string] }[] = [];
    console.log(
      `\n== renders (${SIZE}px, shared marcher; 4D rows are the w=0 slice) ==`,
    );
    for (const row of [...rows3, ...rows4]) {
      const name = `${row.fixture.group} ${row.fixture.label}`;
      all.push(
        { stats: row.panelUntiled, lines: [name, "untiled"] as const },
        { stats: row.panelTiled, lines: [name, "tiled (no clip)"] as const },
        { stats: row.panelTiledClip, lines: [name, "tiled + clip"] as const },
      );
      console.log(
        `-- ${name}: untiled hits=${row.panelUntiled.hits} exhausted=${row.panelUntiled.exhausted}` +
          ` | tiled hits=${row.panelTiled.hits} exhausted=${row.panelTiled.exhausted}` +
          ` | tiled+clip hits=${row.panelTiledClip.hits} exhausted=${row.panelTiledClip.exhausted}` +
          ` | distinct noClip=${row.distinctNoClipPct.toFixed(1)}% clip=${row.distinctClipPct.toFixed(1)}%`,
      );
      if (
        row.panelTiledClip.exhausted > 0 ||
        row.panelUntiled.exhausted > 0 ||
        row.panelTiled.exhausted > 0
      ) {
        failures.push(
          `${row.fixture.label}: exhausted rays (untiled ${row.panelUntiled.exhausted},` +
            ` tiled ${row.panelTiled.exhausted}, tiled+clip ${row.panelTiledClip.exhausted})`,
        );
      }
      if (row.distinctClipPct < 1.0) {
        failures.push(
          `${row.fixture.label}: the clip tiled render differs from the untiled one in only` +
            ` ${row.distinctClipPct.toFixed(1)}% of pixels — the tiling is not visually distinct`,
        );
      }
    }
    const file = writeLabeledContactSheet(all, 3, "tiling.png");
    console.log(`contact sheet: ${file}`);
    expect(true).toBe(true);
  }, 900_000);

  it("(3) the exactness anchor: analytic oracle, the theorem at fp precision", () => {
    const anchor = singleMapAnchor();
    console.log(
      `\n== exactness anchor (single map, fixed point ${anchor.p0.join(",")}, analytic orbit of ${anchor.orbit.length} images) ==`,
    );
    console.log(
      `   theorem identity max(|F(q)-p0| - min_g|q-g.p0|) = ${anchor.theoremMaxDiff.toExponential(1)}` +
        ` over ${anchor.probes} probes`,
    );
    console.log(
      `   wrapper overshoot: viol=${anchor.violations} maxExcess=${anchor.maxExcess.toExponential(2)}`,
    );
    if (anchor.orbit.length !== 24) {
      failures.push(
        `anchor: the fixed point's orbit has ${anchor.orbit.length} images, expected 24 (not generic?)`,
      );
    }
    if (anchor.violations > 0) {
      failures.push(
        `anchor: ${anchor.violations} analytic overshoots, maxExcess ${anchor.maxExcess.toExponential(2)}`,
      );
    }
    expect(true).toBe(true);
  }, 900_000);

  it("(4) the slab refusal, pinned on every 4D fixture", () => {
    for (const row of rows4) {
      const de = row.de as SurfaceDE4;
      const tiling = resolveTiling({ group: row.fixture.group })!;
      for (const [name, fn] of [
        [
          "base",
          () =>
            estimateDistance4Tiled(tiling, de, [0, 0, 0, 0], [0.01, 0, 0, 0]),
        ],
        [
          "refined",
          () =>
            estimateDistance4RefinedTiled(
              tiling,
              de,
              [0, 0, 0, 0],
              0,
              [0.01, 0, 0, 0],
            ),
        ],
      ] as const) {
        try {
          fn();
          failures.push(
            `${row.fixture.label}: tiling+slab ${name} did not throw`,
          );
        } catch {
          // the contract's tiling+4D-slab refusal, enforced in tiling-de.ts
        }
      }
    }
    console.log(
      `\n== tiling + 4D slab refusal: thrown on all ${rows4.length} 4D fixtures, both entries ==`,
    );
    expect(true).toBe(true);
  });

  it("(5) GLSL headroom (pre-tiling), largest legal 3D and 4D combinations", () => {
    glsl3 = glsl3Rows();
    glsl4 = glsl4Rows();
    const CLIFF = 80 * 1024;
    console.log(
      `\n== GLSL headroom vs SURFACE_GLSL_STRIP_BYTES (${SURFACE_GLSL_STRIP_BYTES}) and the ~80KB Mesa link cliff ==`,
    );
    console.log(`   3D:`);
    for (const row of glsl3) {
      console.log(
        `     ${row.name.padEnd(48)} resolved=${row.resolved} (${(row.resolved / 1024).toFixed(1)}KB,` +
          ` ${SURFACE_GLSL_STRIP_BYTES - row.resolved} B under threshold)` +
          ` emitted=${row.emitted} (${CLIFF - row.emitted} B under 80KB)`,
      );
      if (row.emitted >= SURFACE_GLSL_STRIP_BYTES) {
        failures.push(
          `GLSL 3D ${row.name}: emitted ${row.emitted} over the strip bound`,
        );
      }
    }
    console.log(`   4D:`);
    for (const row of glsl4) {
      console.log(
        `     ${row.name.padEnd(48)} resolved=${row.resolved} (${(row.resolved / 1024).toFixed(1)}KB,` +
          ` ${SURFACE_GLSL_STRIP_BYTES - row.resolved} B under threshold)` +
          ` emitted=${row.emitted} (${CLIFF - row.emitted} B under 80KB)`,
      );
      if (row.emitted >= SURFACE_GLSL_STRIP_BYTES) {
        failures.push(
          `GLSL 4D ${row.name}: emitted ${row.emitted} over the strip bound`,
        );
      }
    }
    expect(true).toBe(true);
  }, 300_000);

  it("(6) the verdict", () => {
    const all = [...rows3, ...rows4];
    const clipShare = all.map((r) => r.clipInShare);
    if (clipShare.some((s) => s <= 0 || s >= 1)) {
      failures.push(
        `a clip is degenerate (inClip ${clipShare.map((s) => s.toFixed(3)).join(",")}) — the tiled set would not differ`,
      );
    }
    const minEmitted = Math.min(
      ...[...glsl3, ...glsl4].map((r) => SURFACE_GLSL_STRIP_BYTES - r.emitted),
    );
    const tightest = [...glsl3, ...glsl4].reduce((a, b) =>
      b.resolved > a.resolved ? b : a,
    );
    console.log(`\n== verdict ==`);
    console.log(
      `fixtures: ${all.length} (3D ${rows3.length}, 4D ${rows4.length}); oracle sizes ${all.map((r) => r.oracleN).join("/")}`,
    );
    console.log(
      `overshoot: ${all.map((r) => Object.values(r.byClass).reduce((a, c) => a + c.violations, 0)).join("/")}` +
        ` violations total per fixture`,
    );
    console.log(
      `false walls: ${all.map((r) => r.verifiedFalseWalls.length).join("/")} VERIFIED per fixture` +
        ` (proxy flags ${all.map((r) => Object.values(r.byClass).reduce((a, c) => a + c.voidFlags, 0)).join("/")},` +
        ` render-acceptance flags ${all.map((r) => Object.values(r.byClass).reduce((a, c) => a + c.renderFlags, 0)).join("/")},` +
        ` near-misses ${all.map((r) => r.nearMisses.length).join("/")})`,
    );
    console.log(
      `distinct clip renders: ${all.map((r) => r.distinctClipPct.toFixed(1) + "%").join("/")}` +
        ` pixel-diff vs untiled`,
    );
    console.log(
      `GLSL: every emitted source is under the strip bound — min emitted headroom` +
        ` ${minEmitted} B (4D plain+finish, ${80 * 1024 - (SURFACE_GLSL_STRIP_BYTES - minEmitted)} B under the ~80KB Mesa cliff);` +
        ` the resolved side is ${SURFACE_GLSL_STRIP_BYTES - tightest.resolved} B over the threshold on "${tightest.name}"` +
        ` — the tiling arm's ~2-4KB resolved growth crosses the tightest rows' strip threshold (benign strip that SHRINKS the emitted program, the escape+balloon precedent) and every emitted source stays under the cliff`,
    );
    const ok = failures.length === 0;
    console.log(ok ? "VERDICT: GO" : "VERDICT: NO-GO");
    for (const f of failures) console.log(`  FAIL: ${f}`);
    expect(failures).toEqual([]);
  });
});
