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
