/**
 * "Watch it build" replay controller (fr-1zb): a pure timing/phase state
 * machine over the live point cloud's buffer order.
 *
 * The chaos game appends points to the cloud buffer in the exact order they
 * were plotted, so revealing only the first N of them and growing N over
 * time REPLAYS — not merely simulates — how the attractor was actually
 * drawn. This module owns none of the drawing: like `camera-tween.ts`'s
 * `CameraTween` tracks a camera glide without touching Three.js, `BuildReplay`
 * just tracks which `N` ("revealed") and which phase of the story should be
 * showing at the current clock reading. main.ts/scene.ts (wired up
 * separately from this module) are expected to call {@link
 * BuildReplay.start} when the user opens the replay, poll {@link
 * BuildReplay.frame} once per animation frame to learn how many leading
 * points of the buffer to draw and which caption to show, and call {@link
 * BuildReplay.cancel} if the user backs out early.
 *
 * The reveal runs through three timed phases before settling into a fourth:
 *
 *  1. `"hop"` — the first {@link HOP_POINTS} points are revealed one at a
 *     time (one every `HOP_MS / HOP_POINTS` ms) so a single point visibly
 *     hops between the transforms it lands on, before there's a cloud dense
 *     enough to read as one.
 *  2. `"accrete"` / `"emerge"` — over the following {@link ACCRETE_MS} ms the
 *     reveal grows from {@link HOP_POINTS} up to the full point count, but in
 *     LOG space rather than linearly: a real cloud is typically hundreds of
 *     thousands of points, and its shape is usually legible after a few
 *     thousand, so a LINEAR ramp would spend nearly all of its duration
 *     crawling through a visually-uniform tail after the interesting part is
 *     already over. Growing at a constant RELATIVE rate instead (each instant
 *     reveals a fixed percentage more points than the instant before) puts
 *     the perceptually-interesting early growth — where dots visibly accrete
 *     one by one — at the start, while still reaching the full count in a
 *     bounded, fixed duration. The phase is reported as `"emerge"` once the
 *     reveal passes {@link EMERGE_FRACTION} of the total (roughly the point
 *     the attractor's shape becomes recognizable), `"accrete"` before that.
 *  3. `"done"` — the full cloud is revealed; the caption lingers for {@link
 *     DONE_LINGER_MS} ms so the viewer has a moment to read it before the
 *     replay auto-completes.
 *
 * Once the done-linger elapses, {@link BuildReplay.frame} transitions itself
 * back to idle (returning `null`) with no further action required from the
 * caller.
 */
import { clamp } from "../fractal/vec";

/** Which stage of the replay's story is currently playing. */
export type ReplayPhase = "hop" | "accrete" | "emerge" | "done";

/** What to draw and say for the current instant of an active replay. */
export interface ReplayFrame {
  /** How many leading points of the cloud buffer to draw, 1..total. */
  revealed: number;
  /** Buffer index of the newest point (revealed - 1) for the highlight
   * cursor, or null once the reveal completes. */
  cursor: number | null;
  phase: ReplayPhase;
}

/** Points revealed one at a time during the opening "hop" phase. */
export const HOP_POINTS = 12;
/** Duration of a full 12-point hop phase, ms (one hop every 250 ms). */
export const HOP_MS = 3000;
/** Duration of the exponential accretion ramp, ms. */
export const ACCRETE_MS = 9000;
/** How long the final caption lingers after the reveal completes, ms. */
export const DONE_LINGER_MS = 2500;
/** Fraction of the total count at which the caption flips to "emerge". */
export const EMERGE_FRACTION = 0.02;

/** Narration shown while each phase plays (main.ts pushes these to the
 * caption overlay). */
export const REPLAY_CAPTIONS: Record<ReplayPhase, string> = {
  hop: "One point hops between randomly chosen transforms…",
  accrete: "…every landing becomes a dot…",
  emerge: "…and the hops converge onto the attractor",
  done: "Random hops, one deterministic shape: the attractor",
};

/** An in-flight replay: the clock reading it started at, plus the timing
 * breakdown derived once from `total` at start() time so frame() is a pure
 * read. */
interface Replay {
  startMs: number;
  total: number;
  hopCount: number;
  hopMs: number;
  accreteMs: number;
  emergeAt: number;
}

/**
 * The "Watch it build" replay state machine. Call {@link start} to begin
 * replaying a cloud of a given size, poll {@link frame} once per animation
 * frame while {@link active}, and {@link cancel} to stop early.
 */
export class BuildReplay {
  private replay: Replay | null = null;

  /**
   * @param now Monotonic clock in ms (`() => performance.now()` in the app);
   *   both the start reading and every per-frame progress read the SAME
   *   clock.
   */
  constructor(private readonly now: () => number) {}

  /** Whether a replay is currently in flight (including its done-linger). */
  get active(): boolean {
    return this.replay !== null;
  }

  /**
   * Begin a replay over a cloud of `total` points, timed from `now()` at the
   * moment of this call. `total < 1` or non-finite leaves the replay idle
   * (there is nothing to reveal). Restarts from the beginning if a replay is
   * already active.
   */
  start(total: number): void {
    if (!Number.isFinite(total) || total < 1) {
      this.replay = null;
      return;
    }
    const hopCount = Math.min(HOP_POINTS, total);
    const hopMs = HOP_MS * (hopCount / HOP_POINTS);
    // No accretion ramp when the hop phase alone already revealed everything.
    const accreteMs = total > hopCount ? ACCRETE_MS : 0;
    const emergeAt = Math.max(hopCount + 1, Math.ceil(total * EMERGE_FRACTION));
    this.replay = {
      startMs: this.now(),
      total,
      hopCount,
      hopMs,
      accreteMs,
      emergeAt,
    };
  }

  /** Stop immediately and return to idle. */
  cancel(): void {
    this.replay = null;
  }

  /**
   * The frame to display now, or null when idle. Transitions itself to idle
   * (and starts returning null) once the done-linger expires.
   */
  frame(): ReplayFrame | null {
    if (!this.replay) return null;
    const { startMs, total, hopCount, hopMs, accreteMs, emergeAt } =
      this.replay;
    const elapsed = this.now() - startMs;

    if (elapsed < hopMs) {
      // One more point every HOP_MS / HOP_POINTS ms; the first is visible
      // immediately (revealed starts at 1, not 0).
      const revealed = Math.min(
        hopCount,
        1 + Math.floor(elapsed / (HOP_MS / HOP_POINTS)),
      );
      return { revealed, cursor: revealed - 1, phase: "hop" };
    }

    if (elapsed < hopMs + accreteMs) {
      // Log-space interpolation between hopCount and total: see the module
      // doc for why constant RELATIVE growth (not a linear ramp) is what
      // makes both the early accretion and the eventual full reveal land
      // within a fixed duration.
      const u = (elapsed - hopMs) / accreteMs;
      const revealed = clamp(
        Math.round(
          Math.exp(
            Math.log(hopCount) + (Math.log(total) - Math.log(hopCount)) * u,
          ),
        ),
        hopCount,
        total,
      );
      const phase: ReplayPhase = revealed >= emergeAt ? "emerge" : "accrete";
      return { revealed, cursor: revealed - 1, phase };
    }

    if (elapsed < hopMs + accreteMs + DONE_LINGER_MS) {
      return { revealed: total, cursor: null, phase: "done" };
    }

    this.replay = null;
    return null;
  }
}
