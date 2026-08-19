/**
 * The Save-PNG wait policy: WHAT a Save-PNG pressed in a render mode has to
 * wait for before its capture may run, WHICH mode's wait can be cut short
 * with a picture, and HOW a press that raced the finishing render resolves.
 * Extracted from main.ts on the `export-progress.ts` precedent — that
 * module is the same feature's other half, the modal's timing policy,
 * already DOM-free and tested; this one is the wait that modal discloses.
 * main.ts's `planPngExport` arms spread {@link
 * ExportWaitPolicy.planRenderWait}'s result into their plans, and
 * contribute nothing of their own to the rules here — which is the point:
 * the policy is order-sensitive (the ties-go-to-budget re-check, the
 * early-save latch whose absence measurably delivered the previous
 * session's canvas at the previous session's size), and order-sensitive
 * logic buried in main.ts was covered only by the minutes-long browser
 * gate.
 *
 * Every live signal — the flame budget flag and its coverage fraction,
 * the sessions' first-frame gates, the app's current render mode, and the
 * render-signal park/wake pair — arrives through {@link ExportWaitDeps},
 * so the whole policy is unit-tested with stub runs and a manual render
 * signal: no sessions, no workers, no DOM. The dep surface models
 * main.ts's own vocabulary exactly (`renderComplete.flame`,
 * `RenderSession.hasFirstFrame`, `nextRenderSignal`/`notifyRenderSignal`),
 * so the wiring there is one closure per line.
 */

import type { ExportRun } from "./export-progress";

/** The three render modes whose Save-PNG has something to wait FOR. The
 * points explorer is deliberately not one of them: it is already on
 * screen, so its plan carries no wait at all. */
export type ExportWaitMode = "flame" | "solid" | "surface";

/** The one way {@link ExportWaitPolicy.planRenderWait}'s wait ends without
 * an image. */
export const EXPORT_RENDER_STOPPED_NOTE = "Render stopped — no PNG saved";

/** The export modal's early-save label. "Save now" says what the
 * button does; "(rough)" is the part that had to be there — the picture it
 * saves is categorically coarser than the one the wait is for, and a bare
 * "Save now" beside a percent readout would read as "save the finished
 * thing, sooner". The toast the file lands with echoes the same word. */
export const EXPORT_SAVE_EARLY_LABEL = "Save now (rough)";

/** Everything {@link createExportWait} needs from the app, injected so the
 * wait policy stays pure and testable (the `export-progress.ts` /
 * `drift-policy.ts` pattern). Each member is one main.ts closure. */
export interface ExportWaitDeps {
  /** The flame accumulation has MET ITS BUDGET (`renderComplete.flame`) —
   * the flame wait's target; see the doc on the readiness rule inside
   * {@link createExportWait} for why its first frame is not enough. */
  flameComplete: () => boolean;
  /** The flame accumulation's coverage fraction, 0..1
   * (`renderCoverage.flame`) — the one real percent any of these waits
   * has to disclose. */
  flameCoverage: () => number;
  /** The mode's session has produced its first frame
   * (`RenderSession.hasFirstFrame`). */
  hasFirstFrame: (mode: ExportWaitMode) => boolean;
  /** The app's CURRENT render mode (`state.renderMode`) — wider than
   * {@link ExportWaitMode} because "points" is a value it takes: a wait
   * aborts the moment this stops matching its own mode. */
  renderMode: () => string;
  /** Resolve on the next render signal: progress landed, a session
   * exited, a playback stopped, an export was cancelled (main.ts's
   * `nextRenderSignal`). The wait parks on nothing else. */
  nextRenderSignal: () => Promise<void>;
  /** Fire the render signal NOW (main.ts's `notifyRenderSignal`) — the
   * early-save press's wake, since the next natural signal can be a whole
   * accumulation chunk away. `planRenderWait` hands this straight to the
   * modal's `onDeliver`, exactly as main.ts wired the free function. */
  notifyRenderSignal: () => void;
}

