/**
 * Forest composition sheet — does a landscape composed as ONE plain IFS
 * read as organic (a forest/meadow of ferns, a kelp seabed) or as mush at
 * real render quality?
 *
 * Construction under measurement: take a plant sub-IFS (the fern presets'
 * four Barnsley maps, or the kelp sub-IFS defined here) and ADD "scatter"
 * contractions whose only job is placement — each seats the WHOLE SCENE,
 * shrunk/rotated/leaned, back on the ground line (y = -1.5, the ferns' own
 * base; stem near x = -0.07; the shipped ferns occupy roughly
 * x in [-0.73, 0.74], y in [-1.5, 1.5], z ~ 0). The attractor satisfies
 * A = plant(A) ∪ scatter(A): every scattered copy contains the whole scene
 * again — recursive undergrowth, the aesthetic unknown. Weight ratios are
 * the density knob (share S = scatter weight over total weight).
 *
 * The sheets:
 *  - arrangement grid: five scatter arrangements x S in {.15, .30, .45}.
 *  - lean and view: lean-spread factor x FRONT/OBLIQUE.
 *  - plants: barnsley/curling/kelp alone and under GROVE3, GROVE-WIDE and
 *    ROW 0.80 (the oblique column measured as washout and was retired).
 *  - flame: the production histogram renderer over four landscapes,
 *    control vs authored scatter colorIndex at two color speeds.
 *  - infection dial: plain IFS (max cross-coupling — plant maps keep
 *    re-entering scattered copies) vs a hand-rolled Markov/chi-matrix
 *    stepper (tunable coupling) vs a hand-rolled post-word stage (zero
 *    cross-coupling, exact whole plants at the composed placements). The
 *    chi and post-word stages are simulations local to this sheet; they
 *    ship nothing.
 *  - 4d siblings: scatter maps carrying w-mixing rotations over the
 *    hyperfern, so each placed copy is a DIFFERENT 3D section of one 4D
 *    plant (control: the same 4D plant under plain 3D scatters), plus the
 *    W-ROW, whose one row map's w-rotation COMPOUNDS with recession.
 *  - surface probe: analyzeSurfaceSystem verdicts per landscape (the fern
 *    stem's x-scale is exactly 0 — singular — so the fern systems are
 *    expected ineligible with a reason naming it) plus a cost panel for
 *    every marchable system.
 *
 * The point panels use a SPLATTER local to this sheet — an orthographic
 * log-density projection of a chaos-game cloud — deliberately NOT a
 * marcher: de-preview's marcher stays the only marcher, and the surface
 * probe renders through it unchanged.
 *
 * VERDICT (2026-08-24): ORGANIC, NOT MUSH — at S 0.15-0.30 every
 * arrangement reads as a landscape; S 0.45 over-weights the deep copies
 * (the ROW's recession brightens into a spear, the grove smears toward
 * canopy haze). ROW 0.80 at S 0.30 is the strongest construction — an
 * infinite receding colonnade (xSpan 8.8, vs 6.0 at s 0.7, while s 0.9
 * compresses into a smeared hedge wedge) — and the flame arm is its best
 * renderer: the fern rows render red-to-green colonnades under moss and
 * the kelp ROW under lagoon is a golden crest rolling into teal depths
 * (-> the fernForest and kelpForest presets; curling beats barnsley on
 * lushness, barnsley on crispness). GROVE3 does NOT read as distinct
 * individuals at any spacing measured: each copy contains the whole scene
 * again, so placements render as a layered canopy/thicket mound —
 * GROVE-WIDE articulates three crown peaks but stays a thicket (-> the
 * fernThicket preset, points, and the mound is honest about what it is).
 * The kelp sub-IFS generalizes the construction; its first draft's
 * yaw-0.5-per-step climb coiled the stipe into a rosette — a per-step yaw
 * that large wraps the plant — and the shipped 0.12 climbs instead.
 * Scatter colorIndex recolors copies for FREE under a flame LUT: every
 * point of a copy took that scatter map as its LAST pick, so one blend
 * step tints the whole copy, and repeated scatter picks converge c toward
 * the slot — the ROW's recession becomes a depth gradient whose length is
 * colorSpeed (0.5 the long gradient, 0.9 saturating in about one copy).
 * CHI BLOCK REFUTED this sheet's own prediction: forbidding scatter->
 * plant makes the scatter class ABSORBING, so plotted words end in ever-
 * deeper scatter tails and the panel renders the scatter-only attractor
 * (a pancake dust, 3782 nonzero px vs the engine's 10965) — no chi matrix
 * yields the bounded-suffix words "exact whole plants" needs, because
 * returning to the plant block is exactly what re-couples it. The 1% leak
 * adds half-reconverged smears (mean plant dwell ~3 steps at S 0.3). The
 * post-word stage delivers precisely what chi cannot: K1 is three crisp
 * whole ferns at the placements, K2 the nine second-generation copies —
 * the zero-coupling end of the infection dial belongs to the scheduled-
 * hybrids construction. 4D: w-mixing rotations on scatter maps ARE
 * visible at the identity rotor, the fresh-load pose (w-grove vs control
 * meanAbsS 0.388 vs 0.320, orange-vs-blue panels), poses re-slice the
 * siblings, and the W-ROW is the best 4D picture of the sheet (meanAbsS
 * 0.612): near copies stay in-slice, deep copies roll up into +w, the
 * colonnade visibly vanishes into the fourth dimension (-> the
 * hyperfernForest preset). Surface: every fern landscape is INELIGIBLE —
 * Barnsley's stem has x-scale exactly 0 and the gate names it ("map 1 is
 * nearly flat (scale ≈ 0)") — so the fern presets are points/flame only,
 * honestly refused rather than slow. The kelp systems are DEGRADED-
 * eligible (anisotropy 4.0, stepScale 0.55) and march clean and cheap
 * (kelp grove 523ms at 128px, 0 exhausted), but the DE shell renders a
 * blobby union of climb-map images, nothing kelp-like — kelpForest ships
 * flame-hinted, not surface-hinted, by that picture.
 *
 * Run: npx vitest run --config scripts/vitest.harness.config.ts \
 *        scripts/forest-composition.harness.ts
 * Writes: scripts/out/forest-arrangement.png
 *         scripts/out/forest-lean.png
 *         scripts/out/forest-plants.png
 *         scripts/out/forest-flame.png
 *         scripts/out/forest-infection.png
 *         scripts/out/forest-4d.png
 *         scripts/out/forest-surface.png (only if a system is marchable)
 */
