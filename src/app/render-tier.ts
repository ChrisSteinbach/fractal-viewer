/**
 * Interaction render-tier scheduler (fr-5ne3): decides, frame by frame,
 * whether the surface render should trace a cheap PREVIEW or the FULL-quality
 * image — cheap while the view is moving, pristine the moment it parks.
 *
 * The problem being solved: the surface mode re-traces the whole analytic DE
 * on every invalidation (orbit drag, 4D tumble/slice, lighting sliders), and
 * on heavy systems a single full-quality frame costs whole seconds — the
 * controls the mode promises are unusable. The adaptive-resolution governor
 * can't rescue it: its 0.5-scale floor is a 4x saving where the gap is 30x,
 * each step needs seconds of sustained misery, and render-on-demand starves
 * it of samples while idle, so a scale it stepped down to during a drag is
 * PARKED on the settled still — the exact opposite of what this mode wants.
 *
 * How: every frame with fresh content to paint (`invalidated`) renders the
 * preview tier immediately — never the full tier, so a drag's first tick can
 * never hitch on a multi-second trace. Once the invalidations stop, one
 * settle timer ({@link TIER_SETTLE_MS} from the LAST invalidation) fires a
 * single "full" verdict, and the scene repaints the parked view at full
 * quality. A lone click-invalidation (a color-source toggle) therefore shows
 * a soft frame that sharpens ~200ms later — the deliberate trade for a drag
 * that never freezes. Quiet frames in between return null: render-on-demand
 * stays honest, nothing is painted.
 *
 * Pure and clock-free like `resolution-governor.ts` and `morph-budget.ts`:
 * `now` arrives as a plain number measured by the caller, so tests drive the
 * scheduler with synthetic timestamps — no fake timers.
 */

/** Which quality the caller should paint this frame with. */
export type RenderTier = "preview" | "full";

/** Quiet time (ms) after the last invalidation before the one full-quality
 * settle frame fires. Short enough that a released drag sharpens on the
 * next beat, long enough that a slider drag's input events (which can gap
 * a few frames on a busy main thread) don't fire mid-gesture full traces. */
export const TIER_SETTLE_MS = 200;

export interface RenderTierScheduler {
  /**
   * Call once per painted-or-not frame with the frame's timestamp and
   * whether fresh content invalidated the view this frame. Returns the tier
   * to paint now, or null to paint nothing (parked, or waiting out the
   * settle delay).
   */
  frame(now: number, invalidated: boolean): RenderTier | null;
  /** Forget any pending settle — a fresh session must not inherit the
   * previous one's timer. */
  reset(): void;
}

/**
 * Preview-tier descent-depth clamp on the surface tracer's `uMaxDepth`
 * (fr-ttg5), sized relative to the system's OWN full-quality depth instead
 * of a fixed ceiling. `buildSurfaceDE`/`buildSurfaceDE4` size
 * `fullMaxDepth` so the SLOWEST contraction chain resolves features below
 * `DEPTH_RESOLUTION` (1e-4) — a formula logarithmic in that resolution,
 * `ceil(log(DEPTH_RESOLUTION) / log(sigma))`. Halving the level count
 * therefore resolves the same chain only to `sqrt(1e-4) = 1e-2` — coarser,
 * but still below the preview tier's own pixel coarseness (`uPixelEps * t`,
 * ~0.0125 at a typical hit distance under `SURFACE_PREVIEW_SCALE`'s
 * 0.3-scale target), so no unresolved core blob can outsize a preview
 * pixel on any depth-formula-sized system.
 *
 * A fixed clamp (the previous fr-5ne3 design, 12 levels) left slow-map
 * systems' unresolved core UNCHANGED whenever the full depth exceeded it —
 * for a sigma-0.93 chain that is `0.93^12 * R` = 0.42R, a giant smooth
 * ball, and permanently on screen under 4D auto-tumble (the rotor never
 * settles, so the view is never NOT moving). Scaling with the system's own
 * depth instead means fast-contracting systems (whose full depth was often
 * already under the old fixed 12) now get CHEAPER previews too. Systems
 * pinned at `MAX_DESCENT_DEPTH` (sigma above ~0.931, deeper than any
 * shipped preset needs) still show a coarse preview blob — the same
 * disclosure class as their full-tier render, not a regression.
 *
 * The `4`-level floor keeps the fastest-contracting systems from tracing
 * an unusably shallow preview.
 */
export function previewMaxDepth(fullMaxDepth: number): number {
  return Math.max(4, Math.ceil(fullMaxDepth / 2));
}

/**
 * Create a scheduler with no pending settle — the same state {@link
 * RenderTierScheduler.reset} returns to.
 */
export function createRenderTierScheduler(): RenderTierScheduler {
  let lastInvalidatedMs: number | null = null;

  return {
    frame(now: number, invalidated: boolean): RenderTier | null {
      if (invalidated) {
        lastInvalidatedMs = now;
        return "preview";
      }
      if (
        lastInvalidatedMs !== null &&
        now - lastInvalidatedMs >= TIER_SETTLE_MS
      ) {
        lastInvalidatedMs = null;
        return "full";
      }
      return null;
    },

    reset(): void {
      lastInvalidatedMs = null;
    },
  };
}
