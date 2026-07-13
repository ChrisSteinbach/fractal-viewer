/**
 * The "Drift" ambient-show timing loop (fr-wavo): a pure dwell/advance state
 * machine that turns the viewer into an ever-evolving display (the
 * Electric-Sheep-on-a-TV use case). Dwell on the current attractor for
 * {@link DRIFT_DWELL_MS}, then spend {@link DRIFT_MORPH_MS} morphing to a
 * freshly rolled random system, dwell on THAT, repeat — forever, until the
 * caller calls {@link DriftShow.stop}.
 *
 * Shaped one level up from `build-replay.ts`'s `BuildReplay` and
 * `morph-tween.ts`'s `MorphTween`: main.ts's animate loop is expected to
 * poll {@link DriftShow.frame} once per animation frame, and when it returns
 * true, roll a fresh random system (`../fractal/random-system`'s
 * `randomSystem`) and hand the current-vs-fresh pair to a `MorphTween`,
 * passing {@link DRIFT_MORPH_MS} as its `durationMs` (see that module's own
 * header for how ITS morph is actually driven frame by frame). This module
 * does none of that itself — no system rolling, no `MorphTween` calls, no
 * touching the cloud. It only knows WHEN the next leg should launch.
 *
 * ## Dwell, then morph, then dwell again
 *
 * A "leg" is one departure: the moment {@link DriftShow.frame} fires true is
 * the moment main.ts should start a morph toward a new random system. That
 * morph runs {@link DRIFT_MORPH_MS} (deliberately longer than the default
 * replace-load `MORPH_TWEEN_MS` of 1400 — a drift leg is ambient scenery,
 * not feedback on a click, so it can take its time), and once the new
 * system settles, the show dwells on it for {@link DRIFT_DWELL_MS} before
 * departing again. Both durations are folded into the ONE reschedule that
 * happens when a leg fires: `frame()` sets the next due time to `now() +
 * DRIFT_MORPH_MS + DRIFT_DWELL_MS` — covering the morph that's about to
 * launch AND the dwell that follows it — in one step, so this module never
 * needs to learn when a morph actually finishes; `MorphTween` owns that.
 *
 * ## Reschedule from `now()`, never from the stale due time
 *
 * Rescheduling always adds to the CURRENT clock reading, not to the due
 * time that just elapsed. A backgrounded tab suspends rAF, so `frame()`
 * simply isn't polled for a while; on refocus, the first poll sees `now()`
 * far past the recorded due time, fires exactly ONE catch-up leg (never a
 * burst, however many boundaries were skipped while backgrounded), and
 * reschedules relative to THAT refocus instant. The show resumes its
 * cadence from wherever the viewer actually is, rather than replaying a
 * backlog of missed legs.
 *
 * ## Battery: the dwell phase is a single comparison
 *
 * Between legs, `frame()` does nothing but compare `now()` against one
 * stored number — no allocation, no work proportional to how long the dwell
 * has run. That matters here more than in `BuildReplay`/`CameraTween`: each
 * MORPH frame upstream costs a full cloud generation, so keeping the
 * dwelling phase fully idle is what keeps Drift from burning battery just
 * sitting on a finished attractor between legs.
 *
 * ## What this module is not
 *
 * No DOM, no Three.js, no timers of its own — like its siblings, it reads
 * no clock itself, only the injected `now`. Reduced-motion policy and
 * stop-on-edit policy (pausing Drift the instant the user touches a slider
 * or drags a transform) are entirely the CALLER's business, same stance as
 * `morph-tween.ts`: this module never reads `matchMedia` and knows nothing
 * about edits — it just tracks a clock deadline.
 */

/** How long the show dwells on each settled attractor before departing, ms. */
export const DRIFT_DWELL_MS = 5000;
/** Duration of each drift leg's system morph, ms — deliberately longer than
 * the default replace-load MORPH_TWEEN_MS (1400): a drift leg is scenery,
 * not feedback on a click. main.ts passes this to MorphTween.start. */
export const DRIFT_MORPH_MS = 5000;

/**
 * The Drift ambient-show state machine. Call {@link start} to arm the show,
 * poll {@link frame} once per animation frame while {@link active}, and call
 * {@link stop} to return to idle.
 */
export class DriftShow {
  /** Clock reading at which the next leg should launch, or null when idle. */
  private nextLegAtMs: number | null = null;

  /**
   * @param now Monotonic clock in ms (`() => performance.now()` in the app);
   *   every scheduling decision reads the SAME clock.
   */
  constructor(private readonly now: () => number) {}

  /** Whether the show is currently running (armed, or between legs). */
  get active(): boolean {
    return this.nextLegAtMs !== null;
  }

  /**
   * Arm the show: the first leg departs {@link DRIFT_DWELL_MS} from now, so
   * the attractor already on screen gets a full dwell before the first
   * departure. Calling `start()` while already active simply re-arms the
   * dwell from now — harmless, and the UI toggle that calls this is expected
   * to prevent that from happening anyway.
   */
  start(): void {
    this.nextLegAtMs = this.now() + DRIFT_DWELL_MS;
  }

  /** Stop the show and return to idle: {@link frame} stops firing. */
  stop(): void {
    this.nextLegAtMs = null;
  }

  /**
   * Poll once per animation frame. Returns false while idle or before the
   * next leg is due. When due, reschedules the NEXT departure to `now() +
   * DRIFT_MORPH_MS + DRIFT_DWELL_MS` — the just-launched leg's morph, then
   * its settled dwell — and returns true exactly once for that departure.
   *
   * Always reschedules relative to the CURRENT `now()`, never the stale due
   * time: see the module header for why that's what keeps a backgrounded
   * tab from replaying missed legs in a burst on refocus.
   */
  frame(): boolean {
    if (this.nextLegAtMs === null) return false;
    const now = this.now();
    if (now < this.nextLegAtMs) return false;
    this.nextLegAtMs = now + DRIFT_MORPH_MS + DRIFT_DWELL_MS;
    return true;
  }
}
