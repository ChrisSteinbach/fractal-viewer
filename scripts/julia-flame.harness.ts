/**
 * fr-7u8t.1 follow-up: how good a JULIA-FAMILY FLAME can this app already
 * make, with no new variation, no new render mode and no core change?
 *
 * `juliaSet`/`juliaDust` are deliberately austere — ONE transform, weight 1,
 * no blend, `scale.z = 0` — because they exist to PROVE the Inverse
 * Iteration recipe (`docs/julia-sets.md`) and are pinned as such by
 * presets.test.ts. That is a demonstration, not an artwork, and it undersells
 * the reference class the epic was motivated by: Apophysis/flam3 flames built
 * on the `julia` family, BLENDED. This sheet decides whether the gap is the
 * app's or the preset's, by rendering candidates through the SHIPPED flame
 * pipeline (`accumulateFlame` -> `adaptiveDownsampleFlame` -> `tonemapFlame`,
 * at `state.ts`'s own defaults) beside two controls the answer has to beat:
 * the shipped `juliaSet` rendered as a flame, and the repo's existing flame
 * showcases (`radiolarian`, `swirlFlame`).
 *
 * Every candidate is written as a full transform literal so any panel that
 * earns it can be lifted verbatim. Only the `doc: "transforms"` ones are
 * `presets.ts` material, though: `PRESETS` maps a name to `() =>
 * Transform[]`, and `main.ts`'s `onPreset` calls `setTransforms` alone — so a
 * preset cannot carry the kaleidoscope (`SymmetryParams`) or the final-
 * transform lens, and loading one would render the base attractor with
 * whatever lens the session happened to have. Those candidates are still
 * built from shipped machinery — they are what a user authors in the panel —
 * but they ship as a scene document, or behind a side table in the
 * `PRESET_SCAFFOLDS`/`PRESET_RENDER_HINTS` idiom. The `doc` column says which
 * a candidate needs.
 *
 * WHAT THE SEARCH BEHIND THIS SHEET REJECTED (48 seeded random julia systems,
 * then four hand-directed rounds, all through this same renderer):
 *
 *   - `julia` over a NON-conformal or strongly contracting affine — the
 *     obvious "make it a flame" move — reliably renders a CLOUD. The variation
 *     expands inside `|z| < 0.5` and contracts outside it, so it smears any
 *     thin structure into a filled 2-D lump with a pretty fractal edge and a
 *     dead interior. Nearly every random roll landed here.
 *   - A kaleidoscope over ONE exact julia map fills its disc solid (and stays
 *     monochrome — one base map, one colour slot). Order over a TWO-map system
 *     is what makes a mandala rather than a plate.
 *   - A low-weight decorative affine beside an exact julia map (flam3's
 *     "symmetry xform" idiom, `colorSpeed: 0`) adds nothing a viewer reads.
 *
 * What survived is the two shapes the candidates below are built from: SEVERAL
 * EXACT IIM MAPS (which stay conformal, so the structure stays thin), and a
 * FINAL-TRANSFORM LENS (applied at plot time only, so it re-poses an
 * attractor without touching it).
 *
 * What the sheet CANNOT decide: it renders one fixed auto-frame per system
 * (`framing-bounds.ts`'s 0.5%-per-tail trim, orthographic rather than the
 * app's perspective camera), so composition-by-camera — the other half of a
 * flame artist's craft — is out of scope. Structure and colour are what these
 * panels compare.
 *
 * The console table carries what the pictures cannot: `ink%` (how much of the
 * frame the thing actually fills), `detail` (mean |gradient| of the
 * log-density — filigree or mush), `sat`, and `hue` (luminance-weighted
 * entropy of a 12-bin hue histogram, normalised to [0, 1] — a monochrome
 * sheet scores ~0, a flame that walks its whole palette approaches 1). Read
 * `detail` as "is the interior alive", never as "is it good": the austere
 * control scores 4.12 on it, because a bare curve on black has a steep
 * gradient everywhere it exists.
 *
 * The number that indicts the shipped preset is `hue`: 0.04, against 0.80
 * (`radiolarian`) and 0.94 (`swirlFlame`). A lone transform parks the flame's
 * colour coordinate at `derivedColorIndex(0, 1) = 0.5` FOREVER, so `juliaSet`
 * is physically incapable of colour variation whatever palette it is given.
 * One extra map is the entire fix, and candidate 1 is that fix and nothing
 * else (hue 0.28 — and it is still an exact Julia-set object).
 *
 * VERDICT (2026-08-14, from the sheet these numbers describe): the gap is the
 * PRESET's, not the app's. Candidates 2, 6, 7 and 8 hold their own against
 * both showcases, and 2 does it out of nothing but julia maps and a julia
 * lens. But panel 9 is why the sheet ends in an ablation rather than a
 * gallery: candidate 6 with `julia` swapped for `linear` keeps its ring
 * (detail 4.82 against 5.73, ink 83.3% against 59.8%) — the fold tightens the
 * weave and clears the fog, but `spherical` owns that shape. The panels whose
 * beauty is genuinely the Julia set's are 1-5 and 8.
 *
 * Run: npx vitest run --config scripts/vitest.harness.config.ts \
 *        scripts/julia-flame.harness.ts
 * Writes: `scripts/out/julia-flame.png`
 */