import { describe, expect, it } from "vitest";
import { applyAffine, composeAffine } from "../src/fractal/affine";
import type { Affine } from "../src/fractal/affine";
import { toTransform4 } from "../src/fractal/affine4";
import {
  ESCAPE_LIMIT,
  WARMUP_ITERATIONS,
  prepareChaosGame,
  runChaosGame,
} from "../src/fractal/chaos-game";
import { runChaosGame4 } from "../src/fractal/chaos-game-4d";
import type { ChaosGame4Result } from "../src/fractal/chaos-game-4d";
import {
  W_SIDE_PALETTES,
  transformColors,
  wRampColor,
} from "../src/fractal/color";
import {
  DEFAULT_GAMMA_THRESHOLD,
  accumulateFlame,
  tonemapFlame,
} from "../src/fractal/flame";
import type { Mat4 } from "../src/fractal/flame";
import { buildPaletteLUT } from "../src/fractal/palette";
import type { FlamePaletteId } from "../src/fractal/palette";
import { barnsleyFern, curlingFern, hyperfern } from "../src/fractal/presets";
import {
  SLICE_GHOST_FLOOR,
  composeRotorProjection4,
  sliceWeight,
} from "../src/fractal/project4";
import { mulberry32 } from "../src/fractal/rng";
import type { Rng } from "../src/fractal/rng";
import {
  analyzeSurfaceSystem,
  buildSurfaceDE,
  deHasFolds,
  estimateDistance,
  estimateDistanceRefined,
} from "../src/fractal/surface-de";
import type {
  Bounds,
  Transform,
  Transform4,
  Vec3,
  Vec4,
  WExtension,
} from "../src/fractal/types";
import {
  identityRotorPair,
  rotateInPlane,
  rotorMatrix,
  wSupport,
} from "../src/app/rotor4";
import type { RotorPair } from "../src/app/rotor4";
import {
  PREVIEW_BG_BOTTOM,
  PREVIEW_BG_TOP,
  renderPreview,
  writeContactSheet,
  writeLabeledContactSheet,
} from "./de-preview";
import type { PanelStats } from "./de-preview";

const SEED = 0xf03e57;
/** The plant's base — the ferns' own y = -1.5 ground line. */
const GROUND_Y = -1.5;
/** Every plant sub-IFS here is four maps; scatter maps follow. */
const PLANT_COUNT = 4;
const POINTS_3D = 1_200_000;
const POINTS_4D = 1_500_000;
const PANEL_SIZE = 288;
const FLAME_SIZE = 320;
const FLAME_ITERATIONS = 8_000_000;
const SURFACE_SIZE = 128;
const SHARES = [0.15, 0.3, 0.45] as const;

// ----------------------------------------------------- scatter placement

interface ScatterSpec {
  s: number;
  yaw?: number;
  leanX?: number;
  leanZ?: number;
  baseX: number;
  baseZ: number;
  baseY?: number;
  weight: number;
  colorIndex?: number;
  colorSpeed?: number;
  w?: WExtension;
}

/**
 * A placement map seating a copy of the WHOLE SCENE on the ground: rotation
 * [leanX, yaw, leanZ], uniform scale s, and a position chosen so the scene's
 * ground anchor (0, GROUND_Y, 0) lands exactly at (baseX, baseY, baseZ) —
 * computed through the engine's own composition (composeAffine + applyAffine)
 * so the seating can never drift from how the map is actually applied.
 */
function scatterTransform(id: number, spec: ScatterSpec): Transform {
  const rotation: Vec3 = [spec.leanX ?? 0, spec.yaw ?? 0, spec.leanZ ?? 0];
  const scale: Vec3 = [spec.s, spec.s, spec.s];
  const image = applyAffine(
    composeAffine({ id, position: [0, 0, 0], rotation, scale }),
    0,
    GROUND_Y,
    0,
  );
  const transform: Transform = {
    id,
    position: [
      spec.baseX - image[0],
      (spec.baseY ?? GROUND_Y) - image[1],
      spec.baseZ - image[2],
    ],
    rotation,
    scale,
    weight: spec.weight,
  };
  if (spec.colorIndex !== undefined) transform.colorIndex = spec.colorIndex;
  if (spec.colorSpeed !== undefined) transform.colorSpeed = spec.colorSpeed;
  if (spec.w) transform.w = spec.w;
  return transform;
}

/**
 * Plant maps verbatim with their weights; scatter maps with their weights
 * rescaled so the scatter total W_s satisfies W_s / (plantTotal + W_s) =
 * share (relative weights within the scatter group kept). Ids reassigned
 * densely 0..n-1, plant first.
 */
function composeLandscape(
  plant: Transform[],
  scatters: Transform[],
  share: number,
): Transform[] {
  const total = (list: Transform[]): number =>
    list.reduce((sum, t) => sum + (t.weight ?? 1), 0);
  const scale = (total(plant) * share) / (1 - share) / total(scatters);
  const out: Transform[] = [];
  for (const t of plant) out.push({ ...t, id: out.length });
  for (const t of scatters) {
    out.push({ ...t, weight: (t.weight ?? 1) * scale, id: out.length });
  }
  return out;
}

function landscape(
  plant: Transform[],
  specs: ScatterSpec[],
  share: number,
): Transform[] {
  return composeLandscape(
    plant,
    specs.map((spec, i) => scatterTransform(PLANT_COUNT + i, spec)),
    share,
  );
}

function scatterShare(system: Transform[], plantCount: number): number {
  const weight = (list: Transform[]): number =>
    list.reduce((sum, t) => sum + (t.weight ?? 1), 0);
  return weight(system.slice(plantCount)) / weight(system);
}

// ------------------------------------------------- concrete arrangements

const ROW_SPECS: Record<"0.70" | "0.80" | "0.90", ScatterSpec[]> = {
  "0.70": [{ s: 0.7, baseX: 1.55, baseZ: -0.55, weight: 1 }],
  "0.80": [{ s: 0.8, baseX: 1.62, baseZ: -0.62, weight: 1 }],
  "0.90": [{ s: 0.9, baseX: 1.7, baseZ: -0.7, weight: 1 }],
};

const GROVE3_SPECS: ScatterSpec[] = [
  { s: 0.58, yaw: 0.6, leanZ: 0.07, baseX: -1.85, baseZ: -0.55, weight: 1 },
  { s: 0.74, yaw: -1.1, leanZ: -0.05, baseX: 1.8, baseZ: -1.15, weight: 1 },
  { s: 0.64, yaw: 2.3, leanZ: 0.1, baseX: 0.35, baseZ: -2.1, weight: 1 },
];

const ROW_JITTER_SPECS: ScatterSpec[] = [
  { ...ROW_SPECS["0.80"][0], weight: 0.6 },
  { s: 0.55, yaw: 1.9, leanZ: -0.08, baseX: -1.7, baseZ: -0.8, weight: 0.2 },
  { s: 0.5, yaw: -2.4, leanZ: 0.06, baseX: 0.7, baseZ: -1.6, weight: 0.2 },
];

/** GROVE3 respaced: smaller copies, bases separated by more than a copy's
 * own width — measuring whether wider spacing trades the canopy mound for
 * distinguishable clumps (each copy is still a copy of the WHOLE scene, so
 * "clump", not "plant", is the best the plain IFS can do). */
