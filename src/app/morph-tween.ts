/**
 * The system-morph TWEEN (fr-jx9o, part 2 of the system-morphing feature): a
 * per-frame driver over fr-idze's pure interpolation
 * (`../fractal/morph`'s {@link lerpSystem}), shaped like `camera-tween.ts`'s
 * `CameraTween` and `build-replay.ts`'s `BuildReplay` one level up. When a
 * replace-load (preset / Surprise Me / gallery) swaps in a new attractor,
 * main.ts's animate loop is expected to poll {@link MorphTween.sample} once
 * per frame — same call pattern as `CameraTween.advance` / `BuildReplay.frame`
 * — and issue one cloud generation request per sample, so the point cloud
 * flows into the new shape instead of snapping (fr-a04l wires this up). The
 * FINAL sample (`t >= 1`) doubles as the real replaced/fit generation request
 * that an instant swap would have issued, so its `system` must be `to` BY
 * REFERENCE — not a freshly-lerped copy that merely equals it. The terminal
 * branch hands `to` back directly, the same exactness `lerpSystem`'s own
 * `t >= 1` contract promises (fr-idze).
 *
 * ## Why the tween pins a seed
 *
 * The chaos game is seed-driven: `cloud-worker-core.ts` seeds its RNG with
 * `mulberry32(request.seed)`, and today main.ts's `cloudParams` rolls a
 * fresh random seed on every generation request. That's invisible for an
 * ordinary edit — the cloud just looks like itself again — but replayed
 * across EVERY frame of a morph, a fresh seed each frame would re-place
 * every point from scratch each time, so the cloud would sparkle as noise
 * instead of flowing. Holding ONE seed for the whole morph and handing it
 * back with every sample keeps consecutive frames' generated buffers
 * point-for-point correspondent (same random draw sequence each frame, only
 * the interpolated system itself differs a little), so the cloud reads as
 * one shape liquidly flowing into the next rather than re-rolling. `start`
 * therefore takes the seed as a plain argument — the caller rolls it, same
 * as `cloudParams` does today — rather than rolling one internally, so this
 * module stays pure and deterministic in tests.
 *
 * ## Chained starts
 *
 * If the user fires off another replace-load while a morph is still in
 * flight (spamming preset loads), the new morph must neither restart from
 * the ORIGINAL `from` nor teleport from wherever the caller happens to think
 * the system is — it chains from whatever is actually ON SCREEN, i.e. the
 * in-flight morph's own live sample at that instant, and it keeps that
 * in-flight morph's PINNED SEED, ignoring whatever seed the new caller
 * passed. Both rules serve the same continuity goal as the pinned seed
 * above: chaining from the live intermediate avoids a visible teleport, and
 * keeping the seed avoids a one-frame re-roll sparkle right at the chain
 * point (the cloud on screen at that instant was generated with the old
 * seed; switching seeds there would re-place every point even though the
 * system itself barely changed).
 *
 * ## No cancel()
 *
 * Unlike `CameraTween` (whose `cancel()` can simply drop a glide, leaving
 * the camera exactly where it was), a morph cannot be abandoned outright:
 * the app always needs to end up displaying SOME definite system, and there
 * is no "current system" independent of the tween once one starts. So there
 * is deliberately no `cancel()` here — every early-exit path (the user backs
 * out, a new load supersedes this one, whatever else) calls {@link
 * MorphTween.finish} instead, which snaps straight to `to` and hands back
 * the same reference-exact final sample {@link MorphTween.sample} would have
 * produced at `t >= 1`.
 *
 * ## What this module is not
 *
 * No DOM, no Three.js, no timers of its own — like its siblings, it reads no
 * clock itself. Unlike `CameraTween`/`BuildReplay`, though, `now` is a plain
 * PER-CALL argument here rather than a constructor-injected `() => number`:
 * this class has no `advance()`/`frame()` that silently reads an injected
 * clock, every method already takes the moment it cares about as an
 * argument, so there is no constructor at all. And reduced motion is
 * entirely the CALLER's policy — this module has no opinion and never reads
 * `matchMedia`, same as `camera-tween.ts`; a caller that wants to honor
 * reduced motion simply calls {@link MorphTween.finish} right after {@link
 * MorphTween.start} instead of polling {@link MorphTween.sample} across
 * frames.
 */
import { lerpSystem, type MorphSystem } from "../fractal/morph";
import { smoothstep } from "./orbit";

/** Default duration of a system morph, in milliseconds — used when {@link
 * MorphTween.start} isn't given its own `durationMs` (the replace-load
 * morph runs at this default; Drift legs pass a longer one of their own). */
