import {
  deHasFolds,
  estimateDistance,
  estimateDistanceRefined,
} from "./surface-de";
import type { SurfaceDE } from "./surface-de";
import type { Vec3 } from "./types";

/**
 * Empty-space-skipping grid for the surface render (fr-55r5 part 2).
 *
 * {@link estimateDistanceRefined} is exact but not cheap: a beam of
 * inverse-map descents, up to `de.maxDepth` levels deep. Most of a
 * sphere-tracer's march happens in space nowhere near the attractor, where
 * a single cheap lower bound would let the marcher take one giant step
 * instead of running the full descent at every sample. This module
 * precomputes exactly that bound on a coarse cube grid, so a texture read
 * can replace a descent for any ray sample whose cell already carries a
 * safe floor — the CPU oracle a runtime GPU texture will consume verbatim,
 * the same oracle discipline `surface-de.ts` itself follows for
 * `surface-material.ts`.
 *
 * WHAT A BUILD COSTS is a fr-aj4w concern threaded through the module:
 * per-cell descent cost spans ~40x across systems (fold frontiers dwarf
 * the affine ladder), so floors are priced with a per-system estimator
 * ({@link surfaceGridEstimator}: plain for fold systems, refined for
 * affine) and the production worker sizes the whole build from a measured
 * pilot slab ({@link pickSurfaceGridResolution}) instead of trusting the
 * default resolution to be affordable.
 *
 * VALIDITY. Every cell `C` stores a lower bound on `dist(p, A)` good for
 * EVERY point `p` inside `C`, not just its center `c` — a marcher may step
 * by the stored value from anywhere in the cell without crossing the
 * surface. The chain: distance-to-a-set functions are 1-Lipschitz
 * (`|dist(p, A) - dist(c, A)| <= |p - c|`), the DE lower-bounds `dist(., A)`
 * everywhere (`surface-de.ts`'s own validity argument), and every point of
 * `C` sits within `cellRadius` (half the cell's space diagonal) of `c`. So
 * for every `p` in `C`:
 *
 *     dist(p, A) >= dist(c, A) - |p - c| >= DE(c) - cellRadius = stored
 *
 * Converting the f64 descent result into the Float32Array a GPU texture
 * holds must not lose that direction, hence {@link floorToF32}: the array
 * can only ever hold `stored_f32 <= stored_f64`, never the reverse.
 *
 * THE CUTOFF DOES DOUBLE DUTY. Each cell calls the estimator with `cutoff =
 * cellRadius`, not a full (`cutoff = 0`) descent. `estimateDistanceRefined`'s
 * contract (see its doc, fr-55r5) says a returned value `>= cutoff` equals
 * the full-descent result bit-for-bit, while a value `< cutoff` only
 * promises the full descent is ALSO `< cutoff` — the early exit may have
 * taken a shortcut through an unfolded branch, so a sub-cutoff value is not
 * a global bound. That is exactly the split {@link buildSurfaceGridSlab}
 * needs: `raw >= cellRadius` is safe to store (subtract `cellRadius`, floor
 * to f32); `raw < cellRadius` is not (store `0`, always a valid — if
 * useless — lower bound). The same cutoff that makes the low branch safe to
 * discard also lets the estimator exit early on exactly those near-surface
 * cells, which is where an uncapped descent would otherwise run deepest.
 *
 * SPHERE COVERAGE. The GLSL tracer (`src/app/surface-material.ts` ~line
 * 932) only ever marches inside the origin-centered sphere `radius =
 * uVisibleRadius * 1.02`, plus a sub-pixel-epsilon dither on the ray's start
 * distance — negligible against cell size at any shipped resolution. A cell
 * that cannot hold any point of that padded sphere can never receive a
 * marched sample, so its value is never read: {@link surfaceGridSpec}'s
 * `1.03` half-extent covers the `1.02` sphere with slack to spare, and
 * {@link buildSurfaceGridSlab} stores `0` for such cells without calling the
 * estimator at all — roughly half the cube's cells on a typical build,
 * halving build cost for free.
 *
 * THREE DIMENSIONS ONLY, and that is a REFUSAL rather than an unfinished
 * lift. A 4D session's rotor and w-slice are LIVE per-frame view state
 * (`surface-material-4d.ts`'s `setSurfaceView4`), so the sliced set a grid
 * would have to bound moves every frame and a build would be invalidated as
 * fast as it completed — where this module's whole premise is that ONE
 * build serves a whole session (`main.ts` requests exactly one per 3D
 * surface enter, against a frozen DE). So `buildSurfaceGrid` takes
 * `SurfaceDE` and there is deliberately no `surface-grid-4d.ts`.
 */

