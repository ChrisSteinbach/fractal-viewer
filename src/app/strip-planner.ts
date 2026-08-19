/**
 * Adaptive scissor-strip planner for the surface render's WebGL traces:
 * carves a frame into strips sized so no single GPU submission ever runs
 * unbounded.
 *
 * The problem being solved: close to the viewplane every ray is
 * near-surface and burns the whole march budget of heavy DE calls, so a
 * frame submitted as ONE draw call can mean tens of seconds of GPU work in
 * a single submission — which trips the driver/browser GPU watchdog
 * (kernel-confirmed on Mesa/Iris: i915 preemption-timeout resets at
 * `preempt_timeout_ms` = 7.5s), loses the WebGL context, and wedges the GPU
 * process until the browser restarts. The fix is architectural: every trace
 * goes out as scissored strips with a forced-completion sync between them
 * (a 1x1 readback — a data dependency no driver can fake; `gl.finish()` can
 * return before execution on some command-buffer paths), each sized to
 * roughly `targetMs` of measured GPU time — bounded submissions the
 * watchdog waves through, on ANY system at ANY zoom.
 *
 * Units are PIXELS, not rows. The planner's original row vocabulary had two
 * unbounded corners, both measured into kernel GPU hangs on Iris Xe fold
 * sessions: the probe strip (rows-fraction sized — at full resolution 3
 * rows of a fold-frontier DE measured 0.5-4ms/px, i.e. up to ~15s in the
 * one submission that by definition runs before any measurement exists),
 * and the 1-row floor (a single 1280px fold row is seconds of GPU; an
 * 8192px capture row far worse). Pixel units close both: the probe is sized
 * from a per-pixel cost PRIOR — the caller's measured value when one
 * exists, else a pessimistic fold-class prior ({@link
 * STRIP_FOLD_PRIOR_MS_PER_PX}), else the legacy fraction for affine-cheap
 * systems — and a strip that must shrink below one row simply becomes a
 * partial row. Each strip is a contiguous row-major pixel interval, handed
 * to the renderer as 1-3 scissor rects (partial first row, full middle
 * rows, partial last row) submitted together under one fence: the
 * per-submission bound is the strip's PIXEL count, which the planner
 * controls exactly.
 *
 * Sizing after the probe is as many pixels as the measured MARGINAL cost
 * says fit one strip target ({@link stripModelPx}), clamped to
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
 * second hang mechanism: a strip sized from a cheap band's measurement can
 * land in the frame's expensive band and cost its pixel count times a
 * 100-1000x higher price in one submission (fold+grid frames are exactly
 * that bimodal). {@link STRIP_WORST_CASE_CAP_MS} priced at the caller's
 * class-pessimistic `worstMsPerPx` caps every strip's worst-case cost, so
 * the transition strip is ~2s instead of minutes; see the constant's doc.
 *
 * WHAT A MEASUREMENT IS PRICED AS is the two-term correction, and it is the
 * whole of why {@link StripCost} exists. Until then the sizer carried ONE
 * number — a batch's whole wall over its pixel count — which charges every
 * submission's FIXED cost (the fence/poll service, the per-draw setup, one
 * caller tick of poll quantization) to the pixels that happened to ride it.
 * That is an absorbing state, not an over-estimate: a fixed-cost-dominated
 * batch reads as expensive pixels, the sizer asks for fewer, the next batch
 * is MORE fixed-dominated, and growing back would need a batch measuring
 * under `targetMs` that the fixed cost alone forbids. Measured on a
 * near-empty frame at extreme zoom: strips collapsed 990 -> ... -> 1px and
 * then oscillated at 1-6px, each batch still costing 500-1700ms REGARDLESS
 * of its pixel count, with the export frozen at 59% for the last 5.5
 * minutes of a 480s run. The compute arm had the identical pathology at its
 * hit dispatches and fixed it in `surface-compute.ts`: two terms, each
 * measurement's surprise split by WIDTH so a narrow batch charges the
 * INTERCEPT, sizing off the MARGINAL alone. This file now runs that model —
 * see {@link StripCost} and {@link nextStripCost} — and the safety
 * mechanisms above are untouched by it: the cap is applied LAST and is
 * still priced on the raw ms/px ratchet, so the SET of sizes a strip may
 * take is exactly what it was and only the choice within it moved.
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
 * The preview tier plans against a smaller target so its strips
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
 * measurement exists — the fix for the unprimed probe, and the strip twin
 * of `surface-compute.ts`'s pessimistic first-slice/first-batch priors (the
 * width-1 shading probe's lesson: bound first submissions by a pessimistic
 * per-unit prior in the unit that actually costs). Calibration: Iris Xe
 * measured 0.5-4ms/px on the mandelboxKifs full tier (the hang
 * investigation's sweep data); headless SwiftShader ~6ms/px at preview
 * depth. 10ms/px sits above both, so the probe lands near `targetMs` and
 * the real measurement takes over one strip later; reality would need to
 * beat the prior ~100x — two orders past anything measured — before a probe
 * approached the 7.5s i915 preemption window.
 */
