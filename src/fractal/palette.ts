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
 *
 * **Custom palettes (fr-55k)**: alongside the built-in cosine gradients, a
 * user can author their own gradient as {@link MIN_CUSTOM_PALETTE_STOPS}–
 * {@link MAX_CUSTOM_PALETTE_STOPS} sRGB {@link RgbStop}s
 * ({@link CustomPalette}), evenly spaced across `t ∈ [0, 1]` and sampled
 * piecewise-linearly by {@link buildPaletteLUT}. {@link PaletteSelection} is
 * what the UI `<select>` and `AppState` hold — a preset {@link FlamePaletteId}
 * (including `"legacy"`), or the {@link CUSTOM_PALETTE_ID} sentinel, with the
 * actual stop data living elsewhere in app state (a bare string has nowhere
 * to carry a payload). {@link PaletteSpec} is what {@link buildPaletteLUT}
 * and, downstream, the render workers' GPU packing actually consume: a
 * preset id, or the {@link CustomPalette} payload itself — never the bare
 * `"custom"` string. {@link resolvePalette} bridges the two, and
 * {@link seedCustomStops} produces the starter gradient a fresh Custom
 * selection seeds itself with. `"custom"` is deliberately absent from
 * {@link FLAME_PALETTES} / {@link FLAME_PALETTE_IDS}: it has no coefficient
 * set, and keeping it out lets the persistence validator and `<select>`
 * option list (both built from that array) skip special-casing it — the app
 * layer owns the sentinel.
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
 * One color stop in a user-authored gradient (fr-55k): an sRGB triple with
 * each channel in `[0, 1]`, the same convention `color.ts` and the rest of
 * this module use. Distinct from {@link Triple}, which holds cosine
 * *coefficients*, not colors.
 */
export type RgbStop = readonly [number, number, number];

/**
 * A user-authored gradient palette (fr-55k):
 * {@link MIN_CUSTOM_PALETTE_STOPS}–{@link MAX_CUSTOM_PALETTE_STOPS}
 * {@link RgbStop}s, evenly spaced across `t ∈ [0, 1]` (stop `j` sits at
 * `t = j / (stops.length - 1)`) and sampled piecewise-linearly by
 * {@link buildPaletteLUT}. Stop-count bounds are enforced upstream (app
 * state / `persist.ts`); this module assumes at least two stops wherever it
 * consumes one.
 */