/** Default per-axis cell count: {@link buildSurfaceGrid}'s `resolution` when
 * a caller does not size it explicitly, at the low end of the bead's 64-128
 * range — an AFFINE worker build stays under ~2s on mid systems at
 * `64 ** 3` cells. Fold systems can cost 40x more per cell (fr-aj4w's
 * measured tables), which is why the production worker treats this as a
 * CEILING and downshifts through {@link pickSurfaceGridResolution} when a
 * measured pilot slab projects the full build over budget. Tests pass an
 * explicit smaller resolution so they never pay this cost. */
export const SURFACE_GRID_RESOLUTION = 64;

/** What a full grid build is allowed to cost, projected from the worker's
 * measured pilot slab ({@link pickSurfaceGridResolution}). Sized against
 * fr-aj4w's tables: every affine preset projects well under it at `64 ** 3`
 * (so the shipped resolution is untouched exactly where it was already
 * fine), the expensive fold systems (`mandelboxKifs` 38s, mandelbox pair
 * 13s at 64^3 plain on the dev machine) land at the ladder floor, and the
 * cheap fold pairs (0.3-1.2s) keep their full 64^3. The budget bounds the
 * one edge fr-aj4w called sharpest: offline timeline export awaits the
 * grid build (`main.ts`'s `surfaceGrid.settle()`), so build cost is a
 * render-keyframe STALL, not just background worker heat. */
export const SURFACE_GRID_BUDGET_MS = 3000;

/** The resolutions {@link pickSurfaceGridResolution} may downshift
 * through, descending. 32 is the floor: an 8x cost cut from 64 that still
 * carries the coarse void structure a fold march skips by (fr-aj4w's
 * tables show positive-floor fraction and median floor barely move across
 * 64/48/32) — below that, cells outgrow the voids between fold plates and
 * the grid stops paying for itself, so past the floor the answer is "build
 * the floor anyway", never "no grid". */
export const SURFACE_GRID_RESOLUTION_LADDER = [64, 48, 32];

/**
 * Pick the resolution a full build should run at, given a measured pilot:
 * the worker builds ONE mid z-layer of the `requested`-resolution grid
 * (the sphere's equator — the layer with the FEWEST sphere-skipped cells
 * and the nearest-surface descents, so per-layer it is the most expensive
 * one), times it, and projects the full build at each ladder rung as
 *
 *     projected(r) = pilotLayerMs * requested * (r / requested)^3
 *
 * (layers scale with `r`, cells-per-layer with `r^2`; per-cell cost is
 * treated as resolution-independent). The first rung `<= requested` whose
 * projection fits `budgetMs` wins; if none fits, the ladder floor is built
 * anyway (see {@link SURFACE_GRID_RESOLUTION_LADDER} — gridless marching
 * is correct but slower on exactly the expensive systems, so "over
 * budget" means "coarsest grid", not "no grid"). A `requested` at or below
 * the floor is returned unchanged: explicit small resolutions (tests, and
 * any future caller that already sized its build) are never second-guessed.
 *
 * Both approximations lean the same safe way. The equator pilot
 * over-states the mean layer, and per-cell cost measured mildly SUB-linear
 * in resolution (fr-aj4w's tables: `mandelboxKifs` visits/cell falls ~20%
 * from 64^3 to 32^3), so projections for coarser rungs are mild
 * OVER-estimates — the planner downshifts a shade too eagerly rather than
 * ever wedging the worker on a build it under-priced.
 */