export const STRIP_FOLD_PRIOR_MS_PER_PX = 10;

/** Fold-class worst-case per-pixel cost (ms) for the per-strip cap.
 * MEASURED, not guessed: Iris Xe settle-tier diagnostics put the
 * mandelboxKifs surface band at ~42ms/px average — with single crease
 * pixels up to ~2.2s(!), which is why the cap must assume band prices far
 * above the probe prior (the probe prior is a typical-band figure for
 * SIZING; this is the cap's worst-case PRICE, and undershooting it turns
 * the cheap-to-expensive transition strip into a watchdog reset). At
 * 50ms/px the cap is 40px: the observed band enters at ~1.7s per
 * transition strip instead of the ~8.5s that killed the context at a
 * 200px cap. Crease-pixel RUNS (adjacent multi-second pixels) can still
 * exceed the cap's promise — but the settle always arms regardless
 * and previews likewise run to completion however long that takes
 * (the no-automatic-give-up verdict, progress disclosed) — the worst-case
 * cap's job is keeping each SUBMISSION bounded while those grinds stay
 * interruptible. */
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
 * at the caller's class-pessimistic `worstMsPerPx` (the second hang
 * mechanism). The growth cap alone is a RATIO bound on pixels and cannot
 * see a cost DISCONTINUITY: fold+grid frames are bimodal (grid-skipped
 * empty rows ~0.01-0.05ms/px vs surface-band rows 0.5-4ms/px, a 100-1000x
 * step), so strips that grew big through the cheap band could slam into the
 * expensive band as one multi-minute submission — the kernel-confirmed i915
 * preemption hang that survived the probe fix. Capping every strip at
 * `STRIP_WORST_CASE_CAP_MS / worstMsPerPx` pixels bounds that transition
 * strip to seconds even if the measurement history says the region is free;
 * within the expensive band the ordinary measurement scaling takes over and
 * strips shrink to `targetMs`. 4000ms sits just under the 7.5s i915
 * preemption window at the priced worst case — the margin the first cut
 * doubled (2000ms) bought nothing but strip-count overhead, which the
 * review measured as a real slowdown on measured-cheap fold systems.
 */
export const STRIP_WORST_CASE_CAP_MS = 4000;