import { DARK_BACKDROP, hexToRgb01 } from "../src/app/constants";
import {
  WARMUP_ITERATIONS,
  plotPoint,
  prepareChaosGame,
  stepOrbit,
} from "../src/fractal/chaos-game";
import type { PreparedChaosGame } from "../src/fractal/chaos-game";
import {
  DEFAULT_GAMMA_THRESHOLD,
  accumulateFlame,
  adaptiveDownsampleFlame,
  tonemapFlame,
} from "../src/fractal/flame";
import type { Mat4 } from "../src/fractal/flame";
import { buildPaletteLUT } from "../src/fractal/palette";
import type { FlamePaletteId } from "../src/fractal/palette";
import { juliaSet, radiolarian, swirlFlame } from "../src/fractal/presets";
import { mulberry32 } from "../src/fractal/rng";
import type { Rng } from "../src/fractal/rng";
import type { SymmetryParams, Transform, Vec3 } from "../src/fractal/types";
import { encodePng } from "./de-preview";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Panel edge in pixels — the sheet is a grid of these. */
const PANEL = 420;
/** `state.ts`'s DEFAULT_FLAME_SUPERSAMPLE. */
const SUPERSAMPLE = 2;
/** Iterations per panel. `state.ts`'s DEFAULT_FLAME_ITERATIONS is 20M for a
 * full-window render; a 420px panel is ~1/12th that area, so this is a
 * comfortably CONVERGED frame, not a preview. */
const ITERATIONS = 24_000_000;
/** Seed for every panel's accumulation and framing probe — one seed, so a
 * rerun reproduces the sheet exactly. */
const SEED = 7;
/** Points drawn to auto-frame a system before rendering it. */
const FRAMING_SAMPLES = 40_000;
/** Trimmed off EACH tail before taking the framed extent — the same
 * 0.5%-per-tail quantile as `framing-bounds.ts`'s FRAMING_QUANTILE, for the
 * same reason (one nonlinear straggler must not blow the fit out). */
const FRAMING_TRIM = 0.005;
/** Slack around the trimmed box, so structure never touches the panel edge. */
const FRAMING_MARGIN = 1.06;

/** The tone-map every panel shares — `state.ts`'s flame defaults. Shared
 * shading is what lets the sheet carry a verdict about the SYSTEMS. */
const TONEMAP = {
  exposure: 1,
  gamma: 2.4,
  gammaThreshold: DEFAULT_GAMMA_THRESHOLD,
  vibrancy: 1,
};