export function pickSurfaceGridResolution(
  requested: number,
  pilotLayerMs: number,
  budgetMs: number = SURFACE_GRID_BUDGET_MS,
): number {
  let floor = requested;
  for (const r of SURFACE_GRID_RESOLUTION_LADDER) {
    if (r > requested) continue;
    const projected = pilotLayerMs * requested * (r / requested) ** 3;
    if (projected <= budgetMs) return r;
    floor = r;
  }
  return floor;
}

/** Sizing for a {@link SurfaceGrid}: a `resolution`-cube of cells over
 * `[-halfExtent, +halfExtent]^3`. Cell `(x, y, z)`'s center sits at
 * `-halfExtent + (i + 0.5) * cell` per axis, `cell = (2 * halfExtent) /
 * resolution`. Split out from {@link SurfaceGrid} so a caller can compute it
 * once ({@link surfaceGridSpec}) and hand the identical spec to every
 * {@link buildSurfaceGridSlab} call — every slab of one grid has to agree on
 * where its cells sit. */
export interface SurfaceGridSpec {
  /** Cells per axis. */
  resolution: number;
  /** Half the cube's side length. */
  halfExtent: number;
}

/** A built empty-space-skipping grid: {@link SurfaceGridSpec} plus the
 * cells themselves. `values[x + resolution * (y + resolution * z)]` is the
 * conservative distance floor for cell `(x, y, z)` — `0` where no positive
 * floor could be certified (near the attractor, or outside the traced
 * sphere), positive where a march may skip that far from any point in the
 * cell. Length `resolution ** 3`. */
export interface SurfaceGrid extends SurfaceGridSpec {
  values: Float32Array;
}

/**
 * Size the grid cube for `de`: `halfExtent = de.visibleBoundingRadius *
 * 1.03`. The GLSL tracer clamps every marched point to the sphere
 * `uVisibleRadius * 1.02` (`src/app/surface-material.ts` ~line 932) plus a
 * sub-epsilon dither on the ray's entry point, so `1.03` covers everything
 * the marcher can ever sample with slack left over — the pairing the module
 * doc calls out, kept as one multiplier here instead of re-derived at every
 * call site.
 */
export function surfaceGridSpec(
  de: SurfaceDE,
  resolution: number = SURFACE_GRID_RESOLUTION,
): SurfaceGridSpec {
  return { resolution, halfExtent: de.visibleBoundingRadius * 1.03 };
}

/** Scratch view pair {@link floorToF32} steps one float32 ulp down through —
 * a module-level singleton (not per-call) so the hot per-cell path never
 * allocates. Safe because the read happens synchronously, before the next
 * write. */
const F32_SCRATCH = new Float32Array(1);
const U32_SCRATCH = new Uint32Array(F32_SCRATCH.buffer);

/**
 * Largest float32 value `<= v`, for non-negative finite `v`. `Math.fround`
 * rounds to NEAREST (ties to even), which can round UP — and a grid cell
 * that stored a value above its true floor would let a march step through
 * the surface. When that happens, step down one ulp by decrementing the
 * float's bit pattern as an integer: positive float32 bit patterns are
 * monotone in value, so `bits - 1` is exactly the next representable value
 * below. (`v` is always `>= 0` at every call site in this module, and
 * `Math.fround(0) === 0` never takes the branch, so the bit trick's
 * positive-value precondition is never actually exercised at the zero
 * boundary.)
 */
export function floorToF32(v: number): number {
  const f = Math.fround(v);
  if (f <= v) return f;
  F32_SCRATCH[0] = f;
  U32_SCRATCH[0] -= 1;
  return F32_SCRATCH[0];
}

