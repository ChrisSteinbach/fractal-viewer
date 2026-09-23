import { completionFailures, traceFrames } from "./lib/finite-glass-trace.mjs";

const start = (sample: number, samples: number, token = 7) =>
  `[0ms] frame start sample=${sample} samples=${samples} token=${token} rays=10 marchSteps=160`;
const done =
  "[9ms] frame done passes=4 fences=2 truncated=false hit=4 miss=6 exhausted=0 active=0 plane=0";

describe("traceFrames over a sphere-inversion joint pool", () => {
  it("files each tagged tally and failure line under the earlier sample it names", () => {
    const frames = traceFrames([
      start(0, 2),
      "[5ms] transport deferred (joint pool)",
      done,
      start(1, 2),
      "[8ms] transport done final resolved=4 unresolved=0 (cumulative resolved=4 unresolved=0 invalid=0) passes=2",
      "[8ms] transport done final sample=0 resolved=3 unresolved=1 (cumulative resolved=3 unresolved=1 invalid=0) passes=3",
      "[8ms] transport failures sample=0 f2/r1=1",
      done,
    ]);
    const tallies = frames.map(
      (f) => f.tallies as unknown as { resolved: number }[],
    );
    expect(tallies.map((t) => t.map((tally) => tally.resolved))).toEqual([
      [3],
      [4],
    ]);
    expect(frames[0].failureClasses).toEqual({ "f2/r1": 1 });
    expect(frames[1].failureClasses).toEqual({});
    expect(frames.every((f) => f.completed)).toBe(true);
  });

  it("leaves a sample whose tag never arrives without its tally, so completion fails it", () => {
    const frames = traceFrames([
      start(0, 2),
      "[5ms] transport deferred (joint pool)",
      done,
      start(1, 2),
      "[8ms] transport done final resolved=4 unresolved=0 (cumulative resolved=4 unresolved=0 invalid=0) passes=2",
      "[8ms] transport done final sample=5 resolved=4 unresolved=0 (cumulative resolved=4 unresolved=0 invalid=0) passes=2",
      done,
    ]);
    expect(completionFailures(frames, 2, 10)).toContain(
      "sample 0: expected exactly one final transport tally",
    );
  });
});
