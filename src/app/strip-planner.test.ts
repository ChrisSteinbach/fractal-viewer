import {
  createStripPlanner,
  initialStripCost,
  nextStripCost,
  stripAllowanceMs,
  stripModelPx,
  STRIP_AFFINE_WORST_MS_PER_PX,
  STRIP_COST_MARGINAL_RISE,
  stripCostPivotPx,
  STRIP_FOLD_PRIOR_MS_PER_PX,
  STRIP_FOLD_WORST_MS_PER_PX,
  STRIP_MAX_GROWTH,
  STRIP_MIN_PX,
  STRIP_TARGET_MS,
  STRIP_WORK_PER_FIXED_COST,
  STRIP_WORST_CASE_CAP_MS,
} from "./strip-planner";

describe("createStripPlanner", () => {
  it("plans the first strip as a legacy rows-fraction probe when no prior exists", () => {
    const planner = createStripPlanner(720, 1280);
    // No priorMsPerPx: probeRows = max(1, round(720/256)) = 3 rows -> 3 * 1280 = 3840px.
    expect(planner.next(null)).toEqual({
      px: 3840,
      rects: [{ x: 0, y: 0, w: 1280, h: 3 }],
    });
  });

  it("sizes the probe from a per-pixel cost prior when one is given", () => {
    const planner = createStripPlanner(720, 1280, { priorMsPerPx: 10 });
    // round(75/10) = 8 -- one strip target of predicted GPU time.
    expect(planner.next(null)).toEqual({
      px: 8,
      rects: [{ x: 0, y: 0, w: 8, h: 1 }],
    });
  });

  it("caps a cheap prior's probe at the legacy rows-fraction size", () => {
    const planner = createStripPlanner(720, 1280, { priorMsPerPx: 0.00001 });
    // 75 / 0.00001 = 7,500,000px, dwarfing the 3840px legacy probe -- a
    // cheap prior must never plan a BIGGER probe than the legacy one ever
    // was, so the result is identical to the no-prior case.
    expect(planner.next(null)).toEqual({
      px: 3840,
      rects: [{ x: 0, y: 0, w: 1280, h: 3 }],
    });
  });

  it("exposes probePx equal to the first strip's px", () => {
    const planner = createStripPlanner(720, 1280, { priorMsPerPx: 10 });
    const probePxBeforeFirstCall = planner.probePx;
    expect(planner.next(null)!.px).toBe(probePxBeforeFirstCall);
  });

  it("sizes the prior probe against a custom targetMs", () => {
    const planner = createStripPlanner(720, 1280, {
      targetMs: 12,
      priorMsPerPx: 10,
    });
    // max(1, round(12/10)) = 1 -- the default 75ms target would have sized
    // this probe at 8px instead.
    expect(planner.next(null)).toEqual({
      px: 1,
      rects: [{ x: 0, y: 0, w: 1, h: 1 }],
    });
  });

  it("grows the next strip after a fast measurement, capped at STRIP_MAX_GROWTH, continuing mid-row", () => {
    const planner = createStripPlanner(720, 1280, { priorMsPerPx: 10 });
    planner.next(null); // 8px probe
    // The raw ratio 75/0.001 would blow this strip up far past totalPx; the
    // growth cap (8x) is what actually limits it to 64px, continuing right
    // where the probe left off (x 8) rather than restarting the row.
    expect(planner.next(0.001)).toEqual({
      px: 64,
      rects: [{ x: 8, y: 0, w: 64, h: 1 }],
    });
  });

  it("reads one slow measurement at a narrow width as fixed cost, not as expensive pixels", () => {
    const planner = createStripPlanner(720, 1280, { priorMsPerPx: 10 });
    planner.next(null); // 8px probe
    // fr-ado7: an 8px batch measuring 1e9ms is ONE observation of TWO
    // unknowns, and at a width this far under the pivot the split hands
    // nearly all of it to the intercept -- so the model does NOT conclude
    // that pixels cost 125,000,000ms each and shrink to 1px (the old
    // single-number sizer's answer, and the first step of its collapse).
    // The growth cap is what bounds the answer here; in production the
    // worst-case cap bounds it far harder (next test).
    expect(planner.next(1e9)).toEqual({
      px: 64,
      rects: [{ x: 8, y: 0, w: 64, h: 1 }],
    });
    expect(planner.cost.interceptMs).toBeGreaterThan(1e9 * 0.9);
    expect(planner.cost.marginalMsPerPx).toBeLessThan(1e9 / 8);
  });

  it("lets the worst-case cap overrule the model on that same measurement", () => {
    // The production shape of the test above: every scene.ts strip job
    // carries a worstMsPerPx, and the raw ms/px ratchet -- which the cost
    // model deliberately does NOT feed -- is what still tells a monster
    // pose from an overhead-bound one. 1e9ms over 8px = 1.25e8 ms/px, so
    // the cap is one pixel and the cap is applied last.
    const planner = createStripPlanner(720, 1280, {
      priorMsPerPx: 10,
      worstMsPerPx: STRIP_FOLD_WORST_MS_PER_PX,
    });
    planner.next(null); // 8px probe
    expect(planner.next(1e9)!.px).toBe(1);
  });

  it("repeats the previous strip size when a measurement is unavailable", () => {
    const planner = createStripPlanner(720, 1280, { priorMsPerPx: 10 });
    planner.next(null); // 8px probe
    expect(planner.next(null)).toEqual({
      px: 8,
      rects: [{ x: 8, y: 0, w: 8, h: 1 }],
    });
  });

  it("tiles a strip spanning rows into partial-first-row, full-middle-rows, partial-last-row rects", () => {
    const planner = createStripPlanner(4, 10, { priorMsPerPx: 15 });
    // round(75/15) = 5
    expect(planner.next(null)).toEqual({
      px: 5,
      rects: [{ x: 0, y: 0, w: 5, h: 1 }],
    });
    // Growth cap asks for 5 * 8 = 40px, clamped to the 35 remaining: 5px
    // finishes row 0, then 3 full rows of width 10 tile the rest.
    expect(planner.next(0.001)).toEqual({
      px: 35,
      rects: [
        { x: 5, y: 0, w: 5, h: 1 },
        { x: 0, y: 1, w: 10, h: 3 },
      ],
    });
  });

  it("tiles the whole frame exactly with no overlaps or gaps, no prior", () => {
    const totalRows = 64;
    const rowPx = 100;
    const planner = createStripPlanner(totalRows, rowPx);
    const covered = new Array<number>(totalRows * rowPx).fill(0);
    let measurement: number | null = null;
    while (!planner.done) {
      const strip = planner.next(measurement);
      expect(strip).not.toBeNull();
      for (const rect of strip!.rects) {
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.y).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.w).toBeLessThanOrEqual(rowPx);
        expect(rect.y + rect.h).toBeLessThanOrEqual(totalRows);
        for (let y = rect.y; y < rect.y + rect.h; y += 1) {
          for (let x = rect.x; x < rect.x + rect.w; x += 1) {
            covered[y * rowPx + x] += 1;
          }
        }
      }
      // Very fast every time after the probe, so later strips are limited
      // by the growth cap and then by the remaining pixels, not by timing.
      measurement = 0.001;
    }

    // done tracks next() running out of pixels to hand out: once it flips
    // true, the following call returns null.
    expect(planner.next(measurement)).toBeNull();
    expect(covered.every((count) => count === 1)).toBe(true);
    expect(planner.plannedPx).toBe(6400);
    expect(planner.totalPx).toBe(6400);
  });

  it("tiles the whole frame exactly with sub-row strips under alternating measurements", () => {
    const totalRows = 3;
    const rowPx = 7;
    const planner = createStripPlanner(totalRows, rowPx, { priorMsPerPx: 25 });
    const covered = new Array<number>(totalRows * rowPx).fill(0);
    // probe = max(1, round(75/25)) = 3px. Cycling slow/fast/slower/null
    // measurements keeps the strip size changing across a sub-row width,
    // stressing the partial-row continuation math for overlaps or gaps.
    const measurements: (number | null)[] = [500, 0.001, 200, null];
    let i = 0;
    while (!planner.done) {
      const strip = planner.next(measurements[i % measurements.length]);
      i += 1;
      expect(strip).not.toBeNull();
      for (const rect of strip!.rects) {
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.y).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.w).toBeLessThanOrEqual(rowPx);
        expect(rect.y + rect.h).toBeLessThanOrEqual(totalRows);
        for (let y = rect.y; y < rect.y + rect.h; y += 1) {
          for (let x = rect.x; x < rect.x + rect.w; x += 1) {
            covered[y * rowPx + x] += 1;
          }
        }
      }
    }

    expect(covered.every((count) => count === 1)).toBe(true);
    expect(planner.plannedPx).toBe(21);
  });

  it("reports plannedPx and totalPx as strips are handed out", () => {
    const planner = createStripPlanner(720, 1280, { priorMsPerPx: 10 });
    expect(planner.totalPx).toBe(921600);
    expect(planner.plannedPx).toBe(0);

    const probe = planner.next(null)!;
    expect(planner.plannedPx).toBe(probe.px);

    const second = planner.next(1)!;
    expect(planner.plannedPx).toBe(probe.px + second.px);
  });

  it("is done immediately for a zero totalRows", () => {
    const planner = createStripPlanner(0, 1280);
    expect(planner.done).toBe(true);
    expect(planner.next(null)).toBeNull();
  });

  it("is done immediately for a negative totalRows", () => {
    const planner = createStripPlanner(-5, 1280);
    expect(planner.done).toBe(true);
    expect(planner.next(null)).toBeNull();
  });

  it("is done immediately for a zero rowPx", () => {
    const planner = createStripPlanner(720, 0);
    expect(planner.done).toBe(true);
    expect(planner.totalPx).toBe(0);
    expect(planner.next(null)).toBeNull();
  });

  it("floors a fractional totalRows before tiling", () => {
    const rowPx = 10;
    const flooredRows = 10;
    const planner = createStripPlanner(10.9, rowPx);
    const covered = new Array<number>(flooredRows * rowPx).fill(0);
    let measurement: number | null = null;
    while (!planner.done) {
      const strip = planner.next(measurement);
      expect(strip).not.toBeNull();
      for (const rect of strip!.rects) {
        for (let y = rect.y; y < rect.y + rect.h; y += 1) {
          for (let x = rect.x; x < rect.x + rect.w; x += 1) {
            covered[y * rowPx + x] += 1;
          }
        }
      }
      measurement = 0.001;
    }

    expect(covered.every((count) => count === 1)).toBe(true);
    expect(planner.totalPx).toBe(100);
  });

  it("caps every strip's worst-case predicted cost, growth included", () => {
    // Fold-class cap: floor(2000/10) = 200px. A cheap measured region
    // (0.02ms/px) would size strips toward 3750px by target and 8x growth
    // — but any of those pixels could land in the frame's expensive band
    // at the worst-case price, so the cap pins them at 200px (~2s worst).
    const capPx = Math.floor(
      STRIP_WORST_CASE_CAP_MS / STRIP_FOLD_WORST_MS_PER_PX,
    );
    const planner = createStripPlanner(720, 1280, {
      priorMsPerPx: 0.02,
      worstMsPerPx: STRIP_FOLD_WORST_MS_PER_PX,
    });
    expect(planner.next(null)!.px).toBe(capPx);
    expect(planner.next(0.001)!.px).toBe(capPx);
    expect(planner.next(4)!.px).toBe(capPx);
  });

  it("caps the affine class loosely enough to leave the legacy probe alone", () => {
    // The affine cap (STRIP_WORST_CASE_CAP_MS / 0.1 = 40000px) sits far
    // above the 3840px legacy probe, so cheap systems keep their legacy
    // behavior; a growth-ballooned strip feels whichever binds first, the
    // growth cap or the worst-case cap.
    const capPx = Math.floor(
      STRIP_WORST_CASE_CAP_MS / STRIP_AFFINE_WORST_MS_PER_PX,
    );
    expect(capPx).toBeGreaterThan(3840);
    const planner = createStripPlanner(720, 1280, {
      worstMsPerPx: STRIP_AFFINE_WORST_MS_PER_PX,
    });
    expect(planner.next(null)).toEqual({
      px: 3840,
      rects: [{ x: 0, y: 0, w: 1280, h: 3 }],
    });
    expect(planner.next(0.001)!.px).toBe(Math.min(3840 * 8, capPx));
  });

  it("ratchets the cap down as measurements reveal worse pixels mid-job", () => {
    // Fold floor 50ms/px -> initial cap floor(4000/50) = 80px; the probe
    // (prior-sized 3750px) is capped there.
    const planner = createStripPlanner(720, 1280, {
      priorMsPerPx: 0.02,
      worstMsPerPx: 50,
    });
    expect(planner.next(null)!.px).toBe(80);
    // The 80px strip measures 40s -> 500ms/px observed: the cap collapses
    // to floor(4000/500) = 8px, and the cap is what the strip becomes.
    // The model asks for STRIP_WORK_PER_FIXED_COST * STRIP_COST_PIVOT_PX
    // -- it cannot tell a monster pose from an overhead-bound batch, by
    // construction (see nextStripCost's identity note) -- and the RAW
    // ms/px ratchet, which the model deliberately does not feed,
    // overrules it. Pre-fr-ado7 this read 1px: the same cap arithmetic
    // reached by a sizer that also charged the fixed cost to the pixels.
    expect(planner.next(40_000)!.px).toBe(8);
    expect(planner.observedWorstMsPerPx).toBe(500);
    // A worse per-pixel batch ratchets further: 8000ms over those 8px is
    // 1000ms/px, halving the cap again.
    expect(planner.next(8000)!.px).toBe(4);
    expect(planner.observedWorstMsPerPx).toBe(1000);
    // ...and a suspiciously-fast measurement cannot re-grow past the
    // ratcheted cap: model, growth and floor all ask for more, the cap
    // holds 4.
    expect(planner.next(0.001)!.px).toBe(4);
  });

  it("leaves strips uncapped when no worst-case price is given", () => {
    const planner = createStripPlanner(720, 1280);
    planner.next(null); // 3840px legacy probe
    // 8x growth would exceed any class cap; with no worstMsPerPx it
    // stands.
    expect(planner.next(0.001)!.px).toBe(3840 * 8);
  });

  it("sizes a fold-prior probe within one strip target of predicted cost", () => {
    const planner = createStripPlanner(720, 1280, {
      priorMsPerPx: STRIP_FOLD_PRIOR_MS_PER_PX,
    });
    // STRIP_FOLD_PRIOR_MS_PER_PX is exported and, used as the prior, must
    // still land the probe within one pixel's rounding of one strip target
    // of PREDICTED cost (probePx * prior) -- never blow past it.
    expect(planner.probePx * STRIP_FOLD_PRIOR_MS_PER_PX).toBeLessThanOrEqual(
      STRIP_TARGET_MS + STRIP_FOLD_PRIOR_MS_PER_PX,
    );
  });

  it("observe() ratchets observedWorstMsPerPx from a direct measurement", () => {
    const planner = createStripPlanner(720, 1280, {
      priorMsPerPx: 10,
      worstMsPerPx: 50,
    });
    planner.observe(3000, 2); // 3000 / 2 = 1500 ms/px
    expect(planner.observedWorstMsPerPx).toBe(1500);
  });

  it("observe() tightens the worst-case cap for the very next strip", () => {
    const planner = createStripPlanner(720, 1280, {
      priorMsPerPx: 10,
      worstMsPerPx: 50,
    });
    planner.next(null); // 8px probe (round(75/10))
    planner.observe(3200, 8); // 3200/8 = 400 ms/px, reported at measurement time
    // cap = floor(STRIP_WORST_CASE_CAP_MS / max(50, 400)) = floor(4000/400)
    // = 10px. The cheap prevMs would otherwise grow the strip 8x to 64px
    // (and its own ratchet contribution 0.001/8 is negligible) -- the
    // observe()d price wins.
    expect(planner.next(0.001)!.px).toBe(10);
  });

  it("closes the last-measurement gap: next() is deaf after done, observe() is not", () => {
    // 1 row x 4px with a 10ms/px prior: probe = min(legacy 4px,
    // round(75/10)=8) = 4px = the whole frame -- a one-strip job.
    const planner = createStripPlanner(1, 4, {
      priorMsPerPx: 10,
      worstMsPerPx: 50,
    });
    planner.next(null);
    expect(planner.done).toBe(true);
    // The sizing door early-returns once every pixel is planned -- the
    // final strip's measurement handed to next() is silently dropped...
    expect(planner.next(8000)).toBeNull();
    expect(planner.observedWorstMsPerPx).toBe(0);
    // ...the measurement door still ratchets (fr-24to's safety half): the
    // evidence chain a completed job feeds must include its OWN last strip.
    planner.observe(8000, 4); // 8000 / 4 = 2000 ms/px
    expect(planner.observedWorstMsPerPx).toBe(2000);
  });

  it("observe() only ever ratchets up: a later cheap measurement never lowers it", () => {
    const planner = createStripPlanner(720, 1280, {
      priorMsPerPx: 10,
      worstMsPerPx: 50,
    });
    planner.observe(100, 1); // 100 ms/px
    planner.observe(1, 1); // 1 ms/px -- cheaper, must not relax
    expect(planner.observedWorstMsPerPx).toBe(100);
  });

  it("observe() ignores empty measurements", () => {
    const planner = createStripPlanner(720, 1280, {
      priorMsPerPx: 10,
      worstMsPerPx: 50,
    });
    planner.observe(0, 5); // zero ms is not a measurement
    planner.observe(5, 0); // zero px is not a measurement
    expect(planner.observedWorstMsPerPx).toBe(0);
  });
});