export const MORPH_TWEEN_MS = 1400;

/** One instant of an in-flight (or just-completed) morph: the system to
 * display, the seed it (and the whole morph) was generated with, and
 * whether this is the terminal sample. */
export interface MorphSample {
  system: MorphSystem;
  seed: number;
  final: boolean;
}

/** In-flight morph: the two endpoints, the seed pinned for the whole morph
 * (see the module header), the clock reading it started at, and the
 * duration (in ms) this particular morph runs over — each morph times
 * itself, so a chained start's new duration never retroactively changes an
 * already-elapsed leg. */
interface Morph {
  from: MorphSystem;
  to: MorphSystem;
  seed: number;
  startMs: number;
  durationMs: number;
}

/**
 * The system-morph state machine. Call {@link start} to begin morphing
 * toward a freshly-loaded system, poll {@link sample} once per animation
 * frame while {@link active}, and call {@link finish} on any early-exit path
 * to snap straight to the target (there is no separate `cancel()` — see the
 * module header for why).
 */
export class MorphTween {
  private morph: Morph | null = null;

  /** Whether a morph is currently in flight. */
  get active(): boolean {
    return this.morph !== null;
  }

  /**
   * Begin a morph from `from` to `to`, timed from `now` and running over
   * `durationMs` (default {@link MORPH_TWEEN_MS}), holding `seed` for every
   * sample of this morph (see the module header for why the seed is pinned
   * rather than rolled per frame).
   *
   * If a morph is already in flight (a CHAINED start — see the module
   * header), the caller-supplied `from` and `seed` are both ignored: the new
   * morph instead resumes from the in-flight morph's own live sample at
   * `now` and keeps the in-flight morph's pinned seed, so what's on screen
   * never jumps and the point correspondence never breaks. `durationMs` is
   * the one exception to that inheritance: it is always taken from THIS
   * call, never the in-flight morph's — each morph times itself, so a
   * chained start's new duration governs even though `from`/`seed` come from
   * the morph it's chaining off of. Sampling the old morph to chain from
   * also transitions it to idle first (see {@link sample}), which is
   * immediately superseded by the new record this method installs —
   * harmless, and it means a chain still resumes correctly even from an
   * in-flight morph that ran past its own duration without ever being
   * polled (it resumes from that morph's `to`, which is exactly what was
   * left on screen).
   */
  start(
    from: MorphSystem,
    to: MorphSystem,
    seed: number,
    now: number,
    durationMs: number = MORPH_TWEEN_MS,
  ): void {
    const inFlight = this.sample(now);
    this.morph = inFlight
      ? {
          from: inFlight.system,
          to,
          seed: inFlight.seed,
          startMs: now,
          durationMs,
        }
      : { from, to, seed, startMs: now, durationMs };
  }

  /**
   * The morph's system/seed at `now`, or null when no morph is in flight.
   * `t = (now - startMs) / durationMs`, using the duration {@link start}
   * recorded for this particular morph:
   *
   * - `t >= 1`: deactivates the tween and returns the `to` endpoint BY
   *   REFERENCE with `final: true` — the terminal sample (see the module
   *   header for why exactness here is a hard contract). Because this call
   *   deactivates, a caller that still needs the result after acting on it
   *   must hold onto the returned sample rather than sampling again.
   * - `t < 1`: returns `{ system: lerpSystem(from, to, smoothstep(t)), seed,
   *   final: false }` and stays active. `smoothstep` clamps its input to
   *   [0, 1], so a `now` earlier than `startMs` lerps at `t = 0`, which
   *   `lerpSystem` returns as `from` BY REFERENCE — no special-casing
   *   needed here for that edge.
   */
  sample(now: number): MorphSample | null {
    if (!this.morph) return null;
    const { from, to, seed, startMs, durationMs } = this.morph;
    const t = (now - startMs) / durationMs;
    if (t >= 1) {
      this.morph = null;
      return { system: to, seed, final: true };
    }
    return {
      system: lerpSystem(from, to, smoothstep(t)),
      seed,
      final: false,
    };
  }

  /**
   * Snap any in-flight morph straight to its target: deactivates and
   * returns the same reference-exact terminal sample {@link sample} would
   * produce at `t >= 1` (`{ system: to, seed, final: true }`), or null when
   * already idle. This is the ONLY cancellation path — see the module
   * header for why there is no separate `cancel()`.
   */
  finish(): MorphSample | null {
    if (!this.morph) return null;
    const { to, seed } = this.morph;
    this.morph = null;
    return { system: to, seed, final: true };
  }
}