/**
 * The attribution pivot, priced rather than fixed: the per-pixel cost
 * (ms) at which one strip target's worth of pixels is the width where a
 * measurement is half about the per-batch INTERCEPT and half about the
 * per-pixel MARGINAL cost. {@link stripCostPivotPx} turns it into the
 * pixel width {@link nextStripCost} splits by.
 *
 * IT IS A PRICE AND NOT A WIDTH FOR A MEASURED REASON, and this is the
 * one place the compute arm's design could not be copied. Its twin
 * (`SURFACE_COMPUTE_SHADE_COST_PIVOT` = 512 hits = eight workgroups) is a
 * HARDWARE knee — below it a dispatch's cost really is flat in its width,
 * so one constant serves every scene. A scissored strip has no such knee:
 * its cost is linear in pixels from the first pixel, so "narrow" is a
 * statement about the SCENE, and the two tiers this planner drives are
 * three orders of magnitude apart in natural strip width (a light affine
 * settle converges at ~35,000px; a heavy fold PREVIEW at ~3px). A single
 * pixel pivot cannot serve both: above the scene's natural width every
 * measurement reads as fixed cost and the sizer stops tracking its target
 * (simulated: a 4ms/px preview sized at 80px/321ms instead of 3px/13ms);
 * below it, the fixed-cost branch's escape is too narrow to escape with.
 *
 * Scaling by `targetMs` fixes exactly that, because the target IS the
 * statement of how much work one strip should carry: the settle tier's
 * pivot is 125px and the preview tier's is 20px. 0.6ms/px is the price that
 * puts them there, and it sits inside the measured heavy-fold band
 * (0.5-4ms/px on mandelboxKifs, ~6ms/px for a SwiftShader preview) — so
 * "narrower than one strip target of HEAVY pixels" is the reading of "too
 * narrow to be about pixels". UNMEASURED as a pivot; simulated across the
 * tiers, not pinned on a driver.
 */
export const STRIP_COST_PIVOT_MS_PER_PX = 0.6;

/** The attribution pivot as a WIDTH for a tier aiming at `targetMs` — see
 * {@link STRIP_COST_PIVOT_MS_PER_PX}. Also the unit the fixed-cost
 * branch of {@link stripAllowanceMs} sizes strips in: where that branch
 * binds it hands {@link STRIP_WORK_PER_FIXED_COST} times this many
 * pixels (the identity in {@link nextStripCost}), so moving the price
 * moves that width by the same factor. */
export function stripCostPivotPx(targetMs: number): number {
  return Math.max(1, targetMs / STRIP_COST_PIVOT_MS_PER_PX);
}

/**
 * How much MARGINAL work (ms of predicted per-pixel cost) one strip may
 * carry per unit of the FIXED cost its batch is going to pay anyway — the
 * second term of {@link stripAllowanceMs}, and the branch that breaks
 * the single-number estimator's absorbing state.
 *
 * A batch whose wall is dominated by fixed cost cannot be made cheaper by
 * shrinking the strips inside it; refusing to widen them past `targetMs`
 * of TOTAL cost is what walked the old sizer down to 1px. So once the
 * measured intercept exceeds `targetMs / (1 + this)`, the strip is sized
 * to spend this much again on real pixels instead — at 1, a strip whose
 * batch pays a 500ms fixed cost may carry another 500ms of predicted
 * marginal work, i.e. the batch is at worst half overhead.
 *
 * ONE, AND UNMEASURED — deliberately the conservative end. Its compute twin
 * ships 7 on a measured table (`SURFACE_COMPUTE_SHADE_WORK_PER_
 * FIXED_COST`), which is the same dial one arm over; nothing here has been
 * measured on a real driver yet, and the number is an UPPER BOUND on a
 * strip's width in the branch that binds, so erring low costs throughput
 * and erring high spends watchdog headroom. The outer bound is {@link
 * STRIP_WORST_CASE_CAP_MS} either way — the cap is applied after this and
 * wins — so raising it can only trade submissions for size INSIDE the
 * watchdog-safe envelope.
 */
export const STRIP_WORK_PER_FIXED_COST = 1;

