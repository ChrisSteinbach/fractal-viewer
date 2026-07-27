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
 * HOW EXPENSIVE the preview is, in turn, is not fixed: fr-5ne3 shipped one
 * scale for every device and system, and {@link createPreviewGovernor}
 * (fr-hith) replaces it with a measured ladder of (scale, depth) rungs —
 * see that factory for why a fixed scale is wrong in both directions at
 * once, and {@link previewMaxDepth} for why the two knobs must move
 * together.
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
 * Preview-tier resolution ladder (fr-hith), best rung first — the same
 * shape as `resolution-governor.ts`'s `RESOLUTION_SCALE_STEPS`, and read
 * the same way: index 0 is the most expensive rung, the last index is the
 * floor. Each entry is the fraction of the drawing buffer per side that
 * {@link PreviewGovernor} says the preview trace may cost right now.
 *
 * Rungs are spaced so every step roughly HALVES or DOUBLES the ray count
 * (cost goes as scale squared): 1.78x, 1.86x, 1.89x, 1.78x, 1.86x, 2.15x.
 * Even ratios matter more than round numbers here — a ladder with one
 * timid step wastes a whole sustain window making no measurable
 * difference, and the hysteresis band below is sized against the LARGEST
 * of these ratios.
 *
 * `0.3` is deliberately mid-ladder: it is the fixed scale fr-5ne3 shipped
 * (`SURFACE_PREVIEW_SCALE`) and {@link PREVIEW_START_SCALE} starts every
 * session there, so the shipped behavior is what an unmeasured device
 * gets and measurement only moves it. Above it lie the rungs a capable GPU
 * on a light system earns — the bead's headline: 4D auto-tumble, which
 * invalidates every frame and therefore NEVER reaches the settle tier, now
 * tumbles at up to full resolution instead of being pinned at 0.3 forever.
 * Below it lie the rungs a phone on a 24-map system needs; 0.15 is a
 * further 4x fewer rays than the old fixed floor, and the 0.1 / 0.07
 * emergency rungs (fr-du81) exist for the fold-frontier DEs (fr-5rvk),
 * whose per-pixel cost runs 10^2-10^4x an affine descent: on a mid GPU
 * the 0.15 rung still means minutes of strip-paced fill-in, and each
 * emergency step buys ~2x fewer rays AND a shallower depth clamp on top
 * ({@link previewMaxDepth} couples depth to scale), which is where the
 * real fold savings live. Light systems never reach them — the sustain
 * ladder only walks down under sustained over-budget measurements.
 */
export const PREVIEW_SCALE_RUNGS = [
  1, 0.75, 0.55, 0.4, 0.3, 0.22, 0.15, 0.1, 0.07,
] as const;

/** The rung every surface session starts on — fr-5ne3's shipped fixed
 * scale, and the anchor {@link previewMaxDepth}'s depth coupling is pinned
 * to. Starting mid-ladder (rather than optimistically at 1, or timidly at
 * the floor) means the first frames of a session cost exactly what they
 * cost today, and the ladder moves from measurements rather than guesses. */
export const PREVIEW_START_SCALE = 0.3;

/** Decades of feature size the full-quality depth resolves:
 * `-log10(DEPTH_RESOLUTION)` for `surface-de.ts`'s `DEPTH_RESOLUTION` of
 * `1e-4`. The depth formula is logarithmic in that resolution, so this is
 * the conversion factor between "depth fraction" and "resolved decades"
 * that {@link previewMaxDepth} inverts. */
const DEPTH_RESOLUTION_DECADES = 4;

/** Depth fraction at {@link PREVIEW_START_SCALE} — fr-ttg5's measured
 * anchor, kept EXACT (see {@link previewMaxDepth}). */
const ANCHOR_DEPTH_FRACTION = 0.5;

