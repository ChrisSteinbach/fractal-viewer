import { identityRotorPair, rotateInPlane, rotorMatrix } from "./rotor4";
import type { RotorPair } from "./rotor4";

/**
 * Session-only 4D projection VIEW state — the accumulated rotor (tumble ticks
 * and Shift-drag/Shift-wheel gestures all compose into it, see rotor4.ts), the
 * tumble pause/speed, and the soft w-slice — plus the pure decision table for
 * when a regenerate() must reset it (`viewTransition`). Kept separate from
 * main.ts's closure so the state machine is unit-tested without a browser,
 * the same way `orbit.ts` is for the 3D camera.
 *
 * `FourDView` never touches Three.js, the DOM, or the chaos game: it only
 * accumulates the view rotation and the slice window that `main.ts` pushes to
 * `scene.setRot4`/`scene.setFourDSlice` once per frame, and that the flame/
 * voxel render snapshot (main.ts's `fourDRenderSnapshot`) freezes for a
 * worker. The rotor pair itself stays PRIVATE: rotor4.ts's renormalization
 * invariant (see its module doc comment) only holds if every mutation goes
 * through `rotateInPlane`, so this class exposes the pair only indirectly —
 * via `matrix()`, `reset()`, `tick()`, and `rotate()` — unlike `tumbleOn`/
 * `tumbleSpeed`/`sliceOn`/`sliceCenter`/`sliceRelColor`, which are plain
 * session data with no invariant to protect, so the animate loop and UI
 * handlers read and write them directly. One exception since fr-g98: the UI's
 * tumble CHECKBOX flows through `setTumbleUserChoice`, not a bare `tumbleOn`
 * write, because a manual toggle must also be remembered as the sticky choice
 * that future `reset()`s respect.
 *
 * `viewTransition` is a free function, not a method, because it never touches
 * the rotor or the slice at all — it is main.ts's `regenerate()` deciding
 * whether THIS visit to the 4D (or 3D) view is "fresh" (a flat/non-flat flip,
 * or a whole-system replacement landing on either side) or merely a
 * continuation of the one already on screen (an in-place geometry edit to an
 * already-4D system, which must NOT reset a tumble/slice the user may be
 * mid-gesture on). Keeping it pure and separate from `FourDView` lets every
 * branch of that decision be asserted directly, without constructing a view
 * (or a scene) at all.
 */

// Auto-tumble BASE rates for the 4D projection: XY- and ZW-plane angular
// speeds in rad/s at the default 1x tumble speed. Slow and deliberately
// incommensurate-ish (~48 s and ~30 s per revolution at 1x) so the double
// rotation never visibly loops.
const FOUR_D_XY_RATE = 0.13;
const FOUR_D_ZW_RATE = 0.21;

/** Result of the reset-trigger decision (see viewTransition). */
export interface ViewTransition {
  /** Reset the 4D view to its "fresh visit" baseline (FourDView.reset). */
  resetFourD: boolean;
  /** Reset the 3D auto-orbit to its "fresh visit" baseline. */
  resetAutoOrbit: boolean;
  /** Clear the tumbling 4D scaffold left over from the previous 4D view. */
  clearScaffold: boolean;
}

/**
 * Pure decision table for what a regenerate() must reset when the system's
 * flatness and/or whole-system-replacement status changes. `nonFlat` is the
 * system that is about to be shown; `wasNonFlat` is the one currently shown;
 * `replaced` marks a whole-system replacement (preset load / Surprise Me) as
 * opposed to a mere geometry edit or explicit regenerate.
 */
export function viewTransition(
  nonFlat: boolean,
  wasNonFlat: boolean,
  replaced: boolean,
): ViewTransition {
  return {
    resetFourD: nonFlat && (replaced || !wasNonFlat),
    resetAutoOrbit: !nonFlat && (replaced || wasNonFlat),
    // wasNonFlat alone already makes the outer `!nonFlat && (replaced ||
    // wasNonFlat)` branch true, so this simplifies to `!nonFlat &&
    // wasNonFlat` — `replaced` is redundant once `wasNonFlat` is known.
    clearScaffold: !nonFlat && wasNonFlat,
  };
}

/**
 * Session-only 4D projection VIEW state: the accumulated rotor (tumble +
 * Shift-drag/wheel all compose into it), the tumble pause/speed, and the soft
 * w-slice. Never persisted, never part of AppState/undo. main.ts owns pushing
 * matrix()/slice fields to the scene; this class owns the state + the math.
 */
