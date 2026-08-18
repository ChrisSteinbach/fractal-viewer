import { systemPartsAreNonFlat, toTransform4 } from "../fractal/affine4";
import { wSupport } from "./rotor4";
import { FourDTween, FourDView, viewTransition } from "./four-d-view";
import type { FourDPose } from "./four-d-view";
import {
  buildColors,
  buildColors4,
  colorModeUsesRampPalette,
  dimColorsExcept,
  fourDColorNeedsAttribute,
  transformColors,
  W_SIDE_PALETTES,
} from "../fractal/color";
import { analyzeEscapeSystem, buildEscapeDE } from "../fractal/escape-de";
import { buildEscapeDE4 } from "../fractal/escape-de-4d";
import { buildBulbDE } from "../fractal/bulb-de";
import {
  analyzeSurfaceSystem,
  buildSurfaceDE,
  deHasFolds,
  type SurfaceDE,
} from "../fractal/surface-de";
import {
  isForwardTarget,
  setSurfaceComputeSchedulePins,
  setSurfaceComputeTrace,
  SurfaceComputeRenderer,
  SurfaceComputeUnavailableError,
  type SurfaceComputeFrameSpec,
  type SurfaceComputeTarget,
} from "./surface-compute";
import {
  isSoftwareRendererLabel,
  softwareWarningText,
  surfaceWebglDetail,
  type SurfaceComputeBlock,
} from "./render-backend";
import {
  analyzeSurfaceSystem4,
  buildSurfaceDE4,
  deHasFolds4,
  slabExact4,
} from "../fractal/surface-de-4d";
import { surfaceSlotColors, surfaceTrapIndices } from "./surface-slots";
import { deriveSurfaceEligibility } from "./surface-eligibility";
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
import { PendingLoadHints } from "./load-hints";
import { SurfaceGridClient } from "./surface-grid-client";
import type { SurfaceGrid } from "../fractal/surface-grid";
import type {
  SurfaceGridRequest,
  SurfaceGridResult,
} from "./surface-grid-worker-core";
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
  PRESET_FINALS,
  PRESET_PALETTES,
  PRESET_RENDER_HINTS,
  PRESET_SCAFFOLDS,
  PRESET_SYMMETRIES,
  presetTransforms,
} from "../fractal/presets";
import { CUSTOM_PALETTE_ID, resolvePalette } from "../fractal/palette";
import { mutateSystem } from "../fractal/mutate-system";
import { renderSystemThumb } from "./mutation-thumbs";
import { randomSystem } from "../fractal/random-system";
import { BOOT_CAMERA_POSITION, OrbitCamera, type CameraPose } from "./orbit";
import {
  type ExportImage,
  FOUR_D_SLICE_WIDTH,
  FractalScene,
  SurfaceCaptureCostError,
} from "./scene";
import { attachInteractions } from "./interactions";
import { registerServiceWorker } from "./register-sw";
import {
  consumeIsolationHandoff,
  saveIsolationHandoff,
} from "./isolation-handoff";
import { Ui } from "./ui";
import {
  EXPORT_MODAL_SLOW_PREDICTION_MS,
  createExportProgress,
  formatRenderPercent,
} from "./export-progress";
import type { ExportRun } from "./export-progress";
import { createExportWait } from "./export-wait";
import { EditSession, SAVE_DEBOUNCE_MS } from "./edit-session";
import type { ViewPose } from "./history";
import { RenderSession } from "./render-session";
import {
  createCanvasRecorder,
  formatElapsed,
  MAX_RECORDING_SECONDS,
  recordingFileName,
} from "./recorder";
import { OFFLINE_EXPORT_FPS, runOfflineExport } from "./offline-export";
import {
  createOfflineEncoder,
  offlineExportSupported,
  type OfflineEncoderSession,
} from "./video-encode";
import { createResolutionGovernor } from "./resolution-governor";
import { createRenderTierScheduler } from "./render-tier";
import {
  addTransform,
  DEFAULT_BALLOON_RADIUS,
  DEFAULT_SYMMETRY_PLANE,
  DEFAULT_SYMMETRY_ORDER,
  DEFAULT_SYMMETRY_TWIST,
  initialState,
  MIN_BALLOON_RADIUS,
  removeTransform,
  resolveSceneBackground,
  selectTransform,
  setBalloonEcho,
  setBalloonRadius,
  setCustomPaletteStops,
  setFinalTransform,
  setFlamePaletteId,
  setPanelOpen,
  setBackgroundCustom,
  setFogTint,
  setPositionAxisColors,
  setRenderMode,
  setSymmetryPlane,
  setSymmetryOrder,
  setSymmetryTwist,
  setTransforms,
  updateTransform,
} from "./state";
import type { AppState, RenderMode } from "./state";
import { applyScalarControl, surfaceColorLUT } from "./control-spec";
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
import { loadViewerPrefs, updateViewerPrefs } from "./viewer-prefs";
import { SceneCollection, type SavedSceneMode } from "./collection";
import {
  decodeImportFile,
  encodeCollectionFile,
  encodeSceneFile,
  encodeTimelineFile,
  MAX_IMPORT_FILE_BYTES,
} from "./scene-file";
import { decodeFlameFile, encodeFlameFile } from "./flame-file";
import { BALLOON_SWEEP_MS, hexToRgb01, MOBILE_BREAKPOINT } from "./constants";
import { MorphBudget } from "./morph-budget";
import type { Bounds, Vec3, Vec4 } from "../fractal/types";
import { CameraTween, fourDFramingBounds } from "./camera-tween";
import { BuildReplay, SPOTLIGHT_DIM } from "./build-replay";
import { MorphTween, MORPH_TWEEN_MS, type MorphSample } from "./morph-tween";
import {
  BackgroundTween,
  backgroundGradientsEqual,
  resolveBackground,
} from "./background";
import type { BackgroundGradient } from "./background";
import {
  DriftShow,
  DRIFT_DWELL_MS,
  DRIFT_MORPH_MS,
  DRIFT_RENDER_LINGER_MS,
} from "./drift";
import { DriftPolicy } from "./drift-policy";
import {
  legSeed,
  TIMELINE_CAP,
  timelineDurationMs,
  TimelineStore,
} from "./timeline";
import { TimelinePlayer } from "./timeline-player";
import {
  dropStaleThumbnailPatches,
  recordThumbnailPatch,
  resolveThumbnailPatches,
} from "./thumbnail-patch";
import type {
  PendingThumbnailPatch,
  ThumbnailPatchStore,
} from "./thumbnail-patch";
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
  console.error("Fractal Explorer:", message);
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

/**
 * Hand a Blob to the browser as a named download: a temporary object URL
 * clicked through a detached `<a download>`. Shared by the PNG export and
 * the fr-de9t scene/collection file exports. Revocation is delayed because
 * the download latches onto the blob URL asynchronously, and revoking
 * synchronously aborts it in some engines — 10s is comfortably past that
 * latch on any of them.
 */
