/**
 * The pending load-hint policy (fr-vja8.34): a whole-system load arms up to
 * three hints that wait for the loaded cloud to actually LAND before they
 * fire — the render mode a preset/gallery entry/timeline step was authored
 * for (fr-39y/fr-75sq), the deterministic accumulator seed a timeline render
 * keyframe pins (fr-4ff7), and the saved 4D rotor/slice pose a document
 * carries (fr-pnek). Deferring them to arrival is the point: entering the
 * hinted renderer THEN — not at click time — lets the flame's frozen
 * projection snapshot a camera already fitted to the NEW attractor, and
 * applying the pose THEN lands it on top of the fresh-visit reset instead of
 * under it.
 *
 * What this module adds over three bare fields is the AWAIT KEY. The hints
 * used to be consumed (or discarded) by ANY replaced arrival, not the arrival
 * of the load that armed them — and a replaced request from the PREVIOUS load
 * can still be in flight when the next load arms. The interleaving is
 * deterministic, not exotic: a backgrounded tab's catch-up frame sends
 * timeline leg N's terminal replaced request and launches leg N+1 in one tick
 * (main.ts orders it exactly that way), so leg N's arrival consumed leg N+1's
 * hints — the mode entered a morph early with the wrong framing. Worse and
 * silent: a stale FLAT arrival nulled the pending 4D pose unconditionally, so
 * the real load's saved pose was discarded and the view fell back to the
 * fresh-visit reset — no error, just a scene restored posed wrong.
 *
 * So the await key — the smallest generation-request id that can be the
 * arming load's own — is recorded when the load's OPENING CLEAR runs
 * (`clearAll`, from the applyDecodedSnapshot/applyEdit every load path
 * enters through), via the injected `nextRequestId`
 * (CloudGenerator.peekNextId: ids are stamped monotonically at post time).
 * Consumption then requires `request.id >= awaitId`:
 *
 * - Captured at the CLEAR, not at the later arm, because the apply BETWEEN
 *   them can post the load's own landing synchronously: the non-morph
 *   restore path (undo/redo across a replace) and every reduced-motion load
 *   call `regenerate(true, ...)` inside the apply, so a key read at arm
 *   time would sit one id PAST the load's own request and the hint could
 *   never fire — the undo path's saved 4D pose would be silently lost, the
 *   precise symptom this module exists to fix, through a different door.
 * - `>=`, never `===`, because a morphing load's terminal replaced request
 *   is posted at morph END, many ids after the clear (every intermediate
 *   takes one) — and because the generator's latest-wins pending slot
 *   OR-merges a parked terminal into the NEWER request that overwrites it,
 *   so the arrival that lands a load's replacement can carry a later id
 *   than the load's own.
 * - An arrival BELOW the key is a request posted BEFORE this load began: an
 *   in-flight leftover of a previous load, which must neither consume a
 *   hint nor discard one. A request posted DURING the load's own apply — a
 *   snapped previous morph's terminal, or the load's own immediate
 *   regenerate — sits at or above the key and stays consumable, exactly as
 *   it always was: the fix draws the line at the load boundary, not inside
 *   the load's own tick.
 *
 * One await key covers all three hints because every arming site sits
 * immediately after an applyDecodedSnapshot/applyEdit that cleared all three
 * on the load's behalf — at any moment the armed hints all belong to the same
 * load, and the clear that wiped the previous load's hints is the same call
 * that opened this load's window. The seed is the one hint consumed OUT of
 * the arrival handler (nextRenderSeed takes it at whichever session start
 * the mode hint triggers), so `takeSeed` stays unconditional, exactly as
 * before.
 *
 * Pure and DOM-free so the interleaving is pinned by unit tests — the
 * fr-vja8.66/.67 extraction discipline; main.ts keeps only the wiring.
 */
import type { RenderMode } from "./state";
import type { FourDPose } from "./four-d-view";

/** The two request fields consumption keys on — structurally satisfied by
 * `cloud-worker-core.ts`'s CloudRequest without importing its full wire. */
export interface HintArrival {
  id: number;
  replaced: boolean;
}