/**
 * How far the per-pixel MARGINAL estimate may RISE on one measurement — a
 * doubling.
 *
 * THE DIRECTION IS THE OPPOSITE OF THE COMPUTE ARM'S AND THAT IS
 * DELIBERATE. `SURFACE_COMPUTE_SHADE_MARGINAL_DECAY` rate-limits the
 * marginal's FALL because a falling marginal INFLATES that sizer's batch
 * width, and a too-wide hit dispatch is the hazard there. This sizer's
 * runaway is the mirror image: a RISING marginal SHRINKS strips, and
 * shrinking is the direction with an absorbing state at the bottom
 * (a 1px strip carries a whole submission's fixed cost, which
 * re-reads as expensive pixels). Optimism here needs no rate limit of its
 * own because it already has two independent bounds this planner has
 * always had and the compute sizer did not: {@link STRIP_MAX_GROWTH}
 * caps a strip at 8x its predecessor however cheap the model thinks
 * pixels are, and the worst-case cap bounds it absolutely.
 *
 * WHAT IT COSTS is the sizer's own spike response at a cheap-to-expensive
 * band entry: the model needs log2 of the step in measurements to price
 * it, and until then the strip is bounded by the worst-case cap rather
 * than by the model. That is bounded, not unbounded — every strip is
 * still clamped to {@link STRIP_WORST_CASE_CAP_MS} of GPU at the raw
 * ratcheted price, which is the bounded-submission promise and does not go
 * through the model at all. The rise limit is belt-and-braces regardless:
 * the width split already leaves a narrow batch's surprise almost
 * entirely on the intercept, and the identity in {@link nextStripCost}
 * pins the fixed-dominated answer at a constant width no measurement can
 * walk down. From a zero marginal any rise is allowed — a multiplicative
 * limit off zero would pin it at zero forever.
 */
export const STRIP_COST_MARGINAL_RISE = 2;

/**
 * Smallest strip (px) the cost model may size, once it has a measurement
 * — the "sane unit of work" floor, not the smallest expressible one
 * (`surface-compute.ts` floors its hit batches at one WORKGROUP
 * for the same reason: "shrinking below one workgroup only multiplies the
 * number of worst-ray-cost submissions without shrinking any single one
 * of them"). Every strip carries a whole submission's fixed cost, so a
 * 1px floor lets a frame plan `totalPx` submissions of pure overhead —
 * 921,600 of them on a 1280x720 settle.
 *
 * 32px, and the number is chosen against the two clamps it sits between
 * rather than picked for roundness. Upward: the fold class's fresh cap is
 * {@link STRIP_WORST_CASE_CAP_MS} / {@link STRIP_FOLD_WORST_MS_PER_PX} =
 * 80px, so this floor can never loosen a strip that cap was holding, and
 * on the heaviest PREVIEW simulated (0.4ms/px at the 12ms tier target,
 * whose natural strip is 22px) it costs 16ms against 12 — one frame, on
 * the one tier where granularity is the point. Downward: it still bounds
 * a frame's submission count by 32x against a 1px floor. Where pixels are
 * expensive enough that even this is a big strip, the worst-case cap is
 * below it and wins.
 *
 * IT DOES NOT APPLY TO THE PROBE, nor to a repeat of an unmeasured strip:
 * that size is the caller's PRIOR, the one pessimistic bound standing
 * over a submission nothing has measured (the unprimed-probe hang),
 * and flooring it would be a 32x unmeasured jump past exactly that
 * bound.
 */
export const STRIP_MIN_PX = 32;

/**
 * The strip cost model: `cost(px) = interceptMs + px * marginalMsPerPx`,
 * the strip twin of `surface-compute.ts`'s `ShadeHitCost`.
 *
 * The two terms are physically different things and conflating them is
 * the defect this type exists to name. `interceptMs` is what a batch
 * costs before any pixels — the fence/readback sync point (~66-90ms
 * measured, and the caller already subtracts a flat
 * `SURFACE_STRIP_SYNC_TAX_MS` of it before reporting), the per-draw
 * setup, and one caller tick of poll quantization for a drain that
 * yields between polls. `marginalMsPerPx` is what each traced pixel adds
 * on top. Dividing a batch's whole wall by its pixel count — what the
 * single `msPerPxEstimate` did — called a 500ms poll over 1px "500 ms/px"
 * and sized the next strip from it.
 */
export interface StripCost {
  /** Fixed per-batch cost (ms), independent of the pixels traced. */
  interceptMs: number;
  /** Added cost (ms) per traced pixel beyond the intercept. */
  marginalMsPerPx: number;
}

/** A job opens knowing nothing: both terms zero, which the planner reads
 * as "no measurement yet" and answers by repeating the prior-sized probe
 * rather than by modelling anything. */
export function initialStripCost(): StripCost {
  return { interceptMs: 0, marginalMsPerPx: 0 };
}

