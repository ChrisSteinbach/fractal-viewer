import { toTransform4 } from "../fractal/affine4";
import { wSupport } from "./rotor4";
import { FourDView, viewTransition } from "./four-d-view";
import {
  buildColors,
  buildColors4,
  colorModeUsesRampPalette,
  dimColorsExcept,
  fourDColorNeedsAttribute,
  W_SIDE_PALETTES,
} from "../fractal/color";
import {
  DEFAULT_GAMMA_THRESHOLD,
  tonemapFlame,
  viewFlameHistogram,
} from "../fractal/flame";
import { flameAccumBudgetBuckets } from "./flame-worker-core";
import type { FlameWorkerCommand, FlameWorkerEvent } from "./flame-worker-core";
import type { SharedFrameBuffers } from "./flame-worker-core";
import type { RenderSessionHandle } from "./render-session";
import { voxelAccumBudgetVoxels } from "./voxel-worker-core";
import type { VoxelWorkerCommand, VoxelWorkerEvent } from "./voxel-worker-core";
import { CloudGenerator } from "./cloud-generator";
import type { CloudParams } from "./cloud-generator";
import { generateCloud } from "./cloud-worker-core";
import type {
  CloudRequest,
  CloudResult,
  CloudResult3D,
  CloudResult4D,
} from "./cloud-worker-core";
import { glowExposure } from "./exposure";
import {
  defaultFinalTransform,
  PRESET_RENDER_HINTS,
  PRESET_SCAFFOLDS,
  presetTransforms,
} from "../fractal/presets";
import { CUSTOM_PALETTE_ID, resolvePalette } from "../fractal/palette";
import { mutateSystem } from "../fractal/mutate-system";
import { renderSystemThumb } from "./mutation-thumbs";
import { randomSystem } from "../fractal/random-system";
import { BOOT_CAMERA_POSITION, OrbitCamera, type CameraPose } from "./orbit";
import { FOUR_D_SLICE_WIDTH, FractalScene } from "./scene";
import { attachInteractions } from "./interactions";
import { registerServiceWorker } from "./register-sw";
import { Ui } from "./ui";
import { EditSession, SAVE_DEBOUNCE_MS } from "./edit-session";
import { RenderSession } from "./render-session";
import { createCanvasRecorder, formatElapsed } from "./recorder";
import { createResolutionGovernor } from "./resolution-governor";
import {
  addTransform,
  DEFAULT_SYMMETRY_AXIS,
  DEFAULT_SYMMETRY_ORDER,
  initialState,
  removeTransform,
  selectTransform,
  setCustomPaletteStops,
  setFinalTransform,
  setPanelOpen,
  setPositionAxisColors,
  setRenderMode,
  setSymmetryAxis,
  setSymmetryOrder,
  setTransforms,
  systemPartsAreNonFlat,
  updateTransform,
} from "./state";
import type { AppState, RenderMode } from "./state";
import { applyScalarControl } from "./control-spec";
import type { ControlEffects } from "./control-spec";
import {
  decodeScene,
  encodeScene,
  fromSnapshot,
  loadScene,
  saveScene,
  toSnapshot,
} from "./persist";
import type { SceneSnapshot } from "./persist";
import { loadViewerPrefs, saveViewerPrefs } from "./viewer-prefs";
import { SceneCollection, type SavedSceneMode } from "./collection";
import { MOBILE_BREAKPOINT } from "./constants";
import { MorphBudget } from "./morph-budget";
import type { Bounds, Vec4 } from "../fractal/types";
import { CameraTween, fourDFramingBounds } from "./camera-tween";
import { BuildReplay, SPOTLIGHT_DIM } from "./build-replay";
import { MorphTween, MORPH_TWEEN_MS, type MorphSample } from "./morph-tween";
import {
  DriftShow,
  DRIFT_DWELL_MS,
  DRIFT_MORPH_MS,
  DRIFT_RENDER_LINGER_MS,
} from "./drift";
import { DriftPolicy } from "./drift-policy";
import type { MorphSystem } from "../fractal/morph";
import { createFrameCoalescer } from "./regen-scheduler";

function showError(message: string): void {
  const loading = document.getElementById("loading");
  const error = document.getElementById("error");
  if (loading) loading.style.display = "none";
  if (error) {
    error.textContent = message;
    error.style.display = "block";
  }
  console.error("Fractal Viewer:", message);
}

/**
 * Shown when register-sw.ts reports an update. Usually that means the new
 * worker is still WAITING for this page to say go (fr-o13) — so the banner
 * now appears before anything breaks, not after — but it also still covers
 * the rarer took-over-without-asking case (another tab already accepted).
 * Reload hands off to register-sw.ts's accept dance: message the waiting
 * worker and reload once it takes over, or, in the already-took-over case,
 * just reload. Dismissible either way; never forces the reload.
 */
function showUpdateBanner(acceptUpdate: () => void): void {
  const banner = document.getElementById("updateBanner");
  const reload = document.getElementById("updateReloadBtn");
  const dismiss = document.getElementById("updateDismissBtn");
  if (!banner || !reload || !dismiss) return;
  // onclick assignment (not addEventListener) so repeated controllerchange
  // events — one per deploy landing while this tab stays open — rewire
  // idempotently instead of stacking duplicate listeners.
  reload.onclick = () => acceptUpdate();
  dismiss.onclick = () => banner.classList.add("hidden");
  banner.classList.remove("hidden");
}

// User-facing note for a runtime accumulate failure (fr-09w), shared by the
// flame and solid worker "error" handlers. Distinct from showRenderError's
// default "try reloading" hint: a reload won't reliably fix a compute fault,
// so this just states what happened rather than over-promising.
const RENDER_ACCUMULATE_ERROR = "Render failed — returning to the explorer.";

/**
 * Small dismissible notice (top-center, so it never overlaps the bottom-
 * center update banner) shown when a flame/solid render fails and we fall
 * back to the explorer — otherwise the fallback just looks like "nothing
 * happens" on Render. Two triggers, two messages:
 *
 *  - Default ("try reloading", fr-ssa): a worker that fails to LOAD or
 *    crashes (`worker.onerror`). A reload often clears this (a stale-deploy
 *    404 — which fr-k1z's update banner also covers proactively — or a
 *    transient load fault). The bare load-failure Event carries nothing
 *    worker-specific to show, so the fixed hint is all we can offer.
 *  - Custom (fr-09w): a loaded worker posts an "error" event because an
 *    accumulate step failed at runtime. A reload won't reliably fix a compute
 *    fault, so callers pass a message that states what happened. (The
 *    technical detail stays in the console.error alongside the call.)
 *
 * The span text is set on every call so a custom message can never stick and
 * mislabel a later default (load-failure) notice.
 */
function showRenderError(message = "Render failed — try reloading."): void {
  const notice = document.getElementById("renderError");
  const dismiss = document.getElementById("renderErrorDismissBtn");
  if (!notice || !dismiss) return;
  const text = notice.querySelector("span");
  if (text) text.textContent = message;
  // onclick (not addEventListener) so repeated worker failures rewire the
  // dismiss handler idempotently instead of stacking duplicate listeners.
  dismiss.onclick = () => notice.classList.add("hidden");
  notice.classList.remove("hidden");
}

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl") ?? canvas.getContext("experimental-webgl");
    return Boolean(window.WebGLRenderingContext && gl);
  } catch {
    return false;
  }
}

/**
 * Copy `text` to the clipboard, resolving `true` on success (fr-cai's "Copy
 * link"). Uses the async Clipboard API — available in the app's HTTPS/secure
 * contexts under the button's user gesture — and resolves `false` when it's
 * unavailable or rejects, so the caller can flash a fallback message instead
 * of throwing.
 */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** True when the user asked the OS to minimize non-essential motion. Reused by
 * the camera auto-fit and the 4D auto-tumble, both of which fall back to a
 * static view when it holds. */
function prefersReducedMotion(): boolean {
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true
  );
}

/**
 * fr-ul2: `?flameperf` (present with or without a value) opts the flame render
 * into per-chunk throughput instrumentation — see the flame `start` command's
 * `instrument` field. Diagnostics only, off unless the URL asks, so a phone
 * soak (fr-7su) can log the accumulate / readback / scheduling-gap split that
 * pins the real-app mobile-GPU throughput deficit without shipping the timing
 * overhead to every render.
 */
function flamePerfEnabled(): boolean {
  return new URLSearchParams(window.location.search).has("flameperf");
}

/**
 * Auto-orbit BASE rate for the 3D view (fr-1yn): camera theta in rad/s at the
 * default 1× orbit speed (the user's speed slider multiplies it — see
 * `autoOrbitSpeed`). One revolution every ~52 s — stately, not a spinner —
 * and in the same family as the 4D tumble rates (see `four-d-view.ts`).
 * Negative-theta direction, matching a slow rightward drag (see
 * OrbitCamera.rotate).
 */
const AUTO_ORBIT_RATE = 0.12;

/**
 * Ceiling for the SYNCHRONOUS boot generation (fr-t3gl). Boot generates
 * inline so the first paint includes the cloud — but a persisted or shared
 * scene can carry up to MAX_NUM_POINTS (5M), which would block first paint
 * for seconds on weak hardware. Boot therefore runs at most this many points
 * synchronously and immediately requests the full count through the worker;
 * with the SAME seed, the chaos game makes the boot cloud a bit-exact prefix
 * of the upgrade, so the extra points pour in without a reshuffle. 30K is
 * plenty for the boot camera fit: the trimmed-quantile frameBounds
 * (framing-bounds.ts) are statistically stable well below that.
 */
const BOOT_SYNC_MAX_POINTS = 30_000;

