import {
  identityRotorPair,
  normalizeRotorPair,
  rotateInPlane,
  rotorMatrix,
  slerpRotorPair,
} from "./rotor4";
import type { RotorPair } from "./rotor4";
import { smoothstep } from "./orbit";

/**
 * Live 4D projection VIEW state — the accumulated rotor (tumble ticks and
 * Shift-drag/Shift-wheel gestures all compose into it, see rotor4.ts), the
 * tumble pause/speed, and the soft w-slice — plus the pure decision table for
 * when a regenerate() must reset it (`viewTransition`). The instance is owned
 * by this session, while {@link FourDPose} snapshots its rotor/slice as Saved
 * view framing; auto-motion is browser-owned and speed is session-only. Kept separate from
 * main.ts's closure so the state machine is unit-tested without a browser,
 * the same way `orbit.ts` is for the 3D camera.
 *
 * `FourDView` never touches Three.js, the DOM, or the chaos game: it only
 * accumulates the view rotation and the slice window that `main.ts` pushes to
 * `scene.setRot4`/`scene.setFourDSlice` once per frame, and that the flame/
 * voxel render snapshot (main.ts's `fourDRenderSnapshot`) freezes for a
 * worker. The rotor pair itself stays PRIVATE: rotor4.ts's renormalization
 * invariant (see its module doc comment) only holds if every mutation goes
 * through `rotateInPlane` — or through rotor4.ts's `normalizeRotorPair` —
 * so this class exposes the pair only indirectly, via `matrix()`,
 * `reset()`, `tick()`, `rotate()`, `pose()` / `applyPose()` — unlike
 * `tumbleOn`/`tumbleSpeed`/`sliceOn`/`sliceCenter`/`sliceThickness`/
 * `sliceRelColor`, which are plain live fields with no invariant to protect,
 * so the animate loop and UI handlers read and write them directly. One
 * The shared browser-owned automatic-motion choice lives in main.ts; reset()
 * receives its already-resolved value and this class owns only the current
 * mechanism state.
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
 * The persistable 4D VIEW pose — the 4D sibling of orbit.ts's
 * `CameraPose`: the accumulated view rotor plus the soft w-slice
 * window, everything needed to reproduce a saved 4D framing. Deliberately
 * EXCLUDES `tumbleOn`/`tumbleSpeed`: on/off is the combined browser-owned
 * auto-motion preference, while speed is session-only; neither is document
 * state.
 */
export interface FourDPose {
  pair: RotorPair;
  sliceOn: boolean;
  sliceCenter: number;
  /** Slab half-thickness in the same normalized rotated-w units as
   * {@link FourDView.sliceThickness}; 0 for every pose saved
   * before the control existed, which is exactly the cross-section those
   * documents were framed with. */
  sliceThickness: number;
  sliceRelColor: boolean;
}

