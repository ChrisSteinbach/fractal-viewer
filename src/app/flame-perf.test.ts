import { FlamePerfMeter } from "./flame-perf";
import type { FlameChunkSample } from "./flame-perf";

describe("FlamePerfMeter", () => {
  it("emits a summary the moment the window fills, splitting the phases", () => {
    const meter = new FlamePerfMeter(100);

    const summary = meter.record({
      accumulateMs: 40,
      iterations: 2_000_000,
      readbackMs: 10,
      gapMs: 50,
      wallMs: 50,
      chunkSize: 2_000_000,
      backendKind: "gpu",
    });

    // wallMs + gapMs = 100 hits the 100 ms window on the first sample.
    expect(summary).not.toBeNull();
    expect(summary).toContain("[gpu]");
    expect(summary).toContain("eff 20.0 M iter/s"); // 2e6 iters / 100 ms => 20 M/s
    expect(summary).toContain("accum 50.0 M iter/s (40%)"); // 2e6 / 40 ms => 50 M/s; 40/100 => 40%
    expect(summary).toContain("readback 10%"); // 10/100
    expect(summary).toContain("gap 50%"); // 50/100
    expect(summary).toContain("other 0%"); // wall(50) - accum(40) - readback(10) = 0
    expect(summary).toContain("1 chunks");
    expect(summary).toContain("size 2.0M");
    expect(summary).toContain("100 ms");
  });

  it("returns null until the accumulated window is reached, then summarizes the whole window", () => {
    const meter = new FlamePerfMeter(100);
    const sample: FlameChunkSample = {
      accumulateMs: 20,
      iterations: 500_000,
      readbackMs: 0,
      gapMs: 10,
      wallMs: 20,
      chunkSize: 1_000_000,
      backendKind: "gpu",
    };

    expect(meter.record(sample)).toBeNull(); // elapsed 30
    expect(meter.record(sample)).toBeNull(); // elapsed 60
    expect(meter.record(sample)).toBeNull(); // elapsed 90
    const summary = meter.record(sample); // elapsed 120 >= 100 -> emit

    expect(summary).not.toBeNull();
    expect(summary).toContain("eff 16.7 M iter/s"); // 2e6 iters / 120 ms
    expect(summary).toContain("accum 25.0 M iter/s (67%)"); // 2e6 / 80 ms accumulate => 25 M/s; 80/120 => 67% (rounded)
    expect(summary).toContain("gap 33%"); // 40/120 => 33%
    expect(summary).toContain("readback 0%");
    expect(summary).toContain("4 chunks");
    expect(summary).toContain("size 1.0M");
    expect(summary).toContain("120 ms");
  });

  it("resets the window after emitting, so the next small sample returns null", () => {
    const meter = new FlamePerfMeter(100);
    const sample: FlameChunkSample = {
      accumulateMs: 20,
      iterations: 500_000,
      readbackMs: 0,
      gapMs: 10,
      wallMs: 20,
      chunkSize: 1_000_000,
      backendKind: "gpu",
    };

    meter.record(sample);
    meter.record(sample);
    meter.record(sample);
    meter.record(sample); // 4th call hits the 100 ms window and emits, resetting it

    expect(meter.record(sample)).toBeNull(); // fresh window: elapsed back to 30, under 100
  });

  it("shows an em-dash accumulate rate when no accumulate time was recorded, and the cpu tag", () => {
    const meter = new FlamePerfMeter(50);

    const summary = meter.record({
      accumulateMs: 0,
      iterations: 1_000_000,
      readbackMs: 0,
      gapMs: 50,
      wallMs: 0,
      chunkSize: 100_000,
      backendKind: "cpu",
    });

    expect(summary).not.toBeNull();
    expect(summary).toContain("[cpu]");
    expect(summary).toContain("accum — (0%)"); // accumulateMs 0 -> rate uncomputable -> em-dash; 0/50 => 0%
    expect(summary).toContain("eff 20.0 M iter/s"); // 1e6 / 50 ms
  });
});