export class PendingLoadHints {
  private modeHint: RenderMode | null = null;
  private seedHint: number | null = null;
  private poseHint: FourDPose | null = null;
  /** The request id the armed hints await — see the module doc. Stale (from
   * an older load) whenever nothing is armed, which is harmless: every take/
   * release no-ops on a null hint. */
  private awaitId = 0;

  /**
   * @param nextRequestId The id the NEXT generation request will be stamped
   * with (CloudGenerator.peekNextId), read lazily at each {@link clearAll} —
   * main.ts constructs this before the generator exists, and no clear can
   * run that early.
   */
  constructor(private readonly nextRequestId: () => number) {}

  /** The armed render mode, un-consumed — timelinePlayer's holding check
   * reads "is the render this hold awaits still coming". */
  get mode(): RenderMode | null {
    return this.modeHint;
  }

  /** Arm the render-mode hint. `null` is a real arm (onPreset passes
   * `PRESET_RENDER_HINTS[preset] ?? null` — most presets clear). Value only:
   * the await key was captured by the load's opening {@link clearAll}. */
  armMode(mode: RenderMode | null): void {
    this.modeHint = mode;
  }

  /** Arm the deterministic accumulator seed (fr-4ff7, timeline legs only). */
  armSeed(seed: number): void {
    this.seedHint = seed;
  }

  /** Arm the loaded document's 4D pose (fr-pnek). */
  armPose(pose: FourDPose): void {
    this.poseHint = pose;
  }

  /**
   * Every edit/load path's "a fresh edit supersedes whatever was waiting":
   * applyEdit, applyDecodedSnapshot, and a manual render-mode switch — AND
   * the moment the next load's await key is captured (see the module doc):
   * this runs at the top of the apply, BEFORE the apply can post the load's
   * own first request, so that request is `>=` the key and stays
   * consumable, while everything already in flight from before falls below
   * it. A clear with no arms after it (an ordinary edit, a manual mode
   * switch) just leaves the key high and the hints empty — harmless, since
   * every take/release no-ops on a null hint.
   */
  clearAll(): void {
    this.modeHint = null;
    this.seedHint = null;
    this.poseHint = null;
    this.awaitId = this.nextRequestId();
  }

  /** The user's hand landing on the 4D view takes it back from the document
   * (releaseFourDPoseControl): drop the pose, keep any mode/seed — a
   * timeline leg's render entry survives a mid-glide rotor grab. */
  clearPose(): void {
    this.poseHint = null;
  }

  /**
   * Consume the mode hint iff `arrival` is the awaited load's own replaced
   * landing (or a later one). A stale replaced arrival — id below the key —
   * returns null AND leaves the hint armed for the real landing.
   */
  takeMode(arrival: HintArrival): RenderMode | null {
    if (!arrival.replaced || arrival.id < this.awaitId) return null;
    const mode = this.modeHint;
    this.modeHint = null;
    return mode;
  }

  /** Consume the seed hint — unconditional, at whichever flame/solid session
   * start the consumed mode hint triggered (nextRenderSeed). */
  takeSeed(): number | null {
    const seed = this.seedHint;
    this.seedHint = null;
    return seed;
  }

  /**
   * The pose to apply where the fresh-visit reset would otherwise fire, or
   * null. Gated on the id alone — the first non-flat arrival of a morphing
   * load is replaced:FALSE and must still show the destination orientation —
   * and NOT consumed here: a morph's in-between arrivals must not strand the
   * terminal one pose-less (releasePose below keys off the replaced landing).
   * A stale arrival gets null: it must not apply the NEXT load's pose to the
   * PREVIOUS load's cloud.
   */
  poseFor(arrival: HintArrival): FourDPose | null {
    return arrival.id >= this.awaitId ? this.poseHint : null;
  }

  /**
   * Discard the pose hint once the awaited load's replaced request lands —
   * even when it lands flat (a corrupt document can pair a 4D pose with flat
   * transforms). The fix this module exists for: a stale replaced arrival
   * (id below the key) no longer discards a pose the NEXT load is still
   * waiting to land.
   */
  releasePose(arrival: HintArrival): void {
    if (!arrival.replaced || arrival.id < this.awaitId) return;
    this.poseHint = null;
  }
}