/** True while nothing has been folded into `cost` — the planner's
 * "repeat the probe" state, and what keeps a PRIOR-sized strip from being
 * mistaken for a measured one. */
export function stripCostIsEmpty(cost: StripCost): boolean {
  return cost.interceptMs <= 0 && cost.marginalMsPerPx <= 0;
}

/**
 * GPU time (ms) one strip may spend on MARGINAL work — pixels — on top of
 * the fixed cost its batch pays whatever its width:
 * `max(targetMs - intercept, STRIP_WORK_PER_FIXED_COST * intercept)`.
 *
 * Below the knee that is simply the room left inside the strip target (a
 * 5ms intercept leaves 70ms of pixels to buy), which is what keeps ordinary
 * frames sized as they always were. Above it — an intercept larger than the
 * whole target — it is the absorbing state's escape: a batch whose fixed
 * cost alone exceeds `targetMs` cannot be made cheaper by putting fewer
 * pixels in it, so the sizer stops trying to hit a total it can no longer
 * reach and buys marginal work in proportion to the fixed cost it is paying
 * anyway.
 */
export function stripAllowanceMs(
  interceptMs: number,
  targetMs: number,
): number {
  return Math.max(
    targetMs - interceptMs,
    STRIP_WORK_PER_FIXED_COST * interceptMs,
  );
}

/**
 * Pixels the model says fit one strip: the allowance divided by the
 * MARGINAL cost alone. `Infinity` when the marginal has clamped to zero
 * (a frame whose pixels really are free — the planner's growth cap and
 * worst-case cap are what bound the answer then, exactly as they bound a
 * near-zero measurement today).
 *
 * SIZING READS THE MARGINAL AND NOTHING ELSE. Dividing by a batch average
 * would charge the intercept to every pixel, so the predicted width would
 * fall as the strip narrowed and the sizer would walk itself to the floor —
 * the single-number estimator's ratchet, and the shade sizer's one-hit
 * trapdoor one module over.
 */
export function stripModelPx(cost: StripCost, targetMs: number): number {
  const allowanceMs = stripAllowanceMs(cost.interceptMs, targetMs);
  return cost.marginalMsPerPx > 0
    ? allowanceMs / cost.marginalMsPerPx
    : Number.POSITIVE_INFINITY;
}

/**
 * Fold one measured batch — `measuredMs` of wall over `px` traced pixels
 * — into the cost model (mirroring `surface-compute.ts`'s
 * `nextShadeHitCost`).
 *
 * One observation, two unknowns — so the surprise (measured minus
 * predicted) is SPLIT by how much this width can speak about each term:
 * `w = px / (px + pivotPx)` of it to the marginal, the rest to the
 * intercept. A 1px batch is nearly all fixed cost and moves the
 * intercept; a wide one moves the marginal. THIS IS THE FIX, not a
 * refinement of it: the pathological batches are narrow ones whose wall
 * is a poll interval, and the split is what stops them being read as
 * expensive pixels.
 *
 * The split is exact-fitting where no clamp binds — after the update the
 * model reproduces the measurement at that width — so reporting the SAME
 * measurement at the SAME width twice is a no-op, which is what lets
 * `scene.ts`'s sync-collapse path feed both this planner's doors without
 * double counting.
 *
 * WHAT THE SPLIT CANNOT DO, carried over verbatim from the compute arm
 * because it governs how the result may be used: IT NEVER IDENTIFIES THE
 * TWO TERMS. Unclamped, this function preserves `interceptMs = pivotPx *
 * marginalMsPerPx` identically (from a zeroed model one update at width n
 * gives `I = (1-w)C` and `m = wC/n`, so `I/m = n(1-w)/w = pivotPx`; and if
 * `I = pivotPx*m` already, `I'/m' = pivotPx` for any surprise at any
 * width).
 * Two parameters, one measurement, an exact fit: the RATIO is the
 * attribution weight's and only the SCALE is the data's.
 *
 * That has one consequence worth stating plainly, because it is also the
 * property that makes the absorbing state unreachable: in the
 * fixed-cost-dominated branch the sizer's answer is
 * `STRIP_WORK_PER_FIXED_COST * pivotPx` pixels on EVERY frame, and no
 * measurement can walk it down. It also means the model alone cannot tell
 * a batch that was slow because of overhead from one that was slow
 * because its pixels are monsters — which is exactly why the worst-case
 * cap keeps pricing strips on the RAW ms/px ratchet instead of on this
 * model, and why it is applied last.
 */
