/**
 * The timeline's playback clock (fr-8v41): a pure state machine that tells
 * main.ts WHEN to launch each leg of a `timeline.ts` run — "leg i" meaning
 * "start morphing into step i now" — and when the whole run has finished.
 * Where `drift.ts`'s `DriftShow` is the ambient, unending show, this is its
 * directed, FINITE counterpart: a `TimelineStore`'s steps, played back once
 * in author order and then done.
 *
 * Shaped like `DriftShow` / `build-replay.ts`'s `BuildReplay` /
 * `morph-tween.ts`'s `MorphTween` one level up: main.ts's animate loop polls
 * {@link TimelinePlayer.frame} once per animation frame while {@link
 * TimelinePlayer.active}. This module knows nothing about scenes, morphs,
 * cameras, or recording — it never touches `timeline.ts`, `MorphTween`, or
 * the cloud. It only knows the authored `morphMs`/`holdMs` timing pulled
 * from each `TimelineStep` (as the minimal {@link StepTiming}) and turns
 * that into a schedule of due times.
 *
 * ## Absolute schedule, not DriftShow's relative reschedule
 *
 * `start()` records `startMs = now()` once and computes every leg's due
 * time against that ONE anchor, up front — unlike `DriftShow`, which
 * reschedules its single next-due time relative to `now()` every time a leg
 * fires. DriftShow can afford that: an ambient show has no total duration to
 * protect, so resuming its cadence from wherever the viewer refocused is
 * strictly better than replaying a backlog. A timeline has the opposite
 * requirement — it's the thing fr-8v41's video export RECORDS, and a
 * recorded clip must come out the authored length every time (points-only —
 * see "Held legs" below for the render-keyframe exception), so a leg's poll
 * landing a frame late must never stretch the schedule for the legs after
 * it. Anchoring every due time to the original `startMs` is what makes that
 * true: a late poll fires late and the rest of the run is unaffected.
 *
 * ## Held legs: schedule segments that end on a SIGNAL (fr-v3au)
 *
 * A keyframe that plays as a converging flame/solid render has no
 * deterministic duration for the absolute schedule above to price in — "how
 * long until this step is over" is "until the render meets its iteration
 * budget", not a `morphMs`/`holdMs` pair known up front. So the caller holds
 * the schedule at that leg's launch ({@link TimelinePlayer.hold}) and
 * resumes it ({@link TimelinePlayer.resume}) once the render's completion
 * signal arrives. While held, the held leg's own `holdMs` is reinterpreted:
 * instead of "how long until the next leg departs", it becomes the
 * POST-convergence dwell — the author-controlled linger after the render
 * finishes, with no separate linger constant the way `drift.ts`'s
 * `DRIFT_RENDER_LINGER_MS` is for the ambient show.
 *
 * Between holds the schedule stays authored-exact: `resume()` is one shift
 * of `startMs`, so every leg after the held one keeps its authored RELATIVE
 * spacing no matter how long the hold lasted — re-anchoring the same way
 * `start()` anchors once at the top of the run, just done again at resume
 * time. The consequence lands on fr-8v41's REALTIME export: a recorded
 * clip's length becomes content-dependent once render keyframes are in the
 * mix — an accepted trade (fr-v3au), since the recorder is then honestly
 * capturing however long convergence actually took, and a pure-points
 * timeline (which never holds) keeps its authored-length guarantee
 * unchanged. The offline export escapes the trade (fr-6jic): its driver
 * runs this player on a VIRTUAL clock and parks that clock through the
 * hold — the render converges in real time, no frames are captured, and
 * `resume()`'s re-anchor lands against the parked reading — so even a
 * render-keyframe timeline exports at its authored length there.
 *
 * ## Catch-up: at most one leg per poll, always the latest due
 *
 * Same rule as `DriftShow`'s backgrounded-tab handling: if several legs'
 * due times have elapsed since the last poll (a backgrounded tab suspends
 * rAF; so can a slow frame), `frame()` fires only the LATEST of them, never
 * a burst — the skipped legs' targets were never shown on screen, and
 * main.ts's morph always launches from whatever IS on screen, so skipping
 * straight to the newest due leg is exactly right rather than a compromise.
 *
 * ## One event per poll, and the last leg always precedes `done`
 *
 * `frame()` returns at most one {@link TimelinePlayerEvent} per call, even
 * when a leg boundary AND the run's end are simultaneously due. Consequence:
 * if the clock has blown past the very end while legs are still unfired,
 * one poll returns the last unfired leg and only the NEXT poll returns
 * `done` — the final keyframe is always launched before the run reports
 * finished, so a recording stop or a "timeline finished" toast can never
 * beat the last scene's arrival.
 *
 * A step authored with `morphMs: 0, holdMs: 0` makes ITS due time and the
 * next leg's due time coincide; the latest-due-wins catch-up rule then
 * skips it outright, the same way it skips a backgrounded gap's stale legs.
 * That's intended: a 0/0 step is a no-op frame in the authored sequence,
 * not a scene anyone would see anyway at zero duration.
 *
 * ## Battery: idle frames do no work proportional to elapsed time
 *
 * `frame()` keeps a `nextLeg` cursor and only ever advances it forward, so
 * an ordinary dwelling poll — no leg newly due — does one comparison and
 * stops, the same "single comparison" idle cost `drift.ts`'s module header
 * calls out. Finding the latest due leg costs O(k) in the number of legs
 * that became due since the LAST poll (usually 0, occasionally 1, only
 * larger after a real gap), never O(n) in the timeline's total length.
 *
 * ## What this module is not
 *
 * No DOM, no Three.js, no timers of its own — like its siblings, it reads
 * no clock itself, only the injected `now`. It doesn't know what a leg DOES
 * (main.ts decides: pull the step's `encoded` scene, seed a `MorphTween`
 * via `timeline.ts`'s `legSeed`, maybe feed a video encoder) and has no
 * opinion on reduced motion — entirely the caller's policy, same stance as
 * `morph-tween.ts` and `drift.ts`.
 */