function main(): void {
  const container = document.getElementById("container");
  if (!container) {
    showError("Missing #container element.");
    return;
  }
  if (!webglAvailable()) {
    showError(
      "WebGL is not supported. Please use a modern browser like Chrome or Firefox.",
    );
    return;
  }

  let scene: FractalScene;
  try {
    scene = new FractalScene(container);
  } catch (e) {
    showError(`Failed to create WebGL renderer: ${(e as Error).message}`);
    return;
  }

  const panelOpen = window.innerWidth > MOBILE_BREAKPOINT;
  const saved = loadScene();
  let state: AppState = saved
    ? fromSnapshot(saved, initialState(panelOpen))
    : initialState(panelOpen);
  const orbit = new OrbitCamera(BOOT_CAMERA_POSITION);
  const ui = new Ui(document);

  // Whether a video capture is running (fr-py7z): canvas capture streams only
  // emit frames when the canvas actually paints, so the render-on-demand gate
  // in animate() must keep rendering every frame while this is true — a
  // static scene must still record as a video of that scene, not a stall.
  let recorderActive = false;

  // Adaptive resolution (fr-4lyt): a pure frame-time governor decides when
  // sustained slow frames should trade pixels for frame rate (and when the
  // device has earned them back); animate() feeds it the dt between
  // consecutively rendered frames via governResolution below.
  const resolutionGovernor = createResolutionGovernor();
  // Timestamp of the last frame the governor sampled; null whenever the
  // chain of consecutively rendered frames breaks (a skipped frame, a mode
  // where sampling is off), so a gap never reads as one huge dt.
  let lastGovernedFrameMs: number | null = null;
  const recorder = createCanvasRecorder(scene.canvas, {
    onStateChange: (recording) => {
      recorderActive = recording;
      ui.setRecordingState(recording ? formatElapsed(0) : null);
    },
    onTick: (seconds) => {
      ui.setRecordingState(formatElapsed(seconds));
    },
    onError: (message) => {
      console.error(`Video recording: ${message}`);
    },
  });

  // The saved-scene collection (fr-cai): a persistent multi-slot library the
  // user explicitly saves into, layered over the SAME encodeScene codec the
  // single-scene autosave and undo history use — so a saved entry is just an
  // immutable encoded string plus a thumbnail, and loading one is a
  // whole-system replacement like a preset (see loadEncodedScene). Distinct
  // localStorage key, so it never disturbs the live scene or its history.
  const collection = new SceneCollection();

  // The most recently ARRIVED generation (cached by applyCloudResult), so
  // a color-mode change can recolor the existing cloud (see `recolor`) instead
  // of re-rolling the RNG and drawing a brand-new random sample of the
  // attractor. While a generation is in flight (fr-5kx) this still holds the
  // cloud actually on screen — exactly what its readers want. Typed as the
  // WORKER result (not the bare chaos-game run) because the camera fit reads
  // the worker-baked `frameBounds` off it (fr-3xfk).
  let lastResult: CloudResult3D | null = null;

  // Whether the DISPLAYED cloud is the 4D projection view — a DERIVED
  // property of the system that produced it (fr-bf6; see state.ts's
  // systemIsNonFlat), not a mode the user enters/exits. Written only by
  // applyCloudResult when a generation lands (fr-5kx), so it always matches
  // what is on screen — during the brief in-flight window after an edit flips
  // flatness, the view (material, guides, gestures) deliberately stays with
  // the old cloud until the new one arrives. animate()'s tumble tick, the
  // interactions predicate, and guide-box suppression all read it.
  let viewIs4D = false;

  // The most recent 4D generation — mirrors `lastResult` for the 3D path,
  // so a whole-system replacement (preset load / Surprise Me) can auto-frame
  // the camera on it right after regenerate() lands a fresh run (see
  // fitCameraToAttractor; the fit reads the worker-baked `frameRadius`,
  // fr-3xfk). Null whenever the view isn't showing 4D.
  let fourDResult: CloudResult4D | null = null;

  // A preset's render-mode hint (fr-39y, PRESET_RENDER_HINTS), waiting for
  // the freshly loaded system's cloud to land: onPreset arms it, and
  // applyCloudResult consumes it when the whole-system replacement arrives —
  // entering the hinted renderer THEN, not at click time, so the flame's
  // frozen projection can snapshot the camera already fitted to the NEW
  // attractor (see the consumption site) instead of framing the old one.
  // Cleared by every other edit path (applyEdit / applyDecodedSnapshot) and
  // by a manual mode switch, so it can only ever fire for the load that
  // armed it.
  let pendingRenderMode: RenderMode | null = null;
  // The session-only 4D VIEW state (fr-woc/fr-6x2/fr-nn6): the accumulated
  // rotor (tumble ticks and Shift-drag/Shift-wheel deltas all compose into it),
  // the tumble pause/speed, and the soft w-slice. Reset to a fresh-visit
  // baseline by resetFourDView() whenever the view starts showing a genuinely
  // new 4D system, never persisted. The state machine + its math live in
  // four-d-view.ts; this file just pushes matrix()/slice fields to the scene.
  const fourDView = new FourDView();

  // The 3D auto-orbit (fr-1yn): the camera-side sibling of the 4D tumble
  // above — a slow turntable on the orbit camera's theta, so a flat system's
  // cloud reads as 3D at a glance the way the tumble sells 4D. Session-only
  // like the tumble (never persisted, never in AppState/undo), reset by
  // resetAutoOrbitView() on a fresh visit to the 3D view. Unlike the tumble
  // it shares its degree of freedom with the plain drag gesture, so animate()
  // additionally pauses it while interactions reports a gesture in progress.
  let autoOrbitOn = true;
  let autoOrbitSpeed = 1;
  // The user's explicit auto-orbit on/off choice, once they have ever touched
  // the toggle (fr-g98). null = untouched, so fresh-visit resets follow the
  // reduced-motion default; after a manual toggle they follow this instead —
  // a preset load / Surprise Me / 4D→3D flip must not re-enable an orbit the
  // user turned off (nor re-pause a reduced-motion user's explicit opt-in).
  // Session-only like the orbit itself; the tumble's twin lives inside
  // FourDView (setTumbleUserChoice).
  let autoOrbitUserChoice: boolean | null = null;

  // Restore the COMBINED auto-motion preference (fr-0ya): a viewer who turned
  // auto-orbit or 4D-tumble off keeps it off across RELOADS, not merely within
  // the session (fr-g98's stickiness). The one shared choice seeds BOTH the 3D
  // orbit and the 4D tumble here — before the boot cloud generation
  // (generateSync) and the boot resetAutoOrbitView() below both read these
  // choices. Stored SEPARATELY from the scene (viewer-prefs.ts, its own
  // localStorage key), never in the share URL — a shared link must not carry
  // the author's motion preference. Absent = never chosen = follow the
  // reduced-motion default, exactly like the session-only null / FourDView's
  // `tumbleUserChoice = null` do. Session independence is unchanged: this only
  // seeds the two sticky choices; it does not couple the live toggles.
  const viewerPrefs = loadViewerPrefs();
  if (viewerPrefs.autoMotion !== undefined) {
    autoOrbitUserChoice = viewerPrefs.autoMotion;
    fourDView.seedTumbleUserChoice(viewerPrefs.autoMotion);
  }

  // Shared frame clock for the explorer path's automatic motion (the 4D
  // tumble and the 3D auto-orbit). Advances every explorer frame — paused,
  // dragging, or not — so resuming never replays the gap as a jump; it
  // simply doesn't tick during flame/solid renders (animate() returns
  // early), which the dt clamp in animate() absorbs on exit.
  let lastMotionTickMs = performance.now();

  // fr-936q: on desktop the 300px control panel overlays the canvas's right
  // edge, so the projection is aimed at the UNCOVERED region instead
  // (scene.setRightInset) — every auto-fit (preset glide, Surprise Me, morph
  // chase) then frames the attractor clear of the panel rather than half
  // under it. The target is re-derived each frame in animate() (panel state,
  // breakpoint, and resizes all fold into one comparison) and eased so a
  // panel toggle glides rather than snaps; reduced motion snaps. Measured
  // once: the panel's width is fixed CSS; remeasuring per frame would force
  // layout.
  const panelWidthPx = document.getElementById("panel")?.offsetWidth ?? 300;
  const panelInsetTarget = (): number =>
    state.panelOpen && window.innerWidth > MOBILE_BREAKPOINT ? panelWidthPx : 0;
  let sceneRightInset = panelInsetTarget();
  let lastInsetTickMs = performance.now();
  scene.setRightInset(sceneRightInset);

  // The "Watch it build" replay (fr-1zb): reveals the displayed cloud in
  // chaos-game generation order — the buffers arrive in exactly the order
  // the orbit plotted them — so the app can SHOW what the About dialog
  // explains: one point hopping between random transforms, its landings
  // accreting into the attractor. Session-only view state (never in
  // AppState/undo, like the tumble); animate()'s explorer branch polls it
  // once per frame. Deliberately not gated on prefers-reduced-motion: it
  // only ever plays as the direct result of a "▶ Watch it build" click, and
  // an explicitly requested animation is exactly the motion that setting
  // preserves.
  const buildReplay = new BuildReplay(() => performance.now());
  // The narration line the replay pill currently shows, so the per-frame
  // poll touches the DOM only when the phase actually flips — and doubles as
  // the "display is still dirty" flag after the replay goes idle on its own.
  let replayCaption: string | null = null;
  // The map index whose spotlight colors are currently painted over the
  // point buffer (fr-01kf), or null while the cloud wears its ordinary
  // colors. Compared against the frame's `spotlight` each poll so the color
  // re-bake runs once per step, not once per frame; endReplayDisplay reads
  // it to know a repaint is owed even when the showcase's own color
  // override never armed (the user's mode already was "transform").
  let replaySpotlight: number | null = null;
  // Whether the panel was open the moment "Watch it build" closed it
  // (fr-vpka), so endReplayDisplay can restore it once the replay ends —
  // null while no replay's close is pending restoration. Set once, in
  // onWatchBuild, right before the panel is forced shut; consumed (and
  // reset to null) the first time endReplayDisplay runs afterward, whichever
  // of natural completion or cancellation gets there first.
  let panelOpenBeforeReplay: boolean | null = null;
  // The replay's showcase overrides (fr-hpci): while a replay plays, the
  // display presents its most didactic view regardless of the user's current
  // settings — by-transform coloring (each landing's parent map is legible),
  // guide boxes visible (the point visibly hops BETWEEN the transforms), and
  // the view's automatic motion running (auto-orbit in 3D, tumble in 4D; not
  // forced under reduced motion — unlike the replay itself, ambient spin is
  // not what the click asked for). Armed by onWatchBuild, disarmed exactly
  // once in endReplayDisplay, panelOpenBeforeReplay's lifecycle exactly.
  //
  // DISPLAY-LAYER ONLY, like the replay: AppState.colorMode/fourDColor/
  // showGuides are never touched — recolor()/applyFourDColor()/
  // refreshGuides() fold this flag into what they derive instead — so undo
  // snapshots, the debounced save, share links, and the pagehide flush can
  // never capture the temporary values, by construction. The motion flags
  // (autoOrbitOn / fourDView.tumbleOn) ARE session state, so their priors
  // are remembered here; the sticky user choice (fr-g98) stays untouched —
  // a showcase is a programmatic write, not a user toggle.
  let replayShowcase: {
    /** Bake by-transform colors while set (skipped — and no re-bake owed —
     * when the user's own mode already was "transform"). */
    color: boolean;
    /** Prior motion flag to restore: autoOrbitOn (3D) or fourDView.tumbleOn
     * (4D); null = motion left untouched (reduced motion). */
    motionWasOn: boolean | null;
    /** Which view armed the showcase. Frozen: a flatness flip only ever
     * arrives with a landing generation, which cancels the replay first. */
    fourD: boolean;
  } | null = null;

  // Restore the normal display after a replay: full cloud, no cursor, no
  // caption, true point count. Reads lastResult/fourDResult for the count —
  // a replay can only have started over an arrived cloud, so one exists.
  function endReplayDisplay(): void {
    scene.setDrawCount(null);
    scene.setReplayCursor(null);
    scene.setGuideHighlight(null);
    ui.setReplayCaption(null);
    replayCaption = null;
    // The spotlight phase paints dimmed colors straight over the point
    // buffer (fr-01kf); if one was showing, a repaint is owed below even
    // when the showcase's color override never armed (the user's own mode
    // already was "transform", so `showcase.color` alone wouldn't re-bake).
    const spotlightWasShowing = replaySpotlight !== null;
    replaySpotlight = null;
    const count = viewIs4D ? fourDResult?.count : lastResult?.count;
    if (count !== undefined) ui.setPointCount(count);
    // Disarm the showcase overrides (fr-hpci): put the motion flag back and
    // re-derive guides/colors from the (never-touched) document. Cleared
    // BEFORE the refreshers run so they fold the user's own settings again.
    if (replayShowcase !== null) {
      const showcase = replayShowcase;
      replayShowcase = null;
      if (showcase.motionWasOn !== null) {
        if (showcase.fourD) fourDView.tumbleOn = showcase.motionWasOn;
        else autoOrbitOn = showcase.motionWasOn;
      }
      refreshGuides();
      if (showcase.color || spotlightWasShowing) {
        if (showcase.fourD) applyFourDColor();
        else recolor();
      }
      ui.setReplayShowcaseLegend(false);
      ui.updateLabels(state);
    }
    // Reopen the panel "Watch it build" closed to clear the stage (fr-vpka)
    // — but only above the mobile breakpoint, where the panel is the
    // primary always-open surface; a phone genuinely wants it gone over the
    // small canvas, so it stays closed there even once the replay ends.
    // Covers BOTH exits: natural completion (this runs from animate()'s own
    // idle transition) and cancellation (a regeneration landing, or a
    // render-mode switch, both via cancelReplay) — endReplayDisplay is the
    // one chokepoint all three already share.
    if (panelOpenBeforeReplay !== null) {
      if (window.innerWidth > MOBILE_BREAKPOINT) {
        state = setPanelOpen(state, panelOpenBeforeReplay);
        ui.updateLabels(state);
      }
      panelOpenBeforeReplay = null;
    }
  }

  // Stop any replay and clean the display. Safe to call when idle; the
  // caption check covers the one-frame window where the replay has already
  // gone idle by itself but animate() hasn't cleaned up yet (e.g. a render-
  // mode switch landing in that same frame).
  function cancelReplay(): void {
    if (!buildReplay.active && replayCaption === null) return;
    buildReplay.cancel();
    endReplayDisplay();
  }

  // The replace-load system morph (fr-a04l): when a preset load / Surprise Me
  // / gallery load replaces the system, the attractor tweens from the old
  // shape to the new one instead of snapping — see regenerateReplaced. The
  // morph is DISPLAY-ONLY session view state like the replay above: the
  // document becomes the target immediately (one "replace" undo checkpoint,
  // debounced save, URL hash all see only the target); only the stream of
  // generation requests is interpolated, sampled once per frame by animate()
  // (morph-tween.ts holds the timing/chaining; morph.ts the interpolation).
  const morphTween = new MorphTween();
  // The camera-fit flag the suppressed replace-load regenerate would have
  // carried, remembered for the morph's terminal sample (whose request is the
  // real replaced one). Overwritten — not OR-merged — by a chained restart:
  // the flag describes the CURRENT target's landing.
  let morphFinalFit = false;
  // The morph's adaptive intermediate point budget (fr-a5gu): every
  // delivered generation's measured latency feeds it (see the cloudGenerator
  // wiring), and cloudParams sizes morph intermediates from it, so the morph
  // updates at ~frame rate on whatever device this is instead of stuttering
  // behind a fixed cap.
  const morphBudget = new MorphBudget();

  // The ambient drift show (fr-wavo): dwell on the current attractor, glide
  // to a fresh Surprise-Me roll over DRIFT_MORPH_MS, dwell, repeat — the
  // Electric-Sheep-on-a-TV use case. Session-only motion like the auto-orbit
  // and tumble, never persisted. drift.ts owns the timing loop;
  // drift-policy.ts the stop/advance conduct (driftPolicy below); this file
  // the wiring: what a leg does (launchLeg), the hold/resume choreography
  // around renders, and the reduced-motion gate (syncDriftAvailability).
  const driftShow = new DriftShow(() => performance.now());
  // What a leg departs TOWARD (fr-w2ve): a fresh Surprise-Me roll ("random",
  // the original show), or the next saved scene in the gallery's own order,
  // looping ("collection" — see advanceCollectionLeg). Set by whichever
  // affordance starts the show; meaningless (and untouched) while idle.
  let driftSource: "random" | "collection" = "random";
  // The id of the collection entry the show most recently departed toward —
  // SceneCollection.after's loop cursor. Null'd when a collection show
  // starts, so every show plays from the gallery's front.
  let driftLastPlayedId: string | null = null;
  // The show's stop/advance conductor (drift-policy.ts, fr-4otp): the
  // own-leg guard that exempts a leg's own replace-load from the
  // stop-on-edit rule, and the leg-boundary exits (reduced motion, a
  // dried-up collection). driftPolicy.stop is called from every "the user
  // reached in" moment: applyEdit and the bespoke beginEdit handlers (any
  // undoable edit), time travel and MANUAL gallery loads
  // (applyDecodedSnapshot), starting a build replay, and the toggle itself.
  // Leaving the points view (switchRenderMode) stops a RANDOM show too,
  // while a collection show survives it as a held slideshow (fr-w2ve — see
  // switchRenderMode). Camera input deliberately never calls it — the
  // camera is independent of the show, exactly like the auto-orbit's
  // pause-while-dragging policy.
  //
  // `notify` (fr-ygr1) flashes "Drift stopped" for an IMPLICIT stop — one
  // caused by something else entirely (an edit, undo/redo, a manual
  // gallery load, starting a build replay) where the drift toggle is
  // usually buried inside a collapsed accordion section, so the show would
  // otherwise die silently. Left off at the explicit drift-button toggle
  // (the user is looking right at it), the reduced-motion sync, and a
  // render-mode switch — see each call site for its own reasoning. The
  // policy's guards mean it can never fire for a stop that didn't happen.
  const driftPolicy = new DriftPolicy({
    show: driftShow,
    reducedMotion: prefersReducedMotion,
    // One drift leg (fr-wavo): press Surprise Me — or, for a collection
    // show (fr-w2ve), load the next saved scene — on the show's behalf:
    // the same "replace" undo checkpoint a manual press/load cuts (undo
    // walks back through the show; history.ts's cap bounds it), the same
    // camera auto-fit, but gliding the display morph over DRIFT_MORPH_MS
    // instead of the snappier click-feedback default. A surprise roll
    // always launches; a collection leg reports whether anything was left
    // to play — false ends the show once the leg unwinds (fr-4otp).
    launchLeg: () => {
      if (driftSource === "collection") return advanceCollectionLeg();
      rollSurpriseSystem(DRIFT_MORPH_MS);
      return true;
    },
    onStopped: (notify) => {
      ui.setDriftActive(false);
      if (notify) ui.flashToast("Drift stopped");
    },
  });

  /**
   * The next playable stop on the collection show's loop (fr-w2ve): walk
   * `SceneCollection.after` from the last-departed id through gallery order
   * (newest-first, wrapping), skipping entries that fail to decode — the
   * collection is untrusted localStorage, and an ambient show should step
   * past a corrupt save, not die on it. At most `size` hops, so a
   * fully-corrupt collection terminates as null (like an empty one).
   */
  function nextCollectionScene(): {
    id: string;
    snap: SceneSnapshot;
    mode?: SavedSceneMode;
  } | null {
    let cursor = driftLastPlayedId;
    for (let hops = 0; hops < collection.size; hops++) {
      const entry = collection.after(cursor);
      if (!entry) return null;
      const snap = decodeScene(entry.encoded);
      if (snap) return { id: entry.id, snap, mode: entry.mode };
      cursor = entry.id;
    }
    return null;
  }

  // One COLLECTION-sourced drift leg (fr-w2ve): a gallery load on the show's
  // behalf — the same "replace" checkpoint + morphing applyDecodedSnapshot
  // as loadEncodedScene, stretched over the drift glide. One deliberate
  // difference from a manual load: the camera always auto-fits and CHASES
  // the morph (fr-cfoc) rather than snapping to the entry's saved pose — a
  // hard pose cut every leg would break the ambience the show exists for.
  // Returns whether a leg actually launched: an emptied-out (or fully
  // corrupt) collection reports false, and DriftPolicy.advance ends the
  // show at the leg boundary — like reduced motion does (fr-4otp).
  //
  // Every entry plays in the mode it was SAVED from (fr-75sq): a tagged
  // entry re-enters its renderer when the terminal cloud lands (the
  // preset-hint path, applyCloudResult) with the scene's own saved
  // flame/solid settings; an untagged entry is a points save and plays as
  // the classic morphing cloud — applyDecodedSnapshot already dropped the
  // view to points, and no hint is armed. A manual mode switch mid-show is
  // a look-around: it survives (switchRenderMode holds the show for the
  // entering render), but the next leg reasserts its own entry's mode.
  function advanceCollectionLeg(): boolean {
    const next = nextCollectionScene();
    // Nothing left to play: just report it. The stop belongs to
    // DriftPolicy.advance, AFTER this leg unwinds — issued from in here it
    // would be swallowed by the policy's own-leg guard, letting an emptied
    // collection's show keep running forever (fr-4otp).
    if (!next) return false;
    editSession.beginEdit("replace");
    applyDecodedSnapshot(next.snap, true, true, DRIFT_MORPH_MS);
    // Re-arm AFTER applyDecodedSnapshot, which clears pendingRenderMode on
    // every load (a restored document must not trigger a stale preset hint —
    // this is not that: it's the show arming the entry's own display mode).
    if (next.mode) pendingRenderMode = next.mode;
    driftLastPlayedId = next.id;
    return true;
  }

  // Whether each renderer's CURRENT session has met its iteration budget —
  // maintained by noteRenderProgress below and reset by the sessions' own
  // resetProgress deps (which run on every enter), so it can never describe
  // a previous session. Read by onDriftCollection: a show started from
  // INSIDE a converging render (the Collection section is reachable there
  // since fr-75sq) must hold for that render's completion rather than
  // dwell-and-yank it.
  const renderComplete = { flame: false, solid: false };

  // A converging flame/solid render reported progress: record whether its
  // budget is met (a budget raised on a finished render genuinely
  // un-completes it — the worker resumes accumulating), and, when the
  // collection show is HOLDING for this render (switchRenderMode held it on
  // the way in), re-arm the next departure a beat out — "wait for the
  // render to complete, then a second longer" (fr-w2ve). resumeAfter acts
  // only while holding, so ordinary renders, a stopped show, and an
  // already-resumed one are all untouched by stray progress.
  function noteRenderProgress(
    mode: "flame" | "solid",
    done: number,
    budget: number,
  ): void {
    renderComplete[mode] = done >= budget;
    if (done >= budget) driftShow.resumeAfter(DRIFT_RENDER_LINGER_MS);
  }

  // Push the current soft-slice view state to the scene shader. Shared by
  // resetFourDView() and the three slice handlers, all of which mutate a
  // fourDView slice field and then re-upload the trio.
  function pushFourDSlice(): void {
    scene.setFourDSlice(
      fourDView.sliceOn,
      fourDView.sliceCenter,
      fourDView.sliceRelColor,
    );
  }

  // Reset the 4D VIEW state to a "fresh visit" baseline (rotor to identity,
  // tumble at default speed — running unless reduced motion or the user's
  // sticky toggle choice (fr-g98) says paused — slice off; the baseline
  // itself, plus the paused-view rotor seeding, lives in FourDView.reset) and
  // push it to the scene + UI. Now that "4D" is a property of the system rather than a mode, this
  // fires from regenerate() on (a) a flat→non-flat transition and (b) a
  // whole-system replacement (preset load / Surprise Me) that lands on a
  // non-flat system — never on a subsequent edit to an already-4D system, so
  // nudging a slider can't throw away an in-progress tumble/slice.
  function resetFourDView(): void {
    fourDView.reset(prefersReducedMotion());
    pushFourDSlice();
    ui.resetFourDSlice();
    ui.resetFourDTumble(fourDView.tumbleOn);
  }

  // The 3D sibling of resetFourDView(): return the auto-orbit to its "fresh
  // visit" baseline — running (paused under reduced motion, still an explicit
  // opt-in there) at default speed, except that a manual toggle is sticky
  // (fr-g98): once the user has chosen, fresh visits keep their choice and
  // only re-center the speed. Fires from regenerate() on the mirrored
  // triggers — (a) a non-flat→flat transition and (b) a whole-system
  // replacement that lands on a flat system — plus once at boot, so a paused
  // or re-sped orbit survives ordinary edits exactly like the tumble does.
  // No orientation to reset: theta IS the live camera, and yanking it would
  // discard the user's framing.
  function resetAutoOrbitView(): void {
    autoOrbitOn = autoOrbitUserChoice ?? !prefersReducedMotion();
    autoOrbitSpeed = 1;
    ui.resetAutoOrbit(autoOrbitOn);
  }

  // Re-run the chaos game: the only path that changes point positions. Use
  // this for geometry edits, add/remove, presets, and explicit regenerate —
  // never for a mere palette change.
  //
  // Generation runs OFF the main thread as of fr-5kx: this snapshots the
  // current state into a request and hands it to cloudGenerator (at most one
  // in flight, latest wins — see cloud-generator.ts); everything that used to
  // happen synchronously after the chaos game — the 4D/3D view flip, the
  // "fresh visit" resets, the scene upload, the camera auto-fit — happens in
  // applyCloudResult when the result lands. During a drag the UI/camera stay
  // at full frame rate and the cloud is merely one generation behind, instead
  // of the whole app stalling for a synchronous O(numPoints) run per frame
  // (fr-acc's residual problem at high point counts).
  //
  // Routes on the system's FLATNESS (fr-bf6; see affine4.ts's systemIsFlat/
  // isFlatTransform via state.ts's systemIsNonFlat): a flat system — no
  // transform's `w` block in play, final transform included per its own
  // enabled semantics — takes the untouched 3D path, bit-identical to before
  // this system ever had a `w` extension; a non-flat one lifts every
  // transform (and the final lens, if enabled) through toTransform4 — worker-
  // side — and runs the 4D chaos game instead. `replaced` marks a WHOLE-SYSTEM
  // replacement (preset load / Surprise Me / snapshot restore) as opposed to
  // a mere geometry edit or an explicit Regenerate click, so a freshly loaded
  // non-flat system always gets resetFourDView()'s "fresh visit" treatment
  // even when the PREVIOUS system was already non-flat too (e.g. switching
  // from the double-rotation spiral straight to the pentatope). `fit` asks
  // the arrival handler to auto-frame the camera on the fresh result.
  function regenerate(replaced = false, fit = false): void {
    // A document-true generation declares any in-flight morph over (fr-a04l):
    // snap it — its terminal request goes out first, then this request
    // supersedes it (parking in the generator's latest-wins slot, whose
    // OR-merge keeps the terminal request's replaced/fit if they collapse).
    // Covers the explicit Regenerate click, a slider/drag's coalesced run,
    // and every other edit path that regenerates. No-op when no morph runs.
    snapMorph();
    // This request supersedes any coalesced run a drag/slider burst left
    // queued for the next frame (fr-acc) — drop it so it can't fire a
    // redundant second request; the generator's own latest-wins slot handles
    // anything already in flight. Harmlessly a no-op when nothing is pending,
    // including when this call IS the coalesced run (the coalescer clears its
    // handle before invoking us).
    regenScheduler.cancel();
    cloudGenerator.request(cloudParams(replaced, fit));
  }

  /**
   * The whole-system-replacement regeneration (fr-a04l): where a plain
   * `regenerate(true, fit)` would snap the display to the freshly loaded
   * system, this tweens it there — start (or chain-restart, see
   * MorphTween.start) a morph from the pre-load system toward the document's
   * new one, and let animate()'s per-frame poll stream the interpolated
   * generation requests. `from` must be captured BEFORE the load mutated the
   * document; `state` already IS the target here. `durationMs` is the
   * morph's length — the click-feedback default unless a drift leg asks for
   * its slower glide (fr-wavo). Reduced motion opts out entirely: the
   * current snap behavior IS the reduced-motion path (the `finish()`
   * discard covers a morph left in flight when the OS preference flipped
   * mid-tween — the plain replaced request supersedes it whole).
   */
  function regenerateReplaced(
    from: MorphSystem,
    fit: boolean,
    durationMs = MORPH_TWEEN_MS,
  ): void {
    if (prefersReducedMotion()) {
      morphTween.finish();
      regenerate(true, fit);
      return;
    }
    // Supersede any coalesced pending run, exactly like regenerate() does —
    // the morph's own per-frame requests take over from here.
    regenScheduler.cancel();
    morphTween.start(
      from,
      currentMorphSystem(),
      rollSeed(),
      performance.now(),
      durationMs,
    );
    morphFinalFit = fit;
  }

  /** The attractor-shaping subset of the live document (morph.ts's
   * MorphSystem) — a morph endpoint, and equally the system fields a plain
   * generation request snapshots. */
  function currentMorphSystem(): MorphSystem {
    return {
      transforms: state.transforms,
      finalTransform: state.finalTransform ?? null,
      symmetry: state.symmetry,
    };
  }

  /** Roll a fresh 32-bit generation seed — a live Math.random can't cross
   * postMessage, so every request carries an explicit one (see cloudParams). */
  function rollSeed(): number {
    return Math.floor(Math.random() * 0xffffffff);
  }

  // Send one morph sample as a generation request (fr-a04l). Intermediates go
  // out replaced:false / fit:false at a capped point count, so the fresh-visit
  // view resets, the camera fit, and a preset's render-mode hint all fire
  // exactly once — on the terminal sample's request, which is the REAL
  // replaced request the suppressed load regenerate would have sent: full
  // point count, `fit` as remembered from the load, and the SAME pinned seed
  // as every intermediate, so the settled cloud is the flow's own endpoint
  // rather than a fresh re-roll.
  function requestMorphSample(sample: MorphSample): void {
    cloudGenerator.request(
      cloudParams(sample.final, sample.final && morphFinalFit, sample),
    );
  }

  // Snap any in-flight morph straight to its target by sending its terminal
  // request immediately — the ONLY cancellation shape MorphTween supports
  // (see morph-tween.ts's "No cancel()"). No-op when idle. Call sites mirror
  // cancelReplay's checklist: ordinary edits (applyEdit / regenerate),
  // entering a flame/solid render, and starting a build replay — while a NEW
  // replace-load deliberately does NOT snap (regenerateReplaced chain-restarts
  // the tween instead) and undo/redo discards rather than snaps (see
  // applyDecodedSnapshot).
  function snapMorph(): void {
    const sample = morphTween.finish();
    if (sample) requestMorphSample(sample);
  }

  // Snapshot the current document into a generation request (see
  // cloud-worker-core.ts's CloudRequest). The seed is rolled here — a live
  // Math.random can't cross postMessage — which as a side effect makes each
  // generation a reproducible pure function of its request, exactly like the
  // flame/voxel renders' start commands.
  //
  // A morph sample (fr-a04l) overrides only the attractor-shaping fields and
  // pins the seed; everything else — point count, color-bake inputs — derives
  // from live state as usual. The 4D routing flag follows the SAMPLED
  // system's own flatness, not the document's: mid-morph a flat↔4D pair
  // takes the 4D path exactly while the interpolated maps carry live w
  // blocks (systemPartsAreNonFlat is systemIsNonFlat's formula over bare
  // parts, so plain requests route identically to before).
  function cloudParams(
    replaced: boolean,
    fit: boolean,
    morph?: MorphSample,
  ): CloudParams {
    const { transforms, finalTransform, symmetry } =
      morph?.system ?? currentMorphSystem();
    return {
      transforms,
      finalTransform,
      // Intermediates run at the adaptive budget — sized from measured
      // generation latency so each frame's request fits in roughly one
      // animation frame on this device (morph-budget.ts, fr-a5gu), scaled by
      // the user's Morph Detail preference (fr-jonj); the terminal sample
      // and every non-morph request use the full count.
      numPoints:
        morph && !morph.final
          ? morphBudget.budget(state.numPoints, state.morphDetail)
          : state.numPoints,
      seed: morph?.seed ?? rollSeed(),
      symmetry,
      fourD: systemPartsAreNonFlat(transforms, finalTransform),
      colorMode: state.colorMode,
      colorGamma: state.colorGamma,
      // Resolved here (not the bare selection) — the "custom" sentinel has
      // no payload to cross the wire with; see palette.ts's PaletteSpec.
      rampPalette: resolvePalette(state.rampPaletteId, state.customPalette),
      // Absent = legacy identity; a plain data payload, nothing to resolve.
      positionAxisColors: state.positionAxisColors,
      replaced,
      fit,
    };
  }

  // Land a finished generation on the scene — everything that happens once
  // the chaos game result is in hand (fr-5kx). Runs on
  // the worker's reply, or inline for the boot/fallback synchronous paths, so
  // every step keys off the RESULT (and the request that produced it), never
  // off "whatever the document looks like now" — except where reading live
  // state is the point: the stale-color guard and applyFourDColor's mode
  // dispatch, which deliberately let an edit that landed mid-flight win.
  function applyCloudResult(result: CloudResult, request: CloudRequest): void {
    // A landing generation replaces the buffers a replay was revealing —
    // stop it and show the fresh cloud whole. (scene.setPoints* also clears
    // the prefix defensively, but the caption/cursor/count are app state.)
    cancelReplay();
    const nonFlat = result.fourD;
    const wasNonFlat = viewIs4D;
    viewIs4D = nonFlat;
    if (nonFlat !== wasNonFlat) {
      scene.setFourDActive(nonFlat);
      // Re-gate the panel and the guide boxes on the flip. The edit that
      // requested this generation refreshed both at REQUEST time — against
      // the then-displayed (old) dimensionality, correctly matching the old
      // cloud still on screen — so the arrival that actually swaps the cloud
      // must refresh them again. Harmlessly idempotent for the paths that
      // refresh anyway (applyEdit); essential for the per-slider geometry
      // path (onTransformGeometry / onFinalTransformGeometry), where a
      // w-slider drag is a geometry edit that CAN flip flatness (fr-bf6.3).
      ui.updateLabels(state);
      refreshGuides();
    }

    // Decide what this flatness/replacement change resets (four-d-view.ts):
    // a fresh visit to the 4D view, the mirrored fresh visit to the 3D
    // auto-orbit (fr-1yn), and/or clearing a leftover 4D scaffold. The three
    // outcomes are mutually exclusive-ish (resetFourD needs nonFlat, the other
    // two need !nonFlat), so they read as independent guards here.
    const transition = viewTransition(nonFlat, wasNonFlat, request.replaced);
    if (transition.resetFourD) resetFourDView();
    if (transition.resetAutoOrbit) resetAutoOrbitView();
    if (transition.clearScaffold) {
      // scene.setFourDActive(false) (just above) restores the 3D material/
      // fog/background, but does NOT touch the scaffold — a separate scene
      // object that otherwise keeps tumbling over the 3D cloud forever.
      scene.setFourDScaffold(null);
    }

    if (result.fourD) {
      // 4D projection path: upload the projected xyz + separate w. Leaves
      // `lastResult` (the 3D cloud) untouched so a later flat edit restores
      // the 3D path cleanly; color lives in the shader (or is rebaked just
      // below), so the result carries no color buffer.
      fourDResult = result;
      const b4 = result.bounds;
      scene.setPoints4(
        result.positions,
        result.w,
        result.center,
        result.radius,
        [
          (b4.maxX - b4.minX) / 2,
          (b4.maxY - b4.minY) / 2,
          (b4.maxZ - b4.minZ) / 2,
          (b4.maxW - b4.minW) / 2,
        ],
      );
      // setPoints4 dropped the previous cloud's color attribute; re-point the
      // shader at the CURRENT mode's source (re-baking for the baked modes).
      applyFourDColor();
      ui.setPointCount(result.count);
    } else {
      lastResult = result;
      scene.setPoints(result.positions, result.colors);
      // The colors were baked worker-side at REQUEST-time mode/contrast/ramp
      // palette; if any changed while this generation was in flight, recolor
      // the fresh cloud from live state (recolor() reads the just-cached
      // lastResult) rather than flashing the stale palette. The rampPalette
      // and positionAxisColors compares are by reference — faithful, because
      // state updates are immutable (an edited gradient or axis-color triple
      // is always a fresh object, and legacy is `undefined` on both sides
      // when unset); a same-content re-resolution could only cause a
      // redundant recolor, never a missed one.
      if (
        request.colorMode !== state.colorMode ||
        request.colorGamma !== state.colorGamma ||
        request.rampPalette !==
          resolvePalette(state.rampPaletteId, state.customPalette) ||
        request.positionAxisColors !== state.positionAxisColors
      ) {
        recolor();
      }
      ui.setPointCount(result.count);
    }

    // Auto-frame the camera on a whole-system load's fresh attractor
    // (fr-0b8) — deferred to arrival with everything else, so it frames the
    // cloud actually going on screen. While a fit-intent morph is still in
    // flight (fr-cfoc), its intermediates instead TRACK the camera onto the
    // morphing attractor's live bounds — the terminal sample's fit then
    // settles from an already-following pose instead of yanking across
    // however far the shape wandered during the tween. Deliberately reads
    // live state (morphTween/morphFinalFit/gestures): tracking is a
    // display-follow concern — "is a fit-morph showing RIGHT NOW, and is the
    // user's hand off the camera" — not a property of the request. The
    // gesture guard keeps an arrival from re-arming the chase the user's
    // grab just cancelled (cancelTween); once the hand lifts, the next
    // arrival resumes the follow, which is the same fit intent the terminal
    // sample lands anyway.
    if (request.fit) {
      fitCameraToAttractor();
    } else if (
      morphTween.active &&
      morphFinalFit &&
      !gestures.gestureActive()
    ) {
      trackCameraToAttractor();
    }

    // A preset that declares a render-mode hint (fr-39y) enters its renderer
    // HERE, when its whole-system replacement actually lands — not at click
    // time, when the camera still framed the previous attractor. The flame
    // render freezes the camera into its projection snapshot at enter, so
    // complete the just-started fit glide instantly and push it to the scene
    // camera first; the solid render keeps its camera live, so it can keep
    // gliding.
    if (request.replaced && pendingRenderMode !== null) {
      const target = pendingRenderMode;
      pendingRenderMode = null;
      if (target === "flame") {
        cameraTween.finish();
        scene.applyCamera(orbit);
      }
      switchRenderMode(target);
    }
  }

  // The off-main-thread generation pipeline (fr-5kx): a dedicated Worker runs
  // the chaos game (cloud-worker.ts around cloud-worker-core.ts's pure
  // generateCloud) and posts back transferable buffers — zero-copy, no SAB
  // needed since each result is consumed once (contrast the flame's live
  // tone-map, which re-reads its shared frames). CloudGenerator holds the
  // at-most-one-in-flight / latest-wins policy plus a permanent synchronous
  // fallback through the same generateCloud if the worker can't load (e.g. a
  // stale-deploy 404) or crashes — unlike the optional flame/solid overlays,
  // the live cloud IS the app, so it must outlive its worker. Constructed
  // eagerly so the worker script loads during boot and is warm by the first
  // drag; boot itself generates synchronously (generateSync below) so the
  // first paint still includes the cloud.
  const cloudGenerator = new CloudGenerator({
    createWorker: (onResult, onError) => {
      if (typeof Worker === "undefined") return null;
      const worker = new Worker(new URL("./cloud-worker.ts", import.meta.url), {
        type: "module",
      });
      worker.onmessage = (e: MessageEvent<CloudResult>) => onResult(e.data);
      worker.onerror = (e) => {
        console.error(
          "Point-cloud worker failed; falling back to main-thread generation.",
          e,
        );
        onError();
      };
      // A reply that fails to deserialize (shouldn't happen for our own
      // structured-clonable results) would otherwise strand the in-flight
      // request forever — treat it like a crash.
      worker.onmessageerror = () => {
        console.error(
          "Point-cloud worker reply failed to deserialize; falling back to main-thread generation.",
        );
        onError();
      };
      return {
        post: (request) => worker.postMessage(request),
        terminate: () => {
          // Detach the handlers BEFORE terminating so an already-queued
          // reply can't reach a generator that has moved on (the same
          // closed gap as the flame worker host's terminate).
          worker.onmessage = null;
          worker.onerror = null;
          worker.onmessageerror = null;
          worker.terminate();
        },
      };
    },
    computeSync: generateCloud,
    onResult: (result, request, elapsedMs) => {
      // Every generation calibrates the morph budget's per-point cost —
      // ordinary edits and boot included, so the FIRST morph intermediate
      // is already sized for this device (morph-budget.ts, fr-a5gu).
      morphBudget.note(elapsedMs, request.numPoints);
      applyCloudResult(result, request);
    },
  });

  // Coalesce the high-frequency regenerate() triggers — a guide-box drag's
  // pointermove and a panel slider's input both fire many times per frame — to
  // at most ONE generation request per animation frame (fr-acc). With the
  // worker pipeline (fr-5kx) this bounds request-building and postMessage
  // traffic to frame rate — and, in the generator's synchronous fallback
  // mode, it is again all that stops a single drag from running a whole chaos
  // game on every input event. Only the drag/slider sites schedule() through
  // here; every one-shot path still calls regenerate() directly (which
  // cancels any pending frame it has just superseded).
  const regenScheduler = createFrameCoalescer(
    () => regenerate(),
    (cb) => requestAnimationFrame(cb),
    (handle) => cancelAnimationFrame(handle),
  );

  // Rebuild only the color buffer over the cached cloud and push it to the
  // scene. Leaves positions (and thus the RNG) untouched, so switching color
  // mode recolors the same shape instantly. No-op before the first generation.
  function recolor(): void {
    // In 4D the point color is owned by the 4D shader path (see
    // applyFourDColor below), not colorMode's CPU buffer.
    if (viewIs4D) return;
    if (!lastResult) return;
    const colors = buildColors(
      lastResult,
      state.transforms,
      // The replay showcase (fr-hpci) presents by-transform coloring without
      // ever writing the document — folded here, the one place the displayed
      // 3D mode is derived.
      replayShowcase?.color ? "transform" : state.colorMode,
      state.colorGamma,
      resolvePalette(state.rampPaletteId, state.customPalette),
      state.positionAxisColors,
    );
    scene.setColors(colors);
  }

  // Point the 4D shader's color at the current fourDColor mode's source
  // (fr-d47): the w-depth modes are pure shader work (a side-color uniform
  // pair from W_SIDE_PALETTES), while the baked modes build a rotation-
  // invariant per-point attribute from the cached 4D result — the 4D sibling
  // of recolor(), and like it never re-runs the chaos game. No-op before the
  // first 4D generation.
  function applyFourDColor(): void {
    if (!viewIs4D || !fourDResult) return;
    // The replay showcase's by-transform override (fr-hpci) — the 4D sibling
    // of recolor()'s fold, same display-only rationale.
    const mode = replayShowcase?.color ? "transform" : state.fourDColor;
    if (fourDColorNeedsAttribute(mode)) {
      scene.setFourDColorSource({
        // The radius mode's ramp follows the same rampPaletteId selection as
        // the 3D height/radius ramps (fr-6ue); the transform mode ignores it.
        colors: buildColors4(
          fourDResult,
          state.transforms.length,
          mode,
          resolvePalette(state.rampPaletteId, state.customPalette),
        ),
      });
    } else {
      scene.setFourDColorSource({ sides: W_SIDE_PALETTES[mode] });
    }
  }

  // Paint the replay's spotlight step (fr-01kf): by-transform colors with
  // every map EXCEPT `spotlight` dimmed to a ghost, so that one map's
  // landings — a shrunken copy of the whole attractor — read alone. Bakes
  // "transform" mode explicitly rather than through recolor()'s showcase
  // fold: the fold is a no-op override when the user's own mode already is
  // "transform", but the spotlight's dim must apply either way. `null`
  // restores the showcase's ordinary colors (the fr-hpci refreshers, which
  // are what the natural spotlight→done transition wears into the finale).
  // Display-layer only, like everything else the replay touches: the baked
  // buffer goes straight to the scene, never through AppState.
  function applyReplaySpotlight(spotlight: number | null): void {
    replaySpotlight = spotlight;
    if (spotlight === null) {
      if (viewIs4D) applyFourDColor();
      else recolor();
      return;
    }
    if (viewIs4D) {
      if (!fourDResult) return;
      scene.setFourDColorSource({
        colors: dimColorsExcept(
          buildColors4(
            fourDResult,
            state.transforms.length,
            "transform",
            resolvePalette(state.rampPaletteId, state.customPalette),
          ),
          fourDResult.transformIndices,
          fourDResult.count,
          spotlight,
          SPOTLIGHT_DIM,
        ),
      });
    } else {
      if (!lastResult) return;
      scene.setColors(
        dimColorsExcept(
          buildColors(
            lastResult,
            state.transforms,
            "transform",
            state.colorGamma,
            resolvePalette(state.rampPaletteId, state.customPalette),
            state.positionAxisColors,
          ),
          lastResult.transformIndices,
          lastResult.count,
          spotlight,
          SPOTLIGHT_DIM,
        ),
      );
    }
  }

  // The base map whose landing the replay's hop cursor is sitting on
  // (fr-01kf), read off the displayed result's per-point transformIndices —
  // base-map indexed on both paths (3D folds kaleidoscope copies back to
  // their base map; 4D has no symmetry), exactly like by-transform coloring,
  // so the index lines up with the guide boxes. Null when the buffer isn't
  // there to ask (a replay can only have started over an arrived cloud, but
  // the poll shares frames with landings — stay defensive, not clever).
  function replayLandingMap(cursor: number | null): number | null {
    if (cursor === null) return null;
    const indices = viewIs4D
      ? fourDResult?.transformIndices
      : lastResult?.transformIndices;
    return indices?.[cursor] ?? null;
  }

  // Auto-fit the camera to a freshly-generated attractor (fr-0b8): a
  // whole-system replacement (preset load / Surprise Me) can leave the
  // previous camera pointed at empty space or buried inside the new cloud,
  // so glide target/radius to frame it instead of leaving first impressions
  // to luck. theta/phi are left untouched — only the distance and the point
  // being orbited move, so the fractal swaps in place and the camera glides
  // to meet it. Never triggered by Regenerate or a geometry edit (those
  // would fight the user's own framing) — the whole-system-load paths set
  // the generation request's `fit` flag, and applyCloudResult calls
  // fitCameraToAttractor when that result lands (fr-5kx), so the glide
  // frames the cloud actually going on screen. The glide itself —
  // interpolation, reduced-motion snap, and the 4D framing box
  // (fourDFramingBounds) — lives in camera-tween.ts; this file only decides
  // WHICH bounds to frame and hands it the live camera fov/aspect.
  const cameraTween = new CameraTween(
    orbit,
    () => performance.now(),
    prefersReducedMotion,
  );

  // The bounds a camera fit of the current view should frame: the 4D branch
  // synthesizes a rotation-invariant box (fourDFramingBounds — the framing
  // radius is a distance-from-center quantile, so one framing holds at every
  // tumble angle); the 3D branch is the latest run's trimmed-quantile box.
  // Both are the result's outlier-robust frame fields (fr-3xfk), NOT the raw
  // min/max bounds — a nonlinear variation's sparse flung points used to
  // inflate those until the attractor fit several times too small. Null
  // until a run exists.
  function attractorFramingBounds(): Bounds | null {
    if (viewIs4D) {
      return fourDResult
        ? fourDFramingBounds(fourDResult.center, fourDResult.frameRadius)
        : null;
    }
    return lastResult ? lastResult.frameBounds : null;
  }

  // Glide the camera to frame the current view's bounds. A no-op until a run
  // exists.
  function fitCameraToAttractor(): void {
    const bounds = attractorFramingBounds();
    if (!bounds) return;
    cameraTween.fitToBounds(bounds, {
      fov: scene.camera.fov,
      aspect: scene.camera.aspect,
    });
  }

  // The fit's morph-time sibling (fr-cfoc): retarget the tracking chase at
  // the current view's bounds, so the camera follows the morphing attractor
  // frame by frame instead of letting it wander off-screen until the
  // terminal fit yanks it back. Called per intermediate arrival — see
  // applyCloudResult.
  function trackCameraToAttractor(): void {
    const bounds = attractorFramingBounds();
    if (!bounds) return;
    cameraTween.track(bounds, {
      fov: scene.camera.fov,
      aspect: scene.camera.aspect,
    });
  }

  /**
   * The live orbit pose as a persistable document field (fr-1k4). Attached
   * by {@link currentDocument} to every saved / shared / collection document
   * — never to undo-history snapshots (see SceneSnapshot.camera's doc).
   */
  function cameraPose(): CameraPose {
    return {
      target: [orbit.target[0], orbit.target[1], orbit.target[2]],
      radius: orbit.spherical.radius,
      theta: orbit.spherical.theta,
      phi: orbit.spherical.phi,
    };
  }

  /**
   * Restore a persisted orbit pose (fr-1k4) — the mirror of
   * {@link cameraPose}. Cancels any in-flight fit glide first: a restored
   * pose IS the framing, so nothing should keep gliding somewhere else.
   */
  function applyCameraPose(pose: CameraPose): void {
    cameraTween.cancel();
    orbit.target[0] = pose.target[0];
    orbit.target[1] = pose.target[1];
    orbit.target[2] = pose.target[2];
    orbit.spherical.radius = pose.radius;
    orbit.spherical.theta = pose.theta;
    orbit.spherical.phi = pose.phi;
  }

  // Grabbing the camera mid-glide should feel like a normal orbit, not a
  // fight with the animation — cancel outright on the next user gesture.
  // Capture phase so this runs before interactions.ts's own (bubble-phase)
  // listeners on the same canvas. (The auto-orbit — fr-1yn — needs no
  // listener of its own here: it polls interactions' gestureActive() each
  // frame instead, and composes with the tween anyway — theta vs.
  // radius/target, disjoint fields.)
  const cancelTween = (): void => cameraTween.cancel();
  const cancelTweenOptions: AddEventListenerOptions = {
    capture: true,
    passive: true,
  };
  scene.canvas.addEventListener("pointerdown", cancelTween, cancelTweenOptions);
  scene.canvas.addEventListener("wheel", cancelTween, cancelTweenOptions);
  scene.canvas.addEventListener("touchstart", cancelTween, cancelTweenOptions);

  // Flame render session (fr-o7s/fr-ucs/fr-73y): a dedicated Worker owns the
  // supersampled accumulation, the OOM guard, the throttled downsample, and
  // (in transfer mode) the tone-map (see flame-worker-core.ts) — this is
  // thin glue that spins one up per render and forwards UI events as
  // messages. When the page is cross-origin isolated (fr-96i: natively in
  // dev via vite's server headers; in production via the COOP/COEP-injecting
  // service worker in sw/sw.ts, since GitHub Pages cannot send those headers
  // itself), the render upgrades to a SharedArrayBuffer transport: the worker
  // downsamples into shared display-resolution buckets and THIS thread
  // tone-maps a live view of them (see presentSharedFrame), so
  // exposure/gamma/vibrancy changes land instantly with no worker round trip
  // and nothing per-tick crosses but a few scalars. Without isolation it
  // falls back to fr-73y's postMessage transfer of a tone-mapped image.
  // Either way the big oversampled accumulator never leaves the worker.
  // The shared-transport session (fr-96i): the two SAB-backed frame slots
  // this side allocated for the current render, plus which slot the worker
  // most recently told us to read (and its maxHits — the one tonemapFlame
  // input that isn't in the shared arrays). null whenever the current render
  // runs in transfer mode (not isolated, or the slots failed to allocate).
  interface FlameSharedSession {
    frames: [SharedFrameBuffers, SharedFrameBuffers];
    width: number;
    height: number;
    last: { slot: number; maxHits: number } | null;
  }
  let flameShared: FlameSharedSession | null = null;

  // Why the CURRENT render's worker gave up on GPU (null while it hasn't):
  // remembered from the `gpuUnavailable` event so the subsequent `backend`
  // event's CPU note can say WHY it reads "CPU accumulation" — the absence of
  // that why is what made field reports of this flakiness undiagnosable
  // (fr-2w5). Cleared by `clearNotes` on every fresh session start.
  let flameGpuUnavailableReason: "no-webgpu" | "error" | null = null;

  // Allocate the two shared display-resolution frame slots, or null to fall
  // back to transfer mode: when the page isn't cross-origin isolated the
  // SharedArrayBuffer constructor isn't even exposed, and when it is, the
  // slots (32 bytes per display pixel across both) can still lose to a
  // memory-constrained device — a fallback, not a failure, either way.
  function tryCreateFlameSharedSession(
    width: number,
    height: number,
  ): FlameSharedSession | null {
    if (!window.crossOriginIsolated || typeof SharedArrayBuffer === "undefined")
      return null;
    const bytes = Float64Array.BYTES_PER_ELEMENT;
    try {
      const frame = (): SharedFrameBuffers => ({
        hits: new Float64Array(new SharedArrayBuffer(width * height * bytes)),
        sumRGB: new Float64Array(
          new SharedArrayBuffer(width * height * 3 * bytes),
        ),
      });
      return { frames: [frame(), frame()], width, height, last: null };
    } catch {
      return null;
    }
  }

  // Tone-map the worker's most recent shared frame straight out of the live
  // shared buckets and put it on screen. Runs on a "sharedFrame"
  // notification AND directly from the exposure/gamma/vibrancy handlers —
  // the shared transport's whole payoff: a tone-map slider re-renders
  // immediately, even while the worker is deep inside an accumulate chunk.
  // Reading the last-notified slot is safe mid-accumulation: the worker
  // writes the OTHER slot next (double buffer), and the notification that
  // flips slots is what re-points `last` here first.
  function presentSharedFrame(): void {
    if (!flameShared?.last) return;
    const { frames, width, height, last } = flameShared;
    const frame = frames[last.slot];
    const image = tonemapFlame(
      viewFlameHistogram(width, height, frame.hits, frame.sumRGB, last.maxHits),
      {
        exposure: state.flame.exposure,
        gamma: state.flame.gamma,
        gammaThreshold: DEFAULT_GAMMA_THRESHOLD,
        vibrancy: state.flame.vibrancy,
      },
    );
    scene.setFlameImage(image, width, height);
  }

  function handleFlameEvent(event: FlameWorkerEvent): void {
    switch (event.type) {
      case "progress":
        scene.setFlameImage(event.image, event.width, event.height);
        ui.setFlameProgress(event.iterationsDone, event.iterationsBudget);
        noteRenderProgress(
          "flame",
          event.iterationsDone,
          event.iterationsBudget,
        );
        flameSession.markFirstFrame();
        break;
      case "sharedFrame":
        // Shared-mode counterpart to "progress": the frame is already in
        // the named shared slot; remember which one (plus its maxHits) and
        // tone-map it here. The guard is defensive — a sharedFrame can only
        // arrive from a session this side started WITH shared frames.
        if (flameShared) {
          flameShared.last = { slot: event.slot, maxHits: event.maxHits };
          presentSharedFrame();
          ui.setFlameProgress(event.iterationsDone, event.iterationsBudget);
          noteRenderProgress(
            "flame",
            event.iterationsDone,
            event.iterationsBudget,
          );
          flameSession.markFirstFrame();
        }
        break;
      case "restarted":
        // The worker just discarded its accumulation (a live palette/
        // supersample/symmetry restart, or the OOM fallback) — zero the
        // readout NOW instead of showing the stale pre-restart count until
        // the first post-restart chunk reports, seconds away on CPU
        // (fr-h6sn). No markFirstFrame: there is no frame yet.
        ui.setFlameProgress(0, event.iterationsBudget);
        noteRenderProgress("flame", 0, event.iterationsBudget);
        break;
      case "supersampleNote":
        ui.setFlameSupersampleNote(event.effective, event.requested);
        break;
      case "backend":
        ui.setFlameBackendNote(
          event.backend,
          event.adapter,
          // A CPU backend AFTER a gpuUnavailable is a fallback — say why,
          // briefly. A CPU backend with no preceding gpuUnavailable is just
          // a CPU render (GPU never attempted): no reason to show.
          event.backend === "cpu" && flameGpuUnavailableReason !== null
            ? flameGpuUnavailableReason === "no-webgpu"
              ? "WebGPU unavailable"
              : "GPU failed"
            : undefined,
        );
        break;
      case "gpuUnavailable":
        // The worker's GPU recovery ladder is exhausted — it will fall back to
        // CPU accumulation. Record the reason so the subsequent "backend"
        // event's CPU note can say WHY (fr-2w5). No escalation: the worker's
        // CPU path is the correct, universal fallback (fr-27h).
        flameGpuUnavailableReason = event.reason;
        break;
      case "estimating":
        ui.setFlameEstimating();
        break;
      case "error":
        console.error(
          "Flame render failed to accumulate; returning to explorer.",
          event.message,
        );
        showRenderError(RENDER_ACCUMULATE_ERROR);
        flameSession.exit();
        break;
    }
  }

  // Wraps the real flame Worker in a RenderSessionHandle so RenderSession's
  // start/post/exit can drive it uniformly (same shape the solid worker uses).
  function createFlameWorkerHost(): RenderSessionHandle<FlameWorkerCommand> {
    const worker = new Worker(new URL("./flame-worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (e: MessageEvent<FlameWorkerEvent>) =>
      handleFlameEvent(e.data);
    worker.onerror = (e) => {
      console.error("Flame worker crashed; returning to explorer.", e);
      showRenderError();
      flameSession.exit();
    };
    return {
      post: (command) => worker.postMessage(command),
      terminate: () => {
        // Detach the handlers BEFORE terminating so a message the worker
        // already queued to this thread can't still reach handleFlameEvent
        // and act on a session this host no longer represents (e.g. a stale
        // "error" calling flameSession.exit() after re-entry). A terminated
        // worker posts nothing new; this closes the already-queued gap.
        worker.onmessage = null;
        worker.onerror = null;
        worker.terminate();
      },
    };
  }

  // Snapshot the frozen 4D view for a render worker (fr-5b3/fr-4wd): the
  // current rotor + the cloud's center/support amplitude, the slice window,
  // and the "legacy"-palette color dispatch inputs. The flame and voxel
  // start commands declare structurally identical `fourD` blocks, so the one
  // snapshot feeds both. Undefined while the view is 3D — the workers then
  // take their unchanged 3D paths. The tumble needs no explicit pause here:
  // animate() early-returns past the whole 4D block while either render is
  // active, so fourDView's rotor simply stops advancing (and onFourDRotate is
  // gated the same way), making this snapshot valid for the render's whole life.
  function fourDRenderSnapshot():
    | NonNullable<Extract<FlameWorkerCommand, { type: "start" }>["fourD"]>
    | undefined {
    if (!viewIs4D || !fourDResult) return undefined;
    const rotor = fourDView.matrix();
    const b = fourDResult.bounds;
    const halfExtents: Vec4 = [
      (b.maxX - b.minX) / 2,
      (b.maxY - b.minY) / 2,
      (b.maxZ - b.minZ) / 2,
      (b.maxW - b.minW) / 2,
    ];
    // Mirrors scene.ts's updateWAmp4 exactly (same support function, same
    // 1e-6 degenerate-cloud floor) so the workers' normalized signed-w
    // signal s can't drift from the shader's.
    const invWAmp = 1 / Math.max(wSupport(rotor, halfExtents), 1e-6);
    // The "radius" color mode's normalization: the same min→max 4D-distance
    // range over the explorer's own cloud that buildColors4's radius branch
    // bakes with, so the render's ramp matches the explorer's colors.
    const { positions, w, count, center } = fourDResult;
    let radiusMin = Infinity;
    let radiusMax = 0;
    for (let i = 0; i < count; i++) {
      const dx = positions[i * 3] - center[0];
      const dy = positions[i * 3 + 1] - center[1];
      const dz = positions[i * 3 + 2] - center[2];
      const dw = w[i] - center[3];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz + dw * dw);
      if (d < radiusMin) radiusMin = d;
      if (d > radiusMax) radiusMax = d;
    }
    if (!Number.isFinite(radiusMin)) radiusMin = 0; // empty cloud (count 0).
    return {
      transforms4: state.transforms.map(toTransform4),
      finalTransform4: state.finalTransform
        ? toTransform4(state.finalTransform)
        : null,
      rotor,
      center: fourDResult.center,
      invWAmp,
      sliceOn: fourDView.sliceOn,
      sliceCenter: fourDView.sliceCenter,
      sliceWidth: FOUR_D_SLICE_WIDTH,
      sliceRelativeColor: fourDView.sliceRelColor,
      colorMode: state.fourDColor,
      radiusMin,
      radiusMax,
      // The radius mode's ramp palette (fr-6ue), resolved exactly like the
      // explorer's own bake (applyFourDColor) so the render's ramp matches
      // the explorer's colors — snapshotted here like colorMode itself.
      rampPalette: resolvePalette(state.rampPaletteId, state.customPalette),
    };
  }

  // The flame render session (fr-o7s): freeze the current camera and converge
  // a flame render of it in a fresh dedicated Worker. Entered only from the
  // Render button — never automatically — so the explorer stays the default,
  // always-interactive experience; exited on Back, on a render error, or on
  // an undo/redo. The enter/exit/terminate + first-frame-gate choreography is
  // shared with the solid session below through RenderSession
  // (render-session.ts); only the genuine flame specifics — the
  // SharedArrayBuffer transport and the `start` payload — live in these
  // injected deps. The defensive double-entry terminate lives in
  // RenderSession.enter, so `start` only builds and kicks off.
  const flameSession = new RenderSession<FlameWorkerCommand>({
    start: () => {
      const { width, height } = scene.flameRenderSize();
      const projection = scene.flameProjectionMatrix();

      // Phone/tablet-class devices: shared with the memory-budget computation
      // below, so only read matchMedia once.
      const coarse = window.matchMedia("(pointer: coarse)").matches;

      flameShared = tryCreateFlameSharedSession(width, height);
      console.info(
        flameShared
          ? "Flame render: SharedArrayBuffer transport (cross-origin isolated)."
          : "Flame render: postMessage-transfer transport.",
      );
      const host = createFlameWorkerHost();

      // Post the `start` via the freshly-created host, NOT flameSession.post:
      // RenderSession.enter only stores this returned handle afterwards, so
      // flameSession.post can't reach the new session yet.
      host.post({
        type: "start",
        transforms: state.transforms,
        finalTransform: state.finalTransform ?? null,
        projection,
        width,
        height,
        // A worker needs an explicit numeric seed — a live Rng (like
        // Math.random) can't cross postMessage — which as a side effect makes
        // a render a reproducible pure function of its inputs.
        seed: Math.floor(Math.random() * 0xffffffff),
        requestedSupersample: state.flame.supersample,
        // Device-aware memory budget for the supersampled accumulator (fr-7c8).
        // Computed here because its inputs — deviceMemory (Chromium-only,
        // hence the cast; absent from TS's DOM lib) and pointer coarseness —
        // are main-thread/window facilities a worker can't reliably read.
        maxAccumBuckets: flameAccumBudgetBuckets(
          (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
          coarse,
        ),
        iterationsBudget: state.flame.iterations,
        exposure: state.flame.exposure,
        gamma: state.flame.gamma,
        vibrancy: state.flame.vibrancy,
        estimatorRadius: state.flame.estimatorRadius,
        estimatorMinimumRadius: state.flame.estimatorMinimumRadius,
        estimatorCurve: state.flame.estimatorCurve,
        palette: resolvePalette(state.flame.paletteId, state.customPalette),
        order: state.symmetry.order,
        axis: state.symmetry.axis,
        // SAB-backed views structured-clone by SHARING their buffers — the
        // worker sees the same memory these frames wrap, nothing is copied.
        sharedFrames: flameShared?.frames,
        // WebGPU accumulation (fr-npb/fr-hs9): "auto" everywhere — try GPU
        // first, fall back to CPU automatically via the worker's gpuFailed
        // ratchet. A device whose maxStorageBufferBindingSize can't fit the
        // histogram fails backend creation cleanly into that same CPU fallback
        // (see flame-gpu-backend.ts's limit guard). A 4D session (fourD below)
        // takes the same auto-with-fallback path through the 4D kernel
        // (fr-e26, flame-gpu-4d.ts).
        gpuPreference: "auto",
        // Per-chunk throughput instrumentation, off unless `?flameperf` asks
        // (fr-ul2).
        instrument: flamePerfEnabled(),
        // The frozen 4D view, or undefined for the unchanged 3D path (fr-5b3).
        fourD: fourDRenderSnapshot(),
      });
      return host;
    },
    clearNotes: () => {
      ui.setFlameSupersampleNote(null); // clear any note from a previous render before the fresh session reports its own.
      ui.setFlameBackendNote(null); // clear any note from a previous render before the fresh session reports its own.
      flameGpuUnavailableReason = null; // a fresh session gets a fresh GPU verdict.
    },
    resetProgress: () => {
      ui.setFlameProgress(0, state.flame.iterations); // reset from a previous render's "100%" rather than leaving it stale until the first progress event.
      renderComplete.flame = false; // ...and the completion flag with it (fr-75sq): this fresh session hasn't met any budget yet.
    },
    activate: () => {
      state = setRenderMode(state, "flame");
      refreshUi();
    },
    deactivate: () => {
      flameShared = null; // drop our half of the shared buffers; with the worker's half gone too, the SABs are collectable.
      // Reset only the mode this session owns — the exact semantics the old
      // per-mode boolean had (clearing flameActive could never touch
      // solidActive), so an idempotent exit() while some OTHER mode is
      // showing can't yank the app out of it via a blind write.
      if (state.renderMode === "flame") state = setRenderMode(state, "points");
      refreshUi();
    },
  });

  // The solid voxel render's worker-event handler: "grid" is this session's
  // first-frame signal (see RenderSession.hasFirstFrame), "error" falls back to
  // the explorer. The session itself — its start payload + enter/exit — is the
  // const solidSession below.
  function handleSolidEvent(event: VoxelWorkerEvent): void {
    switch (event.type) {
      case "grid":
        scene.setVoxelGrid(
          event.texture,
          event.size,
          event.boundsMin,
          event.boundsMax,
        );
        ui.setSolidProgress(event.iterationsDone, event.iterationsBudget);
        noteRenderProgress(
          "solid",
          event.iterationsDone,
          event.iterationsBudget,
        );
        solidSession.markFirstFrame();
        break;
      case "progress":
        // Counters-only label refresh (the displayed texture is already
        // final) — e.g. the budget slider moved on a finished render.
        ui.setSolidProgress(event.iterationsDone, event.iterationsBudget);
        noteRenderProgress(
          "solid",
          event.iterationsDone,
          event.iterationsBudget,
        );
        break;
      case "restarted":
        // Same contract as the flame's "restarted" case: zero the readout
        // the moment the worker discards its accumulation (fr-h6sn).
        ui.setSolidProgress(0, event.iterationsBudget);
        noteRenderProgress("solid", 0, event.iterationsBudget);
        break;
      case "resolutionNote":
        ui.setSolidResolutionNote(event.effective, event.requested);
        break;
      case "error":
        console.error(
          "Solid render failed to accumulate; returning to explorer.",
          event.message,
        );
        showRenderError(RENDER_ACCUMULATE_ERROR);
        solidSession.exit();
        break;
    }
  }

  // The solid voxel render session (fr-v4f): accumulate a world-space density
  // volume of the current system in a fresh worker. Its enter/exit/terminate +
  // first-frame-gate choreography is shared with the flame session above
  // through RenderSession (render-session.ts); its genuine differences are that
  // the volume is world-space — so, unlike the frozen flame view, the camera
  // stays LIVE while it converges (see animate()) — and that entering drops the
  // transform selection (the lens has no guide box in this mode, so pointer
  // gestures should orbit the camera instead of dragging one that's no longer
  // shown). The defensive double-entry terminate lives in RenderSession.enter,
  // so `start` only builds and kicks off.
  const solidSession = new RenderSession<VoxelWorkerCommand>({
    start: () => {
      const worker = new Worker(new URL("./voxel-worker.ts", import.meta.url), {
        type: "module",
      });
      worker.onmessage = (e: MessageEvent<VoxelWorkerEvent>) =>
        handleSolidEvent(e.data);
      worker.onerror = (e) => {
        console.error("Solid worker crashed; returning to explorer.", e);
        showRenderError();
        solidSession.exit();
      };
      const handle = {
        post: (command: VoxelWorkerCommand) => worker.postMessage(command),
        terminate: () => worker.terminate(),
      };

      // Post the `start` via the fresh handle — typed, so the payload is
      // checked — NOT solidSession.post: RenderSession.enter only stores this
      // returned handle afterwards, so solidSession.post can't reach it yet.
      handle.post({
        type: "start",
        transforms: state.transforms,
        finalTransform: state.finalTransform ?? null,
        resolution: state.solid.resolution,
        // The explorer's Color Mode carries into the voxel colors (fr-c1d);
        // entering the mode snapshots it, exactly like the transform set.
        colorMode: state.colorMode,
        // Snapshotted alongside colorMode (fr-8sk) so the solid render's
        // baked-in LUT/position coloring matches the explorer's contrast.
        colorGamma: state.colorGamma,
        palette: resolvePalette(state.solid.paletteId, state.customPalette),
        // The height/radius ramps' gradient palette (fr-3b6), snapshotted at
        // entry exactly like colorMode/colorGamma above — it only matters
        // while `palette` is "legacy" (the colorMode-driven path), and the
        // ramp select is unreachable while this render is active, so there
        // is no live command for it.
        rampPalette: resolvePalette(state.rampPaletteId, state.customPalette),
        // Snapshotted at entry like colorMode/rampPalette above (fr-8k7).
        positionAxisColors: state.positionAxisColors,
        iterationsBudget: state.solid.iterations,
        // A worker needs an explicit numeric seed — a live Rng (like
        // Math.random) can't cross postMessage — which as a side effect makes
        // a render a reproducible pure function of its inputs.
        seed: Math.floor(Math.random() * 0xffffffff),
        // Device-aware memory budget for the voxel grid + texture (fr-8x7) —
        // the same two main-thread-only signals, for the same reasons, as the
        // flame render's maxAccumBuckets above (fr-7c8).
        maxVoxels: voxelAccumBudgetVoxels(
          (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
          window.matchMedia("(pointer: coarse)").matches,
        ),
        order: state.symmetry.order,
        axis: state.symmetry.axis,
        // The frozen 4D view, or undefined for the unchanged 3D path (fr-4wd).
        fourD: fourDRenderSnapshot(),
      });
      return handle;
    },
    clearNotes: () => {
      ui.setSolidResolutionNote(null); // clear any note from a previous render before the fresh worker reports its own.
    },
    resetProgress: () => {
      ui.setSolidProgress(0, state.solid.iterations); // reset from a previous render's "100%" rather than leaving it stale until the first grid event.
      renderComplete.solid = false; // ...and the completion flag with it (fr-75sq), like the flame session's resetProgress.
    },
    activate: () => {
      // Drop any transform selection: the lens has no guide box in this mode,
      // so a raycast drag should orbit the camera, not grab a hidden box.
      state = selectTransform(state, null);
      state = setRenderMode(state, "solid");
      refreshGuides();
      refreshUi();
    },
    deactivate: () => {
      // Reset only the mode this session owns — see the flame session's
      // deactivate for why this is not a blind write.
      if (state.renderMode === "solid") state = setRenderMode(state, "points");
      refreshUi();
    },
  });

  // The one path between the three render modes (fr-39y): exit whichever
  // converging render is active, then enter the target's session. Driving
  // both steps through the sessions' own enter/exit keeps their choreography
  // (worker teardown, note/progress resets, the active flag + UI refresh)
  // authoritative, so a direct flame↔solid switch is exactly an exit
  // followed by an enter — no third path to keep correct. A no-op when the
  // target is already active (clicking the lit segment must not restart a
  // converging render).
  function switchRenderMode(target: RenderMode): void {
    if (target === state.renderMode) return;
    // The replay lives in the points view; leaving it mid-replay must not
    // strand a partial cloud (or the narration pill) behind the flame/solid
    // render.
    if (target !== "points") {
      cancelReplay();
      // The RANDOM drift show still ends here (fr-wavo): its legs are rolled
      // for the live explorer, so a flame/solid render stops it cleanly (a
      // STOP, not a pause). A COLLECTION show instead survives as a
      // slideshow (fr-w2ve) — the render mode is how the show displays, not
      // a reach into it — but HELD: the clock deadline is void while the
      // entering render converges; the render's own completed-progress
      // signal re-arms the departure (noteRenderProgress), so a leg can
      // never yank a still that is mid-convergence. This runs for a manual
      // switch AND for the show's own per-leg re-entry (the pendingRenderMode
      // consumption in applyCloudResult) — both want exactly this hold.
      if (driftShow.active && driftSource === "collection") {
        driftShow.hold();
      } else {
        // Silent (fr-ygr1): an explicit render-mode switch, not an edit
        // reaching in from elsewhere — the user is looking right at the
        // segmented control they just clicked.
        driftPolicy.stop();
      }
      // So does the morph (fr-a04l): the flame/solid start commands snapshot
      // the DOCUMENT's system, so snap the display to it — and animate()
      // stops polling the tween during a render, so an unsnapped morph would
      // otherwise resume, stale, on exit.
      snapMorph();
    }
    if (state.renderMode === "flame") flameSession.exit();
    else if (state.renderMode === "solid") solidSession.exit();
    if (target === "flame") flameSession.enter();
    else if (target === "solid") solidSession.enter();
  }

  // The lens has no guide box, so map its selection (like camera) to "nothing
  // highlighted" — only a numbered transform highlights a box or is draggable.
  function selectedBox(): number | null {
    // No draggable 3D guide boxes exist in the 4D projection, so a raycast drag
    // must never grab a now-hidden one.
    if (viewIs4D) return null;
    return typeof state.selectedTransform === "number"
      ? state.selectedTransform
      : null;
  }

  // The guides' DISPLAYED visibility: the document's showGuides, or forced on
  // while the replay showcase is armed (fr-hpci) — display-only, so the
  // document's showGuides (and its checkbox) stays the user's own. The ONE
  // formula refreshGuides pushes to every guide visual.
  function guidesShown(): boolean {
    return state.showGuides || replayShowcase !== null;
  }

  function refreshGuides(): void {
    const visible = guidesShown();
    // No guide boxes in the 4D projection (an empty list; scene handles it).
    scene.updateGuides(
      viewIs4D ? [] : state.transforms,
      selectedBox(),
      visible,
    );
    // The grid, axes, and 4D scaffold follow the same derivation — pushed
    // here rather than per call site, so "Show guides" (and the showcase's
    // override of it) can never govern the boxes and the grid separately.
    scene.setGuidesVisible(visible);
  }

  function refreshUi(): void {
    ui.updateLabels(state);
    ui.renderTransformList(
      state.transforms,
      state.selectedTransform,
      state.finalTransform ?? null,
    );
    const sel = state.selectedTransform;
    const editing =
      sel === null
        ? null
        : sel === "final"
          ? (state.finalTransform ?? null)
          : state.transforms[sel];
    ui.renderTransformEditor(editing, sel);
  }

  /**
   * Apply an already-decoded snapshot to the live app with whole-system-
   * replacement semantics, the same path a boot-time hash/localStorage load
   * takes. Any active flame/solid render is exited first (they are
   * session-only overlays OF the document; the app "boots into the explorer"
   * and so does time travel / a gallery load). View state stays live except
   * where the restored document invalidates it: the selection is
   * clamped/cleared exactly like removeTransform does, and the preset scaffold
   * is cleared (preset-load decoration, not document state). `refit` re-frames
   * the camera when the load is a whole-system replacement — symmetric with
   * how the camera moved when that replacement was first applied; it rides
   * the generation request (fr-5kx) so the fit happens when the restored
   * cloud actually arrives.
   *
   * Cutting (or not) an undo checkpoint is the CALLER's business, not this
   * function's: {@link restoreSnapshot} (EditSession's `restore`) must not
   * checkpoint, while {@link loadEncodedScene} (a gallery load, a genuine
   * user edit) checkpoints via `beginEdit("replace")` before calling in.
   *
   * So is morphing (fr-a04l), via `morph`: a gallery load tweens the display
   * to the restored system like a preset load does (regenerateReplaced),
   * while time travel deliberately snaps — undo/redo should feel mechanical,
   * and it avoids edit-session re-entrancy. The snap DISCARDS any in-flight
   * morph rather than sending its terminal request: the replaced request
   * below already covers the display with the restored document, and the
   * terminal request's remembered `fit` could otherwise glide the camera
   * away from a pose the caller is about to restore (fr-uf3). `morphMs`
   * stretches that tween for a collection drift leg (fr-w2ve), exactly like
   * applyEdit's own `morphMs`; omitted, the click-feedback default governs.
   */
  function applyDecodedSnapshot(
    snap: SceneSnapshot,
    refit: boolean,
    morph: boolean,
    morphMs?: number,
  ): void {
    // Undo/redo and a gallery load are the user reaching in: both end the
    // drift show (fr-wavo) — this is the one chokepoint on their shared path.
    // Notify (fr-ygr1): the show's own collection legs also pass through
    // here, but under the policy's own-leg guard the stop no-ops before
    // ever reaching the toast — only a genuine undo/redo or manual load
    // actually stops (and announces) anything.
    driftPolicy.stop({ notify: true });
    switchRenderMode("points");
    // A restored document must not trigger a preset hint armed just before
    // the time travel / gallery load.
    pendingRenderMode = null;
    // The pre-load display target — the morph's `from` endpoint (a chained
    // restart ignores it and resumes from the live sample; see
    // MorphTween.start). Captured before fromSnapshot replaces the document.
    const morphFrom = currentMorphSystem();
    state = fromSnapshot(snap, state);
    if (
      typeof state.selectedTransform === "number" &&
      state.selectedTransform >= state.transforms.length
    ) {
      state = selectTransform(state, null);
    }
    if (state.selectedTransform === "final" && !state.finalTransform) {
      state = selectTransform(state, null);
    }
    if (morph) {
      regenerateReplaced(morphFrom, refit, morphMs);
    } else {
      morphTween.finish();
      regenerate(true, refit);
    }
    scene.setFourDScaffold(null);
    scene.setRenderStyle(state.renderStyle);
    // Mirror onRenderStyle: never leave a stale glow exposure on a non-glow style.
    if (state.renderStyle !== "glow") scene.setGlowExposure(1);
    scene.setPointSize(state.pointSize);
    scene.setFourDDepthFade(state.fourDDepthFade);
    scene.setSolidParams(state.solid);
    // Covers the grid/axes/scaffold too — refreshGuides pushes the whole
    // guide-visibility derivation, not just the boxes.
    refreshGuides();
    refreshUi();
  }

  /**
   * Apply a history snapshot — {@link EditSession}'s injected `restore`. Decodes
   * the entry and hands it to {@link applyDecodedSnapshot}. It must NOT cut an
   * undo checkpoint (an undo/redo is not itself an edit) — the session arms the
   * restored document's checkpoint-free debounced save on its own once this
   * returns (see edit-session.ts).
   *
   * Camera handling matches how the framing moved when the step's edit was
   * first applied: an ordinary parameter edit (`replaced` false) leaves it
   * alone, while a step that crosses a whole-system replacement restores the
   * exact pre-replace `pose` the checkpoint captured out of band (fr-uf3) —
   * the same applyDecodedSnapshot-then-applyCameraPose shape as
   * {@link loadEncodedScene}. A `replaced` step with no captured pose
   * (defensive — the app always supplies one via the EditSession `pose` dep)
   * falls back to auto-fitting the restored attractor.
   */
  function restoreSnapshot(
    snapshot: string,
    replaced: boolean,
    pose?: CameraPose,
  ): void {
    const snap = decodeScene(snapshot);
    if (!snap) return; // can't happen: entries are encodeScene output
    if (replaced && pose) {
      applyDecodedSnapshot(snap, false, false);
      applyCameraPose(pose);
    } else {
      applyDecodedSnapshot(snap, replaced, false);
    }
  }

  /**
   * The full persistable document: the scene ({@link toSnapshot}) plus the
   * live camera pose (fr-1k4). Used for the autosave/hash, the collection,
   * and share links. Undo-history snapshots deliberately stay camera-less
   * (see SceneSnapshot.camera's doc) — that's why `snapshot` below does NOT
   * use this.
   */
  function currentDocument(): SceneSnapshot {
    return { ...toSnapshot(state), camera: cameraPose() };
  }

  // Session-only undo/redo plus the edit-burst / debounced-save policy layered
  // over it (see edit-session.ts). The injected deps are the app's real
  // capabilities: encode and persist the live scene document, apply a restored
  // snapshot (restoreSnapshot above — which must not checkpoint), read the live
  // camera pose (captured out of band per history entry, fr-uf3), reflect
  // undo/redo availability in the UI, and the debounced save-timer itself. Edit
  // handlers call editSession.beginEdit() BEFORE mutating the document; Ctrl+Z/
  // Ctrl+Shift+Z call undo()/redo(); the page-hide handlers below call flush().
  const editSession = new EditSession({
    snapshot: () => encodeScene(toSnapshot(state)),
    persist: () => saveScene(currentDocument()),
    restore: restoreSnapshot,
    // The live orbit pose, captured out of band onto each history entry
    // (fr-uf3) so undo/redo across a replace restores the exact framing —
    // never into the snapshot string, which stays camera-less for the dedup.
    pose: cameraPose,
    syncUi: (canUndo, canRedo) => ui.setUndoRedo(canUndo, canRedo),
    schedule: (fn) => {
      const id = setTimeout(fn, SAVE_DEBOUNCE_MS);
      return () => clearTimeout(id);
    },
  });

  // Flush any pending debounced save on page hide so an edit made less than
  // SAVE_DEBOUNCE_MS before the tab is closed or backgrounded is not lost.
  // saveScene (via editSession.persist) already handles SecurityError
  // (sandboxed iframes) and private-mode localStorage failures without throwing.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") editSession.flush();
  });
  window.addEventListener("pagehide", () => editSession.flush());

  /**
   * Load a saved (encoded) scene from the collection gallery (fr-cai) as a
   * whole-system replacement — the same treatment a preset load / Surprise Me
   * gets. Unlike {@link restoreSnapshot} (EditSession's checkpoint-free
   * `restore`), a gallery load IS a genuine user edit, so it cuts its own
   * "replace" undo checkpoint (making the load undoable and arming the
   * debounced save) via `beginEdit("replace")` before applying, and restores
   * the framing: the pose saved with the scene when there is one (fr-1k4),
   * an auto-fit for entries with no stored pose. A corrupt entry (decode
   * returns null — can't happen for our own encodeScene output, but the
   * collection is untrusted localStorage) is ignored rather than blanking
   * the current scene; the boolean return says whether the load actually
   * applied, so onLoadFromCollection never arms a render-mode hint
   * (fr-75sq) for a load that never happened.
   */
  function loadEncodedScene(encoded: string): boolean {
    const snap = decodeScene(encoded);
    if (!snap) return false;
    editSession.beginEdit("replace");
    applyDecodedSnapshot(snap, snap.camera === undefined, true);
    if (snap.camera) applyCameraPose(snap.camera);
    return true;
  }

  /**
   * Shared choreography for edits that replace or modify the transform set.
   *
   * Centralises the autoUpdate policy in one place:
   *   "auto"   — regenerate only when autoUpdate is on (add/remove/drag edits)
   *   "always" — always regenerate regardless of autoUpdate (preset loads must
   *               rebuild because the entire transform set is replaced)
   *
   * "always" also marks the regenerate() call as a whole-system replacement
   * (its `replaced` flag — see regenerate()'s doc), so a freshly loaded
   * non-flat preset always gets resetFourDView()'s "fresh visit" treatment,
   * even switching directly between two non-flat presets — and asks the
   * arrival handler to auto-frame the camera on the fresh cloud (fr-0b8),
   * which is why onPreset/onSurprise no longer call fitCameraToAttractor
   * themselves.
   *
   * regenerate() is asynchronous (fr-5kx): the new cloud — and with it the
   * `viewIs4D` flip, the fresh-visit resets, and the camera fit — lands in
   * applyCloudResult when the generation completes. The refreshGuides()/
   * refreshUi() here therefore render the CURRENT (pre-arrival) view, which
   * is correct — the old cloud is still on screen — and applyCloudResult
   * re-refreshes both when an arriving result flips flatness.
   *
   * "always" is also the system-morph trigger (fr-a04l): instead of the plain
   * `regenerate(true, true)` snap, the display tweens from the pre-load
   * system (captured before the reducer runs) to the freshly loaded one —
   * see regenerateReplaced. An ordinary ("auto") edit instead snaps any
   * in-flight morph to its target first: the document the edit applies to IS
   * that target, so the display must stop tweening somewhere the edit never
   * happened.
   *
   * Before applying the reducer, checkpoints an undo step and, after it, every
   * geometry edit refreshes the guide boxes and the UI, then schedules a
   * debounced save (see `editSession.beginEdit`).
   *
   * Every edit through here also ends the ambient drift show (fr-wavo) —
   * except the show's own leg, which is this exact path with `morphMs` set
   * to its slower glide (see driftPolicy's launchLeg and the own-leg guard
   * in drift-policy.ts).
   */
  function applyEdit(
    applyReducer: () => void,
    effect: "auto" | "always" = "auto",
    morphMs?: number,
  ): void {
    // Notify (fr-ygr1): every ordinary document edit (add/remove transform,
    // preset load, Surprise Me, toggles) flows through here. The show's own
    // roll (driftPolicy.advance → rollSurpriseSystem) takes this exact path
    // too, but under the policy's own-leg guard the stop no-ops before the
    // toast — only a genuine user edit actually stops (and announces)
    // anything.
    driftPolicy.stop({ notify: true });
    // Any fresh edit supersedes a preset hint still waiting for its cloud
    // (fr-39y) — onPreset re-arms it right after this returns.
    pendingRenderMode = null;
    if (effect === "auto") snapMorph();
    const morphFrom = currentMorphSystem();
    editSession.beginEdit(effect === "always" ? "replace" : "tweak");
    applyReducer();
    if (effect === "always") {
      regenerateReplaced(morphFrom, true, morphMs);
    } else if (state.autoUpdate) {
      regenerate();
    }
    refreshGuides();
    refreshUi();
  }

  /**
   * Roll a fresh random system into the document — the shared body of the
   * Surprise Me button and a drift leg (fr-wavo): the same
   * quality-gated roll (random-system.ts), the same "replace" undo
   * checkpoint and camera auto-fit (via applyEdit "always"), differing only
   * in `morphMs` — a drift leg glides at DRIFT_MORPH_MS where a button
   * press keeps the snappier click-feedback default.
   */
  function rollSurpriseSystem(morphMs?: number): void {
    applyEdit(
      () => {
        const sys = randomSystem(Math.random);
        state = setTransforms(state, sys.transforms);
        // sys.finalTransform is Transform | null; setFinalTransform treats
        // null as "clear" (stores undefined), so a previous session's lens
        // never survives a roll that landed on no final transform.
        state = setFinalTransform(state, sys.finalTransform);
        // sys.symmetry is SymmetryParams | null (fr-d61; rolled for flat
        // systems only) — same discipline as the lens above: a null roll
        // RESETS the order, so a kaleidoscope left over from earlier play
        // never multiplies a fresh surprise in a way its quality gate never
        // probed. regenerate() (via applyEdit "always") reads state.symmetry
        // for both the point cloud and the flame worker's restart payload,
        // and refreshUi() syncs the slider/axis controls.
        state = setSymmetryOrder(
          state,
          sys.symmetry?.order ?? DEFAULT_SYMMETRY_ORDER,
        );
        state = setSymmetryAxis(
          state,
          sys.symmetry?.axis ?? DEFAULT_SYMMETRY_AXIS,
        );
      },
      "always",
      morphMs,
    );
    // A rolled system never carries a preset's tumbling scaffold (only the
    // polytope presets do), but one from an earlier visit could still be
    // showing — clear it unconditionally. (The camera auto-fit rides the
    // generation request — see applyEdit.)
    scene.setFourDScaffold(null);
  }

  // ── Mutation grid (fr-3vly) ────────────────────────────────────────────
  // Directed exploration AROUND the current system — the gap between the
  // precise sliders and Surprise Me's total reroll: eight quality-gated
  // small perturbations (the last one a bolder wildcard) in a 3×3 modal
  // with the current system pinned at the center. The candidates live here;
  // the Ui only shows cells. Each candidate + thumbnail is built one
  // animation frame at a time so the modal opens instantly and fills
  // progressively; the token makes every re-seed (open, pick, "Mutate
  // again") cancel the previous build, and closing the modal ends the build
  // on its next step. Session-only — nothing here touches the document
  // until a pick, which is a normal undoable replace-load.
  const MUTATION_CELLS = 8;
  /** Canvas pixels per thumbnail — ~2× the dialog's ~85-160px CSS cells so
   * they stay crisp on hidpi screens. */
  const MUTATION_THUMB_SIZE = 220;
  let mutationCandidates: MorphSystem[] = [];
  let mutationBuildToken = 0;

  function buildMutationGrid(): void {
    const token = ++mutationBuildToken;
    const base = currentMorphSystem();
    mutationCandidates = [];
    ui.resetMutationCells();
    ui.setMutationCurrent(
      renderSystemThumb(base, MUTATION_THUMB_SIZE, Math.random),
      MUTATION_THUMB_SIZE,
    );
    let index = 0;
    const step = (): void => {
      if (token !== mutationBuildToken || !ui.mutationsOpen()) return;
      const wild = index === MUTATION_CELLS - 1;
      const candidate = mutateSystem(base, Math.random, { wildcard: wild });
      mutationCandidates[index] = candidate;
      ui.setMutationCell(
        index,
        renderSystemThumb(candidate, MUTATION_THUMB_SIZE, Math.random),
        MUTATION_THUMB_SIZE,
        wild,
      );
      index += 1;
      if (index < MUTATION_CELLS) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /** Load mutation candidate `index` — the same replace-load path as a
   * Surprise Me roll (undo checkpoint, morph-in, camera fit) — then re-seed
   * the grid around the pick: the modal stays open with the pick as the new
   * center, so exploration can keep walking outward. */
  function pickMutation(index: number): void {
    const candidate = mutationCandidates.at(index);
    if (!candidate) return;
    applyEdit(() => {
      state = setTransforms(state, candidate.transforms);
      state = setFinalTransform(state, candidate.finalTransform);
      // Mutation preserves symmetry, so this re-applies the same values —
      // kept for uniformity with the other replace-load paths.
      state = setSymmetryOrder(state, candidate.symmetry.order);
      state = setSymmetryAxis(state, candidate.symmetry.axis);
    }, "always");
    // A mutated system is no longer the polytope a preset's scaffold
    // illustrated — clear it, like rollSurpriseSystem.
    scene.setFourDScaffold(null);
    buildMutationGrid();
  }

  // The one place control-spec.ts's declared effects meet the app's real
  // capabilities: scene pushes, render-session forwards, and the refreshers.
  // The arrows only fire at input time — well after boot — so forwarding to
  // the flame/solid RenderSessions (declared above) is safe.
  const controlEffects: ControlEffects = {
    scene,
    postFlame: (command) => flameSession.post(command),
    postVoxel: (command) => solidSession.post(command),
    presentSharedFlameFrame: () => {
      if (!flameShared) return false;
      presentSharedFrame();
      return true;
    },
    regenerateIfAutoUpdate: () => {
      if (state.autoUpdate) regenScheduler.schedule();
    },
    recolor,
    applyFourDColor,
    restartSolidRender: () => solidSession.enter(),
  };

  // Every simple scalar control (slider/select/checkbox bound to one state
  // field) shares the one pipeline in onScalarControl below, driven by
  // control-spec.ts's SCALAR_CONTROLS table. Its `view` guard replaces the
  // old per-handler viewIs4D checks — belt-and-braces for controls whose row
  // is hidden in the other view (symmetry, color mode/contrast, depth style,
  // the 4D color/fade), so a stray event can't mutate a concern that isn't
  // even on screen. Everything that edits the system, loads a preset/
  // Surprise-Me system, or selects a transform stays a bespoke handler and is
  // UNGUARDED (fr-bf6): the single editor and transform list are live for a
  // non-flat system exactly like a flat one.
  ui.bind({
    onAdd: () => {
      applyEdit(() => {
        state = addTransform(state);
      });
    },
    onRemove: () => {
      applyEdit(() => {
        state = removeTransform(state);
      });
    },
    onUndo: () => editSession.undo(),
    onRedo: () => editSession.redo(),
    onPreset: (preset) => {
      applyEdit(() => {
        state = setTransforms(state, presetTransforms(preset));
      }, "always");
      // The tumbling scaffold (Show guides toggles it with the grid/axes) —
      // the polytope presets carry one (see PRESET_SCAFFOLDS); every other
      // preset (flat or non-flat) clears whatever the previous one left.
      // (The camera auto-fit rides the generation request — see applyEdit.)
      scene.setFourDScaffold(PRESET_SCAFFOLDS[preset]?.() ?? null);
      // A preset authored for a specific renderer (fr-39y: the Flame optgroup)
      // arms its render-mode hint AFTER applyEdit (which clears it); the
      // arriving cloud consumes it — see applyCloudResult — so the showcase
      // preset actually shows up in the renderer its menu group promises.
      pendingRenderMode = PRESET_RENDER_HINTS[preset] ?? null;
    },
    // A manual press is a manual replace-load, so applyEdit (inside) also
    // ends a running drift show — the show's own legs take the same path
    // with a longer morph (see driftPolicy's launchLeg).
    onSurprise: () => rollSurpriseSystem(),
    // The mutation grid (fr-3vly): open + build, pick (replace-load + re-seed),
    // and reroll all share buildMutationGrid's token, so each supersedes any
    // build still filling cells.
    onOpenMutations: () => {
      ui.openMutations();
      buildMutationGrid();
    },
    onMutationPick: (index) => pickMutation(index),
    onMutateAgain: () => buildMutationGrid(),
    // The ambient drift show's toggle (fr-wavo). Session-only, never
    // persisted; the button is disabled under reduced motion
    // (syncDriftAvailability), and the guard here covers a preference flip
    // that raced the disable. Starting the show closes the panel like
    // "Watch it build" does — it's a lean-back display; the current
    // attractor gets a full dwell before the first departure (drift.ts).
    // Stopping keeps the display exactly where it is: a mid-glide morph
    // finishes on its own (MorphTween has no cancel, by design).
    onDriftToggle: () => {
      if (driftShow.active) {
        // Silent (fr-ygr1): the explicit drift-button toggle itself — the
        // user is looking right at the button reverting, so no toast needed.
        driftPolicy.stop();
        return;
      }
      if (prefersReducedMotion()) return;
      driftSource = "random";
      driftShow.start();
      ui.setDriftActive(true);
      state = setPanelOpen(state, false);
      ui.updateLabels(state);
    },
    // The generic scalar pipeline (fr-dig): view guard → undo checkpoint +
    // debounced save for document edits → the spec's own parse + reducer →
    // label sync → the spec's declared side effects. Per-control semantics
    // (worker forwards, restarts, live tone-maps) live on the SCALAR_CONTROLS
    // entries in control-spec.ts, next to the control they belong to.
    onScalarControl: (spec, raw, phase = "input") => {
      if (spec.view === "flat" && viewIs4D) return;
      if (spec.view === "nonFlat" && !viewIs4D) return;
      // Commit-on-release (fr-2c27): the drag's own "input" events already
      // ran the branch below for every intermediate value — each its own
      // undo-coalesced edit — so by the time the trailing "change" reports
      // this commit, the settled value is already live. Route it straight to
      // the spec's `commit` effect and stop: re-applying the reducer here
      // would be a no-op on the same value, and re-running beginEdit would
      // risk cutting a second undo checkpoint for an edit that already
      // happened.
      if (phase === "commit") {
        if (spec.kind === "range") spec.commit?.(state, controlEffects, state);
        return;
      }
      const previous = state;
      // Undoable document edits end the drift show (fr-wavo); the
      // session-only specs (persisted: false — e.g. autoUpdate) are view
      // preferences and leave it running, like camera input. Notify
      // (fr-ygr1): a slider/select/checkbox edit is exactly the "the user
      // was doing something else" case.
      if (spec.persisted !== false) {
        driftPolicy.stop({ notify: true });
        editSession.beginEdit();
      }
      state = applyScalarControl(state, spec, raw);
      ui.updateLabels(state);
      spec.effect?.(state, controlEffects, previous);
    },
    // The gradient editor (fr-55k) is a bespoke widget like the transform
    // sliders, not a table-driven scalar: its value is a stop LIST. Same
    // pipeline shape as onScalarControl — undo checkpoint + debounced save,
    // reducer, label sync, then the render-worker forward — except the
    // forward goes to whichever render(s) currently select the custom
    // palette (each post is a no-op while that worker is inactive). A drag
    // inside a color picker fires a burst of input events; beginEdit
    // coalesces them into one undo step exactly like a slider drag, and the
    // worker's setPalette restart re-accumulates the preview live. The live
    // point cloud's height/radius ramps can select the custom gradient too
    // (fr-3b6) — a recolor over the cached run, never a regenerate.
    onCustomPaletteStops: (stops) => {
      // Notify (fr-ygr1): a gradient-editor edit, same bucket as any other
      // document edit.
      driftPolicy.stop({ notify: true });
      editSession.beginEdit();
      state = setCustomPaletteStops(state, stops);
      ui.updateLabels(state);
      const palette = resolvePalette(CUSTOM_PALETTE_ID, state.customPalette);
      if (state.flame.paletteId === CUSTOM_PALETTE_ID)
        flameSession.post({ type: "setPalette", palette });
      if (state.solid.paletteId === CUSTOM_PALETTE_ID)
        solidSession.post({ type: "setPalette", palette });
      // The edited gradient is baked into the live cloud's color buffer
      // whenever the ramp palette selects it and the active view's ramp mode
      // shows it — the 3D height/radius modes (colorModeUsesRampPalette) or
      // the 4D radius mode (fr-6ue) — even while a flame/solid render is
      // showing, so the explorer never returns stale-colored. recolor and
      // applyFourDColor each no-op in the other view, so both bakes can be
      // requested and exactly the displayed cloud's one runs.
      if (state.rampPaletteId === CUSTOM_PALETTE_ID) {
        if (colorModeUsesRampPalette(state.colorMode)) recolor();
        if (state.fourDColor === "radius") applyFourDColor();
      }
    },
    // The axis-color pickers (fr-8k7) are a bespoke widget like the gradient
    // editor: undo checkpoint + debounced save, reducer, label sync, then a
    // recolor over the cached run — never a regenerate. No worker forward:
    // the flame/solid renders snapshot the colors at entry, and the pickers
    // are unreachable while a render is active (the explorer block hides).
    onPositionAxisColors: (colors) => {
      // Notify (fr-ygr1): an axis-color-picker edit, same bucket as any
      // other document edit.
      driftPolicy.stop({ notify: true });
      editSession.beginEdit();
      state = setPositionAxisColors(state, colors);
      ui.updateLabels(state);
      if (state.colorMode === "position") recolor();
    },
    onRegenerate: () => regenerate(),
    // "▶ Watch it build" (fr-1zb): replay the DISPLAYED cloud's own
    // generation order — no regeneration, no RNG roll, so the shape the user
    // has been looking at is exactly the one that re-accretes. Leaves any
    // flame/solid render (the replay lives in the points view) and closes
    // the About dialog + panel so the stage is actually watchable.
    onWatchBuild: () => {
      switchRenderMode("points");
      // A replay and the drift show can't share the stage: a drift leg's
      // regeneration would kill the replay a few seconds in (fr-wavo).
      // Notify (fr-ygr1): "Watch it build" is its own action, not the drift
      // control — the drift show ending is a side effect the user didn't
      // ask for, same bucket as an edit reaching in from elsewhere (see
      // the driftPolicy wiring's doc, which groups "starting a build replay" with
      // applyEdit/time-travel/gallery-loads as "the user reached in").
      driftPolicy.stop({ notify: true });
      // Snap any in-flight morph before replaying (fr-a04l): the replay
      // reveals the displayed buffer, which should be the settled target,
      // not a mid-morph intermediate. (Morph landings cancel a replay
      // naturally via applyCloudResult, so an unsnapped morph would kill the
      // replay a frame in anyway.)
      snapMorph();
      ui.closeAbout();
      // Remember whether the panel was open so endReplayDisplay can restore
      // it once the replay ends (fr-vpka) — closed here unconditionally so
      // the stage is watchable, same as ever. ??= so a restart mid-replay
      // (the About dialog's button is still reachable) keeps the FIRST
      // start's memory instead of overwriting it with the forced-closed
      // state (fr-hpci; the showcase guard below is its twin).
      panelOpenBeforeReplay ??= state.panelOpen;
      state = setPanelOpen(state, false);
      ui.updateLabels(state);
      const count = viewIs4D ? fourDResult?.count : lastResult?.count;
      // The map count sizes the spotlight tour (fr-01kf): one step per base
      // transform, skipped entirely by BuildReplay for single-map systems.
      buildReplay.start(count ?? 0, state.transforms.length);
      // Arm the showcase overrides (fr-hpci; see replayShowcase's doc): by-
      // transform colors, guides on, and the view's auto-motion running for
      // the duration of the replay, restored by endReplayDisplay. Only when
      // the replay actually started (a 0-point cloud leaves it idle, and an
      // armed showcase would then never be disarmed), and only when not
      // already armed (a restart must keep the FIRST start's priors — the
      // current motion flag is the showcase's own forced value by then).
      if (buildReplay.active && replayShowcase === null) {
        const fourD = viewIs4D;
        const color =
          (fourD ? state.fourDColor : state.colorMode) !== "transform";
        // Motion is a showcase EXTRA, not what the click asked for, so unlike
        // the replay itself it stays off under reduced motion. The sticky
        // auto-motion choice (fr-g98) is deliberately not consulted or
        // written: this is a programmatic write, not a user toggle, and the
        // prior flag comes back verbatim on disarm.
        let motionWasOn: boolean | null = null;
        if (!prefersReducedMotion()) {
          if (fourD) {
            motionWasOn = fourDView.tumbleOn;
            fourDView.tumbleOn = true;
          } else {
            motionWasOn = autoOrbitOn;
            autoOrbitOn = true;
          }
        }
        replayShowcase = { color, motionWasOn, fourD };
        refreshGuides();
        if (color) {
          if (fourD) applyFourDColor();
          else recolor();
        }
        // The legend must narrate the showcase's by-transform colors, not
        // the document's mode (ui.ts folds the flag into updateLegend); the
        // extra sync repaints it now.
        ui.setReplayShowcaseLegend(true);
        ui.updateLabels(state);
      }
    },
    onRecordVideoToggle: () => {
      recorder.toggle();
    },
    // Saved-scene collection (fr-cai). Save/copy act on the CURRENT document
    // (the same encodeScene(currentDocument()) the autosave uses — camera
    // pose included, fr-1k4, so a loaded entry restores its framing); the
    // thumbnail is a downsampled snapshot of what is actually showing —
    // reachable in every render mode since fr-75sq, so a save made from a
    // flame/solid render captures the rendered frame and tags the entry
    // with the mode it came from (loading it re-enters that renderer, and a
    // drift-collection leg plays it there). During a render's first-frame
    // gap the screen still shows the explorer (the sessions' first-frame
    // gate), so the thumbnail honestly captures that instead — the tag
    // stays the render's, which is what the save meant.
    onSaveToCollection: () => {
      const thumbnailMode =
        state.renderMode === "flame" && flameSession.hasFirstFrame
          ? "flame"
          : state.renderMode === "solid" && solidSession.hasFirstFrame
            ? "solid"
            : "points";
      collection.add(
        encodeScene(currentDocument()),
        scene.captureThumbnail(thumbnailMode),
        state.renderMode === "points" ? undefined : state.renderMode,
      );
      ui.setCollectionCount(collection.size);
      ui.flashToast("Saved to collection");
    },
    onOpenGallery: () => {
      ui.openGallery(collection.all());
    },
    // The gallery modal's "▶ Drift collection" (fr-w2ve): the same ambient
    // show as onDriftToggle — same lean-back panel close, same full dwell on
    // the current attractor before the first departure, same Stop-drifting
    // toggle to end it — but its legs walk the saved collection in gallery
    // order, looping (advanceCollectionLeg), instead of rolling surprises.
    // Restarted shows play from the front again (the cursor resets). The
    // button is disabled while the collection is empty or motion is reduced;
    // the guard covers a click racing either change.
    onDriftCollection: () => {
      if (prefersReducedMotion() || collection.size === 0) return;
      driftSource = "collection";
      driftLastPlayedId = null;
      driftShow.start();
      // Started from inside a CONVERGING flame/solid render (the gallery is
      // reachable there since fr-75sq): hold the first departure for that
      // render's completion — start()'s plain dwell would yank a still
      // mid-convergence. A render that already met its budget sends no
      // further progress, so it keeps the dwell instead (renderComplete).
      if (state.renderMode !== "points" && !renderComplete[state.renderMode]) {
        driftShow.hold();
      }
      ui.setDriftActive(true);
      ui.closeGallery();
      state = setPanelOpen(state, false);
      ui.updateLabels(state);
    },
    onLoadFromCollection: (id) => {
      const entry = collection.all().find((s) => s.id === id);
      if (!entry) return; // deleted between render and click — nothing to load.
      ui.closeGallery();
      // A tagged entry re-enters the renderer it was saved from when its
      // restored cloud lands (fr-75sq) — the preset-hint path. Armed only
      // when the load actually applied (a corrupt entry must not leave a
      // stale hint), and AFTER it: applyDecodedSnapshot clears the hint.
      if (loadEncodedScene(entry.encoded) && entry.mode) {
        pendingRenderMode = entry.mode;
      }
    },
    onDeleteFromCollection: (id) => {
      // Snapshot the entry before removing it (fr-ifts): the Undo toast's
      // collection.restore(entry) needs the exact object back — id, encoded,
      // thumbnail, createdAt, mode — and once it's gone from the collection
      // there's nothing left to re-derive that from. A stale id (already
      // gone — a double click, or a raced second delete) finds nothing and
      // skips the whole thing; remove() would no-op too, but there's no
      // point flashing an Undo for a delete that didn't actually happen.
      const entry = collection.all().find((s) => s.id === id);
      if (!entry) return;
      collection.remove(id);
      ui.setCollectionCount(collection.size);
      ui.renderGallery(collection.all()); // refresh the still-open modal in place.
      ui.flashToast("Deleted from collection", {
        label: "Undo",
        onAction: () => {
          collection.restore(entry);
          ui.setCollectionCount(collection.size);
          // Same refresh as the delete above — consistent whether the
          // gallery modal is currently open or closed.
          ui.renderGallery(collection.all());
        },
      });
    },
    onCopyLink: () => {
      // Build the link from CURRENT state rather than reading location.hash,
      // which the autosave only writes on its 300ms debounce (so it can lag a
      // just-made edit). origin + pathname drops any existing hash/query.
      // currentDocument() includes the camera pose (fr-1k4): the link opens
      // framed exactly as the sender sees it.
      const link = `${location.origin}${location.pathname}#${encodeScene(
        currentDocument(),
      )}`;
      void copyToClipboard(link).then((ok) =>
        ui.flashToast(ok ? "Link copied" : "Couldn't copy the link"),
      );
    },
    onSavePng: () => {
      // Capture the bare WebGL canvas (fractal + backdrop, no UI chrome) — or,
      // while a flame render is active, its own 2D canvas (true alpha; see
      // captureFlameFrame) — or, while a solid render is active, a fresh
      // raymarch of the live camera (captureSolidFrame) — and hand it to the
      // browser as a timestamped download.
      const link = document.createElement("a");
      link.href =
        state.renderMode === "solid"
          ? scene.captureSolidFrame()
          : state.renderMode === "flame"
            ? scene.captureFlameFrame()
            : scene.captureFrame();
      link.download = `fractal-${Date.now()}.png`;
      link.click();
    },
    onSelect: (index) => {
      state = selectTransform(state, index);
      refreshGuides();
      refreshUi();
    },
    onTransformGeometry: (index, geometry) => {
      // Notify (fr-ygr1): a panel-slider transform edit, same bucket as any
      // other document edit.
      driftPolicy.stop({ notify: true });
      editSession.beginEdit();
      state = updateTransform(state, index, geometry);
      scene.setGuideGeometry(index, geometry);
      ui.renderTransformList(
        state.transforms,
        state.selectedTransform,
        state.finalTransform ?? null,
      );
      if (state.autoUpdate) regenScheduler.schedule();
    },
    onToggleFinalTransform: (checked) => {
      applyEdit(() => {
        if (checked) {
          // Enable a default (identity, no-op) lens and jump straight to its
          // editor so the next click can start shaping it.
          state = setFinalTransform(
            state,
            state.finalTransform ?? defaultFinalTransform(),
          );
          state = selectTransform(state, "final");
        } else {
          state = setFinalTransform(state, null);
          // Drop the selection if it was pointing at the now-removed lens.
          if (state.selectedTransform === "final")
            state = selectTransform(state, null);
        }
      });
    },
    onFinalTransformGeometry: (geometry) => {
      // Notify (fr-ygr1): a panel-slider final-transform edit, same bucket
      // as any other document edit.
      driftPolicy.stop({ notify: true });
      editSession.beginEdit();
      state = setFinalTransform(state, { id: 0, ...geometry });
      ui.renderTransformList(
        state.transforms,
        state.selectedTransform,
        state.finalTransform ?? null,
      );
      if (state.autoUpdate) regenScheduler.schedule();
    },
    onTogglePanel: () => {
      // Opening the panel mid-replay is reaching back in (fr-hpci): end the
      // replay first — same philosophy as the drift show's stop-on-edit —
      // so the controls the panel reveals always show settings that are
      // actually in effect (the showcase overrides disarm with the replay).
      // The replay's own panel memory is consumed un-applied: the user just
      // took manual control of the panel, so their toggle wins over both
      // the fr-vpka restore and this handler's flip-from-closed below.
      if (!state.panelOpen && (buildReplay.active || replayCaption !== null)) {
        panelOpenBeforeReplay = null;
        cancelReplay();
      }
      state = setPanelOpen(state, !state.panelOpen);
      ui.updateLabels(state);
    },
    onClosePanel: () => {
      state = setPanelOpen(state, false);
      ui.updateLabels(state);
    },
    onRenderMode: (mode) => {
      // A manual switch outranks a preset hint still waiting for its cloud.
      pendingRenderMode = null;
      switchRenderMode(mode);
    },
    // Slice state is session-only view state (like the tumble clock): it never
    // touches AppState or persistence, so these write straight to fourDView and
    // re-upload the slice trio to the scene (see pushFourDSlice).
    onFourDSliceToggle: (checked) => {
      fourDView.sliceOn = checked;
      pushFourDSlice();
    },
    onFourDSliceInput: (value) => {
      fourDView.sliceCenter = value;
      pushFourDSlice();
    },
    onFourDSliceRelColorToggle: (checked) => {
      fourDView.sliceRelColor = checked;
      pushFourDSlice();
    },
    // Tumble pause/resume + speed (fr-woc): also session-only view state, no
    // save — animate() reads these fields off fourDView directly every frame,
    // so there is nothing else to push here. The toggle goes through
    // setTumbleUserChoice (not a bare tumbleOn write) so the choice is sticky
    // across fresh-visit resets (fr-g98).
    onFourDTumbleToggle: (checked) => {
      fourDView.setTumbleUserChoice(checked);
      // Persist the COMBINED auto-motion pref (fr-0ya): the last motion toggle
      // the user flips — tumble or orbit — becomes the one shared choice both
      // seed from on the next reload. Separate viewer-prefs key, never the
      // scene / share-URL document.
      saveViewerPrefs({ autoMotion: checked });
    },
    onFourDTumbleSpeedInput: (value) => {
      fourDView.tumbleSpeed = value;
    },
    // Auto-orbit pause/resume + speed (fr-1yn): the 3D siblings of the tumble
    // handlers above, same session-only pattern — the toggle also records the
    // sticky user choice resetAutoOrbitView() honors (fr-g98).
    onAutoOrbitToggle: (checked) => {
      autoOrbitOn = checked;
      autoOrbitUserChoice = checked;
      // Persist the COMBINED auto-motion pref (fr-0ya) — the orbit sibling of
      // onFourDTumbleToggle above; both write the one shared choice.
      saveViewerPrefs({ autoMotion: checked });
    },
    onAutoOrbitSpeedInput: (value) => {
      autoOrbitSpeed = value;
    },
  });

  const gestures = attachInteractions(scene, orbit, {
    selectedTransform: selectedBox,
    frozen: () => state.renderMode === "flame",
    onTransformChange: (index, geometry) => {
      // A guide-box drag is a system edit (unlike a camera drag): it ends
      // the drift show like every other undoable edit (fr-wavo). Notify
      // (fr-ygr1): same bucket as any other document edit.
      driftPolicy.stop({ notify: true });
      editSession.beginEdit();
      state = updateTransform(state, index, geometry);
      ui.renderTransformList(
        state.transforms,
        state.selectedTransform,
        state.finalTransform ?? null,
      );
      ui.renderTransformEditor(state.transforms[index], index);
      if (state.autoUpdate) regenScheduler.schedule();
    },
    fourDView: () => viewIs4D,
    onFourDRotate: ({ xw, yw, zw }) => {
      if (!viewIs4D) return; // belt-and-braces, same as the ui handlers
      // An active render froze the rotor into its worker snapshot
      // (fourDRenderSnapshot); a gesture mutating it mid-render would change
      // nothing on screen (animate() skips setRot4 while rendering) and then
      // surface as a surprise orientation jump on exit. `frozen` already
      // blocks all drags during the flame render; the solid render keeps its
      // camera gestures live, so the w-plane gesture needs this gate.
      if (state.renderMode !== "points") return;
      fourDView.rotate(xw, yw, zw);
      // animate() pushes fourDView.matrix() next frame; nothing else to do.
    },
  });

  window.addEventListener("resize", () => {
    scene.resize(window.innerWidth, window.innerHeight);
    // Backdrop visibility depends on the viewport width (mobile scrim), so
    // crossing MOBILE_BREAKPOINT — e.g. rotating a phone to landscape with
    // the panel open — must re-sync it or the scrim sticks around.
    ui.updateLabels(state);
  });

  // Undo/redo keyboard shortcuts. Guarded so a text-editing target keeps its
  // native undo (no text inputs exist in the app today; belt-and-braces for
  // future ones). Sliders/selects/checkboxes have no native undo, so a focused
  // slider still lets Ctrl+Z time-travel the scene. Cmd+Y is deliberately NOT
  // bound: it is the browser's history shortcut on macOS.
  window.addEventListener("keydown", (e) => {
    const t = e.target;
    if (t instanceof HTMLElement) {
      if (t.isContentEditable || t instanceof HTMLTextAreaElement) return;
      if (
        t instanceof HTMLInputElement &&
        !["range", "checkbox", "radio", "button"].includes(t.type)
      )
        return;
    }
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === "z") {
      e.preventDefault();
      if (e.shiftKey) editSession.redo();
      else editSession.undo();
    } else if (key === "y" && e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault();
      editSession.redo();
    }
  });

  const loading = document.getElementById("loading");
  if (loading) loading.style.display = "none";
  scene.setRenderStyle(state.renderStyle);
  scene.setPointSize(state.pointSize);
  // Same push for the restored 4D depth-fade toggle (fr-3e0): the uniform
  // defaults to off, so a scene restored with the fade on would render
  // without it until the checkbox first moved.
  scene.setFourDDepthFade(state.fourDDepthFade);
  // Push the restored solid threshold/lighting to the GPU uniforms: without
  // this, a scene restored with non-default solid params would render with
  // voxel-material.ts's hardcoded defaults until a solid slider first moved.
  scene.setSolidParams(state.solid);
  // Boot generation runs SYNCHRONOUSLY (generateSync) even though every later
  // regeneration goes through the worker (fr-5kx): the first paint should
  // include the cloud, not an empty backdrop for a worker round-trip — and
  // the inline delivery sets `viewIs4D` for a possibly-restored non-flat
  // scene before the refreshGuides()/resetAutoOrbitView() reads just below,
  // which need it current, not defaulted to `false`.
  // Capped (fr-t3gl): the sync path exists for first paint, not for the
  // full density — see BOOT_SYNC_MAX_POINTS. bootParams is built ONCE so the
  // async upgrade below reuses the same rolled seed.
  const bootParams = cloudParams(false, false);
  const bootCount = Math.min(bootParams.numPoints, BOOT_SYNC_MAX_POINTS);
  cloudGenerator.generateSync({ ...bootParams, numPoints: bootCount });
  // Restore the framing the restored scene was last seen with (fr-1k4): a
  // reopened PWA / reloaded tab with a saved camera pose reapplies it
  // instead, so the cloud stays centred and the orbit pivots around it. Any
  // pose-less boot — an older save with no stored pose, or a genuinely fresh
  // visit — auto-frames the attractor instead, instantly, not the
  // preset-load glide: a boot is a cut, not a transition. The fit keeps the
  // default boot camera's viewing ANGLE (theta/phi) and only dollies in to
  // frame (fr-3xfk).
  if (saved?.camera) {
    applyCameraPose(saved.camera);
  } else {
    fitCameraToAttractor();
    cameraTween.finish();
  }
  // A flat boot never routes through regenerate()'s flip/replacement branches,
  // so seed the auto-orbit baseline (incl. the reduced-motion pause and the
  // checkbox sync) explicitly. A non-flat boot leaves it to the first
  // non-flat→flat transition, exactly like the tumble in the other direction.
  if (!viewIs4D) resetAutoOrbitView();
  refreshGuides();
  refreshUi();
  editSession.syncUi();
  ui.setCollectionCount(collection.size);
  // The async upgrade to the document's real density (fr-t3gl): same request
  // (same seed) at the full count, through the worker, now that the capped
  // boot cloud has painted and the camera is framed. The boot cloud is this
  // request's exact prefix, so the arrival only adds points; fit stays
  // false — the framing above already stands. Superseded harmlessly by any
  // immediate user edit (latest-wins), whose own request carries the full
  // count anyway.
  if (bootCount < bootParams.numPoints) {
    cloudGenerator.request(bootParams);
  }

  // Drift is unavailable under reduced motion — no motion means no drift
  // (fr-wavo): the toggle disables itself with an explanation rather than
  // silently doing nothing. Tracked live, so flipping the OS preference
  // mid-session both disables the toggle and ends a running show
  // immediately (DriftPolicy.advance's leg-boundary check is the belt-and-braces
  // for engines that never fire the change event).
  const reducedMotionQuery = window.matchMedia?.(
    "(prefers-reduced-motion: reduce)",
  );
  function syncDriftAvailability(): void {
    ui.setDriftAvailable(!prefersReducedMotion());
    // Silent (fr-ygr1): the reduced-motion availability sync itself.
    if (prefersReducedMotion()) driftPolicy.stop();
  }
  syncDriftAvailability();
  reducedMotionQuery?.addEventListener("change", syncDriftAvailability);

  // While a flame render is active, accumulation/downsample/tone-map all
  // happen in the worker (see flame-worker-core.ts) and arrive as "progress"
  // events (handleFlameEvent) — this loop just keeps redrawing whatever
  // image was most recently uploaded via scene.setFlameImage.
  /**
   * Per-frame adaptive-resolution bookkeeping (fr-4lyt). Feeds the governor
   * the dt between consecutively RENDERED frames — a skipped frame (fr-py7z)
   * breaks the chain instead of reading as one huge dt. Sampling pauses (and
   * resolution snaps back to full) whenever the checkbox is off, a video
   * capture is running (recordings are keepsakes — capture at full quality
   * and let the frame rate be whatever it is), or a flame render is showing
   * (a frozen still exerts no per-frame GPU pressure worth reacting to, and
   * SHOULD display at full resolution).
   */
  function governResolution(now: number, rendered: boolean): void {
    if (
      !state.adaptiveResolution ||
      recorderActive ||
      state.renderMode === "flame"
    ) {
      if (resolutionGovernor.scale !== 1) {
        resolutionGovernor.reset();
        scene.setResolutionScale(1);
      }
      lastGovernedFrameMs = null;
      return;
    }
    if (!rendered) {
      lastGovernedFrameMs = null;
      return;
    }
    if (lastGovernedFrameMs !== null) {
      const next = resolutionGovernor.sample(now - lastGovernedFrameMs);
      if (next !== null) {
        scene.setResolutionScale(next);
        // A quiet trace for bug reports: a user describing "it went blurry"
        // (or a dev wondering why it didn't) can read the ladder from the
        // console without any UI surface existing for it.
        console.info(`Adaptive resolution: render scale ×${next}`);
      }
    }
    lastGovernedFrameMs = now;
  }

  function animate(): void {
    requestAnimationFrame(animate);
    cameraTween.advance();
    const now = performance.now();
    // Ease the projection toward the panel-aware inset (fr-936q). Skipped
    // while a flame render is showing — its view is frozen by contract, and
    // the projection must not drift under the baked image; the ease resumes
    // (and catches up) on the way back to points/solid. dt-aware like the
    // motion tick below, so a background-tab catch-up frame can't snap it.
    const insetTarget = panelInsetTarget();
    if (sceneRightInset !== insetTarget && state.renderMode !== "flame") {
      const dtInset = Math.min((now - lastInsetTickMs) / 1000, 0.1);
      sceneRightInset =
        prefersReducedMotion() || Math.abs(insetTarget - sceneRightInset) < 0.5
          ? insetTarget
          : sceneRightInset +
            (insetTarget - sceneRightInset) * (1 - Math.exp(-10 * dtInset));
      scene.setRightInset(sceneRightInset);
    }
    lastInsetTickMs = now;
    // The replace-load morph (fr-a04l): while one is in flight, send this
    // frame's interpolated system as a generation request — the same
    // once-per-frame poll pattern as cameraTween/buildReplay. Deliberately
    // NOT routed through regenScheduler (this loop is already once per
    // frame); cloudGenerator's at-most-one-in-flight latest-wins slot
    // absorbs frames that outrun the worker. The terminal sample sends the
    // real replaced/fit request and deactivates the tween (see
    // requestMorphSample). Polled ABOVE the render modes' early returns —
    // harmlessly: switchRenderMode snaps the tween on the way INTO a
    // flame/solid render, so it is always idle there.
    const morphSample = morphTween.sample(now);
    if (morphSample) requestMorphSample(morphSample);
    // The ambient drift show: when a departure comes due, launch the next
    // leg — a Surprise-Me roll or the next saved scene (driftPolicy.advance).
    // Polled AFTER the morph sample above on purpose: on a backgrounded
    // tab's catch-up frame both come due at once, and the in-flight leg
    // must land first (its terminal replaced/fit request just went out) —
    // firing the new leg first would chain off the stale tween and swallow
    // that landing. Between legs this is a single comparison (drift.ts), so
    // a dwelling show costs no per-frame work. Polled above the render
    // modes' early returns (fr-w2ve): a collection show runs THROUGH a
    // flame/solid still — held while it converges, due again a beat after
    // it completes — while a random show is stopped by switchRenderMode
    // before those modes can even show (fr-wavo).
    if (driftShow.frame()) driftPolicy.advance();
    if (state.renderMode === "solid") {
      // Unlike the flame's frozen view, the volume is world-space: keep
      // applying the live orbit camera so the user can keep looking around
      // while accumulation converges.
      scene.applyCamera(orbit);
      const renderedSolid = scene.needsRender || recorderActive;
      if (solidSession.hasFirstFrame) {
        if (renderedSolid) scene.renderSolid();
      } else {
        // Keep showing the live explorer (fog + point cloud) until the
        // worker's first grid lands, avoiding a flash of an empty volume
        // during the worker startup gap.
        scene.updateFog();
        if (renderedSolid) scene.render();
      }
      governResolution(now, renderedSolid);
      return;
    }
    if (state.renderMode === "flame") {
      // Keep drawing the frozen explorer view (already-applied camera, no
      // further orbit input while the flame render is active) until the
      // worker's first image lands, then switch over — avoids a flash of the
      // flame canvas's stale contents during the worker startup gap.
      if (flameSession.hasFirstFrame) {
        if (scene.needsRender || recorderActive) scene.renderFlame();
      } else {
        if (scene.needsRender || recorderActive) scene.render();
      }
      // Flame mode takes governResolution's restore path (frozen stills
      // display at full resolution); rendered is moot there.
      governResolution(now, false);
      return;
    }
    // A collection show left HOLDING in the points view means the render it
    // was waiting on went away without completing — the user pressed Back,
    // or the render errored out (both land here via the sessions' exits,
    // whichever path they took). Resume it as the points show it now is,
    // with a fresh dwell on whatever is on screen (fr-w2ve). One comparison
    // per frame, and unreachable while the show is genuinely waiting — a
    // hold is only ever taken together with a flame/solid mode, whose early
    // returns sit above.
    if (driftShow.holding) driftShow.resumeAfter(DRIFT_DWELL_MS);
    // One clamped dt for both kinds of automatic motion (4D tumble / 3D
    // auto-orbit — mutually exclusive by viewIs4D). Clamp it: a backgrounded
    // tab suspends RAF (and a render's early returns skip this path
    // entirely), and an unclamped catch-up delta would violently snap the
    // orientation on refocus/exit.
    const dt = Math.min((now - lastMotionTickMs) / 1000, 0.1);
    lastMotionTickMs = now;
    if (!viewIs4D && autoOrbitOn && !gestures.gestureActive()) {
      // Turntable (fr-1yn): a slow rightward-drag-signed theta advance,
      // before applyCamera so it lands on this frame. Pure camera motion —
      // no RNG, no regenerate, no save (camera is never persisted).
      // Paused while the user's hand is on the canvas (same theta a drag
      // writes); composes freely with the auto-fit tween (radius/target).
      orbit.spherical.theta -= dt * AUTO_ORBIT_RATE * autoOrbitSpeed;
    }
    scene.applyCamera(orbit);
    scene.updateFog();
    if (viewIs4D) {
      // Advance the tumble (fourDView.tick is a no-op while paused) and push
      // the rotor every 4D frame, paused or not — 16 floats/frame is nothing
      // and it keeps one code path. lastMotionTickMs (above) still advances
      // while paused, so resuming doesn't replay the gap as a jump. The point
      // color re-derives in-shader from the new rotation, so nothing else
      // needs updating per frame.
      fourDView.tick(dt);
      scene.setRot4(fourDView.matrix());
    } else if (state.renderStyle === "glow" && lastResult) {
      // Density-adaptive glow brightness: dim dense clouds, brighten sparse
      // ones. state.glowBrightness (fr-8b1) then layers the user's manual
      // override on top — auto-exposure only sees the *average* screen
      // density, so local density swings still need a hand-tuned correction.
      // Skipped in 4D: it would touch glowMaterial, which isn't rendering there.
      // The density estimate reads the outlier-trimmed frameBounds (fr-2b82),
      // not the raw min/max bounds: it wants the box where the mass actually
      // is, and on an outlier-heavy system the raw box's flung stragglers
      // inflate the projected area, under-estimating density and blowing the
      // glow out toward white.
      const b = lastResult.frameBounds;
      const dx = b.maxX - b.minX;
      const dy = b.maxY - b.minY;
      const dz = b.maxZ - b.minZ;
      const boundsRadius = Math.sqrt(dx * dx + dy * dy + dz * dz) * 0.5;
      scene.setGlowExposure(
        glowExposure(
          lastResult.count,
          boundsRadius,
          orbit.spherical.radius,
          (scene.camera.fov * Math.PI) / 180,
          scene.renderer.domElement.clientHeight,
        ) * state.glowBrightness,
      );
    }
    // The "Watch it build" replay (fr-1zb): while one is active, draw only
    // the buffer's first `revealed` points (generation order — see
    // scene.setDrawCount), ride the cursor on the newest landing (re-posed
    // every frame, so in 4D it follows the tumble), tick the visible point
    // count, and narrate the current phase. Once the replay's done-linger
    // expires it goes idle by itself; the still-set caption marks the
    // display as needing that one final cleanup.
    const replayFrame = buildReplay.frame();
    if (replayFrame !== null) {
      scene.setDrawCount(
        replayFrame.phase === "done" ? null : replayFrame.revealed,
      );
      scene.setReplayCursor(replayFrame.cursor);
      ui.setPointCount(replayFrame.revealed);
      // The spotlight tour (fr-01kf): re-bake the dimmed colors only when
      // the spotlighted map changes (once per step, and once more for the
      // null that restores the finale's full colors — never per frame).
      if (replayFrame.spotlight !== replaySpotlight) {
        applyReplaySpotlight(replayFrame.spotlight);
      }
      // Guide-box emphasis rides the story (fr-01kf): the hop phase flashes
      // the box of the map the cursor point just landed in, the spotlight
      // phase pins it on the spotlighted map; every other phase clears it.
      // setGuideHighlight compares first, so the per-frame repeats are free.
      scene.setGuideHighlight(
        replayFrame.phase === "hop"
          ? replayLandingMap(replayFrame.cursor)
          : replayFrame.spotlight,
      );
      if (replayFrame.caption !== replayCaption) {
        ui.setReplayCaption(replayFrame.caption);
        replayCaption = replayFrame.caption;
      }
    } else if (replayCaption !== null) {
      endReplayDisplay();
    }
    // Render on demand (fr-py7z): every visual change above marked the scene
    // dirty through its setter (per-frame setters compare first), so a frame
    // where nothing moved skips the GPU entirely — the compositor keeps
    // showing the last painted frame. Recording forces painting: the canvas
    // capture stream emits frames only on paint.
    const rendered = scene.needsRender || recorderActive;
    if (rendered) scene.render();
    governResolution(now, rendered);
  }
  animate();
}

registerServiceWorker(showUpdateBanner);
main();