/** `state.ts`'s density-estimator defaults (the finished-render filter). */
const ESTIMATOR = {
  estimatorRadius: 6,
  estimatorMinimumRadius: 0,
  estimatorCurve: 0.4,
};

const NO_SYMMETRY: SymmetryParams = { order: 1, plane: "xz" };

/** Douady's rabbit — `presets.ts`'s JULIA_SET_C, the constant `juliaSet`
 * renders (a transform's pre-affine translation is `-c`). */
const RABBIT: [number, number] = [-0.123, 0.745];
/**
 * A second connected constant, `-0.4 + 0.6i` — deep inside M's period-2
 * disc, whose Julia set is the classic many-whorled "spiral". Braided
 * against the rabbit's dendrites (candidates 1-4) the two structures read as
 * different families rather than two views of one, which is exactly what
 * makes the pair worth two transforms.
 *
 * Any c is reachable: a transform applies `V(Mv + t)`, so a julia map with a
 * UNIFORM scale + in-plane rotation before it is still an exact inverse
 * branch — of `λ(z² + c)` instead of `z² + c`, which is linearly conjugate
 * to some `z² + C`. Scale and rotation therefore only re-coordinate the
 * picture; the constant is the whole shape freedom, and the sheet spends it
 * on two constants rather than on affine noise.
 */
const SPIRAL_A: [number, number] = [-0.4, 0.6];

// --------------------------------------------------------------- geometry

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalize = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Screen basis for an ORTHOGRAPHIC view from `dir` (the direction from the
 * attractor toward the eye). Orthographic, not the app's perspective camera:
 * these systems are flat sheets or shallow shells, where the two agree to
 * within a framing choice, and an ortho matrix has `cw = 1` everywhere, so no
 * panel can silently lose points behind a near plane. */
function viewBasis(dir: Vec3): { right: Vec3; up: Vec3 } {
  const f = normalize(dir);
  const ref: Vec3 = Math.abs(f[1]) > 0.99 ? [0, 0, 1] : [0, 1, 0];
  const right = normalize(cross(ref, f));
  return { right, up: cross(f, right) };
}

/**
 * Row-major `projection * view` for {@link accumulateFlame}: an orthographic
 * camera whose screen axes are `right`/`up`, centred on `(cu, cv)` in that
 * plane and half as wide as `half`. Row 2 (clip Z) is never read by the
 * accumulator, and row 3 is the constant `w = 1` that puts every point in
 * front of the camera.
 */