/** The per-step timing the player schedules from — timeline.ts's
 * TimelineStep carries these fields; the player deliberately takes only the
 * timing. */
export interface StepTiming {
  morphMs: number;
  holdMs: number;
}

/** What a poll can report: launch the morph into step `index` now, or the
 * run finished (the last step's hold elapsed). */
export type TimelinePlayerEvent =
  { kind: "leg"; index: number } | { kind: "done" };

/**
 * The timeline playback state machine. Call {@link start} with the run's
 * per-step timings to arm it, poll {@link frame} once per animation frame
 * while {@link active}, and call {@link stop} to abandon the run early.
 */
export class TimelinePlayer {
  /** Clock reading `start()` was called at; `null` when idle. */
  private startMs: number | null = null;
  /** Each leg's due offset from `startMs`, index-aligned with the `timings`
   * passed to `start`. Empty while idle. */
  private due: number[] = [];
  /** The run's end due offset from `startMs` — `due[n-1]` plus that last
   * leg's own `morphMs` + `holdMs` (its hold fully elapsed). */
  private endDue = 0;
  /** Index of the earliest not-yet-fired leg. Advances monotonically over
   * the course of a run so `frame()` never re-scans a leg it already
   * fired — the O(1)-between-due-times cost the module header describes. */
  private nextLeg = 0;
  /** Index of the last-fired leg at the moment {@link hold} was called;
   * `null` when not held. Doubles as the held flag — see {@link holding}. */
  private heldLeg: number | null = null;
  /** The timings passed to the most recent {@link start} — kept only so
   * {@link resume} can read the held leg's own `holdMs`. Empty while idle. */
  private timings: readonly StepTiming[] = [];

  /**
   * @param now Monotonic clock in ms (`() => performance.now()` in the
   *   app); every scheduling decision reads the SAME clock.
   */
  constructor(private readonly now: () => number) {}

  /** Whether a run is currently in flight (armed, or between legs) — false
   * once `done` has been returned or `stop()` was called. */
  get active(): boolean {
    return this.startMs !== null;
  }

  /**
   * Arm a run over `timings` (index-aligned with the caller's steps): leg
   * 0's due time is 0 — it fires on the very first {@link frame} poll, so
   * the run OPENS by morphing from whatever is on screen into step 0 over
   * its own `morphMs` — and leg `i + 1` is due at `due[i] + timings[i]
   * .morphMs + timings[i].holdMs`, i.e. the moment step `i`'s hold fully
   * elapses. The run's end is due at that same offset carried one leg
   * further: the last step's morph-then-hold, fully elapsed. See the
   * module header for why this schedule is computed once, up front,
   * against `now()` at call time, rather than incrementally like
   * `DriftShow`'s.
   *
   * `timings.length === 0` leaves the player idle instead of arming a
   * zero-leg run — defensive; callers are expected to guard against
   * playing an empty timeline, but this makes the empty case harmless
   * either way. Calling `start()` while already active simply replaces the
   * in-flight run with a fresh one timed from now, same as
   * `DriftShow.start`'s re-arm.
   */
  start(timings: readonly StepTiming[]): void {
    if (timings.length === 0) {
      this.startMs = null;
      this.due = [];
      this.endDue = 0;
      this.nextLeg = 0;
      this.timings = [];
      this.heldLeg = null;
      return;
    }
    this.startMs = this.now();
    this.nextLeg = 0;
    this.timings = timings;
    this.heldLeg = null;
    const due = new Array<number>(timings.length);
    let acc = 0;
    for (let i = 0; i < timings.length; i++) {
      due[i] = acc;
      acc += timings[i].morphMs + timings[i].holdMs;
    }
    this.due = due;
    this.endDue = acc;
  }