/**
 * Session-owned live 4D projection VIEW container: the accumulated rotor
 * (tumble + Shift-drag/wheel all compose into it), the tumble pause/speed, and
 * the soft w-slice. The live instance itself is never persisted, never part of
 * AppState/undo — but a `pose()` snapshot ({@link FourDPose})
 * IS persisted via the document (a saved/shared scene, a timeline keyframe),
 * restored on load through `applyPose()`, and the same snapshot
 * rides undo-history entries OUT OF BAND (history.ts's `ViewPose`), so
 * undo/redo across a whole-system replace restores the rotor/slice like the
 * orbit camera. main.ts owns pushing matrix()/slice
 * fields to the scene; this class owns the state + the math.
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
  /** Slab half-thickness in the same normalized rotated-w units as
   * {@link sliceCenter}; 0 is the zero-thickness cross-section every 4D
   * surface render was before the thickness control. */
  sliceThickness: number = 0;
  /** Recolor the w-ramp modes relative to the slice window? */
  sliceRelColor: boolean = false;

  /** Reset to the "fresh visit" baseline: rotor to identity, tumble running
   * according to the browser choice already resolved by main, speed at
   * default, and slice off/centered. Whenever the reset leaves the tumble
   * paused, the rotor is pre-seeded on one
   * generic orientation, because a paused projection sitting exactly on the
   * identity view would look indistinguishable from the flat 3D embed. */
  reset(autoMotion: boolean): void {
    this.pair = identityRotorPair();
    this.tumbleOn = autoMotion;
    this.tumbleSpeed = 1;
    if (!this.tumbleOn) {
      // pre-seed one generic orientation so a paused projection still reads as 4D
      this.pair = rotateInPlane(this.pair, "xy", 0.6);
      this.pair = rotateInPlane(this.pair, "zw", 0.9);
    }
    this.sliceOn = false;
    this.sliceCenter = 0;
    this.sliceThickness = 0;
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

  /** Snapshot the current view as a persistable {@link FourDPose}:
   * the rotor pair plus the four slice fields (thickness included) —
   * everything `applyPose` needs to reproduce this exact framing later (a
   * save, a share link, a timeline keyframe). The quaternions are
   * deep-copied into fresh arrays: the private `pair` must never leak by
   * reference, or a caller mutating the snapshot (or a later
   * `rotateInPlane`/`applyPose` call on THIS view) could corrupt it. */
  pose(): FourDPose {
    return {
      pair: {
        p: [this.pair.p[0], this.pair.p[1], this.pair.p[2], this.pair.p[3]],
        q: [this.pair.q[0], this.pair.q[1], this.pair.q[2], this.pair.q[3]],
      },
      sliceOn: this.sliceOn,
      sliceCenter: this.sliceCenter,
      sliceThickness: this.sliceThickness,
      sliceRelColor: this.sliceRelColor,
    };
  }

  /** Restore a {@link FourDPose} — the ONE sanctioned way to set
   * the rotor pair directly rather than composing it via `rotateInPlane`:
   * `pose.pair`'s halves are run through rotor4.ts's `normalizeRotorPair`,
   * which re-establishes the same unit-length invariant a `rotateInPlane`
   * chain maintains incrementally (see the class doc comment), so the pair
   * stays valid however the pose arrived (a JSON round trip, a hand-authored
   * timeline). If normalization fails — defensive only; a decoded pose has
   * already passed this same check once, in persist.ts — the current pair is
   * left untouched rather than clobbered with garbage. The four slice
   * fields are set from `pose` UNCONDITIONALLY, independent of whether the
   * pair validated. Never touches `tumbleOn`/`tumbleSpeed` — auto-motion is
   * excluded from `FourDPose` by design
   * (see its doc comment). */
  applyPose(pose: FourDPose): void {
    const normalized = normalizeRotorPair(pose.pair.p, pose.pair.q);
    if (normalized) this.pair = normalized;
    this.sliceOn = pose.sliceOn;
    this.sliceCenter = pose.sliceCenter;
    this.sliceThickness = pose.sliceThickness;
    this.sliceRelColor = pose.sliceRelColor;
  }
}

/** In-flight rotor/slice glide: a directed smoothstep to a SAVED
 * {@link FourDPose} — the 4D sibling of `camera-tween.ts`'s `PoseTween`. Only
 * the rotor and the two continuous slice scalars — CENTER and
 * THICKNESS — are interpolated over the glide; `sliceOn`/
 * `sliceRelColor` apply from the target immediately (see
 * `FourDTween.advance`) since a binary can't fade partway. */
interface FourDGlide {
  startMs: number;
  durationMs: number;
  fromPair: RotorPair;
  fromCenter: number;
  fromThickness: number;
  to: FourDPose;
}

/**
 * The directed rotor/slice glide a timeline leg drives — the 4D
 * sibling of `camera-tween.ts`'s `CameraTween.glideToPose`: a self-timed
 * smoothstep from the view's current rotor/slice to a SAVED {@link
 * FourDPose}, mutating an injected {@link FourDView} in place via {@link
 * FourDView.applyPose}. While a glide is active, main.ts suspends the
 * auto-tumble (`FourDView.tick`) — the glide owns the rotor for its
 * duration; the tumble resumes for the leg's hold once the glide lands.
 *
 * Like `CameraTween`, this owns no Three.js/DOM and takes its clock (`now`)
 * and the reduced-motion probe (`reducedMotion`) as injected capabilities, so
 * tests drive it with a fake clock and no browser.
 */