function orthoProjection(
  right: Vec3,
  up: Vec3,
  cu: number,
  cv: number,
  half: number,
): Mat4 {
  const s = 1 / half;
  return [
    right[0] * s,
    right[1] * s,
    right[2] * s,
    -cu * s,
    up[0] * s,
    up[1] * s,
    up[2] * s,
    -cv * s,
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

/** Trimmed-quantile auto-frame: run the system's own plotted points through
 * the screen basis and take the box the middle 99% of them occupy. */
function autoFrame(
  prepared: PreparedChaosGame,
  right: Vec3,
  up: Vec3,
  rng: Rng,
): { cu: number; cv: number; half: number } {
  let x = rng() - 0.5;
  let y = rng() - 0.5;
  let z = rng() - 0.5;
  for (let i = 0; i < WARMUP_ITERATIONS; i++) {
    const s = stepOrbit(prepared, x, y, z, rng);
    x = s.x;
    y = s.y;
    z = s.z;
  }
  const us = new Float64Array(FRAMING_SAMPLES);
  const vs = new Float64Array(FRAMING_SAMPLES);
  for (let n = 0; n < FRAMING_SAMPLES; n++) {
    const s = stepOrbit(prepared, x, y, z, rng);
    x = s.x;
    y = s.y;
    z = s.z;
    const p = plotPoint(prepared, x, y, z, rng);
    us[n] = dot(p, right);
    vs[n] = dot(p, up);
  }
  us.sort();
  vs.sort();
  const lo = Math.floor(FRAMING_TRIM * (FRAMING_SAMPLES - 1));
  const hi = FRAMING_SAMPLES - 1 - lo;
  const cu = (us[lo] + us[hi]) / 2;
  const cv = (vs[lo] + vs[hi]) / 2;
  const half =
    (Math.max(us[hi] - us[lo], vs[hi] - vs[lo]) / 2) * FRAMING_MARGIN;
  return { cu, cv, half: half > 0 ? half : 1 };
}

// ------------------------------------------------------------ composition

interface Composition {
  /** Short key for the console table. */
  key: string;
  /** What it is, and why it might work. */
  note: string;
  /** `presets.ts`-liftable (transform list alone) or document state too. */
  doc: "transforms" | "+symmetry" | "+final" | "+symmetry+final";
  transforms: Transform[];
  final?: Transform;
  symmetry?: SymmetryParams;
  /** Chosen per composition — a flame's colour is half its impact. A
   * built-in id only: `state.ts`'s own default set, nothing hand-authored,
   * so every panel is a palette a user can pick from the `<select>`. */
  palette: FlamePaletteId;
  /** Eye direction; the default looks straight down `-z` at a flat sheet. */
  view?: Vec3;
  /** Panel-specific exposure, where a composition's density needs it. */
  exposure?: number;
  /** Widen the auto-frame by this factor — the app's camera, one number. */
  zoom?: number;
}

interface Panel {
  rgb: Uint8Array;
  /** Panel edge in pixels — what {@link writeSheet} tiles on. */
  size: number;
  /** Fraction of pixels the flame lit at all. */
  litPct: number;
  /** Fraction of pixels above a visible luminance (8/255). */
  inkPct: number;
  /** Luminance-weighted mean saturation over those pixels. */
  sat: number;
  /** Normalised luminance-weighted hue entropy over those pixels. */
  hue: number;
  /**
   * Mean absolute gradient of the normalised log-density over the occupied
   * cells, x100 — "filigree or mush". A cloud with a fractal boundary but a
   * smoothly filled interior (which is what a julia map plus a fat
   * contracting affine usually makes) scores low however pretty its outline;
   * a flame whose whole area is threaded with strands scores high. Measured
   * on DENSITY, not on the tone-mapped luminance, so it grades the system
   * rather than the palette — the luminance form scored a contrasty gradient
   * nearly twice a soft one on identical structure.
   */
  detail: number;
  ms: number;
}

/** Backdrop stops (`constants.ts`'s DARK_BACKDROP), screen-blended under the
 * flame exactly as `scene.ts` composites it: `flame + bg·(1 − flame)`. */
const BG_TOP = hexToRgb01(DARK_BACKDROP.top);
const BG_BOTTOM = hexToRgb01(DARK_BACKDROP.bottom);

/** Render one composition through the shipped flame pipeline. */
function renderComposition(
  c: Composition,
  panelSize = PANEL,
  iterations = ITERATIONS,
  supersample = SUPERSAMPLE,
): Panel {
  const started = Date.now();
  const prepared = prepareChaosGame(
    c.transforms,
    c.final ?? null,
    c.symmetry ?? NO_SYMMETRY,
  );
  const { right, up } = viewBasis(c.view ?? [0, 0, 1]);
  const { cu, cv, half } = autoFrame(prepared, right, up, mulberry32(SEED));
  const projection = orthoProjection(right, up, cu, cv, half * (c.zoom ?? 1));

  const lut = buildPaletteLUT(c.palette);
  const size = panelSize * supersample;
  // `palette` (the per-transform "legacy" colours) is never read on the LUT
  // path — see accumulateFlame's colorLUT branch — so an empty list is not a
  // silent fallback, it is the unreachable argument.
  const big = accumulateFlame(
    prepared,
    projection,
    size,
    size,
    iterations,
    mulberry32(SEED),
    [],
    undefined,
    lut ?? undefined,
  );
  const small = adaptiveDownsampleFlame(big, panelSize, panelSize, ESTIMATOR);
  const image = tonemapFlame(small, {
    ...TONEMAP,
    exposure: c.exposure ?? TONEMAP.exposure,
  });

  const rgb = new Uint8Array(panelSize * panelSize * 3);
  const hues = new Float64Array(12);
  let lit = 0;
  let ink = 0;
  let satSum = 0;
  let lumSum = 0;
  for (let py = 0; py < panelSize; py++) {
    const g = (py + 0.5) / panelSize;
    for (let px = 0; px < panelSize; px++) {
      const i = py * panelSize + px;
      const o = i * 4;
      const r = image[o] / 255;
      const gr = image[o + 1] / 255;
      const b = image[o + 2] / 255;
      if (image[o + 3] > 0) lit++;
      const lum = 0.2126 * r + 0.7152 * gr + 0.0722 * b;
      if (lum >= 8 / 255) {
        ink++;
        const mx = Math.max(r, gr, b);
        const mn = Math.min(r, gr, b);
        satSum += (mx > 0 ? (mx - mn) / mx : 0) * lum;
        lumSum += lum;
        // Hue in turns, binned to twelfths and weighted by luminance.
        const d = mx - mn;
        let h = 0;
        if (d > 0) {
          if (mx === r) h = ((gr - b) / d + 6) % 6;
          else if (mx === gr) h = (b - r) / d + 2;
          else h = (r - gr) / d + 4;
          h /= 6;
        }
        hues[Math.min(11, Math.floor(h * 12))] += lum;
      }
      // Screen blend over the backdrop gradient, as scene.ts composites it.
      const t = i * 3;
      for (let ch = 0; ch < 3; ch++) {
        const fg = image[o + ch] / 255;
        const bg = BG_TOP[ch] + (BG_BOTTOM[ch] - BG_TOP[ch]) * g;
        rgb[t + ch] = Math.round(255 * Math.min(1, fg + bg * (1 - fg)));
      }
    }
  }
  let entropy = 0;
  for (const w of hues) {
    if (w > 0 && lumSum > 0) {
      const p = w / lumSum;
      entropy -= p * Math.log(p);
    }
  }
  // Filigree-or-mush: mean |gradient| of the normalised log-DENSITY over the
  // occupied cells. Density, not the tone-mapped luminance, so the number
  // measures the system and not the palette — a contrasty gradient doubled
  // the luminance version's score on identical structure.
  const logMax = Math.log1p(small.maxHits);
  const dens = new Float32Array(panelSize * panelSize);
  if (logMax > 0) {
    for (let i = 0; i < dens.length; i++) {
      dens[i] = Math.log1p(small.hits[i]) / logMax;
    }
  }
  let gradSum = 0;
  let gradN = 0;
  for (let py = 0; py < panelSize - 1; py++) {
    for (let px = 0; px < panelSize - 1; px++) {
      const i = py * panelSize + px;
      if (dens[i] <= 0) continue;
      gradSum +=
        Math.abs(dens[i + 1] - dens[i]) +
        Math.abs(dens[i + panelSize] - dens[i]);
      gradN++;
    }
  }
  return {
    rgb,
    size: panelSize,
    litPct: (100 * lit) / (panelSize * panelSize),
    inkPct: (100 * ink) / (panelSize * panelSize),
    sat: lumSum > 0 ? satSum / lumSum : 0,
    hue: entropy / Math.log(12),
    detail: gradN > 0 ? (100 * gradSum) / gradN : 0,
    ms: Date.now() - started,
  };
}

/**
 * Tile panels into a contact sheet, one hairline gutter between them.
 * Deliberately not `de-preview.ts`'s `writeContactSheet`: that function's
 * currency is a `PanelStats` — a marched DE panel with hits/evals/steps — and
 * a flame panel has none of those quantities, so passing one would mean
 * inventing three fields to satisfy a type. The tiling itself is six lines.
 */
function writeSheet(panels: Panel[], cols: number, fileName: string): string {
  const edge = panels[0].size;
  const rows = Math.ceil(panels.length / cols);
  const gutter = 2;
  const sheetW = cols * edge + (cols - 1) * gutter;
  const sheetH = rows * edge + (rows - 1) * gutter;
  const sheet = new Uint8Array(sheetW * sheetH * 3);
  panels.forEach((panel, i) => {
    const x0 = (i % cols) * (edge + gutter);
    const y0 = Math.floor(i / cols) * (edge + gutter);
    for (let y = 0; y < edge; y++) {
      const src = y * edge * 3;
      sheet.set(
        panel.rgb.subarray(src, src + edge * 3),
        ((y0 + y) * sheetW + x0) * 3,
      );
    }
  });
  const outDir = join(dirname(fileURLToPath(import.meta.url)), "out");
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, fileName);
  writeFileSync(file, encodePng(sheetW, sheetH, sheet));
  return file;
}

// -------------------------------------------------------------- the sheet

/** The IIM branch map at `c`, as `presets.ts`'s `juliaIim` builds it: the
 * pre-affine translation is `-c` and `scale.z = 0` pins the sheet at z = 0. */
function juliaMap(
  id: number,
  c: [number, number],
  weight = 1,
  variations: Transform["variations"] = [{ type: "julia", weight: 1 }],
): Transform {
  return {
    id,
    position: [-c[0], -c[1], 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 0],
    weight,
    variations,
  };
}

const COMPOSITIONS: Composition[] = [
  // ---------------------------------------------------------- the controls
  {
    key: "CTL juliaSet",
    note: "the shipped preset, rendered as a flame (the floor)",
    doc: "transforms",
    transforms: juliaSet(),
    palette: "spectrum",
  },
  {
    key: "CTL radiolarian",
    note: "the repo's flame showcase (the bar)",
    doc: "transforms",
    transforms: radiolarian(),
    palette: "spectrum",
    view: [0.6, 0.45, 1],
  },
  {
    key: "CTL swirlFlame",
    note: "the other showcase — and candidate 8's own ablation",
    doc: "transforms",
    transforms: swirlFlame(),
    palette: "spectrum",
    view: [0.2, 0.15, 1],
  },
  // -------------------------------------------------------- the candidates
  {
    // TWO exact IIM maps at two constants. Each alone is a Julia set; both
    // together are the attractor of FOUR inverse branches, which is no
    // polynomial's Julia set — an island whose boundary carries the rabbit's
    // dendrites and the spiral's whorls at once. Two maps is also the
    // cheapest fix for the shipped preset's real defect: a lone transform
    // parks the colour coordinate at 0.5 forever, so `juliaSet` cannot be
    // anything but monochrome. Here colour tracks WHICH branch was taken
    // last, so the palette paints the structure's own history.
    key: "1 juliaIsland",
    note: "two exact IIM maps (rabbit + spiral) — the four-branch braid",
    doc: "transforms",
    transforms: [juliaMap(0, RABBIT), juliaMap(1, SPIRAL_A)],
    palette: "dusk",
  },
  {
    // The braid seen through a final `julia` LENS: the plot-time map halves
    // every angle and square-roots every radius, so the island folds into a
    // two-fold star and its dendritic boundary wraps the origin. The lens is
    // applied at plot only — it never feeds back — so the attractor stays
    // exactly candidate 1's and the fold costs no structure.
    key: "2 juliaSnowflake",
    note: "candidate 1 through a final julia lens — the fold, not a new set",
    doc: "+final",
    transforms: [juliaMap(0, RABBIT), juliaMap(1, SPIRAL_A)],
    final: {
      id: 0,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [0.9, 0.9, 0],
      variations: [{ type: "julia", weight: 1 }],
    },
    palette: "sunset",
  },
  {
    // The same braid through a final `spherical` lens (inversion through the
    // unit sphere): the island turns inside out into a ring, its boundary
    // dendrites now hanging inward off the rim.
    key: "3 juliaLace",
    note: "candidate 1 through a final spherical lens — everted to a ring",
    doc: "+final",
    transforms: [juliaMap(0, RABBIT), juliaMap(1, SPIRAL_A)],
    final: {
      id: 0,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 0],
      variations: [{ type: "spherical", weight: 1 }],
    },
    palette: "ember",
    // The inversion throws a wide, faint outer skirt, so the frame has to
    // pull back and the exposure has to come up to keep the rim legible.
    exposure: 1.6,
    zoom: 1.35,
  },
  {
    // And through a final `swirl` lens, which rotates each point by its own
    // squared radius: the island shears into blades. Three lenses over ONE
    // attractor (candidates 2-4) is the cheapest variety in this whole sheet
    // — the final transform is a single panel edit in the app.
    key: "4 juliaBlades",
    note: "candidate 1 through a final swirl lens",
    doc: "+final",
    transforms: [juliaMap(0, RABBIT), juliaMap(1, SPIRAL_A)],
    final: {
      id: 0,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 0],
      variations: [{ type: "swirl", weight: 1 }],
    },
    palette: "lagoon",
    zoom: 1.15,
  },
  {
    // The exact rabbit at FULL weight with a low-weight `spherical` map
    // beside it: the Julia set stays the dominant structure (it is picked 4
    // times out of 5) and the inversion hangs a halo of its own inverted
    // copies around it. The julia map is unambiguously the subject here —
    // contrast candidate 6, where it is not.
    key: "5 juliaHalo",
    note: "exact rabbit IIM (weight 1) + a weight-0.25 spherical halo",
    doc: "transforms",
    transforms: [
      juliaMap(0, RABBIT, 1),
      {
        id: 1,
        position: [0.25, -0.15, 0],
        rotation: [0, 0, 0.7],
        scale: [0.85, 0.85, 0],
        weight: 0.25,
        variations: [
          { type: "spherical", weight: 0.8 },
          { type: "linear", weight: 0.3 },
        ],
      },
    ],
    palette: "ember",
  },
  {
    // The flame-recipe inversion of candidate 5: a DOMINANT spherical map
    // with the julia fold applied rarely (weight 0.35), through a final julia
    // lens. The prettiest panel on the sheet — and the least julia-dependent:
    // panel 12 is this system with the julia map's variation swapped for
    // `linear` and nothing else changed.
    key: "6 juliaRing",
    note: "dominant spherical + rare julia fold + julia lens",
    doc: "+final",
    transforms: [
      juliaMap(0, RABBIT, 0.35),
      {
        id: 1,
        position: [0.25, -0.15, 0],
        rotation: [0, 0, 0.7],
        scale: [0.85, 0.85, 0],
        variations: [
          { type: "spherical", weight: 0.8 },
          { type: "linear", weight: 0.3 },
        ],
      },
    ],
    final: {
      id: 0,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [0.9, 0.9, 0],
      variations: [{ type: "julia", weight: 1 }],
    },
    palette: "ember",
  },
  {
    // Candidate 6's system without the lens, under a 5-fold kaleidoscope in
    // the sheet's own plane (`plane: "xy"` — the default `"xz"` would turn
    // the copies edge-on to a flat system and render a line). The rabbit's
    // dendrites, rotated five times, weave the star lattice in the core.
    key: "7 juliaMandala",
    note: "candidate 6's maps, no lens, 5-fold kaleidoscope in xy",
    doc: "+symmetry",
    transforms: [
      juliaMap(0, RABBIT, 0.35),
      {
        id: 1,
        position: [0.25, -0.15, 0],
        rotation: [0, 0, 0.7],
        scale: [0.85, 0.85, 0],
        variations: [
          { type: "spherical", weight: 0.8 },
          { type: "linear", weight: 0.3 },
        ],
      },
    ],
    symmetry: { order: 5, plane: "xy" },
    palette: "ember",
    zoom: 1.12,
  },
  {
    // `swirlFlame`'s own two maps, flattened to the plane, through a final
    // julia lens turned 1.1 rad. The lens doubles the spiral and pulls its
    // arms around the origin — the control in panel 3 is this system's
    // ablation, which is why they sit on the same sheet.
    key: "8 juliaPinwheel",
    note: "the swirl showcase's maps through a final julia lens",
    doc: "+final",
    transforms: [
      {
        id: 0,
        position: [0.36, 0.24, 0],
        rotation: [0, 0, 0.55],
        scale: [0.72, 0.72, 0],
        variations: [
          { type: "swirl", weight: 1 },
          { type: "linear", weight: 0.25 },
        ],
      },
      {
        id: 1,
        position: [-0.58, -0.34, 0],
        rotation: [0, 0, -1.5],
        scale: [0.5, 0.5, 0],
        variations: [
          { type: "swirl", weight: 1 },
          { type: "linear", weight: 0.25 },
        ],
      },
    ],
    final: {
      id: 0,
      position: [0, 0, 0],
      rotation: [0, 0, 1.1],
      scale: [0.8, 0.8, 0],
      variations: [{ type: "julia", weight: 1 }],
    },
    palette: "sunset",
    zoom: 1.12,
  },
  {
    // THE ABLATION, and the reason this sheet is not just a gallery:
    // candidate 6 with the julia map's variation swapped for `linear` — same
    // affine, same weights, same lens, same palette, same seed. What survives
    // is what `spherical` was doing on its own. (Measured: it keeps the ring
    // and loses the lobed core and most of the filament crossings — so the
    // julia fold earns its place there, but does not carry the panel.)
    key: "9 ABLATION of 6",
    note: "candidate 6 with julia -> linear: what spherical does alone",
    doc: "+final",
    transforms: [
      {
        id: 0,
        position: [-RABBIT[0], -RABBIT[1], 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 0],
        weight: 0.35,
        variations: [{ type: "linear", weight: 1 }],
      },
      {
        id: 1,
        position: [0.25, -0.15, 0],
        rotation: [0, 0, 0.7],
        scale: [0.85, 0.85, 0],
        variations: [
          { type: "spherical", weight: 0.8 },
          { type: "linear", weight: 0.3 },
        ],
      },
    ],
    final: {
      id: 0,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [0.9, 0.9, 0],
      variations: [{ type: "julia", weight: 1 }],
    },
    palette: "ember",
  },
];

describe("fr-7u8t.1 julia-family flame sheet", () => {
  it("renders the candidates beside the shipped preset and the bar", () => {
    const panels = COMPOSITIONS.map((c) => {
      const panel = renderComposition(c);
      console.log(
        `  ${c.key.padEnd(16)} ${c.doc.padEnd(11)} ${c.palette.padEnd(8)} ` +
          `ink ${panel.inkPct.toFixed(1).padStart(5)}%  ` +
          `detail ${panel.detail.toFixed(2).padStart(5)}  ` +
          `sat ${panel.sat.toFixed(2)}  hue ${panel.hue.toFixed(2)}  ` +
          `${(panel.ms / 1000).toFixed(0)}s  — ${c.note}`,
      );
      return panel;
    });
    console.log(`  wrote ${writeSheet(panels, 3, "julia-flame.png")}`);
    panels.forEach((p, i) => {
      expect(
        p.inkPct,
        `panel ${i} (${COMPOSITIONS[i].key}) rendered nothing`,
      ).toBeGreaterThan(0.1);
    });
  });
});
