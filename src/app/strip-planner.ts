/**
 * Adaptive scissor-strip planner for the surface render's WebGL traces
 * (fr-sjff / fr-8kup / fr-du81 / fr-096u): carves a frame into strips
 * sized so no single GPU submission ever runs unbounded.
 *
 * The problem being solved: close to the viewplane every ray is
 * near-surface and burns the whole march budget of heavy DE calls, so a
 * frame submitted as ONE draw call can mean tens of seconds of GPU work in
 * a single submission — which trips the driver/browser GPU watchdog
 * (kernel-confirmed on Mesa/Iris: i915 preemption-timeout resets at
 * `preempt_timeout_ms` = 7.5s, fr-096u), loses the WebGL context, and
 * wedges the GPU process until the browser restarts. The fix is
 * architectural: every trace goes out as scissored strips with a
 * forced-completion sync between them (a 1x1 readback — a data dependency
 * no driver can fake; `gl.finish()` can return before execution on some
 * command-buffer paths), each sized to roughly `targetMs` of measured GPU
 * time — bounded submissions the watchdog waves through, on ANY system at
 * ANY zoom.
 *
 * Units are PIXELS, not rows (fr-096u). The planner's original row
 * vocabulary had two unbounded corners, both measured into kernel GPU
 * hangs on Iris Xe fold sessions: the probe strip (rows-fraction sized —
 * at full resolution 3 rows of a fold-frontier DE measured 0.5-4ms/px,
 * i.e. up to ~15s in the one submission that by definition runs before
 * any measurement exists), and the 1-row floor (a single 1280px fold row
 * is seconds of GPU; an 8192px capture row far worse). Pixel units close
 * both: the probe is sized from a per-pixel cost PRIOR — the caller's
 * measured value when one exists, else a pessimistic fold-class prior
 * ({@link STRIP_FOLD_PRIOR_MS_PER_PX}), else the legacy fraction for
 * affine-cheap systems — and a strip that must shrink below one row
 * simply becomes a partial row. Each strip is a contiguous row-major
 * pixel interval, handed to the renderer as 1-3 scissor rects (partial
 * first row, full middle rows, partial last row) submitted together under
 * one fence: the per-submission bound is the strip's PIXEL count, which
 * the planner controls exactly.
 *
 * Sizing after the probe is unchanged in spirit: each strip scales the
 * previous strip's pixels by `targetMs / measured`, clamped to
 * {@link STRIP_MAX_GROWTH} per step so one suspiciously-fast measurement
 * cannot balloon straight to an unbounded submission. On a light system
 * the probe measures fractions of a millisecond and the growth cap
 * reaches full-frame strips in a handful of steps (negligible overhead);
 * on a heavy close-up the strips converge to watchdog-safe slices — now
 * genuinely regardless of row width — and the caller spreads them across
 * animation frames, keeping the page responsive and the job
 * interruptible.
 *
 * Measurement scaling alone is still blind to a cost DISCONTINUITY — the
 * second fr-096u mechanism: a strip sized from a cheap band's measurement
 * can land in the frame's expensive band and cost its pixel count times a
 * 100-1000x higher price in one submission (fold+grid frames are exactly
 * that bimodal). {@link STRIP_WORST_CASE_CAP_MS} priced at the caller's
 * class-pessimistic `worstMsPerPx` caps every strip's worst-case cost, so
 * the transition strip is ~2s instead of minutes; see the constant's doc.
 *
 * Pure like `render-tier.ts`: the caller renders and measures; the
 * planner only does the arithmetic, so tests drive it with synthetic
 * measurements.
 */

/** Fraction of the frame's rows in the probe strip when NO per-pixel cost
 * prior exists (affine-cheap systems, where whole rows are microseconds).
 * Kept deliberately near-trivial (min 1 row): it is the one strip sized
 * before any measurement, and on the systems it is used for it stays far
 * under any watchdog. Systems with a prior size the probe from
 * {@link StripPlannerOptions.priorMsPerPx} instead. */
export const STRIP_PROBE_FRACTION = 1 / 256;