const GROVE_WIDE_SPECS: ScatterSpec[] = [
  { s: 0.5, yaw: 0.6, leanZ: 0.07, baseX: -2.7, baseZ: -0.8, weight: 1 },
  { s: 0.62, yaw: -1.1, leanZ: -0.05, baseX: 2.6, baseZ: -1.5, weight: 1 },
  { s: 0.55, yaw: 2.3, leanZ: 0.1, baseX: 0.7, baseZ: -3.0, weight: 1 },
];

// ------------------------------------------------------------- the kelp

/** The kelp plant in its own "kelp coordinates" (height ~10, like Barnsley's
 * fern before buildFern's conjugation): a rank-thin stem, a dominant climb
 * map that spirals (yaw per step) and curves over (slight x/z lean per
 * step), and two blades hung off the stipe. Local fixture; ships nothing. */
const KELP_COORD_MAPS: Transform[] = [
  {
    id: 0,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [0.04, 0.16, 0.04],
    weight: 2,
  },
  {
    id: 1,
    position: [0, 0.85, 0],
    rotation: [0.05, 0.12, 0.1],
    scale: [0.8, 0.92, 0.8],
    weight: 78,
  },
  {
    id: 2,
    position: [0, 1.5, 0],
    rotation: [0.25, 0, 1.25],
    scale: [0.26, 0.3, 0.08],
    weight: 9,
  },
  {
    id: 3,
    position: [0, 0.8, 0],
    rotation: [-0.22, 0, -1.2],
    scale: [0.24, 0.28, 0.08],
    weight: 9,
  },
];

/**
 * Conjugate every kelp map by A(p) = 0.3·p + (0, GROUND_Y, 0) — the same
 * box the ferns land in (buildFern's own conjugation recipe): the linear
 * part M is untouched and position' = 0.3·t + c − M·c, with M·c read
 * through the engine's own composition (composeAffine on the map with its
 * position zeroed, then applyAffine at c).
 */
function kelpPlant(): Transform[] {
  const c: Vec3 = [0, GROUND_Y, 0];
  return KELP_COORD_MAPS.map((map): Transform => {
    const mc = applyAffine(
      composeAffine({ ...map, position: [0, 0, 0] }),
      c[0],
      c[1],
      c[2],
    );
    return {
      ...map,
      position: [
        0.3 * map.position[0] + c[0] - mc[0],
        0.3 * map.position[1] + c[1] - mc[1],
        0.3 * map.position[2] + c[2] - mc[2],
      ],
    };
  });
}

// ------------------------------------------------------- views + framing

const dot3 = (a: Vec3, b: Vec3): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const cross3 = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

function norm3(v: Vec3): Vec3 {
  const d = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / d, v[1] / d, v[2] / d];
}

/** flame-balloon.harness.ts's basis idiom: right = norm(cross(reference,
 * forward)), up = cross(forward, right). */
function viewBasis(direction: Vec3): { right: Vec3; up: Vec3; forward: Vec3 } {
  const forward = norm3(direction);
  const reference: Vec3 = Math.abs(forward[1]) > 0.99 ? [0, 0, 1] : [0, 1, 0];
  const right = norm3(cross3(reference, forward));
  return { right, up: cross3(forward, right), forward };
}

interface SplatView {
  name: string;
  right: Vec3;
  up: Vec3;
  /** Depth axis for dimming; dimming is off when absent or k = 0. */
  forward?: Vec3;
  depthDimK?: number;
}

const FRONT: SplatView = { name: "FRONT", right: [1, 0, 0], up: [0, 1, 0] };

const OBLIQUE: SplatView = (() => {
  const { right, up, forward } = viewBasis([0.55, 0.33, 1]);
  return { name: "OBLIQUE", right, up, forward, depthDimK: 0.35 };
})();

interface SplatFrame {
  centerU: number;
  centerV: number;
  half: number;
}

/** Frame a cloud from its projected bbox in `view`'s (right, up) basis. */
function frameCloud(
  positions: Float32Array,
  count: number,
  view: SplatView,
  margin: number,
): SplatFrame {
  let minU = Infinity;
  let minV = Infinity;
  let maxU = -Infinity;
  let maxV = -Infinity;
  for (let i = 0; i < count; i++) {
    const p: Vec3 = [
      positions[i * 3],
      positions[i * 3 + 1],
      positions[i * 3 + 2],
    ];
    const u = dot3(p, view.right);
    const v = dot3(p, view.up);
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  return {
    centerU: (minU + maxU) / 2,
    centerV: (minV + maxV) / 2,
    half: Math.max(maxU - minU, maxV - minV, Number.EPSILON) * 0.5 * margin,
  };
}

interface SplatResult {
  stats: PanelStats;
  nonzeroPx: number;
  maxHits: number;
  inFramePct: number;
}

/**
 * The point-cloud SPLATTER (not a marcher): orthographic projection onto a
 * (right, up) basis, per-pixel hit count + summed RGB from a per-point
 * color function, optional per-point alpha weighting the deposit, optional
 * depth dimming 1/(1 + k·(depth − minDepth)), then a log-density tonemap
 * b = ln(1+hits)/ln(1+maxHits), pixel = (sumRGB/hits)·b, gamma 1/1.6,
 * max-composited over de-preview's PREVIEW_BG vertical gradient so panels
 * read like the repo's other sheets. Image row 0 is the TOP — v flips so
 * the fern grows upward.
 */
function splatCloud(
  positions: Float32Array,
  count: number,
  view: SplatView,
  frame: SplatFrame,
  size: number,
  colorOf: (index: number) => Vec3,
  alphaOf?: (index: number) => number,
): SplatResult {
  const started = Date.now();
  const hits = new Float64Array(size * size);
  const sum = new Float64Array(size * size * 3);
  const { right, up, forward } = view;
  const k = view.depthDimK ?? 0;
  let minDepth = 0;
  if (forward && k > 0) {
    minDepth = Infinity;
    for (let i = 0; i < count; i++) {
      const d =
        positions[i * 3] * forward[0] +
        positions[i * 3 + 1] * forward[1] +
        positions[i * 3 + 2] * forward[2];
      if (d < minDepth) minDepth = d;
    }
  }
  const inv = 1 / (2 * frame.half);
  let inFrame = 0;
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    const u = x * right[0] + y * right[1] + z * right[2];
    const v = x * up[0] + y * up[1] + z * up[2];
    const fu = (u - frame.centerU) * inv + 0.5;
    const fv = (v - frame.centerV) * inv + 0.5;
    const px = Math.floor(fu * size);
    const py = Math.floor((1 - fv) * size); // row 0 is the TOP: flip v.
    if (px < 0 || px >= size || py < 0 || py >= size) continue;
    inFrame++;
    const alpha = alphaOf ? alphaOf(i) : 1;
    if (alpha <= 0) continue;
    let dim = 1;
    if (forward && k > 0) {
      const depth = x * forward[0] + y * forward[1] + z * forward[2];
      dim = 1 / (1 + k * (depth - minDepth));
    }
    const color = colorOf(i);
    const bucket = py * size + px;
    hits[bucket] += alpha;
    sum[bucket * 3] += color[0] * dim * alpha;
    sum[bucket * 3 + 1] += color[1] * dim * alpha;
    sum[bucket * 3 + 2] += color[2] * dim * alpha;
  }

  let maxHits = 0;
  let nonzeroPx = 0;
  for (let i = 0; i < hits.length; i++) {
    if (hits[i] > 0) {
      nonzeroPx++;
      if (hits[i] > maxHits) maxHits = hits[i];
    }
  }
  const rgb = new Uint8Array(size * size * 3);
  const logMax = Math.log1p(maxHits);
  for (let py = 0; py < size; py++) {
    const g = (py + 0.5) / size;
    const bgBytes = [0, 1, 2].map((ch) =>
      Math.round(
        255 *
          Math.pow(
            PREVIEW_BG_TOP[ch] +
              (PREVIEW_BG_BOTTOM[ch] - PREVIEW_BG_TOP[ch]) * g,
            1 / 2.2,
          ),
      ),
    );
    for (let px = 0; px < size; px++) {
      const i = py * size + px;
      const o = i * 3;
      for (let ch = 0; ch < 3; ch++) {
        let byte = bgBytes[ch];
        if (hits[i] > 0 && logMax > 0) {
          const b = Math.log1p(hits[i]) / logMax;
          const value = (sum[o + ch] / hits[i]) * b;
          const point = Math.round(
            255 * Math.pow(Math.min(1, Math.max(0, value)), 1 / 1.6),
          );
          if (point > byte) byte = point;
        }
        rgb[o + ch] = byte;
      }
    }
  }
  return {
    stats: {
      rgb,
      width: size,
      height: size,
      hits: inFrame,
      evals: 0,
      steps: 0,
      ms: Date.now() - started,
      exhausted: 0,
    },
    nonzeroPx,
    maxHits,
    inFramePct: (100 * inFrame) / count,
  };
}