export interface CustomPalette {
  readonly stops: readonly RgbStop[];
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

/**
 * The sentinel {@link PaletteSelection} value meaning "use the custom
 * gradient" (fr-55k). Deliberately not a key of {@link FLAME_PALETTES} — see
 * the module doc.
 */
export const CUSTOM_PALETTE_ID = "custom";

/**
 * What the palette `<select>` / `AppState` hold: a built-in
 * {@link FlamePaletteId} (including `"legacy"`), or the
 * {@link CUSTOM_PALETTE_ID} sentinel. Never carries the custom gradient's
 * stop data itself — see {@link PaletteSpec} and {@link resolvePalette}.
 */
export type PaletteSelection = FlamePaletteId | typeof CUSTOM_PALETTE_ID;

/**
 * What {@link buildPaletteLUT} — and, downstream, the render workers' GPU
 * packing — actually consumes: a built-in {@link FlamePaletteId}, or a
 * self-contained {@link CustomPalette} payload. Never the bare `"custom"`
 * string; {@link resolvePalette} is what turns a {@link PaletteSelection}
 * into one of these.
 */
export type PaletteSpec = FlamePaletteId | CustomPalette;

/** Fewest stops a {@link CustomPalette} may have — a single color isn't a gradient. */
export const MIN_CUSTOM_PALETTE_STOPS = 2;

/** Most stops a {@link CustomPalette} may have, so the gradient editor UI stays usable. */
export const MAX_CUSTOM_PALETTE_STOPS = 8;

/** Stops {@link seedCustomStops} samples when a user first switches a palette to Custom. */
export const CUSTOM_PALETTE_SEED_STOPS = 5;

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
 * Byte-quantize a channel to the nearest of 256 values (`round(v * 255) /
 * 255`), so a sampled color survives the gradient editor's
 * `<input type="color">` (`#rrggbb`) round-trip exactly (fr-55k; see
 * {@link seedCustomStops}).
 */
function quantizeByte(v: number): number {
  return Math.round(v * 255) / 255;
}

/**
 * Render one {@link CosinePalette}'s gradient into a flat `256 * 3` LUT.
 * Factored out of {@link buildPaletteLUT} (fr-55k) so {@link seedCustomStops}
 * can build `"spectrum"`'s LUT directly — as a statically non-null
 * {@link CosinePalette}, not a {@link FlamePaletteId} lookup that could in
 * principle be `"legacy"` — when it needs a guaranteed-non-null fallback.
 */
function buildGradientLUT(palette: CosinePalette): Float32Array {
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

/**
 * Render a {@link CustomPalette}'s gradient into a flat `256 * 3` LUT,
 * sampling its stops piecewise-linearly (fr-55k). For entry `i`:
 * `t = i / 255` rescales onto the stop-index space as
 * `scaled = t * (stops.length - 1)`; `k = min(floor(scaled), stops.length -
 * 2)` picks the enclosing segment's lower stop (the `min` clamps the last
 * entry, where `scaled` exactly hits `stops.length - 1`, into the final
 * segment instead of reading one past the array); `f = scaled - k` is the
 * entry's position within that segment. Each channel is
 * `clamp01(from * (1 - f) + to * f)` — the TWO-PRODUCT lerp form
 * deliberately, not `from + (to - from) * f`: at `f = 1` the latter is not
 * bit-exact in IEEE754 for arbitrary endpoints (e.g. `0.9 + (0.05 - 0.9)`
 * misses `0.05` by an ulp), while `from * 0 + to * 1` IS exactly `to` — so
 * entry `0` and entry `255` land exactly on the first and last stop, and an
 * interior entry whose `f` computes to exactly `0`/`1` lands exactly on its
 * segment boundary's stop. Assumes at least two stops, per
 * {@link CustomPalette}'s contract.
 */
function buildCustomPaletteLUT(palette: CustomPalette): Float32Array {
  const { stops } = palette;
  const segments = stops.length - 1;
  const lut = new Float32Array(LUT_SIZE * 3);
  for (let i = 0; i < LUT_SIZE; i++) {
    const t = i / (LUT_SIZE - 1);
    const scaled = t * segments;
    const k = Math.min(Math.floor(scaled), stops.length - 2);
    const f = scaled - k;
    const from = stops[k];
    const to = stops[k + 1];
    const o = i * 3;
    const g = 1 - f;
    lut[o] = clamp01(from[0] * g + to[0] * f);
    lut[o + 1] = clamp01(from[1] * g + to[1] * f);
    lut[o + 2] = clamp01(from[2] * g + to[2] * f);
  }
  return lut;
}

/**
 * Precompute a palette's gradient into a flat `256 * 3` RGB lookup table
 * (interleaved, sRGB in `[0, 1]`): entry `i` is the palette colour at
 * `t = i / 255`. The flame hot loop indexes it per iteration by
 * `Math.min(255, (c * 256) | 0) * 3` (see `accumulateFlame`), turning a
 * per-sample `Math.cos` (or, for a custom gradient, a per-sample lerp) into a
 * single array read.
 *
 * Accepts a {@link PaletteSpec} (fr-55k). A built-in {@link FlamePaletteId}
 * behaves exactly as before this feature: `null` for the `"legacy"` id — it
 * has no coordinate gradient (see {@link FLAME_PALETTES}); the caller falls
 * back to the per-transform palette, keeping legacy renders byte-identical —
 * and a {@link buildGradientLUT cosine-gradient LUT} for every other preset.
 * A {@link CustomPalette} object instead builds its
 * {@link buildCustomPaletteLUT piecewise-linear gradient}. Existing callers
 * that only ever pass a {@link FlamePaletteId} see byte-identical behavior.
 */
export function buildPaletteLUT(palette: PaletteSpec): Float32Array | null {
  if (typeof palette !== "string") return buildCustomPaletteLUT(palette);
  const preset: CosinePalette | null = FLAME_PALETTES[palette];
  return preset === null ? null : buildGradientLUT(preset);
}

/**
 * Turn a {@link PaletteSelection} (what the UI `<select>` / `AppState` hold)
 * into a {@link PaletteSpec} (what {@link buildPaletteLUT} — and,
 * downstream, the render workers' GPU packing — consume) — fr-55k. A
 * built-in id, including `"legacy"`, passes through unchanged. For
 * {@link CUSTOM_PALETTE_ID}, returns `custom` when the caller has one;
 * otherwise falls back to a freshly {@link seedCustomStops seeded} gradient
 * rather than `null` or throwing, so this stays a total function. Callers
 * should never actually hit that fallback in practice — selecting Custom in
 * the UI always seeds a payload into `AppState` first — but it keeps e.g. a
 * hand-crafted or stale-decoded (`persist.ts`) state from producing a blank
 * render.
 */
export function resolvePalette(
  selection: PaletteSelection,
  custom: CustomPalette | undefined,
): PaletteSpec {
  if (selection !== CUSTOM_PALETTE_ID) return selection;
  return custom ?? { stops: seedCustomStops(CUSTOM_PALETTE_ID) };
}

/**
 * The starter stops shown when a user first switches a palette `<select>` to
 * Custom (fr-55k): a {@link CUSTOM_PALETTE_SEED_STOPS}-stop, tweakable copy
 * of the gradient they were just looking at, rather than an arbitrary
 * default. `from` resolves to a source id first — `"custom"` itself (e.g.
 * re-seeding) maps to `"spectrum"`, the same gradient fresh sessions default
 * to (see `state.ts`) — then that id's {@link buildPaletteLUT LUT} is
 * sampled at {@link CUSTOM_PALETTE_SEED_STOPS} evenly-spaced entries (stop
 * `j` reads LUT entry `round((j / (CUSTOM_PALETTE_SEED_STOPS - 1)) * 255)`).
 * `"legacy"` has no LUT ({@link buildPaletteLUT} returns `null`), so it falls
 * back to sampling `"spectrum"` too. Each channel is
 * {@link quantizeByte byte-quantized} so the seeded values survive the
 * gradient editor's `<input type="color">` (`#rrggbb`) round-trip exactly —
 * see {@link rgbToHex} / {@link hexToRgb}.
 */
export function seedCustomStops(from: PaletteSelection): RgbStop[] {
  const sourceId: FlamePaletteId =
    from === CUSTOM_PALETTE_ID ? "spectrum" : from;
  const lut =
    buildPaletteLUT(sourceId) ?? buildGradientLUT(FLAME_PALETTES.spectrum);
  const stops: RgbStop[] = [];
  for (let j = 0; j < CUSTOM_PALETTE_SEED_STOPS; j++) {
    const index = Math.round(
      (j / (CUSTOM_PALETTE_SEED_STOPS - 1)) * (LUT_SIZE - 1),
    );
    const o = index * 3;
    stops.push([
      quantizeByte(lut[o]),
      quantizeByte(lut[o + 1]),
      quantizeByte(lut[o + 2]),
    ]);
  }
  return stops;
}

/**
 * Encode an {@link RgbStop} as a lowercase `#rrggbb` string for the gradient
 * editor's `<input type="color">` (fr-55k). Each channel is clamped to
 * `[0, 1]` before quantizing, matching {@link buildCustomPaletteLUT}'s own
 * clamp, so a stop straying outside range (e.g. from a hand-edited URL hash)
 * still round-trips to a valid color instead of garbage hex digits. Inverse
 * of {@link hexToRgb}.
 */
export function rgbToHex(stop: RgbStop): string {
  const byte = (v: number) =>
    Math.round(clamp01(v) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${byte(stop[0])}${byte(stop[1])}${byte(stop[2])}`;
}

/**
 * Parse a `#rrggbb` string (as produced by an `<input type="color">`, or by
 * {@link rgbToHex}) into an {@link RgbStop} — fr-55k. Strict: only exactly
 * six hex digits (either case) after a leading `#` are accepted
 * (`/^#[0-9a-fA-F]{6}$/`); anything else — wrong length, `#rgb` shorthand, a
 * stray alpha channel, non-hex characters, a missing `#` — returns `null`
 * rather than guessing. Inverse of {@link rgbToHex}.
 */
export function hexToRgb(hex: string): RgbStop | null {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ];
}