/** Drive a planner the way scene.ts's pipelined pump does — plan a strip,
 * measure it against a cost FUNCTION, report the measurement — and return
 * the sizes it planned. `costMs(px)` is the caller's stack, not the
 * planner's model: `fixed + px * perPx` is what a fence batch actually
 * measures (the sync point, the draw setup and one caller tick, plus the
 * real trace work). */
function runSizes(
  planner: ReturnType<typeof createStripPlanner>,
  steps: number,
  costMs: (px: number) => number,
): number[] {
  const sizes: number[] = [];
  let prevMs: number | null = null;
  for (let i = 0; i < steps; i += 1) {
    const strip = planner.next(prevMs);
    if (!strip) break;
    sizes.push(strip.px);
    prevMs = costMs(strip.px);
  }
  return sizes;
}

/** A FROZEN COPY of the pre-fr-ado7 sizer — one number, `px * min(target
 * / prevMs, STRIP_MAX_GROWTH)`, floored at 1px, under the same probe,
 * worst-case cap and row-snap the planner still has. Kept executable so
 * "ordinary frames are unmoved" is a comparison rather than a memory
 * (`escape-de.test.ts` pins fr-kltj's loop the same way). */
function runLegacySizes(
  rows: number,
  width: number,
  options: {
    priorMsPerPx?: number | null;
    worstMsPerPx?: number | null;
    targetMs?: number;
  },
  steps: number,
  costMs: (px: number) => number,
): number[] {
  const targetMs = options.targetMs ?? STRIP_TARGET_MS;
  const prior = options.priorMsPerPx ?? null;
  const worstFloor = options.worstMsPerPx ?? null;
  const totalPx = rows * width;
  let observedWorst = 0;
  const capPx = (): number => {
    const worst =
      worstFloor !== null && worstFloor > 0
        ? Math.max(worstFloor, observedWorst)
        : 0;
    return worst > 0
      ? Math.max(1, Math.floor(STRIP_WORST_CASE_CAP_MS / worst))
      : Infinity;
  };
  const legacyProbePx = Math.min(
    totalPx,
    Math.max(1, Math.round(rows / 256)) * width,
  );
  const probePx = Math.min(
    prior !== null && prior > 0
      ? Math.min(legacyProbePx, Math.max(1, Math.round(targetMs / prior)))
      : legacyProbePx,
    capPx(),
  );
  const sizes: number[] = [];
  let planned = 0;
  let lastPx = 0;
  for (let i = 0; i < steps && planned < totalPx; i += 1) {
    let prevMs: number | null = null;
    if (lastPx > 0) {
      prevMs = costMs(lastPx);
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
    if (px >= width && width > 0) {
      const rem = (planned + px) % width;
      if (rem !== 0 && px - rem >= width) px -= rem;
    }
    planned += px;
    lastPx = px;
    sizes.push(px);
  }
  return sizes;
}

describe("createStripPlanner cost model (fr-ado7)", () => {
  it("cannot be driven into the 1px absorbing state by fixed-cost-dominated batches", () => {
    // fr-kz2p's measured shape: a near-empty frame whose batches cost
    // 500ms of WALL regardless of their pixel count (a fence sync plus one
    // yielding-drain tick), over pixels that are essentially free. The old
    // single-number sizer read 500ms/1px as genuine per-pixel cost, asked
    // for less, and could never grow back -- strips collapsed 990 -> ... ->
    // 1 and oscillated at 1-6px for the rest of a 480s export.
    const planner = createStripPlanner(720, 1280, {
      worstMsPerPx: STRIP_AFFINE_WORST_MS_PER_PX,
    });
    const sizes = runSizes(planner, 12, (px) => 500 + px * 0.0002);

    // It SETTLES rather than ratcheting: the tail is one repeated width,
    // and that width is at least what the fixed-cost branch names
    // (STRIP_WORK_PER_FIXED_COST x the pivot), which is the floor no
    // measurement can walk the model below once the intercept dominates.
    const tail = sizes.slice(-4);
    expect(new Set(tail).size).toBe(1);
    expect(tail[0]).toBeGreaterThanOrEqual(
      STRIP_WORK_PER_FIXED_COST * stripCostPivotPx(STRIP_TARGET_MS),
    );
    expect(tail[0]).toBeGreaterThan(4 * STRIP_MIN_PX);
    // The old sizer's answer for the same sequence, for scale: 1px, i.e.
    // one submission per pixel of the frame.
    expect(921_600 / tail[0]).toBeLessThan(921_600 / 100);
  });

  it("recovers strip size after the fixed cost has already driven it to the floor", () => {
    // The escape half of the same property: start from a planner the
    // caller has ALREADY beaten down (a burst of ruinous measurements),
    // then feed it the fixed-cost-dominated batches the old sizer could
    // not climb out of, and watch it climb.
    const planner = createStripPlanner(720, 1280, {
      priorMsPerPx: STRIP_FOLD_PRIOR_MS_PER_PX,
    });
    const collapsed = runSizes(planner, 4, (px) => 5000 * px);
    expect(Math.min(...collapsed)).toBeLessThanOrEqual(STRIP_MIN_PX);

    const recovered = runSizes(planner, 10, (px) => 500 + px * 0.0002);
    expect(recovered[recovered.length - 1]).toBeGreaterThan(
      collapsed[collapsed.length - 1] * 4,
    );
    expect(recovered[recovered.length - 1]).toBeGreaterThanOrEqual(
      STRIP_MIN_PX,
    );
  });

  it("splits a measurement's surprise by width: narrow batches charge the intercept", () => {
    // Both batches measure the same 500ms. Their RAW per-pixel averages
    // differ by 4096x (500 vs 0.122 ms/px) -- which is the number the old
    // sizer used -- while the model's marginals differ by ~9x, because a
    // 1px batch cannot speak about per-pixel cost and a 4096px one can.
    const pivotPx = stripCostPivotPx(STRIP_TARGET_MS); // 125px
    const narrow = nextStripCost(initialStripCost(), 1, 500, pivotPx);
    const wide = nextStripCost(initialStripCost(), 4096, 500, pivotPx);

    // The narrow batch's cost lands almost entirely on the intercept, and
    // its marginal is ~500x BELOW the raw ms/px the batch would imply.
    expect(narrow.interceptMs).toBeGreaterThan(0.98 * 500);
    expect(narrow.marginalMsPerPx).toBeLessThan(500 / 100);
    // The wide batch's does the opposite: most of it is per-pixel, and the
    // marginal lands within 15% of the raw ms/px.
    expect(wide.interceptMs).toBeLessThan(0.15 * 500);
    expect(wide.marginalMsPerPx).toBeGreaterThan(0.85 * (500 / 4096));
    expect(wide.marginalMsPerPx).toBeLessThan(1.15 * (500 / 4096));
  });

  it("keeps the worst-case cap ahead of the sane-unit floor when they conflict", () => {
    // fr-096u's precedence, written as a test so nobody re-orders the
    // clamp: a genuinely expensive band prices the cap below STRIP_MIN_PX
    // and the CAP wins -- an unbounded strip draw is a kernel-confirmed
    // i915 preemption hang, and a slow export is not worth one.
    const worstMsPerPx = STRIP_WORST_CASE_CAP_MS / (STRIP_MIN_PX / 4);
    const planner = createStripPlanner(720, 1280, {
      priorMsPerPx: 1,
      worstMsPerPx,
    });
    const capPx = Math.floor(STRIP_WORST_CASE_CAP_MS / worstMsPerPx);
    expect(capPx).toBeLessThan(STRIP_MIN_PX);

    // Cheap measurements, so the model and the floor both ask for far
    // more than the cap allows.
    const sizes = runSizes(planner, 6, () => 0.001);
    expect(Math.max(...sizes)).toBe(capPx);
  });

  it.each([
    [
      "healthy fold settle",
      720,
      1280,
      0.05,
      null,
      75,
      (px: number) => 5 + px * 0.05,
    ],
    [
      "cheap affine settle",
      720,
      1280,
      null,
      0.1,
      75,
      (px: number) => 1 + px * 0.002,
    ],
    [
      "fold settle at the class cap",
      720,
      1280,
      10,
      50,
      75,
      (px: number) => 2 + px * 0.3,
    ],
    [
      "settle behind a 5x-optimistic preview prior",
      720,
      1280,
      0.1,
      0.5,
      75,
      (px: number) => 2 + px * 0.5,
    ],
    [
      "light preview tier",
      216,
      384,
      0.02,
      0.1,
      12,
      (px: number) => 2 + px * 0.02,
    ],
  ])(
    "sizes %s within a few percent of the pre-fr-ado7 sizer",
    (_name, rows, width, prior, worst, targetMs, costMs) => {
      // The near-no-op requirement, measured against a FROZEN COPY of the
      // old sizer below rather than against remembered numbers -- the
      // escape-de.test.ts idiom. The stacks are ordinary ones: a small
      // residual fixed cost per batch (scene.ts subtracts
      // SURFACE_STRIP_SYNC_TAX_MS before reporting) over real per-pixel
      // trace work, across both tiers and all three probe regimes.
      const options = { priorMsPerPx: prior, worstMsPerPx: worst, targetMs };
      const sizes = runSizes(
        createStripPlanner(rows, width, options),
        14,
        costMs,
      );
      const legacy = runLegacySizes(rows, width, options, 14, costMs);

      // Same probe (the prior sizes it, not the model), and the same
      // converged strip: the fixed point where a strip measures exactly
      // targetMs is identical under the two sizers, which is what makes
      // this a calibration fix rather than a retuning.
      expect(sizes[0]).toBe(legacy[0]);
      const mean = (xs: number[]): number =>
        xs.reduce((a, b) => a + b, 0) / xs.length;
      expect(mean(sizes.slice(-4))).toBeGreaterThan(
        0.9 * mean(legacy.slice(-4)),
      );
      expect(mean(sizes.slice(-4))).toBeLessThan(1.1 * mean(legacy.slice(-4)));
      // And it gets there without a detour. The band is 25% rather than
      // 10% for one measured reason: where the probe prior is optimistic
      // the two-term sizer HUNTS around the converged width for a few
      // strips (+-15%) where the one-number sizer walked straight in --
      // the price of splitting one measurement between two terms, paid in
      // strips that are never more than a quarter off target.
      for (let i = 0; i < sizes.length; i += 1) {
        expect(sizes[i]).toBeGreaterThan(0.75 * legacy[i]);
        expect(sizes[i]).toBeLessThan(1.25 * legacy[i]);
      }
    },
  );

  it("overshoots the target on a preview whose strips are narrower than the pivot", () => {
    // THE KNOWN REGRESSION, pinned so it cannot drift unnoticed. Where a
    // scene's natural strip is far below the pivot, the split reads its
    // measurements as mostly fixed cost and the sizer stops tracking
    // targetMs: a 4ms/px preview (fr-du81 measured ~6ms/px on SwiftShader,
    // so this is a real tier) converges at the class cap instead of at
    // ~3px. Bounded on both sides -- STRIP_MIN_PX below, the worst-case
    // cap above -- so it costs interruption granularity, never watchdog
    // headroom. Identification needs two widths and the sizer visits one;
    // see nextStripCost's identity note.
    const costMs = (px: number): number => 1 + px * 4;
    const options = {
      priorMsPerPx: 20,
      worstMsPerPx: STRIP_FOLD_WORST_MS_PER_PX,
      targetMs: 12,
    };
    const sizes = runSizes(createStripPlanner(216, 384, options), 14, costMs);
    const legacy = runLegacySizes(216, 384, options, 14, costMs);

    expect(legacy[legacy.length - 1]).toBeLessThan(8); // ~3px, on target
    const capPx = Math.floor(
      STRIP_WORST_CASE_CAP_MS / STRIP_FOLD_WORST_MS_PER_PX,
    );
    expect(sizes[sizes.length - 1]).toBeGreaterThan(STRIP_MIN_PX);
    expect(sizes[sizes.length - 1]).toBeLessThanOrEqual(capPx);
  });

  it("preserves intercept = pivot * marginal, so no sizing rule may read the intercept alone", () => {
    // The identity nextStripCost's doc proves, pinned: it is why the
    // fixed-cost branch's answer is a constant width no measurement can
    // walk down, and why the worst-case cap has to stay off this model.
    const pivotPx = stripCostPivotPx(STRIP_TARGET_MS);
    let cost = initialStripCost();
    for (const [px, ms] of [
      [1024, 1000],
      [1024, 900],
      [64, 200],
      [2048, 1600],
    ] as [number, number][]) {
      cost = nextStripCost(cost, px, ms, pivotPx);
      expect(cost.interceptMs / cost.marginalMsPerPx).toBeCloseTo(pivotPx, 3);
    }
  });

  it("rate-limits the marginal's RISE, the direction that shrinks strips", () => {
    const pivotPx = stripCostPivotPx(STRIP_TARGET_MS);
    const cost = { interceptMs: pivotPx, marginalMsPerPx: 1 };
    // A 50x cost step at a width the split attributes mostly to pixels
    // would lift the marginal ~50x in one go; the limit holds it to a
    // doubling, so strips halve per measurement instead of collapsing.
    const spiked = nextStripCost(cost, 4096, 50 * (pivotPx + 4096), pivotPx);
    expect(spiked.marginalMsPerPx).toBe(
      cost.marginalMsPerPx * STRIP_COST_MARGINAL_RISE,
    );
    // The FALL is not limited: re-earning a cheap region is the direction
    // with two other bounds on it (growth cap, worst-case cap).
    const dropped = nextStripCost(cost, 4096, 0, pivotPx);
    expect(dropped.marginalMsPerPx).toBeLessThan(cost.marginalMsPerPx * 0.5);
  });

  it("lets the first measurement establish the marginal's scale from zero", () => {
    // A multiplicative rise limit off a zero marginal would pin it at zero
    // for the rest of the job, and stripModelPx would read "pixels are
    // free" forever.
    const first = nextStripCost(
      initialStripCost(),
      1024,
      1000,
      stripCostPivotPx(STRIP_TARGET_MS),
    );
    expect(first.marginalMsPerPx).toBeGreaterThan(0);
  });

  it("sizes from the marginal alone, never from a batch average", () => {
    // 900ms over 900px is 1ms/px as a batch average, and dividing the
    // target by that -- the pre-fr-ado7 sizer -- asks for 75px. The
    // model's marginal says otherwise: a good part of that batch was its
    // intercept, so the same measurement buys a materially wider strip.
    const cost = nextStripCost(
      initialStripCost(),
      900,
      900,
      stripCostPivotPx(STRIP_TARGET_MS),
    );
    expect(stripModelPx(cost, STRIP_TARGET_MS)).toBeGreaterThan(1.5 * 75);
  });

  it("spends the target when the fixed cost is small and proportion when it is not", () => {
    // Below the knee the allowance is the room left inside the target --
    // ordinary frames live here, which is why they are unmoved.
    expect(stripAllowanceMs(5, STRIP_TARGET_MS)).toBe(STRIP_TARGET_MS - 5);
    // Above it, aiming at a total the fixed cost already exceeds is what
    // walked the old sizer to 1px, so the strip buys work in proportion to
    // the fixed cost it is paying anyway.
    expect(stripAllowanceMs(500, STRIP_TARGET_MS)).toBe(
      STRIP_WORK_PER_FIXED_COST * 500,
    );
  });

  it("reports free pixels as an unbounded model size for the caps to bound", () => {
    expect(
      stripModelPx({ interceptMs: 400, marginalMsPerPx: 0 }, STRIP_TARGET_MS),
    ).toBe(Number.POSITIVE_INFINITY);
  });

  it("exposes the model so the caller can price its own queue by the marginal", () => {
    const planner = createStripPlanner(720, 1280, { priorMsPerPx: 10 });
    expect(planner.cost).toEqual({ interceptMs: 0, marginalMsPerPx: 0 });
    planner.observe(500, 1000);
    expect(planner.cost.marginalMsPerPx).toBeGreaterThan(0);
    // ...and well under the 0.5ms/px batch average, which is the whole
    // difference between a queue that stays a pipeline and one that
    // collapses to a strip at a time.
    expect(planner.cost.marginalMsPerPx).toBeLessThan(0.5);
  });

  it("does not fold a prior-sized probe into the model as if it were measured", () => {
    // A repeat call with no measurement must leave the model empty and
    // repeat the PRIOR's size -- flooring an unmeasured strip at
    // STRIP_MIN_PX would be a 32x jump past the one pessimistic bound
    // standing over a submission nothing has timed (fr-096u).
    const planner = createStripPlanner(720, 1280, { priorMsPerPx: 10 });
    expect(planner.next(null)!.px).toBe(8);
    expect(planner.next(null)!.px).toBe(8);
    expect(planner.cost).toEqual({ interceptMs: 0, marginalMsPerPx: 0 });
  });
});