/** The wait half of a Save-PNG plan: what main.ts's `planPngExport` arms
 * spread into their `PngExportPlan`. `awaitReady` blocks until the mode's
 * own render IS the picture the capture will read, resolving null when it
 * is (a cancel resolves null too — `run.cancelled` is the caller's to
 * report) or a user-presentable note when it never will be. `deliverEarly`
 * is present only for the one mode whose wait has a partial to hand over
 * — ABSENT, not undefined-valued, everywhere else, so no view
 * can offer the action on a run that never earned it. */
export interface RenderWaitPlan {
  awaitReady: (run: ExportRun) => Promise<string | null>;
  deliverEarly?: {
    label: string;
    onDeliver: () => void;
    /** Read back AFTER the capture: it answers what actually happened
     * rather than what was pressed, so a press the finished render beat
     * to the line does not get labelled rough. */
    taken: () => boolean;
  };
}

/** The Save-PNG wait policy, one method wide on purpose: an arm asks for
 * its mode's wait and receives whatever affordances that mode has earned,
 * and cannot spell out a different answer. */
export interface ExportWaitPolicy {
  planRenderWait(mode: ExportWaitMode): RenderWaitPlan;
}

/**
 * Create the wait policy over the app's live signals. Pure wiring: the
 * deps are read at wait time, never captured at creation, so the policy
 * object can be built before the sessions it describes exist.
 */