/** Reused across every cell of every slab so the hot loop never allocates —
 * {@link estimateDistanceRefined} only reads `p`, synchronously, so one
 * scratch triple mutated in place is as safe as a fresh array per call
 * (the same trick `surface-de.ts`'s own descent uses for its sector-sweep
 * scratch triples). */
const point: Vec3 = [0, 0, 0];

/**
 * Which {@link SurfaceDE} distance estimator {@link buildSurfaceGridSlab}
 * prices each cell's floor with. Validity only needs two properties, and
 * BOTH shipped estimators have them: (a) `dist(., A)` is lower-bounded
 * everywhere — the property this module's own validity argument builds the
 * whole floor chain on — and (b) the fr-55r5 `cutoff` early-out contract
 * holds (`surface-de.ts`'s doc directly above `estimateDistance` spells it
 * out: a returned value `>= cutoff` is the full-descent result
 * bit-for-bit, a value `< cutoff` only certifies the full result is ALSO
 * `< cutoff`). {@link buildSurfaceGridSlab} calls with `cutoff =
 * cellRadius` either way, so the same store-or-drop logic below is sound
 * under either estimator.
 *
 * `"refined"` ({@link estimateDistanceRefined}) is what ships today.
 * `"plain"` ({@link estimateDistance}) is weaker: refinement's extra
 * Hutchinson level only ever RAISES a certificate, never lowers one, so a
 * plain floor is never above the refined floor for the same cell — but it
 * is never unsound, only more conservative (more cells forced to `0`,
 * shorter marcher skips where a floor does survive).
 *
 * The default is {@link surfaceGridEstimator}'s per-system choice, decided
 * by fr-aj4w's measurements (`scripts/surface-grid-cost.harness.ts`):
 * `"plain"` for fold systems, `"refined"` for affine ones. The explicit
 * parameter remains so that harness can keep pricing BOTH estimators on
 * any system.
 */
export type SurfaceGridEstimator = "refined" | "plain";

/**
 * The estimator a production grid build should price `de`'s floors with —
 * {@link buildSurfaceGridSlab}/{@link buildSurfaceGrid}'s default when the
 * caller does not choose explicitly. Fold systems build `"plain"`, affine
 * systems `"refined"`, per fr-aj4w's measured verdict:
 *
 * - COST. On the shipped fold showcase (`mandelboxKifs`, 12 maps) the
 *   refined build runs ~1.5x the plain one in wall time AND inverse-map
 *   visits (56s vs 38s at 64^3 on the dev machine — a pegged worker core
 *   for the better part of a minute, several times that on mid hardware).
 *   On 2-map fold pairs the two estimators cost the same (refinement's
 *   lazy guard almost never fires extra sweeps), so plain never loses.
 * - QUALITY. Floor coverage and magnitude are measured near-identical
 *   (positive-floor fraction within ~0.6 points, median floor within
 *   ~0.7%R everywhere) — refinement's extra Hutchinson level tightens
 *   barely-escaped certificates near the surface, exactly the cells the
 *   `cellRadius` cutoff forces to `0` anyway.
 * - PARITY. The fold GLSL tracer marches the plain (`refine=false`)
 *   descent body (`descendFold`'s MIRROR NOTE), so plain floors are
 *   priced by the same family of bounds the marcher itself computes;
 *   refined floors could certify-away space the marcher's own estimator
 *   still resolves as near-surface.
 *
 * Affine systems keep `"refined"`: their refined build is cheap (~2x a
 * plain one that is itself well under budget — 0.27s vs 0.13s at 64^3 on
 * the dev machine's default preset), their GLSL march mirrors the REFINED
 * body, and fr-1z6p's ghost work showed refined bounds are what keep
 * affine voids honest.
 */
export function surfaceGridEstimator(de: SurfaceDE): SurfaceGridEstimator {
  return deHasFolds(de) ? "plain" : "refined";
}