/** flame-balloon.harness.ts's orthographic flame projection, verbatim. */
function orthoProjection(
  right: Vec3,
  up: Vec3,
  centerU: number,
  centerV: number,
  half: number,
): Mat4 {
  const s = 1 / half;
  return [
    right[0] * s,
    right[1] * s,
    right[2] * s,
    -centerU * s,
    up[0] * s,
    up[1] * s,
    up[2] * s,
    -centerV * s,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    1,
  ];
}

// --------------------------------------------------------- misc helpers

type LabeledPanel = { stats: PanelStats; lines: [string, string] };

const round4 = (_key: string, value: unknown): unknown =>
  typeof value === "number" ? Math.round(value * 1e4) / 1e4 : value;

function boundsFinite(bounds: Bounds): boolean {
  return [
    bounds.minX,
    bounds.maxX,
    bounds.minY,
    bounds.maxY,
    bounds.minZ,
    bounds.maxZ,
    bounds.minR,
    bounds.maxR,
  ].every(Number.isFinite);
}

function meanAbsDiff(a: Uint8Array, b: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

function flamePanel(
  image: Uint8ClampedArray,
  size: number,
  ms: number,
): PanelStats {
  // flame-balloon's rgb() idiom: strip alpha over black.
  const rgb = new Uint8Array(size * size * 3);
  for (let i = 0; i < size * size; i++) {
    rgb[i * 3] = image[i * 4];
    rgb[i * 3 + 1] = image[i * 4 + 1];
    rgb[i * 3 + 2] = image[i * 4 + 2];
  }
  return {
    rgb,
    width: size,
    height: size,
    hits: 0,
    evals: 0,
    steps: 0,
    ms,
    exhausted: 0,
  };
}

// ------------------------------------------- infection-dial simulations

/** chi[i][j] scales picking map j when the previous pick was map i: 1
 * everywhere except prev = scatter, next = plant, which gets
 * `scatterToPlant` ("once scattered, stay scattering" at 0). */
function chiMatrix(
  n: number,
  plantCount: number,
  scatterToPlant: number,
): number[][] {
  return Array.from({ length: n }, (_row, i) =>
    Array.from({ length: n }, (_col, j) =>
      i >= plantCount && j < plantCount ? scatterToPlant : 1,
    ),
  );
}

interface ChiRun {
  positions: Float32Array;
  indices: Uint8Array;
}

/**
 * Local Markov/xaos stepper: maintain the previous map index and pick the
 * next map j with probability proportional to weight_j · chi[prev][j],
 * applying the engine's OWN composed affines (prepareChaosGame folds shear
 * into `affines`; this sheet's fixtures are purely affine, so the
 * variation/lens paths never engage). Warmup and escape-reset mirror the
 * engine's (WARMUP_ITERATIONS unplotted; |coord| > ESCAPE_LIMIT or
 * non-finite reseeds). Simulation local to this sheet; ships nothing.
 */
function runChiGame(
  system: Transform[],
  chi: number[][],
  count: number,
  rng: Rng,
): ChiRun {
  const prepared = prepareChaosGame(system);
  const affines = prepared.affines;
  const n = prepared.transformCount;
  const weights = system.map((t) => t.weight ?? 1);
  const totalPlain = weights.reduce((sum, w) => sum + w, 0);
  const cumulative = new Float64Array(n);
  const pick = (prev: number): number => {
    let total = 0;
    for (let j = 0; j < n; j++) {
      total += weights[j] * chi[prev][j];
      cumulative[j] = total;
    }
    if (!(total > 0)) {
      // Dead chi row: fall back to the plain weighted pick.
      const r = rng() * totalPlain;
      let acc = 0;
      for (let j = 0; j < n; j++) {
        acc += weights[j];
        if (r < acc) return j;
      }
      return n - 1;
    }
    const r = rng() * total;
    for (let j = 0; j < n; j++) if (r < cumulative[j]) return j;
    return n - 1;
  };

  const positions = new Float32Array(count * 3);
  const indices = new Uint8Array(count);
  let x = rng() - 0.5;
  let y = rng() - 0.5;
  let z = rng() - 0.5;
  // The first pick has no history; map 0 is a plant row, unblocked in every
  // chi this sheet uses, so seeding prev there biases nothing.
  let prev = 0;
  const step = (): void => {
    const j = pick(prev);
    const p = applyAffine(affines[j], x, y, z);
    let nx = p[0];
    let ny = p[1];
    let nz = p[2];
    if (
      !Number.isFinite(nx) ||
      !Number.isFinite(ny) ||
      !Number.isFinite(nz) ||
      Math.abs(nx) > ESCAPE_LIMIT ||
      Math.abs(ny) > ESCAPE_LIMIT ||
      Math.abs(nz) > ESCAPE_LIMIT
    ) {
      nx = rng() - 0.5;
      ny = rng() - 0.5;
      nz = rng() - 0.5;
    }
    x = nx;
    y = ny;
    z = nz;
    prev = j;
  };
  for (let i = 0; i < WARMUP_ITERATIONS; i++) step();
  for (let i = 0; i < count; i++) {
    step();
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    indices[i] = prev;
  }
  return { positions, indices };
}

/** Post-word stage: k seeded equal-probability draws from the scatter
 * affines applied to every already-plotted plant point — zero
 * cross-coupling by construction, so the result is exact whole plants at
 * the (k-fold composed) scatter placements. */
function postWord(
  positions: Float32Array,
  count: number,
  affines: Affine[],
  k: number,
  rng: Rng,
): Float32Array {
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    let x = positions[i * 3];
    let y = positions[i * 3 + 1];
    let z = positions[i * 3 + 2];
    for (let d = 0; d < k; d++) {
      const p = applyAffine(
        affines[Math.floor(rng() * affines.length)],
        x,
        y,
        z,
      );
      x = p[0];
      y = p[1];
      z = p[2];
    }
    out[i * 3] = x;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = z;
  }
  return out;
}

