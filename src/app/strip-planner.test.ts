import {
  createStripPlanner,
  STRIP_MAX_GROWTH,
  STRIP_PROBE_FRACTION,
  STRIP_TARGET_MS,
} from "./strip-planner";

describe("createStripPlanner", () => {
  it("plans the first strip as a probe starting at y 0", () => {
    const totalRows = 6400;
    const planner = createStripPlanner(totalRows);
    const probeRows = Math.max(1, Math.round(totalRows * STRIP_PROBE_FRACTION));
    expect(planner.next(null)).toEqual({ y: 0, rows: probeRows });
  });

  it("shrinks the next strip after a slow probe measurement", () => {
    const totalRows = 6400;
    const planner = createStripPlanner(totalRows);
    const probeRows = Math.max(1, Math.round(totalRows * STRIP_PROBE_FRACTION));
    planner.next(null);

    const measuredMs = 2000;
    const shrunkRows = Math.max(
      1,
      Math.round(probeRows * (STRIP_TARGET_MS / measuredMs)),
    );
    expect(planner.next(measuredMs)).toEqual({
      y: probeRows,
      rows: shrunkRows,
    });
  });

  it("grows the next strip after a fast measurement, capped at STRIP_MAX_GROWTH", () => {
    const totalRows = 6400;
    const planner = createStripPlanner(totalRows);
    const probeRows = Math.max(1, Math.round(totalRows * STRIP_PROBE_FRACTION));
    planner.next(null);

    // The raw ratio to STRIP_TARGET_MS would blow this strip up far past
    // totalRows; the remainder left after the probe is still well clear of
    // the capped size, so the growth cap — not the remaining rows — is what
    // limits this strip.
    expect(planner.next(0.001)).toEqual({
      y: probeRows,
      rows: probeRows * STRIP_MAX_GROWTH,
    });
  });

  it("repeats the previous strip size when a measurement is unavailable", () => {
    const totalRows = 6400;
    const planner = createStripPlanner(totalRows);
    const probeRows = Math.max(1, Math.round(totalRows * STRIP_PROBE_FRACTION));
    planner.next(null);
    expect(planner.next(null)).toEqual({ y: probeRows, rows: probeRows });
  });

  it("clamps strips to the remaining rows and tiles the whole frame exactly", () => {
    const totalRows = 64;
    const planner = createStripPlanner(totalRows);
    const strips: { y: number; rows: number }[] = [];
    let measurement: number | null = null;
    while (!planner.done) {
      const strip = planner.next(measurement);
      expect(strip).not.toBeNull();
      strips.push(strip!);
      // Very fast every time after the probe, so later strips are limited
      // by the growth cap and then by the remaining rows, not by timing.
      measurement = 0.001;
    }

    // done tracks next() running out of rows to hand out: once it flips
    // true, the following call returns null.
    expect(planner.next(measurement)).toBeNull();

    let y = 0;
    for (const strip of strips) {
      expect(strip.y).toBe(y);
      y += strip.rows;
    }
    expect(y).toBe(totalRows);
  });

  it("never returns strip rows below 1, even for an enormous measurement", () => {
    const totalRows = 6400;
    const planner = createStripPlanner(totalRows);
    const probeRows = Math.max(1, Math.round(totalRows * STRIP_PROBE_FRACTION));
    planner.next(null);
    expect(planner.next(1e9)).toEqual({ y: probeRows, rows: 1 });
  });

  it("is done immediately for a zero totalRows", () => {
    const planner = createStripPlanner(0);
    expect(planner.done).toBe(true);
    expect(planner.next(null)).toBeNull();
  });

  it("is done immediately for a negative totalRows", () => {
    const planner = createStripPlanner(-5);
    expect(planner.done).toBe(true);
    expect(planner.next(null)).toBeNull();
  });

  it("sizes strips against a custom targetMs when one is given", () => {
    const totalRows = 6400;
    const targetMs = 10;
    const planner = createStripPlanner(totalRows, targetMs);
    const probeRows = Math.max(1, Math.round(totalRows * STRIP_PROBE_FRACTION));
    planner.next(null);

    // A strip measuring exactly the custom target keeps its size — the
    // default 75ms target would have grown it 7.5x here.
    expect(planner.next(targetMs)).toEqual({ y: probeRows, rows: probeRows });
  });

  it("reports planned and total rows as strips are handed out", () => {
    const totalRows = 6400;
    const planner = createStripPlanner(totalRows);
    expect(planner.totalRows).toBe(totalRows);
    expect(planner.plannedRows).toBe(0);

    const probe = planner.next(null)!;
    expect(planner.plannedRows).toBe(probe.rows);

    const second = planner.next(1)!;
    expect(planner.plannedRows).toBe(probe.rows + second.rows);
  });

  it("floors a fractional totalRows before tiling", () => {
    const planner = createStripPlanner(10.9);
    const strips: { y: number; rows: number }[] = [];
    let measurement: number | null = null;
    while (!planner.done) {
      const strip = planner.next(measurement);
      expect(strip).not.toBeNull();
      strips.push(strip!);
      measurement = 0.001;
    }

    let y = 0;
    for (const strip of strips) {
      expect(strip.y).toBe(y);
      y += strip.rows;
    }
    expect(y).toBe(10);
  });
});
