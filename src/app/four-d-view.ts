import { identityRotorPair, rotateInPlane, rotorMatrix } from "./rotor4";
import type { RotorPair } from "./rotor4";

/**
 * Session-only 4D projection VIEW state — the accumulated rotor (tumble ticks
 * and Shift-drag/Shift-wheel gestures all compose into it, see rotor4.ts), the
 * tumble pause/speed, and the soft w-slice — plus the pure decision table for
 * when a regenerate() must reset it (`viewTransition`). Extracted from
 * main.ts's closure, where all of this used to live as loose `let` variables
 * inside `main()`, so the state machine is unit-tested without a browser, the
 * same way `orbit.ts` is for the 3D camera.
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
 * handlers read and write them directly.
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

  /** Reset to the "fresh visit" baseline: rotor to identity, tumble running at
   * default speed, slice off/centered. Under reduced motion, the tumble is
   * paused but the rotor is pre-seeded on one generic orientation so the
   * projection still reads as 4D at a glance. */
  reset(reducedMotion: boolean): void {
    this.pair = identityRotorPair();
    this.tumbleOn = !reducedMotion;
    this.tumbleSpeed = 1;
    if (reducedMotion) {
      // pre-seed one generic orientation so a paused projection still reads as 4D
      this.pair = rotateInPlane(this.pair, "xy", 0.6);
      this.pair = rotateInPlane(this.pair, "zw", 0.9);
    }
    this.sliceOn = false;
    this.sliceCenter = 0;
    this.sliceRelColor = false;
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
