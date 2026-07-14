/**
 * The drift show's stop/advance conductor (fr-wavo): the policy seam between
 * the show's OWN automation and everything else that wants to end it.
 *
 * `DriftShow` (drift.ts) is deliberately just a clock deadline — it knows
 * WHEN a leg is due, nothing about what a leg does or what ends the show.
 * A leg itself, on the other hand, is a real replace-load: main.ts's
 * `launchLeg` flows through the exact same applyEdit / applyDecodedSnapshot
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
 * `launchLeg` closure rolls the surprise or plays the next saved scene) nor
 * WHEN legs come due (the caller polls `DriftShow.frame` and calls
 * {@link advance} on true), and it stays out of the hold/resume choreography
 * a collection show runs around converging renders — main.ts drives
 * `DriftShow.hold`/`resumeAfter` directly. Which app actions count as "the
 * user reached in" (and which of those toast) is likewise the call sites'
 * business; see the wiring in main.ts. Pure policy over injected effects,
 * like edit-session.ts.
 */

import type { DriftShow } from "./drift";

/** Everything {@link DriftPolicy} touches, injected so the policy stays
 * pure and testable (the edit-session.ts pattern). */
export interface DriftPolicyDeps {
  /** The show's timing loop. The policy only reads `active` and calls
   * `stop`; arming, holding, and polling stay with the caller. */
  show: DriftShow;
  /** Live reduced-motion preference: a leg boundary reached under it ends
   * the show — no motion means no drift (fr-wavo). */
  reducedMotion(): boolean;
  /**
   * Launch one departure — a Surprise-Me roll, or the next saved scene for
   * a collection show (fr-w2ve). Runs under the own-leg guard, so the
   * replace-load chokepoints it flows through may call
   * {@link DriftPolicy.stop} freely without ending the show they belong to.
   * Returns whether a leg actually launched; false means the source ran
   * dry (an emptied or fully-corrupt collection) and the show must end
   * (fr-4otp).
   */
  launchLeg(): boolean;
  /**
   * Reflect a stop that genuinely happened (un-light the drift toggle);
   * `notify` relays {@link DriftPolicy.stop}'s option — flash "Drift
   * stopped" for an implicit stop (fr-ygr1). Never called for a no-op'd
   * stop.
   */
  onStopped(notify: boolean): void;
}

/**
 * The stop-on-edit / end-at-the-boundary policy over a {@link DriftShow}.
 * Construct once next to the show; route every stop through {@link stop}
 * and every `DriftShow.frame()` firing through {@link advance}.
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
   * Run one drift leg (the caller saw `DriftShow.frame()` fire). A
   * reduced-motion preference that appeared mid-show ends the show here,
   * at the leg boundary, instead of launching — silent: a preference sync,
   * not the user reaching in elsewhere (fr-ygr1's toast is for those).
   * Otherwise the leg runs under the own-leg guard; a dry launch (see
   * {@link DriftPolicyDeps.launchLeg}) ends the show AFTER the guard
   * unwinds so the stop actually lands (fr-4otp) — silent for the same
   * reason: an emptied collection ends its own show.
   */
  advance(): void {
    if (this.deps.reducedMotion()) {
      this.stop();
      return;
    }
    this.advancing = true;
    try {
      if (this.deps.launchLeg()) return;
    } finally {
      this.advancing = false;
    }
    // Dry source: the finally above has already lifted the own-leg guard
    // by the time control reaches here, so this stop actually lands
    // (fr-4otp).
    this.stop();
  }
}