export function createExportWait(deps: ExportWaitDeps): ExportWaitPolicy {
  /**
   * What a Save-PNG has to wait for before the mode it was pressed in can
   * be captured.
   *
   * FLAME is the one renderer whose export IS the live accumulation — the
   * surface arm traces a fresh frame at export scale and the solid arm
   * re-raymarches, both at capture time — so flame waits for that
   * accumulation to MEET ITS BUDGET, where the other two only wait for
   * their session's first frame. Not a nicety: the worker's finishing
   * chunk re-filters the histogram adaptively where every
   * progressive frame uses the fixed-radius filter, so a mid-accumulation
   * capture saves a categorically coarser picture, not merely a noisier
   * one.
   */
  function renderExportReady(mode: ExportWaitMode): boolean {
    if (mode === "flame") return deps.flameComplete();
    return deps.hasFirstFrame(mode);
  }

  /**
   * Whether a mode's {@link renderExportReady} wait can ever be cut short
   * with a picture — the one thing that decides whether the
   * export modal offers its second action.
   *
   * FLAME ALONE, and structurally so. Its canvas already holds every
   * iteration the worker has landed and IS the export, so
   * cutting the wait short delivers a real image — coarser, per the
   * adaptive re-filter in {@link renderExportReady}'s doc, but the picture
   * on screen. The other two waits have nothing to give: solid's is for
   * the voxel grid its raymarch needs as INPUT, and surface's is for a
   * first frame — before either lands there is no partial, only an empty
   * capture.
   *
   * {@link planRenderWait} is the only reader, which is the point of it
   * being a predicate: no arm of main.ts's `planPngExport` restates the
   * rule, so no future arm can offer the action by copying its neighbour.
   */
  function renderExportOffersEarlySave(mode: ExportWaitMode): boolean {
    return mode === "flame";
  }

  /**
   * Whether the partial {@link renderExportOffersEarlySave} promises
   * exists RIGHT NOW — what {@link awaitRenderExportable} honours a press
   * against.
   *
   * The flame canvas only becomes THIS session's picture at THIS session's
   * size when the worker's first chunk lands (`markFirstFrame`, beside the
   * `setFlameImage` that resizes it); the `restarted` event's deliberate
   * lack of one says the same thing from the other side. Until then the
   * canvas still holds the PREVIOUS session's image at the PREVIOUS
   * session's size — and the Export-size select restarts the session on
   * purpose, so this is not a corner: it is the headline case.
   *
   * MEASURED, on the first cut of this, which honoured a press with no such
   * gate: 4x, pressed the moment the modal appeared, delivered an 820x540
   * PNG byte-identical to the 1x render it had just replaced, with the
   * modal quoting "3280 × 2160" beside it — the fall-through bug's own
   * wrong-subject, wrong-size export, re-entered through the new door. So
   * the press LATCHES (`ExportRun.stop` is terminal) and delivers the
   * instant a frame of this session's own exists, which makes the early
   * save exactly "wait for the first frame instead of the whole budget" —
   * the wait the solid and surface arms do outright.
   */
  function renderExportPartialReady(mode: ExportWaitMode): boolean {
    return renderExportOffersEarlySave(mode) && deps.hasFirstFrame("flame");
  }

  /**
   * Block a Save-PNG until {@link renderExportReady}, disclosing the wait
   * through the export modal's run.
   *
   * This is what replaced the old readiness GATE. Every arm used to read
   * `renderMode === X && session.hasFirstFrame`, and the fall-through when
   * a gate failed captured the points explorer — so pressing Save during
   * any render's startup gap silently saved a DIFFERENT render mode's
   * image, and for flame that gap is opened by the Export-size select
   * itself (its effect restarts the session). Waiting is the honest
   * answer, and it costs nothing to build: the modal already discloses
   * coverage and offers Cancel.
   *
   * Resolves null once the capture may proceed, or a user-presentable note
   * when it never will — the session ended under us (a worker error's
   * exit, the user leaving the mode), which is the only way this loop
   * terminates without success. A cancel resolves null too:
   * `run.cancelled` is the caller's to report, exactly as on the capture
   * arms.
   */
  async function awaitRenderExportable(
    mode: ExportWaitMode,
    run: ExportRun,
  ): Promise<string | null> {
    while (!renderExportReady(mode)) {
      if (run.cancelled) return null;
      // The user asked for the picture AS IT STANDS. Tested
      // AFTER the loop's own condition, which is what settles the race
      // when the budget is met in the same turn as the press: a ready
      // render exits the loop first and the FINISHED picture saves. That
      // ordering is the one that can't disappoint — "save now" gets a
      // save now either way, and only the coarser outcome is ever
      // labelled coarse.
      if (run.stop === "deliver" && renderExportPartialReady(mode)) return null;
      if (deps.renderMode() !== mode) return EXPORT_RENDER_STOPPED_NOTE;
      // Flame is the only arm with real coverage to show — a solid grid
      // and a surface first frame arrive whole, so the honest percent for
      // those is no percent at all (the modal's indeterminate state).
      run.report(mode === "flame" ? deps.flameCoverage() : null);
      await deps.nextRenderSignal();
    }
    return null;
  }

  /**
   * The wait a Save-PNG does before capturing, plus — for the one mode
   * whose wait has a picture to hand over — the modal action that cuts it
   * short.
   *
   * Built here rather than arm by arm so that "which modes offer the
   * early save" is one predicate consulted in one place: an arm of
   * main.ts's `planPngExport` asks for its mode's wait and receives
   * whatever affordances that mode has earned, and cannot spell out a
   * different answer. `taken` is settled from the world at the moment the
   * wait resolves — a `"deliver"` stop that the finished render beat to
   * the line leaves `renderExportReady` true, and the capture that
   * follows is the ordinary complete one.
   */
  function planRenderWait(mode: ExportWaitMode): RenderWaitPlan {
    if (!renderExportOffersEarlySave(mode)) {
      return { awaitReady: (run) => awaitRenderExportable(mode, run) };
    }
    let early = false;
    return {
      deliverEarly: {
        label: EXPORT_SAVE_EARLY_LABEL,
        // The wait is parked on nothing but render signals, and the next
        // one can be a whole accumulation chunk away — the same reason
        // main.ts's savePng Cancel wakes it.
        onDeliver: deps.notifyRenderSignal,
        taken: () => early,
      },
      awaitReady: async (run) => {
        const blocked = await awaitRenderExportable(mode, run);
        early = run.stop === "deliver" && !renderExportReady(mode);
        return blocked;
      },
    };
  }

  return { planRenderWait };
}