/**
 * Preview-tier descent-depth clamp on the surface tracer's `uMaxDepth`,
 * sized relative to the system's OWN full-quality depth (fr-ttg5) and to
 * the rung the preview is being traced at (fr-hith).
 *
 * Depth MUST couple to scale, or fr-ttg5's bug returns in adaptive form.
 * `buildSurfaceDE`/`buildSurfaceDE4` size `fullMaxDepth` so the SLOWEST
 * contraction chain resolves features below `DEPTH_RESOLUTION` (1e-4) —
 * `ceil(log(DEPTH_RESOLUTION) / log(sigma))` — so tracing only a FRACTION
 * `f` of those levels resolves that chain to `(1e-4)^f` instead. The
 * preview's own pixel coarseness (`uPixelEps * t`, ~0.0125 at a typical
 * hit distance) goes as `1 / scale`. Rendering MORE pixels while tracing
 * the same few levels would put the unresolved core blob back on screen at
 * a size the finer pixels can now see: the giant smooth ball fr-ttg5
 * removed.
 *
 * So the clamp is the larger of two closed forms, which cross EXACTLY at
 * the anchor rung:
 *
 * - **pixel-matched** — `f = 0.5 + log10(scale / 0.3) / 4`, the fraction
 *   that keeps the resolved feature size in the same ratio to the pixel
 *   size that fr-ttg5 measured at 0.3. It governs BELOW the anchor, where
 *   it is the floor that stops a cheap rung from blobbing. It is shallow
 *   in `scale` because resolution is EXPONENTIAL in depth: 3.3x finer
 *   pixels only buy `log10(3.3)/4 = 0.13` more depth fraction.
 * - **continuity** — a log-linear ramp from `0.5` at 0.3 to `1.0` at scale
 *   1. It governs ABOVE the anchor, where the pixel-matched form would
 *   stop at `0.63` and leave the top rung visibly shallower than the
 *   settle frame it is meant to be indistinguishable from. At scale 1 the
 *   preview then differs from the full tier only in march/shadow/AO budget
 *   — "near-full quality", with no depth pop when the settle frame lands.
 *
 * Both branches pass through `0.5` at 0.3 by construction (the `log10` of
 * `scale / PREVIEW_START_SCALE` is exactly 0 there), so the anchor is
 * exact from either side and `previewMaxDepth(full)` still reproduces
 * fr-ttg5's `max(4, ceil(full / 2))` bit for bit — not by a branch
 * condition, but because the two curves genuinely meet.
 *
 * Systems pinned at `MAX_DESCENT_DEPTH` (sigma above ~0.931, deeper than
 * any shipped preset needs) still show a coarse preview blob — the same
 * disclosure class as their full-tier render, not a regression. The
 * `4`-level floor keeps the fastest-contracting systems from tracing an
 * unusably shallow preview.
 */