/** Measured GPU time (ms) each strip aims for by default — the settle/
 * capture tiers' size. Low enough to stay far from any watchdog and to keep
 * the async settle path's frames responsive; high enough that
 * forced-completion pipeline bubbles stay a small fraction of the work.
 * The preview tier plans against a smaller target (fr-du81) so its strips
 * interleave with a live drag — passed per planner via `targetMs`. */
export const STRIP_TARGET_MS = 75;

/** Per-step growth cap on strip pixels. A strip measuring near-zero (a
 * light system, or a timer quantization fluke) may grow the next strip at
 * most this much — so one under-measurement can overshoot the target by at
 * most this factor (~600ms at the default target), and reaching full-frame
 * strips on a light system still takes only a few steps. */
export const STRIP_MAX_GROWTH = 8;

/**
 * Pessimistic per-pixel cost prior (ms) for FOLD-CLASS systems before any
 * measurement exists — the fr-096u fix for the unprimed probe, and the
 * strip twin of `surface-compute.ts`'s pessimistic first-slice/first-batch
 * priors (fr-p8bc's lesson: bound first submissions by a pessimistic
 * per-unit prior in the unit that actually costs). Calibration: Iris Xe
 * measured 0.5-4ms/px on the mandelboxKifs full tier (fr-096u's sweep
 * data); headless SwiftShader ~6ms/px at preview depth (fr-du81). 10ms/px
 * sits above both, so the probe lands near `targetMs` and the real
 * measurement takes over one strip later; reality would need to beat the
 * prior ~100x — two orders past anything measured — before a probe
 * approached the 7.5s i915 preemption window.
 */
export const STRIP_FOLD_PRIOR_MS_PER_PX = 10;

/** Fold-class worst-case per-pixel cost (ms) for the per-strip cap.
 * MEASURED, not guessed: fr-096u's Iris Xe settle-tier diagnostics put the
 * mandelboxKifs surface band at ~42ms/px average — with single crease
 * pixels up to ~2.2s(!), which is why the cap must assume band prices far
 * above the probe prior (the probe prior is a typical-band figure for
 * SIZING; this is the cap's worst-case PRICE, and undershooting it turns
 * the cheap-to-expensive transition strip into a watchdog reset). At
 * 50ms/px the cap is 40px: the observed band enters at ~1.7s per
 * transition strip instead of the ~8.5s that killed the context at a
 * 200px cap. Crease-pixel RUNS (adjacent multi-second pixels) can still
 * exceed the cap's promise — the residual risk the settle cost gate
 * exists for (scene.ts's beginSurfaceSettle: a frame whose predicted cost
 * is hours never arms at all). */
export const STRIP_FOLD_WORST_MS_PER_PX = 50;

/** Affine/escape-class worst-case per-pixel cost (ms) for the per-strip
 * cap: ~20-100x a typical near-surface affine descent (a few µs/px on a
 * real GPU; tens of µs in pathological close-ups with many maps), so the
 * cap px stays enormous (~{@link STRIP_WORST_CASE_CAP_MS}/0.1 = 20000px —
 * a handful of extra strips per frame) while still bounding a
 * cheap-to-expensive transition strip to ~seconds on the worst measured
 * hardware. */
export const STRIP_AFFINE_WORST_MS_PER_PX = 0.1;

/**
 * Worst-case GPU time (ms) any single strip is allowed to PLAN for, priced
 * at the caller's class-pessimistic `worstMsPerPx` (fr-096u's second
 * mechanism). The growth cap alone is a RATIO bound on pixels and cannot
 * see a cost DISCONTINUITY: fold+grid frames are bimodal (grid-skipped
 * empty rows ~0.01-0.05ms/px vs surface-band rows 0.5-4ms/px, a 100-1000x
 * step), so strips that grew big through the cheap band could slam into
 * the expensive band as one multi-minute submission — the kernel-confirmed
 * i915 preemption hang that survived the probe fix. Capping every strip at
 * `STRIP_WORST_CASE_CAP_MS / worstMsPerPx` pixels bounds that transition
 * strip to seconds even if the measurement history says the region is
 * free; within the expensive band the ordinary measurement scaling takes
 * over and strips shrink to `targetMs`. 4000ms sits just under the 7.5s
 * i915 preemption window at the priced worst case — the margin the first
 * fr-096u cut doubled (2000ms) bought nothing but strip-count overhead,
 * which the review measured as a real slowdown on measured-cheap fold
 * systems.
 */
