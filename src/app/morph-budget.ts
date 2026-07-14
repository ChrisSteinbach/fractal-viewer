/**
 * The morph's adaptive point budget (fr-a5gu): how many points an in-flight
 * system morph's INTERMEDIATE generation requests should ask for, sized so
 * one generation fits in roughly one animation frame on THIS device.
 *
 * The problem being solved: a fixed `min(numPoints, MORPH_MAX_POINTS)` cap on
 * every morph intermediate doesn't fit every device — a 400k-point
 * generation costs ~35–190 ms depending on the system (measured mid-morph
 * across random pairs, desktop), so a fixed cap would update the cloud at
 * 5–15 Hz against a 60 Hz render loop and stutter visibly, worse on weaker
 * devices. The generator's latest-wins slot already keeps the morph
 * CORRECT when generation outruns the frame rate — this module is what makes
 * it SMOOTH, by asking for however many points this device can actually
 * deliver per frame.
 *
 * How: `note` every finished generation's measured latency (the cloud
 * generator times each request — see `cloud-generator.ts`), keep an
 * exponential moving average of the per-point cost, and size intermediate
 * requests to {@link MORPH_FRAME_BUDGET_MS}. Every generation feeds the
 * EMA — ordinary edits, boot, the morph's own intermediates — so by the time
 * a morph starts, the estimate is already warm and the FIRST intermediate is
 * sized right; the 3D/4D and per-system cost differences this blurs over are
 * exactly what the EMA keeps re-converging on while the morph streams its
 * own samples. The budget only APPLIES to morph intermediates: the terminal
 * sample — the real replaced request — always runs the full point count
 * (`main.ts`'s `cloudParams`).
 *
 * Pure and clock-free: measurements arrive as plain numbers, so tests drive
 * it directly — the same discipline as `exposure.ts` and `flame-perf.ts`.
 */
import { MORPH_MAX_POINTS } from "./constants";
import type { MorphDetail } from "./state";

/**
 * How many frames' worth of points a `"dense"` intermediate asks for (and
 * the multiplier on its ceiling): 8 ≈ 9 Hz shape updates against a 60 Hz
 * render loop — chunky enough to buy +3 stops of light, fine enough that a
 * multi-second morph still reads as motion. See state.ts's `MORPH_DETAILS`
 * for the full preference vocabulary this factor implements.
 */
export const MORPH_DENSE_FACTOR = 8;

/**
 * Target per-generation latency for a morph intermediate, in ms: just under
 * a 60 Hz frame, leaving headroom for the result's main-thread upload so a
 * converged morph updates once per animation frame.
 */
export const MORPH_FRAME_BUDGET_MS = 14;

/**
 * Floor for the adaptive budget: below this the morphing cloud reads as a
 * dust sketch rather than the attractor. A device too slow to generate this
 * many points per frame simply morphs at a lower update rate — the
 * latest-wins slot keeps that graceful.
 */
export const MORPH_MIN_POINTS = 20_000;

/**
 * The budget used before any measurement has landed. In practice the boot
 * generation calibrates the EMA before a morph can start, so this mostly
 * covers the pathological first-ever request; conservative enough not to
 * hitch a slow device on frame one.
 */
export const MORPH_UNCALIBRATED_POINTS = 100_000;

/** EMA weight of the newest sample: heavy enough to track a morph's
 * shifting per-system cost within a few frames, light enough that one GC
 * hitch doesn't crater the budget. */
const EMA_ALPHA = 0.3;

/**
 * Rolling per-point-cost estimator + budget calculator. `main.ts` notes
 * every delivered generation and reads {@link budget} when building a morph
 * intermediate's request.
 */
export class MorphBudget {
  /** EMA of measured cost per point, in ms, or null before any sample. */
  private costPerPointMs: number | null = null;

  /**
   * Record one finished generation: `elapsedMs` measured for a request of
   * `numPoints`. Non-finite or non-positive inputs are ignored — a degenerate
   * sample (empty system, a clock that went backwards) must not poison the
   * estimate.
   */
  note(elapsedMs: number, numPoints: number): void {
    if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return;
    if (!Number.isFinite(numPoints) || numPoints <= 0) return;
    const sample = elapsedMs / numPoints;
    this.costPerPointMs =
      this.costPerPointMs === null
        ? sample
        : this.costPerPointMs * (1 - EMA_ALPHA) + sample * EMA_ALPHA;
  }

  /**
   * Points to request for the next morph intermediate: the measured
   * {@link MORPH_FRAME_BUDGET_MS} worth of generation (×{@link
   * MORPH_DENSE_FACTOR} on budget and ceiling for `"dense"`), clamped to
   * [{@link MORPH_MIN_POINTS}, `MORPH_MAX_POINTS` × factor] — and never more
   * than `fullCount`, the scene's own point count (a small scene stays
   * exact). `"full"` skips the estimate entirely and returns `fullCount`.
   * The uncalibrated fallback is NOT scaled for `"dense"`: it exists to
   * avoid hitching an unmeasured device on frame one, and boot calibrates
   * the EMA before a morph can start anyway.
   */
  budget(fullCount: number, detail: MorphDetail): number {
    if (detail === "full") return fullCount;
    const factor = detail === "dense" ? MORPH_DENSE_FACTOR : 1;
    const target =
      this.costPerPointMs === null
        ? MORPH_UNCALIBRATED_POINTS
        : Math.min(
            MORPH_MAX_POINTS * factor,
            Math.max(
              MORPH_MIN_POINTS,
              Math.round(
                (MORPH_FRAME_BUDGET_MS * factor) / this.costPerPointMs,
              ),
            ),
          );
    return Math.min(fullCount, target);
  }
}
