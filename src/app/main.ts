import type { ChaosGameResult } from "../fractal/chaos-game";
import type { ChaosGame4Result } from "../fractal/chaos-game-4d";
import { toTransform4 } from "../fractal/affine4";
import { wSupport } from "./rotor4";
import { FourDView, viewTransition } from "./four-d-view";
import {
  buildColors,
  buildColors4,
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
import type { CloudRequest, CloudResult } from "./cloud-worker-core";
import { glowExposure } from "./exposure";
import {
  defaultFinalTransform,
  PRESET_RENDER_HINTS,
  PRESET_SCAFFOLDS,
  presetTransforms,
} from "../fractal/presets";
import { randomSystem } from "../fractal/random-system";
import { BOOT_CAMERA_POSITION, OrbitCamera } from "./orbit";
import { FOUR_D_SLICE_WIDTH, FractalScene } from "./scene";
import { attachInteractions } from "./interactions";
import { registerServiceWorker } from "./register-sw";
import { Ui } from "./ui";
import { EditSession, SAVE_DEBOUNCE_MS } from "./edit-session";
import { RenderSession } from "./render-session";
import { createCanvasRecorder, formatElapsed } from "./recorder";
import {
  addTransform,
  DEFAULT_SYMMETRY_AXIS,
  DEFAULT_SYMMETRY_ORDER,
  initialState,
  removeTransform,
  selectTransform,
  setFinalTransform,
  setPanelOpen,
  setRenderMode,
  setSymmetryAxis,
  setSymmetryOrder,
  setTransforms,
  systemIsNonFlat,
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
import { SceneCollection } from "./collection";
import { MOBILE_BREAKPOINT } from "./constants";
import type { Vec4 } from "../fractal/types";
import { CameraTween, fourDFramingBounds } from "./camera-tween";
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

  const recorder = createCanvasRecorder(scene.canvas, {
    onStateChange: (recording) => {
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

  // The most recently ARRIVED chaos-game run (cached by applyCloudResult), so
  // a color-mode change can recolor the existing cloud (see `recolor`) instead
  // of re-rolling the RNG and drawing a brand-new random sample of the
  // attractor. While a generation is in flight (fr-5kx) this still holds the
  // cloud actually on screen — exactly what its readers want.
  let lastResult: ChaosGameResult | null = null;

  // Whether the DISPLAYED cloud is the 4D projection view — a DERIVED
  // property of the system that produced it (fr-bf6; see state.ts's
  // systemIsNonFlat), not a mode the user enters/exits. Written only by
  // applyCloudResult when a generation lands (fr-5kx), so it always matches
  // what is on screen — during the brief in-flight window after an edit flips
  // flatness, the view (material, guides, gestures) deliberately stays with
  // the old cloud until the new one arrives. animate()'s tumble tick, the
  // interactions predicate, and guide-box suppression all read it.
  let viewIs4D = false;

  // The most recent 4D chaos-game run — mirrors `lastResult` for the 3D path,
  // so a whole-system replacement (preset load / Surprise Me) can auto-frame
  // the camera on it right after regenerate() lands a fresh run (see
  // fitCameraToAttractor). Null whenever the view isn't showing 4D.
  let fourDResult: ChaosGame4Result | null = null;

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

  // Shared frame clock for the explorer path's automatic motion (the 4D
  // tumble and the 3D auto-orbit). Advances every explorer frame — paused,
  // dragging, or not — so resuming never replays the gap as a jump; it
  // simply doesn't tick during flame/solid renders (animate() returns
  // early), which the dt clamp in animate() absorbs on exit.
  let lastMotionTickMs = performance.now();

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
  // tumble running at default speed, slice off — the baseline itself, plus the
  // reduced-motion seeding, lives in FourDView.reset) and push it to the scene
  // + UI. Now that "4D" is a property of the system rather than a mode, this
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
  // opt-in there) at default speed. Fires from regenerate() on the mirrored
  // triggers — (a) a non-flat→flat transition and (b) a whole-system
  // replacement that lands on a flat system — plus once at boot, so a paused
  // or re-sped orbit survives ordinary edits exactly like the tumble does.
  // No orientation to reset: theta IS the live camera, and yanking it would
  // discard the user's framing.
  function resetAutoOrbitView(): void {
    autoOrbitOn = !prefersReducedMotion();
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
    // This request supersedes any coalesced run a drag/slider burst left
    // queued for the next frame (fr-acc) — drop it so it can't fire a
    // redundant second request; the generator's own latest-wins slot handles
    // anything already in flight. Harmlessly a no-op when nothing is pending,
    // including when this call IS the coalesced run (the coalescer clears its
    // handle before invoking us).
    regenScheduler.cancel();
    cloudGenerator.request(cloudParams(replaced, fit));
  }

  // Snapshot the current document into a generation request (see
  // cloud-worker-core.ts's CloudRequest). The seed is rolled here — a live
  // Math.random can't cross postMessage — which as a side effect makes each
  // generation a reproducible pure function of its request, exactly like the
  // flame/voxel renders' start commands.
  function cloudParams(replaced: boolean, fit: boolean): CloudParams {
    return {
      transforms: state.transforms,
      finalTransform: state.finalTransform ?? null,
      numPoints: state.numPoints,
      seed: Math.floor(Math.random() * 0xffffffff),
      symmetry: state.symmetry,
      fourD: systemIsNonFlat(state),
      colorMode: state.colorMode,
      colorGamma: state.colorGamma,
      replaced,
      fit,
    };
  }

  // Land a finished generation on the scene — everything that used to run
  // synchronously inside regenerate() after the chaos game (fr-5kx). Runs on
  // the worker's reply, or inline for the boot/fallback synchronous paths, so
  // every step keys off the RESULT (and the request that produced it), never
  // off "whatever the document looks like now" — except where reading live
  // state is the point: the stale-color guard and applyFourDColor's mode
  // dispatch, which deliberately let an edit that landed mid-flight win.
  function applyCloudResult(result: CloudResult, request: CloudRequest): void {
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
      // The colors were baked worker-side at REQUEST-time mode/contrast; if
      // either changed while this generation was in flight, recolor the
      // fresh cloud from live state (recolor() reads the just-cached
      // lastResult) rather than flashing the stale palette.
      if (
        request.colorMode !== state.colorMode ||
        request.colorGamma !== state.colorGamma
      ) {
        recolor();
      }
      ui.setPointCount(result.count);
    }

    // Auto-frame the camera on a whole-system load's fresh attractor
    // (fr-0b8) — deferred to arrival with everything else, so it frames the
    // cloud actually going on screen.
    if (request.fit) fitCameraToAttractor();

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
    onResult: applyCloudResult,
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
      state.colorMode,
      state.colorGamma,
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
    const mode = state.fourDColor;
    if (fourDColorNeedsAttribute(mode)) {
      scene.setFourDColorSource({
        colors: buildColors4(fourDResult, state.transforms.length, mode),
      });
    } else {
      scene.setFourDColorSource({ sides: W_SIDE_PALETTES[mode] });
    }
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

  // Choose the bounds for the current view and glide the camera to frame them:
  // the 4D branch synthesizes a rotation-invariant box (fourDFramingBounds);
  // the 3D branch frames the latest run's bounds. A no-op until a run exists.
  function fitCameraToAttractor(): void {
    const framing = { fov: scene.camera.fov, aspect: scene.camera.aspect };
    if (viewIs4D) {
      // radius is rotation-invariant, so framing the synthesized box once
      // holds at every tumble angle (see fourDFramingBounds).
      if (fourDResult) {
        cameraTween.fitToBounds(
          fourDFramingBounds(fourDResult.center, fourDResult.radius),
          framing,
        );
      }
      return;
    }
    if (!lastResult) return;
    cameraTween.fitToBounds(lastResult.bounds, framing);
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
          flameSession.markFirstFrame();
        }
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
        paletteId: state.flame.paletteId,
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
        solidSession.markFirstFrame();
        break;
      case "progress":
        // Counters-only label refresh (the displayed texture is already
        // final) — e.g. the budget slider moved on a finished render.
        ui.setSolidProgress(event.iterationsDone, event.iterationsBudget);
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
        paletteId: state.solid.paletteId,
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

  function refreshGuides(): void {
    // No guide boxes in the 4D projection (an empty list; scene handles it).
    scene.updateGuides(
      viewIs4D ? [] : state.transforms,
      selectedBox(),
      state.showGuides,
    );
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
   */
  function applyDecodedSnapshot(snap: SceneSnapshot, refit: boolean): void {
    switchRenderMode("points");
    // A restored document must not trigger a preset hint armed just before
    // the time travel / gallery load.
    pendingRenderMode = null;
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
    regenerate(true, refit);
    scene.setFourDScaffold(null);
    scene.setRenderStyle(state.renderStyle);
    // Mirror onRenderStyle: never leave a stale glow exposure on a non-glow style.
    if (state.renderStyle !== "glow") scene.setGlowExposure(1);
    scene.setPointSize(state.pointSize);
    scene.setFourDDepthFade(state.fourDDepthFade);
    scene.setGuidesVisible(state.showGuides);
    scene.setSolidParams(state.solid);
    refreshGuides();
    refreshUi();
  }

  /**
   * Apply a history snapshot — {@link EditSession}'s injected `restore`. Decodes
   * the entry and hands it to {@link applyDecodedSnapshot}. It must NOT cut an
   * undo checkpoint (an undo/redo is not itself an edit) — the session arms the
   * restored document's checkpoint-free debounced save on its own once this
   * returns (see edit-session.ts). `refit` re-frames only when the step crosses
   * a whole-system replacement; ordinary parameter edits leave framing alone.
   */
  function restoreSnapshot(snapshot: string, refit: boolean): void {
    const snap = decodeScene(snapshot);
    if (!snap) return; // can't happen: entries are encodeScene output
    applyDecodedSnapshot(snap, refit);
  }

  // Session-only undo/redo plus the edit-burst / debounced-save policy layered
  // over it (see edit-session.ts). The injected deps are the app's real
  // capabilities: encode and persist the live scene document, apply a restored
  // snapshot (restoreSnapshot above — which must not checkpoint), reflect
  // undo/redo availability in the UI, and the debounced save-timer itself. Edit
  // handlers call editSession.beginEdit() BEFORE mutating the document; Ctrl+Z/
  // Ctrl+Shift+Z call undo()/redo(); the page-hide handlers below call flush().
  const editSession = new EditSession({
    snapshot: () => encodeScene(toSnapshot(state)),
    persist: () => saveScene(toSnapshot(state)),
    restore: restoreSnapshot,
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
   * debounced save) via `beginEdit("replace")` before applying, and re-frames
   * the camera. A corrupt entry (decode returns null — can't happen for our own
   * encodeScene output, but the collection is untrusted localStorage) is
   * ignored rather than blanking the current scene.
   */
  function loadEncodedScene(encoded: string): void {
    const snap = decodeScene(encoded);
    if (!snap) return;
    editSession.beginEdit("replace");
    applyDecodedSnapshot(snap, true);
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
   * Before applying the reducer, checkpoints an undo step and, after it, every
   * geometry edit refreshes the guide boxes and the UI, then schedules a
   * debounced save (see `editSession.beginEdit`).
   */
  function applyEdit(
    applyReducer: () => void,
    effect: "auto" | "always" = "auto",
  ): void {
    // Any fresh edit supersedes a preset hint still waiting for its cloud
    // (fr-39y) — onPreset re-arms it right after this returns.
    pendingRenderMode = null;
    editSession.beginEdit(effect === "always" ? "replace" : "tweak");
    applyReducer();
    if (effect === "always" || state.autoUpdate) {
      regenerate(effect === "always", effect === "always");
    }
    refreshGuides();
    refreshUi();
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
    onSurprise: () => {
      applyEdit(() => {
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
      }, "always");
      // A rolled system never carries a preset's tumbling scaffold (only the
      // polytope presets do), but one from an earlier visit could still be
      // showing — clear it unconditionally. (The camera auto-fit rides the
      // generation request — see applyEdit.)
      scene.setFourDScaffold(null);
    },
    // The generic scalar pipeline (fr-dig): view guard → undo checkpoint +
    // debounced save for document edits → the spec's own parse + reducer →
    // label sync → the spec's declared side effects. Per-control semantics
    // (worker forwards, restarts, live tone-maps) live on the SCALAR_CONTROLS
    // entries in control-spec.ts, next to the control they belong to.
    onScalarControl: (spec, raw) => {
      if (spec.view === "flat" && viewIs4D) return;
      if (spec.view === "nonFlat" && !viewIs4D) return;
      const previous = state;
      if (spec.persisted !== false) editSession.beginEdit();
      state = applyScalarControl(state, spec, raw);
      ui.updateLabels(state);
      spec.effect?.(state, controlEffects, previous);
    },
    onRegenerate: () => regenerate(),
    onRecordVideoToggle: () => {
      recorder.toggle();
    },
    // Saved-scene collection (fr-cai). Save/copy act on the CURRENT document
    // (the same encodeScene(toSnapshot(state)) the autosave/undo use); the
    // thumbnail is a downsampled snapshot of the live cloud. These are reachable
    // only from the explorer (their section hides during a render), so the
    // thumbnail is always the point cloud, never a frozen flame/solid frame.
    onSaveToCollection: () => {
      collection.add(encodeScene(toSnapshot(state)), scene.captureThumbnail());
      ui.setCollectionCount(collection.size);
      ui.flashToast("Saved to collection");
    },
    onOpenGallery: () => {
      ui.openGallery(collection.all());
    },
    onLoadFromCollection: (id) => {
      const entry = collection.all().find((s) => s.id === id);
      if (!entry) return; // deleted between render and click — nothing to load.
      ui.closeGallery();
      loadEncodedScene(entry.encoded);
    },
    onDeleteFromCollection: (id) => {
      collection.remove(id);
      ui.setCollectionCount(collection.size);
      ui.renderGallery(collection.all()); // refresh the still-open modal in place.
    },
    onCopyLink: () => {
      // Build the link from CURRENT state rather than reading location.hash,
      // which the autosave only writes on its 300ms debounce (so it can lag a
      // just-made edit). origin + pathname drops any existing hash/query.
      const link = `${location.origin}${location.pathname}#${encodeScene(
        toSnapshot(state),
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
    // so there is nothing else to push here.
    onFourDTumbleToggle: (checked) => {
      fourDView.tumbleOn = checked;
    },
    onFourDTumbleSpeedInput: (value) => {
      fourDView.tumbleSpeed = value;
    },
    // Auto-orbit pause/resume + speed (fr-1yn): the 3D siblings of the tumble
    // handlers above, same session-only pattern.
    onAutoOrbitToggle: (checked) => {
      autoOrbitOn = checked;
    },
    onAutoOrbitSpeedInput: (value) => {
      autoOrbitSpeed = value;
    },
  });

  const gestures = attachInteractions(scene, orbit, {
    selectedTransform: selectedBox,
    frozen: () => state.renderMode === "flame",
    onTransformChange: (index, geometry) => {
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
  cloudGenerator.generateSync(cloudParams(false, false));
  // A flat boot never routes through regenerate()'s flip/replacement branches,
  // so seed the auto-orbit baseline (incl. the reduced-motion pause and the
  // checkbox sync) explicitly. A non-flat boot leaves it to the first
  // non-flat→flat transition, exactly like the tumble in the other direction.
  if (!viewIs4D) resetAutoOrbitView();
  refreshGuides();
  // Match grid/axes to the initial (possibly restored) guide visibility, since
  // refreshGuides only governs the per-transform boxes.
  scene.setGuidesVisible(state.showGuides);
  refreshUi();
  editSession.syncUi();
  ui.setCollectionCount(collection.size);

  // While a flame render is active, accumulation/downsample/tone-map all
  // happen in the worker (see flame-worker-core.ts) and arrive as "progress"
  // events (handleFlameEvent) — this loop just keeps redrawing whatever
  // image was most recently uploaded via scene.setFlameImage.
  function animate(): void {
    requestAnimationFrame(animate);
    cameraTween.advance();
    if (state.renderMode === "solid") {
      // Unlike the flame's frozen view, the volume is world-space: keep
      // applying the live orbit camera so the user can keep looking around
      // while accumulation converges.
      scene.applyCamera(orbit);
      if (solidSession.hasFirstFrame) {
        scene.renderSolid();
      } else {
        // Keep showing the live explorer (fog + point cloud) until the
        // worker's first grid lands, avoiding a flash of an empty volume
        // during the worker startup gap.
        scene.updateFog();
        scene.render();
      }
      return;
    }
    if (state.renderMode === "flame") {
      // Keep drawing the frozen explorer view (already-applied camera, no
      // further orbit input while the flame render is active) until the
      // worker's first image lands, then switch over — avoids a flash of the
      // flame canvas's stale contents during the worker startup gap.
      if (flameSession.hasFirstFrame) {
        scene.renderFlame();
      } else {
        scene.render();
      }
      return;
    }
    // One clamped dt for both kinds of automatic motion (4D tumble / 3D
    // auto-orbit — mutually exclusive by viewIs4D). Clamp it: a backgrounded
    // tab suspends RAF (and a render's early returns skip this path
    // entirely), and an unclamped catch-up delta would violently snap the
    // orientation on refocus/exit.
    const now = performance.now();
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
      const b = lastResult.bounds;
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
    scene.render();
  }
  animate();
}

registerServiceWorker(showUpdateBanner);
main();
