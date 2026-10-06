import {
  MOTION_CLIP_DEFAULT_SECONDS,
  MOTION_CLIP_MAX_SECONDS,
  MOTION_CLIP_MIN_SECONDS,
  MOTION_EXPORT_FPS,
  motionClipFrameCount,
  resolveMotionClip,
  resolveMotionExportFps,
  waitForFlameFrame,
} from "./motion-export";

describe("resolveMotionExportFps", () => {
  it("falls back to the shipped rate on absence or garbage", () => {
    expect(resolveMotionExportFps(null)).toBe(MOTION_EXPORT_FPS);
    expect(resolveMotionExportFps("")).toBe(MOTION_EXPORT_FPS);
    expect(resolveMotionExportFps("abc")).toBe(MOTION_EXPORT_FPS);
    expect(resolveMotionExportFps("0")).toBe(MOTION_EXPORT_FPS);
    expect(resolveMotionExportFps("61")).toBe(MOTION_EXPORT_FPS);
    expect(resolveMotionExportFps("-2")).toBe(MOTION_EXPORT_FPS);
  });

  it("accepts the gate's low rates, which is how a 2-3 frame clip gets recorded", () => {
    expect(resolveMotionExportFps("1")).toBe(1);
    expect(resolveMotionExportFps("2")).toBe(2);
    expect(resolveMotionExportFps("60")).toBe(60);
  });
});

describe("resolveMotionClip", () => {
  it("records the tumble in a non-flat Flame session", () => {
    expect(resolveMotionClip("flame", true)).toEqual({
      ok: true,
      kind: "tumble",
    });
  });

  it("records the tumble in a non-flat Surface session", () => {
    expect(resolveMotionClip("surface", true)).toEqual({
      ok: true,
      kind: "tumble",
    });
  });

  it("records the auto-orbit turntable in a flat Flame session", () => {
    expect(resolveMotionClip("flame", false)).toEqual({
      ok: true,
      kind: "orbit",
    });
  });

  it("records the auto-orbit turntable in a flat Surface session", () => {
    expect(resolveMotionClip("surface", false)).toEqual({
      ok: true,
      kind: "orbit",
    });
  });

  it("refuses Points with the enter-a-render-mode reason", () => {
    const plan = resolveMotionClip("points", true);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toMatch(/Flame or Surface/);
  });

  it("refuses Solid as not supported yet", () => {
    const plan = resolveMotionClip("solid", true);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toMatch(/Solid/);
  });

  it("refuses Points symmetrically in both dimensions", () => {
    expect(resolveMotionClip("points", false).ok).toBe(false);
  });
});

describe("motionClipFrameCount", () => {
  it("ceil-rounds the authored duration × fps", () => {
    // 2.1s at 30fps is 63 frames exactly; a fractional duration rounds up
    // so the clip is never SHORTER than authored.
    expect(motionClipFrameCount(2.1, 30, 1000)).toBe(63);
    expect(motionClipFrameCount(1.01, 30, 1000)).toBe(31);
  });

  it("caps at the recorder-parity frame budget", () => {
    expect(motionClipFrameCount(MOTION_CLIP_MAX_SECONDS, 30, 900)).toBe(900);
  });

  it("never underflows or returns negative on a degenerate duration", () => {
    expect(motionClipFrameCount(0, 30, 900)).toBe(0);
    expect(motionClipFrameCount(-5, 30, 900)).toBe(0);
  });

  it("fits the default clip inside the slider domain at 30fps", () => {
    const frames = motionClipFrameCount(
      MOTION_CLIP_DEFAULT_SECONDS,
      MOTION_EXPORT_FPS,
      Number.MAX_SAFE_INTEGER,
    );
    expect(frames).toBe(MOTION_CLIP_DEFAULT_SECONDS * MOTION_EXPORT_FPS);
    expect(MOTION_CLIP_MIN_SECONDS).toBeLessThan(MOTION_CLIP_DEFAULT_SECONDS);
    expect(MOTION_CLIP_DEFAULT_SECONDS).toBeLessThan(MOTION_CLIP_MAX_SECONDS);
  });
});

describe("waitForFlameFrame", () => {
  /** A scripted flag + a signal queue: `push` resolves one pending waiter
   * (a render-progress event landing), each `await` of the helper's
   * nextSignal parks until the next push. */
  function makeSignals(): {
    nextSignal: () => Promise<void>;
    push: () => void;
    pending: () => number;
  } {
    const waiters: (() => void)[] = [];
    return {
      nextSignal: () =>
        new Promise<void>((resolve) => {
          waiters.push(resolve);
        }),
      push: () => {
        const wake = waiters.shift();
        if (wake) wake();
      },
      pending: () => waiters.length,
    };
  }

  it("consumes the stale budget-met, then waits for the restart's zeroing and the new frame's budget", async () => {
    const { nextSignal, push } = makeSignals();
    let complete = true; // frame i−1 finished before the commit.
    const stopped = false;
    const run = waitForFlameFrame(
      () => complete,
      nextSignal,
      () => stopped,
    );
    // Phase 1 is parked on the stale true, waiting for the restart.
    await Promise.resolve();
    push(); // a stale chunk lands (still budget-met — ignored by phase 1).
    await Promise.resolve();
    push(); // the worker's restarted event lands: the flag zeroes.
    complete = false;
    await Promise.resolve();
    // Phase 2 is now parked on the new accumulation.
    push(); // an early chunk (not yet budget-met).
    await Promise.resolve();
    complete = true; // the new frame's budget met.
    push();
    expect(await run).toBe(true);
  });

  it("enters phase 2 directly when the session was mid-convergence at commit (frame 0)", async () => {
    const { nextSignal, push } = makeSignals();
    let complete = false; // the pre-commit accumulation never finished.
    const run = waitForFlameFrame(
      () => complete,
      nextSignal,
      () => false,
    );
    await Promise.resolve();
    // No restart-zeroing is owed — the discarded accumulation cannot reach
    // budget; the first true is this frame's.
    complete = true;
    push();
    expect(await run).toBe(true);
  });

  it("returns false instead of hanging when the run stops mid-wait", async () => {
    const { nextSignal, push, pending } = makeSignals();
    let stopped = false;
    const complete = true;
    const run = waitForFlameFrame(
      () => complete,
      nextSignal,
      () => stopped,
    );
    await Promise.resolve();
    stopped = true;
    push();
    expect(await run).toBe(false);
    // The phase-1 waiter was consumed by the wake; nothing is parked.
    expect(pending()).toBe(0);
  });

  it("survives an extra restart landing during phase 2 (a mid-frame OOM ratchet)", async () => {
    const { nextSignal, push } = makeSignals();
    let complete = false;
    const run = waitForFlameFrame(
      () => complete,
      nextSignal,
      () => false,
    );
    await Promise.resolve();
    // Already mid-phase-2 (frame 0's session): a restarted event arrives
    // again (flag stays false), then the retry's chunks reach budget.
    complete = true;
    push();
    expect(await run).toBe(true);
  });
});