/**
 * Fill the cells with z-index in `[z0, z1)` into `out` — the full-size
 * `resolution ** 3` array, so a caller (the grid-build worker) can split one
 * grid across many slabs, yielding or cancelling between them, without ever
 * allocating more than the one output array. {@link buildSurfaceGrid} calls
 * this once with `[0, resolution)`.
 *
 * Per cell, `cellRadius = (cell / 2) * Math.sqrt(3)` (hoisted above every
 * loop — it is the same for every cell at a given resolution) drives two
 * decisions:
 *
 * - Skip without spending a descent when the cell cannot hold any sampled
 *   point at all — `Math.hypot(cx, cy, cz) > de.visibleBoundingRadius *
 *   1.02 + cellRadius` (see the module doc's sphere-coverage paragraph).
 *   Stores `0`; correct because the value is never read, cheap because no
 *   estimator call happens.
 * - Otherwise call the `estimator`-selected function ({@link
 *   SurfaceGridEstimator}) at `([cx, cy, cz], cellRadius)` — resolved to a
 *   single function reference ONCE, above every loop, so the hot per-cell
 *   path never branches on it — and use the module doc's cutoff argument:
 *   `raw >= cellRadius` is a certified global lower bound, stored as
 *   `floorToF32(raw - cellRadius)`; `raw < cellRadius` only bounds a SUBSET
 *   of the descent's certificates, so it is not safe to keep — stored as
 *   `0`. These are exactly the near-surface cells where the marcher has to
 *   run the DE for real anyway, so losing the floor there costs nothing.
 */
export function buildSurfaceGridSlab(
  de: SurfaceDE,
  spec: SurfaceGridSpec,
  z0: number,
  z1: number,
  out: Float32Array,
  estimator: SurfaceGridEstimator = surfaceGridEstimator(de),
): void {
  const { resolution, halfExtent } = spec;
  const cell = (2 * halfExtent) / resolution;
  const cellRadius = (cell / 2) * Math.sqrt(3);
  const skipRadius = de.visibleBoundingRadius * 1.02 + cellRadius;
  const layer = resolution * resolution;
  const estimate =
    estimator === "plain" ? estimateDistance : estimateDistanceRefined;

  for (let z = z0; z < z1; z++) {
    const cz = -halfExtent + (z + 0.5) * cell;
    const zBase = z * layer;
    for (let y = 0; y < resolution; y++) {
      const cy = -halfExtent + (y + 0.5) * cell;
      const yBase = zBase + y * resolution;
      for (let x = 0; x < resolution; x++) {
        const cx = -halfExtent + (x + 0.5) * cell;
        const idx = yBase + x;
        if (Math.hypot(cx, cy, cz) > skipRadius) {
          out[idx] = 0;
          continue;
        }
        point[0] = cx;
        point[1] = cy;
        point[2] = cz;
        const raw = estimate(de, point, cellRadius);
        out[idx] = raw >= cellRadius ? floorToF32(raw - cellRadius) : 0;
      }
    }
  }
}

/**
 * Build a full {@link SurfaceGrid} for `de` in one pass: `{ ...spec,
 * values }` after a single {@link buildSurfaceGridSlab} call over the whole
 * cube. A caller that needs to yield or cancel mid-build (the production
 * worker) drives {@link buildSurfaceGridSlab} directly instead; this is the
 * convenience path tests and one-shot callers use. `estimator` passes
 * straight through to that slab call — see {@link SurfaceGridEstimator}.
 */
export function buildSurfaceGrid(
  de: SurfaceDE,
  resolution: number = SURFACE_GRID_RESOLUTION,
  estimator: SurfaceGridEstimator = surfaceGridEstimator(de),
): SurfaceGrid {
  const spec = surfaceGridSpec(de, resolution);
  const values = new Float32Array(resolution * resolution * resolution);
  buildSurfaceGridSlab(de, spec, 0, resolution, values, estimator);
  return { ...spec, values };
}