export const STRIP_WORST_CASE_CAP_MS = 4000;

/** One scissor rect of a strip, in target pixels (same coordinate
 * convention as `WebGLRenderTarget.scissor`). */
export interface StripRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One planned strip: a contiguous row-major pixel interval, expressed as
 * the 1-3 scissor rects that tile it. All rects belong to ONE submission
 * (one fence/readback after the last rect) — the bounded quantity is
 * `px`. */
export interface Strip {
  /** Pixels in this strip — the submission's cost unit, and what the
   * caller's fence accounting subtracts if the strip is abandoned
   * mid-flight. */
  px: number;
  /** Scissor rects tiling the interval, in render order. */
  rects: StripRect[];
}

export interface StripPlannerOptions {
  /** Measured GPU time (ms) each strip aims for. */
  targetMs?: number;
  /**
   * Best available per-pixel cost estimate (ms) BEFORE the probe runs:
   * the caller's measured value from an earlier job when one exists (a
   * completed preview priming the settle, fr-du81), else
   * {@link STRIP_FOLD_PRIOR_MS_PER_PX} for fold-class systems, else null
   * — which keeps the legacy rows-fraction probe for affine-cheap
   * systems. Sizes ONLY the probe; every later strip is sized from its
   * predecessor's real measurement.
   */
  priorMsPerPx?: number | null;
  /**
   * Pessimistic per-pixel cost FLOOR (ms) — what a strip could cost if it
   * LANDS in the frame's most expensive band, regardless of what recent
   * strips measured: the class constant
   * ({@link STRIP_FOLD_WORST_MS_PER_PX} /
   * {@link STRIP_AFFINE_WORST_MS_PER_PX}), raised to the previous job's
   * {@link StripPlanner.observedWorstMsPerPx} by the caller so a
   * re-armed job cannot re-spin a roulette an earlier job already lost.
   * Caps EVERY strip (probe included) at
   * {@link STRIP_WORST_CASE_CAP_MS} of worst-case predicted GPU, which is
   * what bounds the cheap-to-expensive transition strip the measurement
   * history cannot foresee — and the planner RAISES it further mid-job as
   * its own measurements reveal worse pixels (fr-096u measured fold
   * crease pixels at 1.7-3.1s EACH on Iris: after the first one, only
   * ~1px strips are safe, and the job that discovers it must tighten
   * itself, not just its successors). Omit/null for no cap (tests). NOT
   * the same thing as `priorMsPerPx`: a measured probe prior is a best
   * estimate that may come from a cheap region; this floor is the worst
   * case and only ever ratchets UP within a job.
   */
  worstMsPerPx?: number | null;
}

export interface StripPlanner {
  /** True once every pixel has been handed out. */
  readonly done: boolean;
  /** Pixels handed out so far. Callers render every strip the moment it
   * is planned, so this doubles as "pixels traced" — the numerator a
   * superseded job extrapolates its full-frame cost from (fr-du81). */
  readonly plannedPx: number;
  /** The full pixel count this planner tiles (rows x rowPx). */
  readonly totalPx: number;
  /** The probe (first) strip's pixel count — callers predict its cost as
   * `priorMsPerPx * probePx` where a prior exists. */
  readonly probePx: number;
  /** Worst per-pixel cost (ms) this job's own measurements have revealed
   * (0 before any measurement) — the value a caller carries into the next
   * job's `worstMsPerPx` floor so pose-cost discoveries survive job
   * re-arms. The caller decides direction: a COMPLETED job's whole-frame
   * observation may replace the floor in both directions (a measured-cheap
   * fold system must not stay pinned at the class floor's micro-strips);
   * a superseded job's partial observation may only raise it. */
  readonly observedWorstMsPerPx: number;
  /**
   * The next strip to render, sized from `prevMs` — the measured cost of
   * the PREVIOUS strip (null for the first call, or when the caller could
   * not measure: the planner then repeats the previous size rather than
   * guessing). Returns null once all pixels are planned.
   */
  next(prevMs: number | null): Strip | null;
}

/** Create a planner over `totalRows` rows of `rowPx` pixels each (a
 * non-positive area is immediately done), sizing each strip toward
 * `targetMs` of measured GPU time. */