export function previewMaxDepth(
  fullMaxDepth: number,
  previewScale: number = PREVIEW_START_SCALE,
): number {
  // Exactly 0 at the anchor rung, so both branches below meet at 0.5.
  const decades = Math.log10(previewScale / PREVIEW_START_SCALE);
  const pixelMatched =
    ANCHOR_DEPTH_FRACTION + decades / DEPTH_RESOLUTION_DECADES;
  const continuity =
    ANCHOR_DEPTH_FRACTION +
    ((1 - ANCHOR_DEPTH_FRACTION) * decades) /
      Math.log10(1 / PREVIEW_START_SCALE);
  const fraction = Math.min(1, Math.max(pixelMatched, continuity));
  return Math.max(
    4,
    Math.min(fullMaxDepth, Math.ceil(fraction * fullMaxDepth)),
  );
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

/** EMA smoothing factor for measured preview trace cost. Twice
 * `resolution-governor.ts`'s 0.1 on purpose: that governor is fed every
 * rendered frame at the display's rate, while preview traces are
 * event-driven and expensive, so samples arrive far more slowly here and a
 * 0.1 alpha would spend seconds of a drag still averaging in the previous
 * rung's cost. The sustain windows below, not the alpha, are what keep a
 * blip from moving the ladder. */
export const PREVIEW_EMA_ALPHA = 0.2;
/** Trace cost (ms) the ladder aims to hold preview frames under — a ~30fps
 * budget. Above this the EMA counts toward stepping DOWN. Interaction only
 * has to feel continuous, not smooth: 30fps of preview under the finger is
 * the trade fr-5ne3 already made, and buying it with resolution is what
 * this ladder is for. */
export const PREVIEW_TARGET_MS = 33;
/**
 * EMA below this (ms) counts toward stepping UP. The dead band it opens
 * with {@link PREVIEW_TARGET_MS} is wide (2.75x) BY CONSTRUCTION, not by
 * taste: one rung up multiplies the ray count by as much as 2.25x (see
 * {@link PREVIEW_SCALE_RUNGS}) and raises the depth clamp on top of that,
 * so a step-up threshold any closer to the budget would land the very next
 * frame back in step-down territory — the flap this band exists to
 * prevent. At 12ms the worst-case step-up lands near 27ms, still inside
 * budget with room for the extra descent levels.
 */
export const PREVIEW_UP_MS = 12;
/** Accumulated qualifying frame time (ms) required to step DOWN. Short —
 * well under `resolution-governor.ts`'s 1500 — because the stakes per
 * frame are far higher in this mode: a wrong rung here means seconds-long
 * frames under a moving finger, not a slightly soft image, and a drag may
 * only last a second or two in the first place. */
export const PREVIEW_DOWN_SUSTAIN_MS = 600;
/** Accumulated qualifying frame time (ms) required to step UP — over 4x
 * the way down, so a lull between drags can never ratchet the ladder into
 * a rung the device cannot actually hold. */
export const PREVIEW_UP_SUSTAIN_MS = 2500;
/** Frame time (ms) after any step during which the accruals stay frozen
 * (the EMA keeps tracking): the preview target is reallocated on a rung
 * change, and the EMA still holds the OLD rung's cost for several samples,
 * so acting again immediately would be acting on a stale measurement. */
export const PREVIEW_HOLDOFF_MS = 400;
/**
 * A single trace this expensive (ms) drops straight to the floor rung
 * without waiting for any EMA or sustain. The preview is one unbounded
 * draw by design — it has no strip planner bounding its submissions the
 * way the full tier does (fr-sjff) — so a frame this slow is not a data
 * point to average, it is the last warning before a close-up on a weak
 * iGPU hands the GPU watchdog a submission it will kill the context over.
 * Averaging costs several more frames at that size; the ladder cannot
 * afford them. Recovery back up the ladder is available and cheap, so the
 * false-positive cost is a few seconds of soft preview.
 */
export const PREVIEW_PANIC_MS = 250;
/**
 * Floor (ms) on how much a single sample may accrue toward a sustain
 * window. Sustain is measured in TIME rather than sample count for
 * `resolution-governor.ts`'s reason — samples arrive at the device's own
 * rate, so counting them makes the wait scale inversely with how much help
 * is needed — but that governor's samples are frame INTERVALS (never below
 * a vsync), while these are trace COSTS and can be a fraction of a
 * millisecond on a capable GPU. Without a floor, the fast device that most
 * deserves a step up would need thousands of samples to earn one. A
 * preview frame occupies at least one display refresh of the user's time
 * whatever the GPU spent, so a vsync is the honest lower bound. Only the
 * step-UP direction is affected; slow frames exceed it by construction.
 */
export const PREVIEW_MIN_ACCRUAL_MS = 16;

export interface PreviewGovernor {
  /** Current preview scale — a member of {@link PREVIEW_SCALE_RUNGS}. Pair
   * it with `previewMaxDepth(fullMaxDepth, scale)` for the rung's depth. */
  readonly scale: number;
  /**
   * Feed the MEASURED cost (ms) of one preview trace — the trace alone,
   * forced to completion, not a frame interval. Returns the new scale when
   * this sample tips a rung (already reflected in {@link scale}), else
   * null.
   */
  sample(traceMs: number): number | null;
  /**
   * Forget all timing state and return to the entry rung for a system
   * whose descent costs `costWeight` times the shipped anchor per pixel
   * (`surface-de.ts`'s `surfaceDescentCostWeight`; default 1 = the plain
   * {@link PREVIEW_START_SCALE} entry). The mid-ladder start bakes in the
   * assumption that a session's first frames cost what they cost at the
   * shipped fixed scale — fold-frontier systems (fr-5rvk) break it by
   * orders of magnitude, and the FIRST trace has no sample for the panic
   * path to act on, so the entry rung itself must absorb what is known
   * STATICALLY: enter at the highest rung whose area discount covers the
   * weight, or the floor once nothing can (scale buys at most
   * (0.3/0.15)² = 4x — beyond that the ladder starts at the floor and the
   * depth clamp, march budget and settle strips carry the rest).
   */
  reset(costWeight?: number): void;
}

/**
 * Adaptive preview-rung governor (fr-hith): turns measured preview trace
 * cost into the (scale, depth) pair this device can hold at ~30fps for
 * THIS system — `morph-budget.ts`'s "measure it, don't guess it" applied
 * to the one tier fr-5ne3 left fixed.
 *
 * The problem being solved: fr-5ne3's preview tier is a FIXED 0.3 scale,
 * chosen so the worst plausible system stays interactive on the worst
 * plausible device. Every other combination pays for that choice. A
 * capable GPU on a light system traces a 0.3-scale preview in a couple of
 * milliseconds and throws away 90% of its pixels for nothing — and it
 * never gets them back under 4D auto-tumble, which invalidates every frame
 * and so never reaches the settle tier at all: the whole session is
 * preview, permanently soft. Ease-out camera tweens on a very slow
 * renderer pin it the same way, advancing by sub-pixel amounts for a long
 * tail. Meanwhile a phone on a 24-map system finds 0.3 far too expensive
 * and has nowhere lower to go.
 *
 * The ladder is (scale, depth) PAIRS, not scale alone — see
 * {@link previewMaxDepth} for why they cannot move independently, and note
 * that the pair's depth is DERIVED rather than tabulated, so each rung
 * stays correct against whatever full depth the current system's own
 * contraction produced.
 *
 * Structure follows `resolution-governor.ts` closely — EMA, a dead band
 * between the two thresholds, sustain accruals in wall-clock time,
 * hold-off after each step — with three deliberate departures, each
 * forced by what a preview frame is:
 *
 * 1. The sample is the trace's OWN forced-to-completion cost, not a
 *    frame-to-frame delta. Preview frames are event-driven and bursty: a
 *    finger that pauses 150ms mid-drag would otherwise read as a 150ms
 *    frame and drag the ladder down over nothing. Cost is also the only
 *    signal the panic path can act on, since a delta cannot attribute a
 *    stall to the frame that caused it.
 * 2. {@link PREVIEW_PANIC_MS} short-circuits the whole EMA. There is no
 *    strip planner under the preview tier, so its worst case is a real
 *    watchdog risk rather than a slow frame.
 * 3. The first sample after a reset is WARM-UP: it seeds the EMA and
 *    steps nothing. A session's first preview trace carries shader
 *    compile and link, target allocation, and the first texture uploads —
 *    hundreds of milliseconds on hardware that will then render the same
 *    frame in five. Without this, entering surface mode on a perfectly
 *    capable GPU would panic straight to the floor every single time.
 *
 * Pure and clock-free like the modules it mirrors: cost arrives as a plain
 * number the caller measured, so tests drive the governor with synthetic
 * samples.
 */
export function createPreviewGovernor(): PreviewGovernor {
  const startIndex = PREVIEW_SCALE_RUNGS.indexOf(PREVIEW_START_SCALE);
  const floorIndex = PREVIEW_SCALE_RUNGS.length - 1;

  // Entry rung for a given static cost weight (see reset's doc): walk down
  // from the shipped anchor until the rung's area discount relative to it
  // covers the weight, saturating at the floor. Weight 1 (every fold-free
  // system) reproduces the anchor entry exactly.
  function entryIndexFor(costWeight: number): number {
    if (!Number.isFinite(costWeight) || costWeight <= 1) return startIndex;
    let i = startIndex;
    while (
      i < floorIndex &&
      (PREVIEW_SCALE_RUNGS[i] / PREVIEW_START_SCALE) ** 2 * costWeight > 1
    ) {
      i++;
    }
    return i;
  }

  let entryIndex = startIndex;
  let rungIndex = entryIndex;
  let ema: number | null = null;
  let downMs = 0;
  let upMs = 0;
  let holdoffMs = 0;

  // Commit a move to `nextIndex`: clear both accruals and arm the hold-off
  // so the frames right after — measured at the old rung's cost, on a
  // freshly reallocated target — cannot immediately tip another move.
  function stepTo(nextIndex: number): number | null {
    if (nextIndex === rungIndex) return null;
    rungIndex = nextIndex;
    downMs = 0;
    upMs = 0;
    holdoffMs = PREVIEW_HOLDOFF_MS;
    return PREVIEW_SCALE_RUNGS[rungIndex];
  }

  return {
    get scale(): number {
      return PREVIEW_SCALE_RUNGS[rungIndex];
    },

    sample(traceMs: number): number | null {
      // Invalid measurement: ignore completely, as if it never happened.
      if (!Number.isFinite(traceMs) || traceMs < 0) return null;

      // Warm-up (see the factory doc): seed the EMA, decide nothing.
      if (ema === null) {
        ema = traceMs;
        return null;
      }
      ema += PREVIEW_EMA_ALPHA * (traceMs - ema);

      // Panic outranks the hold-off and the EMA both: this frame alone is
      // the evidence, and one more like it is the one that wedges.
      if (traceMs >= PREVIEW_PANIC_MS) {
        return stepTo(floorIndex);
      }

      // Still settling from the last step: the EMA keeps tracking, but the
      // sustain accruals stay frozen at 0 until the hold-off elapses.
      if (holdoffMs > 0) {
        holdoffMs -= Math.max(traceMs, PREVIEW_MIN_ACCRUAL_MS);
        return null;
      }

      const accrual = Math.max(traceMs, PREVIEW_MIN_ACCRUAL_MS);
      if (ema > PREVIEW_TARGET_MS) {
        downMs = Math.min(downMs + accrual, PREVIEW_DOWN_SUSTAIN_MS);
        upMs = 0;
      } else if (ema < PREVIEW_UP_MS) {
        upMs = Math.min(upMs + accrual, PREVIEW_UP_SUSTAIN_MS);
        downMs = 0;
      } else {
        // Dead band between the two thresholds: neither direction makes
        // progress here — this is what makes the hysteresis work.
        downMs = 0;
        upMs = 0;
      }

      if (downMs >= PREVIEW_DOWN_SUSTAIN_MS && rungIndex < floorIndex) {
        return stepTo(rungIndex + 1);
      }
      if (upMs >= PREVIEW_UP_SUSTAIN_MS && rungIndex > 0) {
        return stepTo(rungIndex - 1);
      }
      return null;
    },

    reset(costWeight = 1): void {
      entryIndex = entryIndexFor(costWeight);
      rungIndex = entryIndex;
      ema = null;
      downMs = 0;
      upMs = 0;
      holdoffMs = 0;
    },
  };
}
