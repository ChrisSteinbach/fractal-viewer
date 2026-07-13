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
 * ## Held legs: dwells that end on a SIGNAL, not a clock (fr-w2ve)
 *
 * The collection-sourced show (main.ts's gallery slideshow) can display each
 * item as a converging flame/solid render, and "how long until this item is
 * worth departing from" is then not a duration this module could know — it's
 * "the render met its iteration budget". {@link DriftShow.hold} covers that:
 * it clears the deadline while staying active (`nextLegAtMs = Infinity`, so
 * `frame()`'s one comparison keeps working unchanged), and
 * {@link DriftShow.resumeAfter} re-arms the departure relative to `now()`
 * when the caller observes the external signal — main.ts passes
 * {@link DRIFT_RENDER_LINGER_MS} there, so a completed render gets admired
 * for a beat before the show moves on. `resumeAfter` deliberately acts ONLY
 * while holding: a stray completion event from a render the show isn't
 * waiting on (or one arriving after {@link DriftShow.stop}) must neither
 * restart a stopped show nor clobber a live clock deadline.
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
/** How long a held show lingers on a JUST-COMPLETED flame/solid render
 * before departing (fr-w2ve): main.ts passes this to
 * {@link DriftShow.resumeAfter} when the render a hold was waiting on meets
 * its iteration budget — "render complete, one second longer, move on". */
export const DRIFT_RENDER_LINGER_MS = 1000;

/**
 * The Drift ambient-show state machine. Call {@link start} to arm the show,
 * poll {@link frame} once per animation frame while {@link active}, and call
 * {@link stop} to return to idle.
 */
export class DriftShow {
  /** Clock reading at which the next leg should launch; null when idle,
   * Infinity while held awaiting an external signal (see {@link hold}). */
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
   * Suspend the clock deadline while staying active: {@link frame} stops
   * firing until {@link resumeAfter} re-arms it (or {@link start} re-arms
   * the dwell, or {@link stop} ends the show). The caller's "the current
   * item is a converging render — depart on its completion signal, not on a
   * clock" state (fr-w2ve; see the module header). A no-op while idle:
   * holding is a way of BEING active, never a way of becoming it.
   */
  hold(): void {
    if (this.nextLegAtMs !== null) this.nextLegAtMs = Infinity;
  }

  /** Whether the show is active but held — awaiting {@link resumeAfter}
   * rather than a clock deadline. main.ts's animate loop reads this to
   * self-heal a show left holding after its render exited (Back / error). */
  get holding(): boolean {
    return this.nextLegAtMs === Infinity;
  }

  /**
   * End a {@link hold}: the next leg departs `delayMs` from now. Acts ONLY
   * while holding — while idle (a completion signal arriving after
   * {@link stop}) or while running on a clock deadline (a stray signal from
   * a render the show never held for), this is deliberately a no-op: see
   * the module header.
   */
  resumeAfter(delayMs: number): void {
    if (this.nextLegAtMs === Infinity) this.nextLegAtMs = this.now() + delayMs;
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
   *
   * While held (see {@link hold}) this never fires: `now < Infinity` falls
   * out of the same comparison, no extra state.
   */
  frame(): boolean {
    if (this.nextLegAtMs === null) return false;
    const now = this.now();
    if (now < this.nextLegAtMs) return false;
    this.nextLegAtMs = now + DRIFT_MORPH_MS + DRIFT_DWELL_MS;
    return true;
  }
}