export function createStripPlanner(
  totalRows: number,
  rowPx: number,
  options: StripPlannerOptions = {},
): StripPlanner {
  const targetMs = options.targetMs ?? STRIP_TARGET_MS;
  const prior = options.priorMsPerPx ?? null;
  const worstFloor = options.worstMsPerPx ?? null;
  // Worst per-pixel price this job's own strips have measured. The cap
  // below prices strips at max(floor, observed): a mid-job discovery of a
  // multi-second pixel tightens THIS job immediately.
  let observedWorst = 0;
  // Worst-case pixel cap: no strip may PLAN more than
  // STRIP_WORST_CASE_CAP_MS of GPU at the pessimistic price. This is the
  // discontinuity bound — growth scaling and probe priors are both blind
  // to a strip that leaves a cheap band for an expensive one.
  const capPx = (): number => {
    const worst =
      worstFloor !== null && worstFloor > 0
        ? Math.max(worstFloor, observedWorst)
        : 0;
    return worst > 0
      ? Math.max(1, Math.floor(STRIP_WORST_CASE_CAP_MS / worst))
      : Infinity;
  };
  const rows = Math.max(0, Math.floor(totalRows));
  const width = Math.max(0, Math.floor(rowPx));
  const totalPx = rows * width;
  // Legacy probe: a near-trivial fraction of the frame's rows — correct
  // for the affine-cheap systems that reach it (no prior), and the CAP on
  // a prior-sized probe (a known-cheap prior must not plan a probe bigger
  // than the legacy one ever was).
  const legacyProbePx = Math.min(
    totalPx,
    Math.max(1, Math.round(rows * STRIP_PROBE_FRACTION)) * width,
  );
  const probePx = Math.min(
    prior !== null && prior > 0
      ? Math.min(legacyProbePx, Math.max(1, Math.round(targetMs / prior)))
      : legacyProbePx,
    capPx(),
  );
  let planned = 0;
  let lastPx = 0;

  return {
    get done(): boolean {
      return planned >= totalPx;
    },

    get plannedPx(): number {
      return planned;
    },

    get totalPx(): number {
      return totalPx;
    },

    get probePx(): number {
      return probePx;
    },

    get observedWorstMsPerPx(): number {
      return observedWorst;
    },

    next(prevMs: number | null): Strip | null {
      if (planned >= totalPx) return null;
      // Ratchet the observed worst BEFORE sizing: the measurement being
      // handed in prices the previous strip, and if it revealed
      // multi-second pixels the very next strip must already be capped by
      // them.
      if (prevMs !== null && prevMs > 0 && lastPx > 0) {
        observedWorst = Math.max(observedWorst, prevMs / lastPx);
      }
      let px: number;
      if (lastPx === 0) {
        px = probePx;
      } else {
        const scale =
          prevMs !== null && prevMs > 0
            ? Math.min(targetMs / prevMs, STRIP_MAX_GROWTH)
            : 1;
        px = Math.min(Math.max(1, Math.round(lastPx * scale)), capPx());
      }
      px = Math.min(px, totalPx - planned);
      const strip = { px, rects: intervalRects(planned, px, width) };
      planned += px;
      lastPx = px;
      return strip;
    },
  };
}

/** Tile the row-major pixel interval `[start, start + px)` of a
 * `rowPx`-wide frame into 1-3 scissor rects: the partial first row (when
 * the interval starts mid-row), the full middle rows, the partial last
 * row. */
function intervalRects(start: number, px: number, rowPx: number): StripRect[] {
  const rects: StripRect[] = [];
  let p = start;
  let remaining = px;
  const x0 = p % rowPx;
  if (x0 > 0) {
    const w = Math.min(rowPx - x0, remaining);
    rects.push({ x: x0, y: (p - x0) / rowPx, w, h: 1 });
    p += w;
    remaining -= w;
  }
  if (remaining >= rowPx) {
    const h = Math.floor(remaining / rowPx);
    rects.push({ x: 0, y: p / rowPx, w: rowPx, h });
    p += h * rowPx;
    remaining -= h * rowPx;
  }
  if (remaining > 0) {
    rects.push({ x: 0, y: p / rowPx, w: remaining, h: 1 });
  }
  return rects;
}
