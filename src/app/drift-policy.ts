/**
 * An automated show's stop/advance conductor (fr-wavo): the policy seam
 * between the show's OWN automation and everything else that wants to end
 * it. Born as the drift show's conductor; since fr-8v41 the timeline
 * player's playback is conducted by a second instance of the same policy —
 * {@link ConductableShow} is the show surface it needs, and each leg's body
 * arrives per {@link advance} call, so one policy class serves both shows.
 *
 * `DriftShow` (drift.ts) is deliberately just a clock deadline — it knows
 * WHEN a leg is due, nothing about what a leg does or what ends the show.
 * A leg itself, on the other hand, is a real replace-load: main.ts's
 * leg launchers flow through the exact same applyEdit / applyDecodedSnapshot
 * chokepoints that implement "any user edit stops the show" (fr-wavo's
 * stop-on-edit rule). Without a guard, every leg would stop the show it
 * belongs to on its own first frame. This class owns that guard and the two
 * ways a show ends AT a leg boundary rather than by a user's hand:
 *
 * - {@link stop} is the one gate every stop goes through: a no-op while the
 *   show's own leg is applying itself (the `advancing` flag) and while
 *   already idle — so `onStopped` (and its optional "Drift stopped" toast,
 *   fr-ygr1) can never fire for a stop that didn't actually happen.
 * - {@link advance} runs one leg under that flag and ends the show itself
 *   when there is no leg to run: a reduced-motion preference that appeared
 *   mid-show, or a leg source that ran dry (`launchLeg` returning false —
 *   an emptied-out or fully-corrupt collection, fr-w2ve). The dry stop is
 *   deferred until AFTER the flag unwinds: issued from inside the leg it
 *   would be swallowed by the own-leg guard — exactly the fr-4otp bug,
 *   where an emptied collection's show kept polling forever, toggle lit,
 *   because its own stop call no-op'd.
 *
 * What this module is NOT: it decides neither WHAT a leg does (main.ts's
 * leg launchers roll the surprise, play the next saved scene, or fire a
 * timeline keyframe) nor WHEN legs come due (the caller polls its show's
 * `frame` and calls {@link advance} on true), and it stays out of the
 * hold/resume choreography a collection show runs around converging renders
 * — main.ts drives `DriftShow.hold`/`resumeAfter` directly. Which app
 * actions count as "the user reached in" (and which of those toast) is
 * likewise the call sites' business; see the wiring in main.ts. Pure policy
 * over injected effects, like edit-session.ts.
 */

/** The show surface the policy conducts: whether it is running, and how to
 * end it. `DriftShow` (drift.ts) and `TimelinePlayer` (timeline-player.ts)
 * both satisfy this structurally; everything else those classes do —
 * arming, scheduling, holding, polling — stays with the caller. */
export interface ConductableShow {
  readonly active: boolean;
  stop(): void;
}

/** Everything {@link DriftPolicy} touches, injected so the policy stays
 * pure and testable (the edit-session.ts pattern). */
export interface DriftPolicyDeps {
  /** The show's timing loop. The policy only reads `active` and calls
   * `stop`; arming, holding, and polling stay with the caller. */
  show: ConductableShow;
  /** Live reduced-motion preference: a leg boundary reached under it ends
   * the show — no motion means no drift (fr-wavo). */
  reducedMotion(): boolean;
  /**
   * Reflect a stop that genuinely happened (un-light the show's toggle);
   * `notify` relays {@link DriftPolicy.stop}'s option — flash a "stopped"
   * toast for an implicit stop (fr-ygr1). Never called for a no-op'd
   * stop.
   */
  onStopped(notify: boolean): void;
}

/**
 * The stop-on-edit / end-at-the-boundary policy over a
 * {@link ConductableShow}. Construct once next to the show; route every
 * stop through {@link stop} and every show `frame()` firing through
 * {@link advance}.
 */
export class DriftPolicy {
  /** True only while the show's own leg applies itself, so {@link stop}'s
   * chokepoints can tell the show's own roll from a genuine user edit. */
  private advancing = false;

  constructor(private readonly deps: DriftPolicyDeps) {}

  /**
   * End the show — a STOP, not a pause (restarting is a fresh toggle, per
   * fr-wavo). A no-op while idle or while the show's own leg applies
   * itself, so `onStopped` (and a requested toast) only fires when the
   * show was actually running and actually ended.
   */
  stop(opts?: { notify?: boolean }): void {
    if (this.advancing || !this.deps.show.active) return;
    this.deps.show.stop();
    this.deps.onStopped(opts?.notify === true);
  }

  /**
   * Run one show leg (the caller saw its show's `frame()` fire, and passes
   * the leg's body — a Surprise-Me roll, the next saved scene, a timeline
   * keyframe load). A reduced-motion preference that appeared mid-show ends
   * the show here, at the leg boundary, instead of launching — silent: a
   * preference sync, not the user reaching in elsewhere (fr-ygr1's toast is
   * for those). Otherwise the leg runs under the own-leg guard, so the
   * replace-load chokepoints it flows through may call {@link stop} freely
   * without ending the show it belongs to; `launchLeg` returns whether a
   * leg actually launched — false means the source ran dry (an emptied or
   * fully-corrupt collection, an undecodable timeline step) and ends the
   * show AFTER the guard unwinds so the stop actually lands (fr-4otp) —
   * silent for the same reason: a dry source ends its own show.
   */
  advance(launchLeg: () => boolean): void {
    if (this.deps.reducedMotion()) {
      this.stop();
      return;
    }
    this.advancing = true;
    try {
      if (launchLeg()) return;
    } finally {
      this.advancing = false;
    }
    // Dry source: the finally above has already lifted the own-leg guard
    // by the time control reaches here, so this stop actually lands
    // (fr-4otp).
    this.stop();
  }
}