  /** Abandon the run and return to idle: {@link frame} stops firing, with
   * no final event — the conductor policy for "what happens on stop"
   * belongs to the caller (`drift-policy.ts` is the analogous owner for
   * `DriftShow`). */
  stop(): void {
    this.startMs = null;
    this.heldLeg = null;
  }

  /**
   * Whether the player is active but held — awaiting {@link resume} rather
   * than a due time. See "Held legs" in the module header.
   */
  get holding(): boolean {
    return this.startMs !== null && this.heldLeg !== null;
  }

  /**
   * Suspend the schedule while staying active: {@link frame} stops firing —
   * no leg, no `done` — however far the clock runs, until {@link resume}
   * re-arms it (or {@link stop} ends the run). The caller's contract is to
   * call this only from the handling of a leg event it just received, same
   * animation frame — `hold` records `nextLeg - 1`, the leg that just
   * fired, as the one being held on.
   *
   * A silent no-op in three cases, matching `DriftShow.hold`'s stance that
   * holding is a way of BEING active, never a way of becoming or
   * re-becoming it:
   * - idle (`startMs === null`) — nothing to hold.
   * - already held (`heldLeg !== null`) — a second `hold()` changes
   *   nothing; only {@link resume} clears a hold.
   * - no leg has fired yet (`nextLeg === 0`) — there's no just-fired leg to
   *   attribute the hold to.
   */
  hold(): void {
    if (this.startMs === null) return;
    if (this.heldLeg !== null) return;
    if (this.nextLeg === 0) return;
    this.heldLeg = this.nextLeg - 1;
  }

  /**
   * End a {@link hold}: the next event becomes due exactly
   * `timings[heldLeg].holdMs` from now — the held leg's own authored hold,
   * restarted against the signal's arrival — and every leg after it keeps
   * its authored RELATIVE spacing, because this is a single shift of
   * `startMs` rather than a per-leg reschedule. Holding on the LAST leg
   * resumes into `done` firing `holdMs` later, for free, out of the same
   * formula (`nextDueOffset` falls back to `endDue`) — no separate branch.
   *
   * Acts ONLY while holding — while idle (a completion signal arriving
   * after {@link stop}) or while running on the live clock (a stray signal
   * from a render the player was never holding for), this is deliberately a
   * no-op: an external signal must neither restart a stopped run nor shift
   * a schedule that's already ticking. Same stance as `drift.ts`'s
   * `DriftShow.resumeAfter`.
   */
  resume(): void {
    if (this.startMs === null || this.heldLeg === null) return;
    const nextDueOffset =
      this.nextLeg < this.due.length ? this.due[this.nextLeg] : this.endDue;
    this.startMs =
      this.now() + this.timings[this.heldLeg].holdMs - nextDueOffset;
    this.heldLeg = null;
  }

  /**
   * Poll once per animation frame. Returns `null` while idle, held (see
   * {@link hold} — the module header's "Held legs" section), between due
   * times, or when nothing is newly due. Otherwise returns exactly ONE
   * {@link TimelinePlayerEvent}:
   *
   * - `{ kind: "leg", index }` — the latest not-yet-fired leg whose due
   *   time has elapsed (see the module header's catch-up rule for why only
   *   the latest, never a burst). The player stays active.
   * - `{ kind: "done" }` — every leg has fired AND the run's end due time
   *   has elapsed. Deactivates the player (`active` becomes `false`).
   *
   * A run that finishes with unfired legs still owed (the clock jumped
   * past the very end) never reports `done` in the same poll that fires
   * its last leg — see the module header.
   */
  frame(): TimelinePlayerEvent | null {
    if (this.startMs === null) return null;
    if (this.heldLeg !== null) return null;
    const t = this.now() - this.startMs;

    let latestFired = -1;
    while (this.nextLeg < this.due.length && this.due[this.nextLeg] <= t) {
      latestFired = this.nextLeg;
      this.nextLeg++;
    }
    if (latestFired !== -1) return { kind: "leg", index: latestFired };

    if (this.nextLeg >= this.due.length && t >= this.endDue) {
      this.startMs = null;
      return { kind: "done" };
    }
    return null;
  }
}