export class FourDTween {
  private glide: FourDGlide | null = null;

  /**
   * @param view The `FourDView` this glide mutates in place (via `applyPose`).
   * @param now Monotonic clock in ms (`() => performance.now()` in the app);
   *   both the start timestamp and the per-frame progress read the SAME clock.
   * @param reducedMotion True when the user asked to minimize motion — the
   *   glide is skipped and the pose is applied in a single snap.
   */
  constructor(
    private readonly view: FourDView,
    private readonly now: () => number,
    private readonly reducedMotion: () => boolean,
  ) {}

  /** Whether a glide is currently in flight. */
  get active(): boolean {
    return this.glide !== null;
  }

  /**
   * Glide the view to a SAVED {@link FourDPose} — a timeline leg's
   * 4D camera move — over `durationMs`, the leg's own morph length (not a
   * fixed constant, mirroring `CameraTween.glideToPose`). Under reduced
   * motion, or a non-positive `durationMs` (a zero-length glide's first
   * {@link advance} would otherwise divide by zero), snaps straight to the
   * pose via `view.applyPose` instead of animating, clearing any in-flight
   * glide. Starting a new glide replaces one already in flight — the
   * freshest request is the live intent.
   */
  glideToPose(pose: FourDPose, durationMs: number): void {
    if (this.reducedMotion() || durationMs <= 0) {
      this.view.applyPose(pose);
      this.glide = null;
      return;
    }
    this.glide = {
      startMs: this.now(),
      durationMs,
      fromPair: this.view.pose().pair,
      fromCenter: this.view.sliceCenter,
      fromThickness: this.view.sliceThickness,
      to: pose,
    };
  }

  /**
   * Advance the in-flight glide (a no-op when idle). Interpolates the rotor
   * by `slerpRotorPair` and the slice CENTER and THICKNESS by linear lerp,
   * all under the smoothstep of elapsed/durationMs; `sliceOn`/
   * `sliceRelColor` are taken from the TARGET from the very first frame — a
   * binary can't fade, so the arriving keyframe's slice on/off and
   * relative-color state establish immediately while only its continuous
   * scalars and the rotor's orientation glide. Clears itself once it reaches
   * the target (`t >= 1`: the final `applyPose` call has already landed the
   * exact target). Called once per animation frame by main.ts — like
   * `CameraTween.advance` — only while the 4D view is showing.
   */
  advance(): void {
    if (!this.glide) return;
    const { startMs, durationMs, fromPair, fromCenter, fromThickness, to } =
      this.glide;
    const t = smoothstep((this.now() - startMs) / durationMs);
    this.view.applyPose({
      pair: slerpRotorPair(fromPair, to.pair, t),
      sliceOn: to.sliceOn,
      sliceRelColor: to.sliceRelColor,
      sliceCenter: fromCenter + (to.sliceCenter - fromCenter) * t,
      sliceThickness: fromThickness + (to.sliceThickness - fromThickness) * t,
    });
    if (t >= 1) this.glide = null;
  }

  /** Cancel any in-flight glide outright, without moving the view — a user
   * Shift-drag grabbing the rotor mid-glide wins. */
  cancel(): void {
    this.glide = null;
  }

  /**
   * Complete an in-flight glide instantly: snap the view to the target pose
   * and clear it. A no-op when idle. Mirrors `CameraTween.finish`: a
   * flame/solid render freezes the rotor into its worker snapshot at enter,
   * so an in-flight glide must have LANDED by then, not still be gliding
   * toward its target.
   */
  finish(): void {
    if (!this.glide) return;
    this.view.applyPose(this.glide.to);
    this.glide = null;
  }
}