// ------------------------------------------------------- 4D projection

interface ProjectedCloud4 {
  positions: Float32Array;
  s: Float32Array;
  meanAbsS: number;
}

/** Project a 4D cloud through a rotor pose exactly as the app does: the
 * composed 20-coefficient rotor projection (voxel-4d.ts's idiom) gives
 * (px, py, pz, sRaw); s = clamp(sRaw / wSupport(m, halfExtents), -1, 1). */
function projectCloud4(
  cloud: ChaosGame4Result,
  pair: RotorPair,
): ProjectedCloud4 {
  const m = rotorMatrix(pair);
  const proj = composeRotorProjection4(m, cloud.center);
  const halfExtents: Vec4 = [
    (cloud.bounds.maxX - cloud.bounds.minX) / 2,
    (cloud.bounds.maxY - cloud.bounds.minY) / 2,
    (cloud.bounds.maxZ - cloud.bounds.minZ) / 2,
    (cloud.bounds.maxW - cloud.bounds.minW) / 2,
  ];
  const invWAmp = 1 / Math.max(wSupport(m, halfExtents), 1e-9);
  const positions = new Float32Array(cloud.count * 3);
  const s = new Float32Array(cloud.count);
  let sumAbs = 0;
  for (let i = 0; i < cloud.count; i++) {
    const x = cloud.positions[i * 3];
    const y = cloud.positions[i * 3 + 1];
    const z = cloud.positions[i * 3 + 2];
    const w = cloud.w[i];
    positions[i * 3] =
      proj[0] * x + proj[1] * y + proj[2] * z + proj[3] * w + proj[4];
    positions[i * 3 + 1] =
      proj[5] * x + proj[6] * y + proj[7] * z + proj[8] * w + proj[9];
    positions[i * 3 + 2] =
      proj[10] * x + proj[11] * y + proj[12] * z + proj[13] * w + proj[14];
    const sRaw =
      proj[15] * x + proj[16] * y + proj[17] * z + proj[18] * w + proj[19];
    const sc = Math.max(-1, Math.min(1, sRaw * invWAmp));
    s[i] = sc;
    sumAbs += Math.abs(sc);
  }
  return { positions, s, meanAbsS: sumAbs / cloud.count };
}

// ---------------------------------------------------------------- sheets

