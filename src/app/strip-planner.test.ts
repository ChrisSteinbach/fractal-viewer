import {
  createStripPlanner,
  STRIP_AFFINE_WORST_MS_PER_PX,
  STRIP_FOLD_PRIOR_MS_PER_PX,
  STRIP_FOLD_WORST_MS_PER_PX,
  STRIP_TARGET_MS,
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

  it("shrinks the next strip toward targetMs after a slow measurement, floored at 1px", () => {
    const planner = createStripPlanner(720, 1280, { priorMsPerPx: 10 });
    planner.next(null); // 8px probe
    // round(75 / 1e9) rounds to 0; the 1px floor is what actually fires.
    expect(planner.next(1e9)).toEqual({
      px: 1,
      rects: [{ x: 8, y: 0, w: 1, h: 1 }],
    });
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
    // to 8px and target scaling itself asks for less.
    expect(planner.next(40_000)!.px).toBe(1);
    expect(planner.observedWorstMsPerPx).toBe(500);
    // A single 3s pixel raises the observation further...
    expect(planner.next(3000)!.px).toBe(1);
    expect(planner.observedWorstMsPerPx).toBe(3000);
    // ...and a suspiciously-fast measurement cannot re-grow past the
    // ratcheted cap: growth asks for 8px, the cap holds 1.
    expect(planner.next(0.001)!.px).toBe(1);
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