export function nextStripCost(
  cost: StripCost,
  px: number,
  measuredMs: number,
  pivotPx: number,
): StripCost {
  const n = Math.max(1, px);
  const surpriseMs = measuredMs - (cost.interceptMs + n * cost.marginalMsPerPx);
  const w = n / (n + Math.max(1, pivotPx));
  const marginal = cost.marginalMsPerPx + (w * surpriseMs) / n;
  return {
    interceptMs: Math.max(0, cost.interceptMs + (1 - w) * surpriseMs),
    marginalMsPerPx: Math.max(
      0,
      // The rate limit on PESSIMISM — see STRIP_COST_MARGINAL_RISE for
      // why this direction and not the compute arm's. Off a zero
      // marginal there is nothing to limit: a multiplicative bound would
      // pin it at zero for the rest of the job.
      cost.marginalMsPerPx > 0
        ? Math.min(marginal, cost.marginalMsPerPx * STRIP_COST_MARGINAL_RISE)
        : marginal,
    ),
  };
}

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
   * Best available per-pixel cost estimate (ms) BEFORE the probe runs: the
   * caller's measured value from an earlier job when one exists (a
   * completed preview priming the settle), else {@link
   * STRIP_FOLD_PRIOR_MS_PER_PX} for fold-class systems, else null — which
   * keeps the legacy rows-fraction probe for affine-cheap systems. Sizes
   * ONLY the probe; every later strip is sized from the {@link StripCost}
   * the job's own measurements build.
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
   * its own measurements reveal worse pixels (measured fold
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
   * superseded job extrapolates its full-frame cost from. */
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
   * The two-term cost model this job's measurements have built:
   * `{interceptMs, marginalMsPerPx}`, both zero until something is
   * measured. Read it for the MARGINAL — the only honest per-pixel price
   * a caller pacing its own queue can use, and the one the single
   * `msPerPxEstimate` never was. Not a per-pixel truth: see
   * {@link nextStripCost}'s identity note before writing any rule in
   * terms of the intercept alone.
   */
  readonly cost: StripCost;
  /**
   * The next strip to render, sized from the cost model (null for the
   * first call, which pays the probe). `prevMs` is the measured cost of
   * the PREVIOUS strip when the caller has one — it folds into the model
   * over that strip's pixels and ratchets the worst price, exactly as
   * {@link observe} would; null when the caller could not measure, and
   * the planner then sizes from whatever the model already knows (or
   * repeats the previous size while it knows nothing). Returns null once
   * all pixels are planned.
   *
   * A CALLER WHOSE MEASUREMENTS ARE BATCHES MUST REPORT THEM THROUGH
   * {@link observe} AND PASS NULL HERE. Re-quoting a batch's per-pixel
   * average at one strip's width is a fabricated measurement at a width
   * nothing was measured at, and the model would attribute it — that is
   * the very conflation this model exists to undo. Reporting the same
   * measurement at the same width through both doors is harmless (the
   * ratchet is a max and the model's split is exact-fitting).
   */
  next(prevMs: number | null): Strip | null;
  /**
   * Report a measurement directly: `ms` of GPU time observed over `px`
   * traced pixels (a single strip or a fence batch — reported at the width
   * it was actually measured at, which is what lets the cost model
   * attribute it). Folds into {@link cost} and ratchets the worst-price
   * observation exactly like the `prevMs` handed to {@link next} does — the
   * difference is WHEN: `next` only hears about a measurement if another
   * strip is still to be planned, so a job's LAST measurement (the final
   * drain strip, the final fence batch, a sync-collapse strip that escapes
   * the regime) never reached the ratchet — and a completed job whose final
   * strip discovered the expensive band then handed the evidence chain a
   * too-low worst (the no-give-up verdict's safety half). Callers report
   * every measurement here at the moment it exists; the `next` door stays
   * as well, and `scene.ts`'s sync-collapse path deliberately uses both —
   * the ratchet is a max, and the model's split is exact-fitting, so
   * folding the same measurement at the same width twice is a no-op. The
   * one sharp edge is that the exact fit is what a clamp breaks: when
   * {@link STRIP_COST_MARGINAL_RISE} binds on the first fold, a second fold
   * of the same measurement moves the marginal again, so that path allows
   * one extra doubling per strip. Harmless where it happens (the
   * sync-collapse regime escapes to the pipelined one the moment a strip
   * measures past `SURFACE_STRIP_SYNC_ESCAPE_MS`, so the model is barely
   * consulted there) — but a NEW caller with batch-width measurements must
   * report them here and pass null to {@link next}.
   */
  observe(ms: number, px: number): void;
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
  // The two-term cost model. Empty until a REAL measurement
  // lands: a prior is a price, not an observation, and sizing a strip
  // from it would be the unprimed-probe hazard one step later.
  let cost = initialStripCost();
  const fold = (ms: number, px: number): void => {
    observedWorst = Math.max(observedWorst, ms / px);
    cost = nextStripCost(cost, px, ms, stripCostPivotPx(targetMs));
  };

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

    get cost(): StripCost {
      return cost;
    },

    observe(ms: number, px: number): void {
      if (ms > 0 && px > 0) fold(ms, px);
    },

    next(prevMs: number | null): Strip | null {
      if (planned >= totalPx) return null;
      // Fold BEFORE sizing: the measurement being handed in prices the
      // previous strip, and if it revealed multi-second pixels the very
      // next strip must already be capped by them.
      if (prevMs !== null && prevMs > 0 && lastPx > 0) fold(prevMs, lastPx);
      let px: number;
      if (lastPx === 0) {
        px = probePx;
      } else if (stripCostIsEmpty(cost)) {
        // Nothing measured yet — a caller that could not time its strip,
        // or a job still riding its probe prior. Repeat the previous
        // size: it is the PRIOR's, the one pessimistic bound standing
        // over an unmeasured submission, so neither the model nor
        // STRIP_MIN_PX may widen it here.
        px = Math.min(lastPx, capPx());
      } else {
        // THE CLAMP ORDER IS THE SAFETY ARGUMENT AND MUST NOT BE REORDERED
        // (the cost model inside the watchdog bound). Innermost is the
        // model's own answer, held to STRIP_MAX_GROWTH of its predecessor
        // so a width the measurements have never priced is only reached by
        // climbing through widths they have. Then STRIP_MIN_PX, the
        // sane-unit floor that breaks the 1px collapse — it may beat the
        // growth cap, because it is a constant rather than a measurement
        // and so cannot balloon. Then the worst-case cap, LAST and
        // outermost: an unbounded strip draw is the kernel-confirmed i915
        // preemption hang, so wherever floor and cap disagree the CAP WINS
        // — on a cheap frame the floor governs and the spiral breaks, on an
        // expensive one the cap governs exactly as it did before this model
        // existed. The set of sizes a strip may take is therefore
        // unchanged; only the choice within it moved.
        const grown = Math.min(
          stripModelPx(cost, targetMs),
          lastPx * STRIP_MAX_GROWTH,
        );
        px = Math.min(Math.max(Math.round(grown), STRIP_MIN_PX), capPx());
      }
      px = Math.min(px, totalPx - planned);
      // Row-snap strips of a row or more: ending on a row boundary keeps
      // a row-aligned successor to ONE scissor rect (measured a
      // ~20-30ms fixed GPU cost per draw on Iris/ANGLE — three rects per
      // strip tripled it) and avoids 1px-tall partial rows, whose 2x2
      // fragment-quad shading wastes half the lanes. Sub-row strips (the
      // worst-case cap's territory) keep exact pixel granularity.
      if (px >= width && width > 0) {
        const rem = (planned + px) % width;
        if (rem !== 0 && px - rem >= width) px -= rem;
      }
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
