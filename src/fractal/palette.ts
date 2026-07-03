/**
 * Smooth cosine gradient palettes for structural coloring (fr-6us), shared by
 * the flame renderer and the solid/voxel renderer (fr-1kt). Inigo Quilez's
 * cosine-gradient formula — one continuous curve per RGB channel:
 *
 *   channel(t) = clamp01(a + b * cos(2π (c * t + d)))
 *
 * — where `t` is the orbit's color coordinate in `[0, 1]` (see
 * `flame.ts`'s `accumulateFlame` and `voxel.ts`'s `accumulateVoxels`). A
 * single coefficient set `[a, b, c, d]` (each an `[r, g, b]` triple) defines a
 * whole palette: `a` is the channel's midpoint, `b` its amplitude, `c` how
 * many colour cycles span the gradient, and `d` the per-channel phase that
 * separates the three channels into a hue sweep. Because colour flows
 * continuously with `t`, blending `t` along the chaos-game orbit paints the
 * classic flame iridescence along the structure instead of the flat
 * per-transform hues (or per-`colorMode` regions, for the solid renderer) of
 * the `"legacy"` mode.
 *
 * Pure and dependency-free (like the rest of `src/fractal/`): no Three.js, no
 * DOM. The app layer builds a lookup table once per render
 * ({@link buildPaletteLUT}) and each renderer's hot loop indexes it per
 * iteration.
 */

/** A readonly RGB coefficient triple — one value per channel. */
type Triple = readonly [number, number, number];

/** One cosine-gradient palette's coefficients (see the module doc's formula). */
interface CosinePalette {
  readonly a: Triple;
  readonly b: Triple;
  readonly c: Triple;
  readonly d: Triple;
}

/**
 * Every selectable palette, in UI order. This is the SINGLE SOURCE OF
 * TRUTH for the {@link FlamePaletteId} union, the persistence validator
 * (`VALID_PALETTE_IDS` in `persist.ts`, shared by the flame and solid
 * blocks), and the `<select>` options in `index.html` (ui.test.ts pins the
 * options to {@link FLAME_PALETTE_IDS}), so adding a palette is one edit and
 * none of those can silently drift — the same discipline `VARIATION_TYPES` /
 * `COLOR_MODES` use in `types.ts`.
 *
 * `"legacy"` maps to `null`, not a coefficient set: it is the reserved
 * sentinel for the original per-transform-hue behavior (each histogram bucket
 * coloured by the producing transform's palette entry), which is NOT a
 * coordinate-driven gradient. {@link buildPaletteLUT} returns `null` for it so
 * the renderer takes its existing code path unchanged — see that function.
 */
export const FLAME_PALETTES = {
  legacy: null,
  spectrum: {
    a: [0.5, 0.5, 0.5],
    b: [0.5, 0.5, 0.5],
    c: [1, 1, 1],
    d: [0.0, 0.33, 0.67],
  },
  sunset: {
    a: [0.5, 0.5, 0.5],
    b: [0.5, 0.5, 0.5],
    c: [1, 1, 1],
    d: [0.0, 0.1, 0.2],
  },
  dusk: {
    a: [0.5, 0.5, 0.5],
    b: [0.5, 0.5, 0.5],
    c: [1, 1, 1],
    d: [0.3, 0.2, 0.2],
  },
  lagoon: {
    a: [0.5, 0.5, 0.5],
    b: [0.5, 0.5, 0.5],
    c: [1, 1, 0.5],
    d: [0.8, 0.9, 0.3],
  },
  ember: {
    a: [0.5, 0.5, 0.5],
    b: [0.5, 0.5, 0.5],
    c: [1, 0.7, 0.4],
    d: [0.0, 0.15, 0.2],
  },
  aurora: {
    a: [0.5, 0.5, 0.5],
    b: [0.5, 0.5, 0.5],
    c: [2, 1, 0],
    d: [0.5, 0.2, 0.25],
  },
  moss: {
    a: [0.8, 0.5, 0.4],
    b: [0.2, 0.4, 0.2],
    c: [2, 1, 1],
    d: [0.0, 0.25, 0.25],
  },
} as const satisfies Record<string, CosinePalette | null>;

/** A selectable flame palette id, including the `"legacy"` per-transform mode. */
export type FlamePaletteId = keyof typeof FLAME_PALETTES;

/**
 * All palette ids in UI order — the array form of {@link FLAME_PALETTES}'
 * keys, so `index.html`'s options and the persistence validator iterate the
 * one source of truth instead of a hand-maintained copy.
 */
export const FLAME_PALETTE_IDS = Object.keys(
  FLAME_PALETTES,
) as FlamePaletteId[];

/** Samples per channel in a {@link buildPaletteLUT} table (256 → indexable by a byte). */
const LUT_SIZE = 256;

/** Clamp to `[0, 1]` — the cosine curve can swing outside a channel's range. */
function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

const TWO_PI = Math.PI * 2;

function cosineChannel(
  a: number,
  b: number,
  c: number,
  d: number,
  t: number,
): number {
  return clamp01(a + b * Math.cos(TWO_PI * (c * t + d)));
}

/**
 * Precompute a palette's gradient into a flat `256 * 3` RGB lookup table
 * (interleaved, sRGB in `[0, 1]`): entry `i` is the palette colour at
 * `t = i / 255`. The flame hot loop indexes it per iteration by
 * `Math.min(255, (c * 256) | 0) * 3` (see `accumulateFlame`), turning a
 * per-sample `Math.cos` into a single array read.
 *
 * Returns `null` for the `"legacy"` id — it has no coordinate gradient (see
 * {@link FLAME_PALETTES}); the caller falls back to the per-transform palette,
 * keeping legacy renders byte-identical to before this feature.
 */
export function buildPaletteLUT(id: FlamePaletteId): Float32Array | null {
  const palette: CosinePalette | null = FLAME_PALETTES[id];
  if (palette === null) return null;
  const { a, b, c, d } = palette;
  const lut = new Float32Array(LUT_SIZE * 3);
  for (let i = 0; i < LUT_SIZE; i++) {
    const t = i / (LUT_SIZE - 1);
    const o = i * 3;
    lut[o] = cosineChannel(a[0], b[0], c[0], d[0], t);
    lut[o + 1] = cosineChannel(a[1], b[1], c[1], d[1], t);
    lut[o + 2] = cosineChannel(a[2], b[2], c[2], d[2], t);
  }
  return lut;
}
