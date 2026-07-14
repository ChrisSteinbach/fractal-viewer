import {
  MORPH_DENSE_FACTOR,
  MORPH_FRAME_BUDGET_MS,
  MORPH_MIN_POINTS,
  MORPH_UNCALIBRATED_POINTS,
  MorphBudget,
} from "./morph-budget";
import { MORPH_MAX_POINTS } from "./constants";

describe("MorphBudget", () => {
  it("budgets the conservative uncalibrated cap before any measurement", () => {
    const budget = new MorphBudget();
    expect(budget.budget(5_000_000, "adaptive")).toBe(
      MORPH_UNCALIBRATED_POINTS,
    );
  });

  it("never asks for more than the scene's own point count", () => {
    const budget = new MorphBudget();
    expect(budget.budget(30_000, "adaptive")).toBe(30_000);

    // Calibrated fast enough for millions — a small scene still stays exact.
    budget.note(1, 400_000);
    expect(budget.budget(30_000, "adaptive")).toBe(30_000);
  });

  it("sizes the budget to one frame's worth of the measured per-point cost", () => {
    const budget = new MorphBudget();
    // 100 ms for 400k points = 0.00025 ms/point; one 14 ms frame buys 56k.
    budget.note(100, 400_000);
    expect(budget.budget(5_000_000, "adaptive")).toBe(
      Math.round(MORPH_FRAME_BUDGET_MS / (100 / 400_000)),
    );
  });

  it("tracks a shifting cost with an EMA rather than trusting one sample", () => {
    const budget = new MorphBudget();
    budget.note(100, 400_000); // 0.00025 ms/point
    const calibrated = budget.budget(5_000_000, "adaptive");

    // One GC-spiked sample (4x the cost) dents the budget but doesn't
    // crater it to a quarter.
    budget.note(400, 400_000);
    const dented = budget.budget(5_000_000, "adaptive");
    expect(dented).toBeLessThan(calibrated);
    expect(dented).toBeGreaterThan(calibrated / 4);

    // Repeated fast samples converge back up.
    for (let i = 0; i < 20; i++) budget.note(100, 400_000);
    expect(budget.budget(5_000_000, "adaptive")).toBeCloseTo(calibrated, -3);
  });

  it("clamps a slow device to the point floor instead of a dust sketch", () => {
    const budget = new MorphBudget();
    // 200 ms for 20k points: a frame budget buys only 1.4k — floor wins.
    budget.note(200, 20_000);
    expect(budget.budget(5_000_000, "adaptive")).toBe(MORPH_MIN_POINTS);
  });

  it("clamps a fast device to the intermediate ceiling", () => {
    const budget = new MorphBudget();
    // 1 ms for 400k points: a frame budget would buy 5.6M — ceiling wins.
    budget.note(1, 400_000);
    expect(budget.budget(5_000_000, "adaptive")).toBe(MORPH_MAX_POINTS);
  });

  it("scales a dense budget to several frames' worth of points", () => {
    const budget = new MorphBudget();
    // 100 ms for 400k points = 0.00025 ms/point; one 14 ms frame buys 56k,
    // so dense buys MORPH_DENSE_FACTOR frames' worth.
    budget.note(100, 400_000);
    expect(budget.budget(5_000_000, "dense")).toBe(
      Math.round(
        (MORPH_FRAME_BUDGET_MS * MORPH_DENSE_FACTOR) / (100 / 400_000),
      ),
    );
  });

  it("raises the intermediate ceiling by the same dense factor", () => {
    const budget = new MorphBudget();
    // 1 ms for 400k points: adaptive pins to the 400k ceiling (see above);
    // dense gets the scaled ceiling instead of the same 400k.
    budget.note(1, 400_000);
    expect(budget.budget(5_000_000, "dense")).toBe(
      MORPH_MAX_POINTS * MORPH_DENSE_FACTOR,
    );
  });

  it("still never asks a dense morph for more than the scene's own count", () => {
    const budget = new MorphBudget();
    budget.note(1, 400_000);
    expect(budget.budget(30_000, "dense")).toBe(30_000);
  });

  it("runs a full-detail morph at the scene's own count, ignoring the estimate", () => {
    const budget = new MorphBudget();
    expect(budget.budget(5_000_000, "full")).toBe(5_000_000);

    // Even a device measured too slow for 5M per frame: full means full.
    budget.note(200, 20_000);
    expect(budget.budget(5_000_000, "full")).toBe(5_000_000);
  });

  it("ignores degenerate samples so they cannot poison the estimate", () => {
    const budget = new MorphBudget();
    budget.note(100, 400_000);
    const calibrated = budget.budget(5_000_000, "adaptive");

    budget.note(0, 400_000);
    budget.note(-5, 400_000);
    budget.note(Number.NaN, 400_000);
    budget.note(100, 0);
    budget.note(100, Number.NaN);

    expect(budget.budget(5_000_000, "adaptive")).toBe(calibrated);
  });
});