function triggerDownload(blob: Blob, filename: string): void {
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
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
 * fr-opgk: the shape `?surfacestate` publishes as `window.__surfaceState()`
 * — a read-only snapshot of the surface render's settle machinery, so a
 * verification script can wait for the TRUE settled state instead of
 * inferring it from the canvas.
 *
 * "Pixels stopped changing" is NOT that state: strip pacing (the
 * strip-planner evidence chain) and the compute path's pass sizing are both
 * MEASURED, so a poll cadence can freeze a timing-dependent MIX of preview
 * and settle pixels — the reason a naive run-to-run A/B of this renderer
 * measured 2.9% differing pixels and carried no signal. Nor is the
 * `#surfaceProgress` row: it hides both BEFORE a job arms and after one
 * finishes. `settled` below is the latch main.ts already keeps for the
 * recorder's parked repaints — the settle target holds a COMPLETED
 * full-quality frame for the CURRENT, uninvalidated view — so a script that
 * polls it cannot miss the edge, whichever engine owns the session.
 *
 * Diagnostics only, absent unless the URL asks (the `?flameperf` /
 * `?surfperf` convention), and it only READS live state: nothing here can
 * change what gets drawn.
 */
interface SurfaceStateProbe {
  /** The live render mode; "surface" exactly while a session runs. */
  mode: RenderMode;
  /** Which engine owns the session — null outside surface mode. */
  engine: "compute" | "webgl" | null;
  /** The session has traced its first frame (past the compile/pipeline
   * gate). Until then the canvas still shows the explorer. */
  firstFrame: boolean;
  /** A COMPLETED full-quality frame is on screen for the current view.
   * Any invalidation clears it. */
  settled: boolean;
  /** A settle verdict the tier clock fired while a preview was still in
   * flight, waiting for that preview to finish. */
  settlePending: boolean;
  /** A preview frame (compute) or preview strip job (WebGL) is in flight. */
  previewActive: boolean;
  /** The full-quality frame (compute) or settle strip job (WebGL) is in
   * flight. */
  settleActive: boolean;
}

declare global {
  interface Window {
    __surfaceState?: () => SurfaceStateProbe;
    /** fr-d6g5: `?surfacetrace`'s ring buffer of frame-loop trace lines —
     * see setSurfaceComputeTrace. Diagnostics only, absent unless the URL
     * asks. */
    __surfaceTraceLog?: string[];
  }
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

/**
 * Seed for the BOOT generation (fr-chj9). Every later request rolls a fresh
 * random seed (rollSeed) — sampling variety where the user is editing — but
 * the boot generation is what a pose-less document auto-frames FROM
 * (fitCameraToAttractor over the boot cloud's frameBounds), and a random
 * boot seed made that framing drift ~0.3% per load: the same shared link
 * opened twice showed measurably different cameras, and run-to-run visual
 * diffs of pose-less scenes carried no signal (fr-opgk's harness measured
 * 1-9% of pixels lighting up on identical documents). One pinned seed makes
 * boot a pure function of the document — same link, same cloud, same
 * framing — at no cost anywhere else: a seed only picks WHICH points sample
 * the attractor, and every edit/preset/surprise-me still rolls fresh.
 */
const BOOT_SEED = 0x5eedb007;

function main(): void {
  // Field-diagnosability breadcrumb (fr-khxy): the ONE line that says which
  // build this page actually runs. The service worker keeps serving a
  // deploy's precache for as long as any tab stays open (fr-o13's
  // wait-for-consent update), so two browsers can honestly run builds days
  // apart — every "works in browser A, not in browser B" report starts by
  // comparing these two stamps.
  console.info(`Fractal Explorer build ${__BUILD_ID__}`);
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
  // The still-export disclosure driver (fr-7mfx). A Save-PNG on a surface
  // render can be minutes of GPU work; it used to be indistinguishable
  // from a mis-click until the download toast landed. One grace-deferred
  // modal now covers every engine — the grace period is what keeps the
  // instant cases (explorer, flame) from flashing one.
  const exportProgress = createExportProgress({
    now: () => performance.now(),
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (id) => {
      window.clearTimeout(id);
    },
    view: ui,
  });

  // fr-tmgf: the device-level software-rasterizer disclosure. Read ONCE at
  // boot — the renderer string is stable for the context's life — and shown
  // immediately: the incident behind the bead was a browser that silently
  // blocklisted the GPU, so every mode ran on SwiftShader for a day with
  // nothing on screen saying so. The surface compute session's own verdict
  // recomposes the same note via updateSoftwareRendererNote (declared with
  // the compute state below, which it reads — not callable this early).
  const webglRendererLabel = scene.unmaskedRendererLabel();
  const webglSoftware =
    webglRendererLabel !== null && isSoftwareRendererLabel(webglRendererLabel);
  if (webglSoftware) {
    console.warn(
      `WebGL renderer is a software rasterizer: ${webglRendererLabel}`,
    );
    ui.setSoftwareRendererNote(
      softwareWarningText("webgl", webglRendererLabel),
    );
  }

  // Whether a video capture is running (fr-py7z): canvas capture streams only
  // emit frames when the canvas actually paints, so the render-on-demand gate
  // in animate() must keep rendering every frame while this is true — a
  // static scene must still record as a video of that scene, not a stall.
  let recorderActive = false;

  // Whether the current timeline playback is an EXPORT run (fr-8v41):
  // onTimelineExport started the recorder alongside the playback, and
  // whatever ends the playback — its natural finish, a stop-on-edit, the
  // toggle — hands the recorder its stop so the clip finalizes and
  // downloads. Cleared by the recorder's own lifecycle too (onStateChange
  // false / onError below): a recording that ended on its own — the 120s
  // cap, a hidden tab, a manual stop on the Record button, a failed start —
  // degrades the run to a plain playback instead of later "stopping" a
  // recorder that isn't running and toasting a clip that never saved.
  let timelineExporting = false;

  // ── Offline frame-exact export (fr-92t9) ────────────────────────────
  // While an offline export runs, the whole playback pipeline ticks on a
  // VIRTUAL clock stepped by the export driver (offline-export.ts) instead
  // of performance.now(): every clock consumer on the playback path — the
  // timeline player, the camera/4D pose glides, the morph tween, the
  // animate loop's dt bookkeeping — reads nowMs() so a hitch, a slow
  // device, or a backgrounded tab can never change WHICH sample lands on
  // which exported frame. Outside an export, nowMs() IS performance.now().
  let virtualNowMs: number | null = null;
  const nowMs = (): number => virtualNowMs ?? performance.now();
  // Non-null while the offline export's driver owns the ticking (animate()
  // stands aside). `completed` distinguishes a natural finish from a stop
  // when the driver finalizes the clip — finishTimelinePlayback marks it,
  // the driver reads it for the toast copy.
  let offlineExport: { completed: boolean } | null = null;
  // Guards onTimelineExport re-entry across startOfflineExport's async
  // encoder probe (before the player is active) and doubles as the "the
  // Export button is currently a cancel affordance" flag.
  let offlineExportPending = false;
  // Wakes the offline export driver's render-keyframe park (fr-6jic):
  // non-null only while the driver awaits nextParkSignal with the virtual
  // clock parked on a converging flame/solid still. Resolved on every
  // signal that could end the park — render progress (noteRenderProgress,
  // whose budget-met resume is what actually unparks), a render session
  // exiting early (the deactivate deps), the playback stopping (the
  // policy's onStopped) — and the driver re-checks its park condition and
  // re-arms after each, so spurious wakes are harmless.
  let offlineParkWaiter: (() => void) | null = null;
  // The same signal's second consumer (fr-61a2): a Save-PNG parked until the
  // renderer it was pressed in IS the picture it will export. A list drained
  // on every fire rather than the park's single slot, because these are
  // ordinary awaits inside savePng rather than one driver's loop — and, like
  // the park, each re-checks its own condition and re-arms, so a spurious
  // wake costs one predicate evaluation.
  let renderSignalWaiters: (() => void)[] = [];
  /** Announce that some render's answer may have moved: progress landed, a
   * session exited, a playback stopped, an export was cancelled. */
  function notifyRenderSignal(): void {
    offlineParkWaiter?.();
    const waiters = renderSignalWaiters;
    renderSignalWaiters = [];
    for (const wake of waiters) wake();
  }
  /** Resolve on the next {@link notifyRenderSignal}. */
  function nextRenderSignal(): Promise<void> {
    return new Promise<void>((resolve) => {
      renderSignalWaiters.push(resolve);
    });
  }

  // Adaptive resolution (fr-4lyt): a pure frame-time governor decides when
  // sustained slow frames should trade pixels for frame rate (and when the
  // device has earned them back); animate() feeds it the dt between
  // consecutively rendered frames via governResolution below.
  const resolutionGovernor = createResolutionGovernor();
  // Timestamp of the last frame the governor sampled; null whenever the
  // chain of consecutively rendered frames breaks (a skipped frame, a mode
  // where sampling is off), so a gap never reads as one huge dt.
  let lastGovernedFrameMs: number | null = null;
  // Timestamp of the last RENDERED frame, independent of the sample chain
  // above (fr-vxbo): render-on-demand means a parked still produces no more
  // frames to sample at all, so this is what governResolution measures quiet
  // time against for the idle-restore path below. Unlike lastGovernedFrameMs
  // it survives across the idle frames in between — reset only when a
  // restore actually fires or governing stops.
  let lastRenderedFrameAtMs: number | null = null;
  // Surface-mode interaction tier (fr-5ne3): cheap preview traces while the
  // view is moving, one full-quality settle frame once it parks. Owns the
  // surface render's cost outright — the resolution governor takes its
  // flame-style restore path there (see governResolution).
  const surfaceRenderTier = createRenderTierScheduler();
  // Whether the settle target holds a COMPLETED full-quality frame for the
  // CURRENT (uninvalidated) view — the recorder's parked repaints re-present
  // it instead of re-tracing seconds of identical pixels (fr-sjff). Any
  // invalidation clears it.
  let surfaceSettled = false;
  // A settle verdict the tier scheduler fired while a preview strip job was
  // still mid-flight (fr-du81): held here until the preview completes, then
  // begun. A fresh invalidation supersedes it.
  let surfaceSettlePending = false;
  // The WebGL compile gate owes the session its first traced frame
  // (fr-yvcw): the gate's one-shot scene.invalidate() can be consumed by
  // another draw before the tier clock reads it — 2ca508b's race, on the
  // fallback arm — and on a re-enter after a failed compute create() the
  // entry glide has already spent itself, so no camera motion follows to
  // mask the loss. OR'd into the tier read until the preview actually
  // traces; the tier answers "preview" to any invalidated frame, so one
  // surviving read is a guaranteed first frame.
  let surfaceWebglPreviewPending = false;
  const recorder = createCanvasRecorder(scene.canvas, {
    onStateChange: (recording) => {
      recorderActive = recording;
      ui.setRecordingState(recording ? formatElapsed(0) : null);
      // A finalized clip ends an export run's recording half however it
      // stopped (fr-8v41) — see timelineExporting's doc.
      if (!recording) timelineExporting = false;
    },
    onTick: (seconds) => {
      ui.setRecordingState(formatElapsed(seconds));
    },
    onError: (message) => {
      console.error(`Video recording: ${message}`);
      // An export run whose recording failed (or never started) keeps
      // playing as a plain run — the flag clears so its finish doesn't
      // claim a clip was saved (fr-8v41).
      timelineExporting = false;
    },
  });

  // The saved-scene collection (fr-cai): a persistent multi-slot library the
  // user explicitly saves into, layered over the SAME encodeScene codec the
  // single-scene autosave and undo history use — so a saved entry is just an
  // immutable encoded string plus a thumbnail, and loading one is a
  // whole-system replacement like a preset (see loadEncodedScene). Distinct
  // localStorage key, so it never disturbs the live scene or its history.
  // onEvicted is the quota disclosure (fr-vhpt): a save that only fit by
  // evicting the oldest entries must not hide behind the unconditional
  // "Saved to collection" toast — data loss reported as success.
  const collection = new SceneCollection({
    onEvicted: (count) =>
      ui.flashToast(
        count === 1
          ? "Gallery full — dropped the oldest saved scene to make room"
          : `Gallery full — dropped the ${count} oldest saved scenes to make room`,
      ),
  });

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

  // The pending load hints (load-hints.ts, where the policy and its history
  // live): a preset/gallery/timeline load's render-mode hint (fr-39y,
  // fr-75sq), a timeline render keyframe's deterministic accumulator seed
  // (fr-4ff7), and a loaded document's 4D pose (fr-pnek) — each armed right
  // after the load's applyDecodedSnapshot/applyEdit (which clears all three
  // on every load's behalf) and consumed when the load's OWN cloud lands
  // (applyCloudResult), keyed to the request id the load awaits so an
  // in-flight arrival from a superseded load can neither fire them early nor
  // discard them (fr-vja8.34). The id read is deferred — cloudGenerator is
  // constructed below, and no arm can run before boot reaches it.
  const loadHints = new PendingLoadHints(() => cloudGenerator.peekNextId());

  // The one seed roll both render-session starts share: a worker needs an
  // explicit numeric seed — a live Rng (like Math.random) can't cross
  // postMessage — which as a side effect makes a render a reproducible pure
  // function of its inputs. A pending timeline seed (armed by its leg,
  // load-hints.ts) pins the roll; consuming it HERE, at start time, covers
  // the realtime and offline export paths alike without either knowing
  // about the pinning.
  function nextRenderSeed(): number {
    return loadHints.takeSeed() ?? Math.floor(Math.random() * 0xffffffff);
  }

  // The session-only 4D VIEW state (fr-woc/fr-6x2/fr-nn6): the accumulated
  // rotor (tumble ticks and Shift-drag/Shift-wheel deltas all compose into it),
  // the tumble pause/speed, and the soft w-slice. Reset to a fresh-visit
  // baseline by resetFourDView() whenever the view starts showing a genuinely
  // new 4D system; the live instance is never persisted, though a pose()
  // snapshot of it rides the saved document (fr-pnek — see currentDocument).
  // The state machine + its math live in four-d-view.ts; this file just
  // pushes matrix()/slice fields to the scene.
  const fourDView = new FourDView();

  // The directed rotor/slice glide a timeline playback leg drives (fr-pnek):
  // the 4D sibling of cameraTween.glideToPose, easing the view from wherever
  // the tumble left it onto the arriving keyframe's saved FourDPose over the
  // leg's own morph duration. While it is active, animate() suspends the
  // auto-tumble tick — the glide owns the rotor — and applyCloudResult's
  // fresh-visit reset stands aside (see the transition block there); the
  // tumble resumes for the hold once the glide lands, which keeps playback
  // alive between keyframes exactly the way the 3D auto-orbit keeps spinning
  // after a camera pose glide. Arrival ORIENTATIONS stay pinned to the saved
  // poses either way — that is the deterministic half fr-pnek needs.
  const fourDTween = new FourDTween(
    fourDView,
    // nowMs, not performance.now(): a timeline leg's rotor glide must step
    // on the offline export's virtual clock (fr-92t9).
    nowMs,
    prefersReducedMotion,
  );

  // A loaded document's 4D pose (fr-pnek) rides loadHints above — the
  // render-mode-hint pattern applied to the VIEW: loadEncodedScene /
  // restoreSnapshot / launchTimelineLeg arm it right after
  // applyDecodedSnapshot, and applyCloudResult applies it wherever the
  // fresh-visit 4D reset would otherwise fire (the first non-flat arrival of
  // a morphing load, and the terminal replaced arrival, which would
  // otherwise stomp a just-restored pose back to the identity baseline),
  // releasing it once the awaited replaced request lands.

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

  // The balloon echo's "Inflate" replay (fr-5wlv.2): non-null while the
  // radius sweep is animating, holding the ms timestamp it started at
  // (nowMs() — see onBalloonInflate and the push in tickRender). Cleared on
  // completion (t >= 1) or by a genuine user edit to the checkbox/slider
  // (control-spec.ts's cancelBalloonSweep effect) — never by the sweep's
  // own per-frame reducer calls, which bypass that effect entirely.
  let balloonSweepStartMs: number | null = null;

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

  // The surface preview tier under user control (fr-37c6): `false` means
  // invalidations never trace the cheap preview — the pane freezes on its
  // last frame while the view moves, and the full-detail render starts the
  // moment it parks. The fr-24to/fr-zx34 principle (the mode never guesses
  // willingness to wait) applied to the preview itself, which the governor's
  // rung ladder still guessed at. A patience preference, so per-BROWSER
  // (viewer-prefs.ts) like autoMotion above, never the share URL; absent =
  // never chosen = previews on. Both engines honor it — the compute and
  // strip paths share the same two-tier choreography.
  let surfacePreviewsEnabled = viewerPrefs.surfacePreview !== false;
  // Programmatic `checked` writes fire no change event, so this seed cannot
  // re-enter the handler (which would re-save the pref at boot).
  ui.setSurfacePreviewToggle(surfacePreviewsEnabled);

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
        if (showcase.fourD) {
          fourDView.tumbleOn = showcase.motionWasOn;
          // Put the help box's motion wording back with it (fr-k9nx) — the
          // showcase forced it on without the user's checkbox knowing.
          ui.setFourDTumbleActive(showcase.motionWasOn);
        } else autoOrbitOn = showcase.motionWasOn;
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
  // The backdrop's own replace-load crossfade (fr-5ps1) — the fourth motion
  // beside the system morph, camera glide and 4D rotor glide, armed by
  // applyDecodedSnapshot's morph path and polled in tickLogic. Display-only,
  // like the morph above: the document becomes the target immediately; only
  // the scene's live backdrop interpolates.
  const backgroundTween = new BackgroundTween();
  // The backdrop currently ON SCREEN — the crossfade's `from` endpoint, so
  // every push must go through pushBackground (the one owner) or the next
  // leg's fade would start from a stale pair. Starts at the scene's own
  // construction default (dark); boot syncs it to the restored document.
  let liveBackground: BackgroundGradient = resolveBackground({ mode: "dark" });
  function pushBackground(stops: BackgroundGradient): void {
    liveBackground = stops;
    scene.setBackground(stops);
  }
  /** Snap the scene to the CURRENT document's backdrop, discarding any
   * in-flight crossfade — control edits and non-morph loads land instantly.
   * Resolves through resolveSceneBackground so `"auto"` derives from the
   * active render's palette (fr-mz2u). */
  function applyBackgroundNow(): void {
    backgroundTween.cancel();
    pushBackground(resolveSceneBackground(state));
  }
  /**
   * The `"auto"` backdrop's live tracking (fr-mz2u): re-derive and push when
   * the palette it follows may have moved — palette select edits, gradient
   * editor drags, render-mode switches. A no-op for the static modes, and
   * value-guarded so an edit to an INACTIVE render's palette (or one that
   * resolves to the same stops) touches nothing. While a replace-load
   * crossfade is in flight the tween owns the display — its final sample
   * re-enters here (tickLogic), so a render-mode switch landing mid-fade
   * still settles on the right derivation.
   */
  function trackAutoBackground(): void {
    if (state.background.mode !== "auto") return;
    if (backgroundTween.active()) return;
    const target = resolveSceneBackground(state);
    if (!backgroundGradientsEqual(liveBackground, target)) {
      pushBackground(target);
    }
  }
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
  // the wiring: what a leg does (launchDriftLeg), the hold/resume
  // choreography around renders, and the reduced-motion gate
  // (syncMotionAvailability).
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
  // dried-up collection). Every "the user reached in" moment stops the
  // show — applyEdit and the bespoke beginEdit handlers (any undoable
  // edit), time travel and MANUAL gallery loads (applyDecodedSnapshot),
  // starting a build replay, and the toggle itself; since fr-8v41 the
  // shared chokepoints call stopShows, which routes the stop to this
  // policy AND the timeline playback's (at most one show is ever active).
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
    onStopped: (notify) => {
      ui.setDriftActive(false);
      if (notify) ui.flashToast("Drift stopped");
    },
  });

  // One drift leg (fr-wavo), passed to driftPolicy.advance at the poll site:
  // press Surprise Me — or, for a collection show (fr-w2ve), load the next
  // saved scene — on the show's behalf: the same "replace" undo checkpoint a
  // manual press/load cuts (undo walks back through the show; history.ts's
  // cap bounds it), the same camera auto-fit, but gliding the display morph
  // over DRIFT_MORPH_MS instead of the snappier click-feedback default. A
  // surprise roll always launches; a collection leg reports whether anything
  // was left to play — false ends the show once the leg unwinds (fr-4otp).
  function launchDriftLeg(): boolean {
    if (driftSource === "collection") return advanceCollectionLeg();
    rollSurpriseSystem(DRIFT_MORPH_MS);
    return true;
  }

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
    // Re-arm AFTER applyDecodedSnapshot, which clears the mode hint on
    // every load (a restored document must not trigger a stale preset hint —
    // this is not that: it's the show arming the entry's own display mode).
    if (next.mode) loadHints.armMode(next.mode);
    driftLastPlayedId = next.id;
    return true;
  }

  // Whether each renderer's CURRENT session has met its iteration budget —
  // maintained by noteRenderProgress below and reset by the sessions' own
  // resetProgress deps (which run on every enter), so it can never describe
  // a previous session. Read by onDriftCollection: a show started from
  // INSIDE a converging render (the Collection section is reachable there
  // since fr-75sq) must hold for that render's completion rather than
  // dwell-and-yank it — and, since fr-61a2, by the flame Save-PNG, which
  // waits for the accumulation it is going to save.
  const renderComplete = { flame: false, solid: false, surface: false };
  // The same (done, budget) pair as a 0..1 fraction, for the export modal's
  // readout while a Save-PNG waits (fr-61a2). Written and cleared in exactly
  // the places renderComplete is, so the two can never describe different
  // sessions.
  const renderCoverage = { flame: 0, solid: 0, surface: 0 };

  // A converging flame/solid render reported progress: record whether its
  // budget is met (a budget raised on a finished render genuinely
  // un-completes it — the worker resumes accumulating), and, when the
  // collection show is HOLDING for this render (switchRenderMode held it on
  // the way in), re-arm the next departure a beat out — "wait for the
  // render to complete, then a second longer" (fr-w2ve). resumeAfter acts
  // only while holding, so ordinary renders, a stopped show, and an
  // already-resumed one are all untouched by stray progress.
  //
  // A timeline playback holding on a render keyframe (fr-v3au) departs on
  // the same signal — resume() re-arms the schedule with the step's own
  // holdMs as the post-convergence dwell (timeline-player.ts's "Held
  // legs"), and like resumeAfter it no-ops unless holding. The extra
  // renderMode gate is because a timeline hold spans the leg's whole
  // points-mode morph, not just the render (launchTimelineLeg holds at
  // launch): a terminated session's trailing completion event arriving in
  // that window — the exited render's worker posts from a task queue
  // terminate() can't unsend — must not start the departure clock while
  // the step's own render is still converging or yet to enter.
  function noteRenderProgress(
    mode: "flame" | "solid" | "surface",
    done: number,
    budget: number,
  ): void {
    renderComplete[mode] = done >= budget;
    renderCoverage[mode] = budget > 0 ? Math.min(1, done / budget) : 0;
    if (done >= budget) {
      driftShow.resumeAfter(DRIFT_RENDER_LINGER_MS);
      if (state.renderMode === mode) timelinePlayer.resume();
    }
    // An offline export parked on this render (fr-6jic) re-checks on every
    // progress event: a budget-met resume above unparks it (the schedule is
    // re-armed against the parked virtual clock), and a still-converging
    // chunk repaints the canvas so the park is visible.
    notifyRenderSignal();
  }

  // ── Animation timeline (fr-8v41) ─────────────────────────────────────
  // The drift show's DIRECTED counterpart: an authored, persistent sequence
  // of keyframe steps — each a frozen scene document + thumbnail + its own
  // morph/hold timing, and since fr-v3au optionally the flame/solid mode it
  // was captured from (timeline.ts) — played back as a chain of the same
  // replace-load morphs a drift leg uses, and optionally recorded to a
  // video clip (onTimelineExport). timeline-player.ts owns WHEN each leg
  // fires (an absolute schedule, so a recorded clip keeps its authored
  // length — with render keyframes excepted: their legs hold the schedule
  // until the render converges, so a clip's length becomes
  // content-dependent, the fr-v3au trade); launchTimelineLeg below owns
  // what a leg does; and a second DriftPolicy instance conducts it with the
  // exact same stop-on-edit / own-leg-guard semantics as the drift show.
  // The two shows are mutually exclusive: each start stops the other, and
  // stopShows() is the one helper every shared "user reached in"
  // chokepoint calls.
  const timeline = new TimelineStore();
  // nowMs, not performance.now(): an offline export drives the same player
  // on the virtual clock (fr-92t9).
  const timelinePlayer = new TimelinePlayer(nowMs);
  const timelinePolicy = new DriftPolicy({
    show: timelinePlayer,
    reducedMotion: prefersReducedMotion,
    onStopped: (notify) => {
      ui.setTimelineActive(false);
      if (notify) ui.flashToast("Timeline stopped");
      // An OFFLINE export run needs nothing here beyond a park wake
      // (fr-92t9): its driver notices the player went inactive, finalizes
      // the partial clip itself, and owns the toast. The wake matters when
      // the stop lands mid-park (fr-6jic) — a driver awaiting a render
      // signal that will never resume must still learn the run ended.
      if (offlineExport !== null) {
        notifyRenderSignal();
        return;
      }
      // A stopped export run still finalizes its clip: everything recorded
      // up to the stop downloads (an honest partial clip), rather than
      // vanishing with the show.
      if (timelineExporting) {
        timelineExporting = false;
        recorder.stop();
      }
    },
  });

  // Every chokepoint where the user reaches in — applyEdit, time travel and
  // manual gallery loads (applyDecodedSnapshot), the bespoke beginEdit
  // handlers, starting a build replay — must end WHICHEVER show is running;
  // at most one ever is, and each policy no-ops when its own show is idle
  // (or mid-own-leg), so calling both is always safe. The drift/timeline
  // toggles themselves deliberately do NOT use this: each stops its own
  // show silently and the OTHER show with a toast (see the handlers).
  function stopShows(opts?: { notify?: boolean }): void {
    driftPolicy.stop(opts);
    timelinePolicy.stop(opts);
  }

  /**
   * One timeline playback leg (fr-8v41): load step `index`'s frozen scene
   * as a replace-load morphing over the step's own `morphMs` — the same
   * "replace" undo checkpoint + morphing applyDecodedSnapshot path as a
   * collection drift leg (advanceCollectionLeg), with two directed
   * differences. The morph seed is pinned from the timeline's stored seed
   * (timeline.ts's legSeed), so every playback run of the same timeline
   * generates the same content stream — the deterministic half of the
   * export. And the camera GLIDES to the step's saved pose over the same
   * duration (CameraTween.glideToPose — the fit flag stays off so the
   * arrival can't fight it): the author's framing IS the shot, where a
   * drift leg deliberately auto-fits instead. A step saved without a pose
   * falls back to exactly the drift leg's fit-and-chase. A step saved from
   * a non-flat system additionally carries its 4D view pose (fr-pnek) —
   * the rotor orientation and w-slice the author framed — and the 4D view
   * glides onto it the same way (FourDTween, rotor slerp + slice-center
   * lerp over the leg's own duration); the pose is ALSO armed as the
   * pending pose hint so the arrival that lands the replaced request
   * re-applies it exactly, covering both a glide that finished a beat
   * before the cloud landed and one a user gesture cancelled out from
   * under the show. Steps resolve by
   * index at leg time, which is why every timeline EDIT stops a running
   * playback first (see the onTimeline* handlers). Returns false on a
   * vanished or undecodable step (untrusted localStorage), ending the show
   * at the leg boundary like a dried-up collection (fr-4otp).
   *
   * A RENDER keyframe (fr-v3au) — a step tagged with the flame/solid mode
   * it was captured from — additionally re-enters that renderer when the
   * morph's terminal cloud lands (the mode hint, exactly
   * advanceCollectionLeg's re-arm) and self-holds the player's schedule
   * right here at launch: the next departure has no clock until this
   * step's render meets its iteration budget (noteRenderProgress resumes
   * it), with the step's own holdMs serving as the post-convergence dwell
   * (timeline-player.ts's "Held legs"). Holding from launch rather than
   * from the render's entry means no schedule deadline can slip through
   * during the morph or the terminal request's in-flight gap — even a
   * holdMs: 0 render step converges before departing. The render's
   * accumulator seed is pinned too (fr-4ff7): the pending seed hint carries
   * the leg's own legSeed draw into that session start, so the converged
   * still — not just the morph into it — is identical run to run,
   * residual noise included.
   */
  function launchTimelineLeg(index: number): boolean {
    const step = timeline.all()[index];
    if (!step) return false;
    const snap = decodeScene(step.encoded);
    if (!snap) return false;
    editSession.beginEdit("replace");
    const pose = snap.camera;
    const seed = legSeed(timeline.seed, index);
    applyDecodedSnapshot(snap, pose === undefined, true, step.morphMs, seed);
    if (pose) cameraTween.glideToPose(pose, step.morphMs);
    // Armed AFTER applyDecodedSnapshot, which clears the pose hint on
    // every load's behalf (the render-mode-hint pattern, fr-pnek).
    if (snap.fourD) {
      fourDTween.glideToPose(snap.fourD, step.morphMs);
      loadHints.armPose(snap.fourD);
    }
    if (step.mode) {
      loadHints.armMode(step.mode);
      // The render's accumulator seed is pinned to the same per-leg draw
      // as the morph (fr-4ff7): distinct consumers (cloud-worker point
      // correspondence vs flame/solid accumulation), so sharing the value
      // is harmless, and one draw per leg keeps the determinism story
      // simple. Consumed by the session start the arrival's mode-hint
      // switch triggers (see nextRenderSeed).
      loadHints.armSeed(seed);
      timelinePlayer.hold();
    }
    return true;
  }

  /**
   * A timeline run reached its natural end (fr-8v41): the player has
   * already deactivated itself (its `done` event is what got us here), so
   * the policy's stop would no-op — un-light the toggle directly, and for
   * an export run hand the recorder its stop so the clip finalizes and
   * downloads. The toast tells the user WHY the motion just stopped: the
   * panel closed when playback started, so nothing else on screen says so.
   */
  function finishTimelinePlayback(): void {
    ui.setTimelineActive(false);
    if (offlineExport !== null) {
      // The offline export's natural end (fr-92t9): the driver sees the
      // player inactive after this step, finalizes the clip, and toasts —
      // just record that the run COMPLETED (vs. was stopped) for its copy.
      offlineExport.completed = true;
    } else if (timelineExporting) {
      timelineExporting = false;
      recorder.stop();
      ui.flashToast("Timeline finished — saving clip");
    } else {
      ui.flashToast("Timeline finished");
    }
  }

  /**
   * Arm a playback run over the timeline's current steps (fr-8v41) —
   * shared by ▶ Play and ⏺ Export (which additionally starts the recorder;
   * `exporting` tags the run so whatever ends it also stops the recorder).
   * Starting the directed show ends the ambient one — with the toast
   * (fr-ygr1): the user is looking at the Timeline buttons, not the Drift
   * toggle. Closes the panel like the drift toggle does: the show owns the
   * stage — which also glides the desktop projection inset back to center
   * (fr-936q), exactly what an exported clip should record. Callers guard
   * emptiness/reduced motion; leg 0 fires on the next animate frame.
   */
  function startTimelinePlayback(exporting: boolean): void {
    driftPolicy.stop({ notify: true });
    timelineExporting = exporting;
    timelinePlayer.start(timeline.all());
    ui.setTimelineActive(true);
    state = setPanelOpen(state, false);
    ui.updateLabels(state);
  }

  /**
   * The offline frame-exact export's entry (fr-92t9): probe for a WebCodecs
   * H.264 encoder sized to the canvas, then hand the run to
   * {@link driveOfflineExport}. When no encodable config exists (Firefox
   * without H.264 encode, an exotic canvas size), fall back to the realtime
   * MediaRecorder capture — the offline path is an upgrade, never a
   * gatekeeper. `offlineExportPending` spans the whole thing, including the
   * async probe, so a second Export click can't double-start (the handler
   * turns those clicks into the cancel affordance instead).
   */
  /** The ONE wording for an export-failure toast (fr-vja8.51): the setup
   * catch and the run catch both speak through it, so a rewording cannot
   * make the same failure class report differently depending on where the
   * encoder died — the session-error report keeps its own inline wording on
   * purpose, carrying the session's message. */
  function exportFailedToast(err: unknown): void {
    ui.flashToast(
      `Export failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  async function startOfflineExport(): Promise<void> {
    offlineExportPending = true;
    try {
      // Pin the render resolution BEFORE reading the canvas size — the
      // encoder's dimensions are fixed for the whole clip, and the adaptive
      // governor must not resize the buffer under it (its own sampling is
      // skipped for the run's forced renders; see tickRender).
      resolutionGovernor.reset();
      scene.setResolutionScale(1);
      const session = await createOfflineEncoder({
        width: scene.canvas.width,
        height: scene.canvas.height,
        fps: OFFLINE_EXPORT_FPS,
      });
      // The probe awaited: a raced show start (or a timeline emptied by
      // edits) wins — abandon the export rather than double-starting a
      // run, and SAY so (fr-vja8.12: the silent abort read as a dead
      // Export button). Above BOTH branches on purpose: the no-H.264
      // fallback below used to restart the raced run from leg 0 as a
      // recorded export.
      if (timelinePlayer.active || timeline.size === 0) {
        session?.abort();
        ui.flashToast(
          timelinePlayer.active
            ? "Export abandoned — playback already started"
            : "Export abandoned — the timeline is empty",
        );
        return;
      }
      if (session === null) {
        ui.flashToast("Frame-exact export unavailable — recording live");
        startTimelinePlayback(true);
        if (!recorderActive) recorder.toggle();
        return;
      }
      await driveOfflineExport(session);
    } catch (err) {
      // A rejecting encoder probe must land in a toast, not an unhandled
      // rejection — onTimelineExport fire-and-forgets this promise
      // (fr-vja8.12). driveOfflineExport's own catch covers the run;
      // this covers the setup.
      exportFailedToast(err);
    } finally {
      offlineExportPending = false;
    }
  }

  /**
   * One offline export run (fr-92t9): flip the app onto the virtual clock,
   * start the ordinary timeline playback, and let `offline-export.ts`'s
   * driver loop step it one exported frame at a time — each frame's logic
   * ticked at its exact virtual time, its generation settled, its render
   * forced, its pixels encoded — until the player finishes, a stop reaches
   * it (every existing chokepoint works unchanged: the driver just notices
   * the player went inactive and finalizes the partial clip), or the
   * recorder-parity frame cap cuts it. A render keyframe's leg (fr-6jic)
   * parks the driver instead of holding the clip open: the leg's morph
   * captures as points, the flame/solid session converges to its budget in
   * real time with the virtual clock (and the frame counter) standing
   * still, and the step's holdMs then dwells on the CONVERGED still — so
   * the clip comes out the authored length, unlike the realtime capture,
   * which honestly records however long convergence took (fr-v3au). The
   * `finally` unwinds the virtual clock: real time may be BEHIND it (a
   * hold-heavy run exports faster than realtime), so anything still timed
   * against it — pose glides, a mid-flight morph, the dt baselines — is
   * snapped/reset rather than left to freeze until the wall clock catches
   * up.
   */
  async function driveOfflineExport(
    session: OfflineEncoderSession,
  ): Promise<void> {
    const frameMs = 1000 / OFFLINE_EXPORT_FPS;
    const capFrames = MAX_RECORDING_SECONDS * OFFLINE_EXPORT_FPS;
    const totalFrames = Math.max(
      1,
      Math.min(
        Math.ceil(timelineDurationMs(timeline.all()) / frameMs),
        capFrames,
      ),
    );
    // t0 = real now, so tweens already in flight continue seamlessly onto
    // the virtual clock; from here it advances by frame arithmetic only.
    const t0 = performance.now();
    virtualNowMs = t0;
    lastMotionTickMs = t0;
    lastInsetTickMs = t0;
    startTimelinePlayback(false);
    // Snap the projection inset to its closed-panel target rather than
    // letting it ease across the clip's opening frames: deterministic
    // framing from frame 0 (the realtime path glides instead — its clip
    // honestly records whatever the screen did).
    sceneRightInset = panelInsetTarget();
    scene.setRightInset(sceneRightInset);
    offlineExport = { completed: false };
    ui.setTimelineExportProgress("0%");
    // The panel just closed over the progress readout, so say the run is
    // rolling — the finish/stop toast is the other bookend.
    ui.flashToast("Exporting frame-exact clip…");
    // The canvas size is the encoder's contract — a resize mid-run stops
    // the show (recorder.ts parity) and the partial clip still saves.
    const onResize = (): void => {
      timelinePolicy.stop();
    };
    window.addEventListener("resize", onResize);
    // MessageChannel, not setTimeout: timers are throttled in background
    // tabs, and exporting from one is exactly this path's advantage over
    // the realtime capture (which must stop when rAF stalls).
    const yieldChannel = new MessageChannel();
    try {
      const run = await runOfflineExport({
        startMs: t0,
        frameMs,
        maxFrames: capFrames,
        totalFrames,
        stepFrame: async (frameNowMs) => {
          virtualNowMs = frameNowMs;
          tickLogic(frameNowMs);
          await cloudGenerator.settle();
          // Frame-exactness for surface keyframes (fr-55r5 part 2): the
          // empty-space grid arrives on a REAL-time worker against this
          // VIRTUAL clock, so whether a frame traces with or without it
          // would otherwise depend on machine speed. Waiting out the build
          // pins every exported surface frame to the same (grid-assisted,
          // deterministically built) march.
          if (state.renderMode === "surface") await surfaceGrid.settle();
        },
        running: () => timelinePlayer.active,
        // Parked while a render keyframe converges (fr-6jic): the player is
        // holding (launchTimelineLeg held at launch) AND the leg's terminal
        // cloud has entered its flame/solid session. During the leg's
        // points-mode morph the hold is already on but the mode is still
        // "points", so morph frames capture normally; the park engages on
        // the frame whose settle landed the terminal cloud (its
        // applyCloudResult consumed the mode hint into the session) and
        // disengages when noteRenderProgress's budget-met resume drops
        // `holding` — or, for a render that exits early, when its
        // deactivate drops the mode back to "points".
        renderParked: () =>
          timelinePlayer.holding && state.renderMode !== "points",
        nextParkSignal: () =>
          new Promise<void>((resolve) => {
            offlineParkWaiter = resolve;
          }),
        renderFrame: async (frameNowMs) => {
          // The compute surface path traces its full-quality frame on the
          // GPU FIRST (memoized per view, so dwell frames skip it) — all
          // task-crossing awaits happen here, and tickRender's force paint
          // stays the final synchronous act before the encode (the
          // drawing-buffer/composite rule in OfflineExportDeps).
          if (state.renderMode === "surface" && surfaceComputeRenderer) {
            await ensureSurfaceComputeForceFrame();
          }
          tickRender(frameNowMs, true);
        },
        encodeFrame: (index) => session.encodeFrame(scene.canvas, index),
        onProgress: (done, total) => {
          ui.setTimelineExportProgress(
            `${String(Math.min(100, Math.round((done / total) * 100)))}%`,
          );
        },
        yieldToUi: () =>
          new Promise((resolve) => {
            yieldChannel.port1.onmessage = (): void => {
              resolve();
            };
            yieldChannel.port2.postMessage(undefined);
          }),
      });
      // Cut at the cap with the playback still going: end the show — the
      // pre-start toast already warned the end would be missing.
      if (run.capped) timelinePolicy.stop();
      const completed = offlineExport.completed;
      const clip = await session.finish();
      if (clip !== null) {
        triggerDownload(clip, recordingFileName("video/mp4", Date.now()));
        ui.flashToast(
          completed
            ? "Timeline finished — clip saved"
            : "Export stopped — partial clip saved",
        );
      } else {
        ui.flashToast(
          session.error !== null
            ? `Export failed: ${session.error}`
            : "Export produced no data",
        );
      }
    } catch (err) {
      // An encodeFrame rejection (encoder death mid-run) — discard the
      // clip, recorder.ts's error stance.
      session.abort();
      timelinePolicy.stop();
      exportFailedToast(err);
    } finally {
      window.removeEventListener("resize", onResize);
      offlineExport = null;
      virtualNowMs = null;
      // Hygiene: the run is over, so no park can be pending — drop the last
      // (already-resolved) waiter rather than letting an ordinary render's
      // progress keep poking it (fr-6jic).
      offlineParkWaiter = null;
      // Unwind the virtual clock (see the doc comment): snap anything still
      // timed against it and restart the dt chains from real time.
      cameraTween.finish();
      fourDTween.finish();
      snapMorph();
      const realNow = performance.now();
      lastMotionTickMs = realNow;
      lastInsetTickMs = realNow;
      lastGovernedFrameMs = null;
      ui.setTimelineExportProgress(null);
    }
  }

  // Reflect the timeline document in its panel section — rows, count, and
  // the total-duration label (the recorder's own m:ss formatter, so the
  // status line and the recording button speak the same dialect). A render
  // keyframe (fr-v3au) holds playback for however long its render takes to
  // converge, so once any step carries a mode the authored total is only a
  // floor — the "+" says so.
  function refreshTimelineUi(): void {
    const steps = timeline.all();
    const label = formatElapsed(Math.round(timelineDurationMs(steps) / 1000));
    ui.renderTimeline(
      steps,
      steps.some((step) => step.mode !== undefined) ? `${label}+` : label,
    );
  }

  // The render mode a save made RIGHT NOW would be tagged with while its
  // session is still inside its first-frame gap — i.e. exactly when
  // captureCurrentThumbnail falls through to the explorer capture. null
  // whenever the capture already matches the tag (the points explorer, or a
  // render that has produced its picture), so there is nothing to correct
  // later. The two are one predicate deliberately: fr-r777's correction must
  // arm exactly when the fall-through happens and never otherwise.
  function thumbnailGapMode(): SavedSceneMode | null {
    if (state.renderMode === "points") return null;
    const session =
      state.renderMode === "flame"
        ? flameSession
        : state.renderMode === "solid"
          ? solidSession
          : surfaceSession;
    return session.hasFirstFrame ? null : state.renderMode;
  }

  // The displayed frame as a small gallery/timeline thumbnail: mode-aware
  // (fr-75sq) — a capture from a flame/solid render reads the rendered
  // frame, except during the render's first-frame gap, when the screen
  // honestly still shows the explorer. Shared by "★ Save to collection"
  // and "📍 Add keyframe" (fr-8v41).
  //
  // The gap capture is CORRECT and stays the immediate answer — a thumbnail
  // must be instant, so a save is never blocked on a convergence the way
  // fr-61a2's Save-PNG waits behind its export modal. What fr-r777 added is a
  // later correction: a save made in the gap records a pending patch
  // (notePendingThumbnailPatch) that re-photographs the entry once the
  // render's own first frame lands, if the document has not moved on
  // meanwhile. See thumbnail-patch.ts.
  function captureCurrentThumbnail(): string {
    const mode =
      state.renderMode !== "points" && thumbnailGapMode() === null
        ? state.renderMode
        : "points";
    return scene.captureThumbnail(mode);
  }

  // fr-r777's corrections in flight: entries saved during a render's
  // first-frame gap, each waiting for its own render mode's first frame.
  // Session state by decision — never persisted, since a reload legitimately
  // abandons them (the live document it comes back to may not be the one they
  // froze at all).
  let pendingThumbnailPatches: PendingThumbnailPatch[] = [];

  // Arm a correction for an entry just saved in `mode`'s first-frame gap.
  // `encoded` is the document the entry FROZE — the invalidation key the
  // correction is checked against later (thumbnail-patch.ts).
  function notePendingThumbnailPatch(
    store: ThumbnailPatchStore,
    id: string,
    mode: SavedSceneMode,
    encoded: string,
  ): void {
    pendingThumbnailPatches = recordThumbnailPatch(pendingThumbnailPatches, {
      store,
      id,
      mode,
      encoded,
    });
  }

  // Drop the corrections that can never land now — called from each session's
  // deactivate, where a mode exit (Back, a worker error, an undo that
  // time-travels the document, a session that died without ever rendering)
  // has just returned the app to the explorer.
  function dropStalePendingThumbnails(): void {
    pendingThumbnailPatches = dropStaleThumbnailPatches(
      pendingThumbnailPatches,
      state.renderMode === "points" ? null : state.renderMode,
    );
  }

  // `mode`'s session just produced its first frame (RenderSession's
  // onFirstFrame): re-photograph every entry saved during its startup gap
  // that is still a picture of the live document, and drop the rest.
  //
  // The invalidation rule lives in resolveThumbnailPatches and is the
  // non-obvious half: a saved entry froze a DOCUMENT, so a correction is only
  // the same picture while the live one still encodes to the same string AND
  // the live render mode is still the tag. An edit, a preset load, an undo, a
  // camera move (the pose rides the document, fr-1k4) or leaving the mode all
  // drop the patch and leave the point-cloud thumbnail alone — stale but
  // honest beats sharp and wrong.
  //
  // One capture serves the whole surviving list: every one of them matched
  // the same document and the same mode.
  function applyPendingThumbnailPatches(mode: SavedSceneMode): void {
    if (pendingThumbnailPatches.length === 0) return;
    const { apply, keep } = resolveThumbnailPatches(pendingThumbnailPatches, {
      frameMode: mode,
      mode: state.renderMode === "points" ? null : state.renderMode,
      encoded: encodeScene(currentDocument()),
    });
    pendingThumbnailPatches = keep;
    if (apply.length === 0) return;
    const thumbnail = scene.captureThumbnail(mode);
    let patchedCollection = false;
    let patchedTimeline = false;
    for (const patch of apply) {
      // A false return is an entry that went away under us — deleted, or (in
      // the collection) bumped by a later save of the same document, which
      // mints a fresh id. Nothing to do: the correction dies with it.
      if (patch.store === "collection") {
        patchedCollection ||= collection.setThumbnail(patch.id, thumbnail);
      } else {
        patchedTimeline ||= timeline.setThumbnail(patch.id, thumbnail);
      }
    }
    // Refresh whichever surface shows the picture. renderGallery on a closed
    // modal is a harmless rebuild of hidden DOM — the delete handler's own
    // idiom (it refreshes the still-open modal in place the same way).
    if (patchedCollection) ui.renderGallery(collection.all());
    if (patchedTimeline) refreshTimelineUi();
  }

  // Push the current soft-slice view state to the scene shader. Shared by
  // resetFourDView() and the three slice handlers that have a POINT-CLOUD
  // meaning — on/center/relative-color — each of which mutates a fourDView
  // slice field and then re-uploads the trio. The fourth, slab thickness
  // (fr-wa6o), deliberately does not come here: it is surface-tracer-only,
  // and the cloud's slice has a fixed Gaussian width of its own.
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
    // The reset can PARK the tumble (reduced motion, or a sticky "off"
    // choice), and the help box opens by naming the motion (fr-k9nx). The
    // flatness flip that brings us here painted that box BEFORE the reset ran
    // — against the outgoing view's flag — so it owes a repaint now.
    ui.updateLabels(state);
  }

  // Restore a saved 4D view pose (fr-pnek) — resetFourDView's document-
  // driven sibling, and the 4D mirror of applyCameraPose: rotor + slice
  // snap to the pose, and the same scene/UI pushes the reset does keep the
  // shader uniforms and the panel's slice controls in step. Tumble on/off/
  // speed are deliberately untouched — they're not in the pose (fr-0ya).
  // The explicit setRot4 matters on the paths where animate()'s own per-4D-
  // frame push hasn't run yet (boot's synchronous first paint).
  function applyFourDPose(pose: FourDPose): void {
    fourDTween.cancel();
    fourDView.applyPose(pose);
    pushFourDSlice();
    scene.setRot4(fourDView.matrix());
    syncFourDSliceUi();
  }

  // Reflect the live slice state in the panel controls — the sync side of
  // ui.setFourDSlice, shared by applyFourDPose and the frame a pose glide
  // lands on (see animate()'s 4D block).
  function syncFourDSliceUi(): void {
    ui.setFourDSlice(
      fourDView.sliceOn,
      fourDView.sliceCenter,
      fourDView.sliceRelColor,
      fourDView.sliceThickness,
    );
  }

  // The user's hand landing on the 4D view (a Shift-drag/-wheel rotor
  // gesture, a slice control) takes it back from the document (fr-pnek):
  // cancel an in-flight pose glide — its per-frame applyPose would overwrite
  // the gesture on the very next frame — AND drop a pose still waiting for
  // its cloud, which would otherwise re-stomp the gesture at arrival. The
  // 4D sibling of cancelTween on a camera grab; deliberately does NOT stop
  // a running show (neither does grabbing the camera).
  function releaseFourDPoseControl(): void {
    fourDTween.cancel();
    loadHints.clearPose();
  }

  // The ONE auto-motion toggle logic per dimension (fr-vja8.37): the panel
  // checkboxes and the canvas Space key both land here, so the session
  // state, the sticky user choice, the help-box wording and the persisted
  // viewer pref (fr-0ya) can never disagree about which input flipped them.
  // The checkbox path's DOM side ran in ui.ts before its handler fired; the
  // Space path mirrors that with ui.setAutoMotionToggle before calling in.
  function applyAutoOrbitToggle(checked: boolean): void {
    autoOrbitOn = checked;
    autoOrbitUserChoice = checked;
    // Persist the COMBINED auto-motion pref (fr-0ya) — the orbit sibling of
    // applyFourDTumbleToggle below; both write the one shared choice.
    updateViewerPrefs({ autoMotion: checked });
  }
  function applyFourDTumbleToggle(checked: boolean): void {
    fourDView.setTumbleUserChoice(checked);
    // The canvas help box opens by naming the motion (fr-k9nx), so a pause
    // has to reach it — ui.ts has already recorded the flag, this is the
    // repaint. The panel's own row visibility is ui.ts's own business.
    ui.updateLabels(state);
    // Persist the COMBINED auto-motion pref (fr-0ya): the last motion toggle
    // the user flips — tumble or orbit — becomes the one shared choice both
    // seed from on the next reload. Separate viewer-prefs key, never the
    // scene / share-URL document; merge-written so the other prefs survive.
    updateViewerPrefs({ autoMotion: checked });
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
   *
   * `seed` pins the morph's generation seed (fr-8v41): a timeline playback
   * leg passes its deterministic per-leg seed (timeline.ts's legSeed) so
   * every run of the same timeline generates the same content stream;
   * omitted, a fresh random seed is rolled as ever. (A chained restart
   * keeps the in-flight morph's seed regardless — see MorphTween.start —
   * which is itself the timeline's own earlier leg seed during playback.)
   */
  function regenerateReplaced(
    from: MorphSystem,
    fit: boolean,
    durationMs = MORPH_TWEEN_MS,
    seed?: number,
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
      seed ?? rollSeed(),
      // nowMs, not performance.now(): a timeline leg's morph must start on
      // the offline export's virtual clock (fr-92t9), and animate() samples
      // it with the same clock.
      nowMs(),
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
          ? morphBudget.budget(
              state.numPoints,
              // An offline export runs every intermediate at the scene's own
              // count (fr-92t9): the adaptive budget is sized from MEASURED
              // device speed — exactly the nondeterminism the frame-exact
              // path exists to remove — and the driver awaits each
              // generation anyway, so there is no frame rate to protect.
              offlineExport !== null ? "full" : state.morphDetail,
            )
          : state.numPoints,
      seed: morph?.seed ?? rollSeed(),
      symmetry,
      fourD: systemPartsAreNonFlat(transforms, finalTransform, symmetry),
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
    // The awaited load's pending pose, or null — null too for an arrival
    // still in flight from a PREVIOUS load, which must not apply (nor, via
    // releasePose below, discard) a pose the NEXT load is waiting to land
    // (load-hints.ts, fr-vja8.34).
    const pendingPose = loadHints.poseFor(request);
    if (transition.resetFourD) {
      if (fourDTween.active) {
        // A timeline leg's rotor glide owns the view (fr-pnek): the fresh-
        // visit reset would stomp it mid-flight (and the glide's next
        // advance would overwrite the reset anyway — a pointless flicker).
        // The glide lands the saved pose itself; nothing to do here.
      } else if (pendingPose) {
        // The loaded document carries its own 4D framing (fr-pnek): apply
        // it where the fresh-visit baseline would otherwise land — the
        // first non-flat arrival of a morphing load shows the destination
        // orientation immediately, and the terminal replaced arrival
        // re-applies it rather than resetting a pose the load (or a
        // just-finished timeline glide) put there. Not consumed here: the
        // release below keys off the replaced request itself, so a morph's
        // in-between arrivals can't strand the terminal one pose-less.
        applyFourDPose(pendingPose);
      } else {
        resetFourDView();
      }
    }
    // The pending pose is armed for exactly one load; that load's own
    // replaced request IS its landing (even when it lands flat — a corrupt
    // document could pair a 4D pose with flat transforms), so release it
    // here rather than inside the nonFlat-gated branch above.
    loadHints.releasePose(request);
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
    // time, when the camera still framed the previous attractor.
    // enterLoadedRenderMode carries the camera discipline that entry needs.
    // takeMode only yields for the awaited load's own replaced landing — a
    // stale replaced arrival leaves the hint armed (fr-vja8.34).
    const target = loadHints.takeMode(request);
    if (target !== null) {
      enterLoadedRenderMode(target);
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

  // The surface render's empty-space-skipping grid builder (fr-55r5 part 2):
  // a worker-side buildSurfaceGrid whose result the sphere tracer samples to
  // skip provably empty space. One request per 3D surface-session enter
  // (the session freezes its DE at start, so nothing invalidates a grid
  // mid-session); every session boundary re-stamps or cancels the
  // outstanding id, so a late build can never land on the wrong system.
  // Unlike the cloud there is NO sync fallback — a lost worker just means
  // gridless (correct, slower) marching, and the client stays quiet.
  //
  // A build that lands while a capture owns the tracer waits here first
  // (fr-p0mr): the grid is a live uniform write, and a capture's frame is
  // traced across many task turns.
  let pendingSurfaceGrid: SurfaceGrid | null = null;
  const applySurfaceGrid = (grid: SurfaceGrid): void => {
    scene.setSurfaceGrid(grid);
    // The tier loop treats this like any other invalidation: re-preview,
    // then re-settle — now with the faster march. An in-flight settle
    // job is superseded the same frame, so its gridless strips never mix
    // with grid-assisted ones on screen.
    scene.invalidate();
  };
  const surfaceGrid = new SurfaceGridClient({
    createWorker: (onResult, onError) => {
      if (typeof Worker === "undefined") return null;
      const worker = new Worker(
        new URL("./surface-grid-worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.onmessage = (e: MessageEvent<SurfaceGridResult>) =>
        onResult(e.data);
      worker.onerror = (e) => onError(e);
      worker.onmessageerror = (e) => onError(e);
      return {
        post: (request: SurfaceGridRequest) => worker.postMessage(request),
        terminate: () => {
          // Detach before terminating so an already-queued reply can't
          // reach a client that has moved on (the cloud handle's gap).
          worker.onmessage = null;
          worker.onerror = null;
          worker.onmessageerror = null;
          worker.terminate();
        },
      };
    },
    onGrid: (grid) => {
      // A capture owns the tracer's uniforms for the whole of its drain
      // (fr-p0mr). Uploading a grid mid-drain keeps the SURFACE identical
      // — the floors are conservative either way — but changes the
      // march-step/skip-cap regime (fr-z70m's erosion class) partway down
      // the frame, so rows traced before the upload sample it differently
      // from rows traced after. Hold it for the tick that owns the
      // uniforms again; the export is the only thing waiting on them.
      if (scene.surfaceCaptureBusy) {
        pendingSurfaceGrid = grid;
        return;
      }
      applySurfaceGrid(grid);
    },
    onError: (error) => {
      console.warn(
        "Surface-grid worker failed; marching without empty-space skipping.",
        error,
      );
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
          state.transforms.map((t) => t.colorIndex),
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
            state.transforms.map((t) => t.colorIndex),
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
  // base-map indexed on both paths (each folds its kaleidoscope copies back
  // to their base map — fr-q0h6), exactly like by-transform coloring,
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
    // nowMs, not performance.now(): a timeline leg's pose glide must step
    // on the offline export's virtual clock (fr-92t9).
    nowMs,
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
  // What the CURRENT flame session actually accumulates at, i.e. what a
  // Save-PNG from it will actually be (fr-61a2). Not the same number as
  // `scene.flameRenderSize(state.exportScale)`: `start` below shrinks that
  // target until the histogram fits the accumulator memory budget, and it is
  // the shrunken canvas the export composites. null between sessions.
  let flameRenderDims: { width: number; height: number } | null = null;

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
          // a CPU render (GPU never attempted): no reason to show. Wording
          // per the fr-tmgf legibility lesson: no API names inside
          // negations — "WebGPU unavailable" was field-misread as a
          // positive WebGPU indicator (the eye catches the API name, not
          // the negation).
          event.backend === "cpu" && flameGpuUnavailableReason !== null
            ? flameGpuUnavailableReason === "no-webgpu"
              ? "no GPU API in this browser"
              : "GPU failed"
            : undefined,
          // Software adapters escalate the note to the warning tier
          // (fr-tmgf): SwiftShader accumulation must not pass as the GPU.
          event.software === true,
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
      // Phone/tablet-class devices: shared with the memory-budget computation
      // below, so only read matchMedia once.
      const coarse = window.matchMedia("(pointer: coarse)").matches;
      // Device-aware memory budget for the supersampled accumulator (fr-7c8).
      // Computed here because its inputs — deviceMemory (Chromium-only,
      // hence the cast; absent from TS's DOM lib) and pointer coarseness —
      // are main-thread/window facilities a worker can't reliably read.
      const maxAccumBuckets = flameAccumBudgetBuckets(
        (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
        coarse,
      );

      // The render target: the screen buffer × the Export-size multiple
      // (fr-2urv; scene clamps to its texture ceilings), then shrunk until
      // the histogram fits the accumulation budget even at supersample 1 —
      // the worker's own clampSupersampleToBudget can't go below 1×, and on
      // a phone overshooting the budget kills the tab rather than throwing
      // (see FLAME_ACCUM_FLOOR_BYTES). At 1× this is exactly the screen.
      const base = scene.flameRenderSize();
      let { width, height } = scene.flameRenderSize(state.exportScale);
      const over = Math.sqrt((width * height) / maxAccumBuckets);
      if (over > 1) {
        width = Math.floor(width / over);
        height = Math.floor(height / over);
      }
      // Scale the iteration budget with the export area so per-OUTPUT-PIXEL
      // sample density — brightness and noise — matches the 1× render the
      // budget slider was tuned against (see the worker command's
      // iterationsBudgetScale doc). 1 exactly at 1×.
      const iterationsBudgetScale = Math.max(
        1,
        (width * height) / (base.width * base.height),
      );
      const projection = scene.flameProjectionMatrix();

      // Post-clamp, so the export modal quotes the size that will actually
      // save rather than the size that was asked for (fr-61a2).
      flameRenderDims = { width, height };
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
        // Rolled through the shared helper so a timeline render keyframe
        // can pin it (fr-4ff7) — see nextRenderSeed's doc.
        seed: nextRenderSeed(),
        requestedSupersample: state.flame.supersample,
        maxAccumBuckets,
        iterationsBudget: state.flame.iterations,
        iterationsBudgetScale,
        exposure: state.flame.exposure,
        gamma: state.flame.gamma,
        vibrancy: state.flame.vibrancy,
        estimatorRadius: state.flame.estimatorRadius,
        estimatorMinimumRadius: state.flame.estimatorMinimumRadius,
        estimatorCurve: state.flame.estimatorCurve,
        palette: resolvePalette(state.flame.paletteId, state.customPalette),
        order: state.symmetry.order,
        plane: state.symmetry.plane,
        twist: state.symmetry.twist ?? 0,
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
      renderCoverage.flame = 0; // ...and its fraction form (fr-61a2), so a waiting export reads 0% rather than the previous session's coverage.
    },
    activate: () => {
      state = setRenderMode(state, "flame");
      // The "auto" backdrop follows the active render's palette (fr-mz2u),
      // so every render-mode landing re-derives it — here and in the other
      // sessions' activate/deactivate.
      trackAutoBackground();
      refreshUi();
    },
    deactivate: () => {
      flameShared = null; // drop our half of the shared buffers; with the worker's half gone too, the SABs are collectable.
      flameRenderDims = null; // no session, no accumulation size (fr-61a2).
      // Reset only the mode this session owns — the exact semantics the old
      // per-mode boolean had (clearing flameActive could never touch
      // solidActive), so an idempotent exit() while some OTHER mode is
      // showing can't yank the app out of it via a blind write.
      if (state.renderMode === "flame") {
        state = setRenderMode(state, "points");
        trackAutoBackground(); // the explorer's palette owns the backdrop again (fr-mz2u)
        // Force the explorer to repaint over the frozen flame image (fr-w9wl):
        // flame and points share the one canvas, and returning to points is a
        // visible change that goes through no scene mutator — so with
        // auto-orbit off nothing else marks the frame dirty and render-on-
        // demand (fr-py7z) would leave the stale flame frame on screen until
        // the next camera move.
        scene.invalidate();
        // Release the export-scale accumulator canvas + GPU texture
        // (fr-vja8.35) — the flame sibling of exitSurfaceComputeSession's
        // release-on-exit, and the one chokepoint every LEAVE-THE-MODE exit
        // passes through: a manual mode switch and the worker error paths
        // both call exit(). An Export-size RESTART deliberately never gets
        // here — restartFlameRender calls enter(), whose re-entry path
        // terminates the old handle without running deactivate — so a
        // restart keeps the warm canvas and repaints seamlessly, and only a
        // genuine departure from flame mode pays the release.
        scene.exitFlameSession();
      }
      // Whatever this render still owed a thumbnail (fr-r777) is owed
      // nothing now — the mode is over.
      dropStalePendingThumbnails();
      refreshUi();
      // An offline export parked on this render (fr-6jic): an early exit —
      // worker error, Back — terminated the worker, so no further progress
      // event will ever wake the driver; this is its signal to re-check
      // (renderMode left flame) and fall back to capturing points.
      notifyRenderSignal();
    },
    // The flame's first image lands: any entry saved during the startup gap
    // can now be re-photographed as the flame it was tagged with (fr-r777).
    onFirstFrame: () => applyPendingThumbnailPatches("flame"),
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
        terminate: () => {
          // Detach the handlers BEFORE terminating — the flame host's idiom
          // (fr-mps8): terminate() discards the WORKER's queue, not
          // MessageEvents already queued on THIS thread, and the voxel worker
          // posts a grid per chunk, so one is nearly always in flight. A
          // stale grid arriving after exit uploaded the dead session's
          // volume as the next session's first frame, marked first-frame on
          // a session that drew nothing (wrong thumbnail patch), and a
          // queued "error" tore down whatever session was live by then.
          worker.onmessage = null;
          worker.onerror = null;
          worker.terminate();
        },
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
        // Rolled through the shared helper so a timeline render keyframe
        // can pin it (fr-4ff7) — see nextRenderSeed's doc.
        seed: nextRenderSeed(),
        // Device-aware memory budget for the voxel grid + texture (fr-8x7) —
        // the same two main-thread-only signals, for the same reasons, as the
        // flame render's maxAccumBuckets above (fr-7c8).
        maxVoxels: voxelAccumBudgetVoxels(
          (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
          window.matchMedia("(pointer: coarse)").matches,
        ),
        order: state.symmetry.order,
        plane: state.symmetry.plane,
        twist: state.symmetry.twist ?? 0,
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
      renderCoverage.solid = 0; // ...and its fraction form (fr-61a2), likewise.
    },
    activate: () => {
      // Drop any transform selection: the lens has no guide box in this mode,
      // so a raycast drag should orbit the camera, not grab a hidden box.
      state = selectTransform(state, null);
      state = setRenderMode(state, "solid");
      trackAutoBackground(); // see the flame session's activate (fr-mz2u)
      refreshGuides();
      refreshUi();
    },
    deactivate: () => {
      // Reset only the mode this session owns — see the flame session's
      // deactivate for why this is not a blind write.
      if (state.renderMode === "solid") {
        state = setRenderMode(state, "points");
        trackAutoBackground(); // see the flame session's deactivate (fr-mz2u)
        // Repaint the explorer over the last raymarched frame (fr-w9wl) — see
        // the flame session's deactivate; the solid volume shares the same one
        // canvas and the same render-on-demand gate.
        scene.invalidate();
      }
      dropStalePendingThumbnails(); // see the flame session's deactivate (fr-r777)
      refreshUi();
      // A parked offline export's early-exit wake (fr-6jic) — see the flame
      // session's deactivate.
      notifyRenderSignal();
    },
    // The first accumulated grid: the solid twin of the flame session's own
    // late-thumbnail correction (fr-r777).
    onFirstFrame: () => applyPendingThumbnailPatches("solid"),
  });

  // The surface render session (epic fr-7jlk): sphere-trace the attractor as
  // an implicit surface against the analytic distance estimator. No worker
  // and no accumulation — buildSurfaceDE is pure math (analytic inverses +
  // a small seeded bounding probe, a few ms) and the whole "session" is GPU
  // uniforms, so the render is ready the moment start() returns. The
  // RenderSession skeleton still buys the choreography every render shares:
  // exit-on-undo/redo (via applyDecodedSnapshot's switchRenderMode), error →
  // exit, and the repaint-on-leaving discipline (fr-w9wl). Like the solid
  // render the DE is world-space, so the camera stays LIVE.

  // Whether the ACTIVE surface session traces the 4D DE — frozen at start()
  // together with the DE itself (the session snapshots geometry at enter;
  // the live document's flatness may drift until the next enter). Gates
  // tickRender's per-frame rotor/slice push.
  let surfaceSessionIs4D = false;
  // fr-rsp6: false while the live 4D surface session's fold set breaks
  // segment exactness (spherefold/mandelbox — slabExact4), where every
  // view push clamps the fr-wa6o thickness to 0 and the panel hides the
  // row. Session-scoped like the flag above.
  let surface4SlabExact = true;

  // Monotonic token guarding the async shader-compile gate (fr-du81): each
  // start() takes a fresh one, and a compile promise resolving for a
  // superseded session (exited, or re-entered with a different system) must
  // not mark the CURRENT session's first frame or report its progress.
  let surfaceCompileToken = 0;

  // --- The WebGPU compute path for FOLD 3D surface sessions (fr-tzdg) ---
  //
  // fr-q1f8's measured verdict on real Iris Xe: the WGSL image kernel
  // traces mandelboxKifs at ~49µs/ray where the WebGL fragment tracer is
  // unbounded (>1300µs/ray), compiles in ~0.1-0.3s where the fold GLSL
  // links in ~25s on Mesa, and its bounded multi-pass dispatch respects
  // the i915 watchdog by construction — so fold sessions PREFER compute
  // when a WebGPU adapter exists, and the WebGL fragment tracer stays THE
  // fallback (affine/escape/lens/4D sessions never route here at all).
  // `?surfacegl` forces the WebGL path (the ?flameperf-style escape
  // hatch); any create failure or a device loss sets the one-way session
  // memo and re-enters, which routes the same system through the WebGL
  // branch — grid build included, since the compute path skips the grid
  // request on purpose (49µs/ray was measured gridless; the multi-second
  // fold grid build buys nothing this path needs — measure before wiring,
  // see the fr-tzdg follow-ups).
  // fr-tmgf: the block carries its REASON so the WebGL session's detail
  // token can say why compute passed — "flag" is the user's own ?surfacegl
  // escape hatch (a deliberate choice needs no caveat), "unavailable" is a
  // missing adapter, "failed" a create failure or device loss. One-way for
  // the page's life, like the boolean it replaced.
  let surfaceComputeBlock: SurfaceComputeBlock | null = new URLSearchParams(
    window.location.search,
  ).has("surfacegl")
    ? "flag"
    : null;
  // `?surfacecompute` is `?surfacegl`'s mirror: it makes a session PREFER
  // the compute tracer on the shapes whose routing rule sends them to WebGL.
  // That is plain affine 3D alone since fr-fniy — 4D above symmetry order 1
  // used to be the other one, and this flag is how it stopped being: the
  // rule sending it to WebGL could not be re-measured until the flag
  // existed, and once it could, it was 12x wrong. The remaining rule is a
  // performance verdict, not a capability one (`core:"affine"` serves that
  // shape in production already), so this selects a supported path and
  // never a new one.
  //
  // It exists because a routing verdict that cannot be re-measured cannot be
  // maintained. Without it the two arms are comparable only on the shapes
  // where they already overlap, so a rule that was right when it was written
  // can only be confirmed, never overturned. `?surfacegl` WINS if both are
  // given: a block is one-way, so `surfaceComputeAvailable()` refuses first
  // and this flag never sees the branch.
  const surfaceComputeForced = new URLSearchParams(window.location.search).has(
    "surfacecompute",
  );
  // fr-biox: `?surfacemaxrays=N` stands in for the device's own per-frame
  // ray ceiling — the ?surfshadewidth-style escape hatch for the sizing
  // that ceiling drives. A real device only bands an export at 2-4x
  // (~8-32M rays), which is minutes of tracing to look at; pretending the
  // ceiling is small bands a CHEAP export the same way, which is what
  // scripts/surface-export-tile.verify.mjs measures against the untiled
  // arm — and what turns a field report into an answer.
  const surfaceComputeMaxRaysFlag = ((): number | null => {
    const raw = new URLSearchParams(window.location.search).get(
      "surfacemaxrays",
    );
    const n = raw === null ? NaN : Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();
  // fr-khxy: modern Firefox EXPOSES navigator.gpu while requestAdapter()
  // can still return null (WebGPU ships progressively per platform), so
  // the sync supported() gate admits fold-4D entry on the OBJECT alone
  // and the failure then surfaces as a mid-entry toast + mode exit — a
  // user who misses the toast just sees no preview ever appear. Probe a
  // real adapter once at boot and latch the same one-way block a failed
  // create() would have set: the eligibility gate then refuses fold-4D
  // up front with the honest note, and every compute-preferring shape
  // routes its WebGL fallback directly instead of through a doomed
  // create(). A session already mid-entry when the probe lands keeps
  // its own create() verdict — same end state, narrower window.
  if (surfaceComputeBlock === null && SurfaceComputeRenderer.supported()) {
    void SurfaceComputeRenderer.probeAdapter().then((ok) => {
      if (!ok && surfaceComputeBlock === null) {
        surfaceComputeBlock = "unavailable";
        refreshSurfaceEligibility();
      }
    });
  }
  let surfaceComputeRenderer: SurfaceComputeRenderer | null = null;
  // Latest-wins preview coalescing: `pending` latches every invalidation,
  // the single driver loop re-checks it after each completed frame — a
  // drag presents previews at whatever rate frames finish, each with the
  // freshest camera, instead of restarting (and never finishing) per rAF.
  let surfaceComputePreviewFlight = false;
  let surfaceComputePreviewPending = false;
  // The preview in flight is the unbudgeted COMPLETION pass (fr-ud7n) —
  // the one preview frame that can outlive an invalidation, so the kick
  // path cancels it explicitly instead of waiting out a wall budget.
  let surfaceComputePreviewCompleting = false;
  let surfaceComputeSettleFlight = false;
  // Memo key of the last completed offline-export force frame: dwell
  // frames re-present it instead of re-tracing seconds of identical
  // pixels (the strip path re-traces per frame — affordable there only
  // because affine systems are cheap; a fold settle is not).
  let surfaceComputeForceKey: string | null = null;
  // Fraction of the in-flight compute SETTLE's rays fully resolved
  // (fr-tmgf: the progress row's compute-path feed — null outside a
  // settle, so the row hides exactly like the strip path's idle state).
  let surfaceComputeSettleProgress: number | null = null;
  /** What to say if this session's first settle renders NOTHING (fr-17qu) —
   * armed by the routing that knows which object is being marched, fired by
   * the settle that knows whether any ray hit it. Null for the IFS arms,
   * whose attractors are non-empty by the gate's own contraction test, and
   * outside a surface session. */
  let surfaceBlankNotice: (() => void) | null = null;
  /**
   * Samples per pixel the compute SETTLE traces (fr-vpbq). Previews stay
   * at 1 — a preview exists to be cheap, and its whole job is to be
   * replaced.
   *
   * WHY IT IS ON BY DEFAULT, with no setting to turn it off. Pass 0 is the
   * pre-fr-vpbq settle exactly — same rays, same wall, same image, and it
   * presents its partials the way it always did — so nothing a user had
   * before arrives later or looks different. Every pass after it only
   * refines, presents when it lands, and dies the instant the camera moves
   * (the renderer's own token). So the cost is paid only by a parked view,
   * which is the one case where the extra quality is what the user is
   * waiting for, and the progress row discloses the passes as they run
   * rather than guessing at anyone's patience (the fr-24to/fr-zx34 line).
   *
   * EIGHT, not sixteen: fr-vpbq measured 16 spp removing 67-73% of the
   * impulse rate, but its own coverage curve is steepest early — the
   * distribution's tail is what the last doublings buy — and eight keeps a
   * settle's total wall inside the same order of magnitude as the frame the
   * user already waited for.
   */
  const SURFACE_COMPUTE_SETTLE_SAMPLES = 8;
  /**
   * Below this fraction of a settle's rays hitting anything, the session
   * says so (fr-17qu). NOT zero, which was the second cut's mistake and
   * would essentially never fire: the marcher accepts a hit at
   * `uAcceptPixelEps` — the settle frame's pixel footprint, far coarser
   * than any analytic epsilon — so a few rays catch even a system scaled
   * so hard that every orbit escapes on its first pass.
   *
   * MEASURED at the entry pose, 1024x640 = 655360 rays. The nine shipped
   * Escape-time presets hit 32752-67313 rays (5.0-10.3%), the thinnest of
   * them being `mandelboxRings`, which is a DUST of filaments with no
   * measurable volume at all. A Mandelbox pre-scaled by 8, whose set is
   * degenerate, hits 126 (0.019%). That is a ~260x gap, and this sits in
   * it: 50x below the thinnest real object, 5x above the degenerate one.
   * At 655360 rays it means "fewer than 655 pixels", which is dust on a
   * backdrop rather than a picture.
   */
  const SURFACE_BLANK_HIT_FRACTION = 0.001;
  // Which of those passes is in flight (1-based), for the row's trailing
  // detail token — null outside a settle, and left null through pass 1, so
  // an ordinary settle's row reads exactly as it did before fr-vpbq.
  let surfaceComputeSettleSample: number | null = null;
  // The same for the preview loop's COMPLETION pass (fr-ud7n). Separate
  // field rather than a phase-tagged one, because the two loops overlap
  // for exactly as long as a superseded settle takes to notice its
  // cancel(): a shared field would let that settle's teardown null the
  // fresh preview's coverage. The preview wins that tie in the row —
  // it is the trace still running.
  let surfaceComputePreviewProgress: number | null = null;
  // The surface progress row's trailing WebGL detail token (fr-tmgf):
  // why THIS session runs the WebGL tracer when compute would have been
  // its home ("compute unavailable" / "compute failed"), null when WebGL
  // is the natural engine (affine/4D, or the ?surfacegl flag — escape
  // joined the compute-homed set with fr-dlxh).
  // Session-scoped: set by start()'s routing, cleared with the session.
  let surfaceWebglDetailToken: string | null = null;
  // A Save-PNG capture owns the surface tracer (fr-7mfx). Both engines
  // yield mid-capture now, so the rAF loop runs DURING an export — and
  // every path below would fight it: the compute arms all open with
  // renderer.cancel(), and the strip arms would re-size the target being
  // drained and overwrite the frozen full-tier uniforms. Everything that
  // touches the tracer stands aside on this flag, which is what lets a
  // multi-minute export survive its own responsiveness.
  let surfaceCaptureFlight = false;

  // Preview frames carry a wall budget so a rung too heavy for this
  // device still completes (truncated — untraced rays show backdrop),
  // presents, and SAMPLES: the governor's panic path then drops the rung.
  // Without it, continuous motion could cancel every over-heavy preview
  // before a single measurement existed and the ladder would never learn.
  //
  // It is a MEASUREMENT device and nothing more (fr-ud7n). A truncated
  // frame is a verdict about the rung, never a verdict about the pose:
  // when the ladder has no cheaper rung left and no invalidation is
  // waiting, the loop re-runs the frame UNBUDGETED and lets it finish —
  // see runSurfaceComputePreviewLoop's completion pass. Budgeting the
  // last preview of a parked session is the automatic give-up fr-24to/
  // fr-zx34 removed from the WebGL tier, and on a Firefox-class adapter
  // (~10-20x slower WebGPU) it was every preview of every fold session.
  const SURFACE_COMPUTE_PREVIEW_BUDGET_MS = 2000;

  // Progress cadence for an EXPORT-scale compute frame (fr-7mfx): twice
  // the renderer's live default, because each tick pays a full-frame
  // readback and an export is 1-16x the live frame's pixels. The modal
  // discloses coverage, not the instantaneous rate — a second between
  // updates reads the same.
  const SURFACE_COMPUTE_EXPORT_PROGRESS_MS = 1000;

  // How long nextPaint() waits on rAF before starting the work anyway
  // (fr-7mfx). Long enough for a real compositor frame at 60Hz, short
  // enough that a hidden tab's paused rAF costs the export nothing worth
  // noticing.
  const NEXT_PAINT_FALLBACK_MS = 120;

  // Compute is on the table at all — no block latched, an API present.
  // The escape branch consults this alone (fr-dlxh: a pure-fold map is
  // always compute-shaped, and so is a CHAIN of them — fr-s04t, whose
  // kernel cycles the list); the 3D IFS branch adds its shape
  // test below. The 4D branch consults this alone too since fr-fniy —
  // EVERY 4D system is compute-shaped, kaleidoscope included, and the
  // measurement that moved that line is at the branch itself.
  function surfaceComputeAvailable(): boolean {
    return surfaceComputeBlock === null && SurfaceComputeRenderer.supported();
  }

  // Fold 3D IFS sessions — base-map folds OR a fold FINAL lens (fr-55s1:
  // the kernel wraps either core in descendLens's branch sweep, so
  // fr-zx34's lens-over-affine field class now routes here too, off the
  // fragile fold GLSL entirely). Plain affine systems stay on the WebGL
  // tracer (fast there, with the refined estimator and the grid).
  function surfaceComputeEligible(de: SurfaceDE): boolean {
    return (
      surfaceComputeAvailable() &&
      (deHasFolds(de) || de.foldFinal !== null || surfaceComputeForced)
    );
  }

  /** A FORWARD-ORBIT session's one shade slot: the first active map's
   * explorer color — the exact pick `setEscapeSystem`'s (and, since
   * fr-tdin, `setBulbSystem`'s) GLSL packing takes. The bulb gate is
   * single-map, and an escape CHAIN (fr-s04t) still shades from one slot:
   * a forward orbit applies every link in turn and CHOOSES none, so its
   * hit-info reports `firstChoice = 0` at any chain length and the head
   * link's color is the one the "By Transform" source can honestly use. */
  function escapeSlotColor(): Vec3 {
    const active = Math.max(
      0,
      state.transforms.findIndex((t) => (t.weight ?? 1) > 0),
    );
    return transformColors(
      state.transforms.length,
      state.transforms.map((t) => t.colorIndex),
    )[active];
  }

  function teardownSurfaceCompute(): void {
    surfaceComputeRenderer?.destroy();
    surfaceComputeRenderer = null;
    surfaceComputePreviewPending = false;
    surfaceComputePreviewCompleting = false;
    surfaceComputeSettleFlight = false;
    surfaceComputeForceKey = null;
    surfaceComputeSettleProgress = null;
    surfaceComputePreviewProgress = null;
    scene.exitSurfaceComputeSession();
    updateSoftwareRendererNote();
  }

  // fr-tmgf: ONE warning element, two possible facts — the boot-time WebGL
  // renderer string (device-level and permanent, so it wins) and the live
  // surface compute session's software adapter (session-scoped; its row
  // token also carries "(software)"). Recomposed at every compute
  // create/teardown; the boot path sets the WebGL fact directly because
  // this function reads compute state that doesn't exist yet up there.
  function updateSoftwareRendererNote(): void {
    if (webglSoftware) {
      ui.setSoftwareRendererNote(
        softwareWarningText("webgl", webglRendererLabel ?? "unknown renderer"),
      );
      return;
    }
    const compute = surfaceComputeRenderer;
    if (compute !== null && compute.software) {
      ui.setSoftwareRendererNote(
        softwareWarningText(
          "webgpu",
          compute.adapterLabel ?? "fallback adapter",
        ),
      );
      return;
    }
    ui.setSoftwareRendererNote(null);
  }

  // The compute path's first-frame gate — the compile gate's twin, one
  // async resource over: device + pipeline instead of a GLSL link. Same
  // token discipline, same deferred selection-drop/guide-refresh
  // rationale (see the GLSL gate below), same failure contract — except
  // failure here FALLS BACK (memo + re-enter routes the WebGL path)
  // rather than exiting the mode: the WebGL tracer is the fallback, not
  // the error state.
  function beginSurfaceComputeGate(
    token: number,
    target: SurfaceComputeTarget,
  ): void {
    SurfaceComputeRenderer.create(
      target,
      // Per-slot shading inputs by kind: the IFS sessions (3D and 4D
      // alike) shade de.maps[j] (fr-c6yd's shared derivation); the two
      // FORWARD sessions (escape, and fr-tdin's bulb) have ONE slot —
      // the active map's color, trap index 0, the GLSL
      // setEscapeSystem/setBulbSystem shape.
      isForwardTarget(target)
        ? [escapeSlotColor()]
        : surfaceSlotColors(state.transforms, target.de.maps),
      isForwardTarget(target)
        ? [0]
        : surfaceTrapIndices(state.transforms, target.de.maps),
    )
      .then((renderer) => {
        if (token !== surfaceCompileToken || state.renderMode !== "surface") {
          renderer.destroy();
          return;
        }
        surfaceComputeRenderer = renderer;
        // What this device can allocate for ONE frame (fr-biox): the
        // scene sizes every frame it asks for against it — the live pane
        // fits under it, a capture tiles under it. Only knowable now,
        // since the enters above all ran while create() was in flight.
        scene.setSurfaceComputeRayCap(
          surfaceComputeMaxRaysFlag ?? renderer.maxFrameRays,
        );
        // Field-debuggability breadcrumb (the ?surfacegl escape hatch's
        // counterpart): one line saying which tracer owns this session.
        console.info(
          `Surface render: WebGPU compute tracer active${
            renderer.adapterLabel ? ` (${renderer.adapterLabel})` : ""
          }.`,
        );
        updateSoftwareRendererNote();
        renderer.onLost = () => {
          if (surfaceComputeRenderer !== renderer) return;
          console.warn(
            "Surface compute device lost; re-entering via the WebGL tracer.",
          );
          surfaceComputeBlock = "failed";
          surfaceSession.enter();
        };
        state = selectTransform(state, null);
        refreshGuides();
        refreshUi();
        surfaceSession.markFirstFrame();
        noteRenderProgress("surface", 1, 1);
        scene.invalidate();
        // First frame without waiting for a camera nudge: entry
        // invalidations (the escape branch's framing glide included) fire
        // while create() is still in flight, where the preview kick
        // no-ops for want of a renderer, and the one-shot invalidate
        // above can be consumed by the scene's own draw before the tier
        // clock reads it — so a session could sit blank until the next
        // camera motion. Kick directly now that the renderer exists;
        // the preview loop's latest-wins coalescing makes a redundant
        // kick free, and the tier clock's settle follows as usual.
        // Previews off (fr-37c6): arm the settle directly instead — an
        // entry IS a parked view, and the pending latch is exactly as
        // un-losable as the kick (surfaceComputeTick consumes it, and a
        // glide's invalidations supersede it through the same latch).
        if (surfacePreviewsEnabled) kickSurfaceComputePreview();
        else surfaceSettlePending = true;
      })
      .catch((error: unknown) => {
        if (token !== surfaceCompileToken || state.renderMode !== "surface") {
          return;
        }
        console.warn(
          "Surface compute unavailable; falling back to the WebGL tracer.",
          error,
        );
        // "unavailable" (no adapter for this context) vs "failed" (device/
        // pipeline creation died) — the progress row's detail token tells
        // them apart (fr-tmgf).
        surfaceComputeBlock =
          error instanceof SurfaceComputeUnavailableError
            ? "unavailable"
            : "failed";
        surfaceSession.enter();
      });
  }

  function kickSurfaceComputePreview(): void {
    surfaceComputePreviewPending = true;
    if (surfaceComputePreviewFlight) {
      // The completion pass (fr-ud7n) is the one preview frame with no
      // wall budget, so a fresh invalidation cannot simply wait it out —
      // supersede it here and let the loop pick the new pose up on its
      // next turn. Budgeted frames are deliberately left alone: they
      // resolve within SURFACE_COMPUTE_PREVIEW_BUDGET_MS anyway, and
      // cancelling one would throw away the governor sample the ladder
      // needs most while the view is moving.
      if (surfaceComputePreviewCompleting) surfaceComputeRenderer?.cancel();
      return;
    }
    void runSurfaceComputePreviewLoop();
  }

  /**
   * The compute path's preview driver: one frame per invalidation,
   * latest-wins — plus the COMPLETION pass (fr-ud7n), the frame that runs
   * with NO wall budget when the ladder has nothing cheaper left and the
   * view has parked.
   *
   * Why the pass exists: {@link SURFACE_COMPUTE_PREVIEW_BUDGET_MS} cuts a
   * preview the device cannot afford so the governor gets a sample and
   * drops a rung. At the FLOOR rung there is no drop to make, so a
   * truncated floor frame used to be the preview's last word — the loop
   * drained, the settle fired, and the user was handed a mostly-backdrop
   * pane and a multi-minute full render nobody asked for. That is the
   * automatic give-up fr-24to/fr-zx34 removed from the WebGL tier and
   * fr-37c6 gave a Skip button instead, and on a Firefox-class adapter
   * (~10-20x slower WebGPU) it was EVERY preview of every fold session.
   * So the truncated frame stays an intermediate paint, and the pass
   * re-runs the same rung to completion: progressive presents as rays
   * resolve, honest coverage in the progress row, and the Skip button
   * live throughout for the user who would rather have the settle now.
   *
   * Dropping the budget costs no safety: every submission the renderer
   * makes is bounded by its own measured pass sizing (the i915 watchdog
   * discipline in surface-compute.ts), which is what keeps the equally
   * unbudgeted SETTLE safe — the wall budget only ever decided when to
   * stop, never how big a piece of work to send. And the pass is nearly
   * free against what follows it: the floor rung traces ~200x fewer rays
   * than the full frame, at a shallower depth clamp. MEASURED on the
   * reporter's case (Firefox 151 WebGPU, 1920x1057, 20-map Menger + fold
   * lens + balloon): two 2.1s truncated floor previews resolving 5% of
   * their rays, then a completion pass that resolved all 9916 in 13.8s
   * and disclosed 3.9% -> 97% while it did — where the settle behind it
   * was still at 48% after 179s. ~4% of the wall, for the only whole
   * image the user sees in the first several minutes.
   */
  async function runSurfaceComputePreviewLoop(): Promise<void> {
    const renderer = surfaceComputeRenderer;
    if (!renderer) {
      surfaceComputePreviewPending = false;
      return;
    }
    surfaceComputePreviewFlight = true;
    // Latched by a truncated frame the governor could not answer with a
    // cheaper rung: the loop's one reason to render again with no fresh
    // invalidation behind it.
    let completionDue = false;
    try {
      // A loop already in flight when a capture starts would resume from
      // its await and cancel the export (fr-7mfx); leave `pending` latched —
      // a >1x capture's ratio restore raises an invalidation that re-kicks
      // it, a mid-capture pose change stays latched in scene.needsRender
      // (the capture tick never clears it), and a 1x capture raises nothing
      // by design (fr-vja8.45) but presents its own full-detail frame of the
      // same pose in place of the interrupted preview.
      while (
        (surfaceComputePreviewPending || completionDue) &&
        !surfaceCaptureFlight
      ) {
        // An invalidation outranks a due completion: the pose that frame
        // would have completed is stale, and the fresh one gets the
        // budgeted (measuring) treatment like any other.
        const completing = !surfaceComputePreviewPending;
        surfaceComputePreviewPending = false;
        completionDue = false;
        if (surfaceComputeRenderer !== renderer) return;
        // Supersede whatever is in flight — a stale settle or an older
        // preview; latest wins, exactly the cloud generator's slot rule.
        renderer.cancel();
        const spec = scene.surfaceComputeFrameSpec("preview");
        const t0 = performance.now();
        surfaceComputePreviewCompleting = completing;
        const frame = await renderer.renderFrame(
          spec,
          completing
            ? {
                // Unbudgeted, so it discloses and paints like the settle:
                // resolved rays shade in over the truncated frame this
                // pass re-runs (the renderer prefills from it), and the
                // ray tallies feed "Preview · WebGPU N%" + the Skip
                // button (fr-37c6) through syncSurfaceProgress.
                onProgress: (pixels, done, total) => {
                  if (
                    surfaceComputeRenderer !== renderer ||
                    state.renderMode !== "surface"
                  ) {
                    return;
                  }
                  scene.presentSurfaceComputeFrame(
                    pixels,
                    spec.width,
                    spec.height,
                  );
                  surfaceComputePreviewProgress =
                    total > 0 ? done / total : null;
                },
              }
            : { budgetMs: SURFACE_COMPUTE_PREVIEW_BUDGET_MS },
        );
        surfaceComputePreviewCompleting = false;
        surfaceComputePreviewProgress = null;
        if (
          surfaceComputeRenderer !== renderer ||
          state.renderMode !== "surface"
        ) {
          return;
        }
        if (frame) {
          scene.presentSurfaceComputeFrame(
            frame.pixels,
            frame.width,
            frame.height,
          );
          // The completion pass feeds the governor NOTHING: it is by
          // construction the frame that did not fit, measured under a
          // regime (no budget, parked view) the interactive ladder never
          // renders in. Its seconds-to-minutes cost would only pin the EMA
          // high and hold the rung down long after the pose it belonged to
          // is gone.
          if (!completing) {
            const dropped = scene.sampleSurfaceComputeCost(
              performance.now() - t0,
              frame.truncated,
            );
            if (frame.truncated) {
              // A truncated preview that just dropped the rung must be
              // RE-RUN (fr-khxy round 3): a parked entry has no further
              // invalidations coming, so without this re-kick the panic
              // verdict would fire after the session's last preview and
              // the pane would hold the truncated frame's backdrop until
              // the full settle lands (measured 45s of black on Firefox's
              // ~10-20x slower WebGPU where Chrome's preview completes in
              // 0.4s). At the dropped rung the re-run usually completes
              // inside the same wall budget and paints real content, which
              // the settle's prefill then carries.
              //
              // No drop means the floor rung (any truncation panics, and
              // panic saturates there), so the ladder has answered as far
              // as it can — the completion pass takes it from here, which
              // is also why this cannot loop: `completing` frames are
              // never truncated and never sampled.
              if (dropped !== null) surfaceComputePreviewPending = true;
              else completionDue = true;
            }
          }
          console.debug(
            `Surface compute preview ${String(frame.width)}x${String(frame.height)}: ` +
              `${frame.wallMs.toFixed(0)}ms wall, ${String(frame.passes)} passes` +
              `${frame.truncated ? " (truncated)" : completing ? " (completion)" : ""}, ` +
              `hit ${String(frame.counts.hit)} / miss ${String(frame.counts.miss)} / ` +
              `exhausted ${String(frame.counts.exhausted)} / active ${String(frame.counts.active)}`,
          );
        }
      }
    } finally {
      surfaceComputePreviewFlight = false;
      surfaceComputePreviewCompleting = false;
      surfaceComputePreviewProgress = null;
    }
  }

  async function runSurfaceComputeSettle(): Promise<void> {
    const renderer = surfaceComputeRenderer;
    if (!renderer || surfaceComputeSettleFlight || surfaceCaptureFlight) return;
    surfaceComputeSettleFlight = true;
    try {
      renderer.cancel();
      const spec = scene.surfaceComputeFrameSpec("full");
      const frame = await renderer.renderFrame(spec, {
        // fr-vpbq: the settle is the one frame worth supersampling — it is
        // what a parked view finally shows, and the escape-time objects'
        // speckle is sub-pixel structure no march budget or viewport
        // reaches. Pass 0 is the pre-fr-vpbq settle exactly.
        samples: SURFACE_COMPUTE_SETTLE_SAMPLES,
        // Progressive presents: a full-resolution fold settle is tens of
        // seconds of bounded passes — the image develops on screen
        // (resolved rays shade in, unresolved ones keep backdrop) instead
        // of parking on the last preview. An invalidation cancels via the
        // preview loop's cancel() and this resolves null.
        onProgress: (pixels, done, total) => {
          if (
            surfaceComputeRenderer === renderer &&
            state.renderMode === "surface"
          ) {
            scene.presentSurfaceComputeFrame(pixels, spec.width, spec.height);
            surfaceComputeSettleProgress = total > 0 ? done / total : null;
            // Which supersampling pass this coverage belongs to. `done`
            // spans the whole job, so the pass is just which N-th of it we
            // are in — floored, 1-based, and clamped because the final
            // present lands exactly on the end.
            surfaceComputeSettleSample =
              total > 0
                ? Math.min(
                    SURFACE_COMPUTE_SETTLE_SAMPLES,
                    Math.floor(
                      (done / total) * SURFACE_COMPUTE_SETTLE_SAMPLES,
                    ) + 1,
                  )
                : null;
          }
        },
      });
      if (
        surfaceComputeRenderer !== renderer ||
        state.renderMode !== "surface"
      ) {
        return;
      }
      if (frame) {
        scene.presentSurfaceComputeFrame(
          frame.pixels,
          frame.width,
          frame.height,
        );
        // fr-17qu, second cut. The FIRST completed settle of a session is
        // the honest place to say "there is nothing here", and its own hit
        // count is the honest evidence: a frame that drew essentially
        // nothing at the entry pose IS blank, by the renderer's own
        // arithmetic, so this cannot disagree with what the user is
        // looking at.
        //
        // The first cut asked `probeEscapeFill` instead, before rendering,
        // and that was the wrong instrument: it samples the bailout ball's
        // VOLUME, and an escape-time set is often a thin fractal with
        // essentially none. The shipped `mandelboxRings` preset reads
        // 0.0000% fill at 65536 samples and renders ~38k surface hits —
        // a dust of filaments. The probe was right; the question was wrong.
        //
        // FIRST settle only, because after that the camera has moved and a
        // blank frame means "you navigated into a void", which is a
        // different sentence. At entry the session has just glided to frame
        // the bounding ball (see fitToBounds above), so the whole object is
        // in view and zero hits means there is no object.
        //
        // BOTH ENGINES ANSWER THIS SINCE fr-7k0o. This arm counts ray
        // STATUSES the kernel already reports; the WebGL strip arm counts
        // the COVERAGE flag its tracer writes into alpha, in the readback
        // fr-jf9y's accumulator already pays for (`scene.ts`'s
        // `surfaceCoveredFraction`, fired from tickRender). Same fraction
        // of the same settle frame, and `plane` counts as drawn on both —
        // a fallback session used to render an empty set in silence, which
        // was fr-17qu's original complaint surviving inside its own fix.
        const firstSettle = !surfaceSettled;
        surfaceSettled = true;
        const drawn = frame.counts.hit + frame.counts.plane;
        const rays = frame.width * frame.height;
        if (
          firstSettle &&
          surfaceBlankNotice &&
          !frame.truncated &&
          rays > 0 &&
          drawn / rays < SURFACE_BLANK_HIT_FRACTION
        ) {
          surfaceBlankNotice();
        }
        console.debug(
          `Surface compute settle ${String(frame.width)}x${String(frame.height)}: ` +
            `${frame.wallMs.toFixed(0)}ms wall, ${String(frame.passes)} passes, ` +
            `hit ${String(frame.counts.hit)} / miss ${String(frame.counts.miss)} / ` +
            `exhausted ${String(frame.counts.exhausted)}`,
        );
      }
    } finally {
      surfaceComputeSettleFlight = false;
      surfaceComputeSettleProgress = null;
      surfaceComputeSettleSample = null;
    }
  }

  function surfaceComputeForceFrameKey(spec: SurfaceComputeFrameSpec): string {
    return [
      Array.from(spec.invProjView).join(","),
      spec.width,
      spec.height,
      spec.lutVersion,
      spec.ambient,
      spec.colorSource,
      spec.colorSpeed,
      spec.lightDir.join(","),
      // The backdrop stops (fr-5ps1): a background change/crossfade must
      // re-trace the memoized force frame — miss pixels carry the gradient.
      spec.bgTop.join(","),
      spec.bgBottom.join(","),
      // The 4D pose (fr-dlxh 4D cut): a timeline leg glides rotor/slice
      // with the camera parked, so a key without them would re-present a
      // stale pose across every dwell frame of the glide.
      ...(spec.view4
        ? [
            Array.from(spec.view4.rotor).join(","),
            spec.view4.w0,
            spec.view4.sliceHalfW,
          ]
        : []),
      // The balloon block (fr-5wlv.5): a parked camera with an R sweep
      // must never re-present a stale frame — the 4D pose-triple
      // precedent. The "balloon" literal is the on-flag; the block
      // exists exactly when the session's kernels carry the wrapper.
      ...(spec.balloon
        ? [
            "balloon",
            spec.balloon.center.join(","),
            spec.balloon.rho,
            spec.balloon.R,
            spec.balloon.far,
          ]
        : []),
      // The ground plane block (fr-rhn5): the balloon block's own
      // precedent one level up — a parked camera with the floor toggled
      // must never re-present a stale frame. The "groundPlane" literal is
      // the on-flag; the block exists exactly when the session's kernels
      // carry the plane arm (never alongside "balloon" above — the two
      // are mutually exclusive by construction).
      ...(spec.groundPlane
        ? [
            "groundPlane",
            spec.groundPlane.y,
            spec.groundPlane.fadeStart,
            spec.groundPlane.fadeEnd,
            spec.groundPlane.ballCenter.join(","),
            spec.groundPlane.ballRadius,
            spec.groundPlane.albedo.join(","),
          ]
        : []),
    ].join("|");
  }

  // Offline-export force frames (fr-tzdg): trace the full-quality frame on
  // the compute path's own async clock BEFORE tickRender(force) paints —
  // the awaitable renderFrame dep — and memoize by view/params so the
  // step's dwell frames re-present instead of re-tracing an identical
  // settle per exported frame.
  async function ensureSurfaceComputeForceFrame(): Promise<void> {
    const renderer = surfaceComputeRenderer;
    if (!renderer) return;
    const spec = scene.surfaceComputeFrameSpec("full");
    const key = surfaceComputeForceFrameKey(spec);
    if (key === surfaceComputeForceKey) return;
    renderer.cancel();
    // Single-sampled on purpose (fr-vpbq): this is the OFFLINE VIDEO path,
    // and its cost multiplies by the frame count — a clip is hundreds of
    // these, where the live settle and the Save-PNG are one apiece. Motion
    // also hides per-frame aliasing that a still cannot. Revisit if the
    // exporter ever grows a quality tier to hang it on.
    const frame = await renderer.renderFrame(spec);
    if (!frame || surfaceComputeRenderer !== renderer) return;
    scene.presentSurfaceComputeFrame(frame.pixels, frame.width, frame.height);
    surfaceComputeForceKey = key;
  }

  // Save-PNG while a compute surface session is live: trace at export
  // size off-canvas — in device-sized bands since fr-biox — then present
  // + read in one synchronous span (scene.captureSurfaceComputeFrame).
  function captureSurfaceComputePng(
    renderer: SurfaceComputeRenderer,
    scale: number,
    run: ExportRun,
  ): Promise<ExportImage | null> {
    return scene.captureSurfaceComputeFrame(scale, async (spec, tile) => {
      // Cancel lands BETWEEN tiles as readily as inside one (fr-biox):
      // the modal's onCancel supersedes the frame in flight, but the next
      // tile would open a fresh one — an export that kept tracing after
      // its own cancellation.
      if (run.cancelled) return null;
      renderer.cancel();
      const t0 = performance.now();
      const frame = await renderer.renderFrame(spec, {
        // The fr-tmgf disclosure hook the live settle already uses,
        // pointed at the export modal instead of the progress row. The
        // partial pixels are deliberately ignored: the capture presents
        // exactly once, at export pixel ratio, inside
        // captureSurfaceComputeFrame's own present-and-read span, and a
        // progressive present would fight that.
        onProgress: (_pixels, done, total) => {
          run.report(
            total > 0 ? (tile.index + done / total) / tile.count : null,
          );
        },
        // Every tick costs a width*height*4 readback and an export traces
        // 1-16x the live frame's rays, so halve the live cadence: the
        // modal reads coverage, it doesn't need the live rate.
        progressIntervalMs: SURFACE_COMPUTE_EXPORT_PROGRESS_MS,
        // Neither seeded by the live pane nor the seed for it (fr-biox).
        capture: true,
        // fr-vpbq: a saved PNG gets the same supersampling the pane it was
        // saved from does — the aliasing is scale-invariant (measured
        // exponent -0.21..-0.36 against output resolution, where a sphere's
        // perimeter law is -0.98), so exporting larger does not fix it and
        // an unsampled export would be visibly worse than the screen it
        // came from. The modal's coverage report already spans the passes
        // (`done`/`total` are the whole job's), and Cancel still lands
        // between them.
        samples: SURFACE_COMPUTE_SETTLE_SAMPLES,
      });
      if (frame) {
        console.debug(
          `Surface compute export tile ${String(tile.index + 1)}/${String(tile.count)} ` +
            `${String(frame.width)}x${String(frame.height)}: ` +
            `${(performance.now() - t0).toFixed(0)}ms wall, ` +
            `${String(frame.passes)} passes, hit ${String(frame.counts.hit)}`,
        );
      }
      return frame ? frame.pixels : null;
    });
  }

  /** What a Save-PNG is about to do, resolved once so the modal and the
   * capture cannot disagree about which engine is tracing (fr-7mfx). */
  interface PngExportPlan {
    /** The modal's subtitle: what actually saves, and on which engine. */
    detail: string;
    /** Measured evidence, feeding ONE decision — whether to skip the
     * modal's grace period. Never displayed: the surface predictor
     * over-predicts ~4x off preview evidence, and a wrong "~90s" is the
     * patience-guessing fr-zx34 reverted. Null = let the grace period
     * decide, which is right whenever the capture yields. */
    predictedMs: number | null;
    /** False states honestly that the work cannot be interrupted, and
     * hides Cancel rather than offering a dead button. */
    cancellable: boolean;
    /** True while this capture owns the surface tracer, so the surface
     * tick and the compute loops stand aside for it. */
    holdsSurfaceTracer: boolean;
    /** Stops the work early. The WebGL drain polls `run.cancelled`
     * instead, so its plan leaves this out. */
    onCancel?: () => void;
    /** Block until the mode's own render IS the picture this plan will
     * capture (fr-61a2). Resolves null when it is, or a user-presentable
     * note when it never will be. `savePng` stands `holdsSurfaceTracer`
     * down for its duration — a surface export that held the tracer here
     * would be waiting for a first frame it had itself prevented. */
    awaitReady?: (run: ExportRun) => Promise<string | null>;
    /** The export modal's second action (fr-2fbs), present only for a wait
     * with a partial to hand over — see export-wait.ts's
     * `renderExportOffersEarlySave`. `taken()` is read back AFTER the
     * capture: it answers what actually happened rather than what was
     * pressed, so a press the finished render beat to the line does not get
     * labelled rough. */
    deliverEarly?: {
      label: string;
      onDeliver: () => void;
      taken: () => boolean;
    };
    capture: (run: ExportRun) => Promise<ExportImage | null>;
  }

  // The wait policy itself — the readiness rule (flame waits for its
  // BUDGET, solid/surface for a first frame), the fr-2fbs early-save
  // affordance with its restart-gap latch, and the ties-go-to-budget
  // awaitReady loop — is `export-wait.ts` (fr-vja8.67), extracted on the
  // export-progress.ts precedent so those order-sensitive rules are
  // unit-tested instead of resting on the browser gate alone. This wiring
  // contributes exactly the live signals the module cannot own; every dep
  // is read at wait time, never captured here, so this sits safely above
  // the surfaceSession const it names.
  const exportWait = createExportWait({
    flameComplete: () => renderComplete.flame,
    flameCoverage: () => renderCoverage.flame,
    hasFirstFrame: (mode) =>
      mode === "flame"
        ? flameSession.hasFirstFrame
        : mode === "solid"
          ? solidSession.hasFirstFrame
          : surfaceSession.hasFirstFrame,
    renderMode: () => state.renderMode,
    nextRenderSignal,
    notifyRenderSignal,
  });

  /**
   * Pick the capture arm for the current mode. The arm is the MODE's, full
   * stop (fr-61a2): a render that has not produced its picture yet is waited
   * for through `awaitReady`, never silently swapped for the explorer's. The
   * explorer arm is reached by being in points mode, and by nothing else.
   */
  function planPngExport(scale: number): PngExportPlan {
    if (state.renderMode === "surface") {
      const size = scene.exportSize(scale);
      const dims = `${String(size.width)} × ${String(size.height)}`;
      // WHICH tracer owns the session is settled at the same instant as its
      // first frame — the compute gate's resolution marks both — so before
      // then there is no engine to name, and the detail line says only the
      // size rather than guessing one (fr-tmgf's rule: a label must not
      // assert an engine).
      const engine = !surfaceSession.hasFirstFrame
        ? ""
        : surfaceComputeRenderer
          ? " · WebGPU"
          : " · WebGL";
      return {
        detail: `${dims}${engine}`,
        // Used for ONE thing: whether the modal skips its grace period and
        // shows at once. Nothing is refused on it (fr-avf6). Bounded compute
        // passes yield by construction, so for those the grace period alone
        // decides — a cheap frame never flashes a modal and an expensive one
        // shows without having to be predicted; the WebGL drain has a
        // measured prediction and uses it.
        predictedMs: surfaceComputeRenderer
          ? null
          : scene.predictSurfaceCaptureMs(scale),
        cancellable: true,
        holdsSurfaceTracer: true,
        onCancel: () => {
          // The WebGL drain polls `run.cancelled` instead, so this is a
          // no-op on that arm — which is also what it was before, as a
          // missing hook.
          surfaceComputeRenderer?.cancel();
        },
        ...exportWait.planRenderWait("surface"),
        capture: (run) => {
          // Read at capture time, not plan time: awaitReady may have waited
          // out the compute gate, and that gate is what decides this.
          const renderer = surfaceComputeRenderer;
          return renderer
            ? captureSurfaceComputePng(renderer, scale, run)
            : scene.captureSurfaceFrame(scale, {
                onProgress: (fraction) => {
                  run.report(fraction);
                },
                cancelled: () => run.cancelled,
              });
        },
      };
    }
    if (state.renderMode === "solid") {
      const size = scene.exportSize(scale);
      return {
        detail: `${String(size.width)} × ${String(size.height)}`,
        // One synchronous raymarch at export scale: it can report no
        // coverage mid-draw, so this decides the ONE thing left — whether
        // the modal skips its grace period. Since fr-2q01 that decision is
        // MEASURED: the previous export's own ms/px at this volume, pose
        // and threshold, times this export's pixels. `scale > 1` alone had
        // opened a modal on a 320×240 scale-2 export that finished in
        // 274ms, flashing it for ~270ms — precisely the noise the grace
        // period exists to absorb — while being right about the 1920×1080
        // case it was written for.
        //
        // The fallback is TODAY'S HEURISTIC verbatim rather than a
        // pessimistic class prior, and deliberately: a solid march has no
        // cost class to be pessimistic about. Its per-pixel work spans
        // "every ray misses the box" to "every ray runs the full
        // marchStepsForGrid loop", so a prior pitched high enough to cover
        // the second end would show a modal on every FIRST export in the
        // app — the same flash, moved rather than removed. (The surface
        // arm declines its own fold prior for the mirror-image reason: it
        // is calibrated ~100x past typical pixels.) Export scale remains
        // the one knob known to make an unmeasured export slow, so it goes
        // on deciding the unmeasured case, and one export teaches it.
        predictedMs:
          scene.predictSolidCaptureMs(scale) ??
          (scale > 1 ? EXPORT_MODAL_SLOW_PREDICTION_MS + 1 : null),
        // Cancellable for the WAIT, not the raymarch (fr-61a2). This arm
        // read `false` while it could only ever BE that one uninterruptible
        // submission, and hiding a dead button was right. Now the long pole
        // is a fresh session's voxel grid, which a Cancel genuinely ends —
        // and a Cancel landing in the raymarch that follows still has an
        // effect, since the finished frame is then discarded rather than
        // downloaded.
        cancellable: true,
        holdsSurfaceTracer: false,
        ...exportWait.planRenderWait("solid"),
        capture: () => scene.captureSolidFrame(scale),
      };
    }
    if (state.renderMode === "flame") {
      // A flame session ACCUMULATES at the export size (fr-2urv), so the
      // capture is a 2D composite of the canvas the worker has been filling
      // plus the PNG encode — nothing is rendered here. What this arm waits
      // for instead is that accumulation meeting its budget; see
      // export-wait.ts's renderExportReady for why a mid-accumulation frame
      // is the wrong picture rather than merely an early one.
      const size = flameRenderDims ?? scene.flameRenderSize(state.exportScale);
      return {
        detail: `${String(size.width)} × ${String(size.height)}`,
        // The wait yields on the worker's own progress events, so the grace
        // period alone decides whether it earns a modal: a flame that has
        // already converged still saves instantly and silently, exactly as
        // it did before.
        predictedMs: null,
        cancellable: true,
        holdsSurfaceTracer: false,
        // The one wait that offers the early save (fr-2fbs): this canvas is
        // already the export, at the export size, so stopping the wait
        // delivers what is on screen at the resolution asked for — and the
        // budget it is waiting out scales with the export AREA, so 4x is
        // 16x the wait and exactly where the escape is worth having.
        ...exportWait.planRenderWait("flame"),
        capture: () => scene.captureFlameFrame(),
      };
    }
    // Points: the explorer IS the picture, and it is already on screen.
    const size = scene.exportSize(scale);
    return {
      detail: `${String(size.width)} × ${String(size.height)}`,
      predictedMs: null,
      cancellable: false,
      holdsSurfaceTracer: false,
      capture: () => scene.captureFrame(scale),
    };
  }

  /** Hand a captured still to the browser as a timestamped download.
   * `rough` says the user cut a render's wait short (fr-2fbs) and this file
   * is the unfinished picture they asked for — the toast is the only record
   * of that once the modal is gone, and a file that looks noisier than the
   * screen it came from should not have to be explained by memory. */
  function deliverPng(image: ExportImage | null, rough = false): void {
    if (!image) {
      ui.flashToast("Couldn't encode the PNG");
      return;
    }
    triggerDownload(image.blob, `fractal-${Date.now()}.png`);
    // The device ceilings may have clamped the export below the chosen
    // multiple (scene.exportPixelRatio / the flame memory clamp), so
    // report the size that actually saved.
    ui.flashToast(
      `Saved ${image.width}×${image.height} PNG${rough ? " · rough" : ""}`,
    );
  }

  /**
   * Capture a still behind the export modal (fr-7mfx): the modal discloses
   * measured coverage, Cancel stops the work, and nothing else decides
   * when an export has gone on long enough (fr-avf6 — the surface arms
   * carry no cost ceiling, so there is no refusal to escalate past and no
   * consented retry to disclose).
   */
  async function savePng(scale: number): Promise<void> {
    const plan = planPngExport(scale);
    const run = exportProgress.begin({
      title: "Saving PNG",
      detail: plan.detail,
      predictedMs: plan.predictedMs,
      cancellable: plan.cancellable,
      // Absent on every arm but flame's (fr-2fbs), which is what keeps the
      // modal a one-button dialog everywhere else.
      deliverEarly: plan.deliverEarly,
      onCancel: () => {
        plan.onCancel?.();
        // Wake a wait parked in export-wait.ts's awaitRenderExportable
        // (fr-61a2): its only other wake-ups are the render's own signals,
        // and a solid grid or a flame chunk can be seconds away — a Cancel
        // must not have to wait one out before it takes effect.
        notifyRenderSignal();
      },
    });
    ui.setSavePngBusy(true);
    surfaceCaptureFlight = plan.holdsSurfaceTracer;
    try {
      // Let the modal reach the screen before anything blocking starts.
      // The surface drains yield on their own, but the solid raymarch is
      // one synchronous submission — without this its modal would only
      // paint after the render it exists to disclose.
      await nextPaint();
      // Wait for the mode's own render to BE the picture this export will
      // save (fr-61a2), with the surface-tracer claim STOOD DOWN for the
      // duration: a surface session's first frame arrives on the very tick
      // that claim tells to stand aside, so holding it across the wait would
      // be waiting for a frame we had just prevented. Nothing but a
      // microtask passes here when the render is already exportable, which
      // is every export that could reach this code before fr-61a2.
      if (plan.awaitReady) {
        surfaceCaptureFlight = false;
        const blocked = await plan.awaitReady(run);
        surfaceCaptureFlight = plan.holdsSurfaceTracer;
        if (run.cancelled) {
          ui.flashToast("Export cancelled");
          return;
        }
        if (blocked !== null) {
          ui.flashToast(blocked);
          return;
        }
      }
      const image = await plan.capture(run);
      // A cancelled capture resolves null on every arm, which is also how
      // a refused encode resolves — the caller is the only one who knows
      // which happened.
      if (run.cancelled) {
        ui.flashToast("Export cancelled");
        return;
      }
      deliverPng(image, plan.deliverEarly?.taken() ?? false);
    } catch (err: unknown) {
      if (run.cancelled) {
        ui.flashToast("Export cancelled");
        return;
      }
      // No surface arm refuses on cost any more (fr-avf6), so anything
      // reaching here is a genuine failure. A SurfaceCaptureCostError
      // still carries a user-presentable message — only the synchronous
      // drain raises one now, which this path cannot reach, but honouring
      // the message costs nothing and beats swallowing it.
      ui.flashToast(
        err instanceof SurfaceCaptureCostError
          ? err.message
          : "Couldn't encode the PNG",
      );
    } finally {
      surfaceCaptureFlight = false;
      // Re-enable BEFORE the modal closes: hideExportProgress restores
      // focus to whatever held it when the modal opened — usually this
      // very button — and focusing a disabled button silently drops focus
      // to <body>, stranding a keyboard user after every export.
      ui.setSavePngBusy(false);
      run.end();
    }
  }

  /** Resolve once the browser has had a chance to PAINT. rAF alone fires
   * before the frame is composited, so the trailing macrotask is what
   * makes "the modal is on screen now" true rather than merely scheduled.
   * Raced against a timeout because rAF is PAUSED in a hidden tab: an
   * export started just before a tab switch must still begin, rather than
   * waiting for the user to come back to it. */
  function nextPaint(): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      const done = (): void => {
        if (settled) return;
        settled = true;
        resolve();
      };
      requestAnimationFrame(() => setTimeout(done, 0));
      setTimeout(done, NEXT_PAINT_FALLBACK_MS);
    });
  }

  // The compute path's per-frame choreography — the strip choreography's
  // twin with async frames: invalidations preview (latest-wins), the tier
  // clock's settle verdict waits out the preview flight, the recorder
  // re-presents parked frames so captureStream keeps receiving paints.
  function surfaceComputeTick(now: number, force: boolean): void {
    if (force) {
      // ensureSurfaceComputeForceFrame already traced and presented on
      // this task's await chain — this paint just re-presents so the
      // paint and the encode that follows share one task.
      scene.representSurfaceComputeFrame();
      return;
    }
    const tier = surfaceRenderTier.frame(now, scene.needsRender);
    if (tier === "preview") {
      scene.clearRenderNeeded();
      surfaceSettled = false;
      surfaceSettlePending = false;
      surfaceComputeForceKey = null;
      if (surfacePreviewsEnabled) {
        kickSurfaceComputePreview();
      } else {
        // Previews off (fr-37c6): the pane freezes on its last presented
        // frame while the view moves. Cancel the in-flight settle
        // directly — the preview loop's supersede cancel() is the one
        // that normally does this — so a stale-pose settle stops burning
        // GPU and stops presenting over the frozen frame; the tier
        // clock re-arms the full render once the view parks.
        surfaceComputeRenderer?.cancel();
      }
    } else if (tier === "full") {
      surfaceSettlePending = true;
    }
    if (surfaceSettlePending && !surfaceComputePreviewFlight) {
      surfaceSettlePending = false;
      void runSurfaceComputeSettle();
    }
    if (
      recorderActive &&
      !surfaceComputePreviewFlight &&
      !surfaceComputeSettleFlight
    ) {
      scene.representSurfaceComputeFrame();
    }
  }

  /**
   * Abandon the in-flight preview and start the full-detail render of the
   * current view NOW (fr-37c6) — the one-shot escape from a grinding
   * preview (the progress row's Skip button), and the immediate effect of
   * flipping the Quick previews pref off mid-grind. One-shot by
   * construction: nothing here touches the pref, so the next invalidation
   * previews as usual. No-op outside a live surface session or when no
   * preview is actually in flight (skipping a running settle would only
   * restart it).
   */
  function skipSurfacePreviewNow(): void {
    if (state.renderMode !== "surface" || !surfaceSession.hasFirstFrame) {
      return;
    }
    if (surfaceComputeRenderer) {
      if (!surfaceComputePreviewFlight && !surfaceComputePreviewPending) {
        return;
      }
      // Latest-wins in reverse: drop the pending latch so the loop drains,
      // cancel the frame it is awaiting, and arm the settle — which
      // surfaceComputeTick fires the moment the flight clears. A budgeted
      // frame is seconds at most, but the completion pass (fr-ud7n) is
      // exactly as unbounded as a WebGL preview job — this is the arm the
      // Skip button drives there, not just the pref flip.
      surfaceComputePreviewPending = false;
      surfaceComputeRenderer.cancel();
      surfaceSettlePending = true;
      return;
    }
    if (!scene.surfacePreviewActive) return;
    // The strip path: the settle verdict is usually ALREADY latched behind
    // the grinding preview (tickRender holds it off while the job runs) —
    // abandoning the job is the whole skip; the latch below covers the
    // sub-TIER_SETTLE_MS window where the clock hasn't fired yet.
    scene.abandonSurfacePreview();
    surfaceSettlePending = true;
  }

  const surfaceSession = new RenderSession<never>({
    start: () => {
      // Set when this session routes to the WebGPU compute path (fr-tzdg;
      // fr-dlxh widened it to the escape kind, then — the 4D cut — to
      // ifs4, and fr-tdin to the bulb) — the gate below then awaits
      // device + pipeline instead of the GLSL link.
      let computeTarget: SurfaceComputeTarget | null = null;
      // Recomputed by the routing below (fr-tmgf); only the plain-affine
      // 3D branch keeps null unconditionally — WebGL is its natural
      // engine, nothing to explain.
      surfaceWebglDetailToken = null;
      // A grid the PREVIOUS session parked behind a capture (fr-p0mr) must
      // not greet this one either (fr-vja8.11): a surface→surface restart
      // (restartSurfaceRender — the balloon toggle's path) re-enters
      // without ever running deactivate, so its boundary clear can't
      // cover this door.
      pendingSurfaceGrid = null;
      try {
        if (
          systemPartsAreNonFlat(
            state.transforms,
            state.finalTransform ?? null,
            state.symmetry,
          )
        ) {
          // A 4D system: the w = sliceCenter cross-section (or fr-wa6o
          // slab) of the rotor-posed attractor. Rotor + slice are LIVE
          // per frame (tickRender pushes them every tick): unlike
          // flame/solid-4D's frozen pose snapshot — frozen there because
          // a pose change invalidates their whole accumulation — the
          // surface recomputes every pixel every frame, so the 4D pose
          // stays exactly as live as the camera. The document's
          // kaleidoscope rides into the DE (fr-u91x): the 4D descent
          // sweeps its sectors — w-planes and twists included — so the
          // surfaced set is the plotted set. Since fr-dlxh's 4D cut the
          // 4D kind PREFERS the compute renderer (the affine4 kernel
          // core; rotor/slice ride every frame spec); the fragment
          // tracer (fr-vxoj) is the fallback arm (?surfacegl / no
          // adapter / device loss).
          surfaceSessionIs4D = true;
          if (
            analyzeSurfaceSystem4(
              state.transforms,
              state.finalTransform ?? null,
            ).status === "ineligible"
          ) {
            // fr-vag4: the 4D IFS gate refused, so the FORWARD-ORBIT
            // complement one dimension up — `analyzeEscapeSystem4`'s
            // chain of non-contracting folds and quaternion squares. The
            // 3D branch below reads the two gates in exactly this order
            // for exactly this reason; there is no 4D Mandelbulb arm
            // beside it, because a triplex power has no fourth component
            // (bulb-de.ts's model refusal, which the 4D escape gate
            // inherits by refusing a bulb LINK).
            //
            // COMPUTE-ONLY, and by the shipped precedent rather than a
            // shortcut: the fragment 4D tracer carries no fold GLSL
            // (fr-rsp6), and an escape chain is fold-shaped by nature —
            // so, exactly like a fold-shaped 4D session, entry is refused
            // when compute is unavailable rather than handed to a tracer
            // that cannot render it.
            const de = buildEscapeDE4(
              state.transforms,
              state.finalTransform ?? null,
              state.symmetry,
            );
            ui.setSurfaceSessionKind("escape");
            // A forward orbit cannot thread a segment, so there is no
            // slab at any thickness (escape-de-4d.ts's NO SLAB
            // paragraph) — the same row a !slabExact4 system disables,
            // with its own reason on the tooltip: the fold family that
            // rescues the descent (box folds only) is exactly the one
            // that fails here, so the descent's wording would be wrong.
            surface4SlabExact = false;
            ui.setFourDSlabAvailable(false);
            surfaceBlankNotice = () => {
              ui.flashToast(
                "This 4D chain rendered almost nothing — fewer than one ray in a thousand hit it. Its escape-time set may be empty, too thin to see, or missed by this w-slice; try another slice, or a smaller weight or scale on one of the links.",
              );
            };
            if (surfaceComputeAvailable()) {
              computeTarget = {
                kind: "escape4",
                de,
                groundPlane: state.groundPlane,
              };
              scene.enterSurfaceComputeEscape4Session(
                state.groundPlane,
                de.boundingRadius,
              );
              scene.setSurface4View(
                fourDView.matrix(),
                fourDView.sliceCenter,
                0,
              );
              surfaceGrid.cancel();
              // The explorer cloud of a non-contracting 4D system is the
              // same escape-reset debris the 3D branch frames away from,
              // and it sits inside the solid for the same reason.
              const R = de.boundingRadius;
              cameraTween.fitToBounds(
                {
                  minX: -R,
                  maxX: R,
                  minY: -R,
                  maxY: R,
                  minZ: -R,
                  maxZ: R,
                  minR: 0,
                  maxR: R,
                },
                { fov: scene.camera.fov, aspect: scene.camera.aspect },
              );
            } else {
              // The fold-4D refusal's wording, one family over — reachable
              // only through mid-session compute loss, since the
              // eligibility gate refuses ENTRY without compute.
              ui.flashToast(
                "Surface render stopped: 4D escape-time chains need WebGPU compute, which just became unavailable.",
              );
              queueMicrotask(() => surfaceSession.exit());
            }
          } else {
            const de = buildSurfaceDE4(
              state.transforms,
              state.finalTransform ?? null,
              state.symmetry,
            );
            // fr-5wlv.6 / fr-qxxw: an IFS-shaped 4D session — the balloon's
            // live shape one dimension up, so its rows stay reachable.
            ui.setSurfaceSessionKind("ifs");
            // The fr-wa6o thickness slider is live only where the slab is
            // SOUND (fr-rsp6): spherefold/mandelbox branches take segments
            // to arcs, so those sessions clamp sliceHalfW to 0 at every
            // view push below (the packer's own guard would throw) and the
            // panel hides the thickness row.
            surface4SlabExact = slabExact4(de);
            ui.setFourDSlabAvailable(surface4SlabExact);
            // Routing by MEASURED verdict: PLAIN 4D prefers compute,
            // EVERY 4D SESSION PREFERS COMPUTE, kaleidoscope included since
            // fr-fniy. The fragment 4D tracer is the fallback arm
            // (`?surfacegl` / no adapter / device loss), which is the 3D
            // fold/escape arrangement one dimension up.
            //
            // MEASURED 2026-08-17 on real Iris Xe (TGL GT2) through
            // ANGLE/Mesa, 1024x640, identity rotor, centred slice,
            // production build, one FRESH session per cell, both arms
            // FORCED so neither is the routing rule measuring itself:
            //
            //   node scripts/slice-cliff.probe.mjs <url> --display=:0 \
            //     --arm=both --scenes=<plain4|kaleido4> --slices=0 --settle=1
            //
            //   plain4   (3 maps, order 1)          WebGL  11.5s  compute 3.0s
            //   kaleido4 (2 maps, order 6, twist 1) WebGL 637.5s  compute 53.1s
            //
            // THE ORDER-6 ROW IS WHY THIS LINE MOVED. It used to read WebGL
            // 147s against compute 179s — a 1.2x for the fragment arm that
            // sat inside its own run-to-run spread (147/444/604/637s at
            // nominally identical conditions, because the strip pump's cost
            // evidence starts class-pessimistic and ratchets off the job's
            // own measurements, so an expensive scene's total is
            // path-dependent), so the rule stood on a null result. fr-fniy
            // then found the compute arm's hit-shade sizer asking for a
            // batch width that was its own cost model's attribution pivot
            // rather than anything about the scene, and fixing that took the
            // compute row to 53.1s. That is 2.8x faster than the FASTEST run
            // the fragment arm has ever recorded here and 12x this cell's,
            // with a ~5% run-to-run spread against a 4x one — no longer a
            // null result in either magnitude or repeatability. First frame
            // moves the same way: 0.21s against 4.86s.
            //
            // Both arms settle the SAME picture: 8 supersampling passes at
            // `subPixelSample`'s offsets, which `scene.ts`'s strip pump and
            // `surface-compute.ts` share by import, and
            // `scripts/surface-4d.verify.mjs` step (e) holds them to an
            // object-mask IoU on BOTH scenes.
            //
            // FOLD-shaped 4D systems (fr-rsp6) remain compute-ONLY rather
            // than compute-PREFERRING: the fragment 4D tracer carries no
            // fold GLSL (deliberately — the 3D fold GLSL already sits at
            // Mesa's link cliff, and a 243-branch 4D body there would be
            // unshippable), so there is no fragment arm to fall back to.
            // That is the one thing `foldShaped4` still decides here. At
            // order > 1 the DE's own superlinear order cost (fr-b72d:
            // x13.5 per query at order 6 on the CPU oracle, matched on the
            // GPU, and paid identically by BOTH arms) is disclosed by the
            // honest progress row, never a refusal — which is why the
            // kaleido4 row is still tens of seconds after a 12x.
            //
            // `?surfacegl` is the escape hatch that keeps this
            // re-measurable: rerun the two commands before changing this
            // line.
            const foldShaped4 = deHasFolds4(de) || de.foldFinal !== null;
            if (surfaceComputeAvailable()) {
              // No GLSL system upload — the enter twin owns the session
              // resets, and the live view flows through setSurface4View
              // into the scene state every frame spec re-reads.
              // fr-qxxw/fr-h0c3: the balloon and the floor lift with the
              // session, and their precedence is the 3D compute arm's —
              // the two never compile together, and the balloon wins.
              const groundPlane4 = state.groundPlane && !state.balloonEcho;
              computeTarget = {
                kind: "ifs4",
                de,
                balloon: state.balloonEcho,
                groundPlane: groundPlane4,
              };
              scene.enterSurfaceCompute4Session(
                de,
                state.balloonEcho,
                groundPlane4,
              );
            } else if (foldShaped4) {
              // Reachable only through mid-session compute loss (device
              // loss / create failure re-enter this routing with the block
              // latched) — the eligibility gate refuses fold-4D ENTRY when
              // compute is unavailable. There is no tracer that can render
              // this session: exit the mode with the reason rather than
              // hand a fold-blind tracer the wrong object. Deferred a tick
              // exactly like the build-failure fallback below — enter()
              // stores the handle only after start() returns, and exit()
              // has to see it.
              ui.flashToast(
                "Surface render stopped: 4D folds need WebGPU compute, which just became unavailable.",
              );
              queueMicrotask(() => surfaceSession.exit());
            } else {
              // fr-tmgf: the WebGL session says why compute passed. Every
              // 4D system is compute-shaped since fr-fniy, so this arm is
              // always an explanation owed — except for the deliberate
              // `?surfacegl` flag, which `surfaceWebglDetail` returns null
              // for on its own.
              surfaceWebglDetailToken = surfaceWebglDetail({
                computeShaped: true,
                supported: SurfaceComputeRenderer.supported(),
                block: surfaceComputeBlock,
              });
              scene.setSurfaceSystem4(
                de,
                surfaceSlotColors(state.transforms, de.maps),
                surfaceTrapIndices(state.transforms, de.maps),
              );
            }
            scene.setSurface4View(
              fourDView.matrix(),
              fourDView.sliceCenter,
              surface4SlabExact ? fourDView.sliceThickness : 0,
            );
            // No grid for the 4D surface (the live rotor/slice would
            // invalidate one per frame) — and a still-building 3D grid from
            // a previous session must not land mid-4D-session.
            surfaceGrid.cancel();
          }
        } else if (
          analyzeSurfaceSystem(state.transforms, state.finalTransform ?? null)
            .status === "ineligible"
        ) {
          // The IFS gate refused — so one of the two FORWARD-ORBIT
          // complements (fr-kltj's escape-time folds, fr-tdin's
          // Mandelbulb). Neither map has an attractor to descend onto;
          // each has an escape-time set whose boundary Surface marches by
          // iterating the map FORWARD from every query, and that is what
          // the mode renders for them. Both kinds PREFER the compute
          // renderer like every fold-shaped session (the kernels'
          // forward-orbit cores, fr-dlxh and fr-7u8t.9); the
          // SURFACE_ESCAPE/SURFACE_BULB GLSL variants are the fallback
          // arms (?surfacegl / no adapter / device loss). No grid for
          // either — the empty-space chain's validity argument is
          // IFS-specific. The order of the two tests below MATTERS only
          // in the sense that the gates are disjoint by construction
          // (a pure fold is not a pure triplex power), so it reads as
          // the eligibility function's own order and nothing more.
          surfaceSessionIs4D = false;
          // fr-tmgf: both shapes are compute-shaped — compute is their
          // home, so a WebGL session says why it passed (null for the
          // deliberate ?surfacegl flag).
          const forwardWebglDetail = (): void => {
            surfaceWebglDetailToken = surfaceWebglDetail({
              computeShaped: true,
              supported: SurfaceComputeRenderer.supported(),
              block: surfaceComputeBlock,
            });
          };
          // Neither forward session ever takes the balloon (fr-5wlv.4 and
          // fr-tdin, both measured: a filled solid's interior reaches the
          // ball center, so its echo swallows the camera — scene.ts nulls
          // the ball and renders plain), so their compute preference
          // stands regardless of the shared toggle, and the panel hides
          // the rows outright rather than leaving them visible-but-inert
          // (fr-5wlv.6, ui.setSurfaceSessionKind).
          //
          // The GROUND PLANE (fr-rhn5) survives where the balloon
          // degenerates, for both — and since neither balloons there is
          // no precedence to resolve here, unlike the IFS compute arm
          // below.
          let R: number;
          if (
            analyzeEscapeSystem(
              state.transforms,
              state.finalTransform ?? null,
              state.symmetry,
            ).status === "eligible"
          ) {
            ui.setSurfaceSessionKind("escape");
            const de = buildEscapeDE(
              state.transforms,
              state.finalTransform ?? null,
              state.symmetry,
            );
            R = de.boundingRadius;
            // fr-17qu: the gate admits shapes whose non-escaping set is
            // EMPTY, and this mode then draws a background gradient with a
            // live progress row and nothing anywhere saying why — the
            // silent-failure class fr-096u's blanked lens settles belong
            // to. A chain whose composite expands too hard escapes on its
            // first pass everywhere: `mbox2 pre-scale 4`, `boxfold6 x3`,
            // and a lone spherefold at any weight (fr-kkb9's shape, which
            // this covers too). Armed here, where the chain length is
            // known; FIRED by the settle, on the evidence below.
            surfaceBlankNotice = () => {
              ui.flashToast(
                de.links.length > 1
                  ? // fr-j231 widened the chain to POWER links and the
                    // wording with it ("weight or scale", not "fold
                    // weight"): a triplex power carries no fold weight,
                    // and its SCALE is the knob that matters. Deliberately
                    // no cross-family special case beyond that — the
                    // closed-form stiffness bound that would have named
                    // the offending link fires across a whole range that
                    // measurably renders (escape-de.ts's POWER LINKS
                    // paragraph), which is fr-17qu's own second-cut lesson.
                    "This chain rendered almost nothing — fewer than one ray in a thousand hit it. Its escape-time set may be empty or too thin to see; try a smaller weight or scale on one of the links."
                  : "This fold rendered almost nothing — fewer than one ray in a thousand hit it. Its escape-time set may be empty or too thin to see; try a smaller fold weight or scale.",
              );
            };
            if (surfaceComputeAvailable()) {
              computeTarget = {
                kind: "escape",
                de,
                groundPlane: state.groundPlane,
              };
              scene.enterSurfaceComputeEscapeSession(
                state.groundPlane,
                de.boundingRadius,
              );
            } else {
              forwardWebglDetail();
              scene.setEscapeSystem(de, escapeSlotColor());
            }
          } else {
            // The Mandelbulb (fr-tdin) — the escape arm one formula over.
            // buildBulbDE throws on a system analyzeBulbSystem refuses,
            // which the eligibility gate has already excluded; the outer
            // catch is the backstop either way.
            ui.setSurfaceSessionKind("bulb");
            surfaceBlankNotice = () => {
              ui.flashToast(
                "This power rendered almost nothing — fewer than one ray in a thousand hit it. Try a smaller scale on the map.",
              );
            };
            const de = buildBulbDE(
              state.transforms,
              state.finalTransform ?? null,
              state.symmetry,
            );
            // NOT the orbit bailout: the bulb's marching ball is its own
            // query-space bound, the one number every radius here wants.
            R = de.boundingRadius;
            if (surfaceComputeAvailable()) {
              computeTarget = {
                kind: "bulb",
                de,
                groundPlane: state.groundPlane,
              };
              scene.enterSurfaceComputeBulbSession(
                state.groundPlane,
                de.boundingRadius,
              );
            } else {
              forwardWebglDetail();
              scene.setBulbSystem(de, escapeSlotColor());
            }
          }
          surfaceGrid.cancel();
          // The explorer camera was framed on the chaos game's cloud —
          // for a non-contracting map that is escape-reset debris near
          // the origin, which sits INSIDE the escape-time solid: the
          // session would open on a featureless interior wall. Glide out
          // to frame the bailout ball instead; the user dives back in
          // from a view that shows the object. (Exactly as true of the
          // Mandelbulb, whose chaos-game cloud is the same debris and
          // whose solid likewise contains the origin — fr-tdin measured
          // 100% of a 0.1R neighbourhood of the centre interior.)
          cameraTween.fitToBounds(
            {
              minX: -R,
              maxX: R,
              minY: -R,
              maxY: R,
              minZ: -R,
              maxZ: R,
              minR: 0,
              maxR: R,
            },
            { fov: scene.camera.fov, aspect: scene.camera.aspect },
          );
        } else {
          surfaceSessionIs4D = false;
          // fr-5wlv.6: an ordinary IFS session — the balloon's live shape,
          // so its controls stay reachable (subject to the 4D/off gates
          // elsewhere).
          ui.setSurfaceSessionKind("ifs");
          const de = buildSurfaceDE(
            state.transforms,
            state.finalTransform ?? null,
            state.symmetry,
          );
          if (surfaceComputeEligible(de)) {
            // The WebGPU compute path (fr-tzdg): no GLSL system upload —
            // the fold variant must never compile here (its ~25s Mesa
            // link / fr-096u entry hazards are what this path removes) —
            // and no grid request: the kernel marches gridless by
            // decision (49µs/ray was measured without it; the fallback
            // re-enter requests one when it routes the WebGL branch).
            // Balloon sessions PREFER compute again since fr-5wlv.5 (the
            // kernels carry the inverted-union wrapper; the GLSL arm
            // remains the ?surfacegl/no-adapter fallback): the flag on
            // the target compiles the wrapper, and the scene stores the
            // same value at enterSurfaceComputeSession so every frame
            // spec attaches the live balloon block — state.balloonEcho
            // is the one source both reads come from, at the same
            // moment.
            //
            // The ground plane (fr-rhn5) yields to an active balloon: the
            // two never compile together (surface-de-gpu.ts's
            // groundPlane+balloon codegen throw), so this is the one
            // place both reads resolve down to a single flag, at the same
            // moment — fed to both the compute target and the scene's
            // stored intent below.
            const groundPlane = state.groundPlane && !state.balloonEcho;
            computeTarget = {
              kind: "ifs",
              de,
              balloon: state.balloonEcho,
              groundPlane,
            };
            scene.enterSurfaceComputeSession(
              de,
              state.balloonEcho,
              groundPlane,
            );
          } else {
            // fr-tmgf: this session runs the WebGL tracer — the progress
            // row says why compute passed, when it did (null for affine
            // systems and the ?surfacegl flag: deliberate choices).
            surfaceWebglDetailToken = surfaceWebglDetail({
              computeShaped: deHasFolds(de) || de.foldFinal !== null,
              supported: SurfaceComputeRenderer.supported(),
              block: surfaceComputeBlock,
            });
            scene.setSurfaceSystem(
              de,
              surfaceSlotColors(state.transforms, de.maps),
              surfaceTrapIndices(state.transforms, de.maps),
            );
            // Kick the empty-space grid build (fr-55r5 part 2). Async and
            // optional: the session renders gridless until it lands, and a
            // superseding session boundary drops it by id. NEVER in
            // balloon mode (fr-5wlv.3's decision): the grid's floors
            // bound the FRACTAL alone, not the union — the shell can be
            // nearer than any floor admits — so balloon marches gridless;
            // the cancel keeps the session-boundary invariant (re-stamp
            // or cancel the outstanding id) so an earlier enter's
            // in-flight build can't land mid-balloon-session.
            if (state.balloonEcho) {
              surfaceGrid.cancel();
            } else {
              surfaceGrid.request(de);
            }
          }
        }
        // The surface balloon (fr-5wlv.4) — 4D since fr-qxxw, so no
        // dimension gate here any more. This stores the live on/rMult
        // pair (the compute frame specs and both fragment tracers' uniforms
        // derive from it); the scene's own gate is what keeps it off where
        // there is no ball to certify against — a forward-orbit session in
        // either dimension nulls that ball, because a filled solid's echo
        // swallows the camera. On the compute route the fragment materials
        // stay untouched by the session, so the uniform write is inert
        // until a fallback re-enter compiles one.
        scene.setSurfaceBalloon(state.balloonEcho, state.balloonRadius);
        // The ground plane (fr-rhn5) — 4D since fr-h0c3, likewise. This
        // stores the live intent; the scene's own gate keeps it off under
        // the balloon variant (the pack layer force-drops the plane define
        // when the balloon lands) and re-asserts it per install, so this
        // needs no `&& !state.balloonEcho`.
        scene.setSurfaceGroundPlane(state.groundPlane);
        // Lighting/color settings + (when the colorSource needs one) the
        // ramp LUT: pushed at entry so a fresh session reflects the
        // persisted SurfaceParams; the control-spec effects keep them live
        // from there.
        scene.setSurfaceParams(state.surface);
        const lut = surfaceColorLUT(state);
        if (lut) scene.setSurfaceColorLUT(lut);
        // Gate the first frame on the tracer's program compile (fr-du81):
        // the fold-frontier variant links in ~25s on desktop Mesa (worse on
        // mobile drivers), and drawing before it is ready would spend that
        // stall INSIDE a frame with the main thread blocked. compileAsync
        // uses KHR_parallel_shader_compile where available; meanwhile
        // animate() keeps showing the live explorer — the same startup-gap
        // choreography as the flame/solid workers' first frame. Both the
        // completion and the render-complete signal (which holding shows /
        // timeline render keyframes depart on) wait for it.
        const token = ++surfaceCompileToken;
        if (computeTarget) {
          beginSurfaceComputeGate(token, computeTarget);
          return {
            post: () => {},
            terminate: () => {
              // Session boundary (exit or re-enter): the renderer, its
              // in-flight frames, and the presentation flags die with the
              // handle — RenderSession calls this before any new start().
              teardownSurfaceCompute();
            },
          };
        }
        scene
          .compileSurfaceMaterial()
          .then(() => {
            if (token !== surfaceCompileToken) return;
            if (state.renderMode !== "surface") return;
            // compileAsync resolves on compile COMPLETION, not success —
            // prove the program draws before declaring the session live
            // (a crashed driver compiler reports only at first use).
            if (!scene.probeSurfaceProgram()) {
              throw new Error("surface tracer program failed to link");
            }
            // Now that the tracer is about to take over the canvas, drop
            // the transform selection (no guide boxes in this mode, so a
            // raycast drag should orbit — the solid session's reasoning).
            // Deferred to HERE rather than activate() because rebuilding
            // guides re-links their programs, and on drivers that
            // serialize compiles (Mesa) the gated explorer's next frame
            // would join the queue BEHIND the multi-second fold compile —
            // the exact stall the gate exists to avoid.
            state = selectTransform(state, null);
            refreshGuides();
            refreshUi();
            surfaceSession.markFirstFrame();
            noteRenderProgress("surface", 1, 1);
            scene.invalidate();
            // First frame without waiting for a camera nudge (fr-yvcw):
            // the invalidate above is one-shot, and any other draw can
            // consume it before the tier clock reads it — 2ca508b's race
            // on this arm. On the fallback re-enter (compute create()
            // failed, or no WebGPU at all) the entry glide already spent
            // itself during the first entry, so no camera motion follows
            // to mask the loss and the session sits on the live explorer
            // frame until a nudge. The pending flag rides the tier read
            // until the preview actually traces — un-losable by
            // construction, and a redundant preview is free.
            surfaceWebglPreviewPending = true;
          })
          .catch((error: unknown) => {
            if (token !== surfaceCompileToken) return;
            if (state.renderMode !== "surface") return;
            console.error(
              "Surface tracer failed to compile; returning to explorer.",
              error,
            );
            showRenderError();
            surfaceSession.exit();
          });
      } catch (error) {
        // Unreachable while the segmented control's gate tracks
        // analyzeSurfaceSystem, but a build failure must fall back to the
        // explorer rather than strand the mode (the flame/solid
        // worker-error contract). Deferred a tick: enter() only stores the
        // handle after start() returns, and exit() has to see it.
        console.error(
          "Surface render failed to build; returning to explorer.",
          error,
        );
        showRenderError();
        queueMicrotask(() => surfaceSession.exit());
      }
      // GLSL sessions have nothing compute-scoped, but a compute route
      // that THREW after enterSurfaceComputeSession lands here too — the
      // teardown (idempotent, a no-op for pure-GLSL sessions) clears the
      // scene's compute flag either way.
      return { post: () => {}, terminate: () => teardownSurfaceCompute() };
    },
    clearNotes: () => {
      // The one surface note (the degraded-march notice) is derived from
      // the DOCUMENT, not the session — refreshSurfaceEligibility owns it,
      // so there is nothing session-scoped to clear.
    },
    resetProgress: () => {
      // Instant render, but the flag must never carry stale-true across
      // sessions (fr-75sq), like the flame/solid resets.
      renderComplete.surface = false;
      renderCoverage.surface = 0; // ...and its fraction form (fr-61a2), like the flame/solid resets.
    },
    activate: () => {
      // NOTE the selection/guide handling other sessions do here happens
      // in the compile gate's resolution instead (see start()): until the
      // tracer program is ready the canvas keeps showing the explorer,
      // which should stay EXACTLY as it was — visually and in program
      // terms, since a guide rebuild's re-links would queue behind the
      // fold compile on serializing drivers.
      // A fresh session must not inherit the previous one's pending settle
      // timer (fr-5ne3), a completed frame's validity (fr-sjff), or a
      // deferred settle verdict (fr-du81). No refreshGuides here either:
      // updateGuides disposes and rebuilds the guide materials, whose
      // re-links the gated explorer's next frame would then JOIN — behind
      // the whole fold compile on serializing drivers. Nothing the guides
      // reflect has changed yet; the compile gate's resolution refreshes
      // them together with the selection drop.
      surfaceRenderTier.reset();
      surfaceWebglPreviewPending = false;
      surfaceSettled = false;
      surfaceSettlePending = false;
      state = setRenderMode(state, "surface");
      trackAutoBackground(); // see the flame session's activate (fr-mz2u)
      refreshUi();
      // The render-complete signal — the budget-met event a holding
      // collection show or timeline render keyframe departs on — fires
      // when the compile gate in start() resolves and marks the first
      // frame, not here: the DE upload is instant, but the tracer program
      // may still be linking (fr-du81).
      if (surfaceSession.hasFirstFrame) noteRenderProgress("surface", 1, 1);
    },
    deactivate: () => {
      // The 4D flag dies with the session (tickRender's surface branch is
      // unreachable once the mode resets, but stale-true costs nothing to
      // preclude). So do in-flight settle/preview strip jobs (fr-sjff /
      // fr-du81) — nothing steps them outside this mode, and a stale
      // planner must not greet the next session.
      scene.abandonSurfaceSettle();
      scene.abandonSurfacePreview();
      // Progress is pose state, not document state (fr-zx34) — a dead
      // session's percent must not greet the next one. Neither must its
      // backend detail token (fr-tmgf).
      ui.setSurfaceProgress(null);
      surfaceWebglDetailToken = null;
      // A grid still building for this session is nobody's business once
      // the session ends — drop it so its late arrival can't touch the
      // next mode's frame (fr-55r5 part 2). The next 3D session's request
      // supersedes by id anyway; this just keeps settle() honest for the
      // offline exporter.
      surfaceGrid.cancel();
      // ...and one that already LANDED but parked behind a capture
      // (fr-p0mr) dies with the session too (fr-vja8.11): tickRender
      // applies whatever is parked in ANY later surface session — AFTER
      // that session's own grid clear — so a stale park would hand e.g. a
      // balloon session the fold grid fr-5wlv.3's gridless rule exists to
      // keep away from the shell.
      pendingSurfaceGrid = null;
      surfaceSessionIs4D = false;
      surface4SlabExact = true;
      ui.setFourDSlabAvailable(true);
      // fr-5wlv.6: a dead session's shape must not greet the next one —
      // the same "session-scoped progress/detail, not document state"
      // reset every other routing flag on this line gets.
      ui.setSurfaceSessionKind(null);
      surfaceBlankNotice = null;
      // Reset only the mode this session owns — see the flame session's
      // deactivate for why this is not a blind write.
      if (state.renderMode === "surface") {
        state = setRenderMode(state, "points");
        trackAutoBackground(); // see the flame session's deactivate (fr-mz2u)
        // Repaint the explorer over the last traced frame (fr-w9wl): the
        // tracer shares the one canvas and the same render-on-demand gate.
        scene.invalidate();
      }
      dropStalePendingThumbnails(); // see the flame session's deactivate (fr-r777)
      refreshUi();
      // A parked offline export's early-exit wake (fr-6jic) — see the flame
      // session's deactivate.
      notifyRenderSignal();
    },
    // The surface twin of the flame session's late-thumbnail correction
    // (fr-r777). This session's first frame is its TRACER coming up — the
    // compile gate resolving, or the compute renderer's create — so a
    // re-capture reads whatever has presented by then, which is exactly the
    // rule captureThumbnail("surface") already follows for a save made here:
    // the last traced frame if there is one, the honest explorer render if
    // there is not.
    onFirstFrame: () => applyPendingThumbnailPatches("surface"),
  });

  // The one path between the render modes (fr-39y): exit whichever
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
      // switch AND for the show's own per-leg re-entry (the mode-hint
      // consumption in applyCloudResult) — both want exactly this hold.
      if (driftShow.active && driftSource === "collection") {
        driftShow.hold();
      } else {
        // Silent (fr-ygr1): an explicit render-mode switch, not an edit
        // reaching in from elsewhere — the user is looking right at the
        // segmented control they just clicked.
        driftPolicy.stop();
      }
      // Timeline playback survives this switch only while HELD (fr-v3au):
      // holding means a render keyframe owns the display — the entry
      // arriving here is the show's own (the leg armed the mode hint
      // and held the schedule at launch), or a manual mid-hold look-around,
      // which survives for the same reason a collection show's does — the
      // render mode is how the keyframe displays, not a reach into the
      // show, and whichever render converges resumes the schedule
      // (noteRenderProgress). During a points phase (a plain keyframe's
      // morph or dwell — not holding), a manual switch away from the
      // explorer still ends playback: there is no deterministic duration
      // for the absolute schedule to hold across an uninvited render
      // (fr-8v41). A STOP like the random drift show's, and silent for the
      // same reason as above. A leg's own applyDecodedSnapshot never
      // reaches here: playback keeps renderMode at "points" between render
      // keyframes, so its switch is the no-op early return.
      if (!timelinePlayer.holding) timelinePolicy.stop();
      // So does the morph (fr-a04l): the flame/solid start commands snapshot
      // the DOCUMENT's system, so snap the display to it — and animate()
      // stops polling the tween during a render, so an unsnapped morph would
      // otherwise resume, stale, on exit.
      snapMorph();
      // And a 4D pose glide (fr-pnek), for the same freeze: the render's
      // worker snapshot reads fourDView.matrix() at enter (see
      // fourDRenderSnapshot), so an in-flight glide must LAND first — the
      // exact mirror of cameraTween.finish() on the flame path in
      // applyCloudResult.
      fourDTween.finish();
    }
    if (state.renderMode === "flame") flameSession.exit();
    else if (state.renderMode === "solid") solidSession.exit();
    else if (state.renderMode === "surface") surfaceSession.exit();
    if (target === "flame") flameSession.enter();
    else if (target === "solid") solidSession.enter();
    else if (target === "surface") surfaceSession.enter();
  }

  /**
   * Enter `target` on behalf of a LOAD rather than the mode control: the
   * flame render freezes the camera into its projection snapshot at enter, so
   * complete any just-started fit glide instantly and push it to the scene
   * camera first; the solid and surface renders keep their camera live and
   * can keep gliding. Two callers, both of them a load that already knows
   * which renderer it wants — a preset's render-mode hint landing with its
   * cloud (applyCloudResult) and the isolation-reload handoff restoring the
   * pre-reload mode at boot — which is why the camera discipline lives here
   * once instead of at each site.
   */
  function enterLoadedRenderMode(target: RenderMode): void {
    if (target === "flame") {
      cameraTween.finish();
      scene.applyCamera(orbit);
    }
    switchRenderMode(target);
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
    // The map count rides along because the editor's derived palette slot
    // (fr-hiyu) is a property of the map's position among ALL the base maps,
    // not of the map itself.
    ui.renderTransformEditor(editing, sel, state.transforms.length);
    refreshSurfaceEligibility();
  }

  /**
   * Keep the Surface mode button's gate tracking the DOCUMENT (epic
   * fr-7jlk). The classification itself — five analyzers, the tracers'
   * uniform caps, and every user-facing sentence — is
   * `surface-eligibility.ts`'s pure `deriveSurfaceEligibility` (fr-dp50),
   * tested over the shipped presets; this wrapper contributes exactly the
   * two live inputs the document cannot answer (the current state and this
   * machine's compute availability) and the ui call. Rides refreshUi — the
   * chokepoint every whole-system edit, snapshot load, and undo/redo
   * funnels through — PLUS direct calls from the drag paths that
   * deliberately skip refreshUi (fr-vja8.10: transform/final geometry
   * sliders, guide-box drags, and the symmetry effects in
   * control-spec.ts), so the button enables/disables live as variations,
   * 4D blocks, scales, weights, or symmetry orders change — mid-drag
   * included, where a stale-enabled button routed a plainly ineligible
   * system into a render-failure toast.
   */
  function refreshSurfaceEligibility(): void {
    const eligibility = deriveSurfaceEligibility(
      state.transforms,
      state.finalTransform ?? null,
      state.symmetry,
      { computeAvailable: surfaceComputeAvailable() },
    );
    ui.setSurfaceEligibility(eligibility.status, eligibility.note);
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
   * `morphSeed` pins the morph's generation seed for a timeline playback
   * leg (fr-8v41; see regenerateReplaced).
   */
  function applyDecodedSnapshot(
    snap: SceneSnapshot,
    refit: boolean,
    morph: boolean,
    morphMs?: number,
    morphSeed?: number,
  ): void {
    // Undo/redo and a gallery load are the user reaching in: both end the
    // drift show (fr-wavo) — this is the one chokepoint on their shared path.
    // Notify (fr-ygr1): the show's own collection legs also pass through
    // here, but under the policy's own-leg guard the stop no-ops before
    // ever reaching the toast — only a genuine undo/redo or manual load
    // actually stops (and announces) anything.
    stopShows({ notify: true });
    switchRenderMode("points");
    // A restored document must not trigger a preset hint armed just before
    // the time travel / gallery load — nor inherit a 4D pose armed for a
    // load it just superseded (fr-pnek; callers that WANT a pose re-arm it
    // right after this returns, mirroring the mode hint). The pose
    // GLIDE is superseded the same way: left alive, a leg's still-flying
    // glide would freeze when this load lands flat (animate()'s 4D block
    // stops advancing it) and then snap its stale pose onto the NEXT
    // non-flat visit. A timeline leg re-arms its own glide right after.
    loadHints.clearAll();
    fourDTween.cancel();
    // The balloon "Inflate" sweep (fr-5wlv.6) is session-only replay motion
    // over a now-superseded document — the user just jumped states, so any
    // in-flight sweep is cancelled exactly like a genuine control edit
    // would (control-spec.ts's cancelBalloonSweep effect), rather than
    // continuing to animate a radius the restored document didn't author.
    balloonSweepStartMs = null;
    // The pre-load display target — the morph's `from` endpoint (a chained
    // restart ignores it and resumes from the live sample; see
    // MorphTween.start). Captured before fromSnapshot replaces the document.
    const morphFrom = currentMorphSystem();
    // Captured for the balloon re-entry check below — fromSnapshot is about
    // to overwrite state.balloonEcho with the restored document's value.
    const previousBalloonEcho = state.balloonEcho;
    // Captured for the ground plane re-entry check below (fr-rhn5), the
    // balloon's own precedent — fromSnapshot is about to overwrite
    // state.groundPlane with the restored document's value.
    const previousGroundPlane = state.groundPlane;
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
      regenerateReplaced(morphFrom, refit, morphMs, morphSeed);
      // The backdrop crossfade (fr-5ps1): fade from the on-screen backdrop
      // to the restored document's over the same duration as the system
      // morph — a timeline/drift leg or gallery load moves the background
      // like everything else. Reduced motion snaps, exactly as
      // regenerateReplaced itself does for the system. An `"auto"` target
      // resolves from the restored document's palette (fr-mz2u) — the morph
      // adopts the target's palette instantly, so the crossfade IS the
      // smooth re-derivation between the two scenes' derived backdrops; a
      // leg that also switches render mode re-derives when that mode lands
      // (trackAutoBackground via the session's activate).
      const target = resolveSceneBackground(state);
      if (
        prefersReducedMotion() ||
        backgroundGradientsEqual(liveBackground, target)
      ) {
        applyBackgroundNow();
      } else {
        backgroundTween.start(
          liveBackground,
          target,
          morphMs ?? MORPH_TWEEN_MS,
          nowMs(),
        );
      }
    } else {
      morphTween.finish();
      regenerate(true, refit);
      // Time travel snaps the backdrop with everything else (mechanical,
      // like the system snap just above).
      applyBackgroundNow();
    }
    scene.setFourDScaffold(null);
    scene.setRenderStyle(state.renderStyle);
    // Mirror onRenderStyle: never leave a stale glow exposure on a non-glow style.
    if (state.renderStyle !== "glow") scene.setGlowExposure(1);
    scene.setPointSize(state.pointSize);
    scene.setFourDDepthFade(state.fourDDepthFade);
    scene.setSolidParams(state.solid);
    // The balloon pair (fr-5wlv.6): pushed unconditionally, like solid
    // above — both scene channels are equality-guarded and inert for
    // whichever renderer isn't active, so there is no harm in keeping both
    // in sync with every load regardless of state.renderMode. A live
    // surface session whose EFFECTIVE balloon on/off just changed needs a
    // full re-enter to pick it up (a variant-level change — SURFACE_BALLOON
    // compile / compute routing / grid on-off — not a uniform write), the
    // same seam the surfaceBalloonCheckbox effect uses
    // (restartSurfaceRender in control-spec.ts). In practice this branch is
    // unreachable HERE today: switchRenderMode("points") above has already
    // exited any active surface session by this point, so state.renderMode
    // is always "points" below — kept anyway as the honest invariant for
    // this function (a surface session entered afterward re-derives the
    // balloon fresh from state regardless of this branch — see
    // surfaceSession's start()).
    scene.setBalloonEchoEnabled(state.balloonEcho);
    scene.setBalloonEchoRadius(state.balloonRadius);
    scene.setSurfaceBalloonRadius(state.balloonRadius);
    // The fog density (fr-5h5d): pushed unconditionally, like the balloon
    // pair just above — a restored document with a non-default density
    // would otherwise render at the scene's default until a Fog edit
    // first moved it.
    scene.setFogDensity(state.fogDensity);
    // Same push for the restored fog tint pair (fr-5h5d), right beside the
    // density it rides with.
    scene.setFogTint(hexToRgb01(state.fogTint), state.fogTintStrength);
    // No unconditional scene push for the restored ground plane (fr-rhn5)
    // here, unlike the balloon/fog pairs above: it has no explorer-mode
    // presence to keep in sync while renderMode is "points" (switchRenderMode
    // above already left it there) — a live surface session's flip is
    // instead covered by the restart condition right below, and a session
    // entered afterward re-derives the floor fresh from state regardless
    // (surfaceSession's own start()), the same balloon precedent noted above.
    if (
      state.renderMode === "surface" &&
      (state.balloonEcho !== previousBalloonEcho ||
        state.groundPlane !== previousGroundPlane)
    ) {
      controlEffects.restartSurfaceRender();
    }
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
   * {@link loadEncodedScene}. When that captured pose carries a 4D half
   * (fr-gq99 — the checkpointed system was non-flat), the rotor/slice come
   * back the same way the gallery load's saved 4D pose does: armed as the
   * pending pose hint, so applyCloudResult lands it with the restored cloud
   * where the fresh-visit reset would otherwise fire — an immediate
   * applyFourDPose here would just be stomped at arrival. A `replaced` step
   * with no captured pose (defensive — the app always supplies one via the
   * EditSession `pose` dep) falls back to auto-fitting the restored attractor.
   */
  function restoreSnapshot(
    snapshot: string,
    replaced: boolean,
    pose?: ViewPose,
  ): void {
    const snap = decodeScene(snapshot);
    if (!snap) return; // can't happen: entries are encodeScene output
    if (replaced && pose) {
      applyDecodedSnapshot(snap, false, false);
      applyCameraPose(pose.camera);
      // Armed AFTER applyDecodedSnapshot, which clears the pose hint on
      // every load's behalf (the render-mode-hint pattern, fr-pnek).
      if (pose.fourD) loadHints.armPose(pose.fourD);
    } else {
      applyDecodedSnapshot(snap, replaced, false);
    }
  }

  /**
   * The live view framing — the orbit camera (fr-1k4) plus, while the
   * displayed system is non-flat, the 4D rotor/slice pose (fr-pnek). The ONE
   * definition of "how this scene is being looked at right now", shared by
   * the persisted document ({@link currentDocument}, whose `camera`/`fourD`
   * fields this deliberately mirrors) and the out-of-band capture onto each
   * undo-history entry (the EditSession `pose` dep below; fr-uf3, fr-gq99).
   */
  function viewPose(): ViewPose {
    return {
      camera: cameraPose(),
      fourD: viewIs4D ? fourDView.pose() : undefined,
    };
  }

  /**
   * The full persistable document: the scene ({@link toSnapshot}) plus the
   * live view framing ({@link viewPose}: camera pose fr-1k4, 4D view pose
   * fr-pnek), so a saved/shared scene (and, crucially, a timeline keyframe,
   * which freezes this exact document) reproduces its tumble orientation and
   * w-slice, not just its 3D framing. Used for the autosave/hash, the
   * collection, share links, and timeline keyframes. Undo-history snapshots
   * deliberately stay camera-less AND pose-less (see SceneSnapshot.camera's/
   * fourD's docs) — that's why `snapshot` below does NOT use this; history
   * carries the same framing OUT OF BAND instead (fr-uf3, fr-gq99).
   */
  function currentDocument(): SceneSnapshot {
    return { ...toSnapshot(state), ...viewPose() };
  }

  // Session-only undo/redo plus the edit-burst / debounced-save policy layered
  // over it (see edit-session.ts). The injected deps are the app's real
  // capabilities: encode and persist the live scene document, apply a restored
  // snapshot (restoreSnapshot above — which must not checkpoint), read the live
  // view pose (captured out of band per history entry, fr-uf3/fr-gq99), reflect
  // undo/redo availability in the UI, and the debounced save-timer itself. Edit
  // handlers call editSession.beginEdit() BEFORE mutating the document; Ctrl+Z/
  // Ctrl+Shift+Z call undo()/redo(); the page-hide handlers below call flush().
  const editSession = new EditSession({
    snapshot: () => encodeScene(toSnapshot(state)),
    persist: () => saveScene(currentDocument()),
    restore: restoreSnapshot,
    // The live view pose — orbit camera (fr-uf3) plus the 4D rotor/slice
    // while non-flat (fr-gq99) — captured out of band onto each history entry
    // so undo/redo across a replace restores the exact framing — never into
    // the snapshot string, which stays camera-less for the dedup.
    pose: viewPose,
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
   * an auto-fit for entries with no stored pose — and the saved 4D view
   * pose when the document carries one (fr-pnek), armed as the pose hint
   * so it lands with the restored cloud (the fresh-visit reset at arrival
   * would stomp an immediate apply; see applyCloudResult). A corrupt entry
   * (decode returns null — can't happen for our own encodeScene output, but
   * the collection is untrusted localStorage) is ignored rather than
   * blanking the current scene; the boolean return says whether the load
   * actually applied, so onLoadFromCollection never arms a render-mode hint
   * (fr-75sq) for a load that never happened.
   */
  function loadEncodedScene(encoded: string): boolean {
    const snap = decodeScene(encoded);
    if (!snap) return false;
    editSession.beginEdit("replace");
    applyDecodedSnapshot(snap, snap.camera === undefined, true);
    if (snap.camera) applyCameraPose(snap.camera);
    // Armed AFTER applyDecodedSnapshot, which clears the pose hint on
    // every load's behalf (the render-mode-hint pattern, fr-pnek).
    if (snap.fourD) loadHints.armPose(snap.fourD);
    return true;
  }

  /**
   * Import a picked or dropped JSON export file (fr-de9t) — the shared sink
   * behind the panel's "⬆ Import file" and the window drop listeners. A
   * `"scene"` file loads through the exact gallery-load path above
   * ({@link loadEncodedScene}: an undoable replace, morphing in, framed by
   * its saved camera pose); a `"collection"` backup merges into the
   * saved-scene library (`SceneCollection.importScenes` — deduped against
   * what's already saved) and opens the gallery so the merge is visible,
   * not just claimed by a toast; a `"timeline"` backup (fr-h9rk) REPLACES
   * the authored timeline wholesale (`TimelineStore.replaceAll` — a
   * sequence isn't mergeable the way a grab-bag collection is), with an
   * Undo toast handing the outgoing sequence back when there was one.
   * The bytes are untrusted
   * (`scene-file.ts`'s `decodeImportFile` is the validation boundary), so
   * every failure lands as a toast, never a throw — including a file too
   * large to be a plausible export, rejected before it is read into memory.
   */
  async function importSceneFile(file: File): Promise<void> {
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      ui.flashToast("That file is too large to import");
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      ui.flashToast("Couldn't read that file");
      return;
    }
    const imported = decodeImportFile(text);
    if (imported === null) {
      // Not our JSON envelope — maybe a flam3/Apophysis .flame file
      // (fr-8uy5). Its decoder is the same kind of never-throwing trust
      // boundary, so trying it on arbitrary text is safe and cheap.
      if (importFlameText(text)) return;
      ui.flashToast("Not a scene, collection, timeline, or .flame file");
      return;
    }
    if (imported.kind === "scene") {
      // decodeImportFile pre-validated the payload, so this load can't
      // actually miss — the guard just keeps loadEncodedScene's contract
      // local instead of trusting it at a distance.
      if (loadEncodedScene(imported.encoded)) ui.flashToast("Scene loaded");
      return;
    }
    if (imported.kind === "timeline") {
      if (imported.steps.length === 0) {
        ui.flashToast("No usable keyframes in that file");
        return;
      }
      // An import is an authoring edit: like every onTimeline* handler it
      // stops a running playback FIRST (a run resolves steps by index at
      // leg time — swapping the sequence under it would desynchronize the
      // show from what it's playing).
      timelinePolicy.stop({ notify: true });
      // Snapshot the outgoing timeline for the Undo toast below (the
      // fr-ifts delete-toast pattern): replaceAll is a wholesale swap, and
      // the replaced sequence may hold the only copy of its scenes
      // anywhere.
      const prevSteps = timeline.all();
      const prevSeed = timeline.seed;
      timeline.replaceAll(imported.steps, imported.seed);
      refreshTimelineUi();
      const n = timeline.size;
      const count = `${n} keyframe${n === 1 ? "" : "s"}`;
      if (prevSteps.length === 0) {
        ui.flashToast(`Timeline imported — ${count}`);
        return;
      }
      ui.flashToast(`Timeline replaced — ${count}`, {
        label: "Undo",
        onAction: () => {
          // The undo is itself a timeline edit — same stop-first rule as
          // the import above (a replay of the imported sequence may
          // already be running by the time the toast is clicked).
          timelinePolicy.stop({ notify: true });
          timeline.replaceAll(prevSteps, prevSeed);
          refreshTimelineUi();
        },
      });
      return;
    }
    if (imported.scenes.length === 0) {
      ui.flashToast("No usable scenes in that file");
      return;
    }
    const added = collection.importScenes(imported.scenes);
    if (added === 0) {
      // Every entry was either already saved or (rarely) too old to survive
      // a full collection's cap eviction — either way, nothing changed.
      ui.flashToast("Nothing new to add from that file");
      return;
    }
    ui.setCollectionCount(collection.size);
    ui.openGallery(collection.all());
    ui.flashToast(
      added === 1 ? "Imported 1 scene" : `Imported ${added} scenes`,
    );
  }

  /**
   * Try `text` as a flam3/Apophysis `.flame` file (fr-8uy5) — the fallback
   * branch of {@link importSceneFile} once the JSON envelope has been ruled
   * out. Returns whether the text WAS a flame file, even an unusable one
   * (the toast then says why nothing loaded and the caller must not fall
   * through to the "not a recognized file" message).
   *
   * One flame loads exactly like an imported scene file
   * ({@link loadEncodedScene}) and then arms the flame render for the
   * arriving cloud — the mode the artifact was authored for, same as a
   * collection entry tagged "flame" (fr-75sq) — re-armed AFTER the load,
   * which clears any stale hint (advanceCollectionLeg orders it the same
   * way). A multi-flame file (an Apophysis batch) merges into the
   * collection tagged mode "flame" instead, so nothing is silently
   * dropped; thumbnails start blank exactly like a JSON backup entry whose
   * thumbnail was stripped. Mapping compromises (dropped posts, unknown
   * variations, …) surface as a toast suffix + the full list on the
   * console — fidelity notes, not errors.
   */
  function importFlameText(text: string): boolean {
    const flame = decodeFlameFile(text);
    if (flame === null) return false;
    if (flame.scenes.length === 0) {
      ui.flashToast("No usable flames in that file");
      return true;
    }
    const suffix = flameNotesSuffix("import", flame.warnings);
    if (flame.scenes.length === 1) {
      const { name, encoded } = flame.scenes[0];
      // decodeFlameFile pre-validated the payload (same guard-not-trust
      // shape as the JSON scene branch above).
      if (loadEncodedScene(encoded)) {
        loadHints.armMode("flame");
        ui.flashToast(`Imported "${name}"${suffix}`);
      }
      return true;
    }
    const now = Date.now();
    const added = collection.importScenes(
      flame.scenes.map((scene, i) => ({
        encoded: scene.encoded,
        // Descending stamps keep the FILE's order in the newest-first
        // gallery: the batch's first flame shows first.
        createdAt: now - i,
        mode: "flame",
        thumbnail: "",
      })),
    );
    if (added === 0) {
      ui.flashToast("Nothing new to add from that file");
      return true;
    }
    ui.setCollectionCount(collection.size);
    ui.openGallery(collection.all());
    ui.flashToast(
      (added === 1 ? "Imported 1 flame" : `Imported ${added} flames`) + suffix,
    );
    return true;
  }

  /** One terse toast suffix for the flame codec's fidelity warnings, with
   * the full list on the console for the curious (fr-8uy5). */
  function flameNotesSuffix(
    direction: "import" | "export",
    warnings: string[],
  ): string {
    if (warnings.length === 0) return "";
    console.info(`[.flame ${direction}]`, warnings);
    return warnings.length === 1
      ? " (1 note — see console)"
      : ` (${warnings.length} notes — see console)`;
  }

  // Drag-and-drop import (fr-de9t): dropping an exported .json anywhere on
  // the page feeds the same sink as "⬆ Import file". preventDefault runs for
  // EVERY file drag, not just ones that turn out to be scene files — the
  // browser's default drop action is navigating to the file, which would
  // discard the whole session over a stray drop. Non-file drags (text
  // selections onto inputs) are left alone.
  window.addEventListener("dragover", (e) => {
    if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
  });
  window.addEventListener("drop", (e) => {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) void importSceneFile(file);
  });

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
    stopShows({ notify: true });
    // Any fresh edit supersedes a preset hint still waiting for its cloud
    // (fr-39y) — onPreset re-arms it right after this returns — and a 4D
    // pose still waiting for its load's cloud (fr-pnek), same staleness.
    loadHints.clearAll();
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
   * applyEdit's DRAG SIBLING (fr-vja8.53) — the one chokepoint for the
   * mid-gesture edit paths (slider drags, the lens sliders, the guide-box
   * drag) that cannot use applyEdit itself: its refreshUi would rebuild the
   * transform editor and tear the dragged slider out from under the pointer.
   * Those paths each used to restate the same bookkeeping tail by hand, and
   * the next hand-rolled copy that forgot refreshSurfaceEligibility would
   * silently reintroduce the stale-Surface-button bug fr-vja8.10 fixed — no
   * test, no error, just a gate reading a document it stopped tracking.
   *
   * Same shape as applyEdit minus what a drag must not do: no refreshUi (the
   * tear above) and no renderTransformEditor here EVER — the guide-box path
   * adds its own rebuild after this returns, which is safe only because that
   * gesture's pointer is on the CANVAS, not on a panel slider. Two more
   * deliberate differences, decided rather than inherited (fr-vja8.53's
   * triage): the pending load hints are NOT cleared — a drag is not a load,
   * and today's drag paths never cleared them (an armed preset hint still
   * fires when its snapped morph's terminal request lands, exactly as
   * before) — and there is no snapMorph, because regenerate() (the
   * scheduled run below) snaps any in-flight morph itself.
   *
   * `applyChange` mutates the document (and pushes any per-path scene
   * geometry, e.g. setGuideGeometry); this wraps it in the shared
   * bookkeeping: show stop, undo checkpoint, transform-list refresh, the
   * Surface gate re-derivation (the one refreshUi output that must not go
   * stale mid-drag), and the auto-update schedule.
   */
  function applyDragEdit(applyChange: () => void): void {
    // Notify (fr-ygr1): a mid-gesture edit is a document edit like any
    // other — it ends a running show, announced.
    stopShows({ notify: true });
    editSession.beginEdit();
    applyChange();
    ui.renderTransformList(
      state.transforms,
      state.selectedTransform,
      state.finalTransform ?? null,
    );
    // The Surface gate reads the DOCUMENT, and a geometry drag can carry it
    // across an analyzer seam (fr-vja8.10) — a scale reaching 1.0 stops
    // contracting mid-drag, and a stale-enabled button then routes a plainly
    // ineligible system into a render-failure toast. This list+gate pair
    // mirrors refreshUi's own tail (with the editor rebuild omitted between
    // them) — an edit to either sequence should visit its twin.
    refreshSurfaceEligibility();
    if (state.autoUpdate) regenScheduler.schedule();
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
        // and refreshUi() syncs the slider/plane controls.
        state = setSymmetryOrder(
          state,
          sys.symmetry?.order ?? DEFAULT_SYMMETRY_ORDER,
        );
        state = setSymmetryPlane(
          state,
          sys.symmetry?.plane ?? DEFAULT_SYMMETRY_PLANE,
        );
        // The twist resets with the rest of the kaleidoscope (fr-q0h6 P6):
        // the order/plane setters spread the previous symmetry, so without
        // this a twist authored before the roll would silently ride into the
        // fresh surprise — a 4D double rotation its quality gate never
        // probed. (Rolled systems never carry one today, so this is always
        // the DEFAULT_SYMMETRY_TWIST reset.)
        state = setSymmetryTwist(
          state,
          sys.symmetry?.twist ?? DEFAULT_SYMMETRY_TWIST,
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
      state = setSymmetryPlane(state, candidate.symmetry.plane);
      state = setSymmetryTwist(state, candidate.symmetry.twist ?? 0);
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
    refreshSurfaceEligibility,
    recolor,
    applyFourDColor,
    restartSolidRender: () => solidSession.enter(),
    restartFlameRender: () => flameSession.enter(),
    restartSurfaceRender: () => {
      if (state.renderMode === "surface") surfaceSession.enter();
    },
    applyBackground: applyBackgroundNow,
    trackAutoBackground,
    cancelBalloonSweep: () => {
      balloonSweepStartMs = null;
    },
  };

  // Every simple scalar control (slider/select/checkbox bound to one state
  // field) shares the one pipeline in onScalarControl below, driven by
  // control-spec.ts's SCALAR_CONTROLS table. Its `view` guard replaces the
  // old per-handler viewIs4D checks — belt-and-braces for controls whose row
  // is hidden in the other view (color mode/contrast, depth style, the 4D
  // color/fade — symmetry left the guarded set with fr-q0h6 P6, live in both
  // views), so a stray event can't mutate a concern that isn't even on
  // screen. Everything that edits the system, loads a preset/
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
        // The final-transform lens (fr-7u8t.5, PRESET_FINALS): a preset
        // authored AROUND a plot-time lens installs it, and — the half
        // that is a bug fix — every other preset CLEARS it. A preset load
        // is a whole-system replacement, so a lens left over from the
        // previous one would silently re-pose the arriving attractor, and
        // for the escape-time / Mandelbulb presets would take their render
        // mode away outright (both gates refuse a final transform, so the
        // Surface button would just go dark).
        state = setFinalTransform(state, PRESET_FINALS[preset]?.() ?? null);
        // The kaleidoscope a preset was composed under (fr-za0n,
        // PRESET_SYMMETRIES) — the same shape as the lens above, and the
        // same both-directions rule: a preset that IS its symmetry
        // (foldChainFlower) installs it, and every other preset turns it
        // OFF. A leftover kaleidoscope would replicate the arriving system
        // into copies it was never composed with, and for the escape-time /
        // Mandelbulb presets would take their render mode away outright
        // (analyzeBulbSystem refuses any order above 1; analyzeEscapeSystem
        // refuses one that rotates into 4D). Order goes first so
        // setSymmetryTwist's cap — twist <= order - 1 — sees the new order,
        // and the twist is cleared unconditionally: no table entry may carry
        // one, and a stale one is exactly what makes a symmetry non-flat.
        const symmetry = PRESET_SYMMETRIES[preset];
        state = setSymmetryOrder(
          state,
          symmetry?.order ?? DEFAULT_SYMMETRY_ORDER,
        );
        state = setSymmetryPlane(
          state,
          symmetry?.plane ?? DEFAULT_SYMMETRY_PLANE,
        );
        state = setSymmetryTwist(state, 0);
        // The flame palette a preset was composed against (fr-7u8t.5,
        // PRESET_PALETTES) — set, never cleared: absent means "the user's
        // palette is fine", which is every preset that predates the table.
        const palette = PRESET_PALETTES[preset];
        if (palette) state = setFlamePaletteId(state, palette);
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
      loadHints.armMode(PRESET_RENDER_HINTS[preset] ?? null);
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
    // (syncMotionAvailability), and the guard here covers a preference flip
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
      // Starting the ambient show ends a running timeline playback — with
      // the toast (fr-ygr1): the user is looking at the Drift toggle, not
      // the timeline's lit Play button (fr-8v41).
      timelinePolicy.stop({ notify: true });
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
        stopShows({ notify: true });
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
      stopShows({ notify: true });
      editSession.beginEdit();
      state = setCustomPaletteStops(state, stops);
      ui.updateLabels(state);
      const palette = resolvePalette(CUSTOM_PALETTE_ID, state.customPalette);
      if (state.flame.paletteId === CUSTOM_PALETTE_ID)
        flameSession.post({ type: "setPalette", palette });
      if (state.solid.paletteId === CUSTOM_PALETTE_ID)
        solidSession.post({ type: "setPalette", palette });
      // The surface tracer's LUT bakes whichever palette its colorSource
      // samples — the surface palette (orbit trap, rings, or sheets —
      // fr-rl4b's rings/sheets ride the same paletteId as the orbit trap) or
      // the explorer ramp (height/radius) — so re-upload it whenever the
      // edited gradient is the one it currently samples (fr-ibcm). Pure
      // uniforms: the change lands next frame, mid-render, with nothing to
      // restart.
      const surfaceSource = state.surface.colorSource;
      if (
        ((surfaceSource === "palette" ||
          surfaceSource === "rings" ||
          surfaceSource === "sheets") &&
          state.surface.paletteId === CUSTOM_PALETTE_ID) ||
        ((surfaceSource === "height" || surfaceSource === "radius") &&
          state.rampPaletteId === CUSTOM_PALETTE_ID)
      ) {
        const lut = surfaceColorLUT(state);
        if (lut) scene.setSurfaceColorLUT(lut);
      }
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
      // The `"auto"` backdrop tracks a custom-gradient drag live (fr-mz2u)
      // whenever the active render's palette selects the edited gradient —
      // trackAutoBackground's own guards make this free otherwise.
      trackAutoBackground();
    },
    // The axis-color pickers (fr-8k7) are a bespoke widget like the gradient
    // editor: undo checkpoint + debounced save, reducer, label sync, then a
    // recolor over the cached run — never a regenerate. No worker forward:
    // the flame/solid renders snapshot the colors at entry, and the pickers
    // are unreachable while a render is active (the explorer block hides).
    onPositionAxisColors: (colors) => {
      // Notify (fr-ygr1): an axis-color-picker edit, same bucket as any
      // other document edit.
      stopShows({ notify: true });
      editSession.beginEdit();
      state = setPositionAxisColors(state, colors);
      ui.updateLabels(state);
      if (state.colorMode === "position") recolor();
    },
    // Custom backdrop pickers (fr-5ps1): the same shape as the axis colors
    // above — one undo checkpoint per drag burst (beginEdit coalesces),
    // then an instant push to every renderer. No worker forward: the
    // backdrop is composited scene-side in every mode.
    onBackgroundCustom: (custom) => {
      stopShows({ notify: true });
      editSession.beginEdit();
      state = setBackgroundCustom(state, custom);
      ui.updateLabels(state);
      applyBackgroundNow();
    },
    // Fog tint color (fr-5h5d): the color half of the atmosphere pair, the
    // same shape as the backdrop pickers above — one undo checkpoint per
    // drag burst, then an instant push to every renderer fog reaches. The
    // strength half rides the table-driven onScalarControl pipeline
    // instead (control-spec.ts's fogTintStrength entry).
    onFogTint: (hex) => {
      stopShows({ notify: true });
      editSession.beginEdit();
      state = setFogTint(state, hex);
      ui.updateLabels(state);
      scene.setFogTint(hexToRgb01(state.fogTint), state.fogTintStrength);
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
      stopShows({ notify: true });
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
            // A showcase write never touches the user's checkbox, so the help
            // box's motion wording is told separately (fr-k9nx) — the
            // updateLabels below repaints it.
            ui.setFourDTumbleActive(true);
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
    // "Inflate" (fr-5wlv.2, surface entry point fr-5wlv.6): animate the
    // balloon's radius from a crumpled near-center ball out to its rest
    // size — tickLogic's absolute-time poll pushes the sweep every frame
    // while balloonSweepStartMs is set, in BOTH points and surface modes.
    // Turns the balloon on first if it wasn't already, mirroring the
    // checkbox effects' own enabled(+radius) push (control-spec.ts), so a
    // click from off plays the whole sweep instead of silently jumping
    // straight to rest — the explorer and surface checkboxes share this
    // same on-first behavior via the mode-appropriate path below. Session-
    // only view motion, like auto-orbit: no undo checkpoint, no stopShows
    // (the balloon pair's OWN persistence, fr-5wlv.6, still applies at
    // whatever the sweep is left resting on, via the next ordinary edit's
    // debounced save — this handler itself just never cuts one).
    onBalloonInflate: () => {
      if (!state.balloonEcho) {
        state = setBalloonEcho(state, true);
        if (state.renderMode === "surface") {
          // Variant-level change, exactly like the surfaceBalloonCheckbox
          // effect (control-spec.ts): re-enter the session so it
          // recompiles/reroutes with the balloon on, rather than writing a
          // uniform the active variant doesn't carry.
          controlEffects.restartSurfaceRender();
        } else {
          scene.setBalloonEchoEnabled(true);
          scene.setBalloonEchoRadius(state.balloonRadius);
        }
        ui.updateLabels(state);
      }
      if (prefersReducedMotion()) {
        balloonSweepStartMs = null;
        state = setBalloonRadius(state, DEFAULT_BALLOON_RADIUS);
        scene.setBalloonEchoRadius(state.balloonRadius);
        scene.setSurfaceBalloonRadius(state.balloonRadius);
        ui.updateLabels(state);
        return;
      }
      balloonSweepStartMs = nowMs();
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
    // stays the render's, which is what the save meant — and fr-r777 comes
    // back once that render's first frame lands and re-photographs the entry,
    // so the gap costs a briefly-wrong picture rather than a permanent one.
    onSaveToCollection: () => {
      const encoded = encodeScene(currentDocument());
      const gapMode = thumbnailGapMode();
      const entry = collection.add(
        encoded,
        captureCurrentThumbnail(),
        state.renderMode === "points" ? undefined : state.renderMode,
      );
      if (gapMode) {
        notePendingThumbnailPatch("collection", entry.id, gapMode, encoded);
      }
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
      // Same mutual exclusion as onDriftToggle: the slideshow ends a
      // running timeline playback, with the toast (fr-8v41).
      timelinePolicy.stop({ notify: true });
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
    // Animation timeline (fr-8v41). Authoring edits (add/remove/move/
    // retime) act on the persistent TimelineStore and re-render the
    // section — and each one stops a running playback FIRST: the run
    // captured its schedule at start and launchTimelineLeg resolves steps
    // by index at leg time, so editing under it would desynchronize the
    // show from the sequence it's playing. Those stops notify (fr-ygr1):
    // mid-playback the panel is the user reaching in from a control that
    // isn't the lit Play toggle. While nothing is playing they no-op, like
    // every policy stop.
    onTimelineAddKeyframe: () => {
      timelinePolicy.stop({ notify: true });
      // A keyframe added from a flame/solid render is tagged with that mode
      // (fr-v3au) — the same capture rule as onSaveToCollection's (fr-75sq):
      // playback re-enters the renderer and holds until it converges. And the
      // same first-frame-gap correction (fr-r777).
      const encoded = encodeScene(currentDocument());
      const gapMode = thumbnailGapMode();
      const step = timeline.add(
        encoded,
        captureCurrentThumbnail(),
        state.renderMode === "points" ? undefined : state.renderMode,
      );
      // The store refuses at cap rather than evicting part of an authored
      // sequence (timeline.ts) — say so instead of silently doing nothing.
      if (!step) {
        ui.flashToast(`Timeline is full (${TIMELINE_CAP} keyframes)`);
        return;
      }
      if (gapMode) {
        notePendingThumbnailPatch("timeline", step.id, gapMode, encoded);
      }
      refreshTimelineUi();
      ui.flashToast("Keyframe added");
    },
    // ▶ Play / ■ Stop. The stop branch is silent (fr-ygr1): the explicit
    // toggle itself, the user is looking right at it — mirroring
    // onDriftToggle. The reduced-motion/empty guards cover a click racing
    // the disabled-state sync, like the drift toggle's own guard.
    onTimelinePlayToggle: () => {
      if (timelinePlayer.active) {
        timelinePolicy.stop();
        return;
      }
      // An offline export owns the player for its whole pending span
      // (fr-vja8.12). Pre-run (the encoder-probe gap) a plain run started
      // here would make startOfflineExport's raced-show guard abandon the
      // export the user just asked for; post-run (the encode flush) it
      // would start against a virtual clock nothing advances until the
      // export's finally unwinds it. Either way the click loses to the
      // export in flight — swallow it.
      if (offlineExportPending) return;
      if (prefersReducedMotion() || timeline.size === 0) return;
      startTimelinePlayback(false);
    },
    // ⏺ Export clip: the same playback run with the recorder rolling
    // (fr-8v41) — whatever ends the run also stops the recorder, so the
    // clip downloads (see timelineExporting). If a manual recording is
    // already running, adopt it rather than toggling it off — the run's
    // end will finalize it exactly the same way. On the REALTIME path,
    // render keyframes in the sequence (fr-v3au) make the clip run longer
    // than the authored total — each one records its render converging for
    // however long that takes on this device — so the cap warning below
    // fires on what is then only a floor; the recorder's own cap still
    // cuts an overlong run honestly. The offline path instead parks its
    // clock through convergence (fr-6jic), so there the authored total is
    // exact.
    onTimelineExport: () => {
      // While an offline export runs (fr-92t9), the button is the cancel
      // affordance: stop the show and the driver saves the partial clip.
      // During the pre-playback probe gap the stop no-ops — the click just
      // can't double-start (offlineExportPending gates below).
      if (offlineExportPending) {
        timelinePolicy.stop();
        return;
      }
      if (
        timelinePlayer.active ||
        prefersReducedMotion() ||
        timeline.size === 0
      ) {
        return;
      }
      const steps = timeline.all();
      if (timelineDurationMs(steps) > MAX_RECORDING_SECONDS * 1000) {
        ui.flashToast(
          `Clips cap at ${formatElapsed(MAX_RECORDING_SECONDS)} — the end will be cut off`,
        );
      }
      // Frame-exact offline export (fr-92t9) whenever WebCodecs can encode
      // it — render keyframes included (fr-6jic): their legs park the
      // driver's virtual clock while the flame/solid render converges and
      // capture only the converged still for the step's holdMs. A run
      // started with a manual recording already rolling keeps the realtime
      // MediaRecorder capture (it owns the canvas stream — adopt it, as
      // before); so does a browser without an encodable H.264 config.
      if (offlineExportSupported() && !recorderActive) {
        void startOfflineExport();
        return;
      }
      startTimelinePlayback(true);
      if (!recorderActive) recorder.toggle();
    },
    onTimelineRemoveStep: (id) => {
      timelinePolicy.stop({ notify: true });
      const steps = timeline.all();
      const at = steps.findIndex((s) => s.id === id);
      if (at === -1) return; // raced double-click — nothing to remove.
      const step = steps[at];
      timeline.remove(id);
      refreshTimelineUi();
      // Undo (the collection delete's fr-ifts pattern): a removed keyframe
      // may be the only copy of its scene anywhere — the live document has
      // long since moved on — so the toast hands the exact step back to
      // TimelineStore.restore at its old index.
      ui.flashToast("Keyframe removed", {
        label: "Undo",
        onAction: () => {
          timeline.restore(step, at);
          refreshTimelineUi();
        },
      });
    },
    onTimelineMoveStep: (id, delta) => {
      timelinePolicy.stop({ notify: true });
      timeline.move(id, delta);
      refreshTimelineUi();
    },
    onTimelineStepTiming: (id, timing) => {
      timelinePolicy.stop({ notify: true });
      timeline.setTiming(id, timing);
      refreshTimelineUi();
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
        loadHints.armMode(entry.mode);
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
    // The file counterpart of Copy link (fr-de9t): the SAME document bytes —
    // camera pose included — wrapped in the JSON file envelope instead of a
    // URL, for keeping scenes where a link doesn't fit (archives, email
    // attachments, version control).
    onSaveSceneFile: () => {
      const text = encodeSceneFile(encodeScene(currentDocument()), Date.now());
      triggerDownload(
        new Blob([text], { type: "application/json" }),
        `fractal-scene-${Date.now()}.json`,
      );
      ui.flashToast("Scene file saved");
    },
    // flam3/Apophysis interop (fr-8uy5): the system's XY shadow as a .flame
    // file (flame-file.ts; docs/flame-interop.md). Projection compromises —
    // 3D/4D structure, x/y-axis kaleidoscopes — surface exactly like the
    // import path's notes: a toast suffix + the console list.
    onSaveFlameFile: () => {
      const stamp = Date.now();
      const { xml, warnings } = encodeFlameFile(
        currentDocument(),
        `fractal-${stamp}`,
      );
      triggerDownload(
        new Blob([xml], { type: "application/xml" }),
        `fractal-${stamp}.flame`,
      );
      ui.flashToast(`Flame file saved${flameNotesSuffix("export", warnings)}`);
    },
    // The collection's escape hatch from this browser profile (fr-de9t):
    // everything the gallery holds — encoded scenes, mode tags, thumbnails —
    // as one JSON backup file importSceneFile can merge back anywhere.
    onExportCollection: () => {
      // The button disables at zero, but guard the race anyway (a delete
      // landing between the last count sync and this click).
      if (collection.size === 0) return;
      const text = encodeCollectionFile(collection.all(), Date.now());
      triggerDownload(
        new Blob([text], { type: "application/json" }),
        `fractal-collection-${Date.now()}.json`,
      );
      const n = collection.size;
      ui.flashToast(n === 1 ? "Exported 1 scene" : `Exported ${n} scenes`);
    },
    // The timeline's own escape hatch (fr-h9rk) — the collection backup's
    // exact pattern one section over: the authored sequence (steps,
    // timings, render-mode tags) PLUS its determinism seed, as one JSON
    // file the shared import sink restores anywhere. Carrying the seed
    // means the restored timeline replays — and video-exports — the same
    // morphs, not just the same scenes.
    onExportTimeline: () => {
      // The button disables at zero, but guard the race anyway (an edit
      // landing between the last renderTimeline sync and this click).
      if (timeline.size === 0) return;
      const text = encodeTimelineFile(
        timeline.all(),
        timeline.seed,
        Date.now(),
      );
      triggerDownload(
        new Blob([text], { type: "application/json" }),
        `fractal-timeline-${Date.now()}.json`,
      );
      const n = timeline.size;
      ui.flashToast(
        n === 1 ? "Exported 1 keyframe" : `Exported ${n} keyframes`,
      );
    },
    onImportFile: (file) => {
      void importSceneFile(file);
    },
    onSavePng: () => {
      // One capture at a time (fr-7mfx): the modal's scrim blocks the
      // button once it is up, but the grace period leaves a window where a
      // second press would start a second export over the first.
      if (exportProgress.active) return;
      // Recording pins 1x: a hi-res capture resizes the shared canvas
      // mid-stream, which MediaRecorder capture doesn't survive (the flame
      // branch never resizes, so it's exempt).
      void savePng(recorderActive ? 1 : state.exportScale);
    },
    onExportCancel: () => {
      exportProgress.requestCancel();
    },
    onExportDeliverEarly: () => {
      exportProgress.requestDeliverEarly();
    },
    onSelect: (index) => {
      state = selectTransform(state, index);
      refreshGuides();
      refreshUi();
    },
    onTransformGeometry: (index, geometry) => {
      // A panel-slider transform edit: the drag chokepoint owns the
      // bookkeeping (fr-vja8.53); this path adds only its own guide push.
      applyDragEdit(() => {
        state = updateTransform(state, index, geometry);
        scene.setGuideGeometry(index, geometry);
      });
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
      // A panel-slider final-transform edit — the gate tracks lens edits
      // too (fr-vja8.10): a near-zero scale, a non-fold variation or a w
      // block on the final all move the analyzers.
      applyDragEdit(() => {
        state = setFinalTransform(state, { id: 0, ...geometry });
      });
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
      // A manual switch outranks a preset hint still waiting for its cloud —
      // and drops a 4D pose waiting for one (fr-pnek): whatever load armed
      // it, the user just reached in over it.
      loadHints.clearAll();
      switchRenderMode(mode);
    },
    // Slice state is session-only view state (like the tumble clock): it never
    // touches AppState or persistence AS STATE — though a snapshot of it rides
    // the saved document as part of the 4D pose (fr-pnek, currentDocument) —
    // so these write straight to fourDView and re-upload the slice trio to
    // the scene (see pushFourDSlice). Each first cancels an in-flight pose
    // glide and drops a pending pose (releaseFourDPoseControl): the glide
    // re-applies its slice fields every frame, and the pending pose would
    // re-stomp at arrival — the user's hand wins, same as a camera grab
    // cancelling cameraTween.
    onFourDSliceToggle: (checked) => {
      releaseFourDPoseControl();
      fourDView.sliceOn = checked;
      pushFourDSlice();
    },
    onFourDSliceInput: (value) => {
      releaseFourDPoseControl();
      fourDView.sliceCenter = value;
      pushFourDSlice();
    },
    // Slab thickness (fr-wa6o) is the one slice field with NO point-cloud
    // meaning — the cloud's own slice is a fixed-width Gaussian — so it
    // deliberately skips pushFourDSlice(). Its only consumer is the 4D
    // surface tracer, which animate()'s per-frame setSurface4View push picks
    // it up from on the very next frame.
    onFourDSliceThicknessInput: (value) => {
      releaseFourDPoseControl();
      fourDView.sliceThickness = value;
    },
    onFourDSliceRelColorToggle: (checked) => {
      releaseFourDPoseControl();
      fourDView.sliceRelColor = checked;
      pushFourDSlice();
    },
    // Tumble pause/resume + speed (fr-woc): also session-only view state, no
    // save — animate() reads these fields off fourDView directly every frame,
    // so there is nothing else to push here. The toggle goes through
    // setTumbleUserChoice (not a bare tumbleOn write) so the choice is sticky
    // across fresh-visit resets (fr-g98).
    onFourDTumbleToggle: applyFourDTumbleToggle,
    onFourDTumbleSpeedInput: (value) => {
      fourDView.tumbleSpeed = value;
    },
    // Auto-orbit pause/resume + speed (fr-1yn): the 3D siblings of the tumble
    // handlers above, same session-only pattern — the toggle also records the
    // sticky user choice resetAutoOrbitView() honors (fr-g98).
    onAutoOrbitToggle: applyAutoOrbitToggle,
    onAutoOrbitSpeedInput: (value) => {
      autoOrbitSpeed = value;
    },
    // The surface preview tier under user control (fr-37c6). Off takes
    // effect IMMEDIATELY: a preview already grinding is abandoned and the
    // full render starts now — the flip is itself the skip, just sticky.
    // On re-invalidates so a parked view previews (and then settles)
    // fresh rather than waiting for the next camera nudge.
    onSurfacePreviewToggle: (checked) => {
      surfacePreviewsEnabled = checked;
      updateViewerPrefs({ surfacePreview: checked });
      if (!checked) skipSurfacePreviewNow();
      else scene.invalidate();
    },
    onSurfaceSkipPreview: () => {
      skipSurfacePreviewNow();
    },
  });

  const gestures = attachInteractions(scene, orbit, {
    selectedTransform: selectedBox,
    frozen: () => state.renderMode === "flame",
    onTransformChange: (index, geometry) => {
      // A guide-box drag is a system edit (unlike a camera drag): it ends
      // the drift show like every other undoable edit (fr-wavo), through
      // the same drag chokepoint as the panel sliders (fr-vja8.53).
      applyDragEdit(() => {
        state = updateTransform(state, index, geometry);
      });
      // This path alone re-renders the panel editor so its numbers track
      // the dragged box — safe here and ONLY here among the drag paths,
      // because this gesture's pointer is on the canvas, not on a panel
      // slider the rebuild would tear out from under it.
      ui.renderTransformEditor(
        state.transforms[index],
        index,
        state.transforms.length,
      );
    },
    fourDView: () => viewIs4D,
    onFourDRotate: ({ xw, yw, zw }) => {
      if (!viewIs4D) return; // belt-and-braces, same as the ui handlers
      // Flame/solid froze the rotor into their worker snapshot
      // (fourDRenderSnapshot); a gesture mutating it mid-render would change
      // nothing on screen (animate() skips setRot4 while rendering) and then
      // surface as a surprise orientation jump on exit. `frozen` already
      // blocks all drags during the flame render; the solid render keeps its
      // camera gestures live, so the w-plane gesture needs this gate. The 4D
      // surface session's pose is LIVE (fr-vxoj — tickRender pushes it every
      // frame), so the gesture stays live there; gate on the session flag,
      // not the mode, so a 3D surface session (doc drifted 4D mid-session)
      // still blocks the invisible mutation.
      if (state.renderMode !== "points" && !surfaceSessionIs4D) return;
      // Grabbing the rotor cancels a pose glide / pending pose (fr-pnek) —
      // the user's hand wins, same as a camera grab cancelling cameraTween.
      releaseFourDPoseControl();
      fourDView.rotate(xw, yw, zw);
      // animate() pushes fourDView.matrix() next frame; nothing else to do.
    },
    // The [ / ] keys' gate: the points-mode cross-section checkbox OR a
    // live 4D surface session, where the slice is intrinsic — the tracer
    // renders the w = w0 slice/slab regardless of the checkbox, the panel
    // shows the slider unconditionally there, and gating on the checkbox
    // alone left the keys dead in the one mode where the slice always
    // means something (wave-5 review finding).
    fourDSliceOn: () => fourDView.sliceOn || surfaceSessionIs4D,
    // The [ / ] keys (fr-vja8.37): the slice slider's own handler logic —
    // pose-control release, center write, push — plus the panel sync the
    // slider never needs (it IS the panel; a key nudge must reflect back
    // into it or the slider goes stale until the next reopen).
    onFourDSliceNudge: (delta) => {
      releaseFourDPoseControl();
      fourDView.sliceCenter = Math.max(
        -1,
        Math.min(1, fourDView.sliceCenter + delta),
      );
      pushFourDSlice();
      syncFourDSliceUi();
    },
    // Space (fr-vja8.37): the same toggle logic as the panel checkboxes —
    // never a bare flag flip — with ui.setAutoMotionToggle standing in for
    // the DOM-side recording the checkbox change listener does before its
    // handler fires (checkbox, row visibility, help-box flag; deliberately
    // NOT the fresh-visit reset methods, which would stomp a chosen speed).
    onToggleAutoMotion: () => {
      // Points mode only (wave-5 review finding): the renders park the
      // auto-motion and HIDE its checkbox rows (fr-osgs), so a Space here
      // would flip the sticky choice and rewrite the persisted pref with
      // zero visible effect — surfacing as a surprise motion start on mode
      // exit and seeding every future reload. The neighbouring
      // onFourDRotate carries its own version of this gate.
      if (state.renderMode !== "points") return;
      if (viewIs4D) {
        const on = !fourDView.tumbleOn;
        ui.setAutoMotionToggle(true, on);
        applyFourDTumbleToggle(on);
      } else {
        const on = !autoOrbitOn;
        ui.setAutoMotionToggle(false, on);
        applyAutoOrbitToggle(on);
      }
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
  // Same push for the restored backdrop (fr-5ps1): the scene constructs on
  // the dark default, so a document restored with haze/custom would render
  // dark until the Background select first moved.
  applyBackgroundNow();
  // Same push for the restored balloon pair (fr-5wlv.6): the scene
  // constructs with the echo off / the surface balloon at its own default
  // radius, so a document restored with the balloon on would render
  // without it (or at the wrong size) until a balloon control first moved.
  // Both channels pushed unconditionally like setSolidParams above — the
  // boot render mode is always "points" (renderMode is never persisted),
  // so setSurfaceBalloonRadius is inert here until a later surface entry,
  // which re-derives the on/off flag itself from state.balloonEcho.
  scene.setBalloonEchoEnabled(state.balloonEcho);
  scene.setBalloonEchoRadius(state.balloonRadius);
  scene.setSurfaceBalloonRadius(state.balloonRadius);
  // Same push for the restored fog density (fr-5h5d): the scene constructs
  // at density 1, so a document restored with a non-default value would
  // render at the wrong density until a Fog edit first moved it.
  scene.setFogDensity(state.fogDensity);
  // Same push for the restored fog tint pair (fr-5h5d), right beside the
  // density it rides with.
  scene.setFogTint(hexToRgb01(state.fogTint), state.fogTintStrength);
  // Boot generation runs SYNCHRONOUSLY (generateSync) even though every later
  // regeneration goes through the worker (fr-5kx): the first paint should
  // include the cloud, not an empty backdrop for a worker round-trip — and
  // the inline delivery sets `viewIs4D` for a possibly-restored non-flat
  // scene before the refreshGuides()/resetAutoOrbitView() reads just below,
  // which need it current, not defaulted to `false`.
  // Capped (fr-t3gl): the sync path exists for first paint, not for the
  // full density — see BOOT_SYNC_MAX_POINTS. bootParams is built ONCE so the
  // async upgrade below reuses the same seed — the PINNED boot seed
  // (fr-chj9), so a pose-less document's auto-frame lands on the same
  // camera every load.
  const bootParams = { ...cloudParams(false, false), seed: BOOT_SEED };
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
  // The 4D sibling (fr-pnek): a restored non-flat scene reapplies the tumble
  // orientation + w-slice it was saved with. AFTER the synchronous boot
  // generation above — its inline arrival runs the fresh-visit reset this
  // apply must land on top of, not under. Applied directly rather than via
  // the pose hint: the async density upgrade below is replaced:false, so
  // arming the pending pose here would leave it dangling for whatever
  // UNRELATED replaced request comes first (a preset click minutes later).
  // A pose paired with a flat scene (hand-crafted document) is ignored,
  // matching currentDocument never writing one for a flat system.
  if (saved?.fourD && viewIs4D) {
    applyFourDPose(saved.fourD);
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
  // The cross-origin-isolation reload's handoff (fr-su3r). On GitHub Pages a
  // first-ever visit necessarily loads non-isolated, and register-sw.ts
  // reloads it once as soon as the service worker takes control. Whatever the
  // user authored inside that window comes back through the document above —
  // but `renderMode` is session-only (state.ts) and would not, so a preset's
  // render-mode hint or a manual mode switch chosen in there used to vanish
  // with nothing to blame: the restore is a plain scene load, so the hint
  // never re-fires. The page wrote its mode out on the way into the reload
  // (see onBeforeIsolationReload at the end of main) and this reads it back,
  // exactly once — a consume CLEARS, so no later load can re-arm it and no
  // ordinary boot is affected. Applied HERE, after the boot cloud and the
  // camera framing above, for the same reason the preset hint waits for its
  // cloud: flame freezes the camera into its projection at enter and needs
  // the framing settled first.
  const isolationHandoff = consumeIsolationHandoff();
  if (isolationHandoff) enterLoadedRenderMode(isolationHandoff.renderMode);

  // Drift and timeline playback are unavailable under reduced motion — no
  // motion means no show (fr-wavo, fr-8v41): both toggles disable
  // themselves with an explanation rather than silently doing nothing
  // (timeline AUTHORING stays available — adding keyframes isn't motion).
  // Tracked live, so flipping the OS preference mid-session both disables
  // the toggles and ends a running show immediately (DriftPolicy.advance's
  // leg-boundary check is the belt-and-braces for engines that never fire
  // the change event).
  const reducedMotionQuery = window.matchMedia?.(
    "(prefers-reduced-motion: reduce)",
  );
  function syncMotionAvailability(): void {
    const available = !prefersReducedMotion();
    ui.setDriftAvailable(available);
    ui.setTimelineAvailable(available);
    // Silent (fr-ygr1): the reduced-motion availability sync itself.
    if (!available) stopShows();
  }
  syncMotionAvailability();
  reducedMotionQuery?.addEventListener("change", syncMotionAvailability);

  // Boot-time render of the timeline section (fr-8v41): the store loaded
  // whatever the last session authored; every later edit re-renders through
  // the same helper.
  refreshTimelineUi();

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
   * and let the frame rate be whatever it is), a flame render is showing
   * (a frozen still exerts no per-frame GPU pressure worth reacting to, and
   * SHOULD display at full resolution), or the surface render is active
   * (the preview/settle tier owns its cost — fr-5ne3 — and the settled
   * still must display at full resolution; the ladder would fight the tier,
   * and render-on-demand starves it of the step-up samples it needs to
   * recover, parking stills blurry). The governed points/solid modes have
   * their own version of that same starvation (fr-vxbo): interaction can
   * stop with the scale stepped down, and render-on-demand then produces no
   * more frames to sample at all — so the `!rendered` branch below tracks
   * quiet time since the last rendered frame and calls
   * resolutionGovernor.idleRestore to snap a parked still back to full once
   * that quiet stretch runs long enough.
   */
  function governResolution(now: number, rendered: boolean): void {
    if (
      !state.adaptiveResolution ||
      recorderActive ||
      state.renderMode === "flame" ||
      state.renderMode === "surface"
    ) {
      if (resolutionGovernor.scale !== 1) {
        resolutionGovernor.reset();
        scene.setResolutionScale(1);
      }
      lastGovernedFrameMs = null;
      lastRenderedFrameAtMs = null;
      return;
    }
    if (!rendered) {
      lastGovernedFrameMs = null;
      if (lastRenderedFrameAtMs !== null) {
        const restored = resolutionGovernor.idleRestore(
          now - lastRenderedFrameAtMs,
        );
        if (restored !== null) {
          scene.setResolutionScale(1);
          // Same quiet trace as the ladder step below, so a parked still
          // snapping back to full is just as visible in a bug report.
          console.info(
            `Adaptive resolution: render scale ×${restored} (idle restore)`,
          );
          lastRenderedFrameAtMs = null;
        }
      }
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
    lastRenderedFrameAtMs = now;
  }

  function animate(): void {
    requestAnimationFrame(animate);
    // While an offline export runs (fr-92t9), its driver owns the ticking —
    // stepping tickLogic/tickRender below on the VIRTUAL clock, one exported
    // frame at a time, awaiting each frame's generation between the two.
    // This loop running as well would double-tick every state machine
    // against a second clock, so it stands aside entirely; it keeps
    // scheduling itself, which is also how it resumes the moment the export
    // ends.
    if (offlineExport !== null) return;
    const now = nowMs();
    tickLogic(now);
    tickRender(now, false);
  }

  /**
   * The animate loop's LOGIC phase (split out for fr-92t9): everything that
   * decides WHAT this frame shows — camera/pose tween advance, the panel
   * inset ease, the morph sample (which issues this frame's generation
   * request), the drift/timeline show polls (which may launch a leg or
   * finish a run), and the balloon "Inflate" sweep (fr-5wlv.6 — absolute-
   * time motion like the tweens above, mode-independent so it reaches both
   * the explorer and a live surface session). The realtime loop runs it
   * back-to-back with {@link tickRender}; the offline export driver runs it
   * at each frame's virtual time and AWAITS the generator settling in
   * between, so the frame's own sample — not the previous frame's — is what
   * gets rendered and encoded.
   */
  function tickLogic(now: number): void {
    cameraTween.advance();
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
    // The backdrop crossfade (fr-5ps1): same once-per-frame poll as the
    // morph sample above, same clock (nowMs — so the offline export's
    // virtual steps drive it deterministically). The terminal sample lands
    // exactly on the target document's backdrop.
    const backgroundSample = backgroundTween.sample(now);
    if (backgroundSample) {
      pushBackground(backgroundSample.gradient);
      // An `"auto"` derivation can move while the crossfade flies — a
      // render-mode switch landing mid-fade re-points the palette it tracks
      // (fr-mz2u). trackAutoBackground skips while the tween is active, so
      // the landing sample re-checks here and settles any drift.
      if (backgroundSample.final) trackAutoBackground();
    }
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
    if (driftShow.frame()) driftPolicy.advance(launchDriftLeg);
    // The timeline playback (fr-8v41): same conductor pattern as the drift
    // show above (and the same after-the-morph-poll ordering rationale) —
    // when a leg comes due, load that keyframe under the own-leg guard;
    // when the run's schedule completes, finish the playback (un-light the
    // toggle, stop an export run's recorder so the clip downloads). Also
    // polled above the render modes' early returns on purpose: a run
    // holding on a render keyframe (fr-v3au) lives THROUGH the flame/solid
    // still, and its resumed departure must fire from inside that mode —
    // the leg's own applyDecodedSnapshot is what exits back to points. At
    // most one of the two shows is ever active, and between events this
    // poll is one comparison (timeline-player.ts).
    const timelineEvent = timelinePlayer.frame();
    if (timelineEvent) {
      if (timelineEvent.kind === "leg") {
        timelinePolicy.advance(() => launchTimelineLeg(timelineEvent.index));
      } else {
        finishTimelinePlayback();
      }
    }
    // The balloon's "Inflate" replay (fr-5wlv.2, surface fr-5wlv.6): while a
    // sweep is running, ease its radius from MIN_BALLOON_RADIUS up to the
    // rest target over BALLOON_SWEEP_MS. Lives HERE rather than in
    // tickRender (fr-5wlv.6 moved it) because it keys off ABSOLUTE time
    // (now - balloonSweepStartMs) exactly like the tween samples above, not
    // a per-mode render dt — and tickLogic runs unconditionally every frame
    // where tickRender's per-mode branches early-return, so one poll here
    // covers both points and surface (and costs nothing in flame/solid,
    // where the balloon has no renderer to reach anyway). Direct reducer +
    // scene calls, not the onScalarControl pipeline (this is session-only
    // replay motion, not a user edit — no undo checkpoint, no save, and
    // critically it can never reach the control-spec.ts effects that call
    // cancelBalloonSweep, or the sweep would cancel itself every tick).
    // Both scene channels are pushed every tick — setBalloonEchoRadius for
    // the explorer echo, setSurfaceBalloonRadius for the surface balloon —
    // each equality-guarded and inert for whichever renderer isn't active,
    // exactly the same "push both, let the setters no-op" idiom as
    // applyDecodedSnapshot's load-time push; the surface compute path reads
    // the scene's stored rMult from its own per-frame spec, so this is the
    // complete set with nothing extra to wire for that path. No tier
    // changes needed for the surface march during a sweep (fr-5wlv.1's
    // analysis): a sweeping frame is a PREVIEW under the budget-capped
    // rungs the interaction tier already uses, and settle only ever arms
    // once the view (and now the radius) is parked — the sweep's own
    // motion keeps invalidating the frame exactly like a camera drag does.
    // The rest pose fits the full-tier budget (fr-5wlv.1 measured mandelbox-
    // lens p95 131 steps < the 160-step full-tier cap), so an unattended
    // Inflate click always settles cleanly; only a user who manually PARKS
    // the slider mid-sweep on a lens monster (fr-5wlv.1's early-inflation
    // transient, p95 215 steps at R=0.35rho) can reach a settle whose
    // deepest creases exhaust the budget — disclosed as softer detail
    // there, never a watchdog exposure (the bounded strip pump owns that
    // safety regardless of how expensive the frame gets).
    if (balloonSweepStartMs !== null) {
      const t = (now - balloonSweepStartMs) / BALLOON_SWEEP_MS;
      if (t >= 1) {
        balloonSweepStartMs = null;
        state = setBalloonRadius(state, DEFAULT_BALLOON_RADIUS);
      } else {
        const u = t * t * (3 - 2 * t); // smoothstep easing
        state = setBalloonRadius(
          state,
          MIN_BALLOON_RADIUS +
            (DEFAULT_BALLOON_RADIUS - MIN_BALLOON_RADIUS) * u,
        );
      }
      scene.setBalloonEchoRadius(state.balloonRadius);
      scene.setSurfaceBalloonRadius(state.balloonRadius);
      ui.updateLabels(state);
    }
  }

  /**
   * The animate loop's RENDER phase (split out for fr-92t9): the per-mode
   * scene painting plus everything display-side that rides it — the motion
   * dt tick (auto-orbit / 4D tumble), glow exposure, the build replay's
   * reveal, and the adaptive-resolution governor. `force` is the offline
   * export driver's flag: render-on-demand would skip a visually-identical
   * dwell frame, but the encoder needs a painted canvas for every
   * timestamp — and the governor is skipped on those forced frames (the
   * export pinned the scale to 1, and "frame time" between virtual steps
   * measures nothing the ladder should react to).
   */
  /**
   * One step of automatic 4D pose motion. While a timeline leg's pose glide
   * is in flight (fr-pnek) it owns the rotor — the tumble stands aside
   * instead of composing on top and jittering the approach — and the slice
   * uniforms follow the glide's per-frame center lerp; the tumble resumes
   * on the frame after the glide lands (fourDView.tick is a no-op while
   * paused). Shared by the explorer's 4D frame path and the 4D surface
   * render's live-pose push (fr-vxoj) — the two per-frame consumers of the
   * pose, each pushing to its own shader afterwards.
   */
  function advanceFourDPose(dt: number): void {
    if (fourDTween.active) {
      fourDTween.advance();
      pushFourDSlice();
      // The frame the glide lands on: reflect the arrived slice in the
      // panel controls. The per-frame lerp above deliberately skips the
      // UI (the panel is closed during playback), but the LANDING must
      // not leave it stale for when the panel reopens — the arrival-side
      // sync (applyFourDPose via the pending pose hint) only covers legs
      // whose cloud landed after the glide had already finished.
      if (!fourDTween.active) syncFourDSliceUi();
    } else {
      fourDView.tick(dt);
    }
  }

  /**
   * The fr-zx34 verdict's legibility affordance: honest coverage of the
   * in-flight preview/settle, so the user — not a prediction — decides
   * whether a heavy pose is worth the wait. Called every surface tick on
   * both paths; null hides the row (instant renders and settled frames,
   * the common case). Compute settles — and compute previews that outrun
   * their wall budget at the floor rung (fr-ud7n) — feed it from
   * onProgress ray tallies; the label's backend token (fr-tmgf) says
   * which engine owns the session — WebGPU compute vs the WebGL tracer.
   */
  function syncSurfaceProgress(): void {
    // The label's backend token is fr-tmgf's minimal cut: after a day of
    // silently software-rendered sessions, "which engine is this?" must
    // not require the console breadcrumb.
    if (surfaceComputeRenderer !== null) {
      // Compute sessions: onProgress ray tallies feed the row, from the
      // settle and from the preview loop's unbudgeted completion pass
      // (fr-ud7n) alike. Budgeted previews still never reach it — bounded
      // work needs no disclosure, and at 2s the first onProgress would
      // barely fire before the frame did, flickering the row through every
      // drag. The preview wins the tie: while a superseded settle is still
      // noticing its cancel(), the preview is the trace actually running.
      const preview = surfaceComputePreviewProgress;
      const fraction = preview ?? surfaceComputeSettleProgress;
      if (fraction === null) {
        ui.setSurfaceProgress(null);
        return;
      }
      // "(software)" rides the engine token (fr-tmgf): a SwiftShader-class
      // adapter must not read as the real GPU; the warning note carries
      // the full story.
      const engine = surfaceComputeRenderer.software
        ? "WebGPU (software)"
        : "WebGPU";
      ui.setSurfaceProgress({
        label: `${preview !== null ? "Preview" : "Full detail"} · ${engine}`,
        // fr-vpbq's supersampling passes, disclosed the way fr-tmgf's
        // engine reason is — TRAILING, so the coverage percentage stays
        // the prominent read. Silent through pass 1, which is the frame
        // this row has always described; from pass 2 it says why the
        // percentage is still climbing under an image that already looks
        // finished.
        detail:
          preview === null &&
          surfaceComputeSettleSample !== null &&
          surfaceComputeSettleSample > 1
            ? `antialiasing pass ${String(surfaceComputeSettleSample)}/${String(SURFACE_COMPUTE_SETTLE_SAMPLES)}`
            : undefined,
        pct: formatRenderPercent(fraction),
        // The fr-37c6 Skip button, on the engine the bead's own comment
        // said it would never show on: a completion pass is a preview
        // with a full render to skip TO, which is the whole rule.
        skippable: preview !== null,
      });
      return;
    }
    const progress = scene.surfaceRenderProgress();
    if (progress === null) {
      ui.setSurfaceProgress(null);
      return;
    }
    const pct = formatRenderPercent(progress.fraction);
    // The trailing detail token (fr-tmgf) says why compute passed on a
    // fold system — "compute unavailable" / "compute failed" — and stays
    // absent when WebGL is the natural engine. Trailing, so the engine
    // token and percentage keep the prominent read. A grinding preview is
    // skippable (fr-37c6): the Skip button rides the row exactly while
    // there is a full render to skip TO — never during settles.
    // fr-jf9y: the strip arm's supersampling passes, disclosed exactly as
    // the compute arm's are (fr-vpbq) — trailing, silent through pass 1,
    // and BEHIND the engine-reason token when both apply, since why this
    // session is on WebGL at all outranks which pass it is on. `fraction`
    // already spans the whole sequence, so the percentage stays monotone
    // instead of resetting eight times.
    const detail = [
      surfaceWebglDetailToken,
      progress.phase === "settle" && progress.sample > 1
        ? `antialiasing pass ${String(progress.sample)}/${String(progress.samples)}`
        : null,
    ]
      .filter((token): token is string => token !== null)
      .join(" · ");
    ui.setSurfaceProgress({
      label:
        progress.phase === "preview"
          ? "Preview · WebGL"
          : "Full detail · WebGL",
      pct,
      detail: detail === "" ? undefined : detail,
      skippable: progress.phase === "preview",
    });
  }

  function tickRender(now: number, force: boolean): void {
    if (state.renderMode === "solid") {
      // Unlike the flame's frozen view, the volume is world-space: keep
      // applying the live orbit camera so the user can keep looking around
      // while accumulation converges.
      scene.applyCamera(orbit);
      const renderedSolid = scene.needsRender || recorderActive || force;
      if (solidSession.hasFirstFrame) {
        if (renderedSolid) scene.renderSolid();
      } else {
        // Keep showing the live explorer (fog + point cloud) until the
        // worker's first grid lands, avoiding a flash of an empty volume
        // during the worker startup gap.
        scene.updateFog();
        if (renderedSolid) scene.render();
      }
      if (!force) governResolution(now, renderedSolid);
      return;
    }
    if (state.renderMode === "surface") {
      // The DE is world-space like the solid volume: live orbit camera. The
      // first-frame gate only matters for the (unreachable-in-practice)
      // failed-build window — the uniforms are uploaded synchronously in
      // enter() — but keeping it preserves the sessions' shared contract.
      scene.applyCamera(orbit);
      // A 4D session's rotor + w-slice stay LIVE too (fr-vxoj): advance the
      // tumble/glide and push the pose every frame — the one funnel that
      // keeps slice-slider drags, rotor gestures, and timeline pose glides
      // live in-mode with zero per-control wiring (setSurface4View's
      // equality guard keeps render-on-demand honest). The early return
      // below skips the shared viewIs4D block, so this branch owns its own
      // motion dt, exactly like that block's (clamped for the same
      // backgrounded-tab reason).
      if (surfaceSessionIs4D) {
        const dt4 = Math.min((now - lastMotionTickMs) / 1000, 0.1);
        lastMotionTickMs = now;
        // The ambient tumble PARKS in surface mode (fr-osgs): every tick
        // would invalidate the frame, pinning the tier scheduler in
        // preview so the settle never arms — on non-trivial systems not
        // even the preview completes between ticks. Directed pose glides
        // (timeline legs) stay live — they are finite, and the settle
        // arms the moment one lands — and user motion (Shift-drag rotor,
        // slice slider) still flows through setSurface4View below. The
        // user's tumble preference is untouched; the projection view
        // resumes it on exit. The panel hides the tumble controls
        // in-mode (ui.ts's syncFourDViewRows).
        if (fourDTween.active) advanceFourDPose(dt4);
        // A capture owns the tracer's uniforms (fr-p0mr): pushing a live
        // rotor/w-slice between two pump calls of a drain would trace the
        // frame's remaining rows at a DIFFERENT hyperplane from the ones
        // already written, and the export would be a PNG split across two
        // poses. The pose itself keeps advancing — a timeline leg runs on
        // an absolute schedule, so pausing it here would desync every leg
        // after it — and only the PUSH waits; the first tick past the
        // export sends whatever pose the glide actually reached.
        if (!surfaceCaptureFlight) {
          scene.setSurface4View(
            fourDView.matrix(),
            fourDView.sliceCenter,
            // fr-rsp6: sessions whose fold set breaks segment exactness
            // clamp the fr-wa6o thickness to 0 (the row is hidden too).
            surface4SlabExact ? fourDView.sliceThickness : 0,
          );
        }
      }
      // A grid the worker delivered while a capture held the tracer
      // (fr-p0mr) lands on the first tick that owns the uniforms again —
      // before this frame's arms, so nothing traces half-gridded.
      if (!surfaceCaptureFlight && pendingSurfaceGrid !== null) {
        const grid = pendingSurfaceGrid;
        pendingSurfaceGrid = null;
        applySurfaceGrid(grid);
      }
      if (surfaceSession.hasFirstFrame) {
        // The interaction tier split (fr-5ne3; strips fr-sjff): an
        // invalidated frame traces the cheap preview immediately — a
        // drag's first tick can never hitch on a full trace — and once the
        // view has been quiet for TIER_SETTLE_MS the full-quality frame
        // renders as an INTERRUPTIBLE strip job spread across animation
        // frames, sharpening the parked preview progressively; any fresh
        // invalidation abandons it and previews instead. Offline-export
        // frames (force) bypass the scheduler — they run on the virtual
        // clock and are keepsakes, always full (renderSurface's full tier
        // strips synchronously, so even those submissions stay bounded).
        // A recorder repaint of a PARKED view re-presents the settled
        // image when one exists (a re-trace would spend seconds of GPU on
        // an identical frame) and repaints the preview otherwise; a
        // recorded drag captures the preview frames the user actually
        // saw.
        if (surfaceCaptureFlight) {
          // A Save-PNG capture owns the tracer (fr-7mfx). It yields so its
          // modal can paint and its Cancel can be clicked, which means
          // this tick runs DURING the export — and every arm below would
          // fight it (the compute arms open with renderer.cancel(); the
          // strip arms re-size the target being drained and overwrite the
          // frozen full-tier uniforms). The progress sync still runs so
          // the in-panel row clears: while the modal is up, IT owns the
          // disclosure, and a stale "Full detail 43%" behind the scrim
          // would outlive the job it described.
          syncSurfaceProgress();
        } else if (surfaceComputeRenderer) {
          // The WebGPU compute path (fr-tzdg): async bounded-pass frames
          // instead of scissor strips — same tier clock, same
          // preview/settle choreography, presented through the shared
          // blit. The strip machinery below never arms in this mode.
          surfaceComputeTick(now, force);
          syncSurfaceProgress();
        } else if (force) {
          scene.abandonSurfaceSettle();
          surfaceSettled = false;
          surfaceSettlePending = false;
          scene.renderSurface("full");
        } else {
          const tier = surfaceRenderTier.frame(
            now,
            scene.needsRender || surfaceWebglPreviewPending,
          );
          if (tier === "preview") {
            scene.abandonSurfaceSettle();
            surfaceSettled = false;
            surfaceSettlePending = false;
            if (!surfacePreviewsEnabled) {
              // Previews off (fr-37c6): the pane freezes on its last
              // frame while the view moves — consume the invalidation so
              // the tier clock can quiet, and let the settle below
              // develop the new pose over the held image once it fires.
              surfaceWebglPreviewPending = false;
              scene.clearRenderNeeded();
            } else if (scene.surfacePreviewActive) {
              // Latest-wins COALESCING (fr-nl32) — kickSurfaceComputePreview's
              // rule, which the strip path never got. renderSurface("preview")
              // ARMS a fresh job, discarding the in-flight one's partial, so
              // on a renderer where a preview spans frames every invalidation
              // killed the job before it could present: a continuous drag
              // painted NOTHING for its whole duration, while the row read
              // "Preview · WebGL 0%" and previewActive stayed true (measured
              // under SwiftShader at 100ms move cadence: 6s of drag, the
              // canvas byte-identical at every 300ms sample — the tier's
              // "every move traces a quick preview" promise delivering the
              // opposite of a preview).
              //
              // Step the job instead and leave the invalidation LATCHED —
              // nothing but the arm below consumes scene.needsRender — so the
              // next job arms at the freshest camera, exactly as the compute
              // loop re-reads its `pending` after each completed frame. Pose
              // coherence is free here: armSurfacePreview snapshots the
              // camera into uniforms (setSurfaceFrameUniforms), so a job that
              // spans frames traces ONE pose rather than tearing across the
              // gesture. A device that finishes a preview inside its arming
              // call — every healthy GPU on a fold-free system — never
              // reaches this branch, and behaves exactly as before.
              scene.stepSurfacePreview();
            } else {
              surfaceWebglPreviewPending = false;
              scene.renderSurface("preview");
            }
          } else {
            // The settle verdict fires on the tier clock, but on systems
            // whose previews span frames (fr-du81's strip jobs) the
            // preview may still be mid-flight — let it finish first: it
            // is the cheapest route to a COMPLETE image of the parked
            // view, and beginning the full-resolution job now would both
            // abandon that progress and seed itself from a partial.
            if (tier === "full") surfaceSettlePending = true;
            if (scene.surfacePreviewActive) scene.stepSurfacePreview();
          }
          // The !surfaceSettleActive guard exists for the skip path
          // (fr-37c6): a skip inside the TIER_SETTLE_MS window begins the
          // settle at once, and the clock's own late "full" verdict must
          // not restart the running job it was a duplicate of.
          if (
            !scene.surfacePreviewActive &&
            surfaceSettlePending &&
            !scene.surfaceSettleActive
          ) {
            surfaceSettlePending = false;
            // With previews off there is no preview of this pose to seed
            // from — hold the target's own last settled frame instead.
            scene.beginSurfaceSettle(
              surfacePreviewsEnabled ? "preview" : "hold",
            );
          }
          syncSurfaceProgress();
          if (scene.surfaceSettleActive) {
            if (scene.stepSurfaceSettle()) {
              // The WebGL arm's half of the blank-frame notice (fr-7k0o).
              // Same question, same units and the same five conditions as
              // the compute arm's (see runSurfaceComputeSettle): the first
              // settle only, and only a frame that FINISHED — which here is
              // what a true return means, the strip settle having no cost
              // ceiling to truncate against. The coverage fraction comes
              // off the alpha flag the tracer writes, counted in the
              // readback the supersampling accumulator already pays for.
              const firstSettle = !surfaceSettled;
              surfaceSettled = true;
              const drawn = scene.surfaceCoveredFraction;
              if (
                firstSettle &&
                surfaceBlankNotice &&
                drawn !== null &&
                drawn < SURFACE_BLANK_HIT_FRACTION
              ) {
                surfaceBlankNotice();
              }
            }
          } else if (recorderActive && !scene.surfacePreviewActive) {
            // Previews off: no re-trace — captureStream freezes on the
            // last painted frame, which is exactly what the pane shows.
            if (surfaceSettled) scene.presentSettledSurface();
            else if (surfacePreviewsEnabled) scene.renderSurface("preview");
          }
        }
      } else {
        scene.updateFog();
        if (scene.needsRender || recorderActive || force) scene.render();
      }
      // The preview/settle tier owns surface-mode cost, so the resolution
      // ladder takes its flame-style restore path here (see
      // governResolution) — the settled still displays at full resolution.
      if (!force) governResolution(now, false);
      return;
    }
    if (state.renderMode === "flame") {
      // Keep drawing the frozen explorer view (already-applied camera, no
      // further orbit input while the flame render is active) until the
      // worker's first image lands, then switch over — avoids a flash of the
      // flame canvas's stale contents during the worker startup gap.
      if (flameSession.hasFirstFrame) {
        if (scene.needsRender || recorderActive || force) scene.renderFlame();
      } else {
        if (scene.needsRender || recorderActive || force) scene.render();
      }
      // Flame mode takes governResolution's restore path (frozen stills
      // display at full resolution); rendered is moot there.
      if (!force) governResolution(now, false);
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
    // The timeline's twin (fr-v3au), with one more condition: a timeline
    // hold starts at the render keyframe's LAUNCH (launchTimelineLeg), so
    // holding-in-points is also the leg's ordinary morph and the terminal
    // request's in-flight gap — phases where the mode hint is still
    // armed for the render this hold awaits. Only once it has been consumed
    // (the render entered, then exited early: Back, or a worker error) does
    // a points-mode hold mean the completion signal is never coming —
    // resume, so the schedule dwells the step's own holdMs on the points
    // cloud now showing and the show goes on (the drift stance above).
    if (timelinePlayer.holding && loadHints.mode === null) {
      timelinePlayer.resume();
    }
    // One clamped dt for both kinds of automatic motion (4D tumble / 3D
    // auto-orbit — mutually exclusive by viewIs4D). Clamp it: a backgrounded
    // tab suspends RAF (and a render's early returns skip this path
    // entirely), and an unclamped catch-up delta would violently snap the
    // orientation on refocus/exit.
    const dt = Math.min((now - lastMotionTickMs) / 1000, 0.1);
    lastMotionTickMs = now;
    if (
      !viewIs4D &&
      autoOrbitOn &&
      !gestures.gestureActive() &&
      !cameraTween.poseGliding
    ) {
      // Turntable (fr-1yn): a slow rightward-drag-signed theta advance,
      // before applyCamera so it lands on this frame. Pure camera motion —
      // no RNG, no regenerate, no save (camera is never persisted).
      // Paused while the user's hand is on the canvas (same theta a drag
      // writes); composes freely with the auto-fit tween (radius/target) —
      // but NOT with a timeline leg's pose glide (fr-8v41), the one camera
      // motion that owns theta itself, so it pauses for that too.
      orbit.spherical.theta -= dt * AUTO_ORBIT_RATE * autoOrbitSpeed;
    }
    scene.applyCamera(orbit);
    scene.updateFog();
    if (viewIs4D) {
      // Advance the pose and push the rotor every 4D frame, paused or not —
      // 16 floats/frame is nothing and it keeps one code path.
      // lastMotionTickMs (above) still advances while paused, so resuming
      // doesn't replay the gap as a jump. The point color re-derives
      // in-shader from the new rotation, so nothing else needs updating per
      // frame.
      advanceFourDPose(dt);
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
    const rendered = scene.needsRender || recorderActive || force;
    if (rendered) scene.render();
    if (!force) governResolution(now, rendered);
  }
  // Service-worker registration closes the boot (fr-su3r moved it inside
  // main): the isolation reload discards this page, so it is handed a
  // callback that captures what the reloaded one cannot recover on its own —
  // a flush so the document in the hash is the CURRENT one rather than
  // whatever survived the save debounce, and the session-only render mode
  // this boot's consumeIsolationHandoff reads back. Wiring it here rather
  // than at module scope is what puts `state`/`editSession` in reach; the
  // registration itself is unaffected by the later call, since register-sw
  // schedules its own work off `load` (or immediately, when it already knows
  // this page is about to reload for isolation).
  registerServiceWorker({
    onUpdateAvailable: showUpdateBanner,
    onBeforeIsolationReload: () => {
      editSession.flush();
      saveIsolationHandoff({ renderMode: state.renderMode });
    },
  });

  // fr-opgk: `?surfacestate`'s read-only settle disclosure — see
  // SurfaceStateProbe. Installed last so every piece of state it closes
  // over exists; the query survives the isolation reload with the rest of
  // the URL, so a script that asked for it keeps it.
  if (new URLSearchParams(window.location.search).has("surfacestate")) {
    window.__surfaceState = () => ({
      mode: state.renderMode,
      engine:
        state.renderMode !== "surface"
          ? null
          : surfaceComputeRenderer !== null
            ? "compute"
            : "webgl",
      firstFrame: surfaceSession.hasFirstFrame,
      settled: surfaceSettled,
      settlePending: surfaceSettlePending,
      previewActive:
        surfaceComputeRenderer !== null
          ? surfaceComputePreviewFlight || surfaceComputePreviewPending
          : scene.surfacePreviewActive,
      settleActive:
        surfaceComputeRenderer !== null
          ? surfaceComputeSettleFlight
          : scene.surfaceSettleActive,
    });
  }

  // fr-d6g5: `?surfacetrace` opts the compute renderer's frame loop into
  // per-frame tracing (setSurfaceComputeTrace) — a capped ring buffer plus
  // a live console.debug feed, so a wedged frame's stuck await shows up
  // without shipping the instrumentation to every render. Diagnostics
  // only, off unless the URL asks, same convention as ?surfacestate above.
  if (new URLSearchParams(window.location.search).has("surfacetrace")) {
    const traceLog: string[] = [];
    setSurfaceComputeTrace((line) => {
      traceLog.push(line);
      if (traceLog.length > 6000) traceLog.splice(0, traceLog.length - 6000);
      console.debug(`[surfacetrace] ${line}`);
    });
    window.__surfaceTraceLog = traceLog;
  }

  // fr-fniy: `?surfacemarchchunk=N` / `?surfacemarchsteps=S` /
  // `?surfaceshadehits=H` pin the compute frame loop's three sizing dials so
  // each one's cost can be priced against the width it runs at,
  // independently of the estimate that normally picks that width — the
  // discriminating experiment fr-2ojg's own record demands of any per-unit
  // cost claim. Diagnostics only, same URL convention as ?surfacetrace
  // above; see setSurfaceComputeSchedulePins.
  {
    const params = new URLSearchParams(window.location.search);
    const pin = (name: string): number | null => {
      const raw = params.get(name);
      const n = raw === null ? NaN : Number.parseInt(raw, 10);
      return Number.isFinite(n) && n >= 1 ? n : null;
    };
    setSurfaceComputeSchedulePins({
      marchChunk: pin("surfacemarchchunk"),
      marchSteps: pin("surfacemarchsteps"),
      shadeHits: pin("surfaceshadehits"),
    });
  }

  animate();
}

main();