export class FourDView {
  private pair: RotorPair = identityRotorPair();

  /** The user's explicit tumble on/off choice, once they have ever touched
   * the checkbox (fr-g98). `null` = untouched, so reset() follows the
   * reduced-motion default; after a manual toggle reset() follows this
   * instead — a fresh visit must not re-enable a tumble the user turned off
   * (nor re-pause a reduced-motion user's explicit opt-in). Session-only,
   * like everything else here. */
  private tumbleUserChoice: boolean | null = null;

  /** Tumble running? Paused (false) under reduced motion after reset(). */
  tumbleOn: boolean = true;
  /** Tumble speed multiplier (user slider); 1 = base rate. */
  tumbleSpeed: number = 1;
  /** Soft w-slice enabled? */
  sliceOn: boolean = false;
  /** Slice window center in w. */
  sliceCenter: number = 0;
  /** Recolor the w-ramp modes relative to the slice window? */
  sliceRelColor: boolean = false;

  /** Reset to the "fresh visit" baseline: rotor to identity, tumble running
   * at default speed, slice off/centered. The tumble's on/off honors the
   * user's sticky choice when they have made one (see setTumbleUserChoice),
   * else the reduced-motion default. Whenever the reset leaves the tumble
   * paused — reduced motion or sticky off — the rotor is pre-seeded on one
   * generic orientation, because a paused projection sitting exactly on the
   * identity view would look indistinguishable from the flat 3D embed. */
  reset(reducedMotion: boolean): void {
    this.pair = identityRotorPair();
    this.tumbleOn = this.tumbleUserChoice ?? !reducedMotion;
    this.tumbleSpeed = 1;
    if (!this.tumbleOn) {
      // pre-seed one generic orientation so a paused projection still reads as 4D
      this.pair = rotateInPlane(this.pair, "xy", 0.6);
      this.pair = rotateInPlane(this.pair, "zw", 0.9);
    }
    this.sliceOn = false;
    this.sliceCenter = 0;
    this.sliceRelColor = false;
  }

  /** The user flipped the tumble checkbox: apply it AND remember it as the
   * sticky session choice that future reset()s preserve (fr-g98). Programmatic
   * writes (reset itself, the animate loop) must NOT come through here — only
   * a real user toggle earns stickiness. */
  setTumbleUserChoice(on: boolean): void {
    this.tumbleOn = on;
    this.tumbleUserChoice = on;
  }

  /** Seed the sticky tumble choice at boot from a REMEMBERED viewer preference
   * (fr-0ya) — the combined auto-motion pref that persist.ts deliberately keeps
   * out of the scene document / share URL (see viewer-prefs.ts). Sets ONLY the
   * remembered choice, not the live `tumbleOn`: the boot-time reset() that
   * follows on the first 4D entry reads it as `tumbleUserChoice ?? !reducedMotion`
   * and sets `tumbleOn` itself, so seeding never touches live state before the
   * reset owns it. Distinct from {@link setTumbleUserChoice}, which is an
   * in-session user toggle that must also apply immediately. */
  seedTumbleUserChoice(on: boolean): void {
    this.tumbleUserChoice = on;
  }

  /** Advance the tumble by dt seconds (no-op when paused): compose the XY- and
   * ZW-plane base rates * tumbleSpeed into the rotor. */
  tick(dt: number): void {
    if (this.tumbleOn) {
      this.pair = rotateInPlane(
        this.pair,
        "xy",
        dt * FOUR_D_XY_RATE * this.tumbleSpeed,
      );
      this.pair = rotateInPlane(
        this.pair,
        "zw",
        dt * FOUR_D_ZW_RATE * this.tumbleSpeed,
      );
    }
  }

  /** Compose the given w-plane drag/wheel deltas (radians) onto the rotor;
   * each zero delta is skipped. */
  rotate(xw: number, yw: number, zw: number): void {
    if (xw !== 0) this.pair = rotateInPlane(this.pair, "xw", xw);
    if (yw !== 0) this.pair = rotateInPlane(this.pair, "yw", yw);
    if (zw !== 0) this.pair = rotateInPlane(this.pair, "zw", zw);
  }

  /** Row-major 4x4 view rotation for the uRot4 shader uniform (rotorMatrix). */
  matrix(): number[] {
    return rotorMatrix(this.pair);
  }
}