describe("forest-composition sheet", () => {
  it("arrangement grid", () => {
    const arrangements: [string, ScatterSpec[]][] = [
      ["ROW 0.70", ROW_SPECS["0.70"]],
      ["ROW 0.80", ROW_SPECS["0.80"]],
      ["ROW 0.90", ROW_SPECS["0.90"]],
      ["GROVE3", GROVE3_SPECS],
      ["ROW-JITTER", ROW_JITTER_SPECS],
    ];
    const panels: LabeledPanel[] = [];
    const table: Record<string, string | number>[] = [];
    arrangements.forEach(([name, specs], row) => {
      const runs = SHARES.map((share, col) => {
        const system = landscape(barnsleyFern(), specs, share);
        expect(system.every((t, i) => t.id === i)).toBe(true);
        expect(new Set(system.map((t) => t.id)).size).toBe(system.length);
        expect(
          Math.abs(scatterShare(system, PLANT_COUNT) - share),
        ).toBeLessThan(1e-9);
        const cloud = runChaosGame(
          system,
          POINTS_3D,
          mulberry32(SEED ^ (0x100 + row * 3 + col)),
        );
        expect(boundsFinite(cloud.bounds)).toBe(true);
        return { share, system, cloud };
      });
      // Framing is per ROW, from that row's S = 0.30 cloud, shared across
      // its columns — comparability over tight fit.
      const frame = frameCloud(
        runs[1].cloud.positions,
        runs[1].cloud.count,
        FRONT,
        1.12,
      );
      for (const { share, system, cloud } of runs) {
        const palette = transformColors(system.length);
        const splat = splatCloud(
          cloud.positions,
          cloud.count,
          FRONT,
          frame,
          PANEL_SIZE,
          (i) => palette[cloud.transformIndices[i]],
        );
        let copies = 0;
        for (let i = 0; i < cloud.count; i++) {
          if (cloud.transformIndices[i] >= PLANT_COUNT) copies++;
        }
        const copyShare = copies / cloud.count;
        table.push({
          arrangement: name,
          S: share,
          measuredCopyShare: copyShare.toFixed(4),
          xSpan: (cloud.bounds.maxX - cloud.bounds.minX).toFixed(3),
          ySpan: (cloud.bounds.maxY - cloud.bounds.minY).toFixed(3),
          inFramePct: splat.inFramePct.toFixed(1),
        });
        panels.push({
          stats: splat.stats,
          lines: [
            name,
            `S ${share.toFixed(2)} COPY ${(copyShare * 100).toFixed(1)}%`,
          ],
        });
        if (share === 0.3 && (name === "GROVE3" || name === "ROW 0.80")) {
          // The preset-authoring handoff record.
          console.log(
            `[forest] barnsley ${name} S0.30 composed system: ` +
              JSON.stringify(system, round4),
          );
        }
      }
    });
    console.table(table);
    const path = writeLabeledContactSheet(
      panels,
      SHARES.length,
      "forest-arrangement.png",
    );
    console.info(`wrote ${path}`);
    expect(panels).toHaveLength(15);
  });

  it("lean and view", () => {
    const leanX = [0.05, -0.04, 0.06];
    const clouds = [0, 1, 2].map((f) => {
      const specs = GROVE3_SPECS.map((spec, j) => ({
        ...spec,
        leanZ: (spec.leanZ ?? 0) * f,
        leanX: f * leanX[j],
      }));
      const system = landscape(barnsleyFern(), specs, 0.3);
      return {
        f,
        system,
        cloud: runChaosGame(system, POINTS_3D, mulberry32(SEED ^ (0x200 + f))),
      };
    });
    // One shared frame from the f = 1 FRONT cloud; the oblique panels take
    // their own projected center but the same half.
    const ref = clouds[1].cloud;
    const frameF = frameCloud(ref.positions, ref.count, FRONT, 1.2);
    const frameO = {
      ...frameCloud(ref.positions, ref.count, OBLIQUE, 1.2),
      half: frameF.half,
    };
    const viewFrames: [SplatView, SplatFrame][] = [
      [FRONT, frameF],
      [OBLIQUE, frameO],
    ];
    const panels: LabeledPanel[] = [];
    const table: Record<string, string | number>[] = [];
    for (const { f, system, cloud } of clouds) {
      const palette = transformColors(system.length);
      for (const [view, frame] of viewFrames) {
        const splat = splatCloud(
          cloud.positions,
          cloud.count,
          view,
          frame,
          PANEL_SIZE,
          (i) => palette[cloud.transformIndices[i]],
        );
        table.push({
          f,
          view: view.name,
          inFramePct: splat.inFramePct.toFixed(1),
        });
        panels.push({
          stats: splat.stats,
          lines: [
            `LEAN F${f} ${view.name}`,
            `IN ${splat.inFramePct.toFixed(1)}%`,
          ],
        });
      }
    }
    console.table(table);
    const path = writeLabeledContactSheet(panels, 2, "forest-lean.png");
    console.info(`wrote ${path}`);
    expect(panels).toHaveLength(6);
  });

  it("plants", () => {
    const plants: [string, Transform[]][] = [
      ["BARNSLEY", barnsleyFern()],
      ["CURLING", curlingFern()],
      ["KELP", kelpPlant()],
    ];
    // Columns: the plant alone, then three arrangements, all FRONT (the
    // earlier oblique column measured as washout — depth dim mutes the
    // color and the mound reads as a smudge).
    const arrangements: [string, ScatterSpec[] | null][] = [
      ["ALONE", null],
      ["GROVE3", GROVE3_SPECS],
      ["GROVE-WIDE", GROVE_WIDE_SPECS],
      ["ROW 0.80", ROW_SPECS["0.80"]],
    ];
    const rows = plants.map(([name, plant], r) => {
      const runs = arrangements.map(([, specs], c) => {
        const system = specs ? landscape(plant, specs, 0.3) : plant;
        return {
          system,
          cloud: runChaosGame(
            system,
            POINTS_3D,
            mulberry32(SEED ^ (0x300 + r * 4 + c)),
          ),
        };
      });
      return { name, plant, runs };
    });
    // Frames are per COLUMN, computed from the barnsley row's cloud of that
    // column and shared down the column, so plant-vs-plant comparison stays
    // honest; the ALONE column borrows GROVE3's frame so relative size
    // reads against the composition it seeds.
    const frames = arrangements.map(([, specs], c) => {
      const ref = rows[0].runs[specs ? c : 1].cloud;
      return frameCloud(ref.positions, ref.count, FRONT, 1.15);
    });
    const panels: LabeledPanel[] = [];
    for (const { name, runs } of rows) {
      arrangements.forEach(([colName], c) => {
        const { system, cloud } = runs[c];
        const palette = transformColors(system.length);
        const splat = splatCloud(
          cloud.positions,
          cloud.count,
          FRONT,
          frames[c],
          PANEL_SIZE,
          (i) => palette[cloud.transformIndices[i]],
        );
        panels.push({ stats: splat.stats, lines: [name, colName] });
      });
    }
    const kelp = rows[2];
    console.log(
      `[forest] kelp GROVE3 S0.30 composed system: ` +
        JSON.stringify(kelp.runs[1].system, round4),
    );
    console.log(
      `[forest] barnsley GROVE-WIDE S0.30 composed system: ` +
        JSON.stringify(rows[0].runs[2].system, round4),
    );
    expect(boundsFinite(kelp.runs[0].cloud.bounds)).toBe(true);
    const ySpan =
      kelp.runs[0].cloud.bounds.maxY - kelp.runs[0].cloud.bounds.minY;
    expect(ySpan).toBeGreaterThanOrEqual(2);
    expect(ySpan).toBeLessThanOrEqual(4.5);
    const path = writeLabeledContactSheet(panels, 4, "forest-plants.png");
    console.info(`wrote ${path}`);
    expect(panels).toHaveLength(12);
  });

  it("flame", () => {
    interface FlameRow {
      name: string;
      plant: Transform[];
      specs: ScatterSpec[];
      colorIdx: number[];
      palette: FlamePaletteId;
    }
    const rows: FlameRow[] = [
      {
        name: "BARNSLEY ROW 0.80",
        plant: barnsleyFern(),
        specs: ROW_SPECS["0.80"],
        colorIdx: [0.8],
        palette: "moss",
      },
      {
        name: "CURLING ROW 0.80",
        plant: curlingFern(),
        specs: ROW_SPECS["0.80"],
        colorIdx: [0.8],
        palette: "moss",
      },
      {
        name: "CURLING GROVE3",
        plant: curlingFern(),
        specs: GROVE3_SPECS,
        colorIdx: [0.15, 0.5, 0.85],
        palette: "moss",
      },
      {
        name: "KELP ROW 0.80",
        plant: kelpPlant(),
        specs: ROW_SPECS["0.80"],
        colorIdx: [0.8],
        palette: "lagoon",
      },
    ];
    const decorate = (
      specs: ScatterSpec[],
      colorIdx: number[],
      colorSpeed: number,
    ): ScatterSpec[] =>
      specs.map((spec, i) => ({
        ...spec,
        colorIndex: colorIdx[i],
        colorSpeed,
      }));
    const cols: [string, (row: FlameRow) => Transform[]][] = [
      ["CONTROL", (row) => landscape(row.plant, row.specs, 0.3)],
      [
        "SCATTER CI CS 0.5",
        (row) =>
          landscape(row.plant, decorate(row.specs, row.colorIdx, 0.5), 0.3),
      ],
      [
        "SCATTER CI CS 0.9",
        (row) =>
          landscape(row.plant, decorate(row.specs, row.colorIdx, 0.9), 0.3),
      ],
    ];
    const panels: LabeledPanel[] = [];
    const table: Record<string, string | number>[] = [];
    rows.forEach((row, r) => {
      // Per-system frame from a probe cloud of the CONTROL system (the
      // color fields never move a point, so one frame serves all columns).
      const probe = runChaosGame(
        cols[0][1](row),
        300_000,
        mulberry32(SEED ^ (0x400 + r)),
      );
      const frame = frameCloud(probe.positions, probe.count, FRONT, 1.3);
      const projection = orthoProjection(
        FRONT.right,
        FRONT.up,
        frame.centerU,
        frame.centerV,
        frame.half,
      );
      const lut = buildPaletteLUT(row.palette);
      cols.forEach(([colName, build], c) => {
        const started = Date.now();
        const prepared = prepareChaosGame(build(row));
        const histogram = accumulateFlame(
          prepared,
          projection,
          FLAME_SIZE,
          FLAME_SIZE,
          FLAME_ITERATIONS,
          mulberry32(SEED ^ (0x410 + r * 3 + c)),
          [],
          undefined,
          lut ?? undefined,
        );
        const image = tonemapFlame(histogram, {
          exposure: 1,
          gamma: 2.4,
          gammaThreshold: DEFAULT_GAMMA_THRESHOLD,
          vibrancy: 1,
        });
        let nonzero = 0;
        for (let i = 0; i < histogram.hits.length; i++) {
          if (histogram.hits[i] > 0) nonzero++;
        }
        expect(histogram.maxHits).toBeGreaterThan(0);
        table.push({
          system: row.name,
          col: colName,
          nonzeroBucketsPct: (
            (100 * nonzero) /
            (FLAME_SIZE * FLAME_SIZE)
          ).toFixed(1),
          maxHits: histogram.maxHits,
        });
        panels.push({
          stats: flamePanel(image, FLAME_SIZE, Date.now() - started),
          lines: [row.name, colName],
        });
      });
    });
    console.table(table);
    const path = writeLabeledContactSheet(panels, 3, "forest-flame.png");
    console.info(`wrote ${path}`);
    expect(panels).toHaveLength(12);
  });

  it("infection dial", () => {
    const system = landscape(barnsleyFern(), GROVE3_SPECS, 0.3);
    const n = system.length;
    const palette = transformColors(n);
    const engine = runChaosGame(system, POINTS_3D, mulberry32(SEED ^ 0x500));
    const frame = frameCloud(engine.positions, engine.count, FRONT, 1.2);

    const all = runChiGame(
      system,
      chiMatrix(n, PLANT_COUNT, 1),
      POINTS_3D,
      mulberry32(SEED ^ 0x501),
    );
    const block = runChiGame(
      system,
      chiMatrix(n, PLANT_COUNT, 0),
      POINTS_3D,
      mulberry32(SEED ^ 0x502),
    );
    const leak = runChiGame(
      system,
      chiMatrix(n, PLANT_COUNT, 0.01),
      POINTS_3D,
      mulberry32(SEED ^ 0x503),
    );
    const plantCloud = runChaosGame(
      barnsleyFern(),
      POINTS_3D,
      mulberry32(SEED ^ 0x504),
    );
    const scatterAffines = system.slice(PLANT_COUNT).map(composeAffine);
    const post1 = postWord(
      plantCloud.positions,
      plantCloud.count,
      scatterAffines,
      1,
      mulberry32(SEED ^ 0x505),
    );
    const post2 = postWord(
      plantCloud.positions,
      plantCloud.count,
      scatterAffines,
      2,
      mulberry32(SEED ^ 0x506),
    );
    const plantColor = (i: number): Vec3 =>
      palette[plantCloud.transformIndices[i]];

    const modes: {
      mode: string;
      positions: Float32Array;
      count: number;
      colorOf: (i: number) => Vec3;
    }[] = [
      {
        mode: "ENGINE",
        positions: engine.positions,
        count: engine.count,
        colorOf: (i) => palette[engine.transformIndices[i]],
      },
      {
        mode: "CHI ALL-ONES",
        positions: all.positions,
        count: POINTS_3D,
        colorOf: (i) => palette[all.indices[i]],
      },
      {
        mode: "CHI BLOCK",
        positions: block.positions,
        count: POINTS_3D,
        colorOf: (i) => palette[block.indices[i]],
      },
      {
        mode: "CHI LEAK 0.01",
        positions: leak.positions,
        count: POINTS_3D,
        colorOf: (i) => palette[leak.indices[i]],
      },
      {
        mode: "POST-WORD K1",
        positions: post1,
        count: plantCloud.count,
        colorOf: plantColor,
      },
      {
        mode: "POST-WORD K2",
        positions: post2,
        count: plantCloud.count,
        colorOf: plantColor,
      },
    ];
    const panels: LabeledPanel[] = [];
    const table: Record<string, string | number>[] = [];
    const nonzero: number[] = [];
    for (const entry of modes) {
      const splat = splatCloud(
        entry.positions,
        entry.count,
        FRONT,
        frame,
        PANEL_SIZE,
        entry.colorOf,
      );
      nonzero.push(splat.nonzeroPx);
      table.push({
        mode: entry.mode,
        nonzeroPx: splat.nonzeroPx,
        inFramePct: splat.inFramePct.toFixed(1),
      });
      panels.push({
        stats: splat.stats,
        lines: [entry.mode, `PX ${splat.nonzeroPx}`],
      });
    }
    console.table(table);
    const path = writeLabeledContactSheet(panels, 3, "forest-infection.png");
    console.info(`wrote ${path}`);
    expect(panels).toHaveLength(6);
    // The all-ones chi stepper is statistically the engine — the sanity pin.
    expect(Math.abs(nonzero[1] - nonzero[0]) / nonzero[0]).toBeLessThanOrEqual(
      0.25,
    );
    expect(nonzero[4]).toBeGreaterThan(0);
  });

  it("4d siblings", () => {
    const wSpecs: ScatterSpec[] = [
      { ...GROVE3_SPECS[0], w: { rotation: { xw: 0.55 } } },
      { ...GROVE3_SPECS[1], w: { rotation: { zw: 0.75 } } },
      { ...GROVE3_SPECS[2], w: { rotation: { xw: -0.4, zw: 0.4 } } },
    ];
    const staggerSpecs: ScatterSpec[] = [
      { ...GROVE3_SPECS[0], w: { rotation: { xw: 0.55 }, position: 0.25 } },
      { ...GROVE3_SPECS[1], w: { rotation: { zw: 0.75 }, position: -0.3 } },
      {
        ...GROVE3_SPECS[2],
        w: { rotation: { xw: -0.4, zw: 0.4 }, position: 0.1 },
      },
    ];
    const lift = (specs: ScatterSpec[]): Transform4[] =>
      landscape(hyperfern(), specs, 0.3).map(toTransform4);
    const wCloud = runChaosGame4(
      lift(wSpecs),
      POINTS_4D,
      mulberry32(SEED ^ 0x600),
    );
    // Control: NO w blocks on the scatters — still 4D via hyperfern's frond.
    const controlCloud = runChaosGame4(
      lift(GROVE3_SPECS),
      POINTS_4D,
      mulberry32(SEED ^ 0x601),
    );
    const staggerCloud = runChaosGame4(
      lift(staggerSpecs),
      POINTS_4D,
      mulberry32(SEED ^ 0x602),
    );

    const poses: [string, RotorPair][] = [
      ["IDENTITY", identityRotorPair()],
      [
        "POSE A",
        rotateInPlane(rotateInPlane(identityRotorPair(), "xy", 0.6), "zw", 0.9),
      ],
      ["POSE B", rotateInPlane(identityRotorPair(), "xw", 1.2)],
    ];
    const side = W_SIDE_PALETTES.wBlueOrange;
    const wIdentity = projectCloud4(wCloud, poses[0][1]);
    const frame = frameCloud(wIdentity.positions, wCloud.count, FRONT, 1.25);

    const panels: LabeledPanel[] = [];
    const table: Record<string, string | number>[] = [];
    const identityRgb: Uint8Array[] = [];
    const rows: [string, ChaosGame4Result][] = [
      ["W-SCATTER", wCloud],
      ["CONTROL", controlCloud],
    ];
    for (const [rowName, cloud] of rows) {
      for (const [poseName, pair] of poses) {
        const proj =
          rowName === "W-SCATTER" && poseName === "IDENTITY"
            ? wIdentity
            : projectCloud4(cloud, pair);
        const splat = splatCloud(
          proj.positions,
          cloud.count,
          FRONT,
          frame,
          PANEL_SIZE,
          (i) => wRampColor(proj.s[i], side),
        );
        if (poseName === "IDENTITY") identityRgb.push(splat.stats.rgb);
        table.push({
          row: rowName,
          pose: poseName,
          inFramePct: splat.inFramePct.toFixed(1),
          meanAbsS: proj.meanAbsS.toFixed(3),
        });
        panels.push({
          stats: splat.stats,
          lines: [rowName, `${poseName} S ${proj.meanAbsS.toFixed(3)}`],
        });
      }
    }
    const staggerProj = projectCloud4(staggerCloud, identityRotorPair());
    const staggerSplat = splatCloud(
      staggerProj.positions,
      staggerCloud.count,
      FRONT,
      frame,
      PANEL_SIZE,
      (i) => wRampColor(staggerProj.s[i], side),
      (i) => sliceWeight(staggerProj.s[i], 0, 0.35, SLICE_GHOST_FLOOR),
    );
    table.push({
      row: "W-STAGGER SLICE",
      pose: "IDENTITY",
      inFramePct: staggerSplat.inFramePct.toFixed(1),
      meanAbsS: staggerProj.meanAbsS.toFixed(3),
    });
    panels.push({
      stats: staggerSplat.stats,
      lines: [
        "W-STAGGER SLICE",
        `IDENTITY S ${staggerProj.meanAbsS.toFixed(3)}`,
      ],
    });
    // W-ROW: the treeline whose ONE row map carries the w-rotation, so the
    // rotation COMPOUNDS with recession — copy k is turned k·0.35 rad into
    // w, a colonnade rotating progressively out of the visible 3-space.
    const rowCloud = runChaosGame4(
      lift([{ ...ROW_SPECS["0.80"][0], w: { rotation: { xw: 0.35 } } }]),
      POINTS_4D,
      mulberry32(SEED ^ 0x603),
    );
    const rowIdentity = projectCloud4(rowCloud, identityRotorPair());
    const rowFrame = frameCloud(
      rowIdentity.positions,
      rowCloud.count,
      FRONT,
      1.15,
    );
    for (const [poseName, pair] of [poses[0], poses[2]]) {
      const proj =
        poseName === "IDENTITY" ? rowIdentity : projectCloud4(rowCloud, pair);
      const splat = splatCloud(
        proj.positions,
        rowCloud.count,
        FRONT,
        rowFrame,
        PANEL_SIZE,
        (i) => wRampColor(proj.s[i], side),
      );
      table.push({
        row: "W-ROW 0.80",
        pose: poseName,
        inFramePct: splat.inFramePct.toFixed(1),
        meanAbsS: proj.meanAbsS.toFixed(3),
      });
      panels.push({
        stats: splat.stats,
        lines: ["W-ROW 0.80", `${poseName} S ${proj.meanAbsS.toFixed(3)}`],
      });
    }
    console.table(table);
    const path = writeLabeledContactSheet(panels, 3, "forest-4d.png");
    console.info(`wrote ${path}`);
    expect(panels).toHaveLength(9);
    // The w-rotations must be visible at the fresh-load rotor.
    expect(meanAbsDiff(identityRgb[0], identityRgb[1])).toBeGreaterThan(1);
  });

  it("surface probe", () => {
    const systems: [string, Transform[]][] = [
      ["barnsley GROVE3 S0.30", landscape(barnsleyFern(), GROVE3_SPECS, 0.3)],
      ["curling GROVE3 S0.30", landscape(curlingFern(), GROVE3_SPECS, 0.3)],
      ["kelp GROVE3 S0.30", landscape(kelpPlant(), GROVE3_SPECS, 0.3)],
      ["curlingFern alone", curlingFern()],
      ["kelp alone", kelpPlant()],
    ];
    const table: Record<string, string | number>[] = [];
    const costRows: Record<string, string | number>[] = [];
    const panels: PanelStats[] = [];
    for (const [name, transforms] of systems) {
      const analysis = analyzeSurfaceSystem(transforms);
      table.push({
        system: name,
        status: analysis.status,
        anisotropy: analysis.anisotropy.toFixed(3),
        stepScale: analysis.stepScale.toFixed(3),
        reasons: analysis.reasons.join("; ").slice(0, 80),
      });
      expect(["eligible", "degraded", "ineligible"]).toContain(analysis.status);
      if (analysis.status === "ineligible") continue;
      const de = buildSurfaceDE(transforms);
      // None of these carry folds, so this resolves to the refined arm.
      const estimate = deHasFolds(de)
        ? estimateDistance
        : estimateDistanceRefined;
      const stats = renderPreview(
        {
          de: (p: Vec3) => estimate(de, p),
          boundingRadius: de.visibleBoundingRadius * 1.05,
          target: de.boundCenter,
          stepScale: de.stepScale,
          eyeOffset: [1.55, 1.1, 1.8],
          collect: false,
          ao: false,
          shadow: false,
          fog: false,
        },
        SURFACE_SIZE,
      );
      costRows.push({
        system: name,
        ms: stats.ms,
        evals: stats.evals,
        steps: stats.steps,
        hits: stats.hits,
        exhausted: stats.exhausted,
      });
      panels.push(stats);
    }
    console.table(table);
    if (costRows.length > 0) console.table(costRows);
    if (panels.length > 0) {
      const path = writeContactSheet(
        panels,
        panels.length,
        "forest-surface.png",
      );
      console.info(`wrote ${path}`);
    }
    expect(table).toHaveLength(5);
  });
});
